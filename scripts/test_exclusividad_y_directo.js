// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v718 · EL EQUIPO SE BLOQUEA, Y EL ESTADO LLEGA DE VERDAD
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-15, pruebas con el Alevín C):
//
//   1 · «Si un dispositivo intenta abrir o gestionar un equipo que ya tiene una
//       sesión activa en otro lugar, el sistema debe BLOQUEAR el acceso de
//       forma explícita y mostrar un mensaje claro indicando que no es posible
//       trabajar con este equipo a no ser que se retire la prioridad o se
//       cierre la sesión en el otro dispositivo».
//
//   2 · «El cronómetro y los botones de control tienen que estar conectados a
//       una sincronización instantánea. En el momento exacto en que un partido
//       se pausa, reanuda o finaliza, el cambio debe propagarse y actualizarse
//       de inmediato en los paneles de partidos en vivo y terminados,
//       garantizando total veracidad y credibilidad en tiempo real».
//
//  ⚠️ EL PUNTO 1 CAMBIA UNA POLÍTICA SUYA ANTERIOR, Y LO PIDE ÉL. v699 decidió
//  que «en el conflicto decide el usuario», con dos salidas al mismo nivel
//  («Cancelar» / «Tomar el control»): tomarle el equipo a otro aparato costaba
//  un clic y el aviso no se leía. Ahora la respuesta por defecto es NO ENTRAR.
//  🔑 PERO LA SALIDA SIGUE EXISTIENDO, y no es un capricho: si el otro aparato
//  se quedó sin batería en mitad del partido, un bloqueo sin escape dejaría al
//  entrenador fuera de su propio encuentro. Se dicen las TRES vías: cerrar
//  allí, retirar la prioridad desde aquí, o esperar (la marca caduca sola:
//  TTL 75 s con latido de 25 s).
//
//  ⚠️ EL PUNTO 2 CHOCABA CON UN AHORRO MEDIDO, y así se resolvió. El envío de
//  la pausa ya era inmediato, pero era el ÚNICO: si se perdía —en un campo se
//  pierde— el espectador se quedaba con el reloj CORRIENDO, porque live.html
//  cuenta solo desde `phaseStartedAt`. La solución evidente (latir también en
//  pausa) rompe el ahorro de v572 que defiende test_p1_p2_consumo.js (1d):
//  ~15 escrituras regaladas por cada descanso. Así que en pausa se emite SÓLO
//  MIENTRAS EL CAMBIO NO HAYA LLEGADO, comparando los dos sellos de v714
//  (`_cronosUltimoToggleLocal` y `_cronosUltimoLatidoOk`): con el envío
//  confirmado, cero escrituras.
//
//  LO QUE VIGILA:
//   A · el diálogo del conflicto BLOQUEA: su acción principal es no entrar, y
//       el texto dice las tres vías;
//   B · quien no entra vuelve al selector de roles (no se queda en blanco);
//   C · pausar/reanudar/finalizar emiten YA y COMPRUEBAN que la escritura
//       llegó, reintentando una vez;
//   D · el latido en pausa no paga nada si el cambio ya se emitió, y reintenta
//       si no;
//   E · al finalizar, el reloj se para por la puerta única (v716) y el estado
//       'finished' —el que mueve la tarjeta de «En Vivo» a «Terminados»— se
//       emite con la misma garantía.
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
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 400));
        fallos++;
    }
}
function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    if (i < 0) return null;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}
const sinComentarios = (s) => String(s || '').replace(/^\s*\/\/.*$/gm, '');

const LOCK   = leer('js/services/auth/session-lock.js');
const LAUNCH = leer('js/services/auth/role-launch.js');
const SYNC   = leer('js/match/live/sync.js');
const TIMER  = leer('js/match/timer/core.js');
const ACTIVE = leer('js/match/persistence/active-match.js');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [A] el equipo ocupado se BLOQUEA, EJECUTADO ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fn = trozo(LOCK, 'window.cronosSesionPreguntaConflicto = function (info)');
    ok('1a · se encuentra el diálogo del conflicto', !!fn);

    if (fn) {
        // Arnés: un DOM mínimo que guarda el HTML y deja pulsar los botones.
        const montar = () => {
            const nodos = {};
            const ctx = {
                console, Date, String, Promise,
                _desde: () => 'hace 9 minutos',
                escapeHtml: (s) => String(s),
            };
            const crea = () => {
                const el = {
                    id: '', style: { cssText: '' }, innerHTML: '',
                    _manejadores: {},
                    querySelector(sel) {
                        const id = sel.replace('#', '');
                        nodos[id] = nodos[id] || {
                            addEventListener: (ev, cb) => { nodos[id]._cb = cb; },
                        };
                        return nodos[id];
                    },
                    remove() { ctx._quitado = true; },
                };
                return el;
            };
            ctx.document = {
                createElement: crea,
                body: { appendChild: (el) => { ctx._pintado = el; } },
            };
            ctx.window = { escapeHtml: (s) => String(s) };
            vm.createContext(ctx);
            vm.runInContext(fn + ';\n;globalThis.pregunta = window.cronosSesionPreguntaConflicto;', ctx);
            return { ctx, nodos };
        };

        const { ctx, nodos } = montar();
        const p = ctx.pregunta({ etiqueta: 'Entrenador · Alevín C', deviceName: 'Windows · Chrome',
                                 startedAt: Date.now() - 540000 });
        const html = (ctx._pintado && ctx._pintado.innerHTML) || '';

        ok('1b · 🔑🔑 [A] el aviso dice que NO SE PUEDE trabajar con este equipo',
           /No es posible trabajar con este equipo/.test(html),
           html.slice(0, 200));
        ok('1c · 🔑 y nombra el equipo y el aparato que lo tiene',
           /Alevín C/.test(html) && /Windows · Chrome/.test(html));
        ok('1d · 🔑🔑 [A] la acción PRINCIPAL es no entrar',
           /Entendido, no entrar/.test(html) &&
           html.indexOf('Entendido, no entrar') < html.indexOf('Retirar la prioridad'),
           'si tomar el control sigue siendo el botón grande, esto no bloquea nada');
        ok('1e · 🔑 se dicen las TRES vías: cerrar allí, retirar la prioridad, o esperar',
           /cierra la sesión/.test(html) && /retírale la prioridad/i.test(html) &&
           /se libera solo/.test(html),
           'un bloqueo sin salida deja al entrenador fuera de su propio partido');
        ok('1f · ⚠️ y ya no se ofrece «Tomar el control» como si fuera lo normal',
           !/Tomar el control/.test(html));

        // Pulsar el botón principal resuelve FALSE (no entra).
        nodos['cs-cancelar']._cb();
        ok('1g · 🔑 pulsar «no entrar» resuelve que NO se entra',
           p instanceof Promise);
        p.then(v => {
            ok('1h · 🔑🔑 [A] y el valor es false: la plaza no se toca', v === false);

            // Y la otra vía sigue disponible.
            const b = montar();
            const p2 = b.ctx.pregunta({ etiqueta: 'Entrenador · Alevín C' });
            b.nodos['cs-tomar']._cb();
            p2.then(v2 => {
                ok('1i · ⚠️ retirar la prioridad sigue siendo posible (batería muerta)',
                   v2 === true);

                // ═══════════════════════════════════════════════════════════
                console.log('\n── PARTE 2 · [B] quien no entra vuelve a los roles ──');
                // ═══════════════════════════════════════════════════════════
                const zona = sinComentarios(LAUNCH);
                ok('2a · 🔑 [B] si no se puede entrar, se vuelve al selector de roles',
                   /cronosSesionAlEntrar\(\)\.then\(function \(puede\) \{[\s\S]{0,200}?navExitToRoles/.test(zona),
                   'sin esto, bloquear dejaría la pantalla a medias');
                ok('2b · ⚠️ y un fallo de la comprobación NUNCA impide entrar (fail-open de v699)',
                   /\.catch\(function \(\) \{/.test(zona),
                   'sin cobertura en el campo, dejar fuera al entrenador sería peor');

                // ═══════════════════════════════════════════════════════════
                console.log('\n── PARTE 3 · [C] el cambio de estado se emite y se comprueba ──');
                // ═══════════════════════════════════════════════════════════
                const emisor = trozo(SYNC, 'async function cronosEmiteEstadoAhora(status)');
                ok('3a · se encuentra el emisor con garantía', !!emisor);

                if (emisor) {
                    const montarE = (opciones) => {
                        const o = opciones || {};
                        const ctx2 = {
                            console: { warn() { ctx2._avisos = (ctx2._avisos || 0) + 1; } },
                            Date, Promise, setTimeout: (f) => { f(); return 1; },
                            _envios: 0,
                        };
                        ctx2.window = { _cronosUltimoLatidoOk: 0 };
                        ctx2.pushLiveSnapshot = async () => {
                            ctx2._envios++;
                            // Llega al intento que diga el caso (0 = nunca).
                            if (o.llegaEnIntento && ctx2._envios >= o.llegaEnIntento) {
                                ctx2.window._cronosUltimoLatidoOk = Date.now();
                            }
                        };
                        vm.createContext(ctx2);
                        vm.runInContext(emisor + ';\n;globalThis.emite = cronosEmiteEstadoAhora;', ctx2);
                        return ctx2;
                    };

                    (async () => {
                        const bien = montarE({ llegaEnIntento: 1 });
                        const r1 = await bien.emite('active');
                        ok('3b · 🔑 si el primer envío llega, se da por bueno y NO se repite',
                           r1 === true && bien._envios === 1, 'envíos=' + bien._envios);

                        const tarde = montarE({ llegaEnIntento: 2 });
                        const r2 = await tarde.emite('active');
                        ok('3c · 🔑🔑 [C] si NO llega, se reintenta y entonces sí',
                           r2 === true && tarde._envios === 2, 'envíos=' + tarde._envios);

                        const nunca = montarE({ llegaEnIntento: 0 });
                        const r3 = await nunca.emite('finished');
                        ok('3d · ⚠️ y si tampoco, se dice y se sigue (el reloj local no depende de esto)',
                           r3 === false && nunca._envios === 2 && (nunca._avisos || 0) >= 1);
                        ok('3e · ⚠️ UN solo reintento: esto corre al pulsar el botón, no puede ' +
                           'quedarse esperando a la red',
                           nunca._envios === 2);

                        ok('3f · 🔑 el emisor se publica para los tres momentos',
                           /window\.cronosEmiteEstadoAhora = cronosEmiteEstadoAhora/.test(SYNC));
                        ok('3g · 🔑🔑 [C] PAUSAR/REANUDAR lo usan',
                           /cronosEmiteEstadoAhora\('active'\)/.test(sinComentarios(TIMER)));
                        ok('3h · 🔑🔑 [E] FINALIZAR lo usa con el estado «finished»',
                           /cronosEmiteEstadoAhora\('finished'\)/.test(sinComentarios(ACTIVE)),
                           'es el estado que mueve la tarjeta de En Vivo a Terminados');

                        // ═══════════════════════════════════════════════════
                        console.log('\n── PARTE 4 · [D] el latido en pausa no regala escrituras ──');
                        // ═══════════════════════════════════════════════════
                        const lat = SYNC.match(/liveSyncTimer = setInterval\(\(\) => \{[\s\S]*?\}, LIVE_HEARTBEAT_MS\);/);
                        ok('4a · se encuentra el latido', !!lat);

                        if (lat) {
                            const montarL = (est) => {
                                const ctx3 = Object.assign({
                                    console, Date,
                                    liveIsActive: true, isRunning: false,
                                    liveSyncTimer: null,
                                    _envios: 0,
                                    setInterval: (f) => { ctx3._cb = f; return 1; },
                                }, est || {});
                                ctx3.pushLiveSnapshot = () => { ctx3._envios++; };
                                ctx3.window = {
                                    _cronosUltimoToggleLocal: (est && est.pulsado) || 0,
                                    _cronosUltimoLatidoOk:    (est && est.emitido) || 0,
                                };
                                ctx3.LIVE_HEARTBEAT_MS = 15000;
                                vm.createContext(ctx3);
                                vm.runInContext(lat[0], ctx3);
                                return ctx3;
                            };

                            const corriendo = montarL({ isRunning: true });
                            corriendo._cb();
                            ok('4b · con el reloj en marcha, late como siempre', corriendo._envios === 1);

                            const pausaLimpia = montarL({ isRunning: false, pulsado: 1000, emitido: 2000 });
                            pausaLimpia._cb(); pausaLimpia._cb(); pausaLimpia._cb();
                            ok('4c · 🔑🔑 [D] en pausa CON el cambio ya emitido: CERO escrituras ' +
                               '(el ahorro de v572 intacto)',
                               pausaLimpia._envios === 0, 'envíos=' + pausaLimpia._envios);

                            const pausaPerdida = montarL({ isRunning: false, pulsado: 2000, emitido: 1000 });
                            pausaPerdida._cb();
                            ok('4d · 🔑🔑 [D] pero si la pausa NO llegó, se reintenta: el panel ' +
                               'en vivo no puede quedarse con el reloj corriendo',
                               pausaPerdida._envios === 1);

                            const sinPulsar = montarL({ isRunning: false, pulsado: 0, emitido: 0 });
                            sinPulsar._cb();
                            ok('4e · ⚠️ sin ninguna pulsación (partido recién abierto) no se emite nada',
                               sinPulsar._envios === 0);

                            const apagado = montarL({ liveIsActive: false, isRunning: true });
                            apagado._cb();
                            ok('4f · ⚠️ y sin transmisión activa, nada (v717: el desalojado se calla)',
                               apagado._envios === 0);
                        }

                        // ═══════════════════════════════════════════════════
                        console.log('\n── PARTE 5 · [E] al finalizar, el reloj por la puerta única ──');
                        // ═══════════════════════════════════════════════════
                        const fin = sinComentarios(trozo(ACTIVE, 'window.endMatch = function endMatch(skipConfirm = false)'));
                        ok('5a · se encuentra endMatch', !!fin);
                        ok('5b · 🔑 para el reloj por la puerta única de v716',
                           !!fin && /_cronosParaReloj\(\)/.test(fin),
                           'un intervalo huérfano seguiría sumando tiempo a las fichas');
                        ok('5c · 🔑 y deja la fase en «finished» antes de emitir',
                           !!fin && fin.indexOf("matchPhase = 'finished'") < fin.indexOf('cronosEmiteEstadoAhora'));

                        console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
                        if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }
                    })();
                }
            });
        });
    }
}
