// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — SERVICES/PUSH-SUPERADMIN  (v644)
//
// El lado del navegador de los avisos push del SuperAdmin: pide el
// permiso, da de alta el dispositivo, y cuando llega un aviso lo hace
// sonar, lo pinta y pone el número en la insignia del icono.
//
// El otro lado son `firebase-messaging-sw.js` (recibe con la app cerrada)
// y los disparadores `notifySuperAdmin*` de functions/index.js (envían).
//
// ══════════════════════════════════════════════════════════════════
//  🔴 LO PRIMERO, PORQUE ES LO QUE FALTA PARA QUE ESTO FUNCIONE
// ══════════════════════════════════════════════════════════════════
//  HACE FALTA UNA **CLAVE VAPID** (par de claves Web Push). No se puede
//  generar desde aquí ni desde la CLI: la crea Firebase Console en
//  Configuración del proyecto ▸ Cloud Messaging ▸ «Certificados push
//  web» ▸ Generar par de claves. Lo que se copia es la clave PÚBLICA.
//
//  Se puede poner en DOS sitios, y se mira en este orden:
//    1. El documento `cronos_config/push`, campo `vapidKey` — lo puede
//       escribir el propio SuperAdmin desde la consola de Firebase sin
//       tocar código ni volver a desplegar. ES LA VÍA RECOMENDADA.
//    2. La constante `_VAPID_EMBEBIDA` de aquí abajo, como respaldo.
//
//  ⚠️ SIN CLAVE NO HAY AVISOS, y el fallo es MUDO por naturaleza: nadie
//  echa de menos una notificación que no llega. Por eso `cronosPushEstado()`
//  la nombra explícitamente y el botón de la cabecera se pone en ámbar en
//  vez de fingir que está todo bien.
//
//  La clave pública NO es un secreto (viaja en cada suscripción del
//  navegador): guardarla en Firestore o en el fuente es correcto.
// ══════════════════════════════════════════════════════════════════
//
//  🔑 POR QUÉ EL ÁMBITO `/cronos-push/`
//  Dos service workers no pueden gobernar el mismo ámbito. `sw.js` ya
//  ocupa `/` con la precarga, las cachés y el modo sin cobertura de TODA
//  la app; registrar el de push en `/` —que es lo que hace FCM por
//  defecto— lo habría desalojado. Con ámbito propio conviven: el `push`
//  llega a la SUSCRIPCIÓN, no al ámbito, así que no controlar ninguna
//  página no le quita nada.
//
//  ⚠️ POR ESO SE LE PASA `serviceWorkerRegistration` A `getToken`. Sin
//  ese argumento el SDK registra `/firebase-messaging-sw.js` en `/` por
//  su cuenta — y ahí es donde se llevaría por delante a `sw.js`.
// ══════════════════════════════════════════════════════════════════
'use strict';

(function () {

const SDK           = 'https://www.gstatic.com/firebasejs/10.12.2/';
const AMBITO_PUSH   = './cronos-push/';
const SW_PUSH       = './firebase-messaging-sw.js';
const COL_TOKENS    = 'push_tokens';

// ⬇️ Respaldo. Lo normal es dejarlo vacío y poner la clave en
//    `cronos_config/push`.vapidKey (ver cabecera).
const _VAPID_EMBEBIDA = '';

let _arrancado   = false;   // ya se intentó el alta en esta sesión
let _registro    = null;    // ServiceWorkerRegistration del ámbito de push
let _tokenActual = '';
let _ctxAudio    = null;

// ── ¿Quién es el que mira? ────────────────────────────────────────
// ⚠️ ESTO **NO ES UNA AUTORIZACIÓN**, y no puede serlo: decide si se
// OFRECE el alta del dispositivo, nada más. Quién recibe de verdad lo
// vuelve a decidir el servidor, contra `cronos_config/superadmins`, justo
// antes de enviar (ver `_tokensDelSuperAdmin` en functions/index.js). Por
// eso basta con mirar el rol de la sesión y no hace falta traerse aquí la
// lista de correos — que además vive en el ámbito de módulo de auth.js y
// no cuelga de `window` (la trampa de v383).
function _esSA() {
    const u = window._cronosCurrentUser;
    return !!u && u.role === 'superadmin';
}

// ══════════════════════════════════════════════════════════════════
//  EL SONIDO
//
//  Sintetizado con Web Audio, sin fichero externo — igual que el silbato
//  del árbitro (js/core/event-listeners.js). Un .mp3 sería una petición
//  de red más que puede faltar justo el día que suena.
//
//  ⚠️ ESTO SÓLO SUENA CON LA APP ABIERTA. Con la app cerrada suena el
//  aviso del SISTEMA OPERATIVO: la web no permite adjuntar un sonido
//  propio a una notificación en segundo plano, y no hay forma de
//  rodearlo. Lo único que se puede pedir es que NO sea silenciosa, y eso
//  lo hace el service worker con `silent:false` + `renotify:true`.
// ══════════════════════════════════════════════════════════════════
function _campana() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!_ctxAudio) _ctxAudio = new Ctx();
        // El navegador suspende el contexto si se creó sin gesto del
        // usuario. Reanudarlo es barato y es lo que hace que suene cuando
        // la pestaña llevaba rato en segundo plano.
        if (_ctxAudio.state === 'suspended') _ctxAudio.resume().catch(() => {});

        const ctx = _ctxAudio;
        const t0  = ctx.currentTime + 0.02;
        // Dos notas (sol–do): se reconoce como "aviso" y no como el
        // silbato, que en esta app significa otra cosa muy distinta.
        [[784, 0], [1046, 0.16]].forEach(([hz, retardo]) => {
            const t   = t0 + retardo;
            const osc = ctx.createOscillator();
            const g   = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(hz, t);
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.28, t + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(t); osc.stop(t + 0.6);
        });
    } catch (e) {
        console.warn('[PushSA] no se pudo sonar:', e && e.message);
    }
}

// ══════════════════════════════════════════════════════════════════
//  LA INSIGNIA DEL ICONO
//
//  Se pone por los DOS caminos a propósito: desde la página (vale
//  mientras hay pestaña) y por mensaje al service worker (es el que
//  sigue vivo con la app cerrada). No es redundante — cubren momentos
//  distintos, y el que sobre no hace daño.
// ══════════════════════════════════════════════════════════════════
window.cronosPushInsignia = function cronosPushInsignia(n) {
    const num = Number(n);
    const valido = Number.isFinite(num) && num > 0;
    try {
        if (navigator.setAppBadge && valido) navigator.setAppBadge(num);
        else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (_) { /* la insignia nunca puede romper nada */ }
    try {
        if (_registro && _registro.active) {
            _registro.active.postMessage({ fuente: 'chronos-push', tipo: 'insignia', valor: valido ? num : 0 });
        }
    } catch (_) {}
};

// ══════════════════════════════════════════════════════════════════
//  EL AVISO DENTRO DE LA APP
//
//  Con la app abierta el navegador NO pinta la notificación del sistema
//  (o la pinta sin que nadie la mire), así que hace falta algo visible
//  aquí dentro. Es una tira superior, no un `alert()`: un alert bloquea
//  el hilo y el SuperAdmin puede estar en mitad de otra cosa.
// ══════════════════════════════════════════════════════════════════
function _tira(titulo, cuerpo, url) {
    try {
        const previo = document.getElementById('cronos-push-aviso');
        if (previo) previo.remove();

        const el = document.createElement('div');
        el.id = 'cronos-push-aviso';
        el.style.cssText =
            'position:fixed;top:0;left:0;right:0;z-index:99999;' +
            'background:linear-gradient(to right,#f0883e,#d2691e);color:#fff;' +
            'padding:0.75rem 1.1rem;display:flex;align-items:center;gap:0.9rem;' +
            'font-family:Inter,sans-serif;font-size:0.85rem;box-shadow:0 4px 18px rgba(0,0,0,0.45);';
        const txt = document.createElement('div');
        txt.style.cssText = 'flex:1;min-width:0;';
        // 🔒 textContent, NUNCA innerHTML: el cuerpo del aviso lleva el
        //    nombre y el club que ESCRIBIÓ el solicitante. Es texto de un
        //    tercero, y por ahí es por donde entra un XSS.
        const h = document.createElement('div');
        h.style.cssText = 'font-weight:700;';
        h.textContent = titulo || 'Chronos Fútbol';
        const p = document.createElement('div');
        p.style.cssText = 'opacity:0.92;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        p.textContent = cuerpo || '';
        txt.appendChild(h); txt.appendChild(p);

        const ver = document.createElement('button');
        ver.textContent = 'Ver';
        ver.style.cssText =
            'background:rgba(255,255,255,0.22);border:1px solid rgba(255,255,255,0.45);' +
            'color:#fff;border-radius:6px;padding:0.35rem 0.9rem;font-weight:700;' +
            'font-size:0.78rem;cursor:pointer;white-space:nowrap;';
        ver.onclick = () => { el.remove(); window.cronosPushIrASolicitudes(url); };

        const cerrar = document.createElement('button');
        cerrar.textContent = '✕';
        cerrar.setAttribute('aria-label', 'Cerrar aviso');
        cerrar.style.cssText =
            'background:none;border:none;color:#fff;font-size:1rem;cursor:pointer;opacity:0.8;';
        cerrar.onclick = () => el.remove();

        el.appendChild(txt); el.appendChild(ver); el.appendChild(cerrar);
        document.body.appendChild(el);
        // Se retira sola: la notificación del sistema y la insignia ya
        // dejan constancia; esto es sólo el golpe de atención.
        setTimeout(() => { if (el.isConnected) el.remove(); }, 12000);
    } catch (e) {
        console.warn('[PushSA] no se pudo pintar el aviso:', e && e.message);
    }
}

// ── Llevar al SuperAdmin a la lista de solicitudes ────────────────
window.cronosPushIrASolicitudes = function cronosPushIrASolicitudes(_url) {
    try {
        if (typeof window.saTab === 'function' && document.getElementById('sa-panel')) {
            window.saTab('requests');
            return;
        }
        if (typeof window.openSuperAdminPanel === 'function') {
            Promise.resolve(window.openSuperAdminPanel()).then(() => {
                if (typeof window.saTab === 'function') window.saTab('requests');
            }).catch(() => {});
            return;
        }
        // Ni panel ni función: se recarga con la marca, y el arranque de
        // más abajo la recoge en cuanto la sesión esté lista.
        location.href = _url || './index.html?sa=requests';
    } catch (e) {
        console.warn('[PushSA] no se pudo abrir Solicitudes:', e && e.message);
    }
};

// ── Qué hacer cuando entra un aviso (venga de donde venga) ────────
function _entraAviso(m) {
    if (!m) return;
    if (m.tipo === 'abrir_solicitudes') { window.cronosPushIrASolicitudes(m.url); return; }
    _campana();
    _tira(m.titulo, m.cuerpo, m.url);
    if (m.insignia !== undefined) window.cronosPushInsignia(m.insignia);
    // El tablero del SuperAdmin pinta su píldora desde esta variable.
    if (m.insignia !== undefined) window._saPendingCount = Number(m.insignia) || 0;
    if (typeof window.saMenu === 'function' && window._saSeccionActual === 'menu') {
        try { window.saMenu(); } catch (_) {}
    }
}

// El service worker de push habla por aquí (app abierta pero en otra
// pestaña o minimizada), y también al pulsar la notificación.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (ev) => {
        const m = ev && ev.data;
        if (!m || m.fuente !== 'chronos-push') return;
        _entraAviso(m);
    });
}

// ══════════════════════════════════════════════════════════════════
//  LA CLAVE VAPID
// ══════════════════════════════════════════════════════════════════
async function _claveVapid() {
    if (_VAPID_EMBEBIDA) return _VAPID_EMBEBIDA;
    try {
        const { db, doc, getDoc } = await window.saFS();
        const snap = await getDoc(doc(db, 'cronos_config', 'push'));
        const v = snap.exists() ? (snap.data() || {}).vapidKey : '';
        return (typeof v === 'string' && v.trim()) ? v.trim() : '';
    } catch (e) {
        console.warn('[PushSA] no se pudo leer cronos_config/push:', e && e.message);
        return '';
    }
}

// ══════════════════════════════════════════════════════════════════
//  ALTA DEL DISPOSITIVO
//
//  Devuelve siempre un objeto { ok, motivo } — NUNCA lanza. Lo llama la
//  apertura del panel, y un fallo aquí no puede impedir que el
//  SuperAdmin entre a trabajar.
// ══════════════════════════════════════════════════════════════════
window.cronosPushActivar = async function cronosPushActivar(pedirPermiso) {
    if (!_esSA())                       return { ok: false, motivo: 'no-superadmin' };
    if (!('serviceWorker' in navigator)) return { ok: false, motivo: 'sin-service-worker' };
    if (!('PushManager' in window))      return { ok: false, motivo: 'sin-push' };
    if (!('Notification' in window))     return { ok: false, motivo: 'sin-notificaciones' };

    // ⚠️ EL PERMISO SÓLO SE PIDE CON UN GESTO DEL USUARIO. Safari (y iOS
    // sobre todo) descarta `requestPermission()` fuera de un clic, y
    // Chrome penaliza al sitio que lo pide al cargar. Por eso el arranque
    // automático pasa `false` y sólo continúa si ya estaba concedido; el
    // botón 🔔 de la cabecera pasa `true`.
    if (Notification.permission === 'denied')  return { ok: false, motivo: 'permiso-denegado' };
    if (Notification.permission !== 'granted') {
        if (!pedirPermiso) return { ok: false, motivo: 'permiso-sin-pedir' };
        let p = 'default';
        try { p = await Notification.requestPermission(); } catch (_) {}
        if (p !== 'granted') return { ok: false, motivo: 'permiso-denegado' };
    }

    const vapid = await _claveVapid();
    if (!vapid) {
        console.warn('[PushSA] FALTA LA CLAVE VAPID. Ver la cabecera de ' +
                     'js/services/push-superadmin.js: se genera en Firebase Console ▸ ' +
                     'Cloud Messaging ▸ Certificados push web, y se pega en ' +
                     'cronos_config/push.vapidKey.');
        return { ok: false, motivo: 'sin-clave-vapid' };
    }

    try {
        // 1 · El service worker de push, en SU ámbito (ver cabecera).
        _registro = await navigator.serviceWorker.register(SW_PUSH, { scope: AMBITO_PUSH });
        // `ready` no vale aquí: espera al del ámbito de la PÁGINA, que es
        // sw.js. Hay que esperar a ÉSTE, y explícitamente.
        if (!_registro.active) {
            await new Promise((res) => {
                const w = _registro.installing || _registro.waiting;
                if (!w) return res();
                w.addEventListener('statechange', () => { if (w.state === 'activated') res(); });
                setTimeout(res, 8000);   // nunca se queda colgado
            });
        }

        // 2 · El token, con el SDK modular (la página sí puede importarlo).
        const { getMessaging, getToken, onMessage, isSupported } = await import(SDK + 'firebase-messaging.js');
        if (!(await isSupported())) return { ok: false, motivo: 'navegador-sin-fcm' };

        const { getApp } = await import(SDK + 'firebase-app.js');
        const messaging = getMessaging(getApp());

        const token = await getToken(messaging, {
            vapidKey: vapid,
            serviceWorkerRegistration: _registro,   // ⚠️ IMPRESCINDIBLE (ver cabecera)
        });
        if (!token) return { ok: false, motivo: 'sin-token' };
        _tokenActual = token;

        // 3 · Guardarlo, para que el servidor sepa a dónde enviar.
        await _guardarToken(token);

        // 4 · Con la app en primer plano el aviso NO pasa por el service
        //     worker: lo entrega el SDK aquí. Sin esto, tener la app
        //     delante sería el único caso en que no te enteras de nada.
        onMessage(messaging, (payload) => {
            const d = (payload && payload.data) || {};
            _entraAviso({
                tipo:     d.tipo || 'sa_pendiente',
                titulo:   d.titulo || '📋 Nueva solicitud',
                cuerpo:   d.cuerpo || 'Tienes una solicitud pendiente.',
                insignia: d.insignia,
                url:      d.url,
            });
        });

        console.log('[PushSA] avisos activos en este dispositivo.');
        return { ok: true, motivo: 'activo', token: token };

    } catch (e) {
        console.warn('[PushSA] no se pudo activar:', e && e.message);
        return { ok: false, motivo: 'error', detalle: e && e.message };
    }
};

// ── El documento del dispositivo ──────────────────────────────────
// El id ES el token: así un mismo navegador no acumula filas al volver a
// entrar, y el servidor puede borrar el documento exacto cuando FCM le
// dice que ese token ya no existe.
//
// ⚠️ NO SE GUARDA NADA QUE NO HAGA FALTA. El `email` está porque es lo
// que el servidor compara contra `cronos_config/superadmins` para decidir
// si ese dispositivo tiene derecho a recibir; el `role` es informativo y
// el servidor NO se fía de él (lo escribe el cliente).
async function _guardarToken(token) {
    const u = window._cronosCurrentUser || {};
    const { db, doc, setDoc, serverTimestamp } = await window.saFS();
    await setDoc(doc(db, COL_TOKENS, token), {
        token:     token,
        uid:       u.uid || '',
        email:     u.email || '',
        role:      'superadmin',
        plataforma: (navigator.userAgentData && navigator.userAgentData.platform) ||
                    navigator.platform || '',
        agente:    String(navigator.userAgent || '').slice(0, 300),
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

// ══════════════════════════════════════════════════════════════════
//  ESTADO LEGIBLE — para el botón y para diagnosticar a mano
// ══════════════════════════════════════════════════════════════════
window.cronosPushEstado = async function cronosPushEstado() {
    const permiso = ('Notification' in window) ? Notification.permission : 'no-soportado';
    return {
        superadmin:  _esSA(),
        permiso:     permiso,
        soportado:   ('serviceWorker' in navigator) && ('PushManager' in window),
        registrado:  !!_tokenActual,
        claveVapid:  !!(await _claveVapid()),
        ambito:      _registro ? _registro.scope : null,
    };
};

// ══════════════════════════════════════════════════════════════════
//  EL BOTÓN 🔔 DE LA CABECERA DEL PANEL
//
//  Lo llama openSuperAdminPanel() después de pintar el panel. Dice el
//  estado REAL y no sólo "activar": un botón que promete avisos sin
//  clave VAPID o con el permiso denegado es peor que no tenerlo, porque
//  deja creer que están llegando.
// ══════════════════════════════════════════════════════════════════
window.cronosPushMontarBoton = async function cronosPushMontarBoton() {
    if (!_esSA()) return;
    const cab = document.querySelector('#sa-panel .sap-head > div:last-child');
    if (!cab || document.getElementById('sa-push-btn')) return;

    const b = document.createElement('button');
    b.id = 'sa-push-btn';
    b.className = 'sap-btn';
    cab.insertBefore(b, cab.firstChild);

    const pintar = (est) => {
        let icono, texto, color, borde;
        if (!est.soportado)            { icono = '🔕'; texto = 'Sin avisos';    color = '#8b949e'; borde = '139,148,158'; }
        else if (!est.claveVapid)      { icono = '🔔'; texto = 'Falta clave';   color = '#f0883e'; borde = '240,136,62'; }
        else if (est.permiso === 'denied') { icono = '🔕'; texto = 'Bloqueados'; color = '#ff5858'; borde = '255,88,88'; }
        else if (est.registrado)       { icono = '🔔'; texto = 'Avisos ON';     color = '#3fb950'; borde = '63,185,80'; }
        else                           { icono = '🔔'; texto = 'Activar avisos'; color = '#58a6ff'; borde = '88,166,255'; }
        b.textContent = icono + ' ' + texto;
        b.style.cssText = 'border-radius:6px;padding:0.35rem 0.8rem;font-size:0.74rem;' +
            'font-weight:700;cursor:pointer;white-space:nowrap;' +
            'background:rgba(' + borde + ',0.10);border:1px solid rgba(' + borde + ',0.35);color:' + color + ';';
        b.title = 'Permiso: ' + est.permiso +
                  ' · Clave VAPID: ' + (est.claveVapid ? 'sí' : 'NO') +
                  ' · Dispositivo dado de alta: ' + (est.registrado ? 'sí' : 'no');
    };

    pintar(await window.cronosPushEstado());

    b.onclick = async () => {
        const est = await window.cronosPushEstado();
        if (est.permiso === 'denied') {
            alert('Los avisos están bloqueados para esta web en el navegador.\n\n' +
                  'Hay que volver a permitirlos desde el candado de la barra de ' +
                  'direcciones (Notificaciones ▸ Permitir) y recargar.');
            return;
        }
        if (!est.claveVapid) {
            alert('Falta la clave VAPID (certificado push web).\n\n' +
                  'Firebase Console ▸ Configuración del proyecto ▸ Cloud Messaging ▸ ' +
                  'Certificados push web ▸ Generar par de claves.\n\n' +
                  'Después, pegar la clave pública en el documento ' +
                  'cronos_config/push, campo vapidKey.');
            return;
        }
        b.textContent = '⏳ Activando…';
        const r = await window.cronosPushActivar(true);
        pintar(await window.cronosPushEstado());
        if (r.ok) _campana();
        else if (r.motivo !== 'permiso-denegado') {
            console.warn('[PushSA] alta no completada:', r.motivo, r.detalle || '');
        }
    };
};

// ══════════════════════════════════════════════════════════════════
//  ARRANQUE AUTOMÁTICO
//
//  Sólo si el permiso YA está concedido: renueva el token (FCM los rota)
//  y vuelve a enganchar el aviso en primer plano. Sin permiso concedido
//  no hace nada — pedirlo sin gesto no funciona y penaliza al sitio.
// ══════════════════════════════════════════════════════════════════
window.cronosPushArrancar = async function cronosPushArrancar() {
    if (_arrancado || !_esSA()) return;
    _arrancado = true;
    try {
        if (('Notification' in window) && Notification.permission === 'granted') {
            await window.cronosPushActivar(false);
        }
    } catch (_) {}
    window.cronosPushMontarBoton();
    // La insignia refleja lo que el panel ya ha contado al abrirse.
    window.cronosPushInsignia(window._saPendingCount || 0);
};

// ── El enlace profundo de la notificación (?sa=requests) ──────────
// Al pulsar el aviso con la app cerrada, el navegador abre esta URL. La
// sesión aún no existe en ese instante, así que se espera a que el panel
// del SuperAdmin esté disponible en vez de intentarlo una sola vez.
try {
    if (/[?&]sa=requests\b/.test(location.search)) {
        let intentos = 0;
        const reloj = setInterval(() => {
            intentos++;
            if (typeof window.saTab === 'function' && document.getElementById('sa-panel')) {
                clearInterval(reloj);
                try { window.saTab('requests'); } catch (_) {}
            } else if (intentos > 60) {          // 60 × 500 ms = 30 s
                clearInterval(reloj);
            }
        }, 500);
    }
} catch (_) {}

})();
