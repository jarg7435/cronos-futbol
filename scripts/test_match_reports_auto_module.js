// ─────────────────────────────────────────────────────────────────────────
// test_match_reports_auto_module.js · Refactor de monolitos (auditoria 2026-07-22)
// MONOLITO #3 (js/coach/comms/panel.js), PASO 6b, EL ULTIMO: extraccion del
// CAMINO AUTOMATICO de envio de informes (autoDispatchMatchReports +
// saveAllMatchReportsInternal, 510 lineas) a
// js/coach/comms/match-reports-auto.js.
//
// Escrito y ejecutado EN VERDE contra el codigo todavia SIN mover (Puerta 3).
//
// ── ESTA ES LA MITAD DELICADA DEL §8 ──
// saveAllMatchReportsInternal se ejecuta EN CADA ACCION DE JUGADOR durante un
// partido (js/match/events/player-actions.js) y al persistir el partido
// (js/match/persistence/active-match.js), las dos con guarda typeof. Y
// autoDispatchMatchReports es lo que hace que las familias reciban el informe
// al terminar. Aqui no hay codigo muerto que amortigue un error.
//
// ── LO QUE DE VERDAD HAY QUE PROTEGER: LOS GUARDS DE IDEMPOTENCIA ──
// El bug E4 historico era "informe individual TRIPLICADO a padres": el fin de
// partido se dispara desde varias rutas (endMatch manual, terminateMatch por
// expulsiones, fin automatico del crono) y cada una despachaba. Hoy lo
// impiden DOS guards que este test fija:
//   1. Persistente: localStorage `cronos_reports_sent_<matchId>`, que
//      sobrevive a recargas (parte 2).
//   2. En memoria: window._cronosLastDispatchedMatch con una huella del
//      partido, RESERVADA ANTES del await para cerrar la ventana de carrera
//      entre disparos casi simultaneos (parte 2).
// Y en autoDispatchMatchReports, un tercero igual de importante: el matchId
// es DETERMINISTA (uid + fecha + rival + marcador), NO Date.now(); si no, cada
// ejecucion crearia documentos nuevos y el padre veria el informe N veces
// (parte 3).
//
// ── FAN-OUT: SIETE helpers de panel.js ──
// _cGetStaff (que la mitad manual NO usaba), _cMatchSubcatFor, _cMyTeamKey,
// _cResolveClubId, _cStaffThreadId, _cronosResolveParentReportTargets y
// _parseHistoryForFirestore. Los siete se quedan.
// OJO: esta mitad NO usa _cFS(); hace su propio import() dinamico del SDK.
//
// ── ⚠️ LA TRAMPA DE v378, POR SEGUNDA VEZ ──
// panel.js conserva `window.saveAllMatchReportsInternal = saveAllMatchReportsInternal;`
// con el NOMBRE PELADO en su bloque de exports. Hay que convertirlo a
// autoasignacion en el MISMO commit. Lo vigilan la asercion 1e de aqui y
// scripts/test_extracted_modules_load.js.
//
// ── TESTS QUE HAY QUE ACTUALIZAR EN EL COMMIT DE EXTRACCION ──
//  · test_collective_report_module.js:1e — acota el CUERPO de
//    autoDispatchMatchReports con indexOf sobre panel.js. Se pondria roja.
//  · test_p11d_collective_write.js — concatena panel.js + collective-report.js;
//    dos de sus seis aserciones viven en este bloque.
//  · test_sec_c1_clubid.js / test_p11c_clubid_rule.js ya quedaron preparados
//    en el paso 6a (su lista incluye match-reports-auto.js tras un existsSync).
// El metodo que los encontro: buscar las ASERCIONES QUE CUENTAN ocurrencias
// sobre el fuente de panel.js y evaluar si el bloque cambia su recuento. El
// barrido anterior solo veia literales que DESAPARECEN, y por eso se colaron
// los dos de _cResolveClubId en 6a.
//
// ── RAREZAS PREEXISTENTES QUE SE PRESERVAN ──
//  1. Al fallar, se libera la huella EN MEMORIA para permitir reintento, pero
//     NO se borra la clave persistente de localStorage: tras un error, el
//     reintento sigue bloqueado hasta que empiece un partido nuevo. Parte 2f.
//  2. autoDispatchMatchReports BORRA localStorage.cronos_match_rpt_selection
//     al terminar la fase de padres: la preseleccion es de un solo uso.
//  3. Un fallo de _cGetStaff se traga con console.warn en un try ANIDADO y el
//     despacho continua con los contactos de emailConfig.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'comms', 'panel.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'comms', 'match-reports-auto.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Despacho AUTOMATICO de informes — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('async function autoDispatchMatchReports()');
    if (s === -1) throw new Error('No se encontro autoDispatchMatchReports en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    const e = src.indexOf('GESTIÓN DE CONTACTOS (Teléfonos WhatsApp)', s);
    if (e === -1) throw new Error('No se encontro el final de la seccion');
    const cut = src.slice(s, e);
    // Ambas funciones terminan con `}` a principio de linea (son declaraciones).
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

const MOVED = ['autoDispatchMatchReports', 'saveAllMatchReportsInternal'];
const mkEl = () => ({ innerHTML: '', value: '', textContent: '', style: {}, dataset: {} });

function buildSandbox({
    me = { uid: 'coach1', clubId: 'club1', email: 'c@x.com', displayName: 'Entre' },
    noUser = false, noPlayers = false,
    players = [{ name: 'Ana', number: '7', team: 'home', time: 3000, goals: 1, cards: 'ninguna', history: [] }],
    contacts = [],
    links = [],
    staff = [],
    staffThrows = null,
    parentTargets = [],
    store = {},
    scoreHome = '2', scoreAway = '1',
    liveMatchId = null,
    lastDispatched = undefined,
    updateThrows = null,
    setDocThrows = null,
    resolveStaffForMatch = null,
} = {}) {
    const toasts = [], logs = [], written = [];
    const els = {};
    const el = (id) => (els[id] = els[id] || mkEl());
    el('score-home').textContent = scoreHome;
    el('score-away').textContent = scoreAway;

    const snapOf = (docs) => ({ forEach: (fn) => docs.forEach(d => fn({ id: d._id || d.id || 'auto', data: () => d })) });
    const fsApi = {
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
        _cronosCurrentUser: noUser ? null : me,
        _cronos_auth: { db: {} },
        players: noPlayers ? null : players,
        liveMatchId,
        _cronosLastDispatchedMatch: lastDispatched,
        _cronosLastAutoDispatchMatchId: undefined,
        _currentMatchCategory: 'Alevin',
        open: () => {},
        document: { getElementById: (id) => el(id) },
        console: {
            log: (...a) => logs.push(a.join(' ')),
            warn: (...a) => logs.push(a.join(' ')),
            error: (...a) => logs.push(a.join(' ')),
        },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        parseInt, isNaN, RegExp, Error,
        setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
        },
        emailConfig: { contacts },
        currentMode: 'f11',
        currentCategory: 'Alevin',
        TEAM_NAMES: { home: 'CD Local', away: 'CD Rival' },
        escapeHtml: (s) => String(s == null ? '' : s),
        // OJO: la FASE B llama a formatTime() PELADO. Sin el, cada padre
        // revienta dentro de su try/catch individual y su informe se pierde en
        // silencio — que es justo lo que demuestra la asercion 4k.
        formatTime: (s) => String(Math.floor((s || 0) / 60)),
        showToast: (m) => toasts.push(String(m)),
        loadEmailConfig: async () => {},
        // los SIETE helpers de panel.js que se quedan alli
        _cGetStaff: async () => { if (staffThrows) throw new Error(staffThrows); return staff; },
        _cMatchSubcatFor: () => 'A',
        _cMyTeamKey: () => 'home',
        _cResolveClubId: async () => me && me.clubId,
        _cStaffThreadId: (clubId, coachUid, staffUid) => 'th_' + clubId + '_' + coachUid + '_' + staffUid,
        _cronosResolveParentReportTargets: () => parentTargets,
        _parseHistoryForFirestore: (raw) => (Array.isArray(raw) ? raw : []),
    };
    if (resolveStaffForMatch) sandbox._cronosResolveStaffForMatch = resolveStaffForMatch;
    sandbox._cronosMatchModality = () => 'f11';

    // Esta mitad NO usa _cFS(): importa el SDK con import() dinamico.
    const patched = BLOCK.replace(/\bimport\s*\(/g, '__imp(');
    sandbox.__imp = async () => fsApi;

    vm.createContext(sandbox);
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.runInContext(patched, sandbox);

    return { g: sandbox, w: sandbox, toasts, logs, written, store, el: (id) => els[id] };
}

const inCol = (written, col) => written.filter(w => w.col === col);

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura y acoplamiento ──');
    ok('1a · las dos funciones estan en el bloque',
        /^async function autoDispatchMatchReports\(\)/m.test(BLOCK)
        && /^async function saveAllMatchReportsInternal\(\)/m.test(BLOCK));
    ok('1b · la mitad MANUAL (6a) NO viaja con el bloque',
        !/^window\._executeReportsSend|^async function sendMatchReportsToParents/m.test(BLOCK));
    {
        const panel = fs.readFileSync(ORIGIN, 'utf8');
        const names = new Set();
        for (const l of panel.split(/\r?\n/)) {
            let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
            m = l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function|\(|\{|[A-Za-z_$][\w$]*\s*=>)/); if (m) names.add(m[1]);
            m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
        }
        const used = [...names].filter(n => !MOVED.includes(n)
            && new RegExp('\\b' + n.replace(/[$]/g, '\\$') + '\\b').test(BLOCK)).sort();
        const esperados = ['_cGetStaff', '_cMatchSubcatFor', '_cMyTeamKey', '_cResolveClubId',
                           '_cStaffThreadId', '_cronosResolveParentReportTargets', '_parseHistoryForFirestore'].sort();
        ok('1c · fan-out a panel.js = los SIETE helpers de esta mitad (incluye _cGetStaff)',
            JSON.stringify(used) === JSON.stringify(esperados), used);
    }
    ok('1d · NO usa _cFS(): hace su propio import() dinamico del SDK',
        !/_cFS\(\)/.test(BLOCK) && /await import\(/.test(BLOCK));
    {
        const panel = fs.readFileSync(ORIGIN, 'utf8');
        const dangling = /^window\.saveAllMatchReportsInternal\s*=\s*saveAllMatchReportsInternal\s*;/m.test(panel);
        ok('1e · ⚠️ el alias de exports es coherente con donde vive la funcion',
            IS_EXTRACTED ? !dangling : dangling,
            { extraido: IS_EXTRACTED, aliasConNombrePelado: dangling });
        ok('1f · _cronosForceRedispatch sigue en panel.js y la llama (se resuelve en tiempo de llamada)',
            /window\._cronosForceRedispatch/.test(panel) && /await autoDispatchMatchReports\(\);/.test(panel));
    }
    {
        const callers = {};
        for (const f of walk(ROOT, [])) {
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            if (rel.startsWith('scripts/') || rel === 'sw.js' || /^test_.*\.js$/.test(rel)) continue;
            if (rel === 'js/coach/comms/panel.js' || rel === 'js/coach/comms/match-reports-auto.js') continue;
            const txt = fs.readFileSync(f, 'utf8');
            // solo llamadas reales, no menciones en comentarios
            const code = txt.split('\n').map(l => l.trim().replace(/^\/\/.*$/, '')).join('\n');
            for (const n of MOVED) if (new RegExp('\\b' + n + '\\s*\\(').test(code)) (callers[n] = callers[n] || []).push(rel);
        }
        ok('1g · fan-in externo REAL: solo player-actions.js y active-match.js llaman a saveAllMatchReportsInternal',
            JSON.stringify(callers) === JSON.stringify({
                saveAllMatchReportsInternal: ['js/match/events/player-actions.js', 'js/match/persistence/active-match.js'],
            }), callers);
    }
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        ok('1h · match-reports-auto.js se carga despues de comms/panel.js',
            idxHtml.indexOf('js/coach/comms/match-reports-auto.js') > idxHtml.indexOf('js/coach/comms/panel.js'));
        ok('1i · esta en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/comms/match-reports-auto.js'));
        ok('1j · esta en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/comms/match-reports-auto.js'));
        ok('1k · esta en la cadena del guard de carga',
            fs.readFileSync(path.join(ROOT, 'scripts', 'test_extracted_modules_load.js'), 'utf8')
                .includes('js/coach/comms/match-reports-auto.js'));
        ok('1l · test_collective_report_module.js y test_p11d_collective_write.js ya leen el archivo nuevo',
            fs.readFileSync(path.join(ROOT, 'scripts', 'test_collective_report_module.js'), 'utf8')
                .includes('match-reports-auto.js')
            && fs.readFileSync(path.join(ROOT, 'scripts', 'test_p11d_collective_write.js'), 'utf8')
                .includes('match-reports-auto.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · ⚠️ saveAllMatchReportsInternal: los guards anti-duplicado ──');
    {
        const t = buildSandbox({ noUser: true });
        await t.w.saveAllMatchReportsInternal();
        ok('2a · sin usuario no hace nada', t.written.length === 0);
        const t2 = buildSandbox({ noPlayers: true });
        await t2.w.saveAllMatchReportsInternal();
        ok('2b · sin partido en curso tampoco', t2.written.length === 0);
    }
    {
        const t = buildSandbox({ parentTargets: [] });
        await t.w.saveAllMatchReportsInternal();
        const clave = Object.keys(t.store).find(k => k.startsWith('cronos_reports_sent_'));
        ok('2c · marca el guard PERSISTENTE en localStorage', !!clave, Object.keys(t.store));
        ok('2d · y reserva la huella en memoria antes de despachar',
            typeof t.w._cronosLastDispatchedMatch === 'string', t.w._cronosLastDispatchedMatch);
        const nEscrituras = t.written.length;
        await t.w.saveAllMatchReportsInternal();
        ok('2e · ⚠️ una SEGUNDA llamada no vuelve a despachar (bug E4: informe triplicado)',
            t.written.length === nEscrituras, { antes: nEscrituras, despues: t.written.length });
    }
    {
        // Guard persistente ya puesto de una sesion anterior (simula recarga).
        const t = buildSandbox({ liveMatchId: 'LM1', store: { 'cronos_reports_sent_LM1': '123' } });
        await t.w.saveAllMatchReportsInternal();
        ok('2f · el guard persistente sobrevive a una recarga y bloquea el reenvio',
            t.written.length === 0, t.written.length);
    }
    {
        const t = buildSandbox({ liveMatchId: 'LM2', lastDispatched: 'live:LM2' });
        await t.w.saveAllMatchReportsInternal();
        ok('2g · la huella en memoria tambien bloquea por si sola',
            t.written.length === 0 && !Object.keys(t.store).length === false, t.written.length);
    }
    {
        const t = buildSandbox({ liveMatchId: 'LM3', setDocThrows: 'sin red' });
        await t.w.saveAllMatchReportsInternal();
        // ⚠️ DEFECTO PREEXISTENTE, FIJADO TAL CUAL. El catch de
        // saveAllMatchReportsInternal dice "Si falló, liberar la huella para
        // permitir reintento manual"... pero autoDispatchMatchReports tiene su
        // PROPIO try/catch exterior que se traga cualquier error y solo hace
        // console.error. Asi que el catch de fuera NUNCA se ejecuta y la huella
        // no se libera jamas. Si algun dia se arregla (propagando el error o
        // devolviendo un booleano), es ESTA asercion la que hay que cambiar.
        ok('2h · ⚠️ tras un fallo la huella NO se libera: el catch exterior es inalcanzable',
            t.w._cronosLastDispatchedMatch === 'live:LM3', t.w._cronosLastDispatchedMatch);
        ok('2i · ⚠️ y la clave persistente tampoco se borra: no hay reintento posible',
            !!t.store['cronos_reports_sent_LM3'], Object.keys(t.store));
        ok('2k · el error del despacho si queda registrado en consola',
            t.logs.some(l => l.includes('[AutoDispatch] Error')), t.logs.slice(0, 2));
    }
    ok('2j · la huella se reserva ANTES del await (ventana de carrera cerrada)',
        BLOCK.indexOf('window._cronosLastDispatchedMatch = _matchFingerprint;')
        < BLOCK.indexOf('await autoDispatchMatchReports();'));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · ⚠️ autoDispatchMatchReports: matchId determinista ──');
    {
        const t = buildSandbox({});
        await t.w.autoDispatchMatchReports();
        const id1 = t.w._cronosLastAutoDispatchMatchId;
        const t2 = buildSandbox({});
        await t2.w.autoDispatchMatchReports();
        ok('3a · ⚠️ el matchId es DETERMINISTA: dos ejecuciones dan el mismo id',
            typeof id1 === 'string' && id1 === t2.w._cronosLastAutoDispatchMatchId, id1);
        ok('3b · y se compone de uid, fecha, rival y marcador (no Date.now())',
            /^match_coach1_\d{4}-\d{2}-\d{2}_cd_rival_2x1$/.test(id1), id1);
        ok('3c · lo publica para que el envio manual lo reutilice',
            !!t.w._cronosLastAutoDispatchMatchId);
    }
    {
        const t = buildSandbox({ scoreHome: '3', scoreAway: '0' });
        await t.w.autoDispatchMatchReports();
        ok('3d · un marcador distinto produce otro matchId (partido distinto)',
            /_3x0$/.test(t.w._cronosLastAutoDispatchMatchId), t.w._cronosLastAutoDispatchMatchId);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · las tres fases ──');
    {
        const t = buildSandbox({
            staff: [{ uid: 'd1', role: 'director', email: 'd@x.com' }],
            parentTargets: [{ parentUid: 'p7', dorsal: '7', player: { name: 'Ana', number: '7', team: 'home', time: 3000, goals: 1, history: [] } }],
        });
        await t.w.autoDispatchMatchReports();
        ok('4a · FASE A: escribe informes y notifica al staff',
            inCol(t.written, 'cronos_player_reports').length >= 1
            && inCol(t.written, 'cronos_notifications').some(n => /notif_global_rpt_d1_/.test(n.id)),
            t.written.map(w => w.col + ':' + w.id).slice(0, 6));
        ok('4b · FASE B: escribe el informe del padre y le abre hilo',
            inCol(t.written, 'cronos_messages').length >= 1
            && inCol(t.written, 'cronos_notifications').some(n => /notif_indiv_rpt_p7_/.test(n.id)),
            inCol(t.written, 'cronos_notifications').map(n => n.id));
        ok('4c · FASE C: deja la copia del entrenador marcada con _forCoach',
            inCol(t.written, 'cronos_player_reports').some(w => w.data && w.data._forCoach === true));
        ok('4d · ⚠️ FIX P11-D: staffUids incluye SIEMPRE al propio entrenador',
            inCol(t.written, 'cronos_player_reports').some(w =>
                Array.isArray(w.data.staffUids) && w.data.staffUids.includes('coach1')),
            (inCol(t.written, 'cronos_player_reports')[0] || {}).data);
        ok('4e · confirma con un toast', t.toasts.some(x => x.includes('automáticamente')), t.toasts);
    }
    {
        const t = buildSandbox({ staff: [], parentTargets: [] });
        await t.w.autoDispatchMatchReports();
        ok('4f · ⚠️ sin staff sigue escribiendo, con staffUids = [me.uid]',
            inCol(t.written, 'cronos_player_reports').some(w =>
                Array.isArray(w.data.staffUids) && w.data.staffUids.join() === 'coach1'),
            (inCol(t.written, 'cronos_player_reports')[0] || {}).data);
    }
    {
        const t = buildSandbox({ staffThrows: 'sin permisos', contacts: [{ type: 'staff', uid: 'x9', email: 'x9@x.com' }] });
        await t.w.autoDispatchMatchReports();
        ok('4g · un fallo de _cGetStaff se traga con un aviso y el despacho continua',
            t.logs.some(l => l.includes('_cGetStaff falló')) && t.written.length > 0, t.logs.slice(0, 2));
    }
    {
        let called = null;
        const t = buildSandbox({
            staff: [{ uid: 'd1', role: 'director' }, { uid: 'c1', role: 'coordinator', coordinatorType: 'f7' }],
            resolveStaffForMatch: (list, cat, mode) => { called = { n: list.length, cat, mode }; return [{ uid: 'd1', role: 'director' }]; },
        });
        await t.w.autoDispatchMatchReports();
        ok('4h · delega el filtro de coordinadores por modalidad en _cronosResolveStaffForMatch',
            called !== null && called.n === 2, called);
    }
    {
        const t = buildSandbox({
            store: { cronos_match_rpt_selection: JSON.stringify(['p7']) },
            parentTargets: [{ parentUid: 'p7', dorsal: '7', player: { name: 'Ana', number: '7', team: 'home', history: [] } }],
        });
        await t.w.autoDispatchMatchReports();
        ok('4i · ⚠️ la preseleccion del partido es de UN SOLO USO: se borra al terminar',
            !('cronos_match_rpt_selection' in t.store), t.store);
    }
    {
        const t = buildSandbox({
            staff: [{ uid: 'd1', role: 'director' }],
            updateThrows: 'no existe',
        });
        await t.w.autoDispatchMatchReports();
        ok('4j · si updateDoc falla cae a setDoc para crear el hilo',
            inCol(t.written, 'cronos_messages').some(w => w.op === 'set'),
            inCol(t.written, 'cronos_messages').map(w => w.op));
    }
    {
        // FIX v176: cada padre va en su PROPIO try/catch, para que un fallo con
        // uno no impida el envio al resto. Se comprueba haciendo reventar al
        // primero (su `player` no trae los campos que usa el texto) y viendo
        // que el segundo llega igualmente.
        const t = buildSandbox({
            parentTargets: [
                { parentUid: 'pMalo', dorsal: '9', player: null },
                { parentUid: 'pBueno', dorsal: '7', player: { name: 'Ana', number: '7', team: 'home', time: 3000, goals: 1, history: [] } },
            ],
        });
        await t.w.autoDispatchMatchReports();
        const ids = inCol(t.written, 'cronos_player_reports').map(w => w.id).join(' ');
        ok('4k · ⚠️ un padre que falla NO tumba a los demas (cada uno en su try/catch)',
            ids.includes('pBueno') && !ids.includes('pMalo'), ids);
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
