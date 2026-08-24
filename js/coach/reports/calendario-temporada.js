// ════════════════════════════════════════════════════════════════════
//  📅 CALENDARIO DE TEMPORADA · ALMACÉN, PANTALLA Y ENGANCHE (v609)
//  js/coach/reports/calendario-temporada.js
// ════════════════════════════════════════════════════════════════════
//
//  QUÉ ES. La otra mitad de la funcionalidad que pidió el autor el
//  2026-08-23: arrastrar el PDF oficial de la federación, revisarlo, y que
//  los partidos de toda la temporada aparezcan solos en el Cuadrante
//  semanal del club, verde en casa y naranja fuera.
//
//  La INTERPRETACIÓN vive aparte, en `calendario-parser.js` (lógica pura,
//  ejecutable en Node y por tanto vigilada de verdad por un guard). Aquí
//  está lo que toca el mundo: Firestore, pdf.js, el DOM y el cuadrante.
//
//  ── 🔑 DÓNDE VIVE EL DATO, Y POR QUÉ AHÍ ────────────────────────────
//        trainingPlans/{clubId}/weeks/CALENDARIO__{YYYY-MM}   ← 11 docs
//        trainingPlans/{clubId}/weeks/CALENDARIO__INDICE      ← 1 doc
//
//  Documentos HERMANOS del cuadrante (`CUADRANTE__{fecha}`), en la misma
//  colección. Dos razones, y ninguna es comodidad:
//
//   1. 🔑 CERO REGLAS NUEVAS. `match /trainingPlans/{clubId}/weeks/{weekKey}`
//      ya da read+create+update a todo el club y `{weekKey}` es comodín:
//      acepta `CALENDARIO__2026-09` igual que una fecha. Cualquier otra
//      ubicación caería en el `allow read, write: if false` del final y
//      obligaría a desplegar reglas — que en este proyecto NO SE PUEDEN
//      PROBAR antes, porque testeo comparte base de datos y reglas con
//      producción. Es la misma decisión que hizo posible el cuadrante.
//   2. 🔑 `TrainingSync.deleteWeek()` borra `weeks/{weekKey}` EXACTO, y
//      'CALENDARIO__2026-09' no es igual a ninguna fecha de semana. El
//      calendario queda fuera del alcance de ese borrado.
//
//  ── ⚠️ POR QUÉ 11 DOCUMENTOS Y NO UNO DE TEMPORADA ──────────────────
//  Firestore NO manda deltas: leer un documento de temporada de 60 KB
//  costaría 60 KB CADA VEZ que el director pasa de semana en el cuadrante.
//  Un mes son unos 6 KB y una semana toca UN documento (dos si cae a
//  caballo del cambio de mes). Es la misma lección que ya costó un disgusto
//  con los partidos en vivo.
//
//  ── 🔴 LO QUE EL CALENDARIO NO PUEDE HACER: PISAR AL DIRECTOR ────────
//  Decisión expresa del autor: "si el calendario oficial arroja un partido
//  en una celda que ya hubiera sido modificada a mano, el sistema debe
//  respetar el cambio manual y mostrar un aviso, dándole prioridad al
//  criterio del coordinador".
//
//  Por eso el calendario NUNCA escribe en `celdas`. Se PROPONE encima de la
//  parrilla (casilla con borde punteado y su 📅), y sólo se convierte en
//  casilla de verdad cuando alguien pulsa FIJAR o la abre y la guarda. Dos
//  consecuencias que importan:
//   · Navegar por 30 semanas no crea 30 documentos a la espalda del usuario.
//   · Un partido propuesto NO cuenta como ocupación del campo hasta que se
//     fija: el informe que se le manda al Ayuntamiento no puede llevar
//     suposiciones de un PDF que nadie ha confirmado.
// ════════════════════════════════════════════════════════════════════

// ── Rutas y constantes ───────────────────────────────────────────────
const CAL_PREFIJO = 'CALENDARIO__';
const CAL_INDICE  = CAL_PREFIJO + 'INDICE';
// Agosto → junio. Julio no: no hay competición y sería un documento vacío.
const CAL_MESES_TEMPORADA = [8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];

const CAL_PDFJS     = 'js/vendor/pdfjs/pdf.min.js';
const CAL_PDFJS_WRK = 'js/vendor/pdfjs/pdf.worker.min.js';

window._calState = window._calState || {
    cache: {},        // '<clubId>|<mes>' → { partidos, ts }
    indice: null,     // documento índice en memoria
    imp: null,        // importación en curso (líneas, resultado, filas editadas)
};

// ── Utilidades ───────────────────────────────────────────────────────
function _calE(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : s);
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _calA(s) { return _calE(s).replace(/'/g, '&#39;'); }
function _calToast(m, ms) { if (typeof showToast === 'function') showToast(m, ms || 3500); }

async function _calFS() {
    if (typeof _sdFS === 'function') return _sdFS();
    const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...m, db: window._cronos_auth && window._cronos_auth.db };
}

function _calClubId() {
    const me = window._cronosCurrentUser || {};
    return window._testRoleClubId || me.clubId || '';
}

function _calMesDe(fecha) { return String(fecha || '').slice(0, 7); }
function _calDocId(mes)   { return CAL_PREFIJO + mes; }

// Los 11 meses de una temporada que arranca en `inicio` (agosto de ese año).
function _calMesesDe(inicio) {
    return CAL_MESES_TEMPORADA.map(m => (m >= 7 ? inicio : inicio + 1) + '-' + String(m).padStart(2, '0'));
}

// ════════════════════════════════════════════════════════════════════
//  LECTURA
// ════════════════════════════════════════════════════════════════════
async function _calLeerMes(clubId, mes) {
    const clave = clubId + '|' + mes;
    const c = window._calState.cache[clave];
    // La caché es de sesión y se invalida al escribir. Sin ella, pasar de
    // semana en el cuadrante releería el mismo documento del mes una y otra
    // vez: exactamente el coste que el diseño de 11 documentos evita.
    if (c) return c.partidos;
    try {
        const fs = await _calFS();
        const snap = await fs.getDoc(fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', _calDocId(mes)));
        const p = snap.exists() ? ((snap.data() || {}).partidos || {}) : {};
        window._calState.cache[clave] = { partidos: p, ts: Date.now() };
        return p;
    } catch (e) {
        console.warn('[Calendario] no se pudo leer el mes ' + mes + ':', e && e.message ? e.message : e);
        // ⚠️ Un fallo leyendo el calendario NO puede tumbar el cuadrante: el
        // cuadrante funcionaba antes de que esto existiera y tiene que seguir
        // funcionando si esto falla. Se devuelve vacío y no se cachea.
        return {};
    }
}

async function _calLeerIndice(clubId) {
    if (window._calState.indice) return window._calState.indice;
    try {
        const fs = await _calFS();
        const snap = await fs.getDoc(fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', CAL_INDICE));
        const d = snap.exists() ? (snap.data() || {}) : {};
        window._calState.indice = { v: 1, equipos: d.equipos || {}, perfiles: d.perfiles || {} };
    } catch (e) {
        console.warn('[Calendario] no se pudo leer el índice:', e && e.message ? e.message : e);
        window._calState.indice = { v: 1, equipos: {}, perfiles: {} };
    }
    return window._calState.indice;
}

// ════════════════════════════════════════════════════════════════════
//  🔗 LO QUE CONSUME EL CUADRANTE
// ════════════════════════════════════════════════════════════════════
//  Devuelve los partidos de la semana del lunes dado, con la MISMA clave que
//  usan las casillas del cuadrante: '<filaId>|<YYYY-MM-DD>'. Que la clave sea
//  idéntica es lo que permite cruzarlos sin traducir nada.
//
//  Una semana toca uno o dos meses. Nunca más.
// ════════════════════════════════════════════════════════════════════
window.calPartidosDeSemana = async function (clubId, lunes) {
    if (!clubId || !lunes) return {};
    const fechas = [];
    for (let i = 0; i < 7; i++) {
        const f = new Date(lunes); f.setDate(lunes.getDate() + i);
        fechas.push(f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0'));
    }
    const meses = Array.from(new Set(fechas.map(_calMesDe)));
    const porMes = {};
    for (const m of meses) porMes[m] = await _calLeerMes(clubId, m);

    const salida = {};
    fechas.forEach(fecha => {
        const p = porMes[_calMesDe(fecha)] || {};
        Object.keys(p).forEach(filaId => {
            const dia = p[filaId] && p[filaId][fecha];
            if (dia) salida[filaId + '|' + fecha] = dia;
        });
    });
    return salida;
};

// ¿Hay calendario cargado para este equipo? Lo usa la pantalla de gestión.
window.calResumenEquipo = async function (clubId, filaId) {
    const idx = await _calLeerIndice(clubId);
    return (idx.equipos && idx.equipos[filaId]) || null;
};

// ════════════════════════════════════════════════════════════════════
//  ESCRITURA
// ════════════════════════════════════════════════════════════════════
//  ⚠️ SE LEE, SE MODIFICA Y SE ESCRIBE EL MES ENTERO (`merge:false`).
//
//  No es pereza: `partidos` es un MAPA y Firestore FUSIONA mapas. Con
//  `merge:true`, reimportar un calendario corregido —una jornada aplazada que
//  ya no se juega ese día— dejaría la fecha vieja dentro para siempre, y el
//  equipo aparecería con DOS partidos el mismo fin de semana. Reemplazar el
//  documento es la única forma de que quitar signifique quitar.
//
//  ⚠️ La ventana entre leer y escribir es de milisegundos y el que importa es
//  una persona sola delante de una pantalla. Si dos directores importaran dos
//  equipos exactamente a la vez, el segundo ganaría; se asume a conciencia
//  antes que montar transacciones para un caso que no se da.
// ════════════════════════════════════════════════════════════════════
async function _calEscribirTemporada(clubId, filaId, porMes, mesesAnteriores) {
    const fs = await _calFS();
    const me = window._cronosCurrentUser || {};
    const ahora = new Date().toISOString();

    // Los meses a tocar son los NUEVOS más los que este equipo ocupaba antes:
    // si el calendario corregido ya no tiene partidos en octubre, hay que
    // entrar en octubre a BORRAR los que había.
    const meses = Array.from(new Set(Object.keys(porMes).concat(mesesAnteriores || [])));

    for (const mes of meses) {
        const ref = fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', _calDocId(mes));
        let actual = {};
        try {
            const snap = await fs.getDoc(ref);
            if (snap.exists()) actual = snap.data() || {};
        } catch (e) { actual = {}; }

        const partidos = actual.partidos && typeof actual.partidos === 'object' ? actual.partidos : {};
        if (porMes[mes] && Object.keys(porMes[mes]).length) partidos[filaId] = porMes[mes];
        else delete partidos[filaId];

        await fs.setDoc(ref, {
            v: 1, mes, partidos,
            actualizado: ahora,
            actualizadoPor: me.uid || '',
            actualizadoPorNombre: me.firstName || me.displayName || me.email || '',
        }, { merge: false });

        delete window._calState.cache[clubId + '|' + mes];
    }
}

async function _calEscribirIndice(clubId, filaId, datos) {
    const fs = await _calFS();
    const idx = await _calLeerIndice(clubId);
    if (datos) idx.equipos[filaId] = datos;
    else delete idx.equipos[filaId];
    await fs.setDoc(fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', CAL_INDICE),
        { v: 1, equipos: idx.equipos, perfiles: idx.perfiles, actualizado: new Date().toISOString() },
        { merge: false });
    window._calState.indice = idx;
}

// ════════════════════════════════════════════════════════════════════
//  📄 LECTURA DEL PDF
// ════════════════════════════════════════════════════════════════════
//  ⚠️ pdf.js SE CARGA CUANDO SE ARRASTRA UN PDF, NUNCA AL ARRANCAR, y NO
//  entra en la lista de precarga del Service Worker. Son 1,5 MB entre la
//  biblioteca y su worker: `cache.addAll` es ATÓMICO, así que un fichero
//  grande que falle al descargar tumbaría la instalación de TODA la caché y
//  dejaría la app sin shell. Al ir por `_networkFirst`, el Service Worker lo
//  guarda solo después de la primera descarga: se cachea igual, pero sin
//  poder romper nada.
//
//  ⛔ Y ALOJADO EN EL PROYECTO, NO EN UN CDN. Traerlo de un CDN externo ya
//  costó una reversión completa en este proyecto.
// ════════════════════════════════════════════════════════════════════
let _calPdfJsPromesa = null;

function _calCargarPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (_calPdfJsPromesa) return _calPdfJsPromesa;
    _calPdfJsPromesa = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CAL_PDFJS + '?v=' + (window.CRONOS_VERSION || 'v609');
        s.onload = () => {
            if (!window.pdfjsLib) { reject(new Error('pdf.js cargó pero no se registró')); return; }
            try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = CAL_PDFJS_WRK; } catch (e) { /* seguirá sin worker */ }
            resolve(window.pdfjsLib);
        };
        s.onerror = () => { _calPdfJsPromesa = null; reject(new Error('no se pudo cargar el lector de PDF')); };
        document.head.appendChild(s);
    });
    return _calPdfJsPromesa;
}

// Devuelve { lineas, meta, paginas }. `lineas` ya viene ordenado y agrupado.
async function _calLeerPdf(file) {
    const lib = await _calCargarPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf, disableFontFace: true }).promise;

    let meta = {};
    try {
        const info = await pdf.getMetadata();
        meta = (info && info.info) || {};
    } catch (e) { meta = {}; }

    const fragmentos = [];
    const tope = Math.min(pdf.numPages, 40);   // un calendario no tiene 200 páginas
    for (let n = 1; n <= tope; n++) {
        const page = await pdf.getPage(n);
        const tc = await page.getTextContent();
        tc.items.forEach(it => {
            if (!it || !it.str) return;
            const tr = it.transform || [1, 0, 0, 1, 0, 0];
            fragmentos.push({ str: it.str, x: tr[4], y: tr[5], w: it.width || 0, pagina: n });
        });
    }
    const lineas = window.CalParser.agruparEnLineas(fragmentos);
    return { lineas, meta, paginas: pdf.numPages, texto: lineas.map(l => l.texto).join('\n') };
}

// ════════════════════════════════════════════════════════════════════
//  🖥️ PANTALLA · GESTOR DE CALENDARIOS
// ════════════════════════════════════════════════════════════════════
function _calOverlay(titulo, cuerpo, botones, ancho) {
    window.calCerrar();
    const ov = document.createElement('div');
    ov.id = 'cal-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147482100;background:rgba(0,0,0,0.75);' +
        'display:flex;align-items:center;justify-content:center;padding:1rem;';
    ov.innerHTML =
        '<div style="width:min(96vw,' + (ancho || 720) + 'px);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;' +
             'background:#161b22;border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.6);">' +
            '<div style="padding:0.9rem 1.1rem;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;gap:0.6rem;">' +
                '<div style="font-size:0.9rem;font-weight:800;color:white;">' + titulo + '</div>' +
                '<button onclick="calCerrar()" style="background:none;border:none;color:#8b949e;font-size:1.2rem;cursor:pointer;line-height:1;">✕</button>' +
            '</div>' +
            '<div id="cal-cuerpo" style="flex:1;overflow-y:auto;padding:1rem 1.1rem;">' + cuerpo + '</div>' +
            '<div id="cal-pie" style="padding:0.8rem 1.1rem;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:0.5rem;justify-content:flex-end;flex-wrap:wrap;">' + botones + '</div>' +
        '</div>';
    ov.addEventListener('click', ev => { if (ev.target === ov) window.calCerrar(); });
    document.body.appendChild(ov);
}

window.calCerrar = function () {
    const ov = document.getElementById('cal-overlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
};

// Lista de equipos con su estado de calendario.
window.calAbrirGestor = async function () {
    const clubId = _calClubId();
    const st = window._cqState;
    if (!clubId || !st || !st.doc) { _calToast('⚠️ Abre primero el cuadrante.'); return; }

    _calOverlay('📅 Calendarios oficiales de la temporada',
        '<div style="text-align:center;padding:2rem;color:var(--text-muted);">⏳ Cargando…</div>', '');

    const idx = await _calLeerIndice(clubId);
    // Sólo los equipos que este usuario VE: un coordinador de F7 no gestiona
    // los calendarios de F11 (misma regla que ya rige la parrilla).
    const filas = (typeof window._cqFilasVisibles === 'function')
        ? window._cqFilasVisibles(st.doc.filas) : st.doc.filas;
    const equipos = filas.filter(f => f.tipo === 'equipo');

    let html = '<div style="font-size:0.74rem;color:var(--text-muted);line-height:1.6;margin-bottom:0.9rem;">' +
        'Arrastra aquí el PDF oficial de cada subcategoría. La app lo interpreta, te enseña la tabla para que la ' +
        'revises y sólo entonces guarda la temporada. Los partidos aparecerán solos en el cuadrante al cambiar de semana.</div>';

    if (!equipos.length) {
        html += '<div style="text-align:center;padding:2rem;color:var(--text-muted);">No hay equipos en el cuadrante todavía.</div>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:0.4rem;">';
        equipos.forEach(f => {
            const info = idx.equipos[f.id];
            const hay = info && info.jornadas;
            html += '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;' +
                        'border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:0.55rem 0.75rem;">' +
                '<div style="flex:1;min-width:150px;">' +
                    '<div style="font-size:0.8rem;font-weight:700;color:white;">' + _calE(f.label) + '</div>' +
                    '<div style="font-size:0.68rem;color:' + (hay ? '#3fb950' : 'var(--text-muted)') + ';">' +
                        (hay ? '✅ ' + info.jornadas + ' partidos · ' + _calE(info.competicion || 'temporada importada')
                             : 'Sin calendario') +
                    '</div>' +
                '</div>' +
                '<button class="btn" onclick="calAbrirImportador(\'' + _calA(f.id) + '\',\'' + _calA(f.label) + '\')" ' +
                    'style="padding:0.35rem 0.8rem;font-size:0.7rem;font-weight:700;background:rgba(88,166,255,0.15);' +
                    'border:1px solid rgba(88,166,255,0.4);color:#58a6ff;">' + (hay ? '🔄 Reimportar' : '📥 Importar') + '</button>' +
                (hay ? '<button class="btn" onclick="calBorrarEquipo(\'' + _calA(f.id) + '\',\'' + _calA(f.label) + '\')" ' +
                    'style="padding:0.35rem 0.7rem;font-size:0.7rem;font-weight:700;background:rgba(248,81,73,0.10);' +
                    'border:1px solid rgba(248,81,73,0.35);color:#f85149;">🗑️</button>' : '') +
            '</div>';
        });
        html += '</div>';

        // 📤 La salida. Sólo se ofrece si hay algo que sacar: un botón que no
        //    puede hacer nada es peor que no tenerlo (misma regla que v472).
        if (equipos.some(f => idx.equipos[f.id] && idx.equipos[f.id].jornadas)) {
            html += '<div style="margin-top:0.9rem;padding-top:0.8rem;border-top:1px solid rgba(255,255,255,0.08);">' +
                '<button class="btn" onclick="calAbrirExportador()" ' +
                    'style="padding:0.4rem 0.9rem;font-size:0.72rem;font-weight:700;' +
                    'background:rgba(63,185,80,0.12);border:1px solid rgba(63,185,80,0.4);color:#3fb950;">' +
                    '📤 Exportar la temporada (CSV / PDF)</button></div>';
        }
    }

    const cuerpo = document.getElementById('cal-cuerpo');
    if (cuerpo) cuerpo.innerHTML = html;
};

// ── Paso 1 · arrastrar el PDF (o pegar el texto) ─────────────────────
window.calAbrirImportador = function (filaId, label) {
    window._calState.imp = { filaId, label, lineas: null, res: null, meta: {}, origen: '' };

    const cuerpo =
        '<div id="cal-drop" ' +
            'style="border:2px dashed rgba(88,166,255,0.45);border-radius:14px;padding:2rem 1rem;text-align:center;' +
                   'background:rgba(88,166,255,0.05);cursor:pointer;transition:background 0.15s;">' +
            '<div style="font-size:2.2rem;line-height:1;margin-bottom:0.5rem;">📄</div>' +
            '<div style="font-size:0.86rem;font-weight:700;color:#58a6ff;">Arrastra aquí el PDF de la federación</div>' +
            '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.35rem;">o pulsa para elegirlo · ' +
                _calE(label) + '</div>' +
            '<input type="file" id="cal-file" accept="application/pdf,.pdf" style="display:none;">' +
        '</div>' +
        '<div id="cal-estado" style="margin-top:0.7rem;font-size:0.74rem;color:var(--text-muted);text-align:center;"></div>' +
        // ── Plan B ──────────────────────────────────────────────────
        //  Elección expresa del autor. Un PDF escaneado es una imagen: no
        //  tiene una sola letra que extraer, y sin esta salida ese día el
        //  usuario se queda bloqueado sin alternativa ninguna.
        '<details style="margin-top:1rem;">' +
            '<summary style="cursor:pointer;font-size:0.75rem;color:#8b949e;">' +
                '¿El PDF no se deja leer? Pega aquí el calendario copiado de la web</summary>' +
            '<textarea id="cal-texto" rows="7" placeholder="Pega el calendario tal cual: una línea por partido, o con las jornadas en cabecera." ' +
                'style="width:100%;margin-top:0.5rem;background:#0d1117;color:white;border:1px solid rgba(255,255,255,0.15);' +
                       'border-radius:8px;padding:0.6rem;font-size:0.72rem;font-family:monospace;resize:vertical;"></textarea>' +
            '<button class="btn" onclick="calInterpretarTexto()" style="margin-top:0.4rem;padding:0.35rem 0.8rem;font-size:0.7rem;' +
                   'font-weight:700;background:rgba(210,168,255,0.12);border:1px solid rgba(210,168,255,0.4);color:#d2a8ff;">' +
                   '📝 Interpretar el texto</button>' +
        '</details>';

    _calOverlay('📥 Importar calendario · ' + _calE(label), cuerpo,
        '<button class="btn" onclick="calAbrirGestor()" style="padding:0.4rem 0.9rem;font-size:0.72rem;">← Volver</button>', 620);

    _calEngancharArrastre();
};

function _calEngancharArrastre() {
    const zona = document.getElementById('cal-drop');
    const input = document.getElementById('cal-file');
    if (!zona || !input) return;

    zona.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files && input.files[0]) _calProcesarPdf(input.files[0]); });

    // ⚠️ HAY QUE CANCELAR dragover Y dragenter. Si sólo se cancela uno, el
    // navegador sigue con su comportamiento por defecto y ABRE EL PDF en la
    // pestaña: la sesión se pierde y el usuario vuelve a la pantalla de login
    // sin entender por qué. Es la misma familia de trampa que el `<a download>`
    // con blob en iOS.
    ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation();
        zona.style.background = 'rgba(88,166,255,0.16)';
    }));
    ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, e => {
        e.preventDefault(); e.stopPropagation();
        zona.style.background = 'rgba(88,166,255,0.05)';
    }));
    zona.addEventListener('drop', e => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) _calProcesarPdf(f);
    });
}

// El mismo guard también en la ventana: soltar un PDF FUERA de la zona lo
// abriría igualmente y tiraría la sesión.
if (typeof document !== 'undefined' && !window._calGuardVentana) {
    window._calGuardVentana = true;
    ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, e => {
        if (document.getElementById('cal-overlay')) e.preventDefault();
    }));
}

function _calEstado(txt, color) {
    const el = document.getElementById('cal-estado');
    if (el) el.innerHTML = '<span style="color:' + (color || 'var(--text-muted)') + ';">' + txt + '</span>';
}

async function _calProcesarPdf(file) {
    if (!file) return;
    if (!/pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        _calEstado('⚠️ Eso no es un PDF. Arrastra el calendario oficial en PDF.', '#f0883e');
        return;
    }
    _calEstado('⏳ Cargando el lector de PDF…');
    try {
        const r = await _calLeerPdf(file);
        if (!r.lineas.length) {
            // 🔑 EL CASO DEL PDF ESCANEADO, DICHO CON TODAS LAS LETRAS. Un
            // "no se han encontrado partidos" a secas haría pensar que la app
            // está rota; lo que pasa es que ese PDF es una fotografía.
            _calEstado('⚠️ Este PDF no contiene texto: es una imagen escaneada, así que no hay nada que leer.<br>' +
                       'Usa la opción de pegar el texto, aquí abajo.', '#f0883e');
            return;
        }
        _calEstado('✅ ' + r.lineas.length + ' líneas leídas de ' + r.paginas + ' página(s). Interpretando…', '#3fb950');
        // Se recuerda para el diagnóstico: "3 partidos de 1 página" y "3 de 5"
        // no describen el mismo fallo ni de lejos.
        window._calState.imp.paginas = r.paginas;
        _calInterpretarYRevisar(r.lineas, r.meta, file.name);
    } catch (e) {
        _calEstado('⚠️ No se ha podido leer el PDF: ' + _calE(e && e.message ? e.message : e) +
                   '<br>Prueba a pegar el texto aquí abajo.', '#f85149');
    }
}

window.calInterpretarTexto = function () {
    const ta = document.getElementById('cal-texto');
    const txt = ta ? ta.value : '';
    if (!txt.trim()) { _calToast('⚠️ Pega antes el calendario.'); return; }
    _calInterpretarYRevisar(window.CalParser.lineasDeTexto(txt), {}, 'texto pegado');
};

function _calNombresDelClub() {
    const me = window._cronosCurrentUser || {};
    return [me.clubName, me.clubNombre, me.club].filter(Boolean);
}

function _calInterpretarYRevisar(lineas, meta, origen) {
    const imp = window._calState.imp;
    if (!imp) return;
    imp.lineas = lineas;
    imp.meta   = meta || {};
    imp.origen = origen || '';
    imp.huella = window.CalParser.huellaDe(imp.meta, lineas);

    // 🧠 Si esta federación ya se importó antes, se arranca con lo aprendido:
    // el nombre con el que el club aparece en SUS documentos.
    const idx = window._calState.indice || { perfiles: {} };
    const perfil = idx.perfiles && idx.perfiles[imp.huella];
    const nombres = _calNombresDelClub();
    if (perfil && perfil.nombrePropio) nombres.unshift(perfil.nombrePropio);

    imp.res = window.CalParser.interpretar(lineas, {
        misNombres: nombres,
        inicioTemporada: window.CalParser.temporadaDe(new Date()),
    });
    imp.perfilUsado = !!(perfil && perfil.nombrePropio);
    imp.correcciones = 0;
    _calPintarRevision();
}

// ════════════════════════════════════════════════════════════════════
//  ✅ PASO 2 · LA TABLA DE REVISIÓN
// ════════════════════════════════════════════════════════════════════
//  La condición que permite poner un parser heurístico en manos de un club
//  desconocido: NADA se escribe sin que una persona haya visto esto.
//
//  Verde = puedes pasar de largo. Amarillo = míralo. Rojo = tienes que
//  tocarlo. Si esa nota mintiera, la tabla dejaría de servir y el usuario
//  acabaría revisándolo todo (y no la usaría) o nada (y guardaría basura).
// ════════════════════════════════════════════════════════════════════
function _calPintarRevision() {
    const imp = window._calState.imp;
    const res = imp && imp.res;
    if (!res) return;
    const r = res.resumen;

    const chip = (n, color, txt) => !n ? '' :
        '<span style="display:inline-block;font-size:0.68rem;font-weight:700;color:' + color + ';' +
        'background:rgba(255,255,255,0.04);border:1px solid ' + color + '55;border-radius:20px;padding:0.1rem 0.5rem;">' +
        n + ' ' + txt + '</span>';

    let html = '<div style="display:flex;gap:0.35rem;flex-wrap:wrap;align-items:center;margin-bottom:0.7rem;">' +
        chip(r.verde, '#3fb950', 'listos') + chip(r.amarillo, '#d4b106', 'a revisar') +
        chip(r.rojo, '#f85149', 'con problemas') +
        chip(r.casa, '#3fb950', 'en casa') + chip(r.fuera, '#f0883e', 'fuera') +
        (r.ajenas ? chip(r.ajenas, '#8b949e', 'de otros equipos, descartados') : '') +
        (r.sinFecha ? chip(r.sinFecha, '#f85149', 'sin fecha legible') : '') +
        '</div>' +
        // 🔴 v612 · EL SILENCIO ERA EL PROBLEMA. Cuando el motor encontraba
        // dos equipos pero ninguna fecha que supiera leer, la línea se caía
        // sin dejar rastro: el usuario veía tres partidos de una temporada de
        // treinta y no tenía forma de saber si el PDF era malo, si la app
        // estaba rota, o qué. Ahora se dice, se dice CUÁNTAS, y se dice qué
        // hacer. Un fallo que se puede describir es un fallo que se arregla.
        (r.sinFecha ? '<div style="font-size:0.7rem;color:#f0883e;line-height:1.6;margin:-0.3rem 0 0.7rem;' +
            'background:rgba(240,136,62,0.07);border:1px solid rgba(240,136,62,0.3);border-radius:8px;padding:0.5rem 0.65rem;">' +
            '⚠️ Hay <b>' + r.sinFecha + '</b> línea' + (r.sinFecha === 1 ? '' : 's') + ' con dos equipos a la que no se le ' +
            'ha encontrado fecha, así que no se ' + (r.sinFecha === 1 ? 'ha podido colocar' : 'han podido colocar') + '. ' +
            'Suele pasar cuando el PDF pone la fecha en una columna que se lee aparte. ' +
            'Prueba a pegar el calendario como texto en el paso anterior, o avisa para revisar este formato.' +
            '</div>' : '');

    // ── Quién soy en este documento ─────────────────────────────────
    //  Si el motor no está seguro, esto es LO PRIMERO que hay que resolver:
    //  de ello dependen el rival y el casa/fuera de las 34 jornadas.
    const p = res.propio;
    const seguro = p.via === 'nombre-del-club';
    html += '<div style="border:1px solid ' + (seguro ? 'rgba(63,185,80,0.3)' : 'rgba(212,177,6,0.45)') + ';' +
                'background:rgba(' + (seguro ? '63,185,80' : '212,177,6') + ',0.07);border-radius:10px;' +
                'padding:0.55rem 0.75rem;margin-bottom:0.8rem;font-size:0.73rem;line-height:1.55;">' +
        (p.nombre
            ? (seguro ? '✅' : '🟡') + ' En este calendario tu equipo aparece como <strong>' + _calE(p.nombre) + '</strong>' +
              (seguro ? '' : ' <em>(deducido: es el que juega todas las jornadas)</em>') + '. '
            : '🟡 No he podido identificar a tu equipo en este documento. ') +
        '<button onclick="calCambiarPropio()" style="background:none;border:none;color:#58a6ff;cursor:pointer;' +
            'text-decoration:underline;font-size:0.73rem;padding:0;">No es ése, elegir otro</button>' +
        (imp.perfilUsado ? '<div style="color:#d2a8ff;font-size:0.68rem;margin-top:0.25rem;">🧠 Aplicado lo aprendido de una importación anterior de esta federación.</div>' : '') +
        '</div>';

    if (!res.filas.length) {
        html += '<div style="text-align:center;padding:2rem;color:#f0883e;line-height:1.7;">' +
            '⚠️ No he reconocido ningún partido en este documento.<br>' +
            '<span style="font-size:0.75rem;color:var(--text-muted);">Puede que sea un PDF escaneado, o que tenga un ' +
            'maquetado que no sé leer. Prueba con la opción de pegar el texto.</span></div>';
        _calCuerpo(html, '<button class="btn" onclick="calAbrirImportador(\'' + _calA(imp.filaId) + '\',\'' + _calA(imp.label) + '\')" style="padding:0.4rem 0.9rem;font-size:0.72rem;">← Probar otro</button>');
        return;
    }

    html += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.71rem;min-width:560px;">' +
        '<thead><tr style="color:var(--text-muted);text-align:left;">' +
            '<th style="padding:0.3rem 0.25rem;">J</th><th style="padding:0.3rem 0.25rem;">Fecha</th>' +
            '<th style="padding:0.3rem 0.25rem;">Hora</th><th style="padding:0.3rem 0.25rem;">Rival</th>' +
            '<th style="padding:0.3rem 0.25rem;">Dónde</th><th style="padding:0.3rem 0.25rem;">Campo / sede</th>' +
            '<th></th></tr></thead><tbody>';

    const col = { verde: '#3fb950', amarillo: '#d4b106', rojo: '#f85149' };
    const inp = (i, campo, valor, ancho, tipo) =>
        '<input type="' + (tipo || 'text') + '" value="' + _calE(valor || '') + '" ' +
        'oninput="calEditar(' + i + ',\'' + campo + '\',this.value)" ' +
        'style="width:' + ancho + ';background:#0d1117;color:white;border:1px solid rgba(255,255,255,0.12);' +
               'border-radius:5px;padding:0.2rem 0.3rem;font-size:0.71rem;">';

    res.filas.forEach((f, i) => {
        html += '<tr style="border-top:1px solid rgba(255,255,255,0.06);">' +
            '<td style="padding:0.25rem;border-left:3px solid ' + col[f.confianza] + ';">' + inp(i, 'jornada', f.jornada, '2.6em') + '</td>' +
            '<td style="padding:0.25rem;">' + inp(i, 'fecha', f.fecha, '8.5em', 'date') + '</td>' +
            '<td style="padding:0.25rem;">' + inp(i, 'hora', f.hora, '5.2em', 'time') + '</td>' +
            '<td style="padding:0.25rem;">' + inp(i, 'rival', f.rival, '100%') + '</td>' +
            '<td style="padding:0.25rem;">' +
                '<select onchange="calEditar(' + i + ',\'local\',this.value)" ' +
                    'style="background:#0d1117;color:white;border:1px solid rgba(255,255,255,0.12);border-radius:5px;' +
                           'padding:0.2rem;font-size:0.71rem;">' +
                    '<option value=""' + (f.local == null ? ' selected' : '') + '>— ¿?</option>' +
                    '<option value="1"' + (f.local === true ? ' selected' : '') + '>🏠 Casa</option>' +
                    '<option value="0"' + (f.local === false ? ' selected' : '') + '>🚌 Fuera</option>' +
                '</select></td>' +
            '<td style="padding:0.25rem;">' + inp(i, 'sede', f.sede, '100%') + '</td>' +
            '<td style="padding:0.25rem;text-align:right;">' +
                '<button onclick="calQuitarFila(' + i + ')" title="Quitar esta fila" ' +
                    'style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:0.8rem;">✕</button></td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';

    html += '<div style="margin-top:0.7rem;font-size:0.7rem;color:var(--text-muted);line-height:1.6;">' +
        'Corrige lo que haga falta y pulsa Guardar. Se escribirán <strong>' + res.filas.length + '</strong> partidos ' +
        'de <strong>' + _calE(imp.label) + '</strong>' +
        (r.rojo ? ' — las filas con la barra roja no se guardarán hasta que estén completas.' : '.') +
        '</div>';

    const pie =
        '<button class="btn" onclick="calAbrirImportador(\'' + _calA(imp.filaId) + '\',\'' + _calA(imp.label) + '\')" ' +
            'style="padding:0.4rem 0.9rem;font-size:0.72rem;">← Otro archivo</button>' +
        // 🔎 v613 · LA VÍA PARA QUE UN FORMATO DESCONOCIDO SE PUEDA ARREGLAR.
        //  Este motor es heurístico y va a encontrarse maquetados que no
        //  entiende. Sin esto, el único canal para diagnosticarlos es que el
        //  usuario describa por escrito lo que ve —y una descripción no lleva
        //  las COORDENADAS, que es justo el dato que decide dónde están las
        //  columnas. Este botón copia lo que el motor leyó de verdad.
        '<button class="btn" onclick="calCopiarDiagnostico()" title="Copia lo que la app ha leído del PDF, para poder diagnosticar un formato que no se interpreta bien" ' +
            'style="padding:0.4rem 0.9rem;font-size:0.72rem;background:rgba(210,168,255,0.10);' +
            'border:1px solid rgba(210,168,255,0.35);color:#d2a8ff;">🔎 Copiar diagnóstico</button>' +
        '<button class="btn" onclick="calGuardarTemporada()" style="padding:0.4rem 1rem;font-size:0.72rem;font-weight:700;' +
            'background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.45);color:#3fb950;">💾 Guardar la temporada</button>';

    _calCuerpo(html, pie);
}

// ════════════════════════════════════════════════════════════════════
//  🔎 v613 · DIAGNÓSTICO DE UN PDF QUE NO SE INTERPRETA BIEN
// ════════════════════════════════════════════════════════════════════
//  Qué lleva, y por qué cada cosa:
//   · Los CONTADORES — cuántas filas se cayeron y por qué motivo. Distinguir
//     "no se le encontró fecha" de "no se pudo partir en dos equipos" de "es
//     de otro equipo del grupo" señala tres arreglos completamente distintos.
//   · Las CALLES detectadas por página: si salen 0, el documento no es una
//     tabla —o sus columnas no se están viendo—, y ahí está el fallo.
//   · Las primeras filas CON SUS COORDENADAS. Una descripción escrita nunca
//     lleva la geometría, y la geometría es lo que decide dónde está cada
//     columna. Esto es lo que convierte "sólo salen 3" en algo medible.
//
//  ⚠️ Sólo va el calendario: nombres de club, fechas y campos, que son
//  públicos. Ni una línea de datos personales.
// ════════════════════════════════════════════════════════════════════
window.calCopiarDiagnostico = function () {
    const imp = window._calState.imp;
    if (!imp || !imp.res) { _calToast('⚠️ No hay ninguna interpretación que diagnosticar.'); return; }
    const res = imp.res, r = res.resumen || {}, lineas = imp.lineas || [];

    const L = [];
    L.push('DIAGNOSTICO CALENDARIO · ' + (window.CRONOS_VERSION || 'v613'));
    L.push('equipo: ' + (imp.label || '') + '   origen: ' + (imp.origen || '?'));
    L.push('paginas: ' + (imp.paginas || '?') + '   lineas: ' + lineas.length);
    L.push('propio: ' + JSON.stringify(res.propio || {}));
    L.push('candidatos: ' + JSON.stringify((res.candidatos || []).slice(0, 5)));
    L.push('resumen: ' + JSON.stringify(r));
    L.push('CAIDAS -> sinPar:' + (r.sinPar || 0) + '  sinFecha:' + (r.sinFecha || 0) +
           '  ajenas:' + (r.ajenas || 0));

    // Las calles por página: el dato que dice si la tabla se está viendo.
    try {
        const modelo = window.CalParser.modeloDeColumnas(lineas);
        L.push('calles: ' + JSON.stringify(modelo));
    } catch (e) { L.push('calles: (no se pudieron calcular) ' + (e && e.message)); }

    L.push('--- PRIMERAS LINEAS (texto | fragmentos x,ancho) ---');
    lineas.slice(0, 40).forEach((l, i) => {
        const geo = (l.items || []).map(it =>
            String(it.str).slice(0, 22) + '@' + Math.round(it.x) + ',' + Math.round(it.w || 0)
        ).join(' | ');
        L.push('p' + (l.pagina || 1) + ' #' + i + '  ' + l.texto);
        if (geo) L.push('        ' + geo);
    });

    const txt = L.join('\n');
    const listo = () => _calToast('🔎 Diagnóstico copiado. Pégalo en el chat para que se pueda revisar.', 5000);
    // ⚠️ `navigator.clipboard` no existe fuera de HTTPS ni en navegadores
    // viejos, y aquí fallar en silencio dejaría al usuario sin la única vía
    // de reportar el formato. Siempre hay plan B: el texto a la vista.
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(listo, () => _calVerDiagnostico(txt));
            return;
        }
    } catch (e) { /* al plan B */ }
    _calVerDiagnostico(txt);
};

function _calVerDiagnostico(txt) {
    _calCuerpo(
        '<div style="font-size:0.74rem;color:var(--text-muted);margin-bottom:0.5rem;">' +
        'No se ha podido copiar solo. Selecciona todo este texto y pégalo en el chat:</div>' +
        '<textarea readonly rows="18" onclick="this.select()" ' +
            'style="width:100%;background:#0d1117;color:#c9d1d9;border:1px solid rgba(255,255,255,0.15);' +
            'border-radius:8px;padding:0.6rem;font-size:0.68rem;font-family:monospace;">' +
            _calE(txt) + '</textarea>',
        '<button class="btn" onclick="_calVolverRevision()" style="padding:0.4rem 0.9rem;font-size:0.72rem;">← Volver</button>');
}

function _calCuerpo(html, pie) {
    const c = document.getElementById('cal-cuerpo'), p = document.getElementById('cal-pie');
    if (!c) { _calOverlay('📅 Revisar el calendario', html, pie || '', 860); return; }
    // La revisión necesita más sitio que la lista: se reabre más ancha.
    const caja = c.parentNode;
    if (caja && caja.style) caja.style.width = 'min(96vw,860px)';
    c.innerHTML = html;
    if (p) p.innerHTML = pie || '';
}

window.calEditar = function (i, campo, valor) {
    const res = window._calState.imp && window._calState.imp.res;
    if (!res || !res.filas[i]) return;
    const f = res.filas[i];
    if (campo === 'local') f.local = (valor === '' ? null : valor === '1');
    else if (campo === 'jornada') f.jornada = valor === '' ? null : parseInt(valor, 10);
    else f[campo] = valor;
    delete f.jornadaSupuesta;              // si la toca una persona, ya no es una suposición
    window._calState.imp.correcciones++;
    // ⚠️ NO se repinta la tabla entera: el usuario está escribiendo dentro de
    // un input y repintar le movería el cursor a otro sitio a mitad de palabra.
    // Sólo se recalcula el color de SU fila y los contadores de arriba.
    _calRefrescarFila(i);
};

function _calRefrescarFila(i) {
    const res = window._calState.imp.res;
    const f = res.filas[i];
    const antes = f.confianza;
    f.confianza = (!f.fecha || !f.rival || f.local == null) ? 'rojo'
                : (!f.hora || !f.jornada) ? 'amarillo' : 'verde';
    if (antes === f.confianza) return;
    const col = { verde: '#3fb950', amarillo: '#d4b106', rojo: '#f85149' };
    const tds = document.querySelectorAll('#cal-cuerpo tbody tr');
    if (tds[i]) {
        const primera = tds[i].querySelector('td');
        if (primera) primera.style.borderLeft = '3px solid ' + col[f.confianza];
    }
}

window.calQuitarFila = function (i) {
    const res = window._calState.imp && window._calState.imp.res;
    if (!res) return;
    res.filas.splice(i, 1);
    window._calState.imp.correcciones++;
    _calPintarRevision();
};

// Elegir a mano cuál de los equipos del documento es el nuestro, y
// reinterpretarlo TODO con esa respuesta. Sin volver a leer el PDF.
window.calCambiarPropio = function () {
    const imp = window._calState.imp;
    if (!imp || !imp.res) return;
    const cands = imp.res.candidatos || [];
    let html = '<div style="font-size:0.75rem;color:var(--text-muted);line-height:1.6;margin-bottom:0.7rem;">' +
        'Estos son los equipos que aparecen en el documento. Pulsa el tuyo: se recalculan el rival y el ' +
        'casa/fuera de todas las jornadas.</div>';
    if (!cands.length) {
        html += '<div style="color:#f0883e;font-size:0.75rem;">No he reconocido ningún nombre de equipo en el documento.</div>';
    } else {
        html += '<div style="display:flex;flex-direction:column;gap:0.3rem;">';
        cands.forEach(c => {
            html += '<button onclick="calFijarPropio(\'' + _calA(c.nombre) + '\')" ' +
                'style="text-align:left;padding:0.45rem 0.7rem;border-radius:8px;cursor:pointer;font-size:0.76rem;' +
                       'background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.28);color:white;">' +
                '<strong>' + _calE(c.nombre) + '</strong> ' +
                '<span style="color:var(--text-muted);font-size:0.68rem;">· sale en el ' + c.cobertura + '% de las jornadas</span>' +
                '</button>';
        });
        html += '</div>';
    }
    _calCuerpo(html, '<button class="btn" onclick="_calVolverRevision()" style="padding:0.4rem 0.9rem;font-size:0.72rem;">← Volver</button>');
};
window._calVolverRevision = _calPintarRevision;

window.calFijarPropio = function (nombre) {
    const imp = window._calState.imp;
    if (!imp || !imp.lineas) return;
    imp.res = window.CalParser.reinterpretarCon(imp.lineas, {
        inicioTemporada: window.CalParser.temporadaDe(new Date()),
    }, nombre);
    imp.correcciones++;
    imp.propioElegido = nombre;
    _calToast('✅ Recalculado con «' + nombre + '».');
    _calPintarRevision();
};

// ── Paso 3 · guardar ─────────────────────────────────────────────────
window.calGuardarTemporada = async function () {
    const imp = window._calState.imp;
    const clubId = _calClubId();
    if (!imp || !imp.res || !clubId) return;

    // Las filas incompletas NO se guardan: un partido sin fecha o sin saber
    // si es en casa no se puede pintar en ninguna celda, y guardarlo a medias
    // sólo serviría para que el director lo descubriera en enero.
    const buenas = imp.res.filas.filter(f => f.fecha && f.rival && f.local != null);
    const fuera  = imp.res.filas.length - buenas.length;
    if (!buenas.length) { _calToast('⚠️ No hay ninguna fila completa que guardar.', 4500); return; }
    if (fuera && !confirm(fuera + ' fila(s) están incompletas y NO se guardarán.\n\n¿Guardar las ' + buenas.length + ' restantes?')) return;

    const porMes = {};
    buenas.forEach(f => {
        const mes = _calMesDe(f.fecha);
        if (!porMes[mes]) porMes[mes] = {};
        porMes[mes][f.fecha] = {
            jornada: f.jornada == null ? null : f.jornada,
            rival:   String(f.rival || '').slice(0, 60),
            local:   !!f.local,
            hora:    f.hora || '',
            sede:    String(f.sede || '').slice(0, 80),
        };
    });

    if (typeof showSpinner === 'function') showSpinner('Guardando la temporada…');
    try {
        const idx = await _calLeerIndice(clubId);
        const antes = (idx.equipos[imp.filaId] && idx.equipos[imp.filaId].meses) || [];
        await _calEscribirTemporada(clubId, imp.filaId, porMes, antes);

        // 🧠 El perfil aprendido. Lo más valioso que se lleva de aquí es cómo
        // se llama este club en los documentos de ESTA federación: es lo que
        // hará que el siguiente PDF suyo salga ya resuelto.
        const nombrePropio = imp.propioElegido || (imp.res.propio && imp.res.propio.nombre) || '';
        if (imp.huella && nombrePropio) {
            const prev = idx.perfiles[imp.huella];
            idx.perfiles[imp.huella] = {
                nombrePropio,
                correcciones: imp.correcciones || 0,
                usos: (prev && prev.usos ? prev.usos : 0) + 1,
                actualizado: new Date().toISOString(),
            };
        }
        await _calEscribirIndice(clubId, imp.filaId, {
            jornadas: buenas.length,
            meses: Object.keys(porMes),
            huella: imp.huella || '',
            nombrePropio,
            origen: imp.origen || '',
            importado: new Date().toISOString(),
        });

        if (typeof hideSpinner === 'function') hideSpinner();
        _calToast('✅ Calendario guardado: ' + buenas.length + ' partidos de ' + imp.label + '.', 5000);
        window.calCerrar();
        // El cuadrante tiene que enterarse ya: si no, el director no vería su
        // partido hasta cambiar de semana y volver.
        if (typeof window._sdRecargarCuadrante === 'function') window._sdRecargarCuadrante();
    } catch (e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        _calToast('⚠️ No se pudo guardar: ' + (e && e.message ? e.message : e), 6000);
    }
};

window.calBorrarEquipo = async function (filaId, label) {
    const clubId = _calClubId();
    if (!clubId) return;
    if (!confirm('¿Borrar el calendario completo de «' + label + '»?\n\nLos partidos ya FIJADOS en el cuadrante no se tocan: sólo se quita el calendario oficial.')) return;
    if (typeof showSpinner === 'function') showSpinner('Borrando…');
    try {
        const idx = await _calLeerIndice(clubId);
        const meses = (idx.equipos[filaId] && idx.equipos[filaId].meses) || _calMesesDe(window.CalParser.temporadaDe(new Date()));
        await _calEscribirTemporada(clubId, filaId, {}, meses);
        await _calEscribirIndice(clubId, filaId, null);
        if (typeof hideSpinner === 'function') hideSpinner();
        _calToast('🗑️ Calendario de ' + label + ' borrado.');
        window.calAbrirGestor();
        if (typeof window._sdRecargarCuadrante === 'function') window._sdRecargarCuadrante();
    } catch (e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        _calToast('⚠️ No se pudo borrar: ' + (e && e.message ? e.message : e), 5000);
    }
};

// ════════════════════════════════════════════════════════════════════
//  📤 SACAR LA TEMPORADA · CSV y PDF, por equipo y de todo el club
// ════════════════════════════════════════════════════════════════════
//  El calendario anual tenía TRES vías de entrada (el PDF de la federación,
//  pegar el texto y editar a mano) y NINGUNA de salida. Esto es la salida.
//
//  🔑 NO SE ESCRIBE UN EXPORTADOR: se enchufa el que ya existe.
//  `js/coach/reports/reports-export.js` lleva desde v473 resolviendo las dos
//  cosas que aquí importan y que no son evidentes:
//    · `rxDescargarCSV` escribe en **UTF-16LE**, porque el Excel del autor
//      IGNORÓ el BOM de UTF-8 —que es opcional— y le abrió el fichero con
//      todas las tildes rotas, leyendo los bytes como Windows-1252.
//      (El ejemplo literal está en reports-export.js; aquí no se copia, que
//       este fichero tiene un guard de mojibake y saltaría con razón.)
//    · `rxImprimir` abre el documento imprimible sin librería alguna, con el
//      `print-color-adjust: exact` sin el cual el navegador tira los fondos.
//  Duplicar cualquiera de las dos sería reabrir un caso ya cerrado.
//
//  ⚠️⚠️ EL GESTO DEL USUARIO ES EL EJE DEL DISEÑO. En iPad y móvil el fichero
//  se entrega con `navigator.share`, que EXIGE un gesto y lo pierde si antes
//  te vas a leer de Firestore. Por eso esto va en DOS PASOS: al abrir la
//  ventana se lee la temporada entera y se deja EN MEMORIA, y sólo entonces se
//  pintan los botones. Cuando el usuario pulsa, el fichero se construye sin
//  esperar a nadie y la entrega ocurre dentro de su clic.
// ════════════════════════════════════════════════════════════════════

window._calExp = window._calExp || null;   // temporada ya leída y lista

// Filas planas de un equipo, ordenadas por fecha. Los campos son los que
// guarda el importador: jornada, hora, rival, local, sede.
function _calFilasDe(partidosPorMes, filaId, label) {
    const filas = [];
    Object.keys(partidosPorMes).forEach(mes => {
        const delEquipo = (partidosPorMes[mes] || {})[filaId] || {};
        Object.keys(delEquipo).forEach(fecha => {
            const d = delEquipo[fecha] || {};
            filas.push({
                equipo: label, fecha: fecha, jornada: d.jornada || '',
                hora: d.hora || '', rival: d.rival || '',
                local: d.local === true ? 'Casa' : (d.local === false ? 'Fuera' : ''),
                esCasa: d.local === true, esFuera: d.local === false,
                sede: d.sede || ''
            });
        });
    });
    return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.hora).localeCompare(String(b.hora)));
}

// Lee de una vez todos los meses que ocupan los equipos visibles.
async function _calLeerTemporadaCompleta(clubId, equipos, idx) {
    const meses = new Set();
    equipos.forEach(f => {
        const info = idx.equipos[f.id];
        const suyos = (info && info.meses) ||
            _calMesesDe(window.CalParser.temporadaDe(new Date()));
        suyos.forEach(m => meses.add(m));
    });
    const porMes = {};
    for (const m of meses) porMes[m] = await _calLeerMes(clubId, m);
    return porMes;
}

// ── Paso 1 · abrir la ventana: aquí se lee, y sólo aquí ──────────────
window.calAbrirExportador = async function () {
    const clubId = _calClubId();
    const st = window._cqState;
    if (!clubId || !st || !st.doc) { _calToast('⚠️ Abre primero el cuadrante.'); return; }
    if (typeof window.rxCsv !== 'function' || typeof window.rxImprimir !== 'function') {
        // Un botón que no puede hacer nada es peor que no tenerlo (v472).
        _calToast('⚠️ El módulo de exportación no está disponible.', 4500); return;
    }

    _calOverlay('📤 Exportar la temporada',
        '<div style="text-align:center;padding:2rem;color:var(--text-muted);">⏳ Leyendo la temporada…</div>', '');

    const idx = await _calLeerIndice(clubId);
    const filas = (typeof window._cqFilasVisibles === 'function')
        ? window._cqFilasVisibles(st.doc.filas) : st.doc.filas;
    const equipos = filas.filter(f => f.tipo === 'equipo');
    const porMes = await _calLeerTemporadaCompleta(clubId, equipos, idx);

    // 🔑 TODO QUEDA EN MEMORIA ANTES DE PINTAR UN SOLO BOTÓN.
    const bloques = equipos
        .map(f => ({ filaId: f.id, label: f.label, filas: _calFilasDe(porMes, f.id, f.label) }))
        .filter(b => b.filas.length);
    window._calExp = { club: (window._cronosCurrentUser || {}).clubName || 'Club', bloques: bloques };

    const total = bloques.reduce((n, b) => n + b.filas.length, 0);
    let html = '<div style="font-size:0.74rem;color:var(--text-muted);line-height:1.6;margin-bottom:0.9rem;">' +
        'El <strong>CSV</strong> se abre en Excel o en cualquier hoja de cálculo. El <strong>PDF</strong> sale con el ' +
        'código de color del club: <span style="color:#3fb950;font-weight:700;">verde en casa</span>, ' +
        '<span style="color:#f0883e;font-weight:700;">naranja fuera</span>.' +
        (_calExpTactil() ? '<br>En tableta y móvil se abrirá el menú de <strong>Compartir</strong> para que puedas ' +
                           'guardarlo en Archivos o enviarlo.' : '') +
        '</div>';

    if (!total) {
        html += '<div style="text-align:center;padding:2rem;color:var(--text-muted);">' +
                'Todavía no hay ningún calendario importado.</div>';
    } else {
        html += '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.9rem;">' +
            _calExpBoton('📊 CSV · todo el club', "calExportarCSV('')", '#3fb950') +
            _calExpBoton('🖨️ PDF · todo el club', "calExportarPDF('')", '#58a6ff') +
            '</div><div style="display:flex;flex-direction:column;gap:0.4rem;">';
        bloques.forEach(b => {
            html += '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;' +
                        'border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:0.55rem 0.75rem;">' +
                '<div style="flex:1;min-width:150px;">' +
                    '<div style="font-size:0.8rem;font-weight:700;color:white;">' + _calE(b.label) + '</div>' +
                    '<div style="font-size:0.68rem;color:var(--text-muted);">' + b.filas.length + ' partidos</div>' +
                '</div>' +
                _calExpBoton('📊 CSV', "calExportarCSV('" + _calA(b.filaId) + "')", '#3fb950') +
                _calExpBoton('🖨️ PDF', "calExportarPDF('" + _calA(b.filaId) + "')", '#58a6ff') +
            '</div>';
        });
        html += '</div>';
    }

    const cuerpo = document.getElementById('cal-cuerpo');
    if (cuerpo) cuerpo.innerHTML = html;
};

function _calExpTactil() {
    try {
        return (navigator.maxTouchPoints || 0) > 0 &&
               typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    } catch (e) { return false; }
}

function _calExpBoton(txt, accion, color) {
    return '<button class="btn" onclick="' + accion + '" style="padding:0.35rem 0.8rem;font-size:0.7rem;' +
        'font-weight:700;background:' + color + '1a;border:1px solid ' + color + '66;color:' + color + ';">' +
        txt + '</button>';
}

// Los bloques a exportar: uno solo, o todos si `filaId` viene vacío.
function _calExpBloques(filaId) {
    const est = window._calExp;
    if (!est || !est.bloques.length) return null;
    return filaId ? est.bloques.filter(b => b.filaId === filaId) : est.bloques;
}

// ── Paso 2 · el clic. Sin esperas: los datos ya están ────────────────
window.calExportarCSV = function (filaId) {
    const bloques = _calExpBloques(filaId);
    if (!bloques || !bloques.length) { _calToast('⚠️ No hay nada que exportar.'); return; }

    // La columna EQUIPO va siempre, también en el CSV de un solo equipo: así
    // dos exportaciones distintas se pueden apilar en la misma hoja.
    const filas = [['Equipo', 'Jornada', 'Fecha', 'Hora', 'Rival', 'Casa/Fuera', 'Sede']];
    bloques.forEach(b => b.filas.forEach(f => {
        filas.push([f.equipo, f.jornada, f.fecha, f.hora, f.rival, f.local, f.sede]);
    }));

    const ambito = filaId ? bloques[0].label : (window._calExp.club + '_completo');
    const nombre = 'calendario_' + window.rxSlug(ambito) + '_' + window.rxHoy() + '.csv';
    if (window.rxDescargarCSV(nombre, window.rxCsv(filas))) {
        _calToast('📊 ' + (filas.length - 1) + ' partidos exportados.');
    }
};

window.calExportarPDF = function (filaId) {
    const bloques = _calExpBloques(filaId);
    if (!bloques || !bloques.length) { _calToast('⚠️ No hay nada que exportar.'); return; }

    // 🎨 EL COLOR ES EL DATO (verde casa / naranja fuera), no un adorno: por eso
    //    va además la palabra. Si una impresora en blanco y negro se come el
    //    color, el documento tiene que seguir diciendo dónde se juega.
    let cuerpo = '';
    bloques.forEach(b => {
        cuerpo += '<h2 style="font-size:13px;margin:14px 0 6px;">' + _calE(b.label) +
                  ' <span style="font-weight:400;color:#57606a;">· ' + b.filas.length + ' partidos</span></h2>' +
            '<table style="width:100%;border-collapse:collapse;font-size:10px;">' +
            '<thead><tr style="background:#f0f3f6;">' +
            ['Jor.', 'Fecha', 'Hora', 'Rival', 'Dónde', 'Sede']
                .map(h => '<th style="border:1px solid #d0d7de;padding:3px 5px;text-align:left;">' + h + '</th>').join('') +
            '</tr></thead><tbody>';
        b.filas.forEach(f => {
            const color = f.esCasa ? '#1a7f37' : (f.esFuera ? '#bc4c00' : '#57606a');
            const td = (v, extra) => '<td style="border:1px solid #d0d7de;padding:3px 5px;' + (extra || '') + '">' +
                                     _calE(v == null ? '' : String(v)) + '</td>';
            cuerpo += '<tr>' + td(f.jornada) + td(f.fecha) + td(f.hora) + td(f.rival) +
                '<td style="border:1px solid #d0d7de;padding:3px 5px;font-weight:700;color:' + color + ';">' +
                    _calE(f.local || '—') + '</td>' +
                td(f.sede) + '</tr>';
        });
        cuerpo += '</tbody></table>';
    });

    const ambito = filaId ? bloques[0].label : 'Todos los equipos';
    const total = bloques.reduce((n, b) => n + b.filas.length, 0);
    window.rxImprimir({
        titulo: 'Calendario de la temporada',
        subtitulo: ambito,
        meta: [window._calExp.club, total + ' partidos'],
        cuerpo: cuerpo
    });
};

