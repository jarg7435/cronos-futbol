// ─────────────────────────────────────────────────────────────────────────
// test_live_cleanup_and_reads.js  ·  borrado a 10 h en servidor + lecturas
// filtradas (v431)
//
// Peticion del autor tras el analisis de rendimiento:
//   1. Borrado automatico de 'live_matches' EN SERVIDOR, a las 10 h de
//      TERMINAR el partido.
//   2. refreshBackgroundWatchers() deja de descargarse la coleccion entera y
//      pasa a filtrar con 'where'.
//
// EL PROBLEMA QUE SE ARREGLA, con numeros:
//   · refreshBackgroundWatchers hacia getDocs(collection(...)) SIN filtro cada
//     30 s POR ESPECTADOR. lecturas/hora = espectadores × 120 × documentos.
//     Con 20 partidos y 200 espectadores: 480.000 lecturas/hora. Ese era el
//     techo real de la app — las escrituras (1 cada 5 s por partido, contra el
//     limite de ~1/s por documento) nunca lo fueron.
//   · La limpieza vivia SOLO en el navegador: si nadie abria la app, los
//     documentos —con nombres y dorsales de MENORES— se quedaban ahi.
//
// LAS CUATRO TRAMPAS QUE ESTE GUARD FIJA:
//
//  A · EL ANCLA ES finishedAt, NO updatedAt. Cualquier retoque posterior del
//      documento reescribe updatedAt y habria ido aplazando el borrado para
//      siempre.
//
//  B · PERO LA CONSULTA VA POR updatedAt. Un where('finishedAt','<',x) NO
//      devuelve los documentos que no tienen el campo: Firestore los excluye
//      del indice. Los partidos anteriores a v431 no se borrarian JAMAS. Se
//      consulta por updatedAt (existe en todos) y el ancla se decide en codigo.
//
//  C · NADA DE `campo: cond ? x : undefined` EN UN PAYLOAD DE FIRESTORE. El
//      SDK LANZA con undefined salvo que la instancia use
//      ignoreUndefinedProperties, que aqui no se usa. Un ternario asi en el
//      snapshot habria reventado el latido en CADA envio.
//
//  D · LAS CONSULTAS FILTRADAS NECESITAN INDICES. Sin ellos fallan, y si el
//      fallback silencioso se traga el error el escaneo completo sigue vivo
//      para siempre sin sintoma. Los indices tienen que estar declarados.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Toda asercion negativa va contra CODIGO, no contra comentarios (lección ya
// pagada tres veces en este proyecto).
// ⚠️ v434 · `split(/\r?\n/)` Y NO `split('\n')`. En JavaScript el `.` de una
// regex NO casa `\r` (es terminador de línea, igual que `\n`), así que en un
// fichero con CRLF la línea queda con un `\r` final, `//.*$` no llega hasta el
// final y NO SE BORRABA NI UN COMENTARIO. functions/index.js es CRLF: todas las
// aserciones negativas contra FNc llevaban tiempo evaluándose sobre el fuente
// CON comentarios, que es exactamente lo que este helper existe para evitar.
// Se descubrió en v434, cuando una aserción nueva casó con el comentario que yo
// mismo acababa de escribir describiendo el código que había quitado.
const sinComs = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

const FN    = read('functions/index.js');
const SYNC  = read('js/match/live/sync.js');
const LIVE  = read('live.html');
const IDX   = JSON.parse(read('firestore.indexes.json'));
const FNc   = sinComs(FN);
const SYNCc = sinComs(SYNC);
const LIVEc = sinComs(LIVE);

console.log('── borrado a 10 h en servidor y lecturas filtradas (v431) ──\n');

// ═══════════ PARTE 1 · la funcion programada existe y es de servidor ═══════════
console.log('── PARTE 1 · la Cloud Function ──');
{
    ok('1a · existe cleanupLiveMatches y esta exportada',
       /exports\.cleanupLiveMatches\s*=/.test(FNc), 'no hay funcion de limpieza');
    ok('1b · es PROGRAMADA (pubsub.schedule), no depende de que nadie abra la app',
       /exports\.cleanupLiveMatches[\s\S]{0,200}pubsub[\s\S]{0,80}\.schedule\(/.test(FNc));
    ok('1c · corre al menos una vez por hora',
       /\.schedule\(\s*'every 60 minutes'\s*\)/.test(FNc) ||
       /\.schedule\(\s*'every \d+ minutes'\s*\)/.test(FNc),
       'un intervalo mas largo aleja el borrado de las 10 h pedidas');
    ok('1d · opera sobre live_matches',
       /cleanupLiveMatches[\s\S]{0,2500}collection\('live_matches'\)/.test(FNc));
}

// ═══════════ PARTE 2 · el criterio de las 10 horas ═══════════
console.log('\n── PARTE 2 · 10 h desde que TERMINA el partido ──');
{
    const cuerpo = FNc.slice(FNc.indexOf('exports.cleanupLiveMatches'));

    ok('2a · el corte son 10 horas',
       /10\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(cuerpo), 'el corte no son 10 h');

    ok('2b · [TRAMPA A] el ancla del borrado es finishedAt, no updatedAt',
       /finishedAt\s*\|\|[\s\S]{0,40}updatedAt/.test(cuerpo),
       'con updatedAt como ancla, cualquier retoque aplaza el borrado');

    // ⚠️ v434 · ASERCIÓN REESCRITA. Antes exigía literalmente el
    // `where('updatedAt','<',corte10h)`, y ESO ERA EL DEFECTO: reintroducía por
    // la puerta de atrás el aplazamiento que el ancla `finishedAt` existe para
    // evitar — cualquier escritura posterior al final refrescaba `updatedAt`,
    // el documento salía de la consulta y el borrado se retrasaba otras 10 h.
    // La preocupación legítima que defendía (no anclar la CONSULTA a un campo
    // que puede faltar, porque un `where`/`orderBy` excluye los documentos sin
    // él) se mantiene: se sigue sin tocar `finishedAt` en la consulta.
    ok('2c · [TRAMPA B] la consulta NO se ancla a finishedAt, que puede faltar',
       !/where\('finishedAt'/.test(cuerpo) && !/orderBy\('finishedAt'/.test(cuerpo),
       'los partidos anteriores a v431 no tienen ese campo y quedarian excluidos para siempre');

    ok('2c2 · [v434] y tampoco filtra por updatedAt, que aplazaba el borrado',
       !/where\('updatedAt',\s*'<'\s*,\s*corte10h\)/.test(cuerpo),
       'una edicion posterior al final retrasaba el borrado otras 10 h');

    ok('2d · borra los cerrados: finished Y cancelled',
       /where\('status',\s*'in',\s*\['finished',\s*'cancelled'\]\)/.test(cuerpo),
       'un partido cancelado se quedaba indefinidamente y ya nadie puede borrarlo a mano');

    ok('2e · cierra tambien los ABANDONADOS (active sin latido), o nunca llegarian a borrarse',
       /where\('status',\s*'==',\s*'active'\)/.test(cuerpo) &&
       /4\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(cuerpo),
       'un partido que el entrenador no cerro se queda active para siempre');

    ok('2f · sin fecha utilizable NO borra (mas vale un documento de mas)',
       /if\s*\(!finMs\)\s*return;/.test(cuerpo));

    // Tope de 500 operaciones por batch: pasarse hace fallar el commit ENTERO.
    //
    // ⚠️ v572 · ESTE GUARD MIRABA EL NUMERO, NO EL INVARIANTE. Exigia
    // `.limit(4xx)` literal, dando por hecho que cada partido gasta UNA
    // operacion de lote. Desde P2 gasta DOS —el partido y su `live_index`—, asi
    // que un `.limit(450)` que el guard aprobaba serian 900 operaciones y el
    // commit fallaria entero: el guard habria seguido verde sobre el fallo
    // exacto que existe para impedir. Ahora se mide lo que importa de verdad:
    // documentos por pasada x operaciones por documento < 500.
    const _seccionesLote = [
        { nombre: 'A', re: /loteA\.(update|set|delete|create)\s*\(/g },
        { nombre: 'B', re: /loteB\.(update|set|delete|create)\s*\(/g },
    ];
    const _limites = (cuerpo.match(/\.limit\(\s*(\d+)\s*\)/g) || [])
        .map(s => parseInt(s.replace(/\D/g, ''), 10));
    let _loteOk = _limites.length >= 2;
    let _detalle = [];
    _seccionesLote.forEach((sec, i) => {
        const ops = (cuerpo.match(sec.re) || []).length;
        const lim = _limites[i];
        if (!lim || !ops) { _loteOk = false; return; }
        _detalle.push(`paso ${sec.nombre}: ${lim} docs x ${ops} ops = ${lim * ops}`);
        if (lim * ops > 500) _loteOk = false;
    });
    ok('2g · cada pasada cabe en el tope de 500 operaciones por batch (' +
       _detalle.join(' · ') + ')',
       _loteOk,
       'documentos_por_pasada x operaciones_por_documento tiene que quedar por debajo de 500');
}

// ═══════════ PARTE 3 · el sello de finalizacion ═══════════
console.log('\n── PARTE 3 · quien escribe finishedAt ──');
{
    ok('3a · pushLiveSnapshot sella finishedAt al pasar a finished',
       /status\s*===\s*'finished'[\s\S]{0,300}snapshot\.finishedAt\s*=\s*serverTimestamp\(\)/.test(SYNCc),
       'sin sello, el borrado no tiene ancla');

    ok('3b · [TRAMPA C] el sello va en un if, NO como ternario con undefined',
       /if\s*\(status\s*===\s*'finished'\)\s*\{[\s\S]{0,400}snapshot\.finishedAt/.test(SYNCc),
       'un ternario a undefined revienta el latido en CADA envio');

    ok('3c · y en el payload del snapshot no queda ningun `: undefined`',
       !/:\s*undefined\s*,/.test(SYNCc.slice(SYNCc.indexOf('const snapshot = {'),
                                             SYNCc.indexOf('await setDoc(doc(fa.db'))),
       'el SDK lanza con undefined; no lo ignora');

    ok('3d · escribe tambien expireAt, por si se activa la TTL nativa',
       /snapshot\.expireAt\s*=/.test(SYNCc));
}

// ═══════════ PARTE 4 · las lecturas filtradas ═══════════
console.log('\n── PARTE 4 · se acabo el escaneo completo ──');
{
    ok('4a · refreshBackgroundWatchers ya no barre la coleccion sin filtro',
       !/const snap = await getDocs\(collection\(db, "live_matches"\)\);/.test(LIVEc),
       'sigue el escaneo completo cada 30 s por espectador');

    ok('4b · existe el resolutor con consultas filtradas',
       /_fetchFollowableMatches/.test(LIVEc));

    // Las tres condiciones que ya evaluaba _userCanFollow, ahora como consultas.
    ok('4c · filtra por club',      /where\("clubId",\s*"==",\s*userData\.clubId\)/.test(LIVEc));
    ok('4d · filtra por creador',   /where\("createdBy",\s*"==",\s*userData\.uid\)/.test(LIVEc));
    ok('4e · filtra por email del entrenador',
       /where\("coachEmail",\s*"==",\s*userData\.email\)/.test(LIVEc));
    ok('4f · y siempre acota por status active',
       (LIVEc.match(/where\("status",\s*"==",\s*"active"\)/g) || []).length >= 3,
       'sin acotar por estado se siguen trayendo los terminados');

    ok('4g · el criterio sigue siendo UNO SOLO: el resultado pasa por _userCanFollow',
       /candidatos\.forEach\([\s\S]{0,120}_userCanFollow/.test(LIVEc),
       'dos criterios distintos acabarian divergiendo');

    ok('4h · [TRAMPA D] `where` esta IMPORTADO en live.html',
       /import \{[\s\S]{0,200}\bwhere\b[\s\S]{0,80}firebase-firestore\.js/.test(LIVE),
       'sin importarlo, la consulta lanza ReferenceError, el catch la absorbe y el escaneo completo sigue vivo SIN sintoma');

    ok('4i · hay respaldo al escaneo completo si la consulta falla',
       /catch\s*\(errIdx\)[\s\S]{0,400}getDocs\(collection\(db, "live_matches"\)\)/.test(LIVEc),
       'sin respaldo, una falta de indice deja al usuario sin alertas');

    // El segundo escaneo completo, el del arranque de la app.
    ok('4j · cleanupStaleMatches tampoco barre ya toda la coleccion',
       /collection\(fa\.db, 'live_matches'\)[\s\S]{0,120}where\('clubId'/.test(SYNCc),
       'seguia trayendo los partidos de todos los clubes al navegador de cada usuario');
}

// ═══════════ PARTE 5 · los indices ═══════════
console.log('\n── PARTE 5 · indices declarados ──');
{
    const idxLive = (IDX.indexes || []).filter(i => i.collectionGroup === 'live_matches');
    const tiene = (a, b) => idxLive.some(i =>
        (i.fields || []).length === 2 &&
        i.fields[0].fieldPath === a && i.fields[1].fieldPath === b);

    ok('5a · (status, updatedAt) — el que usa la Cloud Function', tiene('status', 'updatedAt'),
       JSON.stringify(idxLive.map(i => i.fields.map(f => f.fieldPath))));
    ok('5b · (status, clubId)',     tiene('status', 'clubId'));
    ok('5c · (status, createdBy)',  tiene('status', 'createdBy'));
    ok('5d · (status, coachEmail)', tiene('status', 'coachEmail'));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
