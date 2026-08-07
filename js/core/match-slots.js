// ══════════════════════════════════════════════════════════════════════════
//  RANURAS DE PARTIDO ACTIVO — una por partido, aisladas entre pestañas
//  (v465)
//  ────────────────────────────────────────────────────────────────────────
//  EL PROBLEMA QUE RESUELVE (reporte del autor, capturas 8474 y 8475):
//  un entrenador con DOS partidos abiertos a la vez —un Alevín C y un
//  Juvenil B— veía cómo los datos y sucesos de uno de los dos dejaban de
//  llegar al panel en vivo.
//
//  La causa no era Firestore: era que TODO el estado del partido en curso
//  vivía en UNA SOLA clave de localStorage, `cronos_active_match_v2`, y
//  localStorage es COMPARTIDO POR TODAS LAS PESTAÑAS del mismo origen.
//  Con dos partidos abiertos:
//
//   1. Las dos pestañas autoguardaban en esa misma clave cada 5 s. Ganaba
//      la última que escribía, así que la clave dejaba de describir a
//      ninguno de los dos partidos de forma fiable.
//   2. `endMatch` del primer partido hacía `removeItem` de esa clave y
//      levantaba la bandera GLOBAL `cronos_active_match_v2_finished`.
//   3. Cuando la otra pestaña se recargaba —y en un móvil se recarga sola
//      todo el rato: el sistema desaloja pestañas en segundo plano y cada
//      actualización del Service Worker fuerza otra—, `_checkActiveMatch`
//      veía esa bandera, BORRABA el estado y devolvía `false`. El partido
//      que seguía en juego se quedaba sin `liveMatchId`, sin banner de
//      retomar y sin latido: **dejaba de emitir**. Eso es exactamente lo
//      que el autor describe.
//   4. Y sin llegar a terminar ninguno: si una pestaña se recargaba
//      después de que la OTRA hubiera escrito, restauraba el estado del
//      partido ajeno, `liveMatchId` incluido, y se ponía a emitir con la
//      identidad equivocada.
//
//  LA SOLUCIÓN, en dos piezas que hacen falta LAS DOS:
//
//   A. UNA RANURA POR PARTIDO. La clave pasa a ser
//      `cronos_active_match_v2::<matchId>`, y la bandera de finalizado
//      `cronos_active_match_v2_finished::<matchId>`. Terminar un partido
//      ya no puede borrar ni invalidar el estado de otro.
//
//   B. CADA PESTAÑA SABE CUÁL ES EL SUYO, y eso NO puede vivir en
//      localStorage —que es justo lo que se comparte—, sino en
//      **sessionStorage**, que es por pestaña Y sobrevive a la recarga.
//      Sin esta segunda pieza, separar las claves no arregla nada: al
//      recargar, la pestaña seguiría sin saber cuál de las dos ranuras es
//      la suya y podría adoptar la ajena.
//
//  Este fichero se carga ANTES que app-init.js a propósito: es quien
//  define las claves, y todos los demás módulos pasan por aquí.
// ══════════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    var BASE       = 'cronos_active_match_v2';
    var SEP        = '::';
    var FIN_BASE   = 'cronos_active_match_v2_finished';
    var TAB_MATCH  = 'cronos_tab_match';   // sessionStorage: el partido DE ESTA pestaña
    var TAB_ID     = 'cronos_tab_id';      // sessionStorage: identidad de la pestaña

    // ── Accesos blindados ────────────────────────────────────────────────
    // En Safari con "Bloquear todas las cookies", y en modo privado de
    // algunos navegadores, el mero hecho de LEER localStorage lanza. Esto
    // es persistencia de un partido en curso: nunca puede tumbar la app.
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
    function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

    function claveDe(matchId) { return BASE + SEP + matchId; }
    function claveFinDe(matchId) { return FIN_BASE + SEP + matchId; }

    // ── Identidad de la pestaña ──────────────────────────────────────────
    // Respaldo para el hueco real que existe entre "el partido ha empezado"
    // y "startLiveSync ya ha fijado liveMatchId": durante esos instantes hay
    // estado que guardar y todavía no hay id con el que nombrar la ranura.
    // El prefijo `tab:` NO es decorativo: es lo que distingue una ranura
    // PROVISIONAL de una definitiva. Un matchId real es un slug del tipo
    // `equipo-04082026-ab12-1902` y nunca empieza así, de modo que reconocerlas
    // no depende de adivinar por la forma del texto.
    var PREFIJO_PROV = 'tab:';
    function esProvisional(id) { return String(id || '').indexOf(PREFIJO_PROV) === 0; }

    function tabId() {
        var v = ssGet(TAB_ID);
        if (!v) {
            v = PREFIJO_PROV + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            ssSet(TAB_ID, v);
        }
        return v;
    }

    // El partido que ESTA pestaña está jugando. Vive en sessionStorage
    // porque es lo único que no comparten dos pestañas del mismo usuario.
    function getTabMatchId() { return ssGet(TAB_MATCH) || ''; }

    function setTabMatchId(matchId) {
        if (!matchId) return;
        var anterior = getTabMatchId();
        if (anterior === matchId) return;
        ssSet(TAB_MATCH, matchId);
        // El partido acaba de recibir su id definitivo: la ranura provisional
        // (la que se nombró con el id de la pestaña) se muda a la definitiva.
        // Sin esto quedaría un huérfano que el barrido no sabría de quién es
        // y que el banner de retomar podría llegar a ofrecer.
        if (anterior && anterior !== matchId) {
            var previo = lsGet(claveDe(anterior));
            if (previo && !lsGet(claveDe(matchId))) lsSet(claveDe(matchId), previo);
            // Sólo se retira la ranura de origen si era PROVISIONAL. Si era un
            // partido de verdad, esta pestaña simplemente ha pasado a otro y el
            // anterior no es suyo para borrarlo.
            if (esProvisional(anterior)) {
                lsDel(claveDe(anterior));
                lsDel(claveFinDe(anterior));
            }
        }
    }

    // Con qué nombre guarda ESTA pestaña. Nunca devuelve vacío.
    function slotIdActual(liveMatchId) {
        if (liveMatchId) { setTabMatchId(liveMatchId); return liveMatchId; }
        var propio = getTabMatchId();
        if (propio) return propio;
        // ⚠️ EL ID PROVISIONAL SE REGISTRA COMO EL DE LA PESTAÑA, no se limita a
        // devolverse. Sin esto, `setTabMatchId` no veía ningún "anterior" cuando
        // llegaba el id definitivo y NO mudaba la ranura: lo guardado en el
        // hueco entre "empieza el partido" y "startLiveSync fija el id" quedaba
        // huérfano y el partido arrancaba con el estado en blanco.
        // Lo encontró el guard ejecutándolo; leyendo el código no se veía.
        var prov = tabId();
        ssSet(TAB_MATCH, prov);
        return prov;
    }

    // ── Lectura / escritura de una ranura ────────────────────────────────
    function leer(matchId) {
        if (!matchId) return null;
        // La bandera de finalizado es POR PARTIDO: terminar el Alevín no
        // puede invalidar la ranura del Juvenil, que es el fallo original.
        if (lsGet(claveFinDe(matchId))) return null;
        var raw = lsGet(claveDe(matchId));
        if (!raw) return null;
        try {
            var st = JSON.parse(raw);
            return (st && st.savedAt) ? st : null;
        } catch (e) { return null; }
    }

    function guardar(matchId, state) {
        if (!matchId || !state) return false;
        return lsSet(claveDe(matchId), JSON.stringify(state));
    }

    // Cierra un partido SIN tocar los demás. `marcarFin` levanta la bandera
    // por partido, que es la que evita que una carrera del autoguardado de
    // 5 s resucite la ranura justo después de borrarla.
    function cerrar(matchId, marcarFin) {
        if (!matchId) return;
        lsDel(claveDe(matchId));
        if (marcarFin) lsSet(claveFinDe(matchId), String(Date.now()));
    }

    // ── Inventario ───────────────────────────────────────────────────────
    function listar() {
        var out = [];
        var claves;
        try { claves = Object.keys(localStorage); } catch (e) { return out; }
        for (var i = 0; i < claves.length; i++) {
            var k = claves[i];
            if (k.indexOf(BASE + SEP) !== 0) continue;
            var id = k.slice((BASE + SEP).length);
            var st = leer(id);
            if (st) out.push({ id: id, state: st });
        }
        // Más reciente primero: es el criterio del banner de retomar cuando
        // la pestaña es nueva y no reclama ninguno.
        out.sort(function (a, b) {
            return String(b.state.savedAt).localeCompare(String(a.state.savedAt));
        });
        return out;
    }

    // Cuál ofrecer al recargar. 🔑 PRIMERO EL DE LA PESTAÑA: es lo que hace
    // que dos pestañas recargadas recuperen cada una LO SUYO y no se roben
    // el partido entre ellas.
    function elegir() {
        var propio = getTabMatchId();
        if (propio) {
            var mio = leer(propio);
            if (mio) return { id: propio, state: mio, esDeEstaPestana: true };
        }
        var todas = listar();
        if (!todas.length) return null;
        return { id: todas[0].id, state: todas[0].state, esDeEstaPestana: false };
    }

    // ── Migración desde la clave única (v464 y anteriores) ───────────────
    // ⚠️ OBLIGATORIA Y NO SE PUEDE POSPONER: este despliegue puede caer con
    // partidos EN JUEGO. Si al arrancar no se muda lo que hay en la clave
    // antigua, ese entrenador pierde el partido en curso — justo el daño que
    // venimos a evitar. Es idempotente: al terminar, la clave antigua ya no
    // existe y las siguientes llamadas no hacen nada.
    function migrarLegado() {
        var raw = lsGet(BASE);
        var finLegado = lsGet(FIN_BASE);
        if (!raw && !finLegado) return null;

        // La bandera global antigua se respeta UNA última vez con el
        // significado que tenía ("el último partido terminó") y se retira. A
        // partir de aquí sólo existen banderas por partido.
        if (finLegado) {
            lsDel(BASE);
            lsDel(FIN_BASE);
            return null;
        }

        var st = null;
        try { st = JSON.parse(raw); } catch (e) { st = null; }
        lsDel(BASE);
        if (!st || !st.savedAt) return null;

        var id = st.liveMatchId || ('legacy-' + tabId());
        if (!lsGet(claveDe(id))) lsSet(claveDe(id), JSON.stringify(st));
        // La pestaña que hace la migración adopta ese partido: es la que
        // venía jugándolo antes de la actualización.
        if (!getTabMatchId()) ssSet(TAB_MATCH, id);
        return id;
    }

    // ── Barrido de ranuras caducadas ─────────────────────────────────────
    // Sin esto, cada partido dejaría su ranura para siempre y localStorage
    // (5 MB) acabaría lleno: un estado con la plantilla completa no es
    // pequeño. El tope es generoso a propósito — 6 h cubre cualquier partido
    // con prórroga y sobremesa —; la caducidad REGLAMENTARIA por categoría la
    // sigue decidiendo `_checkActiveMatch`, que es quien la tiene.
    function barrer(maxHoras) {
        var tope = (maxHoras || 6) * 3600 * 1000;
        var ahora = Date.now();
        var claves;
        try { claves = Object.keys(localStorage); } catch (e) { return 0; }
        var n = 0;
        for (var i = 0; i < claves.length; i++) {
            var k = claves[i];
            var esRanura = k.indexOf(BASE + SEP) === 0;
            var esBandera = k.indexOf(FIN_BASE + SEP) === 0;
            if (!esRanura && !esBandera) continue;
            if (esBandera) {
                var ts = Number(lsGet(k));
                if (!ts || (ahora - ts) > tope) { lsDel(k); n++; }
                continue;
            }
            var st = null;
            try { st = JSON.parse(lsGet(k)); } catch (e) { st = null; }
            var ref = st && (st.savedAt || st.createdAt);
            if (!ref || (ahora - new Date(ref).getTime()) > tope) { lsDel(k); n++; }
        }
        return n;
    }

    window._cronosMatchSlots = {
        claveDe:        claveDe,
        claveFinDe:     claveFinDe,
        tabId:          tabId,
        getTabMatchId:  getTabMatchId,
        setTabMatchId:  setTabMatchId,
        slotIdActual:   slotIdActual,
        leer:           leer,
        guardar:        guardar,
        cerrar:         cerrar,
        listar:         listar,
        elegir:         elegir,
        migrarLegado:   migrarLegado,
        barrer:         barrer,
    };

    // Se ejecuta al cargar, antes que cualquier otro módulo: cuando
    // app-init.js pregunte por el partido activo, la mudanza ya está hecha.
    try { migrarLegado(); barrer(6); } catch (e) {
        console.warn('[match-slots] arranque:', e && e.message);
    }
})();
