// ═══════════════════════════════════════════════════════════════════════════
//  test_plaza_del_ente_no_se_deduplica.js
//  v686 · EL ARRANQUE DE SESIÓN BORRABA EL SEGUNDO EQUIPO DEL ENTE — GUARD
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt + capturas 10240-10246):
//
//    "Cuando el SuperAdmin aprueba la solicitud de un segundo equipo, marca el
//     ente como activo pero no actualiza el array de roles/equipos. Al volver
//     al panel del Administrador Individual vuelve a mostrar un solo equipo."
//
//  🔑🔑 SU DIAGNÓSTICO SEÑALA AL SITIO EQUIVOCADO, y por eso importa medir. El
//  SuperAdmin SÍ escribía las dos plazas. **MEDIDO EN PRODUCCIÓN** el
//  2026-09-10 con `scripts/ops/inspect_roles_por_email.js`:
//
//      allRoles: 2 entradas
//        [0] rol=individual  cat=regional/A  club=individual_mt8l6zp8_whwd
//        [1] rol=individual  cat=null/null   club=null
//
//  La plaza de Prebenjamín A no estaba "sin actualizar": **había desaparecido**.
//
//  🔴🔴🔴 QUIEN LA BORRABA ERA SU PROPIO ARRANQUE DE SESIÓN. `auth.js`
//  deduplica `allRoles` y PERSISTE el resultado con `setDoc`. La clave de plaza
//  metía la categoría **sólo si el rol era 'user' o 'coach'**; para el
//  Entrenador Administrador Individual —que lleva sus equipos con
//  `role:'individual'` desde la unificación de v598/v599— la clave quedaba en
//  `rol|club`, sus dos equipos daban la MISMA, y el segundo se iba.
//
//  🔑 ES LA v554 OTRA VEZ, A MEDIO CERRAR. La v554 arregló exactamente esto
//  cuando los únicos que llevaban equipo eran 'user' y 'coach'. La v598 amplió
//  esa lista en `CRONOS_ROLES_CON_EQUIPO`… y estas tres claves se quedaron con
//  la lista vieja escrita a mano. Mismo patrón que la v684.
//
//  ⚠️ Y ES LA FAMILIA DE v477/v478 Y v554: *se guarda bien y el arranque lo
//  deshace*. Por eso el síntoma acusaba al aprobar, que era inocente.
//
//  🔴 RED-CHECK (2026-09-10): contra `git show HEAD:`, la PARTE 1 pone 2
//  equipos del ente y `cronosMismaPlaza` los declara la MISMA plaza (true),
//  y la PARTE 2 encuentra las claves con `['user','coach']` a mano.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT  = path.join(__dirname, '..');
const leer  = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
                       .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const UTILS  = leer('js/core/utils.js');
const AUTH   = sinCom(leer('js/services/auth.js'));
const EXTRAS = sinCom(leer('js/admin/superadmin/extras.js'));

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

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · `cronosMismaPlaza`, EJECUTADA con los datos reales ──');
// ───────────────────────────────────────────────────────────────────────────
const sb = { console: { log(){}, warn(){} }, String, Set, Array, Object };
sb.window = sb;
vm.createContext(sb);
// La lista única de quién ocupa equipo, tal cual la declara el fichero.
vm.runInContext(trozo(UTILS, 'if (!Array.isArray(window.CRONOS_ROLES_CON_EQUIPO))', '\n}'), sb);
// El slug de equipo, que es con lo que compara la regla.
try { vm.runInContext(trozo(UTILS, 'window.cronosTeamSlug = function', '\n    };'), sb); } catch (e) { /* opcional */ }
vm.runInContext(trozo(UTILS, 'if (typeof window.cronosMismaPlaza !== \'function\') {', '\n}'), sb);
const mismaPlaza = sb.window.cronosMismaPlaza;

const ENTE = 'individual_mt8l6zp8_whwd';           // el ente REAL del autor
const REGIONAL_A = { role:'individual', clubId:ENTE, category:'regional',    subcategory:'A' };
const PREBEN_A   = { role:'individual', clubId:ENTE, category:'prebenjamin', subcategory:'A' };

ok('1a · 🔑🔑🔑 los DOS equipos del ente NO son la misma plaza',
   mismaPlaza(REGIONAL_A, PREBEN_A) === false,
   'con `true` aquí, el arranque borra el segundo equipo de Firestore');
ok('1b · y una plaza consigo misma sí lo es (un duplicado real se sigue quitando)',
   mismaPlaza(REGIONAL_A, Object.assign({}, REGIONAL_A)) === true);
// ⚠️ LÍMITE CONOCIDO, ANOTADO A PROPÓSITO. `cronosMismaPlaza` compara con
//    `cronosTeamSlug` tal cual: 'regional_a' y 'regional'+'A' le salen
//    DISTINTAS. Quien normaliza las dos formas históricas es la migración
//    `_indMigrarPlazasALaFormaCanonica` (v627), que corre al abrir el panel
//    del ente. No se toca aquí: cambiar la identidad de plaza para que
//    absorba sufijos afectaría a los cuatro aprobares que la usan, y este
//    encargo es otro. Se fija el comportamiento para que el día que alguien
//    lo cambie sepa que era sabido.
ok('1c · ⚠️ (límite conocido) la forma "regional_a" NO casa con "regional"+"A": lo normaliza la migración de v627',
   mismaPlaza(REGIONAL_A, { role:'individual', clubId:ENTE, category:'regional_a', subcategory:'A' }) === false);
ok('1d · el mismo equipo en OTRO ente no es la misma plaza',
   mismaPlaza(REGIONAL_A, Object.assign({}, REGIONAL_A, { clubId:'individual_otro' })) === false);
// ⚠️ Lo que el comentario de la función promete desde siempre y NO puede
//    romperse: quien no ocupa equipo se identifica por rol+club, o podría
//    pedir el mismo rol una y otra vez.
ok('1e · ⚠️⚠️ un FAMILIAR sigue identificándose sin categoría (no ocupa equipo)',
   mismaPlaza({ role:'parent', clubId:ENTE, category:'regional', subcategory:'A' },
              { role:'parent', clubId:ENTE, category:'prebenjamin', subcategory:'B' }) === true);
ok('1f · ⚠️ y un director también',
   mismaPlaza({ role:'director', clubId:'club_x', category:'alevin' },
              { role:'director', clubId:'club_x', category:'cadete' }) === true);
ok('1g · 🔑 un entrenador de CLUB con dos equipos sigue teniendo dos plazas (v554)',
   mismaPlaza({ role:'user', clubId:'club_x', category:'alevin',   subcategory:'C' },
              { role:'user', clubId:'club_x', category:'regional', subcategory:'A' }) === false);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · las claves del ARRANQUE, que son las que ESCRIBEN ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // 🚨 Estas dos claves viven en auth.js y su resultado se persiste con
    //    `setDoc`. Son las que de verdad borraron la plaza del autor.
    const conManoRegex = /\(r\.role === 'user' \|\| r\.role === 'coach'\)\s*\n?\s*\?\s*\(typeof window\.cronosTeamSlug/g;
    ok('2a · 🔴🔴 ninguna clave de plaza lleva ya ["user","coach"] escrito a mano',
       (AUTH.match(conManoRegex) || []).length === 0,
       'esa lista se quedó atrás en la unificación del ente (v598/v599)');
    const leenLaLista = (AUTH.match(/\(window\.CRONOS_ROLES_CON_EQUIPO \|\| \['user', 'coach'\]\)\.indexOf\(r\.role\) >= 0/g) || []).length;
    ok('2b · 🔑 y las DOS claves leen `CRONOS_ROLES_CON_EQUIPO`',
       leenLaLista === 2, leenLaLista);
    ok('2c · ⚠️ el bloque que persiste sigue ahí (no se ha desactivado la limpieza)',
       /fa\.setDoc\(ref, \{ allRoles: cleanAllRoles \}/.test(AUTH) &&
       /fa\.setDoc\(ref, \{ allRoles: cleanedRoles \}/.test(AUTH));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el arranque, EJECUTADO sobre el `allRoles` del autor ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // La clave real recortada de auth.js, corriendo sobre sus plazas.
    const T = sinCom(trozo(AUTH, 'const _clavePlaza = (r) =>', "                : '');"));
    const fuente = '(function (window) {\n' + T + '\nreturn _clavePlaza;\n})';
    const fabricar = vm.runInNewContext(fuente, { String, Object, Array });
    const clave = fabricar(sb.window);

    const dedup = (roles) => {
        const visto = new Set();
        return roles.filter(r => { const k = clave(r); if (visto.has(k)) return false; visto.add(k); return true; });
    };

    // Sus plazas tal y como el SuperAdmin las deja tras aprobar.
    const suyas = [REGIONAL_A, PREBEN_A];
    ok('3a · 🔑🔑🔑 entrar a la app YA NO le borra el segundo equipo',
       dedup(suyas).length === 2, dedup(suyas).map(r => r.category));
    // Y el resto sin categoría que hoy arrastra su documento no se lleva a nadie.
    const conResto = [REGIONAL_A, PREBEN_A, { role:'individual', clubId:null, category:null }];
    ok('3b · ⚠️ y el resto sin categoría ni ancla que arrastra su ficha tampoco',
       dedup(conResto).length === 3, dedup(conResto).length);
    ok('3c · un duplicado de verdad se sigue quitando',
       dedup([REGIONAL_A, Object.assign({}, REGIONAL_A), PREBEN_A]).length === 2);
    ok('3d · ⚠️ dos plazas de FAMILIAR en el mismo ente siguen colapsando en una',
       dedup([{ role:'parent', clubId:ENTE, category:'a' },
              { role:'parent', clubId:ENTE, category:'b' }]).length === 1);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · aprobar el equipo, en la pantalla que el SA USA ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // 🚨 La v685 puso la rama en `requests-tab.js`, que NO es esta pantalla.
    //    Las capturas 10240-10243 son de `saRequests` (extras.js): el botón
    //    "Descartar" y el aviso "Administrador Individual activado" sólo
    //    existen aquí.
    ok('4a · 🔑🔑 `saExtApprove` sabe aprobar una solicitud de equipo',
       /r\.type === 'ind_team_request' && r\.userUid/.test(EXTRAS));
    const iEquipo = EXTRAS.indexOf("r.type === 'ind_team_request' && r.userUid");
    const iAlta   = EXTRAS.indexOf("role === 'individual' && r.userUid");
    ok('4b · 🔑 y va ANTES que la rama del ALTA del ente, que si no la capturaba',
       iEquipo > 0 && iAlta > 0 && iEquipo < iAlta, { equipo: iEquipo, alta: iAlta });
    ok('4c · ⚠️ toca UNA plaza (casada por categoría), no todas las "individual"',
       /_mismaCatT = function \(rol\)/.test(EXTRAS) &&
       /if \(!rol \|\| _tocadaT\) return rol;/.test(EXTRAS));
    ok('4d · 🚨🚨 RECHAZAR un equipo NO pone `rejected` en la raíz del ente',
       /Equipo rechazado — el ente sigue activo/.test(EXTRAS));
    ok('4e · y retira la plaza pendiente, que si no le bloquea el hueco',
       /status: 'removed', isAuthorized: false/.test(EXTRAS));
    ok('4f · ⚽ la tarjeta dice que es un EQUIPO, no un alta de usuario',
       /Equipo nuevo · Entrenador Administrador Individual/.test(EXTRAS));
    ok('4g · ⚠️ y enseña el grupo (acepta `requestedSubcategory` del panel del ente)',
       /r\.requestedSubcategory \|\| r\.requestedSubcat/.test(EXTRAS));
}

console.log('\n' + (fallos === 0 ? '✅' : '❌') + '  ' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos === 0 ? 0 : 1);
