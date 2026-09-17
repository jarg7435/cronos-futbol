// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v732 · LA PUERTA DEL PARTIDO NO PUEDE REENTRAR EN SÍ MISMA
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-17, capturas 10524-10527, sobre
//  PRODUCCIÓN v731): «la interfaz se congela por completo, ningún botón
//  responde y se bloquea la aplicación entera, obligando a cerrar la pestaña».
//
//  🔴🔴🔴 DEFECTO INTRODUCIDO POR MÍ EN v730, y del peor tipo: no da error, no
//  deja rastro en consola y se lleva por delante la pestaña entera.
//
//      window._cronosSaltarCandadoPartido = true;
//      Promise...then(function (puede) {
//          window._cronosSaltarCandadoPartido = false;   // ← ANTES
//          if (puede) confirmSetup();                    // ← vuelve a entrar
//      });
//
//  La bandera que impedía la reentrada se limpiaba ANTES de la llamada
//  recursiva: la segunda pasada volvía a entrar en el mismo bloque, y la
//  siguiente, y la siguiente. Un **bucle infinito de microtareas** — y las
//  microtareas se drenan enteras antes de devolver el control al bucle de
//  eventos, así que el navegador no vuelve a pintar ni a atender un clic.
//
//  🚨 POR QUÉ ESTE GUARD EJECUTA Y NO MIRA EL TEXTO: un regex que busque
//  `confirmSetup(` dentro de `confirmSetup` habría pasado por alto la variante
//  siguiente (dos funciones que se llaman en círculo) y, sobre todo, no mide
//  lo único que importa: CUÁNTAS VECES se ejecuta el trabajo. Aquí se cuenta.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const SRC  = fs.readFileSync(path.join(RAIZ, 'js/core/setup-modal.js'), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

// ── Se extrae SÓLO la puerta, que es corta y autónoma ──────────────────────
function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}

const PUERTA = trozo(SRC, 'function confirmSetup()');

console.log('\n══ v732 · CONTINUAR AL PARTIDO no puede colgar la pestaña ══');

ok('0a · se encuentra la puerta `confirmSetup`', !!PUERTA);
ok('0b · el trabajo vive en una función aparte, no en la propia puerta',
   /function _confirmSetupAhora\(\)/.test(SRC),
   'partirla en dos es lo que hace imposible la reentrada');

//  ⚠️ EL FRENO NO PUEDE SER UNA EXCEPCIÓN, Y ESTO SE APRENDIÓ AQUÍ MISMO.
//  La primera versión lanzaba un Error al pasar de N llamadas… y el
//  red-check contra el código de v731 **colgó el proceso de pruebas durante
//  dos minutos**: dentro de una promesa, ese Error se convierte en rechazo, el
//  `.catch` del código defectuoso volvía a llamar a la puerta y el bucle
//  seguía. Un guard en rojo tiene que DECIR que falla, no morir con el
//  ordenador echando humo.
//
//  🔑 El freno de verdad es devolver una promesa QUE NUNCA RESUELVE: la cadena
//  se corta en seco, el proceso termina y la marca `bucle` queda puesta para
//  que la aserción lo cuente.
const TOPE = 20;

function montar(opciones) {
    const o = opciones || {};
    const est = { cuerpo: 0, candado: 0, bucle: false };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Promise, Object, Array, String, Number, Boolean, Date, Error,
        _confirmSetupAhora: () => {
            est.cuerpo++;
            if (est.cuerpo > TOPE) est.bucle = true;
        },
    };
    sb.window = sb;
    if (!o.sinCandado) {
        sb.cronosSesionAlAbrirPartido = function () {
            est.candado++;
            if (est.candado > TOPE) {          // freno: corta la cadena sin lanzar
                est.bucle = true;
                return new Promise(function () { /* nunca resuelve, a propósito */ });
            }
            if (o.lanza) return Promise.reject(new Error('sin red'));
            return Promise.resolve(o.puede !== false);
        };
    }
    vm.createContext(sb);
    vm.runInContext(PUERTA + '\n;globalThis.puerta = confirmSetup;', sb);
    est.sb = sb;
    return est;
}
// Deja correr TODAS las microtareas pendientes; si hubiera bucle, el tope de
// arriba corta antes de que este guard se quede colgado.
const respirar = () => new Promise(r => setImmediate(r));

(async function () {
  try {
    {
        const e = montar({ puede: true });
        e.sb.puerta();
        await respirar(); await respirar();
        ok('1a · 🔑🔑 el equipo está libre: el partido se monta UNA sola vez',
           e.cuerpo === 1, 'cuerpo=' + e.cuerpo);
        ok('1b · 🔑 y el candado se pide UNA sola vez',
           e.candado === 1, 'candado=' + e.candado);
        ok('1c · 🔴 SIN BUCLE — la puerta no vuelve a entrar en sí misma',
           e.bucle === false,
           'es el defecto de v730 que congelaba la pestaña entera');
    }
    {
        const e = montar({ puede: false });
        e.sb.puerta();
        await respirar(); await respirar();
        ok('2a · el equipo está ocupado en otro aparato: NO se monta el partido',
           e.cuerpo === 0, 'cuerpo=' + e.cuerpo);
        ok('2b · …y tampoco se insiste en pedirlo', e.candado === 1, 'candado=' + e.candado);
    }
    {
        // Sin red / con el módulo reventando: el candado JAMÁS impide
        // cronometrar un partido (fail-open, la política del módulo de sesión).
        const e = montar({ lanza: true });
        e.sb.puerta();
        await respirar(); await respirar();
        ok('3a · 🚨 si la comprobación falla, se entra igual (fail-open)',
           e.cuerpo === 1, 'cuerpo=' + e.cuerpo);
    }
    {
        // Sin el módulo de sesión cargado (una app vieja servida de caché):
        // la puerta no puede quedarse esperando a nadie.
        const e = montar({ sinCandado: true });
        e.sb.puerta();
        await respirar();
        ok('4a · sin el módulo de sesión, el partido se monta igual',
           e.cuerpo === 1, 'cuerpo=' + e.cuerpo);
    }
    {
        // Dos pulsaciones seguidas del botón: dos partidos, no doscientos.
        const e = montar({ puede: true });
        e.sb.puerta(); e.sb.puerta();
        await respirar(); await respirar();
        ok('5a · dos clics seguidos no se multiplican', e.cuerpo === 2, 'cuerpo=' + e.cuerpo);
    }

    console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
    process.exit(fallos ? 1 : 0);
  } catch (e) {
    console.log('\n  ✗ ' + (e && e.message));
    console.log('     (si dice BUCLE, la puerta volvió a entrar en sí misma: es el defecto de v730)');
    console.log('\n' + (total - fallos) + '/' + (total + 1) + ' aserciones OK');
    process.exit(1);
  }
})();
