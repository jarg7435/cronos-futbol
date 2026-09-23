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

    // ── 📲 EN TÁCTIL SE COMPARTE; EN PC SE DESCARGA ──────────────────
    //  ⚠️⚠️ UN `<a download>` CON URL `blob:` **NAVEGA** EN iOS. Eso ya costó
    //  la saga v526→v530: tras exportar el vídeo, el iPad volvía a la pantalla
    //  de contraseña. No se perdía la sesión — la pestaña arrancaba de cero
    //  porque Safari había abierto su previsualización encima. **No se
    //  sobrevive a la navegación: hay que NO NAVEGAR.** La salida es entregar
    //  el fichero al menú del sistema con `navigator.share`, que no mueve la
    //  página, y que además es el "Guardar en Archivos" que el usuario espera.
    //
    //  🔑 SÓLO EN TÁCTIL. En un PC, `canShare({files})` puede decir que sí
    //  (Chrome en Windows lo soporta) y abriría un menú de compartir cuando lo
    //  que el usuario quiere es su CSV en Descargas para abrirlo con Excel. El
    //  camino del `<a>` lleva probado desde v473 y no se toca: *un arreglo que
    //  arregle el iPad y rompa el PC no es un arreglo* (v530).
    //
    //  ⚠️ `navigator.share` EXIGE GESTO DEL USUARIO. Por eso se llama de forma
    //  SÍNCRONA dentro del manejador del clic y quien llame debe traer el texto
    //  ya preparado: si se pone a leer de Firestore primero, el permiso caduca
    //  y salta `NotAllowedError`.
    function _rxEsTactil() {
        try {
            return (navigator.maxTouchPoints || 0) > 0 &&
                   typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
        } catch (e) { return false; }
    }

    // Intenta entregar el fichero por el menú del sistema. Devuelve true si la
    // entrega se ha puesto en marcha; false si aquí no se puede y hay que caer
    // al `<a download>` de siempre.
    function _rxCompartirFichero(nombre, bytes, mime) {
        try {
            if (!_rxEsTactil()) return false;
            if (typeof File !== 'function' || !navigator.share || !navigator.canShare) return false;
            const fichero = new File([bytes], nombre, { type: mime });
            if (!navigator.canShare({ files: [fichero] })) return false;
            // Llamada SÍNCRONA: es lo que consume el gesto del usuario.
            navigator.share({ files: [fichero], title: nombre })
                .catch(function (e) {
                    // Cancelar el menú NO es un fallo: el usuario cambió de idea.
                    if (e && e.name === 'AbortError') return;
                    _rxToast('⚠️ No se pudo compartir el archivo: ' +
                             (e && e.message ? e.message : e), 4000);
                });
            return true;
        } catch (e) { return false; }
    }

    // rxDescargarCSV(nombre, texto) → dispara la descarga. Devuelve true/false
    // para que quien llame pueda avisar si no se pudo.
    window.rxDescargarCSV = function (nombre, texto) {
        try {
            const bytes = _rxUtf16le(texto);
            if (_rxCompartirFichero(nombre, bytes, 'text/csv;charset=utf-16le')) return true;
            const blob = new Blob([bytes], { type: 'text/csv;charset=utf-16le' });
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

    // ════════════════════════════════════════════════════════════════
    //  📲 v681 · EN TÁCTIL EL DOCUMENTO SE ABRE **DENTRO** DE LA APP
    //
    //  Reportado por el autor (implementar.txt + capturas 10144-10145,
    //  2026-09-07) sobre el "🖨️ EXPORTAR" del Cuadrante: «en PC se abre en una
    //  pestaña nueva y puedo volver; en móviles y iPads la vista de exportación
    //  REEMPLAZA a la pantalla, y al cerrar el documento se sale de la app y se
    //  pierde la sesión».
    //
    //  🔑🔑 NO ES UN FALLO NUEVO: ES LA SAGA v526→v530 OTRA VEZ, Y ESTÁ ESCRITA
    //  30 LÍNEAS MÁS ARRIBA. «No se sobrevive a la navegación: hay que NO
    //  NAVEGAR.» Allí el que navegaba era un `<a download>` con `blob:`; aquí es
    //  `window.open('', '_blank')`. En un PC eso abre una pestaña de verdad
    //  —la del `about:blank` de su captura—, pero **en la app instalada no hay
    //  barra de pestañas**: lo que ocurre es que la vista se sustituye, y al
    //  cerrarla el usuario vuelve a la pantalla de acceso. Su cuadrante, con lo
    //  que estuviera editando, ya no está.
    //
    //  🔑 LA SALIDA ES LA MISMA QUE ENTONCES: no mover la página. El documento
    //  se pinta en un `<iframe>` dentro de un visor a pantalla completa, encima
    //  de la app. El cuadrante NO se destruye —sigue vivo en el DOM, debajo—,
    //  «✕ Cerrar» lo devuelve al instante y "🖨️ Imprimir / Guardar como PDF"
    //  ofrece el PDF igual que la ventana de antes.
    //
    //  ⚠️ EN PC NO SE TOCA NADA. Él dice expresamente que ahí funciona bien, y
    //  la lección de v530 es literal: *un arreglo que arregle el iPad y rompa el
    //  PC no es un arreglo*. El criterio de "táctil" es `_rxEsTactil()`, el
    //  MISMO que ya decide compartir-vs-descargar en este fichero: dos
    //  definiciones de "esto es un móvil" acabarían discrepando.
    //
    //  ⚠️ Y EN EL VISOR NO SE IMPRIME SOLO. La ventana nueva sí lo hace (el
    //  usuario pidió "descargar en PDF", no "ver una página"), pero un diálogo
    //  de impresión que salta encima de un visor recién abierto tapa el botón de
    //  cerrar; además iOS exige gesto del usuario para imprimir. Aquí el botón
    //  ES el gesto.
    //
    //  ⚠️ El `<iframe>` se rellena con `document.write` sobre su propio
    //  documento (mismo origen, `about:blank`), NO con `srcdoc`: el documento
    //  lleva comillas, `<script>` y miles de estilos en línea, y meterlo en un
    //  atributo es pedir un escapado que fallará el día que un nombre de equipo
    //  traiga una comilla.
    // ════════════════════════════════════════════════════════════════
    function _rxVisorEnLaApp(doc, titulo) {
        try {
            const previo = document.getElementById('rx-visor');
            if (previo && previo.parentNode) previo.parentNode.removeChild(previo);

            const ov = document.createElement('div');
            ov.id = 'rx-visor';
            ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#ffffff;' +
                'display:flex;flex-direction:column;';

            const barra = document.createElement('div');
            barra.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.55rem 0.7rem;' +
                'background:#161b22;border-bottom:1px solid rgba(255,255,255,0.12);flex-shrink:0;';
            barra.innerHTML =
                '<div style="flex:1;min-width:0;color:#c9d1d9;font-size:0.78rem;font-weight:700;' +
                    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _rxEsc(titulo) + '</div>' +
                '<button type="button" id="rx-visor-print" style="padding:0.45rem 0.8rem;border-radius:8px;' +
                    'border:1px solid #2563eb;background:#2563eb;color:#fff;font-size:0.74rem;' +
                    'font-weight:700;cursor:pointer;">🖨️ Imprimir / Guardar como PDF</button>' +
                '<button type="button" id="rx-visor-close" style="padding:0.45rem 0.8rem;border-radius:8px;' +
                    'border:1px solid rgba(248,81,73,0.5);background:rgba(248,81,73,0.15);color:#f85149;' +
                    'font-size:0.74rem;font-weight:700;cursor:pointer;">✕ Cerrar</button>';

            const marco = document.createElement('iframe');
            marco.title = titulo;
            marco.style.cssText = 'flex:1;width:100%;border:0;background:#fff;';

            ov.appendChild(barra);
            ov.appendChild(marco);
            document.body.appendChild(ov);

            // ⚠️ El documento se escribe DESPUÉS de adjuntar el iframe: antes de
            // estar en el DOM, `contentDocument` es null y no hay dónde escribir.
            const d = marco.contentDocument || (marco.contentWindow && marco.contentWindow.document);
            if (!d) { ov.parentNode.removeChild(ov); return false; }
            d.open(); d.write(doc); d.close();

            barra.querySelector('#rx-visor-close').onclick = function () {
                if (ov.parentNode) ov.parentNode.removeChild(ov);
            };
            barra.querySelector('#rx-visor-print').onclick = function () {
                // Se imprime EL IFRAME, no la app que hay debajo.
                try { marco.contentWindow.focus(); marco.contentWindow.print(); }
                catch (e) { _rxToast('⚠️ No se pudo abrir la impresión: ' + (e && e.message ? e.message : e), 4000); }
            };
            return true;
        } catch (e) {
            _rxToast('⚠️ No se pudo abrir el documento: ' + (e && e.message ? e.message : e), 4000);
            return false;
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  🚪 v681 · UNA SOLA PUERTA PARA ABRIR UN DOCUMENTO GENERADO
    //
    //  rxAbrirDocumento({ titulo, doc, docVisor?, ventana? }) → bool
    //    · táctil            → visor interno, sin navegar.
    //    · PC                → ventana nueva, como siempre.
    //    · emergente bloqueada → visor, en vez de dejar al usuario sin nada.
    //
    //  🔑 SE PUBLICA EN `window` PORQUE HAY UN SEGUNDO CONSUMIDOR: la factura
    //  del SuperAdmin (`js/admin/superadmin/billing.js`) montaba su propio
    //  `window.open('', '_blank', 'width=750,height=900')` con el mismo defecto
    //  —en un iPad, la factura se comía la pantalla del panel—. Copiar allí el
    //  visor habría creado la SEGUNDA definición de "cómo se abre un documento"
    //  y el día que una cambie, la otra se queda atrás: es el patrón que este
    //  proyecto lleva pagando desde v511.
    //
    //  ⚠️ `docVisor` existe porque el documento NO ES EL MISMO en los dos
    //  destinos: el de la ventana lleva auto-print y su botón; el del visor, no
    //  (los pone la barra). Quien no necesite distinguirlos pasa sólo `doc`.
    //  ⚠️ `ventana` son las opciones de tamaño de `window.open`; en el visor no
    //  significan nada y se ignoran, que es lo correcto: a pantalla completa.
    // ════════════════════════════════════════════════════════════════
    window.rxAbrirDocumento = function (opts) {
        opts = opts || {};
        const titulo = opts.titulo || 'Documento · Chronos Fútbol';
        const docVisor = opts.docVisor || opts.doc || '';
        if (!docVisor && !opts.doc) return false;

        if (_rxEsTactil()) return _rxVisorEnLaApp(docVisor, titulo);

        const w = window.open('', '_blank', opts.ventana || '');
        if (!w) {
            // ⚠️ v681 · LA EMERGENTE BLOQUEADA YA NO ES UN CALLEJÓN SIN SALIDA.
            // Hasta aquí sólo se avisaba y el usuario se quedaba sin documento,
            // teniendo que ir a los ajustes del navegador. Ahora se le enseña
            // por el mismo visor del táctil, que no depende de emergentes.
            _rxToast('⚠️ El navegador bloqueó la ventana emergente: el documento se abre aquí mismo', 5000);
            return _rxVisorEnLaApp(docVisor, titulo);
        }
        w.document.open();
        w.document.write(opts.doc || docVisor);
        w.document.close();
        return true;
    };

    // rxImprimir({ titulo, subtitulo, meta[], cuerpo, apaisado }) → bool
    //   cuerpo: HTML ya montado (bloques .rx-block).
    //   En táctil abre el visor interno (v681, ver arriba); en PC, la ventana
    //   nueva de siempre. Devuelve false sólo si no se pudo enseñar el
    //   documento por ninguna de las dos vías, y entonces se avisa.
    window.rxImprimir = function (opts) {
        opts = opts || {};
        const titulo = opts.titulo || 'Informe · Chronos Fútbol';
        const meta = (opts.meta || []).filter(Boolean)
            .map(function (l) { return '<div>' + _rxEsc(l) + '</div>'; }).join('');
        // ⚠️ EL DOCUMENTO SE MONTA SEGÚN DÓNDE VA A VIVIR, y por eso es una
        // función y no una cadena: en la ventana nueva lleva su auto-print y su
        // botón; en el visor interno, ninguno de los dos (los pone la barra).
        // Con una sola cadena, el respaldo de la emergente bloqueada habría
        // enseñado el documento de la ventana dentro del visor — con el diálogo
        // de impresión saltando encima del botón de cerrar.
        const montarDoc = function (conVentana) { return (
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
                // v753 · `pie` opcional: la convocatoria y la planificación se
                // imprimen TAMBIÉN desde el panel del entrenador, y ahí «generado
                // desde el Panel de Dirección» sería mentira. Sin `pie`, el texto
                // de siempre (lo que ya imprimían el cuadrante y los informes).
                '<div class="rx-pie">' + (opts.pie ? _rxEsc(opts.pie)
                    : 'Chronos Fútbol · documento generado desde el Panel de Dirección. ' +
                      'Los datos proceden de los informes enviados por los entrenadores.') + '</div>' +
                // ⚠️ En el visor interno ESTE botón sobra: la barra de arriba ya
                // trae el suyo, y el de dentro imprimiría igual pero sin el
                // «✕ Cerrar» al lado. En la ventana nueva se queda, que es el
                // respaldo de cuando el navegador ignora el print automático.
                (conVentana
                    ? '<button class="rx-btn" onclick="window.print()">🖨️ Imprimir / Guardar como PDF</button>'
                    : '') +
            '</div>' +
            // El diálogo se abre solo: el usuario ha pedido "descargar en PDF",
            // no "ver una página". El botón queda como respaldo para cuando el
            // navegador ignora el print automático (Safari en iOS lo hace).
            // ⚠️ NO en el visor interno: ver la nota de _rxVisorEnLaApp.
            (conVentana
                ? '<script>window.onload=function(){setTimeout(function(){' +
                      'try{window.focus();window.print();}catch(e){}},350);};<\/script>'
                : '') +
            '</body></html>'
        ); };

        // 🚪 Quién abre y dónde lo decide rxAbrirDocumento, que es el punto
        //    único (lo comparte con la factura del SuperAdmin).
        return window.rxAbrirDocumento({
            titulo:   titulo,
            doc:      montarDoc(true),    // ventana nueva: con auto-print
            docVisor: montarDoc(false),   // visor interno: sin él
        });
    };

    // ════════════════════════════════════════════════════════════════
    //  🖨️ v753 · CONVOCATORIA Y PLANIFICACIÓN SEMANAL EN PAPEL
    //
    //  Encargo del autor (implementar.txt 2026-09-23 + capturas 10730-10735):
    //  que la Convocatoria (entrenador y Dirección) y la Planificación Semanal
    //  (entrenador y Dirección) se impriman «idéntico al Cuadrante Semanal de
    //  Instalaciones»: cabecera corporativa, metadatos y tablas.
    //
    //  🔑 NO ES UN MOTOR NUEVO: los dos documentos se montan con
    //  `window.rxImprimir`, el MISMO que imprime el cuadrante
    //  (cuadrante-club.js). Cabecera, CSS de papel, auto-print en PC y visor
    //  interno en iPad (v681) salen de ahí. Aquí sólo se compone el CUERPO.
    //
    //  🔑 CADA DOCUMENTO TIENE DOS FUENTES y por eso recibe DATOS YA
    //  NORMALIZADOS, no un documento de Firestore: el entrenador imprime lo que
    //  tiene en pantalla (aún sin enviar) y Dirección imprime lo que se le
    //  envió. Quien llama traduce su forma a la de aquí.
    // ════════════════════════════════════════════════════════════════
    // rxNombreDe(usuario) → el NOMBRE de una persona, nunca su correo.
    //  v753b · encargo del autor: la cabecera decía «Entrenador:
    //  arinagazone@gmail.com». Se delega en `_ccNombreDe` (club-chat.js), el
    //  criterio que ya fijó v741 —`displayName`, luego nombre+apellidos, luego
    //  la plaza—, porque `name` NO existe en este proyecto. El respaldo local
    //  es sólo por si ese módulo no estuviera cargado.
    window.rxNombreDe = function (u) {
        if (!u) return '';
        if (typeof window._ccNombreDe === 'function') return window._ccNombreDe(u);
        const l = function (v) { return String(v == null ? '' : v).trim(); };
        const n = l(u.displayName) || [l(u.firstName), l(u.lastName)].filter(Boolean).join(' ');
        if (n) return n;
        const m = l(u.email);
        return m.indexOf('@') > 0 ? m.slice(0, m.indexOf('@')) : m;
    };

    function _rxFila(etq, val) {
        if (val == null || String(val).trim() === '') return '';
        return '<tr><td class="rx-l" style="width:34%;font-weight:700;color:#1d4ed8;">' + _rxEsc(etq) +
               '</td><td class="rx-l">' + _rxEsc(val) + '</td></tr>';
    }

    function _rxTablaJugadores(lista, conPapel) {
        if (!lista.length) return '<div class="rx-vacio">Ninguno.</div>';
        return '<table class="rx-tabla"><thead><tr>' +
                '<th style="width:70px;">Dorsal</th><th class="rx-l">Jugador</th>' +
                (conPapel ? '<th style="width:110px;">Papel</th>' : '') +
                '<th class="rx-l" style="width:30%;">Observaciones</th>' +
            '</tr></thead><tbody>' +
            lista.map(function (j) {
                return '<tr>' +
                    '<td><span class="rx-dorsal">' + _rxEsc(j.num || '—') + '</span></td>' +
                    '<td class="rx-l" style="font-weight:700;color:#111827;">' + _rxEsc(j.name || '—') + '</td>' +
                    (conPapel ? '<td>' + (j.titular ? '<strong style="color:#c2410c;">TITULAR</strong>' : 'Suplente') + '</td>' : '') +
                    '<td class="rx-l">' + (j.origin ? 'Jugador de apoyo · ' + _rxEsc(j.origin) : '') + '</td>' +
                '</tr>';
            }).join('') +
            '</tbody></table>';
    }

    // rxImprimirConvocatoria({ club, equipo, tipo, jornada, fecha, hora,
    //   presentacion, lugar, rival, mensaje, estado, pie,
    //   jugadores: [{ num, name, origin, titular: true|false|null }] })
    //  `titular: null` = no se sabe (convocatorias enviadas antes de v753, que
    //  no guardaban quién salía de inicio): se imprime UNA lista y se dice por
    //  qué, en vez de inventarse una división en titulares y suplentes.
    window.rxImprimirConvocatoria = function (c) {
        c = c || {};
        const jug = (c.jugadores || []).filter(function (j) { return j && (j.name || j.num); });
        const conoce = jug.length > 0 && jug.every(function (j) { return j.titular === true || j.titular === false; });
        const tit = conoce ? jug.filter(function (j) { return j.titular; }) : [];
        const sup = conoce ? jug.filter(function (j) { return !j.titular; }) : [];

        const datos =
            '<div class="rx-block"><div class="rx-block-title">Datos del partido</div>' +
            '<table class="rx-tabla"><tbody>' +
                _rxFila('Equipo', c.equipo) +
                _rxFila('Rival', c.rival ? 'vs ' + c.rival : '') +
                _rxFila('Tipo de partido', c.tipo) +
                _rxFila('Jornada', c.jornada) +
                _rxFila('Fecha', c.fecha) +
                _rxFila('Hora del partido', c.hora) +
                _rxFila('Hora de presentación', c.presentacion) +
                _rxFila('Lugar / Campo', c.lugar) +
            '</tbody></table></div>';

        const resumen =
            '<div style="background:#eff6ff;border:2px solid #2563eb;border-radius:6px;padding:8px 12px;' +
                 'margin-bottom:14px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;">' +
                '<div style="font-size:11px;font-weight:800;color:#1d4ed8;">TOTAL DE CONVOCADOS</div>' +
                '<div style="font-size:11px;font-weight:800;color:#111827;">' + jug.length + ' convocados' +
                    (conoce ? ' · ' + tit.length + ' titulares · ' + sup.length + ' suplentes' : '') + '</div>' +
            '</div>';

        let listas;
        if (conoce) {
            listas =
                '<div class="rx-block"><div class="rx-block-title">Titulares (' + tit.length + ')</div>' +
                    _rxTablaJugadores(tit, false) + '</div>' +
                '<div class="rx-block"><div class="rx-block-title">Suplentes (' + sup.length + ')</div>' +
                    _rxTablaJugadores(sup, false) + '</div>';
        } else {
            listas =
                '<div class="rx-block"><div class="rx-block-title">Convocados (' + jug.length + ')</div>' +
                    _rxTablaJugadores(jug, false) +
                    (jug.length ? '<div style="font-size:8.5px;color:#6b7280;margin-top:6px;">Esta convocatoria no ' +
                        'registra qué jugadores salen de titulares (se envió antes de que la aplicación lo guardara).</div>' : '') +
                '</div>';
        }

        const mensaje = c.mensaje
            ? '<div class="rx-block"><div class="rx-block-title">Mensaje del entrenador</div>' +
              '<div style="font-size:11px;color:#374151;background:#fff7ed;border:1px solid #fdba74;' +
                  'border-radius:6px;padding:8px 12px;white-space:pre-wrap;">' + _rxEsc(c.mensaje) + '</div></div>'
            : '';

        return window.rxImprimir({
            titulo:    'Convocatoria' + (c.rival ? ' · vs ' + c.rival : ''),
            subtitulo: [c.equipo, c.fecha].filter(Boolean).join(' · '),
            // `estado`: cadena o lista de líneas (Entrenador, Enviado…).
            meta:      [c.club ? 'Club: ' + c.club : ''].concat(c.estado || []),
            cuerpo:    '<div class="rx-block"><div class="rx-block-title">Convocatoria oficial</div>' + resumen + '</div>' +
                       datos + listas + mensaje,
            pie:       c.pie || 'Chronos Fútbol · convocatoria generada desde la aplicación del club.',
            apaisado:  false,
        });
    };

    // rxImprimirPlanSemanal({ club, equipo, desde, hasta, estado, pie, notas,
    //   dias: [{ dia, fecha, tipo, hora, duracion, lugar, equipaciones, nota }] })
    //  Siempre siete filas: un día sin nada también se lee («Descanso»), igual
    //  que en la tarjeta de pantalla.
    window.rxImprimirPlanSemanal = function (p) {
        p = p || {};
        const dias = p.dias || [];
        let nEnt = 0, nPar = 0, nDes = 0;
        const filas = dias.map(function (d) {
            const tipo = String(d.tipo || '').trim();
            const vacio = !tipo && !d.hora && !d.lugar && !d.duracion && !d.equipaciones && !d.nota;
            const descanso = vacio || /^descanso\b/i.test(tipo);
            const partido = !descanso && /\b(partido|amistoso|liga|copa|torneo)\b/i.test(tipo + ' ' + (d.nota || ''));
            if (descanso) nDes++; else if (partido) nPar++; else nEnt++;
            const fondo = partido ? 'background:#ecfdf5;' : descanso ? 'background:#f9fafb;' : '';
            const tipoCap = tipo ? tipo.charAt(0).toUpperCase() + tipo.slice(1) : '';
            const tipoTxt = descanso ? '<em style="color:#9ca3af;">Descanso</em>'
                : (partido ? '<strong style="color:#047857;">⚽ ' + _rxEsc(tipoCap || 'Partido') + '</strong>'
                           : _rxEsc(tipoCap || '—'));
            // Un descanso no tiene hora, lugar ni equipación: la parrilla del
            // entrenador suele conservar los valores de la semana copiada, y en
            // papel «Descanso · 20:00 · CAMPO» se leería como una convocatoria.
            const c = function (v) { return descanso || !v ? '<span class="rx-cero">—</span>' : _rxEsc(v); };
            return '<tr style="' + fondo + '">' +
                '<td class="rx-l" style="font-weight:800;color:#111827;">' + _rxEsc(d.dia || '') +
                    (d.fecha ? '<div style="font-size:9px;color:#6b7280;font-weight:600;">' + _rxEsc(d.fecha) + '</div>' : '') + '</td>' +
                '<td>' + tipoTxt + '</td>' +
                '<td>' + c(d.hora) + '</td>' +
                '<td>' + c(d.duracion) + '</td>' +
                '<td class="rx-l">' + c(d.lugar) + '</td>' +
                '<td class="rx-l">' + c(d.equipaciones) + '</td>' +
                '<td class="rx-l">' + (d.nota ? _rxEsc(d.nota) : '') + '</td>' +
            '</tr>';
        }).join('');

        const resumen =
            '<div style="background:#eff6ff;border:2px solid #2563eb;border-radius:6px;padding:8px 12px;' +
                 'margin-bottom:10px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;">' +
                '<div style="font-size:11px;font-weight:800;color:#1d4ed8;">RESUMEN DE LA SEMANA</div>' +
                '<div style="font-size:11px;font-weight:800;color:#111827;">' +
                    nEnt + ' entrenamiento' + (nEnt === 1 ? '' : 's') + ' · ' +
                    nPar + ' partido' + (nPar === 1 ? '' : 's') + ' · ' +
                    nDes + ' descanso' + (nDes === 1 ? '' : 's') + '</div>' +
            '</div>';

        const tabla = dias.length
            ? '<table class="rx-tabla"><thead><tr>' +
                  '<th class="rx-l" style="width:110px;">Día</th><th>Tipo de actividad</th><th>Hora</th>' +
                  '<th>Duración</th><th class="rx-l">Lugar</th><th class="rx-l">Equipación</th>' +
                  '<th class="rx-l">Observaciones</th>' +
              '</tr></thead><tbody>' + filas + '</tbody></table>'
            : '<div class="rx-vacio">Esta semana no tiene ninguna actividad registrada.</div>';

        const leyenda = '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:8.5px;color:#4b5563;margin-top:6px;">' +
            '<span><span style="display:inline-block;width:9px;height:9px;background:#ffffff;border:1px solid #d1d5db;vertical-align:-1px;"></span> Entrenamiento</span>' +
            '<span><span style="display:inline-block;width:9px;height:9px;background:#ecfdf5;border:1px solid #6ee7b7;vertical-align:-1px;"></span> Partido</span>' +
            '<span><span style="display:inline-block;width:9px;height:9px;background:#f9fafb;border:1px solid #e5e7eb;vertical-align:-1px;"></span> Descanso</span>' +
        '</div>';

        const notas = p.notas
            ? '<div class="rx-block"><div class="rx-block-title">Notas</div>' +
              '<div style="font-size:11px;color:#374151;background:#f8fafc;border-radius:6px;padding:8px 12px;' +
                  'white-space:pre-wrap;">' + _rxEsc(p.notas) + '</div></div>'
            : '';

        return window.rxImprimir({
            titulo:    'Planificación semanal · entrenamientos y partidos',
            subtitulo: [p.equipo, (p.desde && p.hasta) ? 'Semana del ' + p.desde + ' al ' + p.hasta
                                                        : (p.desde ? 'Semana del ' + p.desde : '')]
                           .filter(Boolean).join(' · '),
            meta:      [p.club ? 'Club: ' + p.club : ''].concat(p.estado || []),
            cuerpo:    '<div class="rx-block"><div class="rx-block-title">Estructura semanal</div>' +
                           resumen + tabla + leyenda + '</div>' + notas,
            pie:       p.pie || 'Chronos Fútbol · planificación generada desde la aplicación del club.',
            apaisado:  true,   // 7 columnas: en vertical el lugar y la equipación se parten
        });
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
    const RX_COLS = ['Dorsal', 'Jugador', 'Conv.', 'PJ', 'PT', 'Min', 'Goles', 'Amarillas', 'Rojas', 'Lesiones'];

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
                    f.called || 0, f.pj || 0, f.pt || 0, f.minutes || 0, f.goals || 0,
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
                // PT y Min van con guion en el total, igual que en pantalla: la
                // suma de titularidades de la plantilla es el numero de
                // alineaciones, no una magnitud del equipo.
                '-', '-', t.goals, t.yellow, t.red, t.injuries,
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
                cel(f.called || 0) + cel(f.pj || 0) + cel(f.pt || 0) + cel(f.minutes || 0) + cel(f.goals || 0) +
                cel(f.yellow || 0) + cel(f.red || 0) + cel(f.injuries || 0) + '</tr>';
        }).join('');
        const t = _rxTotales(filas);
        const totPj = (typeof b.partidos === 'number' && isFinite(b.partidos)) ? String(b.partidos) : '-';

        return '<div class="rx-block">' + titulo +
            '<table class="rx-tabla"><thead><tr>' +
                '<th class="rx-l">Jugador</th><th>Conv.</th><th>PJ</th><th>PT</th><th>Min</th>' +
                '<th>Goles</th><th>Amarillas</th><th>Rojas</th><th>Lesiones</th>' +
            '</tr></thead><tbody>' + cuerpo + '</tbody>' +
            '<tfoot><tr><td class="rx-l">Total equipo</td><td>' + t.called + '</td>' +
                '<td>' + totPj + '</td><td>-</td><td>-</td><td>' + t.goals + '</td>' +
                '<td>' + t.yellow + '</td><td>' + t.red + '</td><td>' + t.injuries + '</td>' +
            '</tr></tfoot></table>' +
            '<div style="font-size:9px;color:#6b7280;margin-top:4px;">' +
                filas.length + ' jugador' + (filas.length === 1 ? '' : 'es') + ' con informes · ' +
                'PJ del total = partidos disputados por el equipo; PT (titularidades) y minutos no se suman entre jugadores.' +
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
    //  🏠✈️ v712 · Y el TÍTULO del encuentro, ya ordenado por localía
    //  (`cronosEnfrentamiento`, js/core/utils.js): el marcador de la ficha es
    //  LOCAL - VISITANTE, así que sin los dos nombres en ese mismo orden un
    //  «2 - 1 (DERROTA)» parece una errata. El nombre propio se resuelve del
    //  usuario en sesión —los informes que se exportan son de su club— y se
    //  puede pasar por argumento (el PDF ya lleva el club en su `meta`).
    //  ⚠️ El respaldo mantiene el comportamiento previo si `utils.js` no está
    //  cargado (es lo que ocurre en el arnés de pruebas).
    function _rxMiNombre(extra) {
        const u = (typeof window !== 'undefined' && window._cronosCurrentUser) || {};
        return String(extra || u.clubName || u.clubId || 'Mi equipo').trim() || 'Mi equipo';
    }
    function _rxVeredicto(m, miNombre) {
        m = m || {};
        if (typeof window !== 'undefined' && typeof window.cronosEnfrentamiento === 'function') {
            const e = window.cronosEnfrentamiento(m, _rxMiNombre(miNombre));
            return {
                marcador:  e.marcador ? e.marcador.replace('-', ' - ') : '—',
                veredicto: e.veredicto,
                titulo:    e.titulo,
            };
        }
        const _mio = _rxMiNombre(miNombre), _suyo = m.rival || 'Rival';
        const _fuera = m.myTeamRole === 'away';
        const titulo = (_fuera ? _suyo : _mio) + ' vs ' + (_fuera ? _mio : _suyo);
        const sh = m.scoreHome, sa = m.scoreAway;
        if (sh == null || sa == null) return { marcador: '—', veredicto: '', titulo: titulo };
        const mios = _fuera ? sa : sh;
        const suyos = _fuera ? sh : sa;
        return {
            marcador: sh + ' - ' + sa,
            veredicto: mios > suyos ? 'VICTORIA' : mios < suyos ? 'DERROTA' : 'EMPATE',
            titulo: titulo,
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
        // 🟠 v715 · LO REGISTRADO A POSTERIORI SE DICE CON PALABRAS. En una
        // hoja de cálculo y en un TXT no hay color —igual que pasa con
        // "TARJETA", que allí hay que decir de qué color es—, así que la
        // trazabilidad que el autor pide en naranja para la pantalla aquí se
        // escribe. La marca la resuelve la regla única de js/core/utils.js.
        const _retro = (typeof window !== 'undefined' && typeof window.cronosEsRetro === 'function')
            ? window.cronosEsRetro(e)
            : (e.retro === true || e.isRetroactive === true || /\(RETRO\)|\(RETROACTIVO\)/i.test(nota));
        const _sello = (t) => _retro ? (t + ' (retroactivo)') : t;
        if (e.type === 'goal'   && /ANULAD/i.test(nota))            return _sello('Gol anulado');
        if (e.type === 'red'    && /REVERTID|RECTIFIC/i.test(nota)) return _sello('Roja revertida');
        if (e.type === 'yellow' && /DOBLE\s+AMARILLA/i.test(nota))  return _sello('Doble amarilla (expulsión)');
        return _sello(RX_SUCESO[e.type] || String(e.type));
    };

    // ── 📄 v713 · LAS INCIDENCIAS, LÍNEA A LÍNEA ─────────────────────
    //  rxLineasIncidencias(p) → ["02:24 Sale del campo", "10:00 Gol"]
    //
    //  REPORTE DEL AUTOR (implementar.txt 2026-09-14, capturas 10402/10403):
    //  el TXT del informe de partido escribía «· [object Object]» por cada
    //  suceso — cinco líneas seguidas en el jugador con más historial. Volcaba
    //  `p.history` con una interpolación de texto, y desde v531 esos apuntes
    //  son OBJETOS (`{type, minute, second, timeStr, note}`).
    //
    //  🔑 Y NO SE ARREGLA CON UN `JSON.stringify` NI CON UN ROTULITO POR TIPO:
    //  la traducción correcta ya vivía aquí (`rxEtiquetaSuceso` +
    //  `_rxSucesosReales`, del CSV) con las dos trampas resueltas —la
    //  contabilidad de fase que no es una sustitución, y los sucesos que se
    //  tipan como lo que no son (gol anulado, doble amarilla, roja
    //  revertida)—. Así que el TXT consume ESTO, en vez de estrenar un tercer
    //  criterio que divergiría del CSV y de la pantalla.
    //
    //  Devuelve una LÍNEA POR SUCESO porque es lo que necesita un TXT (y el
    //  registro cronológico de la pantalla); `rxIncidencias` las junta para la
    //  celda del CSV, que sigue siendo una sola.
    window.rxLineasIncidencias = function (p) {
        const hist = (p && p.history) || [];
        if (!Array.isArray(hist)) return [];
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
        return reales.concat(crudas).filter(Boolean);
    };

    // rxIncidencias(p) → "02:24 Sale del campo | 10:00 Gol"
    //  Va todo en UNA celda: son varias líneas y repartirlas en columnas
    //  dejaría una hoja con un ancho distinto por jugador.
    window.rxIncidencias = function (p) {
        return window.rxLineasIncidencias(p).join(' | ');
    };

    // rxFilasInforme(m) → matriz para rxCsv: ficha del partido, línea en
    // blanco y una fila por jugador.
    window.rxFilasInforme = function (m) {
        m = m || {};
        const v = _rxVeredicto(m);
        const jug = ((m.players) || []).slice().sort(function (a, b) {
            return (parseInt(a.playerNumber, 10) || 99) - (parseInt(b.playerNumber, 10) || 99);
        });
        // 🔵🔴 v713 · Pérdidas y recuperaciones, con la MISMA regla que el resto
        // (js/core/utils.js): el dato viaja repetido y se coge el ejemplar más
        // completo. Si el partido no lo trae, no se escribe ninguna columna: un
        // informe anterior al registro de P/R no puede rellenarse de ceros.
        const pr    = (typeof window.cronosPRDelInforme === 'function')
            ? window.cronosPRDelInforme(m) : (m.matchPR || null);
        const prP   = (pr && pr.perdidas)       || {};
        const prR   = (pr && pr.recuperaciones) || {};
        const totP  = Number(prP.total) || 0;
        const totR  = Number(prR.total) || 0;
        const hayPR = !!(totP || totR);
        const prDe  = function (dorsal, cual) {
            const tabla = (cual === 'p' ? prP : prR).porDorsal || {};
            return Number(tabla[String(dorsal == null ? '' : dorsal).trim()]) || 0;
        };
        const out = [
            ['INFORME GRUPAL DE PARTIDO'],
            ['Encuentro', v.titulo || '—'],
            ['Rival', m.rival || '—'],
            ['Fecha', window.rxFechaLarga(m.matchDate) + (m.matchTime ? ' · ' + m.matchTime : '')],
            ['Competición', m.competition || '—'],
            ['Categoría', [m.category, m.subcategory].filter(Boolean).join(' ') || '—'],
            ['Campo', m.venue || '—'],
            ['Localía', m.myTeamRole === 'away' ? 'Visitante' : 'Local'],
            ['Resultado', v.marcador + (v.veredicto ? ' (' + v.veredicto + ')' : '')],
            ['Entrenador', m.coachEmail || '—'],
            ['Convocados', jug.length],
        ];
        if (hayPR) {
            out.push(['Pérdidas del equipo', totP]);
            out.push(['Recuperaciones del equipo', totR]);
            const sinP = Number(prP.sinAsignar) || 0, sinR = Number(prR.sinAsignar) || 0;
            if (sinP || sinR) out.push(['P/R sin jugador asignado', sinP + ' / ' + sinR]);
        }
        out.push([]);
        out.push(['Dorsal', 'Jugador', 'Minutos', 'Goles', 'Tarjeta', 'Lesión']
            .concat(hayPR ? ['Pérdidas', 'Recuperaciones'] : [])
            .concat(['Incidencias']));
        jug.forEach(function (p) {
            const tarjeta = (p.cards && p.cards !== 'ninguna') ? p.cards : 'ninguna';
            out.push([
                p.playerNumber || '', p.playerAlias || p.playerName || 'Jugador',
                p.minutesPlayed || '0', p.goals || 0, tarjeta,
                p.injured ? 'sí' : 'no',
            ].concat(hayPR ? [prDe(p.playerNumber, 'p'), prDe(p.playerNumber, 'r')] : [])
             .concat([window.rxIncidencias(p)]));
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
        const v = _rxVeredicto(m, meta.club);
        return window.rxImprimir({
            titulo:    'Informe grupal · ' + (v.titulo || (m.rival ? 'vs ' + m.rival : 'Partido')),
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
