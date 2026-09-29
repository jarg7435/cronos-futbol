// ═══════════════════════════════════════════════════════════════════════════
// GUARD · 📈 Estadísticas avanzadas (córners, faltas, centros, ocasiones) — v774
// ═══════════════════════════════════════════════════════════════════════════
// Encargo del autor (implementar.txt 2026-09-28 + ampliación del mismo día):
//   1. extra `modulo_stats_avanzadas` en Extras del SuperAdmin; apagado = la
//      interfaz no pinta nada;
//   2. esquema { favor, contra, detalle[] } / { total, detalle[] };
//   3. el flujo de R/P: toque, lista de mis jugadores, asignar opcional,
//      «rival / equipo» en las acciones en contra, contadores al momento;
//   4. fila junto a R/P (iPad/PC) y columna sobre LOCAL (móvil apaisado);
//   5. en vivo, sólo roles técnicos;
//   + informe colectivo, acumulado de temporada con promedios y desglose por
//     jugador, SÓLO en Juvenil, Regional y Nacional.
//
// ⚠️ EJECUTA el código (lección de v679/v596/v620: medir la FORMA no prueba el
// COMPORTAMIENTO). Cada parte va en su propio `try` (lección de v738).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond) {
    total++;
    if (cond) console.log(`  ✓ ${nombre}`);
    else { console.log(`  ✗ ${nombre}`); fallos++; }
}
function parte(titulo, fn) {
    console.log(`\n── ${titulo} ──`);
    try { fn(); }
    catch (e) { ok(`${titulo}: se ejecuta sin excepción (${e.message})`, false); }
}

const REPORT  = leer('js/shared/advanced-stats-report.js');
const CAPTURA = leer('js/match/events/advanced-stats.js');

// ═══ 0 · SINTAXIS ═══════════════════════════════════════════════════════════
parte('0 · los ficheros tocados compilan', () => {
    [
        'js/shared/advanced-stats-report.js', 'js/match/events/advanced-stats.js',
        'js/ui/render.js', 'js/core/app-init.js', 'js/match/live/sync.js',
        'js/admin/shared/category-tree.js', 'js/coach/reports/reports-tab.js',
        'js/coach/comms/individual-reports.js', 'js/coach/reports/report-engine.js',
        'js/admin/superadmin/extras-toggle.js', 'js/coach/comms/collective-report.js',
        'js/coach/comms/match-reports-send.js', 'js/coach/comms/match-reports-auto.js', 'sw.js',
        // v775
        'js/match/live/stats-cloud.js', 'js/match/events/possession-tracker.js', 'functions/index.js'
    ].forEach(f => {
        let bien = true;
        try { execFileSync(process.execPath, ['--check', path.join(RAIZ, f)], { stdio: 'pipe' }); }
        catch (e) { bien = false; }
        ok(`compila: ${f}`, bien);
    });
    // La trampa de codificación del proyecto: marcas combinantes LITERALES
    // en el fuente (se rompen sin error al tocar la codificación).
    ['js/shared/advanced-stats-report.js', 'js/match/events/advanced-stats.js',
     'js/coach/reports/report-engine.js', 'js/match/live/stats-cloud.js'].forEach(f => {
        // Rango U+0300–U+036F construido con códigos: escrito con escapes en
        // una clase, la propia herramienta de edición lo convierte en los
        // caracteres literales que se quieren cazar. `\p{M}` no sirve: los
        // selectores de variante de los emoji (U+FE0F) también son marcas.
        const combinantes = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']');
        ok(`sin marcas combinantes literales: ${f}`, !combinantes.test(leer(f)));
    });
});

// ═══ 1 · REGLAS: categoría y extra ══════════════════════════════════════════
function cargaReglas(extras) {
    const ctx = { console, window: { _cronosCurrentUser: { extras: extras || {} } } };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(REPORT, ctx, { filename: 'advanced-stats-report.js' });
    return ctx.window;
}

parte('1 · la categoría (Juvenil, Regional, Nacional) y el extra', () => {
    const W = cargaReglas();
    const P = W.cronosSAvCategoriaPermite, C = W.cronosSAvCategoriaCaptura;
    ok('DENTRO · Juvenil (clave, etiqueta, con letra)', P('f11_juvenil') && P('Juvenil A') && P('juvenil_b'));
    ok('DENTRO · Regional y Regional FEM (senior)', P('f11_regional') && P('Regional') && P('Regional FEM B'));
    ok('DENTRO · Nacional', P('f11_nacional') && P('Nacional'));
    ok('FUERA · Cadete (formativo: el encargo lo deja fuera)', !P('f11_cadete') && !P('Cadete'));
    ok('FUERA · Prebenjamín, Benjamín, Alevín, Infantil',
       !P('f7_prebenjamin') && !P('f7_benjamin') && !P('Alevín C') && !P('f11_infantil'));
    ok('FUERA · FUTureFEM', !P('f7_futurefem') && !P('FUTureFEM'));
    ok('informes: SIN categoría no se decide (true)', P('') === true && P(null) === true);
    ok('directo: SIN categoría no hay botones (false)', C('') === false && C(null) === false);
    ok('directo: con categoría, la misma regla', C('f11_juvenil') === true && C('f7_alevin') === false);

    ok('EXTRA ausente = APAGADO (no se estrena solo en los clubes reales)',
       cargaReglas({}).cronosSAvExtraActivo() === false);
    ok('EXTRA a false = apagado', cargaReglas({ modulo_stats_avanzadas: false }).cronosSAvExtraActivo() === false);
    ok('EXTRA a true = encendido', cargaReglas({ modulo_stats_avanzadas: true }).cronosSAvExtraActivo() === true);
});

// ═══ 2 · EL DIRECTO, EJECUTADO CON UN DOM DE MENTIRA ════════════════════════
function claseStub() {
    const s = new Set();
    return { add: (...cs) => cs.forEach(c => s.add(c)), remove: (...cs) => cs.forEach(c => s.delete(c)),
             contains: c => s.has(c) };
}
function montaEntorno(o) {
    o = o || {};
    const porId = {};
    function nuevo(id) {
        const el = {
            id: id || '', _html: '', classList: claseStub(), style: {}, textContent: '', attrs: {},
            addEventListener: () => {}, setAttribute: (k, v) => { el.attrs[k] = v; },
            getAttribute: k => (k in el.attrs ? el.attrs[k] : null), removeAttribute: k => { delete el.attrs[k]; },
            appendChild: h => { if (h && h.id) porId[h.id] = h; return h; },
            querySelectorAll: () => [], querySelector: () => null,
        };
        Object.defineProperty(el, 'innerHTML', {
            get: () => el._html,
            set: v => {
                el._html = String(v);
                (el._html.match(/id="([^"]+)"/g) || []).forEach(m => {
                    const id2 = m.slice(4, -1);
                    if (!porId[id2]) porId[id2] = nuevo(id2);
                });
            }
        });
        Object.defineProperty(el, 'id', {
            get: () => el._id || '', set: v => { el._id = v; if (v) porId[v] = el; }
        });
        if (id) el.id = id;
        return el;
    }
    const almacen = o.almacen || {};
    const doc = {
        readyState: 'complete', head: nuevo('head'), body: nuevo('body'),
        addEventListener: () => {}, createElement: () => nuevo(''),
        getElementById: id => porId[id] || null,
    };
    const extras = (o.extras === undefined) ? { modulo_stats_avanzadas: true } : o.extras;
    const ctx = {
        document: doc, console: { log() {}, warn() {}, error() {} },
        setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
        localStorage: {
            getItem: k => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); },
            removeItem: k => { delete almacen[k]; }
        },
        liveMatchId: (o.matchId === undefined) ? 'm_test' : o.matchId,
        players: o.players || [],
        masterTimeH1: 754, masterTimeH2: 0,
        matchPhase: (o.fase === undefined) ? '1st_half' : o.fase,
        isRunning: (o.corriendo === undefined) ? true : o.corriendo,
        escapeHtml: s => String(s), showToast: () => {}, confirm: () => true,
        window: {
            _userTeamRole: o.rol || 'home',
            _currentMatchCategory: (o.categoria === undefined) ? 'f11_juvenil' : o.categoria,
            _cronosCurrentUser: { extras },
        },
        _almacen: almacen
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(REPORT, ctx, { filename: 'advanced-stats-report.js' });
    vm.runInContext(CAPTURA, ctx, { filename: 'advanced-stats.js' });
    return ctx;
}

const PLANTILLA = [
    { id: 1, number: 7,  name: 'Nano',  team: 'home', status: 'field' },
    { id: 2, number: 10, name: 'Bruno', team: 'home', status: 'field' },
    { id: 3, number: 15, name: 'Romu',  team: 'home', status: 'bench' },
    { id: 9, number: 4,  name: 'Rival', team: 'away', status: 'field' },
];

parte('2 · las puertas del directo', () => {
    const base = montaEntorno({ players: PLANTILLA });
    ok('CONTROL · extra activo + Juvenil → disponible', base.window.cronosSAvDisponible() === true);
    ok('extra AUSENTE → no disponible (ni botones ni layout)',
       montaEntorno({ players: PLANTILLA, extras: {} }).window.cronosSAvDisponible() === false);
    ok('extra a false → no disponible',
       montaEntorno({ players: PLANTILLA, extras: { modulo_stats_avanzadas: false } }).window.cronosSAvDisponible() === false);
    ok('Cadete → no disponible', montaEntorno({ players: PLANTILLA, categoria: 'f11_cadete' }).window.cronosSAvDisponible() === false);
    ok('Alevín → no disponible', montaEntorno({ players: PLANTILLA, categoria: 'f7_alevin' }).window.cronosSAvDisponible() === false);
    ok('Nacional → disponible', montaEntorno({ players: PLANTILLA, categoria: 'f11_nacional' }).window.cronosSAvDisponible() === true);

    // La puerta va en la FUNCIÓN (pública), no sólo en el botón.
    const off = montaEntorno({ players: PLANTILLA, extras: {} });
    ok('con el extra apagado, registrar desde la consola NO apunta nada',
       off.window.cronosSAvRegistra('corners', 'favor') === null && off.window._cronosSAv.items.length === 0);
    const parado = montaEntorno({ players: PLANTILLA, corriendo: false });
    ok('con el reloj parado NO se registra (como R/P, v695)',
       parado.window.cronosSAvRegistra('corners', 'favor') === null);
    const descanso = montaEntorno({ players: PLANTILLA, fase: 'break' });
    ok('en el descanso NO se registra', descanso.window.cronosSAvRegistra('faltas', 'contra') === null);

    // La barra: con la puerta abierta se enciende; cerrada, ni aparece.
    base.window.cronosSAvActualiza();
    ok('cronosSAvActualiza enciende la barra con la puerta abierta',
       base.document.getElementById('cronos-sav-bar').classList.contains('on'));
    off.window.cronosSAvActualiza();
    ok('…y con el extra apagado la deja APAGADA (no altera el layout)',
       !off.document.getElementById('cronos-sav-bar').classList.contains('on'));
});

parte('3 · registrar, asignar, rectificar (flujo de R/P) y el esquema', () => {
    const E = montaEntorno({ players: PLANTILLA });
    const W = E.window;
    ok('métrica o tipo inválidos se rechazan',
       W.cronosSAvRegistra('penaltis', 'favor') === null && W.cronosSAvRegistra('corners', 'x') === null);

    const c1 = W.cronosSAvRegistra('corners', 'favor');
    ok('un toque registra al instante, como colectivo', !!c1 && c1.playerId === null);
    ok('el contador del botón se actualiza en el momento',
       E.document.getElementById('sav-n-cf').textContent === '1');
    ok('se abre la lista de jugadores para asignar',
       E.document.getElementById('cronos-sav-assign').classList.contains('on'));
    const lista = E.document.getElementById('cronos-sav-assign').innerHTML;
    ok('la lista muestra dorsal Y nombre de MIS jugadores en el campo',
       /<b>7<\/b>Nano/.test(lista) && /<b>10<\/b>Bruno/.test(lista));
    ok('…y NO al del banquillo ni al rival', !/Romu/.test(lista) && !/>Rival</.test(lista));

    ok('asignar a un id del RIVAL se rechaza (la puerta está en la función)',
       W.cronosSAvAsigna(c1.id, 9) === false && c1.playerId === null);
    ok('asignar a uno mío funciona', W.cronosSAvAsigna(c1.id, 1) === true && c1.number === '7');

    const f1 = W.cronosSAvRegistra('faltas', 'contra');
    const lista2 = E.document.getElementById('cronos-sav-assign').innerHTML;
    ok('en las acciones EN CONTRA la lista ofrece «Rival / equipo»', /Rival \/ equipo/.test(lista2));
    W.cronosSAvAsigna(f1.id, 2);
    W.cronosSAvRegistra('faltas', 'favor');           // se queda colectiva
    W.cronosSAvRegistra('centros');                    // tipo ignorado
    const ce = W.cronosSAvRegistra('centros', 'favor');
    W.cronosSAvAsigna(ce.id, 2);
    W.cronosSAvRegistra('ocasiones', 'contra');        // del rival

    const r = W.cronosSAvDelPartido(W._cronosSAv.items);
    ok('esquema · corners {favor, contra, detalle[]}',
       r.corners.favor === 1 && r.corners.contra === 0 && Array.isArray(r.corners.detalle));
    ok('esquema · detalle con playerId, dorsal, name, minuto y tipo',
       r.corners.detalle[0].playerId === '1' && r.corners.detalle[0].dorsal === '7' &&
       r.corners.detalle[0].name === 'Nano' && /^1T 12:34$/.test(r.corners.detalle[0].minuto) &&
       r.corners.detalle[0].tipo === 'favor');
    ok('esquema · faltas: 1 recibida, 1 cometida', r.faltas.favor === 1 && r.faltas.contra === 1);
    ok('esquema · centros {total, detalle[]} sin tipo',
       r.centros.total === 2 && r.centros.detalle.length === 2 && !('tipo' in r.centros.detalle[0]));
    ok('esquema · ocasiones: 1 concedida', r.ocasiones.contra === 1 && r.ocasiones.favor === 0);
    ok('porDorsal · lo de cada jugador', r.porDorsal['7'].cf === 1 && r.porDorsal['10'].fc === 1 && r.porDorsal['10'].ce === 1);
    ok('sinAsignar · lo colectivo / del rival',
       r.sinAsignar.ff === 1 && r.sinAsignar.ce === 1 && r.sinAsignar.oc === 1 && r.sinAsignar.cf === 0);

    const antes = W._cronosSAv.items.length;
    const fuera = W.cronosSAvRectifica();
    ok('↩ Rectificar quita el ÚLTIMO', W._cronosSAv.items.length === antes - 1 && fuera.metrica === 'ocasiones');
    ok('✕ quita un apunte concreto', W.cronosSAvDeshace(c1.id) === true &&
       W.cronosSAvDelPartido(W._cronosSAv.items).corners.favor === 0);
    ok('se persiste por partido en localStorage', /cronos_sav::m_test/.test(Object.keys(E._almacen).join(',')));

    // Lo que viaja a los informes: sin nada, null (no se guarda un vacío).
    const vacio = montaEntorno({ players: PLANTILLA });
    ok('despachos: sin registros, `matchStats` = null', vacio.window.cronosSAvDelPartido() === null);
    const base = montaEntorno({ players: PLANTILLA, categoria: 'f7_alevin' });
    base.window._cronosSAv.items.push({ id: 'x', metrica: 'corners', tipo: 'favor', createdAt: 1 });
    ok('despachos: en una categoría de BASE nunca viaja, aunque quede memoria',
       base.window.cronosSAvDelPartido() === null);

    ok('🗑 Limpiar todo vacía el partido', W.cronosSAvLimpiaTodo(true) > 0 && W._cronosSAv.items.length === 0);
});

parte('3b · partido nuevo a cero y la migración sin_id → id real', () => {
    const E = montaEntorno({ players: PLANTILLA, matchId: '' });
    const W = E.window;
    W.cronosSAvRegistra('corners', 'favor');
    ok('sin id del partido se apunta en el cajón sin_id', W._cronosSAv.matchId === 'sin_id');
    E.liveMatchId = 'm_real';
    W.cronosSAvRegistra('corners', 'contra');
    ok('al llegar el id real, lo apuntado se MIGRA (no se pierde)',
       W._cronosSAv.matchId === 'm_real' && W._cronosSAv.items.length === 2);
    // El partido nuevo aún no tiene id (lo asigna la retransmisión ~800 ms
    // después): es el escenario real de `_cronosNuevoPartidoDeEquipo`.
    E.liveMatchId = '';
    W.cronosSAvNuevoPartido();
    W.cronosSAvActualiza();   // el repintado que viene detrás no resucita nada
    ok('partido nuevo: contadores estrictamente a cero', W._cronosSAv.items.length === 0);
});

parte('4 · v775: las estadísticas YA NO viajan en `live_matches`', () => {
    // v774 metía `advStats` en el latido, que las reglas de live_matches dejan
    // leer también a las familias. Ahora viven en `live_stats` (parte 9).
    const sync = leer('js/match/live/sync.js');
    ok('sync.js no escribe `snapshot.advStats`', !/snapshot\.advStats\s*=/.test(sync));
    ok('el módulo ya no expone el resumen para el latido', !/cronosSAvResumenVivo\s*=/.test(CAPTURA));
});

// ═══ 5 · DÓNDE VA LA BARRA (función pura, medidas de las capturas) ═════════
parte('5 · colocación: móvil sobre LOCAL, iPad/PC junto a R/P', () => {
    const W = montaEntorno({ players: PLANTILLA }).window;
    const S = W.cronosSAvSitioBarra;
    // Móvil apaisado (IMG_4890 ≈ 852×393): césped de 66 a 777, LOCAL abajo-izq.
    const mov = S({ ancho: 852, alto: 393, seguro: 0,
                    campo: { left: 66, right: 777, top: 93, bottom: 380 },
                    local: { left: 6, top: 334, right: 58, bottom: 360, width: 52, height: 26 },
                    barra: { w: 56, h: 210 } });
    ok('móvil → columna', mov.modo === 'movil');
    ok('…ENCIMA de LOCAL', mov.top + mov.h <= 334 - 8 + 0.5);
    ok('…en el margen IZQUIERDO, fuera del césped', mov.left + mov.w <= 66 - 4 + 0.5 && mov.left >= 4);
    ok('…y la lista de jugadores crece hacia la derecha', mov.asignar.left > mov.left + mov.w);

    // iPad (IMG_0623: 2360 px físicos = 1180 px CSS; lo mostrado ×0,59):
    // R/P centrado bajo el campo, de 497 a 683.
    const pr = { left: 497, right: 683, top: 665, bottom: 708, width: 186, height: 43 };
    const ipad = S({ ancho: 1180, alto: 752, seguro: 0,
                     campo: { left: 238, right: 942, top: 184, bottom: 652 },
                     pr, barra: { w: 420, h: 58 } });
    ok('iPad → fila', ipad.modo === 'fila');
    ok('…a la DERECHA del bloque R/P, con hueco de separación', ipad.left >= pr.right + 8);
    ok('…a su misma altura (centrada con R/P)',
       Math.abs((ipad.top + ipad.h / 2) - (pr.top + pr.height / 2)) <= 2);
    ok('…sin salirse de la pantalla', ipad.left + ipad.w <= 1180);

    const estrecho = S({ ancho: 1000, alto: 700, campo: null,
                         pr: { left: 600, right: 870, top: 640, bottom: 684, width: 270, height: 44 },
                         barra: { w: 420, h: 58 } });
    ok('si a la derecha no cabe, va a la IZQUIERDA de R/P', estrecho.left + estrecho.w <= 600);
});

// ═══ 6 · LOS INFORMES ═══════════════════════════════════════════════════════
const MS = {
    v: 1,
    corners: { favor: 5, contra: 2, detalle: [] }, faltas: { favor: 7, contra: 9, detalle: [] },
    centros: { total: 11, detalle: [] }, ocasiones: { favor: 4, contra: 1, detalle: [] },
    porDorsal: { '7': { cf: 2, ce: 3, of: 2 }, '10': { fc: 4, ff: 1 } },
    sinAsignar: { cf: 3, cc: 2, ff: 6, fc: 5, ce: 8, of: 2, oc: 1 }
};
const jug = (n, alias, extra) => Object.assign({
    playerNumber: String(n), playerAlias: alias, minutesPlayed: '70:00', goals: 0, cards: null, history: []
}, extra || {});

parte('6 · lectura del dato guardado y acumulado del equipo', () => {
    const W = cargaReglas({ modulo_stats_avanzadas: true });
    const cero = { corners: { favor: 0, contra: 0 }, faltas: { favor: 0, contra: 0 }, centros: { total: 0 }, ocasiones: { favor: 0, contra: 0 } };
    const m1 = { category: 'f11_juvenil', players: [jug(7, 'NANO', { matchStats: cero }), jug(10, 'BRUNO', { matchStats: MS })] };
    ok('coge el ejemplar MÁS COMPLETO entre las copias repetidas', W.cronosSAvDelInforme(m1) === MS);
    ok('en una categoría de base no hay dato, traiga lo que traiga el documento',
       W.cronosSAvDelInforme({ category: 'Alevín C', players: [jug(7, 'N', { matchStats: MS })] }) === null);
    ok('un informe viejo (sin matchStats) → null', W.cronosSAvDelInforme({ category: 'juvenil', players: [jug(7, 'N')] }) === null);

    const tot = W.cronosSAvAcumulaEquipo([m1, m1, { category: 'juvenil', players: [jug(7, 'N')] }]);
    ok('el acumulado cuenta sólo los partidos QUE TRAEN el dato (para las medias)', tot.partidos === 2);
    ok('…y suma los totales de equipo', tot.corners.favor === 10 && tot.faltas.contra === 18 && tot.centros.total === 22);

    const filas = [{ number: '7', alias: 'NANO', sav: { cf: 4, cc: 0, ff: 0, fc: 0, ce: 6, of: 4, oc: 0 } },
                   { number: '3', alias: 'SIN', sav: undefined }];
    const h = W.cronosSAvRenderTemporada([m1, m1], filas, { categoria: 'juvenil' });
    ok('el bloque de temporada se pinta con los KPIs', /Estadísticas avanzadas de la temporada/.test(h) && /data-sav-temporada/.test(h));
    ok('…con los PROMEDIOS por partido', /media 5 \/ 2/.test(h) && /media 11 \/ partido/.test(h));
    ok('…y el desglose por jugador (sólo los que tienen algo)', /NANO/.test(h) && !/>SIN</.test(h));
    ok('Cadete → el bloque NO se pinta', W.cronosSAvRenderTemporada([m1], filas, { categoria: 'cadete' }) === '');
    ok('extra apagado → el bloque NO se pinta',
       cargaReglas({}).cronosSAvRenderTemporada([m1], filas, { categoria: 'juvenil' }) === '');
    ok('sin partidos con dato → no se pinta un bloque vacío',
       W.cronosSAvRenderTemporada([{ category: 'juvenil', players: [jug(7, 'N')] }], [], { categoria: 'juvenil' }) === '');

    const txt = W.cronosSAvLineasTxt(MS, d => '#' + d);
    ok('TXT: totales y una línea por dorsal', txt.some(t => /Córners: a favor 5 · en contra 2/.test(t)) &&
       txt.some(t => /^#7 .*Cór 2\/0 .*Centros 3/.test(t)));
});

parte('6b · el acumulado por jugador (category-tree) suma por CÓDIGO', () => {
    const src = leer('js/admin/shared/category-tree.js');
    const W = cargaReglas({ modulo_stats_avanzadas: true });
    const ctx = { console, window: W, document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] } };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'category-tree.js' });
    const acum = W.ctAccumulatePlayerStats;
    ok('ctAccumulatePlayerStats existe', typeof acum === 'function');
    // Dos partidos del MISMO jugador (código ALC07) con dorsales distintos
    // (dorsales por jornada, v767): su fila tiene que sumar los dos.
    const pA = { category: 'juvenil', players: [jug(7, 'NANO', { playerCode: 'ALC07', rosterNumber: '7', matchStats: MS })] };
    const pB = { category: 'juvenil', players: [jug(12, 'NANO', { playerCode: 'ALC07', rosterNumber: '7',
                   matchStats: Object.assign({}, MS, { porDorsal: { '12': { cf: 1, ce: 1 } } }) })] };
    const filas = acum([pA, pB]);
    const nano = filas.filter(f => f.alias === 'NANO')[0];
    ok('una sola fila para el jugador', filas.length === 1 && !!nano);
    ok('…con sus córners y centros de los DOS partidos', nano.sav.cf === 3 && nano.sav.ce === 4 && nano.sav.of === 2);
    const sinModulo = acum([{ category: 'juvenil', players: [jug(7, 'NANO')] }]);
    ok('equipos sin el módulo: las filas no cambian de forma (sin `sav`)', !('sav' in sinModulo[0]));
});

parte('6c · el informe del partido (report-engine, motor AUTOCONTENIDO)', () => {
    const engine = leer('js/coach/reports/report-engine.js');
    const sb = {};
    vm.createContext(sb);
    vm.runInContext(engine + '\n;this.__RP = _RP;', sb);
    const RP = sb.__RP;
    const m = { matchDate: '2026-09-28', rival: 'R', scoreHome: 1, scoreAway: 0, category: 'f11_regional',
                players: [jug(7, 'NANO', { matchStats: MS }), jug(10, 'BRUNO', { matchStats: MS })] };
    const h = RP.build(m, { clubName: 'CD' });
    ok('el informe colectivo lista las Estadísticas avanzadas', /data-sav-informe="1"/.test(h));
    ok('…UNA vez, aunque el dato venga repetido en cada documento', (h.match(/data-sav-informe/g) || []).length === 1);
    ok('…con los totales (córners 5/2, centros 11)', /title="A favor">5</.test(h) && />11</.test(h));
    ok('…y la ficha por jugador con su nombre', /NANO/.test(h) && /BRUNO/.test(h));
    ok('…y lo sin asignar (equipo / rival)', /Sin jugador asignado \(equipo \/ rival\)/.test(h));
    const base = RP.build({ matchDate: '2026-09-28', rival: 'R', scoreHome: 0, scoreAway: 0, category: 'Alevín C',
                            players: [jug(7, 'NANO', { matchStats: MS })] }, { clubName: 'CD' });
    ok('en una categoría de BASE no sale, traiga lo que traiga', !/data-sav-informe/.test(base));
    const viejo = RP.build({ matchDate: '2026-09-28', rival: 'R', scoreHome: 0, scoreAway: 0, category: 'juvenil',
                             players: [jug(7, 'NANO')] }, { clubName: 'CD' });
    ok('un informe SIN el dato sale como siempre', !/data-sav-informe/.test(viejo));
    ok('el motor sigue sin nombrar `window` en lo nuevo',
       !/window/.test(engine.slice(engine.indexOf('v774 · ESTADÍSTICAS AVANZADAS'), engine.indexOf('v715 · Y EL COMENTARIO RETROACTIVO'))));
});

// ═══ 7 · CABLEADO ═══════════════════════════════════════════════════════════
parte('7 · despachos, pantallas, extra, visor y precarga', () => {
    const escritores = [
        ['js/coach/comms/collective-report.js', 1],
        ['js/coach/comms/match-reports-send.js', 2],
        ['js/coach/comms/match-reports-auto.js', 2],
    ];
    escritores.forEach(([f, n]) => {
        const s = leer(f);
        const conPR = (s.match(/matchPR:\s/g) || []).length;
        const conSAv = (s.match(/matchStats:\s+\(typeof window\.cronosSAvDelPartido === 'function'\)/g) || []).length;
        ok(`${f}: matchStats viaja en las ${n} copias técnicas (junto a matchPR)`, conSAv === n && conPR === n);
    });
    const auto = leer('js/coach/comms/match-reports-auto.js');
    const familia = auto.slice(auto.indexOf("type:          'parent_player_report'"), auto.indexOf('// ── Enviar mensaje al hilo de chat'));
    ok('la copia de la FAMILIA no lleva matchStats (sólo roles técnicos)', familia.length > 100 && !/matchStats/.test(familia));

    ok('Dirección/Coordinación pintan el bloque de temporada',
       /cronosSAvRenderTemporada\(arr\.map\(x => x\.m\), _filas, \{ categoria: catId \}\)/.test(leer('js/coach/reports/reports-tab.js')));
    const ind = leer('js/coach/comms/individual-reports.js');
    ok('«Mis Informes» pinta el MISMO bloque', /cronosSAvRenderTemporada\(_miParaResumen, _miFilas/.test(ind));
    ok('el TXT del partido lleva la sección', /ESTADÍSTICAS AVANZADAS/.test(ind));

    const extras = leer('js/admin/superadmin/extras-toggle.js');
    ok('Extras del SuperAdmin: clave `modulo_stats_avanzadas` con porDefecto:false',
       /key:\s*'modulo_stats_avanzadas'[^\n]*porDefecto:\s*false/.test(extras));
    // Ejecutar la regla del interruptor del panel.
    const regla = extras.match(/const enabled = \(ext\.porDefecto === false\)[\s\S]*?;\n/);
    ok('el interruptor del panel existe', !!regla);
    if (regla) {
        const f = new Function('ext', 'extras', regla[0] + 'return enabled;');
        ok('panel: sin guardar sale APAGADO', f({ key: 'modulo_stats_avanzadas', porDefecto: false }, {}) === false);
        ok('panel: guardado a true sale encendido', f({ key: 'modulo_stats_avanzadas', porDefecto: false }, { modulo_stats_avanzadas: true }) === true);
        ok('panel: los extras de siempre siguen con `!== false`', f({ key: 'plantilla' }, {}) === true && f({ key: 'plantilla' }, { plantilla: false }) === false);
    }

    const render = leer('js/ui/render.js');
    ok('renderPlayers llama a la barra DESPUÉS de la de R/P (se coloca midiéndola)',
       render.indexOf('cronosSAvActualiza') > render.indexOf('cronosPRActualiza()'));
    ok('partido nuevo → a cero (app-init)', /cronosSAvNuevoPartido\(\)/.test(leer('js/core/app-init.js')));

    const idx = leer('index.html');
    const iR = idx.indexOf('js/shared/advanced-stats-report.js'), iC = idx.indexOf('js/match/events/advanced-stats.js');
    ok('index.html carga los dos ficheros, reglas primero', iR > 0 && iC > iR);
    ok('index.html carga la sincronía en la nube (v775)', idx.indexOf('js/match/live/stats-cloud.js') > 0);
    const sw = leer('sw.js');
    ok('sw.js los precachea (se usan en el campo, sin cobertura)',
       sw.includes("'./js/shared/advanced-stats-report.js'") && sw.includes("'./js/match/events/advanced-stats.js'") &&
       sw.includes("'./js/match/live/stats-cloud.js'"));
    ok('cleanupLiveMatches borra `live_stats` con el partido (llevan nombres de menores)',
       /loteB\.delete\(db\.collection\('live_stats'\)\.doc\(d\.id\)\)/.test(leer('functions/index.js')));
});

parte('8 · el visor en vivo: sólo roles técnicos, y con R/P', () => {
    const live = leer('live.html');
    const ini = live.indexOf('const _LIVE_SAV_ROLES_TECNICOS');
    const fin = live.indexOf('function _liveSAvPinta(');
    ok('live.html declara la lista de roles técnicos y la puerta', ini > 0 && fin > ini);
    const codigo = live.slice(ini, fin);
    const probar = (ud) => {
        const ctx = { userData: ud, console };
        vm.createContext(ctx);
        vm.runInContext(codigo + '\n;this.__r = _liveSAvEsTecnico();', ctx);
        return ctx.__r;
    };
    ok('entrenador → lo ve', probar({ role: 'coach' }) === true);
    // 🔴 v775 · En este proyecto el entrenador se guarda como 'user'. v774
    // tenía aquí la aserción AL REVÉS («usuario genérico → no lo ve») y un
    // entrenador real se quedaba sin panel.
    ok('entrenador guardado con rol «user» → LO VE (defecto de v774)', probar({ role: 'user' }) === true);
    ok('coordinador, director y admin del club → lo ven',
       probar({ role: 'coordinator' }) && probar({ role: 'director' }) && probar({ role: 'club_admin' }));
    ok('FAMILIA → NO lo ve', probar({ role: 'parent' }) === false && probar({ role: 'parent_individual' }) === false &&
       probar({ role: 'padre_individual' }) === false);
    ok('familia con una plaza de entrenador VIVA → lo ve (la unidad es la plaza)',
       probar({ role: 'parent', allRoles: [{ role: 'user', status: 'active' }] }) === true);
    ok('…pero no si esa plaza está revocada',
       probar({ role: 'parent', allRoles: [{ role: 'user', status: 'revoked' }] }) === false);

    // La lista de la pantalla y la de las reglas tienen que ser la MISMA.
    const reglas = leer('firestore.rules');
    const bloque = reglas.slice(reglas.indexOf('match /live_stats/{matchId}'));
    const listaReglas = (bloque.match(/\.data\.get\('role', ''\) in\s*\[([^\]]+)\]/) || [])[1] || '';
    const deReglas = (listaReglas.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
    const ctxL = {}; vm.createContext(ctxL);
    vm.runInContext(live.slice(ini, live.indexOf('];', ini) + 2) + ';this.__l = _LIVE_SAV_ROLES_TECNICOS;', ctxL);
    const dePantalla = ctxL.__l.filter(r => r !== 'superadmin');
    ok('los roles técnicos del visor = los de las reglas de live_stats (salvo el SA, que va aparte)',
       deReglas.length > 0 && dePantalla.every(r => deReglas.includes(r)) && deReglas.every(r => dePantalla.includes(r)));

    ok('renderMatch llama al pintor con guarda y try (no puede tumbar el partido)',
       /if \(typeof _liveSAvPinta === 'function'\) \{\s*try \{ _liveSAvPinta\(data\); \}/.test(live));
    const pinta = live.slice(fin, live.indexOf('function renderMatch('));
    ok('sin rol técnico NI SE ESCUCHA live_stats (la familia no llega a pedir el dato)',
       /if \(!_liveSAvEsTecnico\(\)\) \{\s*_liveStatsEscucha\(''\);/.test(pinta));
    ok('el visor lee de `live_stats`, no del latido', /doc\(db, 'live_stats', matchId\)/.test(live) && !/data\.advStats/.test(live));

    // El recuento del panel, EJECUTADO: R/P (punto 3) + avanzadas.
    const iC = live.indexOf('function _liveSAvCuenta(');
    const cuenta = live.slice(iC, live.indexOf('function _liveSAvPinta(', iC));
    const ctxC = {}; vm.createContext(ctxC);
    vm.runInContext(cuenta + ';this.__f = _liveSAvCuenta;', ctxC);
    const c = ctxC.__f({
        pr: { items: [{ kind: 'recovery', playerId: '1', number: '7', name: 'NANO' },
                      { kind: 'recovery' }, { kind: 'loss', playerId: '2', number: '10', name: 'BRUNO' }] },
        sav: { items: [{ metrica: 'corners', tipo: 'favor', playerId: '1', number: '7', name: 'NANO' },
                       { metrica: 'centros' }, { metrica: 'faltas', tipo: 'contra', playerId: '2', number: '10' }] }
    });
    ok('panel en vivo: cuenta RECUPERACIONES y PÉRDIDAS (punto 3)', c.tot.r === 2 && c.tot.p === 1);
    ok('…y las avanzadas', c.tot.cf === 1 && c.tot.ce === 1 && c.tot.fc === 1);
    const nano = c.jugadores.filter(j => j.d === '7')[0];
    ok('…con el desglose por jugador (R y córner de NANO)', !!nano && nano.r === 1 && nano.cf === 1 && nano.n === 'NANO');
    ok('el panel pinta las columnas R y P', /<th>R<\/th><th>P<\/th>/.test(pinta) && /kpi\('Recuperaciones'/.test(pinta));
});

parte('8b · el selector de R/P: dorsal + nombre, como Córners/Faltas (punto 1)', () => {
    const src = leer('js/match/events/possession-tracker.js');
    const ctx = montaEntornoPR({ players: PLANTILLA });
    ctx.window.cronosPRActualiza();
    ctx.window.cronosPRRegistra('loss');
    const html = ctx.document.getElementById('cronos-pr-assign').innerHTML;
    ok('la lista de R/P lleva DORSAL Y NOMBRE («7 Nano»)', /<b>7<\/b>Nano/.test(html) && /<b>10<\/b>Bruno/.test(html));
    ok('…ordenada por dorsal', html.indexOf('<b>7</b>') < html.indexOf('<b>10</b>'));
    ok('…y con el mismo diseño de píldora que `.sav-chip`',
       /\.cronos-pr-chip\{min-height:38px;border-radius:19px;/.test(src) && /\.cronos-pr-chip b\{/.test(src));
});

// Entorno con los TRES módulos del directo (R/P, avanzadas y nube), para las
// partes 8b y 9. `fs` es el Firestore simulado compartido entre «aparatos».
function montaEntornoPR(o) {
    o = o || {};
    const ctx = montaEntorno(Object.assign({}, o, { sinCargar: true }));
    ctx.window.cronosCategoriaConRegistroPR = () => true;
    ctx.window._cronosExtraEnabled = () => true;
    if (o.fs) {
        ctx.window._cronosStatsNubeFS = o.fs;
        ctx.window._cronos_auth = { db: { __db: true } };
        ctx.window._cronosCurrentUser.uid = o.uid || 'coach_uid';
        ctx.window._cronosCurrentUser.clubId = 'clubA';
    }
    // Temporizadores manuales: el guard decide cuándo vence la pausa de 700 ms.
    ctx._timers = [];
    ctx.setTimeout = (fn) => { ctx._timers.push(fn); return ctx._timers.length; };
    ctx.clearTimeout = (i) => { if (i) ctx._timers[i - 1] = null; };
    vm.runInContext(leer('js/match/live/stats-cloud.js'), ctx, { filename: 'stats-cloud.js' });
    vm.runInContext(leer('js/match/events/possession-tracker.js'), ctx, { filename: 'possession-tracker.js' });
    return ctx;
}

// Firestore simulado: un almacén y sus escuchas, con los metadatos que mira
// stats-cloud.js (eco propio con hasPendingWrites, luego la confirmación).
function firestoreFalso() {
    const almacen = {}, escuchas = {};
    const foto = (ruta, pend) => ({
        exists: () => ruta in almacen,
        data: () => JSON.parse(JSON.stringify(almacen[ruta])),
        metadata: { hasPendingWrites: !!pend, fromCache: false }
    });
    const avisa = (ruta, pend) => (escuchas[ruta] || []).forEach(cb => cb(foto(ruta, pend)));
    const fs = {
        doc: (db, col, id) => ({ ruta: col + '/' + id }),
        serverTimestamp: () => 'TS',
        setDoc: (ref, datos) => {
            const d = JSON.parse(JSON.stringify(datos));
            fs.escrituras.push({ ruta: ref.ruta, datos: d });
            almacen[ref.ruta] = d;
            avisa(ref.ruta, true);                  // eco local
            return Promise.resolve().then(() => avisa(ref.ruta, false));   // confirmación del servidor
        },
        onSnapshot: (ref, cb) => {
            (escuchas[ref.ruta] = escuchas[ref.ruta] || []).push(cb);
            Promise.resolve().then(() => cb(foto(ref.ruta, false)));
            return () => { escuchas[ref.ruta] = (escuchas[ref.ruta] || []).filter(x => x !== cb); };
        },
        // Entrega un dato a todas las escuchas SIN pasar por setDoc: simula
        // una foto atrasada (caché o red lenta).
        inyecta: (ruta, datos) => { almacen[ruta] = JSON.parse(JSON.stringify(datos)); avisa(ruta, false); },
        escrituras: [], almacen
    };
    return fs;
}
const vueltas = async (n) => { for (let i = 0; i < (n || 12); i++) await new Promise(r => setImmediate(r)); };
const vence = (ctx) => { const t = ctx._timers.slice(); ctx._timers.length = 0; t.forEach(f => f && f()); };

async function parte9() {
    console.log('\n── 9 · SINCRONÍA ENTRE APARATOS (punto 2), ejecutada con un Firestore simulado ──');
    try {
        const fs = firestoreFalso();
        // El PC y el iPad: MISMO partido, localStorage DISTINTO (cada aparato el suyo).
        const pc   = montaEntornoPR({ players: PLANTILLA, fs, almacen: {} });
        // El iPad entra con OTRA cuenta técnica del club: así «respeta el
        // autor» mide algo (con la misma cuenta saldría verde sin probar nada).
        const ipad = montaEntornoPR({ players: PLANTILLA, fs, almacen: {}, uid: 'coach2_uid' });

        pc.window.cronosPRActualiza(); pc.window.cronosSAvActualiza();
        await vueltas();
        ok('el PC escucha el documento del partido', pc.window._cronosStatsNubeEstado().escuchaId === 'm_test');

        const c = pc.window.cronosSAvRegistra('corners', 'favor'); pc.window.cronosSAvAsigna(c.id, 1);
        pc.window.cronosPRRegistra('loss');
        pc.window.cronosPRRegistra('recovery');
        ok('una ráfaga de toques NO escribe todavía (pausa de 700 ms)', fs.escrituras.length === 0);
        vence(pc); await vueltas();
        ok('…y al vencer la pausa es UNA sola escritura', fs.escrituras.length === 1);
        const d = fs.almacen['live_stats/m_test'];
        ok('se escribe en `live_stats/{matchId}`, no en live_matches', !!d && fs.escrituras[0].ruta === 'live_stats/m_test');
        ok('…con club, autor y las dos secciones', d.clubId === 'clubA' && d.createdBy === 'coach_uid' &&
           d.pr.items.length === 2 && d.sav.items.length === 1 && d.pr.t > 0 && d.sav.t > 0);
        ok('…y sólo con los campos que admiten las reglas',
           Object.keys(d).every(k => ['matchId', 'clubId', 'createdBy', 'coachEmail', 'category', 'pr', 'sav', 'updatedAt', 'expireAt', 'v'].includes(k)));

        // ── Se abre el partido en el iPad: NO puede salir a cero.
        ipad.window.cronosPRActualiza(); ipad.window.cronosSAvActualiza();
        await vueltas();
        ok('iPad: al abrir, R/P se HIDRATAN desde la nube (no salen a 0)', ipad.window._cronosPR.items.length === 2);
        ok('iPad: y las avanzadas también, con su jugador', ipad.window._cronosSAv.items.length === 1 &&
           ipad.window._cronosSAv.items[0].name === 'Nano');
        ok('iPad: los contadores de los botones lo reflejan',
           // String(): el DOM real convierte a texto; el simulado guarda el número.
           String(ipad.document.getElementById('sav-n-cf').textContent) === '1' &&
           String(ipad.document.getElementById('cronos-pr-nloss').textContent) === '1');
        vence(ipad); await vueltas();   // si hidratar programara una subida, vencería aquí
        ok('iPad: hidratar NO provoca una escritura de vuelta (sin eco)', fs.escrituras.length === 1);

        // ── Se corrige en el iPad (decremento) y el PC lo ve en tiempo real.
        ipad.window.cronosPRRectifica();
        vence(ipad); await vueltas();
        ok('iPad: rectificar se sube', fs.escrituras.length === 2 && fs.almacen['live_stats/m_test'].pr.items.length === 1);
        ok('iPad: respeta el AUTOR del documento (las reglas lo exigen)',
           fs.almacen['live_stats/m_test'].createdBy === 'coach_uid');
        ok('PC: recibe el decremento en tiempo real', pc.window._cronosPR.items.length === 1);

        // ── Un dato VIEJO que llega tarde (caché, red lenta) no pisa lo nuevo.
        const viejo = JSON.parse(JSON.stringify(fs.almacen['live_stats/m_test']));
        viejo.pr = { t: 1, items: [] };
        fs.inyecta('live_stats/m_test', viejo);
        ok('PC: un dato remoto MÁS VIEJO que el local se ignora', pc.window._cronosPR.items.length === 1);
        fs.almacen['live_stats/m_test'].pr = JSON.parse(JSON.stringify(fs.escrituras[fs.escrituras.length - 1].datos.pr));

        // ── Un cambio local pendiente NO lo pisa lo remoto, aunque sea más nuevo.
        pc.window.cronosSAvRegistra('faltas', 'contra');     // pendiente en el PC
        await new Promise(r => setTimeout(r, 5));            // lo del iPad, estrictamente después
        ipad.window.cronosSAvRegistra('ocasiones', 'favor'); vence(ipad); await vueltas();
        ok('PC: con un cambio propio sin subir, lo remoto (más nuevo) no lo borra',
           pc.window._cronosSAv.items.some(it => it.metrica === 'faltas'));
        vence(pc); await vueltas();
        ok('…y al subir, lo del PC queda en la nube',
           fs.almacen['live_stats/m_test'].sav.items.some(it => it.metrica === 'faltas'));

        // ── Recarga del iPad: sin localStorage de ese partido, vuelve todo.
        const recarga = montaEntornoPR({ players: PLANTILLA, fs, almacen: {} });
        recarga.window.cronosPRActualiza(); await vueltas();
        ok('un aparato NUEVO (o recargado sin datos locales) recupera todo',
           recarga.window._cronosSAv.items.length === 2 && recarga.window._cronosPR.items.length >= 1);

        // ── Apuntes hechos antes de que el partido tuviera documento: se suben.
        const fs2 = firestoreFalso();
        const solo = montaEntornoPR({ players: PLANTILLA, fs: fs2, almacen: {}, matchId: 'm_nuevo' });
        solo.window._cronosPR.matchId = 'm_nuevo';
        solo.window._cronosPR.items = [{ id: 'x', kind: 'loss', playerId: null, number: '', name: '', matchTime: '', createdAt: 1 }];
        solo.window._cronosPR.t = 5;
        solo.window.cronosPRActualiza(); await vueltas();
        vence(solo); await vueltas();
        ok('partido sin documento en la nube y apuntes locales → se suben solos',
           !!fs2.almacen['live_stats/m_nuevo'] && fs2.almacen['live_stats/m_nuevo'].pr.items.length === 1);
    } catch (e) {
        ok('9 · la sincronía se ejecuta sin excepción (' + e.message + ')', false);
    }
}

// ═══ 10 · v776 · LOS EXTRAS QUE LLEGAN (O CAMBIAN) CON EL PARTIDO ABIERTO ═══
// Reporte del autor 29-09 (capturas 10948/10949): extras en verde en el SA y
// el directo sin botones. La barra sólo se decidía en renderPlayers(); si los
// extras llegaban después, nadie volvía a decidir.
parte('10 · v776 · la barra se re-decide sola cuando cambian los extras', () => {
    const ctx = montaEntornoPR({ players: PLANTILLA, extras: {} });
    let prActivo = false;
    ctx.window._cronosExtraEnabled = () => prActivo;
    const vigias = [];
    ctx.setInterval = fn => { vigias.push(fn); return vigias.length; };
    const pasa = () => vigias.slice().forEach(f => f());
    const on = id => ctx.document.getElementById(id).classList.contains('on');

    // El repintado llega ANTES que los extras: las dos barras, apagadas.
    ctx.window.cronosPRActualiza();
    ctx.window.cronosSAvActualiza();
    ok('CONTROL · sin extras cargados, R/P y avanzadas apagadas',
       !on('cronos-pr-bar') && !on('cronos-sav-bar'));

    // Llegan los extras, sin ningún repintado de fichas.
    prActivo = true;
    ctx.window._cronosCurrentUser.extras = { modulo_stats_avanzadas: true, registro_pr: true };
    pasa();
    ok('🔴 llegan los extras → la barra de R/P se enciende SIN repintar', on('cronos-pr-bar'));
    ok('🔴 llegan los extras → la barra de avanzadas se enciende SIN repintar', on('cronos-sav-bar'));

    // Y al revés: el SA lo apaga con el partido abierto.
    prActivo = false;
    ctx.window._cronosCurrentUser.extras = { modulo_stats_avanzadas: false, registro_pr: false };
    pasa();
    ok('el SA los apaga → las dos barras se retiran',
       !on('cronos-pr-bar') && !on('cronos-sav-bar'));

    // La relectura de la nube (role-launch.js) existe y re-decide las barras.
    const rl = leer('js/services/auth/role-launch.js');
    ok('role-launch: `cronosRefrescaExtras` relee la entidad (sin caché) y re-decide',
       /window\.cronosRefrescaExtras\s*=/.test(rl) && /delete cache\[id\]/.test(rl) &&
       /_cronosReevaluaBarrasDirecto\(\)/.test(rl));
    ok('role-launch: relectura al volver a la pestaña (visibilidad y foco)',
       /addEventListener\('visibilitychange', alVolver\)/.test(rl) && /addEventListener\('focus', alVolver\)/.test(rl));
    ok('role-launch: al cargar los extras del arranque se re-deciden las barras',
       /if \(_ex && _vig\) _vig\.extras = _ex;[\s\S]{0,2000}_cronosReevaluaBarrasDirecto\(\);/.test(rl));
    ok('role-launch: el arranque abre la escucha EN VIVO del documento de la entidad',
       /_vig\.extras = _ex;[\s\S]{0,600}_escuchaExtras\(\)/.test(rl) &&
       /onSnapshot\(doc\(_db, col, id\)/.test(rl) && /_aplicaExtras\(id, \(snap\.data\(\) \|\| \{\}\)\.extras \|\| \{\}\)/.test(rl));
    ok('role-launch: el arranque ya NO escribe en el `me` capturado antes del await',
       !/if \(_ex\) me\.extras = _ex;/.test(rl));
    const sm = leer('js/core/setup-modal.js');
    ok('setup-modal: cambiar de equipo vuelve a pedir los extras de su club',
       /_activeRoleData:\s*destino\._rol,\s*\}\);[\s\S]{0,700}window\.cronosRefrescaExtras\(/.test(sm));
});

// Los extras se aplican al usuario VIGENTE (el objeto se reasigna entero al
// cambiar de equipo; escribir en una copia capturada los dejaba huérfanos).
parte('10c · v776 · los extras van al usuario VIGENTE y de SU entidad', () => {
    const rl = leer('js/services/auth/role-launch.js');
    const ini = rl.indexOf('function _entidadActual()');
    const fin = rl.indexOf('window._cronosAplicaExtras = _aplicaExtras;');
    const repintados = [];
    const ctx = { console: { log() {}, warn() {} }, JSON, String,
                  window: { _cronosCurrentUser: { clubId: 'club_elda', extras: { registro_pr: false } } },
                  _cronosReevaluaBarrasDirecto: () => repintados.push(1) };
    vm.createContext(ctx);
    vm.runInContext(rl.slice(ini, fin) + ';this.__ap = _aplicaExtras; this.__ent = _entidadActual;', ctx);
    const capturado = ctx.window._cronosCurrentUser;
    // Cambio de equipo MIENTRAS se esperaba al servidor: objeto nuevo.
    ctx.window._cronosCurrentUser = Object.assign({}, capturado, { category: 'regional' });
    const cambio = ctx.__ap('club_elda', { registro_pr: true, modulo_stats_avanzadas: true });
    ok('🔴 los extras llegan al usuario VIGENTE, no a la copia capturada',
       ctx.window._cronosCurrentUser.extras.modulo_stats_avanzadas === true &&
       capturado.extras.registro_pr === false);
    ok('…y como cambiaron, se re-decide el directo', cambio === true && repintados.length === 1);
    ok('los mismos extras otra vez → no se repinta', ctx.__ap('club_elda', { registro_pr: true, modulo_stats_avanzadas: true }) === false && repintados.length === 1);
    ok('extras de OTRA entidad (equipo anterior) → se ignoran',
       ctx.__ap('club_otro', { modulo_stats_avanzadas: false }) === false &&
       ctx.window._cronosCurrentUser.extras.modulo_stats_avanzadas === true);
    ctx.window._cronosCurrentUser = { individualEntityId: 'individual_x' };
    ok('ente individual: la entidad es su `individualEntityId`', ctx.__ent() === 'individual_x');
});

// Medido en prod (29-09, sólo lectura): la cuenta del autor es SÓLO superadmin,
// sin clubId ni extras. Con `=== true` a secas nunca veía las avanzadas.
parte('10b · v776 · el SuperAdmin sin club propio ve las avanzadas', () => {
    const conUsuario = u => {
        const ctx = { console, window: { _cronosCurrentUser: u } };
        ctx.window.window = ctx.window;
        vm.createContext(ctx);
        vm.runInContext(REPORT, ctx, { filename: 'advanced-stats-report.js' });
        return ctx.window.cronosSAvExtraActivo();
    };
    ok('🔴 SA sin clubId ni extras (la cuenta real de prod) → activo',
       conUsuario({ role: 'superadmin', allRoles: [{ role: 'superadmin', clubId: null }] }) === true);
    ok('SA con la plaza de un club que lo tiene APAGADO → apagado',
       conUsuario({ role: 'superadmin', clubId: 'club_x', extras: { modulo_stats_avanzadas: false } }) === false);
    ok('SA sin club pero con el extra guardado a false → apagado (manda lo guardado)',
       conUsuario({ role: 'superadmin', extras: { modulo_stats_avanzadas: false } }) === false);
    ok('CONTROL · entrenador sin extras → apagado (ausente = APAGADO sigue igual)',
       conUsuario({ role: 'user', clubId: 'club_x' }) === false);
    ok('CONTROL · entrenador con el extra encendido → activo',
       conUsuario({ role: 'user', clubId: 'club_x', extras: { modulo_stats_avanzadas: true } }) === true);
});

// ═══ 11 · v778 · EL VISOR ENSEÑA EL PANEL CON LOS MÓDULOS ACTIVOS, A CERO ═══
// Capturas 10961/10962/10963 (29-09): el entrenador con su barra y el visor
// live.html sin nada. El visor sólo pintaba con apuntes y no leía los extras.
parte('11 · v778 · el visor decide por los extras del club, no sólo por los apuntes', () => {
    const live = leer('live.html');
    const ini = live.indexOf('function _liveCatConPR(cat)');
    const fin = live.indexOf('function _liveSAvPintaPanel()');
    ok('live.html define `_liveCatConPR` y `_liveSAvModulos`', ini !== -1 && fin > ini);
    const ctx = { console, window: {} };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(REPORT, ctx, { filename: 'advanced-stats-report.js' });
    vm.runInContext('let _liveSAvPartido = null;' + live.slice(ini, fin) +
        ';this.__mod = _liveSAvModulos; this.__pr = _liveCatConPR; this.__set = p => { _liveSAvPartido = p; };', ctx);
    const partido = (cat) => ({ clubId: 'club_dia', matchCategory: cat });
    const mods = (cat, extras, idLeido) => {
        ctx.window._liveClubExtras = extras;
        ctx.window._liveClubExtrasId = (idLeido === undefined) ? 'club_dia' : idLeido;
        ctx.__set(partido(cat));
        return ctx.__mod();
    };
    let m = mods('regional', { registro_pr: true, modulo_stats_avanzadas: true });
    ok('🔴 Regional B (F11) con los dos extras en verde → R/P y avanzadas, SIN apuntes', m.pr === true && m.sav === true);
    m = mods('regional', {});
    ok('extras ausentes → R/P sí (ausente = activo), avanzadas no (ausente = apagado)', m.pr === true && m.sav === false);
    m = mods('regional', { registro_pr: false, modulo_stats_avanzadas: false });
    ok('los dos apagados en el SA → nada', m.pr === false && m.sav === false);
    m = mods('cadete', { registro_pr: true, modulo_stats_avanzadas: true });
    ok('Cadete → R/P sí, avanzadas no (misma puerta que el entrenador)', m.pr === true && m.sav === false);
    m = mods('alevin', { registro_pr: true, modulo_stats_avanzadas: true });
    ok('Alevín → nada', m.pr === false && m.sav === false);
    m = mods('regional', null);
    ok('extras sin leer (fallo) → nada: vuelve a «sólo con apuntes»', m.pr === false && m.sav === false);
    m = mods('regional', { registro_pr: true, modulo_stats_avanzadas: true }, 'club_otro');
    ok('extras de OTRO club (partido anterior) → no se aplican', m.pr === false && m.sav === false);

    // La lista de R/P del visor es la del entrenador (utils.js): una, no dos.
    const utils = leer('js/core/utils.js');
    const bloquePR = utils.slice(utils.indexOf('window.cronosCategoriaConRegistroPR = function'),
                                 utils.indexOf('return false;', utils.indexOf('window.cronosCategoriaConRegistroPR = function')));
    const enUtils = (bloquePR.match(/indexOf\('([a-z]+)'\)/g) || []).map(s => s.slice(9, -2)).sort().join(',');
    const enLive = ((live.slice(ini, fin).match(/\[('[a-z]+'(?:,\s*'[a-z]+')*)\]/) || [])[1] || '')
        .replace(/'/g, '').split(/,\s*/).sort().join(',');
    ok('la lista de categorías con R/P del visor == la de utils.js (' + enLive + ')', !!enLive && enLive === enUtils);

    ok('el visor carga advanced-stats-report.js (reglas de categoría compartidas)',
       /<script src="js\/shared\/advanced-stats-report\.js\?v=/.test(live));
    ok('la ficha del club guarda sus extras y repinta el panel',
       /window\._liveClubExtras\s+= data\.extras \|\| \{\};[\s\S]{0,120}_liveSAvPintaPanel\(\)/.test(live));
    ok('con un módulo activo el panel se pinta aunque vaya a cero',
       /if \(\(!c \|\| !c\.hay\) && \(mods\.pr \|\| mods\.sav\)\)/.test(live));
    ok('CONTROL · sin rol técnico sigue sin panel (familias como siempre)',
       /if \(!cont \|\| !c \|\| !c\.hay \|\| !_liveSAvEsTecnico\(\)\)/.test(live));
});

(async () => {
    await parte9();
    console.log(`\n${total - fallos}/${total} aserciones OK`);
    process.exit(fallos ? 1 : 0);
})();
