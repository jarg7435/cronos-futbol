// ─────────────────────────────────────────────────────────────────────────
// test_guardado_plantilla_honesto.js · v570
//
// EL FALLO (2ª prueba de estrés, implementar.txt 2026-08-17):
//   "he guardado las plantillas, pero ahora aparece otra vez sin guardar tanto
//    en el Benjamín C como en el infantil, como en el regional y en el alevín…
//    es una gran molestia volver a copiar toda la plantilla en cada jornada."
//
// 🔑 LA CADENA COMPLETA:
//   1. `cloudSet` entrega la escritura al SDK y NO espera el ACK — y hace bien:
//      sin cobertura esa promesa no resuelve JAMÁS y colgaría el guardado.
//   2. Pero `saveMasterRoster` mostraba "✅ Plantilla y cuerpo técnico
//      guardados" 300 ms después, SIEMPRE, hubiera llegado o no.
//   3. Y la copia local no salva: la purga por cambio de usuario
//      (_purgeStaleLocalDataIfNeeded), que existe por PRIVACIDAD y debe seguir
//      ahí, la borra en el siguiente inicio de sesión.
//   → La plantilla desaparecía de los dos sitios, y lo último que el entrenador
//     había leído era un tick verde.
//
// 🔑 "Guardado" tiene que significar guardado. Este guard fija que el aviso
// distingue las TRES situaciones reales, y que confirmar NUNCA cuelga.
// ─────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (n, c, extra) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (extra !== undefined) console.log('       ' + extra); }
};
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// ════════════════════════════════════════════════════════════════════
//  ⚠️⚠️ VIGILANTE DE FINAL. LO ENCONTRÓ EL RED-CHECK, NO LA LECTURA.
// ════════════════════════════════════════════════════════════════════
//  La mutación "confirmar SIN tope de tiempo" dejaba a `cronosConfirmaSubida`
//  colgada para siempre. El bucle de eventos de Node se vaciaba, el proceso
//  terminaba ANTES de llegar a la aserción 1d… y salía con código 0. O sea:
//  **el guard daba VERDE con el defecto puesto**, y encima con el defecto más
//  grave de todos, que es justo el que 1d existe para impedir.
//
//  🔑 Un guard asíncrono que no comprueba haber TERMINADO no prueba nada: mide
//  "no hubo rojos", que no es lo mismo que "pasó todo". Este gancho convierte
//  un final prematuro en un fallo ruidoso.
let _guardTerminado = false;
process.on('exit', () => {
    if (!_guardTerminado) {
        console.log('\nFAIL 1d · 🚨 EL GUARD NO LLEGÓ AL FINAL: una confirmación se quedó ' +
                    'colgada (¿se ha quitado el tope de tiempo?).');
        process.exitCode = 1;
    }
});
const STORAGE = leer('js/services/firestore-storage.js');
const IMPORT  = leer('js/ai/import.js');
const AUTH    = leer('js/services/auth.js');

function recorta(src, decl) {
    const i = src.indexOf(decl);
    if (i < 0) return null;
    let prof = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
        if (src[k] === '{') prof++;
        else if (src[k] === '}') { prof--; if (prof === 0) return src.slice(i, k + 1); }
    }
    return null;
}
const sinCom = t => t.split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

console.log('── v570 · el guardado de plantilla dice la verdad ──\n');

// ═══════════════════════════════════════════════════════════════════════════
console.log('── PARTE 1 · cronosConfirmaSubida, comportamiento real ──');
{
    const fnConf = (function () {
        const i = STORAGE.indexOf('window.cronosConfirmaSubida = async function');
        if (i < 0) return null;
        let prof = 0;
        for (let k = STORAGE.indexOf('{', i); k < STORAGE.length; k++) {
            if (STORAGE[k] === '{') prof++;
            else if (STORAGE[k] === '}') { prof--; if (prof === 0) return STORAGE.slice(i, k + 1); }
        }
        return null;
    })();
    ok('1a · existe cronosConfirmaSubida', !!fnConf);

    if (fnConf) {
        const sb = { window: {}, setTimeout, clearTimeout, Promise, console };
        sb.globalThis = sb;
        vm.createContext(sb);
        vm.runInContext(fnConf, sb);
        const confirmar = sb.window.cronosConfirmaSubida;

        (async () => {
            // Subida que llega.
            const r1 = await confirmar({ estado: 'entregada', escritura: Promise.resolve() }, 500);
            ok('1b · 🔑 una escritura confirmada devuelve "ok"', r1 === 'ok', r1);

            // Subida que falla (permisos, por ejemplo).
            const r2 = await confirmar({ estado: 'entregada', escritura: Promise.reject(new Error('permission')) }, 500);
            ok('1c · 🔑 una escritura que FALLA devuelve "solo-local"', r2 === 'solo-local', r2);

            // 🔑🔑 SIN COBERTURA LA PROMESA NO RESUELVE NUNCA. Es el caso que
            // obligó a que cloudSet no la esperase, y el que no puede colgar.
            const t0 = Date.now();
            const r3 = await confirmar({ estado: 'entregada', escritura: new Promise(() => {}) }, 300);
            const tardo = Date.now() - t0;
            ok('1d · 🔑🔑 una promesa que NUNCA resuelve devuelve "pendiente" y no cuelga',
               r3 === 'pendiente' && tardo < 2000, r3 + ' en ' + tardo + ' ms');

            // Sin sesión: no hay asa que esperar.
            const r4 = await confirmar({ estado: 'solo-local' }, 300);
            ok('1e · sin escritura entregada devuelve "solo-local"', r4 === 'solo-local', r4);
            const r5 = await confirmar(null, 300);
            ok('1f · y tolera que no le pasen nada', r5 === 'solo-local', r5);

            parte2();
        })();
    } else { parte2(); }
}

// ═══════════════════════════════════════════════════════════════════════════
function parte2() {
    console.log('\n── PARTE 2 · cloudSet devuelve el asa (sin esperarla) ──');
    const fnSet = recorta(STORAGE, 'async function cloudSet(');
    ok('2a · se recorta cloudSet', !!fnSet);
    if (fnSet) {
        const cod = sinCom(fnSet);
        ok('2b · 🔑 devuelve el asa de la escritura para poder confirmarla',
           /return \{ estado: 'entregada', escritura: escritura \}/.test(cod));
        // ⚠️ LO QUE NO PUEDE VOLVER: esperar el ACK aquí dentro colgaría el
        // guardado sin cobertura. Es la razón por la que existe el asa.
        ok('2c · ⚠️ NO se espera el ACK dentro de cloudSet (colgaría sin red)',
           !/await setDoc\(/.test(cod) && !/await escritura/.test(cod),
           'cloudSet debe entregar la escritura, nunca esperarla');
        ok('2d · el guardado LOCAL sigue siendo lo primero y síncrono',
           cod.indexOf('localStorage.setItem(key, _raw)') < cod.indexOf('setDoc('));
        ok('2e · sin sesión se informa de que sólo hay copia local',
           /return \{ estado: 'solo-local'/.test(cod));
    }

    console.log('\n── PARTE 3 · el aviso de saveMasterRoster ──');
    const fnSave = recorta(IMPORT, 'function saveMasterRoster(');
    ok('3a · se recorta saveMasterRoster', !!fnSave);
    if (fnSave) {
        const cod = sinCom(fnSave);
        ok('3b · 🔑🔑🔑 el aviso YA NO es incondicional: se confirma la subida',
           /cronosConfirmaSubida\(_subida/.test(cod),
           'antes mostraba "guardados" a los 300 ms pasara lo que pasara');
        ok('3c · 🔑 hay TRES mensajes distintos, uno por situación real',
           /_estado === 'ok'/.test(cod) && /_estado === 'pendiente'/.test(cod) &&
           (cod.match(/showToast\(/g) || []).length >= 3,
           'ok / pendiente / sólo-local');
        ok('3d · 🔑 el caso "sólo en este dispositivo" AVISA de que puede perderse',
           /SÓLO en este dispositivo/.test(fnSave) && /antes de cerrar sesión/.test(fnSave),
           'es lo que le pasó al autor: se perdió al cambiar de usuario');
        ok('3e · el caso confirmado lo dice explícitamente',
           /guardados y subidos/.test(fnSave));
        ok('3f · ⚠️ la copia local se escribe SIEMPRE, aunque la nube falle',
           cod.indexOf('roster[mode] = playersData') < cod.indexOf('cronosConfirmaSubida'));
        ok('3g · ⚠️ y el spinner se cierra ANTES de esperar la confirmación',
           cod.indexOf('hideSpinner()') < cod.indexOf('cronosConfirmaSubida'),
           'esperar con el spinner puesto sería otra forma de colgar la interfaz');
    }

    console.log('\n── PARTE 4 · el login ya no culpa a los permisos ──');
    {
        const i = AUTH.indexOf("const _hayOtraSesion");
        const bloque = i < 0 ? '' : AUTH.slice(i, i + 2600);
        ok('4a · 🔑 se detecta si OTRA cuenta ha desplazado a la sesión',
           /_actual\.uid !== user\.uid/.test(bloque) && /!_actual/.test(bloque),
           'la sesión de Firebase es por ORIGEN, no por pestaña');
        ok('4b · 🔑 y el mensaje lo explica en vez de mandar al administrador',
           /OTRA cuenta de Chronos abierta en este navegador/.test(bloque));
        ok('4c · 🔑 menciona que el incógnito TAMBIÉN comparte la sesión',
           /inc[óo]gnito tambi[ée]n la comparten/i.test(bloque),
           'es justo lo que el autor probó creyendo que aislaba');
        ok('4d · ⚠️ ya no queda el "contacta al administrador" de permisos',
           !/Error de permisos\. Se está reintentando/.test(AUTH),
           'ese mensaje mandaba a alguien que no podía hacer nada');
        ok('4e · el mensaje de SIN CONEXIÓN sigue intacto (v529)',
           /Sin conexión\. Tu sesión sigue abierta/.test(AUTH));
    }

    _guardTerminado = true;
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail === 0 ? 0 : 1);
}
