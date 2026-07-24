// ════════════════════════════════════════════════════════════════════
//  CRONOS FÚTBOL — Sistema de Comunicación Entrenador ↔ Padres v1.0
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
            // Ya es objeto — solo limpiar (preservando subId si el doc ya lo trae)
            pushEvent({ type: e.type, minute: e.minute || 0, second: e.second || 0, timeStr: e.timeStr || '', subId: e.subId || null, note: e.note || '' });
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
        if (type) pushEvent({ type, minute, second, timeStr, subId, note: e });
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
            // FIX v176: Si se resolvió clubId desde allRoles pero el campo raíz
            // clubId del documento users/{uid} está vacío, escribirlo para que
            // las reglas Firestore (userDocClubId) puedan verificarlo sin necesidad
            // de parsear allRoles (las reglas NO pueden iterar arrays arbitrarios).
            if (cid && !d.clubId && fns.updateDoc) {
                try {
                    await fns.updateDoc(fns.doc(db, 'users', me.uid), { clubId: cid });
                } catch (migrateErr) {
                    if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[Cronos] No se pudo migrar clubId al campo raíz:', migrateErr.message);
                }
            }
            return cid;
        }
    } catch (e) {
        if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[Cronos] No se pudo resolver clubId desde Firestore:', e && e.message);
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
//  CRONOS FÚTBOL — SISTEMA DE MENSAJERÍA UNIFICADO E INDEPENDIENTE POR ROL
// ════════════════════════════════════════════════════════════════════

// ── Helpers de normalización y filtrado ─────────────────────────────
function _normCat(raw) {
    if (raw == null) return '';
    let s = String(raw).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    s = s.replace(/^(f7_|f8_|f11_)/, '').replace(/_[abc]$/i, '').replace(/\s+[abc]$/i, '');
    return s.trim();
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
    if (['infantil', 'cadete', 'juvenil', 'regional', 'senior', 'amateur'].includes(c)) return 'f11';
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
    } else if (role === 'coordinator') {
        if (tabId === 'director') return 'director_coordinator';
        if (tabId === 'coaches') return 'coach_coordinator';
    } else if (role === 'parent') {
        if (tabId === 'coach') return 'coach_parent';
    }
    return `${role}_${tabId}`;
}

function _cThreadId(senderUid, recipientUid, tabContext) {
    if (!senderUid || !recipientUid) return '';
    const sorted = [senderUid, recipientUid].sort();
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

// ── MOTOR PRINCIPAL: Renderizado de la Interfaz Unificada ─────────────
async function _renderUnifiedMessagingView(role, tab, targetContainerId) {
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    if (!me) {
        if (typeof showToast === 'function') showToast('⚠️ Inicia sesión para ver los mensajes.', 3000);
        return;
    }

    // Definición de pestañas por rol
    let tabs = [];
    if (role === 'coach') {
        tabs = [
            { id: 'parents', label: 'Padres', icon: '👨‍👩‍👧' },
            { id: 'director', label: 'Director', icon: '📋' },
            { id: 'coordinator', label: 'Coordinador', icon: '🎯' }
        ];
    } else if (role === 'director') {
        tabs = [
            { id: 'coordinators', label: 'Coordinadores', icon: '🎯' },
            { id: 'coaches', label: 'Entrenadores', icon: '⚽' }
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

    const innerHTML = `
    <div class="${isModalMode ? 'modal-content' : 'embedded-comms'}" style="width:100%;height:${isModalMode ? '86vh' : '100%'};max-height:${isModalMode ? '850px' : '100%'};
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
                ${role === 'coach' ? `
                <button onclick="openUnifiedCommsMenu()" class="btn"
                    style="font-size:0.75rem;padding:0.35rem 0.8rem;background:rgba(255,255,255,0.05);color:var(--text-muted);border-radius:6px;">
                    ← Volver
                </button>` : ''}
                <button onclick="_loadUnifiedContactList('${tab}')" class="btn"
                    style="font-size:0.75rem;padding:0.35rem 0.8rem;background:var(--glass);color:var(--text-muted);border-radius:6px;">
                    🔄 Actualizar
                </button>
                ${isModalMode ? `
                <button onclick="if(window._umState && window._umState.role==='coach'){ openUnifiedCommsMenu(); } else if(typeof openStaffDashboard==='function'){ openStaffDashboard(); } else if(typeof openSetupModal==='function'){ openSetupModal(); } else { document.getElementById('setup-modal').style.display='none'; }"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;line-height:1;padding:0 0.3rem;"
                    title="Volver al menú de Comunicaciones">✕</button>
                ` : ''}
            </div>
        </div>

        <!-- Split View Layout -->
        <div style="flex:1;display:flex;min-height:0;overflow:hidden;">

            <!-- Columna Izquierda: Pestañas + Contactos (340px) -->
            <div style="width:340px;min-width:260px;max-width:40%;border-right:1px solid var(--glass-border);
                        display:flex;flex-direction:column;background:rgba(22,27,34,0.4);">
                
                <!-- Pestañas superior izquierda -->
                <div style="display:flex;border-bottom:1px solid var(--glass-border);background:#161b22;flex-shrink:0;">
                    ${tabs.map(t => `
                        <button onclick="_switchUnifiedTab('${t.id}')" id="um-tab-${t.id}"
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
            <div id="um-chat-view" style="flex:1;display:flex;flex-direction:column;background:#0d1117;min-width:0;">
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

// ── Cargar Lista de Contactos y Estados ────────────────────────────────
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
        const { db, collection, getDocs, query, where } = fns;
        const clubId = me.clubId || '';

        // Obtener todos los usuarios del club desde Firestore
        let clubUsers = [];
        if (clubId) {
            try {
                const snap = await getDocs(query(collection(db, 'users'), where('clubId', '==', clubId)));
                snap.forEach(d => {
                    const data = d.data();
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
            } catch(e) { console.warn('[_loadUnifiedContactList] Error usuarios:', e); }
        }

        // Obtener todos los hilos del club para badges e historial
        const threadsSnap = await getDocs(query(collection(db, 'cronos_messages'), where('clubId', '==', clubId))).catch(() => ({ forEach: ()=>{} }));
        const threadsMap = {};
        threadsSnap.forEach(d => { threadsMap[d.id] = { _id: d.id, ...d.data() }; });
        window._umState.threadsMap = threadsMap;

        let contacts = [];
        let filterText = '';

        const coachCategory = me.category || me.categoryLabel || '';
        const coachSubcategory = me.subcategory || '';

        // CASO 1: ENTRENADOR
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
                                _id: c.id || ('m_' + Math.random().toString(36).substr(2,5)),
                                parentUid: c.uid || '', parentEmail: c.email || '', parentPhone: c.phone || '',
                                playerAlias: c.player || c.name || 'Familiar', category: c.category || '', subcategory: c.subcategory || ''
                            });
                        }
                    }
                });

                contacts = rawLinks.filter(l => {
                    const cat = l.category || l.categoryLabel || l.teamName || '';
                    const sub = l.subcategory || '';
                    return _catAndSubcatMatch(coachCategory, coachSubcategory, cat, sub);
                }).map(l => {
                    let resolvedUid = (l.parentUid && l.parentUid.length > 15) ? l.parentUid : null;
                    if (!resolvedUid && l.uid && l.uid.length > 15) resolvedUid = l.uid;
                    if (!resolvedUid && l.parentEmail && Array.isArray(clubUsers)) {
                        const found = clubUsers.find(u => u.email && u.email.trim().toLowerCase() === l.parentEmail.trim().toLowerCase());
                        if (found) resolvedUid = found.uid;
                    }
                    const finalUid = resolvedUid || l.parentUid || l._id;

                    return {
                        id: finalUid, uid: finalUid,
                        name: l.playerAlias || l.playerName || l.parentEmail || 'Padre/Tutor',
                        subtitle: `${l.parentEmail || 'Sin email'} ${l.playerNumber && l.playerNumber !== '—' ? '· #' + l.playerNumber : ''}`,
                        email: l.parentEmail || '', phone: l.parentPhone || l.parentWA || '',
                        roleTag: 'parent', icon: '👨‍👩‍👧', category: l.category || coachCategory, subcategory: l.subcategory || coachSubcategory
                    };
                });

                if (coachCategory) {
                    filterText = `🏷️ Filtro activo: <strong style="color:#58a6ff;">${_normCat(coachCategory).toUpperCase()} ${coachSubcategory}</strong>`;
                }
            }
            else if (tabId === 'director') {
                const staffList = await _cGetStaff(db, clubId, fns, ['director', 'club_admin', 'admin']);
                contacts = staffList.map(u => ({
                    id: u.uid, uid: u.uid,
                    name: u.displayName || u.name || u.email || 'Director Deportivo',
                    subtitle: `Director Deportivo · ${u.email || ''}`,
                    email: u.email || '', phone: u.phone || '',
                    roleTag: 'director', icon: '📋'
                }));
            }
            else if (tabId === 'coordinator') {
                const staffList = await _cGetStaff(db, clubId, fns, ['coordinator', 'coordinador']);
                contacts = staffList.filter(u => {
                    const coordType = u.coordinatorType || u.requestedCoordinatorType || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'coordinator') || {}).coordinatorType : '');
                    return _coordinatorCoversModality(coordType, coachCategory);
                }).map(u => {
                    const coordType = u.coordinatorType || u.requestedCoordinatorType || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'coordinator') || {}).coordinatorType : '') || 'General';
                    return {
                        id: u.uid, uid: u.uid,
                        name: u.displayName || u.name || u.email || 'Coordinador',
                        subtitle: `Coordinador (${coordType.toUpperCase()}) · ${u.email || ''}`,
                        email: u.email || '', phone: u.phone || '',
                        roleTag: 'coordinator', icon: '🎯'
                    };
                });
            }
        }
        // CASO 2: DIRECTOR DEPORTIVO
        else if (window._umState.role === 'director') {
            if (tabId === 'coordinators') {
                const staffList = await _cGetStaff(db, clubId, fns, ['coordinator', 'coordinador']);
                contacts = staffList.map(u => {
                    const coordType = u.coordinatorType || u.requestedCoordinatorType || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'coordinator') || {}).coordinatorType : '') || 'General';
                    return {
                        id: u.uid, uid: u.uid,
                        name: u.displayName || u.name || u.email || 'Coordinador',
                        subtitle: `Coordinador (${coordType.toUpperCase()}) · ${u.email || ''}`,
                        email: u.email || '', phone: u.phone || '',
                        roleTag: 'coordinator', icon: '🎯'
                    };
                });
            }
            else if (tabId === 'coaches') {
                contacts = clubUsers.filter(u => {
                    return u.role === 'user' || u.role === 'coach' || u._activeRole === 'coach' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'user' || r.role === 'coach') && r.status !== 'rejected'));
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
        }
        // CASO 3: COORDINADOR
        else if (window._umState.role === 'coordinator') {
            if (tabId === 'director') {
                const staffList = await _cGetStaff(db, clubId, fns, ['director', 'club_admin', 'admin']);
                contacts = staffList.map(u => ({
                    id: u.uid, uid: u.uid,
                    name: u.displayName || u.name || u.email || 'Director Deportivo',
                    subtitle: `Director Deportivo · ${u.email || ''}`,
                    email: u.email || '', phone: u.phone || '',
                    roleTag: 'director', icon: '📋'
                }));
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
        // CASO 4: PADRE
        else if (window._umState.role === 'parent') {
            if (tabId === 'coach') {
                const parentCat = me.category || me.categoryLabel || '';
                const parentSub = me.subcategory || '';
                contacts = clubUsers.filter(u => {
                    const isCoach = u.role === 'user' || u.role === 'coach' || u._activeRole === 'coach' || (Array.isArray(u.allRoles) && u.allRoles.some(r => r && (r.role === 'user' || r.role === 'coach') && r.status !== 'rejected'));
                    if (!isCoach) return false;
                    const coachCat = u.category || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).category : '');
                    const coachSub = u.subcategory || (Array.isArray(u.allRoles) ? (u.allRoles.find(r => r.role === 'user' || r.role === 'coach') || {}).subcategory : '');
                    return _catAndSubcatMatch(parentCat, parentSub, coachCat, coachSub);
                }).map(u => ({
                    id: u.uid, uid: u.uid,
                    name: u.displayName || u.name || u.email || 'Entrenador',
                    subtitle: `Entrenador de tu categoría · ${u.email || ''}`,
                    email: u.email || '', phone: u.phone || '',
                    roleTag: 'coach', icon: '⚽'
                }));
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
                👥 No se encontraron destinatarios en esta sección.
            </div>`;
            return;
        }

        // Obtener resúmenes de hilos
        const renderedRows = [];
        for (const c of contacts) {
            const res = await _resolveThreadDoc(db, me.uid, c.uid, window._umState.role, tabId, clubId);
            const thread = res.data || {};
            const unread = thread.unreadByCoach || thread.unreadByParent || thread.unreadByStaff || 0;
            const lastMsg = thread.lastMessage || '— Sin mensajes —';
            const lastTime = thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '';
            const isChecked = window._umState.checkedUids.has(c.uid);
            const isSelected = window._umState.selectedContact && window._umState.selectedContact.uid === c.uid;

            renderedRows.push(`
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
            </div>`);
        }

        listEl.innerHTML = renderedRows.join('');

    } catch(err) {
        console.error('Error cargando contactos unificados:', err);
        listEl.innerHTML = `<div style="text-align:center;color:#ff5858;padding:2rem;">⚠️ Error al cargar destinatarios.</div>`;
    }
}

// ── Seleccionar contacto y cargar hilo en columna derecha ────────────
async function _selectUnifiedContact(uid) {
    const contact = window._umState.contacts.find(c => c.uid === uid);
    if (!contact) return;
    window._umState.selectedContact = contact;

    _loadUnifiedContactList(window._umState.activeTab);

    const chatView = document.getElementById('um-chat-view');
    if (!chatView) return;

    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    const { db } = await _cFS();
    const res = await _resolveThreadDoc(db, me.uid, contact.uid, window._umState.role, window._umState.activeTab, me.clubId, contact.email);

    chatView.innerHTML = `
    <!-- Header del Hilo Seleccionado -->
    <div style="padding:0.8rem 1.2rem;background:#161b22;border-bottom:1px solid var(--glass-border);
                display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:0.5rem;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:0.7rem;min-width:0;">
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
            <button onclick="_clearUnifiedThread('${res.id}')" class="btn"
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
    <div style="padding:0.8rem 1.2rem;background:#161b22;border-top:1px solid var(--glass-border);flex-shrink:0;">
        <div style="display:flex;gap:0.6rem;align-items:flex-end;">
            <textarea id="um-msg-input" placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter para nueva línea)"
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

    await _loadUnifiedThreadMessages(res.id, contact);
}

// ── Cargar mensajes del hilo activo en la columna derecha ─────────────
async function _loadUnifiedThreadMessages(threadId, contact) {
    const container = document.getElementById('um-messages-container');
    if (!container) return;

    try {
        const { db, doc, getDoc, updateDoc } = await _cFS();
        const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;

        const snap = await getDoc(doc(db, 'cronos_messages', threadId));

        if (!snap.exists() || !snap.data().messages?.length) {
            container.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);padding:3rem 1rem;font-size:0.85rem;">
                💬 Sin mensajes aún. ¡Escribe un mensaje abajo para iniciar la conversación!
            </div>`;
            return;
        }

        const messages = snap.data().messages || [];
        container.innerHTML = messages.map(m => {
            const isMine = m.senderUid
                ? (m.senderUid === me.uid && (!m.senderRole || m.senderRole === window._umState.role))
                : ((m.sender && m.sender === window._umState.role) || (m.senderRole && m.senderRole === window._umState.role));
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

async function _loadThreadMessages(threadId, perspective) {
    const contact = (window._umState && window._umState.selectedContact) || (window._umState && window._umState.contacts && window._umState.contacts[0]) || { uid: '', name: 'Contacto' };
    return await _loadUnifiedThreadMessages(threadId, contact);
}

// ── Enviar Mensaje Individual ─────────────────────────────────────────
async function _sendUnifiedMessage(recipientUid) {
    const me = window._getEffectiveUser ? window._getEffectiveUser() : window._cronosCurrentUser;
    if (!me) return;

    const input = document.getElementById('um-msg-input');
    const text = (input?.value || '').trim();
    if (!text) return;

    const contact = window._umState.contacts.find(c => c.uid === recipientUid);
    const res = await _resolveThreadDoc(db, me.uid, recipientUid, window._umState.role, tabContext, me.clubId, contact ? contact.email : '');
    const threadId = res.id;

    const newMsg = {
        senderUid: me.uid,
        senderRole: window._umState.role,
        text,
        timestamp: new Date().toISOString()
    };

    const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

    try {
        if (res.snap && res.snap.exists()) {
            await updateDoc(doc(db, 'cronos_messages', threadId), {
                messages: arrayUnion(newMsg),
                lastMessage: preview,
                lastMessageAt: newMsg.timestamp,
                unreadByCoach: window._umState.role !== 'coach' ? (res.snap.data().unreadByCoach || 0) + 1 : 0,
                unreadByParent: window._umState.role !== 'parent' ? (res.snap.data().unreadByParent || 0) + 1 : 0,
                unreadByStaff: (window._umState.role !== 'director' && window._umState.role !== 'coordinator') ? (res.snap.data().unreadByStaff || 0) + 1 : 0
            });
        } else {
            await setDoc(doc(db, 'cronos_messages', threadId), {
                threadId,
                clubId: me.clubId || null,
                participants: [me.uid, recipientUid],
                tabContext: _getCanonicalContext(window._umState.role, tabContext),
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

// ── Cambiar pestaña activa ──────────────────────────────────────────
async function _switchUnifiedTab(tabId) {
    window._umState.activeTab = tabId;
    window._umState.selectedContact = null;
    window._umState.checkedUids.clear();

    const role = window._umState.role;
    let tabs = [];
    if (role === 'coach') tabs = ['parents', 'director', 'coordinator'];
    else if (role === 'director') tabs = ['coordinators', 'coaches'];
    else if (role === 'coordinator') tabs = ['director', 'coaches'];
    else if (role === 'parent') tabs = ['coach'];

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

// ── Seleccionar contacto y cargar hilo en columna derecha ────────────
async function _selectUnifiedContact(uid) {
    const contact = window._umState.contacts.find(c => c.uid === uid);
    if (!contact) return;
    window._umState.selectedContact = contact;

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
    <div style="padding:0.8rem 1.2rem;background:#161b22;border-top:1px solid var(--glass-border);flex-shrink:0;">
        <div style="display:flex;gap:0.6rem;align-items:flex-end;">
            <textarea id="um-msg-input" placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter para nueva línea)"
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
//  ENVIAR INFORMES DE PARTIDO A PADRES Y STAFF
// ════════════════════════════════════════════════════════════════════
async function sendMatchReportsToParents() {
    const isSetupMode = !window.players || !window.players.length;
    let selectedPlayerIds = [];
    let mergedContacts = [];
    let filterCriteria = { ids: [], numbers: [] };

    // 1. Mostrar modal inmediatamente para dar feedback (Cargando...)
    const modal = document.getElementById('setup-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,400px); text-align:center; padding:2rem;">
        <div class="spinner" style="margin:0 auto 1rem;"></div>
        <p style="color:white;font-size:0.9rem;">Cargando lista de destinatarios...</p>
    </div>`;

    try {
        const me = window._cronosCurrentUser;
        if (!me) {
            showToast('⚠️ Usuario no identificado. Por favor, recarga.', 4000);
            modal.style.display = 'none';
            return;
        }

        if (isSetupMode) {
            // 1. Obtener convocados
            const convRows = document.querySelectorAll('.conv-row.conv-selected');
            const roster = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}');
            
            // Intentamos detectar el modo de varias formas (global o por el título si falla)
            let mode = (typeof currentMode !== 'undefined') ? currentMode : (window.currentMode || 'f11');
            
            const selectedPlayers = [];
            convRows.forEach(row => {
                const idx = row.dataset.index;
                let p = roster[mode] ? roster[mode][idx] : null;
                
                // Si no lo encuentra en el modo actual, probamos en el otro (f7 <-> f11)
                if (!p) {
                    const altMode = mode === 'f11' ? 'f7' : 'f11';
                    p = roster[altMode] ? roster[altMode][idx] : null;
                }

                if (p) {
                    selectedPlayers.push(p);
                } else {
                    // FALLBACK MAESTRO: Si no hay datos en el roster, extraemos el número del DOM
                    const numSpan = row.querySelector('span[style*="font-weight:bold"]');
                    const num = numSpan ? parseInt(numSpan.textContent) : null;
                    if (num) {
                        selectedPlayers.push({ id: `J-${idx+1}`, number: num, alias: 'Jugador ' + num });
                    }
                }
            });
            
            // Coleccionamos tanto IDs (J-01) como Números (10) para máxima compatibilidad
            const selectedIds = selectedPlayers.map(p => p.id).filter(Boolean);
            const selectedNums = selectedPlayers.map(p => p.number).filter(n => n != null);


            if (selectedPlayers.length === 0 && convRows.length > 0) {
                // Si hay filas de convocatoria pero no pudimos extraer datos, 
                // hacemos un último intento solo con los números para no bloquear al usuario
                convRows.forEach((row, i) => {
                    const numText = row.innerText.match(/\d+/);
                    if (numText) selectedNums.push(parseInt(numText[0]));
                });
            }

            if (selectedPlayers.length === 0 && selectedNums.length === 0) {
                showToast('⚠️ Primero selecciona jugadores para la convocatoria.', 4000);
                if (typeof openConvocationModal === 'function') openConvocationModal();
                return;
            }

            filterCriteria = { ids: selectedIds, numbers: selectedNums };

            // 2. Obtener TODA la base de contactos (Manuales + Firestore)
            if (typeof loadEmailConfig === 'function') await loadEmailConfig();
            const contacts = (typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : [];
            
            try {
                const { db, collection, getDocs, query, where } = await _cFS();
                const linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('clubId', '==', me.clubId || '')));
                const links = [];
                linksSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

                mergedContacts = [...contacts];
                links.forEach(l => {
                    const exists = mergedContacts.find(c => 
                        (l.parentUid && c.uid === l.parentUid) || 
                        (l.parentEmail && c.email === l.parentEmail) ||
                        (l.parentPhone && c.phone === l.parentPhone)
                    );
                    if (!exists) {
                        mergedContacts.push({
                            id: l._id,
                            type: 'parent',
                            name: l.parentName || l.playerAlias || 'Familiar',
                            player: l.playerAlias || l.playerName || 'Jugador',
                            playerId: l.playerId, 
                            playerNumber: l.playerNumber,
                            uid: l.parentUid,
                            email: l.parentEmail,
                            phone: l.parentPhone,
                            tags: ['rpt']
                        });
                    } else {
                        if (!exists.playerId) exists.playerId = l.playerId;
                        if (!exists.playerNumber) exists.playerNumber = l.playerNumber;
                    }
                });
            } catch (e) {
                console.warn("Reports: Fallback to manual contacts:", e);
                mergedContacts = [...contacts];
            }
        }

        // 3. Renderizar modal oficial (NUEVO DISEÑO PREMIUM)
        modal.innerHTML = `
        <div class="modal-content" style="width:min(96vw,560px);max-height:92vh;
             display:flex;flex-direction:column;gap:0;padding:0;background:#0d1117;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">

            <!-- Header -->
            <div style="padding:1.5rem;background:linear-gradient(to right, #161b22, #0d1117);
                        border-bottom:1px solid var(--glass-border);flex-shrink:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <h3 style="margin:0;font-size:1.2rem;color:var(--primary);display:flex;align-items:center;gap:0.6rem;">
                            📊 Informes de Rendimiento
                        </h3>
                        <p style="margin:0;font-size:0.75rem;color:var(--text-muted);margin-top:0.3rem;">
                            ${isSetupMode ? 'Selección previa para el despacho automático' : 'Envía el reporte del partido a los padres autorizados'}
                        </p>
                    </div>
                    <button onclick="${isSetupMode ? 'openConvocationModal()' : "document.getElementById('setup-modal').style.display='none'"}"
                        style="background:rgba(255,255,255,0.05);border:none;color:var(--text-muted);
                               width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;
                               align-items:center;justify-content:center;transition:all 0.2s;"
                        onmouseover="this.style.background='rgba(255,255,255,0.1)';this.style.color='white';">✕</button>
                </div>
            </div>

            <!-- Content Area -->
            <div style="flex:1;overflow-y:auto;padding:1.5rem;display:flex;flex-direction:column;gap:1.2rem;">
                
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="font-size:0.7rem;font-weight:800;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;">
                        Destinatarios Seleccionados
                    </div>
                    <div style="display:flex;gap:0.5rem;">
                        <button onclick="sharedSelectAll(true, 'rpt')"
                            style="font-size:0.65rem;padding:0.3rem 0.7rem;background:rgba(88,166,255,0.1);
                                   border:1px solid rgba(88,166,255,0.2);border-radius:6px;
                                   color:var(--primary);cursor:pointer;font-weight:600;">✓ Todos</button>
                        <button onclick="sharedSelectAll(false, 'rpt')"
                            style="font-size:0.65rem;padding:0.3rem 0.7rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                                   color:var(--text-muted);cursor:pointer;font-weight:600;">✗ Ninguno</button>
                    </div>
                </div>

                <div id="rpt-recipients-list" style="display:grid;grid-template-columns:1fr;gap:0.6rem;">
                    ${isSetupMode ? buildConvocationRecipientsHTML(filterCriteria, 'rpt', mergedContacts) : sharedBuildRecipientsHTML(null, 'rpt')}
                </div>

                <div style="background:rgba(255,165,0,0.05);border:1px solid rgba(255,165,0,0.1);
                            border-radius:10px;padding:0.8rem;display:flex;gap:0.7rem;align-items:center;">
                    <span style="font-size:1.2rem;">💡</span>
                    <p style="margin:0;font-size:0.72rem;color:#ffb74d;line-height:1.4;">
                        El <strong>Staff Directivo</strong> recibirá un resumen global del partido. Los <strong>Padres</strong> recibirán el informe individual detallado de su hijo/a.
                    </p>
                </div>
            </div>

            <div id="rpt-msg" style="padding:0.5rem 1.5rem;font-size:0.8rem;text-align:center;"></div>

            <!-- Footer Buttons -->
            <div style="padding:1.2rem 1.5rem;background:#161b22;border-top:1px solid var(--glass-border);
                        display:flex;gap:0.8rem;flex-shrink:0;">
                <button onclick="${isSetupMode ? 'openConvocationModal()' : "document.getElementById('setup-modal').style.display='none'"}" 
                    class="btn" style="flex:1;background:rgba(255,255,255,0.03);color:var(--text-muted);border:1px solid var(--glass-border);">
                    Cancelar
                </button>
                ${isSetupMode ? `
                    <button onclick="saveMatchReportPreselection()" class="btn primary"
                        style="flex:2;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.3);
                               color:#3fb950;font-weight:700;box-shadow:0 0 15px rgba(63,185,80,0.1);">
                        💾 GUARDAR CONFIGURACIÓN
                    </button>
                ` : `
                    <button onclick="_executeReportsSend('internal')" class="btn primary"
                        style="flex:1.5;background:var(--primary);color:#0d1117;font-weight:700;">
                        🚀 Enviar ahora
                    </button>
                `}
            </div>
        </div>`;

    } catch (err) {
        console.error("Error in reports modal:", err);
        showToast('⚠️ Error al cargar informes: ' + err.message, 5000);
        modal.style.display = 'none';
    }
}

// Nueva función para filtrar destinatarios SOLO según los convocados
function buildConvocationRecipientsHTML(filterCriteria, prefix = 'rpt', allContacts = null) {
    const contacts = allContacts || ((typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : []);
    const staff = contacts.filter(c => c.type !== 'parent');
    
    const { ids, numbers } = filterCriteria || { ids: [], numbers: [] };

    // Filtramos los padres: solo si su playerId o playerNumber coincide con la convocatoria
    const activeParents = contacts.filter(c => {
        if (c.type !== 'parent') return false;
        
        // 1. Intentar por ID único (J-01, etc)
        const matchById = c.playerId && ids.includes(c.playerId);
        if (matchById) return true;

        // 2. Intentar por Número de dorsal como fallback
        const matchByNum = c.playerNumber != null && numbers.includes(parseInt(c.playerNumber));
        if (matchByNum) return true;

        return false;
    });

    const allToShow = [...staff, ...activeParents];

    if (!allToShow.length) {
        return `<div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:1rem;">
            ⚠️ No hay contactos vinculados a los jugadores convocados.
        </div>`;
    }

    // Cargar preselección guardada
    let savedIds = JSON.parse(localStorage.getItem(`cronos_match_rpt_selection`) || 'null');

    return allToShow.map(c => {
        const checked = savedIds ? savedIds.includes(c.id) : (c.tags || []).includes(prefix);
        const typeIcon = c.type === 'staff' ? '🏢' : '👨‍👩‍👧';
        const typeLabel = c.type === 'staff' ? 'Staff' : 'Padre/Madre';
        const accent = c.type === 'staff' ? 'var(--primary)' : '#f0883e';

        return `
        <label style="display:flex;align-items:center;gap:0.8rem;background:rgba(255,255,255,0.03);
                      border:1px solid ${checked ? accent : 'rgba(255,255,255,0.08)'};
                      border-radius:12px;padding:0.8rem 1rem;cursor:pointer;transition:all 0.2s;
                      ${checked ? `box-shadow:inset 0 0 10px ${accent}1a;` : ''}">
            <input type="checkbox" class="${prefix}-recipient-chk" 
                data-id="${typeof escapeAttr==='function'?escapeAttr(c.id):c.id}"
                data-type="${typeof escapeAttr==='function'?escapeAttr(c.type):c.type}"
                data-phone="${typeof escapeAttr==='function'?escapeAttr(c.phone||''):c.phone||''}"
                data-email="${typeof escapeAttr==='function'?escapeAttr(c.email||''):c.email||''}"
                data-label="${typeof escapeAttr==='function'?escapeAttr(c.name||''):c.name||''}"
                data-playerid="${typeof escapeAttr==='function'?escapeAttr(c.playerId||''):c.playerId||''}"
                data-playernumber="${typeof escapeAttr==='function'?escapeAttr(c.playerNumber||''):c.playerNumber||''}"
                ${checked ? 'checked' : ''}
                style="width:20px;height:20px;accent-color:${accent};">
            
            <div style="flex:1;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.15rem;">
                    <span style="font-weight:700;font-size:0.88rem;color:white;">${typeof escapeHtml==='function'?escapeHtml(c.name||'Sin nombre'):c.name||'Sin nombre'}</span>
                    <span style="font-size:0.6rem;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.05);color:var(--text-muted);font-weight:700;text-transform:uppercase;">
                        ${typeLabel}
                    </span>
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);display:flex;align-items:center;gap:0.4rem;">
                    ${typeIcon} ${c.type === 'staff' ? 'Personal del club' : `Tutor de ${typeof escapeHtml==='function'?escapeHtml(c.player||'Jugador'):c.player||'Jugador'}`}
                    ${c.playerNumber && c.playerNumber !== '—' ? `<span style="color:${accent};font-weight:700;">#${typeof escapeAttr==='function'?escapeAttr(c.playerNumber):c.playerNumber}</span>` : ''}
                </div>
            </div>
        </label>`;
    }).join('');
}

window.saveMatchReportPreselection = function() {
    const ids = Array.from(document.querySelectorAll('.rpt-recipient-chk:checked')).map(chk => chk.dataset.id);
    localStorage.setItem('cronos_match_rpt_selection', JSON.stringify(ids));
    showToast('✅ Configuración de informes guardada para este partido', 3000);
    // En lugar de cerrar el modal, volvemos a la pantalla de convocatoria
    if (typeof openConvocationModal === 'function') {
        openConvocationModal();
    } else {
        document.getElementById('setup-modal').style.display = 'none';
    }
};

// Generador de textos para no duplicar lógica
function _buildGlobalReportText() {
    const scoreHome = document.getElementById('score-home')?.textContent || '0';
    const scoreAway = document.getElementById('score-away')?.textContent || '0';
    const matchDate = new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'});
    const homePlayers = window.players.filter(p => p.team === _cMyTeamKey());
    
    let text = `📊 *RESUMEN GLOBAL DEL PARTIDO*\n━━━━━━━━━━━━━━━━\n`;
    text += `📅 ${matchDate}\n`;
    text += `⚽ ${TEAM_NAMES?.home||'Local'} *${scoreHome}* - *${scoreAway}* ${TEAM_NAMES?.away||'Visitante'}\n━━━━━━━━━━━━━━━━\n\n`;
    
    homePlayers.forEach(p => {
        const cardIcon = p.cards === 'amarilla' ? '🟨' : p.cards === 'roja' ? '🟥' : '—';
        text += `👤 ${p.name} - ${window.formatTime ? window.formatTime(p.time||0) : p.time||0} min\n`;
        text += `   ⚽ Goles: ${p.goals||0} | 🃏 Thrj: ${cardIcon} ${p.injured ? '| 🚑 Lesión' : ''}\n`;
    });
    return text + `\n_Cronos Fútbol · Dirección Deportiva_`;
}

function _buildIndividualReportText(player, scoreHome, scoreAway, matchDate) {
    const cardIcon = player.cards === 'amarilla' ? '🟨 Amarilla' : player.cards === 'roja' ? '🟥 Roja' : '—';
    const minutesPlayed = window.formatTime ? window.formatTime(player.time||0) : player.time||0;
    
    return `📊 *INFORME INDIVIDUAL DE PARTIDO*\n` +
           `━━━━━━━━━━━━━━━━\n` +
           `📅 ${matchDate}\n` +
           `⚽ ${TEAM_NAMES?.home||'Local'} *${scoreHome}* - *${scoreAway}* ${TEAM_NAMES?.away||'Visitante'}\n` +
           `━━━━━━━━━━━━━━━━\n` +
           `👤 *${player.name}* — Dorsal ${player.number}\n\n` +
           `⏱️ Minutos jugados: *${minutesPlayed}*\n` +
           `⚽ Goles: *${player.goals || 0}*\n` +
           `🃏 Tarjetas: *${cardIcon}*\n` +
           (player.injured ? `🚑 *LESIONADO*\n` : '') +
           `━━━━━━━━━━━━━━━━\n` +
           `_Cronos Fútbol · Informe automático_`;
}

// Ejecutor unificado
window._executeReportsSend = async function(method) {
    const me = window._cronosCurrentUser;
    const fa = window._cronos_auth;
    if (!fa || !me) return;

    const recipients = sharedGetSelectedRecipients('rpt');
    if (!recipients.length) {
        showToast('⚠️ Selecciona al menos un destinatario.', 3000);
        return;
    }

    const msgEl = document.getElementById('rpt-msg');
    if (msgEl) {
        msgEl.style.color = 'var(--primary)';
        msgEl.textContent = 'Procesando informes...';
    }

    const { db, collection, getDocs, query, where, doc, getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();

    // Bug 1 (v174): resolver el clubId desde Firestore si el token no lo trae.
    // Sin clubId, las reglas de cronos_messages/notifications/reports rechazan
    // el envío al staff y a los padres. Se cachea en me.clubId para esta sesión.
    const _clubId = await _cResolveClubId(db, me, { doc, getDoc, updateDoc });
    if (_clubId && !me.clubId) me.clubId = _clubId;
    
    // Obtener vínculos con timeout de seguridad y soporte para Admin Individual
    const links = [];
    try {
        const _linksTimeout = new Promise(r => setTimeout(() => r(null), 6000));
        
        // Query base: por clubId
        let linksQuery = query(collection(db, 'cronos_player_links'), where('clubId', '==', me.clubId || '---'));
        
        // Si es admin individual o no hay clubId, buscar por individualOwnerId o coachUid
        if (!me.clubId) {
            linksQuery = query(collection(db, 'cronos_player_links'), where('individualOwnerId', '==', me.uid));
        }

        const linksSnapRaw = await Promise.race([
            getDocs(linksQuery),
            _linksTimeout
        ]);

        if (linksSnapRaw) linksSnapRaw.forEach(d => links.push({ _id: d.id, ...d.data() }));

        // Fallback: si sigue vacío y no hay clubId, probar por coachUid
        if (links.length === 0 && !me.clubId) {
            const fbSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('coachUid', '==', me.uid)));
            fbSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));
        }
    } catch(errLinks) {
        console.warn('[Cronos] Error recuperando vínculos:', errLinks);
    }

    const scoreHome = document.getElementById('score-home')?.textContent || '0';
    const scoreAway = document.getElementById('score-away')?.textContent || '0';
    const rivalName = (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES && TEAM_NAMES.away) ? TEAM_NAMES.away : 'Rival';
    const matchDate = new Date().toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'});
    const homePlayers = window.players.filter(p => p.team === _cMyTeamKey());
    
    const globalText = _buildGlobalReportText();
    let sentCount = 0;

    // ----- MODO WHATSAPP -----
    if (method === 'wa') {
        const toSend = recipients.filter(r => r.phone);
        if (!toSend.length) { showToast('⚠️ Ningún seleccionado con WA configurado.',3000); return; }
        
        toSend.forEach((r, i) => {
            setTimeout(() => {
                let text = globalText;
                if (r.type === 'parent') {
                    // Try to deduce player from label, or use links
                    let matchedPlayer = null;
                    const link = links.find(l => l.parentPhone === r.phone || (l.parentUid && r.id === l.parentUid));
                    if (link) {
                        matchedPlayer = homePlayers.find(p => String(p.number) === String(link.playerNumber));
                    } else if (r.label.includes('(')) {
                        const extractedName = r.label.match(/\((.*?)\)/)[1];
                        matchedPlayer = homePlayers.find(p => p.name === extractedName || p.alias === extractedName);
                    }
                    if (matchedPlayer) {
                        text = _buildIndividualReportText(matchedPlayer, scoreHome, scoreAway, matchDate);
                    }
                }
                window.open(`https://wa.me/${r.phone}?text=${encodeURIComponent(text)}`, '_blank');
            }, i * 800);
        });
        showToast('📱 Abriendo pestañas de WhatsApp...', 3000);
        if (msgEl) msgEl.textContent = 'Completado.';
        setTimeout(() => document.getElementById('setup-modal').style.display='none', 2000);
        return;
    }

    // ----- MODO EMAIL -----
    if (method === 'email') {
        const toSend = recipients.filter(r => r.email);
        if (!toSend.length) { showToast('⚠️ Ningún seleccionado con Email configurado.',3000); return; }
        
        toSend.forEach((r, i) => {
            setTimeout(() => {
                let text = globalText;
                let subject = encodeURIComponent(`📊 Informe Global de Partido — ${matchDate}`);
                if (r.type === 'parent') {
                    let matchedPlayer = null;
                    const link = links.find(l => l.parentEmail === r.email || (l.parentUid && r.id === l.parentUid));
                    if (link) matchedPlayer = homePlayers.find(p => String(p.number) === String(link.playerNumber));
                    
                    if (matchedPlayer) {
                        text = _buildIndividualReportText(matchedPlayer, scoreHome, scoreAway, matchDate);
                        subject = encodeURIComponent(`📊 Informe Individual - ${matchedPlayer.name} — ${matchDate}`);
                    }
                }
                const body = encodeURIComponent(text.replace(/[*_]/g, ''));
                window.open(`mailto:${r.email}?subject=${subject}&body=${body}`, '_blank');
            }, i * 800);
        });
        showToast('📧 Abriendo clientes de correo...', 3000);
        if (msgEl) msgEl.textContent = 'Completado.';
        setTimeout(() => document.getElementById('setup-modal').style.display='none', 2000);
        return;
    }

    // ----- MODO INTERNO -----
    // FIX: Guard anti-duplicados — si autoDispatchMatchReports ya envió los informes
    // para este partido, el envío manual solo debe procesar destinatarios adicionales
    // que no fueron cubiertos por el auto-despacho.
    const _autoAlreadyRan = !!window._cronosLastDispatchedMatch;
    if (_autoAlreadyRan) {
    }
    if (window._cronosDiagReports) {
    }
    showSpinner('Enviando informes internamente...');
    // Generar matchId compartido para todos los destinatarios de staff de este envío.
    // FIX v3: Si el auto-despacho ya generó un matchId para este partido,
    // reutilizarlo para que los documentos se sobreescriban en vez de duplicarse.
    const _sharedMatchId = window._cronosLastAutoDispatchMatchId
        || (() => {
            const _d = new Date().toISOString().split('T')[0];
            const _rs = (rivalName||'rival').replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0,20);
            const _sh = document.getElementById('score-home')?.textContent||'0';
            const _sa = document.getElementById('score-away')?.textContent||'0';
            return `match_${me.uid}_${_d}_${_rs}_${_sh}x${_sa}`;
        })();
    let _staffReportsWritten = false; // guard: escribir docs de staff solo una vez por envío
    // v171: destinatarios de padres resueltos (lazy) con el helper compartido,
    // para que el despacho manual use EXACTAMENTE la misma lógica que el automático.
    let _parentTargetsManual = null;  // Array<{parentUid,dorsal,player}> o null si aún no resuelto
    let _parentTargetsByUid = null;   // Map<parentUid, target>
    try {
        for (const r of recipients) {
            if (r.type === 'staff') {
                // Enviar notificación global al UID del staff si lo tiene
                let uidToNotify = null;
                if (typeof emailConfig !== 'undefined' && emailConfig.contacts) {
                    const c = emailConfig.contacts.find(x => x.id === r.id || x.phone === r.phone || x.email === r.email);
                    if (c && c.uid) uidToNotify = c.uid;
                }
                // También intentar resolver por r.id directamente (uid del destinatario)
                if (!uidToNotify && r.id && !r.id.startsWith('p_')) uidToNotify = r.id;

                if (uidToNotify) {
                    // ── 1. Notificación push/UI ──────────────────────────────────────
                    // FIX: añadido userId para que las reglas de Firestore funcionen
                    if (!_autoAlreadyRan) {
                    await setDoc(doc(db, 'cronos_notifications', `notif_matchsglobe_${uidToNotify}_${Date.now().toString(36)}`), {
                        type:      'aviso_partido_finalizado',
                        clubId:    me.clubId || null,
                        userId:    uidToNotify,            // ← FIX: campo que las reglas verifican
                        coachUid:  me.uid,                // ← FIX (C3): coachUid para reglas Firestore
                        parentUid: uidToNotify,
                        staffUid:  uidToNotify,
                        matchDate,
                        rival:     rivalName,
                        scoreHome, scoreAway,
                        message:   globalText.replace(/[*_]/g,''),
                        createdAt: new Date().toISOString()
                    });
                    } // fin guard anti-duplicado

                    // ── 2. Hilo de mensajes unificado (mismo formato que auto-despacho) ──
                    // Usamos {clubId}_{staffUid} para que el hilo pertenezca al CLUB
                    // (sameClubAsDoc pasa siempre) y coincida con autoDispatchMatchReports.
                    // FIX v176: Se eliminó el getDoc previo porque si el hilo fue creado
                    // por OTRO entrenador del club, el getDoc falla con permission-denied
                    // (el entrenador actual no está en participants del doc ajeno).
                    // Ahora usamos patrón updateDoc→setDoc: intentar actualizar primero,
                    // y si falla (hilo no existe), crearlo.
                    const threadId = _cStaffThreadId(me.clubId, me.uid, uidToNotify);
                    const msgEntry = { sender: 'coach', text: globalText, timestamp: new Date().toISOString(), type: 'collective_report' };
                    try {
                        // Intentar actualizar el hilo existente (añadir mensaje)
                        // FIX (v180): Incluir campos de identidad para consultas del director/coordinador
                        await updateDoc(doc(db, 'cronos_messages', threadId), {
                            messages: arrayUnion(msgEntry),
                            lastMessage: '📊 Informe colectivo de partido',
                            lastMessageAt: msgEntry.timestamp,
                            unreadByStaff: (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.FieldValue.increment(1) : 1,
                            // FIX (v180): campos de identidad para consultas del director/coordinador
                            staffUid:      uidToNotify,
                            parentUid:     uidToNotify,
                            participants:  arrayUnion(me.uid, uidToNotify),
                            clubId:        me.clubId || null,
                            recipientType: 'staff'
                        });
                    } catch(updateErr) {
                        // Si update falla (hilo no existe o sin permiso de update),
                        // intentar crear el hilo con setDoc.
                        try {
                            await setDoc(doc(db, 'cronos_messages', threadId), {
                                threadId,
                                coachUid:      me.uid,
                                coachEmail:    me.email,
                                clubId:        me.clubId || null,     // ← FIX: para reglas Firestore
                                participants:  [me.uid, uidToNotify], // ← FIX: para reglas Firestore
                                staffUids:     [uidToNotify],         // ← FIX: lectura staff por array-contains
                                staffUid:      uidToNotify,
                                parentUid:     uidToNotify,           // FIX (v180): club-reports.js busca por parentUid
                                recipientType: 'staff',
                                messages:      [msgEntry],
                                lastMessage:   '📊 Informe colectivo de partido',
                                lastMessageAt: msgEntry.timestamp,
                                unreadByCoach: 0,
                                unreadByStaff: 1
                            });
                        } catch(setErr) {
                            if(window._CRONOS_DEBUG) console.warn('[Cronos] Error creando hilo staff:', {
                                code: setErr && setErr.code,
                                message: setErr && setErr.message,
                                threadId,
                                staffUid: uidToNotify,
                                coachClubId: me.clubId || null,
                            }, setErr);
                        }
                    }

                    // ── 3. CORRECCIÓN PRINCIPAL: escribir cronos_player_reports ────
                    // El panel de Dirección/Coordinación (_sdLoadReports) SOLO lee
                    // documentos de cronos_player_reports con staffReport===true.
                    // El despacho manual nunca los escribía → panel de Informes vacío.
                    // Se escriben UNA SOLA VEZ (guard _staffReportsWritten) con el
                    // matchId compartido para que todos los staff vean el mismo partido.
                    // FIX: solo escribir si auto-despacho no lo hizo ya.
                    if (!_staffReportsWritten && !_autoAlreadyRan) {
                        _staffReportsWritten = true;
                        // Recopilar UIDs de todos los destinatarios staff
                        const _manualStaffUids = recipients.filter(rx => rx.type === 'staff').map(rx => {
                            if (typeof emailConfig !== 'undefined' && emailConfig.contacts) {
                                const cx = emailConfig.contacts.find(x => x.id === rx.id);
                                if (cx && cx.uid) return cx.uid;
                            }
                            return (rx.id && !rx.id.startsWith('p_')) ? rx.id : null;
                        }).filter(Boolean);

                        try {
                            for (const p of homePlayers) {
                                const srId = `${_sharedMatchId}_staff_p${p.number}`;
                                await setDoc(doc(db, 'cronos_player_reports', srId), {
                                    matchId:       _sharedMatchId,
                                    type:          'staff_match_report',
                                    staffReport:   true,
                                    staffUids:     _manualStaffUids, // ← FIX: UIDs para reglas Firestore
                                    clubId:        me.clubId || null,
                                    coachUid:      me.uid,
                                    coachEmail:    me.email,
                                    matchDate:     new Date().toISOString().split('T')[0],
                                    rival:         rivalName,
                                    scoreHome,
                                    scoreAway,
                                    category:      (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                                   (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') || '',
                                    subcategory:   _cMatchSubcatFor(me, (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                                   (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') || ''),
                                    venue:         (typeof window.matchVenue !== 'undefined' ? window.matchVenue : ''),
                                    competition:   (typeof window.matchCompetition !== 'undefined' ? window.matchCompetition : ''),
                                    matchTime:     (typeof window.matchTime !== 'undefined' ? window.matchTime : ''),
                                    duration:      (typeof window.matchDuration !== 'undefined' ? window.matchDuration : ''),
                                    stoppageTime:  (typeof window.stoppageTime !== 'undefined' ? window.stoppageTime : 0),
                                    createdAt:     new Date().toISOString(),
                                    playerNumber:  String(p.number || ''),
                                    playerAlias:   p.alias || p.name || '',
                                    position:      p.position || p.pos || '',
                                    goals:         p.goals  || 0,
                                    cards:         p.cards  || null,
                                    injured:       p.injured || false,
                                    minutesPlayed: window.formatTime ? window.formatTime(p.time || 0) : String(p.time || 0),
                                    history:       typeof _parseHistoryForFirestore === 'function'
                                                       ? _parseHistoryForFirestore(p.history || [])
                                                       : (p.history || []),
                                });
                            }
                        } catch(srErr) {
                            console.warn('[Cronos] Error escribiendo cronos_player_reports para staff:', srErr);
                        }
                    }

                    sentCount++;
                }
            } 
            else if (r.type === 'parent') {
                // ── REDISEÑO v171: misma lógica ESTRICTA que el auto-despacho ──
                // Resolvemos los destinatarios válidos UNA sola vez con el helper
                // compartido (_cronosResolveParentReportTargets): contactos 'parent'
                // con checkbox INF (tag 'rpt'), inviteCode válido, parentUid real y
                // jugador convocado. Emparejado SOLO por dorsal, nunca por nombre.
                if (!_parentTargetsManual) {
                    const _mc = (typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : [];
                    // FIX (v217): en el envio manual, usar la pre-seleccion per-partido
                    // (si existe) como autoridad. Si el modal no se uso, caer a tag 'rpt'.
                    let _manualAuthIds = null;
                    try {
                        const _raw = localStorage.getItem('cronos_match_rpt_selection');
                        if (_raw) {
                            const _parsed = JSON.parse(_raw);
                            if (Array.isArray(_parsed) && _parsed.length > 0) _manualAuthIds = _parsed;
                        }
                    } catch(_) {}
                    // Si no hay pre-seleccion per-partido, construir authorizedIds a
                    // partir de los checkboxes ACTUALMENTE marcados en el DOM
                    // (recipients ya viene de sharedGetSelectedRecipients('rpt')).
                    if (!_manualAuthIds && Array.isArray(recipients) && recipients.length > 0) {
                        _manualAuthIds = recipients.map(r => String(r.id)).filter(Boolean);
                    }
                    _parentTargetsManual = _cronosResolveParentReportTargets(_mc, links, homePlayers, _manualAuthIds);
                    _parentTargetsByUid = new Map(_parentTargetsManual.map(t => [t.parentUid, t]));
                }

                // Emparejar el recipient contra los targets YA validados por el
                // helper, usando los MISMOS campos que el helper (uid/id/email/phone).
                // FIX Bug 2: antes se re-resolvía recipientParentUid con menos vías
                // (solo parentUid/email/phone), lo que dejaba fuera a contactos
                // manuales emparejados por playerId/id/uid -> falsos "omitido".
                const _normE = (e) => (typeof window._cronosNormEmail === 'function')
                    ? window._cronosNormEmail(e) : String(e || '').trim().toLowerCase();

                // 1) Por parentUid directo (r.id es un UID).
                let target = (r.id && !r.id.startsWith('p_'))
                    ? _parentTargetsByUid.get(r.id) : null;

                // 2) Si no, emparejar por el contacto que originó cada target.
                if (!target) {
                    target = _parentTargetsManual.find(t => {
                        const c = t.contact || {};
                        return (c.uid && r.id && c.uid === r.id)
                            || (c.id && r.id && c.id === r.id)
                            || (r.email && c.email && _normE(c.email) === _normE(r.email))
                            || (r.phone && c.phone && c.phone === r.phone);
                    }) || null;
                }

                if (!target) {
                    // Hijo no convocado / sin inviteCode válido / sin parentUid → omitir en silencio.
                    continue;
                }

                // FIX: Si auto-despacho ya envió a este padre, saltar (evita duplicado).
                if (_autoAlreadyRan) {
                    sentCount++;
                    continue;
                }

                const targetParentUid = target.parentUid;
                const player = target.player;
                const dorsal = target.dorsal;
                const reportText = _buildIndividualReportText(player, scoreHome, scoreAway, matchDate);

                // ID determinista e idempotente: {matchId}_parent_{parentUid}_p{dorsal}
                const _manualMatchId = _sharedMatchId; // reutilizar el matchId compartido
                const reportId = `${_manualMatchId}_parent_${targetParentUid}_p${dorsal}`;
                await setDoc(doc(db, 'cronos_player_reports', reportId), {
                    matchId:        _manualMatchId,
                    type:           'parent_player_report',
                    reportId,
                    playerNumber:   String(dorsal),
                    playerAlias:    player.alias || player.name || 'Jugador',
                    parentUid:      targetParentUid,
                    coachUid:       me.uid, coachEmail: me.email,
                    clubId:         me.clubId || null,
                    matchDate:      new Date().toISOString().split('T')[0],
                    rival:          rivalName,
                    scoreHome, scoreAway,
                    minutesPlayed: window.formatTime ? window.formatTime(player.time||0) : player.time||0,
                    goals: player.goals || 0,
                    cards: player.cards || 'ninguna',
                    injured: player.injured || false,
                    history: typeof _parseHistoryForFirestore === 'function'
                             ? _parseHistoryForFirestore(player.history || [])
                             : (player.history || []),
                    createdAt: new Date().toISOString(),
                });

                // Send via Thread Message + notificación (parentUid siempre válido aquí).
                // FIX v176: Mismo patrón updateDoc→setDoc que para staff.
                // Se eliminó el getDoc previo para evitar permission-denied.
                const threadId = `${me.uid}_${targetParentUid}`;
                const msgEntry = { sender: 'coach', text: reportText, timestamp: new Date().toISOString(), type: 'report' };
                try {
                    // Intentar actualizar hilo existente
                    // FIX (v180): Incluir campos de identidad para consultas
                    await updateDoc(doc(db, 'cronos_messages', threadId), {
                        messages: arrayUnion(msgEntry),
                        lastMessage: '📊 Informe de partido enviado',
                        lastMessageAt: msgEntry.timestamp,
                        unreadByParent: (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.FieldValue.increment(1) : 1,
                        // FIX (v180): campos de identidad
                        parentUid:    targetParentUid,
                        participants: arrayUnion(me.uid, targetParentUid),
                        clubId:       me.clubId || null,
                        recipientType: 'parent'
                    });
                } catch(updateErr) {
                    // Si update falla (hilo no existe), crear con setDoc
                    try {
                        await setDoc(doc(db, 'cronos_messages', threadId), {
                            threadId, coachUid: me.uid, coachEmail: me.email,
                            clubId: me.clubId || null,                           // ← FIX: para reglas Firestore
                            participants: [me.uid, targetParentUid],              // ← FIX: para reglas Firestore
                            parentUid: targetParentUid, parentEmail: (target.contact && target.contact.email) || r.email || '',
                            messages: [msgEntry], lastMessage: '📊 Informe de partido enviado',
                            lastMessageAt: msgEntry.timestamp, unreadByCoach: 0, unreadByParent: 1
                        });
                    } catch(setErr) {
                        console.warn('[Cronos] Error creando hilo parent:', {
                            code: setErr && setErr.code,
                            message: setErr && setErr.message,
                            threadId, parentUid: targetParentUid,
                        }, setErr);
                    }
                }

                // Also a notification for the parent
                try {
                    await setDoc(doc(db, 'cronos_notifications', `notif_rpt_${dorsal}_${Date.now().toString(36)}`), {
                        type: 'informe_partido', clubId: me.clubId || null,
                        userId: targetParentUid,                              // ← FIX: campo que las reglas verifican
                        coachUid: me.uid,                                   // ← FIX (C3): coachUid para reglas Firestore
                        parentUid: targetParentUid, playerNumber: dorsal,
                        rival: rivalName, scoreHome, scoreAway,
                        myTeamRole: _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                        minutesPlayed: window.formatTime ? window.formatTime(player.time||0) : player.time||0,
                        goals: player.goals || 0, cards: player.cards || 'ninguna',
                        injured: player.injured || false, createdAt: new Date().toISOString()
                    });
                } catch(notifErr) {
                    console.warn('[Cronos] Error enviando notificación a parentUid:', targetParentUid, notifErr);
                }

                sentCount++;
            }
        }
        
        // ── INFORME COLECTIVO AL PROPIO ENTRENADOR ───────────────
        // FIX: Solo generar si auto-despacho no lo hizo ya (evita duplicados)
        if (!_autoAlreadyRan) {
        try {
            const _today2 = new Date().toISOString().split('T')[0];
            const _rivalSlug3 = (rivalName||'rival').replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0,20);
            const matchId = window._cronosLastAutoDispatchMatchId
                || `match_${me.uid}_${_today2}_${_rivalSlug3}_${scoreHome}x${scoreAway}`;
            for (const p of homePlayers) {
                const rptId = `${matchId}_coach_p${p.number}`;
                await setDoc(doc(db, 'cronos_player_reports', rptId), {
                    matchId, type: 'collective_match_report', clubId: me.clubId || null,
                    coachUid: me.uid, coachEmail: me.email,
                    matchDate: new Date().toISOString().split('T')[0],
                    rival: rivalName, scoreHome, scoreAway,
                    myTeamRole: _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                    category: (typeof currentCategory!=='undefined'?currentCategory:'') || (typeof window.currentCategory!=='undefined'?window.currentCategory:''),
                    subcategory: _cMatchSubcatFor(me, (typeof currentCategory!=='undefined'?currentCategory:'') || (typeof window.currentCategory!=='undefined'?window.currentCategory:'')),
                    createdAt: new Date().toISOString(),
                    playerNumber: String(p.number||''), playerAlias: p.alias || p.name || '',
                    position: p.position || p.pos || '',
                    goals: p.goals || 0, cards: p.cards || null, injured: p.injured || false,
                    minutesPlayed: window.formatTime ? window.formatTime(p.time||0) : String(p.time||0),
                    history: _parseHistoryForFirestore(p.history||[]),
                    _forCoach: true,
                });
            }
            const coachNotifId = `coach_self_rpt_${me.uid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', coachNotifId), {
                type: 'informe_colectivo', clubId: me.clubId || null,
                userId: me.uid,    // FIX v177: campo que las reglas Firestore verifican
                coachUid: me.uid,
                parentUid: me.uid, staffUid: me.uid, coachEmail: me.email,
                matchDate: new Date().toISOString().split('T')[0],
                rival: rivalName, scoreHome, scoreAway, matchId,
                message: 'Has generado un nuevo informe colectivo de partido.',
                createdAt: new Date().toISOString(),
            });
        } catch(autoSelfErr) {
            console.warn('[ManualDispatch] Auto-informe al entrenador falló silenciosamente:', autoSelfErr.message);
        }
        } // fin guard !_autoAlreadyRan

    } catch (sendErr) {
        console.error('[Cronos] Error enviando informes internos:', sendErr);
        if (msgEl) {
            msgEl.style.color = '#da3633';
            msgEl.textContent = '⚠️ Error al enviar. Comprueba la conexión e inténtalo de nuevo.';
        }
        showToast('⚠️ Error al enviar informes. Revisa la consola.', 5000);
    } finally {
        hideSpinner();
    }

    if (sentCount > 0 && msgEl && msgEl.style.color !== '#da3633') {
        msgEl.style.color = '#3fb950';
        msgEl.textContent = `✅ Enviado con éxito a ${sentCount} destinatario(s).`;
        showToast(`✅ Informes enviados (${sentCount})`, 4000);
        setTimeout(() => { document.getElementById('setup-modal').style.display='none'; }, 2000);
    } else if (sentCount === 0 && msgEl && msgEl.style.color !== '#da3633') {
        msgEl.style.color = '#ffa500';
        msgEl.textContent = '⚠️ No se encontraron jugadores vinculados para los destinatarios seleccionados.';
        showToast('⚠️ No se pudo enviar ningún informe. Revisa las vinculaciones.', 5000);
    }
}

// ── Despacho automático de informes (Interno) ──────────────────────────
async function autoDispatchMatchReports() {
    const me = window._cronosCurrentUser;
    if (!me || !window.players) return;

    try {
        const { setDoc, doc, getDoc, collection, getDocs, query, where, updateDoc, arrayUnion } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const db = window._cronos_auth.db;

        // Bug 1 (v174): resolver el clubId desde Firestore si el token no lo trae.
        // Sin clubId, las reglas de cronos_messages/notifications/reports rechazan
        // el envío al staff (director/coordinador) y a los padres.
        const _clubId = await _cResolveClubId(db, me, { doc, getDoc, updateDoc });
        if (_clubId && !me.clubId) me.clubId = _clubId;

        // E3 (punto 2): sin clubId válido, las reglas Firestore
        // (sameClubAsDoc) impiden que el panel de Dirección lea los
        // cronos_player_reports, así que los informes nunca se verían.
        // Avisamos en consola para diagnóstico; el envío continúa porque
        // el entrenador igualmente recibe su copia, pero el staff no podrá leer.
        if (!me.clubId) {
            if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[autoDispatch] me.clubId ausente: los informes de staff ' +
                'no serán legibles por coordinadores/directores (reglas Firestore por club).');
        }

        const scoreHome = document.getElementById('score-home')?.textContent || '0';
        const scoreAway = document.getElementById('score-away')?.textContent || '0';
        const rivalName = TEAM_NAMES.away || 'Rival';
        const matchDate = new Date().toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
        const homePlayers = window.players.filter(p => p.team === _cMyTeamKey());
        console.log('autoDispatch ejecutándose | teamKey:', _cMyTeamKey(),
            '| total players:', (window.players||[]).length,
            '| homePlayers (mi equipo):', homePlayers.length,
            homePlayers.map(p => '#'+p.number+' '+p.name).join(', ') || '(NINGUNO)');

        // 1. Obtener links y contactos
        const linksSnap = await getDocs(query(collection(db, 'cronos_player_links'), where('clubId', '==', me.clubId || '')));
        const links = [];
        linksSnap.forEach(d => links.push({ _id: d.id, ...d.data() }));

        if (typeof loadEmailConfig === 'function') await loadEmailConfig();
        const contacts = (typeof emailConfig !== 'undefined' && emailConfig.contacts) ? emailConfig.contacts : [];

        // --- MEJORA: COMPROBAR PRE-SELECCIÓN DEL PARTIDO ---
        const preSelectionIds = JSON.parse(localStorage.getItem('cronos_match_rpt_selection') || 'null');
        
        function isRecipientAuthorized(contact) {
            if (preSelectionIds) {
                return preSelectionIds.includes(contact.id);
            }
            return (contact.tags || []).includes('rpt');
        }

        // --- FASE A: INFORME GLOBAL (STAFF + ENTRENADOR) ---
        const globalText = `📊 *INFORME GLOBAL DE PARTIDO*\n` +
                          `━━━━━━━━━━━━━━━━\n` +
                          `📅 ${matchDate}\n` +
                          `⚽ ${TEAM_NAMES.home} ${scoreHome} - ${scoreAway} ${rivalName}\n\n` +
                          `Informes individuales generados y enviados a padres autorizados.\n` +
                          `_Cronos Fútbol_`;

        // ── Generar un matchId DETERMINISTA para este partido ────────────────
        // CRÍTICO: si usamos Date.now(), cada ejecución de autoDispatch genera
        // un ID diferente → setDoc crea un doc NUEVO en vez de sobreescribir
        // → los padres ven el informe duplicado N veces.
        // Solución: construir el ID con datos del partido que no cambian
        // (coachUid + fecha + rival + marcador) → idempotente aunque se llame
        // múltiples veces en el mismo partido (o el usuario cambie de rol).
        const _today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const _rivalSlug = (rivalName || 'rival').replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0, 20);
        const sharedMatchId = `match_${me.uid}_${_today}_${_rivalSlug}_${scoreHome}x${scoreAway}`;
        // Guardar globalmente para que el envío manual pueda reutilizarlo.
        window._cronosLastAutoDispatchMatchId = sharedMatchId;

        // ── Resolver destinatarios staff ANTES de escribir reports ──────────
        // FIX: antes los staff reports se escribían sin staffUids, así que los
        // directores/coordinadores no podían leerlos por las reglas de Firestore.
        // Ahora resolvemos el staff primero para incluir sus UIDs en cada doc.
        const notifiedUids = new Set();
        let staffToNotify = [];
        try {
            const _fns2 = { collection, getDocs, query, where };
            staffToNotify = (await _cGetStaff(db, me.clubId || '', _fns2)) || [];
        } catch (e) {
            console.warn('[autoDispatch] _cGetStaff falló, usando emailConfig:', e.message);
        }
        // Fuente complementaria: contactos de tipo staff con uid
        contacts.filter(c => c.type !== 'parent' && c.uid)
            .forEach(c => {
                if (!staffToNotify.some(s => s.uid === c.uid)) {
                    staffToNotify.push({ uid: c.uid, role: c.role || 'staff', email: c.email || '' });
                }
            });
        // ── Pieza 2: filtrar coordinadores por modalidad del partido ──────
        // Director Deportivo siempre; Coordinador solo si su coordinatorType
        // (f7/f11/f711) encaja con la modalidad de la categoría del partido.
        if (typeof window._cronosResolveStaffForMatch === 'function') {
            const _matchCat  = window._currentMatchCategory || '';
            const _matchMode = (typeof currentMode !== 'undefined' ? currentMode : null);
            const _before = staffToNotify.length;
            staffToNotify = window._cronosResolveStaffForMatch(staffToNotify, _matchCat, _matchMode);
            if (staffToNotify.length !== _before) {
                console.log('[autoDispatch] Staff filtrado por modalidad (' +
                    (window._cronosMatchModality(_matchCat, _matchMode) || '?') + '): ' +
                    _before + ' → ' + staffToNotify.length);
            }
        }
        // FIX (P11-D): incluir SIEMPRE me.uid (el propio entrenador) como red de
        // seguridad, para que la query array-contains del Panel de Dirección
        // nunca quede vacía aunque el club no tenga staff asignado todavía.
        const _allStaffUids = Array.from(new Set([...staffToNotify.map(s => s.uid).filter(Boolean), me.uid].filter(Boolean)));

        // FIX (v217): aplicar pre-seleccion per-partido al staff TAMBIEN.
        // Si preSelectionIds esta presente (modal de convocatoria usado),
        // filtramos staffToNotify para QUE SOLO queden los contactos cuyo
        // id este en la pre-seleccion. El director/coordinador se mantiene
        // SIEMPRE (Regla 1) salvo que el entrenador lo haya deschequeado
        // explicitamente en el modal del partido.
        if (preSelectionIds && Array.isArray(preSelectionIds) && preSelectionIds.length > 0) {
            const _staffSel = new Set(preSelectionIds.map(String));
            staffToNotify = staffToNotify.filter(s => {
                // Conservar si su uid O email coincide con un contacto seleccionado.
                if (!s) return false;
                if (s.uid && _staffSel.has(String(s.uid))) return true;
                if (s.email) {
                    const matchByEmail = (contacts || []).some(c =>
                        c && c.type !== 'parent' && c.email &&
                        String(c.email).toLowerCase() === String(s.email).toLowerCase() &&
                        _staffSel.has(String(c.id))
                    );
                    if (matchByEmail) return true;
                }
                return false;
            });
            if (window._cronosDiagReports) {
                console.log('[autoDispatch] Staff filtrado por pre-seleccion per-partido:',
                    staffToNotify.length, 'destinatarios');
            }
        }

        if (window._cronosDiagReports) {
        }
        // FIX v177: Log SIEMPRE (no condicional) para diagnosticar por qué
        // el informe colectivo no llega al director/coordinador.

        // ── Guardar documentos cronos_player_reports para el Gantt del staff ──
        // Un documento por jugador con type='staff_match_report' y staffReport=true.
        // FIX: incluye staffUids para que las reglas de Firestore permitan leer
        // a directores y coordinadores (request.auth.uid in resource.data.staffUids).
        for (const p of homePlayers) {
            const srId = `${sharedMatchId}_staff_p${p.number}`;
            await setDoc(doc(db, 'cronos_player_reports', srId), {
                matchId:       sharedMatchId,
                type:          'staff_match_report',
                staffReport:   true,          // ← filtro exclusivo del panel staff
                staffUids:     _allStaffUids, // ← FIX: UIDs de staff para reglas Firestore
                clubId:        me.clubId || null,
                coachUid:      me.uid,
                coachEmail:    me.email,
                matchDate:     new Date().toISOString().split('T')[0],
                rival:         rivalName,
                scoreHome,
                scoreAway,
                myTeamRole:    _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                category:      window._currentMatchCategory || '',
                subcategory:   _cMatchSubcatFor(me, window._currentMatchCategory || ''),
                createdAt:     new Date().toISOString(),
                playerNumber:  String(p.number || ''),
                playerAlias:   p.alias || p.name || '',
                position:      p.position || p.pos || '',
                goals:         p.goals  || 0,
                cards:         p.cards  || null,
                injured:       p.injured || false,
                minutesPlayed: typeof formatTime === 'function' ? formatTime(p.time || 0) : String(p.time || 0),
                history:       _parseHistoryForFirestore(p.history || []),
            });
        }
        console.log(`[StaffReport] TOTAL informes staff escritos en cronos_player_reports: ${homePlayers.length} (matchId=${sharedMatchId}, staffToNotify=${staffToNotify.length}, staffUids=${_allStaffUids.length})`);

        // ── Notificar al staff (coordinador + director) ──────────────────
        // Los destinatarios ya fueron resueltos arriba (antes de los reports).
        // Aquí enviamos las notificaciones Y creamos los hilos de mensajes.

        for (const staff of staffToNotify) {
            if (!staff.uid || notifiedUids.has(staff.uid)) continue;
            notifiedUids.add(staff.uid);

            // FIX (v178): Log detallado por cada staff para diagnosticar

            // ── 1. Notificación push/UI ───────────────────────────────
            const notifId = `notif_global_rpt_${staff.uid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', notifId), {
                type: 'aviso_partido_finalizado',
                clubId: me.clubId || null,
                userId: staff.uid,           // ← FIX: campo que las reglas verifican
                coachUid: me.uid,            // ← FIX (C2): coachUid para reglas Firestore
                parentUid: staff.uid,
                staffUid: staff.uid,
                matchDate, rival: rivalName, scoreHome, scoreAway,
                message: globalText.replace(/[*_]/g, ''),
                createdAt: new Date().toISOString()
            });

            // ── 2. Hilo de mensajes para el staff ──────────────────────
            // FIX v176: El auto-despacho NO creaba hilos de mensajes para el
            // staff, así que el director/coordinador solo recibía la notificación
            // push pero NO veía el informe en su bandeja de mensajes.
            // Ahora se crea el hilo con el mismo patrón que el despacho manual.
            const threadId = _cStaffThreadId(me.clubId, me.uid, staff.uid);
            const staffMsgEntry = { sender: 'coach', text: globalText, timestamp: new Date().toISOString(), type: 'collective_report' };
            try {
                // Intentar actualizar el hilo existente (añadir mensaje)
                // FIX (v180): Incluir campos de identidad para que las queries del
                // director/coordinador (por clubId, staffUid, parentUid, participants)
                // encuentren este hilo. Sin estos campos, updateDoc solo añade el
                // mensaje pero el hilo sigue siendo invisible para director/coordinador.
                await updateDoc(doc(db, 'cronos_messages', threadId), {
                    messages: arrayUnion(staffMsgEntry),
                    lastMessage: '📊 Informe colectivo de partido',
                    lastMessageAt: staffMsgEntry.timestamp,
                    unreadByStaff: (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.FieldValue.increment(1) : 1,
                    // FIX (v180): campos de identidad para consultas del director/coordinador
                    staffUid:      staff.uid,
                    parentUid:     staff.uid,
                    participants:  arrayUnion(me.uid, staff.uid),
                    clubId:        me.clubId || null,
                    recipientType: 'staff'
                });
            } catch(updateErr) {
                // Si falla update (hilo no existe), crear con setDoc
                try {
                    await setDoc(doc(db, 'cronos_messages', threadId), {
                        threadId,
                        coachUid:      me.uid,
                        coachEmail:    me.email,
                        clubId:        me.clubId || null,
                        participants:  [me.uid, staff.uid],
                        staffUids:     [staff.uid],
                        staffUid:      staff.uid,
                        parentUid:     staff.uid,     // FIX (v178): club-reports.js busca por parentUid
                        recipientType: 'staff',
                        messages:      [staffMsgEntry],
                        lastMessage:   '📊 Informe colectivo de partido',
                        lastMessageAt: staffMsgEntry.timestamp,
                        unreadByCoach: 0,
                        unreadByStaff: 1
                    });
                } catch(thErr) {
                    if(window._CRONOS_DEBUG) console.warn('[autoDispatch] Error creando hilo staff:', {
                        code: thErr && thErr.code,
                        message: thErr && thErr.message,
                        threadId,
                        staffUid: staff.uid,
                        coachClubId: me.clubId || null,
                    }, thErr);
                }
            }
        }

        // --- FASE B: INFORMES INDIVIDUALES (PADRES) — REDISEÑO v171 ---
        // REGLA 3 (estricta): se itera por PADRES (no por jugadores). Cada padre
        // con el checkbox INF (tag 'rpt') y un inviteCode válido (J<dorsal>)
        // recibe EXACTAMENTE 1 informe del jugador cuyo número coincide con su
        // dorsal, y solo si ese jugador fue convocado (homePlayers). El
        // emparejado es SOLO por dorsal, nunca por nombre. La resolución vive en
        // el helper compartido, idéntico al del despacho manual.
        // FIX (v217): pasar preSelectionIds como 4o argumento para que el helper
        // respete ESTRICTAMENTE el checkbox per-partido (modal de convocatoria).
        // Si preSelectionIds es null (no se uso el modal), el helper cae al
        // comportamiento legacy (tag 'rpt' global).
        const _parentTargets = _cronosResolveParentReportTargets(contacts, links, homePlayers, preSelectionIds);
        for (const { parentUid, dorsal, player } of _parentTargets) {
            // FIX v176: Cada padre se envía en su propio try/catch para que un
            // fallo con un padre (p.ej. permission-denied) NO impida el envío
            // al resto de padres. Antes, si setDoc de un padre fallaba, el
            // bucle se rompía y los padres siguientes no recibían su informe.
            try {
            // Texto individual de este jugador
            const cardLbl = player.cards === 'amarilla' ? '🟨 TARJETA' : player.cards === 'roja' ? '🟥 TARJETA' : 'Sin tarjetas';
            const stats = `⏱️ ${formatTime(player.time || 0)} min | ⚽ GOL ×${player.goals || 0} | ${cardLbl}`;
            const indivText = `📊 *INFORME INDIVIDUAL: ${player.name}*\n` +
                             `━━━━━━━━━━━━━━━━\n` +
                             `📅 ${matchDate}\n` +
                             `⚽ Partido vs ${rivalName}\n` +
                             `📈 Rendimiento: ${stats}\n\n` +
                             `Revisa el panel de informes para más detalles.\n` +
                             `_Cronos Fútbol_`;

            // ── Guardar en cronos_player_reports para el panel del padre ──
            // ID determinista e idempotente: {matchId}_parent_{parentUid}_p{dorsal}
            const prId = `${sharedMatchId}_parent_${parentUid}_p${dorsal}`;
            await setDoc(doc(db, 'cronos_player_reports', prId), {
                matchId:       sharedMatchId,
                type:          'parent_player_report',
                parentUid:     parentUid,
                clubId:        me.clubId || null,
                coachUid:      me.uid,
                coachEmail:    me.email,
                matchDate:     new Date().toISOString().split('T')[0],
                rival:         rivalName,
                scoreHome,
                scoreAway,
                myTeamRole:    _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                createdAt:     new Date().toISOString(),
                playerNumber:  String(dorsal),
                playerAlias:   player.alias || player.name || '',
                goals:         player.goals  || 0,
                cards:         player.cards  || 'ninguna',
                injured:       player.injured || false,
                minutesPlayed: typeof formatTime === 'function' ? formatTime(player.time || 0) : String(player.time || 0),
                history:       _parseHistoryForFirestore(player.history || []),
            });

            // ── Enviar mensaje al hilo de chat ───────────────────────────
            // FIX v176: Mismo patrón updateDoc→setDoc que para staff.
            // El hilo de padres usa {coachUid}_{parentUid} como threadId.
            const threadId = `${me.uid}_${parentUid}`;
            const msgEntry = { sender: 'coach', text: indivText, timestamp: new Date().toISOString(), type: 'report' };
            try {
                // FIX (v180): Incluir campos de identidad para consultas
                await updateDoc(doc(db, 'cronos_messages', threadId), {
                    messages: arrayUnion(msgEntry),
                    lastMessage: '📊 Informe de partido enviado',
                    lastMessageAt: msgEntry.timestamp,
                    unreadByParent: (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore.FieldValue.increment(1) : 1,
                    // FIX (v180): campos de identidad
                    parentUid:    parentUid,
                    participants: arrayUnion(me.uid, parentUid),
                    clubId:       me.clubId || null,
                    recipientType: 'parent'
                });
            } catch(e) {
                await setDoc(doc(db, 'cronos_messages', threadId), {
                    threadId, coachUid: me.uid, coachEmail: me.email,
                    clubId: me.clubId || null,                        // ← FIX: para reglas Firestore
                    participants: [me.uid, parentUid],                // ← FIX: para reglas Firestore
                    parentUid: parentUid, messages: [msgEntry], lastMessage: '📊 Informe de partido enviado',
                    lastMessageAt: msgEntry.timestamp, unreadByCoach: 0, unreadByParent: 1
                });
            }

            // ── Notificación push para el padre ───────────────────────────
            const notifId = `notif_indiv_rpt_${parentUid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', notifId), {
                type:         'informe_partido',
                clubId:       me.clubId || null,
                userId:       parentUid,                           // ← FIX: campo que las reglas verifican
                coachUid:     me.uid,                              // ← FIX (C2): coachUid para reglas Firestore
                parentUid:    parentUid,
                playerNumber: dorsal,
                playerAlias:  player.alias || player.name,
                rival:        rivalName,
                scoreHome,
                scoreAway,
                minutes:      typeof formatTime==='function' ? formatTime(player.time||0) : String(player.time||0),
                goals:        player.goals || 0,
                cards:        player.cards || 'ninguna',
                history:      _parseHistoryForFirestore(player.history || []),
                matchId:      prId,
                createdAt:    new Date().toISOString()
            });
            } catch(parentErr) {
                // Un padre falló → log y continuar con el siguiente
                console.warn('[autoDispatch] Error enviando informe a padre:', {
                    parentUid, dorsal,
                    code: parentErr && parentErr.code,
                    message: parentErr && parentErr.message,
                }, parentErr);
            }
        }

        localStorage.removeItem('cronos_match_rpt_selection');

        // ── FASE C: INFORME COLECTIVO AL PROPIO ENTRENADOR ───────────────
        // El entrenador siempre recibe su propio informe colectivo como registro.
        // Usa el mismo matchId que el informe del staff para agrupación coherente.
        try {
            const matchId = sharedMatchId; // mismo ID que staff

            // [DIAG TEMP] Confirmar que la FASE C se ejecuta y con qué datos.


            // Guardar copia del informe en cronos_player_reports con coachUid = uid
            for (const p of homePlayers) {
                const rptId = `${matchId}_coach_p${p.number}`;
                try {
                await setDoc(doc(db, 'cronos_player_reports', rptId), {
                    matchId,
                    type:          'collective_match_report',
                    staffReport:   false,         // no aparece en vista del staff (ya tiene staffReport=true)
                    _forCoach:     true,
                    clubId:        me.clubId || null,
                    coachUid:      me.uid,
                    coachEmail:    me.email,
                    matchDate:     new Date().toISOString().split('T')[0],
                    rival:         rivalName,
                    scoreHome,
                    scoreAway,
                    myTeamRole:    _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto)
                    category:      window._currentMatchCategory || '',
                    subcategory:   _cMatchSubcatFor(me, window._currentMatchCategory || ''),
                    createdAt:     new Date().toISOString(),
                    playerNumber:  String(p.number||''),
                    playerAlias:   p.alias || p.name || '',
                    position:      p.position || p.pos || '',
                    goals:         p.goals  || 0,
                    cards:         p.cards  || null,
                    injured:       p.injured || false,
                    minutesPlayed: typeof formatTime==='function' ? formatTime(p.time||0) : String(p.time||0),
                    history:       _parseHistoryForFirestore(p.history||[]),
                });
                // [DIAG TEMP] setDoc del coach OK para este jugador.
                } catch (setErr) {
                    // [DIAG TEMP] Capturar el fallo concreto del setDoc por jugador
                    // (típicamente permission-denied de las reglas Firestore).
                    console.error('[FaseC][DIAG] setDoc coach FALLÓ:', rptId,
                        '| code:', setErr.code, '| msg:', setErr.message);
                }
            }

            // Notificación in-app para el propio entrenador (formato estándar)
            const coachNotifId = `coach_self_rpt_${me.uid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', coachNotifId), {
                type:      'informe_colectivo', // Usamos el tipo estándar para que aparezca en el feed
                clubId:    me.clubId || null,
                userId:    me.uid,              // FIX v177: campo que las reglas Firestore verifican (request.auth.uid == resource.data.userId)
                coachUid:  me.uid,
                parentUid: me.uid, // necesario para que el filtro de lectura lo encuentre
                staffUid:  me.uid,
                coachEmail: me.email,
                matchDate: new Date().toISOString().split('T')[0],
                rival: rivalName, 
                scoreHome, 
                scoreAway,
                matchId,
                message:   'Has generado un nuevo informe colectivo de partido.',
                createdAt: new Date().toISOString(),
            });
            // [DIAG TEMP] FASE C completada sin lanzar excepción al nivel superior.
        } catch(e) {
            // [DIAG TEMP] mostrar mensaje + objeto de error completo.
            console.error('FASE C ERROR setDoc coach:', e.message, e);
        }

        showToast('✅ Informes enviados automáticamente (Interno)', 4000);

    } catch(e) {
        console.error('[AutoDispatch] Error:', e);
    }
}

async function saveAllMatchReportsInternal() {
    const me = window._cronosCurrentUser;
    if (!me || !window.players) return;

    // ── GUARD DE IDEMPOTENCIA PERSISTENTE (localStorage) ─────────────────
    // Refuerza el guard en memoria (E4) para que sobreviva a recargas de
    // pagina y recuperaciones de partido. Se limpia al iniciar partido nuevo
    // (ver startMatchWithConvocation -> limpieza de 'cronos_reports_sent_').
    const _scoreHomeNow = document.getElementById('score-home')?.textContent || '0';
    const _scoreAwayNow = document.getElementById('score-away')?.textContent || '0';
    const _matchId = window.liveMatchId || ('local_' + (window._cronosCurrentUser?.uid || 'u') + '_' + new Date().toISOString().split('T')[0] + '_' + (window.TEAM_NAMES?.home || '') + '-' + _scoreHomeNow + '-' + _scoreAwayNow);
    const _guardKey = 'cronos_reports_sent_' + _matchId;
    if (localStorage.getItem(_guardKey)) {
        return;
    }
    localStorage.setItem(_guardKey, Date.now().toString());

    // ── E4: GUARD DE IDEMPOTENCIA ────────────────────────────────────────
    // El fin de partido se dispara desde varias rutas (endMatch manual,
    // terminateMatch por expulsiones, fin automático del crono). Cada una
    // llamaba a esta función, y cada llamada generaba informes a padres, por
    // lo que el padre recibía el informe individual 2-3 veces (E4: "informe
    // individual triplicado a padres").
    //
    // Solución: despachar como MÁXIMO una vez por partido finalizado.
    // La huella usa liveMatchId si existe; si no (modo sin sync en vivo),
    // se compone con uid + fecha + marcador para distinguir partidos reales
    // del mismo entrenador y evitar bloquear un partido legítimamente nuevo.
    // (_scoreHomeNow / _scoreAwayNow ya estan declarados arriba en el guard persistente)
    const _matchFingerprint =
        (typeof liveMatchId !== 'undefined' && liveMatchId)
            ? `live:${liveMatchId}`
            : `local:${me.uid}:${new Date().toISOString().split('T')[0]}:` +
              `${TEAM_NAMES.home}-${_scoreHomeNow}-${_scoreAwayNow}-${TEAM_NAMES.away}`;

    if (window._cronosLastDispatchedMatch === _matchFingerprint) {
        return;
    }
    // Reservar la huella ANTES del await para cerrar la ventana de carrera
    // entre disparos casi simultáneos (p. ej. crono + botón manual).
    window._cronosLastDispatchedMatch = _matchFingerprint;

    try {
        // Orquestador único: toda la generación de documentos (staff, padres y
        // copia del entrenador) vive en autoDispatchMatchReports(). Antes esta
        // función escribía además un doc `rpt_*` por jugador con parentUid, que
        // el panel del padre mostraba junto al `parent_player_report` generado
        // por autoDispatch → informe duplicado. Eliminado para una sola copia.
        await autoDispatchMatchReports();

    } catch(e) {
        console.error('[AutoReport] Error:', e.message);
        // Si falló, liberar la huella para permitir reintento manual.
        if (window._cronosLastDispatchedMatch === _matchFingerprint) {
            window._cronosLastDispatchedMatch = null;
        }
    }
}

// ── Gestión de Contactos (Teléfonos WhatsApp) ─────────────────────────
async function openContactManager() {
    const me = window._cronosCurrentUser;
    if (!me) { if(typeof showToast==='function') showToast('⚠️ No hay sesión activa',3000); return; }
    const fa = window._cronos_auth;
    if (!fa || !fa.db) { if(typeof showToast==='function') showToast('⚠️ Firebase no disponible',3000); return; }
    const db = fa.db;
    if (typeof showSpinner === 'function') showSpinner('Cargando contactos…');

    // Asegurar que tenemos la config de email cargada y que emailConfig existe
    if (typeof window.emailConfig === 'undefined') window.emailConfig = { contacts: [] };
    // FIX: loadEmailConfig estaba FUERA del try/catch. Si su versión activa
    // (hay 3 definiciones) es async y rechaza, la promesa de esta función
    // async se rechazaba silenciosamente (onclick sin .catch) → "clic sin
    // efecto, sin error". Lo protegemos para que el modal abra igualmente.
    try { if (typeof loadEmailConfig === 'function') await loadEmailConfig(); }
    catch (e) { console.warn('[Contactos] loadEmailConfig falló, continúo igualmente:', e?.message); }
    if (!window.emailConfig) window.emailConfig = { contacts: [] };

    try {
        const { collection, getDocs, query, where } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        
        const snap = await getDocs(query(
            collection(db, 'cronos_player_links'),
            where('clubId', '==', me.clubId || '')
        ));

        const links = [];
        snap.forEach(d => links.push({ _id: d.id, ...d.data() }));

        hideSpinner();

        // --- MIGRACIÓN Y PREPARACIÓN DE DATOS ---
        if (!emailConfig || !emailConfig.contacts) {
            if (!emailConfig) emailConfig = {};
            emailConfig.contacts = [];
            // Migrar Director
            if (emailConfig.directorEmail) {
                emailConfig.contacts.push({
                    id: 'dir_' + Math.random().toString(36).substr(2, 4),
                    name: 'Director Deportivo',
                    email: emailConfig.directorEmail,
                    phone: emailConfig.whatsappNumber || '',
                    tags: ['reports', 'notifs']
                });
            }
            // Migrar Coordinador
            if (emailConfig.directorEmail2) {
                emailConfig.contacts.push({
                    id: 'coord_' + Math.random().toString(36).substr(2, 4),
                    name: 'Coordinador',
                    email: emailConfig.directorEmail2,
                    phone: emailConfig.whatsappNumber2 || '',
                    tags: ['reports', 'notifs']
                });
            }
        }

        // ── AUTO-POPULACIÓN DESDE FIRESTORE ──
        const coachCat = me.category || me.categoryLabel || '';
        const coachSub = me.subcategory || '';
        const fns = await _cFS();

        // 1. Cargar Staff real de Firestore (Director y Coordinador)
        try {
            const realStaff = await _cGetStaff(db, me.clubId, fns, ['director', 'coordinator', 'club_admin', 'admin']);
            
            // Purgar contactos de staff que NO están realmente en Firestore
            const realStaffUids = new Set(realStaff.map(s => s.uid || s.id));
            const realStaffEmails = new Set(realStaff.map(s => (s.email || '').toLowerCase()).filter(Boolean));
            emailConfig.contacts = (emailConfig.contacts || []).filter(c => {
                if (c.type === 'parent') return true;
                if (c.uid === me.uid || c.type === 'coach') return true;
                const isRealUid = c.uid && realStaffUids.has(c.uid);
                const isRealEmail = c.email && realStaffEmails.has((c.email || '').toLowerCase());
                return isRealUid || isRealEmail;
            });

            realStaff.forEach(s => {
                const uid = s.uid || s.id;
                const email = s.email || '';
                const exists = (emailConfig.contacts || []).find(c => (uid && c.uid === uid) || (email && c.email === email));
                if (!exists) {
                    const roleLabel = (s.role === 'director' || s.role === 'club_admin' || s.role === 'admin') ? 'Director Deportivo' : 'Coordinador';
                    emailConfig.contacts.push({
                        id: 's_' + (uid || Math.random().toString(36).substr(2,6)),
                        name: s.displayName || s.name || roleLabel,
                        email: email,
                        phone: s.phone || '',
                        uid: uid || '',
                        role: s.role || 'staff',
                        type: 'staff',
                        tags: ['rpt', 'msg', 'cv', 'tr', 'live']
                    });
                }
            });
        } catch(sErr) { console.warn('[Contactos] Error cargando staff:', sErr); }

        // 2. Cargar Padres reales de Firestore (cronos_player_links de la categoría y subcategoría del entrenador)
        links.forEach(l => {
            const cat = l.category || l.categoryLabel || l.teamName || '';
            const sub = l.subcategory || '';
            if (_catAndSubcatMatch(coachCat, coachSub, cat, sub)) {
                const pUid = l.parentUid || l.uid || l._id;
                const pEmail = l.parentEmail || '';
                const exists = (emailConfig.contacts || []).find(c => c.type === 'parent' && ((pUid && (c.uid === pUid || c.id === pUid)) || (pEmail && c.email === pEmail)));
                if (!exists) {
                    emailConfig.contacts.push({
                        id: pUid,
                        name: l.parentName || l.parentEmail || 'Padre/Tutor',
                        player: l.playerAlias || l.playerName || 'Jugador',
                        playerId: l.playerId || ('J' + (l.playerNumber || '')),
                        playerNumber: l.playerNumber || '',
                        uid: pUid,
                        email: pEmail,
                        phone: l.parentPhone || l.parentWA || '',
                        type: 'parent',
                        category: l.category || coachCat,
                        subcategory: l.subcategory || coachSub,
                        tags: ['rpt', 'msg', 'cv', 'tr', 'live']
                    });
                }
            }
        });

        // 3. Cargar Usuarios con rol de Padre registrados en Firestore para la categoría/subcategoría
        try {
            const parentUsersSnap = await getDocs(query(
                collection(db, 'users'),
                where('clubId', '==', me.clubId || ''),
                where('role', '==', 'parent')
            ));
            parentUsersSnap.forEach(d => {
                const u = d.data();
                const uUid = d.id;
                const cat = u.category || u.categoryLabel || '';
                const sub = u.subcategory || '';
                if (_catAndSubcatMatch(coachCat, coachSub, cat, sub)) {
                    const exists = (emailConfig.contacts || []).find(c => c.type === 'parent' && (c.uid === uUid || (u.email && c.email === u.email)));
                    if (!exists) {
                        emailConfig.contacts.push({
                            id: uUid,
                            name: u.displayName || u.name || u.email || 'Padre/Tutor',
                            player: u.playerAlias || u.playerName || u.childName || 'Jugador',
                            playerId: u.playerId || '',
                            playerNumber: u.playerNumber || '',
                            uid: uUid,
                            email: u.email || '',
                            phone: u.phone || '',
                            type: 'parent',
                            category: cat || coachCat,
                            subcategory: sub || coachSub,
                            tags: ['rpt', 'msg', 'cv', 'tr', 'live']
                        });
                    }
                }
            });
        } catch(pErr) { console.warn('[Contactos] Error buscando usuarios padres:', pErr); }

        const modal = document.getElementById('setup-modal');
        modal.style.display = 'flex';
        // 2. FUSIÓN: Asegurar que el Coach esté en la lista de Staff si no está
        const contacts = emailConfig.contacts || [];
        const coachExists = contacts.find(c => c.uid === me.uid);
        if (!coachExists) {
            contacts.push({
                id: 'coach_' + me.uid,
                name: (me.displayName || me.email || 'Entrenador') + ' (TÚ)',
                email: me.email || '',
                phone: '', // El coach puede añadirlo si quiere
                uid: me.uid,
                type: 'coach',
                tags: ['rpt', 'msg', 'cv', 'tr', 'live'] // Por defecto todo activo para el coach
            });
            // Guardar localmente para esta sesión hasta que dé a "Guardar"
            emailConfig.contacts = contacts;
        }

        // --- CARGAR PLANTILLA PARA VINCULACIÓN ---
        const rosterData = JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[], "f11":[]}');
        const currentSquad = rosterData[currentMode || 'f11'] || [];
        window._cronos_squad_cache = currentSquad; // Caché global para renderParentRowMarkup

        modal.innerHTML = `
        <div class="modal-content" style="width:min(98vw,870px);max-height:92vh;
             display:flex;flex-direction:column;padding:0;overflow:hidden;">

            <!-- ── CABECERA FIJA ── -->
            <div style="padding:1rem 1.2rem 0.7rem;flex-shrink:0;
                        border-bottom:1px solid var(--glass-border);">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:1.4rem;">📱</span>
                        <h2 style="margin:0;font-size:1.1rem;font-family:'Outfit',sans-serif;">
                            Gestión de Contactos
                        </h2>
                    </div>
                    <button onclick="openUnifiedCommsMenu()"
                        style="background:none;border:none;color:var(--text-muted);
                               font-size:1.6rem;cursor:pointer;line-height:1;" title="Volver a Comunicaciones">✕</button>
                </div>
                <p style="font-size:0.72rem;color:var(--text-muted);margin:0.3rem 0 0;">
                    Define quién recibe informes, convocatorias y avisos. Secciones independientes.
                </p>
            </div>

            <!-- ── ZONA DE SCROLL ÚNICA ── -->
            <div style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;
                        padding:1rem 1rem 0.5rem;">

                <!-- ══ SECCIÓN 1: STAFF / DIRECTIVOS ══ -->
                <div style="border:1px solid rgba(88,166,255,0.25);border-radius:12px;
                            background:rgba(88,166,255,0.03);margin-bottom:1.2rem;">

                    <!-- Cabecera sección -->
                    <div style="padding:0.7rem 1rem;border-bottom:1px solid rgba(88,166,255,0.2);
                                display:flex;justify-content:space-between;align-items:center;
                                flex-wrap:wrap;gap:0.5rem;">
                        <div>
                            <h3 style="font-size:0.88rem;color:var(--primary);margin:0;font-weight:700;">
                                📋 Staff y Directivos
                            </h3>
                            <p style="font-size:0.67rem;color:var(--text-muted);margin:0.1rem 0 0;">
                                Director deportivo, coordinadores, delegados, etc.
                            </p>
                        </div>
                        <button onclick="addNewContactRow()" class="btn"
                            style="padding:0.35rem 0.9rem;font-size:0.72rem;
                                   background:var(--primary);color:#0a0e14;border:none;
                                   border-radius:6px;font-weight:700;white-space:nowrap;flex-shrink:0;">
                            ➕ AÑADIR STAFF
                        </button>
                    </div>

                    <!-- Tabla con scroll horizontal solo si es necesario -->
                    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0.5rem;">
                        <table style="width:100%;min-width:560px;font-size:0.75rem;border-collapse:collapse;"
                               id="table-custom-contacts">
                            <thead>
                                <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.1);
                                           text-align:left;">
                                    <th style="padding:0.45rem;min-width:120px;">NOMBRE / CARGO</th>
                                    <th style="padding:0.45rem;min-width:130px;">EMAIL</th>
                                    <th style="padding:0.45rem;min-width:110px;">WHATSAPP</th>
                                    <th style="padding:0.45rem;min-width:100px;">UID (APP)</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Convocatorias">CONV.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Entrenamientos">ENTR.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Mensajes">MSJ.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Informes">INF.</th>
                                    <th style="padding:0.45rem;text-align:center;color:#ff5858;">EN VIVO 📡</th>
                                    <th style="padding:0.45rem;"></th>
                                </tr>
                            </thead>
                            <tbody id="tbody-custom-contacts">
                                ${emailConfig.contacts.filter(c => c.type !== 'parent').map(c => renderContactRowMarkup(c)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- ══ SECCIÓN 2: PADRES / TUTORES ══ -->
                <div style="border:1px solid rgba(240,136,62,0.25);border-radius:12px;
                            background:rgba(240,136,62,0.02);margin-bottom:1rem;">

                    <!-- Cabecera sección -->
                    <div style="padding:0.7rem 1rem;border-bottom:1px solid rgba(240,136,62,0.2);
                                display:flex;justify-content:space-between;align-items:center;
                                flex-wrap:wrap;gap:0.5rem;background:rgba(240,136,62,0.04);
                                border-radius:12px 12px 0 0;">
                        <div>
                            <h3 style="font-size:0.88rem;color:var(--secondary);margin:0;font-weight:700;">
                                👨‍👩‍👧‍👦 Padres / Tutores
                            </h3>
                            <p style="font-size:0.67rem;color:var(--text-muted);margin:0.1rem 0 0;">
                                Los vinculados por plantilla aparecen automáticamente. Puedes añadir más.
                            </p>
                        </div>
                        <button onclick="addNewParentRow()" class="btn"
                            style="padding:0.35rem 0.9rem;font-size:0.72rem;
                                   background:var(--secondary);color:#0a0e14;border:none;
                                   border-radius:6px;font-weight:700;white-space:nowrap;flex-shrink:0;">
                            ➕ AÑADIR PADRE/TUTOR
                        </button>
                    </div>

                    <!-- Tabla con scroll horizontal solo si es necesario -->
                    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0.5rem;">
                        <table style="width:100%;min-width:580px;font-size:0.74rem;border-collapse:collapse;">
                            <thead>
                                <tr style="color:var(--text-muted);border-bottom:1px solid rgba(255,255,255,0.1);">
                                    <th style="padding:0.45rem;text-align:left;min-width:120px;">JUGADOR / NOMBRE</th>
                                    <th style="padding:0.45rem;text-align:left;min-width:40px;">N°</th>
                                    <th style="padding:0.45rem;text-align:left;min-width:110px;">WHATSAPP</th>
                                    <th style="padding:0.45rem;text-align:left;min-width:130px;">EMAIL</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Convocatorias">CONV.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Entrenamientos">ENTR.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Mensajes">MSJ.</th>
                                    <th style="padding:0.45rem;text-align:center;" title="Informes">INF.</th>
                                    <th style="padding:0.45rem;text-align:center;color:#ff5858;">EN VIVO 📡</th>
                                    <th style="padding:0.45rem;"></th>
                                </tr>
                            </thead>
                            <tbody id="tbody-parent-contacts">
                                ${links.sort((a,b) => (a.playerNumber||0)-(b.playerNumber||0)).map(link => `
                                <tr class="parent-contact-row firestore-linked" data-linkid="${typeof escapeAttr==='function'?escapeAttr(link._id):link._id}"
                                    style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:0.45rem;font-weight:600;">
                                        ${typeof escapeHtml==='function'?escapeHtml(link.playerAlias || link.playerName || 'Jugador'):link.playerAlias || link.playerName || 'Jugador'}
                                        <span style="font-size:0.6rem;color:var(--text-muted);
                                                     margin-left:3px;background:rgba(255,255,255,0.06);
                                                     border-radius:3px;padding:1px 4px;">vinculado</span>
                                    </td>
                                    <td style="padding:0.45rem;font-weight:700;color:var(--primary);">#${typeof escapeAttr==='function'?escapeAttr(link.playerNumber):link.playerNumber}</td>
                                    <td style="padding:0.45rem;">
                                        <span style="background:rgba(240,136,62,0.12);color:#f0883e;font-size:0.7rem;font-weight:700;padding:1px 6px;border-radius:4px;cursor:help;" title="Código que el padre introduce al registrarse">
                                            🔑 ${typeof escapeHtml==='function'?escapeHtml(link.inviteCode || ('J'+link.playerNumber)):link.inviteCode || ('J'+link.playerNumber)}
                                        </span>
                                    </td>
                                    <td style="padding:0.45rem;">
                                        <input type="text" class="contact-phone" data-linkid="${typeof escapeAttr==='function'?escapeAttr(link._id):link._id}"
                                            value="${typeof escapeAttr==='function'?escapeAttr(link.parentPhone||''):link.parentPhone||''}" placeholder="34600112233"
                                            style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);
                                                   border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                                                   color:white;font-size:0.72rem;box-sizing:border-box;">
                                    </td>
                                    <td style="padding:0.45rem;">
                                        <input type="email" class="contact-parent-email" data-linkid="${typeof escapeAttr==='function'?escapeAttr(link._id):link._id}"
                                            value="${typeof escapeAttr==='function'?escapeAttr(link.parentEmail||''):link.parentEmail||''}" placeholder="padre@email.com"
                                            style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);
                                                   border:1px solid rgba(255,255,255,0.1);border-radius:6px;
                                                   color:white;font-size:0.72rem;box-sizing:border-box;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-cv" data-linkid="${link._id}"
                                            ${link.canReceiveConv !== false ? 'checked' : ''} style="width:16px;height:16px;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-tr" data-linkid="${link._id}"
                                            ${link.canReceiveTr !== false ? 'checked' : ''} style="width:16px;height:16px;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-msg" data-linkid="${link._id}"
                                            ${link.canReceiveMsg !== false ? 'checked' : ''} style="width:16px;height:16px;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-rpt" data-linkid="${link._id}"
                                            ${link.canReceiveReports ? 'checked' : ''} style="width:16px;height:16px;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;">
                                        <input type="checkbox" class="contact-live" data-linkid="${link._id}"
                                            ${link.canWatchLive ? 'checked' : ''}
                                            style="width:16px;height:16px;accent-color:#ff5858;">
                                    </td>
                                    <td style="padding:0.45rem;text-align:center;color:var(--text-muted);
                                               font-size:0.65rem;">—</td>
                                </tr>`).join('')}
                                ${emailConfig.contacts.filter(c => c.type === 'parent').map(c => renderParentRowMarkup(c)).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div><!-- fin scroll único -->

            <!-- ── BOTONES FIJOS ABAJO ── -->
            <div style="padding:0.8rem 1rem;border-top:1px solid var(--glass-border);
                        display:flex;gap:0.7rem;flex-shrink:0;background:var(--surface);">
                <button onclick="openUnifiedCommsMenu()" class="btn" style="flex:1;">← VOLVER</button>
                <button onclick="saveContactManagerData()" class="btn primary"
                    style="flex:2;font-weight:bold;">
                    💾 GUARDAR CAMBIOS
                </button>
            </div>
        </div>`;
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error: ' + e.message, 4000);
    }
}

async function saveContactManagerData() {
    const parentInputs = document.querySelectorAll('.contact-phone');
    const customRows   = document.querySelectorAll('.custom-contact-row');
    const db = window._cronos_auth.db;
    showSpinner('Sincronizando Fuente de la Verdad…');

    try {
        const { updateDoc, doc } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

        // 1. Guardar datos completos de Padres (en cronos_player_links)
        // También genera el inviteCode (J{número}) si no existe todavía,
        // para que el padre pueda auto-registrarse con ese código.
        for (const input of parentInputs) {
            const linkId      = input.dataset.linkid;
            const phone       = input.value.trim().replace(/\s/g, '');
            const emailEl     = document.querySelector(`.contact-parent-email[data-linkid="${linkId}"]`);
            const cvEl        = document.querySelector(`.contact-cv[data-linkid="${linkId}"]`);
            const trEl        = document.querySelector(`.contact-tr[data-linkid="${linkId}"]`);
            const msgEl       = document.querySelector(`.contact-msg[data-linkid="${linkId}"]`);
            const rptEl       = document.querySelector(`.contact-rpt[data-linkid="${linkId}"]`);
            const liveEl      = document.querySelector(`.contact-live[data-linkid="${linkId}"]`);

            // Extraer playerNumber del linkId ({clubId}_{playerNumber})
            const playerNum = linkId.includes('_') ? linkId.split('_').pop() : null;
            // inviteCode = 'J' + playerNumber (ej: J10, J7, J1)
            const inviteCode = playerNum ? `J${playerNum}` : null;

            const updateData = {
                parentPhone:        phone,
                parentEmail:        emailEl   ? emailEl.value.trim()   : undefined,
                canWatchLive:       liveEl    ? liveEl.checked          : false,
                canReceiveReports:  rptEl     ? rptEl.checked           : false,
                canReceiveConv:     cvEl      ? cvEl.checked            : true,
                canReceiveTr:       trEl      ? trEl.checked            : true,
                canReceiveMsg:      msgEl     ? msgEl.checked           : true,
            };
            // Solo añadir inviteCode si no existía ya (para no sobreescribir)
            if (inviteCode) updateData.inviteCode = inviteCode;

            await updateDoc(doc(db, 'cronos_player_links', linkId), updateData);
        }

        // 2. Guardar Lista Unificada de Contactos (en emailConfig)
        const updatedContacts = [];

        // 2a. Staff y Coach (filas de la tabla azul)
        document.querySelectorAll('.custom-contact-row').forEach(row => {
            const tags = [];
            if (row.querySelector('.tag-cv').checked)   tags.push('cv');
            if (row.querySelector('.tag-tr').checked)   tags.push('tr');
            if (row.querySelector('.tag-msg').checked)  tags.push('msg');
            if (row.querySelector('.tag-rpt').checked)  tags.push('rpt');
            if (row.querySelector('.tag-live').checked) tags.push('live');

            updatedContacts.push({
                id:    row.dataset.id || ('c_' + Math.random().toString(36).substr(2,6)),
                type:  row.dataset.type || 'staff',
                name:  row.querySelector('.c-name').value.trim(),
                email: row.querySelector('.c-email').value.trim(),
                phone: row.querySelector('.c-phone').value.trim().replace(/\s/g, ''),
                uid:   row.querySelector('.c-uid').value.trim(),
                tags
            });
        });

        // 2b. Padres añadidos manualmente (filas de la tabla naranja, clase manual-parent)
        document.querySelectorAll('.manual-parent').forEach(row => {
            const tags = [];
            if (row.querySelector('.p-cv').checked)   tags.push('cv');
            if (row.querySelector('.p-tr').checked)   tags.push('tr');
            if (row.querySelector('.p-msg').checked)  tags.push('msg');
            if (row.querySelector('.p-rpt').checked)  tags.push('rpt');
            if (row.querySelector('.p-live').checked) tags.push('live');

            const pPlayerEl = row.querySelector('.p-player');
            const playerId = pPlayerEl.value;
            const playerName = playerId ? pPlayerEl.options[pPlayerEl.selectedIndex].text.split('] ')[1] : '';

            updatedContacts.push({
                id:     row.dataset.id || ('p_' + Math.random().toString(36).substr(2,6)),
                type:   'parent',
                name:   row.querySelector('.p-name').value.trim(),
                player: playerName,   // Para visualización legacy
                playerId: playerId,   // El vínculo inequivoco
                phone:  row.querySelector('.p-phone').value.trim().replace(/\s/g, ''),
                email:  row.querySelector('.p-email').value.trim(),
                tags
            });
        });

        if (typeof emailConfig !== 'undefined') {
            emailConfig.contacts = updatedContacts;
            
            // Mantener compatibilidad con campos antiguos por si acaso se usan en otros scripts legacy
            const firstReport = updatedContacts.find(c => c.tags.includes('reports'));
            if (firstReport) {
                emailConfig.directorEmail = firstReport.email;
                emailConfig.whatsappNumber = firstReport.phone;
            }

            if (typeof cloudSet === 'function') {
                await cloudSet('cronos_email_config', JSON.stringify(emailConfig));
            }
        }

        hideSpinner();
        showToast('✅ Fuente de la Verdad actualizada', 3000);
        openUnifiedCommsMenu();
        if (typeof _loadParentList === 'function') _loadParentList(); 
        
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error al guardar: ' + e.message, 4000);
    }
}

// ── FUNCIONES AUXILIARES PARA EL GESTOR DE CONTACTOS ──────────────────

// Fila de STAFF (tabla azul)
function renderContactRowMarkup(c = {}) {
    const isCv  = (c.tags || []).includes('cv');
    const isTr  = (c.tags || []).includes('tr');
    const isMsg = (c.tags || []).includes('msg');
    const isRpt = (c.tags || []).includes('rpt');
    const isLive = (c.tags || []).includes('live');
    const id = c.id || ('new_' + Date.now());
    const isCoach = c.type === 'coach';

    return `
    <tr class="custom-contact-row" data-id="${typeof escapeAttr==='function'?escapeAttr(id):id}" data-type="${typeof escapeAttr==='function'?escapeAttr(c.type||'staff'):c.type||'staff'}" 
        style="border-bottom:1px solid rgba(255,255,255,0.05); ${isCoach ? 'background:rgba(88,166,255,0.03);' : ''}">
        <td style="padding:0.4rem;">
            <input type="text" class="c-name" value="${typeof escapeAttr==='function'?escapeAttr(c.name||''):c.name||''}" placeholder="Nombre / Cargo"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="email" class="c-email" value="${typeof escapeAttr==='function'?escapeAttr(c.email||''):c.email||''}" placeholder="email@ejemplo.com"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="tel" class="c-phone" value="${typeof escapeAttr==='function'?escapeAttr(c.phone||''):c.phone||''}" placeholder="34600000000"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.75rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="text" class="c-uid" value="${typeof escapeAttr==='function'?escapeAttr(c.uid||''):c.uid||''}" placeholder="ID App (opcional)"
                style="width:100%;padding:0.35rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-muted);font-size:0.7rem;"
                ${isCoach ? 'readonly' : ''}>
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-cv" ${isCv ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-tr" ${isTr ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-msg" ${isMsg ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-rpt" ${isRpt ? 'checked' : ''} style="width:16px;height:16px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="tag-live" ${isLive ? 'checked' : ''}
                style="width:16px;height:16px;accent-color:#ff5858;"
                title="Puede ver los partidos en vivo">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            ${isCoach ? '<span title="Tú" style="font-size:1rem; cursor:help;">👤</span>' : 
            `<button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#ff5858;cursor:pointer;font-size:1rem;" title="Eliminar">🗑️</button>`}
        </td>
    </tr>`;
}

// Fila de PADRE/TUTOR manual (tabla naranja)
function renderParentRowMarkup(c = {}) {
    const isCv = (c.tags || []).includes('cv');
    const isTr = (c.tags || []).includes('tr');
    const isMsg = (c.tags || []).includes('msg');
    const isRpt = (c.tags || []).includes('rpt');
    const isLive = (c.tags || []).includes('live');
    const id = c.id || ('new_' + Date.now());

    return `
    <tr class="parent-contact-row manual-parent" data-id="${typeof escapeAttr==='function'?escapeAttr(id):id}"
        style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:0.4rem;">
            <input type="text" class="p-name" value="${typeof escapeAttr==='function'?escapeAttr(c.name||''):c.name||''}" placeholder="Nombre padre/madre"
                style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
        </td>
        <td style="padding:0.4rem;">
            <select class="p-player" style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
                <option value="">-- Seleccionar Jugador --</option>
                ${(window._cronos_squad_cache || []).map(p => `
                    <option value="${typeof escapeAttr==='function'?escapeAttr(p.id):p.id}" ${c.playerId === p.id ? 'selected' : ''}>
                        [${typeof escapeHtml==='function'?escapeHtml(p.id):p.id}] ${typeof escapeHtml==='function'?escapeHtml(p.alias||p.name||'Sin nombre'):p.alias||p.name||'Sin nombre'}
                    </option>
                `).join('')}
            </select>
        </td>
        <td style="padding:0.4rem;">
            <input type="tel" class="p-phone" value="${typeof escapeAttr==='function'?escapeAttr(c.phone||''):c.phone||''}" placeholder="34600000000"
                style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
        </td>
        <td style="padding:0.4rem;">
            <input type="email" class="p-email" value="${typeof escapeAttr==='function'?escapeAttr(c.email||''):c.email||''}" placeholder="padre@email.com"
                style="width:100%;padding:0.32rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:0.73rem;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-cv" ${isCv ? 'checked' : ''} style="width:15px;height:15px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-tr" ${isTr ? 'checked' : ''} style="width:15px;height:15px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-msg" ${isMsg ? 'checked' : ''} style="width:15px;height:15px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-rpt" ${isRpt ? 'checked' : ''} style="width:15px;height:15px;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <input type="checkbox" class="p-live" ${isLive ? 'checked' : ''}
                style="width:15px;height:15px;accent-color:#ff5858;">
        </td>
        <td style="padding:0.4rem;text-align:center;">
            <button onclick="this.closest('tr').remove()" style="background:none;border:none;color:#ff5858;cursor:pointer;font-size:1rem;" title="Eliminar">🗑️</button>
        </td>
    </tr>`;
}

// Añadir fila vacía en la tabla de STAFF
window.addNewContactRow = () => {
    const tbody = document.getElementById('tbody-custom-contacts');
    if (!tbody) return;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = `<table>${renderContactRowMarkup({})}</table>`;
    const newRow = tempDiv.querySelector('tr');
    tbody.appendChild(newRow);
    newRow.querySelector('.c-name').focus();
};

// Añadir fila vacía en la tabla de PADRES
window.addNewParentRow = () => {
    const tbody = document.getElementById('tbody-parent-contacts');
    if (!tbody) return;
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = `<table>${renderParentRowMarkup({})}</table>`;
    const newRow = tempDiv.querySelector('tr');
    tbody.appendChild(newRow);
    newRow.querySelector('.p-name').focus();
};


// ════════════════════════════════════════════════════════════════════
//  NOTIFICACIÓN DE ENTRENAMIENTO (faltaba - bug #9)
// ════════════════════════════════════════════════════════════════════
async function openTrainingNotification() {
    const me    = window._cronosCurrentUser;
    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    // Quitar setup-mode del body al abrir esta modal — evita el warning
    // de patches.js que detecta setup-mode + partido visible sin modal de setup
    document.body.classList.remove('setup-mode');

    // Pre-cargar caché de contactos con flag 'tr'
    if (typeof window._cronos_getContactsByFlag === 'function' && !window._cronosContactsCache) {
        window._cronos_getContactsByFlag('tr').catch(() => {});
    }

    // Restaurar último entrenamiento enviado
    const saved = JSON.parse(localStorage.getItem('cronos_last_training') || '{}');

    // Auto-rellenar fecha/lugar desde la planificación semanal actual
    const _trOffset = window._trWeekOffset || 0;
    const _trMon = (function() {
        const now = new Date(); const dow = now.getDay();
        const m = new Date(now); m.setDate(now.getDate() - (dow===0?6:dow-1) + _trOffset*7);
        m.setHours(0,0,0,0); return m;
    })();
    const _trWeekKey = _trMon.toISOString().substring(0,10);
    const _trWeekAll = JSON.parse(localStorage.getItem('cronos_training_weeks') || '{}');
    const _trWeekData = _trWeekAll[_trWeekKey] || {};
    const _trFirstDs = Object.keys(_trWeekData).sort()[0];
    const _trFirst = _trFirstDs ? (_trWeekData[_trFirstDs] || {}) : {};
    const _autoLoc = _trFirst.lugar || saved.location || '';
    const _autoDt = (_trFirstDs && _trFirst.hora)
        ? (new Date(_trFirstDs + 'T' + _trFirst.hora + ':00').toISOString().slice(0,16))
        : (saved.datetime || '');
    const _autoNotes = saved.notes || '';

    // HTML de destinatarios (igual que convocatoria)
    const recipientsHTML = (typeof window.sharedBuildRecipientsHTML === 'function')
        ? window.sharedBuildRecipientsHTML(saved.recipients, 'tr')
        : '<div style="color:var(--text-muted);font-size:0.78rem;padding:0.5rem;">⏳ Cargando contactos…</div>';

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,560px);max-height:92vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">

        <!-- CABECERA -->
        <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;color:#f0883e;">📅 Aviso de Entrenamiento</h3>
            <button onclick="openUnifiedCommsMenu()"
                style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- BODY SCROLL -->
        <div style="flex:1;overflow-y:auto;padding:1rem 1.2rem;">
            <div style="display:grid;gap:0.7rem;">

                <!-- Fecha y hora -->
                <div>
                    <label style="font-size:0.76rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">📅 Fecha y hora</label>
                    <input type="datetime-local" id="tr-datetime"
                        value="${_autoDt}"
                        style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);
                               border:1px solid rgba(255,255,255,0.1);border-radius:8px;
                               color:white;font-size:0.85rem;box-sizing:border-box;">
                </div>

                <!-- Lugar / Campo -->
                <div>
                    <label style="font-size:0.76rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">📍 Lugar / Campo</label>
                    <input type="text" id="tr-location"
                        value="${typeof escapeAttr==='function'?escapeAttr(_autoLoc):_autoLoc}"
                        placeholder="Campo de fútbol…"
                        style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);
                               border:1px solid rgba(255,255,255,0.1);border-radius:8px;
                               color:white;font-size:0.85rem;box-sizing:border-box;">
                </div>

                <!-- Notas -->
                <div>
                    <label style="font-size:0.76rem;color:var(--text-muted);display:block;margin-bottom:0.3rem;">📝 Notas adicionales</label>
                    <textarea id="tr-notes" rows="3"
                        placeholder="Cambio de horario, ropa especial, material necesario…"
                        style="width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);
                               border:1px solid rgba(255,255,255,0.1);border-radius:8px;
                               color:white;font-size:0.85rem;box-sizing:border-box;resize:none;">${typeof escapeHtml==='function'?escapeHtml(_autoNotes):_autoNotes}</textarea>
                </div>

                <!-- DESTINATARIOS — mismo diseño que convocatoria -->
                <div style="background:rgba(240,136,62,0.04);border:1px solid rgba(240,136,62,0.2);
                            border-radius:8px;padding:0.75rem;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
                        <div style="font-size:0.72rem;color:#f0883e;font-weight:700;">📤 ENVIAR A</div>
                        <div style="display:flex;gap:0.3rem;">
                            <button onclick="typeof sharedSelectAll==='function'&&sharedSelectAll(true,'tr')"
                                style="font-size:0.6rem;padding:0.18rem 0.5rem;background:rgba(88,166,255,0.1);
                                       border:1px solid rgba(88,166,255,0.3);border-radius:4px;color:var(--primary);cursor:pointer;">
                                ✓ Todos</button>
                            <button onclick="typeof sharedSelectAll==='function'&&sharedSelectAll(false,'tr')"
                                style="font-size:0.6rem;padding:0.18rem 0.5rem;background:rgba(255,255,255,0.05);
                                       border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--text-muted);cursor:pointer;">
                                ✗ Ninguno</button>
                            <button onclick="typeof sharedSavePreselection==='function'&&sharedSavePreselection('tr')"
                                style="font-size:0.6rem;padding:0.18rem 0.5rem;background:rgba(63,185,80,0.1);
                                       border:1px solid rgba(63,185,80,0.3);border-radius:4px;color:#3fb950;cursor:pointer;">
                                💾 Guardar</button>
                        </div>
                    </div>
                    <div id="tr-recipients-list" style="display:flex;flex-direction:column;gap:0.35rem;max-height:200px;overflow-y:auto;">
                        ${recipientsHTML}
                    </div>
                </div>

            </div>
        </div>

        <!-- FOOTER — igual que convocatoria -->
        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);
                    display:flex;gap:0.5rem;flex-shrink:0;">
            <button onclick="openUnifiedCommsMenu()" class="btn"
                style="color:var(--text-muted);padding:0.5rem 0.9rem;">← Volver</button>
            <button onclick="_sendTrainingNotification()"
                style="flex:1;padding:0.5rem;background:rgba(240,136,62,0.15);
                       border:1px solid rgba(240,136,62,0.4);border-radius:7px;
                       color:#f0883e;font-weight:700;cursor:pointer;font-size:0.85rem;">
                📱 Envío Interno
            </button>
        </div>
    </div>`;
}

window._sendTrainingNotification = async function() {
    const me       = window._cronosCurrentUser;
    const datetime = document.getElementById('tr-datetime')?.value || '';
    const location = document.getElementById('tr-location')?.value.trim() || '';
    const notes    = document.getElementById('tr-notes')?.value.trim() || '';

    if (!datetime && !location) {
        if (typeof showToast === 'function') showToast('⚠️ Indica al menos fecha/hora o lugar', 3000);
        return;
    }

    // Guardar para reutilizar la próxima vez
    const selectedIds = Array.from(document.querySelectorAll('.tr-recipient-chk:checked')).map(c => c.dataset.id);
    localStorage.setItem('cronos_last_training', JSON.stringify({ datetime, location, notes, recipients: selectedIds, savedAt: new Date().toISOString() }));
    localStorage.setItem('cronos_tr_preselection', JSON.stringify(selectedIds));

    if (typeof showSpinner === 'function') showSpinner('Enviando aviso de entrenamiento…');

    try {
        const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const fa = window._cronos_auth;
        const db = fa.db;

        const dtFmt = datetime
            ? new Date(datetime).toLocaleString('es-ES', {weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})
            : '—';

        const notifPayload = (uid) => ({
            type: 'planificacion_semanal', clubId: me.clubId || null,
            userId: uid,                                  // ← FIX (C3): campo que las reglas verifican
            parentUid: uid, coachUid: me.uid, coachEmail: me.email,
            datetime, location, notes,
            createdAt: new Date().toISOString(),
        });

        // Asegurar caché cargada antes de enviar
        if (typeof window._cronos_getContactsByFlag === 'function' && !window._cronosContactsCache) {
            await window._cronos_getContactsByFlag('tr');
        }

        // Fuente de verdad: flag 'tr' + seleccionados manualmente
        let trContacts = [];
        if (typeof window._cronos_getContactsByFlag === 'function') {
            trContacts = await window._cronos_getContactsByFlag('tr');
        }
        const manualSelected = (typeof window.sharedGetSelectedRecipients === 'function')
            ? window.sharedGetSelectedRecipients('tr')
            : [];

        const notifiedUids = new Set();
        let sentInternal = 0;

        for (const c of trContacts) {
            if (!c.uid || notifiedUids.has(c.uid)) continue;
            notifiedUids.add(c.uid);
            await setDoc(doc(db, 'cronos_notifications', 'tr_' + c.uid + '_' + Date.now().toString(36)), notifPayload(c.uid));
            sentInternal++;
        }
        for (const r of manualSelected) {
            // FIX: sharedGetSelectedRecipients ahora incluye uid; usar id como fallback
            const uid = r.uid || r.id;
            if (!uid || notifiedUids.has(uid)) continue;
            notifiedUids.add(uid);
            await setDoc(doc(db, 'cronos_notifications', 'tr_' + uid + '_' + Date.now().toString(36)), notifPayload(uid));
            sentInternal++;
        }

        if (typeof hideSpinner === 'function') hideSpinner();
        const msg = sentInternal > 0
            ? `✅ Entrenamiento enviado a ${sentInternal} persona(s) en la app`
            : '⚠️ 0 destinatarios — activa las palomillas ENTR. en Gestión de Contactos';
        if (typeof showToast === 'function') showToast(msg, 5000);
        openUnifiedCommsMenu();

    } catch(e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        if (typeof showToast  === 'function') showToast('⚠️ Error: ' + e.message, 4000);
        console.error('[TrainingNotif]', e);
    }
};

window.openTrainingNotification = openTrainingNotification;

async function openUnifiedCommsMenu() {
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
                <button onclick="typeof openSetupModal==='function'?openSetupModal():(document.getElementById('setup-modal').style.display='none');" 
                    style="background:none;border:none;color:var(--text-muted);font-size:1.7rem;cursor:pointer;line-height:1;padding:0 0.2rem;"
                    title="Volver al Panel del Entrenador">✕</button>
            </div>
        </div>

        <!-- Las 4 Opciones Exclusivas del Panel de Comunicaciones -->
        <div style="display:grid;grid-template-columns:1fr;gap:0.8rem;flex:1;overflow-y:auto;padding-right:2px;">

            <!-- 1. MENSAJES -->
            <button onclick="openCoachMessaging('parents')" class="btn-comms-card">
                <span class="icon">💬</span>
                <div class="content">
                    <div class="title">Mensajes</div>
                    <div class="desc">Chat con padres · dirección · coordinación</div>
                </div>
            </button>

            <!-- 2. PARTIDOS TERMINADOS -->
            <button onclick="typeof showFinishedMatches==='function'?showFinishedMatches():(typeof openPastMatchesModal==='function'?openPastMatchesModal():alert('No hay partidos terminados'))" class="btn-comms-card" style="--color:#ff5858;--bg:rgba(255,88,88,0.08);">
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
            <button onclick="if(typeof showLiveShareModal==='function') showLiveShareModal(); else window.open('./live.html','_blank');" class="btn-comms-card" style="--color:#ff5858;--bg:rgba(255,88,88,0.12);">
                <span class="icon">🔴</span>
                <div class="content">
                    <div class="title" style="color:#ff5858;">Partidos en Vivo</div>
                    <div class="desc">Ver partidos del club en directo</div>
                </div>
            </button>

        </div>

        <!-- Botón Volver Inferior -->
        <button onclick="typeof openSetupModal==='function'?openSetupModal():(document.getElementById('setup-modal').style.display='none');"
            style="width:100%;padding:0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);
                   border-radius:10px;color:white;font-weight:700;font-size:0.9rem;cursor:pointer;
                   display:flex;align-items:center;justify-content:center;gap:0.4rem;margin-top:0.3rem;">
            — Volver
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
    </style>`;
}

// ── Seleccionar / deseleccionar todos los padres ─────────────────────
window.toggleSelectAllParents = function(checked) {
    document.querySelectorAll('.parent-select-chk').forEach(chk => { chk.checked = checked; });
    updateBulkCount();
};

window.updateBulkCount = function() {
    const total = document.querySelectorAll('.parent-select-chk:checked').length;
    const countEl = document.getElementById('bulk-count');
    if (countEl) countEl.textContent = total + ' seleccionado' + (total !== 1 ? 's' : '');
};

// ── Compositor de mensaje grupal ──────────────────────────────────────
window.openBulkMessageComposer = function() {
    // Recopilar ABSOLUTAMENTE TODOS los que el usuario marcó con el checkbox
    const allSelected = Array.from(document.querySelectorAll('.parent-select-chk:checked'))
        .map(chk => {
            // Intentar buscar el contacto original en emailConfig para saber su tipo real
            const c = (emailConfig.contacts || []).find(x => x.id === chk.dataset.parentUid || x.email === chk.dataset.parentEmail);
            return {
                id:          chk.dataset.parentUid,
                type:        c ? c.type : 'parent',
                label:       chk.dataset.player + (chk.dataset.playerNum ? ` #${chk.dataset.playerNum}` : ''),
                parentUid:   chk.dataset.parentUid,
                parentEmail: chk.dataset.parentEmail,
                parentWA:    chk.dataset.parentWa,
                phone:       chk.dataset.parentWa,
                email:       chk.dataset.parentEmail,
            };
        });

    // Cargar preselección de mensajes guardada
    let savedMsgPresel = null;
    try { savedMsgPresel = JSON.parse(localStorage.getItem('cronos_msg_preselection') || 'null'); } catch(e) {}

    const allContacts = allSelected;

    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,540px);max-height:90vh;
         display:flex;flex-direction:column;gap:0.8rem;">

        <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;">✉️ Mensaje Grupal</h3>
            <button onclick="openCoachMessaging()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>

        <!-- Selector de destinatarios -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                    border-radius:10px;padding:0.8rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
                <span style="font-size:0.75rem;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;">
                    📤 DESTINATARIOS
                </span>
                <div style="display:flex;gap:0.4rem;">
                    <button onclick="document.querySelectorAll('.msg-recipient-chk').forEach(c=>c.checked=true)"
                        style="font-size:0.62rem;padding:0.18rem 0.55rem;background:rgba(88,166,255,0.1);
                               border:1px solid rgba(88,166,255,0.3);border-radius:4px;color:var(--primary);cursor:pointer;">
                        ✓ Todos
                    </button>
                    <button onclick="document.querySelectorAll('.msg-recipient-chk').forEach(c=>c.checked=false)"
                        style="font-size:0.62rem;padding:0.18rem 0.55rem;background:rgba(255,255,255,0.05);
                               border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:var(--text-muted);cursor:pointer;">
                        ✗ Ninguno
                    </button>
                    <button onclick="_msgSavePreselection()"
                        style="font-size:0.62rem;padding:0.18rem 0.55rem;background:rgba(63,185,80,0.1);
                               border:1px solid rgba(63,185,80,0.3);border-radius:4px;color:#3fb950;cursor:pointer;">
                        💾 Guardar
                    </button>
                </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.35rem;max-height:200px;overflow-y:auto;padding-right:4px;">
                ${allContacts.length ? allContacts.map(c => {
                    const isChecked = savedMsgPresel ? savedMsgPresel.includes(c.id) : true;
                    const typeColor  = c.type === 'staff' ? 'rgba(88,166,255,0.12)' : 'rgba(63,185,80,0.08)';
                    const typeBorder = c.type === 'staff' ? 'rgba(88,166,255,0.25)' : 'rgba(63,185,80,0.2)';
                    return `
                    <label style="display:flex;align-items:center;gap:0.55rem;
                                   background:${typeColor};border:1px solid ${typeBorder};
                                   border-radius:7px;padding:0.45rem 0.65rem;cursor:pointer;">
                        <input type="checkbox" class="msg-recipient-chk"
                            data-uid="${typeof escapeAttr==='function'?escapeAttr(c.parentUid||''):c.parentUid||''}"
                            data-email="${typeof escapeAttr==='function'?escapeAttr(c.parentEmail):c.parentEmail}"
                            data-wa="${typeof escapeAttr==='function'?escapeAttr(c.parentWA):c.parentWA}"
                            data-id="${typeof escapeAttr==='function'?escapeAttr(c.id):c.id}"
                            ${isChecked ? 'checked' : ''}
                            style="width:15px;height:15px;flex-shrink:0;accent-color:var(--primary);">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.78rem;font-weight:600;">${typeof escapeHtml==='function'?escapeHtml(c.label):c.label}</div>
                            <div style="font-size:0.63rem;color:var(--text-muted);">
                                ${c.phone ? `📱 ${typeof escapeHtml==='function'?escapeHtml(c.phone):c.phone}` : ''}${c.phone && c.email ? ' · ' : ''}${c.email ? `📧 ${typeof escapeHtml==='function'?escapeHtml(c.email):c.email}` : ''}
                            </div>
                        </div>
                        ${c.phone ? `<span style="font-size:0.58rem;background:rgba(37,211,102,0.15);border:1px solid rgba(37,211,102,0.3);border-radius:3px;padding:1px 4px;color:#3fb950;">WA</span>` : ''}
                        ${c.email ? `<span style="font-size:0.58rem;background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.25);border-radius:3px;padding:1px 4px;color:var(--primary);">Email</span>` : ''}
                    </label>`;
                }).join('') : `<div style="text-align:center;color:var(--text-muted);font-size:0.78rem;padding:0.8rem;">
                    ⚠️ No hay contactos. Ve a Gestión de Contactos para configurarlos.
                </div>`}
            </div>
        </div>

        <!-- Redactor -->
        <div style="flex:1;display:flex;flex-direction:column;gap:0.4rem;">
            <label style="font-size:0.75rem;color:var(--text-muted);">Mensaje</label>
            <textarea id="bulk-msg-text" rows="5"
                placeholder="Escribe aquí el mensaje para los destinatarios seleccionados…"
                style="flex:1;padding:0.7rem;background:rgba(255,255,255,0.05);
                       border:1px solid var(--glass-border);border-radius:8px;
                       color:white;font-size:0.88rem;resize:vertical;
                       box-sizing:border-box;width:100%;"></textarea>
        </div>

        <!-- Botones -->
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;flex-shrink:0;">
            <button onclick="openCoachMessaging()" class="btn"
                style="color:var(--text-muted);font-size:0.78rem;flex:1;">← Volver</button>
            <button onclick="_sendBulkMsgFirestore()" class="btn"
                style="background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.4);
                       color:var(--primary);font-weight:700;font-size:0.78rem;flex:1.5;">
                📱 Envío Interno
            </button>
            <button onclick="_sendBulkMsgWA()" class="btn"
                style="background:rgba(37,211,102,0.15);border-color:rgba(37,211,102,0.4);
                       color:#25d366;font-weight:700;font-size:0.78rem;flex:1;">
                📱 WhatsApp
            </button>
            <button onclick="_sendBulkMsgEmail()" class="btn"
                style="background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.25);
                       color:var(--primary);font-weight:700;font-size:0.78rem;flex:1;">
                📧 Email
            </button>
        </div>
    </div>`;
};

// ── Guardar preselección de mensajes ─────────────────────────────────
window._msgSavePreselection = function() {
    const ids = Array.from(document.querySelectorAll('.msg-recipient-chk:checked')).map(c => c.dataset.id);
    localStorage.setItem('cronos_msg_preselection', JSON.stringify(ids));
    showToast('✅ Selección guardada como predeterminada', 2500);
};

// ── Obtener destinatarios seleccionados para mensaje ──────────────────
function _msgGetSelected() {
    return Array.from(document.querySelectorAll('.msg-recipient-chk:checked')).map(chk => ({
        parentUid:   chk.dataset.uid,
        parentEmail: chk.dataset.email,
        parentWA:    chk.dataset.wa,
    }));
}

// ── Envío grupal interno (Firestore) ──────────────────────────────────
window._sendBulkMsgFirestore = async function() {
    const me   = window._cronosCurrentUser;
    const fa   = window._cronos_auth;
    if (!fa || !me) return;
    const text = document.getElementById('bulk-msg-text')?.value.trim();
    if (!text) { showToast('⚠️ Escribe un mensaje antes de enviar', 3000); return; }

    const selected = _msgGetSelected().filter(s => s.parentUid);
    if (!selected.length) { showToast('⚠️ Selecciona al menos un destinatario con cuenta en la app', 3000); return; }

    showSpinner('Enviando mensaje a ' + selected.length + ' destinatarios…');
    try {
        const { db, doc, getDoc, setDoc, updateDoc, arrayUnion } = await _cFS();
        let sent = 0;
        for (const s of selected) {
            const threadId = `${me.uid}_${s.parentUid}`;
            const newMsg   = { sender: 'coach', text, timestamp: new Date().toISOString() };
            const preview  = text.length > 60 ? text.substring(0, 60) + '…' : text;
            const snap     = await getDoc(doc(db, 'cronos_messages', threadId));
            if (snap.exists()) {
                await updateDoc(doc(db, 'cronos_messages', threadId), {
                    messages: arrayUnion(newMsg), lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByParent: (snap.data().unreadByParent || 0) + 1,
                    // FIX (v180): campos de identidad
                    parentUid:    s.parentUid,
                    participants: arrayUnion(me.uid, s.parentUid),
                    clubId:       me.clubId || null,
                    recipientType: 'parent'
                });
            } else {
                await setDoc(doc(db, 'cronos_messages', threadId), {
                    threadId, coachUid: me.uid, coachEmail: me.email,
                    parentUid: s.parentUid, parentEmail: s.parentEmail,
                    // FIX (v180): campos de identidad
                    clubId: me.clubId || null,
                    participants: [me.uid, s.parentUid],
                    recipientType: 'parent',
                    messages: [newMsg], lastMessage: preview,
                    lastMessageAt: newMsg.timestamp,
                    unreadByCoach: 0, unreadByParent: 1
                });
            }
            sent++;
        }

        // --- LIMPIEZA POST-ENVÍO ---
        localStorage.removeItem('cronos_match_rpt_selection');
        hideSpinner();
        showToast(`✅ Mensaje enviado a ${sent} destinatario${sent !== 1 ? 's' : ''}`, 4000);
        openCoachMessaging();
    } catch(e) {
        hideSpinner();
        showToast('⚠️ Error: ' + e.message, 4000);
    }
};

// ── Envío grupal por WhatsApp ─────────────────────────────────────────
window._sendBulkMsgWA = function() {
    const text = document.getElementById('bulk-msg-text')?.value.trim();
    if (!text) { showToast('⚠️ Escribe un mensaje antes de enviar', 3000); return; }
    const withPhone = _msgGetSelected().filter(s => s.parentWA);
    if (!withPhone.length) {
        showToast('⚠️ Ningún destinatario seleccionado tiene WhatsApp configurado', 4000);
        return;
    }
    const encoded = encodeURIComponent(text);
    withPhone.forEach((s, i) => {
        setTimeout(() => {
            window.open(`https://wa.me/${s.parentWA}?text=${encoded}`, '_blank');
        }, i * 700);
    });
    showToast(`📱 WhatsApp abierto para ${withPhone.length} destinatario${withPhone.length !== 1 ? 's' : ''}`, 4000);
};

// ── Envío grupal por Email ───────────────────────────────────────────
window._sendBulkMsgEmail = function() {
    const text = document.getElementById('bulk-msg-text')?.value.trim();
    if (!text) { showToast('⚠️ Escribe un mensaje antes de enviar', 3000); return; }
    
    // El objeto c ya los guardó en data-email, por lo cual selected.parentEmail funciona
    const withEmail = _msgGetSelected().filter(s => s.parentEmail);
    if (!withEmail.length) {
        showToast('⚠️ Ningún destinatario seleccionado tiene Email configurado', 4000);
        return;
    }
    
    const subject = encodeURIComponent(`💬 Mensaje de Entrenador — ${new Date().toLocaleDateString('es-ES')}`);
    const body = encodeURIComponent(text.replace(/[*_]/g, ''));
    
    const toList = withEmail.map(s => s.parentEmail).join(',');
    window.open(`mailto:${toList}?subject=${subject}&body=${body}`, '_blank');
    showToast(`📧 Email abierto para ${withEmail.length} destinatario${withEmail.length !== 1 ? 's' : ''}`, 4000);
};


// ════════════════════════════════════════════════════════════════════
//  INFORME COLECTIVO → DIRECTORES Y COORDINADORES
// ════════════════════════════════════════════════════════════════════
window.openCollectiveReport = async function openCollectiveReport() {
    const me = window._cronosCurrentUser;
    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    // Obtener datos del partido actual si existe
    const hasLiveData = !!(window.players && window.players.length);
    const scoreHome = document.getElementById('score-home')?.textContent || '?';
    const scoreAway = document.getElementById('score-away')?.textContent || '?';
    const rival     = (typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES.away) || 'Rival';
    const matchDate = new Date().toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'});

    // Si no hay datos en vivo, intentar leer últimos informes de Firestore
    let playerData = [];
    if (hasLiveData) {
        playerData = (window.players || []).filter(p => p.team === _cMyTeamKey());
    } else {
        try {
            const { db, collection, getDocs, query, where, orderBy, limit } = await _cFS();
            const snap = await getDocs(query(
                collection(db,'cronos_player_reports'),
                where('clubId','==',me.clubId||''),
                orderBy('createdAt','desc'),
                limit(30)
            ));
            // Agrupar por el partido más reciente
            const reports = [];
            snap.forEach(d => reports.push({ id:d.id, ...d.data() }));
            if (reports.length) {
                const latestMatch = reports[0].matchDate;
                reports.filter(r => r.matchDate === latestMatch).forEach(r => {
                    playerData.push({
                        number: r.playerNumber, name: r.playerAlias,
                        time: 0, goals: r.goals||0, cards: r.cards||'ninguna',
                        injured: r.injured||false, history: r.history||[],
                        minutesPlayed: r.minutesPlayed,
                    });
                });
            }
        } catch(e) { console.warn('[collectiveReport]', e); }
    }

    // Construir texto del informe colectivo
    function buildCollectiveText() {
        let msg = `📊 *INFORME COLECTIVO DE PARTIDO*\n`;
        msg += `━━━━━━━━━━━━━━━━\n`;
        msg += `📅 ${matchDate}\n`;
        msg += `🆚 ${me.clubName||'Nuestro equipo'} ${scoreHome} – ${scoreAway} ${rival}\n\n`;

        // Línea de tiempo global (todos los eventos ordenados)
        const evIcon = { goal:'⚽ GOL', yellow:'🟨 TARJETA', red:'🟥 TARJETA', sub_in:'▼ CAMBIO·Entra', sub_out:'▲ CAMBIO·Sale', injury:'🚑 LESIÓN' };
        const allEvents = [];
        playerData.forEach(p => {
            const alias = p.name || 'Jugador';
            (p.history||[]).forEach(ev => {
                if (typeof ev === 'object' && ev.type) {
                    allEvents.push({ minute: ev.minute||0, type: ev.type, player: alias });
                }
            });
            // v218: sin '#<num>' en el fallback; solo el nombre del jugador.
            if (p.subInMinute)  allEvents.push({ minute:p.subInMinute,  type:'sub_in',  player:p.name||'Jugador' });
            if (p.subOutMinute) allEvents.push({ minute:p.subOutMinute, type:'sub_out', player:p.name||'Jugador' });
            if (p.injuryMinute) allEvents.push({ minute:p.injuryMinute, type:'injury',  player:p.name||'Jugador' });
        });
        allEvents.sort((a,b) => a.minute - b.minute);

        if (allEvents.length) {
            msg += `📋 *LÍNEA DE TIEMPO:*\n`;
            allEvents.forEach(ev => {
                msg += `• ${ev.minute}' ${evIcon[ev.type]||'•'} ${ev.player}\n`;
            });
            msg += '\n';
        }

        // Tabla de jugadores
        msg += `👥 *JUGADORES:*\n`;
        playerData.forEach(p => {
            const mins = p.minutesPlayed || (typeof formatTime==='function' ? formatTime(p.time||0) : '—');
            let line = `• ${p.name||'Jugador'} — ⏱${mins}`;
            if (p.goals > 0) line += ` ⚽${p.goals}`;
            if (p.cards === 'amarilla' || p.cards === 'yellow') line += ' 🟨';
            if (p.cards === 'roja'     || p.cards === 'red')    line += ' 🟥';
            if (p.injured) line += ' 🩹';
            msg += line + '\n';
        });

        msg += `\n_Cronos Fútbol · Informe Entrenador_ ⚽`;
        return msg;
    }

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,560px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">
        <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;color:#d2a8ff;">
                📊 Informe Colectivo → Dirección
            </h3>
            <button onclick="openUnifiedCommsMenu()"
                style="background:none;border:none;color:var(--text-muted);
                       font-size:1.3rem;cursor:pointer;">✕</button>
        </div>
        <div style="padding:1rem 1.2rem;flex:1;overflow-y:auto;">
            <!-- Info partido -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                        border-radius:8px;padding:0.75rem;margin-bottom:0.9rem;">
                <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.3rem;">Partido</div>
                <div style="font-weight:700;font-size:0.95rem;">
                    🆚 vs ${typeof escapeHtml==='function'?escapeHtml(rival):rival}
                    <span style="color:var(--primary);margin-left:0.5rem;">${scoreHome}–${scoreAway}</span>
                </div>
                <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.2rem;">📅 ${matchDate}</div>
            </div>
            <!-- Stats resumen -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.4rem;margin-bottom:0.9rem;">
                ${[
                    ['👥', playerData.length, 'Jugadores'],
                    ['⚽', playerData.reduce((s,p)=>s+(p.goals||0),0), 'Goles'],
                    ['🟨', playerData.filter(p=>p.cards&&p.cards!=='ninguna').length, 'Tarjetas'],
                    ['🩹', playerData.filter(p=>p.injured).length, 'Lesiones'],
                ].map(([ic,v,l]) => `
                <div style="background:rgba(255,255,255,0.03);border:1px solid var(--glass-border);
                            border-radius:7px;padding:0.5rem;text-align:center;">
                    <div>${ic}</div>
                    <div style="font-size:1.1rem;font-weight:800;color:white;">${v}</div>
                    <div style="font-size:0.6rem;color:var(--text-muted);">${l}</div>
                </div>`).join('')}
            </div>
            <!-- Destinatarios (directores/coordinadores) -->
            <div style="background:rgba(210,168,255,0.06);border:1px solid rgba(210,168,255,0.2);
                        border-radius:8px;padding:0.75rem;margin-bottom:0.9rem;">
                <div style="font-size:0.72rem;color:#d2a8ff;font-weight:700;margin-bottom:0.5rem;">
                    📤 DESTINATARIOS — Dirección deportiva del club
                </div>
                <div id="coll-rpt-staff-list" style="font-size:0.78rem;color:var(--text-muted);">
                    ⏳ Cargando…
                </div>
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.7rem;">
                💡 El informe también se enviará como notificación interna a la app.
            </div>
        </div>
        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);
                    display:flex;gap:0.5rem;flex-shrink:0;">
            <button onclick="openUnifiedCommsMenu()" class="btn"
                style="color:var(--text-muted);">← Volver</button>
            <button onclick="_sendCollectiveReportNow()"
                style="flex:1;padding:0.5rem;background:rgba(210,168,255,0.15);
                       border:1px solid rgba(210,168,255,0.4);border-radius:7px;
                       color:#d2a8ff;font-weight:700;cursor:pointer;font-size:0.85rem;">
                📊 Enviar Informe Colectivo
            </button>
        </div>
    </div>`;

    // Cargar directores/coordinadores destinatarios del informe
    // E3 (punto 3): FUENTE PRIMARIA = _cGetStaff (staff real del club por
    // clubId + roles director/coordinator, combinado internamente con
    // emailConfig). FUENTE COMPLEMENTARIA = contactos de emailConfig que no
    // estén ya incluidos. Antes emailConfig era primario y _cGetStaff solo
    // fallback, así que si el entrenador no tenía a los directores en sus
    // contactos con tag 'rpt', el informe colectivo nunca les llegaba.
    try {
        let staffList = [];

        // 1. Fuente primaria: staff real del club.
        try {
            const fns4 = await _cFS();
            staffList = (await _cGetStaff(fns4.db, me.clubId || '', fns4)) || [];
        } catch (e) {
            console.warn('[collectiveReport] _cGetStaff falló:', e.message);
        }

        // 2. Complemento: contactos de emailConfig (incluye contactos solo-email
        //    sin uid) que no estén ya en la lista. El tag 'rpt' ya no es requisito.
        const emailCfgContacts = (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts))
            ? emailConfig.contacts
            : [];

        emailCfgContacts.filter(c => c.type !== 'parent').forEach(c => {
            const already = staffList.some(s =>
                (c.uid && s.uid === c.uid) ||
                (c.email && s.email && s.email.toLowerCase() === c.email.toLowerCase()));
            if (!already) {
                staffList.push({
                    uid:         c.uid   || '',
                    email:       c.email || '',
                    phone:       c.phone || '',
                    displayName: c.name  || c.email || '',
                    role:        c.role  || (c.uid ? 'staff' : 'contact'),
                    _fromConfig: true,
                });
            }
        });

        // ── Pieza 2: filtrar coordinadores por modalidad del partido ──────
        // (igual criterio que autoDispatch: director siempre; coordinador
        // solo si su coordinatorType encaja con la modalidad de la categoría).
        if (typeof window._cronosResolveStaffForMatch === 'function') {
            const _matchCat  = (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                               (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') ||
                               window._currentMatchCategory || '';
            const _matchMode = (typeof currentMode !== 'undefined' ? currentMode : null);
            staffList = window._cronosResolveStaffForMatch(staffList, _matchCat, _matchMode);
        }

        const listEl = document.getElementById('coll-rpt-staff-list');
        if (listEl) {
            if (!staffList.length) {
                listEl.innerHTML = `<div style="color:#f0883e;font-size:0.75rem;">
                    ⚠️ No hay directores ni coordinadores configurados.<br>
                    <span style="font-size:0.68rem;">Ve a Comunicaciones → Gestión de Contactos y añade al staff con el tag <strong>INF</strong> activado.</span>
                </div>`;
            } else {
                listEl.innerHTML = staffList.map(s => `
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.25rem;">
                    <span>${s.role==='director'?'📋':s.role==='coordinator'?'🎯':'🏢'}</span>
                    <span style="color:white;">${typeof escapeHtml==='function'?escapeHtml(s.displayName||s.email):s.displayName||s.email}</span>
                    <span style="font-size:0.65rem;color:var(--text-muted);">
                        (${s.role==='director'?'Director Deportivo':s.role==='coordinator'?'Coordinador':'Staff'})
                    </span>
                    ${s.uid ? `<span style="font-size:0.6rem;background:rgba(63,185,80,0.12);color:#3fb950;padding:1px 5px;border-radius:4px;">✅ App</span>` :
                               `<span style="font-size:0.6rem;background:rgba(240,136,62,0.12);color:#f0883e;padding:1px 5px;border-radius:4px;">📧 Email</span>`}
                </div>`).join('');
            }
        }
        window._collectiveReportStaff = staffList;
        window._collectiveReportText  = buildCollectiveText();

    } catch(e) {
        const listEl = document.getElementById('coll-rpt-staff-list');
        if (listEl) listEl.textContent = '⚠️ ' + e.message;
    }
};

window._sendCollectiveReportNow = async function() {
    const me    = window._cronosCurrentUser;
    let   staff = window._collectiveReportStaff || [];
    const text  = window._collectiveReportText  || '';
    if (typeof showSpinner==='function') showSpinner('Enviando informe colectivo…');
    try {
        const { db, doc, setDoc, updateDoc, getDoc, arrayUnion } = await _cFS();
        // Fallback: si el panel no precargó el staff, recargarlo aquí.
        if (!staff.length) {
            try {
                const fns4 = await _cFS();
                staff = (await _cGetStaff(fns4.db, me.clubId || '', fns4)) || [];
            } catch (e) { console.warn('[collectiveReport] recarga staff falló:', e.message); }
            // Pieza 2: si recargamos aquí, aplicar el filtro por modalidad
            // (en el flujo normal ya viene filtrado desde openCollectiveReport).
            if (staff.length && typeof window._cronosResolveStaffForMatch === 'function') {
                const _matchCat  = (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                   (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '') ||
                                   window._currentMatchCategory || '';
                const _matchMode = (typeof currentMode !== 'undefined' ? currentMode : null);
                staff = window._cronosResolveStaffForMatch(staff, _matchCat, _matchMode);
            }
        }
        // FIX (P11-D): NO abortar con staff vacío — el Panel de Dirección se
        // alimenta exclusivamente de los cronos_player_reports que este mismo
        // bloque escribe más abajo; si hacemos return aquí el partido no
        // aparece nunca aunque el club aún no tenga director/coordinador
        // asignado. Solo avisamos y seguimos (los reports quedan visibles por
        // clubId de todos modos).
        if (!staff.length) {
            console.warn('[StaffReport] Lista de staff vacía: se escriben los informes igualmente (visibles por clubId en el Panel de Dirección).');
        }
        const now       = new Date();
        const matchDate = now.toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'});
        const matchDateISO = now.toISOString().split('T')[0];
        const rival     = (typeof TEAM_NAMES!=='undefined'&&TEAM_NAMES.away)||'Rival';
        const scoreHome = document.getElementById('score-home')?.textContent||'0';
        const scoreAway = document.getElementById('score-away')?.textContent||'0';
        const createdAt = now.toISOString();

        // ── 1. Guardar datos estructurados del partido en Firestore ──────
        // Esto alimenta el Gantt visual en el panel de Dirección/Coordinación.
        // Se guarda UN documento por jugador con su historial completo.
        const homePlayers = window.players
            ? window.players.filter(p => p.team === _cMyTeamKey())
            : [];

        // FIX (P11-D): incluir SIEMPRE me.uid como red de seguridad, igual que
        // _allStaffUids en autoDispatchMatchReports, para que la query
        // array-contains del Panel de Dirección nunca quede vacía.
        const _collStaffUids = Array.from(new Set([...staff.map(s => s.uid).filter(Boolean), me.uid,].filter(Boolean)));

        // matchId DETERMINISTA: reutiliza el de autoDispatch si ya se ejecutó,
        // o construye uno basado en fecha+rival+marcador (igual que autoDispatch).
        // Así el "Enviar Informe" manual nunca crea docs duplicados.
        const _rivalSlug2 = (rival || 'rival').replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0, 20);
        const matchId = window._cronosLastAutoDispatchMatchId
            || `match_${me.uid}_${matchDateISO}_${_rivalSlug2}_${scoreHome}x${scoreAway}`;

        for (const p of homePlayers) {
            const rptId = `${matchId}_p${p.number}`;
            await setDoc(doc(db, 'cronos_player_reports', rptId), {
                // Identificadores del partido
                matchId,
                type:           'collective_match_report',
                // E3 FIX: el panel de Dirección/Coordinación filtra exclusivamente
                // por staffReport===true. Sin esta marca el informe colectivo no
                // llegaba nunca a coordinadores/directores.
                staffReport:    true,
                // FIX (v178): staffUids para que las reglas Firestore permitan leer
                // a directores/coordinadores (request.auth.uid in resource.data.staffUids)
                // y la consulta fallback array-contains los encuentre.
                staffUids:      _collStaffUids,
                clubId:         me.clubId || null,
                coachUid:       me.uid,
                coachEmail:     me.email,
                matchDate:      matchDateISO,
                rival,
                scoreHome,
                scoreAway,
                myTeamRole:     _cMyTeamKey(),   // 'home' | 'away' — perspectiva del entrenador (resultado V/D/E correcto). CRÍTICO: este doc tiene staffReport:true y lo lee el Panel de Dirección.
                category:       (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                 (typeof window.currentCategory !== 'undefined' ? window.currentCategory : ''),
                subcategory:    _cMatchSubcatFor(me, (typeof currentCategory !== 'undefined' ? currentCategory : '') ||
                                 (typeof window.currentCategory !== 'undefined' ? window.currentCategory : '')),
                venue:          (typeof window.matchVenue !== 'undefined' ? window.matchVenue : ''),
                competition:    (typeof window.matchCompetition !== 'undefined' ? window.matchCompetition : ''),
                matchTime:      (typeof window.matchTime !== 'undefined' ? window.matchTime : ''),
                duration:       (typeof window.matchDuration !== 'undefined' ? window.matchDuration : ''),
                stoppageTime:   (typeof window.stoppageTime !== 'undefined' ? window.stoppageTime : 0),
                createdAt,
                // Datos del jugador con historial COMPLETO para el Gantt
                playerNumber:   String(p.number || ''),
                playerAlias:    p.alias || p.name || '',
                position:       p.position || p.pos || '',
                goals:          p.goals  || 0,
                cards:          p.cards  || null,
                injured:        p.injured || false,
                minutesPlayed:  typeof formatTime==='function' ? formatTime(p.time||0) : String(p.time||0),
                // history: array de eventos {type, minute} — clave para el Gantt
                // p.history puede contener strings "Entra a las MM:SS (1ªP)" O objetos {type,minute}
                history: _parseHistoryForFirestore(p.history || []),
            });
        }
        console.log(`[StaffReport] TOTAL informes colectivos escritos en cronos_player_reports: ${homePlayers.length} (matchId=${matchId}, staff=${staff.length}, staffUids=${_collStaffUids.length})`);

        // ── 2. Enviar mensaje de hilo a cada miembro del staff ───────────
        for (const s of staff) {
            // Solo envío in-app si tiene uid real
            if (s.uid) {
                const threadId = _cStaffThreadId(me.clubId, me.uid, s.uid);
                const msgEntry = {
                    sender: 'coach', type: 'collective_report',
                    text,
                    matchId,
                    timestamp: createdAt,
                };
                // FIX (v178): patrón updateDoc→setDoc en vez de getDoc→if/else.
                // getDoc puede dar permission-denied si las reglas no permiten leer
                // (ej. entrenador sin claim clubId). updateDoc→setDoc evita el getDoc.
                try {
                    // FIX (v180): Incluir campos de identidad para consultas del director/coordinador
                    await updateDoc(doc(db,'cronos_messages',threadId), {
                        messages:      arrayUnion(msgEntry),
                        lastMessage:   '📊 Informe colectivo de partido',
                        lastMessageAt: createdAt,
                        unreadByStaff: (typeof firebase !== 'undefined' && firebase.firestore)
                            ? firebase.firestore.FieldValue.increment(1) : 1,
                        // FIX (v180): campos de identidad para consultas del director/coordinador
                        staffUid:      s.uid,
                        parentUid:     s.uid,
                        participants:  arrayUnion(me.uid, s.uid),
                        clubId:        me.clubId || null,
                        recipientType: 'staff'
                    });
                } catch(updErr) {
                    try {
                        await setDoc(doc(db,'cronos_messages',threadId), {
                            threadId, coachUid: me.uid, coachEmail: me.email,
                            clubId: me.clubId || null,
                            participants: [me.uid, s.uid],
                            staffUids: [s.uid],
                            staffUid: s.uid,
                            parentUid: s.uid,          // FIX (v178): club-reports.js busca por parentUid
                            staffEmail: s.email||'',
                            recipientType:'staff',
                            messages: [msgEntry],
                            lastMessage:   '📊 Informe colectivo de partido',
                            lastMessageAt: createdAt,
                            unreadByCoach: 0, unreadByStaff: 1,
                        });
                    } catch(setErr) {
                        if(window._CRONOS_DEBUG) console.warn('[ColReport] Error creando hilo staff:', {
                            code: setErr && setErr.code,
                            message: setErr && setErr.message,
                            threadId,
                            staffUid: s.uid,
                        }, setErr);
                    }
                }
                await setDoc(doc(db,'cronos_notifications',`coll_rpt_${s.uid}_${Date.now().toString(36)}`), {
                    type: 'informe_colectivo', clubId: me.clubId||null,
                    userId: s.uid,                                // ← FIX (C3): campo que las reglas verifican
                    coachUid: me.uid,                             // ← FIX (C3): coachUid para reglas Firestore
                    staffUid: s.uid, parentUid: s.uid,
                    coachEmail: me.email, matchDate, rival, scoreHome, scoreAway,
                    matchId,
                    createdAt,
                });
            }

            // Envío por email si tiene email (cubre casos sin uid, p.ej. mismo correo multi-rol)
            if (s.email && s.email !== me.email) {
                const subj = encodeURIComponent(`📊 Informe colectivo: vs ${rival} — ${matchDate}`);
                const body = encodeURIComponent(text.replace(/[*_]/g,''));
                setTimeout(() => {
                    window.open(`mailto:${s.email}?subject=${subj}&body=${body}`, '_blank');
                }, staff.indexOf(s) * 800);
            }

            // Envío por WhatsApp si tiene teléfono
            if (s.phone) {
                const waNum = s.phone.replace(/\s/g,'');
                setTimeout(() => {
                    window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(text)}`, '_blank');
                }, staff.indexOf(s) * 800 + 400);
            }
        }

        // ── 3. Auto-notificación para el entrenador (para que "le llegue" también) ──
        const selfNotifId = `coll_rpt_self_${me.uid}_${Date.now().toString(36)}`;
        await setDoc(doc(db,'cronos_notifications', selfNotifId), {
            type: 'informe_colectivo', clubId: me.clubId||null,
            userId: me.uid,                                // ← FIX (C3): campo que las reglas verifican
            coachUid: me.uid,                              // ← FIX (C3): coachUid para reglas Firestore
            staffUid: me.uid, parentUid: me.uid,
            coachEmail: me.email, matchDate, rival, scoreHome, scoreAway,
            matchId,
            createdAt,
        });

        if (typeof hideSpinner==='function') hideSpinner();
        if (typeof showToast==='function') {
            if (staff.length) {
                showToast(`✅ Informe colectivo enviado a ${staff.length} persona(s) de la dirección`, 5000);
            } else {
                showToast('✅ Informe colectivo guardado — visible en el Panel de Dirección', 5000);
            }
        }

        // ── Guardar copia para el entrenador (registro propio) ──────────
        // Esto alimenta la pestaña "Mis Informes" del menú de Comunicaciones.
        try {
            const coachNotifId = `coach_self_rpt_${me.uid}_${Date.now().toString(36)}`;
            await setDoc(doc(db, 'cronos_notifications', coachNotifId), {
                type:      'informe_colectivo_entrenador',
                clubId:    me.clubId || null,
                userId:    me.uid,          // FIX v177: campo que las reglas Firestore verifican
                coachUid:  me.uid,
                parentUid: me.uid,
                matchDate, rival, scoreHome, scoreAway,
                matchId,
                createdAt,
                _forCoach: true,
            });
        } catch(selfErr) {
            console.warn('[ColReport] Auto-copia al entrenador falló:', selfErr.message);
        }

        openUnifiedCommsMenu();
    } catch(e) {
        if (typeof hideSpinner==='function') hideSpinner();
        if (typeof showToast==='function') showToast('⚠️ Error: '+e.message, 4000);
        console.error('[_sendCollectiveReportNow]', e);
    }
};

// ════════════════════════════════════════════════════════════════════
//  INFORMES INDIVIDUALES → PADRES VINCULADOS
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
//  MIS INFORMES — Panel del entrenador con sus propios informes de partido
//  (se auto-guardan al finalizar cada encuentro en ambos roles)
// ════════════════════════════════════════════════════════════════════
window.openMisInformes = async function openMisInformes() {
    const me = window._cronosCurrentUser;
    const modal = document.getElementById('setup-modal');
    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,900px);max-height:94vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;background:#0d1117;">

        <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:1rem 1.4rem;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;">
            <div style="display:flex;align-items:center;gap:0.7rem;">
                <span style="font-size:1.4rem;">📋</span>
                <div>
                    <div style="font-size:1rem;font-weight:700;color:white;">Mis Informes de Partido</div>
                    <div style="font-size:0.7rem;color:var(--text-muted);">
                        Guardados automáticamente al finalizar cada encuentro
                    </div>
                </div>
            </div>
            <button onclick="openUnifiedCommsMenu()"
                style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
                       color:var(--text-muted);padding:0.35rem 0.8rem;border-radius:6px;
                       cursor:pointer;font-size:0.74rem;font-weight:600;">← Volver</button>
        </div>

        <div id="mis-informes-body" style="flex:1;overflow-y:auto;padding:1.2rem;">
            <div style="text-align:center;padding:3rem;color:var(--text-muted);">
                <div class="spinner" style="margin:0 auto 1rem;"></div>Cargando…
            </div>
        </div>
    </div>`;

    try {
        const { db, collection, getDocs, query, where } = await _cFS();
        const rawCoachSnap = await getDocs(query(
            collection(db, 'cronos_player_reports'),
            where('coachUid', '==', me.uid)
        ));
        // Filtrar en cliente: solo los del propio entrenador (_forCoach=true)
        const snap = { forEach: (fn) => rawCoachSnap.forEach(d => { if (d.data()._forCoach === true) fn(d); }) };

        const reports = [];
        snap.forEach(d => reports.push({ id: d.id, ...d.data() }));

        // Filtrar informes eliminados localmente
        const miDismissed = JSON.parse(localStorage.getItem('cronos_mi_dismissed_info') || '[]');

        if (!reports.length) {
            document.getElementById('mis-informes-body').innerHTML = `
            <div style="text-align:center;padding:4rem;color:var(--text-muted);">
                <div style="font-size:2rem;margin-bottom:1rem;">📋</div>
                <div style="font-size:0.95rem;font-weight:600;margin-bottom:0.4rem;">Sin informes aún</div>
                <div style="font-size:0.8rem;">
                    Los informes se guardan automáticamente al finalizar un partido
                    y al enviar el Informe Colectivo.
                </div>
            </div>`;
            return;
        }

        // Agrupar por matchId → fecha+rival+coach (mismo algoritmo que 23_staff_dashboard)
        const matches = {};
        reports.forEach(r => {
            const key = r.matchId ||
                `${r.matchDate||r.createdAt?.slice(0,10)||'?'}_${r.rival||'sin-rival'}_${r.coachUid||''}`;
            if (!matches[key]) {
                matches[key] = {
                    key, matchId: r.matchId||key,
                    matchDate: r.matchDate||r.createdAt?.slice(0,10),
                    rival: r.rival, scoreHome: r.scoreHome, scoreAway: r.scoreAway,
                    myTeamRole: r.myTeamRole,   // FIX: propagar rol del equipo para el cálculo V/D/E correcto (visitante)
                    category: r.category||'', venue: r.venue||'',
                    competition: r.competition||'', matchTime: r.matchTime||'',
                    duration: r.duration||'', stoppageTime: r.stoppageTime||0,
                    createdAt: r.createdAt, coachEmail: r.coachEmail,
                    _playerMap: {}, players: [],
                };
            }
            const pNum = String(r.playerNumber||'');
            const existing = matches[key]._playerMap[pNum];
            if (!existing || (r.createdAt||'') > (existing.createdAt||''))
                matches[key]._playerMap[pNum] = r;
            // FIX: adoptar myTeamRole si el objeto agrupado aún no lo tiene.
            if (matches[key].myTeamRole == null && r.myTeamRole != null)
                matches[key].myTeamRole = r.myTeamRole;
        });
        Object.values(matches).forEach(m => {
            m.players = Object.values(m._playerMap)
                .sort((a,b)=>(parseInt(a.playerNumber)||99)-(parseInt(b.playerNumber)||99));
            delete m._playerMap;
        });
        const sorted = Object.values(matches)
            .filter(m=>m.players.length>0)
            .sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));

        window._misInformesData = matches;

        const body = document.getElementById('mis-informes-body');
        body.innerHTML = `<div style="font-size:0.74rem;color:var(--text-muted);margin-bottom:0.8rem;">
            ${sorted.length} partido${sorted.length!==1?'s':''} · ${reports.length} informes de jugadores
        </div>` + sorted.map(m => {
            const sh=m.scoreHome, sa=m.scoreAway;
            const score=(sh!=null&&sa!=null)?`${sh}–${sa}`:'—';
            // Resultado segun myTeamRole; sin el campo (informes antiguos) -> fallback 'home', comportamiento previo.
            const _mine=m.myTeamRole==='away'?sa:sh, _theirs=m.myTeamRole==='away'?sh:sa;
            const res=(sh!=null&&sa!=null)?(_mine>_theirs?'VICTORIA':_mine<_theirs?'DERROTA':'EMPATE'):'';
            const rCol=res==='VICTORIA'?'#3fb950':res==='DERROTA'?'#ff5858':'#eab308';
            const dateStr=m.matchDate
                ?new Date(m.matchDate+'T12:00:00').toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'}):'—';
            const key64=btoa(unescape(encodeURIComponent(m.key))).replace(/=/g,'');
            const goals=m.players.reduce((s,p)=>s+(p.goals||0),0);
            return `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(63,185,80,0.15);
                        border-radius:12px;padding:0.9rem 1.1rem;margin-bottom:0.7rem;cursor:pointer;transition:all 0.2s;"
                 id="mi-rp-${key64}"
                 onmouseover="this.style.borderColor='rgba(63,185,80,0.4)'"
                 onmouseout="this.style.borderColor='rgba(63,185,80,0.15)'"
                 onclick="miToggleInforme('${key64}')">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:0.95rem;display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                            🆚 vs <span style="color:#3fb950;">${typeof escapeHtml==='function'?escapeHtml(m.rival||'Sin rival'):m.rival||'Sin rival'}</span>
                            ${res?`<span style="font-size:0.62rem;font-weight:700;color:${rCol};">${res}</span>`:''}
                        </div>
                        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;display:flex;gap:0.5rem 0.9rem;flex-wrap:wrap;">
                            <span>📅 ${dateStr}</span>
                            ${score!=='—'?`<span>⚽ <strong style="color:${rCol};">${score}</strong></span>`:''}
                            ${m.category?`<span style="color:#58a6ff;">${typeof escapeHtml==='function'?escapeHtml(m.category):m.category}</span>`:''}
                        </div>
                        ${goals>0?`<div style="font-size:0.7rem;color:#3fb950;margin-top:2px;">⚽ ${goals} goles</div>`:''}
                    </div>
                    <div style="font-size:0.62rem;color:var(--text-muted);text-align:right;flex-shrink:0;">
                        ${m.players.length} jugadores<br>▼ Ver Gantt
                    </div>
                    <div style="display:flex;align-items:center;padding-left:0.5rem;border-left:1px solid rgba(255,255,255,0.08);">
                        <button onclick="event.stopPropagation(); miEliminarInforme('${key64}', true)" 
                                title="Eliminar informe definitivamente"
                                style="background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);
                                       color:#ff5858;padding:0.4rem;border-radius:6px;cursor:pointer;
                                       display:flex;align-items:center;justify-content:center;transition:all 0.2s;">
                            🗑️
                        </button>
                    </div>
                </div>
                <div id="mi-rp-detail-${key64}"
                     style="display:none;margin-top:0.75rem;border-top:1px solid rgba(255,255,255,0.07);padding-top:0.75rem;">
                </div>
            </div>`;
        }).join('');

        // Toggle con Gantt completo (usa window._sdBuildGantt de 23_staff_dashboard.js)
        window.miToggleInforme = (key64) => {
            const card   = document.getElementById(`mi-rp-${key64}`);
            const detail = document.getElementById(`mi-rp-detail-${key64}`);
            if (!detail) return;
            const isOpen = detail.style.display !== 'none';
            if (!isOpen && !detail.dataset.rendered) {
                const key = decodeURIComponent(escape(atob(key64)));
                const m   = window._misInformesData?.[key];
                if (m) {
                    try {
                        // Usar el motor de reportes unificado (_RP) de 22_club_reports.js
                        if (typeof _RP !== 'undefined' && typeof _RP.build === 'function') {
                            const fullReportHtml = _RP.build(m, window._cronosCurrentUser);
                            
                            // Añadir botones de acción al final del informe visual
                            const btns = `
                            <div style="display:flex;gap:0.75rem;flex-wrap:wrap;margin-top:1.5rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.08);">
                                <button onclick="miDescargarInforme('${key64}')"
                                    style="padding:0.5rem 1rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);border-radius:8px;color:#58a6ff;font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;">
                                    📥 Descargar TXT</button>
                                <button onclick="miEliminarInforme('${key64}', true)"
                                    style="padding:0.5rem 1rem;background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);border-radius:8px;color:#ff5858;font-size:0.75rem;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:5px;">
                                    🗑️ Borrar Permanente</button>
                            </div>`;
                            
                            detail.innerHTML = fullReportHtml + btns;
                        } else {
                            throw new Error('Motor de informes no disponible. Reintenta en unos segundos.');
                        }
                    } catch(err) {
                        detail.innerHTML = `<div style="color:#ff5858;font-size:0.8rem;padding:1rem;background:rgba(255,88,88,0.05);border-radius:8px;border:1px solid rgba(255,88,88,0.2);">
                            ⚠️ Error al generar visualización: ${err.message}</div>`;
                    }
                    detail.dataset.rendered = '1';
                }
            }
            detail.style.display = isOpen ? 'none' : 'block';
            if (card) card.style.borderColor = isOpen ? 'rgba(63,185,80,0.15)' : 'rgba(63,185,80,0.55)';
        };

        // Exportar informe del entrenador como TXT
        window.miDescargarInforme = (key64) => {
            const key = decodeURIComponent(escape(atob(key64)));
            const m   = window._misInformesData?.[key];
            if (!m || typeof window.sdDownloadInforme !== 'function') {
                if (typeof showToast==='function') showToast('⚠️ Función de descarga no disponible', 2000);
                return;
            }
            // Reutilizar sdDownloadInforme de 23_staff_dashboard.js
            if (!window._sdMatches) window._sdMatches = {};
            window._sdMatches[key64] = m;
            window.sdDownloadInforme(key64);
        };

        // Eliminar informe — FIX v2: SIEMPRE soft delete (dismissedBy)
        // El borrado físico eliminaba el documento para TODOS los roles (Director y
        // Coordinador lo perdían). Ahora se añade el UID del usuario al array
        // `dismissedBy` en Firestore. Así cada rol borra independientemente.
        window.miEliminarInforme = async (key64, realDelete = false) => {
            const key = decodeURIComponent(escape(atob(key64)));
            const m   = window._misInformesData?.[key];
            if (!m) return;
            const me = window._cronosCurrentUser;

            // Soft delete: ocultar SOLO para este usuario
            if (!confirm('¿Deseas ocultar este informe de tu panel? Solo se eliminará para ti; los demás roles seguirán viéndolo.')) return;

            try {
                const { db, doc, updateDoc, arrayUnion } = await _cFS();
                if (typeof showSpinner === 'function') showSpinner('Ocultando informe…');

                const updatePromises = m.players.flatMap(p => {
                    const docIds = [];
                    // Prioridad 1: ID real del documento
                    if (p._id || p.id) docIds.push(p._id || p.id);
                    // Prioridad 2: IDs derivados si matchId es válido
                    const mid = m.matchId;
                    if (mid && mid !== 'undefined' && mid !== '') {
                        const pNum = p.playerNumber || p.number || '';
                        if (pNum) {
                            docIds.push(`${mid}_coach_p${pNum}`);
                            docIds.push(`${mid}_staff_p${pNum}`);
                            docIds.push(`${mid}_p${pNum}`);
                        }
                    }
                    const uniqueIds = [...new Set(docIds)];
                    return uniqueIds.map(docId =>
                        updateDoc(doc(db, 'cronos_player_reports', docId), {
                            dismissedBy: arrayUnion(me.uid)
                        }).catch(err => {
                            console.warn(`[MisInformes] No se pudo ocultar ${docId}:`, err.message);
                        })
                    );
                });
                await Promise.all(updatePromises);

                if (typeof hideSpinner === 'function') hideSpinner();
                if (typeof showToast === 'function') showToast('✅ Informe ocultado de tu panel', 3000);
            } catch (err) {
                if (typeof hideSpinner === 'function') hideSpinner();
                console.error('[MisInformes] Error al ocultar:', err);
                if (typeof showToast === 'function') showToast('⚠️ Error al ocultar: ' + err.message, 3000);
                // Fallback: ocultar localmente aunque falle Firestore
                const dismissed = JSON.parse(localStorage.getItem('cronos_mi_dismissed_info') || '[]');
                if (!dismissed.includes(key)) dismissed.push(key);
                localStorage.setItem('cronos_mi_dismissed_info', JSON.stringify(dismissed));
            }

            // Quitar de la UI
            const card = document.getElementById(`mi-rp-${key64}`);
            if (card) card.remove();
            
            // Actualizar contador
            const currentCount = Object.keys(window._misInformesData).length - 1;
            const body = document.getElementById('mis-informes-body');
            if (body) {
                const title = body.querySelector('div');
                if (title) title.innerHTML = `${currentCount} partido${currentCount!==1?'s':''} · Informes actualizados`;
            }
            
            delete window._misInformesData[key];
        };

    } catch(e) {
        const body = document.getElementById('mis-informes-body');
        if (body) body.innerHTML = `<div style="text-align:center;padding:2rem;color:#ff5858;">⚠️ ${e.message}</div>`;
    }
};

window.openIndividualReports = async function openIndividualReports() {
    const me    = window._cronosCurrentUser;
    const modal = document.getElementById('setup-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    modal.innerHTML = `
    <div class="modal-content" style="width:min(96vw,560px);max-height:90vh;
         display:flex;flex-direction:column;overflow:hidden;padding:0;">
        <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--glass-border);
                    display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <h3 style="margin:0;font-size:1rem;color:#ffa500;">
                👤 Informes Individuales → Padres
            </h3>
            <button onclick="openUnifiedCommsMenu()"
                style="background:none;border:none;color:var(--text-muted);font-size:1.3rem;cursor:pointer;">✕</button>
        </div>
        <div id="indiv-rpt-body" style="flex:1;overflow-y:auto;padding:1rem 1.2rem;">
            <div style="text-align:center;padding:2rem;color:var(--text-muted);">⏳ Cargando vinculaciones…</div>
        </div>
        <div style="padding:0.9rem 1.2rem;border-top:1px solid var(--glass-border);
                    display:flex;gap:0.5rem;flex-shrink:0;">
            <button onclick="openUnifiedCommsMenu()" class="btn" style="color:var(--text-muted);">← Volver</button>
            <button onclick="_sendAllIndividualReports()"
                style="flex:1;padding:0.5rem;background:rgba(255,165,0,0.15);
                       border:1px solid rgba(255,165,0,0.4);border-radius:7px;
                       color:#ffa500;font-weight:700;cursor:pointer;font-size:0.85rem;">
                📤 Enviar todos los informes a padres
            </button>
        </div>
    </div>`;

    const body = document.getElementById('indiv-rpt-body');

    try {
        const { db, collection, getDocs, query, where } = await _cFS();

        // ── Obtener links jugador↔padre de Firestore ──────────────
        const linksSnap = await getDocs(query(
            collection(db,'cronos_player_links'),
            where('clubId','==',me.clubId||'')
        ));
        const links = {};
        linksSnap.forEach(d => { const v=d.data(); links[v.playerNumber]=v; });

        // ── TAMBIÉN: enriquecer con padres de emailConfig.contacts ──
        // Los padres añadidos en "Gestión de Contactos" están en localStorage
        // (emailConfig.contacts con type:'parent' y playerId), no necesariamente
        // en cronos_player_links de Firestore. Los combinamos aquí.
        if (typeof emailConfig !== 'undefined' && Array.isArray(emailConfig.contacts)) {
            const squad = window._cronos_squad_cache ||
                JSON.parse(localStorage.getItem('cronos_master_roster') || '{"f7":[],"f11":[]}')[
                    (typeof currentMode !== 'undefined' ? currentMode : 'f11')] || [];

            emailConfig.contacts.filter(c => c.type === 'parent' && c.playerId).forEach(c => {
                // Buscar el número de dorsal a partir del playerId (ej: "10" o "j-10" → 10)
                const numFromId = parseInt((c.playerId||'').replace(/[^0-9]/g,'')) || null;
                const squadPlayer = squad.find(sp =>
                    sp.id === c.playerId ||
                    String(sp.number) === String(numFromId));
                const playerNum = squadPlayer
                    ? String(squadPlayer.number)
                    : (numFromId ? String(numFromId) : null);
                if (playerNum && !links[playerNum]) {
                    links[playerNum] = {
                        playerNumber: playerNum,
                        playerAlias:  squadPlayer ? (squadPlayer.alias || squadPlayer.name || '') : '',
                        parentUid:    c.uid   || null,
                        parentEmail:  c.email || '',
                        parentPhone:  c.phone || '',
                        parentName:   c.name  || '',
                        clubId:       me.clubId || null,
                        _fromEmailConfig: true,
                    };
                }
            });
        }

        // Jugadores del partido actual
        const players = window.players
            ? window.players.filter(p => p.team===_cMyTeamKey())
            : [];

        if (!players.length) {
            body.innerHTML = `
            <div style="text-align:center;color:var(--text-muted);padding:2rem;">
                ⚠️ No hay datos de partido en curso.<br>
                <span style="font-size:0.78rem;">
                    Inicia un partido o envía los informes justo después de finalizarlo.</span>
            </div>`;
            return;
        }

        const evIcon = { goal:'⚽ GOL', yellow:'🟨 TARJETA', red:'🟥 TARJETA', sub_in:'▼ CAMBIO·Entra', sub_out:'▲ CAMBIO·Sale', injury:'🚑 LESIÓN' };

        body.innerHTML = players.map(p => {
            const link    = links[p.number];
            // Vinculado si tiene uid en app O al menos email/teléfono de contacto
            const linked  = !!(link && (link.parentUid || link.parentEmail || link.parentPhone));
            const mins    = typeof formatTime==='function' ? formatTime(p.time||0) : (p.minutesPlayed||'—');
            const parentLabel = link
                ? (link.parentName  ? link.parentName
                  : link.parentEmail ? link.parentEmail
                  : link.parentPhone  ? link.parentPhone : '')
                : '';
            const inApp = !!(link && link.parentUid);

            // Eventos del jugador
            const events = [];
            (p.history||[]).forEach(ev => {
                if (typeof ev==='object' && ev.type) events.push(ev);
            });
            if (p.subInMinute)  events.push({ minute:p.subInMinute,  type:'sub_in'  });
            if (p.subOutMinute) events.push({ minute:p.subOutMinute, type:'sub_out' });
            if (p.injuryMinute) events.push({ minute:p.injuryMinute, type:'injury'  });
            events.sort((a,b)=>(a.minute||0)-(b.minute||0));

            return `
            <div style="background:${linked?'rgba(255,165,0,0.04)':'rgba(255,255,255,0.02)'};
                        border:1px solid ${linked?'rgba(255,165,0,0.25)':'rgba(255,255,255,0.07)'};
                        border-radius:9px;padding:0.75rem;margin-bottom:0.55rem;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <span style="background:rgba(88,166,255,0.15);color:var(--primary);
                                     font-weight:700;font-size:0.8rem;padding:2px 7px;border-radius:5px;">
                            ${typeof escapeHtml==='function'?escapeHtml(p.name||'Jugador'):(p.name||'Jugador')}
                        </span>
                        <span style="font-weight:700;font-size:0.88rem;">${typeof escapeHtml==='function'?escapeHtml(p.name||'Jugador'):p.name||'Jugador'}</span>
                    </div>
                    <div style="text-align:right;font-size:0.7rem;">
                        ${linked
                            ? (inApp
                                ? `<span style="color:#3fb950;font-weight:700;">✅ App</span><br>
                                   <span style="color:var(--text-muted);">${typeof escapeHtml==='function'?escapeHtml(parentLabel):parentLabel}</span>`
                                : `<span style="color:#f0883e;font-weight:700;">📋 Contacto</span><br>
                                   <span style="color:var(--text-muted);">${typeof escapeHtml==='function'?escapeHtml(parentLabel):parentLabel}</span>`)
                            : `<span style="color:#ff5858;">⚠️ Sin vincular</span>`}
                    </div>
                </div>
                <!-- Stats -->
                <div style="display:flex;gap:0.5rem;flex-wrap:wrap;font-size:0.72rem;
                            color:var(--text-muted);margin-bottom:${events.length?'0.4rem':'0'};">
                    <span>⏱ <strong style="color:white;">${mins}</strong></span>
                    ${p.goals>0 ? `<span>⚽ <strong style="color:#ffa500;">${p.goals}</strong></span>` : ''}
                    ${p.cards&&p.cards!=='ninguna' ? `<span>${p.cards==='roja'||p.cards==='red'?'🟥':'🟨'}</span>` : ''}
                    ${p.injured ? '<span>🩹</span>' : ''}
                </div>
                <!-- Timeline individual -->
                ${events.length ? `
                <div style="display:flex;flex-wrap:wrap;gap:0.3rem 0.6rem;
                            font-size:0.69rem;color:var(--text-muted);
                            background:rgba(255,255,255,0.025);
                            border-radius:6px;padding:0.35rem 0.5rem;">
                    ${events.map(ev => `<span><strong style="color:white;">${ev.minute||'?'}'</strong> ${evIcon[ev.type]||'•'}</span>`).join('')}
                </div>` : ''}
            </div>`;
        }).join('');

        // Guardar para el envío
        window._individualReportPlayers = players;
        window._individualReportLinks   = links;

    } catch(e) {
        body.innerHTML = `<div style="text-align:center;color:#ff5858;padding:2rem;">⚠️ ${typeof escapeHtml==='function'?escapeHtml(e.message):e.message}</div>`;
    }
};

window._sendAllIndividualReports = async function() {
    const me      = window._cronosCurrentUser;
    const players = window._individualReportPlayers || [];
    const links   = window._individualReportLinks   || {};
    if (!players.length) {
        if (typeof showToast==='function') showToast('⚠️ Sin datos de partido', 3000); return;
    }
    if (typeof showSpinner==='function') showSpinner('Enviando informes individuales…');

    try {
        const { db, doc, setDoc, updateDoc, getDoc, arrayUnion } = await _cFS();
        const rival     = (typeof TEAM_NAMES!=='undefined'&&TEAM_NAMES.away)||'Rival';
        const scoreHome = document.getElementById('score-home')?.textContent||'?';
        const scoreAway = document.getElementById('score-away')?.textContent||'?';
        const matchDate = new Date().toLocaleDateString('es-ES',{day:'2-digit',month:'long',year:'numeric'});
        // v218: palabras en MAYÚSCULAS + flechas ▲/▼ coherentes con el feed en vivo.
        const evIcon    = { goal:'⚽ GOL', yellow:'🟨 TARJETA', red:'🟥 TARJETA',
                            sub_in:'▼ CAMBIO·Entra', sub_out:'▲ CAMBIO·Sale', injury:'🚑 LESIÓN' };

        let sent = 0;
        const noLinkList = [];

        for (const p of players) {
            const link = links[p.number];
            // Saltar solo si no hay NINGÚN dato de contacto
            if (!link || (!link.parentUid && !link.parentEmail && !link.parentPhone)) {
                noLinkList.push(p.name || 'Jugador');
                continue;
            }

            const mins   = typeof formatTime==='function' ? formatTime(p.time||0) : (p.minutesPlayed||'—');
            const events = [];
            (p.history||[]).forEach(ev => { if (typeof ev==='object'&&ev.type) events.push(ev); });
            if (p.subInMinute)  events.push({ minute:p.subInMinute,  type:'sub_in'  });
            if (p.subOutMinute) events.push({ minute:p.subOutMinute, type:'sub_out' });
            if (p.injuryMinute) events.push({ minute:p.injuryMinute, type:'injury'  });
            events.sort((a,b)=>(a.minute||0)-(b.minute||0));

            const text = `📊 *INFORME INDIVIDUAL: ${p.name}*\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `📅 ${matchDate} · 🆚 vs ${rival} (${scoreHome}-${scoreAway})\n\n` +
                `⏱ Minutos: *${mins}*\n` +
                `⚽ Goles: *${p.goals||0}*\n` +
                `🎴 Tarjeta: *${p.cards&&p.cards!=='ninguna'?p.cards:'Ninguna'}*\n` +
                `🚑 Lesión: *${p.injured?'SÍ':'NO'}*\n` +
                (events.length
                    ? `\n📋 *Acciones:*\n` + events.map(ev => `• ${ev.minute||'?'}' ${evIcon[ev.type]||ev.type}`).join('\n') + '\n'
                    : '') +
                `\n_Cronos Fútbol_ ⚽`;

            // ── Envío in-app (solo si tiene uid registrado en la app) ──
            if (link.parentUid) {
                const threadId = `${me.uid}_${link.parentUid}`;
                const msgEntry = { sender:'coach', type:'individual_report', text, timestamp:new Date().toISOString() };
                const snap     = await getDoc(doc(db,'cronos_messages',threadId));
                if (snap.exists()) {
                    await updateDoc(doc(db,'cronos_messages',threadId), {
                        messages: arrayUnion(msgEntry),
                        lastMessage: `📊 Informe de ${p.name}`,
                        lastMessageAt: msgEntry.timestamp,
                        unreadByParent: (snap.data().unreadByParent||0) + 1,
                        // FIX (v180): campos de identidad
                        parentUid:     link.parentUid,
                        participants:  arrayUnion(me.uid, link.parentUid),
                        clubId:        me.clubId || null,
                        recipientType: 'parent'
                    });
                } else {
                    await setDoc(doc(db,'cronos_messages',threadId), {
                        threadId, coachUid:me.uid, coachEmail:me.email,
                        parentUid:link.parentUid, parentEmail:link.parentEmail||'',
                        recipientType:'parent',
                        // FIX (v180): campos de identidad
                        clubId: me.clubId || null,
                        participants: [me.uid, link.parentUid],
                        messages:[msgEntry],
                        lastMessage:`📊 Informe de ${p.name}`,
                        lastMessageAt:msgEntry.timestamp,
                        unreadByCoach:0, unreadByParent:1,
                    });
                }
                await setDoc(doc(db,'cronos_notifications',`indiv_rpt_${link.parentUid}_${p.number}_${Date.now().toString(36)}`), {
                    type:'informe_partido', clubId:me.clubId||null,
                    userId: link.parentUid,                       // ← FIX (C3): campo que las reglas verifican
                    coachUid: me.uid,                             // ← FIX (C3): coachUid para reglas Firestore
                    parentUid:link.parentUid, playerNumber:p.number, playerAlias:p.name,
                    rival, scoreHome, scoreAway, matchDate, coachEmail:me.email,
                    createdAt:new Date().toISOString(),
                });
            }

            // ── Envío por WhatsApp si tiene teléfono (con/sin uid en app) ──
            if (link.parentPhone) {
                const waNum = link.parentPhone.replace(/\s/g,'');
                setTimeout(() => {
                    window.open(`https://wa.me/${waNum}?text=${encodeURIComponent(text)}`, '_blank');
                }, sent * 800);
            }

            // ── Envío por Email si tiene email y NO tiene uid (si tiene uid, ya llegó in-app) ──
            if (link.parentEmail && !link.parentUid) {
                const subj = encodeURIComponent(`📊 Informe de ${p.name} — ${matchDate}`);
                const body2 = encodeURIComponent(text.replace(/[*_]/g,''));
                setTimeout(() => {
                    window.open(`mailto:${link.parentEmail}?subject=${subj}&body=${body2}`, '_blank');
                }, sent * 800 + 200);
            }

            sent++;
        }

        if (typeof hideSpinner==='function') hideSpinner();
        let msg = `✅ Informes enviados a ${sent} padre(s).`;
        if (noLinkList.length > 0) msg += ` · Sin contacto: ${noLinkList.join(', ')}.`;
        if (typeof showToast==='function') showToast(msg, 6000);
        openUnifiedCommsMenu();
    } catch(e) {
        if (typeof hideSpinner==='function') hideSpinner();
        if (typeof showToast==='function') showToast('⚠️ Error: '+e.message, 4000);
    }
};

// publishConvocationToApp: el envío unificado está en 19_whatsapp_email.js (sin duplicados)
window.openCollectiveReport    = window.openCollectiveReport;
window.openIndividualReports   = window.openIndividualReports;
window.openCoachMessaging      = openCoachMessaging;

window.openThreadWithParent    = openThreadWithParent;
window.sendMatchReportsToParents = sendMatchReportsToParents;
window._loadThreadMessages     = _loadThreadMessages;
window.openContactManager      = openContactManager;
window.saveContactManagerData  = saveContactManagerData;
window.saveAllMatchReportsInternal = saveAllMatchReportsInternal;
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

