// ─────────────────────────────────────────────────────────────────────────
// test_director_config_module.js · Refactor de monolitos (auditoría 2026-07-22)
// MONOLITO #2 (js/coach/reports/club-reports.js), PASO 1 de 6: extracción de
// "TAB: Configuración del Club" (_renderDirectorConfig /
// _dirSaveCategoryConfigs) a js/coach/reports/director-config.js.
//
// Escrito y ejecutado EN VERDE contra el código todavía SIN mover (Puerta 3
// del protocolo); detecta automáticamente cuál de los dos ficheros existe.
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
//  · FAN-IN = 2, ambos en tiempo de click: switchStaffTab (que SE QUEDA en
//    club-reports.js) llama _renderDirectorConfig() por nombre pelado, y los
//    dos onclick de "Guardar" llaman window._dirSaveCategoryConfigs desde el
//    HTML que genera esta misma sección. Cero referencias desde cualquier
//    otro .js/.html — la parte 1d lo fija de forma permanente.
//  · La reexportación window._renderDirectorConfig NO tiene consumidores
//    (export muerto). Se mueve tal cual, como saActivateIndividual en su día.
//  · FAN-OUT: _sdFS() (se queda en club-reports.js), escapeHtml
//    (app-init.js:21), showToast / showSpinner / hideSpinner
//    (match/timer/core.js), window._cronosCurrentUser y
//    window._cronos_auth.db. Todo resuelto en tiempo de llamada, así que el
//    orden de los <script> es indiferente.
//
// ── LO QUE DE VERDAD HAY QUE PROTEGER ──
// _dirSaveCategoryConfigs escribe window._clubCategoryConfigs y
// window._clubTimerThresholds (fuente 2237-2238). Esas dos globales DECIDEN EL
// COLOR DEL SEMÁFORO DEL CRONÓMETRO en partido: las leen app-init.js:4403-4404,
// utils.js:481, sync.js:270/309 y patches.js:112. La parte 4h las fija
// explícitamente para que nadie las pierda en un futuro "cleanup".
//
// ── RAREZAS PREEXISTENTES FIJADAS, NO CORREGIDAS ──
//  · ✅ RESUELTO EN v586 · GROUPS ESTABA DUPLICADO: 9 objetos en
//    _renderDirectorConfig y las mismas 9 claves como array de strings en
//    _dirSaveCategoryConfigs. Este guard lo describía como "bug latente real"
//    y dejaba la parte 2c vigilándolo. **El bug latente se materializó**: al
//    añadir FUTureFEM y Regional FEM (petición del autor, 2026-08-19) los dos
//    bloques nuevos se pintaban y NO se guardaban, en silencio. Ya no se
//    vigila la duplicación: se ha eliminado. El render publica
//    `window.CRONOS_GRUPOS_CONFIG` y el guardado la consume; la parte 2b fija
//    que no vuelva a declarar la suya.
//  · showToast se invoca SIN guarda mientras showSpinner/hideSpinner sí la
//    llevan (parte 5b). Inofensivo hoy: timer/core.js carga en 1310, mucho
//    antes de cualquier click.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'reports', 'director-config.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Config del Club (Director) — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Extracción del bloque ═════════════════════════════
function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('async function _renderDirectorConfig()');
    if (s === -1) throw new Error('No se encontró _renderDirectorConfig en ' + SOURCE);
    return src.slice(s);   // es la última sección del fichero
}
const BLOCK = readBlock();

// v586 · ONCE grupos: el autor pidió (2026-08-19) que FUTureFEM y Regional
// FEM dejen de ir escondidas dentro de 'f7' y 'regional' y tengan su propio
// bloque de configuración. El ORDEN es el del panel.
const CATS = ['f7', 'infantil_a', 'infantil_b', 'infantil_c', 'cadete_a', 'cadete_b', 'cadete_c', 'futurefem', 'juvenil', 'regional', 'regional_fem'];
// v586 · Regional FEM estrena bloque pero NO semáforo (regla de v559).
const NO_SEMAFORO = ['juvenil', 'regional', 'regional_fem'];

function buildSandbox({
    clubDoc = undefined,              // undefined => el doc no existe
    clubId = 'club1',
    noClub = false,               // simula _cronosCurrentUser sin clubId
    extras = {},
    inputs = null,                    // {cat: {sem, red, yellow, parent}} para el guardado
    missingInputs = false,            // simula DOM sin los inputs
    updateDocThrows = null,
    getDocThrows = null,
} = {}) {
    const writes = [];
    const toasts = [];
    const spinners = [];
    const reads = [];
    const container = { id: 'staff-dashboard-content', innerHTML: '' };
    const els = { 'staff-dashboard-content': container };

    if (inputs && !missingInputs) {
        CATS.forEach(c => {
            const v = inputs[c] || {};
            els['sem-active-' + c] = { checked: !!v.sem };
            els['sem-red-' + c] = { value: String(v.red === undefined ? 33 : v.red) };
            els['sem-yellow-' + c] = { value: String(v.yellow === undefined ? 50 : v.yellow) };
            els['parent-rep-' + c] = { checked: v.parent === undefined ? true : !!v.parent };
        });
    }

    const fakeFS = {
        db: {},
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async (ref) => {
            if (getDocThrows) throw new Error(getDocThrows);
            reads.push(ref.__col + '/' + ref.__id);
            return { exists: () => clubDoc !== undefined, data: () => clubDoc };
        },
        updateDoc: async (ref, data) => {
            if (updateDocThrows) throw new Error(updateDocThrows);
            writes.push({ col: ref.__col, id: ref.__id, data });
        },
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: { clubId: noClub ? undefined : clubId, extras },
            _cronos_auth: { db: fakeFS.db },
        },
        document: { getElementById: (id) => (els[id] !== undefined ? els[id] : null) },
        console: { log() {}, warn() {}, error() {} },
        parseInt, Promise, Object, Array, String, Number, Date, Math, JSON,
        // Stubs de los helpers globales que viven en OTROS ficheros.
        _sdFS: async () => fakeFS,
        escapeHtml: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;'),
        showToast: (m, ms) => toasts.push(String(m)),
        showSpinner: (m) => spinners.push({ on: true, msg: m }),
        hideSpinner: () => spinners.push({ on: false }),
    };
    vm.createContext(sandbox);
    vm.runInContext(BLOCK, sandbox);

    return { sandbox, w: sandbox.window, writes, toasts, spinners, reads, container, els };
}

const idxOf = (s, sub) => s.indexOf(sub);

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
    // OJO: las aserciones de texto-fuente miran BLOCK (la sección), NO el
    // fichero completo. Sin extraer, club-reports.js tiene 2249 líneas y otras
    // secciones repiten los mismos patrones (13 `await _sdFS()`, 5
    // `typeof showToast`, 6 `let html`...), lo que falsearía cada conteo.

    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura, orden de carga y aislamiento ──');
    ok('1a · _renderDirectorConfig es function declaration (pasa a window) y se reexporta',
        /^async function _renderDirectorConfig\(\)/m.test(BLOCK)
        && /window\._renderDirectorConfig\s*=\s*_renderDirectorConfig/.test(BLOCK));
    ok('1b · _dirSaveCategoryConfigs se asigna directamente a window',
        /window\._dirSaveCategoryConfigs\s*=\s*async function/.test(BLOCK));
    ok('1c · sigue dependiendo de _sdFS() (helper que se queda en club-reports.js)',
        (BLOCK.match(/await _sdFS\(\)/g) || []).length === 2,
        (BLOCK.match(/await _sdFS\(\)/g) || []).length);
    {
        // FAN-IN externo = 0. Se excluye club-reports.js (contendrá el
        // comentario-puntero) y sw.js (su changelog nombra funciones en
        // comentarios: falso positivo que ya nos mordió en el paso 11 del
        // monolito #1).
        const NAMES = ['_renderDirectorConfig', '_dirSaveCategoryConfigs'];
        const skip = new Set([SOURCE, ORIGIN, path.join(ROOT, 'sw.js')].map(p => path.resolve(p)));
        const offenders = [];
        for (const f of walk(ROOT, [])) {
            const abs = path.resolve(f);
            if (skip.has(abs)) continue;
            if (path.relative(ROOT, f).replace(/\\/g, '/').startsWith('scripts/')) continue;
            const txt = fs.readFileSync(f, 'utf8');
            for (const n of NAMES) if (new RegExp('\\b' + n + '\\b').test(txt)) offenders.push(path.relative(ROOT, f) + ':' + n);
        }
        ok('1d · fan-in externo = 0 (sólo switchStaffTab y su propio HTML la invocan)',
            offenders.length === 0, offenders);
    }
    {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const origin = idxOf(idxHtml, 'js/coach/reports/club-reports.js');
        ok('1e · club-reports.js sigue en index.html', origin !== -1);
        if (IS_EXTRACTED) {
            const target = idxOf(idxHtml, 'js/coach/reports/director-config.js');
            ok('1f · director-config.js se carga después de club-reports.js',
                target !== -1 && target > origin, { origin, target });
            const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
            ok('1g · director-config.js está en el precache de sw.js',
                sw.includes('js/coach/reports/director-config.js'));
            const chk = fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8');
            ok('1h · director-config.js está en la lista de _check_syntax.js',
                chk.includes('js/coach/reports/director-config.js'));
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · las 9 categorías y su duplicación ──');
    {
        const renderPart = BLOCK.slice(idxOf(BLOCK, 'const GROUPS = ['), idxOf(BLOCK, 'let html'));
        const savePart = BLOCK.slice(idxOf(BLOCK, 'window._dirSaveCategoryConfigs'));
        const renderKeys = (renderPart.match(/key:\s*'([a-z0-9_]+)'/g) || []).map(m => m.match(/'([a-z0-9_]+)'/)[1]);
        ok('2a · el render declara las ONCE categorías esperadas',
            JSON.stringify(renderKeys) === JSON.stringify(CATS), renderKeys);

        // ══════════════════════════════════════════════════════════════
        //  🔑 v586 · YA NO HAY DOS LISTAS QUE PUEDAN DESCUADRARSE
        //
        //  Antes, el render y el guardado declaraban CADA UNO su lista de
        //  claves a mano, y este guard vigilaba que coincidieran. Al añadir
        //  FUTureFEM y Regional FEM eso falló exactamente como estaba previsto:
        //  los bloques nuevos se pintaban y NO se guardaban, sin un solo error
        //  — el Director tocando interruptores que no hacen nada.
        //
        //  La duplicación se ha eliminado en vez de vigilarla: el render
        //  publica `window.CRONOS_GRUPOS_CONFIG` y el guardado la consume. Lo
        //  que ahora hay que fijar es eso, más que el literal quede completo
        //  como red de seguridad por si alguien llama al guardado sin haber
        //  pintado antes.
        // ══════════════════════════════════════════════════════════════
        ok('2b · 🔑 el guardado NO mantiene su propia lista: consume la del render',
            /window\.CRONOS_GRUPOS_CONFIG/.test(savePart) &&
            /window\.CRONOS_GRUPOS_CONFIG\s*=\s*GROUPS\.map/.test(BLOCK),
            'si vuelve a declarar la suya, los grupos nuevos se guardarán a medias');
        const fallbackLine = savePart.slice(idxOf(savePart, ': [\'f7\''), idxOf(savePart, '];') + 2);
        const fallbackKeys = (fallbackLine.match(/'([a-z0-9_]+)'/g) || []).map(m => m.replace(/'/g, ''));
        ok('2c · ⚠️ y su respaldo literal lleva las ONCE, en el mismo orden',
            JSON.stringify(fallbackKeys) === JSON.stringify(CATS), fallbackKeys);
        const noSem = (renderPart.match(/hasSemaforo:\s*false/g) || []).length;
        // ⚠️ TRES sin semáforo: Juvenil, Regional y Regional FEM. Es la regla de
        //    v559, confirmada por el autor: esas tres son celeste. Regional FEM
        //    estrena bloque propio pero NO estrena semáforo.
        ok('2d · sin semáforo van Juvenil, Regional y Regional FEM (v559)', noSem === 3, noSem);
        ok('2d2 · 🔑 y Regional FEM es una de ellas, no una cuarta con semáforo',
            /key: 'regional_fem'[^}]*hasSemaforo: false/.test(renderPart),
            'Regional FEM con semáforo contradiría la regla que enuncia su propio panel');
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · _renderDirectorConfig() ──');
    {
        const { w, container, reads } = buildSandbox({ noClub: true });
        await w._renderDirectorConfig();
        ok('3a · sin clubId avisa y NO toca Firestore',
            container.innerHTML.includes('Sin club asignado.') && reads.length === 0,
            { reads });
    }
    {
        const { w, container, reads } = buildSandbox({ clubId: 'clubX', clubDoc: {} });
        await w._renderDirectorConfig();
        const html = container.innerHTML;
        ok('3b · lee el documento del club', reads.join() === 'clubs/clubX', reads);
        ok('3c · pinta una tarjeta por cada una de las 9 categorías',
            CATS.every(c => html.includes('parent-rep-' + c)),
            CATS.filter(c => !html.includes('parent-rep-' + c)));
        ok('3d · las 8 categorías con semáforo llevan sus sliders',
            CATS.filter(c => !NO_SEMAFORO.includes(c)).every(c =>
                html.includes('sem-red-' + c) && html.includes('sem-yellow-' + c) && html.includes('sem-active-' + c)));
        ok('3e · Juvenil y Regional NO llevan sliders y muestran el aviso celeste',
            NO_SEMAFORO.every(c => !html.includes('sem-red-' + c) && !html.includes('sem-active-' + c))
            && html.includes('Sin Semáforo (Celeste)'));
        ok('3f · sin config previa usa los valores por defecto 33 / 50',
            html.includes('value="33"') && html.includes('value="50"')
            && html.includes('>33%<') && html.includes('>50%<'));
        ok('3g · los dos botones de guardar llaman window._dirSaveCategoryConfigs con el clubId',
            (html.match(/window\._dirSaveCategoryConfigs\('clubX'\)/g) || []).length === 2,
            (html.match(/window\._dirSaveCategoryConfigs\('clubX'\)/g) || []).length);
        ok('3h · los checkbox de informes a padres vienen marcados por defecto',
            CATS.every(c => new RegExp('id="parent-rep-' + c + '" checked').test(html)));
    }
    {
        // legacy timerThresholds como fallback cuando no hay categoryConfigs
        const { w, container } = buildSandbox({ clubDoc: { timerThresholds: { red: 20, yellow: 40 } } });
        await w._renderDirectorConfig();
        const html = container.innerHTML;
        ok('3i · timerThresholds legacy del club se usan como fallback',
            html.includes('value="20"') && html.includes('value="40"') && !html.includes('value="33"'));
    }
    {
        // cfg por categoría gana sobre el legacy
        const { w, container } = buildSandbox({
            clubDoc: {
                timerThresholds: { red: 20, yellow: 40 },
                categoryConfigs: { f7: { red: 15, yellow: 35, semaforoActive: false, sendIndividualReports: false } },
            },
        });
        await w._renderDirectorConfig();
        const html = container.innerHTML;
        ok('3j · la config por categoría prevalece sobre el legacy',
            html.includes('id="sem-red-f7" min="10" max="45" step="1" value="15"'),
            html.slice(idxOf(html, 'sem-red-f7') - 30, idxOf(html, 'sem-red-f7') + 90));
        ok('3k · semaforoActive:false deja el checkbox de f7 sin marcar',
            /id="sem-active-f7"\s+onchange/.test(html)
            && !/id="sem-active-f7" checked/.test(html));
        ok('3l · sendIndividualReports:false deja sin marcar SOLO esa categoría',
            !/id="parent-rep-f7" checked/.test(html)
            && /id="parent-rep-juvenil" checked/.test(html));
    }
    {
        // features.sendIndividualReports === false => legacy en OFF para todas
        const { w, container } = buildSandbox({ clubDoc: { features: { sendIndividualReports: false } } });
        await w._renderDirectorConfig();
        ok('3m · features.sendIndividualReports:false desmarca todas las categorías',
            CATS.every(c => !new RegExp('id="parent-rep-' + c + '" checked').test(container.innerHTML)));
    }
    {
        const { w, container } = buildSandbox({ clubDoc: {}, extras: { semaforo: false } });
        await w._renderDirectorConfig();
        ok('3n · extras.semaforo:false deshabilita visualmente los bloques de semáforo',
            container.innerHTML.includes('opacity:0.5;pointer-events:none;'));
    }
    {
        const { w, container } = buildSandbox({ clubDoc: {}, extras: { informes_padres: false } });
        await w._renderDirectorConfig();
        ok('3o · extras.informes_padres:false deshabilita el bloque de informes',
            container.innerHTML.includes('opacity:0.5;pointer-events:none;'));
    }
    {
        const { w, container } = buildSandbox({ clubDoc: undefined });
        await w._renderDirectorConfig();
        ok('3p · si el doc del club no existe, cae a valores por defecto sin romperse',
            container.innerHTML.includes('value="33"') && container.innerHTML.includes('parent-rep-f7'));
    }
    ok('3q · las etiquetas de categoría pasan por escapeHtml',
        /\$\{escapeHtml\(g\.label\)\}/.test(BLOCK) && /\$\{escapeHtml\(g\.sub\)\}/.test(BLOCK));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · _dirSaveCategoryConfigs() ──');
    const allInputs = (over = {}) => {
        const o = {};
        CATS.forEach(c => { o[c] = { sem: true, red: 30, yellow: 60, parent: true }; });
        Object.keys(over).forEach(k => { o[k] = Object.assign({}, o[k], over[k]); });
        return o;
    };
    {
        const { w, writes, toasts, spinners } = buildSandbox({ inputs: allInputs() });
        await w._dirSaveCategoryConfigs('clubX');
        const wr = writes[0];
        ok('4a · escribe en clubs/{clubId}', wr && wr.col === 'clubs' && wr.id === 'clubX', wr);
        ok('4b · persiste categoryConfigs con las ONCE categorías',
            wr && Object.keys(wr.data.categoryConfigs).length === 11
            && CATS.every(c => wr.data.categoryConfigs[c]),
            wr && Object.keys(wr.data.categoryConfigs));
        ok('4c · cada categoría lleva los 4 campos leídos del DOM',
            wr && wr.data.categoryConfigs.f7.semaforoActive === true
            && wr.data.categoryConfigs.f7.red === 30
            && wr.data.categoryConfigs.f7.yellow === 60
            && wr.data.categoryConfigs.f7.sendIndividualReports === true,
            wr && wr.data.categoryConfigs.f7);
        ok('4d · timerThresholds se derivan de f7 (compatibilidad legacy)',
            wr && wr.data.timerThresholds.red === 30 && wr.data.timerThresholds.yellow === 60,
            wr && wr.data.timerThresholds);
        ok('4e · features.sendIndividualReports es el OR de todas las categorías',
            wr && wr.data['features.sendIndividualReports'] === true);
        ok('4f · muestra y oculta el spinner',
            spinners.length === 2 && spinners[0].on === true && spinners[1].on === false, spinners);
        ok('4g · confirma con un toast de éxito',
            toasts.some(t => t.includes('guardada correctamente')), toasts);
        // ⚠️ EL ASSERT CRÍTICO: estas dos globales deciden el color del semáforo.
        ok('4h · ⚠️ publica window._clubCategoryConfigs y window._clubTimerThresholds',
            w._clubCategoryConfigs && Object.keys(w._clubCategoryConfigs).length === 11
            && w._clubTimerThresholds && w._clubTimerThresholds.red === 30
            && w._clubTimerThresholds.yellow === 60,
            { cfgs: w._clubCategoryConfigs && Object.keys(w._clubCategoryConfigs).length, th: w._clubTimerThresholds });
    }
    {
        const { w, writes, toasts } = buildSandbox({ inputs: allInputs({ cadete_b: { red: 60, yellow: 40 } }) });
        await w._dirSaveCategoryConfigs('clubX');
        ok('4i · rojo >= amarillo con semáforo ACTIVO aborta el guardado',
            writes.length === 0 && toasts.some(t => t.includes('umbral rojo debe ser menor')),
            { writes: writes.length, toasts });
    }
    {
        // La guarda sólo aplica si el checkbox está marcado.
        const { w, writes } = buildSandbox({ inputs: allInputs({ cadete_b: { sem: false, red: 60, yellow: 40 } }) });
        await w._dirSaveCategoryConfigs('clubX');
        ok('4j · rojo >= amarillo con semáforo INACTIVO sí guarda (la guarda es condicional)',
            writes.length === 1, writes.length);
    }
    {
        const { w, writes } = buildSandbox({ inputs: allInputs(), missingInputs: true });
        await w._dirSaveCategoryConfigs('clubX');
        const wr = writes[0];
        ok('4k · sin inputs en el DOM cae a false/33/50/true por categoría',
            wr && wr.data.categoryConfigs.f7.semaforoActive === false
            && wr.data.categoryConfigs.f7.red === 33
            && wr.data.categoryConfigs.f7.yellow === 50
            && wr.data.categoryConfigs.f7.sendIndividualReports === true,
            wr && wr.data.categoryConfigs.f7);
    }
    {
        const { w, writes } = buildSandbox({ inputs: allInputs({ f7: { red: 'abc', yellow: 'xyz' } }) });
        await w._dirSaveCategoryConfigs('clubX');
        const wr = writes[0];
        ok('4l · valores no numéricos caen a 33 / 50 vía parseInt || default',
            wr && wr.data.categoryConfigs.f7.red === 33 && wr.data.categoryConfigs.f7.yellow === 50,
            wr && wr.data.categoryConfigs.f7);
    }
    {
        const inputs = allInputs();
        CATS.forEach(c => { inputs[c].parent = false; });
        const { w, writes } = buildSandbox({ inputs });
        await w._dirSaveCategoryConfigs('clubX');
        ok('4m · si ninguna categoría envía informes, features.sendIndividualReports = false',
            writes[0] && writes[0].data['features.sendIndividualReports'] === false,
            writes[0] && writes[0].data['features.sendIndividualReports']);
    }
    {
        const { w, toasts, spinners } = buildSandbox({ inputs: allInputs(), updateDocThrows: 'sin red' });
        await w._dirSaveCategoryConfigs('clubX');
        ok('4n · si falla el guardado, oculta el spinner y avisa del error',
            spinners.some(s => s.on === false) && toasts.some(t => t.includes('Error al guardar: sin red')),
            { spinners, toasts });
        ok('4o · un fallo NO publica las globales del semáforo a medias',
            w._clubCategoryConfigs === undefined && w._clubTimerThresholds === undefined,
            { cfgs: w._clubCategoryConfigs, th: w._clubTimerThresholds });
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · contrato con helpers de otros ficheros ──');
    ok('5a · showSpinner/hideSpinner se invocan con guarda typeof',
        /typeof showSpinner === 'function'/.test(BLOCK) && /typeof hideSpinner === 'function'/.test(BLOCK));
    // Rareza preexistente: showToast NO va guardado. Se fija tal cual.
    ok('5b · ⚠️ showToast se invoca SIN guarda (inconsistencia preexistente)',
        /(?<!typeof )showToast\(/.test(BLOCK) && !/typeof showToast/.test(BLOCK));
    ok('5c · la db se obtiene de window._cronos_auth con optional chaining',
        (BLOCK.match(/window\._cronos_auth\?\.db/g) || []).length === 2,
        (BLOCK.match(/window\._cronos_auth\?\.db/g) || []).length);

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
