// ─────────────────────────────────────────────────────────────────────────
// test_sa_individuals_module.js · Refactor de monolitos (auditoría
// 2026-07-22) — PASO 8: extracción de "Individuales tab" (saIndividuals /
// saActivateIndividual / saAssignOrphanToEntity) desde
// js/admin/superadmin/superadmin.panel.js a su propio archivo.
//
// Coupling verificado antes de escribir este test: entrada externa desde
// saTab() (tab='individuals') y desde setupClubsSyncListener() (aún sin
// extraer, sincroniza la vista al cambiar datos en tiempo real) — ambas
// llaman HACIA saIndividuals(), sin dependencia de orden de carga. Salida:
// saAssignOrphanToEntity se invoca desde el propio HTML de saIndividuals
// (autorreferencia); los botones de editar/eliminar/añadir/ver-usuarios
// llaman a funciones ya extraídas en el paso 6 (individual-entity.js) vía
// resolución en tiempo de click. saActivateIndividual no tiene NINGÚN
// onclick que la invoque en todo el repo (código huérfano actualmente) —
// se mueve tal cual, sin tocar su lógica.
//
// Igual que "Extras por Club" (paso 3), saIndividuals() hace un
// `await import('.../firebase-firestore.js')` puntual (sincronización
// retroactiva de hasAdmin) en vez de pasar por saFS() — el ARNÉS sustituye
// esa única línea por un fake, el código fuente no se toca.
//
// saIndividuals/saActivateIndividual/saAssignOrphanToEntity se llaman entre
// sí con el nombre "pelado" (sin window.), así que el arnés añade
// `var saIndividuals = window.saIndividuals;` DESPUÉS de ejecutar el bloque
// para que esas llamadas recursivas/hermanas resuelvan correctamente
// (mismo problema de scope ya visto: `window.x = function(){}` no crea un
// global "pelado" en un contexto vm, a diferencia de un navegador real).
//
// Cero solapamiento con el WIP sin commitear de saSetClubUserStatus/
// setupClubsSyncListener (línea >=1797) ni con el de Mensajería SA
// (línea >=2342) — verificado con `git diff` antes de escribir este test.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.existsSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'individuals-tab.js'))
    ? path.join(ROOT, 'js', 'admin', 'superadmin', 'individuals-tab.js')
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Individuales tab — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Infra: fakes de Firestore + DOM ═══════════════════
function makeEl(initial) {
    return Object.assign({ value: '', innerHTML: '' }, initial);
}

function buildSandbox({ elements = {}, clubsStore = {}, usersStore = {}, getDocsThrows = null, currentUserEmail = 'sa@cronos.app', confirmReturns = true } = {}) {
    const updateDocCalls = [];
    const dynamicUpdateDocCalls = [];
    const toasts = [];
    const els = {};
    for (const [id, init] of Object.entries(elements)) els[id] = makeEl(init);
    if (!els['sa-body']) els['sa-body'] = makeEl({});

    const fns = {
        db: {},
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async (ref) => {
            const store = ref.__col === 'clubs' ? clubsStore : usersStore;
            const data = store[ref.__id];
            return { exists: () => data !== undefined, data: () => data };
        },
        updateDoc: async (ref, data) => {
            updateDocCalls.push({ col: ref.__col, id: ref.__id, data });
            const store = ref.__col === 'clubs' ? clubsStore : usersStore;
            if (store[ref.__id]) Object.assign(store[ref.__id], data);
        },
        collection: (db, col) => ({ __col: col }),
        query: (collRef, ...clauses) => ({ __col: collRef.__col, __clauses: clauses }),
        where: (field, op, value) => ({ field, op, value }),
        getDocs: async (collRef) => {
            if (getDocsThrows) throw new Error(getDocsThrows);
            const store = collRef.__col === 'clubs' ? clubsStore : usersStore;
            const entries = Object.entries(store);
            return { forEach: (cb) => entries.forEach(([id, data]) => cb({ id, data: () => data })) };
        },
    };

    // Fake del módulo firebase-firestore.js para el import dinámico puntual.
    const dynDoc = (db, col, id) => ({ __col: col, __id: id });
    const dynUpdateDoc = async (ref, data) => {
        dynamicUpdateDocCalls.push({ col: ref.__col, id: ref.__id, data });
        const store = ref.__col === 'clubs' ? clubsStore : usersStore;
        if (store[ref.__id]) Object.assign(store[ref.__id], data);
    };
    const fakeFirestoreModule = { doc: dynDoc, updateDoc: dynUpdateDoc };

    const sandbox = {
        window: {
            _cronosCurrentUser: currentUserEmail ? { email: currentUserEmail } : undefined,
            ROLE_META: {
                individual: { icon: '⚙️', color: '#79c0ff', label: 'Admin. Individual' },
                admin_individual: { icon: '⚙️', color: '#79c0ff', label: 'Admin. Individual' },
                user: { icon: '⚽', color: '#3fb950', label: 'Entrenador' },
                parent: { icon: '👨‍👩‍👧', color: '#ffa500', label: 'Padre/Madre' },
            },
        },
        document: { getElementById: (id) => els[id] || null },
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Date, Math, JSON,
        saFS: async () => fns,
        __fakeFirestoreModule: fakeFirestoreModule,
    };
    sandbox.window.saFS = sandbox.saFS;
    vm.createContext(sandbox);

    let src = fs.readFileSync(SOURCE, 'utf8');
    const start = src.indexOf('window.saIndividuals = async function');
    if (start === -1) throw new Error('No se encontró saIndividuals en ' + SOURCE);
    const endMarker = 'saSecretary() Y ENVÍO DE INVITACIONES';
    const endIdx = src.indexOf(endMarker);
    let block = endIdx !== -1 ? src.slice(start, endIdx) : src.slice(start);

    block = block.replace(
        /await import\('https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js'\)/g,
        '__fakeFirestoreModule'
    );

    const stubs = `
        var _saShowSpinner = function(msg) { __spinners.push({on:true, msg}); };
        var _saHideSpinner = function() { __spinners.push({on:false}); };
        var _saToast = function(msg, ms) { __toasts.push(msg); };
        var saFS = window.saFS;
    `;
    sandbox.__spinners = [];
    sandbox.__toasts = toasts;
    // Forward reference añadido AL FINAL: para cuando el bloque termine de ejecutarse,
    // window.saIndividuals ya está asignado y las llamadas "peladas" (sin window.)
    // dentro de saActivateIndividual/saAssignOrphanToEntity resuelven correctamente.
    vm.runInContext(stubs + block + '\nvar saIndividuals = window.saIndividuals;', sandbox);

    return { sandbox, els, clubsStore, usersStore, updateDocCalls, dynamicUpdateDocCalls, toasts };
}

(async () => {
    console.log('── PARTE 1 · estructura ──');
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');
    ok('1a · saIndividuals existe', /window\.saIndividuals\s*=\s*async function/.test(rawSrc));
    ok('1b · saActivateIndividual existe', /window\.saActivateIndividual\s*=\s*async function/.test(rawSrc));
    ok('1c · saAssignOrphanToEntity existe', /window\.saAssignOrphanToEntity\s*=\s*async function/.test(rawSrc));

    console.log('\n── PARTE 2 · saIndividuals() — sin datos ──');
    {
        const { sandbox, els } = buildSandbox({});
        await sandbox.window.saIndividuals();
        ok('2a · sin entes -> mensaje "Sin entes individuales creados"', /Sin entes individuales creados/.test(els['sa-body'].innerHTML));
    }

    console.log('\n── PARTE 3 · saIndividuals() — entidad con usuarios ──');
    {
        const { sandbox, els } = buildSandbox({
            clubsStore: { ent1: { name: 'Ente X', type: 'individual', plan: 'pro', hasAdmin: true, slots: { admins: 5, coaches: 20, parents: 30 } } },
            usersStore: {
                u1: { email: 'admin@x.com', role: 'admin_individual', clubId: 'ent1', isAuthorized: true, status: 'active' },
                u2: { email: 'coach@x.com', role: 'user', clubId: 'ent1', isAuthorized: true, status: 'active' },
            },
        });
        await sandbox.window.saIndividuals();
        const html = els['sa-body'].innerHTML;
        ok('3a · muestra el nombre del ente', /Ente X/.test(html));
        ok('3b · cuenta 1 ente individual en el título', /Entes Individuales \(1\)/.test(html));

        // ══════════════════════════════════════════════════════════════
        //  ⚠️⚠️ v600 · 3c REESCRITA, NO RELAJADA
        //
        //  Decía: /2 usuarios totales/. Hoy la cabecera no dice "usuarios
        //  totales" sino "miembro(s)", y el DUEÑO ya no se cuenta ahí: tras la
        //  unificación el Entrenador Administrador Individual **es el ente**,
        //  no un miembro suyo, así que subió a la cabecera.
        //
        //  🔑 LO QUE 3c VIGILABA SIGUE VIGILADO, y con más detalle: que la
        //  tarjeta diga la verdad sobre quién pertenece al ente. Dar por buena
        //  "aparece algún número" habría pasado en verde el día que el reparto
        //  entre dueño y miembros se descuadre — que es justo el riesgo que
        //  introduce mover a alguien de la lista a la cabecera.
        //
        //  ⚠️ Y LA ÚLTIMA ES LA IMPORTANTE: sacar al dueño del recuento NO
        //  puede esconderlo. "Ver usuarios" tiene que seguir ofreciendo LOS DOS.
        // ══════════════════════════════════════════════════════════════
        // ⚠️⚠️ SE BORRAN LOS COMENTARIOS HTML ANTES DE MIRAR. La primera
        //    versión de 3c pedía /Entrenador Administrador/ y salía VERDE...
        //    casando con el comentario que explica por qué se quitó la barra.
        //    Un comentario dentro de un template literal SÍ llega al innerHTML.
        //    Es la misma trampa que mordió en la v597, ahora del otro lado:
        //    entonces daba rojo sobre código correcto, aquí daba VERDE sobre
        //    una aserción que no comprobaba nada.
        const vis = html.replace(/<!--[\s\S]*?-->/g, '');
        ok('3c · 🔑 el dueño del ente sube a la CABECERA, identificado',
           /⚽ admin@x\.com/.test(vis),
           vis.slice(vis.indexOf('Ente X'), vis.indexOf('Ente X') + 300));
        ok('3c2 · 🔑 y ya NO se pinta como una barra de cupo más',
           !/Entrenador Administrador Individual/.test(vis),
           vis.indexOf('Entrenador Administrador Individual'));
        ok('3c3 · ⚠️ los MIEMBROS se cuentan sin él (2 usuarios − 1 dueño = 1)',
           /1 miembro\(s\)/.test(html) && !/2 miembro\(s\)/.test(html));
        ok('3c4 · ⚠️⚠️ pero "Ver usuarios" sigue ofreciendo LOS DOS (nada se esconde)',
           /Ver usuarios \(2\)/.test(html));
    }

    console.log('\n── PARTE 4 · saIndividuals() — huérfanos sin ente ──');
    {
        const { sandbox, els } = buildSandbox({
            clubsStore: { ent1: { name: 'Ente X', type: 'individual', plan: 'free', hasAdmin: false, slots: {} } },
            usersStore: {
                u1: { email: 'huerfano@x.com', role: 'user', isIndividual: true, isAuthorized: true, status: 'active' },
                u2: { email: 'removido@x.com', role: 'user', isIndividual: true, isAuthorized: true, status: 'removed' },
                u3: { email: 'asignado@x.com', role: 'user', clubId: 'ent1', isAuthorized: true, status: 'active' },
            },
        });
        await sandbox.window.saIndividuals();
        const html = els['sa-body'].innerHTML;
        ok('4a · detecta exactamente 1 huérfano', /Usuarios sin ente individual asignado \(1\)/.test(html));
        ok('4b · el huérfano detectado es el correcto', /huerfano@x\.com/.test(html));
        ok('4c · el usuario "removed" NO aparece como huérfano', !/removido@x\.com/.test(html));
        ok('4d · el usuario ya asignado a un ente NO aparece como huérfano', !/asignado@x\.com/.test(html));
    }

    console.log('\n── PARTE 5 · saIndividuals() — sincronización retroactiva de hasAdmin ──');
    {
        const { sandbox, dynamicUpdateDocCalls, clubsStore } = buildSandbox({
            clubsStore: { ent1: { name: 'Ente X', type: 'individual', plan: 'free', hasAdmin: false, slots: {} } },
            usersStore: {
                u1: { email: 'admin@x.com', displayName: 'Admin Real', role: 'admin_individual', clubId: 'ent1', isAuthorized: true, status: 'active' },
            },
        });
        await sandbox.window.saIndividuals();
        ok('5a · detecta admin activo sin hasAdmin marcado -> corrige vía import dinámico', dynamicUpdateDocCalls.some(c => c.col === 'clubs' && c.id === 'ent1' && c.data.hasAdmin === true));
        const call = dynamicUpdateDocCalls.find(c => c.id === 'ent1');
        ok('5b · corrige con el uid/email/nombre del admin real', call && call.data.adminUid === 'u1' && call.data.adminEmail === 'admin@x.com' && call.data.adminName === 'Admin Real');
    }
    {
        const { sandbox, dynamicUpdateDocCalls } = buildSandbox({
            clubsStore: { ent1: { name: 'Ente X', type: 'individual', plan: 'free', hasAdmin: true, slots: {} } },
            usersStore: {
                u1: { email: 'admin@x.com', role: 'admin_individual', clubId: 'ent1', isAuthorized: true, status: 'active' },
            },
        });
        await sandbox.window.saIndividuals();
        ok('5c · ente ya con hasAdmin=true -> NO llama a corregir', dynamicUpdateDocCalls.length === 0);
    }
    {
        const { sandbox, dynamicUpdateDocCalls } = buildSandbox({
            clubsStore: { ent1: { name: 'Ente X', type: 'individual', plan: 'free', hasAdmin: false, slots: {} } },
            usersStore: {},
        });
        await sandbox.window.saIndividuals();
        ok('5d · sin admin activo para el ente -> NO llama a corregir', dynamicUpdateDocCalls.length === 0);
    }

    console.log('\n── PARTE 6 · saIndividuals() — manejo de errores ──');
    {
        const { sandbox, els } = buildSandbox({ getDocsThrows: 'permission-denied' });
        await sandbox.window.saIndividuals();
        ok('6a · error al cargar -> mensaje de error capturado, sin excepción', /permission-denied/.test(els['sa-body'].innerHTML));
    }

    console.log('\n── PARTE 7 · saActivateIndividual ──');
    {
        const { sandbox, updateDocCalls } = buildSandbox({ confirmReturns: false, usersStore: { u1: { email: 'a@x.com' } } });
        await sandbox.window.saActivateIndividual('u1', 'a@x.com');
        ok('7a · confirm cancelado -> ningún updateDoc', updateDocCalls.length === 0);
    }
    {
        const { sandbox, toasts } = buildSandbox({ confirmReturns: true, usersStore: {} });
        await sandbox.window.saActivateIndividual('no-existe', 'x@x.com');
        ok('7b · usuario no encontrado -> toast de error, no revienta', toasts.some(t => /Usuario no encontrado/i.test(t)));
    }
    {
        const { sandbox, updateDocCalls, toasts, usersStore } = buildSandbox({
            confirmReturns: true,
            clubsStore: { ent1: { name: 'Ente X', hasAdmin: false } },
            usersStore: { u1: { email: 'admin@x.com', role: 'admin_individual', individualEntityId: 'ent1', allRoles: [{ role: 'admin_individual', isAuthorized: false, status: 'pending' }] } },
        });
        await sandbox.window.saActivateIndividual('u1', 'admin@x.com');
        const uUpdate = updateDocCalls.find(c => c.col === 'users' && c.id === 'u1');
        ok('7c · activa isAuthorized/status del usuario', uUpdate && uUpdate.data.isAuthorized === true && uUpdate.data.status === 'active');
        ok('7d · activa TODOS los roles pendientes en allRoles', uUpdate && uUpdate.data.allRoles.every(r => r.isAuthorized === true && r.status === 'active'));
        ok('7e · setea clubId/individualEntityId/individualOwnerId al entityId detectado', uUpdate && uUpdate.data.clubId === 'ent1' && uUpdate.data.individualOwnerId === 'ent1');
        const entUpdate = updateDocCalls.find(c => c.col === 'clubs' && c.id === 'ent1');
        ok('7f · admin individual -> también marca hasAdmin de la entidad', entUpdate && entUpdate.data.hasAdmin === true && entUpdate.data.adminUid === 'u1');
        ok('7g · toast de éxito', toasts.some(t => /activado correctamente/i.test(t)));
    }

    console.log('\n── PARTE 8 · saAssignOrphanToEntity ──');
    {
        const { sandbox, toasts } = buildSandbox({ elements: { 'orph-ent-u1': { value: '' } } });
        await sandbox.window.saAssignOrphanToEntity('u1', 'x@x.com');
        ok('8a · sin ente seleccionado -> toast de aviso', toasts.some(t => /Selecciona un ente/i.test(t)));
    }
    {
        const { sandbox, updateDocCalls, toasts } = buildSandbox({
            elements: { 'orph-ent-u1': { value: 'ent1' } },
            clubsStore: { ent1: { name: 'Ente Destino' } },
            usersStore: { u1: { email: 'huerfano@x.com', role: 'user', allRoles: [{ role: 'user' }] } },
        });
        await sandbox.window.saAssignOrphanToEntity('u1', 'huerfano@x.com');
        const uUpdate = updateDocCalls.find(c => c.col === 'users' && c.id === 'u1');
        ok('8b · asigna clubId/individualEntityId/individualOwnerId al ente elegido', uUpdate && uUpdate.data.clubId === 'ent1' && uUpdate.data.individualEntityId === 'ent1' && uUpdate.data.individualOwnerId === 'ent1');
        ok('8c · guarda el nombre del ente en clubName', uUpdate && uUpdate.data.clubName === 'Ente Destino');
        ok('8d · toast de éxito menciona el email', toasts.some(t => /huerfano@x\.com/.test(t) && /asignado/i.test(t)));
    }
    {
        const { sandbox, updateDocCalls } = buildSandbox({
            elements: { 'orph-ent-u1': { value: 'ent1' } },
            clubsStore: { ent1: { name: 'Ente Destino', hasAdmin: false } },
            usersStore: { u1: { email: 'admin@x.com', role: 'admin_individual', displayName: 'Admin', allRoles: [{ role: 'admin_individual' }] } },
        });
        await sandbox.window.saAssignOrphanToEntity('u1', 'admin@x.com');
        const entUpdate = updateDocCalls.find(c => c.col === 'clubs' && c.id === 'ent1');
        ok('8e · si el huérfano es admin_individual -> también marca hasAdmin de la entidad', entUpdate && entUpdate.data.hasAdmin === true && entUpdate.data.adminUid === 'u1');
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
