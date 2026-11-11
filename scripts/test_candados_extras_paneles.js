// ─────────────────────────────────────────────────────────────────────────
// test_candados_extras_paneles.js · v852
//
// Encargo del autor (implementar.txt 2026-11-11, capturas 11817/11821): con
// un extra apagado en el panel del SuperAdmin (Cuadrante, Mensajería…), la
// tarjeta del tablero del Administrador Individual, del Coordinador y del
// Director debe salir con 🔒 y «Extra no activado…», como Vídeos — y
// enterarse AL MOMENTO, sin recargar.
//
// Causas encontradas y que este test congela:
//   A. Panel del ente: las puertas eran CONSTANTES calculadas una vez; el
//      tablero nunca se repintaba; los extras del ente no se aplicaban al
//      usuario; Mensajes no miraba `mensajeria`.
//   B. Tablero de Dirección/Coordinación: Convocatorias, Entrenamientos,
//      Informes, Mensajes y En Vivo sin candado.
//   C. Modo diagnóstico del SA y plazas de ente sin `clubId`: no se cargaba
//      ningún extra (todo «ausente = activo»).
// ─────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let fail = 0, pass = 0;
const ok = (n, c, extra) => {
    if (c) { pass++; console.log('PASS ' + n); }
    else { fail++; console.log('FAIL ' + n); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

// Trocea un array de opciones de tablero en sus objetos `{ icono: … }`.
function opciones(src, desde, hasta) {
    const i = src.indexOf(desde);
    const trozo = src.slice(i, src.indexOf(hasta, i));
    return trozo.split(/\{\s*icono:/).slice(1).map(t => {
        const titulo = (t.match(/titulo:\s*'([^']+)'/) || [])[1] || '?';
        return { titulo, txt: t };
    });
}

// ═══ A · Panel del Administrador Individual ═════════════════════════════
const IND = leer('js/admin/individual/panel.js');
ok('A1 · _indOpciones es una FUNCIÓN (se recalcula en cada pintado)', /const _indOpciones = \(\) => \[/.test(IND));
ok('A2 · _indMenuHtml es una FUNCIÓN y indTab la LLAMA', /const _indMenuHtml = \(\) =>/.test(IND) && /cuerpo\.innerHTML = _indMenuHtml\(\);/.test(IND));
ok('A3 · las puertas del cuadrante/secretaría son funciones',
   /const _indCuadranteOn = \(\) =>/.test(IND) && /const _indSecMotivo = \(\) =>/.test(IND)
   && !/if \(!_indCuadranteOn\)/.test(IND) && !/if \(_indSecMotivo\)/.test(IND));

const indOps = opciones(IND, 'const _indOpciones = () => [', '\n    ];');
const ESPERADAS_IND = {
    'Cuadrante':  /bloqueado:\s*_indCuadranteMotivo\(\)/,
    'Secretaría': /bloqueado:\s*_indSecMotivo\(\)/,
    'Vídeos':     /bloqueado:\s*\(window\.CronosClips/,
    'Mensajes':   /bloqueado:\s*_indMensajeriaMotivo\(\)/,
};
for (const [t, re] of Object.entries(ESPERADAS_IND)) {
    const o = indOps.find(x => x.titulo === t);
    ok('A4 · tarjeta «' + t + '» del ente con candado', !!o && re.test(o.txt));
}
ok('A5 · Mensajes del ente: portero `mensajeria` también en el clic',
   /_cronosExtraGate\('mensajeria'/.test((indOps.find(x => x.titulo === 'Mensajes') || {}).txt || ''));
ok('A6 · Secretaría del ente NO depende de `secretaria` (sub-opción del Director, como en el Admin de Club)',
   !/_indExtraOn\('secretaria'\)/.test(IND));
ok('A7 · el panel aplica los extras del ente (entityData.extras) antes de pintar',
   /const ex = entityData && entityData\.extras;[\s\S]{0,700}vig\.extras = ex;/.test(IND));
ok('A8 · el panel escucha `cronos-extras-cambiados` y repinta', /addEventListener\('cronos-extras-cambiados'[\s\S]{0,900}window\.indTab\(s\)/.test(IND));
ok('A9 · el panel pide la relectura en vivo (cronosRefrescaExtras(true))', /cronosRefrescaExtras\(true\)/.test(IND));

// A10 · Comportamiento: el oyente repinta el menú, y una sección abierta
//       SÓLO cuando su extra se apaga.
(function () {
    const m = IND.match(/window\.addEventListener\('cronos-extras-cambiados', (\(\) => \{[\s\S]*?\n        \})\);/);
    ok('A10a · oyente localizable', !!m);
    if (!m) return;
    const llamadas = [];
    const sb = {
        window: { _indSeccionActual: 'menu', indTab: (s) => llamadas.push(s), _cronosExtraEnabled: (k) => sb.__extras[k] !== false },
        document: { getElementById: () => ({}) },
        __extras: {},
    };
    vm.createContext(sb);
    const fn = vm.runInContext('(' + m[1] + ')', sb);
    fn(); ok('A10b · en el menú, repinta', llamadas.join() === 'menu');
    llamadas.length = 0; sb.window._indSeccionActual = 'cuadrante'; fn();
    ok('A10c · en el cuadrante con el extra encendido, NO repinta (no tira la edición)', llamadas.length === 0);
    sb.__extras.cuadrante = false; fn();
    ok('A10d · en el cuadrante al apagarlo, repinta (sale el candado)', llamadas.join() === 'cuadrante');
})();

// ═══ B · Tablero de Dirección / Coordinación ════════════════════════════
const CR = leer('js/coach/reports/club-reports.js');
const crOps = opciones(CR, 'const _opciones = [', '\n        ];');
const mapa = (() => {
    const sb = { window: {} };
    vm.createContext(sb);
    const m = CR.match(/window\.CRONOS_SD_EXTRA_DE_SECCION = \{[\s\S]*?\};/);
    vm.runInContext(m ? m[0] : '', sb);
    return sb.window.CRONOS_SD_EXTRA_DE_SECCION || {};
})();
ok('B1 · tabla sección→extra con las seis secciones contratables',
   ['cuadrante', 'convocatorias', 'entrenamientos', 'informes', 'mensajes', 'partidos_terminados']
       .every(k => mapa[k]) && mapa.mensajes === 'mensajeria', mapa);
const sinCandado = crOps.filter(o => {
    const tab = (o.txt.match(/switchStaffTab\('([a-z_]+)'\)/) || [])[1];
    return tab && mapa[tab] && !/bloqueado:/.test(o.txt);
}).map(o => o.titulo);
ok('B2 · toda tarjeta de una sección con extra lleva `bloqueado`', sinCandado.length === 0, sinCandado);
const vivo = crOps.find(o => o.titulo === 'En Vivo');
ok('B3 · «En Vivo» con candado `partidos_en_vivo` (tarjeta y clic)',
   !!vivo && /bloqueado:\s*_sdMotivo\('partidos_en_vivo'\)/.test(vivo.txt) && /_cronosExtraGate\('partidos_en_vivo'/.test(vivo.txt));
ok('B4 · segunda puerta en switchStaffTab por la misma tabla', /cronosSdExtraDeSeccion\(tab\)[\s\S]{0,900}no disponible/.test(CR));
ok('B5 · el oyente de Dirección repinta también la sección abierta cuyo extra se apaga',
   /_sdTabActual[\s\S]{0,400}\[k\] === false\) window\.switchStaffTab\(t\)/.test(CR));
ok('B6 · el texto del candado es el mismo que el de Vídeos',
   /_sdMotivo = \(k\) => \(_extras\[k\] !== false\) \? ''\s*: 'Extra no activado para tu club\. Habla con el administrador\.'/.test(CR));

// B7 · Comportamiento real: club-reports.js ejecutado en un sandbox (mismo
//      arnés que test_extra_cuadrante.js), con las opciones que DECLARA.
function sandboxCR(extras) {
    const sb = {};
    vm.createContext(sb);
    sb.window = sb; sb.self = sb;
    const nuevo = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, innerHTML: '',
        addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] });
    const els = {};
    sb.__els = els;
    sb.document = { getElementById: id => (els[id] || (els[id] = nuevo())), querySelector: () => null,
        querySelectorAll: () => [], createElement: nuevo, addEventListener() {}, body: nuevo() };
    sb.console = { log() {}, warn() {}, error() {} };
    sb.setTimeout = (f) => { try { typeof f === 'function' && f(); } catch (e) { /* nada */ } return 0; };
    sb.setInterval = () => 0; sb.clearInterval = () => {}; sb.clearTimeout = () => {};
    sb.showToast = () => {}; sb.showSpinner = () => {}; sb.hideSpinner = () => {};
    sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    sb.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
    sb.navRootScreen = () => {};
    sb.addEventListener = () => {};
    sb._cronosCurrentUser = { role: 'director', clubId: 'c1', extras };
    sb.__cargado = 0;
    sb._sdLoadCuadrante = () => { sb.__cargado++; };
    try { vm.runInContext(CR, sb, { timeout: 15000 }); } catch (e) { /* lo que no haga falta */ }
    sb._sdCanSeeConfigTab = () => true; sb.window._sdCanSeeConfigTab = sb._sdCanSeeConfigTab;
    return sb;
}
const APAGADOS = { convocatorias: false, entrenamientos: false, informes: false, mensajeria: false,
                   partidos_en_vivo: false, partidos_terminados: false, cuadrante: false };
const B7 = (async () => {
    for (const [nombre, extras, debenBloquear] of [
        ['todo apagado', APAGADOS, true],
        ['extras ausentes (club antiguo)', {}, false],
    ]) {
        const sb = sandboxCR(extras);
        let ops = null;
        sb.cronosTableroHtml = (cfg) => { ops = (cfg && cfg.opciones) || []; return '<div></div>'; };
        try { await sb.switchStaffTab('menu'); } catch (e) { /* abajo se ve */ }
        const t = ['Cuadrante', 'Convocatorias', 'Entrenamientos', 'Informes', 'Mensajes', 'Partidos Terminados', 'En Vivo'];
        const mal = t.filter(x => {
            const o = (ops || []).find(op => op.titulo === x);
            return !o || (!!o.bloqueado !== debenBloquear);
        });
        ok('B7 · tablero de Dirección, ' + nombre + ': las 7 tarjetas ' + (debenBloquear ? 'CON' : 'SIN') + ' candado', mal.length === 0, mal);
    }
    {
        const sb = sandboxCR({ informes: false });
        try { await sb.switchStaffTab('informes'); } catch (e) { /* abajo se ve */ }
        const html = (sb.__els['staff-dashboard-content'] || {}).innerHTML || '';
        ok('B8 · entrar en Informes con el extra apagado (pila/consola) → pantalla 🔒', /🔒/.test(html) && /no disponible/.test(html), html.slice(0, 120));
    }
})();

// ═══ C · Carga de extras ═════════════════════════════════════════════════
ok('C1 · el modo diagnóstico relee los extras de la entidad diagnosticada',
   /_testRoleClubId = null;[\s\S]{0,900}cronosRefrescaExtras\(true\)/.test(leer('js/admin/superadmin/diagnostico.js')));
ok('C2 · el arranque carga los extras también por individualEntityId',
   /const clubId2 = roleEntry\.clubId \|\| roleEntry\.individualEntityId\s*\|\| me\.clubId \|\| me\.individualEntityId;/.test(leer('js/services/auth/role-launch.js')));

B7.then(() => {
    console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
});
