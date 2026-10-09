// ════════════════════════════════════════════════════════════════════
//  🔒 v794 · «RECUPERAR PARTIDO»: CUENTA EXACTA + EQUIPO EXACTO
//
//  Encargo del autor (implementar.txt 2026-10-09, capturas 11282-11287):
//  «solo debe mostrar los que pertenezcan estrictamente a la cuenta de
//  usuario activa y a la categoría/subcategoría exacta seleccionada».
//   · Cuenta A (Alevín C + Regional B), pestaña Alevín C: aparecía un
//     «REGIONAL B · Alevín» — ranura SIN sello de equipo, que v793 dejaba
//     pasar («sin sello = de nadie»).
//   · Cuenta B (Nacional A, un equipo): aparecía un «ALEVÍN C» de la nube, y
//     v793 sólo filtraba con dos equipos o más.
//  Y dos vías de fuga entre cuentas: la ranura que se escribía SIN DUEÑO en
//  la recarga de «Cerrar Sesión», y el autoguardado/latido firmando con la
//  cuenta en sesión en vez de con la del partido.
//
//  Ejecuta el código REAL: local-uid.js, match-slots.js, utils.js, el
//  autoguardado de app-init.js y el filtro de la nube de setup-modal.js.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ  = path.join(__dirname, '..');
const leer  = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const UIDJS = leer('js/core/local-uid.js');
const SLOTS = leer('js/core/match-slots.js');
const UTILS = leer('js/core/utils.js');
const APP   = leer('js/core/app-init.js');
const SETUP = leer('js/core/setup-modal.js');
const SYNC  = leer('js/match/live/sync.js');

let fallos = 0, total = 0;
function ok(n, c, d) { total++; if (c) console.log('  ✓ ' + n);
    else { fallos++; console.log('  ✗ ' + n + (d !== undefined ? '\n      ' + String(d).slice(0, 300) : '')); } }
const trozo = (src, a, b) => { const i = src.indexOf(a), f = src.indexOf(b, i + 1); return (i < 0 || f < 0) ? '' : src.slice(i, f); };

// ── Un navegador: localStorage REAL-ish (prototipo Storage que local-uid envuelve)
function navegador() {
    class Storage {
        constructor() { this._m = new Map(); }
        getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
        setItem(k, v) { this._m.set(k, String(v)); }
        removeItem(k) { this._m.delete(k); }
    }
    const crea = () => { const raw = new Storage();
        return new Proxy(raw, { ownKeys: () => Array.from(raw._m.keys()),
            getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
            get: (t, p) => t[p] }); };
    const sb = { console: { log() {}, warn() {}, error() {} }, Storage, Object, JSON, Date, Array, String, Number, Math };
    sb.window = sb;
    sb.localStorage = crea();
    sb.sessionStorage = crea();
    sb.document = { getElementById: () => null };
    sb.navigator = {}; sb.setTimeout = () => {};
    vm.createContext(sb);
    vm.runInContext(UIDJS, sb);
    vm.runInContext(UTILS, sb);
    vm.runInContext(SLOTS, sb);
    return sb;
}
const estado = (o) => Object.assign({ savedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    matchPhase: '1st_half', masterTimeH1: 900, players: [{ id: 1 }], teamNames: { home: 'X', away: 'Y' } }, o);

console.log('\n── PARTE 1 · el inventario estricto de ranuras (local-uid + match-slots reales) ──');
const B = navegador();
const S = B._cronosMatchSlots;
const CLUB = 'club_mqvr9m11_g9kj';
const ALE_C = B.cronosTeamId(CLUB, 'alevin', 'C');
const REG_B = B.cronosTeamId(CLUB, 'regional', 'B');
const NAC_A = B.cronosTeamId('club_otro', 'nacional', 'A');
const como = (uid) => { B._cronosCurrentUser = uid ? { uid } : null; };

como('uA');
S.guardar('m-ale', estado({ teamId: ALE_C, ownerUid: 'uA', teamNames: { home: 'ALEVIN C', away: 'R' } }));
S.guardar('m-reg', estado({ teamId: REG_B, ownerUid: 'uA', teamNames: { home: 'REGIONAL B', away: 'R' } }));
// Ranura de antes de v794: sin ownerUid, pero con la clave a MI nombre (v720).
S.guardar('m-ale-viejo', estado({ teamId: ALE_C }));
// [CAPTURA 11283] Ranura SIN sello de equipo (la que v793 dejaba pasar).
B.localStorage.setItem('cronos_active_match_v2::m-sinsello',
    JSON.stringify(estado({ teamId: '', ownerUid: 'uA', category: 'f7_alevin' })));
como(null);
// Escrita en el instante de «Cerrar Sesión»: clave SIN dueño.
B.localStorage.setItem('cronos_active_match_v2::m-huerfana', JSON.stringify(estado({ teamId: ALE_C })));
como('uB');
S.guardar('m-otra-cuenta', estado({ teamId: ALE_C, ownerUid: 'uB', teamNames: { home: 'ALEVIN C', away: 'R' } }));
S.guardar('m-nac', estado({ teamId: NAC_A, ownerUid: 'uB', teamNames: { home: 'NACIONAL A', away: 'R' } }));

const ids = (l) => l.map(x => x.id).sort().join(',');
como('uA');
let l = S.listar(ALE_C, { estricto: true });
ok('1a · 🔑🔑 [CAPTURA 11283] cuenta A, Alevín C: sólo SUS ranuras del Alevín C', ids(l) === 'm-ale,m-ale-viejo', ids(l));
ok('1b · 🔑 la ranura SIN sello de equipo ya no se cuela', !l.some(x => x.id === 'm-sinsello'));
ok('1c · 🔑 la ranura SIN dueño (escrita al cerrar sesión) no se le enseña a nadie',
   !l.some(x => x.id === 'm-huerfana'));
ok('1d · 🔑🔑 la ranura del mismo equipo de OTRA cuenta no aparece', !l.some(x => x.id === 'm-otra-cuenta'));
l = S.listar(REG_B, { estricto: true });
ok('1e · cuenta A, Regional B: sólo el Regional B', ids(l) === 'm-reg', ids(l));

como('uB');
l = S.listar(NAC_A, { estricto: true });
ok('1f · 🔑🔑 [CAPTURA 11286] cuenta B, Nacional A: sólo su Nacional A, ningún Alevín', ids(l) === 'm-nac', ids(l));
l = S.listar(ALE_C, { estricto: true });
ok('1g · y si la cuenta B mirara el Alevín C, sólo vería LO SUYO', ids(l) === 'm-otra-cuenta', ids(l));

como(null);
ok('1h · ⚠️ sin cuenta en sesión no se ofrece NADA', S.listar(ALE_C, { estricto: true }).length === 0 &&
   S.listar(undefined, { estricto: true }).length === 0);

como('uA');
B.cronosEquipoElegido = () => ALE_C;
const e = S.elegir();
ok('1i · el banner de retomar usa la misma regla estricta', e && (e.id === 'm-ale' || e.id === 'm-ale-viejo'),
   JSON.stringify(e && e.id));
const sinFiltro = ids(S.listar(ALE_C));
ok('1j · ⚠️ el modo NO estricto se conserva para los usos internos (borrado por id)',
   sinFiltro.indexOf('m-sinsello') >= 0, sinFiltro);

console.log('\n── PARTE 2 · el autoguardado REAL sólo escribe a nombre de la cuenta del partido ──');
const DUENO_SRC = trozo(APP, 'function _cronosUidActual()', 'function _saveMatchStateToStorage()');
const FICHA_SRC = trozo(APP, 'function cronosFichaPartido(', 'window.cronosFichaPartido = cronosFichaPartido;');
const MEM_SRC   = trozo(APP, 'function _fichaEnMemoria(', '// Para el latido a la nube');
const SAVE_SRC  = trozo(APP, 'function _saveMatchStateToStorage()', 'window._saveMatchStateToStorage = _saveMatchStateToStorage;');
ok('2a · se encuentran el dueño, la ficha y el autoguardado',
   DUENO_SRC.length > 200 && FICHA_SRC.length > 200 && MEM_SRC.length > 200 && SAVE_SRC.length > 400);

function autoguardar(uid, dueño) {
    let escrito = null;
    const ctx = { console, JSON, Date, Object, Array, String, Number,
        matchPhase: '1st_half', isRunning: true, masterTimeH1: 300, masterTimeH2: 0,
        half1MaxTime: 2100, half2MaxTime: 2100, TEAM_NAMES: { home: 'ALEVIN C', away: 'R' }, COLORS: {},
        currentMode: 'f7', liveMatchId: 'm-x', analyzeAway: false,
        document: { getElementById: (id) => ({ textContent: '0', value: id === 'match-category' ? 'f7_alevin' : 'C' }) } };
    ctx.window = { players: [{ id: 1 }], _cronosExtraGoals: { home: 0, away: 0 },
        _cronosCurrentUser: uid ? { uid } : null, _cronosMatchOwnerUid: dueño || null,
        _currentMatchCategory: 'f7_alevin', _currentMatchSubcategory: 'C' };
    ctx._slots = () => ({ leer: () => null, guardar: (id, st) => { escrito = st; },
                          uidActual: () => (ctx.window._cronosCurrentUser || {}).uid || '' });
    ctx._miSlotId = () => 'm-x';
    ctx._equipoDelPartidoEnMemoria = () => ALE_C;
    vm.createContext(ctx);
    vm.runInContext(DUENO_SRC + FICHA_SRC + '\n' + MEM_SRC + '\n' + SAVE_SRC +
                    '\n;globalThis.__g = _saveMatchStateToStorage;', ctx);
    ctx.__g();
    return { st: escrito, dueño: ctx.window._cronosMatchOwnerUid };
}
let r = autoguardar('uA', 'uA');
ok('2b · 🔑 la ranura sale FIRMADA con la cuenta dueña (ownerUid)', r.st && r.st.ownerUid === 'uA',
   JSON.stringify(r.st && r.st.ownerUid));
r = autoguardar(null, 'uA');
ok('2c · 🔑🔑 al «Cerrar Sesión» (sin cuenta) NO se escribe la ranura huérfana', r.st === null);
r = autoguardar('uB', 'uA');
ok('2d · 🔑🔑 con OTRA cuenta en sesión no se escribe el partido de la primera', r.st === null);
r = autoguardar('uA', null);
ok('2e · un partido sin dueño todavía lo adopta la cuenta que lo guarda',
   r.st && r.st.ownerUid === 'uA' && r.dueño === 'uA');

console.log('\n── PARTE 3 · la nube: sólo la cuenta dueña escribe, sólo lo mío se enseña ──');
ok('3a · 🔑 el latido no escribe si la sesión no es la dueña del partido',
   /async function _emiteLatido\(status = 'active'\) \{[\s\S]{0,700}?!window\.cronosPuedeEscribirPartido\(\)\) return;/.test(SYNC));
ok('3b · nacer o retomar un partido fija su cuenta dueña (los tres caminos)',
   /window\._cronosFichaEnMemoria = null;[\s\S]{0,200}?window\._cronosMatchOwnerUid = _cronosUidActual\(\)/.test(APP) &&
   /window\._cronosMatchOwnerUid = _cronosUidActual\(\) \|\| state\.ownerUid/.test(APP) &&
   /window\._cronosMatchOwnerUid = _uidR \|\| m\.createdBy/.test(SETUP));

const FILTRO = trozo(SETUP, 'const _equipoDeDoc = (d) => {', 'if (_eqSel && _eqSelNombre) {');
ok('3c · se encuentra el filtro de documentos de la nube', /const _docEsMio = \(d\) =>/.test(FILTRO));
function docEsMio(me, eqSel, doc) {
    const ctx = { me, _eqSel: eqSel, window: { cronosTeamId: B.cronosTeamId, cronosSinModalidad: B.cronosSinModalidad },
                  String, Object };
    vm.createContext(ctx);
    vm.runInContext(FILTRO + '\n;globalThis.__f = _docEsMio;', ctx);
    return ctx.__f(doc);
}
const yoA = { uid: 'uA', email: 'entrenador.a@club.es', clubId: CLUB };
const yoB = { uid: 'uB', email: 'nacional.b@club.es', clubId: 'club_otro' };
ok('3d · un documento mío y de mi equipo SÍ se enseña',
   docEsMio(yoA, ALE_C, { createdBy: 'uA', coachEmail: 'Entrenador.A@club.es', teamId: ALE_C }));
ok('3e · 🔑🔑 [CAPTURA 11286] el Alevín C no aparece en el Nacional A de otra cuenta',
   !docEsMio(yoB, NAC_A, { createdBy: 'uB', coachEmail: 'nacional.b@club.es', teamId: ALE_C }));
ok('3f · 🔑 un documento con el correo de OTRA cuenta no se enseña aunque traiga mi uid',
   !docEsMio(yoB, NAC_A, { createdBy: 'uB', coachEmail: 'entrenador.a@club.es', teamId: NAC_A }));
ok('3g · de otra cuenta, nunca', !docEsMio(yoA, ALE_C, { createdBy: 'uB', teamId: ALE_C }));
ok('3h · 🔑 sin sello y sin categoría del partido NO se enseña (no se puede atribuir)',
   !docEsMio(yoA, ALE_C, { createdBy: 'uA', teamId: null, matchCategory: null }));
ok('3i · sin sello pero con la categoría DEL PARTIDO exacta, sí',
   docEsMio(yoA, ALE_C, { createdBy: 'uA', teamId: null, matchCategory: 'f7_alevin', matchSubcategory: 'C', clubId: CLUB }));
ok('3j · ⚠️ misma categoría, OTRA letra: no (subcategoría exacta)',
   !docEsMio(yoA, ALE_C, { createdBy: 'uA', teamId: null, matchCategory: 'f7_alevin', matchSubcategory: 'B', clubId: CLUB }));

console.log('\n── PARTE 4 · el panel aplica la regla SIEMPRE ──');
ok('4a · 🔑 se filtra por equipo también con UN solo equipo (captura 11286)',
   /if \(_act\) \{\s*_eqSel = _act;/.test(SETUP));
ok('4b · las ranuras del dispositivo se piden en modo estricto',
   /_S \? _S\.listar\(_eqSel \|\| undefined, \{ estricto: true \}\)/.test(SETUP));
ok('4c · y los documentos de la nube pasan por _docEsMio, sin borrarse',
   /\} else if \(!_docEsMio\(data\)\) \{/.test(SETUP));

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '' : '  ✅'));
process.exit(fallos ? 1 : 0);
