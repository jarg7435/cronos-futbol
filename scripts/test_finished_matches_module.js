// ─────────────────────────────────────────────────────────────────────────
// test_finished_matches_module.js · Refactor de monolitos (auditoría 2026-07-22)
// MONOLITO #2 (js/coach/reports/club-reports.js), PASO 3 de 6: extracción de
// "TAB: Partidos Terminados" (_renderFinishedMatchesTab) a
// js/coach/reports/finished-matches-tab.js.
//
// Escrito y ejecutado EN VERDE contra el código todavía SIN mover (Puerta 3).
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
//  · PRIMERA sección de este monolito con FAN-IN EXTERNO REAL: además de
//    switchStaffTab (que se queda), la llama app-init.js dentro de
//    deleteFinishedMatchFromCloud, con guarda typeof y por nombre pelado.
//    La parte 1c fija que ese consumidor externo sea EXACTAMENTE uno.
//  · CICLO ENTRE FICHEROS: el HTML de esta sección llama a
//    deleteFinishedMatchFromCloud (app-init.js:1307), que a su vez llama de
//    vuelta a _renderFinishedMatchesTab. Ambos sentidos se resuelven en tiempo
//    de click vía window, así que la extracción es segura, pero el archivo
//    nuevo NO es autónomo: depende de app-init.js y app-init.js de él.
//  · FAN-OUT: _sdFS() ×2 (se queda), escapeHtml (app-init.js),
//    window.openMatchReplay (match/replay/replay-player.js),
//    openRetroactiveEventModal (match/events/retroactive-modal.js, guardado) y
//    deleteFinishedMatchFromCloud (app-init.js, SIN guardar).
//
// ── IMPLEMENTACIÓN PARALELA EN OTRO MONOLITO (no es colisión) ──
// app-init.js:1086 define `async function showFinishedMatches()`, un SEGUNDO
// renderizador independiente del mismo listado, con su propio _renderItem cuyas
// primeras líneas son idénticas a _renderMatchItem de aquí. Nombres y
// contenedores distintos => sin riesgo de "last script wins", pero es lógica
// duplicada entre dos monolitos, y deleteFinishedMatchFromCloud refresca LAS
// DOS. Inventariar cuando le toque a app-init.js (monolito #5).
//
// ── ESCRIBE EN FIRESTORE DURANTE EL RENDER ──
// El "enriquecimiento retroactivo" (parte 3) hace updateDoc sobre live_matches
// o cronos_player_reports para rellenar category/subcategory que faltan,
// fire-and-forget con el error silenciado. No es destructivo, pero es una
// escritura dentro de lo que parece un render de sólo lectura.
// Además lee TRES colecciones enteras sin where (live_matches,
// cronos_player_reports y, sólo si hace falta, users) y filtra en cliente: el
// alcance real lo impone firestore.rules. Fijado para que nadie lo "optimice"
// a una query con semántica distinta.
//
// ── RAREZAS PREEXISTENTES FIJADAS, NO CORREGIDAS ──
//  · El objeto que se guarda en finishedMap para los informes colectivos
//    termina en `...data`, DESPUÉS de las ~26 líneas que normalizan
//    homeTeam/awayTeam. Es decir: si el documento trae homeTeam/awayTeam, el
//    valor crudo SOBREESCRIBE la normalización, que sólo surte efecto cuando
//    el campo no viene. No produce un fallo visible porque _renderMatchItem
//    repite la misma cadena de fallbacks, pero es trabajo muerto. La parte 2n
//    lo fija estructuralmente.
//  · Las fechas de la tarjeta pasan por escapeHtml, que escapa "/" como
//    &#x2F;. Se ven bien en el navegador, pero el HTML crudo lleva la entidad
//    (parte 6k).
//  · Los tres onclick interpolan m.id / m.docId SIN escapeAttr, al contrario
//    que events-tab.js, que sí escapaba (parte 6g).
//  · deleteFinishedMatchFromCloud se invoca sin guarda mientras
//    openRetroactiveEventModal, en el botón contiguo, sí la lleva (parte 6f).
//
// ── NOTA SOBRE EL SANDBOX ──
// En un vm, una function declaration de nivel superior queda en el objeto
// global del sandbox, no en sandbox.window. Aquí SÍ hay export explícito, así
// que la función es accesible por las dos vías; el test usa w.* para
// comprobar justamente que el export existe.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'reports', 'finished-matches-tab.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Partidos Terminados — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Extracción del bloque ═════════════════════════════
// Sección INTERMEDIA: acotar por los dos extremos. Termina en la línea de
// export; después viene el comentario-puntero de events-tab.js (paso 2).
function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('async function _renderFinishedMatchesTab()');
    if (s === -1) throw new Error('No se encontró _renderFinishedMatchesTab en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    const e = src.indexOf('TAB: CONVOCATORIAS', s);
    if (e === -1) throw new Error('No se encontró el final de la sección');
    const cut = src.slice(s, e);
    return cut.slice(0, cut.lastIndexOf(';') + 1);
}
const BLOCK = readBlock();

// Réplica EXACTA de app-init.js:22 (escapa también "/").
const escHtml = (str) => {
    if (str === null || str === undefined) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
    return String(str).replace(/[&<>"'/]/g, c => map[c]);
};

function buildSandbox({
    live = {},                    // live_matches   {id: data}
    reports = {},                 // cronos_player_reports
    users = {},
    me = { uid: 'u1', clubId: 'club1', role: 'director', _activeRole: 'director', email: 'd@x.com' },
    noUser = false,
    noDb = false,
    failLive = false,
    failReports = false,
    failUsers = false,
    sdFSThrows = null,            // unica via para alcanzar el catch general
} = {}) {
    const store = { live_matches: live, cronos_player_reports: reports, users };
    const written = [];
    const readCols = [];
    const container = { id: 'staff-dashboard-content', innerHTML: '' };
    const els = { 'staff-dashboard-content': container };

    const fakeFS = {
        db: noDb ? null : {},
        collection: (db, col) => ({ __col: col }),
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDocs: async (ref) => {
            if (ref.__col === 'live_matches' && failLive) throw new Error('live falló');
            if (ref.__col === 'cronos_player_reports' && failReports) throw new Error('reports falló');
            if (ref.__col === 'users' && failUsers) throw new Error('users falló');
            readCols.push(ref.__col);
            const st = store[ref.__col] || {};
            const rows = Object.keys(st).map(id => [id, st[id]]);
            return { forEach: (cb) => rows.forEach(r => cb({ id: r[0], data: () => r[1] })) };
        },
        updateDoc: async (ref, data) => { written.push({ col: ref.__col, id: ref.__id, data }); },
    };

    const sandbox = {
        window: { _cronosCurrentUser: noUser ? undefined : me },
        document: { getElementById: (id) => (els[id] !== undefined ? els[id] : null) },
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        _sdFS: async () => { if (sdFSThrows) throw new Error(sdFSThrows); return fakeFS; },
        escapeHtml: escHtml,
    };
    vm.createContext(sandbox);
    // v434 · El modulo de inmutabilidad se carga DE VERDAD en el sandbox: el
    // render pregunta por window.CronosMatchLock para decidir si un partido
    // admite todavia incidencias. Sin el, todo saldria congelado y las
    // aserciones de los botones probarian el caso equivocado.
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/match/immutability.js'), 'utf8'), sandbox);
    vm.runInContext(BLOCK, sandbox);

    return { g: sandbox, w: sandbox.window, store, written, readCols, container };
}

const idxOf = (s, sub) => s.indexOf(sub);
// v434 · `finished()` produce un partido recien terminado, o sea DENTRO de la
// ventana de gracia de 2 h: es el estado en el que la ficha conserva sus
// botones. Para el otro estado esta `congelado()`.
const finished = (extra) => Object.assign(
    { status: 'finished', clubId: 'club1', finishedAt: { toDate: () => new Date(Date.now() - 10 * 60000) } },
    extra);
const congelado = (extra) => Object.assign(
    { status: 'finished', clubId: 'club1', finishedAt: { toDate: () => new Date(Date.now() - 5 * 3600 * 1000) } },
    extra);
const collective = (extra) => Object.assign({ staffReport: true, clubId: 'club1' }, extra);

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
    console.log('── PARTE 1 · estructura, fan-in externo y ciclo ──');
    ok('1a · es function declaration con export explícito a window',
        /^async function _renderFinishedMatchesTab\(\)/m.test(BLOCK)
        && /window\._renderFinishedMatchesTab\s*=\s*_renderFinishedMatchesTab;/.test(BLOCK));
    ok('1b · usa _sdFS() dos veces',
        (BLOCK.match(/await _sdFS\(\)/g) || []).length === 2,
        (BLOCK.match(/await _sdFS\(\)/g) || []).length);
    {
        // A diferencia de los pasos 1 y 2, aquí el fan-in externo NO es cero:
        // debe ser EXACTAMENTE app-init.js, y con guarda typeof.
        const skip = new Set([SOURCE, ORIGIN, path.join(ROOT, 'sw.js')].map(p => path.resolve(p)));
        const refs = [];
        for (const f of walk(ROOT, [])) {
            const abs = path.resolve(f);
            if (skip.has(abs)) continue;
            if (path.relative(ROOT, f).replace(/\\/g, '/').startsWith('scripts/')) continue;
            if (/\b_renderFinishedMatchesTab\b/.test(fs.readFileSync(f, 'utf8'))) {
                refs.push(path.relative(ROOT, f).replace(/\\/g, '/'));
            }
        }
        ok('1c · el único consumidor externo es js/core/app-init.js',
            refs.length === 1 && refs[0] === 'js/core/app-init.js', refs);
        const ai = fs.readFileSync(path.join(ROOT, 'js', 'core', 'app-init.js'), 'utf8');
        ok('1d · app-init.js la invoca con guarda typeof',
            /if \(typeof _renderFinishedMatchesTab === 'function'\)\s*\{\s*_renderFinishedMatchesTab\(\);/.test(ai));
        ok('1e · el ciclo está en los dos sentidos (esta sección llama a deleteFinishedMatchFromCloud)',
            /deleteFinishedMatchFromCloud\('\$\{m\.id\}'/.test(BLOCK)
            && /window\.deleteFinishedMatchFromCloud\s*=\s*async function/.test(ai));
        ok('1f · sigue habiendo UNA sola definición de _renderFinishedMatchesTab',
            (ai.match(/_renderFinishedMatchesTab\s*=\s*(async )?function/g) || []).length === 0);
        ok('1g · app-init.js conserva su renderizador paralelo showFinishedMatches',
            /async function showFinishedMatches\(\)/.test(ai));
    }
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const origin = idxOf(idxHtml, 'js/coach/reports/club-reports.js');
        const target = idxOf(idxHtml, 'js/coach/reports/finished-matches-tab.js');
        ok('1h · finished-matches-tab.js se carga después de club-reports.js',
            target !== -1 && target > origin, { origin, target });
        ok('1i · está en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/reports/finished-matches-tab.js'));
        ok('1j · está en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/reports/finished-matches-tab.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · carga de datos, filtros y merge ──');
    {
        const { g, container } = buildSandbox({ noDb: true });
        await g._renderFinishedMatchesTab();
        ok('2a · sin db avisa de error de conexión y no sigue',
            container.innerHTML.includes('Error de conexión.'));
    }
    {
        const { g, readCols } = buildSandbox({
            live: { L1: finished({ createdAt: 2 }) }, reports: {},
        });
        await g._renderFinishedMatchesTab();
        ok('2b · lee live_matches y cronos_player_reports',
            readCols.includes('live_matches') && readCols.includes('cronos_player_reports'), readCols);
    }
    {
        const { g, container } = buildSandbox({
            live: {
                A: finished({ homeName: 'ConStatus', createdAt: 5 }),
                B: { phase: 'finished', clubId: 'club1', homeName: 'ConPhase', createdAt: 4 },
                C: { matchPhase: 'finished', clubId: 'club1', homeName: 'ConMatchPhase', createdAt: 3 },
                D: { status: 'live', clubId: 'club1', homeName: 'EnCurso', createdAt: 2 },
            },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('2c · acepta finished por status, phase o matchPhase',
            h.includes('ConStatus') && h.includes('ConPhase') && h.includes('ConMatchPhase'));
        ok('2d · descarta los que no están terminados', !h.includes('EnCurso'));
    }
    {
        const { g, container } = buildSandbox({
            live: {
                A: { status: 'finished', clubId: 'club1', homeName: 'MiClub', createdAt: 3 },
                B: { status: 'finished', clubId: 'otro', createdBy: 'u1', homeName: 'MioPorCreador', createdAt: 2 },
                C: { status: 'finished', clubId: 'otro', createdBy: 'zz', homeName: 'Ajeno', createdAt: 1 },
            },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('2e · filtro de club: por clubId o por createdBy propio',
            h.includes('MiClub') && h.includes('MioPorCreador') && !h.includes('Ajeno'));
    }
    {
        const { g, container } = buildSandbox({
            me: { uid: 'u1', role: 'director', _activeRole: 'director' },   // sin clubId
            live: { A: { status: 'finished', clubId: 'cualquiera', homeName: 'SinClubIdTodo', createdAt: 1 } },
        });
        await g._renderFinishedMatchesTab();
        ok('2f · sin clubId en el usuario, no filtra por club',
            container.innerHTML.includes('SinClubIdTodo'));
    }
    {
        const { g, container } = buildSandbox({
            reports: {
                R1: collective({ homeName: 'PorStaffReport', createdAt: 5 }),
                R2: { type: 'collective_match_report', clubId: 'club1', homeName: 'PorType', createdAt: 4 },
                R3: { reportType: 'collective', clubId: 'club1', homeName: 'PorReportType', createdAt: 3 },
                R4: { clubId: 'club1', homeName: 'Individual', createdAt: 2 },
            },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('2g · acepta colectivos por staffReport, type o reportType',
            h.includes('PorStaffReport') && h.includes('PorType') && h.includes('PorReportType'));
        ok('2h · descarta los informes individuales', !h.includes('Individual'));
    }
    {
        // mismo partido en las dos colecciones: live_matches gana
        const { g, container } = buildSandbox({
            live: { M1: finished({ homeName: 'DesdeLive', createdAt: 5 }) },
            reports: { R9: collective({ liveMatchId: 'M1', homeName: 'DesdeReports', createdAt: 5 }) },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('2i · para el mismo partido, live_matches tiene precedencia',
            h.includes('DesdeLive') && !h.includes('DesdeReports'));
    }
    {
        const { g, container } = buildSandbox({
            reports: { R1: collective({ liveMatchId: 'LM7', homeName: 'ConLiveId', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        ok('2j · la clave del informe es liveMatchId cuando existe',
            container.innerHTML.includes(`openMatchReplay('LM7')`),
            container.innerHTML.slice(idxOf(container.innerHTML, 'openMatchReplay'), idxOf(container.innerHTML, 'openMatchReplay') + 40));
    }
    {
        const { g, container } = buildSandbox({ failLive: true,
            reports: { R1: collective({ homeName: 'ReportsSobrevive', createdAt: 1 }) } });
        await g._renderFinishedMatchesTab();
        ok('2k · si falla live_matches, los informes siguen cargando',
            container.innerHTML.includes('ReportsSobrevive'));
    }
    {
        const { g, container } = buildSandbox({ failReports: true,
            live: { L1: finished({ homeName: 'LiveSobrevive', createdAt: 1 }) } });
        await g._renderFinishedMatchesTab();
        ok('2l · si fallan los informes, live_matches sigue cargando',
            container.innerHTML.includes('LiveSobrevive'));
    }
    {
        const { g, container } = buildSandbox({
            live: {
                A: finished({ homeName: 'Viejo', createdAt: 100 }),
                B: finished({ homeName: 'Nuevo', createdAt: 900 }),
                C: finished({ homeName: 'Medio', createdAt: 500 }),
            },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('2m · ordena por createdAt descendente',
            idxOf(h, 'Nuevo') < idxOf(h, 'Medio') && idxOf(h, 'Medio') < idxOf(h, 'Viejo'));
    }
    // Rareza estructural: `...data` cierra el objeto y pisa la normalización.
    ok('2n · ⚠️ el objeto del informe termina en ...data (pisa la normalización previa)',
        /mode: data\.mode \|\| 'f7',\s*\.\.\.data\s*\}/.test(BLOCK));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · enriquecimiento retroactivo (escribe en render) ──');
    {
        const { g, written, readCols } = buildSandbox({
            live: { L1: finished({ category: 'Infantil', homeName: 'ConCat', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        ok('3a · si todos tienen categoría, no lee users ni escribe',
            !readCols.includes('users') && written.length === 0, { readCols, written });
    }
    {
        const { g, written, readCols } = buildSandbox({
            live: { L1: finished({ createdBy: 'coach9', homeName: 'SinCat', createdAt: 1 }) },
            users: { coach9: { category: 'Cadete', subcategory: 'B', email: 'c9@x.com' } },
        });
        await g._renderFinishedMatchesTab();
        ok('3b · con partidos sin categoría, lee users', readCols.includes('users'), readCols);
        // ⚠️ v434 · ASERCIÓN INVERTIDA. Hasta v434 exigía que el enriquecimiento
        // PERSISTIERA la categoría en live_matches. Eso es escribir sobre un
        // partido terminado, que es justo lo que la regla de inmutabilidad
        // prohíbe: la regla de Firestore lo deniega y el `.catch(() => {})` se
        // tragaba el error, dejando un fallo de permisos por cada ficha y cada
        // apertura de la pestaña. Ahora se comprueba lo contrario, y 3g sigue
        // fijando que la categoría SÍ se calcula y se pinta.
        ok('3c · [v434] NO persiste la categoría sobre un partido terminado',
            written.length === 0,
            written);
    }
    {
        const { g, written } = buildSandbox({
            reports: { R1: collective({ coachUid: 'coach9', homeName: 'SinCat', createdAt: 1 }) },
            users: { coach9: { category: 'Juvenil', subcategory: 'A' } },
        });
        await g._renderFinishedMatchesTab();
        ok('3d · para informes escribe en cronos_player_reports usando docId',
            written.length === 1 && written[0].col === 'cronos_player_reports' && written[0].id === 'R1',
            written);
    }
    {
        const { g, written, container } = buildSandbox({
            live: { L1: finished({ coachEmail: 'c9@x.com', homeName: 'SinCat', createdAt: 1 }) },
            users: { zz: { category: 'Alevín', email: 'c9@x.com' } },
        });
        await g._renderFinishedMatchesTab();
        // v434 · La resolución por email se sigue probando, pero mirando el
        // RENDER en vez de la escritura, que ya no ocurre para partidos.
        ok('3e · resuelve el entrenador también por email',
            container.innerHTML.includes('ALEVÍN'), container.innerHTML.slice(0, 200));
    }
    {
        const { g, written, container } = buildSandbox({
            me: { uid: 'u1', clubId: 'club1', role: 'director', _activeRole: 'director',
                  category: 'Infantil', subcategory: 'C' },
            live: { L1: finished({ createdBy: 'u1', homeName: 'SinCat', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        // v434 · Igual que 3e: se comprueba en el render, no en la escritura.
        ok('3f · usa la categoría del propio usuario si el partido es suyo',
            container.innerHTML.includes('INFANTIL') && container.innerHTML.includes('Grupo C'),
            container.innerHTML.slice(0, 200));
        ok('3g · y el render ya refleja la categoría enriquecida',
            container.innerHTML.includes('INFANTIL'), container.innerHTML.slice(0, 0) || undefined);
    }
    {
        const { g, container, written } = buildSandbox({
            failUsers: true,
            live: { L1: finished({ createdBy: 'coach9', homeName: 'SinCat', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        ok('3h · si falla la lectura de users, no escribe y el render continúa',
            written.length === 0 && container.innerHTML.includes('SinCat'), written);
    }
    ok('3i · la escritura es fire-and-forget con el error silenciado',
        /\}\)\.catch\(\(\) => \{\}\);/.test(BLOCK));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · vista ENTRENADOR (lista plana filtrada) ──');
    const coach = (extra) => Object.assign(
        { uid: 'c1', clubId: 'club1', role: 'user', _activeRole: 'user', email: 'c1@x.com' }, extra);
    {
        const { g, container } = buildSandbox({
            me: coach({ category: 'Infantil' }),
            live: {
                A: finished({ category: 'Infantil', homeName: 'MiCategoria', createdAt: 3 }),
                B: finished({ category: 'Cadete', homeName: 'OtraCategoria', createdAt: 2 }),
            },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('4a · el entrenador ve el título de su lista personal',
            h.includes('Mis Partidos Terminados (1)'), h.slice(idxOf(h, 'Mis Partidos'), idxOf(h, 'Mis Partidos') + 40));
        ok('4b · filtra a su categoría', h.includes('MiCategoria') && !h.includes('OtraCategoria'));
        ok('4c · no pinta el árbol de categorías', !h.includes('Subcategoría A'));
    }
    {
        const { g, container } = buildSandbox({
            me: coach({ _activeRole: 'coach', category: 'Infantil' }),
            live: { A: finished({ category: 'Infantil', homeName: 'RolCoach', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        ok('4d · el rol "coach" también entra por la rama de entrenador',
            container.innerHTML.includes('Mis Partidos Terminados'));
    }
    {
        const { g, container } = buildSandbox({
            me: coach({ category: 'Cadete' }),
            live: { A: finished({ category: 'Juvenil', createdBy: 'c1', homeName: 'MioAunqueOtraCat', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        ok('4e · sus propios partidos pasan aunque sean de otra categoría',
            container.innerHTML.includes('MioAunqueOtraCat'));
    }
    {
        const { g, container } = buildSandbox({
            me: coach({ category: 'infantil_b' }),
            live: {
                A: finished({ category: 'Infantil', subcategory: 'B', homeName: 'SubB', createdAt: 3 }),
                B: finished({ category: 'Infantil', subcategory: 'C', homeName: 'SubC', createdAt: 2 }),
                C: finished({ category: 'Infantil', homeName: 'SinSub', createdAt: 1 }),
            },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('4f · con subcategoría (derivada del sufijo _b) filtra por ella',
            h.includes('SubB') && !h.includes('SubC'));
        ok('4g · los partidos sin subcategoría pasan igualmente', h.includes('SinSub'));
    }
    {
        const { g, container } = buildSandbox({
            me: coach({ category: 'Cadete' }),
            live: { A: finished({ category: 'Juvenil', homeName: 'Nada', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('4h · vacío para entrenador: mensaje específico de su categoría',
            h.includes('No hay partidos terminados guardados')
            && h.includes('Solo se muestran los partidos de tu categoría'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · vista DIRECTOR/COORDINADOR (árbol) ──');
    {
        const { g, container } = buildSandbox({
            live: {
                A: finished({ category: 'Infantil', subcategory: 'B', homeName: 'InfB', createdAt: 3 }),
                B: finished({ category: 'Cadete', subcategory: 'A', homeName: 'CadA', createdAt: 2 }),
            },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('5a · título del club con el total',
            h.includes('Partidos Terminados del Club (2)'));
        ok('5b · pinta las 9 categorías siempre, con o sin partidos',
            ['Prebenjamín', 'Benjamín', 'Alevín', 'Infantil', 'Cadete', 'Juvenil',
             'Regional', 'Regional FEM', 'FUTureFEM']
                .every(c => h.includes(c)));
        ok('5c · y las 3 subcategorías en cada una',
            (h.match(/Subcategoría A/g) || []).length === 9
            && (h.match(/Subcategoría B/g) || []).length === 9
            && (h.match(/Subcategoría C/g) || []).length === 9,
            { a: (h.match(/Subcategoría A/g) || []).length });
        ok('5d · contador por categoría en singular y plural',
            h.includes('1 partido') && (h.match(/0 partidos/g) || []).length === 7,
            (h.match(/0 partidos/g) || []).length);
        ok('5e · las categorías con partidos vienen expandidas y las vacías colapsadas',
            h.includes('▼') && h.includes('►'));
        ok('5f · el partido cae en su subcategoría', idxOf(h, 'InfB') > idxOf(h, 'Infantil'));
        ok('5g · las subcategorías vacías avisan',
            h.includes('Sin partidos en esta subcategoría.'));
    }
    {
        const { g, container } = buildSandbox({
            live: {
                A: finished({ category: 'Infantil', subcategory: 'Z', homeName: 'SubRara', createdAt: 2 }),
                B: finished({ category: 'Prebenjamín', homeName: 'SinSub', createdAt: 1 }),
            },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('5h · una subcategoría no reconocida cae en la A',
            idxOf(h, 'SubRara') > idxOf(h, 'Subcategoría A'));
        ok('5i · _normCat normaliza acentos y prefijos (Prebenjamín)',
            h.includes('SinSub'));
    }
    {
        const { g, container } = buildSandbox({
            live: { A: finished({ category: 'Veteranos', homeName: 'CatDesconocida', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('5j · una categoría no reconocida va a "Sin categoría asignada"',
            h.includes('Sin categoría asignada (1)') && h.includes('CatDesconocida'));
    }
    {
        const { g, container } = buildSandbox({ live: {}, reports: {} });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('5k · vacío para director: mensaje genérico (no el de entrenador)',
            h.includes('No hay partidos terminados guardados')
            && h.includes('organizados por categoría')
            && !h.includes('Solo se muestran los partidos de tu categoría'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 6 · tarjeta de partido ──');
    {
        const { g, container } = buildSandbox({
            live: {
                M1: finished({
                    homeTeam: { name: 'CD <Local>', score: 3 },
                    awayTeam: { name: 'CD Visita', score: 1 },
                    category: 'Cadete', subcategory: 'A',
                    events: [1, 2, 3], matchDate: '02/03/2026', createdAt: 1,
                }),
            },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('6a · nombres escapados y marcador',
            h.includes(escHtml('CD <Local>') + ' vs ' + escHtml('CD Visita'))
            && h.includes('<strong>3 - 1</strong>'));
        ok('6b · etiqueta de categoría y grupo', h.includes('CADETE') && h.includes('Grupo A'));
        ok('6c · fecha desde matchDate', h.includes(escHtml('02/03/2026')));
        ok('6d · contador de eventos', h.includes('3 eventos'));
        // v434 · Este partido está DENTRO de la ventana de gracia (finished()
        // lo fabrica recién terminado), así que conserva los tres botones.
        ok('6e · los tres botones con sus llamadas',
            h.includes(`window.openMatchReplay('M1')`)
            && h.includes(`openRetroactiveEventModal('M1')`)
            && h.includes(`deleteFinishedMatchFromCloud('M1', '', event)`));
        ok('6e2 · [v434] y el chip dice cuánta ventana queda', h.includes('✏️'), h.slice(0, 200));
        ok('6f · ⚠️ el modal retroactivo va guardado y el borrado NO',
            h.includes(`if(typeof openRetroactiveEventModal==='function')`)
            && !/typeof deleteFinishedMatchFromCloud/.test(h));
    }
    {
        // ── v434 · LA OTRA MITAD: un partido CONGELADO no ofrece salida ──
        // Es la comprobación que da valor a la regla: pasadas las 2 h la ficha
        // se puede revivir, pero ni se le añaden sucesos ni se borra.
        const { g, container } = buildSandbox({
            live: { M9: congelado({ homeName: 'Viejo', awayName: 'Rival', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        const hc = container.innerHTML;
        ok('6h · [v434] la ficha congelada se marca como CERRADA', hc.includes('🔒 CERRADO'));
        ok('6i · [v434] y NO ofrece el botón de evento retroactivo',
            !hc.includes('openRetroactiveEventModal'),
            'pasadas las 2 h no se admite ninguna incidencia');
        ok('6j · [v434] ni el de borrar',
            !hc.includes('deleteFinishedMatchFromCloud'),
            'lo que no se puede editar tampoco se puede hacer desaparecer');
        ok('6k · [v434] pero SÍ se puede seguir reviviendo',
            hc.includes(`window.openMatchReplay('M9')`),
            'la consulta del historial no se toca: solo la escritura');
    }
    {
        const { g, container } = buildSandbox({
            live: { "id'raro": finished({ homeName: 'X', createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        ok('6g · ⚠️ el id se interpola SIN escapeAttr (inconsistencia preservada)',
            container.innerHTML.includes(`openMatchReplay('id'raro')`),
            container.innerHTML.slice(idxOf(container.innerHTML, 'openMatchReplay'), idxOf(container.innerHTML, 'openMatchReplay') + 40));
    }
    {
        const { g, container } = buildSandbox({
            live: { M2: finished({ homeTeam: 'SoloTexto', scoreHome: 2, goalsAway: 5, createdAt: 1 }) },
        });
        await g._renderFinishedMatchesTab();
        const h = container.innerHTML;
        ok('6h · fallbacks: homeTeam string, scoreHome y goalsAway',
            h.includes('SoloTexto vs VISITANTE') && h.includes('<strong>2 - 5</strong>'));
    }
    {
        const { g, container } = buildSandbox({
            live: { M3: finished({ homeName: 'X', createdAt: 0, events: [] }) },
        });
        await g._renderFinishedMatchesTab();
        ok('6i · sin eventos no pinta el contador', !container.innerHTML.includes('eventos'));
        ok('6j · sin fecha utilizable muestra el guion', container.innerHTML.includes('📅 —'));
    }
    {
        const { g, container } = buildSandbox({
            live: { M4: finished({ homeName: 'X', createdAt: { seconds: 1772000000 } }) },
        });
        await g._renderFinishedMatchesTab();
        // OJO: dateStr pasa por escapeHtml, que escapa "/" como &#x2F;. Se
        // renderiza igual en el navegador, pero el HTML crudo lleva la entidad.
        ok('6k · createdAt tipo timestamp {seconds} se formatea como fecha (barras escapadas)',
            /📅 \d{1,2}&#x2F;\d{1,2}&#x2F;\d{4}/.test(container.innerHTML),
            container.innerHTML.slice(idxOf(container.innerHTML, '📅'), idxOf(container.innerHTML, '📅') + 24));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 7 · errores ──');
    {
        const { g, container } = buildSandbox({ sdFSThrows: 'fallo <grave>' });
        await g._renderFinishedMatchesTab();
        ok('7a · un error inesperado se pinta escapado y no propaga',
            container.innerHTML.includes('Error cargando partidos terminados')
            && container.innerHTML.includes('fallo &lt;grave&gt;'),
            container.innerHTML.slice(0, 130));
    }
    {
        // Todos los accesos a `me` usan optional chaining: sin usuario NO lanza,
        // degrada a "sin clubId" (no filtra por club) y muestra el vacío genérico.
        const { g, container } = buildSandbox({ noUser: true });
        await g._renderFinishedMatchesTab();
        ok('7b · sin usuario en sesión degrada al vacío genérico, sin lanzar',
            container.innerHTML.includes('No hay partidos terminados guardados')
            && !container.innerHTML.includes('Error cargando'),
            container.innerHTML.slice(0, 90));
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
