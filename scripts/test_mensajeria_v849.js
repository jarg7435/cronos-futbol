// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v849 · MENSAJERÍA, ROLES Y ALTAS (implementar.txt 2026-11-01)
// ═══════════════════════════════════════════════════════════════════════════
//  1. Un solo hilo con el SuperAdmin aunque haya dos documentos con su correo.
//  2. El nombre del contacto sin «Administrador Individual» delante; el rol
//     de la relación, destacado.
//  3. La insignia de no leídos: el PRIMER mensaje de una conversación nueva
//     cuenta, sube EN VIVO y se queda hasta que se abre la conversación.
//  4. Ninguna aprobación activa a un familiar sin el rol de Familias contratado.
//
//  🔑 Las partes 3 y 4 EJECUTAN el código (vm + Firestore de juguete): lo que
//  se mide es lo que SALE, no cómo está escrito.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = s => s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const UB    = leer('js/coach/comms/unread-badge.js');
const PANEL = leer('js/coach/comms/panel.js');
const CHAT  = leer('js/coach/comms/club-chat.js');
const UTILS = leer('js/core/utils.js');
const CA    = leer('js/admin/club/panel.js');
const REQ   = leer('js/admin/superadmin/requests-tab.js');
const CLUBS = leer('js/admin/superadmin/clubs-tab.js');
const EXTR  = leer('js/admin/superadmin/extras.js');

let _cadena = Promise.resolve();
const parte = (titulo, fn) => {
    _cadena = _cadena.then(async () => {
        console.log(titulo);
        try { await fn(); }
        catch (e) { console.log('  ✗ esta parte se detuvo: ' + (e && e.stack || e)); fallos++; total++; }
    });
};
const espera = ms => new Promise(r => setTimeout(r, ms));
const d = (id, datos) => ({ id, data: () => datos });

// ── unread-badge.js sobre un Firestore de juguete CON oyentes ─────────
function cargarUB(o) {
    const oyentes = [];          // [{ col, cb }]
    let lecturas = 0;
    const snap = arr => ({ forEach: f => arr.forEach(x => f(x)) });
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        String, Object, Array, Number, Boolean, Date, JSON, Math, isFinite, isNaN,
        setTimeout, clearTimeout,
        document: { getElementById: id => (o.dom && o.dom[id]) || null,
                    addEventListener() {}, visibilityState: 'visible' },
        addEventListener() {},
    };
    sb.window = sb; sb.globalThis = sb;
    sb._getEffectiveUser = () => o.yo;
    sb.ccPuedeVerCanal = u => !!(o.veCanal && u && u.clubId);
    sb._umAlCambiarHilos = ids => { sb._avisosBandeja.push(ids.slice()); };
    sb._avisosBandeja = [];
    const fs_ = {
        db: {},
        collection: (_db, n) => ({ _col: n }),
        query: c => c, where: () => ({}), orderBy: () => ({}), limit: () => ({}),
        doc: (_db, ...p) => ({ _path: p.join('/') }),
        getDocs: async c => { lecturas++; return snap(c._col === 'cronos_messages' ? (o.hilos || []) : (o.canal || [])); },
        getDoc: async () => ({ exists: () => !!o.marcas, data: () => o.marcas || {} }),
        setDoc: async () => {},
    };
    if (o.conOyentes) {
        fs_.onSnapshot = (q, cb) => { const r = { col: q._col, cb }; oyentes.push(r); return () => { r.baja = true; }; };
    }
    sb.import = async () => fs_;
    vm.createContext(sb);
    vm.runInContext(UB.replace(/await import\(/g, 'await window.import('), sb);
    sb._oyentes = oyentes;
    sb._lecturas = () => lecturas;
    return sb;
}

console.log('\n══ v849 · mensajería, roles y altas ══');

// ═════════════════════════════════════════════════════════════════════
parte('\n1) UN SOLO HILO CON EL SUPERADMIN', () => {
    const i = PANEL.indexOf("if (tabId === 'superadmin') {");
    const bloque = sinComentarios(PANEL.slice(i, i + 4000));
    ok('1a · 🔑 los contactos del SuperAdmin se agrupan por CORREO, no por documento',
       /porCorreo\s*=\s*new Map\(\)/.test(bloque) && /String\(u\.email \|\| d\.id\)\.trim\(\)\.toLowerCase\(\)/.test(bloque),
       'dos documentos con el mismo correo daban dos hilos idénticos (captura 11781)');
    ok('1b · y se queda el que ya tiene conversación conmigo, luego el último en entrar',
       /_hiloCon\(d\.id\)/.test(bloque) && /_ms\(u\.lastLogin\)/.test(bloque));
    ok('1c · el hilo se busca con el contexto CANÓNICO (como el resto del motor)',
       /_cThreadId\(me\.uid, uid, _getCanonicalContext\(window\._umState\.role, 'superadmin'\)\)/.test(bloque));
    ok('1d · ⚠️ y la lista final es la agrupada, no la de documentos',
       /contacts = Array\.from\(porCorreo\.values\(\)\)/.test(bloque) && !/byUid\.set\(d\.id/.test(bloque));
});

// ═════════════════════════════════════════════════════════════════════
parte('\n2) EL NOMBRE ES EL NOMBRE; EL ROL, DESTACADO', () => {
    const ctx = { window: {} };
    const ini = UTILS.indexOf('const CRONOS_ROTULOS_DE_NOMBRE');
    const fin = UTILS.indexOf('window.cronosNombreSinRol = cronosNombreSinRol;');
    ok('2a · utils.js publica cronosNombreSinRol', ini > 0 && fin > ini);
    vm.createContext(ctx);
    vm.runInContext(UTILS.slice(ini, fin) + '\nwindow.f = cronosNombreSinRol;', ctx);
    const f = ctx.window.f;
    ok('2b · 🔑 «Administrador Individual JOSÉ ALBERTO» → «JOSÉ ALBERTO» (captura 11782)',
       f('Administrador Individual JOSÉ ALBERTO') === 'JOSÉ ALBERTO', f('Administrador Individual JOSÉ ALBERTO'));
    ok('2c · también «Entrenador Individual …» y «Familiar / Jugador Individual …»',
       f('Entrenador Individual Ana Pérez') === 'Ana Pérez' &&
       f('Familiar / Jugador Individual Luis') === 'Luis');
    ok('2d · ⚠️ un nombre normal NO se toca (ni uno que contenga la palabra)',
       f('Zeben Ramírez') === 'Zeben Ramírez' && f('Sergio Administrador') === 'Sergio Administrador' &&
       f('Administración Deportiva') === 'Administración Deportiva');
    ok('2e · sólo el rótulo → vacío, para que quien llama caiga al correo',
       f('Administrador Individual') === '' && f(null) === '');
    ok('2f · la bandeja lo aplica en UN punto, a todas las pestañas, antes de guardar contactos',
       /window\.cronosNombreSinRol\(c\.name\);\s*\n\s*c\.name = limpio \|\| c\.email \|\| c\.name;[\s\S]{0,200}window\._umState\.contacts = contacts;/.test(PANEL));
    ok('2g · y el canal del club también (firma y burbujas ya selladas)',
       /cronosNombreSinRol/.test(sinComentarios(CHAT.slice(CHAT.indexOf('function _ccNombreDe'), CHAT.indexOf('window._ccNombreDe')))) &&
       /cronosNombreSinRol/.test(sinComentarios(CHAT.slice(CHAT.indexOf('function _ccNombreCorto'), CHAT.indexOf('function _ccNombreCorto') + 600))));

    // El subtítulo «Rol · correo» con el rol en negrita y TODO escapado.
    const i = PANEL.indexOf('function _umSubtituloHtml');
    const j = PANEL.indexOf('\n}\n', i);
    const c2 = { escapeHtml: s => String(s).replace(/</g, '&lt;') };
    vm.createContext(c2);
    vm.runInContext(PANEL.slice(i, j + 2) + '\nthis.g = _umSubtituloHtml;', c2);
    const h = c2.g('Coordinador (F711) · jose@x.com');
    ok('2h · 🔑 el rol de la relación va destacado («Coordinador (F711)» en negrita)',
       /^<strong[^>]*>Coordinador \(F711\)<\/strong> · jose@x\.com$/.test(h), h);
    ok('2i · ⚠️ y escapado: un nombre no puede inyectar HTML',
       !/<script/.test(c2.g('<script>x</script> · y')) && !/<img/.test(c2.g('a · <img>')));
    ok('2j · lo usan la lista Y la cabecera del chat',
       /\$\{_umSubtituloHtml\(c\.subtitle\)\}/.test(PANEL) && /\$\{_umSubtituloHtml\(contact\.subtitle\)\}/.test(PANEL));
});

// ═════════════════════════════════════════════════════════════════════
parte('\n3) 🔴🔴 LA INSIGNIA: CONVERSACIÓN NUEVA, EN VIVO Y HASTA ABRIRLA', async () => {
    const YO = { uid: 'zeben', clubId: 'clubA', role: 'director', _activeRole: 'director' };
    const SUELO = '2026-10-01T00:00:00.000Z';

    // ── 3a-c · el primer mensaje de un hilo NUEVO cuenta ────────────────
    const nuevo = d('h_nuevo', { participants: ['zeben', 'jose'],
        messages: [{ senderUid: 'jose', senderRole: 'coordinator', text: 'Buenos días',
                     timestamp: '2026-11-01T11:50:00.000Z' }] });
    let w = cargarUB({ yo: YO, hilos: [nuevo],
                       marcas: { threads: {}, staffChannel: 'x', suelo: SUELO } });
    let r = await w.ubContarNoLeidos(true);
    ok('3a · 🔴🔴 el PRIMER mensaje de una conversación nueva enciende la insignia',
       r.privados === 1, 'antes un hilo sin marca se sembraba como leído: ' + JSON.stringify(r));
    ok('3b · y NO se siembra como leído (seguirá hasta que se abra)',
       !w._ubState.marcas.threads.h_nuevo, JSON.stringify(w._ubState.marcas.threads));
    ok('3c · la cuenta por hilo de la bandeja dice lo mismo',
       w.ubNoLeidosDeHilo('h_nuevo', nuevo.data()) === 1);

    // ── 3d-e · el histórico anterior al suelo sigue sin anunciarse (v744) ─
    const viejo = d('h_viejo', { participants: ['zeben', 'otro'], lastMessageAt: '2026-09-01T10:00:00.000Z',
        messages: [{ senderUid: 'otro', text: 'de septiembre', timestamp: '2026-09-01T10:00:00.000Z' }] });
    w = cargarUB({ yo: YO, hilos: [viejo], marcas: { threads: {}, staffChannel: 'x', suelo: SUELO } });
    r = await w.ubContarNoLeidos(true);
    ok('3d · ⚠️ un hilo anterior al suelo NO cuenta (la regla de v744 sigue)', r.privados === 0, JSON.stringify(r));
    ok('3e · y se siembra con su último mensaje, como siempre',
       w._ubState.marcas.threads.h_viejo === '2026-09-01T10:00:00.000Z');

    // ── 3f · sin suelo guardado, nace AHORA (no se anuncia el pasado) ───
    w = cargarUB({ yo: YO, hilos: [viejo], marcas: { threads: {}, staffChannel: 'x' } });
    r = await w.ubContarNoLeidos(true);
    ok('3f · sin suelo previo se crea en este momento y el histórico da 0',
       r.privados === 0 && w._ubState.marcas.suelo > '2026-09-01T10:00:00.000Z', w._ubState.marcas.suelo);

    // ── 3g-l · el vigía en vivo ─────────────────────────────────────────
    const hueco = { style: { display: 'none' }, textContent: '', title: '' };
    w = cargarUB({ yo: YO, hilos: [], conOyentes: true, veCanal: false,
                   marcas: { threads: {}, staffChannel: 'x', suelo: SUELO },
                   dom: { 'sd-badge-mensajes': hueco } });
    await w.ubPintarBadge('sd-badge-mensajes');
    await espera(10);
    const oy = w._oyentes.find(x => x.col === 'cronos_messages');
    ok('3g · 📡 pintar la tarjeta deja puesto UN oyente sobre mis hilos',
       !!oy && w._oyentes.filter(x => x.col === 'cronos_messages').length === 1);
    w.ubVigilar(); w.ubVigilar();
    await espera(10);
    ok('3h · ⚠️ y es idempotente: llamarlo más veces no apila oyentes (lección de v719)',
       w._oyentes.filter(x => x.col === 'cronos_messages').length === 1);

    // Primera foto vacía, luego llega el mensaje del coordinador.
    oy.cb({ forEach() {}, docChanges: () => [] });
    const lecturasAntes = w._lecturas();
    oy.cb({ forEach: f => f(nuevo), docChanges: () => [{ type: 'added', doc: nuevo }] });
    await espera(400);
    ok('3i · 🔴🔴 llega un mensaje y la tarjeta se repinta SOLA con un 1',
       hueco.textContent === '1' && hueco.style.display === '', JSON.stringify(hueco));
    ok('3j · 🔑 y contar no ha costado ni una lectura más (usa lo que trae el oyente)',
       w._lecturas() === lecturasAntes, (w._lecturas() - lecturasAntes) + ' lecturas de más');
    ok('3k · la bandeja abierta recibe el aviso de ESE hilo',
       w._avisosBandeja.length === 1 && w._avisosBandeja[0][0] === 'h_nuevo', JSON.stringify(w._avisosBandeja));

    // Un mensaje MÍO no despierta a la bandeja (ya la repinta el envío).
    const mio = d('h_nuevo', { participants: ['zeben', 'jose'], messages: [
        ...nuevo.data().messages,
        { senderUid: 'zeben', senderRole: 'director', text: 'Hola', timestamp: '2026-11-01T11:55:00.000Z' }] });
    oy.cb({ forEach: f => f(mio), docChanges: () => [{ type: 'modified', doc: mio }] });
    await espera(400);
    ok('3l · ⚠️ mi propia respuesta no dispara una recarga de la bandeja',
       w._avisosBandeja.length === 1, JSON.stringify(w._avisosBandeja));
    ok('3m · y la insignia sigue en 1 hasta que se ABRA la conversación', hueco.textContent === '1');

    await w.ubMarcarHiloLeido('h_nuevo', '2026-11-01T11:55:00.000Z');
    await espera(50);
    ok('3n · 🔑 abrirla (marcar el hilo) la apaga en el acto',
       hueco.textContent === '' && hueco.style.display === 'none', JSON.stringify(hueco));

    // Cambio de cuenta: el oyente viejo se suelta.
    w._getEffectiveUser = () => ({ uid: 'otra', clubId: 'clubA', role: 'coach' });
    oy.cb({ forEach() {}, docChanges: () => [] });
    ok('3o · 🚨 si cambia la cuenta, el oyente del uid anterior se SUELTA',
       oy.baja === true && w._ubState.vigia === null);

    // ── 3p-r · la bandeja ──────────────────────────────────────────────
    const render = (() => {
        const i = PANEL.indexOf('async function _renderUnifiedMessagingView');
        const j = PANEL.indexOf('\nasync function ', i + 10);
        return sinComentarios(PANEL.slice(i, j));
    })();
    ok('3p · 🔴 entrar en la bandeja YA NO pone el contador a cero (encargo nuevo)',
       !/ubMarcarTodoLeido\s*\(/.test(render));
    ok('3q · abrir una conversación sigue marcándola leída',
       /await window\.ubMarcarHiloLeido\(snap\.id,/.test(PANEL));
    ok('3r · la conversación abierta se recarga al llegar un mensaje suyo',
       /function _umAlCambiarHilos\(ids\)[\s\S]{0,900}if \(ids\.indexOf\(tid\) !== -1\) _loadUnifiedThreadMessages\(tid, c\);/.test(PANEL) &&
       /window\._umAlCambiarHilos = _umAlCambiarHilos;/.test(PANEL));
    ok('3s · y la lista incorpora los hilos del vigía (remitente con otro clubId)',
       /_vigia\.hilos\.forEach\(h => \{ threadsMap\[h\.id\]/.test(PANEL));
});

// ═════════════════════════════════════════════════════════════════════
parte('\n4) 👨‍👩‍👧🔒 NINGUNA APROBACIÓN DE FAMILIAR SIN EL ROL CONTRATADO', async () => {
    const ini = UTILS.indexOf('const CRONOS_ROLES_FAMILIA');
    const fin = UTILS.indexOf("if (typeof window.isParentReportEnabledForCategory !== 'function')");
    ok('4a · utils.js tiene la puerta única', ini > 0 && fin > ini);
    const docs = {};
    const sb = { window: {} };
    sb.window._cronos_auth = { db: {} };
    sb.window.CRONOS_ROL_EXTRA_MOTIVO = { rol_padres: 'El acceso de Familias no está contratado en el plan de tu club.' };
    sb.window.import = async () => ({
        doc: (_db, col, id) => col + '/' + id,
        getDoc: async ref => ({ exists: () => !!docs[ref], data: () => docs[ref] }),
    });
    vm.createContext(sb);
    vm.runInContext(UTILS.slice(ini, fin).replace(/await import\(/g, 'await window.import('), sb);
    const M = sb.window.cronosMotivoAltaFamiliaBloqueada;

    docs['clubs/doramas'] = { extras: { rol_padres: false } };
    docs['clubs/dia']     = { extras: {} };
    docs['individuals/ente1'] = { extras: { rol_padres: false } };
    ok('4b · 🔴 un FAMILIAR en un club sin Familias contratado → bloqueado',
       !!(await M('parent', 'doramas')));
    ok('4c · también por sus alias (parent_individual, padre) y en un ENTE',
       !!(await M(['parent_individual'], 'ente1')) && !!(await M('padre', 'doramas')));
    ok('4d · ⚠️ un entrenador o coordinador en ese mismo club NO se bloquea',
       (await M(['user', 'coordinator'], 'doramas')) === '');
    ok('4e · un familiar en un club CON Familias (o sin extra escrito) pasa',
       (await M('parent', 'dia')) === '' && (await M('parent', 'desconocido')) === '');
    ok('4f · el motivo usa el MISMO texto que el candado de la pantalla de acceso',
       /no está contratado/.test(await M('parent', 'doramas')));

    const llama = (src, desde, n) => {
        const i = src.indexOf(desde);
        return i >= 0 && /cronosMotivoAltaFamiliaBloqueada\(/.test(sinComentarios(src.slice(i, i + n)));
    };
    ok('4g · la confirmación final del club la comprueba',
       llama(CA, 'window.caConfirmClubAccess = async', 700));
    ok('4h · la aprobación del SuperAdmin (alta directa y solicitud) también, ANTES de activar',
       llama(REQ, 'window.saApproveRequest = async function', 2600) &&
       REQ.indexOf('cronosMotivoAltaFamiliaBloqueada') < REQ.indexOf("if (type === 'direct_user') {"));
    ok('4i · y la aprobación rápida y la de la pestaña de solicitudes',
       llama(CLUBS, 'window.saQuickApprove = async function', 1500) &&
       llama(EXTR, 'window.saExtApprove = async function', 5000));
});

_cadena.then(() => {
    console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
    process.exit(fallos ? 1 : 0);
});
