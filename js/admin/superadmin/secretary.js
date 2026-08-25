// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/secretary.js
//  Pestaña "Secretaría" — envío de invitaciones por email/WhatsApp
//  (saSecretary, saToggleMethod, saUpdateInviteTemplate,
//  saResetInviteTemplate, saGuardarPlantilla, saCopiarEnlace,
//  saSendInvite, saSendInviteEmail, saSendInviteWhatsApp,
//  _limpiarFormularioSecretaria).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-25. Depende de helpers ya
//  definidos por superadmin.panel.js (saFS, _saShowSpinner/_saHideSpinner/
//  _saToast), que debe cargarse ANTES que este archivo.
//  Cubierto por scripts/test_sa_secretary_module.js.
// ════════════════════════════════════════════════════════════════════
//
// ════════════════════════════════════════════════════════════════════
//  🔴 v594 · LOS TRES ENCARGOS DEL AUTOR (implementar.txt, 2026-08-20)
//
//  1) "Error de conexión con el servidor" al enviar desde Dirección.
//     🔑🔑🔑 NO ERA UN ERROR DE CONEXIÓN. La Cloud Function sendInviteEmail
//     sólo dejaba pasar a `superadmin`/`admin` (functions/index.js), así que
//     al Director le devolvía permission-denied. MEDIDO en los registros de
//     producción, no deducido: sus dos pruebas de hoy salen con
//     `auth: VALID` y `status code 403`. v590 le dio la PANTALLA al Director
//     y nadie abrió la PUERTA del servidor.
//     ⚠️ Y el cliente etiquetaba cualquier excepción como "error de
//     conexión", que manda a mirar la red cuando el problema es un permiso.
//     Es el mismo defecto de diagnóstico de v568. Ahora se traduce el
//     código real (`permission-denied`, `unauthenticated`, `unavailable`…).
//
//  2) El enlace de la app, visible y copiable.
//     🔑 Al abrirlo salió un defecto que él NO había reportado: el enlace se
//     construía en DOS sitios y no era el mismo. El cliente ponía
//     `?invite=true` (que sólo salta el onboarding) y la Function
//     `?register=true&role=…&clubName=…` (que además DEJA AL INVITADO EN EL
//     FORMULARIO DE ALTA, relleno). Al invitado por WhatsApp se le mandaba
//     el flojo. Ahora los tres caminos usan `cronosInviteUrl` (utils.js).
//
//  3) Mensaje editable y guardable por el club.
//     🔑🔑 UNA PLANTILLA CON EL NOMBRE DEL DESTINATARIO DENTRO NO SIRVE PARA
//     "futuras invitaciones": la siguiente saludaría a Ana llamándose Luis.
//     Por eso lo que se edita y se guarda es una PLANTILLA CON MARCAS
//     ({nombre}, {rol}, {club}, {enlace}) y debajo se enseña la vista previa
//     ya sustituida, que es literalmente lo que va a salir.
//     ⚠️ Esto cambia a propósito el modelo que fijaban las aserciones 4a/4c/
//     5b del guard: antes el textarea llevaba el texto FINAL. El guard se
//     actualizó para comprobar lo mismo sobre la vista previa.
//     La firma por defecto ya NO es "El Equipo de Chronos Fútbol" cuando
//     invita un club: firma la dirección deportiva de ESE club.
//
//  DÓNDE SE GUARDA: `clubs/{clubId}.inviteTemplate` — es del CLUB, no de la
//  persona, así que sobrevive a un cambio de director. Requirió añadir esa
//  clave al `hasOnly` de `isClubConfigOnlyUpdate()` en firestore.rules.
//  El SuperAdmin no tiene club: la suya se guarda en este navegador y se
//  dice en pantalla, para no inventar una colección nueva por un solo caso.
// ════════════════════════════════════════════════════════════════════

window.CRONOS_SECRETARIA_ROLES = {
    individual:       '👤 Entrenador Individual',
    individual_admin: '🛡️ Administrador Individual',
    club_admin:       '🏟️ Administrador de Club',
    user:             '⚽ Entrenador',
    parent:           '👨‍👩‍👧 Padre/Madre/Tutor',
    director:         '📋 Director Deportivo',
    coordinator:      '🎯 Coordinador',
};
// Lo que un Director puede invitar A SU club. Deliberadamente sin
// `club_admin`, `individual` ni `individual_admin`.
window.CRONOS_SECRETARIA_ROLES_DIRECTOR = ['user', 'coordinator', 'parent'];

// ═══════════════════════════════════════════════════════════════════
// saSecretary() — Pestaña de Secretaría
// ═══════════════════════════════════════════════════════════════════
//  🔑 v590 · TAMBIÉN PARA EL DIRECTOR DEPORTIVO, sin duplicar el módulo.
//  Se parametriza lo único que cambia: `contenedorId`, `roles`, `club`,
//  `clubId` (v594, para guardar la plantilla) y `clubFijo` (v594: el
//  Director no puede cambiar el club, porque el servidor le impone el suyo
//  y un campo editable prometería algo que no se va a cumplir).
//  Sin argumentos se comporta EXACTAMENTE como siempre.
window.saSecretary = async function saSecretary(opciones) {
    const _opts = opciones || {};
    const body = document.getElementById(_opts.contenedorId || 'sa-body');
    if (!body) return;
    // ⚠️ EL CATÁLOGO SE RESUELVE CON RESPALDO. `test_sa_secretary_module.js`
    //    ejecuta ESTA función aislada, en un sandbox donde las constantes de
    //    fuera del bloque no existen: leerlas a pelo la reventaba con
    //    "Cannot convert undefined or null to object". Y no es sólo cosa del
    //    guard —es la misma clase de fallo que un orden de <script> distinto—,
    //    así que el respaldo se queda.
    const _CAT = (typeof window !== 'undefined' && window.CRONOS_SECRETARIA_ROLES) || {
        individual:       '👤 Entrenador Individual',
        individual_admin: '🛡️ Administrador Individual',
        club_admin:       '🏟️ Administrador de Club',
        user:             '⚽ Entrenador',
        parent:           '👨‍👩‍👧 Padre/Madre/Tutor',
        director:         '📋 Director Deportivo',
        coordinator:      '🎯 Coordinador',
    };
    const _rolesVisibles = Array.isArray(_opts.roles) && _opts.roles.length
        ? _opts.roles
        : Object.keys(_CAT);
    const _opcionesRol = _rolesVisibles
        .filter(r => _CAT[r])
        .map(r => '<option value="' + r + '">' + _CAT[r] + '</option>')
        .join('');
    const _clubPrefijado = String(_opts.club || '');
    const _clubFijo = !!_opts.clubFijo;

    window._secCtx = {
        clubId:   String(_opts.clubId || ''),
        clubName: _clubPrefijado,
        clubFijo: _clubFijo,
    };

    body.innerHTML = `
    <div style="max-width:600px;">
        <h3 style="margin:0 0 1rem;font-size:1rem;color:white;">✉️ Secretaría</h3>
        <p style="font-size:0.8rem;color:#8b949e;margin:0 0 1.2rem;">
            Envía invitaciones personalizadas a futuros usuarios para registrarse en la plataforma mediante Correo o WhatsApp.
        </p>
        <div style="display:flex;flex-direction:column;gap:0.8rem;">
            <!-- Método de envío -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:6px;">Método de envío</label>
                <div style="display:flex;gap:1.5rem;margin-bottom:4px;">
                    <label style="display:flex;align-items:center;gap:0.45rem;color:white;font-size:0.85rem;cursor:pointer;font-weight:600;">
                        <input type="radio" name="sec-method" value="email" checked onchange="window.saToggleMethod('email')" style="cursor:pointer;width:16px;height:16px;">
                        ✉️ Correo electrónico
                    </label>
                    <label style="display:flex;align-items:center;gap:0.45rem;color:white;font-size:0.85rem;cursor:pointer;font-weight:600;">
                        <input type="radio" name="sec-method" value="whatsapp" onchange="window.saToggleMethod('whatsapp')" style="cursor:pointer;width:16px;height:16px;">
                        💬 WhatsApp
                    </label>
                </div>
            </div>

            <!-- Nombre del destinatario -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del destinatario *</label>
                <input id="sec-name" type="text" placeholder="Ej: José Alberto" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Email de destino -->
            <div id="sec-email-block">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email de destino *</label>
                <input id="sec-email" type="email" placeholder="usuario@email.com" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Teléfono de destino (WhatsApp) -->
            <div id="sec-phone-block" style="display:none;">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Teléfono de destino *</label>
                <input id="sec-phone" type="tel" placeholder="Ej: 34600112233" oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
                <span style="font-size:0.68rem;color:#8b949e;margin-top:2px;display:block;">Incluye el código de país (ej. 34 para España) sin el signo + ni espacios.</span>
            </div>

            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Rol asignado</label>
                <select id="sec-role" onchange="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
                    ${_opcionesRol}
                </select>
            </div>

            <!-- Nombre del Club -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">
                    Nombre del Club${_clubFijo ? '' : ' (opcional)'}
                </label>
                <input id="sec-club" type="text" value="${_clubPrefijado}" placeholder="Nombre del club si aplica"
                    ${_clubFijo ? 'readonly' : ''} oninput="window.saUpdateInviteTemplate()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,${_clubFijo ? '0.02' : '0.05'});
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:${_clubFijo ? '#8b949e' : 'white'};font-size:0.9rem;box-sizing:border-box;">
                ${_clubFijo ? `<span style="font-size:0.68rem;color:#8b949e;margin-top:2px;display:block;">
                    Solo puedes invitar a tu club. El servidor lo comprueba, así que este campo no se puede cambiar.
                </span>` : ''}
            </div>

            <!-- ══════════════════════════════════════════════════════
                 🔗 v594 · EL ENLACE, A LA VISTA Y COPIABLE
                 Peticion del autor: poder mandarlo por su cuenta (WhatsApp,
                 redes) sin pasar por el formulario de envio. Se actualiza
                 solo al cambiar email/rol/club, porque el enlace LOS LLEVA
                 dentro: enseñar uno viejo seria peor que no enseñar ninguno.
                 ══════════════════════════════════════════════════════ -->
            <div>
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">
                    🔗 Enlace de invitación (listo para copiar)
                </label>
                <div style="display:flex;gap:0.4rem;align-items:stretch;">
                    <input id="sec-link" type="text" readonly onclick="this.select()"
                        style="flex:1;min-width:0;padding:0.7rem;background:rgba(88,166,255,0.06);
                               border:1px solid rgba(88,166,255,0.3);border-radius:8px;
                               color:#58a6ff;font-size:0.78rem;box-sizing:border-box;
                               font-family:monospace;text-overflow:ellipsis;">
                    <button onclick="window.saCopiarEnlace()" title="Copiar el enlace al portapapeles"
                        style="padding:0.7rem 0.9rem;background:rgba(88,166,255,0.12);
                               border:1px solid rgba(88,166,255,0.35);border-radius:8px;
                               color:#58a6ff;font-size:0.8rem;font-weight:700;cursor:pointer;white-space:nowrap;">
                        📋 Copiar
                    </button>
                </div>
                <span style="font-size:0.68rem;color:#8b949e;margin-top:3px;display:block;">
                    Lleva dentro el correo, el rol y el club: quien lo abra aterriza en el alta con todo relleno.
                </span>
            </div>

            <!-- Asunto (Email) -->
            <div id="sec-subject-block">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Asunto</label>
                <input id="sec-subject" type="text" value="Invitación a Chronos Fútbol"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;">
            </div>

            <!-- Mensaje Personalizado -->
            <div>
                <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:4px;flex-wrap:wrap;">
                    <label style="font-size:0.78rem;color:#8b949e;flex:1;min-width:140px;">Mensaje de la invitación</label>
                    <button onclick="window.saGuardarPlantilla()" id="sec-save-btn"
                        style="background:rgba(63,185,80,0.12);border:1px solid rgba(63,185,80,0.35);
                               color:#3fb950;font-size:0.68rem;cursor:pointer;font-weight:700;
                               padding:0.3rem 0.6rem;border-radius:6px;">
                        💾 Guardar plantilla
                    </button>
                    <button onclick="window.saResetInviteTemplate()"
                        style="background:none;border:none;color:#58a6ff;font-size:0.68rem;cursor:pointer;font-weight:700;padding:0;">
                        🔄 Restablecer
                    </button>
                </div>
                <textarea id="sec-body" rows="9" oninput="window.saOnBodyInput()"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);
                           border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                           color:white;font-size:0.9rem;box-sizing:border-box;resize:vertical;font-family:Inter,sans-serif;"></textarea>
                <span style="font-size:0.68rem;color:#8b949e;margin-top:3px;display:block;">
                    Escribe lo que quieras. Estas marcas se sustituyen solas al enviar:
                    <code style="color:#d2a8ff;">{nombre}</code>
                    <code style="color:#d2a8ff;">{rol}</code>
                    <code style="color:#d2a8ff;">{club}</code>
                    <code style="color:#d2a8ff;">{enlace}</code>
                </span>
            </div>

            <!-- Vista previa: lo que va a salir de verdad -->
            <details id="sec-preview-wrap" open
                style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.6rem 0.8rem;">
                <summary style="font-size:0.74rem;color:#8b949e;cursor:pointer;font-weight:600;">
                    👁 Vista previa — así lo recibirá el destinatario
                </summary>
                <pre id="sec-preview"
                    style="margin:0.6rem 0 0;white-space:pre-wrap;word-break:break-word;
                           font-family:Inter,sans-serif;font-size:0.8rem;color:#c9d1d9;line-height:1.5;"></pre>
            </details>

            <!-- Botón de Envío -->
            <button onclick="window.saSendInvite()"
                style="margin-top:0.5rem;padding:0.8rem;background:#58a6ff;border:none;
                       border-radius:8px;color:#0a0e14;font-weight:700;font-size:0.95rem;
                       cursor:pointer;width:100%;display:flex;align-items:center;justify-content:center;gap:0.5rem;">
                <span id="sec-btn-text">✉️ Enviar Invitación por Email</span>
            </button>
        </div>
    </div>`;

    // Inicializar plantillas (con la guardada del club, si la hay)
    setTimeout(() => {
        window.saCargarPlantillaGuardada?.();
        window.saUpdateInviteTemplate();
    }, 100);
};

// ════════════════════════════════════════════════════════════════════
//  ⚠️ ESTOS AYUDANTES VAN AQUÍ, DEBAJO DE saSecretary, Y NO ARRIBA.
//  scripts/test_sa_secretary_module.js ejecuta este módulo CORTANDO el
//  fichero desde `window.saSecretary = async function` hasta el final: todo
//  lo que quede por encima de esa línea no existe para él, y el módulo
//  reventaba con "secPlantillaFabrica is not a function". Es la misma
//  trampa que ya documenta la nota del `_CAT` dentro de saSecretary.
//  En el navegador el orden da igual: son asignaciones que se ejecutan al
//  cargar y sólo se invocan desde manejadores de eventos.
// ════════════════════════════════════════════════════════════════════
// Contexto de la pantalla: quién la abrió y con qué club. Se rellena en
// saSecretary y lo consultan el guardado y la carga de la plantilla.
window._secCtx = window._secCtx || { clubId: '', clubName: '', clubFijo: false };

// Clave de respaldo local (SuperAdmin, o club sin permiso de escritura).
const _SEC_LS_KEY = 'cronos_invite_template';

// ── Sustitución de marcas ───────────────────────────────────────────
// Función PURA. Las marcas se aceptan con o sin espacios ({ nombre }) para
// que una plantilla escrita a mano no falle por un espacio de más.
window.secRenderPlantilla = function(plantilla, datos) {
    const d = datos || {};
    const val = {
        nombre: d.nombre || '[Nombre]',
        rol:    d.rol    || 'Usuario',
        club:   d.club   || '',
        enlace: d.enlace || '',
    };
    return String(plantilla == null ? '' : plantilla)
        .replace(/\{\s*(nombre|rol|club|enlace)\s*\}/gi, (m, clave) => val[String(clave).toLowerCase()]);
};

// Datos actuales del formulario, ya resueltos.
function _secDatosActuales() {
    const roleVal = document.getElementById('sec-role')?.value || 'individual';
    const roleLabels = {
        individual: 'Entrenador Individual',
        individual_admin: 'Administrador Individual',
        club_admin: 'Administrador de Club',
        user: 'Entrenador',
        parent: 'Padre/Madre/Tutor',
        director: 'Director Deportivo',
        coordinator: 'Coordinador',
    };
    const email = document.getElementById('sec-email')?.value.trim() || '';
    const club  = document.getElementById('sec-club')?.value.trim() || '';
    // 🔑 UN SOLO CONSTRUCTOR DEL ENLACE (utils.js). El respaldo de aquí abajo
    // existe porque el guard ejecuta este archivo en un sandbox sin utils.js
    // cargado — y porque un orden de <script> distinto tiene el mismo efecto.
    const enlace = (typeof window.cronosInviteUrl === 'function')
        ? window.cronosInviteUrl({ email: email, role: roleVal, clubName: club })
        : ('https://cronos-futbol-app.web.app/?register=true' +
           (email ? '&email=' + encodeURIComponent(email) : '') +
           (roleVal ? '&role=' + encodeURIComponent(roleVal) : '') +
           (club ? '&clubName=' + encodeURIComponent(club) : ''));
    return {
        nombre: document.getElementById('sec-name')?.value.trim() || '',
        rol:    roleLabels[roleVal] || 'Usuario',
        club:   club,
        enlace: enlace,
    };
}

// ── Plantillas de fábrica, CON MARCAS ───────────────────────────────
// ⚠️ La firma depende de quién invita: un club firma como su dirección
// deportiva. Firmar siempre "El Equipo de Chronos Fútbol" era justo lo que
// el autor pidió quitar — hacía parecer que el correo lo manda el dueño de
// la plataforma y no su club.
window.secPlantillaFabrica = function(metodo, clubName) {
    const club = String(clubName || '').trim();
    const firma = club
        ? ('Un saludo,\nLa Dirección Deportiva de ' + club)
        : 'Atentamente,\nEl Equipo de Chronos Fútbol';
    if (metodo === 'whatsapp') {
        return '⚽ *Invitación a Chronos Fútbol* ⚽\n\n' +
               '¡Hola, *{nombre}*! Te invito a unirte a Chronos Fútbol como *{rol}*' +
               (club ? ' del club *' + club + '*' : '') + '.\n\n' +
               'Completa tu registro y accede a la app aquí:\n{enlace}\n\n' +
               '¡Un saludo!';
    }
    // ══════════════════════════════════════════════════════════════════
    //  ✉️ v630 · EL CUERPO DEL CORREO YA NO REPITE EL ENLACE
    //
    //  Encargo del autor (implementar.txt, 2026-08-25, punto 1): «elimina la
    //  línea de texto con el enlace suelto del primer párrafo. Deja el cuerpo
    //  del mensaje, seguido únicamente del botón principal de acción y, justo
    //  debajo, la frase de respaldo. De esta forma evitamos repeticiones».
    //
    //  🔑 Y ES QUE EL ENLACE APARECÍA TRES VECES. El HTML del correo
    //  (functions/index.js:1330) ya pone el botón «Completar Registro /
    //  Acceder» Y debajo «Si el botón no funciona, copia y pega este enlace».
    //  Meterlo además dentro del cuerpo era la tercera copia. Se quitan las dos
    //  líneas —la frase de entrada y el `🔗 {enlace}`— porque una sin la otra
    //  deja un «entra por este enlace:» apuntando a nada.
    //
    //  ⚠️ SÓLO EN EL CORREO. En WhatsApp NO hay botón ni frase de respaldo: ahí
    //  `{enlace}` es el ÚNICO camino y se queda donde está (arriba).
    // ══════════════════════════════════════════════════════════════════
    return 'Hola, {nombre}:\n\n' +
           'Te damos la bienvenida a Chronos Fútbol. Has sido invitado a unirte a nuestra plataforma como {rol}' +
           (club ? ' del club ' + club : '') + '.\n\n' +
           'Chronos Fútbol es una aplicación diseñada para el fútbol base: ayuda a que directiva, cuerpo técnico y familias ' +
           'compartan un mismo espacio de trabajo y disfruten al máximo de este deporte.\n\n' +
           'Pulsa el botón de abajo para completar tu registro: el correo, el rol y el club ya te vendrán rellenos ' +
           'y sólo tendrás que elegir tu contraseña.\n\n' +
           '¡Muchas gracias por tu implicación y bienvenido a bordo!\n\n' +
           firma;
};

// ════════════════════════════════════════════════════════════════════
//  ✉️ v630 · QUITAR EL ENLACE REPETIDO DE UNA PLANTILLA YA GUARDADA
//
//  Cambiar la plantilla de fábrica NO arregla a quien ya pulsó «Guardar
//  plantilla»: la suya vive en `clubs/{clubId}.inviteTemplate` (o en
//  localStorage para el SuperAdmin) y sigue trayendo el párrafo viejo. Y no se
//  le puede reescribir por las bravas: es SU texto.
//
//  🔑 Lo que sí es objetivo: en un correo, un `{enlace}` suelto en el cuerpo es
//  **por definición** una repetición, porque el botón y la frase de respaldo lo
//  llevan siempre. Así que en el método EMAIL se retira esa línea al componer
//  —y con ella la frase que la introducía, si termina en dos puntos, para no
//  dejar un «entra por este enlace:» huérfano—.
//
//  ⚠️ NO TOCA EL TEXTO GUARDADO, sólo lo que se manda y lo que se previsualiza,
//  y los dos pasan por aquí para que lo que ve sea exactamente lo que sale.
//  ⚠️ NO SE APLICA A WHATSAPP: allí `{enlace}` es el único camino.
// ════════════════════════════════════════════════════════════════════
window.secQuitarEnlaceRepetido = function (texto) {
    var lineas = String(texto == null ? '' : texto).split('\n');
    var fuera = [];
    for (var i = 0; i < lineas.length; i++) {
        var l = lineas[i];
        // ¿Es una línea cuyo ÚNICO contenido es el enlace? (admite el 🔗 y
        // cualquier adorno no alfanumérico delante).
        var soloEnlace = /^[^\p{L}\p{N}]*\{enlace\}[^\p{L}\p{N}]*$/u.test(l.trim()) && l.trim() !== '';
        if (!soloEnlace) { fuera.push(l); continue; }
        // Se quita también la frase que la presentaba: la última línea con
        // texto de las ya aceptadas, si acaba en ':'.
        for (var j = fuera.length - 1; j >= 0; j--) {
            if (fuera[j].trim() === '') continue;
            if (/:\s*$/.test(fuera[j])) fuera.splice(j, 1);
            break;
        }
    }
    // Se colapsan los huecos que dejan las líneas retiradas.
    return fuera.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

// ── Cargar la plantilla guardada del club (o la local del SuperAdmin) ──
// ⚠️ NUNCA BLOQUEA NI ROMPE LA PANTALLA: si la lectura falla o no hay nada
// guardado, se queda la de fábrica. Una Secretaría que no abre por no poder
// leer una preferencia sería mucho peor que una Secretaría sin preferencia.
window._secGuardadas = window._secGuardadas || null;
window.saCargarPlantillaGuardada = async function() {
    try {
        const ctx = window._secCtx || {};
        let guardadas = null;
        if (ctx.clubId && typeof window.saFS === 'function') {
            const { db, doc, getDoc } = await window.saFS();
            const snap = await getDoc(doc(db, 'clubs', ctx.clubId));
            if (snap && snap.exists()) guardadas = (snap.data() || {}).inviteTemplate || null;
        }
        if (!guardadas && typeof localStorage !== 'undefined') {
            try { guardadas = JSON.parse(localStorage.getItem(_SEC_LS_KEY) || 'null'); } catch (_) { guardadas = null; }
        }
        window._secGuardadas = guardadas || null;
        if (guardadas) window.saUpdateInviteTemplate();
    } catch (e) {
        if (window._CRONOS_DEBUG) console.warn('[Secretaría] plantilla guardada:', e.message);
    }
};

// Alternar entre Email y WhatsApp en la interfaz
window.saToggleMethod = function(method) {
    const emailBlock = document.getElementById('sec-email-block');
    const phoneBlock = document.getElementById('sec-phone-block');
    const subjectBlock = document.getElementById('sec-subject-block');
    const btnText = document.getElementById('sec-btn-text');

    if (method === 'email') {
        if (emailBlock) emailBlock.style.display = 'block';
        if (phoneBlock) phoneBlock.style.display = 'none';
        if (subjectBlock) subjectBlock.style.display = 'block';
        if (btnText) btnText.innerHTML = '✉️ Enviar Invitación por Email';
    } else {
        if (emailBlock) emailBlock.style.display = 'none';
        if (phoneBlock) phoneBlock.style.display = 'block';
        if (subjectBlock) subjectBlock.style.display = 'none';
        if (btnText) btnText.innerHTML = '💬 Enviar Invitación por WhatsApp';
    }

    const secBody = document.getElementById('sec-body');
    if (secBody && !secBody.classList.contains('user-edited')) {
        window.saUpdateInviteTemplate();
    } else {
        window.saUpdateInvitePreview();
    }
};

// Actualizar la PLANTILLA (sólo si el usuario no la ha tocado) y la vista previa.
window.saUpdateInviteTemplate = function() {
    const method = document.querySelector('input[name="sec-method"]:checked')?.value || 'email';
    const club   = document.getElementById('sec-club')?.value.trim() || '';
    const secBody = document.getElementById('sec-body');

    if (secBody && !secBody.classList.contains('user-edited')) {
        // Preferencia: lo guardado por el club > la plantilla de fábrica.
        const g = window._secGuardadas || null;
        const guardada = g && typeof g === 'object' ? g[method] : null;
        secBody.value = guardada || window.secPlantillaFabrica(method, club);
    }
    window.saUpdateInvitePreview();
};

// El usuario escribe en el mensaje: se marca como suyo para que ni un
// cambio de rol, ni de club, ni de método se lo pisen, y se repinta la
// vista previa. (Antes esto era un addEventListener dentro de un setTimeout;
// va en el `oninput` para que no dependa de que ese temporizador llegue.)
window.saOnBodyInput = function() {
    const secBody = document.getElementById('sec-body');
    if (secBody) secBody.classList.add('user-edited');
    window.saUpdateInvitePreview();
};

// Repinta la vista previa y el enlace visible con los datos de AHORA.
window.saUpdateInvitePreview = function() {
    const datos = _secDatosActuales();
    const link = document.getElementById('sec-link');
    if (link) link.value = datos.enlace;
    const secBody = document.getElementById('sec-body');
    const prev = document.getElementById('sec-preview');
    // ✉️ v630 · La vista previa pasa por el MISMO filtro que el envío. Si sólo
    // lo hiciera uno de los dos, lo que se ve no sería lo que sale — y eso es
    // peor que la repetición que se venía a quitar.
    if (prev) prev.textContent = window.secRenderPlantilla(
        _secCuerpoParaEnviar(secBody ? secBody.value : ''), datos);
};

// El cuerpo tal y como va a salir: en EMAIL, sin el enlace repetido.
function _secCuerpoParaEnviar(texto) {
    const metodo = document.querySelector('input[name="sec-method"]:checked')?.value || 'email';
    if (metodo !== 'email' || typeof window.secQuitarEnlaceRepetido !== 'function') return texto;
    return window.secQuitarEnlaceRepetido(texto);
}
window._secCuerpoParaEnviar = _secCuerpoParaEnviar;

// Restablecer el mensaje al predeterminado de fábrica
// ⚠️ Restablece a FÁBRICA, no a lo guardado: es la salida de emergencia
// cuando alguien ha dejado la plantilla del club inservible.
window.saResetInviteTemplate = function() {
    const secBody = document.getElementById('sec-body');
    if (secBody) {
        secBody.classList.remove('user-edited');
        const method = document.querySelector('input[name="sec-method"]:checked')?.value || 'email';
        const club   = document.getElementById('sec-club')?.value.trim() || '';
        secBody.value = window.secPlantillaFabrica(method, club);
        window.saUpdateInvitePreview();
        _saToast('🔄 Mensaje restablecido al predeterminado', 2500);
    }
};

// ── Guardar la plantilla para las próximas invitaciones ─────────────
window.saGuardarPlantilla = async function() {
    const secBody = document.getElementById('sec-body');
    const texto = secBody?.value.trim() || '';
    if (!texto) { _saToast('⚠️ El mensaje está vacío: no hay nada que guardar', 3000); return; }

    const method = document.querySelector('input[name="sec-method"]:checked')?.value || 'email';
    const ctx = window._secCtx || {};
    // Se conservan las DOS plantillas (correo y WhatsApp): guardar la de
    // correo no puede borrar la de WhatsApp.
    const previas = (window._secGuardadas && typeof window._secGuardadas === 'object')
        ? window._secGuardadas : {};
    const nuevas = Object.assign({}, previas);
    nuevas[method] = texto;

    // Respaldo local SIEMPRE, y primero: si la escritura en la nube falla,
    // su trabajo no se pierde.
    try { localStorage.setItem(_SEC_LS_KEY, JSON.stringify(nuevas)); } catch (_) { /* cuota/privado */ }
    window._secGuardadas = nuevas;

    if (!ctx.clubId) {
        _saToast('💾 Plantilla guardada en este navegador', 3500);
        return;
    }

    _saShowSpinner('Guardando la plantilla del club…');
    try {
        const { db, doc, updateDoc } = await window.saFS();
        // ⚠️ updateDoc con la clave ENTERA, no merge de subcampos: las reglas
        // comprueban `affectedKeys().hasOnly([... 'inviteTemplate'])`.
        await updateDoc(doc(db, 'clubs', ctx.clubId), { inviteTemplate: nuevas });
        _saHideSpinner();
        _saToast('✅ Plantilla guardada para tu club', 4000);
    } catch (e) {
        _saHideSpinner();
        console.warn('[Secretaría] no se pudo guardar en el club:', e);
        // 🔑 SE DICE LA VERDAD: quedó guardada aquí, no en el club. Un
        // "guardado" que miente es peor que un fallo (lección de v570).
        _saToast('⚠️ Guardada solo en este navegador: el servidor rechazó la escritura', 5000);
    }
};

// ── Copiar el enlace al portapapeles ────────────────────────────────
window.saCopiarEnlace = async function() {
    const link = document.getElementById('sec-link');
    const url = link?.value || '';
    if (!url) { _saToast('⚠️ Todavía no hay enlace que copiar', 2500); return; }
    try {
        // El API moderno sólo existe en contexto seguro y con permiso.
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
        } else {
            // Respaldo para navegadores/contextos sin Clipboard API.
            link.removeAttribute('readonly');
            link.select();
            document.execCommand('copy');
            link.setAttribute('readonly', 'readonly');
        }
        _saToast('📋 Enlace copiado al portapapeles', 2500);
    } catch (e) {
        // ⚠️ NO se deja al usuario sin salida: se selecciona para que copie
        // con Ctrl+C, y se le dice.
        try { link.select(); } catch (_) { /* sin foco */ }
        _saToast('⚠️ No se pudo copiar solo. Está seleccionado: pulsa Ctrl+C', 4500);
    }
};

// Enrutador de envío
window.saSendInvite = async function() {
    const method = document.querySelector('input[name="sec-method"]:checked')?.value || 'email';
    const name = document.getElementById('sec-name')?.value.trim();
    if (!name) { _saToast('⚠️ El nombre del destinatario es obligatorio', 3000); return; }

    if (method === 'email') {
        await window.saSendInviteEmail();
    } else {
        window.saSendInviteWhatsApp();
    }
};

// ── Traducir el fallo REAL del servidor ─────────────────────────────
// 🔑🔑🔑 ESTA FUNCIÓN ES LA MITAD DEL ENCARGO 1. Antes, CUALQUIER excepción
// se enseñaba como "Error de conexión con el servidor", y lo que de verdad
// pasaba era un permission-denied: mandaba a mirar el router cuando había
// que mirar los permisos. Mismo defecto de diagnóstico que costó v568.
window.secExplicarErrorEnvio = function(e) {
    const code = String((e && e.code) || '').replace('functions/', '');
    const MAPA = {
        'permission-denied': 'Tu cuenta no tiene permiso para enviar invitaciones desde el servidor.',
        'unauthenticated':   'Tu sesión ha caducado. Vuelve a entrar y reinténtalo.',
        'unavailable':       'No se ha podido contactar con el servidor. Comprueba tu conexión.',
        'deadline-exceeded': 'El servidor ha tardado demasiado en responder.',
        'not-found':         'La función de envío no está desplegada en el servidor.',
        'internal':          'El servidor ha fallado al procesar el envío.',
        'invalid-argument':  'Faltan datos obligatorios para el envío.',
    };
    return { code: code || 'desconocido',
             texto: MAPA[code] || ('Fallo inesperado del servidor' + (e && e.message ? ': ' + e.message : '') + '.') };
};

// Enviar email de invitación vía Cloud Function (con fallback a mailto local)
window.saSendInviteEmail = async function() {
    const to      = document.getElementById('sec-email')?.value.trim();
    const role    = document.getElementById('sec-role')?.value || 'individual';
    const clubName= document.getElementById('sec-club')?.value.trim() || '';
    const subject = document.getElementById('sec-subject')?.value.trim() || 'Invitación a Chronos Fútbol';
    // 🔑 SE ENVÍA LA PLANTILLA YA SUSTITUIDA, no las marcas: el servidor no
    // sabe nada de {nombre} y mandaría el correo con las llaves dentro.
    const datos   = _secDatosActuales();
    // ✉️ v630 · Sin el enlace repetido: el HTML del correo ya pone el botón y
    // la frase de respaldo (functions/index.js:1330). Ver secQuitarEnlaceRepetido.
    const body    = window.secRenderPlantilla(
        _secCuerpoParaEnviar(document.getElementById('sec-body')?.value || ''), datos).trim();

    if (!to) { _saToast('⚠️ El email de destino es obligatorio', 3000); return; }

    const _mailto = () => `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    _saShowSpinner('Enviando invitación por email...');
    try {
        const { fa, httpsCallable } = await saFS();
        if (!fa.functions) throw new Error('Firebase Functions no disponible. Recarga la página.');
        const sendEmail = httpsCallable(fa.functions, 'sendInviteEmail');
        const result = await sendEmail({ to, subject, body, role, clubName });
        _saHideSpinner();

        const d = result.data || {};

        if (d.success === true) {
            // ✅ Email enviado correctamente por el servidor
            _saToast('✅ Invitación enviada con éxito a ' + to, 5000);
            _limpiarFormularioSecretaria();
        } else if (d.noCredentials || d.error) {
            // ⚠️ El servidor no tiene credenciales configuradas o Nodemailer falló
            // → Usamos mailto automáticamente sin molestar al usuario con confirm()
            const motivo = d.noCredentials
                ? 'El servidor no tiene credenciales Gmail configuradas.'
                : 'Error del servidor: ' + d.error;
            console.warn('[saSendInviteEmail] Fallback a mailto. Motivo:', motivo);
            _saToast('📧 Abriendo tu correo local para enviar la invitación...', 4000);
            window.open(_mailto(), '_self');
            _limpiarFormularioSecretaria();
        } else {
            _saToast('⚠️ Respuesta inesperada del servidor. Revisa la consola.', 4000);
            console.warn('[saSendInviteEmail] Respuesta inesperada:', d);
        }
    } catch (e) {
        _saHideSpinner();
        const info = window.secExplicarErrorEnvio(e);
        console.error('[saSendInviteEmail] code=' + info.code, e);
        // ⚠️ SIN confirm(). Un diálogo modal para decir "no he podido" obliga a
        // contestar antes de poder seguir, y la salida (el correo local) es la
        // misma se conteste lo que se conteste. Se abre y se explica POR QUÉ.
        _saToast('⚠️ ' + info.texto + ' Abriendo tu correo local…', 6000);
        window.open(_mailto(), '_self');
        _limpiarFormularioSecretaria();
    }
};

// Helper: limpiar formulario de secretaría tras envío
// ⚠️ NO se toca `sec-body`: la plantilla (de fábrica o la guardada del club)
// tiene que seguir ahí para la siguiente invitación. Sólo se van los datos
// del destinatario, que son los que cambian.
function _limpiarFormularioSecretaria() {
    const fields = ['sec-email', 'sec-name', 'sec-phone'];
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    window.saUpdateInvitePreview?.();
}


// Enviar invitación vía WhatsApp Web/App
window.saSendInviteWhatsApp = function() {
    const phone = document.getElementById('sec-phone')?.value.trim();
    const datos = _secDatosActuales();
    const body  = window.secRenderPlantilla(
        document.getElementById('sec-body')?.value || '', datos).trim();

    if (!phone) { _saToast('⚠️ El teléfono de destino es obligatorio', 3000); return; }

    // Limpiar caracteres del número telefónico
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length < 7) { _saToast('⚠️ El número de teléfono no parece ser válido', 3000); return; }

    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(body)}`;
    window.open(waUrl, '_blank');
    _saToast('✅ Abriendo WhatsApp...', 3000);

    _limpiarFormularioSecretaria();
};
