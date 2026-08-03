// ─────────────────────────────────────────────────────────────────────────
// test_live_card_feed.js  ·  mini-feed de sucesos en la tarjeta de cada
// partido en vivo (v432)
//
// Peticion del autor: en la pantalla de "Partidos en Vivo", el Director
// Deportivo tiene que ver de un vistazo que esta pasando en cada campo sin
// entrar en VER PARTIDO. Dentro de cada tarjeta, los ULTIMOS 2-3 sucesos con
// su minuto e icono: goles ⚽, amarillas 🟨, rojas 🟥, cambios 🔄 y avisos ⏱️.
//
// ESTE GUARD NO MIRA EL FUENTE: extrae las funciones del feed de live.html y
// las EJECUTA contra partidos fabricados, comprobando el HTML que producen.
//
// LO QUE PROTEGE, y por que cada cosa se rompe sola si nadie la vigila:
//
//  A · EL TIPO ES EL CONTRATO, NO EL TEXTO NI EL ICONO. Cada evento guardado
//      lleva `icon` y `text` ya formateados, pero son PRESENTACION y han
//      cambiado varias veces (los glifos de las sustituciones, tres). En
//      v418-v421 una repeticion se quedo sin cambios por depender del texto,
//      sin ningun error. El icono del feed se deriva de `type`.
//
//  B · `tactical_move` NO SE PINTA. Su `text` es un JSON con las coordenadas
//      del arrastre. Colarlo llena el feed de ruido ilegible y, peor, TAPA los
//      goles: en un partido con arrastres son la mayoria de los eventos.
//
//  C · EL ORDEN ES POR createdAt, NO POR MINUTO NI POR POSICION. Un evento
//      retroactivo se anota AHORA con un minuto ANTIGUO: ordenando por minuto
//      quedaria enterrado justo cuando acaba de registrarse, que es cuando el
//      director quiere verlo.
//
//  D · EL MINUTO DE matchTime YA VIENE ACUMULADO, tambien en la 2a parte. El
//      prefijo 1T/2T es una etiqueta, no un origen de coordenadas. Sumarle la
//      duracion de la primera parte fue el defecto B de v394 en el replay.
//
//  E · NADA DE HTML SIN ESCAPAR. El texto sale de nombres de jugador
//      introducidos a mano por el entrenador.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');

console.log('── mini-feed de sucesos en la tarjeta (v432) ──\n');

// ═══════ Se extrae el bloque del feed y se ejecuta de verdad ═══════
const ini = LIVE.indexOf('const _LIVE_FEED_ICONOS');
const fin = LIVE.indexOf('// ── Show history');
ok('0a · el bloque del feed sigue existiendo en live.html', ini !== -1 && fin > ini);

const sandbox = {
    escapeHtml: (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    console: { log() {}, warn() {} },
};
vm.createContext(sandbox);
vm.runInContext(LIVE.slice(ini, fin) +
    '\n;globalThis.items = _liveFeedItems;' +
    '\n;globalThis.html  = _liveFeedHtml;' +
    '\n;globalThis.minuto= _liveFeedMinuto;' +
    '\n;globalThis.texto = _liveFeedTexto;', sandbox);

const { items, html, minuto, texto } = sandbox;

// Eventos con la forma REAL que escribe js/match/events/player-actions.js.
const ev = (o) => Object.assign({
    eventId: 'ev_' + Math.random().toString(36).slice(2),
    matchId: 'm1', icon: '•', realTime: '20:00:00',
    timestamp: new Date().toISOString(),
}, o);

// ═══════════ PARTE 1 · el minuto ═══════════
console.log('\n── PARTE 1 · el minuto ──');
{
    ok('1a · "1T 10:00" -> 10\'', minuto({ matchTime: '1T 10:00' }) === "10'", minuto({ matchTime: '1T 10:00' }));
    ok('1b · [DEFECTO D] "2T 50:00" -> 50\' (el minuto YA viene acumulado)',
       minuto({ matchTime: '2T 50:00' }) === "50'",
       'sumarle la 1a parte fue el defecto B del replay en v394');
    ok('1c · sin matchTime no revienta ni inventa', minuto({}) === '', JSON.stringify(minuto({})));
    ok('1d · matchTime corrupto tampoco', minuto({ matchTime: 'xxx' }) === '');
}

// ═══════════ PARTE 2 · la descripcion, por campos estructurados ═══════════
console.log('\n── PARTE 2 · la descripcion ──');
{
    ok('2a · [DEFECTO A] la sustitucion usa subOutName/subInName, no el texto',
       texto(ev({ type: 'sub', subOutName: 'Diego', subInName: 'Bruno',
                  text: 'CRONOS | ▲ SALE: Diego | ▼ ENTRA: Bruno' })) === 'Sale Diego · Entra Bruno',
       texto(ev({ type: 'sub', subOutName: 'Diego', subInName: 'Bruno', text: 'x' })));

    ok('2b · y si el evento es ANTIGUO y no los trae, cae al texto sin romperse',
       texto(ev({ type: 'sub', text: 'CRONOS | ▲ SALE: Diego | ▼ ENTRA: Bruno' })).includes('Diego'));

    ok('2c · sub_in usa playerName', texto(ev({ type: 'sub_in', playerName: 'Ana' })) === 'Entra Ana');
    ok('2d · sub_out usa playerName', texto(ev({ type: 'sub_out', playerName: 'Ana' })) === 'Sale Ana');

    // Goles/tarjetas/lesiones NO llevan campo estructurado: el texto es la
    // unica fuente y se recorta por el separador.
    ok('2e · gol · recorta "GOL · Pedro" a "Pedro"',
       texto(ev({ type: 'goal', text: 'GOL · Pedro' })) === 'Pedro');
    ok('2f · amarilla · "TARJETA AMARILLA · Luis" -> "Luis"',
       texto(ev({ type: 'yellow', text: 'TARJETA AMARILLA · Luis' })) === 'Luis');
    ok('2g · roja por doble amarilla conserva el matiz entre parentesis',
       texto(ev({ type: 'red', text: 'TARJETA ROJA · Luis (doble amarilla)' })) === 'Luis (doble amarilla)');
    ok('2h · lesion · "LESIÓN · Ana" -> "Ana"',
       texto(ev({ type: 'injury', text: 'LESIÓN · Ana' })) === 'Ana');
    ok('2i · un texto SIN separador se muestra entero, nunca vacio',
       texto(ev({ type: 'goal', text: 'GOL' })) === 'GOL');
}

// ═══════════ PARTE 3 · que sucesos entran, y en que orden ═══════════
console.log('\n── PARTE 3 · seleccion y orden ──');
{
    const partido = {
        phase: '2nd_half',
        events: [
            ev({ type: 'goal',          text: 'GOL · Pedro',           matchTime: '1T 10:00', createdAt: 1000 }),
            ev({ type: 'tactical_move', text: '{"playerId":3,"x":40}', matchTime: '1T 12:00', createdAt: 2000 }),
            ev({ type: 'yellow',        text: 'TARJETA AMARILLA · Luis', matchTime: '1T 20:00', createdAt: 3000 }),
            ev({ type: 'tactical_move', text: '{"playerId":5,"x":10}', matchTime: '1T 22:00', createdAt: 4000 }),
            ev({ type: 'sub', subOutName: 'Diego', subInName: 'Bruno', text: 'x', matchTime: '2T 35:00', createdAt: 5000 }),
            ev({ type: 'goal',          text: 'GOL · Bruno',           matchTime: '2T 40:00', createdAt: 6000 }),
        ],
    };

    const tres = items(partido, 3);
    ok('3a · devuelve como mucho 3', tres.length === 3, tres.length);
    ok('3b · [DEFECTO B] ningun tactical_move se cuela',
       tres.every(e => e.type !== 'tactical_move'), tres.map(e => e.type).join(','));
    ok('3c · son los mas RECIENTES, y el mas nuevo primero',
       tres.map(e => e.type).join(',') === 'goal,sub,yellow', tres.map(e => e.type).join(','));

    // C · el retroactivo se anota AHORA con minuto ANTIGUO.
    const conRetro = {
        events: partido.events.concat([
            ev({ type: 'red', text: 'TARJETA ROJA · Ana', matchTime: '1T 05:00', createdAt: 9000, isRetroactive: true }),
        ]),
    };
    ok('3d · [DEFECTO C] un evento RETROACTIVO aparece el primero aunque su minuto sea antiguo',
       items(conRetro, 3)[0].type === 'red',
       items(conRetro, 3).map(e => e.type + '@' + e.matchTime).join(' | '));

    // Eventos viejos sin createdAt: se conserva el orden del array.
    const sinTs = { events: [
        ev({ type: 'goal',   text: 'GOL · A' }),
        ev({ type: 'yellow', text: 'TARJETA AMARILLA · B' }),
    ]};
    ok('3e · sin createdAt no se descolocan ni se pierden',
       items(sinTs, 3).length === 2);

    ok('3f · un partido sin eventos devuelve lista vacia, no revienta',
       items({}, 3).length === 0 && items({ events: null }, 3).length === 0);
}

// ═══════════ PARTE 4 · el HTML de la tarjeta ═══════════
console.log('\n── PARTE 4 · el bloque pintado ──');
{
    const h = html({
        phase: '2nd_half',
        events: [
            ev({ type: 'goal',   text: 'GOL · Pedro',             matchTime: '2T 40:00', createdAt: 3000 }),
            ev({ type: 'yellow', text: 'TARJETA AMARILLA · Luis', matchTime: '1T 20:00', createdAt: 2000 }),
            ev({ type: 'red',    text: 'TARJETA ROJA · Ana',      matchTime: '1T 22:00', createdAt: 1000 }),
        ],
    });

    ok('4a · se pinta el contenedor del feed', /class="live-feed"/.test(h));
    ok('4b · lleva encabezado', /ÚLTIMOS SUCESOS/.test(h));
    ok('4c · exactamente 3 filas', (h.match(/class="live-feed-fila"/g) || []).length === 3);
    ok('4d · [DEFECTO A] el icono sale del TIPO', h.includes('⚽') && h.includes('🟨') && h.includes('🟥'));
    ok('4e · cada fila lleva su minuto', /class="lf-min">40&#39;/.test(h) || /class="lf-min">40'/.test(h), h);
    ok('4f · y el nombre del protagonista', h.includes('Pedro') && h.includes('Luis') && h.includes('Ana'));

    // Aviso clave de fase (⏱️)
    ok('4g · muestra la fase del partido con ⏱️', /live-feed-fase[^>]*>⏱️ 2ª PARTE/.test(h), h);
    ok('4h · el descanso se refleja',
       /⏱️ DESCANSO/.test(html({ phase: 'break', events: [] })));
    ok('4i · y el final tambien',
       /⏱️ FINALIZADO/.test(html({ phase: 'finished', events: [] })));

    ok('4j · sin sucesos, estado vacio elegante (no una tarjeta rota)',
       /live-feed-vacio/.test(html({ phase: '1st_half', events: [] })) &&
       /Sin sucesos todav/.test(html({ events: [] })));

    // E · escapado
    const malicioso = html({ events: [
        ev({ type: 'goal', text: 'GOL · <img src=x onerror=alert(1)>', matchTime: '1T 05:00', createdAt: 1 }),
    ]});
    ok('4k · [DEFECTO E] el nombre del jugador va ESCAPADO',
       !/<img/.test(malicioso) && /&lt;img/.test(malicioso), malicioso);
}

// ═══════════ PARTE 5 · integracion en la tarjeta ═══════════
console.log('\n── PARTE 5 · integracion y estilos ──');
{
    ok('5a · la tarjeta invoca el feed', /\$\{_liveFeedHtml\(m\)\}/.test(LIVE));
    ok('5b · y lo hace ANTES de la fila de acciones, para no empujar VER PARTIDO',
       LIVE.indexOf('${_liveFeedHtml(m)}') < LIVE.indexOf('live-card-btn-ver'));
    ok('5c · hay estilos propios del feed', /\.live-feed\s*\{/.test(LIVE));
    ok('5d · con altura ACOTADA para que un nombre largo no descuadre la tarjeta',
       /\.live-feed\s*\{[^}]*max-height:/.test(LIVE));
    ok('5e · y el texto largo se recorta con puntos suspensivos',
       /\.lf-txt\s*\{[^}]*text-overflow:\s*ellipsis/.test(LIVE));
    ok('5f · con banda responsive para movil',
       /@media \(max-width: 600px\)[\s\S]{0,400}\.live-feed\s*\{/.test(LIVE));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
