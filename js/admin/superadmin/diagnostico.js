// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/diagnostico.js
//  🛡️ v628 — CONTROL MAESTRO DEL SUPERADMIN
//
//  Encargo del autor (implementar.txt, 2026-08-25), el día que entra el primer
//  usuario real a producción. Dos capacidades:
//
//   1. Dar de baja o bloquear a cualquier usuario, JUSTIFICANDO el motivo y
//      dejando registro.
//   2. Entrar en el panel de cualquier usuario para diagnosticar incidencias,
//      con una credencial maestra.
//
//  ⚠️⚠️ LAS TRES DECISIONES QUE TOMÓ ÉL, Y QUE EXPLICAN TODO ESTE FICHERO
//  (se le presentaron medidas, con sus riesgos, antes de escribir una línea):
//
//   · BLOQUEO = «próximo acceso». NO se revoca el token vivo. El motivo no es
//     técnico sino de riesgo: revocar de verdad exige `revokeRefreshTokens`
//     (Admin SDK, o sea Cloud Function) y en ESTE proyecto las functions van
//     DIRECTAS A PRODUCCIÓN sin ensayo posible —testeo comparte base de datos,
//     reglas y functions con producción—. Hoy entra su primer usuario real.
//     👉 CONSECUENCIA QUE HAY QUE SABER: quien tenga la app ABIERTA sigue
//        dentro hasta que la cierre (el token de Firebase dura hasta 1 h).
//        Bloquear impide VOLVER A ENTRAR, que ya funcionaba (auth.js:1042).
//
//   · DIAGNÓSTICO = SÓLO LECTURA. Puede ver, no puede actuar. Si pudiera
//     escribir, lo escrito llevaría el uid del SA etiquetado como el del otro
//     usuario: datos mezclados y trazabilidad rota.
//
//   · `users/{uid}/cronos_data` NO SE TOCA. Su regla es `request.auth.uid ==
//     userId` (sólo el dueño) y ahí viven la PLANTILLA, los CONTACTOS y la
//     ASISTENCIA del entrenador. Abrirlo exigía cambiar firestore.rules, que
//     tampoco se puede ensayar. 👉 En modo diagnóstico esas tres cosas salen
//     VACÍAS. El cartel lo dice, para que no se confunda con una avería.
//
//  ════════════════════════════════════════════════════════════════════
//  🔴🔴 POR QUÉ EL BLOQUEO DE ESCRITURA SE HACE EN LA RED, Y NO EN LOS BOTONES
//
//  Medido antes de elegir: hay **330 llamadas de escritura** (setDoc 126,
//  updateDoc 152, deleteDoc 51, addDoc 1) repartidas en **35 ficheros** que
//  importan el SDK de Firestore CADA UNO POR SU CUENTA. No existe ningún
//  envoltorio común que interceptar, y el objeto de módulo que devuelve
//  `import()` es inmutable: no se le puede parchear `setDoc`.
//
//  Y desactivar los botones NO SIRVE: `disabled` es cosmético — es la lección
//  que este proyecto ya pagó en la v548, cuando un entrenador tenía los
//  desplegables «bloqueados» y podía cambiarse de categoría igual.
//
//  🔑 El único punto por el que pasan las 330 sin excepción es la SALIDA A LA
//  RED. Se interceptan `fetch` y `XMLHttpRequest` y se rechazan las peticiones
//  de ESCRITURA a Firestore (`/Write/channel`, `:commit`, `:batchWrite`) y las
//  llamadas a Cloud Functions. Las de LECTURA (`/Listen/channel`, `:runQuery`,
//  `:batchGet`) pasan intactas, que es justo lo que se quiere ver.
//
//  ⚠️ ES UN CANDADO DE CLIENTE, y se dice sin adornos: quien abra las
//  herramientas de desarrollo puede levantarlo. No es el modelo de amenaza —
//  aquí el riesgo real es el CLIC POR DESCUIDO del propio SuperAdmin mientras
//  mira el panel de otro. Contra eso sí es eficaz, y contra las 330 a la vez.
//
//  ⚠️ CUANDO NO HAY MODO DIAGNÓSTICO, LOS PARCHES NO HACEN NADA: comprueban un
//  flag en memoria y siguen. Se instalan UNA vez y no se desinstalan, para que
//  no exista la ventana de «armado a medias» de un instalar/desinstalar.
//
//  ⚠️ EL MODO NO SOBREVIVE A UN RECARGADO. Vive en memoria a propósito: F5 es
//  siempre la salida garantizada.
//
//  ════════════════════════════════════════════════════════════════════
//  DÓNDE QUEDA EL REGISTRO (y por qué ahí)
//
//   · El MOTIVO va al documento del usuario (`statusReason`, `statusReasonCode`,
//     `statusChangedBy/At`, `statusHistory[]`).
//   · Y TAMBIÉN al registro PRIVADO del SuperAdmin —
//     `users/{saUid}/sa_privado/bajas`— porque la baja definitiva BORRA el
//     documento del usuario (`deleteDoc` en el camino B de
//     saSetClubUserStatus): sin esta segunda copia, el motivo de la única
//     acción irreversible se perdería con ella.
//   · Los ACCESOS de diagnóstico van a `users/{saUid}/sa_privado/diagnostico`,
//     y se escriben ANTES de armar el bloqueo de escritura (después ya no se
//     podría escribir nada).
//
//   🔒 v631 · LOS DOS ESTABAN EN LA RAÍZ DEL DOCUMENTO DEL SA Y SE MOVIERON.
//   La regla de `users` es `allow read: if isAuth()`, así que el motivo de una
//   baja —«impago de cuotas»— y la lista de accesos de diagnóstico los leía
//   CUALQUIER usuario con una cuenta. Lo destapó la auditoría del 2026-08-25;
//   lo había introducido esta misma v628. Ver _saRegistroAnadir.
//
//  🔑 NO se usa `audit_logs`: su regla es `allow write: if false` —sólo el
//  Admin SDK escribe ahí— y cualquier colección NUEVA caería en el catch-all
//  `allow read, write: if false` del final de las reglas. Las dos cosas
//  exigirían desplegar reglas, que es exactamente lo que se decidió no hacer.
//  El documento del SA sí lo puede escribir el SA (`allow update: if
//  isSuperAdmin()`, firestore.rules:497). CERO cambios en reglas.
//
//  ⚠️ La function `auditUserStatusChange` YA está desplegada y escribe en
//  `audit_logs` cada cambio de `status`/`isAuthorized`. Sigue haciéndolo: esto
//  no la sustituye, le añade el MOTIVO, que ella no conoce.
//
//  Cubierto por scripts/test_sa_diagnostico_y_bajas.js
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── Utilidades locales ───────────────────────────────────────────
    function _dE(s) {
        return (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : s)
            : String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function _dA(s) {
        return (typeof escapeAttr === 'function') ? escapeAttr(s == null ? '' : s) : _dE(s).replace(/"/g, '&quot;');
    }
    function _dToast(m, ms) { if (typeof showToast === 'function') showToast(m, ms || 3500); }

    async function _dFS() {
        if (typeof window.saFS === 'function') return window.saFS();
        throw new Error('Firebase no inicializado. Recarga la página.');
    }

    // Tope del registro. Un array sin tope acabaría engordando un documento
    // que se lee a menudo.
    var DIAG_TOPE_REGISTRO = 200;

    // ════════════════════════════════════════════════════════════════
    //  🔒 SEC-A1a (auditoría 2026-08-25) · EL REGISTRO SE SACA DE `users`
    //
    //  La v628 guardaba `saBajasLog` y `saDiagnosticoLog` DENTRO de
    //  `users/{saUid}`… y ese documento lo lee **cualquier usuario
    //  autenticado**: la regla de `users` es `allow read: if isAuth()`. O sea
    //  que el motivo por el que se dio de baja a una persona —«impago de
    //  cuotas»— y la lista de todos los accesos de diagnóstico eran públicos
    //  para cualquiera con una cuenta. Dato personal de un tercero, y justo lo
    //  contrario de lo que promete privacy.html.
    //
    //  🔑 SE MUEVE EL DATO, en vez de esperar a poder acotar la lectura de
    //  `users` entera —que toca muchas pantallas—. La subcolección
    //  `users/{uid}/sa_privado/{doc}` tiene regla propia
    //  (`request.auth.uid == userId`), la misma forma que `cronos_data`.
    //
    //  ⚠️ Y SE MIGRA LO YA ESCRITO. Dejar los arrays viejos en la raíz
    //  mantendría la fuga abierta para siempre: se copian, se escriben en su
    //  sitio nuevo y se BORRA el campo de la raíz con `deleteField`. Es
    //  idempotente: la segunda vez no hay nada que migrar.
    //
    //  ⚠️ SI ALGO DE ESTO FALLA, PROPAGA. Quien llama decide, y los dos que
    //  llaman ya tratan el fallo como motivo para NO seguir: una baja sin
    //  registro se cancela, y el modo diagnóstico se niega a entrar.
    // ════════════════════════════════════════════════════════════════
    var DIAG_DOCS = { bajas: 'bajas', diagnostico: 'diagnostico' };
    var DIAG_CAMPO_VIEJO = { bajas: 'saBajasLog', diagnostico: 'saDiagnosticoLog' };

    // 🔴 v641 · SE COMPLETAN LOS ALIAS QUE FALTEN, EN VEZ DE MORIR POR ELLOS.
    //
    //  El defecto de las capturas 9705-9709: `saSetClubUserStatus` le pasaba a
    //  esta cadena un objeto fabricado a mano con SÓLO cuatro alias
    //  (`db/doc/getDoc/updateDoc`), y aquí abajo hace falta `setDoc` — y
    //  `deleteField` para cerrar la fuga de la v631. Resultado: «fsh.setDoc is
    //  not a function» y la baja cancelada.
    //
    //  🔑 EL ARREGLO DE VERDAD ESTÁ EN QUIEN LLAMA (ya pasa el objeto entero).
    //  Esto es el cinturón: cualquier llamador futuro que se quede corto de
    //  alias se repara solo en vez de tumbar una baja, que es irreversible y
    //  no admite un segundo intento a ciegas. `_dFS()` devuelve el inventario
    //  completo y respeta el candado del modo diagnóstico igual que el resto.
    async function _saFshCompleto(fsh) {
        var f = fsh || {};
        if (f.db && typeof f.doc === 'function' && typeof f.getDoc === 'function' &&
            typeof f.setDoc === 'function' && typeof f.updateDoc === 'function') return f;
        var lleno = await _dFS();
        return Object.assign({}, lleno, f, {
            // Los que faltan se toman del inventario completo; los que el
            // llamador sí trajo se respetan (puede venir de un modo especial).
            db:          f.db          || lleno.db,
            doc:         (typeof f.doc         === 'function') ? f.doc         : lleno.doc,
            getDoc:      (typeof f.getDoc      === 'function') ? f.getDoc      : lleno.getDoc,
            setDoc:      (typeof f.setDoc      === 'function') ? f.setDoc      : lleno.setDoc,
            updateDoc:   (typeof f.updateDoc   === 'function') ? f.updateDoc   : lleno.updateDoc,
            deleteField: (typeof f.deleteField === 'function') ? f.deleteField : lleno.deleteField,
        });
    }

    async function _saRegistroAnadir(fsh, uid, tipo, entrada) {
        fsh = await _saFshCompleto(fsh);
        var docId  = DIAG_DOCS[tipo];
        var campoV = DIAG_CAMPO_VIEJO[tipo];
        var ref    = fsh.doc(fsh.db, 'users', uid, 'sa_privado', docId);

        var snap = await fsh.getDoc(ref);
        var lista = (snap.exists() && Array.isArray((snap.data() || {}).entradas))
            ? (snap.data() || {}).entradas.slice() : [];

        // ── Migración de lo que escribió la v628 en la raíz ──────────
        var raizSnap = await fsh.getDoc(fsh.doc(fsh.db, 'users', uid));
        var raiz = raizSnap.exists() ? (raizSnap.data() || {}) : {};
        var viejo = Array.isArray(raiz[campoV]) ? raiz[campoV] : null;
        if (viejo && viejo.length) lista = viejo.concat(lista);

        lista.push(entrada);
        if (lista.length > DIAG_TOPE_REGISTRO) lista = lista.slice(lista.length - DIAG_TOPE_REGISTRO);

        await fsh.setDoc(ref, { v: 1, entradas: lista, actualizado: new Date().toISOString() },
                         { merge: false });

        // Y se retira el campo de la raíz, que es lo que cerraba la fuga.
        if (viejo && typeof fsh.deleteField === 'function') {
            var borrado = {};
            borrado[campoV] = fsh.deleteField();
            await fsh.updateDoc(fsh.doc(fsh.db, 'users', uid), borrado);
        }
        return lista.length;
    }

    // ════════════════════════════════════════════════════════════════
    //  PARTE 1 · EL MOTIVO DE LA BAJA
    // ════════════════════════════════════════════════════════════════

    // Causas frecuentes, las que él citó por escrito («impago de cuotas, mal
    // uso, etc.»). El texto libre es SIEMPRE obligatorio: una etiqueta suelta
    // no explica nada dentro de seis meses, que es cuando se lee un registro.
    var DIAG_CAUSAS = [
        { id: 'impago',        label: '💳 Impago de cuotas' },
        { id: 'mal_uso',       label: '⚠️ Mal uso de la plataforma' },
        { id: 'peticion',      label: '✋ A petición del propio usuario' },
        { id: 'fin_temporada', label: '📅 Fin de temporada / ya no pertenece' },
        { id: 'duplicado',     label: '👥 Cuenta duplicada o errónea' },
        { id: 'otro',          label: '📝 Otro motivo' },
    ];

    // Devuelve {code, texto} o null si se cancela. Es una PROMESA para poder
    // esperarla desde saSetClubUserStatus, que es async: un `confirm()` no
    // permitiría pedir un texto y un `prompt()` no permite validarlo ni ofrecer
    // las causas frecuentes.
    window._saPedirMotivo = function _saPedirMotivo(email, newStatus) {
        return new Promise(function (resolve) {
            var esBaja = (newStatus === 'removed');
            var titulo = esBaja ? '🗑️ Dar de baja' : '🔒 Bloquear acceso';
            var aviso  = esBaja
                ? 'La baja <strong>BORRA</strong> su cuenta y sus datos. Es irreversible. ' +
                  'El motivo se guarda en tu registro de SuperAdmin, porque el documento ' +
                  'del usuario deja de existir.'
                : 'Queda bloqueado: <strong>no podrá volver a entrar</strong> y verá el aviso ' +
                  '«Cuenta bloqueada». Es reversible desde 🗑️ Rastros.<br>' +
                  '⚠️ Si ahora mismo tiene la aplicación <strong>abierta</strong>, seguirá dentro ' +
                  'hasta que la cierre: el bloqueo actúa en el próximo acceso.';

            var ov = document.createElement('div');
            ov.id = 'sa-motivo-overlay';
            ov.style.cssText = 'position:fixed;inset:0;z-index:2147483500;background:rgba(0,0,0,0.75);' +
                'display:flex;align-items:center;justify-content:center;padding:1rem;';
            ov.innerHTML =
                '<div style="width:min(94vw,520px);max-height:90vh;overflow-y:auto;background:#161b22;' +
                     'border:1px solid rgba(255,255,255,0.14);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.6);">' +
                  '<div style="padding:1rem 1.1rem;border-bottom:1px solid rgba(255,255,255,0.08);">' +
                    '<div style="font-size:1rem;font-weight:800;color:white;">' + titulo + '</div>' +
                    '<div style="font-size:0.78rem;color:#8b949e;margin-top:0.2rem;">' + _dE(email) + '</div>' +
                  '</div>' +
                  '<div style="padding:1rem 1.1rem;">' +
                    '<div style="font-size:0.76rem;line-height:1.6;color:' + (esBaja ? '#ff5858' : '#f0883e') + ';' +
                         'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);' +
                         'border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.9rem;">' + aviso + '</div>' +
                    '<label style="display:block;font-size:0.72rem;color:#8b949e;font-weight:700;margin-bottom:0.3rem;">CAUSA *</label>' +
                    '<select id="sa-motivo-causa" style="width:100%;padding:0.5rem 0.7rem;background:rgba(255,255,255,0.06);' +
                        'border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:white;font-size:0.85rem;' +
                        'box-sizing:border-box;font-family:inherit;">' +
                      DIAG_CAUSAS.map(function (c) {
                          return '<option value="' + _dA(c.id) + '">' + _dE(c.label) + '</option>';
                      }).join('') +
                    '</select>' +
                    '<label style="display:block;font-size:0.72rem;color:#8b949e;font-weight:700;margin:0.8rem 0 0.3rem;">' +
                        'EXPLICACIÓN * <span style="font-weight:400;">(mínimo 10 caracteres)</span></label>' +
                    '<textarea id="sa-motivo-texto" rows="3" placeholder="Ej.: tres recibos devueltos en junio, julio y agosto; avisado por correo el 20/08."' +
                        ' style="width:100%;padding:0.5rem 0.7rem;background:rgba(255,255,255,0.06);' +
                        'border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:white;font-size:0.85rem;' +
                        'box-sizing:border-box;font-family:inherit;resize:vertical;"></textarea>' +
                    '<div id="sa-motivo-msg" style="font-size:0.76rem;min-height:1.1rem;margin-top:0.4rem;color:#ff5858;"></div>' +
                  '</div>' +
                  '<div style="padding:0.85rem 1.1rem;border-top:1px solid rgba(255,255,255,0.08);' +
                       'display:flex;gap:0.5rem;justify-content:flex-end;">' +
                    '<button id="sa-motivo-no" style="padding:0.45rem 1rem;border-radius:8px;cursor:pointer;font-size:0.78rem;' +
                        'background:transparent;border:1px solid rgba(255,255,255,0.18);color:#8b949e;">Cancelar</button>' +
                    '<button id="sa-motivo-si" style="padding:0.45rem 1.1rem;border-radius:8px;cursor:pointer;font-size:0.78rem;font-weight:800;' +
                        'background:rgba(255,88,88,0.16);border:1px solid rgba(255,88,88,0.5);color:#ff5858;">' +
                        (esBaja ? 'Dar de baja' : 'Bloquear') + '</button>' +
                  '</div>' +
                '</div>';
            document.body.appendChild(ov);

            function cerrar(valor) {
                if (ov.parentNode) ov.parentNode.removeChild(ov);
                resolve(valor);
            }
            document.getElementById('sa-motivo-no').onclick = function () { cerrar(null); };
            ov.addEventListener('click', function (ev) { if (ev.target === ov) cerrar(null); });
            document.getElementById('sa-motivo-si').onclick = function () {
                var code  = (document.getElementById('sa-motivo-causa') || {}).value || 'otro';
                var texto = ((document.getElementById('sa-motivo-texto') || {}).value || '').trim();
                var msg   = document.getElementById('sa-motivo-msg');
                // ⚠️ EL MOTIVO ES OBLIGATORIO, y se valida aquí y no sólo en el
                // `required` del campo: este overlay se pinta a mano, no es un
                // <form>, así que nadie lo validaría por nosotros.
                if (texto.length < 10) {
                    if (msg) msg.textContent = 'Escribe el motivo con un mínimo de 10 caracteres. ' +
                                               'Es lo que se leerá dentro de seis meses.';
                    return;
                }
                if (texto.length > 600) {
                    if (msg) msg.textContent = 'Demasiado largo (máximo 600 caracteres).';
                    return;
                }
                cerrar({ code: code, texto: texto });
            };
            var ta = document.getElementById('sa-motivo-texto');
            if (ta) ta.focus();
        });
    };

    // Escribe el motivo en los DOS sitios. Se llama ANTES de tocar el estado,
    // para que el camino de la baja definitiva —que borra el documento del
    // usuario— no se lleve por delante el registro.
    //
    // ⚠️ SI ESTO FALLA, LA ACCIÓN NO SIGUE. Es deliberado y va contra la
    // costumbre del resto del fichero (que degrada y avisa): una baja SIN
    // registro es precisamente lo que se ha venido a evitar, y la baja es
    // irreversible. Mejor no ejecutarla que ejecutarla a ciegas.
    window._saRegistrarMotivo = async function _saRegistrarMotivo(fsh, uid, email, newStatus, clubId, motivo, uData) {
        // v641 · Ver `_saFshCompleto`: los alias que falten se rellenan aquí,
        // no revientan a mitad de camino con la baja ya empezada.
        fsh = await _saFshCompleto(fsh);
        var me = window._cronosCurrentUser || {};
        var ahora = new Date().toISOString();
        var entrada = {
            status: newStatus,
            code:   motivo.code,
            motivo: motivo.texto,
            at:     ahora,
            by:     me.email || me.uid || 'superadmin',
        };

        // 1) En el documento del usuario (sobrevive al BLOQUEO, no a la baja).
        var historia = (uData && Array.isArray(uData.statusHistory)) ? uData.statusHistory.slice() : [];
        historia.push(entrada);
        if (historia.length > 50) historia = historia.slice(historia.length - 50);
        await fsh.updateDoc(fsh.doc(fsh.db, 'users', uid), {
            statusReason:     motivo.texto,
            statusReasonCode: motivo.code,
            statusChangedAt:  ahora,
            statusChangedBy:  entrada.by,
            statusHistory:    historia,
        });

        // 2) En el registro PRIVADO del SuperAdmin (sobrevive A TODO).
        //    🔒 v631 · `users/{saUid}/sa_privado/bajas`, no la raíz de su
        //    documento: aquélla la lee cualquier usuario. Ver _saRegistroAnadir.
        if (me.uid) {
            await _saRegistroAnadir(fsh, me.uid, 'bajas', {
                uid: uid, email: email || '', clubId: clubId || '',
                status: newStatus, code: motivo.code, motivo: motivo.texto, at: ahora,
            });
        }
    };

    // ════════════════════════════════════════════════════════════════
    //  PARTE 2 · EL CANDADO DE ESCRITURA (ver la nota larga de arriba)
    // ════════════════════════════════════════════════════════════════

    window._cronosDiag = null;   // null = modo normal; objeto = diagnóstico activo

    // Escrituras de Firestore y llamadas a Cloud Functions. Las LECTURAS
    // (`/Listen/channel`, `:runQuery`, `:batchGet`) NO están en esta lista a
    // propósito: son justo lo que se quiere dejar pasar.
    var _RE_ESCRITURA = /(\/Write\/channel)|(\/Firestore\/Write)|(:commit)|(:batchWrite)/i;

    function _esEscrituraBloqueable(url) {
        var u = String(url || '');
        if (!u) return false;
        if (u.indexOf('cloudfunctions.net') >= 0) return true;      // pueden escribir en el servidor
        if (u.indexOf('firestore.googleapis.com') < 0) return false;
        return _RE_ESCRITURA.test(u);
    }

    var _avisado = 0;
    function _avisarBloqueo() {
        var t = Date.now();
        if (t - _avisado < 2500) return;    // no encadenar veinte toasts por un solo clic
        _avisado = t;
        _dToast('🔒 Modo diagnóstico: es SÓLO LECTURA, no se ha escrito nada.', 4000);
    }

    // Se instalan UNA sola vez y para siempre. Fuera del modo diagnóstico
    // comprueban un flag y siguen: coste nulo y sin ventana de armado a medias.
    (function instalarCandado() {
        if (window._cronosDiagCandadoPuesto) return;
        window._cronosDiagCandadoPuesto = true;

        if (typeof window.fetch === 'function') {
            var fetchReal = window.fetch.bind(window);
            window.fetch = function (input, init) {
                try {
                    var url = (typeof input === 'string') ? input
                            : (input && input.url) ? input.url : '';
                    if (window._cronosDiag && _esEscrituraBloqueable(url)) {
                        _avisarBloqueo();
                        return Promise.reject(new Error('CRONOS_MODO_DIAGNOSTICO: escritura bloqueada'));
                    }
                } catch (e) { /* ante la duda, NO se bloquea: romper la lectura sería peor */ }
                return fetchReal(input, init);
            };
        }

        if (typeof XMLHttpRequest === 'function' && XMLHttpRequest.prototype) {
            var openReal = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url) {
                try { this.__cronosUrl = url; } catch (e) { /* objeto sellado */ }
                return openReal.apply(this, arguments);
            };
            var sendReal = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function () {
                try {
                    if (window._cronosDiag && _esEscrituraBloqueable(this.__cronosUrl)) {
                        _avisarBloqueo();
                        throw new Error('CRONOS_MODO_DIAGNOSTICO: escritura bloqueada');
                    }
                } catch (e) {
                    if (e && String(e.message).indexOf('CRONOS_MODO_DIAGNOSTICO') === 0) throw e;
                }
                return sendReal.apply(this, arguments);
            };
        }
    })();

    // ════════════════════════════════════════════════════════════════
    //  🔴🔴 v629 · CERRAR EL PANEL DEL SUPERADMIN. DE VERDAD.
    //
    //  Reportado por el autor probando la v628 (capturas 9607-9609): tras la
    //  credencial maestra el cartel naranja aparecía —o sea que el modo SÍ se
    //  activaba— pero debajo seguía el panel del SuperAdmin con el listado de
    //  clubes, en vez del panel del usuario.
    //
    //  🔑 CAUSA 1 · SE OCULTABA UN ELEMENTO QUE NO EXISTE. La v628 hacía
    //  `getElementById('sa-root-modal').style.display = 'none'`. Ese id NO SE
    //  CREA EN NINGUNA PARTE: es una referencia muerta que arrastra
    //  extras.js desde el panel antiguo. El contenedor real es **#sa-panel**
    //  (superadmin.panel.js), `position:fixed; inset:0; z-index:9500`. Como
    //  nunca se ocultó, tapaba TODO lo que se pintara debajo — y el panel del
    //  entrenador vive en #setup-modal, que es z-index 2200. No fallaba sólo
    //  el rol de entrenador: fallaban los seis.
    //
    //  🔑🔑 CAUSA 2 · Y ME LA PROVOQUÉ YO. `setupClubsSyncListener`
    //  (clubs-tab.js) tiene un `onSnapshot` sobre la colección `users` ENTERA
    //  que repinta la pestaña activa 700 ms después de cualquier cambio. El
    //  registro del acceso que escribe esta misma función —`saDiagnosticoLog`
    //  en `users/{saUid}`— ES un cambio en `users`. O sea: entrar en
    //  diagnóstico disparaba el repintado del panel que se acababa de dejar
    //  atrás. Por eso en su captura el subrayado seguía en «Diagnóstico» y el
    //  cuerpo mostraba «Clubes»: dos pantallas distintas a la vez.
    //
    //  Ese oyente SÍ se protege con `if (!panel || panel.style.display==='none')
    //  return;`, así que arreglar la causa 1 ya lo desactiva. Pero se le da de
    //  baja igualmente y a propósito: un oyente sobre `users` entero que
    //  sobrevive a su pantalla sigue costando lecturas —el techo de este
    //  proyecto siempre ha sido LEER (v431, v576, v579)— y depender de que otro
    //  módulo compruebe bien su guarda es exactamente la clase de acoplamiento
    //  que se paga luego.
    //
    //  ⚠️ SE QUITA DEL DOM, NO SE OCULTA. Con `display:none`, `#sa-body` seguiría
    //  existiendo y cualquier repintado tardío (`saClubs`, `saIndividuals`)
    //  escribiría en un contenedor invisible sin enterarse. Quitándolo, esos
    //  repintados se topan con su propio `if (!body) return;` y se paran solos.
    //  `openSuperAdminPanel` lo reconstruye entero al salir, así que no se
    //  pierde nada.
    // ════════════════════════════════════════════════════════════════
    function _cerrarPanelSA() {
        try { if (typeof window._clubsSyncUnsubscribe === 'function') window._clubsSyncUnsubscribe(); }
        catch (e) { /* ya estaba dado de baja */ }
        window._clubsSyncUnsubscribe = null;
        try { if (typeof window._requestsSyncUnsubscribe === 'function') window._requestsSyncUnsubscribe(); }
        catch (e) { /* ya estaba dado de baja */ }
        window._requestsSyncUnsubscribe = null;
        // El repintado va con 700 ms de retardo: si ya estaba programado
        // cuando se cerró el panel, hay que desconvocarlo.
        try { clearTimeout(window._saRefreshTimeout); } catch (e) {}

        var p = document.getElementById('sa-panel');
        if (p && p.parentNode) p.parentNode.removeChild(p);
        // Y el fantasma, por si algún día alguien lo crea de verdad.
        var viejo = document.getElementById('sa-root-modal');
        if (viejo) viejo.style.display = 'none';
    }

    // ── El cartel. Sin él, el modo diagnóstico sería indistinguible de la
    //    sesión normal, y ése es exactamente el accidente que hay que evitar.
    function _pintarCartel() {
        _quitarCartel();
        var d = window._cronosDiag;
        if (!d) return;
        var barra = document.createElement('div');
        barra.id = 'cronos-diag-barra';
        barra.style.cssText =
            'position:fixed;top:0;left:0;right:0;z-index:2147483600;' +
            'background:linear-gradient(90deg,#7a3d00,#a35200);color:#fff;' +
            'font-family:Inter,sans-serif;font-size:0.74rem;line-height:1.35;' +
            'padding:0.45rem 0.7rem;display:flex;align-items:center;gap:0.7rem;' +
            'flex-wrap:wrap;box-shadow:0 2px 12px rgba(0,0,0,0.5);';
        barra.innerHTML =
            '<span style="font-weight:900;letter-spacing:0.5px;">🩺 MODO DIAGNÓSTICO</span>' +
            '<span style="flex:1;min-width:200px;">Viendo la app como <strong>' + _dE(d.email) + '</strong>' +
                ' · <strong>' + _dE(d.rolLabel) + '</strong>' +
                '<br><span style="opacity:0.85;">Sólo lectura: nada de lo que toques se guarda. ' +
                'La plantilla, los contactos y la asistencia salen vacíos — son privados del usuario.</span></span>' +
            '<button onclick="saSalirDiagnostico()" style="padding:0.35rem 0.9rem;border-radius:7px;cursor:pointer;' +
                'font-size:0.74rem;font-weight:800;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.4);' +
                'color:#fff;flex-shrink:0;">✕ SALIR DEL DIAGNÓSTICO</button>';
        document.body.appendChild(barra);

        // ════════════════════════════════════════════════════════════
        //  📐 v629 · HACERLE SITIO AL CARTEL, TAMBIÉN A LO QUE VA `fixed`
        //
        //  El `padding-top` del body sólo aparta lo que está en flujo normal
        //  (#main-header, #main-container). Los PANELES no lo están: `.modal`
        //  —donde viven el del entrenador, el de Dirección, el del ente y el
        //  de los padres— es `position:fixed; top:0; height:100%` (style.css
        //  :1007), así que el cartel le comía la primera franja, justo donde
        //  cada panel pone su cabecera y su botón de salir.
        //
        //  Se hace con una regla en una hoja propia y una clase en el <body>,
        //  no tocando `el.style` uno por uno: los paneles se repintan solos y
        //  cualquier estilo en línea que se les pusiera aquí lo borraría el
        //  siguiente innerHTML.
        // ════════════════════════════════════════════════════════════
        var alto = (barra.offsetHeight || 46);
        var hoja = document.getElementById('cronos-diag-css');
        if (!hoja && document.head) {
            hoja = document.createElement('style');
            hoja.id = 'cronos-diag-css';
            document.head.appendChild(hoja);
        }
        if (!hoja) { document.body.classList.add('cronos-diagnostico'); return; }
        hoja.textContent =
            'body.cronos-diagnostico { padding-top:' + alto + 'px; }' +
            'body.cronos-diagnostico .modal { top:' + alto + 'px; height:calc(100% - ' + alto + 'px); }' +
            'body.cronos-diagnostico #sa-panel { top:' + alto + 'px; }';
        document.body.classList.add('cronos-diagnostico');
    }
    function _quitarCartel() {
        var b = document.getElementById('cronos-diag-barra');
        if (b && b.parentNode) b.parentNode.removeChild(b);
        var h = document.getElementById('cronos-diag-css');
        if (h && h.parentNode) h.parentNode.removeChild(h);
        if (document.body) {
            document.body.classList.remove('cronos-diagnostico');
            document.body.style.paddingTop = '';
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  PARTE 3 · A QUÉ PANEL LLEVA CADA ROL
    // ════════════════════════════════════════════════════════════════

    function _abrirCampo() {
        var h = document.getElementById('main-header');
        var c = document.getElementById('main-container');
        if (h) h.style.display = 'flex';
        if (c) c.style.display = 'flex';
        if (document.body) document.body.style.background = '';
        var m = document.getElementById('setup-modal');
        if (m) m.style.display = 'none';
        if (typeof window.init === 'function') window.init('user');
        if (typeof window.openSetupModal === 'function') window.openSetupModal();
    }

    var DIAG_PANELES = {
        user:                  { label: 'Entrenador',                    abrir: _abrirCampo },
        coach:                 { label: 'Entrenador',                    abrir: _abrirCampo },
        entrenador_individual: { label: 'Entrenador (bajo ente)',        abrir: _abrirCampo },
        director:              { label: 'Director Deportivo',            abrir: function () { window.openStaffDashboard(); } },
        coordinator:           { label: 'Coordinador',                   abrir: function () { window.openStaffDashboard(); } },
        club_admin:            { label: 'Administrador de Club',         abrir: function (u) { window.openClubAdminPanel(u.clubId); } },
        individual:            { label: 'Entrenador Admin. Individual',  abrir: function () { window.cronosAbrirPanelIndividual(); } },
        admin_individual:      { label: 'Entrenador Admin. Individual',  abrir: function () { window.cronosAbrirPanelIndividual(); } },
        parent:                { label: 'Familiar / Jugador',            abrir: function () { window.openParentPanel(); } },
        parent_individual:     { label: 'Familiar / Jugador (bajo ente)', abrir: function () { window.openParentPanel(); } },
        padre_individual:      { label: 'Familiar / Jugador (bajo ente)', abrir: function () { window.openParentPanel(); } },
    };

    // ════════════════════════════════════════════════════════════════
    //  PARTE 4 · LA PESTAÑA 🩺 DIAGNÓSTICO
    // ════════════════════════════════════════════════════════════════

    window._saDiagUsuarios = [];

    window.saDiagnostico = async function saDiagnostico() {
        var cont = document.getElementById('sa-body');
        if (!cont) return;
        var me = window._cronosCurrentUser || {};
        if (me.role !== 'superadmin' && me.role !== 'admin') {
            cont.innerHTML = '<div style="text-align:center;padding:3rem;color:#ff5858;">🔒 Sólo el SuperAdmin.</div>';
            return;
        }
        cont.innerHTML = '<div style="text-align:center;padding:3rem;color:#8b949e;">⏳ Leyendo usuarios…</div>';
        try {
            var fsh = await _dFS();
            // 🏟️ v643 · LAS ENTIDADES, PARA PODER AGRUPAR POR ELLAS.
            //  Clubes y entes individuales viven en la MISMA colección
            //  `clubs`; lo que los separa es `type === 'individual'` (mismo
            //  criterio que saIndividuals). Se leen aquí para tener el nombre
            //  CANÓNICO de cada uno: fiarse del `clubName` copiado en cada
            //  usuario daría dos grupos para el mismo club en cuanto uno
            //  tuviera el nombre viejo.
            var entidades = {};
            try {
                var csnap = await fsh.getDocs(fsh.collection(fsh.db, 'clubs'));
                csnap.forEach(function (d) {
                    var c = d.data() || {};
                    entidades[d.id] = { id: d.id, name: c.name || d.id,
                                        esEnte: c.type === 'individual' };
                });
            } catch (eC) {
                // ⚠️ SE SIGUE SIN ELLAS. El diagnóstico es la herramienta para
                // cuando algo va mal: dejarlo caído porque no se pudo leer el
                // catálogo de clubes sería quitarse la linterna justo en el
                // apagón. Sin catálogo se agrupa por el nombre que traiga cada
                // usuario, que es lo que se hacía hasta la v642.
                console.warn('[diag] catálogo de entidades no disponible:', eC && eC.message);
            }
            window._saDiagEntidades = entidades;
            var snap = await fsh.getDocs(fsh.collection(fsh.db, 'users'));
            var lista = [];
            snap.forEach(function (d) {
                var u = d.data() || {};
                // ⚠️ SÓLO EL DOCUMENTO PRIMARIO. `users` guarda también
                // documentos secundarios `${uid}_${role}_${clubId}` que crea
                // auth.js al añadir un rol; listarlos duplicaría a la misma
                // persona. Mismo criterio que la mensajería y el cuadrante.
                if (u.uid && u.uid !== d.id) return;
                lista.push({ id: d.id, u: u });
            });
            lista.sort(function (a, b) {
                return String(a.u.email || a.id).localeCompare(String(b.u.email || b.id));
            });
            window._saDiagUsuarios = lista;
            _pintarListaDiag('');
        } catch (e) {
            cont.innerHTML = '<div style="text-align:center;padding:3rem;color:#ff5858;">' +
                '⚠️ No se pudo leer la lista de usuarios.<br><span style="font-size:0.8rem;color:#8b949e;">' +
                _dE(e && e.message ? e.message : e) + '</span></div>';
        }
    };

    window._saDiagFiltrar = function (txt) { _pintarListaDiag(txt); };

    function _plazasDe(u) {
        var out = [];
        var vistos = {};
        (Array.isArray(u.allRoles) ? u.allRoles : []).forEach(function (r) {
            if (!r || !r.role) return;
            if (r.status === 'removed' || r.isAuthorized === false) return;
            if (!DIAG_PANELES[r.role]) return;
            var k = r.role + '|' + (r.clubId || r.individualEntityId || '');
            if (vistos[k]) return;
            vistos[k] = true;
            out.push(r);
        });
        // El rol de RAÍZ, si no está ya representado: hay perfiles antiguos sin
        // `allRoles` y dejarlos sin ninguna puerta sería no poder diagnosticarlos.
        if (u.role && DIAG_PANELES[u.role]) {
            var kr = u.role + '|' + (u.clubId || '');
            if (!vistos[kr]) out.push({ role: u.role, clubId: u.clubId, clubName: u.clubName,
                                        category: u.category, subcategory: u.subcategory, _raiz: true });
        }
        return out;
    }

    // ════════════════════════════════════════════════════════════════
    //  🏟️ v643 · LA LISTA, AGRUPADA POR ENTIDAD
    //
    //  Encargo del autor (implementar.txt, 2026-08-28): «la lista actual
    //  muestra a todos los usuarios mezclados en una sola vista. Agrupar
    //  creando acordeones por cada Club registrado (y una pestaña separada
    //  para Entidades Individuales o usuarios sin club)».
    //
    //  🔑🔑 UNA PERSONA PUEDE SALIR EN VARIOS GRUPOS, Y ES LO CORRECTO. No se
    //  reparte por el `clubId` de la RAÍZ: se reparte POR PLAZA. Repartir por
    //  la raíz es literalmente el defecto de la v563 —«el SA veía vacío lo
    //  lleno»—, y aquí sería peor: un entrenador con plaza en dos clubes
    //  aparecería sólo en uno y en el otro no habría por dónde diagnosticarlo.
    //  Dentro de cada club se enseñan SÓLO las plazas de ese club, que es lo
    //  que se va a diagnosticar.
    //
    //  🔑 EL CUERPO DE UN GRUPO CERRADO NO SE PINTA. Con la lista plana se
    //  generaban 120 fichas siempre; así un SuperAdmin con veinte clubes paga
    //  sólo las cabeceras hasta que abre una. Por eso el estado de apertura
    //  vive en `_saDiagAbiertos` y no en una clase CSS: hay que repintar.
    //
    //  ⚠️ AL BUSCAR SE ABRE SOLO lo que tiene coincidencias. Un acordeón
    //  cerrado sobre el resultado de una búsqueda es un resultado escondido, y
    //  parecería que el buscador no encuentra nada.
    // ════════════════════════════════════════════════════════════════
    var DIAG_SIN_CLUB = '__sin_club__';
    window._saDiagAbiertos = window._saDiagAbiertos || {};

    window._saDiagToggle = function (gid) {
        var a = window._saDiagAbiertos || (window._saDiagAbiertos = {});
        a[gid] = !a[gid];
        _pintarListaDiag(window._saDiagFiltroActual || '');
    };

    // Reparte los usuarios visibles en grupos {id, titulo, icono, esEnte,
    // usuarios:[{x, plazas}]}. El orden: clubes, entes, y sin club al final.
    function _agruparDiag(vis) {
        var ents = window._saDiagEntidades || {};
        var mapa = {};
        function grupo(id, titulo, icono, esEnte) {
            if (!mapa[id]) mapa[id] = { id: id, titulo: titulo, icono: icono,
                                        esEnte: !!esEnte, usuarios: [] };
            return mapa[id];
        }
        vis.forEach(function (x) {
            var u = x.u;
            var plazas = _plazasDe(u);
            var porGrupo = {};
            plazas.forEach(function (r) {
                var ancla = r.clubId || r.individualEntityId || r.individualOwnerId || '';
                var gid = ancla || DIAG_SIN_CLUB;
                (porGrupo[gid] || (porGrupo[gid] = [])).push(r);
            });
            // Sin ninguna plaza con panel: sigue habiendo que verlo en algún
            // sitio, o desaparecería de la herramienta de diagnóstico.
            if (!plazas.length) porGrupo[u.clubId || DIAG_SIN_CLUB] = [];
            Object.keys(porGrupo).forEach(function (gid) {
                var e = ents[gid];
                var g;
                if (gid === DIAG_SIN_CLUB) {
                    g = grupo(DIAG_SIN_CLUB, 'Sin club asignado', '⚠️', false);
                } else if (e) {
                    g = grupo(gid, e.name, e.esEnte ? '👤' : '🏟️', e.esEnte);
                } else {
                    // Entidad que no está en el catálogo (o no se pudo leer):
                    // se usa el nombre que traiga el usuario, y se DICE que es
                    // un remanente en vez de esconderlo.
                    g = grupo(gid, u.clubName || gid, '❓', false);
                }
                g.usuarios.push({ x: x, plazas: porGrupo[gid] });
            });
        });
        var arr = Object.keys(mapa).map(function (k) { return mapa[k]; });
        arr.sort(function (a, b) {
            // Clubes primero, entes después, "sin club" el último.
            var ra = (a.id === DIAG_SIN_CLUB) ? 2 : (a.esEnte ? 1 : 0);
            var rb = (b.id === DIAG_SIN_CLUB) ? 2 : (b.esEnte ? 1 : 0);
            if (ra !== rb) return ra - rb;
            return String(a.titulo).localeCompare(String(b.titulo));
        });
        return arr;
    }

    // La ficha de una persona DENTRO de un grupo, con sólo sus plazas de ahí.
    function _fichaDiag(x, plazas) {
        var u = x.u;
        var nombre = (typeof window.cronosNombreUsuario === 'function')
            ? window.cronosNombreUsuario(u) : (u.displayName || u.email || x.id);
        var bloqueado = (u.status === 'blocked');
        return '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.09);' +
                    'border-radius:10px;padding:0.7rem 0.85rem;margin-bottom:0.5rem;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.6rem;flex-wrap:wrap;">' +
              '<div style="min-width:0;">' +
                '<div style="font-weight:700;color:white;font-size:0.85rem;">' + _dE(nombre) +
                  (bloqueado ? ' <span style="font-size:0.66rem;color:#f0883e;">🔒 BLOQUEADO</span>' : '') + '</div>' +
                '<div style="font-size:0.71rem;color:#8b949e;">' + _dE(u.email || x.id) + '</div>' +
              '</div>' +
            '</div>' +
            (u.statusReason
                ? '<div style="margin-top:0.45rem;font-size:0.71rem;color:#f0883e;background:rgba(240,136,62,0.07);' +
                       'border-radius:6px;padding:0.35rem 0.55rem;">📝 ' + _dE(u.statusReason) + '</div>'
                : '') +
            '<div style="margin-top:0.5rem;display:flex;gap:0.35rem;flex-wrap:wrap;">' +
              (plazas.length
                ? plazas.map(function (r) {
                    var meta = DIAG_PANELES[r.role];
                    var etiqueta = meta.label + (r.category
                        ? ' · ' + _dE((typeof window.cronosNombreCategoria === 'function')
                            ? window.cronosNombreCategoria(r.category, r.subcategory) : r.category)
                        : '');
                    return '<button onclick="_saEntrarDiagnostico(\'' + _dA(x.id) + '\',\'' + _dA(r.role) +
                           '\',\'' + _dA(r.clubId || r.individualEntityId || '') + '\')" ' +
                        'style="padding:0.32rem 0.7rem;border-radius:7px;cursor:pointer;font-size:0.72rem;' +
                        'font-weight:700;background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.4);' +
                        'color:#58a6ff;">🩺 ' + etiqueta + '</button>';
                  }).join('')
                : '<span style="font-size:0.72rem;color:#8b949e;">Sin ningún rol con panel al que entrar.</span>') +
            '</div>' +
          '</div>';
    }

    function _pintarListaDiag(filtro) {
        var cont = document.getElementById('sa-body');
        if (!cont) return;
        var f = String(filtro || '').trim().toLowerCase();
        window._saDiagFiltroActual = filtro || '';
        var todos = window._saDiagUsuarios || [];
        var vis = !f ? todos : todos.filter(function (x) {
            var u = x.u;
            return (String(u.email || '') + ' ' + String(u.displayName || '') + ' ' +
                    String(u.firstName || '') + ' ' + String(u.lastName || '') + ' ' +
                    String(u.clubName || '')).toLowerCase().indexOf(f) >= 0;
        });

        var html =
            '<div style="background:rgba(240,136,62,0.07);border:1px solid rgba(240,136,62,0.3);border-radius:10px;' +
                 'padding:0.7rem 0.9rem;margin-bottom:1rem;font-size:0.76rem;color:#f0883e;line-height:1.6;">' +
              '<strong>🩺 Entrar en el panel de un usuario para diagnosticar.</strong><br>' +
              '<span style="color:#8b949e;">Pide tu contraseña de SuperAdmin, deja el acceso registrado y entra en ' +
              '<strong style="color:#f0883e;">SÓLO LECTURA</strong>: puedes mirarlo todo, pero nada de lo que toques se guarda. ' +
              'La plantilla, los contactos y la asistencia saldrán vacíos — son datos privados del usuario y ' +
              'sus reglas sólo se los enseñan a él.</span>' +
            '</div>' +
            '<input id="sa-diag-buscar" oninput="_saDiagFiltrar(this.value)" value="' + _dA(filtro || '') + '"' +
                ' placeholder="🔎 Buscar por correo, nombre o club…"' +
                ' style="width:100%;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.06);' +
                'border:1px solid rgba(255,255,255,0.12);border-radius:9px;color:white;font-size:0.85rem;' +
                'box-sizing:border-box;margin-bottom:0.8rem;font-family:inherit;">';

        var grupos = _agruparDiag(vis);
        html += '<div style="font-size:0.72rem;color:#8b949e;margin-bottom:0.5rem;">' +
                    vis.length + ' de ' + todos.length + ' usuario(s) · ' +
                    grupos.length + ' entidad(es)' +
                    (f ? '' : ' · pulsa una para desplegarla') + '</div>';

        if (!vis.length) {
            html += '<div style="text-align:center;padding:2.5rem;color:#8b949e;font-size:0.85rem;">Ningún usuario coincide.</div>';
        } else {
            var abiertos = window._saDiagAbiertos || {};
            html += grupos.map(function (g) {
                // Buscando, se abre solo: un resultado escondido detrás de un
                // acordeón cerrado se lee como "no encuentra nada".
                var abierto = f ? true : !!abiertos[g.id];
                var color = (g.id === DIAG_SIN_CLUB) ? '#f0883e' : (g.esEnte ? '#3fb950' : '#58a6ff');
                var rgb   = (typeof window._cronosHexRgb === 'function')
                    ? window._cronosHexRgb(color) : '88,166,255';
                return '<div style="border:1px solid rgba(' + rgb + ',0.30);border-radius:11px;' +
                            'margin-bottom:0.6rem;overflow:hidden;background:rgba(' + rgb + ',0.04);">' +
                    '<div onclick="_saDiagToggle(\'' + _dA(g.id) + '\')" ' +
                         'style="display:flex;justify-content:space-between;align-items:center;gap:0.6rem;' +
                                'padding:0.7rem 0.9rem;cursor:pointer;user-select:none;">' +
                      '<div style="font-weight:800;font-size:0.88rem;color:' + color + ';">' +
                          g.icono + ' ' + _dE(g.titulo) +
                          (g.esEnte ? ' <span style="font-size:0.66rem;font-weight:700;opacity:0.75;">ENTE INDIVIDUAL</span>' : '') +
                      '</div>' +
                      '<div style="display:flex;align-items:center;gap:0.55rem;flex-shrink:0;">' +
                        '<span style="font-size:0.72rem;color:#8b949e;">' + g.usuarios.length + ' usuario(s)</span>' +
                        '<span style="font-size:0.72rem;color:#8b949e;">' + (abierto ? '▲' : '▼') + '</span>' +
                      '</div>' +
                    '</div>' +
                    (abierto
                        ? '<div style="padding:0 0.7rem 0.7rem;">' +
                            (g.usuarios.length
                                ? g.usuarios.map(function (it) { return _fichaDiag(it.x, it.plazas); }).join('')
                                : '<div style="padding:0.6rem;color:#8b949e;font-size:0.76rem;">Sin usuarios.</div>') +
                          '</div>'
                        : '') +
                  '</div>';
            }).join('');
        }
        cont.innerHTML = html;
        var inp = document.getElementById('sa-diag-buscar');
        if (inp && f) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }

    // ════════════════════════════════════════════════════════════════
    //  PARTE 5 · ENTRAR Y SALIR
    // ════════════════════════════════════════════════════════════════

    // La credencial maestra que pidió. Se reautentica SIEMPRE, no sólo cuando
    // Firebase lo exija: es lo que comprueba que quien va a mirar los datos de
    // otra persona es él y no alguien que pilló el portátil abierto. Misma
    // doctrina que el cambio de contraseña (js/services/auth/password.js).
    function _pedirClaveMaestra(emailObjetivo) {
        return new Promise(function (resolve) {
            var ov = document.createElement('div');
            ov.id = 'sa-diag-clave';
            ov.style.cssText = 'position:fixed;inset:0;z-index:2147483500;background:rgba(0,0,0,0.78);' +
                'display:flex;align-items:center;justify-content:center;padding:1rem;';
            ov.innerHTML =
                '<div style="width:min(94vw,440px);background:#161b22;border:1px solid rgba(255,255,255,0.14);' +
                     'border-radius:14px;overflow:hidden;">' +
                  '<div style="padding:1rem 1.1rem;border-bottom:1px solid rgba(255,255,255,0.08);">' +
                    '<div style="font-size:0.98rem;font-weight:800;color:white;">🔑 Credencial maestra</div>' +
                    '<div style="font-size:0.76rem;color:#8b949e;margin-top:0.2rem;">' +
                      'Vas a ver la aplicación como <strong>' + _dE(emailObjetivo) + '</strong>. ' +
                      'El acceso queda registrado.</div>' +
                  '</div>' +
                  '<div style="padding:1rem 1.1rem;">' +
                    '<input id="sa-diag-pwd" type="password" autocomplete="current-password" placeholder="Tu contraseña de SuperAdmin"' +
                      ' style="width:100%;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.06);' +
                      'border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:white;font-size:0.9rem;' +
                      'box-sizing:border-box;font-family:inherit;">' +
                    '<div id="sa-diag-pwd-msg" style="font-size:0.76rem;color:#ff5858;min-height:1.1rem;margin-top:0.4rem;"></div>' +
                  '</div>' +
                  '<div style="padding:0.85rem 1.1rem;border-top:1px solid rgba(255,255,255,0.08);' +
                       'display:flex;gap:0.5rem;justify-content:flex-end;">' +
                    '<button id="sa-diag-pwd-no" style="padding:0.45rem 1rem;border-radius:8px;cursor:pointer;font-size:0.78rem;' +
                        'background:transparent;border:1px solid rgba(255,255,255,0.18);color:#8b949e;">Cancelar</button>' +
                    '<button id="sa-diag-pwd-si" style="padding:0.45rem 1.1rem;border-radius:8px;cursor:pointer;font-size:0.78rem;' +
                        'font-weight:800;background:rgba(88,166,255,0.16);border:1px solid rgba(88,166,255,0.5);color:#58a6ff;">Entrar</button>' +
                  '</div>' +
                '</div>';
            document.body.appendChild(ov);

            function cerrar(v) { if (ov.parentNode) ov.parentNode.removeChild(ov); resolve(v); }
            document.getElementById('sa-diag-pwd-no').onclick = function () { cerrar(false); };

            async function intentar() {
                var msg = document.getElementById('sa-diag-pwd-msg');
                var pwd = (document.getElementById('sa-diag-pwd') || {}).value || '';
                if (!pwd) { if (msg) msg.textContent = 'Escribe tu contraseña.'; return; }
                var fa = window._cronos_auth;
                var user = fa && fa.auth && fa.auth.currentUser;
                if (!user || typeof fa.reauthenticateWithCredential !== 'function' || !fa.EmailAuthProvider) {
                    if (msg) msg.textContent = 'El servicio de autenticación no está disponible. Recarga la página.';
                    return;
                }
                if (msg) { msg.style.color = '#8b949e'; msg.textContent = '⏳ Comprobando…'; }
                try {
                    var cred = fa.EmailAuthProvider.credential(user.email, pwd);
                    await fa.reauthenticateWithCredential(user, cred);
                    cerrar(true);
                } catch (e) {
                    if (msg) { msg.style.color = '#ff5858'; msg.textContent = '⚠️ Contraseña incorrecta.'; }
                }
            }
            document.getElementById('sa-diag-pwd-si').onclick = intentar;
            var inp = document.getElementById('sa-diag-pwd');
            if (inp) {
                inp.focus();
                inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') intentar(); });
            }
        });
    }

    window._saEntrarDiagnostico = async function _saEntrarDiagnostico(uid, rol, clubId) {
        var meReal = window._cronosCurrentUser;
        if (!meReal || (meReal.role !== 'superadmin' && meReal.role !== 'admin')) return;
        var meta = DIAG_PANELES[rol];
        if (!meta) { _dToast('⚠️ Ese rol no tiene panel al que entrar.', 3500); return; }

        var fsh, uData;
        try {
            fsh = await _dFS();
            var snap = await fsh.getDoc(fsh.doc(fsh.db, 'users', uid));
            if (!snap.exists()) { _dToast('⚠️ Ese usuario ya no existe.', 3500); return; }
            uData = snap.data() || {};
        } catch (e) {
            _dToast('⚠️ No se pudo leer el usuario: ' + (e && e.message ? e.message : e), 4500);
            return;
        }

        var ok = await _pedirClaveMaestra(uData.email || uid);
        if (!ok) return;

        // 🔑 EL REGISTRO SE ESCRIBE ANTES DE ARMAR EL CANDADO. Después ya no se
        // podría escribir nada — ni siquiera esto. Y si el registro falla, NO se
        // entra: un acceso a los datos de otra persona sin dejar rastro es
        // exactamente lo que no puede pasar.
        try {
            // 🔒 v631 · en `users/{saUid}/sa_privado/diagnostico`, no en la raíz
            //    de su documento: aquélla la lee cualquier usuario autenticado.
            await _saRegistroAnadir(fsh, meReal.uid, 'diagnostico', {
                uid: uid, email: uData.email || '', rol: rol,
                clubId: clubId || uData.clubId || '', at: new Date().toISOString(),
            });
        } catch (e) {
            _dToast('⛔ No se pudo registrar el acceso, así que no se entra: ' +
                    (e && e.message ? e.message : e), 6000);
            return;
        }

        // ── La plaza con la que se entra ────────────────────────────
        var plaza = (Array.isArray(uData.allRoles) ? uData.allRoles : []).filter(function (r) {
            return r && r.role === rol &&
                   String(r.clubId || r.individualEntityId || '') === String(clubId || '');
        })[0] || null;

        var cat = (plaza && (plaza.category || plaza.categoryLabel)) || uData.category || '';
        var sub = (plaza && plaza.subcategory) || uData.subcategory || '';
        // Forma canónica, igual que en la v627: el teamId tiene que salir
        // idéntico al que calcula el propio usuario, o su panel se vería
        // apuntando a un equipo que no es el suyo.
        if (cat && typeof window.ctNormCat === 'function') {
            var canon = window.ctNormCat(cat);
            if (canon) {
                if (!sub) { var m = String(cat).match(/_([abc])$/i); if (m) sub = m[1].toUpperCase(); }
                cat = canon;
            }
        }

        // ── Se guarda la identidad REAL y se suplanta la de trabajo ──
        window._cronosDiag = {
            uid: uid,
            email: uData.email || uid,
            rol: rol,
            rolLabel: meta.label,
            desde: new Date().toISOString(),
            saReal: meReal,
        };

        window._cronosCurrentUser = Object.assign({}, uData, {
            uid:            uid,
            _activeRole:    rol,
            _activeRoleData: plaza || null,
            clubId:         (plaza && (plaza.clubId || plaza.individualEntityId)) || clubId || uData.clubId || null,
            clubName:       (plaza && plaza.clubName) || uData.clubName || '',
            category:       cat || null,
            subcategory:    sub || null,
            _enDiagnostico: true,
        });
        // El "modo prueba" por club del panel de Dirección no debe seguir
        // apuntando a otro sitio mientras se diagnostica a esta persona.
        window._testRoleClubId = null;

        // Se cierra el panel del SuperAdmin — de verdad. Ver _cerrarPanelSA.
        _cerrarPanelSA();
        if (typeof window._navReset === 'function') window._navReset();

        _pintarCartel();
        _dToast('🩺 Modo diagnóstico: ' + (uData.email || uid) + ' · ' + meta.label, 4000);

        try {
            meta.abrir(window._cronosCurrentUser);
        } catch (e) {
            console.error('[Diagnóstico] no se pudo abrir el panel:', e);
            _dToast('⚠️ No se pudo abrir su panel: ' + (e && e.message ? e.message : e), 5000);
        }
    };

    window.saSalirDiagnostico = function saSalirDiagnostico() {
        var d = window._cronosDiag;
        if (!d) return;
        window._cronosCurrentUser = d.saReal;
        window._cronosDiag = null;          // desde aquí vuelve a poderse escribir
        window._testRoleClubId = null;
        _quitarCartel();
        if (typeof window._navReset === 'function') window._navReset();

        // Se esconde el terreno de juego, que puede haber quedado a la vista si
        // se diagnosticó a un entrenador. Misma doctrina que navExitToRoles: se
        // OCULTA, no se destruye.
        ['main-header', 'main-container', 'setup-modal'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        if (document.body) document.body.style.background = '#0d1117';

        _dToast('✅ Fuera del modo diagnóstico. Vuelves a ser tú.', 3500);
        if (typeof window.openSuperAdminPanel === 'function') {
            window.openSuperAdminPanel();
            setTimeout(function () { if (typeof window.saTab === 'function') window.saTab('diagnostico'); }, 60);
        } else {
            location.reload();
        }
    };

})();
