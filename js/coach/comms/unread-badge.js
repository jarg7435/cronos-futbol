// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — unread-badge.js
//  🔴 v743 · EL CONTADOR DE MENSAJES SIN LEER
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-19, capturas 10595-10598): «en
//  los paneles principales de Administrador del Club, Director Deportivo,
//  Coordinador y Entrenador, la tarjeta de Mensajes debe mostrar un indicador
//  numérico con la cantidad de mensajes recibidos que aún no han sido leídos.
//  Tanto para los chats particulares como para el nuevo Canal Club».
//
//  ⚠️⚠️ LO PRIMERO QUE SE MIDIÓ: YA HABÍA CONTADORES, Y NO SIRVEN SOLOS.
//  Cada hilo de `cronos_messages` lleva `unreadByCoach`, `unreadByParent` y
//  `unreadByStaff`, que se incrementan al enviar y se ponen a 0 al abrir el
//  hilo. Son TRES contadores POR CLASE DE ROL, no por persona, y ahí está su
//  límite: en un hilo **director ↔ coordinador** los dos son «staff», así que
//  el que escribe pone a 0 el mismo contador que el otro tendría que leer —
//  ese hilo no puede avisar a nadie. Lo mismo entre administrador y director.
//  Colgar el badge del panel de esos contadores habría dado un número que en
//  media de los hilos del cuerpo técnico vale siempre 0.
//
//  🔑 POR ESO LA MARCA DE LECTURA ES **POR PERSONA**, y vive en
//  `users/{uid}/cronos_data/chat_reads` — una subcolección que las reglas ya
//  reservan a su dueño (`allow read, write: if request.auth.uid == userId`),
//  así que no hace falta tocar firestore.rules ni exponer a nadie cuándo lee.
//
//      { threads: { <threadId>: <ISO de la última lectura> },
//        staffChannel: <ISO de la última lectura del Canal Club>,
//        staffChannelByPlaza: { <plaza>: <ISO> } }     ← v745
//
//  (los hilos particulares no necesitan la plaza: su `threadId` ya la lleva
//   dentro, porque se compone con el contexto de la relación.)
//
//  Con esa marca, «sin leer» se calcula EXACTO: los mensajes del hilo cuya
//  firma no es la mía y cuya hora es posterior a mi marca. Y como el documento
//  del hilo YA trae su array `messages`, contarlos no cuesta ni una lectura
//  más que saber que el hilo existe.
//
//  ⚠️ EL PRIMER DÍA NO PUEDE INVENTARSE AVISOS. Un hilo sin marca no es «todo
//  sin leer»: es «nunca leído CON ESTE SISTEMA», y el sistema nace hoy. Así
//  que un hilo sin marca **no cuenta**: se SIEMBRA con su último mensaje y
//  empieza a avisar desde el siguiente. Igual el Canal Club.
//
// ════════════════════════════════════════════════════════════════════
//  🔴🔴 v744 · POR QUÉ SE RETIRÓ EL RESPALDO EN LOS CONTADORES VIEJOS
// ════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-19, capturas 10600-10603): «el
//  distintivo muestra números desproporcionados (17, 36…) pero al entrar en la
//  bandeja no hay tantos mensajes».
//
//  🔑 LA PRUEBA ESTÁ EN SUS PROPIAS CAPTURAS: Director, Coordinador y
//  Administrador enseñaban **los tres el mismo 17**, y el Entrenador 36. Son
//  la misma cuenta, o sea los mismos hilos; lo único que cambiaba entre esos
//  paneles era CUÁL de los tres contadores viejos se leía. El número no venía
//  de los mensajes: venía de los contadores.
//
//  🚨 Y ESOS CONTADORES NO SON CONTADORES DE NADIE. Al enviar, el motor hace
//  (comms/panel.js, `_sendUnifiedMessage`):
//      unreadByCoach:  rol !== 'coach'  ? +1 : 0
//      unreadByParent: rol !== 'parent' ? +1 : 0
//      unreadByStaff:  (rol !== 'director' && rol !== 'coordinator') ? +1 : 0
//  o sea que un mensaje del director a un coordinador incrementa TAMBIÉN
//  `unreadByCoach` y `unreadByParent` — en un hilo donde no hay ni entrenador
//  ni familiar. Sumados sobre meses de hilos, dan 36. Y sólo bajan si se abre
//  ese hilo concreto, así que nunca vuelven a cero.
//
//  La v743 los usaba como respaldo «para no inventar avisos el primer día», y
//  el remedio resultó ser la enfermedad: eran ellos los que inventaban. Aquí
//  ya no se leen. La cuenta sale SIEMPRE de los mensajes y de mi marca, que es
//  lo que el autor pide: «sólo los mensajes reales que están sin leer por el
//  usuario actual».
// ════════════════════════════════════════════════════════════════════

const UB_COL_HILOS  = 'cronos_messages';
const UB_COL_CANAL  = 'cronos_staff_messages';
const UB_DOC_MARCAS = 'chat_reads';

// Tope del canal: el mismo que pinta club-chat.js. Un badge no necesita más
// precisión que la pantalla que lo respalda.
const UB_TOPE_CANAL = 100;

window._ubState = window._ubState || {
    marcas: null,       // { uid, threads:{}, staffChannel:'' }
    cache:  null,       // { uid, total, privados, canal, at }
    guardar: null,      // temporizador del guardado diferido
};

// Cuánto vale una cuenta ya calculada. Sube a segundos porque el tablero se
// repinta varias veces seguidas (navReload, volver de una pantalla hija) y
// cada repintado dispararía la consulta entera.
const UB_CACHE_MS = 15000;

async function _ubFS() {
    const module = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...module, db: window._cronos_auth?.db };
}

function _ubYo() {
    return (typeof window._getEffectiveUser === 'function')
        ? window._getEffectiveUser()
        : window._cronosCurrentUser;
}

// ── La CLASE de rol, que es la unidad de los contadores viejos ────────
//  'user' y 'coach' son el mismo puesto en este proyecto; el director, el
//  coordinador y el administrador del club comparten el contador «staff».
function _ubClase(rol) {
    const r = String(rol || '').trim().toLowerCase();
    if (r === 'coach' || r === 'user') return 'coach';
    if (r === 'parent') return 'parent';
    return 'staff';
}

// ════════════════════════════════════════════════════════════════════
//  🔴 v745 · LA UNIDAD ES LA PLAZA, TAMBIÉN AQUÍ
// ════════════════════════════════════════════════════════════════════
//  Reporte del autor (2026-09-19): «he enviado un mensaje desde el
//  administrador del club y al entrar con el director deportivo o el
//  coordinador no aparece el 1 rojo».
//
//  🔑 MEDIDO ANTES DE TOCAR NADA: en su club hay TRES personas —arinagazone
//  (administrador), brunoromar2012 y nenitabruna (entrenadores)—, y **no hay
//  ningún usuario director ni coordinador**: esas dos plazas son suyas, de la
//  MISMA cuenta (se ve en su captura 10589, y es lo que explicaba que los tres
//  paneles enseñaran el mismo 17 en v743). Así que el mensaje que mandó «desde
//  el administrador» lo mandó el mismo `uid` que luego entra de director, y
//  las dos reglas de v744 lo descartaban con razón: lo mío no cuenta, y la
//  marca de lectura era POR PERSONA.
//
//  🔑 LA CORRECCIÓN NO ES UNA EXCEPCIÓN PARA PROBAR: es la doctrina de este
//  proyecto desde v540 — **la unidad es la PLAZA, no la persona**. Y en este
//  canal ya estaba aplicada en la otra mitad del circuito: v740 sella
//  `senderRole` con la plaza ACTIVA justamente porque una misma persona habla
//  desde puestos distintos, y las burbujas la pintan como voces distintas
//  («José Alberto · ADMINISTRADOR» / «· DIRECTOR DEPORTIVO»). Lo que faltaba
//  era que el CONTADOR leyese esa misma unidad: si el canal reconoce dos
//  voces, tiene que reconocer dos bandejas.
//
//  ⚠️ En un club de verdad esto no cambia nada —administrador y director son
//  dos personas— y el único efecto lateral es que quien tenga dos plazas verá
//  un aviso de su propio mensaje al ponerse el otro sombrero, que se va en
//  cuanto entra. Se prefiere eso a un contador que no puede despertar.
//
//  🔴 Y CON LA PLAZA DENTRO, TRES FILOS QUE SE MIDIERON ANTES DE PUBLICARLA:
//   1. LOS DOS SITIOS NO FIRMAN IGUAL. El canal firma con `_ccRolFirma` y un
//      chat particular con `_umState.role`; preguntando al criterio del canal
//      para los dos, una cuenta de entrenador mirando desde su plaza de
//      FAMILIAR se contaba sola los mensajes que acababa de mandar. Por eso
//      hay `_ubPlazaDe` (canal) y `_ubPlazaHilo` (chats).
//   2. UN PUESTO, DOS NOMBRES. El del ente arranca como 'individual' y firma
//      como 'admin_individual'; sin el censo de alias, una plaza son dos.
//   3. EL CERO TIENE QUE LLEGAR A LA TARJETA. `ubMarcarTodoLeido` va sin
//      `await`, así que quien entraba y salía deprisa repintaba su tarjeta
//      antes de que las marcas estuvieran puestas — y el tablero no vuelve a
//      pintarse solo. Al terminar se repintan los huecos vivos, y al esconder
//      la página se adelanta el guardado diferido.

// ── Los ALIAS de una misma plaza ─────────────────────────────────────
//  🚨 CADA PUESTO SE ESCRIBE DE DOS FORMAS EN ESTE PROYECTO, y comparar sin
//  normalizar convierte una plaza en dos: el usuario se contaría a sí mismo.
//  Medido en el código, no de memoria (censo de `role === '...'`):
//   · el entrenador es 'user' al arrancar (role-launch.js) y 'coach' al firmar
//     un mensaje (panel.js), y en el ente individual su rol raíz es
//     'entrenador_individual';
//   · el administrador del club es 'admin' en las cuentas antiguas;
//   · 🔴 el administrador del ente arranca como 'individual' y firma como
//     'admin_individual' — dos nombres del MISMO puesto, y sin esta línea
//     todos sus mensajes le volvían como «sin leer»;
//   · el familiar aparece como 'parent', 'padre' y 'parent_individual'.
const UB_ALIAS_PLAZA = {
    user: 'coach', coach: 'coach', entrenador_individual: 'coach',
    admin: 'club_admin', club_admin: 'club_admin',
    individual: 'admin_individual', admin_individual: 'admin_individual',
    parent: 'parent', padre: 'parent',
    parent_individual: 'parent', padre_individual: 'parent',
    coordinador: 'coordinator',
};
function _ubPlazaNorm(rol) {
    const r = String(rol || '').trim().toLowerCase();
    return UB_ALIAS_PLAZA[r] || r;
}

// ── La plaza desde la que miro EL CANAL ───────────────────────────────
//  🔑 Se le pregunta a `_ccRolFirma`, que es LA MISMA función con la que se
//  firman los mensajes del canal (v740): si un día cambiara el criterio de
//  firma, el de lectura lo seguiría solo. Sin ella (club-chat.js no cargado),
//  la plaza activa y, en último término, el rol raíz.
function _ubPlazaDe(yo) {
    if (typeof window._ccRolFirma === 'function') {
        const p = _ubPlazaNorm(window._ccRolFirma(yo));
        if (p) return p;
    }
    return _ubPlazaNorm((yo && (yo._activeRole || yo.role)) || '');
}
window._ubPlazaDe = _ubPlazaDe;

// ── La plaza desde la que miro UN CHAT PARTICULAR ─────────────────────
//  🚨 NO ES LA MISMA PREGUNTA, y por eso no es la misma función. Los dos sitios
//  sellan `senderRole` con criterios distintos:
//   · el CANAL firma con `_ccRolFirma`, que sólo conoce los seis puestos del
//     canal y ante cualquier otro cae al rol RAÍZ;
//   · un CHAT PARTICULAR firma con `_umState.role` (comms/panel.js), que es la
//     plaza por la que se entró — y ahí sí existen el familiar y el
//     administrador del ente.
//  🔴 MEDIDO: una cuenta de entrenador mirando desde su plaza de FAMILIAR se
//  contaba como «sin leer» los mensajes que ella misma acababa de enviar,
//  porque `_ccRolFirma` no puede decir 'parent' y devolvía 'coach'. Aquí manda
//  la plaza ACTIVA, que es la que firmó, y sólo si no la hay se pregunta al
//  criterio del canal.
function _ubPlazaHilo(yo) {
    const activa = _ubPlazaNorm((yo && yo._activeRole) || '');
    if (activa) return activa;
    return _ubPlazaDe(yo);
}
window._ubPlazaHilo = _ubPlazaHilo;

// ¿Este mensaje me lo mandaron a mí?
//  🚨 LOS INFORMES NO FIRMAN CON `senderUid`. Los mensajes que inyectan los
//  módulos de informes son `{ sender:'coach', text, timestamp, type }` — sin
//  uid (match-reports-send.js:579 y :808, collective-report.js, etc.). Si se
//  exigiera `senderUid` se perderían todos esos avisos para el director; y si
//  se contaran a ciegas, el entrenador se contaría los suyos. Por eso, cuando
//  no hay uid, se compara la CLASE de quien firma con la mía.
//
//  ⚠️ `plazaMia` SE RECIBE, NO SE DEDUCE AQUÍ DENTRO: quien llama sabe si está
//  contando el canal (`_ubPlazaDe`) o un chat particular (`_ubPlazaHilo`), y
//  las dos plazas no se leen igual. Deducirla aquí obligaría a esta función a
//  adivinar de qué colección viene el mensaje.
function _ubEsDeOtro(m, yo, plazaMia) {
    if (!m || !yo) return false;
    const mia = plazaMia || _ubPlazaHilo(yo);
    const uid = m.senderUid || m.senderUID || null;
    if (uid) {
        if (uid !== yo.uid) return true;                 // otra persona
        // Mismo uid: sólo es MÍO si además viene de ESTA plaza. Un mensaje que
        // yo mismo firmé como administrador es, para mi plaza de director, un
        // mensaje que está sin leer (ver la nota de v745 de aquí arriba).
        const rolM = _ubPlazaNorm(m.senderRole);
        if (!rolM) return false;                         // sin plaza sellada: mío
        return rolM !== mia;
    }
    const firma = String(m.sender || m.senderRole || '').trim().toLowerCase();
    if (!firma) return true;              // sin firma: se trata como recibido
    return _ubClase(firma) !== _ubClase(mia);
}

// La hora del último mensaje de un hilo. Se mira el array Y `lastMessageAt`,
// porque no siempre coinciden: los módulos de informes escriben el sello del
// hilo con `arrayUnion`, y un hilo migrado puede traer uno y no el otro. Se
// queda el MAYOR, que es lo que deja el hilo por leído entero.
function _ubUltimoDe(t) {
    let ultimo = String((t && t.lastMessageAt) || '');
    const msgs = Array.isArray(t && t.messages) ? t.messages : [];
    for (const m of msgs) {
        const ts = String((m && m.timestamp) || '');
        if (ts > ultimo) ultimo = ts;
    }
    return ultimo;
}

// Los mensajes de ESTE hilo que yo no he leído. Es la MISMA cuenta que usa el
// badge del panel, para que la tarjeta y la lista de contactos no puedan decir
// cosas distintas — que es justo lo que el autor vio en v743.
//  ⚠️ SÍNCRONA y sin red: se apoya en las marcas ya cargadas en memoria. Si
//  todavía no lo están, devuelve 0 en vez de inventarse un número.
function ubNoLeidosDeHilo(threadId, t) {
    const yo = _ubYo();
    const st = window._ubState;
    if (!yo || !yo.uid || !t || !st.marcas || st.marcas.uid !== yo.uid) return 0;
    const marca = (st.marcas.threads || {})[threadId];
    if (!marca) return 0;                       // hilo sin marca = hilo sembrado
    const msgs = Array.isArray(t.messages) ? t.messages : [];
    const plaza = _ubPlazaHilo(yo);
    let n = 0;
    for (const m of msgs) {
        if (!_ubEsDeOtro(m, yo, plaza)) continue;
        if (String((m && m.timestamp) || '') > marca) n++;
    }
    return n;
}
window.ubNoLeidosDeHilo = ubNoLeidosDeHilo;

// ════════════════════════════════════════════════════════════════════
//  LAS MARCAS DE LECTURA
// ════════════════════════════════════════════════════════════════════
async function ubMarcas() {
    const yo = _ubYo();
    const vacio = () => ({ threads: {}, staffChannel: '', staffChannelByPlaza: {} });
    if (!yo || !yo.uid) return vacio();
    const st = window._ubState;
    if (st.marcas && st.marcas.uid === yo.uid) return st.marcas;
    let datos = vacio();
    try {
        const { db, doc, getDoc } = await _ubFS();
        const snap = await getDoc(doc(db, 'users', yo.uid, 'cronos_data', UB_DOC_MARCAS));
        if (snap.exists()) {
            const d = snap.data() || {};
            datos = { threads: d.threads || {}, staffChannel: d.staffChannel || '',
                      // 🔴 v745 · Una marca del canal POR PLAZA (ver la nota de
                      // `_ubPlazaDe`). El campo viejo se conserva y se sigue
                      // escribiendo: es el punto de partida de una plaza que
                      // todavía no tiene el suyo.
                      staffChannelByPlaza: d.staffChannelByPlaza || {} };
        }
    } catch (_) { /* sin marcas no se bloquea nada: se sembrará al contar */ }
    datos.uid = yo.uid;
    st.marcas = datos;
    return datos;
}
window.ubMarcas = ubMarcas;

// ── Hasta cuándo tengo leído el canal DESDE ESTA PLAZA ────────────────
//  ⚠️ EL RESPALDO EN LA MARCA DE PERSONA NO ES COSMÉTICO: sin él, una plaza
//  estrenada empezaría con el canal entero por leer y el aviso saldría con
//  todo el histórico dentro — la falsa alarma que este contador lleva evitando
//  desde que nació. Heredando lo que ya había leído la persona, una plaza
//  nueva empieza al día y avisa del siguiente mensaje.
//  🔴 v746 · PERO ESE RESPALDO SÓLO VALE SI SE QUEDA QUIETO. Mientras subía a
//  cada lectura, una plaza sin marca heredaba «leído hasta el último mensaje»
//  cada vez que otra plaza entraba, y no podía encenderse nunca. Ver la nota
//  de `ubMarcarCanalLeido`.
function _ubMarcaCanal(marcas, yo) {
    const porPlaza = (marcas && marcas.staffChannelByPlaza) || {};
    const mia = porPlaza[_ubPlazaDe(yo)];
    return String(mia || (marcas && marcas.staffChannel) || '');
}

// Guardado DIFERIDO. El canal escucha en vivo y marcaría lectura en cada
// mensaje que llega; agrupando las escrituras, una conversación animada cuesta
// una escritura y no quince.
function _ubGuardarDiferido() {
    const st = window._ubState;
    if (st.guardar) clearTimeout(st.guardar);
    st.guardar = setTimeout(() => {
        st.guardar = null;
        const m = st.marcas;
        if (!m || !m.uid) return;
        _ubFS().then(({ db, doc, setDoc }) =>
            setDoc(doc(db, 'users', m.uid, 'cronos_data', UB_DOC_MARCAS),
                   { threads: m.threads || {}, staffChannel: m.staffChannel || '',
                     staffChannelByPlaza: m.staffChannelByPlaza || {},
                     updatedAt: new Date().toISOString() },
                   { merge: true })
        ).catch(() => { /* una marca que no se guarda sólo repite el aviso */ });
    }, 2500);
}

// ── 🔴 v745 · Y SI SE CIERRA LA APP ANTES DE QUE VENZA EL TEMPORIZADOR ──
//  El agrupado de 2,5 s ahorra escrituras, pero tiene un filo: quien entra en
//  la bandeja, la mira y cierra la pestaña deja las marcas SÓLO en memoria, y
//  al volver a entrar se encuentra otra vez el mismo número — el fallo exacto
//  que este contador viene a quitar. Al esconderse la página se adelanta el
//  vencimiento.
//  🚨 UN SOLO OYENTE, PASE LO QUE PASE (lección de v719): el módulo puede
//  evaluarse más de una vez —el service worker lo sirve a dos pantallas— y
//  cada pasada registraría otra función. La bandera vive en `_ubState`, que ya
//  es único.
function _ubGuardarYa() {
    const st = window._ubState;
    if (!st.guardar) return;                 // no hay nada pendiente
    clearTimeout(st.guardar);
    st.guardar = null;
    const m = st.marcas;
    if (!m || !m.uid) return;
    _ubFS().then(({ db, doc, setDoc }) =>
        setDoc(doc(db, 'users', m.uid, 'cronos_data', UB_DOC_MARCAS),
               { threads: m.threads || {}, staffChannel: m.staffChannel || '',
                 staffChannelByPlaza: m.staffChannelByPlaza || {},
                 updatedAt: new Date().toISOString() },
               { merge: true })
    ).catch(() => { /* sin red, Firestore la reenvía al reconectar */ });
}
if (!window._ubState.oyenteSalida && typeof document !== 'undefined' &&
    typeof document.addEventListener === 'function') {
    window._ubState.oyenteSalida = true;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') _ubGuardarYa();
    });
    if (typeof window.addEventListener === 'function') {
        window.addEventListener('pagehide', _ubGuardarYa);
    }
}

// Marcar un hilo particular como leído hasta `hasta` (ISO). Sin `hasta`, ahora.
async function ubMarcarHiloLeido(threadId, hasta) {
    if (!threadId) return;
    const m = await ubMarcas();
    if (!m.uid) return;
    const nueva = String(hasta || new Date().toISOString());
    if (String(m.threads[threadId] || '') >= nueva) return;   // ya estaba al día
    m.threads[threadId] = nueva;
    window._ubState.cache = null;                             // el badge cambia
    _ubGuardarDiferido();
}
window.ubMarcarHiloLeido = ubMarcarHiloLeido;

// Lo mismo para el Canal Club, pero POR PLAZA (v745).
//
//  🔴🔴 v746 · `staffChannel` ES UN SUELO, NO UN REGISTRO DE LECTURA. Hasta
//  v745 esta función subía LAS DOS marcas, y ahí estaba el fallo que reportó
//  el autor: leer el canal desde una plaza movía también la marca de PERSONA,
//  que es justo el punto de partida que hereda una plaza sin marca propia. En
//  su prueba —leer y escribir de Director, entrar de Coordinador— el
//  coordinador heredaba «leído hasta el último mensaje» y nacía a cero: el
//  aviso no podía encenderse nunca. Y lo mismo, cada vez peor, para toda plaza
//  que no abriese el canal: heredaba siempre la última lectura de OTRA.
//
//  🔑 Ahora sólo avanza la marca de LA PLAZA. La de persona se escribe una
//  única vez, cuando no hay nada, y se queda quieta: sigue evitando que una
//  plaza estrenada se coma el histórico entero (que es para lo que nació), sin
//  poder tapar lo que esa plaza todavía no ha leído.
async function ubMarcarCanalLeido(hasta) {
    const m = await ubMarcas();
    if (!m.uid) return;
    const yo = _ubYo();
    const nueva = String(hasta || new Date().toISOString());
    const plaza = _ubPlazaDe(yo) || 'sin_plaza';
    if (!m.staffChannelByPlaza) m.staffChannelByPlaza = {};
    const yaMia = String(m.staffChannelByPlaza[plaza] || '');
    const sinSuelo = !String(m.staffChannel || '');
    if (yaMia >= nueva && !sinSuelo) return;          // esta plaza ya está al día
    if (nueva > yaMia) m.staffChannelByPlaza[plaza] = nueva;
    if (sinSuelo) m.staffChannel = nueva;             // ⚠️ SÓLO la primera vez
    window._ubState.cache = null;
    _ubGuardarDiferido();
}
window.ubMarcarCanalLeido = ubMarcarCanalLeido;

// ════════════════════════════════════════════════════════════════════
//  🔴 v744 · ENTRAR EN LA BANDEJA DEJA EL CONTADOR A CERO
// ════════════════════════════════════════════════════════════════════
//  Regla exacta del encargo: «en el momento exacto en que el usuario entra en
//  la sección de mensajería y visualiza los chats, el contador debe marcar
//  cero (o desaparecer)». Hasta v744 sólo se marcaba el hilo que se ABRÍA, así
//  que quien entraba, miraba la lista y salía se encontraba el mismo número.
//
//  🔑 SE LLAMA AL FINAL DEL RENDER DEL PANEL, NO AL PRINCIPIO, y el orden es
//  lo único delicado de esto: la lista de contactos se pinta con el número por
//  hilo, así que marcarlo todo ANTES dejaría la bandeja sin señalar qué chat
//  traía novedades — se vería entrar «17» y una lista sin un solo aviso. Al
//  final, se ve lo que había y al volver el contador está a cero.
async function ubMarcarTodoLeido() {
    const yo = _ubYo();
    if (!yo || !yo.uid) return;
    const marcas = await ubMarcas();
    if (!marcas.uid) return;
    const ahora = new Date().toISOString();
    try {
        const { db, collection, query, where, orderBy, limit, getDocs } = await _ubFS();
        const snap = await getDocs(query(collection(db, UB_COL_HILOS),
            where('participants', 'array-contains', yo.uid)));
        const hasta = [];
        snap.forEach(d => hasta.push([d.id, _ubUltimoDe(d.data() || {}) || ahora]));
        for (const [id, h] of hasta) await ubMarcarHiloLeido(id, h);

        //  🚨 EL CANAL SE MARCA HASTA SU ÚLTIMO MENSAJE, NO HASTA «AHORA».
        //  Los sellos de los mensajes los pone el RELOJ DE QUIEN ESCRIBE
        //  (`new Date().toISOString()` en su navegador). Con un aparato
        //  adelantado unos minutos —cosa habitual— un mensaje puede tener una
        //  hora POSTERIOR a mi «ahora», y entonces sobreviviría al marcado:
        //  el contador se quedaría clavado en 1 después de entrar en la
        //  bandeja, que es justo lo que el encargo prohíbe. Preguntando por el
        //  más nuevo, el cero no depende de qué reloj lo escribió.
        const veCanal = (typeof window.ccPuedeVerCanal === 'function')
            ? window.ccPuedeVerCanal(yo) : false;
        if (veCanal && yo.clubId) {
            const cs = await getDocs(query(collection(db, UB_COL_CANAL),
                where('clubId', '==', yo.clubId),
                orderBy('createdAt', 'desc'), limit(1)));
            let masNuevo = '';
            cs.forEach(d => {
                const c = String((d.data() || {}).createdAt || '');
                if (c > masNuevo) masNuevo = c;
            });
            await ubMarcarCanalLeido(masNuevo || ahora);
        }
    } catch (_) {
        //  Si algo falla a mitad, al menos el canal se da por visto: entrar en
        //  la bandeja no puede dejar el aviso como estaba.
        await ubMarcarCanalLeido(ahora);
    }
    window._ubState.cache = null;
    //  🔴 v745 · Y SE REPINTA LO QUE SIGA EN PANTALLA. Esto se llama SIN
    //  `await` desde el render de la bandeja, así que tarda más que el clic:
    //  quien entra y sale enseguida repintaba su tarjeta ANTES de que las
    //  marcas estuvieran puestas y se encontraba el número de antes intacto —
    //  y el tablero no vuelve a pintarse solo. Al terminar, se rellenan los
    //  huecos que existan ahora mismo; los que no estén, ni se tocan.
    ubRepintarBadges();
}
window.ubMarcarTodoLeido = ubMarcarTodoLeido;

// ════════════════════════════════════════════════════════════════════
//  LA CUENTA
// ════════════════════════════════════════════════════════════════════
//  Devuelve { privados, canal, total }. NUNCA lanza: un badge que rompe la
//  pantalla que lo aloja sería mucho peor que un badge que no aparece.
async function ubContarNoLeidos(forzar) {
    const vacio = { privados: 0, canal: 0, total: 0 };
    const yo = _ubYo();
    if (!yo || !yo.uid) return vacio;

    const st = window._ubState;
    //  🔴 v746 · LA CACHÉ SE INDEXA POR PLAZA, NO SÓLO POR PERSONA. Iba con el
    //  `uid` a secas, y quien tiene varios sombreros cambia de plaza SIN
    //  recargar la página: entrar de Director (0) y pasar a Coordinador dentro
    //  de los 15 segundos devolvía el 0 del Director. Dos bandejas distintas
    //  no pueden compartir el mismo número guardado.
    const clave = yo.uid + '|' + _ubPlazaHilo(yo) + '|' + _ubPlazaDe(yo);
    if (!forzar && st.cache && st.cache.clave === clave &&
        (Date.now() - st.cache.at) < UB_CACHE_MS) {
        return { privados: st.cache.privados, canal: st.cache.canal, total: st.cache.total };
    }

    const marcas  = await ubMarcas();
    //  Las DOS plazas, resueltas una sola vez: la de los chats particulares y
    //  la del canal. Se separan porque cada sitio sella `senderRole` con un
    //  criterio distinto (ver `_ubPlazaHilo`).
    const plazaHilo  = _ubPlazaHilo(yo);
    const plazaCanal = _ubPlazaDe(yo);
    let privados = 0, canal = 0;

    try {
        const { db, collection, query, where, orderBy, limit, getDocs } = await _ubFS();

        // ── 1. LOS CHATS PARTICULARES ────────────────────────────────
        //  🔑 `array-contains` sobre `participants` es lo que hace legal la
        //  consulta: la regla de `cronos_messages` autoriza por documento, y
        //  con este `where` todos los que vuelven me tienen dentro, así que
        //  ninguno puede tumbar la consulta entera (la lección de v674).
        //  Es además la MISMA forma que ya usa el panel del SuperAdmin.
        try {
            const snap = await getDocs(query(collection(db, UB_COL_HILOS),
                where('participants', 'array-contains', yo.uid)));
            const siembra = [];
            snap.forEach(d => {
                const t = d.data() || {};
                const marca = marcas.threads ? marcas.threads[d.id] : '';
                if (!marca) {
                    //  🔴 v744 · HILO SIN MARCA = HILO ANTIGUO, Y NO CUENTA.
                    //  «No debe contar hilos antiguos» (encargo). Se anota su
                    //  último mensaje como leído y a partir del siguiente sí
                    //  avisa. Antes aquí se heredaba el contador viejo, que es
                    //  de donde salían los 17 y los 36 de sus capturas.
                    siembra.push([d.id, _ubUltimoDe(t)]);
                    return;
                }
                const msgs = Array.isArray(t.messages) ? t.messages : [];
                for (const m of msgs) {
                    //  🔑 La plaza de los CHATS PARTICULARES, que no es la del
                    //  canal: aquí firma `_umState.role` (ver `_ubPlazaHilo`).
                    if (!_ubEsDeOtro(m, yo, plazaHilo)) continue;
                    if (String((m && m.timestamp) || '') > marca) privados++;
                }
            });
            //  La siembra va DESPUÉS del recorrido y en una sola tanda: tocar
            //  el mapa de marcas mientras se recorre haría que el siguiente
            //  hilo se midiera contra un estado a medio escribir.
            for (const [id, hasta] of siembra) {
                if (hasta) await ubMarcarHiloLeido(id, hasta);
            }
        } catch (_) { /* sin hilos legibles, el canal sigue contando */ }

        // ── 2. EL CANAL DEL CLUB ─────────────────────────────────────
        //  Sólo para quien lo tiene: preguntándoselo al MISMO criterio que
        //  pinta la pestaña, para que el badge no cuente un canal que su
        //  dueño no puede abrir.
        const veCanal = (typeof window.ccPuedeVerCanal === 'function')
            ? window.ccPuedeVerCanal(yo) : false;
        if (veCanal && yo.clubId) {
            try {
                //  ⚠️ `limit` SIEMPRE con `orderBy` (v508), y es el índice que
                //  el canal ya tiene declarado: clubId ASC + createdAt DESC.
                const snap = await getDocs(query(collection(db, UB_COL_CANAL),
                    where('clubId', '==', yo.clubId),
                    orderBy('createdAt', 'desc'),
                    limit(UB_TOPE_CANAL)));

                // 🔴 v745 · La marca que manda es la de MI PLAZA (con la de
                // persona como punto de partida). Ver `_ubMarcaCanal`.
                const marcaCanal = _ubMarcaCanal(marcas, yo);
                if (!marcaCanal) {
                    //  PRIMERA VEZ: se siembra la marca con el mensaje más
                    //  nuevo y se informa de 0. El contador nace hoy; anunciar
                    //  como pendientes cien mensajes que ya leyó sería una
                    //  falsa alarma, y la primera falsa alarma es la que hace
                    //  que un aviso deje de mirarse.
                    let masNuevo = '';
                    snap.forEach(d => {
                        const c = String((d.data() || {}).createdAt || '');
                        if (c > masNuevo) masNuevo = c;
                    });
                    if (masNuevo) await ubMarcarCanalLeido(masNuevo);
                } else {
                    snap.forEach(d => {
                        const m = d.data() || {};
                        //  🔴 v745 · «Lo mío» es lo que escribí DESDE ESTA
                        //  PLAZA, no todo lo que lleve mi uid: el mensaje que
                        //  mandé como administrador del club sí está sin leer
                        //  para mi plaza de director. Es la misma unidad con
                        //  la que v740 firma los mensajes del canal.
                        if (!_ubEsDeOtro(m, yo, plazaCanal)) return;
                        if (String(m.createdAt || '') > marcaCanal) canal++;
                    });
                }
            } catch (_) { /* índice construyéndose o sin red: privados ya cuenta */ }
        }
    } catch (_) { return vacio; }

    const res = { privados, canal, total: privados + canal };
    st.cache = { clave, uid: yo.uid, at: Date.now(), ...res };
    return res;
}
window.ubContarNoLeidos = ubContarNoLeidos;

// ════════════════════════════════════════════════════════════════════
//  PINTARLO
// ════════════════════════════════════════════════════════════════════
//  El tablero se pinta de golpe y en seco (`innerHTML = ...`) mientras la
//  cuenta necesita ir a la nube. Por eso la tarjeta nace con su hueco VACÍO y
//  esto lo rellena después: así el panel no espera a Firestore para aparecer,
//  que es lo que convertiría un adorno en un retraso de arranque.
//
//  ⚠️ Si el hueco ya no está (el usuario cambió de pantalla mientras se
//  contaba), no se hace nada. Pintar en un contenedor que ya no existe es el
//  fallo que este proyecto lleva pagando desde v439.
async function ubPintarBadge(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    let n = 0;
    try { n = (await ubContarNoLeidos()).total; } catch (_) { return; }
    const vivo = document.getElementById(elId);
    if (!vivo) return;
    if (!n) { vivo.style.display = 'none'; vivo.textContent = ''; return; }
    vivo.textContent = n > 99 ? '99+' : String(n);
    vivo.style.display = '';
    vivo.title = n === 1 ? '1 mensaje sin leer' : n + ' mensajes sin leer';
}
window.ubPintarBadge = ubPintarBadge;

// ── Los CUATRO huecos del encargo, para repintarlos sin saber en cuál estoy ──
//  🚨 LA LISTA ES EL CENSO DE LOS CUATRO PANELES, y tiene que seguir siéndolo:
//  un quinto panel que estrene su hueco y no se apunte aquí se quedaría con el
//  número viejo al volver de la bandeja. El guard la compara con los ids que
//  pintan los paneles, para que no se puedan separar.
const UB_HUECOS = ['ca-badge-mensajes', 'sd-badge-mensajes',
                   'um-badge-mensajes', 'cm-badge-mensajes'];

// Repinta los que estén EN PANTALLA ahora mismo. Sin `await`: quien llama está
// terminando otra cosa y esto no puede retrasarla.
function ubRepintarBadges() {
    if (typeof document === 'undefined') return;
    for (const id of UB_HUECOS) {
        if (document.getElementById(id)) ubPintarBadge(id);
    }
}
window.ubRepintarBadges = ubRepintarBadges;

// El hueco, con el mismo aspecto que la píldora del tablero (utils.js), para
// las pantallas que NO se pintan con `cronosTableroHtml` — los dos menús de
// Comunicaciones del entrenador.
function ubHuecoBadge(elId) {
    return '<span id="' + String(elId) + '" style="display:none;flex:0 0 auto;' +
           'background:#ff5858;color:white;font-size:0.72rem;font-weight:800;' +
           'line-height:1;padding:0.25rem 0.5rem;border-radius:999px;' +
           'min-width:1.25rem;text-align:center;margin-left:auto;' +
           'box-shadow:0 2px 8px rgba(255,88,88,0.45);"></span>';
}
window.ubHuecoBadge = ubHuecoBadge;
