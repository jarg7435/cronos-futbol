// ─────────────────────────────────────────────────────────────────────────
// test_reports_tab_module.js · Refactor de monolitos (auditoría 2026-07-22)
// MONOLITO #2 (js/coach/reports/club-reports.js), PASO 5 de 6: extracción de
// "TAB: Informes de partido" (_sdLoadReports, con sdToggleReport /
// sdDeleteReport / _sdMatchData anidados) a js/coach/reports/reports-tab.js.
//
// Escrito y ejecutado EN VERDE contra el código todavía SIN mover (Puerta 3).
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
//  · FAN-IN = 1: switchStaffTab('informes') (switchStaffTab SE QUEDA). Los dos
//    handlers sólo se invocan desde el HTML que genera esta sección.
//  · FAN-IN EXTERNO = 0. comms/panel.js menciona _sdLoadReports tres veces
//    pero LAS TRES SON COMENTARIOS. La parte 1d lo aserta con precisión: es el
//    tercer falso positivo de esta clase en el refactor (antes: el changelog de
//    sw.js y un comentario en index.html), así que aquí se distingue código de
//    comentario en vez de hacer un grep a secas.
//  · FAN-OUT: _sdFS() ×3 (se queda), escapeHtml, showToast/showSpinner/
//    hideSpinner (guardados), window._cResolveClubId (comms/panel.js),
//    window._CRONOS_DEBUG y _RP.build (report-engine.js, extraído en el paso 4).
//
// ── ⚠️ ESTE PASO DEBE ARREGLAR TRES TESTS EXISTENTES ──
// (se hace en el commit de la extracción, no aquí)
//  1-2. test_p11c_clubid_rule.js y test_sec_c1_clubid.js cuentan
//       `_cResolveClubId(db, me,` en club-reports.js esperando 2. Están en la
//       línea 109 (openStaffDashboard, SE QUEDA) y 287 (aquí, SE VA): tras la
//       extracción habrá 1 en cada fichero. Deben sumar los dos.
//  3.   test_v269_fixes.js cuenta `me.currentRole` en todo el fichero
//       esperando 0 en código. Hoy hay 2 y LAS DOS se van, así que el contador
//       bajaría a 0 y la aserción se volvería VERDE sin que nada se arregle.
//       Debe leer también el fichero nuevo para que la regresión siga visible.
//
// ── ⚠️ REGRESIÓN REAL QUE VIAJA CON ESTE CÓDIGO (no se corrige aquí) ──
// El dismissKey se construye con `me.currentRole || me.role || 'staff'`, pero
// `currentRole` NO es un campo que la app rellene: el fix v269 lo cambió a
// `_activeRole` y ese cambio no está en el código. Efecto: una cuenta con doble
// rol (mismo uid como Director y como Coordinador) genera LA MISMA clave para
// ambos, así que ocultar un informe como Director lo oculta también como
// Coordinador — justo lo que los comentarios de la propia función dicen querer
// evitar. La parte 5d fija el comportamiento REAL para que quede documentado y
// para que el arreglo, cuando llegue, tenga que actualizar esta aserción.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'reports', 'reports-tab.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Informes de partido — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Extracción del bloque ═════════════════════════════
function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('async function _sdLoadReports()');
    if (s === -1) throw new Error('No se encontró _sdLoadReports en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    const e = src.indexOf('TAB: MENSAJES', s);
    if (e === -1) throw new Error('No se encontró el final de la sección');
    const cut = src.slice(s, e);
    return cut.slice(0, cut.lastIndexOf('}') + 1);
}
const BLOCK = readBlock();

const escHtml = (str) => {
    if (str === null || str === undefined) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
    return String(str).replace(/[&<>"'/]/g, c => map[c]);
};
const key64of = (k) => btoa(unescape(encodeURIComponent(k))).replace(/=/g, '');

function buildSandbox({
    reports = {},                 // cronos_player_reports  {id: data}
    users = {},
    me = { uid: 'u1', clubId: 'club1', role: 'director', email: 'd@x.com', clubName: 'CD Test' },
    resolveClubId = null,         // función o null (simula window._cResolveClubId)
    resolveThrows = false,
    failOrderBy = false,          // la query primaria (con orderBy) falla
    failStaffReport = false,      // también falla la variante sin orderBy
    failAllClubQueries = false,   // fuerza el camino de staffUids
    rpThrows = null,
    confirmReturns = true,
    updateDocFailFor = null,      // id de doc cuyo updateDoc falla
} = {}) {
    const store = { cronos_player_reports: reports, users, clubs: {} };
    const queries = [];           // {col, clauses}
    const updated = [];
    const deleted = [];
    const toasts = [];
    const spinners = [];
    const rpCalls = [];
    const els = {};
    const el = (id) => (els[id] || (els[id] = {
        id, innerHTML: '', style: {}, dataset: {}, removed: false,
        remove() { this.removed = true; }, querySelector: () => null,
    }));
    const container = el('staff-dashboard-content');
    container.querySelector = (sel) => (sel === 'h3' ? el('__h3') : null);

    const clauseHas = (ref, field) => (ref.__clauses || []).some(c => c && c.__where && c.field === field);
    const clauseHasOrder = (ref) => (ref.__clauses || []).some(c => c && c.__orderBy);

    const matches = (data, clauses) => (clauses || []).every(c => {
        if (!c || !c.__where) return true;
        if (c.op === 'array-contains') return Array.isArray(data[c.field]) && data[c.field].includes(c.value);
        return data[c.field] === c.value;
    });

    const fakeFS = {
        db: {},
        collection: (db, col) => ({ __col: col }),
        query: (ref, ...clauses) => ({ __col: ref.__col, __clauses: clauses }),
        where: (field, op, value) => ({ __where: true, field, op, value }),
        orderBy: (f, d) => ({ __orderBy: f, dir: d }),
        limit: (n) => ({ __limit: n }),
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async (ref) => {
            const d = (store[ref.__col] || {})[ref.__id];
            return { exists: () => d !== undefined, data: () => d };
        },
        getDocs: async (ref) => {
            queries.push({ col: ref.__col, clauses: (ref.__clauses || []).map(c =>
                c.__where ? c.field + c.op : (c.__orderBy ? 'orderBy:' + c.__orderBy : 'limit:' + c.__limit)) });
            if (ref.__col === 'cronos_player_reports') {
                const isStaffUids = clauseHas(ref, 'staffUids');
                if (!isStaffUids) {
                    if (failAllClubQueries) throw new Error('permission-denied');
                    if (failOrderBy && clauseHasOrder(ref)) throw new Error('failed-precondition');
                    if (failStaffReport && clauseHas(ref, 'staffReport')) throw new Error('failed-precondition');
                }
            }
            const st = store[ref.__col] || {};
            const rows = Object.keys(st).filter(id => matches(st[id], ref.__clauses)).map(id => [id, st[id]]);
            return { forEach: (cb) => rows.forEach(r => cb({ id: r[0], data: () => r[1] })) };
        },
        updateDoc: async (ref, data) => {
            if (updateDocFailFor && ref.__id === updateDocFailFor) throw new Error('no existe');
            updated.push({ col: ref.__col, id: ref.__id, data });
        },
        deleteDoc: async (ref) => { deleted.push(ref.__id); },
        arrayUnion: (...items) => ({ __arrayUnion: items }),
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: me,
            _cronos_auth: { db: fakeFS.db },
            _CRONOS_DEBUG: false,
        },
        document: { getElementById: (id) => (els[id] !== undefined ? els[id] : null) },
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        btoa, unescape, encodeURIComponent, parseInt,
        _sdFS: async () => fakeFS,
        escapeHtml: escHtml,
        showToast: (m) => toasts.push(String(m)),
        showSpinner: (m) => spinners.push({ on: true, msg: m }),
        hideSpinner: () => spinners.push({ on: false }),
        _RP: { build: (m, u) => { rpCalls.push(m); if (rpThrows) throw new Error(rpThrows); return '<b>INFORME</b>'; } },
    };
    if (resolveClubId || resolveThrows) {
        sandbox.window._cResolveClubId = async () => {
            if (resolveThrows) throw new Error('resolve falló');
            return resolveClubId;
        };
    }
    vm.createContext(sandbox);
    vm.runInContext(BLOCK, sandbox);

    return { g: sandbox, w: sandbox.window, store, queries, updated, deleted, toasts, spinners, rpCalls, container, el };
}

const idxOf = (s, sub) => s.indexOf(sub);
const mdKeys = (g) => Object.keys((g.window && g.window._sdMatchData) || {});
const staffRep = (extra) => Object.assign(
    { staffReport: true, clubId: 'club1', matchDate: '2026-03-02', rival: 'Rival A',
      coachUid: 'c1', createdAt: '2026-03-02T10:00:00Z' }, extra);

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
}

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura, aislamiento y los tres tests ──');
    ok('1a · function declaration sin export explícito',
        /^async function _sdLoadReports\(\)/m.test(BLOCK) && !/window\._sdLoadReports\s*=/.test(BLOCK));
    ok('1b · los tres window.* se asignan anidados dentro',
        /\n\s+window\._sdMatchData = \{\};/.test(BLOCK)
        && /\n\s+window\.sdToggleReport = \(key64\) =>/.test(BLOCK)
        && /\n\s+window\.sdDeleteReport = async \(key64\) =>/.test(BLOCK));
    // El BORRADO PERMANENTE (2026-08-13) vive en el mismo bloque y sigue el
    // mismo patrón. Ocultar y borrar de verdad son dos acciones distintas y
    // tienen que seguir siendo dos funciones distintas: fundirlas convertiría
    // el botón de ocultar en un destructor irreversible.
    ok('1b-bis · sdPurgeMatch también se asigna anidada dentro, y es OTRA función',
        /\n\s+window\.sdPurgeMatch = async \(key64\) =>/.test(BLOCK)
        && /\n\s+window\.sdDeleteReport = async \(key64\) =>/.test(BLOCK));
    // Vuelve a 3: sdPurgeMatch NO abre sesión de Firestore propia — delega
    // toda la escritura en js/coach/reports/match-purge.js, que es la
    // definición única que comparten los dos botones de borrado.
    ok('1c · usa _sdFS() 3 veces y _RP.build una vez',
        (BLOCK.match(/await _sdFS\(\)/g) || []).length === 3
        && (BLOCK.match(/_RP\.build\(/g) || []).length === 1,
        { sdFS: (BLOCK.match(/await _sdFS\(\)/g) || []).length,
          rp: (BLOCK.match(/_RP\.build\(/g) || []).length });
    {
        // Distingue CÓDIGO de COMENTARIO: comms/panel.js sólo lo nombra en
        // comentarios y no debe contar como consumidor.
        const NAMES = ['_sdLoadReports', 'sdToggleReport', 'sdDeleteReport', '_sdMatchData'];
        const skip = new Set([SOURCE, ORIGIN, path.join(ROOT, 'sw.js'), path.join(ROOT, 'index.html')]
            .map(p => path.resolve(p)));
        const offenders = [];
        for (const f of walk(ROOT, [])) {
            if (skip.has(path.resolve(f))) continue;
            if (path.relative(ROOT, f).replace(/\\/g, '/').startsWith('scripts/')) continue;
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
                // Distingue codigo de comentario. OJO: .trim() es necesario
                // porque los ficheros son CRLF y en una regex el punto NO
                // consume el retorno de carro, asi que el recorte del
                // comentario no casaba en estas lineas.
                const code = line.trim().replace(/\/\/.*$/, '');
                for (const n of NAMES) if (new RegExp('\\b' + n + '\\b').test(code)) {
                    offenders.push(rel + ':' + (i + 1) + ':' + n);
                }
            });
        }
        ok('1d · fan-in externo = 0 EN CÓDIGO (las menciones de comms/panel.js son comentarios)',
            offenders.length === 0, offenders);
    }
    {
        const origin = fs.readFileSync(ORIGIN, 'utf8');
        const CALL = /_cResolveClubId\(db, me,/g;
        const here = (BLOCK.match(CALL) || []).length;
        const inOrigin = (origin.match(CALL) || []).length;
        ok('1e · esta sección contiene UNO de los dos call-sites de _cResolveClubId',
            here === 1 && inOrigin === (IS_EXTRACTED ? 1 : 2), { here, inOrigin, IS_EXTRACTED });
        // La regresión v269 viaja con este bloque: las dos ocurrencias están aquí.
        ok('1f · ⚠️ las dos ocurrencias de me.currentRole están en este bloque',
            (BLOCK.match(/me\.currentRole/g) || []).length === 2,
            (BLOCK.match(/me\.currentRole/g) || []).length);
    }
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        ok('1g · reports-tab.js se carga después de club-reports.js',
            idxOf(idxHtml, 'js/coach/reports/reports-tab.js') > idxOf(idxHtml, 'js/coach/reports/club-reports.js'));
        ok('1h · está en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/reports/reports-tab.js'));
        ok('1i · está en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/reports/reports-tab.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · resolución del clubId ──');
    {
        const { g, container } = buildSandbox({ me: { uid: 'u1', role: 'director' } });
        await g._sdLoadReports();
        ok('2a · sin clubId ni resolutor avisa y no consulta',
            container.innerHTML.includes('Sin club asignado'));
    }
    {
        const me = { uid: 'u1', role: 'director', email: 'd@x.com' };
        const { g, container } = buildSandbox({
            me, resolveClubId: 'clubZ',
            reports: { r1: staffRep({ clubId: 'clubZ' }) },
        });
        await g._sdLoadReports();
        ok('2b · resuelve el clubId y MUTA window._cronosCurrentUser', me.clubId === 'clubZ', me.clubId);
        ok('2b-bis · y con él ya encuentra informes', !container.innerHTML.includes('Sin club asignado'));
    }
    {
        const { g, container } = buildSandbox({ me: { uid: 'u1', role: 'director' }, resolveThrows: true });
        await g._sdLoadReports();
        ok('2c · si el resolutor lanza, degrada al aviso sin propagar',
            container.innerHTML.includes('Sin club asignado'));
    }
    {
        const { g, queries } = buildSandbox({ reports: { r1: staffRep() } });
        await g._sdLoadReports();
        ok('2d · con clubId presente no hace falta resolver nada', queries.length > 0);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · descubrimiento multi-clubId ──');
    {
        // Cadena de descubrimiento REAL, en tres saltos:
        //  paso 1: allRoles del propio doc            -> clubB
        //  paso 2: usuarios con clubId in {club1,clubB} -> sus clubIds -> clubC
        //  paso 3: usuarios con el mismo email        -> clubE
        // OJO: el paso 2 itera sobre una FOTO del conjunto tomada tras el paso 1,
        // asi que un usuario cuyo clubId no este ya dentro NO se descubre nunca.
        const { g, queries } = buildSandbox({
            users: {
                u1:          { clubId: 'club1', email: 'd@x.com', allRoles: [{ clubId: 'clubB' }] },
                viaClubB:    { clubId: 'clubB', allRoles: [{ clubId: 'clubC' }] },
                mismoEmail:  { clubId: 'clubE', email: 'd@x.com' },
                inalcanzable:{ clubId: 'clubZZ' },
            },
            reports: { r1: staffRep({ clubId: 'clubC' }) },
        });
        await g._sdLoadReports();
        const repQ = queries.filter(q => q.col === 'cronos_player_reports');
        ok('3a · consulta users por clubId y por email',
            queries.some(q => q.col === 'users' && q.clauses.includes('clubId=='))
            && queries.some(q => q.col === 'users' && q.clauses.includes('email==')),
            queries.filter(q => q.col === 'users').map(q => q.clauses.join('+')));
        ok('3b · descubre 4 clubIds (propio + allRoles + derivado + mismo email)',
            repQ.length === 4, repQ.length);
        ok('3c · encuentra el informe alojado en un clubId derivado a dos saltos',
            mdKeys(g).length === 1, mdKeys(g));
        ok('3c-bis · un usuario cuyo clubId no estaba en el conjunto no se descubre',
            !queries.some(q => q.col === 'cronos_player_reports'
                && JSON.stringify(q).includes('clubZZ')), repQ.length);
    }
    {
        // El mismo doc devuelto por dos clubIds distintos no debe duplicarse.
        const { g } = buildSandbox({
            users: { u1: { clubId: 'club1', allRoles: [{ clubId: 'club1' }] } },
            reports: { dup: staffRep() },
        });
        await g._sdLoadReports();
        ok('3d · deduplica documentos por id (seenIds)',
            mdKeys(g).length === 1, mdKeys(g));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · consulta primaria y sus dos fallbacks ──');
    {
        const { g, queries } = buildSandbox({ reports: { r1: staffRep() } });
        await g._sdLoadReports();
        const primary = queries.find(q => q.col === 'cronos_player_reports');
        ok('4a · la primaria filtra por clubId + staffReport, ordena por createdAt y limita a 500',
            primary && primary.clauses.includes('clubId==') && primary.clauses.includes('staffReport==')
            && primary.clauses.includes('orderBy:createdAt') && primary.clauses.includes('limit:500'),
            primary && primary.clauses);
    }
    {
        const { g, queries, container } = buildSandbox({ reports: { r1: staffRep() }, failOrderBy: true });
        await g._sdLoadReports();
        const repQ = queries.filter(q => q.col === 'cronos_player_reports');
        ok('4b · si falla la primaria, reintenta sin orderBy y sigue funcionando',
            repQ.some(q => !q.clauses.includes('orderBy:createdAt') && q.clauses.includes('staffReport=='))
            && !container.innerHTML.includes('Sin informes'), repQ.map(q => q.clauses.join('+')));
    }
    {
        const { g, queries, container } = buildSandbox({
            reports: { r1: staffRep() }, failOrderBy: true, failStaffReport: true,
        });
        await g._sdLoadReports();
        const repQ = queries.filter(q => q.col === 'cronos_player_reports');
        ok('4c · si también falla, cae a la query legacy sin filtro staffReport',
            repQ.some(q => !q.clauses.includes('staffReport==') && q.clauses.includes('clubId=='))
            && !container.innerHTML.includes('Sin informes'), repQ.map(q => q.clauses.join('+')));
    }
    {
        const { g, queries } = buildSandbox({
            reports: { r1: staffRep({ staffUids: ['u1'] }) }, failAllClubQueries: true,
        });
        await g._sdLoadReports();
        ok('4d · si ninguna query por clubId funciona, prueba por staffUids',
            queries.some(q => q.col === 'cronos_player_reports' && q.clauses.includes('staffUidsarray-contains')),
            queries.filter(q => q.col === 'cronos_player_reports').map(q => q.clauses.join('+')));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · filtro por dismissKey ──');
    {
        const { g, container } = buildSandbox({
            reports: {
                si: staffRep({ rival: 'Visible' }),
                no: staffRep({ rival: 'NoStaff', staffReport: false }),
            },
        });
        await g._sdLoadReports();
        ok('5a · sólo entran los documentos con staffReport === true',
            container.innerHTML.includes('Visible') && !container.innerHTML.includes('NoStaff'));
    }
    {
        const { g, container } = buildSandbox({
            reports: { oculto: staffRep({ rival: 'Oculto', dismissedBy: ['u1_director'] }) },
        });
        await g._sdLoadReports();
        ok('5b · excluye los descartados con la clave uid_rol de este usuario',
            container.innerHTML.includes('Sin informes de partido aún'));
    }
    {
        const { g, container } = buildSandbox({
            reports: { otro: staffRep({ rival: 'DelCoordi', dismissedBy: ['u1_coordinator'] }) },
        });
        await g._sdLoadReports();
        ok('5c · NO excluye si la clave es de otro rol (borrado independiente por rol)',
            container.innerHTML.includes('DelCoordi'));
    }
    {
        // ⚠️ REGRESIÓN v269: currentRole no existe como campo, así que la clave
        // cae a me.role. Dos roles con el mismo uid comparten clave.
        const meDir = { uid: 'u9', clubId: 'club1', role: 'director', currentRole: undefined };
        const { g, container } = buildSandbox({
            me: meDir, reports: { x: staffRep({ rival: 'X', dismissedBy: ['u9_director'] }) },
        });
        await g._sdLoadReports();
        ok('5d · ⚠️ la clave se deriva de me.role (currentRole no existe) — regresión v269',
            container.innerHTML.includes('Sin informes de partido aún')
            && /me\.currentRole \|\| me\.role \|\| 'staff'/.test(BLOCK));
    }
    {
        const { g, container } = buildSandbox({ reports: {} });
        await g._sdLoadReports();
        ok('5e · sin informes muestra el vacío con su explicación',
            container.innerHTML.includes('Sin informes de partido aún')
            && container.innerHTML.includes('Enviar Informe'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 6 · agrupación y render ──');
    {
        const { g, container } = buildSandbox({
            reports: {
                a: staffRep({ matchDate: '2026-03-02', rival: 'Uno', coachUid: 'c1', playerNumber: '5' }),
                b: staffRep({ matchDate: '2026-03-02', rival: 'Uno', coachUid: 'c1', playerNumber: '7' }),
                c: staffRep({ matchDate: '2026-03-09', rival: 'Dos', coachUid: 'c1',
                              createdAt: '2026-03-09T10:00:00Z' }),
            },
        });
        await g._sdLoadReports();
        const h = container.innerHTML;
        ok('6a · agrupa por fecha + rival + coach (2 encuentros de 3 documentos)',
            mdKeys(g).length === 2, mdKeys(g));
        ok('6b · el título muestra el número de encuentros en plural',
            h.includes('📊 Informes — 2 encuentros'));
        ok('6c · cachea cada partido en window._sdMatchData por su key64',
            !!(g.window._sdMatchData || {})[key64of('2026-03-02_Uno_c1')], mdKeys(g));
        ok('6d · muestra el club del usuario', h.includes('CD Test'));
    }
    {
        const { g, container } = buildSandbox({ reports: { a: staffRep({ rival: 'Solo' }) } });
        await g._sdLoadReports();
        // OJO: tras "encuentro" hay salto de linea + sangria antes de </h3>.
        ok('6e · singular cuando hay un solo encuentro',
            /Informes — 1 encuentro(?!s)/.test(container.innerHTML),
            container.innerHTML.slice(container.innerHTML.indexOf('Informes'), container.innerHTML.indexOf('Informes') + 30));
    }
    {
        const { g, container } = buildSandbox({ reports: { a: staffRep({ rival: `A<b>'x'` }) } });
        await g._sdLoadReports();
        ok('6f · el rival se escapa con escapeHtml',
            container.innerHTML.includes(escHtml(`A<b>'x'`)));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 7 · sdToggleReport (render lazy vía _RP) ──');
    const K = key64of('2026-03-02_Rival A_c1');
    {
        const { g, w, rpCalls, el } = buildSandbox({ reports: { a: staffRep() } });
        await g._sdLoadReports();
        const detail = el('rdetail-' + K); detail.style.display = 'none';
        w.sdToggleReport(K);
        ok('7a · el primer despliegue llama a _RP.build y marca el detalle como renderizado',
            rpCalls.length === 1 && detail.innerHTML === '<b>INFORME</b>' && detail.dataset.rendered === '1',
            { calls: rpCalls.length, rendered: detail.dataset.rendered });
        ok('7b · y lo muestra', detail.style.display === 'block');
        w.sdToggleReport(K);   // cerrar
        w.sdToggleReport(K);   // abrir de nuevo
        ok('7c · no vuelve a construir el informe en despliegues posteriores',
            rpCalls.length === 1, rpCalls.length);
    }
    {
        const { g, w, el } = buildSandbox({ reports: { a: staffRep() }, rpThrows: 'motor roto' });
        await g._sdLoadReports();
        const detail = el('rdetail-' + K); detail.style.display = 'none';
        w.sdToggleReport(K);
        ok('7d · si _RP.build lanza, pinta el error en la tarjeta sin romper el panel',
            detail.innerHTML.includes('Error al generar informe: motor roto'), detail.innerHTML);
    }
    {
        const { g, w, rpCalls } = buildSandbox({ reports: { a: staffRep() } });
        await g._sdLoadReports();
        w.sdToggleReport('inexistente');
        ok('7e · un key64 desconocido no llama al motor ni revienta', rpCalls.length === 0);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 8 · sdDeleteReport (soft delete por rol) ──');
    // El grupo acumula los propios DOCUMENTOS en .players (matches[key].players
    // .push(r)), asi que p._id es el id del doc y p.playerNumber su campo.
    const withPlayers = () => ({
        a: staffRep({ playerNumber: '5', matchId: 'M1' }),
    });
    {
        const { g, w, updated, deleted } = buildSandbox({ reports: withPlayers(), confirmReturns: false });
        await g._sdLoadReports();
        await w.sdDeleteReport(K);
        ok('8a · si el usuario cancela, no escribe nada', updated.length === 0 && deleted.length === 0);
    }
    {
        const { g, w, updated, deleted, toasts, spinners } = buildSandbox({ reports: withPlayers() });
        await g._sdLoadReports();
        await w.sdDeleteReport(K);
        ok('8b · marca dismissedBy con arrayUnion(uid_rol) y NUNCA borra',
            updated.length > 0 && deleted.length === 0
            && updated.every(u => u.col === 'cronos_player_reports')
            && updated[0].data.dismissedBy.__arrayUnion[0] === 'u1_director',
            { updated: updated.length, deleted: deleted.length, key: updated[0] && updated[0].data.dismissedBy });
        ok('8c · intenta el id real del documento y los tres derivados de matchId',
            updated.map(u => u.id).sort().join(',') === ['M1_coach_p5', 'M1_p5', 'M1_staff_p5', 'a'].join(','),
            updated.map(u => u.id).sort());
        ok('8d · muestra y oculta el spinner y confirma con un toast',
            spinners.some(s => s.on) && spinners.some(s => !s.on)
            && toasts.some(t => t.includes('Informe ocultado')), { spinners, toasts });
        ok('8e · quita el partido de la caché window._sdMatchData',
            (g.window._sdMatchData || {})[K] === undefined, mdKeys(g));
    }
    {
        // Sin playerNumber no hay ids derivados: solo el id real del documento.
        // (matchId cae a r._id, asi que nunca esta "vacio"; lo que decide es pNum.)
        const { g, w, updated } = buildSandbox({ reports: { solo: staffRep({}) } });
        await g._sdLoadReports();
        await w.sdDeleteReport(K);
        ok('8f · sin playerNumber usa sólo el id real del documento',
            updated.map(u => u.id).join(',') === 'solo', updated.map(u => u.id));
    }
    {
        const { g, w, updated, toasts } = buildSandbox({
            reports: withPlayers(), updateDocFailFor: 'M1_coach_p5',
        });
        await g._sdLoadReports();
        await w.sdDeleteReport(K);
        ok('8g · el fallo de un id concreto no aborta los demás ni el flujo',
            updated.length === 3 && toasts.some(t => t.includes('Informe ocultado')),
            { updated: updated.map(u => u.id), toasts });
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 9 · errores ──');
    {
        const { g, container } = buildSandbox({ reports: { a: staffRep() } });
        g._sdFS = async () => { throw new Error('sin red <x>'); };
        await g._sdLoadReports();
        ok('9a · un fallo general se pinta escapado y no propaga',
            container.innerHTML.includes('Error al cargar informes')
            && container.innerHTML.includes('sin red &lt;x&gt;'),
            container.innerHTML.slice(0, 120));
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
