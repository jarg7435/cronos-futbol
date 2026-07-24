// ─────────────────────────────────────────────────────────────────────────
// test_sa_club_slots_module.js · Refactor de monolitos (auditoría 2026-07-22,
// hallazgo #9) — PASO 2: extracción de "Editar Slots y Plan de un Club"
// (saEditClubSlots, saEditClubSlotsConfirm) desde
// js/admin/superadmin/superadmin.panel.js a su propio archivo.
//
// Igual que en el paso 1 (Papelera, ver test_sa_trash_module.js): este test
// se escribe ANTES de mover ninguna línea, ejecutando las 2 funciones REALES
// tal como existen hoy en un sandbox con fakes de Firestore/DOM, para fijar
// su comportamiento actual. SOURCE detecta automáticamente el archivo nuevo
// si ya existe, así que el mismo test sirve para verificar "antes" y
// "después" de la extracción.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.existsSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'club-slots.js'))
    ? path.join(ROOT, 'js', 'admin', 'superadmin', 'club-slots.js')
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Editar Slots/Plan de Club — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Infra: fakes de Firestore/DOM ═══════════════════
function buildSandbox({ clubDoc = null, updateDocThrows = null } = {}) {
    const updateDocCalls = [];
    const toasts = [];
    const spinners = [];
    const saTabCalls = [];
    let bodyHtml = '';
    const formValues = { 'es-plan': 'free', 'es-dir': '1', 'es-coord': '2', 'es-coach': '10', 'es-parents': '50' };

    const fns = {
        db: {},
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async (ref) => ({
            exists: () => clubDoc !== null,
            data: () => clubDoc,
        }),
        updateDoc: async (ref, data) => {
            updateDocCalls.push({ col: ref.__col, id: ref.__id, data });
            if (updateDocThrows) throw new Error(updateDocThrows);
        },
    };

    const elements = {
        'sa-body': { set innerHTML(v) { bodyHtml = v; }, get innerHTML() { return bodyHtml; } },
    };
    Object.keys(formValues).forEach(id => {
        elements[id] = { get value() { return formValues[id]; }, set value(v) { formValues[id] = v; } };
    });

    const sandbox = {
        window: { _cronosCurrentUser: { email: 'superadmin@cronos.test' } },
        document: { getElementById: (id) => elements[id] || null },
        escapeHtml: (s) => String(s == null ? '' : s),
        console: { log() {}, warn() {}, error() {} },
        Date, String, Object, Array, parseInt,
        saFS: async () => fns,
        saTab: (tab) => { saTabCalls.push(tab); },
    };
    sandbox.window.saFS = sandbox.saFS;
    sandbox.window.saTab = sandbox.saTab;
    vm.createContext(sandbox);

    const src = fs.readFileSync(SOURCE, 'utf8');
    const start = src.indexOf('window.saEditClubSlots = async function');
    const endMarker = src.indexOf('window._CRONOS_EXTRAS_DEF') !== -1
        ? 'window._CRONOS_EXTRAS_DEF'
        : (src.indexOf('window.saExtras') !== -1 ? 'window.saExtras' : null);
    const end = endMarker ? src.indexOf(endMarker) : -1;
    const block = end !== -1 ? src.slice(start, end) : src.slice(start);
    if (start === -1) throw new Error('No se encontró saEditClubSlots en ' + SOURCE);

    const stubs = `
        var _saShowSpinner = function(msg) { __spinners.push({on:true, msg}); };
        var _saHideSpinner = function() { __spinners.push({on:false}); };
        var _saToast = function(msg, ms) { __toasts.push(msg); };
        var saFS = window.saFS;
        var saTab = window.saTab;
    `;
    sandbox.__spinners = spinners;
    sandbox.__toasts = toasts;
    vm.runInContext(stubs + block, sandbox);

    return {
        sandbox, updateDocCalls, toasts, spinners, saTabCalls, formValues,
        getBodyHtml: () => bodyHtml,
        setFormValue: (id, v) => { formValues[id] = v; },
    };
}

(async () => {
    console.log('── PARTE 1 · estructura ──');
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');
    ok('1a · saEditClubSlots existe', /window\.saEditClubSlots\s*=\s*async function/.test(rawSrc));
    ok('1b · saEditClubSlotsConfirm existe', /window\.saEditClubSlotsConfirm\s*=\s*async function/.test(rawSrc));

    console.log('\n── PARTE 2 · saEditClubSlots() — render del formulario ──');
    {
        // 2a: club inexistente -> toast de error, sin renderizar formulario.
        const { sandbox, toasts, getBodyHtml } = buildSandbox({ clubDoc: null });
        await sandbox.window.saEditClubSlots('club-x', 'Club X');
        ok('2a · club no encontrado -> toast "Club no encontrado"', toasts.some(t => /Club no encontrado/.test(t)));
        ok('2b · club no encontrado -> NO renderiza el formulario', getBodyHtml() === '');
    }
    {
        // 2c: club con slots/usedSlots definidos -> valores precargados correctamente.
        const { sandbox, getBodyHtml } = buildSandbox({
            clubDoc: { plan: 'pro', slots: { directors: 3, coordinators: 4, users: 20, parents: 80 }, usedSlots: { directors: 1, coordinators: 2, users: 15, parents: 60 } },
        });
        await sandbox.window.saEditClubSlots('club-1', 'CD Prueba');
        const html = getBodyHtml();
        ok('2c · precarga el plan actual (pro) como seleccionado', /value="pro"\s+selected/.test(html));
        ok('2d · precarga el número de slots de directores (3)', /id="es-dir" type="number" value="3"/.test(html));
        ok('2e · precarga el número de slots de coordinadores (4)', /id="es-coord" type="number" value="4"/.test(html));
        ok('2f · precarga el número de slots de entrenadores (20)', /id="es-coach" type="number" value="20"/.test(html));
        ok('2g · precarga el número de slots de padres (80)', /id="es-parents" type="number" value="80"/.test(html));
        ok('2h · muestra los slots YA usados (director: 1)', /Usados: 1/.test(html));
    }
    {
        // 2i: club SIN slots/usedSlots definidos -> defaults documentados (1/2/10/50, plan free).
        const { sandbox, getBodyHtml } = buildSandbox({ clubDoc: {} });
        await sandbox.window.saEditClubSlots('club-2', 'CD Nuevo');
        const html = getBodyHtml();
        ok('2i · [defaults] plan free cuando no hay plan', /value="free"\s+selected/.test(html));
        ok('2j · [defaults] directors=1, coordinators=2, users=10, parents=50',
           /id="es-dir" type="number" value="1"/.test(html) &&
           /id="es-coord" type="number" value="2"/.test(html) &&
           /id="es-coach" type="number" value="10"/.test(html) &&
           /id="es-parents" type="number" value="50"/.test(html));
    }

    console.log('\n── PARTE 3 · saEditClubSlotsConfirm() — guardado ──');
    {
        // 3a: happy path -> updateDoc con los valores del formulario, toast y vuelta a la pestaña clubs.
        const { sandbox, updateDocCalls, toasts, saTabCalls, setFormValue } = buildSandbox({ clubDoc: {} });
        setFormValue('es-plan', 'basic');
        setFormValue('es-dir', '5');
        setFormValue('es-coord', '6');
        setFormValue('es-coach', '25');
        setFormValue('es-parents', '90');
        await sandbox.window.saEditClubSlotsConfirm('club-1');
        ok('3a · exactamente 1 updateDoc sobre clubs/club-1', updateDocCalls.length === 1 && updateDocCalls[0].col === 'clubs' && updateDocCalls[0].id === 'club-1');
        const data = updateDocCalls[0].data;
        ok('3b · guarda el plan elegido', data.plan === 'basic');
        ok('3c · guarda los 4 slots numéricos del formulario', JSON.stringify(data.slots) === JSON.stringify({ directors: 5, coordinators: 6, users: 25, parents: 90 }));
        ok('3d · registra updatedBy con el email del SuperAdmin', data.updatedBy === 'superadmin@cronos.test');
        ok('3e · muestra toast de éxito', toasts.some(t => /actualizado correctamente/.test(t)));
        ok('3f · vuelve a la pestaña clubs tras guardar', saTabCalls.includes('clubs'));
    }
    {
        // 3g: si el updateDoc falla, muestra el error y NO vuelve a la pestaña clubs.
        const { sandbox, toasts, saTabCalls } = buildSandbox({ clubDoc: {}, updateDocThrows: 'permission-denied' });
        await sandbox.window.saEditClubSlotsConfirm('club-1');
        ok('3g · updateDoc falla -> toast con el mensaje de error', toasts.some(t => /Error: permission-denied/.test(t)));
        ok('3h · updateDoc falla -> NO vuelve a la pestaña clubs', !saTabCalls.includes('clubs'));
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
