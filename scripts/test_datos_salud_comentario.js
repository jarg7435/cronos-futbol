// ─────────────────────────────────────────────────────────────────────────
//  test_datos_salud_comentario.js  ·  🛡️ v758 (reauditoría 23-09)
//
//  El comentario del partido es el ÚNICO texto libre que acaba dentro de un
//  informe, y el informe habla de un MENOR. La política (privacy.html §10.1)
//  promete que la app no recoge salud y que ADVIERTE en el texto libre. El
//  auditor pidió, además del aviso fijo, una «validación razonable».
//
//  Se vigila:
//   1. El DETECTOR, ejecutado de verdad (no leyendo su forma): caza lo
//      médico y NO salta con el lenguaje normal de banquillo.
//   2. Que el guardado lo CONSULTA, pide confirmación y lo hace ANTES de
//      escribir nada (cancelar no puede dejar el suceso a medias).
//   3. Que el aviso fijo bajo el campo sigue ahí y la política sigue
//      diciendo lo que la app hace.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const UTILS = leer('js/core/utils.js');
const RETRO = leer('js/match/events/retroactive-modal.js');
const PRIV = leer('privacy.html');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 400)); }
};

console.log('\n══ 🛡️ Datos de salud en el comentario del partido ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) El detector, ejecutado');
const ini = UTILS.indexOf('const CRONOS_RAICES_SALUD');
const fin = UTILS.indexOf('window.cronosPosiblesDatosSalud', ini);
ok('1a · existe el detector en utils.js', ini !== -1 && fin !== -1);
let detecta = () => [];
if (ini !== -1 && fin !== -1) {
    const sb = { window: {} };
    vm.createContext(sb);
    vm.runInContext(UTILS.slice(ini, fin) + '\nwindow.f = cronosPosiblesDatosSalud;', sb);
    detecta = sb.window.f;
}

const MEDICOS = [
    ['Salió con un esguince de tobillo', 'esguince'],
    ['Tiene ASMA, usa inhalador', 'asma'],
    ['Viene de una operación de menisco', 'menisco'],
    ['Diagnóstico: rotura fibrilar', 'diagnostico'],
    ['Le dimos ibuprofeno en el descanso', 'ibuprofeno'],
    ['Fue al médico el martes', 'medico'],
    ['Está con medicación para el TDAH', 'tdah'],
    ['Posible conmoción tras el choque', 'conmocion'],
    ['Diabético: ojo con la merienda', 'diabetico'],
    ['Se lo llevó la ambulancia', 'ambulancia'],
];
MEDICOS.forEach(([txt, palabra]) => {
    const r = detecta(txt);
    ok('1b · salta con «' + txt + '»', Array.isArray(r) && r.indexOf(palabra) !== -1, r);
});

// El lenguaje de banquillo NO puede disparar el aviso: un aviso que salta
// siempre se deja de leer, y entonces no protege nada.
const DEPORTIVOS = [
    'Buena presión alta, la defensa se ha roto en el minuto 30',
    'Cambio por lesión, entra el 7',          // la marca de lesión SÍ está admitida (§10.1)
    'Mucha ansiedad en los últimos minutos',
    'El fisio pide calentar antes',
    'Medición del tiempo correcta, comedido en las entradas',
    'Remedio: juntar líneas y bascular',
    'Hay que operar por la banda derecha',
    '',
];
DEPORTIVOS.forEach((txt) => {
    const r = detecta(txt);
    ok('1c · NO salta con «' + txt + '»', Array.isArray(r) && r.length === 0, r);
});
ok('1d · tolera null/undefined', detecta(null).length === 0 && detecta(undefined).length === 0);

// ════════════════════════════════════════════════════════════════════
console.log('\n2) El guardado lo consulta, y ANTES de escribir');
{
    const iC = RETRO.indexOf("if (_selectedEventType === 'comment') {");
    const tramo = iC === -1 ? '' : RETRO.slice(iC, iC + 6000);
    const iDet = tramo.indexOf('cronosPosiblesDatosSalud(nota)');
    const iConf = tramo.indexOf('confirm(', iDet);
    const iReg = tramo.indexOf("_registerMatchEvent('comment'");
    const iInf = tramo.indexOf('_corrigeInformesDelPartido(');
    ok('2a · la rama del comentario llama al detector con la nota', iDet !== -1, iDet);
    ok('2b · y pide confirmación si salta', iConf !== -1 && iConf - iDet < 600);
    ok('2c · 🔑 ANTES de registrar el suceso y de tocar informes ya generados',
       iDet !== -1 && iReg !== -1 && iInf !== -1 && iConf < iReg && iConf < iInf,
       { iDet, iConf, iReg, iInf });
    ok('2d · cancelar sale sin escribir (return dentro del if)',
       /confirm\([\s\S]{0,700}?\)\)\s*\{[\s\S]{0,120}?return;/.test(tramo));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) El aviso fijo y la política siguen diciendo lo mismo');
ok('3a · el aviso visible bajo el campo sigue ahí',
   /No anotes datos de salud/.test(RETRO));
ok('3b · la política dice que la app ADVIERTE en el texto libre',
   /advierte expresamente[\s\S]{0,120}no deben anotarse datos de salud/.test(PRIV));

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
