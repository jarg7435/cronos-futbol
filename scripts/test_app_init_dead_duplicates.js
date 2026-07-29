// ─────────────────────────────────────────────────────────────────────────
// test_app_init_dead_duplicates.js · Refactor de monolitos (auditoria 2026-07-22)
//
// GUARD DE LA FASE A del monolito #5 (js/core/app-init.js).
//
// EL HALLAZGO QUE ORIGINA ESTA FASE (inventario del 2026-07-28): app-init.js
// no es un monolito que haya que descomponer, es una CAPA FOSIL. 102 de sus
// 133 funciones de nivel superior estan MUERTAS porque un script POSTERIOR
// declara el mismo nombre y gana: todos los scripts clasicos comparten el
// ambito global y la ultima declaracion de funcion es la que queda. Los
// "extractos" de epocas anteriores se hicieron COPIANDO, no moviendo, y como
// app-init.js es el PRIMER script de index.html su copia siempre pierde.
//
// Lo peligroso no es el peso muerto, es que 62 de esas copias han DIVERGIDO:
// app-init.js contiene versiones viejas y distintas de codigo que parece vivo
// (p.ej. su assignCard tenia 88 lineas y la que se ejecuta, en
// match/events/player-actions.js, tiene 158). Cualquiera que lea o edite ahi
// esta tocando codigo que no se ejecuta nunca.
//
// QUE FIJA ESTE ARCHIVO: que cada nombre borrado tiene UNA SOLA declaracion de
// nivel superior en toda la cadena de scripts clasicos, y que esta en el
// archivo que se espera. Mientras eso se cumpla no hay ambiguedad posible: no
// existe una segunda copia que pueda ganar o perder segun el orden de carga.
//
// ⚠️ POR QUE SE BORRA FUNCION A FUNCION Y NUNCA POR RANGOS DE LINEAS: dentro
// de las secciones borradas sobreviven declaraciones de estado que SI son
// load-bearing y cuya desaparicion seria un ReferenceError en produccion. La
// PARTE 4 las fija una a una. Un borrado por rangos se las habria llevado.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};
const rd = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('── Duplicados muertos de app-init.js (Fase A) ──\n');

const AI = 'js/core/app-init.js';
const idxHtml = rd('index.html');
const ORDER = [...idxHtml.matchAll(/<script src="(js\/[^"?]+)/g)]
    .map(m => m[1]).filter(f => fs.existsSync(path.join(ROOT, f)));

// Las funciones borradas de app-init.js, con el archivo que se queda como unico
// duenyo. FASE A (30) + FASE B (40) = 70.
const BORRADAS = {
    'js/match/events/player-actions.js': [
        // §3 acciones de jugador (Fase A)
        'openPlayerActionModal', 'closePlayerActionModal', 'assignCard', 'terminateMatch',
        // resto de acciones de jugador (Fase B)
        'changeGoals', 'syncScoreFromPlayers', 'clearPlayerActions', 'editNameFromModal',
        'editNumberFromModal', 'selectForSubstitution', 'confirmSubstitutionWith',
        'cancelPendingSubstitution'],
    'js/coach/training/panel.js': [              // §8 entrenamiento semanal (Fase A)
        '_getWeekMonday', 'renderTrainingWeek', 'saveTrainingWeek', 'clearTrainingWeek',
        '_getTrainingWeekText', 'updateTrainingPreview', 'sendTrainingWA', 'sendTrainingEmail'],
    'js/core/staff-and-comms.js': [              // §9 cuerpo tecnico (Fase A) + Fase B
        'loadStaffConfig', 'saveStaffConfig', 'renderStaffInBench', 'openRosterManager',
        'clearMasterRoster'],
    'js/ai/import.js': [
        // §10 importacion de plantilla con IA (Fase A)
        'triggerRosterPhoto', 'processRosterPhoto', 'compressImageToBase64', 'callGeminiVision',
        'callTesseract', 'parsePlayersFromText', 'updateUsageCounter', 'showOCRError',
        // §11 importacion, convocatoria e ir al partido (Fase B)
        'showRosterPreview', 'confirmRosterImport', 'saveMasterRoster', 'openConvocationModal',
        'saveConvData', 'saveConvPlayers', 'goToTitularSelection', 'startMatchWithConvocation'],
    'js/shared/whatsapp-email.js': [             // §15 envio de convocatoria (Fase A)
        'openConvocationMessage', 'buildConvocationText', 'saveConvConfig',
        'previewConvocationMsg', 'sendConvocationWA', 'sendConvocationEmail'],
    'js/services/firestore-storage.js': [        // §7 nube + emailjs + SW (Fase B)
        'cloudSet', 'cloudGet', 'syncFromCloud', 'startRealtimeSync', 'migrateLocalToCloud',
        'loadEmailConfig', 'initEmailJS', 'sendReportByEmail', 'registerServiceWorker', 'forceUpdate'],
    'js/match/live/sync.js': [                   // §7 transmision en vivo (Fase B)
        'cleanupStaleMatches', 'updateLiveButton', 'openLiveView', 'showLiveShareModal',
        'copyLiveUrl', 'shareLiveWhatsApp', 'shareLiveEmail', 'confirmStopLive', 'liveSyncOnAction',
        // ⚠️ este se publicaba como `window.X = function` en columna 0, no como
        // `function X(`, y el inventario inicial —que solo buscaba la segunda
        // forma— no lo vio. Lo destapo la asercion 4b al detectar que un archivo
        // duenyo ya declaraba un nombre de la lista de estado compartido.
        'notifyAllLiveContacts'],
    'js/match/demo-tutorial.js': [               // §7 tutorial (Fase B)
        'renderTutorialStep', 'tutorialNext', 'tutorialPrev', 'closeTutorial'],

    // ───────────────── FASE C (20 con duenyo unico) ─────────────────
    'js/ui/render.js': [                         // §13 pintado de plantilla y chips
        'renderPlayers', 'sortBenchUI', 'createPlayerChip',
        'handleTouchStart', 'handleTouchMove', 'handleTouchEnd'],
    'js/ui/drag-drop.js': [                      // §13 arrastrar y soltar
        'resolveOverlaps', 'closeDrawers', 'dropToField', 'dropToBench',
        'dropToAwayBench', 'handleBenchDrop'],
    'js/roster/formations.js': [                 // §2 formaciones predefinidas
        'clampToField', 'updateFormationOptions', 'updateCategoryOptions', 'applyFormationPreset'],
    'js/roster/legacy-formations.js': ['placeOnField'],
    'js/match/events/movement-log.js': ['logEvent'],
    // saveTeamSetup/deleteTeamSetup ya eran suyas; las otras cuatro pasaron a
    // tener duenyo unico el 2026-07-29 al limpiar la duplicacion de persistencia.
    'js/match/persistence/team-persistence.js': ['saveTeamSetup', 'deleteTeamSetup',
        'populateSavedTeams', 'loadTeamFromDropdown', 'saveCurrentTeam', 'deleteTeamFromDropdown'],

    // ───────────── FASE D · grupo B (6) · panel SA, copia muerta ─────────────
    'js/admin/superadmin/superadmin.panel.js': ['openSuperAdminPanel', 'saFS', 'saGet'],
    'js/admin/superadmin/clubs-tab.js': ['saClubs'],
    'js/admin/superadmin/requests-tab.js': ['saRequests'],
    'js/admin/billing/payments.js': ['saSendPaymentEmail'],
};
const TODAS = Object.entries(BORRADAS).flatMap(([f, ns]) => ns.map(n => [n, f]));

// Nombres que TODAVIA tienen varias declaraciones fuera de app-init.js. Aqui no
// se puede exigir duenyo unico, asi que se fija CUAL gana (el ultimo en el orden
// de carga) para que reordenar las etiquetas <script> deje de ser un cambio
// invisible — misma idea que test_endmatch_writers.js.
//
// ⚠️ ESTA LISTA TENIA 5 ENTRADAS Y AHORA TIENE 1. La duplicacion de
// active-match.js / team-persistence.js / ai/import.js se limpio el 2026-07-29 y
// las otras cuatro pasaron a tener duenyo unico (team-persistence.js), asi que
// viven en BORRADAS. El detalle esta en scripts/test_persistence_duplication.js.
const BORRADAS_MULTI = {
    injectBenchScrollButtons: { gana: 'js/ui/bench-scroll.js', todos: ['js/ai/import.js', 'js/ui/bench-scroll.js'] },
};

// ⚠️ FASE D · grupo C · EL PANEL SUPERADMIN LEGACY v3 (14 funciones, 762 lineas).
// Estas NO tienen archivo duenyo: desaparecen del repo entero. Por eso llevan
// aserciones propias (PARTE 7) en vez de entrar en BORRADAS.
//
// POR QUE SE PUDIERON BORRAR, que es lo que hay que seguir cumpliendo: no es un
// "no le encuentro consumidores" (argumento debil), es la MISMA prueba por
// shadowing de las fases A/B/C. Todo el grupo cuelga de `openSuperAdminPanel`,
// que estaba MUERTA porque superadmin.panel.js la redeclara y gana. Ninguna de
// las 3 funciones vivas del bloque (saWrite, saOpenIndividualEditor,
// checkClubAccess) alcanzaba nada de aqui: solo llaman a saFS y saGet —que
// resuelven al panel moderno— y a saWrite. Y el remate: `openAdminPanel`
// llamaba a `openSuperAdminPanel()` por nombre pelado, o sea que incluso
// invocandolo se abria el panel MODERNO. Estaba doblemente inalcanzable.
const FASE_D_ELIMINADAS = ['openAdminPanel', 'saGetAll', 'saUpd', 'saBadge', 'saSlotBar', 'saExpireLabel',
    'saOverview', 'saOpenEditor', 'saIndividual', 'saPayments', 'saPaymentCard', 'saOpenPaymentForm',
    'saOpenPaymentHistory', 'saNewClub'];

// Las 3 que SOBREVIVEN en el bloque SA de app-init.js, con su consumidor real.
// Si alguna pierde su consumidor, deja de haber razon para que siga aqui; si
// alguien la redeclara en otro archivo, vuelve el problema de las fases A-C.
const FASE_D_VIVAS = {
    saWrite: 'js/admin/billing/payments.js',
    saOpenIndividualEditor: 'js/admin/superadmin/extras.js',
    checkClubAccess: 'js/services/auth/role-launch.js',
};

// Declaraciones de nivel superior (columna 0 = incondicional; una asignacion
// indentada podria estar dentro de un `if` y no cuenta como duenyo).
function declaraciones(src) {
    const out = new Map();
    src.split(/\r?\n/).forEach((l, i) => {
        let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
            || l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/);
        if (m && !out.has(m[1])) out.set(m[1], i + 1);
    });
    return out;
}
const decl = {};
ORDER.forEach(f => { decl[f] = declaraciones(rd(f)); });

// ────────── PARTE 1 · una sola declaracion, y en el archivo esperado ──────────
{
    const duplicados = [], huerfanas = [], mal = [];
    TODAS.forEach(([nombre, duenyo]) => {
        const donde = ORDER.filter(f => decl[f].has(nombre));
        if (donde.length === 0) huerfanas.push(nombre);
        else if (donde.length > 1) duplicados.push(nombre + ' -> ' + donde.join(', '));
        else if (donde[0] !== duenyo) mal.push(nombre + ' esperado en ' + duenyo + ' pero esta en ' + donde[0]);
    });
    ok('1a · ninguna se quedo sin declaracion (seria un ReferenceError)', huerfanas.length === 0, huerfanas);
    ok('1b · ⚠️ ninguna conserva DOS declaraciones (la copia muerta se fue)', duplicados.length === 0, duplicados);
    ok('1c · cada una vive en el archivo que se espera', mal.length === 0, mal);
    // 97 = 30 (A) + 41 (B) + 20 (C) + 6 (grupo B de la D). Las 4 que subieron de
    // BORRADAS_MULTI a BORRADAS el 2026-07-29 ya se contaban en la Fase C.
    ok('1d · el recuento cuadra: 101 funciones con duenyo unico',
        TODAS.length === 101, TODAS.length);

    // ── las 5 multi-declaradas de la Fase C: se fija QUIEN gana, no que sea unica
    const malGanador = [], malConjunto = [];
    Object.entries(BORRADAS_MULTI).forEach(([nombre, { gana, todos }]) => {
        const donde = ORDER.filter(f => decl[f].has(nombre));
        // gana el ultimo en el orden de carga de index.html
        if (donde[donde.length - 1] !== gana) malGanador.push(nombre + ' gana ' + donde[donde.length - 1] + ', esperado ' + gana);
        if (donde.join('|') !== todos.join('|')) malConjunto.push(nombre + ' -> ' + donde.join(', '));
    });
    ok('1e · ⚠️ las 5 multi-declaradas las sigue ganando el archivo esperado', malGanador.length === 0, malGanador);
    ok('1f · el conjunto de archivos que las declara no ha cambiado (ni una copia nueva ni una menos)',
        malConjunto.length === 0, malConjunto);
    // la Fase C saco 25 nombres de app-init.js; hoy 24 tienen duenyo unico y
    // solo injectBenchScrollButtons sigue declarado en dos archivos.
    ok('1g · solo queda 1 nombre multi-declarado (eran 5 antes de limpiar la persistencia)',
        Object.keys(BORRADAS_MULTI).length === 1, Object.keys(BORRADAS_MULTI));
}

// ────────── PARTE 2 · app-init.js ya no las declara ──────────
{
    const aiDecl = declaraciones(rd(AI));
    const quedan = [...TODAS.map(([n]) => n), ...Object.keys(BORRADAS_MULTI), ...FASE_D_ELIMINADAS]
        .filter(n => aiDecl.has(n));
    ok('2a · ⚠️ app-init.js no declara ninguna de las 116', quedan.length === 0, quedan);

    // y sigue cargando el PRIMERO, que es lo que hacia perder a sus copias
    ok('2b · app-init.js sigue siendo el primer script clasico', ORDER[0] === AI, ORDER[0]);

    // los duenyos tienen que cargar DESPUES (si alguien reordena las etiquetas
    // <script>, la copia superviviente podria dejar de ganar)
    const antes = Object.keys(BORRADAS).filter(f => ORDER.indexOf(f) < ORDER.indexOf(AI));
    ok('2c · los cinco archivos duenyos se cargan despues de app-init.js', antes.length === 0, antes);
}

// ────────── PARTE 3 · autotest del detector ──────────
// Si el detector dejase de ver las declaraciones, la PARTE 1 daria verde por
// no encontrar nada. Se comprueba contra codigo sintetico.
{
    const d1 = declaraciones('function foo(a) {\n}\nwindow.bar = function bar() {\n};\n');
    ok('3a · el detector ve `function X(` y `window.X = function`', d1.has('foo') && d1.has('bar'), [...d1.keys()]);
    const d2 = declaraciones('    function indentada() {\n    }\n    window.tambien = function () {\n    };\n');
    ok('3b · el detector IGNORA las declaraciones indentadas (podrian ser condicionales)', d2.size === 0, [...d2.keys()]);
    // 3c · reproduccion sintetica del estado ANTERIOR: la PARTE 1 tiene que
    // saber ver DOS copias del mismo nombre en dos archivos distintos. Se hace
    // con codigo sintetico y no con un nombre real del repo, porque cualquier
    // ejemplo real puede dejar de serlo (mi primer intento uso escapeHtml, que
    // en core/utils.js esta INDENTADO dentro de una guarda y por tanto el
    // detector lo ignora, con razon: da verde por la razon equivocada).
    const falso = {
        'a.js': 'function assignCard() {\n}\n',
        'b.js': 'function assignCard() {\n}\n',
    };
    const donde = ['a.js', 'b.js'].filter(f => declaraciones(falso[f]).has('assignCard'));
    ok('3c · el detector ve la MISMA funcion declarada en dos archivos', donde.length === 2, donde);
}

// ────────── PARTE 4 · ⚠️ EL ESTADO COMPARTIDO QUE NO SE PUEDE BORRAR ──────────
// ESTA ES LA PARTE QUE HACE QUE EL BORRADO SEA SEGURO, y la razon por la que se
// borra FUNCION A FUNCION y nunca por rangos de lineas.
//
// app-init.js declara el estado global que los archivos duenyos leen por nombre
// PELADO sin declararlo ellos. Esas declaraciones estan intercaladas entre las
// funciones muertas — `_realtimeUnsubscribe` vive entre syncFromCloud y
// startRealtimeSync, `tutorialStep` justo encima de renderTutorialStep — asi que
// un borrado por rangos se las habria llevado y habria dejado un ReferenceError
// en produccion. Cada nombre de esta lista se comprobo midiendo: lo usa al menos
// un archivo duenyo y NINGUNO lo declara.
{
    const aiSrc = rd(AI);
    const declara = (src, n) => new RegExp('^\\s*(?:const|let|var)\\s+' + n.replace(/[$]/g, '\\$') + '\\s*=', 'm').test(src)
        || new RegExp('^window\\.' + n.replace(/[$]/g, '\\$') + '\\s*=', 'm').test(src);

    // nombre -> archivos que lo leen sin declararlo (medido el 2026-07-28)
    const COMPARTIDO = {
        escapeHtml: ['js/shared/whatsapp-email.js'], escapeAttr: ['js/shared/whatsapp-email.js'],
        players: ['js/match/events/player-actions.js'], isRunning: ['js/match/live/sync.js'],
        timerInterval: ['js/match/events/player-actions.js'], lastTickTime: ['js/match/live/sync.js'],
        currentMode: ['js/match/live/sync.js'], matchPhase: ['js/match/live/sync.js'],
        analyzeAway: ['js/ai/import.js'],
        // ⚠️ el lector de activeFormationKey ERA ai/import.js; al limpiar la
        // duplicacion de persistencia (2026-07-29) esa copia se fue y la
        // asercion 4c se puso roja, que es exactamente su trabajo. Sigue siendo
        // load-bearing: lo leen team-persistence.js (299 y 315), sync.js,
        // setup-modal.js, movement-log.js y formations.js.
        activeFormationKey: ['js/match/persistence/team-persistence.js'],
        selectedFormationOnStart: ['js/ai/import.js'], half1MaxTime: ['js/match/live/sync.js'],
        half2MaxTime: ['js/match/live/sync.js'], masterTimeH1: ['js/match/live/sync.js'],
        masterTimeH2: ['js/match/live/sync.js'], pendingSubstitution: ['js/match/events/player-actions.js'],
        liveMatchId: ['js/match/live/sync.js'], liveSyncTimer: ['js/match/live/sync.js'],
        liveIsActive: ['js/match/live/sync.js'], emailConfig: ['js/services/firestore-storage.js'],
        COLORS: ['js/match/live/sync.js'], TEAM_NAMES: ['js/match/live/sync.js'],
        activeActionPlayerId: ['js/match/events/player-actions.js'],
        TUTORIAL_STEPS: ['js/match/demo-tutorial.js'], tutorialStep: ['js/match/demo-tutorial.js'],
        _realtimeUnsubscribe: ['js/services/firestore-storage.js'],
        _tesseractLoaded: ['js/ai/import.js'],
        // ── FASE C · estado INTERCALADO entre las funciones muertas de §2 y §13.
        // `FIELD_MARGIN` esta justo encima de clampToField, `touchData` y
        // `lastTouchTime` entre createPlayerChip y handleTouchStart, y
        // `FORMATIONS`/`FORMATIONS_FULL` entre handleTouchEnd y placeOnField.
        // Un borrado por rangos se los habria llevado y ningun archivo duenyo los
        // declara: seria un ReferenceError en produccion.
        FIELD_MARGIN: ['js/roster/formations.js', 'js/core/security-and-state.js'],
        touchData: ['js/ui/render.js', 'js/ui/drag-drop.js'],
        lastTouchTime: ['js/ui/render.js'],
        FORMATIONS: ['js/roster/formations.js', 'js/roster/legacy-formations.js'],
        FORMATIONS_FULL: ['js/roster/legacy-formations.js'],
        FORMATION_PRESETS: ['js/roster/formations.js', 'js/core/security-and-state.js'],
    };
    const nombres = Object.keys(COMPARTIDO);
    const perdidas = nombres.filter(n => !declara(aiSrc, n));
    ok('4a · ⚠️ app-init.js CONSERVA las ' + nombres.length + ' declaraciones de estado compartido',
        perdidas.length === 0, perdidas);

    const yaDeclarado = nombres.filter(n => COMPARTIDO[n].some(f => declara(rd(f), n)));
    ok('4b · ningun duenyo ha empezado a declararlas por su cuenta (seria un duplicado nuevo)',
        yaDeclarado.length === 0, yaDeclarado);

    const noUsadas = nombres.filter(n => !COMPARTIDO[n].some(f =>
        new RegExp('(?<![.\\w$])' + n.replace(/[$]/g, '\\$') + '\\b').test(rd(f))));
    ok('4c · todas siguen siendo realmente necesarias (si no, sacarlas de la lista)',
        noUsadas.length === 0, noUsadas);

    // `_tesseractLoaded` merece mencion aparte: el propio ai/import.js lo
    // documenta ("ya declarado en app.js"), asi que la dependencia es deliberada.
    ok('4d · ai/import.js sigue documentando su dependencia de _tesseractLoaded',
        /_tesseractLoaded/.test(rd('js/ai/import.js')));
    // window._trWeekOffset: inicializacion del panel de entrenamiento
    ok('4e · app-init.js CONSERVA la inicializacion de window._trWeekOffset',
        /^window\._trWeekOffset\s*=/m.test(aiSrc));
}

// ────────── PARTE 5 · app-init.js sigue cargando sin lanzar ──────────
{
    const sb = {};
    vm.createContext(sb);
    sb.window = sb;
    sb.document = { addEventListener() {}, getElementById: () => null, querySelector: () => null,
        createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }) };
    sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    sb.navigator = { userAgent: 'node', serviceWorker: { register: () => Promise.resolve() } };
    sb.location = { href: 'https://x/', hostname: 'x' };
    sb.setTimeout = () => 0; sb.setInterval = () => 0; sb.clearInterval = () => {};
    sb.console = { log() {}, warn() {}, error() {} };
    sb.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });

    let err = '';
    try { vm.runInContext(rd(AI), sb, { timeout: 15000 }); } catch (e) { err = e.message; }
    ok('5a · app-init.js evalua sin lanzar tras el borrado', !err, err);
    // el estado global compartido sigue publicado
    ['players', 'isRunning', 'currentMode', 'matchPhase', 'liveMatchId', 'COLORS', 'TEAM_NAMES']
        .forEach((n, k) => {
            const v = (() => { try { return vm.runInContext('typeof ' + n, sb); } catch (_) { return 'ERROR'; } })();
            ok('5' + 'bcdefgh'[k] + ' · el estado global `' + n + '` sigue declarado', v !== 'undefined' && v !== 'ERROR', v);
        });
}

// ────────── PARTE 6 · ⚠️ FASE C · LA TRAMPA v378: EL ALIAS COLGANTE ──────────
// De las 25 funciones de la Fase C, `updateCategoryOptions` era la unica con un
// alias explicito en app-init.js:
//
//     window.updateCategoryOptions = updateCategoryOptions;   // linea 417
//
// Esa linea es una sentencia de NIVEL SUPERIOR: se ejecuta al cargar el archivo,
// cuando `js/roster/formations.js` todavia no se ha cargado. Borrar la funcion y
// dejar el alias habria sido un ReferenceError en el PRIMER script de index.html
// —es decir, la aplicacion entera en blanco—, que es exactamente la regresion
// v378. Por eso el alias se borro CON la funcion.
//
// Y no era decorativo: `js/services/auth/role-launch.js` (un ES module) lee
// `window.updateCategoryOptions` de verdad, en las lineas 335 y 337. Lo que
// mantiene vivo ese consumidor es que en un script CLASICO una declaracion
// `function X(` en columna 0 ya crea la propiedad en el objeto global; el alias
// era redundante. Eso es lo que comprueba 6c cargando la CADENA REAL: un sandbox
// que cargase solo el archivo vivo no probaria nada (leccion de `staffConfig`).
{
    const aiSrc = rd(AI);
    ok('6a · ⚠️ el alias colgante `window.updateCategoryOptions = updateCategoryOptions` ya no esta',
        !/^window\.updateCategoryOptions\s*=/m.test(aiSrc));

    // barrido general: ningun alias de nivel superior en app-init.js puede
    // apuntar por nombre pelado a una funcion que ya no vive en este archivo.
    const aiDecl2 = declaraciones(aiSrc);
    // ⚠️ los literales `false`/`true`/`null`/`undefined` encajan en la forma de un
    // identificador: sin excluirlos, `window._CRONOS_DEBUG = false;` (linea 1) se
    // cuenta como alias colgante y la asercion da rojo por la razon equivocada.
    // Misma familia que las trampas de regex ya registradas.
    const LITERALES = new Set(['false', 'true', 'null', 'undefined', 'NaN', 'Infinity']);
    const colgantes = [];
    aiSrc.split(/\r?\n/).forEach((l, i) => {
        const m = l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/);
        if (m && !LITERALES.has(m[2]) && !aiDecl2.has(m[2])) colgantes.push('L' + (i + 1) + ': ' + l.trim());
    });
    ok('6b · ningun alias de nivel superior apunta a una funcion que ya no esta aqui',
        colgantes.length === 0, colgantes);

    // el consumidor real sigue existiendo (si desaparece, 6c deja de importar)
    ok('6c · role-launch.js sigue leyendo window.updateCategoryOptions',
        /window\.updateCategoryOptions/.test(rd('js/services/auth/role-launch.js')));

    // 6d · LA PRUEBA DE VERDAD: cargar la cadena real app-init.js -> formations.js
    // en un sandbox con window === global y comprobar que la propiedad existe y
    // es la de formations.js, no la borrada.
    const sb = {};
    vm.createContext(sb);
    sb.window = sb;
    sb.document = { addEventListener() {}, getElementById: () => null, querySelector: () => null,
        querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }) };
    sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    sb.navigator = { userAgent: 'node', serviceWorker: { register: () => Promise.resolve() } };
    sb.location = { href: 'https://x/', hostname: 'x' };
    sb.setTimeout = () => 0; sb.setInterval = () => 0; sb.clearInterval = () => {};
    sb.console = { log() {}, warn() {}, error() {} };
    sb.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });

    let errCadena = '';
    [AI, 'js/roster/formations.js'].forEach(f => {
        try { vm.runInContext(rd(f), sb, { timeout: 15000 }); } catch (e) { errCadena += f + ': ' + e.message + '; '; }
    });
    ok('6d · la cadena app-init.js -> formations.js carga sin lanzar', !errCadena, errCadena);

    const tipo = (() => { try { return vm.runInContext('typeof window.updateCategoryOptions', sb); } catch (_) { return 'ERROR'; } })();
    ok('6e · ⚠️ `window.updateCategoryOptions` SIGUE siendo funcion sin el alias (lo publica la declaracion de formations.js)',
        tipo === 'function', tipo);

    const mismo = (() => { try { return vm.runInContext('window.updateCategoryOptions === updateCategoryOptions', sb); } catch (e) { return 'ERROR: ' + e.message; } })();
    ok('6f · y el nombre pelado y `window.X` resuelven a la MISMA funcion (sin sombra)', mismo === true, mismo);

    // las otras 24 tampoco pueden haber perdido su publicacion en window
    const perdidasWin = [];
    [['js/ui/render.js', ['renderPlayers', 'sortBenchUI', 'createPlayerChip']],
     ['js/ui/drag-drop.js', ['dropToField', 'dropToBench', 'handleBenchDrop']],
     ['js/roster/legacy-formations.js', ['placeOnField']],
     ['js/match/events/movement-log.js', ['logEvent']]].forEach(([f, ns]) => {
        try { vm.runInContext(rd(f), sb, { timeout: 15000 }); } catch (_) { /* dependencias ausentes en el sandbox */ }
        ns.forEach(n => {
            const t = (() => { try { return vm.runInContext('typeof window.' + n, sb); } catch (_) { return 'ERROR'; } })();
            if (t !== 'function') perdidasWin.push(n + '=' + t);
        });
    });
    ok('6g · las funciones supervivientes siguen publicadas en window por su archivo duenyo',
        perdidasWin.length === 0, perdidasWin);
}

// ────── PARTE 7 · ⚠️ FASE D · EL PANEL SUPERADMIN LEGACY v3, BORRADO ENTERO ──────
// A diferencia de todo lo anterior, estas 14 funciones no se mudaron a ningun
// sitio: se eliminaron. Por eso lo que se fija es distinto — que no vuelvan, que
// sigan sin consumidor, y que lo que SI se quedo siga teniendo su razon de ser.
{
    const aiSrc = rd(AI);
    const aiDecl = declaraciones(aiSrc);
    const declaraEn = (src, n) => new RegExp('^(?:async\\s+)?function\\s+' + n.replace(/[$]/g, '\\$') + '\\s*\\(', 'm').test(src)
        || new RegExp('^window\\.' + n.replace(/[$]/g, '\\$') + '\\s*=', 'm').test(src);

    const siguen = FASE_D_ELIMINADAS.filter(n => aiDecl.has(n));
    ok('7a · ⚠️ app-init.js no declara ninguna de las 14 del panel legacy', siguen.length === 0, siguen);

    // no han reaparecido en NINGUN archivo de la cadena
    const revivio = FASE_D_ELIMINADAS.filter(n => ORDER.some(f => declaraEn(rd(f), n)));
    ok('7b · ninguna ha reaparecido en otro archivo de la cadena', revivio.length === 0, revivio);

    // y siguen sin consumidor: es la condicion que hizo legitimo borrarlas. Si
    // alguien escribe una llamada nueva, es un ReferenceError y hay que saberlo.
    const RAIZ = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
    const universo = [...ORDER, ...RAIZ];
    const conConsumidor = [];
    FASE_D_ELIMINADAS.forEach(n => {
        const esc = n.replace(/[$]/g, '\\$');
        universo.forEach(f => {
            let src; try { src = rd(f); } catch (_) { return; }
            const limpio = src.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
            if (new RegExp('(?<![.\\w$])' + esc + '\\s*\\(').test(limpio)
                || new RegExp('window\\.' + esc + '\\b').test(limpio)) conConsumidor.push(n + ' <- ' + f);
        });
    });
    ok('7c · ⚠️ ninguna tiene consumidor nuevo (seria un ReferenceError)', conConsumidor.length === 0, conConsumidor);

    // ── los 3 alias de nivel superior de la trampa v378 (openAdminPanel,
    // openSuperAdminPanel y saSendPaymentEmail se ejecutaban al CARGAR)
    ['openAdminPanel', 'openSuperAdminPanel', 'saSendPaymentEmail'].forEach((n, k) => {
        ok('7d' + k + ' · ⚠️ el alias colgante `window.' + n + ' = ' + n + '` ya no esta',
            !new RegExp('^window\\.' + n + '\\s*=', 'm').test(aiSrc));
    });

    // ── lo que SOBREVIVE del bloque SA, y por que
    const faltan = Object.keys(FASE_D_VIVAS).filter(n => !aiDecl.has(n));
    ok('7e · ⚠️ app-init.js CONSERVA las 3 funciones vivas del bloque SA', faltan.length === 0, faltan);

    const sinConsumidor = Object.entries(FASE_D_VIVAS).filter(([n, f]) => {
        const src = rd(f);
        const esc = n.replace(/[$]/g, '\\$');
        return !new RegExp('(?<![.\\w$])' + esc + '\\s*\\(').test(src) && !new RegExp('window\\.' + esc + '\\b').test(src);
    }).map(([n, f]) => n + ' ya no lo usa ' + f);
    ok('7f · las 3 vivas siguen teniendo su consumidor real', sinConsumidor.length === 0, sinConsumidor);

    // nadie las redeclara: si pasara, volveriamos al problema de las fases A-C
    const redeclaradas = Object.keys(FASE_D_VIVAS).filter(n => ORDER.some(f => f !== AI && declaraEn(rd(f), n)));
    ok('7g · nadie ha empezado a redeclarar las 3 vivas (volveria el shadowing)', redeclaradas.length === 0, redeclaradas);

    // checkClubAccess conserva SU alias, que es legitimo: role-launch.js (un ES
    // module) lo lee como window.checkClubAccess y la funcion sigue aqui.
    ok('7h · checkClubAccess CONSERVA su alias window (lo lee role-launch.js)',
        /^window\.checkClubAccess\s*=\s*checkClubAccess\s*;/m.test(aiSrc));

    // ── saWrite y checkClubAccess llaman a saFS/saGet por nombre PELADO, y esas
    // copias se han borrado de app-init. Tienen que seguir resolviendo a las de
    // superadmin.panel.js, que las publica como `window.saFS = async function`.
    // ⚠️ Esto solo funciona porque una declaracion `function X(){}` global crea
    // la propiedad en el OBJETO global, que un `window.X = ...` posterior puede
    // sobrescribir. No seria asi con `const` (ese es el bug de ROLE_META/v385).
    const sp = rd('js/admin/superadmin/superadmin.panel.js');
    ok('7i · superadmin.panel.js publica saFS y saGet en window (es lo que hace que saWrite/checkClubAccess sigan funcionando)',
        /^window\.saFS\s*=/m.test(sp) && /^window\.saGet\s*=/m.test(sp));

    // ── los window.X que nacian DENTRO de funciones ya borradas: otro archivo
    // tiene que seguir creandolos o quedan huerfanos para sus consumidores.
    const HUERFANOS = { saTab: 'js/admin/superadmin/superadmin.panel.js',
        saAddIndividual: 'js/admin/superadmin/extras.js',
        saMarkNoticeSent: 'js/admin/billing/payments.js' };
    const sinCreador = Object.entries(HUERFANOS).filter(([n, f]) =>
        !new RegExp('window\\.' + n + '\\s*=').test(rd(f))).map(([n, f]) => n + ' ya no lo crea ' + f);
    ok('7j · ⚠️ saTab, saAddIndividual y saMarkNoticeSent los sigue creando otro archivo', sinCreador.length === 0, sinCreador);
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);
