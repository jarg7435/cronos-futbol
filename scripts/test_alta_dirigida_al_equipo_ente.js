// ═══════════════════════════════════════════════════════════════════════════
//  test_alta_dirigida_al_equipo_ente.js
//  v685 · LAS ALTAS DEL ENTE VAN A UNO DE SUS DOS EQUIPOS — GUARD
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-09-10, punto 3):
//
//    «Configurar la recepción de altas para que los registros de
//     padres/familiares vayan dirigidos a la subcategoría de Fútbol 7 y las
//     altas de jugadores correspondan a la de Fútbol 11.»
//
//  🔑 POR QUÉ SE PREGUNTA LA MODALIDAD Y NO LA CATEGORÍA. El formulario de
//  alta lo rellena alguien SIN CUENTA: sólo puede leer `clubs_public`, el
//  espejo público que mantiene `syncClubPublic` y que expone tres campos
//  (name, type, status). Los equipos del ente viven en `users/{admin}.allRoles`,
//  que un anónimo no puede leer. Ofrecer ahí "Regional A" exigiría publicar los
//  equipos en ese espejo — o sea, tocar y desplegar Cloud Functions.
//
//  🔑 Y NO HACE FALTA: la regla del proyecto garantiza que un ente lleva como
//  mucho DOS equipos y uno de cada modalidad (`cronosPuedeLlevarEquipo`, v537 /
//  v598). "El de Fútbol 7" identifica UN equipo sin ambigüedad. La traducción a
//  la categoría real se hace en `indForwardToSA`, que es el primer momento en
//  que los equipos del ente están delante.
//
//  ⚠️ ANTES ESTE CAMINO NO EXISTÍA: el alta bajo un ente ofrecía las 9
//  categorías × 3 grupos = 27 combinaciones, de las que como mucho DOS eran
//  equipos reales. Las otras 25 no daban error: aterrizaban en "Otros usuarios
//  del ente" a que alguien las recolocara a mano con ✏️.
//
//  ⚠️ LA PARTE 2 EJECUTA la traducción recortada del fichero vivo, no una copia
//  escrita aquí (la lección de v620).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT  = path.join(__dirname, '..');
const leer  = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
                       .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const sinComHtml = (t) => t.replace(/<!--[\s\S]*?-->/g, '');

const IND   = leer('js/admin/individual/panel.js');
const AUTH  = sinCom(leer('js/services/auth.js'));
const INDEX = sinComHtml(leer('index.html'));

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · el alta bajo un ente pregunta por EQUIPO, no por categoría ──');
// ───────────────────────────────────────────────────────────────────────────
ok('1a · 🔑 existe el selector de equipo del ente, con las dos modalidades',
   /id="auth-ind-team"/.test(INDEX) &&
   /<option value="f7">/.test(INDEX) && /<option value="f11">/.test(INDEX));
ok('1b · 🔑🔑 y SUSTITUYE al de 27 combinaciones cuando el alta es bajo un ente',
   /const _bajoEnte\s*=\s*isUnderIndividual && \['user', 'parent'\]\.includes\(role\)/.test(AUTH) &&
   /const needsCategory = !_bajoEnte/.test(AUTH));
ok('1c · ⚠️ el ADMINISTRADOR del ente sigue eligiendo categoría (él define los equipos)',
   /!_bajoEnte && \['user', 'parent', 'individual'\]\.includes\(role\)/.test(AUTH));
ok('1d · 🚨 el equipo es obligatorio, y se exige en el CÓDIGO (no sólo en el HTML)',
   /_entityTypeVal === 'individual' && !selectedIndTeam/.test(AUTH) &&
   /Elige el equipo al que perteneces/.test(AUTH));
// 🚨 v688 · 1e y 1f miden caminos de alta que un familiar de un ente NO
//    RECORRE: el bloque `_isUnderIndiv` de auth.js los intercepta antes y
//    termina con `return`. Estaban verdes y el alta real no guardaba nada.
//    El camino que sí se ejecuta lo vigila test_alta_ente_por_plaza.js
//    (PARTE 3). Se dejan porque esos caminos siguen existiendo.
ok('1e · la modalidad viaja EN LA PLAZA (la unidad del proyecto, v540)',
   /newAllRoles\[0\]\.requestedModality = selectedIndTeam/.test(AUTH));
ok('1f · y en la solicitud que verá el administrador del ente',
   /requestedModality: selectedIndTeam \|\| null/.test(AUTH));
ok('1g · ⚠️ y el bloque se oculta al volver a modo login (no se queda pegado)',
   /'ind-team-container'\]\.forEach/.test(AUTH));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · la traducción "Fútbol 7" → "Prebenjamín A", EJECUTADA ──');
// ───────────────────────────────────────────────────────────────────────────
function trozo(src, cab, cierre) {
    const i = src.indexOf(cab);      if (i < 0) throw new Error('No se encontró: ' + cab);
    const j = src.indexOf(cierre, i); if (j < 0) throw new Error('Sin cierre de: ' + cab);
    return src.slice(i, j + cierre.length);
}

// ══════════════════════════════════════════════════════════════════════════
//  v688 · LA TRADUCCIÓN VIVE AHORA EN `cronosAltaEnte.equipo` (utils.js), y
//  se EJECUTA de allí. Antes se recortaba el bloque de `indForwardToSA`.
//
//  🔑 DOS ASERCIONES CAMBIAN DE CONTRATO, y a propósito (2d y 2h). La v685,
//  cuando el equipo no quedaba claro, reenviaba SIN categoría y el alta caía
//  en "Otros usuarios del ente" / "Sin categoría" — que es justo lo que el
//  autor reportó con la captura 10256. Ahora, en esos casos, el resultado es
//  `{ elegir }`: lo decide el administrador con sus equipos delante. Lo que
//  NO cambia es lo importante: **nunca se inventa un equipo**.
// ══════════════════════════════════════════════════════════════════════════
const UTILS = leer('js/core/utils.js');
let A = null;
try {
    const sb = { console: { log(){}, warn(){} }, String, Set, Array, Object, JSON };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(trozo(UTILS, 'if (typeof window._cronosMatchModality !== \'function\') {', '\n}'), sb);
    vm.runInContext(trozo(UTILS, 'if (!Array.isArray(window.CRONOS_ROLES_CON_EQUIPO))', '\n}'), sb);
    try { vm.runInContext(trozo(UTILS, 'window.cronosTeamSlug = function', '\n    };'), sb); } catch (e) { /* opcional */ }
    vm.runInContext(trozo(UTILS, 'if (typeof window.cronosMismaPlaza !== \'function\') {', '\n}'), sb);
    vm.runInContext(trozo(UTILS, 'if (typeof window.cronosNombreCategoria !== \'function\') {', '\n}'), sb);
    vm.runInContext(trozo(UTILS, 'if (typeof window.cronosEquiposDeEntrenador !== \'function\') {', '\n}'), sb);
    vm.runInContext(trozo(UTILS, 'if (typeof window.cronosAltaEnte !== \'object\' || !window.cronosAltaEnte) {', '\n}'), sb);
    A = sb.window.cronosAltaEnte;
    ok('2a · la traducción (cronosAltaEnte.equipo) se puede extraer y ejecutar',
       !!A && typeof A.equipo === 'function');
} catch (e) {
    ok('2a · la traducción (cronosAltaEnte.equipo) se puede extraer y ejecutar', false, e.message);
}

if (A) {
    const ENTE = 'individual_jose';
    // Sus dos equipos REALES, los de las capturas 10231/10232.
    const DOS = [
        { role:'individual', clubId:ENTE, category:'regional',    subcategory:'A', isAuthorized:true, status:'active' },
        { role:'individual', clubId:ENTE, category:'prebenjamin', subcategory:'A', isAuthorized:true, status:'active' },
    ];
    const traducir = (q, rolesAdmin) => A.equipo(Object.assign({ requestedRole: 'parent', individualOwnerId: ENTE }, q),
                                                 null, A.equiposDelEnte(rolesAdmin, ENTE));
    {
        const r = traducir({ requestedModality: 'f7' }, DOS);
        ok('2b · 🔑🔑 "Fútbol 7" se resuelve a SU equipo de F7 (prebenjamin A)',
           r.category === 'prebenjamin' && r.subcategory === 'A', r);
    }
    {
        const r = traducir({ requestedModality: 'f11' }, DOS);
        ok('2c · 🔑🔑 y "Fútbol 11" al de F11 (regional A)',
           r.category === 'regional' && r.subcategory === 'A', r);
    }
    {
        // ⚠️ Sin equipo de esa modalidad NO se inventa ninguno. v688: con UN
        //    solo equipo en el ente, ése es el único destino posible y se usa;
        //    lo que no puede pasar es que salga un equipo de F7 que no existe.
        const r = traducir({ requestedModality: 'f7' }, [DOS[0]]);
        ok('2d · ⚠️⚠️ si NO tiene equipo de esa modalidad, no se inventa uno (va al único que existe)',
           r.category === 'regional' && r.via === 'unico', r);
    }
    {
        // Una plaza retirada no vale como equipo destino.
        const r = traducir({ requestedModality: 'f7' }, [
            { role:'individual', clubId:ENTE, category:'prebenjamin', subcategory:'A', isAuthorized:true, status:'removed' }]);
        ok('2e · ⚠️ una plaza retirada no recibe altas', !r.category && r.ninguno === true, r);
    }
    {
        // 🔑 Y una plaza de OTRO ente tampoco: el aislamiento club/ente de v584.
        const r = traducir({ requestedModality: 'f7' }, [
            { role:'user', clubId:'club_otro', category:'prebenjamin', subcategory:'B', isAuthorized:true, status:'active' }]);
        ok('2f · 🔑🔑 una plaza de OTRO club no recibe las altas de este ente (v584)',
           !r.category && r.ninguno === true, r);
    }
    {
        // La forma histórica de una pieza ('prebenjamin_a') tiene que casar igual.
        const r = traducir({ requestedModality: 'f7' }, [
            { role:'individual', clubId:ENTE, category:'prebenjamin_a', isAuthorized:true, status:'active' }]);
        ok('2g · ⚠️ y casa con la forma histórica "prebenjamin_a" de una pieza',
           r.category === 'prebenjamin' && r.subcategory === 'A', r);
    }
    {
        // v688 · CONTRATO NUEVO: antes "no se toca" = se reenviaba sin equipo.
        const r = traducir({}, DOS);
        ok('2h · un alta sin modalidad con dos equipos: NO se adivina, la ELIGE el administrador',
           !r.category && Array.isArray(r.elegir) && r.elegir.length === 2, r);
    }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el administrador del ente VE a qué equipo se apunta ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const LIMPIO = sinCom(IND);
    ok('3a · la ficha del alta pendiente enseña la modalidad pedida',
       /const modBadge =/.test(LIMPIO) && /\$\{roleLabel\}\$\{catBadge\}\$\{modBadge\}/.test(LIMPIO));
    ok('3b · 🚨 `_MOD_LBL` está en el MÓDULO, no dentro de la función',
       /^const _MOD_LBL = \{ f7:/m.test(LIMPIO),
       'un const local dejaba la lista de altas en zona muerta — y node --check lo da por bueno');
    // v688 · la plaza se escribe con `cronosAltaEnte.reenviar`, que pone el
    // equipo en LA plaza de la solicitud (antes, en todas las del ente sin
    // categoría — también en las del propio administrador). Ejecutado en
    // test_alta_ente_por_plaza.js, aserciones 1o/1p.
    ok('3c · al reenviar se fija también la categoría en la PLAZA del interesado',
       /A\.reenviar\(uData, _qEq, eq\)/.test(LIMPIO));
    ok('3d · ⚠️ y un fallo al fijarla NO tumba el reenvío, pero se dice por qué',
       /Error actualizando la plaza del usuario/.test(LIMPIO));
}

console.log('\n' + (fallos === 0 ? '✅' : '❌') + '  ' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos === 0 ? 0 : 1);
