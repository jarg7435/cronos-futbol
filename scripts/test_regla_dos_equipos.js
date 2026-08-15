// ═══════════════════════════════════════════════════════════════════════════
//  UN ENTRENADOR: DOS EQUIPOS COMO MUCHO, UNO F7 Y OTRO F11 — v537
// ═══════════════════════════════════════════════════════════════════════════
//  Regla de negocio del autor (2026-08-15): en un MISMO club, un entrenador
//  puede llevar como máximo dos equipos y obligatoriamente uno de Fútbol 7 y
//  otro de Fútbol 11. Dos de F7 o dos de F11 están PROHIBIDOS.
//
//  ⚠️ NO ESTABA IMPLEMENTADA. Censado el código antes de escribir: ni una sola
//  comprobación en registro, aprobación o cambio de equipo. Y medido por REST,
//  en producción existe el caso: **brunoromar2012 con `juvenil B` y `cadete C`,
//  ambos F11 en el mismo club** (hoy revocados, pero nada lo impidió al crearse).
//
//  🔑 La modalidad se DERIVA de la categoría con `_cronosMatchModality`, la
//  forma canónica del proyecto. No se añade ningún campo nuevo: una segunda
//  fuente de verdad sobre la modalidad sería el próximo fallo.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}
const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '')
                     .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// Se carga utils.js de verdad para usar el validador REAL.
const sb = { console: { log() {}, warn() {}, error() {} }, document: { getElementById: () => null },
             localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
             navigator: {}, setTimeout: () => {} };
sb.window = sb;
vm.createContext(sb);
try { vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8'), sb); }
catch (e) { console.log('  (aviso al cargar utils.js: ' + e.message + ')'); }
const puede = sb.window.cronosPuedeLlevarEquipo;
const CLUB = 'club_mqvr9m11_g9kj';
const rol = (category, extra) => Object.assign({ role: 'user', clubId: CLUB, category: category,
                                                 isAuthorized: true, status: 'active' }, extra || {});

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · la regla, con las categorías reales ──');
// ───────────────────────────────────────────────────────────────────────────
ok('1a · el validador existe', typeof puede === 'function');
ok('1b · y la modalidad se deriva de la categoría',
   typeof sb.window._cronosMatchModality === 'function' &&
   sb.window._cronosMatchModality('prebenjamin') === 'f7' &&
   sb.window._cronosMatchModality('cadete') === 'f11');

if (typeof puede === 'function') {
    // 🔑 EL CASO QUE ÉL REPORTÓ: Prebenjamín + Benjamín, los dos F7.
    ok('1c · 🔑🔑🔑 Prebenjamín + Benjamín (los dos F7) se RECHAZA',
       puede([rol('prebenjamin')], 'benjamin', CLUB).ok === false,
       JSON.stringify(puede([rol('prebenjamin')], 'benjamin', CLUB)));
    // 🔑 Y el que ya existe en producción: Juvenil + Cadete, los dos F11.
    ok('1d · 🔑🔑 Juvenil + Cadete (los dos F11) se RECHAZA',
       puede([rol('juvenil')], 'cadete', CLUB).ok === false);
    ok('1e · ✅ un F7 y un F11 SÍ se permite',
       puede([rol('prebenjamin')], 'cadete', CLUB).ok === true);
    ok('1f · ✅ y al revés también', puede([rol('infantil')], 'alevin', CLUB).ok === true);
    ok('1g · el primer equipo siempre entra', puede([], 'benjamin', CLUB).ok === true);
    ok('1h · un TERCER equipo se rechaza aunque las modalidades cuadraran',
       puede([rol('alevin'), rol('cadete')], 'infantil', CLUB).ok === false);

    // ⚠️⚠️ v538 · FUTureFEM PASÓ A F11. Hasta v537 esta aserción fijaba lo
    // CONTRARIO ("cuenta como F7") y era la clasificación equivocada: sus
    // futbolistas tienen de 12 a 15 años y por normativa juegan Fútbol 11.
    // Se REFINÓ, no se borró: lo que protege —que una categoría nueva no se
    // quede sin clasificar— sigue vigente, con el valor correcto.
    ok('1i · 🔑🔑🔑 FUTureFEM cuenta como F11 (12-15 años), no como F7',
       sb.window._cronosMatchModality('futurefem') === 'f11',
       String(sb.window._cronosMatchModality('futurefem')));
    ok('1i2 · y por tanto choca con Juvenil/Cadete, no con Alevín',
       puede([rol('futurefem')], 'cadete', CLUB).ok === false &&
       puede([rol('futurefem')], 'alevin', CLUB).ok === true,
       'cadete=' + JSON.stringify(puede([rol('futurefem')], 'cadete', CLUB).ok) +
       ' alevin=' + JSON.stringify(puede([rol('futurefem')], 'alevin', CLUB).ok));
    ok('1j · Regional FEM cuenta como F11',
       puede([rol('regional_fem')], 'juvenil', CLUB).ok === false &&
       puede([rol('regional_fem')], 'benjamin', CLUB).ok === true);

    console.log('\n── PARTE 2 · lo que NO debe estorbar ──');
    ok('2a · ⚠️ un rol REVOCADO libera su plaza',
       puede([rol('prebenjamin', { status: 'removed' })], 'benjamin', CLUB).ok === true);
    ok('2b · ⚠️ y uno no autorizado tampoco cuenta',
       puede([rol('prebenjamin', { isAuthorized: false })], 'benjamin', CLUB).ok === true);
    ok('2c · 🔑 la regla es POR CLUB: en otro club no estorba',
       puede([rol('prebenjamin', { clubId: 'otro_club' })], 'benjamin', CLUB).ok === true);
    ok('2d · coordinador, director y padre no ocupan equipo',
       puede([rol('prebenjamin', { role: 'coordinator' }), rol('benjamin', { role: 'parent' }),
              rol('alevin', { role: 'director' })], 'benjamin', CLUB).ok === true);
    ok('2e · ⚠️ al MOVER de equipo su plaza actual se libera (si no, chocaría consigo mismo)',
       puede([rol('prebenjamin')], 'benjamin', CLUB, { excluyeCategoria: 'prebenjamin' }).ok === true);
    ok('2f · una categoría que no se sabe clasificar NO bloquea el alta',
       puede([rol('prebenjamin')], 'categoria_rara_xyz', CLUB).ok === true);
    ok('2g · no revienta con datos ausentes',
       puede(null, 'benjamin', CLUB).ok === true && puede([], null, CLUB).ok === true);
    ok('2h · el motivo explica qué modalidad falta',
       /F[úu]tbol 11/.test(puede([rol('prebenjamin')], 'benjamin', CLUB).motivo),
       puede([rol('prebenjamin')], 'benjamin', CLUB).motivo);
}

// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2b · FUTureFEM: F11 en TODOS los clasificadores ──');
// ───────────────────────────────────────────────────────────────────────────
// 🔑 Había CUATRO sitios clasificando modalidad. Cambiar sólo uno habría
// dejado la app diciendo dos cosas distintas según la pantalla.
{
    const UT = sinCom(fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8'));
    const CP = sinCom(fs.readFileSync(path.join(RAIZ, 'js/coach/comms/panel.js'), 'utf8'));
    const SM = sinCom(fs.readFileSync(path.join(RAIZ, 'js/core/setup-modal.js'), 'utf8'));

    ok('2b1 · `_cronosMatchModality` ya no lo mete en la lista F7',
       !/prebenjamin\|benjamin\|alevin\|prebenj\|chupete\|querubin\|futurefem\)\/\.test\(norm\)\) return 'f7'/.test(UT),
       'una de las dos copias de utils.js seguiría diciendo F7');
    ok('2b2 · y sí en la F11 (las DOS copias del bloque duplicado)',
       (UT.match(/aficionado\|futurefem\)/g) || []).length === 2,
       'utils.js tiene el bloque duplicado: hay que cambiar los dos');
    ok('2b3 · el clasificador de informes también lo da como F11',
       /'amateur', 'futurefem'\]\.includes\(c\)\) return 'f11'/.test(CP),
       'los informes seguirían agrupándolo como F7');
    ok('2b4 · al entrenador de FUTureFEM se le ofrece F11',
       /includes\('regional'\) \|\| rcat\.includes\('futurefem'\)\) hasF11/.test(SM) &&
       !/includes\('alevin'\) \|\| rcat\.includes\('futurefem'\)\) hasF7/.test(SM),
       'el modo del partido seguiría saliendo F7');
    // ⚠️ El GRUPO DEL SEMÁFORO se queda en 'f7' a propósito: depende de la
    // DURACIÓN (2T x 35' = 70'), no del número de jugadores. Moverlo cambiaría
    // los umbrales de partidos ya jugados. Se fija para que el día que se toque
    // sea una decisión, no un descuido.
    ok('2b5 · ⚠️ el grupo del SEMÁFORO sigue siendo f7 (depende de la duración, no de la modalidad)',
       /querubin\|futurefem\)\/\.test\(normCat\)\) \{/.test(UT),
       'si esto cambia, revisar umbrales y la config guardada del Director');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el candado está en los puntos de escritura ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const CLUBP = sinCom(fs.readFileSync(path.join(RAIZ, 'js/admin/club/panel.js'), 'utf8'));

    const iEdit = CLUBP.indexOf('window.caEditUserCategory');
    // ⚠️ Ventana holgada y comprobando que AMBOS anclas existen: con 1800
    // caracteres el `indexOf` del confirm daba -1 y la comparación de orden
    // salía roja con el código correcto. Tercera vez en el proyecto.
    const bloqueEdit = iEdit === -1 ? '' : CLUBP.slice(iEdit, iEdit + 3500);
    ok('3a · 🔑 al MOVER de equipo se valida',
       /cronosPuedeLlevarEquipo\(/.test(bloqueEdit),
       'un administrador podría poner dos F7 al mismo entrenador');
    ok('3a2 · y se comprueba ANTES de confirmar el movimiento',
       bloqueEdit.indexOf('cronosPuedeLlevarEquipo(') !== -1 &&
       bloqueEdit.indexOf('¿Confirmar el cambio de equipo?') !== -1 &&
       bloqueEdit.indexOf('cronosPuedeLlevarEquipo(') < bloqueEdit.indexOf('¿Confirmar el cambio de equipo?'),
       'rechazarlo después de que el admin acepte sería peor');

    const iApr = CLUBP.indexOf('window.caApproveRequest');
    const bloqueApr = iApr === -1 ? '' : CLUBP.slice(iApr, iApr + 1800);
    ok('3b · 🔑 al AUTORIZAR una solicitud también se valida',
       /cronosPuedeLlevarEquipo\(/.test(bloqueApr),
       'la combinación prohibida entraría por la puerta grande');
    ok('3b2 · sólo para el rol de entrenador',
       /role === 'user' && typeof window\.cronosPuedeLlevarEquipo/.test(bloqueApr),
       'bloquearía altas de coordinadores o padres sin motivo');
    ok('3b3 · y antes de pedir confirmación',
       bloqueApr.indexOf('cronosPuedeLlevarEquipo(') < bloqueApr.indexOf('¿Autorizar acceso a'));

    // ── v539 · Los dos huecos que quedaban ──────────────────────────────
    const AUTH = sinCom(fs.readFileSync(path.join(RAIZ, 'js/services/auth.js'), 'utf8'));
    // ⚠️ ANCLA DE CÓDIGO, NO DE COMENTARIO. La primera versión anclaba en
    // "AÑADIR ROL A CUENTA EXISTENTE", que es un comentario — y `sinCom` acababa
    // de borrarlo. Las tres aserciones salían rojas con el código correcto.
    const iAdd = AUTH.indexOf('const primarySnap = await fa.getDoc(');
    // Ventana lo bastante ancha para alcanzar la PRIMERA escritura: con 2600
    // caracteres no llegaba y la comparación de orden no medía nada.
    const bloqueAdd = iAdd === -1 ? '' : AUTH.slice(iAdd, iAdd + 9000);
    ok('3e · 🔑 el FORMULARIO valida al añadir un equipo a una cuenta existente',
       /cronosPuedeLlevarEquipo\(/.test(bloqueAdd),
       'se podría SOLICITAR una combinación prohibida');
    ok('3e2 · sólo para el rol de entrenador',
       /requestedRole === 'user' && primarySnap\.exists\(\)/.test(bloqueAdd));
    // 🔑 Antes de la PRIMERA escritura, sea el documento o la solicitud: si no,
    // quedaría medio alta que luego hay que limpiar a mano.
    ok('3e3 · ⚠️ y corta ANTES de escribir nada (ni documento ni solicitud)',
       bloqueAdd.indexOf('cronosPuedeLlevarEquipo(') !== -1 &&
       bloqueAdd.indexOf('setDoc') !== -1 &&
       bloqueAdd.indexOf('platform_requests') !== -1 &&
       bloqueAdd.indexOf('cronosPuedeLlevarEquipo(') < bloqueAdd.indexOf('setDoc') &&
       bloqueAdd.indexOf('cronosPuedeLlevarEquipo(') < bloqueAdd.indexOf('platform_requests'),
       'dejaría un alta a medias que hay que limpiar a mano');

    const EXTRAS = sinCom(fs.readFileSync(path.join(RAIZ, 'js/admin/superadmin/extras.js'), 'utf8'));
    const iAp = EXTRAS.indexOf('saExtApprove = async function');
    const bloqueAp = iAp === -1 ? '' : EXTRAS.slice(iAp, iAp + 4000);
    ok('3f · 🔑 el APROBAR del SuperAdmin también valida',
       /cronosPuedeLlevarEquipo\(/.test(bloqueAp),
       'el SA aprueba mucho desde ahí y era el hueco más grande');
    ok('3f2 · sólo al APROBAR y sólo para entrenadores',
       /approve && role === 'user'/.test(bloqueAp),
       'bloquearía rechazos o altas de otros roles');

    ok('3c · ⚠️ el validador vive en utils.js, junto a la modalidad canónica',
       /cronosPuedeLlevarEquipo/.test(sinCom(fs.readFileSync(path.join(RAIZ, 'js/core/utils.js'), 'utf8'))));
    // utils.js se carga antes que el panel de club: si no, no existiría al pulsar.
    const HTML = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
    ok('3d · 🔑 utils.js se carga antes que el panel de club',
       HTML.indexOf('js/core/utils.js') !== -1 &&
       HTML.indexOf('js/core/utils.js') < HTML.indexOf('js/admin/club/panel.js'),
       'el validador no existiría en el momento de pulsar');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ Un F7 y un F11: la combinación prohibida queda bloqueada');
