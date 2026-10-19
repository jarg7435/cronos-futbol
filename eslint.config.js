'use strict';
// ─────────────────────────────────────────────────────────────────────────
//  eslint.config.js  ·  v758 (reauditoría 23-09)
//
//  Sustituye a `.eslintrc.json`, que ESLint 9 ya no lee: `npm run lint` no
//  arrancaba. Formato «flat config».
//
//  🔑 CRITERIO: es ERROR lo que puede romper en EJECUCIÓN (un nombre que no
//  existe, una clave duplicada, código inalcanzable…) y AVISO lo estético. Así
//  `npm run lint` puede ser una puerta que corta sin ahogarse en ruido.
//
//  🔑 LA APP NO ES MODULAR: `js/` son ~110 scripts clásicos que comparten el
//  ámbito global (lo que declara uno lo usa otro). Silenciar `no-undef` para
//  eso habría tapado justo lo que importa: la primera pasada de esta regla
//  encontró SEIS ReferenceError vivos en producción (v758). Por eso las
//  globales del proyecto no se escriben a mano: se CALCULAN leyendo el propio
//  código (declaraciones de primer nivel y `window.X = …`). Un nombre que no
//  declara nadie sigue siendo error.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');
const espree = require('espree');

const JS_DIR = path.join(__dirname, 'js');

// Los que cargan con <script type="module"> (grep de los HTML desplegados).
const MODULOS = ['js/services/auth.js', 'js/services/auth/role-launch.js', 'js/services/firebase-init.js'];

// Nombres que el código consulta SIEMPRE detrás de `typeof X !== 'undefined'`
// y que a propósito pueden no existir: el SDK compat de Firebase (no se carga),
// `module` (exportación para los tests de Node) y funciones opcionales.
const OPCIONALES = ['firebase', 'module', 'currentCategory', 'colorAllTimers', 'updateTimerDisplay', '_cronosDevRoleBtn'];

function ficherosJs(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'vendor') ficherosJs(p, out); }
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

function globalesDelProyecto() {
    const nombres = new Set(OPCIONALES);
    for (const f of ficherosJs(JS_DIR, [])) {
        const rel = path.relative(__dirname, f).split(path.sep).join('/');
        let ast;
        try {
            ast = espree.parse(fs.readFileSync(f, 'utf8'),
                { ecmaVersion: 2022, sourceType: MODULOS.includes(rel) ? 'module' : 'script' });
        } catch (_) { continue; }  // un fichero que no parsea ya lo marca el propio lint
        // 1. Primer nivel de un script clásico = global compartida.
        if (!MODULOS.includes(rel)) {
            for (const n of ast.body) {
                if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id) nombres.add(n.id.name);
                if (n.type === 'VariableDeclaration') {
                    for (const d of n.declarations) if (d.id.type === 'Identifier') nombres.add(d.id.name);
                }
            }
        }
        // 2. `window.X = …` (y globalThis/self) en cualquier profundidad.
        (function visita(x) {
            if (!x || typeof x.type !== 'string') return;
            if (x.type === 'AssignmentExpression' && x.left.type === 'MemberExpression' && !x.left.computed &&
                x.left.object.type === 'Identifier' && ['window', 'globalThis', 'self'].includes(x.left.object.name)) {
                nombres.add(x.left.property.name);
            }
            for (const k in x) {
                const v = x[k];
                if (Array.isArray(v)) v.forEach(visita);
                else if (v && typeof v.type === 'string') visita(v);
            }
        })(ast);
    }
    return Object.fromEntries([...nombres].map(n => [n, 'writable']));
}

// ─────────────────────────────────────────────────────────────────────────
//  📉 AVISOS: 112 → 34 (reauditoría del 19-10). Se retiraron los que se
//  podían quitar SIN cambiar el comportamiento: nombres de SDK importados y
//  no usados, cálculos puros sin lector, bloques `if {}` vacíos, `window.X =
//  window.X`, escapes de más y `obj.hasOwnProperty`. `npm run lint` lleva
//  `--max-warnings 34`: un aviso NUEVO corta la puerta igual que un error.
//
//  LOS 34 QUE QUEDAN SON DELIBERADOS (no tocar sin leer esto):
//   · 16 no-redeclare · superadmin.panel.js (borrado de usuario): `var` en
//     ramas hermanas de la misma función. Legal y sin efecto en ejecución.
//   · 6 · club/panel.js `userRow` (+ su uid y 3 escapes) y `_slotKey`: código
//     MUERTO desde el 25-06 (lo sustituyó `_userRowHtml`), pero tres guards
//     (test_baja_por_plaza_y_alta_club 1a/1b, test_ningun_aprobar_pierde_plazas
//     5g, test_baja_es_revocacion) aún lo leen. Se retira junto con el arreglo
//     de «➖ Quitar del equipo», que hoy no pasa la plaza (hallazgo del 19-10).
//   · 2 · utils.js `existing`: lo usa el contrafactual de
//     test_livematchid_idempotency (C1) para demostrar por qué NO reutilizar.
//   · 1 · individual-reports.js `miDismissed`: fijado por su guard (2l).
//   · 2 · parent/panel.js `_ppTabAttrs`/`_ppTabLock`: conservados a propósito
//     (ver el comentario v591 de ese fichero).
//   · 1 · auth.js `_showMultiRolePicker`: conservado a propósito (ver
//     test_sa_cambiar_rol / test_role_launch_module).
//   · 4 · posibles funciones a medio cablear, a revisar con el autor, NO a
//     borrar a ciegas: extras.js `fallaBajas` (¿avisar en pantalla?),
//     whatsapp-email.js `maxSlots` (cupo de convocados calculado y no
//     aplicado), match-reports-send.js `selectedPlayerIds`,
//     match-reports-auto.js `isRecipientAuthorized`.
//   · 1 · sprint3-tests.js `passed`: contador de un autotest de consola.
//   · 1 · functions/index.js `beforeKeys`: tocar functions exige desplegarlas.
// ─────────────────────────────────────────────────────────────────────────

// Estéticas o inofensivas en ejecución: se ven, pero no cortan.
const AVISOS = {
    'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-useless-escape': 'warn',
    'no-self-assign': 'warn',
    'no-prototype-builtins': 'warn',
    'no-irregular-whitespace': ['warn', { skipComments: true }],
    // `var` repetido en ramas hermanas: legal y sin efecto. Y con las globales
    // calculadas, cada fichero «redeclara» la suya: eso no es un defecto.
    'no-redeclare': ['warn', { builtinGlobals: false }],
};

module.exports = [
    {
        ignores: [
            'node_modules/**', 'functions/node_modules/**', '.firebase/**', 'dist/**',
            'js/vendor/**',          // pdf.js y tesseract: código de terceros minificado
            'scripts/test_*.js',
        ],
    },
    js.configs.recommended,
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: { ...globals.browser, ...globalesDelProyecto() },
        },
        rules: AVISOS,
    },
    {
        files: MODULOS,
        languageOptions: { sourceType: 'module' },
    },
    {
        files: ['functions/**/*.js'],
        languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
        rules: { ...AVISOS, 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] },
    },
];
