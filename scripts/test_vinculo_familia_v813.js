// ─────────────────────────────────────────────────────────────────────────
//  test_vinculo_familia_v813.js  ·  🔗🔒 v813 (2026-10-13)
//
//  Encargo del autor (implementar.txt): probar a fondo Contactos con 5
//  familias de testeo (3 Alevín C + 2 Regional B, el #10 en los dos).
//  Medido con sesiones reales en cronos-futbol-test:
//   · Ninguna familia nueva se auto-vinculaba: `ppPlayer` leía antes el
//     vínculo `{club}_{dorsal}`, que no existía, y las reglas deniegan leer
//     un documento inexistente (resource == null).
//   · La familia del #10 de Regional B se QUEDÓ el vínculo del #10 de
//     Alevín C (mismo id, adopción por «J10»). Y el registro le ponía el
//     parentUid a TODOS los «J10» del club.
//   · Por la pertenencia al club, una familia leía vínculos, avisos e
//     informes de todos los equipos, y podía modificar el vínculo de otra.
//
//  Se vigila:
//   1. El id del vínculo nuevo lleva equipo, dorsal y UID (cronosIdVinculo).
//   2. La familia crea su vínculo SIN leerlo antes y sólo adopta vínculos
//      sin dueño y de su equipo (auto, manual y registro).
//   3. Contactos ya no saca el dorsal del final del id.
//   4. Reglas: la cuenta de familia queda fuera de las ramas «del club» de
//      vínculos, avisos e informes, y no puede tocar jugador ni permisos.
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
const AUTH = leer('js/services/auth.js');
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
const bloque = (src, desde) => {
    const i = src.indexOf(desde); if (i < 0) throw new Error('No está: ' + desde);
    return src.slice(i, src.indexOf('\n    }\n', i));
};

console.log('\n══ 🔗🔒 v813 · el vínculo de la familia es suyo y de su equipo ══\n');

console.log('1) El id del vínculo');
{
    const ctx = { window: {} };
    vm.createContext(ctx);
    vm.runInContext(funcion(UTILS, 'function cronosIdVinculo('), ctx);
    const f = (...a) => vm.runInContext('cronosIdVinculo(' + a.map((x) => JSON.stringify(x)).join(',') + ')', ctx);
    const a = f('club_x', 'club-x__alevin__c', '10', 'uidA');
    const b = f('club_x', 'club-x__regional__b', '10', 'uidB');
    const c = f('club_x', 'club-x__alevin__c', '10', 'uidC');
    ok('1a · 🔑 el #10 de dos equipos → ids distintos', a !== b, [a, b]);
    ok('1b · 🔑 dos familiares del mismo niño → ids distintos', a !== c, [a, c]);
    ok('1c · «J10» y «10» dan el mismo id', f('club_x', 't', 'J10', 'u') === f('club_x', 't', '10', 'u'));
    ok('1d · sin equipo no deja huecos', f('club_x', '', '7', 'u') === 'club_x_7_u');
}

console.log('\n2) La familia crea lo suyo y no adopta lo ajeno');
{
    const auto = PAR.slice(PAR.indexOf('window.ppPlayer = async'), PAR.indexOf('if (!links.length) {', PAR.indexOf('window.ppPlayer = async')));
    ok('2a · 🔑 ya no lee el vínculo antes de crearlo (getDoc denegado sobre inexistente)', !/existingLink/.test(auto));
    ok('2b · el vínculo automático se crea con cronosIdVinculo', /cronosIdVinculo\(clubId, _eqFam\.teamId, pNum, me\.uid\)/.test(auto));
    ok('2c · 🔑 auto: salta vínculos con OTRO dueño o de OTRO equipo',
       /if \(ld\.parentUid && ld\.parentUid !== me\.uid\) return;/.test(auto) && /_ntA\(ld\.teamId\) !== _ntA\(_miEq\)/.test(auto));
    const man = funcion(PAR, 'window._ppLinkManual = async');
    ok('2d · 🔑 manual: sólo adopta sin dueño (o mío) y de mi equipo', /const _adoptable = \(ld\) => \(!ld\.parentUid \|\| ld\.parentUid === me\.uid\)/.test(man)
       && (man.match(/_adoptable\(d\.data\(\)\)/g) || []).length === 2);
    ok('2e · manual: id con el uid y el nombre del jugador (no «Jugador · 3»)',
       /cronosIdVinculo\(clubId, _eqFamM\.teamId, manualPNum, me\.uid\)/.test(man) && /playerAlias:\s+_aliasM,/.test(man));
    ok('2f · 🔑 registro (dos sitios): no se pone el parentUid a un «J10» con dueño',
       (AUTH.match(/linkSnap\.forEach\(async d => \{\s*\/\/ 🔒 v813[^\n]*\n[^\n]*\n\s*if \(d\.data\(\)\.parentUid\) return;/g) || []).length === 2);
    ok('2g · la familia ya no pide los avisos de TODO el club', /if \(clubId && !_esFamilia\) \{/.test(PAR));
}

console.log('\n3) Contactos');
{
    ok('3a · el dorsal ya no sale del final del id (ahora es el uid)', /const playerNum = \/\^\\d\+\$\/\.test\(_colaId\) \? _colaId : null;/.test(CM));
    ok('3b · el inviteCode sigue al jugador elegido', /if \(updateData\.playerNumber\) updateData\.inviteCode = 'J' \+ updateData\.playerNumber;/.test(CM));
}

console.log('\n4) Reglas');
{
    ok('4a · existe esCuentaFamilia() por rol RAÍZ', /function esCuentaFamilia\(\)[\s\S]{0,300}\.data\.get\('role', ''\)\s*in \['parent', 'padre_individual', 'parent_individual'\]/.test(RULES));
    const L = bloque(RULES, 'match /cronos_player_links/{linkId}');
    ok('4b · 🔑 vínculos: la familia lee sólo el suyo', /isLinkOwner\(\) \|\|\s*\(!esCuentaFamilia\(\) && \(\s*isLinkClubMember\(\)/.test(L));
    ok('4c · 🔑 vínculos: la familia crea sólo a su nombre y sin jugador ni permisos',
       /request\.resource\.data\.get\('parentUid', null\) == request\.auth\.uid\s*&& !request\.resource\.data\.keys\(\)\.hasAny\(\['playerCode', 'canWatchLive', 'canSendMsg'\]\)/.test(L));
    ok('4d · 🔑 vínculos: la familia sólo cambia sus datos de contacto',
       /\.hasOnly\(\['parentUid', 'parentEmail', 'parentName', 'parentPhone'\]\)/.test(L) && /\(!esCuentaFamilia\(\) && isLinkClubMember\(\)\) \|\|/.test(L));
    const N = bloque(RULES, 'match /cronos_notifications/{notifId}');
    ok('4e · avisos: lectura, cambio y borrado «del club» sin la familia', (N.match(/\(!esCuentaFamilia\(\) && \(/g) || []).length === 3, (N.match(/esCuentaFamilia/g) || []).length);
    const R = bloque(RULES, 'match /cronos_player_reports/{reportId}');
    ok('4f · informes: ramas «del club» sin la familia (leer 3, crear 3, cambiar 2, borrar 1)', (R.match(/!esCuentaFamilia\(\)/g) || []).length === 9, (R.match(/!esCuentaFamilia\(\)/g) || []).length);
    ok('4g · la familia sigue leyendo y descartando LO SUYO', /request\.auth\.uid == resource\.data\.get\('parentUid', null\) \|\|/.test(R) && /\.hasOnly\(\['dismissedBy'\]\)\) \|\|/.test(R));
}

console.log('\n5) v814 · los envíos, sólo a las familias del equipo');
{
    const WE = leer('js/shared/whatsapp-email.js');
    const MRS = leer('js/coach/comms/match-reports-send.js');
    const picker = WE.slice(WE.indexOf('window._cronosOpenRecipientPicker = async function'), WE.indexOf('function openConvocationMessage('));
    ok('5a · 🔑 selector (convocatoria y entrenamiento): familias del equipo abierto por vínculo o plaza',
       /const _eqAbierto = .*cronosEquipoAbierto\(\)/.test(picker) && /_vincEquipo\.set\(l\.parentUid, l\)/.test(picker) && /filtered\.splice\(i, 1\)/.test(picker));
    ok('5b · la casilla respeta CONV./ENTR. de Contactos', /const _flag = context === 'convocatoria' \? 'canReceiveConv' : 'canReceiveTr';/.test(picker)
       && /\$\{c\._desmarcado \? '' : 'checked'\}/.test(picker));
    ok('5c · ⚠️ sin TDZ: no usa `isConv` antes de declararlo', picker.indexOf('isConv ?') < 0 || picker.indexOf('const isConv') < picker.indexOf('isConv ?'));
    const ctx = { window: { cronosEquipoAbierto: () => 'club-x__regional__b' } };
    vm.createContext(ctx);
    ['function _cronosNoEsAcento(', 'function cronosTeamSlug(', 'function cronosSinModalidad(', 'function cronosTeamIdNorm(', 'function cronosContactoDeOtroEquipo('].forEach((f) => {
        try { vm.runInContext(funcion(UTILS, f), ctx); } catch (e) { /* ausente: lo dirá la prueba */ }
    });
    const otro = (c) => vm.runInContext('cronosContactoDeOtroEquipo(' + JSON.stringify(c) + ')', ctx);
    ok('5d · 🔑 contacto de familia de OTRO equipo → fuera', otro({ type: 'parent', teamId: 'club-x__alevin__c' }) === true);
    ok('5e · del mismo equipo, sin equipo o staff → dentro',
       otro({ type: 'parent', teamId: 'club-x__regional__b' }) === false && otro({ type: 'parent' }) === false && otro({ type: 'staff', teamId: 'club-x__alevin__c' }) === false);
    ok('5f · las dos listas (fin de partido e informes) filtran por equipo',
       /cronosContactoDeOtroEquipo\(c\)\)\);/.test(WE) && /if \(typeof window\.cronosContactoDeOtroEquipo === 'function' && window\.cronosContactoDeOtroEquipo\(c\)\) return false;/.test(MRS));
    ok('5g · 🔑 Contactos guarda las familias VINCULADAS como contactos (el envío de informes las recorre)',
       /_vinc\.set\(l\._id, \{/.test(CM) && /if \(marca\('contact-rpt', 'canReceiveReports', false\)\)\s+tags\.push\('rpt'\);/.test(CM) && /_vinc\.forEach\(c => updatedContacts\.push\(c\)\);/.test(CM));
    ok('5h · Contactos no duplica familias ni pinta las de otro equipo, y no las pierde al guardar',
       /_cmFilaManualVisible\(c\)\)\.map\(c => renderParentRowMarkup\(c\)\)/.test(CM) && /const uid = c\.uid \|\| c\.id \|\| '';/.test(CM) && /\(_cmOcultas \|\| \[\]\)\.forEach/.test(CM));
    ok('5i · 🔑 la tarjeta Vídeos de la familia mira la categoría de su PLAZA', /const _cats = \[/.test(PAR) && /_cats\.some\(c => window\.CronosClips\.esAdultos\(c\)\)/.test(PAR));
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
