// ════════════════════════════════════════════════════════════════════════
//  test_calendario_temporada.js
//  📅 CALENDARIO OFICIAL DE TEMPORADA — v609
// ════════════════════════════════════════════════════════════════════════
//  Petición del autor (implementar.txt, 2026-08-23): arrastrar el PDF oficial
//  de la federación de cada subcategoría, que la app lo interprete, y que los
//  partidos aparezcan solos en el Cuadrante semanal — verde en casa, naranja
//  fuera. Y, sobre la arquitectura: que funcione con el PDF de CUALQUIER
//  federación sin que nadie toque código.
//
//  🔑 POR QUÉ ESTE GUARD EJECUTA EL MOTOR EN VEZ DE MIRARLO
//
//  Un parser vigilado con expresiones regulares sobre su propio código fuente
//  no demuestra absolutamente nada: comprobar que existe la palabra "fecha" no
//  dice si sabe leer una. Por eso `calendario-parser.js` se escribió SIN
//  Firestore, sin DOM y sin pdf.js — para que aquí se pueda cargar con
//  `require` y ejercitar contra calendarios de mentira con maquetados muy
//  distintos, que es lo único que prueba que interpreta bien.
//
//  🔑 LO QUE PROTEGE, y por qué nada de esto es cosmético:
//
//   1. ⚠️ EL DATO VIVE EN weeks/CALENDARIO__{YYYY-MM}, HERMANO DEL CUADRANTE.
//      Cualquier otra colección caería en el catch-all `allow read, write: if
//      false` de firestore.rules y obligaría a desplegar reglas — que en este
//      proyecto NO se pueden probar antes (staging comparte base de datos y
//      reglas con producción). Y el prefijo lo mantiene fuera del alcance del
//      `deleteDoc` de TrainingSync.deleteWeek().
//
//   2. ⚠️ ONCE DOCUMENTOS, UNO POR MES, NO UNO DE TEMPORADA. Firestore no
//      manda deltas: un documento de temporada se releería entero cada vez que
//      el director pasa de semana.
//
//   3. 🔴 EL CALENDARIO NO PISA AL DIRECTOR. Decisión expresa del autor. Donde
//      hay casilla escrita, `_cqPropuesta` devuelve null y sólo se avisa.
//
//   4. 🔴 LOS PARTIDOS DE OTROS EQUIPOS DEL GRUPO NO ENTRAN. Muchas
//      federaciones publican el calendario del GRUPO entero: importarlo tal
//      cual llenaría el cuadrante de partidos ajenos.
//
//   5. ⛔ pdf.js NO ENTRA EN EL PRECACHE DEL SERVICE WORKER. `cache.addAll` es
//      atómico: 1,5 MB que fallen tumban la precarga entera (v452).
//
//   6. ⛔ pdf.js SE ALOJA EN EL PROYECTO, NO EN UN CDN (v543 se revirtió por
//      eso).
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PARSER = leer('js/coach/reports/calendario-parser.js');
const TEMP   = leer('js/coach/reports/calendario-temporada.js');
const CQ     = leer('js/coach/reports/cuadrante-club.js');
const INDEX  = leer('index.html');
const SW     = leer('sw.js');
const RULES  = leer('firestore.rules');

// El motor DE VERDAD.
const P = require(path.join(ROOT, 'js/coach/reports/calendario-parser.js'));

console.log('\n📅 CALENDARIO DE TEMPORADA (v609)\n');

// ════════════════════════════════════════════════════════════════════
console.log('1 · EL MOTOR INTERPRETA MAQUETADOS DISTINTOS (se ejecuta)');
// ════════════════════════════════════════════════════════════════════
const MIOS = ['C.D. Ejemplo'];
const corre = (txt, mios) => P.interpretar(P.lineasDeTexto(txt),
    { misNombres: mios || MIOS, inicioTemporada: 2026 });

// ── 1a · Una fila por partido, fecha completa, separador " - " ───────
const A = corre(`
CALENDARIO OFICIAL LIGA REGIONAL PREFERENTE - GRUPO 3
Jornada 1   13/09/2026  10:00   C.D. Ejemplo - U.D. Rival Norte      Campo Municipal El Prado
Jornada 2   20/09/2026  12:30   Atletico San Juan - C.D. Ejemplo     Ciudad Deportiva Sur
Jornada 3   27/09/2026  10:00   C.D. Ejemplo - Racing de la Vega     Campo Municipal El Prado
`);
ok('1a · lee las 3 jornadas', A.filas.length === 3, A.filas.length);
ok('1a · fecha en ISO', A.filas[0].fecha === '2026-09-13', A.filas[0].fecha);
ok('1a · hora', A.filas[0].hora === '10:00', A.filas[0].hora);
ok('1a · rival SIN la sede pegada', A.filas[0].rival === 'U.D. Rival Norte', A.filas[0].rival);
ok('1a · sede aparte', /El Prado/.test(A.filas[0].sede), A.filas[0].sede);
ok('1a · casa cuando salgo el primero', A.filas[0].local === true);
ok('1a · fuera cuando salgo el segundo', A.filas[1].local === false);
ok('1a · las tres en verde', A.resumen.verde === 3, A.resumen);

// ── 1b · La fecha va en la CABECERA de jornada, no en cada fila ──────
const B = corre(`
FEDERACION TERRITORIAL - CADETE GRUPO A
JORNADA 5 - 18/10/2026
  16:00  CD Ejemplo B  vs  EF Villanueva
  18:00  Union Deportiva Costa vs Atletico Puerto
JORNADA 6 - 25/10/2026
  11:00  Atletico Puerto vs CD Ejemplo B
`, ['CD Ejemplo']);
ok('1b · arrastra la fecha de la cabecera', B.filas.length === 2, B.filas.length);
ok('1b · fecha heredada correcta', B.filas[0].fecha === '2026-10-18', B.filas[0].fecha);
ok('1b · jornada heredada de la cabecera', B.filas[0].jornada === 5, B.filas[0].jornada);
// 🔴 EL PARTIDO ENTRE OTROS DOS EQUIPOS NO ES MÍO Y NO ENTRA.
ok('1b · descarta el partido ajeno del grupo', B.resumen.ajenas === 1, B.resumen);
ok('1b · y lo dice en el resumen (no lo esconde)', B.resumen.ajenas > 0);

// ── 1c · Calendario de UN equipo: sin par, con marca casa/fuera ──────
const C = corre(`
MI CALENDARIO - TEMPORADA 2026/27
J1  13/09  10:00  U.D. Rival Norte (Casa)
J2  20/09  12:30  Atletico San Juan (Fuera)
J3  27/09  10:00  Racing de la Vega (Casa)
`);
ok('1c · lee el formato de un solo equipo', C.filas.length === 3, C.filas.length);
ok('1c · la marca (Casa) decide la localía', C.filas[0].local === true);
ok('1c · la marca (Fuera) también', C.filas[1].local === false);
// ⚠️ Si la marca no se QUITA, el rival se guarda como «Rival Norte (Casa)» y
// ese paréntesis viaja hasta la casilla que ven todos los entrenadores.
ok('1c · el rival no arrastra la marca', C.filas[0].rival === 'U.D. Rival Norte', C.filas[0].rival);
// ⚠️ El TÍTULO del documento tiene un " - " y entraba a la votación de nombres:
// el motor llegó a concluir que el club se llamaba "MI CALENDARIO".
ok('1c · el titulo no se cuela como equipo', !/MI CALENDARIO/i.test(C.propio.nombre || ''), C.propio.nombre);

// ── 1d · Mes en letra, sin año, y en catalán ─────────────────────────
const D = corre(`
JORNADA 1
8 de setembre    C.D. Ejemplo - CF Montgat        18:00
JORNADA 2
15 setembre      UE Sant Andreu - C.D. Ejemplo    12:00
`);
ok('1d · mes escrito en letra', D.filas.length === 2, D.filas.length);
ok('1d · en catalan tambien', D.filas[0].fecha === '2026-09-08', D.filas[0].fecha);
ok('1d · deduce el año de la temporada', D.filas[1].fecha === '2026-09-15', D.filas[1].fecha);

// ⚠️ El año de un mes suelto depende de la TEMPORADA, no del año en curso:
// sin esto, la segunda vuelta entera se guardaría nueve meses antes.
ok('1d · agosto→diciembre van al año de inicio', P.anioDeTemporada(9, 2026) === 2026);
ok('1d · enero→junio van al SIGUIENTE', P.anioDeTemporada(2, 2026) === 2027);

// ── 1e · 🔴 UN CALENDARIO DE VARIAS PÁGINAS ──────────────────────────
//  Una temporada de 22 o 30 jornadas NO cabe en una hoja: el PDF de la
//  federación trae 3, 4 o 5. Y todo PDF reutiliza las MISMAS alturas en
//  todas sus hojas: la primera fila de la página 2 está a la misma `y` que
//  la primera fila de la página 1.
//
//  `agruparEnLineas` agrupaba SÓLO por `y`. Resultado: las hojas se
//  superponían unas sobre otras y un calendario de 4 páginas se reconstruía
//  como UNA con las cuatro encima —«16:0012:30 Estrella CFAtletico Sur --
//  UD Rival NorteEstrella CF»—. De ahí salían tres partidos sueltos en vez
//  de la temporada entera. Ésta es la prueba que lo mide de verdad: si esto
//  se rompe otra vez, la importación vuelve a perder el 75% del año.
const _fr = [];
const _fila = (pag, y, cols) => cols.forEach(c =>
    _fr.push({ str: c.t, x: c.x, y, w: String(c.t).length * 5, pagina: pag }));
// Mismas coordenadas exactas en las dos páginas, como en un PDF real.
[1, 2, 3].forEach(pag => {
    _fila(pag, 700, [{ t: 'JORNADA ' + pag + ' - 1' + pag + '/09/2026', x: 50 }]);
    _fila(pag, 680, [{ t: '16:00', x: 50 }, { t: 'C.D. Ejemplo', x: 120 },
                     { t: '-', x: 250 }, { t: 'UD Rival ' + pag, x: 270 }]);
});
const M = P.agruparEnLineas(_fr);
ok('1e · no apila las páginas unas sobre otras', M.length === 6, M.length);
ok('1e · cada línea sabe de qué página es',
   M.filter(l => l.pagina === 3).length === 2, M.map(l => l.pagina).join(','));
ok('1e · ninguna línea mezcla dos jornadas',
   !M.some(l => /JORNADA \d[\s\S]*JORNADA \d/.test(l.texto)),
   M.map(l => l.texto).join(' || '));
const MI = P.interpretar(M, { misNombres: MIOS, inicioTemporada: 2026 });
ok('1e · salen los partidos de TODAS las páginas', MI.filas.length === 3, MI.filas.length);
ok('1e · y en verde, no en rojo', MI.resumen.verde === 3, MI.resumen);

// ── 1f · 🔴🔴 LA TABLA SIN GUION, CON LAS COLUMNAS APRETADAS ─────────
//  El calendario oficial de la federación es una TABLA:
//
//      CAMPO                 HORA    LOCAL                    VISITANTE
//      MUNICIPAL EL PRADO    17:00   CD SANTA MARIA DEL ...   ESTRELLA CF
//
//  No hay guion, ni "vs": lo único que separa a los dos equipos es blanco.
//  `_partirEnDos` no encuentra separador en NINGUNA línea, y el reparto por
//  el hueco más ancho de una fila SUELTA (`_partirPorColumnas`, umbral 12 pt)
//  sólo acierta cuando un nombre corto deja hueco de sobra. Con nombres de
//  club largos —que es lo normal— el hueco real baja de 12 y la fila se cae
//  ENTERA y EN SILENCIO. De ahí "sólo detecta 3 partidos sueltos".
//
//  🔑 La columna no se ve en una fila, se ve en la PÁGINA: mirando todas las
//  filas a la vez queda una calle vertical por la que no pasa ni una letra.
{
    const PX = 4.6, LARGOS = [
        'CLUB DEPORTIVO SANTA MARIA DEL PARAMO', 'ATLETICO SAN JUAN DE LA ARENA',
        'UNION DEPORTIVA COSTA DEL AZAHAR', 'RACING CLUB DE LA VEGA BAJA',
        'CD VILLANUEVA DEL RIO Y MINAS'];
    const ANCHO = 37 * PX;                       // la columna la fija el nombre más largo
    const X = { hora: 60, local: 100, visit: 100 + ANCHO + 5 };   // ⚠️ calle de 5 pt
    const fr = [];
    let y = 700;
    for (let j = 1; j <= 20; j++) {
        fr.push({ str: 'JORNADA ' + j + ' - ' + String(1 + (j % 28)).padStart(2, '0') + '/11/2026',
                  x: 40, y, w: 120, pagina: 1 });
        y -= 15;
        const local = LARGOS[j % LARGOS.length];  // el LOCAL siempre largo: el hueco se queda en 5
        fr.push({ str: '17:00',        x: X.hora,  y, w: 5 * PX, pagina: 1 });
        fr.push({ str: local,          x: X.local, y, w: local.length * PX, pagina: 1 });
        fr.push({ str: 'C.D. Ejemplo', x: X.visit, y, w: 12 * PX, pagina: 1 });
        y -= 15;
    }
    const L = P.agruparEnLineas(fr);
    const T = P.interpretar(L, { misNombres: MIOS, inicioTemporada: 2026 });

    ok('1f · 🔴🔴 la tabla apretada NO pierde jornadas', T.filas.length === 20, T.filas.length);
    ok('1f · y ninguna se cae sin pareja', (T.resumen.sinPar || 0) === 0, T.resumen);
    ok('1f · salgo el SEGUNDO, así que juego FUERA', T.resumen.fuera === 20, T.resumen);
    ok('1f · el rival es el equipo largo, no un trozo suyo',
       T.filas[0].rival === LARGOS[1], T.filas[0].rival);

    // ⚠️ LA MEDIDA QUE PRUEBA QUE EL ARREGLO ES EL QUE CREO. Con el umbral de
    // calle antiguo (6 pt) la de 5 pt no se ve, y vuelven a caerse filas.
    const conUmbralViejo = P.interpretar(L, { misNombres: MIOS, inicioTemporada: 2026, minCalle: 6 });
    ok('1f · ⚠️ y con el umbral de calle viejo se perdían de verdad',
       conUmbralViejo.filas.length < 20, conUmbralViejo.filas.length);

    // 🔑 La calle estrecha sólo es fiable con filas suficientes: con pocas, un
    // hueco entre dos palabras pasaría por columna y partiría un nombre.
    ok('1f · 🔑 con muy pocas filas NO se fía de una calle estrecha',
       P._callesDe([{ items: [{ x: 0, w: 10 }, { x: 15, w: 10 }] }]).length === 0);
}

// ════════════════════════════════════════════════════════════════════
//  1h · 🔑🔑 EL DOCUMENTO REAL · Fútbol Las Palmas (tFPDF)
// ════════════════════════════════════════════════════════════════════
//  Estos fragmentos NO están inventados: salen tal cual del PDF oficial del
//  Juvenil del Estrella CF que aportó el autor (2 páginas, 30 jornadas), con
//  sus coordenadas y sus anchuras exactas. Es el formato estándar de todos
//  los calendarios que la plataforma de la federación genera.
//
//  🔑🔑 LO QUE ENSEÑA ESTE DOCUMENTO, Y QUE NINGUNA MAQUETA MÍA VIO:
//
//   1. Los huecos entre columnas NO están vacíos: el generador mete un
//      fragmento de espacios CON ANCHURA que encaja al milímetro ("La Garita"
//      acaba en 263,6 y el blanco va de 263,6 a 343,0). El documento marca
//      sus propias columnas, y tirar esos blancos era tirar el mapa.
//   2. Hay una FILA DE CABECERA que dice qué es cada columna.
//
//  Sin las dos cosas, el motor tomaba el NÚMERO DE JORNADA por un equipo:
//  el autor recibió tres partidos cuyos rivales se llamaban "11", "19" y
//  "26". Con ellas salen las 30 jornadas, en verde y sin tocar nada.
{
    const F = [
        [1,529.9,[{s:"",x:20.9,w:0.0},{s:"JOR",x:20.9,w:20.6},{s:" ",x:41.5,w:22.1},{s:"FECHA",x:63.6,w:34.4},{s:" ",x:98.0,w:24.8},{s:"HORA",x:122.8,w:29.4},{s:" ",x:152.2,w:74.1},{s:"LOCAL",x:226.3,w:34.4},{s:" ",x:260.8,w:82.2},{s:"VISITANTE",x:343.0,w:52.2},{s:" ",x:395.2,w:91.4},{s:"ESTADIO",x:486.6,w:44.5}]],
        [1,505.8,[{s:"",x:28.4,w:0.0},{s:"1",x:28.4,w:5.6},{s:" ",x:34.0,w:21.3},{s:"11-09-2026",x:55.2,w:51.1},{s:" ",x:106.4,w:12.7},{s:"21:00:00",x:119.1,w:38.9},{s:" ",x:158.0,w:64.5},{s:"La Garita",x:222.5,w:41.1},{s:" ",x:263.6,w:79.4},{s:"Estrella CF",x:343.0,w:49.4},{s:" ",x:392.4,w:58.3},{s:"Las Remudas",x:450.7,w:61.7}]],
        [1,466.1,[{s:"3",x:28.4,w:5.6},{s:" ",x:34.0,w:21.3},{s:"26-09-2026",x:55.2,w:51.1},{s:" ",x:106.4,w:12.7},{s:"12:00:00",x:119.1,w:38.9},{s:" ",x:158.0,w:69.0},{s:"La Oliva",x:226.9,w:36.7},{s:" ",x:263.6,w:79.4},{s:"Estrella CF",x:343.0,w:49.4},{s:" ",x:392.4,w:58.3},{s:"La Oliva",x:450.7,w:36.7}]],
        [1,386.8,[{s:"7",x:28.4,w:5.6},{s:" ",x:34.0,w:21.3},{s:"24-10-2026",x:55.2,w:51.1},{s:" ",x:106.4,w:12.7},{s:"11:00:00",x:119.1,w:38.9},{s:" ",x:158.0,w:45.6},{s:"Juv. Marítima",x:203.6,w:60.0},{s:" ",x:263.6,w:79.4},{s:"Estrella CF",x:343.0,w:49.4},{s:" ",x:392.4,w:58.3},{s:"Ciu. Deportiva",x:450.7,w:63.3}]],
        [1,307.4,[{s:"11",x:25.6,w:11.1},{s:" ",x:36.7,w:18.5},{s:"20-11-2026",x:55.2,w:51.1},{s:" ",x:106.4,w:12.7},{s:"21:00:00",x:119.1,w:38.9},{s:" ",x:158.0,w:56.2},{s:"Estrella CF",x:214.2,w:49.5},{s:" ",x:263.6,w:79.4},{s:"Maspalomas",x:343.0,w:56.7},{s:" ",x:399.7,w:51.0},{s:"Las Palmitas",x:450.7,w:57.2}]],
        [2,741.1,[{s:"26",x:25.6,w:11.1},{s:" ",x:36.7,w:18.5},{s:"09-04-2027",x:55.2,w:51.1},{s:" ",x:106.4,w:12.7},{s:"21:00:00",x:119.1,w:38.9},{s:" ",x:158.0,w:49.0},{s:"Maspalomas",x:206.9,w:56.7},{s:" ",x:263.6,w:79.4},{s:"Estrella CF",x:343.0,w:49.4},{s:" ",x:392.4,w:58.3},{s:"Maspalomas 1",x:450.7,w:65.0}]],
    ];
    const frag = [];
    F.forEach(([pagina, y, its]) => its.forEach(it =>
        frag.push({ str: it.s, x: it.x, y, w: it.w, pagina })));

    const LR = P.agruparEnLineas(frag);

    // 🔑 1 · Los blancos anchos parten la fila en CAMPOS.
    ok('1h · la fila se parte en los 6 campos de la tabla',
       LR[1].campos.length === 6, LR[1].campos);
    ok('1h · y son los campos correctos, sin mezclarse',
       JSON.stringify(LR[1].campos) ===
       JSON.stringify(['1', '11-09-2026', '21:00:00', 'La Garita', 'Estrella CF', 'Las Remudas']),
       LR[1].campos);
    // ⚠️ Y `items`/`texto` siguen sin los blancos: nada de lo anterior cambia.
    ok('1h · ⚠️ `items` sigue trayendo sólo lo que tiene tinta',
       LR[1].items.every(it => String(it.str).trim()), LR[1].items.length);

    // 🔑 2 · La cabecera dice qué columna es cuál.
    const cab = P.mapaDeCabecera(LR);
    ok('1h · 🔑🔑 se reconoce la fila de cabecera', !!cab, cab);
    ok('1h · y ubica LOCAL y VISITANTE donde están',
       cab && cab.idx.local === 3 && cab.idx.visitante === 4, cab && cab.idx);
    ok('1h · y también JOR, FECHA, HORA y ESTADIO',
       cab && cab.idx.jornada === 0 && cab.idx.fecha === 1 && cab.idx.hora === 2 && cab.idx.sede === 5,
       cab && cab.idx);

    const R = P.interpretar(LR, { misNombres: ['Estrella CF'], inicioTemporada: 2026 });
    ok('1h · lee las 5 jornadas del documento real', R.filas.length === 5, R.filas.length);
    ok('1h · por el camino de la cabecera, no por heurística', R.resumen.porCabecera === true);
    ok('1h · me reconoce con cobertura total', R.propio.cobertura === 100, R.propio);
    ok('1h · todas en verde', R.resumen.verde === 5, R.resumen);

    const j = (n) => R.filas.find(f => f.jornada === n);

    // 🔴 EL DEFECTO QUE REPORTÓ EL AUTOR: el número de jornada como rival.
    ok('1h · 🔴 ningún rival se llama como un número de jornada',
       !R.filas.some(f => /^\d+$/.test(String(f.rival || '').trim())),
       R.filas.map(f => f.rival));

    // 🔴 Y EL OTRO: la sede guardada como rival.
    ok('1h · 🔴 el rival es el equipo, no el estadio',
       j(1).rival === 'La Garita' && j(1).sede === 'Las Remudas',
       [j(1).rival, j(1).sede]);

    // ⚠️⚠️ LA JORNADA 3 ES LA PRUEBA DE FUEGO: «La Oliva» es a la vez el
    // EQUIPO LOCAL y el ESTADIO. Sin saber qué columna es cuál no hay forma
    // humana de distinguirlos, y cualquier heurística acierta o falla a suertes.
    ok('1h · ⚠️⚠️ «La Oliva» es equipo Y estadio a la vez, y se distingue',
       j(3).rival === 'La Oliva' && j(3).sede === 'La Oliva' && j(3).local === false,
       [j(3).rival, j(3).sede, j(3).local]);

    // Localía leída de la columna, no deducida.
    ok('1h · salgo en LOCAL → juego en CASA', j(11).local === true, j(11));
    ok('1h · salgo en VISITANTE → juego FUERA', j(1).local === false, j(1));
    ok('1h · la fecha, en ISO y con el año de la temporada',
       j(1).fecha === '2026-09-11' && j(26).fecha === '2027-04-09', [j(1).fecha, j(26).fecha]);
    ok('1h · la hora, sin los segundos', j(1).hora === '21:00', j(1).hora);

    // 🔑 La página 2 NO repite cabecera: sus filas entran por su FORMA.
    ok('1h · 🔑 la página 2 entra aunque no repita la cabecera',
       !!j(26) && j(26).rival === 'Maspalomas', j(26));

    // 🔴 `\b` en JavaScript es ASCII y una tilde le parece frontera de palabra:
    // el limpiador de días de semana se comía el "Mar" de «Juv. Marítima» y
    // guardaba «Juv. ítima». MEDIDO en la jornada 7 del documento real.
    ok('1h · 🔴 una tilde no parte el nombre del rival',
       j(7).rival === 'Juv. Marítima', j(7).rival);
    ok('1h · …y tampoco en otros nombres con día de la semana dentro',
       P.interpretar(P.lineasDeTexto(
           'J1 13/09/2026 10:00 C.D. Ejemplo - CD Domínguez'),
           { misNombres: MIOS, inicioTemporada: 2026 }).filas[0].rival === 'CD Domínguez');
}

// ── 1g · La sede no puede colarse como rival ─────────────────────────
{
    const T = P.interpretar(P.agruparEnLineas([
        { str: 'JORNADA 1 - 13/09/2026', x: 40, y: 700, w: 120, pagina: 1 },
        { str: 'CAMPO MUNICIPAL EL PRADO', x: 40,  y: 680, w: 110, pagina: 1 },
        { str: '16:00',                   x: 250, y: 680, w: 23,  pagina: 1 },
        { str: 'C.D. Ejemplo',            x: 300, y: 680, w: 55,  pagina: 1 },
        { str: 'UD Rival Norte',          x: 430, y: 680, w: 64,  pagina: 1 },
    ]), { misNombres: MIOS, inicioTemporada: 2026 });
    ok('1g · el rival es el equipo, no la instalación',
       T.filas.length === 1 && T.filas[0].rival === 'UD Rival Norte',
       T.filas.map(f => f.rival));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2 · LA BRÚJULA: QUIÉN SOY EN ESTE DOCUMENTO');
// ════════════════════════════════════════════════════════════════════
ok('2a · me reconoce por el nombre del club', A.propio.via === 'nombre-del-club', A.propio);
// 🔑 La segunda brújula: aunque la app NO sepa cómo me llama la federación, en
// el calendario de un equipo ese equipo juega TODAS las jornadas.
const E = corre(A ? `
Jornada 1   13/09/2026  10:00   C.D. Ejemplo - U.D. Rival Norte
Jornada 2   20/09/2026  12:30   Atletico San Juan - C.D. Ejemplo
Jornada 3   27/09/2026  10:00   C.D. Ejemplo - Racing de la Vega
` : '', ['Nombre Que No Aparece']);
ok('2b · sin conocer mi nombre, deduce el mas repetido', E.propio.via === 'mas-repetido', E.propio);
ok('2b · y acierta', /Ejemplo/.test(E.propio.nombre), E.propio.nombre);
ok('2b · con el rival y la localia bien', E.filas[1].local === false && /San Juan/.test(E.filas[1].rival));
// ⚠️ Y cuando NO puede saberlo, lo dice en vez de inventarlo.
const F = corre('sin partidos aqui\nsolo texto suelto', ['Nada']);
ok('2c · si no lo sabe, lo dice', F.propio.via === 'sin-determinar', F.propio);

// Comparar nombres tolera abreviaturas y acentos.
ok('2d · casa nombres abreviados', P.parecido('C.D. Ejemplo', 'CD EJEMPLO B') >= 0.5);
ok('2d · quita acentos al comparar', P.normalizarNombre('Alcalá') === 'ALCALA', P.normalizarNombre('Alcalá'));
ok('2d · no casa clubes distintos', P.parecido('C.D. Ejemplo', 'Racing de la Vega') < 0.5);

// ════════════════════════════════════════════════════════════════════
console.log('\n3 · LA NOTA DE CONFIANZA NO PUEDE MENTIR');
// ════════════════════════════════════════════════════════════════════
//  Es el corazón del trato con el usuario: si el verde miente, la tabla de
//  revisión deja de servir y se acaba guardando basura sin mirarla.
const G = corre(`
Jornada 1   13/09/2026          C.D. Ejemplo - U.D. Rival Norte
`);
ok('3a · sin hora NO es verde', G.filas[0].confianza === 'amarillo', G.filas[0]);
ok('3b · con todo, verde', A.filas[0].confianza === 'verde');
// Una jornada numerada por orden es una SUPOSICIÓN y no puede pasar por verde.
const H = corre(`
13/09/2026  10:00  C.D. Ejemplo - U.D. Rival Norte
20/09/2026  10:00  Atletico San Juan - C.D. Ejemplo
`);
ok('3c · jornada supuesta baja a amarillo', H.filas[0].confianza === 'amarillo', H.filas[0]);

// ════════════════════════════════════════════════════════════════════
console.log('\n4 · DÓNDE VIVE EL DATO (reglas y borrados ajenos)');
// ════════════════════════════════════════════════════════════════════
ok('4a · prefijo CALENDARIO__ en la ruta', /CAL_PREFIJO\s*=\s*'CALENDARIO__'/.test(TEMP));
ok('4b · cuelga de trainingPlans/{clubId}/weeks', /'trainingPlans',\s*clubId,\s*'weeks'/.test(TEMP));
// 🔑 Si esto falla, hay que desplegar reglas — y aquí no se pueden probar.
ok('4c · la regla comodin {weekKey} existe y cubre el id',
   /match \/trainingPlans\/\{clubId\}\/weeks\/\{weekKey\}/.test(RULES));
ok('4d · NO se crea coleccion nueva para el calendario',
   !/collection\(\s*[^)]*['"]calendarios?['"]/i.test(TEMP));
// ⚠️ TrainingSync.deleteWeek borra el id EXACTO: el prefijo lo pone a salvo.
ok('4e · el id nunca es una fecha pelada',
   /_calDocId\s*=?\s*\(?\s*mes\s*\)?\s*(=>|\{)[^\n]*CAL_PREFIJO/.test(TEMP) ||
   /return\s+CAL_PREFIJO\s*\+\s*mes/.test(TEMP));
// ⚠️ 11 documentos, uno por mes: Firestore no manda deltas.
ok('4f · once meses de temporada, agosto→junio',
   /CAL_MESES_TEMPORADA\s*=\s*\[8,\s*9,\s*10,\s*11,\s*12,\s*1,\s*2,\s*3,\s*4,\s*5,\s*6\]/.test(TEMP));
// ⚠️ merge:false — `partidos` es un mapa y Firestore FUSIONA mapas: con
// merge:true, una jornada aplazada nunca se iría y saldrían dos el mismo día.
ok('4g · se escribe con merge:false', /\{\s*merge:\s*false\s*\}/.test(TEMP));
ok('4h · al reimportar se limpian los meses anteriores', /mesesAnteriores/.test(TEMP));

// ════════════════════════════════════════════════════════════════════
console.log('\n5 · 🔴 EL CALENDARIO NO PISA AL DIRECTOR');
// ════════════════════════════════════════════════════════════════════
//  Decisión expresa del autor. Si esto se rompe, una importación puede borrar
//  ajustes de hora y de espacio hechos a mano semanas antes.
ok('5a · _cqPropuesta calla donde hay casilla escrita',
   /function _cqPropuesta[\s\S]{0,400}?st\.doc\.celdas\[filaId \+ '\|' \+ fecha\]\)\s*return null/.test(CQ));
ok('5b · fijar NO sobrescribe (pasa por _cqPropuesta)',
   /cqFijarPartidos[\s\S]{0,900}?_cqPropuesta\(fila\.id, fecha\)/.test(CQ));
ok('5c · hay aviso de discrepancia', /_cqConflictos/.test(CQ));
ok('5d · el aviso enseña LAS DOS versiones',
   /se respeta lo que has puesto t[uú]/.test(CQ) && /el calendario:/.test(CQ));
// ⚠️ Una propuesta NO se guarda al pasar por la semana: si no, navegar por 30
// semanas crearía 30 documentos a espaldas del usuario.
ok('5e · la propuesta no entra en celdas hasta FIJAR',
   !/st\.calendario\[[^\]]*\]\s*;?\s*st\.doc\.celdas/.test(CQ));
ok('5f · fijar deja la semana SIN GUARDAR (no escribe solo)',
   /cqFijarPartidos[\s\S]{0,900}?st\.sucio = true/.test(CQ));
// 🎯 El coordinador de una modalidad no toca la otra, tampoco aquí.
ok('5g · fijar respeta el alcance del coordinador',
   /cqFijarPartidos[\s\S]{0,400}?_cqFilasVisibles/.test(CQ));
ok('5h · el gestor de calendarios tambien',
   /_cqFilasVisibles/.test(TEMP));

// ════════════════════════════════════════════════════════════════════
console.log('\n6 · pdf.js: ALOJADO, PEREZOSO Y FUERA DEL PRECACHE');
// ════════════════════════════════════════════════════════════════════
ok('6a · la biblioteca esta en el proyecto',
   fs.existsSync(path.join(ROOT, 'js/vendor/pdfjs/pdf.min.js')));
ok('6b · y su worker', fs.existsSync(path.join(ROOT, 'js/vendor/pdfjs/pdf.worker.min.js')));
// ⛔ v543 se revirtió por depender de un CDN: no se repite.
// ⚠️ Se mide la RUTA, no la palabra: la primera versión de esta aserción
// buscaba /cdn/i en todo el fichero y saltaba con mi propio comentario que
// dice «NO EN UN CDN». Un guard que se dispara con su propia documentación es
// ruido, y el ruido se acaba silenciando.
ok('6c · la ruta de pdf.js es local, no una URL',
   /CAL_PDFJS\s*=\s*'js\/vendor\/pdfjs\//.test(TEMP) &&
   /CAL_PDFJS_WRK\s*=\s*'js\/vendor\/pdfjs\//.test(TEMP));
ok('6d · se carga solo al arrastrar un PDF (perezoso)',
   /_calCargarPdfJs/.test(TEMP) && !/<script[^>]*pdf\.min\.js/.test(INDEX));
// ⛔ `cache.addAll` es ATÓMICO (v452): 1,5 MB que fallen tumban la precarga.
// Se mira una ENTRADA de la lista ('./js/vendor/pdfjs…'), no la mención: el
// comentario que explica por qué NO está también contiene la ruta.
ok('6e · pdf.js NO esta en el precache del SW', !/'\.\/js\/vendor\/pdfjs/.test(SW));
ok('6f · los dos modulos nuevos SI estan en el precache',
   /calendario-parser\.js/.test(SW) && /calendario-temporada\.js/.test(SW));
ok('6g · index.html enlaza los dos modulos',
   /calendario-parser\.js/.test(INDEX) && /calendario-temporada\.js/.test(INDEX));
// ⚠️ Soltar un PDF sin cancelar el evento lo ABRE en la pestaña y tira la sesión.
ok('6h · se cancela el arrastre por defecto',
   /dragenter/.test(TEMP) && /preventDefault/.test(TEMP));
// 🔑 Un PDF escaneado no tiene texto: hay que DECIRLO, no fingir que falló.
ok('6i · avisa del PDF escaneado con todas las letras', /imagen escaneada/.test(TEMP));
// El plan B que eligió el autor.
ok('6j · existe la via de pegar el texto', /calInterpretarTexto/.test(TEMP) && /lineasDeTexto/.test(TEMP));

// ════════════════════════════════════════════════════════════════════
console.log('\n7 · NADA SE GUARDA SIN QUE UNA PERSONA LO VEA');
// ════════════════════════════════════════════════════════════════════
//  Es la condición que permite poner un parser heurístico en manos de un club
//  desconocido: no que no se equivoque, sino que cuando duda lo diga.
ok('7a · hay tabla de revision editable', /calEditar/.test(TEMP) && /_calPintarRevision/.test(TEMP));
ok('7b · guardar es un paso APARTE de interpretar', /calGuardarTemporada/.test(TEMP));
ok('7c · las filas incompletas no se guardan',
   /f\.fecha && f\.rival && f\.local != null/.test(TEMP));
ok('7d · y se avisa de cuantas se quedan fuera', /NO se guardar[aá]n/.test(TEMP));
ok('7e · se puede corregir quien soy y recalcular', /calFijarPropio/.test(TEMP) && /reinterpretarCon/.test(P ? TEMP : TEMP));
// 🧠 El perfil aprendido es lo que hace que esto escale sin tocar código.
ok('7f · se aprende un perfil por federacion', /perfiles\[/.test(TEMP) && /huella/.test(TEMP));
ok('7g · la huella no lleva la fecha ni el año',
   /replace\(\/\\d\+\/g, '#'\)/.test(PARSER) || /\\d\+\/g,\s*'#'/.test(PARSER));

// ════════════════════════════════════════════════════════════════════
console.log('\n8 · EL CUADRANTE SIGUE EN PIE SI ESTO FALLA');
// ════════════════════════════════════════════════════════════════════
//  Esta pantalla existía antes que el calendario y no puede caerse por él.
ok('8a · la carga del calendario va en try', /try \{[\s\S]{0,300}?calPartidosDeSemana[\s\S]{0,200}?catch/.test(CQ));
ok('8b · y comprueba que el modulo existe',
   /typeof window\.calPartidosDeSemana === 'function'/.test(CQ));
// Dentro de _calLeerMes, y en concreto: el catch NO relanza y devuelve {}.
ok('8c · un error de lectura devuelve {} en vez de propagarse',
   /_calLeerMes[\s\S]*?catch \(e\)[\s\S]*?return \{\};[\s\S]*?\n\}/.test(TEMP) &&
   !/_calLeerMes[\s\S]*?catch \(e\)[\s\S]{0,600}?throw /.test(TEMP));
ok('8d · la clave del calendario es la MISMA que la de las casillas',
   /filaId \+ '\|' \+ fecha/.test(TEMP) && /fila\.id \+ '\|' \+ fecha/.test(CQ));
ok('8e · una semana toca 1 o 2 meses, no 11', /Array\.from\(new Set\(fechas\.map\(_calMesDe\)\)\)/.test(TEMP));
ok('8f · hay cache de mes para no releer al pasar de semana', /_calState\.cache/.test(TEMP));
ok('8g · la cache se invalida al escribir', /delete window\._calState\.cache\[/.test(TEMP));

// ════════════════════════════════════════════════════════════════════
console.log('\n10 · LA TABLA WEB DEL PORTAL DEL FEDERADO (v655)');
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-09-01) + capturas 9809/9810: el
//  importador tenía que admitir, además del PDF oficial de la FIFLP, la tabla
//  del Portal del Federado — Jornada · Fecha · Hora · Equipo Casa · Equipo
//  Fuera · Campo · Resultado.
//
//  🚨 LO QUE HACÍA ANTES, medido con estos mismos datos: de 5 jornadas
//  pegadas salían 2 filas, los dos rivales mal («1 JOVERO», «13 ARINAGA,
//  C.D. MAJORERAS») y una localía invertida. No daba error: daba basura con
//  pinta de buena, que es lo que este bloque existe para que no vuelva.
//
//  🔑 Y SE EJECUTA EL MOTOR, no se mira su código. Comprobar que el fichero
//  contiene la palabra "tabulador" no dice si sabe leer una tabla.
{
    const CAB = ['Jornada', 'Fecha', 'Hora', 'Equipo Casa', 'Equipo Fuera', 'Campo', 'Resultado'];
    // Filas REALES de sus capturas, con los tres casos que rompían antes:
    // guion pegado dentro del nombre, campo sin la palabra "campo" delante, y
    // el número de jornada suelto en la primera columna.
    const FIL = [
        ['1',  '25-09-2026', '20:30', 'JOVERO-LAS ROSAS, C.D.',                'ARINAGA, C.D.',                  'LAS ROSAS',                     '-'],
        ['2',  '02-10-2026', '20:30', 'ARINAGA, C.D.',                         'VELEZ, U.D. LOS',                'MUNICIPAL DE ARINAGA',          '-'],
        ['3',  '08-10-2026', '21:00', 'CERRUDA SANTA LUCIA DE TIRAJANA, C.D.', 'ARINAGA, C.D.',                  'CAMPO MUNICIPAL DE VECINDARIO', '-'],
        ['13', '18-12-2026', '20:30', 'ARINAGA, C.D.',                         'MAJORERAS-GUAYADEQUE, C.F. LAS', 'MUNICIPAL DE ARINAGA',          '-'],
        ['30', '09-05-2027', '11:00', 'UNION MARINA, C.F.',                    'ARINAGA, C.D.',                  'MANUEL MARTIN "NAÑO"',          '-'],
    ];
    const MIAS = ['ARINAGA, C.D.'];
    const lee = (txt) => P.interpretar(P.lineasDeTexto(txt), { misNombres: MIAS, inicioTemporada: 2026 });
    const TITULO = 'LIGA SEGUNDA REGIONAL GRAN CANARIA - GRUPO 3\n';

    // ── 10a · Lo que copia un navegador de una tabla HTML: TABULADORES ──
    const A = lee(TITULO + [CAB].concat(FIL).map(f => f.join('\t')).join('\n'));
    ok('10a · 🔑🔑 el tabulador ya no se aplasta: hay campos',
       P.lineasDeTexto('uno\tdos\ttres')[0].campos.length === 3,
       P.lineasDeTexto('uno\tdos\ttres')[0].campos);
    ok('10a · entran las 5 jornadas', A.filas.length === 5, A.filas.length);
    ok('10a · y por el camino de la CABECERA, que es el que no adivina',
       A.resumen.porCabecera === true, A.resumen);
    ok('10a · las 5 en verde', A.resumen.verde === 5, A.resumen);

    // El `|| {}` no es adorno: sin él, cuando esto se rompe el guard REVIENTA
    // en la primera aserción y esconde las otras cinco, que son las que dicen
    // qué se rompió exactamente.
    const jA = (n) => A.filas.find(f => f.jornada === n) || {};
    // 🔴 EL DEFECTO MEDIDO: el número de jornada acababa dentro del rival.
    ok('10a · 🔴 ningún rival empieza por el número de jornada',
       !A.filas.some(f => /^\d/.test(String(f.rival || '').trim())),
       A.filas.map(f => f.rival));
    // 🔴 Y EL OTRO: el guion PEGADO partía el nombre por la mitad.
    ok('10a · 🔴 «JOVERO-LAS ROSAS» no se parte por su propio guion',
       /^JOVERO-LAS ROSAS/.test(jA(1).rival), jA(1).rival);
    ok('10a · ni «MAJORERAS-GUAYADEQUE»',
       /^MAJORERAS-GUAYADEQUE/.test(jA(13).rival), jA(13).rival);
    // 🔴 Y LA LOCALÍA, que se leía al revés: la 13 se juega EN CASA.
    ok('10a · la jornada 13 es en CASA (columna «Equipo Casa»)', jA(13).local === true, jA(13));
    ok('10a · y la 1 es FUERA', jA(1).local === false, jA(1));
    // ⚠️ «MUNICIPAL DE ARINAGA» no lo reconocía nadie como instalación.
    ok('10a · el campo va en su casilla, no pegado al rival',
       jA(13).sede === 'MUNICIPAL DE ARINAGA' && !/MUNICIPAL/.test(jA(13).rival),
       [jA(13).rival, jA(13).sede]);
    ok('10a · la fecha, en ISO y con el año de cada mitad de temporada',
       jA(1).fecha === '2026-09-25' && A.filas.find(f => f.jornada === 30).fecha === '2027-05-09');

    // ── 10b · La misma tabla alineada con blancos anchos ─────────────
    const anchos = [9, 13, 8, 40, 34, 32, 10];
    const B = lee([CAB].concat(FIL).map(f => f.map((c, i) => c.padEnd(anchos[i])).join('')).join('\n'));
    ok('10b · alineada con espacios entra igual', B.filas.length === 5 && B.resumen.verde === 5, B.resumen);

    // ── 10c · El copiado que baja UNA CELDA POR RENGLÓN ──────────────
    const C = lee(TITULO + CAB.concat(...FIL).join('\n') + '\nMostrando 30 de 30\n');
    ok('10c · se repliega la tabla que baja en vertical',
       C.filas.length === 5 && C.resumen.porCabecera === true, C.resumen);
    ok('10c · con los mismos rivales que por tabulador',
       JSON.stringify(C.filas.map(f => f.rival)) === JSON.stringify(A.filas.map(f => f.rival)),
       C.filas.map(f => f.rival));
    // ⚠️ Y el pie de la tabla NO se pliega como si fuera un partido.
    ok('10c · el pie de página no se convierte en partido',
       !C.filas.some(f => /Mostrando/i.test(f.rival + ' ' + f.sede)), C.filas.map(f => f.rival));

    // ── 10d · 🚨 SIN CABECERA NO SE PLIEGA NADA ──────────────────────
    //  Plegar por un ciclo inventado no daría cero partidos —eso sería
    //  inofensivo—: daría una temporada entera de partidos falsos.
    const D = P.lineasDeTexto(['uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez'].join('\n'));
    ok('10d · 🚨 una lista sin cabecera se queda como está', D.length === 10, D.length);

    // ── 10e · La cabecera del portal, reconocida entera ──────────────
    const cabP = P.mapaDeCabecera(P.lineasDeTexto(CAB.join('\t')));
    ok('10e · «Equipo Casa» es la columna del local', cabP && cabP.idx.local === 3, cabP && cabP.idx);
    ok('10e · «Equipo Fuera» la del visitante', cabP && cabP.idx.visitante === 4, cabP && cabP.idx);
    ok('10e · y «Resultado» no estorba aunque no sirva para nada', !!cabP, cabP);
}

// ── 10f · La pantalla ────────────────────────────────────────────────
//  🔑 Anclado en CÓDIGO EJECUTABLE, no en rótulos: en v647 cuatro
//  comprobaciones de una misma ronda se dispararon con sus propios
//  comentarios explicando el arreglo.
//  ⚠️ Se busca la etiqueta EMITIDA —abre comilla simple y `<details`—, no la
//  mención: la nota que explica por qué se sacó de ahí nombra `<details>` y
//  con un ancla floja se cazaría a sí misma. Es literalmente lo que pasó
//  cuatro veces en v647.
ok('10f · la caja de pegar texto ya no vive dentro de un <details>',
   !/'<details/.test(TEMP) && /id="cal-texto"/.test(TEMP));
ok('10f · una imagen se reconoce como imagen', /\^image\\\//.test(TEMP));
ok('10f · y un .txt/.csv se lee y entra por la vía de texto',
   /txt\|csv/.test(TEMP) && /file\.text\(\)/.test(TEMP));

// ════════════════════════════════════════════════════════════════════
console.log('\n11 · LA CAPTURA DE PANTALLA (OCR, v656)');
// ════════════════════════════════════════════════════════════════════
//  Segundo encargo del autor sobre lo mismo (2026-09-01): que la zona de
//  importación acepte la captura igual que acepta el PDF.
//
//  🔑🔑 ESTE FIXTURE NO ES SINTÉTICO. Son las palabras y las cajas que el OCR
//  sacó DE VERDAD de su captura 9810 —jornadas 12 a 19, tal cual, con sus
//  coordenadas reales—. Un maquetado inventado por mí probaría que mi idea de
//  una tabla se lee bien, que es exactamente la trampa de v614: tres rondas
//  de maquetas sintéticas y el PDF real lo cerró en diez minutos.
//
//  ⚠️ Y ES LA MITAD SIN CABECERA de la tabla, que es el caso difícil: hay que
//  deducir qué columna es el local, cuál el visitante y cuál el campo sin que
//  el documento lo diga en ninguna parte.
{
    const CRUDO = [
    [["12",31,44,177,187],["12-12-2026",131,197,168,196],["16:00",254,284,177,187],["UNION",328,369,177,187],["VECINDARIO",373,450,168,196],["ATLETICO",457,519,168,196],["ARINAGA,",736,798,177,189],["C.D.",802,824,177,187],["CAMPO",1145,1192,177,187],["MUNICIPAL",1197,1266,177,187],["DE",1270,1287,177,187],["VECINDARIO",1291,1372,177,187],["-",1538,1542,183,184]],
    [["13",31,44,218,228],["18-12-2026",131,197,209,237],["20:30",253,284,218,228],["ARINAGA,",327,389,218,230],["C.D.",394,415,218,228],["MAJORERAS-GUAYADEQUE,",737,914,218,230],["C.F.",919,939,218,228],["LAS",946,969,218,228],["MUNICIPAL",1146,1215,218,228],["DE",1219,1233,218,228],["ARINAGA",1238,1298,218,228],["-",1538,1542,224,225]],
    [["14",31,45,258,268],["08-01-2027",131,197,249,277],["21:00",253,284,258,268],["VALDECASAS,",327,416,258,270],["C.D.",421,443,258,268],["ARINAGA,",736,798,258,270],["C.D.",802,824,258,268],["EL",1146,1161,258,268],["CALERO",1164,1217,258,268],["-",1538,1542,264,265]],
    [["15",31,44,299,309],["15-01-2027",131,197,290,318],["20:30",253,284,299,309],["ARINAGA,",327,389,299,311],["C.D.",394,415,299,309],["UNION",737,778,299,309],["MARINA,",782,835,299,311],["C.F.",840,860,299,309],["MUNICIPAL",1146,1215,299,309],["DE",1219,1233,299,309],["ARINAGA",1238,1298,299,309],["-",1538,1542,305,306]],
    [["16",31,44,339,349],["22-01-2027",126,197,330,358],["20:30",253,284,339,349],["ARINAGA,",327,389,339,351],["C.D.",394,415,339,349],["JOVERO-LAS",736,818,339,349],["ROSAS,",823,871,339,351],["C.D.",875,897,339,349],["MUNICIPAL",1146,1215,339,349],["DE",1219,1233,339,349],["ARINAGA",1238,1298,339,349],["-",1538,1542,345,346]],
    [["17",31,44,380,390],["29-01-2027",130,197,371,399],["20:30",253,284,380,390],["VELEZ,",327,372,380,392],["U.D.",377,398,380,390],["LOS",406,431,380,390],["ARINAGA,",736,798,380,392],["C.D.",802,824,380,390],["MONTAÑA",1146,1209,377,390],["LOS",1212,1238,380,390],["VELEZ",1241,1283,380,390],["-",1538,1542,386,387]],
    [["18",31,44,420,430],["05-02-2027",131,197,411,439],["20:30",253,284,420,430],["ARINAGA,",327,389,420,432],["C.D.",394,415,420,430],["CERRUDA",737,801,420,430],["SANTA",804,846,420,430],["LUCIA",849,885,412,440],["DE",891,906,420,430],["TIRAJANA,",911,977,420,432],["C.D.",982,1003,420,430],["MUNICIPAL",1146,1215,420,430],["DE",1219,1233,420,430],["ARINAGA",1238,1298,420,430],["-",1538,1542,426,427]],
    [["19",31,44,461,471],["12-02-2027",131,197,452,480],["21:00",253,284,461,471],["OJOS",328,363,461,471],["DE",367,384,461,471],["GARZA,",389,436,461,473],["C.D.",441,462,461,471],["ARINAGA,",736,798,461,473],["C.D.",802,824,461,471],["OJOS",1145,1180,461,471],["DE",1185,1202,461,471],["GARZA",1206,1251,461,471],["-",1538,1542,467,468]],
    ];
    const deOCR = (crudo) => crudo.map(f => ({
        palabras: f.map(p => ({ texto: p[0], x0: p[1], x1: p[2], y0: p[3], y1: p[4] })),
    }));

    const L = P.lineasDeOCR(deOCR(CRUDO));
    ok('11a · cada fila sale con el MISMO número de campos',
       L.length === 8 && new Set(L.map(l => l.campos.length)).size === 1,
       L.map(l => l.campos.length));

    const R = P.interpretar(L, { misNombres: ['ARINAGA, C.D.'], inicioTemporada: 2026 });
    ok('11b · entran las 8 jornadas de la captura', R.filas.length === 8, R.filas.length);
    // 🔑 Sin fila de cabecera: las columnas se deducen por su CONTENIDO.
    ok('11b · 🔑🔑 y por el camino de columnas, no por heurística',
       R.resumen.porCabecera === true, R.resumen);
    ok('11b · las 8 en verde', R.resumen.verde === 8, R.resumen);

    const j = (n) => R.filas.find(f => f.jornada === n) || {};
    // 🔴 LA LOCALÍA, que es lo que decide el color de la casilla del cuadrante.
    ok('11c · la 13 es en casa y la 12 fuera',
       j(13).local === true && j(12).local === false, [j(12).local, j(13).local]);
    ok('11c · y la 17 fuera, la 18 en casa',
       j(17).local === false && j(18).local === true, [j(17).local, j(18).local]);
    // ⚠️⚠️ LA TRAMPA MEDIDA: el club se llama como el pueblo donde juega, así
    // que «MUNICIPAL DE ARINAGA» —el CAMPO— se parece a «ARINAGA, C.D.» tanto
    // como la columna del equipo, y sale en MÁS filas. Elegir «la columna
    // donde más aparezco» se lleva la sede y deja los rivales siendo campos.
    ok('11d · 🔴 el rival es el equipo, no el campo',
       j(13).rival === 'MAJORERAS-GUAYADEQUE, C.F. LAS' && /MUNICIPAL DE ARINAGA/.test(j(13).sede),
       [j(13).rival, j(13).sede]);
    ok('11d · y en un partido fuera, igual',
       j(14).rival === 'VALDECASAS, C.D' && j(14).sede === 'EL CALERO',
       [j(14).rival, j(14).sede]);
    ok('11d · ningún rival lleva el nombre de una instalación',
       !R.filas.some(f => /^(CAMPO|MUNICIPAL)\b/i.test(String(f.rival || ''))),
       R.filas.map(f => f.rival));
    ok('11e · las fechas y las horas, en su sitio',
       j(12).fecha === '2026-12-12' && j(12).hora === '16:00' &&
       j(19).fecha === '2027-02-12' && j(19).hora === '21:00',
       [j(12).fecha, j(12).hora, j(19).fecha, j(19).hora]);

    // ── 11f · 🚨 UNA JORNADA MAL LEÍDA NO PUEDE SALIR EN VERDE ───────
    //  La columna de la jornada es la más estrecha y es donde el OCR se
    //  equivoca: «12» leído como «1». Antes eso salía VERDE —«puedes pasar de
    //  largo»— porque `_confianza` sólo miraba que hubiera un número.
    const roto = deOCR(CRUDO);
    roto[0].palabras[0].texto = '1';    // 12 → 1, la errata real medida
    const RB = P.interpretar(P.lineasDeOCR(roto), { misNombres: ['ARINAGA, C.D.'], inicioTemporada: 2026 });
    const f12 = RB.filas.find(f => f.fecha === '2026-12-12') || {};
    ok('11f · 🚨 la jornada mal leída se corrige por su posición', f12.jornada === 12, f12);
    ok('11f · 🚨 y NO se queda en verde: se marca para revisar',
       f12.confianza === 'amarillo' && f12.jornadaSupuesta === true, f12);
    // ⚠️ Y lo demás no se toca: corregir de más sería el mismo defecto.
    ok('11f · las otras siete siguen en verde', RB.resumen.verde === 7, RB.resumen);

    // ── 11g · 🚨 SIN PRUEBAS SUFICIENTES, NO SE RESPONDE ─────────────
    //  Deducir las columnas decide la localía de una temporada entera. Con un
    //  recorte de tres filas no hay forma de saber cuál es el local.
    ok('11g · 🚨 con tres filas no se deduce nada',
       P.cabeceraPorContenido(P.lineasDeOCR(deOCR(CRUDO.slice(0, 3))), ['ARINAGA, C.D.'], 0.5) === null);
}

// ── 11h · El lector de imágenes, alojado y sin salir del aparato ─────
//  ⛔ v543 se revirtió entera por traer una biblioteca de un CDN, y v647
//  borró el OCR anterior porque mandaba la imagen FUERA del dispositivo.
//  Anclado en código ejecutable, no en las notas que explican todo esto.
ok('11h · el OCR se aloja en el proyecto, no en un CDN',
   /CAL_OCR_DIR\s*=\s*'js\/vendor\/tesseract\//.test(TEMP) &&
   /CAL_OCR_LIB\s*=\s*CAL_OCR_DIR/.test(TEMP));
ok('11h · ⛔ y NO viaja a ningún servicio de fuera',
   !/https?:\/\/[^'"\s]*(tesseract|ocr|vision|googleapis|cloudflare)/i.test(TEMP));
ok('11h · se carga solo al soltar una imagen (perezoso)',
   /_calCargarOCR/.test(TEMP) && !/<script[^>]*tesseract/i.test(INDEX));
// ⛔ `cache.addAll` es ATÓMICO: 4 MB que fallen tumban la precarga ENTERA.
ok('11h · ⛔ el OCR NO está en el precache del SW', !/'\.\/js\/vendor\/tesseract/.test(SW));
// ⚠️ Un worker sin cerrar deja el hilo y su memoria vivos hasta recargar.
ok('11h · el worker del OCR se cierra siempre (finally)',
   /finally\s*\{[\s\S]{0,200}worker\.terminate\(\)/.test(TEMP));
ok('11h · el modelo de idioma se sirve sin comprimir',
   /gzip:\s*false/.test(TEMP));

// ── 11i · 🔴🔴 v657 · EL WORKER NO PUEDE NACER DE UN blob: ───────────
//  Lo reportó el autor con una captura: soltaba el PNG y salía «⚠️ No se ha
//  podido leer la imagen:» — con la frase cortada ahí, sin causa. La
//  biblioteca, por su cuenta, arranca su worker desde un `blob:`, y la CSP
//  que esta app sirve desde firebase.json NO declara `worker-src`, así que
//  esa regla cae en `default-src 'self'` y un `blob:` está prohibido.
//
//  🔑 LA PRUEBA DE QUE ÉSTE ES EL EJE, y está dentro del propio proyecto:
//  pdf.js SÍ funciona aquí, y funciona porque su worker se carga por URL
//  (`workerSrc`), nunca por blob. Mismo navegador, misma CSP, dos workers,
//  y el que va por blob es el único que se cae.
//
//  ⚠️ Se arregla en el CLIENTE, no abriendo `worker-src blob:` en la CSP:
//  relajar la política de toda la app para arreglar una pantalla sale
//  carísimo. Estas dos aserciones fijan las dos mitades de esa decisión.
ok('11i · 🔴 el worker del OCR NO se crea desde un blob',
   /workerBlobURL:\s*false/.test(TEMP));
ok('11i · ⚠️ y la CSP NO se ha abierto a workers blob: para lograrlo',
   !/worker-src[^"]*blob:/i.test(leer('firebase.json')));
// 🚨 Y un error de worker llega SIN mensaje: si la pantalla no lo suple, el
//    usuario ve una frase cortada y manda a arreglar otra cosa. Pasó.
ok('11i · 🚨 un error sin mensaje no deja el aviso a medias',
   /_calErrorLegible/.test(TEMP) &&
   /no ha arrancado y no ha dicho por qu/.test(TEMP));
ok('11i · y se dice CUÁL de las piezas no llega',
   /_calDiagnosticoOCR/.test(TEMP) && /method:\s*'HEAD'/.test(TEMP));
// La imagen entra por el MISMO camino que el PDF a partir de las palabras.
ok('11h · la imagen desemboca en lineasDeOCR', /lineasDeOCR\(/.test(TEMP));

// ════════════════════════════════════════════════════════════════════
console.log('\n12 · VARIAS CAPTURAS PARA UNA MISMA TEMPORADA (v658)');
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-09-02): treinta jornadas no caben en una captura,
//  así que hay que poder soltar dos o tres y que se SUMEN. Y sus dos capturas
//  reales SE SOLAPAN —la primera llega a la jornada 22 y la segunda empieza
//  en la 8—, así que fusionar no es concatenar.
{
    const fila = (j, fecha, rival, local, extra) => Object.assign({
        jornada: j, fecha, hora: '20:30', rival, local, sede: 'X',
        origen: '', ajeno: false, confianza: 'verde',
    }, extra || {});

    // Dos tramos que se solapan en las jornadas 3 y 4, como sus capturas.
    const A = [
        fila(1, '2026-09-05', 'RIVAL UNO',    false),
        fila(2, '2026-09-12', 'RIVAL DOS',    true),
        fila(3, '2026-09-19', 'RIVAL TRES',   false),
        fila(4, '2026-09-26', 'RIVAL CUATRO', true),
    ];
    const B = [
        fila(3, '2026-09-19', 'RIVAL TRES',   false),
        fila(4, '2026-09-26', 'RIVAL CUATRO', true),
        fila(5, '2026-10-03', 'RIVAL CINCO',  false),
        fila(6, '2026-10-10', 'RIVAL SEIS',   true),
    ];

    const F = P.fusionarFilas(A, B);
    ok('12a · la unión no duplica lo solapado', F.filas.length === 6, F.filas.length);
    ok('12a · y lo dice: 2 nuevas, 2 repetidas', F.anadidas === 2 && F.repetidas === 2, F);
    ok('12a · queda ordenada por fecha',
       F.filas.map(f => f.fecha).join() ===
       '2026-09-05,2026-09-12,2026-09-19,2026-09-26,2026-10-03,2026-10-10',
       F.filas.map(f => f.fecha));
    ok('12a · con las jornadas de 1 a 6', F.filas.map(f => f.jornada).join() === '1,2,3,4,5,6',
       F.filas.map(f => f.jornada));

    // 🔑 EL ORDEN DE SUBIDA NO PUEDE CAMBIAR EL RESULTADO.
    const G = P.fusionarFilas(B, A);
    ok('12b · 🔑 da igual cuál se suelte primero',
       JSON.stringify(G.filas.map(f => f.fecha + '|' + f.rival)) ===
       JSON.stringify(F.filas.map(f => f.fecha + '|' + f.rival)),
       G.filas.map(f => f.fecha));

    // ⚠️ LO CORREGIDO A MANO NO SE PISA NUNCA.
    const editada = [fila(3, '2026-09-19', 'NOMBRE QUE PUSE YO', true, { editada: true })];
    const H = P.fusionarFilas(editada, B);
    const suya = H.filas.find(f => f.fecha === '2026-09-19');
    ok('12c · ⚠️ una fila corregida a mano sobrevive a la siguiente captura',
       suya.rival === 'NOMBRE QUE PUSE YO' && suya.local === true, suya);
    ok('12c · y su jornada tampoco se recalcula por debajo',
       suya.jornada === 3 && !suya.jornadaSupuesta, suya);

    // 🔑 Entre dos lecturas de la misma fecha, gana la que se leyó MEJOR: en
    //    el borde de una captura una fila sale recortada y en la otra entera.
    const floja  = [fila(2, '2026-09-12', 'RIVAL DOS', null, { confianza: 'rojo' })];
    const buena  = [fila(2, '2026-09-12', 'RIVAL DOS', true)];
    const I = P.fusionarFilas(floja, buena);
    ok('12d · la lectura mejor sustituye a la peor',
       I.filas[0].local === true && I.mejoradas === 1, I);
    const J = P.fusionarFilas(buena, floja);
    ok('12d · pero una peor NO pisa a una buena',
       J.filas[0].local === true && J.mejoradas === 0, J);

    // 🔑🔑 Y LA COHERENCIA SE RECALCULA SOBRE EL TOTAL: es lo que hace que al
    //  unir las mitades las jornadas cuadren aunque en cada trozo por
    //  separado no hubiera datos para decidirlo.
    const rotoA = [fila(1, '2026-09-05', 'UNO', false), fila(2, '2026-09-12', 'DOS', true),
                   fila(3, '2026-09-19', 'TRES', false)];
    const rotoB = [fila(4, '2026-09-26', 'CUATRO', true), fila(5, '2026-10-03', 'CINCO', false),
                   fila(1, '2026-10-10', 'SEIS', true)];   // ← el OCR leyó «6» como «1»
    const K = P.fusionarFilas(rotoA, rotoB);
    const ult = K.filas[K.filas.length - 1];
    ok('12e · 🔑🔑 la jornada mal leída se arregla AL UNIR los dos trozos',
       ult.jornada === 6, K.filas.map(f => f.jornada));
    ok('12e · y se marca para revisar, no se corrige en silencio',
       ult.confianza === 'amarillo' && ult.jornadaSupuesta === true, ult);
}

// ── 12f · La pantalla acumula, no pisa ───────────────────────────────
ok('12f · se pueden soltar varios archivos a la vez',
   /id="cal-file" multiple/.test(TEMP) && /_calProcesarVarios/.test(TEMP));
// ⚠️ En SERIE: cada OCR levanta un motor de ~4 MB y tres a la vez tumban un móvil.
ok('12f · ⚠️ y se procesan de uno en uno, no a la vez',
   /for \(let i = 0; i < files\.length; i\+\+\)[\s\S]{0,300}await _calProcesarArchivo/.test(TEMP));
// 🔑 El tercer argumento es lo único que distingue «sumar» de «volver a empezar».
//  ⚠️ Anclado en la LLAMADA con su tercer argumento, no en un `,true)` suelto
//  que casaría con cualquier cosa del fichero.
ok('12f · 🔑 «añadir otra» vuelve al paso 1 SIN tirar lo acumulado',
   /calAbrirImportador\([\s\S]{0,140},true\)/.test(TEMP) &&
   /function \(filaId, label, seguir\)/.test(TEMP) &&
   /seguir && previa/.test(TEMP));
ok('12f · y existe una salida explícita para descartarlo todo',
   /calEmpezarDeCero/.test(TEMP));
// 🔴 Lo que arreglaba su pérdida de datos: reimportar parte de lo guardado.
ok('12f · 🔴 reimportar arranca de lo que ya había guardado',
   /_calPrecargarGuardado/.test(TEMP));
ok('12f · una corrección a mano queda marcada para que la fusión la respete',
   /f\.editada = true/.test(TEMP));
// ⚠️ Fijar quién soy afecta a TODOS los archivos, no sólo al último.
ok('12f · ⚠️ recalcular «quién soy» rehace todas las fuentes',
   /fuentes\.forEach\([\s\S]{0,400}reinterpretarCon/.test(TEMP));

// ════════════════════════════════════════════════════════════════════
console.log('\n9 · CODIFICACIÓN Y SINTAXIS');
// ════════════════════════════════════════════════════════════════════
//  Este proyecto ya perdió un fichero entero por una trampa de codificación.
[['calendario-parser.js', PARSER], ['calendario-temporada.js', TEMP]].forEach(([n, s]) => {
    ok('9 · ' + n + ' sin mojibake', !/Ã|â€|Â/.test(s));
});
// ⚠️ El rango de acentos se CONSTRUYE, no se escribe: escrito como literal, el
// fichero contendría caracteres combinantes invisibles.
ok('9 · el rango de acentos no va literal en el fuente',
   /String\.fromCharCode\(0x300\)/.test(PARSER));

console.log('\n' + (fallos ? '❌ ' + fallos + ' fallo(s)' : '✅ TODO OK') + ' · ' + total + ' aserciones\n');
process.exit(fallos ? 1 : 0);
