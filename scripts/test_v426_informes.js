// ═══════════════════════════════════════════════════════════════════════════
// GUARD · implementar.txt del 2026-08-03 (v426) — informes
// ═══════════════════════════════════════════════════════════════════════════
//   1. El paso por el DESCANSO no es una sustitución.
//   2. Emparejamiento explícito en las etiquetas del cronograma.
//   3. Banquillo en gris, campo en azul, y cero solapes de texto.
//
// Las partes 1 y 2 EJECUTAN el motor real (buildIvs y el cronograma completo)
// en un sandbox. Un apunte de fase colado como sustitución no rompe nada
// visible en el código —la llamada existe y parece correcta—, así que sólo se
// ve corriéndolo con datos que lo reproduzcan.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');
const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

let fallos = 0, total = 0;
function ok(nombre, cond, extra) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); if (extra !== undefined) console.log('      ' + extra); fallos++; }
}

const REPO  = leer('js/coach/reports/report-engine.js');
const PANEL = leer('js/coach/comms/panel.js');
const EVL   = leer('js/core/event-listeners.js');
const REPOC = sinCom(REPO);

// ⚠️ _RP es un `const` del ámbito del módulo y NO se expone en window: es una
// decisión deliberada del proyecto (dos `const _RP` en el mismo ámbito son un
// SyntaxError que se lleva por delante el fichero entero). Se carga igual que
// en test_report_engine_module.js: extrayendo el IIFE y sacándolo por `this`.
function cargarRP() {
    const s = REPO.indexOf('const _RP = (() => {');
    const e = REPO.indexOf('\n})();', s);
    const bloque = REPO.slice(s, e + 6);
    const sb = { Math, Array, Object, String, Number, JSON, Date, Map, Set, parseInt, parseFloat, isNaN };
    vm.createContext(sb);
    vm.runInContext(bloque + '\nthis.__rp = _RP;', sb);
    return sb.__rp;
}
// Devuelve { html } para leerse igual que en test_report_engine_module.js.
const construir = (players, m) => ({
    html: cargarRP().build(
        Object.assign({ players, rival: 'Rival FC', scoreHome: 1, scoreAway: 0 }, m || {}),
        { clubName: 'CD Test' })
});

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 0 · parseo ──');
// ───────────────────────────────────────────────────────────────────────────
['js/coach/reports/report-engine.js', 'js/coach/comms/panel.js'].forEach(f => {
    let bien = true;
    try { new vm.Script(leer(f)); } catch (e) { bien = false; console.log('      ' + e.message); }
    ok(`0 · ${f} parsea`, bien);
});

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · 🔑 el DESCANSO no es un cambio (ejecutado) ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // Se extrae desde los ayudantes para que buildIvs tenga sus dependencias.
    const ini = REPO.indexOf('const _claveT = e =>');
    const fin = REPO.indexOf('const calcTot', ini);
    const sb = { console };
    vm.createContext(sb);
    vm.runInContext(REPO.slice(ini, fin) + '\nthis.__b = buildIvs; this.__s = soloCambiosReales;', sb);
    const { __b: buildIvs, __s: soloCambiosReales } = sb;

    ok('1a · existe el filtro de apuntes de fase', typeof soloCambiosReales === 'function');

    const ev = (type, minute, note) => ({ type, minute, second: 0, note: note || '' });
    const nombres = h => soloCambiosReales(h).map(e => e.note);

    // (DESCANSO) y (FIN) son inequívocas: sólo las escribe la propia app al
    // cerrar la primera parte y al terminar el partido.
    ok('1b · descarta el "Sale (DESCANSO)" automático',
       nombres([ev('sub_out', 45, 'Sale a las 45:00 (DESCANSO)')]).length === 0);
    ok('1c · y el "Sale (FIN)"',
       nombres([ev('sub_out', 90, 'Sale a las 90:00 (FIN)')]).length === 0);
    ok('1d · y reconoce también el campo `phase` que marca el parseador',
       soloCambiosReales([{ type:'sub_out', minute:45, second:0, phase:true }]).length === 0);

    // 🔑 LA TRAMPA: "(2ªP)" es AMBIGUA. logMovement la escribe en los cambios
    // reales de la segunda parte, así que descartarla a ciegas se comería
    // sustituciones de verdad. La automática se distingue por compartir sello de
    // tiempo con el "Sale (DESCANSO)" del mismo jugador.
    ok('1e · 🔑 descarta el "Entra (2ªP)" que hace pareja con el descanso',
       nombres([ev('sub_out', 45, 'Sale a las 45:00 (DESCANSO)'),
                ev('sub_in',  45, 'Entra a las 45:00 (2ªP)')]).length === 0);
    ok('1f · 🔑 pero CONSERVA un cambio real de la 2ª parte, que se escribe igual',
       nombres([ev('sub_out', 45, 'Sale a las 45:00 (DESCANSO)'),
                ev('sub_in',  45, 'Entra a las 45:00 (2ªP)'),
                ev('sub_in',  70, 'Entra a las 70:00 (2ªP)')])
         .join('|') === 'Entra a las 70:00 (2ªP)',
       JSON.stringify(nombres([ev('sub_out', 45, 'Sale a las 45:00 (DESCANSO)'),
                               ev('sub_in',  45, 'Entra a las 45:00 (2ªP)'),
                               ev('sub_in',  70, 'Entra a las 70:00 (2ªP)')])));
    ok('1f2 · 🔑 y la entrada al empezar la 2ª parte de quien estaba en la BANCA',
       nombres([ev('sub_in', 45, 'Entra a las 45:00 (2ªP)')]).length === 1,
       'sin "Sale (DESCANSO)" propio, esa entrada es real: estaba en el banquillo');
    ok('1f3 · 🔑 (DESC) es un cambio DURANTE el descanso y se conserva',
       nombres([ev('sub_out', 45, 'Sale a las 45:12 (DESC) #999')]).length === 1,
       '(DESC) ≠ (DESCANSO): la primera es real, la segunda es el apunte automático');
    ok('1f4 · un cambio normal de la 1ª parte no se toca',
       nombres([ev('sub_out', 30, 'Sale a las 30:00 (1ªP) #1712')]).length === 1);

    // 🔑 EL CASO DEL AUTOR: titular al que se le hace el cambio EN el descanso.
    // Le queda el "Sale (DESCANSO)" suelto —sin su "Entra (2ªP)" que lo anule—
    // y por eso era el único que se contaba como sustitución.
    const enDescanso = { status: 'bench', history: [
        ev('sub_out', 45, 'Sale a las 45:00 (DESCANSO)'),
        ev('sub_out', 45, 'Sale a las 45:12 (DESC) #999'),   // el cambio REAL
    ]};
    const ivs1 = buildIvs(enDescanso, 90);
    ok('1n · 🔑 buildIvs: el "Sale (DESCANSO)" no genera un tramo propio',
       ivs1.length === 1 && ivs1[0][0] === 0,
       JSON.stringify(ivs1));

    // Un titular que pasa el descanso y sigue jugando: barra CONTINUA.
    const sigue = { status: 'field', history: [
        ev('sub_out', 45, 'Sale a las 45:00 (DESCANSO)'),
        ev('sub_in',  45, 'Entra a las 45:00 (2ªP)'),
    ]};
    ok('1o · 🔑 quien pasa el descanso y sigue tiene la barra CONTINUA de 0 a 90',
       JSON.stringify(buildIvs(sigue, 90)) === JSON.stringify([[0, 90]]),
       JSON.stringify(buildIvs(sigue, 90)) + ' — el descanso no puede partir la barra');

    // El "Sale (FIN)" tampoco corta nada antes de tiempo.
    const finPartido = { status: 'field', history: [ev('sub_out', 90, 'Sale a las 90:00 (FIN)')] };
    ok('1p · el "Sale (FIN)" no cuenta como salida',
       JSON.stringify(buildIvs(finPartido, 90)) === JSON.stringify([[0, 90]]),
       JSON.stringify(buildIvs(finPartido, 90)));

    // Y un cambio REAL sigue partiendo la barra donde toca.
    const real = { status: 'bench', history: [
        ev('sub_out', 45, 'Sale a las 45:00 (DESCANSO)'),
        ev('sub_in',  45, 'Entra a las 45:00 (2ªP)'),
        ev('sub_out', 70, 'Sale a las 70:00 (2ªP) #555'),
    ]};
    ok('1q · 🔑 un cambio de VERDAD sigue partiendo la barra donde toca',
       JSON.stringify(buildIvs(real, 90)) === JSON.stringify([[0, 70]]),
       JSON.stringify(buildIvs(real, 90)));
}

// ── El marcado en origen ───────────────────────────────────────────────────
{
    const p = sinCom(PANEL);
    ok('1i · _parseHistoryForFirestore marca los apuntes de fase',
       /const esFase = /.test(p) && /phase: esFase/.test(p),
       'el texto no puede ser el contrato de datos: hace falta el campo propio');
    ok('1i2 · 🔑 y SÓLO los inequívocos (marcar (2ªP) se comería cambios reales)',
       /const esFase = \/\\\(\(\?:DESCANSO\|FIN\)\\\)\/i\.test\(e\)/.test(p),
       (p.match(/const esFase = [^\n]*/) || ['(no aparece)'])[0]);
    ok('1j · 🔑 y el marcador sobrevive a un re-parseo del objeto',
       /const _fase = \(e\.phase === true\)/.test(p) && /phase: _fase/.test(p));
    // Los escritores siguen existiendo: si desaparecieran, este guard perdería
    // su motivo y habría que quitarlo, no dejarlo pasando en el vacío.
    ok('1k · la app sigue apuntando el paso por el descanso',
       /history\.push\(`Sale a las \$\{timestamp1\} \(DESCANSO\)`\)/.test(EVL) &&
       /history\.push\(`Entra a las \$\{timestamp2\} \(2ªP\)`\)/.test(EVL));
    ok('1l · 🔑 buildSubs (el emparejador) también los descarta',
       /const evs = soloCambiosReales\(p\.history\);/.test(REPOC),
       'si no, el descanso emparejaría a todos con todos y gastaría cambios');
    ok('1m · y buildIvs usa el mismo filtro',
       /const rawHist = soloCambiosReales\(player\.history\);/.test(REPOC));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · 🔑 emparejamiento explícito (cronograma ejecutado) ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // Se ejecuta el módulo entero y se pide el cronograma real.
    const build = (pl, m) => construir(pl, m);
    ok('2a · el motor de informes carga y construye', typeof build === 'function');

    if (typeof build === 'function') {
        const jug = (alias, num, over) => Object.assign({
            playerAlias: alias, playerNumber: num, convocado: true,
            position: 'MED', minutesPlayed: 45, history: [], status: 'field',
        }, over || {});

        // ANA (titular) sale en el 30 y entra BEA por ella. Mismo subId.
        const plantilla = [
            jug('ANA', 5,  { status: 'bench', history: [
                { type:'sub_out', minute:30, second:0, timeStr:'30:00', subId:'77' } ] }),
            jug('BEA', 12, { status: 'field', history: [
                { type:'sub_in',  minute:30, second:0, timeStr:'30:00', subId:'77' } ] }),
        ];
        const html = build(plantilla, { category: 'juvenil' }).html;

        // La fila de ANA (sale) tiene que nombrarse a SÍ MISMA y a BEA.
        ok('2b · 🔑 la etiqueta de SALIDA nombra al jugador Y a quien entra',
           /▲ SALE: ANA \(entra BEA\) 30'/.test(html),
           (html.match(/▲ SALE:[^<]*/) || ['(no aparece)'])[0]);
        // La fila de BEA (entra) tiene que nombrarse a SÍ MISMA y a ANA.
        ok('2c · 🔑 la etiqueta de ENTRADA nombra al jugador Y a quién sustituye',
           /▼ ENTRA: BEA \(por ANA\) 30'/.test(html),
           (html.match(/▼ ENTRA:[^<]*/) || ['(no aparece)'])[0]);
        ok('2d · el color se mantiene: verde entra, rojo sale',
           /#3fb950[^>]*>▼ ENTRA:/.test(html) && /#ff5858[^>]*>▲ SALE:/.test(html));

        // 🔑 SIN HUÉRFANOS: una salida sin relevo se declara, no se deja el
        // nombre suelto. Pasa de verdad con una expulsión (el equipo se queda
        // con uno menos y nadie entra).
        const soloSale = [ jug('CARL', 7, { status: 'bench', history: [
            { type:'sub_out', minute:50, second:0, timeStr:'50:00', subId:null } ] }) ];
        const html2 = build(soloSale, { category: 'juvenil' }).html;
        ok('2e · 🔑 una salida sin relevo lo DICE, no deja el nombre huérfano',
           /▲ SALE: CARL \(sin pareja\) 50'/.test(html2),
           (html2.match(/▲ SALE:[^<]*/) || ['(no aparece)'])[0]);

        // 🔑 Y EL DESCANSO NO PINTA ETIQUETA NINGUNA (punto 1, extremo a extremo).
        const conDescanso = [ jug('DANI', 9, { status: 'field', history: [
            { type:'sub_out', minute:45, second:0, timeStr:'45:00', note:'Sale a las 45:00 (DESCANSO)' },
            { type:'sub_in',  minute:45, second:0, timeStr:'45:00', note:'Entra a las 45:00 (2ªP)' } ] }) ];
        const html3 = build(conDescanso, { category: 'juvenil' }).html;
        ok('2f · 🔑 el descanso NO pinta ninguna etiqueta de cambio',
           !/ENTRA:|SALE:/.test(html3),
           (html3.match(/(ENTRA|SALE):[^<]*/) || ['(limpio)'])[0]);
        ok('2g · 🔑 ni parte la barra: un solo tramo azul de punta a punta',
           (html3.match(/fill="#58a6ff"/g) || []).length === 1,
           'tramos azules: ' + (html3.match(/fill="#58a6ff"/g) || []).length);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · franjas y colisiones ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    ok('3a · el BANQUILLO se pinta en gris neutro (antes blanco al 5%: invisible)',
       /fill="rgba\(139,148,158,0\.22\)"/.test(REPOC),
       (REPOC.match(/Fondo del BANQUILLO[\s\S]{0,300}?fill="[^"]*"/) || ['(no aparece)'])[0].slice(-40));
    ok('3b · y su rótulo se lee',
       /fill="rgba\(230,237,243,0\.55\)"[\s\S]{0,80}BANQUILLO/.test(REPOC));
    ok('3c · EN CAMPO sigue en azul',
       /fill="#58a6ff"/.test(REPOC));

    ok('3d · 🔑 las etiquetas se acotan al ancho de la fila',
       /if \(x1 \+ w > W\) x1 = W - w;/.test(REPOC) && /if \(x1 < 0\)     x1 = 0;/.test(REPOC),
       'el <svg> lleva overflow:visible: sin acotar, una etiqueta larga se derrama sobre la fila de al lado');
    ok('3e · 🔑 y se PINTAN en la x ya acotada, no en la original',
       /l\.xDibujo != null \? l\.xDibujo : l\.x/.test(REPOC),
       'repartir una caja y pintar otra deja el reparto de carriles sin efecto');
    ok('3f · el reparto sigue midiendo con el tamaño de fuente real',
       /const fs = it\.fs \|\| 7;/.test(REPOC) && /it\.txt\.length \* fs \* 0\.53/.test(REPOC));
    ok('3g · las horas de los eventos siguen en el MISMO reparto (v425)',
       /eventos\.forEach\(e => \{\s*arriba\.push\(/.test(REPOC));
    ok('3h · y los iconos conservan su banda por encima del texto (v425)',
       /const ALTO_ICONOS = eventos\.length \? 13 : 0;/.test(REPOC));
    ok('3i · la altura de la fila sigue creciendo con los carriles',
       /Hrow    = TRACK_Y \+ TRACK_H \+ 14 \+ Math\.max\(0, nAbajo - 1\) \* LANE_H \+ 12/.test(REPOC));
}

// ── Comprobación de colisión REAL, midiendo las cajas ──────────────────────
{
    const build = (pl, m) => construir(pl, m);

    if (typeof build === 'function') {
        // Cuatro cambios en minutos CONTIGUOS: el caso que el autor pide que
        // nunca se pise ("si ocurren eventos en minutos contiguos").
        const plantilla = [];
        [31, 32, 33, 34].forEach((m, i) => {
            plantilla.push({ playerAlias: 'SALE' + i, playerNumber: i + 1, convocado: true,
                position: 'MED', minutesPlayed: m, status: 'bench',
                history: [{ type:'sub_out', minute:m, second:0, timeStr:m+':00', subId:'S'+i }] });
            plantilla.push({ playerAlias: 'ENTR' + i, playerNumber: i + 20, convocado: true,
                position: 'MED', minutesPlayed: 90 - m, status: 'field',
                history: [{ type:'sub_in', minute:m, second:0, timeStr:m+':00', subId:'S'+i }] });
        });
        const html = build(plantilla, { category: 'juvenil' }).html;

        // Por cada <svg> (una fila), agrupar los <text> por su `y` y comprobar
        // que dos textos con la MISMA y no se solapan en x.
        const filas = html.match(/<svg[\s\S]*?<\/svg>/g) || [];
        let solapes = 0, detalle = '';
        filas.forEach(svg => {
            const textos = [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
                .map(m => ({ x: +m[1], y: +m[2], fs: +m[3], t: m[4] }))
                .filter(t => /ENTRA:|SALE:/.test(t.t));      // sólo etiquetas de cambio
            const porY = {};
            textos.forEach(t => { (porY[t.y.toFixed(1)] = porY[t.y.toFixed(1)] || []).push(t); });
            Object.values(porY).forEach(grupo => {
                const cajas = grupo.map(t => [t.x, t.x + t.t.length * t.fs * 0.53]).sort((a,b)=>a[0]-b[0]);
                for (let i = 1; i < cajas.length; i++) {
                    if (cajas[i][0] < cajas[i-1][1] - 0.5) {
                        solapes++;
                        detalle = JSON.stringify(grupo.map(g => g.t));
                    }
                }
            });
        });
        ok('3j · 🔑 CUATRO cambios en minutos contiguos y NINGÚN texto se pisa',
           solapes === 0, `${solapes} solape(s): ${detalle}`);

        // Y que no se salgan de la fila (W = 500).
        let fuera = 0;
        filas.forEach(svg => {
            [...svg.matchAll(/<text x="([-\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)]
                .filter(m => /ENTRA:|SALE:/.test(m[3]))
                .forEach(m => {
                    const x = +m[1], w = m[3].length * (+m[2]) * 0.53;
                    if (x < -0.5 || x + w > 500.5) fuera++;
                });
        });
        ok('3k · 🔑 ninguna etiqueta se sale de la fila', fuera === 0, `${fuera} fuera de la caja`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) { console.log(`❌ ${fallos} aserción(es) en rojo`); process.exit(1); }
console.log('✅ v426: todas las aserciones en verde');
