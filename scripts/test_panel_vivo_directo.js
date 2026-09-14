// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v708 · EL PANEL EN VIVO SE ACTUALIZA SOLO (Y SUENA)
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (capturas 10362-10371): «cuando un partido está en
//  marcha, los eventos sucesivos —sustituciones, tarjetas o nuevos goles tras
//  el primero— no se actualizan de forma fluida en el bloque de ÚLTIMOS
//  SUCESOS del panel general hasta que el usuario entra explícitamente en la
//  vista detallada del partido. Hay que asegurar que el oyente… escuche y
//  pinte los cambios de manera totalmente automática y continua, sin requerir
//  la apertura manual del visor para refrescar los sucesos visual y
//  sonoramente».
//
//  🔑 DOS DEFECTOS, UNO EN CADA PANTALLA:
//
//   A · EL ÁREA DE FAMILIAS NO TENÍA OYENTE NINGUNO. `ppLive` leía con
//       `getDocs`, que es UNA FOTO: marcador, cronómetro y el mini-feed de
//       v706 se congelaban en el instante de abrir la pestaña. Lo único que
//       los refrescaba era salir y volver a entrar — de ahí la impresión de
//       que había que pasar por el visor.
//
//   B · EN EL VISOR, LO QUE SE PINTA Y LO QUE SUENA IBAN A DOS RELOJES. La
//       lista tiene `onSnapshot` (v433), pero los avisos y el sonido salen de
//       los vigilantes por partido, que sólo se daban de alta en un sondeo de
//       **30 s**: un partido recién aparecido pintaba sucesos EN SILENCIO
//       hasta medio minuto, y al llegar el vigilante la siembra de v676 se los
//       daba por vistos sin anunciarlos jamás.
//
//  LO QUE VIGILA ESTE FICHERO:
//
//   · que el panel de familias escuche `live_index` con `onSnapshot` — el
//     documento LIGERO, porque el gordo son 17-23 KB por latido y por familia
//     (la medición de v576);
//   · que el oyente se cierre por los DOS caminos: al cambiar de pestaña y,
//     sobre todo, comprobando en cada snapshot que su contenedor sigue en
//     pantalla (del panel se sale por cinco sitios: enganchar cinco es la
//     receta para olvidar el sexto — lección de v692);
//   · que los sucesos NUEVOS se anuncien y los VIEJOS no (siembra silenciosa
//     por partido, v676), con tope de avisos por tanda;
//   · que el sonido sea LA MISMA campana de la app y se pueda silenciar;
//   · y que la lista del visor pida el alta del vigilante en cuanto ve un
//     partido sin él, con freno para no repetirlo en cada latido.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const PP    = leer('js/parent/panel.js');
const LIVE  = leer('live.html');
const FEED  = leer('js/shared/live-feed.js');
const SOUND = leer('js/shared/live-sound.js');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [DEFECTO A] el Área de Familias ESCUCHA ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const ppLive = PP.slice(PP.indexOf('window.ppLive = async () => {'),
                            PP.indexOf('// TAB 2 · MENSAJES'));
    ok('1a · se encuentra ppLive', ppLive.length > 500);

    ok('1b · 🔑🔑 [DEFECTO A] la pestaña se suscribe con onSnapshot',
       /onSnapshot\(_consulta\('live_index'\), alRecibir, alFallar\)/.test(ppLive),
       'antes era un getDocs: una foto que no se volvía a refrescar nunca');

    ok('1c · 🔑 y lee el ÍNDICE LIGERO, no el documento del partido',
       /_consulta\('live_index'\)/.test(ppLive),
       'el gordo son 17-23 KB por latido Y POR FAMILIA (v576)');

    ok('1d · el getDocs que queda es SÓLO la red de seguridad del índice vacío',
       (ppLive.match(/getDocs\(/g) || []).length === 1 &&
       /if \(!matches\.length && !respaldoVacioPedido\)/.test(ppLive),
       'un partido anterior al índice no puede desaparecer del panel');

    ok('1e · si la consulta al índice falla, se cae al documento del partido',
       /const alFallar = \(err\) =>/.test(ppLive) &&
       /onSnapshot\(_consulta\('live_matches'\), alRecibir/.test(ppLive));

    ok('1f · 🔑 cada snapshot comprueba que su contenedor sigue en pantalla',
       /if \(!_vivo\(\)\) \{ window\._ppLiveCierra\(\); return; \}/.test(ppLive),
       'del panel se sale por cinco caminos: enganchar cinco olvida el sexto (v692)');

    ok('1g · …y el cambio de pestaña también cierra el oyente',
       /window\.ppTab = \(tab, btn\) => \{[\s\S]{0,600}?_ppLiveCierra\(\)/.test(PP),
       'sin esto, quien pasa a Mensajes deja un canal abierto contra Firestore');

    ok('1h · la baja libera también el registro de sucesos vistos',
       /window\._ppLiveCierra = function[\s\S]{0,400}?_ppLiveVistos = null/.test(PP));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · los avisos de sucesos, EJECUTADOS ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // 🔑 EL TROZO INCLUYE `pinta`, y no es un detalle: la mitad del arreglo de
    // v709 es que el REPINTADO de la lista (que borra las tarjetas enteras cada
    // ~5 s) vuelva a dibujar los avisos desde el estado. Midiendo sólo
    // `anuncia` se daría por bueno un panel que pierde el aviso al primer
    // latido — que es justo la trampa nº1 que documenta el guard de los avisos
    // por tarjeta del visor (v466).
    const bloque = PP.slice(PP.indexOf('const _claveSuceso = (ev) => {'),
                            PP.indexOf('// ── El oyente ──'));
    ok('2a · se encuentra el bloque de avisos y el pintado de tarjetas',
       bloque.length > 400 && /const pinta = \(matches\) =>/.test(bloque));

    // ⚠️ v709 · LOS AVISOS YA NO SON UN `showToast` GLOBAL. Van DENTRO de la
    // tarjeta de su partido —«a la altura exacta de su panel», pidió el
    // autor—, así que lo que se mide es el HTML de cada hueco `pp-av-<id>`.
    // Y el sonido ya no es la campana general: es la melodía del suceso.
    const montar = (mudo) => {
        const huecos = {};          // id de partido → hueco de avisos simulado
        const sonidos = [];         // tipos que han sonado, en orden
        const hueco = (id) => {
            if (!huecos[id]) huecos[id] = { _h: '',
                set innerHTML(v) { this._h = String(v); },
                get innerHTML() { return this._h; } };
            return huecos[id];
        };
        // El contenedor de las tarjetas. Su `innerHTML` se comporta como el
        // real: al repintar, los huecos de avisos anteriores DESAPARECEN y
        // nacen vacíos los de las tarjetas nuevas.
        const contenedor = {
            _h: '',
            set innerHTML(v) {
                this._h = String(v);
                Object.keys(huecos).forEach(k => { delete huecos[k]; });
                (this._h.match(/id="pp-av-([^"]+)"/g) || []).forEach(trozo => {
                    hueco(/id="pp-av-([^"]+)"/.exec(trozo)[1]);
                });
            },
            get innerHTML() { return this._h; }
        };
        const ctx = {
            console: { log() {}, warn() {} },
            window: {},
            Set, Map, String, Number, Array, Object, Date, Math, JSON,
            setTimeout: (fn) => { fn(); return 0; },
            setInterval: () => 0, clearInterval: () => {},
            escapeHtml: (s) => String(s == null ? '' : s),
            escapeAttr: (s) => String(s == null ? '' : s),
            formatTime: (s) => String(s),
            location: { origin: 'http://x', pathname: '/index.html' },
            document: {
                getElementById: (id) => {
                    if (id === 'pp-live-cards') return contenedor;
                    const m = /^pp-av-(.+)$/.exec(id);
                    return m ? hueco(m[1]) : null;
                }
            },
        };
        ctx.window.window = ctx.window;
        vm.createContext(ctx);
        // Los módulos REALES: `items` decide qué suceso entra y
        // `cronosLiveSound` qué melodía suena.
        vm.runInContext(FEED, ctx);
        vm.runInContext(SOUND, ctx);
        ctx.window.cronosLiveSound.reproduce = (tipo) => { sonidos.push(tipo); return true; };
        vm.runInContext('const _vacio = "(vacío)";\n' +
                        'function _ppLiveMudo() { return ' + (mudo ? 'true' : 'false') + '; }\n' +
                        bloque +
                        '\n;globalThis.anuncia = anuncia;' +
                        '\n;globalThis.pinta = pinta;' +
                        '\n;globalThis.pintaAvisos = _ppPintaAvisos;', ctx);
        ctx.window._ppLiveVistos = new Map();
        return {
            ctx, sonidos, huecos,
            avisosDe: (id) => (ctx.window._ppAvisos && ctx.window._ppAvisos.get(id)) || [],
            htmlDe: (id) => hueco(id).innerHTML,
        };
    };

    const partido = (eventos) => ({
        _id: 'm1',
        homeTeam: { name: 'LAS ROSAS' }, awayTeam: { name: 'ARINAGA REGIONAL' },
        lastEvents: eventos,
    });
    const gol   = { eventId: 'e1', type: 'goal',   text: 'GOL · WALID', matchTime: '1T 00:05', team: 'away', createdAt: 1000 };
    const cambio= { eventId: 'e2', type: 'sub',    text: 'ARINAGA | ▲ SALE: DANI | ▼ ENTRA: OMAR',
                    subOutName: 'DANI', subInName: 'OMAR', matchTime: '1T 00:21', team: 'away', createdAt: 2000 };
    const tarj  = { eventId: 'e3', type: 'yellow', text: 'TARJETA AMARILLA · CHRISTIAN', matchTime: '1T 01:10', team: 'away', createdAt: 3000 };

    // ── siembra silenciosa: abrir la pestaña con el partido ya empezado ──
    {
        const e = montar(false);
        e.ctx.anuncia([partido([gol])]);
        ok('2b · 🔑 [v676] al abrir, el suceso que YA estaba no se canta',
           e.avisosDe('m1').length === 0 && e.sonidos.length === 0,
           'avisos=' + JSON.stringify(e.avisosDe('m1')));

        // …y el siguiente suceso SÍ, sin volver a anunciar el primero.
        e.ctx.anuncia([partido([gol, cambio])]);
        ok('2c · 🔑🔑 [EL DEFECTO] el suceso SIGUIENTE se anuncia solo',
           e.avisosDe('m1').length === 1 && /OMAR/.test(e.avisosDe('m1')[0].txt),
           JSON.stringify(e.avisosDe('m1')));
        ok('2d · …con su icono, su minuto y su equipo',
           /^🔄 0'/.test(e.avisosDe('m1')[0].txt) &&
           /ARINAGA REGIONAL/.test(e.avisosDe('m1')[0].txt),
           e.avisosDe('m1')[0].txt);
        ok('2e · 🔑🔑 [v709] y suena EL SONIDO DEL SUCESO, no un pitido general',
           e.sonidos.length === 1 && e.sonidos[0] === 'sub',
           'sonó: ' + JSON.stringify(e.sonidos));
        ok('2f · 🔑 el aviso se pinta DENTRO de la tarjeta de SU partido',
           /pp-live-aviso/.test(e.htmlDe('m1')) && /OMAR/.test(e.htmlDe('m1')),
           e.htmlDe('m1'));

        // Repetir el mismo snapshot no puede volver a anunciar.
        e.ctx.anuncia([partido([gol, cambio])]);
        ok('2g · un snapshot repetido NO reanuncia (identidad por eventId)',
           e.avisosDe('m1').length === 1 && e.sonidos.length === 1);

        e.ctx.anuncia([partido([gol, cambio, tarj])]);
        ok('2h · la tarjeta posterior también se anuncia, y se apila',
           e.avisosDe('m1').length === 2 && /CHRISTIAN/.test(e.avisosDe('m1')[1].txt) &&
           e.sonidos[1] === 'yellow',
           JSON.stringify(e.sonidos));
    }

    // ── el tope por tarjeta y UN solo sonido por tanda ──
    {
        const e = montar(false);
        e.ctx.anuncia([partido([])]);                       // siembra en vacío
        const muchos = [];
        for (let i = 0; i < 8; i++) {
            muchos.push({ eventId: 'x' + i, type: 'goal', text: 'GOL · J' + i,
                          matchTime: '1T 0' + i + ':00', team: 'away', createdAt: 100 + i });
        }
        e.ctx.anuncia([partido(muchos)]);
        ok('2i · ⚠️ una tanda de ocho sucesos no tapa la tarjeta: 3 avisos',
           e.avisosDe('m1').length === 3,
           'la cascada de v676: ' + e.avisosDe('m1').length + ' avisos');
        ok('2j · 🔑🔑 [v709] y suena UNA vez, no ocho melodías solapadas',
           e.sonidos.length === 1,
           'es la «interferencia» que pidió quitar: ' + JSON.stringify(e.sonidos));
    }

    // ── la prioridad: de una tanda mixta manda el suceso que más pesa ──
    {
        const e = montar(false);
        e.ctx.anuncia([partido([])]);
        e.ctx.anuncia([partido([
            { eventId: 'p1', type: 'sub',    text: 'X | ▲ SALE: A | ▼ ENTRA: B', createdAt: 10 },
            { eventId: 'p2', type: 'red',    text: 'TARJETA ROJA · C',           createdAt: 11 },
            { eventId: 'p3', type: 'yellow', text: 'TARJETA AMARILLA · D',       createdAt: 12 }])]);
        ok('2k · 🔑 con un cambio, una roja y una amarilla juntas, suena la ROJA',
           e.sonidos.length === 1 && e.sonidos[0] === 'red',
           JSON.stringify(e.sonidos));
    }

    // ── silenciado ──
    {
        const e = montar(true);
        e.ctx.anuncia([partido([gol])]);
        e.ctx.anuncia([partido([gol, cambio])]);
        ok('2l · silenciado: el aviso se VE en su tarjeta pero no suena',
           e.avisosDe('m1').length === 1 && e.sonidos.length === 0);
    }

    // ── lo que no es un suceso de juego no puede asomar ──
    {
        const e = montar(false);
        e.ctx.anuncia([partido([gol])]);
        e.ctx.anuncia([partido([gol,
            { eventId: 'c1', type: 'comment', text: 'COMENTARIO · subir la línea', createdAt: 4000 },
            { eventId: 't1', type: 'tactical_move', text: '{"x":1}', createdAt: 5000 }])]);
        ok('2m · 🔑 ni un comentario del cuerpo técnico ni la telemetría táctica',
           e.avisosDe('m1').length === 0 && e.sonidos.length === 0,
           JSON.stringify(e.avisosDe('m1')));
    }

    // ── MULTIPARTIDO: cada tarjeta, lo suyo ──
    {
        const e = montar(false);
        const otro = (eventos) => ({ _id: 'm2', homeTeam: { name: 'A' }, awayTeam: { name: 'B' },
                                     lastEvents: eventos });
        e.ctx.anuncia([partido([gol]), otro([gol])]);
        ok('2n · 🔑 un partido que aparece MÁS TARDE no canta su historial',
           e.avisosDe('m1').length === 0 && e.avisosDe('m2').length === 0,
           'la siembra es POR PARTIDO, no una bandera global');

        // Un suceso en CADA partido, en la misma tanda.
        e.ctx.anuncia([partido([gol, tarj]), otro([gol, cambio])]);
        ok('2o · 🔑🔑 [MULTIPARTIDO] el aviso de cada partido va a SU tarjeta',
           /CHRISTIAN/.test(e.htmlDe('m1')) && !/OMAR/.test(e.htmlDe('m1')) &&
           /OMAR/.test(e.htmlDe('m2')) && !/CHRISTIAN/.test(e.htmlDe('m2')),
           'm1=' + e.htmlDe('m1') + ' | m2=' + e.htmlDe('m2'));
        ok('2p · …y suena UNA sola vez para los dos, el suceso que más pesa',
           e.sonidos.length === 1 && e.sonidos[0] === 'yellow',
           JSON.stringify(e.sonidos));
    }

    // ── los avisos caducan, y el repintado no se los lleva ──
    {
        const e = montar(false);
        e.ctx.anuncia([partido([gol])]);
        e.ctx.anuncia([partido([gol, cambio])]);
        ok('2q · el aviso está en la tarjeta', /OMAR/.test(e.htmlDe('m1')));
        // 🔑 EL LATIDO REPINTA LA LISTA ENTERA, que es lo que borra las
        // tarjetas y sus huecos. `pinta` tiene que devolver los avisos vivos
        // DESDE EL ESTADO. Es la trampa nº1 de v466.
        e.ctx.pinta([partido([gol, cambio])]);
        ok('2r · 🔑🔑 tras el REPINTADO de la lista sigue ahí (es ESTADO, no DOM)',
           /OMAR/.test(e.htmlDe('m1')),
           'un aviso inyectado a mano lo borraría el latido de 5 s; hueco=' + e.htmlDe('m1'));
        // Y cuando caduca, se va solo.
        e.avisosDe('m1').forEach(a => { a.hasta = Date.now() - 1; });
        e.ctx.pintaAvisos('m1');
        ok('2s · y al caducar desaparece', e.htmlDe('m1') === '');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · el sonido característico, y se puede callar ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // 🔊 v709 · Las cinco melodías se mudaron a js/shared/live-sound.js: las
    // comparten el visor y el panel de familias. Antes el panel sonaba con la
    // CAMPANA GENERAL de los avisos push — el «sonido general» del encargo.
    ok('3a · el módulo compartido expone las cinco melodías',
       /goal:/.test(SOUND) && /yellow:/.test(SOUND) && /red:/.test(SOUND) &&
       /sub:/.test(SOUND) && /injury:/.test(SOUND));

    ok('3b · 🔑 live.html las toca desde el módulo (no tiene su propia tabla)',
       /S\.reproduce\(type, ctx\)/.test(LIVE) &&
       !/goal:\s*\[\[660/.test(LIVE),
       'dos tablas de melodías divergen: cambiar el gol dejaría una pantalla con el viejo');

    ok('3c · …y le PRESTA su AudioContext (el del keep-alive de iOS)',
       /_playSeq\(ctx, type\)/.test(LIVE) && /reproduce\(type, ctx\)/.test(LIVE),
       'dos contextos en un iPhone dejan el segundo mudo');

    ok('3d · 🔑🔑 el panel de familias ya NO suena con la campana general',
       !/cronosCampana/.test(PP) && /cronosLiveSound\.reproduce/.test(PP),
       'era el «pitido general» que el autor pidió quitar');

    ok('3e · el silencio se recuerda entre sesiones',
       /cronos_pp_live_mudo/.test(PP) && /localStorage\.setItem\(_PP_LIVE_MUDO/.test(PP));

    ok('3f · y el botón del panel lo alterna',
       /window\.ppLiveToggleSonido = function/.test(PP) &&
       /id="pp-live-sound"/.test(PP));

    ok('3g · ⚠️ al activarlo DESBLOQUEA el audio con el gesto del usuario',
       /cronosLiveSound\.desbloquea\(\)/.test(PP),
       'después los sucesos llegan por Firestore, sin gesto, y ya no habría ocasión');

    ok('3h · los dos documentos cargan el módulo del sonido',
       /src="js\/shared\/live-sound\.js/.test(leer('index.html')) &&
       /src="js\/shared\/live-sound\.js/.test(LIVE) &&
       /live-sound\.js/.test(leer('sw.js')));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · [DEFECTO B] en el visor, ver un partido es oírlo ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // El bloque va dentro de su propio try/catch: se corta DESDE el `try` o el
    // trozo saldría con una llave de menos.
    const ini = LIVE.lastIndexOf('try {', LIVE.indexOf('const _faltaVigilante = liveMatches.some'));
    const fin = LIVE.indexOf("listEl.innerHTML = '';", ini);
    ok('4a · se encuentra el alta de vigilantes de la lista', ini > 0 && fin > ini);

    const correr = (conVigilante, ultimaAlta) => {
        let altas = 0;
        const ctx = {
            console: { warn() {} },
            liveMatches: [{ id: 'm1' }, { id: 'm2' }],
            _bgWatchers: conVigilante ? { m1: () => {}, m2: () => {} } : { m1: () => {} },
            refreshBackgroundWatchers: () => { altas++; },
            window: { _cronosUltimoAltaVigilantes: ultimaAlta },
            Date,
        };
        vm.createContext(ctx);
        vm.runInContext(LIVE.slice(ini, fin), ctx);
        return { altas, sello: ctx.window._cronosUltimoAltaVigilantes };
    };

    const falta = correr(false, 0);
    ok('4b · 🔑🔑 un partido SIN vigilante pide el alta en el acto',
       falta.altas === 1,
       'antes había que esperar al sondeo de 30 s, y con la siembra de v676 ' +
       'esos sucesos no se anunciaban nunca');

    ok('4c · con todos vigilados no se pide nada',
       correr(true, 0).altas === 0,
       'en régimen normal esto no se ejecuta jamás');

    ok('4d · ⚠️ y hay FRENO: la lista se repinta en cada latido de cada partido',
       correr(false, Date.now()).altas === 0,
       'sin freno, diez partidos lo llamarían decenas de veces por minuto');

    ok('4e · el sello del freno se actualiza al pedir el alta',
       falta.sello > 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos ? 1 : 0);
