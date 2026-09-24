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
