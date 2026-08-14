// ═══════════════════════════════════════════════════════════════════════════
//  EL NOMBRE REAL, NUNCA EL CORREO — v534
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor: en la columna NOMBRE (árbol de categorías del SuperAdmin
//  y listados) salía el trozo del correo anterior a la arroba —"jose_arg027",
//  "brunamp"— en vez del nombre con el que se registró el usuario.
//
//  🔑🔑🔑 EL NOMBRE SÍ ESTABA GUARDADO. Leído por REST sobre producción:
//  **6 de los 7 usuarios NO tienen `firstName` en la raíz** del documento, pero
//  todos lo llevan dentro de `allRoles[].firstName` ("Nena", "José Alberto",
//  "Alberto", "Dámaso", "Bruno"). El código miraba sólo la raíz, no lo
//  encontraba, y caía en el último recurso: partir el correo por la arroba.
//  Sin leer los datos, el "arreglo" habría sido pedirle al usuario que se
//  pusiera nombre — y ya lo tenía.
//
//  ⚠️ NO HAY APELLIDOS: `lastName` es `null` en todos los roles de todos los
//  usuarios de producción. Se muestra lo que hay.
//
//  Los casos usan la FORMA REAL de esos documentos.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const SRC_TREE = fs.readFileSync(path.join(RAIZ, 'js/admin/shared/category-tree.js'), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}

// Carga el módulo en un sandbox para USAR el resolutor de verdad.
const sb = {
    console: { log() {}, warn() {}, error() {} },
    document: { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {} }),
                addEventListener() {}, querySelectorAll: () => [] },
    setTimeout: () => {}, ROLE_META: {},
};
sb.window = sb;
vm.createContext(sb);
try { vm.runInContext(SRC_TREE, sb); } catch (e) { console.log('  (aviso al cargar: ' + e.message + ')'); }
const nombreDe = sb.window.cronosNombreUsuario;

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · el nombre sale de donde está ──');
// ───────────────────────────────────────────────────────────────────────────
ok('1a · el resolutor existe y es único', typeof nombreDe === 'function');

if (typeof nombreDe === 'function') {
    // La forma REAL de jose_arg027 en producción: sin nada en la raíz.
    const real = {
        email: 'jose_arg027@hotmail.com',
        status: 'active',
        allRoles: [{ role: 'user', displayName: null, firstName: 'Nena', lastName: null }],
    };
    ok('1b · 🔑🔑🔑 lo saca de allRoles[].firstName (la raíz no lo tiene)',
       nombreDe(real) === 'Nena', nombreDe(real));
    ok('1c · 🔑 y NO devuelve el trozo del correo',
       !/jose_arg027/.test(nombreDe(real)), nombreDe(real));

    ok('1d · la raíz manda si la tiene',
       nombreDe({ email: 'x@y.com', firstName: 'Bruno',
                  allRoles: [{ firstName: 'Otro' }] }) === 'Bruno');
    ok('1e · nombre y apellido se juntan cuando los hay',
       nombreDe({ firstName: 'José', lastName: 'Alberto' }) === 'José Alberto');
    ok('1f · admite las variantes en castellano del registro',
       nombreDe({ nombre: 'Dámaso', apellidos: 'Rodríguez' }) === 'Dámaso Rodríguez');
    ok('1g · usa el rol activo que pinta el árbol',
       nombreDe({ email: 'a@b.c', _activeRoleData: { firstName: 'Alberto' } }) === 'Alberto');
    ok('1h · y el nombre de una solicitud de registro',
       nombreDe({ email: 'a@b.c', requestedName: 'Bruno' }) === 'Bruno');

    // ⚠️ El caso que motivó todo: sin nombre, NO se inventa con el correo.
    ok('1i · 🔑🔑 sin nombre NO cae en el correo: lo dice',
       nombreDe({ email: 'brunamp@live.com' }) === 'Sin nombre',
       nombreDe({ email: 'brunamp@live.com' }));
    ok('1j · el texto por defecto se puede elegir',
       nombreDe({ email: 'a@b.c' }, 'Usuario') === 'Usuario');
    ok('1k · un `requestedName` vacío no cuenta como nombre',
       nombreDe({ email: 'a@b.c', requestedName: '' }) === 'Sin nombre',
       nombreDe({ email: 'a@b.c', requestedName: '' }));
    ok('1l · no revienta con basura', nombreDe(null) === 'Sin nombre' && nombreDe(undefined) === 'Sin nombre');
    ok('1m · un allRoles sin ningún nombre no inventa nada',
       nombreDe({ email: 'a@b.c', allRoles: [{ role: 'user', firstName: null }] }) === 'Sin nombre');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · ya no queda ningún correo haciendo de nombre ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const ficheros = ['js/admin/shared/category-tree.js', 'js/admin/club/panel.js',
                      'js/admin/individual/panel.js', 'js/admin/superadmin/requests-tab.js',
                      'js/services/auth.js'];
    const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '')
                         .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    ficheros.forEach(f => {
        const src = sinCom(fs.readFileSync(path.join(RAIZ, f), 'utf8'));
        // ⚠️ Sobre el CÓDIGO, sin comentarios: los comentarios de este arreglo
        // hablan de "la arroba" y casarían con cualquier regex ingenua.
        ok('2 · ' + f.split('/').pop() + ' no usa el correo como nombre',
           !/email[^\n]{0,30}\.split\(['"]@['"]\)/.test(src),
           (src.match(/[^\n]*split\(['"]@['"]\)[^\n]*/) || [''])[0].trim().slice(0, 90));
    });
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · los consumidores usan el resolutor ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const consumidores = ['js/admin/shared/category-tree.js', 'js/admin/club/panel.js',
                          'js/admin/individual/panel.js', 'js/admin/superadmin/requests-tab.js'];
    consumidores.forEach(f => {
        const src = fs.readFileSync(path.join(RAIZ, f), 'utf8');
        ok('3 · ' + f.split('/').pop() + ' llama a cronosNombreUsuario',
           /cronosNombreUsuario\(/.test(src));
    });
    // El resolutor tiene que estar definido ANTES que quien lo usa.
    const HTML = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
    const pos = (f) => HTML.indexOf(f);
    ok('3z · 🔑 category-tree.js (que lo define) se carga antes que sus consumidores',
       pos('js/admin/shared/category-tree.js') !== -1 &&
       pos('js/admin/shared/category-tree.js') < pos('js/admin/superadmin/requests-tab.js') &&
       pos('js/admin/shared/category-tree.js') < pos('js/admin/club/panel.js') &&
       pos('js/admin/shared/category-tree.js') < pos('js/admin/individual/panel.js'),
       'si se carga después, el resolutor no existe cuando se le llama');
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · y no se escribe el correo en la base de datos ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const AUTH = fs.readFileSync(path.join(RAIZ, 'js/services/auth.js'), 'utf8');
    const i = AUTH.indexOf('Crear documento de usuario como admin individual');
    // ⚠️ Ventana holgada: con 900 caracteres se quedaba corta desde que el
    // arreglo añadió su comentario, y 4b salía roja con el código correcto.
    // Una ventana mal medida es un falso rojo esperando su turno.
    const bloque = i === -1 ? '' : AUTH.slice(i, i + 1800);
    ok('4a · el alta de admin individual ya no compone el nombre con el correo',
       !!bloque && !/user\.email\.split/.test(bloque),
       'se guardaría "Administrador Individual jose_arg027" para siempre');
    ok('4b · y sin nombre deja la etiqueta sola, sin inventar',
       /'Administrador Individual'/.test(bloque), bloque.slice(0, 80));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ El nombre sale del perfil; el correo se queda en su columna');
