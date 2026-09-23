// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — club-chat.js
//  💬 v739 · EL CHAT COMÚN DEL CLUB
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-09-18): UN canal por club que agrupa a todos los
//  entrenadores (F7 y F11 juntos), todos los coordinadores, el director
//  deportivo y el administrador del club. El familiar queda fuera. El ente
//  individual no participa. El SuperAdmin no pertenece al canal pero conserva
//  acceso de supervisión.
//
//  ⚠️⚠️ ESTO NO ES UN HILO MÁS DE `cronos_messages`, Y NO PODÍA SERLO:
//
//   1. Allí un hilo es estrictamente una PAREJA: `_cThreadId` (panel.js) ordena
//      dos uids y los concatena. «Todos los técnicos del club» no se puede
//      escribir con esa fórmula.
//   2. Allí los mensajes viven en un ARRAY dentro del documento del hilo. Para
//      dos personas se aguanta; para la plantilla técnica entera son el tope de
//      1 MiB, la contención de escrituras sobre el mismo documento y una
//      descarga del histórico completo en cada apertura.
//   3. 🚨 Y sobre todo: el `allow read` de `cronos_messages` incluye
//      `sameClubAsDoc(clubId)` y `userDocClubId(clubId)`, y NINGUNA mira el
//      rol. Un familiar autorizado del club puede leer cualquier hilo de su
//      club pidiendo el documento. Un canal «sólo técnicos» ahí dentro estaría
//      escondido en la interfaz y abierto en la base de datos.
//
//  🔑 LA PERTENENCIA SE DEDUCE DEL ROL, NO SE MANTIENE UNA LISTA. El encargo
//  pide alta automática al registrar a alguien en el club: una lista de
//  miembros habría que tocarla en cada alta, cada baja y cada cambio de rol, y
//  el día que se desincronice alguien se queda fuera sin que salte nada. Lo
//  único que se escribe es lo excepcional — `expelledUids`, la potestad de
//  expulsar que el autor reserva al administrador del club.
//
//  ⚠️ SOBRE EL CIFRADO. El encargo dice «manteniendo el sistema de encriptación
//  actual». Medido antes de escribir nada: **no hay cifrado de aplicación en la
//  mensajería de este proyecto** — los mensajes de `cronos_messages` se guardan
//  en texto plano. Lo que protege a un chat hoy es el cifrado en tránsito
//  (TLS), el cifrado en reposo de Google y, sobre todo, las reglas de
//  Firestore. Este canal se queda EXACTAMENTE con esas tres cosas, y con unas
//  reglas más estrictas que las del resto de la mensajería. Si algún día se
//  quiere cifrado extremo a extremo, es un trabajo aparte y afecta a toda la
//  mensajería, no sólo a esto.
// ════════════════════════════════════════════════════════════════════

const CC_COL_CANAL    = 'cronos_staff_channel';
const CC_COL_MENSAJES = 'cronos_staff_messages';

// Cuántos mensajes se traen. El canal es de coordinación diaria, no un archivo
// histórico: con los últimos 100 se cubre de sobra y la lectura es constante
// por mucho que crezca la temporada.
const CC_TOPE = 100;

// 🔑 LA LISTA BLANCA DE ROLES, Y ES LA MISMA QUE LA DE firestore.rules.
//  · 'user' y 'coach' son AMBOS entrenador en este proyecto (app-init.js trata
//    los dos igual): con sólo uno de los dos, media plantilla se queda fuera.
//  · 'admin' es la variante antigua de 'club_admin'.
//  · ⚠️ NINGÚN rol del ente individual entra: el encargo dice que el ente no
//    participa, y una lista blanca lo cumple sin enumerar exclusiones.
//  · El familiar ('parent') tampoco, que es la exclusión explícita del encargo.
const CC_ROLES = ['director', 'coordinator', 'coach', 'user', 'club_admin', 'admin'];

// Etiqueta legible de cada rol, para firmar los mensajes del canal.
const CC_ETIQUETA_ROL = {
    director:    'Director Deportivo',
    coordinator: 'Coordinador',
    coach:       'Entrenador',
    user:        'Entrenador',
    club_admin:  'Administrador',
    admin:       'Administrador',
};

const CC_COLOR_ROL = {
    director:    '#d2a8ff',
    coordinator: '#f0883e',
    coach:       '#3fb950',
    user:        '#3fb950',
    club_admin:  '#58a6ff',
    admin:       '#58a6ff',
};

async function _ccFS() {
    const module = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...module, db: window._cronos_auth?.db };
}

function _ccEsc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : s);
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _ccYo() {
    return (typeof window._getEffectiveUser === 'function')
        ? window._getEffectiveUser()
        : window._cronosCurrentUser;
}

// ── El rol con el que entro AL CANAL ─────────────────────────────────
//  🚨 SE LEE EL ROL RAÍZ, NUNCA `allRoles`. El `allow update` de
//  users/{userId} impide que nadie se toque su propio 'role', pero `allRoles`
//  NO está en esa lista de campos protegidos: es autoescribible. Aquí es sólo
//  cosmético (la etiqueta del mensaje), pero si el criterio de pantalla y el
//  de las reglas divergieran, la interfaz prometería un canal que la base de
//  datos deniega — que es la peor forma de fallar.
function _ccRolDe(u) {
    return String((u && u.role) || '').trim().toLowerCase();
}

// ── El rol con el que FIRMO un mensaje ────────────────────────────────
//  🚨 v740 · NO ES EL MISMO QUE EL DE ACCESO, Y SE VE EN SU CAPTURA 10579:
//  envió tres mensajes desde la misma cuenta actuando de administrador, de
//  entrenador y de coordinador, y los TRES salieron firmados «ADMINISTRADOR».
//  La causa es que se firmaba con el rol RAÍZ, que en una cuenta con varias
//  plazas es sólo uno de ellos.
//
//  🔑 Se separan las dos preguntas, y es deliberado:
//   · QUIÉN PUEDE ENTRAR  → rol RAÍZ (`role`), porque es lo que miran las
//     reglas de Firestore y `allRoles` es autoescribible. No se toca.
//   · DESDE QUÉ PUESTO HABLO → la plaza ACTIVA (`_activeRole`), que es lo que
//     la app ya usa en todas partes para saber qué está haciendo el usuario
//     ahora mismo (js/core/app-init.js, js/core/setup-modal.js).
//
//  Firmar con el rol activo no abre nada: `senderRole` es una ETIQUETA, las
//  reglas no la leen, y el acceso lo sigue decidiendo el rol raíz.
//  ⚠️ Si la plaza activa no fuese un rol del canal (una plaza de familiar en
//  una cuenta que además es entrenador), se firma con el rol raíz: vale más un
//  cargo real que uno que este canal no reconoce.
function _ccRolFirma(u) {
    const activo = String((u && u._activeRole) || '').trim().toLowerCase();
    if (activo && CC_ROLES.indexOf(activo) !== -1) return activo;
    return _ccRolDe(u);
}
window._ccRolFirma = _ccRolFirma;

// ¿Puede esta persona ver el canal? Mismo criterio que las reglas.
// ⚠️ NO comprueba la expulsión: eso vive en la cabecera del canal y hay que
// leerla de la nube. La pantalla lo resuelve al abrir; la barrera de verdad
// está en las reglas.
function ccPuedeVerCanal(u) {
    u = u || _ccYo();
    if (!u || !u.clubId) return false;              // sin club no hay canal
    return CC_ROLES.indexOf(_ccRolDe(u)) !== -1;
}
window.ccPuedeVerCanal = ccPuedeVerCanal;

// ════════════════════════════════════════════════════════════════════
//  🔐 v742 · QUIÉN PUEDE **GESTIONAR** EL CANAL
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-18, capturas 10587-10591):
//  «Sólo pueden ver y utilizar el botón de Gestionar el Administrador del Club
//  y el Director Deportivo. Los Coordinadores y Entrenadores tienen totalmente
//  prohibido gestionar el canal, por lo que esa opción no debe aparecerles ni
//  estar accesible bajo ningún concepto».
//
//  Dos cambios, y el segundo es el que explica sus capturas:
//
//   1. ENTRA EL DIRECTOR DEPORTIVO. En v739 la potestad era sólo del
//      administrador del club — decisión suya entonces, cambiada ahora.
//
//   2. 🚨 SE MIRA TAMBIÉN LA PLAZA ACTIVA, NO SÓLO EL ROL RAÍZ. En sus cuatro
//      capturas sale «⚙️ Gestionar» en las cuatro plazas —director,
//      coordinador, entrenador y administrador— porque es LA MISMA CUENTA: su
//      rol raíz es `club_admin` y el botón preguntaba únicamente por él. Con
//      una cuenta de un solo rol el defecto es invisible; con una multi-plaza
//      el entrenador se ve el botón de expulsar. Es exactamente la trampa que
//      v740 pagó con la FIRMA de los mensajes, en la función de al lado.
//
//  🔑 LAS DOS CONDICIONES SE EXIGEN A LA VEZ, Y EL ORDEN IMPORTA:
//   · el rol RAÍZ concede la potestad — es lo único que las reglas de
//     Firestore pueden verificar;
//   · la plaza ACTIVA sólo puede QUITARLA, nunca darla. `_activeRole` y
//     `allRoles` son AUTOESCRIBIBLES (el `allow update` de users/{uid} no los
//     protege), así que un criterio que dependiera de ellos para CONCEDER lo
//     falsificaría cualquiera desde la consola. Restringiendo, no hay nada que
//     ganar falsificándolo: sólo quitarse a uno mismo un botón.
//
//  ⚠️ Sin plaza activa declarada manda el rol raíz: es el caso de las pantallas
//  que no la fijan, y negarlo ahí dejaría al administrador sin gestión.
const CC_ROLES_GESTION = ['club_admin', 'admin', 'director'];

function ccPuedeGestionar(u) {
    u = u || _ccYo();
    if (!u) return false;
    // 1) La potestad, por el rol RAÍZ (lo que miran las reglas).
    if (CC_ROLES_GESTION.indexOf(_ccRolDe(u)) === -1) return false;
    // 2) El puesto desde el que estoy actuando AHORA.
    const activo = String((u && u._activeRole) || '').trim().toLowerCase();
    if (!activo) return true;
    return CC_ROLES_GESTION.indexOf(activo) !== -1;
}
window.ccPuedeGestionar = ccPuedeGestionar;

// ¿Es el ADMINISTRADOR del club? Ya no decide la gestión (eso es
// `ccPuedeGestionar`), pero sigue haciendo falta para una cosa: a él no se le
// expulsa. Ver la nota de `ccAbrirGestion`.
function ccEsAdminDelClub(u) {
    u = u || _ccYo();
    const r = _ccRolDe(u);
    return r === 'club_admin' || r === 'admin';
}
window.ccEsAdminDelClub = ccEsAdminDelClub;

// ── Estado del canal abierto ─────────────────────────────────────────
//  🔑 `unsub` es lo que corta el `onSnapshot`. Sin guardarlo, cada vez que se
//  entra en la pestaña se registraría un oyente NUEVO sobre la misma consulta
//  y el canal se repintaría N veces por mensaje — el fallo por paridad de
//  listeners que ya costó v719, y aquí con una consulta en vivo detrás.
window._ccState = { unsub: null, clubId: '', contenedorId: '', expulsados: [], mensajes: [],
                    directorio: null };

function _ccCortarOyente() {
    try { if (typeof window._ccState.unsub === 'function') window._ccState.unsub(); }
    catch (_) { /* un oyente ya muerto no es un problema */ }
    window._ccState.unsub = null;
}
window._ccCortarOyente = _ccCortarOyente;

// ════════════════════════════════════════════════════════════════════
//  🎨 v740 · UN COLOR POR PERSONA
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-18, capturas 10575-10579): «cada
//  usuario participante tenga un color o tono de burbuja diferente».
//
//  🔑 EL COLOR SALE DEL `uid`, NO DEL ORDEN DE LLEGADA. Repartirlo por orden
//  («el primero que hable, azul») haría que el mismo entrenador fuese azul en
//  una pantalla y naranja en otra, y que cambiara de color al borrar un
//  mensaje o al pasar el tope de 100. Derivándolo del uid, **la misma persona
//  tiene el mismo color para todo el mundo y para siempre**, sin guardar nada.
//
//  ⚠️ Los tonos están elegidos para leerse sobre el fondo oscuro de la app y
//  para distinguirse entre sí; son los mismos que ya usa el proyecto en otras
//  pantallas, no una paleta nueva.
const CC_PALETA = [
    '#58a6ff', '#f0883e', '#d2a8ff', '#f778ba', '#56d4dd',
    '#e3b341', '#ff7b72', '#7ee787', '#a5d6ff', '#ffa657',
];

// Verde: el color de MIS mensajes, fijo y distinto de toda la paleta.
// 🔑 Que lo mío sea siempre del mismo color —y siempre a la derecha— es lo que
// permite localizar de un vistazo qué dije yo. Para los demás manda su color de
// persona. Es la convención de cualquier mensajería, y por eso no se explica.
const CC_COLOR_MIO = '#3fb950';

function _ccColorDe(uid) {
    const s = String(uid || '');
    if (!s) return '#8b949e';
    // Hash entero y estable (el mismo en cualquier navegador): no se usa
    // `Math.random` ni nada que dependa de la sesión.
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    return CC_PALETA[h % CC_PALETA.length];
}
window._ccColorDe = _ccColorDe;

// ════════════════════════════════════════════════════════════════════
//  🪪 v741 · SE FIRMA CON EL NOMBRE REGISTRADO, NO CON EL CORREO
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-18, capturas 10583-10585): «en
//  los mensajes del chat se muestra el correo electrónico (arinagazone). Quiero
//  que desaparezca el correo y se sustituya por el nombre de usuario registrado
//  junto a su rol».
//
//  🚨 LA CAUSA, MEDIDA ANTES DE TOCAR NADA: el mensaje se sellaba con
//  `yo.name || yo.displayName || yo.email`, y **`name` no existe en este
//  proyecto**. El usuario de sesión que arma auth.js lleva `firstName`,
//  `lastName` y `displayName` (js/services/auth.js:1942 y :2213) — jamás
//  `name`. Así que la cadena caía siempre al correo, y de ahí el «arinagazone»
//  de sus capturas: no faltaba el nombre en la base de datos, faltaba LEERLO.
//  El resto de la app ya compone el nombre igual en nueve sitios
//  (`displayName || [firstName, lastName]`), así que esto no inventa un
//  criterio nuevo: adopta el que ya existe.
//
//  ⚠️ La plaza (`allRoles`) es el ÚLTIMO recurso y no el primero: ahí el nombre
//  se copia al dar el alta y puede haberse quedado viejo, mientras que la raíz
//  del documento es lo que el SuperAdmin y el administrador del club mantienen.
function _ccNombreDe(u) {
    if (!u) return '';
    const limpio = (v) => String(v == null ? '' : v).trim();
    const compuesto = (o) => limpio(o.displayName) ||
        [limpio(o.firstName), limpio(o.lastName)].filter(Boolean).join(' ') ||
        limpio(o.name);
    let n = compuesto(u);
    if (!n && Array.isArray(u.allRoles)) {
        for (const r of u.allRoles) { n = r ? compuesto(r) : ''; if (n) break; }
    }
    if (n) return n;
    // Sin NINGÚN nombre registrado se cae al correo SIN dominio. No es lo que
    // el autor quiere ver, pero una cuenta sin nombre tiene que seguir siendo
    // distinguible: «Miembro» repetido cinco veces es peor que un alias.
    const mail = limpio(u.email);
    return mail.indexOf('@') > 0 ? mail.slice(0, mail.indexOf('@')) : mail;
}
window._ccNombreDe = _ccNombreDe;

// ── El AUTOR de un documento (informe, aviso), por su nombre ─────────
//  v755 · encargo del autor (implementar.txt 2026-09-23, capturas 10755-10756):
//  el Informe Grupal seguía firmando «arinagazone@gmail.com» en la cabecera
//  del PDF y en la ficha del partido. v753b ya lo había arreglado para la
//  convocatoria y la planificación, pero con una función privada de
//  events-tab.js; ésta es la misma regla, compartida:
//    1. el nombre SELLADO en el documento (`coachName`, desde v753b/v755);
//    2. el censo de nombres que pase quien llama (uid → nombre);
//    3. el directorio del club ya cargado (`_ccCargarDirectorio`);
//    4. si el autor soy yo, mi propio nombre;
//    5. el correo SIN dominio, sólo si no hay nada más.
function _ccNombreAutor(d, nombres) {
    if (!d) return '';
    const limpio = (v) => String(v == null ? '' : v).trim();
    const n = limpio(d.coachName);
    if (n) return n;
    const uid = limpio(d.coachUid || d.createdBy);
    if (uid) {
        if (nombres && nombres[uid]) return nombres[uid];
        const dir = window._ccState && window._ccState.directorio;
        if (dir && dir.nombres && dir.nombres[uid]) return dir.nombres[uid];
        const me = window._cronosCurrentUser;
        if (me && me.uid === uid) { const mio = _ccNombreDe(me); if (mio) return mio; }
    }
    const mail = limpio(d.coachEmail);
    return mail.indexOf('@') > 0 ? mail.slice(0, mail.indexOf('@')) : mail;
}
window._ccNombreAutor = _ccNombreAutor;

// ── El directorio de nombres del club ────────────────────────────────
//  🔑 ARREGLA TAMBIÉN LO YA ESCRITO. El nombre va SELLADO en cada mensaje (y
//  se queda: quien deja el club debe seguir apareciendo), pero los mensajes
//  que ya están en producción se sellaron con el correo. Resolviendo el uid
//  contra el censo del club al abrir el canal, esas burbujas pasan a decir el
//  nombre sin tocar un solo documento — y quien ya no esté en el censo
//  conserva su firma original, que para eso se sella.
//
//  ⚠️ UNA SOLA LECTURA POR CLUB Y SESIÓN: se cachea por `clubId` porque el
//  canal se abre y se cierra cada vez que se entra en la pestaña. Si la
//  consulta falla (permisos, sin red), NO pasa nada: se pinta el nombre
//  sellado, que es exactamente lo que se pintaba antes de esto.
async function _ccCargarDirectorio(clubId) {
    const st = window._ccState;
    if (st.directorio && st.directorio.clubId === clubId) return st.directorio.nombres;
    const nombres = {};
    try {
        const { db, collection, query, where, getDocs } = await _ccFS();
        const snap = await getDocs(query(collection(db, 'users'),
            where('clubId', '==', clubId)));
        snap.forEach(d => {
            const n = _ccNombreDe({ uid: d.id, ...d.data() });
            if (n) nombres[d.id] = n;
        });
    } catch (_) { /* sin censo se pinta el nombre sellado en el mensaje */ }
    st.directorio = { clubId, nombres };
    return nombres;
}
window._ccCargarDirectorio = _ccCargarDirectorio;

// El nombre que se pinta en la burbuja: el del censo si lo hay, y si no el que
// viajó sellado en el mensaje. El correo entero no cabe y no dice nada
// («arinagazone@gmail.com» ocupa media burbuja, captura 10579), así que de un
// correo se pinta lo que va antes de la arroba.
function _ccNombreCorto(m) {
    const dir = (window._ccState.directorio && window._ccState.directorio.nombres) || {};
    const vivo = dir[m && m.senderUid];
    if (vivo) return vivo;
    const n = String(m && m.senderName || '').trim();
    if (!n) return 'Alguien';
    return n.indexOf('@') > 0 ? n.slice(0, n.indexOf('@')) : n;
}

// ════════════════════════════════════════════════════════════════════
//  PINTADO
// ════════════════════════════════════════════════════════════════════
function _ccBurbuja(m, yo, soyAdmin) {
    const mio  = m.senderUid === yo.uid;
    const rol  = String(m.senderRole || '').toLowerCase();
    const etiq = CC_ETIQUETA_ROL[rol] || 'Miembro';
    const colRol = CC_COLOR_ROL[rol] || '#8b949e';
    // 🎨 El color de la BURBUJA es el de la PERSONA; el de la píldora sigue
    // siendo el del CARGO. Son dos preguntas distintas —quién lo dice y desde
    // qué puesto— y mezclarlas en un solo color perdía una de las dos.
    const col = mio ? CC_COLOR_MIO : _ccColorDe(m.senderUid);
    const nombre = _ccNombreCorto(m);
    const hora = (() => {
        const d = new Date(m.createdAt);
        return isNaN(d.getTime()) ? '' : d.toLocaleString('es-ES',
            { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    })();

    // 🔑 El borrado se ofrece SÓLO sobre lo propio, igual que lo permite la
    // regla. El administrador del club no borra mensajes ajenos uno a uno: para
    // eso tiene el vaciado del canal, que es una acción consciente y anunciada.
    const puedeBorrar = mio;

    // La inicial en un círculo del color de la persona. Es lo que de verdad
    // hace escaneable una conversación de varios: el ojo la encuentra antes que
    // el nombre escrito.
    const avatar = `
        <div style="width:26px;height:26px;border-radius:50%;flex-shrink:0;
                    background:${col}26;border:1.5px solid ${col}80;color:${col};
                    display:flex;align-items:center;justify-content:center;
                    font-size:0.7rem;font-weight:800;text-transform:uppercase;"
             title="${_ccEsc(nombre + ' · ' + etiq)}">${_ccEsc(nombre.charAt(0))}</div>`;

    const cabecera = `
        <div style="display:flex;align-items:center;gap:6px;font-size:0.68rem;
                    color:var(--text-muted);flex-wrap:wrap;
                    justify-content:${mio ? 'flex-end' : 'flex-start'};">
            <strong style="color:${col};">${_ccEsc(nombre)}</strong>
            <span style="background:${colRol}1f;border:1px solid ${colRol}59;color:${colRol};
                         border-radius:999px;padding:0 6px;font-size:0.6rem;font-weight:800;">
                ${_ccEsc(etiq.toUpperCase())}</span>
            <span>${hora}</span>
            ${puedeBorrar ? `<button onclick="ccBorrarMensaje('${_ccEsc(m.id)}')"
                title="Borrar este mensaje mío para todo el canal"
                style="background:none;border:none;color:#ff5858;cursor:pointer;
                       font-size:0.7rem;padding:0 2px;line-height:1;">🗑️</button>` : ''}
        </div>`;

    // 🔑 MÍO A LA DERECHA, DE LOS DEMÁS A LA IZQUIERDA (encargo). La fila entera
    // se invierte con `row-reverse` para que el avatar quede del lado de fuera
    // en los dos casos, y la esquina sin redondear apunta a quien habla.
    const radio = mio ? '14px 14px 4px 14px' : '14px 14px 14px 4px';

    return `
    <div style="display:flex;flex-direction:${mio ? 'row-reverse' : 'row'};
                align-items:flex-start;gap:8px;
                justify-content:${mio ? 'flex-end' : 'flex-start'};">
        ${avatar}
        <div style="display:flex;flex-direction:column;gap:3px;min-width:0;
                    max-width:min(80%,520px);align-items:${mio ? 'flex-end' : 'flex-start'};">
            ${cabecera}
            <div style="padding:0.55rem 0.8rem;border-radius:${radio};
                        background:${col}1a;border:1px solid ${col}4d;
                        border-${mio ? 'right' : 'left'}:3px solid ${col};
                        color:#e6edf3;font-size:0.87rem;line-height:1.45;
                        white-space:pre-wrap;word-break:break-word;">
                ${_ccEsc(m.text)}
            </div>
        </div>
    </div>`;
}

function _ccPintarMensajes() {
    const cont = document.getElementById('cc-messages');
    if (!cont) return;
    const yo = _ccYo();
    if (!yo) return;
    const soyAdmin = ccPuedeGestionar(yo);
    const msgs = window._ccState.mensajes || [];

    if (!msgs.length) {
        cont.innerHTML = `
        <div style="text-align:center;color:var(--text-muted);padding:3rem 1rem;font-size:0.85rem;">
            💬 Todavía no hay mensajes en el canal del club.<br>
            <span style="font-size:0.78rem;">Lo ven el administrador, el director deportivo,
            los coordinadores y todos los entrenadores.</span>
        </div>`;
        return;
    }

    // ⚠️ SE GUARDA SI ESTABA ABAJO **ANTES** DE REPINTAR. Con un oyente en vivo,
    // repintar y bajar siempre al final arrancaría el scroll de quien está
    // leyendo algo de más arriba cada vez que otro escribe.
    const pegadoAbajo = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 60;
    cont.innerHTML = msgs.map(m => _ccBurbuja(m, yo, soyAdmin)).join('');
    if (pegadoAbajo) cont.scrollTop = cont.scrollHeight;
}

// ════════════════════════════════════════════════════════════════════
//  ABRIR EL CANAL
// ════════════════════════════════════════════════════════════════════
//  `contenedorId` permite empotrarlo en el panel de mensajería unificado, que
//  es donde vive (una pestaña más), en vez de abrir una pantalla propia.
async function ccAbrirCanal(contenedorId) {
    // 🔑 SE RECUERDA EL CONTENEDOR: «Volver al canal» y el vaciado repintan
    // desde la pantalla de gestión, donde ya no se sabe dónde estaba empotrado
    // el canal. Sin esto volverían a un `cc-root` que en el panel unificado no
    // existe, y la pantalla se quedaría en blanco sin ningún error.
    const destino = contenedorId || window._ccState.contenedorId || 'cc-root';
    window._ccState.contenedorId = destino;
    const cont = document.getElementById(destino);
    if (!cont) return;
    const yo = _ccYo();

    if (!ccPuedeVerCanal(yo)) {
        cont.innerHTML = `
        <div style="text-align:center;padding:2.5rem 1rem;color:var(--text-muted);font-size:0.86rem;">
            🔒 El canal común del club es para el administrador, el director deportivo,
            los coordinadores y los entrenadores.
        </div>`;
        return;
    }

    const clubId = yo.clubId;
    window._ccState.clubId = clubId;
    // 🔐 v742 · El botón de gestión lo decide `ccPuedeGestionar`: administrador
    // o director, y SÓLO desde esa plaza. Ver su nota.
    const puedeGestionar = ccPuedeGestionar(yo);

    cont.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;min-height:0;">
        <div style="padding:0.7rem 1rem;background:#161b22;border-bottom:1px solid var(--glass-border);
                    display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;flex-shrink:0;">
            <div style="font-weight:700;color:#e6edf3;font-size:0.93rem;">💬 Canal del club</div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-right:auto;">
                Administrador · Director · Coordinadores · Entrenadores
            </div>
            ${puedeGestionar ? `
            <button onclick="ccAbrirGestion()" class="btn"
                style="padding:0.3rem 0.6rem;background:rgba(88,166,255,0.1);
                       border:1px solid rgba(88,166,255,0.3);border-radius:6px;
                       color:#58a6ff;font-size:0.7rem;font-weight:700;">⚙️ Gestionar</button>` : ''}
        </div>

        <div id="cc-messages" style="flex:1;overflow-y:auto;padding:1rem;display:flex;
             flex-direction:column;gap:0.7rem;min-height:0;">
            <p style="color:var(--text-muted);text-align:center;padding:2rem;font-size:0.85rem;">
                ⏳ Cargando el canal…</p>
        </div>

        <div id="cc-composer" style="padding:0.7rem 1rem;background:#161b22;
             border-top:1px solid var(--glass-border);flex-shrink:0;">
            <div style="display:flex;gap:0.6rem;align-items:flex-end;">
                <textarea id="cc-input" rows="2"
                    placeholder="Escribe al canal del club… (Enter para enviar, Shift+Enter para nueva línea)"
                    style="flex:1;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:8px;color:white;
                           font-size:0.88rem;resize:none;box-sizing:border-box;"
                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ccEnviar();}"></textarea>
                <button onclick="ccEnviar()" class="btn primary"
                    style="padding:0.6rem 1.1rem;flex-shrink:0;font-weight:700;">Enviar ›</button>
            </div>
        </div>
    </div>`;

    try {
        const { db, doc, getDoc, collection, query, where, orderBy, limit, onSnapshot } = await _ccFS();

        // ── La cabecera: expulsados y marca del último vaciado ──────────
        // ⚠️ Puede NO EXISTIR (club que nunca ha escrito): eso no es un error,
        // es el estado inicial. Nadie la crea hasta que el administrador
        // expulsa a alguien o vacía el canal.
        let expulsados = [];
        try {
            const cab = await getDoc(doc(db, CC_COL_CANAL, clubId));
            if (cab.exists()) expulsados = cab.data().expelledUids || [];
        } catch (_) { /* sin cabecera se entra: la barrera real son las reglas */ }
        window._ccState.expulsados = expulsados;

        if (expulsados.indexOf(yo.uid) !== -1) {
            cont.innerHTML = `
            <div style="text-align:center;padding:2.5rem 1rem;color:var(--text-muted);font-size:0.86rem;">
                🚫 El administrador del club te ha retirado el acceso al canal común.
            </div>`;
            return;
        }

        // ── 🪪 v741 · El censo de nombres, ANTES de escuchar ─────────────
        //  Va aquí y no dentro del oyente porque el primer snapshot llega de
        //  inmediato (a veces de la caché) y pintaría las burbujas con el
        //  correo antes de que el censo estuviera cargado. Si falla, no
        //  bloquea: `_ccNombreCorto` se queda con el nombre sellado.
        await _ccCargarDirectorio(clubId);

        // ── Los mensajes, EN VIVO ───────────────────────────────────────
        //  🔑 Éste es el único `onSnapshot` de toda la mensajería, y el canal lo
        //  justifica: un chat compartido que sólo se refresca al enviar no es un
        //  chat. Se piden los ÚLTIMOS `CC_TOPE` (orden descendente) y se le da
        //  la vuelta al pintar; así el coste de abrir no crece con la temporada.
        //
        //  ⚠️ `limit` SIN `orderBy` sería una ventana en lo MÁS VIEJO (lección
        //  de v508): el orden va SIEMPRE, y descendente.
        _ccCortarOyente();
        const q = query(
            collection(db, CC_COL_MENSAJES),
            where('clubId', '==', clubId),
            orderBy('createdAt', 'desc'),
            limit(CC_TOPE)
        );
        window._ccState.unsub = onSnapshot(q, (snap) => {
            const out = [];
            snap.forEach(d => out.push({ id: d.id, ...d.data() }));
            out.reverse();                       // del más viejo al más nuevo
            window._ccState.mensajes = out;
            _ccPintarMensajes();
            // 🔴 v743 · LEÍDO HASTA AQUÍ. Va dentro del oyente y no sólo al
            // abrir: el canal es en vivo, así que lo que llega mientras se
            // está mirando TAMBIÉN está leído — marcarlo sólo en la apertura
            // haría que esos mensajes salieran como pendientes al salir.
            // El guardado en la nube va agrupado (ver `_ubGuardarDiferido`):
            // una conversación animada cuesta una escritura, no quince.
            if (out.length && typeof window.ubMarcarCanalLeido === 'function') {
                const ultimo = out[out.length - 1];
                window.ubMarcarCanalLeido(String((ultimo && ultimo.createdAt) || ''));
            }
        }, (err) => {
            // 🚨 UN `onSnapshot` SIN CALLBACK DE ERROR QUEDA MUERTO tras un
            // `permission-denied` y no vuelve a avisar (lección de v717). Aquí
            // además hay un caso muy probable: el índice compuesto todavía
            // construyéndose, o las reglas aún sin desplegar a producción.
            const c = document.getElementById('cc-messages');
            if (c) c.innerHTML = `
                <div style="text-align:center;color:#ff5858;padding:2rem 1rem;font-size:0.84rem;">
                    ⚠️ No se pudo abrir el canal: ${_ccEsc(err && err.message)}
                </div>`;
        });
    } catch (e) {
        cont.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">
            ⚠️ ${_ccEsc(e.message)}</div>`;
    }
}
window.ccAbrirCanal = ccAbrirCanal;

// ════════════════════════════════════════════════════════════════════
//  ENVIAR
// ════════════════════════════════════════════════════════════════════
async function ccEnviar() {
    const input = document.getElementById('cc-input');
    const text = (input && input.value || '').trim();
    if (!text) return;
    const yo = _ccYo();
    if (!yo || !ccPuedeVerCanal(yo)) return;

    try {
        const { db, collection, addDoc } = await _ccFS();
        // 🔑 `senderUid` tiene que ser QUIEN FIRMA y la regla lo exige: el canal
        // no tiene más identidad que ese campo. `senderName` y `senderRole` van
        // sellados en el mensaje —no se resuelven al leer— porque quien lo
        // escribió puede cambiar de rol, o dejar el club, y el mensaje de
        // entonces debe seguir diciendo quién lo dijo y con qué cargo.
        await addDoc(collection(db, CC_COL_MENSAJES), {
            clubId:     yo.clubId,
            senderUid:  yo.uid,
            // 🪪 v741 · EL NOMBRE REGISTRADO. Antes ponía `yo.name` primero, y
            // ese campo NO EXISTE en el usuario de sesión: la cadena caía
            // siempre al correo. Ver la nota de `_ccNombreDe`.
            senderName: _ccNombreDe(yo) || 'Miembro',
            senderRole: _ccRolFirma(yo),
            text:       text,
            createdAt:  new Date().toISOString(),
        });
        if (input) input.value = '';
        // No hace falta repintar: el oyente en vivo trae el mensaje de vuelta.
    } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ No se pudo enviar: ' + e.message, 4000);
    }
}
window.ccEnviar = ccEnviar;

// ════════════════════════════════════════════════════════════════════
//  BORRAR UN MENSAJE PROPIO
// ════════════════════════════════════════════════════════════════════
//  «Cada usuario puede borrar sus propios mensajes» (encargo). Es un borrado
//  REAL, no un ocultar: el mensaje desaparece para todo el canal. Se avisa en
//  la confirmación, que es la diferencia que este proyecto ya pagó en v669
//  (un botón que prometía "Borrar Permanente" y sólo ocultaba).
async function ccBorrarMensaje(msgId) {
    if (!msgId) return;
    if (!confirm('¿Borrar este mensaje? Desaparecerá para todos los miembros del canal.')) return;
    try {
        const { db, doc, deleteDoc } = await _ccFS();
        await deleteDoc(doc(db, CC_COL_MENSAJES, msgId));
    } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ No se pudo borrar: ' + e.message, 4000);
    }
}
window.ccBorrarMensaje = ccBorrarMensaje;

// ════════════════════════════════════════════════════════════════════
//  GESTIÓN DEL CANAL (administrador del club y director): expulsar y vaciar
// ════════════════════════════════════════════════════════════════════
//  🚨 LAS TRES FUNCIONES PREGUNTAN, NO SÓLO EL BOTÓN. Esconder «Gestionar» no
//  cierra nada: `ccAbrirGestion()`, `ccCambiarAcceso()` y `ccVaciarCanal()`
//  están publicadas en `window` y se invocan desde la consola en dos palabras.
//  El encargo dice «ni estar accesible bajo ningún concepto», y ese «ningún
//  concepto» son estas tres puertas — más las reglas de Firestore, que son la
//  única barrera de verdad (las tres de aquí las quita cualquiera con F12).
async function ccAbrirGestion() {
    const yo = _ccYo();
    if (!ccPuedeGestionar(yo)) return;
    const cont = document.getElementById('cc-messages');
    if (!cont) return;

    cont.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:2rem;
        font-size:0.85rem;">⏳ Cargando los miembros del canal…</p>`;

    try {
        const { db, collection, query, where, getDocs } = await _ccFS();
        // Los miembros del canal son los técnicos del club: se leen de `users`
        // por clubId y se filtran por la MISMA lista blanca de roles que usan
        // las reglas. No hay lista de miembros que mantener.
        const snap = await getDocs(query(collection(db, 'users'),
            where('clubId', '==', yo.clubId)));
        const miembros = [];
        snap.forEach(d => {
            const u = { uid: d.id, ...d.data() };
            if (CC_ROLES.indexOf(_ccRolDe(u)) === -1) return;
            if (u.isAuthorized !== true) return;
            miembros.push(u);
        });
        miembros.sort((a, b) => _ccNombreDe(a).localeCompare(_ccNombreDe(b)));

        const exp = window._ccState.expulsados || [];
        cont.innerHTML = `
        <div style="padding:0.2rem 0.2rem 1rem;">
            <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.8rem;">
                <button onclick="ccAbrirCanal('${_ccEsc(window._ccState.contenedorId || 'cc-root')}')" class="btn"
                    style="padding:0.3rem 0.6rem;background:rgba(255,255,255,0.06);
                           border:1px solid var(--glass-border);border-radius:6px;
                           color:var(--primary);font-size:0.72rem;font-weight:700;">← Volver al canal</button>
                <div style="font-weight:700;color:#e6edf3;font-size:0.88rem;">Miembros del canal</div>
            </div>
            <div style="font-size:0.74rem;color:var(--text-muted);margin-bottom:0.8rem;">
                Entran automáticamente al ser registrados en el club. Aquí sólo se
                retira o se devuelve el acceso.
            </div>
            ${miembros.map(u => {
                const fuera = exp.indexOf(u.uid) !== -1;
                const rol = _ccRolDe(u);
                return `
                <div style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0.2rem;
                            border-bottom:1px solid rgba(255,255,255,0.05);opacity:${fuera ? '0.55' : '1'};">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:0.85rem;color:#e6edf3;font-weight:600;">
                            ${_ccEsc(_ccNombreDe(u) || 'Miembro')}
                            <span style="font-weight:500;color:var(--text-muted);">
                                · ${_ccEsc(CC_ETIQUETA_ROL[rol] || rol)}</span></div>
                        <div style="font-size:0.7rem;color:var(--text-muted);">
                            ${_ccEsc(u.email || '')}${fuera ? ' · sin acceso al canal' : ''}</div>
                    </div>
                    ${u.uid === yo.uid ? '<span style="font-size:0.68rem;color:var(--text-muted);">tú</span>' :
                      // 🛡️ AL ADMINISTRADOR DEL CLUB NO SE LE EXPULSA, y ahora hace
                      // falta decirlo: desde v742 el director también gestiona, así
                      // que podría echar del canal al administrador… que se quedaría
                      // SIN NINGUNA FORMA DE VOLVER, porque la pantalla del expulsado
                      // se pinta antes que el botón de gestión. Un estado del que no
                      // se sale no puede ofrecerse con un clic.
                      ccEsAdminDelClub(u) ? '<span style="font-size:0.68rem;color:var(--text-muted);">administrador</span>' : `
                    <button onclick="ccCambiarAcceso('${_ccEsc(u.uid)}', ${fuera ? 'false' : 'true'})"
                        style="padding:0.3rem 0.6rem;border-radius:6px;cursor:pointer;font-size:0.7rem;font-weight:700;
                               background:${fuera ? 'rgba(63,185,80,0.12)' : 'rgba(255,88,88,0.1)'};
                               border:1px solid ${fuera ? 'rgba(63,185,80,0.35)' : 'rgba(255,88,88,0.3)'};
                               color:${fuera ? '#3fb950' : '#ff5858'};">
                        ${fuera ? 'Devolver acceso' : 'Expulsar'}</button>`}
                </div>`;
            }).join('')}
            <div style="margin-top:1.2rem;padding-top:0.9rem;border-top:1px solid var(--glass-border);">
                <button onclick="ccVaciarCanal()"
                    style="padding:0.45rem 0.8rem;border-radius:7px;cursor:pointer;font-size:0.74rem;
                           font-weight:700;background:rgba(218,54,51,0.15);
                           border:1px solid rgba(218,54,51,0.5);color:#ff7b72;">
                    🧹 Vaciar el histórico del canal (fin de temporada)</button>
                <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.4rem;">
                    Borra todos los mensajes del canal para todo el mundo. No se puede deshacer.
                </div>
            </div>
        </div>`;
    } catch (e) {
        cont.innerHTML = `<div style="text-align:center;color:#ff5858;padding:2rem;">
            ⚠️ ${_ccEsc(e.message)}</div>`;
    }
}
window.ccAbrirGestion = ccAbrirGestion;

// Expulsar / devolver el acceso. Se escribe con `merge` para no pisar la marca
// del último vaciado si la cabecera ya existía.
async function ccCambiarAcceso(uid, expulsar) {
    const yo = _ccYo();
    if (!ccPuedeGestionar(yo) || !uid) return;
    try {
        const { db, doc, setDoc } = await _ccFS();
        const exp = (window._ccState.expulsados || []).slice();
        const i = exp.indexOf(uid);
        if (expulsar && i === -1) exp.push(uid);
        if (!expulsar && i !== -1) exp.splice(i, 1);
        await setDoc(doc(db, CC_COL_CANAL, yo.clubId),
            { clubId: yo.clubId, expelledUids: exp, updatedAt: new Date().toISOString() },
            { merge: true });
        window._ccState.expulsados = exp;
        if (typeof showToast === 'function') {
            showToast(expulsar ? '🚫 Acceso retirado' : '✅ Acceso devuelto', 2500);
        }
        await ccAbrirGestion();
    } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ No se pudo guardar: ' + e.message, 4000);
    }
}
window.ccCambiarAcceso = ccCambiarAcceso;

// Vaciado de fin de temporada, en manos del administrador del club y del
// director deportivo (v742).
// ⚠️ La consulta va ACOTADA POR clubId, como todas las de season-reset.js: sin
// acotar borraría el canal de OTROS clubes, y esto no tiene deshacer.
async function ccVaciarCanal() {
    const yo = _ccYo();
    if (!ccPuedeGestionar(yo)) return;
    if (!confirm('¿Vaciar el histórico del canal del club?\n\n' +
                 'Se borrarán TODOS los mensajes para todos los miembros. No se puede deshacer.')) return;
    try {
        const { db, collection, query, where, getDocs, doc, deleteDoc, setDoc } = await _ccFS();
        const snap = await getDocs(query(collection(db, CC_COL_MENSAJES),
            where('clubId', '==', yo.clubId)));
        let n = 0;
        for (const d of snap.docs) {
            try { await deleteDoc(doc(db, CC_COL_MENSAJES, d.id)); n++; } catch (_) {}
        }
        await setDoc(doc(db, CC_COL_CANAL, yo.clubId),
            { clubId: yo.clubId, clearedAt: new Date().toISOString(), clearedBy: yo.uid },
            { merge: true });
        if (typeof showToast === 'function') showToast(`🧹 Canal vaciado (${n} mensajes)`, 3000);
        await ccAbrirCanal(window._ccState.contenedorId || 'cc-root');
    } catch (e) {
        if (typeof showToast === 'function') showToast('⚠️ No se pudo vaciar: ' + e.message, 4000);
    }
}
window.ccVaciarCanal = ccVaciarCanal;
