// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v735 · EL TIPO DE PARTIDO EN LOS INFORMES
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-18, capturas 10544-10545): cada
//  informe —colectivo e individual— debe decir si el partido fue de **Liga,
//  Copa, Torneo o Amistoso**, «para identificar con precisión qué encuentros
//  forman parte de la sumatoria estadística oficial de la temporada frente a
//  partidos amistosos o de torneo».
//
//  📏 MEDIDO ANTES DE TOCAR NADA: el informe **no guardaba el tipo**. Sellaba
//  fecha, rival, marcador, localía, categoría, subcategoría y equipo — nada
//  más. Así que esto no era pintar una etiqueta: había que sellar el dato en
//  las CINCO copias del informe (staff, entrenador, familia, manual×2) y
//  después pintarlo.
//
//  ⚠️ DECISIÓN EXPLÍCITA DEL AUTOR: **los informes antiguos se quedan sin
//  etiqueta**. No se deduce el tipo de ningún otro campo. Poner «Liga» por
//  defecto —el caso más común— marcaría como oficiales partidos que pudieron
//  ser amistosos, que es justo lo contrario de lo que se pide. Varias
//  aserciones de aquí abajo existen sólo para fijar ese «no inventes».
//
//  🚨 Y LA SEGUNDA TABLA: el motor de informes es AUTOCONTENIDO (no puede
//  mirar al objeto global, aserción 1c de test_report_engine_module.js), así
//  que lleva su propia copia de los cuatro tipos. Dos copias divergen — por
//  eso aquí se EJECUTAN las dos y se comparan clave por clave, igual que hace
//  test_cabecera_localia.js con el reparto de localía.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const UTILS   = leer('js/core/utils.js');
const ENGINE  = leer('js/coach/reports/report-engine.js');
const TAB     = leer('js/coach/reports/reports-tab.js');
const MIS     = leer('js/coach/comms/individual-reports.js');
const AUTO    = leer('js/coach/comms/match-reports-auto.js');
const COLECT  = leer('js/coach/comms/collective-report.js');
const MANUAL  = leer('js/coach/comms/manual-report.js');

// ── El resolutor de utils.js, ejecutado ───────────────────────────────────
function cargarUtils(convType) {
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        String, Object, Array, Number, Boolean, Date, JSON, Math, RegExp,
        parseInt, parseFloat, isNaN, Error,
        localStorage: {
            getItem: (k) => (k === 'cronos_conv_data' && convType !== undefined
                ? JSON.stringify({ type: convType }) : null),
            setItem() {}, removeItem() {},
        },
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
        navigator: { userAgent: 'node' },
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(UTILS, sb);
    return sb;
}

console.log('\n══ v735 · el tipo de partido en los informes ══');

//  ⚠️ TODO EL CUERPO VA DENTRO DE UN `try`. Sin él, el RED-CHECK —ejecutar
//  este guard contra el código ANTERIOR, donde `cronosTipoPartido` todavía no
//  existe— moría con un TypeError y no llegaba a decir qué falla. Un guard en
//  rojo tiene que informar, no reventar (lección de v732 y v734).
try {

// ═════════════════════════════════════════════════════════════════════
console.log('\n1) 🔑 EL VOCABULARIO: cuatro tipos, una sola definición');
{
    const w = cargarUtils();
    const esperados = ['liga', 'copa', 'torneo', 'amistoso'];
    ok('1a · están los cuatro tipos del desplegable',
       esperados.every(t => !!w.cronosTipoPartido(t)),
       JSON.stringify(Object.keys(w.CRONOS_TIPOS_PARTIDO || {})));
    ok('1b · cada uno trae icono, texto y color',
       esperados.every(t => {
           const v = w.cronosTipoPartido(t);
           return !!v.icono && !!v.texto && /^#/.test(v.color);
       }));
    ok('1c · 🔑 Liga y Copa son OFICIALES; Torneo y Amistoso no',
       w.cronosTipoPartido('liga').oficial === true &&
       w.cronosTipoPartido('copa').oficial === true &&
       w.cronosTipoPartido('torneo').oficial === false &&
       w.cronosTipoPartido('amistoso').oficial === false,
       'es la distinción que pide el encargo para la sumatoria de temporada');
    ok('1d · la etiqueta se lee sola', w.cronosTipoPartidoEtiqueta('liga') === '🏆 Liga');
    ok('1e · ⚠️ un tipo desconocido o vacío NO se inventa',
       w.cronosTipoPartido('') === null && w.cronosTipoPartido(null) === null &&
       w.cronosTipoPartido('playoff') === null &&
       w.cronosTipoPartidoEtiqueta('') === '',
       'los informes anteriores a v735 se quedan sin etiqueta, por decisión del autor');
    ok('1f · admite mayúsculas y espacios (viene de un <select>)',
       !!w.cronosTipoPartido('  LIGA  ') && w.cronosTipoPartido(' Amistoso ').tipo === 'amistoso');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n2) EL TIPO DEL PARTIDO EN CURSO, para sellarlo');
{
    const w = cargarUtils('copa');
    ok('2a · sin datos en pantalla se cae a la convocatoria',
       w.cronosTipoPartidoActual() === 'copa');
    w._cronosDatosPartido = { tipo: 'amistoso' };
    ok('2b · 🔑 manda lo que decidió la pantalla inicial del partido',
       w.cronosTipoPartidoActual() === 'amistoso');
    w._cronosDatosPartido = { tipo: 'basura' };
    ok('2c · un valor que no es un tipo cae a la convocatoria',
       w.cronosTipoPartidoActual() === 'copa');
}
{
    const w = cargarUtils();          // ni pantalla ni convocatoria
    ok('2d · ⚠️ sin nada que consultar devuelve vacío, no un valor por defecto',
       w.cronosTipoPartidoActual() === '');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n3) 🚨 LAS DOS TABLAS NO PUEDEN DIVERGIR');
{
    //  El motor de informes no puede leer el objeto global, así que lleva su
    //  propia copia. Se extrae y se compara con la de utils.js.
    const w = cargarUtils();
    const m = ENGINE.match(/const _TIPOS_INFORME = \{[\s\S]*?\};/);
    ok('3a · el motor declara su tabla propia', !!m);
    if (m) {
        const sb2 = { Object, String };
        vm.createContext(sb2);
        vm.runInContext(m[0] + '\n;globalThis.T = _TIPOS_INFORME;', sb2);
        const dellMotor = sb2.T;
        const claves = Object.keys(w.CRONOS_TIPOS_PARTIDO);
        ok('3b · 🔑 mismos tipos en las dos',
           claves.sort().join(',') === Object.keys(dellMotor).sort().join(','),
           JSON.stringify(Object.keys(dellMotor)));
        ok('3c · 🔑🔑 mismo icono, texto y color, uno por uno',
           claves.every(k => dellMotor[k] &&
               dellMotor[k].icono === w.CRONOS_TIPOS_PARTIDO[k].icono &&
               dellMotor[k].texto === w.CRONOS_TIPOS_PARTIDO[k].texto &&
               dellMotor[k].color === w.CRONOS_TIPOS_PARTIDO[k].color),
           'si divergen, el informe individual y su tarjeta dirían cosas distintas del mismo partido');
    }
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n4) EL DATO SE SELLA EN **TODAS** LAS COPIAS DEL INFORME');
{
    // Cinco copias: staff+entrenador (auto), familia (auto), colectivo, y las
    // dos del informe manual (que comparten el objeto `comun`).
    const nAuto = (AUTO.match(/matchType:/g) || []).length;
    ok('4a · el despacho automático lo sella en sus tres payloads',
       nAuto === 3, 'matchType× ' + nAuto);
    ok('4b · el informe colectivo también', /matchType:\s*\(typeof window\.cronosTipoPartidoActual/.test(COLECT));
    ok('4c · y el informe manual, con el tipo que ya pregunta su formulario',
       /matchType:[\s\S]{0,200}S\.tipoPartido/.test(MANUAL));
    ok('4d · ⚠️ ninguno inventa un tipo cuando no consta',
       !/matchType:\s*['"]liga['"]/.test(AUTO + COLECT + MANUAL),
       'un valor por defecto aquí falsearía la estadística de la temporada');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n5) Y SE PINTA EN LAS TRES PANTALLAS');
{
    // La píldora de las tarjetas, ejecutada.
    const w = cargarUtils();
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        String, Object, Array, JSON, escapeHtml: (s) => String(s),
    };
    sb.window = sb;
    sb.cronosTipoPartido = w.cronosTipoPartido;
    vm.createContext(sb);
    const pill = TAB.match(/function _sdTipoPartidoPill\(m\) \{[\s\S]*?\n\}/);
    ok('5a · la píldora existe en el listado del Director', !!pill);
    if (pill) {
        vm.runInContext(pill[0] + '\n;globalThis.P = _sdTipoPartidoPill;', sb);
        const conTipo = sb.P({ matchType: 'amistoso' });
        ok('5b · 🔑 con tipo, pinta su etiqueta',
           /AMISTOSO/.test(conTipo) && /🤝/.test(conTipo), conTipo);
        ok('5c · 🔑🔑 SIN tipo (informe antiguo), no pinta nada',
           sb.P({}) === '' && sb.P({ matchType: '' }) === '',
           'es la decisión del autor: los antiguos se quedan sin etiqueta');
        ok('5d · un tipo desconocido tampoco inventa', sb.P({ matchType: 'playoff' }) === '');
    }
    ok('5e · «Mis Informes» del entrenador usa la MISMA píldora',
       /_sdTipoPartidoPill\(m\)/.test(MIS),
       'una segunda copia acabaría pintando otra cosa');
    ok('5f · el informe individual lo pinta en su cabecera',
       /_tipo\s*\n?\s*\?\s*`<div style="font-weight:800/.test(ENGINE) ||
       /\(_tipo[\s\S]{0,200}icono/.test(ENGINE));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n6) EL INFORME COMPLETO, GENERADO DE VERDAD');
{
    //  Se ejecuta el motor entero —como hace su propio guard— y se mira el
    //  HTML: es la única forma de saber que la etiqueta llega a la pantalla.
    const ini = ENGINE.indexOf('const _RP = (() => {');
    const fin = ENGINE.indexOf('\n})();', ini);
    const BLOQUE = ENGINE.slice(ini, fin + 6);
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(BLOQUE + '\n;globalThis.RP = _RP;', sb);

    // ⚠️ `RP.build(match, me)` recibe EL PARTIDO (con `players` dentro), no un
    // array de jugadores: se llama igual que en test_report_engine_module.js.
    const jugador = { playerNumber: '7', playerAlias: 'LUIS', goals: 1, minutesPlayed: '60:00',
                      wasStarter: true, titular: true, history: [] };
    const partido = (extra) => Object.assign(
        { matchDate: '2026-09-17', rival: 'JOVERO', scoreHome: 2, scoreAway: 0,
          myTeamRole: 'home', category: 'f11_regional', players: [jugador] }, extra || {});
    const pintar = (extra) => sb.RP.build(partido(extra), { clubName: 'CD DÍA' });

    const conLiga = pintar({ matchType: 'liga' });
    ok('6a · 🔑 el informe de un partido de Liga lo dice',
       /LIGA/.test(conLiga) && /🏆/.test(conLiga));
    const conAmistoso = pintar({ matchType: 'amistoso' });
    ok('6b · y el de un amistoso también', /AMISTOSO/.test(conAmistoso));
    const sinTipo = pintar();
    ok('6c · 🔑🔑 un informe antiguo (sin tipo) no enseña ninguna etiqueta',
       !/LIGA|COPA|TORNEO|AMISTOSO/.test(sinTipo),
       'y sigue generándose entero: la falta del dato no rompe nada');
    ok('6d · el informe antiguo se sigue pintando igual de completo',
       sinTipo.length > 500);
}

} catch (e) {
    console.log('\n  ✗ el arnés se detuvo: ' + (e && e.message));
    console.log('     (contra el código anterior a v735 esto es lo esperado: ' +
                'ni el resolutor ni el sellado existían todavía)');
    fallos++; total++;
}

// ═════════════════════════════════════════════════════════════════════
//  7. v736 · DEL DESPLEGABLE AL INFORME, SIN PERDERSE POR EL CAMINO
// ═════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-18, captura 10551, tras probar
//  v735): jugó un partido del Alevín C y el informe salió SIN tipo.
//
//  📏 v735 resolvía el tipo mirando `_cronosDatosPartido` —que se pierde al
//  recargar y se REINICIA al cambiar de equipo— y la convocatoria, que puede
//  ser de otro equipo. El informe se genera al TERMINAR el partido, y para
//  entonces ya no quedaba nadie a quien preguntar.
//
//  🔑 Ahora el desplegable sella `_cronosMatchType` al pulsar CONTINUAR AL
//  PARTIDO, ese valor viaja en la RANURA del partido y se restaura por los dos
//  caminos de recuperación. Aquí se fija esa cadena entera.
try {
    const SETUP = leer('js/core/setup-modal.js');
    const APPINIT = leer('js/core/app-init.js');

    ok('7a · 🔑 CONTINUAR AL PARTIDO sella el valor del desplegable',
       /_confirmSetupAhora[\s\S]{0,3000}window\._cronosMatchType\s*=/.test(SETUP) &&
       /setup-match-type/.test(SETUP));
    ok('7b · ⚠️ y NUNCA lo deja vacío (el menú arranca en Liga)',
       /window\._cronosMatchType[\s\S]{0,300}:\s*'liga'/.test(SETUP),
       'el encargo dice «asegurando que nunca se quede vacío»');
    ok('7c · 🔑 el tipo viaja en la RANURA del partido, con la localía',
       /matchType:\s*\(typeof window\.cronosTipoPartidoDelPartido/.test(APPINIT));
    ok('7d · 🔑 se restaura por los DOS caminos de recuperación',
       /state\.matchType[\s\S]{0,200}_cronosMatchType/.test(APPINIT) &&
       /m\.matchType[\s\S]{0,200}_cronosMatchType/.test(SETUP),
       'con uno solo nace el fallo que ya costó `myTeamRole`');

    // Y el resolutor, ejecutado: lo sellado manda sobre todo lo demás.
    const w = cargarUtils('amistoso');           // la convocatoria dice amistoso…
    w._cronosDatosPartido = { tipo: 'torneo' };  // …la pantalla inicial, torneo…
    w._cronosMatchType = 'copa';                 // …y el partido se selló como copa
    ok('7e · 🔑🔑 manda lo sellado en el partido, por encima de lo demás',
       w.cronosTipoPartidoActual() === 'copa');
    ok('7f · y se puede consultar sólo lo del partido',
       w.cronosTipoPartidoDelPartido() === 'copa');
    w._cronosMatchType = 'basura';
    ok('7g · un sello corrupto no se cuela: se cae al resto de la cascada',
       w.cronosTipoPartidoDelPartido() === '' && w.cronosTipoPartidoActual() === 'torneo');
} catch (e) {
    console.log('  ✗ PARTE 7 se detuvo: ' + (e && e.message));
    fallos++; total++;
}

// ═════════════════════════════════════════════════════════════════════
//  8. v737 · EL AGREGADOR SE COMÍA EL CAMPO (y el familiar no lo tenía)
// ═════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-18, capturas 10556-10558): con
//  v735+v736 YA EN PRODUCCIÓN eligió «Torneo», jugó, y las tarjetas de «Mis
//  Informes» salieron otra vez sin distintivo.
//
//  📏 El dato SÍ estaba escrito en Firestore (medido con
//  scripts/ops/inspect_tipo_partido.js: los documentos de ese partido traían
//  `matchType: torneo`). Lo que fallaba estaba después: ni la tarjeta ni el
//  motor de informes reciben el DOCUMENTO — reciben un objeto que los dos
//  agrupadores construyen COPIANDO CAMPO A CAMPO, y ninguno de los dos copiaba
//  `matchType`. La píldora de v735 se llamaba con el campo a `undefined`, y su
//  regla de «sin tipo no hay etiqueta» hacía el resto: silencio.
//
//  🔑 Es EXACTAMENTE la misma trampa que ya se documentó para `subcategory` en
//  reports-tab.js (2026-07-30). Por eso esta parte no comprueba el pintado —de
//  eso ya se encarga la parte 5— sino que el campo SOBREVIVE AL AGRUPADO, que
//  es donde se perdió. Al añadir un campo al informe hay que añadirlo a los DOS.
//
//  ⚠️ Y el cuarto rol: el encargo nombra a director, coordinador, entrenador y
//  familiar. El Área de Familias pinta su PROPIA tarjeta (js/parent/panel.js)
//  sin pasar por las otras dos, así que no tenía la etiqueta en ninguna parte.
try {
    const PANEL = leer('js/parent/panel.js');

    // ── El literal EXACTO que construye cada agrupado, no un regex suelto ──
    //  Se localiza el objeto que nace en `matches[key] = {` / `byMatch[...] = {`
    //  y se mira si `matchType` está entre sus claves: así la aserción apunta
    //  al sitio donde se perdió, y no a cualquier mención del campo en el
    //  fichero (que las hay, y verdes en falso).
    const literalTras = (src, marca) => {
        const i = src.indexOf(marca);
        if (i < 0) return null;
        let prof = 0, j = src.indexOf('{', i);
        if (j < 0) return null;
        for (let k = j; k < src.length; k++) {
            if (src[k] === '{') prof++;
            else if (src[k] === '}') { prof--; if (prof === 0) return src.slice(j, k + 1); }
        }
        return null;
    };

    const litMis = literalTras(MIS, 'matches[key] = {');
    ok('8a · se localiza el agrupado de «Mis Informes»', !!litMis);
    ok('8b · 🔑 y copia `matchType` (era el campo que se perdía)',
       !!litMis && /\bmatchType:/.test(litMis),
       'sin esto la píldora de v735 recibe undefined y calla');

    const litTab = literalTras(TAB, 'matches[key] = {');
    ok('8c · se localiza el agrupado del Panel de Dirección', !!litTab);
    ok('8d · 🔑 y copia `matchType` (Director y Coordinador leen ese objeto)',
       !!litTab && /\bmatchType:/.test(litTab),
       'los DOS agregadores hay que tocarlos a la vez, como pasó con subcategory');

    // ── El cuarto rol: la familia ─────────────────────────────────────
    ok('8e · 🔑 el Área de Familias pinta la MISMA píldora',
       /_sdTipoPartidoPill\(r\)/.test(PANEL) && /\$\{_tipoPill\}/.test(PANEL),
       'una copia propia del diseño acabaría diciendo otra cosa del mismo partido');

    // ── Y los ficheros descargados no contradicen a la pantalla ───────
    ok('8f · el TXT del entrenador escribe el tipo',
       /cronosTipoPartidoEtiqueta\(m\.matchType\)/.test(MIS) && /Tipo:/.test(MIS));
    ok('8g · y el TXT de la familia también',
       /cronosTipoPartidoEtiqueta\(r\.matchType\)/.test(PANEL) && /Tipo:/.test(PANEL));
    ok('8h · ⚠️ ninguno de los dos inventa la línea sin dato',
       /if \(_tipoTxt\)\s*L\.push/.test(MIS) && /if \(_tipoTxt\) L\.push/.test(PANEL),
       'informe antiguo = sin línea, igual que sin píldora');

    // ── La píldora, EJECUTADA con lo que sale del agrupado ─────────────
    //  Que el campo se copie no basta: se comprueba que la función que pinta
    //  acepta ese objeto y devuelve la etiqueta. Es el camino completo.
    {
        const w = cargarUtils();
        const sb = {
            console: { log() {}, warn() {}, error() {} },
            String, Object, Array, JSON, escapeHtml: (s) => String(s),
        };
        sb.window = sb;
        sb.cronosTipoPartido = w.cronosTipoPartido;
        vm.createContext(sb);
        const pill = TAB.match(/function _sdTipoPartidoPill\(m\) \{[\s\S]*?\n\}/);
        if (pill) {
            vm.runInContext(pill[0] + '\n;globalThis.P = _sdTipoPartidoPill;', sb);
            // Un agrupado como el que fabrica «Mis Informes» a partir de los
            // documentos que él tiene en producción.
            const agrupado = { matchDate: '2026-09-18', rival: 'Rival', scoreHome: 3,
                               scoreAway: 1, category: 'f7_alevin', matchType: 'torneo' };
            const html = sb.P(agrupado);
            ok('8i · 🔑🔑 su partido del 18/09 («Torneo») SÍ pinta etiqueta',
               /TORNEO/.test(html) && /🎖/.test(html), html);
            // Y el mismo agrupado SIN el campo -- el estado de v736 -- calla:
            // así queda escrito por qué la pantalla salía muda.
            const mudo = Object.assign({}, agrupado); delete mudo.matchType;
            ok('8j · y sin el campo (lo que hacía el agregador) no pinta nada',
               sb.P(mudo) === '',
               'ésta es la aserción que describe el defecto de v736');
        }
    }
} catch (e) {
    console.log('  ✗ PARTE 8 se detuvo: ' + (e && e.message));
    fallos++; total++;
}

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);
