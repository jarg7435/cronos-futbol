// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v712 · LA CABECERA DEL INFORME, EN ORDEN DE LOCALÍA
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-14, captura 10396):
//
//    «Si el equipo juega como local (en casa), el formato de visualización
//     debe ser: [Nuestro Equipo] vs [Rival]. Si el equipo juega como
//     visitante (fuera de casa), el formato debe ser: [Rival] vs [Nuestro
//     Equipo]», con el marcador y el veredicto coherentes con ese orden,
//    «evitando que aparezcan marcadores o nombres invertidos (como mostrar un
//     0-2 de victoria pero con el orden del título descolocado respecto a
//     quién metió los goles)».
//
//  🔑 EL «0-2 VICTORIA» DE LA CAPTURA NO ERA UN ERROR DE CUENTAS. El veredicto
//  ya se calculaba desde `myTeamRole` (v707) y ese partido se ganó fuera. Lo
//  que chirriaba es que la tarjeta decía «vs Rival» A SECAS: sin el nombre
//  propio y sin orden, el 0 y el 2 no se podían atribuir a nadie.
//
//  🔑 LA REGLA QUE LO HACE COHERENTE: el marcador SIEMPRE se guarda y se
//  muestra LOCAL–VISITANTE. Basta con que el TÍTULO vaya en ese mismo orden y
//  cada número queda debajo de su nombre. ⚠️ POR ESO EL MARCADOR NO SE DA LA
//  VUELTA: invertirlo «para que mis goles vayan primero» es justo lo que
//  descoloca la lectura, y es el defecto que este fichero impide reintroducir
//  (aserciones 1d y 2d).
//
//  LO QUE VIGILA, y por qué se rompe solo:
//
//   A · UNA SOLA DEFINICIÓN. `cronosEnfrentamiento` (js/core/utils.js) reparte
//       los dos nombres, el marcador y el veredicto. Lo pintan SEIS sitios
//       —tarjetas del entrenador, tarjetas del Director, Área de Familias,
//       cabecera del motor de informes, las descargas y el informe colectivo—
//       y escrito seis veces divergen: es la factura de v433 (`_userCanFollow`)
//       y de v532 (el badge).
//
//   B · EL INFORME ANTIGUO NO CAMBIA DE ORDEN. Sin `myTeamRole` (informes
//       anteriores a v526) se supone LOCAL, que es el comportamiento de
//       siempre: una suposición nueva no puede reescribir un informe viejo.
//
//   C · EL RESPALDO. El motor de informes y las descargas se ejecutan también
//       en arneses donde `utils.js` no está cargado; su respaldo tiene que
//       ordenar igual, o el guard de v707 y esto dirían cosas distintas.
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
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

// Corta un trozo de código emparejando llaves desde el primer '{' tras `desde`.
function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    if (i < 0) return null;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}

const UTILS  = leer('js/core/utils.js');
const ENGINE = leer('js/coach/reports/report-engine.js');
const INDIV  = leer('js/coach/comms/individual-reports.js');
const TAB    = leer('js/coach/reports/reports-tab.js');
const PADRE  = leer('js/parent/panel.js');
const EXPORT = leer('js/coach/reports/reports-export.js');
const COLEC  = leer('js/coach/comms/collective-report.js');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [A] la función del enfrentamiento, EJECUTADA ──');
// ═══════════════════════════════════════════════════════════════════════════
let ENF = null;
{
    const fn = trozo(UTILS, 'function cronosEnfrentamiento(datos, miNombre)');
    ok('1a · se encuentra cronosEnfrentamiento en js/core/utils.js', !!fn);
    ok('1b · se publica UNA sola vez en window',
       (UTILS.match(/window\.cronosEnfrentamiento\s*=/g) || []).length === 1 &&
       (UTILS.match(/function cronosEnfrentamiento\s*\(/g) || []).length === 1,
       'definiciones/exportaciones duplicadas');

    if (fn) {
        const ctx = { console };
        vm.createContext(ctx);
        vm.runInContext(fn + ';\n;globalThis.enf = cronosEnfrentamiento;', ctx);
        ENF = ctx.enf;

        // El partido de la captura 10396: ganado 0-2 FUERA.
        const fuera = ENF({ rival: 'MASPALOMAS', scoreHome: 0, scoreAway: 2, myTeamRole: 'away' },
                          'ARINAGA REGIONAL');
        ok('1c · 🔑 de VISITANTE el título es [Rival] vs [Nuestro Equipo]',
           fuera.titulo === 'MASPALOMAS vs ARINAGA REGIONAL' &&
           fuera.local === 'MASPALOMAS' && fuera.visitante === 'ARINAGA REGIONAL',
           fuera.titulo);
        ok('1d · 🔑🔑 y el marcador NO se da la vuelta: sigue siendo LOCAL-VISITANTE',
           fuera.marcador === '0-2', fuera.marcador);
        ok('1e · mis goles son los del lado visitante → VICTORIA',
           fuera.golesMios === 2 && fuera.golesSuyos === 0 && fuera.veredicto === 'VICTORIA',
           JSON.stringify(fuera));

        const casa = ENF({ rival: 'MASPALOMAS', scoreHome: 3, scoreAway: 1, myTeamRole: 'home' },
                         'ARINAGA REGIONAL');
        ok('1f · en CASA el título es [Nuestro Equipo] vs [Rival]',
           casa.titulo === 'ARINAGA REGIONAL vs MASPALOMAS' &&
           casa.marcador === '3-1' && casa.veredicto === 'VICTORIA' && casa.fuera === false,
           casa.titulo);

        const viejo = ENF({ rival: 'MASPALOMAS', scoreHome: 3, scoreAway: 1 }, 'ARINAGA REGIONAL');
        ok('1g · ⚠️ [B] un informe ANTIGUO sin myTeamRole se ordena como LOCAL',
           viejo.local === 'ARINAGA REGIONAL' && viejo.veredicto === 'VICTORIA',
           JSON.stringify(viejo));

        const sinMarcador = ENF({ rival: 'MASPALOMAS', myTeamRole: 'away' }, 'ARINAGA REGIONAL');
        ok('1h · sin marcador no se inventa ni resultado ni veredicto',
           sinMarcador.marcador === '' && sinMarcador.veredicto === '' &&
           sinMarcador.titulo === 'MASPALOMAS vs ARINAGA REGIONAL',
           JSON.stringify(sinMarcador));

        const cero = ENF({ rival: 'MASPALOMAS', scoreHome: 0, scoreAway: 0, myTeamRole: 'away' }, 'X');
        ok('1i · el 0-0 es EMPATE (y no «sin marcador»)',
           cero.marcador === '0-0' && cero.veredicto === 'EMPATE', JSON.stringify(cero));

        const perdido = ENF({ rival: 'MASPALOMAS', scoreHome: 2, scoreAway: 0, myTeamRole: 'away' }, 'X');
        ok('1j · de visitante, el 2-0 es DERROTA', perdido.veredicto === 'DERROTA', perdido.veredicto);

        const vacios = ENF({}, '');
        ok('1k · sin nombres hay respaldo, nunca un título a medias',
           vacios.titulo === 'Mi equipo vs Rival', vacios.titulo);

        const textos = ENF({ rival: 'MASPALOMAS', scoreHome: '0', scoreAway: '2', myTeamRole: 'away' }, 'X');
        ok('1l · el marcador que llega como TEXTO (lo del DOM) también cuenta',
           textos.marcador === '0-2' && textos.veredicto === 'VICTORIA', JSON.stringify(textos));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [A][C] la cabecera del motor de informes ──');
// ═══════════════════════════════════════════════════════════════════════════
//  ⚠️⚠️ AQUÍ NO SE EXIGE QUE EL MOTOR LLAME A LA FUNCIÓN COMPARTIDA, Y ES A
//  PROPÓSITO. `_RP` (report-engine.js) es AUTOCONTENIDO: la aserción 1c de
//  scripts/test_report_engine_module.js prohíbe el objeto global del navegador
//  en ese fichero —hasta en un comentario— para poder ejecutarlo en un sandbox
//  desnudo. Intenté delegar y esa aserción se puso ROJA: es una decisión de
//  diseño anterior, no un descuido.
//
//  🔑 Entonces, ¿qué impide que las dos copias se separen? Esto: se ejecutan
//  LAS DOS con los mismos datos y se exige el MISMO reparto. Si alguien cambia
//  una y no la otra, este fichero se pone rojo — que es exactamente lo que un
//  «una sola definición» compraba.
{
    const fn = trozo(ENGINE, 'const buildHeader = (m, clubName, totMin, stopMin) =>');
    ok('2a · se encuentra buildHeader', !!fn);
    ok('2b · ⚠️ el motor sigue siendo autocontenido (no toca el global)',
       !!fn && !/\bwindow\./.test(fn) && !/\bdocument\./.test(fn),
       'si esto cambia, test_report_engine_module.js 1c también se pondrá rojo');

    const trasEtiqueta = (html, etq) => {
        const i = html.indexOf('>' + etq + '<');
        return i < 0 ? '' : (html.slice(i).match(/font-weight:700;color:white;">([^<]*)</) || [])[1] || '';
    };

    if (fn && ENF) {
        const ctx = { esc: s => String(s == null ? '' : s), console };
        vm.createContext(ctx);
        vm.runInContext(fn + ';\n;globalThis.header = buildHeader;', ctx);

        // 🔑 LAS DOS IMPLEMENTACIONES, LADO A LADO, sobre la misma matriz:
        // fuera, en casa, un informe antiguo sin localía y sin marcador.
        const casos = [
            ['de VISITANTE (el 0-2 de la captura 10396)',
             { rival: 'MASPALOMAS', scoreHome: 0, scoreAway: 2, myTeamRole: 'away', matchDate: '2026-09-14' }],
            ['en CASA',
             { rival: 'MASPALOMAS', scoreHome: 3, scoreAway: 1, myTeamRole: 'home', matchDate: '2026-09-14' }],
            ['un informe ANTIGUO sin myTeamRole',
             { rival: 'MASPALOMAS', scoreHome: 3, scoreAway: 1, matchDate: '2026-09-14' }],
            ['de visitante y perdiendo',
             { rival: 'MASPALOMAS', scoreHome: 4, scoreAway: 1, myTeamRole: 'away', matchDate: '2026-09-14' }],
        ];
        let iguales = 0;
        const desajustes = [];
        casos.forEach(([etq, m]) => {
            const html = ctx.header(m, 'ARINAGA REGIONAL', 90, 0);
            const e    = ENF(m, 'ARINAGA REGIONAL');
            const mio  = {
                local:     trasEtiqueta(html, 'LOCAL'),
                visitante: trasEtiqueta(html, 'VISITANTE'),
                marcador:  (html.match(/letter-spacing:6px[^>]*>([^<]*)</) || [])[1] || '',
                veredicto: /VICTORIA/.test(html) ? 'VICTORIA' : /DERROTA/.test(html) ? 'DERROTA'
                         : /EMPATE/.test(html) ? 'EMPATE' : '',
            };
            const suyo = {
                local: e.local, visitante: e.visitante,
                marcador: e.marcador.replace('-', ' – '), veredicto: e.veredicto,
            };
            if (JSON.stringify(mio) === JSON.stringify(suyo)) iguales++;
            else desajustes.push(etq + ': motor=' + JSON.stringify(mio) + ' · compartida=' + JSON.stringify(suyo));
        });
        ok('2c · 🔑🔑 [A] el motor y la función compartida reparten IGUAL en los ' +
           casos.length + ' casos', iguales === casos.length, desajustes.join(' || '));

        // Y por si la comparación de arriba se volviera trivial (las dos
        // rotas del mismo modo), el valor exacto que pedía el autor:
        const fuera = ctx.header(casos[0][1], 'ARINAGA REGIONAL', 90, 0);
        ok('2d · 🔑 de VISITANTE: LOCAL es el rival y VISITANTE soy yo',
           trasEtiqueta(fuera, 'LOCAL') === 'MASPALOMAS' &&
           trasEtiqueta(fuera, 'VISITANTE') === 'ARINAGA REGIONAL',
           'LOCAL=' + trasEtiqueta(fuera, 'LOCAL') + ' · VISITANTE=' + trasEtiqueta(fuera, 'VISITANTE'));
        ok('2e · 🔑🔑 el marcador sigue siendo LOCAL – VISITANTE y el veredicto VICTORIA',
           /0 – 2/.test(fuera) && /VICTORIA/.test(fuera) && !/DERROTA/.test(fuera),
           (fuera.match(/letter-spacing:6px[^>]*>([^<]*)</) || [])[1]);

        const casa = ctx.header(casos[1][1], 'ARINAGA REGIONAL', 90, 0);
        ok('2f · en casa, mi club de local y VICTORIA',
           trasEtiqueta(casa, 'LOCAL') === 'ARINAGA REGIONAL' &&
           trasEtiqueta(casa, 'VISITANTE') === 'MASPALOMAS' && /VICTORIA/.test(casa));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · [A] las cuatro pantallas que pintan la cabecera ──');
// ═══════════════════════════════════════════════════════════════════════════
//  Las tarjetas viven dentro de plantillas gigantes que no se pueden ejecutar
//  sueltas (necesitan el DOM del panel entero). Lo que se exige aquí es que
//  NINGUNA se reparta los nombres por su cuenta: que llamen a la función
//  compartida y que el título pinte los DOS lados en su orden.
{
    const pantallas = [
        ['la tarjeta del entrenador (Mis Informes)', INDIV,
         'sorted.map(m => {'],
        ['la tarjeta del Director (_sdReportCard)',  TAB,
         'const _sdReportCard = (m) => {'],
    ];
    pantallas.forEach(([nombre, src, ancla]) => {
        const zona = trozo(src, ancla);
        ok('3 · se encuentra ' + nombre, !!zona);
        if (!zona) return;
        ok('3 · ' + nombre + ': pide el enfrentamiento a la función compartida',
           /window\.cronosEnfrentamiento\(/.test(zona));
        ok('3 · ' + nombre + ': 🔑 el título pinta los DOS lados en orden',
           /_enf\.local/.test(zona) && /_enf\.visitante/.test(zona),
           'sigue pintando sólo el rival');
        ok('3 · ' + nombre + ': el veredicto sale del mismo sitio',
           /_enf\s*\?\s*_enf\.veredicto|_enf\.veredicto/.test(zona));
    });

    // El Área de Familias: la tarjeta de cada partido del hijo.
    const zonaP = PADRE.slice(PADRE.indexOf('const tlLabel = tlSec > 0'),
                              PADRE.indexOf('const miniStats = ['));
    ok('3e · se encuentra la tarjeta de partido del Área de Familias', zonaP.length > 200);
    ok('3f · el Área de Familias usa la función compartida',
       /window\.cronosEnfrentamiento\(/.test(zonaP));
    ok('3g · 🔑 y el nombre propio es el del EQUIPO del hijo (el ente no tiene club)',
       /link\s*&&\s*link\.teamName/.test(zonaP), 'usa otra fuente para el nombre propio');
    // ⚠️ El final del corte se busca DESDE la cabecera: «tiempo jugado» sale
    // antes en un comentario y el trozo salía vacío (aserción en verde falso
    // al revés: en rojo sin defecto).
    const iCab = PADRE.indexOf('<!-- Cabecera del partido -->');
    const cabeceraP = PADRE.slice(iCab, PADRE.indexOf('tiempo jugado', iCab));
    ok('3h · se encuentra la cabecera de esa tarjeta',
       iCab > 0 && cabeceraP.length > 200, cabeceraP.length);
    ok('3i · 🔑 el título del Área de Familias pinta los dos lados',
       /_enf\.local/.test(cabeceraP) && /_enf\.visitante/.test(cabeceraP),
       'seguía siendo «vs <rival>»');

    // El informe colectivo que se manda a Dirección.
    ok('3j · el informe colectivo ordena los nombres con la función compartida',
       /window\.cronosEnfrentamiento\(/.test(COLEC) &&
       /_enf\.local\} \$\{scoreHome\} – \$\{scoreAway\} \$\{_enf\.visitante\}/.test(COLEC),
       'el texto ponía mi club de local SIEMPRE');
    ok('3k · 🔑 y ya no escribe mi club pegado al marcador',
       !/me\.clubName\|\|'Nuestro equipo'\} \$\{scoreHome\}/.test(COLEC));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · [A][C] las descargas dicen lo mismo que la pantalla ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const mi = trozo(EXPORT, 'function _rxMiNombre(extra)');
    const ve = trozo(EXPORT, 'function _rxVeredicto(m, miNombre)');
    ok('4a · se encuentran los dos ayudantes de reports-export.js', !!mi && !!ve);

    if (mi && ve && ENF) {
        const ctx = { console, window: { cronosEnfrentamiento: ENF, _cronosCurrentUser: { clubName: 'ARINAGA REGIONAL' } } };
        vm.createContext(ctx);
        vm.runInContext(mi + '\n' + ve + ';\n;globalThis.v = _rxVeredicto;', ctx);

        const fuera = ctx.v({ rival: 'MASPALOMAS', scoreHome: 0, scoreAway: 2, myTeamRole: 'away' });
        ok('4b · 🔑 el título del fichero va en orden de localía',
           fuera.titulo === 'MASPALOMAS vs ARINAGA REGIONAL', fuera.titulo);
        ok('4c · 🔑🔑 y el marcador NO se invierte: 0 - 2 con VICTORIA',
           fuera.marcador === '0 - 2' && fuera.veredicto === 'VICTORIA', JSON.stringify(fuera));

        const casa = ctx.v({ rival: 'MASPALOMAS', scoreHome: 2, scoreAway: 1, myTeamRole: 'home' });
        ok('4d · en casa, mi nombre primero y el mismo 2 - 1 (VICTORIA)',
           casa.titulo === 'ARINAGA REGIONAL vs MASPALOMAS' &&
           casa.marcador === '2 - 1' && casa.veredicto === 'VICTORIA', JSON.stringify(casa));
        ok('4e · el nombre del club se puede pasar por argumento (el PDF lo lleva en meta)',
           ctx.v({ rival: 'M', scoreHome: 1, scoreAway: 0, myTeamRole: 'home' }, 'CD OTRO').titulo
             === 'CD OTRO vs M');

        // ⚠️ [C] sin utils.js cargado, el respaldo reparte igual.
        const ctx2 = { console, window: { _cronosCurrentUser: { clubName: 'ARINAGA REGIONAL' } } };
        vm.createContext(ctx2);
        vm.runInContext(mi + '\n' + ve + ';\n;globalThis.v = _rxVeredicto;', ctx2);
        const solo = ctx2.v({ rival: 'MASPALOMAS', scoreHome: 0, scoreAway: 2, myTeamRole: 'away' });
        ok('4f · ⚠️ [C] el respaldo de la descarga ordena igual',
           solo.titulo === 'MASPALOMAS vs ARINAGA REGIONAL' &&
           solo.marcador === '0 - 2' && solo.veredicto === 'VICTORIA', JSON.stringify(solo));
    }

    ok('4g · la ficha del CSV lleva la fila «Encuentro» con ese título',
       /\['Encuentro', v\.titulo/.test(EXPORT));
    ok('4h · y el PDF titula con el enfrentamiento, no con «vs rival»',
       /'Informe grupal · ' \+ \(v\.titulo/.test(EXPORT));
    ok('4i · el TXT del entrenador y el de la familia también lo escriben',
       /Encuentro:\s+\$\{_enfTxt\.titulo\}/.test(INDIV) &&
       /Encuentro:\s+\$\{_enfTxt\.titulo\}/.test(PADRE));
    ok('4j · el informe individual que se manda a la familia va en orden',
       /🆚 \$\{_titulo\}/.test(INDIV) && /_enf\.local \+ ' vs ' \+ _enf\.visitante/.test(INDIV));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · [A] nadie se guarda una copia de la regla ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // La función vive en utils.js, que se carga en index.html antes que todo
    // lo demás; si algún día se moviera, esto avisa.
    const INDEX = leer('index.html');
    ok('5a · js/core/utils.js sigue registrado en index.html',
       /src="js\/core\/utils\.js/.test(INDEX));
    // ⚠️ report-engine.js NO está en esta lista: es autocontenido y su copia se
    // vigila comparándola con la compartida (PARTE 2). Ver la nota de allí.
    [['individual-reports.js', INDIV], ['reports-tab.js', TAB], ['parent/panel.js', PADRE],
     ['reports-export.js', EXPORT], ['collective-report.js', COLEC],
    ].forEach(([nombre, src]) => {
        ok('5 · ' + nombre + ' llama a cronosEnfrentamiento',
           /cronosEnfrentamiento\(/.test(src));
    });
}

console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }
