// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v707 · LA LOCALÍA: JUGAR FUERA NO PUEDE CAMBIAR QUIÉN SOY
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-13, CAPTURAS 10352-10361):
//  «revisar y corregir DE RAÍZ la logística de creación de partidos». Cuatro
//  síntomas, una sola causa de fondo:
//
//   1 · configurando su equipo como VISITANTE, su nombre se AUTORRELLENABA y
//       se DUPLICABA en el bando local («ARINAGA REGIONAL — ARINAGA REGIONAL»
//       en el marcador, capturas 10354/10355);
//   2 · ganando 0-3 fuera, el informe y el acumulado decían DERROTA
//       (capturas 10358/10359);
//   3 · las pérdidas/recuperaciones se asociaban a la plantilla del RIVAL —el
//       informe listaba «Local 1…18» en vez de sus jugadores—;
//   4 · los contadores de P/R no arrancaban a cero en un partido nuevo.
//
//  🔑🔑 LA CAUSA COMÚN: «mi equipo» y «el local» eran lo mismo en una docena
//  de sitios. `TEAM_NAMES.home`/`away` son los dos LADOS DEL ENCUENTRO, y
//  quién es quién lo dice `window._userTeamRole`. Y ese interruptor SE PERDÍA
//  en cada recarga, porque la ranura local del partido no lo guardaba (la
//  copia de la nube SÍ: dos caminos para lo mismo y sólo uno completo).
//
//  LO QUE VIGILA ESTE FICHERO, y por qué cada cosa se rompe sola:
//
//   A · UNA SOLA DEFINICIÓN DE «MI LADO». `cronosMiLado()` (utils.js) es la
//       fuente; `_cMyTeamKey()` (panel.js) delega. Con dos expresiones
//       equivalentes escritas aparte, el día que una cambie el informe y el
//       registro hablarán de equipos distintos — es la factura de v433.
//
//   B · EL CAMPO «RIVAL» DE LA CONVOCATORIA NO PUEDE TRAER MI NOMBRE. Era el
//       origen literal de la duplicación: se autorrellenaba con
//       `TEAM_NAMES.away`, que jugando fuera soy YO.
//
//   C · Y AUNQUE LO TRAIGA DE OTRO SITIO (una convocatoria guardada con la
//       versión anterior, el calendario, escrito a mano), no se copia al otro
//       bando. Segunda puerta, en el punto donde se hace el daño.
//
//   D · LA LOCALÍA VIAJA EN LA RANURA DEL PARTIDO. Es el arreglo de fondo: sin
//       `myTeamRole` guardado, retomar el partido lo convierte en un partido
//       de local, con los informes de la plantilla del rival.
//
//   E · EL INFORME PONE CADA NOMBRE EN SU LADO DEL MARCADOR. El marcador es
//       LOCAL – VISITANTE siempre; con mi club siempre en el hueco de LOCAL,
//       la cabecera contradecía a su propio veredicto.
//
//   F · «EL RIVAL» Y «EL VISITANTE» NO SON SINÓNIMOS, y los índices de
//       partidos terminados siguen necesitando los LADOS, no la perspectiva.
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
        if (detalle !== undefined) console.log('      ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

// Corta un trozo de código emparejando llaves desde el primer '{' tras `desde`.
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

const UTILS   = leer('js/core/utils.js');
const PANEL   = leer('js/coach/comms/panel.js');
const IMPORT  = leer('js/ai/import.js');
const APPINIT = leer('js/core/app-init.js');
const ENGINE  = leer('js/coach/reports/report-engine.js');
const AUTO    = leer('js/coach/comms/match-reports-auto.js');
const SEND    = leer('js/coach/comms/match-reports-send.js');
const COLEC   = leer('js/coach/comms/collective-report.js');
const INDIV   = leer('js/coach/comms/individual-reports.js');
const PERSIST = leer('js/match/persistence/team-persistence.js');
const TRACKER = leer('js/match/events/possession-tracker.js');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · los helpers de localía, EJECUTADOS ──');
// ═══════════════════════════════════════════════════════════════════════════
let H = null;
{
    const bloque = UTILS.slice(
        UTILS.indexOf('function _cronosNombresDeEquipo()'),
        UTILS.indexOf('window.cronosNombreRival      = cronosNombreRival;') + 60);
    ok('1a · el bloque de localía está en js/core/utils.js', bloque.length > 200);

    const ctx = { window: {}, console };
    vm.createContext(ctx);
    vm.runInContext(bloque, ctx);
    H = ctx.window;
    ok('1b · expone las cuatro funciones',
       typeof H.cronosMiLado === 'function' && typeof H.cronosLadoRival === 'function' &&
       typeof H.cronosMiNombreEquipo === 'function' && typeof H.cronosNombreRival === 'function');

    const conRol = (rol, home, away) => {
        ctx.window._userTeamRole = rol;
        ctx.window.TEAM_NAMES = { home: home, away: away };
        return {
            mio:    H.cronosMiLado(),
            suyo:   H.cronosLadoRival(),
            nombre: H.cronosMiNombreEquipo(),
            rival:  H.cronosNombreRival(),
        };
    };

    const fuera = conRol('away', 'LOCAL', 'ARINAGA REGIONAL');
    ok('1c · [DEFECTO 1] de VISITANTE, mi lado es "away" y mi nombre el del away',
       fuera.mio === 'away' && fuera.suyo === 'home' && fuera.nombre === 'ARINAGA REGIONAL',
       JSON.stringify(fuera));
    ok('1d · 🔑 y el RIVAL sale vacío mientras el otro lado sea el rótulo de fábrica',
       fuera.rival === '',
       'era justo lo que autorrellenaba mi propio nombre como rival: ' + JSON.stringify(fuera));

    const fuera2 = conRol('away', 'MASPALOMAS', 'ARINAGA REGIONAL');
    ok('1e · con rival de verdad, el rival es el LOCAL (no el visitante)',
       fuera2.rival === 'MASPALOMAS' && fuera2.nombre === 'ARINAGA REGIONAL',
       JSON.stringify(fuera2));

    const casa = conRol('home', 'ARINAGA REGIONAL', 'MASPALOMAS');
    ok('1f · en casa, todo como siempre',
       casa.mio === 'home' && casa.nombre === 'ARINAGA REGIONAL' && casa.rival === 'MASPALOMAS',
       JSON.stringify(casa));

    const sinRol = conRol(undefined, 'ARINAGA REGIONAL', 'VISITANTE');
    ok('1g · sin interruptor se juega de LOCAL (comportamiento de siempre)',
       sinRol.mio === 'home' && sinRol.rival === '');

    ok('1h · "Local"/"Visitante" se reconocen como hueco, con cualquier caja',
       H.cronosNombreDeFabrica('LOCAL') && H.cronosNombreDeFabrica(' visitante ') &&
       !H.cronosNombreDeFabrica('CD LOCALIDAD'));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [DEFECTO A] una sola definición de «mi lado» ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fn = trozo(PANEL, 'function _cMyTeamKey()');
    ok('2a · se encuentra _cMyTeamKey', !!fn);
    if (fn && H) {
        const ctx = { window: { cronosMiLado: () => 'away' }, console };
        vm.createContext(ctx);
        vm.runInContext(fn + '\n;globalThis.key = _cMyTeamKey;', ctx);
        ok('2b · 🔑 _cMyTeamKey DELEGA en cronosMiLado (no tiene su propia regla)',
           ctx.key() === 'away',
           'con dos definiciones, informe y registro acabarían en equipos distintos (v433)');

        const ctx2 = { window: { _userTeamRole: 'away' }, console };
        vm.createContext(ctx2);
        vm.runInContext(fn + '\n;globalThis.key = _cMyTeamKey;', ctx2);
        ok('2c · y si utils.js no hubiera cargado, el respaldo sigue acertando',
           ctx2.key() === 'away',
           'sin respaldo, un orden de scripts distinto dejaría los informes SIN jugadores');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · la convocatoria: [DEFECTO B] y [DEFECTO C] ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const bloque = IMPORT.slice(IMPORT.indexOf('function _convMiNombre()'),
                                IMPORT.indexOf("const modal = document.getElementById('setup-modal');"));
    ok('3a · se encuentran los helpers de la convocatoria', bloque.length > 200);

    const ctx = {
        window: {},
        TEAM_NAMES: { home: 'LOCAL', away: 'ARINAGA REGIONAL' },
        escapeHtml: s => String(s),
        console,
    };
    // Los helpers de utils.js, tal cual (la convocatoria los llama por window).
    const utilsBloque = UTILS.slice(
        UTILS.indexOf('function _cronosNombresDeEquipo()'),
        UTILS.indexOf('window.cronosNombreRival      = cronosNombreRival;') + 60);
    vm.createContext(ctx);
    vm.runInContext(utilsBloque, ctx);
    ctx.window.TEAM_NAMES = ctx.TEAM_NAMES;
    ctx.window._userTeamRole = 'away';
    vm.runInContext(bloque + '\n;globalThis.mio = _convMiNombre;' +
                             '\n;globalThis.riv = _convRivalPorDefecto;', ctx);

    ok('3b · [DEFECTO 1] el TÍTULO de la convocatoria es MI equipo, no el local',
       ctx.mio() === 'ARINAGA REGIONAL',
       'jugando fuera salía «Convocatoria — LOCAL» sobre mi propia plantilla');

    ok('3c · 🔑🔑 [DEFECTO B] el campo «Rival» NO se autorrellena con mi nombre',
       ctx.riv({}) === '',
       'aquí nacía la duplicación: devolvió "' + ctx.riv({}) + '"');

    ok('3d · un rival guardado de verdad SÍ se conserva',
       ctx.riv({ rival: 'MASPALOMAS' }) === 'MASPALOMAS');

    ok('3e · pero un rival guardado que ES MI NOMBRE se descarta',
       ctx.riv({ rival: 'arinaga regional' }) === '',
       'las convocatorias guardadas antes de v707 llevan ese dato envenenado');

    ctx.window.TEAM_NAMES.home = 'MASPALOMAS';
    ok('3f · con nombre real en el otro lado, ése es el rival por defecto',
       ctx.riv({}) === 'MASPALOMAS');
}

// ── [DEFECTO C] la segunda puerta: heredar el rival al partido ──
{
    const fn = trozo(IMPORT, 'function _convHeredarRivalAlPartido()');
    ok('3g · se encuentra _convHeredarRivalAlPartido', !!fn);
    if (fn) {
        const correr = (rol, nombres, rival) => {
            const inputs = {};
            const rotulos = {};
            const ctx = {
                console: { warn: () => {}, log: () => {} },
                TEAM_NAMES: Object.assign({}, nombres),
                document: {
                    getElementById: id => {
                        if (id === 'conv-rival') return { value: rival };
                        if (/^setup-(home|away)-name$/.test(id)) {
                            inputs[id] = inputs[id] || { value: '' };
                            return inputs[id];
                        }
                        if (/^team-[ab]-name$/.test(id)) {
                            rotulos[id] = rotulos[id] || { textContent: '' };
                            return rotulos[id];
                        }
                        return null;
                    }
                },
                window: { _userTeamRole: rol },
                String,
            };
            ctx.window.window = ctx.window;
            vm.createContext(ctx);
            vm.runInContext(fn + '\n;globalThis.heredar = _convHeredarRivalAlPartido;', ctx);
            const res = ctx.heredar();
            return { res, nombres: ctx.TEAM_NAMES, inputs, rotulos };
        };

        // El caso del reporte: juego fuera, y el "rival" es mi propio nombre.
        const malo = correr('away', { home: 'LOCAL', away: 'ARINAGA REGIONAL' }, 'ARINAGA REGIONAL');
        ok('3h · 🔑🔑 [DEFECTO C] no se copia MI nombre al bando contrario',
           malo.res === '' && malo.nombres.home === 'LOCAL',
           'quedó home="' + malo.nombres.home + '": es el marcador con el mismo nombre dos veces');

        // Y el camino bueno sigue funcionando (v667).
        const bueno = correr('away', { home: 'LOCAL', away: 'ARINAGA REGIONAL' }, 'Maspalomas');
        ok('3i · de visitante, el rival de verdad va al bando LOCAL',
           bueno.nombres.home === 'MASPALOMAS' && bueno.nombres.away === 'ARINAGA REGIONAL',
           JSON.stringify(bueno.nombres));
        ok('3j · …y también a su casilla del menú y a su rótulo del marcador',
           (bueno.inputs['setup-home-name'] || {}).value === 'MASPALOMAS' &&
           (bueno.rotulos['team-a-name'] || {}).textContent === 'MASPALOMAS');

        const casa = correr('home', { home: 'ARINAGA REGIONAL', away: 'VISITANTE' }, 'Maspalomas');
        ok('3k · en casa, el rival sigue yendo al bando VISITANTE',
           casa.nombres.away === 'MASPALOMAS' && casa.nombres.home === 'ARINAGA REGIONAL');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · [DEFECTO D] la localía viaja en la ranura del partido ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fn = APPINIT.slice(APPINIT.indexOf('function _saveMatchStateToStorage()'),
                             APPINIT.indexOf('window._saveMatchStateToStorage = _saveMatchStateToStorage;'));
    ok('4a · se encuentra el autoguardado de la ranura', fn.length > 400);

    const guardar = (rol, analiza) => {
        let escrito = null;
        const ctx = {
            console,
            matchPhase: '1st_half',
            isRunning: true,
            masterTimeH1: 100, masterTimeH2: 0,
            half1MaxTime: 1800, half2MaxTime: 1800,
            TEAM_NAMES: { home: 'LOCAL', away: 'ARINAGA REGIONAL' },
            currentMode: 'f11',
            liveMatchId: 'm1',
            COLORS: {},
            analyzeAway: analiza,
            _slots: () => ({ leer: () => null, guardar: (id, st) => { escrito = st; } }),
            _miSlotId: () => 'slot1',
            _equipoDelPartidoEnMemoria: () => 'eq1',
            document: { getElementById: () => ({ textContent: '0', value: '' }) },
            window: { _userTeamRole: rol, players: [], _cronosExtraGoals: { home: 0, away: 0 } },
            JSON, Date, Object, Array, String, Number,
        };
        vm.createContext(ctx);
        vm.runInContext(fn + '\n;globalThis.guardar = _saveMatchStateToStorage;', ctx);
        ctx.guardar();
        return escrito;
    };

    const st = guardar('away', false);
    ok('4b · 🔑🔑 la ranura guarda `myTeamRole`',
       st && st.myTeamRole === 'away',
       'sin esto, retomar el partido lo convierte en un partido de LOCAL: ' + JSON.stringify(st && st.myTeamRole));
    ok('4c · y también `analyzeAway` (la banca y el campo dependen de él)',
       st && st.analyzeAway === false);
    const st2 = guardar('home', true);
    ok('4d · en casa se guarda "home"', st2 && st2.myTeamRole === 'home' && st2.analyzeAway === true);
}

{
    const ini = APPINIT.indexOf('// Restaurar variables globales y sumar tiempo transcurrido');
    const fin = APPINIT.indexOf('const rawPlayers = state.players || [];');
    ok('4e · se encuentra el bloque de restauración', ini > 0 && fin > ini);

    const restaurar = (state) => {
        const clases = new Set();
        const ctx = {
            console,
            state,
            TEAM_NAMES: { home: '', away: '' },
            currentMode: 'f7',
            analyzeAway: true,
            document: {
                body: {
                    classList: {
                        add: c => clases.add(c),
                        remove: c => clases.delete(c),
                        toggle: (c, on) => { if (on) clases.add(c); else clases.delete(c); },
                        contains: c => clases.has(c),
                    }
                }
            },
            window: {},
        };
        vm.createContext(ctx);
        vm.runInContext(APPINIT.slice(ini, fin), ctx);
        return { rol: ctx.window._userTeamRole, analiza: ctx.analyzeAway, clases };
    };

    const r = restaurar({ teamNames: { home: 'LOCAL', away: 'ARINAGA REGIONAL' },
                          myTeamRole: 'away', analyzeAway: true, currentMode: 'f11' });
    ok('4f · 🔑🔑 [DEFECTO D] al retomar, `_userTeamRole` vuelve a ser "away"',
       r.rol === 'away',
       'es la causa de los informes con la plantilla del rival y del 0-3 leído como derrota');
    ok('4g · y el <body> recupera role-away y mode-f11',
       r.clases.has('role-away') && r.clases.has('mode-f11') && !r.clases.has('hide-visitor'),
       [...r.clases].join(','));

    const r2 = restaurar({ teamNames: {}, myTeamRole: 'home', analyzeAway: false, currentMode: 'f7' });
    ok('4h · sin analizar al contrario se oculta la otra banca, y en casa no hay role-away',
       r2.clases.has('hide-visitor') && !r2.clases.has('role-away') && !r2.clases.has('mode-f11'));

    const r3 = restaurar({ teamNames: {} });     // ranura vieja, anterior a v707
    ok('4i · ⚠️ una ranura ANTIGUA (sin el campo) no machaca el rol en memoria',
       r3.rol === undefined,
       'las ranuras guardadas antes de v707 no lo llevan; imponerles "home" sería peor');
    ok('4j · ⚠️ …ni le esconde la banca del rival por suponer que no se analizaba',
       !r3.clases.has('hide-visitor') && !r3.clases.has('role-away'),
       [...r3.clases].join(','));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · [DEFECTO E] el informe pone cada nombre en su lado ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fn = trozo(ENGINE, 'const buildHeader = (m, clubName, totMin, stopMin) =>');
    ok('5a · se encuentra buildHeader', !!fn);
    if (fn) {
        const ctx = { esc: s => String(s == null ? '' : s), Date, console, String };
        vm.createContext(ctx);
        vm.runInContext(fn + ';\n;globalThis.header = buildHeader;', ctx);

        const fuera = ctx.header({ rival: 'MASPALOMAS', scoreHome: 0, scoreAway: 3,
                                   myTeamRole: 'away', matchDate: '2026-09-13' },
                                 'ARINAGA REGIONAL', 90, 0);
        const trasEtiqueta = (html, etq) => {
            const i = html.indexOf('>' + etq + '<');
            return i < 0 ? '' : (html.slice(i).match(/font-weight:700;color:white;">([^<]*)</) || [])[1] || '';
        };
        ok('5b · 🔑🔑 ganando 0-3 FUERA, el veredicto es VICTORIA',
           /VICTORIA/.test(fuera) && !/DERROTA/.test(fuera),
           'es el defecto de la captura 10359');
        ok('5c · 🔑 y el LOCAL es el rival, no mi club',
           trasEtiqueta(fuera, 'LOCAL') === 'MASPALOMAS' &&
           trasEtiqueta(fuera, 'VISITANTE') === 'ARINAGA REGIONAL',
           'LOCAL=' + trasEtiqueta(fuera, 'LOCAL') + ' · VISITANTE=' + trasEtiqueta(fuera, 'VISITANTE'));
        ok('5d · el marcador sigue leyéndose LOCAL – VISITANTE', /0 – 3/.test(fuera));

        const casa = ctx.header({ rival: 'MASPALOMAS', scoreHome: 3, scoreAway: 0,
                                  myTeamRole: 'home', matchDate: '2026-09-13' },
                                'ARINAGA REGIONAL', 90, 0);
        ok('5e · en casa, todo como siempre (mi club de local y VICTORIA)',
           trasEtiqueta(casa, 'LOCAL') === 'ARINAGA REGIONAL' &&
           trasEtiqueta(casa, 'VISITANTE') === 'MASPALOMAS' && /VICTORIA/.test(casa));

        const viejo = ctx.header({ rival: 'MASPALOMAS', scoreHome: 2, scoreAway: 1,
                                   matchDate: '2026-09-13' }, 'ARINAGA REGIONAL', 90, 0);
        ok('5f · ⚠️ un informe ANTIGUO sin myTeamRole se pinta como antes',
           trasEtiqueta(viejo, 'LOCAL') === 'ARINAGA REGIONAL' && /VICTORIA/.test(viejo));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 6 · [DEFECTO F] «rival» ≠ «visitante» en los despachos ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // 🔑 Ninguno de los cuatro flujos puede volver a tomar el rival de
    //    `TEAM_NAMES.away` a secas: acierta en casa y falla fuera.
    const sinComentarios = t => t.split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    [['match-reports-auto.js', AUTO], ['match-reports-send.js', SEND],
     ['collective-report.js', COLEC], ['individual-reports.js', INDIV]].forEach(([nombre, src]) => {
        const s = sinComentarios(src);
        ok('6a · ' + nombre + ' saca el rival de cronosNombreRival()',
           /cronosNombreRival\(\)/.test(s));
        ok('6b · ' + nombre + ' ya no lo deduce sólo de TEAM_NAMES.away',
           !/const\s+rival(Name)?\s*=\s*\(?\s*(typeof\s+TEAM_NAMES[^\n]*)?TEAM_NAMES\.away\s*\)?\s*(\|\||\?)/.test(s) ||
           /cronosNombreRival/.test(s));
    });

    // Y los índices de partidos terminados siguen guardando LOS LADOS: la lista
    // pinta «homeName vs awayName», no «yo vs el rival».
    [['match-reports-auto.js', AUTO], ['match-reports-send.js', SEND],
     ['collective-report.js', COLEC]].forEach(([nombre, src]) => {
        ok('6c · ' + nombre + ' indexa awayName con el LADO visitante',
           /awayName:\s*\(typeof TEAM_NAMES !== 'undefined' && TEAM_NAMES\.away\)/.test(src),
           'con `awayName: rivalName` el índice se queda con mi nombre en los dos lados');
    });

    // El resumen post-partido cuenta MI plantilla, no la del que sea local.
    ok('6d · [captura 10355] el resumen post-partido cuenta los MÍOS',
       /const _miLado = \(typeof window\.cronosMiLado === 'function'\)/.test(PERSIST) &&
       /_mios = \(players \|\| \[\]\)\.filter\(p => p && p\.team === _miLado\)/.test(PERSIST),
       'antes contaba `p.team === "home"`: los 18 genéricos del rival');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 6 bis · el campo entero es de MI equipo ──');
// ═══════════════════════════════════════════════════════════════════════════
//  Capturas 10360/10361: jugando fuera y sin analizar al contrario, sus once
//  salían apiñados en media cancha con la otra mitad vacía. `preset.full` /
//  `FORMATIONS_FULL` estaban reservados a `p.team === 'home'`.
{
    const FORM = leer('js/roster/formations.js');
    const LEG  = leer('js/roster/legacy-formations.js');

    // ── El preset moderno, EJECUTADO ──
    const fn = trozo(FORM, 'function applyFormationPreset(key)');
    ok('6e · se encuentra applyFormationPreset', !!fn);
    if (fn) {
        const correr = (rol, analiza, equipoDeMisJugadores) => {
            const players = [
                { id: 1, number: 1, status: 'field', team: equipoDeMisJugadores, titularOrder: 0, x: 0, y: 0 },
                { id: 2, number: 2, status: 'field', team: equipoDeMisJugadores, titularOrder: 1, x: 0, y: 0 },
            ];
            const ctx = {
                console: { log: () => {}, warn: () => {} },
                players,
                currentMode: 'f7',
                analyzeAway: analiza,
                activeFormationKey: '',
                clampToField: (x, y) => ({ x, y }),
                FORMATION_PRESETS: { f7: { '231': {
                    full: [{ x: 5, y: 50 }, { x: 25, y: 30 }],
                    home: [{ x: 10, y: 50 }, { x: 20, y: 30 }],
                    away: [{ x: 90, y: 50 }, { x: 80, y: 30 }],
                } } },
                document: {
                    querySelectorAll: () => [],
                    getElementById: () => null,
                },
                // Los efectos de pantalla no interesan aquí: lo que se mide son
                // las coordenadas que quedan en cada jugador.
                renderPlayers: () => {},
                sortBenchUI: () => {},
                showToast: () => {},
                window: { _userTeamRole: rol },
                Object, Array, String, Number,
            };
            vm.createContext(ctx);
            vm.runInContext(fn + '\n;globalThis.aplicar = applyFormationPreset;', ctx);
            ctx.aplicar('231');
            return players.map(p => p.x);
        };

        ok('6f · 🔑 de VISITANTE y sin rival dibujado, mi equipo ocupa el campo ENTERO',
           JSON.stringify(correr('away', false, 'away')) === JSON.stringify([5, 25]),
           'salió ' + JSON.stringify(correr('away', false, 'away')) + ' (la mitad visitante sería [90,80])');
        ok('6g · con el rival dibujado, cada uno a su mitad',
           JSON.stringify(correr('away', true, 'away')) === JSON.stringify([90, 80]));
        ok('6h · en casa, como siempre',
           JSON.stringify(correr('home', false, 'home')) === JSON.stringify([5, 25]) &&
           JSON.stringify(correr('home', true, 'home')) === JSON.stringify([10, 20]));
    }

    // ── Y el colocador de arranque (placeOnField), que es otro fichero ──
    const fnL = trozo(LEG, 'function placeOnField(chip, player)');
    ok('6i · se encuentra placeOnField', !!fnL);
    if (fnL) {
        const correr = (rol, analiza, equipo) => {
            const jugador = { id: 1, number: 1, status: 'field', team: equipo, x: 0, y: 0 };
            const ctx = {
                console: { log: () => {}, warn: () => {} },
                players: [jugador],
                currentMode: 'f7',
                analyzeAway: analiza,
                clampToField: (x, y) => ({ x, y }),
                FORMATIONS_FULL: { f7: { home: [{ x: 5, y: 50 }] } },
                FORMATIONS:      { f7: { home: [{ x: 10, y: 50 }], away: [{ x: 90, y: 50 }] } },
                window: { _userTeamRole: rol },
                Object, Array, String, Number,
            };
            vm.createContext(ctx);
            vm.runInContext(fnL + '\n;globalThis.colocar = placeOnField;', ctx);
            ctx.colocar({ style: {} }, jugador);
            return jugador.x;
        };
        ok('6j · 🔑 de VISITANTE sin rival, el arranque usa el campo ENTERO',
           correr('away', false, 'away') === 5,
           'salió x=' + correr('away', false, 'away') +
           ' · ⚠️ FORMATIONS_FULL sólo tiene clave "home": pedirle ["away"] deja a todos en el centro');
        ok('6k · con rival dibujado, mi equipo a su mitad',
           correr('away', true, 'away') === 90);
        ok('6l · en casa, como siempre',
           correr('home', false, 'home') === 5 && correr('home', true, 'home') === 10);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 7 · el registro de P/R comparte la misma definición ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    ok('7a · possession-tracker delega en cronosMiLado()',
       /if \(typeof window\.cronosMiLado === 'function'\) return window\.cronosMiLado\(\);/
           .test(TRACKER.slice(TRACKER.indexOf('function _miEquipo()'),
                               TRACKER.indexOf('function _misJugadoresEnCampo()'))),
       'el registro y el informe tienen que hablar del MISMO equipo');

    ok('7b · y expone la puesta a cero de un partido nuevo',
       /window\.cronosPRNuevoPartido = function/.test(TRACKER));

    ok('7c · 🔑 el arranque de un partido NUEVO la llama',
       /cronosPRNuevoPartido\(\)/.test(APPINIT) &&
       APPINIT.indexOf('cronosPRNuevoPartido()') > APPINIT.indexOf('function _cronosNuevoPartidoDeEquipo()'),
       'sin esto, las P/R del partido anterior cuentan en el informe del siguiente');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
process.exit(fallos ? 1 : 0);
