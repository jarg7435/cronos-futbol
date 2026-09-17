// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v727 · EL CUERPO TÉCNICO VA EN EL BANQUILLO DE MI EQUIPO
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-17, captura 10488 frente a
//  IMG_0590): tras v726 el cuerpo técnico configurado en GESTIONAR PLANTILLA
//  ya no se veía bajo el banquillo del partido.
//
//  🔑 NO ERA LA CARGA DE LA PLANTILLA. `renderStaffInBench` metía la tarjeta
//  SIEMPRE en `#bench-list` (el banquillo LOCAL). Jugando FUERA ese banquillo
//  está oculto y el mío es `#bench-list-away`: la tarjeta se pintaba en un
//  panel invisible. Aflora con v726 porque la jornada del calendario fija la
//  localía sola (la J1 del Regional B se juega fuera).
//
//  Se EJECUTAN `renderStaffInBench` (staff-and-comms.js) y `sortBenchUI`
//  (render.js) contra un DOM de juguete.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}

const STAFF  = leer('js/core/staff-and-comms.js');
const RENDER = leer('js/ui/render.js');
const INDEX  = leer('index.html');

// ── DOM de juguete con contenedores y hijos de verdad ──────────────────────
function montar(rol, staff) {
    const porId = {};
    function nodo(id) {
        const n = {
            id: id || '', children: [], parentNode: null, style: {}, innerHTML: '',
            appendChild(h) {
                if (h.parentNode) h.parentNode.children = h.parentNode.children.filter(c => c !== h);
                h.parentNode = this; this.children.push(h); if (h.id) porId[h.id] = h; return h;
            },
            remove() {
                if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this);
                this.parentNode = null; if (this.id) delete porId[this.id];
            },
        };
        return n;
    }
    porId['bench-list'] = nodo('bench-list');
    porId['bench-list-away'] = nodo('bench-list-away');
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: (id) => porId[id] || null,
            createElement: () => {
                const n = nodo('');
                // el id se asigna después de crearlo
                return new Proxy(n, { set(t, k, v) { t[k] = v; if (k === 'id' && t.parentNode) porId[v] = t; return true; } });
            },
        },
        localStorage: { getItem: (k) => (k === 'cronos_staff' ? JSON.stringify(staff) : null) },
        escapeHtml: (s) => String(s),
        JSON, Object, Array, String,
    };
    sb.window = sb;
    sb._userTeamRole = rol;
    sb.cronosMiLado = () => (sb._userTeamRole === 'away' ? 'away' : 'home');
    vm.createContext(sb);
    vm.runInContext(STAFF.slice(0, STAFF.indexOf('function saveStaffConfig')), sb);
    vm.runInContext(trozo(STAFF, 'function renderStaffInBench()'), sb);
    vm.runInContext(trozo(RENDER, 'function sortBenchUI(team)'), sb);
    sb._porId = porId;
    return sb;
}

const STAFF_OK = { coach1: 'JOSÉ ALBERTO', coach2: 'AGUSTÍN', delegate: 'ROGELIO', fieldDelegate: 'PEDRO' };
const dentro = (sb, id) => sb._porId[id].children.some(c => c.id === 'staff-bench-card');

console.log('\n── PARTE 1 · la tarjeta va a MI banquillo ──');
{
    const sb = montar('home', STAFF_OK);
    vm.runInContext('renderStaffInBench()', sb);
    ok('1a · jugando en CASA, en el banquillo local', dentro(sb, 'bench-list') && !dentro(sb, 'bench-list-away'));
    ok('1b · con los cuatro miembros (1ER visible + «3 más»)',
       /JOSÉ ALBERTO/.test(sb._porId['staff-bench-card'].innerHTML) &&
       /3 más/.test(sb._porId['staff-bench-card'].innerHTML) &&
       /ROGELIO/.test(sb._porId['staff-bench-card'].innerHTML));
}
{
    const sb = montar('away', STAFF_OK);
    vm.runInContext('renderStaffInBench()', sb);
    ok('1c · 🔑 jugando FUERA, en el banquillo VISITANTE (el que se ve)',
       dentro(sb, 'bench-list-away') && !dentro(sb, 'bench-list'));

    // Cambiar de localía entre partidos no deja una tarjeta en cada lado
    sb._userTeamRole = 'home';
    vm.runInContext('renderStaffInBench()', sb);
    ok('1d · al volver a jugar en casa se muda: una sola tarjeta',
       dentro(sb, 'bench-list') && !dentro(sb, 'bench-list-away'));
}
{
    const sb = montar('away', { coach1: '', coach2: '', delegate: '', fieldDelegate: '' });
    vm.runInContext('renderStaffInBench()', sb);
    ok('1e · sin cuerpo técnico no se pinta nada', !dentro(sb, 'bench-list') && !dentro(sb, 'bench-list-away'));
}

console.log('\n── PARTE 2 · el orden del banquillo no la sube por encima ──');
{
    const sb = montar('away', STAFF_OK);
    vm.runInContext('renderStaffInBench()', sb);
    const lista = sb._porId['bench-list-away'];
    // Tres suplentes pintados DESPUÉS de la tarjeta (un cambio en directo)
    [3, 1, 2].forEach(n => {
        const chip = { id: 'player-p' + n, children: [], parentNode: null, style: {} };
        lista.appendChild(chip);
    });
    sb.players = [1, 2, 3].map(n => ({ id: 'p' + n, team: 'away', status: 'bench', benchOrder: n }));
    vm.runInContext('sortBenchUI("away")', sb);
    const ids = lista.children.map(c => c.id);
    ok('2a · tras ordenar, el cuerpo técnico queda el ÚLTIMO',
       ids[ids.length - 1] === 'staff-bench-card', ids.join(','));
    ok('2b · y los suplentes en su orden', ids.slice(0, 3).join(',') === 'player-p1,player-p2,player-p3', ids.join(','));
}

console.log('\n── PARTE 3 · el sitio donde se pinta existe en la página ──');
ok('3a · index.html tiene los dos banquillos',
   INDEX.indexOf('id="bench-list"') > 0 && INDEX.indexOf('id="bench-list-away"') > 0);
ok('3b · renderStaffInBench decide el banquillo con cronosMiLado (una sola definición de «mi lado»)',
   /cronosMiLado\(\)[\s\S]{0,200}'bench-list-away' : 'bench-list'/.test(trozo(STAFF, 'function renderStaffInBench()')));

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);
