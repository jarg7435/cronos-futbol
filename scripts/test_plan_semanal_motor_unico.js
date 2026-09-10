// ═══════════════════════════════════════════════════════════════════════════
//  test_plan_semanal_motor_unico.js
//  v689 · LA PLANIFICACIÓN SEMANAL SE PINTA CON UN SOLO MOTOR — GUARD
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt + capturas 10260/10261): la misma
//  planificación salía en TARJETAS POR DÍA en el Panel de Dirección y como una
//  LISTA de renglones en el Área de Familias. Pidió que Familias use
//  «exactamente el mismo motor de renderizado».
//
//  Había TRES renderizadores: el de Dirección (events-tab.js), la lista de
//  Familias (parent/panel.js) y `_cronosRenderTrainingWeekCards`
//  (shared/whatsapp-email.js), que se anunciaba como "fuente única" y no lo
//  llamaba NADIE.
//
//  PARTE 1 · el motor (`cronosRenderPlanSemanal`) EJECUTADO con la semana de
//            la captura 10261.
//  PARTE 2 · el modal de Familias EJECUTADO de verdad (ppNotifsByType →
//            ppViewNotifDetail con un Firestore de juguete): su bloque de la
//            semana es IDÉNTICO, carácter por carácter, al del motor.
//  PARTE 3 · los dos modales llaman al motor y no queda otro renderizador.
//
//  🔴 RED-CHECK: contra `git show HEAD:` la PARTE 1 no encuentra el motor y la
//  PARTE 2 pinta la lista vieja (sin una sola tarjeta `wp-day`).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const EVENTS = leer('js/coach/reports/events-tab.js');
const PARENT = leer('js/parent/panel.js');
const WA     = leer('js/shared/whatsapp-email.js');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle).slice(0, 400) : '')); }
}

// Réplicas EXACTAS de app-init.js (las mismas que usa test_events_tab_module.js).
const escapeHtml = (str) => {
    if (str === null || str === undefined) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;', '/': '&#x2F;' };
    return String(str).replace(/[&<>"'/]/g, c => map[c]);
};
const escapeAttr = (str) => {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

// La semana REAL de la captura 10261 (CD DÍA, semana del 10 de agosto).
const PLAN = {
    type: 'planificacion_semanal', clubId: 'club1', parentUid: 'p1',
    coachEmail: 'arinagazone@gmail.com', weekStartDate: '2026-08-10',
    createdAt: '2026-08-13T15:45:00.000Z',
    days: [
        { day: 'Lunes',     time: '20:00', venue: 'CAMPO DE M. ARINAGA', note: 'entrenamiento · CHANDAL · 90 MINUTOS' },
        { day: 'Martes',    time: '20:00', venue: 'CAMPO DE M. ARINAGA', note: 'partido amistoso · EQUIP. AZUL · 90 MINUTOS' },
        { day: 'Miércoles', time: '20:00', venue: 'CAMPO DE M. ARINAGA', note: 'entrenamiento · CHANDAL · 90 MINUTOS' },
        { day: 'Jueves',    time: '20:00', venue: 'CAMPO DE M. ARINAGA', note: 'partido liga · CHANDAL · 90 MINUTOS' },
        { day: 'Viernes',   time: '20:00', venue: 'CAMPO DE M. ARINAGA', note: 'entrenamiento · EQUIP. AZUL · 90 MINUTOS' },
        { day: 'Sábado' },
        { day: 'Domingo' },
    ],
};

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · el motor, EJECUTADO con la semana de la captura ──');
// ───────────────────────────────────────────────────────────────────────────
let motor = null;
try {
    const i = EVENTS.indexOf('function cronosRenderPlanSemanal(d)');
    const j = EVENTS.indexOf('window.cronosRenderPlanSemanal = cronosRenderPlanSemanal;', i);
    if (i < 0 || j < 0) throw new Error('no está cronosRenderPlanSemanal en events-tab.js');
    const sb = { escapeHtml, escapeAttr, String, Array, Date, window: {} };
    vm.createContext(sb);
    vm.runInContext(EVENTS.slice(i, j) + '\nwindow.cronosRenderPlanSemanal = cronosRenderPlanSemanal;', sb);
    motor = sb.window.cronosRenderPlanSemanal;
} catch (e) { console.log('  (' + e.message + ')'); }
ok('1a · `cronosRenderPlanSemanal` existe en events-tab.js y se deja ejecutar', typeof motor === 'function');

const soloMarcado = (h) => String(h).replace(/<style>[\s\S]*?<\/style>/g, '');
const clasesDe = (h, dia) => { const m = String(h).match(new RegExp('class="([^"]*)" data-day="' + dia + '"')); return m ? m[1] : ''; };
if (motor) {
    const h = motor(PLAN);
    ok('1b · una TARJETA por día (7), no renglones', (h.match(/data-day="/g) || []).length === 7);
    ok('1c · en fila con scroll horizontal', /\.wp-week\{display:flex;flex-direction:row;[^}]*overflow-x:auto/.test(h));
    ok('1d · 🔑 los días de partido (amistoso y liga) van en verde, y sólo ellos',
       /wp-day-match/.test(clasesDe(h, 'Martes')) && /wp-day-match/.test(clasesDe(h, 'Jueves')) &&
       (soloMarcado(h).match(/wp-day-match/g) || []).length === 2);
    ok('1e · sábado y domingo, descanso', (soloMarcado(h).match(/_Descanso_/g) || []).length === 2);
    ok('1f · un dato por línea (hora, sitio, tipo, equipación, minutos)',
       /🕐 20:00/.test(h) && /📍 CAMPO DE M. ARINAGA/.test(h) && /📋 partido amistoso/.test(h) &&
       /👕 EQUIP. AZUL/.test(h) && /⏱️ 90 MINUTOS/.test(h));
    ok('1g · cabecera "Semana del 10 de agosto de 2026"', /Semana del 10 de agosto de 2026/.test(h));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · el modal de FAMILIAS, EJECUTADO ──');
// ───────────────────────────────────────────────────────────────────────────
let overlay = null, familiaErr = null, esperar = null;
try {
    const i = PARENT.indexOf('window.ppNotifsByType = async function(type) {');
    if (i < 0) throw new Error('no está ppNotifsByType');
    const j = PARENT.indexOf('\n};', i);
    const bloque = PARENT.slice(i, j + 3).replace(
        /await import\(\s*'https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js'\s*\)/g,
        '__fs');
    const body = { innerHTML: '' };
    const appended = [];
    const fsFake = {
        collection: () => ({}), query: () => ({}), where: () => ({}), doc: () => ({}),
        deleteDoc: async () => {}, updateDoc: async () => {}, arrayUnion: () => ({}),
        getDocs: async () => ({ forEach: (cb) => cb({ id: 'n1', data: () => PLAN }) }),
    };
    const win = { _cronosCurrentUser: { uid: 'p1', clubId: 'club1' }, _cronos_auth: { db: {} } };
    if (motor) win.cronosRenderPlanSemanal = motor;
    const sb = {
        window: win, __fs: fsFake, escapeHtml, escapeAttr, showToast() {}, confirm: () => true,
        console: { log() {}, warn() {}, error() {} }, Promise, Set, Array, Object, String, Date, JSON,
        document: {
            getElementById: (id) => id === 'pp-body' ? body : null,
            createElement: () => ({ style: {}, innerHTML: '', id: '', remove() {} }),
            body: { appendChild: (el) => appended.push(el) },
        },
    };
    vm.createContext(sb);
    vm.runInContext(bloque, sb);
    // Abre la lista de entrenamientos y luego el detalle, como hace la familia.
    esperar = (async () => {
        await win.ppNotifsByType('planificacion_semanal');
        win.ppViewNotifDetail('n1');
        overlay = appended[0] || null;
    })();
} catch (e) { familiaErr = e.message; }

(async () => {
    try { if (esperar) await esperar; } catch (e) { familiaErr = e.message; }
    ok('2a · el modal de Familias se abre (ppViewNotifDetail cuelga su overlay)', !!overlay, familiaErr);
    if (overlay) {
        const h = overlay.innerHTML;
        ok('2b · 🔑 pinta TARJETAS por día (7), no la lista vieja', (h.match(/data-day="/g) || []).length === 7,
           (h.match(/data-day="/g) || []).length);
        ok('2c · 🔑🔑 su bloque de la semana es IDÉNTICO al del motor de Dirección', !!motor && h.includes(motor(PLAN)));
        ok('2d · los partidos en verde también aquí (Martes y Jueves)',
           /wp-day-match/.test(clasesDe(h, 'Martes')) && /wp-day-match/.test(clasesDe(h, 'Jueves')));
        ok('2e · 🔴 ya no sale la lista de renglones ("min-width:80px")', !/min-width:80px/.test(h));
        ok('2f · conserva su marco: PLANIFICACIÓN SEMANAL, "Enviado por" y Cerrar',
           /PLANIFICACIÓN SEMANAL/.test(h) && /Enviado por: arinagazone@gmail.com/.test(h) && /✕ Cerrar/.test(h));
    }

    // ───────────────────────────────────────────────────────────────────────
    console.log('\n── PARTE 3 · un solo motor en toda la aplicación ──');
    // ───────────────────────────────────────────────────────────────────────
    const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    const E = sinCom(EVENTS), P = sinCom(PARENT), W = sinCom(WA);
    ok('3a · Dirección (sdViewEventDetail) llama al motor', /body = cronosRenderPlanSemanal\(d\);/.test(E));
    ok('3b · Familias (ppViewNotifDetail) llama al motor', /window\.cronosRenderPlanSemanal\(d\)/.test(P));
    ok('3c · 🔴 el renderizador muerto `_cronosRenderTrainingWeekCards` ya no existe',
       !/_cronosRenderTrainingWeekCards/.test(W) && !/_cronosRenderTrainingWeekCards/.test(P) && !/_cronosRenderTrainingWeekCards/.test(E));
    ok('3d · 🔴 Familias ya no construye sus propias filas por día (weekPlanHTML)', !/weekPlanHTML/.test(P));
    ok('3e · el CSS de las tarjetas existe UNA sola vez en todo js/',
       (() => { let n = 0; const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
           const p = path.join(d, e.name);
           if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) n += (fs.readFileSync(p, 'utf8').match(/'\.wp-day\{/g) || []).length; });
         walk(path.join(ROOT, 'js')); return n === 1; })());

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '  ❌ ' + fallos + ' FALLOS' : '  ✅'));
    process.exit(fallos ? 1 : 0);
})();
