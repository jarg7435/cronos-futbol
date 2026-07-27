// ─────────────────────────────────────────────────────────────────────────
// test_collective_report_module.js · Refactor de monolitos (auditoría 2026-07-22)
// MONOLITO #3 (js/coach/comms/panel.js), PASO 2 de 6: extracción de
// "Informe colectivo → directores y coordinadores" (openCollectiveReport /
// _sendCollectiveReportNow) a js/coach/comms/collective-report.js.
//
// Escrito y ejecutado EN VERDE contra el código todavía SIN mover (Puerta 3).
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
//  · Fan-in externo = 0. Una búsqueda estática en TODO el repositorio no
//    encontró ningún invocador de openCollectiveReport (ni onclick, ni llamada
//    JS, ni window[nombre]()). El autor indica que el informe colectivo sí se
//    usa, generado en segundo plano al terminar un partido; conviene saber que
//    el despacho automático localizable estáticamente es
//    autoDispatchMatchReports, que se QUEDA en panel.js y NO llama a estas dos
//    funciones. La parte 1 fija esa separación para que quede documentada.
//  · Estado compartido entre las dos: window._collectiveReportStaff y
//    window._collectiveReportText, que openCollectiveReport deja preparados.
//  · Depende de _cFS() y _cGetStaff() (SE QUEDAN en panel.js),
//    _cronosResolveStaffForMatch (core/utils.js), escapeHtml, showToast /
//    showSpinner / hideSpinner y openUnifiedCommsMenu (§11, paso 5).
//  · ⚠️ `emailConfig` es un GLOBAL LÉXICO (`let` en app-init.js:136), no una
//    propiedad de window; se lee con `typeof emailConfig !== 'undefined'`, una
//    guarda que para un `let` en zona muerta temporal lanzaría en vez de
//    devolver 'undefined'. Inocua hoy porque sólo corre en tiempo de click.
//
// ── ⚠️ LO QUE DE VERDAD HAY QUE PROTEGER: EL FIX P11-D ──
// _sendCollectiveReportNow NO debe abortar cuando la lista de staff viene
// vacía, y staffUids debe incluir SIEMPRE me.uid (_collStaffUids). Sin eso, la
// Query B (array-contains) del Panel de Informes se queda sin resultados y el
// partido recién jugado NO aparece. Lo vigila también
// scripts/test_p11d_collective_write.js, que por esta extracción pasa a leer
// panel.js Y collective-report.js: 3 de sus 6 aserciones viven en el bloque
// que se mueve (las otras 2 están en autoDispatchMatchReports y caerán en el
// paso 6).
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'comms', 'panel.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'comms', 'collective-report.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Informe colectivo — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('window.openCollectiveReport = async function openCollectiveReport()');
    if (s === -1) throw new Error('No se encontró openCollectiveReport en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    const e = src.indexOf('INFORMES INDIVIDUALES', s);
    if (e === -1) throw new Error('No se encontró el final de la sección');
    const cut = src.slice(s, e);
    return cut.slice(0, cut.lastIndexOf('};') + 2);
}
const BLOCK = readBlock();

function buildSandbox({
    me = { uid: 'coach1', clubId: 'club1', email: 'c@x.com', displayName: 'Entre' },
    staffFromGetStaff = [],
    emailContacts = [],
    resolveStaff = null,          // filtro por modalidad; null = no disponible
    players = null,
    noModal = false,
    getStaffThrows = null,
    setDocThrows = null,
    preparedStaff = undefined,    // para invocar _sendCollectiveReportNow directamente
    preparedText = undefined,
    lastMatchId = undefined,
} = {}) {
    const written = [];
    const toasts = [];
    const spinners = [];
    const logs = [];
    const menuCalls = [];
    const els = {};
    const el = (id, extra) => (els[id] = Object.assign(
        { id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {} }, extra));
    const modal = noModal ? null : el('setup-modal');
    el('score-home', { textContent: '3' });
    el('score-away', { textContent: '1' });
    el('coll-rpt-staff-list');

    const fakeFS = {
        db: {},
        doc: (db, col, id) => ({ __col: col, __id: id }),
        setDoc: async (ref, data) => {
            if (setDocThrows) throw new Error(setDocThrows);
            written.push({ op: 'set', col: ref.__col, id: ref.__id, data });
        },
        updateDoc: async (ref, data) => { written.push({ op: 'update', col: ref.__col, id: ref.__id, data }); },
        getDoc: async (ref) => ({ exists: () => false, data: () => undefined }),
        arrayUnion: (...i) => ({ __arrayUnion: i }),
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: me,
            _cronos_auth: { db: fakeFS.db },
            players: players,
            _collectiveReportStaff: preparedStaff,
            _collectiveReportText: preparedText,
            _cronosLastAutoDispatchMatchId: lastMatchId,
            open: () => {},
        },
        document: {
            getElementById: (id) => (id === 'setup-modal' ? modal : (els[id] || null)),
            querySelectorAll: () => [],
        },
        console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        // La rama de WhatsApp usa setTimeout/encodeURIComponent/window.open:
        // sin ellos el catch general convertia el envio en un toast de error.
        setTimeout: (fn, ms) => 0, clearTimeout: () => {}, encodeURIComponent,
        TEAM_NAMES: { home: 'CD Local', away: 'CD Rival' },
        emailConfig: { contacts: emailContacts },
        showToast: (m) => toasts.push(String(m)),
        showSpinner: (m) => spinners.push({ on: true, msg: m }),
        hideSpinner: () => spinners.push({ on: false }),
        escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        openUnifiedCommsMenu: () => { menuCalls.push(1); },
        _cFS: async () => fakeFS,
        _cGetStaff: async () => {
            if (getStaffThrows) throw new Error(getStaffThrows);
            return staffFromGetStaff;
        },
        // El bloque usa SIETE helpers de panel.js, no dos: ademas de _cFS y
        // _cGetStaff, estos cuatro. Todos se quedan en panel.js y resuelven
        // via window en tiempo de llamada.
        _cMyTeamKey: () => 'home',
        _cMatchSubcatFor: (me, cat) => '',
        _cStaffThreadId: (clubId, coachUid, staffUid) => 'th_' + clubId + '_' + coachUid + '_' + staffUid,
        _parseHistoryForFirestore: (raw) => (Array.isArray(raw) ? raw : []),
    };
    if (resolveStaff) sandbox.window._cronosResolveStaffForMatch = resolveStaff;
    vm.createContext(sandbox);
    vm.runInContext(BLOCK, sandbox);

    return { g: sandbox, w: sandbox.window, written, toasts, spinners, logs, menuCalls, modal, el: (id) => els[id] };
}

const idxOf = (s, sub) => s.indexOf(sub);
const inCol = (written, col) => written.filter(w => w.col === col);

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura y separación respecto al auto-despacho ──');
    ok('1a · las dos funciones se asignan a window',
        /^window\.openCollectiveReport = async function openCollectiveReport\(\)/m.test(BLOCK)
        && /^window\._sendCollectiveReportNow = async function\(\)/m.test(BLOCK));
    ok('1b · comparten estado por window._collectiveReportStaff / _collectiveReportText',
        /window\._collectiveReportStaff = staffList;/.test(BLOCK)
        && /window\._collectiveReportText\s+= buildCollectiveText\(\);/.test(BLOCK));
    ok('1c · usa _cFS y _cGetStaff, que se quedan en panel.js',
        /await _cFS\(\)/.test(BLOCK) && /_cGetStaff\(/.test(BLOCK));
    ok('1d · emailConfig se lee con guarda typeof (es un let de app-init.js)',
        /typeof emailConfig !== 'undefined'/.test(BLOCK));
    {
        // autoDispatchMatchReports se mudo a comms/match-reports-auto.js en el
        // paso 6b (2026-07-27). Se busca alli si existe; si no, en panel.js.
        // OJO: son DOS fuentes distintas. El cuerpo de autoDispatchMatchReports
        // esta ahora en el archivo nuevo, pero la autoasignacion que comprueba
        // 1f sigue en panel.js. Mezclarlas romperia 1f.
        const _AUTO = path.join(ROOT, 'js', 'coach', 'comms', 'match-reports-auto.js');
        const panel = fs.readFileSync(fs.existsSync(_AUTO) ? _AUTO : ORIGIN, 'utf8');
        const panelOrigen = fs.readFileSync(ORIGIN, 'utf8');
        // Se acota el CUERPO de autoDispatchMatchReports y se comprueba ahi
        // dentro. (Un [\s\S]*? sobre el archivo entero no probaria nada: casaria
        // con cualquier aparicion posterior en cualquier otra funcion.)
        const ini = panel.indexOf('async function autoDispatchMatchReports()');
        let cuerpo = '';
        if (ini !== -1) {
            let i = panel.indexOf('{', ini), d = 0;
            for (; i < panel.length; i++) {
                if (panel[i] === '{') d++;
                else if (panel[i] === '}') { d--; if (d === 0) { i++; break; } }
            }
            cuerpo = panel.slice(ini, i);
        }
        ok('1e · autoDispatchMatchReports NO llama a estas dos funciones (son implementaciones separadas)',
            cuerpo.length > 500 && !/openCollectiveReport\s*\(/.test(cuerpo)
            && !/_sendCollectiveReportNow\s*\(/.test(cuerpo),
            { largoCuerpo: cuerpo.length });
        ok('1f · la autoasignación window.openCollectiveReport = window.openCollectiveReport sigue en panel.js',
            /window\.openCollectiveReport\s+= window\.openCollectiveReport;/.test(panelOrigen));
    }
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const comms = idxOf(idxHtml, 'js/coach/comms/panel.js');
        const target = idxOf(idxHtml, 'js/coach/comms/collective-report.js');
        ok('1g · collective-report.js se carga después de comms/panel.js',
            target !== -1 && target > comms, { comms, target });
        ok('1h · está en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/comms/collective-report.js'));
        ok('1i · está en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/comms/collective-report.js'));
        ok('1j · test_p11d_collective_write.js lee también el archivo nuevo',
            fs.readFileSync(path.join(ROOT, 'scripts', 'test_p11d_collective_write.js'), 'utf8')
                .includes('collective-report.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · openCollectiveReport: composición ──');
    {
        const { g, modal } = buildSandbox({ noModal: true });
        await g.window.openCollectiveReport();
        ok('2a · sin la modal en el DOM no hace nada', modal === null);
    }
    {
        const { g, w, modal } = buildSandbox({
            staffFromGetStaff: [{ uid: 'd1', name: 'Dir', role: 'director', email: 'd@x.com' }],
        });
        await g.window.openCollectiveReport();
        ok('2b · muestra la modal', modal.style.display === 'flex');
        ok('2c · deja el texto del informe preparado en window._collectiveReportText',
            typeof w._collectiveReportText === 'string' && w._collectiveReportText.length > 20,
            w._collectiveReportText && w._collectiveReportText.slice(0, 40));
        ok('2d · el texto lleva la cabecera del informe colectivo',
            /INFORME COLECTIVO DE PARTIDO/.test(w._collectiveReportText));
        ok('2e · deja la lista de staff en window._collectiveReportStaff',
            Array.isArray(w._collectiveReportStaff) && w._collectiveReportStaff.length === 1,
            w._collectiveReportStaff);
        ok('2f · el botón de envío llama a _sendCollectiveReportNow()',
            modal.innerHTML.includes('onclick="_sendCollectiveReportNow()"'));
    }
    {
        const { g, w } = buildSandbox({
            staffFromGetStaff: [{ uid: 'd1', name: 'Dir', role: 'director', email: 'd@x.com' }],
            emailContacts: [
                { uid: 'x9', name: 'SoloEmail', email: 'x9@x.com', role: 'coordinator' },
                { uid: 'd1', name: 'Duplicado', email: 'd@x.com' },
            ],
        });
        await g.window.openCollectiveReport();
        const uids = (w._collectiveReportStaff || []).map(s => s.uid);
        ok('2g · _cGetStaff es la fuente primaria y emailConfig la complementa',
            uids.includes('d1') && uids.includes('x9'), uids);
        ok('2h · no duplica a quien ya venía de _cGetStaff',
            uids.filter(u => u === 'd1').length === 1, uids);
    }
    {
        // El filtro por modalidad se delega en _cronosResolveStaffForMatch.
        let called = null;
        const { g, w } = buildSandbox({
            staffFromGetStaff: [
                { uid: 'd1', role: 'director' },
                { uid: 'c1', role: 'coordinator', coordinatorType: 'f7' },
            ],
            resolveStaff: (list, cat, mod) => { called = { n: list.length, cat }; return [{ uid: 'd1', role: 'director' }]; },
        });
        await g.window.openCollectiveReport();
        ok('2i · delega el filtro de coordinadores por modalidad en _cronosResolveStaffForMatch',
            called !== null && (w._collectiveReportStaff || []).map(s => s.uid).join() === 'd1',
            { called, staff: (w._collectiveReportStaff || []).map(s => s.uid) });
    }
    {
        // OJO: el fallo de _cGetStaff lo captura un try ANIDADO que solo hace
        // console.warn; NO llega al catch exterior. El informe se construye
        // igualmente con los contactos de emailConfig como unica fuente.
        const { g, w, logs } = buildSandbox({
            getStaffThrows: 'sin permisos',
            emailContacts: [{ uid: 'x9', name: 'SoloEmail', email: 'x9@x.com' }],
        });
        await g.window.openCollectiveReport();
        ok('2j · un fallo de _cGetStaff se traga con un aviso y NO aborta el informe',
            logs.some(l => l.includes('_cGetStaff') && l.includes('sin permisos'))
            && (w._collectiveReportStaff || []).map(s2 => s2.uid).join() === 'x9',
            { logs, staff: w._collectiveReportStaff });
    }
    {
        const { g, w } = buildSandbox({
            players: [{ name: 'Ana', number: '7', team: 'home', history: [{ type: 'goal', minute: 12 }] }],
            staffFromGetStaff: [{ uid: 'd1', role: 'director' }],
        });
        await g.window.openCollectiveReport();
        ok('2k · con datos de partido en vivo incluye los eventos en el texto',
            /GOL/.test(w._collectiveReportText), w._collectiveReportText.slice(0, 120));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · ⚠️ FIX P11-D: nunca aborta y staffUids incluye me.uid ──');
    ok('3a · _collStaffUids se construye con un Set que añade me.uid',
        /const _collStaffUids = Array\.from\(new Set\(\[[\s\S]*?me\.uid,[\s\S]*?\]\.filter\(Boolean\)\)\);/.test(BLOCK));
    ok('3b · el documento de informe usa staffUids: _collStaffUids',
        /staffUids:\s+_collStaffUids,/.test(BLOCK));
    ok('3c · registra el total de informes colectivos escritos',
        /TOTAL informes colectivos escritos en cronos_player_reports/.test(BLOCK));
    {
        // Staff VACÍO: debe escribir igualmente y con staffUids = [me.uid].
        const { w, written } = buildSandbox({
            preparedStaff: [], preparedText: 'texto',
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
        });
        await w._sendCollectiveReportNow();
        const reports = inCol(written, 'cronos_player_reports');
        ok('3d · ⚠️ con la lista de staff VACÍA sigue escribiendo los informes',
            reports.length >= 1, { reports: reports.length, total: written.length });
        ok('3e · ⚠️ y staffUids contiene al entrenador (me.uid)',
            reports.length > 0 && Array.isArray(reports[0].data.staffUids)
            && reports[0].data.staffUids.includes('coach1'),
            reports[0] && reports[0].data.staffUids);
    }
    {
        const { w, written } = buildSandbox({
            preparedStaff: [{ uid: 'd1', role: 'director', email: 'd@x.com' }],
            preparedText: 'texto',
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
        });
        await w._sendCollectiveReportNow();
        const reports = inCol(written, 'cronos_player_reports');
        ok('3f · con staff, staffUids incluye al staff Y al entrenador',
            reports[0].data.staffUids.includes('d1') && reports[0].data.staffUids.includes('coach1'),
            reports[0].data.staffUids);
        ok('3g · deduplica los uids repetidos',
            new Set(reports[0].data.staffUids).size === reports[0].data.staffUids.length,
            reports[0].data.staffUids);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · _sendCollectiveReportNow: escrituras ──');
    {
        const { w, written, toasts, spinners } = buildSandbox({
            preparedStaff: [{ uid: 'd1', role: 'director', email: 'd@x.com', name: 'Dir' }],
            preparedText: 'INFORME',
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
        });
        await w._sendCollectiveReportNow();
        ok('4a · escribe en cronos_player_reports', inCol(written, 'cronos_player_reports').length >= 1);
        ok('4b · envía el hilo de mensajería a cada miembro del staff',
            inCol(written, 'cronos_messages').length >= 1, inCol(written, 'cronos_messages').length);
        const notifs = inCol(written, 'cronos_notifications');
        ok('4c · crea la auto-notificación del entrenador con id coll_rpt_self_…',
            notifs.some(n => /^coll_rpt_self_coach1_[0-9a-z]+$/.test(n.id)), notifs.map(n => n.id));
        ok('4d · muestra y oculta el spinner',
            spinners.some(s => s.on) && spinners.some(s => !s.on));
        ok('4e · confirma con un toast', toasts.length >= 1, toasts);
    }
    {
        const { w, written } = buildSandbox({
            preparedStaff: [], preparedText: 'T',
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
            lastMatchId: 'MATCH_PREVIO',
        });
        await w._sendCollectiveReportNow();
        const r = inCol(written, 'cronos_player_reports')[0];
        ok('4f · reutiliza _cronosLastAutoDispatchMatchId como matchId cuando existe',
            JSON.stringify(r.data).includes('MATCH_PREVIO') || r.id.includes('MATCH_PREVIO'),
            { id: r.id, matchId: r.data.matchId });
    }
    {
        const { w, toasts, spinners } = buildSandbox({
            preparedStaff: [{ uid: 'd1' }], preparedText: 'T',
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
            setDocThrows: 'sin red',
        });
        await w._sendCollectiveReportNow();
        ok('4g · si falla la escritura, oculta el spinner y avisa',
            spinners.some(s => !s.on) && toasts.some(t => t.includes('Error: sin red')),
            { spinners, toasts });
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
