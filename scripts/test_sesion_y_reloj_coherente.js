// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v717 · LA SESIÓN NO SE MUERE EN SILENCIO Y EL RELOJ ES COHERENTE
// ═══════════════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-14, capturas 10419-10423, sobre
//  PRODUCCIÓN v716):
//   1 · «el estado del reloj debe mandar de forma absoluta sobre los botones…
//       evitando los bloqueos falsos de partido detenido»;
//   2 · «al recuperar un partido en curso o gestionarlo con solapamiento de
//       sesiones, el sistema de latidos debe unificarse mediante una única
//       fuente de verdad… para evitar que el reloj entre en bucles, saltos
//       extraños o bloqueos de interfaz»;
//   3 · «los botones de control no pierdan nunca la referencia del partido».
//
//  ✅ LO QUE YA IBA BIEN (y conviene no romper): en la captura 10423, con
//  v716, el crono marca 44:47 de 45:00 y las fichas 00:13 — cuadran—, y el
//  botón dice PAUSAR con el reloj corriendo. Eso lo fija
//  test_reloj_un_solo_dueno.js; aquí se cubre lo que quedaba.
//
//  📏 LAS DOS MEDICIONES DE ESTA RONDA, las dos en las capturas:
//
//   A · LA CONSOLA (10421): «Uncaught Error in snapshot listener:
//       FirebaseError: [code=permission-denied]» a las 22:26:40Z, el MISMO
//       instante en que se le cerró la sesión (10419).
//       🔑 La regla de `cronos_role_sessions` es
//       `allow get: resource.data.uid == uid`, y en el lenguaje de reglas
//       leer un campo de un documento QUE NO EXISTE **LANZA** — y un error
//       equivale a DENY—. Así que en cuanto la marca se BORRA
//       (`cronosSesionLibera`: cambio de plaza, cerrar sesión) cualquier
//       oyente puesto recibe permission-denied en vez de «documento borrado».
//       Y ese `onSnapshot` NO TENÍA CALLBACK DE ERROR: el SDK lo escupía como
//       error no capturado y **el oyente quedaba muerto para siempre**, así
//       que el aparato no volvía a enterarse de que otro le tomaba la plaza.
//       ⚠️ La regla NO se ha tocado: el banco de pruebas de reglas del
//       proyecto (`:test` de la Rules REST API) **no puede representar un
//       documento inexistente** —MEDIDO: `resource == null` y
//       `resource != null` revientan los dos— y una regla que no se puede
//       verificar no se cambia. Se arregla en el cliente, que sí se verifica.
//
//   B · EL RELOJ RECUPERADO (10421): la cabecera decía «2ª PARTE» con
//       `1ª P 10:00`, o sea la primera parte SIN JUGAR, mientras las fichas
//       llevaban 17:04, 13:31, 12:13… Un partido no puede estar en la segunda
//       parte con la primera a cero.
//
//  LO QUE VIGILA:
//   A · el oyente de la plaza tiene callback de error, se vuelve a enganchar
//       mientras la plaza siga siendo nuestra, y no lo intenta para siempre;
//   B · no se escribe una marca SIN uid (una marca que su dueño no puede leer);
//   C · el aparato DESALOJADO se calla: para el reloj y corta la emisión —una
//       sola fuente de verdad, que es lo que pide el autor—;
//   D · el reloj recuperado es coherente: la 1ª parte no puede valer cero en
//       la 2ª parte.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 400));
        fallos++;
    }
}
function trozo(src, desde) {
    const ini = src.indexOf(desde);
    if (ini < 0) return null;
    let i = src.indexOf('{', ini), prof = 0;
    if (i < 0) return null;
    for (; i < src.length; i++) {
        if (src[i] === '{') prof++;
        else if (src[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return src.slice(ini, i);
}
const sinComentarios = (s) => String(s || '').replace(/^\s*\/\/.*$/gm, '');

const LOCK   = leer('js/services/auth/session-lock.js');
const TIMER  = leer('js/match/timer/core.js');
const APPINI = leer('js/core/app-init.js');
const SETUP  = leer('js/core/setup-modal.js');
const REGLAS = leer('firestore.rules');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [A] el oyente de la plaza, EJECUTADO ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fn = trozo(LOCK, 'async function _escucha(clave)');
    ok('1a · se encuentra la escucha de la plaza', !!fn);
    ok('1b · 🔑🔑 [A] el onSnapshot lleva CALLBACK DE ERROR (antes no, y el ' +
       'oyente moría en silencio)',
       !!fn && /onSnapshot\([\s\S]*?,\s*function \(snap\)[\s\S]*?\},\s*function \(err\)/.test(fn),
       'sin el 3er argumento, el SDK lo escupe como «Uncaught Error in snapshot listener»');

    if (fn) {
        // Arnés: un onSnapshot simulado del que se puede disparar el error a
        // mano, y un reloj de reintentos controlado.
        const montar = (opciones) => {
            const o = opciones || {};
            const ctx = {
                console: { warn() { ctx._avisos = (ctx._avisos || 0) + 1; }, log() {} },
                Date, String, Number,
                // ⚠️ `COLECCION` es una var del IIFE del módulo: sin ella, el
                // `f.m.doc(f.db, COLECCION, clave)` lanza un ReferenceError que
                // el propio try/catch de `_escucha` se traga, y el arnés se
                // queda sin enganche sin decir por qué. MEDIDO al primer intento.
                COLECCION: 'cronos_role_sessions',
                _claveActual: o.clave === undefined ? 'K' : o.clave,
                _reintentos: o.reintentos || 0,
                _MAX_REINTENTOS: 3, _REINTENTO_MS: 4000,
                _paraEscucha: null,
                // v730 · `_escucha` lleva ahora un contador de GENERACIÓN para
                // que una apertura adelantada no deje un oyente huérfano sobre
                // la plaza anterior. Vive fuera del trozo que este arnés
                // extrae, así que hay que dárselo: sin él, la función que se
                // está midiendo ni siquiera arranca.
                _generacion: 0,
                _enganches: 0, _pendientes: [],
                _paraLatido: () => {},
                _deviceId: () => 'yo',
                window: {},
            };
            ctx.setTimeout = (fn2) => { ctx._pendientes.push(fn2); return 1; };
            ctx._paraEscuchaFn = () => { ctx._paraEscucha = null; };
            ctx.window.cronosSesionDesalojado = () => { ctx._desalojado = true; };
            // Firestore simulado: guarda los callbacks para poder dispararlos.
            ctx._fs = async () => ({
                m: {
                    doc: () => ({}),
                    onSnapshot: (ref, alRecibir, alFallar) => {
                        ctx._enganches++;
                        ctx._alRecibir = alRecibir;
                        ctx._alFallar  = alFallar;
                        return () => {};
                    },
                },
                db: {},
            });
            vm.createContext(ctx);
            vm.runInContext(fn.replace(/\b_fs\(\)/g, '_fs()') +
                            ';\n;globalThis.escucha = _escucha;', ctx);
            return ctx;
        };

        (async () => {
            const c = montar({});
            await c.escucha('K');
            ok('1c · se engancha una vez', c._enganches === 1 && typeof c._alFallar === 'function');

            // El desalojo normal sigue funcionando.
            c._alRecibir({ exists: () => true, data: () => ({ deviceId: 'otro' }) });
            ok('1d · ⚠️ v699 SIGUE EN PIE: si otro aparato toma la plaza, se desaloja',
               c._desalojado === true);

            // Y ahora el fallo: permission-denied.
            const d = montar({});
            await d.escucha('K');
            d._alFallar({ code: 'permission-denied', message: 'Missing or insufficient permissions' });
            ok('1e · 🔑🔑 [A] al fallar, se suelta la referencia y se PROGRAMA un reintento',
               d._paraEscucha === null && d._pendientes.length === 1,
               'pendientes=' + d._pendientes.length);
            ok('1f · y se avisa (una vez) de que la escucha se cortó', (d._avisos || 0) >= 1);

            // El reintento vuelve a enganchar.
            d._pendientes[0]();
            await new Promise(r => setTimeout(r, 0));
            ok('1g · 🔑 el reintento vuelve a enganchar la escucha', d._enganches === 2,
               'enganches=' + d._enganches);

            // ⚠️ Pero no para siempre.
            const e = montar({ reintentos: 3 });
            await e.escucha('K');
            e._alFallar({ message: 'denied' });
            ok('1h · ⚠️ con el tope alcanzado NO se reintenta (nada de bucles)',
               e._pendientes.length === 0);

            // Y si ya no tenemos la plaza, tampoco.
            const f = montar({});
            await f.escucha('K');
            f._claveActual = 'OTRA';
            f._alFallar({ message: 'denied' });
            ok('1i · 🔑 si la plaza ya no es nuestra, no se reengancha',
               f._pendientes.length === 0);

            // ═══════════════════════════════════════════════════════════════
            console.log('\n── PARTE 2 · [B] una marca sin uid no la lee ni su dueño ──');
            // ═══════════════════════════════════════════════════════════════
            const rec = sinComentarios(trozo(LOCK, 'window.cronosSesionReclama = async function (clave, opciones)'));
            ok('2a · se encuentra la reclamación de plaza', !!rec);
            ok('2b · 🔑 [B] sin uid NO se escribe la marca',
               /if \(!_uid\)/.test(rec) && /return \{ ok: true, sinComprobar: true \}/.test(rec),
               'una marca con uid vacío la deniega su propia regla de lectura');
            ok('2c · 🔑 y el uid tiene respaldo en el usuario de Firebase Auth',
               /currentUser && f\.auth\.currentUser\.uid/.test(rec));
            ok('2d · el ayudante de Firestore expone `auth` para ese respaldo',
               /return \{ m: m, db: fa\.db, auth: fa\.auth \|\| null \}/.test(sinComentarios(LOCK)));
            ok('2e · 📏 la regla que lo exige sigue en firestore.rules',
               /allow get:\s+if isAuth\(\) && resource\.data\.get\('uid', ''\) == request\.auth\.uid;/
                 .test(REGLAS),
               'si la regla cambia, hay que verificarla con el EMULADOR (ver la nota)');

            // ═══════════════════════════════════════════════════════════════
            console.log('\n── PARTE 3 · [C] el desalojado se calla ──');
            // ═══════════════════════════════════════════════════════════════
            const calla = trozo(LOCK, 'function _callaEsteAparato()');
            ok('3a · se encuentra el silenciador del aparato desalojado', !!calla);

            if (calla) {
                const ctx = {
                    console: { warn() {}, log() {} }, Date,
                    isRunning: true, liveIsActive: true, liveSyncTimer: 7,
                    clearInterval: () => { ctx._limpiados = (ctx._limpiados || 0) + 1; },
                    _pintado: 0, _reloj: 0, _pill: null,
                };
                ctx.window = {
                    _cronosParaReloj: () => { ctx._reloj++; },
                    cronosPintaBotonReloj: () => { ctx._pintado++; },
                };
                ctx.updateLiveButton = (v) => { ctx._pill = v; };
                vm.createContext(ctx);
                vm.runInContext(calla + ';\n;globalThis.calla = _callaEsteAparato;', ctx);
                ctx.calla();
                ok('3b · 🔑🔑 [C] para el reloj y lo deja parado',
                   ctx.isRunning === false && ctx._reloj === 1);
                ok('3c · 🔑🔑 [C] corta el latido y apaga la emisión (una sola ' +
                   'fuente de verdad: manda quien tiene la plaza)',
                   ctx.liveSyncTimer === null && ctx.liveIsActive === false &&
                   (ctx._limpiados || 0) === 1);
                ok('3d · repinta el botón, que ya no puede decir PAUSAR', ctx._pintado === 1);
                ok('3e · y apaga el indicador EN VIVO', ctx._pill === false);
            }

            const desal = sinComentarios(trozo(LOCK, 'window.cronosSesionDesalojado = function (info)'));
            ok('3f · 🔑 el desalojo llama al silenciador ANTES de pintar el aviso',
               !!desal && /_callaEsteAparato\(\);/.test(desal) &&
               desal.indexOf('_callaEsteAparato()') < desal.indexOf('document.body.appendChild'));
            ok('3g · ⚠️ y NO manda un último latido (pisaría al aparato que ' +
               'acaba de tomar el control)',
               !!desal && !/pushLiveSnapshot|stopLiveSync/.test(desal));

            // ═══════════════════════════════════════════════════════════════
            console.log('\n── PARTE 4 · [D] el reloj recuperado es coherente ──');
            // ═══════════════════════════════════════════════════════════════
            const coh = trozo(TIMER, 'function cronosCoherenciaDelReloj()');
            ok('4a · se encuentra la comprobación de coherencia', !!coh);

            if (coh) {
                const montarC = (est) => {
                    const ctx = Object.assign({
                        console: { warn() {}, log() {} },
                        matchPhase: '2nd_half', masterTimeH1: 0, masterTimeH2: 0,
                        half1MaxTime: 600, half2MaxTime: 600,
                        updateMasterUI: () => { ctx._pintado = (ctx._pintado || 0) + 1; },
                    }, est || {});
                    vm.createContext(ctx);
                    vm.runInContext(coh + ';\n;globalThis.coh = cronosCoherenciaDelReloj;', ctx);
                    return ctx;
                };

                // El caso de la captura 10421: 2ª parte con la 1ª a cero.
                const mal = montarC({});
                const tocado = mal.coh();
                ok('4b · 🔑🔑 [D] en la 2ª parte con la 1ª a CERO, se completa ' +
                   'con la duración de la parte',
                   tocado === true && mal.masterTimeH1 === 600,
                   'H1=' + mal.masterTimeH1);
                ok('4c · y se repinta la cabecera', (mal._pintado || 0) === 1);

                // ⚠️ Un valor real, aunque sea pequeño, NO se toca.
                const real = montarC({ masterTimeH1: 37 });
                ok('4d · ⚠️ un tiempo REAL no se infla (una parte cortada es un hecho)',
                   real.coh() === false && real.masterTimeH1 === 37);

                // En la 1ª parte no hay nada que completar.
                const primera = montarC({ matchPhase: '1st_half' });
                ok('4e · en la 1ª parte no se toca nada (empezar a cero es lo normal)',
                   primera.coh() === false && primera.masterTimeH1 === 0);

                // En el descanso tampoco: la parte puede acabar de cerrarse.
                const descanso = montarC({ matchPhase: 'break' });
                ok('4f · en el DESCANSO tampoco', descanso.coh() === false);

                // Un partido terminado con la 1ª a cero también se arregla.
                const fin = montarC({ matchPhase: 'finished' });
                ok('4g · 🔑 un partido TERMINADO con la 1ª a cero también se completa',
                   fin.coh() === true && fin.masterTimeH1 === 600);

                // Sin tope conocido no se inventa nada.
                const sinTope = montarC({ half1MaxTime: 0 });
                ok('4h · ⚠️ sin duración conocida NO se inventa un valor',
                   sinTope.coh() === false && sinTope.masterTimeH1 === 0);
            }

            ok('4i · 🔑 los DOS caminos de recuperación la llaman',
               /cronosCoherenciaDelReloj\(\)/.test(sinComentarios(APPINI)) &&
               /cronosCoherenciaDelReloj\(\)/.test(sinComentarios(SETUP)));
            ok('4j · y lo hacen ANTES de decidir si el reloj sigue corriendo',
               sinComentarios(SETUP).indexOf('cronosCoherenciaDelReloj()') <
               sinComentarios(SETUP).indexOf('shouldAutoEndFirstHalf) {'));

            console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
            if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }
        })();
    }
}
