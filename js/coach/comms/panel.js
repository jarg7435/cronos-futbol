// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — Sistema de Comunicación Entrenador ↔ Padres v1.0
//  Colecciones Firestore:
//    cronos_player_links/{clubId}_{playerNumber} → vincula padre con jugador
//    cronos_messages/{coachUid}_{parentUid}      → hilo de mensajes
//    cronos_player_reports/{reportId}            → informes post-partido
// ════════════════════════════════════════════════════════════════════

// ── Función auxiliar para cargar módulo Firestore ─────────────────────
async function _cFS() {
    const module = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...module, db: window._cronos_auth?.db };
}

// ── Helper: equipo del entrenador según su rol (home/away) ────────────
// FIX: cuando el entrenador dirige de visitante (_userTeamRole==='away'),
// SU convocatoria se etiqueta team:'away'. Filtrar rígido 'home' dejaba
// homePlayers vacío → ningún informe (staffReport) llegaba al staff.
function _cMyTeamKey() {
    return (typeof window !== 'undefined' && window._userTeamRole === 'away') ? 'away' : 'home';
}
if (typeof window !== 'undefined') window._cMyTeamKey = _cMyTeamKey;

// ════════════════════════════════════════════════════════════════════
//  HELPER: Convertir historial de player a formato estándar para Firestore
//  La app guarda history como strings: "Entra a las 03:52 (1ªP) #C1"
//  El Gantt necesita objetos: {type:'sub_in', minute:3}
//  Esta función convierte ambos formatos al formato objeto estándar
// ════════════════════════════════════════════════════════════════════
// v445 · La hora real del reloj que logEvent/logMovement anexan al final del
// apunte con '@' ("… (1ªP) #123 @20:10:35"). Es lo que el Informe Colectivo
// necesita para poder decir a qué hora pasó cada incidencia.
// ⚠️ Se busca ANCLADA al '@'. Sin ese ancla se cogería el minuto de partido,
// que va antes en la misma cadena.
function _horaRealDeNota(nota) {
    const m = String(nota || '').match(/@\s*(\d{1,2}:\d{2}(?::\d{2})?)/);
    return m ? m[1] : '';
}
if (typeof window !== 'undefined') window._horaRealDeNota = _horaRealDeNota;

function _parseHistoryForFirestore(raw) {
    if (!Array.isArray(raw)) return [];
    const result = [];
    // E5 (punto C): saneo defensivo para informes ya guardados antes del guard de
    // idempotencia. Las cadenas "Sale (DESCANSO)" / "Entra (2ªP)" / "Sale (FIN)"
    // podían quedar duplicadas y consecutivas en history; si el evento entrante
    // coincide con el último insertado (mismo type + mismo timeStr) se omite, de
    // modo que cada entrada/salida aparece una sola vez en la línea de tiempo.
    // No afecta a goles/tarjetas/lesiones ni a entradas/salidas en minutos distintos.
    const pushEvent = (ev) => {
        const last = result[result.length - 1];
        if (last && last.type === ev.type && (last.timeStr || '') === (ev.timeStr || '')) return; // duplicado consecutivo → omitir
        result.push(ev);
    };
    raw.forEach(e => {
        if (typeof e === 'object' && e !== null && e.type) {
            // Ya es objeto — solo limpiar (preservando subId si el doc ya lo trae).
            // v426: `phase` tiene que sobrevivir a un re-parseo. Si el objeto no
            // lo trae (informe guardado antes de v426) se re-deduce del `note`,
            // que es donde quedó el texto original.
            const _fase = (e.phase === true) || /\((?:DESCANSO|FIN)\)/i.test(String(e.note || ''));
            // v445 · `realTime` (hora del reloj de pared) tiene que sobrevivir a
            // un re-parseo igual que `phase`. Si el objeto no la trae, se
            // re-deduce del `note`, que es donde quedó la cadena original.
            const _real = e.realTime || _horaRealDeNota(e.note);
            // v531 · `retro` tiene que sobrevivir a un re-parseo igual que
            // `phase` y `realTime`: si el objeto no lo trae (informe guardado
            // antes de v531) se re-deduce del `note`, que conserva la cadena.
            const _retro = (e.retro === true) || /\(RETRO\)/i.test(String(e.note || ''));
            pushEvent({ type: e.type, minute: e.minute || 0, second: e.second || 0, timeStr: e.timeStr || '', subId: e.subId || null, note: e.note || '', phase: _fase, realTime: _real, retro: _retro });
            return;
        }
        if (typeof e !== 'string') return;
        // Parsear string "Entra a las 03:52 (1ªP) #C1"
        const tMatch = e.match(/(\d{1,2}):(\d{2})/);
        const minute = tMatch ? parseInt(tMatch[1]) : 0;
        const second = tMatch ? parseInt(tMatch[2]) : 0;
        const timeStr = tMatch ? tMatch[0] : '00:00';
        // subId: id numerico de sustitucion (Date.now()) compartido por la pareja
        // entra/sale, anexado al string como "#<digitos>" (app-init.js:4494, drag-drop.js:255).
        // Es la unica forma fiable de emparejar entradas/salidas simultaneas en el
        // mismo minuto. Strings sin #<digitos> (DESCANSO/2ªP/FIN, o cambios grupales
        // 'C1'/'C2') -> subId null -> el emparejado cae al fallback por proximidad temporal.
        const subMatch = e.match(/#(\d+)/);
        const subId = subMatch ? subMatch[1] : null;
        const low = e.toLowerCase();
        let type = '';
        if (low.startsWith('entra'))                              type = 'sub_in';
        else if (low.startsWith('sale'))                          type = 'sub_out';
        else if (low.includes('gol'))                             type = 'goal';
        else if (low.includes('amarilla'))                        type = 'yellow';
        else if (low.includes('roja'))                            type = 'red';
        else if (low.includes('lesión') || low.includes('lesion')) type = 'injury';
        // 🔑 v426 — APUNTES DE FASE, NO SUSTITUCIONES.
        // Al cerrar la 1ª parte la app apunta "Sale a las MM:SS (DESCANSO)" a
        // TODOS los que están en el campo, y al terminar un "Sale (FIN)". Son
        // contabilidad interna de fase, no cambios: el reglamento no gasta una
        // sustitución por pasar por el descanso. Se marcan con un campo propio
        // para que los informes puedan descartarlos sin releer el texto.
        //
        // ⚠️ SÓLO SE MARCAN LAS INEQUÍVOCAS. El "Entra a las MM:SS (2ªP)" que
        // apunta startSecondHalf NO se puede distinguir aquí de un cambio real
        // de la segunda parte sin subId: logMovement escribe exactamente la
        // misma forma. Esa ambigüedad la resuelve report-engine por PAREJA (la
        // automática comparte sello de tiempo con el "Sale (DESCANSO)" del mismo
        // jugador). Marcarla aquí a ciegas se comería sustituciones de verdad.
        //
        // Ojo: (DESC) ≠ (DESCANSO). La primera es un cambio hecho DURANTE el
        // descanso y es real; la segunda es el apunte automático.
        const esFase = /\((?:DESCANSO|FIN)\)/i.test(e);
        // v531 · Marca de EVENTO PERDIDO (registrado a posteriori por pérdida de
        // batería o cobertura). Mismo patrón que `(DESCANSO)` y que el `#subId`:
        // el texto lo lleva, pero fuera de aquí se usa el campo estructurado.
        const esRetro = /\(RETRO\)/i.test(e);
        if (type) pushEvent({ type, minute, second, timeStr, subId, note: e, phase: esFase,
                              realTime: _horaRealDeNota(e), retro: esRetro });
    });
    return result;
}

// ════════════════════════════════════════════════════════════════════
//  HELPER COMPARTIDO (v171): resolver destinatarios de informe individual
//  de padre, de forma ESTRICTA. Usado por AMBAS rutas de envío
//  (autoDispatchMatchReports y _executeReportsSend) para que la lógica
//  sea idéntica.
//
//  REGLA 3 (padres, individual y estricto):
//   - Solo contactos de tipo 'parent' con el checkbox INF activado (tag 'rpt').
//   - Se obtiene su inviteCode (formato 'J10') del link de Firestore o del
//     playerId del contacto, y se extrae el dorsal (10).
//   - Se empareja SOLO por dorsal contra los jugadores convocados
//     (homePlayers). NUNCA por nombre.
//   - Solo se envía si el padre está registrado en la app con un parentUid
//     válido (resuelto vía cronos_player_links). Sin parentUid → se omite.
//   - Si el hijo de ese padre no fue convocado → no se envía nada.
//   - Como máximo 1 informe por padre (dedup por parentUid).
//
//  Devuelve: Array<{ parentUid, dorsal, player }>.
//  Función pura (sin I/O) para poder testearla en aislamiento.
// ════════════════════════════════════════════════════════════════════
function _cronosExtractDorsal(inviteCode) {
    if (!inviteCode) return null;
    const m = String(inviteCode).match(/^J-?(\d+)$/i);
    return m ? m[1] : null;
}

function _cronosResolveParentReportTargets(contacts, links, homePlayers, authorizedIds) {
    const out = [];
    const seenParentUid = new Set(); // 1 informe por padre
    const _normEmail = (e) => (typeof window._cronosNormEmail === 'function')
        ? window._cronosNormEmail(e)
        : String(e || '').trim().toLowerCase();

    // Diagnóstico opcional: activar con window._cronosDiagReports = true en consola.
    const _diag = (typeof window !== 'undefined' && window._cronosDiagReports);
    const _skip = (c, motivo, extra) => {
        if (_diag) console.log('[DiagReports][padre OMITIDO]', motivo, {
            id: c && c.id, name: c && c.name, uid: c && c.uid,
            email: c && c.email, playerId: c && c.playerId, tags: c && c.tags, ...extra
        });
    };
    if (_diag) console.log('[DiagReports] Entrada:', {
        contactos: (contacts || []).length,
        parents: (contacts || []).filter(c => c && c.type === 'parent').length,
        parentsConRpt: (contacts || []).filter(c => c && c.type === 'parent' && (c.tags||[]).includes('rpt')).length,
        links: (links || []).length,
        convocados: (homePlayers || []).map(p => p && p.number),
        authorizedIds: Array.isArray(authorizedIds) ? authorizedIds.length : 'null (usa tag rpt global)'
    });

    // FIX (v217): authorizedIds = pre-seleccion por partido guardada en
    // localStorage.cronos_match_rpt_selection (checkbox del modal "enviar
    // informe individual a este padre" antes del partido).
    // Cuando se pasa un array no vacio, SOLO se envia informe a los contactos
    // cuyo id este en esa lista, IGNORANDO incluso el tag 'rpt' global.
    // Cuando es null/undefined/array vacio (no se uso el modal), se mantiene
    // el comportamiento legacy (tag 'rpt' global en el contacto).
    // Esto hace que el checkbox del modal sea ESTRICTAMENTE respetado:
    //   - padre con tag 'rpt' ON pero SIN check en el partido  -> NO se envia
    //   - padre con tag 'rpt' OFF pero CON check en el partido -> SI se envia
    const _authorizedSet = (Array.isArray(authorizedIds) && authorizedIds.length > 0)
        ? new Set(authorizedIds.map(String))
        : null;

    for (const c of (contacts || [])) {
        if (!c || c.type !== 'parent') continue;

        // REGLA 3 (estricta v217): el envio depende PRIMERO del checkbox del
        // partido (pre-seleccion). Si hay pre-seleccion, SOLO se respeta esa.
        // Si no hay pre-seleccion (null), se respeta el tag 'rpt' global.
        if (_authorizedSet) {
            const cid = String(c.id || '');
            if (!cid || !_authorizedSet.has(cid)) {
                _skip(c, 'no seleccionado en el partido (pre-seleccion per-match)');
                continue;
            }
        } else {
            // Sin pre-seleccion por partido -> comportamiento legacy (tag 'rpt' global).
            if (!((c.tags || []).includes('rpt'))) { _skip(c, 'sin checkbox INF (tag rpt)'); continue; }
        }

        // Resolver el link de Firestore de este contacto para obtener
        // inviteCode + parentUid REAL (registrado en la app).
        // FIX Bug 2: para contactos manuales con playerId 'J10' que no tienen uid,
        // el emparejado por inviteCode/dorsal debe ser ROBUSTO (normalizar ambos
        // lados con _cronosExtractDorsal) para recuperar el parentUid del link,
        // tolerando variaciones como 'J-10', espacios o mayúsculas.
        const _cDorsal = _cronosExtractDorsal(c.playerId);
        const link = (links || []).find(l => {
            if (!l) return false;
            if (c.uid && (l.parentUid === c.uid || l.uid === c.uid)) return true;
            if (c.id && (l._id === c.id || l.id === c.id)) return true;
            if (c.playerId && (l.inviteCode === c.playerId || ('J' + l.playerNumber) === c.playerId)) return true;
            // Emparejado robusto por dorsal: inviteCode del link (J10) o playerNumber (10).
            if (_cDorsal && (
                _cronosExtractDorsal(l.inviteCode) === _cDorsal ||
                String(l.playerNumber) === _cDorsal
            )) return true;
            if (c.email && l.parentEmail && _normEmail(l.parentEmail) === _normEmail(c.email)) return true;
            return false;
        }) || null;

        // inviteCode: del link, o del playerId del contacto si tiene formato J<num>.
        const inviteCode = (link && link.inviteCode)
            || (c.playerId && /^J-?\d+$/i.test(c.playerId) ? c.playerId : null);
        const dorsal = _cronosExtractDorsal(inviteCode);
        if (!dorsal) { _skip(c, 'sin inviteCode/dorsal valido', { linkEncontrado: !!link, inviteCode }); continue; }

        // Emparejar SOLO por dorsal contra la convocatoria.
        const player = (homePlayers || []).find(p => p && String(p.number) === String(dorsal));
        if (!player) { _skip(c, 'hijo NO convocado', { dorsal }); continue; }

        // parentUid REAL (registrado en la app). Sin parentUid → omitir.
        const parentUid = (link && link.parentUid) || (c.uid || null);
        if (!parentUid) { _skip(c, 'sin parentUid registrado', { dorsal, linkEncontrado: !!link }); continue; }
        if (seenParentUid.has(parentUid)) { _skip(c, 'duplicado (ya tiene informe)', { parentUid }); continue; }
        seenParentUid.add(parentUid);

        out.push({ parentUid, dorsal: String(dorsal), player, contact: c });
    }
    return out;
}
// Exponer en window para reutilización entre módulos y tests.
if (typeof window !== 'undefined') {
    window._cronosResolveParentReportTargets = _cronosResolveParentReportTargets;
    window._cronosExtractDorsal = _cronosExtractDorsal;
}

// ════════════════════════════════════════════════════════════════════
//  HELPER (Bug 1 / v174): resolver el clubId del usuario actual.
//  Si me.clubId ya existe lo devuelve; si no (el custom claim aún no se
//  propagó al token), lo lee de users/{uid} en Firestore — el mismo patrón
//  que parent/panel.js y app-init.js. Sin un clubId válido las reglas de
//  cronos_messages / cronos_notifications / cronos_player_reports rechazan
//  el envío al staff y a los padres (sameClubAsDoc(null) falla).
//  Cachea el resultado en window._cronosCurrentUser.clubId para esta sesión.
//  fns: { doc, getDoc }.
// ════════════════════════════════════════════════════════════════════
async function _cResolveClubId(db, me, fns) {
    if (me && me.clubId) return me.clubId;
    if (!me || !me.uid || !fns || !fns.doc || !fns.getDoc) return null;
    try {
        const snap = await fns.getDoc(fns.doc(db, 'users', me.uid));
        if (snap && snap.exists()) {
            const d = snap.data() || {};
            const cid = d.clubId
                || (Array.isArray(d.allRoles) ? (d.allRoles.find(r => r && r.clubId) || {}).clubId : null)
                || null;
            // Cachear en el usuario en memoria para futuras llamadas de la sesión.
            if (cid && window._cronosCurrentUser) window._cronosCurrentUser.clubId = cid;
            // FIX v176 → FIX SEC-C1 (auditoría 2026-07-22): si se resolvió clubId
            // desde allRoles pero el campo raíz clubId del documento users/{uid}
            // está vacío, migrarlo para que las reglas Firestore (userDocClubId)
            // puedan verificarlo sin necesidad de parsear allRoles (las reglas NO
            // pueden iterar arrays arbitrarios). Antes se escribía con un update
            // directo desde el cliente — firestore.rules ya prohíbe que el
            // cliente escriba 'clubId' en users/{uid} (hasAny()), así que esa
            // escritura fallaba en silencio en cada sesión sin migrar nunca la
            // raíz. Ahora se delega en la Cloud Function syncRootClubId,
            // que valida server-side que el clubId pertenece de verdad al usuario
            // (vía allRoles) antes de escribirlo.
            if (cid && !d.clubId) {
                try {
                    const fa = window._cronos_auth;
                    if (fa && fa.functions) {
                        const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
                        await httpsCallable(fa.functions, 'syncRootClubId')({ clubId: cid });
                    }
                } catch (migrateErr) {
                    if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[Chronos] No se pudo migrar clubId al campo raíz:', migrateErr.message);
                }
            }
            return cid;
        }
    } catch (e) {
        if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[Chronos] No se pudo resolver clubId desde Firestore:', e && e.message);
    }
    return null;
}
if (typeof window !== 'undefined') window._cResolveClubId = _cResolveClubId;

// ════════════════════════════════════════════════════════════════════
//  HELPER (Bug staff / v175): threadId de los hilos coach↔staff.
//  ANTES: {coachUid}_{staffUid} -> el hilo "pertenecía" al coach; si un doc
//  viejo no tenía coachUid/participants, las reglas de cronos_messages
//  (read/update) rechazaban al coach (permission-denied) y el informe no
//  llegaba al director/coordinador.
//  AHORA: {clubId}_{staffUid} -> el hilo pertenece al CLUB; sameClub /
//  sameClubAsDoc / userDocClubId siempre pasan para miembros del club.
//  Si no hay clubId (admin individual) se mantiene el esquema legacy.
//  El staff sigue leyendo por query (where staffUid == uid), así que el
//  cambio de ID no afecta a su bandeja.
// ════════════════════════════════════════════════════════════════════
function _cStaffThreadId(clubId, coachUid, staffUid) {
    return clubId ? `${clubId}_${staffUid}` : `${coachUid}_${staffUid}`;
}
if (typeof window !== 'undefined') window._cStaffThreadId = _cStaffThreadId;
//
//  ESTRATEGIA (en orden de fiabilidad):
//  1. emailConfig.contacts guardado por el entrenador (FUENTE PRINCIPAL)
//     — ya tiene UIDs, emails y teléfonos confirmados por el coach
//  2. Consulta Firestore por role === 'director'/'coordinator' (fallback)
//  3. Consulta Firestore por allRoles array-contains para multi-rol (fallback)
//
//  Esto resuelve el caso donde arinagazone@gmail.com tiene múltiples roles
//  (director + coordinador + entrenador + padre) almacenados en allRoles[]
//  y el campo `role` de nivel raíz puede ser cualquier rol activo actual.
// ════════════════════════════════════════════════════════════════════
// ── Helper: derivar la subcategoría del partido (Opción A) ────────────
// Busca en me.allRoles la entrada de entrenador ('user'/'coach') cuya
// category coincida con la del partido ya calculada y devuelve su
// subcategory. Fallback '' (mismo estilo que category). No lanza.
function _cMatchSubcatFor(me, cat) {
    try {
        const roles = (me && Array.isArray(me.allRoles)) ? me.allRoles : [];
        const c = (cat || '').toString().trim().toLowerCase();
        const isCoach = r => r && (r.role === 'user' || r.role === 'coach');
        // 1) Coincidencia exacta de categoría entre roles de entrenador
        const hit = roles.find(r => isCoach(r) &&
            (r.category || '').toString().trim().toLowerCase() === c);
        if (hit && hit.subcategory) return hit.subcategory;
        return '';
    } catch (_) { return ''; }
}

async function _cGetStaff(db, clubId, fns, roles) {
    roles = roles || ['director', 'coordinator', 'club_admin', 'admin'];
    const byUid = new Map();

    const upsert = (uid, role, data) => {
        if (!byUid.has(uid)) byUid.set(uid, { uid, role, ...data });
    };

    const { collection, getDocs, query, where } = fns;
    if (clubId) {
        // 1. Buscar en Firestore por campo 'role' directo
        for (const role of roles) {
            try {
                const snap = await getDocs(query(
                    collection(db, 'users'),
                    where('clubId', '==', clubId),
                    where('role',   '==', role)
                ));
                snap.forEach(d => upsert(d.id, role, d.data()));
            } catch(e2) { console.warn('[_cGetStaff] Paso 1 falló para rol', role, ':', e2.code || e2.message); }
        }

        // 2. Buscar en Firestore por allRoles en cada documento de usuario del club
        try {
            const allSnap = await getDocs(query(
                collection(db, 'users'),
                where('clubId', '==', clubId)
            ));
            allSnap.forEach(d => {
                const data = d.data();
                if (Array.isArray(data.allRoles)) {
                    data.allRoles.forEach(r => {
                        if (roles.includes(r.role) &&
                            r.isAuthorized !== false &&
                            r.status !== 'rejected' &&
                            r.status !== 'removed') {
                            upsert(d.id, r.role, data);
                        }
                    });
                }
            });
        } catch(e3) { console.warn('[_cGetStaff] Paso 2 falló:', e3.code || e3.message); }
    }

    // ── 4. FIX (v178): Buscar SIN clubId usando el UID del coach actual ──
    // Si los pasos 2-3 fallaron (clubId vacío o incorrecto), buscar TODOS los
    // usuarios y filtrar en cliente por allRoles que contengan el mismo clubId
    // que el coach tiene en SU documento de usuario.
    if (!byUid.size) {
        console.warn('[_cGetStaff] Pasos 2-3 no encontraron staff. Intentando búsqueda amplia...');
        try {
            const me = window._cronosCurrentUser;
            if (me && me.uid) {
                // Obtener el clubId del coach directamente desde su documento
                const meSnap = await getDocs(query(
                    collection(db, 'users'),
                    where('__name__', '==', me.uid)  // Firestore no permite esto directamente
                )).catch(() => null);
                
                // Fallback: obtener el propio documento del coach
                try {
                    const { doc: docFn, getDoc } = fns.doc && fns.getDoc ? fns : await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
                    const myDoc = await getDoc(docFn(db, 'users', me.uid));
                    if (myDoc.exists()) {
                        const myData = myDoc.data();
                        const myClubId = myData.clubId || (myData.allRoles || []).find(r => r.clubId)?.clubId;
                        if (myClubId && myClubId !== clubId) {
                            // Reintentar con el clubId correcto
                            for (const role of roles) {
                                try {
                                    const snap2 = await getDocs(query(
                                        collection(db, 'users'),
                                        where('clubId', '==', myClubId),
                                        where('role', '==', role)
                                    ));
                                    snap2.forEach(d => upsert(d.id, role, d.data()));
                                } catch(_) {}
                            }
                            try {
                                const allSnap2 = await getDocs(query(
                                    collection(db, 'users'),
                                    where('clubId', '==', myClubId)
                                ));
                                allSnap2.forEach(d => {
                                    const data = d.data();
                                    (data.allRoles || []).forEach(r => {
                                        if (roles.includes(r.role) &&
                                            r.isAuthorized !== false &&
                                            r.status !== 'rejected' &&
                                            r.status !== 'removed') {
                                            upsert(d.id, r.role, data);
                                        }
                                    });
                                });
                            } catch(_) {}
                            // Actualizar me.clubId con el correcto
                            if (myClubId && !me.clubId) me.clubId = myClubId;
                        }
                    }
                } catch(e4) { console.warn('[_cGetStaff] Paso 4 falló:', e4.message); }
            }
        } catch(e4b) { console.warn('[_cGetStaff] Paso 4 (búsqueda amplia) falló:', e4b.message); }
    }

    const result = Array.from(byUid.values());
    return result;
}

// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — SISTEMA DE MENSAJERÍA UNIFICADO E INDEPENDIENTE POR ROL
// ════════════════════════════════════════════════════════════════════

// ── Helpers de normalización y filtrado ─────────────────────────────
function _normCat(raw) {
    if (raw == null) return '';
    let s = String(raw).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    s = s.replace(/^(f7_|f8_|f11_)/, '').replace(/_[abc]$/i, '').replace(/\s+[abc]$/i, '');
    // \ud83d\udd11 Categor\u00edas de dos palabras ('Regional FEM'). GEMELA DE window.ctNormCat
    // en js/admin/shared/category-tree.js: la parte 3a de
    // scripts/test_category_tree.js compara las dos sobre las mismas entradas,
    // as\u00ed que TODO cambio aqu\u00ed hay que hacerlo tambi\u00e9n all\u00ed.
    s = s.trim().replace(/[\s-]+/g, '_');
    if (s === 'future_fem' || s === 'futuro_fem') s = 'futurefem';
    return s;
}

function _normSubcat(raw) {
    if (raw == null) return '';
    let s = String(raw).trim().toUpperCase();
    const m = s.match(/([ABC])$/);
    return m ? m[1] : s;
}

function _catAndSubcatMatch(coachCat, coachSub, targetCat, targetSub) {
    const cc = _normCat(coachCat);
    const tc = _normCat(targetCat);
    if (cc && tc && cc !== tc) return false;
    const cs = _normSubcat(coachSub);
    const ts = _normSubcat(targetSub);
    if (cs && ts && cs !== ts) return false;
    return true;
}

function _getCategoryModality(cat) {
    if (typeof window._cronosMatchModality === 'function') {
        return window._cronosMatchModality(cat);
    }
    const c = _normCat(cat);
    if (['prebenjamin', 'benjamin', 'alevin', 'chupete', 'querubin'].includes(c)) return 'f7';
    if (['infantil', 'cadete', 'juvenil', 'regional', 'regional_fem', 'senior', 'amateur', 'futurefem'].includes(c)) return 'f11';
    return 'f7';
}

function _coordinatorCoversModality(coordType, coachCat) {
    const t = String(coordType || '').trim().toLowerCase();
    if (!t || t === 'f711' || t === 'both' || t === 'all' || t === 'ambas') return true;
    const mod = _getCategoryModality(coachCat);
    if (t === 'f7' || t === 'f8') return mod === 'f7';
    if (t === 'f11') return mod === 'f11';
    return true;
}

function _coordinatorCoversCoach(coordType, coachCat) {
    return _coordinatorCoversModality(coordType, coachCat);
}

// Map simétrico de contexto de hilos para que ambos roles compartan exactamente el mismo document ID
function _getCanonicalContext(role, tabId) {
    if (role === 'coach') {
        if (tabId === 'parents') return 'coach_parent';
        if (tabId === 'director') return 'coach_director';
        if (tabId === 'coordinator') return 'coach_coordinator';
    } else if (role === 'director') {
        if (tabId === 'coordinators') return 'director_coordinator';
        if (tabId === 'coaches') return 'coach_director';
        // Simétrico con la pestaña 'director' del Administrador de Club.
        if (tabId === 'clubadmin') return 'clubadmin_director';
    } else if (role === 'coordinator') {
        if (tabId === 'director') return 'director_coordinator';
        if (tabId === 'coaches') return 'coach_coordinator';
    } else if (role === 'parent') {
        if (tabId === 'coach') return 'coach_parent';
    } else if (role === 'club_admin') {
        // 🔑 Canal con el Director: contexto propio, simétrico con la pestaña
        // 'clubadmin' que el Director tiene al otro lado.
        if (tabId === 'director') return 'clubadmin_director';
    } else if (role === 'admin_individual') {
        // 🔑 DECISIÓN DEL AUTOR: el Administrador Individual habla con su
        // Entrenador por el contexto que el ENTRENADOR YA USA en su pestaña
        // "Director" (que lista también a club_admin/admin). Reutilizarlo es lo
        // que permite que el Entrenador responda sin tocar su panel; inventar
        // un canal nuevo habría obligado a añadirle una pestaña.
        if (tabId === 'coaches') return 'coach_director';
    }
    // El canal con el SuperAdmin es común a los dos tipos de administrador.
    if (tabId === 'superadmin') return 'sa';
    return `${role}_${tabId}`;
}

function _cThreadId(senderUid, recipientUid, tabContext) {
    if (!senderUid || !recipientUid) return '';
    const sorted = [senderUid, recipientUid].sort();
    // 🔑 DECISIÓN DEL AUTOR: el canal con el SuperAdmin respeta la convención de
    // SU bandeja (js/admin/superadmin/messaging.js), que construye los hilos
    // como `sa_<uidA>_<uidB>` y los localiza filtrando por
    // threadId.includes('sa_'). Sin esta excepción, los mensajes que inicia un
    // administrador crearían un documento aparte y NO aparecerían en su bandeja
    // — sin error visible por ningún lado.
    if (tabContext === 'sa') return `sa_${sorted[0]}_${sorted[1]}`;
    return `${sorted[0]}_${sorted[1]}_${tabContext || 'gen'}`;
}

// Búsqueda inteligente de hilos existentes (canónicos, legacy y por participantes)
async function _resolveThreadDoc(db, myUid, contactUid, role, tabId, clubId, contactEmail) {
    const canonicalCtx = _getCanonicalContext(role, tabId);
    const canonicalId = _cThreadId(myUid, contactUid, canonicalCtx);

    const candidates = [
        canonicalId,
        _cThreadId(myUid, contactUid, tabId),
        `${myUid}_${contactUid}`,
        `${contactUid}_${myUid}`
    ];

    if (clubId) {
        candidates.push(`${clubId}_coach_${myUid}_staff_${contactUid}_role_director`);
        candidates.push(`${clubId}_coach_${contactUid}_staff_${myUid}_role_director`);
        candidates.push(`${clubId}_coach_${myUid}_staff_${contactUid}_role_coordinator`);
        candidates.push(`${clubId}_coach_${contactUid}_staff_${myUid}_role_coordinator`);
        candidates.push(`${clubId}_coach_${myUid}_staff_${contactUid}`);
        candidates.push(`${clubId}_coach_${contactUid}_staff_${myUid}`);
    }

    const { doc, getDoc, collection, getDocs, query, where } = await _cFS();

    for (const id of candidates) {
        try {
            const snap = await getDoc(doc(db, 'cronos_messages', id));
            if (snap.exists()) {
                return { id, snap, data: snap.data() };
            }
        } catch(_) {}
    }

    // Consulta fallback si existen hilos guardados con participants array o emails
    try {
        const qSnap = await getDocs(query(
            collection(db, 'cronos_messages'),
            where('participants', 'array-contains', myUid)
        ));
        let found = null;
        const normC = contactEmail ? contactEmail.trim().toLowerCase() : '';
        qSnap.forEach(d => {
            const data = d.data();
            const parts = data.participants || [];
            if (parts.includes(contactUid) || data.coachUid === contactUid || data.staffUid === contactUid || data.parentUid === contactUid) {
                found = { id: d.id, snap: d, data };
            } else if (normC && (
                (data.parentEmail && data.parentEmail.trim().toLowerCase() === normC) ||
                (data.coachEmail && data.coachEmail.trim().toLowerCase() === normC) ||
                (data.staffEmail && data.staffEmail.trim().toLowerCase() === normC)
            )) {
                found = { id: d.id, snap: d, data };
            }
        });
        if (found) return found;
    } catch(_) {}

    return { id: canonicalId, snap: null, data: null };
}

// ════════════════════════════════════════════════════════════════════
//  v429 — ¿PUEDE ESTE PADRE ENVIAR MENSAJES?
// ════════════════════════════════════════════════════════════════════
//  Regla del autor: TODOS los padres RECIBEN siempre; ENVIAR lo autoriza el
//  entrenador padre por padre, con la casilla "ENVIAR ✍️" del gestor de
//  contactos.
//
//  🔑 DÓNDE VIVE EL PERMISO Y POR QUÉ. La lista de contactos del entrenador
//  se guarda en `users/{coachUid}/cronos_data/main` (cloudSet), un documento
//  que el padre NO puede leer. Así que la casilla no se guarda solo ahí: se
//  escribe como `canSendMsg` en `cronos_player_links/{linkId}`, que es el
//  ÚNICO documento del entrenador que las reglas dejan ver al padre
//  (`isLinkOwner()` en firestore.rules). Sin esa pieza, el cliente del padre
//  no tendría forma de saber si puede escribir.
//
//  ⚠️ FALLA HACIA EL "SÍ" a propósito, en los tres sitios:
//    · sin campo `canSendMsg` (todos los vínculos de hoy) → puede enviar;
//    · si la consulta falla → puede enviar;
//    · con varios hijos, basta que UN vínculo lo permita → puede enviar.
//  Es la decisión del autor: nadie pierde de golpe una capacidad que ya
//  tenía. El bloqueo es, además, solo de interfaz (decisión de v429): un
//  usuario técnico podría saltárselo desde la consola. Si algún día se
//  quiere blindar de verdad, hay que llevarlo a firestore.rules.
//
//  El caso de los varios hijos NO es exacto: el permiso debería ser por
//  entrenador/hilo, y aquí se resuelve para el padre entero. Con un hijo
//  —lo normal— coincide. Si aparece el caso real de dos hijos con dos
//  entrenadores de criterio distinto, hay que subir el permiso al hilo.
window._cronosParentSendCache = null;

window._cronosParentCanSendMsg = async function(force) {
    if (!force && window._cronosParentSendCache !== null) {
        return window._cronosParentSendCache;
    }
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    if (!me || !me.uid) return true;
    try {
        const { db, collection, getDocs, query, where } = await _cFS();
        if (!db) return true;
        const snap = await getDocs(query(
            collection(db, 'cronos_player_links'),
            where('parentUid', '==', me.uid)
        ));
        const links = [];
        snap.forEach(d => links.push(d.data() || {}));
        // Sin vínculos no hay nada que restringir (padre recién registrado).
        const allowed = !links.length || links.some(l => l.canSendMsg !== false);
        window._cronosParentSendCache = allowed;
        return allowed;
    } catch(e) {
        console.warn('[mensajeria v429] No se pudo leer el permiso de envío:', e && e.message);
        return true;
    }
};

// ── Estado global de la modal de mensajería ──────────────────────────
window._umState = {
    role: 'coach',
    activeTab: 'parents',
    contacts: [],
    selectedContact: null,
    threadsMap: {},
    checkedUids: new Set(),
    containerId: null
};

// Pila de navegación (js/core/nav-stack.js): qué función hay que volver a
// invocar para repintar el motor con cada rol. Las 4 son las vías de entrada
// reales; el motor en sí (_renderUnifiedMessagingView) no se registra nunca
// directamente, porque no es lo que llama nadie desde un onclick.
const _UM_ENTRY_BY_ROLE = {
    coach:            'openCoachMessaging',
    director:         'openDirectorMessaging',
    coordinator:      'openCoordinatorMessaging',
    parent:           'openParentMessaging',
    club_admin:       'openClubAdminMessaging',
    admin_individual: 'openIndividualAdminMessaging'
};

// ── Entrada: Panel del Entrenador ────────────────────────────────────
async function openCoachMessaging(tab, targetContainerId) {
    tab = tab || 'parents';
    await _renderUnifiedMessagingView('coach', tab, targetContainerId);
}
window.openCoachMessaging = openCoachMessaging;

// ── Entrada: Panel del Director Deportivo ────────────────────────────
async function openDirectorMessaging(tab, targetContainerId) {
    tab = tab || 'coordinators';
    await _renderUnifiedMessagingView('director', tab, targetContainerId);
}
window.openDirectorMessaging = openDirectorMessaging;

// ── Entrada: Panel del Coordinador ──────────────────────────────────
async function openCoordinatorMessaging(tab, targetContainerId) {
    tab = tab || 'director';
    await _renderUnifiedMessagingView('coordinator', tab, targetContainerId);
}
window.openCoordinatorMessaging = openCoordinatorMessaging;

// ── Entrada: Panel de los Padres ────────────────────────────────────
async function openParentMessaging(tab, targetContainerId) {
    tab = tab || 'coach';
    await _renderUnifiedMessagingView('parent', tab, targetContainerId);
}
window.openParentMessaging = openParentMessaging;

// ── Entrada: Panel del Administrador de Club ─────────────────────────
//  Canales: SuperAdmin (hacia arriba) y Director Deportivo (hacia abajo).
async function openClubAdminMessaging(tab, targetContainerId) {
    tab = tab || 'director';
    await _renderUnifiedMessagingView('club_admin', tab, targetContainerId);
}
window.openClubAdminMessaging = openClubAdminMessaging;

// ── Entrada: Panel del Administrador Individual ──────────────────────
//  Canales: SuperAdmin (hacia arriba) y su Entrenador.
async function openIndividualAdminMessaging(tab, targetContainerId) {
    tab = tab || 'coaches';
    await _renderUnifiedMessagingView('admin_individual', tab, targetContainerId);
}
window.openIndividualAdminMessaging = openIndividualAdminMessaging;

// ── MOTOR PRINCIPAL: Renderizado de la Interfaz Unificada ─────────────
async function _renderUnifiedMessagingView(role, tab, targetContainerId) {
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    if (!me) {
        if (typeof showToast === 'function') showToast('⚠️ Inicia sesión para ver los mensajes.', 3000);
        return;
    }

    // v429 · EXTRA 'mensajeria'. Este es el ÚNICO punto por el que pasan los
    // SEIS roles (entrenador, director, coordinador, padre, admin de club y
    // admin individual): las seis funciones open*Messaging no hacen otra cosa
    // que llamar aquí. Gatear aquí y no en cada una evita que al añadir un
    // séptimo rol se olvide el candado, que es exactamente como se coló el
    // hueco de 'comunicaciones' (un extra sin un solo lector).
    if (typeof window._cronosExtraGate === 'function' &&
        !window._cronosExtraGate('mensajeria', 'La mensajería')) {
        return;
    }

    // Definición de pestañas por rol
    let tabs = [];
    if (role === 'coach') {
        // 🔑 EN UN ENTE INDIVIDUAL NO HAY DIRECTOR: la pestaña se ETIQUETA como
        // "Admin. Individual" (petición del autor tras probarlo), pero conserva
        // el id 'director' A PROPÓSITO. El id es lo que alimenta
        // _getCanonicalContext → contexto `coach_director`, que es el que ya
        // comparten el Entrenador y el Administrador Individual: cambiarlo
        // dejaría huérfanos todos los hilos ya creados.
        const _esEnteIndividual = !!me.individualEntityId ||
            me.role === 'entrenador_individual' ||
            (Array.isArray(me.allRoles) && me.allRoles.some(r => r &&
                (r.role === 'entrenador_individual' || r.role === 'padre_individual')));
        tabs = [
            { id: 'parents', label: 'Padres', icon: '👨‍👩‍👧' },
            { id: 'director',
              label: _esEnteIndividual ? 'Admin. Individual' : 'Director',
              icon:  _esEnteIndividual ? '👤' : '📋' },
            { id: 'coordinator', label: 'Coordinador', icon: '🎯' }
        ];
    } else if (role === 'director') {
        tabs = [
            { id: 'coordinators', label: 'Coordinadores', icon: '🎯' },
            { id: 'coaches', label: 'Entrenadores', icon: '⚽' },
            { id: 'clubadmin', label: 'Admin. Club', icon: '🏛️' }
        ];
    } else if (role === 'club_admin') {
        tabs = [
            { id: 'director', label: 'Director', icon: '📋' },
            { id: 'superadmin', label: 'SuperAdmin', icon: '👑' }
        ];
    } else if (role === 'admin_individual') {
        tabs = [
            { id: 'coaches', label: 'Entrenador', icon: '⚽' },
            { id: 'superadmin', label: 'SuperAdmin', icon: '👑' }
        ];
    } else if (role === 'coordinator') {
        tabs = [
            { id: 'director', label: 'Director', icon: '📋' },
            { id: 'coaches', label: 'Entrenadores', icon: '⚽' }
        ];
    } else if (role === 'parent') {
        tabs = [
            { id: 'coach', label: 'Entrenador', icon: '⚽' }
        ];
    }

    if (!tabs.find(t => t.id === tab)) tab = tabs[0].id;

    window._umState.role = role;
    window._umState.activeTab = tab;
    window._umState.selectedContact = null;
    window._umState.checkedUids = new Set();
    window._umState.containerId = targetContainerId || null;

    let targetEl = targetContainerId ? document.getElementById(targetContainerId) : null;
    let isModalMode = false;

    if (!targetEl) {
        targetEl = document.getElementById('setup-modal');
        targetEl.style.display = 'flex';
        isModalMode = true;
    }

    // ── Pila de navegación ────────────────────────────────────────────────
    // 🔑 SOLO EN MODO MODAL. Embebido, la RAÍZ del anfitrión ya posee esta
    // vista (openStaffDashboard para Director/Coordinador, openParentPanel para
    // Padres) y la pinta en un div interno suyo. Registrar el motor ahí haría
    // que navBack lo repintase en un contenedor que ya no existe — la misma
    // trampa que la ronda 5 documentó para switchStaffTab.
    // Va ANTES del primer await (invariante async de la ronda 3): si no, navBack
    // correría con el flag de restauración ya limpio y volvería a apilar la
    // pantalla que está restaurando, dejando "Volver" en bucle.
    if (isModalMode && typeof navScreen === 'function') {
        navScreen(_UM_ENTRY_BY_ROLE[role] || 'openCoachMessaging', tab);
    }

    const innerHTML = `
    <div class="${isModalMode ? 'modal-content' : 'embedded-comms'} um-root" style="width:100%;height:${isModalMode ? '86vh' : '100%'};max-height:${isModalMode ? '850px' : '100%'};
         display:flex;flex-direction:column;overflow:hidden;padding:0;background:#0d1117;
         border:1px solid rgba(255,255,255,0.1);border-radius:${isModalMode ? '12px' : '8px'};box-shadow:0 20px 40px rgba(0,0,0,0.6);">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.8rem 1.2rem;
                    background:linear-gradient(to right, #161b22, #0d1117);border-bottom:1px solid var(--glass-border);flex-shrink:0;">
            <div style="display:flex;align-items:center;gap:0.6rem;">
                <span style="font-size:1.2rem;">💬</span>
                <h2 style="margin:0;font-size:1.05rem;color:white;font-weight:700;">Mensajes</h2>
            </div>
            <div style="display:flex;gap:0.5rem;align-items:center;">
                ${role === 'coach' && isModalMode ? `
                <button onclick="navBack()" class="btn"
                    style="font-size:0.75rem;padding:0.35rem 0.8rem;background:rgba(255,255,255,0.05);color:var(--text-muted);border-radius:6px;">
                    ← Volver
                </button>` : ''}
                <button onclick="_loadUnifiedContactList((window._umState&&window._umState.activeTab)||'${tab}')" class="btn"
                    style="font-size:0.75rem;padding:0.35rem 0.8rem;background:var(--glass);color:var(--text-muted);border-radius:6px;">
                    🔄 Actualizar
                </button>
                ${isModalMode ? `
                <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;line-height:1;padding:0 0.3rem;"
                    title="Cerrar">✕</button>
                ` : ''}
            </div>
        </div>

        <!-- Split View Layout -->
        <!-- 📱 RESPONSIVE: en pantallas estrechas (<=950px) este split deja de ser
             de dos columnas y pasa a maestro-detalle: se ve la lista O el chat, y
             el intercambio lo hace la clase 'um-showing-chat' sobre este mismo
             contenedor (ver bloque "MENSAJERÍA RESPONSIVE" en style.css). Las
             clases um-split / um-sidebar / um-chat son los ÚNICOS ganchos que
             tiene el CSS para vencer a los style="" inline de abajo: si se
             renombran aquí, el móvil vuelve a 260px de lista y 130px de chat. -->
        <div id="um-split" class="um-split" style="flex:1;display:flex;min-height:0;overflow:hidden;">

            <!-- Columna Izquierda: Pestañas + Contactos (340px) -->
            <div class="um-sidebar" style="width:340px;min-width:260px;max-width:40%;border-right:1px solid var(--glass-border);
                        display:flex;flex-direction:column;background:rgba(22,27,34,0.4);">

                <!-- Pestañas superior izquierda -->
                <div class="um-tabbar" style="display:flex;border-bottom:1px solid var(--glass-border);background:#161b22;flex-shrink:0;">
                    ${tabs.map(t => `
                        <button onclick="_switchUnifiedTab('${t.id}')" id="um-tab-${t.id}" class="um-tab"
                            style="flex:1;padding:0.6rem 0.4rem;background:none;border:none;
                                   border-bottom:2.5px solid ${t.id === tab ? 'var(--primary)' : 'transparent'};
                                   color:${t.id === tab ? 'var(--primary)' : 'var(--text-muted)'};
                                   font-size:0.8rem;font-weight:700;cursor:pointer;white-space:nowrap;
                                   transition:all 0.15s;">
                            ${t.icon} ${t.label}
                        </button>
                    `).join('')}
                </div>

                <!-- Barra Selección Múltiple -->
                <div id="um-bulk-bar" style="padding:0.55rem 0.8rem;background:rgba(88,166,255,0.06);
                     border-bottom:1px solid var(--glass-border);display:flex;align-items:center;
                     gap:0.5rem;flex-shrink:0;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.76rem;
                                  font-weight:700;cursor:pointer;color:var(--primary);">
                        <input type="checkbox" id="um-chk-all" style="width:16px;height:16px;accent-color:var(--primary);"
                            onchange="_toggleSelectAllUnified(this.checked)">
                        Todos
                    </label>
                    <span id="um-bulk-count" style="font-size:0.72rem;color:var(--text-muted);flex:1;">
                        0 seleccionados
                    </span>
                    <button onclick="_openUnifiedBulkComposer()"
                        style="padding:0.32rem 0.75rem;background:var(--primary);border:none;
                               border-radius:6px;color:#0a0e14;font-weight:700;font-size:0.72rem;cursor:pointer;">
                        ✉️ Enviar grupal
                    </button>
                </div>

                <!-- Badge Informativo de Filtro -->
                <div id="um-filter-badge" style="display:none;padding:0.4rem 0.8rem;font-size:0.7rem;
                     color:var(--text-muted);background:rgba(88,166,255,0.08);border-bottom:1px solid rgba(88,166,255,0.2);"></div>

                <!-- Lista de Contactos Scrollable -->
                <div id="um-contact-list" style="flex:1;overflow-y:auto;padding:0.5rem;display:flex;flex-direction:column;gap:0.4rem;">
                    <p style="color:var(--text-muted);text-align:center;padding:2rem;font-size:0.85rem;">⏳ Cargando destinatarios…</p>
                </div>
            </div>

            <!-- Columna Derecha: Conversación Activa -->
            <div id="um-chat-view" class="um-chat" style="flex:1;display:flex;flex-direction:column;background:#0d1117;min-width:0;">
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
                            color:var(--text-muted);padding:3rem;text-align:center;">
                    <div style="font-size:3rem;margin-bottom:1rem;opacity:0.6;">💬</div>
                    <div style="font-size:0.92rem;font-weight:600;">Selecciona un contacto de la lista</div>
                    <div style="font-size:0.78rem;margin-top:0.3rem;opacity:0.8;">
                        para ver el historial de mensajes con fecha y hora
                    </div>
                </div>
            </div>

        </div>
    </div>`;

    targetEl.innerHTML = innerHTML;
    await _loadUnifiedContactList(tab);
}

async function _loadThreadMessages(threadId, perspective) {
    const contact = (window._umState && window._umState.selectedContact) || (window._umState && window._umState.contacts && window._umState.contacts[0]) || { uid: '', name: 'Contacto' };
    return await _loadUnifiedThreadMessages(threadId, contact);
}

// ── Cambiar pestaña activa ──────────────────────────────────────────
async function _switchUnifiedTab(tabId) {
    window._umState.activeTab = tabId;
    window._umState.selectedContact = null;
    window._umState.checkedUids.clear();

    // Las pestañas son INTERNAS: no repintan el motor, solo la lista y el panel
    // derecho. Así que no son pantallas propias — la pestaña activa viaja como
    // ARGUMENTO de la pantalla del motor, igual que en Dirección y en Padres.
    // navScreen reemplaza los argumentos cuando la función del tope es la misma,
    // así que cambiar de pestaña no apila (ronda 3).
    // Solo en modal: embebido, la pestaña la posee la raíz del anfitrión. Este
    // es el primer LECTOR de _umState.containerId, que hasta ahora se escribía
    // en cada render y no se leía en ningún sitio.
    if (!window._umState.containerId && typeof navScreen === 'function') {
        navScreen(_UM_ENTRY_BY_ROLE[window._umState.role] || 'openCoachMessaging', tabId);
    }

    const role = window._umState.role;
    let tabs = [];
    // ⚠️ SEGUNDA LISTA DE PESTAÑAS: tiene que decir lo mismo que la de
    // _renderUnifiedMessagingView. Si se añade una pestaña allí y no aquí, el
    // botón se pinta pero al pulsarlo no cambia nada.
    if (role === 'coach') tabs = ['parents', 'director', 'coordinator'];
    else if (role === 'director') tabs = ['coordinators', 'coaches', 'clubadmin'];
    else if (role === 'coordinator') tabs = ['director', 'coaches'];
    else if (role === 'parent') tabs = ['coach'];
    else if (role === 'club_admin') tabs = ['director', 'superadmin'];
    else if (role === 'admin_individual') tabs = ['coaches', 'superadmin'];

    tabs.forEach(t => {
        const btn = document.getElementById(`um-tab-${t}`);
        if (btn) {
            btn.style.borderBottomColor = (t === tabId) ? 'var(--primary)' : 'transparent';
            btn.style.color = (t === tabId) ? 'var(--primary)' : 'var(--text-muted)';
        }
    });

    const chkAll = document.getElementById('um-chk-all');
    if (chkAll) chkAll.checked = false;
    _updateUnifiedBulkCount();

    // 📱 Al cambiar de pestaña ya no hay contacto abierto: en móvil hay que
    // volver a enseñar la LISTA, o el usuario se quedaría mirando el panel
    // "Selecciona un contacto" sin ninguna forma de llegar a los contactos
    // (el botón "←" vive dentro del hilo, que aquí se acaba de borrar).
    _umSetShowingChat(false);

    // Reset vista chat derecha
    const chatView = document.getElementById('um-chat-view');
    if (chatView) {
        chatView.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
                    color:var(--text-muted);padding:3rem;text-align:center;">
            <div style="font-size:3rem;margin-bottom:1rem;opacity:0.6;">💬</div>
            <div style="font-size:0.92rem;font-weight:600;">Selecciona un contacto de la lista</div>
            <div style="font-size:0.78rem;margin-top:0.3rem;opacity:0.8;">
                para ver el historial de mensajes con fecha y hora
            </div>
        </div>`;
    }

    await _loadUnifiedContactList(tabId);
}

// ── Cargar Lista de Contactos según Rol y Pestaña ─────────────────────
async function _loadUnifiedContactList(tabId) {
    const listEl = document.getElementById('um-contact-list');
    const badgeEl = document.getElementById('um-filter-badge');
    if (!listEl) return;

    listEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;font-size:0.85rem;">⏳ Cargando destinatarios…</p>';
    if (badgeEl) badgeEl.style.display = 'none';

    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    if (!me) return;

    try {
        const fns = await _cFS();
        const { db, collection, getDocs, query, where, doc, getDoc } = fns;
        let clubId = me.clubId || '';
        // Todos los clubIds asociados que se descubran más abajo. Declarado
        // AQUÍ, en el ámbito de la función, para que las pestañas de
        // administradores puedan consultarlos: antes vivía dentro del bloque
        // `if (clubId)` y no llegaba hasta ellas.
        let _umAllClubIds = new Set(clubId ? [clubId] : []);

        // FIX (v174, mismo patrón que _sdLoadReports en club-reports.js): si
        // me.clubId no está disponible en el token, resolverlo desde Firestore.
        if (!clubId && me.uid && typeof window._cResolveClubId === 'function') {
            try {
                clubId = await window._cResolveClubId(db, me, { doc, getDoc });
                if (clubId) me.clubId = clubId;
            } catch(_) {}
        }

        // Obtener todos los usuarios del club desde Firestore
        let clubUsers = [];
        if (clubId) {
            // FIX (conexión entre roles — Director/Coordinador↔Entrenador "sin
            // conexión"): el clubId del entrenador y el del director/coordinador
            // pueden ser DIFERENTES por inconsistencias históricas en users/{uid}
            // (mismo problema ya identificado y corregido en _sdLoadReports,
            // club-reports.js, v179). Una query ingenua por un único clubId deja
            // la lista de "Entrenadores" vacía para el director/coordinador
            // aunque el entrenador exista y esté en el mismo club real.
            // Misma estrategia: descubrir TODOS los clubIds asociados (propio
            // doc + allRoles + usuarios ya encontrados + búsqueda por email) y
            // consultar 'users' por cada uno, fusionando resultados sin duplicar.
            const _allClubIds = new Set([clubId]);
            try {
                const myDoc = await getDoc(doc(db, 'users', me.uid));
                if (myDoc.exists()) {
                    const myData = myDoc.data();
                    if (myData.clubId) _allClubIds.add(myData.clubId);
                    if (Array.isArray(myData.allRoles)) {
                        myData.allRoles.forEach(r => { if (r && r.clubId) _allClubIds.add(r.clubId); });
                    }
                }
            } catch(_) {}

            // 🔑 Se comparte el MISMO Set fuera de este bloque: las pestañas de
            // administradores lo necesitan para no consultar por un único
            // clubId. Está documentado arriba que el clubId del Director puede
            // diferir del de los demás miembros del mismo club real, y consultar
            // sólo por el suyo dejaba su pestaña vacía. Al ser una referencia,
            // todo lo que se añada después también les llega.
            // ⚠️ Va AQUÍ y no justo tras crear el Set: test_messaging_multiclubid.js
            // (1b) exige que la creación del Set y la lectura de users/{uid}
            // sigan a menos de 300 caracteres, y meter esto en medio lo rompía.
            _umAllClubIds = _allClubIds;

            const seenUserIds = new Set();
            const queriedClubIds = new Set();
            const _queryUsersForClub = async (cid) => {
                if (queriedClubIds.has(cid)) return;
                queriedClubIds.add(cid);
                try {
                    const snap = await getDocs(query(collection(db, 'users'), where('clubId', '==', cid)));
                    snap.forEach(d => {
                        if (seenUserIds.has(d.id)) return;
                        seenUserIds.add(d.id);
                        const data = d.data();
                        if (data.clubId) _allClubIds.add(data.clubId);
                        if (Array.isArray(data.allRoles)) {
                            data.allRoles.forEach(r => { if (r && r.clubId) _allClubIds.add(r.clubId); });
                        }
                        // FIX (conexión entre roles): 'users' contiene tanto el documento
                        // PRIMARIO de cada cuenta (id === su propio uid, con allRoles/
                        // category/subcategory reales) como documentos "secundarios" que
                        // auth.js crea al añadir un rol adicional (id compuesto
                        // `${uid}_${role}_${clubId}`, SIN category/subcategory/allRoles).
                        // Esos secundarios pasaban el filtro isCoach (role:'user'/'coach')
                        // con categoría vacía; _catAndSubcatMatch trata una categoría vacía
                        // como comodín, así que aparecían como "el entrenador" de CUALQUIER
                        // padre del club (aunque el uid resuelto fuera el correcto), y el
                        // mensaje podía acabar viéndose donde no correspondía. Solo el
                        // documento primario (id === su propio campo uid) es la fuente de
                        // verdad para listar contactos.
                        if (data.uid && data.uid !== d.id) return;
                        clubUsers.push({ uid: d.id, ...data });
                    });
                } catch(e) { console.warn('[_loadUnifiedContactList] Error cargando usuarios del club', cid, ':', e.message); }
            };

            // Ronda 1: clubIds ya conocidos (propio doc + allRoles).
            for (const cid of [..._allClubIds]) {
                await _queryUsersForClub(cid);
            }
            // Ronda 2: clubIds NUEVOS descubiertos en la ronda 1 (vía allRoles
            // de otros usuarios encontrados) que aún no se consultaron.
            for (const cid of [..._allClubIds]) {
                await _queryUsersForClub(cid);
            }

            // Búsqueda por email propio (caso multi-rol: mismo email, clubId distinto).
            try {
                if (me.email) {
                    const emailSnap = await getDocs(query(collection(db, 'users'), where('email', '==', me.email)));
                    for (const d of emailSnap.docs) {
                        const data = d.data();
                        if (data.clubId) await _queryUsersForClub(data.clubId);
                    }
                }
            } catch(_) {}
        }

        // Obtener hilos de mensajes existentes para badge de no leídos e historial
        const threadsSnap = await getDocs(query(collection(db, 'cronos_messages'), where('clubId', '==', clubId))).catch(() => ({ forEach: ()=>{} }));
        const threadsMap = {};
        threadsSnap.forEach(d => { threadsMap[d.id] = { _id: d.id, ...d.data() }; });
        window._umState.threadsMap = threadsMap;

        let contacts = [];
        let filterText = '';

        const coachCategory = me.category || me.categoryLabel || '';
        const coachSubcategory = me.subcategory || '';
        const coachModality = _getCategoryModality(coachCategory);

        // ════════════════════════════════════════════════════════════
        // CASO 1: ENTRENADOR (tabs: parents, director, coordinator)
        // ════════════════════════════════════════════════════════════
        if (window._umState.role === 'coach') {
            if (tabId === 'parents') {
                if (typeof loadEmailConfig === 'function') await loadEmailConfig();
                const linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('clubId', '==', clubId))).catch(() => ({ forEach: ()=>{} }));
                const rawLinks = [];
                linksSnap.forEach(d => rawLinks.push({ _id: d.id, ...d.data() }));

                const manualContacts = (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts)) ? emailConfig.contacts : [];
                manualContacts.forEach(c => {
                    if (c.type === 'parent' || !c.type) {
                        const exists = rawLinks.find(l => (c.email && l.parentEmail === c.email) || (c.uid && (l.parentUid === c.uid || l.uid === c.uid)));
                        if (!exists) {
                            rawLinks.push({
                                // FIX (conexión Entrenador<->Padre): NO usar c.id (identificador
                                // local del contacto manual, p.ej. "new_1784759436505") como
                                // parentUid — no es un uid real de Firebase. Si lo hiciéramos, el
                                // resolvedUid de más abajo lo daría por "ya resuelto" y JAMÁS
                                // intentaría el fallback por email contra clubUsers, dejando el
                                // threadId apuntando a un id inventado que el padre real nunca lee.
                                // Dejar parentUid vacío cuando no hay uid real permite que ese
                                // fallback por email encuentre la cuenta real del padre.
                                _id: c.id || ('m_' + Math.random().toString(36).substr(2,5)),
                                parentUid: c.uid || '',
                                parentEmail: c.email || '',
                                parentPhone: c.phone || c.wa || '',
                                playerAlias: c.player || c.name || 'Familiar',
                                category: c.category || '',
                                subcategory: c.subcategory || ''
                            });
                        }
                    }
                });

                // Filtrar estrictamente por categoría Y subcategoría del entrenador
                contacts = rawLinks.filter(l => {
                    const cat = l.category || l.categoryLabel || l.teamName || '';
                    const sub = l.subcategory || '';
                    return _catAndSubcatMatch(coachCategory, coachSubcategory, cat, sub);
                }).map(l => {
                    // FIX (conexión entre roles Entrenador<->Padre): l.parentUid puede
                    // faltar o quedar sin rellenar si el enlace (cronos_player_links) se
                    // creó antes de que el padre completara su registro, o si la
                    // vinculación automática por inviteCode falló. Sin el uid REAL del
                    // padre, _cThreadId calcula un id distinto en cada panel (el
                    // entrenador usa l._id, el padre usa su propio uid real) y ninguno
                    // de los dos ve los mensajes del otro. Recurso (mismo patrón ya
                    // probado en _cronosResolveParentReportTargets para informes):
                    // si falta parentUid, buscar por email en clubUsers (ya reconciliado
                    // por clubId/allRoles más arriba) una cuenta de padre real.
                    let resolvedUid = l.parentUid || '';
                    if (!resolvedUid && l.parentEmail) {
                        const match = clubUsers.find(u => u.email && String(u.email).toLowerCase() === String(l.parentEmail).toLowerCase());
                        if (match) resolvedUid = match.uid;
                    }
                    resolvedUid = resolvedUid || l._id;
                    return {
                        id: resolvedUid,
                        uid: resolvedUid,
                        name: l.playerAlias || l.playerName || l.parentEmail || 'Padre/Tutor',
                        subtitle: `${l.parentEmail || 'Sin email'} ${l.playerNumber && l.playerNumber !== '—' ? '· #' + l.playerNumber : ''}`,
                        email: l.parentEmail || '',
                        phone: l.parentPhone || l.parentWA || '',
                        roleTag: 'parent',
                        icon: '👨‍👩‍👧',
                        category: l.category || coachCategory,
                        subcategory: l.subcategory || coachSubcategory
                    };
                });

                if (coachCategory) {
                    filterText = `🏷️ Filtro activo: <strong style="color:#58a6ff;">${_normCat(coachCategory).toUpperCase()} ${coachSubcategory}</strong>`;
                }
            }
            else if (tabId === 'director') {
                if (typeof loadEmailConfig === 'function') await loadEmailConfig();
                const manualContacts = (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts)) ? emailConfig.contacts : [];
                const staffList = await _cGetStaff(db, clubId, fns, ['director', 'club_admin', 'admin']);

                const byUid = new Map();
                const firestoreDirs = clubUsers.filter(u => {
                    return u.role === 'director' || u._activeRole === 'director' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'director' || r.role === 'club_admin' || r.role === 'admin') && r.status !== 'rejected'));
                });
                // 🔑 ADMINISTRADOR INDIVIDUAL (fallo visto en producción
                // 2026-07-30 — el Entrenador no tenía por dónde escribirle).
                // Su rol se llama 'individual' o 'admin_individual', NO
                // 'club_admin', así que el filtro de arriba lo dejaba fuera.
                // El contexto del hilo ya era el correcto (coach_director): esto
                // era un fallo de LISTA, no de hilo, y por eso se arregla aquí y
                // NO tocando _getCanonicalContext — cambiar el contexto dejaría
                // huérfanos los hilos ya creados.
                // Sólo en la pestaña del ENTRENADOR: en un ente individual no
                // hay coordinador, así que su pestaña equivalente no se toca.
                const _esAdminIndividual = (u) =>
                    u.role === 'individual' || u.role === 'admin_individual' ||
                    u._activeRole === 'individual' ||
                    (Array.isArray(u.allRoles) && u.allRoles.some(r => r &&
                        (r.role === 'individual' || r.role === 'admin_individual') && r.status !== 'rejected'));
                const firestoreIndAdmins = clubUsers.filter(_esAdminIndividual);

                // 🔑 CONSULTA DIRECTA DEL ADMINISTRADOR DEL ENTE (segunda ronda
                // de producción). Los entes individuales viven en la MISMA
                // colección `clubs` con type:'individual', y su administrador se
                // enlaza por users.individualEntityId — no por clubId, así que
                // `clubUsers` no lo traía. Se prueban las dos vías: el enlace por
                // entidad y el adminUid del propio documento del ente.
                const _entId = me.individualEntityId || clubId || '';
                if (_entId) {
                    try {
                        // ⚠️ CONSULTA DE UN SOLO CAMPO, Y EL ROL SE FILTRA EN
                        // CLIENTE, A PROPÓSITO: firestore.indexes.json declara
                        // `individualEntityId + status` pero NO
                        // `individualEntityId + role`, así que una consulta
                        // compuesta fallaría con failed-precondition y este
                        // catch la silenciaría — el administrador volvería a no
                        // aparecer, que es justo el bucle que hay que cortar.
                        // Un campo suelto siempre está indexado automáticamente.
                        const indSnap = await getDocs(query(
                            collection(db, 'users'),
                            where('individualEntityId', '==', _entId)
                        ));
                        indSnap.forEach(d => {
                            const u = d.data() || {};
                            if (!_esAdminIndividual(u)) return;
                            const uid = u.uid || d.id;
                            if (uid && !byUid.has(uid)) {
                                byUid.set(uid, {
                                    id: uid, uid,
                                    name: u.displayName || u.name || u.email || 'Administrador Individual',
                                    subtitle: `Administrador Individual · ${u.email || ''}`,
                                    email: u.email || '', phone: u.phone || '',
                                    roleTag: 'admin_individual', icon: '👤'
                                });
                            }
                        });
                    } catch (_) { /* índice ausente o sin permiso: queda el doc del ente */ }

                    try {
                        const entSnap = await getDoc(doc(db, 'clubs', _entId));
                        if (entSnap.exists()) {
                            const e = entSnap.data() || {};
                            const uid = e.adminUid || e.createdBy || '';
                            if (uid && !byUid.has(uid)) {
                                byUid.set(uid, {
                                    id: uid, uid,
                                    name: e.adminEmail || 'Administrador Individual',
                                    subtitle: `Administrador Individual · ${e.adminEmail || ''}`,
                                    email: e.adminEmail || '', phone: '',
                                    roleTag: 'admin_individual', icon: '👤'
                                });
                            }
                        }
                    } catch (_) { /* sin permiso o sin red: quedan los otros caminos */ }
                }

                [...staffList, ...firestoreDirs, ...firestoreIndAdmins].forEach(u => {
                    const uid = u.uid || u.id;
                    if (uid && !byUid.has(uid)) {
                        const esInd = _esAdminIndividual(u);
                        byUid.set(uid, {
                            id: uid, uid,
                            name: u.displayName || u.name || u.email || (esInd ? 'Administrador Individual' : 'Director Deportivo'),
                            subtitle: `${esInd ? 'Administrador Individual' : 'Director Deportivo'} · ${u.email || ''}`,
                            email: u.email || '', phone: u.phone || '',
                            roleTag: esInd ? 'admin_individual' : 'director',
                            icon: esInd ? '👤' : '📋'
                        });
                    }
                });

                manualContacts.filter(c => c.type !== 'parent' && (c.role === 'director' || !c.role || (c.tags || []).includes('msj'))).forEach(c => {
                    const uid = c.uid || c.id || c.email;
                    if (uid && !byUid.has(uid)) {
                        byUid.set(uid, {
                            id: uid, uid: c.uid || uid,
                            name: c.name || c.displayName || c.email || 'Director Deportivo',
                            subtitle: `Director Deportivo · ${c.email || ''}`,
                            email: c.email || '', phone: c.phone || '',
                            roleTag: 'director', icon: '📋'
                        });
                    }
                });

                contacts = Array.from(byUid.values());
            }
            else if (tabId === 'coordinator') {
                if (typeof loadEmailConfig === 'function') await loadEmailConfig();
                const manualContacts = (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts)) ? emailConfig.contacts : [];
                const staffList = await _cGetStaff(db, clubId, fns, ['coordinator', 'coordinador']);
                
                const byUid = new Map();
                const firestoreCoords = clubUsers.filter(u => {
                    const isCoord = u.role === 'coordinator' || u._activeRole === 'coordinator' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'coordinator' || r.role === 'coordinador') && r.status !== 'rejected'));
                    if (!isCoord) return false;
                    const coordType = u.coordinatorType || u.requestedCoordinatorType || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'coordinator') || {}).coordinatorType : '');
                    return _coordinatorCoversModality(coordType, coachCategory);
                });
                [...staffList, ...firestoreCoords].forEach(u => {
                    const uid = u.uid || u.id;
                    if (uid && !byUid.has(uid)) {
                        const coordType = u.coordinatorType || u.requestedCoordinatorType || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'coordinator') || {}).coordinatorType : '') || 'General';
                        byUid.set(uid, {
                            id: uid, uid,
                            name: u.displayName || u.name || u.email || 'Coordinador',
                            subtitle: `Coordinador (${coordType.toUpperCase()}) · ${u.email || ''}`,
                            email: u.email || '', phone: u.phone || '',
                            roleTag: 'coordinator', icon: '🎯'
                        });
                    }
                });

                manualContacts.filter(c => c.type !== 'parent' && (c.role === 'coordinator' || !c.role || (c.tags || []).includes('msj'))).forEach(c => {
                    const uid = c.uid || c.id || c.email;
                    if (uid && !byUid.has(uid)) {
                        byUid.set(uid, {
                            id: uid, uid: c.uid || uid,
                            name: c.name || c.displayName || c.email || 'Coordinador',
                            subtitle: `Coordinador · ${c.email || ''}`,
                            email: c.email || '', phone: c.phone || '',
                            roleTag: 'coordinator', icon: '🎯'
                        });
                    }
                });

                contacts = Array.from(byUid.values());
            }
        }
        // ════════════════════════════════════════════════════════════
        // CASO 2: DIRECTOR DEPORTIVO (tabs: coordinators, coaches)
        // ════════════════════════════════════════════════════════════
        else if (window._umState.role === 'director') {
            if (tabId === 'coordinators') {
                if (typeof loadEmailConfig === 'function') await loadEmailConfig();
                const manualContacts = (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts)) ? emailConfig.contacts : [];
                const staffList = await _cGetStaff(db, clubId, fns, ['coordinator', 'coordinador']);
                
                const byUid = new Map();
                const firestoreCoords = clubUsers.filter(u => {
                    return u.role === 'coordinator' || u._activeRole === 'coordinator' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'coordinator' || r.role === 'coordinador') && r.status !== 'rejected'));
                });
                [...staffList, ...firestoreCoords].forEach(u => {
                    const uid = u.uid || u.id;
                    if (uid && !byUid.has(uid)) {
                        const coordType = u.coordinatorType || u.requestedCoordinatorType || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'coordinator') || {}).coordinatorType : '') || 'General';
                        byUid.set(uid, {
                            id: uid, uid,
                            name: u.displayName || u.name || u.email || 'Coordinador',
                            subtitle: `Coordinador (${coordType.toUpperCase()}) · ${u.email || ''}`,
                            email: u.email || '', phone: u.phone || '',
                            roleTag: 'coordinator', icon: '🎯'
                        });
                    }
                });

                manualContacts.filter(c => c.type !== 'parent' && (c.role === 'coordinator' || !c.role || (c.tags || []).includes('msj'))).forEach(c => {
                    const uid = c.uid || c.id || c.email;
                    if (uid && !byUid.has(uid)) {
                        byUid.set(uid, {
                            id: uid, uid: c.uid || uid,
                            name: c.name || c.displayName || c.email || 'Coordinador',
                            subtitle: `Coordinador · ${c.email || ''}`,
                            email: c.email || '', phone: c.phone || '',
                            roleTag: 'coordinator', icon: '🎯'
                        });
                    }
                });

                contacts = Array.from(byUid.values());
            }
            else if (tabId === 'coaches') {
                contacts = clubUsers.filter(u => {
                    const isCoach = u.role === 'user' || u.role === 'coach' || u._activeRole === 'coach' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'user' || r.role === 'coach') && r.status !== 'rejected'));
                    return isCoach;
                }).map(u => {
                    const cat = u.category || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).category : '') || 'Sin cat.';
                    const sub = u.subcategory || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).subcategory : '') || '';
                    return {
                        id: u.uid, uid: u.uid,
                        name: u.displayName || u.name || u.email || 'Entrenador',
                        subtitle: `Entrenador (${_normCat(cat).toUpperCase()} ${sub}) · ${u.email || ''}`,
                        email: u.email || '', phone: u.phone || '',
                        roleTag: 'coach', icon: '⚽'
                    };
                });
            }
            // ⚠️⚠️ ESTA PESTAÑA VA **DENTRO** DE LA RAMA DEL DIRECTOR ⚠️⚠️
            // Estuvo tres versiones (v412-v415) como un `else if` HERMANO
            // —`else if (role === 'director' && tabId === 'clubadmin')`— colocado
            // DESPUÉS del `else if (role === 'director')` de arriba. Ese `else if`
            // genérico captura TODAS las pestañas del Director, así que la rama
            // hermana era INALCANZABLE y `contacts` se quedaba vacío: "No se
            // encontraron destinatarios". Tres rondas de correcciones dentro de
            // ella no cambiaron nada porque el código NUNCA SE EJECUTÓ.
            // El guard no lo veía porque censaba que el código EXISTIERA, no que
            // fuese ALCANZABLE; ahora lo vigila la aserción 9a.
            else if (tabId === 'clubadmin') {
                // El Director habla con el Administrador de Club. Simétrica de la
                // pestaña 'director' del Administrador de Club — las dos usan el
                // contexto 'clubadmin_director', que es lo que les hace compartir hilo.
            const byUid = new Map();

            // 🔑 FUENTE PRIMARIA: EL DOCUMENTO DEL CLUB (fallo visto en
            // producción 2026-07-30 — la pestaña salía "sin destinatarios").
            // El vínculo autoritativo del administrador NO está en
            // users/{uid}.role sino en clubs/{clubId}: adminUid / adminEmail /
            // createdBy. Es exactamente lo que usa openClubAdminPanel para
            // decidir qué club abrir. Buscar sólo por rol deja la pestaña vacía
            // en cuanto el doc de usuario no lleva el rol propagado, que es el
            // caso normal.
            if (clubId) {
                try {
                    const clubSnap = await getDoc(doc(db, 'clubs', clubId));
                    if (clubSnap.exists()) {
                        const c = clubSnap.data() || {};
                        // 🔑 SIN `createdBy`, Y ES DELIBERADO: ese campo es QUIEN
                        // CREÓ el club, no quién lo administra — y los clubes los
                        // crea el SuperAdmin (js/admin/club/panel.js escribe
                        // `createdBy: me.uid`). Usarlo metía al SuperAdmin en esta
                        // lista etiquetado como Administrador de Club, y el
                        // Director NO debe tener canal con él.
                        // ⚠️ En el ENTE INDIVIDUAL sí se usa createdBy: allí el
                        // creador ES el administrador individual.
                        const adminUid = c.adminUid || '';
                        const adminEmail = c.adminEmail || '';
                        // Se completa el nombre desde users si ese doc está a mano.
                        let ficha = null;
                        if (adminUid) ficha = clubUsers.find(u => (u.uid || u.id) === adminUid) || null;
                        if (!ficha && adminEmail) ficha = clubUsers.find(u => u.email === adminEmail) || null;
                        // 🔑 El documento del club puede traer SÓLO adminEmail.
                        // Sin resolverlo a un uid no hay con quién abrir hilo, y
                        // la pestaña se quedaba vacía teniendo el dato delante.
                        // Consulta de un solo campo: siempre indexada.
                        if (!adminUid && !ficha && adminEmail) {
                            try {
                                const byEmail = await getDocs(query(
                                    collection(db, 'users'),
                                    where('email', '==', adminEmail)
                                ));
                                byEmail.forEach(d => { if (!ficha) ficha = { id: d.id, ...d.data() }; });
                            } catch (_) {}
                        }
                        const uid = adminUid || (ficha && (ficha.uid || ficha.id)) || '';
                        // Vía _addAdmin para que el filtro de SuperAdmin se
                        // aplique TAMBIÉN aquí: construir el contacto a mano se
                        // saltaba la única puerta que lo excluye.
                        _addAdmin(uid, Object.assign({ email: adminEmail }, ficha || {}));
                    }
                } catch (_) { /* sin permiso o sin red: quedan los respaldos por rol */ }
            }

            // 🔑 CONSULTA DIRECTA A `users` (segunda ronda de producción,
            // 2026-07-30: con el documento del club ya leído seguía saliendo
            // vacía). `clubUsers` DESCARTA A PROPÓSITO los documentos
            // SECUNDARIOS —los que auth.js crea al añadir un rol extra, con id
            // `${uid}_${role}_${clubId}`— porque no llevan category/subcategory
            // y contaminaban otras pestañas. Pero el rol `club_admin` vive
            // justamente ahí en muchas cuentas, así que el administrador era
            // invisible POR DISEÑO. Esta consulta no pasa por ese filtro.
            // 🔑 REGLA DE NEGOCIO (autor, 2026-07-30): el Director NO tiene
            // canal con el SuperAdmin — eso es competencia exclusiva del
            // Administrador de Club. Se excluye en TODOS los caminos, incluido
            // el respaldo por hilos, mirando el rol raíz y también allRoles.
            const _esSuperAdmin = (u) => !!u && (
                u.role === 'superadmin' || u._activeRole === 'superadmin' ||
                (Array.isArray(u.allRoles) && u.allRoles.some(r => r && r.role === 'superadmin')));

            const _addAdmin = (uid, u) => {
                if (!uid || byUid.has(uid)) return;
                if (_esSuperAdmin(u)) return;
                byUid.set(uid, {
                    id: uid, uid,
                    name: (u && (u.displayName || u.name)) || (u && u.email) || 'Administrador de Club',
                    subtitle: `Administrador de Club · ${(u && u.email) || ''}`,
                    email: (u && u.email) || '', phone: (u && u.phone) || '',
                    roleTag: 'club_admin', icon: '🏛️'
                });
            };

            // 🔑 POR TODOS LOS clubIds DESCUBIERTOS, no sólo el propio: está
            // documentado en este mismo fichero que el clubId del Director puede
            // diferir del de los demás miembros del mismo club real.
            for (const cid of [..._umAllClubIds]) {
                if (!cid) continue;
                try {
                    const admSnap = await getDocs(query(
                        collection(db, 'users'),
                        where('clubId', '==', cid),
                        where('role', 'in', ['club_admin', 'admin'])
                    ));
                    admSnap.forEach(d => {
                        const u = d.data() || {};
                        // En un doc secundario el uid real está en el campo uid,
                        // no en el id del documento (que es compuesto).
                        _addAdmin(u.uid || d.id, u);
                    });
                } catch (_) { /* índice ausente o sin permiso: quedan los otros caminos */ }
            }

            // 🔑 RESPALDO QUE CIERRA EL CASO: los HILOS QUE YA EXISTEN. Si el
            // Administrador ya escribió al Director, ese documento lo tiene como
            // participante. Leerlo garantiza que el mensaje aparezca aunque los
            // roles o los clubId estén mal poblados — que es exactamente lo que
            // pasaba: el hilo existía y el Director no tenía a quién pulsar.
            try {
                const ctxCanal = _getCanonicalContext('director', 'clubadmin');
                const thSnap = await getDocs(query(
                    collection(db, 'cronos_messages'),
                    where('participants', 'array-contains', me.uid)
                ));
                const pendientes = [];
                thSnap.forEach(d => {
                    if (!d.id.endsWith('_' + ctxCanal)) return;
                    const t = d.data() || {};
                    const otro = (t.participants || []).find(p => p && p !== me.uid);
                    if (otro && !byUid.has(otro)) pendientes.push(otro);
                });
                for (const uid of pendientes) {
                    let u = null;
                    try {
                        const uSnap = await getDoc(doc(db, 'users', uid));
                        if (uSnap.exists()) u = uSnap.data();
                    } catch (_) {}
                    _addAdmin(uid, u);
                }
            } catch (_) { /* sin permiso o sin red: quedan los caminos por rol */ }

            // RESPALDO: búsqueda por rol, como estaba.
            const staffList = await _cGetStaff(db, clubId, fns, ['club_admin', 'admin']);
            const firestoreAdmins = clubUsers.filter(u =>
                u.role === 'club_admin' || u.role === 'admin' || u._activeRole === 'club_admin' ||
                (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'club_admin' || r.role === 'admin') && r.status !== 'rejected')));
            // También por _addAdmin: es la ÚNICA puerta donde se filtra al
            // SuperAdmin, y _cGetStaff lo incluye si figura como staff del club.
            [...staffList, ...firestoreAdmins].forEach(u => _addAdmin(u.uid || u.id, u));
            contacts = Array.from(byUid.values());
            }
        }
        // ════════════════════════════════════════════════════════════
        // CASO 3: COORDINADOR (tabs: director, coaches)
        // ════════════════════════════════════════════════════════════
        else if (window._umState.role === 'coordinator') {
            if (tabId === 'director') {
                if (typeof loadEmailConfig === 'function') await loadEmailConfig();
                const manualContacts = (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts)) ? emailConfig.contacts : [];
                const staffList = await _cGetStaff(db, clubId, fns, ['director', 'club_admin', 'admin']);
                
                const byUid = new Map();
                const firestoreDirs = clubUsers.filter(u => {
                    return u.role === 'director' || u._activeRole === 'director' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'director' || r.role === 'club_admin' || r.role === 'admin') && r.status !== 'rejected'));
                });
                [...staffList, ...firestoreDirs].forEach(u => {
                    const uid = u.uid || u.id;
                    if (uid && !byUid.has(uid)) {
                        byUid.set(uid, {
                            id: uid, uid,
                            name: u.displayName || u.name || u.email || 'Director Deportivo',
                            subtitle: `Director Deportivo · ${u.email || ''}`,
                            email: u.email || '', phone: u.phone || '',
                            roleTag: 'director', icon: '📋'
                        });
                    }
                });

                manualContacts.filter(c => c.type !== 'parent' && (c.role === 'director' || !c.role || (c.tags || []).includes('msj'))).forEach(c => {
                    const uid = c.uid || c.id || c.email;
                    if (uid && !byUid.has(uid)) {
                        byUid.set(uid, {
                            id: uid, uid: c.uid || uid,
                            name: c.name || c.displayName || c.email || 'Director Deportivo',
                            subtitle: `Director Deportivo · ${c.email || ''}`,
                            email: c.email || '', phone: c.phone || '',
                            roleTag: 'director', icon: '📋'
                        });
                    }
                });

                contacts = Array.from(byUid.values());
            }
            else if (tabId === 'coaches') {
                const coordType = me.coordinatorType || me.requestedCoordinatorType || (Array.isArray(me.allRoles) ? (me.allRoles.find(r => r.role === 'coordinator') || {}).coordinatorType : '') || '';
                contacts = clubUsers.filter(u => {
                    const isCoach = u.role === 'user' || u.role === 'coach' || u._activeRole === 'coach' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'user' || r.role === 'coach') && r.status !== 'rejected'));
                    if (!isCoach) return false;
                    const coachCat = u.category || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).category : '');
                    return _coordinatorCoversCoach(coordType, coachCat);
                }).map(u => {
                    const cat = u.category || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).category : '') || 'Sin cat.';
                    const sub = u.subcategory || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).subcategory : '') || '';
                    return {
                        id: u.uid, uid: u.uid,
                        name: u.displayName || u.name || u.email || 'Entrenador',
                        subtitle: `Entrenador (${_normCat(cat).toUpperCase()} ${sub}) · ${u.email || ''}`,
                        email: u.email || '', phone: u.phone || '',
                        roleTag: 'coach', icon: '⚽'
                    };
                });
                if (coordType) {
                    filterText = `🎯 Ámbito del coordinador: <strong style="color:#58a6ff;">${coordType.toUpperCase()}</strong>`;
                }
            }
        }
        // ════════════════════════════════════════════════════════════
        // CASO 4: PADRE (tabs: coach)
        // ════════════════════════════════════════════════════════════
        else if (window._umState.role === 'parent') {
            if (tabId === 'coach') {
                let parentCat = me.category || me.categoryLabel || '';
                let parentSub = me.subcategory || '';

                if (!parentCat && Array.isArray(me.allRoles)) {
                    const pRole = me.allRoles.find(r => r.role === 'parent' || r.role === 'parent_individual');
                    if (pRole) {
                        parentCat = pRole.category || pRole.categoryLabel || '';
                        parentSub = pRole.subcategory || '';
                    }
                }

                if (!parentCat && clubId) {
                    try {
                        const linkSnap = await getDocs(query(
                            collection(db, 'cronos_player_links'),
                            where('parentUid', '==', me.uid),
                            where('clubId', '==', clubId)
                        ));
                        linkSnap.forEach(ld => {
                            const data = ld.data();
                            if (data.category) parentCat = data.category;
                            if (data.subcategory) parentSub = data.subcategory;
                        });
                    } catch(_) {}
                }

                contacts = clubUsers.filter(u => {
                    const isCoach = u.role === 'user' || u.role === 'coach' || u._activeRole === 'coach' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'user' || r.role === 'coach') && r.status !== 'rejected'));
                    if (!isCoach) return false;
                    const coachCat = u.category || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).category : '');
                    const coachSub = u.subcategory || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).subcategory : '');
                    if (parentCat) {
                        return _catAndSubcatMatch(parentCat, parentSub, coachCat, coachSub);
                    }
                    return true;
                }).map(u => {
                    const cCat = u.category || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).category : '') || 'Sin cat.';
                    const cSub = u.subcategory || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).subcategory : '') || '';
                    return {
                        id: u.uid, uid: u.uid,
                        name: u.displayName || u.name || u.email || 'Entrenador',
                        subtitle: `Entrenador (${_normCat(cCat).toUpperCase()} ${cSub}) · ${u.email || ''}`,
                        email: u.email || '', phone: u.phone || '',
                        roleTag: 'coach', icon: '⚽'
                    };
                });

                if (parentCat) {
                    filterText = `⚽ Entrenador asignado a tu equipo: <strong style="color:#58a6ff;">${_normCat(parentCat).toUpperCase()} ${parentSub.toUpperCase()}</strong>`;
                }
            }
        }
        // ════════════════════════════════════════════════════════════
        // CASO 5 y 6: ADMINISTRADOR DE CLUB / ADMINISTRADOR INDIVIDUAL
        //  (implementar.txt 2026-07-30 — cerrar la red de comunicación)
        //  club_admin:       tabs director   + superadmin
        //  admin_individual: tabs coaches    + superadmin
        // ════════════════════════════════════════════════════════════
        else if (window._umState.role === 'club_admin' || window._umState.role === 'admin_individual') {
            // El SuperAdmin NO pertenece al club, así que no sale de clubUsers:
            // hay que buscarlo por rol en toda la colección.
            if (tabId === 'superadmin') {
                const byUid = new Map();
                try {
                    const saSnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'superadmin')));
                    saSnap.forEach(d => {
                        const u = d.data();
                        byUid.set(d.id, {
                            id: d.id, uid: d.id,
                            name: u.displayName || u.email || 'SuperAdmin',
                            subtitle: `SuperAdmin · ${u.email || ''}`,
                            email: u.email || '', phone: u.phone || '',
                            roleTag: 'superadmin', icon: '👑'
                        });
                    });
                } catch (_) { /* sin permiso o sin red: lista vacía, no se rompe */ }
                contacts = Array.from(byUid.values());
                filterText = '👑 Canal directo con el SuperAdmin de la plataforma';
            }
            // Director Deportivo del club (sólo Administrador de Club).
            else if (tabId === 'director') {
                const byUid = new Map();
                const staffList = await _cGetStaff(db, clubId, fns, ['director']);
                const firestoreDirs = clubUsers.filter(u =>
                    u.role === 'director' || u._activeRole === 'director' ||
                    (Array.isArray(u.allRoles) && u.allRoles.some(r => r && r.role === 'director' && r.status !== 'rejected')));
                [...staffList, ...firestoreDirs].forEach(u => {
                    const uid = u.uid || u.id;
                    if (uid && !byUid.has(uid)) {
                        byUid.set(uid, {
                            id: uid, uid,
                            name: u.displayName || u.name || u.email || 'Director Deportivo',
                            subtitle: `Director Deportivo · ${u.email || ''}`,
                            email: u.email || '', phone: u.phone || '',
                            roleTag: 'director', icon: '📋'
                        });
                    }
                });
                contacts = Array.from(byUid.values());
            }
            // Entrenador (sólo Administrador Individual: es su ente técnico).
            else if (tabId === 'coaches') {
                const byUid = new Map();
                clubUsers.filter(u =>
                    u.role === 'user' || u.role === 'coach' || u._activeRole === 'coach' ||
                    (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'user' || r.role === 'coach' || r.role === 'entrenador_individual') && r.status !== 'rejected'))
                ).forEach(u => {
                    const uid = u.uid || u.id;
                    if (uid && !byUid.has(uid)) {
                        byUid.set(uid, {
                            id: uid, uid,
                            name: u.displayName || u.name || u.email || 'Entrenador',
                            subtitle: `Entrenador · ${u.email || ''}`,
                            email: u.email || '', phone: u.phone || '',
                            roleTag: 'coach', icon: '⚽'
                        });
                    }
                });
                contacts = Array.from(byUid.values());
            }
        }

        window._umState.contacts = contacts;

        if (badgeEl) {
            if (filterText) {
                badgeEl.innerHTML = filterText;
                badgeEl.style.display = 'block';
            } else {
                badgeEl.style.display = 'none';
            }
        }

        if (!contacts.length) {
            listEl.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);padding:3rem 1rem;font-size:0.85rem;">
                👥 No se encontraron destinatarios en esta categoría/sección.
            </div>`;
            return;
        }

        // Renderizar filas de contactos
        listEl.innerHTML = contacts.map(c => {
            // FIX (conexión entre roles): usar el contexto CANÓNICO, no la pestaña
            // cruda. La misma relación (p.ej. entrenador<->director) se ve desde
            // pestañas con nombres distintos según quién mire ('director' en el
            // panel del entrenador, 'coaches' en el panel del director); sin
            // canonicalizar, cada lado calculaba un id distinto para el MISMO hilo.
            const threadId = _cThreadId(me.uid, c.uid, _getCanonicalContext(window._umState.role, tabId));
            const thread = threadsMap[threadId] || threadsMap[`${me.uid}_${c.uid}`] || threadsMap[`${c.uid}_${me.uid}`] || {};
            const unread = thread.unreadByCoach || thread.unreadByParent || thread.unreadByStaff || 0;
            const lastMsg = thread.lastMessage || '— Sin mensajes —';
            const lastTime = thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
            const isChecked = window._umState.checkedUids.has(c.uid);
            const isSelected = window._umState.selectedContact && window._umState.selectedContact.uid === c.uid;

            return `
            <div style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0.75rem;
                        background:${isSelected ? 'rgba(88,166,255,0.15)' : unread ? 'rgba(88,166,255,0.06)' : 'var(--glass)'};
                        border:1px solid ${isSelected ? 'var(--primary)' : unread ? 'rgba(88,166,255,0.4)' : 'var(--glass-border)'};
                        border-radius:10px;cursor:pointer;transition:all 0.15s;"
                 onclick="_selectUnifiedContact('${c.uid}')">
                <input type="checkbox" style="width:16px;height:16px;accent-color:var(--primary);flex-shrink:0;"
                    ${isChecked ? 'checked' : ''}
                    onclick="event.stopPropagation(); _toggleCheckContact('${c.uid}', this.checked)">
                <div style="width:34px;height:34px;border-radius:50%;background:rgba(88,166,255,0.12);
                            display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">
                    ${c.icon}
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.84rem;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${typeof escapeHtml==='function'?escapeHtml(c.name):c.name}
                        ${unread > 0 ? `<span style="background:var(--primary);color:#0a0e14;border-radius:8px;padding:1px 6px;font-size:0.6rem;font-weight:800;margin-left:4px;">${unread}</span>` : ''}
                    </div>
                    <div style="font-size:0.68rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${typeof escapeHtml==='function'?escapeHtml(c.subtitle):c.subtitle}
                    </div>
                    <div style="font-size:0.72rem;color:${unread ? 'var(--primary)' : 'var(--text-muted)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:0.1rem;">
                        ${unread ? `<strong>🔵 ${typeof escapeHtml==='function'?escapeHtml(lastMsg):lastMsg}</strong>` : (typeof escapeHtml==='function'?escapeHtml(lastMsg):lastMsg)}
                    </div>
                </div>
                <span style="font-size:0.64rem;color:var(--text-muted);flex-shrink:0;">${lastTime}</span>
            </div>`;
        }).join('');

    } catch(err) {
        console.error('Error cargando contactos unificados:', err);
        listEl.innerHTML = `<div style="text-align:center;color:#ff5858;padding:2rem;">⚠️ Error al cargar destinatarios.</div>`;
    }
}

// ── Maestro-detalle móvil: lista <-> chat ────────────────────────────
// Un único punto que pone/quita la clase, para que no se abra un segundo sitio
// que la escriba y se descoordinen (la lección del "solo punto de alta").
function _umSetShowingChat(on) {
    const split = document.getElementById('um-split');
    if (!split) return;
    split.classList.toggle('um-showing-chat', !!on);
}

// Botón "← Contactos" del chat: SOLO visible en móvil (lo esconde el CSS en
// pantallas anchas). No toca la pila de navegación de la app: es un movimiento
// interno del panel, no una pantalla, igual que cambiar de pestaña.
function _umBackToList() {
    _umSetShowingChat(false);
}

// ── Seleccionar contacto y cargar hilo en columna derecha ────────────
async function _selectUnifiedContact(uid) {
    const contact = window._umState.contacts.find(c => c.uid === uid);
    if (!contact) return;
    window._umState.selectedContact = contact;

    // 📱 Maestro-detalle en móvil: al abrir un contacto se muestra el chat y se
    // esconde la lista. En pantallas anchas la clase no hace NADA (el CSS solo
    // la mira dentro del @media <=950px), así que el split de dos columnas del
    // PC/iPad no cambia ni un píxel.
    _umSetShowingChat(true);

    // Recargar lista izquierda para resaltar fila seleccionada
    _loadUnifiedContactList(window._umState.activeTab);

    const chatView = document.getElementById('um-chat-view');
    if (!chatView) return;

    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    // FIX (conexión entre roles): contexto canónico, no la pestaña cruda (ver nota en _loadUnifiedContactList).
    const threadId = _cThreadId(me.uid, contact.uid, _getCanonicalContext(window._umState.role, window._umState.activeTab));

    chatView.innerHTML = `
    <!-- Header del Hilo Seleccionado -->
    <div style="padding:0.8rem 1.2rem;background:#161b22;border-bottom:1px solid var(--glass-border);
                display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:0.5rem;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:0.7rem;min-width:0;">
            <button class="um-back-btn" onclick="_umBackToList()" title="Volver a la lista de contactos"
                style="display:none;flex-shrink:0;background:rgba(255,255,255,0.06);border:1px solid var(--glass-border);
                       border-radius:8px;color:var(--primary);font-size:0.95rem;font-weight:700;
                       min-width:44px;min-height:44px;cursor:pointer;padding:0 0.6rem;">←</button>
            <div style="width:38px;height:38px;border-radius:50%;background:rgba(88,166,255,0.15);
                        display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">
                ${contact.icon}
            </div>
            <div style="min-width:0;">
                <div style="font-weight:700;font-size:0.92rem;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${typeof escapeHtml==='function'?escapeHtml(contact.name):contact.name}
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    ${typeof escapeHtml==='function'?escapeHtml(contact.subtitle):contact.subtitle}
                </div>
            </div>
        </div>
        <div style="display:flex;gap:0.4rem;flex-shrink:0;">
            <button onclick="_clearUnifiedThread('${threadId}')" class="btn"
                style="padding:0.32rem 0.65rem;background:rgba(255,88,88,0.12);border:1px solid rgba(255,88,88,0.3);
                       border-radius:6px;color:#ff5858;font-size:0.72rem;font-weight:700;">
                🗑️ Vaciar
            </button>
            ${contact.phone ? `
            <a href="https://wa.me/${contact.phone}" target="_blank"
                style="padding:0.32rem 0.65rem;background:rgba(37,211,102,0.12);border:1px solid rgba(37,211,102,0.4);
                       border-radius:6px;color:#25d366;font-size:0.72rem;text-decoration:none;font-weight:700;">
                📱 WA
            </a>` : ''}
            ${contact.email ? `
            <a href="mailto:${contact.email}"
                style="padding:0.32rem 0.65rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                       border-radius:6px;color:var(--primary);font-size:0.72rem;text-decoration:none;font-weight:700;">
                📧 Email
            </a>` : ''}
        </div>
    </div>

    <!-- Contenedor Mensajes Scrollable -->
    <div id="um-messages-container" style="flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:0.6rem;">
        <p style="color:var(--text-muted);text-align:center;padding:2rem;font-size:0.85rem;">⏳ Cargando mensajes…</p>
    </div>

    <!-- Redactor de Envío -->
    <div id="um-composer" style="padding:0.8rem 1.2rem;background:#161b22;border-top:1px solid var(--glass-border);flex-shrink:0;">
        <div style="display:flex;gap:0.6rem;align-items:flex-end;">
            <textarea id="um-msg-input" class="um-input" placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter para nueva línea)"
                rows="2"
                style="flex:1;padding:0.6rem 0.8rem;background:rgba(255,255,255,0.06);border:1px solid var(--glass-border);
                       border-radius:8px;color:white;font-size:0.88rem;resize:none;box-sizing:border-box;"
                onkeydown="if(event.key==='Enter'&&!event.shiftKey){ event.preventDefault(); _sendUnifiedMessage('${contact.uid}'); }"></textarea>
            <button onclick="_sendUnifiedMessage('${contact.uid}')" class="btn primary"
                style="padding:0.6rem 1.1rem;flex-shrink:0;font-weight:700;">
                Enviar ›
            </button>
        </div>
    </div>`;

    // v429 · Si quien mira es un PADRE sin permiso de envío, el redactor se
    // sustituye por un aviso. Se hace DESPUÉS de pintar y no antes porque la
    // consulta es asíncrona: bloquear el render entero por ella dejaría el
    // hilo en blanco mientras se resuelve, y el padre SIEMPRE puede leer.
    if (window._umState.role === 'parent' &&
        typeof window._cronosParentCanSendMsg === 'function') {
        try {
            const puede = await window._cronosParentCanSendMsg();
            if (!puede) {
                const composer = document.getElementById('um-composer');
                if (composer) {
                    composer.innerHTML = `
                    <div style="display:flex;align-items:center;gap:0.6rem;padding:0.7rem 0.9rem;
                                background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
                                border-radius:8px;color:var(--text-muted);font-size:0.8rem;">
                        <span style="font-size:1.1rem;">🔒</span>
                        <div>
                            <div style="font-weight:700;color:#c9d1d9;">Solo lectura</div>
                            <div style="font-size:0.74rem;">Tu entrenador no ha habilitado el envío de mensajes para ti. Puedes seguir recibiendo los suyos.</div>
                        </div>
                    </div>`;
                }
            }
        } catch(_) { /* falla hacia el "sí": se deja el redactor */ }
    }

    await _loadUnifiedThreadMessages(threadId, contact);
}

// ── Cargar mensajes del hilo activo en la columna derecha ─────────────
async function _loadUnifiedThreadMessages(threadId, contact) {
    const container = document.getElementById('um-messages-container');
    if (!container) return;

    try {
        const { db, doc, getDoc, updateDoc } = await _cFS();
        const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;

        // Buscar doc del hilo en Firestore
        let snap = await getDoc(doc(db, 'cronos_messages', threadId));
        // Fallback a hilo legacy sin tabContext
        if (!snap.exists()) {
            const fallbackId = `${me.uid}_${contact.uid}`;
            const altSnap = await getDoc(doc(db, 'cronos_messages', fallbackId));
            if (altSnap.exists()) snap = altSnap;
        }

        if (!snap.exists() || !snap.data().messages?.length) {
            container.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);padding:3rem 1rem;font-size:0.85rem;">
                💬 Sin mensajes aún. ¡Escribe un mensaje abajo para iniciar la conversación!
            </div>`;
            return;
        }

        const messages = snap.data().messages || [];
        container.innerHTML = messages.map(m => {
            // FIX (cuentas multi-rol, mismo uid físico p.ej. Entrenador=Padre):
            // comparar solo por uid marca TODOS los mensajes del hilo como "míos",
            // porque el uid coincide en ambos roles. Si el mensaje trae senderRole,
            // debe coincidir también con el rol ACTIVO desde el que se está viendo
            // el hilo para diferenciar quién envió qué.
            const isMine = m.senderUid
                ? (m.senderUid === me.uid && (!m.senderRole || m.senderRole === window._umState.role))
                : (m.sender === window._umState.role);
            const time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
            const date = m.timestamp ? new Date(m.timestamp).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
            const isReport = m.type === 'report' || (m.text && m.text.includes('📊'));

            return `
            <div style="display:flex;justify-content:${isMine ? 'flex-end' : 'flex-start'};padding:0 0.2rem;">
                <div style="max-width:78%;background:${isReport ? 'rgba(63,185,80,0.12)' : isMine ? 'rgba(88,166,255,0.18)' : 'rgba(255,159,67,0.16)'};
                            border:1px solid ${isReport ? 'rgba(63,185,80,0.3)' : isMine ? 'rgba(88,166,255,0.3)' : 'rgba(255,159,67,0.4)'};
                            border-radius:12px;padding:0.55rem 0.85rem;position:relative;">
                    <div style="font-size:0.85rem;line-height:1.5;white-space:pre-wrap;color:white;">
                        ${(typeof escapeHtml==='function'?escapeHtml(m.text):m.text).replace(/\*(.*?)\*/g,'<strong>$1</strong>')}
                    </div>
                    <div style="font-size:0.64rem;color:var(--text-muted);text-align:right;margin-top:0.3rem;display:flex;align-items:center;justify-content:flex-end;gap:0.4rem;">
                        <span>${date} ${time} · ${isMine ? 'Tú' : (m.senderRole || contact.name)}</span>
                        <button onclick="_deleteUnifiedMessage('${snap.id}', '${m.timestamp}')"
                            style="background:none;border:none;color:#ff5858;cursor:pointer;font-size:0.7rem;padding:0;opacity:0.6;"
                            title="Borrar mensaje">🗑️</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;

        // Marcar como leídos
        try {
            const updData = {};
            if (window._umState.role === 'coach') updData.unreadByCoach = 0;
            else if (window._umState.role === 'parent') updData.unreadByParent = 0;
            else updData.unreadByStaff = 0;
            await updateDoc(doc(db, 'cronos_messages', snap.id), updData);
        } catch(_) {}

    } catch(e) {
        console.error('Error al cargar mensajes del hilo:', e);
        container.innerHTML = `<div style="text-align:center;color:#ff5858;padding:2rem;">⚠️ Error al cargar el hilo de chat.</div>`;
    }
}

// ── Enviar Mensaje Individual ─────────────────────────────────────────
async function _sendUnifiedMessage(recipientUid) {
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    if (!me) return;

    const input = document.getElementById('um-msg-input');
    const text = (input?.value || '').trim();
    if (!text) return;

    // v429 · Segundo cerrojo del permiso de envío del padre. El primero es
    // visual (se retira el redactor); éste es el que de verdad impide la
    // escritura, porque el redactor puede seguir en pantalla si la consulta
    // llegó tarde o si el permiso cambió mientras el hilo estaba abierto.
    if (window._umState.role === 'parent' &&
        typeof window._cronosParentCanSendMsg === 'function') {
        const puede = await window._cronosParentCanSendMsg();
        if (!puede) {
            if (typeof showToast === 'function') {
                showToast('🔒 Tu entrenador no ha habilitado el envío de mensajes para ti.', 4000);
            }
            return;
        }
    }

    // FIX (conexión entre roles): contexto canónico, no la pestaña cruda (ver nota en _loadUnifiedContactList).
    const tabContext = _getCanonicalContext(window._umState.role, window._umState.activeTab);
    const threadId = _cThreadId(me.uid, recipientUid, tabContext);
    const { db, doc, getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();

    const newMsg = {
        senderUid: me.uid,
        senderRole: window._umState.role,
        text,
        timestamp: new Date().toISOString()
    };

    const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

    try {
        const snap = await getDoc(doc(db, 'cronos_messages', threadId));
        if (snap.exists()) {
            await updateDoc(doc(db, 'cronos_messages', threadId), {
                messages: arrayUnion(newMsg),
                lastMessage: preview,
                lastMessageAt: newMsg.timestamp,
                unreadByCoach: window._umState.role !== 'coach' ? (snap.data().unreadByCoach || 0) + 1 : 0,
                unreadByParent: window._umState.role !== 'parent' ? (snap.data().unreadByParent || 0) + 1 : 0,
                unreadByStaff: (window._umState.role !== 'director' && window._umState.role !== 'coordinator') ? (snap.data().unreadByStaff || 0) + 1 : 0
            });
        } else {
            await setDoc(doc(db, 'cronos_messages', threadId), {
                threadId,
                clubId: me.clubId || null,
                participants: [me.uid, recipientUid],
                tabContext,
                coachUid: window._umState.role === 'coach' ? me.uid : recipientUid,
                parentUid: window._umState.role === 'parent' ? me.uid : recipientUid,
                staffUid: (window._umState.role === 'director' || window._umState.role === 'coordinator') ? me.uid : recipientUid,
                messages: [newMsg],
                lastMessage: preview,
                lastMessageAt: newMsg.timestamp,
                unreadByCoach: window._umState.role !== 'coach' ? 1 : 0,
                unreadByParent: window._umState.role !== 'parent' ? 1 : 0,
                unreadByStaff: (window._umState.role !== 'director' && window._umState.role !== 'coordinator') ? 1 : 0
            });
        }

        if (input) input.value = '';
        const contact = window._umState.contacts.find(c => c.uid === recipientUid) || { uid: recipientUid, name: 'Contacto' };
        await _loadUnifiedThreadMessages(threadId, contact);
        // FIX: refrescar la lista con la pestaña CRUDA (window._umState.activeTab),
        // no con tabContext (contexto canónico usado para el threadId) — _loadUnifiedContactList
        // espera el id de pestaña real ('parents'/'director'/'coordinator'/'coaches'/'coach'...).
        _loadUnifiedContactList(window._umState.activeTab);

    } catch(e) {
        console.error('Error enviando mensaje:', e);
        if (typeof showToast === 'function') showToast('⚠️ Error al enviar: ' + e.message, 4000);
    }
}

// ── Checkboxes y Selección Múltiple (Envío Grupal) ────────────────────
function _toggleCheckContact(uid, isChecked) {
    if (isChecked) window._umState.checkedUids.add(uid);
    else window._umState.checkedUids.delete(uid);
    _updateUnifiedBulkCount();
}

function _toggleSelectAllUnified(isChecked) {
    window._umState.checkedUids.clear();
    if (isChecked) {
        window._umState.contacts.forEach(c => window._umState.checkedUids.add(c.uid));
    }
    const listEl = document.getElementById('um-contact-list');
    if (listEl) {
        listEl.querySelectorAll('input[type="checkbox"]').forEach(chk => chk.checked = isChecked);
    }
    _updateUnifiedBulkCount();
}

function _updateUnifiedBulkCount() {
    const countEl = document.getElementById('um-bulk-count');
    if (countEl) {
        const count = window._umState.checkedUids.size;
        countEl.textContent = `${count} seleccionado${count !== 1 ? 's' : ''}`;
    }
}

async function _openUnifiedBulkComposer() {
    const count = window._umState.checkedUids.size;
    if (!count) {
        if (typeof showToast === 'function') showToast('⚠️ Selecciona al menos un destinatario con el checkbox.', 3000);
        return;
    }

    const text = prompt(`Escribe el mensaje grupal para los ${count} destinatarios seleccionados:`);
    if (!text || !text.trim()) return;

    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    if (!me) return;

    if (typeof showSpinner === 'function') showSpinner(`Enviando mensaje a ${count} destinatarios…`);
    let sentCount = 0;

    for (const recipientUid of Array.from(window._umState.checkedUids)) {
        try {
            // FIX (conexión entre roles): contexto canónico, no la pestaña cruda (ver nota en _loadUnifiedContactList).
            const tabContext = _getCanonicalContext(window._umState.role, window._umState.activeTab);
            const threadId = _cThreadId(me.uid, recipientUid, tabContext);
            const { db, doc, getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();

            const newMsg = {
                senderUid: me.uid,
                senderRole: window._umState.role,
                text: text.trim(),
                timestamp: new Date().toISOString()
            };

            const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;
            const snap = await getDoc(doc(db, 'cronos_messages', threadId));

            if (snap.exists()) {
                await updateDoc(doc(db, 'cronos_messages', threadId), {
                    messages: arrayUnion(newMsg),
                    lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByCoach: window._umState.role !== 'coach' ? (snap.data().unreadByCoach || 0) + 1 : 0,
                    unreadByParent: window._umState.role !== 'parent' ? (snap.data().unreadByParent || 0) + 1 : 0,
                    unreadByStaff: (window._umState.role !== 'director' && window._umState.role !== 'coordinator') ? (snap.data().unreadByStaff || 0) + 1 : 0
                });
            } else {
                await setDoc(doc(db, 'cronos_messages', threadId), {
                    threadId,
                    clubId: me.clubId || null,
                    participants: [me.uid, recipientUid],
                    tabContext,
                    coachUid: window._umState.role === 'coach' ? me.uid : recipientUid,
                    parentUid: window._umState.role === 'parent' ? me.uid : recipientUid,
                    staffUid: (window._umState.role === 'director' || window._umState.role === 'coordinator') ? me.uid : recipientUid,
                    messages: [newMsg],
                    lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByCoach: window._umState.role !== 'coach' ? 1 : 0,
                    unreadByParent: window._umState.role !== 'parent' ? 1 : 0,
                    unreadByStaff: (window._umState.role !== 'director' && window._umState.role !== 'coordinator') ? 1 : 0
                });
            }
            sentCount++;
        } catch(e) { console.error('Error enviando grupal a', recipientUid, e); }
    }

    if (typeof hideSpinner === 'function') hideSpinner();
    if (typeof showToast === 'function') showToast(`✅ Mensaje enviado a ${sentCount} destinatario${sentCount !== 1 ? 's' : ''}`, 4000);

    window._umState.checkedUids.clear();
    const chkAll = document.getElementById('um-chk-all');
    if (chkAll) chkAll.checked = false;
    _loadUnifiedContactList(window._umState.activeTab);
}

// ── Vaciar Hilo Completo ──────────────────────────────────────────────
async function _clearUnifiedThread(threadId) {
    // FIX (auditoría): vaciar un hilo es irreversible y borra también los
    // mensajes escritos por la OTRA parte (p.ej. familia<->entrenador de un
    // menor). Antes se sobrescribía `messages: []` sin dejar rastro de quién
    // lo hizo ni cuándo. Ahora se archiva el contenido en deletedMessagesLog
    // (borrado LÓGICO, no destructivo) antes de vaciar.
    if (!confirm('¿Seguro que quieres borrar todo el historial de mensajes de esta conversación? Esta acción no se puede deshacer para ti, pero queda registrada.')) return;
    try {
        const { db, doc, getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();
        const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
        const contact = window._umState.selectedContact;

        let targetId = threadId;
        if (contact && me) {
            const res = await _resolveThreadDoc(db, me.uid, contact.uid, window._umState.role, window._umState.activeTab, me.clubId);
            if (res && res.id) targetId = res.id;
        }

        const docRef = doc(db, 'cronos_messages', targetId);
        let prevMessages = [];
        try {
            const snap = await getDoc(docRef);
            if (snap.exists() && Array.isArray(snap.data().messages)) prevMessages = snap.data().messages;
        } catch(_) {}

        const clearPayload = {
            messages: [],
            lastMessage: '',
            lastMessageAt: '',
            deletedMessagesLog: arrayUnion({
                deletedBy:      (me && me.uid)   || null,
                deletedByEmail: (me && me.email) || null,
                deletedByRole:  window._umState.role,
                deletedAt:      new Date().toISOString(),
                messageCount:   prevMessages.length,
                messages:       prevMessages,
            }),
        };

        try {
            await updateDoc(docRef, clearPayload);
        } catch (updErr) {
            if (contact && me) {
                await setDoc(docRef, {
                    threadId: targetId,
                    clubId: me.clubId || null,
                    participants: [me.uid, contact.uid],
                    ...clearPayload,
                }, { merge: true });
            } else {
                throw updErr;
            }
        }

        if (typeof showToast === 'function') showToast('🗑️ Hilo de chat vaciado.', 3000);
        if (contact) {
            await _selectUnifiedContact(contact.uid);
        }
    } catch(e) {
        console.error('Error al vaciar hilo:', e);
        if (typeof showToast === 'function') showToast('⚠️ Error al vaciar: ' + (e.message || e), 4000);
    }
}

// ── Borrar Mensaje Individual ─────────────────────────────────────────
async function _deleteUnifiedMessage(threadId, timestamp) {
    if (!confirm('¿Eliminar este mensaje?')) return;
    try {
        const { db, doc, getDoc, updateDoc, setDoc } = await _cFS();
        const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
        const contact = window._umState.selectedContact;
        
        let targetId = threadId;
        if (contact && me) {
            const res = await _resolveThreadDoc(db, me.uid, contact.uid, window._umState.role, window._umState.activeTab, me.clubId);
            if (res && res.id) targetId = res.id;
        }

        const snap = await getDoc(doc(db, 'cronos_messages', targetId));
        if (snap.exists()) {
            const msgs = (snap.data().messages || []).filter(m => m.timestamp !== timestamp);
            const lastMsg = msgs.length ? (msgs[msgs.length - 1].text || '') : '';
            const lastT = msgs.length ? (msgs[msgs.length - 1].timestamp || '') : '';
            try {
                await updateDoc(doc(db, 'cronos_messages', targetId), {
                    messages: msgs,
                    lastMessage: lastMsg.length > 60 ? lastMsg.substring(0,60)+'…' : lastMsg,
                    lastMessageAt: lastT
                });
            } catch (updErr) {
                await setDoc(doc(db, 'cronos_messages', targetId), {
                    messages: msgs,
                    lastMessage: lastMsg.length > 60 ? lastMsg.substring(0,60)+'…' : lastMsg,
                    lastMessageAt: lastT
                }, { merge: true });
            }
            if (contact) {
                _loadUnifiedThreadMessages(targetId, contact);
            }
        }
    } catch(e) {
        console.error('Error al borrar mensaje:', e);
        if (typeof showToast === 'function') showToast('⚠️ Error al borrar mensaje: ' + (e.message || e), 4000);
    }
}

// Exposición global de funciones unificadas
window._switchUnifiedTab = _switchUnifiedTab;
window._loadUnifiedContactList = _loadUnifiedContactList;
window._selectUnifiedContact = _selectUnifiedContact;
window._umBackToList = _umBackToList;
window._toggleCheckContact = _toggleCheckContact;
window._toggleSelectAllUnified = _toggleSelectAllUnified;
window._openUnifiedBulkComposer = _openUnifiedBulkComposer;
window._sendUnifiedMessage = _sendUnifiedMessage;
window._clearUnifiedThread = _clearUnifiedThread;
window._deleteUnifiedMessage = _deleteUnifiedMessage;

// Fallbacks de compatibilidad legacy
window._loadParentList = () => _loadUnifiedContactList('parents');
window._loadStaffList = () => _loadUnifiedContactList('director');
window.openThreadWithParent = (uid) => _selectUnifiedContact(uid);
window.openThreadWithStaff = (uid) => _selectUnifiedContact(uid);
window.sendCoachMessage = (threadId, recipientUid) => _sendUnifiedMessage(recipientUid);


// ════════════════════════════════════════════════════════════════════
//  ENVIAR INFORMES DE PARTIDO — CAMINO MANUAL
//  (sendMatchReportsToParents / buildConvocationRecipientsHTML /
//   saveMatchReportPreselection / _buildGlobalReportText /
//   _buildIndividualReportText / _executeReportsSend)
//  Extraídas a js/coach/comms/match-reports-send.js (auditoría
//  2026-07-22, 2026-07-27). Ese archivo usa siete helpers que siguen
//  aquí: _cFS, _cMatchSubcatFor, _cMyTeamKey, _cResolveClubId,
//  _cStaffThreadId, _cronosResolveParentReportTargets y
//  _parseHistoryForFirestore. El camino AUTOMÁTICO sigue justo debajo.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  DESPACHO AUTOMÁTICO DE INFORMES
//  (autoDispatchMatchReports / saveAllMatchReportsInternal)
//  Extraídas a js/coach/comms/match-reports-auto.js (auditoría
//  2026-07-22, 2026-07-27). Ese archivo usa siete helpers que siguen
//  aquí: _cGetStaff, _cMatchSubcatFor, _cMyTeamKey, _cResolveClubId,
//  _cStaffThreadId, _cronosResolveParentReportTargets y
//  _parseHistoryForFirestore. El camino MANUAL está en
//  js/coach/comms/match-reports-send.js.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  GESTIÓN DE CONTACTOS (Teléfonos WhatsApp)
//  (openContactManager / saveContactManagerData / renderContactRowMarkup
//   / renderParentRowMarkup / addNewContactRow / addNewParentRow)
//  Extraídas a js/coach/comms/contact-manager.js (auditoría 2026-07-22,
//  2026-07-27). Ese archivo usa _cFS, _cGetStaff, _catAndSubcatMatch,
//  _loadParentList y openUnifiedCommsMenu, que siguen aquí.
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
//  NOTIFICACIÓN DE ENTRENAMIENTO
//  (openTrainingNotification / _sendTrainingNotification)
//  Extraídas a js/coach/comms/training-notify.js (auditoría 2026-07-22,
//  2026-07-27). Ese archivo llama a openUnifiedCommsMenu(), que sigue aquí.
// ════════════════════════════════════════════════════════════════════

// v429 · Candado de las tarjetas del menú de Comunicaciones.
// Dos helpers en vez de uno porque el atributo (disabled/title) y el icono
// (🔒 en vez del propio) van en sitios distintos del mismo botón, y meterlo
// todo en una cadena obligaría a reescribir el marcado de cada tarjeta.
function _umCardLock(extraKey) {
    const on = (typeof window._cronosExtraEnabled === 'function')
        ? window._cronosExtraEnabled(extraKey) : true;
    // Solo `disabled` + tooltip: el aspecto lo pone .btn-comms-card[disabled]
    // en la hoja de este mismo menú (ver la nota de allí sobre el style doble).
    return on ? '' : 'disabled title="No disponible en el plan de tu club"';
}
function _umCardIcon(extraKey, icon) {
    const on = (typeof window._cronosExtraEnabled === 'function')
        ? window._cronosExtraEnabled(extraKey) : true;
    return on ? icon : '🔒';
}

async function openUnifiedCommsMenu() {
    // v429 · EXTRA 'comunicaciones'. Era el ÚNICO extra del panel del
    // SuperAdmin sin un solo lector en todo el proyecto (censo de v429): se
    // podía apagar y no pasaba absolutamente nada. Este menú es su puerta.
    if (typeof window._cronosExtraGate === 'function' &&
        !window._cronosExtraGate('comunicaciones', 'El área de Comunicaciones')) {
        return;
    }

    // Pila de navegación (js/core/nav-stack.js). Este menú es el ROUTER de
    // área de Comunicaciones, no el motor de mensajería: se apila como una
    // pantalla más. Se entra desde el modal de setup (botón COMUNICACIONES) y
    // desde el post-partido (botón ENVIAR INFORMES), así que su vuelta NO
    // puede ser fija — antes iba siempre a openSetupModal().
    if (typeof navScreen === 'function') navScreen('openUnifiedCommsMenu');

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(95vw,440px);max-height:90vh;display:flex;flex-direction:column;gap:1.1rem;padding:1.6rem;background:linear-gradient(145deg, #0f1218 0%, #0a0e14 100%);border:1px solid rgba(255,255,255,0.1);box-shadow:0 20px 40px rgba(0,0,0,0.6);">
        
        <!-- Encabezado con título y botón de cierre ✕ -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:38px;height:38px;background:rgba(88,166,255,0.1);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;">💬</div>
                <div>
                    <h2 style="margin:0;font-size:1.25rem;font-family:'Outfit',sans-serif;color:white;">Comunicaciones</h2>
                    <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">¿Qué quieres hacer?</div>
                </div>
            </div>
            <div style="display:flex;gap:0.4rem;align-items:center;">
                <!-- ⚠️ TERCERA FORMA DE ESTE BOTÓN, y la definitiva según el autor.
                     Ni navExit() (ronda 2) ni navBack() (v403) servían: los dos
                     dejaban al usuario DENTRO del partido, porque a este menú se
                     entra desde el post-partido y debajo está #main-container con
                     el campo. Lo que pidió es SALIR de ahí, no volver un paso.
                     navExitToRoles() oculta también los contenedores del campo y
                     lleva al selector de roles. No destruye el partido: se oculta,
                     no se vacía, y se recupera con "🔄 RECUPERAR PARTIDO". -->
                <button onclick="if(typeof navExitToRoles==='function') navExitToRoles(); else navExit();"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.7rem;cursor:pointer;line-height:1;padding:0 0.2rem;"
                    title="Salir al selector de roles">✕</button>
            </div>
        </div>

        <!-- Las 4 Opciones Exclusivas del Panel de Comunicaciones -->
        <div style="display:grid;grid-template-columns:1fr;gap:0.8rem;flex:1;overflow-y:auto;padding-right:2px;">

            <!-- 1. MENSAJES · v429: candado si el extra 'mensajeria' está apagado.
                 La tarjeta se sigue viendo (política del autor), en gris y con 🔒. -->
            <button onclick="openCoachMessaging('parents')" class="btn-comms-card"
                ${_umCardLock('mensajeria')}>
                <span class="icon">${_umCardIcon('mensajeria', '💬')}</span>
                <div class="content">
                    <div class="title">Mensajes</div>
                    <div class="desc">Chat con padres · dirección · coordinación</div>
                </div>
            </button>

            <!-- 2. PARTIDOS TERMINADOS -->
            <button onclick="typeof showFinishedMatches==='function'?showFinishedMatches():(typeof openPastMatchesModal==='function'?openPastMatchesModal():alert('No hay partidos terminados'))" class="btn-comms-card" ${_umCardLock('partidos_terminados')} style="--color:#ff5858;--bg:rgba(255,88,88,0.08);">
                <span class="icon">📋</span>
                <div class="content">
                    <div class="title" style="color:#ff5858;">Partidos Terminados</div>
                    <div class="desc">Ver y volver a partidos finalizados</div>
                </div>
            </button>

            <!-- 3. REGISTRAR SUCESOS OFFLINE -->
            <button onclick="if(typeof openOfflineSyncModal==='function') openOfflineSyncModal(); else if(typeof window._cronosOffline !== 'undefined' && typeof window._cronosOffline.showModal === 'function') window._cronosOffline.showModal(); else if(typeof showToast==='function') showToast('ℹ️ No hay sucesos offline pendientes.', 3000);" class="btn-comms-card" style="--color:#58a6ff;--bg:rgba(88,166,255,0.08);">
                <span class="icon">⏱️</span>
                <div class="content">
                    <div class="title" style="color:#58a6ff;">Registrar sucesos offline</div>
                    <div class="desc">Añadir eventos perdidos por falta de batería o cobertura</div>
                </div>
            </button>

            <!-- 4. PARTIDOS EN VIVO -->
            <button onclick="if(typeof showLiveShareModal==='function') showLiveShareModal(); else window.open('./live.html','_blank');" class="btn-comms-card" ${_umCardLock('partidos_en_vivo')} style="--color:#ff5858;--bg:rgba(255,88,88,0.12);">
                <span class="icon">${_umCardIcon('partidos_en_vivo', '🔴')}</span>
                <div class="content">
                    <div class="title" style="color:#ff5858;">Partidos en Vivo</div>
                    <div class="desc">Ver partidos del club en directo</div>
                </div>
            </button>

        </div>

        <!-- Botón Volver Inferior -->
        <button onclick="navBack()"
            style="width:100%;padding:0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);
                   border-radius:10px;color:white;font-weight:700;font-size:0.9rem;cursor:pointer;
                   display:flex;align-items:center;justify-content:center;gap:0.4rem;margin-top:0.3rem;">
            ← Volver
        </button>

    </div>
    <style>
        .btn-comms-card {
            display:flex;align-items:center;gap:14px;padding:0.95rem;
            background:var(--bg,rgba(88,166,255,0.08));
            border:1px solid rgba(255,255,255,0.08);border-radius:13px;
            transition:all 0.22s cubic-bezier(0.4,0,0.2,1);
            cursor:pointer;width:100%;text-decoration:none;color:inherit;
        }
        .btn-comms-card:hover {
            background:var(--bg,rgba(88,166,255,0.15));
            border-color:var(--color,var(--primary));
            transform:translateY(-2px);
            box-shadow:0 6px 18px rgba(0,0,0,0.3);
        }
        .btn-comms-card .icon { font-size:1.6rem; }
        .btn-comms-card .content { text-align:left;flex:1; }
        .btn-comms-card .title  { font-weight:700;color:var(--color,var(--primary));font-size:0.95rem;margin-bottom:2px; }
        .btn-comms-card .desc   { font-size:0.74rem;color:var(--text-muted);line-height:1.3; }
        /* v429 · Tarjeta con el extra apagado: se VE, pero bloqueada.
           Va en CSS y no en un style inline porque dos de las cuatro tarjetas
           ya traen su propio style= con las variables --color/--bg: un segundo
           atributo style en el mismo botón no se suma, gana el primero y se
           perderían esas variables. */
        .btn-comms-card[disabled] {
            opacity:0.45; cursor:not-allowed; filter:grayscale(0.7);
        }
        .btn-comms-card[disabled]:hover {
            background:var(--bg,rgba(88,166,255,0.08));
            border-color:rgba(255,255,255,0.08);
            transform:none; box-shadow:none;
        }
    </style>`;
}

// ════════════════════════════════════════════════════════════════════
//  MENSAJERÍA MASIVA — COMPOSITOR LEGACY
//  (toggleSelectAllParents / updateBulkCount / openBulkMessageComposer /
//   _msgSavePreselection / _msgGetSelected / _sendBulkMsgFirestore /
//   _sendBulkMsgWA / _sendBulkMsgEmail)
//  Extraídas a js/coach/comms/bulk-messaging.js (auditoría 2026-07-22,
//  2026-07-27). Ese archivo usa _cFS y openCoachMessaging, que siguen
//  aquí. OJO: es el antecesor de la familia _um* de ESTE archivo, que es
//  la implementación viva; el compositor extraído no lo abre nadie.
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
//  INFORME COLECTIVO → DIRECTORES Y COORDINADORES
//  (openCollectiveReport / _sendCollectiveReportNow)
//  Extraídas a js/coach/comms/collective-report.js (auditoría 2026-07-22,
//  2026-07-27). Ese archivo usa _cFS, _cGetStaff y openUnifiedCommsMenu,
//  que siguen aquí. OJO: el despacho automático de informes al terminar un
//  partido es autoDispatchMatchReports, que está en ESTE archivo y es una
//  implementación distinta de la de collective-report.js.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  MIS INFORMES / INFORMES INDIVIDUALES → PADRES VINCULADOS
//  (openMisInformes / openIndividualReports / _sendAllIndividualReports)
//  Extraídas a js/coach/comms/individual-reports.js (auditoría 2026-07-22,
//  2026-07-27). Ese archivo usa _cFS, _cMyTeamKey y openUnifiedCommsMenu,
//  que siguen aquí.
// ════════════════════════════════════════════════════════════════════

// publishConvocationToApp: el envío unificado está en 19_whatsapp_email.js (sin duplicados)
window.openCollectiveReport    = window.openCollectiveReport;
window.openIndividualReports   = window.openIndividualReports;
window.openCoachMessaging      = openCoachMessaging;

window.openThreadWithParent    = openThreadWithParent;
window.sendMatchReportsToParents = window.sendMatchReportsToParents;
window._loadThreadMessages     = _loadThreadMessages;
// Estas dos viven ahora en js/coach/comms/contact-manager.js, que se carga
// DESPUES de este archivo. Referenciarlas por su nombre pelado aqui lanzaba
// ReferenceError en tiempo de carga y abortaba el resto de panel.js. Se dejan
// como autoasignacion inocua, igual que las dos de arriba: no hace falta
// exportarlas, porque son declaraciones de funcion y ya cuelgan de window en
// cuanto su archivo se ejecuta.
window.openContactManager      = window.openContactManager;
window.saveContactManagerData  = window.saveContactManagerData;
window.saveAllMatchReportsInternal = window.saveAllMatchReportsInternal;
window.openUnifiedCommsMenu    = openUnifiedCommsMenu;

// ════════════════════════════════════════════════════════════════════
//  FIX (v178): Force re-dispatch — permite reenviar informes del
//  partido actual con el código actualizado, saltándose el guard
//  de idempotencia. Útil cuando el auto-despacho original se ejecutó
//  con una versión anterior del código que no incluía staffUids,
//  parentUid, etc.
//  USO: Ejecutar en la consola del entrenador:
//    window._cronosForceRedispatch()
// ════════════════════════════════════════════════════════════════════
window._cronosForceRedispatch = async function() {
    // Limpiar localStorage
    const keysToRemove = Object.keys(localStorage).filter(k => k.startsWith('cronos_reports_sent_'));
    keysToRemove.forEach(k => localStorage.removeItem(k));
    // Limpiar guard en memoria
    window._cronosLastDispatchedMatch = null;
    window._cronosLastAutoDispatchMatchId = null;
    // Ejecutar auto-dispatch
    try {
        await autoDispatchMatchReports();
    } catch(e) {
        console.error('❌ Force re-dispatch falló:', e);
    }
};

