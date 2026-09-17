// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v728 · LA LOGÍSTICA DEL CLUB, EN DIRECTO
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-17, punto 2): *"Cuando el
//  director deportivo introduce el calendario de temporada o envía los
//  entrenamientos semanales… los entrenadores deben verlo al instante, sin
//  necesidad de salir y entrar varias veces de las pantallas."*
//
//  🔑 LO MEDIDO ANTES DE TOCAR NADA — las tres pantallas leían FOTOS:
//    · cuadrante del club en la Planificación Semanal → `getDoc` + caché 60 s;
//    · calendario oficial (desplegable de jornadas) → `getDoc` + caché DE
//      SESIÓN, que sólo se invalida AL ESCRIBIR… y quien escribe es el
//      director, en su propio navegador. Para el entrenador que ya tenía la
//      app abierta, el mes leído quedaba congelado hasta recargar la app;
//    · Convocatorias/Entrenamientos del Panel de Dirección → `getDocs`.
//
//  🚨 POR QUÉ SE EJECUTA club-live-sync.js EN VEZ DE MIRARLO: los dos fallos
//  posibles son mudos y caros. Un listener duplicado por pasada no da error,
//  sólo cobra lecturas y repinta de más (v719); y un `onSnapshot` sin callback
//  de error queda MUERTO tras un `permission-denied` sin que nadie se entere,
//  dejando la pantalla congelada con cara de estar al día (v717).
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
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const LIVE   = leer('js/services/club-live-sync.js');
const CAL    = leer('js/coach/reports/calendario-temporada.js');
const CQ     = leer('js/coach/reports/cuadrante-club.js');
const EVENTS = leer('js/coach/reports/events-tab.js');
const IMPORT = leer('js/ai/import.js');
const CLUBR  = leer('js/coach/reports/club-reports.js');
const INDEX  = leer('index.html');
const SW     = leer('sw.js');
const SEC    = leer('js/core/security-and-state.js');

// ── El Firestore de mentira ──────────────────────────────────────────────
function montar() {
    const est = { abiertas: 0, bajas: 0, conError: 0, sinError: 0, rutas: [] };
    const vivos = [];
    const saFS = () => Promise.resolve({
        db: {},
        doc: (db, ...ruta) => ({ _ruta: ruta.join('/') }),
        collection: (db, c) => ({ _col: c }),
        where: (campo, op, valor) => ({ campo, op, valor }),
        query: (col, ...cond) => ({ col, cond }),
        onSnapshot: (ref, alDato, alError) => {
            est.abiertas++;
            est.rutas.push(ref._ruta || (ref.col && ref.col._col) || '?');
            if (typeof alError === 'function') est.conError++; else est.sinError++;
            const vivo = { ref, alDato, alError, activo: true };
            vivos.push(vivo);
            return () => { vivo.activo = false; est.bajas++; };
        },
    });
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        Promise, Object, Array, Map, Set, JSON, String, Date, Error,
    };
    sb.window = sb;
    sb.saFS = saFS;
    sb._cronosCurrentUser = { uid: 'uid-dd', clubId: 'club-1' };
    vm.createContext(sb);
    vm.runInContext(LIVE, sb, { filename: 'club-live-sync.js' });
    est.sb = sb;
    est.vivos = vivos;
    // Entrega un snapshot a todas las escuchas vivas de un documento.
    est.entregarDoc = (datos) => vivos.filter(v => v.activo)
        .forEach(v => v.alDato({ exists: () => datos !== null, data: () => datos }));
    est.romper = (codigo) => vivos.filter(v => v.activo)
        .forEach(v => v.alError({ code: codigo, message: codigo }));
    return est;
}
const respirar = () => new Promise(r => setImmediate(r));

(async function () {
  try {

console.log('\n── PARTE 1 · el mecanismo de escucha (club-live-sync.js) ──');
{
    const e = montar();
    const vistos = [];
    const baja1 = e.sb.cronosEscuchaDocClub(['trainingPlans', 'club-1', 'weeks', '2026-09-14'], d => vistos.push(d));
    await respirar();
    ok('1a · se abre la escucha del documento pedido', e.abiertas === 1 && /trainingPlans\/club-1\/weeks/.test(e.rutas[0]),
       JSON.stringify(e.rutas));
    ok('1b · ⚠️ SIEMPRE con callback de error (v717: sin él queda muerta en silencio)',
       e.conError === 1 && e.sinError === 0);

    // Segundo suscriptor a la MISMA clave: no puede abrir otra escucha.
    const baja2 = e.sb.cronosEscuchaDocClub(['trainingPlans', 'club-1', 'weeks', '2026-09-14'], () => {});
    await respirar();
    ok('1c · 🔑 una clave, UNA escucha, por muchas veces que se pida (v719)',
       e.abiertas === 1, 'abiertas=' + e.abiertas);

    e.entregarDoc({ publicadoEn: 'x' });
    ok('1d · el dato llega a quien se suscribió', vistos.length === 1 && vistos[0].publicadoEn === 'x');

    baja1();
    ok('1e · con un suscriptor de dos, la escucha sigue abierta', e.bajas === 0);
    baja2();
    ok('1f · sin suscriptores, se cierra de verdad', e.bajas === 1);
}
{
    // Un suscriptor que revienta no puede llevarse por delante a los demás.
    const e = montar();
    const vistos = [];
    e.sb.cronosEscuchaDocClub(['a', 'b', 'c', 'd'], () => { throw new Error('reviento'); });
    e.sb.cronosEscuchaDocClub(['a', 'b', 'c', 'd'], () => vistos.push(1));
    await respirar();
    e.entregarDoc({});
    ok('1g · un suscriptor que falla no deja sin aviso a los demás', vistos.length === 1);
}
{
    // permission-denied: la escucha está muerta. Hay que soltarla para que se
    // pueda volver a abrir; si se diera por viva, la pantalla se quedaría
    // congelada creyendo estar al día (v717).
    const e = montar();
    e.sb.cronosEscuchaDocClub(['a', 'b', 'c', 'd'], () => {});
    await respirar();
    ok('1h · mientras vive, consta como abierta', e.sb.cronosEscuchasClubAbiertas().length === 1);
    e.romper('permission-denied');
    ok('1i · 🔑 tras un permission-denied la clave se suelta (se puede reabrir)',
       e.sb.cronosEscuchasClubAbiertas().length === 0);
}
{
    const e = montar();
    e.sb.cronosEscuchaDocClub(['a', 'b', 'c', 'd'], () => {});
    e.sb.cronosEscuchaConsultaClub('notif|club-1|convocatoria',
        (f) => f.query(f.collection(f.db, 'cronos_notifications'), f.where('clubId', '==', 'club-1')), () => {});
    await respirar();
    ok('1j · la consulta también se escucha con su callback de error',
       e.abiertas === 2 && e.conError === 2);
    e.sb.cronosCerrarEscuchasClub();
    ok('1k · al cerrar sesión se cierran TODAS', e.bajas === 2 && e.sb.cronosEscuchasClubAbiertas().length === 0);
}
{
    // Sin sesión no se abre nada: una suscripción anónima se come un
    // permission-denied y deja la clave ocupada con un listener muerto.
    const e = montar();
    e.sb._cronosCurrentUser = null;
    e.sb.cronosEscuchaDocClub(['a', 'b', 'c', 'd'], () => {});
    await respirar();
    ok('1l · sin sesión no se abre ninguna escucha', e.abiertas === 0);
}

console.log('\n── PARTE 2 · el CALENDARIO deja de estar congelado ──');
ok('2a · 🔑 el mes que se lee se queda escuchando',
   /_calEscuchaMes\(clubId, mes\)/.test(CAL) && /cronosEscuchaDocClub/.test(CAL));
ok('2b · …también cuando la respuesta sale de la caché (si no, el primer ' +
   'lector de la sesión sería el único que se entera)',
   /if \(c\) \{ _calEscuchaMes\(clubId, mes\); return c\.partidos; \}/.test(CAL));
ok('2c · ⚠️ el primer aviso no repinta: es la foto que se acaba de leer',
   /if \(primero\) \{ primero = false; return; \}/.test(CAL));
ok('2d · al cambiar de verdad se refresca la caché del mes',
   /window\._calState\.cache\[clave\] = \{ partidos: \(datos && datos\.partidos\) \|\| \{\}/.test(CAL));
ok('2e · y se avisa a las pantallas con un evento (no se las llama una a una)',
   /dispatchEvent\(new CustomEvent\('cronos:calendario-cambiado'/.test(CAL));
ok('2f · una clave, una escucha, también aquí',
   /if \(window\._calState\.escuchas && window\._calState\.escuchas\[clave\]\) return;/.test(CAL));

console.log('\n── PARTE 3 · quién escucha ese aviso ──');
ok('3a · el desplegable de jornadas se puede volver a llenar sin cerrar la convocatoria',
   /window\._convRecargarCalendario = async function _convCargarCalendario/.test(IMPORT));
ok('3b · y se repinta solo cuando cambia el calendario',
   /cronos:calendario-cambiado[\s\S]{0,300}_convRecargarCalendario\(\)/.test(IMPORT));
ok('3c · ⚠️ con UN solo oyente, no uno por apertura de la pantalla (v719)',
   /if \(!window\._convCalOyenteListo\)/.test(IMPORT));
ok('3d · …y sólo si la pantalla sigue abierta',
   /if \(!document\.getElementById\('conv-cal-box'\)\) return;/.test(IMPORT));
ok('3e · la parrilla del cuadrante también se entera',
   /cronos:calendario-cambiado[\s\S]{0,300}_cqPintar\(\)/.test(CQ));

console.log('\n── PARTE 4 · el CUADRANTE del entrenador, en vivo ──');
ok('4a · 🔑 la semana que se está mirando se escucha',
   /function _cqEscuchaDirectriz\(clubId, weekKey, contenedorId\)/.test(CQ) &&
   /cronosEscuchaDocClub\(\s*\['trainingPlans', clubId, 'weeks', _cqDocId\(weekKey\)\]/.test(CQ));
ok('4b · se engancha al pintar la directriz del club',
   /cronosPintarDirectrizClub = async function[\s\S]{0,400}_cqEscuchaDirectriz\(_club, weekKey, contenedorId\)/.test(CQ));
ok('4c · ⚠️ al pasar de semana con ◀ ▶ se cierra la anterior (no 52 escuchas)',
   /if \(_cqDirectrizEscuchada === clave\) return;[\s\S]{0,200}_cqBajaDirectriz\(\)/.test(CQ));
ok('4d · cuando llega un cambio se tira la caché de 60 s de esa semana',
   /delete _cqCacheDirectriz\[k\]/.test(CQ));
ok('4e · el primer aviso tampoco repinta aquí',
   /_cqEscuchaDirectriz[\s\S]{0,700}if \(primero\) \{ primero = false; return; \}/.test(CQ));

console.log('\n── PARTE 5 · CONVOCATORIAS y ENTRENAMIENTOS del Panel de Dirección ──');
ok('5a · 🔑 la pestaña abierta escucha la MISMA consulta que ya lee (v674)',
   /_sdEscucharEventos\(type, clubId\)/.test(EVENTS) &&
   /fs\.where\('clubId', '==', clubId\), fs\.where\('type', '==', type\)/.test(EVENTS));
ok('5b · y se repinta con `_sdLoadEvents` cuando llega algo nuevo',
   /if \(primero\) \{ primero = false; return; \}[\s\S]{0,400}_sdLoadEvents\(type\)/.test(EVENTS));
ok('5c · ⚠️ se da de baja al salir de la pestaña (la lección de v439)',
   /window\._sdDesconectarEventos = _sdDesconectarEventos/.test(EVENTS) &&
   /_sdDesconectarEventos\(\)/.test(CLUBR));
ok('5d · …en el mismo sitio donde ya se daba de baja la del cuadrante',
   /_cqDesconectar\(\)[\s\S]{0,500}_sdDesconectarEventos\(\)/.test(CLUBR));
ok('5e · si el panel ya no está, se suelta en vez de repintar un contenedor ajeno',
   /if \(!document\.getElementById\('staff-dashboard-content'\)\) \{ _sdDesconectarEventos\(\); return; \}/.test(EVENTS));

console.log('\n── PARTE 6 · el módulo está cargado y cacheado ──');
ok('6a · index.html carga club-live-sync.js', /js\/services\/club-live-sync\.js\?v=/.test(INDEX));
// ⚠️ Se comparan las ETIQUETAS <script>, no el nombre suelto: el comentario
// que acompaña a la carga nombra a los consumidores y un `indexOf` a pelo
// encontraría antes esa mención que la etiqueta de verdad.
ok('6b · …antes que sus consumidores',
   INDEX.indexOf('<script src="js/services/club-live-sync.js') <
   INDEX.indexOf('<script src="js/coach/reports/calendario-temporada.js'));
ok('6c · y está en el precache del Service Worker',
   /'\.\/js\/services\/club-live-sync\.js'/.test(SW));
ok('6d · las escuchas se cierran al cerrar sesión',
   /cronosCerrarEscuchasClub\(\)/.test(SEC));

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);

  } catch (e) {
    console.log('\n✗ el arnés reventó: ' + (e && e.message));
    console.log('\n' + (total - fallos) + '/' + (total + 1) + ' aserciones OK');
    process.exit(1);
  }
})();
