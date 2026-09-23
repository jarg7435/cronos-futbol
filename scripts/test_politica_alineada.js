// ─────────────────────────────────────────────────────────────────────────
//  test_politica_alineada.js  ·  🛡️ Fase 4 (2026-09-22)
//
//  LA POLÍTICA DE PRIVACIDAD Y EL CÓDIGO NO PUEDEN VOLVER A SEPARARSE.
//
//  `privacy.html` está PUBLICADA. Prometía borrado «en 30 días» mientras
//  `deleteUserData` borraba dos cosas, y decía «servidores en la Unión
//  Europea» mientras las funciones corrían en Iowa. **Una política que
//  promete de más es peor que una incompleta**: es la que te deja sin
//  defensa el día que alguien compara.
//
//  🔑 ESTE GUARD ATA LOS DOS LADOS. No comprueba que la política sea
//  «buena» —eso no lo puede decidir un test— sino que **lo que afirma sigue
//  siendo verdad en el código**. Si mañana alguien cambia el trato de una
//  colección en `purga_usuario.js` y no toca el §6.1, esto se pone rojo.
//
//  ⚠️ Lo que este guard NO puede comprobar, y queda en manos del autor:
//  que los datos del responsable estén rellenos (§1) y la decisión jurídica
//  de quién es responsable y quién encargado. Ambas cosas están marcadas en
//  el propio HTML con un comentario 🚨 PENDIENTE.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 400)); }
};

const POL   = leer('privacy.html');
const RETRO = leer('js/match/events/retroactive-modal.js');
const PURGA = require(path.join(ROOT, 'functions', 'purga_usuario.js'));

console.log('\n══ 🛡️ Fase 4 · la política dice lo que el código hace ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🗑️ §6.1 describe la purga REAL');
{
    ok('1a · 🔑 la política ya NO promete borrado a secas: explica los tres tratos',
       /Se eliminan/.test(POL) && /Se anonimizan/.test(POL) && /Se conservan/.test(POL),
       'borrar / seudonimizar / conservar son tres cosas distintas y el interesado tiene que saberlo');

    ok('1b · 🔑🔑 declara lo que se CONSERVA, que antes no decía',
       /auditor/i.test(POL) && /facturaci/i.test(POL),
       'conservar audit_logs y billing_* es legítimo, pero callarlo no');

    // 🔑 Atado al código: si `CONSERVAR` cambia, el §6.1 tiene que cambiar.
    const conservadas = PURGA.CONSERVAR.map((c) => c.col);
    ok('1c · …y esas dos son EXACTAMENTE las que conserva el código',
       conservadas.indexOf('audit_logs') !== -1 &&
       conservadas.some((c) => c.indexOf('billing') === 0),
       conservadas);

    ok('1d · explica que la anonimización deja «Usuario eliminado»',
       POL.indexOf(PURGA.BORRADO_NOMBRE) !== -1,
       'la política tiene que usar la MISMA palabra que escribe el código: ' + PURGA.BORRADO_NOMBRE);

    ok('1e · dice por qué se conserva la solicitud de baja',
       /solicitud de baja/i.test(POL) && /sin datos personales/i.test(POL));

    ok('1f · 🔑 y advierte del límite real: la asistencia va con el JUGADOR',
       /asistencia/i.test(POL) && /jugador/i.test(POL) && /club/i.test(POL),
       'es el límite que `purga_usuario.js` deja anotado a propósito');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🌍 §5 dice la verdad sobre dónde se tratan los datos');
{
    ok('2a · 🔑🔑 nombra `us-central1` y reconoce el tratamiento fuera del EEE',
       /us-central1/.test(POL) && /(fuera del Espacio Econ|Estados Unidos)/.test(POL),
       'decía sólo «servidores en la Unión Europea», que era media verdad');

    ok('2b · sigue diciendo dónde se ALMACENA (eur3, UE)',
       /eur3/.test(POL) && /Uni.n Europea/.test(POL));

    ok('2c · 🔑 ya no afirma que NO hay transferencias internacionales',
       !/No se realizan transferencias internacionales/.test(POL),
       'esa frase era justo la que contradecía a us-central1');

    ok('2d · menciona los demás encargados (reCAPTCHA, mensajería, correo)',
       /reCAPTCHA/i.test(POL) && /SMTP/i.test(POL));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 🧒 §10 describe los datos de menores tal como son');
{
    ok('3a · 🔑 ya no dice «sin ningún dato identificativo adicional»',
       !/sin ning.n dato identificativo adicional/.test(POL),
       'había dorsal, posición, asistencia con motivo e informes de texto libre');

    ok('3b · enumera dorsal y posición',
       /dorsal/i.test(POL) && /posici/i.test(POL));

    // ⚠️ LA REDACCIÓN ANTERIOR ERA FALSA Y CASI SE PUBLICA. Decía «la
    //    plataforma no registra el estado de salud de ningún menor», y existe
    //    un suceso `injury` (player-actions.js:585): un jugador puede marcarse
    //    como lesionado en el partido, igual que una tarjeta. Además el propio
    //    §2.2 ya enumeraba «lesiones ocurridas durante el encuentro» — o sea
    //    que la política se contradecía a sí misma. Ahora se afirma lo que sí
    //    es cierto: no hay DIAGNÓSTICOS ni descripciones.
    ok('3c · 🔑🔑 declara que no se recogen DIAGNÓSTICOS (y no miente sobre la marca de lesión)',
       /no registra diagn/i.test(POL) && /art\.\s*9/i.test(POL) &&
       /marca de lesi/i.test(POL),
       'la decisión deliberada de attendance-store.js, dicha sin pasarse de frenada');

    ok('3c2 · 🔑 y NO afirma que no se registre nada de salud',
       !/no registra el estado de salud/i.test(POL),
       'existe el suceso `injury`: esa frase era falsa y contradecía al §2.2');

    ok('3d · …y reconoce el texto libre del informe como el punto débil',
       /texto libre/i.test(POL) && /rectificaci/i.test(POL),
       'callar el único agujero que queda sería lo mismo que prometer de más');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) ⚠️ El aviso está DONDE SE ESCRIBE');
{
    ok('4a · 🔑🔑 el formulario del comentario avisa de los datos de salud',
       /No anotes datos de salud/.test(RETRO),
       'es el único texto libre que acaba dentro de cronos_player_reports');

    ok('4b · 🔑 el aviso NO está en el `placeholder`',
       !/placeholder="[^"]*datos de salud/.test(RETRO),
       'un placeholder desaparece al teclear la primera letra, justo cuando haría falta');

    ok('4c · y se ve: va en su propio bloque, no escondido en una línea gris',
       /No anotes datos de salud[\s\S]{0,200}informe deportivo sobre menores/.test(RETRO));

    ok('4d · la política dice que la app avisa (y es cierto)',
       /advierte expresamente/i.test(POL));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n5) 🚨 Lo que sigue pendiente, y tiene que seguir VISIBLE');
{
    // No se puede publicar con los datos del responsable sin rellenar. Este
    // guard NO obliga a rellenarlos —no es su decisión— pero sí a que el
    // aviso siga puesto mientras no lo estén.
    const hayHuecos = /\[PENDIENTE/.test(POL);
    const hayAviso  = /PENDIENTE DE COMPLETAR ANTES DE PUBLICAR/.test(POL);
    ok('5a · 🔑 si quedan huecos [PENDIENTE], el aviso sigue en el fichero',
       !hayHuecos || hayAviso,
       'los huecos sin aviso se publican sin que nadie se dé cuenta');

    ok('5b · 🔑 la decisión responsable/encargado sigue marcada como jurídica',
       !hayHuecos || /DECISION\s+JURIDICA|decision juridica/i.test(POL),
       'no es un ajuste de texto: cambia quién responde ante la AEPD');

    if (hayHuecos) {
        console.log('      ⚠️ AVISO: privacy.html tiene huecos [PENDIENTE] sin rellenar.');
        console.log('         No la despliegues hasta completarlos (sección 1).');
    }
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
