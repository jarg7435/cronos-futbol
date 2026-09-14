// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v715 · LO REGISTRADO A POSTERIORI: NARANJA Y CON EL MARCADOR AL DÍA
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-14, capturas 10411-10414):
//
//   1 · «Cualquier suceso añadido a posteriori (comentarios, goles, tarjetas,
//       lesiones, cambios) debe mostrarse obligatoriamente en color naranja
//       tanto en los informes colectivos como en los individuales, para que el
//       cuerpo técnico y la dirección deportiva identifiquen claramente qué
//       datos se introdujeron de forma retroactiva».
//
//   2 · «Cuando se añade un gol mediante este formulario retroactivo, el
//       sistema debe actualizar de inmediato el tanteo global del partido y
//       modificar el resultado final del marcador (y las estadísticas
//       asociadas)».
//
//  🔑 LA MARCA YA VIAJABA; NADIE LA MIRABA. v531 la dejó en TRES formas según
//  por dónde pase el dato —`retro` (el suceso parseado del informe),
//  `isRetroactive` (el de `live_matches.events[]`) y el TEXTO `(RETRO)` /
//  `(Retroactivo)` (informes viejos e historial en crudo)— y sólo UN sitio la
//  leía: el cronograma del motor. El registro de incidencias, los comentarios,
//  el Área de Familias y las descargas la ignoraban.
//
//  🔑🔑 Y EL MARCADOR NO VIVE EN UN SOLO SITIO. v531 corregía `live_matches`
//  (lo que pinta el VISOR), pero el resultado de Mis Informes, del Panel de
//  Dirección y del Área de Familias sale de `cronos_player_reports`, con una
//  copia POR JUGADOR Y POR DESTINATARIO. Ese lado no lo tocaba nadie: el visor
//  decía 0-3 y el informe seguía diciendo 0-2.
//
//  LO QUE VIGILA:
//   A · UNA SOLA REGLA de «esto es retroactivo», y la copia privada del motor
//       —que es AUTOCONTENIDO y no puede llamar a utils.js— dice LO MISMO.
//   B · El registro de incidencias del informe colectivo lo pinta en naranja Y
//       lo dice con palabras (un informe se imprime en blanco y negro).
//   C · Los comentarios llegan al informe CON su marca (antes se perdía en
//       `cronosComentariosDelPartido`).
//   D · El Área de Familias y los ficheros descargados, igual.
//   E · El gol retroactivo corrige el marcador en TODAS las copias del informe
//       y la ficha del goleador en las SUYAS, en UN SOLO LOTE.
//   F · Y los comentarios no se filtran a las familias (política de v690).
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
// Las aserciones de texto miden CÓDIGO: en este proyecto los comentarios citan
// por su nombre lo que explican (verde falso pagado en v711, v713 y v714).
const sinComentarios = (s) => String(s || '').replace(/^\s*\/\/.*$/gm, '');

const UTILS  = leer('js/core/utils.js');
const ENGINE = leer('js/coach/reports/report-engine.js');
const PADRE  = leer('js/parent/panel.js');
const EXPORT = leer('js/coach/reports/reports-export.js');
const ACTION = leer('js/match/events/player-actions.js');
const RETRO  = leer('js/match/events/retroactive-modal.js');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 1 · [A] una sola regla, y el motor dice lo mismo ──');
// ═══════════════════════════════════════════════════════════════════════════
let ES_RETRO = null, ES_RETRO_MOTOR = null;
{
    const fn = trozo(UTILS, 'function cronosEsRetro(ev)');
    ok('1a · se encuentra cronosEsRetro en js/core/utils.js', !!fn);
    ok('1b · se publica UNA sola vez, con su color',
       (UTILS.match(/window\.cronosEsRetro\s*=/g) || []).length === 1 &&
       /window\.CRONOS_COLOR_RETRO\s*=/.test(UTILS));
    if (fn) {
        const ctx = { console, String };
        vm.createContext(ctx);
        vm.runInContext(fn + ';\n;globalThis.f = cronosEsRetro;', ctx);
        ES_RETRO = ctx.f;
    }

    const fnMotor = trozo(ENGINE, 'const esRetroEv = (ev) => {');
    ok('1c · se encuentra la copia privada del motor de informes', !!fnMotor);
    if (fnMotor) {
        const ctx2 = { console, String };
        vm.createContext(ctx2);
        vm.runInContext(fnMotor + ';\n;globalThis.f = esRetroEv;', ctx2);
        ES_RETRO_MOTOR = ctx2.f;
    }

    if (ES_RETRO && ES_RETRO_MOTOR) {
        const casos = [
            ['el suceso parseado del informe',        { type: 'goal', retro: true },           true],
            ['el suceso de live_matches.events[]',    { type: 'goal', isRetroactive: true },   true],
            ['🔑 el informe VIEJO, sólo con el texto', { type: 'goal', note: 'GOL a las 30:00 (1ªP) (RETRO)' }, true],
            ['🔑 y el texto largo «(Retroactivo)»',    { type: 'goal', text: 'GOL · BRUNO (Retroactivo)' },     true],
            ['un suceso normal',                      { type: 'goal', note: 'GOL a las 30:00 (1ªP)' },          false],
            ['un cambio del descanso no es retro',    { type: 'sub_out', note: 'Sale a las 30:00 (DESCANSO)' }, false],
            ['nada',                                  null,                                    false],
        ];
        let iguales = 0, aciertos = 0; const malos = [];
        casos.forEach(([etq, ev, esperado]) => {
            const a = ES_RETRO(ev), b = ES_RETRO_MOTOR(ev);
            if (a === b) iguales++; else malos.push('difieren: ' + etq);
            if (a === esperado) aciertos++; else malos.push('falla: ' + etq + ' → ' + a);
        });
        ok('1d · 🔑 acierta en las ' + casos.length + ' formas en que viaja la marca',
           aciertos === casos.length, malos.join(' || '));
        ok('1e · 🔑🔑 [A] la compartida y la del motor dan LO MISMO',
           iguales === casos.length, malos.join(' || '));
    }

    // El naranja es el mismo número en los dos ficheros.
    const cu = (UTILS.match(/const CRONOS_COLOR_RETRO = '([^']+)'/)  || [])[1];
    const cm = (ENGINE.match(/const RETRO_COLOR = '([^']+)'/)        || [])[1];
    ok('1f · 🔑 el naranja es EL MISMO en utils.js y en el motor',
       !!cu && cu === cm, 'utils=' + cu + ' motor=' + cm);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 2 · [B][C] el informe colectivo, EJECUTADO ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    // El motor entero, en un sandbox DESNUDO (como su propio guard): si
    // necesitara window/document, esto reventaría.
    const src = ENGINE;
    const s = src.indexOf('const _RP = (() => {');
    const e = src.indexOf('\n})();', s);
    const BLOQUE = s >= 0 && e > s ? src.slice(s, e + 6) : null;
    ok('2a · se encuentra el motor _RP', !!BLOQUE);

    if (BLOQUE) {
        const sb = { Math, Array, Object, String, Number, JSON, Date, Map, Set, parseInt, parseFloat, isNaN };
        vm.createContext(sb);
        vm.runInContext(BLOQUE + '\nthis.__rp = _RP;', sb);
        const RP = sb.__rp;

        const ev = (type, min, extra) => Object.assign(
            { type, minute: min, second: 0, timeStr: String(min).padStart(2, '0') + ':00' }, extra || {});

        const partido = {
            rival: 'CORRALILLOS', matchDate: '2026-09-14', myTeamRole: 'away',
            scoreHome: 0, scoreAway: 2, category: 'f11_regional',
            matchComments: [
                { id: 'c1', minute: 10, text: 'Nota en directo', realTime: '', createdAt: 1 },
                { id: 'c2', minute: 40, text: 'Nota apuntada despues', realTime: '', createdAt: 2, retro: true },
            ],
            players: [
                { playerAlias: 'BRUNO', playerNumber: '10', titular: true, goals: 2, history: [
                    ev('goal', 20, { note: 'GOL a las 20:00 (1ªP)' }),
                    ev('goal', 30, { note: 'GOL a las 30:00 (1ªP) (RETRO)', retro: true }),
                ] },
                { playerAlias: 'SANCHO', playerNumber: '3', titular: true, history: [
                    ev('yellow', 35, { note: 'TARJETA AMARILLA a las 35:00 (1ªP) (RETRO)', retro: true }),
                ] },
            ],
        };
        const html = RP.build(partido, { clubName: 'CD DÍA' });
        ok('2b · el informe se genera', typeof html === 'string' && html.length > 1000);

        // Las filas del registro cronológico llevan data-suceso; las retro, marca.
        const filas = html.split('data-suceso="').slice(1).map(t => t.slice(0, 900));
        const retros  = filas.filter(f => /data-retro="1"/.test(f));
        const normales = filas.filter(f => !/data-retro="1"/.test(f));
        ok('2c · 🔑🔑 [B] los sucesos retroactivos quedan marcados en el registro',
           retros.length === 3, 'marcados=' + retros.length + ' de ' + filas.length +
           ' (2 sucesos + 1 comentario)');
        // ⚠️ NO VALE con que el naranja aparezca EN ALGUNA PARTE de la fila:
        // la etiqueta y el minuto ya lo llevan, así que una mutación que
        // dejara el TEXTO del suceso con su color de siempre pasaba
        // desapercibida (verde falso cazado en el red-check). Lo que se exige
        // es que el suceso retroactivo NO se pinte con el color de su tipo.
        const COLORES_NORMALES = ['#3fb950', '#eab308', '#ff5858', '#ef4444', '#58a6ff', '#d2a8ff'];
        ok('2d · 🔑🔑 [B] y el TEXTO del suceso va en NARANJA, no en el color de su tipo',
           retros.length > 0 &&
           retros.every(f => (f.match(/#f5a623/g) || []).length >= 3) &&
           retros.every(f => !COLORES_NORMALES.some(c => f.indexOf('color:' + c + ';">') >= 0)),
           retros.map(f => (f.match(/color:[^;"]+/g) || []).join(',')).join(' || '));
        ok('2e · 🔑 y lo dicen con palabras (un informe se imprime sin color)',
           retros.every(f => /RETROACTIVO/.test(f)));
        ok('2f · ⚠️ y un suceso normal NO se pinta de naranja',
           normales.length > 0 && !normales.some(f => /#f5a623/.test(f)),
           'normales=' + normales.length);
        ok('2g · 🔑 [C] el comentario retroactivo también (el autor los nombra primeros)',
           retros.some(f => /comment/.test(f) && /Nota apuntada despues/.test(f)),
           retros.filter(f => /comment/.test(f)).length + ' comentarios marcados');
        ok('2h · ⚠️ el comentario en directo se queda como estaba',
           filas.some(f => /comment/.test(f) && /Nota en directo/.test(f) && !/data-retro/.test(f)));
        ok('2i · ⚠️ se conserva el tipo de suceso: sigue diciendo GOL y TARJETA',
           /GOL/.test(html) && /TARJETA/.test(html));
    }

    // La marca del comentario tiene que SALIR de donde se guarda.
    const fnCom = trozo(ACTION, 'window.cronosComentariosDelPartido = function (eventos)');
    ok('2j · 🔑 [C] cronosComentariosDelPartido propaga la marca al informe',
       !!fnCom && /retro:\s*e\.isRetroactive === true/.test(sinComentarios(fnCom)),
       'sin esto, la nota retroactiva llega al informe indistinguible');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 3 · [D] el informe individual y los ficheros ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const PAD = sinComentarios(PADRE);
    ok('3a · 🔑 [D] el Área de Familias resuelve la marca con la regla única',
       /window\.cronosEsRetro\(ev\)/.test(PAD) && /_esRetroPP/.test(PAD),
       'ignoraba la marca por completo');
    ok('3b · y la marca viaja con CADA suceso de la línea de tiempo',
       (PAD.match(/retro:\s*_esRetroPP\(ev\)/g) || []).length === 3,
       'gol/tarjeta/lesión, entrada y salida: ' +
       (PAD.match(/retro:\s*_esRetroPP\(ev\)/g) || []).length);
    ok('3c · 🔑🔑 [D] las filas de sucesos se pintan en naranja y lo dicen',
       /_COLOR_RETRO_PP/.test(PAD) && /RETROACTIVO/.test(PAD));
    ok('3d · 🔑 y el TXT descargado lo escribe (ahí no hay color)',
       /\[RETROACTIVO\]/.test(PAD));
    ok('3e · ⚠️ el naranja del panel sale de la constante compartida',
       /window\.CRONOS_COLOR_RETRO/.test(PAD));

    // Las descargas del entrenador y del Director: rxEtiquetaSuceso, ejecutada.
    const piezas = ['const RX_SUCESO = {', 'function _rxNota(e)',
                    'window.rxEtiquetaSuceso = function (e)'].map(a => trozo(EXPORT, a));
    ok('3f · se encuentran las piezas de la etiqueta de sucesos', piezas.every(Boolean));
    if (piezas.every(Boolean) && ES_RETRO) {
        const ctx = { console, String, window: { cronosEsRetro: ES_RETRO } };
        vm.createContext(ctx);
        vm.runInContext(piezas.join(';\n') + ';', ctx);
        const et = ctx.window.rxEtiquetaSuceso;
        ok('3g · 🔑🔑 [D] en el CSV y el TXT, el suceso retroactivo se dice',
           et({ type: 'goal', retro: true }) === 'Gol (retroactivo)',
           et({ type: 'goal', retro: true }));
        ok('3h · ⚠️ y el normal no cambia ni una letra',
           et({ type: 'goal' }) === 'Gol' && et({ type: 'injury' }) === 'Lesión');
        ok('3i · 🔑 los matices de v458 SOBREVIVEN al sello',
           et({ type: 'goal', note: 'GOL ANULADO (Quedan: 1)', retro: true }) === 'Gol anulado (retroactivo)' &&
           et({ type: 'goal', note: 'GOL ANULADO (Quedan: 1)' }) === 'Gol anulado',
           et({ type: 'goal', note: 'GOL ANULADO (Quedan: 1)', retro: true }));
        ok('3j · y el texto en crudo del informe viejo también lo activa',
           et({ type: 'red', note: 'TARJETA ROJA a las 30:00 (1ªP) (RETRO)' }) === 'Tarjeta roja (retroactivo)');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 4 · [E][F] el gol retroactivo corrige el INFORME ──');
// ═══════════════════════════════════════════════════════════════════════════
{
    const fn = trozo(RETRO, 'async function _corrigeInformesDelPartido(cambio)');
    ok('4a · se encuentra la corrección de informes', !!fn);

    if (fn) {
        // Arnés: los documentos que de verdad tiene un partido — una copia por
        // jugador y por destinatario (staff, entrenador y familia).
        const docs = [
            { id: 'M_staff_p10',  data: { playerNumber: '10', goals: 1, scoreHome: 0, scoreAway: 2, staffReport: true } },
            { id: 'M_coach_p10',  data: { playerNumber: '10', goals: 1, scoreHome: 0, scoreAway: 2, _forCoach: true } },
            { id: 'M_parent_p10', data: { playerNumber: '10', goals: 1, scoreHome: 0, scoreAway: 2, type: 'parent_player_report' } },
            { id: 'M_staff_p3',   data: { playerNumber: '3',  goals: 0, scoreHome: 0, scoreAway: 2, staffReport: true } },
            { id: 'M_coach_p3',   data: { playerNumber: '3',  goals: 0, scoreHome: 0, scoreAway: 2, _forCoach: true } },
            { id: 'M_parent_p3',  data: { playerNumber: '3',  goals: 0, scoreHome: 0, scoreAway: 2, type: 'parent_player_report' } },
        ];
        const montar = (opciones) => {
            const o = opciones || {};
            const escrituras = [];
            let lotes = 0, commits = 0;
            const ctx = {
                console: { warn() {}, log() {} }, String, Number, Object, Date,
                _targetMatchId: o.sinPartido ? null : 'M',
                window: { _cronos_auth: { db: {} }, _CRONOS_DEBUG: false },
            };
            ctx.__imp = async () => ({
                collection: (db, c) => ({ c }),
                where: (f, op, v) => ({ f, op, v }),
                query: (col, w) => ({ col, w }),
                getDocs: async () => ({
                    empty: o.vacio === true,
                    forEach: (cb) => { if (!o.vacio) docs.forEach(d => cb({ ref: d.id, data: () => d.data })); },
                }),
                writeBatch: () => { lotes++; return {
                    update: (ref, upd) => escrituras.push({ ref, upd }),
                    commit: async () => { commits++; if (o.commitFalla) throw new Error('denegado'); },
                }; },
                arrayUnion: (x) => ({ __arrayUnion: x }),
            });
            vm.createContext(ctx);
            vm.runInContext(fn.replace(/\bimport\s*\(/g, '__imp(') +
                            ';\n;globalThis.corrige = _corrigeInformesDelPartido;', ctx);
            return { ctx, escrituras, lotes: () => lotes, commits: () => commits };
        };

        (async () => {
            // ── El gol retroactivo de BRUNO (#10), del lado visitante ──
            const g = montar({});
            const okGol = await g.ctx.corrige({ tipo: 'goal', ladoGol: 'away', dorsal: '10',
                                                apunte: { type: 'goal', minute: 30, retro: true } });
            ok('4b · la corrección se da por buena', okGol === true);
            ok('4c · 🔑🔑 [E] el marcador se corrige en TODAS las copias del partido',
               g.escrituras.length === 6 &&
               g.escrituras.every(e => e.upd.scoreAway === 3) &&
               g.escrituras.every(e => e.upd.scoreHome === undefined),
               JSON.stringify(g.escrituras.map(e => e.upd.scoreAway)));
            ok('4d · 🔑 y el gol SÓLO se le suma al goleador, en sus tres copias',
               g.escrituras.filter(e => e.upd.goals === 2).length === 3 &&
               g.escrituras.filter(e => e.upd.goals !== undefined).length === 3,
               JSON.stringify(g.escrituras.map(e => [e.ref, e.upd.goals])));
            ok('4e · 🔑 el apunte entra en SU historial con la marca, por arrayUnion',
               g.escrituras.filter(e => e.upd.history &&
                                        e.upd.history.__arrayUnion &&
                                        e.upd.history.__arrayUnion.retro === true).length === 3);
            ok('4f · 🔑🔑 [E] y todo va en UN SOLO LOTE (o entero, o nada)',
               g.lotes() === 1 && g.commits() === 1);

            // ── El lado del gol manda: un gol local no toca scoreAway ──
            const l = montar({});
            await l.ctx.corrige({ tipo: 'goal', ladoGol: 'home', dorsal: '10' });
            ok('4g · ⚠️ un gol del LOCAL suma en scoreHome, no en el otro lado',
               l.escrituras.every(e => e.upd.scoreHome === 1 && e.upd.scoreAway === undefined));

            // ── Una tarjeta no toca el marcador ──
            const t = montar({});
            await t.ctx.corrige({ tipo: 'yellow', ladoGol: null, dorsal: '3' });
            ok('4h · ⚠️ una tarjeta retroactiva NO toca el marcador',
               t.escrituras.every(e => e.upd.scoreHome === undefined && e.upd.scoreAway === undefined) &&
               t.escrituras.length === 3 &&
               t.escrituras.every(e => e.upd.cards === 'amarilla'),
               JSON.stringify(t.escrituras.map(e => e.upd)));

            // ── [F] Los comentarios NO llegan a las familias (v690) ──
            const c = montar({});
            await c.ctx.corrige({ tipo: 'comment', comentario: { text: 'nota', retro: true } });
            ok('4i · 🔑🔑 [F] el comentario va a staff y entrenador, NUNCA a las familias',
               c.escrituras.length === 4 &&
               c.escrituras.every(e => String(e.ref).indexOf('parent') < 0),
               JSON.stringify(c.escrituras.map(e => e.ref)));

            // ── Un partido sin informes no es un fallo ──
            const v = montar({ vacio: true });
            ok('4j · ⚠️ un partido SIN informes devuelve éxito y no escribe nada',
               (await v.ctx.corrige({ tipo: 'goal', ladoGol: 'away', dorsal: '10' })) === true &&
               v.escrituras.length === 0 && v.lotes() === 0);

            // ── Si el servidor lo rechaza, se dice ──
            const f = montar({ commitFalla: true });
            ok('4k · 🔑 si el servidor deniega el lote, se devuelve FALLO (no se miente)',
               (await f.ctx.corrige({ tipo: 'goal', ladoGol: 'away', dorsal: '10' })) === false);

            // Y el enganche: el submit lo llama y avisa del resultado.
            const SUB = sinComentarios(RETRO);
            ok('4l · el guardado llama a la corrección de informes',
               /_corrigeInformesDelPartido\(\{/.test(SUB) &&
               /marcador e informe actualizados/.test(RETRO));
            ok('4m · 🔑 el lado del gol se calcula con la MISMA cuenta que el marcador del documento',
               /esRival \? \(miRol === 'away' \? 'home' : 'away'\)/.test(SUB) &&
               (SUB.match(/esRival \? \(miRol === 'away' \? 'home' : 'away'\)/g) || []).length === 2,
               'si divergieran, el informe sumaría el gol al equipo contrario');

            console.log('\n  ' + (total - fallos) + '/' + total + ' aserciones');
            if (fallos) { console.log('  ' + fallos + ' FALLOS'); process.exit(1); }
        })();
    }
}
