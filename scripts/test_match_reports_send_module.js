// ─────────────────────────────────────────────────────────────────────────
// test_match_reports_send_module.js · Refactor de monolitos (auditoria 2026-07-22)
// MONOLITO #3 (js/coach/comms/panel.js), PASO 6a de 6b: extraccion del
// CAMINO MANUAL de envio de informes de partido (sendMatchReportsToParents /
// buildConvocationRecipientsHTML / saveMatchReportPreselection /
// _buildGlobalReportText / _buildIndividualReportText / _executeReportsSend,
// 850 lineas) a js/coach/comms/match-reports-send.js.
//
// Escrito y ejecutado EN VERDE contra el codigo todavia SIN mover (Puerta 3).
//
// ── EL §8 SE PARTE EN DOS (decision del autor, 2026-07-27) ──
// Eran 1359 lineas en DOS CAMINOS INDEPENDIENTES — verificado en ambos
// sentidos: cero referencias cruzadas.
//   · 6a (este): camino MANUAL. El entrenador abre la modal, elige
//     destinatarios y envia. Entrada externa unica:
//     js/match/persistence/team-persistence.js, con guarda typeof.
//   · 6b (siguiente): camino AUTOMATICO (autoDispatchMatchReports +
//     saveAllMatchReportsInternal, 509 lineas). Se queda en panel.js hasta su
//     propio paso.
// Son implementaciones CASI SIMETRICAS: mismos helpers, mismas colecciones.
// Aqui NO hay codigo muerto que amortigue un fallo: esto es por donde las
// familias reciben los informes cuando el entrenador los manda a mano.
//
// ── FAN-OUT: OCHO helpers de panel.js, el maximo del refactor ──
// _cFS, _cGetStaff, _cMatchSubcatFor, _cMyTeamKey, _cResolveClubId,
// _cStaffThreadId, _cronosResolveParentReportTargets y
// _parseHistoryForFirestore. Los ocho SE QUEDAN en panel.js y resuelven via
// window en tiempo de llamada.
// Ademas depende de js/shared/whatsapp-email.js (sharedGetSelectedRecipients,
// sharedBuildRecipientsHTML, sharedSelectAll) y de los globales lexicos
// emailConfig / currentMode / currentCategory / TEAM_NAMES de app-init.js.
//
// ── ⚠️ LA TRAMPA DE v378 REAPARECE EN ESTE PASO ──
// panel.js conserva `window.sendMatchReportsToParents = sendMatchReportsToParents;`
// en su bloque de exports, con el NOMBRE PELADO. Al mudarse la funcion a un
// archivo que carga DESPUES, eso es un ReferenceError EN TIEMPO DE CARGA que
// aborta el resto de panel.js — exactamente lo que se colo en produccion en
// v378. Hay que convertirlo a autoasignacion en el MISMO commit; lo vigilan
// la asercion 1f de aqui y scripts/test_extracted_modules_load.js.
// (6b tendra el suyo: window.saveAllMatchReportsInternal.)
//
// ── TESTS ──
// NINGUN test, activo ni xfail, apunta a esta mitad. Los dos que hay que
// tocar (test_collective_report_module.js:1e y test_p11d_collective_write.js)
// dependen de autoDispatchMatchReports, que es 6b.
//
// ── RAREZAS PREEXISTENTES QUE SE PRESERVAN ──
//  1. _buildGlobalReportText hace window.players.filter SIN guarda: si no hay
//     partido en curso lanza TypeError. Solo se le llama desde
//     _executeReportsSend, que corre tras haber jugado, pero la funcion en si
//     no se defiende. Parte 4d.
//  2. El "guard anti-duplicados" del modo interno lee
//     window._cronosLastDispatchedMatch en `_autoAlreadyRan`... y el `if` que
//     lo consume esta VACIO. La variable se calcula y no se usa. El unico
//     efecto real del auto-despacho previo es reutilizar su matchId. Parte 6a.
//  3. showToast/showSpinner se llaman sin guarda typeof en varios puntos.
//  4. El modo WhatsApp escalona window.open cada 800 ms y el email abre un
//     mailto por destinatario; ninguno de los dos escribe en Firestore.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'comms', 'panel.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'comms', 'match-reports-send.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Envio MANUAL de informes — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('async function sendMatchReportsToParents()');
    if (s === -1) throw new Error('No se encontro sendMatchReportsToParents en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    // Fin = el arranque de la mitad 6b, que se queda en panel.js hasta su paso.
    const e = src.indexOf('async function autoDispatchMatchReports()', s);
    if (e === -1) throw new Error('No se encontro el final de la seccion');
    const cut = src.slice(s, e);
    // ⚠️ OJO: _executeReportsSend termina con `}` A SECAS, no con `};` (la
    // asignacion se apoya en el punto y coma automatico). Cortar por
    // lastIndexOf('};') trunca la funcion a la mitad y produce un
    // "Unexpected end of input" al meterlo en el sandbox. Se corta por la
    // ultima llave de cierre a principio de linea.
    return cut.slice(0, cut.lastIndexOf('\n}') + 2);
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

const MOVED = ['sendMatchReportsToParents', 'buildConvocationRecipientsHTML',
               'saveMatchReportPreselection', '_buildGlobalReportText',
               '_buildIndividualReportText', '_executeReportsSend'];

// ── DOM minimo ───────────────────────────────────────────────────────────
const mkEl = (extra) => Object.assign({
    innerHTML: '', value: '', textContent: '', checked: false, innerText: '',
    style: {}, dataset: {},
    querySelector: () => null, querySelectorAll: () => [],
}, extra || {});

function buildSandbox({
    me = { uid: 'coach1', clubId: 'club1', email: 'c@x.com', displayName: 'Entre' },
    noUser = false, noAuth = false, noModal = false,
    players = [{ name: 'Ana', alias: 'Ana', number: '7', team: 'home', time: 3000, goals: 1, cards: 'ninguna', history: [] }],
    recipients = [],          // lo que devuelve sharedGetSelectedRecipients
    contacts = [],            // emailConfig.contacts
    links = [],               // cronos_player_links
    convRows = null,          // .conv-row.conv-selected  (null = modo partido)
    roster = { f7: [], f11: [] },
    store = {},               // localStorage
    parentTargets = [],       // lo que devuelve _cronosResolveParentReportTargets
    staffFromGetStaff = [],
    lastDispatched = null,
    lastAutoMatchId = null,
    updateThrows = null,      // fuerza el camino updateDoc -> setDoc
    setDocThrows = null,
    scoreHome = '2', scoreAway = '1',
} = {}) {
    const toasts = [], spinners = [], opened = [], written = [], logs = [];
    const convoCalls = [];
    const els = {};
    const el = (id) => (els[id] = els[id] || mkEl());
    const modal = noModal ? null : el('setup-modal');
    el('score-home').textContent = scoreHome;
    el('score-away').textContent = scoreAway;
    el('rpt-msg');

    const snapOf = (docs) => ({ forEach: (fn) => docs.forEach(d => fn({ id: d._id || d.id || 'auto', data: () => d })) });
    const fakeFS = {
        db: {},
        collection: (db, n) => ({ __col: n }),
        query: (c, ...w) => ({ __col: c.__col, w }),
        where: (f, o, v) => ({ f, o, v }),
        getDocs: async (q) => snapOf(q.__col === 'cronos_player_links' ? links : []),
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async () => ({ exists: () => false, data: () => undefined }),
        setDoc: async (ref, data) => {
            if (setDocThrows) throw new Error(setDocThrows);
            written.push({ op: 'set', col: ref.__col, id: ref.__id, data });
        },
        updateDoc: async (ref, data) => {
            if (updateThrows) throw new Error(updateThrows);
            written.push({ op: 'update', col: ref.__col, id: ref.__id, data });
        },
        arrayUnion: (...i) => ({ __arrayUnion: i }),
    };

    const sandbox = {
        // ⚠️ window sera el propio objeto de contexto (se enlaza tras
        // createContext). Con un window aparte, las llamadas peladas entre las
        // funciones del bloque lanzarian ReferenceError.
        _cronosCurrentUser: noUser ? null : me,
        _cronos_auth: noAuth ? null : { db: fakeFS.db },
        players,
        _cronosLastDispatchedMatch: lastDispatched,
        _cronosLastAutoDispatchMatchId: lastAutoMatchId,
        open: (u) => opened.push(u),
        formatTime: (s) => String(Math.floor((s || 0) / 60)),
        document: {
            getElementById: (id) => (id === 'setup-modal' && noModal ? null : el(id)),
            querySelectorAll: (s) => {
                if (s === '.conv-row.conv-selected') return convRows || [];
                if (s === '.rpt-recipient-chk:checked') return (store.__chk || []);
                return [];
            },
        },
        console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        parseInt, parseFloat, isNaN, RegExp, Error,
        encodeURIComponent, decodeURIComponent,
        setTimeout: (fn, ms) => { try { fn(); } catch (e) {} return 0; },
        clearTimeout: () => {},
        localStorage: {
            getItem: (k) => (k === 'cronos_master_roster' ? JSON.stringify(roster) : (k in store ? store[k] : null)),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
        },
        emailConfig: { contacts },
        currentMode: 'f11',
        currentCategory: 'Alevin',
        TEAM_NAMES: { home: 'CD Local', away: 'CD Rival' },
        escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
        escapeAttr: (s) => String(s == null ? '' : s).replace(/"/g, '&quot;'),
        showToast: (m) => toasts.push(String(m)),
        showSpinner: (m) => spinners.push({ on: true, msg: m }),
        hideSpinner: () => spinners.push({ on: false }),
        loadEmailConfig: async () => {},
        openConvocationModal: () => convoCalls.push(1),
        // de js/shared/whatsapp-email.js
        sharedGetSelectedRecipients: () => recipients,
        sharedBuildRecipientsHTML: () => '<!--shared-->',
        // los OCHO helpers de panel.js que se quedan alli
        _cFS: async () => Object.assign({ db: fakeFS.db }, fakeFS),
        _cGetStaff: async () => staffFromGetStaff,
        _cMatchSubcatFor: () => 'A',
        _cMyTeamKey: () => 'home',
        _cResolveClubId: async () => me && me.clubId,
        _cStaffThreadId: (clubId, coachUid, staffUid) => 'th_' + clubId + '_' + coachUid + '_' + staffUid,
        _cronosResolveParentReportTargets: () => parentTargets,
        _parseHistoryForFirestore: (raw) => (Array.isArray(raw) ? raw : []),
    };
    vm.createContext(sandbox);
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    // v580 · la plantilla es DEL EQUIPO y se lee por accesor. Se estabula
    // contra el mismo almacen de mentira del arnes (ver js/core/utils.js).
    sandbox.window.cronosPlantillaAmbas = function () {
        try { return JSON.parse(sandbox.localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}'); }
        catch (e) { return { f7: [], f11: [] }; }
    };

    vm.runInContext(BLOCK, sandbox);

    return { g: sandbox, w: sandbox, toasts, spinners, opened, written, logs, convoCalls,
             store, modal, el: (id) => els[id] };
}

const inCol = (written, col) => written.filter(w => w.col === col);

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura y acoplamiento ──');
    ok('1a · las seis piezas estan en el bloque',
        /^async function sendMatchReportsToParents\(\)/m.test(BLOCK)
        && /^function buildConvocationRecipientsHTML\(/m.test(BLOCK)
        && /^window\.saveMatchReportPreselection = function\(\)/m.test(BLOCK)
        && /^function _buildGlobalReportText\(\)/m.test(BLOCK)
        && /^function _buildIndividualReportText\(/m.test(BLOCK)
        && /^window\._executeReportsSend = async function\(method\)/m.test(BLOCK));
    // Las dos funciones de 6b se NOMBRAN en comentarios dentro de esta mitad
    // (el guard anti-duplicados las menciona), asi que hay que comprobar que
    // no esta su DECLARACION, no que no aparezca el nombre.
    ok('1b · la mitad AUTOMATICA (6b) NO viaja con el bloque',
        !/^async function (autoDispatchMatchReports|saveAllMatchReportsInternal)\(/m.test(BLOCK));
    {
        const panel = fs.readFileSync(ORIGIN, 'utf8');
        const names = new Set();
        for (const l of panel.split(/\r?\n/)) {
            let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
            m = l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\(|\{|[A-Za-z_$][\w$]*\s*=>)/); if (m) names.add(m[1]);
            m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
        }
        const used = [...names].filter(n => !MOVED.includes(n)
            && !['autoDispatchMatchReports', 'saveAllMatchReportsInternal'].includes(n)
            && new RegExp('\\b' + n.replace(/[$]/g, '\\$') + '\\b').test(BLOCK)).sort();
        // SIETE, no ocho: el §8 completo usa ocho, pero _cGetStaff se invoca
        // UNICAMENTE en la mitad automatica (6b). Al partir, cada mitad se
        // queda con los suyos.
        const esperados = ['_cFS', '_cMatchSubcatFor', '_cMyTeamKey', '_cResolveClubId',
                           '_cStaffThreadId', '_cronosResolveParentReportTargets', '_parseHistoryForFirestore'].sort();
        ok('1c · fan-out a panel.js = los SIETE helpers de esta mitad (_cGetStaff es de 6b)',
            JSON.stringify(used) === JSON.stringify(esperados), used);
    }
    {
        const callers = {};
        for (const f of walk(ROOT, [])) {
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            if (rel.startsWith('scripts/') || rel === 'sw.js') continue;
            // test_fixes_p1_p2.js es un test HUERFANO en la RAIZ del repo (junio,
            // fuera de scripts/, run-tests.js no lo ejecuta) que solo nombra
            // estas funciones en comentarios. No es un consumidor.
            if (/^test_.*\.js$/.test(rel)) continue;
            if (rel === 'js/coach/comms/panel.js' || rel === 'js/coach/comms/match-reports-send.js') continue;
            const txt = fs.readFileSync(f, 'utf8');
            for (const n of MOVED) if (new RegExp('\\b' + n + '\\b').test(txt)) (callers[n] = callers[n] || []).push(rel);
        }
        ok('1d · fan-in externo = solo team-persistence.js llamando a sendMatchReportsToParents',
            JSON.stringify(callers) === JSON.stringify({ sendMatchReportsToParents: ['js/match/persistence/team-persistence.js'] }),
            callers);
        ok('1e · y esa llamada esta protegida con typeof',
            /typeof sendMatchReportsToParents === 'function'/.test(
                fs.readFileSync(path.join(ROOT, 'js', 'match', 'persistence', 'team-persistence.js'), 'utf8')));
    }
    {
        const panel = fs.readFileSync(ORIGIN, 'utf8');
        const dangling = /^window\.sendMatchReportsToParents\s*=\s*sendMatchReportsToParents\s*;/m.test(panel);
        // ANTES de mover, el alias con nombre pelado es correcto (la funcion
        // esta en el mismo archivo). DESPUES, seria ReferenceError en carga.
        ok('1f · ⚠️ el alias de exports es coherente con donde vive la funcion',
            IS_EXTRACTED ? !dangling : dangling,
            { extraido: IS_EXTRACTED, aliasConNombrePelado: dangling });
    }
    ok('1g · ninguna escritura a Firestore fuera del modo interno',
        !/setDoc|updateDoc/.test(BLOCK.slice(BLOCK.indexOf("if (method === 'wa')"), BLOCK.indexOf('MODO INTERNO'))));
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        ok('1h · match-reports-send.js se carga despues de comms/panel.js',
            idxHtml.indexOf('js/coach/comms/match-reports-send.js') > idxHtml.indexOf('js/coach/comms/panel.js'));
        ok('1i · esta en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/comms/match-reports-send.js'));
        ok('1j · esta en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/comms/match-reports-send.js'));
        ok('1k · esta en la cadena del guard de carga',
            fs.readFileSync(path.join(ROOT, 'scripts', 'test_extracted_modules_load.js'), 'utf8')
                .includes('js/coach/comms/match-reports-send.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · sendMatchReportsToParents: la modal ──');
    {
        const t = buildSandbox({ noModal: true });
        await t.w.sendMatchReportsToParents();
        ok('2a · sin la modal en el DOM sale sin hacer nada', t.modal === null);
    }
    {
        const t = buildSandbox({ noUser: true });
        await t.w.sendMatchReportsToParents();
        ok('2b · sin usuario avisa y oculta la modal',
            t.toasts.some(x => x.includes('Usuario no identificado')) && t.modal.style.display === 'none');
    }
    {
        const t = buildSandbox({});   // modo partido: window.players tiene datos
        await t.w.sendMatchReportsToParents();
        ok('2c · en modo partido delega la lista en sharedBuildRecipientsHTML',
            t.modal.innerHTML.includes('<!--shared-->'), t.modal.innerHTML.slice(0, 80));
        // La modal tiene DOS papeles excluyentes: con partido en curso envia,
        // y en modo convocatoria (sin partido) solo guarda la preseleccion.
        ok('2d · con partido en curso ofrece ENVIAR y no el boton de guardar',
            /_executeReportsSend\('internal'\)/.test(t.modal.innerHTML)
            && !/saveMatchReportPreselection\(\)/.test(t.modal.innerHTML));
    }
    {
        // Modo setup (sin partido): saca los convocados del roster.
        const row = mkEl({ dataset: { index: '0' } });
        const t = buildSandbox({
            players: [],
            convRows: [row],
            roster: { f7: [], f11: [{ id: 'J-01', number: 7, alias: 'Ana' }] },
            contacts: [{ id: 'c1', type: 'parent', name: 'Madre', playerId: 'J-01', playerNumber: 7, tags: ['rpt'] }],
        });
        await t.w.sendMatchReportsToParents();
        ok('2f · en modo setup construye la lista desde la convocatoria',
            t.modal.innerHTML.includes('Madre') && !t.modal.innerHTML.includes('<!--shared-->'),
            t.modal.innerHTML.slice(0, 100));
        ok('2e · y ahi el boton es GUARDAR, sin opcion de enviar',
            /saveMatchReportPreselection\(\)/.test(t.modal.innerHTML)
            && !/_executeReportsSend\(/.test(t.modal.innerHTML));
    }
    {
        const t = buildSandbox({ players: [], convRows: [] });
        await t.w.sendMatchReportsToParents();
        ok('2g · en modo setup sin convocados avisa y abre la convocatoria',
            t.toasts.some(x => x.includes('selecciona jugadores')) && t.convoCalls.length === 1);
    }
    {
        // Fusion de contactos manuales con cronos_player_links.
        const row = mkEl({ dataset: { index: '0' } });
        const t = buildSandbox({
            players: [], convRows: [row],
            roster: { f7: [], f11: [{ id: 'J-01', number: 7, alias: 'Ana' }] },
            contacts: [],
            links: [{ _id: 'L1', parentUid: 'p7', parentName: 'De Firestore', playerId: 'J-01', playerNumber: 7 }],
        });
        await t.w.sendMatchReportsToParents();
        ok('2h · fusiona los vinculos de Firestore con los contactos manuales',
            t.modal.innerHTML.includes('De Firestore'), t.modal.innerHTML.slice(0, 100));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · buildConvocationRecipientsHTML ──');
    {
        const t = buildSandbox({});
        const cs = [
            { id: 's1', type: 'staff', name: 'Dir', tags: ['rpt'] },
            { id: 'p1', type: 'parent', name: 'Madre7', playerId: 'J-01', playerNumber: 7, tags: ['rpt'] },
            { id: 'p2', type: 'parent', name: 'Padre9', playerId: 'J-09', playerNumber: 9, tags: ['rpt'] },
        ];
        const h = t.w.buildConvocationRecipientsHTML({ ids: ['J-01'], numbers: [] }, 'rpt', cs);
        ok('3a · el staff pasa siempre, sin filtrar por convocatoria', h.includes('Dir'));
        ok('3b · filtra a los padres por playerId', h.includes('Madre7') && !h.includes('Padre9'));
        const h2 = t.w.buildConvocationRecipientsHTML({ ids: [], numbers: [9] }, 'rpt', cs);
        ok('3c · y por dorsal como alternativa', h2.includes('Padre9') && !h2.includes('Madre7'));
        ok('3d · sin nadie que mostrar pinta el aviso',
            t.w.buildConvocationRecipientsHTML({ ids: [], numbers: [] }, 'rpt', [])
                .includes('No hay contactos vinculados'));
    }
    {
        const t = buildSandbox({});
        const cs = [{ id: 'p1', type: 'parent', name: 'M', playerId: 'J-01', playerNumber: 7, tags: [] }];
        const h = t.w.buildConvocationRecipientsHTML({ ids: ['J-01'], numbers: [] }, 'rpt', cs);
        ok('3e · sin preseleccion, la palomilla depende de la etiqueta rpt', !/\bchecked\b/.test(h));
        const cs2 = [{ id: 'p1', type: 'parent', name: 'M', playerId: 'J-01', playerNumber: 7, tags: ['rpt'] }];
        ok('3f · con la etiqueta rpt viene marcada',
            /\bchecked\b/.test(t.w.buildConvocationRecipientsHTML({ ids: ['J-01'], numbers: [] }, 'rpt', cs2)));
    }
    {
        const t = buildSandbox({ store: { cronos_match_rpt_selection: JSON.stringify(['p1']) } });
        const cs = [
            { id: 'p1', type: 'parent', name: 'Si', playerId: 'J-01', playerNumber: 7, tags: [] },
            { id: 'p2', type: 'parent', name: 'No', playerId: 'J-02', playerNumber: 8, tags: ['rpt'] },
        ];
        const h = t.w.buildConvocationRecipientsHTML({ ids: ['J-01', 'J-02'], numbers: [] }, 'rpt', cs);
        ok('3g · ⚠️ la preseleccion guardada MANDA sobre la etiqueta rpt',
            /data-id="p1"[\s\S]{0,400}?checked/.test(h) && !/data-id="p2"[\s\S]{0,400}?checked/.test(h));
    }
    {
        const t = buildSandbox({});
        const h = t.w.buildConvocationRecipientsHTML({ ids: ['J-01'], numbers: [] }, 'rpt',
            [{ id: 'p1', type: 'parent', name: 'M', player: 'Ana', playerId: 'J-01', playerNumber: 7, phone: '600', email: 'm@x.com', tags: ['rpt'] }]);
        ok('3h · vuelca los data-* que lee el envio',
            h.includes('data-id="p1"') && h.includes('data-type="parent"')
            && h.includes('data-phone="600"') && h.includes('data-email="m@x.com"')
            && h.includes('data-playerid="J-01"') && h.includes('data-playernumber="7"'));
        ok('3i · usa la clase que espera sharedGetSelectedRecipients', h.includes('class="rpt-recipient-chk"'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · preseleccion y los dos generadores de texto ──');
    {
        const chks = [mkEl({ dataset: { id: 'a' } }), mkEl({ dataset: { id: 'b' } })];
        const t = buildSandbox({ store: { __chk: chks } });
        t.w.saveMatchReportPreselection();
        ok('4a · guarda los ids marcados en cronos_match_rpt_selection',
            t.store.cronos_match_rpt_selection === JSON.stringify(['a', 'b']), t.store.cronos_match_rpt_selection);
        ok('4b · confirma y vuelve a la convocatoria',
            t.toasts.some(x => x.includes('guardada')) && t.convoCalls.length === 1);
    }
    {
        const t = buildSandbox({
            players: [
                { name: 'Ana', number: '7', team: 'home', time: 3000, goals: 2, cards: 'amarilla' },
                { name: 'Rival', number: '1', team: 'away', time: 0, goals: 0 },
            ],
        });
        const txt = t.w._buildGlobalReportText();
        ok('4c · el resumen global lleva marcador, nombres y goles',
            /RESUMEN GLOBAL/.test(txt) && txt.includes('CD Local') && txt.includes('Ana') && txt.includes('2'));
        ok('4d · solo incluye a los jugadores propios (_cMyTeamKey)', !txt.includes('Rival —') && !/👤 Rival/.test(txt));
        ok('4e · la tarjeta amarilla sale con su icono', txt.includes('🟨'));
    }
    {
        const t = buildSandbox({});
        const txt = t.w._buildIndividualReportText({ name: 'Ana', number: '7', time: 3000, goals: 1, cards: 'roja', injured: true }, '2', '1', 'lunes');
        ok('4f · el informe individual lleva dorsal, minutos, goles, tarjeta y lesion',
            /INFORME INDIVIDUAL/.test(txt) && txt.includes('Dorsal 7') && txt.includes('🟥')
            && txt.includes('LESIONADO'), txt.slice(0, 90));
    }
    {
        const t = buildSandbox({ players: null });
        let threw = null;
        try { t.w._buildGlobalReportText(); } catch (e) { threw = e; }
        ok('4g · ⚠️ sin partido en curso _buildGlobalReportText LANZA (no se defiende)',
            threw !== null && /TypeError/.test(threw.constructor.name), threw && threw.message);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · _executeReportsSend: WhatsApp y Email ──');
    {
        const t = buildSandbox({ recipients: [] });
        await t.w._executeReportsSend('wa');
        ok('5a · sin destinatarios avisa y no hace nada',
            t.toasts.some(x => x.includes('al menos un destinatario')) && t.opened.length === 0);
    }
    {
        const t = buildSandbox({ noAuth: true, recipients: [{ id: 'x', type: 'staff', phone: '600' }] });
        await t.w._executeReportsSend('wa');
        ok('5b · sin sesion sale en silencio', t.toasts.length === 0 && t.opened.length === 0);
    }
    // ══════════════════════════════════════════════════════════════════
    //  v671 · EL MODO 'wa' SE HA RETIRADO (WhatsApp fuera de toda la app).
    //
    //  🔑 SE COMPRUEBA QUE NO ENVIA **Y QUE LO DICE**. Lo peligroso de
    //  retirar un canal no es que deje de funcionar: es que se caiga en
    //  silencio, o —peor— que reencamine por correo algo que alguien pidio
    //  mandar por WhatsApp. Por eso la rama sigue existiendo en el codigo,
    //  avisando y parando.
    // ══════════════════════════════════════════════════════════════════
    {
        const t = buildSandbox({
            recipients: [{ id: 's1', type: 'staff', phone: '600111', label: 'Dir' },
                         { id: 's2', type: 'staff', phone: '600222', email: 'c@x.com', label: 'Coord' }],
        });
        await t.w._executeReportsSend('wa');
        ok('5c · ⚠️ el modo WhatsApp NO abre nada, aunque haya telefonos',
            t.opened.length === 0, t.opened);
        ok('5d · 🔑 y avisa de que ese envio ya no existe (no falla en silencio)',
            t.toasts.some(x => /WhatsApp/i.test(x) && /(no est|retirad)/i.test(x)), t.toasts);
        ok('5e · ⚠️ ni lo reencamina por correo sin permiso',
            !t.opened.some(u => u.startsWith('mailto:')), t.opened);
        ok('5f · no escribe nada en Firestore', t.written.length === 0);
    }
    {
        // Y el CODIGO no puede conservar ni una URL de wa.me.
        // ⚠️ SIN COMENTARIOS. La nota que explica que ese envio se retiro
        //    nombra "wa.me", y sobre el fuente crudo esta asercion se
        //    dispara sola. Es la regla de este repo para cualquier
        //    comprobacion del tipo "esta cadena ya no puede estar".
        const _cod5g = BLOCK
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
        ok('5g · 🔑 el modulo no contiene ninguna llamada a wa.me',
            !/wa\.me/.test(_cod5g), (_cod5g.match(/wa\.me/g) || []).length);
    }
    {
        const t = buildSandbox({ recipients: [{ id: 'x', type: 'staff', email: 'a@x.com', label: 'D' }] });
        await t.w._executeReportsSend('email');
        ok('5h · el modo email abre mailto y no escribe en Firestore',
            t.opened.some(u => u.startsWith('mailto:')) && t.written.length === 0, t.opened);
    }
    {
        const t = buildSandbox({ recipients: [{ id: 'x', type: 'staff', label: 'D' }] });
        await t.w._executeReportsSend('email');
        ok('5i · sin ningun email avisa', t.toasts.some(x => x.includes('Email configurado')));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 6 · _executeReportsSend: modo interno (las escrituras) ──');
    ok('6a · ⚠️ el guard anti-duplicados calcula _autoAlreadyRan y su `if` esta VACIO',
        /const _autoAlreadyRan = !!window\._cronosLastDispatchedMatch;/.test(BLOCK)
        && /if \(_autoAlreadyRan\) \{\s*\}/.test(BLOCK.replace(/\r/g, '')));
    {
        const t = buildSandbox({
            recipients: [{ id: 'd1', type: 'staff', label: 'Dir' }],
            contacts: [{ id: 'd1', type: 'staff', uid: 'd1', email: 'd@x.com' }],
        });
        await t.w._executeReportsSend('internal');
        ok('6b · al staff le crea notificacion e hilo de mensajeria',
            inCol(t.written, 'cronos_notifications').length >= 1
            && inCol(t.written, 'cronos_messages').length >= 1,
            t.written.map(w => w.col));
        ok('6c · y escribe los informes de los jugadores en cronos_player_reports',
            inCol(t.written, 'cronos_player_reports').length >= 1);
        ok('6d · muestra el spinner y confirma con el contador',
            t.spinners.some(s => s.on) && t.toasts.some(x => /Informes enviados \(\d+\)/.test(x)), t.toasts);
    }
    {
        const t = buildSandbox({
            recipients: [{ id: 'p7', type: 'parent', label: 'Madre', email: 'm@x.com' }],
            parentTargets: [{ parentUid: 'p7', dorsal: '7', player: { name: 'Ana', number: '7', team: 'home', time: 3000, goals: 1, history: [] } }],
            contacts: [{ id: 'p7', type: 'parent', uid: 'p7', email: 'm@x.com', playerNumber: '7', tags: ['rpt'] }],
        });
        await t.w._executeReportsSend('internal');
        ok('6e · a los padres los resuelve con _cronosResolveParentReportTargets y les escribe informe',
            inCol(t.written, 'cronos_player_reports').length >= 1
            && inCol(t.written, 'cronos_messages').length >= 1, t.written.map(w => w.col + ':' + w.id));
    }
    {
        const t = buildSandbox({
            recipients: [{ id: 'd1', type: 'staff', label: 'Dir' }],
            contacts: [{ id: 'd1', type: 'staff', uid: 'd1' }],
            lastAutoMatchId: 'MATCH_DEL_AUTO',
        });
        await t.w._executeReportsSend('internal');
        ok('6f · reutiliza el matchId del auto-despacho para no duplicar documentos',
            t.written.some(w => JSON.stringify(w.data || {}).includes('MATCH_DEL_AUTO') || String(w.id).includes('MATCH_DEL_AUTO')),
            t.written.map(w => w.id).slice(0, 4));
    }
    {
        const t = buildSandbox({
            recipients: [{ id: 'd1', type: 'staff', label: 'Dir' }],
            contacts: [{ id: 'd1', type: 'staff', uid: 'd1' }],
            updateThrows: 'no existe',
        });
        await t.w._executeReportsSend('internal');
        ok('6g · si updateDoc falla cae a setDoc para crear el hilo (patron FIX v176)',
            inCol(t.written, 'cronos_messages').some(w => w.op === 'set'),
            inCol(t.written, 'cronos_messages').map(w => w.op));
    }
    {
        const t = buildSandbox({
            recipients: [{ id: 'd1', type: 'staff', label: 'Dir' }],
            contacts: [{ id: 'd1', type: 'staff', uid: 'd1' }],
            setDocThrows: 'sin red', updateThrows: 'sin red',
        });
        await t.w._executeReportsSend('internal');
        ok('6h · si todo falla avisa por toast y no se queda colgado',
            t.toasts.some(x => /Error al enviar|No se pudo enviar/.test(x)), t.toasts);
    }
    {
        const t = buildSandbox({ recipients: [{ id: 'zz', type: 'parent', label: 'X' }], parentTargets: [] });
        await t.w._executeReportsSend('internal');
        ok('6i · si ningun padre resuelve, avisa de que no se envio nada',
            t.toasts.some(x => x.includes('No se pudo enviar ningún informe')), t.toasts);
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
