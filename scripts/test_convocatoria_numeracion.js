// ─────────────────────────────────────────────────────────────────────────
// test_convocatoria_numeracion.js  ·  UN SOLO numero por convocado
//
// Bug reportado por el autor (2026-08-03, con captura): en el modal de
// Convocatoria —pantallas de Director Deportivo, Coordinador y Familias— la
// lista de CONVOCADOS salia con el numero DUPLICADO:
//     "1. 1. PEDRO"   "2. 2. LUIS"   "10. 10. BRUNO"   "14. 15. CUCO"
//
// LA CAUSA, que es lo que este guard fija:
// La convocatoria se guarda como un array de STRINGS, no de objetos, y
// _cronosResolvePlayersArr (js/shared/whatsapp-email.js) mete el dorsal DENTRO
// de la cadena: `label = num + '. ' + alias` -> "15. CUCO". Las tres vistas que
// la pintan le anteponian encima el indice de la lista (`${i+1}. ${p}`), asi que
// se veian los DOS numeros. Cuando dorsal e indice coincidian parecia un simple
// "1. 1."; el "14. 15. CUCO" es la pista de que son DOS numeraciones distintas.
//
// EL "14. 15. CUCO" ES TAMBIEN LA DECISION DE DISENO: hay que elegir cual de
// los dos numeros sobrevive. Gana el DORSAL, que es la identidad del jugador en
// una convocatoria; el indice es solo orden de pintado. Si una entrada no trae
// dorsal (alias suelto, nombre editado a mano en el formulario, convocatoria
// antigua) se cae al ordinal para que la lista no quede con huecos sin numerar.
//
// POR QUE SE NORMALIZA AL PINTAR Y NO AL GUARDAR (no "simplificar" esto):
//   · las convocatorias ya enviadas estan en Firestore con el dorsal dentro de
//     la cadena; arreglar solo la escritura las dejaria mal para siempre;
//   · el mensaje de WhatsApp/email se compone de los inputs del formulario
//     (.conv-player-name), que llevan SOLO el alias, y ahi la numeracion por
//     indice es correcta y NO esta duplicada.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── convocatoria: un solo numero por jugador ──\n');

const WE = path.join(ROOT, 'js', 'shared', 'whatsapp-email.js');
const weSrc = fs.readFileSync(WE, 'utf8');

// ═══════ Se extrae SOLO el formateador y se ejecuta de verdad ═══════
// El fichero entero toca DOM/localStorage/Firebase al cargarse, asi que se
// aisla la funcion. Se comprueba antes que sigue existiendo y exportandose.
ok('0a · _cronosFormatConvokedPlayer existe y se exporta en window',
   /function\s+_cronosFormatConvokedPlayer\s*\(/.test(weSrc) &&
   /window\._cronosFormatConvokedPlayer\s*=\s*_cronosFormatConvokedPlayer/.test(weSrc),
   'el formateador compartido no esta en js/shared/whatsapp-email.js');

const ini = weSrc.indexOf('function _cronosFormatConvokedPlayer');
const fin = weSrc.indexOf('window._cronosFormatConvokedPlayer =');
const fnSrc = weSrc.slice(ini, fin);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fnSrc + '\n;globalThis.fmt = _cronosFormatConvokedPlayer;', sandbox);
const fmt = sandbox.fmt;

const render = (entry, i) => {
    const f = fmt(entry, i);
    return f.name ? `${f.num}. ${f.name}` : `${f.num}.`;
};

// ═══════════ PARTE 1 · los cuatro casos de la captura ═══════════
console.log('\n── PARTE 1 · los casos exactos que reporto el autor ──');
{
    // Tal y como estan guardados: el dorsal YA dentro de la cadena.
    const guardado = ['1. PEDRO', '2. LUIS', '10. BRUNO', '15. CUCO'];
    const pintado  = guardado.map(render);

    ok('1a · "1. 1. PEDRO" pasa a "1. PEDRO"',   pintado[0] === '1. PEDRO',   pintado[0]);
    ok('1b · "2. 2. LUIS" pasa a "2. LUIS"',     pintado[1] === '2. LUIS',    pintado[1]);
    ok('1c · "10. 10. BRUNO" pasa a "10. BRUNO"', pintado[2] === '10. BRUNO', pintado[2]);
    ok('1d · "14. 15. CUCO" pasa a "15. CUCO" (gana el DORSAL, no el indice)',
       pintado[3] === '15. CUCO', pintado[3]);

    ok('1e · ninguna linea lleva ya dos numeros seguidos',
       pintado.every(l => !/^\s*\d+\s*\.\s*\d+\s*\./.test(l)),
       JSON.stringify(pintado));
}

// ═══════════ PARTE 2 · entradas SIN dorsal: se numeran por orden ═══════════
console.log('\n── PARTE 2 · entradas sin dorsal ──');
{
    ok('2a · un alias suelto recibe el ordinal de la lista',
       render('PEDRO', 0) === '1. PEDRO', render('PEDRO', 0));
    ok('2b · y respeta su posicion real en la lista',
       render('CUCO', 13) === '14. CUCO', render('CUCO', 13));
    ok('2c · una lista MIXTA no deja ninguna entrada sin numerar',
       ['3. ANA', 'BEA', '7. CARMEN'].map(render).join(' | ') === '3. ANA | 2. BEA | 7. CARMEN',
       ['3. ANA', 'BEA', '7. CARMEN'].map(render).join(' | '));
}

// ═══════════ PARTE 3 · formatos y bordes ═══════════
console.log('\n── PARTE 3 · variantes de formato y casos limite ──');
{
    ok('3a · "15 CUCO" (sin punto) tambien se reconoce',
       render('15 CUCO', 0) === '15. CUCO', render('15 CUCO', 0));
    ok('3b · "15 - CUCO" tambien',
       render('15 - CUCO', 0) === '15. CUCO', render('15 - CUCO', 0));
    ok('3c · "15) CUCO" tambien',
       render('15) CUCO', 0) === '15. CUCO', render('15) CUCO', 0));

    ok('3d · una entrada que es SOLO el dorsal no recibe ademas el ordinal',
       render('15', 3) === '15.', render('15', 3));

    ok('3e · un nombre de dos palabras no se parte',
       render('9. JOSE ALBERTO', 0) === '9. JOSE ALBERTO', render('9. JOSE ALBERTO', 0));

    ok('3f · entrada vacia -> ordinal, sin reventar',
       render('', 4) === '5.', render('', 4));
    ok('3g · null/undefined no rompen el render',
       render(null, 0) === '1.' && render(undefined, 1) === '2.',
       render(null, 0) + ' / ' + render(undefined, 1));

    // Un nombre que EMPIEZA por un numero de 4+ digitos no es un dorsal.
    ok('3h · un numero de 4 cifras no se confunde con un dorsal',
       render('2024 TORNEO', 0) === '1. 2024 TORNEO', render('2024 TORNEO', 0));
}

// ═══════════ PARTE 4 · las TRES vistas usan el formateador ═══════════
console.log('\n── PARTE 4 · los tres sitios que pintan la lista ──');
{
    // Si aparece una cuarta vista, o alguien vuelve a meter `${i+1}. ${p}`,
    // esto lo caza. El bug estaba en TRES sitios a la vez: arreglar uno solo
    // deja la duplicacion viva en las otras dos pantallas.
    const vistas = [
        ['js/parent/panel.js',            'Familias · lista de avisos y detalle'],
        ['js/coach/reports/events-tab.js', 'Director Deportivo / Coordinador'],
    ];
    for (const [rel, quien] of vistas) {
        const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        ok('4 · ' + rel + ' usa el formateador compartido (' + quien + ')',
           s.includes('_cronosFormatConvokedPlayer'),
           'esta vista sigue numerando por su cuenta');
    }

    // Censo: ninguna vista puede volver a anteponer el indice a la cadena
    // guardada. Se buscan los patrones concretos que HABIA.
    const sospechosos = [];
    for (const rel of ['js/parent/panel.js', 'js/coach/reports/events-tab.js']) {
        const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        const re = /players\.map\(\s*\(\s*p\s*,\s*i\s*\)\s*=>\s*`\$\{i\s*\+?\s*1\}\./g;
        if (re.test(s)) sospechosos.push(rel);
    }
    ok('4c · ninguna vista antepone ya el indice directamente a la cadena',
       sospechosos.length === 0, 'reincidentes: ' + JSON.stringify(sospechosos));

    // El mensaje de WhatsApp/email NO debe tocarse: se compone de los inputs
    // del formulario, que llevan solo el alias, y ahi el indice es correcto.
    ok('4d · el mensaje de WhatsApp/email conserva su numeracion por indice',
       /\.map\(\(el,\s*i\)\s*=>\s*`\$\{i \+ 1\}\. \$\{el\.value\.trim\(\)/.test(weSrc),
       'se ha tocado la numeracion del mensaje, que NO estaba duplicada');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
