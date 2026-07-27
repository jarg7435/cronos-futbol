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

async function _loadThreadMessages(threadId, perspective) {
    const contact = (window._umState && window._umState.selectedContact) || (window._umState && window._umState.contacts && window._umState.contacts[0]) || { uid: '', name: 'Contacto' };
    return await _loadUnifiedThreadMessages(threadId, contact);
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
        const _clubId = await _cResolveClubId(db, me, { doc, getDoc });
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

