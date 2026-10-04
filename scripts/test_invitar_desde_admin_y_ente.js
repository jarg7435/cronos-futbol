// ════════════════════════════════════════════════════════════════════════
//  test_invitar_desde_admin_y_ente.js — v781
//  ⚠️ SIN «secret» EN EL NOMBRE: `.gitignore` ignora `*secret*` (ver la
//  cabecera de test_tablero_paneles_e_invitaciones.js).
// ════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-10-04, capturas 11041-11044):
//  la Secretaría —que sólo tenía el Director Deportivo— pasa también al
//  Administrador del Club y al Entrenador-Administrador Individual (ente),
//  con las invitaciones atadas a SU club.
//
//  🔑 LO QUE ESTE GUARD PROTEGE:
//   · El Admin de Club invita a director, coordinador y entrenador — y NO a
//     familias ni a otro administrador. El ente, SÓLO a familias: bajo un ente
//     el alta no admite otro rol (auth.js, ROLES_BAJO_ENTE).
//   · Un rol cuyo extra está apagado se RETIRA; y una lista vacía se queda
//     vacía (caerse a 'user' sería ofrecer un rol que el panel no puede dar).
//   · La invitación lleva el `clubId`, y el alta casa el club POR ID antes que
//     por nombre (dos clubes homónimos ya no se confunden).
//   · El servidor deja enviar al `individual` por la RAÍZ o el CLAIM, nunca
//     por `allRoles` (SEC-F03).
//   · Es el MISMO módulo en todos los paneles: nada de copias.
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
const SECR  = leer('js/admin/superadmin/secretary.js');
const CLUB  = leer('js/admin/club/panel.js');
const IND   = leer('js/admin/individual/panel.js');
const PREF  = leer('js/services/auth/invite-prefill.js');
const FUNC  = leer('functions/index.js');
const SETUP = leer('js/core/setup-modal.js');

// ── PARTE 1 · secretary.js EJECUTADO ──────────────────────────────────────
console.log('\nPARTE 1 · el módulo de Secretaría, ejecutado');
const campos = { 'sec-email': { value: 'ana@x.es' }, 'sec-role': { value: 'director' },
                 'sec-club': { value: 'CD DÍA' } };
const sb = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: (id) => campos[id] || null },
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout() {},
};
sb.window = sb;
vm.createContext(sb);
// El mapa de extras por rol, tal cual lo define setup-modal.js.
const _mRol = SETUP.match(/window\.CRONOS_ROL_EXTRA = \{[\s\S]*?\};/);
ok('0a · setup-modal.js define CRONOS_ROL_EXTRA', !!_mRol);
if (_mRol) vm.runInContext(_mRol[0], sb);
vm.runInContext(SECR, sb);

const W = sb.window;
ok('1a · Admin de Club: director, coordinador y entrenador',
   JSON.stringify(W.CRONOS_SECRETARIA_ROLES_CLUB_ADMIN) === JSON.stringify(['director', 'coordinator', 'user']),
   W.CRONOS_SECRETARIA_ROLES_CLUB_ADMIN);
ok('1b · Admin de Club: ni familias ni otro administrador',
   !W.CRONOS_SECRETARIA_ROLES_CLUB_ADMIN.includes('parent') &&
   !W.CRONOS_SECRETARIA_ROLES_CLUB_ADMIN.includes('club_admin'));
ok('1c · Ente: SÓLO familias',
   JSON.stringify(W.CRONOS_SECRETARIA_ROLES_ENTE) === JSON.stringify(['parent']), W.CRONOS_SECRETARIA_ROLES_ENTE);

const todoOn = () => true;
ok('1d · con todo contratado no se quita nada',
   JSON.stringify(W.cronosSecretariaRoles(W.CRONOS_SECRETARIA_ROLES_CLUB_ADMIN, todoOn)) ===
   JSON.stringify(['director', 'coordinator', 'user']));
const sinDirector = (k) => k !== 'rol_director';
ok('1e · sin el extra de Director, el Director se retira',
   JSON.stringify(W.cronosSecretariaRoles(W.CRONOS_SECRETARIA_ROLES_CLUB_ADMIN, sinDirector)) ===
   JSON.stringify(['coordinator', 'user']));
ok('1f · el Entrenador nunca se filtra (no tiene extra)',
   W.cronosSecretariaRoles(['user'], () => false).length === 1);
ok('1g · ente sin Familias → lista VACÍA, no se cae a otro rol',
   W.cronosSecretariaRoles(W.CRONOS_SECRETARIA_ROLES_ENTE, () => false).length === 0);

const pf = W.secPlantillaFabrica('email', 'CD DÍA', 'CD DÍA');
ok('1h · con firmante, firma ese nombre', /Un saludo,\nCD DÍA$/.test(pf), pf.slice(-40));
const pfDir = W.secPlantillaFabrica('email', 'CD DÍA');
ok('1i · sin firmante, el Director firma como siempre',
   /La Dirección Deportiva de CD DÍA$/.test(pfDir), pfDir.slice(-40));

// ── PARTE 2 · la invitación lleva el clubId ───────────────────────────────
console.log('\nPARTE 2 · el enlace se acuña CON el clubId');
(async () => {
    let recibido = null;
    W.cronosCrearInvitacion = async (d) => { recibido = d; return { url: 'https://x/?invite=abc12345', token: 'abc12345' }; };
    W._secCtx = { clubId: 'CLUB_DIA_ID', clubName: 'CD DÍA', clubFijo: true, firma: '' };
    W._secTokenActual = null;
    await W._secEnlaceReal();
    ok('2a · cronosCrearInvitacion recibe el clubId del panel',
       recibido && recibido.clubId === 'CLUB_DIA_ID', recibido);
    ok('2b · y el nombre del club', recibido && recibido.clubName === 'CD DÍA');

    // ── PARTE 3 · el alta casa POR ID ─────────────────────────────────────
    console.log('\nPARTE 3 · el alta casa el club por id antes que por nombre');
    const ini = PREF.indexOf('function _norm(');
    const fin = PREF.indexOf('function _el(');
    const ini2 = PREF.indexOf('function _buscarClub(');
    const fin2 = PREF.indexOf('// ════', ini2);
    ok('3a · _buscarClub acepta el clubId', /function _buscarClub\(sel, nombre, clubId\)/.test(PREF));
    const sb2 = { String, RegExp };
    vm.createContext(sb2);
    vm.runInContext(PREF.slice(ini, fin) + PREF.slice(ini2, fin2) + ';this._buscarClub=_buscarClub;', sb2);
    const opcion = (value, text) => ({ value, textContent: text });
    const sel = { querySelectorAll: () => [
        opcion('club:OTRO', '🏟️ CD DÍA'),          // homónimo, va PRIMERO
        opcion('club:CLUB_DIA_ID', '🏟️ CD DÍA'),
        opcion('individual:ENTE1', '👤 Escuela Pepe'),
    ] };
    const h1 = sb2._buscarClub(sel, 'CD DÍA', 'CLUB_DIA_ID');
    ok('3b · con dos homónimos, gana el del id', h1 && h1.value === 'club:CLUB_DIA_ID', h1);
    const h2 = sb2._buscarClub(sel, 'Escuela Pepe', 'ENTE1');
    ok('3c · el ente se casa por `individual:<id>`', h2 && h2.value === 'individual:ENTE1', h2);
    const h3 = sb2._buscarClub(sel, 'CD DÍA', '');
    ok('3d · sin id (invitaciones viejas) sigue casando por nombre', h3 && h3.value === 'club:OTRO', h3);
    ok('3e · el id sale del TOKEN', /clubId = inv\.clubId \|\| ''/.test(PREF));
    ok('3f · y se usa al buscar', /_buscarClub\(selClub, club, clubId\)/.test(PREF));

    // ── PARTE 4 · los paneles ─────────────────────────────────────────────
    console.log('\nPARTE 4 · la tarjeta y la pantalla en los dos paneles');
    ok('4a · Club: tarjeta Secretaría que abre caTab(secretaria)',
       /titulo: 'Secretaría'[\s\S]{0,200}onclick: "caTab\('secretaria'\)"/.test(CLUB));
    ok('4b · Club: la sección existe en _CA_SECCIONES', /secretaria:\s*\{ titulo: '✉️ Secretaría'/.test(CLUB));
    const caSec = CLUB.slice(CLUB.indexOf("if (sec === 'secretaria')"));
    ok('4c · Club: pinta con saSecretary, club fijo y SU clubId',
       /window\.saSecretary\(\{[\s\S]{0,600}clubId:\s+clubId,[\s\S]{0,40}clubFijo: true/.test(caSec));
    ok('4d · Club: roles de CRONOS_SECRETARIA_ROLES_CLUB_ADMIN filtrados por extras',
       /cronosSecretariaRoles\(window\.CRONOS_SECRETARIA_ROLES_CLUB_ADMIN/.test(CLUB));
    ok('4e · Club: la tarjeta NO depende del extra `secretaria` del Director',
       !/titulo: 'Secretaría'[\s\S]{0,300}bloqueado/.test(CLUB.slice(CLUB.indexOf('const _caOpciones'))));
    ok('4f · Ente: tarjeta Secretaría que abre indTab(secretaria)',
       /titulo: 'Secretaría'[\s\S]{0,200}onclick: "indTab\('secretaria'\)"/.test(IND));
    ok('4g · Ente: bloqueada con motivo si no tiene Familias', /bloqueado: _indSecMotivo/.test(IND));
    const indSec = IND.slice(IND.indexOf("if (sec === 'secretaria')"));
    ok('4h · Ente: segunda puerta antes de pintar', /if \(_indSecMotivo\)/.test(indSec.slice(0, 400)));
    ok('4i · Ente: pinta con su id de entidad y club fijo',
       /clubId:\s+individualEntityId \|\| '',[\s\S]{0,40}clubFijo: true/.test(indSec));
    ok('4j · Ente: roles de CRONOS_SECRETARIA_ROLES_ENTE', /CRONOS_SECRETARIA_ROLES_ENTE/.test(IND));

    // ── PARTE 5 · el servidor ─────────────────────────────────────────────
    console.log('\nPARTE 5 · sendInviteEmail deja enviar al ente');
    const fn = FUNC.slice(FUNC.indexOf('exports.sendInviteEmail'), FUNC.indexOf('const _clubPropio'));
    ok('5a · `individual` entre los roles que invitan',
       /_ROLES_QUE_INVITAN = \['director', 'club_admin', 'individual'\]/.test(fn));
    ok('5b · por la RAÍZ (con cuenta habilitada) y por el CLAIM',
       /_esStaffRaiz = _habilitado && _ROLES_QUE_INVITAN\.includes\(_cd\.role\)/.test(fn) &&
       /_esStaffClaim = _ROLES_QUE_INVITAN\.includes\(_tk\.role/.test(fn));
    ok('5c · 🚨 NUNCA por allRoles (SEC-F03)', !/_cd\.allRoles/.test(fn));
    ok('5d · el club se sigue imponiendo para quien no es SA',
       /const clubName = _esSA \? data\.clubName : _clubPropio;/.test(FUNC));

    console.log('\n' + (total - fallos) + '/' + total + ' aserciones');
    process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
