// ═══════════════════════════════════════════════════════════════════════════
//  test_alta_ente_por_plaza.js
//  v688 · LAS DECISIONES SOBRE UN ALTA DEL ENTE TOCAN SU PLAZA, NO LA CUENTA
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt + capturas 10254-10256): se dio de alta
//  como Familiar en su propio ente con SU correo de administrador. Al borrar
//  una de dos solicitudes duplicadas se quedó sin poder entrar («Acceso
//  pendiente de aprobación»), y el familiar aprobado salía en "Sin
//  categoría/subcategoría asignada".
//
//  MEDIDO EN PRODUCCIÓN (inspect_roles_por_email.js, 2026-09-10):
//      RAÍZ  role=parent  status=rejected  isAuthorized=false
//      [0] individual regional/A ✅  [1] individual prebenjamin/A ✅
//      [2] individual SIN categoría ✅  [3] parent SIN categoría ✅
//
//  Tres escrituras en la RAÍZ, cada una en una pantalla distinta:
//    · ✕ del ente y Rechazar del SA → status:'rejected'
//    · reenvío del ente → status:'pending_sa'
//    · aprobación del SA → role:'parent'
//  Y el alta que de verdad se ejecuta NO guardaba el equipo elegido.
//
//  PARTE 1 · `cronosAltaEnte`, EJECUTADA con esos datos (no una copia).
//  PARTE 2 · las cuatro pantallas LLAMAN a esas funciones y ya no escriben la
//            raíz a mano. (Red-check: contra `git show HEAD:` salen en rojo.)
//  PARTE 3 · el alta real guarda la modalidad y no duplica solicitudes.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
                       .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle).slice(0, 500) : '')); }
}
function trozo(src, cab, cierre) {
    const i = src.indexOf(cab);       if (i < 0) throw new Error('No se encontró: ' + cab);
    const j = src.indexOf(cierre, i); if (j < 0) throw new Error('Sin cierre de: ' + cab);
    return src.slice(i, j + cierre.length);
}

const UTILS  = leer('js/core/utils.js');
const PANEL  = sinCom(leer('js/admin/individual/panel.js'));
const EXTRAS = sinCom(leer('js/admin/superadmin/extras.js'));
const AUTH   = sinCom(leer('js/services/auth.js'));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · cronosAltaEnte, EJECUTADA con los datos reales ──');
// ───────────────────────────────────────────────────────────────────────────
const sb = { console: { log(){}, warn(){} }, String, Set, Array, Object, JSON };
sb.window = sb;
vm.createContext(sb);
let A = null;
try {
    vm.runInContext(trozo(UTILS, 'if (typeof window._cronosMatchModality !== \'function\') {', '\n}'), sb);
    vm.runInContext(trozo(UTILS, 'if (!Array.isArray(window.CRONOS_ROLES_CON_EQUIPO))', '\n}'), sb);
    try { vm.runInContext(trozo(UTILS, 'window.cronosTeamSlug = function', '\n    };'), sb); } catch (e) { /* opcional */ }
    vm.runInContext(trozo(UTILS, 'if (typeof window.cronosMismaPlaza !== \'function\') {', '\n}'), sb);
    vm.runInContext(trozo(UTILS, 'if (typeof window.cronosNombreCategoria !== \'function\') {', '\n}'), sb);
    vm.runInContext(trozo(UTILS, 'if (typeof window.cronosEquiposDeEntrenador !== \'function\') {', '\n}'), sb);
    vm.runInContext(trozo(UTILS, 'if (typeof window.cronosAltaEnte !== \'object\' || !window.cronosAltaEnte) {', '\n}'), sb);
    A = sb.window.cronosAltaEnte;
} catch (e) { console.log('  (no se pudo cargar: ' + e.message + ')'); }
ok('1a · `cronosAltaEnte` existe en utils.js y se deja ejecutar', !!A && typeof A.retirar === 'function');

if (A) {
    const ENTE = 'individual_mt8l6zp8_whwd';     // el ente REAL del autor
    const UID  = 'JexHG5wSWeY5OBS0BnGNdiImtQ32';
    const eqReg = { role: 'individual', clubId: ENTE, category: 'regional', subcategory: 'A', isAuthorized: true, status: 'active' };
    const eqPre = { role: 'individual', clubId: ENTE, category: 'prebenjamin', subcategory: 'A', isAuthorized: true, status: 'active' };
    const resto = { role: 'individual', clubId: ENTE, category: null, subcategory: null, isAuthorized: true, status: 'active' };
    const famPend = { role: 'parent', clubId: ENTE, individualEntityId: ENTE, category: null, subcategory: null,
                      isAuthorized: false, status: 'pending_individual', requestedModality: 'f11' };
    // Su cuenta ANTES de las tres escrituras: administrador activo + la plaza
    // de familiar recién pedida.
    const ADMIN = () => ({ role: 'individual', clubId: ENTE, individualEntityId: ENTE,
                           isAuthorized: true, status: 'active',
                           allRoles: [eqReg, eqPre, resto, Object.assign({}, famPend)] });
    const REQ = { type: 'ind_sub_registration', status: 'pending_individual', individualOwnerId: ENTE,
                  userUid: UID, requestedRole: 'parent', requestedModality: 'f11' };
    const equipos = A.equiposDelEnte([eqReg, eqPre, resto], ENTE);

    // ── A qué equipo va ──
    ok('1b · los equipos del ente son DOS (el resto sin categoría no es equipo)',
       equipos.length === 2, equipos.map(e => e.category + ' ' + e.subcategory));
    const e1 = A.equipo(REQ, famPend, equipos);
    ok('1c · 🔑 pidió Fútbol 11 → Regional A, sin preguntar', e1.category === 'regional' && e1.subcategory === 'A' && e1.via === 'modalidad', e1);
    const e2 = A.equipo(Object.assign({}, REQ, { requestedModality: null }), Object.assign({}, famPend, { requestedModality: null }), equipos);
    ok('1d · 🔑 sin modalidad y dos equipos → lo ELIGE el administrador (no se adivina)',
       Array.isArray(e2.elegir) && e2.elegir.length === 2, e2);
    const e3 = A.equipo(Object.assign({}, REQ, { requestedModality: null }), null, [equipos[1]]);
    ok('1e · un solo equipo en el ente → ése', e3.category === 'prebenjamin' && e3.via === 'unico', e3);
    ok('1f · sin ningún equipo → { ninguno } (no se reenvía sin equipo)', !!A.equipo(REQ, null, []).ninguno);
    const e4 = A.equipo(Object.assign({}, REQ, { requestedCategory: 'alevin', requestedSubcategory: 'C' }), null, equipos);
    ok('1g · una categoría que el ente NO tiene no se cuela: cae a la modalidad',
       e4.category === 'regional' && e4.via === 'modalidad', e4);
    const e5 = A.equipo(Object.assign({}, REQ, { requestedCategory: 'prebenjamin_a' }), null, equipos);
    ok('1h · la categoría que ya trae, si es de un equipo del ente, manda (forma combinada incluida)',
       e5.category === 'prebenjamin' && e5.subcategory === 'A' && e5.via === 'solicitud', e5);

    // ── Retirar (✕ del ente / Rechazar del SA) ──
    ok('1i · 🔴🔴 borrar un DUPLICADO no toca al usuario', A.retirar(ADMIN(), REQ, true, 'yo', 'T') === null);
    const r1 = A.retirar(ADMIN(), REQ, false, 'yo', 'T') || {};
    ok('1j · 🔴🔴 rechazar su alta de familiar NO rechaza la cuenta del administrador',
       !('status' in r1) && !('isAuthorized' in r1) && !('role' in r1), r1);
    ok('1k · … se retira sólo la plaza pendiente de familiar',
       Array.isArray(r1.allRoles) && r1.allRoles.length === 3 && !r1.allRoles.some(r => r.role === 'parent'), r1.allRoles);
    const fresca = { role: 'parent', clubId: ENTE, isAuthorized: false, status: 'pending_individual', allRoles: [Object.assign({}, famPend)] };
    const r2 = A.retirar(fresca, REQ, false, 'yo', 'T') || {};
    ok('1l · un alta NUEVA sin otra plaza sí se rechaza entera (lo de siempre)',
       r2.status === 'rejected' && r2.isAuthorized === false && r2.allRoles.length === 0, r2);
    const yaViva = ADMIN(); yaViva.allRoles[3] = Object.assign({}, famPend, { isAuthorized: true, status: 'active', category: 'regional', subcategory: 'A' });
    ok('1m · una solicitud vieja de una plaza YA aprobada no la tumba', A.retirar(yaViva, REQ, false, 'yo', 'T') === null);

    // ── Reenviar ──
    const f1 = A.reenviar(ADMIN(), Object.assign({}, REQ, { requestedCategory: 'regional', requestedSubcategory: 'A' }), e1);
    ok('1n · 🔴 reenviar su alta NO pone la cuenta del administrador en pending_sa', !('status' in f1), f1);
    const pf = (f1.allRoles || []).filter(r => r.role === 'parent')[0] || {};
    ok('1o · la plaza de familiar va a Regional A y pasa a pending_sa',
       pf.category === 'regional' && pf.subcategory === 'A' && pf.status === 'pending_sa', pf);
    const restoTras = (f1.allRoles || []).filter(r => r.role === 'individual' && !r.category);
    ok('1p · 🔴 el equipo NO se le pega a sus plazas de administrador sin categoría (v685 lo hacía)',
       restoTras.length === 1, restoTras);
    const f2 = A.reenviar(fresca, REQ, e1);
    ok('1q · un alta nueva sí pasa su raíz a pending_sa', f2.status === 'pending_sa', f2);

    // ── Aprobar ──
    const ap = A.aprobar(ADMIN(), Object.assign({}, REQ, { requestedCategory: 'regional', requestedSubcategory: 'A' }), 'sa@x', 'T');
    ok('1r · 🔴🔴 aprobar su alta de familiar NO le cambia el rol de la raíz (era role:\'parent\')',
       !('role' in ap) && !('category' in ap), ap);
    const pa = (ap.allRoles || []).filter(r => r.role === 'parent')[0] || {};
    ok('1s · 🔑 la PLAZA de familiar queda activa y EN SU EQUIPO (no "Sin categoría")',
       pa.isAuthorized === true && pa.status === 'active' && pa.category === 'regional' && pa.subcategory === 'A', pa);
    ok('1t · sus dos equipos de administrador siguen intactos',
       (ap.allRoles || []).filter(r => r.role === 'individual' && r.status === 'active' && r.category).length === 2);
    const perdida = ADMIN(); perdida.status = 'rejected'; perdida.isAuthorized = false;
    const ap2 = A.aprobar(perdida, Object.assign({}, REQ, { requestedCategory: 'regional', requestedSubcategory: 'A' }), 'sa@x', 'T');
    ok('1u · si había perdido el acceso, el SA se lo devuelve — sin tocarle el rol',
       ap2.status === 'active' && ap2.isAuthorized === true && !('role' in ap2), ap2);
    const bloq = ADMIN(); bloq.status = 'blocked'; bloq.isAuthorized = false;
    const ap3 = A.aprobar(bloq, Object.assign({}, REQ, { requestedCategory: 'regional', requestedSubcategory: 'A' }), 'sa@x', 'T');
    ok('1v · …pero a una cuenta BLOQUEADA no la desbloquea un alta', !('status' in ap3), ap3);
    const ap4 = A.aprobar(fresca, Object.assign({}, REQ, { requestedCategory: 'regional', requestedSubcategory: 'A' }), 'sa@x', 'T');
    ok('1w · un alta nueva: la raíz es la de esta plaza (rol, equipo, activa)',
       ap4.role === 'parent' && ap4.category === 'regional' && ap4.subcategory === 'A' && ap4.status === 'active', ap4);
    const dup = { role: 'parent', clubId: ENTE, isAuthorized: false, status: 'pending_individual',
                  allRoles: [Object.assign({}, famPend), Object.assign({}, famPend)] };
    const ap5 = A.aprobar(dup, Object.assign({}, REQ, { requestedCategory: 'regional', requestedSubcategory: 'A' }), 'sa@x', 'T');
    ok('1x · dos plazas pendientes duplicadas → UNA, en su equipo',
       (ap5.allRoles || []).length === 1 && ap5.allRoles[0].category === 'regional', ap5.allRoles);

    // ── Duplicados de solicitud ──
    ok('1y · mismaSolicitud: misma persona, rol y ente, pendiente → sí',
       A.mismaSolicitud(REQ, Object.assign({}, REQ, { status: 'pending_sa' })));
    ok('1z · …ya aprobada, de otro rol o de otro ente → no',
       !A.mismaSolicitud(REQ, Object.assign({}, REQ, { status: 'sa_approved' })) &&
       !A.mismaSolicitud(REQ, Object.assign({}, REQ, { requestedRole: 'user' })) &&
       !A.mismaSolicitud(REQ, Object.assign({}, REQ, { individualOwnerId: 'otro' })));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · las cuatro pantallas pasan por cronosAltaEnte ──');
// ───────────────────────────────────────────────────────────────────────────
const cuerpo = (src, cab, sig) => { const i = src.indexOf(cab); const j = src.indexOf(sig, i + cab.length); return i < 0 ? '' : src.slice(i, j < 0 ? undefined : j); };
const REJ = cuerpo(PANEL, 'window.indRejectRequest = async function', 'window.indConfirmAccess');
const FWD = cuerpo(PANEL, 'window.indForwardToSA = async function', 'window.indRejectRequest');
ok('2a · el ✕ del ente llama a cronosAltaEnte.retirar', /A\.retirar\(/.test(REJ));
ok('2b · 🔴 y ya no escribe { status: \'rejected\', isAuthorized: false } a mano en la raíz',
   !/status:\s*'rejected',\s*isAuthorized:\s*false/.test(REJ));
ok('2c · el reenvío llama a cronosAltaEnte.equipo y .reenviar', /A\.equipo\(/.test(FWD) && /A\.reenviar\(/.test(FWD));
ok('2d · 🔴 el reenvío ya no pone la raíz del usuario en pending_sa a mano',
   !/_userUpdateData\s*=\s*\{\s*status:\s*'pending_sa'/.test(FWD));
ok('2e · el reenvío resuelve el equipo ANTES de confirmar',
   FWD.indexOf('A.equipo(') > 0 && FWD.indexOf('A.equipo(') < FWD.indexOf('confirm('));
const APR = cuerpo(EXTRAS, "r.type === 'ind_sub_registration' && r.userUid", '} else if (role === \'individual\'');
ok('2f · la aprobación del SA de un alta del ente llama a cronosAltaEnte.aprobar', /cronosAltaEnte\.aprobar\(/.test(APR));
ok('2g · 🔴 y ya no escribe role: r.requestedRole en la raíz', !/role:\s*r\.requestedRole/.test(APR));
ok('2h · …y cierra los duplicados vivos de esa plaza', /mismaSolicitud\(/.test(APR) && /'duplicate'/.test(APR));
ok('2i · 🔴 el Rechazar genérico del SA ya no escribe status:\'rejected\' en la raíz a ciegas',
   !/updateDoc\(doc\(db, 'users', r\.userUid\), \{ status: 'rejected' \}\)/.test(EXTRAS) && /cronosAltaEnte\.retirar\(/.test(EXTRAS));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el alta que DE VERDAD se ejecuta guarda el equipo ──');
// ───────────────────────────────────────────────────────────────────────────
// ⚠️ El final se ata a una línea de CÓDIGO: `sinCom` borra los comentarios, y
//    un marcador que fuera comentario no aparecería y el corte llegaría hasta
//    el final del fichero — donde SÍ hay `requestedModality` (los caminos que
//    no se ejecutan). Así es como 3b y 3d salían verdes contra el código viejo.
const ALTA = cuerpo(AUTH, 'if (_isUnderIndiv && cred) {', "console.error('[isUnderIndiv]'");
ok('3a · se localiza el bloque del alta bajo un ente (y SÓLO ese bloque)',
   ALTA.length > 2000 && ALTA.length < 20000 && ALTA.indexOf("'ind_sub_registration'") > 0, ALTA.length);
ok('3b · 🔑 ese bloque LEE el equipo elegido (selectedIndTeam)', /selectedIndTeam/.test(ALTA));
const PR = cuerpo(ALTA, "_m.doc(fa.db, 'platform_requests', _prId)", '});');
ok('3c · 🔑 la solicitud que crea lleva requestedModality', /requestedModality:/.test(PR), PR.slice(0, 200));
ok('3d · la plaza que crea lleva requestedModality', /_newIndivRole\s*=\s*\{[\s\S]*?requestedModality:/.test(ALTA));
ok('3e · 🔴 no crea otra solicitud si ya hay una viva de esa plaza', /if\s*\(\s*!_solicitudViva\s*\)/.test(ALTA));
ok('3f · a quien ya es de ese ente con ese rol, no le deja pedirlo otra vez',
   /_previa\.isAuthorized === true && _previa\.status === 'active'/.test(ALTA));
ok('3g · el login distingue RECHAZADA de pendiente', /data\.status === 'rejected'/.test(AUTH));

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '  ❌ ' + fallos + ' FALLOS' : '  ✅'));
process.exit(fallos ? 1 : 0);
