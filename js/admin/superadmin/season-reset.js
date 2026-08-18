// ════════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — season-reset.js
//  Vaciado de temporada: borra los datos deportivos CONSERVANDO el club (v436)
// ════════════════════════════════════════════════════════════════════
//
//  QUÉ LO DIFERENCIA DE saDeleteClubComplete (delete-club.js), que es lo
//  peligroso de confundir:
//
//    · saDeleteClubComplete  → borra el CLUB, resetea a sus usuarios (pierden
//      el clubId y quedan libres para re-registrarse) y se lleva sus datos.
//      El club deja de existir.
//    · saResetClubSeason (esto) → el club y TODOS sus usuarios se quedan
//      exactamente como están, con sus roles y sus permisos. Solo se borran
//      los datos deportivos acumulados durante la temporada.
//
//  ⚠️ QUÉ NO SE BORRA NUNCA AQUÍ, y por qué:
//
//   · `cronos_player_links` (vínculos jugador ↔ padre). NO son datos de
//     temporada sino la ESTRUCTURA que conecta a cada familia con su hijo.
//     Borrarlos dejaría a los padres sin ver a sus hijos y habría que rehacer
//     todas las vinculaciones a mano. Va como opción desmarcada y con aviso:
//     solo tiene sentido si además se rehace la plantilla.
//   · `audit_logs`. La regla de Firestore es `allow write: if false`, así que
//     no lo puede borrar NADIE, ni el SuperAdmin. Es deliberado: una traza de
//     auditoría que se puede vaciar no es una traza de auditoría. No aparece
//     ni como opción, para no ofrecer algo que va a fallar.
//   · `users`, `clubs`, y la configuración del club. Es justo lo que se
//     conserva.
//
//  ⚠️ TODAS las consultas van acotadas por clubId. Ninguna barre una colección
//  entera: además del coste, un fallo de acotación aquí borraría los datos de
//  OTROS clubes, y esto no tiene deshacer.
// ════════════════════════════════════════════════════════════════════

// Colecciones que se pueden vaciar. `porDefecto` decide qué viene marcado.
window._SA_SEASON_COLS = [
    { col: 'live_matches',           etiqueta: 'Partidos',                  porDefecto: true },
    { col: 'cronos_player_reports',  etiqueta: 'Informes',                  porDefecto: true },
    { col: 'cronos_notifications',   etiqueta: 'Avisos y convocatorias',    porDefecto: true },
    { col: 'cronos_messages',        etiqueta: 'Conversaciones',            porDefecto: false },
    { col: 'cronos_player_links',    etiqueta: 'Vínculos jugador-padre',    porDefecto: false,
      aviso: 'Los padres dejarán de ver a sus hijos hasta que se rehagan las vinculaciones.' },
];

// Cuenta lo que hay, por colección, para que la confirmación diga la verdad y
// no una lista genérica de "se borrará todo".
window._saCountSeasonData = async function(clubId) {
    const { db, collection, getDocs, query, where } = await saFS();
    const out = {};
    await Promise.all(window._SA_SEASON_COLS.map(async ({ col }) => {
        try {
            const snap = await getDocs(query(collection(db, col), where('clubId', '==', clubId)));
            out[col] = snap.size;
        } catch (e) {
            // Un fallo de permisos o de índice se muestra como '?' en vez de 0:
            // un 0 falso haría creer que no hay nada que borrar.
            console.warn('[seasonReset] contando ' + col + ':', e && e.message);
            out[col] = null;
        }
    }));
    return out;
};

window.saResetClubSeason = async function(clubId, clubName) {
    if (!clubId) return;

    let conteo = {};
    try {
        if (typeof _saShowSpinner === 'function') _saShowSpinner('Calculando qué hay que vaciar…');
        conteo = await window._saCountSeasonData(clubId);
    } finally {
        if (typeof _saHideSpinner === 'function') _saHideSpinner();
    }

    const filas = window._SA_SEASON_COLS.map(({ col, etiqueta, porDefecto, aviso }) => {
        const n = conteo[col];
        const txt = n === null ? '?' : String(n);
        return `
            <label style="display:flex;align-items:flex-start;gap:0.6rem;padding:0.5rem 0.2rem;
                          border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer;">
                <input type="checkbox" class="sa-season-col" value="${col}"
                       ${porDefecto ? 'checked' : ''} style="margin-top:3px;">
                <span style="flex:1;min-width:0;">
                    <span style="font-weight:700;color:white;font-size:0.85rem;">${etiqueta}</span>
                    <span style="color:#7d8590;font-size:0.78rem;"> · ${txt} documento(s)</span>
                    ${aviso ? `<div style="color:#f0883e;font-size:0.72rem;margin-top:2px;">⚠️ ${aviso}</div>` : ''}
                </span>
            </label>`;
    }).join('');

    let modal = document.getElementById('sa-season-reset-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'sa-season-reset-modal';
        document.body.appendChild(modal);
    }
    modal.style.cssText = `position:fixed;inset:0;z-index:100010;background:rgba(0,0,0,0.82);
        display:flex;align-items:center;justify-content:center;padding:1rem;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;`;
    modal.innerHTML = `
        <div style="width:min(94vw,560px);max-height:90vh;overflow-y:auto;background:#0d1117;
                    border:1px solid rgba(255,88,88,0.35);border-radius:14px;padding:1.3rem;
                    box-shadow:0 12px 40px rgba(0,0,0,0.8);color:white;">
            <h3 style="margin:0 0 0.3rem;font-size:1.05rem;display:flex;align-items:center;gap:0.5rem;">
                🧹 Vaciar temporada
            </h3>
            <div style="color:#7d8590;font-size:0.82rem;margin-bottom:0.9rem;">
                Club: <strong style="color:#58a6ff;">${typeof escapeHtml === 'function' ? escapeHtml(clubName || clubId) : (clubName || clubId)}</strong>
            </div>

            <div style="background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.3);
                        border-radius:8px;padding:0.6rem 0.8rem;font-size:0.8rem;
                        color:#3fb950;margin-bottom:0.9rem;">
                ✅ El club y <strong>todos sus usuarios</strong> se conservan, con sus roles y
                permisos intactos. Esto no es el borrado del club.
            </div>

            <div style="font-size:0.78rem;color:#7d8590;margin-bottom:0.3rem;">
                Elige qué se borra:
            </div>
            ${filas}

            <div style="background:rgba(255,88,88,0.08);border:1px solid rgba(255,88,88,0.3);
                        border-radius:8px;padding:0.6rem 0.8rem;font-size:0.8rem;
                        color:#ff8080;margin:0.9rem 0;">
                ⚠️ Esta acción <strong>no se puede deshacer</strong>. Para confirmar, escribe
                el nombre del club exactamente:
            </div>
            <input id="sa-season-confirm" type="text" autocomplete="off"
                   placeholder="${typeof escapeHtml === 'function' ? escapeHtml(clubName || clubId) : (clubName || clubId)}"
                   style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.35);
                          border:1px solid rgba(255,255,255,0.18);border-radius:8px;
                          padding:0.55rem 0.7rem;color:white;font-size:0.9rem;outline:none;">

            <div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1.1rem;">
                <button id="sa-season-cancel"
                    style="padding:0.55rem 1.1rem;background:rgba(255,255,255,0.06);
                           border:1px solid rgba(255,255,255,0.18);border-radius:8px;
                           color:#c9d1d9;font-size:0.85rem;cursor:pointer;font-weight:700;">
                    Cancelar
                </button>
                <button id="sa-season-go"
                    style="padding:0.55rem 1.2rem;background:#ff5858;border:none;border-radius:8px;
                           color:white;font-size:0.85rem;cursor:pointer;font-weight:800;">
                    🧹 Vaciar
                </button>
            </div>
        </div>`;

    const cerrar = () => { modal.style.display = 'none'; modal.innerHTML = ''; };
    document.getElementById('sa-season-cancel').onclick = cerrar;

    document.getElementById('sa-season-go').onclick = async () => {
        // Confirmación por nombre exacto. Es la única barrera contra el clic
        // accidental en una acción sin deshacer, así que se compara el texto
        // tal cual: sin normalizar mayúsculas ni acentos a propósito.
        const escrito = (document.getElementById('sa-season-confirm')?.value || '').trim();
        if (escrito !== String(clubName || clubId).trim()) {
            alert('El nombre no coincide. No se ha borrado nada.');
            return;
        }
        const cols = Array.from(document.querySelectorAll('.sa-season-col'))
            .filter(c => c.checked).map(c => c.value);
        if (!cols.length) { alert('No has elegido nada que borrar.'); return; }

        // ══════════════════════════════════════════════════════════════
        //  v572 · P2 · COLECCIONES ACOMPAÑANTES (no se eligen a mano)
        // ══════════════════════════════════════════════════════════════
        //  `live_index` es el espejo ligero de `live_matches`: mismo id, mismo
        //  clubId, y existe sólo para que la lista en vivo no descargue los
        //  partidos enteros. NO se ofrece como casilla propia a propósito —
        //  "Índices" no significa nada para quien vacía una temporada, y dejar
        //  que se pudiera desmarcar por separado sólo permite un estado
        //  incoherente: partidos borrados con sus tarjetas todavía en la lista.
        //  Se arrastra con su titular, en silencio.
        const ACOMPANANTES = { live_matches: ['live_index'] };
        cols.forEach(c => {
            (ACOMPANANTES[c] || []).forEach(extra => {
                if (cols.indexOf(extra) === -1) cols.push(extra);
            });
        });

        cerrar();
        if (typeof _saShowSpinner === 'function') _saShowSpinner('Vaciando la temporada…');
        try {
            const { db, doc, deleteDoc, collection, getDocs, query, where } = await saFS();
            const resumen = [];

            for (const col of cols) {
                let n = 0, fallos = 0;
                try {
                    // ⚠️ SIEMPRE acotado por clubId. Sin este where se borrarían
                    // los datos de todos los clubes de la plataforma.
                    const snap = await getDocs(query(collection(db, col), where('clubId', '==', clubId)));
                    const ids = [];
                    snap.forEach(d => ids.push(d.id));
                    // En tandas: miles de promesas simultáneas contra la cuota
                    // acaban en errores de recurso agotado y borrados a medias.
                    for (let i = 0; i < ids.length; i += 400) {
                        await Promise.all(ids.slice(i, i + 400).map(id =>
                            deleteDoc(doc(db, col, id)).then(() => { n++; }).catch(() => { fallos++; })));
                    }
                } catch (e) {
                    console.warn('[seasonReset] ' + col + ':', e && e.message);
                    fallos++;
                }
                resumen.push(`${col}: ${n} borrado(s)` + (fallos ? ` · ${fallos} fallo(s)` : ''));
            }

            if (typeof _saHideSpinner === 'function') _saHideSpinner();
            console.log('[seasonReset] ' + clubId + '\n  ' + resumen.join('\n  '));
            const totalFallos = resumen.filter(r => r.includes('fallo')).length;
            if (typeof _saToast === 'function') {
                _saToast((totalFallos ? '⚠️ Temporada vaciada con incidencias: ' : '✅ Temporada vaciada: ')
                       + resumen.join(' · ') + (totalFallos ? ' — mira la consola' : ''), 9000);
            }
            if (typeof saTab === 'function') saTab('clubs');
        } catch (e) {
            if (typeof _saHideSpinner === 'function') _saHideSpinner();
            if (typeof _saToast === 'function') _saToast('❌ Error al vaciar: ' + e.message, 6000);
            console.error('[seasonReset]', e);
        }
    };
};
