// ─────────────────────────────────────────────────────────────────────────
// test_training_notify_module.js · Refactor de monolitos (auditoría 2026-07-22)
// MONOLITO #3 (js/coach/comms/panel.js), PASO 1 de 6: extracción de
// "Notificación de entrenamiento" (openTrainingNotification /
// _sendTrainingNotification) a js/coach/comms/training-notify.js.
//
// Escrito y ejecutado EN VERDE contra el código todavía SIN mover (Puerta 3).
//
// ── ACOPLAMIENTO VERIFICADO (Puerta 1) ──
//  · FAN-IN: dos consumidores externos, ambos con guarda typeof y en tiempo de
//    click — js/core/app-init.js:2349 y js/coach/training/panel.js:98 — más el
//    botón "Envío Interno" del HTML que genera la propia sección.
//    _sendTrainingNotification no tiene consumidor externo.
//  · FAN-OUT: NO usa _cFS() (el helper del archivo); hace su propio import()
//    dinámico de firebase-firestore. Depende de sharedBuildRecipientsHTML /
//    sharedGetSelectedRecipients / _cronos_getContactsByFlag (las tres viven en
//    js/shared/whatsapp-email.js, no aquí), de showToast/showSpinner/
//    hideSpinner y de escapeAttr/escapeHtml, todas con guarda typeof.
//  · ÚNICA dependencia interna: openUnifiedCommsMenu(), que está en §11 y se
//    extraerá en el paso 5. Como es una function declaration pasa a window y
//    resuelve en tiempo de llamada, así que funciona igual antes y después.
//    El archivo nuevo NO es autónomo por este motivo.
//
// ── IMPACTO EN TESTS EXISTENTES: CERO ──
// Ningún test de scripts/ menciona openTrainingNotification,
// _sendTrainingNotification, cronos_last_training, tr-datetime,
// tr-recipient-chk ni cronos_tr_preselection. Es el punto de entrada más
// seguro de este monolito. OJO de todos modos con
// test_staff_chat_unification.js, que asierta el ORDEN de los <script> en
// index.html (utils → comms/panel → club-reports): el tag nuevo va después de
// comms/panel.js y no puede colarse entre esos tres. La parte 1 lo fija.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'comms', 'panel.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'comms', 'training-notify.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Notificación de entrenamiento — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('async function openTrainingNotification()');
    if (s === -1) throw new Error('No se encontró openTrainingNotification en ' + SOURCE);
    const marker = 'window.openTrainingNotification = openTrainingNotification;';
    const e = src.indexOf(marker, s);
    if (e === -1) throw new Error('No se encontró la línea de export');
    return src.slice(s, e + marker.length);
}
const BLOCK = readBlock();

const FIRESTORE_IMPORT =
    /await import\(\s*'https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js'\s*\)/g;

// El lunes de la semana, con la MISMA fórmula que la fuente.
function mondayKey(offset) {
    const now = new Date(); const dow = now.getDay();
    const m = new Date(now); m.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
    m.setHours(0, 0, 0, 0);
    return m.toISOString().substring(0, 10);
}

function buildSandbox({
    me = { uid: 'coach1', clubId: 'club1', email: 'c@x.com' },
    store = {},                   // localStorage
    trContacts = [],
    manualSelected = [],
    checked = [],                 // .tr-recipient-chk:checked
    noModal = false,
    weekOffset = 0,
    recipientsHTML = '<div id="RECIPIENTS-OK"></div>',
    noSharedBuild = false,
    hasCache = false,
    setDocThrows = null,
    inputs = {},                  // valores de tr-datetime / tr-location / tr-notes
} = {}) {
    const ls = Object.assign({}, store);
    const written = [];
    const toasts = [];
    const spinners = [];
    const menuCalls = [];
    const flagCalls = [];
    const els = {};
    const el = (id, extra) => (els[id] = Object.assign(
        { id, innerHTML: '', value: '', style: {}, dataset: {} }, extra));
    const modal = noModal ? null : el('setup-modal');
    el('tr-datetime', { value: inputs.datetime || '' });
    el('tr-location', { value: inputs.location || '' });
    el('tr-notes', { value: inputs.notes || '' });

    const fakeFS = {
        doc: (db, col, id) => ({ __col: col, __id: id }),
        setDoc: async (ref, data) => {
            if (setDocThrows) throw new Error(setDocThrows);
            written.push({ col: ref.__col, id: ref.__id, data });
        },
    };

    const sandbox = {
        window: {
            _cronosCurrentUser: me,
            _cronos_auth: { db: {} },
            _trWeekOffset: weekOffset,
            _cronosContactsCache: hasCache ? {} : undefined,
            _cronos_getContactsByFlag: async (flag) => { flagCalls.push(flag); return trContacts; },
            sharedGetSelectedRecipients: (p) => manualSelected,
        },
        document: {
            getElementById: (id) => (id === 'setup-modal' ? modal : (els[id] || null)),
            querySelectorAll: () => checked,
            body: { classList: { remove: (c) => { sandbox.document.body.__removed = c; } } },
        },
        localStorage: {
            getItem: (k) => (k in ls ? ls[k] : null),
            setItem: (k, v) => { ls[k] = String(v); },
        },
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        showToast: (m) => toasts.push(String(m)),
        showSpinner: (m) => spinners.push({ on: true, msg: m }),
        hideSpinner: () => spinners.push({ on: false }),
        escapeAttr: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/\//g, '&#x2F;'),
        openUnifiedCommsMenu: () => { menuCalls.push(1); },
        __fakeFirestoreModule: fakeFS,
    };
    if (!noSharedBuild) sandbox.window.sharedBuildRecipientsHTML = (saved, prefix) => recipientsHTML;
    vm.createContext(sandbox);
    vm.runInContext(BLOCK.replace(FIRESTORE_IMPORT, '__fakeFirestoreModule'), sandbox);

    return { g: sandbox, w: sandbox.window, ls, written, toasts, spinners, menuCalls, flagCalls, modal, el: (id) => els[id] };
}

const idxOf = (s, sub) => s.indexOf(sub);

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · estructura, acoplamiento y registro ──');
    ok('1a · openTrainingNotification es function declaration con export explícito',
        /^async function openTrainingNotification\(\)/m.test(BLOCK)
        && /window\.openTrainingNotification = openTrainingNotification;/.test(BLOCK));
    ok('1b · _sendTrainingNotification se asigna directamente a window',
        /^window\._sendTrainingNotification = async function\(\)/m.test(BLOCK));
    ok('1c · NO usa _cFS(); hace su propio import() dinámico',
        !/_cFS\(\)/.test(BLOCK) && (BLOCK.match(FIRESTORE_IMPORT) || []).length === 1);
    // 2026-07-29 · ACTUALIZADA. Eran 3 llamadas: los dos onclick de la modal
    // (X y Volver) más la de _sendTrainingNotification al terminar el envío.
    // Con la pila de navegación (js/core/nav-stack.js) los dos onclick pasan a
    // navExit()/navBack(), así que sólo queda la del final del envío — que NO
    // es navegación de salida, sino "a dónde ir después de enviar".
    ok('1d · su única dependencia interna del monolito es openUnifiedCommsMenu() (×1, tras el envío)',
        (BLOCK.match(/openUnifiedCommsMenu\(\)/g) || []).length === 1,
        (BLOCK.match(/openUnifiedCommsMenu\(\)/g) || []).length);
    {
        const ai = fs.readFileSync(path.join(ROOT, 'js', 'core', 'app-init.js'), 'utf8');
        const tp = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'training', 'panel.js'), 'utf8');
        // 1e · Hasta el 2026-07-28 esto comprobaba un onclick de app-init.js.
        // Ese onclick vivía dentro de renderTrainingWeek, que era una COPIA
        // MUERTA: coach/training/panel.js declara la misma función y carga
        // después, así que la de app-init.js no se ejecutaba nunca. Se borró en
        // la Fase A del monolito #5, y con ella su onclick. El invariante útil
        // ahora es el contrario: que la copia muerta no vuelva.
        ok('1e · app-init.js ya NO contiene la copia muerta del botón ENVIAR',
            !/openTrainingNotification/.test(ai) && !/^function renderTrainingWeek\s*\(/m.test(ai));
        // 1f · el punto de entrada VIVO, que es el que hay que proteger: el
        // botón real está en coach/training/panel.js y llama con guarda typeof.
        ok('1f · training/panel.js la invoca con guarda typeof (punto de entrada vivo)',
            /typeof openTrainingNotification==='function'\)\s*\{\s*openTrainingNotification\(\)/.test(tp));
    }
    {
        // Ningún test (salvo éste) toca la sección.
        const SC = path.join(ROOT, 'scripts');
        const NAMES = /openTrainingNotification|_sendTrainingNotification|cronos_last_training|tr-recipient-chk|cronos_tr_preselection/;
        // 2026-07-29 · test_nav_stack.js se declara EXPLICITAMENTE. No duplica
        // la cobertura de esta seccion: sólo comprueba que la pantalla se
        // registra en la pila de navegación (js/core/nav-stack.js), que es
        // otra propiedad. Se lista aquí en vez de relajar el barrido, para que
        // cualquier OTRO test que empiece a depender de la sección siga dando
        // rojo. Misma familia que el barrido que contaba los .bak_* del repo.
        const PERMITIDOS = new Set(['test_nav_stack.js']);
        const offenders = fs.readdirSync(SC).filter(f =>
            /^test_.*\.js$/.test(f) && f !== path.basename(__filename)
            && !PERMITIDOS.has(f)
            && NAMES.test(fs.readFileSync(path.join(SC, f), 'utf8')));
        ok('1g · ningún otro test depende de esta sección (salvo el de navegación)',
            offenders.length === 0, offenders);
    }
    {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const utils = idxOf(idxHtml, 'js/core/utils.js');
        const comms = idxOf(idxHtml, 'js/coach/comms/panel.js');
        const reports = idxOf(idxHtml, 'js/coach/reports/club-reports.js');
        ok('1h · se preserva el orden utils → comms/panel → club-reports (test_staff_chat_unification)',
            utils !== -1 && utils < comms && comms < reports, { utils, comms, reports });
        if (IS_EXTRACTED) {
            const target = idxOf(idxHtml, 'js/coach/comms/training-notify.js');
            ok('1i · training-notify.js se carga después de comms/panel.js',
                target !== -1 && target > comms, { comms, target });
            ok('1j · está en el precache de sw.js',
                fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/comms/training-notify.js'));
            ok('1k · está en la lista de _check_syntax.js',
                fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                    .includes('js/coach/comms/training-notify.js'));
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · openTrainingNotification: el formulario ──');
    {
        const { g, modal } = buildSandbox({ noModal: true });
        await g.openTrainingNotification();
        ok('2a · sin la modal en el DOM no hace nada', modal === null);
    }
    {
        const { g, modal, flagCalls } = buildSandbox({});
        await g.openTrainingNotification();
        ok('2b · quita setup-mode del body', g.document.body.__removed === 'setup-mode');
        ok('2c · precarga la caché de contactos con el flag "tr"',
            flagCalls.includes('tr'), flagCalls);
        ok('2d · muestra la modal', modal.style.display === 'flex');
        const h = modal.innerHTML;
        ok('2e · pinta los tres campos con sus ids',
            h.includes('id="tr-datetime"') && h.includes('id="tr-location"') && h.includes('id="tr-notes"'));
        ok('2f · el botón de envío llama a _sendTrainingNotification()',
            h.includes('onclick="_sendTrainingNotification()"'));
        // 2026-07-29 · ASERCION INVERTIDA. Antes exigia que Volver y X fueran
        // los dos a openUnifiedCommsMenu(): un destino FIJO, y una X que
        // navegaba en vez de cerrar. Ahora Volver deshace la via real y la X
        // sale. Ver scripts/test_nav_stack.js.
        ok('2g · el botón de volver usa navBack() y la X sale con navExit()',
            /onclick="navBack\(\)"/.test(h) && /onclick="navExit\(\)"/.test(h)
            && (h.match(/openUnifiedCommsMenu\(\)/g) || []).length === 0);
        ok('2h · inserta el HTML de destinatarios de sharedBuildRecipientsHTML',
            h.includes('RECIPIENTS-OK') && h.includes('id="tr-recipients-list"'));
        ok('2i · los tres botones de selección usan el prefijo "tr"',
            h.includes("sharedSelectAll(true,'tr')") && h.includes("sharedSelectAll(false,'tr')")
            && h.includes("sharedSavePreselection('tr')"));
    }
    {
        const { g, flagCalls } = buildSandbox({ hasCache: true });
        await g.openTrainingNotification();
        ok('2j · si la caché ya existe, no la vuelve a precargar al abrir',
            flagCalls.length === 0, flagCalls);
    }
    {
        const { g, modal } = buildSandbox({ noSharedBuild: true });
        await g.openTrainingNotification();
        ok('2k · sin sharedBuildRecipientsHTML pinta el placeholder de carga',
            modal.innerHTML.includes('Cargando contactos'));
    }
    {
        // Auto-relleno desde la planificación semanal de la semana en curso.
        const key = mondayKey(0);
        const week = {}; week[key] = { '2026-03-04': { hora: '18:30', lugar: 'Campo Anexo' } };
        const { g, modal } = buildSandbox({
            store: { cronos_training_weeks: JSON.stringify(week) },
        });
        await g.openTrainingNotification();
        const h = modal.innerHTML;
        ok('2l · auto-rellena el lugar desde la planificación semanal',
            h.includes('value="Campo Anexo"'), h.slice(idxOf(h, 'tr-location'), idxOf(h, 'tr-location') + 90));
        ok('2m · y la fecha/hora, en formato datetime-local',
            h.includes('value="2026-03-04T18:30"') || /value="2026-03-04T\d{2}:\d{2}"/.test(h),
            h.slice(idxOf(h, 'tr-datetime'), idxOf(h, 'tr-datetime') + 80));
    }
    {
        // Sin planificación: cae a lo último guardado.
        const { g, modal } = buildSandbox({
            store: { cronos_last_training: JSON.stringify({ location: 'Pabellón', datetime: '2026-02-01T10:00', notes: 'Traer botas' }) },
        });
        const h = (await g.openTrainingNotification(), modal.innerHTML);
        ok('2n · sin planificación cae al último entrenamiento guardado',
            h.includes('value="Pabellón"') && h.includes('value="2026-02-01T10:00"'));
        ok('2o · y restaura también las notas', h.includes('Traer botas'));
    }
    {
        const { g, modal } = buildSandbox({
            store: { cronos_last_training: JSON.stringify({ location: `Campo "A" <b>`, notes: `<script>x</script>` }) },
        });
        await g.openTrainingNotification();
        const h = modal.innerHTML;
        ok('2p · el lugar se escapa con escapeAttr y las notas con escapeHtml',
            h.includes('&quot;A&quot;') && h.includes('&lt;script&gt;') && !h.includes('<script>x'));
    }
    {
        // _trWeekOffset desplaza la semana consultada.
        const key = mondayKey(1);
        const week = {}; week[key] = { '2026-03-11': { hora: '19:00', lugar: 'Semana Siguiente' } };
        const { g, modal } = buildSandbox({
            weekOffset: 1, store: { cronos_training_weeks: JSON.stringify(week) },
        });
        await g.openTrainingNotification();
        ok('2q · _trWeekOffset desplaza la semana de la que se auto-rellena',
            modal.innerHTML.includes('Semana Siguiente'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · _sendTrainingNotification: validación y persistencia ──');
    {
        const { w, written, toasts } = buildSandbox({ inputs: {} });
        await w._sendTrainingNotification();
        ok('3a · sin fecha ni lugar avisa y no escribe nada',
            written.length === 0 && toasts.some(t => t.includes('al menos fecha/hora o lugar')),
            { written: written.length, toasts });
    }
    {
        const { w, written } = buildSandbox({
            inputs: { location: 'Campo A' }, trContacts: [{ uid: 'u1' }],
        });
        await w._sendTrainingNotification();
        ok('3b · con sólo el lugar ya envía', written.length === 1, written.length);
    }
    {
        const { w, ls } = buildSandbox({
            inputs: { datetime: '2026-03-04T18:30', location: 'Campo A', notes: 'Nota' },
            checked: [{ dataset: { id: 'c1' } }, { dataset: { id: 'c2' } }],
            trContacts: [{ uid: 'u1' }],
        });
        await w._sendTrainingNotification();
        const saved = JSON.parse(ls.cronos_last_training);
        ok('3c · guarda el último entrenamiento en localStorage',
            saved.datetime === '2026-03-04T18:30' && saved.location === 'Campo A'
            && saved.notes === 'Nota' && typeof saved.savedAt === 'string', saved);
        ok('3d · guarda la preselección de destinatarios',
            JSON.parse(ls.cronos_tr_preselection).join(',') === 'c1,c2',
            ls.cronos_tr_preselection);
    }
    {
        const { w, spinners } = buildSandbox({
            inputs: { location: 'Campo A' }, trContacts: [{ uid: 'u1' }],
        });
        await w._sendTrainingNotification();
        ok('3e · muestra y oculta el spinner',
            spinners.some(s => s.on) && spinners.some(s => !s.on), spinners);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · envío de notificaciones ──');
    {
        const { w, written, toasts, menuCalls } = buildSandbox({
            inputs: { datetime: '2026-03-04T18:30', location: 'Campo A', notes: 'Traer agua' },
            trContacts: [{ uid: 'u1' }, { uid: 'u2' }],
        });
        await w._sendTrainingNotification();
        ok('4a · un documento por contacto con la palomilla "tr"',
            written.length === 2 && written.every(x => x.col === 'cronos_notifications'),
            written.map(x => x.id));
        ok('4b · el id sigue el formato tr_<uid>_<base36>',
            written.every(x => /^tr_u[12]_[0-9a-z]+$/.test(x.id)), written.map(x => x.id));
        const d = written[0].data;
        ok('4c · el payload lleva type planificacion_semanal y los datos del aviso',
            d.type === 'planificacion_semanal' && d.datetime === '2026-03-04T18:30'
            && d.location === 'Campo A' && d.notes === 'Traer agua'
            && typeof d.createdAt === 'string', d);
        ok('4d · ⚠️ incluye userId (el campo que verifican las reglas, FIX C3) además de parentUid',
            d.userId === 'u1' && d.parentUid === 'u1', { userId: d.userId, parentUid: d.parentUid });
        ok('4e · y la autoría: coachUid, coachEmail y clubId',
            d.coachUid === 'coach1' && d.coachEmail === 'c@x.com' && d.clubId === 'club1', d);
        ok('4f · avisa del número de destinatarios', toasts.some(t => t.includes('2 persona(s)')), toasts);
        ok('4g · vuelve al menú unificado al terminar', menuCalls.length === 1);
    }
    {
        const { w, written } = buildSandbox({
            inputs: { location: 'Campo A' },
            trContacts: [{ uid: 'u1' }],
            manualSelected: [{ uid: 'u9' }, { id: 'u8' }],
        });
        await w._sendTrainingNotification();
        ok('4h · incluye los seleccionados manualmente, con id como alternativa a uid',
            written.map(x => x.id.split('_')[1]).sort().join(',') === 'u1,u8,u9',
            written.map(x => x.id));
    }
    {
        const { w, written } = buildSandbox({
            inputs: { location: 'Campo A' },
            trContacts: [{ uid: 'u1' }, { uid: 'u1' }],
            manualSelected: [{ uid: 'u1' }],
        });
        await w._sendTrainingNotification();
        ok('4i · deduplica por uid entre y dentro de las dos fuentes',
            written.length === 1, written.map(x => x.id));
    }
    {
        const { w, written } = buildSandbox({
            inputs: { location: 'Campo A' },
            trContacts: [{ uid: '' }, { name: 'sin uid' }, { uid: 'u1' }],
            manualSelected: [{}],
        });
        await w._sendTrainingNotification();
        ok('4j · omite los contactos sin uid utilizable', written.length === 1, written.map(x => x.id));
    }
    {
        const { w, written, toasts } = buildSandbox({
            inputs: { location: 'Campo A' }, trContacts: [], manualSelected: [],
        });
        await w._sendTrainingNotification();
        ok('4k · cero destinatarios: no es error, avisa de activar las palomillas',
            written.length === 0 && toasts.some(t => t.includes('0 destinatarios') && t.includes('ENTR.')),
            toasts);
    }
    {
        const { w, toasts, spinners } = buildSandbox({
            inputs: { location: 'Campo A' }, trContacts: [{ uid: 'u1' }], setDocThrows: 'sin red',
        });
        await w._sendTrainingNotification();
        ok('4l · si falla el envío, oculta el spinner y avisa',
            spinners.some(s => !s.on) && toasts.some(t => t.includes('Error: sin red')),
            { spinners, toasts });
    }
    {
        const { w, flagCalls } = buildSandbox({
            inputs: { location: 'Campo A' }, trContacts: [{ uid: 'u1' }], hasCache: false,
        });
        await w._sendTrainingNotification();
        ok('4m · asegura la caché de contactos antes de enviar',
            flagCalls.filter(f => f === 'tr').length >= 1, flagCalls);
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
