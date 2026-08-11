// ════════════════════════════════════════════════════════════════════
//  js/coach/reports/reports-export.js
//  DESCARGA de lo que ya se ve en la pestaña "Informes" del Panel de
//  Dirección: el "Resumen acumulado de la temporada" y los informes
//  grupales (colectivos) de cada partido, en PDF y en CSV/Excel.
//
//  QUIÉN LO USA: los botones que pinta js/coach/reports/reports-tab.js.
//  Ese archivo es el único que conoce los datos (window._sdMatchData y las
//  filas del acumulador); este módulo NO los busca ni los toca — recibe
//  todo por argumento. Es a propósito y NO se debe "mejorar" leyendo los
//  globales del panel, por dos razones:
//    1. scripts/test_reports_tab_module.js (aserción 1d) exige fan-in
//       EXTERNO = 0 sobre _sdMatchData / sdToggleReport / sdDeleteReport /
//       _sdLoadReports: nombrarlos aquí pondría ese guard en rojo.
//    2. sin globales, el módulo entero se prueba en un sandbox con un
//       window/document de mentira (scripts/test_reports_export.js).
//
//  ⚠️ TAMPOCO NOMBRA `_RP`. El informe grupal en PDF necesita el HTML que
//  genera el motor (report-engine.js), pero quien lo llama YA lo tiene en
//  la mano y lo pasa hecho. scripts/test_report_engine_module.js (aserción
//  1e) mantiene una lista CERRADA de consumidores de _RP; añadir uno nuevo
//  la rompería sin aportar nada.
//
//  ── PDF SIN DEPENDENCIAS ────────────────────────────────────────────
//  No hay jsPDF ni html2canvas: se abre una ventana con el documento ya
//  maquetado y se lanza `window.print()`, que en cualquier navegador ofrece
//  "Guardar como PDF". Es el mismo camino que ya usa
//  js/admin/superadmin/billing.js para las facturas.
//
//  🔑 EL DOCUMENTO ES CLARO (fondo blanco) PERO EL INFORME GRUPAL VA EN SU
//  PANEL OSCURO. No es un capricho estético: el HTML del motor de informes
//  trae los colores EN LÍNEA y pensados para fondo #0d1117 (texto blanco,
//  barras del Gantt translúcidas sobre oscuro). Volcarlo en una hoja blanca
//  lo deja literalmente ilegible —blanco sobre blanco— y no hay forma de
//  recolorearlo desde fuera sin reescribir el motor. Por eso el papel es
//  blanco (cabecera, pie y tablas se leen e imprimen bien) y el informe
//  viaja dentro de una tarjeta oscura que reproduce su lienzo.
//
//  🔑 Y POR ESO `print-color-adjust: exact` ES OBLIGATORIO: sin esa regla el
//  navegador descarta los fondos al imprimir "para ahorrar tinta" y la
//  tarjeta oscura sale blanca, con su texto blanco dentro. El resultado no
//  da ningún error: simplemente se descarga un PDF con páginas en blanco.
//
//  🔑 EL MOTOR DE INFORMES USA `var(--text-muted)`, que vive en style.css y
//  la ventana nueva NO carga. Se redefinen las variables de :root aquí
//  dentro; sin ellas ese texto sale con el color por defecto del navegador.
//
//  ── CSV QUE EXCEL ABRE A LA PRIMERA ─────────────────────────────────
//  🔑 Separador PUNTO Y COMA, no coma. Excel en configuración regional
//  española usa la coma como separador DECIMAL y abre los .csv con `;`;
//  con comas mete la fila entera en una sola columna y el usuario cree que
//  la descarga está rota. Google Sheets y LibreOffice detectan los dos.
//  🔑🔑 Y EL ARCHIVO SE ESCRIBE EN UTF-16LE. La primera versión iba en UTF-8
//  con BOM —lo correcto según el manual— y el Excel del autor lo abrió con
//  las tildes rotas igualmente. El BOM de UTF-8 se puede ignorar; el de
//  UTF-16 no. Todo el razonamiento está sobre _rxUtf16le, con el reporte y
//  la comprobación que descartó la hipótesis del BOM ausente.
//
//  ⚠️ El <a> se ADJUNTA AL DOM antes del click: un `a.click()` suelto no
//  dispara la descarga en Firefox (ya pagado en individual-reports.js).
//
//  Cubierto por scripts/test_reports_export.js.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // Separador de campos del CSV. Ver la nota de la cabecera: con coma,
    // Excel en español no separa las columnas.
    const RX_SEP = ';';

    // ── Escapado seguro con fallback (escapeHtml suele estar en app-init.js) ──
    function _rxEsc(s) {
        if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : s);
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _rxToast(msg, ms) {
        if (typeof showToast === 'function') showToast(msg, ms || 3000);
    }

    // Nombre de archivo utilizable en Windows, macOS y Android.
    window.rxSlug = function (s) {
        return String(s == null ? '' : s)
            .replace(/[\\/:*?"<>|]/g, '')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .slice(0, 60) || 'chronos';
    };

    // Fecha corta para el nombre del archivo: 2026-08-08.
    window.rxHoy = function () {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    };

    // ── CSV ──────────────────────────────────────────────────────────
    // Toda celda va entrecomillada: así un nombre con `;` o con salto de
    // línea no parte la fila. Las comillas internas se duplican.
    function _rxCell(v) {
        return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    }

    // rxCsv(filas2D) → texto CSV con CRLF (lo que espera Excel).
    window.rxCsv = function (filas) {
        return (filas || [])
            .map(function (f) { return (f || []).map(_rxCell).join(RX_SEP); })
            .join('\r\n');
    };

    // ── 🔑🔑 EL CSV SE ESCRIBE EN UTF-16LE, NO EN UTF-8 ──────────────
    //  REPORTE REAL DEL AUTOR (2026-08-08, captura 8561): Excel en español le
    //  abrió el CSV con las tildes rotas — `CompeticiÃ³n`, `CategorÃ­a`,
    //  `LesiÃ³n`—, o sea leyendo bytes UTF-8 como Windows-1252.
    //
    //  ⚠️ NO ERA QUE FALTARA EL BOM. Se comprobó sobre los BYTES del Blob, no
    //  sobre la cadena: el archivo empezaba por `EF BB BF` y los acentos iban
    //  bien codificados. El BOM de UTF-8 estaba y su Excel lo IGNORÓ, que es
    //  algo conocido en Excel para Mac/iOS y en algunas compilaciones.
    //
    //  🔑 UTF-16LE NO SE PUEDE IGNORAR. Su BOM (`FF FE`) es OBLIGATORIO para
    //  leer el archivo: un lector que lo pase por alto no obtiene texto
    //  plausible en otra página de códigos, obtiene basura evidente. Por eso no
    //  existe el fallback silencioso a Windows-1252 que nos ha mordido aquí.
    //  Es, además, lo que escribe el propio Excel al guardar "Texto Unicode".
    //
    //  🔑 EL SEPARADOR SE QUEDA EN `;` Y NO SE TOCA: en su captura las columnas
    //  SÍ salían separadas —leía celdas sueltas—, así que el punto y coma ya
    //  acierta con su configuración regional. El fallo era sólo la codificación.
    //
    //  ⚠️ Se codifica a mano y NO con `new Blob(['﻿' + texto])`: el Blob
    //  serializa las cadenas SIEMPRE en UTF-8, así que la única forma de emitir
    //  otra codificación es entregarle los bytes ya hechos.
    function _rxUtf16le(texto) {
        const s = String(texto == null ? '' : texto);
        // 2 bytes de BOM + 2 por unidad de código. `length` cuenta unidades
        // UTF-16, así que los pares suplentes (emoji) se copian tal cual.
        const bytes = new Uint8Array(2 + s.length * 2);
        bytes[0] = 0xFF; bytes[1] = 0xFE;
        for (let i = 0; i < s.length; i++) {
            const c = s.charCodeAt(i);
            bytes[2 + i * 2] = c & 0xFF;        // LE: primero el byte bajo
            bytes[3 + i * 2] = (c >> 8) & 0xFF;
        }
        return bytes;
    }

    // rxDescargarCSV(nombre, texto) → dispara la descarga. Devuelve true/false
    // para que quien llame pueda avisar si no se pudo.
    window.rxDescargarCSV = function (nombre, texto) {
        try {
            const blob = new Blob([_rxUtf16le(texto)], { type: 'text/csv;charset=utf-16le' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = nombre;
            // ⚠️ Adjuntar al DOM ANTES del click: un a.click() suelto no
            // dispara la descarga en Firefox (ya pagado en individual-reports.js).
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // ⚠️ El revoke va DIFERIDO. La descarga que arranca el click es
            // asíncrona: revocar la URL en la misma vuelta del bucle de eventos
            // puede dejarla a medias en Chrome/Edge con archivos grandes.
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            return true;
        } catch (e) {
            _rxToast('⚠️ No se pudo descargar: ' + (e && e.message ? e.message : e), 4000);
            return false;
        }
    };

    // ── DOCUMENTO IMPRIMIBLE ─────────────────────────────────────────
    const RX_CSS =
        '@page { size: A4 SIZE; margin: 12mm 10mm; }' +
        // Ver la cabecera: sin esto los fondos desaparecen al imprimir y la
        // tarjeta del informe sale blanca con texto blanco dentro.
        '*,*::before,*::after{-webkit-print-color-adjust:exact;print-color-adjust:exact;' +
            'color-adjust:exact;box-sizing:border-box;}' +
        // Variables que el motor de informes da por hechas (viven en
        // style.css, que esta ventana no carga).
        ':root{--primary:#58a6ff;--secondary:#f0883e;--success:#3fb950;--danger:#f85149;' +
            '--text-main:#c9d1d9;--text-muted:#8b949e;--bg-dark:#0d1117;--bg-card:#161b22;' +
            '--glass:rgba(255,255,255,0.05);--glass-border:rgba(255,255,255,0.1);}' +
        'body{margin:0;padding:0 0 24px;background:#ffffff;color:#1a1a2e;' +
            'font-family:"Helvetica Neue",Arial,Helvetica,sans-serif;font-size:12px;}' +
        '.rx-page{max-width:1000px;margin:0 auto;padding:14px 16px;}' +
        '.rx-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;' +
            'padding-bottom:12px;margin-bottom:14px;border-bottom:3px solid #2563eb;}' +
        '.rx-brand{font-size:18px;font-weight:900;color:#2563eb;letter-spacing:-0.4px;}' +
        '.rx-brand-sub{font-size:10px;color:#6b7280;margin-top:2px;}' +
        '.rx-title{font-size:16px;font-weight:800;color:#111827;}' +
        '.rx-sub{font-size:11px;color:#4b5563;margin-top:3px;}' +
        '.rx-meta{text-align:right;font-size:10px;color:#6b7280;line-height:1.6;}' +
        '.rx-block{margin-bottom:18px;page-break-inside:avoid;}' +
        '.rx-block-title{font-size:12px;font-weight:800;color:#2563eb;text-transform:uppercase;' +
            'letter-spacing:0.6px;margin:0 0 6px;}' +
        // Tabla de papel: blanca, con cabecera azul. Nada que ver con la
        // tabla oscura de pantalla (category-tree.js) — ver la cabecera.
        '.rx-tabla{width:100%;border-collapse:collapse;font-size:11px;}' +
        '.rx-tabla th{background:#2563eb;color:#ffffff;padding:6px 8px;text-align:center;' +
            'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;}' +
        '.rx-tabla th.rx-l,.rx-tabla td.rx-l{text-align:left;}' +
        '.rx-tabla td{padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#374151;}' +
        '.rx-tabla tbody tr:nth-child(even){background:#f8fafc;}' +
        '.rx-tabla tfoot td{border-top:2px solid #2563eb;border-bottom:none;font-weight:800;color:#1d4ed8;' +
            'background:#eff6ff;}' +
        '.rx-cero{color:#9ca3af;}' +
        '.rx-dorsal{display:inline-block;min-width:20px;color:#6b7280;font-weight:700;}' +
        '.rx-vacio{padding:10px;font-size:11px;color:#6b7280;background:#f8fafc;border-radius:6px;}' +
        // Lienzo oscuro para el HTML del motor de informes.
        '.rx-lienzo{background:#0d1117;color:#c9d1d9;border-radius:10px;padding:14px 16px;}' +
        '.rx-pie{margin-top:18px;padding-top:10px;border-top:1px solid #e5e7eb;' +
            'font-size:9px;color:#9ca3af;text-align:center;}' +
        '.rx-btn{display:block;margin:18px auto 0;padding:9px 26px;background:#2563eb;color:#fff;' +
            'border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;}' +
        '@media print{.rx-btn{display:none !important;}}';

    // rxImprimir({ titulo, subtitulo, meta[], cuerpo, apaisado }) → bool
    //   cuerpo: HTML ya montado (bloques .rx-block).
    //   Devuelve false si el navegador bloqueó la ventana emergente, que es
    //   el único fallo realista y hay que decírselo al usuario.
    window.rxImprimir = function (opts) {
        opts = opts || {};
        const titulo = opts.titulo || 'Informe · Chronos Fútbol';
        const meta = (opts.meta || []).filter(Boolean)
            .map(function (l) { return '<div>' + _rxEsc(l) + '</div>'; }).join('');

        const doc =
            '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>' + _rxEsc(titulo) + '</title>' +
            '<style>' + RX_CSS.replace('SIZE', opts.apaisado ? 'landscape' : 'portrait') + '</style>' +
            '</head><body><div class="rx-page">' +
                '<div class="rx-head">' +
                    '<div>' +
                        '<div class="rx-brand">⚽ CHRONOS FÚTBOL</div>' +
                        '<div class="rx-brand-sub">Sistema de Gestión Deportiva</div>' +
                        '<div class="rx-title" style="margin-top:10px;">' + _rxEsc(titulo) + '</div>' +
                        (opts.subtitulo ? '<div class="rx-sub">' + _rxEsc(opts.subtitulo) + '</div>' : '') +
                    '</div>' +
                    '<div class="rx-meta">' + meta +
                        '<div>Generado: ' + _rxEsc(new Date().toLocaleString('es-ES')) + '</div>' +
                    '</div>' +
                '</div>' +
                (opts.cuerpo || '') +
                '<div class="rx-pie">Chronos Fútbol · documento generado desde el Panel de Dirección. ' +
                    'Los datos proceden de los informes enviados por los entrenadores.</div>' +
                '<button class="rx-btn" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>' +
            '</div>' +
            // El diálogo se abre solo: el usuario ha pedido "descargar en PDF",
            // no "ver una página". El botón queda como respaldo para cuando el
            // navegador ignora el print automático (Safari en iOS lo hace).
            '<script>window.onload=function(){setTimeout(function(){' +
                'try{window.focus();window.print();}catch(e){}},350);};<\/script>' +
            '</body></html>';

        const w = window.open('', '_blank');
        if (!w) {
            _rxToast('⚠️ Permite las ventanas emergentes para descargar el PDF', 5000);
            return false;
        }
        w.document.open();
        w.document.write(doc);
        w.document.close();
        return true;
    };

    // ── RESUMEN ACUMULADO DE LA TEMPORADA ────────────────────────────
    //  Un "bloque" es un EQUIPO: { equipo, filas, partidos }.
    //  `filas` son las que devuelve window.ctAccumulatePlayerStats:
    //  { number, alias, called, pj, seconds, minutes, goals, yellow, red, injuries }.
    //
    //  ⚠️ Las columnas y su significado se copian de la tabla de pantalla
    //  (js/admin/shared/category-tree.js) A PROPÓSITO, incluida la fila de
    //  totales: PJ del equipo (no la suma de participaciones) y minutos sin
    //  sumar. Si el papel dijera otra cosa que la pantalla, el director
    //  tendría dos verdades para el mismo dato.
    //  ÚNICO añadido: la columna "Conv." (convocatorias), que en pantalla no
    //  cabía y en una hoja de cálculo es justo lo que se quiere cruzar con PJ.
    const RX_COLS = ['Dorsal', 'Jugador', 'Conv.', 'PJ', 'Min', 'Goles', 'Amarillas', 'Rojas', 'Lesiones'];

    function _rxTotales(filas) {
        return (filas || []).reduce(function (t, f) {
            t.goals += f.goals || 0; t.yellow += f.yellow || 0;
            t.red += f.red || 0; t.injuries += f.injuries || 0;
            t.called += f.called || 0;
            return t;
        }, { goals: 0, yellow: 0, red: 0, injuries: 0, called: 0 });
    }

    // rxFilasResumen(bloques) → matriz lista para rxCsv.
    //  Con más de un equipo se anteponen dos columnas (Categoría y Equipo)
    //  para que la hoja se pueda filtrar y ordenar; con uno solo sobran.
    window.rxFilasResumen = function (bloques) {
        bloques = Array.isArray(bloques) ? bloques : [];
        const varios = bloques.length > 1;
        const cab = (varios ? ['Equipo'] : []).concat(RX_COLS);
        const out = [cab];

        bloques.forEach(function (b) {
            const filas = (b && b.filas) || [];
            const pre = varios ? [b.equipo || '—'] : [];
            filas.forEach(function (f) {
                out.push(pre.concat([
                    f.number || '', f.alias || 'Sin nombre',
                    f.called || 0, f.pj || 0, f.minutes || 0, f.goals || 0,
                    f.yellow || 0, f.red || 0, f.injuries || 0,
                ]));
            });
            const t = _rxTotales(filas);
            // La celda de minutos del total va con guion, igual que en
            // pantalla: sumar los minutos de toda la plantilla no significa
            // nada (11 jugadores x 90' = 990' por partido).
            out.push(pre.concat([
                '', 'TOTAL EQUIPO', t.called,
                (typeof b.partidos === 'number' && isFinite(b.partidos)) ? b.partidos : '-',
                '-', t.goals, t.yellow, t.red, t.injuries,
            ]));
        });
        return out;
    };

    // rxTablaResumenHtml(bloque) → tabla de papel de UN equipo.
    window.rxTablaResumenHtml = function (bloque) {
        const b = bloque || {};
        const filas = b.filas || [];
        const titulo = '<div class="rx-block-title">' + _rxEsc(b.equipo || 'Equipo') + '</div>';
        if (!filas.length) {
            return '<div class="rx-block">' + titulo +
                '<div class="rx-vacio">Todavía no hay informes de este equipo, ' +
                'así que no hay acumulado de temporada.</div></div>';
        }
        const cel = function (n) {
            return '<td' + (n ? '' : ' class="rx-cero"') + '>' + _rxEsc(n) + '</td>';
        };
        const cuerpo = filas.map(function (f) {
            return '<tr><td class="rx-l"><span class="rx-dorsal">' + _rxEsc(f.number || '—') + '</span> ' +
                _rxEsc(f.alias || 'Sin nombre') + '</td>' +
                cel(f.called || 0) + cel(f.pj || 0) + cel(f.minutes || 0) + cel(f.goals || 0) +
                cel(f.yellow || 0) + cel(f.red || 0) + cel(f.injuries || 0) + '</tr>';
        }).join('');
        const t = _rxTotales(filas);
        const totPj = (typeof b.partidos === 'number' && isFinite(b.partidos)) ? String(b.partidos) : '-';

        return '<div class="rx-block">' + titulo +
            '<table class="rx-tabla"><thead><tr>' +
                '<th class="rx-l">Jugador</th><th>Conv.</th><th>PJ</th><th>Min</th>' +
                '<th>Goles</th><th>Amarillas</th><th>Rojas</th><th>Lesiones</th>' +
            '</tr></thead><tbody>' + cuerpo + '</tbody>' +
            '<tfoot><tr><td class="rx-l">Total equipo</td><td>' + t.called + '</td>' +
                '<td>' + totPj + '</td><td>-</td><td>' + t.goals + '</td>' +
                '<td>' + t.yellow + '</td><td>' + t.red + '</td><td>' + t.injuries + '</td>' +
            '</tr></tfoot></table>' +
            '<div style="font-size:9px;color:#6b7280;margin-top:4px;">' +
                filas.length + ' jugador' + (filas.length === 1 ? '' : 'es') + ' con informes · ' +
                'PJ del total = partidos disputados por el equipo; los minutos no se suman entre jugadores.' +
            '</div></div>';
    };

    // rxExportarResumenCSV(bloques, meta) — meta = { club, ambito }
    window.rxExportarResumenCSV = function (bloques, meta) {
        meta = meta || {};
        const filas = window.rxFilasResumen(bloques);
        if (filas.length <= 1) { _rxToast('No hay datos que exportar todavía', 3000); return false; }
        const nombre = 'resumen_temporada_' + window.rxSlug(meta.ambito || meta.club || 'club') +
            '_' + window.rxHoy() + '.csv';
        const okDesc = window.rxDescargarCSV(nombre, window.rxCsv(filas));
        if (okDesc) _rxToast('📊 Resumen descargado en CSV', 2500);
        return okDesc;
    };

    // rxExportarResumenPDF(bloques, meta)
    window.rxExportarResumenPDF = function (bloques, meta) {
        meta = meta || {};
        bloques = Array.isArray(bloques) ? bloques : [];
        if (!bloques.length) { _rxToast('No hay datos que exportar todavía', 3000); return false; }
        const cuerpo = bloques.map(window.rxTablaResumenHtml).join('');
        const jugadores = bloques.reduce(function (n, b) { return n + ((b && b.filas) || []).length; }, 0);
        return window.rxImprimir({
            titulo:    'Resumen acumulado de la temporada',
            subtitulo: meta.ambito || '',
            meta: [
                meta.club ? 'Club: ' + meta.club : '',
                bloques.length > 1 ? bloques.length + ' equipos' : '',
                jugadores + ' jugador' + (jugadores === 1 ? '' : 'es') + ' con informes',
            ],
            cuerpo: cuerpo,
        });
    };

    // ── INFORME GRUPAL DE UN PARTIDO ─────────────────────────────────
    //  `m` es el objeto agrupado por partido que arma reports-tab.js
    //  (rival, matchDate, scoreHome/scoreAway, myTeamRole, players[]…).

    // Localía y veredicto SIEMPRE con la misma semántica que la tarjeta de
    // pantalla: sin myTeamRole (informes antiguos) se cae a 'home'. Si esto
    // divergiera, el archivo descargado contradiría al panel.
    function _rxVeredicto(m) {
        const sh = m.scoreHome, sa = m.scoreAway;
        if (sh == null || sa == null) return { marcador: '—', veredicto: '' };
        const mios = m.myTeamRole === 'away' ? sa : sh;
        const suyos = m.myTeamRole === 'away' ? sh : sa;
        return {
            marcador: sh + ' - ' + sa,
            veredicto: mios > suyos ? 'VICTORIA' : mios < suyos ? 'DERROTA' : 'EMPATE',
        };
    }

    window.rxFechaLarga = function (fecha) {
        if (!fecha) return '—';
        // El mediodía evita que un 'YYYY-MM-DD' se interprete en UTC y
        // retroceda un día en husos negativos.
        const d = new Date(String(fecha).length === 10 ? fecha + 'T12:00:00' : fecha);
        return isNaN(d.getTime())
            ? String(fecha)
            : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
    };

    // ── 🔑 LAS INCIDENCIAS, EN ESPAÑOL Y SIN MENTIR ──────────────────
    //  REPORTE DEL AUTOR (2026-08-08): la columna salía en crudo y en inglés
    //  (`02:24 sub_out`, `goal`, `yellow`, `injury`).
    //
    //  Traducir la palabra era lo de menos. Volcar `history` tal cual tiene
    //  DOS defectos que el informe de pantalla ya resolvió y este CSV no:
    //
    //  🔑 1. NO TODO "sub_out" ES UNA SUSTITUCIÓN. La app apunta sola un
    //     "Sale (DESCANSO)" a todos los que están en el campo al llegar el
    //     descanso, un "Entra (2ªP)" a los que salen a la segunda y un
    //     "Sale (FIN)" al terminar. Es contabilidad de fase: el reglamento no
    //     gasta un cambio por pasar por el descanso. En un F7 con 14
    //     convocados eso son 14 "Sale" falsos que ahogan a los sucesos de
    //     verdad — exactamente lo que el motor de informes corrigió en v426.
    //     ⚠️ Y NO SE PUEDE DECIDIR APUNTE A APUNTE: "(DESCANSO)" y "(FIN)" son
    //     inequívocas, pero "(2ªP)" es AMBIGUA — la escribe tanto el apunte
    //     automático como un cambio de verdad hecho en la segunda parte. Se
    //     resuelve POR PAREJA: la automática lleva el MISMO sello de tiempo que
    //     el "Sale (DESCANSO)" de ese jugador (las dos salen de masterTimeH1).
    //     Sin ese "Sale (DESCANSO)", el jugador estaba en el banquillo y su
    //     entrada es real.
    //
    //  🔑 2. HAY SUCESOS QUE SE TIPAN COMO LO QUE NO SON. El parser mira el
    //     TEXTO: un "GOL ANULADO" se tipa 'goal' y una segunda amarilla se tipa
    //     'yellow'. Traducir 'goal' → "Gol" a secas escribiría en un documento
    //     que se imprime y se reparte que hubo un gol que el árbitro anuló, y
    //     dejaría una expulsión por doble amarilla como una simple amonestación.
    //     El matiz sale del texto original del apunte (`note`), igual que en
    //     report-engine.js (v458).
    //
    //  ⚠️ ESTE CRITERIO ES UN ESPEJO del de js/coach/reports/report-engine.js
    //  (`indicesDeFase` / `sucesosReales` y las tres regex de matiz). Está
    //  duplicado, y no por gusto: aquel es un `const _RP` que sólo expone
    //  `build`, y este módulo NO PUEDE nombrarlo (test_report_engine_module.js
    //  aserción 1e mantiene la lista CERRADA de consumidores). Para que las dos
    //  copias no se separen en silencio, scripts/test_reports_export.js compara
    //  los marcadores de los DOS ficheros: si alguien cambia el criterio en el
    //  motor y no aquí, ese guard se pone ROJO.
    //
    //  Y el vocabulario SÍ es propio, no el de la pantalla: allí "TARJETA" se
    //  distingue por COLOR (amarillo o rojo) y en una hoja de cálculo no hay
    //  color, así que hay que decirlo con palabras.
    const RX_SUCESO = {
        goal:    'Gol',
        yellow:  'Tarjeta amarilla',
        red:     'Tarjeta roja',
        injury:  'Lesión',
        sub_in:  'Entra al campo',
        sub_out: 'Sale del campo',
    };

    function _rxNota(e) { return String((e && e.note) || ''); }
    function _rxFaseInequivoca(e) {
        return e.phase === true || /\((?:DESCANSO|FIN)\)/i.test(_rxNota(e));
    }
    function _rxEntraSegundaParte(e) {
        return e.type === 'sub_in' && /\(2[ªº]\s*P\)/i.test(_rxNota(e));
    }
    function _rxClaveT(e) { return (((e.minute || 0) + (e.second || 0) / 60)).toFixed(3); }

    // Deja SÓLO los sucesos reales: fuera la contabilidad de fase.
    function _rxSucesosReales(hist) {
        const evs = (hist || []).filter(function (e) {
            return e && typeof e === 'object' && e.type;
        });
        const subs = evs.filter(function (e) { return e.type === 'sub_in' || e.type === 'sub_out'; });
        const fuera = new Set();
        const tDescanso = new Set();
        subs.forEach(function (e) {
            if (!_rxFaseInequivoca(e)) return;
            fuera.add(e);
            if (/\(DESCANSO\)/i.test(_rxNota(e)) || e.phase === true) tDescanso.add(_rxClaveT(e));
        });
        subs.forEach(function (e) {
            if (_rxEntraSegundaParte(e) && tDescanso.has(_rxClaveT(e))) fuera.add(e);
        });
        return evs.filter(function (e) { return !fuera.has(e); });
    }

    // rxEtiquetaSuceso(e) → el nombre en español, con el matiz que corresponda.
    window.rxEtiquetaSuceso = function (e) {
        if (!e || !e.type) return '';
        const nota = _rxNota(e);
        if (e.type === 'goal'   && /ANULAD/i.test(nota))            return 'Gol anulado';
        if (e.type === 'red'    && /REVERTID|RECTIFIC/i.test(nota)) return 'Roja revertida';
        if (e.type === 'yellow' && /DOBLE\s+AMARILLA/i.test(nota))  return 'Doble amarilla (expulsión)';
        return RX_SUCESO[e.type] || String(e.type);
    };

    // rxIncidencias(p) → "02:24 Sale del campo | 10:00 Gol"
    //  Va todo en UNA celda: son varias líneas y repartirlas en columnas
    //  dejaría una hoja con un ancho distinto por jugador.
    window.rxIncidencias = function (p) {
        const hist = (p && p.history) || [];
        if (!Array.isArray(hist)) return '';
        // Historial ANTIGUO, todavía en crudo: son las cadenas de logEvent, ya
        // en español ("Sale a las 02:24 (1ªP)"). Se dejan tal cual, sólo se
        // descarta la contabilidad de fase, que ahí también sobra.
        const crudas = hist.filter(function (h) { return typeof h === 'string'; })
            .filter(function (h) { return !/\((?:DESCANSO|FIN)\)/i.test(h); });
        const reales = _rxSucesosReales(hist).map(function (e) {
            const cuando = e.timeStr || (e.minute != null ? e.minute + "'" : '');
            const que = window.rxEtiquetaSuceso(e);
            return [cuando, que].filter(Boolean).join(' ');
        });
        return reales.concat(crudas).filter(Boolean).join(' | ');
    };

    // rxFilasInforme(m) → matriz para rxCsv: ficha del partido, línea en
    // blanco y una fila por jugador.
    window.rxFilasInforme = function (m) {
        m = m || {};
        const v = _rxVeredicto(m);
        const jug = ((m.players) || []).slice().sort(function (a, b) {
            return (parseInt(a.playerNumber, 10) || 99) - (parseInt(b.playerNumber, 10) || 99);
        });
        const out = [
            ['INFORME GRUPAL DE PARTIDO'],
            ['Rival', m.rival || '—'],
            ['Fecha', window.rxFechaLarga(m.matchDate) + (m.matchTime ? ' · ' + m.matchTime : '')],
            ['Competición', m.competition || '—'],
            ['Categoría', [m.category, m.subcategory].filter(Boolean).join(' ') || '—'],
            ['Campo', m.venue || '—'],
            ['Localía', m.myTeamRole === 'away' ? 'Visitante' : 'Local'],
            ['Resultado', v.marcador + (v.veredicto ? ' (' + v.veredicto + ')' : '')],
            ['Entrenador', m.coachEmail || '—'],
            ['Convocados', jug.length],
            [],
            ['Dorsal', 'Jugador', 'Minutos', 'Goles', 'Tarjeta', 'Lesión', 'Incidencias'],
        ];
        jug.forEach(function (p) {
            const tarjeta = (p.cards && p.cards !== 'ninguna') ? p.cards : 'ninguna';
            out.push([
                p.playerNumber || '', p.playerAlias || p.playerName || 'Jugador',
                p.minutesPlayed || '0', p.goals || 0, tarjeta,
                p.injured ? 'sí' : 'no', window.rxIncidencias(p),
            ]);
        });
        return out;
    };

    window.rxNombreInforme = function (m, ext) {
        m = m || {};
        return 'informe_grupal_' + window.rxSlug(m.rival || 'partido') +
            '_' + (m.matchDate || window.rxHoy()) + '.' + (ext || 'csv');
    };

    window.rxExportarInformeCSV = function (m) {
        if (!m || !Array.isArray(m.players) || !m.players.length) {
            _rxToast('⚠️ Ese informe no tiene jugadores que exportar', 3000);
            return false;
        }
        const okDesc = window.rxDescargarCSV(window.rxNombreInforme(m, 'csv'),
            window.rxCsv(window.rxFilasInforme(m)));
        if (okDesc) _rxToast('📄 Informe grupal descargado en CSV', 2500);
        return okDesc;
    };

    // rxExportarInformePDF(m, informeHtml, meta)
    //  informeHtml es lo que devuelve el motor de informes. Va dentro de
    //  .rx-lienzo (fondo oscuro) por lo explicado en la cabecera.
    window.rxExportarInformePDF = function (m, informeHtml, meta) {
        m = m || {};
        meta = meta || {};
        if (!informeHtml) {
            _rxToast('⚠️ No se pudo generar el informe visual', 3500);
            return false;
        }
        const v = _rxVeredicto(m);
        return window.rxImprimir({
            titulo:    'Informe grupal · ' + (m.rival ? 'vs ' + m.rival : 'Partido'),
            subtitulo: window.rxFechaLarga(m.matchDate) +
                       (v.marcador !== '—' ? ' · ' + v.marcador + (v.veredicto ? ' (' + v.veredicto + ')' : '') : ''),
            meta: [
                meta.club ? 'Club: ' + meta.club : '',
                [m.category, m.subcategory].filter(Boolean).join(' '),
                m.coachEmail || '',
            ],
            // 🔑 Apaisado: el Gantt del motor es una línea temporal por
            // jugador y en vertical se parte por la mitad.
            apaisado: true,
            cuerpo: '<div class="rx-block"><div class="rx-lienzo">' + informeHtml + '</div></div>',
        });
    };
})();
