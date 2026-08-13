// ─────────────────────────────────────────────────────────────────────────
// test_borrado_permanente_partido.js · purga total de un partido (2026-08-13)
//
// REGLA DEL AUTOR, fijada el 2026-08-13:
//   1. Los informes colectivos y su acumulado PERMANECEN toda la temporada.
//      La sumatoria refleja ÚNICAMENTE los partidos que siguen activos: si
//      alguien elimina definitivamente un informe, sus datos se purgan y se
//      DESCUENTAN del acumulado. No pueden quedar datos fantasma.
//   2. Los "partidos terminados" son un registro TEMPORAL (ventana de 10 h),
//      independiente de los informes colectivos permanentes.
//
// 🔑🔑 POR QUÉ HAY UN MÓDULO Y NO DOS COPIAS. El borrado se dispara desde DOS
// botones —💣 en Informes y 🗑️ en Partidos Terminados— y cada uno borraba una
// cosa distinta: el primero todo, el segundo UN SOLO documento. "Purga total"
// significaba dos cosas según por dónde entrases, y por la segunda vía el
// partido desaparecía del historial mientras sus datos seguían sumando en el
// acumulado del equipo. Justo los datos fantasma que la regla prohíbe.
//
// LO QUE PROTEGE:
//
//  A · 🔑 UNA sola definición de la purga, y los DOS botones la usan.
//  B · 🔑🔑 SÓLO SE BORRAN DOCUMENTOS QUE SE SABE QUE EXISTEN. Dos trampas
//      medidas: `deleteDoc` sobre un id inexistente NO falla (es idempotente),
//      así que ids reconstruidos a mano inflarían el recuento; y en las reglas
//      borrar lo inexistente deja `resource` a null y DENIEGA, sumando falsos
//      "sin permiso". El número que se le enseña al usuario mentiría.
//  C · 🔑 SE CONSULTA POR matchId: es lo único que alcanza las copias de los
//      PADRES, que ningún panel de staff tiene cargadas.
//  D · ⚠️ EL REGISTRO EN VIVO SE COMPRUEBA ANTES DE BORRARLO. deleteDoc es
//      idempotente: sin la lectura previa se anunciaría haber borrado un
//      partido que no estaba.
//  E · ⚠️ SI NO SE BORRA NADA SE DICE POR QUÉ. Las reglas sólo dejan borrar al
//      autor (coachUid) y al SuperAdmin.
//  F · ⚠️ OCULTAR SIGUE SIENDO OTRA COSA: sdDeleteReport no borra nada.
//  G · ⚠️ EL MÓDULO NO REPINTA: es una utilidad de datos. Un refrescador
//      dentro lo acoplaba a dos pantallas y los guards de ambos paneles lo
//      cazaron.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (n, c, x) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (x !== undefined) console.log('       ' + String(x).slice(0, 300)); }
};

const SRC_PURGE = fs.readFileSync(path.join(ROOT, 'js/coach/reports/match-purge.js'), 'utf8');
const SRC_TAB   = fs.readFileSync(path.join(ROOT, 'js/coach/reports/reports-tab.js'), 'utf8');
const SRC_INIT  = fs.readFileSync(path.join(ROOT, 'js/core/app-init.js'), 'utf8');

// ── Arnés: el módulo se EJECUTA con un Firestore de mentira que apunta lo
//    que se le pide. Es la única forma de medir el recuento, que es donde
//    estaban las trampas.
function montar(opts) {
    opts = opts || {};
    const intentos = [];
    const sinPermiso = new Set(opts.sinPermiso || []);
    const liveExiste = new Set(opts.liveExiste || []);
    const porMatchId = opts.porMatchId || [];

    const mod = {
        doc: (_db, col, id) => ({ col, id }),
        deleteDoc: async (ref) => {
            intentos.push(ref.col + '/' + ref.id);
            if (sinPermiso.has(ref.id)) { const e = new Error('denied'); e.code = 'permission-denied'; throw e; }
            // Firestore NO falla al borrar algo inexistente: se refleja tal cual.
        },
        getDoc: async (ref) => ({ exists: () => liveExiste.has(ref.id) }),
        collection: (_db, name) => ({ name }),
        query: (c) => c,
        where: (f, op, v) => ({ f, op, v }),
        getDocs: async () => {
            if (opts.consultaFalla) throw new Error('índice ausente');
            return { forEach: (cb) => porMatchId.forEach(id => cb({ id })) };
        },
    };

    const win = { _cronos_auth: opts.sinDb ? null : { db: {} } };
    const ctx = {
        window: win, console: { log() {}, warn() {}, error() {} },
        Promise, JSON, Object, Array, String, Number, Boolean, Set, Map, Error,
        setTimeout, clearTimeout,
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    // El módulo usa `await import(...)`, que en vm no existe: se sustituye la
    // expresión por el objeto de mentira. Es un cambio de UNA línea y deja
    // intacta toda la lógica que se quiere medir.
    vm.runInContext(SRC_PURGE.replace(/await import\(FS_URL\)/g, '(ctx_mod)'),
                    Object.assign(ctx, { ctx_mod: mod }));
    return { ctx, win, intentos };
}

(async () => {

// ═════════════════════════════════════════════════════════════════════
// A · UNA DEFINICIÓN, DOS LLAMADORES
// ═════════════════════════════════════════════════════════════════════
{
    ok('A1 · el módulo expone la purga',
       /window\.cronosPurgarInformes\s*=/.test(SRC_PURGE) &&
       /window\.cronosRecogerInformesDePartido\s*=/.test(SRC_PURGE) &&
       /window\.cronosBorrarPartidoEnVivo\s*=/.test(SRC_PURGE));

    ok('A2 · 🔑 el botón 💣 de Informes usa el módulo',
       /window\.cronosPurgarPartido\(/.test(SRC_TAB));
    ok('A3 · 🔑 el botón 🗑️ de Partidos Terminados TAMBIÉN',
       /window\.cronosPurgarInformes\(/.test(SRC_INIT) &&
       /window\.cronosRecogerInformesDePartido\(/.test(SRC_INIT));

    // ⚠️ Lo que de verdad se vigila: que app-init no vuelva a borrar UN solo
    // documento por su cuenta, que es lo que dejaba el acumulado sucio.
    const bloqueInit = SRC_INIT.slice(SRC_INIT.indexOf('window.deleteFinishedMatchFromCloud'),
                                      SRC_INIT.indexOf('function loadFinishedMatch'));
    // ⚠️ SE MIDE SOBRE CÓDIGO, SIN COMENTARIOS, Y SE BUSCA EL NOMBRE DE LA
    // COLECCIÓN. Dos correcciones que costó una ronda cada una:
    //  · la primera versión exigía el patrón `deleteDoc(doc(` pegado, y una
    //    reintroducción escrita `_m.deleteDoc(_m.doc(…))` se colaba entera —
    //    el red-check la dejó VERDE con el defecto puesto;
    //  · y buscar el nombre en el fichero crudo caza el comentario de v435,
    //    que explica precisamente esta distinción. Un guard que se dispara
    //    con su propia documentación es un guard que se acaba desactivando.
    const _codigoInit = bloqueInit.split('\n')
        .map(l => l.replace(/\/\/.*$/, '')).join('\n');
    ok('A4 · 🔑🔑 app-init YA NO borra informes por su cuenta',
       _codigoInit.indexOf('cronos_player_reports') === -1,
       (_codigoInit.match(/.{0,60}cronos_player_reports.{0,40}/) || [''])[0]);

    ok('A5 · ⚠️ y el resumen que enseñan los dos sale del mismo sitio',
       /cronosResumenPurga/.test(SRC_TAB) && /cronosResumenPurga/.test(SRC_INIT));

    ok('G1 · ⚠️ el módulo NO repinta pantallas (es utilidad de datos)',
       !/_sdLoadReports\(\)/.test(SRC_PURGE) && !/showFinishedMatches\(\)/.test(SRC_PURGE));
}

// ═════════════════════════════════════════════════════════════════════
// B/C · QUÉ DOCUMENTOS SE RECOGEN Y SE BORRAN
// ═════════════════════════════════════════════════════════════════════
{
    const t = montar({ porMatchId: ['M1_staff_p7', 'M1_parent_uidA_p7', 'M1_parent_uidB_p10'] });
    const ids = await t.ctx.window.cronosRecogerInformesDePartido(
        'M1', ['M1_staff_p7', 'M1_staff_p10']);

    ok('C1 · 🔑 llegan las copias de los PADRES por la consulta',
       ids.indexOf('M1_parent_uidA_p7') !== -1 && ids.indexOf('M1_parent_uidB_p10') !== -1,
       JSON.stringify(ids));
    ok('C2 · y los que ya tenía el panel',
       ids.indexOf('M1_staff_p7') !== -1 && ids.indexOf('M1_staff_p10') !== -1, JSON.stringify(ids));
    ok('C3 · ⚠️ sin duplicados aunque el id venga por las dos vías',
       ids.filter(x => x === 'M1_staff_p7').length === 1, JSON.stringify(ids));
    ok('B1 · 🔑🔑 NO se inventan ids (M1_coach_p7 / M1_p7 no aparecen)',
       ids.indexOf('M1_coach_p7') === -1 && ids.indexOf('M1_p7') === -1, JSON.stringify(ids));
    ok('B2 · en total, exactamente los 4 reales', ids.length === 4, JSON.stringify(ids));

    const r = await t.ctx.window.cronosPurgarInformes(ids);
    ok('B3 · 🔑 el recuento es el REAL', r.borrados === 4 && r.denegados === 0, JSON.stringify(r));
    ok('B4 · y sólo se tocó cronos_player_reports',
       t.intentos.every(x => x.indexOf('cronos_player_reports/') === 0), JSON.stringify(t.intentos));
}

// ═════════════════════════════════════════════════════════════════════
// C4 · SI LA CONSULTA FALLA, NO SE PIERDE LO CONOCIDO
// ═════════════════════════════════════════════════════════════════════
{
    const t = montar({ consultaFalla: true });
    const ids = await t.ctx.window.cronosRecogerInformesDePartido('M1', ['M1_staff_p7']);
    ok('C4 · ⚠️ si la consulta por matchId falla, se sigue con los ids conocidos',
       ids.length === 1 && ids[0] === 'M1_staff_p7', JSON.stringify(ids));
}

// ═════════════════════════════════════════════════════════════════════
// D · EL REGISTRO EN VIVO
// ═════════════════════════════════════════════════════════════════════
{
    const sin = montar({ liveExiste: [] });
    const r1 = await sin.ctx.window.cronosBorrarPartidoEnVivo('M1');
    ok('D1 · ⚠️ si no existe, devuelve false y NO se intenta borrar',
       r1 === false && sin.intentos.length === 0, JSON.stringify(sin.intentos));

    const con = montar({ liveExiste: ['M1'] });
    const r2 = await con.ctx.window.cronosBorrarPartidoEnVivo('M1');
    ok('D2 · si existe, se borra y se dice',
       r2 === true && con.intentos.indexOf('live_matches/M1') !== -1, JSON.stringify(con.intentos));

    const vacio = montar({ liveExiste: ['M1'] });
    const r3 = await vacio.ctx.window.cronosBorrarPartidoEnVivo('undefined');
    ok('D3 · ⚠️ un matchId "undefined" no dispara ningún borrado',
       r3 === false && vacio.intentos.length === 0, JSON.stringify(vacio.intentos));
}

// ═════════════════════════════════════════════════════════════════════
// E · PERMISOS Y MENSAJE HONESTO
// ═════════════════════════════════════════════════════════════════════
{
    const t = montar({ sinPermiso: ['A', 'B'] });
    const r = await t.ctx.window.cronosPurgarInformes(['A', 'B']);
    ok('E1 · los denegados se cuentan aparte',
       r.borrados === 0 && r.denegados === 2, JSON.stringify(r));

    const msg = t.ctx.window.cronosResumenPurga(r);
    ok('E2 · 🔑 sin nada borrado, se explica que sólo puede el autor',
       /sólo el entrenador que creó el partido/i.test(msg), msg);
    ok('E3 · ⚠️ y NO se anuncia ninguna purga', msg.indexOf('Purgado') === -1, msg);

    const parcial = t.ctx.window.cronosResumenPurga({ borrados: 2, denegados: 1, partidoBorrado: false });
    ok('E4 · 🔑 en un borrado PARCIAL se informan los dos números',
       /2 informes/.test(parcial) && /1 sin permiso/.test(parcial), parcial);
    ok('E5 · 🔑 y se dice que el acumulado queda descontado (la regla del autor)',
       /acumulado queda descontado/i.test(parcial), parcial);

    const vacio = t.ctx.window.cronosResumenPurga({ borrados: 0, denegados: 0 });
    ok('E6 · sin documentos, se dice eso y no "purgado"',
       /No se encontró/i.test(vacio) && vacio.indexOf('Purgado') === -1, vacio);
}

// ═════════════════════════════════════════════════════════════════════
// F · OCULTAR SIGUE SIENDO OTRA COSA
// ═════════════════════════════════════════════════════════════════════
{
    ok('F1 · 🔑 sdDeleteReport (ocultar) sigue existiendo y es otra función',
       /window\.sdDeleteReport = async/.test(SRC_TAB) && /window\.sdPurgeMatch = async/.test(SRC_TAB));
    const bloqueOcultar = SRC_TAB.slice(SRC_TAB.indexOf('window.sdDeleteReport = async'));
    ok('F2 · ⚠️ y NO borra: sigue con arrayUnion sobre dismissedBy',
       /dismissedBy: arrayUnion\(dismissKey\)/.test(bloqueOcultar) &&
       bloqueOcultar.indexOf('deleteDoc') === -1);
    ok('F3 · ⚠️ el botón de ocultar no promete "definitivamente"',
       !/title="Eliminar este informe definitivamente"/.test(SRC_TAB));
}

// ═════════════════════════════════════════════════════════════════════
// H · LAS DOS PANTALLAS AVISAN ANTES
// ═════════════════════════════════════════════════════════════════════
{
    const bloqueInit = SRC_INIT.slice(SRC_INIT.indexOf('window.deleteFinishedMatchFromCloud'),
                                      SRC_INIT.indexOf('function loadFinishedMatch'));
    ok('H1 · 🔑 Partidos Terminados pide confirmación tecleada cuando hay informes',
       /BORRADO PERMANENTE/.test(bloqueInit) && /prompt\(/.test(bloqueInit), 'sin doble aviso');
    ok('H2 · ⚠️ y avisa de que se DESCONTARÁ del acumulado',
       /DESCONTAR/i.test(bloqueInit));
    ok('H3 · ⚠️ sin informes, sólo un aviso simple (es el registro temporal)',
       /registro temporal/i.test(bloqueInit));
    ok('H4 · 🔑 el conteo se hace ANTES de preguntar (para graduar el aviso)',
       bloqueInit.indexOf('cronosRecogerInformesDePartido') < bloqueInit.indexOf('BORRADO PERMANENTE'),
       'recoger=' + bloqueInit.indexOf('cronosRecogerInformesDePartido') +
       ' aviso=' + bloqueInit.indexOf('BORRADO PERMANENTE'));

    const bloque = SRC_TAB.slice(SRC_TAB.indexOf('window.sdPurgeMatch = async'));
    ok('H5 · el botón 💣 también pide las dos confirmaciones',
       /BORRADO PERMANENTE/.test(bloque) && /prompt\(/.test(bloque));
    ok('H6 · ⚠️ y su prompt no exige un formato que no se comprueba',
       !/en mayúsculas/i.test(bloque.slice(0, 3000)));
}

// ═════════════════════════════════════════════════════════════════════
// I · SÓLO EL DIRECTOR DEPORTIVO PURGA
// ═════════════════════════════════════════════════════════════════════
//  Regla del autor (2026-08-13): entrenador y coordinador sólo OCULTAN.
//  ⚠️ La barrera REAL son las reglas de Firestore —eso lo mide
//  test_asistencia_rules.js contra el servidor—; aquí se vigila que la
//  interfaz no ofrezca un botón que va a fallar, y que la función tenga su
//  propia puerta porque es window.* e invocable desde la consola.
{
    const SRC_CLUB = fs.readFileSync(path.join(ROOT, 'js/coach/reports/club-reports.js'), 'utf8');

    // El predicado se comprueba EJECUTÁNDOLO, no leyéndolo.
    const sb = { console: { log() {}, warn() {}, error() {} }, Array, Object, String };
    sb.window = sb; sb.globalThis = sb;
    sb.document = { getElementById: () => null };
    vm.createContext(sb);
    const ini = SRC_CLUB.indexOf('function _sdEsDirector');
    const fin = SRC_CLUB.indexOf('async function openStaffDashboard');
    vm.runInContext(SRC_CLUB.slice(ini, fin), sb);

    // 🔑🔑 LA POTESTAD DEPENDE DEL ROL ACTIVO, NUNCA DE LA PERSONA. Es el
    // ajuste estricto que pidió el autor: si a mitad de temporada esa misma
    // persona pasa a ser sólo coordinador, pierde el borrado.
    const puede = (u) => sb.window._sdPuedePurgar(u);
    ok('I1 · 🔑 el DIRECTOR puede purgar', puede({ role: 'director' }) === true);
    ok('I1b · 🔑 el ADMINISTRADOR DEL CLUB también', puede({ role: 'club_admin' }) === true);
    ok('I2 · 🔑🔑 el COORDINADOR no', puede({ role: 'coordinator' }) === false);
    ok('I3 · 🔑🔑 el ENTRENADOR (rol `user`) no', puede({ role: 'user' }) === false);
    ok('I4 · el padre tampoco', puede({ role: 'parent' }) === false);
    ok('I5 · el SuperAdmin sí (válvula de escape)', puede({ role: 'superadmin' }) === true);
    ok('I6 · 🔑🔑🔑 MISMA persona ACTUANDO de coordinador: NO, aunque su raíz sea director',
       puede({ role: 'director', _activeRole: 'coordinator' }) === false);
    ok('I6b · 🔑 ni actuando de entrenador',
       puede({ role: 'club_admin', _activeRole: 'user' }) === false);
    ok('I7 · y actuando de director sí', puede({ role: 'user', _activeRole: 'director' }) === true);
    ok('I8 · sin usuario, no (no puede reventar)', puede(null) === false);

    // ⚠️ SON DOS REGLAS DE PRODUCTO DISTINTAS Y DOS FUNCIONES DISTINTAS: la
    // pestaña "Config." es del Director y SÓLO del Director; la purga la
    // comparte con el Administrador del Club. Fundirlas por parecerse le daría
    // al club_admin una pestaña que no le toca.
    const config = (u) => sb.window._sdCanSeeConfigTab(u);
    ok('I9 · 🔑 Config. sigue siendo SÓLO del director (el club_admin NO la ve)',
       config({ role: 'director' }) === true && config({ role: 'club_admin' }) === false);
    ok('I9b · ⚠️ y por eso la purga tiene su PROPIA función, no un alias',
       /function _sdPuedePurgar\(user\)/.test(SRC_CLUB) &&
       /function _sdEsDirector\(user\)/.test(SRC_CLUB));

    // Las DOS puertas: el botón y la función.
    ok('I10 · 🔑 el botón 💣 sólo se pinta si el permiso lo permite',
       /\$\{_sdMuestraPurga \? `[\s\S]{0,200}sdPurgeMatch/.test(SRC_TAB),
       (SRC_TAB.match(/.{0,60}sdPurgeMatch\('\$\{key64\}'\).{0,20}/) || [''])[0]);
    const bloquePurga = SRC_TAB.slice(SRC_TAB.indexOf('window.sdPurgeMatch = async'));
    ok('I11 · 🔑🔑 y la FUNCIÓN comprueba el permiso por su cuenta (es window.*)',
       /_sdPuedePurgar\(me\)/.test(bloquePurga.slice(0, 1200)), bloquePurga.slice(0, 300));
    ok('I12 · ⚠️ y corta ANTES de leer el partido',
       bloquePurga.indexOf('_sdPuedePurgar') < bloquePurga.indexOf('window._sdMatchData[key64]'),
       'permiso=' + bloquePurga.indexOf('_sdPuedePurgar') +
       ' lectura=' + bloquePurga.indexOf('window._sdMatchData[key64]'));
    ok('I13 · ⚠️ si el módulo del permiso no cargó, se responde NO (falla cerrado)',
       /typeof window\._sdPuedePurgar !== 'function' \|\| !window\._sdPuedePurgar\(me\)/.test(bloquePurga));

    // Partidos Terminados: el entrenador conserva el registro temporal.
    const bloqueInit2 = SRC_INIT.slice(SRC_INIT.indexOf('window.deleteFinishedMatchFromCloud'),
                                       SRC_INIT.indexOf('function loadFinishedMatch'));
    ok('I14 · 🔑 Partidos Terminados también consulta el permiso',
       /_sdPuedePurgar\(window\._cronosCurrentUser\)/.test(bloqueInit2));
    ok('I15 · 🔑 quien no es director NO recoge informes que purgar',
       /if \(_esDirector\) \{[\s\S]{0,400}cronosRecogerInformesDePartido/.test(bloqueInit2),
       'la recogida no está dentro de la guarda de director');
    ok('I16 · ⚠️ y ante una ficha de INFORME se le manda a ocultar',
       /exclusivo del Director Deportivo/.test(bloqueInit2) && /OCULTARLO/.test(bloqueInit2));
    ok('I17 · ⚠️ el aviso NO le dice "no hay informes" cuando es cuestión de permisos',
       /Los informes colectivos NO se tocan/.test(bloqueInit2), 'mensaje engañoso para no-directores');
}

console.log('\n' + (fail === 0 ? 'OK' : 'FALLOS') + ': ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);

})().catch(e => { console.error('EXCEPCIÓN:', e && e.stack || e); process.exit(1); });
