// ─────────────────────────────────────────────────────────────────────────
// test_informe_colectivo_entrenador.js · el ENTRENADOR ve su informe
// colectivo, y es el MISMO que el del Director y el Coordinador (v507)
//
// Encargo del autor (implementar.txt, 2026-08-11): "el informe colectivo debe
// estar disponible inmediatamente en Mis Informes del entrenador que dirigió
// el encuentro, y no puede ser una versión reducida". Su hipótesis era que el
// informe "se guarda pero no se indexa en la ruta del entrenador".
//
// ⚠️ SU HIPOTESIS ERA MEDIA VERDAD. El despacho automatico SI escribia la
// copia del entrenador (FASE C). Lo que fallaba eran TRES cosas distintas:
//
//  🔑🔑🔑 1) LA COPIA DEL ENTRENADOR SE ESCRIBE LA ULTIMA, y todo lo de en
//      medio podia matarla. El `setDoc` de la notificacion al staff estaba
//      SIN try, igual que la resolucion de padres destinatarios: un
//      permission-denied con UN solo miembro del staff saltaba al catch
//      general de la funcion y se llevaba por delante la FASE C. Los informes
//      del staff (FASE A) ya estaban escritos ANTES, asi que por ese lado no
//      se notaba nada. Cuadro exacto del reporte: "les llega a ellos y a mi
//      no".
//
//  🔑🔑 2) EL ENVIO MANUAL DEL COLECTIVO NO ESCRIBIA NADA PARA EL ENTRENADOR.
//      Escribia los documentos del staff y, para el entrenador, SOLO un
//      `cronos_notifications`. Pero "Mis Informes" lee `cronos_player_reports`
//      filtrando `_forCoach === true`: una notificacion en otra coleccion no
//      alimenta esa pestaña. El comentario del codigo afirmaba que si, y el
//      texto de la pantalla vacia lo promete ("...y al enviar el Informe
//      Colectivo"). Era falso desde que se escribio.
//
//  🔑 3) EL FILTRO POR EQUIPO LE OCULTABA LO SUYO. "Mis Informes" descarta el
//      documento cuando su clave de equipo no se resuelve, y esa clave sale de
//      `window._currentMatchCategory`, que puede estar vacia. Un informe bien
//      guardado quedaba INVISIBLE PARA SU PROPIO AUTOR.
//
// ⚠️ LO QUE **NO** ERA: los cinco campos "ricos" del envio manual (venue,
// competition, matchTime, duration, stoppageTime) NO son una diferencia real —
// `window.matchVenue` y compañia NO SE ASIGNAN EN NINGUN SITIO del proyecto
// (ya documentado en report-engine.js), asi que se escriben vacios en las dos
// rutas. Perseguir eso habria sido trabajo inutil.
//
// ESTE GUARD EJECUTA EL CODIGO REAL de las dos rutas de escritura en una caja
// de arena (mismo arnes que test_match_reports_auto_module.js: el `import()`
// dinamico del SDK se sustituye por un Firestore de mentira que REGISTRA lo
// escrito), y ejecuta ademas el predicado de filtrado real de "Mis Informes".
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const AUTO_SRC = fs.readFileSync(path.join(ROOT, 'js/coach/comms/match-reports-auto.js'), 'utf8');
const COLL_SRC = fs.readFileSync(path.join(ROOT, 'js/coach/comms/collective-report.js'), 'utf8');
const MIS_SRC  = fs.readFileSync(path.join(ROOT, 'js/coach/comms/individual-reports.js'), 'utf8');

const mkEl = () => ({ innerHTML: '', value: '', textContent: '', style: {}, dataset: {} });

// ── Firestore de mentira: registra lo escrito y puede fallar SELECTIVAMENTE ──
function nuevoFirestore(fallaSi) {
    const escrito = [];
    return {
        escrito,
        api: {
            collection: (db, n) => ({ __col: n }),
            query: (c, ...w) => ({ __col: c.__col, w }),
            where: (f, o, v) => ({ f, o, v }),
            getDocs: async () => ({ forEach: () => {} }),
            doc: (db, col, id) => ({ __col: col, __id: id }),
            getDoc: async () => ({ exists: () => false, data: () => undefined }),
            setDoc: async (ref, data) => {
                if (fallaSi && fallaSi(ref, data)) {
                    const e = new Error('Missing or insufficient permissions.');
                    e.code = 'permission-denied';
                    throw e;
                }
                escrito.push({ col: ref.__col, id: ref.__id, data });
            },
            updateDoc: async (ref) => {
                const e = new Error('No document to update');
                e.code = 'not-found';
                throw e;   // fuerza el camino setDoc del hilo, como en produccion
            },
            arrayUnion: (...i) => ({ __arrayUnion: i }),
        }
    };
}

const YO = { uid: 'coach1', email: 'e@e.com', clubId: 'club1', category: 'Alevin', subcategory: 'A' };
const JUGADORES = [
    { name: 'Ana', alias: 'Ana', number: '7', team: 'home', time: 3000, goals: 1, cards: 'ninguna', history: [] },
    { name: 'Leo', alias: 'Leo', number: '9', team: 'home', time: 1800, goals: 0, cards: 'ninguna', history: [] },
];

function baseSandbox(fs2, extra) {
    const els = {};
    const el = (id) => (els[id] = els[id] || mkEl());
    el('score-home').textContent = '2';
    el('score-away').textContent = '1';
    const store = {};
    const sb = {
        _cronosCurrentUser: JSON.parse(JSON.stringify(YO)),
        _cronos_auth: { db: {} },
        players: JSON.parse(JSON.stringify(JUGADORES)),
        liveMatchId: null,
        _currentMatchCategory: 'Alevin',
        currentCategory: 'Alevin',
        currentMode: 'f11',
        TEAM_NAMES: { home: 'CD Local', away: 'CD Rival' },
        document: { getElementById: (id) => el(id) },
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        parseInt, isNaN, RegExp, Error,
        setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
        },
        emailConfig: { contacts: [] },
        escapeHtml: (s) => String(s == null ? '' : s),
        formatTime: (s) => String(Math.floor((s || 0) / 60)),
        showToast: () => {},
        hideSpinner: () => {}, showSpinner: () => {},
        loadEmailConfig: async () => {},
        openUnifiedCommsMenu: () => {},
        _cGetStaff: async () => [{ uid: 'dir1', role: 'director', email: 'd@d.com' }],
        _cMatchSubcatFor: () => 'A',
        _cMyTeamKey: () => 'home',
        _cResolveClubId: async () => 'club1',
        _cStaffThreadId: (c, a, b) => 'th_' + c + '_' + a + '_' + b,
        _cronosResolveParentReportTargets: () => [],
        _parseHistoryForFirestore: (raw) => (Array.isArray(raw) ? raw : []),
        cronosTeamId: (c, cat, sub) => (c && cat ? c + '__' + cat + '__' + (sub || '') : ''),
        // Las dos rutas cargan el SDK de forma DISTINTA: el despacho
        // automático con `import()` dinámico (sustituido por __imp) y el envío
        // manual con el helper `_cFS()`. Hacen falta las dos puertas.
        __imp: async () => fs2.api,
        _cFS: async () => Object.assign({ db: {} }, fs2.api),
    };
    Object.assign(sb, extra || {});
    vm.createContext(sb);
    sb.window = sb;
    sb.globalThis = sb;
    return sb;
}

// Extrae `function NOMBRE` / `NOMBRE = async function` contando llaves.
function extraeDesde(src, ancla) {
    const ini = src.indexOf(ancla);
    if (ini === -1) return null;
    const abre = src.indexOf('{', ini);
    let n = 0;
    for (let i = abre; i < src.length; i++) {
        if (src[i] === '{') n++;
        else if (src[i] === '}') { n--; if (n === 0) return src.slice(ini, i + 1); }
    }
    return null;
}

console.log('── el informe colectivo del ENTRENADOR (v507) ──\n');

const SRC_AUTO = extraeDesde(AUTO_SRC, 'async function autoDispatchMatchReports()');
// OJO: anclar en la DEFINICION, no en la primera mención (hay comentarios y
// un onclick con ese mismo nombre antes).
const SRC_COLL = extraeDesde(COLL_SRC, 'window._sendCollectiveReportNow = async function()');
ok('0 · se pueden extraer las dos rutas de escritura', !!SRC_AUTO && !!SRC_COLL,
   'auto=' + !!SRC_AUTO + ' manual=' + !!SRC_COLL);
if (!SRC_AUTO || !SRC_COLL) process.exit(1);

const rptsDe = (escrito, pred) =>
    escrito.filter(w => w.col === 'cronos_player_reports' && pred(w.data));
const delEntrenador = (e) => rptsDe(e, d => d._forCoach === true);
const delStaff      = (e) => rptsDe(e, d => d.staffReport === true);

(async () => {

// ═══ PARTE 1 · EL CASO DEL REPORTE: falla el aviso al staff ═══
console.log('── PARTE 1 · un fallo con el staff NO puede dejar sin informe al entrenador ──');
{
    // Falla SOLO la notificacion al staff (permission-denied), como en el
    // cuadro reportado. Los informes de staff (FASE A) ya se escribieron.
    const f = nuevoFirestore((ref) => ref.__col === 'cronos_notifications' && /notif_global_rpt_/.test(ref.__id));
    const sb = baseSandbox(f);
    vm.runInContext(SRC_AUTO.replace(/\bimport\s*\(/g, '__imp('), sb);
    await sb.autoDispatchMatchReports();

    const staff = delStaff(f.escrito);
    const coach = delEntrenador(f.escrito);
    ok('1a · el staff sí recibe sus informes (como en el reporte)',
       staff.length === JUGADORES.length, 'staff=' + staff.length);
    ok('1b · 🔑🔑🔑 y el ENTRENADOR también, pese al fallo (antes se perdía)',
       coach.length === JUGADORES.length, 'entrenador=' + coach.length);
}
{
    // Y si lo que revienta es la resolucion de padres destinatarios.
    const f = nuevoFirestore(null);
    const sb = baseSandbox(f, {
        _cronosResolveParentReportTargets: () => { throw new Error('contactos corruptos'); }
    });
    vm.runInContext(SRC_AUTO.replace(/\bimport\s*\(/g, '__imp('), sb);
    await sb.autoDispatchMatchReports();
    ok('1c · 🔑 un fallo resolviendo padres tampoco se lleva la copia del entrenador',
       delEntrenador(f.escrito).length === JUGADORES.length,
       'entrenador=' + delEntrenador(f.escrito).length);
}
{
    // Contraprueba: sin fallos, todo el mundo cobra.
    const f = nuevoFirestore(null);
    const sb = baseSandbox(f);
    vm.runInContext(SRC_AUTO.replace(/\bimport\s*\(/g, '__imp('), sb);
    await sb.autoDispatchMatchReports();
    ok('1d · ⚠️ sin fallos siguen escribiéndose las DOS copias',
       delStaff(f.escrito).length === JUGADORES.length &&
       delEntrenador(f.escrito).length === JUGADORES.length,
       'staff=' + delStaff(f.escrito).length + ' entrenador=' + delEntrenador(f.escrito).length);
}

// ═══ PARTE 2 · el envio MANUAL del colectivo indexa al entrenador ═══
console.log('\n── PARTE 2 · enviar el Informe Colectivo alimenta "Mis Informes" ──');
{
    const f = nuevoFirestore(null);
    const sb = baseSandbox(f);
    vm.runInContext(SRC_COLL.replace(/\bimport\s*\(/g, '__imp(') + ';', sb);
    const fn = sb.window._sendCollectiveReportNow;
    ok('2a · la función manual es invocable', typeof fn === 'function', typeof fn);
    if (typeof fn === 'function') {
        await fn();
        const staff = delStaff(f.escrito);
        const coach = delEntrenador(f.escrito);
        ok('2b · el staff recibe su informe colectivo',
           staff.length === JUGADORES.length, 'staff=' + staff.length);
        ok('2c · 🔑🔑 y AHORA el entrenador también queda indexado (antes: 0)',
           coach.length === JUGADORES.length, 'entrenador=' + coach.length);

        // 🔑 La exigencia textual del encargo: NO una version reducida.
        if (staff.length && coach.length) {
            const s = staff[0], c = coach.find(x => x.data.playerNumber === s.data.playerNumber);
            const marcas = ['staffReport', '_forCoach', 'staffUids'];
            const clavesS = Object.keys(s.data).filter(k => !marcas.includes(k)).sort();
            const clavesC = Object.keys(c.data).filter(k => !marcas.includes(k)).sort();
            ok('2d · 🔑 MISMOS CAMPOS que el informe del staff',
               JSON.stringify(clavesS) === JSON.stringify(clavesC),
               'staff=' + clavesS.join(',') + '\n       coach=' + clavesC.join(','));
            const distintos = clavesS.filter(k =>
                JSON.stringify(s.data[k]) !== JSON.stringify(c.data[k]));
            ok('2e · 🔑 y MISMOS VALORES en todos ellos',
               distintos.length === 0, 'difieren: ' + distintos.join(', '));
            ok('2f · ⚠️ la copia del entrenador NO se duplica en el Panel de Dirección',
               c.data.staffReport === false, String(c.data.staffReport));
            ok('2g · ⚠️ y reutiliza el id del despacho automático (no crea un 2º partido)',
               /_coach_p\d+$/.test(c.id), c.id);
        }
    }
}

// ═══ PARTE 3 · el filtro de "Mis Informes" no oculta lo propio ═══
console.log('\n── PARTE 3 · a su autor no se le oculta su informe ──');
{
    // Se ejecuta el PREDICADO REAL, recortado de individual-reports.js.
    const ini = MIS_SRC.indexOf('const snap = { forEach:');
    const fin = MIS_SRC.indexOf('}) };', ini);
    ok('3a · se puede recortar el filtro real', ini !== -1 && fin > ini);
    if (ini !== -1 && fin > ini) {
        const trozo = MIS_SRC.slice(ini, fin + 5);
        // El nombre del snapshot de origen ha cambiado con los refactores
        // (`rawCoachSnap` → `rawSnap`): se lee del propio trozo en vez de
        // fijarlo, para que el guard mida el FILTRO y no el nombre.
        const mSnap = /(\w+)\.forEach\(/.exec(trozo);
        const nombreSnap = mSnap ? mSnap[1] : 'rawSnap';

        const pasa = (datos, opts) => {
            const sb = {
                [nombreSnap]: { forEach: (fn) => fn({ id: 'x', data: () => datos }) },
                me: { uid: 'coach1', clubId: 'club1' },
                puedeFiltrarPorEquipo: true,
                equipoAsignado: 'club1__Alevin__A',
                window: {
                    cronosDocEsDeEquipo: (d, equipos) => {
                        const propio = d.teamId ||
                            (d.clubId && d.category ? d.clubId + '__' + d.category + '__' + (d.subcategory || '') : '');
                        return propio ? equipos.indexOf(propio) !== -1 : false;
                    }
                },
                Object, Array, String, Boolean,
            };
            Object.assign(sb, opts || {});
            vm.createContext(sb);
            vm.runInContext(trozo + '\nvar __n = 0; snap.forEach(() => __n++);', sb);
            return sb.__n === 1;
        };

        // Informe SUYO cuya categoria no se resolvio (el caso que desaparecia).
        ok('3b · 🔑 su propio informe SIN categoría resuelta ya NO se oculta',
           pasa({ _forCoach: true, coachUid: 'coach1', clubId: 'club1', category: '', teamId: '' }));
        ok('3c · su informe con el equipo correcto sigue viéndose',
           pasa({ _forCoach: true, coachUid: 'coach1', clubId: 'club1', category: 'Alevin', subcategory: 'A' }));
        // ⚠️ Contraprueba: el filtro por equipo NO se ha desactivado.
        ok('3d · ⚠️ el informe de OTRO equipo firmado por OTRO sigue filtrado',
           !pasa({ _forCoach: true, coachUid: 'otro', clubId: 'club1', category: 'Cadete', subcategory: 'B' }));
        ok('3e · ⚠️ y lo que no es del entrenador (sin _forCoach) sigue fuera',
           !pasa({ _forCoach: false, coachUid: 'coach1', clubId: 'club1', category: 'Alevin', subcategory: 'A' }));
    }
}

console.log('\n' + (fail === 0 ? 'TODO OK' : 'FALLOS: ' + fail) + ' (pass=' + pass + ')');
process.exit(fail === 0 ? 0 : 1);

})();
