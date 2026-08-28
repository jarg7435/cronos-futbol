// ─────────────────────────────────────────────────────────────────────────
// test_finished_index.js  ·  v639
//
// El índice ligero de PARTIDOS TERMINADOS (`finished_index`): un documento por
// PARTIDO, espejo de `cronos_player_reports` (que guarda uno por JUGADOR y
// partido, ~31). Medido en producción: 5.436 informes / 10,5 MB para pintar
// 176 partidos en un solo club; 390 partidos en toda la plataforma.
//
// Lo que este guard protege, y por qué cada cosa:
//
//  1 · LOS TRES FLUJOS INDEXAN. Hay tres vías de despacho (automática al
//      terminar, manual, e informe colectivo) y las tres tienen que escribir el
//      índice, o la lista se queda coja según por dónde se enviara. Escribirlo
//      a mano en cada una habría sido el mismo defecto en tres ficheros — la
//      lección de v551 —, así que va por un helper compartido y aquí se cuenta.
//
//  2 · NO PUEDE IR EN UN BATCH con los informes. Un batch es atómico: si el
//      índice fallara se caería el despacho entero. Es la misma razón que ya
//      razonó `_pushLiveIndex` en v572, y hay que impedir que alguien lo
//      "optimice" juntándolos.
//
//  3 · EL ÍNDICE ACELERA, NO MANDA. Si no devuelve nada, el lector cae al
//      camino de v638. Sin esa propiedad no se podría desplegar sin backfill.
//
//  4 · MUERE CON SU TITULAR. Un índice que sobreviva a un borrado es PEOR que
//      no tener índice: el partido desaparece de los informes y su tarjeta
//      sigue en la lista, con la PII dentro.
//
//  5 · GUARDA EL ENTERO, NO EL ARRAY. La tarjeta sólo usa `events.length`.
//      Guardar `events` devolvería el problema que esto arregla.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let fail = 0, pass = 0;
const ok = (n, c, e) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (e !== undefined) console.log('       ' + JSON.stringify(e)); }
};

console.log('── finished_index · el índice ligero de partidos terminados (v639) ──\n');

const MOD  = leer('js/match/live/finished-index.js');
const TAB  = leer('js/coach/reports/finished-matches-tab.js');

// ═══════════ PARTE 1 · los TRES flujos indexan, por el helper ═══════════
console.log('── PARTE 1 · los tres flujos de despacho ──');

const FLUJOS = [
    ['js/coach/comms/match-reports-auto.js', 'despacho automático al terminar'],
    ['js/coach/comms/match-reports-send.js', 'despacho manual'],
    ['js/coach/comms/collective-report.js',  'informe colectivo'],
];

FLUJOS.forEach(([ruta, nombre]) => {
    const src = sinCom(leer(ruta));
    const llamadas = (src.match(/window\._cronosIndexarPartidoTerminado\(\{/g) || []).length;
    ok('1' + (FLUJOS.findIndex(f => f[0] === ruta) + 1) + ' · ' + nombre + ' indexa UNA vez',
       llamadas === 1,
       { ruta, llamadas, porque: '0 = ese flujo deja la lista coja; 2+ = está dentro del bucle de jugadores' });
});

ok('1d · 🔑 ninguno escribe `finished_index` a mano (va por el helper compartido)',
   FLUJOS.every(([ruta]) => !/'finished_index'/.test(sinCom(leer(ruta)))),
   'tres copias de la misma escritura es el defecto de v551');

// ═══════════ PARTE 2 · el módulo ═══════════
console.log('\n── PARTE 2 · el módulo ──');

ok('2a · publica las tres funciones',
   /window\._cronosIndexarPartidoTerminado = /.test(MOD) &&
   /window\._cronosBorrarIndicePartido\s+= /.test(MOD) &&
   /window\._cronosNormalizarIndicePartido = /.test(MOD));

// ⚠️ SOBRE `sinCom`: la primera versión de esta aserción miraba el fichero
//    ENTERO y salía roja con el código correcto, porque la CABECERA del módulo
//    explica por qué no se usa writeBatch — y ahí está la palabra. Es la misma
//    trampa que ya rompió un guard en v568 (un comentario que citaba un mensaje
//    de consola). Se mide el CÓDIGO, no la prosa que lo explica.
ok('2b · ⚠️⚠️ NO usa writeBatch: un batch atómico tumbaría el despacho entero',
   !/writeBatch/.test(sinCom(MOD)),
   'ver la cabecera del módulo y el razonamiento de _pushLiveIndex (v572)');

ok('2c · la escritura va envuelta en try/catch y NO propaga',
   /catch \(e\) \{[\s\S]{0,400}console\.warn\('\[v639\]/.test(MOD));

ok('2d · escribe con merge sobre un id determinista (el matchId) → idempotente',
   /setDoc\(doc\(fa\.db, 'finished_index', idx\.matchId\), idx, \{ merge: true \}\)/.test(MOD));

// ── Ejecución real de la normalización ──
{
    const sb = { window: {}, console: { warn() {} }, Number, String, Array, Date, Boolean };
    vm.createContext(sb);
    vm.runInContext(MOD, sb);
    const norm = sb.window._cronosNormalizarIndicePartido;

    const r = norm({
        matchId: 'm1', clubId: 'c1', coachUid: 'u1', coachEmail: 'a@b.c',
        homeName: 'CD DÍA', awayName: 'Rival FC',
        scoreHome: 3, scoreAway: '1',
        category: 'f11_juvenil', subcategory: 'A', mode: 'f11',
        matchDate: '2026-08-17', createdAt: '2026-08-17T18:00:00.000Z',
        eventsCount: 12, events: [1, 2, 3],
    });

    ok('2e · 🔑 NO guarda el array `events`, sólo el entero',
       r.events === undefined && r.eventsCount === 12,
       { events: r.events, eventsCount: r.eventsCount });
    ok('2f · los marcadores salen como NÚMERO aunque entren como texto',
       r.homeScore === 3 && r.awayScore === 1 && typeof r.awayScore === 'number');
    ok('2g · ⚠️ createdAt es una CADENA ISO: es lo que hace fiable el orderBy',
       typeof r.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r.createdAt));
    ok('2h · sin createdAt se pone uno, nunca queda vacío',
       typeof norm({ matchId: 'm2' }).createdAt === 'string' &&
       norm({ matchId: 'm2' }).createdAt.length > 10);
    ok('2i · `createdBy` cae a `coachUid` cuando falta (y al revés)',
       norm({ matchId: 'm3', coachUid: 'u9' }).createdBy === 'u9' &&
       norm({ matchId: 'm4', createdBy: 'u8' }).coachUid === 'u8');
    ok('2j · un eventsCount ausente es 0, no NaN',
       norm({ matchId: 'm5' }).eventsCount === 0);

    // ══════════════════════════════════════════════════════════════
    //  ⏳ v640 · LA VENTANA DE 10 h VIAJA EN EL PROPIO DOCUMENTO
    //
    //  Regla de negocio: la sección es un registro TEMPORAL de 10 h desde el
    //  final (2 h de margen para corregir + 8 h para descargar). El índice es
    //  la VISTA de esa sección, así que lleva su propia caducidad — es lo que
    //  permite al paso C de cleanupLiveMatches recogerlo sin releer nada.
    // ══════════════════════════════════════════════════════════════
    ok('2k · 🔑 sella `expireAt` a 10 h del final',
       Math.abs(Date.parse(r.expireAt) - (Date.parse(r.finishedAt) + 10 * 3600000)) < 2000,
       { finishedAt: r.finishedAt, expireAt: r.expireAt });
    ok('2l · 🔑 el ancla es `finishedAt`, no la hora de escritura',
       r.finishedAt === '2026-08-17T18:00:00.000Z');
    {
        // Sin `finishedAt` explícito cae a `createdAt`, que es cuando se
        // despacha el informe — o sea, el final del partido a efectos prácticos.
        const s = norm({ matchId: 'm6', createdAt: '2026-08-20T10:00:00.000Z' });
        ok('2m · sin finishedAt explícito, el ancla es createdAt',
           s.finishedAt === '2026-08-20T10:00:00.000Z' &&
           Math.abs(Date.parse(s.expireAt) - (Date.parse(s.finishedAt) + 10 * 3600000)) < 2000);
    }
}

// ═══════════ PARTE 3 · el lector prefiere el índice y sabe caerse ═══════════
console.log('\n── PARTE 3 · el lector ──');

ok('3a · consulta `finished_index` acotada y ORDENADA',
   /collection\(db, 'finished_index'\)/.test(TAB) &&
   /orderBy\('createdAt', 'desc'\)/.test(TAB) &&
   /limit\(_TOPE_INDICE\)/.test(TAB));

ok('3b · 🔑 y por las DOS identidades que admiten las reglas',
   /where\('clubId', '==', clubId\)[\s\S]{0,200}where\('coachUid', '==', me\.uid\)/.test(TAB));

ok('3c · 🔑🔑 si el índice no devuelve nada, SE SIGUE por el camino largo',
   /_indiceSirvio = vistosIdx\.size > 0;/.test(TAB) &&
   /if \(!_indiceSirvio\) try \{/.test(TAB),
   'sin esto, desplegar antes del backfill dejaría la pestaña VACÍA');

ok('3d · el array de sucesos se reconstruye por TAMAÑO, no se guarda',
   /events: new Array\(Number\(x\.eventsCount\) \|\| 0\)/.test(TAB),
   'la tarjeta sólo escribe events.length');

ok('3e · ⚠️ lo que ya vino de live_matches no se pisa con el índice',
   /if \(finishedMap\.has\(d\.id\)\) return;/.test(TAB));

// ═══════════ PARTE 4 · muere con su titular ═══════════
console.log('\n── PARTE 4 · borrado (un índice huérfano es una fuga de PII) ──');

{
    const reset = sinCom(leer('js/admin/superadmin/season-reset.js'));
    ok('4a · 🔑 vaciar la temporada arrastra el índice con los INFORMES',
       /cronos_player_reports:\s*\['finished_index'\]/.test(reset),
       'y no como acompañante de live_matches: ése ya tiene live_index');
}
ok('4b · 🔑 borrar un club borra también su índice',
   /_borrarPorClub\('finished_index'\)/.test(sinCom(leer('js/admin/superadmin/delete-club.js'))));
ok('4c · 🔑 purgar un partido borra su índice',
   /deleteDoc\(mod\.doc\(db, 'finished_index', mid\)\)/.test(sinCom(leer('js/coach/reports/match-purge.js'))));
ok('4d · ⚠️ y ese borrado no puede tumbar la purga (va en su propio catch)',
   /finished_index', mid\)\); \}\s*\n\s*catch/.test(leer('js/coach/reports/match-purge.js')));

// ══════════ PARTE 4bis · el barrido de los caducados (v640) ══════════
{
    const fn = sinCom(leer('functions/index.js'));
    ok('4e · 🔑 cleanupLiveMatches recoge los índices CADUCADOS',
       /collection\('finished_index'\)[\s\S]{0,120}where\('expireAt', '<'/.test(fn),
       'sin esto la vista se acumularía para siempre, como avisaba v572 de live_index');
    // ⚠️ ANCLADO EN CÓDIGO, NO EN EL COMENTARIO. La primera versión buscaba la
    //    cadena "PASO C", que vive en un comentario `/* */` — y `sinCom` los
    //    quita, así que salía roja con el código correcto. Segunda vez en esta
    //    misma tanda; la lección de v568 se cobra sola si no se respeta.
    ok('4f · ⚠️ va en su PROPIA consulta y su propio lote, no colgado del paso B',
       /const loteC = db\.batch\(\)/.test(fn) && /loteC\.commit\(\)/.test(fn),
       'los ids no coinciden: live_matches usa el id del partido y finished_index el matchId del despacho');
    ok('4g · ⚠️ y en su propio try/catch: no puede tumbar los pasos A y B',
       /paso C \(indices de terminados\)/.test(fn));
    {
        // El bloque del barrido, acotado por CÓDIGO: desde su consulta hasta su commit.
        const ini = fn.indexOf("collection('finished_index')");
        const fin2 = fn.indexOf('loteC.commit()');
        const bloque = (ini >= 0 && fin2 > ini) ? fn.slice(ini, fin2) : '';
        ok('4h · ⚠️⚠️ el barrido NO toca cronos_player_reports',
           bloque.length > 0 && !/cronos_player_reports/.test(bloque),
           'los informes permanecen toda la temporada: aquí sólo se recoge la vista');
    }
}

// ═══════════ PARTE 5 · dado de alta en los tres sitios ═══════════
console.log('\n── PARTE 5 · alta del módulo ──');
ok('5a · index.html lo carga', /js\/match\/live\/finished-index\.js\?v=/.test(leer('index.html')));
ok('5b · va DESPUÉS de sync.js (comparte su familia de helpers)',
   leer('index.html').indexOf('finished-index.js') > leer('index.html').indexOf('match/live/sync.js'));
ok('5c · está en el precache del service worker',
   /'\.\/js\/match\/live\/finished-index\.js'/.test(leer('sw.js')));
ok('5d · está en la lista de _check_syntax.js',
   /'js\/match\/live\/finished-index\.js'/.test(leer('scripts/_check_syntax.js')));

// ═══════════ PARTE 6 · reglas e índices compuestos ═══════════
console.log('\n── PARTE 6 · reglas e índices ──');
{
    const rules = leer('firestore.rules');
    const bloque = rules.slice(rules.indexOf('match /finished_index/{matchId}'));
    const cuerpo = sinCom(bloque.slice(0, bloque.indexOf('\n    match /', 1)));

    ok('6a · existe el bloque de reglas', rules.includes('match /finished_index/{matchId}'));
    ok('6b · la lectura exige usuario REGISTRADO (lleva PII, como live_index)',
       /allow read: if isRegisteredUser\(\)/.test(cuerpo));
    ok('6c · 🔑 cubre las dos consultas del lector (clubId y coachUid)',
       /get\('clubId', null\)/.test(cuerpo) && /get\('coachUid', null\)/.test(cuerpo));
    ok('6d · ⚠️ ninguna lectura cruda resource.data.<campo> (una clave ausente LANZA)',
       (cuerpo.match(/resource\.data\.(?!get\()[a-zA-Z_]+/g) || []).length === 0,
       (cuerpo.match(/resource\.data\.(?!get\()[a-zA-Z_]+/g) || []));

    const idx = JSON.parse(leer('firestore.indexes.json')).indexes
        .filter(i => i.collectionGroup === 'finished_index')
        .map(i => i.fields.map(f => f.fieldPath + ':' + f.order).join('+'));
    ok('6e · 🔑 los DOS índices compuestos que exige el orderBy están declarados',
       idx.includes('clubId:ASCENDING+createdAt:DESCENDING') &&
       idx.includes('coachUid:ASCENDING+createdAt:DESCENDING'),
       idx);
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
