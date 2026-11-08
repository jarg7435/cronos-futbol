// ═══════════════════════════════════════════════════════════════════════════
//  GUARD v851 · «Imprimir / Guardar como PDF» en el MÓVIL (Cuadrante)
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 08-11 + IMG_5233-5235): en el iPhone,
//  con la app instalada en la pantalla de inicio, el botón del visor no hacía
//  NADA. En una web app `standalone` de iOS `window.print()` es mudo: ni
//  diálogo ni error. Lo usan Director Deportivo y Coordinador (los dos pasan
//  por cqExportar → rxImprimir → rxAbrirDocumento → visor).
//
//  Lo que se exige:
//   A. Las bibliotecas del PDF van alojadas en el proyecto (no CDN) y FUERA del
//      precache atómico del SW.
//   B. El visor trae el botón «📄 Guardar PDF» además de Imprimir y Cerrar.
//   C. En la app instalada de iOS, «Imprimir» NO llama a print() (mudo): va al PDF.
//   D. Fuera de ahí, «Imprimir» sigue llamando a print() del IFRAME (PC intacto).
//   E. Con el PDF ya preparado, pulsar «Guardar PDF» lo comparte EN LA MISMA
//      pulsación (navigator.share exige gesto) como fichero .pdf.
//   F. cqExportar pasa `apaisado` y llega hasta el generador.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/coach/reports/reports-export.js'), 'utf8');
const SW  = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const CQ  = fs.readFileSync(path.join(ROOT, 'js/coach/reports/cuadrante-club.js'), 'utf8');

let pass = 0, fail = 0;
function ok(nombre, cond, detalle) {
    if (cond) { pass++; console.log('  ✓ ' + nombre); }
    else { fail++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + detalle : '')); }
}

// ── A · bibliotecas ───────────────────────────────────────────────────────
console.log('\nA · bibliotecas del PDF');
['html2canvas.min.js', 'jspdf.umd.min.js'].forEach(function (f) {
    const p = path.join(ROOT, 'js/vendor/pdfgen', f);
    ok('A · existe js/vendor/pdfgen/' + f, fs.existsSync(p) && fs.statSync(p).size > 100000);
    ok('A · ' + f + ' NO está en el precache del SW', SW.indexOf('pdfgen/' + f) < 0);
});
ok('A · se cargan desde el proyecto, no desde un CDN',
    /js\/vendor\/pdfgen\/html2canvas\.min\.js/.test(SRC) && !/cdn\.jsdelivr\.net\/npm\/(jspdf|html2canvas)/.test(SRC));

// ── Sandbox ───────────────────────────────────────────────────────────────
function sandbox({ standalone = false, tactil = true } = {}) {
    const scripts = [], compartidos = [], toasts = [];
    let impresiones = 0;
    function nodo(tag) {
        const n = {
            tagName: tag, style: { cssText: '' }, children: [], parentNode: null, innerHTML: '',
            textContent: '', _btn: {},
            appendChild(c) { c.parentNode = n; n.children.push(c); if (c.tagName === 'script') { scripts.push(c); } return c; },
            removeChild(c) { n.children = n.children.filter(x => x !== c); c.parentNode = null; },
            querySelector(sel) { return n._btn[sel] || (n._btn[sel] = { onclick: null, style: {}, textContent: '' }); },
            addEventListener() {}, setAttribute() {}, click() {},
            getContext() { return { fillRect() {}, drawImage() {} }; },
            toDataURL() { return 'data:image/jpeg;base64,AAAA'; },
        };
        if (tag === 'iframe') {
            const body = {
                scrollHeight: 2000,
                getBoundingClientRect: () => ({ top: 0, bottom: 2000 }),
                querySelectorAll: () => [],
            };
            const d = {
                open() {}, write(h) { d.html = (d.html || '') + h; }, close() {},
                body, documentElement: { scrollHeight: 2000 },
            };
            n.contentDocument = d;
            n.contentWindow = { document: d, focus() {}, print() { impresiones++; }, getComputedStyle: () => ({}) };
        }
        return n;
    }
    const body = nodo('body');
    const ctx = {
        console, setTimeout, clearTimeout, Promise, Math, Date, String, Number, Array, Object, JSON, RegExp,
        Blob,
        File: class { constructor(partes, nombre, o) { this.name = nombre; this.type = o && o.type; } },
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
        navigator: {
            maxTouchPoints: tactil ? 5 : 0,
            standalone: standalone,
            canShare: (d) => !!(d && d.files && d.files.length),
            share: (d) => { compartidos.push(d); return Promise.resolve(); },
        },
        matchMedia: () => ({ matches: tactil }),
        showToast: (m) => toasts.push(String(m)),
        document: {
            body, head: nodo('head'), createElement: nodo, getElementById: () => null,
        },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx, { filename: 'reports-export.js' });
    return { ctx, body, scripts, compartidos, toasts, get impresiones() { return impresiones; } };
}
const espera = (ms) => new Promise(r => setTimeout(r, ms));

(async function () {
    // ── B · el botón existe ──────────────────────────────────────────────
    console.log('\nB · barra del visor');
    {
        const s = sandbox();
        s.ctx.rxAbrirDocumento({ titulo: 'Cuadrante', doc: '<p>x</p>' });
        const ov = s.body.children.find(c => c.id === 'rx-visor');
        const html = ov ? ov.children[0].innerHTML : '';
        ok('B1 · botón «Guardar PDF» (rx-visor-pdf)', /id="rx-visor-pdf"/.test(html) && /Guardar PDF/.test(html));
        ok('B2 · siguen Imprimir y Cerrar', /id="rx-visor-print"/.test(html) && /id="rx-visor-close"/.test(html));
    }

    // ── C · iOS instalada: imprimir no llama a print() ───────────────────
    console.log('\nC · app instalada de iOS');
    {
        const s = sandbox({ standalone: true });
        s.ctx.rxAbrirDocumento({ titulo: 'Cuadrante', doc: '<p>x</p>' });
        const ov = s.body.children.find(c => c.id === 'rx-visor');
        ov.children[0].querySelector('#rx-visor-print').onclick();
        ok('C1 · 🔑 NO se llama a print() (en iOS instalada es mudo)', s.impresiones === 0, s.impresiones);
        ok('C2 · se pone en marcha el PDF (carga de pdfgen)',
            s.scripts.some(x => /pdfgen\//.test(x.src)), s.scripts.map(x => x.src).join(','));
        ok('C3 · y se avisa de que se está preparando', s.toasts.some(t => /Preparando/.test(t)));
    }

    // ── D · fuera de iOS instalada, print() del iframe ───────────────────
    console.log('\nD · resto de navegadores');
    {
        const s = sandbox({ standalone: false });
        s.ctx.rxAbrirDocumento({ titulo: 'Cuadrante', doc: '<p>x</p>' });
        const ov = s.body.children.find(c => c.id === 'rx-visor');
        ov.children[0].querySelector('#rx-visor-print').onclick();
        ok('D1 · Imprimir llama a print() del IFRAME', s.impresiones === 1, s.impresiones);
        await espera(1700);
        ok('D2 · sin diálogo (ningún beforeprint) se avisa y se señala «Guardar PDF»',
            s.toasts.some(t => /no abrió la impresión/.test(t)));
    }

    // ── E · con el PDF preparado se comparte en la misma pulsación ───────
    console.log('\nE · entrega del PDF');
    {
        const s = sandbox({ standalone: true });
        // Bibliotecas de mentira, ya «cargadas».
        s.ctx.html2canvas = () => Promise.resolve({ width: 2246, height: 4000, getContext() { return {}; } });
        let orientacion = null;
        s.ctx.jspdf = { jsPDF: class {
            constructor(o) { orientacion = o.orientation; this.internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } }; }
            addPage() {} addImage() {} setFontSize() {} setTextColor() {} text() {}
            output() { return new Blob(['%PDF-1.3'], { type: 'application/pdf' }); }
        } };
        s.ctx.rxImprimir({ titulo: 'Cuadrante semanal', cuerpo: '<div class="rx-block">x</div>', apaisado: true });
        await espera(800);   // el visor lo prepara solo en táctil (400 ms + generación)
        const ov = s.body.children.find(c => c.id === 'rx-visor');
        ok('E0 · el visor está abierto', !!ov);
        ok('F1 · 🔑 el PDF del cuadrante sale APAISADO', orientacion === 'landscape', orientacion);
        const antes = s.compartidos.length;
        ov.children[0].querySelector('#rx-visor-pdf').onclick();
        const d = s.compartidos[antes];
        ok('E1 · 🔑 se comparte en la MISMA pulsación (sin esperar)', s.compartidos.length === antes + 1);
        ok('E2 · como fichero .pdf', !!(d && d.files && /\.pdf$/.test(d.files[0].name) && d.files[0].type === 'application/pdf'),
            d && d.files && d.files[0].name);
    }

    // ── F · cuadrante ────────────────────────────────────────────────────
    console.log('\nF · cuadrante (Director y Coordinador)');
    ok('F2 · cqExportar imprime con rxImprimir apaisado',
        /window\.rxImprimir\(\{[\s\S]{0,1500}apaisado:\s*true/.test(CQ));
    ok('F3 · rxImprimir pasa apaisado a rxAbrirDocumento y éste al visor',
        /apaisado:\s*!!opts\.apaisado,\s*\/\/ v851/.test(SRC) && /_rxVisorEnLaApp\(docVisor, titulo, \{ apaisado: !!opts\.apaisado \}\)/.test(SRC));

    console.log('\n' + pass + ' ✓  ·  ' + fail + ' ✗');
    process.exit(fail ? 1 : 0);
})();
