// ─────────────────────────────────────────────────────────────────────────
//  test_quitar_del_equipo_plaza.js  ·  🔴 v831 (hallazgo del 19-10)
//
//  «➖ Quitar del equipo» (panel del Admin de Club) llamaba a
//  caRevocarCasilla con el ROL y sin la PLAZA. Sin plaza, caSetUserStatus
//  revoca «todo el rol en este club». Con un entrenador de DOS equipos
//  (Alevín A y Regional B):
//    · se le quitaban LOS DOS;
//    · el aviso contaba 0 roles restantes y anunciaba que su cuenta se
//      ELIMINARÍA (y pedía teclear el correo);
//    · archiveAndDeleteCoach archivaba en el PRIMER equipo que encontraba.
//  Tres guards no lo vieron porque miraban `userRow`, una fila MUERTA desde
//  el 25-06.
//
//  Aquí se EJECUTA el código real: caRevocarCasilla en un sandbox con el
//  documento de un entrenador de dos equipos, y _resuelveEquipo de la
//  Function.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PANEL = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'club', 'panel.js'), 'utf8');
const FN = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : '')); }
};

const CLUB = 'club_x';
const DOS_EQUIPOS = {
    role: 'user', clubId: CLUB, category: 'alevin', subcategory: 'A',   // la RAÍZ = Alevín A
    allRoles: [
        { role: 'user', clubId: CLUB, category: 'alevin', subcategory: 'A', status: 'active', isAuthorized: true },
        { role: 'user', clubId: CLUB, category: 'regional', subcategory: 'B', status: 'active', isAuthorized: true },
    ],
};

console.log('\n══ 🔴 «Quitar del equipo» quita UN equipo, no todos (v831) ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) caRevocarCasilla, ejecutada');
const ini = PANEL.indexOf('window.caRevocarCasilla = async');
const fin = PANEL.indexOf('\n    window.ca', ini + 10);
ok('1a · se aísla caRevocarCasilla', ini > 0 && fin > ini);

async function ejecutar(args, confirmar) {
    const llam = { confirms: [], prompts: 0, setStatus: null, callable: null };
    const window = {
        ctNormCat: (x) => String(x == null ? '' : x).trim().toLowerCase(),
        ctNormSubcat: (x) => String(x == null ? '' : x).trim().toUpperCase(),
        cronosNombreCategoria: (c, s) => c + ' ' + s,
        caSetUserStatus: async (...a) => { llam.setStatus = a; return true; },
    };
    const sb = {
        window,
        getDoc: async () => ({ exists: () => true, data: () => JSON.parse(JSON.stringify(DOS_EQUIPOS)) }),
        doc: () => ({}), db: {},
        confirm: (m) => { llam.confirms.push(m); return confirmar; },
        prompt: () => { llam.prompts++; return null; },
        alert: () => {}, showToast: () => {}, navReload: () => {}, openClubAdminPanel: () => {},
        console: { error: () => {}, warn: () => {}, log: () => {} },
        fa: { functions: {} },
        httpsCallable: () => async (data) => { llam.callable = data; return { data: { rolesRestantes: ['user'] } }; },
    };
    const cuerpo = PANEL.slice(ini, fin);
    const f = new Function(...Object.keys(sb), cuerpo + '\nreturn window.caRevocarCasilla;');
    const revocar = f(...Object.values(sb));
    await revocar(...args);
    return llam;
}

(async () => {
    if (ini > 0 && fin > ini) {
        // Quitar SÓLO Regional B
        const a = await ejecutar(['uid1', 'coach@x.es', CLUB, 'user', 'regional', 'B'], true);
        const aviso = a.confirms[0] || '';
        ok('1b · 🔑🔑 el aviso NO anuncia que se elimina la cuenta (le queda Alevín A)',
           !/ELIMINAR/.test(aviso) && /conserva 1 rol/.test(aviso), aviso);
        ok('1c · …ni pide teclear el correo de confirmación', a.prompts === 0, a.prompts);
        ok('1d · el aviso dice QUÉ equipo se quita', /regional B/.test(aviso), aviso.split('\n')[0]);
        ok('1e · 🔑🔑 caSetUserStatus recibe la PLAZA (sólo Regional B)',
           a.setStatus && a.setStatus[4] === 'user' && a.setStatus[5] === true &&
           a.setStatus[6] && a.setStatus[6].category === 'regional' && a.setStatus[6].subcategory === 'B',
           a.setStatus);
        ok('1f · 🔑 la Function recibe categoría y subcategoría',
           a.callable && a.callable.category === 'regional' && a.callable.subcategory === 'B', a.callable);

        // Sin plaza (fila antigua o rol sin equipo): como antes.
        const b = await ejecutar(['uid1', 'coach@x.es', CLUB, 'user'], false);
        ok('1g · sin plaza se comporta como antes (todo el rol: 0 restantes → aviso de cuenta)',
           /ELIMINAR/.test(b.confirms[0] || ''), b.confirms[0]);
    }

    // ════════════════════════════════════════════════════════════════
    console.log('\n2) archiveAndDeleteCoach archiva en ESE equipo');
    const trozo = FN.match(/function _esMarcaDeAcento[\s\S]*?\nfunction _resuelveEquipo\([\s\S]*?\n\}\n/);
    ok('2a · se extrae _resuelveEquipo', !!trozo);
    if (trozo) {
        const resuelve = new Function(trozo[0] + '\nreturn _resuelveEquipo;')();
        const r = resuelve(DOS_EQUIPOS, { clubId: CLUB, role: 'user', category: 'regional', subcategory: 'B' });
        ok('2b · 🔑🔑 con la plaza del panel, Regional B (aunque la RAÍZ diga Alevín A)',
           r.category === 'regional' && r.subcategory === 'B' && r.teamId === 'club-x__regional__b', r);
        const acento = resuelve(DOS_EQUIPOS, { clubId: CLUB, role: 'user', category: 'Regional', subcategory: 'b' });
        ok('2c · compara normalizado (mayúsculas/acentos no rompen la búsqueda)',
           acento.category === 'regional' && acento.subcategory === 'B', acento);
        const sinPlaza = resuelve(DOS_EQUIPOS, { clubId: CLUB, role: 'user' });
        ok('2d · sin plaza, el comportamiento anterior (la raíz)',
           sinPlaza.category === 'alevin' && sinPlaza.subcategory === 'A', sinPlaza);
        const otra = resuelve(DOS_EQUIPOS, { clubId: CLUB, role: 'user', category: 'cadete', subcategory: 'C' });
        ok('2e · una plaza que no es suya no se inventa: cae al comportamiento anterior',
           otra.category === 'alevin', otra);
    }

    // ════════════════════════════════════════════════════════════════
    console.log('\n3) Ni rastro de la fila muerta');
    ok('3a · `userRow` (muerta desde el 25-06) ya no está', !/const userRow = \(u\)/.test(PANEL));
    ok('3b · ni `_slotKey` (definida y nunca llamada)', !/function _slotKey\(/.test(PANEL));

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();
