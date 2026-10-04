// ════════════════════════════════════════════════════════════════════
//  js/services/auth/invite-prefill.js
//  📨 v630 — LA INVITACIÓN RELLENA EL ALTA
//
//  Encargo del autor (implementar.txt, 2026-08-25, punto 2): «cuando el usuario
//  pulsa la invitación, los parámetros de la URL (email, role, clubName) deben
//  rellenar y seleccionar automáticamente los campos [...] y el selector/input
//  del nombre del club debe mostrar y bloquear/fijar el club correspondiente de
//  los ya dados de alta en el sistema (como CD Doramas) [...] el usuario solo
//  tenga que poner su contraseña y finalizar».
//
//  ════════════════════════════════════════════════════════════════════
//  🔴🔴 LOS TRES DEFECTOS QUE HABÍA, MEDIDOS ANTES DE TOCAR
//
//  1. `data-prefill-club` SE ESCRIBÍA Y NO LO LEÍA NADIE. El bloque de
//     index.html intentaba casar el club a los 300 ms; como el desplegable se
//     rellena desde `clubs_public` por RED (loadClubOptions espera hasta 4 s
//     sólo a que Firebase exista), a los 300 ms sólo hay «⏳ Cargando…». Al no
//     encontrarlo dejaba el nombre en un atributo «para que auth.js lo use», y
//     auth.js NUNCA lo lee. Verificado con grep: un solo uso en todo el
//     proyecto, y es la escritura. O sea: **el club no se ha rellenado jamás**,
//     para ningún rol. Aquí se ESPERA a que el desplegable tenga opciones de
//     verdad, en vez de mirar una sola vez y rendirse.
//
//  2. EL ADMINISTRADOR DE CLUB NO USA ESE DESPLEGABLE. `handleRoleChange`
//     (auth.js:442) hace `noClub = isClubAdmin`: su nombre de club va en OTRO
//     campo, `#auth-new-club-name`, que el prefill no tocaba. Por eso en su
//     captura 9611 el rol SÍ salía seleccionado y «Nombre de tu Club» estaba
//     vacío: se rellenaba un elemento que para ese rol está oculto.
//
//  3. 🔑 Y LA TRAMPA QUE HABRÍA CREADO ARREGLARLO A LO BRUTO. La opción se
//     llama «Administrador de Club (NUEVO Club)» y funda una entidad. Rellenar
//     ahí «CD DORAMAS» —un club que YA existe— parecía condenado a crear un
//     duplicado. Medido antes de decidir: **no lo crea**. La aprobación del
//     SuperAdmin (admin/superadmin/extras.js:512) consulta
//     `where('name','==',targetClubName)` y, si existe, REUTILIZA su id.
//
//     ⚠️⚠️ PERO ESA COMPROBACIÓN ES POR NOMBRE EXACTO. De ahí la decisión de
//     diseño de este fichero: cuando el club de la invitación coincide con uno
//     ya dado de alta, NO se escribe el texto que venía en la URL — se escribe
//     el NOMBRE CANÓNICO leído de `clubs_public`. Así el `==` de la aprobación
//     casa seguro. Es estrictamente mejor que hoy, donde el invitado teclea el
//     nombre a mano y una tilde o un espacio de más funda un club gemelo.
//
//  ════════════════════════════════════════════════════════════════════
//  LO QUE SE BLOQUEA Y LO QUE NO
//   · Rol y club: BLOQUEADOS. Son los «datos incuestionables» de su encargo —
//     los decidió quien invita, no quien se registra.
//   · Correo: relleno pero EDITABLE. No lo pidió, y una invitación reenviada a
//     otra persona dejaría de poder usarse si se cierra.
//   · Contraseña, nombre y consentimiento: intactos. Son lo único que tiene que
//     poner, que es exactamente lo que pidió.
//
//  ⚠️ NADA DE ESTO PUEDE IMPEDIR UN REGISTRO. Si algo falla —no hay red, el
//  desplegable no llega, el club no aparece— se deja el formulario ABIERTO y
//  manejable. Un alta que no se puede completar por un adorno de comodidad
//  sería mucho peor que un alta que hay que rellenar a mano.
//
//  Cubierto por scripts/test_invitacion_autocarga.js
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // Normaliza para comparar nombres de club: sin acentos, sin dobles
    // espacios, sin mayúsculas. Se compara con esto; se ESCRIBE el original.
    function _norm(s) {
        return String(s == null ? '' : s)
            .normalize('NFD').replace(/\p{M}/gu, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function _el(id) { return document.getElementById(id); }

    // Nota bajo un campo fijado por la invitación. Se reutiliza el mismo id por
    // campo para que repintar no acumule carteles.
    function _nota(idNota, junto, texto, color) {
        if (!junto || !junto.parentNode) return;
        var n = _el(idNota);
        if (!n) {
            n = document.createElement('div');
            n.id = idNota;
            n.style.cssText = 'font-size:0.72rem;margin-top:4px;line-height:1.4;';
            junto.parentNode.insertBefore(n, junto.nextSibling);
        }
        n.style.color = color || 'rgba(255,255,255,0.55)';
        n.innerHTML = texto;
    }

    function _fijar(el) {
        if (!el) return;
        if (el.tagName === 'SELECT') el.disabled = true;
        else el.readOnly = true;
        el.style.opacity = '0.85';
        el.style.cursor = 'not-allowed';
        el.title = 'Lo ha fijado la invitación que has recibido.';
    }

    // ── Esperar a que el desplegable de clubes tenga opciones DE VERDAD ──
    //  `loadClubOptions` lo deja primero con «⏳ Cargando opciones...» (un solo
    //  <option> con value vacío). Se considera cargado cuando aparece alguna
    //  opción con valor `club:` o `individual:`.
    //  ⚠️ CON TOPE. Sin él, un fallo de red dejaría este bucle vivo para
    //  siempre en la pantalla de alta.
    function _esperarClubes(msTope) {
        return new Promise(function (resolve) {
            var t0 = Date.now();
            (function mirar() {
                var sel = _el('auth-club-select');
                if (sel && sel.querySelector('option[value^="club:"], option[value^="individual:"]')) {
                    resolve(sel); return;
                }
                if (Date.now() - t0 > (msTope || 20000)) { resolve(null); return; }
                setTimeout(mirar, 200);
            })();
        });
    }

    // Busca en el desplegable el club invitado. Devuelve {value, nombre} o null.
    // El texto del <option> lleva un emoji delante ('🏟️ CD DORAMAS'): se compara
    // por NORMALIZACIÓN, no por igualdad literal, y se devuelve el nombre limpio
    // para poder escribirlo tal cual donde haga falta.
    //
    // ✉️ v781 · PRIMERO POR ID. Las invitaciones nuevas llevan el `clubId` de
    // quien invita: con él se casa la opción exacta (`club:<id>` o
    // `individual:<id>`), y dos clubes con el mismo nombre ya no se confunden.
    // El nombre queda de respaldo para las invitaciones viejas, que no lo
    // traen, y para un id que no esté en la lista.
    function _buscarClub(sel, nombre, clubId) {
        if (!sel || (!nombre && !clubId)) return null;
        var opts = sel.querySelectorAll('option[value^="club:"], option[value^="individual:"]');
        var _limpio = function (o) {
            return String(o.textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
        };
        if (clubId) {
            for (var k = 0; k < opts.length; k++) {
                if (opts[k].value === 'club:' + clubId || opts[k].value === 'individual:' + clubId) {
                    return { value: opts[k].value, nombre: _limpio(opts[k]) };
                }
            }
        }
        if (!nombre) return null;
        var objetivo = _norm(nombre);
        for (var i = 0; i < opts.length; i++) {
            var limpio = String(opts[i].textContent || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
            if (_norm(limpio) === objetivo) return { value: opts[i].value, nombre: limpio };
        }
        return null;
    }

    // ════════════════════════════════════════════════════════════════
    //  PUNTO DE ENTRADA
    // ════════════════════════════════════════════════════════════════
    window.cronosAplicarInvitacion = async function cronosAplicarInvitacion(params) {
        try {
            var p = params || new URLSearchParams(window.location.search);
            var email = p.get('email');
            var rol   = p.get('role');
            var club  = p.get('clubName');
            var clubId = '';   // v781 · sólo lo trae el token, nunca la URL

            // ── 🎟️ SEC-INV (2026-08-26) · EL TOKEN OPACO ────────────
            //  La forma nueva es `?invite=<token>`: el correo, el rol y el
            //  club ya no viajan en la URL. Se resuelven leyendo
            //  `invites/{token}`, cuya regla permite `get` sin sesión —quien
            //  abre la invitación todavía no tiene cuenta— pero prohíbe
            //  enumerar, y deniega si caducó o ya se usó.
            //
            //  ⚠️ SE ACEPTAN LAS DOS FORMAS, y no es transición perezosa: los
            //  enlaces ya enviados con `?register=true&email=…` tienen que
            //  seguir funcionando. Si vienen las dos, MANDA EL TOKEN: es el
            //  dato que puso quien invita, no lo que traiga la barra.
            var token = p.get('invite');
            if (token && typeof window.cronosResolverInvitacion === 'function') {
                // 🔴 v779 · Se dice que se está comprobando: la lectura ahora
                // ESPERA a Firebase y reintenta, y puede tardar unos segundos.
                var _ae = _el('auth-email');
                if (_ae) _nota('inv-nota-token', _ae,
                    '⏳ Comprobando tu invitación…', 'rgba(88,166,255,0.85)');
                var res = await window.cronosResolverInvitacion(token);
                if (res && res.estado === 'ok') {
                    var inv = res.inv;
                    email = inv.email || email;
                    rol   = inv.role || rol;
                    club  = inv.clubName || club;
                    clubId = inv.clubId || '';
                    // Se recuerda para consumirla en cuanto haya sesión.
                    window._cronosInviteToken = inv.token;
                    if (_ae) _nota('inv-nota-token', _ae,
                        '✅ Invitación válida: sólo te falta elegir tu contraseña.',
                        'rgba(63,185,80,0.9)');
                    _intentarConsumir();
                } else if (res && res.estado === 'error') {
                    // 🔑 NO se sabe si vale: no se le dice «caducada». Se le
                    // ofrece reintentar sin tener que volver al correo.
                    if (_ae) {
                        _nota('inv-nota-token', _ae,
                            '⚠️ No hemos podido comprobar tu invitación (revisa la conexión). ' +
                            '<a href="#" id="inv-reintentar" style="color:#58a6ff;">Reintentar</a>',
                            'rgba(240,136,62,0.9)');
                        var _r = _el('inv-reintentar');
                        if (_r) _r.onclick = function (ev) {
                            if (ev && ev.preventDefault) ev.preventDefault();
                            window.cronosAplicarInvitacion(p);
                        };
                    }
                } else {
                    // Token invalido, caducado o ya usado. NO se bloquea el
                    // alta: se avisa y se deja el formulario a mano, que es
                    // mucho mejor que una pantalla que no explica nada.
                    if (_ae) _nota('inv-nota-token', _ae,
                        '⚠️ Este enlace de invitación ya no es válido (puede haber caducado ' +
                        'o haberse usado ya para crear una cuenta). Pide uno nuevo a quien te ' +
                        'invitó. Puedes registrarte igualmente rellenando los datos.',
                        'rgba(240,136,62,0.9)');
                }
            }

            // ── Correo ──────────────────────────────────────────────
            if (email) {
                var e = _el('auth-email');
                if (e) e.value = email;
            }

            // ── Rol ─────────────────────────────────────────────────
            var rolReal = '';
            if (rol) {
                var sel = _el('auth-role');
                if (sel) {
                    sel.value = rol;
                    // ⚠️ v593 · 'coordinator' a secas ya no es una opción: se
                    // desglosó en F7 / F11 / F7&11. Un enlace viejo dejaría el
                    // desplegable en la PRIMERA opción sin decir nada, que es
                    // peor que no rellenarlo. Se cae a la mixta.
                    if (sel.value !== rol && rol === 'coordinator') sel.value = 'coordinator_f711';
                    // ⚽ v643 · Y lo mismo con el ente: la Secretaría ofrecía
                    // 'individual_admin', que NUNCA fue una opción de este
                    // desplegable (index.html sólo tiene 'individual', ver la
                    // nota de la v598). Esas invitaciones llegaban SIN ROL, en
                    // silencio. Ya no se ofrece, pero las enviadas siguen
                    // vivas: se caen al rol canónico, que es el mismo puesto.
                    if (sel.value !== rol && rol === 'individual_admin') sel.value = 'individual';
                    // Si el valor no casó con ninguna opción, el navegador deja
                    // el select vacío: NO se fija, y el usuario elige.
                    if (sel.value) {
                        rolReal = (typeof window._cronosParseRoleValue === 'function')
                            ? (window._cronosParseRoleValue(sel.value).role || sel.value)
                            : sel.value;
                        if (typeof window.handleRoleChange === 'function') window.handleRoleChange();
                        _fijar(sel);
                        _nota('inv-nota-rol', sel,
                              '📨 Rol fijado por la invitación.', 'rgba(88,166,255,0.85)');
                    }
                }
            }

            if (!club) return;

            // ── Entrenador / Padre: hay que decir club o ente ANTES ──
            //  `handleEntityChange` es quien enseña el desplegable de club para
            //  estos dos roles; sin esto quedaría oculto y no habría dónde
            //  seleccionar nada.
            if (rolReal === 'user' || rolReal === 'parent') {
                var te = _el('auth-entity-type');
                if (te) {
                    te.value = 'club';
                    if (typeof window.handleEntityChange === 'function') window.handleEntityChange();
                }
            }

            // ── El club ─────────────────────────────────────────────
            var selClub = await _esperarClubes(20000);
            var hallado = _buscarClub(selClub, club, clubId);

            // Si es un ENTE individual, el tipo de entidad tiene que decirlo.
            if (hallado && hallado.value.indexOf('individual:') === 0 &&
                (rolReal === 'user' || rolReal === 'parent')) {
                var te2 = _el('auth-entity-type');
                if (te2) {
                    te2.value = 'individual';
                    if (typeof window.handleEntityChange === 'function') window.handleEntityChange();
                }
            }

            if (rolReal === 'club_admin') {
                // ⚠️ Su campo NO es el desplegable (ver defecto 2 de la cabecera).
                var nuevo = _el('auth-new-club-name');
                if (!nuevo) return;
                if (hallado) {
                    // 🔑 EL NOMBRE CANÓNICO, no el de la URL: la aprobación del
                    // SuperAdmin casa por `where('name','==',...)` y una tilde
                    // de diferencia fundaría un club gemelo.
                    nuevo.value = hallado.nombre;
                    _fijar(nuevo);
                    _nota('inv-nota-club', nuevo,
                          '✅ <strong>' + _escapa(hallado.nombre) + '</strong> ya está dado de alta: ' +
                          'te unirás a él, no se creará uno nuevo.', 'rgba(63,185,80,0.9)');
                } else {
                    nuevo.value = club;
                    _fijar(nuevo);
                    _nota('inv-nota-club', nuevo,
                          '📨 Club fijado por la invitación. Todavía no está dado de alta: ' +
                          'se creará cuando el SuperAdmin apruebe tu solicitud.', 'rgba(240,136,62,0.9)');
                }
                return;
            }

            // ── Resto de roles: el desplegable ──────────────────────
            if (!selClub) {
                // Sin red o sin clubes: se deja ABIERTO y se dice qué buscar.
                var s0 = _el('auth-club-select');
                if (s0) _nota('inv-nota-club', s0,
                    '📨 Te han invitado a <strong>' + _escapa(club) + '</strong>. ' +
                    'La lista no ha cargado: selecciónalo cuando aparezca.', 'rgba(240,136,62,0.9)');
                return;
            }
            if (hallado) {
                selClub.value = hallado.value;
                // El `change` NO se dispara solo al asignar `value`, y de él
                // cuelga el ajuste de roles bajo un ente (auth.js:246).
                try { selClub.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
                if (typeof window.handleRoleChange === 'function') window.handleRoleChange();
                // Se vuelve a fijar el rol: handleRoleChange puede haber
                // repintado el desplegable de roles al cambiar la entidad.
                var selRol = _el('auth-role');
                if (selRol && rolReal) _fijar(selRol);
                _fijar(selClub);
                _nota('inv-nota-club', selClub,
                      '✅ Club fijado por la invitación: <strong>' + _escapa(hallado.nombre) + '</strong>.',
                      'rgba(63,185,80,0.9)');
            } else {
                _nota('inv-nota-club', selClub,
                      '⚠️ Te han invitado a <strong>' + _escapa(club) + '</strong>, pero no aparece en la lista. ' +
                      'Elígelo a mano o avisa a quien te invitó.', 'rgba(240,136,62,0.9)');
            }
        } catch (err) {
            // Nunca se rompe el alta por esto. Ver la nota de cabecera.
            if (window._CRONOS_DEBUG) console.warn('[Invitación] no se pudo autocompletar:', err);
        }
    };

    function _escapa(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ══════════════════════════════════════════════════════════════════
    //  🎟️ v633 · CONSUMIR LA INVITACIÓN — UN SOLO SITIO
    //
    //  Una invitación es de un solo uso, y para marcarla hace falta sesión:
    //  la regla exige que `usedBy` sea el uid de quien escribe, así que no se
    //  puede hacer antes del alta.
    //
    //  🔑 SE ENGANCHA AL ESTADO DE SESIÓN, NO AL FORMULARIO. El alta de
    //  auth.js tiene CINCO ramas que escriben el documento del usuario —rol
    //  nuevo, segundo equipo, bajo entidad individual…— y varias salen con
    //  `return` por el camino. Colgarlo de cada una sería garantizar que
    //  alguna se queda sin marcar. Aquí basta con que aparezca una sesión.
    //
    //  ⚠️ Es a fuego y olvido: si falla, la invitación se queda sin marcar y
    //  caducará sola a los 14 días. Lo que NUNCA puede hacer es tumbar un alta
    //  que ya se completó.
    // ══════════════════════════════════════════════════════════════════
    //
    //  🔴🔴 v779 · LA CONSUMÍA CUALQUIER SESIÓN, TAMBIÉN LA QUE YA ESTABA.
    //  `onAuthStateChanged` avisa nada más suscribirse con la sesión que
    //  hubiera abierta. Si en ese navegador ya había alguien dentro —el
    //  SuperAdmin probando su propio enlace, o la cuenta de otra persona en
    //  ese dispositivo— la invitación se marcaba USADA AL ABRIR LA PÁGINA, sin
    //  haber dado de alta a nadie, y desde entonces el enlace decía
    //  «ya no es válido». Ahora sólo cuenta una sesión NUEVA: un uid que no
    //  es el que había cuando se abrió la página.
    //
    //  🔴 Y el vigilante arrancaba UNA vez a los 400 ms: si la lectura de la
    //  invitación tardaba más (lo normal con red móvil), encontraba el token
    //  vacío, se iba y no volvía — la invitación no se consumía nunca. Ahora
    //  vigila desde el arranque y el resolutor le avisa al dejar el token.
    // ══════════════════════════════════════════════════════════════════
    var _yaConsumida = false;
    var _intentosSesion = 0;
    var _uidPrevio;          // undefined = aún no se sabe qué sesión había
    var _uidActual = null;

    function _intentarConsumir() {
        if (_yaConsumida || !window._cronosInviteToken) return;
        if (_uidPrevio === undefined) return;               // sesión aún sin resolver
        if (!_uidActual || _uidActual === _uidPrevio) return; // nadie nuevo ha entrado
        _yaConsumida = true;
        var t = window._cronosInviteToken;
        window._cronosInviteToken = null;
        if (typeof window.cronosConsumirInvitacion === 'function') {
            window.cronosConsumirInvitacion(t);
        }
    }

    function _vigilarSesion() {
        if (!/[?&]invite=/.test(String((window.location && window.location.search) || ''))) return;
        var fa = window._cronos_auth;
        if (!fa || !fa.auth || typeof fa.onAuthStateChanged !== 'function') {
            // Firebase todavía no está montado. Se reintenta un rato acotado.
            if (++_intentosSesion < 120) setTimeout(_vigilarSesion, 250);
            return;
        }
        try {
            fa.onAuthStateChanged(fa.auth, function (u) {
                var uid = u ? u.uid : null;
                if (_uidPrevio === undefined) {
                    // El primer aviso es la sesión que YA había: no consume.
                    _uidPrevio = uid; _uidActual = uid;
                    return;
                }
                _uidActual = uid;
                _intentarConsumir();
            });
        } catch (e) {
            if (window._CRONOS_DEBUG) console.warn('[Invitación] no se pudo vigilar la sesión:', e);
        }
    }
    setTimeout(_vigilarSesion, 0);

})();
