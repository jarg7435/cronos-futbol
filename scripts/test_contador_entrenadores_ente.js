// ═══════════════════════════════════════════════════════════════════════════
//  test_contador_entrenadores_ente.js
//  v684 · "0 ENTRENADORES" CON EL ENTRENADOR LISTADO DEBAJO — GUARD
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt + capturas 10226-10227, v683):
//
//    "En Mi Equipo la tarjeta superior marca 0 Entrenadores, mientras que
//     justo abajo, en el equipo Regional A, se indica ENTRENADOR 1 con mi
//     usuario (Entrenador Administrador — tú)."
//
//  🔑🔑 NO ERA UN CERO DE MÁS: ERAN DOS REGLAS DE "QUIÉN ENTRENA AQUÍ".
//  El cuadro de cifras preguntaba `_tieneAqui(u, ['user','entrenador_individual'])`
//  sobre `parents` —lo que devuelve Firestore—; las fichas de equipo preguntan
//  `_IND_COACH`, que desde la v602 SÍ incluye 'individual'/'admin_individual'
//  porque el Entrenador Administrador ES el entrenador de sus equipos (la
//  unificación de la v599). El contador se quedó con el modelo VIEJO —el
//  administrador gestiona, no entrena— y nadie lo movió con la unificación.
//
//  🚨 Y había un SEGUNDO defecto debajo del primero: el dueño puede no estar
//  en `parents` (por eso existe `_yoComoFila`). Ni añadiendo su rol a la lista
//  de nombres habría contado siempre. Por eso la corrección NO es ampliar la
//  lista: es contar sobre LAS MISMAS FILAS que se pintan.
//
//  ⚠️ ESTE GUARD EJECUTA EL CÓDIGO DEL FICHERO, no una copia escrita aquí
//  (la lección de v620: un test que prueba su propia copia de la lógica da
//  verde con el producto roto). Se extraen los trozos reales de panel.js
//  —`_IND_COACH`, `_esFilaEntrenador`, `_filasDeEquipo` y el bloque de
//  recuento— y se corren con escenarios de datos.
//
//  🔴 RED-CHECK (2026-09-10), en dos pasos y los dos MEDIDOS:
//   1. Este guard contra `git show HEAD:js/admin/individual/panel.js` → PARTE 0
//      en rojo: el bloque `_filasDelPanel` no existía.
//   2. Y la regla VIEJA extraída de ese mismo fichero y ejecutada con el caso
//      del autor (dueño con rol 'individual' anclado a su ente, entrenando
//      Regional A) devolvía `{coachCount: 0}` — la captura 10227 exacta. Y
//      devolvía 0 TAMBIÉN con el dueño presente en `parents`, que es la prueba
//      de que eran DOS defectos y no uno: la lista de nombres estaba corta.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
// ⚠️ El fichero se puede pasar por argumento para poder correr este mismo
//    guard contra una versión ANTERIOR (el red-check). Por defecto, el vivo.
const RUTA = process.argv[2] || path.join(ROOT, 'js/admin/individual/panel.js');
const IND  = fs.readFileSync(RUTA, 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
function trozo(src, cab, cierre) {
    const i = src.indexOf(cab);      if (i < 0) throw new Error('No se encontró: ' + cab);
    const j = src.indexOf(cierre, i); if (j < 0) throw new Error('Sin cierre de: ' + cab);
    return src.slice(i, j + cierre.length);
}
// Un comentario `//` con acentos no molesta, pero un bloque `/* */` partido sí.
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
                       .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 0 · las piezas REALES del fichero se pueden extraer ──');
// ───────────────────────────────────────────────────────────────────────────
let calcular = null;
try {
    const T_SETS = trozo(IND, "const _IND_COACH = new Set(",
                              "const _IND_DUENO = new Set(['individual', 'admin_individual']);");
    const T_ESFILA = trozo(IND, 'const _esFilaEntrenador = (f) =>', ');');
    const T_EQUIPO = trozo(IND, 'const _filasDeEquipo = (eq) => {', 'return filas;') + '\n    };';
    const T_CUENTA = trozo(IND, 'const _filasDelPanel = _misEquiposNorm',
                                'const parentCount = _plazasQueCuentan(f => _IND_PARENT.has(_rolDeFila(f)));');

    const fuente =
        '(function (uid, _misEquiposNorm, _filasHuerfanas, _filasIndice, _yoComoFila) {\n' +
        sinCom(T_SETS)   + '\n' +
        sinCom(T_ESFILA) + '\n' +
        sinCom(T_EQUIPO) + '\n' +
        sinCom(T_CUENTA) + '\n' +
        'return { coachCount: coachCount, parentCount: parentCount, filas: _filasDelPanel };\n})';

    calcular = vm.runInNewContext(fuente, { Set, Map, Array, Object, String, console });
    ok('0a · 🔑 el recuento se deriva de las FILAS del panel (`_filasDelPanel`)', true);
} catch (e) {
    ok('0a · 🔑 el recuento se deriva de las FILAS del panel (`_filasDelPanel`)', false, e.message);
}
if (!calcular) {
    console.log('\n🔴 Sin las piezas no hay nada que medir. ' + fallos + '/' + total + ' fallos.');
    process.exit(1);
}

// ── Andamio: lo que el panel tiene alrededor del recuento ──────────────────
const YO = 'uid_jose';
const REGIONAL_A = { catId: 'regional', sub: 'A', mod: 'f11', label: 'Regional A' };
const PREBEN_A   = { catId: 'prebenjamin', sub: 'A', mod: 'f7', label: 'Prebenjamín A' };

// `_yoComoFila` real es un literal con los datos del dueño; aquí basta su forma.
const yoComoFila = (plaza) => ({ _id: YO, uid: YO, email: 'jose_arg027@hotmail.com',
                                 status: 'active', isAuthorized: true, _activeRoleData: plaza });
// `_filasIndice(catId, sub)` devuelve lo que el índice tiene en esa casilla.
const indiceDe = (mapa) => (catId, sub) => (mapa[catId + '|' + sub] || []).slice();

const fila = (id, role, extra) => Object.assign(
    { _id: id, uid: id, email: id + '@x.com', status: 'active', isAuthorized: true,
      _activeRoleData: Object.assign({ role, isAuthorized: true, status: 'active' }, extra || {}) },
    {});

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · LA CAPTURA 10227: un equipo, y el dueño es su entrenador ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // El caso exacto del autor: Regional A, sin nadie más. Su fila NO está en
    // el índice (no vino en `parents`), la inyecta `_filasDeEquipo`.
    const r = calcular(YO, [REGIONAL_A], [], indiceDe({}), yoComoFila);
    ok('1a · 🔑🔑 la tarjeta ⚽ Entrenadores marca 1, no 0', r.coachCount === 1, r.coachCount);
    ok('1b · y coincide con el ENTRENADOR 1 de la ficha de Regional A',
       r.filas.filter(f => (f._id || f.uid) === YO).length === 1);
    ok('1c · 👨‍👩‍👧 Familiares / Jugadores sigue en 0 (no hay familias)',
       r.parentCount === 0, r.parentCount);
}
{
    // La otra mitad del mismo caso: el dueño SÍ vino en `parents` y está en el
    // índice. No puede contar dos veces ni dejar de contar.
    const enIndice = { 'regional|A': [ fila(YO, 'individual', { category: 'regional', subcategory: 'A' }) ] };
    const r = calcular(YO, [REGIONAL_A], [], indiceDe(enIndice), yoComoFila);
    ok('1d · ⚠️ y si el dueño SÍ estaba en `parents`, sigue siendo 1 (no 2)',
       r.coachCount === 1, r.coachCount);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · PLAZAS, no personas: dos equipos son 2 (v685) ──');
// ───────────────────────────────────────────────────────────────────────────
//  ⚠️ ESTA PARTE DECÍA LO CONTRARIO EN LA v684, y el cambio es del AUTOR, no
//  una corrección de un fallo. La v684 deduplicaba por persona y ponía 1; él
//  pidió dos veces la suma ("la suma real de entrenadores de sus equipos", y
//  luego "el total de entrenadores/equipos activos (en este caso, 2)"). El
//  motivo es bueno: la tarjeta se lee CONTRA el badge del tablero, que cuenta
//  equipos, y un 2 arriba con un 1 debajo es la incoherencia que se ve.
{
    const r = calcular(YO, [REGIONAL_A, PREBEN_A], [], indiceDe({}), yoComoFila);
    ok('2a · 🔑🔑 lleva F7 y F11: la tarjeta dice 2, como el badge del tablero',
       r.coachCount === 2, r.coachCount);
    ok('2b · y las dos fichas tienen su fila (una cada una)',
       r.filas.filter(f => (f._id || f.uid) === YO).length === 2);
}
{
    // ⚠️ Pero la MISMA plaza repetida no se cuenta dos veces: la clave de
    //    deduplicación es persona+equipo, no la posición en la lista.
    const enIndice = { 'regional|A': [ fila(YO, 'individual', { category: 'regional', subcategory: 'A' }) ] };
    const r = calcular(YO, [REGIONAL_A], [], indiceDe(enIndice), yoComoFila);
    ok('2c · ⚠️ la misma plaza dos veces sigue contando una', r.coachCount === 1, r.coachCount);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · la suma REAL de entrenadores de sus equipos ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const mapa = {
        'regional|A': [ fila('uid_ana', 'user', { category: 'regional', subcategory: 'A' }) ],
        'prebenjamin|A': [ fila('uid_luis', 'entrenador_individual', { category: 'prebenjamin', subcategory: 'A' }) ],
    };
    const r = calcular(YO, [REGIONAL_A, PREBEN_A], [], indiceDe(mapa), yoComoFila);
    // El dueño pone 2 plazas (una por equipo) y Ana y Luis una cada uno.
    ok('3a · dueño (2 equipos) + un entrenador en cada equipo = 4 plazas',
       r.coachCount === 4, r.coachCount);
}
{
    // ⏳ Pendientes: tienen su propia tarjeta. Contarlos aquí los contaría dos
    //    veces y borraría la diferencia entre "está" y "lo he pedido".
    const mapa = { 'regional|A': [
        fila('uid_pend', 'user', { category: 'regional', subcategory: 'A',
                                   isAuthorized: false, status: 'pending_individual' }) ] };
    const r = calcular(YO, [REGIONAL_A], [], indiceDe(mapa), yoComoFila);
    ok('3b · ⚠️ un entrenador PENDIENTE no suma en ⚽ Entrenadores',
       r.coachCount === 1, r.coachCount);
}
{
    const mapa = { 'regional|A': [
        fila('uid_ex', 'user', { category: 'regional', subcategory: 'A', status: 'blocked' }) ] };
    const r = calcular(YO, [REGIONAL_A], [], indiceDe(mapa), yoComoFila);
    ok('3c · ni uno bloqueado (tiene su tarjeta 🔒)', r.coachCount === 1, r.coachCount);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · las familias, y los que están en "Otros usuarios del ente" ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const mapa = { 'regional|A': [
        fila('uid_p1', 'parent',            { category: 'regional', subcategory: 'A' }),
        fila('uid_p2', 'parent_individual', { category: 'regional', subcategory: 'A' }) ] };
    const r = calcular(YO, [REGIONAL_A], [], indiceDe(mapa), yoComoFila);
    ok('4a · dos familias en la ficha = 2 arriba', r.parentCount === 2, r.parentCount);
    ok('4b · y no se cuelan como entrenadores', r.coachCount === 1, r.coachCount);
}
{
    // ⚠️⚠️ NADIE PUEDE DESAPARECER (la doctrina de v602). Quien no cae en
    //    ninguno de sus equipos se pinta en "Otros usuarios del ente" — y si
    //    se pinta, se cuenta.
    const huerfanas = [ fila('uid_p3', 'parent', { category: 'cadete', subcategory: 'B' }) ];
    const r = calcular(YO, [REGIONAL_A], huerfanas, indiceDe({}), yoComoFila);
    ok('4c · 🔑 un familiar de "Otros usuarios del ente" TAMBIÉN suma',
       r.parentCount === 1, r.parentCount);
}
{
    // La misma persona con un hijo en cada equipo: son DOS vínculos, y cada
    // ficha la enseña. Misma regla que los entrenadores (v685).
    const mapa = {
        'regional|A':    [ fila('uid_p1', 'parent', { category: 'regional', subcategory: 'A' }) ],
        'prebenjamin|A': [ fila('uid_p1', 'parent', { category: 'prebenjamin', subcategory: 'A' }) ],
    };
    const r = calcular(YO, [REGIONAL_A, PREBEN_A], [], indiceDe(mapa), yoComoFila);
    ok('4d · ⚠️ un familiar con hijos en los DOS equipos cuenta una plaza por equipo',
       r.parentCount === 2, r.parentCount);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · censo: la regla vieja no puede volver ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const LIMPIO = sinCom(IND);
    ok('5a · 🔑🔑 `_IND_COACH` sigue incluyendo al Entrenador Administrador',
       /_IND_COACH\s*=\s*new Set\(\[[^\]]*'individual'[^\]]*'admin_individual'[^\]]*\]\)/.test(LIMPIO));
    ok('5b · 🚨 no revive un `_tieneAqui` que contaba por su cuenta',
       !/_tieneAqui\s*\(/.test(LIMPIO));
    ok('5c · 🚨 ni `activeParents`, que miraba `parents` en vez de las filas',
       !/activeParents/.test(LIMPIO));
    ok('5d · el cuadro de cifras se pinta con `coachCount`/`parentCount`',
       /\$\{coachCount\}/.test(LIMPIO) && /\$\{parentCount\}/.test(LIMPIO));
    ok('5e · ⚠️ y la ficha de equipo lee la MISMA lista (`_filasDeEquipo`)',
       /const filas = _filasDeEquipo\(eq\);/.test(LIMPIO));
    ok('5f · el badge de la tarjeta "Mi Equipo" sigue siendo el nº de EQUIPOS',
       /badge:\s*_misEquipos\.length/.test(LIMPIO));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 6 · v685 · el equipo nuevo PASA POR EL SUPERADMIN ──');
// ───────────────────────────────────────────────────────────────────────────
//  Encargo del autor (2026-09-10, punto 4), variante estricta elegida por él:
//  el equipo se guarda PENDIENTE y no se puede usar hasta que lo aprueben.
{
    const LIMPIO = sinCom(IND);
    const REQS   = sinCom(fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/requests-tab.js'), 'utf8'));
    const UTILS  = sinCom(fs.readFileSync(path.join(ROOT, 'js/core/utils.js'), 'utf8'));

    ok('6a · 🔑🔑 la plaza nueva NACE PENDIENTE, no activa',
       /isAuthorized:\s*false,\s*status:\s*IND_EQUIPO_PENDIENTE/.test(LIMPIO));
    ok('6b · 🚨 y ya NO se autoconcede (`isAuthorized: true, status: \'active\'`)',
       !/isAuthorized:\s*true,\s*\n?\s*status:\s*'active',\s*\n?\s*firstName/.test(LIMPIO));
    ok('6c · 📤 se crea la solicitud en `platform_requests` con tipo propio',
       /type:\s*'ind_team_request'/.test(LIMPIO) && /status:\s*'pending_sa'/.test(LIMPIO));
    ok('6d · 🔐 a SU nombre (`userUid`), que es la rama que permiten las reglas (v636)',
       /userUid:\s*uid/.test(LIMPIO));
    ok('6e · ⚠️ con id determinista: dos clics no dejan dos solicitudes iguales',
       /const reqId = 'ind_team_' \+ uid/.test(LIMPIO));
    ok('6f · ⚠️⚠️ la SOLICITUD se escribe ANTES que la plaza (si falla, se arregla al aprobar)',
       LIMPIO.indexOf("type:          'ind_team_request'") <
       LIMPIO.indexOf('allRoles: (userData.allRoles || []).concat([nueva])'));

    ok('6g · 🔑🔑 mientras espera NO se puede usar: la lista única del proyecto exige activa',
       /r\.isAuthorized !== true \|\| r\.status !== 'active'/.test(UTILS));
    ok('6h · ⚠️ y OCUPA plaza: el candado de los dos equipos cuenta los pendientes',
       /_equiposOcupados = _misEquipos\.concat\(_misEquiposPend\)/.test(LIMPIO) &&
       /_puedeAnadir\s*=\s*_equiposOcupados\.length < 2/.test(LIMPIO));

    ok('6i · ✅ el SuperAdmin tiene rama para aprobarlo',
       /r\.type === 'ind_team_request' && r\.userUid/.test(REQS));
    ok('6j · 🔑🔑 y casa la plaza por CATEGORÍA, no por rol (la lección de v552)',
       /_mismaCat\s*=\s*\(rol\)/.test(REQS) && /c === _catPide && s === _subPide/.test(REQS));
    ok('6k · 🚨🚨 RECHAZAR retira la plaza (si no, bloquea su hueco para siempre)',
       /status:'removed', isAuthorized:false/.test(REQS));
    ok('6l · ⚽ y la tarjeta del SuperAdmin dice QUÉ equipo se pide',
       /Equipo solicitado/.test(REQS));
}

console.log('\n' + (fallos === 0 ? '✅' : '❌') + '  ' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos === 0 ? 0 : 1);
