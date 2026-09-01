// test_asistencia_parte_director.js
// ════════════════════════════════════════════════════════════════════
//  📅 EL PARTE MENSUAL DE ASISTENCIA EN DIRECCIÓN Y COORDINACIÓN (v619)
// ════════════════════════════════════════════════════════════════════
//  El autor pidió (implementar.txt, 2026-08-24) que al entrar en un equipo
//  desde el Panel de Dirección Deportiva se viera el parte mensual COMPLETO
//  —el mismo que ve el entrenador— en vez de las cuatro cifras agregadas.
//
//  🔑🔑 LO QUE ESTE GUARD PROTEGE DE VERDAD: que sea LA MISMA FUNCIÓN. El
//  encargo decía «idéntica», y dos copias de la misma tabla se separan en
//  cuanto alguien toca una sola. Por eso la PARTE 1 exige que la tabla viva
//  en `CronosAttendance.parteMensualHtml` y que NI el panel del entrenador NI
//  el de dirección la reimplementen.
//
//  🔑 Y que el detalle NO cueste una lectura: el árbol ya se descarga los
//  partes completos del mes (`sessions` + `marks`) y las plantillas. Si
//  alguien mete un `getDoc` en el camino del detalle, cada clic en un equipo
//  pasaría a costar dinero. PARTE 4.
//
//  ⚠️ RGPD: esta pantalla enseña nombres de menores y el motivo de sus faltas
//  —incluido «Motivo médico / lesión», dato de salud (art. 9)—. Hasta v618 no
//  lo hacía, a propósito. El autor lo pidió y lo confirmó a sabiendas tras
//  exponerle exactamente qué dato pasaba a verse. Lo que este guard sí fija es
//  que el ALCANCE no se ensanchó: sigue rigiendo el filtro por categoría y el
//  acotamiento por modalidad del coordinador (PARTE 5).
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
const P_STORE = process.env.CRONOS_ATT_STORE || path.join(RAIZ, 'js/coach/attendance/attendance-store.js');
const P_PANEL = process.env.CRONOS_ATT_PANEL || path.join(RAIZ, 'js/coach/attendance/panel.js');
const P_CLUB  = process.env.CRONOS_CLUB_REPORTS || path.join(RAIZ, 'js/coach/reports/club-reports.js');

const SRC_STORE = fs.readFileSync(P_STORE, 'utf8');
const SRC_PANEL = fs.readFileSync(P_PANEL, 'utf8');
const SRC_CLUB  = fs.readFileSync(P_CLUB, 'utf8');

// ⚠️ Presencia y orden se miden SIEMPRE sobre el código despojado de
//    comentarios: en este proyecto ya han dado verde en falso cuatro
//    aserciones que casaban la palabra buscada dentro de un comentario propio.
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const STORE = sinCom(SRC_STORE), PANEL = sinCom(SRC_PANEL), CLUB = sinCom(SRC_CLUB);

function cuerpoDe(src, arranque) {
    const i = src.indexOf(arranque);
    if (i === -1) return '';
    let prof = 0, dentro = false;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
        if (src[k] === '{') { prof++; dentro = true; }
        else if (src[k] === '}') { prof--; if (dentro && prof === 0) return src.slice(i, k + 1); }
    }
    return src.slice(i);
}

console.log('=== TEST: parte mensual de asistencia en Dirección / Coordinación ===\n');

// ── PARTE 1 · 🔑 UNA SOLA TABLA, NO DOS ─────────────────────────────
console.log('PARTE 1 · la tabla vive en UN solo sitio');
ok('1a · el almacén exporta parteMensualHtml', /parteMensualHtml:\s*parteMensualHtml/.test(STORE));
ok('1b · el almacén exporta sesionesDeParte', /sesionesDeParte:\s*sesionesDeParte/.test(STORE));
ok('1c · el panel del ENTRENADOR la usa', /CronosAttendance\.parteMensualHtml\(/.test(PANEL));
ok('1d · el panel de DIRECCIÓN la usa', /CronosAttendance\.parteMensualHtml\(/.test(CLUB));
// El corazón: la cabecera de la tabla se escribe UNA vez, en el almacén.
const marcaTabla = /TOTAL PRESENTES/g;
ok('1e · el entrenador NO reimplementa la tabla', (PANEL.match(marcaTabla) || []).length === 0,
   'TOTAL PRESENTES aparece en panel.js');
ok('1f · dirección NO reimplementa la tabla', (CLUB.match(marcaTabla) || []).length === 0,
   'TOTAL PRESENTES aparece en club-reports.js');
ok('1g · …y sí está en el almacén', (STORE.match(marcaTabla) || []).length > 0);
ok('1h · el desglose de faltas tampoco está duplicado',
   (PANEL.match(/DESGLOSE DE FALTAS/g) || []).length === 0 &&
   (CLUB.match(/DESGLOSE DE FALTAS/g) || []).length === 0);

// ── PARTE 2 · las puertas del director ──────────────────────────────
console.log('\nPARTE 2 · cómo entra y cómo sale el director');
ok('2a · existe _sdAbrirParteMensual', /window\._sdAbrirParteMensual\s*=/.test(CLUB));
ok('2b · existe _sdParteVolver', /window\._sdParteVolver\s*=/.test(CLUB));
ok('2c · existe _sdParteCambiarMes', /window\._sdParteCambiarMes\s*=/.test(CLUB));
ok('2d · la ficha del equipo ofrece el botón', /_sdAbrirParteMensual\(/.test(CLUB) &&
   /VER PARTE MENSUAL/.test(CLUB));
ok('2e · el parte del director lleva VOLVER', /_sdParteVolver\(\)/.test(CLUB));
ok('2f · y sus flechas de mes son las suyas, no las del entrenador',
   /cambiarMes:\s*'_sdParteCambiarMes'/.test(CLUB));
// ⚠️ El director NO pasa lista: esa acción es del entrenador, que es su dueño.
const cuerpoAbrir = cuerpoDe(CLUB, 'window._sdAbrirParteMensual');
ok('2g · el director NO recibe el botón de PASAR LISTA',
   !/PASAR LISTA/.test(cuerpoAbrir), 'aparece PASAR LISTA en el parte de dirección');
// ⚠️ Sobre el código SIN comentarios: la primera versión miraba el fuente
//    crudo y MI PROPIO COMENTARIO ("su botón de PASAR LISTA") daba verde con
//    el botón borrado. Quinta vez que pasa en este proyecto.
ok('2h · el entrenador SÍ lo conserva', /PASAR LISTA/.test(PANEL));

// ── PARTE 3 · el módulo puede faltar ────────────────────────────────
console.log('\nPARTE 3 · sin el módulo no se deja la pantalla en blanco');
ok('3a · se comprueba que parteMensualHtml exista antes de llamarla',
   /typeof window\.CronosAttendance\.parteMensualHtml !== 'function'/.test(cuerpoAbrir));

// ── PARTE 4 · 🔑 el detalle NO cuesta una lectura ───────────────────
console.log('\nPARTE 4 · el detalle sale de lo YA descargado');
ok('4a · el árbol guarda lo descargado en _sdAsistDatos', /window\._sdAsistDatos\s*=/.test(CLUB));
ok('4b · el detalle NO llama a Firestore', !/getDoc|getDocs|_sdFS\(/.test(cuerpoAbrir), cuerpoAbrir.slice(0, 100));
ok('4c · el detalle no espera a nadie (sin await)', !/\bawait\b/.test(cuerpoAbrir));
ok('4d · las sesiones salen del parte, no del cuadrante',
   /sesionesDeParte\(/.test(cuerpoAbrir));
ok('4e · la plantilla sale de la que ya se trajo el árbol',
   /plantillas/.test(cuerpoAbrir) && !/cronosFetchAllTeamRosters/.test(cuerpoAbrir));

// ── PARTE 5 · ⚠️ el alcance no se ensancha ──────────────────────────
console.log('\nPARTE 5 · el coordinador sigue viendo sólo lo suyo');
// 🔑 Se mide en la construcción de `lista`, que es la que alimenta el árbol y
//    el detalle. Comprobar sólo que la palabra aparezca en el fichero daba
//    verde con el filtro de ESTA pestaña quitado: club-reports.js la nombra en
//    otras pestañas.
const bloqueLista = CLUB.slice(CLUB.indexOf('const lista = Array.from(equipos.values())'),
                               CLUB.indexOf('const lista = Array.from(equipos.values())') + 320);
// ⚠️ Y se exige la LLAMADA, no el nombre: la línea lleva además un
//    `typeof window._cronosVeCategoria !== 'function'` de respaldo, así que
//    buscar sólo el identificador daba verde con la comprobación sustituida
//    por `true`. Es el mismo error que «presencia ≠ uso» del guard anterior.
ok('5a · sigue el filtro por categoría en ESTA lista',
   /_cronosVeCategoria\(window\._cronosCurrentUser/.test(bloqueLista), bloqueLista.slice(0, 160));
ok('5b · sigue el acotamiento por modalidad del coordinador', /_cronosCoordScope/.test(CLUB));
ok('5c · el detalle sólo abre equipos de la lista ya filtrada',
   /_sdAsistDatos\.equipos\[|d\.equipos\[/.test(cuerpoAbrir));

// ── PARTE 6 · el contenido de la tabla ──────────────────────────────
console.log('\nPARTE 6 · lo que sale de verdad en la tabla');
const sb = {
    console: { log() {}, warn() {}, error() {} },
    Date, Math, JSON, String, Number, Object, Array, RegExp, parseInt, parseFloat,
    isNaN, isFinite, setTimeout, Intl,
    escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    document: { getElementById: () => null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {}, innerWidth: 1400, addEventListener() {}, removeEventListener() {}
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(SRC_STORE, sb);
const CA = sb.window.CronosAttendance;
ok('6a · el almacén carga y expone la función', CA && typeof CA.parteMensualHtml === 'function');

// Un parte tal y como lo guarda el modelo: sessions congeladas + marks.
const parte = {
    month: '2026-08',
    sessions: {
        '2026-08-10': { tipo: 'entrenamiento', hora: '20:00' },
        '2026-08-15': { tipo: 'partido', hora: '11:00' },
        // ⚠️ Sesión SIN MARCAR por nadie, y está aquí a propósito: es la única
        //    forma de distinguir un % calculado sobre lo REGISTRADO de uno
        //    calculado sobre el total de sesiones. Sin ella, las dos fórmulas
        //    dan el mismo número y la aserción 6q no prueba nada.
        '2026-08-18': { tipo: 'entrenamiento', hora: '20:00' }
    },
    marks: {
        '2026-08-10': { F1: { s: 'P' }, F2: { s: 'I' }, F3: { s: 'J', m: 'estudios' } },
        '2026-08-15': { F1: { s: 'J', m: 'medico' }, F2: { s: 'P' }, F3: { s: 'P' } }
    }
};
const ses = CA.sesionesDeParte(parte);
ok('6b · sesionesDeParte reconstruye las sesiones del documento', ses.length === 3, JSON.stringify(ses.length));
ok('6c · …ordenadas y con su tipo', ses[0].fecha === '2026-08-10' && ses[1].tipo === 'partido');
ok('6d · un día sin tipo no es sesión', CA.sesionesDeParte({ sessions: { '2026-08-11': {} } }).length === 0);

const plantel = [
    { ficha: 'F1', dorsal: '1', nombre: 'PEDRO GARCIA', alias: 'PEDRO' },
    { ficha: 'F2', dorsal: '2', nombre: 'LUIS MARTIN', alias: 'LUIS' },
    { ficha: 'F3', dorsal: '3', nombre: 'TONI SAEZ', alias: '' }
];
const html = CA.parteMensualHtml({
    mes: '2026-08', equipo: 'Alevín C', sesiones: ses, plantel: plantel,
    marks: parte.marks, cambiarMes: '_sdParteCambiarMes',
    acciones: '<button onclick="_sdParteVolver()">← VOLVER</button>'
});
ok('6e · lleva el título del parte', /Parte mensual de asistencia/.test(html));
ok('6f · lleva el equipo', /Alevín C/.test(html));
ok('6g · lista a TODOS los jugadores de la plantilla',
   /PEDRO/.test(html) && /LUIS/.test(html) && /TONI SAEZ/.test(html));
ok('6h · una columna por sesión del mes', (html.match(/<th title=/g) || []).length === 3);
ok('6i · presente en verde, injustificada en rojo, justificada en naranja',
   html.indexOf('✅') !== -1 && html.indexOf('❌') !== -1 && html.indexOf('🩹') !== -1);
ok('6j · el motivo se dice en el title de la celda', /Justificada: /.test(html));
ok('6k · fila de totales', /TOTAL PRESENTES/.test(html));
ok('6l · desglose de faltas del mes', /DESGLOSE DE FALTAS DEL MES/.test(html));
ok('6m · el desglose separa partidos de entrenamientos',
   /a partidos:/.test(html) && /a entrenamientos:/.test(html));
// 🔑 Se busca el FORMATO del desglose (`Motivo: <strong>N</strong>`), no la
//    palabra suelta: «Estudios» y «Motivo médico» aparecen también en el
//    `title` de cada celda justificada, así que buscarlas a secas daba verde
//    con el bloque del desglose borrado entero.
ok('6n · y detalla los motivos, con su recuento',
   /Estudios: <strong>\d+<\/strong>/.test(html) && /Motivo médico[^:]*: <strong>\d+<\/strong>/.test(html),
   'no está el desglose por motivo');
ok('6o · las flechas de mes son las que se le pasan', /_sdParteCambiarMes\(-1\)/.test(html));
ok('6p · las acciones que se le pasan aparecen', /_sdParteVolver\(\)/.test(html));

// ⚠️ Sin marcar NO es falta y el % se calcula sobre lo REGISTRADO: el olvido
//    del entrenador no puede acusar a un chaval. Se comprueba con un jugador
//    que sólo tiene una de las dos sesiones marcada.
const r = CA.resumenJugador(parte.marks, ses, 'F2');
ok('6q · el % se calcula sobre lo registrado, no sobre las sesiones',
   r.P === 1 && r.I === 1 && r.pct === 50, JSON.stringify(r));
const vacio = CA.parteMensualHtml({ mes: '2026-08', equipo: 'X', sesiones: [], plantel: [], marks: {} });
ok('6r · sin sesiones lo dice, no pinta una tabla vacía', /Sin sesiones registradas/.test(vacio));

// ── PARTE 7 · 🎨 cada causa con SU icono (v620) ─────────────────────
//  Reporte del autor (implementar.txt, 2026-08-24): al pasar lista, las cuatro
//  causas salían todas con el mismo icono genérico. Los iconos YA existían en
//  `MOTIVOS` —el desglose del parte mensual sí los usaba—; la lista de pasar
//  lista pintaba siempre el de "justificada". Cuatro causas con la misma cara
//  no se distinguen de un vistazo, que es para lo que sirve esa lista.
console.log('\nPARTE 7 · cada causa con su icono');
ok('7a · el almacén expone motivoIcon', typeof CA.motivoIcon === 'function');
ok('7b · y cada causa tiene el suyo, distinto del de al lado', (function () {
    const vistos = CA.MOTIVOS.map(m => CA.motivoIcon(m.id));
    return vistos.length === CA.MOTIVOS.length &&
           vistos.every(v => !!v) &&
           new Set(vistos).size === vistos.length;
})(), JSON.stringify(CA.MOTIVOS.map(m => m.id + '=' + CA.motivoIcon(m.id))));
ok('7c · estudios y trabajo NO comparten icono',
   CA.motivoIcon('estudios') !== CA.motivoIcon('trabajo'));
ok('7d · un motivo desconocido no deja un hueco', !!CA.motivoIcon('inventado'));
// Y que la lista de pasar lista lo USE: tenerlo y no llamarlo era el defecto.
ok('7e · la lista de pasar lista llama a motivoIcon',
   /motivoIcon\(m\.m\)/.test(PANEL), 'seguía pintando el icono genérico');

// ── PARTE 7 bis · y la REJILLA del parte mensual, igual ──────────────
//  Reporte del autor (2026-09-01, captura del parte de Agosto): en el parte
//  mensual todas las justificadas salían con el mismo 🩹. v620 arregló la
//  lista de pasar lista y dejó la rejilla con el icono escrito a mano.
//
//  🔑🔑 SE MIDE SOBRE LA CELDA, NO SOBRE EL HTML ENTERO. Buscar 📚 a secas da
//  VERDE con el defecto puesto: el desglose de faltas del pie ya pintaba los
//  cuatro iconos de `MOTIVOS`. Por eso cada aserción exige el icono DENTRO del
//  `<td>` cuyo title es el de esa causa — que es justo lo que fallaba.
ok('7f · la celda de una justificada por ESTUDIOS lleva 📚',
   /<td title="Justificada: Estudios"[^>]*>📚<\/td>/.test(html),
   'la rejilla seguía pintando el icono genérico');
ok('7g · …y la de MOTIVO MÉDICO conserva el suyo',
   /<td title="Justificada: Motivo médico[^"]*"[^>]*>🩹<\/td>/.test(html));
// Presencia (7f) y ausencia (7h) juntas: la de ausencia sola daría verde con
// la celda de estudios borrada del todo.
ok('7h · y la de estudios ya NO pinta el 🩹 de "justificada"',
   !/<td title="Justificada: Estudios"[^>]*>🩹<\/td>/.test(html));
// El icono de la celda y el de la leyenda del pie salen de la MISMA lista: si
// alguien vuelve a escribir uno a mano, la tabla y su desglose se separan.
ok('7i · el icono de la celda es el mismo que el de su leyenda del desglose',
   html.indexOf('<td title="Justificada: Estudios" style="text-align:center; padding:0.3rem 0.2rem; color:#f0883e;">' +
                CA.motivoIcon('estudios') + '</td>') !== -1);

console.log('\n------------------------------------------------------------');
console.log('Resultado: ' + ok_ + '/' + n + ' pruebas superadas.');
process.exit(mal > 0 ? 1 : 0);
