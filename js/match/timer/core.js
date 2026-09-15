// ══════════════════════════════════════════════════════════════════
// CHRONOS FÚTBOL — MATCH/TIMER/CORE
// toggleGame, tick, updateMasterUI, editTimer, spinners, toasts
// Extraído de app.js (líneas 4509-4674)
// ══════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════
//  ⏱️⏱️ v638 · EL RELOJ NO SE SINCRONIZABA ENTRE DISPOSITIVOS
//
//  Reportado tras las pruebas de campo (implementar.txt 2026-08-27, punto 2),
//  con el mismo partido abierto en el PC y en dos tablets:
//    · F7 Alevín C  — "pausar y reanudar no responde en la tablet".
//    · F11 Juvenil  — "tras pausar, ~1 minuto de desfase entre PC y tablet".
//
//  Son DOS síntomas de TRES defectos, y los tres estaban aquí:
//
//  🔴 1 · LAS UNIDADES. `_maxDriftAllowed` valía 1500 y el comentario decía
//     "si la diferencia es > 1.5s": está escrito en MILISEGUNDOS. Pero
//     `masterTimeH1` y `serverData.timeH1` van en SEGUNDOS —`masterTimeH1 +=
//     clampedDeltaSec` aquí, y `timeH1: masterTimeH1` en live/sync.js:890—,
//     así que la resta también. O sea que la corrección sólo saltaba a partir
//     de 1500 SEGUNDOS = 25 MINUTOS. En un partido de fútbol eso no ocurre
//     jamás: **la corrección de desfase no ha funcionado nunca**. El minuto
//     que él midió cae muy por debajo del umbral.
//
//  🔴 2 · SÓLO SINCRONIZABA MIENTRAS CORRÍA. La llamada vivía DENTRO de
//     `tick()`, y `tick` sólo se ejecuta con el `setInterval` que arranca al
//     dar a PAUSAR/REANUDAR. Con el reloj parado no se sincronizaba nada —
//     y él dice, literalmente, "TRAS PAUSAR el cronómetro se generó el
//     desfase". Justo el momento en que el mecanismo se apagaba.
//
//  🔴 3 · NO SE MIRABA `isRunning`. El snapshot lo lleva desde siempre
//     (live/sync.js:889) pero aquí no lo leía nadie: cada aparato decidía por
//     su cuenta si el reloj corre. Con el PC en marcha y la tablet parada, dar
//     a PAUSAR en la tablet sólo cambiaba SU bandera —y como estaba al revés,
//     arrancaba en vez de parar—: "el botón no responde".
//
//  🔑 QUIÉN MANDA: el documento de `live_matches`. No hay un aparato dueño ni
//  hace falta: todos escriben ahí y todos adoptan de ahí, así que convergen.
//  Dos pulsaciones a la vez las resuelve el último que escribe, que es lo
//  mismo que ya pasaba con el marcador.
// ══════════════════════════════════════════════════════════════════

let _lastServerSync = 0;
const _SERVER_SYNC_INTERVAL_MS = 5000;  // Sincronizar cada 5 segundos
// ⚠️ EN SEGUNDOS, como los dos valores que compara. Ver el punto 1 de arriba:
//    escrito en milisegundos, el umbral eran 25 minutos y no corregía nunca.
//    Dos segundos es el margen: por debajo, la diferencia es el propio latido.
let _maxDriftAllowed = 2;
// Vigía del reloj: corre SIEMPRE que haya partido en vivo, en marcha o en
// pausa. Es la mitad que faltaba del punto 2.
let _vigiaReloj = null;

function _arrancarVigiaReloj() {
    if (_vigiaReloj) return;
    _vigiaReloj = setInterval(() => {
        if (typeof liveIsActive === 'undefined' || !liveIsActive || !liveMatchId) {
            clearInterval(_vigiaReloj);
            _vigiaReloj = null;
            return;
        }
        syncTimerWithServer();
    }, _SERVER_SYNC_INTERVAL_MS);
}

// Adopta el estado del servidor SIN volver a escribirlo: `toggleGame()` haría
// un push y dos aparatos podrían quedarse rebotándose la pausa el uno al otro.
//
// ══════════════════════════════════════════════════════════════════
//  🔴 v714 · NO SE ADOPTA LA MARCHA DE UN DOCUMENTO QUE NO PODEMOS ESCRIBIR
// ══════════════════════════════════════════════════════════════════
//  Esto es la otra mitad de «los botones de inicio/reanudación se quedan
//  bloqueados» (captura 10409). El mecanismo de v638 es correcto —manda el
//  documento de `live_matches`, y así convergen los aparatos— pero da por
//  supuesto que NUESTROS latidos llegan. Cuando no llegan (reglas, red, o el
//  partido nunca se creó: MEDIDO, ver sync.js v714), el documento se queda con
//  el `isRunning: false` de antes de la pulsación y este adoptador **le
//  devuelve la pausa al entrenador cada 5 segundos**. Desde fuera es
//  exactísimamente «le doy a REANUDAR y no responde».
//
//  🔑 DOS PUERTAS, las dos necesarias:
//   · LA PULSACIÓN MANDA durante unos segundos. El usuario acaba de decidir;
//     el servidor todavía no puede saberlo.
//   · Y si nuestro último latido BUENO es anterior a esa pulsación, el
//     documento es un espejo DESFASADO: no tiene autoridad para pausarnos.
//  Con las dos, dos tablets sincronizadas siguen convergiendo (sus latidos
//  llegan), y un panel incomunicado deja de pelearse con su propio dueño.
const _GRACIA_PULSACION_MS = 8000;
function _mandaLaPulsacionLocal() {
    const t = window._cronosUltimoToggleLocal || 0;
    if (!t) return false;
    if (Date.now() - t < _GRACIA_PULSACION_MS) return true;
    // Nuestras escrituras no están llegando: el servidor no se ha enterado de
    // la pulsación y nunca lo hará.
    return (window._cronosUltimoLatidoOk || 0) < t;
}
function _adoptarMarchaDelServidor(servidorCorre) {
    if (typeof servidorCorre !== 'boolean' || servidorCorre === isRunning) return;
    if (_mandaLaPulsacionLocal()) {
        if (window._CRONOS_DEBUG) {
            console.warn('[v714] No se adopta la marcha del servidor: manda la pulsación local ' +
                         '(último latido bueno: ' + (window._cronosUltimoLatidoOk || 'ninguno') + ').');
        }
        return;
    }
    isRunning = servidorCorre;
    // 🔴 v716 · Mismo orden y mismas puertas que `toggleGame`: el botón sale
    // del estado y se pinta ANTES de mover el reloj.
    cronosPintaBotonReloj();
    if (isRunning) _cronosArrancaReloj();
    else           _cronosParaReloj();
    if (window._CRONOS_DEBUG) {
        console.warn('[Chronos] Reloj adoptado del servidor: ' + (isRunning ? 'EN MARCHA' : 'EN PAUSA'));
    }
}

// ══════════════════════════════════════════════════════════════════
//  🔴🔴🔴 v716 · EL RELOJ TENÍA VARIOS DUEÑOS Y NINGUNO MANDABA
// ══════════════════════════════════════════════════════════════════
//  Reporte del autor (implementar.txt 2026-09-14, IMG_0583/0584, iPad, v715):
//    · «el cronómetro sufre un comportamiento errático en bucle (retrocediendo
//      de dos en dos o desincronizándose)»;
//    · «el reloj puede estar corriendo en la interfaz táctica pero el sistema
//      detecta falsamente que está detenido»;
//    · «la aplicación impide registrar goles… arrojando el aviso de que el
//      cronómetro está detenido».
//
//  📏 LO QUE SE VE EN LAS DOS CAPTURAS, y es la medición que lo explica todo:
//  el crono de la cabecera va por 04:42 de 05:00 —o sea 18 s jugados— y las
//  fichas de los jugadores marcan 02:02. Entre las dos capturas el maestro
//  avanza 2 s y los jugadores 27 s. Los dos números los suma LA MISMA línea de
//  `tick()` con el mismo delta, así que no pueden separarse... salvo que algo
//  esté reescribiendo el maestro por detrás. Y el botón dice EMPEZAR: o sea
//  `isRunning === false` MIENTRAS EL RELOJ CORRE.
//
//  🔑🔑 LA CAUSA: `tick()` NO MIRABA `isRunning`. Lo único que lo paraba era
//  apagar su `setInterval`, y ese intervalo tenía CUATRO creadores
//  (`toggleGame`, la adopción del servidor, el retomar del arranque y el
//  `visibilitychange`) de los cuales **`toggleGame` no limpiaba el anterior**.
//  Dos creaciones seguidas = dos intervalos vivos y una sola variable para
//  guardarlos: al pausar se apaga el último y **el otro sigue latiendo con el
//  partido en pausa**. Desde ahí, en cascada:
//    · el latido en vivo sólo emite `if (liveIsActive && isRunning)`, así que
//      con `isRunning` en false el documento se queda con el tiempo viejo;
//    · el vigía de v638 sigue leyendo ese documento y CORRIGE LA DERIVA, o sea
//      tira del maestro hacia atrás cada 5 s (el «de dos en dos»: el umbral es
//      de 2 s) mientras las fichas siguen subiendo por el intervalo huérfano;
//    · y los goles se bloquean con razón —`isRunning` es false— pero es un
//      bloqueo FALSO, porque el partido está en marcha.
//
//  🔑 LO QUE SE ARREGLA, y por qué en este orden:
//   1. `tick()` respeta el estado: sin `isRunning` no suma. Un huérfano deja
//      de poder mover el reloj aunque exista.
//   2. UN SOLO INTERVALO CON DUEÑO (`_cronosArrancaReloj`/`_cronosParaReloj`):
//      siempre se apaga el anterior antes de encender. Ya no hay huérfanos.
//   3. EL BOTÓN SE PINTA DEL ESTADO (`cronosPintaBotonReloj`), en vez de a
//      mano en los ocho sitios que lo tocaban. Es lo que pide el autor:
//      «estrictamente unificado y sincronizado con el estado real».
//   4. Y LA CORRECCIÓN DE DERIVA NO PUEDE TIRAR DEL RELOJ HACIA ATRÁS con
//      nuestro propio eco viejo (ver `syncTimerWithServer`).
// ══════════════════════════════════════════════════════════════════
function _cronosArrancaReloj() {
    // ⚠️ APAGAR ANTES DE ENCENDER, SIEMPRE. Es la línea que faltaba en
    // `toggleGame` y la que fabricaba el intervalo huérfano.
    clearInterval(timerInterval);
    lastTickTime = Date.now();          // sin esto el primer tick suma el hueco
    timerInterval = setInterval(tick, 1000);
    return timerInterval;
}
function _cronosParaReloj() {
    clearInterval(timerInterval);
    timerInterval = null;
}
// El botón dice lo que el reloj ES, no lo que creyó el último que lo tocó.
//   · fase terminada      → P. FINALIZADO
//   · en marcha           → PAUSAR
//   · parado sin empezar  → EMPEZAR   (nada jugado todavía)
//   · parado y empezado   → REANUDAR
function cronosPintaBotonReloj() {
    const btn = document.getElementById('btn-play-pause');
    if (!btn) return '';
    const fase = (typeof matchPhase !== 'undefined') ? matchPhase : '';
    const h1 = (typeof masterTimeH1 !== 'undefined' && masterTimeH1) || 0;
    const h2 = (typeof masterTimeH2 !== 'undefined' && masterTimeH2) || 0;
    const corre = (typeof isRunning !== 'undefined') && isRunning === true;
    // 🔑 «EMPEZAR» vs «REANUDAR» es «¿ha empezado el partido?», y eso NO se
    // puede deducir del reloj a cero: al arrancar la app la fase ya es
    // '1st_half' con el crono a 0, y si el entrenador pausa en el segundo 2 el
    // partido SÍ ha empezado. Las señales, en orden de fiabilidad: tiempo
    // jugado, fase posterior a la primera parte, y que el usuario haya pulsado
    // ya en este partido (`_cronosUltimoToggleLocal`, v714 — `resetMatch` lo
    // borra, porque un partido reiniciado vuelve a estar sin empezar).
    const empezado = h1 > 0 || h2 > 0 || fase === '2nd_half' || fase === 'break' ||
                     !!(typeof window !== 'undefined' && window._cronosUltimoToggleLocal);
    let txt;
    if (fase === 'finished')  txt = 'P. FINALIZADO';
    else if (corre)           txt = 'PAUSAR';
    else if (empezado)        txt = 'REANUDAR';
    else                      txt = 'EMPEZAR';
    btn.textContent = txt;
    if (txt === 'PAUSAR') btn.classList.add('danger');
    else                  btn.classList.remove('danger');
    return txt;
}
// ¿Se pueden registrar goles, tarjetas o lesiones AHORA? Una sola respuesta
// para los tres sitios que preguntaban por su cuenta (`!isRunning`): con el
// reloj y el botón ya sincronizados, esto deja de dar falsos bloqueos.
// ══════════════════════════════════════════════════════════════════
//  🔴🔴 v719 · UN PARTIDO NUEVO ARRANCA CON EL RELOJ EN CERO DE VERDAD
// ══════════════════════════════════════════════════════════════════
//  📏 MEDIDO en la captura 10429 (producción v718): partido recién creado,
//  todas las fichas a 00:00 y las dos partes a 05:00 (o sea nada jugado)… y el
//  botón decía **REANUDAR**, no EMPEZAR.
//
//  🔑 EL CAMINO DEL PARTIDO NUEVO NO REINICIA NADA DEL RELOJ: ni `isRunning`,
//  ni la fase, ni los cronómetros, ni la marca de «ya se pulsó» que decide
//  entre EMPEZAR y REANUDAR (`_cronosUltimoToggleLocal`, v714). Sólo
//  `resetMatch` lo hacía. Así que el segundo partido de una sesión heredaba el
//  estado del primero:
//    · el botón decía REANUDAR en un partido sin empezar, y
//    · si `isRunning` se quedó en `true` —volver al panel con
//      `goBackToSetup` NO lo baja, a propósito, por el modo autónomo— la
//      PRIMERA pulsación lo ponía en false: el reloj no arrancaba.
//
//  ⚠️ NO TOCA `liveMatchId` NI NADA DE LA TRANSMISIÓN: de eso se encarga
//  `startLiveSync` (y `resetMatch`, v714). Aquí sólo se pone el RELOJ a cero,
//  que es lo que el partido nuevo da por supuesto.
function cronosRelojNuevoPartido() {
    if (typeof window._cronosParaReloj === 'function') window._cronosParaReloj();
    if (typeof isRunning    !== 'undefined') isRunning = false;
    if (typeof masterTimeH1 !== 'undefined') masterTimeH1 = 0;
    if (typeof masterTimeH2 !== 'undefined') masterTimeH2 = 0;
    if (typeof lastTickTime !== 'undefined') lastTickTime = 0;
    if (typeof matchPhase   !== 'undefined') matchPhase = '1st_half';
    // La marca de «ya se pulsó en este partido»: sin borrarla, el botón de un
    // partido nuevo sigue diciendo REANUDAR (ver `cronosPintaBotonReloj`).
    window._cronosUltimoToggleLocal = 0;
    if (typeof cronosPintaBotonReloj === 'function') cronosPintaBotonReloj();
    if (typeof updateMasterUI === 'function') { try { updateMasterUI(); } catch (e) {} }
}

// ══════════════════════════════════════════════════════════════════
//  🔴 v717 · NO SE PUEDE ESTAR EN LA 2ª PARTE CON LA 1ª A CERO
// ══════════════════════════════════════════════════════════════════
//  📏 MEDIDO en la captura 10421 (producción v716): la cabecera decía
//  «2ª PARTE» con `1ª P 10:00` —o sea la primera parte SIN JUGAR, cero
//  segundos— mientras las fichas de los jugadores llevaban 17:04, 13:31,
//  12:13… Un partido no puede estar en la segunda parte con la primera a
//  cero: la primera, por definición, ya se jugó entera. Ese hueco es lo que
//  hace que el reloj total, el tiempo de los jugadores y el informe cuenten
//  tres historias distintas, y es el «salto extraño» del reporte.
//
//  🔑 De dónde sale el hueco: al retomar un partido conviven DOS copias (la
//  del dispositivo y la de la nube, ver el panel de «Recuperar Partido»), y si
//  la que gana no trae `timeH1` —o trae 0 porque se guardó antes de arrancar—
//  la fase sí se restaura pero el cronómetro de la primera parte no.
//
//  ⚠️ SE RELLENA CON EL TOPE DE LA PARTE, no con la suma de las fichas: el
//  tope es un dato del PARTIDO (la duración pactada), mientras que el tiempo
//  de un jugador depende de cuánto jugó él. Y sólo se toca si está a CERO:
//  un valor pequeño pero real (una parte cortada a propósito) es un hecho y
//  no se inventa nada encima.
function cronosCoherenciaDelReloj() {
    if (typeof matchPhase === 'undefined') return false;
    const enSegunda = (matchPhase === '2nd_half' || matchPhase === 'finished');
    if (!enSegunda) return false;
    if (typeof masterTimeH1 === 'undefined' || masterTimeH1 > 0) return false;
    const tope = (typeof half1MaxTime !== 'undefined' && half1MaxTime > 0) ? half1MaxTime : 0;
    if (!tope) return false;
    masterTimeH1 = tope;
    console.warn('[v717] La 1ª parte estaba a CERO en la ' +
                 (matchPhase === 'finished' ? 'fase final' : '2ª parte') +
                 ': se completa con su duración (' + tope + 's).');
    if (typeof updateMasterUI === 'function') { try { updateMasterUI(); } catch (e) {} }
    return true;
}

function cronosPartidoEnJuego() {
    if (typeof matchPhase !== 'undefined' && matchPhase === 'finished') return false;
    return (typeof isRunning !== 'undefined') && isRunning === true;
}
if (typeof window !== 'undefined') {
    window._cronosArrancaReloj    = _cronosArrancaReloj;
    window._cronosParaReloj       = _cronosParaReloj;
    window.cronosPintaBotonReloj  = cronosPintaBotonReloj;
    window.cronosPartidoEnJuego   = cronosPartidoEnJuego;
    window.cronosCoherenciaDelReloj = cronosCoherenciaDelReloj;
    window.cronosRelojNuevoPartido  = cronosRelojNuevoPartido;
}

function toggleGame() {
    isRunning = !isRunning;
    // 🔴 v714 · SELLO DE LA PULSACIÓN. Es lo que impide que un documento
    // desfasado —o inexistente— le devuelva la pausa al entrenador cinco
    // segundos después de arrancar. Ver `_mandaLaPulsacionLocal`.
    window._cronosUltimoToggleLocal = Date.now();
    // 🔴 v716 · EL BOTÓN PRIMERO, EL RELOJ DESPUÉS. El botón se pinta DEL
    // ESTADO (`cronosPintaBotonReloj`) en vez de a mano, y va DELANTE a
    // propósito: si la programación del intervalo fallara, el botón ya dice la
    // verdad de lo que el usuario acaba de decidir en vez de quedarse
    // mintiendo. Y el reloj entra por la puerta única, que apaga antes de
    // encender — aquí faltaba, y de ahí salía el intervalo huérfano.
    cronosPintaBotonReloj();
    if (isRunning) _cronosArrancaReloj();
    else           _cronosParaReloj();
    // Push inmediato → live.html recibe pausa/reanuda en <1s
    // 📡 v718 · Y SE COMPRUEBA QUE HA LLEGADO. Pausar y reanudar no son un
    // latido más: si ese envío se pierde, el espectador se queda con el reloj
    // corriendo (live.html cuenta solo desde `phaseStartedAt`). El emisor de
    // sync.js reintenta una vez; si tampoco, lo corrige el latido de pausa.
    if (liveIsActive) {
        if (typeof window.cronosEmiteEstadoAhora === 'function') {
            window.cronosEmiteEstadoAhora('active').catch(() => {});
        } else {
            pushLiveSnapshot('active').catch(() => {});
        }
    }
    // ⏱️ v638 · y el vigía queda en pie tanto al pausar como al reanudar: es lo
    //    que permite que un aparato en PAUSA siga enterándose de lo que hacen
    //    los demás.
    if (liveIsActive) _arrancarVigiaReloj();
}

function tick() {
    // 🔴🔴 v716 · SIN RELOJ EN MARCHA, NO SE SUMA NADA. Era la puerta que
    // faltaba: hasta aquí, lo único que paraba el tiempo era apagar el
    // `setInterval`, así que un intervalo huérfano —uno de los cuatro
    // creadores dejaba el anterior vivo— seguía sumando minutos a las fichas
    // CON EL PARTIDO EN PAUSA. Eso es lo que hacía que el sistema «detectara
    // falsamente que está detenido»: no se equivocaba el estado, se equivocaba
    // el reloj. Ver la nota larga sobre `toggleGame`.
    if (typeof isRunning === 'undefined' || !isRunning) return;
    const now = Date.now();
    // FIX: Si lastTickTime es 0 (reset mal hecho), el delta sería ~1.7 billones de ms,
    // causando que el timer se congele al intentar sumar miles de segundos de golpe.
    if (!lastTickTime || lastTickTime === 0) {
        lastTickTime = now;
    }
    const deltaMs = now - lastTickTime;
    const deltaSec = Math.floor(deltaMs / 1000);
    // FIX: Limitar deltaSec máximo a 2 segundos para evitar saltos grotescos
    // (ej: tab en segundo plano, o lastTickTime corrupto)
    const clampedDeltaSec = Math.min(deltaSec, 2);
    if (clampedDeltaSec >= 1) {
        lastTickTime += clampedDeltaSec * 1000;

        // Límite de añadido por modalidad: F11=15 min, F7=10 min
        const maxAddedSecs = (typeof currentMode !== 'undefined' && currentMode === 'f11') ? 900 : 600;
        let shouldAutoEnd1 = false;
        let shouldAutoEnd2 = false;

        if (matchPhase === '1st_half') {
            masterTimeH1 += clampedDeltaSec;
            if (masterTimeH1 >= (half1MaxTime + maxAddedSecs)) {
                masterTimeH1 = half1MaxTime + maxAddedSecs;
                shouldAutoEnd1 = true;
            }
        } else if (matchPhase === '2nd_half') {
            masterTimeH2 += clampedDeltaSec;
            if (masterTimeH2 >= (half2MaxTime + maxAddedSecs)) {
                masterTimeH2 = half2MaxTime + maxAddedSecs;
                shouldAutoEnd2 = true;
            }
        }

        // ══════════════════════════════════════════════════════════════
        //  🔴🔴 v714 · NADA DE LO QUE VIENE DEBAJO PUEDE CONGELAR EL RELOJ
        // ══════════════════════════════════════════════════════════════
        //  Reporte del autor (implementar.txt 2026-09-14, captura 10409): «el
        //  cronómetro y los botones de inicio/reanudación se quedan
        //  completamente congelados y bloqueados».
        //
        //  🔑 ESTE `tick` ES UNA SOLA ESCALERA SIN PASAMANOS, y corre dentro de
        //  un `setInterval`: si CUALQUIERA de sus pasos lanza —el optimizador de
        //  pintado, la ficha de un jugador, el semáforo, el envío— la excepción
        //  escapa del callback y se pierde TODO lo que venía detrás. Los
        //  segundos ya se habían sumado arriba, así que el partido sigue
        //  corriendo por dentro mientras **la pantalla se queda clavada** y las
        //  comprobaciones de fin de parte (el final del bloque) no se evalúan
        //  nunca. Eso es exactamente «congelado»: el reloj no se para, deja de
        //  pintarse.
        //
        //  ⚠️ Y NO SE ARREGLA CON UN `try` GRANDE ALREDEDOR DE TODO: eso
        //  convertiría el fallo de una ficha en la pérdida del auto-fin de la
        //  parte. Cada paso lleva el suyo, en orden de importancia, y el reloj
        //  y el fin de parte quedan por encima del pintado.
        const _paso = (etiqueta, fn) => {
            try { fn(); }
            catch (e) {
                // Una sola línea por causa: repetida cada segundo, un aviso por
                // tick llenaría la consola y taparía lo demás.
                if (window._cronosTickFallo !== etiqueta + '|' + e.message) {
                    window._cronosTickFallo = etiqueta + '|' + e.message;
                    console.warn('[v714] Fallo en el tick (' + etiqueta + '), el reloj sigue:', e.message);
                }
            }
        };

        // ⚡ SOLUCIÓN #2: Usar RenderOptimizer para batching de updates
        _paso('crono', () => {
            if (window.renderOptimizer) {
                window.renderOptimizer.scheduleRender(updateMasterUI, 'high');
            } else {
                updateMasterUI();
            }
        });

        // Actualizar timers de jugadores con render optimization.
        // ⚠️ El tiempo del jugador se suma FUERA del pintado: es un dato del
        // partido, no un adorno, y una ficha que no se puede pintar no puede
        // costarle sus minutos al jugador.
        players.forEach(p => {
            if (p.status === 'field') {
                p.time += clampedDeltaSec;
                _paso('ficha', () => {
                    if (window.renderOptimizer) {
                        window.renderOptimizer.scheduleRender(() => updatePlayerUI(p), 'normal');
                    } else {
                        updatePlayerUI(p);
                    }
                });
            }
        });

        // Sincronización con el servidor. ⚠️ v638 · ESTO YA NO ES LA ÚNICA VÍA:
        // el vigía de arriba la mantiene viva también EN PAUSA, que es cuando
        // se producía el desfase. Se conserva aquí porque el tick es más
        // frecuente y acorta la ventana mientras el reloj corre.
        if (now - _lastServerSync > _SERVER_SYNC_INTERVAL_MS) {
            _lastServerSync = now;
            _paso('sync', () => {
                syncTimerWithServer();  // Llamada asíncrona (no esperar)
                if (liveIsActive) _arrancarVigiaReloj();
            });
        }

        // El fin de parte va al final pero NO puede depender de que el pintado
        // haya ido bien: con el `_paso` de arriba, aquí se llega siempre.
        if (shouldAutoEnd1) {
            if (typeof window.endFirstHalf === 'function') window.endFirstHalf(true);
        } else if (shouldAutoEnd2) {
            if (typeof window.endMatch === 'function') window.endMatch(true);
        }
    }
}

// ── SOLUCIÓN #1: Función para sincronizar timer con servidor
async function syncTimerWithServer() {
    const fa = window._cronos_auth;
    if (!fa || !fa.db || !liveMatchId) return;

    try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const snap = await getDoc(doc(fa.db, 'live_matches', liveMatchId));
        
        if (!snap.exists()) return;

        const serverData = snap.data();

        // ══════════════════════════════════════════════════════════════
        //  🔴 v721 · UN DOCUMENTO DE OTRA FASE NO MANDA SOBRE EL RELOJ
        // ══════════════════════════════════════════════════════════════
        //  Reporte del autor (implementar.txt 2026-09-15, Regional B): «el botón
        //  de reanudar la segunda parte no responde… dejando el partido congelado
        //  en el descanso». En Firestore quedó «2ª PARTE» con la 2ª a cero y el
        //  reloj parado.
        //
        //  🔑 LA MARCHA Y LOS SEGUNDOS SÓLO SIGNIFICAN ALGO DENTRO DE SU FASE, y
        //  aquí se adoptaban sin mirarla. Un documento que todavía dice «1ª
        //  parte» —la lectura salió antes de pulsar el 🏁 y volvió después— le
        //  devolvía `isRunning: true` al DESCANSO; uno que todavía dice
        //  «descanso» —porque la escritura del arranque no ha llegado— le
        //  quitaba la marcha a la 2ª parte recién empezada, y en pausa hasta le
        //  ponía su `timeH2` a cero. El documento no está equivocado: está
        //  describiendo OTRO momento del partido, y ese momento ya pasó aquí.
        //  ⚠️ Sin `phase` en el documento (partidos anteriores) se sigue como
        //  siempre: no se puede saber de qué momento habla.
        if (serverData.phase && typeof matchPhase !== 'undefined' &&
            serverData.phase !== matchPhase) {
            if (window._CRONOS_DEBUG) {
                console.warn('[v721] No se adopta el reloj del servidor: habla de la fase «' +
                             serverData.phase + '» y aquí estamos en «' + matchPhase + '».');
            }
            return;
        }

        // ⏱️ v638 · LA MARCHA, ANTES QUE EL TIEMPO. Si el servidor dice que el
        //    reloj está parado y aquí sigue corriendo (o al revés), corregir
        //    sólo los segundos no arregla nada: al segundo siguiente vuelven a
        //    separarse. Y es lo que hacía que PAUSAR "no respondiera" en la
        //    tablet, que iba con la bandera al revés que el PC.
        _adoptarMarchaDelServidor(serverData.isRunning);

        // ⚠️ La diferencia va en SEGUNDOS, igual que los dos operandos. Ver la
        //    nota de la cabecera: comparar esto contra 1500 era exigir 25
        //    minutos de desfase para mover un dedo.
        const diffH1 = Math.abs((serverData.timeH1 || 0) - masterTimeH1);
        const diffH2 = Math.abs((serverData.timeH2 || 0) - masterTimeH2);
        
        // ══════════════════════════════════════════════════════════════
        //  🔴 v716 · EL RELOJ NO RETROCEDE POR NUESTRO PROPIO ECO
        // ══════════════════════════════════════════════════════════════
        //  El defecto del bucle: mientras ESTE aparato es el que escribe, el
        //  documento es una foto de hace hasta 5 s, así que su `timeH1` va por
        //  DETRÁS del nuestro por pura latencia. Adoptarlo tira del reloj hacia
        //  atrás; al segundo siguiente el tick vuelve a sumar, y cinco segundos
        //  después otra vez: el reloj oscila «de dos en dos» (el umbral es de
        //  2 s) en vez de avanzar. Y si el latido se ha callado —pasa en cuanto
        //  `isRunning` es false: el heartbeat emite `if (liveIsActive &&
        //  isRunning)`— el documento se queda congelado y nos ancla ahí.
        //
        //  🔑 LA REGLA: con el reloj EN MARCHA sólo se aceptan correcciones
        //  HACIA ADELANTE (ponerse al día con quien va más avanzado, que es el
        //  caso real de v638: la tablet que se quedó atrás). Un salto hacia
        //  atrás sólo se acepta si es GRANDE —más de 30 s—, porque entonces no
        //  es latencia: es que alguien cambió la duración a mano (`editTimer`)
        //  y hay que obedecer. En PAUSA se adopta lo que diga el servidor, sin
        //  condiciones: ahí no hay nada corriendo que pueda ir por delante.
        //  ⚠️ Esto NO desactiva v638: su caso —el aparato retrasado— es
        //  precisamente una corrección hacia adelante.
        const _SALTO_MANUAL = 30;
        const _aceptaCorreccion = (servidor, local) => {
            if (!isRunning) return true;
            if (servidor >= local) return true;
            return (local - servidor) > _SALTO_MANUAL;
        };

        // Si la diferencia es significativa (> 1.5s), corregir
        if (diffH1 > _maxDriftAllowed && matchPhase === '1st_half' &&
            _aceptaCorreccion(serverData.timeH1 || 0, masterTimeH1)) {
            const correction = serverData.timeH1 - masterTimeH1;
            masterTimeH1 = serverData.timeH1;
            if(window._CRONOS_DEBUG) console.warn(`Timer H1 ajustado: ${correction > 0 ? '+' : ''}${correction}s (drift corregido)`);
            if (window.renderOptimizer) {
                window.renderOptimizer.scheduleRender(updateMasterUI, 'high');
            } else {
                updateMasterUI();
            }
        }

        if (diffH2 > _maxDriftAllowed && matchPhase === '2nd_half' &&
            _aceptaCorreccion(serverData.timeH2 || 0, masterTimeH2)) {
            const correction = serverData.timeH2 - masterTimeH2;
            masterTimeH2 = serverData.timeH2;
            if(window._CRONOS_DEBUG) console.warn(`Timer H2 ajustado: ${correction > 0 ? '+' : ''}${correction}s (drift corregido)`);
            if (window.renderOptimizer) {
                window.renderOptimizer.scheduleRender(updateMasterUI, 'high');
            } else {
                updateMasterUI();
            }
        }
    } catch (e) {
        // Offline o error de Firebase: continuar sin sync (no crítico)
        // El próximo sync reintenará
    }
}

function updateMasterUI() {
    const timerH1El = document.getElementById('timer-h1');
    const timerH2El = document.getElementById('timer-h2');
    const containerH1 = document.getElementById('timer-h1-container');
    const containerH2 = document.getElementById('timer-h2-container');
    const phaseLabel = document.getElementById('match-phase-label');
    const actionsEl = document.getElementById('phase-actions');

    // FIX: Guardar contra elementos DOM inexistentes (primer arranque)
    if (!timerH1El || !timerH2El || !containerH1 || !containerH2 || !phaseLabel) return;

    const h1Display = masterTimeH1 <= half1MaxTime ? (half1MaxTime - masterTimeH1) : (masterTimeH1 - half1MaxTime);
    timerH1El.textContent = formatTime(h1Display);
    containerH1.classList.toggle('added', masterTimeH1 > half1MaxTime && matchPhase === '1st_half');
    containerH1.classList.toggle('active', matchPhase === '1st_half');

    const h2Display = masterTimeH2 <= half2MaxTime ? (half2MaxTime - masterTimeH2) : (masterTimeH2 - half2MaxTime);
    timerH2El.textContent = formatTime(h2Display);
    containerH2.classList.toggle('added', masterTimeH2 > half2MaxTime);
    containerH2.classList.toggle('active', matchPhase === '2nd_half');

    if (matchPhase === '1st_half') phaseLabel.textContent = masterTimeH1 > half1MaxTime ? '1ª PARTE (AÑADIDO)' : '1ª PARTE';
    else if (matchPhase === 'break') phaseLabel.textContent = 'DESCANSO';
    else if (matchPhase === '2nd_half') phaseLabel.textContent = masterTimeH2 > half2MaxTime ? '2ª PARTE (AÑADIDO)' : '2ª PARTE';
    else if (matchPhase === 'finished') phaseLabel.textContent = 'FIN DEL PARTIDO';

    const prev = document.getElementById('btn-inline-phase');
    if (prev) prev.remove();

    if (matchPhase !== 'finished') {
        const btn = document.createElement('button');
        btn.id = 'btn-inline-phase';
        btn.style.cssText = 'font-size:1.1rem;padding:3px 6px;border-radius:6px;border:none;cursor:pointer;line-height:1;flex-shrink:0;';
        if (matchPhase === '1st_half') {
            btn.textContent = '🏁'; btn.title = 'Finalizar 1ª Parte';
            btn.style.background = '#b8860b';
            btn.onclick = (e) => { e.stopPropagation(); endFirstHalf(); };
            containerH1.insertAdjacentElement('afterend', btn);
        } else if (matchPhase === 'break') {
            btn.textContent = '▶️'; btn.title = 'Iniciar 2ª Parte';
            btn.style.background = '#1a5e8a';
            btn.onclick = (e) => { e.stopPropagation(); startSecondHalf(); };
            containerH2.insertAdjacentElement('beforebegin', btn);
        } else if (matchPhase === '2nd_half') {
            btn.textContent = '🏁'; btn.title = 'Finalizar Partido';
            btn.style.background = '#8b0000';
            btn.onclick = (e) => { e.stopPropagation(); endMatch(); };
            containerH2.insertAdjacentElement('afterend', btn);
        }
    }

    const cancelSubBtn = document.getElementById('btn-cancel-sub');
    actionsEl.innerHTML = '';
    if (cancelSubBtn) actionsEl.appendChild(cancelSubBtn);

    // 🔴🔴 v716 · Y EL BOTÓN, AQUÍ, EN CADA REPINTADO. Es lo que hace que el
    // estado del botón esté «estrictamente unificado y sincronizado con el
    // estado real del cronómetro», como pide el autor: pasa por aquí el tick,
    // el fin de parte, el retomar, el reinicio y la adopción del servidor, así
    // que cualquiera que cambie el estado deja el botón al día SIN tener que
    // acordarse de pintarlo. Antes lo pintaban a mano OCHO sitios distintos y
    // bastaba con que uno se quedara atrás para que dijera EMPEZAR con el
    // partido corriendo (IMG_0583).
    cronosPintaBotonReloj();
}

// ════════════════════════════════════════════════════════════════════
//  🔴🔴🔴 v587 · CAMBIAR LA DURACIÓN EN CALIENTE DESINCRONIZABA EL VISOR
//
//  Reporte del autor (partido real de Regional FEM A, v586): arrancó con
//  45 minutos por parte y a mitad de la 1ª los cambió a 5. En ese instante
//  **el visor en vivo se desvinculó**: su reloj se congeló mientras el panel
//  del entrenador seguía sumando los 42-43 minutos reales.
//
//  🔑🔑🔑 ESTA FUNCIÓN CAMBIABA UNA VARIABLE LOCAL Y REPINTABA. Nada más.
//  Ni guardaba el estado, ni empujaba un snapshot. Así que:
//    · el visor seguía con la duración VIEJA hasta que otra cosa cualquiera
//      provocara un envío (de ahí que al pulsar "Reiniciar" apareciera "de
//      golpe"), y
//    · al llegarle por fin la duración nueva, `live.html` topa el reloj en
//      `maxTime + añadido`; con 42 minutos jugados y un tope nuevo de 5, ese
//      `Math.min` congela el número en seco.
//  El panel no se desincronizaba "por su cuenta": es que nadie le había
//  contado al visor que la duración había cambiado.
//
//  🔑 LO QUE NO SE PUEDE ARREGLAR CON CÓDIGO, y por eso ahora se PREGUNTA:
//  si ya se han jugado 42 minutos y la parte pasa a durar 5, esa parte está
//  terminada — el tiempo transcurrido es un hecho, no un ajuste. Hay dos
//  respuestas razonables y sólo el entrenador sabe cuál quiere:
//    · dar la parte por acabada (conserva lo jugado), o
//    · volver a contar desde cero con la duración nueva.
//  Antes no se preguntaba y no pasaba ninguna de las dos: se quedaba a medias.
//
//  ⚠️ Reiniciar el contador re-ancla el visor solo: `phaseStartedAt`
//  (sync.js) se DERIVA de masterTimeH1/H2, así que ponerlo a cero mueve el
//  ancla absoluta del espectador sin tocar nada más.
// ════════════════════════════════════════════════════════════════════
function editTimer(half) {
    const enCurso = (half === 1 && matchPhase === '1st_half') ||
                    (half === 2 && matchPhase === '2nd_half');
    const currentMin = Math.floor((half === 1 ? half1MaxTime : half2MaxTime) / 60);
    const newMin = prompt(`Minutos para la ${half}ª parte:`, currentMin);
    if (newMin === null) return;                       // canceló: no se toca nada
    const min = parseInt(newMin, 10);
    if (isNaN(min) || min <= 0) {
        if (typeof showToast === 'function') showToast('⚠️ Duración no válida. No se ha cambiado nada.', 3500);
        return;
    }
    const nuevoMax     = min * 60;
    const transcurrido = ((half === 1 ? masterTimeH1 : masterTimeH2) || 0);

    // ¿La parte EN CURSO ya lleva jugado más de lo que va a durar?
    let reiniciar = false;
    if (enCurso && transcurrido >= nuevoMax) {
        const mm = String(Math.floor(transcurrido / 60));
        const ss = String(transcurrido % 60).padStart(2, '0');
        reiniciar = confirm(
            '⏱️ Esta parte ya lleva ' + mm + ':' + ss + ' jugados, más de los ' +
            min + ' minutos que le acabas de poner.\n\n' +
            'ACEPTAR → el cronómetro vuelve a CERO y cuenta los ' + min + ' minutos nuevos.\n' +
            'CANCELAR → se conserva lo jugado y la parte se dará por terminada.\n\n' +
            'En los dos casos el visor en vivo se sincroniza al instante.'
        );
    }

    if (half === 1) half1MaxTime = nuevoMax; else half2MaxTime = nuevoMax;
    if (reiniciar) {
        if (half === 1) masterTimeH1 = 0; else masterTimeH2 = 0;
        // El ancla del visor se deriva de masterTime + lo que el tick no pudo
        // procesar: se pone a cero también, o el espectador vería el desfase.
        if (typeof lastTickTime !== 'undefined') lastTickTime = Date.now();
    }
    updateMasterUI();

    // ── Y AHORA SÍ: SE GUARDA Y SE CUENTA. Esto era lo que faltaba. ──
    // Mismo par que usan endFirstHalf/startSecondHalf y todos los puntos que
    // tocan el reloj (event-listeners.js): persistir y empujar snapshot.
    if (typeof window !== 'undefined' && typeof window._saveMatchStateToStorage === 'function') {
        try { window._saveMatchStateToStorage(); } catch (_) {}
    }
    if (typeof liveIsActive !== 'undefined' && liveIsActive &&
        typeof pushLiveSnapshot === 'function') {
        pushLiveSnapshot('active').catch(() => {});
    }
    if (typeof showToast === 'function') {
        showToast('⏱️ ' + half + 'ª parte: ' + min + ' min' +
                  (reiniciar ? ' · cronómetro reiniciado' : '') +
                  '. Visor en vivo sincronizado.', 3500);
    }
}

// ── SPINNER DE CARGA ──────────────────────────────────────────────
function showSpinner(msg) {
    msg = msg || 'Guardando…';
    let overlay = document.getElementById('cronos-spinner');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cronos-spinner';
        overlay.style.cssText =
            'position:fixed;inset:0;background:rgba(10,14,20,0.75);z-index:99999;' +
            'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;' +
            'backdrop-filter:blur(3px);';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML =
        '<div style="width:44px;height:44px;border-radius:50%;' +
        'border:4px solid rgba(88,166,255,0.2);border-top-color:#58a6ff;' +
        'animation:spinnerRotate 0.8s linear infinite;"></div>' +
        '<p style="color:#cdd9e5;font-size:0.9rem;font-weight:700;margin:0;">' + msg + '</p>' +
        '<style>@keyframes spinnerRotate{to{transform:rotate(360deg)}}</style>';
    overlay.style.display = 'flex';
}

function hideSpinner() {
    const overlay = document.getElementById('cronos-spinner');
    if (overlay) overlay.style.display = 'none';
}

function showToast(msg, duration) {
    duration = duration || 3000;
    const existing = document.getElementById('cronos-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'cronos-toast';
    toast.textContent = msg;
    toast.style.cssText =
        'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
        'background:#1a7a3e;color:#fff;padding:10px 22px;border-radius:8px;' +
        'font-size:0.85rem;font-weight:700;z-index:99998;' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.4);white-space:nowrap;' +
        'animation:toastIn 0.2s ease;';
    const style = document.createElement('style');
    style.textContent = '@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(style);
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, duration);
}

function formatTime(sec) {
    sec = Math.max(0, sec || 0); // FIX: proteger contra valores negativos o undefined
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// --- RENDER ---
