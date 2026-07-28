// ─────────────────────────────────────────────────────────────────────────
// test_endmatch_writers.js
// Hallazgos #10 y #11 de AUDITORIA_GENERAL_2026-07-22.md: varios archivos
// reasignan window.endMatch, y cuál "gana" dependía del orden de <script>.
//
// ── EL BUG REAL (#11), CORREGIDO 2026-07-27 ──
// js/core/sprint3-init.js envolvía window.endMatch DENTRO de un setInterval,
// capturando `window.endMatch || (() => {})`. Pero endMatch lo define
// js/match/persistence/active-match.js, que es un <script> POSTERIOR
// (index.html: sprint3-init 1304, active-match 1311). Los <script> clásicos
// se ejecutan en orden, pero el navegador puede procesar temporizadores
// mientras descarga el siguiente: si el intervalo de 100 ms disparaba antes
// de que active-match.js terminara de bajar, sprint3 envolvía un NO-OP y a
// continuación active-match.js SOBRESCRIBÍA window.endMatch, tirando el
// envoltorio. Consecuencia: el volcado de la auditoría al terminar el partido
// no ocurría, en silencio, justo en el escenario más probable — entrenador en
// el campo con mala cobertura.
//
// Ahora sprint3-init espera a que endMatch exista de verdad (mismo patrón de
// polling + guarda de idempotencia que ya usaba js/core/patches.js), así que
// el resultado es el mismo llegue cuando llegue. La PARTE 2 simula los dos
// órdenes y exige que ambos den la misma cadena.
//
// ── LO QUE LA AUDITORÍA NO SABÍA (#10) ──
// Además de endMatch hay otras dos funciones declaradas DOS VECES, y las dos
// veces como `function` de nivel superior en scripts clásicos, así que gana la
// última cargada:
//   · startMatchWithConvocation — estaba en js/ai/import.js Y en
//     js/core/app-init.js. Ganaba import.js... pero da igual: NADIE la llama.
//     El partido arranca por goToTitularSelection().
//   · goToTitularSelection — mismo par. Ganaba import.js, y ÉSTA SÍ se usa
//     (onclick de #btn-go-titulares).
//
// ACTUALIZADO EL 2026-07-28: la copia muerta de app-init.js ya NO existe. Se
// borró en la Fase B del monolito #5, que resultó no ser un monolito que
// descomponer sino una CAPA FÓSIL: 102 de sus 133 funciones estaban muertas
// porque un script posterior declaraba el mismo nombre y ganaba. La parte 3
// conserva su propósito —que reordenar los <script> no sea un cambio
// invisible— pero ahora fija el invariante FUERTE: import.js es el único que
// las declara, así que ya no hay dos copias que puedan intercambiarse.
// Ver scripts/test_app_init_dead_duplicates.js.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Escritores de endMatch y funciones duplicadas ──\n');

const sprint3 = fs.readFileSync(path.join(ROOT, 'js', 'core', 'sprint3-init.js'), 'utf8');
const patches = fs.readFileSync(path.join(ROOT, 'js', 'core', 'patches.js'), 'utf8');
const active = fs.readFileSync(path.join(ROOT, 'js', 'match', 'persistence', 'active-match.js'), 'utf8');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

console.log('── PARTE 1 · estructura de los envoltorios ──');
ok('1a · active-match.js es el ÚNICO que define endMatch de verdad',
    /^window\.endMatch = function endMatch\(/m.test(active));
ok('1b · patches.js espera a que exista y es idempotente',
    /if \(typeof window\.endMatch !== 'function'\)/.test(patches)
    && /_cronosCleanupWrapped/.test(patches));
ok('1c · ⚠️ sprint3-init.js ahora TAMBIÉN espera, en vez de capturar un no-op',
    /if \(typeof window\.endMatch !== 'function'\)/.test(sprint3)
    && !/const origEndMatch = window\.endMatch \|\| \(\(\) => \{\}\)/.test(sprint3));
ok('1d · y tiene su propia guarda de idempotencia, distinta de la de patches.js',
    /_cronosAuditWrapped/.test(sprint3) && !/_cronosCleanupWrapped/.test(sprint3));
ok('1e · ⚠️ el envoltorio fantasma de startMatch se ha eliminado (esa función no existe)',
    !/window\.startMatch\s*=/.test(sprint3));
{
    let refs = 0;
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name === '.git') continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (/\.(js|html)$/.test(e.name)) {
                const rel = path.relative(ROOT, p).replace(/\\/g, '/');
                if (rel.startsWith('scripts/')) continue;
                for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
                    const c = l.trim();
                    if (c.startsWith('//') || c.startsWith('*')) continue;
                    if (/(?<![.\w$])startMatch\b(?!WithConvocation)/.test(c)) refs++;
                }
            }
        }
    };
    walk(ROOT);
    ok('1f · y nadie quedó referenciando startMatch', refs === 0, { referencias: refs });
}
ok('1g · sprint3-init.js se carga ANTES que active-match.js (por eso hacía falta esperar)',
    idx.indexOf('js/core/sprint3-init.js') < idx.indexOf('js/match/persistence/active-match.js'));

console.log('\n── PARTE 2 · ⚠️ el resultado ya no depende del orden de llegada ──');
// Se reproducen los dos escenarios con la MISMA mecánica de los tres archivos.
function simular({ sprint3Antes }) {
    const traza = [];
    const w = {};
    const real = function endMatch() { traza.push('endMatch'); return 'ok'; };

    const envolverAuditoria = () => {           // sprint3-init.js, versión nueva
        if (typeof w.endMatch !== 'function') return false;
        if (w.endMatch._cronosAuditWrapped) return true;
        const orig = w.endMatch;
        w.endMatch = function (...a) { traza.push('auditoria'); return orig.apply(this, a); };
        w.endMatch._cronosAuditWrapped = true;
        return true;
    };
    const envolverLimpieza = () => {            // patches.js
        if (typeof w.endMatch !== 'function') return false;
        if (w.endMatch._cronosCleanupWrapped) return true;
        const orig = w.endMatch;
        w.endMatch = function (...a) { const r = orig.apply(this, a); traza.push('limpieza'); return r; };
        w.endMatch._cronosCleanupWrapped = true;
        return true;
    };

    if (sprint3Antes) {
        // El intervalo dispara antes de que baje active-match.js: no encuentra
        // endMatch, así que reintenta. Luego llega el script real.
        const primerIntento = envolverAuditoria();
        w.endMatch = real;                       // active-match.js
        envolverAuditoria();                     // reintento del polling
        envolverLimpieza();
        return { traza: (w.endMatch(), traza), primerIntento };
    }
    w.endMatch = real;
    envolverAuditoria();
    envolverLimpieza();
    return { traza: (w.endMatch(), traza), primerIntento: true };
}
{
    const lento = simular({ sprint3Antes: true });
    const normal = simular({ sprint3Antes: false });
    ok('2a · en conexión lenta el primer intento NO envuelve nada (antes envolvía un no-op)',
        lento.primerIntento === false);
    ok('2b · ⚠️ la auditoría se ejecuta en AMBOS órdenes',
        lento.traza.includes('auditoria') && normal.traza.includes('auditoria'),
        { lento: lento.traza, normal: normal.traza });
    ok('2c · y la secuencia resultante es IDÉNTICA',
        lento.traza.join('>') === normal.traza.join('>'),
        { lento: lento.traza.join('>'), normal: normal.traza.join('>') });
    ok('2d · el endMatch real se ejecuta una sola vez',
        lento.traza.filter(x => x === 'endMatch').length === 1);
    ok('2e · los dos envoltorios conviven sin pisarse',
        lento.traza.includes('auditoria') && lento.traza.includes('limpieza'));
}

console.log('\n── PARTE 3 · funciones duplicadas: quién gana (hallazgo #10) ──');
{
    const impIdx = idx.indexOf('js/ai/import.js');
    const appIdx = idx.indexOf('js/core/app-init.js');
    ok('3a · js/ai/import.js se carga DESPUÉS de js/core/app-init.js',
        appIdx !== -1 && impIdx !== -1 && impIdx > appIdx, { appIdx, impIdx });

    const imp = fs.readFileSync(path.join(ROOT, 'js', 'ai', 'import.js'), 'utf8');
    const app = fs.readFileSync(path.join(ROOT, 'js', 'core', 'app-init.js'), 'utf8');
    // ACTUALIZADO EL 2026-07-28, tal y como avisaba el recordatorio que había
    // aquí: la copia muerta de app-init.js se borró en la Fase B del monolito
    // #5. Ya no hay dos declaraciones que puedan ganarse una a otra según el
    // orden de carga, así que el invariante deja de ser "gana import.js" y pasa
    // a ser el más fuerte: import.js es el ÚNICO que la declara. 3a sigue
    // comprobando el orden de carga, que es lo que hacía falta cuando había dos.
    for (const fn of ['startMatchWithConvocation', 'goToTitularSelection']) {
        const re = new RegExp('^(?:async )?function ' + fn + '\\(', 'm');
        ok('3b · ' + fn + ' la declara SOLO js/ai/import.js (la copia muerta de app-init.js se borró)',
            re.test(imp) && !re.test(app));
    }
    ok('3c · ⚠️ nadie invoca startMatchWithConvocation: las DOS copias están muertas',
        (() => {
            let llamadas = 0;
            const walk = (dir) => {
                for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (e.name === 'node_modules' || e.name === '.git') continue;
                    const p = path.join(dir, e.name);
                    if (e.isDirectory()) { walk(p); continue; }
                    if (!/\.(js|html)$/.test(e.name)) continue;
                    const rel = path.relative(ROOT, p).replace(/\\/g, '/');
                    if (rel.startsWith('scripts/')) continue;
                    for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
                        const c = l.trim();
                        if (c.startsWith('//') || c.startsWith('*')) continue;
                        if (/startMatchWithConvocation\s*\(/.test(c) && !/^(?:async )?function /.test(c)) llamadas++;
                    }
                }
            };
            walk(ROOT);
            return llamadas === 0;
        })());
    ok('3d · goToTitularSelection SÍ se usa (onclick de #btn-go-titulares)',
        /onclick="goToTitularSelection\(\)"/.test(imp) || /onclick="goToTitularSelection\(\)"/.test(app));
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);
