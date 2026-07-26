// ─────────────────────────────────────────────────────────────────────────
// test_sa_messaging_module.js · Refactor de monolitos (auditoría 2026-07-22)
// PASO 11: extracción de "Mensajería SA" (saEscapeHtml / saEscapeAttr /
// saMessages / saUpdateCount / saSendMessages / saOpenThread / saSendReply /
// saDeleteSingleMessage / saDeleteAllMessages) desde
// js/admin/superadmin/superadmin.panel.js a js/admin/superadmin/messaging.js.
//
// Este test se escribió y se ejecutó EN VERDE contra el código todavía SIN
// mover (Puerta 3 del protocolo), y despues se re-ejecuto contra el fichero
// nuevo. Detecta automaticamente cual de los dos existe.
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
// Es la seccion mas aislada de las once de este monolito:
//   · FAN-IN EXTERNO = 0. Ninguna de las nueve funciones se referencia fuera
//     de superadmin.panel.js (ni en otro .js, ni en un onclick de .html).
//     El unico punto de entrada es saTab('messages') -> saMessages(), y saTab
//     se queda en el panel. La parte 1e fija esto de forma permanente.
//   · FAN-OUT a otras secciones = 0. No usa saFS(), ni _saToast, ni
//     _saShowSpinner: va por window._cronos_auth + un import() dinamico de
//     firebase-firestore.js propio en cada funcion, y avisa con alert().
//   · saEscapeHtml/saEscapeAttr son `function` PRIVADAS (no window.*) usadas
//     solo dentro de este bloque — se mueven con el, no se exportan.
// El harness sustituye ese import() dinamico por un modulo falso inyectado,
// misma tecnica que test_sa_extras_module.js (paso 3), y usa delegadores para
// los nombres "pelados" (paso 9), porque saSendMessages llama a saMessages()
// y saSendReply/saDeleteSingleMessage/saDeleteAllMessages llaman a
// saOpenThread() sin prefijo window.
//
// ── INCONSISTENCIA PREEXISTENTE, DOCUMENTADA NO CORREGIDA ──
// Al vaciarse un hilo, saDeleteSingleMessage deja `lastMessageAt: ''` pero
// saDeleteAllMessages deja `new Date().toISOString()`. Efecto: un hilo recien
// vaciado con "Vaciar" salta al PRINCIPIO de la lista de saMessages() (que
// ordena por lastMessageAt desc) en vez de irse al final. El mandato de este
// refactor es cambio-cero de comportamiento, asi que las partes 9e y 10d
// fijan el comportamiento REAL de cada una, divergencia incluida, para
// demostrar que el movimiento es mecanico. Si algun dia se unifica, sera en
// su propio commit y estos dos asserts son los que hay que actualizar.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PANEL = path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');
const EXTRACTED = path.join(ROOT, 'js', 'admin', 'superadmin', 'messaging.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : PANEL;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Mensajería SA — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Extracción del bloque ═════════════════════════════
// Marcador ASCII (evita depender de la codificación del comentario de sección).
function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('function saEscapeHtml(str)');
    if (s === -1) throw new Error('No se encontró saEscapeHtml en ' + SOURCE);
    // Es la última sección del fichero: llega hasta el final.
    return src.slice(s);
}
const BLOCK = readBlock();

const FIRESTORE_IMPORT =
    /await import\(\s*'https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js'\s*\)/g;

function buildSandbox({
    users = {}, threads = {}, currentUser = { uid: 'sa1', email: 'sa@cronos.app' },
    checked = [], allChecks = [], msgText = '', replyText = '',
    confirmReturns = true,
    getDocsThrows = null, getDocThrows = null, updateDocThrows = null, setDocThrows = null,
} = {}) {
    const stores = { users, cronos_messages: threads };
    const writes = [];   // {op, col, id, data}
    const alerts = [];
    const els = {};
    const el = (id) => (els[id] || (els[id] = {
        id, innerHTML: '', value: '', textContent: '', disabled: false,
        scrollTop: 0, scrollHeight: 4321,
    }));
    // Elementos que el navegador tendría ya en el DOM al invocarse.
    el('sa-body');
    el('sa-msg-text').value = msgText;
    el('sa-reply-input').value = replyText;

    const matches = (data, clauses) => (clauses || []).every(c => {
        if (!c || c.__where !== true) return true;
        if (c.op === 'array-contains') return Array.isArray(data[c.field]) && data[c.field].includes(c.value);
        return data[c.field] === c.value;
    });

    const applyData = (target, data) => {
        Object.keys(data).forEach(k => {
            const v = data[k];
            if (v && v.__arrayUnion) target[k] = (target[k] || []).concat(v.__arrayUnion);
            else target[k] = v;
        });
    };

    const fakeFirestore = {
        doc: (db, col, id) => ({ __col: col, __id: id }),
        getDoc: async (ref) => {
            if (getDocThrows) throw new Error(getDocThrows);
            const d = (stores[ref.__col] || {})[ref.__id];
            return { exists: () => d !== undefined, data: () => d };
        },
        setDoc: async (ref, data) => {
            if (setDocThrows) throw new Error(setDocThrows);
            writes.push({ op: 'set', col: ref.__col, id: ref.__id, data });
            (stores[ref.__col] = stores[ref.__col] || {})[ref.__id] = Object.assign({}, data);
        },
        updateDoc: async (ref, data) => {
            if (updateDocThrows) throw new Error(updateDocThrows);
            writes.push({ op: 'update', col: ref.__col, id: ref.__id, data });
            const st = stores[ref.__col] || {};
            if (st[ref.__id]) applyData(st[ref.__id], data);
        },
        collection: (db, col) => ({ __col: col }),
        query: (ref, ...clauses) => ({ __col: ref.__col, __clauses: clauses }),
        where: (field, op, value) => ({ __where: true, field, op, value }),
        getDocs: async (ref) => {
            if (getDocsThrows) throw new Error(getDocsThrows);
            const st = stores[ref.__col] || {};
            const rows = Object.keys(st)
                .filter(id => matches(st[id], ref.__clauses))
                .map(id => [id, st[id]]);
            return { forEach: (cb) => rows.forEach(r => cb({ id: r[0], data: () => r[1] })) };
        },
        arrayUnion: (...items) => ({ __arrayUnion: items }),
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: currentUser,
            _cronos_auth: { db: {}, functions: {} },
        },
        document: {
            getElementById: (id) => (els[id] !== undefined ? els[id] : null),
            querySelectorAll: (sel) => (String(sel).indexOf(':checked') !== -1 ? checked : allChecks),
        },
        alert: (m) => alerts.push(String(m)),
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl, RegExp, Error,
        __fakeFirestoreModule: fakeFirestore,
    };
    vm.createContext(sandbox);

    // Delegadores (técnica del paso 9): los nombres "pelados" deben resolver
    // contra window EN TIEMPO DE LLAMADA, para poder espiarlos desde el test.
    const forwards = `
        var saMessages = function() { return window.saMessages.apply(null, arguments); };
        var saOpenThread = function() { return window.saOpenThread.apply(null, arguments); };
        var saUpdateCount = function() { return window.saUpdateCount.apply(null, arguments); };
        var saSendMessages = function() { return window.saSendMessages.apply(null, arguments); };
        var saSendReply = function() { return window.saSendReply.apply(null, arguments); };
        var saDeleteSingleMessage = function() { return window.saDeleteSingleMessage.apply(null, arguments); };
        var saDeleteAllMessages = function() { return window.saDeleteAllMessages.apply(null, arguments); };
        // saEscapeHtml/saEscapeAttr son privadas del bloque: se exponen SOLO
        // al test, sin tocar el código fuente.
        window.__esc = { html: saEscapeHtml, attr: saEscapeAttr };
    `;

    vm.runInContext(BLOCK.replace(FIRESTORE_IMPORT, '__fakeFirestoreModule') + forwards, sandbox);

    return { sandbox, w: sandbox.window, stores, writes, alerts, els, el };
}

const mkChk = (uid, email, name) => ({ dataset: { uid, email, name }, checked: true });
const wrote = (writes, col, id) => writes.filter(x => x.col === col && x.id === id);
const lastWrite = (writes, col, id) => wrote(writes, col, id).slice(-1)[0];
const idxOf = (s, sub) => s.indexOf(sub);

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
}

(async () => {
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');

    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura, orden de carga y aislamiento ──');
    ok('1a · las 7 funciones window.* existen',
        /window\.saMessages\s*=\s*async function/.test(rawSrc)
        && /window\.saUpdateCount\s*=\s*\(\)\s*=>/.test(rawSrc)
        && /window\.saSendMessages\s*=\s*async\s*\(\)\s*=>/.test(rawSrc)
        && /window\.saOpenThread\s*=\s*async\s*\(threadId, otherName\)\s*=>/.test(rawSrc)
        && /window\.saSendReply\s*=\s*async\s*\(threadId, otherName\)\s*=>/.test(rawSrc)
        && /window\.saDeleteSingleMessage\s*=\s*async\s*\(threadId, index, otherName\)\s*=>/.test(rawSrc)
        && /window\.saDeleteAllMessages\s*=\s*async\s*\(threadId, otherName\)\s*=>/.test(rawSrc));
    ok('1b · saEscapeHtml/saEscapeAttr son privadas (declaradas function, NO window.*)',
        /^function saEscapeHtml\(str\)/m.test(rawSrc) && /^function saEscapeAttr\(str\)/m.test(rawSrc)
        && !/window\.saEscapeHtml\s*=/.test(rawSrc) && !/window\.saEscapeAttr\s*=/.test(rawSrc));
    ok('1c · no usa saFS() ni los helpers de toast/spinner del panel (fan-out cero)',
        !/\bsaFS\s*\(/.test(BLOCK) && !/_saToast\s*\(/.test(BLOCK)
        && !/_saShowSpinner\s*\(/.test(BLOCK) && !/_saHideSpinner\s*\(/.test(BLOCK));
    {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const requests = idxOf(idxHtml, 'js/admin/superadmin/requests-tab.js');
        const extras = idxOf(idxHtml, 'js/admin/superadmin/extras.js');
        const tag = IS_EXTRACTED ? 'js/admin/superadmin/messaging.js' : 'js/admin/superadmin/superadmin.panel.js';
        const target = idxOf(idxHtml, tag);
        // OJO: sin extraer, el <script> es el del propio panel, que va ANTES de
        // requests-tab.js (las extracciones se añaden después de él). La condición
        // "después de requests-tab.js" sólo aplica al fichero nuevo.
        ok('1d · el fichero se carga antes de extras.js (que parchea el panel SA)',
            target !== -1 && extras !== -1 && target < extras, { target, extras });
        if (IS_EXTRACTED) {
            ok('1d-bis · messaging.js se carga después de requests-tab.js (orden de extracciones)',
                requests !== -1 && target > requests, { requests, target });
        }
        if (IS_EXTRACTED) {
            const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
            ok('1e-bis · messaging.js está en el precache de sw.js',
                sw.includes('js/admin/superadmin/messaging.js'));
        }
    }
    {
        // FAN-IN externo = 0: nadie fuera de la fuente (ni del panel, mientras
        // conviva el comentario-puntero) referencia estas funciones.
        const NAMES = ['saMessages', 'saUpdateCount', 'saSendMessages', 'saOpenThread',
            'saSendReply', 'saDeleteSingleMessage', 'saDeleteAllMessages',
            'saEscapeHtml', 'saEscapeAttr'];
        const skip = new Set([SOURCE, PANEL].map(p => path.resolve(p)));
        const offenders = [];
        for (const f of walk(ROOT, [])) {
            const abs = path.resolve(f);
            if (skip.has(abs)) continue;
            if (path.relative(ROOT, f).replace(/\\/g, '/').startsWith('scripts/')) continue;
            const txt = fs.readFileSync(f, 'utf8');
            for (const n of NAMES) {
                if (new RegExp('\\b' + n + '\\b').test(txt)) {
                    offenders.push(path.relative(ROOT, f) + ':' + n);
                }
            }
        }
        ok('1e · fan-in externo = 0 (nadie referencia estas 9 funciones fuera del módulo)',
            offenders.length === 0, offenders);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · saEscapeHtml / saEscapeAttr ──');
    {
        const { w } = buildSandbox();
        const H = w.__esc.html, A = w.__esc.attr;
        ok('2a · saEscapeHtml escapa & < > " \'',
            H(`<b>&"'`) === '&lt;b&gt;&amp;&quot;&#039;', H(`<b>&"'`));
        ok('2b · saEscapeHtml escapa & primero (no hay doble escapado)',
            H('&lt;') === '&amp;lt;', H('&lt;'));
        ok('2c · saEscapeHtml devuelve "" con valores falsy (incluye 0 y "")',
            H('') === '' && H(null) === '' && H(undefined) === '' && H(0) === '');
        ok('2d · saEscapeAttr escapa SOLO comillas — NO escapa < > &',
            A(`O'Brien "x" <b>&`) === 'O&#039;Brien &quot;x&quot; <b>&',
            A(`O'Brien "x" <b>&`));
        ok('2e · saEscapeAttr devuelve "" con valores falsy', A('') === '' && A(null) === '');
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · saMessages() — selector de administradores ──');
    {
        const { w, el } = buildSandbox({
            users: {
                sa1:  { role: 'superadmin', email: 'sa@cronos.app', displayName: 'Yo' },
                a1:   { role: 'club_admin', email: 'club@x.com', displayName: 'Zeta Club', clubName: 'CD Zeta' },
                a2:   { role: 'admin', email: 'admin@x.com', displayName: 'Alfa Club' },
                i1:   { role: 'individual', email: 'ind@x.com', displayName: 'Indi Uno' },
                i2:   { role: 'user', allRoles: [{ role: 'admin_individual' }], email: 'ind2@x.com' },
                p1:   { role: 'parent', email: 'padre@x.com', displayName: 'Padre' },
                c1:   { role: 'user', email: 'coach@x.com', displayName: 'Entrenador' },
            },
        });
        await w.saMessages();
        const html = el('sa-body').innerHTML;
        ok('3a · incluye admins de club e individuales',
            html.includes('Zeta Club') && html.includes('Alfa Club')
            && html.includes('Indi Uno') && html.includes('ind2@x.com'));
        ok('3b · excluye a los NO admins (parent / user)',
            !html.includes('padre@x.com') && !html.includes('Entrenador'));
        ok('3c · excluye al propio superadmin (uid === _cronosCurrentUser.uid)',
            !html.includes('sa@cronos.app'));
        ok('3d · orden por adminType y luego displayName (Club < Individual, Alfa < Zeta)',
            idxOf(html, 'Alfa Club') < idxOf(html, 'Zeta Club')
            && idxOf(html, 'Zeta Club') < idxOf(html, 'Indi Uno'),
            { alfa: idxOf(html, 'Alfa Club'), zeta: idxOf(html, 'Zeta Club'), indi: idxOf(html, 'Indi Uno') });
        ok('3e · adminType "Administrador Individual" se detecta también vía allRoles',
            /Administrador Individual[\s\S]{0,200}?ind2@x\.com|ind2@x\.com[\s\S]{0,400}?Administrador Individual/.test(html));
        ok('3f · displayName cae a email cuando falta', html.includes('ind2@x.com'));
        ok('3g · clubName se muestra como sufijo sólo si existe',
            html.includes('CD Zeta') && html.split('·').length - 1 === 1,
            html.split('·').length - 1);
        ok('3h · los checkbox llevan data-uid/data-email/data-name y clase sa-msg-recipient-chk',
            html.includes('class="sa-msg-recipient-chk"')
            && html.includes('data-uid="a1"') && html.includes('data-email="club@x.com"')
            && html.includes('data-name="Zeta Club"')
            && html.includes('onchange="saUpdateCount()"'));
        ok('3i · el botón de envío llama saSendMessages() y muestra el contador',
            html.includes('onclick="saSendMessages()"') && html.includes('id="sa-selected-count"'));
    }
    {
        const { w, el } = buildSandbox({ users: {} });
        await w.saMessages();
        ok('3j · sin administradores muestra el mensaje vacío',
            el('sa-body').innerHTML.includes('No se encontraron administradores.'));
    }
    {
        const { w, el } = buildSandbox({
            users: { a1: { role: 'club_admin', email: 'x@x.com', displayName: `Club <b>"O'A"</b>` } },
        });
        await w.saMessages();
        const html = el('sa-body').innerHTML;
        ok('3k · el nombre se escapa con saEscapeHtml en el texto visible',
            html.includes('Club &lt;b&gt;&quot;O&#039;A&quot;&lt;/b&gt;'));
        ok('3l · y con saEscapeAttr en el data-name (comillas neutralizadas)',
            html.includes(`data-name="Club <b>&quot;O&#039;A&quot;</b>"`));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · saMessages() — lista de hilos ──');
    {
        const { w, el } = buildSandbox({
            users: {},
            threads: {
                t1: { participants: ['sa1', 'x'], recipientType: 'superadmin', staffEmail: 'uno@x.com',
                      lastMessage: 'Hola uno', lastMessageAt: '2026-07-20T10:00:00.000Z' },
                t2: { participants: ['sa1', 'y'], senderRole: 'superadmin', coachEmail: 'dos@x.com',
                      lastMessage: 'Hola dos', lastMessageAt: '2026-07-24T10:00:00.000Z' },
                t3: { participants: ['sa1', 'z'], threadId: 'sa_z_sa1', parentEmail: 'tres@x.com',
                      lastMessageAt: '2026-07-22T10:00:00.000Z' },
                t4: { participants: ['sa1', 'w'], recipientType: 'coach', staffEmail: 'nope@x.com',
                      lastMessage: 'No SA', lastMessageAt: '2026-07-25T10:00:00.000Z' },
                t5: { participants: ['otro', 'w'], recipientType: 'superadmin', staffEmail: 'ajeno@x.com',
                      lastMessage: 'Ajeno', lastMessageAt: '2026-07-26T10:00:00.000Z' },
            },
        });
        await w.saMessages();
        const html = el('sa-body').innerHTML;
        ok('4a · incluye hilos SA por recipientType, senderRole y threadId "sa_"',
            html.includes('uno@x.com') && html.includes('dos@x.com') && html.includes('tres@x.com'));
        ok('4b · excluye hilos no-SA', !html.includes('nope@x.com'));
        ok('4c · excluye hilos donde el SA no participa (where array-contains)',
            !html.includes('ajeno@x.com'));
        ok('4d · ordena por lastMessageAt descendente',
            idxOf(html, 'dos@x.com') < idxOf(html, 'tres@x.com')
            && idxOf(html, 'tres@x.com') < idxOf(html, 'uno@x.com'),
            { dos: idxOf(html, 'dos@x.com'), tres: idxOf(html, 'tres@x.com'), uno: idxOf(html, 'uno@x.com') });
        ok('4e · otherName = staffEmail || coachEmail || parentEmail',
            html.includes('uno@x.com') && html.includes('dos@x.com') && html.includes('tres@x.com'));
        ok('4f · lastMessage ausente cae a "—"', html.includes('>\n                                    —'.trim()) || /—/.test(html));
        ok('4g · cada hilo abre saOpenThread con su id de documento',
            html.includes(`onclick="saOpenThread('t1', 'uno@x.com')"`)
            && html.includes(`onclick="saOpenThread('t2', 'dos@x.com')"`));
    }
    {
        const { w, el } = buildSandbox({ users: {}, threads: {} });
        await w.saMessages();
        ok('4h · sin hilos muestra el mensaje vacío',
            el('sa-body').innerHTML.includes('No hay conversaciones iniciadas todavía.'));
    }
    {
        const { w, el } = buildSandbox({ getDocsThrows: 'boom <malo>' });
        await w.saMessages();
        const html = el('sa-body').innerHTML;
        ok('4i · un fallo de Firestore pinta el error escapado, no revienta',
            html.includes('Error al cargar') && html.includes('boom &lt;malo&gt;'), html.slice(0, 160));
    }
    {
        const { w, el } = buildSandbox({
            users: {}, threads: { t9: { participants: ['sa1'], recipientType: 'superadmin', staffEmail: `O'B "x"` } },
        });
        await w.saMessages();
        const html = el('sa-body').innerHTML;
        ok('4j · otherName se escapa con saEscapeAttr dentro del onclick',
            html.includes(`saOpenThread('t9', 'O&#039;B &quot;x&quot;')`), html.slice(idxOf(html, 'saOpenThread'), idxOf(html, 'saOpenThread') + 70));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · saUpdateCount() ──');
    {
        const { w, el } = buildSandbox({ checked: [mkChk('a', 'a@x', 'A'), mkChk('b', 'b@x', 'B')] });
        el('sa-selected-count');
        w.saUpdateCount();
        ok('5a · escribe el número de checkboxes marcados', el('sa-selected-count').textContent === 2,
            el('sa-selected-count').textContent);
    }
    {
        const { w } = buildSandbox({ checked: [] });
        let threw = false;
        try { w.saUpdateCount(); } catch (_) { threw = true; }
        ok('5b · no revienta si el contador aún no está en el DOM', !threw);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 6 · saSendMessages() ──');
    {
        const { w, writes, alerts } = buildSandbox({ msgText: '   ', checked: [mkChk('a', 'a@x', 'A')] });
        await w.saSendMessages();
        ok('6a · sin texto avisa y no escribe nada',
            writes.length === 0 && alerts.some(a => a.includes('Escribe un mensaje')), { writes: writes.length, alerts });
    }
    {
        const { w, writes, alerts } = buildSandbox({ msgText: 'Hola', checked: [] });
        await w.saSendMessages();
        ok('6b · sin destinatarios avisa y no escribe nada',
            writes.length === 0 && alerts.some(a => a.includes('al menos un destinatario')), { writes: writes.length, alerts });
    }
    {
        const { w, writes, stores, alerts, el } = buildSandbox({
            msgText: 'Mensaje nuevo',
            checked: [mkChk('admin2', 'a2@x.com', 'Admin Dos')],
        });
        await w.saSendMessages();
        const id = 'sa_admin2_sa1';   // 'sa_' + [me.uid,s.uid].sort().join('_')
        const wr = lastWrite(writes, 'cronos_messages', id);
        ok('6c · threadId determinista "sa_" + uids ordenados', !!wr, writes.map(x => x.id));
        ok('6d · hilo inexistente -> setDoc con el esquema completo',
            wr && wr.op === 'set'
            && wr.data.recipientType === 'superadmin' && wr.data.senderRole === 'superadmin'
            && wr.data.clubId === null
            && JSON.stringify(wr.data.participants) === JSON.stringify(['sa1', 'admin2'])
            && wr.data.coachUid === 'sa1' && wr.data.staffUid === 'admin2'
            && wr.data.staffEmail === 'a2@x.com'
            && wr.data.unreadByCoach === 0 && wr.data.unreadByStaff === 1 && wr.data.unreadByParent === 1
            && wr.data.messages.length === 1,
            wr && wr.data);
        ok('6e · el mensaje lleva sender/senderUid/text/timestamp',
            wr && wr.data.messages[0].sender === 'superadmin'
            && wr.data.messages[0].senderUid === 'sa1'
            && wr.data.messages[0].text === 'Mensaje nuevo'
            && typeof wr.data.messages[0].timestamp === 'string',
            wr && wr.data.messages[0]);
        ok('6f · lastMessage/lastMessageAt coinciden con el mensaje',
            wr && wr.data.lastMessage === 'Mensaje nuevo'
            && wr.data.lastMessageAt === wr.data.messages[0].timestamp);
        ok('6g · avisa y refresca la vista al terminar',
            alerts.some(a => a.includes('enviados correctamente'))
            && el('sa-body').innerHTML.length > 0);
        ok('6h · el doc queda realmente en el store', !!stores.cronos_messages[id]);
    }
    {
        const long = 'x'.repeat(80);
        const { w, writes } = buildSandbox({ msgText: long, checked: [mkChk('b2', 'b@x', 'B') ] });
        await w.saSendMessages();
        const wr = lastWrite(writes, 'cronos_messages', 'sa_b2_sa1');
        ok('6i · preview truncado a 60 caracteres + "…"',
            wr && wr.data.lastMessage === 'x'.repeat(60) + '…' && wr.data.messages[0].text === long,
            wr && wr.data.lastMessage.length);
    }
    {
        const { w, writes } = buildSandbox({
            msgText: 'Otro',
            checked: [mkChk('admin2', 'a2@x.com', 'A2')],
            threads: { sa_admin2_sa1: { messages: [{ text: 'previo' }], unreadByParent: 3, participants: ['sa1', 'admin2'] } },
        });
        await w.saSendMessages();
        const wr = lastWrite(writes, 'cronos_messages', 'sa_admin2_sa1');
        ok('6j · hilo existente -> updateDoc con arrayUnion (no sobrescribe el histórico)',
            wr && wr.op === 'update' && !!wr.data.messages.__arrayUnion
            && wr.data.messages.__arrayUnion[0].text === 'Otro', wr && wr.op);
        ok('6k · incrementa unreadByParent sobre el valor previo',
            wr && wr.data.unreadByParent === 4, wr && wr.data.unreadByParent);
    }
    {
        const { w, writes } = buildSandbox({
            msgText: 'Difusión',
            checked: [mkChk('u1', 'u1@x', 'U1'), mkChk('u2', 'u2@x', 'U2'), mkChk('u3', 'u3@x', 'U3')],
        });
        await w.saSendMessages();
        ok('6l · N destinatarios -> N hilos escritos',
            wrote(writes, 'cronos_messages', 'sa_sa1_u1').length === 1
            && wrote(writes, 'cronos_messages', 'sa_sa1_u2').length === 1
            && wrote(writes, 'cronos_messages', 'sa_sa1_u3').length === 1,
            writes.map(x => x.id));
    }
    {
        const { w, alerts, el } = buildSandbox({
            msgText: 'Hola', checked: [mkChk('a', 'a@x', 'A')], setDocThrows: 'sin red',
        });
        el('sa-send-btn');
        await w.saSendMessages();
        ok('6m · si falla, re-habilita el botón y avisa',
            el('sa-send-btn').disabled === false && alerts.some(a => a.includes('Error al enviar: sin red')),
            { disabled: el('sa-send-btn').disabled, alerts });
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 7 · saOpenThread() (incluye el botón "Vaciar") ──');
    {
        const { w, writes, el } = buildSandbox({
            threads: {
                t1: {
                    messages: [
                        { sender: 'superadmin', text: 'Mío <script>', timestamp: '2026-07-20T09:00:00.000Z' },
                        { sender: 'club_admin', text: 'Suyo', timestamp: '2026-07-20T10:00:00.000Z' },
                    ],
                },
            },
        });
        el('sa-thread-messages');
        await w.saOpenThread('t1', `O'Brien`);
        const shell = el('sa-body').innerHTML;
        const msgs = el('sa-thread-messages').innerHTML;
        ok('7a · cabecera con "← Volver" que llama saMessages()',
            shell.includes('onclick="saMessages()"') && shell.includes('← Volver'));
        ok('7b · el nombre del interlocutor va escapado con saEscapeHtml',
            shell.includes('O&#039;Brien'));
        ok('7c · botón "🗑️ Vaciar" que llama saDeleteAllMessages(threadId, nombre escapado)',
            shell.includes(`onclick="saDeleteAllMessages('t1', 'O&#039;Brien')"`)
            && shell.includes('Vaciar'), shell.slice(idxOf(shell, 'saDeleteAllMessages'), idxOf(shell, 'saDeleteAllMessages') + 60));
        // La ventana debe ser ancha: entre space-between y saMessages() se
        // interpone el <div> que agrupa "Volver" + nombre (~142 caracteres).
        ok('7d · la cabecera usa justify-content:space-between (botón a la derecha)',
            /justify-content:space-between;[\s\S]{0,220}saMessages\(\)/.test(shell)
            && /saEscapeHtml\(otherName\)[\s\S]{0,400}saDeleteAllMessages/.test(BLOCK));
        ok('7e · caja de respuesta: Enter envía y el botón llama saSendReply',
            shell.includes(`saSendReply('t1', 'O&#039;Brien')`)
            && shell.includes("event.key==='Enter'&&!event.shiftKey")
            && shell.includes('id="sa-reply-input"') && shell.includes('id="sa-reply-btn"'));
        ok('7f · los mensajes propios se alinean a la derecha y los ajenos a la izquierda',
            idxOf(msgs, 'flex-end') !== -1 && idxOf(msgs, 'flex-start') !== -1
            && idxOf(msgs, 'flex-end') < idxOf(msgs, 'flex-start'));
        ok('7g · el texto de cada mensaje va escapado',
            msgs.includes('Mío &lt;script&gt;') && !msgs.includes('Mío <script>'));
        ok('7h · cada mensaje lleva su índice correcto en saDeleteSingleMessage',
            msgs.includes(`saDeleteSingleMessage('t1', 0, 'O&#039;Brien')`)
            && msgs.includes(`saDeleteSingleMessage('t1', 1, 'O&#039;Brien')`));
        ok('7i · el borrado por mensaje detiene la propagación del click',
            msgs.includes('event.stopPropagation(); saDeleteSingleMessage'));
        ok('7j · marca el hilo como leído por el SA (unreadByCoach: 0)',
            (lastWrite(writes, 'cronos_messages', 't1') || {}).data
            && lastWrite(writes, 'cronos_messages', 't1').data.unreadByCoach === 0,
            writes);
        ok('7k · hace scroll al final del hilo', el('sa-thread-messages').scrollTop === 4321);
    }
    {
        const { w, el } = buildSandbox({ threads: { t2: { messages: [] } } });
        el('sa-thread-messages');
        await w.saOpenThread('t2', 'X');
        ok('7l · hilo vacío muestra "Sin mensajes aún."',
            el('sa-thread-messages').innerHTML.includes('Sin mensajes aún.'));
    }
    {
        const { w, el } = buildSandbox({ threads: {} });
        el('sa-thread-messages');
        await w.saOpenThread('nope', 'X');
        ok('7m · hilo inexistente muestra "Sin mensajes aún." (no revienta)',
            el('sa-thread-messages').innerHTML.includes('Sin mensajes aún.'));
    }
    {
        const { w, el } = buildSandbox({ getDocThrows: 'caído <x>' });
        el('sa-thread-messages');
        await w.saOpenThread('t1', 'X');
        ok('7n · un fallo pinta el error escapado en el contenedor',
            el('sa-thread-messages').innerHTML.includes('caído &lt;x&gt;'),
            el('sa-thread-messages').innerHTML.slice(0, 140));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 8 · saSendReply() ──');
    {
        const { w, writes } = buildSandbox({ replyText: '   ' });
        await w.saSendReply('t1', 'X');
        ok('8a · respuesta vacía no escribe nada', writes.length === 0, writes);
    }
    {
        const { w, writes, el } = buildSandbox({
            replyText: 'Respondo', threads: { t1: { messages: [{ text: 'previo' }] } },
        });
        el('sa-thread-messages');
        await w.saSendReply('t1', 'X');
        const wr = writes.filter(x => x.data && x.data.messages)[0];
        ok('8b · añade el mensaje con arrayUnion',
            wr && !!wr.data.messages.__arrayUnion
            && wr.data.messages.__arrayUnion[0].sender === 'superadmin'
            && wr.data.messages.__arrayUnion[0].text === 'Respondo', wr && wr.data);
        ok('8c · actualiza lastMessage/lastMessageAt y unreadByParent: 1',
            wr && wr.data.lastMessage === 'Respondo'
            && wr.data.lastMessageAt === wr.data.messages.__arrayUnion[0].timestamp
            && wr.data.unreadByParent === 1, wr && wr.data);
        ok('8d · limpia el input y refresca el hilo',
            el('sa-reply-input').value === '' && el('sa-body').innerHTML.length > 0);
    }
    {
        const long = 'y'.repeat(80);
        const { w, writes } = buildSandbox({ replyText: long, threads: { t1: { messages: [] } } });
        await w.saSendReply('t1', 'X');
        const wr = writes.filter(x => x.data && x.data.messages)[0];
        ok('8e · preview truncado a 60 + "…"', wr && wr.data.lastMessage === 'y'.repeat(60) + '…');
    }
    {
        const { w, alerts, el } = buildSandbox({ replyText: 'Hola', updateDocThrows: 'sin red' });
        el('sa-reply-btn');
        await w.saSendReply('t1', 'X');
        ok('8f · si falla, re-habilita el botón y avisa',
            el('sa-reply-btn').disabled === false && alerts.some(a => a.includes('Error al responder: sin red')),
            { disabled: el('sa-reply-btn').disabled, alerts });
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 9 · saDeleteSingleMessage() ──');
    const threeMsgs = () => ({
        t1: {
            messages: [
                { sender: 'superadmin', text: 'uno', timestamp: '2026-07-20T09:00:00.000Z' },
                { sender: 'club_admin', text: 'dos', timestamp: '2026-07-20T10:00:00.000Z' },
                { sender: 'superadmin', text: 'tres', timestamp: '2026-07-20T11:00:00.000Z' },
            ],
            lastMessage: 'tres', lastMessageAt: '2026-07-20T11:00:00.000Z',
        },
    });
    {
        const { w, writes } = buildSandbox({ threads: threeMsgs(), confirmReturns: false });
        await w.saDeleteSingleMessage('t1', 1, 'X');
        ok('9a · si el usuario cancela el confirm, no escribe nada', writes.length === 0, writes);
    }
    {
        const { w, writes, stores, el } = buildSandbox({ threads: threeMsgs() });
        el('sa-thread-messages');
        await w.saDeleteSingleMessage('t1', 1, 'X');
        const wr = lastWrite(writes, 'cronos_messages', 't1');
        ok('9b · elimina exactamente el índice indicado',
            wr && wr.data.messages.length === 2
            && wr.data.messages.map(m => m.text).join(',') === 'uno,tres',
            wr && wr.data.messages.map(m => m.text));
        ok('9c · recalcula lastMessage/lastMessageAt con el último restante',
            wr && wr.data.lastMessage === 'tres' && wr.data.lastMessageAt === '2026-07-20T11:00:00.000Z');
        ok('9d · refresca el hilo tras borrar', el('sa-body').innerHTML.length > 0);
        ok('9d-bis · el store refleja el borrado', stores.cronos_messages.t1.messages.length === 2);
    }
    {
        const { w, writes, el } = buildSandbox({ threads: threeMsgs() });
        el('sa-thread-messages');
        await w.saDeleteSingleMessage('t1', 2, 'X');
        const wr = lastWrite(writes, 'cronos_messages', 't1');
        ok('9d-ter · al borrar el último, lastMessage pasa a ser el anterior',
            wr && wr.data.lastMessage === 'dos' && wr.data.lastMessageAt === '2026-07-20T10:00:00.000Z',
            wr && wr.data);
    }
    {
        const { w, writes, el } = buildSandbox({
            threads: { t1: { messages: [{ sender: 'superadmin', text: 'solo', timestamp: '2026-07-20T09:00:00.000Z' }] } },
        });
        el('sa-thread-messages');
        await w.saDeleteSingleMessage('t1', 0, 'X');
        const wr = lastWrite(writes, 'cronos_messages', 't1');
        // Divergencia documentada con saDeleteAllMessages: aquí lastMessageAt = ''.
        ok('9e · al quedar vacío: lastMessage "— Sin mensajes —" y lastMessageAt = "" (cadena vacía)',
            wr && wr.data.messages.length === 0
            && wr.data.lastMessage === '— Sin mensajes —'
            && wr.data.lastMessageAt === '', wr && wr.data);
    }
    {
        const longMsg = 'z'.repeat(80);
        const { w, writes, el } = buildSandbox({
            threads: { t1: { messages: [
                { text: longMsg, timestamp: '2026-07-20T09:00:00.000Z' },
                { text: 'borrame', timestamp: '2026-07-20T10:00:00.000Z' },
            ] } },
        });
        el('sa-thread-messages');
        await w.saDeleteSingleMessage('t1', 1, 'X');
        const wr = lastWrite(writes, 'cronos_messages', 't1');
        ok('9f · el lastMessage recalculado también se trunca a 60 + "…"',
            wr && wr.data.lastMessage === 'z'.repeat(60) + '…', wr && wr.data.lastMessage.length);
    }
    {
        const { w, writes } = buildSandbox({ threads: threeMsgs() });
        await w.saDeleteSingleMessage('t1', 9, 'X');
        await w.saDeleteSingleMessage('t1', -1, 'X');
        ok('9g · índice fuera de rango no escribe nada', writes.length === 0, writes);
    }
    {
        const { w, writes } = buildSandbox({ threads: {} });
        await w.saDeleteSingleMessage('nope', 0, 'X');
        ok('9h · hilo inexistente no escribe nada', writes.length === 0, writes);
    }
    {
        const { w, alerts } = buildSandbox({ threads: threeMsgs(), updateDocThrows: 'sin red' });
        await w.saDeleteSingleMessage('t1', 0, 'X');
        ok('9i · si falla, avisa con "Error al borrar"',
            alerts.some(a => a.includes('Error al borrar: sin red')), alerts);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 10 · saDeleteAllMessages() — el botón "Vaciar" ──');
    {
        const { w, writes } = buildSandbox({ threads: threeMsgs(), confirmReturns: false });
        await w.saDeleteAllMessages('t1', 'X');
        ok('10a · si el usuario cancela el confirm, no escribe nada', writes.length === 0, writes);
    }
    {
        const { w, writes, stores, el } = buildSandbox({ threads: threeMsgs() });
        el('sa-thread-messages');
        await w.saDeleteAllMessages('t1', `O'Brien`);
        const wr = lastWrite(writes, 'cronos_messages', 't1');
        ok('10b · vacía el array de mensajes por completo',
            wr && wr.op === 'update' && Array.isArray(wr.data.messages) && wr.data.messages.length === 0,
            wr && wr.data);
        ok('10c · lastMessage pasa a "— Sin mensajes —"',
            wr && wr.data.lastMessage === '— Sin mensajes —', wr && wr.data.lastMessage);
        // Divergencia documentada con saDeleteSingleMessage (9e), que deja ''.
        ok('10d · lastMessageAt se sella con la fecha del vaciado (ISO, no cadena vacía)',
            wr && typeof wr.data.lastMessageAt === 'string' && wr.data.lastMessageAt !== ''
            && /^\d{4}-\d{2}-\d{2}T/.test(wr.data.lastMessageAt), wr && wr.data.lastMessageAt);
        ok('10e · el store queda vacío', stores.cronos_messages.t1.messages.length === 0);
        ok('10f · refresca el hilo tras vaciar', el('sa-body').innerHTML.length > 0);
        ok('10g · NO borra el documento del hilo (sólo lo vacía)',
            !!stores.cronos_messages.t1 && writes.every(x => x.op !== 'delete'), writes.map(x => x.op));
    }
    {
        const { w, alerts } = buildSandbox({ threads: threeMsgs(), updateDocThrows: 'sin red' });
        await w.saDeleteAllMessages('t1', 'X');
        ok('10h · si falla, avisa con "Error al vaciar"',
            alerts.some(a => a.includes('Error al vaciar: sin red')), alerts);
    }
    {
        const { w, writes } = buildSandbox({ threads: { t1: { messages: [] } } });
        await w.saDeleteAllMessages('t1', 'X');
        ok('10i · vaciar un hilo ya vacío es idempotente (escribe, no falla)',
            wrote(writes, 'cronos_messages', 't1').length === 1, writes.length);
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
