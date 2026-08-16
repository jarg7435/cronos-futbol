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
//
// ══════════════════════════════════════════════════════════════════════════
//  🚨 v557 · LA PERTENENCIA NO ES DE LA PESTAÑA: ES DEL EQUIPO
//
//  Reportado por el autor (captura 9042): un entrenador con dos equipos
//  (v537) tiene un partido en curso con el Alevín C y, EN LA MISMA PESTAÑA,
//  cambia al Regional A desde el selector del panel. Al preparar el partido
//  del Regional le saltaba *"⚠️ Hay un PARTIDO EN CURSO sin finalizar"*, con
//  el marcador y la fase DEL ALEVÍN, obligándole a reanudar aquél o a perder
//  su progreso.
//
//  🔑🔑🔑 v465 AISLÓ POR PESTAÑA, Y ESE NO ES EL EJE. `cronos_tab_match` vive
//  en sessionStorage, que es por pestaña: dos partidos en dos pestañas quedan
//  separados, pero DOS EQUIPOS EN LA MISMA PESTAÑA comparten el puntero. Al
//  cambiar de equipo, la pestaña seguía "reclamando" el partido del equipo
//  anterior, y todo lo que cuelga de ese puntero —el aviso anti-reinicio, el
//  repintado tras sincronizar, la puerta estanca de los sucesos— hablaba del
//  equipo equivocado.
//
//  🔑🔑 LA UNIDAD ES (clubId + categoría + subcategoría), o sea el `teamId`
//  canónico de `cronosTeamId()` (utils.js). El puntero pasa a ser
//  `cronos_tab_match::<teamId>` y cada estado guardado lleva DENTRO su
//  `teamId`. Así el Alevín y el Regional son dos partidos distintos aunque
//  los lleve la misma persona en la misma pestaña, y el aislamiento por
//  pestaña de v465 SIGUE INTACTO: la clave sigue viviendo en sessionStorage.
//
//  ⚠️ SIN EQUIPO ACTIVO NO CAMBIA NADA. Un entrenador individual (sin club)
//  no tiene `teamId`, y entonces el puntero es el de siempre, `cronos_tab_match`
//  a secas. Es deliberado: ese perfil no tiene equipos entre los que cambiar y
//  no se le puede mover el suelo.
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
    function ssDel(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

    function claveDe(matchId) { return BASE + SEP + matchId; }
    function claveFinDe(matchId) { return FIN_BASE + SEP + matchId; }

    // ── v557 · EL EQUIPO QUE EL ENTRENADOR TIENE ABIERTO AHORA MISMO ──────
    // Se resuelve EN CALIENTE y nunca se cachea: cambiar de equipo en el
    // panel tiene que cambiar de ranura en el acto.
    //
    // ⚠️ ESTE MÓDULO CARGA ANTES QUE utils.js (index.html: match-slots va
    // delante de app-init, y utils va detrás de los dos). Por eso no se puede
    // guardar una referencia a `cronosEquipoElegido` al cargar: se pregunta en
    // cada llamada, que es cuando ya existe. Devolver '' es siempre una salida
    // válida — significa "sin equipo", el comportamiento previo a v557.
    function equipoActual() {
        try {
            if (typeof window !== 'undefined') {
                if (typeof window.cronosEquipoElegido === 'function') {
                    var elegido = window.cronosEquipoElegido();
                    if (elegido) return String(elegido);
                }
                // Respaldo: el entrenador que sólo lleva un equipo puede no
                // haber pasado nunca por el selector.
                if (typeof window.cronosMyTeamId === 'function') {
                    var mio = window.cronosMyTeamId();
                    if (mio) return String(mio);
                }
            }
        } catch (e) { /* sin equipo: se cae al puntero sin sufijo */ }
        return '';
    }

    // El puntero de la pestaña, POR EQUIPO. Sin equipo, la clave de siempre.
    function claveTab(teamId) { return teamId ? (TAB_MATCH + SEP + teamId) : TAB_MATCH; }

    // Normaliza el argumento `teamId` de la API pública: `undefined`/`null`
    // significan "el equipo que esté abierto ahora"; una cadena manda.
    function eqDe(teamId) {
        return (teamId === undefined || teamId === null) ? equipoActual() : String(teamId || '');
    }

    // ¿De qué equipo es este partido? '' si el estado no lo dice (ranuras
    // escritas antes de v557: se tratan como "de cualquiera", que es lo que
    // eran).
    function equipoDe(matchId) {
        var st = leer(matchId);
        return (st && st.teamId) ? String(st.teamId) : '';
    }

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

    // v557 · El id provisional lleva el equipo pegado. Sin esto, el Alevín y
    // el Regional de la MISMA pestaña compartirían ranura provisional durante
    // el hueco previo a `startLiveSync`, que es justo cuando se monta el
    // partido nuevo: el segundo escribiría encima del primero.
    function idProvisional(teamId) {
        var base = tabId();
        return teamId ? (base + '@' + teamId) : base;
    }

    // El partido que ESTA pestaña está jugando CON ESTE EQUIPO. Vive en
    // sessionStorage porque es lo único que no comparten dos pestañas del
    // mismo usuario; y lleva el equipo en la clave porque una misma pestaña
    // atiende a los dos equipos del entrenador (v537).
    function getTabMatchId(teamId) {
        var eq = eqDe(teamId);
        if (!eq) return ssGet(TAB_MATCH) || '';
        var propio = ssGet(claveTab(eq));
        if (propio) return propio;

        // ⚠️ MIGRACIÓN EN CALIENTE (v556 → v557). Este despliegue puede caer
        // con un partido EN JUEGO y la sesión ya abierta: su puntero está en
        // la clave SIN equipo. Se adopta una sola vez —y sólo si la ranura a
        // la que apunta no es de OTRO equipo— y se retira la clave vieja.
        // Sin esto, ese entrenador vería su partido "desaparecer" del panel
        // justo al actualizarse la app.
        var legado = ssGet(TAB_MATCH);
        if (legado) {
            var duenyo = equipoDe(legado);
            if (!duenyo || duenyo === eq) {
                ssSet(claveTab(eq), legado);
                ssDel(TAB_MATCH);
                return legado;
            }
        }
        return '';
    }

    function setTabMatchId(matchId, teamId) {
        if (!matchId) return;
        var eq = eqDe(teamId);
        // 🔑 UN EQUIPO NO PUEDE RECLAMAR EL PARTIDO DE OTRO. Un latido tardío
        // de la retransmisión del Alevín no puede dejar al Regional apuntando
        // a la ranura del Alevín: a partir de ahí el aviso anti-reinicio y la
        // puerta estanca de los sucesos hablarían del equipo equivocado.
        var duenyo = equipoDe(matchId);
        if (eq && duenyo && duenyo !== eq) return;
        var anterior = getTabMatchId(eq);
        if (anterior === matchId) return;
        ssSet(claveTab(eq), matchId);
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
    //
    // v557 · `teamId` es OPCIONAL y significa "la ranura de ESTE equipo, no la
    // del que esté abierto en el panel". Lo necesita el autoguardado: si el
    // entrenador cambia de equipo con un partido a medias, ese partido sigue
    // siendo del equipo anterior y tiene que seguir guardándose en SU ranura.
    //
    // ⚠️ CON `liveMatchId` SE DEVUELVE ÉL Y PUNTO. Nombra un partido concreto:
    // es lo que usan `endMatch` y `resetMatch` para cerrar exactamente ese y
    // no el que tenga delante el panel. Quien filtra por equipo es
    // `setTabMatchId`, que puede negarse a mover el puntero sin afectar al
    // valor devuelto.
    function slotIdActual(liveMatchId, teamId) {
        var eq = eqDe(teamId);
        if (liveMatchId) { setTabMatchId(liveMatchId, eq); return liveMatchId; }
        var propio = getTabMatchId(eq);
        if (propio) return propio;
        // ⚠️ EL ID PROVISIONAL SE REGISTRA COMO EL DE LA PESTAÑA, no se limita a
        // devolverse. Sin esto, `setTabMatchId` no veía ningún "anterior" cuando
        // llegaba el id definitivo y NO mudaba la ranura: lo guardado en el
        // hueco entre "empieza el partido" y "startLiveSync fija el id" quedaba
        // huérfano y el partido arrancaba con el estado en blanco.
        // Lo encontró el guard ejecutándolo; leyendo el código no se veía.
        var prov = idProvisional(eq);
        ssSet(claveTab(eq), prov);
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

    // v557 · TODO ESTADO SALE SELLADO CON SU EQUIPO. Es el dato con el que
    // después se decide de quién es cada ranura; si faltara, el partido del
    // Alevín podría acabar contándose como del Regional. Quien ya trae
    // `teamId` (el autoguardado, que conoce al dueño real aunque el panel esté
    // enseñando otro equipo) manda: aquí sólo se rellena si viene vacío.
    function guardar(matchId, state) {
        if (!matchId || !state) return false;
        if (!state.teamId) {
            var eq = equipoActual();
            if (eq) {
                try { state = Object.assign({}, state, { teamId: eq }); }
                catch (e) { /* navegador sin Object.assign: se guarda sin sello */ }
            }
        }
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
    // v557 · `teamId` es OPCIONAL y FILTRA. Sin él se devuelven TODAS las
    // ranuras, que es lo que necesita el panel "🔄 Recuperar Partido": el
    // entrenador tiene que poder rescatar desde ahí el partido del otro equipo.
    // Con él se devuelven las de ese equipo — y las que no llevan sello,
    // escritas antes de v557, que no son de nadie en concreto.
    function listar(teamId) {
        var filtro = teamId ? String(teamId) : '';
        var out = [];
        var claves;
        try { claves = Object.keys(localStorage); } catch (e) { return out; }
        for (var i = 0; i < claves.length; i++) {
            var k = claves[i];
            if (k.indexOf(BASE + SEP) !== 0) continue;
            var id = k.slice((BASE + SEP).length);
            var st = leer(id);
            if (!st) continue;
            if (filtro && st.teamId && String(st.teamId) !== filtro) continue;
            out.push({ id: id, state: st });
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
    // v557 · Y DENTRO DE LA PESTAÑA, EL DEL EQUIPO ABIERTO: si no, al volver
    // al Regional se le ofrecería retomar el partido del Alevín.
    function elegir() {
        var eq = equipoActual();
        var propio = getTabMatchId(eq);
        if (propio) {
            var mio = leer(propio);
            if (mio) return { id: propio, state: mio, esDeEstaPestana: true };
        }
        var todas = listar(eq);
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
        claveTab:       claveTab,
        equipoActual:   equipoActual,
        equipoDe:       equipoDe,
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
