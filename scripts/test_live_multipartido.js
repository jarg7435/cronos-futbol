// ─────────────────────────────────────────────────────────────────────────
// test_live_multipartido.js · varios partidos a la vez, y ninguna pantalla
// muda (v455)
//
// Tres incidencias reales de las pruebas con dos partidos en curso (F7 y
// Juvenil):
//
//  A · LAS TARJETAS BAILABAN. La lista se ordenaba por `updatedAt`
//      descendente, y `pushLiveSnapshot` reescribe ese campo CADA 5 SEGUNDOS
//      en todos los partidos activos: el que acababa de latir saltaba al
//      primer puesto. Con dos partidos era imposible pulsar el que uno quería.
//      El documento NO guarda hora de inicio, así que el orden se construye
//      con datos que no cambian durante el partido.
//
//  B · LOS AVISOS SE QUEDABAN ENGANCHADOS AL ÚLTIMO PARTIDO ABIERTO. El
//      watcher de fondo hacía `if (m.id !== currentMatchId) return;` (v274).
//      Aquello arregló un problema real —los sucesos de un partido se colaban
//      en el CAJÓN de otro— pero cortando por lo sano: dejó de procesar los
//      demás partidos, así que un gol en el otro campo NO se anunciaba nunca.
//      🔑 La separación correcta es POR DESTINO, no "procesar o no procesar":
//      el aviso flotante es GLOBAL (y desde v449 dice de qué partido es), y el
//      cajón de historial es del partido que se está viendo.
//
//  C · PANTALLA EN NEGRO EN EL MÓVIL. `checkUserAccess` escribía su error en
//      `#auth-error`… que vive DENTRO de `#auth-overlay`, y ese overlay estaba
//      en `display:none`. Como la pantalla de arranque ya se había ocultado
//      incondicionalmente y el resto de vistas siguen ocultas hasta conceder
//      el acceso, cualquier fallo dejaba la página COMPLETAMENTE NEGRA, sin
//      mensaje y sin salida. En el iPad la lectura iba bien y no se veía.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
// ⚠️ Líneas primero, bloques después (lección de v453).
const sinCom = (t) => t
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

function extractFn(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('No encontrada: ' + name);
    let i = src.indexOf('{', start), depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return src.slice(start, i);
}

console.log('── varios partidos a la vez, y ninguna pantalla muda (v455) ──\n');

// ═══════════ PARTE 1 · [A] el orden no puede bailar ═══════════
console.log('── PARTE 1 · [A] la lista se queda quieta ──');
{
    const sb = { console: { log() {}, warn() {} }, String, Array, Object, Math, JSON };
    vm.createContext(sb);
    vm.runInContext(extractFn(LIVE, '_ordenEstablePartidos') +
                    '\n;globalThis.ord = _ordenEstablePartidos;', sb);
    const ord = sb.ord;

    // Dos partidos como los del reporte: un F7 y un Juvenil.
    const f7  = { id: 'm-f7',  category: 'Alevín',  subcategory: 'A', mode: 'f7',
                  homeTeam: { name: 'ARINAGA 7' }, updatedAt: { toMillis: () => 1000 } };
    const juv = { id: 'm-juv', category: 'Juvenil', subcategory: 'A', mode: 'f11',
                  homeTeam: { name: 'ARINAGA 11' }, updatedAt: { toMillis: () => 2000 } };

    const orden1 = [f7, juv].slice().sort(ord).map(m => m.id);
    // Ahora late el otro: `updatedAt` se invierte por completo…
    f7.updatedAt  = { toMillis: () => 9000 };
    juv.updatedAt = { toMillis: () => 8000 };
    const orden2 = [juv, f7].slice().sort(ord).map(m => m.id);

    ok('1a · 🔑 [A] el orden NO cambia aunque cambie `updatedAt`',
       orden1.join(',') === orden2.join(','),
       'antes: ' + orden1 + ' · después: ' + orden2);
    ok('1b · y tampoco depende del orden de llegada',
       [juv, f7].slice().sort(ord).map(m => m.id).join(',') ===
       [f7, juv].slice().sort(ord).map(m => m.id).join(','));

    // Orden TOTAL: dos partidos idénticos salvo el id no pueden empatar.
    const g1 = { id: 'aaa', category: 'X', subcategory: 'A', mode: 'f7', homeTeam: { name: 'EQ' } };
    const g2 = { id: 'bbb', category: 'X', subcategory: 'A', mode: 'f7', homeTeam: { name: 'EQ' } };
    ok('1c · el `id` cierra el orden (sin empates, o volverían a bailar)',
       ord(g1, g2) < 0 && ord(g2, g1) > 0);
    ok('1d · agrupa por categoría, que es como los mira un director',
       ord({ category: 'Alevín' }, { category: 'Juvenil' }) < 0);
    ok('1e · documentos incompletos no rompen la ordenación',
       typeof ord({}, {}) === 'number' && ord({}, {}) === 0);

    const S = sinCom(LIVE);
    ok('1f · 🔑 [A] ya no queda ninguna ordenación por `updatedAt`',
       !/sort\(\(a,\s*b\)\s*=>\s*\(b\.updatedAt/.test(S),
       'ese campo lo reescribe el latido de 5 s');
    ok('1g · las dos listas usan el orden estable',
       (S.match(/_ordenEstablePartidos/g) || []).length >= 3,
       'la del listado en vivo y la del historial');
}

// ═══════════ PARTE 2 · [B] avisos globales, cajón del partido ═══════════
console.log('\n── PARTE 2 · [B] los avisos de TODOS los partidos ──');

// v558 · Las dos funciones que deciden si un aviso puede sonarme, tal cual
// están en live.html (van juntas, hasta el comentario de showEventToast).
function _puertaAvisos(src) {
    const ini = src.indexOf('function _soyDestinatarioDe(m) {');
    const fin = src.indexOf('// v455 · `matchId` (6º argumento) es el partido AL QUE PERTENECE el suceso.');
    if (ini < 0 || fin < 0 || fin < ini) {
        throw new Error('No se pudo extraer la puerta de avisos (_puedeAvisarme) de live.html');
    }
    return src.slice(ini, fin);
}

// `enListado` distingue las DOS pantallas, que es lo que decide el destino:
// el listado de Partidos en Vivo o el detalle de un partido concreto.
function pintar(matchId, currentMatchId, enListado, quien) {
    const nodos = [];
    const nuevo = (tag) => {
        const n = { tag, innerHTML: '', className: '', children: [], style: {},
                    appendChild(c) { this.children.push(c); }, remove() {},
                    get firstChild() { return this.children[0]; } };
        n.classList = { add: () => {}, remove: () => {} };
        nodos.push(n); return n;
    };
    const stack = nuevo('div');
    const reg = { historial: [] };
    const sb = {
        console: { log() {}, warn() {} }, Date, Math, JSON, String, Object, Array, RegExp,
        setTimeout: () => 0,
        document: { createElement: nuevo,
                    getElementById: (id) => (id === 'event-toast-stack' ? stack : null) },
        EVENT_META: { goal: { icon: '⚽', cls: 'ev-goal', title: 'GOL', flash: '#3fb950' } },
        lastSnapshot: { homeTeam: { name: 'PARTIDO VISIBLE' }, awayTeam: { name: 'RIVAL' } },
        currentMatchId: currentMatchId,
        escapeHtml: (s) => String(s == null ? '' : s),
        _equipoDeSuceso: () => 'EQUIPO-DEDUCIDO',
        _chipEquipoHtml: (eq) => (eq ? '<span class="chip">' + eq + '</span>' : ''),
        _sinPrefijoEquipo: (t) => t,
        _posicionaAvisos: () => {},
        _appendEventToHistoryPanel: (type, line) => { reg.historial.push(type + '|' + line); },
        _alertsMuted: true, vibrate: () => {}, playEventSound: () => {},
        // v558 · el contexto que necesita la puerta `_puedeAvisarme`. Los dos
        // partidos son del MISMO club, que es el caso del reporte.
        userData: quien || { uid: 'uid-dir', email: 'dir@x.com',
                             role: 'director', clubId: 'cd-dia' },
        _matchLastData: {
            'm-f7':      { id: 'm-f7',      clubId: 'cd-dia', createdBy: 'uid-ana',  coachEmail: 'ana@x.com' },
            'm-juvenil': { id: 'm-juvenil', clubId: 'cd-dia', createdBy: 'uid-luis', coachEmail: 'luis@x.com' },
        },
        _avisosEnListado: () => !!enListado,
        // v466 · en el listado el aviso va a la pila DE SU TARJETA. Aquí se
        // devuelve la misma pila para poder contarlos igual en las dos
        // pantallas; dónde se coloca lo mide test_avisos_pila_scroll.js.
        _avisoPilaDe: () => stack,
        _avisoColocaPronto: () => {},
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(_puertaAvisos(LIVE) + '\n' +
                    extractFn(LIVE, '_etiquetaPartidoDe') + '\n' +
                    extractFn(LIVE, 'showEventToast'), sb);
    vm.runInContext('showEventToast("goal", "GOL · Pedro", "ARINAGA 7 vs VISITANTE", "1T 20:00", "ARINAGA 7", ' +
                    JSON.stringify(matchId) + ')', sb);
    return { avisos: stack.children.length,
             html: stack.children.length ? stack.children[0].innerHTML : '',
             historial: reg.historial };
}

{
    // ══════════════════════════════════════════════════════════════════
    //  ⚠️ v558 REVISA ESTA PARTE, Y HAY QUE LEER POR QUÉ ANTES DE TOCARLA.
    //
    //  v455 hizo el aviso flotante GLOBAL: se emitía para cualquier partido
    //  seguido, estuvieras donde estuvieras. Arreglaba una queja REAL —el aviso
    //  quedaba enganchado al último partido abierto y un gol en otro campo no
    //  se anunciaba jamás—, pero se pasó de ancho.
    //
    //  Reporte del autor con 7 partidos a la vez (captura 9043): los sucesos
    //  del Alevín C salían CON SONIDO Y PANEL en las pantallas que estaban
    //  viendo el Regional A y el Juvenil B. Su regla: los eventos de un partido
    //  sólo se comunican a los contactos de ESE equipo y a su staff técnico
    //  (director deportivo y coordinador); jamás se cuelan en la pantalla de
    //  otro equipo.
    //
    //  🔑 EL REPARTO QUEDA ASÍ, y las dos mitades importan:
    //    · en el LISTADO  → sigue avisando de TODOS los partidos de los que uno
    //      es destinatario, cada aviso en la pila de SU tarjeta (v466). La
    //      queja de v455 sigue atendida;
    //    · en el DETALLE  → sólo el partido que se está viendo.
    // ══════════════════════════════════════════════════════════════════

    // Suceso de OTRO partido, estando DENTRO del detalle de uno.
    const otro = pintar('m-juvenil', 'm-f7', false);
    ok('2a · 🔑🔑🔑 [B] viendo un partido, un gol de OTRO ya NO interrumpe (captura 9043)',
       otro.avisos === 0, 'avisos: ' + otro.avisos);
    ok('2b · 🔑 [B] …y sigue sin colarse en el cajón del partido que se está viendo',
       otro.historial.length === 0,
       'era el defecto real que v274 vino a tapar · ' + JSON.stringify(otro.historial));

    // ⚠️ Y EN EL LISTADO SÍ: es la mitad de v455 que NO se revierte.
    const enLista = pintar('m-juvenil', null, true);
    ok('2c · ⚠️ [B] en el LISTADO el director sí se entera del gol del otro partido (v455)',
       enLista.avisos === 1, 'avisos: ' + enLista.avisos);
    ok('2c-bis · y el aviso dice de qué partido es',
       /ARINAGA 7 vs VISITANTE/.test(enLista.html), enLista.html);

    // Suceso del partido VISIBLE.
    const propio = pintar('m-f7', 'm-f7', false);
    ok('2d · un gol del partido visible genera aviso…', propio.avisos === 1);
    ok('2e · …y SÍ escribe en su cajón', propio.historial.length === 1,
       JSON.stringify(propio.historial));

    // Llamada antigua sin matchId: se comporta como antes (partido visible).
    const sinId = pintar(undefined, 'm-f7', false);
    ok('2f · sin `matchId` se asume el partido visible (compatibilidad)',
       sinId.avisos === 1 && sinId.historial.length === 1);

    const S = sinCom(LIVE);
    ok('2g · 🔑 [B] el watcher de fondo ya NO descarta los demás partidos',
       !/if\s*\(\s*m\.id\s*!==\s*currentMatchId\s*\)\s*return;/.test(S),
       'ese `return` es lo que dejaba los avisos pegados al último partido abierto');
    // ⚠️ Se comprueban las LLAMADAS una a una, no un conteo con umbral: con un
    // `>= 7` se colaba quitarle el matchId a una de las ocho, y además el
    // recuento incluía la propia DEFINICIÓN de la función. Lo cazó el red-check.
    const _llamadas = (S.match(/showEventToast\([^;]*?\)\s*;/g) || []);
    const _sinId = _llamadas.filter(l => l.indexOf('matchId') === -1);
    ok('2h · TODAS las llamadas pasan el partido del suceso (' + _llamadas.length + ')',
       _llamadas.length >= 8 && _sinId.length === 0,
       'sin el matchId, showEventToast no puede decidir el destino · ' +
       _sinId.map(s => s.slice(0, 60)).join(' | '));
}

// ═══════════ PARTE 3 · [C] ninguna pantalla muda ═══════════
console.log('\n── PARTE 3 · [C] el negro del móvil ──');
{
    const S = sinCom(LIVE);

    ok('3a · 🔑 [C] existe el aviso visible de fallo de acceso',
       /function _mostrarFalloDeAcceso\(/.test(S));
    ok('3b · 🔑 [C] y ENSEÑA el overlay (antes escribía en un elemento oculto)',
       (() => {
           const i = S.indexOf('function _mostrarFalloDeAcceso(');
           const bloque = S.slice(i, i + 900);
           return /auth-overlay/.test(bloque) && /display\s*=\s*'flex'/.test(bloque);
       })(),
       'el mensaje se escribía dentro de #auth-overlay con display:none → negro');
    ok('3c · [C] ofrece salida al usuario (botón de reintentar)',
       /location\.reload\(\)/.test(S.slice(S.indexOf('function _mostrarFalloDeAcceso('),
                                          S.indexOf('function _mostrarFalloDeAcceso(') + 900)));

    ok('3d · [C] el `catch` de checkUserAccess lo usa',
       (() => {
           const i = S.indexOf('async function checkUserAccess');
           if (i === -1) return false;
           const bloque = S.slice(i, S.indexOf('function _mostrarFalloDeAcceso('));
           return /_mostrarFalloDeAcceso\(/.test(bloque);
       })());
    ok('3e · [C] y el observador de sesión también, por si algo se le escapa',
       (() => {
           const i = S.indexOf('onAuthStateChanged(auth, async (user)');
           return i !== -1 && /_mostrarFalloDeAcceso\(/.test(S.slice(i, i + 1200));
       })(),
       'sin ese catch, un rechazo del await volvía a dejar la pantalla muda');

    // ⚠️ Acotado al PROPIO bloque de la red de seguridad: `offsetParent !== null`
    // ya existía en otro sitio de live.html, así que buscarlo en todo el fichero
    // daba verde aunque se hubiera quitado de aquí (lo cazó el red-check).
    ok('3f · 🔑 [C] red de seguridad: si NINGUNA vista está visible, se avisa',
       (() => {
           const i = S.indexOf("['startup-screen', 'auth-overlay'");
           if (i === -1) return false;
           const bloque = S.slice(i, i + 700);
           return /offsetParent !== null/.test(bloque) &&
                  /_mostrarFalloDeAcceso\(/.test(bloque);
       })(),
       'convierte cualquier pantalla en negro en un mensaje con salida');

    // La autocuración de v454 sigue en pie y no se pisa con ésta.
    ok('3g · la autocuración de v454 sigue intacta',
       /_cronosLiveBooted/.test(LIVE) && /cronos_autocura_live/.test(LIVE));
    ok('3h · ⚠️ y sigue actuando UNA sola vez (o sería un bucle de recargas)',
       /sessionStorage\.getItem\(MARCA\)/.test(LIVE));
}

console.log('\n' + '─'.repeat(60));
console.log(`Resultado: ${pass} PASS · ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
