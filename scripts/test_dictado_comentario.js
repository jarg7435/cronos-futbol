// ─────────────────────────────────────────────────────────────────────────
//  test_dictado_comentario.js  ·  🎤 v803
//
//  Encargo del autor (implementar.txt 2026-10-11, captura 11319): micrófono
//  junto al comentario de «Registrar Evento Perdido» que dicte la voz al
//  cuadro en tiempo real con la API de reconocimiento de voz del navegador.
//  Decisiones del autor: abrir la cabecera `microphone=(self)` y poner un
//  aviso de privacidad junto al micrófono.
//
//  Se ejecuta el modal REAL con un reconocedor de voz SIMULADO que emite
//  resultados provisionales y definitivos como el del navegador.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC = leer('js/match/events/retroactive-modal.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 300)); }
};

function entorno({ conVoz = true } = {}) {
    const els = {};
    const el = (id) => (els[id] = els[id] || { id, value: '', style: {}, innerHTML: '', textContent: '', title: '', focus() {} });
    const toasts = [];
    const reconocedores = [];
    function FakeSR() {
        this.lang = ''; this.continuous = false; this.interimResults = false;
        this.parado = false; this.arrancado = false;
        reconocedores.push(this);
    }
    FakeSR.prototype.start = function () { this.arrancado = true; };
    FakeSR.prototype.stop = function () { this.parado = true; };
    // Emite resultados con la forma del navegador.
    FakeSR.prototype.emite = function (resultIndex, lista) {
        const results = lista.map(([t, fin]) => Object.assign([{ transcript: t }], { isFinal: fin }));
        if (this.onresult) this.onresult({ resultIndex, results });
    };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        escapeHtml: (s) => String(s == null ? '' : s),
        showToast: (m) => toasts.push(String(m)),
        Promise, String, Number, Array, Object, Date, JSON, Math, parseInt, isNaN,
        _registerMatchEvent: () => {},
        document: {
            getElementById: (id) => id === 'cronos-retroactive-modal' ? (els[id] || null) : el(id),
            createElement: () => ({ style: {}, innerHTML: '', className: '', id: '' }),
            body: { appendChild: (n) => { els['cronos-retroactive-modal'] = n; } },
        },
        liveMatchId: 'm_live',
        _cronosMatchEvents: [],
    };
    if (conVoz) sb.webkitSpeechRecognition = FakeSR;
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(SRC, sb);
    return { sb, el, els, toasts, reconocedores };
}

(async () => {
    console.log('\n── PARTE 1 · el botón, sólo si el navegador sabe dictar ──');
    {
        const E = entorno();
        await E.sb.openRetroactiveEventModal();
        const html = E.els['cronos-retroactive-modal'].innerHTML;
        ok('1a · 🔑 el micrófono va junto al cuadro del comentario',
           /id="retro-mic-btn"[^>]*onclick="window\._retroDictar\(\)"/.test(html) &&
           html.indexOf('id="retro-mic-btn"') > html.indexOf('id="retro-comment-input"') &&
           html.indexOf('id="retro-mic-btn"') < html.indexOf('id="retro-comment-count"'));
        ok('1b · 🔑 con el aviso de privacidad (Google o Apple, sin nombres completos ni salud)',
           /El dictado lo transcribe el servicio de voz de tu navegador \(Google o Apple\)/.test(html) &&
           /no dictes nombres completos ni datos de salud/.test(html));
        const S = entorno({ conVoz: false });
        await S.sb.openRetroactiveEventModal();
        const h2 = S.els['cronos-retroactive-modal'].innerHTML;
        ok('1c · ⚠️ sin reconocimiento de voz (Firefox) NO aparece ni el botón ni el aviso',
           !/retro-mic-btn/.test(h2) && !/El dictado lo transcribe/.test(h2));
    }

    console.log('\n── PARTE 2 · dictar escribe en el cuadro en tiempo real ──');
    {
        const E = entorno();
        await E.sb.openRetroactiveEventModal();
        E.sb._setRetroEventType('comment');
        const ta = E.el('retro-comment-input');
        ta.value = 'Presión alta.';
        E.sb._retroDictar();
        const R = E.reconocedores[0];
        ok('2a · 🔑 arranca en español, continuo y con resultados provisionales',
           R && R.arrancado && R.lang === 'es-ES' && R.continuous === true && R.interimResults === true, R);
        ok('2b · el botón pasa a PARAR', E.el('retro-mic-txt').textContent === 'PARAR');
        R.emite(0, [['cerrar la banda', false]]);
        ok('2c · 🔑 lo provisional aparece YA, detrás de lo escrito',
           ta.value === 'Presión alta. cerrar la banda', ta.value);
        R.emite(0, [['cerrar la banda izquierda', true]]);
        R.emite(1, [['cerrar la banda izquierda', true], ['y presionar', false]]);
        ok('2d · lo definitivo se fija y lo nuevo provisional se añade',
           ta.value === 'Presión alta. cerrar la banda izquierda y presionar', ta.value);
        ok('2e · el contador se actualiza', E.el('retro-comment-count').textContent === ta.value.length + ' / 500');
        // El navegador manda la lista ENTERA; lo nuevo empieza en resultIndex.
        R.emite(2, [['cerrar la banda izquierda', true], ['y presionar', true], ['x'.repeat(600), true]]);
        ok('2f · ⚠️ nunca pasa de 500 caracteres', ta.value.length === 500, ta.value.length);

        E.sb._retroDictar();   // segundo clic: para
        ok('2g · 🔑 otro clic PARA y suelta el micrófono', R.parado === true && E.el('retro-mic-txt').textContent === 'DICTAR');
        const antes = ta.value;
        if (R.onend) R.onend();
        ok('2h · ⚠️ y ya no reescribe el cuadro (desconectado antes de parar)', ta.value === antes && R.onresult === null);
    }

    console.log('\n── PARTE 3 · se para solo donde debe ──');
    {
        const E = entorno();
        await E.sb.openRetroactiveEventModal();
        E.sb._setRetroEventType('comment');
        E.sb._retroDictar();
        E.sb._setRetroEventType('goal');
        ok('3a · cambiar a otro tipo de suceso para el dictado', E.reconocedores[0].parado === true);

        E.sb._setRetroEventType('comment');
        E.sb._retroDictar();
        E.sb.closeRetroactiveEventModal();
        ok('3b · cerrar la ventana nunca deja el micrófono abierto', E.reconocedores[1].parado === true);

        await E.sb.openRetroactiveEventModal();
        await E.sb._retroElegirPartido('m_live');
        E.sb._setRetroEventType('comment');
        E.sb._retroDictar();
        E.el('retro-comment-input').value = 'nota dictada';
        E.sb._retroAnadirALista();
        ok('3c · 🔑 «Añadir a la lista» para el dictado y el cuadro queda vacío (no se reescribe)',
           E.reconocedores[2].parado === true && E.el('retro-comment-input').value === '' &&
           E.reconocedores[2].onresult === null);
    }

    console.log('\n── PARTE 4 · errores y cabecera ──');
    {
        const E = entorno();
        await E.sb.openRetroactiveEventModal();
        E.sb._setRetroEventType('comment');
        E.sb._retroDictar();
        E.reconocedores[0].onerror({ error: 'not-allowed' });
        ok('4a · sin permiso de micrófono se dice qué pasa', E.toasts.some(t => /permiso para usar el micrófono/.test(t)), E.toasts);

        const FB = JSON.parse(leer('firebase.json'));
        const hosts = Array.isArray(FB.hosting) ? FB.hosting : [FB.hosting];
        const pp = [];
        hosts.forEach(h => (h.headers || []).forEach(b => (b.headers || []).forEach(x => {
            if (x.key === 'Permissions-Policy') pp.push(x.value);
        })));
        ok('4b · 🔑 la cabecera permite el micrófono SÓLO a la propia app',
           pp.length > 0 && pp.every(v => /microphone=\(self\)/.test(v)), pp);
        ok('4c · ⚠️ y cámara y ubicación siguen bloqueadas',
           pp.every(v => /camera=\(\)/.test(v) && /geolocation=\(\)/.test(v)), pp);
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();
