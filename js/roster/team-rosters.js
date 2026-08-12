// ════════════════════════════════════════════════════════════════════
//  FICHAS DE EQUIPO PUBLICADAS (sin datos personales) — 2026-08-12
// ════════════════════════════════════════════════════════════════════
//  Sostiene las PLAZAS DE APOYO: un entrenador puede convocar puntualmente
//  a un jugador de otra categoría o del filial, y para elegirlo necesita ver
//  la lista de ese otro equipo.
//
//  ⚠️⚠️ POR QUÉ EXISTE ESTE MÓDULO Y NO SE LEE LA PLANTILLA DIRECTAMENTE.
//  La plantilla vive en users/{uid}/cronos_data/main, cuya regla es
//  `request.auth.uid == userId` — sólo el dueño. Y ese mismo documento
//  guarda `cronos_email_config`: los CORREOS Y TELÉFONOS DE TODOS LOS PADRES
//  del equipo. Abrir esa regla a los entrenadores del club para que vieran
//  los dorsales habría publicado de paso el directorio de contactos entero.
//
//  Por eso al guardar la plantilla se publica APARTE una copia recortada en
//  clubs/{clubId}/team_rosters/{teamId} con cuatro campos por jugador:
//  ficha, dorsal, nombre y alias. Nada más sale de la plantilla.
//
//  🔑 EL teamId ES cronosTeamId(), NO UN ID NUEVO. Es una función pura de
//  (club, categoría, subcategoría), así que la ficha publicada casa sola con
//  los informes ya escritos sin migrar nada. Inventar aquí un id aleatorio
//  habría partido el equipo en dos a la primera.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var FS_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

    // Rol de entrenador del usuario, ya normalizado. Devuelve
    // { clubId, category, subcategory } o null si no lo es.
    function _miEquipo() {
        var me = window._cronosCurrentUser;
        if (!me) return null;
        var clubId = me.clubId || '';
        var cat = '', sub = '';

        // El rol activo manda; si no hay, se busca el de entrenador en allRoles
        // y por último la raíz (usuario mono-rol), que es la misma cascada que
        // usa ctBuildCoachIndex.
        var rd = me._activeRoleData;
        if (rd && (rd.role === 'user' || rd.role === 'coach')) {
            cat = rd.category || rd.categoryLabel || '';
            sub = rd.subcategory || '';
            clubId = rd.clubId || clubId;
        }
        if (!cat && Array.isArray(me.allRoles)) {
            for (var i = 0; i < me.allRoles.length; i++) {
                var r = me.allRoles[i];
                if (r && (r.role === 'user' || r.role === 'coach') && (r.category || r.categoryLabel)) {
                    cat = r.category || r.categoryLabel;
                    sub = r.subcategory || '';
                    clubId = r.clubId || clubId;
                    break;
                }
            }
        }
        if (!cat) { cat = me.category || me.categoryLabel || ''; sub = sub || me.subcategory || ''; }
        if (!clubId || !cat) return null;
        return { clubId: clubId, category: cat, subcategory: sub || '' };
    }

    // Etiqueta legible del equipo ("Cadete A"), la que ve el entrenador que
    // busca. Sale de CT_CATEGORIES para no inventar un octavo mapa de nombres.
    function _etiqueta(category, subcategory) {
        var id = (typeof window.ctNormCat === 'function')
            ? window.ctNormCat(category) : String(category || '').toLowerCase();
        var def = (window.CT_CATEGORIES || []).filter(function (c) { return c.id === id; })[0];
        var base = def ? def.label : String(category || '').trim();
        return (base + ' ' + String(subcategory || '').toUpperCase()).trim();
    }

    // ⚠️ LA LISTA BLANCA DE CAMPOS ES EL CORAZÓN DE LA PRIVACIDAD DE ESTO.
    // Se construye jugador a jugador con cuatro campos EXPLÍCITOS en vez de
    // copiar el objeto y borrar lo que sobra: con un spread, el día que la
    // plantilla gane un campo nuevo (un teléfono, una fecha de nacimiento) se
    // publicaría solo y sin que nadie se entere. Aquí, un campo nuevo NO sale
    // salvo que alguien lo añada a mano en esta función.
    function _recortar(players) {
        return (players || []).map(function (p) {
            if (!p) return null;
            var alias = String(p.alias || '').trim();
            var name  = String(p.name || '').trim();
            if (!alias && !name) return null;      // fila vacía: no se publica
            return {
                ficha:  String(p.id || '').trim(),
                dorsal: String(p.number == null ? '' : p.number).trim(),
                nombre: name,
                alias:  alias || name.split(' ')[0]
            };
        }).filter(Boolean);
    }

    // ── Publicar la plantilla propia ────────────────────────────────────
    // No lanza nunca: se llama desde saveMasterRoster, y un fallo aquí NO
    // puede impedir que el entrenador guarde su plantilla. Si falla, el
    // selector de otro entrenador simplemente no verá este equipo.
    window.cronosPublishTeamRoster = async function (mode, players) {
        try {
            var eq = _miEquipo();
            var fa = window._cronos_auth;
            var uid = window._cronosCurrentUser && window._cronosCurrentUser.uid;
            if (!eq || !fa || !uid) return false;
            if (typeof window.cronosTeamId !== 'function') return false;

            var teamId = window.cronosTeamId(eq.clubId, eq.category, eq.subcategory);
            if (!teamId) return false;

            var lista = _recortar(players);
            var mod = await import(FS_URL);

            // El documento es POR EQUIPO y guarda las dos modalidades por
            // separado: el mismo equipo puede tener plantilla de F7 y de F11
            // (lo permite openRosterManager) y son plantillas distintas.
            var payload = {
                clubId:      eq.clubId,
                coachUid:    uid,
                teamId:      teamId,
                category:    eq.category,
                subcategory: eq.subcategory,
                teamLabel:   _etiqueta(eq.category, eq.subcategory),
                updatedAt:   Date.now()
            };
            payload['players_' + (mode === 'f7' ? 'f7' : 'f11')] = lista;

            // Sin await sobre el ACK, igual que cloudSet: sin cobertura la
            // promesa no resuelve NUNCA y colgaría al que guarda la plantilla.
            mod.setDoc(
                mod.doc(fa.db, 'clubs', eq.clubId, 'team_rosters', teamId),
                payload,
                { merge: true }
            ).catch(function (err) {
                console.warn('[team-rosters] no se pudo publicar la ficha del equipo:',
                             err && err.message ? err.message : err);
            });
            return true;
        } catch (e) {
            console.warn('[team-rosters] publicación omitida:', e && e.message ? e.message : e);
            return false;
        }
    };

    // ════════════════════════════════════════════════════════════════
    //  ESCALAFÓN DEL CLUB (2026-08-12) — sólo se convoca HACIA ABAJO
    //
    //  Requisito del autor: desde Juvenil B se puede tirar de Juvenil C,
    //  Cadete, Infantil, Alevín, Benjamín y Prebenjamín. Nunca hacia arriba
    //  ni hacia el lado (Juvenil B NO puede llevarse al Juvenil A).
    //
    //  ⚠️⚠️ ESTE ORDEN **NO** ES EL DE CT_CATEGORIES. Aquel es el orden de
    //  PINTADO de los árboles, y ahí las dos categorías FEM van al final por
    //  decisión del autor: usarlo como jerarquía dejaría a FUTureFEM por
    //  encima de Regional, que es exactamente al revés.
    //
    //  🔑 EL RANGO DE LAS DOS FEM SALE DE SU MODALIDAD Y DURACIÓN, que las
    //  fijó el autor el 2026-08-12: FUTureFEM es F7 a 2T x 35' —la misma
    //  horquilla que Alevín— y Regional FEM es F11 a 2T x 45', la de Regional.
    //  No es una suposición: es el único dato objetivo que hay sobre ellas.
    //
    //  ⚠️ En la práctica casi nunca se cruzan, porque cronosFetchClubRosters
    //  ya filtra por MODALIDAD antes que por rango: un juvenil creando un
    //  partido de F11 no ve equipos que sólo tienen plantilla de F7.
    // ════════════════════════════════════════════════════════════════
    var CT_RANGO = {
        prebenjamin: 1,
        benjamin:    2,
        alevin:      3,
        futurefem:   3,   // F7, 2T x 35' — misma horquilla que Alevín
        infantil:    4,
        cadete:      5,
        juvenil:     6,
        regional:      7,
        regional_fem:  7  // F11, 2T x 45' — mismo nivel que Regional
    };
    window.cronosCategoryRank = function (categoria) {
        var id = (typeof window.ctNormCat === 'function')
            ? window.ctNormCat(categoria) : String(categoria || '').toLowerCase();
        return CT_RANGO[id] || 0;   // 0 = desconocida
    };

    // ¿Puede el equipo (miCat/miSub) llevarse a alguien de (suCat/suSub)?
    //
    // 🔑 DENTRO DE LA MISMA CATEGORÍA MANDA LA SUBCATEGORÍA: Juvenil B sí
    // puede tirar del Juvenil C, pero NO del Juvenil A ni de otro Juvenil B.
    //
    // ⚠️ ANTE UNA CATEGORÍA DESCONOCIDA NO SE ESCONDE NADA. Un club puede
    // tener categorías propias fuera del escalafón; filtrarlas dejaría al
    // entrenador con un selector vacío y sin explicación. Se prefiere mostrar
    // de más —él sabe a quién puede convocar— que ocultar en silencio.
    window.cronosPuedeConvocarDe = function (miCat, miSub, suCat, suSub) {
        var mio = window.cronosCategoryRank(miCat);
        var suyo = window.cronosCategoryRank(suCat);
        if (!mio || !suyo) return true;             // desconocida: no se filtra
        if (suyo < mio) return true;                // categoría inferior: sí
        if (suyo > mio) return false;               // superior: nunca
        // Mismo escalón: sólo subcategorías POSTERIORES (A < B < C).
        var subs = window.CT_SUBCATS || ['A', 'B', 'C'];
        var a = subs.indexOf(String(miSub || '').trim().toUpperCase());
        var b = subs.indexOf(String(suSub || '').trim().toUpperCase());
        if (a === -1 || b === -1) return false;     // mismo nivel sin orden claro
        return b > a;
    };

    // Junta las plantillas F7 y F11 de un equipo en una sola lista, sin
    // repetidos. `preferida` es la modalidad del partido que se está creando:
    // sus jugadores van primero y son los que ganan si el mismo chaval está en
    // las dos (su dorsal en esa modalidad es el que va a llevar).
    //
    // 🔑 LA CLAVE DE DEDUPLICACIÓN ES LA FICHA. Si faltara —plantillas viejas
    // publicadas sin id—, se cae a dorsal+alias en minúsculas; nunca al alias
    // solo, que dos hermanos pueden compartir.
    function _fundirModalidades(v, preferida) {
        var otra = (preferida === 'f7') ? 'f11' : 'f7';
        var out = [];
        var vistos = Object.create(null);
        [preferida, otra].forEach(function (m) {
            var arr = Array.isArray(v['players_' + m]) ? v['players_' + m] : [];
            arr.forEach(function (p) {
                if (!p) return;
                var ficha = String(p.ficha || '').trim();
                var clave = ficha
                    ? ('f:' + ficha)
                    : ('d:' + String(p.dorsal || '') + '|' + String(p.alias || p.nombre || '').toLowerCase());
                if (clave === 'd:|') return;
                if (vistos[clave]) return;
                vistos[clave] = true;
                // Se anota de qué plantilla sale para poder avisarlo en el
                // selector: convocar a un alevín a un partido de F11 es
                // legítimo, pero el entrenador tiene que verlo.
                out.push({ ficha: p.ficha, dorsal: p.dorsal, nombre: p.nombre,
                           alias: p.alias, modalidad: m });
            });
        });
        return out;
    }

    // ── Leer las fichas de los DEMÁS equipos del club ───────────────────
    // Devuelve [{ teamId, category, subcategory, teamLabel, players:[...] }]
    // ya ordenado por el orden de CT_CATEGORIES (el mismo que ven en todos
    // los árboles) y SIN el equipo propio, que no tiene sentido ofrecer.
    window.cronosFetchClubRosters = async function (mode) {
        var out = [];
        try {
            var eq = _miEquipo();
            var fa = window._cronos_auth;
            if (!eq || !fa) return out;

            var mod = await import(FS_URL);
            var snap = await mod.getDocs(
                mod.collection(fa.db, 'clubs', eq.clubId, 'team_rosters'));

            var propio = (typeof window.cronosTeamId === 'function')
                ? window.cronosTeamId(eq.clubId, eq.category, eq.subcategory) : '';
            var preferida = (mode === 'f7') ? 'f7' : 'f11';

            snap.forEach(function (d) {
                var v = d.data() || {};
                if (d.id === propio) return;                  // el mío no

                // ⚠️⚠️ LA MODALIDAD **NO** FILTRA (corregido el 2026-08-12 a
                // petición del autor). La versión anterior sólo miraba
                // `players_<modalidad del partido>`, y con eso un Juvenil B
                // (F11) no veía al Alevín C (que sólo tiene plantilla F7) —
                // exactamente el caso que él reportó. En la práctica los
                // jugadores suben de categoría aunque el formato de base sea
                // distinto: un alevín puede reforzar a un juvenil.
                //
                // 🔑 Se juntan las DOS listas y se DEDUPLICA POR FICHA: un
                // entrenador que lleva F7 y F11 tiene al mismo chaval en las
                // dos, y sin deduplicar saldría dos veces en el selector y
                // podría acabar convocado por duplicado. Manda la modalidad
                // del partido que se está creando, que es la que trae el
                // dorsal más probable.
                var lista = _fundirModalidades(v, preferida);
                if (!lista.length) return;
                // Sólo HACIA ABAJO en el escalafón del club.
                if (!window.cronosPuedeConvocarDe(eq.category, eq.subcategory,
                                                  v.category, v.subcategory)) return;
                out.push({
                    teamId:      d.id,
                    category:    v.category || '',
                    subcategory: v.subcategory || '',
                    teamLabel:   v.teamLabel || _etiqueta(v.category, v.subcategory),
                    players:     lista
                });
            });

            var orden = (window.CT_CATEGORIES || []).map(function (c) { return c.id; });
            out.sort(function (a, b) {
                var ia = orden.indexOf((typeof window.ctNormCat === 'function')
                            ? window.ctNormCat(a.category) : a.category);
                var ib = orden.indexOf((typeof window.ctNormCat === 'function')
                            ? window.ctNormCat(b.category) : b.category);
                if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
                return String(a.subcategory).localeCompare(String(b.subcategory));
            });
        } catch (e) {
            var msg = (e && e.message) ? e.message : String(e);
            console.warn('[team-rosters] no se pudieron leer las fichas del club:', msg);
            // Se PUBLICA el motivo para que el selector pueda enseñarlo en vez
            // de decir "no hay equipos": un permiso denegado y una lista vacía
            // son la misma pantalla y cuestan una ronda de diagnóstico.
            window._cronosRosterFetchError = msg;
        }
        return out;
    };

    // ── Todas las plantillas del club, indexadas por rama del árbol ─────
    // Para el Panel de Dirección: la tabla acumulada tiene que listar la
    // plantilla ENTERA, incluidos los que aún no han jugado.
    //
    // Devuelve un objeto plano { 'catId|subId': [ {ficha,dorsal,nombre,alias} ] }
    // con las DOS modalidades fundidas — un equipo puede tener plantilla de F7
    // y de F11 y las dos son "su plantilla" a efectos de listado.
    //
    // ⚠️ NO FILTRA POR JERARQUÍA NI EXCLUYE EL EQUIPO PROPIO: eso es cosa del
    // selector de invitados. Aquí se quiere el club entero.
    //
    // No lanza: si falla, devuelve {} y las tablas se pintan como antes.
    window.cronosFetchAllTeamRosters = async function (clubId) {
        var out = {};
        try {
            var fa = window._cronos_auth;
            var cid = clubId || (window._cronosCurrentUser && window._cronosCurrentUser.clubId);
            if (!fa || !cid) return out;

            var mod = await import(FS_URL);
            var snap = await mod.getDocs(mod.collection(fa.db, 'clubs', cid, 'team_rosters'));

            snap.forEach(function (d) {
                var v = d.data() || {};
                var cat = (typeof window.ctNormCat === 'function')
                    ? window.ctNormCat(v.category || '') : String(v.category || '');
                var sub = (typeof window.ctNormSubcat === 'function')
                    ? window.ctNormSubcat(v.subcategory || '') : String(v.subcategory || '');
                if (!cat || !sub) return;
                var lista = _fundirModalidades(v, 'f11');
                if (!lista.length) return;
                out[cat + '|' + sub] = lista;
            });
        } catch (e) {
            console.warn('[team-rosters] no se pudieron leer las plantillas del club:',
                         e && e.message ? e.message : e);
        }
        return out;
    };

    // ── Campos de origen para el payload de un informe ──────────────────
    // Devuelve {} para un jugador de la casa, y así el documento sale
    // EXACTAMENTE igual que antes de existir las plazas de apoyo: ni un campo
    // nuevo en los informes normales.
    //
    // ⚠️ NUNCA devuelve undefined dentro del objeto. Un `undefined` en un
    // payload de Firestore LANZA y tumbaría la escritura del informe entero
    // (ya pasó en v431/v433). Por eso cada campo cae a cadena vacía.
    window.cronosGuestFields = function (p) {
        if (!p || p.isGuest !== true) return {};
        return {
            isGuest:           true,
            originTeamId:      p.originTeamId || '',
            originCategory:    p.originCategory || '',
            originSubcategory: p.originSubcategory || '',
            originPlayerId:    p.originPlayerId || ''
        };
    };

    // Se exporta para los guards y para el selector.
    window._cronosTeamRosterTrim = _recortar;
    window._cronosTeamRosterLabel = _etiqueta;
})();
