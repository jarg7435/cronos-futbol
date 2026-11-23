// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v861 · LA LISTA plazasAdultas SE MANTIENE SOLA (fase 2 de N5)
// ═══════════════════════════════════════════════════════════════════════════
//  `clubs/{id}.plazasAdultas` decide quién puede abrir clips de adultos a las
//  familias (reglas v860). La mantiene la function `syncPlazasAdultas`, que se
//  dispara al cambiar `users/{uid}` y sabe QUIÉN hizo el cambio:
//    · QUITAR, siempre (baja, revocación, paso a menores, cuenta bloqueada,
//      perfil borrado): es el lado seguro, lo haga quien lo haga;
//    · AÑADIR, sólo si el cambio lo hizo alguien con autoridad sobre ESE club
//      (SuperAdmin, Admin, Director o Coordinador del club, admin del ente, o
//      el servidor). 🔑 El propio usuario NO: `allRoles` es autoescribible
//      (INC-2026-004) y una plaza «senior» escrita por él no puede abrirle
//      nada a las familias.
//  Se EJECUTAN las funciones puras de functions/index.js (bloque delimitado
//  por ⟦plazasAdultas⟧), no se buscan con expresiones regulares.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 300)); } };

console.log('\n══ v861 · syncPlazasAdultas: la lista se mantiene sola ══\n');
const ini = SRC.indexOf('// ⟦plazasAdultas⟧ inicio'), fin = SRC.indexOf('// ⟦plazasAdultas⟧ fin');
ok('0a · existe el bloque de funciones puras ⟦plazasAdultas⟧ en functions/index.js', ini >= 0 && fin > ini);
if (ini < 0 || fin <= ini) { console.log('\nResultado: ' + pass + '/' + (pass + fail) + '  ❌'); process.exit(1); }

const sb = {};
vm.createContext(sb);
vm.runInContext(SRC.slice(ini, fin) + '\n;this.clubes = _plazasAdultasClubes; this.decide = _plazasAdultasDecide; this.autoridad = _autoridadPlazasAdultas;', sb);
const { clubes, decide, autoridad } = sb;
ok('0b · las tres funciones se cargan', typeof clubes === 'function' && typeof decide === 'function' && typeof autoridad === 'function');

const U = (plazas, extra) => Object.assign({ isAuthorized: true, status: 'active', role: 'user', clubId: 'clubA', allRoles: plazas }, extra || {});
const P = (role, category, extra) => Object.assign({ role, category, subcategory: 'A', clubId: 'clubA', isAuthorized: true, status: 'active' }, extra || {});
const S = (x) => JSON.stringify([...x].sort());
const D = (a, b) => { const r = decide(a, b); return { anadir: S(r.anadir), quitar: S(r.quitar) }; };

console.log('\n1) En qué clubes cumple una cuenta');
ok('1a · plaza viva de entrenador Regional → su club', S(clubes(U([P('user', 'regional')]))) === S(['clubA']));
ok('1b · con prefijo de modalidad (f11_regional) también', S(clubes(U([P('user', 'f11_regional')]))) === S(['clubA']));
ok('1c · Regional FEM sí, FUTureFEM no', S(clubes(U([P('user', 'regional_fem')]))) === S(['clubA']) && S(clubes(U([P('user', 'futurefem')]))) === S([]));
ok('1d · categoría de menores → ninguno', S(clubes(U([P('user', 'alevin')]))) === S([]));
ok('1e · una FAMILIA en Regional no es cuerpo técnico → ninguno', S(clubes(U([P('parent', 'regional')], { role: 'parent' }))) === S([]));
ok('1f · plaza dada de baja (removed) o revocada → ninguno',
   S(clubes(U([P('user', 'regional', { status: 'removed' })]))) === S([]) && S(clubes(U([P('user', 'regional', { status: 'revoked' })]))) === S([]));
ok('1g · plaza sin autorizar → ninguno', S(clubes(U([P('user', 'regional', { isAuthorized: false })]))) === S([]));
ok('1h · cuenta bloqueada o no autorizada → ninguno',
   S(clubes(U([P('user', 'regional')], { status: 'blocked' }))) === S([]) && S(clubes(U([P('user', 'regional')], { isAuthorized: false }))) === S([]));
ok('1i · perfil borrado (null) → ninguno', S(clubes(null)) === S([]));
ok('1j · plaza de un ente (individualEntityId) → el ente', S(clubes(U([P('individual', 'regional', { clubId: null, individualEntityId: 'ente1' })], { clubId: null, individualEntityId: 'ente1', role: 'individual' }))) === S(['ente1']));

console.log('\n2) Qué cambia');
ok('2a · se aprueba una plaza Regional → añadir su club', JSON.stringify(D(U([]), U([P('user', 'regional')]))) === JSON.stringify({ anadir: S(['clubA']), quitar: S([]) }));
ok('2b · baja de la plaza Regional → quitar', JSON.stringify(D(U([P('user', 'regional')]), U([P('user', 'regional', { status: 'removed' })]))) === JSON.stringify({ anadir: S([]), quitar: S(['clubA']) }));
ok('2c · la plaza pasa a categoría de menores → quitar', D(U([P('user', 'regional')]), U([P('user', 'alevin')])).quitar === S(['clubA']));
ok('2d · se bloquea la cuenta → quitar', D(U([P('user', 'regional')]), U([P('user', 'regional')], { status: 'blocked' })).quitar === S(['clubA']));
ok('2e · se borra el perfil → quitar', D(U([P('user', 'regional')]), null).quitar === S(['clubA']));
ok('2f · 🔑 dos equipos (Alevín + Regional): baja del Alevín → NO se quita',
   JSON.stringify(D(U([P('user', 'alevin'), P('user', 'regional')]), U([P('user', 'alevin', { status: 'removed' }), P('user', 'regional')]))) === JSON.stringify({ anadir: S([]), quitar: S([]) }));
ok('2g · un cambio que no toca las plazas → nada', JSON.stringify(D(U([P('user', 'regional')]), U([P('user', 'regional')], { lastLogin: 'x' }))) === JSON.stringify({ anadir: S([]), quitar: S([]) }));

console.log('\n3) 🔑 Quién puede AÑADIR (quitar no necesita autoridad)');
const base = { uid: 'coach', club: 'clubA', claims: {}, esSA: false, clubDoc: { adminUid: 'adm', directorUids: ['dir'], coordinatorUids: ['coo'] }, autorDoc: null };
const A = (o) => autoridad(Object.assign({}, base, o)).ok;
ok('3a · el SuperAdmin → sí', A({ authType: 'api_key', authId: 'sa', esSA: true }));
ok('3b · el Admin del club (adminUid del club) → sí', A({ authType: 'api_key', authId: 'adm' }));
ok('3c · el Admin del club por claim (club_admin + clubId) → sí', A({ authType: 'api_key', authId: 'adm2', claims: { role: 'club_admin', clubId: 'clubA' } }));
ok('3d · el Director de la lista del club → sí', A({ authType: 'api_key', authId: 'dir' }));
ok('3e · el Coordinador de la lista del club → sí', A({ authType: 'api_key', authId: 'coo' }));
ok('3f · Director por su perfil raíz (director, activo, de ese club) → sí',
   A({ authType: 'api_key', authId: 'dir2', autorDoc: { role: 'director', clubId: 'clubA', isAuthorized: true, status: 'active' } }));
ok('3g · el admin del ente (claim individual + clubId del ente) → sí', A({ authType: 'api_key', authId: 'ent', club: 'ente1', claims: { role: 'individual', clubId: 'ente1' }, clubDoc: null }));
ok('3h · el servidor (Admin SDK / scripts del SA) → sí', A({ authType: 'service_account', authId: null }) && A({ authType: 'system', authId: null }));
ok('3i · 🔑🔑 el PROPIO usuario → NO (aunque fuera Director de otro sitio)', !A({ authType: 'api_key', authId: 'coach', esSA: false }));
ok('3j · 🔑 un entrenador cualquiera del club → NO', !A({ authType: 'api_key', authId: 'otro', autorDoc: { role: 'user', clubId: 'clubA', isAuthorized: true, status: 'active' } }));
ok('3k · el Admin de OTRO club → NO', !A({ authType: 'api_key', authId: 'admB', claims: { role: 'club_admin', clubId: 'clubB' } }));
ok('3l · un Director de otro club → NO', !A({ authType: 'api_key', authId: 'dirB', autorDoc: { role: 'director', clubId: 'clubB', isAuthorized: true, status: 'active' } }));
ok('3m · un Director dado de baja → NO', !A({ authType: 'api_key', authId: 'dir3', autorDoc: { role: 'director', clubId: 'clubA', isAuthorized: true, status: 'removed' } }));
ok('3n · sin autenticar → NO', !A({ authType: 'unauthenticated', authId: null }));

console.log('\n4) La function, enchufada y en MODO SOMBRA por defecto');
ok('4a · syncPlazasAdultas usa onDocumentWrittenWithAuthContext sobre users/{uid}',
   /exports\.syncPlazasAdultas\s*=\s*onDocumentWrittenWithAuthContext\(\s*\{[^}]*document:\s*'users\/\{uid\}'/.test(SRC));
ok('4b · 🔑 sólo ESCRIBE si cronos_config/plazasAdultasSync.escribir === true (si no, sólo registra)',
   /plazasAdultasSync[\s\S]{0,400}escribir === true/.test(SRC) && /\[plazasAdultas\]\[SOMBRA\]/.test(SRC));
ok('4c · escribe sólo el campo plazasAdultas con arrayUnion / arrayRemove',
   /plazasAdultas:\s*admin\.firestore\.FieldValue\.arrayUnion\(/.test(SRC) && /plazasAdultas:\s*admin\.firestore\.FieldValue\.arrayRemove\(/.test(SRC));

console.log('\nResultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);
