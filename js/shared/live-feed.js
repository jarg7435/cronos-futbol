// ══════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — MINI-FEED DE «ÚLTIMOS SUCESOS» (v432 → v706)
// ══════════════════════════════════════════════════════════════════
//  Los 2-3 sucesos más recientes de un partido en vivo, con su minuto, su
//  icono, el equipo y el nombre del protagonista. Nació en v432 para que el
//  Director Deportivo viera de un vistazo qué pasa en cada campo sin entrar
//  en «VER PARTIDO».
//
//  🔑🔑 v706 · POR QUÉ ESTO YA NO VIVE DENTRO DE live.html.
//  Encargo del autor (capturas 10344-10348): «el panel de seguimiento en vivo
//  para familiares no está mostrando los tres últimos sucesos… debe pintar la
//  información detallada exactamente igual que en el sistema de clubes».
//  O sea que el mini-feed tiene ahora DOS pantallas:
//    · la tarjeta del listado de live.html  (`_liveFeedHtml`)
//    · la tarjeta de 🔴 En Vivo del Área de Familias (js/parent/panel.js)
//  y esa segunda pantalla vive en OTRO documento (index.html), así que no
//  puede llamar a una función privada del módulo de live.html.
//
//  ⚠️ NO SE COPIÓ, SE MOVIÓ. Este proyecto ya sabe cómo acaba tener el mismo
//  criterio escrito dos veces: `_userCanFollow` duplicado (v433), el badge de
//  solicitudes en dos implementaciones divergentes (v532), y la forma del
//  suceso del índice, que se unificó en v578 justo por esto. Una copia del
//  filtrado en el panel de familias habría empezado igual —idéntica— y habría
//  acabado distinta al primer cambio de tipos de suceso. live.html conserva
//  sus nombres (`_liveFeedItems`, `_liveFeedHtml`…) como envoltorios que
//  llaman aquí: ni un solo llamador suyo cambia.
//
//  🔑 EL TIPO ES EL CONTRATO, NO EL TEXTO NI EL ICONO. Cada evento guardado
//  lleva `icon` y `text` ya formateados (js/match/events/player-actions.js),
//  pero son PRESENTACIÓN: han cambiado varias veces —los glifos de las
//  sustituciones tres veces— y una repetición se quedó sin cambios por
//  depender de ese texto (v418-v421). Aquí el icono se deriva de `type` y los
//  nombres se sacan de los campos ESTRUCTURADOS (subOutName/subInName/
//  playerName) siempre que existan.
//
//  ⚠️ Goles, tarjetas y lesiones NO llevan campo estructurado con el nombre:
//  `_registerMatchEvent('goal', 'GOL · ' + p.name, '⚽')` se emite sin `extra`.
//  Para esos, el texto es la única fuente y se recorta por el separador ' · '.
//  Si el recorte falla se muestra el texto entero: peor estética, nunca una
//  línea vacía.
//
//  ⚠️ SIN DEPENDENCIAS DE LA PÁGINA. El escapado va aquí dentro (`_esc`) y no
//  se llama a `escapeHtml`: live.html define el suyo dentro de un módulo y el
//  panel de familias usa el global de utils.js. Depender de uno haría que el
//  feed se pintara SIN ESCAPAR en la otra pantalla, y el texto lo escribe a
//  mano el entrenador (nombres de jugador).
// ══════════════════════════════════════════════════════════════════
(function (global) {
    'use strict';

    const ICONOS = {
        goal:    '⚽',
        yellow:  '🟨',
        red:     '🟥',
        sub:     '🔄',
        sub_in:  '🔄',
        sub_out: '🔄',
        injury:  '🚑'
    };

    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // "1T 10:00" / "2T 50:00" -> "10'" / "50'".
    // El minuto de matchTime ya viene ACUMULADO desde el principio del partido,
    // también en la 2ª parte: el prefijo 1T/2T es solo una etiqueta, no un origen
    // de coordenadas (documentado en replay-player.js, defecto B de v394). Así que
    // se muestra tal cual, sin sumarle la duración de la primera parte.
    function minuto(ev) {
        const m = (ev && typeof ev.matchTime === 'string') ? ev.matchTime.match(/(\d+):(\d+)/) : null;
        if (m) return parseInt(m[1], 10) + "'";
        return '';
    }

    // Descripción corta y legible de un evento.
    function texto(ev) {
        if (!ev) return '';
        const trasSeparador = (t) => {
            const s = String(t || '');
            const i = s.indexOf(' · ');
            return i === -1 ? s : s.slice(i + 3).trim();
        };
        if (ev.type === 'sub' && ev.subOutName && ev.subInName) {
            return 'Sale ' + ev.subOutName + ' · Entra ' + ev.subInName;
        }
        if (ev.type === 'sub_in')  return 'Entra ' + (ev.playerName || trasSeparador(ev.text));
        if (ev.type === 'sub_out') return 'Sale '  + (ev.playerName || trasSeparador(ev.text));
        if (ev.type === 'goal' || ev.type === 'yellow' || ev.type === 'red' || ev.type === 'injury') {
            return trasSeparador(ev.text) || String(ev.text || '');
        }
        return String(ev.text || '');
    }

    // ════════════════════════════════════════════════════════════════════
    //  v439 · DE QUÉ EQUIPO ES CADA SUCESO
    //
    //  Petición del autor: en la tarjeta del panel general los sucesos decían la
    //  acción y el jugador, pero no el equipo, así que en un club con los dos
    //  equipos sobre el mismo campo no se sabía quién había marcado.
    //
    //  🔑 EL ORDEN DE LAS FUENTES IMPORTA, y las dos últimas son un RESPALDO para
    //  los partidos que ya estén en juego cuando esto se despliegue (sus eventos
    //  ya están escritos y no se pueden reescribir: el documento se congela y
    //  `events` sólo admite arrayUnion):
    //    1 · `ev.team` — el contrato, escrito por _datosEquipoDe en
    //        js/match/events/player-actions.js. Es lo único fiable.
    //    2 · el prefijo del texto de las SUSTITUCIONES ("CHRONOS | ▲ SALE: …"),
    //        que sí llevaba el equipo desde v424.
    //    3 · el nombre del protagonista, buscado en la plantilla del partido.
    //  Si ninguna resuelve, NO se inventa: la fila se pinta sin etiqueta. Una
    //  etiqueta equivocada es peor que ninguna — el director tomaría por propio
    //  un gol del rival.
    // ════════════════════════════════════════════════════════════════════
    function nombreEquipo(m, cual, ev) {
        const t = cual === 'away' ? (m && m.awayTeam) : (m && m.homeTeam);
        // El nombre del DOCUMENTO manda sobre el guardado en el evento: si el club
        // renombra el equipo, la tarjeta debe decir el nombre de ahora. `teamName`
        // sólo entra cuando el documento no lo trae.
        return (t && t.name) || (ev && ev.teamName) ||
               (cual === 'away' ? 'VISITANTE' : 'LOCAL');
    }

    // Nombre del protagonista, para poder buscarlo en la plantilla.
    // Se limpia el paréntesis final: "Luis (doble amarilla)", "Pedro (Retroactivo)".
    function nombreJugador(ev) {
        if (!ev) return '';
        if (ev.playerName) return String(ev.playerName);
        if (ev.subOutName) return String(ev.subOutName);
        if (ev.subInName)  return String(ev.subInName);
        const s = String(ev.text || '');
        const i = s.indexOf(' · ');
        if (i === -1) return '';
        return s.slice(i + 3).replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    function lado(m, ev) {
        // 1 · el contrato.
        if (ev && (ev.team === 'home' || ev.team === 'away')) return ev.team;

        const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

        // 2 · el prefijo del texto de las sustituciones.
        const txt = String((ev && ev.text) || '');
        const corte = txt.indexOf('|');
        if (corte > 0) {
            const prefijo = norm(txt.slice(0, corte));
            const home = norm(((m && m.homeTeam) || {}).name);
            const away = norm(((m && m.awayTeam) || {}).name);
            if (prefijo && prefijo === home && prefijo !== away) return 'home';
            if (prefijo && prefijo === away && prefijo !== home) return 'away';
        }

        // 3 · el jugador, buscado en la plantilla del partido.
        const nombre = norm(nombreJugador(ev));
        if (nombre) {
            const plantilla = Array.isArray(m && m.players) ? m.players : [];
            let cual = null;
            for (const p of plantilla) {
                if (!p || norm(p.name) !== nombre) continue;
                const suyo = p.team === 'away' ? 'away' : (p.team === 'home' ? 'home' : null);
                if (!suyo) continue;
                // Mismo nombre en los DOS equipos: ambiguo, y adivinar sería peor
                // que callar.
                if (cual && cual !== suyo) return null;
                cual = suyo;
            }
            if (cual) return cual;
        }
        return null;
    }

    // Los N sucesos más recientes que merece la pena enseñar.
    function items(m, max) {
        // ══════════════════════════════════════════════════════════════
        //  🚨 v578 · "SIN SUCESOS TODAVÍA" CON EL PARTIDO EN LA 2ª PARTE
        // ══════════════════════════════════════════════════════════════
        //  Reporte del autor (captura 9246): en el panel general, la sección
        //  ÚLTIMOS SUCESOS de cada tarjeta salía vacía aunque hubiera goles, pero
        //  los avisos flotantes sonaban perfectamente.
        //
        //  🔑 ESA ASIMETRÍA ERA EL DIAGNÓSTICO. Los dos leen lo mismo, así que si
        //  uno funciona el dato SÍ está llegando: lo que falla es quien lo lee.
        //  P2 (v572) mudó la lista a `live_index`, que trae los sucesos en
        //  `lastEvents`; `detectAndAlert` se adaptó para aceptar los dos nombres y
        //  **este segundo consumidor se quedó atrás**, mirando un `events` que en
        //  el índice no existe. Migrar una fuente de datos obliga a repasar TODOS
        //  sus consumidores, no sólo el que uno tiene en la cabeza.
        //
        //  Se aceptan los dos: `events` del documento gordo (visor de detalle,
        //  respaldo por escaneo y tarjeta del Área de Familias) y `lastEvents`
        //  del índice (panel general).
        const eventos = Array.isArray(m && m.events) ? m.events
                      : (Array.isArray(m && m.lastEvents) ? m.lastEvents : []);
        // `tactical_move` se descarta SIEMPRE: su `text` es un JSON con las
        // coordenadas del arrastre. Colarlo llenaría el feed de ruido ilegible y
        // taparía los goles, que es justo lo que se quiere ver.
        // 💬 v690 · Y `comment` tampoco: esta sección son los ÚLTIMOS SUCESOS de
        // juego, sólo caben tres, y una nota del entrenador desplazaría un gol.
        // Los comentarios están en el historial del partido — y para las familias
        // no existen en ninguna parte (ver `_veComentariosDePartido` en live.html).
        const utiles = eventos.filter(e => e && e.type && e.type !== 'tactical_move' && e.type !== 'comment');
        // Orden por createdAt DESCENDENTE: "lo último que ha pasado". No se usa el
        // orden del array porque un evento retroactivo se añade AHORA con un minuto
        // ANTIGUO, y por minuto quedaría enterrado justo cuando acaba de anotarse.
        // Sin createdAt (eventos viejos) se conserva la posición original.
        return utiles
            .map((e, i) => ({ e, i }))
            .sort((a, b) => ((b.e.createdAt || 0) - (a.e.createdAt || 0)) || (b.i - a.i))
            .slice(0, max || 3)
            .map(x => x.e);
    }

    // La fase del partido, tal y como se rotula en el chip ⏱️ de la cabecera.
    function fase(m) {
        const f = m && m.phase;
        return (f === 'break' || f === 'halftime') ? 'DESCANSO'
             : f === 'finished' ? 'FINALIZADO'
             : f === '2nd_half' ? '2ª PARTE'
             : '1ª PARTE';
    }

    function html(m) {
        const lista = items(m, 3);
        const chip = '<span class="live-feed-fase">⏱️ ' + fase(m) + '</span>';

        if (!lista.length) {
            return '<div class="live-feed">' +
                   '<div class="live-feed-head"><span>ÚLTIMOS SUCESOS</span>' + chip + '</div>' +
                   '<div class="live-feed-vacio">Sin sucesos todavía</div>' +
                   '</div>';
        }

        const filas = lista.map(ev => {
            const icono = ICONOS[ev.type] || '•';
            const min   = minuto(ev);
            // v439 · el equipo, delante del texto. Además del nombre lleva el color
            // del marcador (local azul / visitante rojo), para que la distinción se
            // vea también de un vistazo y no sólo leyendo.
            const cual  = lado(m, ev);
            const eq    = cual
                ? '<span class="lf-eq lf-eq-' + cual + '">' +
                  _esc(nombreEquipo(m, cual, ev)) + '</span>'
                : '';
            return '<div class="live-feed-fila">' +
                   '<span class="lf-min">' + _esc(min) + '</span>' +
                   '<span class="lf-ico">' + icono + '</span>' +
                   eq +
                   '<span class="lf-txt">' + _esc(texto(ev)) + '</span>' +
                   '</div>';
        }).join('');

        return '<div class="live-feed">' +
               '<div class="live-feed-head"><span>ÚLTIMOS SUCESOS</span>' + chip + '</div>' +
               filas +
               '</div>';
    }

    // ══════════════════════════════════════════════════════════════
    //  LOS ESTILOS, PARA QUIEN NO LOS LLEVE YA EN SU HOJA
    // ══════════════════════════════════════════════════════════════
    //  live.html tiene estas reglas embebidas en su propio <style> desde v432 y
    //  no necesita nada (`inyectaCss` no las duplica: mira el marcador). El Área
    //  de Familias vive en index.html, cuya hoja NO declara `.live-feed`, así
    //  que las inyecta la primera vez que pinta la tarjeta.
    //
    //  ⚠️ LOS COLORES VAN EN CRUDO, NO EN `var(--…)`. Son las MISMAS variables de
    //  live.html resueltas a mano (--muted #7d8590, --primary #58a6ff,
    //  --text #cdd9e5, --danger #ff5858): index.html no declara `--muted` ni
    //  `--text`, y su `--danger` es otro rojo (#f85149). Con variables, el mismo
    //  feed se pintaría de dos colores distintos según la página — y lo que se
    //  pidió es que sea EXACTAMENTE igual.
    const CSS =
        '.live-feed{background:rgba(0,0,0,0.22);border:1px solid rgba(255,255,255,0.07);' +
        'border-radius:8px;padding:0.5rem 0.6rem;margin-bottom:0.8rem;max-height:118px;overflow:hidden;}' +
        '.live-feed-head{display:flex;align-items:center;justify-content:space-between;gap:0.4rem;' +
        'font-size:0.6rem;font-weight:800;letter-spacing:0.8px;color:#7d8590;margin-bottom:0.35rem;}' +
        '.live-feed-fase{font-size:0.58rem;font-weight:800;letter-spacing:0.4px;color:#f0883e;' +
        'background:rgba(240,136,62,0.12);border:1px solid rgba(240,136,62,0.3);border-radius:4px;' +
        'padding:1px 5px;white-space:nowrap;flex-shrink:0;}' +
        '.live-feed-fila{display:flex;align-items:baseline;gap:0.4rem;font-size:0.73rem;' +
        'line-height:1.55;white-space:nowrap;overflow:hidden;}' +
        '.live-feed-fila .lf-min{flex-shrink:0;min-width:26px;text-align:right;font-weight:800;' +
        'font-size:0.66rem;color:#58a6ff;font-variant-numeric:tabular-nums;}' +
        '.live-feed-fila .lf-ico{flex-shrink:0;font-size:0.8rem;}' +
        '.live-feed-fila .lf-eq{flex-shrink:0;max-width:34%;overflow:hidden;text-overflow:ellipsis;' +
        'white-space:nowrap;font-size:0.6rem;font-weight:800;letter-spacing:0.3px;' +
        'text-transform:uppercase;border-radius:4px;padding:1px 5px;}' +
        '.live-feed-fila .lf-eq-home{color:#58a6ff;background:rgba(88,166,255,0.14);' +
        'border:1px solid rgba(88,166,255,0.32);}' +
        '.live-feed-fila .lf-eq-away{color:#ff5858;background:rgba(255,88,88,0.14);' +
        'border:1px solid rgba(255,88,88,0.32);}' +
        '.live-feed-fila .lf-txt{color:#cdd9e5;overflow:hidden;text-overflow:ellipsis;' +
        'white-space:nowrap;min-width:0;}' +
        '.live-feed-vacio{font-size:0.7rem;color:#7d8590;font-style:italic;padding:0.15rem 0;}' +
        '@media (max-width: 600px){' +
        '.live-feed{padding:0.42rem 0.5rem;max-height:104px;}' +
        '.live-feed-fila{font-size:0.68rem;line-height:1.45;}' +
        '.live-feed-fila .lf-min{min-width:23px;font-size:0.61rem;}' +
        '.live-feed-fila .lf-eq{font-size:0.55rem;max-width:30%;padding:0 4px;}' +
        '.live-feed-head{font-size:0.55rem;}' +
        '}';

    function inyectaCss() {
        try {
            if (typeof document === 'undefined') return;
            if (document.getElementById('cronos-live-feed-css')) return;
            const st = document.createElement('style');
            st.id = 'cronos-live-feed-css';
            st.textContent = CSS;
            document.head.appendChild(st);
        } catch (e) { /* sin estilos el feed se lee igual, sólo más feo */ }
    }

    global.cronosLiveFeed = {
        ICONOS: ICONOS,
        minuto: minuto,
        texto: texto,
        nombreEquipo: nombreEquipo,
        nombreJugador: nombreJugador,
        lado: lado,
        items: items,
        fase: fase,
        html: html,
        CSS: CSS,
        inyectaCss: inyectaCss
    };
})(typeof window !== 'undefined' ? window : globalThis);
