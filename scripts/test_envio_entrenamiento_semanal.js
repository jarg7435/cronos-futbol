// ─────────────────────────────────────────────────────────────────────────
// test_envio_entrenamiento_semanal.js · enviar la Planificación Semanal
// funciona, y el botón no apunta a un nombre que no existe (v510)
//
// Reporte del autor (capturas 8766 y 8767): al pulsar el botón verde de envío
// en Planificación Semanal, la consola daba
// `Uncaught ReferenceError: _sendTrainingNotificationV2 is not defined` y el
// flujo se quedaba bloqueado.
//
// 🔑🔑🔑 SU DIAGNÓSTICO ("falta exportarla al ámbito global") ERA RAZONABLE
// PERO NO ERA ESO: la función NO EXISTÍA EN NINGÚN SITIO. Su único rastro en
// todo el repositorio era el nombre con el que js/shared/whatsapp-email.js
// construye el botón:
//
//     const sendFunction = isConv ? 'publishConvocationToAppV2'
//                                 : '_sendTrainingNotificationV2';
//
// Se escribió la mitad de convocatoria y la de entrenamiento se quedó sin
// escribir. Un `onclick` compuesto como CADENA no falla al cargar: falla el
// día que alguien pulsa.
//
// ⚠️ Y NO VALÍA RENOMBRAR LA LLAMADA a `_sendTrainingNotification` (que sí
// existe): esa lee `#tr-datetime`, `#tr-location` y `.tr-recipient-chk`, que
// son de SU propio modal. Cuando corre este flujo, el selector de
// destinatarios ya ha reemplazado `#setup-modal` y ese DOM no está. El
// resultado habría sido "indica al menos fecha/hora" o "0 destinatarios":
// cambiar un error ruidoso por uno que calla.
//
// LO QUE PROTEGE:
//
//  A · 🔑 LA CLASE DE FALLO, no sólo este nombre: TODO nombre de función que
//      whatsapp-email.js cablee en un onclick tiene que existir de verdad en
//      el código. Esta es la aserción que habría cazado el defecto el día que
//      se introdujo.
//  B · La función existe, es invocable y ESCRIBE un aviso por destinatario.
//  C · 🔑 EL CONTRATO DEL AVISO, que fijan sus dos lectores: `weekStartDate`
//      y `days[] = {day,time,note,venue}` (js/parent/panel.js pinta la tabla
//      con eso) y `category`/`subcategory` (sin ellas el panel del Director
//      lo deja en "Sin clasificar").
//  D · ⚠️ Lee la semana de localStorage y NO del DOM, porque el DOM del
//      planificador ya no está cuando esto corre.
//  E · ⚠️ No envía a ciegas: sin destinatarios o con la semana vacía, avisa y
//      no escribe nada.
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

const SRC_TN = fs.readFileSync(path.join(ROOT, 'js/coach/comms/training-notify.js'), 'utf8');
const SRC_WE = fs.readFileSync(path.join(ROOT, 'js/shared/whatsapp-email.js'), 'utf8');

function listarJs(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) listarJs(p, out);
        else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
}

console.log('── enviar la Planificación Semanal (v510) ──\n');

// ═══ PARTE 1 · LA CLASE DE FALLO: ningún onclick a un nombre inexistente ═══
console.log('── PARTE 1 · los botones del selector apuntan a funciones que existen ──');
{
    // Nombres que whatsapp-email.js cablea como función de envío.
    const nombres = [];
    const re = /'([A-Za-z_$][\w$]*)'/g;
    const linea = (SRC_WE.match(/const\s+sendFunction\s*=[^;]+;/) || [''])[0];
    let m;
    while ((m = re.exec(linea)) !== null) nombres.push(m[1]);

    ok('1a · se localizan los nombres cableados en el selector',
       nombres.length >= 2, nombres.join(', '));

    const fuentes = listarJs(path.join(ROOT, 'js'), []).map(f => fs.readFileSync(f, 'utf8'));
    const estaDefinida = (n) => fuentes.some(s =>
        new RegExp('(window\\.' + n + '\\s*=)|(^|\\s)function\\s+' + n + '\\s*\\(', 'm').test(s));

    nombres.forEach(n => {
        ok('1b · 🔑 `' + n + '` está DEFINIDA de verdad', estaDefinida(n),
           'el boton la invoca pero no existe en js/ — ReferenceError al pulsar');
    });
}

// ═══ Caja de arena para ejecutar el envío ═══
const LUNES = '2026-08-10';   // lunes de la semana de la prueba
const SEMANA = {
    '2026-08-10': { hora: '18:00', lugar: 'Campo 1', tipo: 'Técnica', equipaciones: 'Roja', duracion: '90min' },
    '2026-08-12': { hora: '19:00', lugar: 'Campo 2', tipo: 'Táctica' },
};

function montar({ marcados = 2, semana = SEMANA, setDocLanza = null } = {}) {
    const escrito = [];
    const avisos  = [];
    const chks = [];
    for (let i = 0; i < marcados; i++) {
        chks.push({ dataset: { id: 'c' + i, uid: 'uid' + i, email: 'p' + i + '@x.com', label: 'Padre ' + i } });
    }
    const store = { cronos_training_weeks: JSON.stringify({ [LUNES]: semana }) };

    const sb = {
        _cronosCurrentUser: { uid: 'coach1', email: 'e@e.com', clubId: 'club1',
                              category: 'f7_alevin', subcategory: 'A' },
        _cronos_auth: { db: {} },
        _trWeekOffset: 0,
        document: {
            querySelectorAll: (sel) => (sel.indexOf('cronos-pick-chk') !== -1 ? chks : []),
            getElementById: () => null,
        },
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON,
        parseInt, isNaN, Error,
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
        },
        showToast: (t) => avisos.push(String(t)),
        showSpinner: () => {}, hideSpinner: () => {},
        openUnifiedCommsMenu: () => {},
        // Los dos ayudantes globales que usa (viven en otros módulos).
        _getWeekMonday: () => new Date(LUNES + 'T00:00:00'),
        _cronosLocalDateKey: (d) => {
            const p = (n) => String(n).padStart(2, '0');
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        },
        __imp: async () => ({
            setDoc: async (ref, data) => {
                if (setDocLanza) throw new Error(setDocLanza);
                escrito.push({ id: ref.__id, data });
            },
            doc: (db, col, id) => ({ __col: col, __id: id }),
        }),
    };
    vm.createContext(sb);
    sb.window = sb;
    sb.globalThis = sb;
    sb._cronosLocalDateKey = sb._cronosLocalDateKey;
    vm.runInContext(SRC_TN.replace(/\bimport\s*\(/g, '__imp('), sb);
    return { sb, escrito, avisos };
}

(async () => {

// ═══ PARTE 2 · el envío funciona ═══
console.log('\n── PARTE 2 · el botón envía de verdad ──');
{
    const t = montar({ marcados: 2 });
    ok('2a · 🔑 la función existe y es invocable (era el ReferenceError)',
       typeof t.sb.window._sendTrainingNotificationV2 === 'function');

    await t.sb.window._sendTrainingNotificationV2();

    ok('2b · escribe UN aviso por destinatario',
       t.escrito.length === 2, 'escritos=' + t.escrito.length);
    ok('2c · y lo dice',
       t.avisos.some(a => /2 persona/.test(a)), t.avisos.join(' | '));
}

// ═══ PARTE 3 · el contrato que esperan los receptores ═══
console.log('\n── PARTE 3 · el aviso trae lo que sus lectores necesitan ──');
{
    const t = montar({ marcados: 1 });
    await t.sb.window._sendTrainingNotificationV2();
    const d = (t.escrito[0] || {}).data || {};

    ok('3a · tipo `planificacion_semanal`', d.type === 'planificacion_semanal', d.type);
    ok('3b · 🔑 `weekStartDate` (el título "Semana del ..." sale de aquí)',
       d.weekStartDate === LUNES, String(d.weekStartDate));
    ok('3c · 🔑 `days` con los 7 días y la forma {day,time,note,venue}',
       Array.isArray(d.days) && d.days.length === 7 &&
       ['day','time','note','venue'].every(k => k in d.days[0]),
       JSON.stringify((d.days || [])[0]));
    ok('3d · el lunes lleva su hora, lugar y la nota compuesta',
       d.days && d.days[0].time === '18:00' && d.days[0].venue === 'Campo 1' &&
       d.days[0].note === 'Técnica · Roja · 90min',
       JSON.stringify(d.days && d.days[0]));
    ok('3e · un día sin datos viaja vacío (el receptor pinta "Descanso")',
       d.days && d.days[1].time === '' && d.days[1].note === '',
       JSON.stringify(d.days && d.days[1]));
    ok('3f · 🔑 `category`/`subcategory` del ENTRENADOR (si no, "Sin clasificar")',
       d.category === 'f7_alevin' && d.subcategory === 'A',
       d.category + ' / ' + d.subcategory);
    ok('3g · destinatario en `userId` Y en `parentUid`',
       d.userId === 'uid0' && d.parentUid === 'uid0',
       d.userId + ' / ' + d.parentUid);
    ok('3h · y el autor en `coachUid`', d.coachUid === 'coach1', d.coachUid);
}

// ═══ PARTE 4 · la semana sale de localStorage, no del DOM ═══
console.log('\n── PARTE 4 · lee la semana guardada, no la pantalla ──');
{
    // El DOM del planificador NO existe (getElementById devuelve null): si la
    // función dependiera de él, aqui no saldria nada.
    const t = montar({ marcados: 1 });
    await t.sb.window._sendTrainingNotificationV2();
    const d = (t.escrito[0] || {}).data || {};
    ok('4a · ⚠️ con el DOM del planificador ausente, la semana llega igual',
       d.days && d.days.some(x => x.time === '19:00' && x.venue === 'Campo 2'),
       JSON.stringify(d.days));
}

// ═══ PARTE 5 · no envía a ciegas ═══
console.log('\n── PARTE 5 · contraprueba: sin datos no se escribe nada ──');
{
    const sinGente = montar({ marcados: 0 });
    await sinGente.sb.window._sendTrainingNotificationV2();
    ok('5a · ⚠️ sin destinatarios no escribe y avisa',
       sinGente.escrito.length === 0 &&
       sinGente.avisos.some(a => /al menos una persona/i.test(a)),
       sinGente.avisos.join(' | '));

    const semanaVacia = montar({ marcados: 2, semana: {} });
    await semanaVacia.sb.window._sendTrainingNotificationV2();
    ok('5b · ⚠️ con la semana vacía no escribe y avisa',
       semanaVacia.escrito.length === 0 &&
       semanaVacia.avisos.some(a => /vac[íi]a/i.test(a)),
       semanaVacia.avisos.join(' | '));

    const falla = montar({ marcados: 2, setDocLanza: 'permission-denied' });
    await falla.sb.window._sendTrainingNotificationV2();
    ok('5c · ⚠️ si Firestore falla, se entera el usuario (no se queda colgado)',
       falla.avisos.some(a => /Error/.test(a)), falla.avisos.join(' | '));
}

console.log('\n' + (fail === 0 ? 'TODO OK' : 'FALLOS: ' + fail) + ' (pass=' + pass + ')');
process.exit(fail === 0 ? 0 : 1);

})();
