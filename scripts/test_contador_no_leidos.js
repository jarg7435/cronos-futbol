// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v743 · EL CONTADOR DE MENSAJES SIN LEER
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo (implementar.txt 2026-09-19, capturas 10595-10598): la tarjeta de
//  Mensajes de los cuatro paneles enseña cuántos mensajes recibidos quedan sin
//  leer, contando los chats particulares Y el Canal Club.
//
//  🔑 LA PARTE 2 **EJECUTA LA CUENTA** contra un Firestore de mentira, en vez
//  de mirar cómo está escrita. El defecto que este contador viene a evitar no
//  se ve en la forma del código: los contadores viejos (`unreadByStaff`) son
//  por CLASE de rol, así que en un hilo director ↔ coordinador el que escribe
//  pone a cero el número que el otro tendría que leer. Eso sólo se demuestra
//  haciendo correr el cálculo con dos personas de la misma clase. Es la misma
//  técnica que cazó la firma del rol en v740 y el nombre del remitente en
//  v741: medir lo que SALE, no lo que pone.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
//  ⚠️ FINALES DE LÍNEA NORMALIZADOS: en CRLF, `//.*$` deja de quitar
//  comentarios y varias aserciones de texto medirían lo que se escribe SOBRE
//  el código (lección del red-check de v740).
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const UB    = leer('js/coach/comms/unread-badge.js');
const PANEL = leer('js/coach/comms/panel.js');
const CHAT  = leer('js/coach/comms/club-chat.js');
const SD    = leer('js/coach/reports/club-reports.js');
const CA    = leer('js/admin/club/panel.js');
const SETUP = leer('js/core/setup-modal.js');
const UTILS = leer('js/core/utils.js');
const INDEX = leer('index.html');
const RULES = leer('firestore.rules');

//  ⚠️ LAS PARTES SE ENCADENAN. Dos de ellas EJECUTAN el módulo, que es async
//  (lee de un Firestore de juguete con `await`). Lanzadas a pelo desde el
//  nivel superior, sus aserciones correrían DESPUÉS del recuento final y el
//  guard daría verde sin haber medido nada — un fallo mudo, que es justo lo
//  que un guard no puede permitirse. Encadenándolas, el recuento es el último
//  eslabón y el título de cada parte se imprime cuando le toca.
let _cadena = Promise.resolve();
const parte = (titulo, fn) => {
    _cadena = _cadena.then(async () => {
        console.log(titulo);
        try { await fn(); }
        catch (e) {
            console.log('  ✗ esta parte se detuvo: ' + (e && e.message));
            fallos++; total++;
        }
    });
};

// ── El módulo, ejecutado sobre un Firestore de juguete ────────────────
//  `hilos` y `canal` son lo que devolvería cada consulta; `marcas` es el
//  documento users/{uid}/cronos_data/chat_reads. Se devuelve también lo
//  ESCRITO, para poder comprobar que la marca se guarda.
function cargar(opts) {
    const o = opts || {};
    const escrituras = [];
    const snap = (arr) => ({ forEach: (f) => arr.forEach(d => f(d)) });

    //  v745 · Los oyentes que registra el módulo (salida de la página) se
    //  APUNTAN en vez de ejecutarse: así el guard puede comprobar que hay UNO
    //  y dispararlo a mano.
    const oyentes = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        String, Object, Array, Number, Boolean, Date, JSON, Math, isFinite, isNaN,
        setTimeout: (fn) => { sb._pendiente = fn; return 1; },
        clearTimeout: () => { sb._cancelado = true; },
        document: {
            getElementById: (id) => (o.dom && o.dom[id]) || null,
            addEventListener: (ev, fn) => oyentes.push([ev, fn]),
            visibilityState: 'visible',
        },
        addEventListener: (ev, fn) => oyentes.push([ev, fn]),
    };
    sb._oyentes = oyentes;
    sb.window = sb;
    sb.globalThis = sb;
    sb._getEffectiveUser = () => o.yo || null;
    sb.ccPuedeVerCanal = (u) => !!(o.veCanal && u && u.clubId);
    // v745 · La plaza se le pregunta a `_ccRolFirma` (club-chat.js) cuando
    // está; sin ella, al `_activeRole`. Se ofrece sólo si la prueba lo pide,
    // para poder medir los dos caminos.
    if (o.rolFirma) sb._ccRolFirma = o.rolFirma;

    // El SDK de Firestore, en versión de juguete: cada función devuelve una
    // etiqueta y `getDocs` decide qué lote toca por la colección pedida.
    const fs_ = {
        db: {},
        collection: (_db, nombre) => ({ _col: nombre }),
        query: (c) => c,
        where: () => ({}), orderBy: () => ({}), limit: () => ({}),
        doc: (_db, ...p) => ({ _path: p.join('/') }),
        getDocs: async (c) => snap(c._col === 'cronos_messages'
            ? (o.hilos || []) : (o.canal || [])),
        getDoc: async () => ({
            exists: () => !!o.marcas,
            data: () => o.marcas || {},
        }),
        setDoc: async (ref, datos) => { escrituras.push({ ref: ref._path, datos }); },
    };
    // `await import(...)` dentro del módulo: se intercepta devolviendo el
    // SDK de juguete. Sin esto el guard necesitaría red.
    sb.import = async () => fs_;

    vm.createContext(sb);
    // El módulo usa `await import(...)`, que en un vm hay que sustituir: se
    // reescribe por la función `import` del sandbox. Es la ÚNICA modificación
    // del fuente, y no toca ninguna de las líneas que se miden.
    vm.runInContext(UB.replace(/await import\(/g, 'await window.import('), sb);
    sb._escrituras = escrituras;
    return sb;
}

const d = (id, datos) => ({ id, data: () => datos });

console.log('\n══ v743 · el contador de mensajes sin leer ══');

// ═════════════════════════════════════════════════════════════════════
parte('\n1) EL MÓDULO PUBLICA LO QUE LOS CUATRO PANELES LE PIDEN', () => {
    const w = cargar({ yo: null });
    ok('1a · publica la cuenta, el pintado y las dos marcas',
       typeof w.ubContarNoLeidos === 'function' && typeof w.ubPintarBadge === 'function' &&
       typeof w.ubMarcarHiloLeido === 'function' && typeof w.ubMarcarCanalLeido === 'function' &&
       typeof w.ubHuecoBadge === 'function');
    ok('1b · index.html lo carga', /js\/coach\/comms\/unread-badge\.js/.test(INDEX));
    ok('1c · y DESPUÉS de club-chat.js, a quien le pregunta por el canal',
       INDEX.indexOf('js/coach/comms/club-chat.js') < INDEX.indexOf('js/coach/comms/unread-badge.js'));
    ok('1d · 🔑 la marca vive en una subcolección que ya es SÓLO del dueño',
       /'users', yo\.uid, 'cronos_data', UB_DOC_MARCAS/.test(UB) &&
       /match \/users\/\{userId\}\/cronos_data\/\{docId\}\s*\{\s*allow read, write: if isAuth\(\) && request\.auth\.uid == userId;/.test(RULES),
       'así el contador no necesita tocar firestore.rules ni publicar cuándo lee cada uno');
});

// ═════════════════════════════════════════════════════════════════════
parte('\n2) 🔑🔑 LA CUENTA, EJECUTADA', async () => {
    const YO = { uid: 'yo', clubId: 'clubA', role: 'director' };

    // ── El caso que los contadores viejos NO pueden resolver ──────────
    //  Hilo director ↔ coordinador: los dos son «staff», así que
    //  `unreadByStaff` vale 0 aunque el coordinador haya escrito tres veces.
    const hiloStaff = d('t_dir_coord', {
        participants: ['yo', 'coord'],
        unreadByStaff: 0, unreadByCoach: 3, unreadByParent: 3,
        messages: [
            { senderUid: 'coord', text: 'una', timestamp: '2026-09-19T10:00:00.000Z' },
            { senderUid: 'coord', text: 'dos', timestamp: '2026-09-19T10:01:00.000Z' },
            { senderUid: 'yo',    text: 'mía', timestamp: '2026-09-19T10:02:00.000Z' },
            { senderUid: 'coord', text: 'tres', timestamp: '2026-09-19T10:03:00.000Z' },
        ],
    });

    let w = cargar({
        yo: YO, hilos: [hiloStaff],
        marcas: { threads: { t_dir_coord: '2026-09-19T09:00:00.000Z' }, staffChannel: 'x' },
    });
    let r = await w.ubContarNoLeidos(true);
    ok('2a · 🔑🔑 cuenta los 3 del compañero y NO los míos',
       r.privados === 3 && r.total === 3,
       JSON.stringify(r));

    w = cargar({
        yo: YO, hilos: [hiloStaff],
        marcas: { threads: { t_dir_coord: '2026-09-19T10:01:00.000Z' }, staffChannel: 'x' },
    });
    r = await w.ubContarNoLeidos(true);
    ok('2b · 🔑 la marca de lectura corta por la hora exacta',
       r.privados === 1, JSON.stringify(r));

    w = cargar({
        yo: YO, hilos: [hiloStaff],
        marcas: { threads: { t_dir_coord: '2026-09-19T23:59:00.000Z' }, staffChannel: 'x' },
    });
    r = await w.ubContarNoLeidos(true);
    ok('2c · leído todo = 0 (y la píldora se esconde)', r.total === 0, JSON.stringify(r));

    // ══════════════════════════════════════════════════════════════════
    //  🔴🔴 v744 · EL DEFECTO DE LAS CAPTURAS 10600-10603
    //
    //  El badge enseñaba 17 y 36 con la bandeja casi vacía. La v743 usaba los
    //  contadores viejos del hilo como respaldo mientras no hubiera marca
    //  propia, y esos contadores están CONTAMINADOS: al enviar se incrementan
    //  los tres salvo el del remitente, así que un mensaje del director al
    //  coordinador sube también `unreadByCoach` en un hilo donde no hay
    //  ningún entrenador. Este hilo lleva 36 y 17 a posta: son los números
    //  exactos que él vio.
    // ══════════════════════════════════════════════════════════════════
    const hiloContaminado = d('t_viejo', {
        participants: ['yo', 'otro'],
        lastMessageAt: '2026-09-18T20:00:00.000Z',
        unreadByCoach: 36, unreadByStaff: 17, unreadByParent: 12,
        messages: [{ senderUid: 'otro', text: 'de hace meses',
                     timestamp: '2026-09-18T20:00:00.000Z' }],
    });
    w = cargar({ yo: YO, hilos: [hiloContaminado], marcas: { threads: {}, staffChannel: 'x' } });
    r = await w.ubContarNoLeidos(true);
    ok('2d · 🔴🔴 un hilo SIN marca no cuenta NADA, ni aunque traiga un 36 dentro',
       r.privados === 0,
       '«no debe contar hilos antiguos» (encargo). Dio ' + r.privados);
    ok('2d2 · 🔑 y queda SEMBRADO con su último mensaje, para avisar del siguiente',
       w._ubState.marcas.threads.t_viejo === '2026-09-18T20:00:00.000Z',
       w._ubState.marcas.threads.t_viejo);
    //  ⚠️ SIN LOS COMENTARIOS. La cabecera del módulo NOMBRA los tres
    //  contadores para explicar por qué ya no se usan, y un censo de texto no
    //  distingue el código de lo que se escribe sobre él — la trampa que
    //  documenta la aserción 6d de test_chat_club_canal.js.
    const _ubCodigo = UB.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    ok('2d3 · 🚨 los contadores viejos ya no se leen en NINGÚN sitio del módulo',
       !/unreadByCoach|unreadByParent|unreadByStaff/.test(_ubCodigo),
       'son por CLASE de rol y se incrementan aunque en el hilo no haya nadie de esa clase');

    // Y el mensaje que llegue DESPUÉS de la siembra sí avisa.
    const hiloSembrado = d('t_viejo', {
        participants: ['yo', 'otro'],
        unreadByCoach: 36, unreadByStaff: 17,
        messages: [
            { senderUid: 'otro', text: 'de hace meses', timestamp: '2026-09-18T20:00:00.000Z' },
            { senderUid: 'otro', text: 'nuevo',         timestamp: '2026-09-19T09:00:00.000Z' },
        ],
    });
    w = cargar({ yo: YO, hilos: [hiloSembrado],
                 marcas: { threads: { t_viejo: '2026-09-18T20:00:00.000Z' }, staffChannel: 'x' } });
    r = await w.ubContarNoLeidos(true);
    ok('2d4 · 🔑🔑 y el siguiente mensaje SÍ cuenta: 1, no 36',
       r.privados === 1, JSON.stringify(r));

    // ── Los informes no firman con uid ────────────────────────────────
    //  Son `{ sender:'coach', ... }`. Para el director son recibidos; para el
    //  entrenador que los mandó, no.
    const hiloInforme = d('t_inf', {
        participants: ['yo', 'coach1'],
        messages: [{ sender: 'coach', text: '📊 informe', timestamp: '2026-09-19T11:00:00.000Z' }],
    });
    w = cargar({ yo: YO, hilos: [hiloInforme],
                 marcas: { threads: { t_inf: '2026-09-19T09:00:00.000Z' }, staffChannel: 'x' } });
    r = await w.ubContarNoLeidos(true);
    ok('2e · 🚨 un informe SIN senderUid cuenta para el DIRECTOR',
       r.privados === 1, JSON.stringify(r));

    w = cargar({ yo: { uid: 'coach1', clubId: 'clubA', role: 'coach' }, hilos: [hiloInforme],
                 marcas: { threads: { t_inf: '2026-09-19T09:00:00.000Z' }, staffChannel: 'x' } });
    r = await w.ubContarNoLeidos(true);
    ok('2f · 🚨 y NO cuenta para el entrenador que lo mandó',
       r.privados === 0,
       'los informes se inyectan como {sender:"coach"} sin uid: sin esto el entrenador se contaría los suyos');

    // ── La plaza ACTIVA manda sobre el rol raíz ───────────────────────
    //  Importa para los mensajes SIN uid (los informes): quien los firma es
    //  «coach», así que para la misma cuenta cuentan o no según desde qué
    //  plaza esté mirando.
    const hiloFirmaClase = d('t_c', {
        participants: ['yo', 'otro'],
        messages: [{ sender: 'coach', text: '📊 informe', timestamp: '2026-09-19T11:00:00.000Z' }],
    });
    const MARCA = { threads: { t_c: '2026-09-19T09:00:00.000Z' }, staffChannel: 'x' };
    w = cargar({ yo: { uid: 'yo', clubId: 'clubA', role: 'club_admin', _activeRole: 'coach' },
                 hilos: [hiloFirmaClase], marcas: JSON.parse(JSON.stringify(MARCA)) });
    r = await w.ubContarNoLeidos(true);
    ok('2g · 🔑 la clase de rol se toma de la PLAZA ACTIVA, no del rol raíz',
       r.privados === 0,
       'mirando como entrenador, un informe firmado «coach» es MÍO. Dio ' + r.privados);
    w = cargar({ yo: { uid: 'yo', clubId: 'clubA', role: 'coach', _activeRole: 'director' },
                 hilos: [hiloFirmaClase], marcas: JSON.parse(JSON.stringify(MARCA)) });
    r = await w.ubContarNoLeidos(true);
    ok('2g2 · y con la misma cuenta, desde la plaza de director, sí cuenta',
       r.privados === 1, JSON.stringify(r));
});

// ═════════════════════════════════════════════════════════════════════
parte('\n3) EL CANAL DEL CLUB TAMBIÉN CUENTA', async () => {
    const YO = { uid: 'yo', clubId: 'clubA', role: 'director' };
    const canal = [
        d('m1', { clubId: 'clubA', senderUid: 'otro', createdAt: '2026-09-19T10:00:00.000Z' }),
        d('m2', { clubId: 'clubA', senderUid: 'yo',   createdAt: '2026-09-19T10:05:00.000Z' }),
        d('m3', { clubId: 'clubA', senderUid: 'otro', createdAt: '2026-09-19T10:09:00.000Z' }),
    ];

    let w = cargar({ yo: YO, veCanal: true, hilos: [], canal,
                     marcas: { threads: {}, staffChannel: '2026-09-19T09:00:00.000Z' } });
    let r = await w.ubContarNoLeidos(true);
    ok('3a · 🔑 cuenta los del canal que no son míos', r.canal === 2, JSON.stringify(r));

    w = cargar({ yo: YO, veCanal: true, hilos: [], canal,
                 marcas: { threads: {}, staffChannel: '2026-09-19T10:06:00.000Z' } });
    r = await w.ubContarNoLeidos(true);
    ok('3b · y respeta la marca del canal', r.canal === 1, JSON.stringify(r));

    // 🚨 El familiar y el ente NO tienen canal: se le pregunta al MISMO
    //    criterio que pinta la pestaña, no a una lista propia.
    w = cargar({ yo: YO, veCanal: false, hilos: [], canal,
                 marcas: { threads: {}, staffChannel: '2026-09-19T09:00:00.000Z' } });
    r = await w.ubContarNoLeidos(true);
    ok('3c · 🔑 quien no ve el canal no lo cuenta (criterio único: ccPuedeVerCanal)',
       r.canal === 0 && /ccPuedeVerCanal/.test(UB),
       'contar un canal que su dueño no puede abrir sería un aviso al que no se puede ir');

    // ── El primer día del canal: se siembra la marca y se informa de 0 ──
    w = cargar({ yo: YO, veCanal: true, hilos: [], canal,
                 marcas: { threads: {}, staffChannel: '' } });
    r = await w.ubContarNoLeidos(true);
    ok('3d · ⚠️⚠️ sin marca previa NO anuncia el histórico entero: siembra y da 0',
       r.canal === 0,
       'la primera falsa alarma es la que hace que un aviso deje de mirarse. Dio ' + r.canal);
    ok('3e · y la marca sembrada es la del mensaje MÁS NUEVO',
       w._ubState.marcas.staffChannel === '2026-09-19T10:09:00.000Z',
       w._ubState.marcas.staffChannel);

    ok('3f · 🚨 la consulta del canal lleva orderBy con el limit (lección de v508)',
       /orderBy\('createdAt', 'desc'\),\s*\n?\s*limit\(UB_TOPE_CANAL\)/.test(UB),
       'limit sin orderBy es una ventana en lo MÁS VIEJO');
    ok('3g · y va acotada por clubId, como el índice que ya existe',
       /where\('clubId', '==', yo\.clubId\)/.test(UB));
});

// ═════════════════════════════════════════════════════════════════════
parte('\n4) LAS MARCAS SE ESCRIBEN Y AGRUPAN', async () => {
    const YO = { uid: 'yo', clubId: 'clubA', role: 'director' };
    const w = cargar({ yo: YO, marcas: { threads: {}, staffChannel: '' } });

    await w.ubMarcarHiloLeido('t1', '2026-09-19T12:00:00.000Z');
    ok('4a · marcar un hilo guarda su hora',
       w._ubState.marcas.threads.t1 === '2026-09-19T12:00:00.000Z');

    await w.ubMarcarHiloLeido('t1', '2026-09-19T11:00:00.000Z');
    ok('4b · ⚠️ y NUNCA retrocede (una marca vieja reviviría avisos ya leídos)',
       w._ubState.marcas.threads.t1 === '2026-09-19T12:00:00.000Z');

    ok('4c · 🔑 el guardado es DIFERIDO, no una escritura por mensaje',
       typeof w._pendiente === 'function' && w._escrituras.length === 0,
       'el canal escucha en vivo: sin agrupar, cada mensaje que llega costaría una escritura');
    w._pendiente();                                   // se dispara el temporizador
    await new Promise(r => setTimeout(r, 0));
    ok('4d · y al vencer escribe UNA vez en la subcolección del dueño',
       w._escrituras.length === 1 &&
       /^users\/yo\/cronos_data\/chat_reads$/.test(w._escrituras[0].ref),
       JSON.stringify(w._escrituras.map(e => e.ref)));

    // ══════════════════════════════════════════════════════════════════
    //  🔴 v744 · «Entrar en la sección de mensajería pone el contador a cero»
    // ══════════════════════════════════════════════════════════════════
    const YO2 = { uid: 'yo', clubId: 'clubA', role: 'director' };
    const dosHilos = [
        d('h1', { participants: ['yo', 'a'], lastMessageAt: '2026-09-19T10:00:00.000Z',
                  messages: [{ senderUid: 'a', text: 'hola', timestamp: '2026-09-19T10:00:00.000Z' }] }),
        d('h2', { participants: ['yo', 'b'], lastMessageAt: '2026-09-19T10:30:00.000Z',
                  messages: [{ senderUid: 'b', text: 'eh',   timestamp: '2026-09-19T10:30:00.000Z' }] }),
    ];
    const canalPend = [d('c1', { clubId: 'clubA', senderUid: 'otro',
                                 createdAt: '2026-09-19T11:00:00.000Z' })];
    const marcasViejas = {
        threads: { h1: '2026-09-19T08:00:00.000Z', h2: '2026-09-19T08:00:00.000Z' },
        staffChannel: '2026-09-19T08:00:00.000Z',
    };

    let v = cargar({ yo: YO2, veCanal: true, hilos: dosHilos, canal: canalPend,
                     marcas: JSON.parse(JSON.stringify(marcasViejas)) });
    let antes = await v.ubContarNoLeidos(true);
    ok('4g · control · antes de entrar hay 2 privados y 1 del canal',
       antes.privados === 2 && antes.canal === 1 && antes.total === 3, JSON.stringify(antes));

    await v.ubMarcarTodoLeido();
    const despues = await v.ubContarNoLeidos(true);
    ok('4h · 🔴🔴 entrar en la bandeja deja el contador en CERO',
       despues.total === 0,
       'regla exacta del encargo. Dio ' + JSON.stringify(despues));
    ok('4i · 🔑 y cada hilo queda marcado hasta su ÚLTIMO mensaje, no una hora fija',
       v._ubState.marcas.threads.h1 === '2026-09-19T10:00:00.000Z' &&
       v._ubState.marcas.threads.h2 === '2026-09-19T10:30:00.000Z',
       JSON.stringify(v._ubState.marcas.threads));
    ok('4j · 🚨 el panel lo llama DESPUÉS de pintar la lista, no antes',
       /await _loadUnifiedContactList\(tab\);[\s\S]{0,1400}ubMarcarTodoLeido\(\)/.test(PANEL) &&
       !/ubMarcarTodoLeido\(\)[\s\S]{0,200}await _loadUnifiedContactList\(tab\)/.test(PANEL),
       'marcarlo todo primero dejaría la bandeja sin señalar qué chat traía novedades');
    //  ⚠️ SE MIDE POR POSICIÓN, NO CON UNA VENTANA DE N CARACTERES. El cuerpo
    //  de `_renderUnifiedMessagingView` son miles de caracteres de plantilla,
    //  y una ventana a ojo se queda corta en cuanto la función crece: el guard
    //  se pondría rojo con el código intacto, que es lo que le pasó al 4f de
    //  test_chat_club_canal.js en v743.
    const _cuerpoRender = (() => {
        const i = PANEL.indexOf('async function _renderUnifiedMessagingView');
        if (i < 0) return '';
        const j = PANEL.indexOf('\nasync function ', i + 10);
        return PANEL.slice(i, j > 0 ? j : PANEL.length);
    })();
    ok('4k · 🔑 y está en el ÚNICO punto por el que pasan los seis roles',
       _cuerpoRender.length > 1000 && /ubMarcarTodoLeido\(\)/.test(_cuerpoRender),
       'las seis funciones open*Messaging no hacen otra cosa que llamar ahí');

    ok('4e · 🔑 leer un hilo marca ADEMÁS la marca propia (no sustituye a la vieja)',
       /updData\.unreadByStaff = 0/.test(PANEL) &&
       /ubMarcarHiloLeido\(snap\.id,/.test(PANEL),
       'los contadores viejos siguen alimentando el badge por hilo de la lista de contactos');
    ok('4f · 🔑🔑 y el canal se marca DENTRO del oyente, no sólo al abrirlo',
       /onSnapshot\(q, \(snap\) => \{[\s\S]{0,900}ubMarcarCanalLeido/.test(CHAT),
       'lo que llega mientras lo estás mirando también está leído');
});

// ═════════════════════════════════════════════════════════════════════
parte('\n5) LAS CUATRO TARJETAS DEL ENCARGO', () => {
    ok('5a · el tablero compartido acepta un hueco con id (`badgeId`)',
       /const badgeId = bloqueado \? '' : String\(o\.badgeId \|\| ''\)/.test(UTILS) &&
       /\(\(badge \|\| badgeId\) \?/.test(UTILS));
    ok('5b · ⚠️ y NO lo pinta sobre una opción bloqueada',
       /const badgeId = bloqueado \? ''/.test(UTILS),
       'anunciar avisos de una puerta cerrada con llave es prometer algo que no se puede ir a ver');
    ok('5c · 🔑 el hueco nace OCULTO cuando todavía no hay número',
       /\(badge \? '' : 'display:none;'\)/.test(UTILS),
       'si naciera visible, el tablero enseñaría una píldora vacía hasta que llegase la cuenta');

    ok('5d · ADMINISTRADOR DEL CLUB: tarjeta con hueco y relleno al pintar el menú',
       /titulo: 'Mensajes'[\s\S]{0,260}badgeId: 'ca-badge-mensajes'/.test(CA) &&
       /ubPintarBadge\('ca-badge-mensajes'\)/.test(CA));
    ok('5e · DIRECTOR y COORDINADOR: misma tarjeta, mismo tablero',
       /titulo: 'Mensajes'[\s\S]{0,260}badgeId: 'sd-badge-mensajes'/.test(SD) &&
       /ubPintarBadge\('sd-badge-mensajes'\)/.test(SD));
    ok('5f · ENTRENADOR: su menú de Comunicaciones',
       /ubHuecoBadge\('um-badge-mensajes'\)/.test(PANEL) &&
       /ubPintarBadge\('um-badge-mensajes'\)/.test(PANEL));
    ok('5g · 🚨 y el SEGUNDO menú del entrenador, que es otro fichero',
       /ubHuecoBadge\('cm-badge-mensajes'\)/.test(SETUP) &&
       /ubPintarBadge\('cm-badge-mensajes'\)/.test(SETUP),
       'hay DOS puertas al área: con el aviso en una sola, se ve o no según por dónde entre');

    ok('5h · ⚠️ los cuatro puntos llaman con `typeof` por delante',
       (CA + SD + PANEL + SETUP).split('ubPintarBadge(').length - 1 === 4 &&
       !/[^.]\bubPintarBadge\(/.test((CA + SD + PANEL + SETUP)
           .replace(/typeof window\.ubPintarBadge === 'function'\) window\.ubPintarBadge\(/g, '')),
       'si el módulo no cargara, ningún panel puede romperse por un adorno');

    ok('5i · 🔑 el pintado no bloquea al panel que lo aloja',
       !/await window\.ubPintarBadge/.test(CA + SD + PANEL + SETUP),
       'el tablero no puede esperar a Firestore para aparecer');
    ok('5j · ⚠️ y si el hueco ya no está en pantalla, no se pinta nada',
       /const vivo = document\.getElementById\(elId\);\s*\n\s*if \(!vivo\) return;/.test(UB),
       'pintar en un contenedor que ya no existe es el fallo de v439');
});

// ═════════════════════════════════════════════════════════════════════
parte('\n6) LA CONSULTA DE HILOS ES LEGAL Y ACOTADA', () => {
    ok('6a · 🔑 los hilos se piden con `array-contains` sobre participants',
       /where\('participants', 'array-contains', yo\.uid\)/.test(UB),
       'una consulta sin ese where cae en la regla POR DOCUMENTO y se deniega ENTERA (v674)');
    ok('6b · y la regla de cronos_messages autoriza justo por ahí',
       /request\.auth\.uid in resource\.data\.get\('participants', \[\]\)/.test(RULES));
    ok('6c · ⚠️ la cuenta NUNCA lanza: devuelve ceros si algo falla',
       /catch \(_\) \{ return vacio; \}/.test(UB),
       'un badge que rompe la pantalla que lo aloja es mucho peor que un badge que no aparece');
    //  ⚠️ v746 · LA CLAVE YA NO ES EL `uid` A SECAS. Se medía
    //  `st.cache.uid === yo.uid`, y esa forma era justamente el defecto: quien
    //  cambia de sombrero sin recargar recibía la cuenta de la plaza anterior.
    //  El guard pasa a exigir la clave COMPUESTA (ver la aserción 9f, que lo
    //  demuestra ejecutando).
    ok('6d · 🔑 y se cachea unos segundos (el tablero se repinta varias veces seguidas)',
       /UB_CACHE_MS/.test(UB) && /st\.cache\.clave === clave/.test(UB) &&
       /const clave = yo\.uid \+ '\|' \+ _ubPlazaHilo\(yo\) \+ '\|' \+ _ubPlazaDe\(yo\)/.test(UB));
    ok('6e · ⚠️ pero marcar algo como leído INVALIDA la caché',
       (UB.match(/window\._ubState\.cache = null;/g) || []).length >= 2,
       'si no, volver de un chat seguiría enseñando el número de antes');
});

// ═════════════════════════════════════════════════════════════════════
parte('\n7) 🔴 v744 · LA BANDEJA Y LA TARJETA CUENTAN LO MISMO', () => {
    //  El reporte del autor es, literalmente, que los dos números no casaban:
    //  «el distintivo muestra 17 y 36 pero al entrar en la bandeja no hay
    //  tantos mensajes». Mientras la lista de contactos lea unos contadores y
    //  la tarjeta otra cosa, ese desacuerdo puede volver.
    ok('7a · 🔑🔑 la lista de contactos usa la MISMA cuenta que la tarjeta',
       /const unread = \(typeof window\.ubNoLeidosDeHilo === 'function'\)/.test(PANEL),
       'un solo criterio, o los dos sitios vuelven a decir cosas distintas');
    ok('7b · 🚨 y ya NO lee los contadores contaminados',
       !/thread\.unreadByCoach \|\| thread\.unreadByParent \|\| thread\.unreadByStaff/.test(PANEL),
       'cogía «el primero de los tres que no fuese cero», sin mirar cuál me tocaba a mí');
    //  ⚠️ POR POSICIÓN, no con una ventana de caracteres: entre las dos líneas
    //  hay toda la construcción de la lista de contactos y cualquier número
    //  que se eligiera a ojo se quedaría corto en la próxima ampliación.
    const _iMarcas = PANEL.indexOf('await window.ubMarcas()');
    const _iUnread = PANEL.indexOf("const unread = (typeof window.ubNoLeidosDeHilo");
    ok('7c · ⚠️ las marcas se cargan ANTES de pintar la lista',
       _iMarcas > 0 && _iUnread > _iMarcas,
       '`ubNoLeidosDeHilo` es síncrona: sin marcas en memoria devolvería 0 para todos');
    ok('7d · 🔑 el envío SIGUE escribiendo los contadores viejos (no se tocan)',
       /unreadByCoach: window\._umState\.role !== 'coach'/.test(PANEL),
       'son de otras pantallas y de otros roles: retirarlos era un cambio que nadie pidió');
});

// ═════════════════════════════════════════════════════════════════════
//  🔴 v745 · LA UNIDAD ES LA PLAZA, Y EL CERO TIENE QUE LLEGAR A LA TARJETA
// ═════════════════════════════════════════════════════════════════════
//  Reporte del autor (2026-09-19): «he enviado un mensaje desde el
//  administrador del club y al entrar con el director deportivo o el
//  coordinador no aparece el 1 rojo». Medido: en su club esas plazas son de la
//  MISMA cuenta, así que v744 las descartaba con razón —lo mío no cuenta— y la
//  marca de lectura era por PERSONA. La unidad pasa a ser la PLAZA, que es la
//  doctrina del proyecto desde v540 y la que ya usa la FIRMA de los mensajes
//  (v740): si el canal reconoce dos voces, tiene que reconocer dos bandejas.
// ═════════════════════════════════════════════════════════════════════
parte('\n8) 🔴 v745 · CADA PLAZA, SU BANDEJA', async () => {
    //  `_ccRolFirma` de verdad (club-chat.js): la plaza activa si es del canal
    //  y, si no lo es, el rol RAÍZ. Se reproduce aquí para que el guard mida
    //  el mismo camino que corre en la app, no uno de juguete.
    const CC_ROLES = ['director', 'coordinator', 'coach', 'user', 'club_admin', 'admin'];
    const rolFirma = (u) => {
        const a = String((u && u._activeRole) || '').trim().toLowerCase();
        if (a && CC_ROLES.indexOf(a) !== -1) return a;
        return String((u && u.role) || '').trim().toLowerCase();
    };
    //  Una sola cuenta con cuatro sombreros: es el club del autor.
    const COMO = (plaza) => ({ uid: 'yo', clubId: 'clubA', role: 'club_admin', _activeRole: plaza });
    const canalPropio = [d('c1', { clubId: 'clubA', senderUid: 'yo', senderRole: 'club_admin',
                                   createdAt: '2026-09-19T10:00:00.000Z' })];
    const MARCAS = () => ({ threads: {}, staffChannel: '2026-09-19T09:00:00.000Z',
                            staffChannelByPlaza: { club_admin: '2026-09-19T09:00:00.000Z' } });

    let w = cargar({ yo: COMO('director'), rolFirma, veCanal: true, hilos: [],
                     canal: canalPropio, marcas: MARCAS() });
    let r = await w.ubContarNoLeidos(true);
    ok('8a · 🔴🔴 lo que mandé DE ADMINISTRADOR está sin leer para mi DIRECTOR',
       r.canal === 1,
       'la misma cuenta, dos plazas: si el canal las pinta como dos voces (v740), el contador las cuenta como dos bandejas. Dio ' + r.canal);

    w = cargar({ yo: COMO('club_admin'), rolFirma, veCanal: true, hilos: [],
                 canal: canalPropio, marcas: MARCAS() });
    r = await w.ubContarNoLeidos(true);
    ok('8b · ⚠️ y para MI PROPIA plaza de administrador sigue siendo mío: 0',
       r.canal === 0, JSON.stringify(r));

    // ── Una plaza estrenada hereda lo que ya había leído la persona ───
    const canalViejo = [
        d('v1', { clubId: 'clubA', senderUid: 'otro', createdAt: '2026-09-01T10:00:00.000Z' }),
        d('v2', { clubId: 'clubA', senderUid: 'otro', createdAt: '2026-09-19T11:00:00.000Z' }),
    ];
    w = cargar({ yo: COMO('coordinator'), rolFirma, veCanal: true, hilos: [], canal: canalViejo,
                 marcas: { threads: {}, staffChannel: '2026-09-19T09:00:00.000Z',
                           staffChannelByPlaza: {} } });
    r = await w.ubContarNoLeidos(true);
    ok('8c · ⚠️⚠️ una plaza SIN marca propia no estrena el histórico entero',
       r.canal === 1,
       'hereda la marca de la persona: avisa del mensaje nuevo, no de los dos. Dio ' + r.canal);

    // ── Marcar desde una plaza no puede retroceder la de otra ─────────
    w = cargar({ yo: COMO('director'), rolFirma, veCanal: true, hilos: [], canal: canalPropio,
                 marcas: { threads: {}, staffChannel: '2026-09-19T09:00:00.000Z',
                           staffChannelByPlaza: { club_admin: '2026-09-19T23:00:00.000Z' } } });
    await w.ubMarcarCanalLeido('2026-09-19T10:00:00.000Z');
    ok('8d · 🔑 cada plaza avanza por su cuenta (la del administrador no retrocede)',
       w._ubState.marcas.staffChannelByPlaza.club_admin === '2026-09-19T23:00:00.000Z' &&
       w._ubState.marcas.staffChannelByPlaza.director === '2026-09-19T10:00:00.000Z',
       JSON.stringify(w._ubState.marcas.staffChannelByPlaza));

    // ══════════════════════════════════════════════════════════════════
    //  🔴 LOS DOS SITIOS NO FIRMAN IGUAL, Y POR ESO NO SE LEEN IGUAL
    //  El canal firma con `_ccRolFirma`, que sólo conoce los seis puestos del
    //  canal y ante cualquier otro cae al rol RAÍZ. Un chat particular firma
    //  con `_umState.role`, donde sí existen el familiar y el administrador
    //  del ente. Preguntando al criterio del canal para los dos, una cuenta de
    //  entrenador mirando desde su plaza de FAMILIAR se contaba como «sin
    //  leer» los mensajes que ella misma acababa de enviar.
    // ══════════════════════════════════════════════════════════════════
    const hiloPropio = d('t_p', { participants: ['yo', 'coach2'],
        messages: [{ senderUid: 'yo', senderRole: 'parent', text: 'mío',
                     timestamp: '2026-09-19T11:00:00.000Z' }] });
    w = cargar({ yo: { uid: 'yo', clubId: 'clubA', role: 'coach', _activeRole: 'parent' },
                 rolFirma, hilos: [hiloPropio],
                 marcas: { threads: { t_p: '2026-09-19T09:00:00.000Z' }, staffChannel: 'x' } });
    r = await w.ubContarNoLeidos(true);
    ok('8e · 🔴🔴 lo que yo mismo escribí DESDE MI PLAZA DE FAMILIAR no me avisa',
       r.privados === 0,
       '`_ccRolFirma` no sabe decir «parent» y devolvía el rol raíz. Dio ' + r.privados);

    //  El administrador del ente se llama de dos maneras: arranca como
    //  'individual' (role-launch.js) y firma como 'admin_individual'
    //  (openIndividualAdminMessaging). Sin los alias, un puesto son dos.
    const hiloEnte = d('t_e', { participants: ['yo', 'coachX'],
        messages: [{ senderUid: 'yo', senderRole: 'admin_individual', text: 'mío',
                     timestamp: '2026-09-19T11:00:00.000Z' }] });
    w = cargar({ yo: { uid: 'yo', clubId: 'clubA', role: 'admin_individual', _activeRole: 'individual' },
                 rolFirma, hilos: [hiloEnte],
                 marcas: { threads: { t_e: '2026-09-19T09:00:00.000Z' }, staffChannel: 'x' } });
    r = await w.ubContarNoLeidos(true);
    ok('8f · 🚨 «individual» y «admin_individual» son EL MISMO puesto',
       r.privados === 0,
       'sin el censo de alias, el administrador del ente se contaba todos sus propios mensajes. Dio ' + r.privados);

    // ── El cero tiene que LLEGAR a la tarjeta ─────────────────────────
    //  `ubMarcarTodoLeido` se llama sin `await` desde el render de la bandeja:
    //  quien entra y sale enseguida repintaba su tarjeta ANTES de que las
    //  marcas estuvieran puestas, y el tablero no vuelve a pintarse solo.
    const hueco = { style: { display: '' }, textContent: '7' };
    const pendientes = [d('h1', { participants: ['yo', 'a'],
        lastMessageAt: '2026-09-19T10:00:00.000Z',
        messages: [{ senderUid: 'a', text: 'hola', timestamp: '2026-09-19T10:00:00.000Z' }] })];
    w = cargar({ yo: COMO('director'), rolFirma, hilos: pendientes,
                 marcas: { threads: { h1: '2026-09-19T08:00:00.000Z' }, staffChannel: 'x' },
                 dom: { 'sd-badge-mensajes': hueco } });
    await w.ubMarcarTodoLeido();
    await new Promise(res => setTimeout(res, 20));
    ok('8g · 🔴 al poner a cero se REPINTA el hueco que siga en pantalla',
       hueco.textContent === '' && hueco.style.display === 'none',
       'si no, se vuelve de la bandeja y la tarjeta enseña el número de antes. Quedó «' + hueco.textContent + '»');
    ok('8g2 · 🚨 y la lista de huecos es el censo de los CUATRO paneles',
       /'ca-badge-mensajes', 'sd-badge-mensajes'/.test(UB) &&
       /'um-badge-mensajes', 'cm-badge-mensajes'/.test(UB) &&
       /ubPintarBadge\('ca-badge-mensajes'\)/.test(CA) &&
       /ubPintarBadge\('sd-badge-mensajes'\)/.test(SD) &&
       /ubPintarBadge\('um-badge-mensajes'\)/.test(PANEL) &&
       /ubPintarBadge\('cm-badge-mensajes'\)/.test(SETUP),
       'un quinto panel que estrene hueco y no se apunte se quedaría con el número viejo');

    // ── Cerrar la app no puede tragarse las marcas ────────────────────
    w = cargar({ yo: COMO('director'), rolFirma, hilos: [],
                 marcas: { threads: {}, staffChannel: 'x' } });
    await w.ubMarcarHiloLeido('h9', '2026-09-19T12:00:00.000Z');
    ok('8h · control · el guardado sigue siendo DIFERIDO', w._escrituras.length === 0);
    const salidas = w._oyentes.filter(([ev]) => ev === 'visibilitychange' || ev === 'pagehide');
    ok('8h2 · 🚨 hay UN oyente de cada, no uno por pasada del módulo (v719)',
       salidas.length === 2 &&
       salidas.filter(([ev]) => ev === 'visibilitychange').length === 1,
       JSON.stringify(w._oyentes.map(o => o[0])));
    w.document.visibilityState = 'hidden';
    salidas.find(([ev]) => ev === 'visibilitychange')[1]();
    await new Promise(res => setTimeout(res, 10));
    ok('8h3 · 🔴 al esconderse la página la marca se guarda YA',
       w._escrituras.length === 1 &&
       /^users\/yo\/cronos_data\/chat_reads$/.test(w._escrituras[0].ref),
       'entrar, mirar y cerrar dejaba las marcas sólo en memoria: al volver, el mismo número');
    ok('8h4 · ⚠️ y no deja el temporizador suelto para escribir dos veces',
       w._cancelado === true && w._ubState.guardar === null);
});

// ═════════════════════════════════════════════════════════════════════
//  🔴🔴 v746 · EL AVISO TIENE QUE PODER ENCENDERSE
// ═════════════════════════════════════════════════════════════════════
//  Reporte del autor (2026-09-20): «al entrar a leer, el contador se pone a
//  cero correctamente. Pero si envío un mensaje desde Director, al entrar de
//  Coordinador o de Entrenador el contador sigue a cero en lugar de un 1».
//
//  🔑 REPRODUCIDO EJECUTANDO LA CUENTA, no leyendo el código: `staffChannel`
//  —la marca de PERSONA, que es el punto de partida que hereda una plaza sin
//  marca propia— subía cada vez que CUALQUIER plaza leía. Al leer y escribir
//  de Director quedaba en «hasta el último mensaje», y el Coordinador, que no
//  tenía marca suya, heredaba eso: nacía leído. El aviso no podía encenderse.
// ═════════════════════════════════════════════════════════════════════
parte('\n9) 🔴🔴 v746 · UN MENSAJE NUEVO ENCIENDE LAS DEMÁS PLAZAS', async () => {
    const CC_ROLES = ['director', 'coordinator', 'coach', 'user', 'club_admin', 'admin'];
    const rolFirma = (u) => {
        const a = String((u && u._activeRole) || '').trim().toLowerCase();
        if (a && CC_ROLES.indexOf(a) !== -1) return a;
        return String((u && u.role) || '').trim().toLowerCase();
    };
    const COMO = (plaza) => ({ uid: 'yo', clubId: 'clubA', role: 'club_admin', _activeRole: plaza });
    //  El mensaje que el autor manda «desde el Director».
    const canal = [d('m1', { clubId: 'clubA', senderUid: 'yo', senderRole: 'director',
                             createdAt: '2026-09-20T10:05:00.000Z' })];
    //  Estado normal: el suelo quieto y la plaza que leyó, al día.
    const MARCAS = () => ({ threads: {}, staffChannel: '2026-09-20T10:00:00.000Z',
                            staffChannelByPlaza: { director: '2026-09-20T10:05:00.000Z' } });

    let w = cargar({ yo: COMO('coordinator'), rolFirma, veCanal: true, hilos: [],
                     canal, marcas: MARCAS() });
    let r = await w.ubContarNoLeidos(true);
    ok('9a · 🔴🔴 la plaza SIN marca propia SÍ ve el mensaje nuevo',
       r.canal === 1,
       'es el encargo literal: «debe aparecer obligatoriamente el contador». Dio ' + r.canal);

    w = cargar({ yo: COMO('director'), rolFirma, veCanal: true, hilos: [],
                 canal, marcas: MARCAS() });
    r = await w.ubContarNoLeidos(true);
    ok('9b · ⚠️ y para la plaza que lo escribió sigue en 0', r.canal === 0, JSON.stringify(r));

    //  ── El suelo NO SE MUEVE al leer desde una plaza ──────────────────
    w = cargar({ yo: COMO('director'), rolFirma, veCanal: true, hilos: [],
                 canal, marcas: MARCAS() });
    await w.ubMarcarCanalLeido('2026-09-20T23:00:00.000Z');
    ok('9c · 🔑🔑 leer desde UNA plaza no adelanta el suelo de las demás',
       w._ubState.marcas.staffChannel === '2026-09-20T10:00:00.000Z' &&
       w._ubState.marcas.staffChannelByPlaza.director === '2026-09-20T23:00:00.000Z',
       'mientras subía, cada lectura de otra plaza dejaba a ésta «ya leído». Quedó ' +
       w._ubState.marcas.staffChannel);

    //  ── Pero sin suelo ninguno sí se siembra: el día uno no avisa del histórico ──
    w = cargar({ yo: { uid: 'nuevo', clubId: 'clubA', role: 'coach', _activeRole: 'user' },
                 rolFirma, veCanal: true, hilos: [], canal,
                 marcas: { threads: {}, staffChannel: '', staffChannelByPlaza: {} } });
    r = await w.ubContarNoLeidos(true);
    ok('9d · ⚠️ un usuario nuevo sigue naciendo al día (siembra, y 0)',
       r.canal === 0 && w._ubState.marcas.staffChannel === '2026-09-20T10:05:00.000Z',
       JSON.stringify(r) + ' suelo=' + w._ubState.marcas.staffChannel);

    //  ── Y el ENTRENADOR, que es otra cuenta ───────────────────────────
    w = cargar({ yo: { uid: 'coach1', clubId: 'clubA', role: 'user', _activeRole: 'user' },
                 rolFirma, veCanal: true, hilos: [], canal,
                 marcas: { threads: {}, staffChannel: '2026-09-20T10:00:00.000Z',
                           staffChannelByPlaza: {} } });
    r = await w.ubContarNoLeidos(true);
    ok('9e · 🔑 el entrenador de OTRA cuenta también lo ve', r.canal === 1, JSON.stringify(r));

    //  ── La caché de 15 s no puede cruzar dos bandejas ─────────────────
    //  Cambiar de sombrero no recarga la página: el estado del módulo sigue
    //  vivo, y con la clave puesta sólo en el `uid` el Coordinador recibía el
    //  número que se acababa de calcular para el Director.
    w = cargar({ yo: COMO('director'), rolFirma, veCanal: true, hilos: [],
                 canal, marcas: MARCAS() });
    const dir = await w.ubContarNoLeidos(true);
    w._getEffectiveUser = () => COMO('coordinator');
    const coord = await w.ubContarNoLeidos();          // SIN forzar, como el tablero
    ok('9f · 🔴 al cambiar de plaza la caché no devuelve la cuenta de la otra',
       dir.canal === 0 && coord.canal === 1,
       'director=' + JSON.stringify(dir) + ' coordinador=' + JSON.stringify(coord));
});

// El recuento es el ÚLTIMO eslabón de la cadena, no una línea suelta al final
// del fichero: si se imprimiera desde el nivel superior, saldría antes de que
// las partes que ejecutan el módulo hubieran medido nada.
_cadena.then(() => {
    console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
    process.exit(fallos ? 1 : 0);
});
