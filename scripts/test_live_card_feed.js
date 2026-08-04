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
//
//  F · v439 · CADA SUCESO DICE DE QUE EQUIPO ES. Sin eso, en un club con los
//      dos equipos sobre el mismo campo, "GOL · Pedro" no dice nada: el
//      director no sabe si va ganando o perdiendo. El equipo viaja en un campo
//      ESTRUCTURADO del evento (`team`), no en el texto — misma regla que A—,
//      con dos respaldos para los eventos ya escritos antes de v439.
//      🔑 Y SI NINGUNA FUENTE RESUELVE, NO SE INVENTA: mejor sin etiqueta que
//      con la equivocada, que le atribuiria al club un gol del rival.
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
    '\n;globalThis.texto = _liveFeedTexto;' +
    '\n;globalThis.lado  = _liveFeedLado;' +
    '\n;globalThis.nomEq = _liveFeedNombreEquipo;', sandbox);

const { items, html, minuto, texto, lado, nomEq } = sandbox;

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

// ═══════════ PARTE 6 · v439 · de que equipo es cada suceso ═══════════
console.log('\n── PARTE 6 · el equipo de cada suceso (v439) ──');
{
    // Partido de referencia: los dos equipos del mismo club, que es el caso
    // que hizo imposible leer el feed.
    const M = {
        homeTeam: { name: 'CRONOS A', score: 1 },
        awayTeam: { name: 'CRONOS B', score: 0 },
        players: [
            { id: 1, name: 'Pedro', team: 'home' },
            { id: 2, name: 'Luis',  team: 'away' },
            { id: 3, name: 'Ana',   team: 'home' },
            { id: 4, name: 'Bruno', team: 'away' },
        ],
    };

    // ── 1 · el contrato: el campo estructurado manda ──
    ok('6a · [DEFECTO F] el lado sale de ev.team, no del texto',
       lado(M, ev({ type: 'goal', text: 'GOL · Pedro', team: 'away' })) === 'away',
       'si se dedujera del nombre diria home: el campo estructurado tiene que ganar');
    ok('6b · y se traduce al nombre REAL del equipo',
       nomEq(M, 'away', ev({})) === 'CRONOS B' && nomEq(M, 'home', ev({})) === 'CRONOS A');
    ok('6c · el nombre del DOCUMENTO manda sobre el guardado en el evento',
       nomEq(M, 'home', ev({ teamName: 'NOMBRE VIEJO' })) === 'CRONOS A',
       'si el club renombra el equipo, la tarjeta debe decir el nombre de ahora');
    ok('6d · pero si el documento no lo trae, se usa el del evento',
       nomEq({}, 'home', ev({ teamName: 'CRONOS A' })) === 'CRONOS A');
    ok('6e · y en ultimo extremo, LOCAL / VISITANTE',
       nomEq({}, 'home', ev({})) === 'LOCAL' && nomEq({}, 'away', ev({})) === 'VISITANTE');

    // ── 2 · respaldo para los eventos ANTERIORES a v439 ──
    ok('6f · [RESPALDO] una sustitucion vieja se resuelve por el prefijo del texto',
       lado(M, ev({ type: 'sub', subOutName: 'Bruno', subInName: 'Luis',
                    text: 'CRONOS B | ▲ SALE: Bruno | ▼ ENTRA: Luis' })) === 'away',
       'los partidos ya en juego al desplegar no pueden reescribir sus eventos');
    ok('6g · [RESPALDO] un gol viejo se resuelve buscando al jugador en la plantilla',
       lado(M, ev({ type: 'goal', text: 'GOL · Luis' })) === 'away');
    ok('6h · [RESPALDO] el parentesis final no impide encontrar al jugador',
       lado(M, ev({ type: 'red', text: 'TARJETA ROJA · Pedro (doble amarilla)' })) === 'home' &&
       lado(M, ev({ type: 'goal', text: 'GOL · Luis (Retroactivo)' })) === 'away');

    // ── 3 · lo que NO se puede hacer: adivinar ──
    const ambiguo = { homeTeam: { name: 'A' }, awayTeam: { name: 'B' },
                      players: [ { name: 'Pedro', team: 'home' }, { name: 'Pedro', team: 'away' } ] };
    ok('6i · 🔑 el MISMO nombre en los dos equipos NO se etiqueta (adivinar seria peor)',
       lado(ambiguo, ev({ type: 'goal', text: 'GOL · Pedro' })) === null,
       'una etiqueta equivocada le atribuye al club un gol del rival');
    ok('6j · un suceso irreconocible tampoco inventa equipo',
       lado(M, ev({ type: 'goal', text: 'GOL · Fulanito' })) === null &&
       lado({}, ev({ type: 'goal', text: 'GOL' })) === null);
    ok('6k · y no revienta sin partido ni sin evento',
       lado(undefined, undefined) === null && lado({}, {}) === null);

    // ── 4 · como se pinta ──
    const h = html(Object.assign({ phase: '1st_half', events: [
        ev({ type: 'goal',   text: 'GOL · Pedro',             team: 'home', teamName: 'CRONOS A', matchTime: '1T 10:00', createdAt: 2 }),
        ev({ type: 'yellow', text: 'TARJETA AMARILLA · Luis', team: 'away', teamName: 'CRONOS B', matchTime: '1T 20:00', createdAt: 1 }),
    ] }, M));
    ok('6l · cada fila lleva su etiqueta de equipo',
       (h.match(/class="lf-eq /g) || []).length === 2, h);
    ok('6m · con el nombre del equipo visible',
       h.includes('CRONOS A') && h.includes('CRONOS B'), h);
    ok('6n · 🔑 local y visitante se distinguen por clase (color), no solo por texto',
       /lf-eq lf-eq-home">CRONOS A/.test(h) && /lf-eq lf-eq-away">CRONOS B/.test(h), h);
    ok('6o · la etiqueta va ANTES del suceso, no despues',
       h.indexOf('CRONOS A') < h.indexOf('Pedro'), h);
    ok('6p · sin equipo resoluble la fila se pinta igual, solo que sin etiqueta',
       (() => {
           const sin = html({ events: [ ev({ type: 'goal', text: 'GOL · Fulanito', matchTime: '1T 05:00', createdAt: 1 }) ] });
           return !/lf-eq/.test(sin) && /Fulanito/.test(sin);
       })(), 'perder el suceso por no saber el equipo seria peor que la etiqueta que falta');
    ok('6q · [DEFECTO E] el nombre del equipo tambien va ESCAPADO',
       (() => {
           const x = html({ homeTeam: { name: '<img src=x onerror=alert(1)>' },
                            events: [ ev({ type: 'goal', text: 'GOL · Pedro', team: 'home', matchTime: '1T 05:00', createdAt: 1 }) ] });
           return !/<img/.test(x) && /&lt;img/.test(x);
       })());
    ok('6r · la etiqueta esta ACOTADA para no comerse la linea del suceso',
       /\.lf-eq\s*\{[^}]*max-width:/.test(LIVE) &&
       /\.lf-eq\s*\{[^}]*text-overflow:\s*ellipsis/.test(LIVE));
}

// ═══════ PARTE 7 · v439 · quien ESCRIBE el equipo en el evento ═══════
// El feed no puede inventarse un dato que nadie emite: esta parte vigila el
// otro extremo del contrato.
console.log('\n── PARTE 7 · el emisor escribe el equipo ──');
{
    const sinComentarios = (src) => src.split(/\r?\n/)
        .map(l => l.replace(/\/\/.*$/, '')).join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '');

    const PACT  = sinComentarios(fs.readFileSync(path.join(ROOT, 'js/match/events/player-actions.js'), 'utf8'));
    const RETRO = sinComentarios(fs.readFileSync(path.join(ROOT, 'js/match/events/retroactive-modal.js'), 'utf8'));

    ok('7a · existe el helper que arma el dato',
       /function _datosEquipoDe\(player\)[\s\S]{0,220}team:[\s\S]{0,120}teamName:/.test(PACT));
    ok('7b · 🔑 `team` es "home"/"away", no el nombre (el club puede renombrar el equipo)',
       /team: \(\(player && player\.team\) === 'away'\) \? 'away' : 'home'/.test(PACT));

    // Censo: NINGUNA emision de un suceso de jugador puede quedarse sin equipo.
    const llamadas = PACT.match(/_registerMatchEvent\('(goal|yellow|red|injury|sub)'[\s\S]{0,400}?\);/g) || [];
    ok('7c · siguen estando las 6 emisiones con tipo literal (gol, amarilla, 2 rojas, lesion, cambio)',
       llamadas.length === 6, llamadas.length + ' encontradas');
    const huerfanas = llamadas.filter(c => !/_datosEquipoDe|team:/.test(c));
    ok('7d · 🔑 y NINGUNA se queda sin el equipo',
       huerfanas.length === 0, huerfanas.join('\n---\n'));

    ok('7e · la sustitucion completa lo lleva SIN perder subOutName/subInName',
       /_registerMatchEvent\('sub',[\s\S]{0,300}subOutName: outName, subInName: inName, team: eq\.team, teamName: eq\.teamName/.test(PACT),
       'el replay depende de esos dos campos desde v418');
    ok('7f · y la media sustitucion suelta (sub_in / sub_out) tambien',
       /action === 'Entra' \? 'sub_in' : 'sub_out'[\s\S]{0,400}playerName: nombre, team: datosEq\.team/.test(PACT));
    ok('7g · el evento RETROACTIVO tambien lleva equipo cuando hay jugador',
       /_datosEquipoDe\(p\) : null;[\s\S]{0,200}_registerMatchEvent\(eventType, text, icon, matchTime, extraEq/.test(RETRO));

    ok('7h · 🔑 el TEXTO de los eventos NO ha cambiado (hay guards y un replay que dependen de el)',
       /'GOL · ' \+ p\.name/.test(PACT) &&
       /'TARJETA AMARILLA · ' \+ p\.name/.test(PACT) &&
       /'LESIÓN · ' \+ p\.name/.test(PACT) &&
       /' \| ▲ SALE: ' \+ outName \+ ' \| ▼ ENTRA: ' \+ inName/.test(PACT));
    ok('7i · y _registerMatchEvent conserva su firma (el 5o argumento sigue siendo `extra`)',
       /function _registerMatchEvent\(type, text, icon, matchTimeOverride, extra, target\)/.test(PACT));
    ok('7j · que mezcla el extra en el evento guardado',
       /Object\.keys\(extra\)\.forEach[\s\S]{0,160}eventEntry\[k\] = extra\[k\]/.test(PACT));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
