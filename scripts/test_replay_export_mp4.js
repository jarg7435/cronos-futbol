// ═══════════════════════════════════════════════════════════════════════════
// GUARD · v461 — El vídeo del partido se exporta en MP4 (iPhone / iPad)
// ═══════════════════════════════════════════════════════════════════════════
// Reporte del autor (captura IMG_0486): el fichero descargado sale en `.webm`.
// iOS/iPadOS NO abre webm ni en Fotos ni en el reproductor del sistema: hay que
// instalar VLC para verlo. El vídeo tiene que salir en MP4/H.264 (contenedor
// QuickTime) para que se guarde en el carrete y se abra con la app nativa.
//
// LO QUE ESTABA MAL: el orden de preferencia probaba `video/webm;codecs=vp9`
// PRIMERO y sólo caía a `video/mp4` si el webm no estaba soportado. Cualquier
// navegador que sepa hacer las dos cosas —Chrome de escritorio y de Android, y
// las versiones de Safari que ya aceptan webm— entregaba webm.
//
// ⚠️ NO SE MIRA EL CÓDIGO FUENTE PARA LO QUE SE PUEDE EJECUTAR. El reproductor se
// carga de verdad en un sandbox y se GRABA un partido completo con reloj
// controlado contra CINCO PERFILES DE NAVEGADOR distintos, midiendo con qué
// mimeType se construye la grabadora, qué `type` lleva el Blob y con qué
// extensión se descarga el fichero. Un regex diría "el código menciona mp4";
// no diría CUÁL DE LOS DOS gana en cada navegador, que era justo el fallo.
//
// 🔑 Los perfiles importan: `isTypeSupported` no se comporta igual en todos.
// Safari acepta `video/mp4` a secas y rechaza la cadena con codecs; hay
// navegadores que anuncian un tipo y luego el constructor lanza; y el tipo que
// de verdad se graba es `recorder.mimeType`, que puede NO ser el que se pidió.
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

function elemento(id) {
    return { id, innerHTML: '', textContent: '', value: '', style: {}, children: [],
             appendChild() {}, remove() { this.quitado = true; }, setAttribute() {},
             getAttribute() { return ''; }, querySelector() { return null; },
             querySelectorAll() { return []; }, click() { this.clicked = true; },
             addEventListener() {} };
}

// ── PERFILES DE NAVEGADOR ──────────────────────────────────────────────────
// `acepta(t)`  → qué contesta MediaRecorder.isTypeSupported(t)
// `construye(t)` → si el constructor lo admite de verdad (puede mentir el de arriba)
// `real(t)`    → qué devuelve recorder.mimeType tras construirlo
const PERFILES = {
    // Chrome/Edge de escritorio y Android modernos: saben hacer LAS DOS COSAS.
    // Éste es el perfil que producía el `.webm` del reporte.
    CHROME: {
        n: 'Chrome/Edge moderno (webm y mp4)',
        acepta: t => /webm/.test(t) || /mp4/.test(t),
        construye: () => true,
        real: t => t,
    },
    // Safari iOS/iPadOS: acepta `video/mp4` a secas; la cadena con codecs y
    // cualquier webm los rechaza.
    SAFARI: {
        n: 'Safari iOS/iPadOS (sólo video/mp4 pelado)',
        acepta: t => t === 'video/mp4',
        construye: t => t === 'video/mp4',
        real: () => 'video/mp4',
    },
    // Firefox: no sabe muxear mp4. Aquí el webm es legítimo, no un fallo.
    FIREFOX: {
        n: 'Firefox (sólo webm)',
        acepta: t => /webm/.test(t),
        construye: t => /webm/.test(t),
        real: t => t,
    },
    // Navegador que ANUNCIA mp4 con codecs y luego el constructor lanza.
    MENTIROSO: {
        n: 'Anuncia mp4+codecs pero el constructor lanza',
        acepta: t => /mp4/.test(t) || /webm/.test(t),
        construye: t => t === 'video/mp4' || /webm/.test(t),
        real: t => t,
    },
    // Navegador viejo SIN isTypeSupported: no se puede preguntar nada.
    ANTIGUO: {
        n: 'Sin isTypeSupported (navegador viejo)',
        acepta: null,          // la función no existe
        construye: () => true,
        real: () => '',        // tampoco expone recorder.mimeType
    },
    // No reconoce NINGUNA de nuestras cadenas, pero sabe grabar si se le deja
    // elegir a él. Aquí lo único que salva el vídeo es el último recurso:
    // construir la grabadora SIN `mimeType`.
    DESCONOCIDO: {
        n: 'Rechaza todas las cadenas; sólo graba sin mimeType',
        acepta: () => false,
        construye: t => !t,
        real: () => 'video/mp4',
    },
    // 🔑 Acepta el mp4 pedido, pero lo que graba de verdad es webm. La
    // extensión tiene que seguir a la REALIDAD, no a lo que se pidió: un .mp4
    // que por dentro es webm es peor que un .webm honrado — iOS lo abre, ve
    // basura y el usuario no entiende por qué.
    DESALINEADO: {
        n: 'Dice que sí al mp4 pero graba webm',
        acepta: () => true,
        construye: () => true,
        real: () => 'video/webm;codecs=vp8',
    },
};

function entorno(perfil) {
    const reloj = crearReloj();
    const reg = {};
    ['replay-pitch-players','replay-bench-home','replay-bench-away','replay-score-home',
     'replay-score-away','replay-timer-display','replay-phase-display','replay-seekbar',
     'replay-seek-curr','replay-pitch-container','btn-replay-record','btn-replay-play',
     'setup-modal'].forEach(id => { reg[id] = elemento(id); });
    reg['setup-modal'].style.display = 'flex';

    const descargas = [];
    const grabadoras = [];
    const blobs = [];
    const avisos = [];

    class GrabadoraFalsa {
        constructor(stream, opts) {
            const pedido = (opts && opts.mimeType) || '';
            if (pedido && !perfil.construye(pedido)) {
                const e = new Error("NotSupportedError: mimeType no soportado: " + pedido);
                e.name = 'NotSupportedError';
                throw e;
            }
            this.pedido = pedido;
            const r = perfil.real(pedido);
            if (r) this.mimeType = r;
            this.state = 'inactive';
            grabadoras.push(this);
        }
        start() { this.state = 'recording'; this.inicio = reloj.ahora(); }
        stop() {
            if (this.state !== 'recording') return;
            this.state = 'inactive'; this.fin = reloj.ahora();
            if (this.ondataavailable) this.ondataavailable({ data: { size: 10 } });
            if (this.onstop) this.onstop();
        }
    }
    if (perfil.acepta) GrabadoraFalsa.isTypeSupported = t => !!perfil.acepta(t);

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: (id) => reg[id] || null,
            createElement: (tag) => {
                const el = elemento('');
                el.tag = tag;
                if (tag === 'canvas') {
                    el.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
                    el.captureStream = () => ({ getTracks: () => [] });
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
        Blob: class { constructor(p, o) { this.parts = p; this.type = (o && o.type) || ''; blobs.push(this); } },
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
        escapeHtml: (s) => String(s == null ? '' : s),
        showToast: (t) => { avisos.push(String(t)); },
        _reg: reg, _reloj: reloj, _descargas: descargas, _grabadoras: grabadoras,
        _blobs: blobs, _avisos: avisos, _navReloads: 0,
    };
    sb.navReload = () => { sb._navReloads++; };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC, sb);
    return sb;
}

const partidoF7 = () => ({
    id: 'lm-f7', mode: 'f7', status: 'finished',
    half1MaxTime: 2100, half2MaxTime: 2100,
    timeH1: 2180, timeH2: 2240,
    homeTeam: { name: 'CRONOS', score: 2 }, awayTeam: { name: 'RIVAL', score: 1 },
    players: [{ id: 1, number: 1, name: 'Alba', team: 'home', status: 'field', x: 20, y: 50 }],
    events: [{ type: 'goal', text: 'GOL · Alba', matchTime: '1T 10:00' }],
});

// Graba un partido entero de punta a punta en el perfil dado y devuelve lo
// medido: con qué se construyó la grabadora, qué Blob salió y cómo se llamó el
// fichero descargado.
function grabaEn(perfil) {
    const sb = entorno(perfil);
    let error = null;
    try {
        sb.window.openMatchReplay(partidoF7());
        sb.window._replayRecordVideo();
        sb._reloj.avanza(5 * 60 * 1000);
    } catch (e) { error = e; }
    const desc = sb._descargas.filter(a => a.clicked && /partido_repeticion/.test(String(a.download || '')));
    const fichero = desc.length ? String(desc[desc.length - 1].download) : '';
    return {
        sb, error, fichero,
        ext: (fichero.match(/\.([a-z0-9]+)$/i) || [, ''])[1],
        rec: sb._grabadoras[0] || null,
        pedido: sb._grabadoras[0] ? sb._grabadoras[0].pedido : null,
        blob: sb._blobs.length ? sb._blobs[sb._blobs.length - 1] : null,
    };
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · el navegador que sabe hacer LAS DOS COSAS entrega MP4 ──');
// ───────────────────────────────────────────────────────────────────────────
// Éste es EL caso del reporte. Antes de v461 este bloque entero salía en rojo:
// con webm y mp4 disponibles, el código elegía `video/webm;codecs=vp9`.
{
    const r = grabaEn(PERFILES.CHROME);
    ok('1a · 🔑 la grabadora se pide en MP4, no en webm (era el defecto)',
       /mp4/.test(String(r.pedido)), 'mimeType pedido: ' + JSON.stringify(r.pedido));
    ok('1a2 · …y desde luego no se pide webm teniendo mp4 disponible',
       !/webm/.test(String(r.pedido)), String(r.pedido));
    ok('1b · 🔑 el fichero descargado termina en .mp4 (lo que abre Fotos de iOS)',
       r.ext === 'mp4', r.fichero || '(no se descargó nada)');
    ok('1b2 · y conserva el nombre de siempre',
       /^partido_repeticion_\d+\.mp4$/.test(r.fichero), r.fichero);
    ok('1c · 🔑 el Blob va con type `video/mp4` SIN el parámetro codecs',
       r.blob && r.blob.type === 'video/mp4',
       r.blob ? JSON.stringify(r.blob.type) : '(sin Blob)');
    ok('1d · se pide H.264 explícitamente (es el códec que exige QuickTime)',
       /avc1|h264/i.test(String(r.pedido)), String(r.pedido));
    ok('1e · la grabación sigue cerrándose sola (no se rompe lo de v459)',
       r.rec && r.rec.state !== 'recording', r.rec ? r.rec.state : 'sin grabadora');
    ok('1f · y sigue recorriendo el partido entero',
       r.sb._reg['replay-seek-curr'].textContent === '73:40',
       r.sb._reg['replay-seek-curr'].textContent);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · Safari de iPhone/iPad ──');
// ───────────────────────────────────────────────────────────────────────────
// 🔑 Safari rechaza `video/mp4;codecs=avc1...` y acepta `video/mp4` pelado. Si
// la lista de candidatos no incluye la forma pelada, en el iPhone no se elige
// mp4 por mucho que el mp4 vaya primero.
{
    const r = grabaEn(PERFILES.SAFARI);
    ok('2a · 🔑 en Safari se llega a `video/mp4` pelado (la forma que él acepta)',
       r.pedido === 'video/mp4', JSON.stringify(r.pedido));
    ok('2b · el fichero se descarga como .mp4', r.ext === 'mp4', r.fichero);
    ok('2c · sin lanzar por probar antes cadenas que Safari rechaza',
       !r.error, r.error ? r.error.message : '');
    ok('2d · y la descarga llega a producirse', !!r.fichero, r.fichero || '(nada)');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · el navegador que NO sabe mp4 no se queda sin vídeo ──');
// ───────────────────────────────────────────────────────────────────────────
// Firefox no muxea mp4. Obligar el mp4 no puede significar dejarle sin
// exportación: cae a webm, y se DICE, porque ese fichero no valdrá en un iPhone.
{
    const r = grabaEn(PERFILES.FIREFOX);
    ok('3a · sigue grabando y descargando', !!r.fichero, r.fichero || '(nada)');
    ok('3b · el fichero es .webm, honradamente', r.ext === 'webm', r.fichero);
    ok('3c · 🔑 y se avisa de que ese formato no vale para iPhone/iPad',
       r.sb._avisos.some(t => /iPhone|iPad|iOS/i.test(t) && /webm/i.test(t)),
       JSON.stringify(r.sb._avisos));
    ok('3d · sin lanzar', !r.error, r.error ? r.error.message : '');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · navegadores que mienten o no contestan ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // Anuncia mp4 con codecs y luego el constructor lanza: no se puede confiar
    // sólo en isTypeSupported, hay que INTENTAR construir y seguir probando.
    const r = grabaEn(PERFILES.MENTIROSO);
    ok('4a · 🔑 si el constructor lanza, se prueba el siguiente candidato',
       !r.error && !!r.fichero, r.error ? r.error.message : (r.fichero || '(nada)'));
    ok('4b · y se acaba en mp4 igualmente', r.ext === 'mp4', r.fichero + ' / ' + r.pedido);
}
{
    // Navegador viejo sin isTypeSupported: no se puede preguntar, pero tampoco
    // se puede reventar.
    const r = grabaEn(PERFILES.ANTIGUO);
    ok('4c · sin isTypeSupported no se lanza', !r.error, r.error ? r.error.message : '');
    ok('4d · y se descarga un fichero de todos modos', !!r.fichero, r.fichero || '(nada)');
}
{
    // 🔑 ÚLTIMO RECURSO: si el navegador no reconoce NINGUNA de las cadenas,
    // se construye la grabadora sin `mimeType` y que elija él. Quedarse sin
    // vídeo por no haber acertado el nombre del formato sería peor que el webm.
    const r = grabaEn(PERFILES.DESCONOCIDO);
    ok('4g · 🔑 si rechaza todas las cadenas, se graba sin pedir formato',
       !r.error && !!r.fichero, r.error ? r.error.message : (r.fichero || '(nada)'));
    ok('4g2 · y la extensión la marca lo que el navegador haya grabado',
       r.ext === 'mp4', r.fichero + ' / real ' + (r.rec && r.rec.mimeType));
}
{
    // 🔑 La extensión sigue a lo que se GRABÓ (recorder.mimeType), no a lo que
    // se pidió. Un .mp4 que por dentro es webm engaña al usuario y a iOS.
    const r = grabaEn(PERFILES.DESALINEADO);
    ok('4e · 🔑 la extensión sigue a `recorder.mimeType`, no a lo pedido',
       r.ext === 'webm', 'pedido ' + r.pedido + ' → grabado ' + (r.rec && r.rec.mimeType) + ' → ' + r.fichero);
    ok('4f · y el Blob también lleva el tipo real',
       r.blob && r.blob.type === 'video/webm',
       r.blob ? r.blob.type : '(sin Blob)');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · el rótulo no promete un formato que no va a entregar ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const chrome = grabaEn(PERFILES.CHROME);
    const btnChrome = String(chrome.sb._reg['btn-replay-record'].innerHTML);
    ok('5a · 🔑 con mp4 disponible el botón NO dice .webm',
       !/webm/i.test(btnChrome), btnChrome.slice(0, 70));
    ok('5b · y dice MP4', /mp4/i.test(btnChrome), btnChrome.slice(0, 70));

    const ff = grabaEn(PERFILES.FIREFOX);
    const btnFf = String(ff.sb._reg['btn-replay-record'].innerHTML);
    ok('5c · en un navegador sin mp4 el botón dice WEBM (no miente al revés)',
       /webm/i.test(btnFf), btnFf.slice(0, 70));

    ok('5d · no queda ningún ".webm" escrito a fuego en el marcado del botón',
       !/Descargar Vídeo \(\.webm\)/.test(SRC));
    ok('5e · ni la extensión del fichero se decide con un literal suelto',
       !/\.\$\{?webm\}?`/.test(SRC) && !/download\s*=\s*`[^`]*\.webm`/.test(SRC));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ El vídeo se exporta en MP4 y el iPhone/iPad lo abre nativamente');
