// ─────────────────────────────────────────────────────────────────────────
// test_sw_respuesta_garantizada.js · el Service Worker SIEMPRE responde una
// Response (v453)
//
// EL FALLO QUE ARREGLA, reportado en producción la víspera de una demo:
//   "al entrar en live.html la pantalla se queda en negro;
//    TypeError: Failed to convert value to 'Response'"
//
// 🔑🔑 `event.respondWith()` EXIGE una Response. Si la promesa que recibe
// resuelve a `undefined`, el navegador lanza ese TypeError y la petición MUERE:
// no cae al comportamiento por defecto, no se reintenta, simplemente no hay
// respuesta. Y `caches.match()` resuelve a `undefined` cuando no hay
// coincidencia — NO rechaza. El `.catch` de la rama cache-first terminaba en
// `return caches.match(request)`, así que un recurso NO CACHEADO cuya red
// fallara respondía `undefined`.
//
// ⚠️ POR QUÉ SE VOLVIÓ CRÍTICO EN v447: hasta entonces esa rama sólo servía
// iconos y fuentes, donde fallar es cosmético. En v447 se metió ahí el SDK de
// Firebase (gstatic) para que la app arrancase sin cobertura. Desde ese
// momento, un tropiezo de red sobre `firebase-app.js` tumbaba el `import` del
// módulo y live.html se quedaba EN NEGRO, porque su contenido lo pinta ese
// módulo entero.
//
// ESTE GUARD NO LEE EL CÓDIGO: monta un `self` falso, dispara el evento fetch
// en los escenarios que importan —incluido "no cacheado + red caída"— y exige
// que lo entregado a respondWith sea SIEMPRE una Response.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const SW_SRC = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
// ⚠️ EL ORDEN IMPORTA, y costó 9 aserciones ajenas descubrirlo: primero se
// quitan los comentarios de LÍNEA y sólo después los de BLOQUE. Al revés, un
// `/*` que viva DENTRO de un comentario de línea —sw.js tiene
// `js/admin/superadmin/*` en su changelog— abre un bloque que se traga todo
// hasta el primer `*/` del fichero. Eso dejó ciegas 1100 líneas de sw.js y
// puso en rojo 9 aserciones de test_offline_resilience.js sin que nada
// estuviera roto de verdad.
const sinCom = (t) => t
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

console.log('── el Service Worker siempre responde una Response (v453) ──\n');

// ═══════════ El banco de pruebas ═══════════
// `self` de mentira con caches y fetch controlables.
class RespuestaFalsa {
    constructor(cuerpo, init) {
        this.cuerpo = cuerpo;
        this.status = (init && init.status) || 200;
        this.statusText = (init && init.statusText) || 'OK';
        this.headers = (init && init.headers) || {};
        this.ok = this.status >= 200 && this.status < 300;
    }
    clone() { return new RespuestaFalsa(this.cuerpo, { status: this.status }); }
}

function montar(op) {
    op = op || {};
    const cache = new Map(Object.entries(op.cacheado || {}));
    const reg = { puestos: [], borrados: [], claims: 0, avisos: [] };

    const almacen = {
        match: async (req) => {
            if (op.cachesMatchLanza) throw new Error('caches.match reventó');
            const url = typeof req === 'string' ? req : req.url;
            return cache.get(url);            // undefined si no está: como el real
        },
        open: async () => ({ put: async (req, resp) => { reg.puestos.push(typeof req === 'string' ? req : req.url); } }),
        keys: async () => (op.clavesCache || ['cronos-cache-vVIEJA', 'cronos-cache-v453']),
        delete: async (k) => { if (op.deleteLanza) throw new Error('delete falló'); reg.borrados.push(k); return true; },
    };

    const oyentes = {};
    const sb = {
        console: { log: (...a) => reg.avisos.push(a.join(' ')),
                   warn: (...a) => reg.avisos.push(a.join(' ')),
                   error: (...a) => reg.avisos.push(a.join(' ')) },
        Promise, Object, Array, Map, Set, JSON, String, Math, Date, Error,
        Response: RespuestaFalsa,
        caches: almacen,
        fetch: async (req) => {
            if (op.fetchFalla) throw new TypeError('Failed to fetch');
            if (op.fetchDevuelve404) return new RespuestaFalsa('no', { status: 404 });
            return new RespuestaFalsa('contenido', { status: 200 });
        },
        setTimeout, clearTimeout,
    };
    sb.self = {
        addEventListener: (ev, fn) => { (oyentes[ev] = oyentes[ev] || []).push(fn); },
        skipWaiting: () => { reg.skipWaiting = true; },
        clients: { claim: async () => { if (op.claimLanza) throw new Error('claim falló'); reg.claims++; } },
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SW_SRC, sb);

    return { sb, reg, oyentes,
        // Dispara el evento fetch y devuelve lo que se pasó a respondWith.
        pedir: (url, destino) => {
            let entregado;
            const evento = {
                request: { url, method: 'GET', destination: destino || '', clone: () => ({}) },
                respondWith: (p) => { entregado = p; },
            };
            (oyentes.fetch || []).forEach(fn => fn(evento));
            return entregado;
        },
        activar: () => {
            let esperado;
            (oyentes.activate || []).forEach(fn => fn({ waitUntil: (p) => { esperado = p; } }));
            return esperado;
        },
    };
}

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';

// ═══════════ PARTE 1 · EL FALLO REPORTADO ═══════════
console.log('── PARTE 1 · 🔑🔑 el escenario que dejaba live.html en negro ──');
(async () => {
{
    // SDK de Firebase: NO cacheado y la red falla. Era el `undefined`.
    const t = montar({ fetchFalla: true, cacheado: {} });
    const r = await t.pedir(SDK);
    ok('1a · 🔑🔑 SDK no cacheado + red caída → SIGUE devolviendo una Response',
       r instanceof RespuestaFalsa,
       'devolvió: ' + (r === undefined ? 'undefined → TypeError: Failed to convert value to Response' : typeof r));
    ok('1b · y es un error explícito, no una página en blanco',
       r && r.status >= 500, 'status: ' + (r && r.status));
}
{
    // El mismo caso, pero SÍ cacheado: debe servirse de la caché.
    const t = montar({ fetchFalla: true, cacheado: { [SDK]: new RespuestaFalsa('sdk', { status: 200 }) } });
    const r = await t.pedir(SDK);
    ok('1c · SDK cacheado + red caída → se sirve la copia local',
       r instanceof RespuestaFalsa && r.cuerpo === 'sdk', JSON.stringify(r));
}
{
    // Y si además `caches.match` revienta, tampoco puede colarse un undefined.
    const t = montar({ fetchFalla: true, cachesMatchLanza: true });
    const r = await t.pedir(SDK);
    ok('1d · 🔑 aunque `caches.match` LANCE, se responde una Response',
       r instanceof RespuestaFalsa, 'devolvió: ' + typeof r);
}

// ═══════════ PARTE 2 · TODOS LOS CAMINOS ═══════════
console.log('\n── PARTE 2 · ningún camino puede responder algo que no sea Response ──');
{
    const casos = [
        // ⚠️ URL ABSOLUTA: el manejador ignora lo que no empiece por 'http'
        // (`if (!url.startsWith('http')) return;`). Con una ruta relativa la
        // prueba medía el caso equivocado.
        ['icono no cacheado + red caída', 'https://app/public/assets/icons/chronos-192.svg', '', { fetchFalla: true }],
        ['manifest no cacheado + red caída',   'https://app/manifest.json',            '', { fetchFalla: true }],
        ['fuente no cacheada + red caída',     'https://app/fuente.woff2',             '', { fetchFalla: true }],
        ['documento + red caída, sin offline', 'https://app/live.html',          'document', { fetchFalla: true }],
        ['documento + red caída, con offline', 'https://app/live.html',          'document',
            { fetchFalla: true, cacheado: { './offline.html': new RespuestaFalsa('offline', { status: 200 }) } }],
        ['script normal + red caída',          'https://app/js/core/app-init.js',      '', { fetchFalla: true }],
        ['script normal + red OK',             'https://app/js/core/app-init.js',      '', {}],
        ['recurso que devuelve 404',           'https://app/js/no-existe.js',          '', { fetchDevuelve404: true }],
        ['SDK con red OK',                     SDK,                                     '', {}],
    ];
    for (const [etq, url, destino, op] of casos) {
        const t = montar(op);
        const r = await t.pedir(url, destino);
        ok('2 · ' + etq + ' → Response', r instanceof RespuestaFalsa,
           'devolvió ' + (r === undefined ? 'undefined (TypeError en el navegador)' : typeof r));
    }
}
{
    // El canal VIVO de Firestore NO se intercepta: debe quedar sin respondWith.
    const t = montar({});
    const r = await t.pedir('https://firestore.googleapis.com/v1/proyectos/x');
    ok('2b · ⚠️ el canal vivo de Firestore sigue SIN interceptarse',
       r === undefined, 'cachearlo serviría un marcador muerto');
}

// ═══════════ PARTE 3 · ACTIVACIÓN Y PURGA ═══════════
console.log('\n── PARTE 3 · purga automática y toma de control ──');
{
    // El nombre de caché vigente se LEE del propio sw.js: fijarlo a mano hacía
    // que la prueba caducara en el siguiente bump de versión.
    const ACTUAL = (SW_SRC.match(/const CACHE_NAME = '([^']+)'/) || [])[1];
    const t = montar({ clavesCache: ['cronos-cache-vVIEJA-1', 'cronos-cache-vVIEJA-2', ACTUAL] });
    await t.activar();
    ok('3a · se purgan TODAS las cachés que no son la actual (' + ACTUAL + ')',
       t.reg.borrados.length === 2 && t.reg.borrados.indexOf(ACTUAL) === -1,
       JSON.stringify(t.reg.borrados));
    ok('3b · y se toma el control de las pestañas abiertas', t.reg.claims === 1);
}
{
    // 🔑 Si el borrado falla, el claim NO puede perderse: si no, el SW nuevo
    // queda activo pero sin controlar nada y hace falta refrescar a mano.
    const t = montar({ deleteLanza: true });
    await t.activar();
    ok('3c · 🔑 aunque la purga falle, se toma el control igualmente',
       t.reg.claims === 1,
       'encadenado con .then, un delete fallido dejaba clients.claim() sin ejecutar');
}
{
    const t = montar({});
    ok('3d · install hace skipWaiting (la versión nueva no espera)',
       /self\.skipWaiting\(\)/.test(sinCom(SW_SRC)));
}

// ═══════════ PARTE 4 · la cadena que evita el refresco manual ═══════════
console.log('\n── PARTE 4 · nadie tiene que pulsar Ctrl+Shift+R ──');
{
    const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const LIVE  = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
    for (const [n, src] of [['index.html', INDEX], ['live.html', LIVE]]) {
        ok('4 · ' + n + ' se recarga sola al cambiar de Service Worker',
           /addEventListener\('controllerchange',\s*function\s*\(\)\s*\{\s*window\.location\.reload\(\)/.test(src),
           'sin esto, la pestaña abierta se queda con el SW viejo');
    }
    const S = sinCom(SW_SRC);
    ok('4c · el `catch` de emergencia ya no devuelve `caches.match` a pelo',
       !/catch\s*\([^)]*\)\s*\{[^}]*return\s+caches\.match\([^)]*\);\s*\}/.test(S),
       'ése era exactamente el `undefined` que provocaba el TypeError');
    ok('4d · existe la red de seguridad que garantiza la Response',
       /_respuestaGarantizada/.test(S) && /instanceof Response/.test(S));
}

console.log('\n' + '─'.repeat(60));
console.log(`Resultado: ${pass} PASS · ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
})();
