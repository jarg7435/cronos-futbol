// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v729 · ASISTENCIA PASA LISTA CON LA PLANTILLA DEL EQUIPO
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-17, capturas 10499-10503): en
//  Asistencia del **Regional B** salían TONI, IVÁN, SERGIO, SAÚL, KIKO, JUAN,
//  DAVID, FEFO, CUCO, GOYO y SIXTO —once nombres que NO están en su
//  plantilla— y los dorsales descolocados.
//
//  📏 MEDIDO EN SUS CAPTURAS ANTES DE TOCAR NADA, y la aritmética no deja
//  alternativa: la lista tenía **25 filas**; los dorsales **19-25** coincidían
//  EXACTAMENTE con la plantilla F11 (CACO, TITO, RUIZ, ROMERO, SÁNCHEZ, ALEX,
//  VÍCTOR) y los **18 primeros** eran otros. 18 + 7 = 25. Un F7 son 18 fichas
//  como mucho: los dieciocho primeros salían de la lista **F7** —que para el
//  Regional B es la del OTRO equipo del entrenador— y de la suya sólo llegaba
//  lo que F7 no podía tapar.
//
//  🔑 Y NO ERA QUE SOBRARAN NOMBRES: ERA QUE SUSTITUÍAN. `jugadores()` fundía
//  f7+f11 y deduplicaba por FICHA; las fichas de las dos plantillas del mismo
//  entrenador COLISIONAN (las dos empiezan en ALC01) y F7 iba primero. Así que
//  ALC03 dejaba de ser SANCHO para ser TONI **con el dorsal 3**, y cada marca
//  de asistencia se escribía sobre la ficha de otro jugador.
//
//  🚨 POR QUÉ ESTE GUARD EJECUTA `jugadores()` CONTRA LAS LISTAS DE VERDAD:
//  el fallo es MUDO —no hay error, sólo nombres que no son— y de los que un
//  regex no ve. La prueba siembra las dos plantillas tal como están en sus
//  capturas y compara la salida nombre a nombre.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

const SRC_UTILS = fs.readFileSync(path.join(ROOT, 'js/core/utils.js'), 'utf8');
const SRC_STORE = fs.readFileSync(path.join(ROOT, 'js/coach/attendance/attendance-store.js'), 'utf8');

// ── Las dos plantillas, TAL COMO ESTÁN EN SUS CAPTURAS ────────────────────
//  La del Regional B (F11, captura 10500-10501) y la del otro equipo del
//  entrenador (F7), que es la lista que aparecía indebidamente en Asistencia
//  (capturas 10502-10503). Las fichas COLISIONAN a propósito: así es en real.
const F11_REGIONAL_B = ['LUIS','PEDRO','SANCHO','LALO','LANDI','ROBER','CARLOS','NANDO','JOSE',
    'BRUNO','DANI','LOLO','NANO','BINGO','ROMU','SANTI','PEDRO','AGUS','CACO','TITO','RUIZ',
    'ROMERO','SÁNCHEZ','ALEX','VÍCTOR'].map((n, i) => ({
        id: 'ALC' + String(i + 1).padStart(2, '0'), number: i + 1, name: n, alias: n }));

const F7_OTRO_EQUIPO = ['PEDRO','LUIS','TONI','SANCHO','DANI','IVÁN','SERGIO','SAÚL','KIKO',
    'BRUNO','LOLO','JUAN','DAVID','FEFO','CUCO','GOYO','NANO','SIXTO'].map((n, i) => ({
        id: 'ALC' + String(i + 1).padStart(2, '0'), number: i + 1, name: n, alias: n }));

// Los once nombres que él señaló y que no existen en el Regional B.
const INTRUSOS = ['TONI','IVÁN','SERGIO','SAÚL','KIKO','JUAN','DAVID','FEFO','CUCO','GOYO','SIXTO'];

function nuevoEntorno() {
    const store = {};
    const localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    const win = {};
    const ctx = {
        window: win, localStorage,
        console: { log(){}, warn(){}, error(){}, debug(){} },
        setTimeout: () => 0, clearTimeout: () => {},
        Promise, Date, JSON, Object, Array, String, Number, Boolean, Math,
        RegExp, isNaN, parseInt, parseFloat, Error,
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
        navigator: { userAgent: 'node' }
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC_UTILS, ctx);
    vm.runInContext(SRC_STORE, ctx);
    return { ctx, win, localStorage };
}

function seEntra(win, category, subcategory) {
    win._cronosCurrentUser = {
        uid: 'uid_1', clubId: 'club_dia',
        allRoles: [{ role: 'user', clubId: 'club_dia', category, subcategory, isAuthorized: true }]
    };
}

//  `porEquipo` = el equipo ya materializado (v580); sin él se lee el legado,
//  que es el caso de quien todavía no ha vuelto a guardar la plantilla.
function ponPlantillas(localStorage, win, opciones) {
    const o = opciones || {};
    const raiz = { f7: o.f7 || [], f11: o.f11 || [], porEquipo: {} };
    if (o.equipoAbierto) {
        raiz.migrado = true;
        raiz.semilla = { f7: o.f7 || [], f11: o.f11 || [] };
        raiz.porEquipo[o.equipoAbierto] = { f7: o.f7 || [], f11: o.f11 || [] };
        win._cronosMatchSlots = { equipoActual: () => o.equipoAbierto };
    }
    localStorage.setItem('cronos_master_roster', JSON.stringify(raiz));
}

console.log('\n══ v729 · la lista de Asistencia es la plantilla del equipo ══');

// ═════════════════════════════════════════════════════════════════════
console.log('\n1) 🔑 EL CASO DE SUS CAPTURAS · Regional B (F11)');
{
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'regional', 'B');
    ponPlantillas(localStorage, win, { f7: F7_OTRO_EQUIPO, f11: F11_REGIONAL_B });

    const pl = win.CronosAttendance.jugadores();
    const nombres = pl.map(p => p.nombre);

    ok('1a · la lista tiene los 25 de su plantilla, ni uno más', pl.length === 25,
       'filas=' + pl.length);
    ok('1b · 🔑🔑 el nº 1 es LUIS y el nº 2 PEDRO, como en Gestionar Plantilla',
       nombres[0] === 'LUIS' && nombres[1] === 'PEDRO',
       nombres.slice(0, 3).join(', '));
    ok('1c · 🔑 no aparece NINGUNO de los once intrusos que él señaló',
       !INTRUSOS.some(n => nombres.indexOf(n) !== -1),
       INTRUSOS.filter(n => nombres.indexOf(n) !== -1).join(', '));
    ok('1d · la correspondencia es biunívoca, dorsal a dorsal, con la plantilla',
       pl.every((p, i) => p.nombre === F11_REGIONAL_B[i].name &&
                          p.dorsal === String(F11_REGIONAL_B[i].number) &&
                          p.ficha  === F11_REGIONAL_B[i].id),
       JSON.stringify(pl.slice(0, 4).map(p => p.dorsal + ':' + p.nombre)));
    ok('1e · ⚠️ y la ficha 3 vuelve a ser SANCHO, no TONI (era la marca que ' +
       'se escribía sobre el jugador equivocado)',
       pl.filter(p => p.ficha === 'ALC03')[0].nombre === 'SANCHO');
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n2) EL OTRO EQUIPO DEL MISMO ENTRENADOR · Alevín C (F7)');
{
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'alevin', 'C');
    ponPlantillas(localStorage, win, { f7: F7_OTRO_EQUIPO, f11: F11_REGIONAL_B });

    const pl = win.CronosAttendance.jugadores();
    ok('2a · en el equipo de F7 se pasa lista con la plantilla de F7',
       pl.length === 18 && pl[0].nombre === 'PEDRO' && pl[2].nombre === 'TONI',
       'filas=' + pl.length + ' · ' + pl.slice(0, 3).map(p => p.nombre).join(', '));
    ok('2b · 🔑 y ahí NO se cuelan los 25 del Regional B',
       pl.every(p => parseInt(p.dorsal, 10) <= 18),
       JSON.stringify(pl.map(p => p.dorsal)));
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n3) CON LA PLANTILLA YA MATERIALIZADA POR EQUIPO (v580)');
{
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'regional', 'B');
    ponPlantillas(localStorage, win, {
        f7: F7_OTRO_EQUIPO, f11: F11_REGIONAL_B, equipoAbierto: 'club_dia__regional__b' });

    const pl = win.CronosAttendance.jugadores();
    ok('3a · misma respuesta leyendo `porEquipo`: los 25 suyos',
       pl.length === 25 && pl[0].nombre === 'LUIS',
       'filas=' + pl.length + ' · primero=' + (pl[0] || {}).nombre);
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n4) ⚠️ EL RESPALDO NUNCA VUELVE A FUNDIR LAS DOS LISTAS');
{
    // Equipo de F11 cuya plantilla F11 está todavía en blanco: se usa la que
    // tenga jugadores, pero UNA, no las dos pegadas.
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'regional', 'B');
    ponPlantillas(localStorage, win, { f7: F7_OTRO_EQUIPO, f11: [] });
    const pl = win.CronosAttendance.jugadores();
    ok('4a · con su modalidad vacía se cae a la otra lista…', pl.length === 18);
    ok('4b · 🔑 …pero SIN fundirlas: nunca 18+25 filas', pl.length !== 43);
}
{
    // Sin categoría no hay modalidad que derivar: tampoco se funden.
    const { win, localStorage } = nuevoEntorno();
    win._cronosCurrentUser = { uid: 'uid_1', clubId: 'club_dia', allRoles: [] };
    ponPlantillas(localStorage, win, { f7: F7_OTRO_EQUIPO, f11: F11_REGIONAL_B });
    const pl = win.CronosAttendance.jugadores();
    ok('4c · sin modalidad resoluble se elige UNA lista, no la suma',
       pl.length === 25 || pl.length === 18, 'filas=' + pl.length);
    const fichas = pl.map(p => p.ficha);
    ok('4d · y sin fichas repetidas', fichas.length === new Set(fichas).size);
}
{
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'regional', 'B');
    ponPlantillas(localStorage, win, { f7: [], f11: [] });
    ok('4e · sin plantilla, lista vacía y sin reventar',
       win.CronosAttendance.jugadores().length === 0);
}

// ═════════════════════════════════════════════════════════════════════
console.log('\n5) LO QUE YA HACÍA BIEN Y SIGUE HACIENDO');
{
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'regional', 'B');
    ponPlantillas(localStorage, win, { f7: [], f11: [
        { id: 'ALC01', number: 1, name: 'LUIS',  alias: 'LUIS' },
        { id: '',      number: 2, name: '',      alias: '' },      // fila en blanco
        { id: 'ALC03', number: 3, name: '',      alias: '' },      // plaza de apoyo sin jugador
        { id: 'ALC01', number: 9, name: 'OTRO',  alias: 'OTRO' },  // ficha repetida
        { id: 'ALC05', number: 5, name: 'LANDI', alias: '' }       // sin alias: se deriva del nombre
    ]});
    const pl = win.CronosAttendance.jugadores();
    ok('5a · las filas vacías y las plazas sin jugador no entran', pl.length === 2,
       JSON.stringify(pl.map(p => p.ficha)));
    ok('5b · ⚠️ una ficha repetida NO pinta dos botones sobre la misma marca',
       pl.filter(p => p.ficha === 'ALC01').length === 1);
    ok('5c · sin alias se usa el nombre', pl[1].alias === 'LANDI');
}

console.log('\n────────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + ' PASS · ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
