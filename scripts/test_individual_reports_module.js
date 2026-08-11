// ─────────────────────────────────────────────────────────────────────────
// test_individual_reports_module.js · Refactor de monolitos (auditoria 2026-07-22)
// MONOLITO #3 (js/coach/comms/panel.js), PASO 3 de 6: extraccion de
// "Mis informes / Informes individuales" (openMisInformes /
// openIndividualReports / _sendAllIndividualReports, ~575 lineas) a
// js/coach/comms/individual-reports.js.
//
// Escrito y ejecutado EN VERDE contra el codigo todavia SIN mover (Puerta 3).
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
// Fan-out: la interseccion del bloque contra los 69 nombres de nivel superior
// de panel.js da EXACTAMENTE TRES: _cFS, _cMyTeamKey y openUnifiedCommsMenu.
// Los tres se quedan en panel.js (openUnifiedCommsMenu se movera en el paso 5)
// y resuelven via window en tiempo de click, asi que el orden de <script> es
// irrelevante para la ejecucion.
//
// Fan-in de openMisInformes = 2, ambos onclick con guarda typeof:
//   js/core/app-init.js:1053 y js/core/setup-modal.js:267.
//
// ⚠️ openIndividualReports y _sendAllIndividualReports NO TIENEN NINGUN PUNTO
// DE ENTRADA en todo el repositorio: ni onclick, ni llamada JS, ni
// window[nombre](). Lo unico que los nombra fuera de su definicion es la
// autoasignacion no-op `window.openIndividualReports = window.openIndividualReports;`
// y el boton "Enviar todos" del HTML que la propia openIndividualReports pinta.
// Es la MISMA situacion que openCollectiveReport en el paso 2. Se mueven TAL
// CUAL, no se borra nada y no se afirma que sean codigo muerto: si alguien
// confirma que no hay via de entrada, seran candidatos a borrado. La parte 1
// fija el hecho para que quede documentado y visible.
//
// ── DEPENDENCIAS EXTERNAS (fuera de panel.js) ──
//  · _RP.build  → js/coach/reports/report-engine.js. Es un `const` de nivel
//    superior, no window._RP, asi que `typeof _RP !== 'undefined'` seria
//    ILUSORIA en zona muerta temporal (lanzaria ReferenceError en vez de
//    devolver 'undefined'). Inocua porque miToggleInforme solo corre al hacer
//    click, mucho despues de que report-engine.js se haya ejecutado. ESTA es
//    la linea que hoy vigila test_report_engine_module.js:1f leyendo panel.js.
//  · escapeHtml, formatTime (js/match/timer/core.js), showToast/showSpinner/
//    hideSpinner, TEAM_NAMES, window.players, window._cronos_squad_cache.
//  · `emailConfig` (let, app-init.js:136) y `currentMode` (var, app-init.js:109)
//    son globales lexicos leidos con guarda typeof.
//
// ── ⚠️ DOS TESTS EXISTENTES QUE ESTE PASO ROMPE (hay que actualizarlos en el
//    MISMO commit de extraccion) ──
// scripts/test_report_engine_module.js:
//   · 1f exige el literal `typeof _RP !== 'undefined' && typeof _RP.build ===
//     'function'` LEYENDO js/coach/comms/panel.js. Esa linea se va con el
//     bloque.
//   · 1e compara la lista de CONSUMIDORES de _RP contra
//     ['js/coach/comms/panel.js', 'js/coach/reports/reports-tab.js'].
//     Tras el paso, panel.js deja de nombrar _RP en codigo y pasa a nombrarlo
//     individual-reports.js.
//   ⚠️ Corolario: el comentario-puntero que quede en panel.js NO debe nombrar
//   _RP. El barredor de 1e solo quita comentarios de linea (`//`) tras un
//   .trim(), asi que un `/* */` con _RP dentro contaria como consumidor.
// Ningun otro test del repositorio nombra las tres funciones movidas ni
// depende de literales que vivan SOLO dentro del bloque (verificado barriendo
// los literales de los 24 tests que leen comms/panel.js).
//
// ── DOS DEFECTOS PREEXISTENTES QUE SE PRESERVAN (no se arreglan aqui) ──
//  1. `window.sdDownloadInforme` NO EXISTE en ningun sitio del repositorio.
//     miDescargarInforme lo comprueba con typeof y, al no encontrarlo, siempre
//     sale por el toast "Funcion de descarga no disponible": el boton
//     "📥 Descargar TXT" nunca descarga nada. Parte 3d lo fija.
//  2. `miDismissed` (openMisInformes) lee localStorage.cronos_mi_dismissed_info
//     y NO SE USA NUNCA. El catch de miEliminarInforme si escribe esa clave
//     como fallback, luego los ocultados en local jamas se vuelven a filtrar
//     al recargar. Parte 2k lo fija.
// Ademas `realDelete` es un parametro declarado y jamas leido: el boton de la
// papelera pasa true y aun asi el borrado es SIEMPRE logico (dismissedBy).
// Eso ultimo es deliberado (FIX v2, comentado en el codigo) y lo fija 3e.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'comms', 'panel.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'comms', 'individual-reports.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Mis informes / Informes individuales — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('window.openMisInformes = async function openMisInformes()');
    if (s === -1) throw new Error('No se encontro openMisInformes en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    const e = src.indexOf('// publishConvocationToApp', s);
    if (e === -1) throw new Error('No se encontro el final de la seccion');
    const cut = src.slice(s, e);
    return cut.slice(0, cut.lastIndexOf('};') + 2);
}
const BLOCK = readBlock();

// utils.js REAL (cronosTeamId / cronosDocEsDeEquipo). Se ejecuta dentro del
// mismo sandbox que el bloque bajo prueba, para que el filtrado por equipo se
// mida contra la normalización de verdad y no contra una imitación.
const UTILS_SRC = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
}

// ── Sandbox ──────────────────────────────────────────────────────────────
function buildSandbox({
    me = { uid: 'coach1', clubId: 'club1', email: 'c@x.com' },
    reports = [],                 // documentos de cronos_player_reports
    linkDocs = [],                // documentos de cronos_player_links
    emailContacts = null,         // null = emailConfig indefinido
    squad = null,
    players = null,               // window.players
    noModal = false,
    withRP = true,
    withDownloader = false,
    confirmAnswer = true,
    getDocsThrows = null,
    updateThrows = null,
    setDocThrows = null,
    threadExists = false,
    store = {},                   // localStorage inicial
} = {}) {
    const written = [];
    const toasts = [];
    const spinners = [];
    const logs = [];
    const menuCalls = [];
    const opened = [];
    const blobs = [];        // contenido de cada TXT generado
    const descargas = [];    // { download, href, adjuntado } por cada click de descarga
    const rpCalls = [];
    const els = {};

    // OJO: los paneles de detalle se pintan con `style="display:none;..."` en el
    // propio HTML generado, y miToggleInforme decide si esta abierto leyendo
    // `detail.style.display !== 'none'`. Un mock con style={} arranca en
    // undefined y el primer click CIERRA en vez de abrir (falso negativo).
    const mkEl = (id) => ({
        id, innerHTML: '', textContent: '', value: '',
        style: /^mi-rp-detail-/.test(id) ? { display: 'none' } : {},
        dataset: {},
        removed: false,
        remove() { this.removed = true; },
        querySelector() { return this.__child || (this.__child = mkEl(id + '>div')); },
    });
    const el = (id) => (els[id] = els[id] || mkEl(id));
    if (!noModal) el('setup-modal');
    el('score-home').textContent = '3';
    el('score-away').textContent = '1';

    const snapOf = (docs) => ({
        forEach: (fn) => docs.forEach(d => fn({ id: d._id || d.id || 'auto', data: () => d })),
    });

    const fakeFS = {
        db: {},
        collection: (db, name) => ({ __col: name }),
        query: (colRef, ...clauses) => ({ __col: colRef.__col, clauses }),
        // ⚠️ `where` devolvía la CADENA `f+op+v` y getDocs no la miraba: el
        // doble entregaba TODOS los documentos hiciera la consulta lo que
        // hiciera. Con eso, una aserción del tipo "el entrenador entrante ve
        // el histórico" pasaba aunque la consulta siguiera filtrando por
        // coachUid — es decir, seguía verde con el defecto delante. Ahora la
        // cláusula se guarda estructurada y getDocs la APLICA.
        where: (campo, op, valor) => ({ __where: true, campo, op, valor }),
        // `limit` faltaba en este doble. _cFS() hace `{...module, db}`, así que
        // en producción SÍ existe; aquí su ausencia hacía estallar la consulta
        // con "limit is not a function" y el módulo caía al pintado de error,
        // no al estado vacío. Un doble incompleto no prueba menos: prueba OTRA
        // cosa, y encima en verde para las aserciones que no lo tocan.
        limit: (n) => ({ __limit: n }),
        // `orderBy` faltaba, y por la MISMA razón que faltaba `limit`: en
        // producción `_cFS()` hace `{...module, db}` y existe siempre. Desde
        // v508 la consulta de "Mis Informes" ordena por `__name__` DESC (un
        // `limit` sin orden dejaba la ventana clavada en lo más viejo, ver
        // scripts/test_mis_informes_ventana_reciente.js), y sin esta función
        // el doble reventaba con "orderBy is not a function" y el módulo caía
        // al pintado de error en vez de al estado vacío.
        orderBy: (campo, dir) => ({ __orderBy: true, campo, dir: dir || 'asc' }),
        getDocs: async (q) => {
            if (getDocsThrows) throw new Error(getDocsThrows);
            // Aplica las cláusulas '==' igual que lo haría Firestore, para que
            // el doble no entregue documentos que la consulta real no traería.
            // Y ORDENA/RECORTA como ella: si no, el doble probaría otra cosa.
            const aplica = (docs) => {
                const filtros = (q.clauses || []).filter(c => c && c.__where && c.op === '==');
                let r = docs.filter(d => filtros.every(f => d[f.campo] === f.valor));
                const ord = (q.clauses || []).find(c => c && c.__orderBy);
                if (ord) {
                    const clave = (d) => String(ord.campo === '__name__'
                        ? (d._id || d.id || '') : (d[ord.campo] ?? ''));
                    r = r.slice().sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0));
                    if (String(ord.dir).toLowerCase() === 'desc') r.reverse();
                }
                const lim = (q.clauses || []).find(c => c && typeof c.__limit === 'number');
                if (lim) r = r.slice(0, lim.__limit);
                return r;
            };
            if (q.__col === 'cronos_player_reports') return snapOf(aplica(reports));
            // Los enlaces se consultan con where('clubId','==',me.clubId). Las
            // fixtures se escribieron SIN clubId —documentos que la consulta
            // real jamás habría devuelto—, así que se les pone el del club del
            // usuario salvo que la propia fixture fije otro a propósito.
            if (q.__col === 'cronos_player_links') {
                const conClub = linkDocs.map(d =>
                    ('clubId' in d) ? d : Object.assign({}, d, { clubId: me.clubId || '' }));
                return snapOf(aplica(conClub));
            }
            return snapOf([]);
        },
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async (ref) => ({
            exists: () => threadExists,
            data: () => (threadExists ? { unreadByParent: 4 } : undefined),
        }),
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

    const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: me,
            players,
            _cronos_squad_cache: squad,
            open: (u) => opened.push(u),
        },
        document: {
            getElementById: (id) => {
                if (id === 'setup-modal' && noModal) return null;
                return el(id);
            },
            // Descarga del TXT: se captura el <a> que se crea, se comprueba que
            // se ADJUNTA al DOM antes del click (un a.click() suelto no dispara
            // la descarga en Firefox) y se guarda el archivo resultante.
            createElement: (tag) => {
                const node = { tagName: String(tag).toUpperCase(), href: '', download: '',
                    click() { descargas.push({ download: node.download, href: node.href,
                                               adjuntado: node._adjuntado === true }); } };
                return node;
            },
            body: {
                appendChild: (n) => { n._adjuntado = true; return n; },
                removeChild: (n) => { n._quitado = true; return n; },
            },
        },
        // Blob/URL no existen en Node: se capturan para poder leer el TXT.
        Blob: function (partes) { this.partes = partes; blobs.push(partes.join('')); },
        URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
        console: {
            log: (...a) => logs.push(a.join(' ')),
            warn: (...a) => logs.push(a.join(' ')),
            error: (...a) => logs.push(a.join(' ')),
        },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        parseInt, parseFloat, isNaN, RegExp, Error,
        btoa, atob, escape, unescape, encodeURIComponent, decodeURIComponent,
        setTimeout: (fn, ms) => { try { fn(); } catch (e) { /* noop */ } return 0; },
        clearTimeout: () => {},
        localStorage,
        confirm: () => confirmAnswer,
        TEAM_NAMES: { home: 'CD Local', away: 'CD Rival' },
        currentMode: 'f11',
        showToast: (m) => toasts.push(String(m)),
        showSpinner: (m) => spinners.push({ on: true, msg: m }),
        hideSpinner: () => spinners.push({ on: false }),
        escapeHtml: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        formatTime: (sec) => String(Math.floor((sec || 0) / 60)) + "'",
        // Los tres unicos helpers de panel.js que el bloque necesita.
        _cFS: async () => fakeFS,
        _cMyTeamKey: () => 'home',
        openUnifiedCommsMenu: () => { menuCalls.push(1); },
    };
    if (emailContacts !== null) sandbox.emailConfig = { contacts: emailContacts };
    if (withRP) {
        sandbox._RP = {
            build: (m, user) => { rpCalls.push({ key: m.key, user: user && user.uid }); return '<div>GANTT</div>'; },
        };
    }
    if (withDownloader) sandbox.window.sdDownloadInforme = (k) => opened.push('download:' + k);

    // Los helpers de equipo se cargan del utils.js REAL, no se remedan.
    // El filtrado por equipo depende de que "Alevín" y "Alevin" produzcan la
    // misma clave; un doble escrito a mano daría por buena esa equivalencia
    // sin comprobarla, que es no probar nada.
    vm.createContext(sandbox);
    vm.runInContext(UTILS_SRC, sandbox);

    vm.runInContext(BLOCK, sandbox);

    return {
        g: sandbox, w: sandbox.window,
        written, toasts, spinners, logs, menuCalls, opened, rpCalls, store, blobs, descargas,
        el: (id) => els[id],
        body: () => els['mis-informes-body'],
        indivBody: () => els['indiv-rpt-body'],
        modal: () => els['setup-modal'],
    };
}

const key64of = (key) => btoa(unescape(encodeURIComponent(key))).replace(/=/g, '');
const rep = (o = {}) => Object.assign({
    _id: 'r1', coachUid: 'coach1', _forCoach: true,
    matchId: 'M1', matchDate: '2026-05-10', rival: 'CD Rival',
    scoreHome: 2, scoreAway: 1, playerNumber: '7', playerAlias: 'Ana',
    createdAt: '2026-05-10T20:00:00.000Z', goals: 0,
}, o);
const inCol = (written, col) => written.filter(w => w.col === col);

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura, acoplamiento y alcanzabilidad ──');
    ok('1a · las tres funciones se asignan a window',
        /^window\.openMisInformes = async function openMisInformes\(\)/m.test(BLOCK)
        && /^window\.openIndividualReports = async function openIndividualReports\(\)/m.test(BLOCK)
        && /^window\._sendAllIndividualReports = async function\(\)/m.test(BLOCK));
    {
        // Interseccion real contra los nombres de nivel superior de panel.js.
        const panel = fs.readFileSync(ORIGIN, 'utf8');
        const names = new Set();
        for (const l of panel.split(/\r?\n/)) {
            let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
            m = l.match(/^window\.([A-Za-z_$][\w$]*)\s*=(?!=)/); if (m) names.add(m[1]);
            m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
        }
        const moved = ['openMisInformes', 'openIndividualReports', '_sendAllIndividualReports'];
        const used = [...names].filter(n => !moved.includes(n)
            && new RegExp('\\b' + n.replace(/[$]/g, '\\$') + '\\b').test(BLOCK)).sort();
        ok('1b · fan-out a panel.js = exactamente _cFS, _cMyTeamKey y openUnifiedCommsMenu',
            JSON.stringify(used) === JSON.stringify(['_cFS', '_cMyTeamKey', 'openUnifiedCommsMenu']), used);
    }
    {
        const callers = [];
        const orphanRefs = [];
        for (const f of walk(ROOT, [])) {
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            if (rel.startsWith('scripts/') || rel === 'sw.js') continue;
            const txt = fs.readFileSync(f, 'utf8');
            if (rel !== 'js/coach/comms/panel.js' && rel !== 'js/coach/comms/individual-reports.js'
                && /\bopenMisInformes\b/.test(txt)) callers.push(rel);
            if (rel !== 'js/coach/comms/panel.js' && rel !== 'js/coach/comms/individual-reports.js'
                && /\b(openIndividualReports|_sendAllIndividualReports)\b/.test(txt)) orphanRefs.push(rel);
        }
        ok('1c · fan-in de openMisInformes = app-init.js + setup-modal.js (y nada mas)',
            JSON.stringify(callers.sort()) === JSON.stringify(['js/core/app-init.js', 'js/core/setup-modal.js']),
            callers);
        ok('1d · ⚠️ openIndividualReports / _sendAllIndividualReports no tienen invocador en TODO el repo',
            orphanRefs.length === 0, orphanRefs);
        const panel = fs.readFileSync(ORIGIN, 'utf8');
        ok('1e · las dos llamadas a openMisInformes estan protegidas con typeof',
            (fs.readFileSync(path.join(ROOT, 'js', 'core', 'app-init.js'), 'utf8')
                .includes("typeof openMisInformes==='function'"))
            && /typeof openMisInformes === .{0,3}function/.test(
                fs.readFileSync(path.join(ROOT, 'js', 'core', 'setup-modal.js'), 'utf8')));
        ok('1f · la autoasignacion window.openIndividualReports = window.openIndividualReports sigue en panel.js',
            /window\.openIndividualReports\s+= window\.openIndividualReports;/.test(panel));
    }
    ok('1g · el render del Gantt usa la guarda typeof sobre _RP (ilusoria para un const en TDZ)',
        /typeof _RP !== 'undefined' && typeof _RP\.build === 'function'/.test(BLOCK)
        && /_RP\.build\(m, window\._cronosCurrentUser\)/.test(BLOCK));
    ok('1h · no hay ni un solo deleteDoc en el bloque (borrado SIEMPRE logico)',
        !/deleteDoc/.test(BLOCK));
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const comms = idxHtml.indexOf('js/coach/comms/panel.js');
        const target = idxHtml.indexOf('js/coach/comms/individual-reports.js');
        ok('1i · individual-reports.js se carga despues de comms/panel.js',
            target !== -1 && target > comms, { comms, target });
        ok('1j · esta en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')
                .includes('js/coach/comms/individual-reports.js'));
        ok('1k · esta en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/comms/individual-reports.js'));
        {
            // Los dos asertos de test_report_engine_module.js que este paso rompe.
            const t = fs.readFileSync(path.join(ROOT, 'scripts', 'test_report_engine_module.js'), 'utf8');
            ok('1l · test_report_engine_module.js ya conoce individual-reports.js (1e/1f actualizados)',
                t.includes('js/coach/comms/individual-reports.js'));
            const panel = fs.readFileSync(ORIGIN, 'utf8');
            const code = panel.split('\n').map(l => l.trim().replace(/\/\/.*$/, '')).join('\n');
            ok('1m · ⚠️ el puntero que queda en panel.js NO nombra _RP en codigo (falsearia el barrido 1e)',
                !/\b_RP\b/.test(code));
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · openMisInformes: consulta, agrupacion y pintado ──');
    // ⚠️ 2a DEFENDÍA EL DEFECTO. Afirmaba que la consulta va por
    // `where('coachUid','==',me.uid)`, que era precisamente lo que escondía el
    // histórico al entrenador entrante: veía "Mis Informes" vacío aunque el
    // club conservara todo el histórico de su categoría. Ahora la consulta va
    // por CLUB cuando hay equipo asignado, y solo cae a coachUid como
    // respaldo (entrenador sin categoría, o ente individual sin clubId).
    ok('2a · consulta por CLUB cuando hay equipo asignado',
        /collection\(db, 'cronos_player_reports'\)/.test(BLOCK)
        && /where\('clubId', '==', me\.clubId\)/.test(BLOCK));
    ok('2a-bis · conserva el respaldo por coachUid (sin club o sin categoría)',
        /where\('coachUid', '==', me\.uid\)/.test(BLOCK));
    ok('2b · filtra en cliente por _forCoach === true',
        /datos\._forCoach !== true/.test(BLOCK));
    {
        const t = buildSandbox({ reports: [] });
        await t.w.openMisInformes();
        ok('2c · sin informes pinta el estado vacio',
            t.body().innerHTML.includes('Sin informes aun') || t.body().innerHTML.includes('Sin informes aún'),
            t.body().innerHTML.slice(0, 80));
    }
    {
        // Un doc del propio entrenador y otro que NO lo es.
        const t = buildSandbox({
            reports: [rep({ _id: 'a' }), rep({ _id: 'b', playerNumber: '9', _forCoach: false })],
        });
        await t.w.openMisInformes();
        const m = t.w._misInformesData['M1'];
        ok('2d · descarta los documentos sin _forCoach === true',
            m && m.players.length === 1 && m.players[0].playerNumber === '7',
            m && m.players.map(p => p.playerNumber));
    }

    // ═════════════════════════════════════════════════════════════════════
    // EL RELEVO DE ENTRENADOR — lo que el punto 2 tiene que garantizar
    // ═════════════════════════════════════════════════════════════════════
    {
        // Entrenador NUEVO (uid 'coach2') que acaba de heredar Alevín B.
        // Todo el histórico lo firmó 'coach1', que ya no está. Antes esto
        // devolvía la pantalla vacía; ahora tiene que ver el histórico.
        const nuevo = { uid: 'coach2', clubId: 'club1', email: 'n@x.com',
                        category: 'Alevín', subcategory: 'B' };
        const t = buildSandbox({
            me: nuevo,
            reports: [
                // Histórico del equipo, SIN campo teamId (como en producción)
                // y firmado por OTRO entrenador.
                rep({ _id: 'h1', coachUid: 'coach1', matchId: 'M-VIEJO',
                      clubId: 'club1', category: 'Alevin', subcategory: 'b' }),
                // Informe de OTRA categoría del mismo club: NO debe colarse.
                rep({ _id: 'x1', coachUid: 'coach1', matchId: 'M-OTRO',
                      clubId: 'club1', category: 'Juvenil', subcategory: 'C',
                      playerNumber: '9' }),
            ],
        });
        await t.w.openMisInformes();
        const datos = t.w._misInformesData || {};
        ok('2n · el entrenador entrante VE el histórico de su categoría (firmado por otro, y sin teamId)',
            !!datos['M-VIEJO'], Object.keys(datos));
        ok('2o · NO ve los informes de otra categoría del mismo club',
            !datos['M-OTRO'], Object.keys(datos));
        ok('2p · la equivalencia de acentos/mayúsculas no parte el equipo ("Alevin/b" == "Alevín/B")',
            !!datos['M-VIEJO']);
    }
    {
        // Entrenador SIN categoría asignada: se conserva el comportamiento
        // anterior (solo lo suyo). Ensanchar aquí al club entero sería un
        // agujero, no una mejora.
        const t = buildSandbox({
            me: { uid: 'coach3', clubId: 'club1', email: 's@x.com' },
            reports: [rep({ _id: 'p1', coachUid: 'coach3', matchId: 'M-MIO', clubId: 'club1' })],
        });
        await t.w.openMisInformes();
        ok('2q · sin categoría asignada se consulta por coachUid (sin ensanchar al club)',
            !!(t.w._misInformesData || {})['M-MIO']);
    }
    {
        const t = buildSandbox({
            reports: [
                rep({ _id: 'a', playerNumber: '7', createdAt: '2026-05-10T20:00:00.000Z', goals: 1 }),
                rep({ _id: 'b', playerNumber: '7', createdAt: '2026-05-10T21:00:00.000Z', goals: 3 }),
                rep({ _id: 'c', playerNumber: '2' }),
            ],
        });
        await t.w.openMisInformes();
        const m = t.w._misInformesData['M1'];
        ok('2e · deduplica por dorsal quedandose con el createdAt mas reciente',
            m.players.length === 2 && m.players.find(p => p.playerNumber === '7').goals === 3,
            m.players.map(p => [p.playerNumber, p.goals]));
        ok('2f · ordena los jugadores por dorsal ascendente',
            m.players.map(p => p.playerNumber).join() === '2,7', m.players.map(p => p.playerNumber));
        ok('2g · publica el agrupado en window._misInformesData', !!t.w._misInformesData);
    }
    {
        const t = buildSandbox({ reports: [rep({ scoreHome: 2, scoreAway: 1 })] });
        await t.w.openMisInformes();
        ok('2h · sin myTeamRole el resultado se calcula como local (2-1 = VICTORIA)',
            t.body().innerHTML.includes('VICTORIA'), t.body().innerHTML.includes('DERROTA'));
    }
    {
        const t = buildSandbox({ reports: [rep({ scoreHome: 2, scoreAway: 1, myTeamRole: 'away' })] });
        await t.w.openMisInformes();
        ok('2i · con myTeamRole="away" el mismo 2-1 es DERROTA',
            t.body().innerHTML.includes('DERROTA') && !t.body().innerHTML.includes('VICTORIA'));
    }
    {
        const t = buildSandbox({
            reports: [
                rep({ _id: 'a', matchId: 'M1', createdAt: '2026-05-01T10:00:00.000Z', rival: 'Viejo' }),
                rep({ _id: 'b', matchId: 'M2', createdAt: '2026-06-01T10:00:00.000Z', rival: 'Nuevo' }),
            ],
        });
        await t.w.openMisInformes();
        const h = t.body().innerHTML;
        ok('2j · ordena los partidos por createdAt descendente',
            h.indexOf('Nuevo') < h.indexOf('Viejo'), { nuevo: h.indexOf('Nuevo'), viejo: h.indexOf('Viejo') });
        ok('2k · la cabecera cuenta partidos e informes',
            /2 partidos · 2 informes de jugadores/.test(h), h.slice(0, 120));
    }
    ok('2l · ⚠️ miDismissed se lee de localStorage y NO SE USA NUNCA (los ocultados en local no se filtran)',
        /const miDismissed = JSON\.parse\(localStorage\.getItem\('cronos_mi_dismissed_info'/.test(BLOCK)
        && (BLOCK.match(/\bmiDismissed\b/g) || []).length === 1);
    {
        const t = buildSandbox({ getDocsThrows: 'sin permisos' });
        await t.w.openMisInformes();
        ok('2m · un fallo de la consulta se pinta en el cuerpo de la modal',
            t.body().innerHTML.includes('sin permisos'), t.body().innerHTML.slice(0, 80));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · miToggleInforme / miDescargarInforme / miEliminarInforme ──');
    {
        const t = buildSandbox({ reports: [rep()] });
        await t.w.openMisInformes();
        const k = key64of('M1');
        ok('3a · openMisInformes publica los tres manejadores anidados',
            typeof t.w.miToggleInforme === 'function'
            && typeof t.w.miDescargarInforme === 'function'
            && typeof t.w.miEliminarInforme === 'function');
        t.w.miToggleInforme(k);
        const detail = t.el('mi-rp-detail-' + k);
        ok('3b · el toggle delega el render en _RP.build(m, usuario actual)',
            t.rpCalls.length === 1 && t.rpCalls[0].key === 'M1' && t.rpCalls[0].user === 'coach1',
            t.rpCalls);
        ok('3c · inyecta el informe y los botones de accion, y lo deja abierto',
            detail.innerHTML.includes('GANTT') && detail.innerHTML.includes('Descargar TXT')
            && detail.style.display === 'block');
        t.w.miToggleInforme(k);
        t.w.miToggleInforme(k);
        ok('3d · dataset.rendered cachea: _RP.build no se vuelve a llamar',
            t.rpCalls.length === 1 && detail.dataset.rendered === '1', t.rpCalls.length);
    }
    {
        const t = buildSandbox({ reports: [rep()], withRP: false });
        await t.w.openMisInformes();
        const k = key64of('M1');
        t.w.miToggleInforme(k);
        ok('3e · sin motor de informes el catch pinta el aviso, no rompe la modal',
            t.el('mi-rp-detail-' + k).innerHTML.includes('Motor de informes no disponible'),
            t.el('mi-rp-detail-' + k).innerHTML.slice(0, 90));
    }
    // ── "Descargar TXT" · ARREGLADO 2026-07-29 ──────────────────────────
    // ESTAS ASERCIONES ESTABAN INVERTIDAS: 3f y 3g fijaban el DEFECTO (que la
    // descarga no hacia nada) y 3h describia lo que pasaria "si algun dia
    // existiera" sdDownloadInforme. El boton delegaba en esa funcion, que vivia
    // en js/23_staff_dashboard.js y desaparecio al refactorizar ese archivo.
    // Ahora miDescargarInforme es autocontenido y las tres afirman lo contrario.
    {
        const t = buildSandbox({ reports: [rep()] });
        await t.w.openMisInformes();
        t.w.miDescargarInforme(key64of('M1'));
        ok('3f · ⚠️ "Descargar TXT" GENERA el archivo y avisa (antes nunca descargaba nada)',
            t.blobs.length === 1 && t.descargas.length === 1
            && t.toasts.some(x => x.includes('descargado')),
            { blobs: t.blobs.length, descargas: t.descargas, toasts: t.toasts });
        ok('3f2 · el <a> se ADJUNTA al DOM antes del click (sin eso Firefox no descarga)',
            t.descargas[0] && t.descargas[0].adjuntado === true, t.descargas[0]);
        ok('3f3 · el nombre del archivo lleva rival y fecha, sin caracteres ilegales',
            t.descargas[0] && /^informe_.+_\d{4}-\d{2}-\d{2}\.txt$/.test(t.descargas[0].download)
            && !/[\\/:*?"<>|]/.test(t.descargas[0].download), t.descargas[0] && t.descargas[0].download);

        const txt = t.blobs[0] || '';
        ok('3f4 · el TXT empieza por el BOM (si no, el Bloc de notas rompe los acentos)',
            txt.charCodeAt(0) === 0xFEFF, txt.charCodeAt(0));
        ok('3f5 · el TXT lleva cabecera, rival, resultado y la lista de jugadores',
            txt.includes('INFORME DE PARTIDO') && txt.includes('Rival:')
            && txt.includes('Resultado:') && txt.includes('JUGADORES'), txt.slice(0, 160));
        ok('3f6 · incluye al jugador con su dorsal, minutos y goles',
            /#\s*7 /.test(txt) && /Minutos:/.test(txt) && /Goles:/.test(txt), txt);
        // ⚠️ el TXT NO puede contradecir a la pantalla: la tarjeta calcula el
        // veredicto con myTeamRole y sin el cae a 'home' (ver 2h/2i).
        ok('3f7 · ⚠️ el veredicto usa la MISMA regla que la tarjeta (sin myTeamRole, 2-1 = VICTORIA)',
            txt.includes('VICTORIA'), (txt.match(/Resultado:.*/) || [''])[0]);
    }
    {
        const t = buildSandbox({ reports: [rep({ myTeamRole: 'away' })] });
        await t.w.openMisInformes();
        t.w.miDescargarInforme(key64of('M1'));
        const txt = t.blobs[0] || '';
        ok('3g · ⚠️ con myTeamRole="away" el mismo 2-1 es DERROTA, como en la tarjeta',
            txt.includes('DERROTA') && txt.includes('Visitante'),
            (txt.match(/Resultado:.*/) || [''])[0]);
    }
    {
        // Ya no puede quedar ninguna dependencia de la funcion desaparecida.
        // ⚠️ HAY QUE QUITAR LOS COMENTARIOS ANTES DE BUSCAR: el codigo explica
        // en un comentario de que dependia y por que se quito, y sin esto mi
        // propia explicacion dispara mi propia asercion. Es la tercera vez que
        // caigo en esta trampa, ya registrada.
        const codigo = BLOCK.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
        ok('3h · ⚠️ miDescargarInforme ya NO depende de sdDownloadInforme ni de _sdMatches',
            !/sdDownloadInforme/.test(codigo) && !/_sdMatches/.test(codigo));
        // ojo: con reports:[] openMisInformes sale por el estado vacio ANTES de
        // definir los manejadores, asi que se pide una clave inexistente sobre
        // un panel que si tiene informes.
        const t = buildSandbox({ reports: [rep()] });
        await t.w.openMisInformes();
        t.w.miDescargarInforme(key64of('NO_EXISTE'));
        ok('3h2 · si el informe no existe avisa y no genera archivo',
            t.blobs.length === 0 && t.toasts.some(x => x.includes('No se encontró')),
            { blobs: t.blobs.length, toasts: t.toasts });
    }
    ok('3i · ⚠️ realDelete se declara y NUNCA se lee: el borrado es SIEMPRE logico',
        /miEliminarInforme = async \(key64, realDelete = false\)/.test(BLOCK)
        && (BLOCK.match(/\brealDelete\b/g) || []).length === 1);
    {
        const t = buildSandbox({ reports: [rep({ _id: 'DOC_REAL', playerNumber: '7' })] });
        await t.w.openMisInformes();
        const k = key64of('M1');
        await t.w.miEliminarInforme(k, true);
        const ups = inCol(t.written, 'cronos_player_reports');
        ok('3j · aun con realDelete=true solo hace updateDoc con dismissedBy: arrayUnion(me.uid)',
            ups.length > 0 && ups.every(u => u.op === 'update'
                && u.data.dismissedBy && u.data.dismissedBy.__arrayUnion[0] === 'coach1'),
            ups.map(u => u.id));
        ok('3k · prueba el id real del documento y los tres derivados de matchId, sin repetir',
            ups.map(u => u.id).sort().join() === ['DOC_REAL', 'M1_coach_p7', 'M1_staff_p7', 'M1_p7'].sort().join(),
            ups.map(u => u.id));
        ok('3l · quita la tarjeta del DOM y la entrada de _misInformesData',
            t.el('mi-rp-' + k).removed === true && t.w._misInformesData['M1'] === undefined);
        ok('3m · confirma con un toast y cierra el spinner',
            t.toasts.some(x => x.includes('Informe ocultado')) && t.spinners.some(s => !s.on),
            t.toasts);
    }
    {
        const t = buildSandbox({ reports: [rep()], confirmAnswer: false });
        await t.w.openMisInformes();
        await t.w.miEliminarInforme(key64of('M1'), true);
        ok('3n · si el usuario cancela el confirm no escribe nada', t.written.length === 0, t.written);
    }
    {
        const t = buildSandbox({ reports: [rep()], updateThrows: 'sin red' });
        await t.w.openMisInformes();
        await t.w.miEliminarInforme(key64of('M1'), true);
        ok('3o · los fallos por documento se tragan con console.warn (no abortan el resto)',
            t.logs.some(l => l.includes('[MisInformes] No se pudo ocultar')), t.logs.slice(0, 3));
        ok('3p · aun asi la tarjeta desaparece de la UI',
            t.el('mi-rp-' + key64of('M1')).removed === true);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · openIndividualReports: vinculaciones y pintado ──');
    {
        const t = buildSandbox({ noModal: true });
        await t.w.openIndividualReports();
        ok('4a · sin la modal en el DOM sale sin hacer nada', t.el('indiv-rpt-body') === undefined);
    }
    ok('4b · consulta cronos_player_links filtrando por clubId',
        /collection\(db,'cronos_player_links'\)/.test(BLOCK)
        && /where\('clubId','==',me\.clubId\|\|''\)/.test(BLOCK));
    {
        const t = buildSandbox({
            linkDocs: [{ playerNumber: '7', parentUid: 'p7', parentName: 'Madre de Ana' }],
            players: [{ name: 'Ana', number: '7', team: 'home', time: 3000, goals: 1, history: [] }],
        });
        await t.w.openIndividualReports();
        const h = t.indivBody().innerHTML;
        ok('4c · marca "App" cuando el padre tiene uid', h.includes('✅ App') && !h.includes('📋 Contacto'));
        ok('4d · muestra el nombre del contacto', h.includes('Madre de Ana'));
        ok('4e · publica jugadores y links para el envio',
            t.w._individualReportPlayers.length === 1 && !!t.w._individualReportLinks['7']);
    }
    {
        const t = buildSandbox({
            linkDocs: [{ playerNumber: '7', parentPhone: '600', parentName: 'Solo Tel' }],
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
        });
        const h2 = (await t.w.openIndividualReports(), t.indivBody().innerHTML);
        ok('4f · con telefono pero sin uid marca "Contacto", no "App"',
            h2.includes('📋 Contacto') && !h2.includes('✅ App'));
    }
    {
        const t = buildSandbox({
            linkDocs: [],
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
        });
        await t.w.openIndividualReports();
        ok('4g · sin ningun dato de contacto marca "Sin vincular"',
            t.indivBody().innerHTML.includes('Sin vincular'));
    }
    {
        // emailConfig complementa a cronos_player_links (contactos manuales).
        const t = buildSandbox({
            linkDocs: [],
            emailContacts: [{ type: 'parent', playerId: '7', name: 'Manual', email: 'm@x.com' }],
            squad: [{ id: '7', number: 7, name: 'Ana' }],
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
        });
        await t.w.openIndividualReports();
        ok('4h · enriquece los links con los padres de emailConfig.contacts',
            t.w._individualReportLinks['7'] && t.w._individualReportLinks['7']._fromEmailConfig === true,
            t.w._individualReportLinks);
    }
    {
        const t = buildSandbox({
            linkDocs: [{ playerNumber: '7', parentUid: 'FIRESTORE', parentName: 'De Firestore' }],
            emailContacts: [{ type: 'parent', playerId: '7', name: 'Manual', email: 'm@x.com' }],
            squad: [{ id: '7', number: 7, name: 'Ana' }],
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
        });
        await t.w.openIndividualReports();
        ok('4i · no pisa un link que ya venia de Firestore',
            t.w._individualReportLinks['7'].parentUid === 'FIRESTORE',
            t.w._individualReportLinks['7']);
    }
    {
        const t = buildSandbox({
            players: [
                { name: 'Ana', number: '7', team: 'home', history: [] },
                { name: 'Rival', number: '1', team: 'away', history: [] },
            ],
        });
        await t.w.openIndividualReports();
        ok('4j · solo incluye a los jugadores de _cMyTeamKey()',
            t.w._individualReportPlayers.length === 1 && t.w._individualReportPlayers[0].name === 'Ana',
            t.w._individualReportPlayers.map(p => p.name));
    }
    {
        const t = buildSandbox({ players: [] });
        await t.w.openIndividualReports();
        ok('4k · sin jugadores avisa de que no hay partido en curso',
            t.indivBody().innerHTML.includes('No hay datos de partido en curso'));
    }
    {
        const t = buildSandbox({
            players: [{
                name: 'Ana', number: '7', team: 'home', history: [{ type: 'goal', minute: 12 }],
                subOutMinute: 40, injuryMinute: 55,
            }],
        });
        await t.w.openIndividualReports();
        const h = t.indivBody().innerHTML;
        ok('4l · la linea de tiempo mezcla history con subIn/subOut/injury, ordenada por minuto',
            h.indexOf("12'") < h.indexOf("40'") && h.indexOf("40'") < h.indexOf("55'")
            && h.includes('GOL') && h.includes('CAMBIO·Sale') && h.includes('LESIÓN'),
            h.slice(h.indexOf('Timeline'), h.indexOf('Timeline') + 40));
    }
    {
        const t = buildSandbox({ getDocsThrows: 'reglas', players: [] });
        await t.w.openIndividualReports();
        ok('4m · un fallo de la consulta se pinta en el cuerpo',
            t.indivBody().innerHTML.includes('reglas'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · _sendAllIndividualReports: envio ──');
    {
        const t = buildSandbox({});
        await t.w._sendAllIndividualReports();
        ok('5a · sin datos de partido avisa y no escribe',
            t.toasts.some(x => x.includes('Sin datos de partido')) && t.written.length === 0);
    }
    {
        const t = buildSandbox({
            players: [{ name: 'Ana', number: '7', team: 'home', history: [{ type: 'goal', minute: 5 }], goals: 1 }],
            linkDocs: [{ playerNumber: '7', parentUid: 'p7', parentEmail: 'p7@x.com' }],
        });
        await t.w.openIndividualReports();
        await t.w._sendAllIndividualReports();
        const msgs = inCol(t.written, 'cronos_messages');
        const notifs = inCol(t.written, 'cronos_notifications');
        ok('5b · crea el hilo con setDoc cuando no existe',
            msgs.length === 1 && msgs[0].op === 'set', msgs.map(m => m.op));
        ok('5c · el threadId es `${me.uid}_${parentUid}` (NO pasa por _cThreadId)',
            msgs[0].id === 'coach1_p7' && msgs[0].data.threadId === 'coach1_p7', msgs[0].id);
        ok('5d · el hilo lleva participants, clubId y recipientType parent',
            JSON.stringify(msgs[0].data.participants) === JSON.stringify(['coach1', 'p7'])
            && msgs[0].data.clubId === 'club1' && msgs[0].data.recipientType === 'parent');
        ok('5e · el mensaje va con type individual_report y sender coach',
            msgs[0].data.messages[0].type === 'individual_report'
            && msgs[0].data.messages[0].sender === 'coach');
        ok('5f · ⚠️ FIX C3: la notificacion lleva userId (el campo que verifican las reglas) ademas de parentUid',
            notifs.length === 1 && notifs[0].data.userId === 'p7'
            && notifs[0].data.parentUid === 'p7' && notifs[0].data.coachUid === 'coach1',
            notifs[0] && notifs[0].data);
        ok('5g · el id de la notificacion es indiv_rpt_<parentUid>_<dorsal>_<base36>',
            /^indiv_rpt_p7_7_[0-9a-z]+$/.test(notifs[0].id), notifs[0].id);
        ok('5h · el texto del informe lleva minutos, goles y las acciones',
            /INFORME INDIVIDUAL: Ana/.test(msgs[0].data.messages[0].text)
            && /GOL/.test(msgs[0].data.messages[0].text), msgs[0].data.messages[0].text.slice(0, 60));
        ok('5i · vuelve al menu unificado al terminar', t.menuCalls.length === 1);
    }
    {
        const t = buildSandbox({
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
            linkDocs: [{ playerNumber: '7', parentUid: 'p7' }],
            threadExists: true,
        });
        await t.w.openIndividualReports();
        await t.w._sendAllIndividualReports();
        const msgs = inCol(t.written, 'cronos_messages');
        ok('5j · si el hilo ya existe hace updateDoc e incrementa unreadByParent',
            msgs.length === 1 && msgs[0].op === 'update' && msgs[0].data.unreadByParent === 5,
            msgs[0] && msgs[0].data.unreadByParent);
    }
    {
        const t = buildSandbox({
            players: [
                { name: 'Ana', number: '7', team: 'home', history: [] },
                { name: 'Sin', number: '9', team: 'home', history: [] },
            ],
            linkDocs: [{ playerNumber: '7', parentUid: 'p7' }],
        });
        await t.w.openIndividualReports();
        await t.w._sendAllIndividualReports();
        ok('5k · lista por nombre a los jugadores sin ningun contacto',
            t.toasts.some(x => x.includes('Sin contacto: Sin')), t.toasts);
        ok('5l · y el contador refleja solo los enviados',
            t.toasts.some(x => x.includes('1 padre(s)')), t.toasts);
    }
    {
        // Telefono SIN uid: WhatsApp + email. Con uid: WhatsApp pero NO email.
        const t = buildSandbox({
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
            linkDocs: [{ playerNumber: '7', parentPhone: '600 11 22 33', parentEmail: 'p@x.com' }],
        });
        await t.w.openIndividualReports();
        await t.w._sendAllIndividualReports();
        ok('5m · sin uid abre WhatsApp (telefono sin espacios) y mailto',
            t.opened.some(u => u.startsWith('https://wa.me/600112233?text='))
            && t.opened.some(u => u.startsWith('mailto:p@x.com')), t.opened);
        ok('5n · y no escribe nada en Firestore (no hay uid al que notificar)',
            t.written.length === 0, t.written);
    }
    {
        const t = buildSandbox({
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
            linkDocs: [{ playerNumber: '7', parentUid: 'p7', parentEmail: 'p@x.com', parentPhone: '600' }],
        });
        await t.w.openIndividualReports();
        await t.w._sendAllIndividualReports();
        ok('5o · con uid manda in-app + WhatsApp pero NO email (ya le llego por la app)',
            t.opened.some(u => u.startsWith('https://wa.me/600'))
            && !t.opened.some(u => u.startsWith('mailto:')), t.opened);
    }
    {
        const t = buildSandbox({
            players: [{ name: 'Ana', number: '7', team: 'home', history: [] }],
            linkDocs: [{ playerNumber: '7', parentUid: 'p7' }],
            setDocThrows: 'sin red',
        });
        await t.w.openIndividualReports();
        await t.w._sendAllIndividualReports();
        ok('5p · si falla la escritura cierra el spinner y avisa, sin volver al menu',
            t.spinners.some(s => !s.on) && t.toasts.some(x => x.includes('Error: sin red'))
            && t.menuCalls.length === 0, { toasts: t.toasts, menu: t.menuCalls.length });
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
