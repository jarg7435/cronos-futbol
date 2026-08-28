// ══════════════════════════════════════════════════════════════════
//  🪶 v639 · EL ÍNDICE LIGERO DE PARTIDOS TERMINADOS
//  (`finished_index/{matchId}` — UN documento por PARTIDO)
// ══════════════════════════════════════════════════════════════════
//
//  EL PROBLEMA QUE RESUELVE, medido contra producción antes de escribir nada
//  (club CD DÍA, 2026-08-27):
//
//      documentos en cronos_player_reports del club ....... 5.436
//      peso que descargaba la pestaña .................... 10,5 MB
//      🔑 PARTIDOS DE VERDAD ................................ 176
//
//  `cronos_player_reports` guarda UN INFORME POR JUGADOR Y PARTIDO — unos 31
//  por partido—, así que construir una lista de PARTIDOS desde ahí siempre
//  bajará ~31 veces de más. v638 lo hizo usable (agrupando por `matchId` y
//  acotando con orderBy+limit), pero el desperdicio seguía y crece con la
//  temporada: es lo que quedó anotado como "la solución duradera".
//
//  🔑 LA ASIMETRÍA QUE LO HACE POSIBLE — la misma que en `live_index` (v572):
//  la tarjeta de la lista no usa casi nada del informe. De `events`, que es lo
//  que más crece, sólo usa **su longitud** para escribir "📍 N eventos"
//  (finished-matches-tab.js). Nada más. Así que aquí se guarda `eventsCount`,
//  un entero, en vez del array.
//
//  Resultado: ~400 B por PARTIDO en vez de ~31 documentos × ~2 KB.
//
//  ══════════════════════════════════════════════════════════════════
//  ⚠️⚠️ LO QUE NO SE PUEDE HACER AQUÍ, y por qué (lecciones ya pagadas)
//  ══════════════════════════════════════════════════════════════════
//
//  1. ⚠️ NO VA EN UN `writeBatch` CON LOS INFORMES. Un batch es atómico: si
//     esta escritura fallara —reglas sin desplegar todavía, un índice compuesto
//     que falta, cuota— se caería TAMBIÉN el despacho de informes. Eso
//     convierte una optimización en pérdida de datos del partido. Se escribe
//     aparte, con su propio `catch` mudo. Copiado tal cual de `_pushLiveIndex`
//     (live/sync.js), que ya razonó esto para el directo.
//
//  2. ⚠️ SI FALLA, NO PASA NADA. El lector cae solo al camino de v638 (barrer
//     `cronos_player_reports` acotado). El índice ACELERA; no es la fuente de
//     la verdad. Esa propiedad es lo que permite desplegarlo sin backfill
//     previo y sin ventana de "la pestaña está vacía".
//
//  3. ⚠️ ESTE DOCUMENTO LLEVA PII — nombres de equipo, categoría de menores—,
//     así que sus reglas son las MISMAS que las de `cronos_player_reports`. No
//     es "público" por ser pequeño. Misma advertencia que en `live_index`.
//
//  4. ⚠️ MUERE CON SU TITULAR. Es el acompañante de `cronos_player_reports`, no
//     de `live_matches` (ése ya lo tiene: `live_index`, y muere con el partido
//     en vivo — por eso no servía para el histórico). Un índice que sobreviva a
//     un borrado es peor que no tener índice: el partido desaparece de los
//     informes y su tarjeta sigue en la lista, con la PII dentro. Cableado en
//     season-reset.js (ACOMPAÑANTES), delete-club.js y match-purge.js.
//
//  5. 🔑 HAY TRES FLUJOS DE DESPACHO, no uno: el automático al terminar
//     (match-reports-auto.js), el manual (match-reports-send.js) y el informe
//     colectivo (collective-report.js). Los tres llaman a esta función UNA vez
//     por partido — no una por jugador. Escribir el índice a mano en cada uno
//     habría sido el mismo defecto en tres ficheros, que es la lección de v551.
//     Lo vigila scripts/test_finished_index.js (parte 1).
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const FS_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

    // Normaliza lo que cada flujo tiene a mano a la forma ÚNICA del índice.
    // ⚠️ Los tres flujos nombran las cosas distinto (`rival` vs `awayName`,
    //    `scoreHome` vs `goalsHome`), así que la traducción vive AQUÍ y no
    //    repartida por los tres: si mañana aparece un cuarto flujo, sólo tiene
    //    que traer los datos, no acordarse de las equivalencias.
    function _normalizar(d) {
        const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        const txt = (v) => (v === null || v === undefined ? '' : String(v));

        return {
            matchId:      txt(d.matchId),
            clubId:       d.clubId || null,
            // Las tres identidades por las que se consulta. `createdBy` y
            // `coachUid` suelen ser el mismo uid, pero no siempre: un partido
            // recuperado conserva su creador original.
            createdBy:    d.createdBy || d.coachUid || null,
            coachUid:     d.coachUid || d.createdBy || null,
            coachEmail:   d.coachEmail || null,

            homeName:     txt(d.homeName),
            homeScore:    num(d.scoreHome),
            homeColor:    txt(d.homeColor)  || '#58a6ff',
            homeShorts:   txt(d.homeShorts) || '#1a4e99',
            homeText:     txt(d.homeText)   || '#000000',

            awayName:     txt(d.awayName),
            awayScore:    num(d.scoreAway),
            awayColor:    txt(d.awayColor)  || '#ff5858',
            awayShorts:   txt(d.awayShorts) || '#b22222',
            awayText:     txt(d.awayText)   || '#ffffff',

            category:     txt(d.category),
            subcategory:  txt(d.subcategory),
            mode:         txt(d.mode) || 'f7',
            matchDate:    txt(d.matchDate),
            // 🔑 CADENA ISO, como en `cronos_player_reports`. Una ISO ordena
            //    lexicográficamente igual que cronológicamente, y es lo que
            //    permite el `orderBy('createdAt','desc')` del lector. Mezclar
            //    aquí un número o un Timestamp rompería ese orden en silencio.
            createdAt:    txt(d.createdAt) || new Date().toISOString(),

            // 🔑 EL ENTERO, NO EL ARRAY. La tarjeta sólo escribe "📍 N eventos".
            //    Guardar `events` aquí devolvería el problema que esto arregla.
            eventsCount:  num(d.eventsCount),

            // ══════════════════════════════════════════════════════════
            //  ⏳ v640 · LA VENTANA DE 10 HORAS DE LA SECCIÓN
            //
            //  Regla de negocio (implementar.txt 2026-08-28): la sección
            //  «Partidos Terminados» es un REGISTRO TEMPORAL de 10 h desde el
            //  final del encuentro — 2 h de margen para corregir informes
            //  (la ventana de incidencias que ya gobierna CronosMatchLock) +
            //  8 h para poder descargarlo. Pasadas las 10 h desaparece de la
            //  SECCIÓN.
            //
            //  ⚠️⚠️ DESAPARECE DE LA SECCIÓN, NO SE BORRA EL INFORME. Los
            //  informes colectivos e individuales PERMANECEN TODA LA
            //  TEMPORADA: son los que alimentan «Mis Informes», el resumen de
            //  temporada, la exportación CSV/PDF y el Gantt de minutos. Este
            //  índice es una VISTA de esa sección, no el archivo.
            //
            //  🔑 EL ANCLA ES `finishedAt`, no `updatedAt`: si contara desde
            //  la última escritura, corregir un informe dentro de las 2 h de
            //  margen reiniciaría el reloj y el partido se quedaría otras 10 h.
            //  Es la misma razón por la que v434 quitó ese filtro de la Cloud
            //  Function.
            // ══════════════════════════════════════════════════════════
            finishedAt:   txt(d.finishedAt) || txt(d.createdAt) || new Date().toISOString(),
            expireAt:     txt(d.expireAt) || new Date(
                              (Date.parse(txt(d.finishedAt) || txt(d.createdAt)) || Date.now())
                              + ((window.CronosMatchLock && window.CronosMatchLock.RETENTION_MS)
                                 || 10 * 60 * 60 * 1000)
                          ).toISOString(),

            // De dónde sacar el detalle cuando se abre la ficha.
            source:       txt(d.source) || 'cronos_player_reports',
            docId:        txt(d.docId) || txt(d.matchId),

            updatedAt:    new Date().toISOString(),
        };
    }

    // Escritura aislada, silenciosa y jamás bloqueante (ver punto 1 y 2 arriba).
    async function _cronosIndexarPartidoTerminado(datos) {
        try {
            const fa = window._cronos_auth;
            if (!fa || !fa.db) return false;
            if (!datos || !datos.matchId) return false;

            const idx = _normalizar(datos);
            const { doc, setDoc } = await import(FS_URL);
            await setDoc(doc(fa.db, 'finished_index', idx.matchId), idx, { merge: true });
            return true;
        } catch (e) {
            // Un fallo aquí NO puede afectar al despacho de informes. El lector
            // se da cuenta solo (no encuentra documentos) y cae al camino de
            // v638 sobre `cronos_player_reports`.
            console.warn('[v639] Índice de partido terminado no escrito:', e && e.message);
            return false;
        }
    }

    // Borrado del índice de UN partido. Idempotente: borrar lo que no existe no
    // es un error, igual que en match-purge.js.
    async function _cronosBorrarIndicePartido(matchId) {
        try {
            const fa = window._cronos_auth;
            if (!fa || !fa.db || !matchId) return false;
            const { doc, deleteDoc } = await import(FS_URL);
            await deleteDoc(doc(fa.db, 'finished_index', String(matchId)));
            return true;
        } catch (e) {
            console.warn('[v639] Índice de partido terminado no borrado:', e && e.message);
            return false;
        }
    }

    window._cronosIndexarPartidoTerminado = _cronosIndexarPartidoTerminado;
    window._cronosBorrarIndicePartido     = _cronosBorrarIndicePartido;
    // Expuesta para el arnés: la normalización es donde se pueden colar las
    // equivalencias mal puestas, y se prueba sin tocar Firestore.
    window._cronosNormalizarIndicePartido = _normalizar;
})();
