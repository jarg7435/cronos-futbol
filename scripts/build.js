// ─────────────────────────────────────────────────────────────────────────
//  scripts/build.js  ·  v751 (Fase 0, 2026-09-22)
//
//  `npm run build` ERA `echo TODO && exit 0`.
//
//  No es una anécdota: un script que sale con 0 pase lo que pase es un verde
//  permanente, y el dictamen de auditoría del 22-09 le puso un 4,5/10 a la
//  «calidad de entrega» exactamente por esto. Mientras existiera, cualquier
//  integración continua, cualquier `predeploy` y cualquier persona que hiciera
//  lo razonable —«compila antes de subir»— recibía un OK que no significaba
//  nada.
//
//  🔑 ESTE PROYECTO NO TRANSPILA NI EMPAQUETA, Y NO TIENE POR QUÉ. Se sirve
//  tal cual desde Hosting: no hay artefacto que GENERAR. Lo que sí hay, y no
//  existía, es un artefacto que VALIDAR. Así que esto no inventa un bundler:
//  comprueba que lo que se va a subir está entero y es coherente.
//
//  Las nueve comprobaciones no son una lista de buenas intenciones: cada una
//  corresponde a un fallo que este proyecto YA PAGÓ, y está anotado en su sitio
//  con la versión en la que dolió.
//
//  ⚠️ NO LANZA LA BATERÍA DE PRUEBAS. `npm test` tarda ~150 s y tiene su propio
//  comando; el build tiene que poder lanzarse en segundos, antes de cada
//  despliegue, sin que nadie tenga la tentación de saltárselo. Para las dos
//  cosas a la vez está `npm run verify`.
//
//  Guard: scripts/test_build_real.js
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const existe = (p) => fs.existsSync(path.join(ROOT, p));

// ⚠️ EL BOM SE QUITA A MANO, Y SE ESCRIBE CON `fromCharCode`. Varios ficheros
//   de este proyecto empiezan por la marca de orden de bytes —package.json el
//   primero— y `JSON.parse` se atraganta con ella. Se evita escribir el
//   carácter literal dentro del código: un carácter INVISIBLE en una expresión
//   regular es indistinguible de un error de edición, y cualquier herramienta
//   que normalice la codificación se lo lleva sin que nadie lo vea.
const BOM = String.fromCharCode(0xFEFF);
const leer = (p) => {
    const s = fs.readFileSync(path.join(ROOT, p), 'utf8');
    return s.charAt(0) === BOM ? s.slice(1) : s;
};

const t0 = Date.now();
let fallos = 0;
const paso = (n) => console.log('\n── ' + n + ' ' + '─'.repeat(Math.max(0, 66 - n.length)));
const bien = (m) => console.log('  ✓ ' + m);
const mal = (m, detalle) => {
    fallos++;
    console.log('  ✗ ' + m);
    if (detalle) String(detalle).split('\n').slice(0, 12).forEach((l) => console.log('      ' + l));
};

// Los HTML que Hosting sirve de verdad. `presentacion*.html` y el informe
// técnico están en el `ignore` de firebase.json, así que no se validan: no
// viajan.
const HTML_DESPLEGADOS = ['index.html', 'live.html', 'offline.html', 'privacy.html',
                          '404.html', 'landing.html'];

const correr = (args, etiqueta) => {
    const r = cp.spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
    if (r.status === 0) { bien(etiqueta); return true; }
    mal(etiqueta, (r.stdout || '') + (r.stderr || ''));
    return false;
};

console.log('╔' + '═'.repeat(68) + '╗');
console.log('║  CHRONOS · build — validación del artefacto que se despliega       ║');
console.log('╚' + '═'.repeat(68) + '╝');

// ════════════════════════════════════════════════════════════════════
paso('1/9 · ¿Compila js/ entero?');
// v596 · Una lista a mano de 18 ficheros dejó setup-modal.js sin comprobar y
// un backtick en un comentario lo tumbó. v641 · 219/219 en verde con el panel
// del SuperAdmin en negro. Un fichero que no compila no puede pasar nada.
correr([path.join('scripts', '_check_syntax.js')], 'js/ compila entero');

// ════════════════════════════════════════════════════════════════════
paso('2/9 · ¿Compila el JavaScript EMBEBIDO en los HTML?');
// Aquí viven el arranque, la insignia de versión y el App Check de live.html.
// `_check_syntax.js` sólo recorre js/: esto no lo miraba nadie.
correr([path.join('scripts', '_check_html_inline_js.js'), ...HTML_DESPLEGADOS],
       'JavaScript embebido de los ' + HTML_DESPLEGADOS.length + ' HTML desplegados');

// ════════════════════════════════════════════════════════════════════
paso('3/9 · ¿Compilan el Service Worker y el backend?');
// El SW no está en js/ y tampoco lo recorría `_check_syntax.js`. Un SW roto
// no se instala, y la app se queda sin armazón offline sin decir nada.
for (const f of ['sw.js', 'firebase-messaging-sw.js', path.join('functions', 'index.js')]) {
    if (!existe(f)) { mal(f + ' no existe'); continue; }
    correr(['--check', path.join(ROOT, f)], f + ' compila');
}

// ════════════════════════════════════════════════════════════════════
paso('4/9 · ¿Son JSON válido los ficheros de configuración?');
// Un firebase.json con una coma de más rompe el despliegue a mitad; un
// manifest.json roto deja la PWA sin instalar, y eso NO da error en consola.
for (const f of ['manifest.json', 'firebase.json', 'firestore.indexes.json',
                 'package.json', path.join('functions', 'package.json')]) {
    if (!existe(f)) { mal(f + ' no existe'); continue; }
    try {
        JSON.parse(leer(f));
        bien(f + ' es JSON válido');
    } catch (e) {
        mal(f + ' NO es JSON válido', e.message);
    }
}

// ════════════════════════════════════════════════════════════════════
paso('5/9 · ¿Existe en disco todo lo que los HTML enlazan?');
// 🔑 UN <script src> QUE APUNTA A UN FICHERO QUE NO ESTÁ NO DA ERROR DE BUILD
//    NI DE DESPLIEGUE: da un 404 en el navegador de otro, y la función que ese
//    módulo definía simplemente no existe. Es el modo de fallo más silencioso
//    que tiene este proyecto.
{
    let comprobados = 0;
    const rotos = [];
    for (const h of ['index.html', 'live.html']) {
        const html = leer(h).replace(/<!--[\s\S]*?-->/g, '');
        const re = /\b(?:src|href)="((?!https?:|data:|mailto:|#)[^"]+)"/g;
        let m;
        while ((m = re.exec(html)) !== null) {
            const ruta = m[1].split('?')[0].replace(/^\.\//, '');
            if (!ruta || ruta.startsWith('/')) continue;      // rutas absolutas de Hosting
            if (!/\.(js|css|json|svg|png|jpg|jpeg|ico|webmanifest)$/i.test(ruta)) continue;
            comprobados++;
            if (!existe(ruta)) rotos.push(h + ' → ' + ruta);
        }
    }
    if (rotos.length) mal(rotos.length + ' enlace(s) apuntan a ficheros que NO están', rotos.join('\n'));
    else bien(comprobados + ' recursos enlazados desde index.html y live.html existen');
}

// ════════════════════════════════════════════════════════════════════
paso('6/9 · ¿Existe en disco todo lo que el Service Worker precachea?');
// 🔑🔑 LA LECCIÓN DE v452, ESCRITA TRES VECES EN sw.js: `cache.addAll` es
//   ATÓMICO. UNA sola ruta que devuelva 404 tumba la precarga ENTERA y deja la
//   app sin armazón offline — no falla ese fichero, fallan todos. Y el aviso
//   está en un comentario, que es justo lo que no comprueba nada.
{
    const sw = leer('sw.js');
    const ini = sw.indexOf('const ASSETS = [');
    const fin = sw.indexOf('];', ini);
    if (ini === -1 || fin === -1) {
        mal('no se encuentra la lista ASSETS en sw.js — ¿la han renombrado?');
    } else {
        const bloque = sw.slice(ini, fin)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
        const rutas = (bloque.match(/'\.\/[^']*'/g) || [])
            .map((s) => s.slice(1, -1).replace(/^\.\//, ''))
            .filter((r) => r !== '');                        // './' es la raíz, la sirve Hosting
        const rotas = rutas.filter((r) => !existe(r));
        if (!rutas.length) mal('la lista ASSETS de sw.js ha salido VACÍA: esta comprobación no comprueba nada');
        else if (rotas.length) mal(rotas.length + ' ruta(s) del precache NO existen (tumban addAll ENTERO)', rotas.join('\n'));
        else bien(rutas.length + ' rutas del precache del SW existen en disco');
    }
}

// ════════════════════════════════════════════════════════════════════
paso('7/9 · ¿Está el manifiesto de la PWA completo?');
{
    try {
        const man = JSON.parse(leer('manifest.json'));
        const faltan = ['name', 'short_name', 'start_url', 'display', 'icons']
            .filter((k) => !man[k] || (Array.isArray(man[k]) && !man[k].length));
        if (faltan.length) mal('faltan campos obligatorios: ' + faltan.join(', '));
        else bien('campos obligatorios presentes');

        // Un icono que no está deja la PWA sin instalar, y el navegador no
        // dice por qué: sólo desaparece el botón de «Añadir a pantalla».
        const iconos = [].concat(
            (man.icons || []).map((i) => i.src),
            ...(man.shortcuts || []).map((s) => (s.icons || []).map((i) => i.src))
        ).filter(Boolean).map((s) => s.replace(/^\.\//, ''));
        const sinIcono = [...new Set(iconos)].filter((i) => !existe(i));
        if (sinIcono.length) mal('iconos declarados que no existen', sinIcono.join('\n'));
        else bien(new Set(iconos).size + ' iconos del manifiesto existen');

        const arranque = String(man.start_url || '').replace(/^\.\//, '').split('?')[0];
        if (arranque && !existe(arranque)) mal('start_url apunta a un fichero que no existe: ' + arranque);
        else bien('start_url apunta a un fichero real');
    } catch (e) {
        mal('manifest.json ilegible', e.message);
    }
}

// ════════════════════════════════════════════════════════════════════
paso('8/9 · ¿Queda algún marcador sin rellenar en lo que se publica?');
// 🚨🔴 ESTO EXISTE PORQUE PASÓ (2026-09-22). `privacy.html` se desplegó a
//   producción con cuatro `[PENDIENTE]` a la vista: cualquiera que abriera la
//   política leía «Titular: [PENDIENTE — nombre o razón social]». Había un
//   guard que lo avisaba… pero avisar no es cortar, y el aviso sólo se veía
//   ejecutando la batería. Es el mismo error que el `echo TODO`: una
//   advertencia que no bloquea acaba siendo una advertencia que no se lee.
//   Ahora el despliegue no sale.
{
    const marcadores = [/\[PENDIENTE/, /\[TODO\]/, /\[RELLENAR/, /XXXXX/];
    const sucios = [];
    for (const h of HTML_DESPLEGADOS) {
        if (!existe(h)) continue;
        const txt = leer(h);
        for (const m of marcadores) {
            const hit = txt.match(m);
            if (hit) sucios.push(h + ' → ' + hit[0]);
        }
    }
    if (sucios.length) {
        mal(sucios.length + ' marcador(es) sin rellenar en documentos públicos', sucios.join('\n'));
    } else {
        bien('ningún [PENDIENTE] en los ' + HTML_DESPLEGADOS.length + ' HTML que se publican');
    }
}

// ════════════════════════════════════════════════════════════════════
paso('9/9 · ¿Están sincronizados los sellos de versión?');
// 🔑 Subir el CACHE_NAME y OLVIDAR el cache-bust sirve los módulos VIEJOS
//   desde la caché del navegador, sin ningún síntoma: la página se comporta
//   como una versión anterior (v422, v427). Es un paso que había que recordar;
//   ahora corta aquí.
correr([path.join('scripts', 'cache-bust.js'), '--check'],
       'los ?v= y los sellos coinciden con el CACHE_NAME de sw.js');

// ════════════════════════════════════════════════════════════════════
const segs = ((Date.now() - t0) / 1000).toFixed(1);
console.log('\n' + '─'.repeat(70));
if (fallos) {
    console.log(`❌ BUILD FALLIDO — ${fallos} comprobación(es) en rojo  (${segs}s)`);
    console.log('   No se despliega esto. Arregla lo de arriba y vuelve a lanzarlo.');
    process.exit(1);
}
console.log(`✅ BUILD OK — el artefacto está completo y es coherente  (${segs}s)`);
console.log('   (las pruebas van aparte: `npm test`, o las dos con `npm run verify`)');
process.exit(0);
