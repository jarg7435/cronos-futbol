// ─────────────────────────────────────────────────────────────────────────
// test_live_card_categoria.js  ·  etiqueta de CATEGORÍA/SUBCATEGORÍA sobre el
// cronómetro de cada tarjeta de "Partidos en Vivo" (v463)
//
// Peticion del autor: en el panel de partidos en vivo solo se ven los nombres
// de los equipos, y eso no basta cuando hay varios partidos activos a la vez.
// Justo ENCIMA del cronometro (el tiempo en verde) tiene que aparecer, en
// letras blancas, la categoria y subcategoria del partido — "ALEVIN C" —
// tomada de lo que el entrenador configuro en el panel de creacion.
//
// ESTE GUARD NO SE LIMITA A MIRAR EL FUENTE: extrae del live.html el bloque de
// la etiqueta y lo EJECUTA contra partidos fabricados, comprobando el texto
// que produce. Lo que solo se puede comprobar leyendo (el sitio del DOM, los
// campos que escribe sync.js) va aparte y anclado lo mas estrecho posible.
//
// LO QUE PROTEGE, y por que cada cosa se rompe sola si nadie la vigila:
//
//  A · ⚠️⚠️ LA ETIQUETA NO PUEDE REUTILIZAR `category`/`subcategory`. Esos dos
//      campos son la ENTRADA DEL SEMAFORO: los leen `_timerColorFor` de
//      live.html y el reproductor de la repeticion. Y las dos formas de
//      escribir la misma categoria NO caen en el mismo grupo:
//      `getCategoryGroupKey` pregunta primero si la cadena contiene 'f7', asi
//      que el valor del panel `f7_infantil` resuelve a 'f7' mientras que el del
//      perfil, `infantil`, resuelve a 'infantil_a' — con OTROS umbrales de
//      rojo/amarillo. Volcar el valor del panel en `category` para pintar una
//      etiqueta le cambiaria los colores del semaforo, en vivo y en mitad del
//      partido, a los equipos de Infantil/Cadete que juegan en F7. Por eso van
//      en campos NUEVOS (`matchCategory`/`matchSubcategory`).
//
//  B · EL ORDEN DE LAS CLAVES ES LOGICA, NO ESTILO: 'prebenjamin' CONTIENE
//      'benjamin'. Ordenadas alfabeticamente, TODOS los prebenjamines se
//      etiquetarian como BENJAMIN, y nadie lo veria hasta que un padre lo
//      leyera en el movil.
//
//  C · HAY QUE NORMALIZAR LOS ACENTOS. La misma categoria llega escrita de tres
//      maneras segun el origen: `f7_alevin` (panel), `Alevín` (perfil) y
//      `f7_prebenjamín` (el value de la opcion del desplegable en
//      js/roster/formations.js SI lleva tilde). Comparar sin normalizar deja
//      fuera justo la tercera.
//
//  D · SI NO SE RESUELVE, NO SE INVENTA. Sin categoria no se pinta etiqueta:
//      una etiqueta equivocada encima de un cronometro le atribuye el partido a
//      otro equipo, que es peor que no poner nada. Misma regla que el equipo de
//      los sucesos en v439.
//
//  E · UNA SOLA LINEA. Partida en dos, la etiqueta empuja el cronometro hacia
//      abajo y descuadra la fila del marcador — que es justo lo que el autor
//      pidio no romper.
//
//  F · NADA DE HTML SIN ESCAPAR: la categoria puede venir de un texto libre
//      guardado por el club.
// ─────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const vm   = require('vm');
const cp   = require('child_process');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');

console.log('── etiqueta de categoria sobre el cronometro en vivo (v463) ──\n');

// ═══ 0 · ⚠️ ANTES QUE NADA: ¿COMPILA live.html? ═══
// Un guard de regex NO PUEDE VER un fichero que no parsea, y este ya lo ha
// pagado. La tarjeta se construye con un TEMPLATE LITERAL, y un solo acento
// grave dentro de un comentario HTML de ese bloque lo cierra a media cadena:
// el navegador se come el <script type="module"> ENTERO y la lista de partidos
// se queda en negro, mientras el resto de aserciones de este fichero siguen
// encontrando sus anclas en el texto tan contentas. Paso obligado, y el primero.
// (Van tres: v422, v459 y v463.)
(function compruebaQueCompila() {
    const bloques = LIVE.match(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi) || [];
    let malos = 0, mensajes = [];
    bloques.forEach((bloque, i) => {
        const m = bloque.match(/<script\b([^>]*)>([\s\S]*)<\/script>/i);
        const attrs = m[1] || '', js = m[2] || '';
        if (/\bsrc\s*=/.test(attrs) || !js.trim()) return;
        const esModulo = /type\s*=\s*["']module["']/.test(attrs);
        const tmp = path.join(os.tmpdir(),
            'cronos_chk_' + i + '_' + Date.now() + (esModulo ? '.mjs' : '.cjs'));
        fs.writeFileSync(tmp, js, 'utf8');
        try { cp.execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
        catch (e) {
            malos++;
            mensajes.push('bloque #' + i + ': ' +
                String(e.stderr || e.message).split('\n').slice(0, 4).join(' / '));
        }
        finally { try { fs.unlinkSync(tmp); } catch (e) {} }
    });
    ok('0 · ⚠️ live.html PARSEA (todos sus <script> inline)', malos === 0, mensajes.join('\n       '));
    if (malos) { console.log('\nSi el fichero no compila, lo de abajo no significa nada.'); process.exit(1); }
})();

// ═════════ Se extrae el bloque de la etiqueta y se EJECUTA de verdad ═════════
const ini = LIVE.indexOf('const _LIVE_CAT_ETIQUETAS');
const fin = LIVE.indexOf('// ── Show history');
ok('0a · el bloque de la etiqueta existe en live.html', ini !== -1 && fin > ini,
   'ini=' + ini + ' fin=' + fin);
if (ini === -1 || fin <= ini) { console.log('\nSin el bloque no hay nada que ejecutar.'); process.exit(1); }

const sandbox = {
    escapeHtml: (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    console: { log() {}, warn() {} },
};
vm.createContext(sandbox);
vm.runInContext(LIVE.slice(ini, fin) +
    '\n;globalThis.etiqueta = _liveCategoriaEtiqueta;' +
    '\n;globalThis.html     = _liveCategoriaHtml;' +
    '\n;globalThis.nombre   = _liveCatNombre;' +
    '\n;globalThis.normaliza= _liveCatNormaliza;' +
    '\n;globalThis.subNom   = _liveCatSubNombre;', sandbox);

const { etiqueta, html, nombre, normaliza, subNom } = sandbox;

// ═══════════ PARTE 1 · el nombre de la categoria ═══════════
console.log('\n── PARTE 1 · el nombre de la categoria ──');

// B · el orden de las claves. Este es EL caso que se rompe solo.
ok('1a · f7_prebenjamin -> PREBENJAMIN (y NO BENJAMIN)',
   nombre('f7_prebenjamin') === 'PREBENJAMÍN', nombre('f7_prebenjamin'));
ok('1b · f11_benjamin -> BENJAMIN',
   nombre('f11_benjamin') === 'BENJAMÍN', nombre('f11_benjamin'));

// C · las tres formas en que llega escrita la MISMA categoria.
ok('1c · forma del panel  (f7_alevin) -> ALEVIN',
   nombre('f7_alevin') === 'ALEVÍN', nombre('f7_alevin'));
ok('1d · forma del perfil (Alevín, con tilde) -> ALEVIN',
   nombre('Alevín') === 'ALEVÍN', nombre('Alevín'));
ok('1e · forma del desplegable (f7_prebenjamín, con tilde EN EL VALUE) -> PREBENJAMIN',
   nombre('f7_prebenjamín') === 'PREBENJAMÍN', nombre('f7_prebenjamín'));

// ⚠️ 1c-1e NO DEMUESTRAN QUE SE NORMALICEN LOS ACENTOS, aunque lo parezca.
// Comprobado quitando el `.normalize('NFD')` del fuente: el guard seguia VERDE.
// El motivo es que el RESPALDO (la rama de "categoria libre del club") devuelve
// el original en mayusculas, y para esos valores el original en mayusculas ES
// la etiqueta canonica — asi que la asercion pasaba por el camino equivocado.
// Las dos de abajo son las que de verdad distinguen un camino del otro.
ok('1e1 · _liveCatNormaliza quita los acentos (unidad, sin respaldo que la tape)',
   normaliza('Alevín') === 'alevin' && normaliza('PREBENJAMÍN') === 'prebenjamin',
   normaliza('Alevín') + ' | ' + normaliza('PREBENJAMÍN'));
// Con tilde Y texto de sobra: por la tabla sale la etiqueta corta; por el
// respaldo saldria la frase entera, que no cabe en la columna del cronometro.
ok('1e2 · "Alevín Femenino" resuelve por la TABLA (ALEVIN), no por el respaldo',
   nombre('Alevín Femenino') === 'ALEVÍN', nombre('Alevín Femenino'));

ok('1f · el prefijo de modalidad se cae (f11_infantil -> INFANTIL, sin "F11")',
   nombre('f11_infantil') === 'INFANTIL', nombre('f11_infantil'));
ok('1g · cadete, juvenil y regional resuelven',
   nombre('f7_cadete') === 'CADETE' && nombre('f11_juvenil') === 'JUVENIL' &&
   nombre('f11_regional') === 'REGIONAL',
   [nombre('f7_cadete'), nombre('f11_juvenil'), nombre('f11_regional')].join(' | '));

// Una categoria que no esta en la tabla no se descarta: se muestra tal cual.
ok('1h · categoria libre del club: se muestra, no se inventa ni se traga',
   nombre('f11_senior_femenino') === 'SENIOR FEMENINO', nombre('f11_senior_femenino'));

// D · si no hay nada, no hay etiqueta.
ok('1i · vacio / nulo -> cadena vacia',
   nombre('') === '' && nombre(null) === '' && nombre(undefined) === '',
   JSON.stringify([nombre(''), nombre(null), nombre(undefined)]));

// ═══════════ PARTE 2 · la subcategoria ═══════════
console.log('\n── PARTE 2 · la subcategoria ──');

ok('2a · A / B / C pasan', subNom('A') === 'A' && subNom('b') === 'B' && subNom(' c ') === 'C',
   [subNom('A'), subNom('b'), subNom(' c ')].join(' | '));
ok('2b · vacio / nulo -> se descarta', subNom('') === '' && subNom(null) === '',
   JSON.stringify([subNom(''), subNom(null)]));
// Una frase colada en el campo convertiria la etiqueta en un parrafo dentro de
// una columna de 88px: se descarta en vez de pintarla.
ok('2c · una frase larga se descarta, no se concatena',
   subNom('Equipo B de la tarde') === '', subNom('Equipo B de la tarde'));

// ═══════════ PARTE 3 · la etiqueta completa y su FUENTE ═══════════
console.log('\n── PARTE 3 · la etiqueta completa y de donde sale ──');

// A · la fuente es el PARTIDO, no el perfil del entrenador.
ok('3a · manda matchCategory/matchSubcategory (panel de creacion) sobre category/subcategory',
   etiqueta({ matchCategory: 'f7_alevin', matchSubcategory: 'C',
              category: 'infantil', subcategory: 'A' }) === 'ALEVÍN C',
   etiqueta({ matchCategory: 'f7_alevin', matchSubcategory: 'C',
              category: 'infantil', subcategory: 'A' }));

// Los partidos creados ANTES de v463 no llevan los campos nuevos.
ok('3b · partido anterior a v463 (sin matchCategory): cae a category/subcategory',
   etiqueta({ category: 'Infantil', subcategory: 'B' }) === 'INFANTIL B',
   etiqueta({ category: 'Infantil', subcategory: 'B' }));

ok('3c · sin subcategoria se pinta solo la categoria, sin espacio colgando',
   etiqueta({ matchCategory: 'f7_alevin' }) === 'ALEVÍN',
   JSON.stringify(etiqueta({ matchCategory: 'f7_alevin' })));

ok('3d · matchSubcategory vacia cae a subcategory',
   etiqueta({ matchCategory: 'f7_alevin', matchSubcategory: '', subcategory: 'B' }) === 'ALEVÍN B',
   etiqueta({ matchCategory: 'f7_alevin', matchSubcategory: '', subcategory: 'B' }));

// D · si no se resuelve, NO SE INVENTA.
ok('3e · sin ninguna categoria -> etiqueta vacia',
   etiqueta({ homeTeam: { name: 'LOCAL' } }) === '', etiqueta({ homeTeam: { name: 'LOCAL' } }));
ok('3f · partido nulo -> etiqueta vacia (no revienta la tarjeta)',
   etiqueta(null) === '' && etiqueta(undefined) === '');

// ═══════════ PARTE 4 · el HTML que se inyecta ═══════════
console.log('\n── PARTE 4 · el HTML de la etiqueta ──');

const h = html({ matchCategory: 'f7_alevin', matchSubcategory: 'C' });
ok('4a · lleva la clase .live-list-cat (es la que la pinta en blanco)',
   /class="live-list-cat"/.test(h), h);
ok('4b · el texto es la etiqueta resuelta', h.indexOf('ALEVÍN C') !== -1, h);

// D · sin categoria no se pinta NADA: ni un div vacio, que dejaria un hueco
// encima del cronometro y desalinearia esa tarjeta respecto a las demas.
ok('4c · sin categoria devuelve cadena vacia, no un div vacio',
   html({ id: 'm1' }) === '', JSON.stringify(html({ id: 'm1' })));

// F · escapado.
const hx = html({ matchCategory: '<img src=x onerror=alert(1)>' });
ok('4d · el texto va escapado',
   hx.indexOf('<img') === -1 && hx.indexOf('&lt;IMG') !== -1, hx);

// ═══════════ PARTE 5 · el SITIO en la tarjeta ═══════════
// Esto solo se puede comprobar leyendo el fuente, asi que se ancla lo mas
// estrecho posible: la COLUMNA CENTRAL de la tarjeta, no el fichero entero.
console.log('\n── PARTE 5 · el sitio: encima del cronometro ──');

const cronoIdx = LIVE.indexOf('class="live-list-timer"');
ok('5a · la tarjeta sigue teniendo su cronometro (.live-list-timer)', cronoIdx !== -1);

// Ventana: los 600 caracteres justo ANTES del cronometro. Si la llamada cae
// ahi, esta encima; si esta en otro sitio de la tarjeta, no.
const antesDelCrono = LIVE.slice(Math.max(0, cronoIdx - 600), cronoIdx);
ok('5b · _liveCategoriaHtml(m) se invoca JUSTO ENCIMA del cronometro',
   antesDelCrono.indexOf('_liveCategoriaHtml(m)') !== -1,
   'no aparece en los 600 chars previos al cronometro');

// E · una sola linea, o empuja el cronometro.
const cssIdx = LIVE.indexOf('.live-list-cat {');
ok('5c · existe la regla CSS .live-list-cat', cssIdx !== -1);
const cssBloque = cssIdx === -1 ? '' : LIVE.slice(cssIdx, LIVE.indexOf('}', cssIdx));
ok('5d · el color es BLANCO (lo que pidio el autor)',
   /color:\s*#(fff|ffffff)\b/i.test(cssBloque), cssBloque);
ok('5e · white-space: nowrap — una sola linea, no empuja el cronometro',
   /white-space:\s*nowrap/.test(cssBloque), cssBloque);

// ═══════════ PARTE 6 · lo que escribe sync.js ═══════════
console.log('\n── PARTE 6 · el snapshot que escribe el entrenador ──');

ok('6a · el snapshot lleva matchCategory y matchSubcategory',
   /matchCategory:\s*_matchCat/.test(SYNC) && /matchSubcategory:\s*_matchSub/.test(SYNC));

// La fuente pedida por el autor: el panel de creacion del partido.
ok('6b · _matchCat sale del panel de creacion (#match-category), con respaldo',
   /_matchCat\s*=\s*_dom\('match-category'\)\s*\|\|\s*window\._currentMatchCategory/.test(SYNC));
ok('6c · _matchSub sale del panel de creacion (#match-subcategory), con respaldo',
   /_matchSub\s*=\s*_dom\('match-subcategory'\)\s*\|\|\s*window\._currentMatchSubcategory/.test(SYNC));

// ⚠️ A · LA ASERCION QUE MAS IMPORTA DE TODO EL FICHERO.
// `category`/`subcategory` alimentan el semaforo. Tienen que seguir saliendo
// del PERFIL del entrenador y NO del panel: si alguien "simplifica" fusionando
// los dos pares, a los Infantil/Cadete que juegan F7 les cambian los umbrales
// de color en mitad del partido.
const bloqueSnap = SYNC.slice(SYNC.indexOf('const snapshot = {'),
                              SYNC.indexOf('const snapshot = {') + 2500);
const lineaCat = (bloqueSnap.match(/^\s*category:.*$/m)    || [''])[0];
const lineaSub = (bloqueSnap.match(/^\s*subcategory:.*$/m) || [''])[0];
ok('6d · ⚠️ `category` (entrada del semaforo) sigue saliendo del PERFIL, no del panel',
   lineaCat.indexOf('_cronosCurrentUser') !== -1 &&
   lineaCat.indexOf('_matchCat') === -1 &&
   lineaCat.indexOf('match-category') === -1,
   lineaCat.trim());
ok('6e · ⚠️ `subcategory` (entrada del semaforo) sigue saliendo del PERFIL, no del panel',
   lineaSub.indexOf('_cronosCurrentUser') !== -1 &&
   lineaSub.indexOf('_matchSub') === -1 &&
   lineaSub.indexOf('match-subcategory') === -1,
   lineaSub.trim());

// El semaforo se calcula con snapCat/snapSub: tienen que seguir siendo los del
// perfil tambien ahi (es la MISMA decision, en otro punto del fichero).
const lineaSnapCat = (SYNC.match(/^\s*const snapCat = .*$/m) || [''])[0];
ok('6f · ⚠️ snapCat (grupo del semaforo) sigue siendo el del perfil',
   lineaSnapCat.indexOf('_cronosCurrentUser') !== -1 &&
   lineaSnapCat.indexOf('match-category') === -1,
   lineaSnapCat.trim());

// `undefined` en un payload de Firestore LANZA (v431). Los campos nuevos
// tienen que terminar en `|| null`, nunca sin respaldo.
ok('6g · los campos nuevos terminan en `|| null` (undefined en Firestore LANZA)',
   /matchCategory:\s*_matchCat\s*\|\|\s*snapCat\s*\|\|\s*null/.test(SYNC) &&
   /matchSubcategory:\s*_matchSub\s*\|\|\s*snapSub\s*\|\|\s*null/.test(SYNC));

// ═══════════ Resultado ═══════════
console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);
