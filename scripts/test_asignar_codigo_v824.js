// ─────────────────────────────────────────────────────────────────────────
//  test_asignar_codigo_v824.js  ·  ⏳🔗 v824 (2026-10-18)
//
//  Encargo del autor (implementar.txt + captura 11577): la familia ya no
//  teclea el código del jugador. Su pantalla dice «registrada, pendiente
//  de que el entrenador te asigne tu jugador», y el entrenador ve en
//  Contactos un aviso «Asignar código» con las familias pendientes de SU
//  equipo y un desplegable de su plantilla para asignarlas.
//
//  Se vigila:
//   1. Quién está pendiente (se EJECUTA _cmCalculaPendientes).
//   2. La pantalla de espera de la familia.
//   3. El bloque y la asignación en Contactos + la insignia del menú.
//   4. Reglas: la cuenta de familia no crea vínculos.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UTILS = leer('js/core/utils.js');
const PAR = leer('js/parent/panel.js');
const CM = leer('js/coach/comms/contact-manager.js');
const SM = leer('js/core/setup-modal.js');
const RULES = leer('firestore.rules');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 400)); }
};
const funcion = (src, desde) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No está: ' + desde);
    let p = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) { if (src[j] === '{') p++; else if (src[j] === '}') { p--; if (!p) break; } }
    return src.slice(i, j + 1);
};

console.log('\n══ ⏳🔗 v824 · el entrenador asigna el jugador a la familia ══\n');

console.log('1) Quién está pendiente');
{
    const ctx = { window: {} };
    vm.createContext(ctx);
    ['function _cronosNoEsAcento(', 'function cronosTeamSlug(', 'function cronosSinModalidad(', 'function cronosTeamId(',
     'function cronosTeamIdNorm(', 'function _cmCalculaPendientes('].forEach((f) => {
        const src = f === 'function _cmCalculaPendientes(' ? CM : UTILS;
        try { vm.runInContext(funcion(src, f), ctx); } catch (e) { /* ausente: lo dirá la prueba */ }
    });
    vm.runInContext('window.cronosTeamId = cronosTeamId; window.cronosTeamIdNorm = cronosTeamIdNorm;', ctx);
    const club = 'club_x';
    const eqAL = vm.runInContext('cronosTeamId("club_x", "alevin", "C")', ctx);
    const plaza = (cat, sub, extra) => Object.assign({ role: 'parent', clubId: club, category: cat, subcategory: sub }, extra || {});
    const padres = [
        { uid: 'u1', email: 'a@x', displayName: 'Ana', isAuthorized: true, allRoles: [plaza('alevin', 'C', { playerAlias: 'PEPE' })] },
        { uid: 'u2', email: 'b@x', displayName: 'Bea', isAuthorized: true, allRoles: [plaza('regional', 'B')] },          // otro equipo
        { uid: 'u3', email: 'c@x', displayName: 'Carla', isAuthorized: false, status: 'pending_club_admin', allRoles: [plaza('alevin', 'C')] }, // sin aprobar
        { uid: 'u4', email: 'd@x', displayName: 'Dani', isAuthorized: true, allRoles: [plaza('alevin', 'C')] },           // ya vinculada
        { uid: 'u5', email: 'e@x', displayName: 'Eva', isAuthorized: true, allRoles: [plaza('alevin', 'C'), plaza('regional', 'B')] }, // vinculada en el OTRO
        { uid: 'u6', email: 'f@x', displayName: 'Fran', isAuthorized: true, allRoles: [] },                               // sin equipo
        { uid: 'u7', email: 'g@x', displayName: 'Gema', isAuthorized: true, allRoles: [plaza('alevin', 'C', { status: 'removed' })], category: 'regional', subcategory: 'B' },
    ];
    const links = [
        { parentUid: 'u4', teamId: eqAL },
        { parentUid: 'u5', teamId: vm.runInContext('cronosTeamId("club_x", "regional", "B")', ctx) },
    ];
    ctx.__a = [links, padres, club, eqAL];
    let r = [];
    try { r = vm.runInContext('_cmCalculaPendientes(__a[0], __a[1], __a[2], __a[3])', ctx); } catch (e) { r = []; }
    const uids = r.map((p) => p.uid).sort();
    ok('1a · 🔑 sale la familia aprobada de este equipo sin vínculo', uids.includes('u1'), uids);
    ok('1b · 🔑 NO sale la de otro equipo', !uids.includes('u2'), uids);
    ok('1c · NO sale la que el club aún no ha aprobado', !uids.includes('u3'), uids);
    ok('1d · NO sale la ya vinculada en este equipo', !uids.includes('u4'), uids);
    ok('1e · 🔑 sale la vinculada sólo en su OTRO equipo', uids.includes('u5'), uids);
    ok('1f · sale la que no indicó equipo, marcada', uids.includes('u6') && (r.find((p) => p.uid === 'u6') || {}).sinEquipo === true, r);
    ok('1g · plaza retirada no cuenta: manda la categoría de la raíz (otro equipo)', !uids.includes('u7'), uids);
    ok('1h · lleva el jugador que indicó al registrarse', (r.find((p) => p.uid === 'u1') || {}).playerAlias === 'PEPE');
    ctx.__b = [[{ parentUid: 'u1', teamId: '' }], padres, club, eqAL];
    const r2 = vm.runInContext('_cmCalculaPendientes(__b[0], __b[1], __b[2], __b[3])', ctx).map((p) => p.uid);
    ok('1i · un vínculo viejo sin equipo cuenta como asignado', !r2.includes('u1'), r2);
}

console.log('\n2) La pantalla de la familia');
{
    const pp = funcion(PAR, 'window.ppPlayer = async');
    ok('2a · 🔑 sin vínculo → pantalla de espera, sin formulario', /if \(!links\.length\) \{\s*body\.innerHTML = _ppPendienteHTML\(me, clubId\);\s*_ppEsperaVinculo\(me\);\s*return;/.test(pp));
    const html = funcion(PAR, 'function _ppPendienteHTML(');
    ok('2b · dice «registrada» y «pendiente de que el entrenador… asigne tu jugador»',
       /registrado correctamente/.test(html) && /pendiente de que el entrenador de tu equipo te asigne tu jugador/.test(html));
    ok('2c · ningún campo de texto que teclear', !/<input/.test(html));
    const espera = funcion(PAR, 'async function _ppEsperaVinculo(');
    ok('2d · escucha su vínculo y repinta al llegar; se da de baja', /onSnapshot\(/.test(espera) && /where\('parentUid', '==', yo\.uid\)/.test(espera) && /baja\(\); if \(window\.ppPlayer\) window\.ppPlayer\(\);/.test(espera));
}

console.log('\n3) Contactos');
{
    ok('3a · el bloque de avisos se pinta en la sección de familias', /\$\{_cmPendientesHTML\(_cmPendientes\)\}/.test(CM));
    ok('3b · se calcula con el equipo ABIERTO', /_cmPendientes = _cmCalculaPendientes\(links, _padres, me\.clubId \|\| '',/.test(CM));
    ok('3c · la fila manual de una pendiente se aparta y vuelve al guardar', /if \(uid && _cmUidsPendientes\.has\(uid\)\) \{ _cmOcultas\.push\(c\); return false; \}/.test(CM));
    const asig = funcion(CM, 'window.cmAsignarJugador = async function');
    ok('3d · 🔑 exige elegir jugador y confirmar', /if \(!sel\.value\)/.test(asig) && /confirm\(/.test(asig));
    ok('3e · 🔑 el vínculo lleva código, equipo abierto, dorsal y la cuenta', /playerCode:\s+sel\.value,/.test(asig) && /teamId:\s+eq,/.test(asig)
       && /parentUid:\s+uid,/.test(asig) && /assignedBy:\s+me\.uid,/.test(asig));
    ok('3f · repinta Contactos al asignar', /await openContactManager\(\);/.test(asig));
    ok('3g · ⚠️ sin backticks en el HTML del bloque (va dentro del template)', funcion(CM, 'function _cmPendientesHTML(').indexOf('`') < 0);
    ok('3h · 🔔 insignia en el botón CONTACTOS del menú', /id="cm-pend-badge"/.test(SM) && /cmPintaInsigniaPendientes\(\)/.test(SM));
}

console.log('\n4) Reglas');
{
    const i = RULES.indexOf('match /cronos_player_links/{linkId}');
    const L = RULES.slice(i, RULES.indexOf('\n    }\n', i));
    const cre = L.slice(L.indexOf('allow create'), L.indexOf('allow update'));
    ok('4a · 🔑 la cuenta de familia no crea vínculos', /&& !esCuentaFamilia\(\)\)/.test(cre) && !/parentUid', null\) == request\.auth\.uid/.test(cre), cre);
    ok('4b · la familia sigue pudiendo corregir sus datos de contacto', /\.hasOnly\(\['parentUid', 'parentEmail', 'parentName', 'parentPhone'\]\)/.test(L));
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
