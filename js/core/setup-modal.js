// ══════════════════════════════════════════════════════════════════
//  MODAL DE CONFIGURACIÓN DEL PARTIDO (Setup) — v2
//  Cambios v2:
//  [FIX] Categoría se sincroniza SIEMPRE con modalidad.
//        - onchange del select #setup-mode usa syncSetupMode() centralizado
//        - Garantía final tras restoreSetupState
//        - Listener en equipos guardados para re-sincronizar
// ══════════════════════════════════════════════════════════════════

// v261: Variable global para recordar qué modalidades tiene permitidas el entrenador.
window._cronosAllowedModes = ['f7', 'f11']; // por defecto, ambas

// ════════════════════════════════════════════════════════════════════
//  v429 — POLÍTICA DE EXTRAS BLOQUEADOS (🔒), PUNTO ÚNICO
// ════════════════════════════════════════════════════════════════════
//  La regla del autor: un extra desactivado NO esconde su pestaña ni su
//  botón — los deja a la vista con un candado y en estado bloqueado, para
//  que el usuario sepa que la función existe y que es cosa de su plan.
//
//  Hasta v428 esa política vivía ENTERA dentro de _cronosExtraBtn, y por
//  tanto solo existía en el modal del Entrenador. El panel de Padres, el
//  menú de Comunicaciones y las entradas de mensajería no la aplicaban.
//  Estas tres funciones la sacan a un sitio común para que todas las
//  superficies decidan igual:
//
//    _cronosExtraEnabled(key) → ¿está activo?          (LECTURA única)
//    _cronosExtraGate(key)    → ¿puedo entrar? + aviso (RUNTIME)
//    _cronosExtraBtn(...)     → botón con candado      (PINTADO)
//
//  ⚠️ Por defecto TODO está activo: `!== false`. Un extra ausente (club
//  antiguo que nunca pasó por el panel del SuperAdmin) tiene que quedar
//  HABILITADO. Comparar con `=== true` apagaría media aplicación a todos
//  los clubes que aún no tienen el mapa `extras` en su documento.
window._cronosExtraEnabled = function(extraKey) {
    // Usuario EFECTIVO: en cuentas multi-rol el usuario activo puede no ser
    // window._cronosCurrentUser. Los extras son del club, así que en la
    // práctica coinciden; se prefiere el efectivo por coherencia con el
    // motor de mensajería, que ya resuelve así.
    const me = (typeof window._getEffectiveUser === 'function')
        ? (window._getEffectiveUser() || window._cronosCurrentUser)
        : window._cronosCurrentUser;
    const extras = (me && me.extras) || {};
    return extras[extraKey] !== false;
};

// Portero de tiempo de ejecución. Se llama al PRINCIPIO de la función de
// entrada de cada función bloqueable: si devuelve false, no se entra.
// Devolver un booleano (y no lanzar) permite usarlo tal cual en un `if`.
window._cronosExtraGate = function(extraKey, label) {
    if (window._cronosExtraEnabled(extraKey)) return true;
    const txt = '🔒 ' + (label || 'Esta función') + ' no está disponible en tu plan';
    if (typeof showToast === 'function') showToast(txt, 3500);
    else alert(txt);
    return false;
};

// FIX (Error #26): Helper para mostrar botones con candado si el extra está desactivado
window._cronosExtraBtn = function(extraKey, label, onclickAction, styleStr) {
    const enabled = window._cronosExtraEnabled(extraKey);
    // FIX: verificar en tiempo de click tambien (por si extras se cargo tarde).
    // v429: el guard delega en _cronosExtraGate en vez de repetir aquí la
    // lectura de extras — antes había DOS reglas (esta cadena y la de arriba)
    // que podían divergir, y de hecho miraban usuarios distintos.
    const guard = "if(typeof window._cronosExtraGate==='function' && !window._cronosExtraGate('" + extraKey + "'))return;";
    if (enabled) {
        return '<button class="btn" onclick="' + guard + onclickAction + '" style="background:' + styleStr + '; font-size:0.7rem; font-weight:800; padding:0.6rem 0.2rem; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center;">' + label + '</button>';
    } else {
        return '<button class="btn" disabled title="No disponible en tu plan" style="background:rgba(255,255,255,0.03); color:#555; font-size:0.7rem; border:1px solid rgba(255,255,255,0.08); font-weight:800; padding:0.6rem 0.2rem; border-radius:10px; display:flex; align-items:center; justify-content:center; text-align:center; cursor:not-allowed; opacity:0.6;">🔒 ' + label + '</button>';
    }
};

// ════════════════════════════════════════════════════════════════════
//  v596 · LOS ROLES COMO EXTRAS — MAPA ÚNICO
// ════════════════════════════════════════════════════════════════════
//  Cuatro extras nuevos (extras-toggle.js) apagan un ROL entero en vez
//  de una función suelta. Este mapa es el ÚNICO sitio donde se dice qué
//  clave gatea qué rol: el selector de rol (role-launch.js), su segunda
//  puerta y el panel de Dirección leen todos de aquí.
//
//  ⚠️ EL MAPA VA POR NOMBRE DE ROL, NO POR TARJETA. Un mismo rol se
//  guarda con varias claves históricas ('parent', 'parent_individual',
//  'padre_individual'): las tres son la MISMA plaza de familia y las
//  tres tienen que caer del mismo lado del interruptor. Olvidar un alias
//  no da error — deja una puerta abierta, que es peor.
window.CRONOS_ROL_EXTRA = {
    director:             'rol_director',
    coordinator:          'rol_coordinador',
    parent:               'rol_padres',
    parent_individual:    'rol_padres',
    padre_individual:     'rol_padres',
};

// El motivo que se ENSEÑA. La política del autor desde v429: un extra no
// contratado no se esconde — se ve, bloqueado y diciendo por qué. Una
// opción que desaparece sin explicación parece una avería.
window.CRONOS_ROL_EXTRA_MOTIVO = {
    rol_director:    'El acceso de Director Deportivo no está contratado en el plan de tu club.',
    rol_coordinador: 'El acceso de Coordinador no está contratado en el plan de tu club.',
    rol_padres:      'El acceso de Familias no está contratado en el plan de tu club.',
    secretaria:      'Secretaría no está contratada en el plan de tu club. Habla con el administrador.',
};

// v679 · El motivo del extra `cuadrante`, en UN solo sitio. Lo leen los dos
// anfitriones del módulo —el panel de Dirección/Coordinación
// (js/coach/reports/club-reports.js) y el del Ente Individual
// (js/admin/individual/panel.js)—, que son pantallas distintas y en ficheros
// distintos: escrito dos veces, divergiría a la primera corrección.
// ⚠️ NO va en CRONOS_ROL_EXTRA_MOTIVO: ese mapa es de los extras que apagan un
// ROL entero, y éste apaga una SECCIÓN. Mezclarlos haría creer que existe un
// `rol_cuadrante` que el selector de rol tendría que mirar, y no lo hay.
window.CRONOS_EXTRA_CUADRANTE_MOTIVO =
    'El Cuadrante no está contratado en el plan de tu club. Habla con el administrador.';

// FIX: re-renderizar el modal cuando los extras se carguen
window._cronosRefreshExtras = function() {
    if (typeof openSetupModal === 'function' && document.querySelector('.setup-mode')) {
        openSetupModal();
    }
};

// ════════════════════════════════════════════════════════════════════
//  v540 · CAMBIAR DE EQUIPO SIN CERRAR SESIÓN
//
//  Lo pulsa el entrenador que lleva un F7 y un F11 (v537). Cambiar de equipo
//  cambia TODO lo que cuelga de él: modalidad, categoría, plantilla,
//  convocatorias, informes y partidos — todos se resuelven por `teamId`
//  (cronosTeamId), así que basta con mover el equipo activo y repintar.
//
//  ⚠️ SE TIRA EL ESTADO PENDIENTE DEL FORMULARIO. `_pendingSetupState`
//  guarda la modalidad y la categoría del equipo ANTERIOR, y
//  `restoreSetupState()` las volvería a poner encima de las nuevas: el panel
//  diría "Fútbol 11" con la categoría del equipo de Fútbol 7.
//
// ════════════════════════════════════════════════════════════════════
//  🚨 v556 · EL CAMBIO DE EQUIPO YA NO SE BLOQUEA NUNCA
//
//  Reportado por el autor (captura 9039): con un Alevín C (F7) y un Regional A
//  (F11) asignados, pulsar el segundo equipo no hacía nada y salía el aviso
//  "Termina o cierra el partido en curso antes de cambiar de equipo". Sin
//  haber empezado ningún partido. El entrenador quedaba obligado a jugar con
//  la primera opción por narices.
//
//  🔑🔑🔑 LA GUARDA NO SE EQUIVOCABA DE VEZ EN CUANDO: CERRABA SIEMPRE.
//  `cronosHayPartidoEnCurso()` decía "sí" desde el primer segundo de la
//  sesión, porque el campo se pone visible EN EL LOGIN y `matchPhase` nace en
//  '1st_half' (ver la cabecera de la función en utils.js, corregida en v556).
//
//  🔑🔑 Y LA DECISIÓN DEL AUTOR ES QUE NO HAYA CANDADO AQUÍ, ni siquiera con
//  el arreglo puesto: elegir equipo en su propio panel es navegación, no una
//  operación destructiva, y ningún estado anterior puede quitarle el acceso a
//  la mitad de sus equipos. El partido que hubiera debajo NO SE PIERDE: cada
//  partido se autoguarda en su propia ranura de localStorage (match-slots.js,
//  v465) y se recupera con "🔄 RECUPERAR PARTIDO". Por eso, cuando de verdad
//  había un partido corriendo, esto INFORMA de dónde ha quedado — pero cambia
//  igual.
// ════════════════════════════════════════════════════════════════════
// ── v557 · CAMBIAR EL EQUIPO ACTIVO, SIN PINTAR NADA ────────────────────
//  Es la mitad de `_cronosCambiarEquipo` que MUEVE EL ESTADO. Vive aparte
//  porque hace falta en un segundo sitio: al retomar un partido guardado del
//  otro equipo (`_restoreActiveMatch`, app-init.js), donde repintar el panel
//  sería justo lo contrario de lo que se quiere. Con una copia en cada sitio,
//  el día que cambie la sincronización uno de los dos se quedaría atrás y la
//  app acabaría con la pantalla en un equipo y los datos en el otro.
//
//  Devuelve el equipo de destino, o null si ese teamId ya no es suyo.
window._cronosAplicarEquipoActivo = function(teamId) {
    try {
        var me = window._cronosCurrentUser;
        if (!me || !teamId) return null;

        var equipos = (typeof window.cronosEquiposDeEntrenador === 'function')
            ? window.cronosEquiposDeEntrenador(me.allRoles, null) : [];
        var destino = equipos.filter(function(e) { return e.teamId === teamId; })[0];
        if (!destino) return null;

        if (typeof window.cronosFijarEquipoElegido === 'function') {
            window.cronosFijarEquipoElegido(teamId);
        }

        // El resto del proyecto lee la categoría de aquí (47 archivos usan
        // _cronosCurrentUser): se sincroniza igual que en _launchWithRole.
        window._cronosCurrentUser = Object.assign({}, me, {
            category:        destino.category,
            categoryLabel:   destino.category,
            subcategory:     destino.subcategory || null,
            clubId:          destino.clubId || me.clubId,
            clubName:        destino.clubName || me.clubName,
            _activeRoleData: destino._rol,
        });

        // ⚠️ SE TIRA EL ESTADO PENDIENTE DEL FORMULARIO (v540): guarda la
        // modalidad y la categoría del equipo ANTERIOR.
        window._pendingSetupState = null;
        return destino;
    } catch (e) {
        console.error('[v557] No se pudo aplicar el equipo activo:', e);
        return null;
    }
};

window._cronosCambiarEquipo = function(teamId) {
    try {
        var me = window._cronosCurrentUser;
        if (!me || !teamId) return;
        if (typeof window.cronosEquipoElegido === 'function' &&
            window.cronosEquipoElegido() === teamId) return;   // ya está abierto

        // Sólo para redactar el aviso: NO decide nada, no puede impedir el
        // cambio. Si algún día vuelve a mentir, lo peor que hará es sobrar una
        // línea en un toast.
        var _habiaPartido = (typeof window.cronosHayPartidoEnCurso === 'function')
            ? window.cronosHayPartidoEnCurso() : false;

        // 🔑 v557 · SE APARCA EL PARTIDO ANTES DE SOLTAR EL EQUIPO. Con el
        // cronómetro corriendo, el autoguardado va a 5 s: sin esto se
        // perderían hasta cinco segundos —y con ellos el último gol o el
        // último cambio— justo en el momento en que el entrenador deja de
        // mirar. A partir de aquí ese estado está a salvo en la ranura de SU
        // equipo (lleva sello `teamId`), y el equipo nuevo empieza en blanco.
        //
        // ⚠️ SÓLO SI DE VERDAD HAY PARTIDO, y por eso se reutiliza el mismo
        // `_habiaPartido` de arriba. Guardar a ciegas escribiría una ranura en
        // CADA cambio de equipo —también nada más entrar, con el cronómetro a
        // cero y sin un jugador—, y esas ranuras fantasma aparecerían luego
        // como tarjetas en "🔄 Recuperar Partido". Con el reloj parado no hay
        // nada que perder: el autoguardado de 5 s ya lo tiene todo escrito.
        try {
            if (_habiaPartido && typeof window._saveMatchStateToStorage === 'function') {
                window._saveMatchStateToStorage();
            }
        } catch (e) { /* cambiar de equipo nunca puede fallar por el guardado */ }

        var destino = window._cronosAplicarEquipoActivo(teamId);
        if (!destino) return;

        if (typeof showToast === 'function') {
            showToast('✅ Ahora estás en ' + destino.etiqueta +
                      (destino.modalidad === 'f7' ? ' (Fútbol 7)' :
                       destino.modalidad === 'f11' ? ' (Fútbol 11)' : '') +
                      (_habiaPartido
                        ? '. El partido anterior queda guardado: lo retomas con "🔄 RECUPERAR PARTIDO".'
                        : ''),
                      _habiaPartido ? 5500 : 3000);
        }
        openSetupModal();
    } catch (e) {
        console.error('[v540] No se pudo cambiar de equipo:', e);
    }
};

function openSetupModal() {
    // Pila de navegación (js/core/nav-stack.js): esta pantalla es la RAÍZ del
    // panel del Entrenador, así que al pintarse resetea la pila. Eso es lo que
    // permite migrar el resto por partes: cualquier "Volver" antiguo que
    // todavía llame a openSetupModal() directamente deja la pila coherente en
    // vez de dejarla describiendo una pantalla ya destruida.
    if (typeof navRootScreen === 'function') navRootScreen('openSetupModal');

    document.body.classList.add('setup-mode');
    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    // v261: Limitar la modalidad según la categoría del entrenador.
    // Si el entrenador tiene categoría F7 (prebenjamin, benjamin, alevin),
    // solo puede crear partidos F7. Si tiene F11 (infantil, cadete, juvenil,
    // regional), solo puede crear F11. Si tiene ambas, puede elegir.
    // ══════════════════════════════════════════════════════════════════
    //  v540 · EL ENTRENADOR CON DOS EQUIPOS ELIGE CUÁL ESTÁ LLEVANDO
    //
    //  Requisito del autor (2026-08-15): con un F7 y un F11 en el mismo club
    //  no se le puede cargar uno "por defecto y de forma rígida" — tiene que
    //  poder cambiar, y ver en todo momento en cuál está.
    //
    //  🔑 UN SOLO SITIO DECIDE: `cronosEquiposDeEntrenador` (utils.js). El
    //  equipo activo manda sobre la modalidad, la categoría y la plantilla,
    //  porque `me.category` ya viene fijada por _launchWithRole a la del
    //  equipo elegido.
    // ══════════════════════════════════════════════════════════════════
    var _misEquipos = [];
    var _equipoActivoId = '';
    try {
        var _meSel = window._cronosCurrentUser;
        if (_meSel && typeof window.cronosEquiposDeEntrenador === 'function') {
            _misEquipos = window.cronosEquiposDeEntrenador(_meSel.allRoles, null) || [];
            if (typeof window.cronosEquipoElegido === 'function') {
                _equipoActivoId = window.cronosEquipoElegido();
            }
            // Si la elección guardada ya no existe (equipo retirado), se cae al
            // primero: nunca se deja el panel apuntando a un equipo ajeno.
            if (!_misEquipos.some(function(e) { return e.teamId === _equipoActivoId; })) {
                _equipoActivoId = _misEquipos.length ? _misEquipos[0].teamId : '';
            }
        }
    } catch (e) { console.warn('[v540] No se pudieron leer los equipos del entrenador:', e); }

    try {
        var me = window._cronosCurrentUser;
        var hasF7 = false, hasF11 = false;

        // 🔑 v540 · CON EQUIPO ACTIVO, LA MODALIDAD ES LA SUYA Y PUNTO. Antes,
        // un entrenador con los dos equipos veía el desplegable de modalidad
        // abierto de par en par: podía montar un partido de Fútbol 11 con la
        // categoría de su equipo de Fútbol 7. Ahora la modalidad la fija el
        // equipo que tiene abierto, y se cambia cambiando de equipo.
        var _act = _misEquipos.filter(function(e) { return e.teamId === _equipoActivoId; })[0];
        if (_act && _act.modalidad) {
            hasF7  = (_act.modalidad === 'f7');
            hasF11 = (_act.modalidad === 'f11');
        } else if (me && me.allRoles) {
            me.allRoles.forEach(function(r) {
                if (!r || (r.role !== 'user' && r.role !== 'coach')) return;
                var rcat = (r.category || '').toLowerCase();
                // Categorías F7: prebenjamin, benjamin, alevin, futurefem
                // Categorías F11: infantil, cadete, juvenil, regional, regional_fem
                // (aceptamos también con prefijo f7_/f11_)
                // 🔑 v538 · FUTureFEM PASA A F11. Sus futbolistas tienen de 12 a
                // 15 años, así que por edad y normativa juegan Fútbol 11
                // (corrección del autor, 2026-08-15; hasta v537 se clasificaba
                // como F7 por error). Regional FEM ya entra por
                // includes('regional'). 'futurefem' no comparte subcadena con
                // ninguna otra clave, así que necesita su propia mención: sin
                // ella al entrenador no se le ofrecería ninguna modalidad.
                if (rcat.includes('prebenjamin') || rcat.includes('benjamin') || rcat.includes('alevin')) hasF7 = true;
                if (rcat.includes('infantil') || rcat.includes('cadete') || rcat.includes('juvenil') || rcat.includes('regional') || rcat.includes('futurefem')) hasF11 = true;
                if (rcat.startsWith('f7_')) hasF7 = true;
                if (rcat.startsWith('f11_')) hasF11 = true;
            });
        }
        // Guardar modalidades permitidas en variable global
        if (hasF7 && !hasF11) {
            window._cronosAllowedModes = ['f7'];
        } else if (hasF11 && !hasF7) {
            window._cronosAllowedModes = ['f11'];
        } else {
            window._cronosAllowedModes = ['f7', 'f11'];
        }
        // Aplicar restricción al desplegable
        setTimeout(function() {
            var modeSel = document.getElementById('setup-mode');
            if (!modeSel) return;
            var allowed = window._cronosAllowedModes;
            var options = '';
            if (allowed.indexOf('f7') >= 0) options += '<option value="f7">Fútbol  7</option>';
            if (allowed.indexOf('f11') >= 0) options += '<option value="f11">Fútbol  11</option>';
            modeSel.innerHTML = options;
            modeSel.value = allowed[0];
            // Desactivar el desplegable si solo hay una opción
            modeSel.disabled = (allowed.length === 1);
            console.log('[v261] Modalidades permitidas:', allowed.join(', '));
            if (typeof syncSetupMode === 'function') syncSetupMode(modeSel.value);
        }, 100);
    } catch(e) { console.warn('[v261] Error limitando modalidad:', e); }

    // ── Pestañas de equipo (sólo si de verdad lleva más de uno) ──────
    // ⚠️ A un entrenador de un solo equipo no se le enseña nada: un selector
    // con una única opción no elige nada y sólo roba sitio.
    var _selectorEquipoHTML = '';
    if (_misEquipos.length > 1) {
        _selectorEquipoHTML =
            '<div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;' +
            '            background:rgba(88,166,255,0.06); border:1px solid rgba(88,166,255,0.25);' +
            '            border-radius:10px; padding:0.5rem 0.7rem; margin-bottom:1rem;">' +
            '<span style="font-size:0.72rem; color:var(--text-muted); font-weight:700;">MIS EQUIPOS</span>' +
            _misEquipos.map(function(eq) {
                var activo = (eq.teamId === _equipoActivoId);
                var modLbl = eq.modalidad === 'f7' ? 'Fútbol 7'
                           : eq.modalidad === 'f11' ? 'Fútbol 11' : '';
                return '<button type="button" onclick="_cronosCambiarEquipo(\'' +
                    String(eq.teamId).replace(/'/g, "\\'") + '\')" ' +
                    'style="padding:0.4rem 0.85rem; border-radius:8px; cursor:pointer;' +
                    ' font-size:0.78rem; font-weight:800; transition:all 0.15s;' +
                    (activo
                        ? ' background:#58a6ff; color:#0d1117; border:1px solid #58a6ff;'
                        : ' background:rgba(255,255,255,0.04); color:var(--text-muted);' +
                          ' border:1px solid var(--glass-border);') + '">' +
                    (activo ? '✅ ' : '') + escapeHtml(eq.etiqueta) +
                    (modLbl ? '<span style="display:block; font-size:0.62rem; font-weight:600; opacity:0.8;">' +
                              modLbl + '</span>' : '') +
                    '</button>';
            }).join('') +
            '</div>';
    }

    // ══════════════════════════════════════════════════════════════════
    //  🔙 v598 · LA VUELTA AL PANEL DEL ADMINISTRADOR INDIVIDUAL
    //
    //  Reportado por el autor (2026-08-21): el ente individual también ejerce
    //  de entrenador y crea partidos desde su propio panel, «pero se queda
    //  atrapado» — hay que poder «regresar con fluidez a su panel completo».
    //
    //  🔑 POR QUÉ NO BASTA CON `navBack()`, que es lo primero que uno prueba:
    //  esta pantalla se declara RAÍZ (`navRootScreen('openSetupModal')`, arriba
    //  en esta misma función). Declararse raíz VACÍA la pila, así que en el
    //  momento en que se pinta ya no queda ninguna pantalla anterior a la que
    //  volver. Por eso el botón invoca el panel directamente en vez de deshacer
    //  un paso que no existe.
    //
    //  🔑 POR QUÉ TAMPOCO SERVÍA EL "🛡️ ADMIN" QUE YA HABÍA. Ese botón existe
    //  (index.html:804) pero vive en `#main-header`, y esta modal se pinta
    //  ENCIMA a pantalla completa. Estaba ahí, tapado: desde aquí lo único
    //  alcanzable era "Cerrar Sesión" — que es exactamente lo que él describe.
    //
    //  ⚠️ SÓLO PARA EL ROL 'individual'. Un entrenador de club que pulsara
    //  esto se toparía con el candado de `openIndividualAdminPanel`, que
    //  responde «⛔ Sin permisos» — un botón que sólo sabe dar un error no se
    //  le enseña a nadie. Se mira `_activeRole` y no `role` porque una cuenta
    //  multi-rol puede haber entrado hoy como otra cosa.
    var _volverAlPanelHTML = '';
    try {
        var _yo = window._cronosCurrentUser;
        var _rolActivo = _yo ? (_yo._activeRole || _yo.role) : '';
        if (_rolActivo === 'individual' && typeof window.openIndividualAdminPanel === 'function') {
            // ⚠️ v601 · Por `cronosAbrirPanelIndividual` (role-launch.js), que
            // además ESCONDE el terreno de juego y anuncia el panel mientras
            // carga. Llamar al panel a pelo dejaba el campo detrás y un hueco
            // en blanco durante sus lecturas de Firestore.
            _volverAlPanelHTML =
                '<button onclick="if(typeof cronosAbrirPanelIndividual===\'function\') cronosAbrirPanelIndividual(); else openIndividualAdminPanel()" title="Volver a mi panel de gestión"' +
                ' style="background:rgba(121,192,255,0.15); border:1px solid rgba(121,192,255,0.45);' +
                ' color:#79c0ff; padding:6px 12px; border-radius:8px; cursor:pointer;' +
                ' font-size:0.75rem; font-weight:700;">← Volver al Panel</button>';
        }
    } catch (_e) { /* la vuelta es una comodidad: nunca puede impedir crear un partido */ }

    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:960px; max-width:98vw; padding:1.5rem; border-radius:16px;">
            <!-- Cabecera -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                <div style="display:flex; align-items:center;">
                    <img src="public/assets/logo.png" style="height:40px; margin-right:12px; filter: drop-shadow(0 0 10px rgba(88,166,255,0.3));" onerror="this.style.display='none'">
                    <span style="font-size:1.4rem; font-weight:900; color:var(--text); letter-spacing:-0.5px;">CHRONOS <span style="color:#58a6ff;">FÚTBOL</span></span>
                </div>
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <!-- 🔙 v598 · La vuelta al panel del ente individual. Va la
                         PRIMERA y separada de "Cerrar Sesión" a propósito: el
                         defecto que arregla es precisamente que salir de la
                         sesión era la única salida visible desde aquí. -->
                    ${_volverAlPanelHTML}
                    <!-- v451 · el entrenador vive en esta pantalla; la otra vía
                         está en el landing de roles, que no todos vuelven a ver. -->
                    <button onclick="if(typeof openChangePasswordModal==='function')openChangePasswordModal();"
                            title="Cambiar mi contraseña"
                            style="background:rgba(88,166,255,0.08); border:1px solid rgba(88,166,255,0.3); color:#58a6ff; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem;">🔒 Contraseña</button>
                    <button onclick="cerrarSesion()" style="background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); color:var(--text-muted); padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem;">Cerrar Sesión</button>
                </div>
            </div>

            ${_selectorEquipoHTML}

            <!-- CUADRICULA SIMÉTRICA DE EQUIPOS (LOCAL / VISITANTE) -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem; margin-bottom:1.2rem;">
                
                <!-- COLUMNA LOCAL -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:14px; overflow:hidden; display:flex; flex-direction:column;">
                    <div style="background:linear-gradient(90deg, #1d4ed8, #1e40af); color:white; padding:0.6rem 1rem; display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:0; font-size:0.85rem; font-weight:800; letter-spacing:1px;">LOCAL</h3>
                        <span style="font-size:1.1rem;">🏠</span>
                    </div>
                    <div style="padding:1rem; display:flex; flex-direction:column; gap:0.8rem;">
                        <div>
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Cargar Guardado</label>
                            <div style="display:flex; gap:0.5rem; align-items:center;">
                                <select id="saved-teams-home" onchange="loadTeamFromDropdown('home')" 
                                    style="flex:1; padding:0.5rem; background:rgba(255,255,255,0.07); border:1px solid var(--glass-border); border-radius:8px; color:white;">
                                    <option value="">-- Cargar --</option>
                                </select>
                                <button onclick="saveTeamSetup('home')" title="Guardar Plantilla"
                                    style="background:rgba(63,185,80,0.2); border:1px solid rgba(63,185,80,0.5); color:#3fb950; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">💾</button>
                                <button onclick="deleteTeamFromDropdown('home')" title="Borrar Plantilla"
                                    style="background:rgba(255,88,88,0.15); border:1px solid rgba(255,88,88,0.5); color:#ff5858; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">🗑️</button>
                            </div>
                            <!-- Contenedor lista visual Local -->
                            <div id="saved-teams-list-home" style="margin-top:0.5rem; max-height:100px; overflow-y:auto; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid var(--glass-border);"></div>
                        </div>

                        <div class="form-group" style="margin:0;">
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px; display:block;">Nombre del equipo</label>
                            <input type="text" id="setup-home-name" value="LOCAL" 
                                style="width:100%; padding:0.55rem; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:8px; color:white; font-weight:600;">
                        </div>
                        
                        <div>
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Colores (Camiseta / Pantalón / Dorsal)</label>
                            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.6rem;">
                                <input type="color" id="setup-home-color" value="#58a6ff" title="Camiseta"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                                <input type="color" id="setup-home-shorts" value="#ffffff" title="Pantalón"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                                <input type="color" id="setup-home-text" value="#000000" title="Dorsal"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- COLUMNA VISITANTE -->
                <div style="background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:14px; overflow:hidden; display:flex; flex-direction:column;">
                    <div style="background:linear-gradient(90deg, #b91c1c, #991b1b); color:white; padding:0.6rem 1rem; display:flex; justify-content:space-between; align-items:center;">
                        <h3 style="margin:0; font-size:0.85rem; font-weight:800; letter-spacing:1px;">VISITANTE</h3>
                        <span style="font-size:1.1rem;">✈️</span>
                    </div>
                    <div style="padding:1rem; display:flex; flex-direction:column; gap:0.8rem;">
                        <div>
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Cargar Guardado</label>
                            <div style="display:flex; gap:0.5rem; align-items:center;">
                                <select id="saved-teams-away" onchange="loadTeamFromDropdown('away')" 
                                    style="flex:1; padding:0.5rem; background:rgba(255,255,255,0.07); border:1px solid var(--glass-border); border-radius:8px; color:white;">
                                    <option value="">-- Cargar --</option>
                                </select>
                                <button onclick="saveTeamSetup('away')" title="Guardar Plantilla"
                                    style="background:rgba(63,185,80,0.2); border:1px solid rgba(63,185,80,0.5); color:#3fb950; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">💾</button>
                                <button onclick="deleteTeamFromDropdown('away')" title="Borrar Plantilla"
                                    style="background:rgba(255,88,88,0.15); border:1px solid rgba(255,88,88,0.5); color:#ff5858; min-width:40px; height:36px; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;">🗑️</button>
                            </div>
                            <!-- Contenedor lista visual Visitante -->
                            <div id="saved-teams-list-away" style="margin-top:0.5rem; max-height:100px; overflow-y:auto; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid var(--glass-border);"></div>
                        </div>

                        <div class="form-group" style="margin:0;">
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px; display:block;">Nombre del equipo</label>
                            <input type="text" id="setup-away-name" value="VISITANTE" 
                                style="width:100%; padding:0.55rem; background:rgba(255,255,255,0.05); border:1px solid var(--glass-border); border-radius:8px; color:white; font-weight:600;">
                        </div>
                        
                        <div>
                            <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Colores (Camiseta / Pantalón / Dorsal)</label>
                            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.6rem;">
                                <input type="color" id="setup-away-color" value="#ff5858" title="Camiseta"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                                <input type="color" id="setup-away-shorts" value="#000000" title="Pantalón"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                                <input type="color" id="setup-away-text" value="#ffffff" title="Dorsal"
                                    style="width:100%; height:40px; border-radius:8px; border:1px solid var(--glass-border); cursor:pointer; background:none; padding:2px;">
                            </div>
                        </div>
                    </div>
                </div>

            </div> <!-- FIN DE CUADRICULA SIMÉTRICA -->

            <!-- FILA: Mi equipo | Modalidad | Categoría | Sistema | Analizar -->
            <div style="display:grid; grid-template-columns:auto 1fr 1fr 1.2fr auto; gap:1rem; align-items:end;
                        background:var(--glass); border-radius:10px; padding:0.8rem 1rem; margin-bottom:1rem;">
                <!-- NUEVO: selector de rol del equipo del entrenador -->
                <div style="min-width:120px;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Mi equipo juega de</label>
                    <div style="display:flex; border-radius:8px; overflow:hidden; border:1px solid var(--glass-border);">
                        <button id="role-btn-home"
                            onclick="_setMyTeamRole('home')"
                            style="flex:1; padding:0.45rem 0.5rem; background:rgba(29,78,216,0.35);
                                   border:none; color:white; font-size:0.72rem; font-weight:800;
                                   cursor:pointer; border-right:1px solid var(--glass-border);
                                   transition:background 0.15s;">
                            🏠 LOCAL
                        </button>
                        <button id="role-btn-away"
                            onclick="_setMyTeamRole('away')"
                            style="flex:1; padding:0.45rem 0.5rem; background:rgba(255,255,255,0.04);
                                   border:none; color:var(--text-muted); font-size:0.72rem; font-weight:800;
                                   cursor:pointer; transition:background 0.15s;">
                            ✈️ VISITA
                        </button>
                    </div>
                    <input type="hidden" id="setup-my-team-role" value="home">
                </div>
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Modalidad</label>
                    <select id="setup-mode" onchange="syncSetupMode(this.value)" style="width:100%; background:var(--bg); border-color:var(--glass-border); padding:0.5rem; border-radius:8px; color:white;">
                        <option value="f7">Fútbol 7</option>
                        <option value="f11">Fútbol 11</option>
                    </select>
                </div>
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Categoría</label>
                    <select id="match-category" style="width:100%; background:var(--bg); border-color:var(--glass-border); padding:0.5rem; border-radius:8px; color:white;">
                        <!-- Se llena dinámicamente por syncSetupMode() -->
                    </select>
                </div>
                    <div style="min-width:80px;">
                        <label style="font-size:0.7rem; color:var(--text-muted); display:block; margin-bottom:4px;">Subcategoría</label>
                        <select id="match-subcategory" style="width:100%; padding:6px 8px; background:var(--surface); color:var(--text); border:1px solid var(--glass-border); border-radius:6px; font-size:0.8rem;">
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                        </select>
                    </div>
                    <script>
                    // FIX: bloquear categoria y subcategoria si el entrenador las tiene asignadas
                    (function() {
                        var me = window._cronosCurrentUser;
                        if (me && me.category) {
                            var cat = document.getElementById('match-category');
                            var sub = document.getElementById('match-subcategory');
                            if (cat) cat.disabled = true;
                            if (sub) sub.disabled = true;
                        }
                    })();
                    </script>
                <div class="form-group" style="margin:0;">
                    <label style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px; display:block;">Sistema táctico inicial</label>
                    <select id="setup-formation" style="width:100%; font-weight:700; background:var(--bg); border-color:var(--glass-border); padding:0.5rem; border-radius:8px; color:white;">
                        <option value="">-- Sin formación predefinida --</option>
                    </select>
                </div>
                <div style="display:flex; align-items:center; gap:8px; padding-bottom:2px;">
                    <input type="checkbox" id="setup-analyze-away" style="width:18px;height:18px;flex-shrink:0;">
                    <label for="setup-analyze-away" style="margin:0;cursor:pointer;white-space:nowrap;color:var(--text);" title="Actívalo para registrar también los datos del equipo contrario">
                        Analizar Contrario
                    </label>
                </div>
            </div>

            <!-- BOTONES DE ACCIÓN (5 EN UNA LÍNEA EXACTA) -->
            <div style="display:flex; flex-direction:column; gap:1.2rem;">
                
                <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:0.5rem; align-items:stretch; width:100%;">
                    ${_cronosExtraBtn('plantilla', 'GESTIONAR PLANTILLA', 'saveSetupState(); openRosterManager()', 'rgba(88,166,255,0.12); color:#58a6ff; border:1px solid rgba(88,166,255,0.4)')}
                    ${_cronosExtraBtn('contactos', '📱 CONTACTOS', 'saveSetupState(); Promise.resolve(openContactManager()).catch(function(e){ console.error(\'[Contactos] Error al abrir:\', e); if(typeof hideSpinner===\'function\') hideSpinner(); if(typeof showToast===\'function\') showToast(\'⚠️ No se pudo abrir Contactos\', 3000); });', 'rgba(255,165,0,0.12); color:#ffa500; border:1px solid rgba(255,165,0,0.4)')}
                    ${_cronosExtraBtn('convocatorias', '📋 CONVOCATORIA', 'openConvocationModal()', 'rgba(63,185,80,0.12); color:#3fb950; border:1px solid rgba(63,185,80,0.5)')}
                    ${_cronosExtraBtn('entrenamientos', '🏃 ENTRENAMIENTO', 'openTrainingPanel()', 'rgba(88,166,255,0.12); color:#58a6ff; border:1px solid rgba(88,166,255,0.4)')}
                    ${_cronosExtraBtn('informes', '📊 MIS INFORMES', 'typeof openMisInformes === \'function\' ? openMisInformes() : alert(\'Módulo en mantenimiento\')', 'rgba(255,215,0,0.12); color:#ffd700; border:1px solid rgba(255,215,0,0.4)')}
                </div>

                <!-- BOTONES PRINCIPALES: CONTINUAR + RECUPERAR + COMUNICACIONES -->
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.7rem;">
                    <button class="btn primary" onclick="confirmSetup()"
                        style="width:100%; padding:0.9rem; font-size:1rem; font-weight:900;
                               letter-spacing:0.3px; box-shadow:0 6px 20px rgba(88,166,255,0.3);
                               border-radius:10px; background:#58a6ff; color:#0d1117;
                               border:none; cursor:pointer; text-transform:uppercase;">
                        ▶️ CONTINUAR AL PARTIDO
                    </button>
                    <button class="btn" onclick="openLiveMatchRecovery()"
                        title="Recuperar un partido en curso que quedó interrumpido"
                        style="width:100%; padding:0.9rem; font-size:1rem; font-weight:900;
                               letter-spacing:0.3px; border-radius:10px;
                               background:rgba(240,136,62,0.15); color:#f0883e;
                               border:2px solid rgba(240,136,62,0.5); cursor:pointer;
                               text-transform:uppercase;">
                        🔄 RECUPERAR PARTIDO
                    </button>
                    <!-- v596 · El botón también lleva el candado. La puerta que
                         de verdad cierra está dentro de _openCoachCommsMenu; esto
                         es lo que hace que el entrenador SEPA que la función
                         existe y que es cosa de su plan, en vez de pulsar y
                         recibir un aviso (política de candados de v429). -->
                    <button class="btn" onclick="if(typeof _openCoachCommsMenu==='function') _openCoachCommsMenu();"
                        ${window._cronosExtraEnabled('comunicaciones') ? '' : 'disabled'}
                        title="${window._cronosExtraEnabled('comunicaciones')
                                 ? 'Mensajes, Partidos Terminados y Retransmisión en Vivo'
                                 : 'No disponible en el plan de tu club'}"
                        style="width:100%; padding:0.9rem; font-size:1rem; font-weight:900;
                               letter-spacing:0.3px; border-radius:10px;
                               background:rgba(180,120,200,0.15); color:#b478c8;
                               border:2px solid rgba(180,120,200,0.5); cursor:pointer;
                               text-transform:uppercase;
                               ${/* ⚠️ VA AL FINAL A PROPÓSITO: en un mismo style
                                     gana la ÚLTIMA declaración, y arriba hay un
                                     cursor:pointer que se comería este
                                     cursor:not-allowed si fuese antes. */''}
                               ${window._cronosExtraEnabled('comunicaciones') ? ''
                                 : 'opacity:0.45; filter:grayscale(1); cursor:not-allowed; box-shadow:inset 0 0 0 9999px rgba(0,0,0,0.25);'}">
                        ${window._cronosExtraEnabled('comunicaciones') ? '💬' : '🔒'} COMUNICACIONES
                    </button>
                </div>
            </div>
        </div>
    `;

    // ── Inicializaciones ──
    if (typeof populateSavedTeams === 'function') {
        populateSavedTeams('home');
        populateSavedTeams('away');
    }

    // Sincronizar categoría y formaciones con la modalidad actual
    const initialMode = document.getElementById('setup-mode')?.value || 'f7';
    if (typeof syncSetupMode === 'function') {
        syncSetupMode(initialMode);
    } else {
        // Fallback si syncSetupMode no está disponible todavía
        if (typeof updateFormationOptions === 'function') updateFormationOptions(initialMode);
        if (typeof updateCategoryOptions === 'function')  updateCategoryOptions(initialMode);
    }
    
    // Restaurar estado previo si existe
    if (typeof restoreSetupState === 'function') {
        restoreSetupState();
    }

    // ── Garantía final: sincronizar categoría con el modo REAL del select ──
    // restoreSetupState puede cambiar el modo sin disparar onchange.
    const finalMode = document.getElementById('setup-mode')?.value || 'f7';
    if (typeof updateCategoryOptions  === 'function') updateCategoryOptions(finalMode);
    if (typeof updateFormationOptions === 'function') updateFormationOptions(finalMode);

    // FIX (Error #27 CRÍTICO): forzar auto-seleccion de categoria/subcategoria
    // con múltiples reintentos retardados. El problema es que me.category se
    // asigna de forma asíncrona en _launchWithRole, y cuando openSetupModal
    // se ejecuta, me.category puede no estar disponible aún.
    function _forceCategorySelect() {
        var _me = window._cronosCurrentUser;
        if (!_me || !_me.category) return false;
        var catSel = document.getElementById('match-category');
        var subSel = document.getElementById('match-subcategory');
        if (!catSel) return false;
        var userCat = String(_me.category).toLowerCase();
        var mode = document.getElementById('setup-mode')?.value || 'f7';
        // ⚠️ v548 · LA CASCADA VIVE EN utils.js (`_cronosCategoriaValor`), y no
        // aquí: la necesita también `confirmSetup()` para imponer la categoría
        // del equipo al montar el partido. Dos copias divergirían y la pantalla
        // acabaría diciendo una cosa y el informe otra.
        // (Las dos FEM van delante dentro del resolutor: 'regional_fem'
        // contiene 'regional'.)
        var targetValue = (typeof window._cronosCategoriaValor === 'function')
            ? (window._cronosCategoriaValor(userCat, mode) || '') : '';
        // ══════════════════════════════════════════════════════════════════
        //  🔒 v548 · EL BLOQUEO ES INCONDICIONAL
        //
        //  Reportado por el autor (captura 8983): un entrenador de Prebenjamín
        //  A tenía los dos desplegables ABIERTOS y podía cambiarse de categoría
        //  a voluntad. La causa: aquí se bloqueaba sólo DENTRO de dos "ifs".
        //    · la categoría, sólo si `opt` existía —es decir, si el value
        //      construido (`f7_prebenjamin`) casaba con una opción del
        //      desplegable—; si el modo no era el suyo, o la categoría no se
        //      sabía clasificar, `opt` salía null y el select quedaba ABIERTO;
        //    · la subcategoría, sólo si era 'A', 'B' o 'C'. Cualquier otra
        //      ('D', 'Única', minúsculas…) lo dejaba abierto.
        //
        //  🔑 Si el entrenador TIENE equipo asignado, los dos selectores se
        //  cierran SIEMPRE, case o no case el valor. Que no se sepa pintar su
        //  categoría no es motivo para dejarle elegir otra.
        // ══════════════════════════════════════════════════════════════════
        if (targetValue) {
            var opt = catSel.querySelector('option[value="' + targetValue + '"]');
            if (opt) {
                catSel.value = targetValue;
                console.log('[openSetupModal] categoria forzada:', targetValue);
            } else {
                console.warn('[v548] No hay opción para "' + targetValue +
                             '"; se bloquea igualmente para que no pueda elegir otra.');
            }
        }
        catSel.disabled = true;
        catSel.title = 'Tu categoría la asigna el club y no se puede cambiar desde aquí.';

        if (subSel) {
            var userSub = String(_me.subcategory || '').toUpperCase().trim();
            if (userSub) {
                // Si su subcategoría no está entre las opciones, se AÑADE: antes
                // se descartaba y el desplegable se quedaba mostrando otra.
                if (!subSel.querySelector('option[value="' + userSub + '"]')) {
                    var o = document.createElement('option');
                    o.value = userSub; o.textContent = userSub;
                    subSel.appendChild(o);
                }
                subSel.value = userSub;
                console.log('[openSetupModal] subcategoria forzada:', userSub);
            }
            subSel.disabled = true;
            subSel.title = catSel.title;
        }
        return true;
    }
    // ⚠️ v548 · LOS REINTENTOS CORREN SIEMPRE, no sólo cuando el primero falla.
    //    `syncSetupMode()` repuebla el desplegable de categorías a los ~100 ms
    //    (`catSel.innerHTML = …`), y eso BORRA el valor seleccionado. Con la
    //    condición anterior, si el primer intento acertaba no había reintento y
    //    el entrenador acababa viendo una categoría que no era la suya.
    _forceCategorySelect();
    setTimeout(_forceCategorySelect, 200);
    setTimeout(_forceCategorySelect, 500);
    setTimeout(_forceCategorySelect, 1000);
    setTimeout(_forceCategorySelect, 2000);

    // ── Sincronizar categoría cuando se carga un equipo guardado ──
    // loadTeamFromDropdown() asigna modeEl.value programáticamente,
    // lo que NO dispara el evento onchange del select.
    // Por eso añadimos un listener adicional que sincroniza la categoría
    // 50ms después de que loadTeamFromDropdown haya terminado.
    ['home', 'away'].forEach(function(key) {
        var savedSel = document.getElementById('saved-teams-' + key);
        if (savedSel && !savedSel._cronosCatSync) {
            savedSel._cronosCatSync = true;
            savedSel.addEventListener('change', function() {
                setTimeout(function() {
                    var modeEl = document.getElementById('setup-mode');
                    var mode   = modeEl ? modeEl.value : 'f7';
                    if (typeof updateCategoryOptions  === 'function') updateCategoryOptions(mode);
                    if (typeof updateFormationOptions === 'function') updateFormationOptions(mode);
                }, 50);
            });
        }
    });
}

function saveSetupState() {
    window._pendingSetupState = {
        homeName:      document.getElementById('setup-home-name')?.value  || '',
        homeColor:     document.getElementById('setup-home-color')?.value || '#58a6ff',
        homeShorts:    document.getElementById('setup-home-shorts')?.value|| '#ffffff',
        homeText:      document.getElementById('setup-home-text')?.value  || '#ffffff',
        awayName:      document.getElementById('setup-away-name')?.value  || '',
        awayColor:     document.getElementById('setup-away-color')?.value || '#ff5858',
        awayShorts:    document.getElementById('setup-away-shorts')?.value|| '#000000',
        awayText:      document.getElementById('setup-away-text')?.value  || '#ffffff',
        mode:          document.getElementById('setup-mode')?.value       || 'f7',
        category:      document.getElementById('match-category')?.value   || '',
        subcategory: document.getElementById('match-subcategory')?.value || 'A',
        formation:     document.getElementById('setup-formation')?.value  || '',
        analyzeAway:   document.getElementById('setup-analyze-away')?.checked || false,
        myTeamRole:    document.getElementById('setup-my-team-role')?.value || 'home',
    };
}

function restoreSetupState() {
    const s = window._pendingSetupState;
    if (!s) return;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    set('setup-home-name',    s.homeName);
    set('setup-home-color',   s.homeColor);
    set('setup-home-shorts',  s.homeShorts);
    set('setup-home-text',    s.homeText);
    set('setup-away-name',    s.awayName);
    set('setup-away-color',   s.awayColor);
    set('setup-away-shorts',  s.awayShorts);
    set('setup-away-text',    s.awayText);
    set('setup-mode',         s.mode);
    const analyzeEl = document.getElementById('setup-analyze-away');
    if (analyzeEl) analyzeEl.checked = s.analyzeAway;

    // Restaurar selector de rol
    if (s.myTeamRole && typeof _setMyTeamRole === 'function') {
        _setMyTeamRole(s.myTeamRole);
    }
    
    // Actualizar formaciones y categoría según la modalidad restaurada
    if (typeof updateFormationOptions === 'function') updateFormationOptions(s.mode);
    if (typeof updateCategoryOptions === 'function') updateCategoryOptions(s.mode);

    // Restaurar categoría si coincide con la modalidad
    // FIX: NO sobrescribir si el entrenador tiene me.category asignada
    const me = window._cronosCurrentUser;
    const userHasCategory = me && me.category;
    const categoryMatchesMode = s.category && s.category.startsWith(s.mode + '_');
    if (categoryMatchesMode && !userHasCategory) {
        set('match-category', s.category);
        set('match-subcategory', s.subcategory || 'A');
    }
    if (userHasCategory && typeof updateCategoryOptions === 'function') {
        updateCategoryOptions(s.mode);
    }
    set('setup-formation', s.formation);
    window._pendingSetupState = null;
}

function confirmSetup() {
    TEAM_NAMES.home = document.getElementById('setup-home-name').value.toUpperCase() || 'LOCAL';
    COLORS.home.primary = document.getElementById('setup-home-color').value;
    COLORS.home.shorts = document.getElementById('setup-home-shorts').value;
    COLORS.home.text = document.getElementById('setup-home-text').value;

    TEAM_NAMES.away = document.getElementById('setup-away-name').value.toUpperCase() || 'VISITANTE';
    COLORS.away.primary = document.getElementById('setup-away-color').value;
    COLORS.away.shorts = document.getElementById('setup-away-shorts').value;
    COLORS.away.text = document.getElementById('setup-away-text').value;

    currentMode = document.getElementById('setup-mode').value;
    analyzeAway = document.getElementById('setup-analyze-away').checked;
    selectedFormationOnStart = document.getElementById('setup-formation')?.value || '';

    // ── Leer rol del equipo del entrenador (LOCAL o VISITANTE) ──
    const myRoleEl = document.getElementById('setup-my-team-role');
    window._userTeamRole = myRoleEl ? (myRoleEl.value || 'home') : 'home';

    // NOTA: NO se fuerza analyzeAway al jugar de visitante. "Analizar Contrario"
    // (analyzeAway) controla EXCLUSIVAMENTE si se dibuja también el equipo rival.
    // El equipo del entrenador se crea siempre (sea 'home' o 'away') en
    // spawnInitialPlayers(). Forzarlo aquí dibujaba ambos equipos de visitante
    // aunque el checkbox estuviera desactivado.

    if (!selectedFormationOnStart) {
        selectedFormationOnStart = currentMode === 'f7' ? '231' : '442';
        const formationEl = document.getElementById('setup-formation');
        if (formationEl) formationEl.value = selectedFormationOnStart;
    }

    document.getElementById('team-a-name').textContent = TEAM_NAMES.home;
    document.getElementById('team-b-name').textContent = TEAM_NAMES.away;

    // hide-visitor: oculta la banca del equipo CONTRARIO y agranda el campo.
    // role-away: cuando juego de visitante mi banca está en la sidebar derecha,
    // así el CSS sabe que debe ocultar la izquierda (home) en vez de la derecha.
    document.body.classList.toggle('role-away', window._userTeamRole === 'away');
    if (!analyzeAway) {
        document.body.classList.add('hide-visitor');
    } else {
        document.body.classList.remove('hide-visitor');
    }

    document.body.classList.toggle('mode-f11', currentMode === 'f11');

    const catEl = document.getElementById('match-category');
    let category = catEl ? catEl.value : 'f7_prebenjamin';

    // ══════════════════════════════════════════════════════════════════
    //  🔒 v548 · LA CATEGORÍA DEL PARTIDO LA MANDA EL EQUIPO ASIGNADO
    //
    //  ⚠️ `disabled` en un <select> es COSMÉTICO: se quita desde las
    //  herramientas del navegador en dos clics. Si el partido se montara con
    //  lo que diga el desplegable, el bloqueo visual no garantizaría nada — y
    //  el autor pidió que no se pueda alterar "bajo ningún concepto".
    //
    //  🔑 Aquí es donde la categoría deja de ser un adorno y pasa a marcar el
    //  informe, el equipo (cronosTeamId) y los umbrales del semáforo. Así que
    //  se impone la del entrenador, venga como venga el DOM.
    //
    //  Sólo aplica a quien TIENE equipo asignado: el director, el coordinador
    //  y el SuperAdmin en pruebas siguen eligiendo con libertad.
    //
    // ══════════════════════════════════════════════════════════════════
    //  🏷️ v562 · LAS DOS MITADES DEL EQUIPO, DE LA MISMA FUENTE
    //
    //  Reporte del autor (capturas 9077/9078/9083): con **Regional A**
    //  asignado, el panel en vivo rotulaba **"Regional C"**.
    //
    //  🔑🔑🔑 Medido en los 10 partidos del respaldo: en los DIEZ, la
    //  subcategoría del partido era IDÉNTICA a la del PERFIL; la categoría, en
    //  cambio, sí seguía al panel. Aquí estaba el porqué: se resolvían por
    //  CASCADAS DISTINTAS —la categoría con `_cronosCategoriaValor(_miCat)` y
    //  la subcategoría con `_me.subcategory` a pelo—, así que en cuanto las dos
    //  dejaban de describir el mismo equipo salía la mezcla: la categoría de
    //  uno con la letra del otro.
    //
    //  Ahora las dos salen de `cronosParCategoriaDelPanel()`, que las devuelve
    //  como PAREJA de una sola rama. Si no hay equipo asignado devuelve null y
    //  el panel decide, como siempre.
    // ══════════════════════════════════════════════════════════════════
    let _subImpuesta = null;
    try {
        const _me = window._cronosCurrentUser;
        const _miCat = _me && (_me.category || _me.categoryLabel);
        if (_miCat && catEl && catEl.disabled) {
            const _modo = document.getElementById('setup-mode')?.value || currentMode || 'f7';
            const _par = (typeof window.cronosParCategoriaDelPanel === 'function')
                ? window.cronosParCategoriaDelPanel(_modo) : null;
            const _esperado = (_par && _par.valorPanel) ||
                ((typeof window._cronosCategoriaValor === 'function')
                    ? window._cronosCategoriaValor(_miCat, _modo) : null);
            const _real = _esperado || catEl.value;
            if (_real && _real !== category) {
                console.warn('[v548] La categoría del desplegable ("' + category +
                             '") no es la del equipo asignado; se impone "' + _real + '".');
                category = _real;
                catEl.value = _real;
            }
            const _subEl = document.getElementById('match-subcategory');
            // 🔑 LA SUBCATEGORÍA SALE DEL MISMO SITIO QUE LA CATEGORÍA. Sólo se
            // cae a `_me.subcategory` si el resolutor no supo formar la pareja.
            const _miSub = (_par && _par.subcategory)
                || (_me.subcategory ? String(_me.subcategory).toUpperCase().trim() : '');
            if (_miSub) {
                _subImpuesta = _miSub;
                if (_subEl && _subEl.value !== _miSub) {
                    // Si no está entre las opciones se AÑADE: dejarla fuera hacía
                    // que el desplegable siguiera enseñando otra letra.
                    if (!_subEl.querySelector('option[value="' + _miSub + '"]')) {
                        const _o = document.createElement('option');
                        _o.value = _miSub; _o.textContent = _miSub;
                        _subEl.appendChild(_o);
                    }
                    console.warn('[v562] Subcategoría corregida a la del equipo asignado: ' + _miSub);
                    _subEl.value = _miSub;
                }
            }
        }
    } catch (e) { console.warn('[v548] No se pudo imponer la categoría del equipo:', e); }

    // ⚠️ SE ESCRIBEN JUNTAS Y EN EL MISMO INSTANTE. Son el par que después lee
    // `pushLiveSnapshot` para sellar el documento del partido: si una se
    // actualizara sin la otra, el partido volvería a nacer con la categoría de
    // un equipo y la letra de otro.
    window._currentMatchCategory = category;
    window._currentMatchSubcategory =
        _subImpuesta || document.getElementById('match-subcategory')?.value || 'A';
    let defaultTime = 30;

    if (category.includes('prebenjamin')) {
        defaultTime = 30;
    } else if (category.includes('futurefem')) {
        defaultTime = 35;               // F7, 2T x 35' (decisión del autor)
    } else if (category.includes('benjamin') || category.includes('alevin')) {
        defaultTime = 35;
    } else if (category.includes('infantil') || category.includes('cadete')) {
        defaultTime = 40;
    } else if (category.includes('juvenil') || category.includes('regional')) {
        defaultTime = 45;
    } else if (currentMode === 'f11') {
        defaultTime = 40;
    } else {
        defaultTime = 30;
    }

    half1MaxTime = defaultTime * 60;
    half2MaxTime = defaultTime * 60;

    // ── Actualizar display del cronómetro inmediatamente ──
    (function syncTimerDisplay() {
        var mins = defaultTime;
        var display = (mins < 10 ? '0' : '') + mins + ':00';
        var t1 = document.getElementById('timer-h1');
        var t2 = document.getElementById('timer-h2');
        if (t1) t1.textContent = display;
        if (t2) t2.textContent = display;
    })();

    openConvocationModal();
}

// ── Cambiar rol visual del equipo del entrenador ──
function _setMyTeamRole(role) {
    const hiddenEl = document.getElementById('setup-my-team-role');
    if (hiddenEl) hiddenEl.value = role;

    const btnHome = document.getElementById('role-btn-home');
    const btnAway = document.getElementById('role-btn-away');

    if (role === 'home') {
        if (btnHome) { btnHome.style.background = 'rgba(29,78,216,0.55)'; btnHome.style.color = 'white'; }
        if (btnAway) { btnAway.style.background = 'rgba(255,255,255,0.04)'; btnAway.style.color = 'var(--text-muted)'; }
    } else {
        if (btnAway) { btnAway.style.background = 'rgba(185,28,28,0.45)'; btnAway.style.color = 'white'; }
        if (btnHome) { btnHome.style.background = 'rgba(255,255,255,0.04)'; btnHome.style.color = 'var(--text-muted)'; }
    }

    // Guardar en _pendingSetupState para persistencia
    if (!window._pendingSetupState) window._pendingSetupState = {};
    window._pendingSetupState.myTeamRole = role;
}

// ════════════════════════════════════════════════════════════════════
//  v441 · UNA SOLA TARJETA POR PARTIDO EN "RECUPERAR PARTIDO EN CURSO"
//
//  Reporte del autor: al salir y volver a entrar, el mismo partido salía DOS
//  veces —una con la etiqueta "DISPOSITIVO LOCAL" y otra con "NUBE"—, y hay que
//  elegir entre dos tarjetas que son lo mismo.
//
//  🔑 POR QUÉ NO BASTABA EL DEDUP QUE YA HABÍA. Existía, pero comparaba
//  ÚNICAMENTE el identificador: `localMatch.liveMatchId === d.id`. Basta con que
//  el id guardado en el dispositivo no coincida con el del documento de la nube
//  para que el filtro no vea nada y salgan las dos. Y hay más de una forma de
//  que no coincida: que el estado se guardara antes de que `startLiveSync`
//  asignara el id (arranca 800 ms después de pintar a los jugadores), o que el
//  partido se reanudara sin pasar por "Retomar", en cuyo caso `startLiveSync`
//  lo trata como partido NUEVO y genera otro id —lleva la hora y el minuto en
//  el sufijo— dejando el documento anterior huérfano en la nube.
//
//  🔑 LA IDENTIDAD QUE SÍ AGUANTA: dentro de este panel, dos entradas con los
//  MISMOS equipos y la misma modalidad son el mismo partido. No es una
//  suposición: las dos fuentes ya vienen filtradas por el límite de duración
//  (80 min en F-7, 110/120 en F-11), así que la lista sólo puede contener
//  partidos de las últimas dos horas y no se puede jugar dos veces el mismo
//  enfrentamiento en esa ventana. El id sigue valiendo como segunda vía: si
//  coincide, fusiona aunque alguien haya renombrado un equipo a mitad.
//
//  Se fusiona en vez de descartar una fuente porque cada una sabe algo que la
//  otra no: el dispositivo tiene el estado más fresco cuando se perdió la
//  cobertura, y la nube lo tiene cuando el partido se siguió desde otro
//  aparato. Se muestra la MÁS RECIENTE y se ofrece un único "Retomar".
// ════════════════════════════════════════════════════════════════════
function _recoveryNorm(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Momento del último guardado, en milisegundos. Es lo que decide qué fuente
// manda cuando el mismo partido está en las dos.
function _recoveryTs(c) {
    if (!c) return 0;
    if (c.isLocal) return new Date(c.savedAt || 0).getTime() || 0;
    const u = c.updatedAt;
    if (u && typeof u.toMillis === 'function') return u.toMillis() || 0;
    if (u && typeof u.toDate === 'function') return u.toDate().getTime() || 0;
    return new Date(c.savedAt || u || 0).getTime() || 0;
}

// Las claves por las que dos candidatos son el MISMO partido.
function _recoveryClaves(c) {
    const claves = [];
    const id = c.isLocal ? c.liveMatchId : c._id;
    if (id) claves.push('id:' + id);
    const home = _recoveryNorm(c.homeTeam && c.homeTeam.name);
    const away = _recoveryNorm(c.awayTeam && c.awayTeam.name);
    // Sin nombres de equipo no hay identidad por equipos: se queda sólo con el
    // id. Fusionar dos partidos "sin nombre" sería peor que enseñar dos.
    if (home || away) claves.push('eq:' + home + '|' + away + '|' + (c.mode || 'f7'));
    return claves;
}

// Fusiona las dos fuentes en UNA entrada por partido. Función pura: no toca el
// DOM ni Firestore, para poder ejercitarla en el guard.
//   Devuelve [{ datos, tieneLocal, idsNube, ts }] ordenado por ts descendente.
// v465 · El primer argumento admite UN candidato local o una LISTA de ellos.
// Antes sólo podía haber uno porque el estado local vivía en una clave única;
// desde v465 hay una ranura por partido y un entrenador puede tener dos o tres
// abiertos a la vez, así que el panel tiene que poder enseñarlos todos. Se
// mantiene la forma de un solo candidato porque es como lo llama el guard
// scripts/test_recovery_merge.js, que comprueba la fusión en sí.
function _fusionaCandidatosRecuperacion(localMatch, docsNube) {
    const entradas = [];
    const porClave = new Map();

    const meter = (cand) => {
        if (!cand) return;
        const claves = _recoveryClaves(cand);
        let destino = null;
        for (const k of claves) {
            if (porClave.has(k)) { destino = porClave.get(k); break; }
        }
        if (!destino) {
            // `nJug` = cuántos jugadores trae la foto elegida. Decide junto con
            // `ts` cuál se enseña y cuál se retoma (ver la nota de v588 abajo).
            destino = { datos: null, tieneLocal: false, idsNube: [], idsLocal: [], ts: -1, nJug: 0 };
            entradas.push(destino);
        }
        // TODAS las claves del candidato apuntan ya a esta entrada: así un
        // tercer candidato que coincida por cualquiera de ellas también cae
        // aquí (el local casa por equipos, y el segundo documento de nube por
        // id con el primero).
        for (const k of claves) porClave.set(k, destino);

        if (cand.isLocal) {
            destino.tieneLocal = true;
            // v465 · QUÉ ranura local es. Con varios partidos abiertos,
            // "tiene local" ya no basta para borrarlo: hay que saber CUÁL, o
            // el botón de eliminar se llevaría por delante el partido
            // equivocado.
            if (cand._slotId && destino.idsLocal.indexOf(cand._slotId) === -1) {
                destino.idsLocal.push(cand._slotId);
            }
        }
        else if (cand._id && destino.idsNube.indexOf(cand._id) === -1) destino.idsNube.push(cand._id);

        // ══════════════════════════════════════════════════════════════
        //  🔴🔴🔴 v588 · UNA FUENTE SIN JUGADORES NUNCA GANA A UNA QUE LOS TIENE
        //
        //  Reporte del autor (captura 9293): retomó el partido y **el campo
        //  salió vacío, sin ningún convocado**.
        //
        //  🔑 Aquí estaba: lo que se enseña —y lo que se retoma— salía de la
        //  fuente MÁS RECIENTE, sin mirar nada más. Y la más reciente puede ser
        //  justo la que no tiene la alineación: el estado se guarda también en
        //  momentos en que `players` aún está vacío (el arranque de la sincro
        //  ocurre 800 ms después de pintar a los jugadores, y cualquier
        //  guardado en esa ventana escribe una foto sin nadie). Un segundo de
        //  diferencia decidía entre recuperar el partido entero o un campo en
        //  blanco.
        //
        //  🔑 LA REGLA: entre dos fotos del MISMO partido, la que trae
        //  alineación gana siempre; y sólo entre iguales decide la hora. Es la
        //  misma lección de v582 —un registro vacío no describe nada— aplicada
        //  al reloj en vez de a la categoría.
        //
        //  ⚠️ No se MEZCLAN las dos fuentes (jugadores de una, marcador de
        //  otra): eso construiría un partido que nunca existió. Se elige una
        //  foto entera, la que de verdad describe el partido.
        // ══════════════════════════════════════════════════════════════
        const ts = _recoveryTs(cand);
        const nJug = (Array.isArray(cand.players) ? cand.players.length : 0);
        const mejorQueLoQueHay =
            (destino.datos === null) ||
            (nJug > 0 && destino.nJug === 0) ||          // trae alineación y lo de ahora no
            ((nJug > 0) === (destino.nJug > 0) && ts > destino.ts);  // empate: manda la hora
        if (mejorQueLoQueHay) { destino.datos = cand; destino.nJug = nJug; }
        // El sello de tiempo de la ENTRADA es siempre el más reciente de sus
        // fuentes: ordena la lista y no debe retroceder por elegir otra foto.
        if (ts > destino.ts) destino.ts = ts;
    };

    if (Array.isArray(localMatch)) localMatch.forEach(meter);
    else meter(localMatch);
    (docsNube || []).forEach(meter);

    entradas.sort((a, b) => b.ts - a.ts);
    return entradas;
}
window._fusionaCandidatosRecuperacion = _fusionaCandidatosRecuperacion;

// ════════════════════════════════════════════════════════════════════
//  🧹 v561 · FUERA LAS RANURAS QUE NO PUEDEN SER UN PARTIDO
//
//  Encargo del autor (captura 9075): que el panel valide la modalidad y el
//  número de jugadores contra la categoría real y no enseñe ranuras cruzadas.
//
//  🔑 PERO EL CRITERIO NO PUEDE SER "INCOHERENTE = SE TIRA". Medido en
//  producción, la tarjeta que él tomó por fantasma era un partido REAL —el del
//  Regional A— con la etiqueta del otro equipo: descartarla habría dejado un
//  partido en curso irrecuperable, que es peor que la confusión que venía a
//  arreglar. Etiquetarlo bien ya deshace la duplicación.
//
//  Así que sólo se descarta lo que NO PUEDE SER UN PARTIDO: datos cruzados **y**
//  ni un segundo jugado, ni un gol, ni un jugador. Eso no es un partido que
//  alguien quiera retomar: es un resto. Todo lo que tenga juego se enseña, con
//  su aviso.
//
//  Función pura: no toca el DOM ni Firestore, para poder ejercitarla entera en
//  el guard.
// ════════════════════════════════════════════════════════════════════
function _cronosDescartaRanurasImposibles(entradas) {
    if (!Array.isArray(entradas)) return [];
    return entradas.filter(entrada => {
        try {
            // ⚠️ UNA ENTRADA ROTA NO ES UNA RANURA VACÍA. Si ni siquiera hay
            //    objeto de datos, este filtro no tiene nada que juzgar: se
            //    ENSEÑA. Perder un partido por un fallo del propio filtro es
            //    peor que enseñar una tarjeta rara — es la regla que fija la
            //    aserción 3d de test_recuperar_sin_ranuras_fantasma.js, y la
            //    primera versión de v589 la rompió al tratar "sin datos" y
            //    "datos que dicen que no hay nada" como lo mismo.
            if (!entrada || !entrada.datos || typeof entrada.datos !== 'object') return true;

            const m = entrada.datos;
            const ident = (typeof window.cronosIdentidadDelPartido === 'function')
                ? window.cronosIdentidadDelPartido(m) : null;

            const jugado = (Number(m.timeH1) || 0) + (Number(m.timeH2) || 0);
            const goles  = (Number(m.homeTeam && m.homeTeam.score) || 0) +
                           (Number(m.awayTeam && m.awayTeam.score) || 0);
            const jugadores = (Number(m.playerCount) || 0) ||
                              (Array.isArray(m.players) ? m.players.length : 0);
            const vacia = jugado === 0 && goles === 0 && jugadores === 0;

            // ══════════════════════════════════════════════════════════
            //  🔴 v589 · UNA RANURA VACÍA NO ES UN PARTIDO, SEA COHERENTE
            //            O NO
            //
            //  Reporte del autor (captura 9296): tres tarjetas y sólo una
            //  servía. Una de las inútiles era "LOCAL 0–0 · 00:00 · 0
            //  jugadores" — perfectamente coherente, así que este filtro ni
            //  la miraba: exigía PRIMERO que fuera incoherente.
            //
            //  🔑 Pero el criterio que importa no es la coherencia, es si hay
            //  algo que recuperar. Sin jugadores, sin tiempo y sin goles no
            //  hay partido: retomarla da un campo vacío, exactamente igual
            //  que empezar de cero. No puede aportar nada, así que no debe
            //  ocupar sitio ni hacer dudar a nadie con prisa.
            // ══════════════════════════════════════════════════════════
            if (vacia) {
                console.warn('[v589] Ranura descartada (sin nada que recuperar): ' +
                             ((ident && !ident.coherente) ? ident.motivos.join(' · ') : 'vacía'));
                return false;
            }
            // ⚠️ UNA RANURA INCOHERENTE **CON JUEGO** NO SE DESCARTA AQUÍ.
            //    Un partido con 15 minutos y 18 fichas es trabajo real: hacerlo
            //    desaparecer sería peor que enseñarlo con su aviso. Se aparta
            //    en el render, plegado, para no competir con la copia buena
            //    (ver `_recuperacionSeparaDudosas`).
            return true;
        } catch (e) { return true; }   // ante la duda, se ENSEÑA
    });
}
window._cronosDescartaRanurasImposibles = _cronosDescartaRanurasImposibles;

// ════════════════════════════════════════════════════════════════════
//  🔴 v589 · SÓLO LA COPIA BUENA A LA VISTA
//
//  Reporte del autor (captura 9296): "El usuario va con prisa y no puede
//  ponerse a adivinar cuál sirve". Tenía tres tarjetas y sólo una servía.
//
//  🔑 Se separan en dos grupos: las FIABLES —con alineación y sin datos
//  cruzados— y las DUDOSAS. Se enseñan sólo las fiables; las dudosas quedan
//  plegadas detrás de un "ver copias descartadas".
//
//  ⚠️⚠️ NO SE BORRAN NI SE OCULTAN DEL TODO, Y ES DELIBERADO. Una copia con
//  15 minutos jugados y 18 fichas es trabajo real de un entrenador, aunque
//  declare mal la modalidad. Hacerla desaparecer para "no confundir" sería
//  cambiar una confusión por una pérdida — y la pérdida no se puede deshacer.
//  Plegada cumple lo que se pide (a la vista queda UNA) sin cerrar la puerta.
//
//  ⚠️ Y SI TODAS SON DUDOSAS, SE ENSEÑAN TODAS. Esconder la única opción que
//  hay dejaría al entrenador sin ninguna, que es el peor resultado posible.
// ════════════════════════════════════════════════════════════════════
function _recuperacionSeparaDudosas(entradas) {
    const fiables = [], dudosas = [];
    (entradas || []).forEach(entrada => {
        const m = (entrada && entrada.datos) || {};
        let coherente = true;
        try {
            const ident = (typeof window.cronosIdentidadDelPartido === 'function')
                ? window.cronosIdentidadDelPartido(m) : null;
            if (ident && ident.coherente === false) coherente = false;
        } catch (e) { /* ante la duda, fiable */ }
        const jugadores = (Number(m.playerCount) || 0) ||
                          (Array.isArray(m.players) ? m.players.length : 0);
        if (coherente && jugadores > 0) fiables.push(entrada);
        else dudosas.push(entrada);
    });
    // Sin ninguna fiable, las dudosas dejan de serlo: es lo único que hay.
    if (!fiables.length) return { fiables: dudosas, dudosas: [] };
    return { fiables: fiables, dudosas: dudosas };
}
window._recuperacionSeparaDudosas = _recuperacionSeparaDudosas;

// ════════════════════════════════════════════════════════════════════
//  RECUPERAR PARTIDO EN CURSO
//  Consulta live_matches en Firestore filtrando por coachUid actual
//  y status === 'active'. Muestra un panel para retomar el partido.
// ════════════════════════════════════════════════════════════════════
async function openLiveMatchRecovery() {
    // Pila de navegación (js/core/nav-stack.js).
    if (typeof navScreen === 'function') navScreen('openLiveMatchRecovery');

    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!me || !fa || !fa.db) {
        if (typeof showToast === 'function') showToast('⚠️ Debes estar autenticado para recuperar un partido', 3000);
        return;
    }

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,620px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;">

        <!-- Cabecera -->
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:1rem;flex-shrink:0;">
            <h2 style="margin:0;font-size:1.1rem;">🔄 Recuperar Partido en Curso</h2>
            <button onclick="openSetupModal()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.4rem;cursor:pointer;">✕</button>
        </div>

        <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 1rem;flex-shrink:0;">
            Aquí aparecen los partidos que iniciaste y no finalizaste correctamente.
            Pulsa <strong style="color:#f0883e;">Retomar</strong> para volver al partido en el punto en que lo dejaste.
        </p>

        <div id="live-recovery-list"
             style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:0.6rem;">
            <div style="text-align:center;color:var(--text-muted);padding:2rem;">⏳ Buscando partidos…</div>
        </div>

        <div style="margin-top:1rem;padding-top:0.8rem;border-top:1px solid var(--glass-border);flex-shrink:0;">
            <button onclick="openSetupModal()" class="btn"
                style="color:var(--text-muted);width:100%;">← Volver al menú</button>
        </div>
    </div>`;

    // 1. Obtener y validar los partidos locales.
    // v465 · Ya no es UNO: hay una ranura por partido (js/core/match-slots.js),
    // porque un entrenador puede tener el Alevín y el Juvenil abiertos a la vez.
    // El panel tiene que enseñarlos TODOS o el segundo sería irrecuperable.
    const localMatches = [];
    const now = Date.now();

    const _ranuras = window._cronosMatchSlots ? window._cronosMatchSlots.listar() : [];
    for (const _ranura of _ranuras) {
        try {
            const parsed = _ranura.state;
            if (parsed && parsed.savedAt && parsed.matchPhase !== 'finished') {
                const mode = parsed.currentMode || 'f7';
                const cat = (parsed.category || '').toLowerCase();
                let limitMins = 80; // Fútbol 7 por defecto: 80 min

                if (mode === 'f11') {
                    if (cat.includes('juvenil') || cat.includes('regional') || cat.includes('senior') || cat.includes('aficionado') || cat.includes('preferente') || cat.includes('primera') || cat.includes('segunda')) {
                        limitMins = 120; // 120 min
                    } else if (cat.includes('cadete') || cat.includes('infantil')) {
                        limitMins = 110; // 110 min
                    } else {
                        limitMins = 120; // Default F-11: 120 min
                    }
                } else {
                    limitMins = 80; // F-7 / F-8: 80 min
                }

                const startTimestamp = parsed.createdAt ? new Date(parsed.createdAt).getTime() : new Date(parsed.savedAt).getTime();
                const elapsedSec = (now - startTimestamp) / 1000;
                const LIMIT_SEC = limitMins * 60;

                if (elapsedSec <= LIMIT_SEC) {
                    localMatches.push({
                        // El _id sigue siendo el marcador de "esto es local"; lo
                        // que identifica la RANURA concreta es `_slotId`, y es
                        // lo que necesita el botón de eliminar para no llevarse
                        // el partido de al lado.
                        _id: 'local_active',
                        _slotId: _ranura.id,
                        isLocal: true,
                        liveMatchId: parsed.liveMatchId,
                        savedAt: parsed.savedAt,
                        createdAt: parsed.createdAt,
                        homeTeam: { name: parsed.teamNames?.home || 'LOCAL', score: parseInt(parsed.scoreHome) || 0 },
                        awayTeam: { name: parsed.teamNames?.away || 'VISITANTE', score: parseInt(parsed.scoreAway) || 0 },
                        mode: parsed.currentMode,
                        phase: parsed.matchPhase,
                        timeH1: parsed.masterTimeH1,
                        timeH2: parsed.masterTimeH2,
                        playerCount: Array.isArray(parsed.players) ? parsed.players.length : 0,
                        // v561 · en la ranura local, `category` YA es la del
                        // PARTIDO (sale del desplegable de creación). Se pasa
                        // también como `matchCategory` para que el resolutor de
                        // identidad la vea con el mismo nombre que en la nube.
                        category: parsed.category || '',
                        matchCategory: parsed.category || '',
                        teamId: parsed.teamId || '',
                        // Los jugadores en crudo: `cronosIdentidadDelPartido`
                        // necesita contarlos POR EQUIPO, no en total.
                        players: Array.isArray(parsed.players) ? parsed.players : null,
                    });
                } else {
                    // Expiró localmente — se cierra SÓLO esta ranura.
                    window._cronosMatchSlots?.cerrar(_ranura.id, false);
                }
            }
        } catch (e) {
            console.warn('[Recovery] Error al analizar partido local:', e);
        }
    }

    // 2. Cargar partidos activos desde Firestore y combinarlos con el local
    try {
        const { collection, getDocs, query, where } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const q = query(
            collection(fa.db, 'live_matches'),
            where('createdBy', '==', me.uid),
            where('status', '==', 'active')
        );

        const snap = await getDocs(q);
        const list = document.getElementById('live-recovery-list');
        if (!list) return;

        const docsNube = [];

        snap.forEach(d => {
            const data = d.data();
            let isExpired = false;

            // Calcular límite dinámico según modalidad y categoría
            const mode = data.mode || 'f7';
            const cat = (data.category || '').toLowerCase();
            let limitMins = 80;

            if (mode === 'f11') {
                if (cat.includes('juvenil') || cat.includes('regional') || cat.includes('senior') || cat.includes('aficionado') || cat.includes('preferente') || cat.includes('primera') || cat.includes('segunda')) {
                    limitMins = 120;
                } else if (cat.includes('cadete') || cat.includes('infantil')) {
                    limitMins = 110;
                } else {
                    limitMins = 120;
                }
            } else {
                limitMins = 80;
            }

            const docMaxAgeMs = limitMins * 60 * 1000;

            if (data.createdAt) {
                const createdTime = new Date(data.createdAt).getTime();
                if (!isNaN(createdTime) && (now - createdTime > docMaxAgeMs)) {
                    isExpired = true;
                }
            }

            if (isExpired) {
                _doDeleteLiveMatch(d.id, null, true);
            } else {
                // v441: ya NO se descarta aquí el documento que coincide con el
                // local. La fusión se hace después, en un solo sitio y con una
                // identidad que no depende de que los ids coincidan.
                docsNube.push({ _id: d.id, ...data });
            }
        });

        // v441 · Las dos fuentes se funden en UNA entrada por partido, ordenadas
        // por la más recientemente guardada.
        const entradas = _cronosDescartaRanurasImposibles(
            _fusionaCandidatosRecuperacion(localMatches, docsNube));

        if (entradas.length === 0) {
            list.innerHTML = `
            <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:0.8rem;">✅</div>
                <div style="font-size:0.9rem;font-weight:600;">No hay partidos en curso</div>
                <div style="font-size:0.78rem;margin-top:0.4rem;">
                    Todos tus partidos han sido finalizados correctamente.
                </div>
            </div>`;
            return;
        }

        // v589 · A la vista, sólo las copias fiables. Las dudosas van plegadas.
        const _grupos = _recuperacionSeparaDudosas(entradas);
        const _pintaEntrada = (entrada) => {
            // `m` son los datos de la fuente MÁS RECIENTE de esta entrada; la
            // procedencia (dispositivo, nube o ambas) va aparte.
            const m = entrada.datos;
            const updTs = entrada.ts > 0 ? entrada.ts : 0;
            const updStr = updTs
                ? new Date(updTs).toLocaleString('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
                : '—';
            const scoreH = m.homeTeam?.score ?? 0;
            const scoreA = m.awayTeam?.score ?? 0;
            const homeName = m.homeTeam?.name || 'LOCAL';
            const awayName = m.awayTeam?.name || 'VISITANTE';
            const phase = m.phase === '2nd_half' ? '2ª Parte' : '1ª Parte';
            const minsH1 = Math.floor((m.timeH1 || 0) / 60).toString().padStart(2,'0');
            const secsH1 = ((m.timeH1 || 0) % 60).toString().padStart(2,'0');
            const minsH2 = Math.floor((m.timeH2 || 0) / 60).toString().padStart(2,'0');
            const secsH2 = ((m.timeH2 || 0) % 60).toString().padStart(2,'0');
            const timeStr = m.phase === '2nd_half' ? `${minsH2}:${secsH2}` : `${minsH1}:${secsH1}`;
            // v441: `playerCount` sólo lo trae la fuente del dispositivo; el
            // documento de la nube guarda el array `players`. Antes toda tarjeta
            // de nube decía "0 jugadores", y ahora la fusión puede elegir esa
            // fuente, así que el recuento se saca de donde esté.
            const playerCount = m.playerCount || (Array.isArray(m.players) ? m.players.length : 0);
            // ══════════════════════════════════════════════════════════════
            //  🪪 v561 · LA TARJETA SE IDENTIFICA POR EL PARTIDO, NO POR EL
            //  PERFIL DEL ENTRENADOR (captura 9075)
            //
            //  Aquí nacía la "duplicación del Alevín C": la etiqueta salía de
            //  `m.category`, que en el documento de la nube es la categoría del
            //  PERFIL cuando se escribió el latido. A una entrenadora con dos
            //  equipos eso le ponía "Alevín" también al partido del Regional, y
            //  la modalidad venía del campo `mode`, así que la tarjeta decía
            //  "Alevín · F-11 · 18 jugadores" — un equipo que no existe.
            //
            //  Ahora las tres cosas —etiqueta, modalidad y coherencia— salen
            //  del MISMO resolutor (`cronosIdentidadDelPartido`, utils.js), que
            //  antepone `matchCategory`. Las dos tarjetas pasan a leerse
            //  "Alevín C" y "Regional A": no sobraba una tarjeta, sobraba una
            //  etiqueta equivocada.
            // ══════════════════════════════════════════════════════════════
            const _ident = (typeof window.cronosIdentidadDelPartido === 'function')
                ? window.cronosIdentidadDelPartido(m)
                : { etiqueta: '', modalidadLabel: (m.mode === 'f11' ? 'F-11' : 'F-7'),
                    coherente: true, motivos: [] };
            const modeLabel = _ident.modalidadLabel;
            const equipoLbl = _ident.etiqueta || '';
            // ⚠️ EL AVISO SE ENSEÑA, NO SE OCULTA LA TARJETA. Un partido con los
            // datos cruzados sigue siendo un partido en curso: esconderlo lo
            // haría irrecuperable, que es peor que el defecto. Las ranuras que
            // NO pueden ser un partido real (incoherentes y sin un segundo
            // jugado) ya se han descartado antes de llegar aquí.
            const avisoIncoherente = _ident.coherente ? '' :
                `<div style="margin-top:5px;font-size:0.68rem;color:#f0883e;
                            background:rgba(240,136,62,0.1);border:1px solid rgba(240,136,62,0.3);
                            border-radius:6px;padding:3px 7px;">
                    ⚠️ Datos cruzados: ${typeof escapeHtml==='function'?escapeHtml(_ident.motivos.join(' · ')):_ident.motivos.join(' · ')}
                 </div>`;

            // ── Retomar: por la fuente MÁS RECIENTE de la entrada ──
            // Retomar del dispositivo no necesita red y trae el estado tal cual
            // se dejó; de la nube trae el que vieron los espectadores. Se elige
            // el más fresco, que es justo lo que ya decidió la fusión.
            const idsAttr = typeof escapeAttr === 'function'
                ? escapeAttr(entrada.idsNube.join(','))
                : entrada.idsNube.join(',').replace(/'/g, '');
            let clickResume;
            if (m.isLocal) {
                // v465 · SE DICE QUÉ RANURA SE RETOMA. Sin el argumento, con dos
                // partidos abiertos las dos tarjetas llamaban a lo mismo y la
                // segunda retomaba el primero.
                const safeSlot = typeof escapeAttr === 'function'
                    ? escapeAttr(m._slotId || '') : String(m._slotId || '').replace(/'/g, '');
                clickResume = `_doResumeLocalMatch('${safeSlot}')`;
            } else {
                const safeId = typeof escapeAttr === 'function' ? escapeAttr(m._id) : String(m._id).replace(/'/g, '');
                clickResume = `_doResumeMatch('${safeId}')`;
            }
            // ── Eliminar: SE LLEVA LAS DOS FUENTES ──
            // 🔑 Si sólo se borrara una, la otra reaparecería sola en el
            // siguiente repintado y el usuario volvería a ver el partido que
            // acaba de eliminar. Es la mitad del defecto que se está cerrando.
            // v465 · viaja también QUÉ ranura local es esta entrada.
            const idsLocalAttr = (entrada.idsLocal || []).join(',');
            const clickDelete = `_doDeleteRecoveryEntry('${idsAttr}', ${entrada.tieneLocal ? 'true' : 'false'}, '${idsLocalAttr}')`;

            // ══════════════════════════════════════════════════════════
            //  🔴 v588 · LA ETIQUETA DECÍA DÓNDE, PERO NO QUÉ SIGNIFICA
            //
            //  Reporte del autor: "dos opciones que generan muchísima
            //  confusión porque el usuario no sabe cuál escoger". Y tenía
            //  razón: "☁️ NUBE" y "📱 SOLO EN ESTE DISPOSITIVO" describen
            //  dónde está el fichero, no qué le va a pasar a su partido.
            //  Nadie debería tener que deducirlo.
            //
            //  Ahora, además de la etiqueta, cada tarjeta lleva UNA LÍNEA que
            //  explica en castellano qué implica retomarla — y el número de
            //  jugadores deja de ser un dato suelto para convertirse en un
            //  AVISO cuando es cero, que es exactamente el caso en que el
            //  autor se encontró el campo vacío.
            // ══════════════════════════════════════════════════════════
            const origenTexto = (entrada.tieneLocal && entrada.idsNube.length) ? '📱 DISPOSITIVO + ☁️ NUBE'
                              : entrada.tieneLocal ? '📱 SOLO EN ESTE DISPOSITIVO'
                              : '☁️ NUBE';
            const origenExplica = (entrada.tieneLocal && entrada.idsNube.length)
                ? 'Guardado aquí y en la nube, y ya están unificados: al retomar recuperas la copia más completa de las dos. Es el caso normal.'
                : entrada.tieneLocal
                ? 'Guardado sólo en ESTE dispositivo (aún no había llegado a la nube, normalmente por falta de cobertura). Si lo retomas desde otro móvil u ordenador, no aparecerá.'
                : 'Guardado sólo en la nube: este partido se llevó desde OTRO dispositivo. Al retomarlo aquí, continúas desde el último momento que se sincronizó.';
            const avisoSinJugadores = (playerCount === 0)
                ? `<div style="margin-top:6px;font-size:0.7rem;color:#ff5858;background:rgba(255,88,88,0.08);
                              border:1px solid rgba(255,88,88,0.3);border-radius:8px;padding:0.4rem 0.6rem;">
                     ⚠️ <strong>Esta copia no tiene jugadores guardados.</strong> Si la retomas, el campo saldrá
                     vacío y tendrás que volver a convocar. Sólo debería usarse si no hay otra opción.
                   </div>`
                : '';
            const explicacion = `<div style="margin-top:6px;font-size:0.7rem;color:var(--text-muted);line-height:1.45;">
                    ${typeof escapeHtml==='function'?escapeHtml(origenExplica):origenExplica}
                 </div>${avisoSinJugadores}`;
            const origenColor = (entrada.tieneLocal && entrada.idsNube.length)
                ? 'background:rgba(63,185,80,0.18);color:#3fb950;'
                : entrada.tieneLocal ? 'background:rgba(88,166,255,0.2);color:#58a6ff;'
                : 'background:rgba(240,136,62,0.2);color:#f0883e;';
            const localTag = `<span title="Fuentes de este partido" style="${origenColor}font-size:0.62rem;padding:2px 6px;border-radius:4px;font-weight:900;margin-left:0.5rem;vertical-align:middle;white-space:nowrap;">${origenTexto}</span>`;

            return `
            <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.3);
                        border-radius:12px;padding:0.9rem 1rem;display:flex;flex-direction:column;gap:0.5rem;">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:800;font-size:1rem;color:var(--text);">
                            ${typeof escapeHtml==='function'?escapeHtml(homeName):homeName}
                            <span style="color:#f0883e;margin:0 0.3rem;">${scoreH} – ${scoreA}</span>
                            ${typeof escapeHtml==='function'?escapeHtml(awayName):awayName}
                            ${localTag}
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;display:flex;flex-wrap:wrap;gap:0.3rem 0.8rem;">
                            <span>⏱ ${phase} · ${timeStr}</span>
                            <span>🏆 ${modeLabel}</span>
                            ${equipoLbl ? `<span style="color:#58a6ff;font-weight:800;">⚽ ${typeof escapeHtml==='function'?escapeHtml(equipoLbl):equipoLbl}</span>` : ''}
                            <span style="${playerCount === 0 ? 'color:#ff5858;font-weight:800;' : ''}">👥 ${playerCount} jugadores</span>
                            <span>🕐 ${updStr}</span>
                        </div>
                        ${explicacion}
                        ${avisoIncoherente}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.4rem;flex-shrink:0;">
                        <button onclick="${clickResume}"
                            style="padding:0.45rem 1rem;background:#f0883e;border:none;
                                   border-radius:8px;color:#0a0e14;font-weight:800;
                                   font-size:0.82rem;cursor:pointer;">
                            ▶ Retomar
                        </button>
                        <button onclick="${clickDelete}"
                            style="padding:0.35rem 0.7rem;background:rgba(255,88,88,0.12);
                                   border:1px solid rgba(255,88,88,0.35);
                                   border-radius:8px;color:#ff5858;font-weight:700;
                                   font-size:0.72rem;cursor:pointer;">
                            🗑 Eliminar
                        </button>
                    </div>
                </div>
            </div>`;
        };

        // v589 · Las fiables, a la vista. Las dudosas, plegadas y con su
        // motivo: quien las necesite las tiene a un clic, y quien va con prisa
        // no las ve. `<details>` no necesita JavaScript ni handlers nuevos.
        list.innerHTML = _grupos.fiables.map(_pintaEntrada).join('') +
            (_grupos.dudosas.length ? `
            <details style="margin-top:0.6rem;">
                <summary style="cursor:pointer;font-size:0.75rem;color:var(--text-muted);
                                padding:0.5rem 0.2rem;user-select:none;">
                    ▸ Ver ${_grupos.dudosas.length} copia${_grupos.dudosas.length === 1 ? '' : 's'} descartada${_grupos.dudosas.length === 1 ? '' : 's'}
                    <span style="opacity:0.75;">— sin jugadores o con datos cruzados. Normalmente no hacen falta.</span>
                </summary>
                <div style="display:flex;flex-direction:column;gap:0.6rem;margin-top:0.5rem;opacity:0.85;">
                    ${_grupos.dudosas.map(_pintaEntrada).join('')}
                </div>
            </details>` : '');

    } catch (err) {
        const list = document.getElementById('live-recovery-list');
        if (list && localMatches.length) {
            // Caso sin conexión: mostrar los locales al menos.
            // v465 · TODOS, no sólo el primero: sin red, esta lista es la única
            // forma de volver a un partido, y dejar fuera el segundo lo haría
            // irrecuperable justo cuando peor viene.
            // v561 · el MISMO descarte que la lista con red. Se envuelve cada
            // candidato en la forma `{datos}` que espera el filtro para no tener
            // dos criterios distintos de "esto no puede ser un partido".
            list.innerHTML = _cronosDescartaRanurasImposibles(
                    localMatches.map(x => ({ datos: x })))
                .map(_e => _e.datos)
                .map(localMatch => {
            const updTs = new Date(localMatch.savedAt).getTime();
            const updStr = updTs
                ? new Date(updTs).toLocaleString('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
                : '—';
            const scoreH = localMatch.homeTeam?.score ?? 0;
            const scoreA = localMatch.awayTeam?.score ?? 0;
            const homeName = localMatch.homeTeam?.name || 'LOCAL';
            const awayName = localMatch.awayTeam?.name || 'VISITANTE';
            const phase = localMatch.phase === '2nd_half' ? '2ª Parte' : '1ª Parte';
            const minsH1 = Math.floor((localMatch.timeH1 || 0) / 60).toString().padStart(2,'0');
            const secsH1 = ((localMatch.timeH1 || 0) % 60).toString().padStart(2,'0');
            const minsH2 = Math.floor((localMatch.timeH2 || 0) / 60).toString().padStart(2,'0');
            const secsH2 = ((localMatch.timeH2 || 0) % 60).toString().padStart(2,'0');
            const timeStr = localMatch.phase === '2nd_half' ? `${minsH2}:${secsH2}` : `${minsH1}:${secsH1}`;
            const playerCount = localMatch.playerCount || 0;
            // v557 · el equipo, también en la lista SIN CONEXIÓN: es la única
            // que se ve cuando falla la red, y es cuando más falta hace.
            // v561 · y por el MISMO resolutor que la lista con red, para que las
            // dos pantallas no puedan decir cosas distintas del mismo partido.
            const _identL = (typeof window.cronosIdentidadDelPartido === 'function')
                ? window.cronosIdentidadDelPartido(localMatch)
                : { etiqueta: '', modalidadLabel: (localMatch.mode === 'f11' ? 'F-11' : 'F-7'),
                    coherente: true, motivos: [] };
            const modeLabel = _identL.modalidadLabel;
            const equipoLbl = _identL.etiqueta || '';
            const avisoIncoherente = _identL.coherente ? '' :
                `<div style="margin-top:5px;font-size:0.68rem;color:#f0883e;
                            background:rgba(240,136,62,0.1);border:1px solid rgba(240,136,62,0.3);
                            border-radius:6px;padding:3px 7px;">
                    ⚠️ Datos cruzados: ${typeof escapeHtml==='function'?escapeHtml(_identL.motivos.join(' · ')):_identL.motivos.join(' · ')}
                 </div>`;
            const slotAttr = (typeof escapeHtml==='function'?escapeHtml(localMatch._slotId||''):(localMatch._slotId||''));

            return `
            <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.3);
                        border-radius:12px;padding:0.9rem 1rem;display:flex;flex-direction:column;gap:0.5rem;">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:800;font-size:1rem;color:var(--text);">
                            ${typeof escapeHtml==='function'?escapeHtml(homeName):homeName}
                            <span style="color:#f0883e;margin:0 0.3rem;">${scoreH} – ${scoreA}</span>
                            ${typeof escapeHtml==='function'?escapeHtml(awayName):awayName}
                            <span style="background:#58a6ff;color:#0a0e14;font-size:0.68rem;padding:2px 6px;border-radius:4px;font-weight:900;margin-left:0.5rem;vertical-align:middle;">LOCAL (SIN CONEXIÓN)</span>
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;display:flex;flex-wrap:wrap;gap:0.3rem 0.8rem;">
                            <span>⏱ ${phase} · ${timeStr}</span>
                            <span>🏆 ${modeLabel}</span>
                            ${equipoLbl ? `<span style="color:#58a6ff;font-weight:800;">⚽ ${typeof escapeHtml==='function'?escapeHtml(equipoLbl):equipoLbl}</span>` : ''}
                            <span>👥 ${playerCount} jugadores</span>
                            <span>🕐 ${updStr}</span>
                        </div>
                        ${avisoIncoherente}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.4rem;flex-shrink:0;">
                        <button onclick="_doResumeLocalMatch('${slotAttr}')"
                            style="padding:0.45rem 1rem;background:#f0883e;border:none;
                                   border-radius:8px;color:#0a0e14;font-weight:800;
                                   font-size:0.82rem;cursor:pointer;">
                            ▶ Retomar
                        </button>
                        <button onclick="_doDeleteLocalMatch('${slotAttr}')"
                            style="padding:0.35rem 0.7rem;background:rgba(255,88,88,0.12);
                                   border:1px solid rgba(255,88,88,0.35);
                                   border-radius:8px;color:#ff5858;font-weight:700;
                                   font-size:0.72rem;cursor:pointer;">
                            🗑 Eliminar
                        </button>
                    </div>
                </div>
            </div>`;
            }).join('');
        } else {
            if (list) list.innerHTML = `<div style="color:#ff5858;text-align:center;padding:2rem;">⚠️ Error al cargar: ${err.message}</div>`;
        }
        console.error('[Recovery] Error cargando live_matches:', err);
    }
}

// ¿El partido guardado en este dispositivo es el del id que se va a borrar?
// Se compara por id Y por equipos, la misma identidad que usa la fusión: si
// sólo se mirara el id, el estado local del MISMO partido sobreviviría al
// borrado (con otro id) y el partido reaparecería solo.
// v465 · Devuelve el ID DE LA RANURA que corresponde a ese partido, o '' si
// ninguna. Antes devolvía un booleano porque sólo podía haber un estado local;
// ahora hay uno por partido y hace falta saber CUÁL, no si "hay alguno": con
// dos partidos abiertos, un booleano habría hecho que borrar el de la nube se
// llevara por delante el estado local del otro.
function _recoveryRanuraDelPartido(matchId) {
    try {
        const S = window._cronosMatchSlots;
        if (!S) return '';
        for (const r of S.listar()) {
            if (_ranuraCasaConPartido(r.state, matchId)) return r.id;
        }
        return '';
    } catch (e) { return ''; }
}

function _ranuraCasaConPartido(p, matchId) {
    try {
        if (!p) return false;
        if (p.liveMatchId && matchId && p.liveMatchId === matchId) return true;
        // Sin coincidencia de id, el nombre del equipo local va dentro del id
        // generado por startLiveSync (slug del equipo + fecha + hora), así que
        // se compara por ahí; es una pista, no una certeza, y por eso exige
        // además que el partido local no tenga id propio con el que decidir.
        if (!p.liveMatchId && p.teamNames && p.teamNames.home && matchId) {
            const slug = _recoveryNorm(p.teamNames.home)
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 20);
            return !!slug && String(matchId).indexOf(slug) === 0;
        }
        return false;
    } catch (e) { return false; }
}

// Se conserva la forma booleana: la usa el borrado silencioso de documentos
// caducados y el guard scripts/test_recuperar_partido_fusion equivalente.
function _recoveryEsElPartidoLocal(matchId) {
    return !!_recoveryRanuraDelPartido(matchId);
}
window._recoveryEsElPartidoLocal = _recoveryEsElPartidoLocal;
window._recoveryRanuraDelPartido = _recoveryRanuraDelPartido;

// ── Eliminar una entrada FUSIONADA del panel de recuperación (v441) ────
// Borra TODAS las fuentes del partido: los documentos de la nube que se
// hubieran fusionado y el estado guardado en el dispositivo. Si se dejara una,
// el partido volvería a aparecer solo en el siguiente repintado.
async function _doDeleteRecoveryEntry(idsNubeCsv, tieneLocal, idsLocalCsv) {
    if (!confirm('¿Eliminar este partido en curso? Se borrará de este dispositivo y de la nube, y no podrás recuperarlo.')) return;
    const ids = String(idsNubeCsv || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const id of ids) {
        try { await _doDeleteLiveMatch(id, null, true); } catch (e) { console.warn('[Recovery] borrando', id, e); }
    }
    if (tieneLocal === true || tieneLocal === 'true') {
        // v465 · Se borran LAS RANURAS DE ESTA ENTRADA, no "el estado local".
        // Con varios partidos abiertos, borrar a ciegas se llevaba el que
        // seguía jugándose.
        const locales = String(idsLocalCsv || '').split(',').map(s => s.trim()).filter(Boolean);
        const S = window._cronosMatchSlots;
        if (S) {
            if (locales.length) locales.forEach(sid => S.cerrar(sid, true));
            // Respaldo para una entrada antigua sin idsLocal: se resuelve por
            // identidad del partido, nunca borrando lo primero que haya.
            else ids.forEach(id => { const sid = _recoveryRanuraDelPartido(id); if (sid) S.cerrar(sid, true); });
        }
        document.getElementById('cronos-restore-banner')?.remove();
    }
    if (typeof showToast === 'function') showToast('🗑 Partido eliminado', 2500);
    // Repintar: es la forma de que el recuento y el estado vacío queden bien.
    openLiveMatchRecovery();
}
window._doDeleteRecoveryEntry = _doDeleteRecoveryEntry;

// ── Retomar un partido local ───────────────────────────────────────────
// v465 · Recibe QUÉ ranura se retoma. `_restoreActiveMatch` lee
// `_cronosRestoreSlotId`, así que fijarlo aquí es lo que hace que el botón de
// la segunda tarjeta retome el segundo partido y no el primero.
function _doResumeLocalMatch(slotId) {
    if (slotId) window._cronosRestoreSlotId = slotId;
    if (typeof window._restoreActiveMatch === 'function') {
        window._restoreActiveMatch();
    }
}
window._doResumeLocalMatch = _doResumeLocalMatch;
// ── Eliminar un partido local ──────────────────────────────────────────
function _doDeleteLocalMatch(slotId) {
    if (!confirm('¿Eliminar este partido local en curso? Se perderá definitivamente.')) return;
    const S = window._cronosMatchSlots;
    const id = slotId || (S && S.getTabMatchId());
    if (S && id) S.cerrar(id, true);
    document.getElementById('cronos-restore-banner')?.remove();
    if (typeof showToast === 'function') showToast('🗑 Partido local eliminado', 3000);
    openLiveMatchRecovery();
}
window._doDeleteLocalMatch = _doDeleteLocalMatch;

// ── Retomar un partido desde su snapshot de Firestore ──────────────────
async function _doResumeMatch(matchId) {
    const fa = window._cronos_auth;
    if (!fa || !fa.db) return;

    if (typeof showSpinner === 'function') showSpinner('Cargando partido…');

    try {
        const { doc, getDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        const snap = await getDoc(doc(fa.db, 'live_matches', matchId));
        if (!snap.exists()) {
            if (typeof hideSpinner === 'function') hideSpinner();
            if (typeof showToast === 'function') showToast('⚠️ El partido ya no existe en la nube', 3000);
            return;
        }

        const m = snap.data();

        // ── Calcular tiempo transcurrido ──
        // PRIORIDAD: si el snapshot trae phaseStartedAt (modo autónomo), derivar el
        // tiempo real exacto desde el reloj absoluto, igual que ve el espectador en vivo.
        // Fallback (snapshots antiguos): m.savedAt/updatedAt + delta solo si isRunning.
        let autonomousElapsedSec = null;
        if (typeof m.phaseStartedAt === 'number' && m.phaseStartedAt > 0) {
            autonomousElapsedSec = Math.max(0, Math.floor((Date.now() - m.phaseStartedAt) / 1000));
        }
        let savedTimeMs = 0;
        if (m.savedAt) {
            savedTimeMs = new Date(m.savedAt).getTime();
        } else if (m.updatedAt) {
            if (typeof m.updatedAt.toMillis === 'function') {
                savedTimeMs = m.updatedAt.toMillis();
            } else if (typeof m.updatedAt.toDate === 'function') {
                savedTimeMs = m.updatedAt.toDate().getTime();
            } else {
                savedTimeMs = new Date(m.updatedAt).getTime();
            }
        }
        let deltaSecs = 0;
        if (autonomousElapsedSec === null && m.isRunning && savedTimeMs > 0) {
            deltaSecs = Math.max(0, Math.floor((Date.now() - savedTimeMs) / 1000));
        }

        // ── Restaurar configuración global del partido ──
        if (m.mode)  { currentMode = m.mode; }
        if (m.phase) { matchPhase  = m.phase; }
        liveMatchId  = matchId;
        liveIsActive = true;

        // Restaurar categoría y tiempos límites correspondientes
        if (m.category) {
            window._currentMatchCategory = m.category;
            const catSelect = document.getElementById('match-category');
            if (catSelect) catSelect.value = m.category;
        }
        // FIX: Siempre usar los tiempos del snapshot (no recalcular desde categoría).
        // La categoría puede dar valores erróneos si el partido usó tiempos personalizados.
        half1MaxTime = m.half1MaxTime || 1800;
        half2MaxTime = m.half2MaxTime || 1800;

        let activeAddedSec = 0;
        let shouldAutoEndFirstHalf = false;
        let shouldAutoEndMatch = false;
        const maxAddedSecs = (currentMode === 'f11') ? 900 : 600; // 15 min F11, 10 min F7

        if (autonomousElapsedSec !== null) {
            // Modo AUTÓNOMO: el tiempo real de la parte activa es el derivado desde
            // phaseStartedAt, capado a (reglamentario + añadido). activeAddedSec es la
            // diferencia respecto al valor guardado, para sumarla a los jugadores en campo.
            if (matchPhase === '1st_half') {
                const limit1 = half1MaxTime + maxAddedSecs;
                const realTime = Math.min(autonomousElapsedSec, limit1);
                activeAddedSec = Math.max(0, realTime - (m.timeH1 || 0));
                if (autonomousElapsedSec >= limit1) shouldAutoEndFirstHalf = true;
            } else if (matchPhase === '2nd_half') {
                const limit2 = half2MaxTime + maxAddedSecs;
                const realTime = Math.min(autonomousElapsedSec, limit2);
                activeAddedSec = Math.max(0, realTime - (m.timeH2 || 0));
                if (autonomousElapsedSec >= limit2) shouldAutoEndMatch = true;
            }
        } else if (deltaSecs > 0) {
            // Fallback (snapshots antiguos sin phaseStartedAt)
            if (matchPhase === '1st_half') {
                const limit1 = half1MaxTime + maxAddedSecs; // Reglamentario + añadido
                const remaining = Math.max(0, limit1 - (m.timeH1 || 0));
                activeAddedSec = Math.min(deltaSecs, remaining);
                if (deltaSecs >= remaining) {
                    shouldAutoEndFirstHalf = true;
                }
            } else if (matchPhase === '2nd_half') {
                const limit2 = half2MaxTime + maxAddedSecs;
                const remaining = Math.max(0, limit2 - (m.timeH2 || 0));
                activeAddedSec = Math.min(deltaSecs, remaining);
                if (deltaSecs >= remaining) {
                    shouldAutoEndMatch = true;
                }
            }
        }

        // Restaurar cronómetros sumando el tiempo transcurrido
        masterTimeH1 = (m.timeH1 || 0);
        masterTimeH2 = (m.timeH2 || 0);

        if (activeAddedSec > 0) {
            if (matchPhase === '1st_half') {
                masterTimeH1 += activeAddedSec;
            } else if (matchPhase === '2nd_half') {
                masterTimeH2 += activeAddedSec;
            }
        }

        // Equipos
        if (m.homeTeam) {
            TEAM_NAMES.home      = m.homeTeam.name      || 'LOCAL';
            COLORS.home.primary  = m.homeTeam.color     || '#58a6ff';
            COLORS.home.shorts   = m.homeTeam.shorts    || '#ffffff';
            COLORS.home.text     = m.homeTeam.textColor || '#000000';
        }
        if (m.awayTeam) {
            TEAM_NAMES.away      = m.awayTeam.name      || 'VISITANTE';
            COLORS.away.primary  = m.awayTeam.color     || '#ff5858';
            COLORS.away.shorts   = m.awayTeam.shorts    || '#000000';
            COLORS.away.text     = m.awayTeam.textColor || '#ffffff';
        }

        // Formación
        if (m.formation) { activeFormationKey = m.formation; }

        // Modo analizar visitante
        analyzeAway = !!(m.awayTeam && m.mode);

        // FIX: restaurar el rol del equipo del entrenador (home/away). Sin esto,
        // tras recuperar un partido jugado de visitante, _userTeamRole se perdía
        // y los informes (filtrados por _cMyTeamKey) quedaban vacíos.
        if (m.myTeamRole) window._userTeamRole = m.myTeamRole;

        // ── Restaurar jugadores ──
        if (Array.isArray(m.players) && m.players.length > 0) {
            players = m.players.map(p => ({
                id:        p.id,
                number:    p.number,
                name:      p.name,
                team:      p.team,
                status:    p.status    || 'bench',
                time:      (p.time || 0) + ((activeAddedSec > 0 && (p.status === 'field' || (!p.status && 'bench' === 'field'))) ? activeAddedSec : 0),
                goals:     p.goals     || 0,
                cards:     p.cards     || 'ninguna',
                yellowCards: p.yellowCards || 0,
                injured:   p.injured   || false,
                x:         p.x        || 50,
                y:         p.y        || 50,
                history:   p.history   || [],
                convocado: p.convocado || false,
                color:     p.color     || (p.team === 'home' ? COLORS.home.primary : COLORS.away.primary),
                shortsColor: p.shortsColor || (p.team === 'home' ? COLORS.home.shorts : COLORS.away.shorts),
                textColor: p.textColor || (p.team === 'home' ? COLORS.home.text : COLORS.away.text),
                benchOrder: p.benchOrder || 0,
            }));
        }

        // ── Restaurar marcador en UI ──
        const homeScore = (m.homeTeam?.score ?? 0).toString();
        const awayScore = (m.awayTeam?.score ?? 0).toString();
        const scoreHomeEl = document.getElementById('score-home');
        const scoreAwayEl = document.getElementById('score-away');
        if (scoreHomeEl) scoreHomeEl.textContent = homeScore;
        if (scoreAwayEl) scoreAwayEl.textContent = awayScore;

        // ── Restaurar nombres de equipos en UI ──
        const teamAEl = document.getElementById('team-a-name');
        const teamBEl = document.getElementById('team-b-name');
        if (teamAEl) teamAEl.textContent = TEAM_NAMES.home;
        if (teamBEl) teamBEl.textContent = TEAM_NAMES.away;

        // ── Ajustar clases de modalidad ──
        document.body.classList.toggle('mode-f11', currentMode === 'f11');
        document.body.classList.toggle('role-away', window._userTeamRole === 'away');
        if (!analyzeAway) {
            document.body.classList.add('hide-visitor');
        } else {
            document.body.classList.remove('hide-visitor');
        }

        // ── Cerrar modal y mostrar campo ──
        const modal = document.getElementById('setup-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('setup-mode');

        // ── Renderizar jugadores ──
        if (typeof renderPlayers === 'function') renderPlayers();

        // ── Restaurar cronómetros ──
        const timerH1El = document.getElementById('timer-h1');
        const timerH2El = document.getElementById('timer-h2');
        const fmtTime = (s) => {
            const m = Math.floor(s/60).toString().padStart(2,'0');
            const sec = (s % 60).toString().padStart(2,'0');
            return `${m}:${sec}`;
        };
        if (timerH1El) timerH1El.textContent = fmtTime(masterTimeH1);
        if (timerH2El) timerH2El.textContent = fmtTime(masterTimeH2);

        // ── Reiniciar el timer de sincronización en vivo y cronómetro principal ──
        if (typeof liveSyncTimer !== 'undefined' && liveSyncTimer) {
            clearInterval(liveSyncTimer);
        }

        // ── FIX: Detectar si otro dispositivo está sincronizando activamente ──
        // Si el snapshot se actualizó hace < 8 segundos con otro deviceId, este dispositivo
        // actúa en modo LECTURA (no escribe) para no sobrescribir el estado del dispositivo principal.
        const remoteDeviceId  = m.syncDeviceId || null;
        const myDeviceId      = window._cronosSyncDeviceId || null;
        const lastSavedMs     = m.savedAt ? new Date(m.savedAt).getTime() : 0;
        const secSinceLastSync = lastSavedMs > 0 ? (Date.now() - lastSavedMs) / 1000 : 999;
        const anotherDeviceActive = remoteDeviceId && myDeviceId && 
                                    remoteDeviceId !== myDeviceId && 
                                    secSinceLastSync < 8;

        if (anotherDeviceActive) {
            // Otro dispositivo está controlando el partido: solo lectura aquí
            if (typeof showToast === 'function') {
                showToast('👁 Otro dispositivo está controlando el partido. Este dispositivo solo visualiza.', 6000);
            }
            console.warn('[Recovery] Modo lectura: otro dispositivo activo (deviceId:', remoteDeviceId, ', hace', Math.round(secSinceLastSync), 's)');
            liveIsActive = false;  // No escribir desde este dispositivo
        }

        if (shouldAutoEndFirstHalf) {
            if (typeof window.endFirstHalf === 'function') {
                window.endFirstHalf(true);
            }
        } else if (shouldAutoEndMatch) {
            if (typeof window.endMatch === 'function') {
                window.endMatch(true);
            }
        } else {
            // ── Decidir si el partido debe continuar en marcha ──
            // AUTÓNOMO: si la fase es de juego y el snapshot trae phaseStartedAt
            // (no null), el partido estaba corriendo → continuar SIEMPRE en marcha,
            // sincronizado con el tiempo real ya derivado. No hay que pulsar nada.
            // Fallback: respetar m.isRunning para snapshots antiguos.
            const inPlayPhase = (matchPhase === '1st_half' || matchPhase === '2nd_half');
            const shouldRunAutonomous = (autonomousElapsedSec !== null) && inPlayPhase;
            const shouldRun = shouldRunAutonomous || m.isRunning;

            if (shouldRun) {
                if (typeof isRunning !== 'undefined') {
                    isRunning = false; // Forzamos false para que toggleGame() lo pase a true y arranque el intervalo
                }
                if (typeof toggleGame === 'function') toggleGame();
                
                // Solo activar sincronización de escritura si este dispositivo es el controlador
                if (!anotherDeviceActive && typeof pushLiveSnapshot === 'function') {
                    liveSyncTimer = setInterval(() => {
                        if (liveIsActive && isRunning) pushLiveSnapshot('active');
                    }, 1000);
                }
            } else {
                if (typeof isRunning !== 'undefined') {
                    isRunning = false; // Asegurarse de que esté pausado visual y lógicamente
                }
                const btn = document.getElementById('btn-play-pause');
                if (btn) {
                    btn.textContent = 'REANUDAR';
                    btn.classList.remove('danger');
                }
                if (typeof timerInterval !== 'undefined') clearInterval(timerInterval);
            }
        }

        if (typeof updateLiveButton === 'function') updateLiveButton(true);
        if (typeof hideSpinner === 'function') hideSpinner();

        // Guardar el estado local de inmediato tras recuperarlo de la nube
        if (typeof window._saveMatchStateToStorage === 'function') {
            window._saveMatchStateToStorage();
        }

        if (typeof showToast === 'function') showToast('✅ Partido recuperado correctamente', 3500);


    } catch (err) {
        if (typeof hideSpinner === 'function') hideSpinner();
        if (typeof showToast === 'function') showToast('⚠️ Error al recuperar partido: ' + err.message, 4000);
        console.error('[Recovery] Error:', err);
    }
}

// ── Eliminar un partido en curso desde el panel de recuperación ─────────
async function _doDeleteLiveMatch(matchId, btn, isSilent = false) {
    if (!isSilent) {
        if (!confirm('¿Eliminar este partido en curso? Se borrará de la nube y no podrás recuperarlo.')) return;
    }
    const fa = window._cronos_auth;
    if (!fa || !fa.db) return;

    try {
        const { doc, deleteDoc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // ⚠️⚠️ v588 · EL ÍNDICE VA PRIMERO Y CON SU PROPIO `catch`.
        //
        //  v572 lo puso DESPUÉS del borrado del partido y sin protegerlo del
        //  fallo del primero. Con eso, si `live_matches` fallaba —y falla
        //  siempre que el documento ya no existe, porque en reglas borrar lo
        //  inexistente DENIEGA (v521→v524)— la ejecución saltaba al `catch`
        //  exterior y **el índice no se borraba nunca**. La tarjeta quedaba
        //  clavada en la lista de Partidos en Vivo, imborrable. Es el fantasma
        //  que reportó el autor (captura 9292) y que se midió por REST:
        //  `local-19082026-rrh8-1529` vivía sólo en `live_index`.
        //
        //  El índice es lo que el usuario VE, así que se borra primero: si algo
        //  falla después, queda un documento invisible que `cleanupLiveMatches`
        //  recoge a las 10 h — y no un fantasma permanente en pantalla.
        try {
            await deleteDoc(doc(fa.db, 'live_index', matchId));
        } catch (eIdx) {
            console.warn('[v588] Índice no borrado (' + matchId + '):', eIdx && eIdx.message);
        }
        try {
            await deleteDoc(doc(fa.db, 'live_matches', matchId));
        } catch (ePar) {
            console.warn('[v588] Partido no borrado (' + matchId + '):', ePar && ePar.message);
        }

        // Limpiar también el estado del dispositivo, para que no reaparezca por
        // la otra fuente.
        // 🐛 v441 · PERO SÓLO SI ES EL MISMO PARTIDO. Antes se borraba SIEMPRE, y
        // esta función se llama en silencio para cada documento CADUCADO que se
        // encuentra al abrir el panel: un partido viejo de la nube borraba el
        // estado del partido de HOY que aún estaba en curso en el dispositivo.
        // Pérdida de datos real, y silenciosa.
        // v465 · Y sólo LA RANURA de ese partido. La v441 ya evitó que un
        // documento caducado borrase el partido de hoy; con varios partidos
        // abiertos hay que apuntar además a la ranura correcta, porque ahora
        // conviven dos partidos de hoy igual de vivos.
        const _sid = _recoveryRanuraDelPartido(matchId);
        if (_sid) window._cronosMatchSlots?.cerrar(_sid, true);

        if (isSilent) return; // No UI updates if silent

        // Quitar tarjeta de la UI
        const card = btn?.closest('div[style]');
        if (card) card.remove();

        if (typeof showToast === 'function') showToast('🗑 Partido eliminado', 2500);

        // Si la lista queda vacía, mostrar mensaje
        const list = document.getElementById('live-recovery-list');
        if (list && list.children.length === 0) {
            list.innerHTML = `
            <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
                <div style="font-size:2.5rem;margin-bottom:0.8rem;">✅</div>
                <div style="font-size:0.9rem;font-weight:600;">No hay más partidos en curso</div>
            </div>`;
        }
    } catch (err) {
        if (typeof showToast === 'function') showToast('⚠️ Error al eliminar: ' + err.message, 3000);
        console.error('[Recovery] Error eliminando:', err);
    }
}

// ════════════════════════════════════════════════════════════════════
// COMUNICACIONES (desde panel del entrenador)
// Abre un modal con 3 opciones: Mensajes, Partidos Terminados, Retransmisión
// ════════════════════════════════════════════════════════════════════
window._openCoachCommsMenu = function() {
    // ══════════════════════════════════════════════════════════════════
    //  🔴🔴 v596 · ESTA PANTALLA NO TENÍA PUERTA
    //
    //  v429 puso el candado del extra `comunicaciones` en
    //  openUnifiedCommsMenu (js/coach/comms/panel.js)... que es OTRA
    //  pantalla. La que abre el entrenador desde su panel es ÉSTA, y
    //  entraba siempre: el SuperAdmin podía apagar Comunicaciones y el
    //  entrenador seguía dentro, con sus cuatro opciones.
    //
    //  🔑 DOS PANTALLAS CON EL MISMO NOMBRE Y UNA SOLA CON CANDADO es
    //  exactamente la forma que tiene un extra de parecer contratado sin
    //  estarlo. La puerta va AQUÍ, la primera línea, antes incluso de
    //  apilar en la pila de navegación: apilar una pantalla en la que no
    //  se va a entrar deja la pila describiendo algo que no está (v425).
    // ══════════════════════════════════════════════════════════════════
    if (typeof window._cronosExtraGate === 'function' &&
        !window._cronosExtraGate('comunicaciones', 'El área de Comunicaciones')) {
        return;
    }

    // Pila de navegación (js/core/nav-stack.js).
    if (typeof navScreen === 'function') navScreen('_openCoachCommsMenu');

    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(94vw,460px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <div style="padding:1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1.1rem;">💬 Comunicaciones</h3>
            <div style="display:flex;align-items:center;gap:0.5rem;">
                <button onclick="navBack()" class="btn"
                    style="padding:0.3rem 0.7rem;font-size:0.72rem;color:var(--text-muted);">← Volver</button>
                <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();" title="Salir al selector de roles"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
            </div>
        </div>

        <div style="padding:1.2rem;overflow-y:auto;flex:1;">
            <div style="font-size:0.85rem;color:var(--text);margin-bottom:0.5rem;font-weight:600;">
                ¿Qué quieres hacer?
            </div>

            <div style="display:grid;gap:0.7rem;">

                <!-- MENSAJES · v429: candado del extra 'mensajeria'. -->
                <button onclick="(function(){ if(typeof openCoachMessaging==='function'){openCoachMessaging('parents');}else{alert('Módulo de mensajes no disponible');} })()"
                    ${window._cronosExtraEnabled('mensajeria') ? '' : 'disabled title="No disponible en el plan de tu club"'}
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;
                           ${window._cronosExtraEnabled('mensajeria') ? '' : 'opacity:0.45;cursor:not-allowed;filter:grayscale(0.7);'}">
                    <span style="font-size:1.5rem;">${window._cronosExtraEnabled('mensajeria') ? '💬' : '🔒'}</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Mensajes</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Chat con familiares / jugadores · dirección · coordinación</div>
                    </div>
                </button>

                <!-- PARTIDOS TERMINADOS · v596 · APAGADA, NO SÓLO MUDA.
                     Antes se veía a todo color, con su icono y su cursor de
                     mano, y sólo al pulsarla saltaba el aviso. Una tarjeta que
                     parece contratada y no lo está manda al usuario a soporte;
                     ahora se ve gris, sombreada y con 🔒, como Mensajes.
                     ⚠️ El aviso al pulsar SE QUEDA: el atributo disabled es
                     cosmético (v548) y se puede llegar desde la consola.
                     ⚠️⚠️ NI UN BACKTICK EN ESTE COMENTARIO: va dentro de un
                     template literal y lo cerraría. -->
                <button onclick="(function(){
                    if (typeof window._cronosExtraGate === 'function' &&
                        !window._cronosExtraGate('partidos_terminados', 'Partidos Terminados')) return;
                    if(typeof showFinishedMatches==='function'){showFinishedMatches();}else{alert('Módulo no disponible');}
                })()"
                    ${window._cronosExtraEnabled('partidos_terminados') ? '' : 'disabled title="No disponible en el plan de tu club"'}
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(255,88,88,0.08);border:1px solid rgba(255,88,88,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;
                           ${window._cronosExtraEnabled('partidos_terminados') ? ''
                             : 'opacity:0.45; filter:grayscale(1); cursor:not-allowed; box-shadow:inset 0 0 0 9999px rgba(0,0,0,0.25);'}">
                    <span style="font-size:1.5rem;">${window._cronosExtraEnabled('partidos_terminados') ? '📋' : '🔒'}</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Partidos Terminados</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">${window._cronosExtraEnabled('partidos_terminados')
                            ? 'Ver y volver a partidos finalizados'
                            : 'No contratado en el plan de tu club'}</div>
                    </div>
                </button>

                <!-- REGISTRAR SUCESOS OFFLINE (retroactivos) -->
                <button onclick="(function(){ if(typeof openRetroactiveEventModal==='function'){openRetroactiveEventModal();}else{alert('Módulo no disponible');} })()"
                    title="Registrar goles, tarjetas o cambios que ocurrieron sin batería o cobertura"
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.3);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;">
                    <span style="font-size:1.5rem;">⏱️</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Registrar sucesos offline</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">Añadir eventos perdidos por falta de batería o cobertura</div>
                    </div>
                </button>

                <!-- PARTIDOS EN VIVO · v596 · Mismo trato: el candado se VE.
                     La comprobación de _cronosOpenLiveMatchesPanel sigue viva
                     (es la puerta de verdad), pero llegaba tarde: el usuario ya
                     había pulsado una tarjeta que parecía suya. -->
                <button onclick="_cronosOpenLiveMatchesPanel()"
                    ${window._cronosExtraEnabled('partidos_en_vivo') ? '' : 'disabled title="No disponible en el plan de tu club"'}
                    style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1rem;
                           background:rgba(255,88,88,0.12);border:1px solid rgba(255,88,88,0.35);
                           border-radius:10px;cursor:pointer;color:var(--text);text-align:left;transition:all 0.15s;
                           ${window._cronosExtraEnabled('partidos_en_vivo') ? ''
                             : 'opacity:0.45; filter:grayscale(1); cursor:not-allowed; box-shadow:inset 0 0 0 9999px rgba(0,0,0,0.25);'}">
                    <span style="font-size:1.5rem;">${window._cronosExtraEnabled('partidos_en_vivo') ? '🔴' : '🔒'}</span>
                    <div>
                        <div style="font-weight:700;font-size:0.9rem;">Partidos en Vivo</div>
                        <div style="font-size:0.72rem;color:var(--text-muted);">${window._cronosExtraEnabled('partidos_en_vivo')
                            ? 'Ver partidos del club en directo'
                            : 'No contratado en el plan de tu club'}</div>
                    </div>
                </button>

            </div>
        </div>

        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);flex-shrink:0;">
            <button onclick="openSetupModal()" class="btn"
                style="color:var(--text-muted);width:100%;">← Volver</button>
        </div>
    </div>`;
};

// ════════════════════════════════════════════════════════════════════
// PARTIDOS EN VIVO — Panel para ver partidos del club en directo
// ════════════════════════════════════════════════════════════════════
window._cronosOpenLiveMatchesPanel = async function() {
    // 🔑 v425 — ESTA PANTALLA NO SE REGISTRABA EN LA PILA DE NAVEGACIÓN.
    // Es la única de las que pintan sobre #setup-modal que se lo saltaba, y su
    // pie llama a navBack(). Como nunca llegó a estar en la pila, ese navBack()
    // desapilaba la pantalla que la había ABIERTO y repintaba la anterior a
    // ésa: se volvía un nivel de más, a una pantalla por la que el usuario no
    // había pasado. Es exactamente el fallo que el módulo nav-stack vino a
    // eliminar, y su cabecera lo advierte: una pantalla sin registrar deja la
    // pila describiendo algo que ya no está en el DOM.
    //
    // Va ANTES del primer await (invariante de la ronda 3 del módulo): después
    // del await, navBack podría haber corrido ya con la pila vieja.
    // ⚠️ v596 · LA PUERTA VA ANTES DE APILAR. Estaba después de navScreen, así
    // que un extra apagado dejaba la pantalla METIDA EN LA PILA sin haber
    // entrado nunca: el navBack() siguiente desapilaba una pantalla que no
    // estaba en el DOM — el mismo fallo que la nota de v425 de aquí arriba
    // vino a eliminar. Y usa el portero común en vez de leer `me.extras` a
    // pelo: así respeta el usuario EFECTIVO en cuentas multi-rol.
    if (typeof window._cronosExtraGate === 'function' &&
        !window._cronosExtraGate('partidos_en_vivo', 'Partidos en Vivo')) {
        return;
    }

    if (typeof navScreen === 'function') navScreen('_cronosOpenLiveMatchesPanel');

    const me = window._cronosCurrentUser;
    if (!me) return;

    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(94vw,600px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <div style="padding:1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1.1rem;">🔴 Partidos en Vivo</h3>
            <button onclick="openSetupModal()"
                style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <div id="live-matches-body" style="padding:1.2rem;overflow-y:auto;flex:1;">
            <div style="text-align:center;padding:2rem;color:var(--text-muted);">
                <div style="font-size:1.6rem;animation:spin 1.2s linear infinite;">🔴</div>
                <p style="margin-top:0.5rem;">Buscando partidos en vivo...</p>
            </div>
            <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
        </div>

        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);flex-shrink:0;">
            <div style="display:flex;gap:0.5rem;">
                <button onclick="navBack()" class="btn" style="color:var(--text-muted);flex:1;">← Volver</button>
                <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();" class="btn" title="Salir al selector de roles"
                    style="color:var(--text-muted);flex:0 0 auto;">✕</button>
            </div>
        </div>
    </div>`;

    try {
        const { collection, getDocs, query, where } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth?.db;
        if (!db) { document.getElementById('live-matches-body').innerHTML = '<div style="color:#ff5858;">Firebase no disponible</div>'; return; }

        // FIX: la coleccion se llama 'live_matches' (NO 'cronos_live_matches')
        // Buscar TODOS los partidos activos del club sin filtro de status
        // (el filtro se hace en cliente porque Firestore no soporta != en queries)
        const snap = await getDocs(query(
            collection(db, 'live_matches'),
            where('clubId', '==', me.clubId || '')
        )).catch(() => null);

        const body = document.getElementById('live-matches-body');
        if (!snap || snap.empty) {
            body.innerHTML = `
            <div style="text-align:center;padding:2rem;color:var(--text-muted);">
                <div style="font-size:2rem;margin-bottom:0.5rem;">📭</div>
                <div style="font-size:0.9rem;font-weight:600;">No hay partidos en vivo ahora mismo</div>
                <div style="font-size:0.75rem;margin-top:0.3rem;">Los partidos activos aparecerán aquí cuando un entrenador inicie un partido.</div>
            </div>`;
            return;
        }

        const matches = [];
        snap.forEach(d => {
            const data = d.data();
            // Solo mostrar partidos activos (no finalizados)
            if (data.status !== 'finished' && data.status !== 'ended' && data.phase !== 'finished') {
                matches.push({ id: d.id, ...data });
            }
        });

        if (!matches.length) {
            body.innerHTML = `
            <div style="text-align:center;padding:2rem;color:var(--text-muted);">
                <div style="font-size:2rem;margin-bottom:0.5rem;">📭</div>
                <div style="font-size:0.9rem;font-weight:600;">No hay partidos en vivo ahora mismo</div>
            </div>`;
            return;
        }

        body.innerHTML = matches.map(m => {
            const home = m.homeName || m.teamHome || 'Local';
            const away = m.awayName || m.teamAway || m.rival || 'Visitante';
            const score = (m.scoreHome != null && m.scoreAway != null) ? m.scoreHome + ' - ' + m.scoreAway : '0 - 0';
            const half = m.currentHalf === 2 ? '2ª Parte' : (m.currentHalf === 1 ? '1ª Parte' : 'En juego');
            const coach = m.coachEmail || '';
            const cat = m.category || '';
            return `
            <div style="background:rgba(255,88,88,0.06);border:1px solid rgba(255,88,88,0.2);
                        border-radius:10px;padding:0.9rem;margin-bottom:0.6rem;cursor:pointer;transition:all 0.15s;"
                 onclick="window.open('./live.html?match=${m.id}', '_blank')"
                 onmouseover="this.style.borderColor='rgba(255,88,88,0.5)'"
                 onmouseout="this.style.borderColor='rgba(255,88,88,0.2)'">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="flex:1;">
                        <div style="font-weight:700;font-size:0.95rem;">
                            <span style="color:#58a6ff;">${typeof escapeHtml==='function'?escapeHtml(home):home}</span>
                            <span style="color:var(--text-muted);margin:0 0.5rem;">${score}</span>
                            <span style="color:#ff5858;">${typeof escapeHtml==='function'?escapeHtml(away):away}</span>
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;">
                            🔴 ${half} ${cat ? '· ' + cat : ''} ${coach ? '· ' + coach : ''}
                        </div>
                    </div>
                    <div style="font-size:0.7rem;color:#3fb950;font-weight:700;flex-shrink:0;">
                        ▶ Ver
                    </div>
                </div>
            </div>`;
        }).join('');

    } catch(e) {
        const body = document.getElementById('live-matches-body');
        if (body) body.innerHTML = '<div style="color:#ff5858;padding:1rem;">⚠️ Error: ' + e.message + '</div>';
    }
};
