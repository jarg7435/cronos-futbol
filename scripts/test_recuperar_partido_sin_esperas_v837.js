// ════════════════════════════════════════════════════════════════════════
//  test_recuperar_partido_sin_esperas_v837.js
//  🧊 «RECUPERAR PARTIDO» YA NO SE QUEDA PENSANDO — v837
// ════════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-10-25): la primera pulsación de «Recuperar
//  Partido» tardaba muchísimo en iPad y móvil. Lo mismo que Evento Perdido
//  (v836): esperas de red SIN TOPE. La primera vez se reclama la plaza del
//  equipo (session-lock.js) y su setDoc, con caché persistente, no vuelve
//  hasta que el servidor confirma; luego la consulta de live_matches. Y el
//  botón no cambiaba, así que se volvía a pulsar.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const LOCK  = leer('js/services/auth/session-lock.js');
const SETUP = leer('js/core/setup-modal.js');

// Un aparato con una nube que NO CONTESTA a lo que se le pida (`cuelga`).
// El tope se baja a 60 ms en la copia de la prueba para no esperar 8 s.
function aparato(cuelga) {
    const docs = {};
    const nunca = () => new Promise(() => {});
    const api = {
        m: {
            doc: (db, col, id) => ({ _id: id }),
            getDoc: (ref) => cuelga.getDoc ? nunca()
                : Promise.resolve({ exists: () => !!docs[ref._id], data: () => docs[ref._id] }),
            setDoc: (ref, data, op) => {
                if (cuelga.setDoc) return nunca();
                docs[ref._id] = (op && op.merge) ? Object.assign({}, docs[ref._id] || {}, data) : data;
                return Promise.resolve();
            },
            onSnapshot: () => () => {},
        },
        db: {},
    };
    const almacen = {}, sesion = {};
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        Date, Math, JSON, String, Number, Promise, Object, Array,
        location: { hostname: 'cronos-futbol-app.web.app' },
        setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout,
        navigator: { userAgent: 'iPad; CPU OS 17 Safari', maxTouchPoints: 5 },
        localStorage: { getItem: k => (k in almacen ? almacen[k] : null), setItem: (k, v) => { almacen[k] = String(v); }, removeItem: k => { delete almacen[k]; } },
        sessionStorage: { getItem: k => (k in sesion ? sesion[k] : null), setItem: (k, v) => { sesion[k] = String(v); }, removeItem: k => { delete sesion[k]; } },
        document: { createElement: () => ({ style: {}, querySelector: () => ({ addEventListener() {} }), remove() {}, addEventListener() {} }),
                    body: { appendChild() {} }, visibilityState: 'visible', addEventListener() {} },
    };
    ctx.window = {
        _cronosCurrentUser: { uid: 'u1', _activeRole: 'user', clubId: 'clubA' },
        _cronosExtraEnabled: () => true,
        cronosMyTeamId: () => 'eq_alevin_c',
        cronosMyTeam: () => ({ teamId: 'eq_alevin_c', categoryLabel: 'Alevín', subcategory: 'C' }),
        addEventListener() {},
        escapeHtml: s => String(s),
        cronosSesionFS: async () => api,
    };
    ctx.window.window = ctx.window;
    vm.createContext(ctx);
    vm.runInContext(LOCK.replace('var TOPE_RED_MS = 8000;', 'var TOPE_RED_MS = 60;'), ctx);
    return { w: ctx.window, docs };
}
const conReloj = async (p, ms) => {
    const t0 = Date.now();
    const r = await Promise.race([p, new Promise(res => setTimeout(() => res('__COLGADO__'), ms))]);
    return { r, ms: Date.now() - t0 };
};

console.log('\n🧊  RECUPERAR PARTIDO SIN ESPERAS ETERNAS (v837)\n' + '─'.repeat(70));

// Si algo se queda colgado, Node saldría con 0 sin terminar: eso es un FALLO.
let terminado = false;
process.on('beforeExit', () => { if (!terminado) { console.log('❌ la prueba se quedó colgada sin terminar'); process.exit(1); } });

(async () => {
    // ── 1 · La plaza (session-lock.js), EJECUTADA ───────────────────────
    ok('1a · el tope existe y vale 8 s', /var TOPE_RED_MS = 8000;/.test(LOCK) && /function _conTope\(promesa, ms\)/.test(LOCK));
    {
        const A = aparato({ setDoc: true });
        const { r } = await conReloj(A.w.cronosSesionReclama('clave1'), 2000);
        ok('1b · 🔑 la ESCRITURA de la marca no vuelve → reclamar termina igual', r !== '__COLGADO__', r);
        ok('1c · y cuenta como hecha (va en la cola local), no «sin comprobar»', r && r.ok === true && !r.sinComprobar, r);
    }
    {
        const A = aparato({ getDoc: true });
        const { r } = await conReloj(A.w.cronosSesionReclama('clave1'), 2000);
        ok('1d · la LECTURA no vuelve → entra sin comprobar (fail-open de siempre)', r && r.ok === true && r.sinComprobar === true, r);
    }
    {
        const A = aparato({ getDoc: true, setDoc: true });
        const { r } = await conReloj(A.w.cronosSesionAlAbrirPartido(), 2000);
        ok('1e · 🔑 la puerta del partido entera no se queda colgada', r === true, r);
        const { r: r2 } = await conReloj(A.w.cronosSesionLibera(), 2000);
        ok('1f · soltar la plaza tampoco', r2 !== '__COLGADO__', r2);
    }
    {
        const A = aparato({});
        const { r } = await conReloj(A.w.cronosSesionReclama('clave1'), 2000);
        ok('1g · con red normal todo sigue igual: marca escrita', r && r.ok === true && !!A.docs.clave1 && A.docs.clave1.uid === 'u1', r);
    }

    // ── 2 · El botón: bloqueo inmediato y una sola carga ────────────────
    const ini = SETUP.indexOf('const _RECUPERAR_TOPE_MS');
    const fin = SETUP.indexOf('async function _openLiveMatchRecoveryCuerpo()');
    ok('2a · el envoltorio existe delante del cuerpo', ini > 0 && fin > ini);
    const ctx = { setTimeout, clearTimeout, Promise, cargas: 0, soltar: null };
    vm.createContext(ctx);
    vm.runInContext(SETUP.slice(ini, fin) +
        '\nasync function _openLiveMatchRecoveryCuerpo() { cargas++; await new Promise(r => { soltar = r; }); }' +
        '\nglobalThis.abrir = openLiveMatchRecovery; globalThis.tope = _recuperarConTope;', ctx);
    const btn = { tagName: 'BUTTON', disabled: false, style: {}, innerHTML: '🔄 RECUPERAR PARTIDO', isConnected: true };
    const p1 = ctx.abrir(btn);
    ok('2b · 🔑 al pulsar, el botón se bloquea y dice «Cargando…» EN EL ACTO',
       btn.disabled === true && /Cargando/.test(btn.innerHTML), btn);
    await ctx.abrir(btn);
    await ctx.abrir(btn);
    ok('2c · 🔑 pulsar otra vez mientras carga NO lanza otra carga', ctx.cargas === 1, ctx.cargas);
    ctx.soltar();
    await p1;
    ok('2d · al terminar (si el botón sigue a la vista) vuelve a su estado',
       btn.disabled === false && btn.innerHTML === '🔄 RECUPERAR PARTIDO', btn);
    const p2 = ctx.abrir();
    ctx.soltar();
    await p2;
    ok('2e · llamada sin botón (repintar tras borrar) funciona igual', ctx.cargas === 2);
    let e = null;
    try { await ctx.tope(new Promise(() => {}), 30); } catch (x) { e = x; }
    ok('2f · el tope corta una promesa que no vuelve', e && e.code === 'cronos/tope', e);

    // ── 3 · La consulta de la nube y su salida ──────────────────────────
    ok('3a · el botón del menú se pasa a sí mismo', /onclick="openLiveMatchRecovery\(this\)"[\s\S]{0,80}Recuperar un partido en curso/.test(SETUP));
    ok('3b · 🔑 import + getDocs de live_matches dentro del tope',
       /const snap = await _recuperarConTope\(\(async \(\) => \{[\s\S]{0,500}return getDocs\(q\);\s*\}\)\(\), _RECUPERAR_TOPE_MS\);/.test(SETUP));
    ok('3c · ningún getDocs suelto en el cuerpo', !/await getDocs\(/.test(SETUP.slice(fin, SETUP.indexOf('\n}\n', fin))));
    ok('3d · sin respuesta y sin partidos en el aparato: aviso claro + «Reintentar»',
       /La nube no ha respondido \(conexión lenta o sin cobertura\)/.test(SETUP) && /🔄 Reintentar<\/button>/.test(SETUP));
    terminado = true;

    console.log('\n' + '─'.repeat(70));
    console.log('Resultado: ' + (total - fallos) + '/' + total);
    if (fallos) { console.log('❌ ' + fallos + ' fallo(s)'); process.exit(1); }
    console.log('✅ Recuperar Partido responde al instante y no espera a una red que no contesta');
})();
