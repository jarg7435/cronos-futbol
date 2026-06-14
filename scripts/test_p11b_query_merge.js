// Test P11-b: la fusion de las dos queries (clubId+staffReport / staffUids)
// combina por id, sobrevive a fallos parciales y filtra defensivamente.

function combine(snapA, snapB) {
  const map = new Map();
  if (snapA.status === 'fulfilled') snapA.value.forEach(d => map.set(d.id, d));
  if (snapB.status === 'fulfilled') snapB.value.forEach(d => {
    if (!map.has(d.id) && d.data().staffReport === true) map.set(d.id, d);
  });
  return map;
}
const mk = (id, staffReport) => ({ id, data: () => ({ staffReport }) });
function snap(docs) { return { status:'fulfilled', value:{ forEach:f=>docs.forEach(f), size:docs.length } }; }
const rejected = { status:'rejected', reason:{ code:'permission-denied' } };

let pass = true;
const assert = (c,m)=>{ if(!c){pass=false;console.error('FAIL:',m);} else console.log('ok:',m); };

// Caso 1: ambas ok, con solapamiento por id -> dedup
let r = combine(snap([mk('a',true),mk('b',true)]), snap([mk('b',true),mk('c',true)]));
assert(r.size === 3, 'fusion dedup por id (a,b,c)');

// Caso 2: query A falla por permisos -> seguimos con B
r = combine(rejected, snap([mk('x',true),mk('y',true)]));
assert(r.size === 2, 'resiliencia: A falla, B aporta 2 docs');

// Caso 3: B trae un doc sin staffReport=true (no debe entrar)
r = combine(snap([mk('a',true)]), snap([mk('z',false)]));
assert(r.size === 1 && r.has('a') && !r.has('z'), 'filtro defensivo staffReport en B');

// Caso 4: ambas fallan -> map vacio (panel mostrara "sin informes")
r = combine(rejected, rejected);
assert(r.size === 0, 'ambas fallan -> vacio sin crash');

console.log(pass ? '\nALL TESTS PASSED' : '\nTESTS FAILED');
process.exit(pass ? 0 : 1);
