// ─────────────────────────────────────────────────────────────────────────
// test_asistencia_directo_v843.js · 📡 LA ASISTENCIA, EN DIRECTO PARA
// DIRECCIÓN (v843)
//
// Encargo del autor (implementar.txt 2026-10-27, capturas 11743-11745): el
// entrenador pasó lista del 5/10 y el Director, con la pantalla abierta, seguía
// viendo la columna vacía. La pestaña hacía UN getDocs al abrirse y el parte
// pintaba esa foto.
//
// LO QUE PROTEGE:
//  A · al abrir la pestaña se escucha la MISMA consulta (month == mes).
//  B · el primer aviso (la misma foto) no repinta; uno con marcas nuevas, sí,
//      sin volver a leer cuadrante ni plantillas.
//  C · con el parte de un equipo abierto, se repinta EL PARTE con la marca
//      nueva y sin releer el cuadrante.
//  D · fuera de la asistencia la escucha se suelta (aviso a destiempo, cambio
//      de pestaña, cambio de mes).
//  E · el entrenador sigue escribiendo cada toque al momento (sin cola).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (n, c, x) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (x !== undefined) console.log('       ' + String(x).slice(0, 400)); }
};
const espera = (ms) => new Promise(r => setTimeout(r, ms));

const SRC_UTILS = fs.readFileSync(path.join(ROOT, 'js/core/utils.js'), 'utf8');
const SRC_TREE  = fs.readFileSync(path.join(ROOT, 'js/admin/shared/category-tree.js'), 'utf8');
const SRC_ATT   = fs.readFileSync(path.join(ROOT, 'js/coach/attendance/attendance-store.js'), 'utf8');
const SRC_CR    = fs.readFileSync(path.join(ROOT, 'js/coach/reports/club-reports.js'), 'utf8');

function montar() {
    const win = {};
    const contenedor = {
        innerHTML: '', scrollTop: 0,
        querySelector(sel) {
            if (sel === '[data-sd-asist]') return this.innerHTML.indexOf('data-sd-asist') >= 0 ? {} : null;
            if (sel === '[data-sd-parte]') return this.innerHTML.indexOf('data-sd-parte') >= 0 ? {} : null;
            return null;
        },
        querySelectorAll() { return []; },
    };
    const ctx = {
        window: win,
        console: { log(){}, warn(){}, error(){}, debug(){} },
        setTimeout, clearTimeout, Promise, Date, JSON, Object, Array, String,
        Number, Boolean, Math, RegExp, isNaN, isFinite, parseInt, parseFloat, Error, Map, Set, Intl,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        document: { getElementById: (id) => (id === 'staff-dashboard-content' ? contenedor : null),
                    querySelectorAll: () => [], addEventListener: () => {} },
        navigator: { userAgent: 'node' }, innerWidth: 1400,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC_UTILS, ctx);
    vm.runInContext(SRC_TREE, ctx);
    // attendance-store se registra en `window` (= win en el navegador).
    vm.runInContext('(function(window){' + SRC_ATT + '\n})(this.window);', ctx);

    const hoy = new Date();
    const hoyKey = win._cronosLocalDateKey(hoy);
    const mes = hoyKey.slice(0, 7);
    const CLUB = 'club_x';
    const tid = win.cronosTeamId(CLUB, 'regional', 'B');

    const parte = {
        clubId: CLUB, teamId: tid, month: mes, category: 'regional', subcategory: 'B',
        sessions: { [hoyKey]: { tipo: 'entrenamiento', hora: '20:00' } },
        marks: { [hoyKey]: { RGB01: { s: 'P' }, RGB02: { s: 'P' } } },
    };
    const lecturas = { getDocs: 0, getDoc: 0, rosters: 0 };

    win._cronosCurrentUser = { uid: 'dir', clubId: CLUB, role: 'director' };
    win.cronosFetchAllTeamRosters = async () => {
        lecturas.rosters++;
        return { 'regional|B': [{ ficha: 'RGB01', dorsal: '1', nombre: 'OMAR' },
                                { ficha: 'RGB02', dorsal: '2', nombre: 'TRUJILLO' },
                                { ficha: 'RGB03', dorsal: '3', nombre: 'DAVID' }] };
    };
    win._cronosTeamRosterLabel = () => 'Regional B';

    // La escucha: se captura para disparar avisos a mano.
    const esc = { abiertas: 0, bajas: 0, ult: null, query: null };
    win.cronosEscuchaConsultaClub = (clave, construir, cb) => {
        esc.abiertas++;
        esc.ult = { clave, cb };
        esc.query = construir({
            db: {}, collection: (_db, ...p) => ({ p: p.join('/') }),
            where: (c, op, v) => ({ c, op, v }), query: (col, w) => ({ col, w }),
        });
        return () => { esc.bajas++; if (esc.ult && esc.ult.clave === clave) esc.ult = null; };
    };
    win.cronosEscuchasClubAbiertas = () => (esc.ult ? ['q:' + esc.ult.clave] : []);

    vm.runInContext(SRC_CR, ctx);
    // En el navegador `window` ES el global; aquí se enlazan a mano.
    ['_sdAbrirParteMensual', '_sdSoltarAsistencia', 'CronosAttendance'].forEach(k => { ctx[k] = win[k]; });

    ctx._sdFS = async () => ({
        db: {},
        collection: (_db, ...p) => ({ p: p.join('/') }),
        query: (c) => c, where: () => ({}),
        getDocs: async () => { lecturas.getDocs++; return { forEach: (cb) => [parte].forEach(x => cb({ data: () => x })) }; },
        doc: (_db, ...p) => ({ p: p.join('/') }),
        getDoc: async () => { lecturas.getDoc++; return { exists: () => false, data: () => ({}) }; },
    });
    win._sdAsistMes = mes;
    return { ctx, win, contenedor, esc, lecturas, parte, hoyKey, mes, tid, CLUB };
}

(async () => {

// ── A · se abre la escucha correcta ─────────────────────────────────
console.log('\nA · al abrir la pestaña se escucha la consulta del mes');
const M = montar();
await M.ctx._sdLoadAsistencia();
ok('A1 · el árbol se pinta con su marca de pantalla', M.contenedor.innerHTML.indexOf('data-sd-asist') >= 0);
ok('A2 · se abre UNA escucha', M.esc.abiertas === 1, M.esc.abiertas);
ok('A3 · de la colección de asistencia del club', M.esc.query && M.esc.query.col.p === 'clubs/' + M.CLUB + '/attendance', JSON.stringify(M.esc.query));
ok('A4 · filtrada por el mes que se mira (mismas reglas que getDocs)',
   M.esc.query && M.esc.query.w.c === 'month' && M.esc.query.w.op === '==' && M.esc.query.w.v === M.mes);
await M.ctx._sdLoadAsistencia();
ok('A5 · recargar la pestaña NO abre una segunda escucha', M.esc.abiertas === 1, M.esc.abiertas);

// ── B · el árbol se repinta con lo nuevo ────────────────────────────
console.log('\nB · el árbol se repinta con las marcas nuevas');
const antes = M.contenedor.innerHTML;
const leidas = JSON.stringify(M.lecturas);
M.esc.ult.cb([Object.assign({ _id: 'x' }, M.parte)]);
await espera(450);
ok('B1 · el primer aviso (la misma foto) no repinta', M.contenedor.innerHTML === antes);
const nuevo = JSON.parse(JSON.stringify(M.parte));
nuevo.marks[M.hoyKey].RGB03 = { s: 'I' };
M.esc.ult.cb([Object.assign({ _id: 'x' }, nuevo)]);
ok('B2 · no repinta en el acto (espera a que acabe la ráfaga)', M.contenedor.innerHTML === antes);
await espera(450);
ok('B3 · 🔑 tras el aviso, el árbol pasa del 100 % al 67 % (2 de 3)',
   /100%/.test(antes) && !/67%/.test(antes) && /67%/.test(M.contenedor.innerHTML),
   (M.contenedor.innerHTML.match(/.{0,60}%.{0,10}/) || [''])[0]);
ok('B4 · sin releer asistencia, cuadrante ni plantillas', JSON.stringify(M.lecturas) === leidas, JSON.stringify(M.lecturas));
ok('B5 · `_sdAsistDatos` queda al día para abrir el parte', M.win._sdAsistDatos.equipos[M.tid].doc.marks[M.hoyKey].RGB03.s === 'I');

// ── C · el parte abierto se repinta ─────────────────────────────────
console.log('\nC · con el parte de un equipo abierto');
M.win._sdAbrirParteMensual(M.tid);
await espera(50);
ok('C1 · el parte está en pantalla', M.contenedor.innerHTML.indexOf('data-sd-parte') >= 0);
const parteAntes = M.contenedor.innerHTML;
const lecturasParte = M.lecturas.getDoc;
const otro = JSON.parse(JSON.stringify(nuevo));
otro.marks[M.hoyKey].RGB02 = { s: 'R', m: 'estudios' };
M.esc.ult.cb([Object.assign({ _id: 'x' }, otro)]);
await espera(450);
ok('C2 · 🔑 el parte se repinta solo con la marca nueva', M.contenedor.innerHTML !== parteAntes &&
   M.contenedor.innerHTML.indexOf('data-sd-parte') >= 0);
ok('C3 · y aparece el retraso con su causa', /Estudios/.test(M.contenedor.innerHTML));
ok('C4 · sin releer el cuadrante del mes', M.lecturas.getDoc === lecturasParte, M.lecturas.getDoc + ' vs ' + lecturasParte);

// ── D · se suelta fuera de la asistencia ────────────────────────────
console.log('\nD · la escucha se suelta cuando ya no se mira');
M.contenedor.innerHTML = '<div>Mensajes</div>';
const bajasAntes = M.esc.bajas;
M.esc.ult.cb([Object.assign({ _id: 'x' }, M.parte)]);
ok('D1 · un aviso con otra pestaña en pantalla suelta la escucha', M.esc.bajas === bajasAntes + 1);
ok('D2 · switchStaffTab la suelta al cambiar de pestaña',
   /if \(tab !== 'asistencia' && typeof window\._sdSoltarAsistencia === 'function'\) window\._sdSoltarAsistencia\(\);/.test(SRC_CR));
{
    const N = montar();
    await N.ctx._sdLoadAsistencia();
    const clave1 = N.esc.ult.clave;
    await N.win._sdCambiarMesAsist(1);
    ok('D3 · cambiar de mes cierra la del anterior y abre la del nuevo',
       N.esc.bajas === 1 && N.esc.abiertas === 2 && N.esc.ult.clave !== clave1, JSON.stringify(N.esc));
}

// ── E · el entrenador escribe al momento ────────────────────────────
console.log('\nE · el entrenador escribe cada toque al momento');
const cuerpoMarcar = SRC_ATT.slice(SRC_ATT.indexOf('function marcar('), SRC_ATT.indexOf('async function _subirMarca('));
ok('E1 · marcar() sube la marca en el acto, sin temporizador', /\n\s*_subirMarca\(eq, id, mes, fecha, ficha, marca, sesion\);/.test(cuerpoMarcar) &&
   !/setTimeout/.test(cuerpoMarcar.replace(/_programarPublicacion[^\n]*/g, '')));
ok('E2 · con updateDoc de ruta punteada (no reescribe el mes entero)',
   /patch\['marks\.' \+ fecha \+ '\.' \+ ficha\] = marca;/.test(SRC_ATT) && /await mod\.updateDoc\(ref, patch\);/.test(SRC_ATT));

console.log('\n' + (fail === 0 ? 'OK' : 'FALLOS') + ': ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);

})().catch(e => { console.error('EXCEPCIÓN:', e && e.stack || e); process.exit(1); });
