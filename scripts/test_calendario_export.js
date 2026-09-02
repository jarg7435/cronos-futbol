// test_calendario_export.js
// ════════════════════════════════════════════════════════════════════
//  📤 SACAR LA TEMPORADA · CSV y PDF, por equipo y de todo el club
// ════════════════════════════════════════════════════════════════════
//  El calendario anual tenia TRES vias de entrada y NINGUNA de salida. Este
//  guard fija la salida y, sobre todo, las dos cosas que la hacen funcionar en
//  iPad y movil, que es donde el autor dijo que la iba a usar:
//
//  1. 🔑🔑 EL GESTO DEL USUARIO. `navigator.share` EXIGE un gesto y lo pierde
//     si antes te vas a leer de Firestore. Por eso el diseno va en DOS PASOS:
//     `calAbrirExportador` lee la temporada y la deja en memoria; los botones
//     construyen el fichero SIN ESPERAR A NADIE. Si alguien mete un `await` en
//     el paso 2, el iPad deja de guardar y NO da ningun error visible: se abre
//     el menu y se cierra solo. Eso es lo que vigila la PARTE 3.
//
//  2. 🔑 EL PC NO SE TOCA. `canShare({files})` tambien dice que si en Chrome de
//     Windows, y alli el usuario quiere su CSV en Descargas para abrirlo con
//     Excel, no un menu de compartir. *Un arreglo que arregle el iPad y rompa
//     el PC no es un arreglo* (v530). La PARTE 4 fija que el camino del `<a>`
//     sigue vivo y que el de compartir esta condicionado a tactil.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let n = 0, ok_ = 0, mal = 0;
function ok(nombre, cond, detalle) {
    n++;
    if (cond) { ok_++; console.log('  PASS  ' + nombre); }
    else { mal++; console.error('  FAIL  ' + nombre + (detalle ? ' -> ' + detalle : '')); }
}

const RAIZ = path.join(__dirname, '..');
// CRONOS_CAL_JS permite apuntar a una copia mutada (red-check).
const CAL_PATH = process.env.CRONOS_CAL_JS || path.join(RAIZ, 'js/coach/reports/calendario-temporada.js');
const SRC_CAL = fs.readFileSync(CAL_PATH, 'utf8');
const RX_PATH = process.env.CRONOS_RX_JS || path.join(RAIZ, 'js/coach/reports/reports-export.js');
const SRC_EXP = fs.readFileSync(RX_PATH, 'utf8');

// ⚠️ Sobre PRESENCIA y ORDEN se mide siempre el codigo DESPOJADO DE
//    COMENTARIOS: cuatro veces en este proyecto una asercion ha casado la
//    palabra buscada dentro de un comentario propio y ha dado verde en falso.
function sinComentarios(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const CAL = sinComentarios(SRC_CAL);
const EXP = sinComentarios(SRC_EXP);

// Cuerpo de una funcion, desde `arranque` hasta que se cierra su llave.
function _cuerpoDesde(src, i) {
    if (i === -1) return '';
    let prof = 0, dentro = false;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
        if (src[k] === '{') { prof++; dentro = true; }
        else if (src[k] === '}') { prof--; if (dentro && prof === 0) return src.slice(i, k + 1); }
    }
    return src.slice(i);
}
const cuerpoDe   = (src, nombre) => _cuerpoDesde(src, src.indexOf('window.' + nombre + ' ='));
const cuerpoFnDe = (src, nombre) => _cuerpoDesde(src, src.indexOf('function ' + nombre + '('));

// ⚠️ `indexOf` DEVUELVE −1 Y −1 ES MENOR QUE TODO. Comparar dos posiciones sin
//    comprobar antes que las dos existen convierte "esto ya no está" en un
//    verde. Lo cazó el red-check: al borrar la llamada a compartir, la
//    aserción de orden seguía pasando. Esta funcion exige presencia Y orden.
function ordenReal(src, antes, despues) {
    const a = src.indexOf(antes), b = src.indexOf(despues);
    return a !== -1 && b !== -1 && a < b;
}

console.log('=== TEST: exportar la temporada (CSV/PDF, equipo/club, PC/tactil) ===\n');

// ── PARTE 1 · la salida existe y esta enchufada ─────────────────────
console.log('PARTE 1 · las tres puertas');
ok('1a · calAbrirExportador existe', CAL.includes('window.calAbrirExportador'));
ok('1b · calExportarCSV existe', CAL.includes('window.calExportarCSV'));
ok('1c · calExportarPDF existe', CAL.includes('window.calExportarPDF'));
ok('1d · el gestor ofrece el boton de exportar', /onclick="calAbrirExportador\(\)"/.test(CAL));
ok('1e · el boton solo sale si hay algo que sacar',
   /equipos\.some\([\s\S]{0,120}jornadas\)/.test(CAL));
ok('1f · no se pinta ningun boton sin el modulo de exportacion',
   /typeof window\.rxCsv !== 'function'/.test(CAL));

// ── PARTE 2 · se reutiliza el exportador, no se duplica ─────────────
console.log('\nPARTE 2 · reutiliza reports-export.js (nada de duplicar)');
ok('2a · el CSV se construye con rxCsv', CAL.includes('window.rxCsv('));
ok('2b · la descarga va por rxDescargarCSV', CAL.includes('window.rxDescargarCSV('));
ok('2c · el PDF va por rxImprimir', CAL.includes('window.rxImprimir('));
ok('2d · NO se reimplementa la codificacion UTF-16 aqui',
   !/0xFF|0xFE|utf-?16/i.test(CAL), 'el calendario no debe codificar por su cuenta');
// ⚠️ v656 · ESTA ASERCIÓN SE ACOTÓ, NO SE AFLOJÓ, Y LA RAZÓN IMPORTA.
//  Prohibía `createObjectURL` en TODO el fichero, porque lo que hay que
//  impedir es que la EXPORTACIÓN se fabrique su propio enlace de descarga en
//  vez de pasar por `rxDescargarCSV` —que es quien sabe el truco del iPad—.
//  Pero al añadir la lectura de capturas de pantalla apareció un
//  `createObjectURL` que hace lo CONTRARIO de descargar: abre una imagen que
//  el usuario acaba de soltar, y la revoca acto seguido. El guard lo cazó y
//  tenía razón en dispararse: su ancla no distinguía los dos usos.
//
//  🔑 Así que sigue prohibido en todo el fichero fabricar un `<a download>`,
//  y `createObjectURL` sigue prohibido en todo el fichero MENOS dentro de
//  `_calPrepararImagen`. Si mañana alguien lo usa para descargar en otra
//  función, esto vuelve a saltar.
const cuerpoImagen = cuerpoFnDe(CAL, '_calPrepararImagen');
const vecesEn = (s, re) => (s.match(re) || []).length;
ok('2e · NO se fabrica un <a download> propio en el calendario',
   !/\.download\s*=/.test(CAL));
ok('2e · y createObjectURL sólo se usa para ABRIR la captura, no para descargar',
   cuerpoImagen.length > 0 &&
   vecesEn(CAL, /createObjectURL/g) === vecesEn(cuerpoImagen, /createObjectURL/g) &&
   /revokeObjectURL/.test(cuerpoImagen),
   vecesEn(CAL, /createObjectURL/g) + ' en el fichero · ' +
   vecesEn(cuerpoImagen, /createObjectURL/g) + ' en _calPrepararImagen');

// ── PARTE 3 · 🔑🔑 EL GESTO: el paso 2 no espera a nadie ────────────
console.log('\nPARTE 3 · el gesto del usuario (lo que hace que el iPad guarde)');
const cuerpoCSV = cuerpoDe(CAL, 'calExportarCSV');
const cuerpoPDF = cuerpoDe(CAL, 'calExportarPDF');
const cuerpoAbrir = cuerpoDe(CAL, 'calAbrirExportador');
ok('3a · calExportarCSV NO es async', !/window\.calExportarCSV\s*=\s*async/.test(CAL));
ok('3b · calExportarPDF NO es async', !/window\.calExportarPDF\s*=\s*async/.test(CAL));
ok('3c · calExportarCSV no espera nada (sin await)', !/\bawait\b/.test(cuerpoCSV), cuerpoCSV.slice(0, 80));
ok('3d · calExportarPDF no espera nada (sin await)', !/\bawait\b/.test(cuerpoPDF));
ok('3e · calExportarCSV NO lee de Firestore', !/_calLeerMes|_calLeerIndice|getDoc/.test(cuerpoCSV));
ok('3f · calExportarPDF NO lee de Firestore', !/_calLeerMes|_calLeerIndice|getDoc/.test(cuerpoPDF));
ok('3g · la lectura ocurre en el paso 1, al abrir', /_calLeerTemporadaCompleta|_calLeerMes/.test(cuerpoAbrir));
ok('3h · el paso 1 deja la temporada en memoria', /window\._calExp\s*=/.test(cuerpoAbrir));

// ── PARTE 4 · 🔑 tactil comparte, PC descarga ───────────────────────
console.log('\nPARTE 4 · tactil comparte / PC descarga (v530)');
ok('4a · reports-export usa navigator.share', EXP.includes('navigator.share'));
ok('4b · pregunta antes con canShare({files})', /canShare\(\{\s*files/.test(EXP));
ok('4c · existe la deteccion de tactil', /maxTouchPoints/.test(EXP) && /pointer: coarse/.test(EXP));
// 🔑 Y QUE SE USE, no solo que exista: quitar la llamada dejaba la funcion en
//    el fichero y la asercion anterior seguia verde. Lo cazo el red-check.
const cuerpoCompartir = cuerpoFnDe(EXP, '_rxCompartirFichero');
ok('4c-bis · …y el camino de compartir la INVOCA de verdad',
   /_rxEsTactil\(\)/.test(cuerpoCompartir), cuerpoCompartir.slice(0, 90));
ok('4d · el <a download> del PC SIGUE VIVO', /a\.download\s*=\s*nombre/.test(EXP));
ok('4e · el <a> se adjunta al DOM antes del click (Firefox)',
   ordenReal(EXP, 'appendChild(a)', 'a.click()'));
ok('4f · cancelar el menu (AbortError) no se trata como fallo', /AbortError/.test(EXP));
// ⚠️ Y esto se mide DENTRO del cuerpo de `rxDescargarCSV`, no en todo el
//    fichero: buscando en el fichero entero, el patron casaba con la propia
//    DEFINICION de `_rxCompartirFichero` —que va mas arriba— y la asercion
//    seguia verde con la llamada borrada. Segundo verde falso que caza el
//    red-check, y de la misma familia que el −1 de `indexOf`.
const cuerpoDescargar = cuerpoDe(EXP, 'rxDescargarCSV');
ok('4g · compartir se intenta ANTES de crear el objeto URL',
   ordenReal(cuerpoDescargar, '_rxCompartirFichero(', 'URL.createObjectURL'),
   cuerpoDescargar.slice(0, 120));

// ── PARTE 5 · el contenido: columnas reales y casa/fuera ────────────
console.log('\nPARTE 5 · el contenido del fichero');

function arranca() {
    const descargas = [], impresiones = [], toasts = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Date, Math, JSON, String, Number, Object, Array, RegExp, Set, isFinite, parseInt, setTimeout,
        document: { getElementById: () => null, addEventListener() {}, createElement: () => ({ style: {} }) },
        navigator: {},
        showToast: (m) => toasts.push(String(m)),
        // El modulo engancha el arrastrar-y-soltar del PDF al cargarse.
        addEventListener() {}, removeEventListener() {},
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC_CAL, sb);
    // Dobles de las piezas que este modulo REUTILIZA.
    sb.rxCsv = (filas) => filas.map(f => f.map(c => '"' + String(c == null ? '' : c) + '"').join(';')).join('\r\n');
    sb.rxSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    sb.rxHoy = () => '2026-08-24';
    sb.rxDescargarCSV = (nombre, texto) => { descargas.push({ nombre, texto }); return true; };
    sb.rxImprimir = (o) => { impresiones.push(o); return true; };
    return { sb, descargas, impresiones, toasts };
}

const t = arranca();
ok('5a · el modulo carga y expone _calFilasDe', typeof t.sb._calFilasDe === 'function');

// Un mes real, con la forma que guarda el importador.
const porMes = {
    '2026-09': {
        EQ1: {
            '2026-09-12': { jornada: '1', hora: '10:00', rival: 'CD Rival', local: true, sede: 'Municipal' },
            '2026-09-19': { jornada: '2', hora: '12:30', rival: 'UD Otro', local: false, sede: 'La Vega' },
        },
        EQ2: { '2026-09-12': { jornada: '1', hora: '09:00', rival: 'At. Tercero', local: true, sede: 'Anexo' } },
    },
};
const filasEQ1 = t.sb._calFilasDe(porMes, 'EQ1', 'Juvenil A');
ok('5b · saca los partidos del equipo pedido y solo esos', filasEQ1.length === 2, JSON.stringify(filasEQ1.length));
ok('5c · vienen ordenados por fecha', filasEQ1[0].fecha === '2026-09-12' && filasEQ1[1].fecha === '2026-09-19');
ok('5d · local:true se dice "Casa"', filasEQ1[0].local === 'Casa', filasEQ1[0].local);
ok('5e · local:false se dice "Fuera"', filasEQ1[1].local === 'Fuera', filasEQ1[1].local);
ok('5f · un partido sin local no miente: queda vacio',
   t.sb._calFilasDe({ M: { E: { '2026-09-01': { rival: 'X' } } } }, 'E', 'Eq')[0].local === '');

// CSV de un equipo y del club entero.
t.sb.window._calExp = {
    club: 'Estrella CF',
    bloques: [
        { filaId: 'EQ1', label: 'Juvenil A', filas: filasEQ1 },
        { filaId: 'EQ2', label: 'Cadete B', filas: t.sb._calFilasDe(porMes, 'EQ2', 'Cadete B') },
    ],
};

t.sb.window.calExportarCSV('EQ1');
const d1 = t.descargas[t.descargas.length - 1];
ok('5g · CSV por EQUIPO: cabecera con los campos reales',
   d1.texto.split('\r\n')[0] === '"Equipo";"Jornada";"Fecha";"Hora";"Rival";"Casa/Fuera";"Sede"',
   d1.texto.split('\r\n')[0]);
ok('5h · CSV por EQUIPO: solo sus partidos', d1.texto.split('\r\n').length === 3, String(d1.texto.split('\r\n').length));
ok('5i · el nombre del fichero lleva el equipo', /juvenil_a/.test(d1.nombre), d1.nombre);
ok('5j · la columna Equipo va tambien en el CSV de uno solo (para apilar hojas)',
   d1.texto.includes('"Juvenil A"'));

t.sb.window.calExportarCSV('');
const d2 = t.descargas[t.descargas.length - 1];
ok('5k · CSV de CLUB: junta los dos equipos', d2.texto.split('\r\n').length === 4, String(d2.texto.split('\r\n').length));
ok('5l · CSV de CLUB: el nombre dice que es completo', /completo/.test(d2.nombre), d2.nombre);

t.sb.window.calExportarPDF('EQ1');
const p1 = t.impresiones[t.impresiones.length - 1];
ok('5m · PDF por EQUIPO: lleva el equipo de subtitulo', p1.subtitulo === 'Juvenil A', p1.subtitulo);
ok('5n · PDF: verde para casa', /#1a7f37/.test(p1.cuerpo));
ok('5o · PDF: naranja para fuera', /#bc4c00/.test(p1.cuerpo));
ok('5p · 🎨 el PDF dice ADEMAS la palabra, por si se imprime en blanco y negro',
   /Casa/.test(p1.cuerpo) && /Fuera/.test(p1.cuerpo));

t.sb.window.calExportarPDF('');
const p2 = t.impresiones[t.impresiones.length - 1];
ok('5q · PDF de CLUB: los dos equipos, con su titular cada uno',
   /Juvenil A/.test(p2.cuerpo) && /Cadete B/.test(p2.cuerpo));
ok('5r · PDF de CLUB: cuenta todos los partidos', /3 partidos/.test(String(p2.meta)), String(p2.meta));

// Sin nada preparado no se descarga un fichero vacio.
t.sb.window._calExp = null;
const antes = t.descargas.length;
t.sb.window.calExportarCSV('');
ok('5s · sin temporada en memoria no se descarga nada', t.descargas.length === antes);

console.log('\n------------------------------------------------------------');
console.log('Resultado: ' + ok_ + '/' + n + ' pruebas superadas.');
process.exit(mal > 0 ? 1 : 0);
