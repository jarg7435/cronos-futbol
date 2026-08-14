// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v459 — La descarga trae el partido ENTERO y la ✕ devuelve al listado
// ═══════════════════════════════════════════════════════════════════════════
// Dos incidencias críticas de implementar.txt (capturas 8446-8450):
//   1. El fichero descargado de un partido terminado contenía sólo la primera
//      parte. Debe traer el partido completo: 1ª, 2ª y tiempos añadidos.
//   2. Al salir con la ✕ de un partido terminado, la app dejaba a la vista un
//      campo de fútbol vacío en lugar del panel de "Partidos Terminados". El
//      retorno debe ser idéntico en PC, iPad/tablet y móvil.
//
// ⚠️ NO SE MIRA EL CÓDIGO FUENTE PARA LO QUE SE PUEDE EJECUTAR. El reproductor
// se carga de verdad en un sandbox con un DOM y un MediaRecorder de mentira y un
// RELOJ CONTROLADO, y se mide qué hace: desde qué instante graba, hasta cuál
// llega, si se detiene sola y qué capa queda a la vista al cerrar. Medido así
// sobre el código anterior: la grabación empezaba donde estuviera el cursor,
// avanzaba UN SEGUNDO DE PARTIDO POR SEGUNDO DE RELOJ (73 minutos para un
// partido de 73:40) y no se cerraba nunca sola.
//
// Red-check: CRONOS_REPLAY_JS=<ruta> apunta a una copia mutada.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const RUTA_REPLAY = process.env.CRONOS_REPLAY_JS || path.join(RAIZ, 'js/match/replay/replay-player.js');
const SRC = fs.readFileSync(RUTA_REPLAY, 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}

// ── Reloj controlado ───────────────────────────────────────────────────────
function crearReloj() {
    let ahora = 0, sig = 1;
    const tareas = new Map();
    return {
        ahora: () => ahora,
        vivos: () => tareas.size,
        setInterval(fn, ms) { const id = sig++; tareas.set(id, { fn, ms, next: ahora + ms, rep: true }); return id; },
        setTimeout(fn, ms)  { const id = sig++; tareas.set(id, { fn, ms, next: ahora + ms, rep: false }); return id; },
        clear(id) { tareas.delete(id); },
        avanza(ms) {
            const fin = ahora + ms;
            for (;;) {
                let idMin = null, tMin = Infinity;
                for (const [id, t] of tareas) if (t.next <= fin && t.next < tMin) { tMin = t.next; idMin = id; }
                if (idMin === null) break;
                const t = tareas.get(idMin);
                ahora = t.next;
                if (t.rep) t.next = ahora + t.ms; else tareas.delete(idMin);
                t.fn();
            }
            ahora = fin;
        },
    };
}

// ── DOM de mentira: sólo lo que el reproductor toca ────────────────────────
function elemento(id) {
    return { id, innerHTML: '', textContent: '', value: '', style: {}, children: [],
             attrs: {},
             appendChild() {}, remove() { this.quitado = true; },
             // v530 · Los atributos se GUARDAN: el guard necesita ver a qué
             // función apunta el botón cuando el vídeo ya está listo.
             setAttribute(k, v) { this.attrs[k] = v; },
             getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : ''; },
             querySelector() { return null; },
             querySelectorAll() { return []; }, click() { this.clicked = true; },
             addEventListener() {} };
}

// `compartir` simula un dispositivo táctil capaz de entregar ficheros por el
// menú nativo (iOS 15+, Android). Sin él se simula un PC, donde la descarga por
// enlace es la vía buena y NO se puede tocar: ahí ya funciona.
function entorno({ compartir = false } = {}) {
    const reloj = crearReloj();
    const reg = {};
    ['replay-pitch-players','replay-bench-home','replay-bench-away','replay-score-home',
     'replay-score-away','replay-timer-display','replay-phase-display','replay-seekbar',
     'replay-seek-curr','replay-pitch-container','btn-replay-record','btn-replay-play',
     'setup-modal'].forEach(id => { reg[id] = elemento(id); });
    reg['setup-modal'].style.display = 'flex';   // el listado está abierto

    const descargas = [];
    const grabadoras = [];
    const lienzos = [];
    const compartidos = [];
    let rechazaCompartir = null;   // se puede forzar un "el usuario canceló"
    class GrabadoraFalsa {
        constructor() { this.state = 'inactive'; grabadoras.push(this); }
        start() { this.state = 'recording'; this.inicio = reloj.ahora(); }
        stop() {
            if (this.state !== 'recording') return;
            this.state = 'inactive'; this.fin = reloj.ahora();
            if (this.ondataavailable) this.ondataavailable({ data: { size: 10 } });
            if (this.onstop) this.onstop();
        }
    }
    GrabadoraFalsa.isTypeSupported = () => true;

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: (id) => reg[id] || null,
            createElement: (tag) => {
                const el = elemento('');
                el.tag = tag;
                if (tag === 'canvas') {
                    el.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
                    // v526 · La pista tiene que ser OBSERVABLE: mientras siga
                    // viva, la captura del canvas sigue consumiendo memoria.
                    // Antes esto devolvía `{ getTracks: () => [] }`, un objeto
                    // nuevo y VACÍO en cada llamada: cualquier aserción sobre
                    // el cierre de las pistas salía verde sin medir nada.
                    const pistas = [{ kind: 'video', parada: false,
                                      stop() { this.parada = true; } }];
                    el._stream = { getTracks: () => pistas };
                    el.captureStream = () => el._stream;
                    lienzos.push(el);
                }
                if (tag === 'a') { descargas.push(el); }
                return el;
            },
            querySelectorAll: () => [],
            body: { appendChild(el) { if (el && el.id) reg[el.id] = el; } },
            head: { appendChild() {} },
        },
        setInterval: (fn, ms) => reloj.setInterval(fn, ms),
        clearInterval: (id) => reloj.clear(id),
        setTimeout: (fn, ms) => reloj.setTimeout(fn, ms),
        clearTimeout: (id) => reloj.clear(id),
        MediaRecorder: GrabadoraFalsa,
        // 🔑 El Blob real COPIA los datos al construirse: vaciar el array de
        // trozos después no lo estropea. El falso tiene que copiar también, o
        // el guard mediría un artefacto suyo en lugar del comportamiento.
        // ⚠️ Y GUARDA EL `type`: el Blob real lo expone, y de él sale el tipo
        // del fichero que se comparte, que es lo que mira iOS para decidir con
        // qué app abrirlo. Sin esto la aserción del tipo medía mi propio hueco.
        Blob: class {
            constructor(p, o) {
                this.parts = Array.isArray(p) ? p.slice() : p;
                this.type = (o && o.type) || '';
            }
        },
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
        escapeHtml: (s) => String(s == null ? '' : s),
        showToast: () => {},
        File: class { constructor(p, n, o) { this.parts = p; this.name = n; this.type = (o && o.type) || ''; } },
        _reg: reg, _reloj: reloj, _descargas: descargas, _grabadoras: grabadoras,
        _lienzos: lienzos, _compartidos: compartidos,
        _navReloads: 0,
    };
    // Menú nativo de compartir. En el táctil es la vía que NO navega; en el PC
    // no existe y se cae al enlace de descarga de siempre.
    sb.navigator = compartir ? {
        canShare: (d) => !!(d && d.files && d.files.length),
        share: (d) => {
            if (rechazaCompartir) {
                const e = new Error('cancelado'); e.name = rechazaCompartir;
                rechazaCompartir = null;
                return Promise.reject(e);
            }
            compartidos.push(d);
            return Promise.resolve();
        },
    } : {};
    sb._cancelaElProximoCompartir = (nombre) => { rechazaCompartir = nombre || 'AbortError'; };
    sb.navReload = () => { sb._navReloads++; };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC, sb);
    return sb;
}

// ── Partidos de prueba, tal y como los guarda pushLiveSnapshot ─────────────
// 🔑 timeH1/timeH2 son los ACUMULADOS del cronómetro: llevan el descuento
// dentro (v446). half1MaxTime/half2MaxTime son sólo el reglamento.
const partidoF7 = () => ({
    id: 'lm-f7', mode: 'f7', status: 'finished',
    half1MaxTime: 2100, half2MaxTime: 2100,      // reglamento: 70:00
    timeH1: 2180, timeH2: 2240,                   // jugado: 73:40 (con descuento)
    homeTeam: { name: 'CRONOS', score: 2 }, awayTeam: { name: 'RIVAL', score: 1 },
    players: [{ id: 1, number: 1, name: 'Alba', team: 'home', status: 'field', x: 20, y: 50 }],
    events: [
        { type: 'goal', text: 'GOL · Alba', matchTime: '1T 10:00' },
        { type: 'goal', text: 'GOL · Alba', matchTime: '2T 60:00' },
    ],
});
const partidoF11 = () => ({
    id: 'lm-f11', mode: 'f11', status: 'finished',
    half1MaxTime: 2700, half2MaxTime: 2700,      // reglamento: 90:00
    timeH1: 2820, timeH2: 2900,                   // jugado: 95:20
    homeTeam: { name: 'CRONOS', score: 1 }, awayTeam: { name: 'RIVAL', score: 0 },
    players: [{ id: 1, number: 1, name: 'Alba', team: 'home', status: 'field', x: 20, y: 50 }],
    events: [{ type: 'goal', text: 'GOL · Alba', matchTime: '2T 93:00' }],
});
const seg = (txt) => { const [m, s] = String(txt || '0:0').split(':').map(Number); return (m || 0) * 60 + (s || 0); };

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · la descarga trae el partido ENTERO ──');
// ───────────────────────────────────────────────────────────────────────────
// ⚠️ SÍNCRONO A PROPÓSITO. `openMatchReplay` está declarada `async`, pero con un
// OBJETO de partido no ejecuta ningún `await` (el `import()` sólo está en la rama
// que lee de Firestore por id), así que cuando devuelve ya ha pintado todo. Poner
// aquí un `await` obligaría a que el guard entero fuese asíncrono sin ganar nada.
function exporta(partido, { dejarCursorEn = 0, esperaMs = 5 * 60 * 1000 } = {}) {
    const sb = entorno();
    sb.window.openMatchReplay(partido);
    if (dejarCursorEn) sb.window._replaySeek(dejarCursorEn);
    sb.window._replayRecordVideo();
    const rec = sb._grabadoras[0];
    const arranque = sb._reg['replay-seek-curr'].textContent;
    sb._reloj.avanza(esperaMs);
    return { sb, rec, arranque };
}

{
    const P = partidoF7();
    const totalPartido = P.timeH1 + P.timeH2;      // 4420 s
    // El usuario ha estado viendo el partido y lo deja por el minuto 30.
    const { sb, rec, arranque } = exporta(P, { dejarCursorEn: 1800 });

    ok('1a · 🔑 la grabación REBOBINA a 00:00 (antes empezaba donde estuviera el cursor)',
       arranque === '00:00', arranque);
    ok('1b · 🔑 recorre el partido ENTERO, descuento incluido',
       seg(sb._reg['replay-seek-curr'].textContent) === totalPartido,
       sb._reg['replay-seek-curr'].textContent + ' de ' + Math.floor(totalPartido / 60) + ':' + (totalPartido % 60));
    ok('1b2 · …y eso es MÁS que el tiempo reglamentario (el descuento cuenta)',
       totalPartido > (P.half1MaxTime + P.half2MaxTime));
    ok('1c · 🔑 se detiene SOLA (antes sólo paraba si el usuario pulsaba Detener)',
       rec && rec.state !== 'recording', rec ? rec.state : 'sin grabadora');
    ok('1d · y descarga el fichero sin intervención',
       sb._descargas.some(a => /^partido_repeticion_\d+\.(webm|mp4)$/.test(a.download || '') && a.clicked),
       JSON.stringify(sb._descargas.map(a => a.download)));
    // 🔑 DURACIÓN PEDIDA POR EL AUTOR: "más lento, a unos 2 minutos" (2026-08-06,
    // tras ver la primera versión de ~1 min). La horquilla es generosa por
    // arriba y por abajo porque el paso se redondea a segundos enteros, pero
    // deja fuera tanto el tiempo real (73 min) como un pase acelerado ilegible.
    ok('1e · 🔑 la grabación dura ~2 minutos, como pidió el autor (90-150 s)',
       rec && (rec.fin - rec.inicio) >= 90000 && (rec.fin - rec.inicio) <= 150000,
       rec ? Math.round((rec.fin - rec.inicio) / 1000) + ' s' : '—');
    ok('1e2 · …y desde luego no es el tiempo real del partido',
       rec && (rec.fin - rec.inicio) < (P.timeH1 + P.timeH2) * 1000 / 4,
       rec ? Math.round((rec.fin - rec.inicio) / 1000) + ' s de ' + (P.timeH1 + P.timeH2) + ' s jugados' : '—');
    ok('1f · el vídeo llega a la SEGUNDA PARTE (el rótulo de fase lo dice)',
       sb._reg['replay-phase-display'].textContent === '2ª PARTE',
       sb._reg['replay-phase-display'].textContent);
    ok('1g · el botón informa del avance mientras graba (para que nadie lo corte)',
       /Grabando/.test(String(sb._reg['btn-replay-record'].innerHTML)) ||
       /Descargar/.test(String(sb._reg['btn-replay-record'].innerHTML)),
       String(sb._reg['btn-replay-record'].innerHTML).slice(0, 60));
    ok('1g2 · y al terminar el botón vuelve a su estado normal',
       /Descargar Vídeo/.test(String(sb._reg['btn-replay-record'].innerHTML)),
       String(sb._reg['btn-replay-record'].innerHTML).slice(0, 60));
}
{
    // F11: 95:20 jugados. La misma exportación tiene que cubrirlo entero.
    const P = partidoF11();
    const totalPartido = P.timeH1 + P.timeH2;
    const { sb, rec } = exporta(P);
    ok('1h · 🔑 en F11 también llega al final (95:20, no los 90 del reglamento)',
       seg(sb._reg['replay-seek-curr'].textContent) === totalPartido,
       sb._reg['replay-seek-curr'].textContent);
    ok('1h2 · y también se cierra sola', rec && rec.state !== 'recording');
    ok('1h3 · con una duración parecida a la de F7 (el ritmo se adapta a la del partido)',
       rec && (rec.fin - rec.inicio) >= 90000 && (rec.fin - rec.inicio) <= 150000,
       rec ? Math.round((rec.fin - rec.inicio) / 1000) + ' s' : '—');
}
{
    // Partido corto (suspendido a los 12 minutos): no se inventa duración.
    const P = Object.assign(partidoF7(), { timeH1: 720, timeH2: 0, events: [] });
    const { sb, rec } = exporta(P);
    ok('1i · un partido suspendido se exporta hasta donde llegó, sin rellenar',
       seg(sb._reg['replay-seek-curr'].textContent) === 720,
       sb._reg['replay-seek-curr'].textContent);
    ok('1i2 · y también se cierra sola', rec && rec.state !== 'recording');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · la ✕ devuelve al listado, no al campo vacío ──');
// ───────────────────────────────────────────────────────────────────────────
// 🔑 El síntoma no lo causaba el botón, sino LAS CAPAS: el reproductor es una
// capa opaca sobre todo; debajo estaba #setup-modal (donde vive el listado) y
// el botón "Revivir" lo ocultaba antes de abrirlo, dejando a la vista
// #main-container, o sea el campo.
{
    const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '')
                         .replace(/<!--[\s\S]*?-->/g, '')
                         .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    const appInit = sinCom(fs.readFileSync(
        process.env.CRONOS_APPINIT_JS || path.join(RAIZ, 'js/core/app-init.js'), 'utf8'));
    const finished = sinCom(fs.readFileSync(path.join(RAIZ, 'js/coach/reports/finished-matches-tab.js'), 'utf8'));

    ok('2a · 🔑 el botón "Revivir" del listado del entrenador ya NO oculta la capa del listado',
       !/style\.display\s*=\s*'none'\s*;\s*window\.openMatchReplay/.test(appInit),
       'era la causa: sin #setup-modal debajo, la ✕ deja a la vista el campo');
    ok('2a2 · y sigue abriendo la repetición',
       /window\.openMatchReplay\('\$\{m\.id\}'\)/.test(appInit));
    ok('2b · el listado del Panel de Dirección tampoco la oculta',
       /openMatchReplay\('\$\{m\.id\}'\)/.test(finished) &&
       !/display\s*=\s*'none'[^\n]*openMatchReplay/.test(finished));
}
{
    const sb = entorno();
    sb.window.openMatchReplay(partidoF7());
    ok('2c · con el listado abierto, abrir la repetición no lo cierra',
       sb._reg['setup-modal'].style.display === 'flex', sb._reg['setup-modal'].style.display);
    sb.window.closeMatchReplay();
    ok('2d · 🔑 al cerrar, el listado SIGUE a la vista',
       sb._reg['setup-modal'].style.display === 'flex', sb._reg['setup-modal'].style.display);
    ok('2d2 · y no se repinta sin necesidad (cero lecturas extra)',
       sb._navReloads === 0, sb._navReloads + ' navReload()');
    ok('2e · la capa del reproductor se retira del DOM',
       sb._reg['cronos-replay-modal'] ? sb._reg['cronos-replay-modal'].quitado === true : true);
}
{
    // Defensa: si CUALQUIER otra vía volviera a ocultar la capa por en medio,
    // al cerrar hay que devolverla y repintarla.
    const sb = entorno();
    sb.window.openMatchReplay(partidoF7());
    sb._reg['setup-modal'].style.display = 'none';       // alguien la oculta
    sb.window.closeMatchReplay();
    ok('2f · 🔑 si la capa se ocultó por el camino, la ✕ la devuelve',
       sb._reg['setup-modal'].style.display === 'flex', sb._reg['setup-modal'].style.display);
    ok('2f2 · y repinta el listado por si quedó vacío',
       sb._navReloads === 1, sb._navReloads + ' navReload()');
}
{
    // Y al revés: si la capa NO estaba abierta (el visor en directo de
    // live.html no tiene #setup-modal visible), no se inventa una pantalla.
    const sb = entorno();
    sb._reg['setup-modal'].style.display = 'none';
    sb.window.openMatchReplay(partidoF7());
    sb.window.closeMatchReplay();
    ok('2g · 🔑 si el listado no estaba abierto, cerrar NO lo abre',
       sb._reg['setup-modal'].style.display === 'none', sb._reg['setup-modal'].style.display);
    ok('2g2 · ni repinta nada', sb._navReloads === 0, sb._navReloads);
}
{
    // Cerrar en mitad de una grabación: ni fichero a medias ni temporizadores vivos.
    const sb = entorno();
    sb.window.openMatchReplay(partidoF7());
    sb.window._replayRecordVideo();
    sb._reloj.avanza(3000);
    const vivosAntes = sb._reloj.vivos();
    sb.window.closeMatchReplay();
    ok('2h · cerrar durante la grabación no descarga un fichero a medias',
       sb._descargas.filter(a => a.clicked).length === 0,
       JSON.stringify(sb._descargas.map(a => a.download)));
    ok('2h2 · 🔑 y no deja temporizadores corriendo sobre un modal que ya no existe',
       sb._reloj.vivos() === 0, vivosAntes + ' → ' + sb._reloj.vivos());
}
{
    // El otro camino por el que puede quedar un temporizador huérfano: cerrar
    // con la repetición REPRODUCIÉNDOSE, sin grabar nada. Sin este escenario la
    // aserción de arriba se cumplía por la cadena del `onstop` del grabador y no
    // medía el cierre en sí — lo destapó el red-check.
    const sb = entorno();
    sb.window.openMatchReplay(partidoF7());
    sb.window._replayTogglePlay();               // el usuario le da al play
    sb._reloj.avanza(3000);
    const vivosAntes = sb._reloj.vivos();
    ok('2i · reproduciendo hay un temporizador vivo (si no, el escenario no mide nada)',
       vivosAntes >= 1, vivosAntes);
    sb.window.closeMatchReplay();
    ok('2i2 · 🔑 cerrar con la repetición en marcha no deja el reloj corriendo',
       sb._reloj.vivos() === 0, vivosAntes + ' → ' + sb._reloj.vivos());
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · idéntico en PC, tablet y móvil ──');
// ───────────────────────────────────────────────────────────────────────────
// La lógica de cierre no depende del formato (es la misma capa y el mismo
// manejador). Lo que SÍ dependía del ancho era poder LLEGAR a la ✕: la barra
// superior no envolvía y su contenedor recorta, así que en un móvil estrecho el
// título empujaba los botones fuera de la caja.
{
    const { simulador, TACTILES, RATON } = require('./_css_cascade.js');
    // La hoja del reproductor se inyecta desde JS: se envuelve en <style> para
    // poder pasarla por el mismo simulador de cascada que usan los otros guards.
    const m = SRC.match(/st\.textContent = `([\s\S]*?)`;/);
    const SIM = m ? simulador('<style>' + m[1] + '</style>') : null;
    ok('3a · la hoja del reproductor se puede leer', !!SIM && SIM.reglas.length > 5);
    if (SIM) {
        for (const d of TACTILES.concat(RATON)) {
            ok(`3b · [${d.n}] el bloque de acciones (descarga y ✕) no se encoge`,
               SIM.v('.replay-topbar-actions', 'flex-shrink', d) === '0',
               String(SIM.v('.replay-topbar-actions', 'flex-shrink', d)));
            ok(`3c · [${d.n}] y la barra puede envolver si no cabe`,
               SIM.v('.replay-topbar', 'flex-wrap', d) === 'wrap',
               String(SIM.v('.replay-topbar', 'flex-wrap', d)));
        }
    }
    ok('3d · el marcado usa esas clases (si no, el CSS no le llega a nadie)',
       /class="replay-topbar"/.test(SRC) && /class="replay-topbar-actions"/.test(SRC));
    ok('3e · la ✕ sigue llamando a closeMatchReplay',
       /onclick="window\.closeMatchReplay\(\)"/.test(SRC));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · la exportación SUELTA la memoria al terminar ──');
// ───────────────────────────────────────────────────────────────────────────
// 🔑 Reporte del autor (iPad, 2026-08-14): tras descargar el vídeo, al cerrar la
// previsualización de iOS, Safari RECARGA la pestaña y se pierde la sesión. Lo
// aisló con una prueba A/B: cerrando con la ✕ SIN descargar no pasa nunca, así
// que la ✕ es inocente y el detonante es la exportación.
//
// Lo que había: la pista de `captureStream` seguía viva y los trozos del vídeo
// —el fichero ENTERO en RAM— colgaban del cierre de `onstop`, que cuelga de la
// grabadora, que colgaba de `_replayState.mediaRecorder` y no se soltaba nunca,
// ni al terminar ni al cerrar el reproductor.
//
// ⚠️ Esto MIDE que se libera; no puede medir que Safari no descarte la pestaña.
{
    const sb = entorno();
    sb.window.openMatchReplay(partidoF7());
    sb.window._replayRecordVideo();
    sb._reloj.avanza(3000);
    const lienzo = sb._lienzos[0];
    const pista  = lienzo && lienzo._stream.getTracks()[0];
    ok('4a · mientras graba, la pista del canvas está VIVA (si no, no se mide nada)',
       !!pista && pista.parada === false);

    sb._reloj.avanza(5 * 60 * 1000);          // la exportación se cierra sola
    ok('4b · 🔑 al terminar se detiene la captura del canvas',
       !!pista && pista.parada === true);
    ok('4c · 🔑 y se suelta el lienzo de 900×700',
       lienzo.width === 0 && lienzo.height === 0,
       lienzo.width + '×' + lienzo.height);
    const rec = sb._grabadoras[0];
    ok('4d · 🔑🔑 se sueltan los manejadores de la grabadora — son ELLOS los que retenían el vídeo entero',
       !!rec && rec.onstop === null && rec.ondataavailable === null,
       'onstop=' + typeof rec.onstop + ' ondataavailable=' + typeof rec.ondataavailable);
    ok('4e · …y aun así el fichero se descarga igual (liberar no puede romper la descarga)',
       sb._descargas.some(a => /\.(mp4|webm)$/.test(a.download || '') && a.clicked),
       JSON.stringify(sb._descargas.map(a => a.download)));
    ok('4e2 · el vídeo descargado no sale vacío por haber vaciado los trozos',
       sb._descargas.some(a => a.clicked) && sb._reloj.vivos() === 0);
}
{
    // Abortar con la ✕ en mitad de la grabación tiene que liberar TAMBIÉN.
    const sb = entorno();
    sb.window.openMatchReplay(partidoF7());
    sb.window._replayRecordVideo();
    sb._reloj.avanza(3000);
    const pista = sb._lienzos[0]._stream.getTracks()[0];
    sb.window.closeMatchReplay();
    ok('4f · 🔑 cerrar con la ✕ en mitad de la grabación también detiene la captura',
       pista.parada === true);
    ok('4f2 · y suelta el lienzo',
       sb._lienzos[0].width === 0 && sb._lienzos[0].height === 0,
       sb._lienzos[0].width + '×' + sb._lienzos[0].height);

    // ⚠️ RIESGO DE LA PROPIA LIBERACIÓN: si al soltar se perdiera el `onstop`
    // sin limpiar la marca de "abortada", la SIGUIENTE exportación se saldría
    // muda y no descargaría nada. Este escenario lo vigila.
    sb.window.openMatchReplay(partidoF7());
    sb.window._replayRecordVideo();
    sb._reloj.avanza(5 * 60 * 1000);
    ok('4g · 🔑 tras abortar una, la SIGUIENTE exportación vuelve a descargar',
       sb._descargas.some(a => a.clicked),
       JSON.stringify(sb._descargas.map(a => a.download)));
}
{
    // Cerrar el reproductor SIN haber grabado no puede romperse por la nueva
    // liberación (es el camino que él verificó como bueno el 2026-08-14).
    const sb = entorno();
    sb.window.openMatchReplay(partidoF7());
    sb.window.closeMatchReplay();
    ok('4h · cerrar sin haber grabado sigue funcionando igual',
       sb._reg['setup-modal'].style.display === 'flex' && sb._reloj.vivos() === 0,
       sb._reg['setup-modal'].style.display + ' · ' + sb._reloj.vivos() + ' temporizadores');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 6 · en táctil se COMPARTE, no se navega ──');
// ───────────────────────────────────────────────────────────────────────────
// 🔑🔑🔑 El reporte que costó cuatro rondas: en el iPad y en el móvil, al
// descargar el vídeo la app acababa pidiendo la contraseña. En el PC nunca.
// La asimetría entre dispositivos descarta todo lo común (lección de v455): lo
// que sólo pasa en táctil es que un enlace de descarga con blob: NAVEGA, iOS
// abre su previsualización y al volver la pestaña arranca de cero — sin sesión.
// No se puede "sobrevivir" a eso: hay que NO NAVEGAR. `navigator.share` entrega
// el fichero al menú del sistema (el "Guardar vídeo" que él ya usa) sin mover
// la página.
//
// ⚠️ Y NO SE PUEDE COMPARTIR SOLO: `navigator.share` exige un gesto del
// usuario, y la grabación termina en un `onstop` asíncrono, mucho después del
// clic. Por eso el botón pasa a "Guardar Vídeo" y comparte AL PULSARLO.
{
    const sb = entorno({ compartir: true });
    sb.window.openMatchReplay(partidoF7());
    sb.window._replayRecordVideo();
    sb._reloj.avanza(5 * 60 * 1000);

    ok('6a · 🔑🔑 en táctil NO se crea un enlace de descarga (es lo que navega y recarga la pestaña)',
       sb._descargas.filter(a => a.clicked).length === 0,
       JSON.stringify(sb._descargas.map(a => a.download)));
    ok('6b · 🔑 no se comparte solo: hace falta que el usuario pulse (navigator.share exige gesto)',
       sb._compartidos.length === 0, sb._compartidos.length + ' compartidos sin pulsar');
    const btn = sb._reg['btn-replay-record'];
    ok('6c · el botón invita a guardar el vídeo cuando ya está listo',
       /Guardar V[íi]deo/i.test(String(btn.innerHTML)), String(btn.innerHTML).slice(0, 60));
    ok('6c2 · y al pulsarlo llama a la función que comparte',
       /_replayGuardarVideo/.test(String(btn.getAttribute('onclick'))),
       String(btn.getAttribute('onclick')));

    if (typeof sb.window._replayGuardarVideo === 'function') sb.window._replayGuardarVideo();
    ok('6d · 🔑 al pulsar, el vídeo se entrega al menú del sistema',
       sb._compartidos.length === 1, sb._compartidos.length + ' compartidos');
    const f = sb._compartidos[0] && sb._compartidos[0].files && sb._compartidos[0].files[0];
    ok('6e · con nombre de partido y tipo de vídeo (iOS decide por el tipo con qué lo abre)',
       !!f && /^partido_repeticion_\d+\.(mp4|webm)$/.test(f.name) && /^video\//.test(f.type),
       f ? f.name + ' · ' + f.type : '(sin fichero)');
    ok('6f · y sigue sin navegar: ni un enlace pulsado en todo el proceso',
       sb._descargas.filter(a => a.clicked).length === 0);
}
{
    // ⚠️ EL PC NO SE TOCA: allí la descarga por enlace funciona y él lo ha
    // verificado. Un arreglo que arregle el iPad y rompa el PC no es un arreglo.
    const sb = entorno({ compartir: false });
    sb.window.openMatchReplay(partidoF7());
    sb.window._replayRecordVideo();
    sb._reloj.avanza(5 * 60 * 1000);
    ok('6g · 🔑 en un PC sin menú de compartir se descarga como siempre',
       sb._descargas.some(a => /\.(mp4|webm)$/.test(a.download || '') && a.clicked),
       JSON.stringify(sb._descargas.map(a => a.download)));
}
{
    // Cancelar el menú de iOS no es un fallo: el vídeo tiene que seguir ahí.
    const sb = entorno({ compartir: true });
    sb.window.openMatchReplay(partidoF7());
    sb.window._replayRecordVideo();
    sb._reloj.avanza(5 * 60 * 1000);
    sb._cancelaElProximoCompartir('AbortError');
    if (typeof sb.window._replayGuardarVideo === 'function') sb.window._replayGuardarVideo();
    sb._reloj.avanza(1000);
    ok('6h · si cancela el menú, el botón sigue ofreciendo guardar el vídeo',
       /Guardar V[íi]deo/i.test(String(sb._reg['btn-replay-record'].innerHTML)),
       String(sb._reg['btn-replay-record'].innerHTML).slice(0, 60));
    if (typeof sb.window._replayGuardarVideo === 'function') sb.window._replayGuardarVideo();
    ok('6h2 · y a la segunda se comparte de verdad',
       sb._compartidos.length === 1, sb._compartidos.length + ' compartidos');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ Descarga completa y retorno correcto en los tres formatos');
