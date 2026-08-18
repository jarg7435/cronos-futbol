// ════════════════════════════════════════════════════════════════════
//  PURGA DE UN PARTIDO — definición única (2026-08-13)
// ════════════════════════════════════════════════════════════════════
//  REGLA DEL AUTOR, fijada el 2026-08-13:
//
//   1. Los informes colectivos y su acumulado PERMANECEN toda la temporada,
//      jornada tras jornada. La sumatoria refleja ÚNICAMENTE los partidos que
//      siguen activos. Si alguien elimina definitivamente un informe, sus
//      datos se purgan y se descuentan del acumulado del equipo: no pueden
//      quedar datos fantasma.
//   2. Los "partidos terminados" son un REGISTRO TEMPORAL (la ventana de 10 h)
//      e independiente de los informes colectivos permanentes.
//
//  🔑🔑 POR QUÉ ESTE MÓDULO EXISTE. El borrado se dispara desde DOS sitios —el
//  botón 💣 del panel de Informes y el 🗑️ de Partidos Terminados— y hasta
//  ahora cada uno borraba una cosa distinta: el primero todo, el segundo UN
//  SOLO documento. Con dos implementaciones, "purga total" significaba dos
//  cosas y el acumulado quedaba sucio según por dónde hubieras entrado. Aquí
//  hay UNA definición y los dos botones la llaman.
//
//  🔑🔑 UN PARTIDO NO ES UN DOCUMENTO, SON MUCHOS. Por cada jugador se
//  escriben hasta cuatro copias con ids distintos —{mid}_staff_p7,
//  {mid}_coach_p7, {mid}_p7 y {mid}_parent_{uid}_p7— desde TRES ficheros
//  (match-reports-auto.js, match-reports-send.js y collective-report.js).
//
//  ⚠️⚠️ DOS TRAMPAS MEDIDAS, y son la razón de que aquí NO se inventen ids:
//   · `deleteDoc` sobre un id que no existe **NO falla**: es idempotente. Ids
//     reconstruidos a mano se contarían como borrados y el resumen mentiría.
//   · En las reglas, borrar un documento inexistente deja `resource` a null y
//     por tanto DENIEGA, así que esos mismos ids sumarían falsos "sin
//     permiso".
//  Se parte del id REAL que trae cada documento cargado y de una consulta
//  `where('matchId','==',mid)`, que es además lo único que alcanza las copias
//  de los PADRES —ningún panel de staff las tiene cargadas—.
//
//  ⚠️ firestore.rules sólo deja borrar al AUTOR (`coachUid`) y al SuperAdmin.
//  Un director NO puede borrar los informes de otro entrenador. Se devuelven
//  los dos recuentos para que quien llame diga la verdad en vez de fingir un
//  éxito.
// ════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var FS_URL = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

    function _fs() {
        var fa = window._cronos_auth;
        if (!fa || !fa.db) return null;
        return fa.db;
    }

    // Todos los informes de un partido: los ids que ya se tienen delante más
    // los que devuelva la consulta por matchId. Devuelve un array sin repetir.
    //
    // ⚠️ NO LANZA si la consulta falla: se sigue con los ids conocidos. Perder
    // la consulta significa borrar de menos, que es recuperable; lanzar aquí
    // dejaría el partido a medio borrar.
    window.cronosRecogerInformesDePartido = async function (matchId, docIdsExtra) {
        var ids = {};
        (docIdsExtra || []).forEach(function (id) { if (id) ids[id] = true; });

        var mid = String(matchId || '');
        var midValido = mid && mid !== 'undefined';
        var db = _fs();
        if (midValido && db) {
            try {
                var mod = await import(FS_URL);
                var snap = await mod.getDocs(mod.query(
                    mod.collection(db, 'cronos_player_reports'),
                    mod.where('matchId', '==', mid)));
                snap.forEach(function (d) { ids[d.id] = true; });
            } catch (e) {
                console.warn('[Purga] no se pudo consultar por matchId:',
                             e && e.message ? e.message : e);
            }
        }
        return Object.keys(ids);
    };

    // Borra los informes indicados. Devuelve { borrados, denegados }.
    window.cronosPurgarInformes = async function (ids) {
        var res = { borrados: 0, denegados: 0 };
        var db = _fs();
        if (!db || !ids || !ids.length) return res;

        var mod = await import(FS_URL);
        for (var i = 0; i < ids.length; i++) {
            try {
                await mod.deleteDoc(mod.doc(db, 'cronos_player_reports', ids[i]));
                res.borrados++;
            } catch (e) {
                res.denegados++;
                console.warn('[Purga] no se pudo borrar ' + ids[i] + ':',
                             e && e.code ? e.code : e);
            }
        }
        return res;
    };

    // Borra el documento del partido en vivo (el registro temporal de 10 h).
    //
    // ⚠️ SE COMPRUEBA QUE EXISTE ANTES. deleteDoc es idempotente, así que sin
    // esta lectura se anunciaría haber borrado un partido que no estaba. Y
    // ojo: cuando un informe no trae matchId, el panel cae al id del propio
    // documento, de modo que aquí puede llegar un id que no es de live_matches.
    window.cronosBorrarPartidoEnVivo = async function (matchId) {
        var db = _fs();
        var mid = String(matchId || '');
        if (!db || !mid || mid === 'undefined') return false;
        try {
            var mod = await import(FS_URL);
            var ref = mod.doc(db, 'live_matches', mid);
            var s = await mod.getDoc(ref);
            if (!s.exists()) return false;
            await mod.deleteDoc(ref);
            // v572 · P2 · Y su índice ligero. Una purga que dejara el índice
            // vivo sería peor que no purgar: el partido desaparece de los
            // informes pero su tarjeta sigue en la lista de Partidos en Vivo,
            // que consulta `live_index`. Aquí NO se comprueba existencia —
            // `deleteDoc` es idempotente (ver la cabecera de este fichero) y el
            // valor devuelto lo decide el borrado del partido, no el del índice.
            try { await mod.deleteDoc(mod.doc(db, 'live_index', mid)); }
            catch (eIdx) { console.warn('[Purga] índice no borrado:', eIdx && eIdx.code ? eIdx.code : eIdx); }
            return true;
        } catch (e) {
            console.warn('[Purga] el partido en vivo no se pudo borrar:',
                         e && e.code ? e.code : e);
            return false;
        }
    };

    // Purga completa. opts = { matchId, docIds, borrarPartidoEnVivo }
    // Devuelve { ids, borrados, denegados, partidoBorrado }.
    window.cronosPurgarPartido = async function (opts) {
        opts = opts || {};
        var ids = await window.cronosRecogerInformesDePartido(opts.matchId, opts.docIds);
        var r = await window.cronosPurgarInformes(ids);
        var partidoBorrado = false;
        if (opts.borrarPartidoEnVivo) {
            partidoBorrado = await window.cronosBorrarPartidoEnVivo(opts.matchId);
        }
        return { ids: ids, borrados: r.borrados, denegados: r.denegados,
                 partidoBorrado: partidoBorrado };
    };

    // Mensaje único para las dos pantallas: que digan lo mismo ante el mismo
    // resultado, y que NUNCA anuncien un borrado que no ha ocurrido.
    window.cronosResumenPurga = function (r) {
        r = r || {};
        if (!r.borrados && !r.partidoBorrado) {
            return r.denegados
                ? '⛔ No se ha borrado nada: sólo el entrenador que creó el partido (o el SuperAdmin) puede eliminarlo.'
                : '⚠️ No se encontró ningún documento que borrar.';
        }
        return '🗑️ Purgado · ' + r.borrados + ' informe' + (r.borrados === 1 ? '' : 's') +
               (r.partidoBorrado ? ' + el registro del partido' : '') +
               (r.denegados ? ' · ⚠️ ' + r.denegados + ' sin permiso (de otro entrenador)' : '') +
               ' · el acumulado queda descontado';
    };

    // ⚠️ ESTE MÓDULO NO REPINTA NADA, Y ASÍ DEBE SEGUIR. Hubo aquí un
    // `cronosRefrescarTrasPurga` que llamaba a los renderizadores de las dos
    // pestañas, y los guards de ambos paneles lo cazaron como consumidor
    // externo — con razón: convertía una utilidad de DATOS en una pieza
    // acoplada a dos pantallas. Cada llamador refresca la suya.
    //
    // ⚠️ Y por eso este comentario no escribe los nombres de esas funciones:
    // el censo de la aserción 1c de test_finished_matches_module.js busca el
    // identificador en TODO el fichero, comentarios incluidos.
    //
    // No hace falta más: los dos paneles son pantallas distintas y no se ven a
    // la vez. El acumulado se deriva de los informes vivos, así que al abrir
    // Informes se recalcula solo y ya sale descontado.
})();
