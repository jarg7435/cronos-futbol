// ════════════════════════════════════════════════════════════════════
//  js/coach/reports/cuadrante-club.js
//  🗓️ CUADRANTE SEMANAL DEL CLUB — v603 (fase 1 de 3)
//
//  Petición del autor (implementar.txt, 2026-08-21/22): el Director
//  Deportivo y el Coordinador elaboran el cuadrante semanal GENERAL del club
//  —qué categoría ocupa cada espacio del campo y a qué hora— y se lo envían a
//  los entrenadores. A partir de esa directriz, cada entrenador monta SU
//  semana (la pantalla que ya existe, js/coach/training/panel.js), pasa lista
//  y se la manda a las familias.
//
//  🔑 EL CUADRANTE DEL CLUB MARCA LA PAUTA; LA PLANIFICACIÓN DEL ENTRENADOR
//  LA DESARROLLA. Son dos documentos distintos y NO se pisan: aquí no se
//  escribe ni una línea de `teams.<teamId>`, que es de los entrenadores.
//
//  Fases siguientes (acordadas con el autor):
//    · v604 — Calendario anual de partidos (agosto→junio) + importación CSV.
//    · v605 — Los partidos oficiales de la semana se cruzan en esta parrilla.
//
//  ════════════════════════════════════════════════════════════════════
//  🔴🔴🔴 DÓNDE VIVE EL DATO, Y POR QUÉ AHÍ (leer antes de mover nada)
//
//      trainingPlans/{clubId}/weeks/CUADRANTE__{weekKey}
//
//  DOS razones, las dos medidas en el código antes de elegir:
//
//  1) CERO CAMBIOS EN firestore.rules. La regla existente
//     `match /trainingPlans/{clubId}/weeks/{weekKey}` (firestore.rules:1729)
//     ya concede read + create + update a cualquier miembro del club, y
//     {weekKey} es un comodín: acepta este id igual que acepta una fecha.
//     Cualquier OTRA ubicación (una subcolección nueva, otra colección) caería
//     en el catch-all del final de las reglas —`allow read, write: if false`—
//     y habría que desplegar reglas. Y desplegar reglas en este proyecto NO SE
//     PUEDE PROBAR: staging comparte base de datos, reglas y functions con
//     producción. Se evita el único riesgo grave que tenía esta funcionalidad.
//
//  2) ⚠️⚠️ NO VA DENTRO DEL DOCUMENTO DE LA SEMANA, VA AL LADO. La tentación
//     era guardar una clave `cuadranteClub` dentro de `weeks/{weekKey}`, junto
//     a `teams.<teamId>`. Sería destructivo: TrainingSync.deleteWeek()
//     (js/services/training-firestore-sync.js:222) hace `deleteDoc(ref)` —el
//     DOCUMENTO ENTERO— cuando no logra resolver el equipo del entrenador
//     (`!teamId`). O sea: un entrenador cuya plaza no resuelva pulsando
//     "🗑️ LIMPIAR" en su Planificación Semanal se llevaría por delante el
//     cuadrante de todo el club, en silencio.
//
//     🔑 Con el id `CUADRANTE__<fecha>` eso es IMPOSIBLE: deleteWeek sólo
//     borra `weeks/{weekKey}` exacto, y 'CUADRANTE__2026-05-11' nunca es igual
//     a '2026-05-11'. El defecto de deleteWeek sigue ahí y sigue siendo suyo
//     —no se toca en esta fase— pero su radio de daño no crece por esto.
//
//  ⚠️ EFECTO LATERAL CONOCIDO Y BENIGNO: TrainingSync.syncFromFirestore()
//  recorre la subcolección entera y volcará este documento en
//  localStorage['cronos_training_weeks'] bajo la clave 'CUADRANTE__…'. Es
//  inerte: TODOS los consumidores de esa clave (training/panel.js,
//  training-notify.js, parent/panel.js) buscan por fecha exacta, ninguno
//  itera. Censo hecho el 2026-08-22.
//
//  ⚠️ SE GUARDA CON merge:false A PROPÓSITO. Con merge:true, `celdas` es un
//  mapa y Firestore FUSIONA mapas: borrar una asignación no se guardaría
//  jamás — la celda volvería sola al recargar. El documento es de uso
//  exclusivo de este módulo, así que reemplazarlo entero es correcto.
//
//  ════════════════════════════════════════════════════════════════════
//  FORMA DEL DOCUMENTO
//
//    { v: 1,
//      weekKey: '2026-05-11',
//      filas:  [ { id, tipo:'equipo'|'libre', cat, sub, label } ],
//      celdas: { '<filaId>|<YYYY-MM-DD>': { tipo, ini, fin, esp:[1,2], txt, nota } },
//      espacios: 4,
//      actualizado, actualizadoPor, actualizadoPorNombre,
//      publicadoEn, publicadoPor, publicadoA: [uid] }
//
//  `filas` se persiste —y no se deriva siempre de las plantillas— porque el
//  cuadrante real del club tiene filas que NO son equipos: en la referencia
//  del autor (CAPTURAS/IMG_4520.jpg) hay "ACADEMIA SAN PEDRO MÁRTIR",
//  "ENTRENAMIENTO DE PORTEROS" y "FISIO". Y porque el ORDEN importa: va de
//  mayor a menor edad, no alfabético.
//
//  ACOPLAMIENTO (todo en tiempo de click; el orden de <script> es indiferente):
//   · Entrada única: switchStaffTab('cuadrante') → _sdLoadCuadrante(),
//     desde el tablero de js/coach/reports/club-reports.js.
//   · Reutiliza: _sdFS (club-reports.js), _getWeekMonday (coach/training/
//     panel.js), _cronosLocalDateKey / cronosNombreCategoria / cronosTeamId /
//     _cronosVeCategoria / _cronosCoordScope[Label] (core/utils.js),
//     ctNormCat / ctNormSubcat / CT_CATEGORIES / CT_SUBCATS (admin/shared/
//     category-tree.js), cronosFetchAllTeamRosters (roster/team-rosters.js),
//     escapeHtml / escapeAttr (core/app-init.js), showToast / showSpinner /
//     hideSpinner (match/timer/core.js).
//   · Publica para el entrenador: window.cronosCuadranteClubDeMiEquipo(),
//     que consume js/coach/training/panel.js para pintar la directriz encima
//     de su propia semana. ESA es la entrega real del envío — ver la nota de
//     "LA PUERTA QUE SÍ LLEVA A ALGÚN SITIO" en _cqEnviar().
//
//  Cubierto por scripts/test_cuadrante_club.js
// ════════════════════════════════════════════════════════════════════

// ── Constantes de la parrilla ────────────────────────────────────────
// El campo se divide en 4 espacios (requisito del autor). Se deja como
// constante y no como literal repetido: un club con dos campos, o con el de
// F11 partido en dos de F7, sólo tendría que cambiar esto y el selector.
const CQ_ESPACIOS   = 4;
// 🕐 v604 · LA FRANJA NO ES LA MISMA TODOS LOS DÍAS.
// De lunes a viernes se entrena por la tarde (requisito original: "desde las
// 16:30 en adelante"), pero el sábado y el domingo se JUEGA POR LA MAÑANA —en
// la referencia del club, de 10:00 a 12:30— y también por la tarde. Con una
// sola franja de 16:30, los partidos del fin de semana caían fuera de la
// parrilla y sólo se veían en la lista de abajo. El autor lo pidió tras probar
// la v603: sábados y domingos desde las 9:00.
const CQ_HORA_INI_SEMANA = '16:30';
const CQ_HORA_INI_FINDE  = '09:00';
const CQ_HORA_FIN        = '22:30';

// Hora de arranque de la parrilla según el día (0 = lunes … 5 = sábado, 6 = domingo).
function _cqHoraIni(diaIdx) {
    return (diaIdx >= 5) ? CQ_HORA_INI_FINDE : CQ_HORA_INI_SEMANA;
}
const CQ_PASO_MIN   = 15;

const CQ_DIAS       = ['LUNES','MARTES','MIÉRCOLES','JUEVES','VIERNES','SÁBADO','DOMINGO'];
const CQ_DIAS_CORTO = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

// 🎨 El código de colores lo fijó el autor por escrito: verde = se juega en
// CASA, naranja = se juega FUERA. La referencia visual del club usa además un
// azul y un amarillo para actividades que no son ni entreno ni partido de
// liga (academia, porteros, torneos), así que 'otro' se queda con el amarillo.
//  📐 v605 · `corto` ES EL RÓTULO DE LA CASILLA, `label` el de las frases.
//  El autor reportó (captura 9414) que "ENTRENAMIENTO" se partía y la última
//  letra caía a la línea siguiente. La causa era doble: la palabra no cabe en
//  una columna de siete, y el `word-break:break-word` de la casilla partía por
//  cualquier letra en vez de respetar la palabra. Se arregla lo segundo con
//  `overflow-wrap` (más abajo) y lo primero aquí: en la parrilla se escribe
//  ENTRENO —que además es lo que pone el cuadrante en papel del club— y
//  "Entrenamiento" se reserva para el editor, la leyenda y los resúmenes en
//  prosa, donde sí hay sitio y la palabra completa se lee mejor.
//
//  `ocupa:false` en `partido_fuera` es una REGLA DEL NEGOCIO, no un estilo:
//  ver _cqOcupaCampo.
const CQ_TIPOS = {
    entreno:       { label: 'Entrenamiento',   corto: 'ENTRENO', color: '#8b949e', icono: '🏃', ocupa: true  },
    partido_casa:  { label: 'Partido en CASA', corto: 'CASA',    color: '#3fb950', icono: '🏠', ocupa: true, campoCompleto: true },
    partido_fuera: { label: 'Partido FUERA',   corto: 'FUERA',   color: '#f0883e', icono: '🚌', ocupa: false },
    otro:          { label: 'Otra actividad',  corto: 'OTROS',   color: '#d4b106', icono: '⭐', ocupa: true  },
};

// ════════════════════════════════════════════════════════════════════
//  🏟️ v605 · UN PARTIDO FUERA NO OCUPA EL CAMPO DEL CLUB
//
//  Reporte del autor tras probar la v604 (capturas 9413/9415): la vista de
//  Ocupación del campo marcaba COLISIÓN EN ROJO entre un equipo que jugaba en
//  casa y otro que jugaba fuera a la misma hora.
//
//  🔑 Y tiene toda la razón: el que juega fuera está en el campo de OTRO club.
//  No pisa una sola instalación propia, así que no puede chocar con nadie.
//  Marcarlo en rojo no era sólo ruido: era un aviso FALSO sobre el único dato
//  que esta pantalla existe para vigilar, y acaba enseñando a ignorar los
//  rojos — incluidos los de verdad.
//
//  ⚠️ SE COMPRUEBA AL PINTAR, NO SÓLO AL GUARDAR. cqAplicarCelda ya vacía los
//  espacios de un partido fuera, pero los cuadrantes creados con v603/v604
//  pueden tener espacios marcados en un partido fuera, guardados antes de que
//  esta regla existiera. Filtrar sólo en el editor dejaría esos rojos falsos
//  vivos para siempre en las semanas ya escritas.
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
//  🏟️ v607 · UN PARTIDO EN CASA OCUPA EL CAMPO AUNQUE NADIE MARQUE NADA
//
//  Reporte del autor tras probar la v606 (capturas 9421-9423): los partidos de
//  casa del fin de semana —verdes, a las 09:00— se quedaban en la cajita de
//  "Sin espacio asignado" y NO se pintaban en la parrilla de ocupación.
//
//  🔑 La v605 dejó a medias la regla: escribí que un partido FUERA no ocupa
//  nada, pero no la otra mitad — que un partido EN CASA sí ocupa, por
//  definición. Se estaba tratando como un entrenamiento al que se le olvidó
//  poner el espacio, y la consecuencia no era sólo visual: **no computaba en
//  el informe del Ayuntamiento**, que es justo donde un partido oficial más
//  tiene que constar.
//
//  🔑 POR DEFECTO, EL CAMPO ENTERO. Un partido oficial se juega sobre la
//  instalación completa salvo que el club diga otra cosa (dos partidos de F7
//  en las dos mitades, por ejemplo). Si el director marca espacios concretos,
//  mandan los suyos; si no marca ninguno, se entiende el campo completo.
//
//  ⚠️ ESTO PUEDE HACER APARECER CONFLICTOS QUE ANTES NO SE VEÍAN, y es lo
//  correcto: dos partidos a la misma hora sobre el campo entero no caben. El
//  aviso es real y le dice al director que precise los espacios de cada uno.
//
//  ⚠️ Y SE RESUELVE AQUÍ, NO EN CADA PANTALLA. Los espacios efectivos los
//  consultan la parrilla, la casilla, el resumen del entrenador y —sobre
//  todo— el cálculo de horas del informe municipal. Repetir la regla en los
//  cuatro sitios es como se separan las verdades en este proyecto.
// ════════════════════════════════════════════════════════════════════
function _cqEspaciosDe(c, nEsp) {
    if (!c) return [];
    const meta = CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno;
    if (meta.ocupa === false) return [];                       // juega fuera: nada
    if (Array.isArray(c.esp) && c.esp.length) return c.esp.slice().sort();
    if (!meta.campoCompleto) return [];                        // entreno sin espacio: hueco del cuadrante
    const n = nEsp || (window._cqState.doc && window._cqState.doc.espacios) || CQ_ESPACIOS;
    const todos = [];
    for (let i = 1; i <= n; i++) todos.push(i);
    return todos;
}

// ¿Este bloque ocupa espacio del club? Es cierto sólo si _cqEspaciosDe
// devuelve algo: una única puerta, para que no haya dos criterios.
function _cqOcupaCampo(c, nEsp) {
    return _cqEspaciosDe(c, nEsp).length > 0;
}

// ¿Los espacios los ha puesto una persona, o los estamos dando por hechos?
// Se usa para DECIRLO en la casilla: "campo completo" no es lo mismo que
// "espacios 1·2·3·4 elegidos a mano", y el director tiene que distinguirlo.
function _cqEspacioImplicito(c) {
    if (!c) return false;
    const meta = CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno;
    return !!meta.campoCompleto && !(Array.isArray(c.esp) && c.esp.length);
}

// Orden por defecto de las filas: de MAYOR a MENOR edad, como el cuadrante en
// papel del club. CT_CATEGORIES va de menor a mayor, así que se invierte.
const CQ_ORDEN_CAT = ['regional','regional_fem','futurefem','juvenil','cadete',
                      'infantil','alevin','benjamin','prebenjamin'];

// ════════════════════════════════════════════════════════════════════
//  📅 v609 · EL CALENDARIO OFICIAL SE PROPONE, NO SE IMPONE
//
//  Decisión expresa del autor (2026-08-23): «si el calendario oficial arroja
//  un partido en una celda que ya hubiera sido modificada o escrita a mano
//  previamente por el director deportivo, el sistema debe respetar el cambio
//  manual y mostrar un aviso, dándole prioridad al criterio del coordinador».
//
//  De ahí sale toda la mecánica de estas tres funciones:
//   · Una PROPUESTA sólo existe donde la casilla está VACÍA. Donde hay algo
//     escrito, el calendario calla y se limita a avisar (ver _cqConflictos).
//   · Una propuesta NO está en `st.doc.celdas`, así que no se guarda al pasar
//     por la semana, no cuenta como ocupación del campo y NO entra en el
//     informe del Ayuntamiento. Se convierte en casilla de verdad al pulsar
//     FIJAR, o al abrirla y guardarla como cualquier otra.
// ════════════════════════════════════════════════════════════════════
function _cqPropuesta(filaId, fecha) {
    const st = window._cqState;
    if (!st.calendario) return null;
    if (st.doc && st.doc.celdas && st.doc.celdas[filaId + '|' + fecha]) return null;  // manda lo escrito
    return st.calendario[filaId + '|' + fecha] || null;
}

// La casilla que se escribiría si se fijara esta propuesta.
function _cqCeldaDePropuesta(p) {
    const ini = p.hora || '';
    return {
        tipo: p.local ? 'partido_casa' : 'partido_fuera',
        ini,
        fin: ini ? _cqHHMM(Math.min(_cqMin(ini) + 90, 23 * 60 + 59)) : '',
        esp: [],
        txt: (p.jornada != null ? 'J' + p.jornada + ' · ' : '') + (p.rival || 'Partido oficial'),
        nota: p.sede || '',
    };
}

// Cuántos partidos oficiales de esta semana están todavía sin fijar.
function _cqContarPropuestas(fechas) {
    const st = window._cqState;
    if (!st.calendario || !st.doc) return 0;
    let n = 0;
    _cqFilasVisibles(st.doc.filas).forEach(fila => {
        fechas.forEach(fecha => { if (_cqPropuesta(fila.id, fecha)) n++; });
    });
    return n;
}

// Dónde el calendario dice una cosa y el cuadrante ya dice otra. No se toca
// nada: se enumera, para que el director decida.
function _cqConflictos(fechas) {
    const st = window._cqState;
    if (!st.calendario || !st.doc) return [];
    const out = [];
    _cqFilasVisibles(st.doc.filas).forEach(fila => {
        fechas.forEach(fecha => {
            const clave = fila.id + '|' + fecha;
            const c = st.doc.celdas[clave], p = st.calendario[clave];
            if (!c || !p) return;
            const tipoCal = p.local ? 'partido_casa' : 'partido_fuera';
            const mismoTipo = c.tipo === tipoCal;
            const mismaHora = !p.hora || !c.ini || c.ini === p.hora;
            if (mismoTipo && mismaHora) return;   // dicen lo mismo: no hay nada que avisar
            out.push({ fila, fecha, celda: c, cal: p });
        });
    });
    return out;
}

window._cqState = window._cqState || {
    offset: 0,          // semanas respecto a la actual
    calendario: null,   // 📅 v609 · partidos oficiales de la semana visible
    vista:  'equipos',  // 'equipos' | 'espacios'
    dia:    0,          // día visible en la vista de espacios (0 = lunes)
    doc:    null,       // documento en edición (en memoria hasta GUARDAR)
    sucio:  false,      // hay cambios sin guardar
    // 🔴 v612 · La lista de equipos del CLUB (doc CUADRANTE__FILAS), en caché
    // de sesión. `null` = todavía no leída; `[]` = leída y vacía.
    filasClub: null,
    // 📋 v604 · Portapapeles de la parrilla: { modo:'celda'|'fila', datos, etiqueta }
    // Mientras hay algo copiado, la parrilla entra en MODO PEGAR: pulsar una
    // casilla (o una fila) pega en vez de abrir el editor.
    portapapeles: null,
    // 🔄 v604 · Sincronización en vivo entre Director y Coordinador.
    desuscribir: null,  // función de baja del onSnapshot
    remoto: null,       // cambio ajeno en espera (llegó con cambios propios sin guardar)
    selloPropio: '',    // `actualizado` de MI último guardado, para no repintarme a mí mismo
};

// ── Utilidades ───────────────────────────────────────────────────────
function _cqE(s) {
    return (typeof escapeHtml === 'function')
        ? escapeHtml(s == null ? '' : s)
        : String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _cqA(s) {
    return (typeof escapeAttr === 'function') ? escapeAttr(s == null ? '' : s) : _cqE(s).replace(/"/g,'&quot;');
}
function _cqToast(m, ms) { if (typeof showToast === 'function') showToast(m, ms || 3000); }

async function _cqFS() {
    if (typeof _sdFS === 'function') return _sdFS();
    const m = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    return { ...m, db: window._cronos_auth && window._cronos_auth.db };
}

// El lunes de la semana visible. Se DELEGA en _getWeekMonday (la aritmética
// lunes-domingo del proyecto, con el domingo contando como final de semana) y
// sólo si no está cargada se calcula aquí — mismo criterio y misma nota que
// _sdLoadAsistencia: esta pantalla no puede quedarse sin cuadrante porque otro
// módulo no haya llegado.
function _cqLunes(offset) {
    if (typeof _getWeekMonday === 'function') return _getWeekMonday(offset || 0);
    const now = new Date();
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + (offset || 0) * 7);
    mon.setHours(0, 0, 0, 0);
    return mon;
}
function _cqFechaKey(d) {
    return (typeof window._cronosLocalDateKey === 'function')
        ? window._cronosLocalDateKey(d)
        : d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function _cqDocId(weekKey) { return 'CUADRANTE__' + weekKey; }

// ════════════════════════════════════════════════════════════════════
//  🔴 v612 · LA COMPOSICIÓN DE EQUIPOS ES DEL CLUB, NO DE LA SEMANA
// ════════════════════════════════════════════════════════════════════
//  Reporte del autor: «al asignar o añadir la categoría y el equipo, guardar
//  y volver a abrir, los datos desaparecen y no se quedan retenidos de forma
//  permanente».
//
//  🔑 Y era literal. `filas` —la lista de equipos del cuadrante— se guardaba
//  DENTRO del documento de la semana (`CUADRANTE__2026-08-24`). Añadir el
//  Juvenil A y guardar lo escribía ahí y sólo ahí. Al pasar de semana, o al
//  volver otro día, `_cqLeer` no encontraba documento y la lista se rehacía
//  desde `_cqFilasPorDefecto()`, que sólo devuelve equipos CON PLANTILLA
//  PUBLICADA. El equipo recién añadido se esfumaba.
//
//  🔑🔑 Y esto es lo que rompía TAMBIÉN el calendario, que es por lo que se
//  llegó aquí. Los partidos importados se guardan bajo `filaId`, y el gestor
//  de calendarios lista `st.doc.filas`. Un equipo que no sobrevive a cambiar
//  de semana no tiene fila donde pintar su partido: la temporada quedaba
//  correctamente guardada en Firestore y NO SE VEÍA NADA en el cuadrante.
//  Importar y no ver nada es indistinguible de "la importación no funciona".
//
//  La lista de equipos es una propiedad del CLUB. Vive en un documento
//  HERMANO, por las dos mismas razones que el calendario (v609):
//   1. `match /trainingPlans/{clubId}/weeks/{weekKey}` ya da read+write a
//      todo el club y `{weekKey}` es comodín: CERO reglas nuevas —que en
//      este proyecto no se pueden probar antes de desplegarlas.
//   2. `TrainingSync.deleteWeek()` borra `weeks/{weekKey}` EXACTO, y
//      'CUADRANTE__FILAS' no es igual a ninguna fecha de semana.
// ════════════════════════════════════════════════════════════════════
const CQ_DOC_FILAS = 'CUADRANTE__FILAS';

// Sólo se queda lo que define una fila. Guardar el objeto entero metería
// basura de pintado en un documento que leen todos los coordinadores.
function _cqFilaLimpia(f) {
    return { id: String(f.id || ''), tipo: f.tipo === 'libre' ? 'libre' : 'equipo',
             cat: String(f.cat || ''), sub: String(f.sub || ''), label: String(f.label || '') };
}

async function _cqLeerFilasClub(clubId) {
    const st = window._cqState;
    if (st.filasClub) return st.filasClub;
    try {
        const fs = await _cqFS();
        const snap = await fs.getDoc(fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', CQ_DOC_FILAS));
        const d = snap.exists() ? (snap.data() || {}) : {};
        st.filasClub = Array.isArray(d.filas) ? d.filas.filter(f => f && f.id).map(_cqFilaLimpia) : [];
    } catch (e) {
        // ⚠️ No puede tumbar el cuadrante: se sigue con las filas de la semana.
        console.warn('[Cuadrante] no se pudieron leer las filas del club:', e && e.message ? e.message : e);
        st.filasClub = null;
        return [];
    }
    return st.filasClub;
}

async function _cqGuardarFilasClub(clubId, filas) {
    const me = window._cronosCurrentUser || {};
    const limpias = (filas || []).filter(f => f && f.id).map(_cqFilaLimpia);
    const fs = await _cqFS();
    await fs.setDoc(fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', CQ_DOC_FILAS), {
        v: 1, filas: limpias,
        actualizado: new Date().toISOString(),
        actualizadoPor: me.uid || '',
        actualizadoPorNombre: me.firstName || me.displayName || me.email || '',
    }, { merge: false });
    window._cqState.filasClub = limpias;
    return limpias;
}

// ── Qué filas se enseñan en una semana ───────────────────────────────
//  La lista del club MANDA. Pero se le añaden las filas que esa semana
//  concreta todavía tiene CASILLAS ESCRITAS y ya no están en la lista: si no,
//  quitar un equipo hoy volvería invisible —que no borrado— el trabajo que
//  alguien cuadró en marzo. Un dato que existe y no se ve es peor que
//  cualquiera de las dos cosas por separado.
function _cqFilasEfectivas(filasClub, filasSemana, celdas) {
    if (!filasClub || !filasClub.length) return filasSemana || [];
    const salida = filasClub.map(_cqFilaLimpia);
    const vistos = {};
    salida.forEach(f => { vistos[f.id] = true; });
    (filasSemana || []).forEach(f => {
        if (!f || !f.id || vistos[f.id]) return;
        const tieneDatos = Object.keys(celdas || {}).some(k => k.indexOf(f.id + '|') === 0);
        if (tieneDatos) { salida.push(_cqFilaLimpia(f)); vistos[f.id] = true; }
    });
    return salida;
}

// 'HH:MM' → minutos desde medianoche. Devuelve null si no es una hora.
function _cqMin(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    if (!m) return null;
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
}
function _cqHHMM(min) {
    return String(Math.floor(min / 60)).padStart(2,'0') + ':' + String(min % 60).padStart(2,'0');
}

// ── Filas: equipos del club + filas libres ───────────────────────────
function _cqIdFilaEquipo(clubId, cat, sub) {
    return (typeof cronosTeamId === 'function') ? cronosTeamId(clubId, cat, sub) : (cat + '__' + sub);
}
function _cqLabelEquipo(cat, sub) {
    const n = (typeof window.cronosNombreCategoria === 'function')
        ? window.cronosNombreCategoria(cat, sub) : String(cat || '');
    return n || String(cat || '');
}

// Filas por defecto: los equipos que tengan plantilla publicada, ordenados de
// mayor a menor edad. No inventa equipos que no existen.
async function _cqFilasPorDefecto(clubId) {
    let plantillas = {};
    try {
        if (typeof window.cronosFetchAllTeamRosters === 'function') {
            plantillas = await window.cronosFetchAllTeamRosters(clubId) || {};
        }
    } catch (e) { plantillas = {}; }

    const filas = Object.keys(plantillas).map(clave => {
        const p   = clave.split('|');
        const cat = p[0] || '', sub = p[1] || '';
        return { id: _cqIdFilaEquipo(clubId, cat, sub), tipo: 'equipo', cat, sub, label: _cqLabelEquipo(cat, sub) };
    }).filter(f => f.id);

    filas.sort((a, b) => {
        const ia = CQ_ORDEN_CAT.indexOf(a.cat), ib = CQ_ORDEN_CAT.indexOf(b.cat);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return String(a.sub).localeCompare(String(b.sub));
    });
    return filas;
}

// El coordinador de una modalidad no cuadra los equipos de la otra (v593).
// Las filas LIBRES no tienen categoría, así que las ve siempre: son del club.
function _cqFilasVisibles(filas) {
    const me = window._cronosCurrentUser;
    if (typeof window._cronosVeCategoria !== 'function') return filas;
    return filas.filter(f => f.tipo !== 'equipo' || window._cronosVeCategoria(me, f.cat));
}
// 📅 v609 · El gestor de calendarios necesita el MISMO filtro: un coordinador
// de F7 tampoco importa ni borra los calendarios de F11.
window._cqFilasVisibles = _cqFilasVisibles;

// ── Lectura / escritura del documento ────────────────────────────────
async function _cqLeer(clubId, weekKey) {
    try {
        const fs = await _cqFS();
        const snap = await fs.getDoc(fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', _cqDocId(weekKey)));
        if (snap.exists()) {
            const d = snap.data() || {};
            return {
                v: 1,
                weekKey,
                espacios: d.espacios || CQ_ESPACIOS,
                filas:  Array.isArray(d.filas) ? d.filas : [],
                celdas: (d.celdas && typeof d.celdas === 'object') ? d.celdas : {},
                publicadoEn: d.publicadoEn || '', publicadoPor: d.publicadoPor || '',
                publicadoA:  Array.isArray(d.publicadoA) ? d.publicadoA : [],
                actualizado: d.actualizado || '', actualizadoPorNombre: d.actualizadoPorNombre || '',
            };
        }
    } catch (e) {
        console.warn('[Cuadrante] no se pudo leer la semana ' + weekKey + ':', e && e.message ? e.message : e);
        throw e;
    }
    return null;
}

async function _cqGuardar(clubId, datos) {
    const me = window._cronosCurrentUser || {};
    const fs = await _cqFS();
    const payload = {
        v: 1,
        weekKey:  datos.weekKey,
        espacios: datos.espacios || CQ_ESPACIOS,
        filas:    datos.filas  || [],
        celdas:   datos.celdas || {},
        publicadoEn:  datos.publicadoEn  || '',
        publicadoPor: datos.publicadoPor || '',
        publicadoA:   datos.publicadoA   || [],
        actualizado:  new Date().toISOString(),
        actualizadoPor: me.uid || '',
        actualizadoPorNombre: me.displayName || me.email || '',
    };
    // merge:false — ver la nota de cabecera: con merge, borrar una celda no se
    // guardaría nunca porque Firestore fusiona los mapas.
    await fs.setDoc(fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', _cqDocId(datos.weekKey)), payload, { merge: false });
    // 🔄 v604 · Se recuerda el sello de MI guardado. El onSnapshot va a recibir
    // el eco de esta misma escritura: sin esto, la pantalla se repintaría sola
    // y anunciaría "otra persona ha actualizado el cuadrante" — que soy yo.
    window._cqState.selloPropio = payload.actualizado;
    window._cqState.doc.actualizado = payload.actualizado;
    window._cqState.doc.actualizadoPorNombre = payload.actualizadoPorNombre;
    return payload;
}

// ════════════════════════════════════════════════════════════════════
//  PANTALLA
// ════════════════════════════════════════════════════════════════════
async function _sdLoadCuadrante() {
    const container = document.getElementById('staff-dashboard-content');
    if (!container) return;
    const me     = window._cronosCurrentUser || {};
    const clubId = window._testRoleClubId || me.clubId || '';

    if (!clubId) {
        container.innerHTML = '<div style="text-align:center;padding:3rem;color:#f0883e;">' +
            '⚠️ No se ha podido identificar tu club.</div>';
        return;
    }

    const st      = window._cqState;
    const lunes   = _cqLunes(st.offset);
    const weekKey = _cqFechaKey(lunes);

    // Si se cambia de semana se descarta lo que hubiera en memoria.
    if (!st.doc || st.doc.weekKey !== weekKey) {
        container.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-muted);">⏳ Cargando el cuadrante…</div>';
        let leido = null;
        try {
            leido = await _cqLeer(clubId, weekKey);
        } catch (e) {
            container.innerHTML = '<div style="text-align:center;padding:3rem;color:#ff5858;line-height:1.7;">' +
                '⚠️ No se ha podido leer el cuadrante de esta semana.<br>' +
                '<span style="font-size:0.8rem;color:var(--text-muted);">' + _cqE(e && e.message ? e.message : '') + '</span></div>';
            return;
        }
        // 🔴 v612 · La lista de equipos es del CLUB (ver CQ_DOC_FILAS). Se lee
        // ANTES de decidir las filas de esta semana: es la que manda.
        const filasClub = await _cqLeerFilasClub(clubId);

        if (!leido) {
            leido = { v: 1, weekKey, espacios: CQ_ESPACIOS, filas: [],
                      celdas: {}, publicadoEn: '', publicadoPor: '', publicadoA: [] };
        }
        leido.filas = _cqFilasEfectivas(filasClub, leido.filas, leido.celdas);
        if (!leido.filas.length) leido.filas = await _cqFilasPorDefecto(clubId);

        // ── Migración silenciosa desde el modelo viejo ──────────────
        //  Un club que ya venía usando el cuadrante tiene sus equipos dentro
        //  del documento de esta semana y NINGUNO en el del club. Sembrar el
        //  documento del club aquí es lo que hace que su composición actual
        //  sobreviva a la primera vez que pasen de semana, sin pedirles que
        //  la vuelvan a montar a mano.
        //  ⚠️ `st.filasClub === null` significa que la LECTURA FALLÓ, no que
        //  el club no tenga lista. Sembrar ahí machacaría la composición real
        //  con la de esta semana por un fallo de red pasajero.
        if (st.filasClub !== null && !filasClub.length && leido.filas.length) {
            try { await _cqGuardarFilasClub(clubId, leido.filas); }
            catch (e) { console.warn('[Cuadrante] no se pudo sembrar la lista de equipos del club:', e && e.message ? e.message : e); }
        }

        st.doc   = leido;
        st.sucio = false;
        st.remoto = null;
        // ↩️ v615 · La pila describe ESTE documento. Conservarla al cambiar de
        // semana dejaria un "deshacer" que escribiria las casillas de la
        // semana pasada dentro de esta.
        _cqHistInit();
        _cqEngancharTeclas();
    }

    // ════════════════════════════════════════════════════════════════
    //  📅 v609 · LOS PARTIDOS OFICIALES DE ESTA SEMANA
    //
    //  Se piden DESPUÉS de tener el cuadrante y ANTES de pintar. El orden no
    //  es casual: si se pidieran en paralelo, la parrilla se pintaría una vez
    //  sin partidos y otra con ellos, y el director vería parpadear su semana.
    //
    //  ⚠️ Y NO PUEDE TUMBAR EL CUADRANTE. Esta pantalla existía antes que el
    //  calendario y tiene que seguir funcionando si el calendario falla: por
    //  eso `calPartidosDeSemana` devuelve {} ante cualquier error en vez de
    //  propagarlo, y aquí se comprueba además que el módulo esté cargado.
    // ════════════════════════════════════════════════════════════════
    try {
        st.calendario = (typeof window.calPartidosDeSemana === 'function')
            ? await window.calPartidosDeSemana(clubId, lunes) : {};
    } catch (e) { st.calendario = {}; }

    _cqPintar();
    _cqConectar(clubId, weekKey);
}

// 📅 v609 · Repintar tras importar o borrar un calendario. Sin esto el
// director guardaría la temporada y no vería su partido hasta salir y volver.
window._sdRecargarCuadrante = function () {
    const st = window._cqState;
    if (!st) return;
    st.calendario = null;
    if (document.getElementById('staff-dashboard-content')) _sdLoadCuadrante();
};

// ════════════════════════════════════════════════════════════════════
//  🔄 v604 · SINCRONIZACIÓN EN VIVO ENTRE DIRECTOR Y COORDINADOR
//
//  Petición del autor: "cualquier cambio que realice el Director Deportivo se
//  reflejará instantáneamente en el panel del Coordinador y viceversa".
//
//  Un `onSnapshot` sobre UN documento pequeño mientras la pestaña está
//  abierta. El coste es despreciable —hay uno o dos directores y un par de
//  coordinadores por club, no un estadio de espectadores (v579)— y el
//  documento es el mismo que ya se leía.
//
//  🔴🔴 LO QUE NO PUEDE PASAR: QUE UN CAMBIO AJENO BORRE LO QUE ESTOY
//  ESCRIBIENDO. Repintar a ciegas cada vez que llega un snapshot tiraría las
//  casillas que el coordinador acaba de rellenar y todavía no ha guardado, sin
//  un solo aviso. Así que hay TRES caminos:
//
//   1. El snapshot es MI PROPIO guardado (mismo sello) → no se toca nada.
//   2. Es ajeno y NO tengo cambios sin guardar ni un editor abierto → se
//      adopta y se repinta, con un aviso de quién lo cambió.
//   3. Es ajeno y SÍ tengo trabajo sin guardar (o un editor abierto) → NO se
//      toca la pantalla. Se guarda en `st.remoto` y sale una franja naranja
//      que deja elegir: ver lo nuevo (perdiendo lo mío) o seguir y guardar.
//
//  ⚠️ SE DA DE BAJA AL SALIR. Un onSnapshot que sobrevive a la pantalla que lo
//  abrió sigue costando lecturas y repintando un contenedor que ya es de otra
//  sección (la lección de v439). La baja se llama desde switchStaffTab, al
//  cambiar de semana, y desde el propio callback si el contenedor ya no está.
// ════════════════════════════════════════════════════════════════════
function _cqConectar(clubId, weekKey) {
    const st = window._cqState;
    // Reconectar a la misma semana no duplica el oyente.
    if (st.desuscribir && st._escuchando === clubId + '|' + weekKey) return;
    _cqDesconectar();
    st._escuchando = clubId + '|' + weekKey;

    _cqFS().then(fs => {
        // Entre pedir el módulo y tenerlo, el usuario puede haberse ido.
        if (st._escuchando !== clubId + '|' + weekKey) return;
        try {
            st.desuscribir = fs.onSnapshot(
                fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', _cqDocId(weekKey)),
                (snap) => _cqLlegaCambio(snap, weekKey),
                (err) => console.warn('[Cuadrante] la escucha en vivo se cortó:', err && err.message ? err.message : err)
            );
        } catch (e) {
            console.warn('[Cuadrante] no se pudo abrir la escucha en vivo:', e && e.message ? e.message : e);
        }
    }).catch(() => {});
}

function _cqDesconectar() {
    const st = window._cqState;
    if (typeof st.desuscribir === 'function') {
        try { st.desuscribir(); } catch (e) { /* ya estaba dada de baja */ }
    }
    st.desuscribir = null;
    st._escuchando = '';
}
window._cqDesconectar = _cqDesconectar;

function _cqLlegaCambio(snap, weekKey) {
    const st = window._cqState;

    // El contenedor ya no está (se salió del panel): baja y fuera.
    if (!document.getElementById('staff-dashboard-content')) { _cqDesconectar(); return; }
    // Se cambió de semana mientras venía el dato.
    if (!st.doc || st.doc.weekKey !== weekKey) return;
    if (!snap.exists()) return;

    const d = snap.data() || {};
    const sello = d.actualizado || '';

    // Camino 1: es el eco de mi propio guardado, o no ha cambiado nada.
    if (!sello || sello === st.selloPropio || sello === st.doc.actualizado) return;

    // 🔴 v612 · El cambio es AJENO: si esa persona añadió un equipo, también
    // reescribió la lista del club y mi caché de sesión ya no vale. Se tira
    // para que la próxima semana que abra la lea de nuevo; si no, su equipo
    // nuevo desaparecería en cuanto yo pasara de semana —justo el defecto
    // que este cambio viene a cerrar.
    st.filasClub = null;

    const entrante = {
        v: 1, weekKey,
        espacios: d.espacios || CQ_ESPACIOS,
        filas:  Array.isArray(d.filas) ? d.filas : [],
        celdas: (d.celdas && typeof d.celdas === 'object') ? d.celdas : {},
        publicadoEn: d.publicadoEn || '', publicadoPor: d.publicadoPor || '',
        publicadoA:  Array.isArray(d.publicadoA) ? d.publicadoA : [],
        actualizado: sello, actualizadoPorNombre: d.actualizadoPorNombre || '',
    };

    // Camino 3: tengo trabajo sin guardar o el editor abierto → no se toca.
    if (st.sucio || document.getElementById('cq-overlay')) {
        st.remoto = entrante;
        _cqPintar();
        return;
    }

    // Camino 2: adoptar y decirlo.
    st.doc = entrante;
    st.remoto = null;
    // ↩️ v615 · Lo que hay en pantalla ya no es mi cadena de cambios sino la
    // de otra persona: deshacer sobre ella reescribiria su trabajo con mi
    // estado viejo, y encima sin avisar. La pila arranca de cero aqui.
    _cqHistInit();
    _cqPintar();
    _cqToast('🔄 ' + (entrante.actualizadoPorNombre || 'Otra persona') + ' ha actualizado el cuadrante.', 4000);
}

window.cqAdoptarRemoto = function () {
    const st = window._cqState;
    if (!st.remoto) return;
    if (st.sucio && !confirm('Vas a cargar la versión de otra persona.\n\n⚠️ Se perderán tus cambios sin guardar. ¿Continuar?')) return;
    st.doc = st.remoto;
    st.remoto = null;
    st.sucio = false;
    // ↩️ v615 · Igual que en el camino 2: la pila era de MI documento, y el que
    // hay en pantalla es el de otra persona. Un "deshacer" aquí le devolvería
    // su cuadrante a un estado que nunca existió para ella.
    _cqHistInit();
    _cqPintar();
};

window.cqDescartarAvisoRemoto = function () {
    // Sólo se quita la franja. El cambio ajeno sigue en la base: cuando este
    // usuario guarde, su versión se impondrá — y por eso la franja lo dice.
    window._cqState.remoto = null;
    _cqPintar();
};

function _cqPintar() {
    const container = document.getElementById('staff-dashboard-content');
    if (!container) return;
    const st    = window._cqState;
    const d     = st.doc;
    const lunes = _cqLunes(st.offset);
    const dom   = new Date(lunes); dom.setDate(lunes.getDate() + 6);
    const fmt   = f => f.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

    const _semCopiada = _cqSemanaCopiada();   // v607 · portapapeles de semana entera

    // 📅 v609 · Fechas de la semana, propuestas pendientes y choques con lo
    // que el director ya escribió. Se calcula una vez y lo usan la cabecera,
    // el aviso y las dos parrillas.
    const _fechasSem = [];
    for (let i = 0; i < 7; i++) { const f = new Date(lunes); f.setDate(lunes.getDate() + i); _fechasSem.push(_cqFechaKey(f)); }
    const nProp = _cqContarPropuestas(_fechasSem);
    const _confl = _cqConflictos(_fechasSem);

    const alcance = (typeof window._cronosCoordScope === 'function')
        ? window._cronosCoordScope(window._cronosCurrentUser) : '';

    const botonVista = (id, icono, texto) =>
        '<button onclick="cqVista(\'' + id + '\')" style="padding:0.35rem 0.8rem;border-radius:8px;cursor:pointer;' +
            'font-size:0.72rem;font-weight:800;border:1px solid ' +
            (st.vista === id ? 'rgba(88,166,255,0.5);background:rgba(88,166,255,0.15);color:#58a6ff;'
                             : 'rgba(255,255,255,0.1);background:transparent;color:#8b949e;') + '">' +
            icono + ' ' + texto + '</button>';

    let html = '';

    // ── Cabecera: semana, vistas y acciones ─────────────────────────
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.6rem;margin-bottom:0.9rem;">' +
        '<div>' +
            '<div style="font-size:1rem;font-weight:700;color:white;">🗓️ Cuadrante semanal del club' +
            (alcance ? ' · <span style="color:#d2a8ff;">' + _cqE(window._cronosCoordScopeLabel(alcance)) + '</span>' : '') +
            '</div>' +
            '<div style="font-size:0.72rem;color:var(--text-muted);">Entrenamientos, espacios del campo y partidos · la pauta que siguen los entrenadores</div>' +
        '</div>' +
        '<div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">' +
            '<button class="btn" onclick="cqSemana(-1)" style="padding:0.3rem 0.6rem;font-size:0.85rem;">◀</button>' +
            '<span style="font-size:0.82rem;font-weight:700;color:white;min-width:150px;text-align:center;">' +
                _cqE(fmt(lunes)) + ' — ' + _cqE(fmt(dom)) + '</span>' +
            '<button class="btn" onclick="cqSemana(1)" style="padding:0.3rem 0.6rem;font-size:0.85rem;">▶</button>' +
            '<button class="btn" onclick="cqSemana(0)" style="padding:0.3rem 0.7rem;font-size:0.68rem;background:rgba(88,166,255,0.12);border-color:rgba(88,166,255,0.3);color:#58a6ff;">HOY</button>' +
        '</div>' +
    '</div>';

    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.8rem;">' +
        '<div style="display:flex;gap:0.35rem;align-items:center;">' +
            botonVista('equipos','📋','Por equipos') + botonVista('espacios','🏟️','Ocupación del campo') +
            // 🔍 v606 · Zoom de la parrilla, sólo donde tiene efecto.
            (st.vista === 'equipos' ? _cqBotonesZoom() : '') +
        '</div>' +
        '<div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">' +
            _cqBotonesHistorial() +
            (st.sucio ? '<span style="font-size:0.7rem;color:#f0883e;font-weight:700;">● Sin guardar</span>' : '') +
            // 🗓️ v607 · Copiar / pegar la SEMANA ENTERA. El botón de pegar sólo
            // aparece cuando hay algo copiado, y dice DE QUÉ SEMANA es: pegar a
            // ciegas una semana entera encima de otra sería temerario.
            '<button class="btn" onclick="cqCopiarSemana()" title="Copiar toda la planificación de esta semana para pegarla en otra" style="padding:0.4rem 0.9rem;font-size:0.72rem;font-weight:700;background:rgba(210,168,255,0.10);border:1px solid rgba(210,168,255,0.35);color:#d2a8ff;">🗓️ COPIAR SEMANA</button>' +
            (_semCopiada
                ? '<span style="display:inline-flex;align-items:center;gap:0.2rem;">' +
                    '<button class="btn" onclick="cqPegarSemana()" title="Pegar aquí la semana copiada" style="padding:0.4rem 0.9rem;font-size:0.72rem;font-weight:700;background:rgba(210,168,255,0.18);border:1px solid rgba(210,168,255,0.55);color:#d2a8ff;">📌 PEGAR SEMANA <span style="font-weight:400;opacity:0.85;">(' + _cqE(_semCopiada.etiqueta) + ')</span></button>' +
                    '<button onclick="cqOlvidarSemana()" title="Olvidar la semana copiada" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:0.8rem;padding:0 3px;">✕</button>' +
                  '</span>'
                : '') +
            // 📅 v609 · La puerta a los calendarios oficiales. Va aquí, entre
            // las acciones de la semana, y NO como sección nueva: el autor
            // pidió por escrito en v604 «no crees botones nuevos» refiriéndose
            // a no repartir la funcionalidad por más pantallas.
            // ⚠️ Y SÓLO SI EL MÓDULO ESTÁ. Un botón que existe y no hace nada
            // porque su fichero no cargó es el defecto de v598 otra vez
            // ("Transmitir al SuperAdmin" confirmaba envíos que nadie recibía):
            // mejor que no esté a que esté roto.
            (typeof window.calAbrirGestor === 'function'
                ? '<button class="btn" onclick="calAbrirGestor()" title="Importar el calendario oficial de la federación en PDF" style="padding:0.4rem 0.9rem;font-size:0.72rem;font-weight:700;background:rgba(210,168,255,0.12);border:1px solid rgba(210,168,255,0.4);color:#d2a8ff;">📅 CALENDARIO</button>'
                : '') +
            (nProp ? '<button class="btn" onclick="cqFijarPartidos()" title="Pasar los partidos del calendario oficial a las casillas de esta semana" style="padding:0.4rem 0.9rem;font-size:0.72rem;font-weight:700;background:rgba(63,185,80,0.10);border:1px solid rgba(63,185,80,0.45);color:#3fb950;">📌 FIJAR ' + nProp + ' PARTIDO' + (nProp === 1 ? '' : 'S') + '</button>' : '') +
            '<button class="btn" onclick="cqGuardar()" style="padding:0.4rem 0.9rem;font-size:0.72rem;font-weight:700;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);color:#3fb950;">💾 GUARDAR</button>' +
            // 🖨️ v605 · Para el Ayuntamiento. Ver la nota sobre cqExportar.
            '<button class="btn" onclick="cqExportar()" title="Descargar el cuadrante en PDF para justificar la ocupación del campo" style="padding:0.4rem 0.9rem;font-size:0.72rem;font-weight:700;background:rgba(210,168,255,0.12);border:1px solid rgba(210,168,255,0.45);color:#d2a8ff;">🖨️ EXPORTAR</button>' +
            '<button class="btn" onclick="cqAbrirEnvio()" style="padding:0.4rem 0.9rem;font-size:0.72rem;font-weight:700;background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);color:#58a6ff;">📤 ENVIAR A ENTRENADORES</button>' +
        '</div>' +
    '</div>';

    // Cuándo se publicó por última vez. Sin esto, "enviar" es un botón que no
    // deja rastro y nadie sabe si la semana ya salió o no.
    if (d.publicadoEn) {
        const cuando = new Date(d.publicadoEn);
        html += '<div style="font-size:0.7rem;color:#3fb950;background:rgba(63,185,80,0.07);border:1px solid rgba(63,185,80,0.2);' +
                'border-radius:8px;padding:0.4rem 0.7rem;margin-bottom:0.8rem;">' +
                '✅ Enviado a <strong>' + d.publicadoA.length + '</strong> entrenador' + (d.publicadoA.length === 1 ? '' : 'es') +
                ' el ' + _cqE(cuando.toLocaleDateString('es-ES', { day:'numeric', month:'long' })) +
                ' a las ' + _cqE(cuando.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' })) + '.' +
                ' Lo ven en su <strong>🏃 Planificación Semanal</strong>.</div>';
    }

    // 🔄 v604 · Un cambio ajeno esperando porque yo tengo trabajo sin guardar.
    // NO se aplica solo: se enseña y se deja elegir. Perder lo que uno acaba de
    // escribir porque otro guardó antes es inaceptable.
    if (st.remoto) {
        html += '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.8rem;' +
                    'background:rgba(240,136,62,0.09);border:1px solid rgba(240,136,62,0.45);' +
                    'border-radius:10px;padding:0.55rem 0.8rem;">' +
            '<span style="flex:1;min-width:200px;font-size:0.73rem;color:#f0883e;line-height:1.45;">' +
                '🔄 <strong>' + _cqE(st.remoto.actualizadoPorNombre || 'Otra persona') + '</strong> ha cambiado este cuadrante ' +
                'mientras tú lo editabas. Tus cambios siguen en pantalla y <strong>no se han perdido</strong>; ' +
                'si guardas, tu versión se impondrá.</span>' +
            '<button onclick="cqAdoptarRemoto()" style="padding:0.32rem 0.75rem;border-radius:7px;cursor:pointer;' +
                    'font-size:0.7rem;font-weight:700;background:rgba(240,136,62,0.18);border:1px solid rgba(240,136,62,0.5);' +
                    'color:#f0883e;">Ver la suya</button>' +
            '<button onclick="cqDescartarAvisoRemoto()" style="padding:0.32rem 0.7rem;border-radius:7px;cursor:pointer;' +
                    'font-size:0.7rem;font-weight:700;background:transparent;border:1px solid rgba(255,255,255,0.18);' +
                    'color:#8b949e;">Seguir con la mía</button>' +
        '</div>';
    }

    // ════════════════════════════════════════════════════════════════
    //  📅 v609 · EL CALENDARIO OFICIAL DICE OTRA COSA
    //
    //  Decisión del autor: manda lo que escribió el director. Así que esto es
    //  un AVISO, no una pregunta y mucho menos un cambio automático. Y dice
    //  las dos versiones —la suya y la del papel— porque un aviso que sólo
    //  dijera «hay una discrepancia» obligaría a ir a buscarla.
    //
    //  ⚠️ Sólo salta cuando difieren de verdad (tipo u hora). Que el calendario
    //  coincida con lo ya escrito es lo NORMAL en cuanto se fija una semana:
    //  avisar entonces convertiría el aviso en ruido permanente y se dejaría
    //  de leer, que es como mueren los avisos útiles.
    // ════════════════════════════════════════════════════════════════
    if (_confl.length) {
        html += '<div style="margin-bottom:0.8rem;background:rgba(210,168,255,0.07);border:1px solid rgba(210,168,255,0.35);' +
                    'border-radius:10px;padding:0.55rem 0.8rem;">' +
            '<div style="font-size:0.73rem;color:#d2a8ff;font-weight:700;margin-bottom:0.3rem;">' +
                '📅 El calendario oficial no coincide con ' + (_confl.length === 1 ? 'una casilla' : _confl.length + ' casillas') +
                ' de esta semana · <span style="font-weight:400;">se respeta lo que has puesto tú</span></div>' +
            _confl.map(x => {
                const dia = new Date(x.fecha + 'T12:00:00');
                const metaC = CQ_TIPOS[x.celda.tipo] || CQ_TIPOS.entreno;
                return '<div style="font-size:0.7rem;color:var(--text-muted);line-height:1.5;">' +
                    '<strong style="color:white;">' + _cqE(x.fila.label) + '</strong> · ' +
                    _cqE(dia.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })) + ' — ' +
                    'tú: <span style="color:' + metaC.color + ';">' + _cqE(metaC.corto + (x.celda.ini ? ' ' + x.celda.ini : '')) + '</span> · ' +
                    'el calendario: <span style="color:' + (x.cal.local ? '#3fb950' : '#f0883e') + ';">' +
                        _cqE((x.cal.local ? 'CASA' : 'FUERA') + (x.cal.hora ? ' ' + x.cal.hora : '') +
                             (x.cal.rival ? ' vs ' + x.cal.rival : '')) + '</span></div>';
            }).join('') +
        '</div>';
    }

    html += (st.vista === 'espacios') ? _cqHtmlEspacios(lunes) : _cqHtmlEquipos(lunes);
    container.innerHTML = html;
}

// ── VISTA 1: matriz por equipos (el formato del cuadrante en papel) ──
function _cqHtmlEquipos(lunes) {
    const st = window._cqState, d = st.doc;
    const filas = _cqFilasVisibles(d.filas);
    const fechas = [];
    for (let i = 0; i < 7; i++) { const f = new Date(lunes); f.setDate(lunes.getDate() + i); fechas.push(_cqFechaKey(f)); }

    if (!filas.length) {
        return '<div style="text-align:center;padding:3.5rem 1rem;color:var(--text-muted);line-height:1.8;">' +
            '<div style="font-size:2.5rem;margin-bottom:0.5rem;">🗓️</div>' +
            'Todavía no hay ninguna fila en el cuadrante.<br>' +
            '<span style="font-size:0.8rem;">Las filas salen de los equipos con plantilla publicada. ' +
            'También puedes añadir filas que no son equipos (academia, porteros, fisio).</span>' +
            '<div style="margin-top:1rem;">' + _cqBotonesFila() + '</div></div>';
    }

    // 📐 v606 · LA PARRILLA CABE EN LA PANTALLA. Ver _cqBaseFuente.
    // ⚠️ SIN `min-width`: era lo que forzaba el scroll horizontal. Con
    // `table-layout:fixed` + `<colgroup>` en porcentajes, las ocho columnas se
    // reparten SIEMPRE el ancho disponible, sea el que sea.
    const base = _cqBaseFuente();
    const th = 'padding:0.45em 0.3em;text-align:center;color:#58a6ff;font-size:0.95em;letter-spacing:0.2px;' +
               'border-bottom:2px solid rgba(88,166,255,0.25);';

    const pegandoFila = !!(st.portapapeles && st.portapapeles.modo === 'fila');

    let html = _cqBarraPortapapeles() +
        // El `overflow-x:auto` se queda como RED DE SEGURIDAD, no como diseño:
        // con la tabla fluida no debería activarse nunca, pero si un día alguien
        // vuelve a poner un ancho mínimo, el contenido se podrá alcanzar.
        '<div style="overflow-x:auto;border:1px solid rgba(88,166,255,0.15);border-radius:12px;">' +
        '<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:' + base + 'px;">' +
        // El equipo se lleva un 15%; los siete días se reparten el resto por
        // igual. Es lo que garantiza ver la categoría Y los días a la vez.
        '<colgroup><col style="width:15%;">' +
            new Array(7).fill('<col style="width:12.14%;">').join('') + '</colgroup>' +
        '<thead><tr style="background:rgba(88,166,255,0.08);">' +
        '<th style="' + th + 'text-align:left;">EQUIPO</th>';
    for (let i = 0; i < 7; i++) {
        const f = new Date(lunes); f.setDate(lunes.getDate() + i);
        // ⚠️ En pantallas estrechas se escribe "Lun" y no "LUNES": el nombre
        // largo obligaría a la columna a ensancharse y volvería el scroll.
        html += '<th style="' + th + '">' + (base < 10 ? CQ_DIAS_CORTO[i] : CQ_DIAS[i]) +
                '<div style="font-weight:400;color:var(--text-muted);font-size:0.9em;">' +
                String(f.getDate()).padStart(2,'0') + '/' + String(f.getMonth()+1).padStart(2,'0') + '</div></th>';
    }
    html += '</tr></thead><tbody>';

    filas.forEach((fila, idx) => {
        html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
            '<td style="padding:0.4em 0.35em;vertical-align:middle;">' +
                // ⚠️ `flex-wrap` en la fila de mandos: en la columna estrecha de
                // una pantalla pequeña, los botones caen debajo del nombre en
                // vez de aplastarlo hasta hacerlo ilegible.
                '<div style="display:flex;align-items:center;gap:0.3em;flex-wrap:wrap;">' +
                    '<div style="flex:1 1 100%;min-width:0;font-weight:700;color:white;font-size:1.05em;line-height:1.3;overflow-wrap:break-word;word-break:normal;hyphens:auto;">' +
                        (fila.tipo === 'libre' ? '<span style="opacity:0.7;">⭐ </span>' : '') + _cqE(fila.label) + '</div>' +
                    // 📋 v604 · Copiar / pegar la SEMANA ENTERA de un equipo.
                    // Es lo que más tiempo ahorra: dos equipos de la misma
                    // categoría suelen tener la misma semana con otra hora.
                    (pegandoFila
                        ? '<button title="Pegar aquí la semana copiada" onclick="cqPegarFila(\'' + _cqA(fila.id) + '\')" ' +
                              'style="background:rgba(210,168,255,0.12);border:1px solid rgba(210,168,255,0.5);color:#d2a8ff;' +
                              'cursor:copy;font-size:0.9em;border-radius:5px;padding:1px 4px;font-weight:700;">📌</button>'
                        : '<button title="Copiar la semana de este equipo" onclick="cqCopiarFila(\'' + _cqA(fila.id) + '\')" ' +
                              'style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:0.9em;padding:0 2px;">📋</button>') +
                    '<button title="Subir" onclick="cqMoverFila(' + idx + ',-1)" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:0.8em;line-height:1;padding:0 2px;">▲</button>' +
                    '<button title="Bajar" onclick="cqMoverFila(' + idx + ',1)" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:0.8em;line-height:1;padding:0 2px;">▼</button>' +
                    '<button title="Quitar esta fila del cuadrante" onclick="cqQuitarFila(\'' + _cqA(fila.id) + '\')" ' +
                        'style="background:none;border:none;color:#ff5858;cursor:pointer;font-size:0.9em;padding:0 2px;">✕</button>' +
                '</div>' +
            '</td>';

        fechas.forEach(fecha => {
            const c = d.celdas[fila.id + '|' + fecha];
            html += '<td style="padding:1px;vertical-align:top;">' + _cqHtmlCelda(fila.id, fecha, c) + '</td>';
        });
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += '<div style="margin-top:0.7rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.6rem;">' +
            _cqBotonesFila() + _cqLeyenda() + '</div>';
    return html;
}

function _cqHtmlCelda(filaId, fecha, c) {
    // 📋 v604 · MODO PEGAR. Con algo en el portapapeles, pulsar una casilla
    // PEGA en vez de abrir el editor: es lo que convierte "duplicar un sector"
    // en dos clics. El modo se ve (barra arriba + borde de la casilla) para
    // que nadie pegue creyendo que iba a editar.
    const pegando = !!(window._cqState.portapapeles && window._cqState.portapapeles.modo === 'celda');
    const abrir = pegando
        ? 'cqPegarCelda(\'' + _cqA(filaId) + '\',\'' + _cqA(fecha) + '\')'
        : 'cqEditarCelda(\'' + _cqA(filaId) + '\',\'' + _cqA(fecha) + '\')';
    // 📐 v606 · TODO EN `em`: la casilla hereda el tamaño de letra de la tabla,
    // que fija _cqBaseFuente según el ancho de pantalla y el zoom elegido. Con
    // `rem` la casilla no se enteraba del zoom y seguía desbordando.
    // ════════════════════════════════════════════════════════════════
    //  📐 v608 · LA CASILLA CRECE CON SU CONTENIDO
    //
    //  Reporte del autor (captura 9425): el rótulo "campo completo" de los
    //  partidos del sábado se salía por el BORDE INFERIOR de la casilla.
    //
    //  🔑 LA CAUSA DE FONDO NO ERA EL TEXTO, ERA EL `<button>`. Un botón sin
    //  `display` explícito coloca su contenido en una caja anónima que el
    //  navegador CENTRA VERTICALMENTE, y cuando ese contenido pasa de la altura
    //  de la caja se desborda por fuera en lugar de estirar el botón. El
    //  `min-height:4.4em` no lo salvaba: la caja anónima no lo respeta como lo
    //  haría un bloque normal. Por eso el desbordamiento aparecía justo en las
    //  casillas con CUATRO líneas (rótulo + hora + espacios + nota) y no en las
    //  de tres.
    //
    //  Con `display:flex; flex-direction:column; justify-content:center` el
    //  botón se comporta como cualquier contenedor: crece si hace falta y, si
    //  sobra sitio, centra — que es exactamente lo que pidió el autor.
    //  `box-sizing:border-box` para que el relleno no se sume a la altura.
    // ════════════════════════════════════════════════════════════════
    const CAJA = 'display:flex;flex-direction:column;justify-content:center;align-items:stretch;' +
                 'box-sizing:border-box;width:100%;min-height:4.4em;';

    if (pegando && !c) {
        return '<button onclick="' + abrir + '" title="Pegar aquí lo copiado" ' +
            'style="' + CAJA + 'border:1px dashed rgba(210,168,255,0.55);border-radius:6px;' +
                   'background:rgba(210,168,255,0.08);color:#d2a8ff;cursor:copy;font-size:1em;font-weight:700;">📌</button>';
    }
    if (!c) {
        // ── 📅 v609 · PARTIDO OFICIAL PROPUESTO ─────────────────────
        //  Se pinta con el color que le toca —verde en casa, naranja fuera,
        //  como pidió el autor— pero con el borde PUNTEADO y su 📅, porque
        //  todavía no está en el documento. Confundir una propuesta con una
        //  casilla guardada haría creer al director que la semana está
        //  cuadrada cuando aún no ha guardado nada.
        const p = _cqPropuesta(filaId, fecha);
        if (p) {
            const metaP = CQ_TIPOS[p.local ? 'partido_casa' : 'partido_fuera'];
            const rgbP = (typeof window._cronosHexRgb === 'function') ? window._cronosHexRgb(metaP.color) : '63,185,80';
            return '<button onclick="' + abrir + '" title="' + _cqA('Del calendario oficial · ' +
                    (p.jornada != null ? 'Jornada ' + p.jornada + ' · ' : '') + metaP.label +
                    (p.rival ? ' · ' + p.rival : '') + (p.sede ? ' · ' + p.sede : '') +
                    '\nPúlsala para ajustarla y fijarla en el cuadrante.') + '" ' +
                'style="' + CAJA + 'text-align:center;border-radius:6px;cursor:pointer;padding:0.35em 0.25em;' +
                       'background:rgba(' + rgbP + ',0.07);border:1px dashed rgba(' + rgbP + ',0.55);color:' + metaP.color + ';">' +
                '<div style="font-weight:800;font-size:0.9em;line-height:1.25;overflow-wrap:break-word;word-break:normal;">' +
                    '📅 ' + _cqE(metaP.corto) + '</div>' +
                (p.hora ? '<div style="font-size:0.78em;opacity:0.9;">' + _cqE(p.hora) + '</div>' : '') +
                '<div style="font-size:0.74em;opacity:0.85;overflow-wrap:break-word;word-break:normal;">' +
                    _cqE(p.rival || '') + '</div>' +
                '</button>';
        }
        return '<button onclick="' + abrir + '" title="Añadir actividad" ' +
            'style="' + CAJA + 'border:1px dashed rgba(255,255,255,0.10);border-radius:6px;' +
                   'background:transparent;color:rgba(255,255,255,0.18);cursor:pointer;font-size:1.2em;">+</button>';
    }
    const meta = CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno;
    const rgb  = (typeof window._cronosHexRgb === 'function') ? window._cronosHexRgb(meta.color) : '139,148,158';
    const horas = (c.ini && c.fin) ? (c.ini + ' a ' + c.fin) : (c.ini || '');
    // 🏟️ v607 · Se escribe lo que OCUPA de verdad. Un partido en casa sin
    // espacios marcados dice "campo completo" —no "1·2·3·4"— para que se
    // distinga de haberlos elegido uno a uno.
    const espLista = _cqEspaciosDe(c);
    const espCompleto = _cqEspacioImplicito(c);
    const esp = !espLista.length ? ''
              : espCompleto ? 'campo completo'
              : espLista.join('·');

    // 📐 v605 · Texto que respira: más aire alrededor, interlineado suelto y
    // `letter-spacing` a cero. El espaciado entre letras que había apretaba el
    // rótulo contra el borde y era parte de por qué la última letra saltaba.
    return '<button onclick="' + abrir + '" title="' + _cqA(meta.label + (horas ? ' · ' + horas : '')) + '" ' +
        'style="' + CAJA + 'text-align:center;border-radius:6px;cursor:pointer;padding:0.35em 0.25em;' +
               'background:rgba(' + rgb + ',0.14);border:1px solid rgba(' + rgb + ',0.45);color:' + meta.color + ';">' +
        '<div style="font-weight:800;font-size:0.95em;line-height:1.3;overflow-wrap:break-word;word-break:normal;hyphens:auto;">' +
            // Sin rótulo propio se escribe el nombre CORTO del tipo: "ENTRENO"
            // cabe en una columna de siete, "ENTRENAMIENTO" no.
            _cqE(c.txt || meta.corto || meta.label.toUpperCase()) + '</div>' +
        // ⚠️ v606 · LAS HORAS YA NO VAN CON `nowrap`. En una columna estrecha
        // "18:00 a 19:30" desbordaba la casilla y reaparecía el scroll. Se
        // escribe la hora de inicio y la de fin en DOS LÍNEAS, que ni se parten
        // ni desbordan: cada una es un bloque indivisible de cinco caracteres.
        (horas ? '<div style="font-size:0.92em;color:white;opacity:0.85;line-height:1.3;">' +
                    '<span style="white-space:nowrap;">' + _cqE(c.ini || '') + '</span>' +
                    (c.fin ? '<span style="white-space:nowrap;"> – ' + _cqE(c.fin) + '</span>' : '') +
                 '</div>' : '') +
        // 🏟️ v608 · "campo completo" es DIECISÉIS caracteres; "1·2·3" son
        // cinco. Con el mismo `nowrap` para los dos, el rótulo largo no podía
        // partirse y empujaba la casilla. Ahora:
        //   · el numérico conserva `nowrap` — "1·2·3" partido no se lee;
        //   · el largo va un punto más pequeño y PUEDE pasar a dos líneas,
        //     que es lo que el autor pidió ("reduciendo ligeramente el tamaño
        //     de su tipografía").
        (esp   ? '<div style="font-size:' + (espCompleto ? '0.76em' : '0.88em') + ';opacity:0.8;line-height:1.25;' +
                     (espCompleto ? 'overflow-wrap:break-word;word-break:normal;' : 'white-space:nowrap;') + '">' +
                     '🏟️ ' + _cqE(esp) + '</div>' : '') +
        (c.nota ? '<div style="font-size:0.85em;opacity:0.75;line-height:1.3;overflow-wrap:break-word;word-break:normal;hyphens:auto;">' + _cqE(c.nota) + '</div>' : '') +
    '</button>';
}

// ════════════════════════════════════════════════════════════════════
//  📋 v604 · COPIAR Y PEGAR EN LA PARRILLA
//
//  Petición del autor tras probar la v603: rellenar el cuadrante a mano casilla
//  a casilla es lento, y en un club real muchos bloques se repiten (el Alevín A
//  y el Alevín B entrenan igual, con otra hora; el mismo equipo repite lunes y
//  miércoles). "Duplicar un sector y sólo tener que ajustar la hora".
//
//  DOS granularidades, porque son dos trabajos distintos:
//    · CELDA — un bloque suelto (tipo + horas + espacios + rótulo + nota).
//    · FILA  — la semana ENTERA de un equipo, a otro equipo.
//
//  🔑 EL MODO PEGAR ES VISIBLE Y SE SALE DE ÉL. Mientras hay algo copiado, la
//  parrilla cambia de comportamiento: pulsar una casilla PEGA en vez de abrir
//  el editor. Un cambio de comportamiento invisible es una trampa, así que se
//  anuncia con una barra que dice qué hay copiado y lleva el botón de salir.
//
//  ⚠️ PEGAR NO GUARDA. Marca `sucio` como cualquier otra edición: el autor
//  revisa y pulsa GUARDAR. Así un pegado en la fila equivocada se deshace
//  cambiando de semana sin guardar, igual que el resto.
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
//  📐 v606 · LA PARRILLA CABE EN LA PANTALLA, SIN SCROLL HORIZONTAL
//
//  Reporte del autor tras probar la v605 (capturas 9417-9419): la vista "Por
//  equipos" obligaba a desplazarse a derecha e izquierda, y al irse a la
//  derecha se perdía de vista la columna del equipo — que es justo la que da
//  sentido a la fila. "Se vea íntegra de un solo vistazo".
//
//  🔑 EL ARREGLO NO ES QUITAR EL `min-width` Y YA. Eso metía las ocho columnas
//  en el ancho disponible, sí, pero con la letra de antes el texto se aplastaba
//  y volvíamos al defecto de la v604 (rótulos partidos), que acabábamos de
//  corregir. Ancho fijo y letra fija son incompatibles: **lo que tiene que
//  ceder es el TAMAÑO DE LETRA**, y con él todo lo demás.
//
//  Por eso la tabla lleva un `font-size` en píxeles y TODO lo de dentro va en
//  `em`. Un solo número escala la parrilla entera —rótulos, horas, botones,
//  altura de las casillas— y nada se descuadra respecto a lo demás.
//
//  DOS FUENTES para ese número, que se multiplican:
//   1. AUTOMÁTICA por ancho de ventana. Ocho columnas en 560 px no admiten la
//      misma letra que en 1600 px. Es lo que hace que quepa sin tocar nada.
//   2. MANUAL, el zoom que pidió el autor (🔍 − / +). Se recuerda: quien
//      trabaja en un monitor grande quiere la letra grande SIEMPRE, y volver a
//      ajustarlo en cada visita convierte la ayuda en una molestia.
//
//  ⚠️ CON SUELO Y TECHO. Por debajo de 7 px no se lee ni con lupa y por encima
//  de 15 px vuelve el scroll que veníamos a quitar: el zoom manual no puede
//  deshacer el propósito de todo esto.
// ════════════════════════════════════════════════════════════════════
const CQ_ZOOM_KEY  = 'cronos_cq_zoom';
const CQ_ZOOM_PASO = 0.1;
const CQ_ZOOM_MIN  = 0.7;
const CQ_ZOOM_MAX  = 1.4;

function _cqZoom() {
    try {
        const v = parseFloat(localStorage.getItem(CQ_ZOOM_KEY));
        if (isNaN(v)) return 1;
        return Math.min(CQ_ZOOM_MAX, Math.max(CQ_ZOOM_MIN, v));
    } catch (e) { return 1; }
}

function _cqBaseFuente() {
    const ancho = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1200;
    // Tamaño que deja las ocho columnas legibles en cada tramo de pantalla.
    const auto = ancho < 560  ? 7.5
               : ancho < 760  ? 8.5
               : ancho < 1000 ? 9.5
               : ancho < 1400 ? 10.5
               :                11.5;
    const px = auto * _cqZoom();
    return Math.round(Math.min(15, Math.max(7, px)) * 10) / 10;
}

window.cqZoom = function (delta) {
    const nuevo = Math.min(CQ_ZOOM_MAX, Math.max(CQ_ZOOM_MIN,
        Math.round((_cqZoom() + delta * CQ_ZOOM_PASO) * 100) / 100));
    try { localStorage.setItem(CQ_ZOOM_KEY, String(nuevo)); } catch (e) { /* sin persistencia, pero funciona */ }
    _cqPintar();
};

function _cqBotonesZoom() {
    const z = _cqZoom();
    const bot = (txt, delta, titulo, apagado) =>
        '<button ' + (apagado ? '' : 'onclick="cqZoom(' + delta + ')"') +
            ' title="' + _cqA(titulo) + '" style="padding:0.25rem 0.5rem;border-radius:6px;font-size:0.72rem;' +
            'font-weight:800;border:1px solid rgba(255,255,255,0.12);background:transparent;' +
            'color:' + (apagado ? '#484f58' : '#8b949e') + ';cursor:' + (apagado ? 'not-allowed' : 'pointer') + ';">' +
        txt + '</button>';
    return '<span style="display:inline-flex;align-items:center;gap:0.25rem;" title="Ajusta el tamaño de la parrilla">' +
        '<span style="font-size:0.7rem;color:#8b949e;">🔍</span>' +
        bot('−', -1, 'Reducir la parrilla', z <= CQ_ZOOM_MIN + 0.001) +
        bot('+',  1, 'Agrandar la parrilla', z >= CQ_ZOOM_MAX - 0.001) +
    '</span>';
}

function _cqBarraPortapapeles() {
    const p = window._cqState.portapapeles;
    if (!p) return '';
    return '<div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.7rem;' +
                'background:rgba(210,168,255,0.08);border:1px solid rgba(210,168,255,0.4);' +
                'border-radius:10px;padding:0.5rem 0.75rem;">' +
        '<span style="font-size:0.72rem;color:#d2a8ff;font-weight:700;">📋 Copiado:</span>' +
        '<span style="flex:1;min-width:0;font-size:0.72rem;color:white;overflow-wrap:break-word;word-break:normal;hyphens:auto;">' + _cqE(p.etiqueta) + '</span>' +
        '<span style="font-size:0.68rem;color:var(--text-muted);">' +
            (p.modo === 'fila' ? 'Pulsa el 📌 de otro equipo para pegar su semana'
                               : 'Pulsa una casilla para pegarlo ahí') + '</span>' +
        '<button onclick="cqCancelarCopia()" style="padding:0.28rem 0.7rem;border-radius:7px;cursor:pointer;' +
                'font-size:0.68rem;font-weight:700;background:transparent;border:1px solid rgba(255,255,255,0.18);' +
                'color:#8b949e;">✕ Salir</button>' +
    '</div>';
}

function _cqEtiquetaCelda(c) {
    if (!c) return '(vacío)';
    const meta = CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno;
    const horas = c.ini ? (c.ini + (c.fin ? '–' + c.fin : '')) : 'sin hora';
    const esp = (Array.isArray(c.esp) && c.esp.length) ? ' · espacios ' + c.esp.slice().sort().join('·') : '';
    return (c.txt || meta.label) + ' · ' + horas + esp;
}

window.cqCopiarCelda = function (filaId, fecha) {
    const c = window._cqState.doc.celdas[filaId + '|' + fecha];
    if (!c) { _cqToast('⚠️ No hay nada que copiar en esa casilla.'); return; }
    // Copia PROFUNDA: si se guardara la referencia, editar el original después
    // cambiaría también lo copiado, y lo pegado saldría distinto de lo que la
    // barra dice que hay en el portapapeles.
    window._cqState.portapapeles = {
        modo: 'celda',
        datos: { tipo: c.tipo, ini: c.ini, fin: c.fin, esp: (c.esp || []).slice(), txt: c.txt, nota: c.nota },
        etiqueta: _cqEtiquetaCelda(c),
    };
    cqCerrarOverlay();
    _cqToast('📋 Copiado. Pulsa las casillas donde quieras pegarlo.', 4000);
    _cqPintar();
};

window.cqPegarCelda = function (filaId, fecha) {
    const st = window._cqState;
    const p = st.portapapeles;
    if (!p || p.modo !== 'celda') return;
    const d = p.datos;
    st.doc.celdas[filaId + '|' + fecha] = {
        tipo: d.tipo, ini: d.ini, fin: d.fin, esp: (d.esp || []).slice(), txt: d.txt, nota: d.nota,
    };
    st.sucio = true;
    _cqHistPush('pegar casilla');
    _cqPintar();
    // ⚠️ NO se sale del modo pegar: lo normal es pegar el mismo bloque en
    // varios días seguidos. Se sale con "✕ Salir" de la barra.
};

window.cqCopiarFila = function (filaId) {
    const st = window._cqState;
    const fila = st.doc.filas.find(f => f.id === filaId);
    if (!fila) return;
    const semana = {};
    let n = 0;
    Object.keys(st.doc.celdas).forEach(k => {
        if (k.indexOf(filaId + '|') !== 0) return;
        const c = st.doc.celdas[k];
        semana[k.slice(filaId.length + 1)] = {
            tipo: c.tipo, ini: c.ini, fin: c.fin, esp: (c.esp || []).slice(), txt: c.txt, nota: c.nota };
        n++;
    });
    if (!n) { _cqToast('⚠️ «' + fila.label + '» no tiene nada esta semana.', 4000); return; }
    st.portapapeles = { modo: 'fila', datos: semana,
        etiqueta: 'la semana de ' + fila.label + ' (' + n + ' día' + (n === 1 ? '' : 's') + ')' };
    _cqToast('📋 Semana copiada. Pulsa el 📌 del equipo de destino.', 4000);
    _cqPintar();
};

window.cqPegarFila = function (filaId) {
    const st = window._cqState;
    const p = st.portapapeles;
    if (!p || p.modo !== 'fila') return;
    const fila = st.doc.filas.find(f => f.id === filaId);
    if (!fila) return;

    // ⚠️ PEGAR UNA SEMANA SOBRE OTRA LA SUSTITUYE. Si el destino ya tiene
    // cosas, se pregunta: perder la semana de un equipo por un clic sería
    // exactamente el tipo de borrado silencioso que este proyecto ya ha
    // sufrido varias veces.
    const tenia = Object.keys(st.doc.celdas).filter(k => k.indexOf(filaId + '|') === 0);
    if (tenia.length && !confirm('«' + fila.label + '» ya tiene ' + tenia.length +
            ' día(s) asignados esta semana.\n\n¿Sustituirlos por ' + p.etiqueta + '?')) return;

    tenia.forEach(k => { delete st.doc.celdas[k]; });
    Object.keys(p.datos).forEach(fecha => {
        const c = p.datos[fecha];
        st.doc.celdas[filaId + '|' + fecha] = {
            tipo: c.tipo, ini: c.ini, fin: c.fin, esp: (c.esp || []).slice(), txt: c.txt, nota: c.nota };
    });
    st.sucio = true;
    _cqHistPush('pegar fila en ' + fila.label);
    _cqToast('📌 Semana pegada en ' + fila.label + '. Ajusta las horas y guarda.', 4000);
    _cqPintar();
};

window.cqCancelarCopia = function () {
    window._cqState.portapapeles = null;
    _cqPintar();
};

// ════════════════════════════════════════════════════════════════════
//  🗓️ v607 · COPIAR LA SEMANA COMPLETA Y PEGARLA EN OTRA
//
//  Petición del autor: duplicar de un clic toda la planificación de todas las
//  categorías para pegarla en la semana siguiente, en vez de rellenarla desde
//  cero cada semana. Es lo que de verdad ahorra el trabajo: en un club la
//  semana tipo se repite y sólo cambian los partidos del fin de semana.
//
//  🔑 SE GUARDA POR ÍNDICE DE DÍA (0 = lunes … 6 = domingo), NO POR FECHA.
//  Las celdas viven en `celdas['<filaId>|<YYYY-MM-DD>']`, así que copiar las
//  claves tal cual y pegarlas en otra semana escribiría las fechas de la
//  semana ORIGEN dentro del documento de la semana DESTINO: cada casilla
//  quedaría en un documento cuyo `weekKey` no le corresponde, invisible en las
//  dos. Guardando el índice, el remapeo al pegar es exacto.
//
//  🔑🔑 SÓLO SE COPIAN Y SE PISAN LAS FILAS QUE ESTE USUARIO VE. Un
//  coordinador de F7 que copiara "toda la semana" se llevaría los equipos de
//  F11 —que ni ve— y al pegar los sobrescribiría en la semana destino sin
//  saberlo. Las filas fuera de su alcance NO se copian y sus celdas del
//  destino se quedan intactas: es la regla de v593 aplicada a una operación
//  masiva, que es donde más daño haría.
//
//  ⚠️ VIVE EN localStorage. Copiar una semana, navegar a otra y pegar es el
//  flujo entero; si el portapapeles muriera con el repintado, la función no
//  serviría para nada. Y sobrevive a una recarga, que es lo que se espera de
//  algo llamado "copiar".
//
//  ⚠️ PEGAR NO GUARDA. Marca `sucio` como cualquier otra edición: se revisa,
//  se ajustan los partidos del fin de semana y se pulsa GUARDAR.
// ════════════════════════════════════════════════════════════════════
const CQ_SEMANA_KEY = 'cronos_cq_semana';

// ════════════════════════════════════════════════════════════════════
//  🔴 v615 · UNA SEMANA SE COPIA SIN SUS PARTIDOS. NUNCA CON ELLOS.
// ════════════════════════════════════════════════════════════════════
//  Petición del autor (implementar.txt, 2026-08-24), y la razón que da es
//  exactamente la correcta: «los partidos oficiales cambian de día cada
//  semana — una semana se juega en casa un viernes y a la siguiente un
//  sábado». Está descrito en el calendario que acabamos de importar: el
//  Estrella CF juega la jornada 7 un sábado a las 11:00 y la 8 un viernes a
//  las 21:00.
//
//  Lo que hacía antes era doblemente destructivo, y las dos mitades importan:
//   1. Se LLEVABA el partido del viernes de la semana origen…
//   2. …y al pegar VACIABA la semana destino entera, así que se cargaba el
//      partido del sábado que ya estaba bien puesto, y encima le plantaba
//      encima el del viernes, que no le toca.
//
//  El resultado era un cuadrante con el partido en el día equivocado — y el
//  cuadrante es la pauta que siguen todos los entrenadores del club y el
//  papel que se le manda al Ayuntamiento con la ocupación del campo.
//
//  🔑 UN PARTIDO NO ES UNA ACTIVIDAD SEMANAL REPETIBLE: es un hecho con
//  fecha propia que viene del calendario oficial. Los entrenamientos sí se
//  repiten —esa es justo la razón de ser de "copiar semana"—. Así que la
//  copia lleva SÓLO entrenamientos y otras actividades, y al pegar los
//  partidos del destino son intocables: ni se borran ni se sobrescriben.
// ════════════════════════════════════════════════════════════════════
function _cqEsPartido(c) {
    return !!c && (c.tipo === 'partido_casa' || c.tipo === 'partido_fuera');
}

// ════════════════════════════════════════════════════════════════════
//  ↩️ v615 · DESHACER / REHACER
// ════════════════════════════════════════════════════════════════════
//  Petición del autor: «dar marcha atrás de forma fluida a las últimas
//  acciones, facilitando y haciendo mucho más seguro un trabajo que de por sí
//  es laborioso». Y lo es: aquí se pega una semana entera de un clic, se
//  vacían filas con sus actividades y se fijan los partidos del calendario en
//  bloque. Hasta ahora, una de esas operaciones sólo se podía revertir
//  rehaciéndola a mano casilla por casilla, o saliendo sin guardar y
//  perdiendo TAMBIÉN todo lo bueno que se hubiera hecho antes.
//
//  🔑 SE GUARDAN INSTANTÁNEAS, NO OPERACIONES INVERSAS. Un historial de
//  "acciones con su contraria" obliga a escribir —y a mantener correcto— un
//  deshacer distinto por cada operación, y la que más falta hace (pegar
//  semana) es justo la que más difícil sería de invertir a mano. Un cuadrante
//  entero son unos pocos kilobytes de JSON: clonarlo es barato y no puede
//  desincronizarse de la operación que lo produjo.
//
//  ⚠️ EL HISTORIAL NO TOCA FIRESTORE. Deshacer devuelve la pantalla a un
//  estado anterior y marca `sucio`; nada se escribe hasta GUARDAR. Por eso
//  `guardado` recuerda EN QUÉ PUNTO de la pila se guardó: si deshaces hasta
//  volver justo a lo guardado, el aviso "● Sin guardar" tiene que apagarse,
//  porque de verdad no hay nada pendiente.
//
//  ⚠️ Y SE REINICIA AL CAMBIAR DE SEMANA O AL ADOPTAR UN CAMBIO AJENO. La
//  pila describe UN documento; conservarla al cambiar de semana dejaría un
//  "deshacer" que escribiría las casillas de la semana pasada dentro de ésta.
// ════════════════════════════════════════════════════════════════════
const CQ_HIST_MAX = 40;

function _cqInstantanea() {
    const d = window._cqState.doc;
    if (!d) return '';
    return JSON.stringify({ filas: d.filas || [], celdas: d.celdas || {},
                            espacios: d.espacios || CQ_ESPACIOS });
}

// Arranca el historial con el documento recién cargado como punto cero.
function _cqHistInit() {
    const st = window._cqState;
    const s = _cqInstantanea();
    st.hist = s ? { pila: [{ s, etiqueta: 'al abrir' }], i: 0, guardado: 0 }
                : { pila: [], i: -1, guardado: -1 };
}

function _cqHistPush(etiqueta) {
    const st = window._cqState;
    if (!st.doc) return;
    if (!st.hist) _cqHistInit();
    const h = st.hist, s = _cqInstantanea();
    // Una acción que no cambió nada no merece un paso de historial: si no,
    // "deshacer" empezaría a no hacer nada visible y parecería roto.
    if (h.i >= 0 && h.pila[h.i] && h.pila[h.i].s === s) return;
    h.pila.length = h.i + 1;        // al escribir se pierde el rehacer pendiente
    h.pila.push({ s, etiqueta: etiqueta || 'cambio' });
    if (h.pila.length > CQ_HIST_MAX) {
        h.pila.shift();
        if (h.guardado >= 0) h.guardado--;
    }
    h.i = h.pila.length - 1;
}

function _cqHistIr(destino) {
    const st = window._cqState, h = st.hist;
    if (!h || destino < 0 || destino >= h.pila.length || !st.doc) return false;
    let d;
    try { d = JSON.parse(h.pila[destino].s); } catch (e) { return false; }
    st.doc.filas    = d.filas || [];
    st.doc.celdas   = d.celdas || {};
    st.doc.espacios = d.espacios || CQ_ESPACIOS;
    h.i = destino;
    st.sucio = (h.i !== h.guardado);
    _cqPintar();
    return true;
}

function _cqPuedeDeshacer() { const h = window._cqState.hist; return !!h && h.i > 0; }
function _cqPuedeRehacer()  { const h = window._cqState.hist; return !!h && h.i >= 0 && h.i < h.pila.length - 1; }

window.cqDeshacer = function () {
    const h = window._cqState.hist;
    if (!_cqPuedeDeshacer()) { _cqToast('No hay nada más que deshacer.'); return; }
    const eti = h.pila[h.i].etiqueta;
    if (_cqHistIr(h.i - 1)) _cqToast('↩️ Deshecho: ' + eti);
};

window.cqRehacer = function () {
    const h = window._cqState.hist;
    if (!_cqPuedeRehacer()) { _cqToast('No hay nada que rehacer.'); return; }
    if (_cqHistIr(h.i + 1)) _cqToast('↪️ Rehecho: ' + h.pila[h.i].etiqueta);
};

// Tras guardar, ESTE es el punto sin cambios pendientes.
function _cqHistGuardado() {
    const h = window._cqState.hist;
    if (h) h.guardado = h.i;
}

// ⌨️ Ctrl/⌘+Z y Ctrl/⌘+Y (o ⇧+Z). Se ignora mientras se escribe en un campo
// o con un editor abierto: ahí Ctrl+Z tiene que deshacer el TEXTO, no el
// cuadrante — robárselo al usuario sería peor que no tener atajo.
function _cqTeclas(ev) {
    if (!ev.ctrlKey && !ev.metaKey) return;
    const st = window._cqState;
    if (!st || !st.doc) return;
    if (!document.getElementById('staff-dashboard-content')) return;
    if (document.getElementById('cq-overlay')) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || '')) return;
    const k = String(ev.key || '').toLowerCase();
    if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); window.cqDeshacer(); }
    else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); window.cqRehacer(); }
}
//  ⚠️ SE ENGANCHA AL ABRIR EL CUADRANTE, NO AL CARGAR EL FICHERO. Este módulo
//  no toca el DOM mientras se carga —sólo declara—, y es lo que permite que el
//  guard lo ejecute de verdad en Node en vez de comprobarlo por regex. Un
//  `addEventListener` en la raíz rompía esa propiedad y tumbaba la suite
//  entera. Además, un oyente global vivo cuando esta sección ni está abierta
//  es justo la clase de fuga que ya costó un disgusto en v439.
function _cqEngancharTeclas() {
    if (window._cqTeclasPuestas) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    document.addEventListener('keydown', _cqTeclas);
    window._cqTeclasPuestas = true;
}

function _cqBotonesHistorial() {
    const b = (activo, onclick, icono, titulo) =>
        '<button class="btn"' + (activo ? ' onclick="' + onclick + '"' : ' disabled') +
        ' title="' + _cqA(titulo) + '" style="padding:0.4rem 0.7rem;font-size:0.8rem;line-height:1;' +
        (activo ? 'background:rgba(88,166,255,0.10);border:1px solid rgba(88,166,255,0.35);color:#58a6ff;cursor:pointer;'
                : 'background:transparent;border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.20);cursor:default;') +
        '">' + icono + '</button>';
    const h = window._cqState.hist;
    const sig = (h && _cqPuedeDeshacer()) ? h.pila[h.i].etiqueta : '';
    const red = (h && _cqPuedeRehacer()) ? h.pila[h.i + 1].etiqueta : '';
    return '<span style="display:inline-flex;gap:0.25rem;">' +
        b(_cqPuedeDeshacer(), 'cqDeshacer()', '↩️', sig ? 'Deshacer: ' + sig + '  (Ctrl+Z)' : 'Nada que deshacer') +
        b(_cqPuedeRehacer(), 'cqRehacer()', '↪️', red ? 'Rehacer: ' + red + '  (Ctrl+Y)' : 'Nada que rehacer') +
    '</span>';
}

function _cqSemanaCopiada() {
    try {
        const v = JSON.parse(localStorage.getItem(CQ_SEMANA_KEY) || 'null');
        if (!v || !Array.isArray(v.entradas) || !v.entradas.length) return null;
        return v;
    } catch (e) { return null; }
}

window.cqCopiarSemana = function () {
    const st = window._cqState;
    if (!st.doc) return;
    const lunes  = _cqLunes(st.offset);
    const visibles = _cqFilasVisibles(st.doc.filas);
    const entradas = [];
    let partidosFuera = 0;
    for (let i = 0; i < 7; i++) {
        const fecha = _cqFechaKey(new Date(lunes.getTime() + i * 86400000));
        visibles.forEach(f => {
            const c = st.doc.celdas[f.id + '|' + fecha];
            if (!c) return;
            // 🔴 El partido NO viaja: cambia de día cada jornada (ver la nota).
            if (_cqEsPartido(c)) { partidosFuera++; return; }
            entradas.push({ filaId: f.id, dia: i,
                celda: { tipo: c.tipo, ini: c.ini, fin: c.fin,
                         esp: (c.esp || []).slice(), txt: c.txt, nota: c.nota } });
        });
    }

    if (!entradas.length) {
        _cqToast(partidosFuera
            ? '⚠️ Esta semana sólo tiene partidos, y los partidos no se copian: cada jornada cae en un día distinto.'
            : '⚠️ Esta semana está vacía: no hay nada que copiar.', 5000);
        return;
    }

    const dom = new Date(lunes); dom.setDate(lunes.getDate() + 6);
    const f = d => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const paquete = {
        weekKey: st.doc.weekKey,
        etiqueta: f(lunes) + ' – ' + f(dom),
        // Las filas se llevan enteras: si la semana origen tiene una fila libre
        // ("Porteros", "Fisio") que el destino no conoce, hay que poder crearla
        // allí o sus celdas no tendrían dónde caer.
        filas: visibles.map(x => ({ id: x.id, tipo: x.tipo, cat: x.cat, sub: x.sub, label: x.label })),
        entradas: entradas,
    };

    try {
        localStorage.setItem(CQ_SEMANA_KEY, JSON.stringify(paquete));
    } catch (e) {
        _cqToast('⚠️ No se pudo copiar la semana: ' + (e && e.message ? e.message : e), 5000);
        return;
    }
    _cqToast('🗓️ Semana copiada: ' + entradas.length + ' entrenamiento(s)' +
             (partidosFuera ? ' · ' + partidosFuera + ' partido(s) NO se copian (cada jornada cae en otro día)' : '') +
             '. Ve a otra semana y pulsa PEGAR SEMANA.', 6000);
    _cqPintar();
};

window.cqPegarSemana = function () {
    const st = window._cqState;
    const p  = _cqSemanaCopiada();
    if (!st.doc || !p) return;

    if (p.weekKey === st.doc.weekKey) {
        _cqToast('⚠️ Es la misma semana que copiaste. Ve a otra semana para pegarla.', 4500);
        return;
    }

    // Sólo se toca lo que este usuario ve (ver la nota de arriba).
    const visibles = _cqFilasVisibles(st.doc.filas);
    const idsVisibles = {};
    visibles.forEach(f => { idsVisibles[f.id] = true; });

    // 🔴 LO QUE SE VACÍA NO INCLUYE LOS PARTIDOS. Un partido de esta semana
    // está en SU día porque lo dice el calendario oficial; borrarlo para
    // meter el entrenamiento de otra semana es exactamente el destrozo que
    // el autor pidió evitar.
    const yaHabia = [], partidosDestino = [];
    Object.keys(st.doc.celdas).forEach(k => {
        const filaId = k.slice(0, k.lastIndexOf('|'));
        if (!idsVisibles[filaId]) return;
        if (_cqEsPartido(st.doc.celdas[k])) partidosDestino.push(k);
        else yaHabia.push(k);
    });

    if (!confirm('Vas a pegar los entrenamientos de la semana del ' + p.etiqueta +
        ' (' + p.entradas.length + ' actividades) aquí.' +
        (yaHabia.length ? '\n\n⚠️ Esta semana ya tiene ' + yaHabia.length +
            ' entrenamiento(s) y se SUSTITUIRÁN.' : '') +
        (partidosDestino.length ? '\n\n✅ Los ' + partidosDestino.length +
            ' partido(s) oficiales de esta semana NO se tocan.' : '') +
        '\n\nNo se guarda hasta que pulses GUARDAR.')) return;

    // 1. Las filas que trae el paquete y aquí no existen, se crean. Sin esto,
    //    las celdas de una fila libre del origen no tendrían fila donde salir.
    const existentes = {};
    st.doc.filas.forEach(f => { existentes[f.id] = true; });
    let filasNuevas = 0;
    (p.filas || []).forEach(f => {
        if (existentes[f.id]) return;
        st.doc.filas.push({ id: f.id, tipo: f.tipo, cat: f.cat, sub: f.sub, label: f.label });
        existentes[f.id] = true;
        idsVisibles[f.id] = true;
        filasNuevas++;
    });

    // 2. Se vacía SÓLO lo visible.
    yaHabia.forEach(k => { delete st.doc.celdas[k]; });

    // 3. Y se escribe el paquete, remapeando el índice de día a la fecha de
    //    ESTA semana.
    const lunes = _cqLunes(st.offset);
    let pegadas = 0, respetados = 0;
    p.entradas.forEach(en => {
        if (!idsVisibles[en.filaId]) return;   // fila fuera de su alcance: no se toca
        const fecha = _cqFechaKey(new Date(lunes.getTime() + en.dia * 86400000));
        const clave = en.filaId + '|' + fecha;
        // 🔴 Y AQUÍ LA SEGUNDA MITAD DE LA MISMA REGLA. Aunque el paquete ya
        // no trae partidos, el entrenamiento del martes de la semana origen
        // puede caer justo donde ESTA semana hay partido. El partido manda:
        // viene del calendario oficial y su día no es negociable.
        if (_cqEsPartido(st.doc.celdas[clave])) { respetados++; return; }
        const c = en.celda || {};
        st.doc.celdas[clave] = {
            tipo: c.tipo, ini: c.ini, fin: c.fin,
            esp: (c.esp || []).slice(), txt: c.txt, nota: c.nota };
        pegadas++;
    });

    st.sucio = true;
    _cqHistPush('pegar semana');
    _cqToast('🗓️ Pegados ' + pegadas + ' entrenamiento(s)' +
             (filasNuevas ? ' y ' + filasNuevas + ' fila(s) nueva(s)' : '') +
             (partidosDestino.length ? ' · ' + partidosDestino.length + ' partido(s) intactos' : '') +
             (respetados ? ' · ' + respetados + ' celda(s) no se pisaron por haber partido' : '') +
             '. Revisa y guarda.', 6000);
    _cqPintar();
};

window.cqOlvidarSemana = function () {
    try { localStorage.removeItem(CQ_SEMANA_KEY); } catch (e) { /* nada que olvidar */ }
    _cqToast('Portapapeles de semana vaciado.');
    _cqPintar();
};

function _cqBotonesFila() {
    return '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' +
        '<button class="btn" onclick="cqAnadirFilaEquipo()" style="padding:0.35rem 0.8rem;font-size:0.7rem;">➕ Añadir equipo</button>' +
        '<button class="btn" onclick="cqAnadirFilaLibre()" style="padding:0.35rem 0.8rem;font-size:0.7rem;">⭐ Añadir fila libre</button>' +
    '</div>';
}

function _cqLeyenda() {
    return '<div style="display:flex;gap:0.7rem;flex-wrap:wrap;font-size:0.66rem;color:var(--text-muted);align-items:center;">' +
        Object.keys(CQ_TIPOS).map(k => {
            const t = CQ_TIPOS[k];
            return '<span style="display:inline-flex;align-items:center;gap:0.25rem;">' +
                   '<span style="width:9px;height:9px;border-radius:2px;background:' + t.color + ';display:inline-block;"></span>' +
                   _cqE(t.label) + '</span>';
        }).join('') + '</div>';
}

// ── VISTA 2: ocupación del campo (4 espacios × franjas de 15 min) ────
function _cqHtmlEspacios(lunes) {
    const st = window._cqState, d = st.doc;
    const filas = _cqFilasVisibles(d.filas);
    const porId = {}; filas.forEach(f => { porId[f.id] = f; });

    const fecha = _cqFechaKey(new Date(lunes.getTime() + st.dia * 86400000));
    const nEsp  = d.espacios || CQ_ESPACIOS;
    // 🕐 v604 · La franja depende del DÍA visible: fin de semana desde las 9:00.
    const horaIni = _cqHoraIni(st.dia);
    const ini   = _cqMin(horaIni), fin = _cqMin(CQ_HORA_FIN);

    // Selector de día.
    let html = '<div style="display:flex;gap:0.3rem;flex-wrap:wrap;margin-bottom:0.8rem;">';
    for (let i = 0; i < 7; i++) {
        const act = (i === st.dia);
        html += '<button onclick="cqDia(' + i + ')" style="padding:0.35rem 0.7rem;border-radius:8px;cursor:pointer;' +
            'font-size:0.7rem;font-weight:700;border:1px solid ' +
            (act ? 'rgba(88,166,255,0.5);background:rgba(88,166,255,0.15);color:#58a6ff;'
                 : 'rgba(255,255,255,0.1);background:transparent;color:#8b949e;') + '">' + CQ_DIAS_CORTO[i] +
            // El fin de semana arranca a las 9:00 y eso hay que verlo ANTES de
            // pulsar: si no, parece que el sábado la parrilla "se ha movido".
            (i >= 5 ? '<span style="font-size:0.58rem;opacity:0.75;display:block;font-weight:400;">desde 9:00</span>' : '') +
            '</button>';
    }
    html += '</div>';

    html += '<div style="font-size:0.66rem;color:var(--text-muted);margin-bottom:0.7rem;">' +
            '🕐 Franja de ' + _cqE(horaIni) + ' a ' + _cqE(CQ_HORA_FIN) +
            (st.dia >= 5 ? ' · el fin de semana empieza por la mañana para que quepan los partidos' : '') +
            '</div>';

    // Asignaciones del día, repartidas en CUATRO grupos. Cada uno se enseña de
    // una forma distinta porque significan cosas distintas, y meterlos en el
    // mismo saco es lo que producía los rojos falsos de la v604.
    //   · dentro    → ocupan la parrilla (y pueden chocar entre ellos)
    //   · visitante → juegan FUERA: no pisan el campo, jamás chocan
    //   · sinEspacio→ ocupan tiempo pero nadie les asignó espacio
    //   · fuera     → caen fuera de la franja horaria del día
    const dentro = [], visitante = [], sinEspacio = [], fuera = [];
    filas.forEach(f => {
        const c = d.celdas[f.id + '|' + fecha];
        if (!c) return;
        const a = _cqMin(c.ini), b = _cqMin(c.fin);
        const item = { fila: f, c, a, b };
        const meta = CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno;

        // 🏟️ v605 · El que juega fuera sale del reparto ANTES que nada, sin
        // mirar horas ni espacios: no está en el campo del club.
        if (meta.ocupa === false) { visitante.push(item); return; }

        if (a == null || b == null || b <= a || b <= ini || a >= fin) { fuera.push(item); return; }
        // 🏟️ v607 · Los espacios EFECTIVOS: un partido en casa sin marcar ocupa
        // el campo entero. Se guardan en el ítem para no recalcularlos tres
        // veces (mapa de ocupación, rótulo de la celda y lista de abajo).
        item.esp = _cqEspaciosDe(c, nEsp);
        if (!item.esp.length) { sinEspacio.push(item); return; }
        dentro.push(item);
    });

    // Mapa franja→espacio→[ítems], para pintar y para detectar colisiones.
    const ocup = {};
    dentro.forEach(it => {
        it.esp.forEach(e => {
            for (let t = Math.max(it.a, ini); t < Math.min(it.b, fin); t += CQ_PASO_MIN) {
                const k = t + '|' + e;
                (ocup[k] = ocup[k] || []).push(it);
            }
        });
    });

    // ════════════════════════════════════════════════════════════════
    //  🔴 v606 · LA CELDA ROJA DICE QUÉ EQUIPOS CHOCAN
    //
    //  Reporte del autor (captura 9419): la franja se ponía roja pero no se
    //  leía quiénes se solapaban, así que había que ir a buscarlo a mano.
    //
    //  🔑 Y LOS NOMBRES YA SE CALCULABAN. El defecto no era el dato, era la
    //  CELDA: cada franja de 15 minutos se pintaba como un `<td>` de 15 px de
    //  alto con `overflow:hidden` y `white-space:nowrap`, y el rótulo sólo se
    //  escribía en el primero. "⚠️ Alevín A + Alevín B" cabía en esa rendija
    //  igual que un folio en un sobre de sellos: estaba, recortado a nada.
    //
    //  🔑 EL ARREGLO ES FUSIONAR LAS FRANJAS CONTIGUAS EN UNA SOLA CELDA con
    //  `rowspan`. Un bloque de una hora pasa a ser UN `<td>` de cuatro filas de
    //  alto —unos 64 px— donde los dos nombres caben en líneas separadas. De
    //  paso desaparece la rareza de que el rótulo sólo saliera arriba del todo.
    //
    //  Se agrupan las franjas consecutivas con LOS MISMOS OCUPANTES (la
    //  "firma"). Si a mitad de un entrenamiento entra un segundo equipo, la
    //  firma cambia y el bloque se parte: el rojo empieza exactamente donde
    //  empieza el conflicto, no donde empezó la sesión.
    // ════════════════════════════════════════════════════════════════
    const inicioEn = {};   // espacio → { minuto: bloque }
    const cubierto = {};   // espacio → { minuto: true }  (lo tapa un rowspan)
    const conflictos = [];
    for (let e = 1; e <= nEsp; e++) {
        inicioEn[e] = {}; cubierto[e] = {};
        let actual = null;
        for (let t = ini; t < fin; t += CQ_PASO_MIN) {
            const lista = ocup[t + '|' + e] || [];
            const firma = lista.map(x => x.fila.id).sort().join('+');
            if (!firma) { actual = null; continue; }
            if (actual && actual.firma === firma) { actual.filas++; actual.tFin = t + CQ_PASO_MIN; cubierto[e][t] = true; continue; }
            actual = { tIni: t, tFin: t + CQ_PASO_MIN, filas: 1, items: lista.slice(), firma, espacio: e };
            inicioEn[e][t] = actual;
            if (lista.length > 1) conflictos.push(actual);
        }
    }

    if (conflictos.length) {
        html += '<div style="font-size:0.72rem;color:#ff5858;background:rgba(255,88,88,0.08);border:1px solid rgba(255,88,88,0.3);' +
                'border-radius:8px;padding:0.5rem 0.75rem;margin-bottom:0.7rem;line-height:1.6;">' +
                '⚠️ Hay <strong>' + conflictos.length + '</strong> conflicto(s) con <strong>dos o más equipos en el mismo espacio</strong>. ' +
                'Se marcan en rojo: no se bloquea el guardado, pero revísalo antes de enviarlo.' +
                // La lista explícita: quién, dónde y cuándo. Es lo que se
                // necesita para resolverlo sin ir casilla por casilla.
                conflictos.map(b =>
                    '<div style="margin-top:0.3rem;color:#ffdcdc;">' +
                        '🏟️ <strong>Espacio ' + b.espacio + '</strong> · ' +
                        _cqE(_cqHHMM(b.tIni) + '–' + _cqHHMM(b.tFin)) + ' · ' +
                        '<strong>' + b.items.map(x => _cqE(x.fila.label)).join('</strong> y <strong>') + '</strong>' +
                    '</div>').join('') +
                '</div>';
    }

    const th = 'padding:0.4rem;text-align:center;color:#58a6ff;font-size:0.66rem;border-bottom:2px solid rgba(88,166,255,0.25);';
    html += '<div style="overflow-x:auto;border:1px solid rgba(88,166,255,0.15);border-radius:12px;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.68rem;table-layout:fixed;">' +
        '<colgroup><col style="width:52px;">' +
            new Array(nEsp).fill('<col>').join('') + '</colgroup>' +
        '<thead><tr style="background:rgba(88,166,255,0.08);"><th style="' + th + '">HORA</th>';
    for (let e = 1; e <= nEsp; e++) html += '<th style="' + th + '">🏟️ ESPACIO ' + e + '</th>';
    html += '</tr></thead><tbody>';

    for (let t = ini; t < fin; t += CQ_PASO_MIN) {
        const enPunto = (t % 60 === 0) || (t % 60 === 30);
        html += '<tr>' +
            '<td style="padding:0.15rem 0.3rem;text-align:right;color:' + (enPunto ? 'white' : 'rgba(255,255,255,0.28)') + ';' +
                'font-weight:' + (enPunto ? '700' : '400') + ';font-size:0.62rem;white-space:nowrap;' +
                'border-top:1px solid rgba(255,255,255,' + (enPunto ? '0.10' : '0.03') + ');">' +
                (enPunto ? _cqHHMM(t) : '') + '</td>';
        for (let e = 1; e <= nEsp; e++) {
            if (cubierto[e][t]) continue;              // lo tapa el rowspan de arriba
            const b = inicioEn[e][t];
            if (!b) {
                html += '<td style="height:16px;border-left:1px solid rgba(255,255,255,0.05);' +
                        'border-top:1px solid rgba(255,255,255,' + (enPunto ? '0.10' : '0.03') + ');"></td>';
                continue;
            }
            const choque = b.items.length > 1;
            const it     = b.items[0];
            const meta   = CQ_TIPOS[it.c.tipo] || CQ_TIPOS.entreno;
            const rgb    = (typeof window._cronosHexRgb === 'function') ? window._cronosHexRgb(meta.color) : '139,148,158';
            const rango  = _cqHHMM(b.tIni) + '–' + _cqHHMM(b.tFin);

            // 🔴 En un conflicto manda el CONFLICTO: los nombres de los equipos
            // que se solapan, uno por línea, y no el detalle de uno solo.
            const dentro = choque
                ? '<div style="font-weight:900;letter-spacing:0.3px;">⚠️ CONFLICTO</div>' +
                  b.items.map(x => '<div style="font-weight:800;overflow-wrap:break-word;word-break:normal;">' +
                      _cqE(x.fila.label) + '</div>').join('')
                : '<div style="font-weight:700;overflow-wrap:break-word;word-break:normal;">' +
                      _cqE(it.fila.label) + '</div>' +
                  (it.c.txt && b.filas >= 3
                      ? '<div style="font-weight:400;opacity:0.8;overflow-wrap:break-word;">' + _cqE(it.c.txt) + '</div>'
                      : '');

            const titulo = choque
                ? ('⚠️ Conflicto en el espacio ' + e + ' (' + rango + '): ' +
                   b.items.map(x => x.fila.label).join(' y '))
                : (it.fila.label + (it.c.txt ? ' · ' + it.c.txt : '') + ' · ' + rango);

            html += '<td rowspan="' + b.filas + '" title="' + _cqA(titulo) + '" ' +
                'style="border-left:1px solid rgba(255,255,255,0.05);padding:2px 4px;vertical-align:top;' +
                       'border-top:1px solid rgba(255,255,255,0.10);' +
                       'background:' + (choque ? 'rgba(255,88,88,0.30)' : 'rgba(' + rgb + ',0.22)') + ';' +
                       (choque ? 'outline:1px solid rgba(255,88,88,0.65);outline-offset:-1px;' : '') +
                       'color:' + (choque ? '#ffdcdc' : meta.color) + ';font-size:0.58rem;line-height:1.25;' +
                       'text-align:center;">' +
                dentro + '</td>';
        }
        html += '</tr>';
    }
    html += '</tbody></table></div>';

    // ⚠️ LO QUE NO SALE EN LA PARRILLA SE DICE, NO SE ESCONDE. Un día con
    // actividad que aquí no aparece haría creer que el campo está libre — y
    // ésta es justo la pantalla que se mira para decidir si lo está.
    const bloque = (titulo, color, lista, detalle) => {
        if (!lista.length) return '';
        const rgb = (typeof window._cronosHexRgb === 'function') ? window._cronosHexRgb(color) : '240,136,62';
        return '<div style="margin-top:0.7rem;border:1px solid rgba(' + rgb + ',0.28);border-radius:10px;' +
                    'padding:0.6rem 0.8rem;background:rgba(' + rgb + ',0.05);">' +
            '<div style="font-size:0.7rem;font-weight:700;color:' + color + ';margin-bottom:0.4rem;">' + titulo + '</div>' +
            lista.map(it => {
                const meta = CQ_TIPOS[it.c.tipo] || CQ_TIPOS.entreno;
                return '<div style="font-size:0.7rem;color:var(--text-muted);padding:0.15rem 0;">' +
                    '<span style="color:' + meta.color + ';font-weight:700;">' + meta.icono + ' ' + _cqE(it.fila.label) + '</span> · ' +
                    _cqE(it.c.txt || meta.label) +
                    (it.c.ini ? ' · ' + _cqE(it.c.ini + (it.c.fin ? ' a ' + it.c.fin : '')) : ' · <em>sin hora</em>') +
                    (detalle ? detalle(it) : '') +
                    '</div>';
            }).join('') + '</div>';
    };

    // 🚌 v605 · Los que juegan fuera: se ven, con su hora, y se dice EN VOZ
    // ALTA que no ocupan el campo. Antes generaban colisiones falsas; borrarlos
    // de la vista habría sido el error contrario —el director tiene que saber
    // que ese equipo tiene partido— así que se separan.
    html += bloque('🚌 Juegan FUERA de casa · no ocupan ningún espacio del campo', '#f0883e', visitante);

    // ⚠️ Ocupan tiempo pero nadie les dio espacio: no es un error del sistema,
    // es un hueco del cuadrante, y quien lo rellena tiene que verlo.
    // 🏟️ v607 · Aquí YA NO caen los partidos en casa: ocupan el campo completo
    // por defecto y se pintan arriba, que es lo que reportó el autor.
    html += bloque('⚠️ Sin espacio asignado · no se reflejan en la parrilla · pulsa la casilla para asignarlo',
                   '#d4b106', sinEspacio);

    html += bloque('🕐 Fuera de la franja ' + horaIni + '–' + CQ_HORA_FIN, '#8b949e', fuera);

    html += '<div style="margin-top:0.7rem;">' + _cqLeyenda() + '</div>';
    return html;
}

// ════════════════════════════════════════════════════════════════════
//  ACCIONES
// ════════════════════════════════════════════════════════════════════
window.cqSemana = function (delta) {
    const st = window._cqState;
    if (st.sucio && !confirm('Hay cambios sin guardar en esta semana. ¿Cambiar de semana y perderlos?')) return;
    st.offset = (delta === 0) ? 0 : (st.offset + delta);
    st.doc = null; st.sucio = false;
    _sdLoadCuadrante();
};

// ════════════════════════════════════════════════════════════════════
//  📌 v609 · FIJAR LOS PARTIDOS OFICIALES DE ESTA SEMANA
//
//  Convierte las propuestas del calendario en casillas de verdad. A partir de
//  aquí son del cuadrante: se les puede cambiar la hora, marcarles espacios,
//  cuentan como ocupación del campo y salen en el informe del Ayuntamiento.
//
//  🔑 NO ESCRIBE SOBRE NINGUNA CASILLA EXISTENTE. `_cqPropuesta` ya devuelve
//  null donde hay algo escrito, así que fijar NUNCA puede pisar el trabajo del
//  director — ni siquiera pulsando el botón dos veces.
//
//  ⚠️ Y NO GUARDA SOLO: deja la semana marcada como «sin guardar» para que
//  pase por el mismo GUARDAR que todo lo demás. Escribir en Firestore por
//  detrás desde un botón que dice «fijar» sería hacer más de lo que promete.
// ════════════════════════════════════════════════════════════════════
window.cqFijarPartidos = function () {
    const st = window._cqState;
    if (!st.doc || !st.calendario) return;
    const lunes = _cqLunes(st.offset);
    let n = 0;
    _cqFilasVisibles(st.doc.filas).forEach(fila => {
        for (let i = 0; i < 7; i++) {
            const f = new Date(lunes); f.setDate(lunes.getDate() + i);
            const fecha = _cqFechaKey(f);
            const p = _cqPropuesta(fila.id, fecha);
            if (!p) continue;
            st.doc.celdas[fila.id + '|' + fecha] = _cqCeldaDePropuesta(p);
            n++;
        }
    });
    if (!n) { _cqToast('No hay partidos del calendario pendientes esta semana.'); return; }
    st.sucio = true;
    _cqHistPush('fijar ' + n + ' partido(s)');
    _cqPintar();
    _cqToast('📌 ' + n + ' partido' + (n === 1 ? '' : 's') + ' fijado' + (n === 1 ? '' : 's') +
             '. Ajusta las horas si hace falta y pulsa GUARDAR.', 5000);
};

window.cqVista = function (v) { window._cqState.vista = v; _cqPintar(); };
window.cqDia   = function (i) { window._cqState.dia   = i; _cqPintar(); };

window.cqMoverFila = function (idx, delta) {
    const st = window._cqState;
    // ⚠️ El índice viene de la lista VISIBLE (que el coordinador tiene
    // filtrada por modalidad). Se traduce a la posición real en st.doc.filas
    // antes de mover: sin esto, un coordinador de F7 reordenaría equipos de
    // F11 que ni siquiera está viendo.
    const visibles = _cqFilasVisibles(st.doc.filas);
    const fila = visibles[idx], vecina = visibles[idx + delta];
    if (!fila || !vecina) return;
    const a = st.doc.filas.indexOf(fila), b = st.doc.filas.indexOf(vecina);
    if (a < 0 || b < 0) return;
    st.doc.filas[a] = vecina; st.doc.filas[b] = fila;
    st.sucio = true; _cqHistPush('mover ' + fila.label); _cqPintar();
};

window.cqQuitarFila = function (filaId) {
    const st = window._cqState;
    const fila = st.doc.filas.find(f => f.id === filaId);
    if (!fila) return;
    const conDatos = Object.keys(st.doc.celdas).some(k => k.indexOf(filaId + '|') === 0);
    if (!confirm('¿Quitar la fila «' + fila.label + '» del cuadrante de esta semana?' +
                 (conDatos ? '\n\n⚠️ Tiene actividades asignadas y también se borrarán.' : ''))) return;
    st.doc.filas = st.doc.filas.filter(f => f.id !== filaId);
    Object.keys(st.doc.celdas).forEach(k => { if (k.indexOf(filaId + '|') === 0) delete st.doc.celdas[k]; });
    st.sucio = true; _cqHistPush('quitar ' + fila.label); _cqPintar();
};

window.cqAnadirFilaLibre = function () {
    const nombre = prompt('Nombre de la fila (por ejemplo: Entrenamiento de porteros, Academia, Fisio):');
    if (!nombre || !nombre.trim()) return;
    const st = window._cqState;
    const id = 'libre_' + Date.now().toString(36);
    st.doc.filas.push({ id, tipo: 'libre', cat: '', sub: '', label: nombre.trim() });
    st.sucio = true; _cqHistPush('anadir fila ' + nombre.trim()); _cqPintar();
};

window.cqAnadirFilaEquipo = function () {
    const st = window._cqState;
    const me = window._cronosCurrentUser || {};
    const clubId = window._testRoleClubId || me.clubId || '';
    const cats = (window.CT_CATEGORIES || []).filter(c =>
        typeof window._cronosVeCategoria !== 'function' || window._cronosVeCategoria(me, c.id));
    const subs = window.CT_SUBCATS || ['A','B','C'];
    if (!cats.length) { _cqToast('⚠️ No hay categorías disponibles.'); return; }

    _cqOverlay('➕ Añadir equipo al cuadrante',
        '<div style="display:grid;gap:0.7rem;">' +
            '<div><label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.25rem;">Categoría</label>' +
            '<select id="cq-nf-cat" style="width:100%;padding:0.5rem;border-radius:8px;background:var(--glass);color:white;border:1px solid var(--glass-border);font-size:0.82rem;">' +
                cats.map(c => '<option value="' + _cqA(c.id) + '" style="background:#161b22;">' + _cqE(c.label) + '</option>').join('') +
            '</select></div>' +
            '<div><label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.25rem;">Subcategoría</label>' +
            '<select id="cq-nf-sub" style="width:100%;padding:0.5rem;border-radius:8px;background:var(--glass);color:white;border:1px solid var(--glass-border);font-size:0.82rem;">' +
                subs.map(s => '<option value="' + _cqA(s) + '" style="background:#161b22;">' + _cqE(s) + '</option>').join('') +
            '</select></div>' +
        '</div>',
        '<button class="btn" onclick="cqCerrarOverlay()" style="padding:0.45rem 1rem;font-size:0.75rem;">Cancelar</button>' +
        '<button class="btn" onclick="cqConfirmarFilaEquipo(\'' + _cqA(clubId) + '\')" style="padding:0.45rem 1.1rem;font-size:0.75rem;font-weight:700;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);color:#3fb950;">Añadir</button>');
};

window.cqConfirmarFilaEquipo = function (clubId) {
    const cat = (document.getElementById('cq-nf-cat') || {}).value || '';
    const sub = (document.getElementById('cq-nf-sub') || {}).value || '';
    if (!cat || !sub) return;
    const st = window._cqState;
    const id = _cqIdFilaEquipo(clubId, cat, sub);
    if (st.doc.filas.some(f => f.id === id)) { _cqToast('⚠️ Ese equipo ya está en el cuadrante.'); return; }
    st.doc.filas.push({ id, tipo: 'equipo', cat, sub, label: _cqLabelEquipo(cat, sub) });
    st.sucio = true; _cqHistPush('anadir ' + _cqLabelEquipo(cat, sub)); cqCerrarOverlay(); _cqPintar();
};

// ── Editor de una celda ──────────────────────────────────────────────
window.cqEditarCelda = function (filaId, fecha) {
    const st = window._cqState;
    const fila = st.doc.filas.find(f => f.id === filaId);
    if (!fila) return;
    // 📅 v609 · Si la casilla está vacía pero el calendario oficial dice que
    // ahí hay partido, el editor se abre YA RELLENO con él. Obligar a
    // reescribir a mano un dato que la app acaba de leer del PDF sería tener
    // el calendario y no usarlo.
    const prop = _cqPropuesta(filaId, fecha);
    const c = st.doc.celdas[filaId + '|' + fecha]
           || (prop ? _cqCeldaDePropuesta(prop) : null)
           || { tipo: 'entreno', ini: '', fin: '', esp: [], txt: '', nota: '' };
    const nEsp = st.doc.espacios || CQ_ESPACIOS;
    const dia  = new Date(fecha + 'T12:00:00');

    const opTipos = Object.keys(CQ_TIPOS).map(k =>
        '<option value="' + k + '"' + (c.tipo === k ? ' selected' : '') + ' style="background:#161b22;">' +
        CQ_TIPOS[k].icono + ' ' + _cqE(CQ_TIPOS[k].label) + '</option>').join('');

    const casillas = [];
    for (let e = 1; e <= nEsp; e++) {
        const marcado = Array.isArray(c.esp) && c.esp.indexOf(e) >= 0;
        casillas.push('<label style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.78rem;color:white;cursor:pointer;' +
            'padding:0.35rem 0.6rem;border-radius:8px;border:1px solid ' +
            (marcado ? 'rgba(88,166,255,0.5);background:rgba(88,166,255,0.12);' : 'rgba(255,255,255,0.1);') + '">' +
            // 🏟️ v607 · También al marcar/desmarcar: el aviso de "campo
            // completo" tiene que desaparecer en cuanto se elige un espacio,
            // o seguiría prometiendo algo que ya no va a pasar.
            '<input type="checkbox" class="cq-esp" onchange="cqTipoCambiado()" value="' + e + '"' + (marcado ? ' checked' : '') + '> ' + e + '</label>');
    }

    _cqOverlay(
        _cqE(fila.label) + ' · ' + _cqE(dia.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' })),
        '<div style="display:grid;gap:0.7rem;">' +
            '<div><label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.25rem;">Tipo</label>' +
                // 🏟️ v605 · Al elegir "Partido FUERA" el selector de espacios se
                // apaga en el acto. Dejarlo activo invitaría a marcar un espacio
                // que el sistema va a ignorar — y prometer algo que no se cumple
                // es peor que no ofrecerlo.
                '<select id="cq-ce-tipo" onchange="cqTipoCambiado()" style="width:100%;padding:0.5rem;border-radius:8px;background:var(--glass);color:white;border:1px solid var(--glass-border);font-size:0.82rem;">' + opTipos + '</select></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">' +
                '<div><label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.25rem;">Desde</label>' +
                    '<input type="time" id="cq-ce-ini" value="' + _cqA(c.ini) + '" style="width:100%;padding:0.5rem;border-radius:8px;background:var(--glass);color:white;border:1px solid var(--glass-border);font-size:0.82rem;box-sizing:border-box;"></div>' +
                '<div><label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.25rem;">Hasta</label>' +
                    '<input type="time" id="cq-ce-fin" value="' + _cqA(c.fin) + '" style="width:100%;padding:0.5rem;border-radius:8px;background:var(--glass);color:white;border:1px solid var(--glass-border);font-size:0.82rem;box-sizing:border-box;"></div>' +
            '</div>' +
            '<div id="cq-ce-espbloque"><label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.35rem;">🏟️ Espacios del campo que ocupa</label>' +
                '<div style="display:flex;gap:0.4rem;flex-wrap:wrap;">' + casillas.join('') + '</div>' +
                '<div id="cq-ce-espnota" style="font-size:0.66rem;color:var(--text-muted);margin-top:0.3rem;">Puede ocupar 1, 2 o los ' + nEsp + '.</div></div>' +
            '<div><label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.25rem;">Rótulo (lo que se lee en la casilla)</label>' +
                '<input type="text" id="cq-ce-txt" value="' + _cqA(c.txt) + '" placeholder="ENTRENO · rival · torneo…" style="width:100%;padding:0.5rem;border-radius:8px;background:var(--glass);color:white;border:1px solid var(--glass-border);font-size:0.82rem;box-sizing:border-box;"></div>' +
            '<div><label style="font-size:0.72rem;color:var(--text-muted);display:block;margin-bottom:0.25rem;">Nota (campo, equipación, observaciones)</label>' +
                '<input type="text" id="cq-ce-nota" value="' + _cqA(c.nota) + '" placeholder="Opcional" style="width:100%;padding:0.5rem;border-radius:8px;background:var(--glass);color:white;border:1px solid var(--glass-border);font-size:0.82rem;box-sizing:border-box;"></div>' +
        '</div>',
        // 📋 Copiar sólo tiene sentido si la casilla YA tiene algo: ofrecerlo
        // sobre una casilla vacía copiaría la nada y dejaría el modo pegar
        // activo sin contenido.
        (st.doc.celdas[filaId + '|' + fecha]
            ? '<button class="btn" onclick="cqCopiarCelda(\'' + _cqA(filaId) + '\',\'' + _cqA(fecha) + '\')" style="padding:0.45rem 0.9rem;font-size:0.75rem;background:rgba(210,168,255,0.10);border:1px solid rgba(210,168,255,0.35);color:#d2a8ff;">📋 Copiar</button>'
            : '') +
        '<button class="btn" onclick="cqBorrarCelda(\'' + _cqA(filaId) + '\',\'' + _cqA(fecha) + '\')" style="padding:0.45rem 0.9rem;font-size:0.75rem;background:rgba(255,88,88,0.08);border:1px solid rgba(255,88,88,0.25);color:#ff5858;">🗑️ Vaciar</button>' +
        '<button class="btn" onclick="cqCerrarOverlay()" style="padding:0.45rem 1rem;font-size:0.75rem;">Cancelar</button>' +
        '<button class="btn" onclick="cqAplicarCelda(\'' + _cqA(filaId) + '\',\'' + _cqA(fecha) + '\')" style="padding:0.45rem 1.1rem;font-size:0.75rem;font-weight:700;background:rgba(63,185,80,0.15);border:1px solid rgba(63,185,80,0.4);color:#3fb950;">Aplicar</button>');

    // ⚠️ Se aplica el estado NADA MÁS ABRIR, no sólo al cambiar el desplegable:
    // una celda guardada como "partido fuera" tiene que enseñar los espacios ya
    // apagados, sin que haya que tocar el selector para que se entere.
    cqTipoCambiado();
};

// 🏟️ v605 · Apaga o enciende el selector de espacios según el tipo elegido.
// Se llama desde el onchange del <select> del editor.
window.cqTipoCambiado = function () {
    const sel = document.getElementById('cq-ce-tipo');
    const bloque = document.getElementById('cq-ce-espbloque');
    const nota = document.getElementById('cq-ce-espnota');
    if (!sel || !bloque) return;
    const meta = CQ_TIPOS[sel.value] || CQ_TIPOS.entreno;
    const juegaFuera = (meta.ocupa === false);
    const nEsp = (window._cqState.doc && window._cqState.doc.espacios) || CQ_ESPACIOS;

    bloque.style.opacity = juegaFuera ? '0.4' : '1';
    // ⚠️ `disabled` de verdad, no sólo opacidad: la lección de v548 es que
    // apagar algo únicamente con CSS deja la acción viva para quien pulse igual.
    let alguno = false;
    document.querySelectorAll('.cq-esp').forEach(x => {
        x.disabled = juegaFuera;
        if (juegaFuera) x.checked = false;
        else if (x.checked) alguno = true;
    });
    if (nota) {
        // 🏟️ v607 · Un partido en casa que no marque espacios ocupa el CAMPO
        // COMPLETO. Se dice AQUÍ, antes de guardar: si el sistema va a asumir
        // algo, el director tiene que enterarse mientras puede cambiarlo — y no
        // descubrirlo al ver la parrilla llena de rojo.
        nota.innerHTML = juegaFuera
            ? '🚌 <strong style="color:#f0883e;">Se juega fuera: no ocupa ningún espacio del club</strong>, así que no puede chocar con nadie.'
            : (meta.campoCompleto && !alguno)
                ? '🏠 <strong style="color:#3fb950;">Sin marcar nada, un partido en casa ocupa el CAMPO COMPLETO</strong> ' +
                  'y así consta en el informe del Ayuntamiento. Marca espacios sólo si se juega en una parte (por ejemplo, dos partidos de F7 a la vez).'
                : 'Puede ocupar 1, 2 o los ' + nEsp + '.';
    }
};

window.cqAplicarCelda = function (filaId, fecha) {
    const st = window._cqState;
    const g  = id => (document.getElementById(id) || {}).value || '';
    const tipo = g('cq-ce-tipo') || 'entreno';
    const metaT = CQ_TIPOS[tipo] || CQ_TIPOS.entreno;
    // 🏟️ v605 · Un partido fuera se guarda SIN espacios, pase lo que pase en la
    // pantalla. Es la regla escrita en el propio dato: así el cuadrante que
    // queda en la base ya es coherente y no depende de que quien lo lea vuelva
    // a aplicar el filtro.
    const esp = (metaT.ocupa === false) ? [] :
        Array.prototype.slice.call(document.querySelectorAll('.cq-esp'))
            .filter(x => x.checked).map(x => parseInt(x.value, 10));
    const ini = g('cq-ce-ini'), fin = g('cq-ce-fin');

    if (ini && fin && _cqMin(fin) !== null && _cqMin(ini) !== null && _cqMin(fin) <= _cqMin(ini)) {
        _cqToast('⚠️ La hora de fin tiene que ser posterior a la de inicio.', 4000);
        return;
    }
    st.doc.celdas[filaId + '|' + fecha] = {
        tipo, ini, fin, esp,
        txt:  g('cq-ce-txt').trim(),
        nota: g('cq-ce-nota').trim(),
    };
    st.sucio = true; _cqHistPush('editar casilla'); cqCerrarOverlay(); _cqPintar();
};

window.cqBorrarCelda = function (filaId, fecha) {
    delete window._cqState.doc.celdas[filaId + '|' + fecha];
    window._cqState.sucio = true; _cqHistPush('vaciar casilla'); cqCerrarOverlay(); _cqPintar();
};

window.cqGuardar = async function () {
    const st = window._cqState;
    const me = window._cronosCurrentUser || {};
    const clubId = window._testRoleClubId || me.clubId || '';
    if (!clubId || !st.doc) return;
    if (typeof showSpinner === 'function') showSpinner('Guardando el cuadrante…');
    try {
        await _cqGuardar(clubId, st.doc);
        // 🔴 v612 · Y la composición de equipos, en el documento del CLUB.
        //  Va DESPUÉS del cuadrante y en su propio try: si esto fallara, la
        //  semana ya está a salvo y lo único que se pierde es que un equipo
        //  nuevo tarde en propagarse — no el trabajo de cuadrar la semana.
        try { await _cqGuardarFilasClub(clubId, st.doc.filas); }
        catch (e) {
            console.warn('[Cuadrante] no se pudo guardar la lista de equipos del club:', e && e.message ? e.message : e);
            _cqToast('⚠️ La semana se guardó, pero la lista de equipos no. Vuelve a guardar.', 5000);
        }
        st.sucio = false;
        _cqHistGuardado();
        if (typeof hideSpinner === 'function') hideSpinner();
        _cqToast('✅ Cuadrante guardado.');
        _cqPintar();
    } catch (e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        _cqToast('⚠️ No se pudo guardar: ' + (e && e.message ? e.message : e), 5000);
    }
};

// ── Overlay genérico (editor de celda, alta de fila, envío) ──────────
function _cqOverlay(titulo, cuerpo, botones) {
    cqCerrarOverlay();
    const ov = document.createElement('div');
    ov.id = 'cq-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147482000;background:rgba(0,0,0,0.72);' +
        'display:flex;align-items:center;justify-content:center;padding:1rem;';
    ov.innerHTML =
        '<div style="width:min(94vw,520px);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;' +
             'background:#161b22;border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.6);">' +
            '<div style="padding:0.9rem 1.1rem;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;gap:0.6rem;">' +
                '<div style="font-size:0.9rem;font-weight:800;color:white;text-transform:capitalize;">' + titulo + '</div>' +
                '<button onclick="cqCerrarOverlay()" style="background:none;border:none;color:#8b949e;font-size:1.2rem;cursor:pointer;line-height:1;">✕</button>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto;padding:1rem 1.1rem;">' + cuerpo + '</div>' +
            '<div style="padding:0.8rem 1.1rem;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:0.5rem;justify-content:flex-end;flex-wrap:wrap;">' + botones + '</div>' +
        '</div>';
    ov.addEventListener('click', ev => { if (ev.target === ov) cqCerrarOverlay(); });
    document.body.appendChild(ov);
}
window.cqCerrarOverlay = function () {
    const ov = document.getElementById('cq-overlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
};

// ════════════════════════════════════════════════════════════════════
//  🖨️ v605 · EXPORTAR EL CUADRANTE (PDF / IMPRIMIBLE)
//
//  Petición del autor: "para descargar la planificación semanal y enviársela
//  oficialmente al encargado de deportes del Ayuntamiento y JUSTIFICAR LA
//  OCUPACIÓN DEL CAMPO".
//
//  🔑 ESE DESTINATARIO CAMBIA EL DOCUMENTO. No es el cuadrante de pantalla
//  volcado a papel: al Ayuntamiento no le interesa qué equipo entrena, le
//  interesa CUÁNDO Y CUÁNTO se ocupan sus instalaciones. Por eso el documento
//  lleva DOS bloques, y el segundo es el que justifica:
//    1. La matriz semanal — lo que el club usa internamente.
//    2. La ocupación día a día, con la franja ocupada y los espacios, más el
//       TOTAL DE HORAS de la semana. Eso es lo que se firma.
//
//  🚌 Y LOS PARTIDOS FUERA NO CUENTAN COMO OCUPACIÓN, igual que en pantalla
//  (ver _cqOcupaCampo). Salen listados aparte y con su nota: si un equipo
//  desapareciera del papel sin explicación, el técnico municipal preguntaría
//  por qué el Alevín A no juega ese fin de semana.
//
//  ── SIN DEPENDENCIAS NUEVAS ─────────────────────────────────────────
//  Se reutiliza `window.rxImprimir` (js/coach/reports/reports-export.js), que
//  ya monta la ventana, la hoja blanca y el `window.print()`. Trae resuelto lo
//  que costó descubrir en v472:
//   🔑 `print-color-adjust: exact` — sin esa regla el navegador descarta los
//      fondos "para ahorrar tinta" y el PDF sale CON LAS CELDAS EN BLANCO, sin
//      un solo error. Aquí importa el doble: el color ES el dato (verde casa /
//      naranja fuera).
//   ⚠️ NO se usa `<a download>` con blob: en iOS eso NAVEGA en vez de
//      descargar y se pierde la sesión (v526→v530). La ventana de impresión
//      ofrece "Guardar como PDF" en todos los sistemas.
//
//  ⚠️ LOS COLORES SE REDEFINEN PARA PAPEL. Los de pantalla están pensados para
//  fondo #0d1117 (rgba translúcidos sobre oscuro): sobre blanco quedan
//  ilegibles. Es la misma lección que reports-export.js escribió para el motor
//  de informes.
// ════════════════════════════════════════════════════════════════════
const CQ_PAPEL = {
    entreno:       { bg: '#eef2f7', fg: '#334155', bd: '#cbd5e1' },
    partido_casa:  { bg: '#dcfce7', fg: '#14532d', bd: '#86efac' },
    partido_fuera: { bg: '#ffedd5', fg: '#7c2d12', bd: '#fdba74' },
    otro:          { bg: '#fef9c3', fg: '#713f12', bd: '#fde047' },
};

// Minutos de ocupación de una celda (0 si no ocupa o no tiene horas buenas).
function _cqMinutosOcupados(c, nEsp) {
    // 🏟️ v607 · Por los espacios EFECTIVOS. Antes usaba `c.esp` a pelo y un
    // partido en casa sin marcar sumaba CERO: el informe municipal se dejaba
    // fuera justo los partidos oficiales del fin de semana.
    const esp = _cqEspaciosDe(c, nEsp);
    if (!esp.length) return 0;
    const a = _cqMin(c.ini), b = _cqMin(c.fin);
    if (a == null || b == null || b <= a) return 0;
    return (b - a) * esp.length;     // por ESPACIO: dos espacios una hora son dos horas de campo
}

window.cqExportar = function () {
    const st = window._cqState;
    const me = window._cronosCurrentUser || {};
    if (!st.doc) return;

    if (typeof window.rxImprimir !== 'function') {
        _cqToast('⚠️ El módulo de descarga no está disponible. Recarga la página.', 5000);
        return;
    }
    if (st.sucio) {
        _cqToast('⚠️ Guarda los cambios antes de exportar: se imprimirá lo que ves.', 4000);
    }

    const lunes  = _cqLunes(st.offset);
    const fechas = [];
    for (let i = 0; i < 7; i++) fechas.push(_cqFechaKey(new Date(lunes.getTime() + i * 86400000)));
    const dom = new Date(lunes); dom.setDate(lunes.getDate() + 6);
    const fLarga = f => f.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

    // ⚠️ SE EXPORTA LO QUE ESTE USUARIO VE. Un coordinador de F7 no puede
    // firmarle al Ayuntamiento la ocupación del F11, que no gestiona él.
    const filas = _cqFilasVisibles(st.doc.filas);
    const nEsp  = st.doc.espacios || CQ_ESPACIOS;

    // ── Bloque 1: la matriz semanal ─────────────────────────────────
    const thDia = 'background:#2563eb;color:#fff;padding:5px 4px;text-align:center;font-size:9px;' +
                  'font-weight:700;text-transform:uppercase;letter-spacing:0.3px;';
    let matriz = '<table style="width:100%;border-collapse:collapse;table-layout:fixed;">' +
        '<thead><tr><th style="' + thDia + 'width:13%;text-align:left;">Equipo</th>';
    for (let i = 0; i < 7; i++) {
        const f = new Date(lunes); f.setDate(lunes.getDate() + i);
        matriz += '<th style="' + thDia + '">' + CQ_DIAS[i] +
                  '<div style="font-weight:400;font-size:8px;opacity:0.85;">' +
                  String(f.getDate()).padStart(2, '0') + '/' + String(f.getMonth() + 1).padStart(2, '0') + '</div></th>';
    }
    matriz += '</tr></thead><tbody>';

    filas.forEach(fila => {
        matriz += '<tr>' +
            '<td style="padding:4px 6px;border:1px solid #e5e7eb;font-size:9px;font-weight:800;color:#111827;' +
                'background:#f8fafc;overflow-wrap:break-word;">' + _cqE(fila.label) + '</td>';
        fechas.forEach(fecha => {
            const c = st.doc.celdas[fila.id + '|' + fecha];
            if (!c) { matriz += '<td style="border:1px solid #e5e7eb;"></td>'; return; }
            const meta  = CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno;
            const papel = CQ_PAPEL[c.tipo] || CQ_PAPEL.entreno;
            const horas = (c.ini && c.fin) ? (c.ini + ' a ' + c.fin) : (c.ini || '');
            const espL  = _cqEspaciosDe(c, nEsp);
            const esp   = espL.length ? espL.join(', ') : '';
            matriz += '<td style="border:1px solid ' + papel.bd + ';background:' + papel.bg + ';color:' + papel.fg + ';' +
                    'padding:4px 3px;text-align:center;vertical-align:top;font-size:8.5px;line-height:1.4;' +
                    'overflow-wrap:break-word;word-break:normal;">' +
                '<div style="font-weight:800;">' + _cqE(c.txt || meta.corto || meta.label) + '</div>' +
                (horas ? '<div>' + _cqE(horas) + '</div>' : '') +
                (esp   ? '<div>Espacio ' + _cqE(esp) + '</div>' : '') +
                (meta.ocupa === false ? '<div style="font-style:italic;">(fuera)</div>' : '') +
                (c.nota ? '<div>' + _cqE(c.nota) + '</div>' : '') +
            '</td>';
        });
        matriz += '</tr>';
    });
    matriz += '</tbody></table>';

    // ── Bloque 2: la ocupación real, que es lo que se justifica ──────
    let totalMin = 0;
    let ocupacion = '';
    let hayVisitas = false;

    for (let i = 0; i < 7; i++) {
        const fecha = fechas[i];
        const ocupan = [], visitas = [];
        filas.forEach(f => {
            const c = st.doc.celdas[f.id + '|' + fecha];
            if (!c) return;
            const meta = CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno;
            if (meta.ocupa === false) { visitas.push({ f, c }); hayVisitas = true; return; }
            if (_cqMinutosOcupados(c, nEsp)) ocupan.push({ f, c, esp: _cqEspaciosDe(c, nEsp) });
        });
        if (!ocupan.length && !visitas.length) continue;

        ocupan.sort((x, y) => (_cqMin(x.c.ini) || 0) - (_cqMin(y.c.ini) || 0));

        const dia = new Date(fecha + 'T12:00:00');
        let minDia = 0, desde = null, hasta = null;
        ocupan.forEach(o => {
            minDia += _cqMinutosOcupados(o.c, nEsp);
            const a = _cqMin(o.c.ini), b = _cqMin(o.c.fin);
            if (a != null && (desde == null || a < desde)) desde = a;
            if (b != null && (hasta == null || b > hasta)) hasta = b;
        });
        totalMin += minDia;

        ocupacion +=
            '<div style="margin-bottom:9px;page-break-inside:avoid;">' +
            '<div style="font-size:10px;font-weight:800;color:#1d4ed8;text-transform:capitalize;' +
                 'border-bottom:1px solid #dbeafe;padding-bottom:2px;margin-bottom:3px;">' +
                _cqE(dia.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })) +
                (desde != null ? ' · <span style="color:#4b5563;font-weight:600;">instalaciones ocupadas de ' +
                    _cqHHMM(desde) + ' a ' + _cqHHMM(hasta) + '</span>' : '') +
            '</div>';

        if (ocupan.length) {
            ocupacion += '<table style="width:100%;border-collapse:collapse;font-size:9px;">' +
                '<tr><th style="' + thDia + 'width:16%;">Horario</th><th style="' + thDia + 'width:16%;">Espacios</th>' +
                '<th style="' + thDia + 'text-align:left;width:34%;">Equipo</th>' +
                '<th style="' + thDia + 'text-align:left;">Actividad</th></tr>' +
                ocupan.map(o => {
                    const meta = CQ_TIPOS[o.c.tipo] || CQ_TIPOS.entreno;
                    return '<tr>' +
                        '<td style="border:1px solid #e5e7eb;padding:3px 5px;text-align:center;">' +
                            _cqE((o.c.ini || '—') + (o.c.fin ? ' – ' + o.c.fin : '')) + '</td>' +
                        '<td style="border:1px solid #e5e7eb;padding:3px 5px;text-align:center;font-weight:700;">' +
                            _cqE(o.esp.join(', ')) + '</td>' +
                        '<td style="border:1px solid #e5e7eb;padding:3px 5px;">' + _cqE(o.f.label) + '</td>' +
                        '<td style="border:1px solid #e5e7eb;padding:3px 5px;">' +
                            _cqE(o.c.txt || meta.label) + (o.c.nota ? ' · ' + _cqE(o.c.nota) : '') + '</td>' +
                    '</tr>';
                }).join('') + '</table>';
        } else {
            ocupacion += '<div style="font-size:9px;color:#6b7280;font-style:italic;padding:2px 0;">' +
                'Sin ocupación de instalaciones este día.</div>';
        }

        if (visitas.length) {
            ocupacion += '<div style="font-size:8.5px;color:#7c2d12;background:#fff7ed;border:1px solid #fdba74;' +
                    'border-radius:4px;padding:3px 6px;margin-top:3px;">🚌 Desplazamientos (no ocupan instalaciones): ' +
                visitas.map(v => _cqE(v.f.label) + (v.c.ini ? ' ' + _cqE(v.c.ini) : '')).join(' · ') + '</div>';
        }
        ocupacion += '</div>';
    }

    if (!ocupacion) {
        ocupacion = '<div style="font-size:10px;color:#6b7280;background:#f8fafc;border-radius:6px;padding:10px;">' +
            'Esta semana no tiene ninguna actividad registrada en el cuadrante.</div>';
    }

    const horas = Math.floor(totalMin / 60), mins = totalMin % 60;
    const resumen =
        '<div style="background:#eff6ff;border:2px solid #2563eb;border-radius:6px;padding:8px 12px;' +
             'margin-bottom:10px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;">' +
            '<div style="font-size:11px;font-weight:800;color:#1d4ed8;">TOTAL DE OCUPACIÓN DE LA SEMANA</div>' +
            '<div style="font-size:11px;font-weight:800;color:#111827;">' + horas + ' h' +
                (mins ? ' ' + mins + ' min' : '') + '</div>' +
        '</div>' +
        '<div style="font-size:8.5px;color:#6b7280;margin-bottom:10px;line-height:1.5;">' +
            'El total suma las horas de cada <strong>espacio</strong> por separado: una sesión de una hora que ' +
            'ocupa dos espacios cuenta como dos horas de campo. El campo se considera dividido en <strong>' +
            nEsp + ' espacios</strong>.' +
            (hayVisitas ? ' Los partidos disputados fuera de casa <strong>no computan</strong>: se juegan en ' +
                          'instalaciones ajenas y se listan sólo como referencia.' : '') +
        '</div>';

    // Leyenda con los mismos colores del papel, para que el técnico municipal
    // pueda leer la matriz sin la aplicación delante.
    const leyenda = '<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:8.5px;color:#4b5563;margin-top:6px;">' +
        Object.keys(CQ_TIPOS).map(k => {
            const p = CQ_PAPEL[k] || CQ_PAPEL.entreno;
            return '<span><span style="display:inline-block;width:9px;height:9px;background:' + p.bg +
                   ';border:1px solid ' + p.bd + ';vertical-align:-1px;"></span> ' + _cqE(CQ_TIPOS[k].label) + '</span>';
        }).join('') + '</div>';

    const cuerpo =
        '<div class="rx-block">' +
            '<div class="rx-block-title">Ocupación de instalaciones</div>' + resumen + ocupacion +
        '</div>' +
        '<div class="rx-block" style="page-break-before:always;">' +
            '<div class="rx-block-title">Cuadrante semanal por equipos</div>' + matriz + leyenda +
        '</div>';

    const alcance = (typeof window._cronosCoordScope === 'function')
        ? window._cronosCoordScope(me) : '';

    window.rxImprimir({
        titulo:    'Cuadrante semanal · ocupación de instalaciones',
        subtitulo: 'Semana del ' + fLarga(lunes) + ' al ' + fLarga(dom),
        meta: [
            me.clubName ? 'Club: ' + me.clubName : '',
            alcance ? 'Ámbito: ' + window._cronosCoordScopeLabel(alcance) : '',
            st.doc.publicadoEn ? 'Cuadrante enviado a los entrenadores' : 'Cuadrante sin enviar (borrador)',
        ],
        cuerpo:   cuerpo,
        apaisado: true,   // 7 días + equipo no caben en vertical
    });
};

// ════════════════════════════════════════════════════════════════════
//  ENVÍO A LOS ENTRENADORES
// ════════════════════════════════════════════════════════════════════
//  🔴🔴 LA PUERTA QUE SÍ LLEVA A ALGÚN SITIO.
//
//  Este proyecto ya tuvo un botón que "confirmaba envíos que nadie recibía"
//  (v598, "Transmitir al SuperAdmin"). Aquí NO se repite: el entrenador NO
//  tiene bandeja de avisos en la aplicación, así que el envío no puede
//  consistir sólo en escribir en `cronos_notifications`.
//
//  La entrega real es window.cronosCuadranteClubDeMiEquipo(): la Planificación
//  Semanal del entrenador (js/coach/training/panel.js) lee el cuadrante del
//  club y le pinta SU fila encima de su propia parrilla. Eso es exactamente el
//  flujo que describió el autor: el club marca la pauta, el entrenador la
//  desarrolla.
//
//  El documento de `cronos_notifications` se escribe IGUALMENTE porque es el
//  registro de que la semana se publicó y a quién —el Director lo ve en la
//  franja verde de la cabecera— y porque es lo que consumirá la bandeja de
//  v605. Pero no es lo que hace visible el cuadrante.
// ════════════════════════════════════════════════════════════════════
async function _cqEntrenadoresDelClub(clubId) {
    const fs = await _cqFS();
    const snap = await fs.getDocs(fs.query(fs.collection(fs.db, 'users'), fs.where('clubId', '==', clubId)));
    const out = [];
    snap.forEach(dd => {
        const u = dd.data() || {};
        // ⚠️ SÓLO EL DOCUMENTO PRIMARIO. `users` contiene también documentos
        // secundarios (`${uid}_${role}_${clubId}`) sin category ni allRoles que
        // auth.js crea al añadir un rol; contarlos duplicaría destinatarios y
        // enseñaría entrenadores sin equipo. Mismo criterio que la mensajería
        // unificada (js/coach/comms/panel.js).
        if (u.uid && u.uid !== dd.id) return;
        if (u.status && u.status !== 'active') return;
        if (u.isAuthorized === false) return;

        // Una persona puede llevar DOS equipos (un F7 y un F11): la unidad es
        // la PLAZA, no el rol. Se lista una fila por plaza y se deduplica por
        // uid en el momento de enviar.
        const plazas = (Array.isArray(u.allRoles) ? u.allRoles : [])
            .filter(r => r && (r.role === 'user' || r.role === 'coach') &&
                         String(r.clubId || '') === String(clubId) && r.isAuthorized !== false);

        const nombre = (typeof window.cronosNombreUsuario === 'function')
            ? window.cronosNombreUsuario(u) : (u.displayName || u.email || dd.id);

        if (!plazas.length) {
            if (u.role === 'user' || u.role === 'coach') {
                out.push({ uid: dd.id, nombre, email: u.email || '', cat: u.category || '', sub: u.subcategory || '' });
            }
            return;
        }
        plazas.forEach(r => out.push({
            uid: dd.id, nombre, email: u.email || '',
            cat: (typeof window.ctNormCat === 'function') ? window.ctNormCat(r.category || '') : (r.category || ''),
            sub: (typeof window.ctNormSubcat === 'function') ? window.ctNormSubcat(r.subcategory || '') : (r.subcategory || ''),
        }));
    });
    return out;
}

window.cqAbrirEnvio = async function () {
    const st = window._cqState;
    const me = window._cronosCurrentUser || {};
    const clubId = window._testRoleClubId || me.clubId || '';
    if (!clubId || !st.doc) return;

    if (st.sucio && !confirm('Hay cambios sin guardar. Se enviará lo ÚLTIMO GUARDADO, no lo que ves ahora.\n\n¿Continuar de todos modos?')) return;

    _cqOverlay('📤 Enviar el cuadrante a los entrenadores',
        '<div id="cq-env-body" style="color:var(--text-muted);font-size:0.82rem;text-align:center;padding:1.5rem;">⏳ Cargando entrenadores…</div>',
        '<button class="btn" onclick="cqCerrarOverlay()" style="padding:0.45rem 1rem;font-size:0.75rem;">Cancelar</button>' +
        '<button class="btn" id="cq-env-ok" onclick="cqEnviar()" style="padding:0.45rem 1.1rem;font-size:0.75rem;font-weight:700;background:rgba(88,166,255,0.15);border:1px solid rgba(88,166,255,0.4);color:#58a6ff;">📤 Enviar</button>');

    let lista = [];
    try {
        lista = await _cqEntrenadoresDelClub(clubId);
    } catch (e) {
        const b = document.getElementById('cq-env-body');
        if (b) b.innerHTML = '<div style="color:#ff5858;padding:1rem;">⚠️ No se ha podido leer la lista de entrenadores.<br>' +
            '<span style="font-size:0.75rem;color:var(--text-muted);">' + _cqE(e && e.message ? e.message : '') + '</span></div>';
        return;
    }

    // Un coordinador de F7 no manda el cuadrante a los entrenadores de F11.
    if (typeof window._cronosVeCategoria === 'function') {
        lista = lista.filter(r => !r.cat || window._cronosVeCategoria(me, r.cat));
    }

    const body = document.getElementById('cq-env-body');
    if (!body) return;
    if (!lista.length) {
        body.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted);line-height:1.7;">' +
            'No hay entrenadores activos a los que enviar.<br>' +
            '<span style="font-size:0.76rem;">Se dan de alta desde <strong>✉️ Secretaría</strong> o desde el panel del administrador del club.</span></div>';
        const ok = document.getElementById('cq-env-ok'); if (ok) ok.style.display = 'none';
        return;
    }

    lista.sort((a, b) => {
        const ia = CQ_ORDEN_CAT.indexOf(a.cat), ib = CQ_ORDEN_CAT.indexOf(b.cat);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return String(a.nombre).localeCompare(String(b.nombre));
    });
    window._cqEnvioLista = lista;

    body.innerHTML =
        '<div style="font-size:0.74rem;color:var(--text-muted);line-height:1.5;margin-bottom:0.7rem;' +
             'background:rgba(88,166,255,0.05);border:1px solid rgba(88,166,255,0.15);border-radius:8px;padding:0.5rem 0.7rem;">' +
            'Cada entrenador verá el cuadrante del club <strong style="color:#58a6ff;">encima de su Planificación Semanal</strong>, ' +
            'con los espacios y horarios que le has asignado.</div>' +
        '<label style="display:flex;align-items:center;gap:0.45rem;font-size:0.78rem;color:white;font-weight:700;cursor:pointer;' +
               'padding:0.4rem 0;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:0.35rem;">' +
            '<input type="checkbox" id="cq-env-todos" checked onchange="cqEnvioTodos(this.checked)"> Todos (' + lista.length + ')</label>' +
        lista.map((r, i) =>
            '<label style="display:flex;align-items:center;gap:0.45rem;font-size:0.78rem;color:white;cursor:pointer;padding:0.3rem 0;">' +
                '<input type="checkbox" class="cq-env-chk" data-i="' + i + '" checked>' +
                '<span style="flex:1;min-width:0;">' + _cqE(r.nombre) +
                    (r.cat ? ' <span style="color:#8b949e;font-size:0.72rem;">· ' + _cqE(_cqLabelEquipo(r.cat, r.sub)) + '</span>' : '') +
                '</span></label>').join('');
};

window.cqEnvioTodos = function (marcado) {
    document.querySelectorAll('.cq-env-chk').forEach(c => { c.checked = marcado; });
};

window.cqEnviar = async function () {
    const st = window._cqState;
    const me = window._cronosCurrentUser || {};
    const clubId = window._testRoleClubId || me.clubId || '';
    const lista  = window._cqEnvioLista || [];

    const elegidos = Array.prototype.slice.call(document.querySelectorAll('.cq-env-chk'))
        .filter(c => c.checked)
        .map(c => lista[parseInt(c.dataset.i, 10)])
        .filter(Boolean);

    if (!elegidos.length) { _cqToast('⚠️ Selecciona al menos un entrenador.', 4000); return; }

    if (typeof showSpinner === 'function') showSpinner('Enviando el cuadrante…');
    try {
        const fs = await _cqFS();
        const lunes = _cqLunes(st.offset);
        const dom   = new Date(lunes); dom.setDate(lunes.getDate() + 6);
        const f     = d => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
        const etiquetaSemana = 'Semana del ' + f(lunes) + ' al ' + f(dom);
        const nombreEmisor = (typeof window.cronosNombreUsuario === 'function')
            ? window.cronosNombreUsuario(me) : (me.displayName || me.email || '');

        // Deduplicado por uid: una persona con dos equipos recibe UN aviso.
        const enviados = new Set();
        let n = 0;
        for (const r of elegidos) {
            if (!r.uid || enviados.has(r.uid)) continue;
            enviados.add(r.uid);

            // Las filas de ESA persona (puede llevar dos equipos), en texto,
            // para que el aviso se lea solo. El cuadrante completo NO viaja
            // dentro del aviso: Firestore no manda deltas y duplicarlo por
            // destinatario multiplicaría el documento por N (lección de v576).
            const suyas = elegidos.filter(x => x.uid === r.uid);
            const resumen = _cqResumenDe(suyas.map(x => _cqIdFilaEquipo(clubId, x.cat, x.sub)), lunes);

            await fs.setDoc(fs.doc(fs.db, 'cronos_notifications', 'cq_' + r.uid + '_' + Date.now().toString(36) + '_' + n), {
                type:      'cuadrante_club',
                clubId:    clubId,
                userId:    r.uid,     // el campo que verifican las reglas
                parentUid: r.uid,     // el que buscan los paneles receptores
                coachUid:  me.uid || '',
                senderName: nombreEmisor,
                senderRole: me.role || '',
                weekKey:    st.doc.weekKey,
                weekLabel:  etiquetaSemana,
                category:    suyas[0] ? suyas[0].cat : '',
                subcategory: suyas[0] ? suyas[0].sub : '',
                resumen:    resumen,
                createdAt:  new Date().toISOString(),
            });
            n++;
        }

        // El sello de publicación va en el propio cuadrante: así la cabecera
        // puede decir cuándo salió y a cuántos, sin volver a consultar avisos.
        st.doc.publicadoEn  = new Date().toISOString();
        st.doc.publicadoPor = me.uid || '';
        st.doc.publicadoA   = Array.from(enviados);
        await _cqGuardar(clubId, st.doc);
        st.sucio = false;

        if (typeof hideSpinner === 'function') hideSpinner();
        cqCerrarOverlay();
        _cqToast('✅ Cuadrante enviado a ' + n + ' entrenador' + (n === 1 ? '' : 'es') + '.', 4000);
        _cqPintar();
    } catch (e) {
        if (typeof hideSpinner === 'function') hideSpinner();
        _cqToast('⚠️ No se pudo enviar: ' + (e && e.message ? e.message : e), 5000);
    }
};

// Resumen en texto de las filas indicadas, para el cuerpo del aviso.
function _cqResumenDe(filaIds, lunes) {
    const d = window._cqState.doc;
    const partes = [];
    for (let i = 0; i < 7; i++) {
        const fecha = _cqFechaKey(new Date(lunes.getTime() + i * 86400000));
        filaIds.forEach(id => {
            const c = d.celdas[id + '|' + fecha];
            if (!c) return;
            const meta = CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno;
            // 🏟️ v607 · Los espacios efectivos, igual que en pantalla: si al
            // entrenador se le dice "espacio 2" en la parrilla, el aviso no
            // puede callárselo porque el dato guardado esté vacío.
            const espL = _cqEspaciosDe(c);
            const esp  = !espL.length ? ''
                       : _cqEspacioImplicito(c) ? ' · campo completo'
                       : ' · espacio ' + espL.join(' y ');
            const hora = c.ini ? (' ' + c.ini + (c.fin ? '-' + c.fin : '')) : '';
            partes.push(CQ_DIAS[i] + ': ' + (c.txt || meta.label) + hora + esp + (c.nota ? ' · ' + c.nota : ''));
        });
    }
    return partes.length ? partes.join('\n') : 'Sin actividades asignadas esta semana.';
}

// ════════════════════════════════════════════════════════════════════
//  LO QUE VE EL ENTRENADOR
//  Consumido por js/coach/training/panel.js para pintar la directriz del club
//  encima de su propia parrilla. Devuelve null si no hay cuadrante publicado
//  o si el entrenador no tiene fila en él: nunca lanza.
// ════════════════════════════════════════════════════════════════════
// ⚠️ v604 · CACHÉ CORTA POR SEMANA. El entrenador pasa semanas con ◀ ▶ y cada
// repintado preguntaba de nuevo. Son lecturas de Firestore que se pagan, y en
// este proyecto el techo siempre ha sido LEER, no escribir (v431, v576). 60 s
// es bastante para no cobrar el paseo por el calendario y poco para que un
// cuadrante recién enviado tarde en aparecer.
const _cqCacheDirectriz = {};
const CQ_CACHE_MS = 60000;

window.cronosCuadranteClubDeMiEquipo = async function (weekKey, forzar) {
    try {
        const me = window._cronosCurrentUser || {};
        const clubId = me.clubId || '';
        const teamId = (typeof window.cronosMyTeamId === 'function') ? (window.cronosMyTeamId() || '') : '';
        if (!clubId || !weekKey) return null;

        const clave = clubId + '|' + teamId + '|' + weekKey;
        const guardado = _cqCacheDirectriz[clave];
        if (!forzar && guardado && (Date.now() - guardado.t) < CQ_CACHE_MS) return guardado.v;

        // ⚠️ EL "NO HAY NADA" TAMBIÉN SE CACHEA. Si sólo se guardara el
        // resultado positivo, el caso normal —el club aún no ha enviado la
        // semana— seguiría cobrando una lectura por cada ◀ ▶, que es
        // justamente el más frecuente.
        const recordar = (v) => { _cqCacheDirectriz[clave] = { t: Date.now(), v }; return v; };

        const fs = await _cqFS();
        const snap = await fs.getDoc(fs.doc(fs.db, 'trainingPlans', clubId, 'weeks', _cqDocId(weekKey)));
        if (!snap.exists()) return recordar(null);
        const d = snap.data() || {};
        // ⚠️ SÓLO SI SE HA ENVIADO. Un cuadrante a medio escribir no es una
        // directriz: enseñarlo haría montar la semana sobre un borrador.
        if (!d.publicadoEn) return recordar(null);

        const celdas = (d.celdas && typeof d.celdas === 'object') ? d.celdas : {};
        const filas  = Array.isArray(d.filas) ? d.filas : [];
        const mia    = filas.find(f => f.id === teamId);
        if (!mia) return recordar(null);

        const dias = [];
        const lunes = new Date(weekKey + 'T12:00:00');
        for (let i = 0; i < 7; i++) {
            const fecha = _cqFechaKey(new Date(lunes.getTime() + i * 86400000));
            const c = celdas[teamId + '|' + fecha];
            // 🏟️ v607 · `espEfectivos` y `espCompleto` viajan resueltos: el
            // panel del entrenador no puede repetir la regla del campo completo
            // —sería la cuarta copia— y sin ellos su partido en casa aparecería
            // sin espacio mientras la parrilla del club dice que ocupa todo.
            dias.push(c ? { dia: CQ_DIAS[i], fecha, ...c,
                            espEfectivos: _cqEspaciosDe(c, d.espacios || CQ_ESPACIOS),
                            espCompleto:  _cqEspacioImplicito(c),
                            tipoLabel: (CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno).label,
                            color: (CQ_TIPOS[c.tipo] || CQ_TIPOS.entreno).color }
                        : { dia: CQ_DIAS[i], fecha, vacio: true });
        }
        return recordar({ equipo: mia.label, publicadoEn: d.publicadoEn, dias,
                 espacios: d.espacios || CQ_ESPACIOS, hayAlgo: dias.some(x => !x.vacio) });
    } catch (e) {
        // ⚠️ Un fallo NO se cachea: si la lectura se cayó por un corte de red,
        // guardar el null dejaría al entrenador sin cuadrante durante un minuto
        // aunque la conexión vuelva al segundo siguiente.
        console.warn('[Cuadrante] no se pudo leer la directriz del club:', e && e.message ? e.message : e);
        return null;
    }
};

// ════════════════════════════════════════════════════════════════════
//  🗓️ v604 · LA VENTANA DEL CLUB, AL LADO DE SU SEMANA
//
//  Petición del autor tras probar la v603, puntos 2 y 3:
//   · "No crees botones nuevos. El entrenador debe recibir y consultar el
//      cuadrante del club DENTRO de su sección de ENTRENAMIENTOS."
//   · "Debe haber una opción accesible que le permita abrir/consultar de manera
//      simultánea el cuadrante que le envió el coordinador."
//
//  Así que NO hay sección nueva ni entrada de menú nueva: hay un interruptor
//  en la cabecera de la Planificación Semanal que abre una columna a la
//  derecha. La parrilla propia y la pauta del club se ven A LA VEZ.
//
//  🔑 EL INTERRUPTOR RECUERDA SU ESTADO (localStorage). Un panel que hay que
//  volver a abrir cada vez que se pasa de semana con ◀ ▶ no sirve para
//  trabajar: justo cuando se compara semana a semana es cuando estorba.
//
//  ⚠️ Y ARRANCA ABIERTO LA PRIMERA VEZ que hay cuadrante. Si empezara cerrado,
//  el entrenador no sabría que el club le ha enviado nada — el envío del
//  coordinador volvería a ser invisible, que es justo lo que v603 vino a
//  evitar.
// ════════════════════════════════════════════════════════════════════
const CQ_LADO_KEY = 'cronos_cq_lado';

function _cqLadoAbierto() {
    try {
        const v = localStorage.getItem(CQ_LADO_KEY);
        return v === null ? true : v === '1';   // sin preferencia guardada: abierto
    } catch (e) { return true; }                // navegador sin almacenamiento: abierto
}

window.cqToggleDirectriz = function () {
    const abierto = !_cqLadoAbierto();
    try { localStorage.setItem(CQ_LADO_KEY, abierto ? '1' : '0'); } catch (e) { /* sin persistencia, pero funciona */ }
    // Se repinta la semana entera: es lo que ya hacen ◀ ▶ y HOY, y así el
    // flex recalcula el ancho de la parrilla propia con y sin la columna.
    if (typeof renderTrainingWeek === 'function') renderTrainingWeek();
};

//  La llama renderTrainingWeek() (js/coach/training/panel.js) con guarda
//  typeof, DESPUÉS de escribir su HTML: rellena el hueco `#cq-directriz`.
//  Es asíncrona a propósito y no bloquea el pintado de la parrilla propia.
window.cronosPintarDirectrizClub = async function (weekKey, contenedorId) {
    const cont = document.getElementById(contenedorId || 'cq-directriz');
    if (!cont) return;

    const boton  = document.getElementById('cq-lado-btn');
    const info   = await window.cronosCuadranteClubDeMiEquipo(weekKey);

    // ⚠️ El contenedor puede haber sido reemplazado mientras se leía (el
    // entrenador cambiando de semana con ◀ ▶). Se comprueba que sigue vivo.
    if (!document.body.contains(cont)) return;

    const hay = !!(info && info.hayAlgo);

    // El botón dice si hay algo que ver ANTES de pulsarlo. Un botón que
    // siempre parece igual obliga a abrirlo para descubrir que está vacío.
    if (boton) {
        boton.innerHTML = '🗓️ CUADRANTE DEL CLUB' +
            (hay ? ' <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#3fb950;vertical-align:middle;margin-left:2px;"></span>' : '');
        boton.style.opacity = hay ? '1' : '0.55';
        boton.title = hay
            ? 'Ver el cuadrante que ha enviado el club, al lado, mientras montas tu semana'
            : 'El club todavía no ha enviado el cuadrante de esta semana';
    }

    if (!_cqLadoAbierto()) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
    cont.style.display = 'block';

    const cabecera = (titulo, sub) =>
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.4rem;margin-bottom:0.6rem;">' +
            '<div style="min-width:0;">' +
                '<div style="font-size:0.78rem;font-weight:800;color:#58a6ff;overflow-wrap:break-word;word-break:normal;hyphens:auto;">' + titulo + '</div>' +
                '<div style="font-size:0.64rem;color:var(--text-muted);">' + sub + '</div>' +
            '</div>' +
            '<button onclick="if(typeof cqToggleDirectriz===\'function\') cqToggleDirectriz();" title="Cerrar esta ventana" ' +
                'style="background:none;border:none;color:#8b949e;font-size:1rem;cursor:pointer;line-height:1;padding:0 2px;flex:0 0 auto;">✕</button>' +
        '</div>';

    const marco = (dentro) =>
        '<div style="height:100%;box-sizing:border-box;border:1px solid rgba(88,166,255,0.35);border-radius:12px;' +
             'padding:0.7rem 0.8rem;background:rgba(88,166,255,0.06);overflow-y:auto;max-height:60vh;">' + dentro + '</div>';

    // ⚠️ SIN CUADRANTE SE DICE, NO SE DEJA EN BLANCO. Una ventana vacía y
    // abierta parece una avería; y el entrenador tiene que poder distinguir
    // "el club no ha mandado nada" de "esto no funciona".
    if (!hay) {
        cont.innerHTML = marco(
            cabecera('🗓️ Cuadrante del club', 'Semana en curso') +
            '<div style="font-size:0.72rem;color:var(--text-muted);line-height:1.6;padding:0.6rem 0;">' +
                'El club <strong>todavía no ha enviado</strong> el cuadrante de esta semana.<br><br>' +
                'Cuando el Director Deportivo o tu Coordinador lo envíen, aparecerá aquí con los ' +
                '<strong>espacios del campo</strong> y los <strong>horarios</strong> que tengas asignados.' +
            '</div>');
        return;
    }

    const cuando = new Date(info.publicadoEn);
    cont.innerHTML = marco(
        cabecera('🗓️ Cuadrante del club', _cqE(info.equipo) + ' · enviado el ' +
                 _cqE(cuando.toLocaleDateString('es-ES', { day:'numeric', month:'short' }))) +
        // En columna, un día debajo de otro: la ventana es estrecha y así se
        // lee en paralelo, fila a fila, contra la parrilla de la izquierda.
        '<div style="display:flex;flex-direction:column;gap:0.35rem;">' +
        info.dias.filter(d => !d.vacio).map(d => {
            const espL = Array.isArray(d.espEfectivos) ? d.espEfectivos : (Array.isArray(d.esp) ? d.esp : []);
            const esp  = !espL.length ? ''
                       : d.espCompleto ? ' · 🏟️ campo completo'
                       : ' · 🏟️ ' + espL.slice().sort().join('·');
            const hora = d.ini ? (d.ini + (d.fin ? '–' + d.fin : '')) : '';
            const rgb  = (typeof window._cronosHexRgb === 'function') ? window._cronosHexRgb(d.color) : '88,166,255';
            return '<div style="border-radius:8px;padding:0.4rem 0.5rem;' +
                   'background:rgba(' + rgb + ',0.12);border:1px solid rgba(' + rgb + ',0.4);">' +
                '<div style="font-size:0.6rem;font-weight:800;color:' + d.color + ';letter-spacing:0.3px;">' + _cqE(d.dia) + '</div>' +
                '<div style="font-size:0.72rem;color:white;font-weight:700;overflow-wrap:break-word;word-break:normal;hyphens:auto;">' + _cqE(d.txt || d.tipoLabel) + '</div>' +
                (hora ? '<div style="font-size:0.66rem;color:var(--text-muted);">' + _cqE(hora) + _cqE(esp) + '</div>'
                      : (esp ? '<div style="font-size:0.66rem;color:var(--text-muted);">' + _cqE(esp) + '</div>' : '')) +
                (d.nota ? '<div style="font-size:0.62rem;color:var(--text-muted);overflow-wrap:break-word;word-break:normal;hyphens:auto;">' + _cqE(d.nota) + '</div>' : '') +
            '</div>';
        }).join('') +
        '</div>' +
        '<div style="font-size:0.63rem;color:var(--text-muted);margin-top:0.6rem;line-height:1.45;' +
             'border-top:1px solid rgba(255,255,255,0.08);padding-top:0.5rem;">' +
            'Es la pauta del club: los espacios y horarios que tienes asignados. ' +
            'Monta tu semana en la parrilla sobre este marco.</div>');
};

// Exportado para los guards y para switchStaffTab.
window._sdLoadCuadrante = _sdLoadCuadrante;
window.CQ_TIPOS = CQ_TIPOS;
