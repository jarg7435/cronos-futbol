// ══════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — PASES DE REGALO  (v672)
//
//  Encargo del autor: desde Secretaría, el SuperAdministrador genera un
//  pase de regalo atado a un ente individual, se lo pasa al Usuario 1,
//  éste se lo reenvía a quien quiera, y el Usuario 2 queda vinculado a esa
//  plaza al registrarse. Con un panel que enseñe el estado de cada pase.
//
//  ══════════════════════════════════════════════════════════════════
//  🔑🔑 UN ENTE NUEVO POR CADA PASE, Y NO ES UN CAPRICHO
//
//  El panel del ente individual consulta `users where clubId == entityId`
//  (js/admin/individual/panel.js): TODO el que cuelga de un ente lo ve
//  quien lo administra. Y el regalado entra como "Entrenador Administrador
//  Individual", que ES el administrador de su ente.
//
//  O sea: si todos los regalos cayeran en un ente común, dos personas que
//  no se conocen se administrarían mutuamente y verían sus equipos y sus
//  jugadores. Eso es exactamente lo que el aislamiento por entidad de
//  v583-v585 existe para impedir. Un ente por pase es lo que lo respeta.
//
//  ⚠️ POR ESO EL ENTE SE CREA AL GENERAR EL PASE Y NO AL CANJEARLO:
//  `clubs` sólo admite `create` del SuperAdmin (firestore.rules). Quien
//  canjea no puede fundarlo. El precio es que un pase que nadie use deja
//  un ente vacío — por eso el panel los marca y se pueden borrar.
//  ══════════════════════════════════════════════════════════════════
//
//  🔑 NO SE TOCA EL ALTA. Un `invites/{token}` con `role:'individual'` y el
//  nombre del ente ya hace que invite-prefill fije el rol y seleccione la
//  entidad, y los deje bloqueados. El circuito de regalo es la maquinaria
//  de invitaciones de siempre, con un ente detrás.
//
//  🔑 NI LAS REGLAS. `invites` ya permite `list` al SuperAdmin (el panel),
//  `create` con campos libres (los del regalo) y `update` sólo de
//  `usedAt`/`usedBy` por quien lo canjea. Nada que desplegar.
//
//  Test: scripts/test_gift_passes.js
// ══════════════════════════════════════════════════════════════════════

// ── Estado de un pase, derivado de los datos ───────────────────────────
//  🔑 SE DERIVA, NO SE GUARDA. Un campo `estado` escrito a mano se queda
//  desfasado en cuanto alguien aprueba a un usuario por otro camino (y hay
//  tres: clubs-tab, extras y el panel del ente). Aquí se calcula de lo que
//  ya es verdad: el pase, su caducidad y el usuario que lo canjeó.
window.cronosEstadoPase = function (pase, usuario) {
    const p = pase || {};
    if (p.usedAt) {
        const u = usuario || null;
        // "Aprobada" = el SuperAdmin ya le dio acceso. Se mira lo mismo que
        // mira el resto del panel: isAuthorized en la raíz o en su plaza.
        const aprobado = !!u && (
            u.isAuthorized === true ||
            (Array.isArray(u.allRoles) && u.allRoles.some(r => r && r.isAuthorized === true))
        );
        return aprobado ? 'aprobada' : 'registrada';
    }
    // Sin canjear: puede haber caducado.
    const exp = p.expiresAt;
    let ms = null;
    if (exp && typeof exp.toMillis === 'function') ms = exp.toMillis();
    else if (exp && typeof exp.seconds === 'number') ms = exp.seconds * 1000;
    else if (typeof exp === 'string') { const d = Date.parse(exp); if (!isNaN(d)) ms = d; }
    if (ms !== null && ms < Date.now()) return 'caducada';
    return 'pendiente';
};

window.CRONOS_PASE_META = {
    pendiente:  { etiqueta: 'Pendiente de canje', icono: '⏳', color: '#f0883e' },
    registrada: { etiqueta: 'Registrada',         icono: '📝', color: '#58a6ff' },
    aprobada:   { etiqueta: 'Aprobada',           icono: '✅', color: '#3fb950' },
    caducada:   { etiqueta: 'Caducada',           icono: '⌛', color: '#7d8590' },
};

// ── ¿Puede esta persona repartir regalos? ──────────────────────────────
//  ⚠️ SÓLO EL SUPERADMINISTRADOR. `saSecretary` es COMPARTIDA: el Director
//  Deportivo abre la misma pantalla con su catálogo recortado. Un pase de
//  regalo funda un ente y regala la app entera, así que no es cosa suya.
//  Falla cerrado: sin usuario o sin rol reconocible, NO.
window.cronosPuedeRegalar = function (usuario) {
    const u = usuario || window._cronosCurrentUser;
    if (!u) return false;
    return u.role === 'superadmin' || u.role === 'admin';
};

(function () {
    'use strict';

    const _fs    = () => (typeof window.saFS === 'function') ? window.saFS() : null;
    const _toast = (m, ms) => {
        if (typeof window._saToast === 'function') window._saToast(m, ms || 4000);
        else if (typeof window.showToast === 'function') window.showToast(m, ms || 4000);
    };
    const _esc = (s) => (typeof window.escapeHtml === 'function')
        ? window.escapeHtml(String(s == null ? '' : s))
        : String(s == null ? '' : s).replace(/[&<>"]/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // ── El bloque que se inyecta DENTRO de Secretaría ──────────────────
    //  Devuelve '' para quien no pueda regalar: así `saSecretary` lo
    //  interpola sin condicionales y el Director no ve nada.
    window.cronosBloqueRegalos = function () {
        if (!window.cronosPuedeRegalar()) return '';
        return `
        <div style="margin-top:1.4rem;padding-top:1.2rem;border-top:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;
                        flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;">
                <div>
                    <h3 style="margin:0;font-size:0.95rem;color:white;">🎁 Pases de regalo</h3>
                    <p style="font-size:0.75rem;color:#8b949e;margin:0.2rem 0 0;">
                        Genera un enlace de regalo con su propia entidad. Quien lo canjee
                        entra como Entrenador Administrador Individual.
                    </p>
                </div>
                <button onclick="window.saAbrirPasesRegalo()" class="sa-btn"
                    style="background:rgba(210,168,255,0.12);border:1px solid rgba(210,168,255,0.45);
                           color:#d2a8ff;padding:0.45rem 0.9rem;border-radius:8px;
                           font-weight:700;font-size:0.78rem;cursor:pointer;white-space:nowrap;">
                    🎁 Gestionar pases
                </button>
            </div>
        </div>`;
    };

    // ── Pantalla de pases ──────────────────────────────────────────────
    window.saAbrirPasesRegalo = async function () {
        if (!window.cronosPuedeRegalar()) {
            _toast('⛔ Los pases de regalo son exclusivos del SuperAdministrador', 5000);
            return;
        }
        const body = document.getElementById('sa-body');
        if (!body) return;

        body.innerHTML = `
        <div style="max-width:820px;">
            <div style="display:flex;justify-content:space-between;align-items:center;
                        flex-wrap:wrap;gap:0.5rem;margin-bottom:0.4rem;">
                <h3 style="margin:0;font-size:1rem;color:white;">🎁 Pases de regalo</h3>
                <button onclick="window.saSecretary()" class="sa-btn"
                    style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);
                           color:#8b949e;padding:0.4rem 0.85rem;border-radius:8px;
                           font-size:0.75rem;font-weight:700;cursor:pointer;">← Secretaría</button>
            </div>
            <p style="font-size:0.78rem;color:#8b949e;margin:0 0 1.1rem;line-height:1.5;">
                Cada pase crea <strong style="color:#d2a8ff;">su propia entidad individual</strong>,
                para que quien lo reciba no comparta panel con los demás regalados.
                Tú generas el enlace y se lo das a quien va a regalarlo; esa persona
                se lo reenvía a quien quiera.
            </p>

            <div style="background:rgba(210,168,255,0.05);border:1px solid rgba(210,168,255,0.2);
                        border-radius:10px;padding:1rem;margin-bottom:1.2rem;">
                <div style="font-size:0.78rem;font-weight:700;color:#d2a8ff;margin-bottom:0.7rem;">
                    Generar un pase nuevo
                </div>
                <div style="display:flex;flex-direction:column;gap:0.7rem;">
                    <div>
                        <label style="font-size:0.75rem;color:#8b949e;display:block;margin-bottom:4px;">
                            Nombre de la entidad *</label>
                        <input id="gp-nombre" type="text" placeholder="Ej: Regalo · Escuela de Marcos"
                            style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.88rem;box-sizing:border-box;">
                        <span style="font-size:0.68rem;color:#8b949e;margin-top:3px;display:block;">
                            Es el nombre que verá quien lo canjee al elegir su entidad. Conviene que lo reconozca.
                        </span>
                    </div>
                    <div>
                        <label style="font-size:0.75rem;color:#8b949e;display:block;margin-bottom:4px;">
                            Para quién es (nota interna)</label>
                        <input id="gp-nota" type="text" placeholder="Ej: lo regala Ana a un compañero"
                            style="width:100%;padding:0.6rem;background:rgba(255,255,255,0.05);
                                   border:1px solid rgba(255,255,255,0.15);border-radius:8px;
                                   color:white;font-size:0.88rem;box-sizing:border-box;">
                        <span style="font-size:0.68rem;color:#8b949e;margin-top:3px;display:block;">
                            Sólo la ves tú, en esta lista. No aparece en el enlace ni la ve quien lo canjea.
                        </span>
                    </div>
                    <button onclick="window.saGenerarPaseRegalo()" class="sa-btn"
                        style="background:rgba(210,168,255,0.18);border:1px solid rgba(210,168,255,0.5);
                               color:#d2a8ff;padding:0.6rem;border-radius:8px;font-weight:700;
                               font-size:0.85rem;cursor:pointer;">
                        🎁 Crear entidad y generar el enlace
                    </button>
                </div>
            </div>

            <div id="gp-nuevo"></div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
                <div style="font-size:0.82rem;font-weight:700;color:white;">Pases emitidos</div>
                <button onclick="window.saListarPasesRegalo()" class="sa-btn"
                    style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);
                           color:#8b949e;padding:0.32rem 0.7rem;border-radius:6px;
                           font-size:0.72rem;font-weight:700;cursor:pointer;">🔄 Actualizar</button>
            </div>
            <div id="gp-lista">
                <div style="text-align:center;padding:2rem;color:#8b949e;font-size:0.8rem;">Cargando…</div>
            </div>
        </div>`;

        await window.saListarPasesRegalo();
    };

    // ── Generar: crea el ente y acuña la invitación ────────────────────
    window.saGenerarPaseRegalo = async function () {
        if (!window.cronosPuedeRegalar()) {
            _toast('⛔ Los pases de regalo son exclusivos del SuperAdministrador', 5000);
            return;
        }
        const nombre = (document.getElementById('gp-nombre')?.value || '').trim();
        const nota   = (document.getElementById('gp-nota')?.value || '').trim();
        if (!nombre) { _toast('⚠️ Ponle un nombre a la entidad del regalo', 3500); return; }

        const fsp = _fs();
        if (!fsp) { _toast('⚠️ No hay conexión con la base de datos', 4000); return; }

        if (typeof window.cronosCrearInvitacion !== 'function') {
            _toast('⚠️ El módulo de invitaciones no está disponible', 4000);
            return;
        }

        try {
            if (typeof window._saShowSpinner === 'function') window._saShowSpinner('Creando el regalo…');
            const { db, doc, setDoc } = await fsp;

            // 1. La entidad. Mismos campos que saCreateIndividualEntity, para
            //    que los paneles de entes la traten como una más.
            const entityId = 'individual_' + Date.now().toString(36) + '_' +
                             Math.random().toString(36).substr(2, 4);
            await setDoc(doc(db, 'clubs', entityId), {
                name:        nombre,
                type:        'individual',
                plan:        'individual',
                status:      'active',
                hasAdmin:    false,
                adminEmail:  null,
                adminUid:    null,
                adminName:   null,
                email:       null,
                slots:       { admins: 1, coaches: 2, parents: 30 },
                usedSlots:   { admins: 0, coaches: 0, parents: 0 },
                createdAt:   new Date().toISOString(),
                createdBySA: window._cronosCurrentUser?.email || 'superadmin',
                // 🎁 La marca que permite reconocerlo después en el listado de
                //    entes: un ente de regalo sin canjear es distinto de uno
                //    que el SuperAdmin creó a mano y todavía no ha asignado.
                giftPass:    true,
            });

            // 2. La invitación. ⚠️ SIN `email`: en un regalo NO se sabe quién
            //    lo va a canjear — lo decide el Usuario 1. El alta pedirá el
            //    correo, que es lo correcto.
            const inv = await window.cronosCrearInvitacion({
                email:    '',
                role:     'individual',
                clubName: nombre,
                clubId:   entityId,
                gift:      true,
                giftNota:  nota,
                giftEntityId: entityId,
            });

            if (typeof window._saHideSpinner === 'function') window._saHideSpinner();

            const caja = document.getElementById('gp-nuevo');
            if (caja) {
                caja.innerHTML = `
                <div style="background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.35);
                            border-radius:10px;padding:1rem;margin-bottom:1.2rem;">
                    <div style="font-size:0.82rem;font-weight:700;color:#3fb950;margin-bottom:0.5rem;">
                        ✅ Pase creado — entidad «${_esc(nombre)}»
                    </div>
                    <p style="font-size:0.74rem;color:#8b949e;margin:0 0 0.6rem;line-height:1.5;">
                        Copia este enlace y dáselo a quien va a hacer el regalo.
                        Quien lo abra se registrará ya atado a esta entidad.
                    </p>
                    <input id="gp-enlace" readonly value="${_esc(inv.url)}"
                        onclick="this.select()"
                        style="width:100%;padding:0.55rem;background:rgba(0,0,0,0.35);
                               border:1px solid rgba(63,185,80,0.35);border-radius:7px;
                               color:#3fb950;font-size:0.76rem;font-family:monospace;
                               box-sizing:border-box;">
                    <button onclick="window.saCopiarPase()" class="sa-btn"
                        style="margin-top:0.55rem;background:rgba(63,185,80,0.15);
                               border:1px solid rgba(63,185,80,0.45);color:#3fb950;
                               padding:0.45rem 0.9rem;border-radius:7px;font-weight:700;
                               font-size:0.78rem;cursor:pointer;">📋 Copiar enlace</button>
                </div>`;
            }
            const campoN = document.getElementById('gp-nombre'); if (campoN) campoN.value = '';
            const campoT = document.getElementById('gp-nota');   if (campoT) campoT.value = '';
            _toast('🎁 Pase de regalo creado', 4000);
            await window.saListarPasesRegalo();

        } catch (e) {
            if (typeof window._saHideSpinner === 'function') window._saHideSpinner();
            console.error('[PasesRegalo] no se pudo crear:', e);
            _toast('❌ No se pudo crear el pase: ' + (e && e.message ? e.message : e), 6000);
        }
    };

    window.saCopiarPase = function () {
        const el = document.getElementById('gp-enlace');
        if (!el) return;
        el.select();
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(el.value)
                .then(() => _toast('📋 Enlace copiado', 2500))
                .catch(() => { try { document.execCommand('copy'); _toast('📋 Enlace copiado', 2500); } catch (_) {} });
        } else {
            try { document.execCommand('copy'); _toast('📋 Enlace copiado', 2500); } catch (_) {}
        }
    };

    // ── El listado con su estado ───────────────────────────────────────
    window.saListarPasesRegalo = async function () {
        const cont = document.getElementById('gp-lista');
        if (!cont) return;
        const fsp = _fs();
        if (!fsp) { cont.innerHTML = '<div style="color:#ff5858;font-size:0.8rem;">⚠️ Sin conexión</div>'; return; }

        try {
            const { db, collection, getDocs, query, where, doc, getDoc } = await fsp;

            // ⚠️ `where('gift','==',true)` y NO traerse todas las invitaciones
            //    para filtrarlas aquí: la Secretaría normal emite muchas más, y
            //    leerlas todas es pagar lecturas por nada (la lección de v572).
            const snap = await getDocs(query(collection(db, 'invites'), where('gift', '==', true)));
            const pases = [];
            snap.forEach(d => pases.push({ _id: d.id, ...d.data() }));

            if (!pases.length) {
                cont.innerHTML = `
                <div style="text-align:center;padding:2rem 1rem;color:#8b949e;font-size:0.8rem;">
                    Todavía no has generado ningún pase de regalo.
                </div>`;
                return;
            }

            // Para los canjeados hace falta el usuario, y sólo para ésos: es lo
            // que distingue "registrada" de "aprobada".
            const usuarios = {};
            for (const p of pases) {
                if (!p.usedBy) continue;
                try {
                    const u = await getDoc(doc(db, 'users', p.usedBy));
                    if (u.exists()) usuarios[p.usedBy] = u.data();
                } catch (_) { /* sin permiso o borrado: se trata como registrada */ }
            }

            pases.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

            cont.innerHTML = pases.map(p => {
                const estado = window.cronosEstadoPase(p, usuarios[p.usedBy]);
                const meta   = window.CRONOS_PASE_META[estado] || window.CRONOS_PASE_META.pendiente;
                const quien  = usuarios[p.usedBy] || null;
                const fecha  = p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-ES') : '—';
                return `
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);
                            border-left:3px solid ${meta.color};border-radius:10px;
                            padding:0.8rem 1rem;margin-bottom:0.6rem;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;
                                gap:0.7rem;flex-wrap:wrap;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.88rem;font-weight:700;color:white;">
                                🎁 ${_esc(p.clubName || '(sin nombre)')}
                            </div>
                            <div style="font-size:0.72rem;color:#8b949e;margin-top:3px;">
                                📅 ${_esc(fecha)}
                                ${p.giftNota ? ' · 📝 ' + _esc(p.giftNota) : ''}
                            </div>
                            ${quien ? `<div style="font-size:0.72rem;color:#58a6ff;margin-top:3px;">
                                👤 Canjeado por ${_esc(quien.displayName || quien.email || p.usedBy)}
                            </div>` : ''}
                        </div>
                        <span style="background:${meta.color}22;border:1px solid ${meta.color}66;
                                     color:${meta.color};font-size:0.68rem;font-weight:800;
                                     padding:3px 9px;border-radius:6px;white-space:nowrap;">
                            ${meta.icono} ${_esc(meta.etiqueta)}
                        </span>
                    </div>
                    ${estado === 'pendiente' ? `
                    <div style="margin-top:0.6rem;display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
                        <input readonly value="${_esc((window.CRONOS_APP_URL || '') + '/?invite=' + p._id)}"
                            onclick="this.select()"
                            style="flex:1;min-width:200px;padding:0.35rem 0.5rem;background:rgba(0,0,0,0.3);
                                   border:1px solid rgba(255,255,255,0.12);border-radius:6px;
                                   color:#8b949e;font-size:0.68rem;font-family:monospace;">
                    </div>` : ''}
                </div>`;
            }).join('');

        } catch (e) {
            console.error('[PasesRegalo] no se pudo listar:', e);
            cont.innerHTML = `<div style="color:#ff5858;font-size:0.8rem;padding:1rem;">
                ⚠️ No se pudieron leer los pases: ${_esc(e && e.message ? e.message : e)}</div>`;
        }
    };
})();
