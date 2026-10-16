// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v822 · Convocatoria: desplegable «Equipación» + PDF sin la URL
//         que imprime el navegador
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt 17-10, captura 11566):
//   1. «Equipación» junto a «Hora presentación», con tres opciones.
//   2. Sin la dirección web al pie del PDF de dos páginas. No la escribe el
//      documento: la pone el NAVEGADOR (medido con Chrome --print-to-pdf).
//      Declarar las cajas de margen de @page la suprime. Y la hoja que
//      sólo existía para el pie (18 convocados) desaparece.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 300)); }
};

// ═══ 1 · CATÁLOGO (utils.js) ═════════════════════════════════════════════════
{
    const utils = leer('js/core/utils.js');
    const ini = utils.indexOf('window.CRONOS_EQUIPACIONES =');
    const fin = utils.indexOf('if (typeof window.CRONOS_APP_URL', ini);
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(utils.slice(ini, fin), ctx);
    const W = ctx.window;
    ok('1a · tres equipaciones, en el orden del encargo',
       W.CRONOS_EQUIPACIONES.map(e => e.v).join(',') === 'entrenamiento,partido,salida');
    ok('1b · textos del encargo',
       W.cronosEquipacionTexto('entrenamiento') === 'Equipación de entrenamiento' &&
       W.cronosEquipacionTexto('partido') === 'Equipación de partido' &&
       W.cronosEquipacionTexto('salida') === 'Equipación de salida (ropa oficial de paseo y llegada a los encuentros)');
    ok('1c · vacío = no se enseña; desconocida = tal cual',
       W.cronosEquipacionTexto('') === '' && W.cronosEquipacionTexto(null) === '' && W.cronosEquipacionTexto('otra') === 'otra');
}

// ═══ 2 · LA VENTANA DE CONVOCATORIA (import.js) ══════════════════════════════
{
    const imp = leer('js/ai/import.js');
    const iMeet = imp.indexOf('id="conv-meettime"');
    const iEq   = imp.indexOf('id="conv-equipacion"');
    const iFin  = imp.indexOf('MENSAJE PARA LOS JUGADORES');
    ok('2a · el desplegable va JUSTO DESPUÉS de la hora de presentación, en la misma rejilla',
       iMeet > 0 && iEq > iMeet && iEq < iFin &&
       !/<\/div>\s*<\/div>/.test(imp.slice(imp.indexOf('</div>', iMeet) + 6, iEq).replace(/<!--[\s\S]*?-->/g, '')));
    ok('2b · es un <select> con «Sin indicar» y las opciones del catálogo',
       /<select id="conv-equipacion"/.test(imp) && /Sin indicar/.test(imp) &&
       /window\.CRONOS_EQUIPACIONES \|\| \[\]\)\.map/.test(imp));
    ok('2c · recuerda la elegida (savedConv.equipacion)', /savedConv\.equipacion === e\.v/.test(imp));
    ok('2d · se guarda con los datos del partido', /equipacion: document\.getElementById\('conv-equipacion'\)/.test(imp));
    ok('2e · y va al PDF en texto', /equipacion:\s+\(typeof window\.cronosEquipacionTexto === 'function'\)/.test(imp));
}

// ═══ 3 · VIAJA CON LA CONVOCATORIA Y SE VE ═══════════════════════════════════
{
    const wa = leer('js/shared/whatsapp-email.js');
    ok('3a · los DOS caminos de publicación la guardan en el aviso',
       (wa.match(/equipacion: sv\.equipacion \|\| ''/g) || []).length === 2);
    ok('3b · y el texto de la convocatoria la menciona', /if \(equipacion\) msg \+= `👕 \$\{equipacion\}\\n`/.test(wa));
    const ev = leer('js/coach/reports/events-tab.js');
    ok('3c · la ficha de Dirección la enseña y la pasa al PDF',
       /👕 <strong>\$\{escapeHtml\(window\.cronosEquipacionTexto\(d\.equipacion\)\)\}/.test(ev) &&
       /equipacion:\s+\(typeof window\.cronosEquipacionTexto/.test(ev));
    const pp = leer('js/parent/panel.js');
    ok('3d · el panel de familias la enseña (aviso y ficha)',
       (pp.match(/window\.cronosEquipacionTexto\(n\.equipacion\)/g) || []).length >= 1 &&
       (pp.match(/window\.cronosEquipacionTexto\(d\.equipacion\)/g) || []).length >= 1);
}

// ═══ 4 · EL PDF (reports-export.js, EJECUTADO) ═══════════════════════════════
{
    const src = leer('js/coach/reports/reports-export.js');
    const win = {};
    const ctx = { window: win, document: { getElementById: () => null, createElement: () => ({ style: {} }) },
                  navigator: { userAgent: 'x', maxTouchPoints: 0 }, console: { log() {}, warn() {} }, setTimeout };
    win.window = win;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    let doc = '';
    win.rxAbrirDocumento = (o) => { doc = o.docVisor; return true; };
    const jug = []; for (let i = 1; i <= 18; i++) jug.push({ num: String(i), name: 'J' + i });
    win.rxImprimirConvocatoria({ equipo: 'Regional B', presentacion: '17:00 h', equipacion: 'Equipación de partido', jugadores: jug });
    ok('4a · la convocatoria lleva la fila «Equipación»', /Equipación<\/td><td class="rx-l">Equipación de partido/.test(doc));
    ok('4b · …justo después de la hora de presentación',
       doc.indexOf('Hora de presentación') < doc.indexOf('>Equipación<'));
    ok('4c · declara las SEIS cajas de margen vacías (el navegador no pinta URL ni fecha)',
       ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']
           .every(k => new RegExp('@' + k + '\\{content:""\\}').test(doc)));
    ok('4d · y no deja el pie solo en una hoja', /\.rx-pie\{[^}]*break-before:avoid/.test(doc));
    win.rxImprimirConvocatoria({ equipo: 'Regional B', jugadores: jug });
    ok('4e · sin equipación, no hay fila', !/>Equipación</.test(doc));

    win.rxImprimir({ titulo: 'Otro documento', cuerpo: '<p>x</p>' });
    ok('4f · los DEMÁS documentos no cambian (sólo la convocatoria)', !/@bottom-left/.test(doc));
}

console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
