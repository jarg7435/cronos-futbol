/**
 * 16_superadmin.js  —  SuperAdmin Panel v9.0
 * Chronos Fútbol
 *
 * FLUJO DE APROBACIÓN (DOS PASOS):
 *   1. Usuario se registra  → status:'pending'       → SA ve en "Solicitudes"
 *   2. SuperAdmin aprueba   → status:'pending_club'  → Club Admin ve en "Pendientes"
 *   3. Club Admin confirma  → status:'active'        → usuario puede entrar
 *
 * SOLICITUD DESDE CLUB ADMIN:
 *   1. Club Admin pide plaza → platform_requests status:'pending_sa'
 *   2. SA aprueba → pre-usuario status:'pending_register'
 *   3. Usuario se registra → status:'pending_club'
 *   4. Club Admin confirma → status:'active'
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTES COMPARTIDAS — Definidas en admin-shared.js (carga antes)
// Si admin-shared.js no cargó, se emite un aviso en consola.
// ═══════════════════════════════════════════════════════════════════

if (typeof window.ROLE_META === 'undefined') {
    console.warn('[superadmin/panel.js] ROLE_META no definido — admin-shared.js no cargó correctamente');
}

if (typeof window.SA_CSS === 'undefined') {
window.SA_CSS = `<style>
.sa-modal{background:#0d1117!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:16px!important;max-width:860px!important;width:98vw!important;max-height:92vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;font-family:Inter,sans-serif!important;}
.sa-topbar{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.2rem;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;flex-wrap:wrap;gap:0.5rem;}
.sa-body{flex:1;overflow-y:auto;padding:1rem 1.2rem;-webkit-overflow-scrolling:touch;}
.sa-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:0.9rem 1rem;margin-bottom:0.8rem;}
.sa-card-head{display:flex;align-items:center;justify-content:space-between;cursor:pointer;gap:0.5rem;user-select:none;}
.sa-card-title{display:flex;align-items:center;gap:0.5rem;font-weight:700;font-size:0.88rem;color:white;}
.sa-card-body{display:none;padding-top:0.7rem;margin-top:0.5rem;border-top:1px solid rgba(255,255,255,0.1);}
.sa-card.expanded .sa-card-body{display:block;}
.sa-card.expanded .sa-chevron{transform:rotate(0deg);}
.sa-chevron{display:inline-block;transform:rotate(-90deg);transition:transform 0.2s;font-size:0.65rem;}
.sa-badge{display:inline-flex;align-items:center;padding:0.18rem 0.55rem;border-radius:20px;font-size:0.7rem;font-weight:700;background:rgba(88,166,255,0.12);color:#58a6ff;}
.sa-btn{display:inline-flex;align-items:center;gap:0.3rem;padding:0.32rem 0.65rem;border:1px solid rgba(255,255,255,0.1);border-radius:7px;background:rgba(255,255,255,0.04);color:white;font-size:0.78rem;font-weight:600;cursor:pointer;white-space:nowrap;}
.sa-btn:hover{filter:brightness(1.2);}
.sa-input{width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;outline:none;font-family:Inter,sans-serif;}
.sa-input:focus{border-color:#58a6ff;}
.sa-label{display:block;font-size:0.72rem;color:#8b949e;margin-bottom:0.3rem;font-weight:600;letter-spacing:0.3px;}
.sa-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:0.6rem;}
.sa-stat{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:0.6rem;text-align:center;}
.sa-stat-n{font-size:1.3rem;font-weight:800;color:#3fb950;}
.sa-stat-l{font-size:0.65rem;color:#8b949e;margin-top:0.1rem;}
.sa-urow{display:flex;align-items:center;gap:0.5rem;padding:0.45rem 0.3rem;border-bottom:1px solid rgba(255,255,255,0.04);}
.sa-urow:last-child{border-bottom:none;}
.sa-g4{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.6rem;align-items:start;}
</style>`;
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS UI
// ═══════════════════════════════════════════════════════════════════

(function () {
    function spinnerEl() {
        let el = document.getElementById('_sa-spinner');
        if (!el) {
            el = document.createElement('div');
            el.id = '_sa-spinner';
            el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);display:none;align-items:center;justify-content:center;z-index:99999;flex-direction:column;gap:0.8rem;';
            el.innerHTML = '<style>@keyframes _saSpin{to{transform:rotate(360deg)}}</style><div style="width:38px;height:38px;border:3px solid rgba(255,255,255,0.12);border-top-color:#58a6ff;border-radius:50%;animation:_saSpin 0.75s linear infinite;"></div><div id="_sa-spinner-msg" style="color:white;font-size:0.88rem;font-family:Inter,sans-serif;"></div>';
            document.body.appendChild(el);
        }
        return el;
    }
    window._saShowSpinner = function(msg) {
        if (typeof showSpinner === 'function') { showSpinner(msg); return; }
        const el = spinnerEl();
        const m = document.getElementById('_sa-spinner-msg');
        if (m) m.textContent = msg || '';
        el.style.display = 'flex';
    };
    window._saHideSpinner = function() {
        if (typeof hideSpinner === 'function') { hideSpinner(); return; }
        const el = document.getElementById('_sa-spinner');
        if (el) el.style.display = 'none';
    };
    window._saToast = function(msg, ms) {
        if (typeof showToast === 'function') { showToast(msg, ms); return; }
        const t = document.createElement('div');
        t.textContent = msg;
        t.style.cssText = 'position:fixed;bottom:1.8rem;left:50%;transform:translateX(-50%);background:#1a2233;color:white;padding:0.75rem 1.4rem;border-radius:8px;font-size:0.87rem;font-family:Inter,sans-serif;z-index:99998;box-shadow:0 4px 16px rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.1);white-space:nowrap;';
        document.body.appendChild(t);
        setTimeout(() => t.remove(), ms || 3000);
    };
})();

// ═══════════════════════════════════════════════════════════════════
//  ⏱️ v638 · EL PANEL SALÍA A LEER ANTES DE TENER EL TOKEN
//
//  Síntoma medido (capturas 9668/9669, testeo v637): al entrar, el panel
//  mostraba "Missing or insufficient permissions" y la consola escupía
//  `_ensureSuperAdminConfig`, `[saClubs]`, `[saIndividuals]`,
//  `deletion_requests` y DOS `Uncaught Error in snapshot listener`, todos
//  permission-denied. Dos minutos después, el mismo panel cargaba bien.
//
//  🔑 NO ERA UN PERMISO. Se midieron las reglas VIVAS con el método :test de
//  la Rules REST API, simulando al SuperAdmin CON claim y SÓLO CON CORREO:
//  las diez consultas del panel salen ALLOW en los dos casos. Y
//  `cronos_config/superadmins` existe en producción con su correo dentro
//  (leído por REST). O sea: la autorización nunca estuvo en duda.
//
//  La única forma de que esas reglas denieguen es que `request.auth` llegue
//  NULO: la lectura sale ANTES de que el cliente de Firestore tenga instalado
//  el token. Es EXACTAMENTE la carrera de v568 —el login denegado que no era
//  un permiso— en un sitio que aquel arreglo no tocó: v568 blindó
//  `checkAuthorization`, pero el panel del SuperAdmin abre en cuanto el login
//  resuelve y dispara su primera oleada de consultas por su cuenta.
//
//  ⚠️ POR QUÉ SE VE AHORA Y NO ANTES: `saClubs` LISTA `users` entera, y hasta
//  v632 esa colección era `allow read: if isAuth()`. SEC-A1 la cerró, así que
//  ahora la consulta depende de `isSuperAdmin()` — que sin `request.auth` es
//  falso. El agujero de la carrera llevaba ahí desde siempre; lo que cambió es
//  que dejó de ser inofensivo.
//
//  🔑 SE ARREGLA EN saFS(), QUE ES EL EMBUDO: los quince módulos del panel
//  piden sus manejadores de Firestore por aquí. Esperar el token en este único
//  punto los cubre a todos, sin repetir la espera en cada llamada.
// ═══════════════════════════════════════════════════════════════════

// Espera a que Auth tenga un token válido instalado. Con TOPE: si el SDK no
// contesta, NO se cuelga el panel — se sigue y que decida la lectura, que para
// eso lleva su propio reintento.
window._saEsperarToken = async function _saEsperarToken(forzarRefresco) {
    try {
        const fa = window._cronos_auth;
        const user = (fa && fa.auth && fa.auth.currentUser) || null;
        if (!user || typeof user.getIdToken !== 'function') return;
        await Promise.race([
            user.getIdToken(!!forzarRefresco),
            new Promise((_, rej) => setTimeout(() => rej(new Error('token lento')), forzarRefresco ? 5000 : 3000)),
        ]);
    } catch (e) {
        console.warn('[saFS] No se pudo preparar el token antes de leer:', e && e.message);
    }
};

// Envuelve una lectura del panel: si la deniegan, REFRESCA EL TOKEN A LA FUERZA
// y reintenta. Sin el refresco, reintentar repite la misma consulta con el mismo
// cliente sin token y vuelve a fallar igual — es lo que ya se pagó en v568.
window._saConReintento = async function _saConReintento(fn, etiqueta) {
    const ESPERAS = [800, 1600, 3200];
    for (let intento = 0; ; intento++) {
        try {
            return await fn();
        } catch (e) {
            const esPermisos = e && (e.code === 'permission-denied' ||
                                     (e.message || '').includes('permission'));
            if (!esPermisos || intento >= ESPERAS.length) throw e;
            const espera = ESPERAS[intento];
            console.warn('[' + (etiqueta || 'saFS') + '] Denegado (token aún sin instalar). ' +
                         'Refrescando token y reintentando en ' + espera + ' ms… (' +
                         (intento + 1) + '/' + ESPERAS.length + ')');
            await new Promise(r => setTimeout(r, espera));
            await window._saEsperarToken(true);
        }
    }
};

// ═══════════════════════════════════════════════════════════════════
// saFS() — helper de Firebase (compartido con 17_club_admin.js)
// ═══════════════════════════════════════════════════════════════════

window.saFS = async function saFS() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) throw new Error('Firebase no inicializado. Recarga la página.');
    // ⏱️ v638 · el token, ANTES de entregar los manejadores. Ver la nota de
    //    arriba: sin esto la primera oleada de consultas sale sin `request.auth`.
    await window._saEsperarToken(false);
    const [fs, fnMod, appMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    ]);
    if (!fa._functions) {
        try { fa._functions = fnMod.getFunctions(appMod.getApp()); }
        catch (e) { console.warn('[saFS] Functions:', e.message); }
    }
    return {
        db: fa.db,
        fa: Object.assign({}, fa, { functions: fa._functions }),
        doc: fs.doc, getDoc: fs.getDoc, setDoc: fs.setDoc,
        updateDoc: fs.updateDoc, deleteDoc: fs.deleteDoc,
        collection: fs.collection, query: fs.query,
        where: fs.where, getDocs: fs.getDocs,
        orderBy: fs.orderBy, onSnapshot: fs.onSnapshot,
        serverTimestamp: fs.serverTimestamp,
        // deleteField hace falta para RETIRAR un nodo de un mapa (el cuadrante
        // de un equipo, la marca de asistencia de un jugador). Sin él sólo se
        // puede escribir null encima, que NO es lo mismo: el nodo sigue ahí y
        // los recuentos lo siguen viendo.
        deleteField: fs.deleteField,
        httpsCallable: fnMod.httpsCallable,
    };
};

window.saGet = async function saGet(col, id) {
    try {
        const { db, doc, getDoc } = await saFS();
        const s = await getDoc(doc(db, col, id));
        return s.exists() ? { id: s.id, ...s.data() } : null;
    } catch (e) { console.warn('[saGet]', e.message); return null; }
};

// ═══════════════════════════════════════════════════════════════════
// openSuperAdminPanel()
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// saGoBackToRoles() — volver al selector de roles desde cualquier panel
// ═══════════════════════════════════════════════════════════════════
window.saGoBackToRoles = function saGoBackToRoles() {
    // Cerrar panel SA
    const saPanel = document.getElementById('sa-panel');
    if (saPanel) saPanel.remove();
    // Cerrar panel Individual Admin
    const indPanel = document.getElementById('ind-panel');
    if (indPanel) indPanel.remove();
    // Cerrar modal de club admin si está abierto
    const modal = document.getElementById('setup-modal');
    if (modal) modal.style.display = 'none';
    // Ocultar paneles de campo
    const mainH = document.getElementById('main-header');
    if (mainH) mainH.style.display = 'none';
    const mainC = document.getElementById('main-container');
    if (mainC) mainC.style.display = 'none';
    // Restaurar body
    document.body.style.background = '#0d1117';
    document.body.classList.remove('locked');
    // Mostrar selector de roles (compatible con ambos nombres)
    // OJO: showRoleSelection vive en el ámbito de un módulo ES (auth.js) y NO
    // cuelga de window, así que desde este script clásico su `typeof` era
    // siempre 'undefined' y esta rama estaba muerta. Funcionaba de casualidad
    // por la reserva de abajo. Se deja sólo el alias, que sí está publicado.
    if (typeof window.showRoleSelector === 'function') window.showRoleSelector();
};

window.openSuperAdminPanel = async function openSuperAdminPanel() {
    // Pila de navegación (js/core/nav-stack.js): RAÍZ del panel SuperAdmin.
    // ⚠️ TIENE QUE SER LA PRIMERA SENTENCIA, antes de cualquier `await`. Esta
    // función es async, y navBack limpia su flag de restauración en cuanto
    // f.apply() DEVUELVE — o sea al primer await, no al terminar el cuerpo.
    // Un navRootScreen/navScreen colocado después de un await se ejecutaría
    // con el flag ya limpio y volvería a apilar la pantalla que se está
    // restaurando, dejando el "Volver" en bucle. Lo fija la PARTE 8 del guard.
    //
    // La SALIDA de este panel no es navExit(): es su propio botón "⏻ Salir"
    // (cerrarSesion), porque el panel vive en su overlay #sa-panel y no en
    // #setup-modal. navExit() sólo cierra el contenedor modal.
    if (typeof navRootScreen === 'function') navRootScreen('openSuperAdminPanel');

    ['main-header','role-selection-screen','install-screen','auth-screen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const main = document.getElementById('app-main') || document.querySelector('main');
    if (main) main.style.display = 'none';
    const setupModal = document.getElementById('setup-modal');
    if (setupModal) setupModal.style.display = 'none';

    // Contar pendientes para badge (mismas fuentes que el panel Solicitudes)
    // v641 · Se guarda en `window._saPendingCount` porque ahora el aviso lo
    // pinta la TARJETA del tablero, que se repinta cada vez que se vuelve al
    // menú y en cuanto el oyente de solicitudes trae un número nuevo.
    let pendingCount = 0;
    try { pendingCount = await window.saCountPendingRequests(); } catch (_) {}
    window._saPendingCount = pendingCount;

    const old = document.getElementById('sa-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'sa-panel';
    panel.style.cssText = 'position:fixed;inset:0;background:#0d1117;z-index:9500;display:flex;flex-direction:column;overflow:hidden;font-family:Inter,sans-serif;';
    // ════════════════════════════════════════════════════════════════
    //  🎛️ v641 · EL PANEL DEL SUPERADMIN, CON EL MISMO MARCO QUE LOS DEMÁS
    //
    //  Encargo del autor (implementar.txt, 2026-08-28): «rediseña la vista del
    //  SuperAdmin para que coincida con el estilo visual, botones, tarjetas,
    //  modales y jerarquía tipográfica de los paneles de Director Deportivo,
    //  Coordinador y Entrenador».
    //
    //  🔑 NO SE INVENTA UN ESTILO NUEVO: se adopta el que ya existe. La
    //  cabecera es la del panel de Dirección (club-reports.js) hasta el
    //  gradiente y los tamaños; la barra de vuelta es la MISMA pieza de texto
    //  que usan Dirección (v591) y Admin de Club (v597); y el tablero de
    //  entrada es `cronosTableroHtml` (utils.js), la pieza compartida de v590.
    //  Copiar el aspecto a mano habría creado una cuarta variante que se iría
    //  separando al primer retoque — la historia de este proyecto.
    //
    //  🔴 FUERA LA BARRA DE PESTAÑAS. Eran diez botones subrayados sin decir
    //  qué hacía ninguno, y el estado activo vivía en un `borderBottomColor`
    //  que TRES sitios leían del DOM para saber en qué pestaña estabas. Ahora
    //  la sección activa es un dato (`window._saSeccionActual`) y el aspecto
    //  no la codifica.
    //
    //  ⚠️ EL OVERLAY SE QUEDA A PANTALLA COMPLETA (`position:fixed;inset:0`,
    //  z-index 9500): no es estética, es lo que el modo diagnóstico quita del
    //  DOM al entrar (v629) y lo que deja sitio a las tablas anchas de clubes.
    //  Lo que se homogeneiza es lo de DENTRO.
    // ════════════════════════════════════════════════════════════════
    panel.innerHTML = `
<style>
  /* La misma jerarquía tipográfica del panel de Dirección y del de Club. */
  #sa-panel .sap-head { display:flex;justify-content:space-between;align-items:center;
      padding:1.2rem 1.5rem;background:linear-gradient(to right,#161b22,#0d1117);
      border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;flex-wrap:wrap;gap:0.6rem; }
  #sa-panel .sap-title { margin:0;font-size:1.15rem;font-weight:700;color:white;
      display:flex;align-items:center;gap:0.7rem;font-family:'Outfit',Inter,sans-serif; }
  #sa-panel .sap-sub { font-size:0.72rem;color:#8b949e;margin-top:0.2rem; }
  #sa-panel .sap-btn { border-radius:6px;padding:0.35rem 0.8rem;font-size:0.74rem;
      font-weight:700;cursor:pointer;white-space:nowrap; }
  /* La barra de vuelta, gemela de #staff-navbar (v591) y #ca-navbar (v597):
     sólo se ve cuando NO estás en el tablero. */
  #sa-navbar { display:none;gap:0.6rem;align-items:center;padding:0.55rem 1.5rem;
      background:#161b22;border-bottom:1px solid rgba(255,255,255,0.1);
      flex-shrink:0;flex-wrap:wrap; }
  /* 🔑 EL ANCHO ÚTIL, EL MISMO QUE EL DE LOS DEMÁS PANELES (.sa-modal son
     1060px). Éste es el único de los cuatro que vive en un overlay a pantalla
     completa, así que sin esto sus listas se estiraban a 1900px en un monitor
     y no se parecían a nada — se ve en las capturas 9705-9707. El padding
     lateral se calcula, en vez de envolver el contenido en un div, porque cada
     sección escribe DIRECTAMENTE el innerHTML de #sa-body: un envoltorio lo
     borraría la primera que pintase (la misma trampa que la barra de v591).
     La funcion max() de CSS deja 1.5rem de margen en movil, donde no sobra
     ancho.
     ⚠️ SIN ACENTOS GRAVES AQUI DENTRO: esto vive en una plantilla literal y
     uno solo la cierra en seco. Lo pago la v641 al primer intento — el panel
     entero se quedo en negro con "Unexpected identifier 'max'", y es
     exactamente el aviso que club-reports.js lleva escrito desde la v590. */
  #sa-panel .sap-head,
  #sa-panel #sa-navbar { padding-left:max(1.5rem, calc(50% - 530px));
      padding-right:max(1.5rem, calc(50% - 530px)); }
  #sa-panel #sa-body { padding:1.5rem max(1.5rem, calc(50% - 530px)); }
</style>
<div class="sap-head">
    <div>
        <h2 class="sap-title">👑 SuperAdmin</h2>
        <div class="sap-sub">Chronos Fútbol · Control Total</div>
    </div>
    <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
        <button onclick="if(typeof saTab==='function')saTab(window._saSeccionActual||'menu');"
            class="sap-btn" title="Recargar la sección actual"
            style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#8b949e;font-weight:600;">🔄 Recargar</button>
        <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();else if(typeof logoutUser==='function')logoutUser();"
            class="sap-btn"
            style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);color:#ff5858;">⏻ Salir</button>
    </div>
</div>
<div id="sa-navbar"></div>
<div id="sa-body" style="flex:1;overflow-y:auto;padding:1.5rem;-webkit-overflow-scrolling:touch;"></div>`;
    document.body.appendChild(panel);
    saTab('menu');
    setupClubsSyncListener();

    // 🔔 v644 · AVISOS PUSH. Se arranca AQUÍ y no en el arranque de la app
    //  por dos motivos: es el único sitio donde ya se sabe con certeza que
    //  quien mira es el SuperAdmin, y es donde hay una cabecera en la que
    //  colgar el botón 🔔 que pide el permiso — que Safari e iOS sólo
    //  atienden si sale de un clic de verdad.
    //  ⚠️ NUNCA con `await`: si el alta se atasca (red, permiso, service
    //  worker), el panel tiene que estar ya montado y utilizable. Un aviso
    //  que no llega es un incordio; un panel que no abre deja la
    //  plataforma sin nadie que apruebe altas.
    if (typeof window.cronosPushArrancar === 'function') {
        window.cronosPushArrancar();
    }
};

// ═══════════════════════════════════════════════════════════════════
//  🎛️ v641 · EL TABLERO DE ENTRADA DEL SUPERADMIN
//
//  Las mismas ocho puertas que había en la barra de pestañas, pero cada una
//  DICE para qué sirve. El aspecto lo pone `cronosTableroHtml` (utils.js),
//  compartido con Dirección, Coordinación, Club, Ente y Familias.
//
//  ⚠️ RESPALDO SIN EL HELPER: si utils.js no cargó, el panel NO se queda en
//  blanco — se cae a la vista de Clubes, que es la de trabajo diario. Un menú
//  que no pinta dejaría al SuperAdmin sin panel, y éste es el único sitio
//  desde el que se aprueban altas.
// ═══════════════════════════════════════════════════════════════════
window.SA_SECCIONES = {
    clubs:       '🏟️ Clubes',
    individuals: '👤 Entes Individuales',
    requests:    '📋 Solicitudes',
    secretary:   '✉️ Secretaría',
    billing:     '💳 Facturación',
    extras:      '⚙️ Extras',
    messages:    '💬 Mensajes',
    diagnostico: '🩺 Diagnóstico',
};

window.saMenu = function saMenu() {
    const body = document.getElementById('sa-body');
    if (!body) return;
    const _pend = Number(window._saPendingCount || 0);
    const opciones = [
        { icono: '🏟️', titulo: 'Clubes', color: '#58a6ff',
          desc: 'Altas y bajas de clubes, plazas por rol, planes y todo su personal.',
          onclick: "saTab('clubs')" },
        { icono: '👤', titulo: 'Entes Individuales', color: '#3fb950',
          desc: 'Entrenadores y familias que trabajan fuera de un club.',
          onclick: "saTab('individuals')" },
        // 🔴 El aviso es una PÍLDORA, no un número pegado al título (v598): así
        //    se ve desde el tablero sin tener que entrar a mirar.
        { icono: '📋', titulo: 'Solicitudes', color: '#f0883e',
          badge: _pend,
          desc: _pend
              ? 'Tienes ' + _pend + ' solicitud(es) esperando tu aprobación.'
              : 'Altas de usuarios y clubes pendientes de aprobar.',
          onclick: "saTab('requests')" },
        { icono: '✉️', titulo: 'Secretaría', color: '#31d0aa',
          desc: 'Invita por correo a clubes, entrenadores, coordinadores o familias.',
          onclick: "saTab('secretary')" },
        { icono: '💳', titulo: 'Facturación', color: '#ffd700',
          desc: 'Planes contratados, cobros y estado de pago de cada club.',
          onclick: "saTab('billing')" },
        { icono: '⚙️', titulo: 'Extras', color: '#d2a8ff',
          desc: 'Activa o desactiva funciones por club, y herramientas de limpieza.',
          onclick: "saTab('extras')" },
        { icono: '💬', titulo: 'Mensajes', color: '#b478c8',
          desc: 'Canales internos con los administradores de clubes y entes.',
          onclick: "saTab('messages')" },
        // 🩺 Va la ÚLTIMA a propósito, como iba la pestaña: es la puerta más
        //    delicada del panel y no debe quedar pegada a la de uso diario.
        { icono: '🩺', titulo: 'Diagnóstico', color: '#8b949e',
          desc: 'Entra en el panel de cualquier usuario, en modo sólo lectura.',
          onclick: "saTab('diagnostico')" },
    ];
    body.innerHTML = (typeof window.cronosTableroHtml === 'function')
        ? window.cronosTableroHtml({
            titulo: '👑 Panel del SuperAdmin',
            subtitulo: 'Elige qué quieres gestionar:',
            opciones: opciones,
          })
        : '';
    if (!body.innerHTML) { saTab('clubs'); return; }
    body.scrollTop = 0;
};

// ═══════════════════════════════════════════════════════════════════
// saTab()
// ═══════════════════════════════════════════════════════════════════

window.saTab = function saTab(tab) {
    // Pila de navegación (js/core/nav-stack.js). Se registra CON la pestaña,
    // así que volver desde una subpantalla devuelve a la pestaña EXACTA desde
    // la que se entró, no a una fija.
    //
    // 🔑 Las pestañas son HERMANAS, no niveles: cambiar de pestaña NO debe
    // apilar. Sale gratis — navScreen reemplaza los argumentos cuando la
    // función del tope es la misma, y todas las pestañas son `saTab`. Así la
    // pila queda [openSuperAdminPanel, saTab(actual), subpantalla…] y "Volver"
    // no recorre hacia atrás ocho clics de pestaña.
    if (typeof navScreen === 'function') navScreen('saTab', tab);

    // ══════════════════════════════════════════════════════════════════
    //  🔴 v641 · LA SECCIÓN ACTIVA ES UN DATO, NO UN COLOR DE BORDE
    //
    //  Hasta aquí, "¿en qué pestaña está el SuperAdmin?" se respondía buscando
    //  el botón de esa pestaña por id y comparando su `borderBottomColor` con
    //  'rgb(88, 166, 255)', desde TRES sitios distintos (clubs-tab.js dos
    //  veces, esta misma función una). Con la barra de pestañas retirada eso se
    //  quedaría sin respuesta para siempre y en silencio: `getElementById`
    //  devuelve null, la comparación da false y el refresco automático se iría
    //  siempre a Clubes sin que nada avisara.
    //
    //  ⚠️ El guard 4o de test_tablero_paneles_e_invitaciones.js prohíbe por
    //  FORMA que vuelva a aparecer un id de pestaña en estos dos ficheros.
    //
    //  🔑 Se guarda ANTES de pintar, para que cualquier repintado disparado
    //  desde dentro de la sección lea ya el valor nuevo.
    // ══════════════════════════════════════════════════════════════════
    // 🗑️ v641 · 'trash' (la pestaña "Rastros") se retiró por encargo del autor.
    //    Una llamada superviviente cae al tablero en vez de dejar el cuerpo en
    //    blanco — que es como se vería un `else if` que no casa con nada.
    if (!tab || tab === 'trash' || (tab !== 'menu' && !window.SA_SECCIONES[tab])) tab = 'menu';
    window._saSeccionActual = tab;

    // La barra de vuelta: gemela de la de Dirección (v591) y la de Club (v597).
    const _nav = document.getElementById('sa-navbar');
    if (_nav) {
        if (tab === 'menu') {
            _nav.style.display = 'none';
            _nav.innerHTML = '';
        } else {
            _nav.style.display = 'flex';
            _nav.innerHTML =
                '<button onclick="saTab(\'menu\')" ' +
                'style="display:inline-flex;align-items:center;gap:0.4rem;' +
                       'padding:0.42rem 0.9rem;border-radius:8px;cursor:pointer;' +
                       'background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.4);' +
                       'color:#58a6ff;font-size:0.8rem;font-weight:800;">' +
                '← Volver al Menú</button>' +
                '<span style="font-size:0.9rem;font-weight:800;color:white;">' +
                (window.SA_SECCIONES[tab] || '') + '</span>';
        }
    }

    if      (tab==='menu')        saMenu();
    else if (tab==='clubs')       saClubs();
    else if (tab==='individuals') saIndividuals();
    else if (tab==='requests')    saRequests();
    else if (tab==='secretary')   saSecretary();
    else if (tab==='billing')     saBilling();
    else if (tab==='extras')      saExtras();
    else if (tab==='messages')    saMessages();
    // 🩺 v628 · js/admin/superadmin/diagnostico.js. Con guarda `typeof`
    // como el resto: si el fichero no cargó, se dice POR QUE en vez de
    // dejar la pestana muda (la doctrina de v598).
    else if (tab==='diagnostico') {
        if (typeof window.saDiagnostico === 'function') window.saDiagnostico();
        else {
            const _b = document.getElementById('sa-body');
            if (_b) _b.innerHTML = '<div style="text-align:center;padding:3rem;color:#ff5858;">'+
                '⚠️ El modulo de Diagnostico no esta disponible. Recarga el panel.</div>';
        }
    }
};

// ═══════════════════════════════════════════════════════════════════
// saClubs() — Pestaña de clubes
// Extraída a js/admin/superadmin/clubs-tab.js (auditoría 2026-07-22, 2026-07-26).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// PESTAÑA INDIVIDUALES (saIndividuals / saActivateIndividual / saAssignOrphanToEntity)
// Extraídas a js/admin/superadmin/individuals-tab.js (auditoría 2026-07-22, 2026-07-25).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// saSecretary() Y ENVÍO DE INVITACIONES (Secretaría)
// Extraídas a js/admin/superadmin/secretary.js (auditoría 2026-07-22, 2026-07-25).
// ═══════════════════════════════════════════════════════════════════

// saQuickApprove() — aprobación rápida desde la vista de clubes
// Extraída a js/admin/superadmin/clubs-tab.js (auditoría 2026-07-22, 2026-07-26).

// ═══════════════════════════════════════════════════════════════════
// SOLICITUDES / APROBACIÓN
// (saCountPendingRequests / saRequests / saApproveRequest)
// Extraídas a js/admin/superadmin/requests-tab.js (auditoría 2026-07-22, 2026-07-26).
// OJO: requests-tab.js debe cargarse DESPUÉS de app-init.js y ANTES de
// extras.js — ver la cabecera de ese archivo para el porqué.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// saSetClubUserStatus()
// ═══════════════════════════════════════════════════════════════════

window.saSetClubUserStatus = async function saSetClubUserStatus(uid, email, newStatus, clubId) {
    var stLabels = {active:'activar',blocked:'bloquear',removed:'dar de baja'};
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    //  \ud83d\udcdd v628 \u00b7 BLOQUEAR Y DAR DE BAJA EXIGEN MOTIVO
    //
    //  Encargo del autor: \u00abel sistema debe requerir o permitir justificar el
    //  motivo de la baja, guardando un registro del motivo\u00bb. Se ha elegido
    //  REQUERIRLO, no permitirlo: un motivo opcional no se escribe nunca, y
    //  la baja es la \u00fanica acci\u00f3n irreversible del panel.
    //
    //  \u26a0\ufe0f REACTIVAR NO PIDE MOTIVO. Devolver el acceso a alguien no necesita
    //  justificarse; quit\u00e1rselo, s\u00ed. Por eso el `confirm` de siempre se queda
    //  para 'active' en vez de mandarlo todo por el mismo sitio.
    //
    //  El di\u00e1logo vive en js/admin/superadmin/diagnostico.js. Si ese fichero
    //  no carg\u00f3 NO se sigue a ciegas: se avisa y se para. Dar de baja sin
    //  registro es justo lo que se ha venido a evitar.
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    var _motivo = null;
    if (newStatus === 'blocked' || newStatus === 'removed') {
        if (typeof window._saPedirMotivo !== 'function') {
            alert('\u26a0\ufe0f El m\u00f3dulo de motivos no est\u00e1 cargado.\n\n' +
                  'No se puede dar de baja ni bloquear sin dejar registro. Recarga el panel.');
            return;
        }
        _motivo = await window._saPedirMotivo(email, newStatus);
        if (!_motivo) return;                 // cancelado en el di\u00e1logo
    } else if (!confirm('\u00bf' + (stLabels[newStatus]||newStatus) + ' a ' + email + '?')) {
        return;
    }
    _saShowSpinner('Procesando\u2026');
    // Detect active tab for correct refresh after operation
    // v641 · Se lee el DATO (`window._saSeccionActual`), no el color del borde
    // de un botón que ya no existe. Ver la nota larga en saTab().
    var _activeTab = (window._saSeccionActual === 'individuals') ? 'individuals' : 'clubs';
    try {
        // 🔴 v641 · EL OBJETO DE FIRESTORE SE GUARDA ENTERO, NO SÓLO LOS ALIAS
        //  QUE USA ESTA FUNCIÓN. El registro del motivo (más abajo) se lo pasa
        //  a `_saRegistrarMotivo`, y aquél escribe en `sa_privado` con `setDoc`
        //  y limpia la raíz con `deleteField`. Reconstruir a mano un objeto con
        //  cuatro alias —lo que hacía la v628— dejaba fuera justo esos dos, y
        //  la baja moría con «fsh.setDoc is not a function» ANTES de borrar
        //  nada (capturas 9705-9709 del 2026-08-28). Es el mismo defecto que la
        //  v636 pagó con `fSetDoc`: un inventario copiado a mano se queda corto
        //  en cuanto el destinatario necesita un alias más.
        const _FSSA = await saFS();
        const { db, fa, doc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, setDoc, httpsCallable } = _FSSA;
        const uSnap = await getDoc(doc(db,'users',uid));
        const uData = uSnap.exists() ? uSnap.data() : {};
        const realUid = uData.uid || uid;
        const realEmail = uData.email || email;

        // 📝 v628 · EL MOTIVO SE ESCRIBE ANTES DE TOCAR EL ESTADO.
        //  El camino de la baja definitiva BORRA el documento del usuario
        //  (`deleteDoc` más abajo). Registrar después sería registrar sobre algo
        //  que ya no existe — por eso el motivo va también al documento del
        //  propio SuperAdmin, que sobrevive a la baja (ver diagnostico.js).
        //  ⚠️ Si el registro falla, NO se sigue: es preferible no ejecutar la
        //  baja a ejecutarla sin dejar rastro de por qué.
        if (_motivo) {
            try {
                await window._saRegistrarMotivo(
                    _FSSA,
                    uid, realEmail, newStatus, clubId, _motivo, uData);
            } catch (regErr) {
                _saHideSpinner();
                alert('⛔ No se ha podido guardar el motivo, así que la operación se cancela.\n\n' +
                      (regErr && regErr.message ? regErr.message : regErr));
                return;
            }
        }
        // FIX: Detect if this is an individual entity user for entity cleanup
        const _isIndividualUser = uData.role === 'individual' || uData.role === 'admin_individual'
            || uData.role === 'entrenador_individual' || uData.role === 'parent_individual'
            || !!(uData.individualEntityId || uData.individualOwnerId)
            || (uData.allRoles||[]).some(r => ['individual','admin_individual','entrenador_individual','parent_individual'].includes(r.role)
                || r.individualEntityId);
        const _entityId = uData.individualEntityId || uData.clubId || clubId || null;
        const _isIndividualAdmin = uData.role === 'individual' || uData.role === 'admin_individual'
            || (uData.allRoles||[]).some(r => (r.role === 'individual' || r.role === 'admin_individual') && r.isAuthorized);

        if (newStatus === 'removed') {
            // ═══════════════════════════════════════════════════════════
            // BAJA DEFINITIVA — Eliminar TODOS los rastros
            // ═══════════════════════════════════════════════════════════

            // 1. Leer documento primario para obtener todos los roles
            var primarySnap = (realUid !== uid)
                ? await getDoc(doc(db, 'users', realUid)).catch(function() { return null; })
                : uSnap;
            var allRoles = [];
            if (primarySnap && primarySnap.exists()) {
                allRoles = primarySnap.data().allRoles || [];
            } else if (uData.allRoles) {
                allRoles = uData.allRoles;
            }

            // ── Determinar alcance del borrado (multi-rol) ──────────────
            var rolesRemovidos = allRoles.filter(function(r) {
                var sameScope = String(r.clubId || r.individualEntityId || '') === String(clubId || '');
                return sameScope;
            });
            var rolesRestantes = allRoles.filter(function(r) {
                var sameScope = String(r.clubId || r.individualEntityId || '') === String(clubId || '');
                return !sameScope;
            });
            var _shouldDeleteAuth = rolesRestantes.length === 0;

            // ── CAMINO A: quitar SOLO los roles de este club (conservar cuenta + otros roles)
            if (rolesRestantes.length > 0) {
                // A1. Liberar slots en el club
                var _sk = function(role) {
                    if (role === 'director') return 'usedSlots.directors';
                    if (role === 'coordinator') return 'usedSlots.coordinators';
                    if (role === 'parent') return 'usedSlots.parents';
                    return 'usedSlots.users';
                };
                for (var ri = 0; ri < rolesRemovidos.length; ri++) {
                    var rcid = rolesRemovidos[ri].clubId || clubId;
                    if (rcid) {
                        var rk = _sk(rolesRemovidos[ri].role);
                        try {
                            var cs = await getDoc(doc(db, 'clubs', rcid));
                            if (cs.exists()) {
                                var sub = rk.split('.')[1];
                                var cur = ((cs.data().usedSlots || {})[sub]) || 1;
                                var upd = {}; upd[rk] = Math.max(0, cur - 1);
                                await updateDoc(doc(db, 'clubs', rcid), upd);
                            }
                        } catch (_) {}
                    }
                }
                // A2. Quitar roles de allRoles del doc primario (NO borrar el doc)
                try {
                    await updateDoc(doc(db, 'users', realUid), { allRoles: rolesRestantes });
                } catch (_) {}
                // A3. Eliminar docs secundarios
                for (var si2 = 0; si2 < rolesRemovidos.length; si2++) {
                    var secId = realUid + '_' + rolesRemovidos[si2].role + '_' + (rolesRemovidos[si2].clubId || 'global');
                    if (secId !== realUid) {
                        try { await deleteDoc(doc(db, 'users', secId)); } catch (_) {}
                    }
                }
                // Si el documento clickeado era secundario, eliminarlo
                if (uid !== realUid) {
                    try { await deleteDoc(doc(db, 'users', uid)); } catch (_) {}
                }
                // A4. Eliminar enlaces de jugador (solo si eliminamos el rol de 'parent')
                var tieneParentRemovido = rolesRemovidos.some(function(r) { return r.role === 'parent'; });
                if (tieneParentRemovido) {
                    try {
                        var linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('parentUid', '==', realUid)));
                        var linksArr = []; linksSnap.forEach(function(ld) { linksArr.push(ld); });
                        for (var li = 0; li < linksArr.length; li++) {
                            try { await deleteDoc(doc(db, 'cronos_player_links', linksArr[li].id)); } catch (_) {}
                        }
                    } catch (_) {}
                    try {
                        var linksSnap2 = await getDocs(query(collection(db, 'cronos_player_links'), where('parentEmail', '==', realEmail)));
                        var linksArr2 = []; linksSnap2.forEach(function(ld) { linksArr2.push(ld); });
                        for (var li2 = 0; li2 < linksArr2.length; li2++) {
                            try { await deleteDoc(doc(db, 'cronos_player_links', linksArr2[li2].id)); } catch (_) {}
                        }
                    } catch (_) {}
                }

                _saToast('➖ Usuario removido de este club. Conserva sus roles en otros clubes.', 4000);
                setTimeout(function() { openSuperAdminPanel(); }, 1200);
                return;
            }

            // ── CAMINO B: borrado TOTAL del usuario ──────
            // 2. Actualizar slots del club para CADA rol
            var _sk = function(role) {
                if (role === 'director') return 'usedSlots.directors';
                if (role === 'coordinator') return 'usedSlots.coordinators';
                if (role === 'parent') return 'usedSlots.parents';
                return 'usedSlots.users';
            };
            for (var ri = 0; ri < allRoles.length; ri++) {
                var rcid = allRoles[ri].clubId || clubId;
                if (rcid) {
                    var rk = _sk(allRoles[ri].role);
                    try {
                        var cs = await getDoc(doc(db, 'clubs', rcid));
                        if (cs.exists()) {
                            var sub = rk.split('.')[1];
                            var cur = ((cs.data().usedSlots || {})[sub]) || 1;
                            var upd = {}; upd[rk] = Math.max(0, cur - 1);
                            await updateDoc(doc(db, 'clubs', rcid), upd);
                        }
                    } catch (_) {}
                }
            }

            // 3. Eliminar cuenta de Firebase Auth ANTES de borrar docs
            if (_shouldDeleteAuth && httpsCallable && fa.functions) {
                try {
                    await httpsCallable(fa.functions,'deleteAuthUser')({uid:realUid,email:realEmail});
                } catch(cfErr) {
                    console.warn('[saSetClubUserStatus] deleteAuthUser:', cfErr && cfErr.code, cfErr && cfErr.message);
                    var codeB = (cfErr.details && cfErr.details.code) || cfErr.code || '';
                    if (codeB !== 'auth/user-not-found') {
                        try {
                            var _meSA = window._cronosCurrentUser || {};
                            await setDoc(doc(db, 'auth_deletion_failures', realUid + '_' + Date.now()), {
                                uid: realUid, email: realEmail, clubId: clubId || null,
                                errorCode: codeB || null,
                                errorMessage: (cfErr && cfErr.message) || String(cfErr),
                                requestedBy: _meSA.uid || null, requestedByEmail: _meSA.email || null,
                                createdAt: new Date().toISOString()
                            });
                        } catch(_) {}
                        _saToast('⚠️ Email no liberado en Auth (pendiente revisión), pero se han eliminado los datos del usuario.', 6000);
                    }
                }
            }

            // 4. Eliminar documentos secundarios
            for (var si2 = 0; si2 < allRoles.length; si2++) {
                var secId = realUid + '_' + allRoles[si2].role + '_' + (allRoles[si2].clubId || 'global');
                if (secId !== realUid) {
                    try { await deleteDoc(doc(db, 'users', secId)); } catch (_) {}
                }
            }

            // 4. Eliminar documento primario
            try { await deleteDoc(doc(db, 'users', realUid)); } catch (_) {}
            if (uid !== realUid) {
                try { await deleteDoc(doc(db, 'users', uid)); } catch (_) {}
            }

            // 5. Eliminar enlaces de jugador
            try {
                var linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('parentUid', '==', realUid)));
                var linksArr = []; linksSnap.forEach(function(ld) { linksArr.push(ld); });
                for (var li = 0; li < linksArr.length; li++) {
                    try { await deleteDoc(doc(db, 'cronos_player_links', linksArr[li].id)); } catch (_) {}
                }
            } catch (_) {}
            try {
                var linksSnap2 = await getDocs(query(collection(db, 'cronos_player_links'), where('parentEmail', '==', realEmail)));
                var linksArr2 = []; linksSnap2.forEach(function(ld) { linksArr2.push(ld); });
                for (var li2 = 0; li2 < linksArr2.length; li2++) {
                    try { await deleteDoc(doc(db, 'cronos_player_links', linksArr2[li2].id)); } catch (_) {}
                }
            } catch (_) {}

            // 6. Eliminar platform_requests de este usuario
            try {
                var prSnaps = await getDocs(query(collection(db, 'platform_requests'), where('userUid', '==', realUid)));
                var prArr = []; prSnaps.forEach(function(pd) { prArr.push(pd); });
                for (var pi = 0; pi < prArr.length; pi++) {
                    try { await deleteDoc(doc(db, 'platform_requests', prArr[pi].id)); } catch (_) {}
                }
            } catch (_) {}
            try {
                var prSnaps2 = await getDocs(query(collection(db, 'platform_requests'), where('requestedEmail', '==', realEmail)));
                var prArr2 = []; prSnaps2.forEach(function(pd) { prArr2.push(pd); });
                for (var pi2 = 0; pi2 < prArr2.length; pi2++) {
                    try { await deleteDoc(doc(db, 'platform_requests', prArr2[pi2].id)); } catch (_) {}
                }
            } catch (_) {}

            // 8. FIX: Si era admin individual, actualizar la entidad individual
            if (_isIndividualAdmin && _entityId) {
                try {
                    var entSnap = await getDoc(doc(db, 'clubs', _entityId));
                    if (entSnap.exists() && entSnap.data().type === 'individual') {
                        // Verificar si quedan otros admins individuales en la entidad
                        var remainingAdmins = await getDocs(query(collection(db, 'users'),
                            where('individualEntityId', '==', _entityId),
                            where('role', 'in', ['individual', 'admin_individual'])
                        )).catch(() => ({forEach:()=>{}}));
                        var _hasOtherAdmin = false;
                        remainingAdmins.forEach(function(d) {
                            if (d.id !== realUid && d.data().status !== 'removed') _hasOtherAdmin = true;
                        });
                        if (!_hasOtherAdmin) {
                            await updateDoc(doc(db, 'clubs', _entityId), {
                                hasAdmin: false,
                                adminUid: null,
                                adminEmail: null,
                                adminName: null,
                            });
                        }
                    }
                } catch(entErr) { console.warn('[saSetClubUserStatus] Error limpiando entidad individual:', entErr.message); }
            }

            _saHideSpinner();
            _saToast('\uD83D\uDDD1\uFE0F ' + email + ' dado de baja. Todos los rastros eliminados.', 4000);
        } else {
            // ═══════════════════════════════════════════════════════════
            // ACTIVAR / BLOQUEAR
            // ═══════════════════════════════════════════════════════════
            var role = uData.role || 'user';
            var sk = _sk(role);
            var isActive = (newStatus === 'active');
            await updateDoc(doc(db,'users',uid),{isAuthorized:isActive,status:newStatus});
            if (isActive) {
                await updateDoc(doc(db,'users',uid),{authorizedAt:new Date().toISOString()});
                // FIX CRÍTICO: Si se está activando un admin individual, actualizar hasAdmin en la entidad
                if (_isIndividualAdmin && _entityId) {
                    try {
                        await updateDoc(doc(db, 'clubs', _entityId), {
                            hasAdmin: true,
                            adminUid: uid,
                            adminEmail: uData.email || email,
                            adminName: uData.displayName || uData.firstName || email,
                        });
                    } catch(entErr2) {
                        console.warn('[saSetClubUserStatus] Error setting hasAdmin:', entErr2.message);
                    }
                }
            } else {
                await updateDoc(doc(db,'users',uid),{blockedAt:new Date().toISOString()});
                // FIX: Si se está bloqueando un admin individual, verificar si quedan otros admins
                if (_isIndividualAdmin && _entityId) {
                    try {
                        var remainingAdminsBlock = await getDocs(query(collection(db, 'users'),
                            where('individualEntityId', '==', _entityId),
                            where('role', 'in', ['individual', 'admin_individual'])
                        )).catch(() => ({forEach:()=>{}}));
                        var _hasOtherAdminBlock = false;
                        remainingAdminsBlock.forEach(function(d) {
                            if (d.id !== uid && d.data().status === 'active' && d.data().isAuthorized) _hasOtherAdminBlock = true;
                        });
                        if (!_hasOtherAdminBlock) {
                            await updateDoc(doc(db, 'clubs', _entityId), {
                                hasAdmin: false,
                                adminUid: null,
                                adminEmail: null,
                                adminName: null,
                            });
                        }
                    } catch(entErr3) {
                        console.warn('[saSetClubUserStatus] Error updating hasAdmin on block:', entErr3.message);
                    }
                }
            }
            if (clubId) {
                var cs2 = await getDoc(doc(db,'clubs',clubId)).catch(function() { return null; });
                if (cs2 && cs2.exists()) {
                    var sub2 = sk.split('.')[1];
                    var cur2 = ((cs2.data().usedSlots||{})[sub2])||0;
                    var upd2 = {}; upd2[sk] = Math.max(0, cur2 + (isActive ? 1 : -1));
                    await updateDoc(doc(db,'clubs',clubId), upd2).catch(function() {});
                }
            }
            _saHideSpinner();
            _saToast(isActive ? ('\u2705 ' + email + ' activado') : ('\uD83D\uDD12 ' + email + ' bloqueado'), 3000);
        }
        if (_activeTab === 'individuals') saIndividuals(); else saClubs();
    } catch (e) { _saHideSpinner(); _saToast('\u26A0\uFE0F '+e.message,5000); console.error(e); }
};

// ═══════════════════════════════════════════════════════════════════
// 🗑️ v641 · LA PESTAÑA "RASTROS" YA NO EXISTE.
// saTrash() / saReactivateAsIndividual() / saPurgeUser() vivían en
// js/admin/superadmin/trash.js, retirado por encargo del autor
// (implementar.txt, 2026-08-28) junto con su script en index.html, su entrada
// en el precache del service worker y su test dedicado. No quedan llamadores:
// la reactivación de un usuario bloqueado sigue estando en Clubes
// (saSetClubUserStatus con 'active') y la limpieza de remanentes, en Extras.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// setupClubsSyncListener()
// Extraída a js/admin/superadmin/clubs-tab.js (auditoría 2026-07-22, 2026-07-26).
// ═══════════════════════════════════════════════════════════════════



// saDeleteClubComplete()
// Extraída a js/admin/superadmin/delete-club.js (auditoría 2026-07-22, 2026-07-24).


// ═══════════════════════════════════════════════════════════════════
// CREAR ENTE INDIVIDUAL / GESTIONAR USUARIOS DEL ENTE
// Extraídas a js/admin/superadmin/individual-entity.js (auditoría 2026-07-22, 2026-07-25).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// CREAR CLUB / USUARIO INDIVIDUAL directamente desde SA
// Extraídas a js/admin/superadmin/create-direct.js (auditoría 2026-07-22, 2026-07-24).
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// EDITAR SLOTS Y PLAN DE UN CLUB
// Extraídas a js/admin/superadmin/club-slots.js (auditoría 2026-07-22, 2026-07-24).
// ═══════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// saExtras() / saSaveExtras() — Gestión de Extras de la aplicación por club
// Extraídas a js/admin/superadmin/extras-toggle.js (auditoría 2026-07-22, 2026-07-24).
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// SISTEMA DE MENSAJERÍA PARA SUPER ADMINISTRADOR
// (saEscapeHtml / saEscapeAttr / saMessages / saUpdateCount /
//  saSendMessages / saOpenThread / saSendReply / saDeleteSingleMessage /
//  saDeleteAllMessages)
// Extraídas a js/admin/superadmin/messaging.js (auditoría 2026-07-22,
// 2026-07-26). Punto de entrada: saTab('messages') → saMessages().
// ════════════════════════════════════════════════════════════════
