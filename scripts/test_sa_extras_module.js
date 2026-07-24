// ─────────────────────────────────────────────────────────────────────────
// test_sa_extras_module.js · Refactor de monolitos (auditoría 2026-07-22,
// hallazgo #9) — PASO 3: extracción de "Extras por Club" (window._CRONOS_
// EXTRAS_DEF, saExtras, saSaveExtras) desde
// js/admin/superadmin/superadmin.panel.js a su propio archivo.
//
// A diferencia de los pasos 1 y 2 (Papelera, Slots), estas funciones NO usan
// saFS(): hacen su propio `await import('.../firebase-firestore.js')` y
// leen window._cronos_auth.db directamente. Como Node no resuelve imports
// dinámicos dentro de vm.runInContext sin un callback de módulos, el test
// sustituye textualmente esa única línea de import por una referencia a un
// fake ya inyectado en el sandbox — el ARNÉS se adapta, el CÓDIGO FUENTE
// permanece intacto y sin tocar.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.existsSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'extras-toggle.js'))
    ? path.join(ROOT, 'js', 'admin', 'superadmin', 'extras-toggle.js')
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Extras por Club — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Infra: fakes de Firestore/DOM ═══════════════════
function makeFakeElement(tagLike = {}) {
    let html = '';
    const listeners = {};
    return {
        get innerHTML() { return html; },
        set innerHTML(v) { html = v; },
        querySelectorAll: (sel) => tagLike.toggles || [],
        addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
        __listeners: listeners,
    };
}

function buildSandbox({ hasDb = true, clubs = [], individuals = [], fetchThrows = null, toggles = [] } = {}) {
    const updateDocCalls = [];
    const setDocCalls = [];
    const toasts = [];
    let bodyEl = makeFakeElement({ toggles: toggles.map(t => ({ dataset: { entity: t.entity, key: t.key }, checked: t.checked })) });

    const fakeFirestoreModule = {
        collection: (db, col) => ({ __col: col }),
        getDocs: async (collRef) => {
            if (fetchThrows) throw new Error(fetchThrows);
            const list = collRef.__col === 'clubs' ? clubs : individuals;
            return { forEach: (cb) => list.forEach(d => cb({ id: d.id, data: () => d })) };
        },
        doc: (db, col, id) => ({ __col: col, __id: id }),
        updateDoc: async (ref, data) => {
            updateDocCalls.push({ col: ref.__col, id: ref.__id, data });
            if (ref.__col === 'clubs' && ref.__failClubUpdate) throw new Error('no existe en clubs');
        },
        setDoc: async (ref, data, opts) => { setDocCalls.push({ col: ref.__col, id: ref.__id, data, opts }); },
    };

    const sandbox = {
        window: {
            _cronos_auth: { db: hasDb ? {} : null },
        },
        document: { getElementById: (id) => id === 'sa-body' ? bodyEl : null, querySelectorAll: (sel) => bodyEl.querySelectorAll(sel) },
        console: { log() {}, warn() {}, error() {} },
        String, Object, Array,
        showToast: (msg) => { toasts.push(msg); },
        alert: (msg) => { toasts.push(msg); },
        __fakeFirestoreModule: fakeFirestoreModule,
    };
    sandbox.window.showToast = sandbox.showToast;
    vm.createContext(sandbox);

    let src = fs.readFileSync(SOURCE, 'utf8');
    const start = src.indexOf('window._CRONOS_EXTRAS_DEF');
    const endMarker = src.indexOf('SISTEMA DE MENSAJERÍA') !== -1 ? 'SISTEMA DE MENSAJERÍA' : 'window.saMessages';
    const end = src.indexOf(endMarker);
    let block = end !== -1 ? src.slice(start, end) : src.slice(start);
    if (start === -1) throw new Error('No se encontró _CRONOS_EXTRAS_DEF en ' + SOURCE);

    // Sustituir el import dinámico real por el fake inyectado (única adaptación).
    block = block.replace(
        /await import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js'\)/g,
        '__fakeFirestoreModule'
    );

    vm.runInContext(block, sandbox);

    return {
        sandbox, updateDocCalls, setDocCalls, toasts,
        getBodyHtml: () => bodyEl.innerHTML,
    };
}

(async () => {
    console.log('── PARTE 1 · estructura ──');
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');
    ok('1a · _CRONOS_EXTRAS_DEF existe', /window\._CRONOS_EXTRAS_DEF\s*=/.test(rawSrc));
    ok('1b · saExtras existe', /window\.saExtras\s*=\s*async function/.test(rawSrc));
    ok('1c · saSaveExtras existe', /window\.saSaveExtras\s*=\s*async function/.test(rawSrc));
    ok('1d · define las 10 extras conocidas (plantilla..partidos_en_vivo)',
       /key: 'plantilla'/.test(rawSrc) && /key: 'partidos_en_vivo'/.test(rawSrc));

    console.log('\n── PARTE 2 · saExtras() — render ──');
    {
        // 2a: sin db -> mensaje de error, sin listar entidades.
        const { sandbox, getBodyHtml } = buildSandbox({ hasDb: false });
        await sandbox.window.saExtras();
        ok('2a · sin Firebase -> "Firebase no disponible"', /Firebase no disponible/.test(getBodyHtml()));
    }
    {
        // 2b: sin clubes ni individuales -> mensaje vacío.
        const { sandbox, getBodyHtml } = buildSandbox({ clubs: [], individuals: [] });
        await sandbox.window.saExtras();
        ok('2b · sin entidades -> "No hay clubes ni individuales"', /No hay clubes ni individuales/.test(getBodyHtml()));
    }
    {
        // 2c: un club con una extra desactivada explícitamente -> checkbox sin "checked".
        const { sandbox, getBodyHtml } = buildSandbox({
            clubs: [{ id: 'club1', name: 'CD Prueba', extras: { semaforo: false } }],
        });
        await sandbox.window.saExtras();
        const html = getBodyHtml();
        ok('2c · muestra el nombre del club', /CD Prueba/.test(html));
        ok('2d · marca el tipo como Club', /🏟️ Club/.test(html));
        ok('2e · [default opt-out] extra sin mención explícita -> checked (activada por defecto)',
           /data-key="plantilla" checked/.test(html));
        {
            const tagMatch = html.match(/<input[^>]*data-key="semaforo"[^>]*>/);
            ok('2f · extra con extras.semaforo===false -> SIN "checked" en su <input>',
               !!tagMatch && !/\bchecked\b/.test(tagMatch[0]), tagMatch && tagMatch[0]);
        }
    }
    {
        // 2g: individuales también se listan, etiquetados como tal.
        const { sandbox, getBodyHtml } = buildSandbox({
            individuals: [{ id: 'ind1', individualName: 'Juan Individual', extras: {} }],
        });
        await sandbox.window.saExtras();
        ok('2g · muestra el ente individual y lo etiqueta como tal', /👤 Individual/.test(getBodyHtml()) && /Juan Individual/.test(getBodyHtml()));
    }
    {
        // 2h: si getDocs lanza, se captura y muestra error (no revienta).
        const { sandbox, getBodyHtml } = buildSandbox({ fetchThrows: 'permission-denied' });
        await sandbox.window.saExtras();
        ok('2h · error al cargar -> mensaje de error capturado', /Error: permission-denied/.test(getBodyHtml()));
    }

    console.log('\n── PARTE 3 · saSaveExtras() — guardado ──');
    {
        // 3a: sin db -> toast de error, ningún write.
        const { sandbox, updateDocCalls, toasts } = buildSandbox({ hasDb: false, toggles: [{ entity: 'club1', key: 'semaforo', checked: true }] });
        await sandbox.window.saSaveExtras();
        ok('3a · sin Firebase -> toast "Firebase no disponible"', toasts.some(t => /Firebase no disponible/.test(t)));
        ok('3b · sin Firebase -> ningún updateDoc', updateDocCalls.length === 0);
    }
    {
        // 3c: agrupa los toggles por entidad y guarda en clubs/{id}.
        const { sandbox, updateDocCalls, toasts } = buildSandbox({
            toggles: [
                { entity: 'club1', key: 'semaforo', checked: false },
                { entity: 'club1', key: 'plantilla', checked: true },
                { entity: 'club2', key: 'informes', checked: true },
            ],
        });
        await sandbox.window.saSaveExtras();
        ok('3c · un updateDoc por entidad distinta (2 entidades -> 2 updateDoc)', updateDocCalls.length === 2);
        const club1Call = updateDocCalls.find(c => c.id === 'club1');
        ok('3d · agrupa AMBOS toggles de la misma entidad en un único write', club1Call && Object.keys(club1Call.data.extras).length === 2);
        ok('3e · guarda el estado checked/unchecked correcto', club1Call.data.extras.semaforo === false && club1Call.data.extras.plantilla === true);
        ok('3f · toast final indica cuántas entidades se guardaron', toasts.some(t => /guardados para 2 entidad/.test(t)));
    }
    {
        // 3g: si falla el updateDoc en 'clubs' (entidad no existe ahí), reintenta en 'individuals'.
        const { sandbox } = buildSandbox({ toggles: [{ entity: 'ind1', key: 'semaforo', checked: true }] });
        // Forzar que el primer intento (clubs) falle marcando el ref.
        const origDoc = sandbox.__fakeFirestoreModule.doc;
        sandbox.__fakeFirestoreModule.doc = (db, col, id) => {
            const ref = origDoc(db, col, id);
            if (col === 'clubs') ref.__failClubUpdate = true;
            return ref;
        };
        const calls = [];
        sandbox.__fakeFirestoreModule.updateDoc = async (ref, data) => {
            calls.push({ col: ref.__col, id: ref.__id, data });
            if (ref.__col === 'clubs') throw new Error('no existe en clubs');
        };
        await sandbox.window.saSaveExtras();
        ok('3g · intenta primero clubs/{id}', calls[0] && calls[0].col === 'clubs');
        ok('3h · ante el fallo, reintenta en individuals/{id} con éxito', calls[1] && calls[1].col === 'individuals');
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
