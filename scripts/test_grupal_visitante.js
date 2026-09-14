// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v709 · EL BOTÓN «GRUPAL» JUGANDO DE VISITANTE
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt + captura 10373, panel del ente
//  individual): «el botón GRUPAL no está seleccionando a los jugadores al
//  pulsarlo».
//
//  🔑🔑 LA CAUSA NO ESTABA EN EL ENLACE DE EVENTOS, ESTABA EN EL CSS, y es otra
//  factura del mismo supuesto que costó la tanda v707 («mi equipo» == «el
//  local»). Con el equipo propio de VISITANTE y sin analizar al contrario
//  (`hide-visitor` + `role-away`):
//    · una regla de v-anterior ESCONDÍA el GRUPAL de visitante… que es EL SUYO;
//    · y dejaba visible el GRUPAL de LOCAL, que apunta al equipo que NO TIENE
//      NI UN JUGADOR.
//  Así que el modo grupal se activaba para 'home' y `handleGroupSubClick`
//  descartaba cada toque por su primera guarda (`player.team !== groupSubTeam`):
//  el botón «no hacía nada», sin un solo error en consola.
//
//  LO QUE VIGILA ESTE FICHERO:
//
//   A · CUÁL DE LOS DOS BOTONES SE VE, resolviendo la CASCADA de style.css (no
//       buscando texto: hay tres reglas peleando por `display` y un grep no
//       dice cuál gana).
//
//   B · QUE LA GUARDA DE `handleGroupSubClick` SIGA AHÍ. No es el defecto —es
//       el aislamiento por equipo, y quitarla dejaría seleccionar jugadores del
//       rival en el grupal del propio—; pero es la pieza que convierte «el
//       botón equivocado» en «no pasa nada», así que el guard la ejecuta para
//       que el día que alguien la toque sepa qué está tocando.
//
//   C · Y LA SIMETRÍA DEL RESTO DE SEÑALES POR LADO: el botón de banca de móvil
//       que sobra es el del equipo cuya columna ya está fija, que de visitante
//       es la DERECHA.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { parsearCSS, resolver } = require('./lib/css-cascada');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 240));
        fallos++;
    }
}

const CSS    = leer('style.css');
const INDEX  = leer('index.html');
const RENDER = leer('js/ui/render.js');
const REGLAS = parsearCSS(CSS);

const PC      = { ancho: 1920, alto: 1080 };
const TABLET  = { ancho: 900,  alto: 500  };   // ≤950 y horizontal

// El <body> con las señales del partido, y los dos botones del marcador.
const cuerpo = (clases) => ({ tag: 'body', clases: clases });
const btn = (id, clases) => ({ tag: 'button', id: id, clases: [], ancestros: [cuerpo(clases)] });
const ver = (id, clases, vp) => resolver(REGLAS, 'display', btn(id, clases), vp || PC);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [EL DEFECTO] qué GRUPAL se ve jugando FUERA ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // Mi equipo es el VISITANTE y no se dibuja al rival: es el caso de la
    // captura 10373 (y de cualquier partido fuera sin «Analizar Contrario»).
    const FUERA = ['hide-visitor', 'role-away'];

    ok('1a · 🔑🔑 de VISITANTE, el GRUPAL de visitante (el MÍO) SE VE',
       ver('btn-group-sub-away', FUERA) !== 'none',
       'salió display:' + ver('btn-group-sub-away', FUERA) +
       ' — era el botón que se escondía, y el que sí selecciona a mis jugadores');

    ok('1b · 🔑 …y el de LOCAL se esconde (es el equipo que no tiene jugadores)',
       ver('btn-group-sub', FUERA) === 'none',
       'salió display:' + ver('btn-group-sub', FUERA) +
       ' — dejarlo visible es lo que hacía que «el botón no hiciera nada»');

    // En casa, todo como siempre.
    const CASA = ['hide-visitor'];
    ok('1c · en casa y sin rival dibujado, se ve el de LOCAL y no el de visitante',
       ver('btn-group-sub', CASA) !== 'none' &&
       ver('btn-group-sub-away', CASA) === 'none',
       'home=' + ver('btn-group-sub', CASA) + ' away=' + ver('btn-group-sub-away', CASA));

    // Con el rival dibujado hay DOS equipos con jugadores: los dos botones.
    ok('1d · con «Analizar Contrario» están los DOS, juegue donde juegue',
       ver('btn-group-sub', []) !== 'none' &&
       ver('btn-group-sub-away', []) !== 'none' &&
       ver('btn-group-sub', ['role-away']) !== 'none' &&
       ver('btn-group-sub-away', ['role-away']) !== 'none');

    ok('1e · y en una tablet horizontal el reparto es el mismo',
       ver('btn-group-sub-away', FUERA, TABLET) !== 'none' &&
       ver('btn-group-sub', FUERA, TABLET) === 'none');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [POR QUÉ NO PASABA NADA] la guarda, EJECUTADA ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const ini = RENDER.indexOf('function toggleGroupSubMode(team)');
    const fin = RENDER.indexOf('// ── SELECCIÓN GRUPAL: ejecutar', ini) > ini
        ? RENDER.indexOf('// ── SELECCIÓN GRUPAL: ejecutar', ini)
        : RENDER.indexOf('function executeGroupSubstitution', ini);
    ok('2a · se encuentran el interruptor y el click del modo grupal', ini >= 0 && fin > ini);

    if (ini >= 0 && fin > ini) {
        const clases = (nombres) => {
            const s = new Set(nombres || []);
            return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), _s: s };
        };
        const montar = () => {
            const fichas = {};
            const ctx = {
                console: { log() {}, warn() {} },
                groupSubMode: false, groupSubTeam: null,
                groupSelectedOut: new Set(), groupSelectedIn: new Set(),
                pendingSubstitution: null,
                players: [],
                Set, Map, String, Number, Array, Object, Math,
                navigator: {},
                showToast: () => {},
                clearGroupSubSelection: () => {},
                executeGroupSubstitution: () => { ctx.ejecutado = true; },
                document: {
                    getElementById: (id) => {
                        if (!fichas[id]) fichas[id] = { id, textContent: '', classList: clases([]) };
                        return fichas[id];
                    },
                    querySelector: () => null,
                },
                ejecutado: false,
            };
            ctx.window = ctx;
            vm.createContext(ctx);
            vm.runInContext(RENDER.slice(ini, fin) +
                '\n;globalThis.activar = toggleGroupSubMode;' +
                '\n;globalThis.tocar   = handleGroupSubClick;', ctx);
            return { ctx, fichas };
        };

        // El escenario del reporte: el botón visible era el de LOCAL.
        const malo = montar();
        malo.ctx.activar('home');
        malo.ctx.tocar({ id: 7, team: 'away', status: 'field' });
        ok('2b · 🔑🔑 con el modo grupal en LOCAL, tocar a MI jugador (away) no selecciona',
           malo.ctx.groupSelectedOut.size === 0,
           'es el aislamiento por equipo, y es CORRECTO: el defecto era que el ' +
           'botón visible fuera el del otro equipo');

        // Con el botón correcto, el mismo toque SÍ selecciona.
        const bueno = montar();
        bueno.ctx.activar('away');
        ok('2c · el interruptor deja el modo grupal apuntando a mi lado',
           bueno.ctx.groupSubMode === true && bueno.ctx.groupSubTeam === 'away');
        bueno.ctx.tocar({ id: 7, team: 'away', status: 'field' });
        ok('2d · 🔑 y ahora el titular SÍ se marca como saliente',
           bueno.ctx.groupSelectedOut.has(7) &&
           bueno.fichas['player-7'].classList.contains('group-sub-out'),
           'clases: ' + [...bueno.fichas['player-7'].classList._s].join(','));
        bueno.ctx.tocar({ id: 12, team: 'away', status: 'bench' });
        ok('2e · …y el suplente como entrante',
           bueno.ctx.groupSelectedIn.has(12) &&
           bueno.fichas['player-12'].classList.contains('group-sub-in'));
        ok('2f · el rival sigue aislado (tocarlo no hace nada)',
           (bueno.ctx.tocar({ id: 3, team: 'home', status: 'field' }), bueno.ctx.groupSelectedOut.size === 1));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · las demás señales por LADO, simétricas ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const tog = (clase, clasesBody) => resolver(REGLAS, 'display',
        { tag: 'button', clases: ['mobile-toggle', clase], ancestros: [cuerpo(clasesBody)] }, TABLET);

    ok('3a · en casa sobra el botón de banca LOCAL (su columna ya está fija)',
       tog('home', ['hide-visitor']) === 'none' && tog('away', ['hide-visitor']) !== 'none',
       'home=' + tog('home', ['hide-visitor']) + ' away=' + tog('away', ['hide-visitor']));

    ok('3b · 🔑 y de visitante sobra el de VISIT., no el de LOCAL',
       tog('away', ['hide-visitor', 'role-away']) === 'none' &&
       tog('home', ['hide-visitor', 'role-away']) !== 'none',
       'home=' + tog('home', ['hide-visitor', 'role-away']) +
       ' away=' + tog('away', ['hide-visitor', 'role-away']));

    // La banca: ya estaba resuelta antes de v709, y no se puede desandar.
    const side = (clase, clasesBody) => resolver(REGLAS, 'display',
        { tag: 'div', clases: [clase], ancestros: [cuerpo(clasesBody)] }, PC);
    ok('3c · CONTROL · de visitante, la banca visible es la DERECHA',
       side('sidebar-right', ['hide-visitor', 'role-away']) !== 'none' &&
       side('sidebar',       ['hide-visitor', 'role-away']) === 'none');

    // Y los dos botones siguen existiendo en el marcado con su onclick de lado.
    ok('3d · el marcado conserva un GRUPAL por lado, cada uno con su equipo',
       /id="btn-group-sub"[^>]*onclick="toggleGroupSubMode\('home'\)"/.test(INDEX) &&
       /id="btn-group-sub-away"[^>]*onclick="toggleGroupSubMode\('away'\)"/.test(INDEX),
       'la corrección es CUÁL SE VE, no a quién apunta cada uno');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos ? 1 : 0);
