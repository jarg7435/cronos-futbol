// ════════════════════════════════════════════════════════════════════
//  📅 CALENDARIO DE TEMPORADA · MOTOR DE INTERPRETACIÓN (v609)
//  js/coach/reports/calendario-parser.js
// ════════════════════════════════════════════════════════════════════
//
//  QUÉ ES. El motor que convierte un calendario oficial de la federación
//  —un PDF arrastrado a la app, o un texto pegado a mano— en una lista de
//  partidos con jornada, fecha, hora, rival, casa/fuera y sede.
//
//  ── POR QUÉ ESTE FICHERO ESTÁ SEPARADO ──────────────────────────────
//  Aquí NO hay Firestore, ni DOM, ni pdf.js. Es lógica pura, y por eso
//  `scripts/test_calendario_parser.js` puede CARGARLO EN NODE y ejecutarlo
//  contra calendarios de mentira con maquetados distintos. Un parser
//  vigilado por expresiones regulares sobre su propio código fuente no
//  demuestra nada: lo único que demuestra que interpreta bien un PDF es
//  interpretarlo. La lectura del PDF y la pantalla viven en el fichero
//  hermano `calendario-temporada.js`.
//
//  ── 🔑🔑 LA IDEA QUE HACE QUE ESTO ESCALE ────────────────────────────
//  El autor pidió (2026-08-23) que cualquier club de cualquier federación
//  pueda subir su propio PDF sin que nadie toque código. Un parser "por
//  formato" —"la columna 3 es el rival"— no puede cumplir eso: la respuesta
//  cambia con cada federación y obliga a mantener un catálogo de parsers.
//
//  Así que este motor NO intenta reconocer el MAQUETADO. Reconoce el DATO:
//
//   1. Una FECHA se escribe como una fecha en todas partes. Igual una HORA.
//      Son anclas duras, detectables sin saber nada del documento.
//   2. 🔑 EL NOMBRE DEL PROPIO CLUB ES LA BRÚJULA. En una línea de partido
//      hay dos equipos y uno eres tú: el otro es el rival —sin preguntar qué
//      columna es cuál— y el lado en que apareces respecto al separador dice
//      si juegas en casa o fuera. Eso elimina el mapeo de columnas entero.
//   3. Si el nombre del club no casa (abreviaturas raras, erratas), hay una
//      segunda brújula: en el calendario de UN equipo, ese equipo sale en
//      TODAS las jornadas. El nombre más repetido es él. Ver `_candidatos`.
//   4. Lo que sobra de la línea, quitado todo lo anterior, es la sede.
//
//  ── ⚠️ Y LO QUE ESTE MOTOR NO HACE ──────────────────────────────────
//  No acierta siempre, y está diseñado sabiéndolo. Cada fila sale con una
//  NOTA DE CONFIANZA (verde / amarillo / rojo) y NADA se escribe en
//  Firestore sin que una persona haya visto la tabla. Ésa es la condición
//  que permite poner un parser heurístico en manos de un club desconocido:
//  no que no se equivoque nunca, sino que cuando duda lo diga y nunca
//  guarde a ciegas. Un PDF escaneado (una imagen, sin capa de texto) no
//  tiene nada que extraer: para eso está la vía de pegar el texto.
// ════════════════════════════════════════════════════════════════════

(function (glob) {
'use strict';

// ── Meses en las lenguas en que las federaciones publican ────────────
// No es adorno: la FCF publica en catalán y la RFGF en gallego. Añadir una
// entrada a este diccionario es todo el "soporte" que necesita una lengua.
const CAL_MESES = {
    // castellano
    ene:1, enero:1, feb:2, febrero:2, mar:3, marzo:3, abr:4, abril:4,
    may:5, mayo:5, jun:6, junio:6, jul:7, julio:7, ago:8, agosto:8,
    sep:9, sept:9, septiembre:9, set:9, oct:10, octubre:10,
    nov:11, noviembre:11, dic:12, diciembre:12,
    // catalán / valenciano
    gen:1, gener:1, febrer:2, marc:3, març:3, maig:5, juny:6, juliol:7,
    agost:8, setembre:9, novembre:11, desembre:12,
    // gallego
    xan:1, xaneiro:1, febreiro:2, maio:5, xuno:6, xuño:6, xullo:7,
    setembro:9, outubro:10, novembro:11, decembro:12,
    // euskera
    urtarrila:1, otsaila:2, martxoa:3, apirila:4, maiatza:5, ekaina:6,
    uztaila:7, abuztua:8, iraila:9, urria:10, azaroa:11, abendua:12,
};

// Ruido que llevan los nombres de club y que no ayuda a distinguirlos.
// Se quita SOLO para comparar; el nombre que se guarda es el original.
const CAL_RUIDO = new Set([
    'CD','C','D','CF','UD','SD','AD','CDE','SAD','FC','EF','EFF','FS','CFS',
    'CLUB','DEPORTIVO','DEPORTIVA','FUTBOL','FUTBOLL','FUBOL','BALOMPIE',
    'ATLETICO','ATHLETIC','ASOCIACION','SOCIEDAD','ESCUELA','AGRUPACION',
    'REAL','UNION','UNIO','ESPORTIU','ESPORTIVA','FUTBOLCLUB','DE','DEL','LA','EL',
    'A','B','C','SUB','JUV','CAD','INF','ALE','BEN','PRE','EQUIPO','ATCO',
]);

// ── Utilidades de texto ──────────────────────────────────────────────
//  ⚠️ EL RANGO DE ACENTOS SE CONSTRUYE CON fromCharCode, NO SE ESCRIBE.
//  Escrito como literal, el fichero fuente contendría los propios caracteres
//  combinantes U+0300-U+036F —invisibles al ojo— y cualquier herramienta que
//  lo reguardase con otra codificación los convertiría en un rango distinto:
//  la comparación de nombres dejaría de quitar acentos y NADA fallaría de
//  forma visible, sólo empezarían a no casar los clubes con tilde. Este
//  proyecto ya perdió un fichero entero por una trampa de codificación.
const _CAL_ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36F) + ']', 'g');

function _sinAcentos(s) {
    return String(s == null ? '' : s)
        .normalize('NFD').replace(_CAL_ACENTOS, '');
}

// Forma canónica para COMPARAR nombres de equipo. Nunca para mostrar.
function normalizarNombre(s) {
    return _sinAcentos(s).toUpperCase()
        .replace(/[.,;:_/\\()[\]{}"'`´·•|]/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Palabras significativas de un nombre (sin el ruido de arriba).
function _tokens(s) {
    return normalizarNombre(s).split(' ').filter(t => t && !CAL_RUIDO.has(t));
}

// ¿Son el mismo club? Se compara por PALABRAS COMPARTIDAS, no por igualdad:
// "C.D. Ejemplo", "CD EJEMPLO B" y "EJEMPLO CLUB DEPORTIVO" son el mismo.
// Devuelve 0..1. El umbral lo pone quien llama.
function parecido(a, b) {
    const ta = _tokens(a), tb = _tokens(b);
    if (!ta.length || !tb.length) return 0;
    const sa = new Set(ta), sb = new Set(tb);
    let comunes = 0;
    sa.forEach(t => { if (sb.has(t)) comunes++; });
    // Sobre el más CORTO: el calendario abrevia y la app guarda el nombre
    // largo (o al revés). Exigir que coincidan los dos por igual haría que
    // "EJEMPLO" no casara nunca con "CLUB DEPORTIVO EJEMPLO DE ARRIBA".
    const base = Math.min(sa.size, sb.size);
    let r = comunes / base;
    // Sin palabras comunes, un último intento: una contiene a la otra
    // entera (nombres de una sola palabra con prefijos pegados).
    if (!r) {
        const na = normalizarNombre(a).replace(/ /g, ''), nb = normalizarNombre(b).replace(/ /g, '');
        if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) r = 0.75;
    }
    return r;
}

// ── Detección de FECHA ───────────────────────────────────────────────
// Devuelve { d, m, a|null, txt, i, len } o null. NO decide el año todavía:
// muchos calendarios escriben sólo "13/09" y el año depende de la temporada.
function _buscarFecha(texto) {
    let m;

    // ISO: 2026-09-13
    m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(texto);
    if (m) return { d: +m[3], m: +m[2], a: +m[1], txt: m[0], i: m.index, len: m[0].length };

    // 13 de septiembre de 2026 · 13 sep 2026 · 13-sep-26 · 13 setembre
    const mesesRe = Object.keys(CAL_MESES).sort((x, y) => y.length - x.length).join('|');
    m = new RegExp('\\b(\\d{1,2})\\s*(?:de\\s+|[-/. ])\\s*(' + mesesRe + ')\\b(?:\\s*(?:de\\s+|[-/. ])\\s*(\\d{2,4}))?', 'i')
        .exec(_sinAcentos(texto).toLowerCase());
    if (m) {
        const mes = CAL_MESES[m[2]];
        if (mes) return { d: +m[1], m: mes, a: m[3] ? _anio4(+m[3]) : null, txt: texto.substr(m.index, m[0].length), i: m.index, len: m[0].length };
    }

    // 13/09/2026 · 13-09-26 · 13.09.2026
    m = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/.exec(texto);
    if (m) {
        let d = +m[1], mes = +m[2];
        // Casi todas las federaciones españolas escriben día/mes. Sólo se
        // invierte cuando el primero NO puede ser un día y el segundo sí.
        if (d > 12 && mes <= 12) { /* d/m, seguro */ }
        else if (d <= 12 && mes > 12) { const t = d; d = mes; mes = t; }
        if (d >= 1 && d <= 31 && mes >= 1 && mes <= 12) {
            return { d, m: mes, a: _anio4(+m[3]), txt: m[0], i: m.index, len: m[0].length };
        }
    }

    // 13/09 sin año.
    m = /\b(\d{1,2})[/\-.](\d{1,2})\b/.exec(texto);
    if (m) {
        const d = +m[1], mes = +m[2];
        if (d >= 1 && d <= 31 && mes >= 1 && mes <= 12) {
            return { d, m: mes, a: null, txt: m[0], i: m.index, len: m[0].length };
        }
    }
    return null;
}

function _anio4(a) { return a < 100 ? (a >= 70 ? 1900 + a : 2000 + a) : a; }

// El año que le toca a un mes suelto dentro de una temporada agosto→junio.
// Sin esto, "13/06" caería en el mismo año que "13/09" y la segunda vuelta
// entera se guardaría nueve meses antes de tiempo.
function anioDeTemporada(mes, inicioTemporada) {
    return (mes >= 7) ? inicioTemporada : inicioTemporada + 1;
}

// Año de arranque de la temporada en curso (jul-dic → este año; ene-jun → el anterior).
function temporadaDe(fecha) {
    const f = fecha || new Date();
    return (f.getMonth() + 1) >= 7 ? f.getFullYear() : f.getFullYear() - 1;
}

function _clave(a, m, d) {
    return a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// ¿Existe de verdad? "31/02" es un fallo de lectura, no una fecha.
function _fechaValida(a, m, d) {
    const f = new Date(a, m - 1, d);
    return f.getFullYear() === a && (f.getMonth() + 1) === m && f.getDate() === d;
}

// ── Detección de HORA ────────────────────────────────────────────────
// ⚠️ SE BUSCA DESPUÉS DE HABER QUITADO LA FECHA. "13.09" es una fecha y
// también encaja en un patrón de hora: mirar la hora primero convertiría
// media temporada en partidos a las 13:09.
function _buscarHora(texto) {
    let m = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/i.exec(texto);
    if (m) return { hora: String(+m[1]).padStart(2, '0') + ':' + m[2], txt: m[0], i: m.index, len: m[0].length };
    m = /\b([01]?\d|2[0-3])\s*h\b/i.exec(texto);
    if (m) return { hora: String(+m[1]).padStart(2, '0') + ':00', txt: m[0], i: m.index, len: m[0].length };
    return null;
}

// ── Detección de JORNADA ─────────────────────────────────────────────
function _buscarJornada(texto) {
    const t = _sinAcentos(texto);
    let m = /\b(?:JORNADA|JORN|JOR|J)\s*\.?\s*(?:N[ºo°.]?\s*)?(\d{1,2})\b/i.exec(t);
    if (m) return { jornada: +m[1], txt: m[0], i: m.index, len: m[0].length };
    return null;
}

// ── Marcas explícitas de casa / fuera ────────────────────────────────
// Cuando la federación ya lo dice, manda ella: no hace falta deducirlo.
const CAL_LOCALIA_RE = /\b(EN\s+CASA|CASA|LOCAL(?:IA)?|FUERA|VISITANTE|DESPLAZAMIENTO)\b/i;

function _buscarLocalia(texto) {
    const t = normalizarNombre(texto);
    if (/\b(EN CASA|CASA|LOCAL|LOCALIA)\b/.test(t)) return { local: true };
    if (/\b(FUERA|VISITANTE|DESPLAZAMIENTO|CAMPO CONTRARIO)\b/.test(t)) return { local: false };
    return null;
}

// ⚠️ Y una vez LEÍDA, la marca hay que QUITARLA. Si no, el rival se guarda
// como «U.D. Rival Norte (Casa)» y ese paréntesis viaja hasta la casilla del
// cuadrante que ven todos los entrenadores.
function _quitarLocalia(t) {
    return String(t || '')
        .replace(/[([]\s*(?:en\s+)?(?:casa|local(?:ia)?|fuera|visitante|desplazamiento)\s*[)\]]/gi, ' ')
        .replace(CAL_LOCALIA_RE, ' ')
        .replace(/\s{2,}/g, ' ').trim();
}

const CAL_SEPARADORES = [
    ' - ', ' – ', ' — ', ' vs ', ' VS ', ' Vs ', ' v.s. ', ' contra ', ' CONTRA ',
    ' / ', ' | ', '-', '–',
];

// Parte "EQUIPO A - EQUIPO B" en dos. Devuelve null si no hay separador
// fiable: un guion dentro de "ATLETICO SAN JUAN-VILLA" partiría mal, así
// que los separadores con espacios se prueban ANTES que los pegados.
function _partirEnDos(txt) {
    for (const sep of CAL_SEPARADORES) {
        const i = txt.indexOf(sep);
        if (i <= 0) continue;
        const a = txt.slice(0, i).trim(), b = txt.slice(i + sep.length).trim();
        if (a.length >= 2 && b.length >= 2) return [a, b];
    }
    return null;
}

// Con coordenadas del PDF hay una segunda vía: si los fragmentos de la línea
// forman DOS grupos separados por un hueco grande, ese hueco es la frontera
// entre columnas aunque no haya ningún guion. Es lo que salva las tablas.
function _partirPorColumnas(items) {
    if (!items || items.length < 2) return null;
    const orden = items.slice().sort((p, q) => p.x - q.x);
    let mejor = -1, hueco = 0;
    for (let i = 1; i < orden.length; i++) {
        const g = orden[i].x - (orden[i - 1].x + (orden[i - 1].w || 0));
        if (g > hueco) { hueco = g; mejor = i; }
    }
    if (mejor < 1 || hueco < 12) return null;
    const a = orden.slice(0, mejor).map(p => p.str).join(' ').trim();
    const b = orden.slice(mejor).map(p => p.str).join(' ').trim();
    if (a.length >= 2 && b.length >= 2) return [a, b];
    return null;
}

// ════════════════════════════════════════════════════════════════════
//  🔑🔑 v613 · LAS CALLES DE LA TABLA (detección de columnas del DOCUMENTO)
// ════════════════════════════════════════════════════════════════════
//  Reporte del autor tras probar la v612: de una temporada entera sólo
//  entraban TRES partidos (jornadas 11, 19 y 26), y el que entraba se colocaba
//  PERFECTO —viernes 20 de noviembre, naranja, fuera—. Que uno salga bien y el
//  resto no salga en absoluto dice dónde está el fallo: no en la fecha, ni en
//  la localía, ni en el volcado. En PARTIR LA LÍNEA EN DOS EQUIPOS.
//
//  Y la razón es que el calendario oficial de la federación es una TABLA:
//
//      CAMPO                 HORA    LOCAL            VISITANTE
//      MUNICIPAL EL PRADO    16:00   ESTRELLA CF      UD RIVAL NORTE
//
//  No hay guion. No hay "vs". Los dos equipos están en dos COLUMNAS, y lo
//  único que los separa es espacio en blanco. `_partirEnDos` no encuentra
//  separador en ninguna línea, y `_partirPorColumnas` —que mira el hueco más
//  ancho DE ESA LÍNEA SUELTA— sólo supera su umbral cuando un nombre corto
//  deja un hueco grande por casualidad. De ahí salen tres partidos sueltos
//  repartidos por toda la temporada en vez de las treinta jornadas.
//
//  🔑 LA IDEA: una columna no se ve en una línea, se ve en la PÁGINA. Si se
//  miran todas las filas de partido a la vez, las columnas dejan calles
//  verticales por las que NO PASA NI UNA LETRA en ninguna fila. Esas calles
//  son la tabla, y se detectan sin saber nada de la federación —igual que el
//  resto de este motor, que reconoce el dato y no el maquetado.
//
//  ⚠️ SÓLO CUENTAN LAS FILAS DE PARTIDO (las que traen hora o fecha). El
//  título de portada y los membretes abarcan el ancho entero: incluirlos
//  taparía todas las calles y no se detectaría ni una columna.
// ════════════════════════════════════════════════════════════════════
function modeloDeColumnas(lineas, minCalle) {
    const porPagina = {};
    (lineas || []).forEach(l => {
        if (!l || !l.items || l.items.length < 2) return;
        if (!_buscarHora(l.texto) && !_buscarFecha(l.texto)) return;
        const p = l.pagina || 1;
        (porPagina[p] = porPagina[p] || []).push(l);
    });
    const salida = {};
    Object.keys(porPagina).forEach(p => {
        const cortes = _callesDe(porPagina[p], minCalle);
        if (cortes.length) salida[p] = cortes;
    });
    return salida;
}

// Las calles de una página: los huecos verticales que ninguna fila ocupa.
//
//  🔑 EL ANCHO MÍNIMO DE CALLE ES ADAPTATIVO, y no es un capricho. Las tablas
//  de la federación van APRETADAS: entre la columna del local y la del
//  visitante puede haber 4 o 5 puntos, por debajo de cualquier umbral que
//  parezca "un hueco" mirando UNA fila. Por eso el reparto por línea suelta
//  (`_partirPorColumnas`, umbral 12) se dejaba media temporada.
//
//  Aquí una calle estrecha SÍ es fiable, porque para sobrevivir tiene que
//  estar libre en TODAS las filas a la vez. El hueco entre dos palabras de un
//  nombre —que en algunos PDF llega como fragmentos sueltos— lo tapa el
//  nombre más largo de cualquier otra fila. Eso sí: hace falta un mínimo de
//  filas para que ese tapado ocurra; con tres filas, un hueco entre palabras
//  pasaría por columna y partiría un nombre por la mitad.
function _callesDe(lineas, minCalle) {
    const G = minCalle != null ? minCalle : (lineas.length >= 6 ? 3.5 : 8);
    const iv = [];
    lineas.forEach(l => l.items.forEach(it => {
        const x = it.x || 0, w = it.w || 0;
        if (w > 0) iv.push([x, x + w]);
    }));
    // Sin anchuras no hay geometría que valga: algunos PDF no las publican.
    if (iv.length < 4 || lineas.length < 3) return [];
    iv.sort((a, b) => a[0] - b[0]);

    // Se funden los tramos que se solapan; lo que queda entre bloque y bloque
    // es blanco que NINGUNA fila pisa.
    const bloques = [];
    let cur = iv[0].slice();
    for (let i = 1; i < iv.length; i++) {
        if (iv[i][0] <= cur[1]) { if (iv[i][1] > cur[1]) cur[1] = iv[i][1]; }
        else { bloques.push(cur); cur = iv[i].slice(); }
    }
    bloques.push(cur);

    const cortes = [];
    for (let i = 1; i < bloques.length; i++) {
        if (bloques[i][0] - bloques[i - 1][1] >= G) {
            cortes.push((bloques[i - 1][1] + bloques[i][0]) / 2);
        }
    }
    return cortes;
}

// Reparte los fragmentos de una fila entre las columnas de su página y
// devuelve los DOS equipos. Se compara por el CENTRO del fragmento: el borde
// izquierdo de un texto centrado dentro de su columna no es fiable.
function partirPorModelo(items, cortes) {
    if (!items || !items.length || !cortes || !cortes.length) return null;
    const grupos = [];
    for (let i = 0; i <= cortes.length; i++) grupos.push([]);
    items.forEach(it => {
        const centro = (it.x || 0) + (it.w || 0) / 2;
        let k = 0;
        while (k < cortes.length && centro > cortes[k]) k++;
        grupos[k].push(it);
    });
    const textos = grupos
        .map(g => g.slice().sort((p, q) => p.x - q.x).map(p => p.str).join(' ')
                   .replace(/\s+/g, ' ').trim())
        .filter(t => t.length >= 2);
    if (textos.length < 2) return null;
    if (textos.length === 2) return textos;

    // Quedan más de dos columnas con algo: los equipos son las dos con más
    // LETRAS. Lo que sobra en estas tablas son códigos, dorsales y guiones
    // sueltos —cortos— mientras que un nombre de club es texto largo.
    const letras = (t) => (_sinAcentos(t).match(/[A-Za-z]/g) || []).length;
    const dos = textos.map((t, i) => ({ t, i, n: letras(t) }))
        .sort((a, b) => (b.n - a.n) || (a.i - b.i))
        .slice(0, 2)
        .sort((a, b) => a.i - b.i);
    if (dos[0].n < 3 || dos[1].n < 3) return null;
    return [dos[0].t, dos[1].t];
}

// Quita del texto un tramo ya consumido (fecha, hora, jornada…).
function _quitar(texto, hallazgo) {
    if (!hallazgo) return texto;
    return (texto.slice(0, hallazgo.i) + ' ' + texto.slice(hallazgo.i + hallazgo.len))
        .replace(/\s+/g, ' ').trim();
}

// ── La SEDE se recorta ANTES que nada ────────────────────────────────
//  🔑 Y el orden importa. La primera versión limpiaba la palabra "Campo" como
//  ruido y luego partía por el separador: el resultado era que el nombre de la
//  instalación se quedaba PEGADO al del rival ("U.D. Rival Norte Municipal El
//  Prado"). Ese rival se habría guardado así en Firestore y habría salido así
//  en el cuadrante de todos los entrenadores.
//
//  Estas palabras son el comienzo de una instalación, no ruido: donde aparece
//  una, empieza la sede y termina el nombre del equipo.
//  ➕ v655 · «MUNICIPAL DE ARINAGA» no lo reconocía nadie: el campo se
//  quedaba pegado al nombre del rival en la tabla del Portal del Federado.
//  Va DETRÁS de «campo» en la alternancia por claridad —el orden no decide
//  cuál gana, gana la que aparezca antes en el texto—, y se exige que
//  «municipal» empiece el nombre o vaya seguido de «de», para no partir un
//  club que la llevara dentro.
const CAL_SEDE_RE = /\b(campo(?:\s+de\s+f[uú]tbol)?|municipal\s+de\b|c\.?\s?d\.?\s?m\.?|ciudad\s+deportiva|complejo\s+deportivo|polideportivo|estadio|instalaci[oó]n(?:es)?|terreno\s+de\s+juego|sede|anexo)\b/i;

// Devuelve { texto, sede }: el texto sin la sede, y la sede aparte.
function _recortarSede(t) {
    const s = String(t || '');
    const m = CAL_SEDE_RE.exec(s);
    if (!m || m.index < 2) return { texto: s, sede: '' };
    return { texto: s.slice(0, m.index).trim(), sede: s.slice(m.index).trim() };
}

// Restos que no son ni equipo ni sede y ensucian la comparación.
//  🔴 EL `\b` DE JAVASCRIPT ES ASCII, Y UNA TILDE LE PARECE UN ESPACIO.
//  Este limpiador quita los días de la semana ("Vie 13/09"). Escrito con
//  `\b(mar)\b`, en «Juv. Marítima» la í cuenta como frontera de palabra: el
//  motor se comía el "Mar" y guardaba «Juv. ítima» como nombre del rival.
//  MEDIDO en el calendario real del Estrella CF, jornada 7. Y no es un caso
//  raro de un club: le pasa a «Domínguez» (dom → ínguez) y a cualquier
//  nombre que empiece por un día de la semana y siga con acento.
//  Se comprueba el borde a mano con una clase que SÍ incluye acentos.
//  ⚠️ Con lookahead, no con lookbehind: Safari no lo tuvo hasta 2023 y aquí
//  se abre desde iPads viejos.
const _CAL_DIAS_RE = new RegExp(
    '(^|[^A-Za-z\\u00C0-\\u00FF])' +
    '(lun|mar|mie|mi\\u00e9|jue|vie|sab|s\\u00e1b|dom|dl|dt|dc|dj|dv|ds|dg)' +
    '\\.?(?![A-Za-z\\u00C0-\\u00FF])', 'gi');

function _limpiarResto(t) {
    return String(t || '')
        .replace(_CAL_DIAS_RE, '$1 ')
        .replace(/\b(hora|fecha|jornada|rival|equipo|partido|grupo|categor[ií]a)\s*:/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s\-–—:;,.|/]+|[\s\-–—:;,.|/]+$/g, '')
        .trim();
}

// ════════════════════════════════════════════════════════════════════
//  LÍNEAS
// ════════════════════════════════════════════════════════════════════
//  Un PDF no contiene líneas: contiene fragmentos de texto con coordenadas.
//  Se agrupan por ALTURA (misma y, con tolerancia) y se ordenan por x. Eso
//  reconstruye el orden de lectura sea cual sea el maquetado: tabla, lista
//  o dos columnas. Es la única parte que depende de cómo esté hecho el PDF,
//  y no depende de QUÉ federación lo hizo.
// ════════════════════════════════════════════════════════════════════
function agruparEnLineas(fragmentos, tolerancia) {
    const tol = tolerancia == null ? 3 : tolerancia;
    const grupos = [];
    fragmentos.forEach(f => {
        if (!f) return;
        const bruto = String(f.str == null ? '' : f.str);
        // 🔑🔑 UN FRAGMENTO EN BLANCO NO ES BASURA: ES UNA COLUMNA.
        //  Medido sobre el calendario real de la Federación de Las Palmas
        //  (tFPDF): el generador rellena el hueco entre campo y campo con un
        //  fragmento de espacios que tiene ANCHURA PROPIA y encaja al
        //  milímetro con el siguiente ("La Garita" acaba en x=263,6 y el
        //  blanco va de 263,6 a 343,0, justo donde empieza "Estrella CF").
        //  Es decir: el propio documento marca dónde termina cada columna.
        //  Tirarlos —como se hacía— era tirar el mapa de la tabla y dejar el
        //  reparto en manos de la geometría. Se conservan como SEPARADORES:
        //  no entran en el texto ni en `items`, pero parten la fila en campos.
        const sep = !bruto.trim();
        if (sep && !(f.w > 0)) return;
        const pag = f.pagina || 1;
        let g = null;
        for (let i = grupos.length - 1; i >= 0; i--) {
            // 🔴 LA PÁGINA FORMA PARTE DE LA IDENTIDAD DE UNA LÍNEA.
            // Sin comparar `pagina`, la fila que está a y=680 en la página 2
            // se metía dentro de la fila que está a y=680 en la página 1
            // —todo PDF reutiliza las mismas alturas en todas sus hojas— y un
            // calendario de 30 jornadas repartido en 4 hojas se reconstruía
            // como UNA hoja con las cuatro superpuestas: «16:0012:30 Estrella
            // CFAtletico Sur -- UD Rival NorteEstrella CF». De ahí salían tres
            // partidos sueltos en vez de la temporada entera.
            if (grupos[i].pagina !== pag) continue;
            if (Math.abs(grupos[i].y - f.y) <= tol) { g = grupos[i]; break; }
        }
        if (!g) { g = { y: f.y, pagina: pag, todos: [] }; grupos.push(g); }
        g.todos.push({ str: bruto, x: f.x || 0, w: f.w || 0, sep });
    });
    // De arriba abajo: en PDF la y CRECE hacia arriba, así que se ordena al revés.
    grupos.sort((a, b) => (a.pagina - b.pagina) || (b.y - a.y));
    return grupos.map(g => {
        g.todos.sort((p, q) => p.x - q.x);

        // ── Los CAMPOS de la fila ────────────────────────────────────
        //  Cada blanco ancho cierra un campo. Es el reparto que el propio
        //  generador del PDF dejó escrito, y por eso no falla con nombres
        //  largos ni con columnas apretadas: no mide huecos, los LEE.
        const campos = [];
        let actual = [];
        g.todos.forEach(it => {
            if (it.sep) {
                if (it.w >= CAL_SEP_MIN) {
                    if (actual.length) { campos.push(actual.join('').trim()); actual = []; }
                }
                return;
            }
            actual.push(it.str);
        });
        if (actual.length) campos.push(actual.join('').trim());

        // `items` sigue siendo SÓLO lo que tiene tinta: todo lo que ya existía
        // —el reparto por huecos, las calles, el diagnóstico— sigue viendo
        // exactamente lo que veía antes.
        const items = g.todos.filter(it => !it.sep)
                             .map(it => ({ str: it.str, x: it.x, w: it.w }));
        let texto = '';
        items.forEach((it, i) => {
            if (i) {
                const prev = items[i - 1];
                const gap = it.x - (prev.x + (prev.w || 0));
                texto += (gap > 1 ? ' ' : '');
            }
            texto += it.str;
        });
        return { y: g.y, pagina: g.pagina, items, campos: campos.filter(Boolean),
                 texto: texto.replace(/\s+/g, ' ').trim() };
    }).filter(l => l.texto);
}

// ════════════════════════════════════════════════════════════════════
//  🔑🔑 v613 · LA CABECERA DE LA TABLA ES EL MAPA. NO SE ADIVINA: SE LEE.
// ════════════════════════════════════════════════════════════════════
//  Medido sobre el calendario oficial del Juvenil del Estrella CF (Fútbol Las
//  Palmas, 2 páginas, 30 jornadas). Su fila 9 dice, literalmente:
//
//      ["JOR", "FECHA", "HORA", "LOCAL", "VISITANTE", "ESTADIO"]
//
//  y las treinta filas siguientes traen exactamente seis campos:
//
//      ["1", "11-09-2026", "21:00:00", "La Garita", "Estrella CF", "Las Remudas"]
//
//  El documento DICE cuál es la columna del local y cuál la del visitante. Con
//  eso, la localía deja de ser una deducción —"¿a qué lado del guion salgo?"—
//  y pasa a ser un dato leído. Y desaparecen de golpe los dos errores que
//  ninguna heurística de geometría iba a resolver bien:
//
//   🔴 «La Oliva» es a la vez EQUIPO y ESTADIO en la jornada 3, y «La Garita»
//      es equipo en la 1 y en la 16. Sin saber qué columna es cuál, no hay
//      forma de distinguir el rival de la instalación: la v613 heurística
//      llegó a guardar «Las Remudas» —un campo— como rival.
//   🔴 Y el número de jornada («1», «11», «19») quedaba a la izquierda del
//      hueco más ancho de la fila, así que el motor lo tomaba por un equipo.
//      De ahí salían los rivales llamados "11", "19" y "26" que reportó el
//      autor: no eran tres partidos, eran tres números de jornada.
//
//  ⚠️ Esto NO sustituye al motor heurístico, lo precede. Un calendario pegado
//  a mano, o un PDF sin fila de cabecera, sigue yendo por el camino de antes.
// ════════════════════════════════════════════════════════════════════

// Anchura mínima de un blanco para que cuente como separación de columna.
const CAL_SEP_MIN = 3;

// Cómo llama cada federación a cada columna. Ampliar esto es todo el
// "soporte" que necesita un formato nuevo con cabecera.
const CAL_ETIQUETAS = {
    jornada:   ['JOR', 'JORN', 'JORNADA', 'JDA', 'J'],
    fecha:     ['FECHA', 'DIA', 'DATA', 'DATE', 'FECHA PARTIDO'],
    hora:      ['HORA', 'HORARIO', 'HORAS', 'HORA PARTIDO'],
    local:     ['LOCAL', 'EQUIPO LOCAL', 'CASA', 'EQUIPO CASA', 'EQUIP LOCAL', 'ETXEA'],
    visitante: ['VISITANTE', 'EQUIPO VISITANTE', 'VISITANT', 'FUERA', 'EQUIPO FUERA', 'KANPOA'],
    sede:      ['ESTADIO', 'CAMPO', 'INSTALACION', 'INSTALACIONES', 'SEDE',
                'LUGAR', 'TERRENO', 'TERRENO DE JUEGO', 'CAMP'],

    // 🔑 v655 · COLUMNAS QUE SE RECONOCEN PARA PODER IGNORARLAS.
    //  No aportan ningún dato, pero SÍ tienen que contar como reconocidas:
    //  `mapaDeCabecera` exige que la fila sea CASI TODA etiquetas (60 %), y
    //  la tabla del Portal del Federado trae siete columnas de las que una
    //  —«Resultado»— no se usa. Sin esta lista: 5 de 7 = 71 %… pero con dos
    //  columnas más de las que publican otros portales (Acta, Estado) se cae
    //  por debajo del umbral y la cabecera deja de reconocerse ENTERA. El
    //  precio de no listarlas no es leer mal una columna: es no leer la tabla.
    ignora:    ['RESULTADO', 'RESULTAT', 'EMAITZA', 'ACTA', 'ESTADO', 'ESTAT',
                'OBSERVACIONES', 'GRUPO', 'COMPETICION', 'CATEGORIA', 'TEMPORADA',
                'ARBITRO', 'ARBITROS', 'DELEGADO', 'ACCIONES', 'DETALLE'],
};

function _etiquetaDe(txt) {
    const t = normalizarNombre(txt);
    if (!t) return '';
    for (const clave of Object.keys(CAL_ETIQUETAS)) {
        if (CAL_ETIQUETAS[clave].indexOf(t) >= 0) return clave;
    }
    return '';
}

// Busca la fila que nombra las columnas. Devuelve { idx, n, i } o null.
function mapaDeCabecera(lineas) {
    const ls = lineas || [];
    for (let i = 0; i < ls.length; i++) {
        const campos = ls[i].campos || [];
        if (campos.length < 3) continue;
        const idx = {};
        let reconocidos = 0;
        campos.forEach((c, k) => {
            const e = _etiquetaDe(c);
            if (!e) return;
            // Las columnas ignorables cuentan CADA UNA para el umbral, pero no
            // ocupan ranura: dos «Acta» seguidas siguen siendo dos columnas
            // entendidas, no una entendida y otra desconocida.
            if (e === 'ignora') { reconocidos++; return; }
            if (idx[e] == null) { idx[e] = k; reconocidos++; }
        });
        // 🔑 LOCAL Y VISITANTE SON LA CONDICIÓN. Sin esas dos no hay partido
        // que leer, y una fila con "FECHA" y "HORA" sueltas puede ser
        // cualquier membrete. Además tienen que ser CASI TODA la fila: si de
        // ocho campos sólo dos suenan a etiqueta, esto no es una cabecera.
        if (idx.local == null || idx.visitante == null) continue;
        if (reconocidos < Math.max(3, Math.ceil(campos.length * 0.6))) continue;
        return { idx, n: campos.length, i };
    }
    return null;
}

// ════════════════════════════════════════════════════════════════════
//  🔑🔑 v655 · EL TEXTO PEGADO TAMBIÉN TRAE COLUMNAS. NO SE TIRABAN POR
//  FALTA DE INFORMACIÓN: SE TIRABAN EN LA PUERTA.
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-09-01) + dos capturas: además del
//  PDF oficial de la FIFLP, muchos usuarios traen la tabla web del Portal del
//  Federado —Jornada · Fecha · Hora · Equipo Casa · Equipo Fuera · Campo ·
//  Resultado—, copiada o en captura de pantalla.
//
//  🚨 LO QUE PASABA, MEDIDO sobre cinco jornadas reales de sus capturas:
//
//      pegadas 5 → interpretadas 2 → rivales correctos 0
//      rival «1 JOVERO» · rival «13 ARINAGA, C.D. MAJORERAS»
//      y la jornada 13, que se juega EN CASA, marcada FUERA
//
//  Es decir: no fallaba con un error, fallaba PARECIENDO QUE FUNCIONABA, que
//  es la peor forma de fallar que tiene un importador.
//
//  🔑 Y LA CAUSA NO ERA EL MOTOR. Esta función aplanaba los TABULADORES
//  (`\t` → dos espacios → `\s+` → un espacio) y no construía `campos`. El
//  navegador, al copiar una tabla HTML, separa las celdas justo con eso: con
//  tabuladores. O sea que el mapa de la tabla llegaba entero y se destruía en
//  la primera línea de código, y `mapaDeCabecera` —que existe desde v613 y es
//  EXACTAMENTE el mecanismo que resuelve esto— devolvía null y no se usaba
//  nunca por esta vía. Sin él, el número de jornada suelto («1», «13») se
//  toma por parte del nombre del equipo y el guion pegado de «JOVERO-LAS
//  ROSAS» parte por donde no es.
//
//  Conservar el tabulador es todo lo que hacía falta. Ni un formato nuevo ni
//  un parser nuevo: el mismo camino de cabecera que ya lee el PDF.
// ════════════════════════════════════════════════════════════════════
function lineasDeTexto(txt) {
    const lineas = [];
    String(txt || '').split(/\r?\n/).forEach((cruda, i) => {
        const texto = cruda.replace(/\t/g, '  ').replace(/\s+/g, ' ').trim();
        if (!texto) return;

        // ⚠️ CON TABULADOR NO SE FILTRAN LOS CAMPOS VACÍOS. Una celda vacía
        // ocupa su sitio, y es lo único que mantiene el reparto cuadrado con
        // la cabecera: quitarla correría una columna y el rival pasaría a
        // leerse de la casilla del campo. Con blancos anchos no hay celda
        // vacía que valga —dos columnas vacías son indistinguibles de una—,
        // así que ahí sí se filtran.
        const campos = cruda.indexOf('\t') >= 0
            ? cruda.split('\t').map(c => c.replace(/\s+/g, ' ').trim())
            : cruda.split(/\s{2,}/).map(c => c.replace(/\s+/g, ' ').trim()).filter(Boolean);

        lineas.push({ y: -i, pagina: 1, items: null, texto,
                      campos: campos.length > 1 ? campos : [] });
    });
    return _reagruparCeldasSueltas(lineas);
}

// ── El copiado que baja UNA CELDA POR RENGLÓN ────────────────────────
//  La misma tabla, según de dónde se copie y con qué navegador, puede bajar
//  con las celdas apiladas en vertical en vez de separadas por tabuladores.
//  Entonces cada renglón trae un solo dato («1», «25-09-2026», «20:30»…) y
//  no hay ni una línea que parezca un partido.
//
//  🔑 SE RECONOCE PORQUE LA CABECERA VIENE DESPLEGADA: cuatro o más renglones
//  seguidos que son nombres de columna. Ese número ES el tamaño del ciclo, y
//  con él las celdas de abajo se vuelven a plegar en filas.
//
//  ⚠️ SÓLO SE ACTIVA CON ESA CABECERA, y exige LOCAL y VISITANTE dentro. Sin
//  ella no hay forma de saber cuántas celdas hacen una fila, y plegar por un
//  número inventado no daría cero partidos —eso sería inofensivo—: daría una
//  temporada entera de partidos falsos con pinta de buenos.
function _reagruparCeldasSueltas(lineas) {
    if (!lineas || lineas.length < 8) return lineas;
    // Si ya venía en columnas, aquí no hay nada que hacer.
    if (lineas.some(l => l.campos && l.campos.length > 1)) return lineas;

    let ini = -1, n = 0, mejorIni = -1, mejorN = 0;
    lineas.forEach((l, i) => {
        if (_etiquetaDe(l.texto)) {
            if (ini < 0) { ini = i; n = 0; }
            n++;
            if (n > mejorN) { mejorN = n; mejorIni = ini; }
        } else { ini = -1; n = 0; }
    });
    if (mejorIni < 0 || mejorN < 4) return lineas;

    const cab = lineas.slice(mejorIni, mejorIni + mejorN).map(l => l.texto);
    const et  = cab.map(_etiquetaDe);
    if (et.indexOf('local') < 0 || et.indexOf('visitante') < 0) return lineas;

    const salida = lineas.slice(0, mejorIni);
    salida.push({ y: -mejorIni, pagina: 1, items: null, texto: cab.join('  '), campos: cab });

    const resto = lineas.slice(mejorIni + mejorN);
    for (let i = 0; i + mejorN <= resto.length; i += mejorN) {
        const celdas = resto.slice(i, i + mejorN).map(l => l.texto);
        // ⚠️ EN CUANTO UN BLOQUE NO TRAE FECHA, LA TABLA SE ACABÓ. Lo que
        // viene detrás (paginación, pies, «Mostrando 30 de 30») no son
        // celdas, y seguir plegando desplazaría el ciclo y convertiría todo
        // lo posterior en filas descuadradas.
        if (!celdas.some(c => _buscarFecha(c))) break;
        salida.push({ y: -(mejorIni + mejorN + i), pagina: 1, items: null,
                      texto: celdas.join('  '), campos: celdas });
    }
    return salida;
}

// ════════════════════════════════════════════════════════════════════
//  🔑🔑 v656 · LA CAPTURA DE PANTALLA · DE PALABRAS SUELTAS A TABLA
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-09-01, tras la v655): que la zona de importación
//  acepte la captura de pantalla igual que acepta el PDF. El reconocimiento
//  de la imagen ocurre FUERA de este fichero —aquí no entra ninguna
//  biblioteca, por eso el guard puede ejecutar todo esto en Node—. Lo que
//  llega aquí es lo único que un OCR sabe dar: PALABRAS CON SU CAJA.
//
//  🔑 Y UNA TABLA NO ES UN TEXTO CON ESPACIOS. Si estas palabras se pegan en
//  una cadena, se pierde justo lo que distingue «el rival» de «el campo», y
//  se vuelve al agujero de la v655. Hay que reconstruir las COLUMNAS.
//
//  Se hace en dos tiempos, y el segundo es el que salva la temporada:
//
//   1ª · Reparto por HUECOS: dentro de una línea, un blanco mucho más ancho
//        que un espacio normal es un cambio de columna. Sirve para leer la
//        cabecera, que es corta y va muy separada.
//   2ª · 🔑🔑 REPARTO POR LAS COLUMNAS DE LA CABECERA. Medido sobre la
//        captura real del autor: por huecos entraban 18 de 22 jornadas. Las
//        otras cuatro se caían porque el OCR unía dos celdas o partía una, la
//        fila dejaba de tener siete campos y `_porCabecera` la descartaba SIN
//        DECIR NADA. El número de campos de una fila es inestable en un OCR;
//        la POSICIÓN de cada columna no lo es. Así que la cabecera —que se
//        lee siempre bien porque sus celdas son cortas y están muy
//        separadas— dicta dónde empieza cada columna, y cada palabra cae en
//        la suya por su coordenada. Todas las filas salen con N campos.
//
//  ⚠️ SI NO HAY CABECERA (una captura recortada), se queda el reparto por
//  huecos. Peor, pero es lo que había, y sigue pasando por la tabla de
//  revisión: nada se guarda sin que una persona lo mire.
// ════════════════════════════════════════════════════════════════════

// Cuánto de ancho tiene que ser un blanco, comparado con la altura de la
// letra, para que sea un cambio de columna y no un espacio entre palabras.
const CAL_OCR_HUECO = 0.9;

// `lineas`: [{ palabras: [{ texto, x0, x1, y0, y1 }] }] tal cual las da el OCR.
// Devuelve el MISMO contrato que `agruparEnLineas`: { y, pagina, items,
// campos, texto }, para que de aquí en adelante una captura y un PDF sean
// exactamente lo mismo para el resto del motor.
function lineasDeOCR(lineas, opciones) {
    const o = opciones || {};
    const factor = o.factorHueco == null ? CAL_OCR_HUECO : o.factorHueco;

    // ── Normalización ───────────────────────────────────────────────
    const filas = [];
    (lineas || []).forEach((l, i) => {
        const pal = (l && l.palabras ? l.palabras : [])
            .filter(p => p && String(p.texto || '').trim())
            .map(p => ({ texto: String(p.texto).trim(),
                         x0: +p.x0 || 0, x1: +p.x1 || 0,
                         y0: +p.y0 || 0, y1: +p.y1 || 0 }))
            .sort((a, b) => a.x0 - b.x0);
        if (!pal.length) return;
        const alto = pal.reduce((s, p) => s + Math.max(1, p.y1 - p.y0), 0) / pal.length;
        // ⚠️ EL SIGNO DE LA `y` SE INVIERTE. En una imagen la y crece hacia
        // ABAJO y en un PDF hacia ARRIBA, y el resto del motor está escrito
        // para lo segundo. Sin esto la temporada se lee del revés.
        filas.push({ pal, alto, y: -((pal[0].y0 + pal[0].y1) / 2), orden: i });
    });
    if (!filas.length) return [];

    // ── 1ª · por huecos ─────────────────────────────────────────────
    const porHuecos = (f) => {
        const campos = [];
        let act = null;
        f.pal.forEach((p, k) => {
            const hueco = k ? p.x0 - f.pal[k - 1].x1 : Infinity;
            if (!act || hueco >= Math.max(6, f.alto * factor)) {
                act = { texto: p.texto, x0: p.x0, x1: p.x1 };
                campos.push(act);
            } else {
                act.texto += ' ' + p.texto;
                act.x1 = p.x1;
            }
        });
        return campos;
    };
    filas.forEach(f => { f.campos = porHuecos(f); });

    // ── 2ª · las columnas las dicta la CABECERA ─────────────────────
    const cab = _cabeceraOCR(filas);
    if (!cab) {
        // 🔑 Sin cabecera se usan LAS CALLES de la propia imagen: los huecos
        // verticales que no pisa NINGUNA fila. Es la maquinaria de v613, que
        // ya resolvió esto mismo para el PDF, y aquí hace falta por lo mismo:
        // el reparto por huecos mira una fila suelta y en las filas de nombres
        // largos no encuentra frontera, así que cada fila sale con un número
        // de campos distinto y `_porCabecera` las descarta una a una.
        const provisional = filas.map(f => ({
            y: f.y, pagina: 1,
            items: f.pal.map(p => ({ str: p.texto, x: p.x0, w: Math.max(0, p.x1 - p.x0) })),
            texto: f.pal.map(p => p.texto).join(' '),
        }));
        const modelo = modeloDeColumnas(provisional, o.minCalle);
        const cortes = modelo && modelo[1];
        if (cortes && cortes.length >= 3) {
            filas.forEach(f => { f.campos = _repartirEn(f.pal, cortes); });
        }
    }
    if (cab) {
        // Frontera de cada columna: a mitad de camino entre donde acaba una
        // etiqueta y donde empieza la siguiente. No en el borde de la
        // etiqueta: un número de jornada de dos cifras puede empezar un pelo
        // antes que la palabra «Jornada».
        const cortes = [];
        for (let k = 1; k < cab.campos.length; k++) {
            cortes.push((cab.campos[k - 1].x1 + cab.campos[k].x0) / 2);
        }
        filas.forEach(f => {
            if (f === cab.fila) return;   // la cabecera ya está repartida
            f.campos = _repartirEn(f.pal, cortes);
        });
    }

    // ── Salida, con el contrato de `agruparEnLineas` ────────────────
    return filas.map(f => ({
        y: f.y,
        pagina: 1,
        items: f.pal.map(p => ({ str: p.texto, x: p.x0, w: Math.max(0, p.x1 - p.x0) })),
        // ⚠️ Los campos vacíos se conservan: son los que mantienen el reparto
        // cuadrado con la cabecera. Es la misma razón que en `lineasDeTexto`.
        campos: f.campos.map(c => c.texto.trim()),
        texto: f.pal.map(p => p.texto).join(' ').replace(/\s+/g, ' ').trim(),
    }));
}

// ════════════════════════════════════════════════════════════════════
//  🔑🔑 v656 · LA TABLA QUE NO ENSEÑA SU CABECERA
// ════════════════════════════════════════════════════════════════════
//  Las dos capturas que mandó el autor son las DOS MITADES de la misma tabla,
//  y la segunda empieza en la jornada 8: no tiene fila de cabecera. Medido:
//  por el camino heurístico salían 16 filas de 23, todas en ámbar, con las
//  localías al revés (12 casa / 4 fuera donde es mitad y mitad), «CASA
//  PASTORES, C.F.» convertido en «PASTORES, C.F.» —la palabra CASA se leía
//  como marca de localía— y una fecha en 2020. Inusable.
//
//  🔑 PERO UNA COLUMNA SE DELATA POR LO QUE CONTIENE, no por cómo se llama.
//  La que son todo fechas es la fecha. La que son todo horas, la hora. La de
//  números cortos, la jornada. Y las DOS en las que aparece el propio club
//  son los equipos —porque el dueño del calendario juega todas las jornadas,
//  unas en casa y otras fuera—, con el local a la izquierda del visitante,
//  que es el orden en el que lo publica todo el mundo. Lo que queda es la
//  sede.
//
//  Es el mismo principio que sostiene el fichero entero: reconocer el DATO y
//  no el maquetado. Y sirve igual para un PDF sin cabecera que para media
//  captura de pantalla.
//
//  ⚠️ LAS CONDICIONES SON DURAS A PROPÓSITO, porque esto decide la localía de
//  una temporada entera: hacen falta 4 filas con la misma forma, una columna
//  de fechas, y que el club salga en EXACTAMENTE DOS columnas. Si el recorte
//  pillara sólo partidos en casa, el club saldría en una sola columna, esto
//  devuelve null y se sigue por donde se seguía antes.
// ════════════════════════════════════════════════════════════════════
function cabeceraPorContenido(lineas, misNombres, umbral) {
    const um = umbral == null ? 0.5 : umbral;

    // ── La FORMA de la tabla: el número de campos más repetido ──────
    const cuenta = {};
    (lineas || []).forEach(l => {
        const c = l.campos || [];
        if (c.length >= 4 && c.some(x => _buscarFecha(x))) cuenta[c.length] = (cuenta[c.length] || 0) + 1;
    });
    let n = 0, mejor = 0;
    Object.keys(cuenta).forEach(k => { if (cuenta[k] > mejor) { mejor = cuenta[k]; n = +k; } });
    if (!n || mejor < 4) return null;

    const filas = (lineas || []).filter(l => (l.campos || []).length === n
                                             && l.campos.some(x => _buscarFecha(x)));

    // ── Qué es cada columna, por su contenido ───────────────────────
    const cols = [];
    for (let k = 0; k < n; k++) {
        const celdas = filas.map(f => String(f.campos[k] || '').trim());
        const llenas = celdas.filter(Boolean);
        const frac = (test) => llenas.length ? llenas.filter(test).length / llenas.length : 0;
        cols.push({
            k,
            celdas,
            fecha: frac(c => !!_buscarFecha(c)),
            hora:  frac(c => !!_buscarHora(c)),
            num:   frac(c => /^\d{1,3}$/.test(c)),
            letras: llenas.reduce((s, c) => s + (_sinAcentos(c).match(/[A-Za-z]/g) || []).length, 0)
                    / (llenas.length || 1),
        });
    }
    const idx = {};
    const col = (pred) => cols.filter(c => idx.fecha !== c.k && idx.hora !== c.k && idx.jornada !== c.k)
                              .find(pred);
    const f = col(c => c.fecha >= 0.7);   if (f) idx.fecha = f.k;
    const h = col(c => c.hora  >= 0.7);   if (h) idx.hora = h.k;
    const j = col(c => c.num   >= 0.7);   if (j) idx.jornada = j.k;
    if (idx.fecha == null) return null;   // sin fecha no hay calendario

    // ── Las dos columnas de equipo: donde sale el club ──────────────
    //  ⚠️ La COBERTURA es tan necesaria como las letras. Al repartir por las
    //  calles de una imagen salen columnas de DESBORDE: la que sólo recoge el
    //  «LAS» que se sale de «MAJORERAS-GUAYADEQUE, C.F. LAS» tiene letras de
    //  sobra y aparece en dos filas de veintidós. Sin este filtro esa columna
    //  compite por ser la sede — y se la llevaba.
    const texto = cols.filter(c => c.k !== idx.fecha && c.k !== idx.hora && c.k !== idx.jornada
                                   && c.letras >= 3
                                   && c.celdas.filter(Boolean).length >= filas.length * 0.5);
    if (texto.length < 2) return null;

    // Quién es el club: lo dice el nombre que más se repite entre todas esas
    // columnas —es el único equipo que juega TODAS las jornadas—, y si el
    // usuario tiene un nombre guardado que casa, ese gana.
    const veces = {};
    texto.forEach(c => c.celdas.forEach(t => {
        const kk = normalizarNombre(t);
        if (!kk) return;
        if (!veces[kk]) veces[kk] = { nombre: t, n: 0 };
        veces[kk].n++;
    }));
    let propio = null;
    (misNombres || []).forEach(mio => {
        if (propio) return;
        Object.keys(veces).forEach(kk => {
            if (!propio && parecido(mio, veces[kk].nombre) >= um) propio = veces[kk];
        });
    });
    if (!propio) {
        propio = Object.keys(veces).map(kk => veces[kk]).sort((a, b) => b.n - a.n)[0];
    }
    if (!propio || propio.n < Math.max(3, filas.length * 0.5)) return null;

    // 🔑🔑 Y AQUÍ ESTÁ LA TRAMPA QUE HAY QUE ESQUIVAR, medida en la captura
    //  real: «MUNICIPAL DE ARINAGA» —el CAMPO— se parece a «ARINAGA, C.D.»
    //  tanto como la columna del equipo, porque el club se llama como el
    //  pueblo donde juega. Y aparece en MÁS filas que cualquiera de las dos
    //  columnas de equipo, así que "la columna donde más salgo" elige la sede.
    //
    //  🔑 La propiedad que SÓLO cumplen el local y el visitante: son
    //  COMPLEMENTARIAS. El dueño del calendario juega todas las jornadas y
    //  ninguna contra sí mismo, así que entre esas dos columnas está en TODAS
    //  las filas y en NINGUNA en las dos a la vez. La sede no cumple eso: en
    //  los partidos de casa coincide con el local, y ahí se delata.
    const donde = texto.map(c => ({
        c,
        set: new Set(c.celdas.map((t, i) => (t && parecido(propio.nombre, t) >= um) ? i : -1)
                             .filter(i => i >= 0)),
    }));
    //  ⚠️ Y COMPLEMENTARIAS LO SON DOS PARES, no uno. Medido en la segunda
    //  captura: cuando el club juega en casa su nombre está en la columna del
    //  local Y la sede es su campo; cuando juega fuera, está en la del
    //  visitante y la sede es otra. Así que «visitante + sede» sale tan
    //  complementaria como «local + visitante», y una errata del OCR
    //  («AKINAGA») bastó para que ganara la pareja equivocada: rivales que
    //  eran campos, sedes que eran equipos, y la localía justo al revés — todo
    //  ello marcado en VERDE, que es lo peor que puede pasar aquí.
    //
    //  🔑 Se desempata con dos rasgos que separan un equipo de una
    //  instalación:
    //   1. LAS DOS COLUMNAS DE EQUIPO COMPARTEN VOCABULARIO. En una liga
    //      todos juegan contra todos: el que hoy es local mañana es
    //      visitante, así que los mismos nombres salen en las dos. Los
    //      nombres de los campos no se repiten en la columna de un equipo.
    //   2. Y UNA SEDE SE LLAMA COMO UNA SEDE («Campo Municipal…»), que es lo
    //      que `CAL_SEDE_RE` sabe reconocer desde el primer día.
    const nombres = (c) => new Set(c.celdas.filter(Boolean).map(normalizarNombre).filter(Boolean));
    const pintaDeSede = (c) => {
        const ll = c.celdas.filter(Boolean);
        return ll.length ? ll.filter(t => CAL_SEDE_RE.test(t)).length / ll.length : 0;
    };
    let par = null;
    for (let a = 0; a < donde.length; a++) {
        for (let b = a + 1; b < donde.length; b++) {
            let comunes = 0;
            donde[a].set.forEach(i => { if (donde[b].set.has(i)) comunes++; });
            const union = donde[a].set.size + donde[b].set.size - comunes;
            if (union < filas.length * 0.9) continue;      // no cubren la temporada
            if (comunes > filas.length * 0.05) continue;   // se solapan: una es la sede
            if (!donde[a].set.size || !donde[b].set.size) continue;

            const na = nombres(donde[a].c), nb = nombres(donde[b].c);
            let compartidos = 0;
            na.forEach(t => { if (nb.has(t)) compartidos++; });
            const vocab = compartidos / Math.max(1, Math.min(na.size, nb.size));
            const nota = vocab - pintaDeSede(donde[a].c) - pintaDeSede(donde[b].c);
            if (!par || nota > par.nota + 1e-9) {
                par = { a: donde[a].c, b: donde[b].c, union, nota };
            }
        }
    }
    if (!par) return null;

    idx.local = Math.min(par.a.k, par.b.k);
    idx.visitante = Math.max(par.a.k, par.b.k);

    // La sede es la que queda; si quedan varias, la que MÁS se parece a una:
    // más nombre de instalación y más texto en más filas.
    const resto = texto.filter(c => c.k !== idx.local && c.k !== idx.visitante)
        .sort((x, y) => (pintaDeSede(y) - pintaDeSede(x)) || (y.letras - x.letras));
    if (resto.length) idx.sede = resto[0].k;

    return { idx, n, i: -1, porContenido: true };
}

// Reparte las palabras de una fila entre columnas ya conocidas.
//  ⚠️ Por el CENTRO de la palabra, no por su borde izquierdo: una celda ancha
//  que asome un poco por la izquierda de su columna se iría a la anterior.
//  Y las columnas vacías se devuelven vacías, no se saltan: es lo que
//  mantiene todas las filas con el mismo número de campos, que es justo lo
//  que faltaba cuando se repartía por huecos.
function _repartirEn(palabras, cortes) {
    const cajas = [];
    for (let k = 0; k <= cortes.length; k++) cajas.push(null);
    palabras.forEach(p => {
        const c = (p.x0 + p.x1) / 2;
        let k = 0;
        while (k < cortes.length && c >= cortes[k]) k++;
        if (!cajas[k]) cajas[k] = { texto: p.texto, x0: p.x0, x1: p.x1 };
        else { cajas[k].texto += ' ' + p.texto; cajas[k].x1 = p.x1; }
    });
    return cajas.map(c => c || { texto: '', x0: 0, x1: 0 });
}

// La fila que nombra las columnas, buscada sobre el reparto por huecos.
// 🔑 Se exige LOCAL y VISITANTE, igual que `mapaDeCabecera`: sin esas dos no
// hay partido que leer, y repartir el documento entero por las columnas de un
// membrete cualquiera sería mucho peor que no repartirlo.
function _cabeceraOCR(filas) {
    for (let i = 0; i < filas.length; i++) {
        const c = filas[i].campos;
        if (!c || c.length < 3) continue;
        const et = c.map(x => _etiquetaDe(x.texto));
        if (et.indexOf('local') < 0 || et.indexOf('visitante') < 0) continue;
        const reconocidos = et.filter(Boolean).length;
        if (reconocidos < Math.max(3, Math.ceil(c.length * 0.6))) continue;
        return { fila: filas[i], campos: c, i };
    }
    return null;
}

// ════════════════════════════════════════════════════════════════════
//  INTERPRETACIÓN
// ════════════════════════════════════════════════════════════════════
//  Dos pasadas, y la segunda es la que salva medio catálogo de formatos:
//
//   1ª · Cada línea se descompone en lo que se le encuentre: jornada,
//        fecha, hora, y —si los hay— DOS equipos.
//   2ª · Se recorre de arriba abajo ARRASTRANDO la última jornada y la
//        última fecha vistas. 🔑 Porque hay dos familias de calendario:
//        los que ponen la fecha en cada fila, y los que la ponen en una
//        CABECERA ("JORNADA 3 · 27/09/2026") y debajo listan los partidos
//        sin repetirla. Sin el arrastre, la segunda familia se interpreta
//        como cero partidos y el usuario ve una tabla vacía sin saber por qué.
// ════════════════════════════════════════════════════════════════════
function interpretar(lineas, ctx) {
    const o = ctx || {};
    const inicioTemporada = o.inicioTemporada != null ? o.inicioTemporada : temporadaDe(new Date());
    const misNombres = (o.misNombres || []).filter(Boolean);
    const umbral = o.umbral == null ? 0.5 : o.umbral;

    // 🔑🔑 v613 · Las columnas se miden UNA VEZ, sobre el documento entero,
    // antes de tocar ninguna línea. Ver `modeloDeColumnas`: una columna no se
    // ve en una fila suelta, se ve en la página.
    const modelo = modeloDeColumnas(lineas, o.minCalle);

    // 🔑🔑 Y ANTES QUE NADA, LA CABECERA. Si el documento dice cuál es la
    // columna del local y cuál la del visitante, no hay nada que deducir.
    const cab = o.sinCabecera ? null : mapaDeCabecera(lineas);
    if (cab) {
        const r = _porCabecera(lineas, cab, misNombres, umbral, inicioTemporada);
        if (r) return r;
    }

    // 🔑🔑 v656 · Y SI NO HAY FILA DE CABECERA, se deduce por el CONTENIDO de
    // las columnas. Es lo que salva media captura de pantalla —la segunda
    // mitad de una tabla no repite los rótulos— y cualquier PDF que empiece
    // en la jornada 8. Ver `cabeceraPorContenido`: sus condiciones son duras,
    // y cuando no se cumplen esto devuelve null y no cambia nada.
    if (!cab && !o.sinCabecera) {
        const cc = cabeceraPorContenido(lineas, misNombres, umbral);
        if (cc) {
            const r = _porCabecera(lineas, cc, misNombres, umbral, inicioTemporada);
            if (r) return r;
        }
    }

    // ── 1ª pasada ───────────────────────────────────────────────────
    const crudas = (lineas || []).map(l => {
        let t = l.texto;
        const j = _buscarJornada(t);       if (j) t = _quitar(t, j);
        const f = _buscarFecha(t);         if (f) t = _quitar(t, f);
        const h = _buscarHora(t);          if (h) t = _quitar(t, h);
        const loc = _buscarLocalia(t);
        // La sede se aparta AQUÍ, antes de buscar equipos: si no, el nombre de
        // la instalación acaba pegado al del rival.
        const rec = _recortarSede(t);
        const sedeLinea = rec.sede;
        const resto = _limpiarResto(_quitarLocalia(rec.texto));

        let par = _partirEnDos(resto);
        if (!par && l.items) {
            // Se reintenta por columnas, pero sólo con los fragmentos que
            // no eran la fecha ni la hora: si no, el hueco más ancho sería
            // el de la columna de fechas y partiría por donde no es.
            //
            // 🔑 Y LA SEDE TAMBIÉN SE QUITA AQUÍ. La vía de TEXTO ya la
            // aparta (`_recortarSede`, arriba), pero la vía de COLUMNAS no lo
            // hacía: en la tabla típica de una federación —CAMPO | HORA |
            // LOCAL | VISITANTE— el hueco más ancho de la fila es el que
            // separa el nombre del campo del primer equipo, así que el motor
            // partía por ahí y concluía que el rival era «Ciudad Deportiva
            // Sur». Un nombre de instalación acababa en la casilla del
            // cuadrante que ven todos los entrenadores.
            const consumido = [j, f, h].filter(Boolean).map(x => x.txt);
            const trozosSede = sedeLinea
                ? sedeLinea.split(/\s+/).filter(t => t.length >= 3) : [];
            const utiles = l.items.filter(it => {
                const s = String(it.str);
                if (consumido.some(c => c && s.indexOf(c) >= 0)) return false;
                // Un fragmento es sede si TODO lo que dice está dentro de la
                // sede que ya se recortó del texto. Comparar por "contiene"
                // en un solo sentido borraría equipos con una palabra común.
                if (trozosSede.length) {
                    const pal = s.split(/\s+/).filter(t => t.length >= 3);
                    if (pal.length && pal.every(t => trozosSede.indexOf(t) >= 0)) return false;
                }
                return !CAL_SEDE_RE.test(s);
            });
            // 🔑 EL MODELO DE COLUMNAS DE LA PÁGINA VA PRIMERO. Mirar el hueco
            // más ancho de UNA fila suelta es una lotería: en las filas donde
            // los dos nombres son largos no hay hueco que supere el umbral y
            // la fila se cae entera. Las calles de la tabla, en cambio, están
            // en el mismo sitio en las treinta jornadas.
            par = partirPorModelo(utiles, modelo[l.pagina || 1]) || _partirPorColumnas(utiles);
        }
        return { linea: l, jornada: j ? j.jornada : null, fecha: f, hora: h ? h.hora : '',
                 localia: loc, par, resto, sedeLinea, texto: l.texto };
    });

    // ── Quién soy yo ────────────────────────────────────────────────
    const cand = _candidatos(crudas);
    let propio = _elegirPropio(cand, misNombres, umbral);

    // ── 2ª pasada ───────────────────────────────────────────────────
    const filas = [];
    let jornadaAct = null, fechaAct = null, sinFecha = 0, sinPar = 0;

    crudas.forEach(c => {
        if (c.jornada != null) jornadaAct = c.jornada;
        if (c.fecha) {
            const a = c.fecha.a != null ? c.fecha.a : anioDeTemporada(c.fecha.m, inicioTemporada);
            fechaAct = _fechaValida(a, c.fecha.m, c.fecha.d) ? _clave(a, c.fecha.m, c.fecha.d) : null;
        }
        // Sin dos equipos no es un partido: es una cabecera, y su fecha y su
        // jornada ya se han guardado arriba para las filas que vengan.
        if (!c.par) {
            // Salvo el caso del calendario de UN equipo: "J1 13/09 10:00 Rival (Fuera)".
            // Ahí no hay par porque el club no se repite; el resto ES el rival.
            if (fechaAct && c.localia && c.resto && c.resto.length >= 3) {
                const p = _separarSede(c.resto);
                filas.push(_fila({ jornada: jornadaAct, fecha: fechaAct, hora: c.hora,
                    rival: p.rival, local: c.localia.local,
                    sede: p.sede || c.sedeLinea, origen: c.texto }));
                return;
            }
            // 🔴 EL AGUJERO QUE SE TRAGABA LA TEMPORADA, Y EN SILENCIO.
            //  Una línea que trae hora o fecha y texto detrás es una FILA DE
            //  PARTIDO. Si no se ha conseguido partir en dos equipos, no es una
            //  cabecera: es un partido que se está perdiendo. Se caía aquí sin
            //  contarse en ningún sitio —ni en `ajenas`, ni en `sinFecha`— así
            //  que la pantalla podía enseñar tres partidos de treinta sin una
            //  sola pista de dónde estaban los otros veintisiete.
            if ((c.fecha || c.hora) && c.resto && c.resto.length >= 5) sinPar++;
            return;
        }
        // ⚠️ UN PAR DE EQUIPOS SIN NINGUNA FECHA NO SE PUEDE COLOCAR, pero
        // tampoco puede desaparecer en silencio: si el documento trae las
        // fechas de una forma que este motor no reconoce, el usuario ve una
        // tabla con tres partidos y no tiene NI UNA PISTA de que se han caído
        // otros ciento treinta. Se cuentan y la pantalla lo dice.
        if (!fechaAct) { sinFecha++; return; }

        const [izq, der] = c.par;
        let rival = '', local = null, ajeno = false;
        if (propio.nombre) {
            const pi = parecido(propio.nombre, izq), pd = parecido(propio.nombre, der);
            if (pi >= umbral || pd >= umbral) {
                if (pi >= pd) { rival = der; local = true; }
                else          { rival = izq; local = false; }
            }
        }
        if (!rival) {
            // ⚠️ AQUÍ SE DECIDE ALGO QUE NO ES OBVIO. Muchas federaciones no
            // publican el calendario de TU equipo: publican el del GRUPO
            // entero, con los partidos de los ocho equipos. Las líneas en las
            // que tú no juegas NO son partidos tuyos, y meterlas en tu
            // calendario llenaría el cuadrante del club de partidos ajenos.
            //
            // Así que si sé quién soy y no estoy en esta línea, la fila se
            // marca AJENA y no entra. Pero se CUENTA y se dice en pantalla:
            // descartar la mitad de un documento sin decirlo sería justo el
            // tipo de silencio que hace desconfiar de una importación.
            rival = der; local = null;
            ajeno = !!propio.nombre;
        }
        if (c.localia) local = c.localia.local;   // si el papel lo dice, manda el papel

        const partes = _separarSede(rival);
        filas.push(_fila({ jornada: jornadaAct, fecha: fechaAct, hora: c.hora,
                           rival: partes.rival, local,
                           sede: partes.sede || c.sedeLinea, origen: c.texto, ajeno }));
    });

    // 🔑 SALVAGUARDA. Si TODAS las filas han salido ajenas, lo que está mal no
    // es el documento: es el nombre con el que creo que juego el club. Antes de
    // enseñar una tabla vacía —que el usuario leería como "este PDF no vale"—
    // se devuelven todas en rojo para que pueda decir quién es.
    const propias = filas.filter(f => !f.ajeno);
    let usadas = filas;
    if (propias.length) usadas = propias;
    else usadas = filas.map(f => { f.ajeno = false; return f; });
    const ajenas = filas.length - usadas.length;
    filas.length = 0;
    usadas.forEach(f => filas.push(f));

    _ordenar(filas);
    _numerarJornadas(filas);
    _coherenciaJornadas(filas);
    filas.forEach(f => { f.confianza = _confianza(f); });

    const resumen = _resumen(filas);
    resumen.ajenas = ajenas;
    resumen.sinFecha = sinFecha;
    resumen.sinPar = sinPar;
    return { filas, propio, candidatos: cand, resumen };
}

// ════════════════════════════════════════════════════════════════════
//  LECTURA POR CABECERA · el camino exacto
// ════════════════════════════════════════════════════════════════════
//  Devuelve el mismo objeto que `interpretar`, o null si la tabla resulta no
//  dar ni un partido —en cuyo caso se sigue por el camino heurístico, porque
//  una cabecera reconocida por error no puede dejar al usuario sin nada.
function _porCabecera(lineas, cab, misNombres, umbral, inicioTemporada) {
    const idx = cab.idx;
    const dato = (campos, clave) =>
        (idx[clave] == null ? '' : String(campos[idx[clave]] == null ? '' : campos[idx[clave]]).trim());

    // Las filas de la tabla: las que tienen tantos campos como la cabecera.
    // La página 2 no repite cabecera y sus filas entran igual, porque lo que
    // las identifica es su FORMA, no su posición.
    const cuerpo = [];
    (lineas || []).forEach((l, i) => {
        if (i === cab.i) return;
        const c = l.campos || [];
        if (c.length !== cab.n) return;
        const eqL = dato(c, 'local'), eqV = dato(c, 'visitante');
        if (!eqL || !eqV) return;
        // La propia cabecera repetida al principio de otra página no es partido.
        if (_etiquetaDe(eqL) || _etiquetaDe(eqV)) return;
        cuerpo.push({ campos: c, texto: l.texto });
    });
    if (!cuerpo.length) return null;

    // ── Quién soy ───────────────────────────────────────────────────
    //  Aquí la brújula es MUCHO más firme que en el camino heurístico: los
    //  equipos vienen ya separados en dos columnas limpias, sin sedes ni
    //  números de jornada mezclados. El que aparece en casi todas las
    //  jornadas es el dueño del calendario.
    const cuenta = {};
    cuerpo.forEach(f => {
        [dato(f.campos, 'local'), dato(f.campos, 'visitante')].forEach(n => {
            const k = normalizarNombre(n);
            if (!k) return;
            if (!cuenta[k]) cuenta[k] = { nombre: n, veces: 0 };
            cuenta[k].veces++;
        });
    });
    const cand = Object.keys(cuenta).map(k => cuenta[k])
        .sort((a, b) => b.veces - a.veces)
        .slice(0, 8)
        .map(c => ({ nombre: c.nombre, veces: c.veces,
                     cobertura: Math.round(100 * c.veces / cuerpo.length) }));
    const propio = _elegirPropio(cand, misNombres, umbral);

    // ── Las filas ───────────────────────────────────────────────────
    const filas = [];
    let ajenas = 0;
    cuerpo.forEach(f => {
        const eqL = dato(f.campos, 'local'), eqV = dato(f.campos, 'visitante');

        let local = null, rival = '';
        if (propio.nombre) {
            const pL = parecido(propio.nombre, eqL), pV = parecido(propio.nombre, eqV);
            if (pL >= umbral || pV >= umbral) {
                if (pL >= pV) { local = true;  rival = eqV; }
                else          { local = false; rival = eqL; }
            }
        }
        if (local === null) {
            // 🔑 Calendario de GRUPO: la fila es de otros dos equipos. No entra
            // —llenaría el cuadrante de partidos ajenos— pero se cuenta y se dice.
            ajenas++;
            return;
        }

        const fTxt = dato(f.campos, 'fecha');
        const fe = _buscarFecha(fTxt);
        let fecha = '';
        if (fe) {
            const a = fe.a != null ? fe.a : anioDeTemporada(fe.m, inicioTemporada);
            if (_fechaValida(a, fe.m, fe.d)) fecha = _clave(a, fe.m, fe.d);
        }
        const hh = _buscarHora(dato(f.campos, 'hora'));
        const jTxt = dato(f.campos, 'jornada');
        const jm = /(\d{1,3})/.exec(jTxt);

        filas.push(_fila({
            jornada: jm ? +jm[1] : null,
            fecha, hora: hh ? hh.hora : '',
            rival,
            local,
            // ⚠️ La sede sale de SU columna, no de adivinar qué sobra en la
            // línea. En este calendario «La Oliva» es equipo y estadio a la
            // vez, y «La Garita» es equipo: sin la columna, imposible.
            sede: dato(f.campos, 'sede'),
            origen: f.texto,
        }));
    });
    if (!filas.length) return null;

    _ordenar(filas);
    _numerarJornadas(filas);
    _coherenciaJornadas(filas);
    filas.forEach(f => { f.confianza = _confianza(f); });

    const resumen = _resumen(filas);
    resumen.ajenas = ajenas;
    resumen.sinFecha = 0;
    resumen.sinPar = 0;
    resumen.porCabecera = true;
    return { filas, propio, candidatos: cand, resumen, cabecera: cab };
}

// Un nombre de rival puede traer la sede pegada entre paréntesis.
function _separarSede(txt) {
    const limpio = _quitarLocalia(String(txt || '').trim());
    const m = /^(.*?)\s*[([]([^)\]]{3,})[)\]]\s*$/.exec(limpio);
    if (m) return { rival: m[1].trim(), sede: m[2].trim() };
    const rec = _recortarSede(limpio);
    return { rival: rec.texto, sede: rec.sede };
}

function _fila(d) {
    return {
        jornada: d.jornada == null ? null : d.jornada,
        fecha:   d.fecha || '',
        hora:    d.hora || '',
        rival:   _limpiarResto(d.rival),
        local:   d.local,          // true | false | null (sin determinar)
        sede:    _limpiarResto(d.sede),
        origen:  d.origen || '',   // la línea tal cual venía, para que el usuario la vea
        ajeno:   !!d.ajeno,        // partido de otros dos equipos del grupo
        confianza: 'rojo',
    };
}

// ── Quién es el club: la segunda brújula ─────────────────────────────
//  🔑 En el calendario de UN equipo, ese equipo juega TODAS las jornadas: su
//  nombre es el único que aparece en (casi) todas las líneas. Así que si el
//  nombre guardado en la app no casa —porque la federación lo abrevia de otra
//  forma, o porque el club se registró con otro nombre— todavía se puede
//  deducir. Esto es lo que evita tener que preguntar en la mayoría de casos.
function _candidatos(crudas) {
    const cuenta = {};
    let conPar = 0;
    crudas.forEach(c => {
        if (!c.par) return;
        // ⚠️ SÓLO LAS LÍNEAS QUE PARECEN UN PARTIDO. Sin este filtro, el título
        // del documento («MI CALENDARIO - TEMPORADA 2026/27») trae un separador
        // y entra al recuento como si fuera un equipo: en un calendario donde
        // el club no se repite, ese título GANABA la votación y el motor
        // concluía que el club se llamaba "MI CALENDARIO".
        if (!c.fecha && !c.hora) return;
        conPar++;
        const vistos = new Set();
        c.par.forEach(n => {
            const k = normalizarNombre(_separarSede(n).rival);
            if (!k || k.length < 3 || vistos.has(k)) return;
            vistos.add(k);
            if (!cuenta[k]) cuenta[k] = { nombre: _separarSede(n).rival.trim(), veces: 0 };
            cuenta[k].veces++;
        });
    });
    // Nombres parecidos entre sí se suman: "EJEMPLO CD" y "CD EJEMPLO B" son
    // el mismo club escrito de dos formas, y por separado ninguno gana.
    const lista = Object.keys(cuenta).map(k => cuenta[k]);
    lista.forEach(a => {
        a.total = a.veces;
        lista.forEach(b => { if (a !== b && parecido(a.nombre, b.nombre) >= 0.8) a.total += b.veces; });
    });
    lista.sort((a, b) => b.total - a.total);
    return lista.slice(0, 8).map(c => ({ nombre: c.nombre, veces: c.veces,
        cobertura: conPar ? Math.round(100 * c.total / conPar) : 0 }));
}

function _elegirPropio(cand, misNombres, umbral) {
    // 1) El nombre que la app ya conoce, si aparece en el documento.
    for (const mio of misNombres) {
        let mejor = null, mejorP = 0;
        cand.forEach(c => { const p = parecido(mio, c.nombre); if (p > mejorP) { mejorP = p; mejor = c; } });
        if (mejor && mejorP >= umbral) {
            return { nombre: mejor.nombre, via: 'nombre-del-club', seguro: true, cobertura: mejor.cobertura };
        }
    }
    // 2) El que sale en casi todas las jornadas.
    if (cand.length && cand[0].cobertura >= 70) {
        return { nombre: cand[0].nombre, via: 'mas-repetido', seguro: false, cobertura: cand[0].cobertura };
    }
    // 3) No se sabe: hay que preguntar. Nunca inventar.
    return { nombre: '', via: 'sin-determinar', seguro: false, cobertura: 0 };
}

// Reinterpreta con un nombre propio elegido a mano por el usuario, sin
// volver a leer el PDF. Es lo que hace instantáneo "yo soy este de aquí".
function reinterpretarCon(lineas, ctx, nombrePropio) {
    const o = Object.assign({}, ctx || {});
    o.misNombres = [nombrePropio];
    o.umbral = 0.45;
    return interpretar(lineas, o);
}

function _ordenar(filas) {
    filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.hora || '').localeCompare(b.hora || '')));
}

// Si el PDF no traía número de jornada en ninguna parte, se numeran por
// orden de fecha. Es una suposición, y por eso NO sube la confianza.
function _numerarJornadas(filas) {
    if (filas.some(f => f.jornada != null)) return;
    filas.forEach((f, i) => { f.jornada = i + 1; f.jornadaSupuesta = true; });
}

// ════════════════════════════════════════════════════════════════════
//  🚨 v656 · UNA JORNADA QUE NO CUADRA NO PUEDE SALIR EN VERDE
// ════════════════════════════════════════════════════════════════════
//  Medido al leer las capturas del autor con el modelo de OCR ligero: la
//  columna de la jornada es la más estrecha de la tabla y es donde más se
//  equivoca —«12» leído como «1», «22» como «2», «27» como «21»—. Y como
//  `_confianza` sólo miraba que hubiera UN número, esas filas salían en
//  VERDE, que en esta pantalla significa «puedes pasar de largo». Un número
//  de jornada inventado en verde es peor que no leer la fila.
//
//  🔑 PERO LA JORNADA NO ES UN DATO SUELTO: ordenadas por fecha, las jornadas
//  van de una en una. Así que se comprueba si la mayoría encaja en esa
//  progresión y, si encaja, las que se salen ESTÁN MAL — y su valor correcto
//  no hay que adivinarlo, está determinado por su posición.
//
//  ⚠️ Se exige que encaje el 70 % para no tocar nada en los calendarios que
//  legítimamente no van en orden (un extracto, o una jornada aplazada), y lo
//  corregido se marca SUPUESTO: baja a ámbar y el usuario lo mira. Corregir
//  en silencio sería repetir el defecto con otro signo.
// ════════════════════════════════════════════════════════════════════
function _coherenciaJornadas(filas) {
    if (!filas || filas.length < 5) return;
    const conJ = filas.filter(f => f.jornada != null);
    if (conJ.length < 4) return;

    // El desplazamiento entre la posición y el número de jornada, por mayoría:
    // una captura que empieza en la jornada 8 tiene desplazamiento 8.
    const votos = {};
    filas.forEach((f, i) => {
        if (f.jornada == null) return;
        const d = f.jornada - i;
        votos[d] = (votos[d] || 0) + 1;
    });
    let off = null, mejor = 0;
    Object.keys(votos).forEach(d => { if (votos[d] > mejor) { mejor = votos[d]; off = +d; } });
    if (off == null || mejor < filas.length * 0.7) return;

    filas.forEach((f, i) => {
        const debe = i + off;
        if (debe < 1) return;
        if (f.jornada === debe) return;
        // ⛔ Lo que el usuario ha corregido a mano NO se toca. Al fusionar
        // varias capturas esto se recalcula sobre el total, y sin este guard
        // una corrección suya de hace dos minutos se perdería al soltar la
        // siguiente imagen.
        if (f.editada) return;
        f.jornada = debe;
        f.jornadaSupuesta = true;   // → ámbar en `_confianza`
    });
}

// ── La nota de confianza ─────────────────────────────────────────────
//  Es el corazón del trato con el usuario: verde = puedes pasar de largo,
//  amarillo = mírala, rojo = tienes que tocarla. Si esto miente, la tabla de
//  revisión deja de servir y el usuario acaba revisándolo todo o nada.
function _confianza(f) {
    if (!f.fecha || !f.rival || f.local == null) return 'rojo';
    if (!f.hora || !f.jornada || f.jornadaSupuesta) return 'amarillo';
    return 'verde';
}

// ════════════════════════════════════════════════════════════════════
//  🧩 v658 · UNA TEMPORADA REPARTIDA EN VARIAS CAPTURAS
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-09-02): treinta jornadas no caben en una captura
//  de pantalla, así que hay que poder soltar dos o tres seguidas y que se
//  vayan SUMANDO, no pisando. Y sus propias capturas se SOLAPAN —la 9809
//  llega a la jornada 22 y la 9810 empieza en la 8—, así que fusionar es
//  algo más que concatenar.
//
//  🔑 LA CLAVE DE FUSIÓN ES LA FECHA, no el número de jornada. Un equipo
//  juega un partido por fecha, y la fecha es el dato que mejor lee un OCR
//  (formato fijo, dos separadores). El número de jornada es justo el que peor
//  se lee —es la columna más estrecha, ver `_coherenciaJornadas`—, así que
//  usarlo de clave uniría por error dos partidos distintos.
//
//  Y CUANDO LA MISMA FECHA VIENE DOS VECES, manda:
//   1. Lo que el usuario haya TOCADO A MANO. Nunca se pisa una corrección
//      suya con una lectura automática; sería el peor fallo posible aquí.
//   2. Si no, la lectura con MEJOR NOTA. Dos capturas de la misma tabla no
//      se leen igual de bien: en el borde de la imagen una fila sale
//      recortada y en la otra entera. Quedarse siempre con la primera
//      desperdiciaría la buena.
// ════════════════════════════════════════════════════════════════════
const CAL_NOTA = { verde: 3, amarillo: 2, rojo: 1 };

function fusionarFilas(base, nuevas) {
    const salida = (base || []).slice();
    const porFecha = {};
    salida.forEach((f, i) => { if (f.fecha) porFecha[f.fecha] = i; });

    let anadidas = 0, mejoradas = 0, repetidas = 0;
    (nuevas || []).forEach(nf => {
        // Sin fecha no hay con qué casarla: entra y se queda en rojo, que es
        // lo que ya dice de ella su nota de confianza.
        if (!nf.fecha || porFecha[nf.fecha] == null) {
            if (nf.fecha) porFecha[nf.fecha] = salida.length;
            salida.push(nf);
            anadidas++;
            return;
        }
        const i = porFecha[nf.fecha];
        const vieja = salida[i];
        if (!vieja || vieja.editada) { repetidas++; return; }
        const notaV = CAL_NOTA[vieja && vieja.confianza] || 0;
        const notaN = CAL_NOTA[nf.confianza] || 0;
        if (notaN > notaV) { salida[i] = nf; mejoradas++; }
        else repetidas++;
    });

    _ordenar(salida);
    // ⚠️ Y LA COHERENCIA SE RECALCULA SOBRE EL TOTAL, no sobre cada captura.
    // Es lo que hace que al unir las dos mitades las jornadas cuadren de 1 a
    // 30 aunque en cada trozo por separado no hubiera datos para decidirlo.
    _coherenciaJornadas(salida);
    salida.forEach(f => { if (!f.editada) f.confianza = _confianza(f); });

    return { filas: salida, anadidas, mejoradas, repetidas };
}

function _resumen(filas) {
    const r = { total: filas.length, verde: 0, amarillo: 0, rojo: 0, casa: 0, fuera: 0, sinHora: 0 };
    filas.forEach(f => {
        r[f.confianza]++;
        if (f.local === true) r.casa++;
        else if (f.local === false) r.fuera++;
        if (!f.hora) r.sinHora++;
    });
    return r;
}

// ════════════════════════════════════════════════════════════════════
//  🧠 HUELLA Y PERFIL DE FEDERACIÓN
// ════════════════════════════════════════════════════════════════════
//  Lo que hace que el sistema mejore con el uso en vez de con mi trabajo.
//
//  Cada corrección que hace el usuario en la tabla se destila en un PERFIL
//  (cómo se llama su equipo en ese documento, sobre todo), guardado junto a
//  una HUELLA del PDF: quién lo generó —los PDF llevan esa metadata— y cómo
//  es su cabecera. El siguiente PDF de la misma federación trae la misma
//  huella, se reconoce, y sale interpretado ya calibrado.
//
//  ⚠️ La huella NO puede llevar la fecha ni el año: cambiarían en cada
//  temporada y el perfil aprendido no volvería a encontrarse nunca.
// ════════════════════════════════════════════════════════════════════
function huellaDe(meta, lineas) {
    const m = meta || {};
    const cabecera = (lineas || []).slice(0, 6)
        .map(l => normalizarNombre(l.texto).replace(/\d+/g, '#'))
        .join(' ~ ').slice(0, 160);
    const base = [
        normalizarNombre(m.producer || ''),
        normalizarNombre(m.creator || ''),
        cabecera,
    ].join('|');
    return 'h' + _hash(base);
}

function _hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
}

// El perfil que se guarda tras una importación confirmada.
function perfilDesde(res, correcciones) {
    return {
        nombrePropio: (res && res.propio && res.propio.nombre) || '',
        via: (res && res.propio && res.propio.via) || '',
        correcciones: correcciones || 0,
        usos: 1,
        actualizado: new Date().toISOString(),
    };
}

const API = {
    // texto
    normalizarNombre, parecido,
    // fechas
    anioDeTemporada, temporadaDe,
    // líneas
    agruparEnLineas, lineasDeTexto,
    // motor
    interpretar, reinterpretarCon,
    // perfiles
    huellaDe, perfilDesde,
    // columnas de la tabla
    modeloDeColumnas, partirPorModelo, mapaDeCabecera,
    // captura de pantalla (las palabras las trae el OCR, que vive fuera)
    lineasDeOCR, cabeceraPorContenido,
    // varias capturas para una misma temporada
    fusionarFilas,
    // internos expuestos sólo para el guard
    _buscarFecha, _buscarHora, _buscarJornada, _partirEnDos, _partirPorColumnas, _callesDe,
};

glob.CalParser = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
