// ════════════════════════════════════════════════════════════════════
//  🔔 v796 · LA INSIGNIA DE «MENSAJES» SÓLO CUENTA LO QUE LA BANDEJA ENSEÑA
//
//  Encargo del autor (implementar.txt 2026-10-09, capturas 11292-11294): el
//  Director de CD DÍA veía «Mensajes · 7» y en la bandeja todos los contactos
//  decían «— Sin mensajes —».
//
//  Causa medida en el código: la tarjeta contaba TODOS los hilos donde
//  participa la cuenta; la bandeja sólo abre los de las pestañas de su plaza.
//  El hilo `{clubId}_{director}` (`_cStaffThreadId`) recibe el AVISO de cada
//  informe de los entrenadores (`type:'report'`, sin `senderUid`) y no lo abre
//  ninguna pestaña. Ahora sólo cuentan mensajes de TEXTO, de OTROS, en hilos
//  que la bandeja de esa plaza puede abrir.
//
//  Ejecuta la regla REAL de comms/panel.js y el contador REAL (unread-badge.js).
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RAIZ  = path.join(__dirname, '..');
const PANEL = fs.readFileSync(path.join(RAIZ, 'js/coach/comms/panel.js'), 'utf8');
const UB    = fs.readFileSync(path.join(RAIZ, 'js/coach/comms/unread-badge.js'), 'utf8');

let fallos = 0, total = 0;
function ok(n, c, d) { total++; if (c) console.log('  ✓ ' + n);
    else { fallos++; console.log('  ✗ ' + n + (d !== undefined ? '\n      ' + String(d).slice(0, 300) : '')); } }

// ── La regla de la bandeja, tal cual está en comms/panel.js ──
const ini = PANEL.indexOf('function _getCanonicalContext(role, tabId)');
const fin = PANEL.indexOf('window._UM_PESTANAS_POR_ROL = _UM_PESTANAS_POR_ROL;', ini);
const REGLA = (ini >= 0 && fin > ini) ? PANEL.slice(ini, fin) + 'window._UM_PESTANAS_POR_ROL = _UM_PESTANAS_POR_ROL;\n}' : '';
const R = { window: {} };
R.window = R;
vm.createContext(R);
let reglaOk = true;
try { vm.runInContext(REGLA, R); } catch (e) { reglaOk = false; console.log('  (regla: ' + e.message + ')'); }
const visible = R.cronosHiloVisibleEnBandeja;

const CLUB = 'club_mqvr9m11_g9kj';
const DIR = 'uDirector', COA = 'uCoachAlevin', COA2 = 'uCoachFem', CRD = 'uCoord', ADM = 'uAdmin', FAM = 'uFamilia';
const par = (a, b, ctx) => [a, b].sort().join('_') + '_' + ctx;

console.log('\n── PARTE 1 · ¿qué hilos puede abrir cada bandeja? (regla real de panel.js) ──');
ok('1a · se encuentra la regla y la tabla de pestañas', reglaOk && typeof visible === 'function' &&
   R._UM_PESTANAS_POR_ROL && Array.isArray(R._UM_PESTANAS_POR_ROL.director));
ok('1b · el Director abre su chat con un entrenador (coach_director)',
   visible('director', par(DIR, COA, 'coach_director'), [COA, DIR]));
ok('1c · …con un coordinador y con el administrador del club',
   visible('director', par(DIR, CRD, 'director_coordinator'), [DIR, CRD]) &&
   visible('director', par(DIR, ADM, 'clubadmin_director'), [ADM, DIR]));
ok('1d · 🔑🔑 [CAPTURA 11292] el hilo de AVISOS DE INFORMES del club NO lo abre ninguna pestaña',
   !visible('director', CLUB + '_' + DIR, [COA, DIR, COA2]) &&
   !visible('director', CLUB + '_' + DIR, [COA, DIR]));
ok('1e · 🔑 un hilo de OTRA plaza (entrenador↔familia) no es de la bandeja del Director',
   !visible('director', par(DIR, FAM, 'coach_parent'), [DIR, FAM]));
ok('1f · …pero sí de la del entrenador',
   visible('coach', par(COA, FAM, 'coach_parent'), [COA, FAM]));
ok('1g · el id antiguo de pareja (`a_b`) se sigue abriendo (respaldo de la bandeja)',
   visible('parent', COA + '_' + FAM, [COA, FAM]) && visible('parent', FAM + '_' + COA, [COA, FAM]));
ok('1h · el canal con el SuperAdmin es del administrador, no del Director',
   visible('club_admin', 'sa_' + [ADM, 'uSA'].sort().join('_'), [ADM, 'uSA']) &&
   !visible('director', 'sa_' + [DIR, 'uSA'].sort().join('_'), [DIR, 'uSA']));
ok('1i · la bandeja repinta sus pestañas desde la MISMA tabla',
   /tabs = \(_UM_PESTANAS_POR_ROL\[role\] \|\| \[\]\)\.slice\(\);/.test(PANEL));

// ── El contador, sobre un Firestore de juguete (mismo arnés que test_contador_no_leidos) ──
function cargar(o) {
    const snap = (arr) => ({ forEach: (f) => arr.forEach(d => f(d)) });
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        String, Object, Array, Number, Boolean, Date, JSON, Math, isFinite, isNaN,
        setTimeout: () => 1, clearTimeout() {},
        document: { getElementById: () => null, addEventListener() {}, visibilityState: 'visible' },
        addEventListener() {},
    };
    sb.window = sb; sb.globalThis = sb;
    sb._getEffectiveUser = () => o.yo;
    sb.ccPuedeVerCanal = (u) => !!(o.veCanal && u && u.clubId);
    if (o.conRegla) sb.cronosHiloVisibleEnBandeja = visible;
    const fs_ = {
        db: {}, collection: (_db, n) => ({ _col: n }), query: (c) => c,
        where: () => ({}), orderBy: () => ({}), limit: () => ({}),
        doc: (_db, ...p) => ({ _path: p.join('/') }),
        getDocs: async (c) => snap(c._col === 'cronos_messages' ? (o.hilos || []) : (o.canal || [])),
        getDoc: async () => ({ exists: () => !!o.marcas, data: () => o.marcas || {} }),
        setDoc: async () => {},
    };
    sb.import = async () => fs_;
    vm.createContext(sb);
    vm.runInContext(UB.replace(/await import\(/g, 'await window.import('), sb);
    return sb;
}
const d = (id, datos) => ({ id, data: () => datos });
const ANTES = '2026-10-08T10:00:00.000Z';
const T = (h) => '2026-10-09T' + h + ':00.000Z';
const informe = (h) => ({ sender: 'coach', text: '📊 Informe de partido', timestamp: T(h), type: 'report' });

(async () => {
    console.log('\n── PARTE 2 · [CAPTURAS 11292-11294] el Director con 7 avisos de informes ──');
    const hiloInformes = d(CLUB + '_' + DIR, { participants: [COA, DIR, COA2],
        messages: ['10:00', '10:05', '10:10', '10:15', '10:20', '10:25', '10:30'].map(informe) });
    const chatCoach = d(par(DIR, COA, 'coach_director'), { participants: [COA, DIR], messages: [] });
    const marcas = { threads: { [hiloInformes.id]: ANTES, [chatCoach.id]: ANTES } };
    const yoDir = { uid: DIR, clubId: CLUB, role: 'director', _activeRole: 'director' };

    let w = cargar({ yo: yoDir, hilos: [hiloInformes, chatCoach], marcas });
    let r = await w.ubContarNoLeidos(true);
    ok('2a · control · SIN la regla de la bandeja salen los 7 de la captura', r.total === 7, JSON.stringify(r));

    w = cargar({ yo: yoDir, hilos: [hiloInformes, chatCoach], marcas, conRegla: true });
    r = await w.ubContarNoLeidos(true);
    ok('2b · 🔑🔑 con la regla, la insignia se queda en 0 (la bandeja no tiene nada que enseñar)',
       r.total === 0, JSON.stringify(r));

    console.log('\n── PARTE 3 · lo que SÍ tiene que encender la insignia ──');
    const chatReal = d(par(DIR, COA, 'coach_director'), { participants: [COA, DIR], messages: [
        { senderUid: COA, senderRole: 'coach', text: '¿Mañana entreno a las 18?', timestamp: T('11:00') },
        { senderUid: DIR, senderRole: 'director', text: 'Sí', timestamp: T('11:01') },
        { senderUid: COA, senderRole: 'coach', text: 'Perfecto', timestamp: T('11:02') },
        { senderUid: COA, senderRole: 'coach', text: '   ', timestamp: T('11:03') },
        { senderUid: COA, senderRole: 'coach', timestamp: T('11:04'), type: 'meta' },
    ] });
    w = cargar({ yo: yoDir, hilos: [hiloInformes, chatReal],
                 marcas: { threads: { [hiloInformes.id]: ANTES, [chatReal.id]: ANTES } }, conRegla: true });
    r = await w.ubContarNoLeidos(true);
    ok('3a · 🔑 cuentan los mensajes de TEXTO del entrenador en su chat (2), no los míos',
       r.total === 2, JSON.stringify(r));
    ok('3b · ⚠️ y no cuentan los vacíos ni las entradas sin texto (metadatos)', r.privados === 2);
    await w.ubMarcas();
    ok('3c · 🔑 la lista de contactos dice lo MISMO que la tarjeta (2 en ese chat, 0 en el de avisos)',
       w.ubNoLeidosDeHilo(chatReal.id, chatReal.data()) === 2 &&
       w.ubNoLeidosDeHilo(hiloInformes.id, hiloInformes.data()) === 0);

    const canal = [d('c1', { clubId: CLUB, senderUid: CRD, senderRole: 'coordinator', text: 'Reunión el lunes', createdAt: T('12:00') }),
                   d('c2', { clubId: CLUB, senderUid: CRD, senderRole: 'coordinator', createdAt: T('12:01') })];
    w = cargar({ yo: yoDir, hilos: [], canal, veCanal: true, conRegla: true,
                 marcas: { threads: {}, staffChannel: ANTES, staffChannelByPlaza: { director: ANTES } } });
    r = await w.ubContarNoLeidos(true);
    ok('3d · el Canal Club cuenta sus mensajes de texto de otros (1), no las entradas sin texto',
       r.canal === 1, JSON.stringify(r));

    const chatFam = d(par(COA, FAM, 'coach_parent'), { participants: [COA, FAM], messages: [
        { senderUid: FAM, senderRole: 'parent', text: 'Mi hijo no puede ir', timestamp: T('13:00') }] });
    const yoCoach = { uid: COA, clubId: CLUB, role: 'user', _activeRole: 'coach' };
    w = cargar({ yo: yoCoach, hilos: [chatFam], marcas: { threads: { [chatFam.id]: ANTES } }, conRegla: true });
    r = await w.ubContarNoLeidos(true);
    ok('3e · el entrenador sí ve el aviso del familiar en SU bandeja', r.total === 1, JSON.stringify(r));

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '' : '  ✅'));
    process.exit(fallos ? 1 : 0);
})();
