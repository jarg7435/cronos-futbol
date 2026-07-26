// ─────────────────────────────────────────────────────────────────────────
// test_dead_duplicates_removed.js · Refactor de monolitos (auditoría 2026-07-22)
// MONOLITO #3 (js/coach/comms/panel.js), PASO 0: eliminación de ~487 líneas de
// código MUERTO por doble declaración, antes de empezar a extraer secciones.
//
// ── EL PROBLEMA ──
// Cuatro funciones estaban declaradas DOS VECES en el mismo archivo:
//     _loadUnifiedContactList      línea  734  y  1268
//     _selectUnifiedContact        línea 1017  y  1792
//     _loadUnifiedThreadMessages   línea 1094  y  1870
//     _sendUnifiedMessage          línea 1162  y  1945
// Con declaraciones de función en el mismo ámbito GANA LA ÚLTIMA (ambas se
// izan y la posterior sobrescribe el binding), así que las cuatro PRIMERAS
// nunca se ejecutaban. Y no eran copias inocuas: diferían en 443, 9, 17 y 20
// líneas respectivamente.
//
// ── POR QUÉ ES SEGURO BORRARLAS (esto es lo que fija la PARTE 1) ──
// No basta con citar la regla del lenguaje. La parte 1 lo demuestra sobre el
// código real: mete las DOS declaraciones de cada pareja en un sandbox, en el
// mismo orden en que aparecen en el archivo, y comprueba que el binding
// resultante es, byte a byte, la SEGUNDA. Además, la versión muerta de
// _sendUnifiedMessage usa `db` y `tabContext` sin declararlos nunca (no llama
// a _cFS()), así que habría lanzado ReferenceError en cuanto alguien enviara
// un mensaje: si fuera la viva, la mensajería estaría rota, y no lo está.
//
// ── QUÉ SE CONSERVA ──
// _loadThreadMessages (entre los dos bloques muertos) tiene una sola
// definición, se exporta en window y llama a _loadUnifiedThreadMessages
// resolviendo a la versión viva. La parte 2 vigila que sobreviva.
//
// ── DOS TESTS QUE HUBO QUE AJUSTAR ──
// test_manual_contact_parentuid.js y test_ismine_multirole_same_uid.js
// exigían `>= 2` ocurrencias de sus patrones, y sus propios comentarios
// explicaban que la segunda venía del "bloque duplicado legacy". Al
// desaparecer el duplicado pasan a `>= 1`. La parte 3 comprueba que ningún
// test volvió a quedarse esperando el bloque muerto.
//
// Este test es VERDE ANTES y DESPUÉS del borrado: las partes 1 y 2 describen
// invariantes, y la parte 4 se activa sola cuando el borrado ya está hecho.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PANEL = path.join(ROOT, 'js', 'coach', 'comms', 'panel.js');
const SRC = fs.readFileSync(PANEL, 'utf8');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

const DUPES = ['_loadUnifiedContactList', '_selectUnifiedContact',
               '_loadUnifiedThreadMessages', '_sendUnifiedMessage'];

// ── Extractor por conteo de llaves, sobre el archivo real ─────────────────
function declsOf(name) {
    const re = new RegExp('^async function ' + name + '\\(', 'gm');
    const out = [];
    let m;
    while ((m = re.exec(SRC)) !== null) {
        const start = m.index;
        let i = SRC.indexOf('{', start), depth = 0;
        for (; i < SRC.length; i++) {
            if (SRC[i] === '{') depth++;
            else if (SRC[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        }
        out.push({ start, text: SRC.slice(start, i), line: SRC.slice(0, start).split('\n').length });
    }
    return out;
}

const ALREADY_CLEAN = DUPES.every(n => declsOf(n).length === 1);
console.log('── Duplicados muertos en comms/panel.js — estado: '
    + (ALREADY_CLEAN ? 'YA LIMPIO' : 'AÚN DUPLICADO') + ' ──\n');

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · demostración de cuál implementación vive ──');
    if (ALREADY_CLEAN) {
        ok('1 · (ya limpio) las cuatro tienen una sola declaración',
            DUPES.every(n => declsOf(n).length === 1),
            DUPES.map(n => n + ':' + declsOf(n).length));
    } else {
        DUPES.forEach((name, idx) => {
            const d = declsOf(name);
            if (d.length !== 2) { ok('1' + 'abcd'[idx] + ' · ' + name + ' tiene 2 declaraciones', false, d.length); return; }
            // Se ejecutan LAS DOS en el orden real del archivo, aisladas.
            const sb = {};
            vm.createContext(sb);
            vm.runInContext(d[0].text + '\n' + d[1].text + '\nthis.__f = ' + name + ';', sb);
            const bound = sb.__f.toString();
            const isSecond = bound === d[1].text && bound !== d[0].text;
            ok('1' + 'abcd'[idx] + ' · ' + name + ': gana la 2ª (línea ' + d[1].line
                + '), muere la 1ª (línea ' + d[0].line + ')',
                isSecond, { bound: bound.length, primera: d[0].text.length, segunda: d[1].text.length });
        });
        {
            // Evidencia independiente de la regla del lenguaje: la muerta no
            // podría haber funcionado nunca.
            const d = declsOf('_sendUnifiedMessage');
            const dead = d[0].text, live = d[1].text;
            ok('1e · la 1ª de _sendUnifiedMessage usa db/tabContext SIN declararlos ni pedir _cFS()',
                /\bdb\b/.test(dead) && /tabContext/.test(dead)
                && !/_cFS\(\)/.test(dead)
                && !/(?:const|let|var)\s+tabContext\s*=/.test(dead),
                { usaDb: /\bdb\b/.test(dead), llamaCFS: /_cFS\(\)/.test(dead) });
            ok('1f · la 2ª sí declara ambas (const tabContext = …, const { db, … } = await _cFS())',
                /_cFS\(\)/.test(live) && /(?:const|let|var)\s+tabContext\s*=/.test(live));
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · invariantes que el borrado no puede tocar ──');
    ok('2a · _loadThreadMessages sobrevive con una sola definición',
        (SRC.match(/^async function _loadThreadMessages\(/gm) || []).length === 1,
        (SRC.match(/^async function _loadThreadMessages\(/gm) || []).length);
    ok('2b · y sigue exportado a window',
        /window\._loadThreadMessages\s*=\s*_loadThreadMessages;/.test(SRC));
    ok('2c · delega en _loadUnifiedThreadMessages (que resuelve a la versión viva)',
        /return await _loadUnifiedThreadMessages\(threadId, contact\);/.test(SRC));
    ok('2d · _switchUnifiedTab sigue justo después del segundo bloque borrado',
        /^async function _switchUnifiedTab\(/m.test(SRC));
    // OJO: sólo TRES de las cuatro se exportan. _loadUnifiedThreadMessages es
    // interna y sólo se alcanza a través de _loadThreadMessages (2b), que sí
    // está en window. El borrado no cambia esa API.
    ['_loadUnifiedContactList', '_selectUnifiedContact', '_sendUnifiedMessage']
        .forEach(n => ok('2e · window.' + n + ' sigue exportado',
            new RegExp('window\\.' + n + '\\s*=\\s*' + n + ';').test(SRC)));
    ok('2f · _loadUnifiedThreadMessages NO se exporta (es interna, vía _loadThreadMessages)',
        !/window\._loadUnifiedThreadMessages\s*=/.test(SRC));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · los patrones que asertan otros tests siguen presentes ──');
    const PATTERNS = [
        ["parentUid: c.uid || '' (test_manual_contact_parentuid)", /parentUid:\s*c\.uid \|\| ''/g],
        ['isMine exige senderRole (test_ismine_multirole_same_uid)',
            /m\.senderUid === me\.uid && \(!m\.senderRole \|\| m\.senderRole ===/g],
        ['guarda de documentos secundarios (test_secondary_doc_exclusion)',
            /if \(data\.uid && data\.uid !== d\.id\) return;/g],
        ['canonicalización en _sendUnifiedMessage y bulk (test_role_thread_canonical)',
            /const tabContext = _getCanonicalContext\(window\._umState\.role, window\._umState\.activeTab\);/g],
    ];
    PATTERNS.forEach(([label, re], i) => {
        const n = (SRC.match(re) || []).length;
        // El último debe seguir siendo 2 (ambas ocurrencias están vivas);
        // los otros tres bajan de 2 a 1 al borrar, pero nunca a 0.
        const min = i === 3 ? 2 : 1;
        ok('3' + 'abcd'[i] + ' · ' + label + ' → ' + n + ' (mín. ' + min + ')', n >= min, n);
    });
    {
        // Los DOS tests cuya expectativa dependía explícitamente del bloque
        // duplicado (sus comentarios lo decían) ya no exigen 2 ocurrencias.
        // No se generaliza a "ningún test espera 2": muchos cuentan cosas que
        // legítimamente aparecen dos veces y no tienen nada que ver con esto.
        const SC = path.join(ROOT, 'scripts');
        const rd = (f) => fs.readFileSync(path.join(SC, f), 'utf8');
        ok('3e · test_manual_contact_parentuid ya no exige 2 ocurrencias',
            /fixedOccurrences >= 1/.test(rd('test_manual_contact_parentuid.js'))
            && !/fixedOccurrences >= 2/.test(rd('test_manual_contact_parentuid.js')));
        ok('3f · test_ismine_multirole_same_uid ya no exige 2 ocurrencias',
            /roleCheckOccurrences >= 1/.test(rd('test_ismine_multirole_same_uid.js'))
            && !/roleCheckOccurrences >= 2/.test(rd('test_ismine_multirole_same_uid.js')));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · resultado del borrado (sólo cuando ya está hecho) ──');
    if (ALREADY_CLEAN) {
        DUPES.forEach((n, i) => ok('4' + 'abcd'[i] + ' · ' + n + ' declarada EXACTAMENTE una vez',
            declsOf(n).length === 1, declsOf(n).length));
        ok('4e · no quedan declaraciones duplicadas de nivel superior en el archivo',
            (() => {
                const names = (SRC.match(/^(?:async )?function [A-Za-z_$][A-Za-z0-9_$]*/gm) || [])
                    .map(s => s.replace(/^(?:async )?function /, ''));
                const dup = names.filter((n, i) => names.indexOf(n) !== i);
                return dup.length === 0;
            })(),
            (() => {
                const names = (SRC.match(/^(?:async )?function [A-Za-z_$][A-Za-z0-9_$]*/gm) || [])
                    .map(s => s.replace(/^(?:async )?function /, ''));
                return [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
            })());
        const lineas = SRC.split('\n').length;
        ok('4f · el archivo bajó de ~5878 a menos de 5450 líneas', lineas < 5450, lineas);
    } else {
        console.log('   (pendiente: el borrado aún no se ha aplicado)');
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
