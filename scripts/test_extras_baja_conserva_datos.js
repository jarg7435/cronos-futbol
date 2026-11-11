// ─────────────────────────────────────────────────────────────────────────
// test_extras_baja_conserva_datos.js · v852
//
// Encargo del autor (implementar.txt 2026-11-11): cuando un club deja de pagar
// un extra o el SuperAdmin lo apaga, la interfaz lo bloquea, pero NUNCA se
// borra lo que los usuarios generaron con él. Al reactivarlo, todo vuelve
// intacto.
//
// Auditoría del 11-11: la garantía YA SE CUMPLE, porque la baja es LÓGICA:
//   · el interruptor del SA escribe sólo `extras.<clave> = true|false`
//     en clubs/{id} (o individuals/{id}); no toca ninguna otra colección;
//   · ninguna Cloud Function lee `extras`, así que nada reacciona al cambio;
//   · las reglas (Firestore y Storage) usan el extra sólo para CREAR datos
//     nuevos (clips de vídeo); leer y conservar lo antiguo no depende de él;
//   · en el cliente, los lectores del extra sólo deciden qué se ENSEÑA.
//
// Este test CONGELA esas cuatro patas: si un cambio futuro añade un borrado
// o una limpieza ligada a desactivar un extra, se pone en rojo.
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0, pass = 0;
const ok = (nombre, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + nombre); }
    else { fail++; console.log('FAIL ' + nombre); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

// Quita comentarios // y /* */ (suficiente para JS y para las reglas).
const sinComentarios = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');

// ═══ 1 · El interruptor del SA sólo escribe la bandera ═══════════════════
const TOGGLE = 'js/admin/superadmin/extras-toggle.js';
const toggleSrc = leer(TOGGLE);
const toggleCodigo = sinComentarios(toggleSrc);

ok('1a · extras-toggle.js no contiene ningún borrado (deleteDoc/deleteField/writeBatch/.delete())',
   !/deleteDoc|deleteField|writeBatch|\.delete\s*\(/.test(toggleCodigo));

(async () => {
    const llamadas = [];
    const fakeFS = {
        doc: (db, col, id) => ({ col, id }),
        updateDoc: async (ref, data) => { llamadas.push({ op: 'update', ref, data }); },
        setDoc: async (ref, data, opts) => { llamadas.push({ op: 'set', ref, data, opts }); },
        deleteDoc: async (ref) => { llamadas.push({ op: 'delete', ref }); },
    };
    const sandbox = {
        window: { _cronos_auth: { db: {} } },
        console: { log() {}, warn() {}, error() {} },
        __fakeFS: fakeFS,
        document: { getElementById: () => null, querySelectorAll: () => [] },
    };
    sandbox.window.window = sandbox.window;
    const codigo = toggleSrc.replace(
        /await import\('https:\/\/www\.gstatic\.com\/firebasejs\/[^']+\/firebase-firestore\.js'\)/g,
        '__fakeFS');
    vm.createContext(sandbox);
    vm.runInContext(codigo.replace(/\bwindow\./g, 'window.'), sandbox);

    const guarda = sandbox.window._saGuardaExtrasEntidad;
    ok('1b · existe window._saGuardaExtrasEntidad', typeof guarda === 'function');

    if (typeof guarda === 'function') {
        for (const def of sandbox.window._CRONOS_EXTRAS_DEF) {
            llamadas.length = 0;
            const r1 = await guarda('club_X', def.key, false);
            const apagar = llamadas.slice();
            llamadas.length = 0;
            const r2 = await guarda('club_X', def.key, true);
            const encender = llamadas.slice();
            const soloBandera = (ls, v) => ls.length === 1 && ls[0].op === 'update'
                && ls[0].ref.col === 'clubs' && ls[0].ref.id === 'club_X'
                && JSON.stringify(ls[0].data) === JSON.stringify({ ['extras.' + def.key]: v });
            ok('1c · «' + def.key + '»: apagar escribe SÓLO extras.' + def.key + ' = false',
               r1 === true && soloBandera(apagar, false), apagar);
            ok('1d · «' + def.key + '»: reactivar escribe SÓLO extras.' + def.key + ' = true',
               r2 === true && soloBandera(encender, true), encender);
        }
    }

    // ═══ 2 · Ninguna Cloud Function reacciona a `extras` ═════════════════
    const fnCodigo = sinComentarios(leer('functions/index.js'));
    ok('2 · functions/index.js no lee `extras` fuera de comentarios (nada limpia al apagar)',
       !/\bextras\b/.test(fnCodigo),
       (fnCodigo.match(/.*\bextras\b.*/g) || []).slice(0, 5));

    // ═══ 3 · Las reglas usan el extra sólo para CREAR ════════════════════
    //  Se parte cada fichero en sentencias `allow …;` y se comprueba que las
    //  que mencionan el extra (directamente o por sus helpers) son de create.
    const helpersExtra = /clExtraActivo|extraActivo\s*\(|\.get\('extras'/;
    for (const rel of ['firestore.rules', 'storage.rules']) {
        const src = sinComentarios(leer(rel));
        const sentencias = src.match(/allow\s+[^:]+:[\s\S]*?;/g) || [];
        const malas = sentencias
            .filter(s => helpersExtra.test(s))
            .filter(s => !/^allow\s+create\s*:/.test(s.trim()))
            .map(s => s.slice(0, 120));
        ok('3 · ' + rel + ': el guardián ve al menos una sentencia con el extra (no pasa en vacío)',
           sentencias.some(s => helpersExtra.test(s)));
        ok('3 · ' + rel + ': el extra sólo condiciona `allow create` (leer/borrar no dependen de él)',
           malas.length === 0, malas);
    }

    // ═══ 4 · En el cliente, apagar un extra no dispara borrados ══════════
    //  Ningún fichero de js/ puede tener, en la MISMA línea o en las 6
    //  siguientes a una comprobación de extra, una operación de borrado.
    const lectorExtra = /_cronosExtraEnabled\(|cronosSAvExtraActivo\(|\bextras\s*(\.|\[)\s*['"]?[a-z_]+['"]?\]?\s*(===|!==|==|!=)\s*(false|true)/;
    const borrado = /deleteDoc\(|deleteField\(|batch\.delete\(|\.delete\(\)|removeItem\(/;
    const sospechosos = [];
    let lectores = 0;
    const recorrer = (dir) => {
        for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = path.posix.join(dir, e.name);
            if (e.isDirectory()) { if (e.name !== 'vendor') recorrer(rel); continue; }
            if (!e.name.endsWith('.js')) continue;
            const lineas = sinComentarios(leer(rel)).split('\n');
            lineas.forEach((l, i) => {
                if (!lectorExtra.test(l)) return;
                lectores++;
                const ventana = lineas.slice(i, i + 7).join('\n');
                if (borrado.test(ventana)) sospechosos.push(rel + ':' + (i + 1));
            });
        }
    };
    recorrer('js');
    ok('4 · el guardián encuentra los lectores de extras del cliente (>= 20; hay ' + lectores + ')', lectores >= 20);
    ok('4 · ningún lector de extras del cliente va seguido de un borrado', sospechosos.length === 0, sospechosos);

    console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
