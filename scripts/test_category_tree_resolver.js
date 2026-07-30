// ─────────────────────────────────────────────────────────────────────────
// test_category_tree_resolver.js · FASE 2 del árbol del panel de Dirección
// (implementar.txt, 2026-07-30)
//
// POR QUÉ EXISTE ESTA FASE, que no estaba en el plan inicial: al ir a enchufar
// ctRenderTree en los tres listados del Director se vio que NO TRAEN LA
// CATEGORÍA DE LA MISMA FORMA, así que un único getCat no sirve.
//
//   · Convocatorias  (cronos_notifications type 'convocatoria')
//        → category Y subcategory en el propio doc.            ✅
//   · Informes colec.(cronos_player_reports staffReport==true)
//        → las dos en el doc, pero reports-tab.js sólo propaga category
//          al objeto agrupado por partido: la subcategoría se PERDÍA.
//   · Entrenamientos (cronos_notifications 'planificacion_semanal')
//        → NINGUNA DE LAS DOS. El payload sólo guarda coachUid.  ❌
//
// Sin resolutor, la pestaña de Entrenamientos ENTERA caería en "Sin
// clasificar" y la fase de render parecería estar rota cuando no lo estaría.
//
// LAS DOS DECISIONES DE DISEÑO QUE FIJA ESTE GUARD:
//   1. 🔑 ANTE LA DUDA, NO SE ADIVINA. Un entrenador puede llevar dos equipos
//      (p.ej. Alevín A y Cadete B). Si el doc no dice de cuál es y el autor
//      tiene más de un rol, el elemento se queda SIN CLASIFICAR. Colocarlo en
//      una rama al azar sería peor que dejarlo fuera: el Director leería el
//      informe de un equipo creyendo que es de otro.
//   2. 🔑 EL AUTOR ES coachUid, NUNCA userId/parentUid. En
//      cronos_notifications esos dos son el DESTINATARIO (ver el FIX (C3) en
//      collective-report.js y training-notify.js: se añadieron para las reglas
//      de Firestore). Resolver por ahí clasificaría cada convocatoria por la
//      categoría del PADRE que la recibe.
//
// El módulo sigue sin tocar Firestore: recibe los documentos de usuario ya
// leídos y devuelve un índice. Así se puede probar en un sandbox de vm, igual
// que la fase 1.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n')
                       .replace(/\/\*[\s\S]*?\*\//g, '');

console.log('── Resolutor de categoría/subcategoría (fase 2) ──\n');

const MOD = 'js/admin/shared/category-tree.js';
const src = leer(MOD);

function build() {
    const sb = { console: { log() {}, warn() {}, error() {} } };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(src, sb);
    return sb;
}

// ⚠️ COMPROBACIÓN PREVIA, por la misma razón que en test_category_tree.js
// PARTE 0 y en test_nav_stack.js PARTE 21: sin la API, las partes siguientes
// lanzarían y el guard MORIRÍA sin imprimir el total y con exit 0 — o sea
// pareciendo que todo fue bien. Un guard tiene que dar ROJO, no reventar.
const API = ['ctBuildCoachIndex', 'ctResolveCatSub'];
const _sbApi = build();
const _faltan = API.filter(k => typeof _sbApi[k] !== 'function');
const API_OK = _faltan.length === 0;
ok('0 · el módulo expone el resolutor', API_OK, 'faltan: ' + _faltan.join(', '));

// Documentos de usuario tal como los devuelve la colección `users`: la forma
// la fija js/admin/club/panel.js (raíz para mono-rol, allRoles[] para multi).
const USERS = [
    // Mono-rol en la raíz.
    { id: 'u_ana', role: 'user', category: 'alevin', subcategory: 'A' },
    // Multi-rol: DOS equipos. Es el caso ambiguo del punto 1.
    { id: 'u_bea', role: 'user', allRoles: [
        { role: 'user', category: 'alevin',  subcategory: 'B' },
        { role: 'user', category: 'cadete',  subcategory: 'A' },
    ] },
    // Categoría con tilde y prefijo de modalidad, como llega de un partido.
    { id: 'u_caz', role: 'user', allRoles: [
        { role: 'user', category: 'F7_Alevín', subcategory: 'C' },
    ] },
    // Un PADRE y un DIRECTOR: no son autores de informes, no deben indexarse.
    { id: 'u_pad', role: 'parent',   category: 'infantil', subcategory: 'A' },
    { id: 'u_dir', role: 'director', category: 'juvenil',  subcategory: 'B' },
    // Entrenador individual: otro nombre de rol para lo mismo.
    { id: 'u_ind', role: 'entrenador_individual', category: 'regional', subcategory: 'A' },
    // Entrenador con rol válido pero sin subcategoría (histórico: es lo que
    // deja _cMatchSubcatFor cuando no encuentra coincidencia exacta).
    { id: 'u_sin', role: 'user', category: 'benjamin', subcategory: '' },
];

// ═══════ PARTE 1 · el índice de autores ═══════
console.log('── PARTE 1 · ctBuildCoachIndex ──');
if (!API_OK) { ok('1 · omitida: falta el resolutor', false); } else {
    const sb = build();
    const idx = sb.ctBuildCoachIndex(USERS);

    ok('1a · indexa al entrenador mono-rol', !!idx.get('u_ana'));
    ok('1b · con su categoría y subcategoría',
       idx.get('u_ana').roles.length === 1 &&
       idx.get('u_ana').roles[0].cat === 'alevin' &&
       idx.get('u_ana').roles[0].sub === 'A',
       JSON.stringify(idx.get('u_ana')));
    ok('1c · indexa las DOS ramas del multi-rol', idx.get('u_bea').roles.length === 2,
       JSON.stringify(idx.get('u_bea')));

    // 🔑 Normaliza al construir: si no, 'F7_Alevín' nunca casaría con 'alevin'.
    ok('1d · 🔑 normaliza la categoría del rol al indexar',
       idx.get('u_caz').roles[0].cat === 'alevin',
       JSON.stringify(idx.get('u_caz')));

    // 🔑 Padres y directores NO son autores. Si entraran, un informe sin
    // categoría escrito por alguien que también es padre podría resolverse por
    // la categoría de su hijo.
    ok('1e · 🔑 NO indexa a los padres', !idx.get('u_pad'));
    ok('1f · 🔑 ni a los directores',    !idx.get('u_dir'));
    ok('1g · sí al entrenador individual', !!idx.get('u_ind'));

    // El rol sin subcategoría se indexa igual (sirve para completar la
    // categoría), pero su sub queda vacía.
    ok('1h · indexa el rol sin subcategoría, con sub vacía',
       !!idx.get('u_sin') && idx.get('u_sin').roles[0].cat === 'benjamin' &&
       idx.get('u_sin').roles[0].sub === '', JSON.stringify(idx.get('u_sin')));

    ok('1i · no revienta con lista vacía ni con null', (() => {
        try { return sb.ctBuildCoachIndex([]).size === 0 && sb.ctBuildCoachIndex(null).size === 0; }
        catch (_) { return false; }
    })());
    ok('1j · ignora documentos sin id', (() => {
        const v = sb.ctBuildCoachIndex([{ role: 'user', category: 'alevin', subcategory: 'A' }]);
        return v.size === 0;
    })());
}

// ═══════ PARTE 2 · la resolución ═══════
console.log('\n── PARTE 2 · ctResolveCatSub ──');
if (!API_OK) { ok('2 · omitida: falta el resolutor', false); } else {
    const sb = build();
    const idx = sb.ctBuildCoachIndex(USERS);
    const R = (item) => sb.ctResolveCatSub(item, idx);

    // — Caso convocatoria: el doc lo dice todo. Ni se mira al autor. —
    const conv = R({ category: 'Alevín', subcategory: 'A', coachUid: 'u_bea' });
    ok('2a · el doc manda: cat', conv.cat === 'alevin', JSON.stringify(conv));
    ok('2b · el doc manda: sub', conv.sub === 'A', JSON.stringify(conv));
    ok('2c · 🔑 y NO se resuelve por el autor aunque sea ambiguo',
       conv.source === 'doc', JSON.stringify(conv));

    // — Caso entrenamiento: el doc no trae nada, el autor tiene UN solo equipo. —
    const tr = R({ coachUid: 'u_ana' });
    ok('2d · 🔑 sin datos en el doc, resuelve por el autor de un solo equipo',
       tr.cat === 'alevin' && tr.sub === 'A', JSON.stringify(tr));
    ok('2e · y lo marca como resuelto por autor', tr.source === 'autor',
       JSON.stringify(tr));

    // — Caso histórico: el doc trae categoría pero la subcategoría vino ''. —
    const media = R({ category: 'F7_Alevin', subcategory: '', coachUid: 'u_caz' });
    ok('2f · 🔑 completa SÓLO la subcategoría que falta, desde el rol que casa',
       media.cat === 'alevin' && media.sub === 'C', JSON.stringify(media));

    // El multi-rol SÍ se puede resolver si el doc dice la categoría: sólo una
    // de sus dos ramas casa.
    const desamb = R({ category: 'cadete', subcategory: '', coachUid: 'u_bea' });
    ok('2g · el multi-rol se desambigua con la categoría del doc',
       desamb.cat === 'cadete' && desamb.sub === 'A', JSON.stringify(desamb));

    // — 🔑 LA DECISIÓN 1: ambigüedad → sin clasificar, no se adivina. —
    const amb = R({ coachUid: 'u_bea' });
    ok('2h · 🔑 autor con DOS equipos y doc mudo → NO se adivina',
       amb.cat === '' && amb.sub === '', JSON.stringify(amb));
    ok('2i · y se marca como ambiguo, para poder explicarlo en la UI',
       amb.source === 'ambiguo', JSON.stringify(amb));

    // — 🔑 LA DECISIÓN 2: el destinatario NO es el autor. —
    const dest = R({ userId: 'u_ana', parentUid: 'u_ana' });
    ok('2j · 🔑 userId/parentUid (el DESTINATARIO) no se usan como autor',
       dest.cat === '' && dest.sub === '', JSON.stringify(dest));

    // Autor desconocido (ya no está en el club, o fuera del limit de la query).
    const desc = R({ coachUid: 'u_fantasma' });
    ok('2k · autor desconocido → sin clasificar, sin lanzar',
       desc.cat === '' && desc.sub === '', JSON.stringify(desc));

    // El rol del autor tampoco tiene sub: no se puede completar.
    const nis = R({ coachUid: 'u_sin' });
    ok('2l · autor cuyo único rol no tiene subcategoría → sin clasificar',
       nis.sub === '', JSON.stringify(nis));

    // Robustez: nada de excepciones con entradas degeneradas.
    ok('2m · no revienta sin índice ni con item vacío', (() => {
        try { sb.ctResolveCatSub({}, null); sb.ctResolveCatSub(null, idx); return true; }
        catch (_) { return false; }
    })());

    // Campos alternativos del nombre de la categoría (categoryLabel lo usan los
    // docs de usuario y algún informe antiguo).
    const lbl = R({ categoryLabel: 'Infantil', subcategory: 'B' });
    ok('2n · acepta categoryLabel además de category',
       lbl.cat === 'infantil' && lbl.sub === 'B', JSON.stringify(lbl));

    // Se puede sobreescribir de dónde salen los campos (los informes agrupados
    // por partido no tienen la misma forma que las notificaciones).
    const opts = sb.ctResolveCatSub({ c: 'Cadete', s: 'A' }, idx,
        { getCat: (i) => i.c, getSub: (i) => i.s });
    ok('2o · getCat/getSub se pueden inyectar',
       opts.cat === 'cadete' && opts.sub === 'A', JSON.stringify(opts));
}

// ═══════ PARTE 3 · encaja con el agrupado de la fase 1 ═══════
console.log('\n── PARTE 3 · integración con ctGroupByCatSub ──');
if (!API_OK) { ok('3 · omitida: falta el resolutor', false); } else {
    const sb = build();
    const idx = sb.ctBuildCoachIndex(USERS);

    // Tres entrenamientos SIN categoría en el doc, como los de verdad.
    const items = [
        { _id: 't1', coachUid: 'u_ana' },   // resoluble → alevin/A
        { _id: 't2', coachUid: 'u_ind' },   // resoluble → regional/A
        { _id: 't3', coachUid: 'u_bea' },   // ambiguo   → sin clasificar
    ];
    const res = items.map(it => ({ it, r: sb.ctResolveCatSub(it, idx) }));
    const g = sb.ctGroupByCatSub(res, x => x.r.cat, x => x.r.sub);

    ok('3a · 🔑 el entrenamiento resuelto cae en su rama',
       (g.byCatSub.get('alevin') || new Map()).get('A').length === 1);
    ok('3b · y el del entrenador individual en la suya',
       (g.byCatSub.get('regional') || new Map()).get('A').length === 1);
    ok('3c · 🔑 el ambiguo va a "Sin clasificar", NO desaparece',
       g.sinClasificar.length === 1 && g.sinClasificar[0].it._id === 't3',
       JSON.stringify(g.sinClasificar.map(x => x.it._id)));

    // La cuenta cuadra: es la misma garantía que la 4e de la fase 1, pero ahora
    // pasando por el resolutor.
    const clasificados = [...g.byCatSub.values()]
        .reduce((n, m) => n + [...m.values()].reduce((k, a) => k + a.length, 0), 0);
    ok('3d · no desaparece ningún elemento',
       clasificados + g.sinClasificar.length === items.length,
       clasificados + '+' + g.sinClasificar.length + ' de ' + items.length);
}

// ═══════ PARTE 4 · los datos en origen ═══════
console.log('\n── PARTE 4 · que los docs nuevos ya traigan la categoría ──');
{
    // El resolutor es el respaldo para el HISTÓRICO. Los entrenamientos nuevos
    // deben guardar su categoría, para no depender de resolver por autor (que
    // falla justo en el caso del entrenador con dos equipos).
    const tn = sinCom(leer('js/coach/comms/training-notify.js'));
    const payload = tn.slice(tn.indexOf('notifPayload'), tn.indexOf('notifPayload') + 700);
    ok('4a · 🔑 el payload de entrenamiento guarda category',
       /category:/.test(payload), payload.slice(0, 200));
    ok('4b · 🔑 y subcategory',    /subcategory:/.test(payload), payload.slice(0, 200));

    // reports-tab.js agrupa los informes por partido y construye un objeto
    // nuevo; si no copia subcategory, el dato SE PIERDE aunque esté en
    // Firestore, y todos los informes caerían en "Sin clasificar".
    const rt = sinCom(leer('js/coach/reports/reports-tab.js'));
    ok('4c · 🔑 reports-tab propaga subcategory al agrupar por partido',
       /subcategory:\s*r\.subcategory/.test(rt));
    ok('4d · y sigue propagando category', /category:\s*r\.category/.test(rt));

    // Que el módulo compartido siga siendo el único sitio del vocabulario y
    // que no se haya colado una dependencia de Firestore en él.
    const m = sinCom(src);
    ok('4e · 🔑 el módulo sigue sin tocar Firestore',
       !/firebasejs|getDocs|collection\(/.test(m));
    ok('4f · el resolutor reutiliza ctNormCat, no una copia nueva',
       /ctNormCat\(/.test(m) && (m.match(/normalize\('NFD'\)/g) || []).length === 1,
       'normalize NFD aparece ' + (m.match(/normalize\('NFD'\)/g) || []).length + ' veces');
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
