// ════════════════════════════════════════════════════════════════════
// El formulario de acceso/registro no puede quedar cableado a un global.
// ════════════════════════════════════════════════════════════════════
// FALLO REPORTADO (captura 8594): al enviar el formulario de registro,
//     Uncaught ReferenceError: doAuth is not defined at HTMLFormElement.onsubmit
//
// 🔑 LA FRAGILIDAD: auth.js es `type="module"` y su `window.doAuth = doAuth`
//    es de las ÚLTIMAS líneas del fichero. Cualquier cosa que interrumpa la
//    evaluación del módulo —el import estático de ./auth/role-launch.js que no
//    resuelva, una respuesta que no sea JS válido al pedirlo, un throw previo—
//    deja el `onsubmit="...doAuth()"` del HTML apuntando a un global que no
//    existe. El formulario queda muerto y el mensaje no dice nada de la causa.
//
// Este test NO puede reproducir el fallo del navegador. Lo que fija es que la
// fragilidad estructural esté eliminada:
//   · auth.js engancha el submit con una referencia DIRECTA, sin window.
//   · el onsubmit en línea, si sigue, comprueba antes de llamar y avisa.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'js', 'services', 'auth.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let fallos = 0;
const ok = (n, c, extra) => {
    if (c) console.log('  verde ' + n);
    else { fallos++; console.log('  ROJO  ' + n);
           if (extra !== undefined) console.log('        ' + String(extra).slice(0, 200)); }
};

console.log('\n=== 1. auth.js engancha el formulario por sí mismo ===');
ok('existe la función de enlace', /function _cronosEnlazaFormularioAuth\s*\(/.test(AUTH));
ok("busca el formulario por id 'auth-form'", /getElementById\('auth-form'\)/.test(AUTH));
ok('añade un listener de submit', /addEventListener\('submit'/.test(AUTH));
ok('llama a doAuth por referencia DIRECTA, no via window',
    /addEventListener\('submit',[\s\S]{0,160}?[^.]\bdoAuth\(\)/.test(AUTH));
ok('contempla que el DOM aún no esté listo',
    /readyState === 'loading'/.test(AUTH) && /DOMContentLoaded/.test(AUTH));
ok('no engancha dos veces', /cronosAuthEnlazado/.test(AUTH));

console.log('\n=== 2. El onsubmit en línea ya no puede lanzar ReferenceError ===');
const form = (HTML.match(/<form id="auth-form"[^>]*>/) || [''])[0];
ok('el formulario sigue existiendo', form.length > 0);
ok('NO llama a doAuth() a pelo',
    !/onsubmit="[^"]*(?:^|[;\s{(])doAuth\(\)/.test(form), form);
ok('comprueba que exista antes de llamar',
    /typeof window\.doAuth === 'function'/.test(form), form);
ok('si no existe, avisa al usuario en vez de callar',
    /showAuthError|alert\(/.test(form), form);

console.log('\n=== 3. El global se sigue publicando (nada que dependa de él se rompe) ===');
ok('window.doAuth se sigue asignando', /window\.doAuth\s*=\s*doAuth;/.test(AUTH));
ok('doAuth sigue exportado', /export async function doAuth\(\)/.test(AUTH));

console.log('\n=== 4. El grafo de módulos que auth.js necesita existe en disco ===');
// Un import estático que no resuelva es una de las formas de dejar el módulo
// sin evaluar, que es justo el escenario del fallo.
const imports = [...AUTH.matchAll(/^import\s+[^'"]*['"](\.[^'"]+)['"]/gm)].map(m => m[1]);
ok('se detecta al menos un import estático', imports.length > 0, imports);
imports.forEach(rel => {
    const p = path.join(ROOT, 'js', 'services', rel);
    ok('existe el módulo importado ' + rel, fs.existsSync(p), p);
});

console.log('\n' + (fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)'));
process.exit(fallos === 0 ? 0 : 1);
