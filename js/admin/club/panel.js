// ════════════════════════════════════════════════════════════════════
//  PANEL ADMIN DE CLUB (club_admin) — v3
//  Secciones expandibles por rol · Aprobación de solicitudes
//  Solicitud de ampliación de cuota al SuperAdmin
// ════════════════════════════════════════════════════════════════════
// Guardia: SA_CSS puede no estar definido si 16_superadmin.js no cargó aún
if (typeof window.SA_CSS === 'undefined') {
    window.SA_CSS = '<style>.sa-modal{background:#0d1117!important;border:1px solid rgba(255,255,255,0.1)!important;border-radius:16px!important;max-width:860px!important;width:98vw!important;max-height:92vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;font-family:Inter,sans-serif!important}.sa-body{flex:1;overflow-y:auto;padding:1rem 1.2rem}.sa-topbar{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.2rem;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;flex-wrap:wrap;gap:0.5rem}.sa-btn{display:inline-flex;align-items:center;gap:0.3rem;padding:0.32rem 0.65rem;border:1px solid rgba(255,255,255,0.1);border-radius:7px;background:rgba(255,255,255,0.04);color:white;font-size:0.78rem;font-weight:600;cursor:pointer}.sa-label{display:block;font-size:0.72rem;color:#8b949e;margin-bottom:0.3rem;font-weight:600}.sa-input{width:100%;padding:0.5rem 0.75rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box}</style>';
}
if (typeof window.ROLE_META === 'undefined') {
    console.warn('[club/panel.js] ROLE_META no definido — admin-shared.js no cargó correctamente');
}

async function openClubAdminPanel(preClubId = null) {
    const me         = window._cronosCurrentUser;
    const activeRole = me._activeRole || me.role;
    const isSA       = me.role === 'superadmin' || me.role === 'admin';

    // v597 · ENTRADA LIMPIA POR EL TABLERO. `caTab` recuerda la sección para
    // que un navReload() de una acción no te eche al principio, pero al ENTRAR
    // al panel hay que empezar en el menú. Se distinguen por el argumento: el
    // arranque desde el selector de rol llama `openClubAdminPanel()` a secas
    // (role-launch.js), mientras que los navReload() y el selector de clubes
    // del SuperAdmin siempre pasan el clubId.
    if (!preClubId) window._caSeccionActual = 'menu';

    if (!me || (!isSA && activeRole !== 'club_admin' && activeRole !== 'individual')) {
        showToast('⛔ Sin permisos', 3000);
        return;
    }

    // Guard: ensure saFS is available (defined in 16_superadmin.js)
    if (typeof saFS !== 'function') {
        console.error('[ClubAdmin] saFS() not available. Make sure 16_superadmin.js is loaded.');
        showToast('⚠️ Error: módulo de administración no cargado. Recarga la página.', 5000);
        return;
    }

    let _fsResult;
    try {
        _fsResult = await saFS();
    } catch (err) {
        const _modal = document.getElementById('setup-modal');
        if (_modal) {
            _modal.style.display = 'flex';
            _modal.innerHTML = `<div style="background:#0d1117;border-radius:12px;padding:2rem;color:white;text-align:center;max-width:400px;margin:auto;">
                <div style="font-size:1.5rem;margin-bottom:1rem;">⚠️</div>
                <p style="color:#ff5858;">Error de conexión: ${escapeHtml(err.message)}</p>
                <button onclick="document.getElementById('setup-modal').style.display='none'"
                    style="margin-top:1rem;padding:0.5rem 1.2rem;background:rgba(255,88,88,0.15);
                           border:1px solid rgba(255,88,88,0.4);border-radius:7px;color:#ff5858;cursor:pointer;">
                    Cerrar
                </button>
            </div>`;
        }
        return;
    }
    const { db, fa, doc, getDoc, collection, getDocs, query, where, setDoc, updateDoc, deleteDoc, httpsCallable } = _fsResult;

    // Ensure setup-modal exists in DOM (needed for rendering)
    let setupModal = document.getElementById('setup-modal');
    if (!setupModal) {
        setupModal = document.createElement('div');
        setupModal.id = 'setup-modal';
        setupModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem;';
        document.body.appendChild(setupModal);
    }

    // ── Determinar clubId ──────────────────────────────────────
    let clubId = preClubId || me.clubId;

    // Si el Club Admin no tiene clubId, intentar buscarlo en Firestore
    if (!clubId && !isSA) {
        try {
            const clubsSnap = await getDocs(collection(db, 'clubs'));
            const clubs = [];
            clubsSnap.forEach(d => clubs.push({ id: d.id, ...d.data() }));

            // Buscar club donde el usuario sea admin (por email o por uid)
            const myClub = clubs.find(c =>
                (c.adminEmail === me.email) ||
                (c.adminUid === me.uid) ||
                (c.createdBy === me.uid)
            );
            if (myClub) {
                clubId = myClub.id;
                // Actualizar el documento del usuario con el clubId
                try {
                    await updateDoc(doc(db, 'users', me.uid), { clubId: myClub.id, clubName: myClub.name || '' });
                    me.clubId = myClub.id;
                    me.clubName = myClub.name || '';
                } catch(updErr) {
                    if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[ClubAdmin] No se pudo actualizar clubId en user doc:', updErr.message);
                }
            } else if (clubs.length === 1) {
                // Si solo hay un club, asumir que es el suyo
                clubId = clubs[0].id;
                try {
                    await updateDoc(doc(db, 'users', me.uid), { clubId: clubs[0].id, clubName: clubs[0].name || '' });
                    me.clubId = clubs[0].id;
                    me.clubName = clubs[0].name || '';
                } catch(updErr2) {
                    if(window._CRONOS_DEBUG) if(window._CRONOS_DEBUG) console.warn('[ClubAdmin] No se pudo actualizar clubId:', updErr2.message);
                }
            }
        } catch(findErr) {
            console.warn('[ClubAdmin] Error buscando club:', findErr.message);
        }
    }

    // Si el SA no tiene clubId, mostrar selector de club ──────────
    if (!clubId && isSA) {
        const clubsSnap = await getDocs(collection(db, 'clubs'));
        const clubs = [];
        clubsSnap.forEach(d => clubs.push({ id: d.id, ...d.data() }));
        if (!clubs.length) { showToast('⚠️ No hay clubes creados aún', 3000); return; }
        window._sa_clubs_cache = clubs;

        // Pila de navegación: el selector de clubes del SuperAdmin es la OTRA
        // raíz de este panel (se llega aquí cuando no hay clubId). Se registra
        // SIN argumentos, para distinguirlo del panel de un club concreto.
        if (typeof navRootScreen === 'function') navRootScreen('openClubAdminPanel');

        const modal = document.getElementById('setup-modal');
        if (!modal) { showToast('⚠️ Error: modal no encontrado en la página', 5000); return; }
        modal.style.display = 'flex';
        modal.innerHTML = SA_CSS + `
        <div class="modal-content sa-modal" style="max-width:480px;">
          <div class="sa-topbar">
            <div style="font-weight:700; font-size:1rem;">🏟️ Seleccionar Club</div>
            <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
          </div>
          <div class="sa-body" style="padding:1.5rem;display:flex;flex-direction:column;gap:0.6rem;">
            <p style="color:var(--text-muted);font-size:0.82rem;margin:0 0 0.5rem;">
              Como Superadmin, selecciona el club que deseas gestionar:</p>
            ${clubs.map((c, idx) => `
              <button data-club-idx="${idx}"
                  style="text-align:left;padding:0.8rem 1rem;background:rgba(255,255,255,0.04);
                         border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;
                         color:white;font-size:0.9rem;transition:all 0.2s;width:100%;"
                  onmouseover="this.style.background='rgba(88,166,255,0.1)';this.style.borderColor='rgba(88,166,255,0.3)';"
                  onmouseout="this.style.background='rgba(255,255,255,0.04)';this.style.borderColor='rgba(255,255,255,0.1)';"
                  onclick="openClubAdminPanel(window._sa_clubs_cache[this.dataset.clubIdx].id)">
                🏟️ <strong>${escapeHtml(c.name)}</strong>
                <span style="font-size:0.72rem;color:var(--text-muted);display:block;margin-top:0.2rem;">
                  ${escapeHtml(c.adminEmail||'Sin admin')} · Plan: ${escapeHtml(c.plan||'free')}
                </span>
              </button>`).join('')}
          </div>
        </div>`;
        return;
    }

    if (!clubId) {
        const modal = document.getElementById('setup-modal');
        if (modal) {
            modal.style.display = 'flex';
            modal.innerHTML = SA_CSS + `
            <div class="modal-content sa-modal" style="max-width:450px;">
              <div class="sa-topbar">
                <div style="font-weight:700; font-size:1rem;">⚠️ Sin club asignado</div>
                <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                    style="background:none;border:none;color:var(--text-muted);font-size:1.5rem;cursor:pointer;">✕</button>
              </div>
              <div class="sa-body" style="padding:1.5rem;text-align:center;">
                <div style="font-size:2rem;margin-bottom:1rem;">🏟️</div>
                <p style="color:#ff5858;font-size:0.9rem;margin-bottom:0.5rem;">No se encontró un club asociado a tu cuenta.</p>
                <p style="color:#8b949e;font-size:0.8rem;margin-bottom:1rem;">Contacta con el SuperAdmin para que asigne un club a tu cuenta de Administrador.</p>
                <button onclick="if(typeof showRoleSelector==='function') showRoleSelector();"
                    style="padding:0.6rem 1.5rem;background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);border-radius:8px;color:#58a6ff;cursor:pointer;font-size:0.85rem;">
                    ⬅ Volver</button>
              </div>
            </div>`;
        } else {
            showToast('⚠️ Sin club asignado. Contacta con el SuperAdmin.', 5000);
        }
        return;
    }

    // ══════════════════════════════════════════════════════════════════
    //  🔑🔑🔑 v549 · ESTE PANEL LEE DEL SERVIDOR, NO DE LA CACHÉ EN DISCO
    //
    //  Reportado por el autor el 2026-08-16: una ventana se quedaba mostrando
    //  5 categorías y sin Cadete **aunque hiciera Ctrl+Shift+R**, mientras que
    //  en incógnito salían las 6 y los 6 entrenadores.
    //
    //  🔑 CTRL+SHIFT+R NO LIMPIA LO QUE FALLABA. Ese atajo vacía la caché HTTP
    //  (ficheros), pero los datos venían de la **caché persistente de
    //  Firestore, que vive en IndexedDB** (`persistentLocalCache` en
    //  firebase-init.js) y **sobrevive a cualquier recarga**. En incógnito no
    //  hay IndexedDB previo, así que allí se leía del servidor y salía bien:
    //  la diferencia nunca estuvo en el código, sino en de dónde salían los
    //  datos.
    //
    //  ⚠️ Y NO SE PUEDE ARREGLAR BORRANDO ESA CACHÉ: `live.html` comparte el
    //  mismo IndexedDB y borrarla le mata el cliente al visor (la emergencia
    //  de v470). Lo correcto es que ESTA lectura —la del panel de gestión, la
    //  que decide altas y bajas— pida el dato al SERVIDOR y punto.
    //
    //  ⚠️ CON RESPALDO OBLIGATORIO: `*FromServer` LANZA si no hay cobertura.
    //  Sin el `catch` que vuelve a la lectura normal, el panel dejaría de
    //  abrirse sin red, que es peor que verlo un minuto desactualizado.
    // ══════════════════════════════════════════════════════════════════
    let _getDocSrv = getDoc, _getDocsSrv = getDocs;
    try {
        const _m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        if (_m.getDocFromServer)  _getDocSrv  = _m.getDocFromServer;
        if (_m.getDocsFromServer) _getDocsSrv = _m.getDocsFromServer;
    } catch (e) {
        console.warn('[v549] Sin lecturas de servidor; se usa la caché:', e && e.message);
    }
    // ⚠️ v565 · EL AVISO TIENE QUE DECIR **QUÉ** LECTURA FALLÓ.
    //  Decía sólo "Lectura de servidor fallida", y aquí hay TRES: `clubs/{id}`,
    //  `users where clubId` y `platform_requests where clubId`. La tercera falla
    //  por permisos DE FORMA ESPERADA (ver el `.catch` de abajo, que la da por
    //  vacía a propósito), así que un aviso anónimo hacía imposible distinguir
    //  el ruido normal de una denegación que sí deja el panel sin datos. Se
    //  perdió una ronda entera de diagnóstico por esto.
    //
    //  Y se distingue la DENEGACIÓN de la falta de cobertura: no son lo mismo.
    //  Sin red se ve un panel desactualizado; denegado, se ve VACÍO.
    const _delServidor = async (fn, respaldo, ref, queEs) => {
        try { return await fn(ref); }
        catch (e) {
            const _msg = (e && e.message) || String(e);
            const _denegado = /permission|insufficient/i.test(_msg);
            console.warn('[v549] Lectura de servidor fallida en «' + (queEs || '?') + '»' +
                (_denegado
                    ? ' · PERMISOS DENEGADOS (no es falta de cobertura). Si esta lectura es `users`, ' +
                      'el panel se quedará vacío: revisar los claims del token (role/clubId).'
                    : ' · ¿sin cobertura?') +
                '; se cae a la caché:', _msg);
            return await respaldo(ref);
        }
    };

    let clubSnap, usersSnap, platformReqsSnap, users = [], features = [];
    try {
        [clubSnap, usersSnap] = await Promise.all([
            _delServidor(_getDocSrv,  getDoc,  doc(db, 'clubs', clubId), 'clubs/' + clubId),
            _delServidor(_getDocsSrv, getDocs, query(collection(db, 'users'), where('clubId', '==', clubId)), 'users where clubId'),
        ]);
        // platform_requests separado para que un fallo no cancele todo
        platformReqsSnap = await _delServidor(_getDocsSrv, getDocs, query(
            collection(db, 'platform_requests'),
            where('clubId', '==', clubId)
        ), 'platform_requests where clubId (fallo ESPERADO si las reglas son estrictas)').catch(e => {
            // Error de permisos es esperado si las reglas son estrictas, usamos users como respaldo
            return { forEach: () => {} }; // Simular snap vacío
        });
    } catch (queryErr) {
        console.error('[ClubAdmin] Error loading data:', queryErr);
        // Fallback: try loading club doc only
        try {
            clubSnap = await getDoc(doc(db, 'clubs', clubId));
            users = [];
        } catch (e2) {
            const _modal = document.getElementById('setup-modal');
            if (_modal) {
                _modal.style.display = 'flex';
                _modal.innerHTML = `<div style="background:#0d1117;border-radius:12px;padding:2rem;color:white;text-align:center;max-width:450px;margin:auto;">
                    <div style="font-size:1.5rem;margin-bottom:1rem;">⚠️</div>
                    <p style="color:#ff5858;font-size:0.88rem;">Error al cargar datos del club.</p>
                    <p style="color:#8b949e;font-size:0.78rem;margin-top:0.5rem;">${escapeHtml(queryErr.message)}</p>
                    <p style="color:#8b949e;font-size:0.75rem;margin-top:0.8rem;">Posible causa: permisos insuficientes en Firestore rules.<br>Verifica que las reglas permiten consultar la colección users por clubId.</p>
                    <button onclick="document.getElementById('setup-modal').style.display='none'"
                        style="margin-top:1rem;padding:0.5rem 1.2rem;background:rgba(88,166,255,0.15);
                               border:1px solid rgba(88,166,255,0.4);border-radius:7px;color:#58a6ff;cursor:pointer;">
                        Cerrar</button>
                </div>`;
            }
            return;
        }
    }
    if (!clubSnap || !clubSnap.exists()) { showToast('⚠️ Club no encontrado', 3000); return; }
    const club = clubSnap.data();
    if (club.status === 'blocked') {
        showToast('🔒 Club suspendido. Contacta con el administrador de la plataforma.', 6000);
        return;
    }
    if (usersSnap) {
        usersSnap.forEach(d => users.push({ _id: d.id, ...d.data() }));
    }
    // Deduplicate: keep only one entry per uid (prefer primary doc) and merge roles
    const userMap = new Map();
    users.forEach(u => {
        const realUid = u.uid || u._id;
        if (!userMap.has(realUid)) {
            userMap.set(realUid, { ...u });
        } else {
            const existing = userMap.get(realUid);
            // Merge allRoles
            const merged = [...(existing.allRoles || [])];
            const incoming = u.allRoles || [];
            incoming.forEach(r => {
                const match = merged.find(m => m.role === r.role && (String(m.clubId||'') === String(r.clubId||'')));
                if (!match) {
                    merged.push(r);
                } else {
                    // Update if incoming is more authoritative (authorized)
                    if (r.isAuthorized && !match.isAuthorized) {
                        Object.assign(match, r);
                    }
                }
            });
            existing.allRoles = merged;

            // If this is the primary doc, prefer its root attributes
            if (u._id === realUid) {
                const preservedRoles = existing.allRoles;
                Object.assign(existing, u);
                existing.allRoles = preservedRoles;
            }
        }
    });
    users = Array.from(userMap.values());
    features = club.features || {};

    // ══════════════════════════════════════════════════════════════
    // PLAZA VACANTE — quién OCUPA de verdad una plaza del club
    // ══════════════════════════════════════════════════════════════
    // De esto depende el bloqueo "⛔ Cuota llena para este rol", que corta
    // dar de alta o aprobar a un entrenador nuevo (4 puntos del panel). Si
    // alguien dado de baja sigue contando, su categoría NUNCA queda vacante y
    // el sustituto no puede entrar aunque el hueco exista.
    //
    // ⚠️ NO BASTA CON MIRAR `isAuthorized`. Un rol dado de baja se marca con
    //    status:'removed' + isAuthorized:false, pero hay documentos en los que
    //    esas dos cosas NO son coherentes:
    //      · los que reactivó el fallo de resurrección al iniciar sesión
    //        (quedaron status:'removed' con isAuthorized:true, o al revés);
    //      · los antiguos que usan el alias heredado `authorized` sin el "is".
    //    Contando solo `isAuthorized === true` esas plazas se quedaban pilladas
    //    para siempre, sin forma de liberarlas desde la interfaz.
    //    Por eso 'removed' manda: si el rol está de baja, NO ocupa plaza, diga
    //    lo que diga el resto de banderas.
    const _rolOcupaPlaza = (r, role) => {
        if (!r || r.role !== role) return false;
        if (String(r.clubId || '') !== String(clubId || '') && r.clubId) return false;
        if (r.status === 'removed' || r.status === 'rejected') return false;
        return r.isAuthorized === true || r.authorized === true;
    };
    const slotOf = (role) => {
        const max = (club.slots || {})[role === 'director' ? 'directors' : role === 'coordinator' ? 'coordinators' : role === 'parent' ? 'parents' : 'users'] ?? -1;
        // ══════════════════════════════════════════════════════════════
        //  🔑🔑 v553 · SE CUENTAN PLAZAS, NO PERSONAS
        //
        //  Esto contaba un Set de uid: cada persona sumaba UNA, llevara los
        //  equipos que llevara. Desde v537 un entrenador puede tener dos (un
        //  F7 y un F11), que son DOS equipos que atender y DOS plazas. A un
        //  club con seis equipos y cinco entrenadores le decía "5" — la
        //  incoherencia que reportó el autor entre este panel y el del
        //  SuperAdmin.
        //
        //  🔑 El recuento vive ahora en `cronosPlazasOcupadas` (utils.js), el
        //  MISMO que usa el panel del SuperAdmin: es lo único que garantiza
        //  que los dos digan el mismo número.
        //
        //  ⚠️ ESTO TAMBIÉN DECIDE `full`, o sea si se pueden aceptar más
        //  altas. Al pasar de personas a plazas el número sube, así que un
        //  club justo en el límite puede empezar a rechazar: es lo correcto
        //  —las plazas contratadas son equipos, no cabezas— pero conviene
        //  saberlo al revisar las cuotas.
        //
        //  El respaldo conserva el criterio anterior por si utils.js no
        //  hubiera cargado: mejor un número viejo que un cero falso que
        //  desbloquearía altas sin control.
        // ══════════════════════════════════════════════════════════════
        // ⚠️ `typeof window` y no `window.` a secas: test_plaza_vacante_tras_baja
        //    EXTRAE esta función y la ejecuta en un sandbox donde `window` no
        //    existe, así que una referencia directa lanza ReferenceError y tumba
        //    el guard entero (no una aserción: el proceso).
        let used;
        if (typeof window !== 'undefined' && typeof window.cronosPlazasOcupadas === 'function') {
            used = window.cronosPlazasOcupadas(users, role, clubId);
        } else {
            const usedSet = new Set();
            users.forEach(u => {
                if (u.status === 'removed') return;
                if (u.role === role && u.isAuthorized === true && u.status !== 'removed') {
                    usedSet.add(u._id);
                } else if (u.allRoles) {
                    if (u.allRoles.some(r => _rolOcupaPlaza(r, role))) usedSet.add(u._id);
                }
            });
            used = usedSet.size;
        }
        return { max, used, full: max !== -1 && used >= max, unlimited: max === -1 };
    };

    const pendingFromPlatformReqs = [];
    if (platformReqsSnap) {
        platformReqsSnap.forEach(d => {
            const pr = { _id: d.id, _isPlatformReq: true, ...d.data() };
            if (pr.status !== 'pending_club_admin') return;
            // ═══════════════════════════════════════════════════════════════
            //  🔑🔑🔑 v547 · SE COMPARA LA PLAZA, NO EL ROL
            //
            //  Este filtro descarta una solicitud cuando el usuario "ya tiene
            //  ese rol". Comparaba SÓLO `role`, así que a un entrenador que ya
            //  llevaba un equipo se le tiraba a la basura la solicitud del
            //  SEGUNDO — la combinación F7+F11 que v537 hizo legal. Medido con
            //  el caso real del autor (arinagazone, 2026-08-16): su solicitud
            //  de `regional/A` EXISTÍA en la base de datos, en
            //  `pending_club_admin`, y aun así no aparecía en el panel del
            //  club, porque ya tenía `user` autorizado en `alevin/C`.
            //
            //  Es el mismo defecto de "el rol como identidad" que se cerró en
            //  v540 en el registro, en los dos aprobares y en la deduplicación
            //  del listado; este punto se quedó fuera. La plaza es
            //  rol + club + categoría (cronosMismaPlaza, utils.js).
            //
            //  ⚠️ Para los roles SIN equipo (padre, director, coordinador) el
            //  comportamiento no cambia: ahí la plaza ES rol+club, así que un
            //  duplicado se sigue descartando igual que siempre.
            // ═══════════════════════════════════════════════════════════════
            const _plazaPR = { role: pr.requestedRole, clubId: pr.clubId || clubId,
                               category: pr.requestedCategory || null,
                               subcategory: pr.requestedSubcategory || null };
            const _esMismaPlaza = (r) => (typeof window.cronosMismaPlaza === 'function')
                ? window.cronosMismaPlaza(r, _plazaPR)
                : (r && r.role === pr.requestedRole);

            const alreadyAuthorized = users.some(u => {
                const isSameUser = (u._id === pr.userUid || u.email === (pr.requestedEmail || pr.email));
                if (!isSameUser) return false;
                // La raíz sólo cuenta si NO hay allRoles que lo contradiga: es
                // un dato de compatibilidad y sólo puede describir UNA plaza.
                if (!(u.allRoles || []).length &&
                    u.role === pr.requestedRole && u.isAuthorized &&
                    _esMismaPlaza({ role: u.role, clubId: u.clubId || clubId,
                                    category: u.category || u.categoryLabel, subcategory: u.subcategory })) return true;
                return (u.allRoles || []).some(r =>
                    r.isAuthorized && (r.clubId === clubId || !r.clubId) &&
                    _esMismaPlaza(Object.assign({}, r, { clubId: r.clubId || clubId })));
            });
            if (alreadyAuthorized) return;
            // ⚠️ Mismo criterio aquí: si el usuario tiene OTRA plaza pendiente,
            // ésta no es la misma y no puede taparla.
            const alreadyInPendingUsers = users.some(u =>
                (u._id === pr.userUid || u.email === pr.requestedEmail) &&
                (u.status === 'pending_club_admin' ||
                 (u.allRoles || []).some(r => r.status === 'pending_club_admin' &&
                     _esMismaPlaza(Object.assign({}, r, { clubId: r.clubId || clubId })))));
            if (!alreadyInPendingUsers) pendingFromPlatformReqs.push(pr);
        });
    }

    const pendingFromUserDocs = [];
    // Estados pendientes que el Club Admin debe poder GESTIONAR (reenviar/rechazar).
    // 'pending_sa' NO se incluye aquí: ya fue reenviado al SA y se muestra en el
    // bloque de solo-lectura "Enviadas al SuperAdmin".
    const _CA_ACTIONABLE = ['pending', 'pending_club_admin'];
    users.forEach(u => {
        if (u.status === 'removed' || u.status === 'blocked') return;
        // ¿Ya tiene algún rol ACTIVO en este club? Si lo tiene, sus roles pendientes
        // los gestiona el bloque "Nuevos Roles Solicitados" (pendingRolesInAllRoles).
        const hasActiveRole = u.isAuthorized === true ||
            (u.allRoles || []).some(r => r.isAuthorized && (r.clubId === clubId || !r.clubId));

        // (a) Usuario NUEVO (sin rol activo) cuyo rol principal está pendiente.
        if (!hasActiveRole && _CA_ACTIONABLE.includes(u.status) && u.role !== 'club_admin') {
            pendingFromUserDocs.push({ ...u, _pendingRole: u.role || u.requestedRole });
        }

        // (b) Rol pendiente dentro de allRoles (para este club) sin estar autorizado.
        if (u.allRoles) {
            u.allRoles.forEach(r => {
                if (!r.isAuthorized && _CA_ACTIONABLE.includes(r.status) && (r.clubId === clubId || !r.clubId)) {
                    pendingFromUserDocs.push({ ...u, _pendingRole: r.role, _pendingCategory: r.category || u.requestedCategory, _pendingSubcat: r.subcategory || u.requestedSubcategory });
                }
            });
        }
    });

    // ⚠️ v540 · LA CLAVE LLEVA LA PLAZA, NO SÓLO EL ROL. Desde v537 un
    // entrenador puede tener dos equipos pendientes a la vez (su F7 y su F11):
    // con la clave `<uid>_user` la segunda solicitud se consideraba repetida y
    // desaparecía del panel — el administrador no podía aprobarla nunca.
    const _claveP = (id, rol, cat, sub) => id + '_' + rol +
        (rol === 'user' && cat && typeof window.cronosTeamSlug === 'function'
            ? '_' + window.cronosTeamSlug(String(cat) + '-' + (sub || '')) : '');

    const pendingClubAdmin = [];
    const seenPendingKeys = new Set();
    pendingFromPlatformReqs.forEach(pr => {
        const key = _claveP(pr.userUid || pr.requestedEmail, pr.requestedRole,
                            pr.requestedCategory, pr.requestedSubcategory);
        pendingClubAdmin.push(pr);
        seenPendingKeys.add(key);
    });
    pendingFromUserDocs.forEach(u => {
        const key = _claveP(u._id || u.email, u._pendingRole, u._pendingCategory, u._pendingSubcat);
        if (!seenPendingKeys.has(key)) {
            pendingClubAdmin.push(u);
            seenPendingKeys.add(key);
        }
    });

    // Roles adicionales pendientes de usuarios que ya están activos en el club
    // (ej: un entrenador que solicita ser coordinador — su primer rol ya está aprobado)
    const pendingRolesInAllRoles = [];
    users.forEach(u => {
        if (u.status === 'removed' || u.status === 'blocked') return;
        // Solo incluir usuarios que ya tienen AL MENOS un rol autorizado en este club
        const hasActiveRole = (u.allRoles || []).some(r =>
            r.isAuthorized && (r.clubId === clubId || !r.clubId)
        );
        if (!hasActiveRole) return;
        // Buscar roles pendientes en allRoles que NO sean el rol principal ya aprobado
        (u.allRoles || []).forEach(r => {
            if (r.isAuthorized) return; // ya está autorizado, no es pendiente
            if (r.status === 'pending_club_admin' || r.status === 'pending_sa' || r.status === 'pending') {
                if (r.clubId === clubId || !r.clubId) {
                    pendingRolesInAllRoles.push({
                        ...u,
                        _pendingRole: r.role,
                        role: r.role, // sobreescribir para que el template use el rol pendiente
                        _pendingCategory: r.category || u.requestedCategory,
                        _pendingSubcat: r.subcategory || u.requestedSubcategory,
                    });
                }
            }
        });
    });

    // FIX duplicados: un rol pendiente que ya se mostró en "Solicitudes de Registro"
    // (vía pendingFromPlatformReqs/pendingFromUserDocs, ver seenPendingKeys arriba)
    // NO debe repetirse en "Nuevos Roles Solicitados". Misma clave: (_id||email)+'_'+rol.
    const pendingRolesInAllRolesDeduped = pendingRolesInAllRoles.filter(u => {
        const key = _claveP(u._id || u.email, u._pendingRole, u._pendingCategory, u._pendingSubcat);
        if (seenPendingKeys.has(key)) return false;
        seenPendingKeys.add(key);
        return true;
    });
    pendingRolesInAllRoles.length = 0;
    pendingRolesInAllRoles.push(...pendingRolesInAllRolesDeduped);
    const pendingAutoReg = users.filter(u => u.status === 'pending' && u.requestedRole !== 'club_admin');
    const pendingClubApproval = users.filter(u => u.status === 'pending_club' && u.approvedBySA === true);
    const pendingMembers = [...pendingAutoReg];

    console.group('%c[CA-DIAG] Club Admin Panel', 'color:#58a6ff;font-weight:bold');
    console.groupEnd();
    // ─────────────────────────────────────────────────────────────────

    // ── Render de una fila de usuario ────────────────────────────────
    const userRow = (u) => {
        const isBlocked = u.status === 'blocked';
        const isRemoved = u.status === 'removed';
        const isPending = u.status === 'pending_register';
        const isActive  = u.isAuthorized && !isBlocked && !isRemoved;

        const statusBadge =
            isRemoved ? '<span class="sa-badge" style="margin-left:0.4rem;background:#ff585822;color:#ff5858;">🗑️ Baja</span>'
          : isBlocked ? '<span class="sa-badge" style="margin-left:0.4rem;background:#ff585822;color:#ff5858;">🔒 Bloqueado</span>'
          : isPending ? '<span class="sa-badge" style="margin-left:0.4rem;background:#ffa50022;color:#ffa500;">⏳ Pendiente registro</span>'
          : isActive  ? '<span class="sa-badge" style="margin-left:0.4rem;background:rgba(63,185,80,0.12);color:#3fb950;">✅ Activo</span>'
          : '<span class="sa-badge" style="margin-left:0.4rem;background:#ffa50022;color:#ffa500;">⏳ Pendiente</span>';

        const _escA = escapeAttr;
        const _escH = escapeHtml;
        const uid   = u._id;
        const email = _escA(u.email||u._id).replace(/\\/g,'\\\\').replace(/'/g, "\'");
        const euid  = _escA(u._id).replace(/\\/g,'\\\\').replace(/'/g, "\'");
        const ecid  = _escA(clubId).replace(/\\/g,'\\\\').replace(/'/g, "\'");

        return `
        <div class="sa-urow" style="opacity:${isRemoved ? '0.45' : '1'};">
            <div style="flex:1;min-width:0;">
                <span style="font-size:0.83rem;font-weight:600;">${_escH(u.email||u._id)}</span>
                ${u.displayName ? `<span style="color:var(--text-muted);font-size:0.74rem;"> · ${_escH(u.displayName)}</span>` : ''}
                ${statusBadge}
                ${(function(){
                    // 🔑 v560 · LA PLAZA DE ESTA FILA, PRIMERO. La lista se
                    // expande a UNA FILA POR PLAZA (`_activeRoleData`), pero
                    // esto leía la RAÍZ del documento antes que nada: a un
                    // entrenador con dos equipos le pintaba la MISMA categoría
                    // en sus dos filas, y el botón "Cambiar equipo" de ambas
                    // mandaba la misma plaza de origen. Desde ahí, mover uno
                    // reetiquetaba el otro y el equipo se perdía (captura 9062).
                    const _rowRole = u._activeRoleData || null;
                    let cat = (_rowRole && (_rowRole.category || _rowRole.categoryLabel)) ||
                              u.category || u.categoryLabel;
                    let sub = (_rowRole && _rowRole.subcategory != null)
                              ? _rowRole.subcategory : u.subcategory;
                    if (!cat && u.allRoles) {
                        let roleEntry = u.allRoles.find(r => r.role === u.role);
                        if (roleEntry) { cat = roleEntry.category; sub = roleEntry.subcategory; }
                    }
                    if (!cat) return '';
                    const _rolFila = _escA((_rowRole && _rowRole.role) || u.role || '');
                    return `
                    <div style="margin-top:4px; display:flex; align-items:center; gap:0.5rem;">
                        <span style="font-size:0.68rem;background:rgba(63,185,80,0.1);color:#3fb950;border:1px solid rgba(63,185,80,0.2);padding:2px 8px;border-radius:100px;font-weight:600;">
                            ⚽ ${_escH(cat)}${sub ? ' · ' + _escH(sub) : ''}
                        </span>
                        <button onclick="caEditUserCategory('${euid}','${email}','${_escA(cat)}','${_escA(sub||'')}','${_rolFila}')"
                                style="background:none;border:none;color:#58a6ff;font-size:0.65rem;cursor:pointer;text-decoration:underline;padding:0;">
                            Cambiar equipo</button>
                    </div>`;
                })()}
            </div>
            <div style="display:flex;gap:0.3rem;flex-shrink:0;align-items:center;flex-wrap:wrap;">
                ${!isActive && !isRemoved ? `<button class="sa-btn"
                    onclick="caSetUserStatus('${euid}','${email}','active','${ecid}')"
                    style="font-size:0.7rem;color:#3fb950;border-color:rgba(63,185,80,0.35);background:rgba(63,185,80,0.08);">
                    ✅ Activar</button>` : ''}
                ${isActive ? `<button class="sa-btn"
                    onclick="caSetUserStatus('${euid}','${email}','blocked','${ecid}')"
                    style="font-size:0.7rem;color:#ffa500;border-color:rgba(255,165,0,0.35);background:rgba(255,165,0,0.07);">
                    🔒 Bloquear</button>` : ''}
                ${!isRemoved ? (function(){
                    // ═══════════════════════════════════════════════════
                    //  🔴🔴 2026-08-23 · LA BAJA ES DE ESTA PLAZA, NO DE LA
                    //  PERSONA ENTERA
                    //
                    //  DEFECTO REPORTADO por el autor: al dar de baja a
                    //  damasorv@gmail.com de CD Día "el sistema ha borrado de
                    //  golpe TODOS sus roles, incluido el de coordinador de
                    //  fútbol 11 que debía mantenerse".
                    //
                    //  🔑 Y LA CAUSA ERA UNA LLAMADA INCOMPLETA, no una lógica
                    //  equivocada. Esta lista se expande a UNA FILA POR PLAZA
                    //  (`_activeRoleData`, ver v560) y `caSetUserStatus` ACEPTA
                    //  desde v581 el rol y la plaza a los que acotar la baja
                    //  —el botón "Cambiar equipo" de esta misma fila ya los
                    //  pasaba—, pero este botón llamaba sin ninguno de los dos.
                    //  Sin `targetRole`, `rolesRemovidos` se lleva TODAS las
                    //  entradas de allRoles de este club: entrenador,
                    //  coordinador, director… todas.
                    //
                    //  Es el patrón de siempre en este proyecto: la maquinaria
                    //  ya existía y fallaba UNA línea. Ahora la fila dice de
                    //  qué plaza habla, que es justo lo que el administrador
                    //  está viendo cuando pulsa.
                    // ═══════════════════════════════════════════════════
                    const _rd   = u._activeRoleData || {};
                    const _rol  = _escA(_rd.role || u.role || '');
                    const _rcat = _escA(_rd.category != null ? _rd.category : (_rd.categoryLabel || ''));
                    const _rsub = _escA(_rd.subcategory != null ? _rd.subcategory : '');
                    return `<button class="sa-btn"
                    onclick="caSetUserStatus('${euid}','${email}','removed','${ecid}','${_rol}',false,{category:'${_rcat}',subcategory:'${_rsub}'})"
                    style="font-size:0.7rem;color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.07);">
                    🗑️ Baja</button>`;
                })() : ''}
                <!-- ⚠️ EL BOTÓN "🗑️ Eliminar" (cuenta entera) SE HA RETIRADO.
                     El borrado global de cuentas es cosa del SuperAdministrador
                     al cerrar temporada. Desde el Panel de Club sólo se vacían
                     casillas, y la cuenta desaparece —sola— cuando se revoca la
                     última. Un botón que borra cuentas enteras al lado de uno
                     que sólo quita un rol es un accidente esperando. -->
            </div>
        </div>`;
    };

    // ── Render de sección acordeón por rol ───────────────────────────
    // ── Render de TABLA UNIFICADA DE USUARIOS ────────────────────────
    const unifiedUserTable = () => {
        const expandedUsers = [];
        const cidStr = String(clubId || '');

        // 1. Filtrar y expandir usuarios por rol (para el club actual)
        users.filter(u => u.status !== 'removed').forEach(u => {
            let roles = u.allRoles || [];
            
            // Fallback: Si no tiene allRoles, considerar el rol raíz si pertenece al club
            if (roles.length === 0) {
                const rootRoleKey = u.role || u.requestedRole;
                const rootClubId = String(u.clubId || u.requestedClubId || '');
                const isAuth = u.isAuthorized === true || u.authorized === true;
                
                if (rootClubId === cidStr) {
                    roles = [{
                        role: rootRoleKey,
                        clubId: u.clubId || null,
                        isAuthorized: isAuth,
                        status: u.status,
                        category: u.category || u.categoryLabel,
                        subcategory: u.subcategory
                    }];
                }
            }

            roles.forEach(r => {
                const rCid = String(r.clubId || '');
                const isAuth = r.isAuthorized === true || r.authorized === true || (u.role === 'superadmin');
                
                // ⚠️ 'removed' TAMBIÉN excluye, no solo 'rejected'. Desde que la
                //    baja MARCA el rol en vez de borrarlo (revocación), un rol
                //    dado de baja sigue estando en allRoles: si aquí no se
                //    descarta explícitamente, el entrenador se sigue pintando
                //    en su categoría como si nada. `isAuth` no basta por sí
                //    solo, porque acepta el alias heredado `r.authorized`.
                if (rCid === cidStr && isAuth && r.status !== 'rejected' && r.status !== 'removed') {
                    // Fallback por-rol: si esta entrada concreta de allRoles no trae
                    // category/subcategory (tipico de altas del flujo Club previas al
                    // fix), respaldarlas desde la raiz del documento del usuario.
                    // Misma fuente que el fallback de array vacio (lineas 449-450).
                    const _roleData = (r.category == null && r.subcategory == null)
                        ? { ...r,
                            category:    r.category    != null ? r.category    : (u.category || u.categoryLabel),
                            subcategory: r.subcategory != null ? r.subcategory : u.subcategory }
                        : r;
                    expandedUsers.push({
                        ...u,
                        _activeRoleData: _roleData
                    });
                }
            });
        });
            
        // ── 2. Construir índices (una sola pasada O(n)) ──────────────
        //    · staff: Director + Coordinador(es) con coordinatorType válido.
        //    · byCatSub: Map<catId, Map<subId, user[]>> solo Entrenador/Padre
        //      con category Y subcategory válidas. Los registros incompletos
        //      (históricos) se EXCLUYEN por completo (decisión de diseño).
        // ⚠️ EL VOCABULARIO YA NO SE DECLARA AQUÍ (2026-07-30, fase 1 del árbol
        // del panel de Dirección). Vive en js/admin/shared/category-tree.js, porque el
        // panel del Director necesita EXACTAMENTE las mismas categorías para
        // agrupar informes, convocatorias y entrenamientos: dos copias acabarían
        // desincronizándose y cada panel mostraría un árbol distinto.
        // Se leen de window.* y NO se re-declaran con `const` de nivel superior
        // (ver la nota de admin-shared.js y test_admin_shared_constants.js).
        // Se leen DENTRO de la función, no al cargar el fichero, así que el
        // orden de los <script> no puede dejarlas vacías por sorpresa.
        // El respaldo mantiene el panel en pie si el módulo no cargara.
        const CLUB_CATEGORIES = window.CT_CATEGORIES || [];
        const CLUB_SUBCATS    = window.CT_SUBCATS    || ['A', 'B', 'C'];
        const _validCatIds = new Set(CLUB_CATEGORIES.map(c => c.id));
        const _coordLabel = { f7: 'F7', f11: 'F11', f711: 'F7&11' };

        const _buildUserIndex = (eUsers) => {
            const staff = [];                 // {u, role, coordType?}
            const byCatSub = new Map();       // catId -> (subId -> [rows])
            const catHasAny = new Set();      // catId
            const subHasAny = new Set();      // "catId|subId"
            eUsers.forEach(u => {
                const r = u._activeRoleData || {};
                const role = r.role || u.role;
                if (role === 'director') {
                    staff.push({ u, role, coordType: '' });
                    return;
                }
                if (role === 'coordinator') {
                    // Tipo de modalidad: preferir la entrada de rol concreta,
                    // con respaldo en el normalizador canónico global.
                    let ct = '';
                    const raw = (r.coordinatorType || r.requestedCoordinatorType || '');
                    const n = String(raw).trim().toLowerCase();
                    if (n === 'f7' || n === 'f11' || n === 'f711') ct = n;
                    if (!ct && typeof window._cronosStaffCoordinatorType === 'function') {
                        ct = window._cronosStaffCoordinatorType(u) || '';
                    }
                    // EXCLUIR coordinador sin tipo válido (registro histórico).
                    if (!ct) return;
                    staff.push({ u, role, coordType: ct });
                    return;
                }
                if (role !== 'user' && role !== 'parent') return; // club_admin u otros: fuera del árbol
                // Entrenador / Padre → al árbol. Requiere cat Y subcat válidas.
                const cat = String(r.category || '').trim().toLowerCase();
                const sub = String(r.subcategory || '').trim().toUpperCase();
                if (!_validCatIds.has(cat)) return;        // EXCLUIR sin categoría válida
                if (!CLUB_SUBCATS.includes(sub)) return;    // EXCLUIR sin subcategoría válida
                if (!byCatSub.has(cat)) byCatSub.set(cat, new Map());
                const subMap = byCatSub.get(cat);
                if (!subMap.has(sub)) subMap.set(sub, []);
                subMap.get(sub).push(u);
                catHasAny.add(cat);
                subHasAny.add(cat + '|' + sub);
            });
            return { staff, byCatSub, catHasAny, subHasAny };
        };

        // ── Fila plana de un usuario (Entrenador/Padre) ──────────────
        const _userRowHtml = (u) => {
            const r = u._activeRoleData || {};
            const roleMeta = (window.ROLE_META || {})[r.role] || { icon: '👤', color: '#8b949e', label: r.role || 'Usuario' };
            let name = window.cronosNombreUsuario(u)   /* v534 · el correo NO es un nombre */;
            name = escapeHtml(String(name).split(' ')[0]);
            let regDate = '–';
            if (u.createdAt) {
                const d = u.createdAt.toDate ? u.createdAt.toDate() : new Date(u.createdAt.seconds ? u.createdAt.seconds * 1000 : u.createdAt);
                regDate = isNaN(d.getTime()) ? '–' : d.toLocaleDateString();
            } else if (u.authorizedAt) {
                regDate = new Date(u.authorizedAt).toLocaleDateString();
            }
            const euid  = (u._id || '').replace(/'/g, "\\'");
            const email = (u.email || '').replace(/'/g, "\\'");
            const ecid  = (clubId || '').replace(/'/g, "\\'");
            const erole = (r.role || u.role || '').replace(/'/g, "\\'");
            return `
                <div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(80px,1fr) minmax(0,2fr) auto auto;
                            align-items:center; gap:0.6rem; padding:0.55rem 0.6rem;
                            border-bottom:1px solid rgba(255,255,255,0.05);">
                    <div style="font-size:0.7rem; color:${roleMeta.color}; font-weight:600; white-space:nowrap;">${roleMeta.icon} ${escapeHtml(roleMeta.label)}</div>
                    <div style="font-weight:600; color:white; font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${name}</div>
                    <div style="font-size:0.74rem; color:#8b949e; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(u.email || '')}">${escapeHtml(u.email || '')}</div>
                    <div style="font-size:0.72rem; color:#8b949e; white-space:nowrap;">${regDate}</div>
                    <div style="display:flex; gap:0.4rem; flex-shrink:0; justify-content:flex-end;">
                        <!-- ⚠️ UN SOLO BOTÓN. Aquí había también un "🗑️ Usuario"
                             que borraba la cuenta ENTERA: se ha retirado. Desde
                             una fila de equipo sólo se vacía esa casilla; el
                             borrado de cuentas es cosa del SuperAdministrador al
                             cerrar temporada, y ocurre solo si era el último rol. -->
                        <button onclick="caRevocarCasilla('${euid}','${email}','${ecid}','${erole}')"
                            title="Quitar esta casilla: archiva su trabajo en la categoría y la deja vacante. La cuenta se conserva si le quedan otros roles."
                            class="sa-btn" style="padding:0.25rem 0.5rem; color:#ffa500; border-color:rgba(255,165,0,0.25);">➖ Quitar del equipo</button>
                    </div>
                </div>`;
        };

        // ── Cabecera de columnas para la lista de una subcategoría ───
        //    Mismo grid que _userRowHtml: Rol · Nombre · Email · Fecha · (acciones).
        const _userRowHeaderHtml = () => `
                <div style="display:grid; grid-template-columns:minmax(96px,auto) minmax(80px,1fr) minmax(0,2fr) auto auto;
                            align-items:center; gap:0.6rem; padding:0.4rem 0.6rem;
                            border-bottom:1px solid rgba(255,255,255,0.1);">
                    <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Rol</div>
                    <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Nombre</div>
                    <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Email</div>
                    <div style="font-size:0.62rem; font-weight:700; color:#79c0ff; text-transform:uppercase; letter-spacing:0.6px;">Fecha</div>
                    <div></div>
                </div>`;

        // ── Bloque Staff (siempre visible, sin plegar) ───────────────
        const _staffBlockHtml = (staff) => {
            // Orden: Director primero, luego Coordinadores.
            const ordered = staff.slice().sort((a, b) =>
                (a.role === 'director' ? 0 : 1) - (b.role === 'director' ? 0 : 1));
            const items = ordered.map(({ u, role, coordType }) => {
                const roleMeta = (window.ROLE_META || {})[role] || { icon: '👤', color: '#8b949e', label: role };
                let name = window.cronosNombreUsuario(u)   /* v534 · el correo NO es un nombre */;
                name = escapeHtml(String(name).split(' ')[0]);
                const euid  = (u._id || '').replace(/'/g, "\\'");
                const email = (u.email || '').replace(/'/g, "\\'");
                const ecid  = (clubId || '').replace(/'/g, "\\'");
                const erole = (role || '').replace(/'/g, "\\'");
                const modBadge = coordType
                    ? `<span class="sa-badge" style="background:rgba(210,168,255,0.15); color:#d2a8ff;">${_coordLabel[coordType] || coordType}</span>`
                    : '';
                return `
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:0.6rem;
                                padding:0.5rem 0.6rem; border-bottom:1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; align-items:center; gap:0.5rem; min-width:0;">
                            <span style="font-size:0.85rem; font-weight:700; color:white;">${name}</span>
                            <span style="font-size:0.7rem; color:${roleMeta.color}; font-weight:600;">${roleMeta.icon} ${escapeHtml(roleMeta.label)}</span>
                            ${modBadge}
                        </div>
                        <div style="display:flex; gap:0.4rem; flex-shrink:0;">
                            <button onclick="caRevocarCasilla('${euid}','${email}','${ecid}','${erole}')"
                                title="Quitar esta casilla: archiva su trabajo y la deja vacante"
                                class="sa-btn"
                                style="padding:0.25rem 0.5rem; color:#ffa500; border-color:rgba(255,165,0,0.25);">➖ Quitar del equipo</button>
                        </div>
                    </div>`;
            }).join('');
            return `
            <div style="background:rgba(240,136,62,0.05); border:1px solid rgba(240,136,62,0.25);
                        border-radius:10px; padding:0.8rem 0.9rem; margin-bottom:1rem;">
                <div style="font-size:0.78rem; font-weight:700; color:#f0883e; text-transform:uppercase;
                            letter-spacing:1px; margin-bottom:0.5rem;">📋 Staff del Club</div>
                ${items || '<div style="font-size:0.78rem; color:#8b949e; padding:0.4rem 0;">Sin staff (Director / Coordinadores) registrado.</div>'}
            </div>`;
        };

        // ── Subtarjeta (nivel 2): subcategoría A/B/C ─────────────────
        const _subcategoryCardHtml = (catId, subId, users, hasAny) => {
            const dot = hasAny
                ? `<span class="sa-badge" style="background:rgba(63,185,80,0.18); color:#3fb950;">${users.length}</span>`
                : `<span style="font-size:0.7rem; color:#6e7681;">vacía</span>`;
            const body = hasAny
                ? _userRowHeaderHtml() + users.map(_userRowHtml).join('')
                : '<div style="font-size:0.75rem; color:#6e7681; padding:0.5rem 0.6rem;">Sin usuarios en esta subcategoría.</div>';
            return `
                <div class="sa-card" style="margin-bottom:0.5rem; padding:0.6rem 0.7rem;
                            border-color:rgba(255,255,255,0.08);">
                    <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')">
                        <div class="sa-card-title" style="font-size:0.82rem;">
                            <span class="sa-chevron">▼</span>
                            <span>Subcategoría ${subId}</span>
                            ${dot}
                        </div>
                    </div>
                    <div class="sa-card-body">${body}</div>
                </div>`;
        };

        // ── Tarjeta (nivel 1): categoría ─────────────────────────────
        const _categoryCardHtml = (catDef, idx) => {
            const subMap = idx.byCatSub.get(catDef.id) || new Map();
            const catHas = idx.catHasAny.has(catDef.id);
            const subsHtml = CLUB_SUBCATS.map(subId => {
                const users = subMap.get(subId) || [];
                const subHas = idx.subHasAny.has(catDef.id + '|' + subId);
                return _subcategoryCardHtml(catDef.id, subId, users, subHas);
            }).join('');
            const dot = catHas
                ? '<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:#3fb950; box-shadow:0 0 6px rgba(63,185,80,0.7);"></span>'
                : '<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,0.12);"></span>';
            return `
                <div class="sa-card" style="margin-bottom:0.6rem; border-color:rgba(88,166,255,0.2);">
                    <div class="sa-card-head" onclick="this.closest('.sa-card').classList.toggle('expanded')">
                        <div class="sa-card-title">
                            <span class="sa-chevron">▼</span>
                            <span>${escapeHtml(catDef.label)}</span>
                            ${dot}
                        </div>
                    </div>
                    <div class="sa-card-body">${subsHtml}</div>
                </div>`;
        };

        // ── Render final: Staff + árbol de 7×3 ───────────────────────
        const _idx = _buildUserIndex(expandedUsers);
        const _treeHtml = CLUB_CATEGORIES.map(c => _categoryCardHtml(c, _idx)).join('');
        return `
        <div style="margin-bottom:1.5rem;">
            ${_staffBlockHtml(_idx.staff)}
            ${_treeHtml}
        </div>`;
    };

    // ── Modal principal ─────────────────────────────────────────────
    let modalHTML;
    try {
    // ════════════════════════════════════════════════════════════════
    //  🎛️ v597 · EL PANEL SE PARTE EN SECCIONES
    //
    //  Petición del autor (implementar.txt): que este panel adopte la misma
    //  estética que los de Entrenador, Dirección, Coordinación y Familias,
    //  que entran por un TABLERO de botones (`cronosTableroHtml`, utils.js).
    //  Hasta v596 esto era UNA PÁGINA de once bloques seguidos que había que
    //  recorrer entera para encontrar cualquier cosa.
    //
    //  🔑 EL CONTENIDO DE CADA BLOQUE NO SE TOCA. Lo único que cambia es
    //  DÓNDE se pega: cada bloque pasa a ser una constante con su marcado
    //  intacto, y el tablero decide cuál se pinta. Reescribir los bloques
    //  además de moverlos habría mezclado un cambio de aspecto con un cambio
    //  de comportamiento, y luego no se sabe cuál de los dos rompió qué.
    //  (La excepción, deliberada y pedida: la tabla de permisos — ver
    //  _secContactos.)
    //
    //  ⚠️ SON CONSTANTES, NO FUNCIONES, y se calculan AQUÍ: cierran sobre
    //  `users`, `clubId`, `pendingClubApproval`, `slotOf`, `unifiedUserTable`
    //  y una docena más de locales de esta función. Por eso `caTab` también
    //  se define aquí dentro (ver abajo): un `window.caTab` de ámbito global
    //  no vería nada de esto y tendría que volver a leerlo todo de la base.
    // ════════════════════════════════════════════════════════════════
    const _secSolicitudes = `

        <!-- ── BLOQUE DE TRANSPARENCIA: Enviadas al SuperAdmin ── -->
        ${(function(){
            const fw = users.filter(u => (u.allRoles || []).some(r => r.status === 'pending_sa' && (r.clubId === clubId || !r.clubId)));
            if (!fw.length) return '';
            const meta = window.ROLE_META || {};
            return `
            <div style="background:rgba(88,166,255,0.08); border:1px solid rgba(88,166,255,0.3); border-radius:12px; padding:1rem; margin-bottom:1.5rem;">
                <h3 style="margin:0 0 0.8rem; font-size:0.85rem; color:#58a6ff; display:flex; align-items:center; gap:0.5rem;">
                    📤 Solicitudes enviadas al SuperAdmin
                    <span style="background:#58a6ff; color:white; padding:2px 8px; border-radius:10px; font-size:0.7rem;">${fw.length}</span>
                </h3>
                ${fw.map(u => {
                    const pr = (u.allRoles || []).find(r => r.status === 'pending_sa');
                    const label = (meta[pr?.role] || {}).label || pr?.role || 'Usuario';
                    return `<div style="font-size:0.8rem; color:white; padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                        • <strong>${u.email}</strong> solicitó ser <strong>${label}</strong>. 
                        <span style="color:#8b949e; font-size:0.72rem; display:block; margin-top:2px;">⏳ Esperando que el SuperAdmin apruebe la solicitud.</span>
                    </div>`;
                }).join('')}
            </div>`;
        })()}

        <!-- ── BLOQUE 0: Aprobados por SA, pendientes de confirmación club ── -->
        ${pendingClubApproval.length ? `
        <div style="background:rgba(63,185,80,0.06);border:1px solid rgba(63,185,80,0.25);
                    border-radius:10px;padding:1rem;margin-bottom:1.2rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#3fb950;
                     display:flex;align-items:center;gap:0.5rem;">
            ✅ Pendientes de tu confirmación (aprobados por SA)
            <span style="background:rgba(63,185,80,0.15);color:#3fb950;padding:1px 8px;border-radius:10px;font-size:0.7rem;">${pendingClubApproval.length}</span>
          </h3>
          <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.7rem;padding:0.4rem 0.6rem;background:rgba(63,185,80,0.05);border-radius:6px;border:1px solid rgba(63,185,80,0.15);">
            El SuperAdmin ya los aprobó. Tú debes dar el acceso final.
          </p>
          ${pendingClubApproval.map(u => {
              const roleLabel = ROLE_META[u.role]?.label || u.role || 'Usuario';
              const roleIcon  = ROLE_META[u.role]?.icon  || '👤';
              const escEmail = (escapeAttr(u.email||'')).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
              const escId    = u._id.replace(/'/g,"\\'");
              return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">' +
                '<div><div style="font-size:0.85rem;font-weight:600;">' + (escapeHtml(u.email)) + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">' + roleIcon + ' ' + roleLabel + ' · Aprobado por SA ✅</div></div>' +
                '<div style="display:flex;gap:0.4rem;">' +
                '<button onclick="caConfirmClubAccess(\'' + escId + '\',\'' + (u.role||'user') + '\',\'' + escEmail + '\')" class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.3);background:rgba(63,185,80,0.08);">✅ Confirmar acceso</button>' +
                '<button onclick="caRejectRequest(\'' + escId + '\',\'' + escEmail + '\')" class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">✕ Rechazar</button>' +
                '</div></div>';
          }).join('')}
        </div>` : ''}

        <!-- ── BLOQUE 0b: Solicitudes de registro pendientes de reenvío ── -->
        ${pendingClubAdmin.length ? `
        <div style="background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.25);\n                    border-radius:10px;padding:1rem;margin-bottom:1.5rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#58a6ff;\n                     display:flex;align-items:center;gap:0.5rem;">
            📨 Solicitudes de Registro (${pendingClubAdmin.length})
          </h3>
          <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.7rem;padding:0.4rem 0.6rem;\n                     background:rgba(88,166,255,0.05);border-radius:6px;border:1px solid rgba(88,166,255,0.15);">
            ℹ️ Estos usuarios se han registrado y esperan que reenvíes su solicitud al SuperAdmin.
          </p>
          ${pendingClubAdmin.map(u => {
              // Usar _pendingRole (allRoles expandido) o requestedRole (platform_req)
              const roleKey   = u._pendingRole || u.requestedRole || u.role || 'user';
              const roleLabel = (ROLE_META[roleKey] || {}).label || roleKey;
              const roleIcon  = (ROLE_META[roleKey] || {}).icon  || '👤';
              const cat       = u._pendingCategory || u.requestedCategory;
              const sub       = u._pendingSubcat   || u.requestedSubcategory;
              const catInfo   = cat ? ' · <strong style="color:#3fb950">' + _catLabel(cat, sub) + '</strong>' : '';
              const nameInfo  = u.requestedName || [u.firstName, u.lastName].filter(Boolean).join(' ') || '';
              const emailShow = u.email || u.requestedEmail || '–';
              const escEmail  = (escapeAttr(emailShow)).replace(/\\/g,'\\\\').replace(/'/g,"\\'" );
              const escId     = (u._id||'').replace(/'/g,"\\'" );
              const fwdId     = u._isPlatformReq ? (u.userUid || escId) : escId;
              const escUserUid = (u._isPlatformReq ? (u.userUid || '') : '').replace(/'/g,"\\'");
              const isPR      = u._isPlatformReq ? 'true' : 'false';
              return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(88,166,255,0.15);">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">' +
                '<div style="min-width:0;flex:1;">' +
                '<div style="font-size:0.85rem;font-weight:600;word-break:break-all;">' + (escapeHtml(emailShow)) +
                (nameInfo ? ' · <span style="font-weight:400;color:#8b949e;font-size:0.78rem;">' + (escapeHtml(nameInfo)) + '</span>' : '') + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">' + roleIcon + ' ' + roleLabel + catInfo + '</div></div>' +
                '<div style="display:flex;gap:0.4rem;flex-shrink:0;">' +
                '<button onclick="caForwardToSA(\'' + fwdId + '\',\'' + roleKey + '\',\'' + escEmail + '\',\'' + clubId + '\',\'' + escapeAttr(cat || '') + '\',\'' + escapeAttr(sub || '') + '\')" class="sa-btn" style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.08);font-size:0.75rem;">📤 Reenviar al SA</button>' +
                '<button onclick="caRejectRequest(\'' + escId + '\',\'' + escEmail + '\',' + isPR + ',\'' + escUserUid + '\')" class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);font-size:0.75rem;">✕</button>' +
                '</div></div></div>';
          }).join('')}
        </div>` : ''}

        <!-- ── BLOQUE 0c: Roles pendientes de usuarios multi-rol ── -->
        ${pendingRolesInAllRoles.length ? `
        <div style="background:rgba(240,136,62,0.06);border:1px solid rgba(240,136,62,0.25);\n                    border-radius:10px;padding:1rem;margin-bottom:1.5rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#f0883e;\n                     display:flex;align-items:center;gap:0.5rem;">
            📋 Nuevos Roles Solicitados (${pendingRolesInAllRoles.length})
          </h3>
          <p style="font-size:0.73rem;color:#8b949e;margin:0 0 0.7rem;padding:0.4rem 0.6rem;\n                     background:rgba(240,136,62,0.05);border-radius:6px;border:1px solid rgba(240,136,62,0.15);">
            ℹ️ Usuarios activos que solicitan un rol adicional en el club. Reenvía al SuperAdmin para aprobación.
          </p>
          ${pendingRolesInAllRoles.map(u => {
              const _meta = window.ROLE_META || {};
              const roleLabel = (_meta[u.role] || {}).label || u.role;
              const roleIcon  = (_meta[u.role] || {}).icon  || '👤';
              const escEmail  = (escapeAttr(u.email||'')).replace(/\\/g,'\\\\').replace(/'/g,"\\'" );
              const escId     = u._id.replace(/'/g,"\\'");
              // ⚠️ v540 · DE QUÉ EQUIPO. Aquí es donde aparece el segundo
              // equipo de un entrenador ya activo, y sin la categoría el
              // administrador leía "Solicita: Entrenador" sin saber cuál de
              // los dos estaba aprobando.
              const _rCat = u._pendingCategory || '';
              const _rSub = u._pendingSubcat   || '';
              const _rCatInfo = _rCat
                  ? ' · <strong style="color:#f0883e">' +
                    escapeHtml(typeof window.cronosNombreCategoria === 'function'
                        ? window.cronosNombreCategoria(_rCat, _rSub) : _rCat) + '</strong>'
                  : '';
              return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;margin-bottom:0.5rem;border:1px solid rgba(240,136,62,0.15);display:flex;justify-content:space-between;align-items:center;">' +
                '<div><div style="font-size:0.85rem;font-weight:600;">' + (escapeHtml(u.email)) + '</div>' +
                '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Solicita: ' + roleIcon + ' ' + roleLabel + _rCatInfo + '</div></div>' +
                '<div style="display:flex;gap:0.4rem;">' +
                '<button onclick="caForwardToSA(\'' + escId + '\',\'' + (u.role||'user') + '\',\'' + escEmail + '\',\'' + clubId + '\',\'' + escapeAttr(_rCat) + '\',\'' + escapeAttr(_rSub) + '\')" class="sa-btn" style="color:#f0883e;border-color:rgba(240,136,62,0.3);background:rgba(240,136,62,0.08);">📤 Reenviar al SuperAdmin</button>' +
                '<button onclick="caRejectMultiRole(\'' + escId + '\',\'' + (u.role||'user') + '\',\'' + escEmail + '\')" class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">✕ Rechazar</button>' +
                '</div></div>';
          }).join('')}
        </div>` : ''}

        <!-- ── BLOQUE 0d: Solicitudes YA reenviadas (Transparencia) ── -->
        ${(function(){
            const forwarded = users.filter(u => {
                if (u.status === 'removed' || u.status === 'blocked') return false;
                // (a) Rol reenviado al SA dentro de allRoles (clubId de este club o vacío).
                const ar = u.allRoles || [];
                if (ar.some(r => r.status === 'pending_sa' && (r.clubId === clubId || !r.clubId))) return true;
                // (b) Usuario nuevo cuyo rol principal fue reenviado al SA (root status).
                if (u.status === 'pending_sa' && !u.isAuthorized && u.role !== 'club_admin'
                    && (u.clubId === clubId || !u.clubId)) return true;
                return false;
            });
            if (!forwarded.length) return '';
            return `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);
                        border-radius:10px;padding:1rem;margin-bottom:1.5rem; opacity:0.8;">
              <h3 style="font-size:0.8rem;margin:0 0 0.8rem;color:var(--text-muted);
                         display:flex;align-items:center;gap:0.5rem;">
                📦 Enviadas al SuperAdmin (Pendientes de aprobación final)
                <span style="background:rgba(255,255,255,0.05);color:var(--text-muted);padding:1px 8px;border-radius:10px;font-size:0.65rem;">${forwarded.length}</span>
              </h3>
              ${forwarded.map(u => {
                  const ar = u.allRoles || [];
                  const pr = ar.find(r => r.status === 'pending_sa' && (r.clubId === clubId || !r.clubId));
                  const meta = window.ROLE_META || {};
                  const _role = pr?.role || u.role || u.requestedRole;
                  const label = (meta[_role] || {}).label || _role || 'Usuario';
                  return '<div style="font-size:0.75rem; color:#8b949e; padding:4px 0;">' +
                         '• <b>' + (escapeHtml(u.email)) + '</b> (' + label + ')</div>';
              }).join('')}
            </div>`;
        })()}

        ${pendingMembers.length ? `
        <div style="background:rgba(255,165,0,0.06);border:1px solid rgba(255,165,0,0.25);
                    border-radius:10px;padding:1rem;margin-bottom:1.5rem;">
          <h3 style="font-size:0.85rem;margin:0 0 0.8rem;color:#ffa500;
                     display:flex;align-items:center;gap:0.5rem;">
            🔔 Solicitudes de Acceso (${pendingMembers.length})
          </h3>
          ${pendingMembers.map(u => {
              const si        = slotOf(u.requestedRole || 'user');
              const roleLabel = ROLE_META[u.requestedRole || 'user']?.label || 'Usuario';
              return `
              <div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:0.7rem;
                          margin-bottom:0.5rem;border:1px solid rgba(255,255,255,0.05);
                          display:flex;justify-content:space-between;align-items:center;">
                <div>
                  <div style="font-size:0.85rem;font-weight:600;">${escapeHtml(u.email)}</div>
                  <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">
                    Rol solicitado: <strong>${escapeHtml(roleLabel)}</strong> ·
                    <span style="color:${si.full ? '#ff5858' : '#31d0aa'};">
                      ${si.used}/${si.max === -1 ? '∞' : si.max} slots</span>
                  </div>
                </div>
                <div style="display:flex;gap:0.4rem;">
                  <!-- ⚠️ v546 · AQUÍ HABÍA UN BOTÓN "✅ Aceptar" QUE ACTIVABA AL
                       USUARIO EN EL ACTO, saltándose la aprobación del
                       SuperAdmin (escribía isAuthorized:true / status:'active').
                       Retirado por orden del autor el 2026-08-16. Desde aquí
                       sólo se REENVÍA al SuperAdmin o se RECHAZA; la activación
                       es suya y de nadie más. La puerta también está cerrada en
                       firestore.rules (clubNoActivaSinSuperAdmin), para que no
                       baste con llamar a la API. -->
                  <button onclick="caForwardToSA('${(escapeAttr(u._id)).replace(/'/g,"\\'")}','${u.requestedRole||'user'}','${(escapeAttr(u.email||'')).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}','${clubId}','${(escapeAttr(u.requestedCategory||u.category||'')).replace(/'/g,"\\'")}','${(escapeAttr(u.requestedSubcategory||u.subcategory||'')).replace(/'/g,"\\'")}' )"
                      class="sa-btn" style="color:#58a6ff;border-color:rgba(88,166,255,0.3);background:rgba(88,166,255,0.08);">
                      📤 Reenviar al SuperAdmin</button>
                  <button onclick="caRejectRequest('${(escapeAttr(u._id)).replace(/'/g,"\\'")}','${(escapeAttr(u.email||'')).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}' )"
                      class="sa-btn" style="color:#ff5858;border-color:rgba(255,88,88,0.3);background:rgba(255,88,88,0.08);">
                      ✕ Rechazar</button>
                </div>
              </div>`;
          }).join('')}
        </div>` : ''}

    `;

    // ════════════════════════════════════════════════════════════════
    //  👥 v598 · USUARIOS, CON LAS CUOTAS DENTRO
    //
    //  Encargo del autor (2026-08-21): "la información de cuotas debe dejar de
    //  ser una opción independiente del tablero y pasar a estar incluida dentro
    //  del panel de Usuarios, como un resumen de los usuarios ya dados de alta".
    //
    //  🔑 Y tiene sentido más allá del aspecto: las cuotas SE CALCULAN de los
    //  usuarios de esta misma tabla (`slotOf` mira las plazas ocupadas, v553).
    //  Eran dos vistas del mismo dato en dos puertas distintas del tablero, y
    //  el número de una sólo se entendía mirando la otra.
    //
    //  ⚠️ EL MARCADO DE LAS CUOTAS NO SE HA TOCADO: es el mismo `.sa-stats`
    //  que había en `_secCuotas`, movido de sitio. Cambiar el aspecto en el
    //  mismo paso que la ubicación haría imposible saber cuál de las dos cosas
    //  rompió algo.
    // ════════════════════════════════════════════════════════════════
    const _secUsuarios = `
        <!-- ── RESUMEN DE CUOTAS (antes era la sección suelta 💰 Cuotas) ── -->
        <h3 style="font-size:0.85rem; margin:0 0 0.6rem; color:#f0883e; display:flex; align-items:center; gap:0.5rem;">
            💰 Plazas del club
            <span style="font-size:0.68rem;color:var(--text-muted);font-weight:400;">
                ocupadas / contratadas por rol</span>
        </h3>
        <div class="sa-stats" style="margin-bottom:1.4rem;">
          ${['director','coordinator','user','parent'].map(role => {
              const si    = slotOf(role);
              const label = role==='director'?'Directores':role==='coordinator'?'Coordinadores':role==='parent'?'Padres':'Entrenadores';
              return `<div class="sa-stat">
                <div class="sa-stat-n" style="color:${si.full?'#ff5858':'#3fb950'};">
                  ${si.used}${si.unlimited ? '' : '/' + si.max}</div>
                <div class="sa-stat-l">${label}${si.unlimited?' ∞':''}</div>
                ${si.full ? '<div style="font-size:0.65rem;color:#ff5858;">Límite alcanzado</div>' : ''}
              </div>`;
          }).join('')}
        </div>

        <!-- ── TABLA DE USUARIOS UNIFICADA ── -->
        <h3 style="font-size:0.85rem; margin:0 0 0.8rem; color:#58a6ff; display:flex; align-items:center; gap:0.5rem;">
            👥 Usuarios del Club
            <span style="background:rgba(88,166,255,0.15); color:#58a6ff; padding:2px 8px; border-radius:10px; font-size:0.7rem;">${users.filter(u => u.status !== 'removed').length}</span>
        </h3>
        ${unifiedUserTable()}

    `;

    // ════════════════════════════════════════════════════════════════
    //  🗑️ v598 · AQUÍ VIVÍAN DOS SECCIONES QUE YA NO ESTÁN
    //
    //  1) 📩 SOLICITAR ALTA (`_secSolicitarAlta`). Retirada por encargo del
    //     autor (2026-08-21). Su motivo, textual: «el procedimiento correcto es
    //     que sea el propio usuario interesado quien se registre en la app y
    //     esa solicitud llegue automáticamente al administrador para su
    //     aprobación, por lo que no debe hacerlo el administrador manualmente».
    //     Ese camino ya existe y es el que se usa: el interesado se registra,
    //     su solicitud aterriza en ✅ Solicitudes y desde ahí se confirma. El
    //     formulario abría un SEGUNDO camino para lo mismo, con la peculiaridad
    //     de que su rótulo prometía «1️⃣ Tú solicitas aquí» — o sea, describía
    //     como "flujo correcto" justo el que el autor quiere eliminar.
    //     Con él se van sus manejadores, que no los llamaba nadie más:
    //     `caRoleChanged`, `caSolicitarUsuario` y `caAddUser`.
    //
    //  2) ⚙️ CONFIGURACIÓN DEL CLUB (`_secConfig`). Contenía UN solo control:
    //     el interruptor «📊 Enviar informes individualizados a padres»
    //     (`caToggleFeature(..., 'sendIndividualReports', ...)`). Retirado por
    //     encargo del autor: «esa decisión recae exclusivamente en el director
    //     deportivo».
    //
    //     🔑 Y el código le da la razón: `js/coach/reports/director-config.js`
    //     ya deja al DIRECTOR decidir esto **categoría por categoría**, y él
    //     mismo escribe `features.sendIndividualReports` como agregado de sus
    //     categorías (director-config.js:287-292). Eran DOS mandos sobre la
    //     misma llave, y el del administrador de club —que es global— pisaba de
    //     un plumazo el criterio por categorías del director. Quitarlo no deja
    //     la función huérfana: deja UN solo dueño, que es el que debía tenerla.
    //
    //     ⚠️ Al quedarse sin su único control, la sección entera desaparece.
    //     Dejar una tarjeta "⚙️ Configuración" vacía sería exactamente la clase
    //     de puerta que no lleva a ningún sitio que acabamos de limpiar en la
    //     v597. `caToggleFeature` se retira también: era su único llamante.
    //
    //     ⚠️ NO SE TOCAN LOS DATOS. `features.sendIndividualReports` sigue
    //     viviendo en los documentos de club y sigue leyéndose (utils.js:1520,
    //     director-config.js:73). Sólo desaparece este mando de aquí.
    // ════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════
    //  📇 v597 · CONTACTOS DEL CLUB — SE MIRA, NO SE CONFIGURA
    //
    //  🔴🔴🔴 LO QUE HABÍA AQUÍ NO HACÍA NADA. Seis casillas por persona
    //  (receiveConvocatorias, receiveEntrenamientos, receiveMessages,
    //  receiveReports, receiveIndividualReports, liveView) que `caSetPermission`
    //  escribía en `users/{uid}.permissions`... y que NO LEÍA NADIE. Censo del
    //  2026-08-21 sobre todo el proyecto: las seis claves aparecían ÚNICAMENTE
    //  en las seis líneas que las pintaban. Ni el envío de convocatorias, ni el
    //  de entrenamientos, ni los informes, ni el visor en vivo las consultaban
    //  jamás.
    //
    //  🔑 O sea: el administrador marcaba y desmarcaba creyendo conceder o
    //  retirar algo, y no cambiaba nada en ninguna parte. No era sólo confuso
    //  —que es como lo reportó el autor—: era decorativo. Y por eso quitarlo NO
    //  REQUIERE MIGRAR NADA: no hay que inventar una herencia por rol para
    //  sustituir a un mecanismo que nunca existió. Quien reparte de verdad hoy
    //  es el ROL de cada plaza y los EXTRAS del club (v596).
    //
    //  ⚠️ NO CONFUNDIR con las casillas del panel de CONTACTOS DEL ENTRENADOR
    //  (`contact-msg`, `canSendMsg`, las diez columnas de v429/v430). ÉSAS SÍ
    //  funcionan, deciden quién recibe y qué padre puede escribir, y viven en
    //  js/coach/comms/contact-manager.js. Aquí no se tocan.
    //
    //  ⚠️ Los campos `permissions` que quedaron escritos en los documentos NO
    //  se borran (decisión del autor): no los lee nadie, así que no estorban, y
    //  no hay que tocar datos reales de producción para quitar una interfaz.
    //
    //  Lo que se pinta ahora es la MISMA lista, en lectura, diciendo lo que da
    //  cada rol — y respetando los extras: si el club no tiene contratado
    //  "Partidos en Vivo", no se le promete a nadie.
    // ════════════════════════════════════════════════════════════════
    const _caExtras = (club && club.extras) || {};
    const _caExtraOn = (k) => _caExtras[k] !== false;   // ⚠️ !== false, como en todo el proyecto

    // Qué le da su ROL a cada quien. Es una DESCRIPCIÓN de lo que ya decide el
    // sistema, no una fuente de verdad nueva: si algún día cambia el reparto,
    // esto hay que actualizarlo — por eso el pie lo dice en voz alta.
    const _caLoQueDaElRol = (rol) => {
        const chips = [];
        const add = (icono, texto) => chips.push(icono + ' ' + texto);
        switch (rol) {
            case 'club_admin':
                add('👥', 'Usuarios y altas'); add('💰', 'Cuotas'); add('💳', 'Plan y facturas');
                add('💬', 'Mensajes');
                break;
            case 'director':
                add('📋', 'Convocatorias'); add('🏃', 'Entrenamientos'); add('✅', 'Asistencia');
                add('📊', 'Informes'); add('💬', 'Mensajes');
                if (_caExtraOn('secretaria')) add('✉️', 'Secretaría');
                add('⚙️', 'Configuración');
                if (_caExtraOn('partidos_terminados')) add('🎬', 'Partidos Terminados');
                if (_caExtraOn('partidos_en_vivo'))    add('🔴', 'En Vivo');
                break;
            case 'coordinator':
                add('📋', 'Convocatorias'); add('🏃', 'Entrenamientos'); add('✅', 'Asistencia');
                add('📊', 'Informes'); add('💬', 'Mensajes');
                if (_caExtraOn('partidos_terminados')) add('🎬', 'Partidos Terminados');
                if (_caExtraOn('partidos_en_vivo'))    add('🔴', 'En Vivo');
                break;
            case 'user':
            case 'coach':
                if (_caExtraOn('plantilla'))       add('👥', 'Plantilla');
                if (_caExtraOn('convocatorias'))   add('📋', 'Convocatorias');
                if (_caExtraOn('entrenamientos'))  add('🏃', 'Entrenamientos');
                if (_caExtraOn('informes'))        add('📊', 'Informes');
                if (_caExtraOn('mensajeria'))      add('💬', 'Mensajes');
                if (_caExtraOn('partidos_en_vivo'))add('🔴', 'En Vivo');
                break;
            case 'parent':
            case 'parent_individual':
            case 'padre_individual':
                if (_caExtraOn('convocatorias')) add('📋', 'Convocatorias');
                if (_caExtraOn('mensajeria'))    add('💬', 'Mensajes');
                if (features.sendIndividualReports) add('📊', 'Informe de su hijo/a');
                if (_caExtraOn('partidos_en_vivo')) add('🔴', 'En Vivo');
                break;
            default:
                break;
        }
        return chips;
    };

    const _caContactos = users
        .filter(u => u.status === 'active' && u.isAuthorized !== false)
        .sort((a, b) => (a.role || '').localeCompare(b.role || ''));

    // ── SECCIÓN: CONTACTOS ───────────────────────────────────────────
    const _secContactos = `
        <div class="sa-card" style="border-color:rgba(88,166,255,0.3);">
          <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.9rem;
                      padding:0.5rem 0.7rem;background:rgba(88,166,255,0.05);
                      border-radius:6px;border:1px solid rgba(88,166,255,0.15);line-height:1.5;">
            Quién es quién en el club y qué le da su rol.
            <strong style="color:#58a6ff;">No hay nada que configurar aquí:</strong>
            lo que recibe cada persona lo decide el <strong>rol</strong> con el que está
            dada de alta y los <strong>extras</strong> contratados por el club.
          </div>
          ${_caContactos.length === 0 ? `
            <div style="text-align:center;padding:2.5rem 1rem;color:var(--text-muted);font-size:0.85rem;">
              Todavía no hay usuarios activos en el club.
            </div>` : ''}
          ${_caContactos.map(u => {
              const meta  = ROLE_META[u.role] || { icon: '👤', color: '#8b949e', label: u.role || '?' };
              const chips = _caLoQueDaElRol(u.role);
              // ⚠️ El nombre real vive en allRoles[].firstName (v534): la raíz va
              //    desfasada en cuentas multi-rol y ahí salía el correo.
              const _rolCat = (u.allRoles || []).find(r => r && (r.clubId === clubId) && r.role === u.role) || {};
              const _nombre = u.displayName
                  || [_rolCat.firstName, _rolCat.lastName].filter(Boolean).join(' ')
                  || [u.firstName, u.lastName].filter(Boolean).join(' ')
                  || '';
              const _equipo = _rolCat.category
                  ? (typeof window.cronosNombreCategoria === 'function'
                      ? window.cronosNombreCategoria(_rolCat.category, _rolCat.subcategory || '')
                      : _rolCat.category)
                  : '';
              return '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);' +
                     'border-radius:10px;padding:0.75rem 0.85rem;margin-bottom:0.5rem;">' +
                '<div style="display:flex;align-items:center;gap:0.55rem;margin-bottom:' + (chips.length ? '0.5rem' : '0') + ';">' +
                  '<span style="font-size:1.1rem;">' + meta.icon + '</span>' +
                  '<div style="flex:1;min-width:0;">' +
                    '<div style="font-weight:700;font-size:0.82rem;color:white;word-break:break-word;">' +
                      escapeHtml(_nombre || u.email || u._id) +
                      (_nombre ? '<span style="color:#7d8590;font-weight:400;font-size:0.74rem;"> · ' +
                                 escapeHtml(u.email || '') + '</span>' : '') +
                    '</div>' +
                    '<div style="font-size:0.68rem;color:' + meta.color + ';margin-top:1px;">' + meta.label +
                      (_equipo ? ' · ' + escapeHtml(_equipo) : '') + '</div>' +
                  '</div>' +
                '</div>' +
                (chips.length
                  ? '<div style="display:flex;flex-wrap:wrap;gap:0.35rem;">' +
                    chips.map(c => '<span style="font-size:0.68rem;color:#8b949e;background:rgba(255,255,255,0.04);' +
                                   'border:1px solid rgba(255,255,255,0.07);padding:0.2rem 0.5rem;border-radius:5px;">' +
                                   escapeHtml(c) + '</span>').join('') +
                    '</div>'
                  : '') +
              '</div>';
          }).join('')}
        </div>

    `;

    // ── SECCIÓN: MI PLAN ─────────────────────────────────────────────
    const _secPlan = `
        <!-- ── SECCIÓN FACTURACIÓN ── -->
        <div style="margin-top:0;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.8rem;flex-wrap:wrap;gap:0.5rem;">
            <div style="font-size:0.88rem;font-weight:700;color:white;display:flex;align-items:center;gap:0.4rem;">
              💳 Mi suscripción
            </div>
            <button onclick="billClubView('club-billing-container')"
                style="padding:0.3rem 0.75rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                       border-radius:7px;color:#58a6ff;font-size:0.75rem;font-weight:600;cursor:pointer;">
                🔄 Actualizar
            </button>
          </div>
          <div id="club-billing-container" style="min-height:60px;">
            <div style="text-align:center;color:#8b949e;font-size:0.82rem;padding:1rem;">
              <button onclick="if(typeof billClubView==='function')billClubView('club-billing-container')"
                  style="padding:0.4rem 1rem;background:rgba(88,166,255,0.1);border:1px solid rgba(88,166,255,0.3);
                         border-radius:7px;color:#58a6ff;font-size:0.78rem;cursor:pointer;">
                  📊 Ver mi plan y facturas
              </button>
            </div>
          </div>
        </div>

    `;

    // ════════════════════════════════════════════════════════════════
    //  🎛️ EL TABLERO DE ENTRADA Y EL CAMBIO DE SECCIÓN
    // ════════════════════════════════════════════════════════════════
    const _caPendientes = pendingClubApproval.length + pendingClubAdmin.length
                        + pendingRolesInAllRoles.length + pendingMembers.length;

    const _CA_SECCIONES = {
        solicitudes: { titulo: '✅ Solicitudes',        html: _secSolicitudes },
        usuarios:    { titulo: '👥 Usuarios del Club',  html: _secUsuarios },
        contactos:   { titulo: '📇 Contactos del Club', html: _secContactos },
        plan:        { titulo: '💳 Mi Suscripción',     html: _secPlan },
    };

    // ⚠️ v598 · TRES TARJETAS MENOS QUE EN LA v597, Y NINGUNA POR ESTÉTICA:
    //   · 📩 Solicitar Alta — duplicaba el registro del propio interesado.
    //   · 💰 Cuotas         — su contenido vive ahora DENTRO de 👥 Usuarios.
    //   · ⚙️ Configuración  — se quedó sin su único control (ver arriba).
    // Y una cuarta, 📡 Transmitir al SuperAdmin, que se explica en su sitio.
    const _caOpciones = [
        { icono: '👥', titulo: 'Usuarios', color: '#58a6ff',
          desc: 'Altas, bajas, plazas del club y estado de todo el personal.',
          onclick: "caTab('usuarios')" },
        // 🔴 v598 · El aviso ya NO se pega al título. `badge` lo pinta como
        //    píldora roja (utils.js): desde el tablero se ve sin entrar, que es
        //    justo lo que pedía el autor.
        { icono: '✅', titulo: 'Solicitudes', color: '#3fb950',
          badge: _caPendientes,
          desc: _caPendientes
              ? 'Tienes ' + _caPendientes + ' pendiente(s) de reenviar o confirmar.'
              : 'Altas pendientes de reenviar al SuperAdmin o de confirmar.',
          onclick: "caTab('solicitudes')" },
        { icono: '📇', titulo: 'Contactos', color: '#31d0aa',
          desc: 'Quién es quién y qué le da su rol. Sólo lectura.',
          onclick: "caTab('contactos')" },
        { icono: '💳', titulo: 'Mi Plan', color: '#ffd700',
          desc: 'Suscripción, facturas y forma de pago.',
          onclick: "caTab('plan')" },
        { icono: '💬', titulo: 'Mensajes', color: '#3fb950',
          desc: 'Canales internos con el SuperAdmin y con tu Director.',
          onclick: "if(typeof openClubAdminMessaging==='function') openClubAdminMessaging('director'); else if(typeof showToast==='function') showToast('⚠️ Mensajería no disponible', 3000);" },
        { icono: '🔄', titulo: 'Ceder Administración', color: '#ff7b72',
          desc: 'Traspasar el club a otro administrador.',
          onclick: "caShowSuccession('" + escapeAttr(clubId) + "')" },
    ];

    // ⚠️ RESPALDO SIN EL HELPER. Si utils.js no ha cargado, el panel NO se
    // queda en blanco: se pintan todas las secciones seguidas, que es
    // exactamente como se veía hasta v596. Un menú que no pinta dejaría al
    // administrador sin panel, y este panel es el único sitio desde el que se
    // dan de alta usuarios.
    const _caMenuHtml = (typeof window.cronosTableroHtml === 'function')
        ? window.cronosTableroHtml({
            titulo: '🏟️ ' + (club.name || 'Club'),
            subtitulo: 'Panel del Administrador del Club — elige qué quieres gestionar:',
            opciones: _caOpciones,
          })
        : Object.keys(_CA_SECCIONES).map(k => _CA_SECCIONES[k].html).join('');

    // 🔑 caTab SE DEFINE AQUÍ DENTRO, no en el ámbito global, porque las siete
    // secciones son constantes que cierran sobre los datos ya leídos. Definida
    // fuera tendría que volver a consultar Firestore en cada pulsación — y este
    // panel lee la colección de usuarios entera.
    window.caTab = function caTab(sec) {
        const cuerpo = document.getElementById('ca-body');
        const barra  = document.getElementById('ca-navbar');
        if (!cuerpo) return;
        // Se recuerda para que un navReload() posterior (confirmar un acceso,
        // rechazar, activar…) devuelva a la sección donde se estaba y no al
        // tablero. Sin esto, cada acción te echaba al principio.
        window._caSeccionActual = sec;
        if (sec === 'menu' || !_CA_SECCIONES[sec]) {
            window._caSeccionActual = 'menu';
            if (barra) { barra.style.display = 'none'; barra.innerHTML = ''; }
            cuerpo.innerHTML = _caMenuHtml;
            return;
        }
        if (barra) {
            barra.style.display = 'flex';
            barra.innerHTML =
                '<button onclick="caTab(\'menu\')" ' +
                'style="display:inline-flex;align-items:center;gap:0.4rem;' +
                       'padding:0.42rem 0.9rem;border-radius:8px;cursor:pointer;' +
                       'background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.4);' +
                       'color:#58a6ff;font-size:0.8rem;font-weight:800;">' +
                '← Volver al Menú</button>' +
                '<span style="font-size:0.9rem;font-weight:800;color:white;">' +
                _CA_SECCIONES[sec].titulo + '</span>';
        }
        cuerpo.innerHTML = _CA_SECCIONES[sec].html;
        cuerpo.scrollTop = 0;
    };

    modalHTML = SA_CSS + `
    <style>
      /* Fix minimo: selector de hijo directo para que el plegado funcione con
         tarjetas .sa-card anidadas (cada nivel controla solo su propio body/chevron).
         Sobrescribe la regla descendente compartida sin tocar los otros archivos. */
      .sa-card.expanded > .sa-card-body { display: block; }
      .sa-card.expanded > .sa-card-head .sa-chevron { transform: rotate(0deg); }
      /* v597 · La barra de vuelta al tablero, igual que la del panel de
         Dirección (v591). Sólo se ve cuando NO estás en el tablero. */
      #ca-navbar { display:none; align-items:center; gap:0.7rem;
                   padding:0 0 0.9rem; flex-wrap:wrap; }
    </style>
    <div class="modal-content sa-modal">
      <div class="sa-topbar">
        <div>
          <div style="font-size:1.15rem;font-weight:700;">🏟️ ${escapeHtml(club.name)}</div>
          <div style="font-size:0.76rem;color:var(--text-muted);margin-top:0.1rem;">Panel del Administrador del Club</div>
        </div>
        <div style="display:flex;gap:0.7rem;flex-wrap:wrap;">
          <!-- ⚠️ v597 · LA BARRA SUPERIOR SE QUEDA CON UN SOLO BOTÓN. Mensajes,
               Transmitir al SuperAdmin y Ceder Administración se han bajado al
               tablero, donde cada uno lleva escrito PARA QUÉ sirve. Aquí arriba
               eran cuatro botones sin explicación, y "Ceder Administración"
               —que traspasa el club entero— estaba a un clic de "Salir". -->
          <button onclick="if(typeof cerrarSesion==='function')cerrarSesion();else if(typeof logoutUser==='function')logoutUser();"
              style="padding:0.45rem 1rem;background:rgba(255,88,88,0.15);
                     border:1px solid rgba(255,88,88,0.4);border-radius:10px;
                     color:#ff5858;font-size:0.75rem;font-weight:700;cursor:pointer;">
              🚪 SALIR</button>
        </div>
      </div>

      <div class="sa-body">
        <div id="ca-navbar"></div>
        <div id="ca-body"></div>
      </div><!-- /sa-body -->
    </div>`;
    } catch (renderErr) {
        console.error('[ClubAdmin] Error rendering panel:', renderErr);
        const _modal = document.getElementById('setup-modal');
        if (_modal) {
            _modal.style.display = 'flex';
            _modal.innerHTML = `<div style="background:#0d1117;border-radius:12px;padding:2rem;color:white;text-align:center;max-width:450px;margin:auto;">
                <div style="font-size:1.5rem;margin-bottom:1rem;">⚠️</div>
                <p style="color:#ff5858;font-size:0.88rem;">Error al renderizar el panel del club.</p>
                <p style="color:#8b949e;font-size:0.78rem;margin-top:0.5rem;">${escapeHtml(renderErr.message)}</p>
                <button onclick="document.getElementById('setup-modal').style.display='none'"
                    style="margin-top:1rem;padding:0.5rem 1.2rem;background:rgba(88,166,255,0.15);
                           border:1px solid rgba(88,166,255,0.4);border-radius:7px;color:#58a6ff;cursor:pointer;">
                    Cerrar</button>
            </div>`;
        }
        return;
    }

    // Pila de navegación (js/core/nav-stack.js): RAÍZ del panel del Admin de
    // Club, registrada CON el clubId ya resuelto. Ese argumento es todo el
    // arreglo: sin él, refrescar el panel devolvía al SuperAdmin al selector
    // de clubes (ver los navReload() de más abajo).
    //
    // ⚠️ Aquí el registro va DESPUÉS de varios `await`, al revés que en las
    // demás pantallas, porque el clubId no se conoce antes. Es seguro
    // PORQUE ES UNA RAÍZ: si navBack la re-invoca, el flag de restauración ya
    // estará limpio y navRootScreen reseteará la pila a [openClubAdminPanel],
    // que es exactamente donde debe quedar. El invariante "registrar antes del
    // primer await" sólo es crítico para navScreen (una pantalla intermedia sí
    // se re-apilaría y dejaría el "Volver" en bucle).
    if (typeof navRootScreen === 'function') navRootScreen('openClubAdminPanel', clubId);

    const modal = document.getElementById('setup-modal');
    if (!modal) {
        console.error('[ClubAdmin] setup-modal no encontrado. Creando modal temporal...');
        // Crear modal temporal si no existe en el DOM
        const tmpModal = document.createElement('div');
        tmpModal.id = 'setup-modal';
        tmpModal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem;';
        document.body.appendChild(tmpModal);
        tmpModal.innerHTML = modalHTML;
    } else {
        modal.style.display = 'flex';
        modal.innerHTML = modalHTML;
    }

    // v597 · Pintar la sección. Va DESPUÉS del innerHTML porque caTab busca
    // #ca-body en el DOM. Se vuelve a la sección donde se estaba: los
    // navReload() de las acciones (confirmar acceso, rechazar, activar…)
    // re-ejecutan esta función entera, y sin esto cada acción devolvía al
    // tablero y había que navegar otra vez hasta donde estabas.
    window.caTab(window._caSeccionActual || 'menu');

    // ── Confirmar acceso (paso 2: club admin confirma tras SA) ──────────
    window.caConfirmClubAccess = async (uid, role, email) => {
        const si = slotOf(role);
        if (si.full) {
            showToast(`⛔ No hay slots libres para ${role}. Solicita ampliación al SuperAdmin.`, 4000);
            return;
        }
        if (!confirm(`¿Confirmar acceso definitivo a ${email} como ${role}?`)) return;
        try {
            const targetDocRef = doc(db, 'users', uid);
            const targetSnap   = await getDoc(targetDocRef);
            let updateData = {
                isAuthorized: true,
                status: 'active',
                authorizedAt: new Date().toISOString(),
                authorizedBy: me.email
            };

            if (targetSnap.exists()) {
                const data = targetSnap.data();
                
                // Buscar metadata en platform_requests si no está en el doc
                let cat = data.requestedCategory || data.category || data.categoryLabel;
                let sub = data.requestedSubcategory   || data.subcategory;

                const roleInAll = (data.allRoles || []).find(r => r.role === role);
                if (roleInAll) {
                    cat = roleInAll.category || cat;
                    sub = roleInAll.subcategory || sub;
                }

                if (cat) {
                    updateData.category      = cat;
                    updateData.categoryLabel = cat;
                    if (sub) {
                        updateData.subcategory = sub;
                    }
                }
                if (data.allRoles) {
                    updateData.allRoles = data.allRoles.map(r => {
                        if (r.role === role && (String(r.clubId||'') === String(clubId||''))) {
                            return { ...r, isAuthorized: true, status: 'active', category: cat, subcategory: sub };
                        }
                        return r;
                    });
                } else {
                    // Crear allRoles si no existe
                    updateData.allRoles = [{
                        role: role, clubId: clubId, isAuthorized: true, status: 'active',
                        category: cat, subcategory: sub
                    }];
                }
            }
            await updateDoc(targetDocRef, updateData);
            // ⚠️ v553 · Sin escritura de `usedSlots`: el recuento se calcula.
            showToast(`✅ ${email} tiene acceso completo a la app.`, 4000);
            
            // Limpiar platform_request si existe
            try {
                const prRef = doc(db, 'platform_requests', 'fwd_' + clubId + '_' + uid + '_' + role);
                await updateDoc(prRef, { status: 'approved', approvedAt: new Date().toISOString() }).catch(()=>{});
            } catch(prErr) {}

            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
        } catch(e) {
            showToast('❌ Error: ' + e.message, 3000);
        }
    };

    // ── Aprobar solicitud de acceso (auto-registro pendiente SA) ────────────
    // ⚠️ v540 · RECIBE LA CATEGORÍA DE LA SOLICITUD (`cat`/`sub`). Antes se
    // deducía del PRIMER rol 'user' que hubiera en allRoles, y desde v537 un
    // entrenador puede tener dos: se validaba y se activaba la plaza
    // equivocada. Son opcionales para no romper llamadas antiguas.
    window.caApproveRequest = async (uid, role, email, cat, sub) => {
        // ══════════════════════════════════════════════════════════════
        //  ⛔ v546 · CERRADA. EL CLUB NO ACTIVA A NADIE.
        //
        //  Esta función escribía `isAuthorized:true, status:'active'` en el
        //  documento de otro usuario, y con eso lo metía en el club **sin que
        //  el SuperAdmin llegara a verlo**. Es el agujero que reportó el autor
        //  el 2026-08-16 y su instrucción fue tajante: *"ningún administrador
        //  de club debe poder activar directamente a un usuario ni saltarse al
        //  SuperAdmin"*.
        //
        //  🔑 Se deja la función —no se borra— porque puede quedar algún
        //  `onclick` en una pestaña abierta o en una copia cacheada: así, en
        //  vez de fallar con un críptico "Missing or insufficient permissions"
        //  cuando las reglas la rechacen, explica lo que pasa y ofrece la vía
        //  correcta. La barrera de verdad está en firestore.rules
        //  (`clubNoActivaSinSuperAdmin`), no aquí.
        //
        //  ⚠️ NO confundir con `caConfirmClubAccess`, que sigue viva y es
        //  legítima: remata el alta de quien el SuperAdmin YA aprobó
        //  (`approvedBySA:true`) y consume la plaza del club.
        // ══════════════════════════════════════════════════════════════
        alert('⛔ La activación de usuarios es competencia exclusiva del SuperAdmin.\n\n' +
              'Desde el panel del club puedes REENVIAR la solicitud de ' + (email || 'este usuario') +
              ' al SuperAdmin o RECHAZARLA.\n\n' +
              'Cuando él la apruebe, te aparecerá en "Pendientes de tu confirmación" ' +
              'para que remates el alta.');
        return;
        /* eslint-disable no-unreachable */
        // ════════════════════════════════════════════════════════════════
        //  v537 · LA REGLA SE COMPRUEBA AL AUTORIZAR, NO SÓLO AL MOVER.
        //  Aquí es donde una solicitud se convierte en equipo asignado: sin
        //  este candado, la combinación prohibida entra por la puerta grande.
        //  Sólo aplica al rol de ENTRENADOR (`user`).
        // ════════════════════════════════════════════════════════════════
        if (role === 'user' && typeof window.cronosPuedeLlevarEquipo === 'function') {
            try {
                const _s0 = await getDoc(doc(db, 'users', uid));
                const _d0 = _s0.exists() ? _s0.data() : {};
                // 🔑 v540 · LA CATEGORÍA DE LA SOLICITUD MANDA. El `.find()` por
                // rol devolvía una plaza al azar cuando el entrenador ya tenía
                // otra, y se validaba la combinación contra la categoría que no
                // era. Sólo se recurre a allRoles si la llamada no la trae.
                const _r0 = (_d0.allRoles || []).find(r => r && r.role === role) || {};
                const _cat0 = cat || _r0.category || _d0.requestedCategory || _d0.category || _d0.categoryLabel;
                const _v0 = window.cronosPuedeLlevarEquipo(_d0.allRoles, _cat0, clubId,
                                                           { excluyeCategoria: _cat0 });
                // ⚠️ Se excluye la categoría que se está autorizando: su propia
                // entrada ya está en allRoles (pendiente) y se contaría a sí misma.
                if (!_v0.ok) {
                    alert('🚫 No se puede autorizar a ' + email + ' en "' + _cat0 + '".\n\n' +
                          _v0.motivo + '\n\nNo se ha autorizado nada.');
                    return;
                }
            } catch (e) {
                console.warn('[v537] No se pudo validar la modalidad al autorizar:', e && e.message);
            }
        }

        if (!confirm(`¿Autorizar acceso a ${email} como ${role}?`)) return;
        try {
            const targetDocRef = doc(db, 'users', uid);
            const targetSnap   = await getDoc(targetDocRef);
            let updateData = {
                isAuthorized: true,
                status: 'active',
                authorizedAt: new Date().toISOString(),
                authorizedBy: me.email
            };

            // Si el usuario tiene metadatos de categoría en la solicitud, migrarlos a la raíz del perfil
            if (targetSnap.exists()) {
                const data = targetSnap.data();
                // ═══════════════════════════════════════════════════════════
                //  v540 · SE AUTORIZA UNA PLAZA, NO UN ROL
                //  Con dos equipos en el mismo club (un F7 y un F11, v537) el
                //  `.map(r => r.role === role ? activar : r)` activaba LOS DOS
                //  de una vez, y el `.find(r => r.role === role)` leía la
                //  categoría de cualquiera de ellos.
                // ═══════════════════════════════════════════════════════════
                const _plaza = { role: role, clubId: clubId,
                                 category: cat || null, subcategory: sub || null };
                const _esLaPlaza = (r) => (typeof window.cronosMismaPlaza === 'function' && cat)
                    ? window.cronosMismaPlaza(r, _plaza)
                    : (r && r.role === role);

                const roleInAll = (data.allRoles || []).find(_esLaPlaza);

                // Prioridad: 1. La categoría que viene con la solicitud,
                // 2. la de la plaza en allRoles, 3. la de la raíz del perfil.
                const _cat = cat || (roleInAll && roleInAll.category) || data.requestedCategory || data.categoryLabel;
                const _sub = sub || (roleInAll && roleInAll.subcategory) || data.requestedSubcategory;

                if (_cat) {
                    updateData.category      = _cat;
                    updateData.categoryLabel = _cat;
                    if (_sub) {
                        updateData.subcategory = _sub;
                    }
                }

                // También activar esa plaza dentro del array allRoles
                if (data.allRoles) {
                    const newAllRoles = data.allRoles.map(r => {
                        if (_esLaPlaza(r)) return { ...r, isAuthorized: true, status: 'active' };
                        return r;
                    });
                    updateData.allRoles = newAllRoles;
                }
            }

            await updateDoc(targetDocRef, updateData);
            // ⚠️ v553 · Sin escritura de `usedSlots`: el recuento se calcula.
            showToast(`✅ ${email} autorizado correctamente.`, 3000);
            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
        } catch(e) {
            showToast('❌ Error al autorizar usuario: ' + e.message, 3000);
        }
    };

    // ── Rechazar solicitud de acceso ─────────────────────────────────
    // v474 · Rechazar es DOS limpiezas independientes —marcar el perfil y
    // retirar la(s) solicitud(es)— y antes iban encadenadas: si la primera
    // fallaba, la segunda ni se intentaba y la solicitud se quedaba colgada en
    // el panel para siempre (el caso reportado). Ahora se intentan LAS DOS y
    // solo se da error si no se consiguió ninguna.
    //
    // ⚠️ Los deleteDoc se ESPERAN uno a uno. Antes se lanzaban sin await
    // dentro de un forEach y el repintado posterior (navReload) llegaba antes
    // que los borrados: la solicitud recién rechazada volvía a aparecer.
    window.caRejectRequest = async (uid, email, isPlatformReq, userUid) => {
        if (!confirm('¿Rechazar solicitud de ' + email + '?')) return;

        // `uid` es el id de un doc de platform_requests o el de un usuario.
        const isPR = isPlatformReq === true || isPlatformReq === 'true'
            || (typeof uid === 'string' && (uid.startsWith('self_reg_') || uid.startsWith('fwd_')
                || uid.startsWith('ind_reg_') || uid.startsWith('user_req_')));
        const targetUid = isPR ? (userUid || '') : (uid || '');

        const fallos = [];
        let algoHecho = false;

        // 1. Marcar el perfil como rechazado (si sabemos de quién es).
        if (targetUid) {
            try {
                await updateDoc(doc(db, 'users', targetUid), {
                    isAuthorized: false, status: 'rejected',
                    rejectedAt: new Date().toISOString(), rejectedBy: me.uid
                });
                algoHecho = true;
            } catch (updErr) {
                const msg = updErr && updErr.message ? updErr.message : String(updErr);
                // Que el documento no exista NO es un fallo: hay solicitudes sin
                // perfil todavía. Solo hay que retirar la solicitud.
                if (!msg.includes('No document to update')) fallos.push('perfil: ' + msg);
            }
        }

        // 2. Retirar la solicitud pulsada y cualquier otra del mismo usuario,
        //    para que no reaparezca como solicitud fantasma.
        //    ⚠️ EL FILTRO POR clubId NO ES DECORATIVO. Firestore autoriza una
        //    consulta SIN leer los documentos: la regla tiene que quedar
        //    garantizada por los filtros de la consulta. Con `userUid` a secas,
        //    `resource.data.clubId` es desconocido y la consulta se deniega
        //    entera —"Missing or insufficient permissions" al LISTAR—, que es
        //    justo por lo que las solicitudes seguian sin retirarse. El listado
        //    principal del panel (linea ~180) ya filtra por clubId; esta no.
        const porBorrar = [];
        if (isPR && uid) porBorrar.push(uid);
        if (targetUid) {
            try {
                const prSnap = await getDocs(query(collection(db, 'platform_requests'),
                    where('clubId', '==', clubId), where('userUid', '==', targetUid)));
                prSnap.forEach(d => { if (porBorrar.indexOf(d.id) === -1) porBorrar.push(d.id); });
            } catch (qErr) {
                console.warn('[caRejectRequest] No se pudieron listar las solicitudes:', qErr.message);
            }
        }
        for (const prId of porBorrar) {
            try { await deleteDoc(doc(db, 'platform_requests', prId)); algoHecho = true; }
            catch (delErr) { fallos.push('solicitud ' + prId + ': ' + (delErr.message || delErr)); }
        }

        if (!algoHecho && fallos.length) {
            showToast('❌ Error al rechazar: ' + fallos[0], 4000);
            return;
        }
        if (fallos.length) console.warn('[caRejectRequest] Rechazo parcial:', fallos);

        showToast('❌ Solicitud de ' + email + ' rechazada.', 3000);
        // Refresco tras la acción. Antes iba SIN clubId, así que al
        // SuperAdmin le devolvía al selector de clubes.
        if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
    };

    // ── Rechazar rol pendiente de un usuario multi-rol ─────────────
    window.caRejectMultiRole = async (uid, role, email) => {
        const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
        if (!confirm('¿Rechazar rol de ' + (ROLE_LABELS[role]||role) + ' para ' + email + '?')) return;
        try {
            const { db: fDb, doc: fDoc, updateDoc: fUpdateDoc, getDoc: fGetDoc } = await saFS();
            const userSnap = await fGetDoc(fDoc(fDb, 'users', uid));
            if (!userSnap.exists()) { showToast('❌ Usuario no encontrado', 3000); return; }
            const userData = userSnap.data();
            const allRoles = userData.allRoles || [];
            // Remove the pending role from allRoles
            const filtered = allRoles.filter(ar => !(ar.role === role && !ar.isAuthorized));
            // Update user doc (user writes own doc — should work)
            // But if called from Club Admin context, it might fail. Use try-catch.
            try {
                await fUpdateDoc(fDoc(fDb, 'users', uid), {
                    allRoles: filtered,
                    rejectedAt: new Date().toISOString(),
                    rejectedBy: window._cronosCurrentUser?.email || 'club_admin',
                });
            } catch (updErr) {
                console.warn('[caRejectMultiRole] Could not update user doc:', updErr.message);
            }
            showToast('❌ Rol ' + (ROLE_LABELS[role]||role) + ' rechazado para ' + email, 3000);
            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
        } catch(e) { showToast('❌ Error al rechazar: ' + e.message, 3000); }
    };

    // ── Reenviar solicitud de registro al SuperAdmin ─────────────────
    // Helper: etiqueta legible de categoría
    function _catLabel(cat, sub) {
        if (!cat) return '';
        const labels = { prebenjamin:'Prebenjamín', benjamin:'Benjamín', alevin:'Alevín',
                         infantil:'Infantil', cadete:'Cadete', juvenil:'Juvenil', regional:'Regional',
                         regional_fem:'Regional FEM', futurefem:'FUTureFEM' };
        return (labels[cat] || cat) + (sub ? ' ' + sub : '');
    }

    // ⚠️ v540 · `cat`/`sub` opcionales: identifican QUÉ equipo se reenvía
    // cuando el entrenador tiene dos en el mismo club.
    window.caForwardToSA = async (uid, role, email, cid, cat, sub) => {
        const ROLE_LABELS = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador', director:'Director Deportivo' };
        if (!confirm(`¿Reenviar solicitud de ${email} como ${ROLE_LABELS[role]||role} al SuperAdmin?`)) return;
        try {
            const { db: fDb, doc: fDoc, updateDoc: fUpdateDoc, setDoc: fSetDoc, getDoc: fGetDoc, deleteDoc: fDeleteDoc } = await saFS();
            
            // 1. Read current user doc to check if user already has active roles
            const userSnap = await fGetDoc(fDoc(fDb, 'users', uid));
            const userData = userSnap.exists() ? userSnap.data() : {};
            const hasOtherActiveRoles = (userData.isAuthorized === true) && userSnap.exists();
            
            // 1. Intentar actualizar el doc del usuario (informativo, puede fallar por reglas)
            try {
                if (hasOtherActiveRoles) {
                    const allRoles = userData.allRoles || [];
                    // 🔑 v540 · por PLAZA: con dos equipos, buscar sólo por rol
                    // marcaba como reenviado el que no era.
                    const _plazaFwd = { role: role, clubId: cid || null,
                                        category: cat || null, subcategory: sub || null };
                    const roleIdx = allRoles.findIndex(r =>
                        (typeof window.cronosMismaPlaza === 'function' && cat)
                            ? window.cronosMismaPlaza(r, _plazaFwd)
                            : (r.role === role && (r.clubId || null) === (cid || null))
                    );
                    if (roleIdx >= 0) {
                        allRoles[roleIdx].status = 'pending_sa';
                        allRoles[roleIdx].forwardedToSA = true;
                    }
                    await fUpdateDoc(fDoc(fDb, 'users', uid), { allRoles });
                } else {
                    await fUpdateDoc(fDoc(fDb, 'users', uid), { status: 'pending_sa' });
                }
            } catch (updErr) {
                console.warn('[caForwardToSA] No se pudo actualizar el perfil del usuario (falta de permisos), procediendo con platform_request...');
            }

            // 2. Crear solicitud oficial de reenvío (ID único para el admin para evitar errores de permisos)
            const clubSnap = await fGetDoc(fDoc(fDb, 'clubs', cid));
            const clubName = clubSnap.exists() ? (clubSnap.data().name || '') : '';
            
            // Usar un ID que el Club Admin "posea" para evitar el error de permisos al sobrescribir la del usuario
            // 🔑 v540 · con la PLAZA dentro: `fwd_<club>_<uid>_user` era el
            // mismo id para el F7 y el F11 del mismo entrenador, así que
            // reenviar el segundo borraba el primero.
            const _sufFwd = (role === 'user' && cat && typeof window.cronosTeamSlug === 'function')
                ? '_' + window.cronosTeamSlug(String(cat) + '-' + (sub || '')) : '';
            const fwdReqId = 'fwd_' + cid + '_' + uid + '_' + role + _sufFwd;

            const realEmail = (email && email !== '–' && email !== '-') ? email 
                            : (userData.email || userData.requestedEmail || '');
            const realName  = userData.displayName || 
                             [userData.firstName, userData.lastName].filter(Boolean).join(' ') || 
                             userData.requestedName || '';

            // Obtener categorías si existen (del doc del usuario, allRoles, o de la solicitud original)
            // 🔑 v540 · la categoría que llega con la llamada MANDA: es la del
            // equipo que el administrador ha pulsado. La raíz del perfil sólo
            // puede guardar una, y con dos equipos sería la del otro.
            let userCatFwd    = cat || userData.requestedCategory || userData.category || null;
            let userSubcatFwd = (cat ? (sub || null) : null) || userData.requestedSubcategory || userData.subcategory || null;
            let userCoordTypeFwd = userData.requestedCoordinatorType || userData.coordinatorType || null;
            const userSlotFwd = userData.requestedSlot     || null;
            // Buscar también en allRoles si no se encontró en el doc raíz
            if (!userCatFwd && userData.allRoles) {
                const roleEntry = userData.allRoles.find(r => r.role === role && (r.clubId || null) === (cid || null));
                if (roleEntry) {
                    userCatFwd    = roleEntry.category || roleEntry.categoryLabel || null;
                    userSubcatFwd = roleEntry.subcategory || null;
                    if (!userCoordTypeFwd) userCoordTypeFwd = roleEntry.coordinatorType || null;
                }
            }

            await fSetDoc(fDoc(fDb, 'platform_requests', fwdReqId), {
                type: 'self_registration',
                clubId: cid,
                clubName: clubName,
                requestedEmail:    realEmail,
                requestedName:     realName,
                requestedRole:     role,
                requestedRoleLabel: ROLE_LABELS[role] || role,
                requestedCategory: userCatFwd,
                requestedSubcategory:   userSubcatFwd,
                requestedCoordinatorType: userCoordTypeFwd,
                requestedSlot:     userSlotFwd,
                userUid: uid,
                status: 'pending_sa',
                forwardedBy: window._cronosCurrentUser?.email || 'club_admin',
                forwardedAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
            });
            
            // 3. Limpiar la solicitud original self_reg_* para que no quede colgada como pendiente
            //    Se buscan platform_requests de tipo pending_club_admin con el mismo usuario
            //    ⚠️ v474 · MISMO DEFECTO QUE EN caRejectRequest, y aqui lo tapaba un
            //    `catch(_) {}` mudo: sin el filtro por clubId la consulta se DENIEGA
            //    entera, asi que esta limpieza no borraba nada. Se ve en los datos de
            //    produccion: usuarios con su `fwd_*` ya aprobado y el `self_reg_*`
            //    original todavia en pending_club_admin, apareciendo como pendientes.
            //    Los borrados se ESPERAN, como en caRejectRequest.
            try {
                const { getDocs: _gds, collection: _col, query: _q, where: _w } = await saFS();
                const origPRSnap = await _gds(_q(_col(fDb, 'platform_requests'),
                    _w('clubId', '==', cid), _w('userUid', '==', uid)));
                const _viejas = [];
                origPRSnap.forEach(d => {
                    if (d.id === fwdReqId) return;
                    const _dd = d.data();
                    if (_dd.status !== 'pending_club_admin' && _dd.status !== 'pending') return;
                    // ⚠️ v540 · NO ARRASTRAR LA SOLICITUD DEL OTRO EQUIPO. Un
                    // entrenador puede tener dos pendientes (su F7 y su F11);
                    // esta limpieza sólo debe retirar la que se acaba de
                    // reenviar, no la de la otra plaza.
                    if (role === 'user' && userCatFwd && _dd.requestedRole === 'user' &&
                        _dd.requestedCategory &&
                        typeof window.cronosMismaPlaza === 'function' &&
                        !window.cronosMismaPlaza(
                            { role: 'user', clubId: cid, category: _dd.requestedCategory, subcategory: _dd.requestedSubcategory },
                            { role: 'user', clubId: cid, category: userCatFwd, subcategory: userSubcatFwd })) {
                        return;
                    }
                    _viejas.push(d.id);
                });
                for (const _vid of _viejas) {
                    try { await fDeleteDoc(fDoc(fDb, 'platform_requests', _vid)); }
                    catch (e) { console.warn('[caForwardToSA] No se pudo retirar la solicitud original ' + _vid + ':', e.message); }
                }
            } catch(e) { console.warn('[caForwardToSA] No se pudieron listar las solicitudes originales:', e.message); }

            showToast('✅ Solicitud de ' + email + ' reenviada al SuperAdmin.', 4000);
            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
        } catch(e) {
            showToast('❌ Error al reenviar: ' + e.message, 3000);
        }
    };

    // ── Cambiar estado de un usuario (activo / bloqueado / baja) ──

    // ══════════════════════════════════════════════════════════════════
    // REVOCAR UNA CASILLA (rol + categoría) — NO se borra a la persona
    // ══════════════════════════════════════════════════════════════════
    // 🔑 LA REGLA DE NEGOCIO, tal y como la fijó el autor:
    //
    //    · El correo es de la PERSONA. La casilla (rol + categoría) es del
    //      CLUB. Una misma cuenta puede llevar varias casillas: un equipo de
    //      F11 y otro de F7, y además ser padre, coordinador o director.
    //    · Revocar una casilla ARCHIVA su trabajo en la categoría —para que
    //      lo herede quien venga— y la deja VACANTE. La cuenta no se toca.
    //    · SÓLO si era el ÚLTIMO rol que le quedaba en el club se elimina su
    //      cuenta de Auth y se libera su correo.
    //
    // ⚠️ Desde las filas de equipo YA NO SE BORRAN CUENTAS ENTERAS. Eso lo
    //    gestiona el SuperAdministrador a nivel de club al cerrar temporada.
    //    Aquí sólo se vacían casillas; el borrado, cuando toca, es una
    //    CONSECUENCIA de haber revocado la última, no una acción aparte.
    //
    // 🔑 EL ORDEN NO ES CASUAL:
    //   1. Revocar primero: marca el rol y —lo que la Function no hace—
    //      LIBERA LA PLAZA del club decrementando usedSlots.
    //   2. Después la Function: archiva y verifica; y sólo si no le queda
    //      ningún rol, borra la cuenta.
    window.caRevocarCasilla = async (userId, userEmail, cid, targetRole) => {
        // ── Cuántos roles le quedarían: decide el aviso y la confirmación ──
        // Se lee del documento, no de lo pintado en la fila: la fila puede
        // llevar minutos en pantalla.
        let quedanOtros = null;   // null = no se ha podido saber
        try {
            const _s = await getDoc(doc(db, 'users', userId));
            if (_s.exists()) {
                const _d = _s.data() || {};
                const _todos = Array.isArray(_d.allRoles) ? _d.allRoles : [];
                const _vivo = (r) => r && r.status !== 'removed' &&
                                     (r.isAuthorized === true || r.authorized === true);
                // El que se está revocando ahora todavía consta como vivo.
                quedanOtros = _todos.filter((r) => _vivo(r) &&
                    !(r.role === targetRole && (!r.clubId || String(r.clubId) === String(cid || '')))).length;
            }
        } catch (_) { /* si falla, se avisa en genérico y decide el servidor */ }

        const _rotulo = { user: 'Entrenador', parent: 'Padre/Madre/Tutor', director: 'Director Deportivo',
                          coordinator: 'Coordinador', club_admin: 'Administrador' }[targetRole] || targetRole;
        const esUltimo = (quedanOtros === 0);

        if (!confirm(
            '➖ QUITAR LA CASILLA DE "' + _rotulo + '" A ' + userEmail + '\n\n' +
            'QUÉ PASA CON EL TRABAJO:\n' +
            '• Se archiva en la categoría, para el siguiente entrenador\n' +
            '• Informes, convocatorias y entrenamientos siguen en el club\n\n' +
            'QUÉ PASA CON LA CASILLA:\n' +
            '• Queda VACANTE, lista para otra persona\n\n' +
            'QUÉ PASA CON SU CUENTA:\n' +
            (esUltimo
                ? '• ⚠️ Es el ÚLTIMO rol que le queda en el club:\n' +
                  '  su cuenta se ELIMINARÁ y su correo quedará LIBRE.\n' +
                  '  ESTO NO SE PUEDE DESHACER.\n'
                : (quedanOtros === null
                    ? '• Se conservará si le quedan otros roles\n'
                    : '• Sigue intacta: conserva ' + quedanOtros + ' rol(es) más\n')) +
            '\n¿Continuar?'
        )) return;

        // ── Segunda confirmación SÓLO cuando de verdad se va a borrar ──
        // 🔑 Pedirla siempre acabaría en aceptar sin leer; pedirla justo
        //    cuando la acción es irreversible es lo que la hace valer.
        if (esUltimo) {
            const tecleado = prompt(
                'Es su último rol: se eliminará la cuenta y se liberará el correo.\n\n' +
                'Escribe el correo completo para confirmarlo:\n' + userEmail
            );
            if (tecleado === null) return;
            if (String(tecleado).trim().toLowerCase() !== String(userEmail).trim().toLowerCase()) {
                alert('El correo no coincide. No se ha hecho nada.');
                return;
            }
        }

        try {
            if (typeof showToast === 'function') showToast('⏳ Archivando el trabajo del equipo…', 4000);

            // 1. Revocar esa casilla: marca el rol y libera la plaza.
            await window.caSetUserStatus(userId, userEmail, 'removed', cid, targetRole, true);

            // 2. Archivar (y borrar la cuenta sólo si era el último rol).
            if (typeof httpsCallable !== 'function' || !fa || !fa.functions) {
                alert('⚠️ La casilla ha quedado vacante, pero no se pudo contactar con el ' +
                      'servidor para archivar el trabajo. No se ha borrado nada: reinténtalo.');
                return;
            }
            const res = await httpsCallable(fa.functions, 'archiveAndDeleteCoach')({
                uid: userId, email: userEmail, clubId: cid, role: targetRole || null
            });
            const d = (res && res.data) || {};
            alert('✅ Casilla de "' + _rotulo + '" liberada.\n\n' +
                  'Archivado en la categoría: ' + (d.documentosArchivados || 0) + ' documento(s), ' +
                  (d.clavesArchivadas || 0) + ' dato(s).\n' +
                  (d.cuentaBorrada
                      ? 'Era su último rol: cuenta eliminada y correo LIBERADO.'
                      : 'Su cuenta sigue activa con ' + ((d.rolesRestantes || []).length) + ' rol(es): ' +
                        ((d.rolesRestantes || []).join(', ') || '—')) +
                  '\n\nEl histórico del equipo sigue en el Panel del Club.');
            // Mismo patrón que el resto del panel: si nav-stack no ha cargado,
            // se repinta a mano CON el clubId.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(cid);
        } catch (e) {
            const msg = (e && e.message) || String(e);
            alert('⚠️ No se ha completado.\n\n' + msg + '\n\n' +
                  'Si el mensaje dice que el archivado no se pudo verificar, ' +
                  'NO se ha borrado la cuenta ni se ha perdido ningún dato: vuelve a intentarlo.');
            console.error('[caRevocarCasilla]', e);
        }
    };

    // ── ASIGNAR / MOVER DE EQUIPO (Categoría/Subcategoría) ───────────
    //
    // Esta es la palanca de MOVILIDAD: cambiar aquí la categoría de un
    // entrenador le retira la vista de su equipo anterior y le da la del
    // nuevo, con TODO el histórico que ese equipo acumule, lo firmara quien
    // lo firmara. No hay que mover ni copiar un solo informe: los informes
    // se consultan por equipo (ver cronosTeamId en js/core/utils.js).
    // `targetRole` (v560): el rol de LA FILA pulsada. Antes se daba por hecho
    // que era el rol RAÍZ del documento, y a quien tiene varios roles en el
    // mismo club (entrenador y padre, por ejemplo) eso apuntaba al equivocado.
    window.caEditUserCategory = async function(uid, email, currentCat, currentSub, targetRole) {
        let newCat = prompt('Categoría (ej: Infantil, Cadete, Senior...):', currentCat);
        if (newCat === null) return;
        let newSub = prompt('Subcategoría / Grupo (ej: A, B, Segunda...):', currentSub);
        if (newSub === null) return;

        // ════════════════════════════════════════════════════════════════
        //  v537 · UN F7 Y UN F11, NUNCA DOS DE LO MISMO
        //  Se comprueba ANTES de confirmar nada: rechazar después de que el
        //  administrador haya aceptado el movimiento sería peor.
        //  ⚠️ Se excluye su categoría ACTUAL del recuento: al mover a alguien
        //  su plaza de origen se libera, y sin esto un cambio dentro de la
        //  misma modalidad se rechazaría contra sí mismo.
        // ════════════════════════════════════════════════════════════════
        if (typeof window.cronosPuedeLlevarEquipo === 'function') {
            try {
                const { db, doc, getDoc } = await saFS();
                const _s = await getDoc(doc(db, 'users', uid));
                const _d = _s.exists() ? _s.data() : {};
                const _v = window.cronosPuedeLlevarEquipo(_d.allRoles, newCat, clubId,
                                                          { excluyeCategoria: currentCat });
                if (!_v.ok) {
                    alert('🚫 No se puede mover a ' + email + ' a "' + newCat + '".\n\n' +
                          _v.motivo + '\n\nNo se ha cambiado nada.');
                    return;
                }
            } catch (e) {
                console.warn('[v537] No se pudo validar la modalidad:', e && e.message);
            }
        }

        // Que el administrador vea la consecuencia ANTES de aceptar: esto no
        // es editar una etiqueta, es mover el acceso de una persona.
        var _antes = (currentCat || '—') + (currentSub ? ' / ' + currentSub : '');
        var _despues = (newCat || '—') + (newSub ? ' / ' + newSub : '');
        if (_antes !== _despues) {
            if (!confirm('Mover a ' + email + ' de equipo:\n\n' +
                         '   ' + _antes + '   →   ' + _despues + '\n\n' +
                         'Pasará a ver el histórico de ' + _despues + ' (informes,\n' +
                         'convocatorias y entrenamientos, los firmara quien los firmara)\n' +
                         'y dejará de ver los de ' + _antes + '.\n\n' +
                         'No se mueve ni se borra ningún dato: cada informe se queda\n' +
                         'en el equipo donde se generó.\n\n' +
                         '¿Confirmar el cambio de equipo?')) return;
        }

        try {
            const { db, doc, updateDoc, getDoc } = await saFS();
            const userRef = doc(db, 'users', uid);
            const snap = await getDoc(userRef);
            if (!snap.exists()) {
                // Si es un documento secundario (uid_role_clubId), buscar el primario
                alert('No se puede editar directamente. Prueba a refrescar o contacta con el SuperAdmin.');
                return;
            }
            const data = snap.data();

            // Actualizar en el perfil general
            let updates = {
                category: newCat,
                subcategory: newSub
            };

            // Actualizar en allRoles
            //
            // ⚠️ LA PUNTERÍA ERA DEMASIADO ANCHA. La condición era
            //        r.role === data.role || r.clubId === clubId
            //    con un O: bastaba que el rol coincidiera con el rol RAÍZ para
            //    reetiquetar entradas de OTROS clubes, y bastaba compartir club
            //    para reetiquetar OTROS roles. A quien tuviera dos roles en el
            //    mismo club (p. ej. entrenador y padre) se le cambiaba la
            //    categoría de los dos de una vez.
            //    Ahora se exige club Y rol, y sólo se tocan los roles ACTIVOS:
            //    un rol ya revocado conserva la categoría que tenía, que es su
            //    valor histórico.
            //
            // ═══════════════════════════════════════════════════════════
            //  🔴🔴 v560 · SEGUÍA SIENDO DEMASIADO ANCHA: LE FALTABA LA PLAZA
            //
            //  Exigía club Y rol… y nada más. Desde v537 un entrenador puede
            //  llevar DOS equipos en el mismo club (un F7 y un F11), así que
            //  mover UNO reescribía la categoría de LOS DOS: el Regional A se
            //  convertía en una copia del Alevín C y, en el siguiente inicio de
            //  sesión, el deduplicador de plazas de auth.js (v554) borraba la
            //  copia sobrante DE FIRESTORE. Resultado: "Regional A desapareció
            //  sola" (captura 9062), con el rastro perdido entre dos acciones
            //  que nadie relaciona.
            //
            //  🔑 Se mueve LA PLAZA que se está editando, identificada por la
            //  categoría con la que se abrió el diálogo (`currentCat`/
            //  `currentSub`), que es justo el equipo de la fila pulsada.
            //  Sin categoría de origen (registros antiguos) se mantiene el
            //  criterio anterior: es el único caso en que no hay plaza que
            //  distinguir.
            // ═══════════════════════════════════════════════════════════
            if (data.allRoles) {
                var _rolDestino = targetRole || data.role;
                var _plazaOrigen = { role: _rolDestino, clubId: clubId,
                                     category: currentCat || null,
                                     subcategory: currentSub || null };
                updates.allRoles = data.allRoles.map(function(r) {
                    var mismoClub = String(r.clubId || '') === String(clubId || '');
                    var mismoRol  = r.role === _rolDestino;
                    var activo    = r.status !== 'removed' && r.isAuthorized !== false;
                    if (!(mismoClub && mismoRol && activo)) return r;
                    if (currentCat && typeof window.cronosMismaPlaza === 'function' &&
                        !window.cronosMismaPlaza(r, _plazaOrigen)) {
                        return r;   // es el OTRO equipo de esta persona: no se toca
                    }
                    return Object.assign({}, r, { category: newCat, subcategory: newSub });
                });
            }

            await updateDoc(userRef, updates);
            // ⚠️ El cambio NO es inmediato para el interesado: su categoría se
            //    leyó al iniciar sesión (window._cronosCurrentUser), así que
            //    verá el equipo nuevo la próxima vez que entre.
            if (typeof showToast === 'function') showToast('✅ Equipo actualizado. Lo verá al volver a entrar.', 4000);
            
            // Refrescar panel tras 1 segundo (antes SIN clubId: al SuperAdmin
            // le devolvía al selector de clubes en vez de al club editado).
            setTimeout(() => { if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId); }, 1000);
        } catch(e) {
            console.error('[caEditUserCategory] Error:', e);
            alert('Error: ' + e.message);
        }
    };

    // `sinConfirmar` lo usa caRevocarCasilla, que ya ha pedido su propia
    // doble confirmación: encadenar aquí un tercer diálogo sólo consigue que
    // se acepte sin leer.
    // ⚠️ v581 · `plaza` (opcional) = { category, subcategory } de la FILA desde
    //    la que se actúa. Cuando llega, la revocación apunta a ESA casilla y no
    //    a "todos los roles con ese nombre en este club". Los llamantes que no
    //    lo pasan conservan exactamente el comportamiento anterior.
    window.caSetUserStatus = async (userId, userEmail, newStatus, cid, targetRole, sinConfirmar, plaza) => {
        // 'removed' ya NO es "dar de baja definitivamente": es revocar el
        // acceso. El texto lo dice, porque de él depende que el administrador
        // entienda qué está aceptando.
        const labels = { active:'activar', blocked:'bloquear', removed:'dar de baja (revocar el acceso de)' };
        // Si se especifica targetRole, la "baja" es de UN solo rol (no del usuario entero).
        if (sinConfirmar) {
            /* el llamante ya ha confirmado */
        } else if (newStatus === 'removed' && targetRole) {
            // ⚠️ EL AVISO TIENE QUE DECIR QUÉ CASILLA SE QUITA. Ponía el
            // identificador crudo del rol ('user') y ni mencionaba el equipo:
            // quien lo lee no puede saber si va a perder una plaza o todas, y
            // ése es exactamente el susto que se llevó el autor.
            var _rl = { user:'Entrenador', parent:'Padre/Madre/Tutor', coordinator:'Coordinador',
                        director:'Director Deportivo', club_admin:'Administrador de Club' };
            var _eq = (plaza && plaza.category)
                ? ((typeof window.cronosNombreCategoria === 'function')
                    ? window.cronosNombreCategoria(plaza.category, plaza.subcategory)
                    : (plaza.category + (plaza.subcategory ? ' ' + plaza.subcategory : '')))
                : '';
            if (!confirm('¿Dar de baja la casilla de ' + (_rl[targetRole] || targetRole) +
                         (_eq ? ' de ' + _eq : '') + ' a ' + userEmail + '?\n\n' +
                         'Se libera ESA plaza. Su cuenta y CUALQUIER OTRO rol o equipo suyo ' +
                         'en el club quedan intactos.')) return false;
        } else if (newStatus === 'removed') {
            if (!confirm('¿Dar de baja a ' + userEmail + '?\n\n' +
                         'Se le retira el acceso y se libera su plaza.\n' +
                         'Su cuenta y el histórico del equipo se conservan.')) return false;
        } else {
            if (!confirm('¿Deseas ' + (labels[newStatus] || newStatus) + ' a ' + userEmail + '?')) return;
        }

        // Función auxiliar para obtener la clave de slot del club según el rol
        // Definida aquí para estar disponible en TODOS los caminos (removed, active, blocked)
        function _slotKey(role) {
            if (role === 'director') return 'usedSlots.directors';
            if (role === 'coordinator') return 'usedSlots.coordinators';
            if (role === 'parent') return 'usedSlots.parents';
            return 'usedSlots.users';
        }

        try {
            // ═══════════════════════════════════════════════════════════
            // BAJA DEFINITIVA — Eliminar TODOS los rastros del correo
            // ═══════════════════════════════════════════════════════════
            if (newStatus === 'removed') {
                var reason = prompt('Motivo de baja para ' + userEmail + ' (se registra en el sistema):');
                if (reason === null) return false;

                // 1. Leer documento para obtener uid real
                var docSnap = await getDoc(doc(db, 'users', userId));
                var docData = docSnap.exists() ? docSnap.data() : {};
                var realUid = docData.uid || userId;
                var realEmail = docData.email || userEmail;

                // 2. Leer documento primario para obtener todos los roles
                var primarySnap = (realUid !== userId)
                    ? await getDoc(doc(db, 'users', realUid)).catch(function() { return null; })
                    : docSnap;
                var allRoles = [];
                if (primarySnap && primarySnap.exists()) {
                    allRoles = primarySnap.data().allRoles || [];
                } else if (docData.allRoles) {
                    allRoles = docData.allRoles;
                }

                // ── Determinar alcance de la REVOCACIÓN (multi-rol) ─────────
                // Si se especifica targetRole y el usuario tiene OTROS roles
                // activos, solo se revoca ESE rol; los demás siguen vivos.
                // Sin targetRole = se revoca su acceso al club entero.
                //
                // ⚠️ LA PUNTERÍA ERA MÁS ESTRECHA QUE LA DEL LISTADO. Exigía
                //    `String(r.clubId||'') === String(cid||'')`, pero el panel
                //    pinta los roles con `(r.clubId === clubId || !r.clubId)`
                //    (líneas 263/280/298): una entrada de allRoles SIN clubId
                //    —las hay, las crea auth.js con `clubId: data.clubId || null`—
                //    SE VE en el listado y NO casaba aquí. Resultado: cero roles
                //    seleccionados, cero cambios escritos... y toast de éxito.
                //    Es una de las causas del "parece que funciona y no persiste".
                var _esDeEsteClub = function(r) {
                    var rc = String(r.clubId || '');
                    return rc === String(cid || '') || rc === '';
                };
                // ══════════════════════════════════════════════════════════
                // 🔑🔑🔑 v581 · LA UNIDAD ES LA PLAZA, NO EL ROL
                //
                //  Con (club + rol) bastaba mientras cada persona tuviera una
                //  sola casilla por rol, pero desde v537 un entrenador lleva
                //  DOS equipos (un F7 y un F11): dos entradas 'user' en el
                //  MISMO club. Revocar por nombre de rol las cogía LAS DOS.
                //
                //  Y peor: el árbol del SuperAdmin pintaba filas descolocadas
                //  del mismo entrenador (v581, arriba). Pulsar "Eliminar" en
                //  una de ellas llegaba aquí con rol='user' y sin categoría, y
                //  revocaba la plaza que el entrenador tenía BIEN asignada. El
                //  reporte del autor decía exactamente eso: que gestionar un
                //  registro desincronizado no puede tocar su vínculo real.
                //
                //  ⚠️ Sólo se estrecha si el llamante DICE de qué equipo habla.
                //  Sin `plaza`, la baja sigue siendo "todo el rol en este club",
                //  que es lo que hace el botón 🗑️ Baja del panel de Club.
                //  ⚠️ Se compara NORMALIZADO (window.ctNormCat/ctNormSubcat):
                //  la misma categoría llega como 'Prebenjamín', 'prebenjamin'
                //  o 'f7_prebenjamin_a' según quién la escribiera, y comparar
                //  en crudo no casaría NINGUNA — cero roles seleccionados y
                //  una baja que no ocurre.
                // ══════════════════════════════════════════════════════════
                var _nc = (typeof window.ctNormCat === 'function')
                    ? window.ctNormCat
                    : function(x) { return String(x == null ? '' : x).trim().toLowerCase(); };
                var _ns = (typeof window.ctNormSubcat === 'function')
                    ? window.ctNormSubcat
                    : function(x) { return String(x == null ? '' : x).trim().toUpperCase(); };
                var _plazaCat = _nc((plaza && plaza.category) || '');
                var _plazaSub = _ns((plaza && plaza.subcategory) || '');
                var _acotaPorPlaza = !!(_plazaCat && _plazaSub);
                var _esEstaPlaza = function(r) {
                    if (!_acotaPorPlaza) return true;
                    return _nc(r.category != null ? r.category : r.categoryLabel) === _plazaCat &&
                           _ns(r.subcategory) === _plazaSub;
                };
                var rolesRemovidos = allRoles.filter(function(r) {
                    if (!_esDeEsteClub(r)) return false;
                    if (targetRole && r.role !== targetRole) return false;
                    if (!_esEstaPlaza(r)) return false;
                    return true;
                });
                var rolesRestantes = allRoles.filter(function(r) {
                    if (!_esDeEsteClub(r)) return true;
                    if (targetRole && r.role !== targetRole) return true;
                    if (!_esEstaPlaza(r)) return true;
                    return false;
                });
                // Sólo cuentan como "restantes" los que siguen VIVOS: un rol ya
                // revocado antes no puede sostener la cuenta abierta.
                var rolesRestantesVivos = rolesRestantes.filter(function(r) {
                    return r.status !== 'removed' && r.isAuthorized !== false;
                });
                var revocaTodosLosRoles = rolesRestantesVivos.length === 0;

                // ══════════════════════════════════════════════════════════
                // 📜 v616 · POR QUÉ AQUÍ NO HAY UN `revocaRolRaiz`
                // ══════════════════════════════════════════════════════════
                //  Hasta la v608 existía. La raíz de users/{uid} describe una
                //  plaza propia (`role` + `clubId` + su categoría), y si se
                //  revocaba ESA plaza dejando la raíz con isAuthorized:true,
                //  auth.js la RESUCITABA en el siguiente inicio de sesión: el
                //  entrenador reaparecía en su categoría al recargar. Para
                //  taparlo, revocar la plaza de la raíz desautorizaba la CUENTA
                //  ENTERA, aunque a la persona le quedaran otros roles.
                //
                //  🔑 ESO SE QUITÓ A PROPÓSITO en v610/v611, y la razón es
                //  buena: cerrarle la cuenta a un Administrador + Coordinador +
                //  Entrenador por quitarle el equipo de entrenador le dejaba sin
                //  acceso a todo y obligaba a reactivarlo a mano. Lo fija
                //  `test_multirole_revocation_isolation.js`.
                //
                //  🔑🔑 Y SE PUEDE QUITAR PORQUE EL AGUJERO SE TAPÓ EN SU
                //  ORIGEN, no aquí. Hoy `auth.js` ya no resucita nada:
                //   · un rol con status:'removed' NUNCA se reactiva al entrar
                //     (`_rolRevocado`, auth.js ~1591), y
                //   · la raíz sólo vuelve a isAuthorized:true / 'active' si de
                //     verdad queda algún rol vivo (`_quedaAlgunRolVivo`, ~1653).
                //  Es la misma protección, pero fina: distingue "esta plaza está
                //  de baja" de "esta persona está de baja".
                //
                //  ⚠️ LO QUE SE PIERDE, DICHO EN VOZ ALTA: si la plaza está sólo
                //  en la raíz y NO en allRoles, `rolesRemovidos` sale vacío y la
                //  operación se para con el aviso "no se encontró ningún rol
                //  activo" en vez de dar la baja. Se prefiere pararse y decirlo
                //  antes que desautorizar una cuenta por deducción.
                //
                //  ⚠️ El caso de `allRoles` VACÍO sigue cubierto sin código
                //  extra: sin array no hay roles restantes vivos, así que
                //  `revocaTodosLosRoles` ya sale true y la baja recae sobre la
                //  raíz igual que antes. (Medido, no supuesto.)
                //
                //  🔴 NO REINTRODUCIR `if (revocaTodosLosRoles || revocaRolRaiz)`.
                //  Entre v609 y v615 la variable se quedó calculándose sin que
                //  nadie la leyera, con toda su lógica intacta, y parecía un
                //  descuido: yo mismo la "restauré" en la v616 y puse en rojo el
                //  guard de multi-rol. Dos guards decían cosas opuestas porque
                //  el viejo no se actualizó cuando el comportamiento cambió.
                // ══════════════════════════════════════════════════════════

                // ══════════════════════════════════════════════════════════
                // 🔑 allRoles: SE MARCA, NO SE QUITA
                // ══════════════════════════════════════════════════════════
                // Antes el rol revocado se BORRABA del array. Se conserva la
                // entrada con status:'removed' porque:
                //
                //  1. Es la convención que el backend YA entiende: el trigger
                //     autoSetClaimsOnApproval (functions/index.js) elige el
                //     clubId saltándose los roles con
                //     `isAuthorized === false || status === 'removed'`. Marcar
                //     produce el mismo efecto que borrar de cara a los claims,
                //     y además deja rastro.
                //  2. Readmitir a alguien es volver a poner status:'active',
                //     sin reconstruir un rol desde cero.
                //  3. El histórico de quién entrenó qué categoría y cuándo
                //     queda EN el documento, no solo en deletion_requests.
                var marcaRevocado = function(r) {
                    return Object.assign({}, r, {
                        status: 'removed',
                        isAuthorized: false,
                        // ⚠️ `authorized` (sin el "is") es un alias heredado que
                        //    el listado TAMBIÉN acepta como válido:
                        //    `r.isAuthorized === true || r.authorized === true`.
                        //    Marcar solo isAuthorized dejaba visible cualquier
                        //    entrada antigua que llevara el alias a true.
                        authorized: false,
                        removedAt: new Date().toISOString(),
                        removedBy: me.uid,
                        removedReason: (reason || '').trim() || 'Sin motivo indicado'
                    });
                };
                // El array COMPLETO que se va a guardar: los revocados marcados
                // y los demás intactos. Se respeta el orden original.
                // ⚠️ v581 · SE MARCAN LAS ENTRADAS SELECCIONADAS, NO LAS QUE SE
                //    LE PAREZCAN. Esto casaba por (rol + club), así que aunque
                //    `rolesRemovidos` acotase bien la plaza, el marcado volvía a
                //    ensancharse y tumbaba TAMBIÉN el otro equipo del mismo
                //    entrenador. `Array.filter` conserva las referencias del
                //    array original, así que la identidad es exacta y no hay que
                //    reconstruir ningún criterio de igualdad.
                var allRolesTrasRevocar = allRoles.map(function(r) {
                    return (rolesRemovidos.indexOf(r) >= 0) ? marcaRevocado(r) : r;
                });

                // ══════════════════════════════════════════════════════════
                // REVOCACIÓN — un solo camino, sin borrar NADA
                // ══════════════════════════════════════════════════════════
                // Antes había dos caminos: "quitar un rol" (conservador) y
                // "borrado total", que eliminaba los documentos de users, los
                // cronos_player_links y la cuenta de Firebase Auth.
                //
                // 🔑 EL BORRADO TOTAL SE RETIRA DE AQUÍ. El dato del club
                //    (informes, convocatorias, entrenamientos) pertenece al
                //    EQUIPO, no a la cuenta que lo generó, y ya vivía en
                //    colecciones propias indexadas por clubId — nunca se
                //    borraba en cascada. Lo que sí destruía el borrado total
                //    era el acceso al histórico:
                //
                //    ⚠️⚠️ users/{uid}/cronos_data/main es una SUBCOLECCIÓN.
                //    Firestore NO borra subcolecciones al borrar el documento
                //    padre: la plantilla quedaba viva pero HUÉRFANA, y su regla
                //    (`request.auth.uid == userId`, sin rama de SuperAdmin) la
                //    dejaba ilegible para todo el mundo, incluido el SA. Al
                //    re-registrarse, el correo estrena UID y apunta a un
                //    documento vacío. Se perdía sin dar un solo error.
                //
                //    ⚠️ Y si deleteAuthUser fallaba, los datos ya estaban
                //    borrados pero el correo seguía ocupado en Auth: el
                //    re-registro caía en 'auth/email-already-in-use' y exigía
                //    la contraseña ANTIGUA. Quien no la recordara se quedaba
                //    fuera para siempre.
                //
                // Ahora la baja es exactamente lo que dice ser: se le retira el
                // acceso. La cuenta, su UID y todo lo que firmó siguen en pie,
                // así que el entrenador que herede la categoría encuentra el
                // histórico intacto y readmitir a alguien es reactivar un rol.

                // 1. Liberar las plazas del club de CADA rol revocado. La
                //    plaza sí se libera: la persona deja de ocuparla.
                for (var rIdx = 0; rIdx < rolesRemovidos.length; rIdx++) {
                    var cidRol = rolesRemovidos[rIdx].clubId || cid;
                    if (!cidRol) continue;
                    try {
                        // ⚠️ v553 · Ya no se decrementa `usedSlots`: el recuento
                        //    se calcula desde `allRoles`. Este decremento a mano,
                        //    combinado con los incrementos, es lo que dejó el
                        //    contador de CD DÍA en **-1**.
                        void rolesRemovidos[rIdx];
                    } catch (_) {}
                }

                // 2. Marcar los roles revocados en el documento PRIMARIO.
                //
                // ⚠️ SOLO SE ESCRIBEN CAMPOS DE isMembershipDecision().
                //    Las reglas acotan al administrador de club con un
                //    hasOnly([...]) (firestore.rules): 'isAuthorized',
                //    'status', 'allRoles', 'updatedAt' y poco más. Colar aquí
                //    un campo de raíz fuera de esa lista —'removedAt' suelto,
                //    por ejemplo— NO se ignora: hace fallar la actualización
                //    ENTERA con "Missing or insufficient permissions". El
                //    detalle de la baja va DENTRO de allRoles[] (que es un
                //    campo permitido) y en deletion_requests.
                // ⚠️ SI NO SE HA SELECCIONADO NADA, NO SE ANUNCIA UNA BAJA.
                //    Cuando el filtro no casaba ningún rol, esto seguía adelante,
                //    escribía un allRoles idéntico al que ya había y mostraba el
                //    toast de éxito: el administrador daba por hecha una baja que
                //    no se había producido. Ahora se dice, y no se toca nada.
                if (rolesRemovidos.length === 0 && !revocaTodosLosRoles) {
                    showToast('⚠️ No se encontró ningún rol activo de ' + userEmail +
                              ' en este club' + (targetRole ? ' con el rol "' + targetRole + '"' : '') +
                              (_acotaPorPlaza ? ' en ' + _plazaCat + ' ' + _plazaSub : '') +
                              '. No se ha cambiado nada.', 6000);
                    return false;
                }

                var revocaRaiz = {
                    allRoles: allRolesTrasRevocar,
                    updatedAt: new Date().toISOString()
                };
                if (revocaTodosLosRoles) {
                    // Se cierra la puerta únicamente si no le queda ningún rol activo en el club.
                    // Si conserva otros roles (ej: Administrador o Coordinador), la raíz permanece activa.
                    revocaRaiz.isAuthorized = false;
                    revocaRaiz.status = 'removed';
                }
                var falloRevocacion = null;
                try {
                    await updateDoc(doc(db, 'users', realUid), revocaRaiz);
                } catch (revErr) {
                    falloRevocacion = revErr;
                }

                // 3. Marcar también los documentos SECUNDARIOS (uid_rol_club).
                //    Antes se borraban; ahora se desautorizan, que es lo que
                //    corta el acceso sin perder el rastro del rol.
                for (var rIdx2 = 0; rIdx2 < rolesRemovidos.length; rIdx2++) {
                    var secOne = realUid + '_' + rolesRemovidos[rIdx2].role +
                                 '_' + (rolesRemovidos[rIdx2].clubId || cid || 'global');
                    if (secOne === realUid) continue;
                    try {
                        await updateDoc(doc(db, 'users', secOne), {
                            isAuthorized: false,
                            status: 'removed',
                            updatedAt: new Date().toISOString()
                        });
                    } catch (_) { /* puede no existir: no es un error */ }
                }

                // 4. Los cronos_player_links NO se tocan.
                //    Antes se borraban al dar de baja a un padre. Ese enlace es
                //    la relación padre↔jugador del CLUB, no una pertenencia de
                //    la cuenta: borrarlo obligaba a reconstruir a mano los
                //    contactos del equipo. Con isAuthorized:false el padre ya
                //    no puede leer nada (isLinkClubMember exige autorización),
                //    así que conservarlos no abre ningún acceso.

                // 5. Dejar constancia. Aquí sí caben los campos libres: la
                //    colección deletion_requests admite `create` de cualquier
                //    autenticado y no la acota isMembershipDecision().
                await setDoc(doc(db, 'deletion_requests', realUid + '_revoke_' + Date.now()), {
                    userId: realUid, userEmail: realEmail, clubId: cid,
                    requestedBy: me.uid, requestedByEmail: me.email,
                    reason: (reason || '').trim() || 'Sin motivo indicado',
                    action: 'revoke',
                    rolesRevoked: rolesRemovidos.map(function(r) { return r.role; }),
                    remainingRoles: rolesRestantes.map(function(r) { return r.role; }),
                    accountDeleted: false,
                    dataDeleted: false,
                    status: 'completed',
                    resolvedAt: new Date().toISOString(),
                    createdAt: new Date().toISOString()
                }).catch(function() {});

                // ⚠️ El fallo se REPORTA. Antes los updateDoc iban en
                //    try/catch mudos y un error de permisos dejaba al usuario
                //    con el acceso intacto mientras el panel cantaba éxito.
                if (falloRevocacion) {
                    showToast('❌ No se pudo revocar el acceso de ' + userEmail +
                              ': ' + (falloRevocacion.message || falloRevocacion), 6000);
                    return false;
                }

                if (revocaTodosLosRoles) {
                    showToast('🔒 Acceso de ' + userEmail + ' revocado. Sus datos y el ' +
                              'histórico del equipo se conservan íntegros.', 4500);
                } else {
                    showToast('➖ Rol/Roles de ' + userEmail + ' revocados. Conserva sus otros roles.', 4000);
                }
                if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
                // ⚠️ v581 · DEVUELVE SI LA REVOCACIÓN OCURRIÓ DE VERDAD. El
                //    borrado del árbol (cronosEliminarUsuarioSeguro) llamaba y
                //    daba por hecho que la plaza quedaba libre; si aquí no se
                //    tocaba nada, seguía adelante y archivaba igual. Los
                //    caminos que no escriben devuelven `false`.
                return true;

                // ── (retirado) CAMINO B: borrado TOTAL del usuario ──────────
                // Aquí vivía el borrado de los documentos de users, de los
                // cronos_player_links y de la cuenta de Firebase Auth. Se
                // retira entero: la revocación de arriba ya cumple la baja y
                // no destruye el acceso al histórico. Ver el bloque
                // "REVOCACIÓN — un solo camino, sin borrar NADA".
                //
                // El derecho de supresión (RGPD) NO desaparece: sigue
                // atendiéndose desde el Panel del SuperAdmin, que es donde
                // debe estar una operación irreversible sobre datos ajenos.
            }

            // ═══════════════════════════════════════════════════════════
            // ACTIVAR / BLOQUEAR (sin cambios)
            // ═══════════════════════════════════════════════════════════
            var isActive  = (newStatus === 'active');
            var isBlocked = (newStatus === 'blocked');

            await updateDoc(doc(db,'users',userId), {
                isAuthorized: isActive,
                status: newStatus
            });
            if (isActive) {
                var actUpd = {
                    authorizedAt: new Date().toISOString(),
                    authorizedBy: me.uid
                };
                await updateDoc(doc(db,'users',userId), actUpd);
            }
            if (isBlocked) {
                var blkUpd = {
                    blockedAt: new Date().toISOString(),
                    blockedBy: me.uid
                };
                await updateDoc(doc(db,'users',userId), blkUpd);
            }

            // Actualizar slots del club
            var userSnap = await getDoc(doc(db,'users',userId)).catch(function() { return null; });
            var role = (userSnap && userSnap.data()) ? (userSnap.data().role || 'user') : 'user';
            // ⚠️ v553 · Sin escritura de `usedSlots`: el recuento se calcula
            //    desde `allRoles` (cronosPlazasOcupadas). Se conserva la lectura
            //    del rol porque la usan los avisos de más abajo.
            void role;
            if (isBlocked) {
                var blkSlot = {}; blkSlot[key] = Math.max(0, (si.used || 1) - 1);
                await updateDoc(doc(db,'clubs',cid), blkSlot);
            }

            // ── PROBLEMA 2: propagar custom claim clubId al activar ──────────
            // El entrenador (rol 'user') y demás miembros tienen clubId en su
            // documento Firestore, pero su token JWT no lo lleva, así que las
            // reglas basadas en sameClub()/sameClubAsDoc() (informes, vínculos,
            // hilos de staff, partidos en vivo) fallaban con permission-denied.
            // Al activarlo, el club_admin invoca setCustomClaims para grabar
            // {role, clubId} en el token. La Cloud Function valida que el admin
            // solo afecte a miembros NO privilegiados de SU propio club.
            // El token del usuario activado se refrescará en su próximo login o
            // ciclo de refresco (claimsSetAt fuerza la regeneración del ID token).
            if (isActive && fa && fa.functions && cid) {
                try {
                    var setClaimsFn = httpsCallable(fa.functions, 'setCustomClaims');
                    await setClaimsFn({ uid: userId, role: role, clubId: cid });
                } catch (claimErr) {
                    // No bloquea la activación: las reglas tienen fallback
                    // userDocClubId() que lee users/{uid}.clubId aunque el claim
                    // no llegue a propagarse.
                    console.warn('[caSetUserStatus] setCustomClaims falló (continúa con fallback de reglas):',
                        claimErr && claimErr.message);
                }
            }

            showToast(isActive ? '\u2705 Usuario activado' : '\uD83D\uDD12 Usuario bloqueado', 3000);
            // Refresco tras la acción. Antes iba SIN clubId, así que al
            // SuperAdmin le devolvía al selector de clubes.
            if (typeof navReload === 'function') navReload(); else openClubAdminPanel(clubId);
        } catch(e) {
            showToast('\u274C Error: ' + e.message, 4000);
            console.error(e);
        }
    };

    // Mantener por compatibilidad (se usaba desde código externo)
    window.caRequestDeletion = (userId, userEmail, cid) =>
        window.caSetUserStatus(userId, userEmail, 'removed', cid);

    // ── Solicitar ampliación de cuota al SuperAdmin ──────────────────
    window.caRequestQuota = async (cid, role, roleLabel, slotKey) => {
        const current = slotOf(role);
        const extra   = prompt(
            `Solicitar ampliación de cuota para ${roleLabel}\n` +
            `Slots actuales: ${current.unlimited ? '∞' : current.max}\n\n` +
            `¿Cuántos slots adicionales necesitas?`
        );
        if (!extra || isNaN(parseInt(extra))) return;
        const requestedExtra = parseInt(extra);
        await setDoc(doc(db,'platform_requests',`quota_${cid}_${role}_${Date.now()}`), {
            type:        'quota_increase',
            clubId:      cid,
            clubName:    club.name || '',
            role,
            roleLabel,
            slotKey,
            currentMax:  current.max,
            currentUsed: current.used,
            requestedExtra,
            requestedBy:      me.uid,
            requestedByEmail: me.email,
            status:      'unread',
            createdAt:   new Date().toISOString(),
        });
        showToast(`✅ Solicitud enviada al SuperAdmin: +${requestedExtra} slots para ${roleLabel}.`, 5000);
    };

    // ════════════════════════════════════════════════════════════════
    //  🔴🔴🔴 v598 · AQUÍ ESTABA `caNotifySuperAdmin` — "📡 TRANSMITIR AL
    //  SUPERADMIN" — Y ERA UN BOTÓN FANTASMA
    //
    //  El autor preguntó (2026-08-21) para qué servía, sospechando que fuese
    //  REDUNDANTE con la mensajería interna. La medición dio algo peor: no
    //  servía para nada en absoluto.
    //
    //  🔑 LA PRUEBA, QUE ES DE DOS LÍNEAS. Escribía en `platform_requests` un
    //  documento con `type:'sync_request'` y `status:'unread'`. Y el SuperAdmin
    //  lee de esa colección EXACTAMENTE dos consultas
    //  (`saPendingItems`, js/admin/superadmin/requests-tab.js:75-76):
    //        where('status','==','pending_sa')
    //        where('type','==','quota_increase') AND where('status','==','unread')
    //  `sync_request`/`unread` no casa con ninguna de las dos. Censo sobre todo
    //  el proyecto: la cadena `sync_request` aparecía ÚNICAMENTE en la línea
    //  que la escribía. Nadie la leyó jamás.
    //
    //  🔑 LO QUE LO HACÍA DAÑINO NO ERA GASTAR UNA ESCRITURA, ERA MENTIR: el
    //  administrador pulsaba, leía «✅ Estado del club transmitido al
    //  SuperAdmin» y se quedaba esperando una respuesta que no podía llegar,
    //  porque al otro lado no aparecía nada. Un botón que no hace nada y lo
    //  dice es un botón roto; uno que no hace nada y CONFIRMA que lo ha hecho
    //  es una trampa. Misma familia que la tabla de permisos decorativa de la
    //  v597 y que su gemelo `indNotifySuperAdmin` del panel Individual, que se
    //  retira en el mismo paso.
    //
    //  Lo que sí funciona y se queda: 💬 Mensajes (`openClubAdminMessaging`),
    //  que es mensajería interna de verdad con el SuperAdmin y con el Director.
    //
    //  ⚠️ Los `sync_request` ya escritos NO se borran: no los lee nadie, y no
    //  se tocan datos de producción para retirar una interfaz (mismo criterio
    //  que con los `permissions` de la v597).
    // ════════════════════════════════════════════════════════════════
}
window.openClubAdminPanel = openClubAdminPanel;

// ════════════════════════════════════════════════════════════════════
//  SUCESIÓN DE ADMIN DE CLUB
// ════════════════════════════════════════════════════════════════════
window.caShowSuccession = async function caShowSuccession(clubId) {
    const me = window._cronosCurrentUser;
    try {
        const { db, doc, getDoc, collection, getDocs, query, where, setDoc, serverTimestamp } = await saFS();
        const clubSnap = await getDoc(doc(db, 'clubs', clubId));
        if (!clubSnap.exists()) { showToast('⚠️ Club no encontrado', 3000); return; }
        const club = clubSnap.data();

        // Cargar miembros activos del club (excluir al admin actual y superadmins)
        const usersSnap = await getDocs(query(collection(db, 'users'), where('clubId', '==', clubId)));
        const members = [];
        usersSnap.forEach(d => {
            const u = { id: d.id, ...d.data() };
            if (u.status === 'removed' || u.status === 'blocked') return;
            if (['superadmin', 'admin'].includes(u.role)) return;
            if (u.role === 'club_admin' && u.email === me.email) return;
            if (u.isAuthorized) members.push(u);
        });

        // Verificar si ya hay una sucesión pendiente
        const existingSnap = await getDocs(query(
            collection(db, 'succession_requests'),
            where('clubId', '==', clubId),
            where('status', '==', 'pending_sa')
        )).catch(() => ({ empty: true }));
        if (!existingSnap.empty) {
            showToast('⚠️ Ya hay una solicitud de sucesión pendiente para este club.', 5000);
            return;
        }

        // Construir opciones del selector
        let memberOptions = '<option value="">-- Selecciona un miembro --</option>';
        members.forEach(m => {
            const name = m.displayName || m.firstName || m.email;
            const roleMeta = (window.ROLE_META || {})[m.role] || { icon: '👤', label: m.role };
            memberOptions += `<option value="${m.id}">${roleMeta.icon} ${name} (${m.email}) - ${roleMeta.label}</option>`;
        });

        // Modal de sucesión
        const overlay = document.createElement('div');
        overlay.id = 'succession-modal';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';
        overlay.innerHTML = `
        <div style="background:#161b22;border:1px solid rgba(210,168,255,0.3);border-radius:16px;
                    padding:1.5rem;width:min(96vw,500px);max-height:90vh;overflow-y:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem;">
                <div>
                    <div style="font-weight:700;font-size:1.05rem;color:white;">🔄 Ceder Administración</div>
                    <div style="font-size:0.75rem;color:#8b949e;margin-top:4px;">Club: ${typeof escapeHtml === 'function' ? escapeHtml(club.name) : club.name}</div>
                </div>
                <button id="succession-close" style="background:none;border:none;color:#8b949e;font-size:1.4rem;cursor:pointer;">✕</button>
            </div>

            <p style="font-size:0.8rem;color:#8b949e;margin:0 0 1.2rem;padding:0.6rem;background:rgba(210,168,255,0.06);border:1px solid rgba(210,168,255,0.15);border-radius:8px;">
                ⚠️ Al completarse la sucesión, tu cuenta de administrador será eliminada
                y el nuevo admin tomará el control del club. Los usuarios del club no se verán afectados.
                <strong>Requiere aprobación del SuperAdmin.</strong>
            </p>

            <!-- Selector de tipo -->
            <div style="display:flex;gap:0.6rem;margin-bottom:1rem;">
                <button id="succ-tab-existing" onclick="document.getElementById('succ-existing').style.display='block';document.getElementById('succ-new').style.display='none';this.style.borderColor='rgba(210,168,255,0.5)';this.style.color='#d2a8ff';document.getElementById('succ-tab-new').style.borderColor='rgba(255,255,255,0.1)';document.getElementById('succ-tab-new').style.color='#8b949e';"
                    style="flex:1;padding:0.6rem;background:rgba(255,255,255,0.04);border:2px solid rgba(210,168,255,0.5);border-radius:8px;color:#d2a8ff;font-size:0.82rem;font-weight:600;cursor:pointer;">
                    👥 Miembro existente
                </button>
                <button id="succ-tab-new" onclick="document.getElementById('succ-new').style.display='block';document.getElementById('succ-existing').style.display='none';this.style.borderColor='rgba(210,168,255,0.5)';this.style.color='#d2a8ff';document.getElementById('succ-tab-existing').style.borderColor='rgba(255,255,255,0.1)';document.getElementById('succ-tab-existing').style.color='#8b949e';"
                    style="flex:1;padding:0.6rem;background:rgba(255,255,255,0.04);border:2px solid rgba(255,255,255,0.1);border-radius:8px;color:#8b949e;font-size:0.82rem;font-weight:600;cursor:pointer;">
                    ✉️ Persona nueva
                </button>
            </div>

            <!-- Camino A: Miembro existente -->
            <div id="succ-existing" style="display:block;">
                <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Selecciona al nuevo administrador</label>
                <select id="succ-member"
                    style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;">
                    ${memberOptions}
                </select>
                ${members.length === 0 ? '<p style="font-size:0.75rem;color:#ffa500;margin-top:0.5rem;">No hay miembros activos. Usa la opción "Persona nueva".</p>' : ''}
            </div>

            <!-- Camino B: Persona nueva -->
            <div id="succ-new" style="display:none;">
                <div style="margin-bottom:0.8rem;">
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Email del nuevo administrador *</label>
                    <input id="succ-email" type="email" placeholder="nuevo.admin@email.com"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;">
                </div>
                <div>
                    <label style="font-size:0.78rem;color:#8b949e;display:block;margin-bottom:4px;">Nombre del nuevo administrador</label>
                    <input id="succ-name" type="text" placeholder="Nombre completo"
                        style="width:100%;padding:0.7rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;">
                </div>
            </div>

            <!-- Botón confirmar -->
            <button id="succ-confirm"
                style="margin-top:1.2rem;width:100%;padding:0.8rem;background:rgba(210,168,255,0.15);border:1px solid rgba(210,168,255,0.4);border-radius:8px;color:#d2a8ff;font-weight:700;font-size:0.9rem;cursor:pointer;">
                📤 Enviar solicitud al SuperAdmin
            </button>
        </div>`;

        document.body.appendChild(overlay);

        // Cerrar modal
        document.getElementById('succession-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

        // Confirmar sucesión
        document.getElementById('succ-confirm').addEventListener('click', async () => {
            const isExistingTab = document.getElementById('succ-existing').style.display !== 'none';

            let successorType, successorUid, successorEmail, successorName;

            if (isExistingTab) {
                successorUid = document.getElementById('succ-member').value;
                if (!successorUid) { showToast('⚠️ Selecciona un miembro del club', 3000); return; }
                const chosen = members.find(m => m.id === successorUid);
                successorEmail = chosen?.email || '';
                successorName = chosen?.displayName || chosen?.firstName || successorEmail;
                successorType = 'existing';
            } else {
                successorEmail = document.getElementById('succ-email').value.trim();
                successorName = document.getElementById('succ-name').value.trim();
                if (!successorEmail) { showToast('⚠️ Introduce el email del nuevo administrador', 3000); return; }
                successorType = 'new';
                successorUid = null;
            }

            if (!confirm('¿Confirmas la solicitud de sucesión?\n\nNuevo admin: ' + successorEmail + '\n\nRequiere aprobación del SuperAdmin.')) return;

            try {
                showSpinner('Enviando solicitud...');
                const reqId = 'succession_' + clubId + '_' + Date.now().toString(36);
                await setDoc(doc(db, 'succession_requests', reqId), {
                    clubId:              clubId,
                    clubName:            club.name || '',
                    outgoingAdminUid:    me.uid,
                    outgoingAdminEmail:  me.email,
                    successorType:       successorType,
                    successorUid:        successorUid || null,
                    successorEmail:      successorEmail,
                    successorName:       successorName || null,
                    status:              'pending_sa',
                    createdAt:           serverTimestamp(),
                });
                hideSpinner();
                overlay.remove();
                showToast('✅ Solicitud enviada al SuperAdmin. Tu acceso se mantiene hasta que confirme.', 6000);
            } catch (e) {
                hideSpinner();
                showToast('❌ Error: ' + e.message, 5000);
                console.error('[caShowSuccession]', e);
            }
        });
    } catch (e) {
        showToast('❌ Error: ' + e.message, 5000);
        console.error('[caShowSuccession]', e);
    }
};

// ════════════════════════════════════════════════════════════════════
//  🗑️ v598 · AQUÍ VIVÍA `caToggleFeature` — RETIRADA
//
//  Era el escritor de `clubs/{id}.features.sendIndividualReports` desde el
//  panel del Administrador del Club, y su único llamante era el interruptor
//  «📊 Enviar informes individualizados a padres» de la sección ⚙️
//  Configuración, retirada hoy por encargo del autor.
//
//  🔑 EL DUEÑO DE ESA LLAVE ES EL DIRECTOR, y ya lo era: `director-config.js`
//  la decide **por categoría** y escribe el agregado en el mismo campo. Este
//  mando era global y pisaba aquel de una pulsación. Al retirarlo no se pierde
//  la función: queda con un solo dueño.
//
//  ⚠️ NO CONFUNDIR CON EL CAMPO: `features.sendIndividualReports` sigue vivo,
//  se sigue escribiendo (desde el panel del Director) y se sigue leyendo
//  (utils.js:1520, director-config.js:73). Lo que desaparece es este atajo.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
//  🗑 v597 · AQUÍ VIVÍA caSetPermission — RETIRADA
//
//  Escribía `users/{uid}.permissions[clave] = true|false` desde las seis
//  casillas por persona del bloque "Contactos del Club — Permisos". Censo del
//  2026-08-21: las seis claves NO LAS LEÍA NADIE en todo el proyecto, así que
//  esta función guardaba en la base un dato que no cambiaba absolutamente
//  nada. Retirada junto con las casillas (ver la nota larga de _secContactos).
//
//  ⚠️ Su único invocador estaba en el marcado que se ha quitado. Si alguna vez
//  hicieran falta permisos por persona, el sitio ya NO es éste: hoy el reparto
//  lo deciden el ROL de la plaza y los EXTRAS del club (v596), y meter una
//  tercera fuente de verdad volvería a dejarlas divergiendo.
//
//  Los datos ya escritos en los documentos NO se han borrado (decisión del
//  autor): no los lee nadie y no hay motivo para tocar producción.
// ════════════════════════════════════════════════════════════════════

// ── Verificar acceso al club: definición única en js/core/app-init.js ─
//    (esta copia se eliminó: eclipsaba a la versión completa que sí
//     carga cl.timerThresholds para el semáforo de getTimerColor).
