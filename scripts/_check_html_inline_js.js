// Valida con `node --check` el JavaScript EMBEBIDO de un HTML.
// Uso: node scripts/_check_html_inline_js.js <archivo.html> [otro.html ...]
//
// ⚠️⚠️ v751 (Fase 0) · ANTES SOLO MIRABA EL PRIMER <script> DEL FICHERO.
//   El `match()` de una expresion SIN la bandera /g devuelve la primera
//   coincidencia y nada mas. index.html tiene CIENTO TRECE etiquetas <script>,
//   de las cuales cinco llevan codigo dentro; este comprobador validaba UNA
//   —la de la linea 61— y daba OK. O sea que era exactamente la trampa que
//   `_check_syntax.js` ya habia pagado en v596 con su lista a mano de 18
//   ficheros: una cobertura parcial que se anuncia como total.
//
//   Y el codigo embebido es justo donde mas duele. `js/` entero lo cubre
//   `_check_syntax.js`; lo que vive dentro de los HTML no lo miraba nadie, y
//   ahi estan el arranque, la insignia de version y el bloque de App Check de
//   live.html. Un backtick de mas en cualquiera de ellos deja la pagina en
//   blanco sin que `npm run` diga una palabra (v641: 219/219 en verde con el
//   panel del SuperAdmin NEGRO).
//
// 🔑 SE COMPRUEBA CADA BLOQUE POR SEPARADO, no todos concatenados: pegarlos
//   inventaria errores que no existen (dos bloques pueden declarar `const x`
//   cada uno en su ambito) y, peor, podria ESCONDER uno real al compensarse
//   dos llaves descuadradas de bloques distintos.
//
// ⚠️ Los <script type="module"> se comprueban como modulo (extension .mjs) y
//   el resto como guion clasico: un `import` de nivel superior es legal en el
//   primero e ilegal en el segundo, asi que la extension no es un detalle.
//
// ⚠️ La ruta temporal es ASCII a proposito: la del proyecto lleva acentos y
//   eso rompe `node --check` cuando pasa por cmd.exe.
'use strict';

const fs = require('fs');
const cp = require('child_process');
const os = require('os');
const path = require('path');

const ficheros = process.argv.slice(2);
if (!ficheros.length) {
    console.error('Uso: node scripts/_check_html_inline_js.js <archivo.html> [...]');
    process.exit(2);
}

// Sin `src=`: esos no llevan codigo dentro, los cubre _check_syntax.js.
const RE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

// ⚠️ LOS COMENTARIOS HTML SE VACIAN ANTES DE BUSCAR, y no es cosmetico: en
//   index.html:1873 hay un comentario que DICE «el <script> de @emailjs/browser
//   se retiro aqui». La primera version de este comprobador lo tomo por codigo
//   y dio ERR sobre una frase en castellano. Un comprobador que grita donde no
//   hay nada se acaba ignorando, y entonces deja de comprobar tambien donde si.
//   Se sustituye por saltos de linea para que los numeros de linea sigan
//   apuntando al sitio de verdad.
const sinComentarios = (html) =>
    html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ''));

let anyErr = false;
let totalBloques = 0;

for (const file of ficheros) {
    let html;
    try {
        html = sinComentarios(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.log('ERR  ' + file + ' — no se puede leer: ' + e.message);
        anyErr = true;
        continue;
    }

    let m;
    let n = 0;
    RE_SCRIPT.lastIndex = 0;
    while ((m = RE_SCRIPT.exec(html)) !== null) {
        const attrs = m[1] || '';
        const js = m[2] || '';

        if (/\bsrc\s*=/i.test(attrs)) continue;        // lo cubre _check_syntax.js
        if (!js.trim()) continue;                      // <script></script> vacio
        // JSON-LD y demas plantillas no son JavaScript ejecutable.
        if (/\btype\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue;

        n++;
        totalBloques++;
        const esModulo = /\btype\s*=\s*["']module["']/i.test(attrs);
        // Numero de linea del <script> dentro del HTML, para poder ir a el.
        const linea = html.slice(0, m.index).split('\n').length;
        const etiqueta = path.basename(file) + ':' + linea + (esModulo ? ' (module)' : '');

        const tmp = path.join(os.tmpdir(),
            'inline_' + Date.now() + '_' + n + (esModulo ? '.mjs' : '.js'));
        fs.writeFileSync(tmp, js, 'utf8');
        try {
            cp.execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
            console.log('OK   ' + etiqueta + '  (' + js.split('\n').length + ' lineas)');
        } catch (e) {
            anyErr = true;
            const salida = (e.stderr ? e.stderr.toString() : e.message)
                .split('\n').slice(0, 6).join('\n');
            console.log('ERR  ' + etiqueta + '\n' + salida);
        } finally {
            try { fs.unlinkSync(tmp); } catch (_) { /* da igual */ }
        }
    }

    if (n === 0) console.log('--   ' + file + ': sin JavaScript embebido');
}

// 🔑 CERO BLOQUES ES UN FALLO, no un exito. Si un cambio de formato deja la
//   expresion sin casar, este script se volveria un "OK" permanente que no
//   comprueba nada — el verde en falso contra el que existe todo este fichero.
if (totalBloques === 0) {
    console.log('ERR  no se ha encontrado NI UN bloque de JavaScript embebido: ' +
                'el comprobador no esta comprobando nada');
    anyErr = true;
}

process.exit(anyErr ? 1 : 0);
