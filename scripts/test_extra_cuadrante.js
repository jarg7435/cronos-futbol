// ─────────────────────────────────────────────────────────────────────────
// test_extra_cuadrante.js · v679
//
// ENCARGO (implementar.txt + CAPTURAS 10044-10045, 2026-09-06): el módulo de
// Cuadrante pasa a estar gobernado por un extra del SuperAdmin, como el resto
// de funcionalidades opcionales. Extra activo → el Director entra y usa el
// cuadrante con normalidad; extra apagado → la opción se bloquea.
//
// POR QUÉ ESTE GUARD EXISTE, Y QUÉ MIDE DE VERDAD
//
// Un extra tiene SIEMPRE dos puertas y la que importa es la segunda:
//   · la VISIBLE  — la tarjeta del tablero, que sale bloqueada con su motivo;
//   · la de la RUTA — porque `switchStaffTab('cuadrante')` se puede llamar a
//     mano desde la consola, y porque la pestaña queda guardada como argumento
//     de la raíz de navegación: al repintar desde la pila se vuelve a entrar
//     por la ruta SIN pasar por el tablero.
// Bloquear sólo la tarjeta es la forma exacta del defecto de v593 (FAIL-OPEN:
// el filtro estaba en un sitio y faltaba en el otro) y del de v596 (la puerta
// puesta en la pantalla equivocada). Por eso las PARTES 2 y 3 EJECUTAN
// switchStaffTab de verdad y miran si llamó al módulo, en vez de buscar texto:
// una aserción de texto habría dado verde con la puerta en el sitio erróneo.
//
// ⚠️ Y MIDE TAMBIÉN LA CARA POSITIVA (2a, 3a, 4a): que con el extra ACTIVO —y
// con el extra AUSENTE, que es el caso de todo club que nunca ha pasado por el
// panel del SuperAdmin— el cuadrante siga abriéndose. Un candado que se cierra
// de más no da error: simplemente deja a un club sin su herramienta.
//
// ⚠️ EL ENTE INDIVIDUAL CUENTA. El SuperAdmin apaga extras de clubes Y de entes
// en la misma pantalla (saExtras recorre `clubs` + `individuals`), y el mismo
// módulo se pinta en el panel del ente desde v626. Dejar ese lado abierto haría
// que el interruptor MINTIERA para la mitad de las entidades.
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

console.log('── El Cuadrante como extra del SuperAdmin (v679) ──\n');

const EXTRAS = 'js/admin/superadmin/extras-toggle.js';
const CR     = 'js/coach/reports/club-reports.js';
const IND    = 'js/admin/individual/panel.js';
const SM     = 'js/core/setup-modal.js';

const extrasSrc = rd(EXTRAS), crSrc = rd(CR), indSrc = rd(IND), smSrc = rd(SM);

// ────────── PARTE 1 · el interruptor existe en el panel del SuperAdmin ──────────
// Se EJECUTA la definición en vez de leerla a ojo: si alguien cambia la forma
// de la lista (a un objeto, a un map...), esto se entera.
console.log('── PARTE 1 · el extra en _CRONOS_EXTRAS_DEF ──\n');
let DEFS = [];
{
    const sb = { window: {} };
    sb.window.window = sb.window;
    vm.createContext(sb);
    vm.runInContext(extrasSrc.replace(/window\.saExtras[\s\S]*$/, ''), sb);
    DEFS = sb.window._CRONOS_EXTRAS_DEF || [];
    const keys = DEFS.map(e => e.key);

    ok('1a · existe el extra "cuadrante"', keys.includes('cuadrante'), keys.join(', '));
    ok('1b · no hay claves duplicadas (la clave es lo que queda escrito en el documento)',
        new Set(keys).size === keys.length, keys.join(', '));
    const def = DEFS.find(e => e.key === 'cuadrante') || {};
    ok('1c · trae etiqueta y descripción (el SuperAdmin tiene que saber qué apaga)',
        !!def.label && !!def.desc && !!def.icon, def);
}

// ────────── PARTE 2 · panel de Dirección · LA RUTA (la puerta que cierra) ──────────
// Se carga club-reports.js de verdad y se llama a switchStaffTab('cuadrante').
// La pregunta no es qué texto tiene el fichero, es SI LLAMÓ AL MÓDULO.
console.log('\n── PARTE 2 · Dirección · la ruta switchStaffTab(\'cuadrante\') ──\n');

function sandboxCR(extras) {
    const sb = {};
    vm.createContext(sb);
    sb.window = sb; sb.self = sb;
    const nuevo = () => ({ style: {}, classList: { add() {}, remove() {} }, innerHTML: '',
        addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] });
    const els = {};
    const porId = id => (els[id] || (els[id] = nuevo()));
    sb.__els = els;
    sb.document = { getElementById: porId, querySelector: () => null, querySelectorAll: () => [],
        createElement: nuevo, addEventListener() {}, body: nuevo() };
    sb.console = { log() {}, warn() {}, error() {} };
    sb.setTimeout = (f) => { try { typeof f === 'function' && f(); } catch (e) {} return 0; };
    sb.setInterval = () => 0; sb.clearInterval = () => {}; sb.clearTimeout = () => {};
    sb.showToast = () => {}; sb.showSpinner = () => {}; sb.hideSpinner = () => {};
    sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    sb.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
    sb.navRootScreen = () => {};
    sb._cronosCurrentUser = { role: 'director', clubId: 'c1', extras: extras };
    // ⚠️ EL TESTIGO: si la ruta deja pasar, el módulo se llama. Es lo único que
    // distingue «bloqueado» de «bloqueado en el sitio equivocado».
    sb.__cargado = 0;
    sb._sdLoadCuadrante = function (cont) { sb.__cargado++; sb.__contenedor = cont; };
    try { vm.runInContext(crSrc, sb, { timeout: 15000, filename: CR }); }
    catch (e) { console.log('       (aviso: club-reports.js lanzó al cargar: ' + e.message + ')'); }
    sb.window._sdLoadCuadrante = sb._sdLoadCuadrante;
    return sb;
}

async function rutaCuadrante(extras) {
    const sb = sandboxCR(extras);
    if (typeof sb.switchStaffTab !== 'function') return { sb, error: 'no hay switchStaffTab' };
    try { await sb.switchStaffTab('cuadrante'); } catch (e) { return { sb, error: e.message }; }
    return { sb, html: (sb.__els['staff-dashboard-content'] || {}).innerHTML || '' };
}

(async () => {
    {
        // ⚠️ LA CARA POSITIVA PRIMERO: con el extra puesto, el cuadrante ENTRA.
        const r = await rutaCuadrante({ cuadrante: true });
        ok('2a · ⚠️ extra ACTIVO → el cuadrante se carga (llama a _sdLoadCuadrante)',
            r.sb.__cargado === 1, { cargado: r.sb.__cargado, error: r.error });
        ok('2b · …y en SU contenedor, el del panel de Dirección (v626)',
            r.sb.__contenedor === 'staff-dashboard-content', r.sb.__contenedor);
    }
    {
        // El club que nunca pasó por el panel del SuperAdmin: `extras` vacío.
        // La regla de todo el proyecto es `!== false`, no `=== true`.
        const r = await rutaCuadrante({});
        ok('2c · ⚠️ extra AUSENTE → sigue abierto (un club antiguo no se queda sin cuadrante)',
            r.sb.__cargado === 1, { cargado: r.sb.__cargado, error: r.error });
    }
    {
        const r = await rutaCuadrante({ cuadrante: false });
        ok('2d · 🔑 extra APAGADO → NO se llama al módulo (la ruta corta de verdad)',
            r.sb.__cargado === 0, { cargado: r.sb.__cargado, error: r.error });
        ok('2e · …y se dice POR QUÉ (un hueco mudo parece una avería)',
            /🔒/.test(r.html) && /no est[áa] disponible|no est[áa] activado/i.test(r.html),
            r.html.slice(0, 200));
    }

    // ────────── PARTE 3 · panel de Dirección · LA TARJETA del tablero ──────────
    // Se intercepta cronosTableroHtml para leer las opciones REALES que el panel
    // declara, en vez de buscar `bloqueado` en el texto del fichero.
    console.log('\n── PARTE 3 · Dirección · la tarjeta del tablero ──\n');

    async function tarjetaCuadrante(extras) {
        const sb = sandboxCR(extras);
        let opciones = null;
        sb.cronosTableroHtml = (cfg) => { opciones = (cfg && cfg.opciones) || []; return '<div></div>'; };
        sb.window.cronosTableroHtml = sb.cronosTableroHtml;
        sb._sdCanSeeConfigTab = () => true;
        sb.window._sdCanSeeConfigTab = sb._sdCanSeeConfigTab;
        try { await sb.switchStaffTab('menu'); } catch (e) { return { error: e.message }; }
        return { opcion: (opciones || []).find(o => /Cuadrante/.test(o.titulo || '')), opciones };
    }

    {
        const r = await tarjetaCuadrante({ cuadrante: true });
        ok('3a · ⚠️ extra ACTIVO → la tarjeta del Cuadrante existe y NO está bloqueada',
            !!r.opcion && !r.opcion.bloqueado, r.opcion || r.error);
        ok('3b · …y conserva su acción (switchStaffTab(\'cuadrante\'))',
            !!r.opcion && /switchStaffTab\('cuadrante'\)/.test(r.opcion.onclick || ''),
            (r.opcion || {}).onclick);
    }
    {
        const r = await tarjetaCuadrante({});
        ok('3c · extra AUSENTE → tarjeta abierta (mismo criterio que la ruta)',
            !!r.opcion && !r.opcion.bloqueado, r.opcion || r.error);
    }
    {
        const r = await tarjetaCuadrante({ cuadrante: false });
        ok('3d · 🔑 extra APAGADO → la tarjeta sale BLOQUEADA CON MOTIVO',
            !!r.opcion && typeof r.opcion.bloqueado === 'string' && r.opcion.bloqueado.length > 0,
            r.opcion || r.error);
        // La política del autor desde v429: no se esconde, se ve y dice por qué.
        ok('3e · ⚠️ NO se esconde: la tarjeta SIGUE en el tablero',
            !!r.opcion, 'una opción que desaparece sin explicación parece una avería');
    }

    // ────────── PARTE 4 · el Ente Individual, el otro anfitrión ──────────
    console.log('\n── PARTE 4 · el panel del Ente Individual ──\n');
    {
        // El motivo vive en UN solo sitio y los dos paneles lo leen de ahí.
        const sbSM = { window: {}, document: { getElementById: () => null, querySelector: () => null } };
        sbSM.window.window = sbSM.window;
        vm.createContext(sbSM);
        try { vm.runInContext(smSrc.slice(0, smSrc.indexOf('window._cronosRefreshExtras')), sbSM,
            { timeout: 10000, filename: SM }); } catch (e) {}
        ok('4a · el motivo del extra vive en setup-modal.js (una sola redacción para los dos paneles)',
            typeof sbSM.window.CRONOS_EXTRA_CUADRANTE_MOTIVO === 'string'
            && sbSM.window.CRONOS_EXTRA_CUADRANTE_MOTIVO.length > 10,
            sbSM.window.CRONOS_EXTRA_CUADRANTE_MOTIVO);
        ok('4b · ⚠️ y NO se ha colado en CRONOS_ROL_EXTRA (no existe ningún "rol_cuadrante")',
            !Object.values(sbSM.window.CRONOS_ROL_EXTRA || {}).includes('cuadrante')
            && !Object.keys(sbSM.window.CRONOS_ROL_EXTRA || {}).includes('cuadrante'),
            sbSM.window.CRONOS_ROL_EXTRA);
    }
    {
        // El panel del ente no se puede ejecutar entero (arrastra Firestore), así
        // que aquí se fija la FORMA, con anclas estrechas. Las dos puertas:
        ok('4c · el ente resuelve el extra con _cronosExtraEnabled (la MISMA lectura que el resto de la app)',
            /_indCuadranteOn\s*=\s*\(typeof window\._cronosExtraEnabled !== 'function'\)[\s\S]{0,120}_cronosExtraEnabled\('cuadrante'\)/.test(indSrc),
            'leer `extras` a mano abriría una segunda regla que puede divergir');
        ok('4d · puerta VISIBLE: la tarjeta del tablero lleva `bloqueado`',
            /titulo: 'Cuadrante'[\s\S]{0,400}?bloqueado: _indCuadranteMotivo/.test(indSrc));
        // 🚨 ESTA ASERCIÓN NACIÓ EN VERDE FALSO Y EL RED-CHECK LA CAZÓ. Su primera
        // versión medía el ORDEN de `!_indCuadranteOn`, `return;` y
        // `_sdLoadCuadrante` dentro del bloque. Al neutralizar la guarda con un
        // `if (false && !_indCuadranteOn)` —el defecto exacto que tiene que
        // cazar— los tres seguían en el mismo orden y la aserción seguía VERDE.
        // Ahora se EXTRAE el bloque real y SE EJECUTA con el extra apagado: la
        // pregunta es si llamó al módulo, no en qué orden está escrito.
        // Es la lección de v620 y de la 5c de v596, otra vez.
        const bloqueRuta = (indSrc.match(/if \(sec === 'cuadrante'\) \{[\s\S]{0,2000}?\r?\n\s{8}\}/) || [])[0];
        ok('4e0 · el bloque de la ruta del ente se localiza', !!bloqueRuta);
        ok('4e · 🔑 puerta de la RUTA: con el extra APAGADO, indTab NO llama al módulo',
            (() => {
                if (!bloqueRuta) return false;
                const sb = { testigo: 0 };
                vm.createContext(sb);
                sb.window = sb;
                sb.console = { warn() {}, log() {}, error() {} };
                sb.document = { getElementById: () => ({ innerHTML: '' }) };
                sb.sec = 'cuadrante';
                sb._indCuadranteOn = false;              // extra APAGADO
                sb._indCuadranteMotivo = 'motivo de prueba';
                sb._sdLoadCuadrante = () => { sb.testigo++; };
                sb.window._sdLoadCuadrante = sb._sdLoadCuadrante;
                try {
                    // envuelto en una función para que el `return;` sea legal
                    vm.runInContext('(function(){' + bloqueRuta + '})();', sb, { timeout: 5000 });
                } catch (e) { return false; }
                return sb.testigo === 0;
            })(),
            'con el extra apagado el cuadrante NO puede cargarse');
        ok('4e2 · ⚠️ …y con el extra ACTIVO el mismo bloque SÍ lo carga (el candado no cierra de más)',
            (() => {
                if (!bloqueRuta) return false;
                const sb = { testigo: 0 };
                vm.createContext(sb);
                sb.window = sb;
                sb.console = { warn() {}, log() {}, error() {} };
                sb.document = { getElementById: () => ({ innerHTML: '' }) };
                sb.sec = 'cuadrante';
                sb._indCuadranteOn = true;               // extra ACTIVO
                sb._indCuadranteMotivo = '';
                sb._sdLoadCuadrante = () => { sb.testigo++; };
                sb.window._sdLoadCuadrante = sb._sdLoadCuadrante;
                try { vm.runInContext('(function(){' + bloqueRuta + '})();', sb, { timeout: 5000 }); }
                catch (e) { return false; }
                return sb.testigo === 1;
            })(),
            'el ente con su extra contratado tiene que entrar');
        ok('4f · ⚠️ falla hacia el SÍ: sin el helper cargado, el ente NO se queda sin cuadrante',
            /typeof window\._cronosExtraEnabled !== 'function'\)\s*\r?\n?\s*\|\|/.test(indSrc),
            'un fallo de carga no es una decisión comercial');
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();
