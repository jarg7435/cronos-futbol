// ─────────────────────────────────────────────────────────────────────────
// test_asistencia_arbol_director.js · la Asistencia del Panel de Dirección
// va por el ÁRBOL DE CATEGORÍAS y marca quién entrena HOY (2026-08-13)
//
// Pedido por el autor tras probar la pestaña: que se organice como el resto
// de paneles de dirección (categoría → subcategoría) y que se vea de un
// vistazo qué equipos tienen sesión hoy (verde) y cuáles descansan (rojo).
//
// LO QUE PROTEGE:
//
//  A · 🔑🔑 EL MÓDULO DEL ÁRBOL LO COMPARTEN CUATRO PESTAÑAS. Los hooks
//      nuevos (renderSubBadge / renderCatBadge) son OPCIONALES y, sin
//      pasarlos, el HTML tiene que salir IDÉNTICO al de antes. Si esto se
//      rompe, se rompen Convocatorias, Entrenamientos e Informes a la vez.
//  B · 🔑 EL INDICADOR VA EN LA CABECERA, no en el cuerpo. Todas las ramas
//      nacen PLEGADAS: un indicador dentro del cuerpo no se vería hasta
//      desplegar, que es justo lo contrario de "de un vistazo".
//  C · 🔑🔑 LA LISTA DE EQUIPOS ES LA UNIÓN DE TRES FUENTES. Un equipo que
//      entrena hoy pero al que aún NO le han pasado lista no tiene documento
//      de asistencia — y es exactamente el que el director quiere ver. Con
//      sólo los partes de asistencia, ese equipo no aparecería.
//  D · el teamId se parte por '__' (los tres tramos los genera
//      cronosTeamSlug y ninguno puede contener '__').
//  E · verde con sesión hoy · rojo sin ella · y se distingue "ya pasada"
//      de "pendiente", porque no es lo mismo descansar que no haber marcado.
//  F · ⚠️ EN UN MES PASADO NO SE PINTA "HOY". Allí "hoy" no significa nada y
//      un indicador rojo diría una mentira.
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

const SRC_UTILS = fs.readFileSync(path.join(ROOT, 'js/core/utils.js'), 'utf8');
const SRC_TREE  = fs.readFileSync(path.join(ROOT, 'js/admin/shared/category-tree.js'), 'utf8');
const SRC_CR    = fs.readFileSync(path.join(ROOT, 'js/coach/reports/club-reports.js'), 'utf8');

function entorno() {
    const win = {};
    const ctx = {
        window: win,
        console: { log(){}, warn(){}, error(){}, debug(){} },
        setTimeout, clearTimeout, Promise, Date, JSON, Object, Array, String,
        Number, Boolean, Math, RegExp, isNaN, parseInt, parseFloat, Error, Map, Set,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
        navigator: { userAgent: 'node' }
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC_UTILS, ctx);
    vm.runInContext(SRC_TREE, ctx);
    return { ctx, win };
}

// ═════════════════════════════════════════════════════════════════════
// A · SIN LOS HOOKS, EL ÁRBOL SALE EXACTAMENTE IGUAL QUE ANTES
// ═════════════════════════════════════════════════════════════════════
{
    const { win } = entorno();
    const items = [{ c: 'alevin', s: 'C', n: 'uno' }, { c: 'juvenil', s: 'B', n: 'dos' }];
    const opts = {
        items, getCat: x => x.c, getSub: x => x.s,
        renderLeaf: x => '<i>' + x.n + '</i>', emptyText: 'nada'
    };
    const sinHooks = win.ctRenderTree(opts);
    // Pasar los hooks como funciones que devuelven cadena vacía tiene que dar
    // EL MISMO HTML: es la garantía de que el punto de inserción no añade
    // separadores ni marcado por su cuenta.
    const conHooksVacios = win.ctRenderTree(Object.assign({}, opts, {
        renderSubBadge: () => '', renderCatBadge: () => ''
    }));
    ok('A1 · 🔑 con hooks que devuelven "" el HTML es idéntico',
       sinHooks === conHooksVacios,
       'longitudes ' + sinHooks.length + ' vs ' + conHooksVacios.length);

    // Y sin pasarlos, tampoco cambia respecto a un árbol construido con
    // opciones que el módulo no conoce.
    const conBasura = win.ctRenderTree(Object.assign({}, opts, { opcionInventada: true }));
    ok('A2 · una opción desconocida no altera el marcado', sinHooks === conBasura);

    ok('A3 · el árbol sigue pintando las hojas', sinHooks.indexOf('<i>uno</i>') !== -1);
    ok('A4 · y las ramas nacen PLEGADAS (sin ct-tree-open)',
       sinHooks.indexOf('ct-tree-open') === -1 ||
       sinHooks.indexOf('class="ct-tree-cat ct-tree-open"') === -1);
}

// ═════════════════════════════════════════════════════════════════════
// B · EL INDICADOR SE INYECTA EN LA CABECERA
// ═════════════════════════════════════════════════════════════════════
{
    const { win } = entorno();
    const html = win.ctRenderTree({
        items: [{ c: 'alevin', s: 'C' }],
        getCat: x => x.c, getSub: x => x.s,
        renderLeaf: () => '<i>hoja</i>',
        renderSubBadge: () => '<span id="BADGE_SUB">X</span>',
        renderCatBadge: () => '<span id="BADGE_CAT">Y</span>',
    });

    // La cabecera es todo lo que va antes de <div class="ct-tree-body">.
    const iCuerpo = html.indexOf('<div class="ct-tree-body">');
    const iCatBadge = html.indexOf('BADGE_CAT');
    ok('B1 · 🔑 el distintivo de categoría va en la CABECERA, no en el cuerpo',
       iCatBadge !== -1 && iCatBadge < iCuerpo, 'badge en ' + iCatBadge + ', cuerpo en ' + iCuerpo);

    // Para la subcategoría: su badge tiene que ir dentro de su ct-tree-head.
    const iSubHead = html.indexOf('<div class="ct-tree-sub">');
    const iSubBadge = html.indexOf('BADGE_SUB');
    const iSubBody = html.indexOf('<div class="ct-tree-body">', iSubHead);
    ok('B2 · 🔑 el distintivo de subcategoría también',
       iSubBadge !== -1 && iSubBadge > iSubHead && iSubBadge < iSubBody,
       'sub ' + iSubHead + ' badge ' + iSubBadge + ' body ' + iSubBody);

    ok('B3 · y sigue estando el contador junto a él',
       html.indexOf('ct-tree-count') !== -1);
}

// ═════════════════════════════════════════════════════════════════════
// C/D/E/F · LA VISTA DEL DIRECTOR
// ═════════════════════════════════════════════════════════════════════
function montarDirector(opts) {
    const { ctx, win } = entorno();

    const hoy = new Date();
    const hoyKey = win._cronosLocalDateKey(hoy);
    const mesActual = hoyKey.slice(0, 7);
    const lunes = new Date(hoy);
    lunes.setDate(hoy.getDate() - (hoy.getDay() === 0 ? 6 : hoy.getDay() - 1));
    lunes.setHours(0, 0, 0, 0);
    const wkKey = win._cronosLocalDateKey(lunes);

    const CLUB = 'club_x';
    const tid = (c, s) => win.cronosTeamId(CLUB, c, s);

    // Alevín C: tiene parte de asistencia Y sesión hoy, con lista pasada.
    // Juvenil B: NO tiene parte de asistencia pero SÍ sesión hoy (el caso que
    //            se perdía cuando la lista salía sólo de los partes).
    // Cadete A:  tiene parte de asistencia pero HOY no entrena.
    const partes = [{
        clubId: CLUB, teamId: tid('alevin', 'C'), month: mesActual,
        category: 'alevin', subcategory: 'C',
        sessions: { [hoyKey]: { tipo: 'entrenamiento' } },
        marks: { [hoyKey]: { ALC01: { s: 'P' }, ALC02: { s: 'P' }, ALC03: { s: 'I' } } }
    }, {
        clubId: CLUB, teamId: tid('cadete', 'A'), month: mesActual,
        category: 'cadete', subcategory: 'A',
        sessions: { '2026-08-03': { tipo: 'entrenamiento' } },
        marks: { '2026-08-03': { CDA01: { s: 'P' } } }
    }];

    const semana = { teams: {} };
    semana.teams[tid('alevin', 'C')]  = { [hoyKey]: { tipo: 'entrenamiento', hora: '17:00', lugar: 'Campo A' } };
    semana.teams[tid('juvenil', 'B')] = { [hoyKey]: { tipo: 'partido liga',  hora: '20:00', lugar: 'Campo B' } };

    // DOM mínimo: sólo hace falta el contenedor donde escribe.
    const contenedor = { innerHTML: '' };
    ctx.document.getElementById = (id) =>
        (id === 'staff-dashboard-content' ? contenedor : null);

    win._cronosCurrentUser = { uid: 'dir', clubId: CLUB, role: 'director' };
    win.cronosFetchAllTeamRosters = async () => ({ 'alevin|C': [{}], 'cadete|A': [{}] });
    win._cronosTeamRosterLabel = (c, s) => String(c) + ' ' + String(s).toUpperCase();

    vm.runInContext(SRC_CR, ctx);

    // Firestore de mentira. Se sustituye DESPUÉS de cargar el fichero: las
    // declaraciones de función de nivel superior quedan en el contexto y se
    // resuelven en cada llamada, así que la sustitución surte efecto.
    ctx._sdFS = async () => ({
        db: {},
        collection: (_db, ...p) => ({ p: p.join('/') }),
        query: (c) => c,
        where: () => ({}),
        getDocs: async () => ({ forEach: (cb) => partes.forEach(x => cb({ data: () => x })) }),
        doc: (_db, ...p) => ({ p: p.join('/') }),
        getDoc: async (ref) => ({
            exists: () => ref.p === ('trainingPlans/' + CLUB + '/weeks/' + wkKey),
            data: () => semana
        }),
    });

    win._sdAsistMes = opts && opts.mes ? opts.mes : mesActual;
    return { ctx, win, contenedor, hoyKey, mesActual, tid };
}

(async () => {

// ── D · partir el teamId ────────────────────────────────────────────
{
    const { ctx } = montarDirector();
    ok('D1 · parte un teamId de tres tramos',
       JSON.stringify(ctx._sdPartirTeamId('club-x__alevin__c')) ===
       JSON.stringify({ club: 'club-x', cat: 'alevin', sub: 'c' }));
    ok('D2 · devuelve null si no tiene tres tramos',
       ctx._sdPartirTeamId('cosa-rara') === null);
    ok('D3 · un club con guiones no rompe el reparto',
       ctx._sdPartirTeamId('club-deportivo-dia__juvenil__b').cat === 'juvenil');
}

// ── C/E · la unión de fuentes y los colores ─────────────────────────
{
    const { ctx, contenedor } = montarDirector();
    await ctx._sdLoadAsistencia();
    const html = contenedor.innerHTML;

    ok('C0 · la vista se pinta', html.length > 500, 'longitud ' + html.length);

    ok('C1 · 🔑 aparece el JUVENIL B, que entrena hoy pero NO tiene parte de asistencia',
       /juvenil\s*B/i.test(html), html.slice(0, 300));
    ok('C2 · aparece el ALEVÍN C (parte + sesión hoy)', /alevin\s*C/i.test(html));
    ok('C3 · aparece el CADETE A (parte, sin sesión hoy)', /cadete\s*A/i.test(html));

    ok('E1 · 🔑 el que entrena hoy sale en VERDE', html.indexOf('🟢') !== -1);
    ok('E2 · 🔑 el que descansa sale en ROJO/💤', html.indexOf('💤') !== -1);
    ok('E3 · el Alevín, con lista pasada, dice cuántos fueron (2 de 3)',
       /2\/3/.test(html), (html.match(/.{0,40}2\/3.{0,40}/) || [''])[0]);
    ok('E4 · 🔑 el Juvenil, sin lista pasada, se marca como PENDIENTE y no como ausencia',
       /pendiente|sin pasar lista/i.test(html));
    ok('E5 · el recuento del día cuadra: 2 con sesión, 1 descansa',
       />2<\/strong>\s*con sesión hoy/.test(html.replace(/\s+/g, ' ')) ||
       /2<\/strong> con sesión hoy/.test(html),
       (html.match(/.{0,80}con sesión hoy.{0,40}/) || [''])[0]);

    ok('C4 · 🔑 se usa el árbol de categorías, no una tabla plana',
       html.indexOf('ct-tree-cat') !== -1 && html.indexOf('<table') === -1,
       'ct-tree-cat: ' + (html.indexOf('ct-tree-cat') !== -1) + ' · table: ' + (html.indexOf('<table') !== -1));
    ok('C5 · con su cabecera de subcategoría',
       html.indexOf('Subcategoría') !== -1);
}

// ── F · un mes pasado no habla de "hoy" ─────────────────────────────
{
    const { ctx, contenedor } = montarDirector({ mes: '2020-01' });
    await ctx._sdLoadAsistencia();
    const html = contenedor.innerHTML;
    ok('F1 · ⚠️ en un mes pasado NO se pinta la tira de HOY',
       html.indexOf('📆 HOY') === -1, (html.match(/.{0,60}HOY.{0,60}/) || [''])[0]);
    ok('F2 · ⚠️ ni indicadores verdes ni rojos de actividad diaria',
       html.indexOf('🟢') === -1 && html.indexOf('💤') === -1);
}

console.log('\n' + (fail === 0 ? 'OK' : 'FALLOS') + ': ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);

})().catch(e => { console.error('EXCEPCIÓN:', e && e.stack || e); process.exit(1); });
