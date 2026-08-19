// ─────────────────────────────────────────────────────────────────────────
// test_convocatoria_limite_estricto.js · el limite de convocados BLOQUEA
// de verdad (v506)
//
// Reporte del autor (capturas 8740 y 8741): en un partido de Futbol 7 marca
// por error 15 convocados (el maximo son 14). Salta el aviso de "maximo 14",
// pulsa ACEPTAR... y la app entra al partido igualmente, con el partido ROTO:
// sin equipo visitante y con la estructura mal.
//
// ⚠️ ERA UNA CADENA DE TRES ESLABONES, y el tercero es el que rompia:
//
//   1) La pantalla de convocatoria NO tenia tope: el clic sobre el jugador 15
//      lo marcaba tan tranquilo. El limite de TITULARES si estaba puesto
//      (aviso + `return`), el de CONVOCADOS no existia.
//
//   2) El boton "IR AL PARTIDO" solo miraba `titulares < minTitulares`, asi
//      que con 15 convocados y 7 titulares estaba ACTIVO y se podia pulsar.
//
//   3) 🔑🔑🔑 `goToTitularSelection` SI avisaba y se paraba con un `return`
//      pelado... pero js/core/patches.js la ENVUELVE (§7) y no miraba nada:
//      tras llamar a la original seguia adelante SIEMPRE — quitaba
//      `setup-mode`, ocultaba el modal, mostraba la vista de partido y, al
//      encontrarse `players` vacio (porque la original habia abortado),
//      FABRICABA una plantilla ficticia de "Jugador 1..N" TODOS locales.
//      Ese es exactamente el "partido roto sin visitante" del reporte: no lo
//      creaba la convocatoria invalida, lo creaba el fallback del envoltorio
//      al confundir "aborto" con "arranque sin jugadores".
//
// LO QUE PROTEGE:
//
//  A · BLOQUEO EN ORIGEN: el clic sobre el convocado numero 15 no marca nada
//      y avisa. Es lo que pidio el autor ("impedir seleccionar al jugador 15").
//
//  B · BLOQUEO EN EL BOTON: si el estado invalido llega por otra via (cargar
//      una plantilla guardada con 15), "IR AL PARTIDO" queda DESHABILITADO y
//      se dice POR QUE. Sin esta parte, A sola se saltaria por la puerta de
//      atras.
//
//  C · ⚠️ EL CONVOCADO ATRAPADO. Con los titulares al maximo, el clic sobre un
//      convocado salia por el `return` del aviso y el jugador YA NO SE PODIA
//      QUITAR de la convocatoria: justo la operacion que hace falta para bajar
//      de 15 a 14. Ahora el ciclo avanza y lo retira.
//
//  D · 🔑 EL VEREDICTO VIAJA: `goToTitularSelection` devuelve false al abortar.
//
//  E · 🔑🔑🔑 EL ENVOLTORIO OBEDECE: con false NO fabrica jugadores, NO oculta
//      el modal y NO muestra la vista de partido. Esta es LA asercion del
//      fallo del reporte.
//
//  F · ⚠️ Y NO SE PASA DE FRENADA: con un arranque valido el envoltorio sigue
//      haciendo su trabajo de siempre (vista visible, modal oculto). Un guard
//      que solo mirase E daria verde con la funcion entera desactivada.
//
// ESTE GUARD EJECUTA EL CODIGO REAL en una caja de arena con un DOM de
// juguete: pulsa las filas una a una y llama al envoltorio. Un censo por
// regex veria el `if` y daria verde sin saber si el clic 15 marca o no.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const IMPORT_JS  = fs.readFileSync(path.join(ROOT, 'js', 'ai', 'import.js'), 'utf8');
const PATCHES_JS = fs.readFileSync(path.join(ROOT, 'js', 'core', 'patches.js'), 'utf8');

// Extrae `function NOMBRE(...) { ... }` completa contando llaves.
function extraeFn(src, nombre) {
    const ini = src.indexOf('function ' + nombre + '(');
    if (ini === -1) return null;
    const abre = src.indexOf('{', ini);
    if (abre === -1) return null;
    let n = 0;
    for (let i = abre; i < src.length; i++) {
        if (src[i] === '{') n++;
        else if (src[i] === '}') { n--; if (n === 0) return src.slice(ini, i + 1); }
    }
    return null;
}

console.log('── convocatoria: el limite de convocados bloquea (v506) ──\n');

const SRC_MODAL   = extraeFn(IMPORT_JS, 'openConvocationModal');
const SRC_GOTO    = extraeFn(IMPORT_JS, 'goToTitularSelection');
const SRC_WRAPPER = extraeFn(PATCHES_JS, 'patchGoToTitularSelection');
ok('0 · se pueden extraer las tres piezas',
   !!SRC_MODAL && !!SRC_GOTO && !!SRC_WRAPPER,
   'modal=' + !!SRC_MODAL + ' goto=' + !!SRC_GOTO + ' wrapper=' + !!SRC_WRAPPER);
if (!SRC_MODAL || !SRC_GOTO || !SRC_WRAPPER) process.exit(1);

// ═══════════════════ DOM de juguete ═══════════════════
function nuevoEl(clase) {
    const el = {
        className: clase || '',
        style: {}, dataset: {}, children: [],
        _text: '', _html: '', _hijos: {}, _lst: {},
        classList: {
            _s: new Set(),
            add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
            contains(c) { return this._s.has(c); }
        },
        addEventListener(ev, fn) { (this._lst[ev] = this._lst[ev] || []).push(fn); },
        click() { (this._lst.click || []).forEach(f => f()); },
        querySelector(sel) { return this._hijos[sel] || null; },
        get textContent() { return this._text; },
        set textContent(v) { this._text = String(v); },
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = String(v); if (this._onHtml) this._onHtml(String(v)); }
    };
    return el;
}

function montarPantalla(opts) {
    opts = opts || {};
    const nJugadores = opts.jugadores || 20;
    const avisos = [];
    const porId = {};
    let filas = [];

    const roster = { f7: [], f11: [] };
    for (let i = 0; i < nJugadores; i++) roster.f7.push({ number: i + 1, name: 'Jugador ' + (i + 1) });

    const modal = nuevoEl();
    porId['setup-modal'] = modal;
    // Al pintarse el modal, se crean las filas que anuncia el HTML.
    modal._onHtml = (html) => {
        const n = (html.match(/class="conv-row"/g) || []).length;
        filas = [];
        for (let i = 0; i < n; i++) {
            const fila = nuevoEl('conv-row');
            fila.dataset.index = String(i);
            fila.dataset.state = 'none';
            fila._hijos['.conv-dot'] = nuevoEl('conv-dot');
            fila._hijos['.conv-status-badge'] = nuevoEl('conv-status-badge');
            filas.push(fila);
        }
    };

    const doc = {
        body: nuevoEl(),
        getElementById(id) { if (!porId[id]) porId[id] = nuevoEl(); return porId[id]; },
        querySelectorAll(sel) { return sel.indexOf('conv-row') !== -1 ? filas : []; },
        querySelector(sel) {
            const m = /data-index="(\d+)"/.exec(sel || '');
            return m ? (filas[parseInt(m[1], 10)] || null) : null;
        }
    };

    const almacen = {
        cronos_master_roster: JSON.stringify(roster),
        cronos_conv_data: '{}'
    };

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: doc,
        currentMode: 'f7',
        TEAM_NAMES: { home: 'CD LOCAL', away: 'CD RIVAL' },
        localStorage: {
            getItem: (k) => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); }
        },
        escapeHtml: (s) => String(s == null ? '' : s),
        _cronosLocalDateKey: () => '2026-08-11',
        showToast: (t) => avisos.push(String(t)),
        alert: (t) => avisos.push(String(t)),
        parseInt, JSON, Set, Array, String, Number, Math, Object
    };
    sb.window = { innerWidth: 1200, loadedTeamPlayers: opts.equipoCargado || undefined };
    // v580 · la plantilla pasa a ser DEL EQUIPO y se lee por accesor
    // (`cronosPlantillaAmbas`, js/core/utils.js) en vez de por localStorage.
    // Se estabula leyendo del MISMO almacen de mentira de este arnes, para que
    // los datos que prepara cada caso sigan llegando igual que antes.
    sb.window.cronosPlantillaAmbas = function () {
        try { return JSON.parse(sb.localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}'); }
        catch (e) { return { f7: [], f11: [] }; }
    };

    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(SRC_MODAL + '\nopenConvocationModal();', sb);

    return {
        avisos,
        filas: () => filas,
        // Con fallback: si el elemento no existe siquiera, la asercion debe
        // salir ROJA con su mensaje, no reventar el guard entero.
        boton:  () => porId['btn-go-titulares'] || nuevoEl(),
        motivo: () => porId['conv-invalid-msg'] || nuevoEl(),
        numConvocados: () => parseInt(porId['conv-num-conv'].textContent, 10),
        numTitulares:  () => parseInt(porId['conv-num-tit'].textContent, 10),
        marcados: () => filas.filter(f => f.dataset.state !== 'none').length
    };
}

// ═══ PARTE 1 · el caso del reporte: no se puede marcar al numero 15 ═══
console.log('\n── PARTE 1 · el clic 15 no marca (F-7, maximo 14) ──');
{
    const p = montarPantalla({ jugadores: 20 });

    // Un clic en cada uno de los 20 jugadores de la plantilla.
    p.filas().forEach(f => f.click());

    ok('1a · 🔑 solo quedan 14 marcados de los 20 pulsados',
       p.marcados() === 14, 'marcados=' + p.marcados());
    ok('1b · el contador dice 14, no 15',
       p.numConvocados() === 14, 'contador=' + p.numConvocados());
    ok('1c · el jugador 15 quedo SIN marcar',
       p.filas()[14].dataset.state === 'none', p.filas()[14].dataset.state);
    ok('1d · y no se queda mudo: avisa del maximo',
       p.avisos.length > 0 && /14/.test(p.avisos.join(' | ')),
       p.avisos.slice(0, 2).join(' | '));
}

// ═══ PARTE 2 · el boton bloqueado cuando el estado invalido entra por otra via ═══
console.log('\n── PARTE 2 · IR AL PARTIDO deshabilitado si la convocatoria no vale ──');
{
    // Plantilla guardada con 15: 7 titulares + 8 suplentes. Esta puerta NO
    // pasa por el clic, asi que el tope del handler no la ve.
    const guardados = [];
    for (let i = 0; i < 15; i++) guardados.push({ number: i + 1, status: i < 7 ? 'field' : 'bench' });
    const p = montarPantalla({ jugadores: 20, equipoCargado: { home: guardados } });

    ok('2a · el estado de partida es el del reporte: 15 convocados',
       p.numConvocados() === 15, 'convocados=' + p.numConvocados());
    ok('2b · 🔑 IR AL PARTIDO esta DESHABILITADO (antes se podia pulsar)',
       p.boton().disabled === true, 'disabled=' + p.boton().disabled);
    ok('2c · y se dice POR QUE, visible',
       /14/.test(p.motivo().textContent) && p.motivo().style.display === 'block',
       JSON.stringify(p.motivo().textContent) + ' display=' + p.motivo().style.display);

    // Contraprueba: 14 convocados con 7 titulares SI deja pasar.
    const buenos = [];
    for (let i = 0; i < 14; i++) buenos.push({ number: i + 1, status: i < 7 ? 'field' : 'bench' });
    const q = montarPantalla({ jugadores: 20, equipoCargado: { home: buenos } });
    ok('2d · ⚠️ y con 14 convocados y 7 titulares el boton SI se habilita',
       q.boton().disabled === false,
       'disabled=' + q.boton().disabled + ' motivo=' + JSON.stringify(q.motivo().textContent));
}

// ═══ PARTE 3 · el convocado no se queda atrapado ═══
console.log('\n── PARTE 3 · con los titulares al maximo, un convocado se puede QUITAR ──');
{
    const p = montarPantalla({ jugadores: 20 });
    const f = p.filas();
    // 7 titulares (dos clics) + 3 convocados (un clic).
    for (let i = 0; i < 7; i++) { f[i].click(); f[i].click(); }
    for (let i = 7; i < 10; i++) f[i].click();

    ok('3a · punto de partida: 7 titulares y 10 convocados',
       p.numTitulares() === 7 && p.numConvocados() === 10,
       'tit=' + p.numTitulares() + ' conv=' + p.numConvocados());

    // Con los titulares al tope, el clic sobre un convocado ya no puede
    // promocionar; antes salia por el `return` y el jugador era INQUITABLE.
    f[9].click();
    ok('3b · 🔑 el convocado se RETIRA en vez de quedarse atrapado',
       f[9].dataset.state === 'none' && p.numConvocados() === 9,
       'estado=' + f[9].dataset.state + ' conv=' + p.numConvocados());
    ok('3c · y los titulares no se descuentan por error',
       p.numTitulares() === 7, 'tit=' + p.numTitulares());
}

// ═══ PARTE 4 · goToTitularSelection devuelve false al abortar ═══
console.log('\n── PARTE 4 · el veredicto viaja (false = no hay partido) ──');

function montarGoto(nConvocados, nTitulares) {
    const avisos = [];
    const roster = { f7: [], f11: [] };
    for (let i = 0; i < 20; i++) roster.f7.push({ number: i + 1, name: 'Jugador ' + (i + 1) });

    const filas = [];
    for (let i = 0; i < nConvocados; i++) {
        const fila = nuevoEl('conv-row');
        fila.dataset.index = String(i);
        fila.dataset.state = i < nTitulares ? 'titular' : 'convocado';
        filas.push(fila);
    }
    let arrancado = false;
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        currentMode: 'f7',
        document: {
            body: nuevoEl(),
            getElementById: () => nuevoEl(),
            querySelectorAll: (sel) => (sel.indexOf('conv-row') !== -1 ? filas : [])
        },
        localStorage: {
            getItem: (k) => (k === 'cronos_master_roster' ? JSON.stringify(roster) : '{}'),
            setItem: () => {}
        },
        alert: (t) => avisos.push(String(t)),
        saveConvData: () => ({}),
        saveConvPlayers: () => {},
        // Si el aborto fallase, el flujo llegaria hasta aqui.
        spawnInitialPlayers: () => { arrancado = true; throw new Error('no deberia arrancar'); },
        parseInt, JSON, Array, String, Number, Object
    };
    sb.window = { _titularSelectionOrder: [] };
    // v580 · la plantilla pasa a ser DEL EQUIPO y se lee por accesor
    // (`cronosPlantillaAmbas`, js/core/utils.js) en vez de por localStorage.
    // Se estabula leyendo del MISMO almacen de mentira de este arnes, para que
    // los datos que prepara cada caso sigan llegando igual que antes.
    sb.window.cronosPlantillaAmbas = function () {
        try { return JSON.parse(sb.localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}'); }
        catch (e) { return { f7: [], f11: [] }; }
    };

    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(SRC_GOTO, sb);
    let r;
    try { r = sb.goToTitularSelection(); } catch (e) { r = '<lanzo: ' + e.message + '>'; }
    return { r, avisos, arrancado: () => arrancado };
}
{
    const exceso = montarGoto(15, 7);
    ok('4a · 🔑 con 15 convocados devuelve false',
       exceso.r === false, 'devolvio ' + JSON.stringify(exceso.r));
    ok('4b · y no llega a arrancar nada',
       exceso.arrancado() === false);
    ok('4c · avisa del maximo',
       /14/.test(exceso.avisos.join(' | ')), exceso.avisos.join(' | '));

    const pocos = montarGoto(10, 3);
    ok('4d · con 3 titulares (min 5) tambien devuelve false',
       pocos.r === false, 'devolvio ' + JSON.stringify(pocos.r));

    const sobran = montarGoto(12, 9);
    ok('4e · con 9 titulares (max 7) tambien devuelve false',
       sobran.r === false, 'devolvio ' + JSON.stringify(sobran.r));
}

// ═══ PARTE 5 · el envoltorio de patches.js OBEDECE el aborto ═══
console.log('\n── PARTE 5 · el envoltorio no fabrica un partido de mentira ──');

function montarEnvoltorio(veredicto) {
    const modal = nuevoEl();
    modal.style.display = 'flex';
    modal.children = [nuevoEl()];          // el modal tiene contenido
    const header = nuevoEl();  header.style.display = 'none';
    const cont   = nuevoEl();  cont.style.display   = 'none';
    const porId = { 'setup-modal': modal, 'main-header': header, 'main-container': cont };

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            body: nuevoEl(),
            getElementById: (id) => porId[id] || nuevoEl()
        },
        setTimeout: () => {},
        players: [],                        // sin jugadores: el terreno del fallback
        currentMode: 'f7',
        COLORS: { home: { primary: '#fff', shorts: '#fff', text: '#000' } },
        renderPlayers: () => {},
        goToTitularSelection: function () { return veredicto; },
        parseInt, Array, String, Number, Object
    };
    sb.window = {};
    // v580 · la plantilla pasa a ser DEL EQUIPO y se lee por accesor
    // (`cronosPlantillaAmbas`, js/core/utils.js) en vez de por localStorage.
    // Se estabula leyendo del MISMO almacen de mentira de este arnes, para que
    // los datos que prepara cada caso sigan llegando igual que antes.
    sb.window.cronosPlantillaAmbas = function () {
        try { return JSON.parse(sb.localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}'); }
        catch (e) { return { f7: [], f11: [] }; }
    };

    sb.globalThis = sb;
    vm.createContext(sb);
    vm.runInContext(SRC_WRAPPER + '\npatchGoToTitularSelection();', sb);

    sb.document.body.classList.add('setup-mode');
    const r = sb.window.goToTitularSelection();
    return { r, players: sb.players, modal, header, body: sb.document.body };
}
{
    const abortado = montarEnvoltorio(false);
    ok('5a · 🔑🔑🔑 con false NO fabrica jugadores ficticios (el bug del reporte)',
       abortado.players.length === 0, 'players=' + abortado.players.length);
    ok('5b · el modal de convocatoria sigue en pantalla',
       abortado.modal.style.display === 'flex', abortado.modal.style.display);
    ok('5c · NO se muestra la vista de partido',
       abortado.header.style.display !== 'flex', abortado.header.style.display);
    ok('5d · y se conserva setup-mode',
       abortado.body.classList.contains('setup-mode') === true);
    ok('5e · el envoltorio propaga el false',
       abortado.r === false, JSON.stringify(abortado.r));

    // ⚠️ Contraprueba: el envoltorio NO puede quedarse inerte.
    const arrancado = montarEnvoltorio(true);
    ok('5f · ⚠️ con un arranque valido el envoltorio SIGUE trabajando: vista visible',
       arrancado.header.style.display === 'flex', arrancado.header.style.display);
    ok('5g · ⚠️ ...y oculta el modal',
       arrancado.modal.style.display === 'none', arrancado.modal.style.display);
    ok('5h · ⚠️ ...y su fallback de jugadores sigue vivo cuando SI hay partido',
       arrancado.players.length === 7, 'players=' + arrancado.players.length);
}

console.log('\n' + (fail === 0 ? 'TODO OK' : 'FALLOS: ' + fail) + ' (pass=' + pass + ')');
process.exit(fail === 0 ? 0 : 1);
