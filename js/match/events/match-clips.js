// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — match-clips.js
//  🎬 v804 · Vídeos cortos de jugadas (una reproducción por cuenta)
// ════════════════════════════════════════════════════════════════════
//
//  Encargo del autor (implementar.txt 2026-10-11, capturas 11321-11322) y
//  sus decisiones:
//    1 · Subida desde «Registrar Evento Perdido» (directo, Comunicaciones y
//        Partidos Terminados en sus 2 h — es el MISMO modal).
//    2 · Cada cuenta lo reproduce UNA vez: cuenta como visto al TERMINARLO
//        o al cerrarlo después de ver MÁS DE LA MITAD.
//    3 · Marca de agua con el nombre y el correo de quien lo ve.
//    4 · Se borra a las 24 h (caducidad del bucket + TTL de la ficha).
//    5 · Quién lo ve, por EDAD de la categoría: menores → sólo cuerpo
//        técnico; adultos (Regional, Regional FEM, Nacional, Senior) →
//        también jugadores y familias si quien lo sube lo habilita.
//    6 · Extra `modulo_videos`, AUSENTE = APAGADO (club a club).
//
//  🔑 LO QUE HACE CUMPLIR CADA COSA ES EL SERVIDOR, no esta pantalla:
//  storage.rules deja descargar el vídeo sólo a quien puede verlo, si no ha
//  caducado y si NO existe su vistas/{uid}; firestore.rules sólo admite
//  `audiencia:'familias'` en categorías de adultos. Aquí se ofrece y se
//  pinta lo mismo para no enseñar botones que el servidor rechazaría.
//
//  🔑 EL VÍDEO NUNCA TIENE ENLACE PÚBLICO. No se llama a getDownloadURL (un
//  enlace con token se salta las reglas para siempre): se bajan los bytes
//  con getBlob, que pasa por las reglas, y se reproducen desde memoria.
//
//  ⚠️ LÍMITE HONESTO: en un navegador no se puede impedir al 100 % una
//  copia (otro aparato grabando la pantalla). La vista única, la marca de
//  agua y la falta de enlace lo hacen difícil y RASTREABLE, no imposible.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const FS_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
    const ST_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
    const COL = 'cronos_clips';
    const MAX_BYTES = 50 * 1024 * 1024;
    const MAX_SEG = 30;
    const VIDA_MS = 24 * 60 * 60 * 1000;
    const EXTRA = 'modulo_videos';

    const ROLES_STAFF = ['user', 'coach', 'director', 'coordinator', 'club_admin',
                         'individual', 'admin_individual', 'individual_admin', 'entrenador_individual'];
    const ROLES_FAMILIA = ['parent', 'padre_individual', 'parent_individual'];

    const _esc = (s) => (typeof window.escapeHtml === 'function')
        ? window.escapeHtml(String(s == null ? '' : s))
        : String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const _toast = (m, ms) => { if (typeof showToast === 'function') showToast(m, ms || 3500); };

    function _yo() {
        return ((typeof window._getEffectiveUser === 'function') && window._getEffectiveUser())
            || window._cronosCurrentUser || null;
    }
    function _db() { const fa = window._cronos_auth; return (fa && fa.db) ? fa.db : null; }
    function _clubId(me) { me = me || _yo() || {}; return me.clubId || me.individualEntityId || ''; }
    function _rol(me) { me = me || _yo() || {}; return me._activeRole || me.role || ''; }

    // ── Puertas ──────────────────────────────────────────────────────
    function activo(me) {
        me = me || _yo();
        if (!me) return false;
        return !!((me.extras || {})[EXTRA] === true);
    }
    function esStaff(me) { return ROLES_STAFF.indexOf(_rol(me)) >= 0; }
    // 🗑️ v807 · Borrar: quien lo subió y Dirección (Director, Coordinador,
    // Admin del club, admin del ente). El servidor lo vuelve a exigir.
    const ROLES_DIRECCION = ['director', 'coordinator', 'club_admin',
                             'individual', 'admin_individual', 'individual_admin'];
    function puedeBorrar(c, me) {
        me = me || _yo();
        if (!me || !c) return false;
        return c.uploaderUid === me.uid
            || ROLES_DIRECCION.indexOf(_rol(me)) >= 0
            || ROLES_DIRECCION.indexOf(me.role || '') >= 0;
    }
    function esFamilia(me) { return ROLES_FAMILIA.indexOf(_rol(me)) >= 0; }

    // La categoría, con la MISMA forma que mira firestore.rules (slug sin
    // modalidad: 'regional', 'regional-fem', 'nacional', 'f7-alevin' → 'alevin').
    function categoriaSlug(cat) {
        const sinMod = (typeof window.cronosSinModalidad === 'function') ? window.cronosSinModalidad(cat || '') : String(cat || '');
        const slug = (typeof window.cronosTeamSlug === 'function')
            ? window.cronosTeamSlug(sinMod)
            : String(sinMod).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        // La modalidad delante («f11-regional») no cambia la edad: fuera,
        // aunque utils.js no esté cargado.
        return slug.replace(/^(f7|f11)-/, '');
    }
    function esAdultos(cat) {
        return /^(regional|regional-fem|nacional|senior)(-[a-z0-9-]*)?$/.test(categoriaSlug(cat));
    }

    // ── Comprobar un fichero antes de aceptarlo ──────────────────────
    //  Peso (también lo exige el servidor) y duración (sólo aquí: es un
    //  límite de uso, no de seguridad).
    // 🎬 v806 · CUALQUIER vídeo, sin mirar el códec. Los móviles entregan a
    // menudo .mov/.3gp/.mkv SIN tipo o como «application/octet-stream»: el
    // tipo se deduce de la extensión y, si tampoco la hay, vale como vídeo
    // (lo eligió el selector de vídeos del sistema). Sólo se rechaza lo que
    // dice EXPRESAMENTE ser otra cosa (imagen, audio, texto…).
    const EXT_VIDEO = {
        mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', qt: 'video/quicktime',
        '3gp': 'video/3gpp', '3g2': 'video/3gpp2', webm: 'video/webm', mkv: 'video/x-matroska',
        avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', mpg: 'video/mpeg', mpeg: 'video/mpeg',
        ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t', ogv: 'video/ogg', flv: 'video/x-flv',
        hevc: 'video/mp4', h264: 'video/mp4',
    };
    function tipoVideo(file) {
        const t = String((file && file.type) || '').toLowerCase();
        if (/^video\//.test(t)) return t;
        const ext = String((file && file.name) || '').toLowerCase().split('.').pop();
        return EXT_VIDEO[ext] || 'video/mp4';
    }
    function noEsVideo(file) {
        const t = String((file && file.type) || '').toLowerCase();
        return /^(image|audio|text|font|model)\//.test(t) || /^application\/(pdf|zip|json|msword|vnd\.)/.test(t);
    }
    // Duración: si el navegador no sabe leer el códec (HEVC en Chrome de
    // escritorio, etc.) a veces NO avisa ni con error. Nunca se espera más de
    // 5 s: sin duración, vale igual (el límite de 50 MB lo pone el servidor).
    function compruebaFichero(file) {
        return new Promise((res) => {
            if (!file) return res({ ok: false, motivo: 'No hay fichero.' });
            if (noEsVideo(file)) return res({ ok: false, motivo: 'El fichero no es un vídeo.' });
            if (file.size > MAX_BYTES) return res({ ok: false, motivo: 'El vídeo pesa ' + (file.size / 1048576).toFixed(0) + ' MB y el máximo es 50 MB. Recórtalo o grábalo más corto o en menor calidad (1080p).' });
            const tipo = tipoVideo(file);
            let url = '', hecho = false, reloj = null;
            const fin = (r) => {
                if (hecho) return; hecho = true;
                try { clearTimeout(reloj); } catch (e) {}
                try { if (url) URL.revokeObjectURL(url); } catch (e) {}
                res(Object.assign({ tipo }, r));
            };
            try {
                const v = document.createElement('video');
                url = URL.createObjectURL(file);
                v.preload = 'metadata';
                v.muted = true;
                v.setAttribute('playsinline', '');
                v.onloadedmetadata = () => {
                    const d = Number(v.duration);
                    const dur = isFinite(d) && d > 0 ? d : 0;   // webm de móvil: Infinity
                    fin(dur > MAX_SEG + 1
                        ? { ok: false, motivo: 'El vídeo dura ' + Math.round(dur) + ' s: el máximo es ' + MAX_SEG + ' s.' }
                        : { ok: true, duracion: dur });
                };
                v.onerror = () => fin({ ok: true, duracion: 0 });   // códec que este navegador no lee: vale igual
                reloj = setTimeout(() => fin({ ok: true, duracion: 0 }), 5000);
                v.src = url;
            } catch (e) { fin({ ok: true, duracion: 0 }); }
        });
    }

    // ── Subir ─────────────────────────────────────────────────────────
    //  d = { file, matchId, teamId, category, subcategory, tipo, half,
    //        minute, rotulo, paraFamilias, duracion }
    //  Primero el fichero y después la ficha: si la ficha fallara, el
    //  fichero huérfano lo borra la caducidad del bucket al día siguiente.
    async function subir(d, alProgreso) {
        const me = _yo();
        const db = _db();
        if (!me || !db || !d || !d.file) return { ok: false, motivo: 'sin sesión' };
        if (!activo(me)) return { ok: false, motivo: 'Los vídeos no están activados para tu club.' };
        const clubId = _clubId(me);
        const clipId = 'clip_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
        const categoria = categoriaSlug(d.category);
        const audiencia = (d.paraFamilias && esAdultos(d.category)) ? 'familias' : 'staff';
        try {
            const st = await import(ST_URL);
            const storage = st.getStorage(db.app);
            const ref = st.ref(storage, 'clips/' + clubId + '/' + clipId);
            await new Promise((res, rej) => {
                const tarea = st.uploadBytesResumable(ref, d.file, {
                    contentType: tipoVideo(d.file),
                    // Storage sólo consulta 2 documentos por petición: quién puede
                    // verlo viaja en el propio fichero (inmutable tras subirlo).
                    customMetadata: { uploader: me.uid, clipId: clipId, audiencia: audiencia, categoria: categoria },
                });
                tarea.on('state_changed',
                    (s) => { if (alProgreso && s.totalBytes) alProgreso(s.bytesTransferred / s.totalBytes); },
                    rej, res);
            });
            const fs = await import(FS_URL);
            const ahora = Date.now();
            await fs.setDoc(fs.doc(db, COL, clipId), {
                clipId, clubId,
                path: 'clips/' + clubId + '/' + clipId,
                contentType: tipoVideo(d.file),
                size: d.file.size || 0,
                duracion: Math.round(Number(d.duracion) || 0),
                matchId: String(d.matchId || ''),
                teamId: String(d.teamId || ''),
                category: String(d.category || ''),
                subcategory: String(d.subcategory || ''),
                categoria,
                audiencia,
                tipo: String(d.tipo || ''),
                half: String(d.half || ''),
                minute: Number(d.minute) || 0,
                rotulo: String(d.rotulo || '').slice(0, 160),
                uploaderUid: me.uid,
                uploaderName: String((typeof window._ccNombreDe === 'function' ? window._ccNombreDe(me) : '') || me.email || '').slice(0, 80),
                createdAt: fs.Timestamp.fromMillis(ahora),
                expiresAt: fs.Timestamp.fromMillis(ahora + VIDA_MS),
            });
            return { ok: true, clipId, audiencia };
        } catch (e) {
            console.warn('[v804] Subida de vídeo fallida:', e && (e.code || e.message));
            return { ok: false, motivo: (e && e.code) || 'error' };
        }
    }

    // ── Lista de los clips que este usuario puede ver ────────────────
    //  Cuerpo técnico: todos los del club (el coordinador, su modalidad; el
    //  entrenador, sus equipos). Familias: sólo `audiencia:'familias'` — la
    //  consulta lo pide así porque, si no, las reglas la rechazarían entera.
    async function listar() {
        const me = _yo();
        const db = _db();
        if (!me || !db) return [];
        const clubId = _clubId(me);
        if (!clubId) return [];
        const fs = await import(FS_URL);
        const filtros = [fs.where('clubId', '==', clubId)];
        if (!esStaff(me)) {
            if (!esFamilia(me)) return [];
            filtros.push(fs.where('audiencia', '==', 'familias'));
        }
        const snap = await fs.getDocs(fs.query(fs.collection(db, COL), ...filtros));
        const ahora = Date.now();
        let lista = [];
        snap.forEach((d) => {
            const x = d.data() || {};
            const cad = (x.expiresAt && x.expiresAt.toMillis) ? x.expiresAt.toMillis() : 0;
            if (cad && cad > ahora) lista.push(Object.assign({ id: d.id, caduca: cad }, x));
        });
        // Alcance: el coordinador acotado ve su modalidad; el entrenador, sus equipos.
        if (typeof window._cronosVeCategoria === 'function') lista = lista.filter((c) => window._cronosVeCategoria(me, c.category));
        const rol = _rol(me);
        if (rol === 'user' || rol === 'coach' || rol === 'entrenador_individual' || esFamilia(me)) {
            const mios = _misEquipos(me);
            if (mios.length) lista = lista.filter((c) => !c.teamId || mios.indexOf(c.teamId) >= 0 || c.uploaderUid === me.uid);
        }
        // ¿Ya lo he visto? (un get por clip; son pocos y caducan en un día)
        await Promise.all(lista.map(async (c) => {
            try {
                const v = await fs.getDoc(fs.doc(db, COL, c.id, 'vistas', me.uid));
                c.visto = v.exists();
            } catch (e) { c.visto = false; }
        }));
        return lista.sort((a, b) => (b.caduca || 0) - (a.caduca || 0));
    }
    function _misEquipos(me) {
        const out = [];
        try {
            (Array.isArray(me.allRoles) ? me.allRoles : []).forEach((r) => {
                if (!r || !r.category || typeof window.cronosTeamId !== 'function') return;
                const t = window.cronosTeamId(r.clubId || me.clubId || '', r.category, r.subcategory || '');
                if (t && out.indexOf(t) < 0) out.push(t);
            });
            if (me.category && typeof window.cronosTeamId === 'function') {
                const t = window.cronosTeamId(me.clubId || '', me.category, me.subcategory || '');
                if (t && out.indexOf(t) < 0) out.push(t);
            }
        } catch (e) {}
        return out;
    }

    // ── La pantalla de la lista ───────────────────────────────────────
    const _ICONO = { goal: '⚽', sub: '🔄', yellow: '🟨', red: '🟥', injury: '🚑', comment: '💬' };
    function _horas(ms) {
        const h = Math.max(0, Math.round((ms - Date.now()) / 3600000));
        return h <= 1 ? 'menos de 1 h' : h + ' h';
    }
    function _capa(id, html) {
        let c = document.getElementById(id);
        if (!c) {
            c = document.createElement('div');
            c.id = id;
            c.style.cssText = 'position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,0.85);' +
                'display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;' +
                'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:white;';
            document.body.appendChild(c);
        }
        c.innerHTML = html;
        c.style.display = 'flex';
        return c;
    }
    function cerrarLista() { const c = document.getElementById('cronos-clips-lista'); if (c) c.style.display = 'none'; }

    async function abrirLista() {
        const me = _yo();
        if (!activo(me)) { _toast('🎬 Los vídeos no están activados para tu club. Habla con el administrador.', 5000); return; }
        const marco = (cuerpo) =>
            '<div style="width:min(94vw,560px);max-height:90vh;overflow-y:auto;box-sizing:border-box;background:#0d1117;' +
                    'border:1px solid rgba(88,166,255,0.3);border-radius:14px;padding:1.1rem;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.7rem;">' +
                    '<h3 style="margin:0;font-size:1.05rem;">🎬 Vídeos de jugadas</h3>' +
                    '<button type="button" onclick="window.CronosClips.cerrarLista()" style="background:none;border:none;color:#7d8590;font-size:1.4rem;cursor:pointer;">✕</button>' +
                '</div>' +
                '<div style="font-size:0.74rem;color:#8b949e;line-height:1.45;margin-bottom:0.8rem;">' +
                    'Cada vídeo se puede ver <strong style="color:white;">una sola vez</strong> por cuenta: <strong style="color:#ffb4ac;">al pulsar «Ver» ya cuenta como visto</strong>. Se borra solo a las 24 h. ' +
                    'Durante la reproducción aparece tu nombre como marca de agua.' +
                '</div>' + cuerpo + '</div>';
        _capa('cronos-clips-lista', marco('<div style="text-align:center;padding:2rem;color:#8b949e;">⏳ Cargando…</div>'));
        let lista = [];
        try { lista = await listar(); } catch (e) {
            _capa('cronos-clips-lista', marco('<div style="color:#ff5858;padding:1rem;">⚠️ No se han podido cargar los vídeos.</div>'));
            return;
        }
        const filas = lista.map((c) =>
            '<div style="display:flex;align-items:center;gap:0.6rem;padding:0.6rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.07);">' +
                '<span style="font-size:1.3rem;flex-shrink:0;">' + (_ICONO[c.tipo] || '🎬') + '</span>' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-weight:700;font-size:0.85rem;word-break:break-word;">' + _esc(c.rotulo || 'Jugada') + '</div>' +
                    '<div style="font-size:0.68rem;color:#8b949e;">' +
                        _esc([c.half, c.minute ? c.minute + "'" : ''].filter(Boolean).join(' ')) +
                        (c.uploaderName ? ' · ' + _esc(c.uploaderName) : '') +
                        ' · se borra en ' + _esc(_horas(c.caduca)) +
                        (c.audiencia === 'familias' ? ' · 👪 también familias' : ' · 🔒 cuerpo técnico') +
                    '</div>' +
                '</div>' +
                (c.visto
                    ? '<span style="flex-shrink:0;font-size:0.7rem;font-weight:800;color:#7d8590;border:1px solid #30363d;border-radius:6px;padding:0.3rem 0.5rem;">✓ Ya visto</span>'
                    : '<button type="button" onclick="window.CronosClips.ver(\'' + _esc(c.id) + '\')" style="flex-shrink:0;background:linear-gradient(135deg,#58a6ff,#1f6beb);border:none;color:white;border-radius:8px;padding:0.45rem 0.8rem;font-weight:800;cursor:pointer;">▶️ Ver</button>') +
                (puedeBorrar(c, me)
                    ? '<button type="button" title="Borrar este vídeo para todos" aria-label="Borrar vídeo" onclick="window.CronosClips.borrar(\'' + _esc(c.id) + '\')" ' +
                        'style="flex-shrink:0;min-width:40px;min-height:36px;background:rgba(248,81,73,0.12);border:1px solid rgba(248,81,73,0.5);color:#ff7b72;border-radius:8px;padding:0.4rem 0.55rem;font-weight:800;cursor:pointer;">🗑️</button>'
                    : '') +
            '</div>').join('');
        _capa('cronos-clips-lista', marco(filas ||
            '<div style="text-align:center;padding:2rem;color:#8b949e;">No hay vídeos disponibles ahora mismo.</div>'));
    }

    // ── 🗑️ v807 · Borrar al momento (clips erróneos o duplicados) ──────
    //  Primero el FICHERO y luego la ficha: si la ficha fallara, se puede
    //  volver a pulsar (un fichero que ya no está no cuenta como error).
    async function borrar(clipId) {
        const me = _yo();
        const db = _db();
        if (!me || !db || !clipId) return { ok: false };
        if (typeof confirm === 'function' &&
            !confirm('¿Borrar este vídeo para TODOS? No se puede deshacer.')) return { ok: false, cancelado: true };
        try {
            const st = await import(ST_URL);
            try {
                await st.deleteObject(st.ref(st.getStorage(db.app), 'clips/' + _clubId(me) + '/' + clipId));
            } catch (e) {
                if (!e || e.code !== 'storage/object-not-found') throw e;
            }
            const fs = await import(FS_URL);
            await fs.deleteDoc(fs.doc(db, COL, clipId));
            _toast('🗑️ Vídeo borrado.');
            if (document.getElementById('cronos-clips-lista')) abrirLista();
            return { ok: true };
        } catch (e) {
            console.warn('[v807] No se pudo borrar el vídeo:', e && (e.code || e.message));
            _toast('⚠️ No se ha podido borrar el vídeo' + (e && /unauthorized|permission/i.test(e.code || '') ? ': no tienes permiso.' : '.'), 5000);
            return { ok: false, motivo: (e && e.code) || 'error' };
        }
    }

    // ── El reproductor de UNA vez ─────────────────────────────────────
    let _sesion = null;   // { clipId, url, max, duracion, marcado }

    // 👁️ v808 · VISTO = ABIERTO (encargo del autor): la vista se apunta en
    // cuanto se despliega el reproductor, lo vea entero o lo cierre al
    // segundo. Si la escritura fallara (sin red), se reintenta al cerrar el
    // visor o la pestaña; mientras tanto el vídeo ya está en memoria.
    async function _marcaVisto(completo) {
        const s = _sesion;
        if (!s || s.marcado || s.marcando) return;
        s.marcando = true;
        try {
            const me = _yo();
            const fs = await import(FS_URL);
            await fs.setDoc(fs.doc(_db(), COL, s.clipId, 'vistas', me.uid), {
                uid: me.uid,
                at: fs.serverTimestamp(),
                completo: !!completo,
                expiresAt: fs.Timestamp.fromMillis(Date.now() + VIDA_MS + 3600000),
            });
            s.marcado = true;
        } catch (e) {
            console.warn('[v808] No se pudo registrar la vista (se reintentará al cerrar):', e && (e.code || e.message));
        } finally {
            s.marcando = false;
        }
    }

    function _marcaDeAgua(me) {
        const quien = _esc([me.displayName || me.firstName || me.name || '', me.email || ''].filter(Boolean).join(' · ') || me.uid);
        const cuando = _esc(new Date().toLocaleString('es-ES'));
        let tejido = '';
        for (let i = 0; i < 18; i++) {
            tejido += '<span style="display:inline-block;margin:2.2rem 2.5rem;white-space:nowrap;">' + quien + '<br>' + cuando + '</span>';
        }
        return '<div style="position:absolute;inset:-20%;pointer-events:none;transform:rotate(-24deg);' +
                    'color:rgba(255,255,255,0.16);font-size:0.95rem;font-weight:800;line-height:1.3;' +
                    'text-shadow:0 0 2px rgba(0,0,0,0.5);user-select:none;overflow:hidden;">' + tejido + '</div>' +
               '<div id="cronos-clip-marca-viva" style="position:absolute;left:8%;top:12%;pointer-events:none;' +
                    'color:rgba(255,255,255,0.42);font-size:1rem;font-weight:900;text-shadow:0 0 3px rgba(0,0,0,0.8);' +
                    'transition:left 1.2s,top 1.2s;user-select:none;">' + quien + '</div>';
    }

    async function ver(clipId) {
        const me = _yo();
        const db = _db();
        if (!me || !db || !clipId) return;
        cerrarLista();
        const capa = _capa('cronos-clip-visor',
            '<div style="text-align:center;color:#8b949e;">⏳ Preparando el vídeo…</div>');
        let blob, ficha;
        try {
            const fs = await import(FS_URL);
            const f = await fs.getDoc(fs.doc(db, COL, clipId));
            if (!f.exists()) throw { code: 'no-existe' };
            ficha = f.data() || {};
            const v = await fs.getDoc(fs.doc(db, COL, clipId, 'vistas', me.uid));
            if (v.exists()) throw { code: 'ya-visto' };
            const st = await import(ST_URL);
            blob = await st.getBlob(st.ref(st.getStorage(db.app), ficha.path || ('clips/' + ficha.clubId + '/' + clipId)));
        } catch (e) {
            const c = (e && e.code) || '';
            const msg = c === 'ya-visto' ? '✓ Ya viste este vídeo: sólo se puede ver una vez.'
                      : (c === 'storage/unauthorized' ? '🔒 Este vídeo ya no está disponible para tu cuenta (visto, caducado o sin permiso).'
                      : (c === 'storage/object-not-found' || c === 'no-existe' ? '🗑️ El vídeo ya se ha borrado.'
                      : '⚠️ No se ha podido cargar el vídeo. Revisa la conexión.'));
            capa.style.display = 'none';
            _toast(msg, 5000);
            return;
        }
        const url = URL.createObjectURL(blob);
        _sesion = { clipId, url, duracion: 0, marcado: false, marcando: false };
        // 👁️ v808 · VISTO = ABIERTO: se apunta YA, al desplegar el reproductor.
        _marcaVisto(false);
        capa.innerHTML =
            '<div style="position:relative;width:min(96vw,900px);">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;gap:0.5rem;">' +
                    '<div style="font-size:0.85rem;font-weight:800;word-break:break-word;">' + _esc(ficha.rotulo || 'Jugada') + '</div>' +
                    '<button type="button" onclick="window.CronosClips.cerrarVisor()" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.25);color:white;border-radius:8px;padding:0.35rem 0.8rem;font-weight:800;cursor:pointer;flex-shrink:0;">✕ Cerrar</button>' +
                '</div>' +
                '<div style="position:relative;overflow:hidden;border-radius:10px;background:#000;" oncontextmenu="return false;">' +
                    '<video id="cronos-clip-video" src="' + url + '" autoplay playsinline controls ' +
                        'controlsList="nodownload noremoteplayback noplaybackrate" disablePictureInPicture disableRemotePlayback ' +
                        'style="display:block;width:100%;max-height:75vh;background:#000;"></video>' +
                    _marcaDeAgua(me) +
                '</div>' +
                '<div style="font-size:0.7rem;color:#ffb4ac;margin-top:0.4rem;">⚠️ Este vídeo ya cuenta como visto: al cerrarlo no podrás volver a abrirlo.</div>' +
            '</div>';
        const video = document.getElementById('cronos-clip-video');
        if (video) {
            // webm de móvil da Infinity hasta el final: se recoge al cambiar.
            const dur = () => { const d = Number(video.duration); if (_sesion && isFinite(d) && d > 0) _sesion.duracion = d; };
            video.addEventListener('loadedmetadata', dur);
            video.addEventListener('durationchange', dur);
            // 🎬 v806 · Un códec que ESTE aparato no sabe reproducir: se avisa.
            // (v808: la vista ya se apuntó al abrir, como pidió el autor.)
            video.addEventListener('error', () => {
                if (!_sesion) return;
                const aviso = document.createElement('div');
                aviso.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:1rem;background:rgba(0,0,0,0.85);color:#ffb4ac;font-size:0.85rem;font-weight:700;z-index:3;';
                aviso.textContent = '⚠️ Este dispositivo no puede reproducir el formato de este vídeo.';
                try { video.parentNode.appendChild(aviso); } catch (e) {}
            });
        }
        // La marca viva se mueve sola: una grabación no puede recortarla sin más.
        const marca = document.getElementById('cronos-clip-marca-viva');
        _sesion.mover = setInterval(() => {
            if (!marca) return;
            marca.style.left = (5 + Math.random() * 55) + '%';
            marca.style.top  = (5 + Math.random() * 75) + '%';
        }, 2500);
        // Reintento si la vista no llegó a escribirse al abrir (sin red).
        _sesion.alSalir = () => { _marcaVisto(false); };
        window.addEventListener('pagehide', _sesion.alSalir);
    }

    function cerrarVisor() {
        const s = _sesion;
        if (s) {
            _marcaVisto(false);   // reintento: si ya está apuntada, no hace nada
            try { clearInterval(s.mover); } catch (e) {}
            try { window.removeEventListener('pagehide', s.alSalir); } catch (e) {}
            const v = document.getElementById('cronos-clip-video');
            if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} }
            try { URL.revokeObjectURL(s.url); } catch (e) {}
        }
        _sesion = null;
        const c = document.getElementById('cronos-clip-visor');
        if (c) { c.innerHTML = ''; c.style.display = 'none'; }
    }

    window.CronosClips = {
        EXTRA, MAX_BYTES, MAX_SEG, VIDA_MS,
        activo, esStaff, esFamilia, esAdultos, categoriaSlug,
        compruebaFichero, tipoVideo, subir, listar, borrar, puedeBorrar, abrirLista, cerrarLista, ver, cerrarVisor,
        _sesion: () => _sesion,
    };
})();
