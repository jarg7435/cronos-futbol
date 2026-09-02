// ════════════════════════════════════════════════════════════════════
//  ➕ AÑADIR INFORME · EL PARTIDO QUE NO SE PUDO CRONOMETRAR (v659)
//  js/coach/comms/manual-report.js
// ════════════════════════════════════════════════════════════════════
//
//  QUÉ ES. Encargo del autor: un entrenador se queda sin cobertura, sin
//  batería o sencillamente se le olvida abrir la app, y ese partido no existe
//  para el club. Esta pantalla —dentro de «Mis Informes»— deja registrarlo a
//  mano después: la jornada, el partido, la convocatoria, los goles, las
//  tarjetas, las lesiones, los cambios con su minuto y los minutos de cada
//  futbolista.
//
//  ══════════════════════════════════════════════════════════════════
//  🔑 LA DECISIÓN QUE GOBIERNA TODO EL FICHERO: NO HAY FORMATO NUEVO
//  ══════════════════════════════════════════════════════════════════
//  Un informe manual escribe EXACTAMENTE los mismos documentos que un partido
//  cronometrado, en la misma colección y con los mismos nombres de campo:
//
//      cronos_player_reports/{matchId}_staff_p{dorsal}    staffReport:true
//      cronos_player_reports/{matchId}_coach_p{dorsal}    _forCoach:true
//      cronos_player_reports/{matchId}_parent_{uid}_p{n}  type:parent_player_report
//      finished_index/{matchId}                            (índice ligero v639)
//
//  Por eso «se integra» sin que ningún lector se entere: el Panel de Dirección
//  (informe colectivo), «Mis Informes», el resumen acumulado de temporada, el
//  Gantt de minutos, la exportación CSV/PDF y el panel de las familias ya
//  saben leer esto. Inventar aquí una colección `informes_manuales` habría
//  obligado a tocar los seis lectores —y a que el séptimo se olvidara.
//
//  ⚠️ Y POR ESO EL HISTORIAL SE ESCRIBE EN TEXTO Y SE PASA POR EL PARSER
//  ÚNICO. Los sucesos se componen con la MISMA cadena que `logMovement`
//  ("GOL a las 12:00 (1ªP) (RETRO)") y se convierten con
//  `_parseHistoryForFirestore` (comms/panel.js), que es quien decide qué es un
//  `sub_in`, qué es un apunte de fase y qué es un evento retroactivo. Fabricar
//  aquí los objetos {type, minute} a mano sería una SEGUNDA definición del
//  formato, y el día que el parser cambie sólo se enteraría una de las dos.
//  Es la lección de v551 (el mismo defecto repetido en cuatro ficheros).
//
//  🔴 LA MARCA `(RETRO)` NO ES DECORATIVA. El motor de informes pinta esos
//  sucesos con el borde discontinuo de «Evento perdido» (report-engine.js,
//  RETRO_COLOR). Un informe rellenado a mano DEBE distinguirse en pantalla del
//  que midió el cronómetro: si no, el club no puede saber qué dato es medido y
//  cuál es recordado. Se reutiliza la marca que ya existía desde v531 en vez
//  de crear una nueva.
//
//  ⚠️ LO QUE NO SE PUEDE ESCRIBIR EN LA NOTA: «(DESCANSO)», «(FIN)» y, en una
//  entrada, «(2ªP)». Son las etiquetas con las que la app apunta la
//  contabilidad automática de fase, y `indicesDeFase` (report-engine.js) las
//  DESCARTA como si no fueran cambios. Un cambio real etiquetado así
//  desaparecería del informe sin ningún error. Aquí la fase va como «(1ªP)» o
//  «(2ªP)» sólo en los sucesos que no son entradas, igual que hace el modal de
//  eventos perdidos.
//
//  ── EL SELECTOR DE JORNADA SALE DEL CALENDARIO OFICIAL ───────────────
//  Si el club importó el calendario de la federación (v609-v658), la lista de
//  partidos ya está en `trainingPlans/{clubId}/weeks/CALENDARIO__{mes}` y se
//  lee con `calPartidosDeEquipo()`. No se duplica aquí la forma del almacén:
//  el día que cambie, cambia en un sitio. Y si NO hay calendario importado
//  —o el partido no está en él— la pantalla no se queda inservible: hay una
//  opción «otro partido» con fecha, rival y localía a mano.
//
//  ── ⚖️ LA NORMATIVA DE COMPETICIÓN (tipo de partido × modalidad) ────
//  Regla del autor (2026-09-02). El formulario tiene un selector Liga /
//  Amistoso y de él dependen los cupos:
//
//      LIGA      · F7 → 14 convocados · 7 titulares
//                · F11 → 18 convocados · 11 titulares
//      AMISTOSO  · convocatoria ABIERTA, sin tope de convocados
//                · pero el tope de TITULARES SE MANTIENE (7 / 11)
//
//  🔑 POR QUÉ EL AMISTOSO NO RELAJA LOS TITULARES: el tope de convocados es
//  ADMINISTRATIVO —lo fija el acta de la federación, y en un amistoso no hay
//  acta—, mientras que el de titulares es DE JUEGO: en el campo hay siete u
//  once, se juegue lo que se juegue.
//
//  🔑 LOS NÚMEROS NO ESTÁN AQUÍ. Viven en `cronosCupoConvocatoria`
//  (js/core/utils.js), que es también donde queda anotado que 14/18 y 7/11
//  están además escritos en línea en otros cuatro sitios del repositorio (el
//  camino del partido EN VIVO), sin tocar en esta ronda.
//
//  ⚠️ DOS CAPAS, COMO EN v506, Y HACEN FALTA LAS DOS:
//   A · BLOQUEO EN ORIGEN — la casilla del convocado 15 (o del titular 8) no
//       marca nada y avisa. Y SÓLO SE FRENA LO QUE AÑADE: desmarcar pasa
//       siempre, porque si no el jugador de más quedaría ATRAPADO y sería
//       imposible bajar del tope (ésa fue la lección C de v506).
//   B · BLOQUEO AL GUARDAR — el estado inválido puede llegar por otra vía: una
//       convocatoria de 16 hecha como AMISTOSO y luego cambiada a LIGA. Ahí no
//       hubo ningún clic que frenar, así que el aviso se pinta en ROJO y el
//       botón de guardar queda deshabilitado.
//  El rojo BLOQUEA y el naranja sólo AVISA, y esa diferencia es de normativa:
//  pasarse del cupo es imposible en un partido de verdad; quedarse CORTO de
//  titulares (un equipo que llega justo) sí pudo pasar, y bloquearlo sería
//  impedir registrar un partido que ocurrió.
//
//  ── ⚖️ LA CONGRUENCIA GOLES ↔ MARCADOR (v663) ───────────────────────
//  Encargo del autor: que no se pueda invertir el marcador. En este formulario
//  TODO gol es de un convocado nuestro —no existe «gol del rival»—, así que la
//  cuenta de goles de los sucesos se compara con «Nuestros goles» sin ninguna
//  ambigüedad, y la localía no interviene.
//    ⛔ más goleadores que goles → IMPOSIBLE, bloquea.
//    ⚠️ menos goleadores que goles → LEGÍTIMO (gol en propia del rival, o no
//       recuerda quién marcó), sólo avisa.
//    🔄 si los goles anotados cuadran EXACTAMENTE con los del rival, es la
//       firma del marcador tecleado al revés: se dice y se ofrece invertirlo.
//  Todo en `_mrCongruencia`, y el panel se pinta en `_mrPintarGuardar`, que es
//  lo único que se repinta con cada cambio.
//
//  ── LOS MINUTOS SE CALCULAN, PERO MANDA ÉL ──────────────────────────
//  Se derivan de la convocatoria (quién salió de inicio) y de los cambios, que
//  es como los cuenta el cronómetro. La roja CIERRA el tiempo del expulsado
//  —un expulsado no sigue jugando— y por eso genera además su salida en el
//  historial: sin ella la barra del Gantt le llegaría hasta el final.
//  Cualquier casilla se puede corregir a mano; corregida, el cálculo ya no la
//  vuelve a pisar.
//
//  ── IDEMPOTENCIA Y, SOBRE TODO, EL NOMBRE DEL DOCUMENTO ─────────────
//  El `matchId` es DETERMINISTA (uid + fecha + rival), como en los tres
//  despachos que ya existían: guardar dos veces el mismo partido SOBREESCRIBE.
//
//  🔴🔴 Y EMPIEZA POR `match_`, QUE NO ES UN DETALLE: es la clave con la que
//  «Mis Informes» ordena y acota su consulta. Nacer con otro prefijo hacía el
//  informe INVISIBLE en esa pantalla aunque estuviera perfectamente guardado.
//  La explicación entera está junto a `_mrMatchId`, más abajo. LÉELA antes de
//  tocar el nombre.
//
//  ⚠️ CERO REGLAS NUEVAS. `cronos_player_reports` ya deja crear a quien firma
//  con su propio `coachUid`, y `finished_index` igual. En este proyecto
//  testeo comparte base de datos y reglas con producción, así que una regla
//  nueva no se puede probar antes: se evita.
//
//  DEPENDE (todo resuelto en tiempo de click, no en tiempo de carga):
//    · comms/panel.js  — _cFS, _parseHistoryForFirestore, _cGetStaff,
//      _cResolveClubId, _cronosResolveParentReportTargets, _cStaffThreadId
//    · core/utils.js   — cronosMyTeam, cronosPlantillaAmbas, cronosTeamId,
//      cronosNombreCategoria, cronosHayPadres, _cronosResolveStaffForMatch
//    · reports/calendario-temporada.js — calPartidosDeEquipo
//    · match/live/finished-index.js    — _cronosIndexarPartidoTerminado
//    · formatTime, escapeHtml, showToast/showSpinner/hideSpinner, navScreen
//
//  Test: scripts/test_informe_manual.js
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── Utilidades locales ───────────────────────────────────────────
    function _mrE(s) {
        if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : s);
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _mrToast(m, ms) { if (typeof showToast === 'function') showToast(m, ms || 3500); }
    function _mrNum(v, def) { var n = parseInt(v, 10); return isFinite(n) ? n : (def || 0); }

    async function _mrFS() {
        if (typeof _cFS === 'function') return _cFS();
        var m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        return Object.assign({}, m, { db: window._cronos_auth && window._cronos_auth.db });
    }

    // MM:SS a partir de minutos enteros. Es el formato en el que los TRES
    // escritores guardan `minutesPlayed` (una CADENA, no un número): mezclar
    // aquí un entero rompería `_segundosJugados` del motor de informes.
    function _mrMMSS(minutos) {
        var seg = Math.max(0, Math.round((minutos || 0) * 60));
        if (typeof formatTime === 'function') return formatTime(seg);
        var mm = Math.floor(seg / 60), ss = seg % 60;
        return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    }

    // ⚠️ MISMA TABLA QUE `getTotMin` (report-engine.js), y por el mismo motivo:
    // no es sólo la escala del Gantt, es el minutaje que se acredita a quien
    // jugó el partido entero. Aquí sólo se usa como VALOR POR DEFECTO del
    // formulario —el entrenador lo puede cambiar—, y lo que se teclee viaja en
    // `duration`, que el motor respeta por encima de la tabla.
    function _mrDuracionPorCategoria(cat) {
        var c = String(cat || '').toLowerCase();
        if (c.indexOf('prebenjamin') !== -1 || c.indexOf('prebenjamín') !== -1) return 60;
        if (c.indexOf('futurefem') !== -1) return 70;
        if (c.indexOf('benjamin') !== -1 || c.indexOf('benjamín') !== -1) return 70;
        if (c.indexOf('alevin') !== -1 || c.indexOf('alevín') !== -1) return 70;
        if (c.indexOf('infantil') !== -1) return 80;
        if (c.indexOf('cadete') !== -1) return 80;
        if (c.indexOf('juvenil') !== -1 || c.indexOf('regional') !== -1 || c.indexOf('senior') !== -1) return 90;
        return 60;
    }

    // ════════════════════════════════════════════════════════════════
    //  🔴🔴 EL IDENTIFICADOR DEL PARTIDO — Y POR QUÉ EMPIEZA POR `match_`
    // ════════════════════════════════════════════════════════════════
    //  🚨 ESTE PREFIJO NO ES COSMÉTICO: ES LA CLAVE DE ORDENACIÓN CON LA QUE
    //     «Mis Informes» DECIDE QUÉ PARTIDOS TRAE. Su consulta es
    //
    //         orderBy('__name__', 'desc') + limit(500)
    //
    //     y eso funciona SÓLO porque todos los informes se llaman
    //     `match_{uid}_{AAAA-MM-DD}_…`: con el uid fijo, ordenar por id es
    //     ordenar por FECHA, así que «los 500 primeros» son «los más
    //     recientes». Lo decidió v508 y está escrito en individual-reports.js.
    //
    //  🔴 LO QUE PASÓ (2026-09-02, reportado por el autor con capturas). La
    //     primera versión de esto llamaba a los partidos `manual_{uid}_…`.
    //     Comparando cadenas, `match_` > `manual_` —la tercera letra, 't' pesa
    //     más que 'n'—, así que en orden DESCENDENTE **TODOS** los `match_*`
    //     del club van delante y los `manual_*` quedan detrás de varios miles.
    //     Con `limit(500)` la ventana nunca llegaba a ellos: el informe se
    //     guardaba bien, se veía en el Panel de Dirección y era INVISIBLE en
    //     «Mis Informes».
    //
    //  🔑 LA ASIMETRÍA QUE LO EXPLICA, Y QUE YA ESTABA DOCUMENTADA: el Panel
    //     de Dirección ordena por `createdAt desc` y «Mis Informes» por
    //     `__name__ desc`. Misma colección, dos consultas distintas — «a él le
    //     llega y a mí no». Es LITERALMENTE el cuadro de v508, repetido porque
    //     aquella corrección dejó una PREMISA TÁCITA: que todo informe se
    //     llamaría `match_…`. Al estrenar un prefijo nuevo, la premisa se rompió
    //     sin que fallara nada.
    //
    //  ⚠️ Y NO VALE «PONERLO ARRIBA DEL TODO» (un prefijo tipo `zmanual_`): los
    //     manuales se comerían la ventana de 500 y a los 10 partidos harían
    //     desaparecer los cronometrados. Van EN SU SITIO CRONOLÓGICO, que es lo
    //     que pidió el autor: «la misma visibilidad que los partidos en
    //     directo». La marca de que es manual viaja en `manualEntry`, no en el
    //     nombre.
    //
    //  ⚠️ CONSECUENCIA HONESTA, y conviene saberla: un informe manual de un
    //     partido MUY antiguo puede caer fuera de esa ventana de 500, igual que
    //     le pasa a un partido en directo de esa misma fecha. La ventana es de
    //     v508 y no se toca aquí; si algún día estorba, se arregla PARA LOS DOS.
    //
    //  ⚠️ SIN EL MARCADOR EN LA CLAVE, al revés que `autoDispatchMatchReports`:
    //     aquí el marcador es un campo del formulario, y corregir un 8-4 mal
    //     tecleado tiene que ARREGLAR el informe, no duplicarlo.
    function _mrMatchId(uid, fecha, rival) {
        var slug = String(rival || 'rival').replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 20);
        return 'match_' + uid + '_' + fecha + '_' + slug + '_manual';
    }

    function _mrHoy() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
               '-' + String(d.getDate()).padStart(2, '0');
    }

    function _mrFechaLarga(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso + 'T12:00:00').toLocaleDateString('es-ES',
                { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
        } catch (e) { return iso; }
    }

    // ── Estado de la pantalla ────────────────────────────────────────
    // Vive en window a propósito: los onclick del marcado son cadenas y
    // necesitan alcanzarlo, igual que hacen el cuadrante y el calendario.
    function _mrEstadoNuevo() {
        return {
            equipo: null,        // { clubId, category, subcategory, teamId }
            partidos: [],        // del calendario oficial
            jugadores: [],       // { ficha, dorsal, nombre, alias }
            sel: -1,             // índice en `partidos`; -1 = a mano
            manual: { fecha: _mrHoy(), rival: '', local: true, jornada: '', hora: '', sede: '' },
            // 'liga' | 'amistoso'. Es el MISMO vocabulario que ya usa la
            // convocatoria del partido en vivo (whatsapp-email.js y
            // ai/import.js manejan 'liga'|'copa'|'amistoso'|'torneo'), a
            // propósito: inventar aquí 'oficial'/'friendly' habría partido en
            // dos la forma de decir lo mismo.
            tipoPartido: 'liga',
            golesPropios: 0,
            golesRival: 0,
            duracion: 60,
            conv: {},            // dorsal -> true (convocado)
            tit: {},             // dorsal -> true (salió de inicio)
            minManual: {},       // dorsal -> minutos escritos a mano
            sucesos: [],         // { id, tipo, minuto, dorsal, dorsalEntra }
            avisarFamilias: true,
            guardando: false,
        };
    }

    // ── El partido elegido, en una sola forma ────────────────────────
    // Da igual que venga del calendario o del formulario manual: de aquí para
    // abajo el resto del fichero maneja UN solo objeto.
    //  🔑 UNA SOLA FUENTE DE VERDAD: `S.manual`.
    //
    //  Antes esto elegía entre DOS sitios —la fila del calendario si había una
    //  seleccionada, y `S.manual` si no—, y `S.sel` mandaba sobre lo que se
    //  veía en pantalla. Con el flujo nuevo (v664) elegir un partido del
    //  calendario RELLENA `S.manual`, así que lo que se guarda es exactamente
    //  lo que hay escrito en las casillas. Eso permite corregir un dato del
    //  calendario —un partido aplazado, un campo cambiado— sin salirse a «otro
    //  partido», y elimina la posibilidad de que la pantalla diga una cosa y el
    //  documento guarde otra.
    //
    //  `S.sel` sobrevive SÓLO para saber qué opción marcar en el desplegable.
    function _mrPartidoElegido(S) {
        var m = S.manual;
        return {
            fecha: m.fecha, rival: String(m.rival || '').trim(), local: m.local !== false,
            jornada: String(m.jornada || ''), hora: m.hora || '', sede: m.sede || '',
        };
    }

    // Vuelca una fila del calendario oficial en los campos del formulario.
    function _mrAplicarDelCalendario(i) {
        var S = window._mrState;
        var p = S.partidos[i];
        if (!p) return false;
        S.sel = i;
        S.manual = {
            fecha:   p.fecha || _mrHoy(),
            rival:   p.rival || '',
            local:   p.local !== false,
            jornada: p.jornada == null ? '' : String(p.jornada),
            hora:    p.hora || '',
            sede:    p.sede || '',
        };
        return true;
    }

    // ── ¿Sobre qué partido del calendario se abre el formulario? ─────
    //  EL MÁS CERCANO A HOY: el último ya jugado —que es el que se viene a
    //  registrar en el 99 % de los casos— y, si aún no se ha jugado ninguno
    //  (temporada recién empezada), el primero. Devuelve el índice, o -1 si no
    //  hay calendario.
    //
    //  🔑 FUNCIÓN APARTE, Y NO UN BUCLE DENTRO DE `openAnadirInforme`, PARA QUE
    //     EL GUARD EJECUTE ESTO Y NO UNA COPIA. Un test que reimplementa la
    //     regla que dice vigilar se pone verde con el defecto puesto: es
    //     exactamente lo que pasó en v620.
    //
    //  ⚠️ `partidos` viene ORDENADO POR FECHA (lo ordena calPartidosDeEquipo),
    //     y de eso depende que el índice 0 sea el más próximo.
    function _mrPreseleccion(partidos, hoy) {
        var lista = Array.isArray(partidos) ? partidos : [];
        var elegido = -1;
        for (var i = 0; i < lista.length; i++) {
            if (lista[i] && lista[i].fecha <= hoy) elegido = i;
        }
        if (elegido < 0 && lista.length) elegido = 0;
        return elegido;
    }

    // ¿Se ofrece el desplegable del calendario oficial?
    //  🔑 SÓLO EN LIGA, y sólo si el equipo tiene calendario importado. Un
    //     amistoso o una copa NO figuran en el calendario regular de la
    //     federación —es la razón por la que el autor pidió separarlos—, así
    //     que ofrecer ahí una lista de jornadas de liga sólo puede inducir a
    //     error.
    function _mrUsaCalendario() {
        var S = window._mrState;
        return S.tipoPartido === 'liga' && S.partidos.length > 0;
    }

    // ════════════════════════════════════════════════════════════════
    //  EL CÁLCULO DE MINUTOS
    // ════════════════════════════════════════════════════════════════
    //  Recorre la línea de tiempo igual que el cronómetro: quien sale de
    //  inicio entra en el minuto 0, cada cambio abre o cierra un tramo, y la
    //  ROJA cierra el tramo del expulsado. Lo que quede abierto al final se
    //  cierra en la duración del partido.
    //
    //  ⚠️ Devuelve minutos por DORSAL, no por ficha: es la clave con la que se
    //  identifica al jugador en toda la cadena de informes
    //  (`playerNumber`, y `ctAccumulatePlayerStats` agrupa por ella).
    function _mrCalcularMinutos(S) {
        var dur = Math.max(1, _mrNum(S.duracion, 60));
        var dentro = {}, desde = {}, total = {};

        S.jugadores.forEach(function (j) {
            if (!S.conv[j.dorsal]) return;
            total[j.dorsal] = 0;
            if (S.tit[j.dorsal]) { dentro[j.dorsal] = true; desde[j.dorsal] = 0; }
        });

        // Los sucesos, en orden de minuto. Con el mismo minuto, primero la
        // salida y después la entrada: si no, un cambio en el 40' le contaría
        // al que entra un tramo que aún ocupa el que sale.
        var orden = { sub_out: 0, red: 0, sub_in: 1 };
        var pasos = [];
        S.sucesos.forEach(function (s) {
            var min = Math.min(dur, Math.max(0, _mrNum(s.minuto, 0)));
            if (s.tipo === 'cambio') {
                if (s.dorsal) pasos.push({ min: min, tipo: 'sub_out', dorsal: s.dorsal });
                if (s.dorsalEntra) pasos.push({ min: min, tipo: 'sub_in', dorsal: s.dorsalEntra });
            } else if (s.tipo === 'roja' && s.dorsal) {
                pasos.push({ min: min, tipo: 'red', dorsal: s.dorsal });
            }
        });
        pasos.sort(function (a, b) { return (a.min - b.min) || (orden[a.tipo] - orden[b.tipo]); });

        pasos.forEach(function (p) {
            if (total[p.dorsal] == null) return;      // no convocado: se ignora
            if (p.tipo === 'sub_in') {
                if (!dentro[p.dorsal]) { dentro[p.dorsal] = true; desde[p.dorsal] = p.min; }
            } else {
                if (dentro[p.dorsal]) {
                    total[p.dorsal] += Math.max(0, p.min - (desde[p.dorsal] || 0));
                    dentro[p.dorsal] = false;
                }
            }
        });

        Object.keys(dentro).forEach(function (d) {
            if (dentro[d]) total[d] += Math.max(0, dur - (desde[d] || 0));
        });

        return total;
    }

    // Los minutos que se GUARDAN: el cálculo, salvo que él haya escrito otra
    // cosa en esa casilla.
    function _mrMinutosFinales(S) {
        var calc = _mrCalcularMinutos(S);
        var out = {};
        Object.keys(calc).forEach(function (d) {
            out[d] = (S.minManual[d] != null) ? Math.max(0, _mrNum(S.minManual[d], 0)) : calc[d];
        });
        return out;
    }

    // ════════════════════════════════════════════════════════════════
    //  DE LOS SUCESOS AL HISTORIAL DE CADA JUGADOR
    // ════════════════════════════════════════════════════════════════
    //  Devuelve { dorsal -> [cadenas] } en el formato de `logMovement`, que es
    //  lo que `_parseHistoryForFirestore` sabe leer. Ver la cabecera: aquí NO
    //  se fabrican los objetos {type, minute} a mano.
    function _mrHistorialPorDorsal(S) {
        var dur = Math.max(1, _mrNum(S.duracion, 60));
        var out = {};
        var apunta = function (dorsal, texto) {
            if (!dorsal) return;
            if (!out[dorsal]) out[dorsal] = [];
            out[dorsal].push(texto);
        };
        // La fase, con el mismo vocabulario que la app. `(2ªP)` en una ENTRADA
        // es la etiqueta ambigua que report-engine resuelve por pareja; sin un
        // «Sale (DESCANSO)» al lado —que aquí no existe— la entrada cuenta como
        // real, que es lo correcto. Ver la advertencia de la cabecera.
        var fase = function (min) { return (min <= dur / 2) ? '1ªP' : '2ªP'; };
        // ⚠️ El minuto va con DOS dígitos: el parser lo lee con /(\d{1,2}):(\d{2})/
        // y un «100:00» le haría entender el minuto 0.
        var sello = function (min) { return String(Math.min(99, Math.max(0, min))).padStart(2, '0') + ':00'; };

        var ordenados = S.sucesos.slice().sort(function (a, b) {
            return _mrNum(a.minuto, 0) - _mrNum(b.minuto, 0);
        });

        var n = 0;
        ordenados.forEach(function (s) {
            var min = Math.min(dur, Math.max(0, _mrNum(s.minuto, 0)));
            var cola = ' a las ' + sello(min) + ' (' + fase(min) + ') (RETRO)';
            if (s.tipo === 'gol')      apunta(s.dorsal, 'GOL' + cola);
            if (s.tipo === 'amarilla') apunta(s.dorsal, 'TARJETA AMARILLA' + cola);
            if (s.tipo === 'lesion')   apunta(s.dorsal, 'LESIÓN' + cola);
            if (s.tipo === 'roja') {
                apunta(s.dorsal, 'TARJETA ROJA' + cola);
                // 🔑 LA EXPULSIÓN CIERRA SU BARRA. Sin esta salida el Gantt le
                // pintaría el partido entero al expulsado, contradiciendo a los
                // minutos que la propia pantalla ya le ha restado.
                apunta(s.dorsal, 'Sale' + cola + ' #' + (900000 + (n++)));
            }
            if (s.tipo === 'cambio') {
                // Pareja emparejable por el informe: comparten el sello #<dígitos>,
                // que es lo único que empareja con exactitud dos cambios en el
                // mismo minuto (report-engine.js, PASO 1 de buildSubs).
                var id = ' #' + (800000 + (n++));
                apunta(s.dorsal, 'Sale' + cola + id);
                apunta(s.dorsalEntra, 'Entra' + cola + id);
            }
        });
        return out;
    }

    // ── Recuento por jugador (goles, tarjetas, lesión) ───────────────
    function _mrResumenPorDorsal(S) {
        var out = {};
        var de = function (d) {
            if (!out[d]) out[d] = { goles: 0, amarillas: 0, roja: false, lesion: false };
            return out[d];
        };
        S.sucesos.forEach(function (s) {
            if (!s.dorsal) return;
            var r = de(s.dorsal);
            if (s.tipo === 'gol')      r.goles++;
            if (s.tipo === 'amarilla') r.amarillas++;
            if (s.tipo === 'roja')     r.roja = true;
            if (s.tipo === 'lesion')   r.lesion = true;
        });
        return out;
    }

    // El campo `cards` de los informes es UNA cadena, no un recuento: 'roja',
    // 'amarilla' o 'ninguna'. Las amarillas se cuentan aparte, desde el
    // historial (`_ctYellowsIn`), así que dos amarillas dejan `cards:'roja'` y
    // las dos siguen contadas. Es exactamente lo que hace el partido en vivo.
    function _mrCards(r) {
        if (!r) return 'ninguna';
        if (r.roja || r.amarillas >= 2) return 'roja';
        if (r.amarillas === 1) return 'amarilla';
        return 'ninguna';
    }

    // ════════════════════════════════════════════════════════════════
    //  PANTALLA
    // ════════════════════════════════════════════════════════════════
    window.openAnadirInforme = async function openAnadirInforme() {
        if (typeof navScreen === 'function') navScreen('openAnadirInforme');

        var modal = document.getElementById('setup-modal');
        if (!modal) return;
        modal.style.display = 'flex';
        modal.innerHTML =
        '<div class="modal-content" style="width:min(96vw,900px);max-height:94vh;' +
             'display:flex;flex-direction:column;overflow:hidden;padding:0;background:#0d1117;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;' +
                        'padding:1rem 1.4rem;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;">' +
                '<div style="display:flex;align-items:center;gap:0.7rem;">' +
                    '<span style="font-size:1.4rem;">➕</span>' +
                    '<div>' +
                        '<div style="font-size:1rem;font-weight:700;color:white;">Añadir informe de partido</div>' +
                        '<div style="font-size:0.7rem;color:var(--text-muted);">' +
                            'Para el partido que no se pudo seguir en directo' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:0.5rem;">' +
                    '<button onclick="navBack()" style="background:rgba(255,255,255,0.05);' +
                        'border:1px solid rgba(255,255,255,0.1);color:var(--text-muted);padding:0.35rem 0.8rem;' +
                        'border-radius:6px;cursor:pointer;font-size:0.74rem;font-weight:600;">← Volver</button>' +
                    '<button onclick="if(typeof navExitToRoles===\'function\') navExitToRoles(); else navExit();" ' +
                        'title="Salir al selector de roles" style="background:none;border:none;color:var(--text-muted);' +
                        'font-size:1.2rem;cursor:pointer;line-height:1;padding:0 0.2rem;">✕</button>' +
                '</div>' +
            '</div>' +
            '<div id="mr-cuerpo" style="flex:1;overflow-y:auto;padding:1.2rem;">' +
                '<div style="text-align:center;padding:3rem;color:var(--text-muted);">' +
                    '<div class="spinner" style="margin:0 auto 1rem;"></div>Preparando el formulario…</div>' +
            '</div>' +
        '</div>';

        var S = window._mrState = _mrEstadoNuevo();

        // ── Equipo del entrenador ────────────────────────────────────
        S.equipo = (typeof window.cronosMyTeam === 'function') ? window.cronosMyTeam() : null;
        if (!S.equipo) {
            _mrPintar(
                '<div style="text-align:center;padding:3rem;color:var(--text-muted);">' +
                '<div style="font-size:2rem;margin-bottom:0.8rem;">⚽</div>' +
                '<div style="font-size:0.95rem;font-weight:600;color:white;margin-bottom:0.4rem;">' +
                'Todavía no tienes equipo asignado</div>' +
                '<div style="font-size:0.8rem;">Un informe pertenece a un equipo: sin categoría asignada no se ' +
                'podría guardar en el sitio correcto. Pídele al club que te asigne el tuyo.</div></div>');
            return;
        }
        S.duracion = _mrDuracionPorCategoria(S.equipo.category);

        // ── La plantilla del equipo abierto (v580) ───────────────────
        // ⚠️ Se juntan las DOS modalidades, igual que hace el resumen de
        // temporada de «Mis Informes»: un mismo entrenador puede tener
        // plantilla de F7 y de F11 y aquí no se distingue.
        S.jugadores = _mrPlantilla();
        if (!S.jugadores.length) {
            _mrPintar(
                '<div style="text-align:center;padding:3rem;color:var(--text-muted);">' +
                '<div style="font-size:2rem;margin-bottom:0.8rem;">📋</div>' +
                '<div style="font-size:0.95rem;font-weight:600;color:white;margin-bottom:0.4rem;">' +
                'Tu plantilla está vacía</div>' +
                '<div style="font-size:0.8rem;">Rellena primero la plantilla del equipo: el informe se construye ' +
                'sobre ella (dorsales y nombres).</div></div>');
            return;
        }

        // ── El calendario oficial, si el club lo importó ─────────────
        // No es obligatorio: sin él se rellena el partido a mano. Un fallo
        // leyéndolo NO puede dejar la pantalla inservible.
        try {
            if (typeof window.calPartidosDeEquipo === 'function') {
                S.partidos = await window.calPartidosDeEquipo(S.equipo.clubId, S.equipo.teamId) || [];
            }
        } catch (e) {
            console.warn('[InformeManual] no se pudo leer el calendario:', e && e.message ? e.message : e);
            S.partidos = [];
        }

        // ══════════════════════════════════════════════════════════════
        //  🔴 SE ABRE SOBRE EL PARTIDO MÁS CERCANO A HOY, NUNCA EN «a mano»
        // ══════════════════════════════════════════════════════════════
        //  Aquí había un fallo medido contra producción el 2026-09-02: esto
        //  sólo preseleccionaba un partido si su fecha era ANTERIOR O IGUAL a
        //  hoy. El calendario real del Alevín C del CD DÍA tiene 30 jornadas y
        //  **la primera es el 12 de septiembre**, así que a principio de
        //  temporada NO HAY NINGÚN PARTIDO PASADO: no se preseleccionaba nada,
        //  el desplegable nacía en «✍️ Otro partido (a mano)» con la fecha de
        //  hoy y el rival vacío… y desde fuera eso se ve exactamente igual que
        //  «el calendario no está importado». Las 30 jornadas estaban ahí, sólo
        //  que había que abrir la lista para verlas.
        //
        //  🔑 Y es lo que pidió el autor: la opción manual se mantiene
        //     «únicamente si se desea», no como punto de partida.
        //
        //  El criterio vive en `_mrPreseleccion`, aparte, para que el guard
        //  ejecute LA DE VERDAD en vez de una copia escrita en el propio test
        //  (la lección de v620).
        var elegido = _mrPreseleccion(S.partidos, _mrHoy());
        if (elegido >= 0) _mrAplicarDelCalendario(elegido);

        _mrPintarFormulario();
    };

    function _mrPintar(html) {
        var c = document.getElementById('mr-cuerpo');
        if (c) c.innerHTML = html;
    }

    // Plantilla del equipo abierto, sin filas vacías y sin repetir dorsal.
    function _mrPlantilla() {
        var roster = {};
        try {
            roster = (typeof window.cronosPlantillaAmbas === 'function') ? window.cronosPlantillaAmbas() : {};
        } catch (e) { roster = {}; }

        var vistos = {}, out = [];
        ['f7', 'f11'].forEach(function (modo) {
            (roster[modo] || []).forEach(function (p) {
                if (!p) return;
                var nombre = String(p.name || '').trim();
                var alias  = String(p.alias || '').trim();
                if (!nombre && !alias) return;                    // fila en blanco
                var dorsal = String(p.number == null ? '' : p.number).trim();
                if (!dorsal) return;                              // sin dorsal no hay clave de informe
                if (vistos[dorsal]) return;
                vistos[dorsal] = true;
                out.push({
                    ficha:  String(p.id || '').trim(),
                    dorsal: dorsal,
                    nombre: nombre || alias,
                    alias:  alias || nombre.split(' ')[0],
                });
            });
        });
        out.sort(function (a, b) { return (parseInt(a.dorsal, 10) || 99) - (parseInt(b.dorsal, 10) || 99); });
        return out;
    }

    // ── El formulario entero ─────────────────────────────────────────
    function _mrPintarFormulario() {
        var S = window._mrState;
        var etiqueta = (typeof window.cronosNombreCategoria === 'function')
            ? window.cronosNombreCategoria(S.equipo.category, S.equipo.subcategory)
            : S.equipo.category;

        _mrPintar(
            '<div style="font-size:0.72rem;color:var(--text-muted);line-height:1.6;margin-bottom:1rem;' +
                 'background:rgba(210,168,255,0.06);border:1px solid rgba(210,168,255,0.22);' +
                 'border-radius:10px;padding:0.6rem 0.8rem;">' +
                '📝 Estás registrando <strong>a mano</strong> un partido de <strong>' + _mrE(etiqueta) + '</strong>. ' +
                'Se guardará como cualquier otro informe —alimenta el informe colectivo del club, tu resumen de ' +
                'temporada y los informes individuales— pero sus sucesos quedarán marcados como ' +
                '<strong style="color:#d2a8ff;">registrados a posteriori</strong>, para que el club sepa qué se ' +
                'midió con el cronómetro y qué se anotó después.' +
            '</div>' +
            _mrBloque('1️⃣', 'El partido', '<div id="mr-partido"></div>') +
            _mrBloque('2️⃣', 'La convocatoria y los titulares',
                // ⚠️ ESTE BLOQUE NO ES DECORATIVO Y SE DICE EN PANTALLA: son las
                // TRES columnas del resumen de temporada. Sin marcar convocados
                // no hay «Conv.», sin marcar titulares no hay «PT», y los
                // minutos son los que reparten «PJ» y el total. Ver la nota
                // larga en la cabecera de `_mrPintarPlantilla`.
                '<div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.6rem;line-height:1.6;">' +
                'Marca <strong style="color:white;">quiénes fueron convocados</strong> y ' +
                '<strong style="color:white;">quiénes salieron de titulares</strong>. Es lo que alimenta el ' +
                'acumulado de la temporada: <strong>Conv.</strong> cuenta las convocatorias, ' +
                '<strong>PT</strong> las titularidades y <strong>PJ</strong> los partidos con minutos. ' +
                'Los minutos se calculan solos con los cambios que anotes abajo; puedes corregir cualquier casilla.' +
                '</div>' +
                '<div id="mr-plantilla"></div>') +
            _mrBloque('3️⃣', 'Los sucesos del partido',
                '<div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.6rem;">' +
                'Goles, tarjetas, lesiones y cambios, cada uno con su minuto. ' +
                'Una <strong style="color:#ff5858;">roja</strong> cierra el tiempo de juego del expulsado.</div>' +
                '<div id="mr-sucesos"></div>') +
            '<div id="mr-guardar"></div>'
        );
        _mrPintarPartido();
        _mrPintarPlantilla();
        _mrPintarSucesos();
        _mrPintarGuardar();
    }

    function _mrBloque(icono, titulo, contenido) {
        return '<div style="border:1px solid rgba(255,255,255,0.09);border-radius:12px;' +
                    'padding:0.9rem 1rem;margin-bottom:0.9rem;background:rgba(255,255,255,0.02);">' +
               '<div style="font-size:0.78rem;font-weight:700;color:white;margin-bottom:0.7rem;">' +
                    icono + ' ' + _mrE(titulo) + '</div>' + contenido + '</div>';
    }

    var _MR_INPUT = 'background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.15);color:white;' +
                    'border-radius:7px;padding:0.35rem 0.5rem;font-size:0.76rem;font-family:inherit;';

    // ── 1️⃣ El partido ───────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════
    //  1️⃣ EL PARTIDO · el TIPO manda, y va lo primero (v664)
    // ════════════════════════════════════════════════════════════════
    //  Encargo del autor: preguntar primero qué clase de partido es y que el
    //  resto del bloque reaccione. No es sólo estética —el tipo ya gobernaba
    //  los cupos de convocatoria—: es que la fuente de los datos del partido es
    //  DISTINTA según el tipo.
    //
    //   🏆 LIGA     → el partido sale del CALENDARIO OFICIAL importado, y
    //                 elegirlo autocompleta rival, jornada, fecha y localía.
    //   🏅 COPA     → no está en el calendario regular: los datos van a mano.
    //   🤝 AMISTOSO → igual, y además con la convocatoria abierta.
    //
    //  ⚠️ SIN CALENDARIO IMPORTADO, LA LIGA NO SE QUEDA SIN FORMULARIO. El
    //     desplegable desaparece y quedan los campos a mano con su aviso: si
    //     no, un equipo cuyo club aún no ha importado el calendario no podría
    //     registrar ni un partido de liga.
    function _mrPintarPartido() {
        var S = window._mrState;
        var hoy = _mrHoy();

        // ── El selector de TIPO, lo primero de todo ──────────────────
        var opcionTipo = function (id, etiqueta) {
            return '<option value="' + id + '"' + (S.tipoPartido === id ? ' selected' : '') + '>' +
                   etiqueta + '</option>';
        };
        var html =
            '<div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:flex-end;margin-bottom:0.8rem;">' +
                _mrCampo('Tipo de partido',
                    '<select id="mr-tipo" onchange="_mrTipoPartido(this.value)" ' +
                    'style="' + _MR_INPUT + 'min-width:12rem;">' +
                    opcionTipo('liga',     '🏆 Partido de Liga') +
                    opcionTipo('copa',     '🏅 Partido de Copa') +
                    opcionTipo('amistoso', '🤝 Partido Amistoso') +
                    '</select>') +
                '<div style="flex:1;min-width:12rem;font-size:0.68rem;color:var(--text-muted);' +
                     'line-height:1.5;padding-bottom:0.25rem;">' + _mrTextoCupo() + '</div>' +
            '</div>';

        // ── El calendario oficial: SÓLO en liga ──────────────────────
        if (S.tipoPartido === 'liga') {
            if (_mrUsaCalendario()) {
                var jugados = [], porJugar = [];
                S.partidos.forEach(function (p, i) {
                    // 🏠 / ✈️ en vez de «vs» y «en casa de»: el texto anterior
                    //    («en casa de Maspalomas») se leía como si el rival
                    //    jugara en su casa, que es justo el dato que aquí no se
                    //    puede confundir — de él sale la localía del informe.
                    var txt = (p.jornada ? 'J' + p.jornada + ' · ' : '') +
                              _mrFechaLarga(p.fecha) +
                              (p.hora ? ' · ' + p.hora : '') +
                              ' · ' + (p.local !== false ? '🏠 ' : '✈️ ') + (p.rival || 'Rival');
                    var op = '<option value="' + i + '"' + (S.sel === i ? ' selected' : '') + '>' +
                             _mrE(txt) + '</option>';
                    (p.fecha <= hoy ? jugados : porJugar).push(op);
                });
                var opciones = '';
                // Los ya jugados PRIMERO y del más reciente al más antiguo: son
                // los que se vienen a registrar.
                if (jugados.length)  opciones += '<optgroup label="Ya jugados">' + jugados.reverse().join('') + '</optgroup>';
                if (porJugar.length) opciones += '<optgroup label="Aún por jugar">' + porJugar.join('') + '</optgroup>';
                opciones += '<option value="-1"' + (S.sel < 0 ? ' selected' : '') +
                            '>✍️ Otro partido (a mano)</option>';

                html +=
                    '<label style="display:block;font-size:0.68rem;color:var(--text-muted);' +
                        'margin-bottom:0.25rem;">Jornada y partido · calendario oficial</label>' +
                    '<select id="mr-sel-partido" onchange="_mrElegirPartido(this.value)" ' +
                        'style="' + _MR_INPUT + 'width:100%;margin-bottom:0.55rem;">' + opciones + '</select>' +
                    '<div style="font-size:0.66rem;color:var(--text-muted);margin-bottom:0.6rem;">' +
                        // 📋 Se dice CUÁNTOS hay. Sin este número, un desplegable
                        //    cerrado sobre la opción manual es indistinguible de
                        //    «no hay calendario» — que es exactamente la
                        //    confusión que originó esta ronda.
                        '📅 <strong style="color:#3fb950;">' + S.partidos.length + ' partidos</strong> ' +
                        'del calendario oficial de la temporada. Al elegir uno se rellenan solos la ' +
                        'fecha, el rival, la jornada y la localía; puedes corregir cualquiera si el ' +
                        'encuentro se cambió.</div>';
            } else {
                html +=
                    '<div style="font-size:0.68rem;color:#f0883e;margin-bottom:0.6rem;">' +
                    'ℹ️ Este equipo no tiene calendario oficial importado, así que los datos del ' +
                    'partido de liga van a mano.</div>';
            }
        } else {
            html +=
                '<div style="font-size:0.66rem;color:var(--text-muted);margin-bottom:0.6rem;">' +
                (S.tipoPartido === 'copa'
                    ? '🏅 Un partido de copa no figura en el calendario regular de liga: sus datos van a mano.'
                    : '🤝 Un amistoso no figura en ningún calendario oficial: sus datos van a mano.') +
                '</div>';
        }

        html +=
            '<div id="mr-manual">' + _mrCamposManuales() + '</div>' +
            '<div style="display:flex;gap:0.6rem;flex-wrap:wrap;align-items:flex-end;margin-top:0.7rem;">' +
                // `onwheel="this.blur()"` en los tres: ver la nota del minuto
                // de los sucesos. Un marcador que sube solo al pasar la rueda
                // por encima es peor aquí que en ningún sitio.
                _mrCampo('Nuestros goles', '<input type="number" min="0" max="99" id="mr-gf" value="' +
                    S.golesPropios + '" onchange="_mrCampoPartido(\'golesPropios\', this.value)" ' +
                    'onwheel="this.blur()" style="' + _MR_INPUT + 'width:5rem;">') +
                _mrCampo('Goles del rival', '<input type="number" min="0" max="99" id="mr-gc" value="' +
                    S.golesRival + '" onchange="_mrCampoPartido(\'golesRival\', this.value)" ' +
                    'onwheel="this.blur()" style="' + _MR_INPUT + 'width:5rem;">') +
                _mrCampo('Duración (min)', '<input type="number" min="10" max="130" id="mr-dur" value="' +
                    S.duracion + '" onchange="_mrCampoPartido(\'duracion\', this.value)" ' +
                    'onwheel="this.blur()" style="' + _MR_INPUT + 'width:5.5rem;">') +
            '</div>' +
            // Recordatorio ESTÁTICO. La cuenta viva y la alarma van abajo, en
            // el panel de congruencia, que sí se repinta con cada cambio: un
            // contador aquí se quedaría desfasado al tocar un suceso.
            '<div style="font-size:0.66rem;color:var(--text-muted);margin-top:0.45rem;line-height:1.5;">' +
                '⚖️ «Nuestros goles» tiene que cuadrar con los goles que anotes abajo a tus ' +
                'jugadores. Si no cuadra, se te avisa antes de guardar.' +
            '</div>';

        var c = document.getElementById('mr-partido');
        if (c) c.innerHTML = html;
    }

    function _mrCampo(etiqueta, control) {
        return '<div><label style="display:block;font-size:0.68rem;color:var(--text-muted);' +
               'margin-bottom:0.25rem;">' + _mrE(etiqueta) + '</label>' + control + '</div>';
    }

    // Los campos del partido. Se pintan SIEMPRE y SIEMPRE editables: elegir del
    // calendario los RELLENA, no los sustituye por un resumen de sólo lectura.
    // Así un partido aplazado o con el campo cambiado se corrige sin tener que
    // salirse a «otro partido».
    //
    // ⚠️ La JORNADA sólo se pregunta en LIGA. Un amistoso no tiene jornada, y
    //    una copa se juega por rondas, no por jornadas: pedirla ahí sería pedir
    //    un dato que no existe. Es la separación que pidió el autor.
    function _mrCamposManuales() {
        var S = window._mrState;
        var m = S.manual;
        return '<div style="display:flex;gap:0.6rem;flex-wrap:wrap;">' +
            _mrCampo('Fecha', '<input type="date" id="mr-fecha" value="' + _mrE(m.fecha) + '" ' +
                'onchange="_mrCampoManual(\'fecha\', this.value)" style="' + _MR_INPUT + '">') +
            _mrCampo('Rival', '<input type="text" id="mr-rival" maxlength="60" value="' + _mrE(m.rival) + '" ' +
                'placeholder="Nombre del rival" onchange="_mrCampoManual(\'rival\', this.value)" ' +
                'style="' + _MR_INPUT + 'min-width:11rem;">') +
            _mrCampo('Dónde', '<select id="mr-donde" onchange="_mrCampoManual(\'local\', this.value)" ' +
                'style="' + _MR_INPUT + '">' +
                '<option value="1"' + (m.local !== false ? ' selected' : '') + '>En casa</option>' +
                '<option value="0"' + (m.local === false ? ' selected' : '') + '>Fuera</option></select>') +
            (S.tipoPartido === 'liga'
                ? _mrCampo('Jornada', '<input type="number" id="mr-jornada" min="1" max="60" value="' +
                    _mrE(m.jornada) + '" onchange="_mrCampoManual(\'jornada\', this.value)" ' +
                    'onwheel="this.blur()" style="' + _MR_INPUT + 'width:5rem;">')
                : '') +
            (m.sede
                ? '<div style="align-self:flex-end;font-size:0.68rem;color:var(--text-muted);' +
                       'padding-bottom:0.45rem;">📍 ' + _mrE(m.sede) +
                       (m.hora ? ' · ' + _mrE(m.hora) : '') + '</div>'
                : '') +
        '</div>';
    }

    window._mrElegirPartido = function (v) {
        var S = window._mrState;
        var i = _mrNum(v, -1);
        // «Otro partido (a mano)»: se conserva lo que ya hubiera escrito. Si se
        // vaciaran los campos, elegir esa opción sin querer borraría el trabajo.
        if (i < 0) S.sel = -1;
        else _mrAplicarDelCalendario(i);
        // Se repinta el bloque ENTERO: los campos de abajo acaban de cambiar de
        // valor, que es justo el «auto-completar» del encargo.
        _mrPintarPartido();
        _mrPintarGuardar();
    };

    window._mrCampoManual = function (campo, valor) {
        var S = window._mrState;
        if (campo === 'local') S.manual.local = String(valor) === '1';
        else S.manual[campo] = valor;
        _mrPintarGuardar();
    };

    window._mrCampoPartido = function (campo, valor) {
        var S = window._mrState;
        if (campo === 'duracion') S.duracion = Math.min(130, Math.max(10, _mrNum(valor, 60)));
        else S[campo] = Math.max(0, _mrNum(valor, 0));
        _mrRefrescarMinutos();
        _mrPintarGuardar();
    };

    // ════════════════════════════════════════════════════════════════
    //  2️⃣ LA CONVOCATORIA Y LOS TITULARES
    // ════════════════════════════════════════════════════════════════
    //  🔑 ESTE BLOQUE ES EL QUE HACE QUE EL INFORME RETROACTIVO CUADRE CON EL
    //     RESUMEN DE TEMPORADA, y conviene saber exactamente por qué. La tabla
    //     acumulada la calcula `ctAccumulatePlayerStats` (admin/shared/
    //     category-tree.js) y saca sus columnas de tres sitios distintos:
    //
    //       Conv. ← EXISTE UN DOCUMENTO de ese jugador en el partido
    //       PJ    ← ese documento tiene `minutesPlayed` > 0
    //       PT    ← `wasStarter === true`  (la marca explícita, que manda
    //               sobre cualquier deducción del historial)
    //
    //     De ahí salen las tres consecuencias que gobiernan esta pantalla:
    //
    //     1. SE ESCRIBE UN DOCUMENTO POR CONVOCADO, JUEGUE O NO. Un convocado
    //        que se quedó los 90 en el banquillo suma convocatoria y NO suma
    //        partido jugado. Si no se le escribiera documento, desaparecería
    //        de la temporada — es el mismo criterio que v458 fijó para el
    //        informe visual («exhaustivo con la plantilla»).
    //     2. LA TITULARIDAD SE MARCA, NO SE DEDUCE. `wasStarter` es la vía 1
    //        de `_ctEmpezoDeTitular`; sin ella habría que adivinarla del
    //        historial, y en un partido sin cambios anotados la deducción
    //        «sin transiciones = empezó» daría titular a TODO el que jugara.
    //        Por eso la casilla «De inicio» es un dato del formulario y no un
    //        subproducto de los minutos.
    //     3. NO CONVOCADO NO ES 0 MINUTOS: es no estar. Desmarcar «Conv.»
    //        borra también su titularidad y su minutaje manual, para que no
    //        quede un dato huérfano que nadie va a guardar.
    // ════════════════════════════════════════════════════════════════
    function _mrPintarPlantilla() {
        var S = window._mrState;
        var calc = _mrCalcularMinutos(S);

        var filas = S.jugadores.map(function (j) {
            var conv = !!S.conv[j.dorsal];
            var tit  = !!S.tit[j.dorsal];
            var min  = (S.minManual[j.dorsal] != null) ? S.minManual[j.dorsal] : (calc[j.dorsal] || 0);
            return '<tr style="border-top:1px solid rgba(255,255,255,0.06);' +
                        (conv ? '' : 'opacity:0.45;') + '">' +
                '<td style="padding:0.3rem 0.4rem;text-align:center;">' +
                    '<input type="checkbox" ' + (conv ? 'checked' : '') +
                    ' onchange="_mrConvocar(\'' + _mrE(j.dorsal) + '\', this.checked)" ' +
                    'style="width:16px;height:16px;cursor:pointer;"></td>' +
                '<td style="padding:0.3rem 0.4rem;font-weight:700;color:#58a6ff;white-space:nowrap;">#' +
                    _mrE(j.dorsal) + '</td>' +
                '<td style="padding:0.3rem 0.4rem;color:white;">' + _mrE(j.alias) + '</td>' +
                '<td style="padding:0.3rem 0.4rem;text-align:center;">' +
                    '<input type="checkbox" ' + (tit ? 'checked' : '') + (conv ? '' : ' disabled') +
                    ' onchange="_mrTitular(\'' + _mrE(j.dorsal) + '\', this.checked)" ' +
                    'style="width:16px;height:16px;cursor:pointer;"></td>' +
                '<td style="padding:0.3rem 0.4rem;text-align:center;white-space:nowrap;">' +
                    '<input type="number" min="0" max="130" id="mr-min-' + _mrE(j.dorsal) + '" ' +
                    'value="' + min + '"' + (conv ? '' : ' disabled') +
                    ' onchange="_mrMinuto(\'' + _mrE(j.dorsal) + '\', this.value)" ' +
                    // Ver la nota del minuto de los sucesos: con el foco puesto,
                    // la rueda del ratón cambia el número mientras se recorre
                    // el modal. Esta tabla tiene 25 filas: es donde más pasa.
                    'onwheel="this.blur()" ' +
                    'style="' + _MR_INPUT + 'width:4.2rem;text-align:center;"></td>' +
            '</tr>';
        }).join('');

        var nConv = _mrConvocados().length;
        var nTit  = _mrTitulares().length;
        var cupo  = _mrCupo();
        var esperados = cupo.maxTitulares;
        var sobranConv = (cupo.maxConvocados != null) && (nConv > cupo.maxConvocados);
        var sobranTit  = nTit > esperados;

        // ══════════════════════════════════════════════════════════════
        //  🔴 ROJO = BLOQUEA · 🟠 NARANJA = SÓLO AVISA
        //  La diferencia no es de color, es de NORMATIVA, y por eso se explica
        //  en el propio mensaje:
        //   · Pasarse del cupo (convocados en liga, titulares siempre) es
        //     imposible en un partido de verdad. Bloquea.
        //   · Quedarse CORTO de titulares sí puede haber pasado —un equipo que
        //     llega justo—, así que sólo avisa. Bloquear eso sería impedir
        //     registrar un partido que ocurrió.
        // ══════════════════════════════════════════════════════════════
        var aviso = function (rojo, texto) {
            return '<div style="font-size:0.68rem;color:' + (rojo ? '#ff5858' : '#f0883e') + ';' +
                   'background:rgba(' + (rojo ? '255,88,88' : '240,136,62') + ',0.07);' +
                   'border:1px solid rgba(' + (rojo ? '255,88,88' : '240,136,62') + ',0.3);' +
                   'border-radius:8px;padding:0.45rem 0.6rem;margin-bottom:0.5rem;line-height:1.5;">' +
                   texto + '</div>';
        };

        var avisos = '';
        if (sobranConv) {
            avisos += aviso(true,
                '⛔ <strong>' + nConv + ' convocados</strong> en un partido de ' +
                (S.tipoPartido === 'copa' ? 'Copa' : 'Liga') + ' de ' +
                (cupo.modalidad === 'f11' ? 'Fútbol 11' : 'Fútbol 7') + ': el máximo es <strong>' +
                cupo.maxConvocados + '</strong>. Quita <strong>' + (nConv - cupo.maxConvocados) +
                '</strong> antes de guardar.');
        }
        if (sobranTit) {
            avisos += aviso(true,
                '⛔ <strong>' + nTit + ' titulares</strong> marcados y en ' +
                (cupo.modalidad === 'f11' ? 'Fútbol 11' : 'Fútbol 7') + ' se sale con <strong>' +
                esperados + '</strong>. Quita <strong>' + (nTit - esperados) + '</strong>: una titularidad ' +
                'de más viaja a la columna PT de toda la temporada.');
        } else if (nTit < esperados) {
            avisos += aviso(false,
                '⚠️ Llevas <strong>' + nTit + '</strong> de <strong>' + esperados + '</strong> titulares. ' +
                'Si el equipo empezó con menos, déjalo así; si no, marca los que faltan.');
        }

        var html = avisos +
            '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.6rem;">' +
                '<button onclick="_mrConvocarTodos(true)" style="' + _mrBtn('#3fb950') + '">✓ Convocar a todos</button>' +
                '<button onclick="_mrConvocarTodos(false)" style="' + _mrBtn('#8b949e') + '">Ninguno</button>' +
                '<button onclick="_mrTitularesNinguno()" style="' + _mrBtn('#8b949e') + '">Quitar titulares</button>' +
                '<span id="mr-conteo" style="margin-left:auto;font-size:0.7rem;color:var(--text-muted);' +
                    'align-self:center;"><strong style="color:' +
                    (sobranConv ? '#ff5858' : '#3fb950') + ';">' + nConv + '</strong>' +
                    (cupo.maxConvocados == null ? ' convocados (sin tope)'
                                                : ' de ' + cupo.maxConvocados + ' convocados') +
                    ' · <strong style="color:' +
                    (sobranTit ? '#ff5858' : nTit === esperados ? '#3fb950' : '#f0883e') + ';">' +
                    nTit + '</strong> de ' + esperados + ' de inicio</span>' +
            '</div>' +
            '<div style="overflow-x:auto;border:1px solid rgba(255,255,255,0.08);border-radius:10px;">' +
            '<table style="width:100%;border-collapse:collapse;font-size:0.76rem;min-width:420px;">' +
            '<thead><tr style="background:rgba(255,255,255,0.04);font-size:0.66rem;color:var(--text-muted);' +
                'text-transform:uppercase;letter-spacing:0.4px;">' +
                '<th style="padding:0.4rem;width:2.4rem;">Conv.</th>' +
                '<th style="padding:0.4rem;text-align:left;width:3rem;">Dorsal</th>' +
                '<th style="padding:0.4rem;text-align:left;">Jugador</th>' +
                '<th style="padding:0.4rem;width:3.4rem;">De inicio</th>' +
                '<th style="padding:0.4rem;width:5rem;">Minutos</th>' +
            '</tr></thead><tbody>' + filas + '</tbody></table></div>';

        var c = document.getElementById('mr-plantilla');
        if (c) c.innerHTML = html;
    }

    function _mrBtn(color) {
        return 'background:' + color + '1a;border:1px solid ' + color + '55;color:' + color + ';' +
               'padding:0.3rem 0.7rem;border-radius:7px;cursor:pointer;font-size:0.7rem;font-weight:700;';
    }

    // ⚠️⚠️ SÓLO SE FRENA LO QUE AÑADE, NUNCA LO QUE QUITA. Es la lección C de
    //    v506: con los titulares al máximo, el clic sobre un convocado salía
    //    por el `return` del aviso y el jugador YA NO SE PODÍA DESMARCAR —justo
    //    la operación que hace falta para bajar del tope. Desmarcar pasa
    //    siempre.
    window._mrConvocar = function (dorsal, si) {
        var S = window._mrState;
        if (si) {
            var cupo = _mrCupo();
            if (cupo.maxConvocados != null && _mrConvocados().length >= cupo.maxConvocados) {
                _mrToast('⛔ Máximo ' + cupo.maxConvocados + ' convocados en un partido de ' +
                         (S.tipoPartido === 'copa' ? 'Copa' : 'Liga') + ' de ' +
                         (cupo.modalidad === 'f11' ? 'Fútbol 11' : 'Fútbol 7') +
                         '. Si fue un amistoso, cámbialo arriba.', 5000);
                _mrPintarPlantilla();   // devuelve la casilla a su sitio
                return;
            }
        }
        S.conv[dorsal] = !!si;
        if (!si) { delete S.tit[dorsal]; delete S.minManual[dorsal]; }
        _mrPintarPlantilla();
        _mrPintarSucesos();     // los desplegables de jugador cambian
        _mrPintarGuardar();
    };

    window._mrConvocarTodos = function (si) {
        var S = window._mrState;
        if (!si) {
            S.jugadores.forEach(function (j) {
                delete S.conv[j.dorsal]; delete S.tit[j.dorsal]; delete S.minManual[j.dorsal];
            });
        } else {
            // En liga se rellena HASTA EL TOPE, por orden de dorsal, y se dice.
            // Convocar a los 20 y dejar la pantalla en rojo sería empujar al
            // usuario a un estado inválido y luego regañarle por estar en él.
            var cupo = _mrCupo();
            var tope = (cupo.maxConvocados == null) ? S.jugadores.length : cupo.maxConvocados;
            S.jugadores.forEach(function (j, i) {
                if (i < tope) S.conv[j.dorsal] = true;
                else { delete S.conv[j.dorsal]; delete S.tit[j.dorsal]; delete S.minManual[j.dorsal]; }
            });
            if (S.jugadores.length > tope) {
                _mrToast('ℹ️ Se han marcado los ' + tope + ' primeros por dorsal (el tope de Liga en ' +
                         (cupo.modalidad === 'f11' ? 'Fútbol 11' : 'Fútbol 7') +
                         '). Ajusta a mano quién viajó.', 6000);
            }
        }
        _mrPintarPlantilla();
        _mrPintarSucesos();
        _mrPintarGuardar();
    };

    window._mrTitular = function (dorsal, si) {
        var S = window._mrState;
        // ⛔ El tope de titulares NO lo relaja el amistoso: en el campo hay
        //    siete u once. Se frena al MARCAR; desmarcar pasa siempre (v506·C).
        if (si) {
            var cupo = _mrCupo();
            if (_mrTitulares().length >= cupo.maxTitulares) {
                _mrToast('⛔ Máximo ' + cupo.maxTitulares + ' titulares en ' +
                         (cupo.modalidad === 'f11' ? 'Fútbol 11' : 'Fútbol 7') +
                         '. Quita uno antes de marcar otro.', 5000);
                _mrPintarPlantilla();
                return;
            }
            // ⚠️ Y LA PUERTA DE ATRÁS: marcar titular a alguien que aún no
            //    estaba convocado lo convoca de paso, así que podría colar al
            //    convocado número 15 saltándose el tope de arriba.
            if (!S.conv[dorsal] && cupo.maxConvocados != null &&
                _mrConvocados().length >= cupo.maxConvocados) {
                _mrToast('⛔ Ya hay ' + cupo.maxConvocados + ' convocados, el máximo en Liga. ' +
                         'Marcarle de titular le convocaría de más.', 5000);
                _mrPintarPlantilla();
                return;
            }
        }
        S.tit[dorsal] = !!si;
        // Un titular es, por definición, un convocado: marcar «De inicio» sin
        // haber marcado «Conv.» sería una titularidad que nunca se guardaría.
        if (si) S.conv[dorsal] = true;
        _mrPintarPlantilla();
        _mrPintarSucesos();
        _mrPintarGuardar();
    };

    window._mrTitularesNinguno = function () {
        window._mrState.tit = {};
        _mrPintarPlantilla();
        _mrPintarGuardar();
    };

    // ════════════════════════════════════════════════════════════════
    //  ⚖️ LOS CUPOS DE COMPETICIÓN
    // ════════════════════════════════════════════════════════════════
    //  🔑 NI LOS NÚMEROS NI LA MODALIDAD SE DECIDEN AQUÍ. La modalidad se
    //     DERIVA de la categoría con el resolutor único (`_cronosMatchModality`)
    //     y los topes salen de `cronosCupoConvocatoria` (utils.js), que es
    //     donde vive la regla. Este fichero sólo pregunta.
    //
    //  ⚠️⚠️ Y AQUÍ NO HAY RESPALDO CON NÚMEROS, A PROPÓSITO. La tentación era
    //     escribir un `mod === 'f11' ? 18 : 14` por si utils.js no hubiera
    //     cargado — y eso es EXACTAMENTE una segunda copia de la tabla, que es
    //     lo que se acaba de evitar. Lo cazó el guard.
    //     Si la regla no está, no se puede validar nada, y «no puedo validar»
    //     tiene que significar NO, no SÍ (la lección de v617: un `!dato ||` en
    //     algo que autoriza convierte «no sé» en un sí). Por eso se devuelve un
    //     cupo de CERO y `_sinRegla`, que bloquea el guardado y lo explica.
    function _mrModalidad() {
        var S = window._mrState;
        var cat = (S.equipo && S.equipo.category) || '';
        var mod = (typeof window._cronosMatchModality === 'function')
            ? window._cronosMatchModality(cat, null) : '';
        return mod === 'f11' ? 'f11' : 'f7';
    }

    function _mrCupo() {
        var S = window._mrState;
        var mod = _mrModalidad();
        if (typeof window.cronosCupoConvocatoria === 'function') {
            return window.cronosCupoConvocatoria(mod, S.tipoPartido);
        }
        return { modalidad: mod, tipo: S.tipoPartido,
                 maxConvocados: 0, maxTitulares: 0, _sinRegla: true };
    }

    // Los titulares que debe haber. Es el tope Y la cifra esperada: en el campo
    // hay siete u once, y por eso el amistoso NO lo relaja.
    function _mrTitularesEsperados() { return _mrCupo().maxTitulares; }

    // La frase que explica el cupo vigente, al lado del selector.
    function _mrTextoCupo() {
        var S = window._mrState;
        var c = _mrCupo();
        var m = c.modalidad === 'f11' ? 'Fútbol 11' : 'Fútbol 7';
        if (c.maxConvocados == null) {
            return '🤝 ' + m + ' · convocatoria <strong style="color:#3fb950;">abierta</strong>, ' +
                   'sin límite de convocados. El tope de <strong>' + c.maxTitulares +
                   ' titulares</strong> se mantiene igual: en el campo no caben más.';
        }
        // La copa lleva acta como la liga, así que comparte cupo. Se nombra
        // para que no parezca que se le ha aplicado el de liga por descuido.
        return (S.tipoPartido === 'copa' ? '🏅 Copa · ' : '🏆 Liga · ') + m +
               ' · máximo <strong>' + c.maxConvocados + ' convocados</strong> y ' +
               '<strong>' + c.maxTitulares + ' titulares</strong>.';
    }

    window._mrTipoPartido = function (v) {
        var S = window._mrState;
        var t = String(v || '').toLowerCase();
        S.tipoPartido = (t === 'amistoso' || t === 'copa') ? t : 'liga';
        // ⚠️ AL SALIR DE LIGA SE SUELTA LA FILA DEL CALENDARIO, pero NO se
        //    borra lo ya escrito: si venías de un partido de liga y lo pasas a
        //    copa, conservas rival y fecha y sólo se te retira la jornada, que
        //    en copa no existe. Vaciar los campos aquí castigaría un cambio de
        //    idea con la pérdida de todo lo tecleado.
        if (S.tipoPartido !== 'liga') {
            S.sel = -1;
            S.manual.jornada = '';
        }
        // Se repinta TODO el bloque del partido —no sólo la frase— porque
        // cambian el desplegable del calendario, los campos y el texto del
        // cupo; y la convocatoria, que es la que cambia de color al rebasarlo.
        _mrPintarPartido();
        _mrPintarPlantilla();
        _mrPintarGuardar();
    };

    function _mrTitulares() {
        var S = window._mrState;
        return S.jugadores.filter(function (j) { return S.conv[j.dorsal] && S.tit[j.dorsal]; });
    }

    window._mrMinuto = function (dorsal, valor) {
        var S = window._mrState;
        S.minManual[dorsal] = Math.min(130, Math.max(0, _mrNum(valor, 0)));
        _mrPintarGuardar();
    };

    // Repinta SÓLO las casillas de minutos que él no ha tocado, y nunca la que
    // tiene el foco: sobreescribir un campo mientras se teclea es la forma más
    // rápida de que un formulario parezca roto.
    function _mrRefrescarMinutos() {
        var S = window._mrState;
        var calc = _mrCalcularMinutos(S);
        S.jugadores.forEach(function (j) {
            if (S.minManual[j.dorsal] != null) return;
            var el = document.getElementById('mr-min-' + j.dorsal);
            if (!el || el === document.activeElement) return;
            el.value = calc[j.dorsal] || 0;
        });
    }

    // ── 3️⃣ Los sucesos ─────────────────────────────────────────────
    var _MR_TIPOS = [
        { id: 'gol',      etiqueta: '⚽ Gol' },
        { id: 'amarilla', etiqueta: '🟨 Tarjeta amarilla' },
        { id: 'roja',     etiqueta: '🟥 Tarjeta roja' },
        { id: 'lesion',   etiqueta: '🚑 Lesión' },
        { id: 'cambio',   etiqueta: '🔄 Cambio' },
    ];

    function _mrConvocados() {
        var S = window._mrState;
        return S.jugadores.filter(function (j) { return S.conv[j.dorsal]; });
    }

    function _mrSelectJugador(valor, accion) {
        var opts = '<option value="">— jugador —</option>' + _mrConvocados().map(function (j) {
            return '<option value="' + _mrE(j.dorsal) + '"' + (String(valor) === j.dorsal ? ' selected' : '') +
                   '>#' + _mrE(j.dorsal) + ' ' + _mrE(j.alias) + '</option>';
        }).join('');
        return '<select onchange="' + accion + '" style="' + _MR_INPUT + 'min-width:9rem;">' + opts + '</select>';
    }

    function _mrPintarSucesos() {
        var S = window._mrState;
        var c = document.getElementById('mr-sucesos');
        if (!c) return;

        if (!_mrConvocados().length) {
            c.innerHTML = '<div style="font-size:0.72rem;color:#f0883e;">' +
                '⚠️ Marca antes a los convocados: los sucesos se le anotan a un jugador.</div>';
            return;
        }

        // ══════════════════════════════════════════════════════════════
        //  🔴 EL ORDEN DE LAS FILAS ES EL ORDEN EN QUE SE AÑADIERON.
        //     NO SE ORDENA POR MINUTO, Y ESA ES LA CORRECCIÓN.
        // ══════════════════════════════════════════════════════════════
        //  Aquí había un `.sort()` por minuto, y con él la lista se REORDENABA
        //  bajo los dedos: escribías el minuto de una fila, la lista se
        //  repintaba ordenada y esa fila SE MOVÍA de sitio. Desde fuera se ve
        //  como si los valores se contagiaran entre filas o como si el minuto
        //  de la primera se cambiara solo. (Reportado con capturas el
        //  2026-09-02: la fila vacía, añadida la SEGUNDA, salía la PRIMERA por
        //  tener minuto 0.)
        //
        //  🔑 EL ESTADO NUNCA ESTUVO MAL: cada fila se identifica por su `id`,
        //     no por su posición. Lo que engañaba era la POSICIÓN en pantalla.
        //
        //  ⚠️ Y NO HACE FALTA ORDENAR AQUÍ PARA NADA: al guardar, el minutaje
        //     (`_mrCalcularMinutos`) y el historial (`_mrHistorialPorDorsal`)
        //     ordenan por minuto por su cuenta. El informe sale igual de bien
        //     con las filas del formulario en el orden que sea.
        var filas = S.sucesos.map(function (s) {
            var tipos = _MR_TIPOS.map(function (t) {
                return '<option value="' + t.id + '"' + (s.tipo === t.id ? ' selected' : '') + '>' +
                       t.etiqueta + '</option>';
            }).join('');
            return '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;' +
                        'border:1px solid rgba(255,255,255,0.08);border-radius:9px;padding:0.45rem 0.55rem;' +
                        'margin-bottom:0.4rem;background:rgba(0,0,0,0.2);">' +
                "<select onchange=\"_mrSuceso('" + s.id + "','tipo',this.value)\" style=\"" + _MR_INPUT +
                    'min-width:9.5rem;">' + tipos + '</select>' +
                // ⚠️ `onwheel="this.blur()"`: un <input type="number"> CON EL
                //    FOCO cambia de valor al girar la rueda del ratón. Como
                //    esto vive en un modal largo que se recorre con la rueda,
                //    bastaba con escribir un minuto y seguir bajando con el
                //    cursor encima para que el número subiera SOLO. Es la otra
                //    mitad del «se autoincrementa» que él reportó, y el remedio
                //    estándar es soltar el foco en cuanto empieza el gesto.
                "<input type=\"number\" min=\"0\" max=\"99\" value=\"" + _mrNum(s.minuto, 0) + "\" " +
                    "onchange=\"_mrSuceso('" + s.id + "','minuto',this.value)\" " +
                    'onwheel="this.blur()" title="Minuto del partido" ' +
                    'style="' + _MR_INPUT + 'width:4.2rem;text-align:center;">' +
                "<span style=\"font-size:0.66rem;color:var(--text-muted);\">'</span>" +
                (s.tipo === 'cambio'
                    ? '<span style="font-size:0.68rem;color:#ff5858;font-weight:700;">Sale</span>' +
                      _mrSelectJugador(s.dorsal, "_mrSuceso('" + s.id + "','dorsal',this.value)") +
                      '<span style="font-size:0.68rem;color:#3fb950;font-weight:700;">Entra</span>' +
                      _mrSelectJugador(s.dorsalEntra, "_mrSuceso('" + s.id + "','dorsalEntra',this.value)")
                    : _mrSelectJugador(s.dorsal, "_mrSuceso('" + s.id + "','dorsal',this.value)")) +
                "<button onclick=\"_mrQuitarSuceso('" + s.id + "')\" title=\"Quitar\" style=\"" +
                    'background:rgba(255,88,88,0.1);border:1px solid rgba(255,88,88,0.3);color:#ff5858;' +
                    'border-radius:7px;padding:0.25rem 0.5rem;cursor:pointer;font-size:0.72rem;' +
                    'margin-left:auto;">🗑️</button>' +
            '</div>';
        }).join('');

        c.innerHTML = filas +
            '<button onclick="_mrAnadirSuceso()" style="' + _mrBtn('#58a6ff') + 'margin-top:0.3rem;">' +
            '➕ Añadir suceso</button>' +
            (S.sucesos.length ? '' :
                '<div style="font-size:0.68rem;color:var(--text-muted);margin-top:0.5rem;">' +
                'Sin sucesos, el informe guardará igualmente la convocatoria y los minutos.</div>');
    }

    window._mrAnadirSuceso = function () {
        var S = window._mrState;
        S.sucesos.push({
            id: 'e' + Date.now().toString(36) + Math.floor(Math.random() * 1000),
            tipo: 'gol', minuto: 0, dorsal: '', dorsalEntra: '',
        });
        _mrPintarSucesos();
        _mrPintarGuardar();
    };

    window._mrQuitarSuceso = function (id) {
        var S = window._mrState;
        S.sucesos = S.sucesos.filter(function (s) { return s.id !== id; });
        _mrPintarSucesos();
        _mrPintarPlantilla();     // recalcula y repinta los minutos de una vez
        _mrPintarGuardar();
    };

    // 🔴 SÓLO SE REPINTA LA LISTA CUANDO LA FILA CAMBIA DE FORMA.
    //
    //  Antes se repintaba entera en CADA cambio, incluido el del minuto. Eso
    //  destruye el propio <input> que el usuario está usando: con las flechas
    //  del selector numérico —que disparan `change` en cada clic— el campo
    //  desaparecía y nacía otro debajo del cursor a mitad del gesto.
    //
    //  🔑 Un cambio de MINUTO o de JUGADOR no altera el marcado de la fila: el
    //     valor ya está en pantalla, escrito por el propio usuario. Sólo el
    //     TIPO lo altera (un «cambio» necesita un segundo desplegable, «Entra»),
    //     y ahí sí hay que repintar.
    window._mrSuceso = function (id, campo, valor) {
        var S = window._mrState;
        var s = S.sucesos.filter(function (x) { return x.id === id; })[0];
        if (!s) return;
        if (campo === 'minuto') s.minuto = Math.min(99, Math.max(0, _mrNum(valor, 0)));
        else s[campo] = valor;
        if (campo === 'tipo') {
            if (valor !== 'cambio') s.dorsalEntra = '';
            _mrPintarSucesos();
        }
        // Los minutos calculados sí cambian, pero se refrescan CASILLA A
        // CASILLA (respetando la que tenga el foco y las corregidas a mano) en
        // vez de rehacer la tabla entera.
        _mrRefrescarMinutos();
        _mrPintarGuardar();
    };

    // ════════════════════════════════════════════════════════════════
    //  ⚖️ CONGRUENCIA ENTRE LOS GOLES DE LOS SUCESOS Y EL MARCADOR
    // ════════════════════════════════════════════════════════════════
    //  Encargo del autor (2026-09-02): impedir la inversión local/visitante.
    //  Si sus jugadores anotan 6 goles en los sucesos, el marcador no puede
    //  decir que marcaron 5 y el rival 6 —eso es el marcador tecleado al
    //  revés—, y mucho menos dar ganador al contrario con los tantos siendo
    //  nuestros.
    //
    //  🔑 EN ESTE FORMULARIO TODO GOL ES NUESTRO. No hay opción de «gol del
    //     rival»: cada suceso se le anota a un convocado. Por eso la cuenta de
    //     goles de los sucesos es, por construcción, GOLES DE NUESTRO EQUIPO, y
    //     se puede comparar con la casilla «Nuestros goles» sin ambigüedad.
    //     (La localía no entra aquí: el formulario pregunta «nuestros» y «del
    //     rival», y es al guardar cuando eso se reparte en scoreHome/scoreAway
    //     según `myTeamRole`. Ver `_mrGuardar`.)
    //
    //  ⚠️ LA ASIMETRÍA ES DELIBERADA, y es lo que hace útil esta validación:
    //
    //   ⛔ MÁS GOLEADORES QUE GOLES → IMPOSIBLE. Seis jugadores no pueden haber
    //      marcado si el equipo hizo cinco. BLOQUEA.
    //   ⚠️ MENOS GOLEADORES QUE GOLES → LEGÍTIMO, y no se puede bloquear: un
    //      gol en propia puerta del rival cuenta para nosotros y NO tiene
    //      goleador nuestro, y además el entrenador puede no recordar quién
    //      marcó cada uno. Sólo se avisa.
    //
    //  🔄 Y hay una firma inequívoca del marcador AL REVÉS: los goles anotados
    //     no cuadran con los nuestros pero cuadran EXACTAMENTE con los del
    //     rival. Ahí no se adivina: se dice lo que parece y se ofrece un botón
    //     para intercambiarlos, que es lo que pidió el autor («corrigiendo la
    //     asignación… antes de dejar guardar»).
    function _mrCongruencia() {
        var S = window._mrState;
        // Sólo los goles con jugador asignado: uno sin jugador ya lo bloquea
        // otra comprobación, y contarlo aquí daría una alarma falsa mientras se
        // está rellenando la fila.
        var enSucesos = S.sucesos.filter(function (s) {
            return s.tipo === 'gol' && s.dorsal;
        }).length;
        var propios = _mrNum(S.golesPropios, 0);
        var rival   = _mrNum(S.golesRival, 0);
        return {
            enSucesos: enSucesos,
            propios: propios,
            rival: rival,
            sobran:    Math.max(0, enSucesos - propios),
            sinAnotar: Math.max(0, propios - enSucesos),
            // La firma del marcador invertido.
            invertido: enSucesos > propios && enSucesos === rival,
        };
    }

    window._mrInvertirMarcador = function () {
        var S = window._mrState;
        var t = S.golesPropios;
        S.golesPropios = S.golesRival;
        S.golesRival = t;
        _mrPintarPartido();
        _mrPintarGuardar();
        _mrToast('🔄 Marcador corregido: ' + S.golesPropios + ' - ' + S.golesRival, 3500);
    };

    // ── 4️⃣ Guardar ─────────────────────────────────────────────────
    // Los problemas se enseñan ANTES de pulsar, no después: un formulario que
    // deja pulsar y luego dice que no puede es el mismo error que el aviso de
    // error vacío de v657.
    function _mrProblemas() {
        var S = window._mrState;
        var p = _mrPartidoElegido(S);
        var out = [];
        if (!p.fecha) out.push('Falta la fecha del partido.');
        if (!p.rival) out.push('Falta el nombre del rival.');
        var cupo   = _mrCupo();
        var nc     = _mrConvocados().length;
        var nt     = _mrTitulares().length;
        var modTxt = cupo.modalidad === 'f11' ? 'Fútbol 11' : 'Fútbol 7';

        if (cupo._sinRegla) {
            out.push('No se puede comprobar el cupo de convocatoria (js/core/utils.js no está cargado). ' +
                     'Recarga la aplicación antes de guardar.');
        }
        if (!nc) {
            out.push('No has marcado a ningún convocado.');
        } else if (!nt) {
            // 🔑 SIN TITULARES EL INFORME MENTIRÍA EN SILENCIO. `wasStarter:false`
            //    para todos es un dato afirmativo, no un hueco: la columna PT de
            //    la temporada registraría CERO titularidades en este partido y
            //    nadie volvería a mirarlo. Por eso esto SÍ bloquea, al contrario
            //    que el aviso de «faltan 2 para once», que es una elección
            //    legítima del entrenador.
            out.push('No has marcado a ningún titular: sin eso, la temporada contaría 0 titularidades en este partido.');
        }

        // ⛔ NORMATIVA DE COMPETICIÓN (v659). La regla vive en
        //    `cronosCupoConvocatoria` (core/utils.js); aquí sólo se aplica.
        //    Los dos topes BLOQUEAN, y se comprueban SIEMPRE —también con la
        //    convocatoria vacía o sin titulares— porque son problemas distintos
        //    y esconder uno detrás de otro obliga a arreglarlos de uno en uno.
        if (cupo.maxConvocados != null && nc > cupo.maxConvocados) {
            out.push('Un partido de ' + (S.tipoPartido === 'copa' ? 'Copa' : 'Liga') + ' de ' +
                     modTxt + ' admite como máximo ' +
                     cupo.maxConvocados + ' convocados y tienes ' + nc +
                     '. Quita ' + (nc - cupo.maxConvocados) + '.');
        }
        if (nt > cupo.maxTitulares) {
            out.push('En ' + modTxt + ' se sale con ' + cupo.maxTitulares +
                     ' titulares y tienes ' + nt + '. Quita ' + (nt - cupo.maxTitulares) + '.');
        }

        // ⛔ CONGRUENCIA GOLES ↔ MARCADOR. Ver `_mrCongruencia`: sólo bloquea el
        //    caso IMPOSIBLE (más goleadores que goles). El contrario —goles sin
        //    goleador anotado— es legítimo y va como aviso, no como problema.
        var g = _mrCongruencia();
        if (g.sobran > 0) {
            out.push('Tus jugadores tienen ' + g.enSucesos + ' goles anotados en los sucesos y el ' +
                     'marcador sólo os da ' + g.propios +
                     (g.invertido
                        ? '. El marcador parece estar AL REVÉS: ' + g.rival + ' goles son los que ' +
                          'cuadran con tus goleadores.'
                        : '. Corrige el marcador o quita los goles que sobren.'));
        }
        S.sucesos.forEach(function (s, i) {
            if (!s.dorsal) out.push('El suceso ' + (i + 1) + ' no tiene jugador.');
            else if (s.tipo === 'cambio' && !s.dorsalEntra)
                out.push('El cambio del minuto ' + _mrNum(s.minuto, 0) + " ' no dice quién entra.");
            else if (s.tipo === 'cambio' && s.dorsal === s.dorsalEntra)
                out.push('En el cambio del minuto ' + _mrNum(s.minuto, 0) + " ' entra y sale el mismo jugador.");
        });
        return out;
    }

    function _mrPintarGuardar() {
        var S = window._mrState;
        var c = document.getElementById('mr-guardar');
        if (!c) return;

        var problemas = _mrProblemas();
        var hayFamilias = (typeof window.cronosHayPadres !== 'function') || window.cronosHayPadres();

        // ══════════════════════════════════════════════════════════════
        //  ⚖️ EL PANEL DE CONGRUENCIA, SEPARADO Y ANTES QUE LOS DEMÁS AVISOS
        // ══════════════════════════════════════════════════════════════
        //  Va aparte del listado naranja de problemas a propósito: es el error
        //  que el autor pidió cazar, no se parece a «falta el rival», y encima
        //  trae ACCIÓN (el botón de invertir). Mezclado entre seis viñetas se
        //  leería como una más.
        var g = _mrCongruencia();
        var panel = '';
        if (g.sobran > 0) {
            panel =
            '<div style="border:1px solid rgba(255,88,88,0.45);background:rgba(255,88,88,0.08);' +
                 'border-radius:10px;padding:0.7rem 0.85rem;margin-bottom:0.8rem;">' +
                '<div style="font-size:0.78rem;font-weight:700;color:#ff5858;margin-bottom:0.35rem;">' +
                    '⛔ El marcador contradice a los goleadores</div>' +
                '<div style="font-size:0.72rem;color:#e6edf3;line-height:1.6;">' +
                    'En los sucesos hay <strong>' + g.enSucesos + ' goles</strong> anotados a jugadores ' +
                    'tuyos, pero el marcador dice que tu equipo hizo <strong>' + g.propios + '</strong> ' +
                    'y el rival <strong>' + g.rival + '</strong>.' +
                    (g.invertido
                        ? ' <strong style="color:#ff5858;">Los ' + g.enSucesos + ' cuadran justo con los ' +
                          'del rival: parece que has tecleado el marcador al revés.</strong>'
                        : ' Un equipo no puede tener más goleadores que goles.') +
                '</div>' +
                (g.invertido
                    ? '<button onclick="_mrInvertirMarcador()" style="margin-top:0.55rem;' +
                      _mrBtn('#ff5858') + '">🔄 Invertir el marcador (' + g.propios + '-' + g.rival +
                      ' → ' + g.rival + '-' + g.propios + ')</button>'
                    : '') +
            '</div>';
        } else if (g.sinAnotar > 0) {
            // ⚠️ AVISO, NUNCA BLOQUEO: un gol en propia puerta del rival cuenta
            //    para nosotros y no tiene goleador nuestro.
            panel =
            '<div style="border:1px solid rgba(240,136,62,0.3);background:rgba(240,136,62,0.07);' +
                 'border-radius:10px;padding:0.55rem 0.8rem;margin-bottom:0.8rem;' +
                 'font-size:0.7rem;color:#f0883e;line-height:1.6;">' +
                '⚠️ El marcador os da <strong>' + g.propios + '</strong> goles y en los sucesos hay ' +
                '<strong>' + g.enSucesos + '</strong> con goleador. Faltan <strong>' + g.sinAnotar +
                '</strong> por anotar. Se puede guardar así —un gol en propia puerta del rival no ' +
                'tiene goleador vuestro—, pero esos goles no se le sumarán a nadie en la temporada.' +
            '</div>';
        }

        c.innerHTML = panel +
            (problemas.length
                ? '<div style="font-size:0.72rem;color:#f0883e;background:rgba(240,136,62,0.07);' +
                    'border:1px solid rgba(240,136,62,0.25);border-radius:10px;padding:0.6rem 0.8rem;' +
                    'margin-bottom:0.7rem;line-height:1.7;">' +
                    problemas.map(function (t) { return '• ' + _mrE(t); }).join('<br>') + '</div>'
                : '') +
            (hayFamilias
                ? '<label style="display:flex;align-items:flex-start;gap:0.5rem;font-size:0.72rem;' +
                    'color:var(--text-muted);margin-bottom:0.7rem;cursor:pointer;line-height:1.5;">' +
                    '<input type="checkbox" ' + (S.avisarFamilias ? 'checked' : '') +
                    ' onchange="_mrAvisarFamilias(this.checked)" style="width:16px;height:16px;margin-top:1px;">' +
                    '<span>Avisar también a las familias vinculadas, como en un partido en directo. ' +
                    'El informe individual de cada jugador se guarda en su panel ' +
                    '<strong>en cualquier caso</strong>; esto sólo decide si además reciben el aviso.</span>' +
                  '</label>'
                : '') +
            '<button onclick="_mrGuardar()"' + (problemas.length || S.guardando ? ' disabled' : '') +
                ' style="width:100%;padding:0.7rem;border-radius:10px;font-size:0.85rem;font-weight:700;' +
                'cursor:' + (problemas.length ? 'not-allowed' : 'pointer') + ';' +
                'background:rgba(63,185,80,' + (problemas.length ? '0.06' : '0.14') + ');' +
                'border:1px solid rgba(63,185,80,' + (problemas.length ? '0.2' : '0.45') + ');' +
                'color:' + (problemas.length ? 'rgba(63,185,80,0.4)' : '#3fb950') + ';">' +
                '💾 Guardar el informe</button>';
    }

    window._mrAvisarFamilias = function (si) { window._mrState.avisarFamilias = !!si; };

    // ════════════════════════════════════════════════════════════════
    //  EL GUARDADO
    // ════════════════════════════════════════════════════════════════
    window._mrGuardar = async function () {
        var S = window._mrState;
        if (!S || S.guardando) return;
        if (_mrProblemas().length) { _mrToast('⚠️ Revisa los avisos del formulario.', 4000); return; }

        var me = window._cronosCurrentUser;
        if (!me || !me.uid) { _mrToast('⚠️ Sesión no disponible.', 4000); return; }

        var p = _mrPartidoElegido(S);
        var convocados = _mrConvocados();
        var minutos = _mrMinutosFinales(S);

        if (!confirm(
            'Se va a guardar el informe del partido:\n\n' +
            '  ' + (S.tipoPartido === 'amistoso' ? 'AMISTOSO'
                  : S.tipoPartido === 'copa'     ? 'COPA' : 'LIGA') + ' · ' +
            (p.local ? 'CASA' : 'FUERA') + ' · ' + p.fecha + ' · vs ' + p.rival + '\n' +
            '  Resultado: ' + S.golesPropios + ' - ' + S.golesRival + '\n' +
            '  ' + convocados.length + ' convocados · ' + _mrTitulares().length + ' titulares · ' +
            S.sucesos.length + ' sucesos\n\n' +
            'Aparecerá en el informe colectivo del club, en tu resumen de temporada y en los informes ' +
            'individuales de los jugadores.\n\n¿Guardar?')) return;

        S.guardando = true;
        _mrPintarGuardar();
        if (typeof showSpinner === 'function') showSpinner('Guardando el informe…');

        try {
            var fs = await _mrFS();
            var db = fs.db;

            // clubId: el token puede no traerlo (misma cautela que el despacho
            // automático; sin él las reglas rechazan al staff lector).
            var clubId = me.clubId || S.equipo.clubId || '';
            if (!clubId && typeof _cResolveClubId === 'function') {
                try {
                    clubId = await _cResolveClubId(db, me, { doc: fs.doc, getDoc: fs.getDoc }) || '';
                } catch (e) { /* se sigue: el entrenador ve lo suyo por coachUid */ }
            }

            // ── matchId determinista (ver la cabecera) ───────────────
            var matchId = _mrMatchId(me.uid, p.fecha, p.rival);

            // ── Marcador en la perspectiva del documento ─────────────
            // `scoreHome`/`scoreAway` son LOCAL y VISITANTE, y `myTeamRole`
            // dice cuál de los dos somos: es como lo leen la tarjeta de «Mis
            // Informes», el motor de informes y el índice ligero. Se guardan
            // como NÚMEROS a propósito: con cadenas, `"2" > "10"` es cierto y
            // un 2-10 se pintaría como victoria.
            var myTeamRole = p.local ? 'home' : 'away';
            var scoreHome = p.local ? S.golesPropios : S.golesRival;
            var scoreAway = p.local ? S.golesRival : S.golesPropios;

            // 🚨 SI EL PARSER NO ESTÁ, SE PARA AQUÍ Y SE DICE. La tentación era
            // caer a `history: []`, y eso guardaría un informe que PARECE bien
            // —con su marcador y sus minutos— pero sin un solo suceso: ni goles,
            // ni tarjetas, ni el Gantt. Un guardado que miente en silencio es
            // peor que uno que falla. (Lección de v657: el motivo va en el aviso.)
            if (typeof _parseHistoryForFirestore !== 'function') {
                throw new Error('el intérprete de sucesos (comms/panel.js) no está cargado; ' +
                                'recarga la aplicación e inténtalo otra vez');
            }
            var historial = _mrHistorialPorDorsal(S);
            var resumen   = _mrResumenPorDorsal(S);
            var ahora     = new Date().toISOString();
            var teamId = (typeof window.cronosTeamId === 'function')
                ? window.cronosTeamId(clubId, S.equipo.category, S.equipo.subcategory) : (S.equipo.teamId || '');

            // ── Destinatarios de staff (para las reglas y el panel) ──
            var staff = [];
            try {
                if (typeof _cGetStaff === 'function' && clubId) {
                    staff = await _cGetStaff(db, clubId, {
                        collection: fs.collection, getDocs: fs.getDocs, query: fs.query, where: fs.where
                    }) || [];
                }
            } catch (e) {
                console.warn('[InformeManual] no se pudo resolver el staff:', e && e.message ? e.message : e);
            }
            // El coordinador de F7 no recibe los partidos de F11 (v593).
            if (staff.length && typeof window._cronosResolveStaffForMatch === 'function') {
                staff = window._cronosResolveStaffForMatch(staff, S.equipo.category, null);
            }
            // ⚠️ SIEMPRE el propio entrenador dentro: la consulta
            // array-contains del Panel de Dirección no puede quedarse vacía
            // aunque el club todavía no tenga staff asignado (FIX P11-D).
            var staffUids = Array.from(new Set(staff.map(function (s) { return s.uid; })
                .filter(Boolean).concat([me.uid])));

            // ── El payload común a las tres copias ───────────────────
            // 🔑 UN SOLO OBJETO PARA LOS TRES ROLES, como en v507: si la copia
            // del entrenador se compusiera aparte acabaría siendo una versión
            // reducida de la del staff sin que nadie lo note.
            var comun = function (j) {
                var h = historial[j.dorsal] || [];
                var r = resumen[j.dorsal] || {};
                return {
                    matchId: matchId,
                    clubId: clubId || null,
                    coachUid: me.uid,
                    coachEmail: me.email || '',
                    matchDate: p.fecha,
                    rival: p.rival,
                    scoreHome: scoreHome,
                    scoreAway: scoreAway,
                    myTeamRole: myTeamRole,
                    category: S.equipo.category || '',
                    subcategory: S.equipo.subcategory || '',
                    teamId: teamId,
                    venue: p.sede || '',
                    matchTime: p.hora || '',
                    // `competition` es el campo que ya pintan el TXT del informe
                    // y el Panel de Dirección; aquí se rellena con el tipo de
                    // partido en vez de dejarlo mudo.
                    competition: S.tipoPartido === 'amistoso' ? 'Amistoso'
                               : S.tipoPartido === 'copa'     ? 'Copa'
                               : ('Liga' + (p.jornada ? ' · Jornada ' + p.jornada : '')),
                    // Y el dato estructurado, con el MISMO vocabulario que la
                    // convocatoria en vivo ('liga' | 'amistoso'): el texto de
                    // arriba es para leer, éste es para filtrar.
                    matchType: S.tipoPartido,
                    // El motor de informes respeta `duration` por encima de su
                    // tabla por categoría: la escala del Gantt y los minutos
                    // acreditados salen de lo que él tecleó.
                    duration: String(S.duracion),
                    stoppageTime: 0,
                    createdAt: ahora,
                    // 🏷️ La marca de origen. NINGÚN lector la necesita —por eso
                    // el informe encaja sin tocar nada—, pero sin ella no habría
                    // forma de distinguir después lo medido de lo recordado.
                    manualEntry: true,
                    manualJornada: p.jornada || '',
                    playerNumber: String(j.dorsal),
                    playerAlias: j.alias || j.nombre || '',
                    position: '',
                    goals: r.goles || 0,
                    cards: _mrCards(r),
                    injured: r.lesion === true,
                    minutesPlayed: _mrMMSS(minutos[j.dorsal] || 0),
                    wasStarter: !!S.tit[j.dorsal],
                    history: _parseHistoryForFirestore(h),   // comprobado arriba
                };
            };

            // ── 1) La copia del STAFF (informe colectivo) ────────────
            for (var i = 0; i < convocados.length; i++) {
                var j = convocados[i];
                var base = comun(j);
                await fs.setDoc(fs.doc(db, 'cronos_player_reports', matchId + '_staff_p' + j.dorsal),
                    Object.assign({}, base, {
                        type: 'collective_match_report',
                        staffReport: true,          // ← el filtro exclusivo del Panel de Dirección
                        staffUids: staffUids,
                    }));

                // ── 2) La copia del ENTRENADOR («Mis Informes») ──────
                // Mismo id que usan el despacho automático y el manual
                // (`{matchId}_coach_p{dorsal}`): reguardar SOBREESCRIBE.
                await fs.setDoc(fs.doc(db, 'cronos_player_reports', matchId + '_coach_p' + j.dorsal),
                    Object.assign({}, base, {
                        type: 'collective_match_report',
                        staffReport: false,
                        _forCoach: true,
                    }));
            }

            // ── 3) El índice ligero de partidos terminados (v639) ────
            // Sin await bloqueante y con su propio catch: si falla, los
            // informes ya están escritos y el lector cae al camino anterior.
            if (typeof window._cronosIndexarPartidoTerminado === 'function') {
                try {
                    window._cronosIndexarPartidoTerminado({
                        matchId: matchId,
                        clubId: clubId || null,
                        createdBy: me.uid,
                        coachUid: me.uid,
                        coachEmail: me.email || '',
                        homeName: p.local ? (me.clubName || 'Nuestro equipo') : p.rival,
                        awayName: p.local ? p.rival : (me.clubName || 'Nuestro equipo'),
                        scoreHome: scoreHome,
                        scoreAway: scoreAway,
                        category: S.equipo.category || '',
                        subcategory: S.equipo.subcategory || '',
                        mode: (typeof window._cronosMatchModality === 'function')
                            ? (window._cronosMatchModality(S.equipo.category, null) || 'f7') : 'f7',
                        matchDate: p.fecha,
                        createdAt: ahora,
                        eventsCount: S.sucesos.length,
                        source: 'cronos_player_reports',
                        docId: matchId,
                    });
                } catch (e) { /* el índice ACELERA, no manda */ }
            }

            // ── 4) Los informes INDIVIDUALES de las familias ─────────
            var familias = await _mrGuardarParaFamilias(fs, db, me, clubId, matchId, comun, convocados,
                                                        p, scoreHome, scoreAway, minutos, resumen);

            // ── 5) Los avisos al staff y al propio entrenador ────────
            await _mrAvisos(fs, db, me, clubId, matchId, staff, p, scoreHome, scoreAway);

            if (typeof hideSpinner === 'function') hideSpinner();
            _mrToast('✅ Informe guardado: ' + convocados.length + ' jugadores' +
                     (familias ? ' · ' + familias + ' familias' : '') + '.', 5000);

            // Vuelta a «Mis Informes», que ya lo encuentra: es un documento más
            // de la misma colección.
            if (typeof window.openMisInformes === 'function') window.openMisInformes();
            else if (typeof navBack === 'function') navBack();

        } catch (e) {
            if (typeof hideSpinner === 'function') hideSpinner();
            S.guardando = false;
            _mrPintarGuardar();
            // ⚠️ EL MOTIVO VA EN EL AVISO. Un «no se pudo guardar» a secas manda
            // a arreglar lo que no está roto (la lección de v657).
            console.error('[InformeManual] fallo al guardar:', e);
            _mrToast('⚠️ No se pudo guardar el informe: ' +
                     ((e && (e.code || e.message)) || 'error desconocido'), 8000);
        }
    };

    // ── La copia de cada familia ─────────────────────────────────────
    //  ⛔ El resolvedor único (`_cronosResolveParentReportTargets`) corta solo
    //     si el club no tiene activado el rol de familias (v623): aquí no se
    //     vuelve a decidir eso, que es como se coló el tercer camino entonces.
    //  Devuelve cuántas familias recibieron informe.
    async function _mrGuardarParaFamilias(fs, db, me, clubId, matchId, comun, convocados,
                                          p, scoreHome, scoreAway, minutos, resumen) {
        var S = window._mrState;
        try {
            if (typeof _cronosResolveParentReportTargets !== 'function') return 0;

            var links = [];
            try {
                var snap = await fs.getDocs(fs.query(
                    fs.collection(db, 'cronos_player_links'), fs.where('clubId', '==', clubId || '')));
                snap.forEach(function (d) { links.push(Object.assign({ _id: d.id }, d.data())); });
            } catch (e) {
                console.warn('[InformeManual] no se pudieron leer las vinculaciones:', e && e.message);
            }

            if (typeof loadEmailConfig === 'function') { try { await loadEmailConfig(); } catch (e) {} }
            var contacts = (typeof emailConfig !== 'undefined' && emailConfig && emailConfig.contacts)
                ? emailConfig.contacts : [];

            // El resolvedor empareja por DORSAL contra los convocados, así que
            // se le pasa la convocatoria con la forma que espera (`number`).
            var comoJugadores = convocados.map(function (j) {
                return { number: j.dorsal, name: j.nombre, alias: j.alias };
            });
            var destinos = _cronosResolveParentReportTargets(contacts, links, comoJugadores, null) || [];
            if (!destinos.length) return 0;

            var enviados = 0;
            for (var k = 0; k < destinos.length; k++) {
                var t = destinos[k];
                var j = convocados.filter(function (x) { return x.dorsal === String(t.dorsal); })[0];
                if (!j) continue;
                try {
                    await fs.setDoc(
                        fs.doc(db, 'cronos_player_reports',
                               matchId + '_parent_' + t.parentUid + '_p' + t.dorsal),
                        Object.assign({}, comun(j), {
                            type: 'parent_player_report',
                            parentUid: t.parentUid,
                            staffReport: false,
                        }));
                    enviados++;

                    if (S.avisarFamilias) await _mrAvisarFamilia(fs, db, me, clubId, matchId, t, j,
                                                                 p, scoreHome, scoreAway, minutos, resumen);
                } catch (e) {
                    // ⚠️ Cada familia en su propio try: un fallo con una no
                    // puede dejar sin informe a las demás (FIX v176).
                    console.warn('[InformeManual] informe de familia fallido:', t.parentUid,
                                 e && (e.code || e.message));
                }
            }
            return enviados;
        } catch (e) {
            console.warn('[InformeManual] fase de familias omitida:', e && e.message ? e.message : e);
            return 0;
        }
    }

    async function _mrAvisarFamilia(fs, db, me, clubId, matchId, t, j, p, scoreHome, scoreAway, minutos, resumen) {
        var r = resumen[j.dorsal] || {};
        var tarjeta = _mrCards(r);
        var texto = '📊 *INFORME INDIVIDUAL: ' + (j.nombre || j.alias) + '*\n' +
                    '━━━━━━━━━━━━━━━━\n' +
                    '📅 ' + _mrFechaLarga(p.fecha) + '  ·  _registrado a posteriori_\n' +
                    '⚽ Partido vs ' + p.rival + '\n' +
                    '📈 Rendimiento: ⏱️ ' + _mrMMSS(minutos[j.dorsal] || 0) + ' min | ⚽ GOL ×' +
                    (r.goles || 0) + ' | ' +
                    (tarjeta === 'roja' ? '🟥 TARJETA' : tarjeta === 'amarilla' ? '🟨 TARJETA' : 'Sin tarjetas') +
                    '\n\nRevisa el panel de informes para más detalles.\n_Cronos Fútbol_';

        var threadId = me.uid + '_' + t.parentUid;
        var msg = { sender: 'coach', text: texto, timestamp: new Date().toISOString(), type: 'report' };
        try {
            await fs.updateDoc(fs.doc(db, 'cronos_messages', threadId), {
                messages: fs.arrayUnion(msg),
                lastMessage: '📊 Informe de partido enviado',
                lastMessageAt: msg.timestamp,
                parentUid: t.parentUid,
                participants: fs.arrayUnion(me.uid, t.parentUid),
                clubId: clubId || null,
                recipientType: 'parent',
            });
        } catch (e) {
            await fs.setDoc(fs.doc(db, 'cronos_messages', threadId), {
                threadId: threadId, coachUid: me.uid, coachEmail: me.email || '',
                clubId: clubId || null, participants: [me.uid, t.parentUid],
                parentUid: t.parentUid, messages: [msg], lastMessage: '📊 Informe de partido enviado',
                lastMessageAt: msg.timestamp, unreadByCoach: 0, unreadByParent: 1,
            });
        }

        await fs.setDoc(fs.doc(db, 'cronos_notifications',
                'notif_manual_rpt_' + t.parentUid + '_' + Date.now().toString(36)), {
            type: 'informe_partido',
            clubId: clubId || null,
            userId: t.parentUid,
            coachUid: me.uid,
            parentUid: t.parentUid,
            playerNumber: String(t.dorsal),
            playerAlias: j.alias || j.nombre || '',
            rival: p.rival,
            scoreHome: scoreHome,
            scoreAway: scoreAway,
            minutes: _mrMMSS(minutos[j.dorsal] || 0),
            goals: r.goles || 0,
            cards: tarjeta,
            matchId: matchId,
            createdAt: new Date().toISOString(),
        });
    }

    // ── Avisos al staff y al propio entrenador ───────────────────────
    //  ⚠️ ESTE BLOQUE NO PUEDE TUMBAR EL GUARDADO. Es la lección de v507: un
    //  permission-denied con UN miembro del staff se llevaba por delante la
    //  copia del entrenador, que se escribía después. Aquí los informes ya
    //  están guardados y esto va detrás, entero dentro de un try.
    async function _mrAvisos(fs, db, me, clubId, matchId, staff, p, scoreHome, scoreAway) {
        var texto = '📊 *INFORME DE PARTIDO REGISTRADO A POSTERIORI*\n' +
                    '━━━━━━━━━━━━━━━━\n' +
                    '📅 ' + _mrFechaLarga(p.fecha) + '\n' +
                    '⚽ ' + (me.clubName || 'Nuestro equipo') + ' ' + scoreHome + ' - ' + scoreAway +
                    ' ' + p.rival + '\n\n' +
                    'Este partido no se pudo seguir en directo y su informe se ha rellenado a mano.\n' +
                    '_Cronos Fútbol_';
        try {
            var vistos = {};
            for (var i = 0; i < staff.length; i++) {
                var s = staff[i];
                if (!s || !s.uid || vistos[s.uid]) continue;
                vistos[s.uid] = true;
                try {
                    await fs.setDoc(fs.doc(db, 'cronos_notifications',
                            'notif_manual_rpt_staff_' + s.uid + '_' + Date.now().toString(36)), {
                        type: 'aviso_partido_finalizado',
                        clubId: clubId || null,
                        userId: s.uid,
                        coachUid: me.uid,
                        parentUid: s.uid,
                        staffUid: s.uid,
                        matchDate: p.fecha,
                        rival: p.rival,
                        scoreHome: scoreHome,
                        scoreAway: scoreAway,
                        matchId: matchId,
                        message: texto.replace(/[*_]/g, ''),
                        createdAt: new Date().toISOString(),
                    });
                } catch (e) {
                    console.warn('[InformeManual] aviso al staff fallido:', s.uid, e && (e.code || e.message));
                }
            }

            await fs.setDoc(fs.doc(db, 'cronos_notifications',
                    'coach_manual_rpt_' + me.uid + '_' + Date.now().toString(36)), {
                type: 'informe_colectivo',
                clubId: clubId || null,
                userId: me.uid,
                coachUid: me.uid,
                parentUid: me.uid,
                staffUid: me.uid,
                coachEmail: me.email || '',
                matchDate: p.fecha,
                rival: p.rival,
                scoreHome: scoreHome,
                scoreAway: scoreAway,
                matchId: matchId,
                message: 'Has registrado a mano el informe del partido vs ' + p.rival + '.',
                createdAt: new Date().toISOString(),
            });
        } catch (e) {
            console.warn('[InformeManual] avisos omitidos:', e && e.message ? e.message : e);
        }
    }

    // Piezas expuestas para el guard (lógica pura, comprobable en Node).
    window._mrInterno = {
        calcularMinutos: _mrCalcularMinutos,
        minutosFinales: _mrMinutosFinales,
        historialPorDorsal: _mrHistorialPorDorsal,
        resumenPorDorsal: _mrResumenPorDorsal,
        cards: _mrCards,
        duracionPorCategoria: _mrDuracionPorCategoria,
        mmss: _mrMMSS,
        estadoNuevo: _mrEstadoNuevo,
        partidoElegido: _mrPartidoElegido,
        titulares: _mrTitulares,
        titularesEsperados: _mrTitularesEsperados,
        // Expuestas SÓLO para el guard: hay que poder PINTAR y medir el
        // resultado. La fila de sucesos, por su orden (v662); el bloque del
        // partido, por qué se pregunta primero y qué aparece según el tipo
        // (v664). Medir el fichero fuente no vale: las opciones del desplegable
        // se construyen, no están escritas literalmente.
        pintarSucesos: _mrPintarSucesos,
        pintarPartido: _mrPintarPartido,
        problemas: _mrProblemas,
        cupo: _mrCupo,
        usaCalendario: _mrUsaCalendario,
        aplicarDelCalendario: _mrAplicarDelCalendario,
        preseleccion: _mrPreseleccion,
        congruencia: _mrCongruencia,
        modalidad: _mrModalidad,
        convocados: _mrConvocados,
        matchId: _mrMatchId,
    };
})();
