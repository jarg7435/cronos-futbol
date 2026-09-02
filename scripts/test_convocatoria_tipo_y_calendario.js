// ─────────────────────────────────────────────────────────────────────────
// test_convocatoria_tipo_y_calendario.js · el TIPO DE PARTIDO gobierna la
// pantalla de Convocatoria, y en LIGA se lee el calendario oficial (v666)
//
// Encargo del autor (implementar.txt, 2026-09-02): que la Convocatoria previa
// al partido funcione «igual que en el módulo de informes manuales».
//   · El selector de Tipo de partido, ARRIBA de los datos del partido.
//   · En LIGA, desplegable con los partidos del calendario oficial importado;
//     al elegir uno se autocompletan rival, campo, hora y jornada.
//   · En AMISTOSO, campos libres.
//   · Y los CUPOS normativos según el tipo.
//
// ⚠️ ESTA ES LA PANTALLA DEL PARTIDO EN DIRECTO, la que arregló v506. Por eso
//    este guard EJECUTA `openConvocationModal` en una caja de arena con un DOM
//    de juguete —mismo arnés que test_convocatoria_limite_estricto.js— en vez
//    de mirar el fichero con expresiones regulares: lo que importa no es que
//    el código esté escrito, sino que al pulsar pase lo que tiene que pasar.
//
// 🔑 Y COMPRUEBA QUE NO HAY TABLA NUEVA: los cupos tienen que salir de
//    `cronosCupoConvocatoria` (js/core/utils.js), la definición única que
//    estrenó v660. Los números 14/18 y 7/11 ya estaban escritos en línea en
//    cuatro sitios del repositorio; este era el momento de no añadir un quinto.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       → ' + extra); }
};

const IMPORT_JS = fs.readFileSync(path.join(ROOT, 'js', 'ai', 'import.js'), 'utf8');
const UTILS_JS  = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');

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

console.log('── convocatoria: tipo de partido y calendario oficial (v666) ──\n');

const SRC_MODAL = extraeFn(IMPORT_JS, 'openConvocationModal');
const SRC_SAVE  = extraeFn(IMPORT_JS, 'saveConvData');
const SRC_CUPO  = extraeFn(UTILS_JS,  'cronosCupoConvocatoria');
ok('0a · se pueden extraer las piezas del producto',
   !!SRC_MODAL && !!SRC_SAVE && !!SRC_CUPO,
   'modal=' + !!SRC_MODAL + ' save=' + !!SRC_SAVE + ' cupo=' + !!SRC_CUPO);
if (!SRC_MODAL || !SRC_SAVE || !SRC_CUPO) process.exit(1);

// ═══════════════════ DOM de juguete ═══════════════════
function nuevoEl(clase) {
    return {
        className: clase || '', style: {}, dataset: {}, value: '', disabled: false,
        _text: '', _html: '', _hijos: {}, _lst: {},
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                     contains(c) { return this._s.has(c); } },
        addEventListener(ev, fn) { (this._lst[ev] = this._lst[ev] || []).push(fn); },
        click() { (this._lst.click || []).forEach(f => f()); },
        querySelector(sel) { return this._hijos[sel] || null; },
        get textContent() { return this._text; },
        set textContent(v) { this._text = String(v); },
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = String(v); if (this._onHtml) this._onHtml(String(v)); },
    };
}

// Los tres primeros partidos REALES del Alevín C del CD DÍA, leídos de
// producción por REST el 2026-09-02. Un fixture inventado no habría probado
// que los campos del calendario se llaman como se llaman.
const CALENDARIO = [
    { fecha: '2026-09-12', jornada: 1, hora: '11:00', rival: 'Maspalomas',   local: true,  sede: 'Cru. Arinaga' },
    { fecha: '2026-09-18', jornada: 2, hora: '21:00', rival: 'AD Huracán B', local: false, sede: 'Pepe Gonçalvez' },
    { fecha: '2026-09-26', jornada: 3, hora: '11:00', rival: 'San Fernando', local: true,  sede: 'Cru. Arinaga' },
];

function montarPantalla(opts) {
    opts = opts || {};
    const avisos = [];
    const porId = {};
    let filas = [];

    const roster = { f7: [], f11: [] };
    for (let i = 0; i < (opts.jugadores || 20); i++) roster.f7.push({ number: i + 1, name: 'Jugador ' + (i + 1) });

    const modal = nuevoEl();
    porId['setup-modal'] = modal;
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
        },
    };

    const almacen = { cronos_conv_data: JSON.stringify(opts.guardado || {}) };

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: doc,
        currentMode: opts.modo || 'f7',
        TEAM_NAMES: { home: 'CD LOCAL', away: 'CD RIVAL' },
        localStorage: {
            getItem: (k) => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); },
        },
        escapeHtml: (s) => String(s == null ? '' : s),
        escapeAttr: (s) => String(s == null ? '' : s),
        _cronosLocalDateKey: () => '2026-09-02',
        showToast: (t) => avisos.push(String(t)),
        alert: (t) => avisos.push(String(t)),
        parseInt, parseFloat, isFinite, JSON, Set, Map, Array, String, Number, Math, Object,
        Promise, Boolean, Date, RegExp, Error, setTimeout,
    };
    sb.window = { innerWidth: 1200 };
    sb.window.cronosPlantillaAmbas = () => roster;
    sb.window.cronosMyTeam = () => (opts.sinEquipo ? null : {
        clubId: 'club_mqvr9m11_g9kj', category: 'alevin', subcategory: 'C',
        teamId: 'club-mqvr9m11-g9kj__alevin__c',
    });
    // 🔑 EL CALENDARIO SE PIDE POR LA FUNCIÓN REAL DEL PROYECTO. Aquí se
    //    estabula para no tocar la red, pero se anota con qué la llaman: si el
    //    día de mañana se pidiera con otra clave, esto lo vería.
    let pedidoCon = null;
    sb.window.calPartidosDeEquipo = (clubId, filaId) => {
        pedidoCon = { clubId, filaId };
        return Promise.resolve(opts.sinCalendario ? [] : CALENDARIO.slice());
    };
    sb.globalThis = sb;

    vm.createContext(sb);
    // La regla de cupos: se carga LA DE VERDAD, extraída de utils.js.
    vm.runInContext(SRC_CUPO + '\nwindow.cronosCupoConvocatoria = cronosCupoConvocatoria;', sb);
    vm.runInContext(SRC_MODAL + '\n' + SRC_SAVE + '\nopenConvocationModal();', sb);

    return {
        sb, avisos, porId,
        filas: () => filas,
        html: () => modal.innerHTML,
        el: (id) => porId[id] || nuevoEl(),
        pedidoCon: () => pedidoCon,
        marcados: () => filas.filter(f => f.dataset.state !== 'none').length,
        numConvocados: () => parseInt(porId['conv-num-conv'].textContent, 10),
        // Espera a que termine la carga asíncrona del calendario.
        esperar: () => new Promise(r => setTimeout(r, 0)),
    };
}

// ═══ PARTE 1 · el TIPO va lo primero, y el bloque tiene sus piezas ═══
console.log('\n── PARTE 1 · el tipo de partido, arriba del todo ──');
{
    const p = montarPantalla({});
    const h = p.html();
    const posTipo   = h.indexOf('id="conv-type"');
    const posFecha  = h.indexOf('id="conv-date"');
    const posRival  = h.indexOf('id="conv-rival"');
    const posCal    = h.indexOf('id="conv-cal-box"');

    ok('1a · presencia: el bloque pinta tipo, fecha y rival',
       posTipo !== -1 && posFecha !== -1 && posRival !== -1,
       'tipo=' + posTipo + ' fecha=' + posFecha + ' rival=' + posRival);
    // 🔑 LO QUE PIDIÓ TEXTUALMENTE: «debe estar arriba en los datos del partido».
    ok('1b · 🔑 el TIPO se pinta ANTES que la fecha', posTipo < posFecha);
    ok('1c · 🔑 y antes que el rival',                posTipo < posRival);
    ok('1d · hay hueco para el calendario oficial, y antes de los campos',
       posCal !== -1 && posCal < posFecha);
    ok('1e · existe el campo de jornada',   h.indexOf('id="conv-jornada"') !== -1);
    ok('1f · el tipo reacciona al cambiarlo', /id="conv-type"[^>]*onchange="_convCambiarTipo\(\)"/.test(h));
}

// ═══ PARTE 2 · los CUPOS salen de la regla única y cambian con el tipo ═══
console.log('\n── PARTE 2 · los cupos normativos, según el tipo ──');
{
    // LIGA en Fútbol 7 → 14 convocados. El clic 15 no marca (lo de v506).
    const p = montarPantalla({ guardado: { type: 'liga' } });
    p.filas().forEach(f => f.click());
    ok('2a · 🏆 LIGA F7: sólo quedan 14 marcados de los 20 pulsados',
       p.marcados() === 14, 'marcados=' + p.marcados());
    ok('2b · y el contador lo dice',
       /de 14 max/.test(p.el('conv-max-conv').textContent), p.el('conv-max-conv').textContent);
    ok('2c · con el tope de 7 titulares',
       /max 7/.test(p.el('conv-max-tit').textContent), p.el('conv-max-tit').textContent);
}
{
    // 🤝 AMISTOSO → convocatoria ABIERTA. Es el caso que hasta v665 NO existía
    //    en esta pantalla: aplicaba 14/18 siempre, sin distinguir.
    const p = montarPantalla({ guardado: { type: 'amistoso' } });
    p.filas().forEach(f => f.click());
    ok('2d · 🤝 AMISTOSO: se pueden convocar los 20, sin tope',
       p.marcados() === 20, 'marcados=' + p.marcados());
    ok('2e · y el contador dice «sin tope», no un número',
       /sin tope/.test(p.el('conv-max-conv').textContent), p.el('conv-max-conv').textContent);
    // 🚨 LA MITAD QUE NO SE RELAJA: en el campo hay siete.
    ok('2f · 🚨 pero el tope de TITULARES se mantiene en 7',
       /max 7/.test(p.el('conv-max-tit').textContent), p.el('conv-max-tit').textContent);
}
{
    // 🏅 COPA lleva acta como la liga → mismo cupo.
    const p = montarPantalla({ guardado: { type: 'copa' } });
    p.filas().forEach(f => f.click());
    ok('2g · 🏅 COPA: cupo de competición oficial, como la liga',
       p.marcados() === 14, 'marcados=' + p.marcados());
}
{
    // F11 en liga → 18 y 11.
    const roster11 = { jugadores: 25, modo: 'f11', guardado: { type: 'liga' } };
    const p = montarPantalla(roster11);
    ok('2h · 🏆 LIGA F11: el contador dice 18',
       /de 18 max/.test(p.el('conv-max-conv').textContent), p.el('conv-max-conv').textContent);
    ok('2i · y 11 titulares',
       /max 11/.test(p.el('conv-max-tit').textContent), p.el('conv-max-tit').textContent);
}
{
    // ⚠️ Cambiar el tipo EN CALIENTE tiene que recalcular el cupo.
    const p = montarPantalla({ guardado: { type: 'liga' } });
    ok('2j · parte de LIGA', /de 14 max/.test(p.el('conv-max-conv').textContent));
    p.el('conv-type').value = 'amistoso';
    p.sb.window._convCambiarTipo();
    ok('2k · 🔑 al pasar a AMISTOSO el cupo se abre EN CALIENTE',
       /sin tope/.test(p.el('conv-max-conv').textContent), p.el('conv-max-conv').textContent);
    p.el('conv-type').value = 'liga';
    p.sb.window._convCambiarTipo();
    ok('2l · y al volver a LIGA se vuelve a cerrar',
       /de 14 max/.test(p.el('conv-max-conv').textContent), p.el('conv-max-conv').textContent);
}

// ═══ PARTE 3 · el calendario oficial ═══
console.log('\n── PARTE 3 · el calendario oficial en LIGA ──');
(async () => {
    {
        const p = montarPantalla({ guardado: { type: 'liga' } });
        await p.esperar();

        // 🔑 Se pide con la MISMA clave que usa el cuadrante: cronosTeamId().
        ok('3a · 🔑 el calendario se pide por clubId + teamId del equipo',
           p.pedidoCon() && p.pedidoCon().clubId === 'club_mqvr9m11_g9kj' &&
           p.pedidoCon().filaId === 'club-mqvr9m11-g9kj__alevin__c',
           JSON.stringify(p.pedidoCon()));

        const caja = p.el('conv-cal-box');
        ok('3b · se pinta el desplegable con los partidos',
           caja.innerHTML.indexOf('id="conv-cal"') !== -1);
        ok('3c · con los tres del calendario y la opción a mano',
           (caja.innerHTML.match(/<option /g) || []).length === 4,
           (caja.innerHTML.match(/<option /g) || []).length + ' opciones');
        ok('3d · 📅 se dice cuántos partidos trae',
           /3 partidos<\/strong>/.test(caja.innerHTML));
        ok('3e · la localía se marca con 🏠 y ✈️',
           /🏠 Maspalomas/.test(caja.innerHTML) && /✈️ AD Huracán B/.test(caja.innerHTML));
        ok('3f · en LIGA la caja del calendario está visible',
           caja.style.display !== 'none', 'display=' + caja.style.display);

        // 🔑🔑 EL AUTOCOMPLETADO, que es el encargo.
        p.sb.window._convElegirPartidoCal('0');
        ok('3g · 🔑 al elegir un partido se autocompleta el RIVAL',
           p.el('conv-rival').value === 'Maspalomas', p.el('conv-rival').value);
        ok('3h · 🔑 …el CAMPO',    p.el('conv-venue').value === 'Cru. Arinaga', p.el('conv-venue').value);
        ok('3i · 🔑 …la HORA',     p.el('conv-time').value === '11:00', p.el('conv-time').value);
        ok('3j · 🔑 …la JORNADA',  p.el('conv-jornada').value === '1', p.el('conv-jornada').value);
        ok('3k · …y la FECHA',     p.el('conv-date').value === '2026-09-12', p.el('conv-date').value);
        ok('3l · y se dice la localía que marca el calendario',
           p.avisos.some(a => /Maspalomas/.test(a) && /casa/.test(a)), p.avisos.join(' | '));

        // ⚠️ «A mano» NO puede borrar lo que el entrenador haya escrito.
        p.el('conv-rival').value = 'ESCRITO A MANO';
        p.sb.window._convElegirPartidoCal('-1');
        ok('3m · ⚠️ volver a «a mano» no borra lo escrito',
           p.el('conv-rival').value === 'ESCRITO A MANO', p.el('conv-rival').value);
    }
    {
        // 🤝 En amistoso NO se ofrece el calendario de liga.
        const p = montarPantalla({ guardado: { type: 'amistoso' } });
        await p.esperar();
        ok('3n · 🤝 en AMISTOSO la caja del calendario queda oculta',
           p.el('conv-cal-box').style.display === 'none',
           'display=' + p.el('conv-cal-box').style.display);
        ok('3o · 🤝 y la jornada tampoco se pregunta',
           p.el('conv-jornada-box').style.display === 'none',
           'display=' + p.el('conv-jornada-box').style.display);
    }
    {
        // ⚠️ SIN CALENDARIO IMPORTADO la pantalla sigue funcionando igual que
        //    antes de v666: campos a mano y ni un error.
        const p = montarPantalla({ guardado: { type: 'liga' }, sinCalendario: true });
        await p.esperar();
        ok('3p · ⚠️ sin calendario importado no se pinta desplegable…',
           p.el('conv-cal-box').innerHTML.indexOf('conv-cal') === -1);
        ok('3q · …y los campos a mano siguen ahí',
           p.html().indexOf('id="conv-rival"') !== -1);
        ok('3r · sin ruido en pantalla', p.avisos.length === 0, p.avisos.join(' | '));
    }
    {
        // Y sin equipo asignado tampoco puede reventar.
        const p = montarPantalla({ guardado: { type: 'liga' }, sinEquipo: true });
        await p.esperar();
        ok('3s · ⚠️ sin equipo asignado no se consulta el calendario',
           p.pedidoCon() === null);
        ok('3t · y la convocatoria se pinta igual',
           p.html().indexOf('id="conv-rival"') !== -1);
    }

    // ═══ PARTE 4 · lo que se guarda ═══
    console.log('\n── PARTE 4 · la jornada viaja con la convocatoria ──');
    {
        const p = montarPantalla({ guardado: { type: 'liga' } });
        await p.esperar();
        // ⚠️ El DOM de juguete no interpreta el marcado: un <select> nace con
        //    `value` vacío aunque su <option> lleve `selected`. Se pone a mano
        //    lo que el navegador tendría puesto; lo que aquí se mide es qué
        //    LEE y GUARDA `saveConvData`, no cómo pinta el navegador.
        p.el('conv-type').value = 'liga';
        p.sb.window._convElegirPartidoCal('1');
        const guardado = p.sb.saveConvData();
        ok('4a · el tipo se guarda',    guardado.type === 'liga', guardado.type);
        ok('4b · 🔑 la jornada también', String(guardado.jornada) === '2', String(guardado.jornada));
        ok('4c · con el rival del calendario', guardado.rival === 'AD Huracán B', guardado.rival);
        ok('4d · y el campo',           guardado.venue === 'Pepe Gonçalvez', guardado.venue);
    }

    // ═══ PARTE 5 · ni una tabla de cupos nueva ═══
    console.log('\n── PARTE 5 · los números salen de la regla única ──');
    {
        // 🔑 Los 14/18 y 7/11 ya estaban escritos en línea en cuatro sitios del
        //    repositorio. Esta ronda NO podía añadir un quinto: el cupo se pide
        //    a `cronosCupoConvocatoria`, y lo que queda en import.js es sólo el
        //    respaldo estricto para cuando utils.js no haya cargado.
        ok('5a · la convocatoria pide el cupo a la regla única',
           /window\.cronosCupoConvocatoria\(currentMode,\s*tipo\)/.test(IMPORT_JS));
        ok('5b · ⚠️ y su respaldo es el ESTRICTO, no «sin límite»',
           /No sé|no se inventa una tabla de repuesto/.test(IMPORT_JS) ||
           /maxConvoked = currentMode === 'f7' \? 14 : 18;/.test(IMPORT_JS));
        ok('5c · utils.js sigue exportando la regla',
           /window\.cronosCupoConvocatoria\s*=/.test(UTILS_JS));
    }

    // ═══ PARTE 6 · el rival se HEREDA al partido (v667) ═══
    console.log('\n── PARTE 6 · el rival de la convocatoria llega al marcador ──');
    // Reportado con capturas: elige «Maspalomas» y el marcador del partido
    // seguía diciendo «VISITANTE». El dato estaba escrito y no viajaba.
    //
    // 🔑🔑 SE COMPRUEBAN LOS DOS LADOS. `TEAM_NAMES.home`/`away` son LOCAL y
    //    VISITANTE del ENCUENTRO, no «yo» y «el otro»: si el entrenador dirige
    //    de visitante, el rival es el LOCAL. Un guard que sólo mirase el caso
    //    de local daría verde con el nombre puesto al equipo equivocado.
    const SRC_HEREDA = extraeFn(IMPORT_JS, '_convHeredarRivalAlPartido');
    ok('6·0 · se puede extraer la función de herencia', !!SRC_HEREDA);

    function heredar(opts) {
        const porId = {};
        const doc = { getElementById(id) { if (!porId[id]) porId[id] = nuevoEl(); return porId[id]; } };
        porId['conv-rival'] = nuevoEl(); porId['conv-rival'].value = opts.rival;
        const sb = {
            document: doc,
            TEAM_NAMES: { home: 'LOCAL', away: 'VISITANTE' },
            console: { warn() {} }, String, Object,
        };
        sb.window = { _userTeamRole: opts.rol || 'home', _savedConvData: opts.guardado || null };
        sb.globalThis = sb;
        vm.createContext(sb);
        vm.runInContext(SRC_HEREDA + '\n_convHeredarRivalAlPartido();', sb);
        return { sb, el: (id) => porId[id] || nuevoEl() };
    }

    {
        // 🏠 Dirige de LOCAL → el rival es el VISITANTE.
        const r = heredar({ rival: 'Maspalomas', rol: 'home' });
        ok('6a · 🔑 el rival pasa a ser el equipo VISITANTE',
           r.sb.TEAM_NAMES.away === 'MASPALOMAS', r.sb.TEAM_NAMES.away);
        ok('6b · y NO se toca el equipo propio',
           r.sb.TEAM_NAMES.home === 'LOCAL', r.sb.TEAM_NAMES.home);
        ok('6c · el rótulo del marcador se actualiza',
           r.el('team-b-name').textContent === 'MASPALOMAS', r.el('team-b-name').textContent);
        // ⚠️ Si no se escribiera también la casilla del setup, `confirmSetup()`
        //    volvería a poner «VISITANTE» encima al pasar por el arranque.
        ok('6d · ⚠️ y la casilla del setup, para que confirmSetup no lo pise',
           r.el('setup-away-name').value === 'MASPALOMAS', r.el('setup-away-name').value);
    }
    {
        // ✈️ Dirige de VISITANTE → el rival es el LOCAL. Éste es el caso que
        //    un arreglo apresurado se salta, y pondría el nombre del rival al
        //    equipo del propio entrenador.
        const r = heredar({ rival: 'Maspalomas', rol: 'away' });
        ok('6e · 🔑🔑 dirigiendo de visitante, el rival es el LOCAL',
           r.sb.TEAM_NAMES.home === 'MASPALOMAS', r.sb.TEAM_NAMES.home);
        ok('6f · 🚨 y su propio equipo NO se renombra',
           r.sb.TEAM_NAMES.away === 'VISITANTE', r.sb.TEAM_NAMES.away);
        ok('6g · se actualiza el rótulo del LOCAL',
           r.el('team-a-name').textContent === 'MASPALOMAS', r.el('team-a-name').textContent);
    }
    {
        // ⚠️ Sin rival no se pisa nada: el partido arranca como antes de v667.
        const r = heredar({ rival: '   ', rol: 'home' });
        ok('6h · ⚠️ sin rival escrito no se toca ningún nombre',
           r.sb.TEAM_NAMES.away === 'VISITANTE' && r.sb.TEAM_NAMES.home === 'LOCAL');
    }
    {
        // Respaldo: si el modal ya no está en el DOM, vale lo guardado.
        const r = heredar({ rival: '', rol: 'home', guardado: { rival: 'Arucas B' } });
        ok('6i · si el modal ya se cerró, se usa lo guardado',
           r.sb.TEAM_NAMES.away === 'ARUCAS B', r.sb.TEAM_NAMES.away);
    }
    // 🔑 LAS DOS VÍAS AL PARTIDO. Ponerlo sólo en una es la forma de que el
    //    nombre aparezca unas veces sí y otras no.
    {
        const goto = extraeFn(IMPORT_JS, 'goToTitularSelection') || '';
        const conv = extraeFn(IMPORT_JS, 'startMatchWithConvocation') || '';
        ok('6j · 🔑 goToTitularSelection hereda el rival',
           /_convHeredarRivalAlPartido\(\)/.test(goto));
        ok('6k · 🔑 y startMatchWithConvocation también',
           /_convHeredarRivalAlPartido\(\)/.test(conv));
        // ⚠️ Y DESPUÉS de las validaciones: si la convocatoria se rechaza, no
        //    se ha tocado nada del partido.
        ok('6l · ⚠️ se hereda tras validar, no antes',
           goto.indexOf('_convHeredarRivalAlPartido()') > goto.indexOf('Necesitas al menos'));
        // 🔴 Y el tope de convocados de esta función tiene que conocer el tipo:
        //    con v666 la convocatoria deja pasar 20 en un amistoso, y este `if`
        //    los rechazaba con «Máximo 14». Una capa permite, la otra deniega.
        ok('6m · 🔴 el tope de IR AL PARTIDO también pide el cupo a la regla única',
           /cronosCupoConvocatoria\(currentMode, _tipo\)/.test(goto),
           'el amistoso con 20 convocados se bloquearía al arrancar');
    }

    console.log('\n' + (fail === 0
        ? '✅ TODO EN VERDE — ' + pass + ' aserciones.'
        : '❌ ' + fail + ' en rojo de ' + (pass + fail) + '.'));
    process.exit(fail === 0 ? 0 : 1);
})();
