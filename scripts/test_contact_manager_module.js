// ─────────────────────────────────────────────────────────────────────────
// test_contact_manager_module.js · Refactor de monolitos (auditoria 2026-07-22)
// MONOLITO #3 (js/coach/comms/panel.js), PASO 4 de 6: extraccion de
// "§9 Gestor de Contactos" (openContactManager / saveContactManagerData /
// renderContactRowMarkup / renderParentRowMarkup / addNewContactRow /
// addNewParentRow, 631 lineas) a js/coach/comms/contact-manager.js.
//
// Escrito y ejecutado EN VERDE contra el codigo todavia SIN mover (Puerta 3).
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
// Fan-out: la interseccion del bloque contra los nombres de nivel superior de
// panel.js da CINCO, dos mas que en el paso 3: _cFS, _cGetStaff,
// _catAndSubcatMatch, _loadParentList y openUnifiedCommsMenu. Los cinco se
// quedan en panel.js y resuelven via window en tiempo de click.
//
// Fan-in externo = 1: js/core/setup-modal.js llama a openContactManager. Las
// otras cinco solo se invocan desde el HTML que este bloque genera.
//
// Estado compartido: el bloque ESCRIBE window._cronos_squad_cache, que lee
// js/coach/comms/individual-reports.js (extraido en el paso 3). Acoplamiento
// entre dos modulos ya extraidos; se resuelve por window en tiempo de
// ejecucion, pero conviene que quede fijado (asercion 1d).
//
// Dependencias externas: emailConfig y currentMode (globales lexicos de
// core/app-init.js), loadEmailConfig, cloudSet, escapeHtml, escapeAttr,
// showToast/showSpinner/hideSpinner. OJO: el bloque usa _cFS() Y ADEMAS dos
// import() dinamicos directos del SDK de Firestore (uno en cada funcion
// principal). El arnes tiene que cubrir las dos vias.
//
// ── ⚠️ EL TEST EXISTENTE QUE ESTE PASO ROMPE ──
// scripts/test_contact_manager_crash.js localiza el codigo con
// src.indexOf('async function openContactManager()') LEYENDO panel.js por
// ruta. Tras la extraccion fnStart seria -1 y el test pasaria de 3 PASS/4 FAIL
// a fallar entero. Y como esta en XFAIL, la suite seguiria verde y el
// destrozo seria INVISIBLE. Hay que reapuntarlo a contact-manager.js en el
// mismo commit de extraccion, dejando sus aserciones intactas para no perder
// la senal. La asercion 1i de este archivo lo vigila.
//
// ── CUATRO RAREZAS PREEXISTENTES QUE SE PRESERVAN (no se arreglan aqui) ──
//  1. Los dos guards del principio de openContactManager inicializan
//     `window.emailConfig`, pero TODO el resto de la funcion usa el nombre
//     pelado `emailConfig`, que es un `let` de app-init.js y NO cuelga de
//     window: son dos bindings distintos. Los guards son inertes. El guard que
//     de verdad evita el crash es el de la migracion. Partes 1e/1f y 2c/2d.
//  2. saveContactManagerData busca `c.tags.includes('reports')` para
//     retrocompatibilidad, pero las etiquetas que escribe son cv/tr/msg/rpt/
//     live — 'reports' NUNCA aparece. Esa rama es codigo muerto y
//     directorEmail/whatsappNumber no se actualizan jamas. Parte 4i.
//  3. Su comentario dice "Solo anadir inviteCode si no existia ya (para no
//     sobreescribir)" pero el codigo lo escribe SIEMPRE que haya dorsal.
//     El comentario contradice al codigo. Parte 4d.
//  4. El playerName de un padre manual se recupera parseando el TEXTO del
//     <option> con .split('] ')[1] — un viaje de ida y vuelta por la cadena de
//     presentacion. Parte 4g.
// Ademas: showSpinner esta protegido con typeof en openContactManager pero
// hideSpinner NO, y en saveContactManagerData los tres van sin guarda.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'comms', 'panel.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'comms', 'contact-manager.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Gestor de Contactos — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('async function openContactManager()');
    if (s === -1) throw new Error('No se encontro openContactManager en ' + SOURCE);
    if (IS_EXTRACTED) return src.slice(s);
    // Marcador de fin verificado UNICO en panel.js (aparece una sola vez, en
    // el comentario-puntero del paso 1).
    const e = src.indexOf('NOTIFICACIÓN DE ENTRENAMIENTO', s);
    if (e === -1) throw new Error('No se encontro el final de la seccion');
    const cut = src.slice(s, e);
    return cut.slice(0, cut.lastIndexOf('};') + 2);
}
const BLOCK = readBlock();

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
}

// ── DOM minimo ───────────────────────────────────────────────────────────
// `autoQ` imita el parseo real de innerHTML: los elementos creados con
// document.createElement resuelven cualquier querySelector devolviendo un hijo
// (asi addNew*Row encuentra su <tr> y su .c-name, como haria el navegador).
// Las filas que construyen las pruebas de guardado NO lo llevan, para que un
// selector que el codigo no deberia pedir siga dando null.
function mkEl(tag, autoQ) {
    const el = {
        tagName: tag, innerHTML: '', value: '', textContent: '', checked: false,
        style: {}, dataset: {}, options: [], selectedIndex: 0,
        children: [], removed: false, focused: false,
        _q: {},                       // selector -> elemento (mock manual)
        focus() { this.focused = true; },
        remove() { this.removed = true; },
        appendChild(c) { this.children.push(c); return c; },
        querySelector(sel) {
            if (this._q[sel]) return this._q[sel];
            if (autoQ) return (this._q[sel] = mkEl(sel, true));
            return null;
        },
        querySelectorAll(sel) { const r = this._q[sel]; return r ? (Array.isArray(r) ? r : [r]) : []; },
        closest() { return this; },
    };
    return el;
}

function buildSandbox({
    me = { uid: 'coach1', clubId: 'club1', email: 'c@x.com', displayName: 'Entre', category: 'Alevin', subcategory: 'A' },
    noUser = false,
    noAuth = false,
    contacts = undefined,          // emailConfig.contacts inicial (undefined = ausente)
    emailCfgExtra = {},
    links = [],                    // documentos de cronos_player_links
    parentUsers = [],              // documentos de users con role=parent
    staff = [],                    // lo que devuelve _cGetStaff
    staffThrows = null,
    parentUsersThrows = null,
    linksThrows = null,
    roster = null,                 // localStorage cronos_master_roster
    matchAll = true,               // _catAndSubcatMatch
    // solo para saveContactManagerData:
    phoneRows = [], staffRows = [], manualRows = [], queryMap = {},
    updateThrows = null,
    noCloudSet = false,
} = {}) {
    const toasts = [], spinners = [], logs = [], menuCalls = [], parentListCalls = [];
    const written = [], cloudWrites = [], catMatchCalls = [];
    const els = {};
    const el = (id) => (els[id] = els[id] || mkEl('div'));
    const modal = el('setup-modal');

    const snapOf = (docs) => ({ forEach: (fn) => docs.forEach(d => fn({ id: d._id || d.id || 'auto', data: () => d })) });

    const fsApi = {
        collection: (db, name) => ({ __col: name }),
        query: (colRef, ...clauses) => ({ __col: colRef.__col, clauses }),
        where: (f, op, v) => ({ f, op, v }),
        getDocs: async (q) => {
            if (q.__col === 'cronos_player_links') {
                if (linksThrows) throw new Error(linksThrows);
                return snapOf(links);
            }
            if (q.__col === 'users') {
                if (parentUsersThrows) throw new Error(parentUsersThrows);
                return snapOf(parentUsers);
            }
            return snapOf([]);
        },
        doc: (db, col, id) => ({ __col: col, __id: id }),
        updateDoc: async (ref, data) => {
            if (updateThrows) throw new Error(updateThrows);
            written.push({ col: ref.__col, id: ref.__id, data });
        },
    };

    const emailConfig = Object.assign({}, emailCfgExtra);
    if (contacts !== undefined) emailConfig.contacts = contacts;

    const sandbox = {
        window: {
            _cronosCurrentUser: noUser ? null : me,
            _cronos_auth: noAuth ? null : { db: { __db: true } },
        },
        document: {
            getElementById: (id) => el(id),
            createElement: (t) => mkEl(t, true),
            querySelectorAll: (sel) => {
                if (sel === '.contact-phone') return phoneRows;
                if (sel === '.custom-contact-row') return staffRows;
                if (sel === '.manual-parent') return manualRows;
                return queryMap[sel] || [];
            },
            querySelector: (sel) => queryMap[sel] || null,
        },
        console: {
            log: (...a) => logs.push(a.join(' ')),
            warn: (...a) => logs.push(a.join(' ')),
            error: (...a) => logs.push(a.join(' ')),
        },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON,
        parseInt, parseFloat, isNaN, RegExp, Error,
        localStorage: {
            getItem: (k) => (k === 'cronos_master_roster' && roster ? JSON.stringify(roster) : null),
            setItem: () => {},
        },
        currentMode: 'f11',
        emailConfig,
        loadEmailConfig: () => {},
        escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        escapeAttr: (s) => String(s == null ? '' : s).replace(/"/g, '&quot;'),
        showToast: (m) => toasts.push(String(m)),
        showSpinner: (m) => spinners.push({ on: true, msg: m }),
        hideSpinner: () => spinners.push({ on: false }),
        // Los CINCO helpers de panel.js que el bloque necesita.
        _cFS: async () => Object.assign({ db: { __db: true } }, fsApi),
        _cGetStaff: async (db, clubId, fns, roles) => {
            if (staffThrows) throw new Error(staffThrows);
            return staff;
        },
        _catAndSubcatMatch: (cc, cs, tc, ts) => { catMatchCalls.push([cc, cs, tc, ts]); return matchAll; },
        _loadParentList: () => parentListCalls.push(1),
        openUnifiedCommsMenu: () => menuCalls.push(1),
    };
    if (!noCloudSet) sandbox.cloudSet = async (k, v) => cloudWrites.push({ k, v });

    // El bloque usa import() dinamico real (dos veces). Se sustituye por __imp,
    // igual que hace scripts/test_contact_manager_crash.js.
    const patched = BLOCK.replace(/\bimport\s*\(/g, '__imp(');
    sandbox.__imp = async () => fsApi;

    vm.createContext(sandbox);
    vm.runInContext(patched, sandbox);

    return {
        g: sandbox, w: sandbox.window, cfg: () => sandbox.emailConfig,
        toasts, spinners, logs, menuCalls, parentListCalls, written, cloudWrites, catMatchCalls,
        modal, el: (id) => els[id],
    };
}

// helpers para construir filas del DOM en las pruebas de guardado
const chk = (v) => { const e = mkEl('input'); e.checked = v; return e; };
const inp = (v) => { const e = mkEl('input'); e.value = v; return e; };
const staffRow = (id, type, name, email, phone, uid, tags = []) => {
    const r = mkEl('tr');
    r.dataset = { id, type };
    r._q = {
        '.tag-cv': chk(tags.includes('cv')), '.tag-tr': chk(tags.includes('tr')),
        '.tag-msg': chk(tags.includes('msg')), '.tag-rpt': chk(tags.includes('rpt')),
        '.tag-live': chk(tags.includes('live')),
        '.c-name': inp(name), '.c-email': inp(email), '.c-phone': inp(phone), '.c-uid': inp(uid),
    };
    return r;
};
const manualRow = (id, name, phone, email, playerId, optText, tags = []) => {
    const r = mkEl('tr');
    r.dataset = { id };
    const sel = inp(playerId);
    sel.options = [{ text: optText }];
    sel.selectedIndex = 0;
    r._q = {
        '.p-cv': chk(tags.includes('cv')), '.p-tr': chk(tags.includes('tr')),
        '.p-msg': chk(tags.includes('msg')), '.p-rpt': chk(tags.includes('rpt')),
        '.p-live': chk(tags.includes('live')),
        '.p-player': sel, '.p-name': inp(name), '.p-phone': inp(phone), '.p-email': inp(email),
    };
    return r;
};

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura y acoplamiento ──');
    ok('1a · las seis piezas estan en el bloque',
        /^async function openContactManager\(\)/m.test(BLOCK)
        && /^async function saveContactManagerData\(\)/m.test(BLOCK)
        && /^function renderContactRowMarkup\(c = \{\}\)/m.test(BLOCK)
        && /^function renderParentRowMarkup\(c = \{\}\)/m.test(BLOCK)
        && /^window\.addNewContactRow = \(\) =>/m.test(BLOCK)
        && /^window\.addNewParentRow = \(\) =>/m.test(BLOCK));
    {
        const panel = fs.readFileSync(ORIGIN, 'utf8');
        const names = new Set();
        for (const l of panel.split(/\r?\n/)) {
            let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
            m = l.match(/^window\.([A-Za-z_$][\w$]*)\s*=(?!=)/); if (m) names.add(m[1]);
            m = l.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/); if (m) names.add(m[1]);
        }
        const moved = ['openContactManager', 'saveContactManagerData', 'renderContactRowMarkup',
                       'renderParentRowMarkup', 'addNewContactRow', 'addNewParentRow'];
        const used = [...names].filter(n => !moved.includes(n)
            && new RegExp('\\b' + n.replace(/[$]/g, '\\$') + '\\b').test(BLOCK)).sort();
        ok('1b · fan-out a panel.js = los cinco helpers esperados',
            JSON.stringify(used) === JSON.stringify(
                ['_cFS', '_cGetStaff', '_catAndSubcatMatch', '_loadParentList', 'openUnifiedCommsMenu'].sort()),
            used);
    }
    {
        const callers = [];
        for (const f of walk(ROOT, [])) {
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            if (rel.startsWith('scripts/') || rel === 'sw.js') continue;
            if (rel === 'js/coach/comms/panel.js' || rel === 'js/coach/comms/contact-manager.js') continue;
            const txt = fs.readFileSync(f, 'utf8');
            if (/\bopenContactManager\b/.test(txt)) callers.push(rel);
        }
        ok('1c · fan-in externo = solo core/setup-modal.js',
            JSON.stringify(callers) === JSON.stringify(['js/core/setup-modal.js']), callers);
    }
    {
        const ir = path.join(ROOT, 'js', 'coach', 'comms', 'individual-reports.js');
        ok('1d · escribe window._cronos_squad_cache, que lee individual-reports.js',
            /window\._cronos_squad_cache = currentSquad;/.test(BLOCK)
            && fs.existsSync(ir)
            && /window\._cronos_squad_cache/.test(fs.readFileSync(ir, 'utf8')));
    }
    ok('1e · ⚠️ los dos guards iniciales tocan window.emailConfig (binding distinto del `let` global: son inertes)',
        (BLOCK.match(/window\.emailConfig/g) || []).length === 4
        && /if \(typeof window\.emailConfig === 'undefined'\) window\.emailConfig = \{ contacts: \[\] \};/.test(BLOCK));
    {
        let others = 0;
        for (const f of walk(ROOT, [])) {
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            if (rel.startsWith('scripts/')) continue;
            if (rel === 'js/coach/comms/panel.js' || rel === 'js/coach/comms/contact-manager.js') continue;
            if (/window\.emailConfig/.test(fs.readFileSync(f, 'utf8'))) others++;
        }
        ok('1f · ⚠️ y nadie mas en el repositorio lee window.emailConfig', others === 0, others);
    }
    ok('1g · usa _cFS() Y ADEMAS dos import() dinamicos del SDK',
        /await _cFS\(\)/.test(BLOCK) && (BLOCK.match(/await import\(/g) || []).length === 2);
    ok('1h · el guard efectivo contra el crash sigue siendo el de la migracion',
        /if \(!emailConfig \|\| !emailConfig\.contacts\) \{/.test(BLOCK));
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const comms = idxHtml.indexOf('js/coach/comms/panel.js');
        const target = idxHtml.indexOf('js/coach/comms/contact-manager.js');
        ok('1i · ⚠️ test_contact_manager_crash.js ya apunta al archivo nuevo (si no, su fallo seria invisible por XFAIL)',
            fs.readFileSync(path.join(ROOT, 'scripts', 'test_contact_manager_crash.js'), 'utf8')
                .includes('contact-manager.js'));
        ok('1j · contact-manager.js se carga despues de comms/panel.js',
            target !== -1 && target > comms, { comms, target });
        ok('1k · esta en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/comms/contact-manager.js'));
        ok('1l · esta en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/comms/contact-manager.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · openContactManager: guardas, migracion y auto-poblacion ──');
    {
        const t = buildSandbox({ noUser: true });
        await t.g.openContactManager();
        ok('2a · sin sesion avisa y no abre nada',
            t.toasts.some(x => x.includes('No hay sesión activa')) && t.modal.innerHTML === '', t.toasts);
    }
    {
        const t = buildSandbox({ noAuth: true });
        await t.g.openContactManager();
        ok('2b · sin Firebase avisa y no abre nada',
            t.toasts.some(x => x.includes('Firebase no disponible')) && t.modal.innerHTML === '', t.toasts);
    }
    {
        // La condicion exacta del bug historico: emailConfig SIN contacts.
        const t = buildSandbox({ emailCfgExtra: { coachEmail: '' } });
        let threw = null;
        try { await t.g.openContactManager(); } catch (e) { threw = e; }
        ok('2c · con emailConfig sin `contacts` no revienta (guard de la migracion)',
            !threw && Array.isArray(t.cfg().contacts), threw && threw.message);
        ok('2d · el guard inerte deja ademas un window.emailConfig aparte',
            t.w.emailConfig !== undefined && t.w.emailConfig !== t.cfg(),
            { win: !!t.w.emailConfig, same: t.w.emailConfig === t.cfg() });
    }
    {
        // Se hace fallar a _cGetStaff a proposito: eso salta el try entero, y
        // con el la purga, que es lo unico que deja ver el resultado de la
        // migracion legacy (ver 2g).
        const t = buildSandbox({
            emailCfgExtra: { directorEmail: 'dir@x.com', whatsappNumber: '600', directorEmail2: 'coord@x.com' },
            staffThrows: 'sin permisos',
        });
        await t.g.openContactManager();
        const c = t.cfg().contacts;
        ok('2e · migra directorEmail y directorEmail2 a contactos cuando no habia lista',
            c.some(x => x.email === 'dir@x.com' && x.name === 'Director Deportivo')
            && c.some(x => x.email === 'coord@x.com' && x.name === 'Coordinador'), c.map(x => x.email));
        ok('2f · los migrados llevan las etiquetas legacy reports/notifs',
            c.find(x => x.email === 'dir@x.com').tags.join() === 'reports,notifs');
    }
    {
        // ⚠️ En el camino NORMAL la purga borra justo lo que acaba de migrar:
        // los contactos legacy no tienen uid y su email no esta en el staff
        // real de Firestore, asi que el filtro los tira. La migracion solo
        // sobrevive si esos emails SI pertenecen a staff real.
        const t = buildSandbox({ emailCfgExtra: { directorEmail: 'dir@x.com', directorEmail2: 'coord@x.com' } });
        await t.g.openContactManager();
        const emails = t.cfg().contacts.map(x => x.email);
        ok('2g · ⚠️ pero la purga posterior los elimina: la migracion legacy no llega a verse',
            !emails.includes('dir@x.com') && !emails.includes('coord@x.com'), emails);
        const t2 = buildSandbox({
            emailCfgExtra: { directorEmail: 'dir@x.com' },
            staff: [{ uid: 'd1', email: 'dir@x.com', role: 'director', displayName: 'Dir' }],
        });
        await t2.g.openContactManager();
        ok('2h · salvo que ese email SI sea staff real de Firestore, y entonces se conserva',
            t2.cfg().contacts.some(x => x.email === 'dir@x.com'),
            t2.cfg().contacts.map(x => x.email));
    }
    {
        // ⚠️ PURGA: los contactos de staff que ya no estan en Firestore se caen.
        const t = buildSandbox({
            contacts: [
                { id: 'a', uid: 'viejo', email: 'viejo@x.com', type: 'staff' },
                { id: 'b', uid: 'realdir', email: 'dir@x.com', type: 'staff' },
                { id: 'c', uid: 'papa', email: 'p@x.com', type: 'parent' },
            ],
            staff: [{ uid: 'realdir', email: 'dir@x.com', role: 'director', displayName: 'Dir' }],
        });
        await t.g.openContactManager();
        const uids = t.cfg().contacts.map(x => x.uid);
        ok('2i · ⚠️ purga el staff que ya no existe en Firestore',
            !uids.includes('viejo') && uids.includes('realdir'), uids);
        ok('2j · pero NUNCA purga a los padres', uids.includes('papa'), uids);
    }
    {
        const t = buildSandbox({
            contacts: [],
            staff: [
                { uid: 'd1', email: 'd@x.com', role: 'director', displayName: 'Dir' },
                { uid: 'c1', email: 'c@y.com', role: 'coordinator', displayName: 'Coord' },
                { uid: 'a1', email: 'a@y.com', role: 'club_admin' },
            ],
        });
        await t.g.openContactManager();
        const c = t.cfg().contacts;
        ok('2k · anade el staff real de Firestore con type staff y las cinco etiquetas',
            c.find(x => x.uid === 'd1').type === 'staff'
            && c.find(x => x.uid === 'd1').tags.join() === 'rpt,msg,cv,tr,live');
        ok('2l · club_admin se etiqueta como Director Deportivo y coordinator como Coordinador',
            c.find(x => x.uid === 'a1').name === 'Director Deportivo'
            && c.find(x => x.uid === 'c1').name === 'Coord',
            c.map(x => [x.uid, x.name]));
    }
    {
        const t = buildSandbox({ contacts: [], staffThrows: 'sin permisos' });
        await t.g.openContactManager();
        ok('2m · un fallo de _cGetStaff se traga con un aviso y NO aborta la modal',
            t.logs.some(l => l.includes('Error cargando staff')) && t.modal.innerHTML.length > 100,
            t.logs.slice(0, 2));
    }
    {
        const t = buildSandbox({
            contacts: [],
            links: [{ _id: 'club1_7', playerNumber: '7', parentUid: 'p7', parentName: 'Madre', playerAlias: 'Ana', parentPhone: '600', category: 'Alevin' }],
        });
        await t.g.openContactManager();
        const p = t.cfg().contacts.find(x => x.type === 'parent');
        ok('2n · anade los padres de cronos_player_links con su jugador y dorsal',
            p && p.uid === 'p7' && p.player === 'Ana' && p.playerNumber === '7', p);
        ok('2o · el filtro por categoria/subcategoria se delega en _catAndSubcatMatch',
            t.catMatchCalls.some(a => a[0] === 'Alevin' && a[1] === 'A'), t.catMatchCalls);
    }
    {
        const t = buildSandbox({
            contacts: [],
            links: [{ _id: 'club1_7', playerNumber: '7', parentUid: 'p7', category: 'Alevin' }],
            matchAll: false,
        });
        await t.g.openContactManager();
        ok('2p · si _catAndSubcatMatch dice que no, ese padre no entra',
            !t.cfg().contacts.some(x => x.type === 'parent'), t.cfg().contacts);
    }
    {
        const t = buildSandbox({
            contacts: [],
            parentUsers: [{ _id: 'u9', email: 'u9@x.com', displayName: 'Padre App', role: 'parent', childName: 'Leo' }],
        });
        await t.g.openContactManager();
        const p = t.cfg().contacts.find(x => x.uid === 'u9');
        ok('2q · anade tambien los usuarios con rol parent registrados en la app',
            p && p.type === 'parent' && p.player === 'Leo', p);
    }
    {
        const t = buildSandbox({
            contacts: [{ id: 'x', uid: 'p7', email: 'p7@x.com', type: 'parent' }],
            links: [{ _id: 'club1_7', playerNumber: '7', parentUid: 'p7' }],
            parentUsers: [{ _id: 'p7', email: 'p7@x.com', role: 'parent' }],
        });
        await t.g.openContactManager();
        ok('2r · no duplica un padre que ya estaba en la lista',
            t.cfg().contacts.filter(x => x.uid === 'p7').length === 1,
            t.cfg().contacts.map(x => x.uid));
    }
    {
        const t = buildSandbox({ contacts: [], parentUsersThrows: 'reglas' });
        await t.g.openContactManager();
        ok('2s · un fallo buscando usuarios padres tampoco aborta la modal',
            t.logs.some(l => l.includes('Error buscando usuarios padres')) && t.modal.innerHTML.length > 100);
    }
    {
        const t = buildSandbox({ contacts: [] });
        await t.g.openContactManager();
        const self = t.cfg().contacts.find(x => x.uid === 'coach1');
        ok('2t · se anade a si mismo como type coach y marcado (TU)',
            self && self.type === 'coach' && /\(TÚ\)/.test(self.name), self);
    }
    {
        const t = buildSandbox({ contacts: [], roster: { f7: [], f11: [{ id: 'J7', number: 7, alias: 'Ana' }] } });
        await t.g.openContactManager();
        ok('2u · publica la plantilla del modo actual en window._cronos_squad_cache',
            Array.isArray(t.w._cronos_squad_cache) && t.w._cronos_squad_cache[0].alias === 'Ana',
            t.w._cronos_squad_cache);
    }
    {
        const t = buildSandbox({ contacts: [], linksThrows: 'sin red' });
        await t.g.openContactManager();
        ok('2v · si falla la consulta de vinculaciones avisa por toast',
            t.toasts.some(x => x.includes('sin red') || x.includes('Error')), t.toasts);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · el HTML de la modal ──');
    {
        const t = buildSandbox({
            contacts: [{ id: 's1', uid: 'd1', name: 'Dir', email: 'd@x.com', type: 'staff', tags: ['rpt'] }],
            links: [{ _id: 'club1_7', playerNumber: '7', parentName: 'Madre', playerAlias: 'Ana', inviteCode: 'J7' }],
        });
        await t.g.openContactManager();
        const h = t.modal.innerHTML;
        ok('3a · abre la modal', t.modal.style.display === 'flex' && h.length > 500);
        ok('3b · tiene las dos secciones y sus dos tbody',
            h.includes('tbody-custom-contacts') && h.includes('tbody-parent-contacts'));
        ok('3c · la fila de padre vinculado lleva data-linkid y clase firestore-linked',
            h.includes('firestore-linked') && h.includes('data-linkid="club1_7"'));
        ok('3d · muestra el codigo de invitacion del padre', h.includes('J7'));
        ok('3e · el boton de guardar llama a saveContactManagerData',
            /saveContactManagerData\(\)/.test(h));
        ok('3f · la X vuelve al menu unificado', /onclick="openUnifiedCommsMenu\(\)"/.test(h));
        ok('3g · los inputs de telefono del padre llevan la clase que lee el guardado',
            h.includes('class="contact-phone"'));
    }
    {
        const t = buildSandbox({
            contacts: [
                { id: 's1', uid: 'd1', name: 'Dir', type: 'staff', tags: [] },
                { id: 'p1', uid: 'x', name: 'Manual', type: 'parent', tags: [] },
            ],
        });
        await t.g.openContactManager();
        const h = t.modal.innerHTML;
        ok('3h · los de type parent van a la tabla naranja y el resto a la azul',
            h.includes('custom-contact-row') && h.includes('manual-parent'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · saveContactManagerData ──');
    {
        const emailEl = inp('madre@x.com'), cvEl = chk(true), trEl = chk(false),
              msgEl = chk(true), rptEl = chk(true), liveEl = chk(false);
        const phone = inp(' 600 11 22 33 ');
        phone.dataset = { linkid: 'club1_7' };
        const t = buildSandbox({
            phoneRows: [phone],
            queryMap: {
                '.contact-parent-email[data-linkid="club1_7"]': emailEl,
                '.contact-cv[data-linkid="club1_7"]': cvEl,
                '.contact-tr[data-linkid="club1_7"]': trEl,
                '.contact-msg[data-linkid="club1_7"]': msgEl,
                '.contact-rpt[data-linkid="club1_7"]': rptEl,
                '.contact-live[data-linkid="club1_7"]': liveEl,
            },
        });
        await t.g.saveContactManagerData();
        const u = t.written[0];
        ok('4a · escribe cada padre vinculado en cronos_player_links por su linkId',
            u && u.col === 'cronos_player_links' && u.id === 'club1_7', t.written);
        ok('4b · normaliza el telefono quitando los espacios', u.data.parentPhone === '600112233', u.data.parentPhone);
        ok('4c · vuelca los cinco permisos desde las palomillas',
            u.data.canReceiveConv === true && u.data.canReceiveTr === false
            && u.data.canReceiveMsg === true && u.data.canReceiveReports === true
            && u.data.canWatchLive === false, u.data);
        ok('4d · ⚠️ escribe SIEMPRE inviteCode J+dorsal (el comentario dice "solo si no existia")',
            u.data.inviteCode === 'J7', u.data.inviteCode);
    }
    {
        const phone = inp('600');
        phone.dataset = { linkid: 'club1_7' };
        const t = buildSandbox({ phoneRows: [phone], queryMap: {} });
        await t.g.saveContactManagerData();
        ok('4e · ⚠️ sin input de email escribe parentEmail: undefined (se preserva tal cual)',
            'parentEmail' in t.written[0].data && t.written[0].data.parentEmail === undefined,
            Object.keys(t.written[0].data));
    }
    {
        const t = buildSandbox({
            staffRows: [staffRow('s1', 'staff', ' Dir ', ' d@x.com ', ' 600 11 ', 'uidD', ['cv', 'rpt'])],
            manualRows: [manualRow('p1', 'Madre', '611', 'm@x.com', 'J7', '[J7] Ana', ['msg'])],
        });
        await t.g.saveContactManagerData();
        const c = t.cfg().contacts;
        ok('4f · reconstruye emailConfig.contacts desde el DOM, recortando y quitando espacios del telefono',
            c.length === 2 && c[0].name === 'Dir' && c[0].email === 'd@x.com' && c[0].phone === '60011',
            c);
        ok('4g · ⚠️ el nombre del jugador se recupera parseando el TEXTO del <option> con split("] ")',
            c[1].player === 'Ana' && c[1].playerId === 'J7', c[1]);
        ok('4h · las etiquetas salen de las palomillas marcadas',
            c[0].tags.join() === 'cv,rpt' && c[1].tags.join() === 'msg', c.map(x => x.tags));
    }
    {
        const t = buildSandbox({
            staffRows: [staffRow('s1', 'staff', 'Dir', 'd@x.com', '600', 'uidD', ['rpt'])],
            emailCfgExtra: { directorEmail: 'ANTIGUO@x.com', whatsappNumber: 'ANTIGUO' },
        });
        await t.g.saveContactManagerData();
        ok('4i · ⚠️ la rama legacy busca la etiqueta "reports", que NUNCA se escribe: es codigo muerto',
            t.cfg().directorEmail === 'ANTIGUO@x.com' && t.cfg().whatsappNumber === 'ANTIGUO',
            { d: t.cfg().directorEmail, w: t.cfg().whatsappNumber });
    }
    {
        const t = buildSandbox({ staffRows: [staffRow('s1', 'staff', 'D', 'd@x.com', '', '', [])] });
        await t.g.saveContactManagerData();
        ok('4j · persiste en la nube bajo cronos_email_config',
            t.cloudWrites.length === 1 && t.cloudWrites[0].k === 'cronos_email_config', t.cloudWrites);
        ok('4k · confirma, vuelve al menu y refresca la lista de padres',
            t.toasts.some(x => x.includes('Fuente de la Verdad actualizada'))
            && t.menuCalls.length === 1 && t.parentListCalls.length === 1);
    }
    {
        const phone = inp('600');
        phone.dataset = { linkid: 'club1_7' };
        const t = buildSandbox({ phoneRows: [phone], updateThrows: 'sin red' });
        await t.g.saveContactManagerData();
        ok('4l · si falla la escritura oculta el spinner, avisa y NO vuelve al menu',
            t.spinners.some(s => !s.on) && t.toasts.some(x => x.includes('Error al guardar: sin red'))
            && t.menuCalls.length === 0, { toasts: t.toasts, menu: t.menuCalls.length });
    }
    {
        const t = buildSandbox({ staffRows: [staffRow('s1', 'staff', 'D', 'd@x.com', '', '', [])], noCloudSet: true });
        await t.g.saveContactManagerData();
        ok('4m · sin cloudSet disponible guarda igualmente en memoria y no rompe',
            t.cfg().contacts.length === 1 && t.toasts.some(x => x.includes('actualizada')), t.toasts);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · los dos renderers y las filas nuevas ──');
    {
        const t = buildSandbox({});
        const h = t.g.renderContactRowMarkup({ id: 'x1', name: 'Dir', email: 'd@x.com', phone: '600', uid: 'u1', type: 'staff', tags: ['cv', 'live'] });
        ok('5a · la fila de staff lleva la clase que lee el guardado y sus data-*',
            h.includes('class="custom-contact-row"') && h.includes('data-id="x1"') && h.includes('data-type="staff"'));
        ok('5b · marca solo las palomillas de las etiquetas presentes',
            /class="tag-cv" checked/.test(h) && /class="tag-live" checked/.test(h)
            && !/class="tag-rpt" checked/.test(h));
        const hc = t.g.renderContactRowMarkup({ id: 'me', type: 'coach', name: 'Yo' });
        ok('5c · la fila del propio entrenador pone el uid en readonly y no ofrece papelera',
            hc.includes('readonly') && !hc.includes('🗑️') && hc.includes('👤'));
        ok('5d · escapa los atributos con escapeAttr',
            t.g.renderContactRowMarkup({ name: 'A"B' }).includes('A&quot;B'));
    }
    {
        const t = buildSandbox({});
        t.w._cronos_squad_cache = [{ id: 'J7', alias: 'Ana' }, { id: 'J9', name: 'Leo' }];
        const h = t.g.renderParentRowMarkup({ id: 'p1', name: 'Madre', playerId: 'J9', tags: ['rpt'] });
        ok('5e · la fila de padre manual lleva las dos clases que usa el guardado',
            h.includes('parent-contact-row') && h.includes('manual-parent'));
        ok('5f · el desplegable se construye desde window._cronos_squad_cache',
            h.includes('[J7]') && h.includes('Ana') && h.includes('[J9]') && h.includes('Leo'));
        ok('5g · preselecciona el jugador vinculado', /value="J9"\s+selected/.test(h), h.match(/<option[^>]*J9[^>]*>/));
        ok('5h · el texto del option es "[id] alias", que es lo que el guardado vuelve a parsear',
            /\[J7\]\s*Ana/.test(h));
    }
    {
        const t = buildSandbox({});
        const tbody = t.g.document.getElementById('tbody-custom-contacts');
        t.w.addNewContactRow();
        ok('5i · addNewContactRow anade una fila al tbody de staff y le da el foco',
            tbody.children.length === 1 && tbody.children[0].querySelector('.c-name').focused === true,
            tbody.children.length);
        const tb2 = t.g.document.getElementById('tbody-parent-contacts');
        t.w.addNewParentRow();
        ok('5j · addNewParentRow hace lo propio en el tbody de padres',
            tb2.children.length === 1 && tb2.children[0].querySelector('.p-name').focused === true,
            tb2.children.length);
        ok('5k · ambas salen sin hacer nada si el tbody no esta en el DOM',
            (BLOCK.match(/const tbody = document\.getElementById\('tbody-[a-z-]+'\);\s*\r?\n\s*if \(!tbody\) return;/g) || []).length === 2);
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
