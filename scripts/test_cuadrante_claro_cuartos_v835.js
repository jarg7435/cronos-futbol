// ════════════════════════════════════════════════════════════════════════
//  test_cuadrante_claro_cuartos_v835.js
//  ☀️⏱️ EL CUADRANTE EN CLARO Y DE CUARTO EN CUARTO — v835
// ════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-10-23, capturas 11671-11677):
//
//   1. Fondo blanco en el Cuadrante del Director/Coordinador y en su entorno
//      (cabecera y barra de vuelta), con los colores adaptados.
//   2. Horas «Desde/Hasta» sólo en :00, :15, :30 y :45. Las guardadas con
//      minutos sueltos se redondean al cuarto más cercano al abrirlas.
//   3. 🔴 El defecto que destapó el encargo: Alevín C y FUTureFEM C, los dos a
//      las 18:16 en los espacios 3-4, NO salían en conflicto. El bucle de
//      ocupación arrancaba en la hora del bloque y la parrilla sólo lee las
//      franjas de la rejilla (18:15, 18:30…).
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

const CQ    = leer('js/coach/reports/cuadrante-club.js');
const STAFF = leer('js/coach/reports/club-reports.js');

const sb = {
    console: { log() {}, warn() {}, error() {} },
    String, Array, Number, Object, Date, parseInt, parseFloat, isNaN, RegExp, Math, JSON,
    document: { getElementById: () => null, body: { contains: () => false },
                addEventListener: () => {},
                querySelectorAll: () => [], createElement: () => ({ style: {}, addEventListener() {} }) },
    confirm: () => true,
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(CQ + '\n;window.__probe = { _cqRedondearCuarto, _cqClaro, _cqSelectorHora, ' +
                     '_cqHtmlEspacios, _cqLunes, CQ_MINUTOS };', sb);
const P = sb.window.__probe;

console.log('\n☀️⏱️  CUADRANTE EN CLARO Y DE CUARTO EN CUARTO (v835)\n' + '─'.repeat(70));

// ── 1. Cuartos de hora ───────────────────────────────────────────────
console.log('\n1) ⏱️ Las horas van de cuarto en cuarto');
{
    const casos = { '18:16': '18:15', '18:07': '18:00', '18:08': '18:15', '18:22': '18:15',
                    '18:23': '18:30', '18:45': '18:45', '18:53': '19:00', '23:58': '23:45',
                    '9:05': '09:00', '': '', 'basura': '' };
    Object.keys(casos).forEach(k => {
        ok('1 · ' + JSON.stringify(k) + ' → ' + JSON.stringify(casos[k]), P._cqRedondearCuarto(k) === casos[k], P._cqRedondearCuarto(k));
    });

    const sel = P._cqSelectorHora('cq-ce-ini', '18:15');
    const mins = (sel.match(/id="cq-ce-ini-m"[\s\S]*?<\/select>/) || [''])[0];
    const vals = (mins.match(/value="([^"]*)"/g) || []).map(v => v.slice(7, -1));
    ok('1b · 🔑 el minutero ofrece SÓLO --, 00, 15, 30 y 45', JSON.stringify(vals) === JSON.stringify(['', '00', '15', '30', '45']), vals);
    ok('1c · la hora guardada sale seleccionada', /<option value="18" selected>/.test(sel) && /<option value="15" selected>/.test(sel));
    ok('1d · una hora antes de las 6:00 no desaparece del desplegable',
       /<option value="05" selected>/.test(P._cqSelectorHora('x', '05:30')));
    ok('1e · ⚠️ el editor ya NO usa <input type="time"> (el iPad ignora `step`)',
       !/<input type="time" id="cq-ce-/.test(CQ));
    ok('1f · el editor abre las horas REDONDEADAS y avisa del ajuste',
       /const horaIni = _cqRedondearCuarto\(c\.ini\)/.test(CQ) && /Hora ajustada al cuarto de hora/.test(CQ));
    ok('1g · Aplicar lee los desplegables', /const ini = _cqLeerHora\('cq-ce-ini'\), fin = _cqLeerHora\('cq-ce-fin'\)/.test(CQ));
}

// ── 2. El conflicto con minutos sueltos ──────────────────────────────
console.log('\n2) 🔴 Un 18:16 ya no esquiva el aviso de conflicto');
{
    const lunes = P._cqLunes(0);
    const f = new Date(lunes); f.setDate(lunes.getDate() + 2);   // miércoles
    const fecha = String(f.getFullYear()) + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
    sb._cqState.dia = 2;
    sb._cqState.doc = {
        espacios: 4,
        filas: [ { id: 'ale', tipo: 'equipo', cat: 'alevin', label: 'Alevín C' },
                 { id: 'fut', tipo: 'equipo', cat: 'futurefem', label: 'FUTureFEM C' },
                 { id: 'reg', tipo: 'equipo', cat: 'regional', label: 'Regional B' } ],
        celdas: {},
    };
    sb._cqState.doc.celdas['ale|' + fecha] = { tipo: 'entreno', ini: '18:16', fin: '19:16', esp: [3, 4] };
    sb._cqState.doc.celdas['fut|' + fecha] = { tipo: 'entreno', ini: '18:16', fin: '19:16', esp: [3, 4] };
    sb._cqState.doc.celdas['reg|' + fecha] = { tipo: 'entreno', ini: '18:15', fin: '19:15', esp: [1, 2] };
    const html = P._cqHtmlEspacios(lunes);
    ok('2a · 🔴 la captura 11676: Alevín C y FUTureFEM C a las 18:16 SÍ chocan',
       /Hay <strong>2<\/strong> conflicto/.test(html), (html.match(/Hay <strong>\d+<\/strong>/) || [''])[0]);
    ok('2b · y se pintan en la parrilla (antes la clave 18:16 no la leía nadie)',
       /CONFLICTO<\/div><div[^>]*>Alevín C/.test(html));
    ok('2c · Regional B en 1-2 sigue sin conflicto', !/Espacio 1<\/strong>/.test(html) && /Regional B/.test(html));

    sb._cqState.doc.celdas['fut|' + fecha] = { tipo: 'entreno', ini: '19:16', fin: '20:00', esp: [3, 4] };
    const html2 = P._cqHtmlEspacios(lunes);
    // 19:15-19:30 la pisan los dos (uno acaba 19:16, otro empieza 19:16): se
    // marca, porque la franja de la rejilla no puede partirse en minutos.
    ok('2d · sin solape real lejos del borde no hay conflicto a las 18:30',
       !/Espacio 3<\/strong> · 18:/.test(html2));
}

// ── 3. En claro ──────────────────────────────────────────────────────
console.log('\n3) ☀️ El Cuadrante y su entorno, en claro');
{
    const t = P._cqClaro('<div style="color:white;background:#161b22;border:1px solid rgba(255,255,255,0.1);">' +
                         '<span style="color:#f0883e;background:rgba(63,185,80,0.14);">x</span></div>');
    ok('3a · el blanco de texto pasa a casi negro', /color:#1f2328/.test(t) && !/color:white/.test(t));
    ok('3b · el panel oscuro pasa a blanco', /background:#ffffff/.test(t) && !/#161b22/.test(t));
    ok('3c · el naranja y el verde se oscurecen para leerse sobre blanco',
       /#bc4c00/.test(t) && /rgba\(26,127,55,0\.14\)/.test(t));
    ok('3d · las rejillas blancas translúcidas pasan a oscuras', /rgba\(31,35,40,0\.1\)/.test(t));
    ok('3e · la parrilla se pinta por la paleta clara', /container\.innerHTML = _cqClaro\(html\)/.test(CQ));
    ok('3f · la ventana del editor también', /ov\.innerHTML = _cqClaro\(/.test(CQ) && /ov\.className = 'cq-claro-ov'/.test(CQ));
    ok('3g · ⚠️ la directriz del ENTRENADOR no pasa por la paleta clara (su pantalla es oscura)',
       !/_cqClaro/.test(CQ.slice(CQ.indexOf('window.cronosPintarDirectrizClub'))));
    ok('3h · 🔑 el panel quita el claro al salir del Cuadrante (contenedor compartido)',
       /container\.classList\.toggle\('cq-claro', tab === 'cuadrante'\)/.test(STAFF) &&
       /_sdMarco\.classList\.toggle\('sd-claro', tab === 'cuadrante'\)/.test(STAFF));
    ok('3i · la cabecera y la barra de vuelta tienen su versión clara',
       /\.sd-claro \.sd-cab \{ background:#ffffff !important;/.test(STAFF) &&
       /\.sd-claro #staff-navbar \{ background:#f6f8fa !important;/.test(STAFF) &&
       /class="sd-cab"/.test(STAFF));
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos) { console.log('❌ ' + fallos + ' fallo(s)'); process.exit(1); }
console.log('✅ El cuadrante se lee en blanco, va de cuarto en cuarto y no se le escapa un choque');
