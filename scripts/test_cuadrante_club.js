// ════════════════════════════════════════════════════════════════════════
//  test_cuadrante_club.js
//  🗓️ CUADRANTE SEMANAL DEL CLUB — v603 (fase 1 de 3)
// ════════════════════════════════════════════════════════════════════════
//  Petición del autor (implementar.txt, 2026-08-21/22): el Director Deportivo
//  y el Coordinador reparten los espacios del campo y los horarios de la
//  semana y se lo envían a los entrenadores; cada entrenador monta SU semana
//  sobre esa pauta.
//
//  🔑 LO QUE ESTE GUARD PROTEGE, y por qué NADA de esto es cosmético:
//
//   1. ⚠️⚠️ EL DOCUMENTO VA AL LADO DEL DE LA SEMANA, NO DENTRO.
//      TrainingSync.deleteWeek() hace `deleteDoc` del DOCUMENTO ENTERO cuando
//      no resuelve el equipo del entrenador. Guardar el cuadrante del club
//      dentro de `weeks/{weekKey}` habría significado que un entrenador
//      pulsando "🗑️ LIMPIAR" se lleva por delante la planificación de todo el
//      club, en silencio. Con el id `CUADRANTE__<fecha>` es imposible.
//
//   2. 🔑 CERO CAMBIOS EN firestore.rules. El comodín {weekKey} de la regla
//      existente ya cubre este id. Cualquier otra ubicación caería en el
//      catch-all `allow read, write: if false` y obligaría a desplegar reglas
//      — y en este proyecto staging comparte base de datos, reglas y
//      functions con PRODUCCIÓN: desplegar reglas no se puede probar.
//
//   3. ⚠️ SE GUARDA CON merge:false. `celdas` es un mapa y Firestore FUSIONA
//      mapas: con merge:true, borrar una asignación no se guardaría nunca y
//      la celda volvería sola al recargar.
//
//   4. 🔴🔴 EL ENVÍO LLEGA A ALGÚN SITIO. El entrenador NO tiene bandeja de
//      avisos: un botón que sólo escribiera en `cronos_notifications` sería
//      exactamente el defecto de v598 ("Transmitir al SuperAdmin" confirmaba
//      envíos que nadie recibía). La entrega real es la franja que se pinta en
//      su Planificación Semanal.
//
//   5. ⚠️ Y SÓLO SI SE HA ENVIADO. Un cuadrante a medio escribir no es una
//      directriz: enseñarlo haría montar la semana sobre un borrador.
//
//   6. 🎯 EL COORDINADOR SIGUE ACOTADO (v593): no cuadra ni envía a los
//      equipos de la otra modalidad.
//
//   7. ⚠️ LO QUE NO CABE EN LA PARRILLA SE DICE. La franja empieza a las 16:30
//      por requisito, pero los partidos de fin de semana son por la mañana.
//      Ocultarlos haría creer que el sábado no hay nada.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CQ      = leer('js/coach/reports/cuadrante-club.js');
const STAFF   = leer('js/coach/reports/club-reports.js');
const TRAIN   = leer('js/coach/training/panel.js');
const SYNC    = leer('js/services/training-firestore-sync.js');
const RULES   = leer('firestore.rules');
const INDEX   = leer('index.html');

// ── El módulo REAL, cargado en un sandbox ─────────────────────────────
// No toca el DOM al cargarse: sólo declara. Así las funciones puras se
// ejercitan de verdad en vez de comprobarse por regex.
const sb = {
    console: { log() {}, warn() {}, error() {} },
    String, Array, Number, Object, Date, parseInt, parseFloat, isNaN, RegExp, Math, JSON,
    document: { getElementById: () => null, body: { contains: () => false },
                querySelectorAll: () => [], createElement: () => ({ style: {}, addEventListener() {} }) },
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(CQ + '\n;window.__probe = { _cqMin, _cqHHMM, _cqDocId, _cqFilasVisibles, _cqHoraIni, ' +
                     '_cqFilasEfectivas, _cqFilaLimpia, CQ_DOC_FILAS, ' +
                     '_cqEsPartido, _cqHistInit, _cqHistPush, _cqHistGuardado, ' +
                     '_cqPuedeDeshacer, _cqPuedeRehacer, CQ_HIST_MAX, ' +
                     '_cqEtiquetaCelda, _cqOcupaCampo, _cqMinutosOcupados, ' +
                     '_cqEspaciosDe, _cqEspacioImplicito, _cqNombreEspacios, CQ_ESPACIOS, ' +
                     'CQ_HORA_INI_SEMANA, CQ_HORA_INI_FINDE, CQ_HORA_FIN, CQ_PASO_MIN, ' +
                     'CQ_TIPOS, CQ_ORDEN_CAT, CQ_PAPEL };' +
                     '\n;window.__baseFuente = _cqBaseFuente;', sb);
const P = sb.window.__probe;

// ⚠️ CÓDIGO SIN COMENTARIOS. Varias aserciones comprueban que una construcción
// NO aparece (`word-break:break-word`, `download`)... y los comentarios que
// explican POR QUÉ no debe aparecer la nombran. Sin este filtro, documentar la
// decisión pondría el guard en rojo — y la salida sería borrar el comentario,
// que es exactamente lo contrario de lo que interesa.
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CQ_COD = sinCom(CQ);

// Trozo de código entre dos marcas, para acotar una comprobación a la función
// que le toca. Sin esto, un `overflow:hidden` legítimo de otra pantalla pondría
// en rojo una aserción sobre la parrilla de ocupación.
function _seccion(src, desde, hasta) {
    const a = src.indexOf(desde);
    if (a < 0) return '';
    const b = src.indexOf(hasta, a + desde.length);
    return src.slice(a, b < 0 ? src.length : b);
}

console.log('\n🗓️  CUADRANTE SEMANAL DEL CLUB (v603)\n' + '─'.repeat(70));

// ── 1. DÓNDE VIVE EL DATO ─────────────────────────────────────────────
console.log('\n1) ⚠️⚠️ La ubicación del documento — la decisión que evita perder datos');
{
    ok('1a · el id lleva el prefijo CUADRANTE__',
       P._cqDocId('2026-05-11') === 'CUADRANTE__2026-05-11', P._cqDocId('2026-05-11'));

    ok('1b · 🔑🔑 el id NUNCA es igual a un weekKey → deleteWeek() no lo puede borrar',
       ['2026-05-11', '2026-08-24', '2025-01-06'].every(k => P._cqDocId(k) !== k),
       'TrainingSync.deleteWeek hace deleteDoc del documento entero cuando !teamId');

    ok('1c · ⚠️ y ese deleteDoc destructivo SIGUE AHÍ (si desaparece, revisar esta decisión)',
       /if \(!teamId\) \{\s*await fs\.deleteDoc\(ref\);/.test(SYNC),
       'el guard documenta por qué el cuadrante no vive dentro de weeks/{weekKey}');

    ok('1d · vive en la subcolección que las reglas YA abren al club',
       /'trainingPlans', clubId, 'weeks', _cqDocId\(/.test(CQ));

    ok('1e · 🔑 NO se escribe ni una línea de teams.<teamId> (eso es del entrenador)',
       !/teams\s*[.\[]/.test(CQ.replace(/^\s*\/\/.*$/gm, '')),
       'el cuadrante del club y la planificación del entrenador no se pisan');
}

// ── 2. CERO CAMBIOS EN LAS REGLAS ─────────────────────────────────────
console.log('\n2) 🔑 Cero cambios en firestore.rules (staging comparte BD con producción)');
{
    ok('2a · la regla comodín de weeks/{weekKey} sigue existiendo',
       /match \/trainingPlans\/\{clubId\}\/weeks\/\{weekKey\}/.test(RULES));

    ok('2b · concede create y update a los miembros del club',
       /match \/trainingPlans\/\{clubId\}\/weeks\/\{weekKey\}[\s\S]{0,900}allow create, update: if isAuth\(\)/.test(RULES));

    ok('2c · 🔑 NO se ha añadido ninguna regla nueva para el cuadrante',
       !/cuadrante/i.test(RULES),
       'si algún día hace falta una, hay que desplegar reglas — y eso no se puede probar aquí');

    ok('2d · el catch-all que lo haría obligatorio sigue en pie',
       /match \/\{document=\*\*\} \{\s*allow read, write: if false;/.test(RULES));

    ok('2e · el aviso escribe en cronos_notifications con userId (el campo que miran las reglas)',
       /'cronos_notifications'[\s\S]{0,400}userId:\s*r\.uid/.test(CQ));
}

// ── 3. EL GUARDADO ────────────────────────────────────────────────────
console.log('\n3) ⚠️ merge:false — sin esto, borrar una celda no se guarda jamás');
{
    ok('3a · _cqGuardar usa merge:false explícito',
       /setDoc\([\s\S]{0,160}\{ merge: false \}\)/.test(CQ));

    ok('3b · ⚠️ y NO hay ningún merge:true escribiendo el cuadrante',
       !/_cqDocId\([\s\S]{0,200}\{ merge: true \}/.test(CQ),
       'Firestore fusiona mapas: con merge, `celdas` sólo crecería');

    ok('3c · se sella quién y cuándo lo tocó por última vez',
       /actualizadoPor:/.test(CQ) && /actualizado:\s*new Date\(\)\.toISOString\(\)/.test(CQ));
}

// ── 4. LA PUERTA LLEVA A ALGÚN SITIO ──────────────────────────────────
console.log('\n4) 🔴🔴 El envío se VE (la lección de v598: no confirmar envíos que nadie recibe)');
{
    ok('4a · el módulo publica la lectura para el entrenador',
       /window\.cronosCuadranteClubDeMiEquipo = async function/.test(CQ));

    ok('4b · y la pieza que la pinta en su pantalla',
       /window\.cronosPintarDirectrizClub = async function/.test(CQ));

    ok('4c · 🔑 la Planificación Semanal del entrenador RESERVA el hueco',
       /id="cq-directriz"/.test(TRAIN));

    ok('4d · 🔑🔑 y la LLAMA de verdad tras pintar su parrilla',
       /window\.cronosPintarDirectrizClub\(weekKey, 'cq-directriz'\)/.test(TRAIN),
       'sin esta llamada el botón de enviar sería una puerta falsa');

    ok('4e · ⚠️ con guarda typeof: si el módulo no carga, el entrenador conserva su pantalla',
       /typeof window\.cronosPintarDirectrizClub === 'function'/.test(TRAIN));

    ok('4f · ⚠️ y sin await ni throw: la lectura fallida no puede tumbar la Planificación',
       /cronosPintarDirectrizClub\(weekKey, 'cq-directriz'\)\s*\n?\s*\.catch\(/.test(TRAIN));

    ok('4g · ⚠️⚠️ SÓLO se enseña lo PUBLICADO, nunca un borrador',
       /if \(!d\.publicadoEn\) return recordar\(null\);/.test(CQ),
       'montar la semana sobre un cuadrante a medio escribir es peor que no verlo');

    ok('4h · el sello de publicación queda en el propio cuadrante (quién y cuántos)',
       /publicadoEn\s*=\s*new Date\(\)\.toISOString\(\)/.test(CQ) && /publicadoA\s*=\s*Array\.from\(enviados\)/.test(CQ));

    ok('4i · 🔑 el cuadrante COMPLETO no viaja dentro de cada aviso (v576: no hay deltas)',
       !/cuadrante:\s*st\.doc/.test(CQ) && /resumen:\s*resumen/.test(CQ),
       'duplicarlo por destinatario multiplicaría el documento por N');
}

// ── 5. DESTINATARIOS ──────────────────────────────────────────────────
console.log('\n5) Destinatarios: una persona, un aviso — y sólo los suyos');
{
    ok('5a · 🔑 deduplicado por uid (una persona con DOS equipos recibe UNO)',
       /const enviados = new Set\(\)/.test(CQ) && /if \(!r\.uid \|\| enviados\.has\(r\.uid\)\) continue;/.test(CQ));

    ok('5b · ⚠️ sólo el documento PRIMARIO de users (los secundarios duplicarían)',
       /if \(u\.uid && u\.uid !== dd\.id\) return;/.test(CQ));

    ok('5c · se excluyen los inactivos y los no autorizados',
       /u\.status !== 'active'/.test(CQ) && /u\.isAuthorized === false/.test(CQ));

    ok('5d · 🎯 el coordinador NO envía a los entrenadores de la otra modalidad',
       /lista = lista\.filter\(r => !r\.cat \|\| window\._cronosVeCategoria\(me, r\.cat\)\)/.test(CQ));

    ok('5e · cero destinatarios NO es un error: se dice qué hacer',
       /No hay entrenadores activos a los que enviar/.test(CQ));

    ok('5f · y en ese caso el botón de enviar se retira',
       /cq-env-ok[\s\S]{0,120}style\.display = 'none'/.test(CQ));
}

// ── 6. EL ACOTAMIENTO DEL COORDINADOR EN LA PARRILLA ──────────────────
console.log('\n6) 🎯 El coordinador de una modalidad no cuadra la otra (v593)');
{
    ok('6a · las filas se filtran por _cronosVeCategoria',
       /function _cqFilasVisibles[\s\S]{0,400}window\._cronosVeCategoria\(me, f\.cat\)/.test(CQ));

    ok('6b · ⚠️ pero las filas LIBRES (academia, porteros, fisio) se ven siempre',
       /f\.tipo !== 'equipo' \|\| window\._cronosVeCategoria/.test(CQ),
       'no tienen categoría: son del club entero');

    ok('6c · 🔑🔑 reordenar traduce el índice VISIBLE al real antes de mover',
       /const visibles = _cqFilasVisibles\(st\.doc\.filas\);[\s\S]{0,320}st\.doc\.filas\.indexOf\(fila\)/.test(CQ),
       'sin esto un coordinador de F7 reordenaría equipos de F11 que ni ve');

    ok('6d · y el alta de equipo sólo ofrece categorías de su alcance',
       /CT_CATEGORIES \|\| \[\]\)\.filter\(c =>[\s\S]{0,140}_cronosVeCategoria\(me, c\.id\)/.test(CQ));

    ok('6e · ejecutable: _cqFilasVisibles respeta el filtro',
       (() => {
           sb.window._cronosCurrentUser = { role: 'coordinator' };
           sb.window._cronosVeCategoria = (u, cat) => cat === 'alevin';
           const r = P._cqFilasVisibles([
               { id: 'a', tipo: 'equipo', cat: 'alevin', label: 'Alevín A' },
               { id: 'b', tipo: 'equipo', cat: 'juvenil', label: 'Juvenil A' },
               { id: 'c', tipo: 'libre',  cat: '',       label: 'Porteros' },
           ]).map(f => f.id).join(',');
           sb.window._cronosVeCategoria = undefined;
           return r === 'a,c';
       })(), 'el equipo de la otra modalidad fuera; la fila libre dentro');
}

// ── 7. LA PARRILLA ────────────────────────────────────────────────────
console.log('\n7) La parrilla: 4 espacios, desde las 16:30, y lo que no cabe se dice');
{
    ok('7a · el campo se divide en 4 espacios (requisito del autor)', P.CQ_ESPACIOS === 4, P.CQ_ESPACIOS);
    ok('7b · entre semana la franja arranca a las 16:30',
       P.CQ_HORA_INI_SEMANA === '16:30' && P._cqHoraIni(0) === '16:30' && P._cqHoraIni(4) === '16:30',
       P.CQ_HORA_INI_SEMANA);
    ok('7c · una categoría puede ocupar 1, 2 o los 4 (casillas, no un selector único)',
       /class="cq-esp"/.test(CQ) && /Puede ocupar 1, 2 o los/.test(CQ));

    ok('7d · ejecutable: _cqMin convierte y rechaza basura',
       P._cqMin('16:30') === 990 && P._cqMin('22:30') === 1350 &&
       P._cqMin('99:99') === null && P._cqMin('') === null && P._cqMin('abc') === null,
       { m1630: P._cqMin('16:30'), basura: P._cqMin('99:99') });

    ok('7e · ejecutable: _cqHHMM es su inverso',
       P._cqHHMM(990) === '16:30' && P._cqHHMM(1350) === '22:30' && P._cqHHMM(600) === '10:00');

    ok('7f · ⚠️⚠️ lo que no sale en la parrilla se LISTA, no se oculta',
       /Fuera de la franja/.test(CQ) && /bloque\('🕐 Fuera de la franja/.test(CQ),
       'un día con actividad que no aparece haría creer que el campo está libre');

    ok('7g · 🔑 las colisiones se marcan pero NO bloquean el guardado',
       /dos o más equipos en el mismo espacio/.test(CQ) && /no se bloquea el guardado/.test(CQ));

    ok('7h · una hora de fin anterior a la de inicio se rechaza al aplicar',
       /_cqMin\(fin\) <= _cqMin\(ini\)[\s\S]{0,220}return;/.test(CQ));

    ok('7i · 🎨 el código de colores es el que fijó el autor: casa verde, fuera naranja',
       P.CQ_TIPOS.partido_casa.color === '#3fb950' && P.CQ_TIPOS.partido_fuera.color === '#f0883e',
       { casa: P.CQ_TIPOS.partido_casa.color, fuera: P.CQ_TIPOS.partido_fuera.color });

    ok('7j · las filas van de MAYOR a MENOR edad, como el cuadrante en papel',
       P.CQ_ORDEN_CAT.indexOf('regional') < P.CQ_ORDEN_CAT.indexOf('juvenil') &&
       P.CQ_ORDEN_CAT.indexOf('juvenil')  < P.CQ_ORDEN_CAT.indexOf('benjamin') &&
       P.CQ_ORDEN_CAT.indexOf('benjamin') < P.CQ_ORDEN_CAT.indexOf('prebenjamin'));

    ok('7k · ⚠️ y el catálogo de filas admite lo que NO es un equipo (academia, porteros, fisio)',
       /cqAnadirFilaLibre/.test(CQ) && /tipo: 'libre'/.test(CQ),
       'la referencia del club (CAPTURAS/IMG_4520.jpg) tiene tres filas así');
}

// ── 8. LA ENTRADA EN EL PANEL ─────────────────────────────────────────
console.log('\n8) La entrada: Dirección Y Coordinación, con respaldo si el módulo no carga');
{
    ok('8a · la opción está en el tablero',
       /titulo: 'Cuadrante'[\s\S]{0,220}switchStaffTab\('cuadrante'\)/.test(STAFF));

    ok('8b · 🔑 y FUERA del if (_esDir): también es del Coordinador',
       (() => {
           const iOpc = STAFF.indexOf("switchStaffTab('cuadrante')");
           const iDir = STAFF.indexOf('if (_esDir) {');
           return iOpc > 0 && iDir > 0 && iOpc < iDir;
       })(), 'el autor lo pidió para los dos paneles');

    ok('8c · la barra de vuelta sabe cómo se llama la sección',
       /cuadrante:\s*'🗓️ Cuadrante'/.test(STAFF));

    ok('8d · switchStaffTab tiene su rama',
       /if \(tab === 'cuadrante'\) \{/.test(STAFF));

    ok('8e · ⚠️ y si el módulo no estuviera cargado se DICE, no se rompe',
       /typeof window\._sdLoadCuadrante !== 'function'[\s\S]{0,240}Recarga el panel/.test(STAFF));

    ok('8f · index.html lo enlaza', /js\/coach\/reports\/cuadrante-club\.js/.test(INDEX));

    ok('8g · cambiar de semana con cambios sin guardar AVISA antes de perderlos',
       /if \(st\.sucio && !confirm\(/.test(CQ));

    ok('8h · ⚠️ y enviar con cambios sin guardar avisa de que se envía lo GUARDADO',
       /Se enviará lo ÚLTIMO GUARDADO/.test(CQ));
}

// ══════════════════════════════════════════════════════════════════════
//  v604 · LOS SEIS AJUSTES QUE PIDIÓ TRAS PROBAR LA v603
// ══════════════════════════════════════════════════════════════════════

// ── 9. FIN DE SEMANA DESDE LAS 9:00 ───────────────────────────────────
console.log('\n9) 🕐 v604 · El fin de semana empieza por la mañana (punto 1)');
{
    ok('9a · sábado y domingo arrancan a las 9:00',
       P._cqHoraIni(5) === '09:00' && P._cqHoraIni(6) === '09:00',
       { sabado: P._cqHoraIni(5), domingo: P._cqHoraIni(6) });

    ok('9b · 🔑 y NO se ha movido la franja de entre semana',
       [0,1,2,3,4].every(i => P._cqHoraIni(i) === '16:30'),
       'entre semana se entrena por la tarde: adelantarlo llenaría la parrilla de huecos');

    ok('9c · la parrilla usa la hora del DÍA visible, no una constante fija',
       /const horaIni = _cqHoraIni\(st\.dia\);/.test(CQ) && /_cqMin\(horaIni\)/.test(CQ));

    ok('9d · ⚠️ y el aviso de "fuera de la franja" dice la hora correcta de ese día',
       /Fuera de la franja ' \+ horaIni \+ '/.test(CQ),
       'con la constante fija diría 16:30 un sábado que empieza a las 9:00');

    ok('9e · se ve ANTES de pulsar qué días empiezan por la mañana',
       /i >= 5 \?[\s\S]{0,180}desde 9:00/.test(CQ));

    ok('9f · el partido de las 10:30 del domingo YA CABE en la parrilla',
       P._cqMin('10:30') >= P._cqMin(P._cqHoraIni(6)) && P._cqMin('12:30') <= P._cqMin(P.CQ_HORA_FIN),
       'era el caso real de la referencia del club (CAPTURAS/IMG_4520.jpg)');
}

// ── 10. EL CUADRANTE DENTRO DE ENTRENAMIENTOS, AL LADO ─────────────────
console.log('\n10) 🗓️ v604 · Ventana al lado dentro de ENTRENAMIENTOS (puntos 2 y 3)');
{
    ok('10a · 🔑 NO hay sección ni entrada de menú nueva para el entrenador',
       !/openCuadranteCoach|switchStaffTab\('cuadrante'\)/.test(TRAIN) &&
       !/CUADRANTE/i.test(leer('js/core/setup-modal.js').split('BOTONES DE ACCIÓN')[1] || ''),
       'el autor lo pidió expresamente: "no crees botones nuevos"');

    ok('10b · el interruptor vive DENTRO de la Planificación Semanal',
       /id="cq-lado-btn"[\s\S]{0,300}cqToggleDirectriz\(\)/.test(TRAIN));

    ok('10c · 🔑 vista DUAL: la parrilla propia y la ventana del club son hermanas en un flex',
       /display:flex; gap:0\.7rem; align-items:stretch; flex-wrap:wrap/.test(TRAIN) &&
       /id="cq-directriz"/.test(TRAIN));

    ok('10d · ⚠️ sin media query: en pantalla estrecha la ventana cae debajo sola (v422)',
       /flex:1 1 480px/.test(TRAIN) && /flex:0 1 300px/.test(TRAIN));

    ok('10e · 🔑 el interruptor RECUERDA su estado entre semanas',
       /localStorage\.setItem\(CQ_LADO_KEY/.test(CQ) && /localStorage\.getItem\(CQ_LADO_KEY\)/.test(CQ),
       'reabrirlo en cada ◀ ▶ lo haría inservible justo cuando más se usa');

    ok('10f · ⚠️ arranca ABIERTO la primera vez (sin preferencia guardada)',
       /v === null \? true : v === '1'/.test(CQ),
       'cerrado por defecto, el envío del coordinador volvería a ser invisible');

    ok('10g · ⚠️ y si el navegador no deja guardar, sigue funcionando',
       /catch \(e\) \{ return true; \}/.test(CQ));

    ok('10h · 🔴 sin cuadrante enviado se DICE, no se deja la ventana en blanco',
       /todavía no ha enviado<\/strong> el cuadrante de esta semana/.test(CQ),
       'una ventana vacía y abierta parece una avería');

    ok('10i · el botón avisa con un punto verde si hay algo que ver',
       /boton\.innerHTML = '🗓️ CUADRANTE DEL CLUB'[\s\S]{0,200}#3fb950/.test(CQ));

    ok('10j · ⚠️ la lectura se cachea 60 s (el techo de este proyecto es LEER)',
       /_cqCacheDirectriz/.test(CQ) && /CQ_CACHE_MS = 60000/.test(CQ));

    ok('10k · 🔑 el "no hay nada" TAMBIÉN se cachea (es el caso más frecuente)',
       /if \(!snap\.exists\(\)\) return recordar\(null\);/.test(CQ) &&
       /if \(!d\.publicadoEn\) return recordar\(null\);/.test(CQ));

    ok('10l · ⚠️ pero un ERROR de red no se cachea',
       /Un fallo NO se cachea[\s\S]{0,500}return null;\s*\n\s*\}\s*\n\};/.test(CQ),
       'guardarlo dejaría al entrenador sin cuadrante un minuto tras recuperar la conexión');
}

// ── 11. DESCANSO ──────────────────────────────────────────────────────
console.log('\n11) 💤 v604 · "Descanso" (punto 4) — y sus dos ramificaciones');
{
    const ATT = leer('js/coach/attendance/attendance-store.js');
    const EV  = leer('js/coach/reports/events-tab.js');

    ok('11a · está en el desplegable de la Planificación Semanal',
       /typeOpts = \['','entrenamiento','partido liga','partido amistoso','descanso'\]/.test(TRAIN));

    ok('11b · 🔴🔴 un descanso NO cuenta como sesión de asistencia',
       /if \(t\.indexOf\('descanso'\) === 0\) return '';/.test(ATT),
       'lo contrario abriría lista para un día en que nadie va y hundiría el % de todo el club');

    ok('11c · 🔑 se compara por PREFIJO, como con "partido"',
       /t\.indexOf\('descanso'\) === 0/.test(ATT) && /t\.indexOf\('partido'\) === 0/.test(ATT));

    ok('11d · 🔴 y no sale en verde en la tira de "📆 HOY" del Director',
       /_t\.indexOf\('descanso'\) !== 0/.test(STAFF),
       'saldría como sesión "sin pasar lista", como si el entrenador se hubiera olvidado');

    ok('11e · la planificación enviada lo pinta como descanso, no como una actividad más',
       /_esDescanso/.test(EV) && /hasData = !_esDescanso/.test(EV));

    ok('11f · ⚠️ y lo detecta también dentro de `note` (que es como viaja el tipo)',
       /_esDescanso[\s\S]{0,260}String\(dy\.note \|\| ''\)/.test(EV),
       'training-notify.js une tipo+equipación+duración en `note` con " · "');
}

// ── 12. SINCRONIZACIÓN EN VIVO ────────────────────────────────────────
console.log('\n12) 🔄 v604 · Director ↔ Coordinador en vivo (punto 5)');
{
    ok('12a · hay un onSnapshot sobre el documento del cuadrante',
       /st\.desuscribir = fs\.onSnapshot\(/.test(CQ));

    ok('12b · 🔑 se da de baja al salir de la sección',
       /window\._cqDesconectar = _cqDesconectar;/.test(CQ) &&
       /typeof window\._cqDesconectar === 'function'\) window\._cqDesconectar\(\);/.test(STAFF),
       'un oyente que sobrevive a su pantalla sigue costando lecturas y repinta lo ajeno (v439)');

    ok('12c · ⚠️ y la baja va al PRINCIPIO de switchStaffTab, para cubrir TODAS las salidas',
       (() => {
           const iBaja = STAFF.indexOf('window._cqDesconectar();');
           const iTab  = STAFF.indexOf("if (tab === 'cuadrante')");
           return iBaja > 0 && iTab > 0 && iBaja < iTab;
       })());

    ok('12d · reconectar a la misma semana NO duplica el oyente',
       /if \(st\.desuscribir && st\._escuchando === clubId \+ '\|' \+ weekKey\) return;/.test(CQ));

    ok('12e · 🔑🔑 mi propio guardado NO se anuncia como cambio ajeno',
       /sello === st\.selloPropio/.test(CQ) && /window\._cqState\.selloPropio = payload\.actualizado;/.test(CQ),
       'sin esto, cada GUARDAR diría "otra persona ha actualizado el cuadrante" — y esa persona soy yo');

    ok('12f · 🔴🔴 un cambio ajeno NO pisa lo que estoy escribiendo sin guardar',
       /if \(st\.sucio \|\| document\.getElementById\('cq-overlay'\)\) \{\s*st\.remoto = entrante;/.test(CQ),
       'repintar a ciegas tiraría las casillas recién rellenadas, sin un solo aviso');

    ok('12g · ⚠️ tampoco mientras hay un editor de celda abierto',
       /document\.getElementById\('cq-overlay'\)/.test(CQ));

    ok('12h · el conflicto se enseña y se deja ELEGIR (ver la suya / seguir con la mía)',
       /cqAdoptarRemoto\(\)/.test(CQ) && /cqDescartarAvisoRemoto\(\)/.test(CQ) &&
       /no se han perdido/.test(CQ));

    ok('12i · adoptar la ajena teniendo cambios propios PREGUNTA antes',
       /if \(st\.sucio && !confirm\('Vas a cargar la versión de otra persona/.test(CQ));

    ok('12j · ⚠️ si el contenedor ya no está, el oyente se da de baja solo',
       /if \(!document\.getElementById\('staff-dashboard-content'\)\) \{ _cqDesconectar\(\); return; \}/.test(CQ));

    ok('12k · un corte de la escucha se registra pero no rompe la pantalla',
       /la escucha en vivo se cortó/.test(CQ));
}

// ── 13. COPIAR Y PEGAR ────────────────────────────────────────────────
console.log('\n13) 📋 v604 · Copiar y pegar bloques (punto 6)');
{
    ok('13a · dos granularidades: la casilla y la semana entera de un equipo',
       /window\.cqCopiarCelda = function/.test(CQ) && /window\.cqCopiarFila = function/.test(CQ) &&
       /window\.cqPegarCelda = function/.test(CQ) && /window\.cqPegarFila = function/.test(CQ));

    ok('13b · 🔑 el MODO PEGAR se anuncia con una barra y se sale de él',
       /_cqBarraPortapapeles/.test(CQ) && /cqCancelarCopia/.test(CQ),
       'cambiar en silencio lo que hace pulsar una casilla es una trampa');

    ok('13c · 🔑 y la barra dice QUÉ hay copiado',
       /📋 Copiado:<\/span>/.test(CQ) && /_cqE\(p\.etiqueta\)/.test(CQ) && /_cqEtiquetaCelda/.test(CQ));

    ok('13d · ⚠️ el portapapeles guarda una COPIA, no la referencia',
       /esp: \(c\.esp \|\| \[\]\)\.slice\(\)/.test(CQ),
       'con la referencia, editar el original después cambiaría lo copiado');

    ok('13e · ejecutable: la etiqueta describe el bloque de un vistazo',
       (() => {
           const s = P._cqEtiquetaCelda({ tipo: 'entreno', ini: '18:00', fin: '19:30', esp: [2,1], txt: 'ENTRENO' });
           return s.indexOf('ENTRENO') === 0 && s.indexOf('18:00–19:30') > 0 && s.indexOf('1·2') > 0;
       })(), P._cqEtiquetaCelda({ tipo: 'entreno', ini: '18:00', fin: '19:30', esp: [2,1], txt: 'ENTRENO' }));

    ok('13f · 🔴 pegar una semana ENCIMA de otra con datos PREGUNTA antes',
       /tenia\.length && !confirm\(/.test(CQ),
       'perder la semana de un equipo por un clic es el borrado silencioso de siempre');

    ok('13g · ⚠️ pegar NO guarda: marca sucio y el autor revisa',
       /window\.cqPegarCelda[\s\S]{0,600}st\.sucio = true;/.test(CQ) &&
       !/window\.cqPegarCelda[\s\S]{0,600}_cqGuardar\(/.test(CQ));

    ok('13h · 🔑 pegar una casilla NO sale del modo: lo normal es repetir el bloque',
       /NO se sale del modo pegar/.test(CQ));

    ok('13i · copiar una casilla vacía no deja el modo activo sin contenido',
       /if \(!c\) \{ _cqToast\('⚠️ No hay nada que copiar/.test(CQ));

    ok('13j · copiar la semana de un equipo sin nada tampoco',
       /if \(!n\) \{ _cqToast\('⚠️ «'/.test(CQ));
}

// ══════════════════════════════════════════════════════════════════════
//  v605 · LAS TRES CORRECCIONES TRAS PROBAR LA v604 (capturas 9412-9415)
// ══════════════════════════════════════════════════════════════════════

// ── 14. UN PARTIDO FUERA NO OCUPA EL CAMPO ────────────────────────────
console.log('\n14) 🏟️ v605 · Quien juega FUERA no ocupa el campo (punto 1)');
{
    ok('14a · el tipo lo lleva escrito en su definición, no en un `if` suelto',
       P.CQ_TIPOS.partido_fuera.ocupa === false &&
       P.CQ_TIPOS.partido_casa.ocupa === true &&
       P.CQ_TIPOS.entreno.ocupa === true,
       'es una regla del negocio, no un detalle de pintado');

    ok('14b · 🔑🔑 ejecutable: un partido FUERA no ocupa aunque tenga espacios marcados',
       P._cqOcupaCampo({ tipo: 'partido_fuera', esp: [1, 2], ini: '10:00', fin: '12:00' }) === false,
       'es el caso REAL de las capturas 9413/9415: el rojo era falso');

    ok('14c · ejecutable: un partido en CASA con espacios sí ocupa',
       P._cqOcupaCampo({ tipo: 'partido_casa', esp: [1], ini: '10:00', fin: '12:00' }) === true);

    ok('14d · ejecutable: sin espacios marcados no ocupa nada, sea del tipo que sea',
       P._cqOcupaCampo({ tipo: 'entreno', esp: [], ini: '18:00', fin: '19:30' }) === false &&
       P._cqOcupaCampo({ tipo: 'entreno', ini: '18:00', fin: '19:30' }) === false &&
       P._cqOcupaCampo(null) === false);

    ok('14e · ⚠️⚠️ el filtro se aplica AL PINTAR, no sólo al guardar',
       /if \(meta\.ocupa === false\) \{ visitante\.push\(item\); return; \}/.test(CQ),
       'los cuadrantes escritos con v603/v604 pueden traer espacios en un partido fuera');

    // ⚠️ v607 · el mapa pasó a construirse con los espacios EFECTIVOS
    // (`item.esp`), no con `c.esp` a pelo: ver la sección 19.
    ok('14f · el mapa de ocupación se construye SÓLO con los que ocupan',
       /if \(!item\.esp\.length\) \{ sinEspacio\.push\(item\); return; \}/.test(CQ_COD) &&
       /dentro\.forEach\(it => \{\s*it\.esp\.forEach/.test(CQ_COD));

    ok('14g · y al guardar, un partido fuera se escribe SIN espacios',
       /const esp = \(metaT\.ocupa === false\) \? \[\] :/.test(CQ),
       'así el dato en la base ya es coherente, sin depender de quien lo lea');

    ok('14h · 🔑 el editor apaga las casillas de espacio al elegir "Partido FUERA"',
       /window\.cqTipoCambiado = function/.test(CQ) && /onchange="cqTipoCambiado\(\)"/.test(CQ));

    ok('14i · ⚠️ y las deshabilita de verdad, no sólo con opacidad (v548)',
       /x\.disabled = juegaFuera;/.test(CQ),
       '`disabled` es cosmético si sólo se pinta gris');

    ok('14j · ⚠️ el estado se aplica AL ABRIR, no sólo al cambiar el desplegable',
       /Se aplica el estado NADA MÁS ABRIR[\s\S]{0,260}cqTipoCambiado\(\);/.test(CQ));

    ok('14k · 🔑 los que juegan fuera SE SIGUEN VIENDO, en su propio bloque',
       /Juegan FUERA de casa · no ocupan ningún espacio del campo/.test(CQ),
       'borrarlos habría sido el error contrario: el director tiene que saber que hay partido');

    ok('14l · y lo que ocupa tiempo sin espacio asignado también se dice',
       /Sin espacio asignado · no se reflejan en la parrilla/.test(CQ),
       'no es una avería: es un hueco del cuadrante, y quien lo rellena tiene que verlo');
}

// ── 15. EL TEXTO DE LAS CELDAS ────────────────────────────────────────
console.log('\n15) 📐 v605 · Texto completo y ordenado en las celdas (punto 2)');
{
    ok('15a · 🔑 ya no se parte por cualquier letra: `overflow-wrap`, no `word-break`',
       !/word-break:break-word/.test(CQ_COD) && /overflow-wrap:break-word;word-break:normal/.test(CQ_COD),
       '`word-break:break-word` partía ENTRENAMIENT/O; `overflow-wrap` respeta la palabra');

    ok('15b · cada tipo tiene un rótulo CORTO para la parrilla',
       P.CQ_TIPOS.entreno.corto === 'ENTRENO' && P.CQ_TIPOS.partido_casa.corto === 'CASA' &&
       P.CQ_TIPOS.partido_fuera.corto === 'FUERA' && P.CQ_TIPOS.otro.corto === 'OTROS',
       { entreno: P.CQ_TIPOS.entreno.corto });

    ok('15c · 🔑 y todos caben en una columna: ninguno pasa de 8 caracteres',
       Object.keys(P.CQ_TIPOS).every(k => P.CQ_TIPOS[k].corto.length <= 8),
       Object.keys(P.CQ_TIPOS).map(k => P.CQ_TIPOS[k].corto));

    ok('15d · la casilla usa el corto; el largo se reserva para las frases',
       /_cqE\(c\.txt \|\| meta\.corto \|\| meta\.label\.toUpperCase\(\)\)/.test(CQ_COD) &&
       /_cqE\(it\.c\.txt \|\| meta\.label\)/.test(CQ_COD) &&
       /\(c\.txt \|\| meta\.label\) \+ ' · '/.test(CQ_COD),
       '"Entrenamiento" sigue en el editor, la leyenda, la barra de copiado y los resúmenes');

    ok('15e · ⚠️ el nombre completo sigue disponible en el `title` de la casilla',
       /title="' \+ _cqA\(meta\.label/.test(CQ),
       'acortar el rótulo no puede esconder el dato');

    // ⚠️ 15f/15g/15h cambiaron en v606: el ensanchado de v605 arreglaba el
    // texto pero CAUSÓ el scroll horizontal que el autor reportó después. Lo
    // que se protege ahora es el invariante de fondo —el texto no se corta—
    // logrado por el camino contrario: la letra cede, no el ancho.
    // ⚠️ v608 · la altura mínima se mudó a la constante CAJA, compartida por
    // las tres casillas (vacía, modo pegar y con contenido).
    ok('15f · la casilla tiene aire, en unidades que el zoom escala',
       /min-height:4\.4em/.test(CQ_COD) && /padding:0\.35em 0\.25em/.test(CQ_COD) &&
       /line-height:1\.3/.test(CQ_COD));

    ok('15g · 🔑 cada hora es un bloque indivisible…',
       /<span style="white-space:nowrap;">' \+ _cqE\(c\.ini \|\| ''\)/.test(CQ) &&
       /<span style="white-space:nowrap;"> – ' \+ _cqE\(c\.fin\)/.test(CQ),
       '"18:00" partido a la mitad no se lee');

    ok('15h · …⚠️ pero el PAR puede pasar a dos líneas',
       !/white-space:nowrap;">' \+ _cqE\(horas\)/.test(CQ),
       'con el par entero en nowrap, "18:00 – 19:30" desbordaba la columna estrecha y volvía el scroll');
}

// ── 16. EXPORTAR PARA EL AYUNTAMIENTO ─────────────────────────────────
console.log('\n16) 🖨️ v605 · Descarga del cuadrante para el Ayuntamiento (punto 3)');
{
    const EXP = leer('js/coach/reports/reports-export.js');

    ok('16a · hay botón de exportar en el panel del Director y del Coordinador',
       /onclick="cqExportar\(\)"/.test(CQ) && /window\.cqExportar = function/.test(CQ));

    ok('16b · 🔑 reutiliza rxImprimir: cero dependencias nuevas',
       /window\.rxImprimir\(\{/.test(CQ) && /window\.rxImprimir = function/.test(EXP));

    ok('16c · ⚠️ con guarda: si el módulo no está, se dice en vez de no hacer nada',
       /typeof window\.rxImprimir !== 'function'/.test(CQ));

    ok('16d · 🔑🔑 `print-color-adjust: exact` sigue en la hoja de impresión',
       /print-color-adjust:exact/.test(EXP),
       'sin ella el PDF sale con las celdas EN BLANCO, y aquí el color ES el dato');

    ok('16e · ⚠️ NO se usa <a download> con blob: en iOS eso NAVEGA (v526→v530)',
       !/download/.test(CQ_COD) && !/createObjectURL/.test(CQ_COD) && !/Blob\(/.test(CQ_COD));

    ok('16f · va apaisado: 7 días más el equipo no caben en vertical',
       /apaisado: true/.test(CQ));

    ok('16g · 🔑 los colores se REDEFINEN para papel (los de pantalla son para fondo oscuro)',
       !!P.CQ_PAPEL && P.CQ_PAPEL.partido_casa.bg === '#dcfce7' && P.CQ_PAPEL.partido_fuera.bg === '#ffedd5',
       'sobre blanco, los rgba translúcidos del tema oscuro son ilegibles');

    ok('16h · 🔑🔑 el documento lleva la OCUPACIÓN, que es lo que se justifica',
       /Ocupación de instalaciones/.test(CQ) && /TOTAL DE OCUPACIÓN DE LA SEMANA/.test(CQ),
       'al Ayuntamiento no le interesa qué equipo entrena, sino cuánto se ocupa el campo');

    // ⏱️ v620 · EL TIEMPO ES EL TIEMPO Y NO SE MULTIPLICA POR LOS SECTORES.
    //  Hasta v619 esto exigía lo CONTRARIO —`(fin-ini) × nº de espacios`— y era
    //  deliberado: se contaban "horas de campo". El autor lo reportó como error
    //  (implementar.txt, 2026-08-24) con su ejemplo: un equipo de 16:30 a 18:00
    //  en los cuatro sectores ocupa hora y media, no seis. Ahora se miden HORAS
    //  DE EQUIPO: la duración de la sesión, ocupe un sector o los cuatro.
    ok('16i · ⏱️ ejecutable: los minutos son los de la FRANJA, no × espacios',
       P._cqMinutosOcupados({ tipo: 'entreno', ini: '18:00', fin: '19:00', esp: [1, 2] }) === 60 &&
       P._cqMinutosOcupados({ tipo: 'entreno', ini: '18:00', fin: '19:00', esp: [1] }) === 60,
       'una hora es una hora, ocupe uno o dos espacios');

    ok('16i-bis · …y el ejemplo exacto que dio el autor',
       P._cqMinutosOcupados({ tipo: 'entreno', ini: '16:30', fin: '18:00', esp: [1, 2, 3, 4] }) === 90,
       '16:30→18:00 en los 4 sectores = 90 min, no 360');

    ok('16j · 🚌 ejecutable: un partido fuera NO suma ocupación',
       P._cqMinutosOcupados({ tipo: 'partido_fuera', ini: '10:00', fin: '12:00', esp: [1, 2] }) === 0);

    ok('16k · ⚠️ y una hora mal puesta tampoco rompe la suma',
       P._cqMinutosOcupados({ tipo: 'entreno', ini: '19:00', fin: '18:00', esp: [1] }) === 0 &&
       P._cqMinutosOcupados({ tipo: 'entreno', ini: '', fin: '', esp: [1] }) === 0);

    // ⚠️ Y el papel tiene que EXPLICAR la regla nueva. La frase anterior decía
    //    que una hora en dos espacios contaba como dos: dejarla habría hecho
    //    que el documento del Ayuntamiento contradijera a su propio total.
    ok('16l · el papel explica cómo se cuenta el total (o el técnico municipal no lo entiende)',
       /suma la <strong>duración real<\/strong> de cada sesión/.test(CQ) &&
       !/cuenta como dos horas de campo/.test(CQ));

    ok('16m · 🚌 los desplazamientos se listan aparte y se dice que no computan',
       /Desplazamientos \(no ocupan instalaciones\)/.test(CQ),
       'si un equipo desapareciera sin explicación, preguntarían por qué');

    ok('16n · ⚠️ el coordinador exporta SÓLO su ámbito…',
       /window\.cqExportar = function[\s\S]{0,4000}const filas = _cqFilasVisibles\(st\.doc\.filas\);/.test(CQ),
       'no puede firmar la ocupación del F11 si no la gestiona él');

    ok('16ñ · …y el papel DICE cuál es ese ámbito',
       /Ámbito: ' \+ window\._cronosCoordScopeLabel\(alcance\)/.test(CQ),
       'un documento acotado que no declara su alcance parece un cuadrante incompleto');

    ok('16o · ⚠️ exportar con cambios sin guardar AVISA de que se imprime lo visible',
       /Guarda los cambios antes de exportar/.test(CQ));

    ok('16p · el papel distingue un cuadrante enviado de un borrador',
       /Cuadrante sin enviar \(borrador\)/.test(CQ));
}

// ══════════════════════════════════════════════════════════════════════
//  v606 · LOS DOS AJUSTES DE LAS CAPTURAS 9417-9419
// ══════════════════════════════════════════════════════════════════════

// ── 17. LA PARRILLA CABE EN LA PANTALLA ───────────────────────────────
console.log('\n17) 📐 v606 · Sin scroll horizontal en "Por equipos" (punto 1)');
{
    ok('17a · 🔑🔑 la tabla YA NO tiene ancho mínimo: era lo que forzaba el scroll',
       !/min-width:1120px/.test(CQ_COD) && !/min-width:132px/.test(CQ_COD) &&
       !/min-width:520px/.test(CQ_COD));

    ok('17b · 🔑 las ocho columnas se reparten el ancho con `colgroup` en %',
       /<colgroup><col style="width:15%;">/.test(CQ_COD) &&
       /new Array\(7\)\.fill\('<col style="width:12\.14%;">'\)/.test(CQ_COD),
       '15% + 7×12,14% = 100%: la categoría y los siete días, siempre juntos');

    ok('17c · con `table-layout:fixed`, que es lo que hace que los % manden',
       /table-layout:fixed/.test(CQ_COD));

    ok('17d · 🔑🔑 lo que cede es el TAMAÑO DE LETRA, no el ancho',
       /function _cqBaseFuente/.test(CQ_COD) && /font-size:' \+ base \+ 'px/.test(CQ_COD),
       'meter ocho columnas con la letra de antes reintroduciría el texto partido de v604');

    ok('17e · 🔑 ejecutable: pantalla estrecha → letra pequeña; pantalla grande → letra grande',
       (() => {
           const f = sb.window.__baseFuente;
           if (typeof f !== 'function') return false;
           sb.window.innerWidth = 420;  const chica  = f();
           sb.window.innerWidth = 800;  const media  = f();
           sb.window.innerWidth = 1600; const grande = f();
           sb.window.innerWidth = 1200;
           return chica < media && media < grande;
       })(), (() => {
           const f = sb.window.__baseFuente; if (typeof f !== 'function') return 'sin _cqBaseFuente';
           sb.window.innerWidth = 420; const a = f();
           sb.window.innerWidth = 1600; const b = f();
           sb.window.innerWidth = 1200; return { px420: a, px1600: b };
       })());

    ok('17f · ⚠️ ejecutable: nunca baja de 7 px ni pasa de 15, sea cual sea la pantalla',
       (() => {
           const f = sb.window.__baseFuente;
           if (typeof f !== 'function') return false;
           const ok2 = [200, 320, 420, 768, 1024, 1440, 2560, 5000].every(w => {
               sb.window.innerWidth = w; const v = f();
               return v >= 7 && v <= 15;
           });
           sb.window.innerWidth = 1200;
           return ok2;
       })());

    ok('17g · ⚠️ con SUELO y TECHO: el zoom manual no puede devolver el scroll',
       /Math\.min\(15, Math\.max\(7, px\)\)/.test(CQ_COD) &&
       /CQ_ZOOM_MIN\s*=\s*0\.7/.test(CQ_COD) && /CQ_ZOOM_MAX\s*=\s*1\.4/.test(CQ_COD));

    ok('17h · el zoom que pidió el autor existe y se recuerda',
       /window\.cqZoom = function/.test(CQ_COD) && /localStorage\.setItem\(CQ_ZOOM_KEY/.test(CQ_COD));

    ok('17i · ⚠️ y si el navegador no deja guardar, sigue funcionando',
       /catch \(e\) \{ return 1; \}/.test(CQ_COD));

    ok('17j · los botones de zoom se apagan al llegar al tope',
       /z <= CQ_ZOOM_MIN \+ 0\.001/.test(CQ_COD) && /z >= CQ_ZOOM_MAX - 0\.001/.test(CQ_COD));

    ok('17k · 🔑 TODO lo de dentro de la casilla va en `em`, para que el zoom lo escale entero',
       !/font-size:0\.\d+rem/.test(_seccion(CQ_COD, 'function _cqHtmlCelda', '\n}')),
       'con `rem` la casilla no se entera del zoom y desborda');

    ok('17l · en pantalla estrecha los días se abrevian, para no ensanchar la columna',
       /base < 10 \? CQ_DIAS_CORTO\[i\] : CQ_DIAS\[i\]/.test(CQ_COD));

    ok('17m · ⚠️ el `overflow-x` se queda como red de seguridad, no como diseño',
       /overflow-x:auto/.test(CQ_COD));
}

// ── 18. LOS EQUIPOS QUE CHOCAN, DENTRO DE LA CELDA ROJA ───────────────
console.log('\n18) 🔴 v606 · La celda roja dice QUÉ equipos chocan (punto 2)');
{
    ok('18a · 🔑🔑 las franjas contiguas con los mismos ocupantes se FUSIONAN en una celda',
       /rowspan="' \+ b\.filas \+ '"/.test(CQ_COD),
       'el dato ya se calculaba: no cabía en un <td> de 15px con overflow:hidden');

    ok('18b · el agrupado usa la FIRMA de ocupantes, no sólo "hay algo"',
       /const firma = lista\.map\(x => x\.fila\.id\)\.sort\(\)\.join\('\+'\);/.test(CQ_COD) &&
       /if \(actual && actual\.firma === firma\)/.test(CQ_COD),
       'si a mitad de sesión entra un segundo equipo, el rojo empieza AHÍ, no antes');

    ok('18c · las franjas que tapa un rowspan no se vuelven a pintar',
       /if \(cubierto\[e\]\[t\]\) continue;/.test(CQ_COD));

    ok('18d · 🔴🔴 dentro de la celda roja van los NOMBRES de los equipos, uno por línea',
       /⚠️ CONFLICTO<\/div>'/.test(CQ_COD) &&
       /b\.items\.map\(x => '<div style="font-weight:800;overflow-wrap:break-word;word-break:normal;">' \+\s*_cqE\(x\.fila\.label\)/.test(CQ_COD),
       'era la petición literal del autor sobre la captura 9419');

    ok('18e · ⚠️ y NO con `nowrap` ni `overflow:hidden`, que es lo que los recortaba',
       !/overflow:hidden/.test(_seccion(CQ_COD, 'const th = ', "html += '</tbody></table></div>';")),
       'la celda tiene que poder crecer para que quepan los dos nombres');

    ok('18f · 🔑 en un conflicto manda el conflicto, no el detalle de un solo equipo',
       /const dentro = choque[\s\S]{0,120}⚠️ CONFLICTO/.test(CQ_COD));

    ok('18g · el `title` también nombra a los dos, con su espacio y su hora',
       /'⚠️ Conflicto en el espacio ' \+ e \+ ' \(' \+ rango \+ '\): ' \+/.test(CQ_COD) &&
       /b\.items\.map\(x => x\.fila\.label\)\.join\(' y '\)/.test(CQ_COD));

    ok('18h · 🔑 y hay una LISTA de conflictos arriba: quién, qué espacio y a qué hora',
       /conflictos\.map\(b =>/.test(CQ_COD) && /🏟️ <strong>Espacio ' \+ b\.espacio/.test(CQ_COD),
       'resolverlo sin ir casilla por casilla');

    ok('18i · ⚠️ el recuento son CONFLICTOS, no franjas de 15 minutos',
       /conflictos\.length \+ '<\/strong> conflicto\(s\)/.test(CQ_COD) &&
       !/Object\.keys\(ocup\)\.filter\(k => ocup\[k\]\.length > 1\)\.length/.test(CQ_COD),
       'un solape de una hora decía "4 franjas" y sonaba a cuatro problemas distintos');

    ok('18j · 🔑 se sigue sin bloquear el guardado (era una decisión de v603)',
       /no se bloquea el guardado/.test(CQ_COD));

    ok('18k · ⚠️ y un partido FUERA sigue sin poder entrar en un conflicto (v605)',
       /if \(meta\.ocupa === false\) \{ visitante\.push\(item\); return; \}/.test(CQ_COD),
       'las dos correcciones tienen que convivir: el rojo sólo por ocupación real');
}

// ══════════════════════════════════════════════════════════════════════
//  v607 · LOS DOS AJUSTES DE LAS CAPTURAS 9421-9423
// ══════════════════════════════════════════════════════════════════════

// ── 19. UN PARTIDO EN CASA OCUPA EL CAMPO ─────────────────────────────
console.log('\n19) 🏟️ v607 · El partido en casa se pinta en la ocupación (punto 1)');
{
    ok('19a · el tipo lo lleva escrito: un partido en casa ocupa el campo completo',
       P.CQ_TIPOS.partido_casa.campoCompleto === true &&
       !P.CQ_TIPOS.entreno.campoCompleto && !P.CQ_TIPOS.otro.campoCompleto &&
       !P.CQ_TIPOS.partido_fuera.campoCompleto);

    ok('19b · 🔴🔴 ejecutable: partido en CASA sin espacios marcados → ocupa TODOS',
       (() => {
           const e = P._cqEspaciosDe({ tipo: 'partido_casa', ini: '09:00', fin: '11:00', esp: [] }, 4);
           return e.length === 4 && e.join(',') === '1,2,3,4';
       })(), 'era el caso de las capturas: se quedaba en "Sin espacio asignado"');

    ok('19c · 🔑 pero si el director marca espacios, mandan los SUYOS',
       P._cqEspaciosDe({ tipo: 'partido_casa', esp: [1, 2] }, 4).join(',') === '1,2',
       'dos partidos de F7 en las dos mitades del campo');

    ok('19d · ⚠️ un ENTRENO sin espacios sigue sin ocupar (es un hueco del cuadrante)',
       P._cqEspaciosDe({ tipo: 'entreno', esp: [] }, 4).length === 0 &&
       P._cqEspaciosDe({ tipo: 'otro', esp: [] }, 4).length === 0);

    ok('19e · 🚌 y un partido FUERA sigue sin ocupar NADA, ni por defecto (v605)',
       P._cqEspaciosDe({ tipo: 'partido_fuera', esp: [] }, 4).length === 0 &&
       P._cqEspaciosDe({ tipo: 'partido_fuera', esp: [1, 2] }, 4).length === 0,
       'las dos reglas tienen que convivir');

    ok('19f · 🔑 _cqOcupaCampo tiene UNA sola puerta: delega en _cqEspaciosDe',
       /function _cqOcupaCampo\(c, nEsp\) \{\s*return _cqEspaciosDe\(c, nEsp\)\.length > 0;/.test(CQ_COD),
       'dos criterios para lo mismo es como se separan las verdades en este proyecto');

    // 🔴 Lo que fijó v607 y SIGUE EN PIE: un partido en casa sin espacios
    //    marcados ocupa igual (antes daba CERO y el partido oficial del fin de
    //    semana no constaba en el informe). Lo que cambia en v620 es sólo la
    //    CANTIDAD: dos horas son 120 minutos, no 2 h × 4 espacios.
    ok('19g · 🔴🔴 ejecutable: el partido en casa sin espacios marcados SIGUE contando',
       P._cqMinutosOcupados({ tipo: 'partido_casa', ini: '09:00', fin: '11:00', esp: [] }, 4) === 120,
       'la duración de la franja; lo que no puede es dar CERO');

    ok('19h · ejecutable: y con espacios marcados vale lo mismo, porque el tiempo es el mismo',
       P._cqMinutosOcupados({ tipo: 'partido_casa', ini: '09:00', fin: '11:00', esp: [1, 2] }, 4) === 120);

    // 🏟️ v620 · CÓMO SE NOMBRAN LOS SECTORES (encargo del autor).
    //  "1, 2" no le dice a nadie —y menos al técnico municipal— que eso es
    //  medio campo.
    ok('19k · 🏟️ un sector es un cuarto de campo',
       /^Cuarto de campo/.test(P._cqNombreEspacios([3], 4)), P._cqNombreEspacios([3], 4));
    ok('19l · dos sectores son medio campo',
       /^Medio campo/.test(P._cqNombreEspacios([1, 2], 4)) &&
       /^Medio campo/.test(P._cqNombreEspacios([3, 4], 4)),
       'da igual QUÉ mitad: dos sectores son media');
    ok('19m · tres sectores son 3/4 de campo',
       /^3\/4 de campo/.test(P._cqNombreEspacios([2, 3, 4], 4)));
    ok('19n · los cuatro son el campo completo',
       P._cqNombreEspacios([1, 2, 3, 4], 4) === 'Campo completo',
       'y sin números detrás: son todos, sobran');
    // ⚠️ Los números SE CONSERVAN salvo con el campo entero. Sin ellos, dos
    //    equipos a la misma hora ponen "Medio campo" los dos y no hay forma de
    //    ver si van en mitades distintas o chocan — que es para lo que existe
    //    el cuadrante.
    ok('19o · ⚠️ y se dice QUÉ sectores, o no se ve si dos equipos chocan',
       P._cqNombreEspacios([1, 2], 4) === 'Medio campo (1, 2)' &&
       P._cqNombreEspacios([3, 4], 4) === 'Medio campo (3, 4)');
    // ⚠️ Los nombres describen un campo de CUATRO. Con otra configuración
    //    describirían algo que no existe.
    ok('19p · ⚠️ con un campo que no sea de 4 sectores se cae a la lista',
       P._cqNombreEspacios([1, 2], 6) === '1, 2');
    ok('19q · sin espacios no inventa nombre', P._cqNombreEspacios([], 4) === '');

    ok('19i · el papel del Ayuntamiento usa los espacios efectivos, no `c.esp`',
       /const espL  = _cqEspaciosDe\(c, nEsp\);/.test(CQ_COD) &&
       /_cqMinutosOcupados\(c, nEsp\)\) ocupan\.push\(\{ f, c, esp: _cqEspaciosDe\(c, nEsp\) \}\)/.test(CQ_COD));

    ok('19j · 🔑 "campo completo" se distingue de haber elegido los cuatro a mano',
       /function _cqEspacioImplicito/.test(CQ_COD) && /'campo completo'/.test(CQ_COD),
       'no es lo mismo lo que el sistema asume que lo que una persona decidió');

    ok('19k · ejecutable: sólo es implícito cuando NADIE marcó nada',
       P._cqEspacioImplicito({ tipo: 'partido_casa', esp: [] }) === true &&
       P._cqEspacioImplicito({ tipo: 'partido_casa', esp: [1, 2, 3, 4] }) === false &&
       P._cqEspacioImplicito({ tipo: 'entreno', esp: [] }) === false);

    ok('19l · ⚠️ el editor lo AVISA antes de guardar, no después',
       /un partido en casa ocupa el CAMPO COMPLETO/.test(CQ_COD),
       'si el sistema asume algo, hay que enterarse mientras se puede cambiar');

    ok('19m · y el aviso se actualiza al marcar o desmarcar un espacio',
       /class="cq-esp" onchange="cqTipoCambiado\(\)"/.test(CQ_COD));

    ok('19n · 🔑 el entrenador recibe los espacios YA resueltos, sin repetir la regla',
       /espEfectivos: _cqEspaciosDe\(c, d\.espacios \|\| CQ_ESPACIOS\)/.test(CQ_COD) &&
       /espCompleto:  _cqEspacioImplicito\(c\)/.test(CQ_COD),
       'sería la cuarta copia de la misma regla');

    ok('19ñ · y el resumen del aviso también',
       /const espL = _cqEspaciosDe\(c\);/.test(CQ_COD) && /' · campo completo'/.test(CQ_COD));
}

// ── 20. COPIAR LA SEMANA COMPLETA ─────────────────────────────────────
console.log('\n20) 🗓️ v607 · Copiar y pegar la semana entera (punto 2)');
{
    ok('20a · existen copiar, pegar y olvidar',
       /window\.cqCopiarSemana = function/.test(CQ_COD) &&
       /window\.cqPegarSemana = function/.test(CQ_COD) &&
       /window\.cqOlvidarSemana = function/.test(CQ_COD));

    ok('20b · 🔑🔑 se guarda por ÍNDICE DE DÍA, no por fecha',
       /entradas\.push\(\{ filaId: f\.id, dia: i,/.test(CQ_COD) &&
       /const fecha = _cqFechaKey\(new Date\(lunes\.getTime\(\) \+ en\.dia \* 86400000\)\);/.test(CQ_COD),
       'copiar las claves con su fecha metería casillas de la semana origen en el documento de la destino');

    ok('20c · 🔑🔑 SÓLO se copian las filas que este usuario VE',
       /const visibles = _cqFilasVisibles\(st\.doc\.filas\);\s*const entradas = \[\];/.test(CQ_COD),
       'un coordinador de F7 no puede llevarse los equipos de F11');

    // ⚠️ SE COMPRUEBA LA PROPIEDAD, NO LA REDACCIÓN. La v615 reescribió este
    // recorrido para apartar los partidos, y una aserción atada a la forma
    // exacta del `filter` anterior se puso roja sin que nada se hubiera roto.
    // Lo que hay que exigir es que las dos mitades —lo que se BORRA y lo que
    // se ESCRIBE— sigan pasando por `idsVisibles`.
    ok('20d · 🔴🔴 y al pegar, las filas fuera de su alcance NO se tocan',
       /if \(!idsVisibles\[en\.filaId\]\) return;/.test(CQ_COD) &&
       /Object\.keys\(st\.doc\.celdas\)\.forEach\(k => \{[\s\S]{0,220}if \(!idsVisibles\[filaId\]\) return;/.test(CQ_COD),
       'sobrescribir en masa lo que no se ve es donde más daño haría el fallo de alcance');

    ok('20e · el portapapeles vive en localStorage y sobrevive al cambio de semana',
       /CQ_SEMANA_KEY = 'cronos_cq_semana'/.test(CQ_COD) &&
       /localStorage\.setItem\(CQ_SEMANA_KEY/.test(CQ_COD),
       'copiar, navegar y pegar es el flujo entero: si muriera al repintar no serviría de nada');

    ok('20f · ⚠️ y si el navegador no deja leerlo, no rompe la pantalla',
       /function _cqSemanaCopiada\(\)[\s\S]{0,320}catch \(e\) \{ return null; \}/.test(CQ_COD));

    ok('20g · 🔴 pegar encima de una semana con contenido PREGUNTA antes, y dice cuánto',
       /Esta semana ya tiene ' \+ yaHabia\.length \+/.test(CQ_COD) &&
       /se SUSTITUIRÁN/.test(CQ_COD));

    ok('20h · ⚠️ pegar sobre la MISMA semana que se copió se rechaza',
       /if \(p\.weekKey === st\.doc\.weekKey\)/.test(CQ_COD));

    ok('20i · 🔑 las filas libres del origen se CREAN en el destino si no existen',
       /st\.doc\.filas\.push\(\{ id: f\.id, tipo: f\.tipo, cat: f\.cat, sub: f\.sub, label: f\.label \}\);/.test(CQ_COD),
       'si no, las celdas de "Porteros" o "Fisio" no tendrían fila donde salir');

    ok('20j · ⚠️ pegar NO guarda: marca sucio y el autor revisa',
       /window\.cqPegarSemana[\s\S]{0,2600}st\.sucio = true;/.test(CQ_COD) &&
       !/window\.cqPegarSemana[\s\S]{0,2600}_cqGuardar\(/.test(CQ_COD));

    ok('20k · copiar una semana vacía avisa en vez de dejar un portapapeles inútil',
       /Esta semana está vacía: no hay nada que copiar/.test(CQ_COD));

    ok('20l · 🔑 el botón de pegar dice DE QUÉ SEMANA es',
       /PEGAR SEMANA[\s\S]{0,140}_cqE\(_semCopiada\.etiqueta\)/.test(CQ_COD),
       'pegar a ciegas una semana entera encima de otra sería temerario');

    ok('20m · y sólo aparece cuando hay algo copiado',
       /\(_semCopiada\s*\n?\s*\? '<span/.test(CQ_COD));

    // 🔄 v615 · ESTA ASERCIÓN CAMBIÓ DE SIGNO A PROPÓSITO. Hasta la v614 el
    // aviso decía «después tendrás que ajustar los partidos del fin de
    // semana», porque el pegado se los llevaba por delante. Ahora los partidos
    // no se tocan, así que ese texto sería un consejo FALSO: mandaría a
    // revisar algo que ya está bien. Lo que hay que prometer es lo contrario.
    ok('20n · se avisa de que los partidos oficiales quedan intactos',
       /partido\(s\) oficiales de esta semana NO se tocan/.test(CQ_COD) &&
       !/ajustar los partidos del fin de semana/.test(CQ_COD),
       'el aviso tiene que describir lo que hace la v615, no lo que hacía la v614');

    ok('20ñ · ⚠️ una copia guardada corrupta se ignora, no revienta el panel',
       /if \(!v \|\| !Array\.isArray\(v\.entradas\) \|\| !v\.entradas\.length\) return null;/.test(CQ_COD));
}

// ── 21. "CAMPO COMPLETO" DENTRO DE LA CASILLA ─────────────────────────
console.log('\n21) 📐 v608 · "campo completo" ya no se sale de la casilla (captura 9425)');
{
    const CELDA = _seccion(CQ_COD, 'function _cqHtmlCelda', '\n}');

    ok('21a · 🔑🔑 la casilla es un contenedor de verdad, no una caja anónima de <button>',
       /display:flex;flex-direction:column;justify-content:center;align-items:stretch;/.test(CELDA),
       'un <button> sin `display` centra su contenido en una caja anónima que NO crece: el sobrante se sale por abajo');

    ok('21b · y el relleno no se suma a la altura',
       /box-sizing:border-box/.test(CELDA));

    // 📅 v609 · Esta aserción esperaba TRES casillas y saltó al añadirse la
    // cuarta (el partido oficial propuesto por el calendario). Hizo justo lo
    // que tenía que hacer, así que no se relaja: se cuenta CONTRA EL NÚMERO DE
    // CASILLAS QUE HAYA, que es lo que de verdad quería decir. Un número fijo
    // habría que subirlo cada vez, y "subir el número hasta que pase" es como
    // un guard deja de proteger nada.
    const _nBotones = (CELDA.match(/'<button onclick="' \+ abrir \+ '"/g) || []).length;
    ok('21c · 🔑 la misma caja para TODAS las casillas (vacía, modo pegar, propuesta y con contenido)',
       _nBotones >= 4 && (CELDA.match(/style="' \+ CAJA \+ '/g) || []).length === _nBotones,
       'si sólo se arreglara la que desbordaba, la siguiente línea que se añada repetiría el defecto');

    ok('21d · ⚠️ el rótulo largo YA NO lleva `nowrap`: puede pasar a dos líneas',
       /espCompleto \? 'overflow-wrap:break-word;word-break:normal;' : 'white-space:nowrap;'/.test(CELDA),
       '"campo completo" son 16 caracteres; con nowrap empujaba la casilla');

    ok('21e · …pero el numérico SÍ lo conserva',
       /white-space:nowrap;'\)/.test(CELDA),
       '"1·2·3" partido a la mitad no se lee');

    ok('21f · y va un punto más pequeño, como pidió el autor',
       /font-size:' \+ \(espCompleto \? '0\.76em' : '0\.88em'\)/.test(CELDA));

    ok('21g · ⚠️ el tamaño sigue en `em`: el zoom de v606 lo escala igual que el resto',
       !/font-size:0\.\d+rem/.test(CELDA));

    ok('21h · 🔑 y "campo completo" se sigue distinguiendo de los espacios elegidos a mano',
       /espCompleto \? 'campo completo'/.test(CELDA) && /_cqEspacioImplicito\(c\)/.test(CELDA),
       'el arreglo visual no puede borrar la distinción que trajo la v607');
}

// ════════════════════════════════════════════════════════════════════════
console.log('\n22 · 🔴 v612 · LA LISTA DE EQUIPOS ES DEL CLUB, NO DE LA SEMANA');
// ════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt, 2026-08-24): «al asignar o añadir la
//  categoría y el equipo, guardar y volver a abrir, los datos desaparecen y no
//  se quedan retenidos de forma permanente».
//
//  🔑 `filas` se guardaba DENTRO de `CUADRANTE__{weekKey}`. Añadir el Juvenil A
//  y guardar lo escribía en la semana del 24 de agosto y sólo ahí; al pasar de
//  semana no había documento y la lista se rehacía desde `_cqFilasPorDefecto`,
//  que sólo devuelve equipos CON PLANTILLA PUBLICADA. El equipo se esfumaba.
//
//  🔑🔑 Y ES LO QUE ROMPÍA EL CALENDARIO. Los partidos importados se guardan
//  bajo `filaId` y el gestor lista `st.doc.filas`: un equipo que no sobrevive a
//  cambiar de semana no tiene fila donde pintar su partido. La temporada
//  quedaba bien guardada en Firestore y NO SE VEÍA NADA — indistinguible de
//  "la importación no funciona", que es justo como se reportó.
{
    ok('22a · la lista vive en un documento HERMANO, fuera de la semana',
       P.CQ_DOC_FILAS === 'CUADRANTE__FILAS', P.CQ_DOC_FILAS);

    // ⚠️⚠️ La misma trampa que ya vigila la aserción 1 para el cuadrante:
    // `TrainingSync.deleteWeek()` hace deleteDoc del documento ENTERO. Si este
    // id pudiera confundirse con una fecha de semana, un entrenador pulsando
    // "🗑️ LIMPIAR" se llevaría por delante los equipos de todo el club.
    ok('22b · ⚠️ y su id NO puede parecerse a una fecha de semana',
       !/^\d{4}-\d{2}-\d{2}$/.test(P.CQ_DOC_FILAS.replace('CUADRANTE__', '')));

    // 🔑 CERO REGLAS NUEVAS: el comodín {weekKey} ya cubre este id. Cualquier
    // otra ubicación caería en el `allow read, write: if false` del final, y en
    // este proyecto las reglas NO se pueden probar antes de desplegarlas.
    ok('22c · 🔑 cae bajo la regla de weeks que ya existe (cero reglas nuevas)',
       /match \/trainingPlans\/\{clubId\}\/weeks\/\{weekKey\}/.test(RULES));

    const F = P._cqFilasEfectivas;
    const club = [
        { id: 'juvenil__A', tipo: 'equipo', cat: 'juvenil', sub: 'A', label: 'Juvenil A' },
        { id: 'cadete__B',  tipo: 'equipo', cat: 'cadete',  sub: 'B', label: 'Cadete B' },
    ];

    // 🔴 EL DEFECTO, EN UNA LÍNEA: semana sin documento propio → antes salían
    // las filas por defecto y el equipo añadido no estaba. Ahora manda el club.
    const nueva = F(club, [], {});
    ok('22d · 🔴 una semana SIN documento hereda los equipos del club',
       nueva.length === 2 && nueva[0].id === 'juvenil__A', nueva.map(f => f.id));

    // Y el orden que el club fijó con ▲▼ se respeta: no se reordena solo.
    ok('22e · en el orden que el club fijó',
       F(club, [], {}).map(f => f.id).join(',') === 'juvenil__A,cadete__B');

    // Una semana vieja trae su propia lista: manda la del club igualmente,
    // o el equipo nuevo seguiría sin aparecer en las semanas ya guardadas.
    const vieja = F(club, [{ id: 'cadete__B', tipo: 'equipo', cat: 'cadete', sub: 'B', label: 'Cadete B' }], {});
    ok('22f · la lista del club MANDA sobre la que traía la semana',
       vieja.length === 2 && vieja.some(f => f.id === 'juvenil__A'), vieja.map(f => f.id));

    // ⚠️⚠️ PERO UN DATO QUE EXISTE NO PUEDE VOLVERSE INVISIBLE. Si en marzo se
    // cuadró un equipo que hoy ya no está en la lista, sus casillas siguen en
    // el documento: sin esta salvaguarda, quitar un equipo HOY borraría de la
    // vista —que no de la base— el trabajo de aquella semana, sin avisar.
    const conHistoria = F(club,
        [{ id: 'libre_x9', tipo: 'libre', cat: '', sub: '', label: 'Porteros' }],
        { 'libre_x9|2026-03-10': { tipo: 'entreno' } });
    ok('22g · ⚠️⚠️ una fila que ya no está en el club pero TIENE casillas, se conserva',
       conHistoria.some(f => f.id === 'libre_x9'), conHistoria.map(f => f.id));

    ok('22h · …y una que ya no está y NO tiene casillas, no vuelve',
       !F(club, [{ id: 'libre_x9', tipo: 'libre', cat: '', sub: '', label: 'Porteros' }], {})
            .some(f => f.id === 'libre_x9'));

    // Sin lista de club todavía (o si su lectura falló) se sigue con lo que
    // traiga la semana: esto NUNCA puede dejar el cuadrante en blanco.
    ok('22i · ⚠️ sin lista de club, se respeta la de la semana (no se vacía)',
       F([], [{ id: 'infantil__A', tipo: 'equipo', cat: 'infantil', sub: 'A', label: 'Infantil A' }], {})
            .length === 1);
    ok('22j · …y con la lista a null tampoco se vacía',
       F(null, [{ id: 'infantil__A', tipo: 'equipo', cat: 'infantil', sub: 'A', label: 'Infantil A' }], {})
            .length === 1);

    // Sólo se guarda lo que DEFINE una fila: el objeto de pintado no puede
    // acabar en un documento que leen todos los coordinadores.
    const limpia = P._cqFilaLimpia({ id: 'a', tipo: 'equipo', cat: 'c', sub: 's', label: 'L', basura: 1, _dom: {} });
    ok('22k · la fila que se guarda no arrastra basura de pintado',
       Object.keys(limpia).sort().join(',') === 'cat,id,label,sub,tipo', Object.keys(limpia));

    // ── Y que el enganche esté puesto de verdad ──────────────────────
    ok('22l · guardar el cuadrante guarda TAMBIÉN la lista del club',
       /_cqGuardarFilasClub\(clubId, st\.doc\.filas\)/.test(CQ_COD));

    // ⚠️ En su propio try: si falla la lista, la semana ya está a salvo. Que
    // una escritura secundaria tumbe el guardado del trabajo sería peor que
    // el defecto que arregla.
    ok('22m · ⚠️ y si eso falla, la semana ya está guardada (try aparte)',
       /await _cqGuardar\(clubId, st\.doc\);[\s\S]{0,200}?try \{ await _cqGuardarFilasClub/.test(CQ_COD));

    ok('22n · al abrir una semana se lee la lista del club',
       /_cqLeerFilasClub\(clubId\)/.test(CQ_COD) && /_cqFilasEfectivas\(filasClub/.test(CQ_COD));

    // 🔑 Migración: un club que ya usaba el cuadrante tiene sus equipos dentro
    // de la semana y ninguno en el documento del club. Se siembra solo.
    ok('22o · 🔑 los clubes que ya venían usándolo migran solos',
       /!filasClub\.length && leido\.filas\.length/.test(CQ_COD));

    // ⚠️ …pero NUNCA tras un fallo de lectura: sembrar ahí machacaría la
    // composición real del club con la de una sola semana por un corte de red.
    ok('22p · ⚠️ y no se siembra si la LECTURA falló (null ≠ vacío)',
       /st\.filasClub !== null && !filasClub\.length/.test(CQ_COD));

    // 🔗 El calendario depende de esto: su gestor lista `st.doc.filas`.
    ok('22q · 🔗 el gestor de calendarios sigue leyendo esas filas',
       /st\.doc\.filas/.test(sinCom(leer('js/coach/reports/calendario-temporada.js'))));
}

// ════════════════════════════════════════════════════════════════════════
console.log('\n23 · 🔴 v615 · COPIAR SEMANA NO SE LLEVA NI PISA LOS PARTIDOS');
// ════════════════════════════════════════════════════════════════════════
//  Petición del autor (implementar.txt, 2026-08-24), con la razón exacta: «los
//  partidos oficiales cambian de día cada semana — una semana se juega en casa
//  un viernes y a la siguiente un sábado». Está en el calendario que se acaba
//  de importar: el Estrella CF juega la J7 un sábado a las 11:00 y la J8 un
//  viernes a las 21:00.
//
//  🔴 El defecto era DOBLE, y las dos mitades hacían daño por separado:
//   1. La copia se LLEVABA el partido del viernes de la semana origen.
//   2. Y el pegado VACIABA la semana destino entera, cargándose el partido del
//      sábado que ya estaba bien puesto, para plantarle encima el del viernes.
//  Resultado: el partido en el día equivocado, en la pauta que siguen todos
//  los entrenadores y en el papel de ocupación que se manda al Ayuntamiento.
{
    ok('23a · un partido se reconoce por su tipo, en casa y fuera',
       P._cqEsPartido({ tipo: 'partido_casa' }) && P._cqEsPartido({ tipo: 'partido_fuera' }));
    ok('23b · …y un entrenamiento no lo es',
       !P._cqEsPartido({ tipo: 'entreno' }) && !P._cqEsPartido({ tipo: 'otro' }) && !P._cqEsPartido(null));

    const COPIA = _seccion(CQ_COD, 'window.cqCopiarSemana', 'window.cqPegarSemana');
    const PEGA  = _seccion(CQ_COD, 'window.cqPegarSemana',  'window.cqOlvidarSemana');

    // 1 · La copia deja el partido fuera del paquete.
    ok('23c · 🔴 copiar NO mete los partidos en el paquete',
       /if \(_cqEsPartido\(c\)\) \{ partidosFuera\+\+; return; \}/.test(COPIA), 'la copia sigue llevándose los partidos');
    ok('23d · …y se dice cuántos se han quedado fuera',
       /partidosFuera \?/.test(COPIA));

    // 2 · El pegado NO borra los partidos del destino.
    ok('23e · 🔴🔴 al vaciar el destino, los partidos se apartan',
       /if \(_cqEsPartido\(st\.doc\.celdas\[k\]\)\) partidosDestino\.push\(k\);\s*\n\s*else yaHabia\.push\(k\);/.test(PEGA),
       'el vaciado sigue arrasando con los partidos');
    ok('23f · y sólo se borra lo que NO es partido',
       /yaHabia\.forEach\(k => \{ delete st\.doc\.celdas\[k\]; \}\)/.test(PEGA) &&
       !/partidosDestino\.forEach\(k => \{ delete/.test(PEGA));

    // 3 · Y tampoco se escribe ENCIMA de un partido del destino.
    //  ⚠️ Esta es la mitad que se escapa fácil: aunque el paquete ya no traiga
    //  partidos, el entrenamiento del martes de la semana origen puede caer
    //  justo donde ESTA semana hay partido.
    ok('23g · ⚠️ un entrenamiento no se escribe encima de un partido',
       /if \(_cqEsPartido\(st\.doc\.celdas\[clave\]\)\) \{ respetados\+\+; return; \}/.test(PEGA),
       'el pegado puede sobrescribir un partido');
    ok('23h · y el aviso previo lo promete por escrito',
       /partido\(s\) oficiales de esta semana NO se tocan/.test(PEGA));
}

// ════════════════════════════════════════════════════════════════════════
console.log('\n24 · ↩️ v615 · DESHACER Y REHACER');
// ════════════════════════════════════════════════════════════════════════
//  Petición del autor: «dar marcha atrás de forma fluida a las últimas
//  acciones». Aquí se pega una semana entera de un clic y se vacían filas con
//  todas sus actividades: sin historial, revertir una de esas operaciones era
//  rehacerla a mano casilla por casilla, o salir sin guardar perdiendo TAMBIÉN
//  todo lo bueno hecho antes.
{
    const W = sb.window;
    const inst = (celdas) => { W._cqState.doc = { weekKey: '2026-08-24', filas: [], celdas: celdas, espacios: P.CQ_ESPACIOS }; };

    inst({ a: { tipo: 'entreno' } });
    P._cqHistInit();
    ok('24a · al abrir hay punto de partida y nada que deshacer',
       !P._cqPuedeDeshacer() && !P._cqPuedeRehacer());

    W._cqState.doc.celdas.b = { tipo: 'entreno' };
    P._cqHistPush('añadir b');
    ok('24b · tras un cambio ya se puede deshacer', P._cqPuedeDeshacer() && !P._cqPuedeRehacer());

    W.cqDeshacer();
    ok('24c · 🔑 deshacer devuelve el cuadrante al estado anterior',
       !W._cqState.doc.celdas.b && !!W._cqState.doc.celdas.a, Object.keys(W._cqState.doc.celdas));
    ok('24d · y entonces se puede rehacer', P._cqPuedeRehacer());

    W.cqRehacer();
    ok('24e · rehacer lo vuelve a traer', !!W._cqState.doc.celdas.b, Object.keys(W._cqState.doc.celdas));

    // ⚠️ Una acción que no cambia nada no puede gastar un paso: si no,
    // "deshacer" dejaría de hacer nada visible y parecería roto.
    const antes = W._cqState.hist.pila.length;
    P._cqHistPush('sin efecto');
    ok('24f · ⚠️ una acción que no cambia nada no gasta un paso',
       W._cqState.hist.pila.length === antes, [antes, W._cqState.hist.pila.length]);

    // 🔑 Escribir después de deshacer corta la rama de rehacer.
    W.cqDeshacer();
    W._cqState.doc.celdas.c = { tipo: 'otro' };
    P._cqHistPush('añadir c');
    ok('24g · 🔑 al escribir tras deshacer se pierde el rehacer pendiente', !P._cqPuedeRehacer());

    // ⚠️ EL AVISO "● Sin guardar" TIENE QUE DECIR LA VERDAD. Si deshaces hasta
    // volver justo a lo guardado, no hay nada pendiente y el aviso debe irse.
    inst({ a: { tipo: 'entreno' } });
    P._cqHistInit();
    W._cqState.doc.celdas.x = { tipo: 'entreno' };
    P._cqHistPush('cambio');
    W._cqState.sucio = true;
    P._cqHistGuardado();                       // se guarda AQUÍ
    W._cqState.doc.celdas.y = { tipo: 'entreno' };
    P._cqHistPush('otro cambio');
    W._cqState.sucio = true;
    W.cqDeshacer();                            // vuelve al punto guardado
    ok('24h · ⚠️ deshacer hasta lo guardado apaga "sin guardar"',
       W._cqState.sucio === false, W._cqState.sucio);
    W.cqDeshacer();                            // un paso MÁS atrás
    ok('24i · …y un paso más atrás lo vuelve a encender', W._cqState.sucio === true);

    // ⚠️ La pila no puede crecer sin fin en una sesión larga de cuadrar.
    inst({});
    P._cqHistInit();
    for (let i = 0; i < P.CQ_HIST_MAX + 15; i++) {
        W._cqState.doc.celdas['k' + i] = { tipo: 'entreno' };
        P._cqHistPush('c' + i);
    }
    ok('24j · ⚠️ el historial tiene tope y no crece sin fin',
       W._cqState.hist.pila.length <= P.CQ_HIST_MAX, W._cqState.hist.pila.length);
    ok('24k · …y aun así se puede seguir deshaciendo', P._cqPuedeDeshacer());

    // ── Enganches ───────────────────────────────────────────────────
    ok('24l · 🔑 cambiar de semana reinicia el historial',
       /st\.remoto = null;[\s\S]{0,400}?_cqHistInit\(\);/.test(CQ_COD),
       'la pila sobreviviría a la semana que describe');
    ok('24m · 🔑 adoptar el cambio de otra persona también lo reinicia',
       (CQ_COD.match(/_cqHistInit\(\);/g) || []).length >= 3, 'falta algún reinicio');
    ok('24n · guardar fija el punto "sin cambios pendientes"',
       /st\.sucio = false;\s*\n\s*_cqHistGuardado\(\);/.test(CQ_COD));
    ok('24o · los botones están en la barra del cuadrante',
       /_cqBotonesHistorial\(\) \+/.test(CQ_COD));

    // Las acciones que de verdad hacen daño tienen que dejar rastro.
    ['pegar semana', 'fijar ', 'quitar ', 'pegar fila', 'editar casilla', 'vaciar casilla']
        .forEach(acc => ok('24p · queda en el historial: ' + acc.trim(),
            new RegExp('_cqHistPush\\(\'' + acc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(CQ_COD)));

    // ⌨️ Ctrl+Z no puede robarle el deshacer al texto que se está escribiendo.
    ok('24q · ⚠️ el atajo se aparta si estás escribiendo o con un editor abierto',
       /INPUT\|TEXTAREA\|SELECT/.test(CQ_COD) && /getElementById\('cq-overlay'\)/.test(_seccion(CQ_COD, 'function _cqTeclas', 'function _cqBotonesHistorial')));

    // 🔴 Deshacer NO escribe en Firestore: sólo devuelve la pantalla atrás.
    ok('24r · 🔴 deshacer no toca Firestore',
       !/setDoc|getDoc/.test(_seccion(CQ_COD, 'function _cqHistIr', 'function _cqPuedeDeshacer')));
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos === 0) console.log('✅ El club marca la pauta, el entrenador la desarrolla — y el envío se ve');
else console.log('❌ ' + fallos + ' aserción(es) en rojo');
process.exit(fallos === 0 ? 0 : 1);
