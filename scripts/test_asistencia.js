// ─────────────────────────────────────────────────────────────────────────
// test_asistencia.js · Control de Asistencia diaria (2026-08-13)
//
// Registra quién vino a cada entrenamiento y a cada partido. El requisito del
// autor: la lista se pasa sobre la PROGRAMACIÓN SEMANAL del entrenador (si
// entrena lunes, miércoles y viernes y juega el sábado, esa semana tiene
// cuatro sesiones y no treinta días), sirve de criterio para convocar, y el
// padre ve lo de su hijo.
//
// LO QUE PROTEGE:
//
//  A · 🔑 LAS SESIONES SALEN DEL CUADRANTE, y sólo los días con TIPO. Sobre
//      días naturales, "faltas" no significaría nada: 22 de 30 celdas serían
//      días sin entrenamiento y el porcentaje saldría inventado.
//  B · 🔑 UN JUGADOR SIN MARCAR NO ES UNA FALTA. Si el olvido del entrenador
//      contara como falta injustificada, este control —que se usa para
//      decidir convocatorias— acusaría a chavales que sí fueron.
//  C · 🔑 EL % SE CALCULA SOBRE LO REGISTRADO, no sobre las sesiones totales:
//      un día en que no se pasó lista no puede bajarle la nota a nadie.
//  D · 🔑 LA CLAVE ES LA FICHA, NUNCA EL DORSAL (el dorsal cambia a mitad de
//      temporada), y ficha y fecha van dentro de una RUTA PUNTEADA de
//      Firestore: un punto ahí escribiría la marca en un campo que nadie lee.
//  E · ⚠️ RGPD: no existe "enfermedad" como causa. El estado de salud de un
//      menor es categoría especial (art. 9). Sólo una causa genérica
//      'medico', y sin texto libre donde colar un diagnóstico.
//  F · ⚠️ EL PADRE NO LEE EL DOCUMENTO DEL EQUIPO. Ahí están las faltas de
//      los 25 con sus causas, y las reglas de Firestore no saben filtrar una
//      clave dentro de un mapa. Existe un extracto por jugador y su regla
//      exige que el uid del padre esté en `parentUids`.
//  G · ⚠️ "TODOS PRESENTES" NO PISA LAS MARCAS YA PUESTAS: el entrenador
//      señala primero las ausencias que sabe y remata con el botón.
//  H · ⚠️ La falta a un PARTIDO se distingue de la falta a un entrenamiento.
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

const SRC_UTILS = fs.readFileSync(path.join(ROOT, 'js/core/utils.js'), 'utf8');
const SRC_SYNC  = fs.readFileSync(path.join(ROOT, 'js/services/training-firestore-sync.js'), 'utf8');
const SRC_STORE = fs.readFileSync(path.join(ROOT, 'js/coach/attendance/attendance-store.js'), 'utf8');
const SRC_PANEL = fs.readFileSync(path.join(ROOT, 'js/coach/attendance/panel.js'), 'utf8');
const SRC_RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const SRC_PPANEL= fs.readFileSync(path.join(ROOT, 'js/parent/panel.js'), 'utf8');

function nuevoEntorno() {
    const store = {};
    const localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    const win = {};
    const ctx = {
        window: win, localStorage,
        console: { log(){}, warn(){}, error(){}, debug(){} },
        setTimeout: () => 0, clearTimeout: () => {},
        Promise, Date, JSON, Object, Array, String, Number, Boolean, Math,
        RegExp, isNaN, parseInt, parseFloat, Error,
        document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
        navigator: { userAgent: 'node' }
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(SRC_UTILS, ctx);
    vm.runInContext(SRC_SYNC, ctx);
    vm.runInContext(SRC_STORE, ctx);
    return { ctx, win, localStorage };
}

function seEntra(win, clubId, category, subcategory) {
    win._cronosCurrentUser = {
        uid: 'uid_' + category, clubId,
        allRoles: [{ role: 'user', clubId, category, subcategory, isAuthorized: true }]
    };
}

// Cuadrante: lunes y miércoles entrenamiento, sábado partido. El martes
// tiene lugar pero NO tipo → no es sesión.
function ponCuadrante(win) {
    win.TrainingSync.saveWeek('2026-08-10', {
        '2026-08-10': { tipo: 'entrenamiento', hora: '17:00', lugar: 'Campo A' },
        '2026-08-11': { lugar: 'Campo A' },
        '2026-08-12': { tipo: 'entrenamiento', hora: '17:00', lugar: 'Campo A' },
        '2026-08-15': { tipo: 'partido liga',  hora: '10:00', lugar: 'Campo B' }
    });
}

function ponPlantilla(localStorage) {
    localStorage.setItem('cronos_master_roster', JSON.stringify({
        f7: [
            { id: 'ALC01', number: 1, name: 'Ana Ruiz',   alias: 'Ana' },
            { id: 'ALC02', number: 2, name: 'Beto Sanz',  alias: 'Beto' },
            { id: 'ALC03', number: 3, name: 'Cris Mora',  alias: 'Cris' },
            { id: '',      number: 4, name: '',           alias: '' }
        ],
        f11: []
    }));
}

// ═════════════════════════════════════════════════════════════════════
// A · LAS SESIONES SALEN DEL CUADRANTE
// ═════════════════════════════════════════════════════════════════════
{
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'club_x', 'alevin', 'C');
    ponCuadrante(win);
    ponPlantilla(localStorage);
    const A = win.CronosAttendance;

    const ses = A.sesionesDeSemana('2026-08-10');
    ok('A1 · 🔑 la semana tiene 3 sesiones, no 7 días', ses.length === 3,
       JSON.stringify(ses.map(s => s.fecha)));
    ok('A2 · ⚠️ el día con lugar pero SIN TIPO no es sesión',
       !ses.some(s => s.fecha === '2026-08-11'), JSON.stringify(ses.map(s => s.fecha)));
    ok('A3 · 🔑 el sábado se clasifica como PARTIDO',
       ses.filter(s => s.fecha === '2026-08-15')[0].tipo === 'partido');
    ok('A4 · el lunes se clasifica como ENTRENAMIENTO',
       ses.filter(s => s.fecha === '2026-08-10')[0].tipo === 'entrenamiento');
    ok('A5 · "partido amistoso" también es partido',
       A._tipoDeSesion({ tipo: 'partido amistoso' }) === 'partido');
    ok('A6 · las sesiones del MES incluyen las de la semana',
       A.sesionesDeMes('2026-08').length === 3,
       JSON.stringify(A.sesionesDeMes('2026-08').map(s => s.fecha)));

    // La plantilla descarta las filas vacías y deduplica por ficha
    const pl = A.jugadores();
    ok('A7 · la plantilla ignora las filas vacías', pl.length === 3,
       JSON.stringify(pl.map(p => p.ficha)));
}

// ═════════════════════════════════════════════════════════════════════
// B/C/H · RECUENTOS
// ═════════════════════════════════════════════════════════════════════
{
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'club_x', 'alevin', 'C');
    ponCuadrante(win);
    ponPlantilla(localStorage);
    const A = win.CronosAttendance;
    const ses = A.sesionesDeSemana('2026-08-10');
    const sesLunes = ses.filter(s => s.fecha === '2026-08-10')[0];
    const sesSabado = ses.filter(s => s.fecha === '2026-08-15')[0];

    // Ana viene el lunes; Beto falta injustificado; Cris no se marca.
    A.marcar('2026-08-10', 'ALC01', 'P', null, sesLunes);
    A.marcar('2026-08-10', 'ALC02', 'I', null, sesLunes);
    // Y el sábado (PARTIDO) Beto falta con motivo médico.
    A.marcar('2026-08-15', 'ALC02', 'J', 'medico', sesSabado);

    const datos = A._mesLocal(A.docId(win.cronosMyTeamId(), '2026-08'));
    const marks = datos.marks;

    ok('B0 · la marca queda guardada en local al instante',
       marks['2026-08-10'] && marks['2026-08-10']['ALC01'].s === 'P');

    const rAna = A.resumenJugador(marks, ses, 'ALC01');
    const rBeto = A.resumenJugador(marks, ses, 'ALC02');
    const rCris = A.resumenJugador(marks, ses, 'ALC03');

    ok('B1 · 🔑 quien no está marcado NO cuenta como falta',
       rCris.I === 0 && rCris.J === 0 && rCris.faltas === 0 && rCris.sinMarcar === 3,
       JSON.stringify(rCris));
    ok('B2 · 🔑 y su porcentaje es "—", no 0%', rCris.pct === null, String(rCris.pct));

    ok('C1 · 🔑 el % se calcula sobre lo REGISTRADO (Ana: 1 de 1 = 100%)',
       rAna.registradas === 1 && rAna.pct === 100, JSON.stringify(rAna));
    ok('C2 · Beto: 0 de 2 registradas = 0%',
       rBeto.registradas === 2 && rBeto.P === 0 && rBeto.pct === 0, JSON.stringify(rBeto));

    ok('H1 · ⚠️ la falta a un PARTIDO se cuenta aparte',
       rBeto.faltasPartido === 1 && rBeto.faltasEntreno === 1, JSON.stringify(rBeto));
    ok('H2 · el motivo se acumula por causa',
       rBeto.motivos.medico === 1, JSON.stringify(rBeto.motivos));

    const rs = A.resumenSesion(marks, '2026-08-10', ['ALC01', 'ALC02', 'ALC03']);
    ok('C3 · el resumen de la sesión cuadra',
       rs.P === 1 && rs.I === 1 && rs.J === 0 && rs.sinMarcar === 1, JSON.stringify(rs));

    // ── C6-C8 · el contador de la pestaña del día (v653) ─────────────
    //  Mostraba `P+I+J` —el AVANCE de pasar lista—: con la lista terminada
    //  ponía 25/25 aunque hubieran faltado tres, y la barra de justo debajo
    //  decía «✅ 22 · 🩹 3» en la misma pantalla.
    //
    //  ⚠️ SE MIDE SOBRE EL CÓDIGO SIN COMENTARIOS. El comentario que explica
    //  el arreglo nombra `P+I+J` y «25/25», así que un grep a secas casaría
    //  con la explicación del propio arreglo — cuatro aserciones de este
    //  proyecto ya dieron verde contra un comentario.
    const sinComent = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const lineaCont = sinComent(SRC_PANEL).split('\n')
        .filter(l => l.indexOf("'/' + fichas.length") !== -1);
    // Presencia PRIMERO: sin esto, las dos siguientes darían verde por no
    // tener nada que mirar.
    ok('C3a · el guard encuentra el contador de la pestaña',
       lineaCont.length === 1, 'encontradas ' + lineaCont.length + ' líneas');
    ok('C3b · 🔑 cuenta a los PRESENTES, no a los marcados',
       /res\.P \+ '\/' \+ fichas\.length/.test(lineaCont[0] || '') &&
       !/hechas \+ '\/'/.test(lineaCont[0] || ''), lineaCont[0]);
    // ⚠️ Y el avance NO se tira: si el numerador tiñera, un día en que no vino
    //    nadie (P=0) se vería gris igual que un día sin empezar.
    ok('C3c · ⚠️ pero el COLOR lo sigue decidiendo el avance, no los presentes',
       /hechas \?/.test(lineaCont[0] || ''), lineaCont[0]);

    // Desmarcar devuelve a "sin marcar", no a presente
    A.desmarcar('2026-08-10', 'ALC02');
    const datos2 = A._mesLocal(A.docId(win.cronosMyTeamId(), '2026-08'));
    ok('C4 · desmarcar deja al jugador sin marca, no presente',
       !datos2.marks['2026-08-10']['ALC02'],
       JSON.stringify(datos2.marks['2026-08-10']));

    // El bloque de texto del informe colectivo
    const txt = A.textoMensual('2026-08');
    ok('C5 · el informe colectivo recibe la sumatoria del mes',
       txt.indexOf('ASISTENCIA') !== -1 && txt.indexOf('Total faltas') !== -1, txt.slice(0, 120));
}

// ═════════════════════════════════════════════════════════════════════
// C6 · SIN NADA REGISTRADO, EL INFORME NO CAMBIA
// ═════════════════════════════════════════════════════════════════════
{
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'club_x', 'alevin', 'C');
    ponCuadrante(win);
    ponPlantilla(localStorage);
    ok('C6 · ⚠️ sin ninguna marca, textoMensual devuelve cadena vacía',
       win.CronosAttendance.textoMensual('2026-08') === '',
       JSON.stringify(win.CronosAttendance.textoMensual('2026-08')));
}

// ═════════════════════════════════════════════════════════════════════
// D · CLAVES SEGURAS PARA UNA RUTA PUNTEADA
// ═════════════════════════════════════════════════════════════════════
{
    const { win, localStorage } = nuevoEntorno();
    seEntra(win, 'club_x', 'alevin', 'C');
    ponCuadrante(win);
    ponPlantilla(localStorage);
    const A = win.CronosAttendance;

    ok('D1 · una ficha normal es válida', A._rutaSegura('ALC07') === true);
    ok('D2 · 🔑 una ficha CON PUNTO se rechaza', A._rutaSegura('AL.07') === false);
    ok('D3 · una fecha normal es válida', A._rutaSegura('2026-08-13') === true);
    ok('D4 · una clave vacía se rechaza', A._rutaSegura('') === false);
    ok('D5 · 🔑 marcar() se niega si la ficha lleva un punto',
       A.marcar('2026-08-10', 'AL.07', 'P') === false);

    // La ficha, y no el dorsal, es lo que se usa como clave
    const ses = A.sesionesDeSemana('2026-08-10');
    A.marcar('2026-08-10', 'ALC01', 'P', null, ses[0]);
    const marks = A._mesLocal(A.docId(win.cronosMyTeamId(), '2026-08')).marks;
    ok('D6 · 🔑 la clave del jugador es su FICHA, no su dorsal',
       Object.keys(marks['2026-08-10'])[0] === 'ALC01',
       JSON.stringify(Object.keys(marks['2026-08-10'])));

    // Y la sesión se CONGELA junto a la marca
    const sess = A._mesLocal(A.docId(win.cronosMyTeamId(), '2026-08')).sessions;
    ok('D7 · 🔑 la sesión se copia junto a la marca (no se consulta luego)',
       sess['2026-08-10'] && sess['2026-08-10'].tipo === 'entrenamiento',
       JSON.stringify(sess));
}

// ═════════════════════════════════════════════════════════════════════
// E · RGPD — NADA DE "ENFERMEDAD"
// ═════════════════════════════════════════════════════════════════════
{
    const { win } = nuevoEntorno();
    const ids = win.CronosAttendance.MOTIVOS.map(m => m.id);
    ok('E1 · las causas son las cuatro acordadas',
       ids.length === 4 && ids.indexOf('estudios') !== -1 && ids.indexOf('trabajo') !== -1 &&
       ids.indexOf('medico') !== -1 && ids.indexOf('otros') !== -1, JSON.stringify(ids));
    ok('E2 · 🔑 NO existe la causa "enfermedad"',
       ids.indexOf('enfermedad') === -1, JSON.stringify(ids));
    ok('E3 · ⚠️ ni la palabra aparece en las etiquetas (dato de salud, art. 9)',
       !/enfermedad/i.test(JSON.stringify(win.CronosAttendance.MOTIVOS)),
       JSON.stringify(win.CronosAttendance.MOTIVOS));
    ok('E4 · ⚠️ no hay ningún campo de texto libre para la causa',
       !/textarea/i.test(SRC_PANEL.slice(SRC_PANEL.indexOf('Causa:'), SRC_PANEL.indexOf('Causa:') + 1200)));

    // ── El icono tiene que VERSE (v652) ──────────────────────────────
    // 'otros' era '•', y la rejilla del parte pinta '·' en "Sin marcar": dos
    // puntitos que sólo separaba el color. La regla que se fija es la de la
    // FORMA, no el emoji concreto: un signo de puntuación del plano básico no
    // vale como icono de causa. Los cuatro emojis viven fuera del BMP
    // (codePointAt > 0xFFFF), un punto o una equis no.
    const iconos = win.CronosAttendance.MOTIVOS.map(m => m.icon);
    ok('E5 · ningún icono de causa es un signo de puntuación',
       iconos.every(ic => ic.codePointAt(0) > 0xFFFF), JSON.stringify(iconos));
    ok('E6 · …y ninguno se confunde con el hueco de "Sin marcar"',
       iconos.every(ic => ic !== '·' && ic !== '•' && ic !== '.'), JSON.stringify(iconos));

    // ⚠️ Y LA PANTALLA DE FAMILIAS NO PUEDE LLEVAR SU PROPIA COPIA. Tenía un
    // mapa de motivos escrito a mano; al cambiar el icono de 'otros' la familia
    // habría seguido viendo el punto que el entrenador ya no ve.
    ok('E7 · el panel de familias saca los motivos del almacén, no de una copia',
       /CronosAttendance\.MOTIVOS/.test(SRC_PPANEL) &&
       !/otros:\s*'•/.test(SRC_PPANEL), 'seguía con su mapa propio de motivos');
}

// ═════════════════════════════════════════════════════════════════════
// F · EL PADRE NO PUEDE LEER EL DOCUMENTO DEL EQUIPO
// ═════════════════════════════════════════════════════════════════════
{
    // La regla del documento de EQUIPO no puede conceder por `sameClubAsDoc`
    // a secas: un padre lleva el mismo claim clubId que un entrenador.
    const bloqueEquipo = SRC_RULES.slice(
        SRC_RULES.indexOf('match /clubs/{clubId}/attendance/{docId}'),
        SRC_RULES.indexOf('match /clubs/{clubId}/attendance_players/{docId}'));
    ok('F1 · 🔑 la lectura del doc de equipo pasa por attendanceStaff()',
       /allow read:\s*if\s+attendanceStaff\(clubId\)/.test(bloqueEquipo), bloqueEquipo.slice(0, 300));

    ok('F2 · 🔑 attendanceStaff EXCLUYE a las cuentas de padre',
       /attendanceStaff\(clubId\)\s*\{[\s\S]*?role',\s*''\)\s*!=\s*'parent'/.test(SRC_RULES));

    const bloqueJug = SRC_RULES.slice(SRC_RULES.indexOf('match /clubs/{clubId}/attendance_players/{docId}'));
    ok('F3 · 🔑 el extracto por jugador se abre por parentUids',
       /request\.auth\.uid in resource\.data\.get\('parentUids', \[\]\)/.test(bloqueJug),
       bloqueJug.slice(0, 400));

    ok('F4 · ⚠️ el panel del padre lee attendance_players, NO attendance',
       /attendance_players/.test(SRC_PPANEL) &&
       !/collection\(fa\.db, 'clubs', clubId, 'attendance'\)/.test(SRC_PPANEL));

    ok('F5 · ⚠️ y lo busca por parentUids, no por dorsal',
       /where\('parentUids', 'array-contains', me\.uid\)/.test(SRC_PPANEL));
}

// ═════════════════════════════════════════════════════════════════════
// G · "TODOS PRESENTES" NO PISA LO YA MARCADO
// ═════════════════════════════════════════════════════════════════════
{
    // Se comprueba sobre el fuente porque la función vive en el panel y
    // depende del DOM. La guarda es la línea que se salta a los ya marcados.
    const bloque = SRC_PANEL.slice(SRC_PANEL.indexOf('_attTodosPresentes = function'),
                                   SRC_PANEL.indexOf('_attTodosPresentes = function') + 1200);
    ok('G1 · ⚠️ salta a los jugadores que ya tienen marca',
       /if \(dia\[p\.ficha\] && dia\[p\.ficha\]\.s\) return;/.test(bloque), bloque.slice(0, 400));
    ok('G2 · y sólo marca PRESENTE', /'P'/.test(bloque));
}

// ═════════════════════════════════════════════════════════════════════
// I · LA PANTALLA NO ESPERA A UN BOTÓN GUARDAR
// ═════════════════════════════════════════════════════════════════════
{
    // ⚠️ NO vale con buscar la palabra "GUARDAR" a secas: la pantalla la
    // menciona en un texto de ayuda que habla del botón de la PLANTILLA
    // ("rellena la plantilla y pulsa GUARDAR"), que sí existe y es correcto.
    // Lo que no puede haber es un BOTÓN de guardar aquí dentro.
    const lineasBotonGuardar = SRC_PANEL.split('\n')
        .filter(l => /<button/i.test(l) && /GUARDAR/.test(l));
    ok('I1 · ⚠️ ningún BOTÓN de guardar en la pantalla de asistencia',
       lineasBotonGuardar.length === 0, lineasBotonGuardar.join(' | ').slice(0, 200));
    ok('I2 · cada pulsación llama a marcar() directamente',
       /CronosAttendance\.marcar\(/.test(SRC_PANEL));
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n' + (fail === 0 ? 'OK' : 'FALLOS') + ': ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail === 0 ? 0 : 1);
