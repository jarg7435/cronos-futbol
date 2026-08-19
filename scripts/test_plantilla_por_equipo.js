// ═══════════════════════════════════════════════════════════════════════════
//  v580 · LA PLANTILLA ES DEL EQUIPO, NO DE LA MODALIDAD
// ═══════════════════════════════════════════════════════════════════════════
//  EL DEFECTO. `cronos_master_roster` era `{f7:[…], f11:[…]}`: UNA lista por
//  modalidad y por PERSONA, común a todos sus equipos y a todos sus clubes.
//  Con dos equipos de la misma modalidad, la plantilla de uno **borraba la del
//  otro, en silencio**. Era el pendiente marcado como "el que puede perder
//  datos".
//
//  🔑 Y NO ERA SÓLO TEÓRICO. `cronosPuedeLlevarEquipo` impide dos equipos de
//  la misma modalidad… pero su filtro es `mismoClub`: SÓLO mira dentro de un
//  club. Un entrenador con plaza en dos clubes, ambos de Fútbol 7, pasa la
//  regla y compartía una sola lista. Ese camino está abierto hoy.
//
//  Este guard EJECUTA los accesores reales: lo que hay que demostrar es que
//  dos equipos tienen plantillas independientes, no que exista una función.
// ═══════════════════════════════════════════════════════════════════════════
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(nombre, cond, detalle) {
    if (cond) { console.log('PASS ' + nombre); pass++; }
    else { console.log('FAIL ' + nombre + (detalle ? '\n       ' + detalle : '')); fail++; }
}

const UTILS = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');

const ini = UTILS.indexOf("const _ROSTER_KEY = 'cronos_master_roster';");
const fin = UTILS.indexOf('// Clave de equipo de un documento CUALQUIERA');
ok('0a · se encuentra la capa de acceso a la plantilla', ini !== -1 && fin > ini);
if (fail) { console.log('\n' + pass + ' PASS / ' + fail + ' FAIL'); process.exit(1); }

// ── Entorno: un localStorage de mentira y un equipo que se puede cambiar ──
function entorno(inicial) {
    const almacen = {};
    if (inicial !== undefined) almacen['cronos_master_roster'] = JSON.stringify(inicial);
    const sb = {
        equipo: '',                      // lo cambia cada caso
        subidas: [],
        localStorage: {
            getItem: (k) => (k in almacen ? almacen[k] : null),
            setItem: (k, v) => { almacen[k] = String(v); }
        },
        JSON, Array, Object, String, Promise,
        console: { warn() {} }
    };
    sb.window = sb;
    // El resolutor real vive en match-slots.js; aquí se estabula el mismo
    // contrato (`equipoActual()` devuelve el teamId o '' si no hay equipo).
    sb._cronosMatchSlots = { equipoActual: () => sb.equipo };
    sb.cloudSet = (k, v) => { sb.subidas.push(k); return Promise.resolve(true); };
    vm.createContext(sb);
    vm.runInContext(UTILS.slice(ini, fin), sb);
    return { sb, almacen };
}

const jug = (n) => [{ id: 'J-0' + n, number: n, name: 'Jugador ' + n, alias: 'J' + n }];

// ═══════ PARTE 1 · EL DEFECTO: dos equipos, dos plantillas ═══════
console.log('\n── PARTE 1 · dos equipos de la MISMA modalidad ──');
{
    const { sb } = entorno();
    const A = 'clubuno__alevin__a';
    const B = 'clubdos__benjamin__a';   // otro CLUB, misma modalidad: hoy es posible

    sb.equipo = A;
    sb.cronosPlantillaGuardar('f7', jug(1), { nube: false });
    sb.equipo = B;
    sb.cronosPlantillaGuardar('f7', jug(2), { nube: false });

    sb.equipo = A;
    const listaA = sb.cronosPlantillaLeer('f7');
    sb.equipo = B;
    const listaB = sb.cronosPlantillaLeer('f7');

    // 🔑 ESTE ES EL DEFECTO ENTERO. Antes de v580, guardar la de B machacaba
    // la de A y aquí las dos serían "Jugador 2".
    ok('1a · 🔑 el equipo A conserva SU plantilla tras guardar la de B',
       listaA.length === 1 && listaA[0].name === 'Jugador 1',
       'quedó: ' + JSON.stringify(listaA.map(p => p.name)));
    ok('1b · y el equipo B tiene la suya, distinta',
       listaB.length === 1 && listaB[0].name === 'Jugador 2',
       'quedó: ' + JSON.stringify(listaB.map(p => p.name)));

    // Y las dos modalidades del mismo equipo tampoco se pisan.
    sb.equipo = A;
    sb.cronosPlantillaGuardar('f11', jug(9), { nube: false });
    ok('1c · dentro de un equipo, F7 y F11 siguen separadas',
       sb.cronosPlantillaLeer('f7')[0].name === 'Jugador 1' &&
       sb.cronosPlantillaLeer('f11')[0].name === 'Jugador 9');
}

// ═══════ PARTE 2 · la migración no puede asustar a nadie ═══════
console.log('\n── PARTE 2 · qué pasa con la plantilla que ya existía ──');
{
    // Un entrenador que ya tenía su plantilla en la forma vieja.
    const { sb } = entorno({ f7: jug(7), f11: jug(11) });
    const A = 'clubuno__alevin__a';
    const B = 'clubdos__benjamin__a';

    sb.equipo = A;
    ok('2a · 🔑 su equipo la hereda tal cual: no desaparece nada',
       sb.cronosPlantillaLeer('f7')[0].name === 'Jugador 7',
       'una plantilla en blanco tras actualizar es el susto que hay que evitar');

    // ⚠️ Y el SEGUNDO equipo también la hereda, a propósito: HOY los dos
    // comparten esa lista, así que sembrar a los dos reproduce exactamente lo
    // que el entrenador ve ahora. A partir del primer cambio, divergen.
    sb.equipo = B;
    ok('2b · el segundo equipo hereda lo mismo (era lo que veía hasta hoy)',
       sb.cronosPlantillaLeer('f7')[0].name === 'Jugador 7');

    sb.cronosPlantillaGuardar('f7', jug(2), { nube: false });
    sb.equipo = A;
    ok('2c · 🔑 y en cuanto uno se edita, dejan de compartir',
       sb.cronosPlantillaLeer('f7')[0].name === 'Jugador 7',
       'editar B no puede tocar A: es el defecto original');

    // ⚠️ EL MISMO CASO PERO EMPEZANDO POR UN GUARDADO. La foto del legado se
    // toma la primera vez que alguien TOCA la plantilla, y eso puede ser una
    // escritura, no una lectura: si la foto se tomara después de escribir,
    // nacería con el dato nuevo y los demás equipos heredarían de él. Es la
    // misma trampa de 2c por el otro extremo.
    const otro = entorno({ f7: jug(7), f11: [] }).sb;
    otro.equipo = B;
    otro.cronosPlantillaGuardar('f7', jug(2), { nube: false });   // primer gesto: guardar
    otro.equipo = A;
    ok('2d · 🔑 y también si el primer gesto tras actualizar es un GUARDADO',
       otro.cronosPlantillaLeer('f7')[0].name === 'Jugador 7',
       'la foto tiene que tomarse ANTES de escribir encima');
}

// ═══════ PARTE 3 · el legado se mantiene al día ═══════
console.log('\n── PARTE 3 · nada se queda sin plantilla ──');
{
    const { sb, almacen } = entorno();
    sb.equipo = 'clubuno__alevin__a';
    sb.cronosPlantillaGuardar('f7', jug(5), { nube: false });
    const raiz = JSON.parse(almacen['cronos_master_roster']);

    // 🔑 El legado NO se borra: una app vieja servida desde caché, o cualquier
    // lector que no haya migrado, sigue encontrando su plantilla donde siempre.
    ok('3a · la forma antigua {f7,f11} se sigue escribiendo',
       Array.isArray(raiz.f7) && raiz.f7[0] && raiz.f7[0].name === 'Jugador 5',
       'sin esto, una versión anterior vería la plantilla vacía');
    ok('3b · y la nueva, por equipo, también',
       raiz.porEquipo && raiz.porEquipo['clubuno__alevin__a'] &&
       raiz.porEquipo['clubuno__alevin__a'].f7[0].name === 'Jugador 5');

    // Sin equipo (entrenador individual sin club) todo sigue como siempre.
    sb.equipo = '';
    ok('3c · sin equipo, se usa el legado y nada cambia',
       sb.cronosPlantillaLeer('f7')[0].name === 'Jugador 5',
       'un entrenador individual no tiene equipos entre los que separar');

    // La subida a la nube sigue ocurriendo cuando toca.
    sb.equipo = 'clubuno__alevin__a';
    sb.subidas.length = 0;
    sb.cronosPlantillaGuardar('f7', jug(6));
    ok('3d · guardar sin `nube:false` sigue subiendo a Firestore',
       sb.subidas.indexOf('cronos_master_roster') !== -1,
       'subidas: ' + JSON.stringify(sb.subidas));
}

// ═══════ PARTE 4 · robustez ═══════
console.log('\n── PARTE 4 · datos rotos no pueden tumbar la plantilla ──');
{
    const { sb, almacen } = entorno();
    almacen['cronos_master_roster'] = '{{{ esto no es JSON';
    sb.equipo = 'clubuno__alevin__a';
    ok('4a · un guardado corrupto devuelve una plantilla vacía, no lanza',
       Array.isArray(sb.cronosPlantillaLeer('f7')) && sb.cronosPlantillaLeer('f7').length === 0);

    almacen['cronos_master_roster'] = JSON.stringify({ f7: 'no soy un array' });
    ok('4b · y un campo con el tipo equivocado, tampoco',
       Array.isArray(sb.cronosPlantillaLeer('f7')));

    ok('4c · una modalidad desconocida cae a f7, no a undefined',
       Array.isArray(sb.cronosPlantillaLeer('futbol-sala')));
}

// ═══════ PARTE 5 · nadie se ha quedado leyendo la clave a pelo ═══════
console.log('\n── PARTE 5 · un solo punto de acceso ──');
{
    // 🔑 El defecto vivía repartido en 30 sitios que leían localStorage
    // directamente. Si mañana alguien añade el 31, este guard lo caza: dos
    // formas de leer el mismo dato acaban divergiendo (v532, v433).
    const dirs = [];
    (function anda(d) {
        fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
            const p = path.join(d, e.name);
            if (e.isDirectory()) anda(p);
            else if (e.name.endsWith('.js')) dirs.push(p);
        });
    })(path.join(ROOT, 'js'));

    const culpables = [];
    dirs.forEach(p => {
        const s = fs.readFileSync(p, 'utf8');
        // Se ignoran comentarios: documentar la clave es legítimo.
        const codigo = s.replace(/\/\*[\s\S]*?\*\//g, '')
                        .split('\n').map(l => l.replace(/(^|\s)\/\/[\s\S]*$/, '$1')).join('\n');
        if (!/cronos_master_roster/.test(codigo)) return;
        const rel = path.relative(ROOT, p).replace(/\\/g, '/');
        // utils.js es el DUEÑO de la clave; firestore-storage la sincroniza
        // como texto opaco (no mira dentro), así que las dos son legítimas.
        if (rel === 'js/core/utils.js' || rel === 'js/services/firestore-storage.js') return;
        culpables.push(rel);
    });

    ok('5a · 🔑 nadie lee ni escribe `cronos_master_roster` por su cuenta',
       culpables.length === 0,
       'siguen accediendo a pelo: ' + culpables.join(', '));

    ok('5b · y los accesores están publicados para que haya alternativa',
       /window\.cronosPlantillaLeer\s*=/.test(UTILS) &&
       /window\.cronosPlantillaGuardar\s*=/.test(UTILS) &&
       /window\.cronosPlantillaAmbas\s*=/.test(UTILS));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
