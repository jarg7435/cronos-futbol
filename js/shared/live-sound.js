// ══════════════════════════════════════════════════════════════════
//  CHRONOS FÚTBOL — EL SONIDO DE CADA SUCESO (v709)
//  js/shared/live-sound.js
// ══════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-14): «evitar que el pitido o
//  sonido general de entrada de la tarjeta se sobreponga a los audios
//  específicos. Debe prevalecer SIEMPRE el sonido característico del evento
//  (gol, tarjeta amarilla, lesión, cambio), reproduciéndose de forma limpia y
//  sin interferencias».
//
//  🔑 DE DÓNDE VIENE ESTE FICHERO. Las cinco melodías existen desde el
//  principio dentro de live.html (`playEventSound`/`_playSeq`), y son lo que el
//  autor reconoce de oído: un gol no suena como una amarilla. El panel en vivo
//  del Área de Familias, que estrenó oyente en v708, sonaba en cambio con la
//  CAMPANA GENERAL de los avisos push — el «sonido general» del encargo. Dos
//  pantallas del mismo producto anunciando lo mismo con sonidos distintos.
//
//  ⚠️ SE MOVIÓ, NO SE COPIÓ (la misma decisión que el mini-feed en v706): con
//  dos tablas de melodías, cambiar el sonido del gol dejaría a una de las dos
//  pantallas con el viejo y nadie lo notaría hasta oírlas juntas.
//
//  ⚠️⚠️ EL CONTEXTO DE AUDIO SE PUEDE PRESTAR, Y ES IMPORTANTE. live.html
//  mantiene el SUYO con un bucle de silencio (el keep-alive que evita que iOS
//  lo suspenda) y su botón de desbloqueo; si este módulo creara otro, un iPhone
//  acabaría con DOS contextos compitiendo y el segundo mudo. Por eso
//  `reproduce(tipo, ctx)` acepta el contexto de quien llama y sólo crea uno
//  propio cuando no se le pasa ninguno (el caso del panel de familias).
//
//  ⚠️ NADA DE FICHEROS DE AUDIO: todo sintetizado. Un .mp3 es una petición de
//  red que puede faltar justo el día que hay partido (misma razón que el
//  silbato del árbitro y la campana de los avisos).
// ══════════════════════════════════════════════════════════════════
(function (global) {
    'use strict';

    // [frecuencia(Hz), inicio(s), duracion(s)]
    // Secuencia CORTA (melodía reconocible de cada evento). En lugar de alargar
    // cada nota —que sonaba a golpe + silencio por el decay exponencial— se
    // repite la secuencia completa 3 veces manteniendo su melodía. Cada nota
    // usa envolvente sostenida (sin huecos internos).
    const SEQ = {
        goal:   [[660,0,0.12],[880,0.12,0.12],[1175,0.24,0.22]],   // fanfarria ascendente
        yellow: [[520,0,0.18]],                                     // pitido medio
        red:    [[400,0,0.18],[300,0.20,0.30]],                    // doble grave
        sub:    [[700,0,0.10],[900,0.12,0.12]],                    // dos notas suaves
        injury: [[300,0,0.25],[260,0.27,0.35]]                     // tono descendente
    };
    const REPS = 3;      // repeticiones fijas
    const GAP  = 0.06;   // pausa entre repeticiones

    // Los dos alias de media sustitución suenan como el cambio completo.
    const _ALIAS = { sub_in: 'sub', sub_out: 'sub' };

    // ⚠️ CUANDO ENTRAN VARIOS SUCESOS A LA VEZ SUENA UNO, Y EL QUE MÁS PESA.
    // Tres melodías simultáneas son exactamente la «interferencia» que se viene
    // a quitar: se solapan y no se reconoce ninguna. El orden es el del partido
    // —una roja manda sobre un cambio— y lo usan las dos pantallas.
    const PRIORIDAD = ['red', 'goal', 'injury', 'yellow', 'sub'];

    let _ctxPropio = null;

    function _tipo(t) {
        const k = String(t || '');
        return _ALIAS[k] || k;
    }

    function _contexto(ctxExterno) {
        if (ctxExterno) return ctxExterno;
        try {
            const C = global.AudioContext || global.webkitAudioContext;
            if (!C) return null;
            if (!_ctxPropio) _ctxPropio = new C();
            return _ctxPropio;
        } catch (e) { return null; }
    }

    // Programa las repeticiones leyendo `currentTime` EN EL MOMENTO.
    // ⚠️ Sólo se llama con el contexto ya 'running': con el contexto suspendido
    // `currentTime` queda congelado y las tres repeticiones se programan casi en
    // el mismo instante — al reanudar, el reloj salta y se colapsan en un solo
    // golpe («se oye una vez y corta»). Es la razón de ser del `resume()` de
    // `reproduce`.
    function _programa(ctx, tipo) {
        const seq = SEQ[tipo] || SEQ.sub;
        const now = ctx.currentTime;
        const seqDur = Math.max.apply(null, seq.map(function (n) { return n[1] + n[2]; }));
        const step   = seqDur + GAP;
        for (let r = 0; r < REPS; r++) {
            const base = r * step;
            seq.forEach(function (nota) {
                const freq = nota[0], start = nota[1], dur = nota[2];
                const osc  = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = (tipo === 'goal') ? 'triangle' : 'sine';
                osc.frequency.value = freq;
                const t0  = now + base + start;
                const atk = 0.012;                          // ataque
                const rel = Math.min(0.05, dur * 0.35);     // release corto
                const sus = t0 + Math.max(atk, dur - rel);
                gain.gain.setValueAtTime(0.0001, t0);
                gain.gain.exponentialRampToValueAtTime(0.22, t0 + atk);
                gain.gain.setValueAtTime(0.22, sus);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
                osc.connect(gain); gain.connect(ctx.destination);
                osc.start(t0); osc.stop(t0 + dur + 0.02);
            });
        }
    }

    // Suena el tipo pedido. `ctxExterno` es opcional (ver la nota de la
    // cabecera). Devuelve false sólo si no hay audio posible en el navegador.
    function reproduce(tipo, ctxExterno) {
        const ctx = _contexto(ctxExterno);
        if (!ctx) return false;
        const t = _tipo(tipo);
        if (ctx.state === 'running') { _programa(ctx, t); return true; }
        try {
            ctx.resume().then(function () { _programa(ctx, t); }).catch(function () {});
        } catch (e) { /* sin audio: la pantalla sigue avisando */ }
        return true;
    }

    // De una tanda de sucesos, el tipo que debe sonar.
    function masImportante(tipos) {
        const lista = (tipos || []).map(_tipo);
        for (let i = 0; i < PRIORIDAD.length; i++) {
            if (lista.indexOf(PRIORIDAD[i]) >= 0) return PRIORIDAD[i];
        }
        return lista.length ? lista[0] : null;
    }

    // Desbloqueo: el navegador exige un GESTO del usuario para que el audio
    // suene después sin gesto (que es el caso de un suceso que llega por
    // Firestore). Se llama desde el onclick del botón de sonido.
    function desbloquea() {
        const ctx = _contexto(null);
        if (!ctx) return false;
        try {
            if (ctx.state === 'suspended') ctx.resume();
            // Un buffer de un solo frame: inaudible, y basta para que iOS
            // considere el contexto «arrancado por gesto».
            const buf = ctx.createBuffer(1, 1, 22050);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            src.start(0);
        } catch (e) { return false; }
        return ctx.state === 'running';
    }

    global.cronosLiveSound = {
        SEQ: SEQ,
        PRIORIDAD: PRIORIDAD,
        reproduce: reproduce,
        masImportante: masImportante,
        desbloquea: desbloquea
    };
})(typeof window !== 'undefined' ? window : globalThis);
