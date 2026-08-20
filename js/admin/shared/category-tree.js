// ════════════════════════════════════════════════════════════════════
//  ÁRBOL JERÁRQUICO 7×3 (Categoría → Subcategoría A/B/C) — SOLO LECTURA
// ════════════════════════════════════════════════════════════════════
//  Helper compartido de RENDER (sin acciones) extraído del patrón que
//  ya existía duplicado en:
//    · js/admin/club/panel.js        · unifiedUserTable()  (modo 'club')
//    · js/admin/individual/panel.js  · _buildIndIndex()+render (modo 'individual')
//
//  Este módulo NO toca Firestore ni emite botones de editar/eliminar. Se
//  usa donde solo hace falta VER el árbol (p. ej. el SuperAdmin mirando
//  cada club / ente individual). Los paneles Club e Individual mantienen
//  su propia copia con acciones (este helper no los modifica).
//
//  API:
//    window.renderCategoryTreeReadOnly(expandedUsers, { mode })
//      · expandedUsers: array de usuarios "expandidos por rol", donde cada
//        elemento trae u._activeRoleData = { role, category, subcategory,
//        coordinatorType?, isAuthorized?, status? }. (Mismo shape que usan
//        los dos paneles originales.)
//      · mode: 'club'        → incluye bloque Staff (Director/Coordinador)
//              'individual'   → sin bloque Staff (el admin es su propio
//                               entrenador; solo Entrenador/Padre en el árbol)
//      Devuelve un string HTML (incluye un <style> scoped para el plegado
//      anidado correcto, igual que el fix de club/panel.js).
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // Las 9 categorías y 3 subcategorías son idénticas en ambos paneles.
    //
    // ⚠️ EL LITERAL DE LAS ETIQUETAS ES EL QUE FIJÓ EL AUTOR (2026-08-12) y no
    // se "corrige": 'Regional FEM' con FEM en mayúsculas y 'FUTureFEM' con esa
    // capitalización exacta. Van a continuación de 'Regional', y el ORDEN de
    // este array es el orden en que se pintan los tres árboles.
    const CT_CATEGORIES = [
        { id: 'prebenjamin',  label: 'Prebenjamín' },
        { id: 'benjamin',     label: 'Benjamín' },
        { id: 'alevin',       label: 'Alevín' },
        { id: 'infantil',     label: 'Infantil' },
        { id: 'cadete',       label: 'Cadete' },
        { id: 'juvenil',      label: 'Juvenil' },
        { id: 'regional',     label: 'Regional' },
        { id: 'regional_fem', label: 'Regional FEM' },
        { id: 'futurefem',    label: 'FUTureFEM' },
    ];
    const CT_SUBCATS = ['A', 'B', 'C'];
    const _validCatIds = new Set(CT_CATEGORIES.map(c => c.id));
    const _coordLabel = { f7: 'F7', f11: 'F11', f711: 'F7&11' };

    // Roles que van al árbol (Entrenador / Padre) en cualquiera de los dos
    // modelos de datos (club usa 'user'/'parent'; individual añade variantes).
    const _COACH_ROLES  = new Set(['user', 'entrenador_individual']);
    const _PARENT_ROLES = new Set(['parent', 'parent_individual']);

    // ── Escapado seguro con fallback (admin-shared.js suele definirlos) ──
    function _eH(s) {
        if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : s);
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Normaliza categoría: acepta 'prebenjamin' o el slot combinado 'prebenjamin_a'.
    // ⚠️ EL ESPACIO SE CONVIERTE EN '_' ANTES DE QUITAR EL SUFIJO: desde que hay
    // categorías de DOS PALABRAS ('Regional FEM'), el respaldo por categoryLabel
    // llega como 'regional fem a' y sin esto no casaría nunca con el id
    // 'regional_fem' — el usuario caería fuera del árbol sin ningún error.
    // ══════════════════════════════════════════════════════════════════
    //  🔴🔴🔴 v565 · "ALEVÍN" NO CASABA CON 'alevin'
    //
    //  Reporte del autor (capturas 9112/9113): las categorías **Alevín** y
    //  **Regional** salían VACÍAS en los DOS paneles, con los datos intactos en
    //  la base y sin arreglarse al reiniciar sesión.
    //
    //  🔑🔑🔑 Los dos paneles pintan con ESTE MISMO componente, y aquí la
    //  categoría se normalizaba sin quitar los acentos ni el prefijo de
    //  modalidad. Así que lo guardado no casaba con el catálogo:
    //
    //      'Alevín'       -> 'alevín'        ✗ (el catálogo dice 'alevin')
    //      'f11_regional' -> 'f11_regional'  ✗ (el catálogo dice 'regional')
    //
    //  y la persona caía en "Sin categoría/subcategoría asignada" mientras su
    //  tarjeta se pintaba vacía. Nunca fue un problema de permisos ni de datos:
    //  el entrenador estaba en la página, en otro bloque.
    //
    //  ⚠️ Que sólo fallaran DOS categorías es la firma del defecto: las que se
    //  guardan con tilde o con prefijo. Las demás casaban por casualidad.
    //
    //  ⚠️⚠️ LOS ACENTOS SE QUITAN POR CÓDIGO DE CARÁCTER, nunca con una clase
    //  de regex: el bloque combinante escrito dentro de una expresión acaba en
    //  el fichero como marcas sueltas invisibles y cualquier paso que toque la
    //  codificación las destruye SIN ERROR (misma razón que en cronosTeamSlug).
    //
    //  🔑🔑 NO SE ESCRIBE UNA NORMALIZACIÓN NUEVA: `window.ctNormCat` —más
    //  abajo en este mismo fichero— ya hacía exactamente esto, y su comentario
    //  de cabecera ya avisaba de que "con la de arriba" (esta `_normCat`) los
    //  valores con tilde o con prefijo "caerían fuera del árbol". El resolutor
    //  bueno existía; lo que faltaba era que `_buildIndex` lo usara. Duplicarlo
    //  es justo lo que prohíben test_player_stats_accumulator.js (6b: UNA sola
    //  normalización de tildes) y test_category_tree_resolver.js (4f), que
    //  cazaron el primer intento.
    // ══════════════════════════════════════════════════════════════════
    function _normCat(r) {
        const crudo = r.category != null ? r.category : (r.categoryLabel || '');
        if (typeof window.ctNormCat === 'function') return window.ctNormCat(crudo);
        // Respaldo mínimo (no debería usarse: ctNormCat se define en este fichero).
        return String(crudo).trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/_[abc]$/, '');
    }
    // Normaliza subcategoría: directa o derivada del sufijo '_a/_b/_c'.
    function _normSub(r) {
        let sub = String(r.subcategory || '').trim().toUpperCase();
        if (!sub) {
            const m = String(r.category || '').match(/_([abc])$/i);
            if (m) sub = m[1].toUpperCase();
        }
        return sub;
    }

    function _regDate(u) {
        if (u.createdAt) {
            let d;
            if (u.createdAt.toDate) d = u.createdAt.toDate();
            else if (typeof u.createdAt === 'number') d = new Date(u.createdAt);
            else if (u.createdAt.seconds) d = new Date(u.createdAt.seconds * 1000);
            else d = new Date(u.createdAt);
            if (d instanceof Date && !isNaN(d.getTime())) return d.toLocaleDateString();
        } else if (u.authorizedAt) {
            const d = new Date(u.authorizedAt);
            if (d instanceof Date && !isNaN(d.getTime())) return d.toLocaleDateString();
        }
        return '–';
    }

    // Identidad de la PERSONA en la lista expandida. El árbol recibe una fila
    // por PLAZA, así que la misma persona aparece varias veces: para saber si
    // dos filas son del mismo humano hace falta esta clave, no el objeto.
    function _idPersona(u) {
        return String((u && (u.id || u.uid)) || (u && u.email) || '');
    }

    // ══════════════════════════════════════════════════════════════════
    //  🔴🔴🔴 v581 · EL MISMO ENTRENADOR, ARRIBA "SIN CATEGORÍA" Y ABAJO
    //               EN SU EQUIPO
    //
    //  Reporte del autor (CD Días): el panel del SuperAdmin contaba **11
    //  entrenadores donde hay 7**. Cuatro (JOSÉ, Alberto, Bruno, Dámaso)
    //  salían en el bloque "⚠️ Sin categoría/subcategoría asignada (4)" Y
    //  ADEMÁS, más abajo, correctamente colocados en su equipo (JOSÉ en
    //  Prebenjamín · A). No eran ocho personas: eran cuatro, contadas dos
    //  veces.
    //
    //  🔑🔑🔑 EL ÁRBOL NO RECIBE PERSONAS, RECIBE PLAZAS. Quien llama
    //  expande `allRoles` a una fila por entrada, y en `allRoles` conviven
    //  la plaza buena (con categoría) y restos incompletos de la misma
    //  plaza —entradas nacidas del flujo de solicitud, sin `category` y a
    //  veces sin `clubId`—. Cada resto caía aquí en `unassigned` porque, mirado
    //  por separado, no tiene equipo válido. El dato estaba bien; lo que
    //  fallaba era leer dos registros de una misma plaza como si fueran dos.
    //
    //  🔑 LA REGLA: "sin categoría" describe a una PERSONA, no a un registro.
    //  Si esa persona ya tiene equipo en este árbol con ese mismo rol, no
    //  está sin categoría — punto. Por eso hace falta un pase previo: la fila
    //  buena puede llegar DESPUÉS de la incompleta, y decidirlo sobre la
    //  marcha depende del orden en que vengan, que no controla nadie.
    //
    //  ⚠️ NO se colapsan plazas distintas: un entrenador con F7 y F11 tiene
    //  DOS equipos de verdad (regla de v537) y sigue saliendo dos veces, una
    //  en cada categoría. Lo que se descarta es sólo el registro SIN equipo
    //  de un rol que sí lo tiene, y el duplicado exacto de una misma plaza.
    //
    //  ⚠️⚠️ ESTO SE ARREGLA EN EL COMPONENTE COMPARTIDO, no en el panel del
    //  SuperAdmin, porque los dos árboles con acciones (clubs-tab.js y
    //  individual-entity.js) expanden por su cuenta y ambos pueden traer el
    //  mismo par. Ponerlo en uno solo es dejar el defecto vivo en el otro.
    // ══════════════════════════════════════════════════════════════════
    // ── Índice O(n): staff + (catId → subId → [usuarios]) ────────────────
    function _buildIndex(eUsers, mode) {
        const staff      = [];          // {u, role, coordType}  (solo modo 'club')
        const byCatSub   = new Map();   // catId -> (subId -> [usuarios])
        const catHasAny  = new Set();
        const subHasAny  = new Set();
        const unassigned = [];          // entrenadores/padres sin categoría válida

        // Pase previo: qué pares (persona, rol) YA tienen equipo válido.
        const _conEquipo = new Set();   // 'uid|rol'
        (eUsers || []).forEach(u => {
            const r = u._activeRoleData || {};
            const role = r.role || u.role;
            if (!_COACH_ROLES.has(role) && !_PARENT_ROLES.has(role)) return;
            const cat = _normCat(r);
            const sub = _normSub(r);
            if (_validCatIds.has(cat) && CT_SUBCATS.includes(sub)) {
                _conEquipo.add(_idPersona(u) + '|' + role);
            }
        });
        // Plazas ya pintadas, para no repetir una misma dos veces.
        const _yaPintada = new Set();

        (eUsers || []).forEach(u => {
            const r = u._activeRoleData || {};
            const role = r.role || u.role;

            if (mode === 'club') {
                if (role === 'director') { staff.push({ u, role, coordType: '' }); return; }
                if (role === 'coordinator') {
                    let ct = '';
                    const n = String(r.coordinatorType || r.requestedCoordinatorType || '').trim().toLowerCase();
                    if (n === 'f7' || n === 'f11' || n === 'f711') ct = n;
                    if (!ct && typeof window._cronosStaffCoordinatorType === 'function') {
                        ct = window._cronosStaffCoordinatorType(u) || '';
                    }
                    if (!ct) return; // coordinador sin tipo válido → excluir (histórico)
                    staff.push({ u, role, coordType: ct });
                    return;
                }
            }

            // Solo Entrenador / Padre van al árbol.
            if (!_COACH_ROLES.has(role) && !_PARENT_ROLES.has(role)) return;
            const cat = _normCat(r);
            const sub = _normSub(r);
            const pid = _idPersona(u);
            // Si no tiene categoría/subcategoría válida, va a 'unassigned' (visible en el panel)
            if (!_validCatIds.has(cat) || !CT_SUBCATS.includes(sub)) {
                // v581 · Si esta misma persona ya lleva ese rol CON equipo, este
                // registro es un resto incompleto de esa plaza, no una plaza
                // huérfana: sale más abajo, en su categoría, y aquí no se pinta.
                if (_conEquipo.has(pid + '|' + role)) return;
                const kSin = pid + '|' + role + '|SIN';
                if (_yaPintada.has(kSin)) return;   // ni dos veces sin equipo
                _yaPintada.add(kSin);
                unassigned.push(u);
                return;
            }
            const kCon = pid + '|' + role + '|' + cat + '|' + sub;
            if (_yaPintada.has(kCon)) return;       // la MISMA plaza, una sola fila
            _yaPintada.add(kCon);
            if (!byCatSub.has(cat)) byCatSub.set(cat, new Map());
            const subMap = byCatSub.get(cat);
            if (!subMap.has(sub)) subMap.set(sub, []);
            subMap.get(sub).push(u);
            catHasAny.add(cat);
            subHasAny.add(cat + '|' + sub);
        });
        return { staff, byCatSub, catHasAny, subHasAny, unassigned };
    }

    // ════════════════════════════════════════════════════════════════════
    //  v534 · EL NOMBRE REAL, NUNCA EL CORREO
    //
    //  Reporte del autor: en la columna NOMBRE salía el trozo del correo
    //  anterior a la arroba ("jose_arg027", "brunamp") en vez del nombre con
    //  el que se registró.
    //
    //  🔑🔑🔑 Y el nombre SÍ ESTABA GUARDADO: leído por REST, **6 de los 7
    //  usuarios no tienen `firstName` en la RAÍZ del documento**, pero todos lo
    //  llevan dentro de `allRoles[].firstName` ("Nena", "José Alberto",
    //  "Alberto", "Dámaso"…). El código miraba sólo la raíz, no lo encontraba y
    //  caía en el último recurso: partir el correo por la arroba.
    //
    //  ⚠️ **NO HAY APELLIDOS EN NINGÚN SITIO**: `lastName` es `null` en todos
    //  los roles de todos los usuarios. Se muestra lo que hay; inventarlos no
    //  es una opción y decir que se muestran sería mentir.
    //
    //  Regla, y por eso este resolutor es único: el correo **jamás** vale como
    //  nombre. Si no hay nombre, se dice que no lo hay.
    // ════════════════════════════════════════════════════════════════════
    function _nombreDeFuente(o) {
        if (!o || typeof o !== 'object') return '';
        const nombre   = o.firstName || o.nombre || '';
        const apellido = o.lastName || o.surname || o.apellidos || o.apellido || '';
        const junto = [nombre, apellido].filter(Boolean).join(' ').trim();
        if (junto) return junto;
        return String(o.fullName || o.name || o.displayName || '').trim();
    }

    window.cronosNombreUsuario = function (u, porDefecto) {
        const _sin = (porDefecto === undefined) ? 'Sin nombre' : porDefecto;
        if (!u || typeof u !== 'object') return _sin;
        // 1 · La raíz del documento.
        let n = _nombreDeFuente(u);
        // 2 · El rol con el que se está mostrando (lo aporta el árbol).
        if (!n) n = _nombreDeFuente(u._activeRoleData);
        // 3 · Cualquiera de sus roles: AQUÍ es donde vive de verdad.
        if (!n && Array.isArray(u.allRoles)) {
            for (let i = 0; i < u.allRoles.length && !n; i++) {
                n = _nombreDeFuente(u.allRoles[i]);
            }
        }
        // 4 · Lo que traiga una solicitud de registro.
        if (!n) n = _nombreDeFuente({ firstName: u.requestedName || u.userName,
                                      lastName: u.requestedLastName });
        return n || _sin;
    };

    // ════════════════════════════════════════════════════════════════════
    //  v535 · BORRADO DE USUARIO, UNO SOLO Y CON ARCHIVADO PREVIO
    //
    //  Pedido por el autor para los tres paneles (SuperAdmin, Club e
    //  Individual). Antes de escribirlo se comprobó qué había:
    //   · el panel de CLUB ya lo tenía, y bien: archiva y verifica;
    //   · el panel INDIVIDUAL tenía botón, pero llamaba directo a
    //     `deleteAuthUser` **saltándose el archivado** — la pérdida de datos
    //     que arregló v502: la plantilla es una SUBCOLECCIÓN y quedaba
    //     ilegible para siempre;
    //   · el árbol del SUPERADMIN no lo tenía.
    //  Y había suelta una `deleteUserPermanently()` que borraba sin archivar y
    //  no llamaba nadie: una mina esperando a que alguien la cableara.
    //
    //  🔑 REGLA: no se borra a nadie sin que su trabajo esté archivado y
    //  VERIFICADO en el servidor. Esa comprobación vive en la Cloud Function
    //  `archiveAndDeleteCoach`, que ya autoriza a superadmin, club_admin e
    //  individual_admin — por eso NO hace falta tocar ni desplegar Functions.
    //
    //  ⚠️ CUENTAS ADMINISTRADORAS: la Function se niega a borrarlas por
    //  diseño ("dejar un club sin administrador no se puede deshacer"). Para
    //  un admin de club, el autor eligió (implementar.txt, 2026-08-14) que se
    //  ofrezca el DESMANTELADO COMPLETO del club por la vía que ya existe,
    //  `saDeleteClubComplete`, que sí se lleva informes, partidos y vínculos.
    //
    //  ⚠️ La confirmación es TECLEANDO EL CORREO, decisión suya: "máxima
    //  seguridad". Un `confirm()` se acepta con un toque accidental en una
    //  tablet, y esto es irreversible.
    // ════════════════════════════════════════════════════════════════════
    window.cronosEliminarUsuarioSeguro = async function (datos) {
        const d = datos || {};
        const uid = d.uid, email = d.email;
        const rol = d.role || '';
        if (!uid || !email) { alert('Faltan datos del usuario. No se ha hecho nada.'); return false; }

        const esAdmin = (rol === 'club_admin' || rol === 'individual_admin' || rol === 'superadmin');
        if (esAdmin) {
            if (rol === 'club_admin' && d.clubId) {
                if (typeof window.saDeleteClubComplete !== 'function') {
                    alert('⚠️ Para dar de baja a un Administrador de Club hay que desmantelar su club, ' +
                          'y esa herramienta no está disponible en esta pantalla.');
                    return false;
                }
                if (!confirm('⚠️ ' + email + ' es ADMINISTRADOR DE CLUB.\n\n' +
                             'Su cuenta no se puede borrar sola: el club se quedaría vivo y sin nadie ' +
                             'que lo administre, y eso no tiene vuelta atrás.\n\n' +
                             'Se te va a ofrecer el BORRADO COMPLETO del club "' +
                             (d.clubName || d.clubId) + '", que sí se lleva informes, partidos y vínculos.\n\n' +
                             '¿Continuar?')) return false;
                return window.saDeleteClubComplete(d.clubId, d.clubName || d.clubId);
            }
            alert('⚠️ ' + email + ' es una cuenta administradora y no se borra desde aquí.\n\n' +
                  'Hazlo desde su panel correspondiente, para que el club o el ente no se queden ' +
                  'sin responsable.');
            return false;
        }

        const tecleado = prompt(
            '⚠️ ELIMINAR A ' + email + '\n\n' +
            'Su trabajo se archivará primero en la categoría, y sólo entonces se liberará su plaza.\n' +
            'Si era su último rol, la cuenta se borra y el correo queda libre.\n\n' +
            'Escribe su correo EXACTO para confirmar:'
        );
        if (tecleado === null) return false;
        if (String(tecleado).trim().toLowerCase() !== String(email).trim().toLowerCase()) {
            alert('El correo no coincide. No se ha hecho nada.');
            return false;
        }

        try {
            if (typeof window.saFS !== 'function') {
                alert('⚠️ No se pudo contactar con el servidor. No se ha borrado nada.');
                return false;
            }
            const { fa, httpsCallable } = await window.saFS();
            if (typeof httpsCallable !== 'function' || !fa || !fa.functions) {
                alert('⚠️ No se pudo contactar con el servidor para archivar el trabajo. ' +
                      'No se ha borrado nada: reinténtalo.');
                return false;
            }
            // ════════════════════════════════════════════════════════════
            //  🔑🔑🔑 v536 · PRIMERO SE REVOCA LA CASILLA. ESTE PASO FALTABA.
            //
            //  Reporte del autor: desde el árbol del SuperAdmin "la acción no
            //  termina y el miembro sigue apareciendo"; desde el panel de Club
            //  funcionaba. La diferencia era exactamente ésta.
            //
            //  `archiveAndDeleteCoach` decide con
            //  `borrarCuenta = rolesVivos.length === 0 && !esCuentaAdmin`, y su
            //  propio comentario avisa: *"quedan DESPUÉS de la revocación (el
            //  panel revoca justo antes de llamar)"*. Sin revocar, el rol sigue
            //  vivo → no se borra la cuenta Y el rol sigue pintándose en el
            //  árbol. Archivaba de verdad, pero por fuera parecía no hacer nada.
            //
            //  ⚠️ Sin `clubId` no se puede revocar una casilla concreta (es el
            //  caso de un sub-usuario de ente individual). Entonces se archiva
            //  igual y se DICE lo que ha pasado, en vez de aparentar un borrado.
            // ════════════════════════════════════════════════════════════
            // ════════════════════════════════════════════════════════════
            //  ⚠️⚠️ v581 · SE REVOCA **UNA PLAZA**, NO UN ROL ENTERO
            //
            //  `caSetUserStatus` seleccionaba los roles a revocar por
            //  (club + nombre de rol). Un entrenador con dos equipos tiene DOS
            //  entradas 'user' en el mismo club, así que borrar desde una fila
            //  se llevaba también la otra; y desde una fila descolocada —sin
            //  categoría— se llevaba la ÚNICA buena. Por eso ahora se le pasa
            //  la categoría de ESTA fila y sólo se toca esa casilla.
            //
            //  🔑 Y si la fila no dice a qué equipo pertenece, NO se revoca a
            //  ciegas: sin categoría la puntería volvería a ser "todos los
            //  roles de ese nombre", que es justo el daño que esto evita.
            // ════════════════════════════════════════════════════════════
            const _plaza = {
                category:    d.category    || '',
                subcategory: d.subcategory || '',
            };
            let _revocado = false;
            if (typeof window.caSetUserStatus === 'function' && d.clubId) {
                if (typeof showToast === 'function') showToast('⏳ Liberando su plaza…', 3000);
                // `true` = no volver a preguntar: ya confirmó tecleando el correo.
                _revocado = (await window.caSetUserStatus(
                    uid, email, 'removed', d.clubId, rol || null, true, _plaza)) === true;
                // ⚠️ v581 · SI LA PLAZA NO SE HA LIBERADO, NO SE ARCHIVA NI SE
                //    BORRA NADA. Antes se daba la revocación por hecha y se
                //    seguía adelante pase lo que pase: de ahí salía el aviso
                //    que reportó el autor —"la plaza NO se ha liberado y puede
                //    seguir apareciendo"— DESPUÉS de haber archivado, y con la
                //    cuenta ya en manos de la Function. Media operación es peor
                //    que ninguna: si no se puede revocar, se para aquí.
                if (!_revocado) {
                    alert('⚠️ No se ha tocado nada.\n\n' +
                          'No se ha podido liberar la plaza de ' + email + ' en este equipo, ' +
                          'así que no se archiva ni se borra su cuenta.\n\n' +
                          'Suele significar que esta fila no corresponde a una plaza viva ' +
                          '(un registro antiguo o ya dado de baja). Su vínculo real con el club ' +
                          'sigue INTACTO.');
                    return false;
                }
            }

            if (typeof showToast === 'function') showToast('⏳ Archivando su trabajo…', 4000);

            const res = await httpsCallable(fa.functions, 'archiveAndDeleteCoach')({
                uid: uid, email: email, clubId: d.clubId || null, role: rol || null,
                category: _plaza.category || null, subcategory: _plaza.subcategory || null,
            });
            const r = (res && res.data) || {};
            // El archivo deja constancia formal de la acción: guarda quién la
            // ejecutó y cuándo (archivedBy/archivedAt, en la Function).
            alert('✅ Hecho con ' + email + '.\n\n' +
                  (_revocado ? 'Plaza liberada.\n' :
                   // Único camino que llega aquí sin revocar: un sub-usuario de
                   // ente individual, que no tiene club del que liberar plaza.
                   // (El caso del club ya se ha detenido antes: v581.)
                   'ℹ️ No pertenece a ningún club, así que no había plaza que liberar.\n') +
                  'Archivado: ' + (r.documentosArchivados || 0) + ' documento(s), ' +
                  (r.clavesArchivadas || 0) + ' dato(s).\n' +
                  (r.cuentaBorrada
                      ? 'Era su último rol: cuenta eliminada y correo LIBERADO.'
                      : 'Su cuenta sigue activa con ' + ((r.rolesRestantes || []).length) + ' rol(es): ' +
                        ((r.rolesRestantes || []).join(', ') || '—')));
            if (typeof navReload === 'function') navReload();
            return true;
        } catch (e) {
            const msg = (e && e.message) || String(e);
            alert('⚠️ No se ha completado.\n\n' + msg + '\n\n' +
                  'Si dice que el archivado no se pudo verificar, NO se ha borrado la cuenta ' +
                  'ni se ha perdido ningún dato: vuelve a intentarlo.');
            console.error('[cronosEliminarUsuarioSeguro]', e);
            return false;
        }
    };

    // ── Fila plana de un usuario (Entrenador/Padre) ─────────────────────
    //  ⚠️ El botón de borrar es OPT-IN (`opts.conBorrado`): este helper lo usan
    //  varios paneles y meter una acción destructiva por defecto la colaría en
    //  pantallas donde nadie la pidió.
    //  ⚠️ Las opciones NO viajan como parámetro: las filas se pintan con
    //  `usersArr.map(_userRowHtml)`, y `Array.map` pasa el ÍNDICE como segundo
    //  argumento. Un `opts` que a veces es un número es un fallo silencioso
    //  esperando; se guardan al entrar en el render y se leen aquí.
    let _opcionesRender = {};
    function _userRowHtml(u) {
        const r = u._activeRoleData || {};
        const roleMeta = (window.ROLE_META || {})[r.role] || { icon: '👤', color: '#8b949e', label: r.role || 'Usuario' };

        // v534 · Resolutor único. El correo NO es un nombre: va en su columna.
        const fullName = _eH(window.cronosNombreUsuario(u));

        const pending = (r.isAuthorized === false || r.status === 'pending_individual' || r.status === 'pending_club_admin' || r.status === 'pending_sa' || r.status === 'pending')
            ? '<span style="font-size:0.62rem;color:#ffa500;margin-left:0.3rem;">⏳</span>' : '';

        // ID completo en fuente monospace pequeña — totalmente visible y copiable
        const fullId = _eH(String(u.id || u.uid || ''));
        const idEl = fullId
            ? '<span style="font-size:0.6rem;color:#58a6ff;background:rgba(88,166,255,0.06);' +
              'padding:2px 5px;border-radius:4px;font-family:monospace;cursor:pointer;word-break:break-all;" ' +
              'title="Copiar ID" onclick="navigator.clipboard.writeText(\'' + fullId + '\').then(()=>{this.style.color=\'#3fb950\';setTimeout(()=>this.style.color=\'#58a6ff\',1500);})">' +
              fullId + '</span>'
            : '<span style="color:#4d5566;font-size:0.6rem;">—</span>';

        return '' +
            '<div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(100px,1fr) minmax(0,2fr) auto;' +
            ' align-items:start; gap:0.6rem; padding:0.55rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.05);">' +
            '<div style="font-size:0.7rem; color:' + roleMeta.color + '; font-weight:600; white-space:nowrap; padding-top:2px;">' + roleMeta.icon + ' ' + _eH(roleMeta.label) + pending + '</div>' +
            '<div style="font-weight:600; color:white; font-size:0.82rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + fullName + '</div>' +
            '<div style="font-size:0.74rem; color:#8b949e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + _eH(u.email || '') + '">' + _eH(u.email || '') + '</div>' +
            '<div style="font-size:0.68rem; color:#8b949e; white-space:nowrap;">' + _eH(_regDate(u)) + '</div>' +
            '</div>' +
            '<div style="padding:0 0.6rem 0.45rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.05); margin-top:-0.3rem; display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">' +
            '<span style="font-size:0.6rem;color:#4d5566;margin-right:4px;">ID:</span>' + idEl +
            _botonBorrarHtml(u) +
            '</div>';
    }

    // Botón de borrado. Va en la segunda línea de la fila para no tocar la
    // rejilla de columnas ni su cabecera (Rol · Nombre · Email · Fecha).
    function _botonBorrarHtml(u) {
        if (!_opcionesRender || !_opcionesRender.conBorrado) return '';
        const r = u._activeRoleData || {};
        const esc = (s) => String(s == null ? '' : s).replace(/'/g, "\\'");
        // ⚠️⚠️ v581 · LA FILA VIAJA CON SU CATEGORÍA. La unidad es la PLAZA
        //    (rol + club + categoría), no el rol (v540/v547). Sin estos dos
        //    campos, `caSetUserStatus` revoca TODOS los roles con ese nombre en
        //    ese club: borrar una fila descolocada de un entrenador se llevaba
        //    por delante el equipo que sí tenía bien asignado.
        const carga = {
            uid: u.id || u.uid || '',
            email: u.email || '',
            role: r.role || u.role || '',
            clubId: r.clubId || u.clubId || '',
            clubName: r.clubName || u.clubName || '',
            category: r.category != null ? r.category : (r.categoryLabel || ''),
            subcategory: r.subcategory != null ? r.subcategory : '',
        };
        if (!carga.uid || !carga.email) return '';
        return '<button title="Eliminar usuario (archiva su trabajo antes)" ' +
               'onclick="window.cronosEliminarUsuarioSeguro({' +
               "uid:'" + esc(carga.uid) + "',email:'" + esc(carga.email) + "'," +
               "role:'" + esc(carga.role) + "',clubId:'" + esc(carga.clubId) + "'," +
               "category:'" + esc(carga.category) + "',subcategory:'" + esc(carga.subcategory) + "'," +
               "clubName:'" + esc(carga.clubName) + "'})" + '" ' +
               'style="margin-left:auto;font-size:0.66rem;padding:2px 8px;border-radius:6px;cursor:pointer;' +
               'color:#ff5858;background:rgba(255,88,88,0.08);border:1px solid rgba(255,88,88,0.3);">🗑️ Eliminar</button>';
    }

    // ── Cabecera de columnas de una subcategoría ─────────────────────────
    function _rowHeaderHtml() {
        const th = (t) => '<div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">' + t + '</div>';
        return '' +
            '<div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(100px,1fr) minmax(0,2fr) auto;' +
            ' align-items:center; gap:0.6rem; padding:0.4rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.1);">' +
            th('Rol') + th('Nombre') + th('Email') + th('Fecha') +
            '</div>';
    }

    // ── Sección usuarios sin categoría asignada ──────────────────────────
    function _unassignedBlockHtml(unassigned) {
        if (!unassigned || !unassigned.length) return '';
        const rows = _rowHeaderHtml() + unassigned.map(_userRowHtml).join('');
        return '' +
            '<div style="margin-bottom:0.6rem; border:1px solid rgba(255,215,0,0.2); border-radius:10px; overflow:hidden;">' +
            '<div style="background:rgba(255,215,0,0.06); padding:0.45rem 0.9rem; display:flex; align-items:center; gap:0.5rem;">' +
            '<span style="font-size:0.78rem; font-weight:700; color:#ffd700;">⚠️ Sin categoría/subcategoría asignada (' + unassigned.length + ')</span>' +
            '</div>' +
            '<div>' + rows + '</div>' +
            '</div>';
    }

    // ── Bloque Staff (solo modo 'club'), SIN acciones ───────────────────
    function _staffBlockHtml(staff) {
        const ordered = staff.slice().sort((a, b) =>
            (a.role === 'director' ? 0 : 1) - (b.role === 'director' ? 0 : 1));
        const items = ordered.map(function (s) {
            const u = s.u, role = s.role, coordType = s.coordType;
            const roleMeta = (window.ROLE_META || {})[role] || { icon: '👤', color: '#8b949e', label: role };
            let name = window.cronosNombreUsuario(u);   // v534 · nunca el correo
            name = _eH(String(name).split(' ')[0]);
            const modBadge = coordType
                ? '<span class="sa-badge" style="background:rgba(210,168,255,0.15); color:#d2a8ff;">' + (_coordLabel[coordType] || coordType) + '</span>'
                : '';
            return '' +
                '<div style="display:flex; align-items:center; gap:0.6rem; padding:0.5rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.05);">' +
                '<span style="font-size:0.85rem; font-weight:700; color:white;">' + name + '</span>' +
                '<span style="font-size:0.7rem; color:' + roleMeta.color + '; font-weight:600;">' + roleMeta.icon + ' ' + _eH(roleMeta.label) + '</span>' +
                modBadge +
                '<span style="font-size:0.72rem; color:#8b949e; margin-left:auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:50%;" title="' + _eH(u.email || '') + '">' + _eH(u.email || '') + '</span>' +
                '</div>';
        }).join('');
        return '' +
            '<div style="background:rgba(240,136,62,0.05); border:1px solid rgba(240,136,62,0.25); border-radius:10px; padding:0.8rem 0.9rem; margin-bottom:1rem;">' +
            '<div style="font-size:0.78rem; font-weight:700; color:#f0883e; text-transform:uppercase; letter-spacing:1px; margin-bottom:0.5rem;">📋 Staff del Club</div>' +
            (items || '<div style="font-size:0.78rem; color:#8b949e; padding:0.4rem 0;">Sin staff (Director / Coordinadores) registrado.</div>') +
            '</div>';
    }

    // ── Subtarjeta (nivel 2): subcategoría A/B/C ─────────────────────────
    function _subcategoryCardHtml(subId, usersArr, hasAny) {
        const dot = hasAny
            ? '<span class="sa-badge" style="background:rgba(63,185,80,0.18); color:#3fb950;">' + usersArr.length + '</span>'
            : '<span style="font-size:0.7rem; color:#6e7681;">vacía</span>';
        const body = hasAny
            ? _rowHeaderHtml() + usersArr.map(_userRowHtml).join('')
            : '<div style="font-size:0.75rem; color:#6e7681; padding:0.5rem 0.6rem;">Sin usuarios en esta subcategoría.</div>';
        return '' +
            '<div class="sa-card ct-ro-card" style="margin-bottom:0.5rem; padding:0.6rem 0.7rem; border-color:rgba(255,255,255,0.08);">' +
            '<div class="sa-card-head" onclick="this.closest(\'.sa-card\').classList.toggle(\'expanded\')">' +
            '<div class="sa-card-title" style="font-size:0.82rem;">' +
            '<span class="sa-chevron">▼</span>' +
            '<span>Subcategoría ' + subId + '</span>' + dot +
            '</div></div>' +
            '<div class="sa-card-body">' + body + '</div>' +
            '</div>';
    }

    // ── Tarjeta (nivel 1): categoría ─────────────────────────────────────
    function _categoryCardHtml(catDef, idx) {
        const subMap = idx.byCatSub.get(catDef.id) || new Map();
        const catHas = idx.catHasAny.has(catDef.id);
        const subsHtml = CT_SUBCATS.map(function (subId) {
            const usersArr = subMap.get(subId) || [];
            const subHas = idx.subHasAny.has(catDef.id + '|' + subId);
            return _subcategoryCardHtml(subId, usersArr, subHas);
        }).join('');
        const dot = catHas
            ? '<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:#3fb950; box-shadow:0 0 6px rgba(63,185,80,0.7);"></span>'
            : '<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,0.12);"></span>';
        return '' +
            '<div class="sa-card ct-ro-card" style="margin-bottom:0.6rem; border-color:rgba(88,166,255,0.2);">' +
            '<div class="sa-card-head" onclick="this.closest(\'.sa-card\').classList.toggle(\'expanded\')">' +
            '<div class="sa-card-title">' +
            '<span class="sa-chevron">▼</span>' +
            '<span>' + _eH(catDef.label) + '</span>' + dot +
            '</div></div>' +
            '<div class="sa-card-body">' + subsHtml + '</div>' +
            '</div>';
    }

    // Fix de plegado anidado (igual que js/admin/club/panel.js): el CSS
    // compartido usa el selector descendiente .sa-card.expanded .sa-card-body,
    // que con tarjetas anidadas revelaría TODOS los niveles. Acotamos con el
    // selector de hijo directo solo para estas tarjetas del árbol read-only.
    const _SCOPED_STYLE =
        '<style>' +
        '.ct-ro-card.expanded > .sa-card-body { display: block; }' +
        '.ct-ro-card > .sa-card-body { display: none; }' +
        '.ct-ro-card.expanded > .sa-card-head .sa-chevron { transform: rotate(0deg); }' +
        '</style>';

    // ── API pública ──────────────────────────────────────────────────────
    function renderCategoryTreeReadOnly(expandedUsers, opts) {
        // v535 · Se guardan para que las filas sepan si llevan botón de borrar.
        _opcionesRender = opts || {};
        const mode = (opts && opts.mode) || 'club';
        const idx = _buildIndex(expandedUsers, mode);
        const treeHtml = CT_CATEGORIES.map(function (c) { return _categoryCardHtml(c, idx); }).join('');
        const staffHtml    = (mode === 'club') ? _staffBlockHtml(idx.staff) : '';
        const unassignedHtml = _unassignedBlockHtml(idx.unassigned);
        return _SCOPED_STYLE +
            '<div style="margin-bottom:0.5rem;">' + staffHtml + unassignedHtml + treeHtml + '</div>';
    }

    window.renderCategoryTreeReadOnly = renderCategoryTreeReadOnly;
    // ⚠️ FUENTE ÚNICA DEL VOCABULARIO (2026-07-30). Ya no es "por si algún
    // consumidor las necesita": admin/club/panel.js y admin/individual/panel.js
    // tenían cada uno su propia copia literal de las mismas 7 categorías y ahora
    // leen de aquí. Añadir una categoría se hace en UN sitio.
    // ══════════════════════════════════════════════════════════════════
    //  🔑🔑🔑 v550 · ESTE CATÁLOGO SE IMPONE. NO SE CEDE AL QUE LLEGÓ ANTES.
    //
    //  Aquí ponía `window.CT_CATEGORIES = window.CT_CATEGORIES || CT_CATEGORIES`,
    //  y ese `||` era el fallo: **si algo había definido ya la variable, el
    //  catálogo bueno no se aplicaba jamás**. Basta con que el navegador
    //  evalúe una copia ANTIGUA de este fichero antes que la nueva —el Service
    //  Worker sirviéndola de su Cache Storage, una doble carga, una pestaña
    //  que quedó viva— para que el panel se quede con el vocabulario viejo
    //  PARA SIEMPRE, sin un solo error en consola.
    //
    //  Es exactamente lo que reportó el autor el 2026-08-16: en la ventana
    //  normal veía **5 categorías y sin Cadete**; en incógnito, las 9. Y seguía
    //  igual DESPUÉS de borrar IndexedDB, caché y cookies — porque el problema
    //  no era el dato, era el vocabulario con el que se pinta.
    //
    //  🔑 Ahora se FUSIONA: mandan las de este fichero (fuente única) y se
    //  conservan al final las que alguien hubiera añadido y no estén aquí, sin
    //  duplicar. Así el resultado no depende del orden de carga.
    //
    //  ⚠️ Añadir una categoría se sigue haciendo en UN solo sitio: la lista
    //  `CT_CATEGORIES` de arriba. Esto no abre una segunda vía.
    // ══════════════════════════════════════════════════════════════════
    (function _imponeVocabulario() {
        var previas = Array.isArray(window.CT_CATEGORIES) ? window.CT_CATEGORIES : [];
        var mias = CT_CATEGORIES.map(function (c) { return c.id; });
        var extras = previas.filter(function (c) {
            return c && c.id && mias.indexOf(c.id) === -1;
        });
        if (previas.length && extras.length !== previas.length) {
            console.warn('[v550] Había otro CT_CATEGORIES con ' + previas.length +
                         ' categoría(s) (¿copia antigua del fichero?). Se impone el catálogo de ' +
                         CT_CATEGORIES.length + '.');
        }
        window.CT_CATEGORIES = CT_CATEGORIES.concat(extras);

        var subsPrev = Array.isArray(window.CT_SUBCATS) ? window.CT_SUBCATS : [];
        var subsExtra = subsPrev.filter(function (s) { return CT_SUBCATS.indexOf(s) === -1; });
        window.CT_SUBCATS = CT_SUBCATS.concat(subsExtra);
    })();

    // ════════════════════════════════════════════════════════════════
    //  API GENÉRICA — añadida para el panel del Director Deportivo
    //  (implementar.txt, 2026-07-30, fase 1)
    //
    //  Lo de arriba agrupa USUARIOS y pinta filas con su rol y su email. El
    //  panel del Director necesita agrupar INFORMES, CONVOCATORIAS y
    //  ENTRENAMIENTOS con el mismo árbol, así que lo que se comparte es la
    //  estructura y el contenido de la hoja va como callback.
    //
    //  ⚠️ NORMALIZACIÓN DISTINTA, Y A PROPÓSITO. La _normCat de arriba hace
    //  toLowerCase() y quita el sufijo _a/_b/_c, pero NO quita tildes: vale para
    //  usuarios, cuya categoría viene de un formulario y ya es un id. Los
    //  informes y convocatorias guardan la categoría TAL COMO VENÍA DEL PARTIDO,
    //  y ahí aparecen "Alevín", "F7_Alevin_A" o "Alevin B". Con la de arriba
    //  todas esas caerían fuera del árbol. Estas replican _normCat/_normSubcat
    //  de js/coach/comms/panel.js, que es la forma canónica del proyecto; la
    //  equivalencia entre ambas la fija scripts/test_category_tree.js.
    // ════════════════════════════════════════════════════════════════

    window.ctNormCat = function (raw) {
        if (raw == null) return '';
        // \p{M} = marcas combinantes, en vez del rango literal [U+0300-U+036F]:
        // escrito con los caracteres de verdad serían DOS CARACTERES INVISIBLES
        // en el fuente, y cualquier reescritura con la codificación equivocada
        // los convertiría en mojibake — "Alevín" y "Alevin" pasarían a ser
        // categorías distintas y los informes se irían a "Sin clasificar" sin
        // que nada fallase a gritos. Así el fuente es 100% ASCII.
        var s = String(raw).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
        s = s.replace(/^(f7_|f8_|f11_)/, '').replace(/_[abc]$/i, '').replace(/\s+[abc]$/i, '');
        // 🔑 CATEGORÍAS DE DOS PALABRAS (2026-08-12, 'Regional FEM'): el mismo
        // equipo llega como 'Regional FEM', 'regional_fem' o 'f11_regional_fem'
        // según el origen. Se unifica al id con guion bajo DESPUÉS de quitar el
        // sufijo A/B/C, que es quien distingue 'Regional FEM B' de la categoría.
        s = s.trim().replace(/[\s-]+/g, '_');
        if (s === 'future_fem' || s === 'futuro_fem') s = 'futurefem';
        return s;
    };

    window.ctNormSubcat = function (raw) {
        if (raw == null) return '';
        var s = String(raw).trim().toUpperCase();
        var m = s.match(/([ABC])$/);
        return m ? m[1] : s;
    };

    // Devuelve { byCatSub: Map<catId, Map<subId, item[]>>, sinClasificar, total }.
    // ⚠️ DECISIÓN EXPLÍCITA DEL AUTOR (2026-07-30): lo no clasificable NO se
    // descarta, se agrupa aparte. El árbol de usuarios de arriba sí lo descarta,
    // pero allí son altas incompletas; aquí serían informes y convocatorias que
    // HOY SE VEN en el panel del Director, y hacerlos desaparecer al introducir
    // el árbol sería una regresión visible.
    window.ctGroupByCatSub = function (items, getCat, getSub) {
        var byCatSub = new Map();
        var sinClasificar = [];
        var valid = new Set((window.CT_CATEGORIES || []).map(function (c) { return c.id; }));

        (items || []).forEach(function (it) {
            var cat = window.ctNormCat(getCat ? getCat(it) : '');
            var sub = window.ctNormSubcat(getSub ? getSub(it) : '');
            if (!valid.has(cat) || (window.CT_SUBCATS || []).indexOf(sub) === -1) {
                sinClasificar.push(it);
                return;
            }
            if (!byCatSub.has(cat)) byCatSub.set(cat, new Map());
            var subMap = byCatSub.get(cat);
            if (!subMap.has(sub)) subMap.set(sub, []);
            subMap.get(sub).push(it);
        });

        return { byCatSub: byCatSub, sinClasificar: sinClasificar, total: (items || []).length };
    };

    window.ctCountInCat = function (groups, catId) {
        var subMap = groups && groups.byCatSub && groups.byCatSub.get(catId);
        if (!subMap) return 0;
        var n = 0;
        subMap.forEach(function (arr) { n += arr.length; });
        return n;
    };

    // CSS propio con clases `ct-tree-*`. El panel del Director NO inyecta
    // SA_CSS, y metérselo arrastraría .sa-modal/.sa-topbar, que chocarían con
    // sus estilos. Sin este CSS el árbol se vería siempre desplegado.
    window.CT_TREE_CSS = '<style>' +
        '.ct-tree-cat,.ct-tree-sub{border:1px solid rgba(255,255,255,0.08);border-radius:10px;' +
            'background:rgba(255,255,255,0.02);overflow:hidden;}' +
        '.ct-tree-cat{margin-bottom:0.6rem;border-color:rgba(88,166,255,0.2);}' +
        '.ct-tree-sub{margin-bottom:0.5rem;}' +
        '.ct-tree-head{display:flex;justify-content:space-between;align-items:center;gap:0.5rem;' +
            'padding:0.7rem 0.9rem;cursor:pointer;user-select:none;}' +
        '.ct-tree-head:hover{background:rgba(255,255,255,0.03);}' +
        '.ct-tree-title{font-weight:700;font-size:0.92rem;color:white;display:flex;' +
            'align-items:center;gap:0.5rem;min-width:0;}' +
        '.ct-tree-sub .ct-tree-title{font-size:0.82rem;}' +
        '.ct-tree-chevron{display:inline-block;transition:transform 0.15s;color:#8b949e;font-size:0.75rem;}' +
        '.ct-tree-open>.ct-tree-head .ct-tree-chevron{transform:rotate(90deg);}' +
        '.ct-tree-count{font-size:0.7rem;font-weight:700;padding:0.1rem 0.45rem;border-radius:20px;' +
            'background:rgba(63,185,80,0.18);color:#3fb950;}' +
        '.ct-tree-count.ct-tree-zero{background:rgba(255,255,255,0.06);color:#6e7681;}' +
        '.ct-tree-body{display:none;padding:0 0.9rem 0.8rem;}' +
        '.ct-tree-open>.ct-tree-body{display:block;}' +
        '.ct-tree-empty{font-size:0.75rem;color:#6e7681;padding:0.5rem 0.2rem;}' +
        '.ct-tree-none{border-color:rgba(240,136,62,0.35);}' +
        '.ct-tree-none .ct-tree-title{color:#f0883e;}' +
        '</style>';

    // Lo llaman los onclick del HTML generado, que se evalúan en ámbito global.
    window.ctToggleNode = function (el) {
        var node = el && el.closest ? el.closest('.ct-tree-cat, .ct-tree-sub') : null;
        if (node) node.classList.toggle('ct-tree-open');
    };

    // opts = { items, getCat, getSub, renderLeaf(item)->html, emptyText, hideEmpty,
    //          renderSubHeader(items, catId, subId)->html }
    // Todas las ramas arrancan PLEGADAS (decisión del autor): el panel abre
    // limpio y se despliega sólo lo que interese.
    //
    // renderSubHeader (fase 5): bloque que se pinta UNA VEZ en la cabeza del
    // cuerpo de cada subcategoría con algo, antes de las hojas. Existe porque la
    // tabla resumen de temporada que pidió el autor es POR EQUIPO, y renderLeaf
    // sólo puede hablar de un elemento; sin esto habría que replicar el marcado
    // del árbol fuera del módulo. Opcional: si no se pasa, el árbol es idéntico.
    window.ctRenderTree = function (opts) {
        opts = opts || {};
        var renderLeaf = opts.renderLeaf || function () { return ''; };
        var renderSubHeader = typeof opts.renderSubHeader === 'function' ? opts.renderSubHeader : null;
        // renderSubBadge / renderCatBadge (2026-08-13): marcado extra DENTRO de
        // la cabecera, junto al contador.
        //
        // 🔑 POR QUÉ NO VALÍA renderSubHeader PARA ESTO. Todas las ramas nacen
        // PLEGADAS, así que lo que pinta renderSubHeader no se ve hasta que
        // alguien despliega. El indicador de "quién entrena hoy" tiene que
        // leerse de un vistazo con el árbol cerrado, y eso obliga a entrar en
        // la cabecera.
        //
        // ⚠️ LOS DOS SON OPCIONALES Y EL MARCADO SIN ELLOS ES BYTE A BYTE EL
        // DE SIEMPRE: este módulo lo comparten las pestañas de Convocatorias,
        // Entrenamientos e Informes, y sus guards comparan el HTML generado.
        var renderSubBadge = typeof opts.renderSubBadge === 'function' ? opts.renderSubBadge : null;
        var renderCatBadge = typeof opts.renderCatBadge === 'function' ? opts.renderCatBadge : null;
        var emptyText  = opts.emptyText || 'Sin elementos en esta subcategoría.';
        var groups = window.ctGroupByCatSub(opts.items, opts.getCat, opts.getSub);

        // ══════════════════════════════════════════════════════════════
        //  🎯 v593 · opts.modalidad — el árbol de UNA modalidad
        //
        //  El Coordinador de Fútbol 7 no coordina al Juvenil. Filtrar sólo
        //  los ELEMENTOS no bastaba: este árbol recorre el catálogo ENTERO
        //  (window.CT_CATEGORIES), así que le seguían saliendo Infantil,
        //  Cadete, Juvenil, Regional… con un 0 al lado. Nueve ramas de las
        //  que seis no son asunto suyo no es un panel acotado, es el panel
        //  del club con los números a cero.
        //
        //  ⚠️ APAGADO POR DEFECTO Y BYTE A BYTE IGUAL QUE SIEMPRE: sin
        //  `opts.modalidad` no se filtra nada. Este módulo lo comparten cinco
        //  pestañas y sus guards comparan el HTML generado.
        //
        //  ⚠️ La modalidad de una categoría se pregunta a _cronosMatchModality
        //  (utils.js), que es la forma canónica del proyecto — aquí NO se
        //  reescribe la lista de qué es F7 y qué es F11. Si esa función no
        //  estuviera cargada, no se filtra: mejor de más que dejar a alguien
        //  sin árbol.
        // ══════════════════════════════════════════════════════════════
        var _modal = (opts.modalidad == null ? '' : String(opts.modalidad)).trim().toLowerCase();
        var _catalogo = (window.CT_CATEGORIES || []);
        if ((_modal === 'f7' || _modal === 'f11') && typeof window._cronosMatchModality === 'function') {
            _catalogo = _catalogo.filter(function (c) {
                var m = window._cronosMatchModality(c.id);
                return !m || m === _modal;   // sin clasificar → se conserva
            });
        }

        var cats = _catalogo.map(function (catDef) {
            var n = window.ctCountInCat(groups, catDef.id);
            if (opts.hideEmpty && n === 0) return '';
            var subMap = groups.byCatSub.get(catDef.id) || new Map();

            var subs = (window.CT_SUBCATS || []).map(function (subId) {
                var arr = subMap.get(subId) || [];
                // opts.alwaysSubHeader: llama a renderSubHeader TAMBIÉN en las
                // subcategorías vacías. Existe por el filial cuyos jugadores
                // sólo han jugado cedidos hacia arriba: no tiene ni un partido
                // propio, así que sin esto su rama nunca preguntaba por las
                // colaboraciones y el trabajo de esos chavales no se veía en
                // ningún sitio. Por defecto va APAGADO y el marcado sale
                // idéntico al de siempre.
                var cabecera = (renderSubHeader && (arr.length || opts.alwaysSubHeader))
                    ? (renderSubHeader(arr, catDef.id, subId) || '') : '';
                var body = arr.length
                    ? (cabecera + arr.map(renderLeaf).join(''))
                    : (cabecera + '<div class="ct-tree-empty">' + _eH(emptyText) + '</div>');
                var badge = renderSubBadge ? (renderSubBadge(arr, catDef.id, subId) || '') : '';
                return '' +
                '<div class="ct-tree-sub">' +
                    '<div class="ct-tree-head" onclick="ctToggleNode(this)">' +
                        '<div class="ct-tree-title"><span class="ct-tree-chevron">&#9654;</span>' +
                            '<span>Subcategoría ' + _eH(subId) + '</span></div>' +
                        badge +
                        '<span class="ct-tree-count' + (arr.length ? '' : ' ct-tree-zero') + '">' +
                            arr.length + '</span>' +
                    '</div>' +
                    '<div class="ct-tree-body">' + body + '</div>' +
                '</div>';
            }).join('');

            var catBadge = renderCatBadge ? (renderCatBadge(catDef.id, n, subMap) || '') : '';
            return '' +
            '<div class="ct-tree-cat">' +
                '<div class="ct-tree-head" onclick="ctToggleNode(this)">' +
                    '<div class="ct-tree-title"><span class="ct-tree-chevron">&#9654;</span>' +
                        '<span>' + _eH(catDef.label) + '</span></div>' +
                    catBadge +
                    '<span class="ct-tree-count' + (n ? '' : ' ct-tree-zero') + '">' + n + '</span>' +
                '</div>' +
                '<div class="ct-tree-body">' + subs + '</div>' +
            '</div>';
        }).join('');

        // El nodo de lo no clasificable sólo aparece si TIENE algo: si no, sería
        // ruido permanente en un club con los datos completos.
        var sin = '';
        if (groups.sinClasificar.length) {
            sin = '' +
            '<div class="ct-tree-cat ct-tree-none">' +
                '<div class="ct-tree-head" onclick="ctToggleNode(this)">' +
                    '<div class="ct-tree-title"><span class="ct-tree-chevron">&#9654;</span>' +
                        '<span>&#9888; Sin clasificar</span></div>' +
                    '<span class="ct-tree-count">' + groups.sinClasificar.length + '</span>' +
                '</div>' +
                '<div class="ct-tree-body">' +
                    groups.sinClasificar.map(renderLeaf).join('') +
                '</div>' +
            '</div>';
        }

        return window.CT_TREE_CSS + cats + sin;
    };

    // ════════════════════════════════════════════════════════════════
    //  RESOLUTOR DE CATEGORÍA/SUBCATEGORÍA (fase 2, 2026-07-30)
    //
    //  POR QUÉ HACE FALTA: los tres listados del panel del Director no traen
    //  la categoría de la misma forma.
    //    · Convocatorias   → category Y subcategory en el propio documento.
    //    · Informes colec. → las dos en el documento.
    //    · Entrenamientos  → NINGUNA. El payload sólo guarda coachUid.
    //  Sin esto, la pestaña de Entrenamientos entera caería en "Sin clasificar".
    //
    //  ⚠️ ESTE MÓDULO NO LEE LA BASE DE DATOS, y así debe seguir: recibe los
    //  documentos de usuario que el panel ya ha traído y devuelve un índice.
    //  Es lo que permite probarlo entero en un sandbox de vm.
    //
    //  🔑 DOS DECISIONES, fijadas por scripts/test_category_tree_resolver.js:
    //   1. ANTE LA DUDA NO SE ADIVINA. Un entrenador puede llevar dos equipos.
    //      Si el documento no dice de cuál es y el autor tiene más de una rama,
    //      el elemento se queda sin clasificar. Colocarlo en una rama al azar
    //      sería peor: el Director leería el informe de un equipo creyendo que
    //      es de otro.
    //   2. EL AUTOR ES coachUid, NUNCA userId/parentUid. Esos dos son el
    //      DESTINATARIO de la notificación (se añadieron para las reglas de
    //      seguridad, ver el FIX (C3) en training-notify.js). Resolver por ahí
    //      clasificaría cada convocatoria por la categoría del padre que la
    //      recibe.
    // ════════════════════════════════════════════════════════════════

    // Roles que pueden ser AUTOR de un informe/convocatoria/entrenamiento.
    // ⚠️ Deliberadamente separado de _COACH_ROLES: ése decide quién sale en el
    // árbol de USUARIOS del SuperAdmin, y añadirle 'coach' cambiaría lo que se
    // ve en ese panel, que esta fase no toca.
    const _CT_AUTHOR_ROLES = new Set(['user', 'coach', 'entrenador_individual']);

    function _ctRoleBranch(r) {
        return {
            cat: window.ctNormCat(r.category != null ? r.category : (r.categoryLabel || '')),
            sub: window.ctNormSubcat(r.subcategory || ''),
        };
    }

    // Devuelve Map<uid, { roles: [{cat, sub}] }> con las ramas de entrenador de
    // cada usuario, YA NORMALIZADAS: sin normalizar aquí, 'F7_Alevín' guardado
    // en el rol no casaría nunca con el id 'alevin' del árbol.
    window.ctBuildCoachIndex = function (userDocs) {
        const idx = new Map();
        (userDocs || []).forEach(function (u) {
            if (!u) return;
            const uid = u.id || u.uid || '';
            if (!uid) return;

            let ramas = [];
            const roles = Array.isArray(u.allRoles) ? u.allRoles : [];
            roles.forEach(function (r) {
                if (r && _CT_AUTHOR_ROLES.has(r.role)) ramas.push(_ctRoleBranch(r));
            });
            // Respaldo en la raíz para el usuario mono-rol, misma lógica que el
            // fallback de js/admin/club/panel.js.
            if (!ramas.length && _CT_AUTHOR_ROLES.has(u.role)) ramas.push(_ctRoleBranch(u));

            // Una rama sin categoría reconocible no sirve para resolver nada.
            ramas = ramas.filter(function (r) { return !!r.cat; });
            if (!ramas.length) return;
            idx.set(uid, { roles: ramas });
        });
        return idx;
    };

    // ctResolveCatSub(item, coachIndex[, opts]) → { cat, sub, source }
    //   source: 'doc'        el documento lo traía todo (no se mira al autor)
    //           'autor'      resuelto por la ficha del entrenador
    //           'ambiguo'    el autor lleva varios equipos → sin clasificar
    //           'incompleto' el autor tiene una rama, pero sin subcategoría
    //           'sin-autor'  no hay coachUid, o ya no está en el club
    //   Con cat/sub vacías, ctGroupByCatSub lo manda a "Sin clasificar" solo.
    //   opts = { getCat, getSub, getAuthorUid } para las formas que no son la
    //   de una notificación (los informes se agrupan antes por partido).
    window.ctResolveCatSub = function (item, coachIndex, opts) {
        opts = opts || {};
        item = item || {};
        const getCat = opts.getCat || function (i) {
            return i.category != null ? i.category : (i.categoryLabel || '');
        };
        const getSub = opts.getSub || function (i) { return i.subcategory || ''; };
        // 🔑 coachUid y nada más: ver la decisión 2 de la cabecera.
        const getAuthorUid = opts.getAuthorUid || function (i) { return i.coachUid || ''; };

        const validCats = new Set((window.CT_CATEGORIES || []).map(function (c) { return c.id; }));
        const validSubs = (window.CT_SUBCATS || []);
        const esSub = function (s) { return validSubs.indexOf(s) !== -1; };

        const cat = window.ctNormCat(getCat(item));
        const sub = window.ctNormSubcat(getSub(item));
        const catOk = validCats.has(cat);

        // Camino normal de convocatorias e informes: el documento se basta.
        if (catOk && esSub(sub)) return { cat: cat, sub: sub, source: 'doc' };

        const entry = (coachIndex && typeof coachIndex.get === 'function')
            ? coachIndex.get(getAuthorUid(item)) : null;
        const ramas = (entry && entry.roles) || [];

        // Caso histórico: el documento trae la categoría pero la subcategoría
        // llegó vacía (es lo que deja _cMatchSubcatFor cuando no encuentra
        // coincidencia exacta). Se completa desde la rama que casa.
        if (catOk) {
            const casan = ramas.filter(function (r) { return r.cat === cat && esSub(r.sub); });
            if (casan.length === 1) return { cat: cat, sub: casan[0].sub, source: 'autor' };
            return { cat: '', sub: '', source: casan.length ? 'ambiguo' : 'incompleto' };
        }

        // El documento no dice nada (entrenamientos): sólo se resuelve si el
        // autor tiene UNA sola rama completa.
        const completas = ramas.filter(function (r) { return validCats.has(r.cat) && esSub(r.sub); });
        if (completas.length === 1) {
            return { cat: completas[0].cat, sub: completas[0].sub, source: 'autor' };
        }
        if (completas.length > 1 || ramas.length > 1) return { cat: '', sub: '', source: 'ambiguo' };
        return { cat: '', sub: '', source: ramas.length ? 'incompleto' : 'sin-autor' };
    };

    // ════════════════════════════════════════════════════════════════
    //  TABLA RESUMEN ACUMULADA DE TEMPORADA (fase 5, 2026-07-30)
    //
    //  Va en la parte alta de cada subcategoría del panel del Director, encima
    //  del listado de informes partido a partido.
    //
    //  DE DÓNDE SALEN LOS JUGADORES, y por qué NO de la plantilla: la plantilla
    //  vive en users/{coachUid}/cronos_data/main y su regla sólo la deja leer a
    //  su dueño; además ese documento contiene cronos_email_config, o sea los
    //  emails y teléfonos de TODOS los padres, así que abrirlo a la dirección
    //  sería ampliar el acceso a datos personales. DECISIÓN DEL AUTOR: la tabla
    //  se construye con los jugadores que aparecen en los informes. Un jugador
    //  nunca convocado no figura; a cambio no se tocan permisos y se cubre todo
    //  el histórico.
    //
    //  🔑 LAS TRES TRAMPAS DE LOS DATOS (las fija test_player_stats_accumulator.js):
    //   1. minutesPlayed NO ES UN NÚMERO: es "MM:SS" (formatTime). Y los docs
    //      escritos sin formatTime cargado traen los SEGUNDOS en crudo. Se
    //      aceptan las dos formas, se acumula en segundos y se redondea AL FINAL
    //      (redondear cada partido daría 89 donde son 90).
    //   2. LAS AMARILLAS NO SE PUEDEN CONTAR DE `cards`: es un solo campo y la
    //      segunda amarilla lo sobrescribe a 'roja', así que un expulsado por
    //      doble amarilla saldría con CERO amarillas. Se cuentan de `history`,
    //      donde sí quedan las dos ('DOBLE AMARILLA → EXPULSADO' se tipa como
    //      'yellow' porque el parser mira 'amarilla' antes que 'roja').
    //   3. Y LAS ROJAS NO SE PUEDEN CONTAR DE `history`: en una doble amarilla
    //      no hay entrada 'red' y en una roja directa sí. Se cuentan de
    //      `cards === 'roja'`, que cubre los dos casos exactamente una vez.
    //      Sumar las dos fuentes duplicaría las rojas directas.
    // ════════════════════════════════════════════════════════════════

    // "45:30" → 2730 · "2730" → 2730 · 2730 → 2730 · basura/ausente → 0
    function _ctToSeconds(v) {
        if (typeof v === 'number' && isFinite(v)) return Math.max(0, Math.round(v));
        const s = String(v == null ? '' : v).trim();
        const mmss = s.match(/^(\d+):([0-5]?\d)$/);
        if (mmss) return parseInt(mmss[1], 10) * 60 + parseInt(mmss[2], 10);
        if (/^\d+$/.test(s)) return parseInt(s, 10);
        return 0;
    }

    // Cuenta amarillas en history, que puede venir ya parseado (objetos con
    // .type) o todavía en crudo (las cadenas de logEvent).
    function _ctYellowsIn(history) {
        if (!Array.isArray(history)) return 0;
        let n = 0;
        history.forEach(function (e) {
            if (e && typeof e === 'object') { if (e.type === 'yellow') n++; return; }
            if (typeof e === 'string' && e.toLowerCase().indexOf('amarilla') !== -1) n++;
        });
        return n;
    }

    function _ctIsRed(cards) {
        const c = String(cards == null ? '' : cards).trim().toLowerCase();
        return c === 'roja' || c === 'red';
    }

    // ════════════════════════════════════════════════════════════════
    //  ¿EMPEZÓ EL PARTIDO COMO TITULAR? (columna PT, 2026-08-13)
    // ════════════════════════════════════════════════════════════════
    //  🔑🔑🔑 EL DATO NO ESTABA GUARDADO. Se comprobó leyendo los 300
    //  informes de producción por REST antes de escribir nada: en
    //  cronos_player_reports NO existe ni initialStatus, ni titular, ni
    //  status, ni titularOrder. La titularidad se elegía en la convocatoria
    //  y se perdía por el camino — el objeto de jugador de
    //  event-listeners.js se construye con una LISTA FIJA de campos.
    //
    //  Por eso hay DOS vías, en este orden:
    //
    //   1. MARCA EXPLÍCITA (`wasStarter`), que a partir de ahora escriben los
    //      informes nuevos. Es exacta y no se discute.
    //
    //   2. DEDUCCIÓN DEL HISTORIAL, para todo lo ya guardado. Es la MISMA
    //      regla que report-engine.js llama "información airtight" para
    //      pintar la barra de minutos: si tu primera TRANSICIÓN registrada es
    //      una SALIDA, forzosamente estabas en el campo; si es una ENTRADA,
    //      forzosamente estabas fuera.
    //
    //  ⚠️ SÓLO CUENTAN sub_in Y sub_out. El historial trae también goles y
    //  tarjetas —comprobado en los datos reales: un jugador tenía
    //  `goal,goal,goal,sub_out,…`—, y mirar "el primer suceso" a secas lo
    //  daba por indeterminado. La transición es lo único que informa de
    //  dónde estaba antes.
    //
    //  ⚠️ SIN NINGUNA TRANSICIÓN: si jugó minutos, empezó. Un suplente que
    //  entra deja SIEMPRE un sub_in; no haberlo es la prueba de que ya
    //  estaba dentro. Si no jugó ni un minuto, no fue titular.
    function _ctEmpezoDeTitular(p) {
        if (!p) return false;

        // 1. Marca explícita de los informes nuevos.
        if (p.wasStarter === true) return true;
        if (p.wasStarter === false) return false;
        if (p.initialStatus === 'field' || p.titular === true) return true;
        if (p.initialStatus === 'bench') return false;

        // 2. Deducción por la primera TRANSICIÓN del historial.
        const hist = Array.isArray(p.history) ? p.history : [];
        for (let i = 0; i < hist.length; i++) {
            const e = hist[i];
            const t = (e && typeof e === 'object') ? e.type
                    : (typeof e === 'string' ? e.toLowerCase() : '');
            if (t === 'sub_out' || (typeof t === 'string' && t.indexOf('sale') !== -1)) return true;
            if (t === 'sub_in'  || (typeof t === 'string' && t.indexOf('entra') !== -1)) return false;
        }

        // 3. Sin transiciones: jugó = empezó.
        return _ctToSeconds(p.minutesPlayed) > 0;
    }
    window._ctEmpezoDeTitular = _ctEmpezoDeTitular;

    // ctAccumulatePlayerStats(matches) → filas ordenadas por dorsal
    //   matches: los objetos agrupados por partido de reports-tab.js, cada uno
    //   con players[] (los documentos de cronos_player_reports de ese partido).
    //   fila = { number, alias, called, pj, seconds, minutes, goals, yellow, red, injuries }
    window.ctAccumulatePlayerStats = function (matches) {
        const porJugador = new Map();

        (matches || []).forEach(function (m) {
            const players = (m && Array.isArray(m.players)) ? m.players : [];
            players.forEach(function (p) {
                if (!p) return;
                const num   = String(p.playerNumber == null ? '' : p.playerNumber).trim();
                const alias = String(p.playerAlias || p.playerName || '').trim();
                // Sin dorsal se agrupa por alias; el prefijo evita que un alias
                // que parezca un número se mezcle con el dorsal de otro.
                //
                // 🔑 EL INVITADO SE AGRUPA POR SU FICHA, NO POR EL DORSAL
                // (plazas de apoyo, 2026-08-12). Un jugador que sube del cadete
                // suele llevar un dorsal libre del equipo anfitrión, y ese
                // dorsal ES DE OTRO en los demás partidos: agrupando por número
                // los dos se fundían en una sola fila y el acumulado del equipo
                // atribuía a uno los minutos del otro. La ficha ('CDA07') es
                // única en el club, que es justo para lo que el autor pidió
                // conservarla.
                const key = (p.isGuest === true && p.originPlayerId)
                    ? ('f:' + String(p.originPlayerId))
                    : (num ? ('n:' + num) : ('a:' + alias.toLowerCase()));
                if (key === 'a:') return;   // ni dorsal ni alias: no es un jugador

                let f = porJugador.get(key);
                if (!f) {
                    f = { number: num, alias: alias, ficha: '', called: 0, pj: 0, pt: 0, seconds: 0,
                          minutes: 0, goals: 0, yellow: 0, red: 0, injuries: 0 };
                    porJugador.set(key, f);
                }
                // El alias puede llegar vacío en un partido y relleno en otro.
                if (alias) f.alias = alias;

                // 🔑 EL INVITADO SE MARCA EN LA TABLA DEL EQUIPO DE ACOGIDA
                // (2026-08-12, petición del autor): sale en la lista del
                // Juvenil B como uno más —sus minutos SÍ son del Juvenil B—,
                // pero en una línea diferenciada, porque un acumulado que no
                // distingue a un cedido de un jugador de la casa induce a
                // error al leer la temporada del equipo.
                if (p.isGuest === true) {
                    f.isGuest = true;
                    if (p.originPlayerId) f.ficha = String(p.originPlayerId);
                    const _oc = window.ctNormCat(p.originCategory || '');
                    const _os = window.ctNormSubcat(p.originSubcategory || '');
                    const _lbl = _ctTeamLabel(_oc, _os);
                    if (_lbl) f.originLabel = _lbl;
                }

                const secs = _ctToSeconds(p.minutesPlayed);
                f.called  += 1;
                if (secs > 0) f.pj += 1;      // convocado que no jugó NO suma partido
                // ⚠️ PT se comprueba SOBRE LOS QUE JUGARON. Un convocado que
                // se quedó en el banquillo los 90 minutos no puede sumar
                // titularidad, y la deducción "sin transiciones = empezó"
                // daría true para él si no se filtrara antes por minutos.
                if (secs > 0 && _ctEmpezoDeTitular(p)) f.pt += 1;
                f.seconds += secs;
                f.goals   += Number(p.goals) || 0;
                f.yellow  += _ctYellowsIn(p.history);
                if (_ctIsRed(p.cards)) f.red += 1;
                if (p.injured === true) f.injuries += 1;
            });
        });

        const filas = [...porJugador.values()];
        // 🔑 Redondeo AL FINAL, sobre el total en segundos.
        filas.forEach(function (f) { f.minutes = Math.floor(f.seconds / 60); });
        // Orden por dorsal NUMÉRICO (si no, "10" iría antes que "7"); los que no
        // tienen dorsal, al final y por alias.
        filas.sort(function (a, b) {
            const na = a.number ? parseInt(a.number, 10) : Infinity;
            const nb = b.number ? parseInt(b.number, 10) : Infinity;
            if (na !== nb) return na - nb;
            return String(a.alias).localeCompare(String(b.alias), 'es');
        });
        return filas;
    };

    window.CT_STATS_CSS = '<style>' +
        '.ct-stats-wrap{overflow-x:auto;margin-bottom:0.9rem;border:1px solid rgba(88,166,255,0.18);' +
            'border-radius:10px;background:rgba(255,255,255,0.02);}' +
        '.ct-stats{width:100%;border-collapse:collapse;font-size:0.76rem;min-width:460px;}' +
        '.ct-stats caption{caption-side:top;text-align:left;padding:0.6rem 0.8rem 0.4rem;' +
            'font-size:0.78rem;font-weight:700;color:#79c0ff;}' +
        '.ct-stats th{font-size:0.62rem;text-transform:uppercase;letter-spacing:0.5px;color:#79c0ff;' +
            'font-weight:700;padding:0.45rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.12);' +
            'text-align:center;white-space:nowrap;}' +
        '.ct-stats th.ct-stats-name,.ct-stats td.ct-stats-name{text-align:left;}' +
        '.ct-stats td{padding:0.4rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.05);' +
            'text-align:center;color:#c9d1d9;white-space:nowrap;}' +
        '.ct-stats td.ct-stats-name{color:white;font-weight:600;}' +
        '.ct-stats-dorsal{display:inline-block;min-width:1.5rem;color:#8b949e;font-size:0.7rem;}' +
        '.ct-stats tr.ct-stats-total td{border-top:1px solid rgba(255,255,255,0.15);' +
            'border-bottom:none;font-weight:700;color:#79c0ff;}' +
        '.ct-stats-zero{color:#4d5566;}' +
        '.ct-stats-empty{padding:0.8rem;font-size:0.76rem;color:#8b949e;}' +
        // Filas de COLABORACIÓN con otro equipo (plazas de apoyo). Malva, el
        // mismo color con el que se marcan las plazas de apoyo en la plantilla
        // y en la convocatoria: el entrenador ya asocia ese color a "prestado".
        '.ct-stats tr.ct-stats-guest td{background:rgba(210,168,255,0.07);color:#d2a8ff;}' +
        '.ct-stats tr.ct-stats-guest td.ct-stats-name{color:#d2a8ff;font-weight:600;}' +
        '.ct-stats-guest-tag{display:inline-block;font-size:0.6rem;font-weight:700;' +
            'background:rgba(210,168,255,0.16);border:1px solid rgba(210,168,255,0.3);' +
            'border-radius:5px;padding:1px 5px;margin-left:0.35rem;white-space:nowrap;}' +
        '.ct-stats-guest-head td{background:rgba(210,168,255,0.04);color:#8b949e;' +
            'font-size:0.66rem;text-align:left;font-style:italic;}' +
        // ⬆ INVITADO EN EL EQUIPO DE ACOGIDA: naranja. A propósito DISTINTO del
        // malva de las colaboraciones: son dos cosas opuestas y coincidirían en
        // la pantalla del mismo Director. Naranja = "juega aquí y no es de
        // aquí"; malva = "es de aquí y ha jugado fuera".
        '.ct-stats tr.ct-stats-in td{background:rgba(240,136,62,0.07);color:#f0883e;}' +
        '.ct-stats tr.ct-stats-in td.ct-stats-name{color:#f0883e;font-weight:600;}' +
        '.ct-stats-in-tag{display:inline-block;font-size:0.6rem;font-weight:700;color:#f0883e;' +
            'background:rgba(240,136,62,0.16);border:1px solid rgba(240,136,62,0.32);' +
            'border-radius:5px;padding:1px 5px;margin-left:0.35rem;white-space:nowrap;}' +
        // Jugador de la plantilla que aún no ha jugado: se ve, pero apagado.
        '.ct-stats tr.ct-stats-idle td{opacity:0.62;}' +
        '.ct-stats-idle-tag{display:inline-block;font-size:0.58rem;font-weight:600;color:#8b949e;' +
            'background:rgba(255,255,255,0.05);border-radius:5px;padding:1px 5px;' +
            'margin-left:0.35rem;white-space:nowrap;}' +
        '</style>';

    // ════════════════════════════════════════════════════════════════
    //  COLABORACIONES CON OTROS EQUIPOS (plazas de apoyo, 2026-08-12)
    //
    //  ctAccumulateGuestStats(matches, catId, subId) → filas
    //
    //  Qué resuelve: cuando un cadete sube a jugar con el juvenil, su informe
    //  se escribe DENTRO del partido del juvenil, así que el árbol —que
    //  agrupa por la categoría DEL PARTIDO— lo deja en la rama del juvenil y
    //  en el acumulado de su propio equipo no aparece por ningún lado.
    //
    //  Esta función recorre TODOS los partidos del club y se queda sólo con
    //  las líneas marcadas isGuest cuyo ORIGEN es el equipo (catId, subId)
    //  que se está pintando. El resultado va como fila supletoria, aparte y
    //  de otro color: es el requisito literal del autor —"permitiendo ver
    //  ambas realidades de forma clara"—, y por eso NO se suma a la fila
    //  normal del jugador ni a los totales del equipo.
    //
    //  ⚠️ Se agrupa por FICHA de origen. Es el único identificador estable:
    //  el dorsal con el que juega prestado no es suyo.
    // ════════════════════════════════════════════════════════════════
    window.ctAccumulateGuestStats = function (matches, catId, subId) {
        const porFicha = new Map();
        const nc = window.ctNormCat, ns = window.ctNormSubcat;

        (matches || []).forEach(function (m) {
            const players = (m && Array.isArray(m.players)) ? m.players : [];
            // Equipo ANFITRIÓN: sale del propio documento del informe, que es
            // el del partido en el que colaboró.
            const anfCat = nc(m && (m.category != null ? m.category : ''));
            const anfSub = ns(m && (m.subcategory || ''));

            players.forEach(function (p) {
                if (!p || p.isGuest !== true) return;
                if (nc(p.originCategory || '') !== catId) return;
                if (ns(p.originSubcategory || '') !== subId) return;

                const ficha = String(p.originPlayerId || '').trim();
                const alias = String(p.playerAlias || p.playerName || '').trim();
                const key = ficha ? ('f:' + ficha) : ('a:' + alias.toLowerCase());
                if (key === 'a:') return;

                let f = porFicha.get(key);
                if (!f) {
                    f = { number: '', alias: alias, ficha: ficha, called: 0, pj: 0, pt: 0,
                          seconds: 0, minutes: 0, goals: 0, yellow: 0, red: 0,
                          injuries: 0, hosts: [] };
                    porFicha.set(key, f);
                }
                if (alias) f.alias = alias;

                const etiqueta = _ctTeamLabel(anfCat, anfSub);
                if (etiqueta && f.hosts.indexOf(etiqueta) === -1) f.hosts.push(etiqueta);

                const secs = _ctToSeconds(p.minutesPlayed);
                f.called += 1;
                if (secs > 0) f.pj += 1;
                // El jugador de apoyo cuenta su titularidad EN EL EQUIPO CON
                // EL QUE COLABORÓ, que es donde salió de inicio.
                if (secs > 0 && _ctEmpezoDeTitular(p)) f.pt += 1;
                f.seconds += secs;
                f.goals   += Number(p.goals) || 0;
                f.yellow  += _ctYellowsIn(p.history);
                if (_ctIsRed(p.cards)) f.red += 1;
                if (p.injured === true) f.injuries += 1;
            });
        });

        const filas = [...porFicha.values()];
        filas.forEach(function (f) { f.minutes = Math.floor(f.seconds / 60); });
        filas.sort(function (a, b) {
            return String(a.alias).localeCompare(String(b.alias));
        });
        return filas;
    };

    // ════════════════════════════════════════════════════════════════
    //  LA PLANTILLA ENTERA EN EL ACUMULADO (2026-08-12, petición del autor)
    //
    //  ctMergeSquadRows(filas, plantilla) → filas
    //
    //  Hasta ahora la tabla se construía SÓLO con quien aparecía en algún
    //  informe: un F11 de 25 fichas enseñaba 14 nombres y el resto no existía.
    //  El autor quiere la lista OFICIAL del equipo, con ceros para quien no ha
    //  jugado todavía.
    //
    //  🔑 DE DÓNDE SALE LA PLANTILLA, Y POR QUÉ AHORA SÍ SE PUEDE. La cabecera
    //  de este módulo explicaba que la tabla NO usa la plantilla real porque
    //  vive en users/{uid}/cronos_data —sólo su dueño— y ese documento
    //  contiene los correos y teléfonos de todos los padres. Eso SIGUE SIENDO
    //  CIERTO. Lo que ha cambiado es que existe una copia SIN datos personales
    //  en clubs/{clubId}/team_rosters (ficha, dorsal, nombre, alias), que es de
    //  donde se lee. No se ha ampliado el acceso a ningún dato personal.
    //
    //  ⚠️ SIN PLANTILLA PUBLICADA NO SE INVENTA NADA: si el equipo no tiene
    //  copia (su entrenador no ha guardado desde el cambio), la tabla queda
    //  exactamente como antes. Es degradación limpia, no un hueco.
    //
    //  🔑 EL CRUCE ES POR FICHA Y, SI FALTA, POR DORSAL. Nunca por alias: dos
    //  hermanos pueden compartirlo y se fundirían en una fila.
    // ════════════════════════════════════════════════════════════════
    window.ctMergeSquadRows = function (filas, plantilla) {
        filas = Array.isArray(filas) ? filas : [];
        if (!Array.isArray(plantilla) || !plantilla.length) return filas;

        const porFicha  = new Map();
        const porDorsal = new Map();
        filas.forEach(function (f) {
            if (f.ficha) porFicha.set(String(f.ficha), f);
            if (f.number) porDorsal.set(String(f.number), f);
        });

        const out = filas.slice();
        plantilla.forEach(function (p) {
            if (!p) return;
            const ficha  = String(p.ficha || '').trim();
            const dorsal = String(p.dorsal == null ? '' : p.dorsal).trim();
            const alias  = String(p.alias || p.nombre || '').trim();

            // ⚠️ HACE FALTA NOMBRE, NO BASTA CON DORSAL. Las filas vacías de la
            // plantilla llevan un dorsal de relleno (1..25) y ningún nombre:
            // aceptándolas, un F11 a medio rellenar metía once filas fantasma
            // "Sin nombre" en el acumulado del equipo. Lo cazó el guard.
            if (!alias) return;

            // 🔑 SE CRUZA POR FICHA **Y** POR DORSAL, no por una u otra.
            // Las líneas de informe de un jugador de la casa NO llevan ficha
            // (sólo la llevan los invitados), así que comprobar la ficha del
            // lado de la plantilla y darla por no encontrada duplicaba a TODO
            // jugador con informes en cuanto su plantilla publicada sí traía
            // código. También lo cazó el guard.
            if (ficha && porFicha.has(ficha)) return;      // ya tiene informes
            if (dorsal && porDorsal.has(dorsal)) return;

            out.push({ number: dorsal, alias: alias || 'Sin nombre', ficha: ficha,
                       called: 0, pj: 0, pt: 0, seconds: 0, minutes: 0, goals: 0,
                       yellow: 0, red: 0, injuries: 0, sinDatos: true });
        });

        // Mismo orden que ctAccumulatePlayerStats: dorsal NUMÉRICO y los que no
        // tienen dorsal al final, por alias. Si no, los añadidos se apilarían
        // todos abajo y la lista dejaría de leerse como una plantilla.
        out.sort(function (a, b) {
            const na = a.number ? parseInt(a.number, 10) : Infinity;
            const nb = b.number ? parseInt(b.number, 10) : Infinity;
            if (na !== nb) return na - nb;
            return String(a.alias || '').localeCompare(String(b.alias || ''));
        });
        return out;
    };

    // Etiqueta legible de un equipo a partir de sus ids ya normalizados.
    function _ctTeamLabel(catId, subId) {
        const def = (window.CT_CATEGORIES || []).filter(function (c) { return c.id === catId; })[0];
        const base = def ? def.label : String(catId || '');
        if (!base) return '';
        return (base + ' ' + String(subId || '')).trim();
    }

    // ctRenderStatsTable(filas[, opts]) → HTML de la tabla resumen acumulada.
    //   opts.matchCount: partidos que ha disputado el EQUIPO. Va a la celda PJ
    //   de la fila de totales; sin él, esa celda queda con un guion.
    //   opts.guestRows:  filas de ctAccumulateGuestStats. Se pintan DEBAJO de
    //   las normales, en malva y con la etiqueta del equipo con el que
    //   colaboró. Sin ellas el marcado sale idéntico al de siempre.
    window.ctRenderStatsTable = function (filas, opts) {
        filas = Array.isArray(filas) ? filas : [];
        opts = opts || {};
        // ⚠️ EL VACÍO SE MIDE CONTRA LAS DOS LISTAS. Un equipo puede no tener
        // ni un informe propio y aun así tener jugadores cedidos a categorías
        // superiores (justo el caso de un filial). Mirando sólo `filas`, esa
        // tabla se quedaba en "todavía no hay informes" y las colaboraciones
        // no se veían en ninguna parte.
        if (!filas.length && !(Array.isArray(opts.guestRows) && opts.guestRows.length)) {
            return window.CT_STATS_CSS +
                '<div class="ct-stats-wrap"><div class="ct-stats-empty">' +
                'Todavía no hay informes de este equipo, así que no hay acumulado de temporada.' +
                '</div></div>';
        }
        const cel = (n) => '<td' + (n ? '' : ' class="ct-stats-zero"') + '>' + n + '</td>';

        // 🔑 LA FILA DE TOTALES NO SUMA LO QUE NO SE PUEDE SUMAR (ajuste del
        // autor, 2026-07-30, tras verlo en producción).
        //  · PJ: sumar los partidos de cada jugador daba 71 en un equipo que
        //    había jugado 14 — es la suma de PARTICIPACIONES, y leída bajo la
        //    columna "PJ" sólo confunde. Va el número de partidos del EQUIPO,
        //    que llega en opts.matchCount; si no se sabe, un guion.
        //  · Min: sumar los minutos de toda la plantilla no significa nada
        //    (11 jugadores × 90' = 990' por partido). Guion siempre.
        //  · Goles, tarjetas y lesiones SÍ son magnitudes del equipo: se suman.
        // En las filas de CADA JUGADOR, PJ y minutos no se tocan: ahí sí
        // significan lo que dicen.
        const tot = filas.reduce(function (t, f) {
            t.goals += f.goals; t.yellow += f.yellow;
            t.red += f.red; t.injuries += f.injuries;
            return t;
        }, { goals: 0, yellow: 0, red: 0, injuries: 0 });
        const totPj = (typeof opts.matchCount === 'number' && isFinite(opts.matchCount))
            ? String(opts.matchCount) : '-';

        const _sinJugar = filas.filter(function (f) { return f.sinDatos; }).length;

        const cuerpo = filas.map(function (f) {
            // Tres estados de fila, y cada uno se lee de un vistazo:
            //  · normal            → sin clase
            //  · INVITADO (naranja)→ juega aquí pero es de otra categoría
            //  · sin minutos (gris)→ está en la plantilla y no ha jugado
            const clases = [];
            if (f.isGuest) clases.push('ct-stats-in');
            if (f.sinDatos) clases.push('ct-stats-idle');
            return '<tr' + (clases.length ? ' class="' + clases.join(' ') + '"' : '') + '>' +
                '<td class="ct-stats-name">' +
                    '<span class="ct-stats-dorsal">' + _eH(f.number || '—') + '</span> ' +
                    _eH(f.alias || 'Sin nombre') +
                    (f.isGuest
                        ? '<span class="ct-stats-in-tag" title="Jugador de apoyo: pertenece a otra categoría del club">' +
                          '&#8593; ' + _eH(f.originLabel || 'otra categoría') +
                          (f.ficha ? ' · ' + _eH(f.ficha) : '') + '</span>'
                        : '') +
                    (f.sinDatos
                        ? '<span class="ct-stats-idle-tag" title="En la plantilla, sin minutos todavía">sin jugar</span>'
                        : '') +
                '</td>' +
                cel(f.pj) +
                cel(f.pt) +
                cel(f.minutes) +
                cel(f.goals) +
                cel(f.yellow) +
                cel(f.red) +
                cel(f.injuries) +
            '</tr>';
        }).join('');

        // ── Filas supletorias de colaboración ────────────────────────────
        // Van DESPUÉS del cuerpo normal y NO entran en `tot`: los goles que un
        // cadete marcó jugando con el juvenil no son goles del cadete, y
        // sumarlos al total del equipo falsearía su temporada.
        const invitadas = Array.isArray(opts.guestRows) ? opts.guestRows : [];
        const cuerpoInv = invitadas.length ? (
            '<tr class="ct-stats-guest-head"><td colspan="8">' +
                '&#8593; Colaboraciones con otros equipos del club ' +
                '(no suman en el total de este equipo)' +
            '</td></tr>' +
            invitadas.map(function (f) {
                const conQuien = (f.hosts && f.hosts.length)
                    ? f.hosts.join(' · ') : 'otro equipo';
                return '<tr class="ct-stats-guest">' +
                    '<td class="ct-stats-name">' +
                        '<span class="ct-stats-dorsal">' + _eH(f.ficha || f.number || '—') + '</span> ' +
                        _eH(f.alias || 'Sin nombre') +
                        '<span class="ct-stats-guest-tag">&#8593; ' + _eH(conQuien) + '</span>' +
                    '</td>' +
                    cel(f.pj) +
                    cel(f.pt) +
                    cel(f.minutes) +
                    cel(f.goals) +
                    cel(f.yellow) +
                    cel(f.red) +
                    cel(f.injuries) +
                '</tr>';
            }).join('')
        ) : '';

        return window.CT_STATS_CSS +
        '<div class="ct-stats-wrap"><table class="ct-stats">' +
            // ⚠️ El rótulo dejó de poder decir "N jugadores con informes" en
            // cuanto la tabla lista la plantilla ENTERA: quien no ha jugado no
            // tiene informes. Se dicen las dos cifras, que es la información
            // que el Director quiere de un vistazo.
            '<caption>Resumen acumulado de la temporada · ' + filas.length + ' jugador' +
                (filas.length === 1 ? '' : 'es') +
                (_sinJugar ? ' (' + _sinJugar + ' sin jugar)' : '') + '</caption>' +
            '<thead><tr>' +
                '<th class="ct-stats-name">Jugador</th>' +
                '<th title="Partidos jugados">PJ</th>' +
                '<th title="Partidos como titular (salió de inicio)">PT</th>' +
                '<th title="Minutos jugados totales">Min</th>' +
                '<th title="Goles">Goles</th>' +
                // v476 · Los cuadrados grandes van SEGUIDOS en Unicode y es
                // facilisimo pillar el de al lado: &#128997; 🟥 rojo,
                // &#128998; azul, &#128999; naranja, &#129000; 🟨 amarillo,
                // &#129001; 🟩 VERDE. La columna de rojas llevaba 129001, o
                // sea un cuadrado VERDE (reportado en la captura 8567).
                '<th title="Tarjetas amarillas">&#129000; Amarillas</th>' +
                '<th title="Tarjetas rojas">&#128997; Rojas</th>' +
                '<th title="Partidos con lesión">Lesiones</th>' +
            '</tr></thead>' +
            '<tbody>' + cuerpo + cuerpoInv + '</tbody>' +
            '<tfoot><tr class="ct-stats-total">' +
                '<td class="ct-stats-name">Total equipo</td>' +
                '<td title="Partidos disputados por el equipo">' + totPj + '</td>' +
                // ⚠️ PT NO SE SUMA EN EL TOTAL, por la misma razón que PJ: la
                // suma de titularidades de toda la plantilla es el número de
                // alineaciones (11 por partido), no una magnitud del equipo, y
                // leída bajo "PT" sólo confunde. Ya se pagó ese error con PJ.
                '<td title="No se suma: son las titularidades de cada jugador">-</td>' +
                '<td title="No se suman: los minutos son de cada jugador">-</td>' +
                '<td>' + tot.goals + '</td>' +
                '<td>' + tot.yellow + '</td>' +
                '<td>' + tot.red + '</td>' +
                '<td>' + tot.injuries + '</td>' +
            '</tr></tfoot>' +
        '</table></div>';
    };
})();
