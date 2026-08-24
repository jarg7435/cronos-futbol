// ════════════════════════════════════════════════════════════════════
//  js/match/events/sub-rules.js — LÍMITES FEDERATIVOS DE SUSTITUCIÓN
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-08-24). Tres regímenes:
//
//   · Fútbol 7, Infantil y FUTureFEM ...... cambios LIBRES (como hasta ahora)
//   · Cadete ............................... 7 cambios · 3 ventanas · sin reingreso
//   · Juvenil, Regional y Regional FEM ..... 5 cambios · 3 ventanas · sin reingreso
//
//  Y en los dos regímenes limitados, el DESCANSO da una ventana extra: las 3
//  son las de parones con el juego en marcha, y lo que se haga en el descanso
//  no consume ninguna de ellas.
//
// ── DECISIONES SUYAS, PREGUNTADAS ANTES DE ESCRIBIR ──────────────────
//
//  1. QUÉ ES UNA VENTANA. El modo GRUPAL —que ya existía— cuenta como UNA
//     ventana, meta a los jugadores que meta; cada cambio individual suelto
//     cuenta como la suya. Así la app no adivina: si el entrenador quiere que
//     dos cambios sean una sola ventana, los hace en grupal. Se descartó
//     agrupar por tiempo justamente para no adivinar.
//
//  2. QUÉ PASA AL PASARSE. Se AVISA y se deja continuar. El árbitro manda, no
//     la aplicación: si permitió algo —una lesión, un criterio suyo, un
//     error—, el acta tiene que poder reflejar lo que ocurrió de verdad. Un
//     bloqueo dejaría el registro desalineado con el campo, que es peor que
//     un cambio de más.
//
// ── ⚠️ LO QUE NO CUENTA COMO CAMBIO ──────────────────────────────────
//
//  La aplicación apunta movimientos AUTOMÁTICOS: un «Sale (DESCANSO)» a todos
//  los del campo, un «Entra (2ªP)» a los que salen en la segunda y un «Sale
//  (FIN)» al acabar (ver el motor de informes, v426/v473). Si el contador
//  mirara el registro de movimientos, **un Cadete agotaría sus 7 cambios en el
//  descanso sin haber hecho ninguno**. Por eso este módulo NO lee el historial:
//  lo llaman explícitamente las dos puertas por las que pasa una sustitución
//  de verdad —`confirmSubstitutionWith` y `executeGroupSubstitution`— y nadie
//  más.
// ════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    const LIBRE   = { grupo: 'libre',    ilimitado: true };
    const CADETE  = { grupo: 'cadete',   ilimitado: false, maxCambios: 7, maxVentanas: 3, reingreso: false };
    const JUVENIL = { grupo: 'juvenil',  ilimitado: false, maxCambios: 5, maxVentanas: 3, reingreso: false };

    // Sin tildes ni separadores: NFD parte la letra acentuada en letra +
    // marca suelta, y el barrido de [^a-z0-9] se lleva la marca. Así no hace
    // falta escribir el rango de diacríticos en el fuente, que es frágil.
    function _norm(s) {
        return String(s == null ? '' : s).toLowerCase()
            .normalize('NFD')
            .replace(/[^a-z0-9]/g, '');                          // sin _ ni espacios
    }

    // ⚠️ SOBRE EL ORDEN, CON HONESTIDAD.
    //
    //  `'regionalfem'.includes('regional')` es TRUE y `'futurefem'` contiene
    //  `fem`: son las subcadenas que costaron siete cascadas en v511. Por eso
    //  las dos ramas explícitas van DELANTE.
    //
    //  🔑 Pero HOY ninguna de las dos es lo que produce el resultado, y el
    //  red-check lo demostró: quitándolas, el Regional FEM sigue cayendo en
    //  JUVENIL —porque comparte reglas con el Regional— y FUTureFEM sigue
    //  saliendo LIBRE porque LIBRE es el valor por defecto. Se quedan porque
    //  dicen la intención en voz alta y porque el día que Regional FEM o
    //  FUTureFEM dejen de compartir régimen con su vecino, el orden SÍ pasará
    //  a decidir. No se documentan como "el arreglo": son una red.
    function reglasDe(categoria, modalidad) {
        const c = _norm(categoria);

        // 1. FUTureFEM: libre por decisión suya, aunque sea F11.
        if (c.indexOf('futurefem') !== -1 || c.indexOf('future') !== -1) return LIBRE;

        // 2. Fútbol 7 entero: libre.
        if (_norm(modalidad) === 'f7') return LIBRE;

        // 3. Regional Femenino ANTES que Regional.
        if (c.indexOf('regionalfem') !== -1 || (c.indexOf('regional') !== -1 && c.indexOf('fem') !== -1)) return JUVENIL;

        if (c.indexOf('cadete') !== -1)   return CADETE;
        if (c.indexOf('juvenil') !== -1)  return JUVENIL;
        if (c.indexOf('regional') !== -1) return JUVENIL;
        if (c.indexOf('infantil') !== -1) return LIBRE;

        // ⚠️ Sin categoría reconocible NO se limita nada. Un partido que no
        //    sabemos qué es no puede quedarse sin cambios por una cadena que
        //    no supimos leer: el aviso falso es peor que la ausencia de aviso.
        return LIBRE;
    }

    // La MISMA cascada que usa el semáforo (getTimerColor). Dos cascadas
    // distintas para el mismo dato ya produjeron un fallo en v562.
    function categoriaActual() {
        const me = window._cronosCurrentUser;
        const doc = (typeof document !== 'undefined') ? document : null;
        return window._currentMatchCategory ||
               (doc && doc.getElementById('match-category') ? doc.getElementById('match-category').value : '') ||
               (me && (me.category || (me._activeRoleData && me._activeRoleData.category) || me.categoryLabel)) ||
               '';
    }

    function modalidadActual() {
        return (typeof window.currentMode !== 'undefined' && window.currentMode) ? window.currentMode : '';
    }

    // ── Estado por equipo, del partido en curso ──────────────────────
    function _nuevo() {
        return { cambios: 0, ventanasEnJuego: 0, ventanaDescansoUsada: false, salidos: [] };
    }
    function _estado(team) {
        if (!window._cronosSubState) window._cronosSubState = {};
        const k = (team === 'away') ? 'away' : 'home';
        if (!window._cronosSubState[k]) window._cronosSubState[k] = _nuevo();
        return window._cronosSubState[k];
    }

    function reset() { window._cronosSubState = { home: _nuevo(), away: _nuevo() }; }

    // ¿Estamos en el descanso? Es lo que decide si la ventana consume una de
    // las tres o si es la extra.
    function enDescanso() {
        return (typeof window.matchPhase !== 'undefined' && window.matchPhase === 'break');
    }

    // ── El veredicto ─────────────────────────────────────────────────
    //  Devuelve { ok, avisos[], reglas }. `ok:false` NO impide nada: quien
    //  llama enseña los avisos y deja decidir. Ver la decisión 2 de arriba.
    function evaluar(team, salientesIds, entrantesIds, opciones) {
        const o = opciones || {};
        const reglas = o.reglas || reglasDe(categoriaActual(), modalidadActual());
        if (reglas.ilimitado) return { ok: true, avisos: [], reglas: reglas };

        const st = _estado(team);
        const nCambios = Math.min((salientesIds || []).length, (entrantesIds || []).length);
        const descanso = (o.descanso != null) ? !!o.descanso : enDescanso();
        const avisos = [];

        // 1. Reingreso: quien salió no vuelve.
        (entrantesIds || []).forEach(function (id) {
            if (st.salidos.indexOf(id) !== -1) {
                const n = (o.nombreDe && o.nombreDe(id)) || 'Ese jugador';
                avisos.push(n + ' ya fue sustituido y en esta categoría no puede volver a entrar.');
            }
        });

        // 2. Número de cambios.
        if (st.cambios + nCambios > reglas.maxCambios) {
            avisos.push('Máximo de ' + reglas.maxCambios + ' cambios: llevas ' + st.cambios +
                        ' y esto ' + (nCambios === 1 ? 'sería el ' + (st.cambios + 1) + '.'
                                                     : 'sumaría ' + nCambios + ' más.'));
        }

        // 3. Ventanas. En el descanso NO se consume ninguna de las tres: todo
        //    lo que se haga ahí es la MISMA ventana, la extra, porque es una
        //    sola parada real por mucho que se toque el botón varias veces.
        if (!descanso && st.ventanasEnJuego + 1 > reglas.maxVentanas) {
            avisos.push('Máximo de ' + reglas.maxVentanas + ' ventanas con el juego parado: ya has usado ' +
                        st.ventanasEnJuego + '.' +
                        (st.ventanaDescansoUsada ? '' : ' La del descanso sigue disponible.'));
        }

        return { ok: avisos.length === 0, avisos: avisos, reglas: reglas };
    }

    // Anota el cambio YA HECHO. Se llama después de ejecutarlo, se haya
    // avisado o no: el contador tiene que reflejar la realidad del partido,
    // incluidos los cambios que el entrenador decidió hacer igualmente.
    function registrar(team, salientesIds, entrantesIds, opciones) {
        const o = opciones || {};
        const reglas = o.reglas || reglasDe(categoriaActual(), modalidadActual());
        if (reglas.ilimitado) return;

        const st = _estado(team);
        const nCambios = Math.min((salientesIds || []).length, (entrantesIds || []).length);
        if (nCambios <= 0) return;
        const descanso = (o.descanso != null) ? !!o.descanso : enDescanso();

        st.cambios += nCambios;
        if (descanso) st.ventanaDescansoUsada = true;
        else st.ventanasEnJuego += 1;

        (salientesIds || []).slice(0, nCambios).forEach(function (id) {
            if (st.salidos.indexOf(id) === -1) st.salidos.push(id);
        });
    }

    // Texto para el aviso, con el resumen de lo gastado. Lo usa la confirmación.
    function resumen(team) {
        const reglas = reglasDe(categoriaActual(), modalidadActual());
        if (reglas.ilimitado) return '';
        const st = _estado(team);
        return 'Llevas ' + st.cambios + '/' + reglas.maxCambios + ' cambios y ' +
               st.ventanasEnJuego + '/' + reglas.maxVentanas + ' ventanas' +
               (st.ventanaDescansoUsada ? ' (más la del descanso).' : '.');
    }

    // ── LA PUERTA ÚNICA que usan los dos sitios donde se sustituye ───
    //  Evalúa y, si hay algo que decir, lo dice y DEJA DECIDIR. Devuelve
    //  `true` si el cambio debe ejecutarse.
    //
    //  ⚠️ Si el usuario sigue adelante, el cambio se registra igual en el
    //  contador: el partido tiene que reflejar lo que pasó, no lo que la
    //  norma permitía.
    function confirmarYRegistrar(team, salientesIds, entrantesIds, nombreDe) {
        const v = evaluar(team, salientesIds, entrantesIds, { nombreDe: nombreDe });
        if (!v.ok) {
            const texto = '⚠️ Normativa de la categoría\n\n' + v.avisos.join('\n\n') +
                          '\n\n' + resumen(team) +
                          '\n\n¿Hacer el cambio igualmente?';
            const seguir = (typeof confirm === 'function') ? confirm(texto) : true;
            if (!seguir) return false;
        }
        registrar(team, salientesIds, entrantesIds, { reglas: v.reglas });
        return true;
    }

    window.CronosSubRules = {
        confirmarYRegistrar: confirmarYRegistrar,
        reglasDe: reglasDe,
        categoriaActual: categoriaActual,
        modalidadActual: modalidadActual,
        evaluar: evaluar,
        registrar: registrar,
        resumen: resumen,
        reset: reset,
        enDescanso: enDescanso,
        estado: _estado,
        LIBRE: LIBRE, CADETE: CADETE, JUVENIL: JUVENIL
    };
})();
