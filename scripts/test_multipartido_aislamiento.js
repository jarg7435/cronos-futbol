// ─────────────────────────────────────────────────────────────────────────
// test_multipartido_aislamiento.js  ·  dos partidos abiertos a la vez por el
// MISMO entrenador, sin que se pisen (v465)
//
// Reporte del autor (capturas 8474 y 8475): con un Alevín C y un Juvenil B
// abiertos al mismo tiempo, los datos y sucesos de UNO de los dos dejaban de
// llegar al panel en vivo.
//
// LA CAUSA NO ERA FIRESTORE. Todo el estado del partido en curso vivía en UNA
// clave de localStorage, `cronos_active_match_v2`, y localStorage es
// COMPARTIDO POR TODAS LAS PESTAÑAS del mismo origen. De ahí salen los cuatro
// daños que este guard reproduce y fija:
//
//  A · LAS DOS PESTAÑAS AUTOGUARDABAN EN LA MISMA CLAVE cada 5 s. Ganaba la
//      última, así que la clave dejaba de describir de forma fiable a
//      ninguno de los dos partidos.
//
//  B · ⚠️ EL DAÑO GRANDE: `endMatch` hacía `removeItem` de esa clave y
//      levantaba la bandera GLOBAL `cronos_active_match_v2_finished`. Al
//      terminar el Alevín, la pestaña del Juvenil —que seguía en juego— leía
//      esa bandera al recargarse, BORRABA su estado y se quedaba sin
//      liveMatchId, sin banner de retomar y sin latido: dejaba de emitir.
//      En un móvil esto no es raro, es lo normal: el sistema desaloja
//      pestañas en segundo plano y cada actualización del SW fuerza otra
//      recarga.
//
//  C · Sin llegar a terminar ninguno: una pestaña que se recargaba después de
//      que la otra hubiera escrito restauraba el estado del partido AJENO,
//      `liveMatchId` incluido, y se ponía a emitir con la identidad
//      equivocada — los dos escribiendo en el mismo documento.
//
//  D · `_guardAgainstMatchReset` avisaba de "hay un partido en curso" leyendo
//      esa misma clave, así que al abrir el SEGUNDO partido hablaba del
//      PRIMERO, y aceptar reanudaba el ajeno encima del nuevo.
//
// LO QUE HACE ESTE GUARD: carga js/core/match-slots.js DE VERDAD en dos
// sandboxes que comparten un localStorage simulado y tienen sessionStorage
// SEPARADOS — que es exactamente lo que son dos pestañas del mismo navegador —
// y comprueba el comportamiento. No mira el fuente salvo donde no queda otra.
//
// 🔑 LA PIEZA QUE NO SE PUEDE QUITAR: la pertenencia de la pestaña vive en
// sessionStorage. Separar las claves por partido NO arregla nada por sí solo:
// al recargar, la pestaña seguiría sin saber cuál de las dos ranuras es la
// suya. Hay una parte entera dedicada a eso (PARTE 3).
// ─────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const SLOTS_SRC = fs.readFileSync(path.join(ROOT, 'js', 'core', 'match-slots.js'), 'utf8');
const APPINIT   = fs.readFileSync(path.join(ROOT, 'js', 'core', 'app-init.js'), 'utf8');
const ACTIVEM   = fs.readFileSync(path.join(ROOT, 'js', 'match', 'persistence', 'active-match.js'), 'utf8');
const SYNC      = fs.readFileSync(path.join(ROOT, 'js', 'match', 'live', 'sync.js'), 'utf8');
const SETUP     = fs.readFileSync(path.join(ROOT, 'js', 'core', 'setup-modal.js'), 'utf8');
const FSTORE    = fs.readFileSync(path.join(ROOT, 'js', 'services', 'firestore-storage.js'), 'utf8');
const INDEX     = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

console.log('── aislamiento de partidos simultáneos (v465) ──\n');

// ══════════ Almacenes simulados ══════════
// localStorage: UNO SOLO, compartido. Es la propiedad del navegador que causó
// el fallo, así que simularla mal sería no probar nada.
function crearAlmacen() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
        get length() { return m.size; },
        key: (i) => Array.from(m.keys())[i],
        _mapa: m,
    };
}
// Object.keys(localStorage) sobre un objeto plano devuelve sus claves propias;
// para que el sandbox se comporte como el navegador, se expone un Proxy que
// enumera las claves guardadas.
function comoStorage(almacen) {
    return new Proxy(almacen, {
        ownKeys: () => Array.from(almacen._mapa.keys()),
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
        get: (t, p) => (typeof t[p] === 'function' ? t[p].bind(t) : t[p]),
    });
}

// Una "pestaña": mismo localStorage, sessionStorage propio.
function abrirPestana(lsCompartido) {
    const sandbox = {
        localStorage:   comoStorage(lsCompartido),
        sessionStorage: comoStorage(crearAlmacen()),
        console: { warn() {}, log() {} },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(SLOTS_SRC, sandbox);
    return sandbox;
}

const estado = (o) => Object.assign({
    savedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    matchPhase: '1st_half', isRunning: true,
    masterTimeH1: 600, masterTimeH2: 0,
    teamNames: { home: 'CRONOS', away: 'RIVAL' },
    players: [{ id: 1 }],
}, o);

// ═══════════ PARTE 1 · las ranuras no se pisan ═══════════
console.log('── PARTE 1 · dos partidos, dos ranuras ──');
{
    const LS = crearAlmacen();
    const alevin  = abrirPestana(LS);
    const juvenil = abrirPestana(LS);

    alevin.window._cronosMatchSlots.setTabMatchId('cronos-alevin-1900');
    juvenil.window._cronosMatchSlots.setTabMatchId('cronos-juvenil-1900');

    alevin.window._cronosMatchSlots.guardar('cronos-alevin-1900',
        estado({ liveMatchId: 'cronos-alevin-1900', teamNames: { home: 'ALEVIN C', away: 'R1' } }));
    juvenil.window._cronosMatchSlots.guardar('cronos-juvenil-1900',
        estado({ liveMatchId: 'cronos-juvenil-1900', teamNames: { home: 'JUVENIL B', away: 'R2' } }));

    // A · el autoguardado de uno no pisa al otro.
    const a = alevin.window._cronosMatchSlots.leer('cronos-alevin-1900');
    const j = juvenil.window._cronosMatchSlots.leer('cronos-juvenil-1900');
    ok('1a · los dos estados coexisten en el localStorage COMPARTIDO',
       a && j && a.teamNames.home === 'ALEVIN C' && j.teamNames.home === 'JUVENIL B',
       JSON.stringify([a && a.teamNames.home, j && j.teamNames.home]));

    ok('1b · son claves distintas, con el matchId dentro',
       LS.getItem('cronos_active_match_v2::cronos-alevin-1900') !== null &&
       LS.getItem('cronos_active_match_v2::cronos-juvenil-1900') !== null);

    ok('1c · el inventario los ve a los dos',
       alevin.window._cronosMatchSlots.listar().length === 2);
}

// ═══════════ PARTE 2 · ⚠️ terminar uno NO apaga el otro ═══════════
// Ésta es la regresión exacta que reportó el autor.
console.log('\n── PARTE 2 · ⚠️ terminar el Alevín no puede tumbar al Juvenil ──');
{
    const LS = crearAlmacen();
    const alevin  = abrirPestana(LS);
    const juvenil = abrirPestana(LS);
    alevin.window._cronosMatchSlots.setTabMatchId('m-alevin');
    juvenil.window._cronosMatchSlots.setTabMatchId('m-juvenil');
    alevin.window._cronosMatchSlots.guardar('m-alevin', estado({ liveMatchId: 'm-alevin' }));
    juvenil.window._cronosMatchSlots.guardar('m-juvenil', estado({ liveMatchId: 'm-juvenil' }));

    // El entrenador termina el Alevín (lo que hace endMatch).
    alevin.window._cronosMatchSlots.cerrar('m-alevin', true);

    ok('2a · el Alevín queda cerrado', alevin.window._cronosMatchSlots.leer('m-alevin') === null);
    ok('2b · 🔑 el JUVENIL SIGUE VIVO (era el fallo: se apagaba con él)',
       juvenil.window._cronosMatchSlots.leer('m-juvenil') !== null);

    // Y lo que de verdad pasaba: la pestaña del Juvenil se RECARGA.
    const juvenilRecargado = abrirPestana(LS);
    juvenilRecargado.window.sessionStorage.setItem('cronos_tab_match', 'm-juvenil');
    const elegido = juvenilRecargado.window._cronosMatchSlots.elegir();
    ok('2c · 🔑 al recargarse, el Juvenil RECUPERA SU PARTIDO y sigue emitiendo',
       elegido && elegido.id === 'm-juvenil' && elegido.state.liveMatchId === 'm-juvenil',
       JSON.stringify(elegido && elegido.id));

    // La bandera de finalizado es POR PARTIDO, no global.
    ok('2d · la bandera de "terminado" lleva el id del partido que terminó',
       LS.getItem('cronos_active_match_v2_finished::m-alevin') !== null &&
       LS.getItem('cronos_active_match_v2_finished::m-juvenil') === null &&
       LS.getItem('cronos_active_match_v2_finished') === null);
}

// ═══════════ PARTE 3 · 🔑 cada pestaña recupera LO SUYO ═══════════
// Sin esta pieza, separar las claves no arregla nada.
console.log('\n── PARTE 3 · 🔑 la pertenencia va en sessionStorage (por pestaña) ──');
{
    const LS = crearAlmacen();
    const p1 = abrirPestana(LS);
    const p2 = abrirPestana(LS);
    p1.window._cronosMatchSlots.setTabMatchId('m-uno');
    p2.window._cronosMatchSlots.setTabMatchId('m-dos');
    // El SEGUNDO guarda DESPUÉS: con la clave única, era el que ganaba siempre.
    // ⚠️ FECHAS RELATIVAS AL RELOJ, NO FIJAS (arreglado 2026-08-08).
    // Antes iban a pelo ('2026-08-07T18:00:00.000Z' y las 18:05). El barrido de
    // ranuras caducadas de match-slots.js tira todo lo que pase de 6 h, así que
    // esta parte pasaba de verde a roja SOLA al cruzar esa frontera: seis horas
    // después de la hora escrita, y ya para siempre. Se detectó el 2026-08-08 a
    // las 01:07Z, con 7,03 h de desfase, en una sesión que no tocaba nada de
    // esto. Lo único que importa aquí es que el SEGUNDO se guarde DESPUÉS que
    // el primero, que es lo que la aserción 3c pone a prueba.
    const _t0 = Date.now() - 10 * 60 * 1000;   // hace 10 minutos, siempre vigente
    p1.window._cronosMatchSlots.guardar('m-uno', estado({ liveMatchId: 'm-uno', savedAt: new Date(_t0).toISOString() }));
    p2.window._cronosMatchSlots.guardar('m-dos', estado({ liveMatchId: 'm-dos', savedAt: new Date(_t0 + 5 * 60 * 1000).toISOString() }));

    ok('3a · la pertenencia NO está en localStorage (si no, se compartiría)',
       LS.getItem('cronos_tab_match') === null);
    ok('3b · cada pestaña declara un partido distinto',
       p1.window._cronosMatchSlots.getTabMatchId() === 'm-uno' &&
       p2.window._cronosMatchSlots.getTabMatchId() === 'm-dos');

    // 🔑 La pestaña 1 elige el SUYO aunque el otro se haya guardado después.
    const e1 = p1.window._cronosMatchSlots.elegir();
    ok('3c · 🔑 la pestaña 1 recupera m-uno, NO el más reciente del vecino',
       e1 && e1.id === 'm-uno' && e1.esDeEstaPestana === true, JSON.stringify(e1 && e1.id));
    const e2 = p2.window._cronosMatchSlots.elegir();
    ok('3d · y la pestaña 2 recupera m-dos', e2 && e2.id === 'm-dos');

    // Una pestaña NUEVA (sin partido propio) sí coge el más reciente: es el
    // caso de "he cerrado la app y vuelvo", donde no hay nada que reclamar.
    const p3 = abrirPestana(LS);
    const e3 = p3.window._cronosMatchSlots.elegir();
    ok('3e · una pestaña nueva ofrece el más reciente, marcado como NO suyo',
       e3 && e3.id === 'm-dos' && e3.esDeEstaPestana === false, JSON.stringify(e3 && e3.id));
}

// ═══════════ PARTE 4 · la migración desde v464 ═══════════
// ⚠️ Este despliegue puede caer con partidos EN JUEGO.
console.log('\n── PARTE 4 · ⚠️ migración: nadie pierde el partido en curso ──');
{
    const LS = crearAlmacen();
    LS.setItem('cronos_active_match_v2', JSON.stringify(estado({ liveMatchId: 'm-viejo' })));
    const p = abrirPestana(LS);   // el arranque del módulo migra solo

    ok('4a · 🔑 el partido de v464 se muda a su ranura y NO se pierde',
       p.window._cronosMatchSlots.leer('m-viejo') !== null);
    ok('4b · la clave única desaparece (nadie puede volver a leerla)',
       LS.getItem('cronos_active_match_v2') === null);
    ok('4c · y la pestaña que migra ADOPTA ese partido',
       p.window._cronosMatchSlots.getTabMatchId() === 'm-viejo');

    // Migración de un estado SIN liveMatchId (partido recién empezado): no se
    // puede tirar, es un partido en juego igual.
    const LS2 = crearAlmacen();
    LS2.setItem('cronos_active_match_v2', JSON.stringify(estado({ liveMatchId: null })));
    const p2 = abrirPestana(LS2);
    ok('4d · un estado sin liveMatchId también se conserva, con id de respaldo',
       p2.window._cronosMatchSlots.listar().length === 1,
       JSON.stringify(p2.window._cronosMatchSlots.listar().map(x => x.id)));

    // La bandera GLOBAL antigua se respeta una última vez y se retira.
    const LS3 = crearAlmacen();
    LS3.setItem('cronos_active_match_v2', JSON.stringify(estado({ liveMatchId: 'm-x' })));
    LS3.setItem('cronos_active_match_v2_finished', String(Date.now()));
    const p3 = abrirPestana(LS3);
    ok('4e · la bandera global antigua se honra una vez y se retira',
       p3.window._cronosMatchSlots.listar().length === 0 &&
       LS3.getItem('cronos_active_match_v2_finished') === null &&
       LS3.getItem('cronos_active_match_v2') === null);

    // Idempotente: arrancar dos veces no duplica ni borra.
    const LS4 = crearAlmacen();
    LS4.setItem('cronos_active_match_v2', JSON.stringify(estado({ liveMatchId: 'm-i' })));
    abrirPestana(LS4);
    const otra = abrirPestana(LS4);
    ok('4f · migrar dos veces no duplica ni pierde nada',
       otra.window._cronosMatchSlots.listar().length === 1);
}

// ═══════════ PARTE 5 · la ranura provisional se muda sola ═══════════
// Hay un hueco real entre "empieza el partido" y "startLiveSync fija el id".
console.log('\n── PARTE 5 · del id provisional al definitivo ──');
{
    const LS = crearAlmacen();
    const p = abrirPestana(LS);
    const S = p.window._cronosMatchSlots;

    const provisional = S.slotIdActual(null);
    ok('5a · sin liveMatchId todavía, hay un id de respaldo con el que guardar',
       !!provisional);
    S.guardar(provisional, estado({ liveMatchId: null, masterTimeH1: 42 }));

    // Llega el id de verdad (startLiveSync).
    S.setTabMatchId('m-definitivo');
    const mudado = S.leer('m-definitivo');
    ok('5b · 🔑 el estado se muda al id definitivo, no se pierde',
       mudado && mudado.masterTimeH1 === 42, JSON.stringify(mudado && mudado.masterTimeH1));
    ok('5c · y no queda una ranura huérfana con el id provisional',
       S.leer(provisional) === null);
    ok('5d · el inventario ve UNA sola, no dos',
       S.listar().length === 1, JSON.stringify(S.listar().map(x => x.id)));
}

// ═══════════ PARTE 6 · barrido y robustez ═══════════
console.log('\n── PARTE 6 · barrido y robustez ──');
{
    const LS = crearAlmacen();
    const p = abrirPestana(LS);
    const S = p.window._cronosMatchSlots;
    const viejo = new Date(Date.now() - 10 * 3600 * 1000).toISOString();
    S.guardar('m-viejo', estado({ savedAt: viejo, createdAt: viejo }));
    S.guardar('m-nuevo', estado({}));
    S.barrer(6);
    ok('6a · el barrido se lleva las ranuras rancias y respeta las vivas',
       S.leer('m-viejo') === null && S.leer('m-nuevo') !== null);

    // Un JSON corrupto no puede tumbar el arranque de la app.
    LS.setItem('cronos_active_match_v2::m-roto', '{esto no es json');
    ok('6b · una ranura corrupta se ignora, no revienta',
       S.listar().every(x => x.id !== 'm-roto') && S.elegir() !== undefined);

    // Safari con cookies bloqueadas lanza al TOCAR localStorage.
    const sandboxDuro = {
        localStorage: { getItem() { throw new Error('denegado'); },
                        setItem() { throw new Error('denegado'); },
                        removeItem() { throw new Error('denegado'); } },
        sessionStorage: comoStorage(crearAlmacen()),
        console: { warn() {}, log() {} },
    };
    sandboxDuro.window = sandboxDuro;
    vm.createContext(sandboxDuro);
    let reventó = false;
    try { vm.runInContext(SLOTS_SRC, sandboxDuro); } catch (e) { reventó = true; }
    ok('6c · con localStorage bloqueado (Safari sin cookies) el módulo CARGA',
       !reventó && !!sandboxDuro.window._cronosMatchSlots);

    // ⚠️ 6c NO DEMUESTRA QUE LOS ACCESOS ESTÉN BLINDADOS, aunque lo parezca.
    // Comprobado quitando el try/catch de `lsGet`: el guard seguía VERDE,
    // porque el arranque del módulo ya va envuelto en su propio try/catch y
    // ése se tragaba la excepción. O sea, la aserción pasaba por otro camino.
    // Lo que de verdad importa es que la API AGUANTE EN CALIENTE: el
    // autoguardado la llama cada 5 s y el fin de partido también. Si `guardar`
    // lanza dentro de endMatch, el partido no se puede terminar.
    const S2 = sandboxDuro.window._cronosMatchSlots;
    let reventóEnCaliente = null;
    try {
        S2.guardar('m-x', estado({}));
        S2.leer('m-x');
        S2.listar();
        S2.elegir();
        S2.cerrar('m-x', true);
        S2.barrer(6);
        S2.slotIdActual('m-y');
    } catch (e) { reventóEnCaliente = e && e.message; }
    ok('6d · ⚠️ y la API entera AGUANTA llamada en caliente, sin lanzar',
       reventóEnCaliente === null, 'lanzó: ' + reventóEnCaliente);
}

// ═══════════ PARTE 7 · el cableado en el producto ═══════════
// Lo que no se puede ejecutar aquí se ancla lo más estrecho posible.
console.log('\n── PARTE 7 · el cableado ──');

ok('7a · ⚠️ match-slots.js se carga ANTES que app-init.js',
   INDEX.indexOf('js/core/match-slots.js') !== -1 &&
   INDEX.indexOf('js/core/match-slots.js') < INDEX.indexOf('js/core/app-init.js'),
   'si carga después, app-init lee un almacén a medio migrar');

// ⚠️ LA ASERCIÓN QUE MÁS IMPORTA: que nadie reintroduzca la clave pelada.
// Es como se escribe sola la regresión — un `removeItem('cronos_active_match_v2')`
// de más y volvemos a apagar el partido del vecino.
const FUENTES = [
    ['app-init.js', APPINIT], ['setup-modal.js', SETUP], ['sync.js', SYNC],
    ['active-match.js', ACTIVEM], ['firestore-storage.js', FSTORE],
];
const culpables = [];
for (const [nombre, src] of FUENTES) {
    // Sólo llamadas REALES a localStorage con la clave pelada; los comentarios
    // que la mencionan para explicar el fallo no cuentan.
    const re = /localStorage\s*\.\s*(getItem|setItem|removeItem)\s*\(\s*['"]cronos_active_match_v2(_finished)?['"]/g;
    const m = src.match(re);
    if (m) culpables.push(nombre + ' (' + m.length + ')');
}
ok('7b · ⚠️ NADIE usa ya la clave pelada `cronos_active_match_v2`',
   culpables.length === 0, culpables.join(', '));

ok('7c · startLiveSync reclama el partido para SU pestaña',
   /_cronosMatchSlots\?\.setTabMatchId\(liveMatchId\)/.test(SYNC));

ok('7d · endMatch cierra sólo su ranura (no la clave global)',
   /_cronosMatchSlots\?\.cerrar\(/.test(ACTIVEM));

// D · el aviso anti-reinicio mira el partido DE ESTA PESTAÑA.
const bloqueGuard = APPINIT.slice(APPINIT.indexOf('function _guardAgainstMatchReset'),
                                  APPINIT.indexOf('function _guardAgainstMatchReset') + 1400);
ok('7e · ⚠️ _guardAgainstMatchReset mira SÓLO el partido de esta pestaña',
   /getTabMatchId\(\)/.test(bloqueGuard) && /S\.leer\(propio\)/.test(bloqueGuard),
   'si mira "el partido activo" a secas, abrir el segundo avisa del primero');

// El panel de recuperación tiene que poder enseñar los dos.
ok('7f · el panel de recuperación parte de TODAS las ranuras',
   /const localMatches = \[\]/.test(SETUP) &&
   /_cronosMatchSlots \? window\._cronosMatchSlots\.listar\(\)/.test(SETUP) &&
   /_fusionaCandidatosRecuperacion\(localMatches, docsNube\)/.test(SETUP));

// El refresco por sincronización remota reemplaza players y marcador: si lee
// "el partido activo" a secas, repinta una pestaña con el partido de la otra.
const bloqueRefresh = FSTORE.slice(FSTORE.indexOf('function _refreshMatchUI'),
                                   FSTORE.indexOf('function _refreshMatchUI') + 1600);
ok('7g · ⚠️ _refreshMatchUI sólo repinta con la ranura de ESTA pestaña',
   /getTabMatchId\(\)/.test(bloqueRefresh),
   'reemplaza window.players y el marcador: con la clave única repintaba el partido ajeno');

// ═══════════ Resultado ═══════════
console.log('\n────────────────────────────────');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail === 0 ? 0 : 1);
