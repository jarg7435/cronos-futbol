// ─────────────────────────────────────────────────────────────────────────
//  test_primera_visita_appcheck.js  ·  🔴 v826 (2026-10-19)
//
//  Prueba E2E de invitaciones: el enlace abría un alta VACÍA. Medido con un
//  Chrome sin estrenar, en testeo y en producción: el primer token de App
//  Check (reCAPTCHA) tarda >10 s, Firestore se marca «sin conexión» a los 10
//  s y las dos lecturas sin sesión —invitación y lista de clubes— caían en
//  esa ventana sin repetirse. La 2ª visita iba bien (token ya en disco).
//
//  Se vigila:
//   1. firebase-init publica cronosAppCheckListo, que nunca rechaza.
//   2. El resolutor de la invitación ESPERA a App Check antes de leer
//      (ejecutado: cuenta en qué orden ocurre).
//   3. La lista de clubes espera y, con caché vacía, pregunta al SERVIDOR.
//   4. El autorrelleno espera la lista lo bastante (60 s).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const INIT = leer('js/services/firebase-init.js');
const UTILS = leer('js/core/utils.js');
const AUTH = leer('js/services/auth.js');
const PREF = leer('js/services/auth/invite-prefill.js');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

console.log('\n══ 🔴 La primera visita espera al token de App Check ══\n');

console.log('1) firebase-init');
const ini = INIT.indexOf('window.cronosAppCheckListo = function');
ok('1a · publica cronosAppCheckListo', ini !== -1);
const cuerpo = INIT.slice(ini, INIT.indexOf('};', ini));
ok('1b · 🔑 nunca rechaza (error → false) y tiene tope', /\.then\(\(\) => true, \(\) => false\)/.test(cuerpo) && /setTimeout\(\(\) => r\(false\), msTope \|\| 30000\)/.test(cuerpo), cuerpo);
ok('1c · va DENTRO de la rama con App Check (sin App Check no se espera a nada)',
   ini > INIT.indexOf('if (APPCHECK_HOSTS.includes(_host) || _local) {') && ini < INIT.indexOf("window._cronosAppCheck = 'error';"));

console.log('\n2) La invitación, ejecutada');
(async () => {
    const i0 = UTILS.indexOf("if (typeof window.cronosLeerInvitacion !== 'function') {");
    let p = 0, j = UTILS.indexOf('{', i0);
    for (; j < UTILS.length; j++) { if (UTILS[j] === '{') p++; else if (UTILS[j] === '}') { p--; if (!p) break; } }
    const bloque = UTILS.slice(i0, j + 1).replace(
        "await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')", 'window.__m');
    const orden = [];
    const sb = { window: {}, setTimeout, console, Date, String };
    sb.window._cronos_auth = { db: {} };
    sb.window.cronosAppCheckListo = async () => { orden.push('appcheck'); return true; };
    sb.window.__m = {
        doc: () => ({}),
        getDoc: async () => { orden.push('lectura');
            return { exists: () => true, data: () => ({ email: 'x@y.es', role: 'parent', clubName: 'C', clubId: 'c' }) }; },
    };
    vm.createContext(sb);
    vm.runInContext(bloque, sb);
    const r = await sb.window.cronosResolverInvitacion('0123456789abcdef0123456789abcdef');
    ok('2a · 🔑 espera a App Check ANTES de la primera lectura', orden[0] === 'appcheck' && orden[1] === 'lectura', orden.join(' → '));
    ok('2b · y la invitación sale válida', r && r.estado === 'ok' && r.inv.role === 'parent', JSON.stringify(r));
    delete sb.window.cronosAppCheckListo; orden.length = 0;
    const r2 = await sb.window.cronosResolverInvitacion('0123456789abcdef0123456789abcdef');
    ok('2c · sin App Check (local/otro dominio) lee igual', r2.estado === 'ok' && orden[0] === 'lectura');

    console.log('\n3) La lista de clubes');
    const a = AUTH.indexOf('export async function loadClubOptions()');
    const lc = AUTH.slice(a, AUTH.indexOf('\n}\n', a));
    ok('3a · espera a App Check antes de leer', lc.indexOf('cronosAppCheckListo(30000)') !== -1 &&
       lc.indexOf('cronosAppCheckListo(30000)') < lc.indexOf("m.getDocs(m.collection(fa.db, 'clubs_public'))"));
    ok('3b · 🔑 caché VACÍA → pregunta al servidor (getDocs no falla sin conexión)',
       /clubsSnap\.empty && clubsSnap\.metadata && clubsSnap\.metadata\.fromCache/.test(lc) && /m\.getDocsFromServer\(m\.collection\(fa\.db, 'clubs_public'\)\)/.test(lc));
    ok('3c · con tope (3 reintentos)', /_i < 3/.test(lc));

    console.log('\n4) El autorrelleno');
    ok('4a · espera la lista hasta 60 s', /_esperarClubes\(60000\)/.test(PREF));
    ok('4b · avisa de que la primera vez tarda', /la primera vez puede tardar/.test(PREF));

    console.log('\n5) La invitación queda USADA antes de cerrar sesión (prueba E2E 4)');
    {
        const sb5 = { window: { location: { search: '' } }, setTimeout, console, Promise, document: { getElementById: () => null } };
        vm.createContext(sb5);
        vm.runInContext(PREF, sb5);
        const W = sb5.window;
        let escrito = false, resolverEscritura;
        W.cronosConsumirInvitacion = () => new Promise((r) => { resolverEscritura = () => { escrito = true; r(true); }; });
        W._cronosInviteToken = 'tok123';
        const p = W.cronosConsumirInvitacionAhora(2000);
        let terminado = false; p.then(() => { terminado = true; });
        await new Promise((r) => setTimeout(r, 50));
        ok('5a · 🔑 no termina hasta que el servidor confirma la escritura', !terminado && !escrito);
        resolverEscritura(); const res = await p;
        ok('5b · y entonces devuelve la confirmación', terminado && escrito && res === true);
        ok('5c · el token se gasta una sola vez', W._cronosInviteToken === null && (await W.cronosConsumirInvitacionAhora(100)) === true);
        const sb6 = { window: { location: { search: '' } }, setTimeout, console, Promise, document: { getElementById: () => null } };
        vm.createContext(sb6); vm.runInContext(PREF, sb6);
        sb6.window.cronosConsumirInvitacion = () => new Promise(() => {});   // la red no responde
        sb6.window._cronosInviteToken = 't';
        const t0 = Date.now(); const r6 = await sb6.window.cronosConsumirInvitacionAhora(300);
        ok('5d · con la red muda, el tope suelta el alta (nunca la bloquea)', r6 === false && Date.now() - t0 < 1500);
        const n = (AUTH.match(/await window\.cronosConsumirInvitacionAhora\(8000\);[\s\S]{0,260}?await fa\.signOut\(fa\.auth\)/g) || []).length;
        ok('5e · 🔑 las TRES salidas de un alta correcta esperan antes del signOut', n === 3, 'encontradas: ' + n);
    }

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
