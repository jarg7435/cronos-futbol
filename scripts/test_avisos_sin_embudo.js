// ─────────────────────────────────────────────────────────────────────────
// test_avisos_sin_embudo.js · v567 · Los cuatro fallos de la PRUEBA DE ESTRÉS
// REAL con 7 partidos simultáneos (6 iPads + 1 móvil), implementar.txt 2026-08-17.
//
// LO QUE REPORTÓ EL AUTOR, literal:
//   1. "el historial de la barra inferior funciona perfectamente y al instante,
//      pero los avisos flotantes se retrasan, se atropellan y aparecen todos
//      juntos de golpe (7-0: al séptimo gol saltaron 4 avisos)".
//   2. "el sonido aparece silenciado por defecto".
//   3. "el aviso de fin de 1ª parte sólo sale en el PC, casi nunca en iPads".
//   4. "los cronómetros se quedan congelados si la conexión o la pestaña sufre
//      pausas".
//
// 🔑🔑🔑 LA CAUSA DE 1 Y 3 ES LA MISMA, Y LA ASIMETRÍA QUE ÉL DESCRIBIÓ ES SU
// FIRMA EXACTA. La barra y el aviso pintan el mismo suceso por caminos
// distintos: la barra la alimenta renderMatch -> _loadMatchEventsFromSnapshot,
// sin ninguna guarda; los avisos pasaban por las DOS guardas de entrada de
// detectAndAlert, que descartaban el snapshot ENTERO —sucesos, fase y caché—.
// Y `_registerMatchEvent` escribía sólo `events: arrayUnion(...)` sin tocar
// `updatedAt`, así que el snapshot del gol llegaba con la MISMA hora que el
// anterior y la guarda monotónica lo tiraba. El gol no salía hasta que un latido
// posterior cambiaba `updatedAt`: entonces salían todos de golpe. Eso es el
// embudo.
//
// ESTE GUARD ES DE COMPORTAMIENTO, NO DE TEXTO: recorta las funciones reales de
// live.html y las EJECUTA contra secuencias de snapshots que reproducen el
// escenario del campo. Un censo por regex habría dado verde con el defecto
// puesto — ya ha pasado dos veces en este proyecto.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// Recorta `function <nombre>(` … hasta su llave de cierre, contando llaves.
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

console.log('── v567 · avisos sin embudo, fase fiable, sonido y resincronización ──\n');

const LIVE    = leer('live.html');
const ACTIONS = leer('js/match/events/player-actions.js');

// ═══════════════════════════════════════════════════════════════════════════
// PARTE 1 · COMPORTAMIENTO: el embudo, reproducido y cerrado
// ═══════════════════════════════════════════════════════════════════════════
console.log('── PARTE 1 · el efecto embudo (comportamiento real) ──');
{
    const fnDetect = recorta(LIVE, 'function detectAndAlert(');
    const fnBuild  = recorta(LIVE, 'function _buildState(');
    ok('1a · se recortan detectAndAlert y _buildState de live.html',
       !!fnDetect && !!fnBuild);

    if (fnDetect && fnBuild) {
        const anunciados = [];
        const fases      = [];
        const sandbox = {
            console,
            // ── estado por partido, tal cual lo declara live.html ──
            _matchLastTs: {}, _matchPrevState: {}, _matchSeeded: {},
            // v572b · marca de agua de la siembra. Desde P2 hay DOS vistas del
            // mismo partido (indice ligero y documento entero) y la siembra ya
            // no puede ser un booleano: ver `_matchSeedTs` en live.html.
            _matchSeedTs: {},
            // v676 · marca del instante de apertura + tolerancia de reloj: sin
            // ellas `detectAndAlert` lanza ReferenceError (ver live.html).
            _matchWatchStart: {},
            _TOLERANCIA_RELOJ_MS: 2 * 60 * 1000,
            _matchSeenEvents: {}, _matchLastData: {}, _matchPrevPhase: {},
            currentMatchId: 'M1',
            // ── colaboradores, estabulados ──
            _seenSetFor: (id) => (sandbox._matchSeenEvents[id] =
                                  sandbox._matchSeenEvents[id] || new Set()),
            _eventBelongsTo: (ev, id) => !ev.matchId || ev.matchId === id,
            _esEventoVisible: (ev) => ev.type !== 'tactical_move',
            _eventKey: (ev) => ev.eventId || '',
            _formateaLineaEvento: (t, txt) => txt,
            _equipoDeSuceso: () => null,
            _handlePhaseTransition: (id, d) => {
                if (d) sandbox._matchLastData[id] = d;
                fases.push(d ? (d.phase || '?') : '(cacheado)');
            },
            showEventToast: (t, linea) => anunciados.push(t + ':' + linea)
        };
        sandbox.window = sandbox;
        vm.createContext(sandbox);
        vm.runInContext(fnBuild + '\n' + fnDetect, sandbox);

        // El documento tal y como lo escribe el entrenador. `updatedAt` es un
        // Timestamp de Firestore: se imita con toMillis().
        const T = (ms) => ({ toMillis: () => ms });
        const gol = (id, quien) => ({
            eventId: id, matchId: 'M1', type: 'goal',
            text: 'GOL · ' + quien, timestamp: '2026-08-17T10:0' + id + ':00Z'
        });
        const doc = (ms, eventos, extra) => Object.assign({
            id: 'M1', status: 'active', phase: '1st_half',
            updatedAt: T(ms), events: eventos,
            homeTeam: { name: 'CHRONOS', score: eventos.length },
            awayTeam: { name: 'RIVAL', score: 0 },
            players: []
        }, extra || {});

        // Snapshot 1 = siembra. No debe anunciar nada.
        sandbox.detectAndAlert('M1', doc(1000, []), false);
        ok('1b · la siembra no anuncia nada', anunciados.length === 0,
           JSON.stringify(anunciados));

        // 🔑🔑🔑 EL ESCENARIO DEL FALLO, EXACTO.
        // `_registerMatchEvent` escribe SÓLO `events`, así que este snapshot
        // llega con el MISMO updatedAt (1000) que el anterior. En v566 la guarda
        // monotónica lo descartaba entero y el gol no salía hasta el siguiente
        // latido. Tiene que anunciarse AHORA.
        anunciados.length = 0;
        sandbox.detectAndAlert('M1', doc(1000, [gol('1', 'IVÁN')]), false);
        ok('1c · 🔑🔑🔑 un gol con el MISMO updatedAt se anuncia AL INSTANTE',
           anunciados.length === 1, 'anunciados: ' + JSON.stringify(anunciados));

        // Y una racha: siete goles seguidos, todos sin cambiar updatedAt.
        // En v566 se acumulaban y salían de golpe al llegar un latido.
        anunciados.length = 0;
        const racha = [gol('1', 'IVÁN')];
        for (let n = 2; n <= 7; n++) {
            racha.push(gol(String(n), 'JUGADOR' + n));
            sandbox.detectAndAlert('M1', doc(1000, racha.slice()), false);
        }
        ok('1d · 🔑 una racha de 7 goles sale de UNO EN UNO, no a golpes',
           anunciados.length === 6, 'anunciados: ' + anunciados.length + ' (esperados 6)');

        // Y sin repetir: el mismo array reenviado 20 veces no vuelve a cantar.
        anunciados.length = 0;
        for (let i = 0; i < 20; i++) {
            sandbox.detectAndAlert('M1', doc(1000 + i, racha.slice()), false);
        }
        ok('1e · 🔑 20 latidos con los mismos 7 goles no repiten ni uno',
           anunciados.length === 0, 'anunciados: ' + anunciados.length);

        // 🔑 FALLO DEL IPAD: un snapshot de CACHÉ con un gol nuevo. En v566
        // `if (fromCache) return` lo tiraba antes de mirarlo.
        anunciados.length = 0;
        racha.push(gol('8', 'NUEVO'));
        sandbox.detectAndAlert('M1', doc(1000, racha.slice()), true /* fromCache */);
        ok('1f · 🔑 un gol que llega en un snapshot fromCache TAMBIÉN se anuncia',
           anunciados.length === 1, 'anunciados: ' + JSON.stringify(anunciados));

        // Un partido ya terminado no canta su historial al reconectar.
        anunciados.length = 0;
        sandbox._matchSeenEvents['M2'] = undefined;
        sandbox.detectAndAlert('M2', doc(1, [gol('9', 'X')], { id: 'M2', status: 'finished' }), false);
        sandbox.detectAndAlert('M2', doc(2, [gol('9', 'X'), gol('10', 'Y')], { id: 'M2', status: 'finished' }), false);
        ok('1g · un partido TERMINADO no anuncia sucesos', anunciados.length === 0,
           JSON.stringify(anunciados));

        // 🔑 FALLO 3: la fase se evalúa aunque el snapshot sea de caché.
        fases.length = 0;
        sandbox.detectAndAlert('M1', doc(1000, racha.slice(), { phase: 'break' }), true);
        ok('1h · 🔑 la transición de fase se evalúa TAMBIÉN con fromCache',
           fases.length === 1, 'llamadas a _handlePhaseTransition: ' + fases.length);

        // Y con un snapshot repetido/atrasado, que la guarda monotónica tiraba.
        fases.length = 0;
        sandbox.detectAndAlert('M1', doc(1, racha.slice(), { phase: 'break' }), false);
        ok('1i · 🔑 y también con un snapshot no monotónico (reconexión)',
           fases.length === 1, 'llamadas: ' + fases.length);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE 2 · COMPORTAMIENTO: la fase no retrocede
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · un partido no vuelve de DESCANSO a 1ª parte ──');
{
    const fnPhase = recorta(LIVE, 'function _handlePhaseTransition(');
    const fnEff   = recorta(LIVE, 'function _effectivePhase(');
    ok('2a · se recortan _handlePhaseTransition y _effectivePhase', !!fnPhase && !!fnEff);

    if (fnPhase && fnEff) {
        const momentos = [], silbatos = [];
        const sandbox = {
            console,
            _matchLastData: {}, _matchPrevPhase: {},
            currentMatchId: 'M1', _alertsMuted: false,
            _puedeAvisarme: () => true,
            _liveWhistle: (n) => silbatos.push(n),
            _enqueueMoment: (o) => momentos.push(o.title)
        };
        sandbox.window = sandbox;
        vm.createContext(sandbox);
        vm.runInContext(fnEff + '\n' + fnPhase, sandbox);

        const d = (phase) => ({
            status: 'active', phase: phase, isRunning: false,
            homeTeam: { name: 'A', score: 0 }, awayTeam: { name: 'B', score: 0 }
        });

        sandbox._handlePhaseTransition('M1', d('1st_half'));          // siembra
        ok('2b · la siembra no anuncia', momentos.length === 0);

        sandbox._handlePhaseTransition('M1', d('break'));
        ok('2c · 1ª parte → DESCANSO anuncia FINAL DE PRIMERA PARTE',
           momentos.length === 1 && /PRIMERA PARTE/.test(momentos[0]), JSON.stringify(momentos));

        // 🔑 Un snapshot de caché atrasado que vuelve a decir '1ª parte'. Sin el
        // tope de orden, _matchPrevPhase retrocedería y el siguiente snapshot
        // bueno anunciaría el descanso OTRA VEZ, con silbato y overlay a
        // pantalla completa. Es el riesgo que abre evaluar la fase con caché.
        sandbox._handlePhaseTransition('M1', d('1st_half'));
        ok('2d · 🔑 un snapshot atrasado NO hace retroceder la fase',
           momentos.length === 1, JSON.stringify(momentos));

        sandbox._handlePhaseTransition('M1', d('break'));
        ok('2e · 🔑 y por eso el DESCANSO no se anuncia dos veces',
           momentos.length === 1, JSON.stringify(momentos));

        sandbox._handlePhaseTransition('M1', d('2nd_half'));
        ok('2f · DESCANSO → 2ª parte no anuncia nada', momentos.length === 1);

        sandbox._handlePhaseTransition('M1', d('finished'));
        ok('2g · 2ª parte → FIN anuncia FINAL DEL PARTIDO',
           momentos.length === 2 && /FINAL DEL PARTIDO/.test(momentos[1]), JSON.stringify(momentos));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE 3 · el suceso sella la hora en ORIGEN
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · _registerMatchEvent sella updatedAt ──');
{
    const bloque = ACTIONS.slice(ACTIONS.indexOf('events: fs.arrayUnion(eventEntry)'),
                                 ACTIONS.indexOf('events: fs.arrayUnion(eventEntry)') + 2200);
    ok('3a · 🔑 la escritura del suceso incluye updatedAt: serverTimestamp()',
       /events: fs\.arrayUnion\(eventEntry\),[\s\S]*?updatedAt: fs\.serverTimestamp\(\)/.test(bloque),
       bloque.slice(0, 120));
    ok('3b · y sigue siendo un merge (no pisa el resto del documento)',
       /\{ merge: true \}/.test(bloque));
    // ⚠️ `undefined` en un payload de Firestore LANZA (v431). El sello tiene que
    // ser una llamada, nunca un ternario que pueda quedar en undefined.
    ok('3c · ⚠️ el sello no es un ternario que pueda quedar en undefined',
       !/updatedAt:[^,\n]*\?[^,\n]*:\s*undefined/.test(bloque));
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE 4 · el sonido se guía por el AudioContext, no por una bandera
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · sonido activo por defecto ──');
{
    ok('4a · el silencio NACE apagado: sólo lo enciende el usuario',
       /_alertsMuted = \(localStorage\.getItem\("cronos_live_muted"\) === "1"\)/.test(LIVE));

    const fnAuto = recorta(LIVE, 'function _autoUnlockOnFirstGesture(');
    ok('4b · se recorta _autoUnlockOnFirstGesture', !!fnAuto);
    if (fnAuto) {
        // 🔑 EL DEFECTO DE v566: `_audioAutoUnlocked = true` se ponía en la
        // PRIMERA línea, antes de comprobar nada y sin mirar si el desbloqueo
        // había funcionado. El clic del login la quemaba y el aparato se quedaba
        // mudo el resto de la sesión, sin banner que lo dijera.
        const primeraSentencia = fnAuto.split('\n').filter(l =>
            l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l))[1] || '';
        ok('4c · 🔑 ya NO se marca "desbloqueado" antes de comprobar el audio',
           !/^\s*_audioAutoUnlocked = true;\s*$/.test(primeraSentencia), primeraSentencia.trim());
        ok('4d · 🔑 la bandera se decide MIRANDO el estado real del AudioContext',
           /_audioAutoUnlocked = _cronosAudioListo\(\)/.test(fnAuto));
        ok('4e · y un usuario que silenció a propósito se respeta',
           /if \(_alertsMuted\) return;/.test(fnAuto));
    }

    const fnListo = recorta(LIVE, 'function _cronosAudioListo(');
    ok('4f · 🔑 existe una única fuente de verdad sobre si el audio suena',
       !!fnListo && /_audioCtx\.state === "running"/.test(fnListo || ''));

    ok('4g · 🔑 se reintenta en CADA gesto, no sólo en el primero',
       /_autoUnlockOnFirstGesture, \{ once: false/.test(LIVE),
       (LIVE.match(/_autoUnlockOnFirstGesture, \{ once: \w+/) || ['(no aparece)'])[0]);

    // El banner de activación tiene que guiarse por lo mismo, o desaparece
    // cuando el audio sigue bloqueado — que es lo que pasaba en el iPad.
    const fnBanner = recorta(LIVE, 'function showBannerIfNeeded(');
    ok('4h · 🔑 el banner pregunta por el AudioContext, no por la bandera',
       !!fnBanner && /_cronosAudioListo\(\)/.test(fnBanner || ''),
       fnBanner || '(no se encontró showBannerIfNeeded)');
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE 5 · red de seguridad contra la pantalla congelada
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · resincronización ──');
{
    const fnResync = recorta(LIVE, 'async function _resincronizaVista(');
    ok('5a · existe _resincronizaVista', !!fnResync);
    if (fnResync) {
        ok('5b · repinta con lo último conocido ANTES de tocar la red',
           fnResync.indexOf('_liveLastData') < fnResync.indexOf('getDoc'));
        ok('5c · 🔑 relee el partido del servidor y rehace los watchers',
           /getDoc\(doc\(db, 'live_matches', currentMatchId\)\)/.test(fnResync) &&
           /refreshBackgroundWatchers\(\)/.test(fnResync));
        ok('5d · 🔑 no repinta el detalle si el usuario está en el LISTADO',
           /_enDetalleDePartido\(\)/.test(fnResync));
        ok('5e · es reentrante-segura (no se solapa consigo misma)',
           /_resyncEnCurso/.test(fnResync));
    }

    ok('5f · 🔑 se dispara al volver a primer plano y al recuperar la red',
       /visibilitychange[\s\S]{0,220}_resincronizaVista/.test(LIVE) &&
       /addEventListener\('online'[\s\S]{0,120}_resincronizaVista/.test(LIVE));

    const fnWatch = recorta(LIVE, 'function _startResyncWatchdog(');
    ok('5g · 🔑 hay un vigilante para el canal muerto', !!fnWatch);
    if (fnWatch) {
        ok('5h · que no actúa con la pestaña oculta ni fuera de un partido',
           /visibilityState !== 'visible'/.test(fnWatch) && /_enDetalleDePartido\(\)/.test(fnWatch));
        ok('5i · ni sobre un partido ya terminado (no late, y no es un fallo)',
           /status !== 'active'/.test(fnWatch));
    }
    ok('5j · el vigilante se levanta con la vigilancia de fondo',
       /_startAutonomousPhaseWatch\(\);[\s\S]{0,200}_startResyncWatchdog\(\);/.test(LIVE));
    ok('5k · el listener del partido visible deja constancia de cada snapshot',
       /_marcaSnapshotRecibido\(\);\s*\n\s*detectAndAlert\(matchId, data,/.test(LIVE));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
