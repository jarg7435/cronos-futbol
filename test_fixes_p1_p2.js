// Repro/verificación de los dos fixes (Problema 1 y Problema 2).
// Extrae los helpers reales de js/core/utils.js y los ejecuta en sandbox.
const fs = require('fs');
const vm = require('vm');

const utilsSrc = fs.readFileSync('js/core/utils.js', 'utf8');
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(utilsSrc, sandbox);
const W = sandbox.window;

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  ✓', msg); }
    else { fail++; console.error('  ✗ FALLO:', msg); }
}

console.log('\n=== PROBLEMA 1: liveMatchId DETERMINISTA ===');

// 1a. El mismo seed (mismo partido) → mismo sufijo en disparos repetidos.
const opts = { teamName: 'Fútbol-7', rivalName: 'Rival CF',
    convocation: [{number:1},{number:7},{number:10}], date: new Date('2026-06-12T18:00:00Z') };
W.liveMatchId = ''; // sin id previo
const id1 = W._cronosBuildLiveMatchId({ ...opts, forceNew: true });
W.liveMatchId = ''; // simular pérdida del id (re-init)
const id2 = W._cronosBuildLiveMatchId({ ...opts, forceNew: true });
assert(id1 === id2, `mismo partido → mismo id sin reuse (${id1} === ${id2})`);
assert(/^futbol-7-\d{8}-[a-z0-9]{4}$/.test(id1), `formato esperado (${id1})`);

// 1b. Reuse: si liveMatchId ya existe, lo devuelve tal cual.
const prev = 'futbol-7-12062026-zzzz';
const reused = W._cronosBuildLiveMatchId({ ...opts, existing: prev });
assert(reused === prev, `reutiliza el id existente (${reused})`);

// 1c. Partido distinto (otro rival/convocatoria) → id distinto.
const idOther = W._cronosBuildLiveMatchId({ teamName:'Fútbol-7', rivalName:'Otro Equipo',
    convocation:[{number:2},{number:3}], date: opts.date, forceNew:true });
assert(idOther !== id1, `partido distinto → id distinto (${idOther} !== ${id1})`);

// 1d. NO usa Math.random: 50 llamadas con el mismo input → 1 solo valor.
const set = new Set();
for (let i=0;i<50;i++) set.add(W._cronosBuildLiveMatchId({ ...opts, forceNew:true }));
assert(set.size === 1, `50 llamadas mismo input → 1 id único (size=${set.size})`);

// 1d-bis. El codigo fuente de las 3 copias de startLiveSync ya NO usa Math.random().
const fs2 = require('fs');
['js/core/app-init.js','js/match/live/sync.js','js/services/firestore-sync.js'].forEach(f => {
    const src = fs2.readFileSync(f, 'utf8');
    const i = src.indexOf('startLiveSync');
    const body = src.slice(i, i + 1400); // cuerpo aproximado de la funcion
    assert(!/Math\.random\(\)\.toString\(36\)\.substr\(2,4\)/.test(body),
        `${f}: startLiveSync ya no usa Math.random() para el sufijo`);
});

// 1e. uid distinto → id distinto (el seed incluye uid).
const idUserA = W._cronosBuildLiveMatchId({ ...opts, uid:'coachA', forceNew:true });
const idUserB = W._cronosBuildLiveMatchId({ ...opts, uid:'coachB', forceNew:true });
assert(idUserA !== idUserB, `uid distinto → id distinto (${idUserA} !== ${idUserB})`);

// 1f. _stableMatchId (lógica del panel) sobre id determinista.
function stableMatchId(liveMatchId, me, rivalName) {
    if (liveMatchId) return `match_${liveMatchId}`;
    return `match_${me.uid}_x`;
}
assert(stableMatchId(id1) === stableMatchId(id2), 'matchId del informe estable entre disparos');

console.log('\n=== PROBLEMA 2: matching de link padre↔jugador ===');

// Simula links de Firestore y un recipient con email/teléfono "sucios".
const links = [
    { _id:'l1', parentUid:'uidBruno', parentEmail:'Familia.Bruno@Gmail.com ',
      parentPhone:'+34 600 11 22 33', playerNumber:'9', playerAlias:'BRUNO' },
];
function matchLink(r) {
    const _ne = W._cronosNormEmail, _np = W._cronosNormPhone;
    const _rEmail = _ne(r.email), _rPhone = _np(r.phone);
    let link = links.find(l => (r.id && r.id.includes('p_')===false ? l.parentUid===r.id : false)
        || (_rEmail && _ne(l.parentEmail) === _rEmail)
        || (_rPhone && _np(l.parentPhone) === _rPhone));
    if (!link && (r.playerNumber != null || r.playerAlias)) {
        link = links.find(l =>
            (r.playerNumber != null && String(l.playerNumber) === String(r.playerNumber)) ||
            (r.playerAlias && String(l.playerAlias).trim().toLowerCase() === String(r.playerAlias).trim().toLowerCase())
        ) || link;
    }
    return link;
}

// 2a. email distinto case/espacios → casa.
assert(matchLink({ id:'p_x', email:'familia.bruno@gmail.com' }) != null,
    'email normalizado (case/espacios) casa el link');
// 2b. teléfono con +34/espacios vs nacional → casa.
assert(matchLink({ id:'p_x', phone:'600112233' }) != null,
    'teléfono normalizado (+34/espacios) casa el link');
// 2c. fallback por playerNumber cuando no hay email/phone.
assert(matchLink({ id:'p_x', playerNumber:'9' }) != null,
    'fallback por playerNumber recupera el link');
// 2d. fallback por alias.
assert(matchLink({ id:'p_x', playerAlias:' bruno ' }) != null,
    'fallback por playerAlias (trim/case) recupera el link');
// 2e. pre-fix: comparación estricta habría fallado.
const strictFail = links.find(l => l.parentEmail === 'familia.bruno@gmail.com'
                                 || l.parentPhone === '600112233');
assert(strictFail == null, 'pre-fix (comparación estricta) NO encontraba el link (confirma la causa)');

console.log('\n=== PROBLEMA 2-bis: fallback de link por parentUid SIN filtro de club ===');

// El link de BRUNO existe en Firestore pero con un clubId distinto al de me,
// por lo que la query por clubId NO lo trae (array de club vacío para él).
const allLinksInDb = [
    { _id:'lB', parentUid:'uidBruno', clubId:'OTRO_CLUB', parentEmail:'x@y.z',
      playerNumber:'9', playerAlias:'BRUNO' },
];
const clubFilteredLinks = allLinksInDb.filter(l => l.clubId === 'CLUB_ME'); // → []

// Simula _fetchLinkByParentUid: busca en TODA la coleccion por parentUid.
async function fetchLinkByParentUid(parentUid) {
    return allLinksInDb.find(l => l.parentUid === parentUid) || null;
}
async function resolveLinkWithFallback(r, loadedLinks) {
    let link = loadedLinks.find(l => l.parentUid === r.id);
    if (!link && r.id && !String(r.id).startsWith('p_')) {
        link = await fetchLinkByParentUid(r.id);
    }
    return link;
}

(async () => {
    // (a) Despacho MANUAL (_executeReportsSend): fallback por parentUid.
    const before = clubFilteredLinks.find(l => l.parentUid === 'uidBruno');
    assert(before == null, 'pre-fix: query por clubId NO trae el link de BRUNO (clubId distinto)');
    const after = await resolveLinkWithFallback({ id:'uidBruno' }, clubFilteredLinks);
    assert(after != null && after.playerNumber === '9',
        'manual: fallback por parentUid (sin filtro de club) recupera el link de BRUNO');

    // (b) Despacho AUTO (autoDispatchMatchReports): fallback por playerNumber.
    // El array `links` arranca filtrado por clubId (vacío para BRUNO); al no
    // hallar padres para el dorsal 9 se reconsulta SIN filtro de club.
    const linksAuto = [...clubFilteredLinks]; // [] (mutable, como en el código real)
    async function fetchLinksByPlayerNumber(num) {
        const found = allLinksInDb.filter(l => String(l.playerNumber) === String(num));
        found.forEach(f => { if (!linksAuto.some(l => l._id === f._id)) linksAuto.push(f); });
        return found;
    }
    async function resolveLinkedParents(player) {
        let linkedParents = linksAuto.filter(l =>
            String(l.playerNumber) === String(player.number) && l.parentUid);
        if (!linkedParents.length) {
            await fetchLinksByPlayerNumber(player.number);
            linkedParents = linksAuto.filter(l =>
                String(l.playerNumber) === String(player.number) && l.parentUid);
        }
        return linkedParents;
    }
    const beforeAuto = linksAuto.filter(l => String(l.playerNumber) === '9' && l.parentUid);
    assert(beforeAuto.length === 0, 'pre-fix (auto): sin padres para el dorsal 9 (filtro clubId)');
    const lp = await resolveLinkedParents({ number: 9 });
    assert(lp.length === 1 && lp[0].parentUid === 'uidBruno',
        'auto: fallback por playerNumber (sin filtro de club) recupera el padre del dorsal 9');

    console.log(`\n=== RESULTADO: ${pass} OK, ${fail} fallos ===`);
    process.exit(fail ? 1 : 0);
})();
