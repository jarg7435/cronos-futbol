// ─────────────────────────────────────────────────────────────────────────
//  test_cargando_sin_salida.js  ·  2026-09-01
//
//  «Facturación clavada en Cargando…».
//
//  🔑 EL DEFECTO, Y POR QUE SE REPITE SOLO. Una función pinta «⏳ Cargando…»
//  en un contenedor y luego se va por un `return` temprano —la guarda de «no
//  tengo uid», «no tengo club»— SIN tocar ese contenedor. No hay error, no
//  hay contenido: el cartel provisional se queda como interfaz FINAL y el
//  usuario mira un reloj de arena para siempre.
//
//  Es especialmente traicionero porque el `try/catch` de alrededor NO ayuda:
//  no ha fallado nada, simplemente se salió antes. Y porque las dos funciones
//  hermanas de billing.js se escribieron distinto — `billClubView` sí pinta
//  «No se encontró información del club» al salir, y `billIndividualView` no.
//
//  ⚠️ QUE ESTE GUARD MIRE SOLO billing.js ES DELIBERADO. El patrón existe en
//  más sitios de la aplicación, pero un guard que intente cubrir todos acaba
//  siendo una lista de excepciones que nadie mantiene. Aquí se fija el fichero
//  donde el defecto se manifestó, con el principio escrito para quien lo lea.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'billing.js'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

console.log('\n══ Ningún «Cargando…» se queda como pantalla final ══');

// ════════════════════════════════════════════════════════════════════
//  Se acota cada función que pinta un «Cargando» y se comprueba que
//  TODOS sus `return` posteriores van precedidos de una escritura al
//  contenedor. Se busca el patrón real, no un nombre concreto.
// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🔑 Toda salida temprana deja algo escrito');
{
    // ⚠️ NADA DE TROCEAR POR FUNCIONES NI DE CASAR EL TEMPLATE ENTERO. La
    // primera version hacia las dos cosas y dio un VERDE FALSO: la regex
    // `[`'"][^`'"]*Cargando` se cortaba en la primera comilla del
    // `style="..."` que hay DENTRO del template, no encontraba ninguna
    // funcion, y la asercion de ausencia paso por no tener nada que mirar.
    // 🔑 Por eso 1a existe y va PRIMERO: comprueba que el guard ve algo antes
    // de afirmar que no hay nada malo. Una asercion de ausencia sin una de
    // presencia al lado no vale nada.
    const lineas = CODE.split('\n');
    const marcas = [];
    lineas.forEach((l, i) => { if (/innerHTML[^\n]*Cargando/i.test(l)) marcas.push(i); });

    ok('1a · el guard VE los «Cargando» (si no, 1b seria un verde falso)',
       marcas.length >= 3, 'encontrados: ' + marcas.length);

    // Desde cada «Cargando», se miran las siguientes lineas hasta el final de
    // la funcion (una llave de cierre en la columna 0) buscando `return;` a
    // secas sin una escritura al contenedor cerca.
    const mudas = [];
    marcas.forEach((ini) => {
        for (let k = ini + 1; k < lineas.length; k++) {
            if (/^\}/.test(lineas[k])) break;              // fin de la funcion
            if (!/^\s*(if\s*\([^)]*\)\s*)?return\s*;/.test(lineas[k])) continue;
            const ventana = lineas.slice(Math.max(0, k - 4), k + 1).join('\n');
            if (!/innerHTML/.test(ventana)) mudas.push('linea ' + (k + 1) + ': ' + lineas[k].trim());
        }
    });

    ok('1b · 🔑🔑 ninguna se va por un `return` dejando el «Cargando» puesto',
       mudas.length === 0,
       'salidas mudas: ' + mudas.join(' · ') +
       '  — ese cartel provisional se queda como interfaz FINAL');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🩺 Los dos casos concretos que lo motivaron');
{
    ok('2a · `billIndividualView` avisa cuando no hay uid (antes salía muda)',
       /if \(!uid\) \{[\s\S]{0,300}?innerHTML/.test(CODE),
       'era el «Facturación clavada en Cargando…»');

    ok('2b · y su hermana `billClubView` sigue avisando sin club',
       /if \(!clubId\) \{[\s\S]{0,200}?innerHTML/.test(CODE),
       'esta ya lo hacía bien: es el patrón que había que copiar');
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
