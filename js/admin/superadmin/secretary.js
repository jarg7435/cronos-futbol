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

// ════════════════════════════════════════════════════════════════════
//  ⚽ v643 · EL ENTE, UNA SOLA ENTRADA: «Entrenador - Administrador Individual»
//
//  Encargo del autor (implementar.txt, 2026-08-28): unificar aquí la
//  nomenclatura del ente, que en el resto de la aplicación ya está unificada
//  desde la v598-v601 pero en este desplegable seguía partida en dos.
//
//  🔴 Y NO ERA COSMÉTICO. `individual_admin` NO EXISTE como opción en el
//  desplegable del alta (index.html sólo ofrece `value="individual"`, y la
//  nota de la v598 explica por qué: el valor que viaja a Firestore sigue
//  siendo ése). Así que invite-prefill.js hacía `sel.value = 'individual_admin'`,
//  el navegador dejaba el select VACÍO y la invitación llegaba **sin rol**:
//  el invitado tenía que adivinarlo. El mismo fallo que la v593 tuvo que
//  parchear con `coordinator`.
//
//  🔑 SE QUEDA LA CLAVE `individual`, que es la canónica. Cambiar la cadena
//  habría obligado a tocar reglas, recuentos de plazas y documentos ya
//  escritos — exactamente lo que la v598 decidió no hacer.
// ════════════════════════════════════════════════════════════════════
window.CRONOS_SECRETARIA_ROLES = {
    individual:       '⚽ Entrenador - Administrador Individual',
    club_admin:       '🏟️ Administrador de Club',
    user:             '⚽ Entrenador',
    parent:           '👨‍👩‍👧 Familiar / Jugador',
    director:         '📋 Director Deportivo',
    coordinator:      '🎯 Coordinador',
};
// Lo que un Director puede invitar A SU club. Deliberadamente sin
// `club_admin`, `individual` ni `individual_admin`.
window.CRONOS_SECRETARIA_ROLES_DIRECTOR = ['user', 'coordinator', 'parent'];

// ════════════════════════════════════════════════════════════════════
//  ✉️ v781 · LA SECRETARÍA TAMBIÉN EN EL ADMINISTRADOR DEL CLUB Y EN EL ENTE
//
//  Encargo del autor (implementar.txt, 2026-10-04, capturas 11041-11044): el
//  Administrador del Club no tenía Secretaría y la logística exige que pueda
//  invitar a su cuerpo técnico —directores, coordinadores y entrenadores—
//  para después reenviar esas altas al SuperAdmin desde ✅ Solicitudes.
//
//  · CLUB_ADMIN: su cuerpo técnico. Sin `parent` (las familias las invita
//    el Director, que es quien lleva los equipos) y sin `club_admin`.
//  · ENTE: SÓLO `parent`. 🔑 Bajo un ente el alta no admite otro rol
//    (auth.js, ROLES_BAJO_ENTE, decisión de la v598: el entrenador ES el
//    administrador). Ofrecer «Entrenador» o «Director» mandaría un enlace
//    que el formulario de alta no puede cumplir.
// ════════════════════════════════════════════════════════════════════
window.CRONOS_SECRETARIA_ROLES_CLUB_ADMIN = ['director', 'coordinator', 'user'];
window.CRONOS_SECRETARIA_ROLES_ENTE       = ['parent'];

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
        individual:       '⚽ Entrenador - Administrador Individual',
        club_admin:       '🏟️ Administrador de Club',
        user:             '⚽ Entrenador',
        parent:           '👨‍👩‍👧 Familiar / Jugador',
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
            Envía invitaciones personalizadas por correo a futuros usuarios para registrarse en la plataforma.
        </p>
        <div style="display:flex;flex-direction:column;gap:0.8rem;">
            <!-- v671 · AQUÍ ESTABA EL SELECTOR "Método de envío" (Correo /
                 WhatsApp). Con WhatsApp retirado de toda la app queda un solo
                 método, y un selector de una opción sólo estorba: se envía
                 por correo y punto. -->

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

            <!-- v671 · fuera el campo "Teléfono de destino": era exclusivo del
                 envío por WhatsApp y ya no se recogen números. -->

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
                    Pulsa 📋 para generarlo. Es de un solo uso y caduca a los 14 días: los datos
                    no viajan en la dirección, quien lo abra aterriza en el alta con todo relleno.
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
                <!-- ✍️ v784 · Aviso de plantilla guardada ANTERIOR a la de fábrica
                     actual: se muestra la nueva y se ofrece recuperar la suya. -->
                <div id="sec-aviso-antigua" style="display:none;"></div>
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

            <!-- ✉️ v782 · RESULTADO DEL ENVÍO. Cuando el servidor no manda el
                 correo (testeo, o un fallo real) aquí se dice POR QUÉ y se deja
                 el enlace listo para copiar. Sustituye al antiguo salto al
                 cliente de correo local (mailto), retirado a petición del autor. -->
            <div id="sec-resultado" style="display:none;"></div>
        </div>

        <!-- 🎁 v672 · PASES DE REGALO (js/admin/superadmin/gift-passes.js).
             ⚠️ El bloque DEVUELVE CADENA VACÍA para quien no sea
             SuperAdministrador, así que aquí se interpola sin condicional:
             esta misma pantalla la abre el Director Deportivo con su
             catálogo recortado, y un pase de regalo funda una entidad y
             regala la app entera — no es cosa suya.
             ⚠️ Y con guarda typeof: si el módulo no ha cargado, la
             Secretaría sigue funcionando entera y simplemente no ofrece
             regalos. Nunca a medias. -->
        ${(typeof window.cronosBloqueRegalos === 'function') ? window.cronosBloqueRegalos() : ''}
    </div>`;

    // Inicializar plantillas (con la guardada del club, si la hay)
    // ✍️ v784 · se olvida la de la apertura anterior (otro club u otro panel)
    // antes de pintar: la de este club la trae saCargarPlantillaGuardada.
    window._secGuardadas = null;
    window._secGuardadaAntigua = null;
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

// ✉️ v781 · Los roles que un panel puede invitar, quitando los que el club no
// tiene contratados. Mismo criterio que la Secretaría del Director (v596): un
// rol sin su extra crearía una plaza que luego no puede entrar, y se RETIRA
// del desplegable (un <option disabled> no se distingue en un móvil).
// `extraOn(clave)` lo pone quien llama: cada panel lee sus extras a su modo.
// ⚠️ Puede devolver una lista VACÍA y quien llama tiene que decirlo: caerse a
// 'user' sería invitar a un rol que ese panel no puede dar.
window.cronosSecretariaRoles = function (base, extraOn) {
    const mapa = window.CRONOS_ROL_EXTRA || {};
    const on = (typeof extraOn === 'function') ? extraOn : () => true;
    return (Array.isArray(base) ? base : []).filter(r => !mapa[r] || on(mapa[r]));
};

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

// ════════════════════════════════════════════════════════════════════
//  🎟️ v633 · EL ENLACE CON TOKEN OPACO
//
//  Lo que se ve mientras nadie ha pedido todavía un enlace. NO es una URL a
//  medias: si lo fuera, alguien la copiaría y mandaría un enlace roto.
// ════════════════════════════════════════════════════════════════════
const SEC_ENLACE_PENDIENTE = '(se genera al copiar o al enviar)';
window.SEC_ENLACE_PENDIENTE = SEC_ENLACE_PENDIENTE;

// Acuña —o reutiliza— la invitación para el estado ACTUAL del formulario.
// Reutilizar importa: sin caché, «Copiar» y luego «Enviar» dejarían dos
// invitaciones vivas para la misma persona, y sólo una se consumiría.
async function _secEnlaceReal() {
    const email   = document.getElementById('sec-email')?.value.trim() || '';
    const roleVal = document.getElementById('sec-role')?.value || 'individual';
    const club    = document.getElementById('sec-club')?.value.trim() || '';
    const clave   = email + '|' + roleVal + '|' + club;

    const cache = window._secTokenActual;
    if (cache && cache.clave === clave && cache.url) return cache.url;

    // ════════════════════════════════════════════════════════════════
    //  🔒 SEC-INV2 (Fase 0, 2026-09-22) · AQUÍ NO HAY RESPALDO. A PROPÓSITO.
    //
    //  Hasta hoy, si `cronosCrearInvitacion` no existía o fallaba, esta
    //  función CAÍA al enlace clásico: `?register=true&email=…&role=…&
    //  clubName=…`, con el correo de la familia EN CLARO dentro de la URL.
    //  Y una URL no se queda en el correo: va al historial del navegador, al
    //  registro del servidor de correo, a la cabecera `Referer`, a la captura
    //  de pantalla que alguien reenvía por un grupo. Ese enlace además NO
    //  CADUCABA y NO SE CONSUMÍA: valía para siempre y para quien lo tuviera.
    //
    //  🔑 EL RAZONAMIENTO DE v633 ESTABA DEL REVÉS. Decía: «sin el respaldo,
    //  un fallo de red dejaría a la Secretaría SIN PODER INVITAR A NADIE».
    //  Cierto — y esa es exactamente la conducta correcta. Un fallo al acuñar
    //  no es una emergencia: es esperar a que vuelva la red. Degradar convierte
    //  un problema de diez segundos en un dato personal publicado para siempre,
    //  y lo hace justo cuando nadie está mirando.
    //
    //  ⚠️ NO SE DEVUELVE UNA CADENA VACÍA NI null: se LANZA. Un valor de
    //  relleno se colaría dentro del `{enlace}` del correo y saldría un aviso
    //  interno —o una URL a medias— hacia una familia. Quien llama tiene que
    //  enterarse y parar; los dos caminos de salida (copiar y enviar) lo hacen.
    //
    //  Guard: scripts/test_invitacion_sin_degradar.js
    // ════════════════════════════════════════════════════════════════
    if (typeof window.cronosCrearInvitacion !== 'function') {
        throw new Error('El generador de invitaciones seguras no está cargado. Recarga la página.');
    }

    let inv;
    try {
        // ✉️ v781 · Con el `clubId`, no sólo el nombre. El alta casaba el club
        // ÚNICAMENTE por nombre contra la lista pública: dos clubes con el
        // mismo nombre —o una tilde de diferencia— mandaban al invitado al
        // club equivocado. invite-prefill.js busca primero por este id.
        inv = await window.cronosCrearInvitacion({
            email: email, role: roleVal, clubName: club,
            clubId: (window._secCtx && window._secCtx.clubId) || '',
        });
    } catch (e) {
        console.warn('[secretaría] no se pudo acuñar el token:', e && e.message);
        throw new Error('No se ha podido generar el enlace seguro de invitación. ' +
                        'Comprueba la conexión y vuelve a intentarlo.');
    }

    if (!inv || !inv.url || !inv.token) {
        throw new Error('El enlace seguro de invitación ha vuelto incompleto. Inténtalo de nuevo.');
    }

    window._secTokenActual = { clave: clave, url: inv.url, token: inv.token };
    return inv.url;
}
window._secEnlaceReal = _secEnlaceReal;

// Datos actuales del formulario, ya resueltos.
function _secDatosActuales() {
    const roleVal = document.getElementById('sec-role')?.value || 'individual';
    const roleLabels = {
        individual: 'Entrenador - Administrador Individual',
        // ⚠️ v643 · `individual_admin` YA NO SE OFRECE (ver la nota del
        //    catálogo), pero su etiqueta se queda: hay invitaciones ya
        //    enviadas con ese rol, y su correo tiene que seguir sabiendo
        //    sustituir {rol} por algo legible en vez de por la clave cruda.
        individual_admin: 'Entrenador - Administrador Individual',
        club_admin: 'Administrador de Club',
        user: 'Entrenador',
        parent: 'Familiar / Jugador',
        director: 'Director Deportivo',
        coordinator: 'Coordinador',
    };
    const email = document.getElementById('sec-email')?.value.trim() || '';
    const club  = document.getElementById('sec-club')?.value.trim() || '';
    // ════════════════════════════════════════════════════════════════
    //  🎟️ v633 · EL ENLACE YA NO SE FABRICA AQUÍ
    //
    //  Antes esta función construía la URL con el correo, el rol y el club EN
    //  CLARO. Ahora el enlace es `?invite=<token>` y vive en un documento, así
    //  que ACUÑARLO CUESTA UNA ESCRITURA.
    //
    //  🔑 Y ESTA FUNCIÓN CORRE EN CADA PULSACIÓN DE TECLA (`oninput` →
    //  saUpdateInvitePreview). Crear una invitación por tecla dejaría cientos
    //  de tokens vivos por cada envío: cada uno un enlace válido de verdad.
    //  Por eso aquí sólo se DEVUELVE lo que ya haya en la caché, y quien acuña
    //  es `_secEnlaceReal()`, al COPIAR o al ENVIAR.
    //
    //  ⚠️ El respaldo de abajo se conserva porque el guard ejecuta este archivo
    //  en un sandbox sin utils.js cargado.
    // ════════════════════════════════════════════════════════════════
    const clave  = email + '|' + roleVal + '|' + club;
    const cache  = window._secTokenActual;
    const enlace = (cache && cache.clave === clave && cache.url)
        ? cache.url
        : SEC_ENLACE_PENDIENTE;
    return {
        nombre: document.getElementById('sec-name')?.value.trim() || '',
        rol:    roleLabels[roleVal] || 'Usuario',
        club:   club,
        enlace: enlace,
    };
}

// ── Plantillas de fábrica, CON MARCAS ───────────────────────────────
// ════════════════════════════════════════════════════════════════════
//  ✍️ v783 · EL TEXTO EXACTO DEL AUTOR (implementar.txt, 2026-10-04,
//  capturas 11090-11092), con la marca en negrita (`**CHRONOS FÚTBOL**`)
//  y el club como MARCA (`{club}`), también en la firma: firma el club, sea
//  quien sea quien invita (Director, Administrador o ente).
//  · La negrita la pintan la vista previa (secNegritaHtml) y el correo
//    (functions/index.js, sendInviteEmail); el texto plano la quita.
//  · SIN CLUB (el SuperAdmin puede invitar sin él): no hay «del {club}» —
//    quedaría «del .»— y firma la plataforma.
//  ⚠️ Sustituye a la firma por invitante de v781 (`firmante`) y a la de
//    «La Dirección Deportiva de …» de v594: el autor pidió {club} para todos.
//  ⚠️ v784 · Una plantilla GUARDADA sólo manda si se guardó sobre ESTA
//    fábrica (SEC_FABRICA_VERSION, más abajo): si cambias este texto, SUBE
//    esa versión, o los clubes que guardaron la anterior no verán la nueva.
// ════════════════════════════════════════════════════════════════════
window.secPlantillaFabrica = function(metodo, clubName) {
    const conClub = !!String(clubName || '').trim();
    // v671 · aquí vivía la plantilla de WhatsApp. Retirada con el canal;
    // queda una sola plantilla, la del correo.
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
           'Te damos la bienvenida a **CHRONOS FÚTBOL**. Has sido invitado a unirte a nuestra plataforma como {rol}' +
           (conClub ? ' del {club}' : '') + '.\n\n' +
           '**CHRONOS FÚTBOL** es una aplicación diseñada especialmente para el fútbol base: ayuda a que directiva, ' +
           'cuerpo técnico y familias compartan un mismo espacio de trabajo y disfruten al máximo de este deporte.\n\n' +
           'Pulsa el botón de abajo para completar tu registro: el correo, el rol y el club ya te vendrán rellenos ' +
           'y sólo tendrás que elegir tu contraseña.\n\n' +
           '¡Muchas gracias por tu implicación y bienvenido a bordo!\n\n' +
           'Un saludo,\n' + (conClub ? '{club}' : 'CHRONOS FÚTBOL');
};

// ✍️ v783 · La NEGRITA del mensaje: `**texto**` → <strong>texto</strong>.
// 🔑 SE ESCAPA PRIMERO y se marca DESPUÉS: así lo único que puede volverse
// HTML es la propia negrita, nunca algo que el usuario escriba en el mensaje.
// Misma regla, letra por letra, que la de sendInviteEmail (functions/index.js):
// lo que se ve en la vista previa es lo que llega.
window.secNegritaHtml = function (texto) {
    return String(texto == null ? '' : texto)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
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

// ════════════════════════════════════════════════════════════════════
//  ✍️ v784 · LA FÁBRICA TIENE VERSIÓN (implementar.txt, 2026-10-05,
//  capturas 11104-11105)
//
//  El Administrador del CD DÍA seguía viendo el texto viejo y el ente el
//  nuevo con LA MISMA plantilla de fábrica: el club tenía una GUARDADA
//  (anterior a v783) y la guardada manda. El autor pide que la de fábrica
//  nueva se vea en los dos perfiles.
//
//  🔑 Cada plantilla se guarda con la versión de fábrica sobre la que se
//  escribió (`fabrica`). Una guardada SIN esa marca o con otra versión es
//  ANTERIOR a la fábrica actual: no se aplica sola, se muestra la de fábrica
//  y un aviso con «Recuperar la guardada» (es texto del club: NO se borra
//  ni se reescribe en la nube; si la recupera y pulsa Guardar, queda
//  sellada con la versión actual y vuelve a mandar).
//  ⚠️ Si se cambia el texto de secPlantillaFabrica, SUBIR esta versión.
// ════════════════════════════════════════════════════════════════════
window.SEC_FABRICA_VERSION = 'v783';
window.secGuardadaVigente = function (g) {
    return !!(g && typeof g === 'object' && g.email && g.fabrica === window.SEC_FABRICA_VERSION);
};

function _secPintaAvisoAntigua() {
    const caja = document.getElementById('sec-aviso-antigua');
    if (!caja) return;
    const vieja = window._secGuardadaAntigua;
    if (!vieja || !vieja.email) { caja.style.display = 'none'; caja.innerHTML = ''; return; }
    caja.style.cssText = 'display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-top:6px;' +
        'padding:0.5rem 0.7rem;border-radius:8px;background:rgba(210,153,34,0.1);' +
        'border:1px solid rgba(210,153,34,0.35);font-size:0.72rem;color:#d29922;';
    caja.innerHTML =
        '<span style="flex:1;min-width:180px;">ℹ️ Se muestra la plantilla nueva. Tu club tenía guardada una ' +
        'versión anterior del mensaje.</span>' +
        '<button onclick="window.saRecuperarPlantillaAntigua()" style="background:none;border:1px solid ' +
        'rgba(210,153,34,0.5);color:#d29922;font-size:0.68rem;font-weight:700;cursor:pointer;' +
        'padding:0.25rem 0.55rem;border-radius:6px;">↩️ Recuperar la guardada</button>';
}

// Vuelve a poner en el mensaje la plantilla guardada anterior. No guarda
// nada: para que mande de nuevo, «💾 Guardar plantilla» (la sella).
window.saRecuperarPlantillaAntigua = function () {
    const vieja = window._secGuardadaAntigua;
    const secBody = document.getElementById('sec-body');
    if (!vieja || !vieja.email || !secBody) return;
    secBody.value = vieja.email;
    secBody.classList.add('user-edited');
    window._secGuardadaAntigua = null;
    _secPintaAvisoAntigua();
    window.saUpdateInvitePreview();
    _saToast('↩️ Recuperada. Pulsa «💾 Guardar plantilla» para conservarla', 4000);
};

// ── Cargar la plantilla guardada del club (o la local del SuperAdmin) ──
// ⚠️ NUNCA BLOQUEA NI ROMPE LA PANTALLA: si la lectura falla o no hay nada
// guardado, se queda la de fábrica. Una Secretaría que no abre por no poder
// leer una preferencia sería mucho peor que una Secretaría sin preferencia.
window._secGuardadas = window._secGuardadas || null;
window._secGuardadaAntigua = null;
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
        // ✍️ v784 · sólo manda la guardada sellada con la fábrica ACTUAL; la
        // anterior queda aparte, para «Recuperar la guardada».
        const vigente = window.secGuardadaVigente(guardadas);
        window._secGuardadas = vigente ? guardadas : null;
        window._secGuardadaAntigua = (guardadas && !vigente) ? guardadas : null;
        _secPintaAvisoAntigua();
        // Siempre: sin guardada también hay que repintar, o se quedaría la
        // de una apertura anterior (`_secGuardadas` vive en window).
        window.saUpdateInviteTemplate();
    } catch (e) {
        if (window._CRONOS_DEBUG) console.warn('[Secretaría] plantilla guardada:', e.message);
    }
};

// v671 · Ya no hay nada que alternar: el único método es el correo.
//   La función SE CONSERVA porque es `window.*` y puede quedar alguna
//   llamada suelta; ahora deja la pantalla siempre en modo correo en vez de
//   esconder el bloque del email, que es lo que haría su rama antigua si
//   alguien la invocara con 'whatsapp'.
window.saToggleMethod = function() {
    const emailBlock   = document.getElementById('sec-email-block');
    const subjectBlock = document.getElementById('sec-subject-block');
    const btnText      = document.getElementById('sec-btn-text');

    if (emailBlock) emailBlock.style.display = 'block';
    if (subjectBlock) subjectBlock.style.display = 'block';
    if (btnText) btnText.innerHTML = '✉️ Enviar Invitación por Email';

    const secBody = document.getElementById('sec-body');
    if (secBody && !secBody.classList.contains('user-edited')) {
        window.saUpdateInviteTemplate();
    } else {
        window.saUpdateInvitePreview();
    }
};

// Actualizar la PLANTILLA (sólo si el usuario no la ha tocado) y la vista previa.
window.saUpdateInviteTemplate = function() {
    const method = 'email'   /* v671 · ya no hay selector de método: el correo es el único */;
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
    // ✍️ v783 · innerHTML a través de secNegritaHtml (que ESCAPA antes de
    // marcar), para que la negrita se vea aquí igual que en el correo.
    if (prev) prev.innerHTML = window.secNegritaHtml(window.secRenderPlantilla(
        _secCuerpoParaEnviar(secBody ? secBody.value : ''), datos));
};

// El cuerpo tal y como va a salir: en EMAIL, sin el enlace repetido.
function _secCuerpoParaEnviar(texto) {
    const metodo = 'email'   /* v671 · ya no hay selector de método: el correo es el único */;
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
        const method = 'email'   /* v671 · ya no hay selector de método: el correo es el único */;
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

    const method = 'email'   /* v671 · ya no hay selector de método: el correo es el único */;
    const ctx = window._secCtx || {};
    // Se conservan las DOS plantillas (correo y WhatsApp): guardar la de
    // correo no puede borrar la de WhatsApp.
    const base = window._secGuardadas || window._secGuardadaAntigua;
    const previas = (base && typeof base === 'object') ? base : {};
    const nuevas = Object.assign({}, previas);
    nuevas[method] = texto;
    // ✍️ v784 · se sella con la fábrica vigente: desde ahora vuelve a mandar.
    nuevas.fabrica = window.SEC_FABRICA_VERSION;
    window._secGuardadaAntigua = null;
    _secPintaAvisoAntigua();

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
    // 🎟️ v633 · Copiar es UNA DE LAS DOS PUERTAS que acuñan el token (la otra
    // es enviar). Hasta aquí el campo sólo enseñaba el aviso de pendiente.
    // 🔒 SEC-INV2 · si el acuñado falla, `_secEnlaceReal` LANZA en vez de
    //    devolver el enlace clásico con el correo dentro. Aquí se dice POR QUÉ
    //    no hay enlace: «todavía no hay enlace que copiar» mandaba a mirar el
    //    formulario cuando lo que pasaba era que no había red.
    let url = '';
    try { url = await _secEnlaceReal(); }
    catch (e) {
        console.warn('[saCopiarEnlace]', e && e.message);
        _saToast('⚠️ ' + ((e && e.message) || 'No se ha podido generar el enlace seguro.'), 6000);
        return;
    }
    if (link && url) link.value = url;
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
    const name = document.getElementById('sec-name')?.value.trim();
    if (!name) { _saToast('⚠️ El nombre del destinatario es obligatorio', 3000); return; }
    // v671 · Un solo camino: el correo. Ya no hay selector de método ni
    // rama de WhatsApp que enrutar.
    await window.saSendInviteEmail();
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

// ════════════════════════════════════════════════════════════════════
//  ✉️ v782 · SIN CORREO LOCAL. NUNCA.
//
//  Encargo del autor (implementar.txt, 2026-10-04, capturas 11057-11061):
//  «que el correo llegue automáticamente al destinatario sin dependencias de
//  un cliente de correo local». Probando la Secretaría del Admin de Club en
//  testeo, el botón ENVIAR le abrió su programa de correo.
//
//  🔑 EL PANEL YA LLAMABA AL SERVIDOR (el «Enviando invitación por email…» de
//  la 11059 es esa llamada). Lo que abría el correo local era el RESPALDO de
//  aquí abajo: cuando `sendInviteEmail` no envía —en testeo NUNCA envía, por
//  decisión del autor del 24-09, y responde `noCredentials + testeo`— o
//  cuando falla, se abría un `mailto:` con el cuerpo ya escrito.
//
//  Ahora, si el servidor no lo manda, la pantalla dice POR QUÉ y deja el
//  enlace a la vista y copiable (#sec-resultado). La invitación ya existe en
//  `invites/{token}`, así que el enlace es bueno: nada se pierde.
//   · TESTEO: se dice que es simulado y que en producción llegaría solo; el
//     formulario se limpia como en un envío bueno (es el «éxito» de testeo).
//   · FALLO DE VERDAD: el formulario NO se limpia, para poder reintentar —y
//     reintentar con los mismos datos reutiliza el mismo enlace (caché de
//     `_secEnlaceReal`), sin dejar invitaciones duplicadas vivas—.
// ════════════════════════════════════════════════════════════════════
const _secEsc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Pinta el recuadro de resultado. `tipo`: 'testeo' | 'fallo'. Sin el
// recuadro en el DOM (otra pantalla, o el guard) no hace nada: el toast que
// acompaña siempre a esta llamada ya dice lo esencial.
function _secMostrarResultado(tipo, titulo, texto, url) {
    const caja = document.getElementById('sec-resultado');
    if (!caja) return;
    const color = tipo === 'testeo' ? '210,168,255' : '240,136,62';
    caja.style.display = 'block';
    caja.innerHTML =
        '<div style="margin-top:0.8rem;padding:0.8rem 0.9rem;border-radius:8px;' +
               'background:rgba(' + color + ',0.08);border:1px solid rgba(' + color + ',0.35);">' +
          '<div style="font-size:0.85rem;font-weight:700;color:rgb(' + color + ');margin-bottom:0.3rem;">' +
            _secEsc(titulo) + '</div>' +
          '<div style="font-size:0.78rem;color:#c9d1d9;line-height:1.5;margin-bottom:0.6rem;">' +
            _secEsc(texto) + '</div>' +
          (url
            ? '<div style="display:flex;gap:0.4rem;align-items:stretch;">' +
                '<input id="sec-resultado-link" type="text" readonly onclick="this.select()" value="' + _secEsc(url) + '" ' +
                  'style="flex:1;min-width:0;padding:0.55rem;background:rgba(0,0,0,0.25);' +
                         'border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#58a6ff;' +
                         'font-size:0.74rem;font-family:monospace;box-sizing:border-box;">' +
                '<button onclick="window.saCopiarResultado()" ' +
                  'style="padding:0.55rem 0.8rem;background:rgba(88,166,255,0.12);' +
                         'border:1px solid rgba(88,166,255,0.35);border-radius:6px;color:#58a6ff;' +
                         'font-size:0.76rem;font-weight:700;cursor:pointer;white-space:nowrap;">📋 Copiar</button>' +
              '</div>'
            : '') +
        '</div>';
}
function _secOcultarResultado() {
    const caja = document.getElementById('sec-resultado');
    if (caja) { caja.style.display = 'none'; caja.innerHTML = ''; }
}

// Copia el enlace del recuadro de resultado.
window.saCopiarResultado = async function () {
    const campo = document.getElementById('sec-resultado-link');
    const url = campo ? campo.value : '';
    if (!url) return;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(url);
        else { campo.select(); document.execCommand('copy'); }
        _saToast('📋 Enlace copiado al portapapeles', 2500);
    } catch (e) {
        try { campo.select(); } catch (_) { /* sin foco */ }
        _saToast('⚠️ No se pudo copiar solo. Está seleccionado: pulsa Ctrl+C', 4500);
    }
};

// Enviar la invitación por el servidor (Cloud Function `sendInviteEmail`).
window.saSendInviteEmail = async function() {
    const to      = document.getElementById('sec-email')?.value.trim();
    const role    = document.getElementById('sec-role')?.value || 'individual';
    const clubName= document.getElementById('sec-club')?.value.trim() || '';
    const subject = document.getElementById('sec-subject')?.value.trim() || 'Invitación a Chronos Fútbol';
    if (!to) { _saToast('⚠️ El email de destino es obligatorio', 3000); return; }
    _secOcultarResultado();

    // 🎟️ v633 · Se acuña el token ANTES de componer nada: el cuerpo lleva
    // `{enlace}` y sin esto saldría el aviso de "pendiente" dentro del correo.
    //
    // 🔒 SEC-INV2 · Y SI NO SE PUEDE ACUÑAR, NO SE ENVÍA NADA. Antes esta
    //    llamada no podía fallar porque degradaba sola al enlace con el correo
    //    en claro; ahora lanza, y hay que parar AQUÍ: más abajo se compone el
    //    cuerpo y se manda al servidor, así que seguir adelante mandaría a la
    //    familia un mensaje con el aviso de «pendiente» donde va el enlace.
    //    Se para antes del spinner, que aún no se ha mostrado.
    try {
        await _secEnlaceReal();
    } catch (e) {
        console.warn('[saSendInviteEmail] sin enlace seguro:', e && e.message);
        _saToast('⚠️ ' + ((e && e.message) || 'No se ha podido generar el enlace seguro.') +
                 ' No se ha enviado la invitación.', 6000);
        return;
    }
    const inviteToken = (window._secTokenActual || {}).token || '';
    const inviteUrl   = (window._secTokenActual || {}).url || '';

    // 🔑 SE ENVÍA LA PLANTILLA YA SUSTITUIDA, no las marcas: el servidor no
    // sabe nada de {nombre} y mandaría el correo con las llaves dentro.
    const datos   = _secDatosActuales();
    // ✉️ v630 · Sin el enlace repetido: el HTML del correo ya pone el botón y
    // la frase de respaldo (functions/index.js:1330). Ver secQuitarEnlaceRepetido.
    const body    = window.secRenderPlantilla(
        _secCuerpoParaEnviar(document.getElementById('sec-body')?.value || ''), datos).trim();

    // El fallo de verdad: se dice el motivo, el enlace queda a mano y el
    // formulario SE QUEDA (ver la cabecera de v782).
    const _noEnviado = (motivo) => {
        const link = document.getElementById('sec-link');
        if (link && inviteUrl) link.value = inviteUrl;
        _saToast('⚠️ No se ha enviado el correo. ' + motivo, 6000);
        _secMostrarResultado('fallo', '⚠️ El correo NO se ha enviado',
            motivo + ' La invitación sí está creada: puedes reintentar el envío o copiar el ' +
            'enlace y hacérselo llegar tú.', inviteUrl);
    };

    _saShowSpinner('Enviando invitación por email...');
    try {
        const { fa, httpsCallable } = await saFS();
        if (!fa.functions) throw new Error('Firebase Functions no disponible. Recarga la página.');
        const sendEmail = httpsCallable(fa.functions, 'sendInviteEmail');
        // 🎟️ v633 · Va el TOKEN, no la URL. El servidor compone el enlace con su
        // propia constante: así el cliente no puede colar una dirección ajena
        // dentro de un correo que va firmado por la plataforma.
        const result = await sendEmail({ to, subject, body, role, clubName, inviteToken });
        _saHideSpinner();

        const d = result.data || {};

        if (d.success === true) {
            // ✅ Email enviado correctamente por el servidor
            _saToast('✅ Invitación enviada con éxito a ' + to, 5000);
            _limpiarFormularioSecretaria();
        } else if (d.testeo === true) {
            // 🧪 Testeo: el servidor no manda correos reales (decisión del
            // autor, 24-09). Es el «éxito» de este entorno: se dice claro y
            // se deja el enlace para probar el alta a mano.
            _saToast('🧪 Testeo: correo simulado para ' + to + '. En producción le llegaría automáticamente.', 6000);
            _secMostrarResultado('testeo', '🧪 Testeo: el correo no se envía de verdad',
                'En producción, ' + to + ' recibiría la invitación automáticamente, sin abrir ningún ' +
                'programa de correo. Para probar el alta, copia este enlace y ábrelo en una ventana de incógnito.',
                inviteUrl);
            _limpiarFormularioSecretaria();
        } else if (d.noCredentials) {
            console.warn('[saSendInviteEmail] el servidor no tiene credenciales de correo');
            _noEnviado('El servidor no tiene configurada la cuenta de correo de envío. Avisa al SuperAdmin.');
        } else if (d.error) {
            console.warn('[saSendInviteEmail] el servidor no pudo enviar:', d.error);
            _noEnviado('El servidor no ha podido enviarlo (' + d.error + ').');
        } else {
            console.warn('[saSendInviteEmail] Respuesta inesperada:', d);
            _noEnviado('El servidor ha dado una respuesta inesperada.');
        }
    } catch (e) {
        _saHideSpinner();
        const info = window.secExplicarErrorEnvio(e);
        console.error('[saSendInviteEmail] code=' + info.code, e);
        // ⚠️ SIN confirm() (v594) y, desde v782, SIN correo local: se explica
        // el motivo real y el enlace queda a mano.
        _noEnviado(info.texto);
    }
};

// Helper: limpiar formulario de secretaría tras envío
// ⚠️ NO se toca `sec-body`: la plantilla (de fábrica o la guardada del club)
// tiene que seguir ahí para la siguiente invitación. Sólo se van los datos
// del destinatario, que son los que cambian.
function _limpiarFormularioSecretaria() {
    const fields = ['sec-email', 'sec-name'];   // v671 · sin 'sec-phone'
    fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    // 🎟️ v633 · Se suelta el token ya usado. Sin esto, la siguiente invitación
    // reutilizaría el enlace de la anterior si el formulario volviera a quedar
    // con los mismos rol y club — y esa persona entraría con la invitación de
    // otra.
    window._secTokenActual = null;
    window.saUpdateInvitePreview?.();
}


// v671 · AQUÍ VIVÍA `saSendInviteWhatsApp`, Y SE HA RETIRADO con su botón,
//   su campo de teléfono y su plantilla. La invitación va por correo, que
//   además es el único camino que lleva botón de acción y frase de respaldo.
