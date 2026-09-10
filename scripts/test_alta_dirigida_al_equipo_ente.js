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

let traducir = null;
try {
    // El bloque real que elige el equipo del ente para una modalidad pedida.
    // Se corta en la última asignación a `updateData`: lo que se mide aquí es
    // la DECISIÓN (qué equipo sale), no las escrituras en Firestore que vienen
    // después y no tienen sandbox. Las dos llaves que quedan abiertas —el
    // `if (_suyo)` y el `if (_modPedida && isIndSub)`— se cierran a mano.
    const T = sinCom(trozo(IND, 'const _modPedida = existingData.requestedModality || null;',
                                'updateData.resolvedFromModality = _modPedida;'))
              + '\n} }\n';

    const fuente = '(function (existingData, isIndSub, d, window, _indCatLabel) {\n'
        + 'var updateData = {};\n'
        + T
        + 'return updateData;\n})';
    traducir = vm.runInNewContext(fuente, { String, Object, Array, console: { warn(){} } });
    ok('2a · el bloque de traducción se puede extraer y ejecutar', true);
} catch (e) {
    ok('2a · el bloque de traducción se puede extraer y ejecutar', false, e.message);
}

if (traducir) {
    const ENTE = 'individual_jose';
    // Sus dos equipos REALES, los de las capturas 10231/10232.
    const D = { userData: { individualEntityId: ENTE, allRoles: [
        { role:'individual', clubId:ENTE, category:'regional',    subcategory:'A', isAuthorized:true, status:'active' },
        { role:'individual', clubId:ENTE, category:'prebenjamin', subcategory:'A', isAuthorized:true, status:'active' },
    ]}};
    // El entorno mínimo que el bloque consulta.
    const W = {
        CRONOS_ROLES_CON_EQUIPO: ['user','coach','individual','admin_individual'],
        _cronosMatchModality: (c) => /prebenjamin|benjamin|alevin/.test(String(c)) ? 'f7' : 'f11',
    };
    // `_indCatLabel` es del módulo y el bloque lo llama sin `window.`: entra
    // como parámetro, sólo para componer la etiqueta legible.
    const _label = (c, s) => c + ' ' + s;
    const traducirOk = (ex, sub, d, w) => traducir(ex, sub, d, w, _label);

    {
        const r = traducirOk({ requestedModality: 'f7' }, true, D, W);
        ok('2b · 🔑🔑 "Fútbol 7" se resuelve a SU equipo de F7 (prebenjamin A)',
           r.requestedCategory === 'prebenjamin' && r.requestedSubcategory === 'A', r);
    }
    {
        const r = traducirOk({ requestedModality: 'f11' }, true, D, W);
        ok('2c · 🔑🔑 y "Fútbol 11" al de F11 (regional A)',
           r.requestedCategory === 'regional' && r.requestedSubcategory === 'A', r);
    }
    {
        // ⚠️ Sin equipo de esa modalidad NO se inventa ninguno: mandarlo al
        //    equipo equivocado es peor que dejarlo a la vista en "Otros".
        const soloF11 = { userData: { individualEntityId: ENTE, allRoles: [D.userData.allRoles[0]] }};
        const r = traducirOk({ requestedModality: 'f7' }, true, soloF11, W);
        ok('2d · ⚠️⚠️ si NO tiene equipo de esa modalidad, no se inventa uno',
           !r.requestedCategory, r);
    }
    {
        // Una plaza retirada no vale como equipo destino.
        const muerto = { userData: { individualEntityId: ENTE, allRoles: [
            { role:'individual', clubId:ENTE, category:'prebenjamin', subcategory:'A',
              isAuthorized:true, status:'removed' },
        ]}};
        const r = traducirOk({ requestedModality: 'f7' }, true, muerto, W);
        ok('2e · ⚠️ una plaza retirada no recibe altas', !r.requestedCategory, r);
    }
    {
        // 🔑 Y una plaza de OTRO ente tampoco: el aislamiento club/ente de v584.
        const ajeno = { userData: { individualEntityId: ENTE, allRoles: [
            { role:'user', clubId:'club_otro', category:'prebenjamin', subcategory:'B',
              isAuthorized:true, status:'active' },
        ]}};
        const r = traducirOk({ requestedModality: 'f7' }, true, ajeno, W);
        ok('2f · 🔑🔑 una plaza de OTRO club no recibe las altas de este ente (v584)',
           !r.requestedCategory, r);
    }
    {
        // La forma histórica de una pieza ('prebenjamin_a') tiene que casar igual.
        const viejo = { userData: { individualEntityId: ENTE, allRoles: [
            { role:'individual', clubId:ENTE, category:'prebenjamin_a',
              isAuthorized:true, status:'active' },
        ]}};
        const r = traducirOk({ requestedModality: 'f7' }, true, viejo, W);
        ok('2g · ⚠️ y casa con la forma histórica "prebenjamin_a" de una pieza',
           r.requestedCategory === 'prebenjamin' && r.requestedSubcategory === 'A', r);
    }
    {
        const r = traducirOk({}, true, D, W);
        ok('2h · un alta sin modalidad (las de antes de la v685) no se toca',
           !r.requestedCategory, r);
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
    ok('3c · al reenviar se fija también la categoría en la PLAZA del interesado',
       /if \(!r \|\| r\.category\) return r;/.test(LIMPIO));
    ok('3d · ⚠️ y un fallo al fijarla NO tumba el reenvío, pero se dice por qué',
       /No se pudo fijar la categoría en la plaza/.test(LIMPIO));
}

console.log('\n' + (fallos === 0 ? '✅' : '❌') + '  ' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos === 0 ? 0 : 1);
