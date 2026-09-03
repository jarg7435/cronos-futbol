// ─────────────────────────────────────────────────────────────────────────
// test_bulk_messaging_module.js · Refactor de monolitos (auditoria 2026-07-22)
// MONOLITO #3 (js/coach/comms/panel.js), PASO 5 de 6: extraccion del
// COMPOSITOR DE MENSAJERIA MASIVA LEGACY (toggleSelectAllParents /
// updateBulkCount / openBulkMessageComposer / _msgSavePreselection /
// _msgGetSelected / _sendBulkMsgFirestore / _sendBulkMsgWA /
// _sendBulkMsgEmail, 252 lineas) a js/coach/comms/bulk-messaging.js.
//
// Escrito y ejecutado EN VERDE contra el codigo todavia SIN mover (Puerta 3).
//
// ── ALCANCE: SOLO EL COMPOSITOR, NO EL MENU ──
// El §11 del plan eran DOS cosas pegadas con perfiles opuestos:
//   · openUnifiedCommsMenu (92 lineas) — el router de toda el area de
//     comunicaciones, con 25 referencias externas en 8 archivos, entre ellas
//     los CUATRO modulos ya extraidos. SE QUEDA en panel.js por decision del
//     autor (2026-07-27), igual que el nucleo de mensajeria. No moverlo evita
//     ademas convertir `window.openUnifiedCommsMenu = openUnifiedCommsMenu;`
//     del bloque de exports, que es la trampa exacta que provoco el
//     ReferenceError de v378.
//   · Este compositor (252 lineas) — fan-in CERO.
//
// ── ⚠️ EL SUBARBOL ESTA MUERTO, Y NO SOLO POR FALTA DE INVOCADOR ──
// Ni openBulkMessageComposer ni toggleSelectAllParents tienen una sola
// llamada en TODO el repositorio (updateBulkCount solo la llama la primera).
// Las tres leen la clase CSS `.parent-select-chk`, y NINGUN archivo del
// proyecto pinta esa clase: aunque alguien las invocara, encontrarian cero
// destinatarios. El resto (_msgSavePreselection, _msgGetSelected y los tres
// _sendBulkMsg*) solo cuelga del HTML que pinta el compositor, que nadie abre.
// La implementacion VIVA es la familia _um* (_toggleSelectAllUnified,
// _updateUnifiedBulkCount, _openUnifiedBulkComposer), cableada desde la
// interfaz de mensajeria unificada y que SE QUEDA en panel.js.
// Se mueve TAL CUAL: no se borra nada y no se declara codigo muerto por
// decreto — pero queda documentado por si algun dia se decide retirarlo.
//
// ── FAN-OUT (Puerta 1) ──
// Solo DOS nombres de panel.js: _cFS (una llamada) y openCoachMessaging (tres
// onclick mas una llamada directa tras enviar). Los dos se quedan.
//
// ── TESTS ──
// Ningun test ACTIVO toca esta seccion. El unico que la nombra es
// scripts/test_staff_chat_unification.js (XFAIL, 21 PASS / 15 FAIL): sus
// aserciones 10c y 10d apuntan a _msgGetSelected pero YA estan rojas, porque
// el `data-role` que exigen no existe en el codigo. Se espera recuento
// IDENTICO antes y despues; hay que verificarlo, no darlo por hecho.
// (Ese caso lo encontre a mano: mi barrido de colisiones solo extraia
// literales de CADENA y se perdia los de EXPRESION REGULAR, que es como 10c
// escribe su patron. El barrido ya cubre ambos.)
//
// ── RAREZAS PREEXISTENTES QUE SE PRESERVAN ──
//  1. ⚠️ La "limpieza post-envio" de _sendBulkMsgFirestore borra
//     `cronos_match_rpt_selection` — la preseleccion del modal de INFORMES DE
//     PARTIDO (§8, que se queda en panel.js) — y NO borra la suya,
//     `cronos_msg_preselection`. Limpia el estado de otra funcionalidad.
//     Inocuo hoy porque nada abre el compositor; si se recableara, resetearia
//     en silencio una seleccion ajena. Parte 4g.
//  2. El threadId se construye como `${me.uid}_${parentUid}` sin pasar por
//     _cThreadId, igual que _sendAllIndividualReports (paso 3). Parte 4b.
//  3. showToast/showSpinner/hideSpinner se llaman SIN guarda typeof, al
//     contrario que en casi todas las demas secciones del monolito.
//  4. El envio por email mete a TODOS los destinatarios en un unico campo
//     `to` del mailto, asi que cada padre ve las direcciones de los demas
//     (los informes individuales, en cambio, abren un mailto por familia).
//     Parte 6d.
//  5. openBulkMessageComposer lee `emailConfig` SIN guarda typeof, al reves
//     que collective-report.js e individual-reports.js.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'comms', 'panel.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'comms', 'bulk-messaging.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Mensajeria masiva (compositor legacy) — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('window.toggleSelectAllParents = function(checked)');
    if (s === -1) throw new Error('No se encontro toggleSelectAllParents en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    // Marcador de fin verificado UNICO (el simple "INFORME COLECTIVO" casa 3
    // veces; con "DIRECTORES Y COORDINADORES" solo una).
    const e = src.indexOf('INFORME COLECTIVO → DIRECTORES Y COORDINADORES', s);
    if (e === -1) throw new Error('No se encontro el final de la seccion');
    const cut = src.slice(s, e);
    return cut.slice(0, cut.lastIndexOf('};') + 2);
}
const BLOCK = readBlock();

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
}

const MOVED = ['toggleSelectAllParents', 'updateBulkCount', 'openBulkMessageComposer',
               '_msgSavePreselection', '_msgGetSelected', '_sendBulkMsgFirestore',
               '_sendBulkMsgWA', '_sendBulkMsgEmail'];

// ── Sandbox ──────────────────────────────────────────────────────────────
const mkEl = () => ({ innerHTML: '', value: '', textContent: '', checked: false,
                      style: {}, dataset: {} });

function buildSandbox({
    me = { uid: 'coach1', clubId: 'club1', email: 'c@x.com' },
    noUser = false, noAuth = false,
    parentChks = [],          // .parent-select-chk (los que lee el compositor)
    msgChks = [],             // .msg-recipient-chk (los que leen los envios)
    contacts = [],            // emailConfig.contacts
    msgText = 'Hola equipo',
    noTextarea = false,
    store = {},               // localStorage
    threadExists = false,
    setDocThrows = null,
} = {}) {
    const toasts = [], spinners = [], opened = [], written = [], menuCalls = [];
    const els = {};
    const el = (id) => (els[id] = els[id] || mkEl());
    const modal = el('setup-modal');
    if (!noTextarea) el('bulk-msg-text').value = msgText;
    // getElementById crea al vuelo (como si el HTML ya estuviera pintado),
    // salvo el textarea cuando la prueba quiere simular que no existe.
    const byId = (id) => {
        if (id === 'bulk-msg-text' && noTextarea) return null;
        return el(id);
    };

    const sel = (s) => {
        if (s === '.parent-select-chk') return parentChks;
        if (s === '.parent-select-chk:checked') return parentChks.filter(c => c.checked);
        if (s === '.msg-recipient-chk') return msgChks;
        if (s === '.msg-recipient-chk:checked') return msgChks.filter(c => c.checked);
        return [];
    };

    const fakeFS = {
        db: {},
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async () => ({ exists: () => threadExists, data: () => ({ unreadByParent: 7 }) }),
        setDoc: async (ref, data) => {
            if (setDocThrows) throw new Error(setDocThrows);
            written.push({ op: 'set', col: ref.__col, id: ref.__id, data });
        },
        updateDoc: async (ref, data) => { written.push({ op: 'update', col: ref.__col, id: ref.__id, data }); },
        arrayUnion: (...i) => ({ __arrayUnion: i }),
    };

    const sandbox = {
        // ⚠️ En un navegador `window` ES el objeto global. Si aqui fuese un
        // objeto APARTE, `window.updateBulkCount = ...` no crearia un nombre
        // resoluble y la llamada pelada que hace toggleSelectAllParents
        // lanzaria ReferenceError. Se enlaza mas abajo, tras createContext.
        _cronosCurrentUser: noUser ? null : me,
        _cronos_auth: noAuth ? null : { db: fakeFS.db },
        open: (u) => opened.push(u),
        document: {
            getElementById: byId,
            querySelectorAll: sel,
        },
        console: { log: () => {}, warn: () => {}, error: () => {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON,
        parseInt, isNaN, RegExp, Error,
        encodeURIComponent, decodeURIComponent,
        setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
        },
        emailConfig: { contacts },
        escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
        escapeAttr: (s) => String(s == null ? '' : s).replace(/"/g, '&quot;'),
        showToast: (m) => toasts.push(String(m)),
        showSpinner: (m) => spinners.push({ on: true, msg: m }),
        hideSpinner: () => spinners.push({ on: false }),
        // Los dos unicos helpers de panel.js que el bloque necesita.
        _cFS: async () => fakeFS,
        openCoachMessaging: () => menuCalls.push(1),
    };
    vm.createContext(sandbox);
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInContext(BLOCK, sandbox);

    return { g: sandbox, w: sandbox, toasts, spinners, opened, written, menuCalls,
             store, modal, el: (id) => els[id] };
}

const pchk = (d, checked = true) => { const e = mkEl(); e.checked = checked; e.dataset = d; return e; };

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura, acoplamiento y alcanzabilidad ──');
    ok('1a · las ocho piezas estan en el bloque',
        MOVED.every(n => new RegExp('^(?:window\\.)?(?:function )?' + n + '\\b|^window\\.' + n + '\\s*=|^function ' + n + '\\(', 'm').test(BLOCK)),
        MOVED.filter(n => !new RegExp('\\b' + n + '\\b').test(BLOCK)));
    ok('1b · openUnifiedCommsMenu NO viaja con el bloque (se queda en panel.js)',
        !/^async function openUnifiedCommsMenu/m.test(BLOCK));
    {
        const panel = fs.readFileSync(ORIGIN, 'utf8');
        ok('1c · y sigue declarada y exportada en panel.js, con su alias intacto',
            /^async function openUnifiedCommsMenu\(\)/m.test(panel)
            && /window\.openUnifiedCommsMenu\s+= openUnifiedCommsMenu;/.test(panel));
        const names = new Set();
        for (const l of panel.split(/\r?\n/)) {
            let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
            m = l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\(|\{|[A-Za-z_$][\w$]*\s*=>)/); if (m) names.add(m[1]);
            m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
        }
        const used = [...names].filter(n => !MOVED.includes(n)
            && new RegExp('\\b' + n.replace(/[$]/g, '\\$') + '\\b').test(BLOCK)).sort();
        ok('1d · fan-out a panel.js = exactamente _cFS y openCoachMessaging',
            JSON.stringify(used) === JSON.stringify(['_cFS', 'openCoachMessaging']), used);
    }
    {
        // ⚠️ v669 · EL CENSO VA SOBRE EL FUENTE SIN COMENTARIOS.
        //    Tal cual estaba, este guard se puso rojo porque un módulo nuevo
        //    (js/shared/multi-select.js) NOMBRABA `updateBulkCount` en un
        //    comentario, para señalar de dónde venía el patrón de "leer la
        //    selección del DOM". Ni una llamada: una cita. Un guard que se
        //    dispara con la explicación empuja a borrar la explicación, que es
        //    justo lo contrario de lo que debería conseguir. Mismo helper y
        //    misma lección que en test_extras_lock_and_messaging.js.
        //    (El `split(/\r?\n/)` importa: con CRLF, `//.*$` no llega al final
        //    de línea y el helper no borraría ni un comentario.)
        const _sinComs = (src) => src
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

        const refs = {};
        for (const f of walk(ROOT, [])) {
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            if (rel.startsWith('scripts/') || rel === 'sw.js') continue;
            if (rel === 'js/coach/comms/panel.js' || rel === 'js/coach/comms/bulk-messaging.js') continue;
            const txt = _sinComs(fs.readFileSync(f, 'utf8'));
            for (const n of MOVED) if (new RegExp('\\b' + n + '\\b').test(txt)) (refs[n] = refs[n] || []).push(rel);
        }
        ok('1e · ⚠️ fan-in externo = CERO para las ocho', Object.keys(refs).length === 0, refs);
    }
    {
        // Nadie pinta la clase que leen las tres primeras.
        const painters = [];
        for (const f of walk(ROOT, [])) {
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            if (rel.startsWith('scripts/')) continue;
            if (/class="[^"]*parent-select-chk/.test(fs.readFileSync(f, 'utf8'))) painters.push(rel);
        }
        ok('1f · ⚠️ NADIE pinta .parent-select-chk: el compositor no tendria destinatarios ni invocandolo',
            painters.length === 0, painters);
    }
    {
        const panel = fs.readFileSync(ORIGIN, 'utf8');
        ok('1g · la familia _um* (la implementacion VIVA) se queda en panel.js y si esta cableada',
            /^function _toggleSelectAllUnified\(/m.test(panel)
            && /^async function _openUnifiedBulkComposer\(/m.test(panel)
            && /onchange="_toggleSelectAllUnified\(this\.checked\)"/.test(panel)
            && /onclick="_openUnifiedBulkComposer\(\)"/.test(panel));
    }
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const comms = idxHtml.indexOf('js/coach/comms/panel.js');
        const target = idxHtml.indexOf('js/coach/comms/bulk-messaging.js');
        ok('1h · bulk-messaging.js se carga despues de comms/panel.js',
            target !== -1 && target > comms, { comms, target });
        ok('1i · esta en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/comms/bulk-messaging.js'));
        ok('1j · esta en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/comms/bulk-messaging.js'));
        ok('1k · esta en la cadena del guard de carga',
            fs.readFileSync(path.join(ROOT, 'scripts', 'test_extracted_modules_load.js'), 'utf8')
                .includes('js/coach/comms/bulk-messaging.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · seleccion de padres (.parent-select-chk) ──');
    {
        const a = pchk({}, false), b = pchk({}, false);
        const t = buildSandbox({ parentChks: [a, b] });
        t.w.toggleSelectAllParents(true);
        ok('2a · toggleSelectAllParents marca todas las palomillas', a.checked && b.checked);
        t.w.toggleSelectAllParents(false);
        ok('2b · y las desmarca todas', !a.checked && !b.checked);
    }
    {
        const t = buildSandbox({ parentChks: [pchk({}), pchk({}), pchk({}, false)] });
        t.w.updateBulkCount();
        const count = t.el('bulk-count');
        ok('2c · updateBulkCount cuenta solo las marcadas y concuerda en plural',
            count.textContent === '2 seleccionados', count.textContent);
    }
    {
        const t = buildSandbox({ parentChks: [pchk({})] });
        t.w.updateBulkCount();
        ok('2d · singular con una sola', t.el('bulk-count').textContent === '1 seleccionado');
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · openBulkMessageComposer: el HTML ──');
    {
        const t = buildSandbox({
            parentChks: [pchk({ parentUid: 'p7', parentEmail: 'p7@x.com', parentWa: '600', player: 'Ana', playerNum: '7' })],
        });
        t.w.openBulkMessageComposer();
        const h = t.modal.innerHTML;
        ok('3a · abre la modal con el compositor', t.modal.style.display === 'flex' && h.includes('Mensaje Grupal'));
        ok('3b · pinta una fila por destinatario con la clase que leen los envios',
            h.includes('class="msg-recipient-chk"'));
        ok('3c · traslada uid, email y wa a los data-* que lee _msgGetSelected',
            h.includes('data-uid="p7"') && h.includes('data-email="p7@x.com"') && h.includes('data-wa="600"'));
        ok('3d · la etiqueta combina jugador y dorsal', h.includes('Ana #7'));
        ok('3e · marca las insignias WA y Email segun los datos de contacto',
            h.includes('>WA<') && h.includes('>Email<'));
        ok('3f · los cuatro botones de accion apuntan a las funciones del bloque',
            /onclick="_sendBulkMsgFirestore\(\)"/.test(h) && /onclick="_sendBulkMsgWA\(\)"/.test(h)
            && /onclick="_sendBulkMsgEmail\(\)"/.test(h) && /onclick="_msgSavePreselection\(\)"/.test(h));
        ok('3g · la X y Volver llaman a openCoachMessaging, que se queda en panel.js',
            (h.match(/onclick="openCoachMessaging\(\)"/g) || []).length === 2);
    }
    {
        const t = buildSandbox({ parentChks: [] });
        t.w.openBulkMessageComposer();
        // OJO: el nombre de la clase aparece igualmente dentro de los onclick
        // de "Todos"/"Ninguno", que se pintan siempre. Hay que buscar el INPUT.
        ok('3h · sin destinatarios pinta el aviso y ninguna fila',
            t.modal.innerHTML.includes('No hay contactos')
            && !t.modal.innerHTML.includes('class="msg-recipient-chk"'));
    }
    {
        // El tipo sale de emailConfig.contacts; por defecto 'parent'.
        const t = buildSandbox({
            parentChks: [pchk({ parentUid: 's1', parentEmail: 'd@x.com', player: 'Dir' })],
            contacts: [{ id: 's1', type: 'staff', email: 'd@x.com' }],
        });
        t.w.openBulkMessageComposer();
        ok('3i · el tipo real se busca en emailConfig.contacts (staff pinta en azul)',
            t.modal.innerHTML.includes('rgba(88,166,255,0.12)'));
    }
    {
        const t = buildSandbox({
            parentChks: [pchk({ parentUid: 'p1', player: 'A' }), pchk({ parentUid: 'p2', player: 'B' })],
            store: { cronos_msg_preselection: JSON.stringify(['p2']) },
        });
        t.w.openBulkMessageComposer();
        const h = t.modal.innerHTML;
        const checkedIds = [...h.matchAll(/data-id="([^"]+)"\s*\n?\s*checked/g)].map(m => m[1]);
        ok('3j · respeta la preseleccion guardada: solo marca los ids guardados',
            /data-id="p2"[\s\S]{0,40}checked/.test(h) && !/data-id="p1"[\s\S]{0,40}checked/.test(h),
            checkedIds);
    }
    {
        const t = buildSandbox({ parentChks: [pchk({ parentUid: 'p1', player: 'A' })] });
        t.w.openBulkMessageComposer();
        ok('3k · sin preseleccion guardada marca a todos por defecto',
            /data-id="p1"[\s\S]{0,40}checked/.test(t.modal.innerHTML));
    }
    {
        const t = buildSandbox({ parentChks: [pchk({ parentUid: 'p1', player: 'A' })], store: { cronos_msg_preselection: '{{roto' } });
        let threw = null;
        try { t.w.openBulkMessageComposer(); } catch (e) { threw = e; }
        ok('3l · una preseleccion corrupta en localStorage no rompe la modal', !threw, threw && threw.message);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · _msgSavePreselection y _sendBulkMsgFirestore ──');
    {
        const t = buildSandbox({ msgChks: [pchk({ id: 'p1' }), pchk({ id: 'p2' }, false), pchk({ id: 'p3' })] });
        t.w._msgSavePreselection();
        ok('4a · guarda solo los ids marcados bajo cronos_msg_preselection',
            t.store.cronos_msg_preselection === JSON.stringify(['p1', 'p3']), t.store);
    }
    {
        const t = buildSandbox({ msgChks: [pchk({ uid: 'p7', email: 'p7@x.com', wa: '600' })] });
        await t.w._sendBulkMsgFirestore();
        const w = t.written[0];
        ok('4b · crea el hilo con setDoc y threadId `${me.uid}_${parentUid}` (sin pasar por _cThreadId)',
            w && w.op === 'set' && w.id === 'coach1_p7' && w.data.threadId === 'coach1_p7', t.written);
        ok('4c · el hilo lleva participants, clubId y recipientType parent',
            JSON.stringify(w.data.participants) === JSON.stringify(['coach1', 'p7'])
            && w.data.clubId === 'club1' && w.data.recipientType === 'parent');
        ok('4d · el mensaje va con sender coach y el texto del textarea',
            w.data.messages[0].sender === 'coach' && w.data.messages[0].text === 'Hola equipo');
        ok('4e · confirma, cierra el spinner y vuelve a la mensajeria del entrenador',
            t.toasts.some(x => x.includes('enviado a 1 destinatario'))
            && t.spinners.some(s => !s.on) && t.menuCalls.length === 1, t.toasts);
    }
    {
        const t = buildSandbox({ msgChks: [pchk({ uid: 'p7' })], threadExists: true });
        await t.w._sendBulkMsgFirestore();
        ok('4f · si el hilo existe hace updateDoc e incrementa unreadByParent',
            t.written[0].op === 'update' && t.written[0].data.unreadByParent === 8,
            t.written[0] && t.written[0].data.unreadByParent);
    }
    {
        const t = buildSandbox({
            msgChks: [pchk({ uid: 'p7' })],
            store: { cronos_match_rpt_selection: 'DE_OTRA_FUNCION', cronos_msg_preselection: 'LA_SUYA' },
        });
        await t.w._sendBulkMsgFirestore();
        ok('4g · ⚠️ la limpieza post-envio borra la preseleccion de INFORMES DE PARTIDO, no la suya',
            !('cronos_match_rpt_selection' in t.store) && t.store.cronos_msg_preselection === 'LA_SUYA',
            t.store);
    }
    {
        const t = buildSandbox({ msgChks: [], noTextarea: true });
        await t.w._sendBulkMsgFirestore();
        ok('4h · sin texto avisa y no escribe',
            t.toasts.some(x => x.includes('Escribe un mensaje')) && t.written.length === 0);
    }
    {
        const t = buildSandbox({ msgChks: [pchk({ email: 'x@x.com' })] });   // sin uid
        await t.w._sendBulkMsgFirestore();
        ok('4i · el envio interno exige uid: sin ninguno avisa y no escribe',
            t.toasts.some(x => x.includes('cuenta en la app')) && t.written.length === 0, t.toasts);
    }
    {
        const t = buildSandbox({ msgChks: [pchk({ uid: 'p7' })], noAuth: true });
        await t.w._sendBulkMsgFirestore();
        ok('4j · sin sesion sale en silencio, sin toast', t.toasts.length === 0 && t.written.length === 0);
    }
    {
        const t = buildSandbox({ msgChks: [pchk({ uid: 'p7' })], setDocThrows: 'sin red' });
        await t.w._sendBulkMsgFirestore();
        ok('4k · si falla la escritura cierra el spinner, avisa y NO vuelve al menu',
            t.spinners.some(s => !s.on) && t.toasts.some(x => x.includes('Error: sin red'))
            && t.menuCalls.length === 0, t.toasts);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · _sendBulkMsgWA ──');
    {
        const t = buildSandbox({ msgChks: [pchk({ uid: 'a', wa: '600111222' }), pchk({ uid: 'b', wa: '600333444' })] });
        t.w._sendBulkMsgWA();
        ok('5a · abre un WhatsApp por destinatario con telefono',
            t.opened.length === 2 && t.opened[0].startsWith('https://wa.me/600111222?text='), t.opened);
        ok('5b · el texto va codificado en la URL',
            t.opened[0].includes(encodeURIComponent('Hola equipo')));
        ok('5c · confirma con un toast', t.toasts.some(x => x.includes('2 destinatarios')), t.toasts);
    }
    {
        const t = buildSandbox({ msgChks: [pchk({ uid: 'a' })] });   // sin wa
        t.w._sendBulkMsgWA();
        ok('5d · sin ningun telefono avisa y no abre nada',
            t.opened.length === 0 && t.toasts.some(x => x.includes('WhatsApp configurado')));
    }
    {
        const t = buildSandbox({ msgChks: [pchk({ wa: '600' })], noTextarea: true });
        t.w._sendBulkMsgWA();
        ok('5e · sin texto avisa y no abre nada',
            t.opened.length === 0 && t.toasts.some(x => x.includes('Escribe un mensaje')));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 6 · _sendBulkMsgEmail ──');
    {
        const t = buildSandbox({
            msgChks: [pchk({ email: 'a@x.com' }), pchk({ email: 'b@x.com' })],
            msgText: 'Texto *con* _formato_',
        });
        t.w._sendBulkMsgEmail();
        ok('6a · abre un unico mailto', t.opened.length === 1 && t.opened[0].startsWith('mailto:'), t.opened);
        ok('6b · el asunto lleva la fecha del dia', /subject=.*Mensaje/.test(t.opened[0]));
        ok('6c · quita los asteriscos y guiones bajos del cuerpo',
            t.opened[0].includes(encodeURIComponent('Texto con formato')), t.opened[0].slice(0, 120));
        ok('6d · ⚠️ mete a TODOS los destinatarios en el mismo campo `to` (se ven entre si)',
            t.opened[0].startsWith('mailto:a@x.com,b@x.com?'), t.opened[0].slice(0, 60));
        ok('6e · confirma con un toast', t.toasts.some(x => x.includes('2 destinatarios')));
    }
    {
        const t = buildSandbox({ msgChks: [pchk({ uid: 'a' })] });   // sin email
        t.w._sendBulkMsgEmail();
        ok('6f · sin ningun email avisa y no abre nada',
            t.opened.length === 0 && t.toasts.some(x => x.includes('Email configurado')));
    }
    {
        const t = buildSandbox({ msgChks: [pchk({ email: 'a@x.com' })], noTextarea: true });
        t.w._sendBulkMsgEmail();
        ok('6g · sin texto avisa y no abre nada',
            t.opened.length === 0 && t.toasts.some(x => x.includes('Escribe un mensaje')));
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
