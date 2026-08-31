// ─────────────────────────────────────────────────────────────────────────
//  test_sin_importar_con_ia.js  ·  v647
//
//  «IMPORTAR CON IA» ha desaparecido de Gestionar Plantilla, y el motivo NO
//  es estetico: es PROTECCION DE DATOS. El boton abria un OCR sobre una FOTO
//  de la lista del equipo —un documento externo con datos personales de
//  menores— y la enviaba FUERA del dispositivo (Gemini Vision a traves de un
//  Worker de Cloudflare). La plantilla se introduce ahora exclusivamente a
//  mano: nombre y alias escritos en la propia pantalla.
//
//  🔑🔑 POR QUE ESTE GUARD MIRA LA CADENA Y NO EL BOTON. Esconder el boton
//  habria dejado el camino VIVO: `triggerRosterPhoto()` es una funcion global
//  en un script clasico, invocable por nombre desde cualquier sitio, y el
//  <input type="file"> seguia en el DOM. Un requisito de RGPD no se cumple
//  haciendo invisible la puerta, se cumple quitandola. Por eso las
//  aserciones exigen AUSENCIA en el codigo, no ausencia en la interfaz.
//
//  ⚠️ LO QUE NO PUEDE LLEVARSE POR DELANTE: js/ai/import.js es un fichero
//  MIXTO. Debajo de la cadena de OCR viven el guardado MANUAL de la plantilla
//  (`saveMasterRoster`, que es justo la alternativa que se conserva), la
//  convocatoria y el paso al partido. La PARTE 3 fija que sigan ahi: un
//  borrado por rangos demasiado largo se las habria llevado y el sintoma
//  seria «guardar plantilla no hace nada».
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 300)); }
};

const IMPORT = leer('js/ai/import.js');
const STAFF  = leer('js/core/staff-and-comms.js');

// Se despoja de comentarios: si no, las propias notas que EXPLICAN el borrado
// («aqui vivia triggerRosterPhoto…») harian pasar las aserciones de ausencia.
// ⚠️ Es la trampa exacta de v525 y la que puso 4e en rojo al escribir v647.
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
                       .replace(/<!--[\s\S]*?-->/g, '');
const I = sinCom(IMPORT), S = sinCom(STAFF);

console.log('\n══ v647 · «Importar con IA», fuera por proteccion de datos ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🚫 La cadena de OCR no existe en el codigo');
{
    const IDAS = ['triggerRosterPhoto', 'processRosterPhoto', 'compressImageToBase64',
                  'callGeminiVision', 'callTesseract', 'parsePlayersFromText',
                  'updateUsageCounter', 'showOCRError', 'showRosterPreview',
                  'confirmRosterImport'];
    const vivas = IDAS.filter(n => I.includes(n) || S.includes(n));
    ok('1a · 🔑🔑 ninguna de las diez funciones sobrevive',
       vivas.length === 0,
       'siguen presentes: ' + vivas.join(', '));

    ok('1b · ⚠️ y tampoco queda el <input type="file"> que las alimentaba',
       !/id="roster-photo-input"/.test(I) && !/id="roster-photo-input"/.test(S),
       'sin boton pero con el input, el camino sigue abierto desde la consola');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔒 Nada sale ya del dispositivo para leer la plantilla');
{
    ok('2a · 🔑 no se llama a ningun motor de vision',
       !/gemini/i.test(I) && !/tesseract/i.test(I),
       'el motivo del borrado es que la foto VIAJABA: si vuelve un motor, vuelve el problema');

    ok('2b · y no queda rotulo de importacion por IA en la pantalla de plantilla',
       !/IMPORTAR CON IA/i.test(S) && !/la IA la importa/i.test(S));

    ok('2c · ⚠️ ni un `capture="environment"` suelto en las dos pantallas',
       !/capture="environment"/.test(I) && !/capture="environment"/.test(S),
       'es lo que abre la CAMARA: su presencia delata un camino de foto vivo');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) ⚠️ Lo que TENIA que sobrevivir al borrado');
{
    // js/ai/import.js es un fichero mixto: el OCR estaba arriba y el resto
    // debajo. Estas cuatro son la prueba de que el corte no se paso de largo.
    ok('3a · 🔑 el guardado MANUAL de la plantilla sigue vivo',
       /function saveMasterRoster\(/.test(I),
       'es la alternativa que se conserva: sin ella no se puede guardar a mano');

    ok('3b · la convocatoria sigue viva',
       /function openConvocationModal\(/.test(I) && /function saveConvPlayers\(/.test(I));

    ok('3c · el paso al partido sigue vivo',
       /function goToTitularSelection\(/.test(I) && /function startMatchWithConvocation\(/.test(I));

    ok('3d · y la pantalla de plantilla sigue ofreciendo GUARDAR',
       /saveMasterRoster\('\$\{mode\}'\)/.test(STAFF),
       'el boton que sustituye al desaparecido tiene que seguir ahi');

    // La otra mitad de la pantalla, que no tiene nada que ver con la IA.
    ok('3e · ⚠️ y ASISTENCIA, que compartia barra con el boton borrado',
       /cronosIrAAsistencia\(\)/.test(STAFF),
       'estaba en el mismo <div>: un borrado un poco largo se la lleva');
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
