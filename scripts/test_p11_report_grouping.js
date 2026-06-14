// Test P11: el panel de informes agrupa correctamente partidos distintos.
// Reproduce el bug: dos partidos diferentes contra el MISMO rival el MISMO día
// deben mostrarse como DOS tarjetas, no una.

function groupReports(docs) {
  const matches = {};
  docs.forEach(r => {
    const key = (r.matchId && String(r.matchId).trim())
      ? `mid:${r.matchId}`
      : `${r.matchDate || 'sin-fecha'}_${r.rival || 'sin-rival'}_${r.coachUid || ''}`;
    if (!matches[key]) {
      matches[key] = { key, matchId: r.matchId || r._id || '', matchDate: r.matchDate,
        rival: r.rival, scoreHome: r.scoreHome, scoreAway: r.scoreAway,
        coachUid: r.coachUid, venue: undefined, players: [] };
    }
    const grp = matches[key];
    ['matchDate','rival','scoreHome','scoreAway','coachUid','venue'].forEach(f => {
      if ((grp[f] === undefined || grp[f] === null || grp[f] === '') &&
          r[f] !== undefined && r[f] !== null && r[f] !== '') grp[f] = r[f];
    });
    grp.players.push(r);
  });
  // dedup por número
  Object.values(matches).forEach(m => {
    const byNum = {};
    m.players.forEach(p => {
      const k = String(p.playerNumber || p._id);
      if (!byNum[k] || (p.history||[]).length > (byNum[k].history||[]).length) byNum[k] = p;
    });
    m.players = Object.values(byNum);
  });
  return Object.values(matches);
}

const today = '2026-06-14';
// Partido 1 vs Rival A, matchId match1 (2 jugadores, staff_match_report con fecha=hoy)
// Partido 2 vs Rival A, matchId match2 (2 jugadores) — mismo rival, mismo día
const docs = [
  { _id:'match1_staff_p1', matchId:'match1', matchDate:today, rival:'Rival A', coachUid:'c1', staffReport:true, playerNumber:'1', goals:0, history:[] },
  { _id:'match1_staff_p2', matchId:'match1', matchDate:today, rival:'Rival A', coachUid:'c1', staffReport:true, playerNumber:'2', goals:1, history:[{type:'goal'}] },
  { _id:'match2_staff_p1', matchId:'match2', matchDate:today, rival:'Rival A', coachUid:'c1', staffReport:true, playerNumber:'1', goals:2, history:[] },
  { _id:'match2_staff_p2', matchId:'match2', matchDate:today, rival:'Rival A', coachUid:'c1', staffReport:true, playerNumber:'2', goals:0, history:[] },
  // Partido 1 también enviado por la ruta collective (matchId match1) con fecha real + venue
  { _id:'match1_p1', matchId:'match1', matchDate:'2026-06-08', rival:'Rival A', coachUid:'c1', venue:'Campo Norte', staffReport:true, playerNumber:'1', goals:0, history:[{type:'sub_in'}] },
];

const result = groupReports(docs);

let pass = true;
function assert(cond, msg) { if (!cond) { pass = false; console.error('FAIL:', msg); } else console.log('ok:', msg); }

// Antes del fix: matchDate+rival+coach colapsaba match1+match2 en 1 tarjeta.
assert(result.length === 2, 'debe haber 2 partidos distintos (no colapsados)');

const m1 = result.find(m => m.matchId === 'match1');
const m2 = result.find(m => m.matchId === 'match2');
assert(!!m1 && !!m2, 'ambos matchId presentes');
// match1 dedup: 2 jugadores únicos aunque haya 3 docs (2 staff + 1 collective)
assert(m1.players.length === 2, 'match1 dedup a 2 jugadores (no 3)');
assert(m2.players.length === 2, 'match2 con 2 jugadores');
// metadata enriquecida: venue tomado del doc collective; matchDate real preferida si llegó primero
assert(m1.venue === 'Campo Norte', 'venue heredado de cualquier doc del grupo');
// el jugador #1 de match1 conserva el doc con más historial (collective con sub_in)
const p1 = m1.players.find(p => p.playerNumber === '1');
assert((p1.history||[]).length === 1, 'jugador con historial más completo conservado');

console.log(pass ? '\nALL TESTS PASSED' : '\nTESTS FAILED');
process.exit(pass ? 0 : 1);
