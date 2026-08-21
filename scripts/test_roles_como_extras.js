// ═══════════════════════════════════════════════════════════════════════════
//  v596 · TRES ENCARGOS SOBRE LOS EXTRAS — GUARD
// ═══════════════════════════════════════════════════════════════════════════
//  1. La puerta de COMUNICACIONES en el panel del entrenador.
//  2. Las tarjetas de Partidos Terminados / Partidos en Vivo, APAGADAS.
//  3. Los ROLES como extras: Padres, Coordinador, Director y la sub-opcion
//     de Secretaria.
//
//  🔑🔑🔑 POR QUE ESTE GUARD EJECUTA EN VEZ DE CENSAR
//
//  El defecto #1 sobrevivio a v429 justo porque un censo de fuente lo daba
//  por cubierto: buscar "_cronosExtraGate('comunicaciones')" en el proyecto
//  encontraba UNA aparicion —en js/coach/comms/panel.js— y con eso parecia
//  que el extra tenia puerta. La tenia... en OTRA pantalla. La que abre el
//  entrenador desde su panel es _openCoachCommsMenu (js/core/setup-modal.js)
//  y entraba siempre.
//
//  Por eso las partes 2, 3 y 4 no miran el texto: EJECUTAN la funcion real en
//  un sandbox, con los extras apagados, y comprueban la DECISION —si pinto la
//  pantalla o no, si el boton salio con candado o no—. Un censo no distingue
//  "la regla esta escrita" de "la regla se aplica aqui"; ejecutar, si.
//
//  ⚠️ Y por eso mismo cualquier asercion de texto de este fichero borra los
//  comentarios antes de buscar: en este proyecto un guard ya dio VERDE tres
//  veces casando con un comentario que nombraba la funcion que faltaba.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); fallos++; }
}

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// Quita comentarios de linea SIN tocar los de bloque (que aqui llevan CSS).
// ⚠️ \r?\n, nunca \n pelado: el repositorio es CRLF.
const sinComs = (s) => s.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');

const SETUP   = leer('js/core/setup-modal.js');
const PANEL   = leer('js/coach/comms/panel.js');
const EXTRAS  = leer('js/admin/superadmin/extras-toggle.js');
const CLUBREP = leer('js/coach/reports/club-reports.js');
const LAUNCH  = leer('js/services/auth/role-launch.js');

// Extrae `window.NOMBRE = function...` hasta el `};` en columna 0.
function extraerAsignada(src, nombre) {
    const i = src.indexOf('window.' + nombre + ' =');
    if (i === -1) return null;
    const j = src.indexOf('\n};', i);
    if (j === -1) return null;
    return src.slice(i, j + 3);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · el catalogo de extras del SuperAdmin ──');
// ───────────────────────────────────────────────────────────────────────────
const defs = (() => {
    const s = EXTRAS.indexOf('window._CRONOS_EXTRAS_DEF');
    const e = EXTRAS.indexOf('\n];', s);
    const bloque = EXTRAS.slice(s, e);
    return (bloque.match(/key:\s*'([a-z_]+)'/g) || []).map(m => m.split("'")[1]);
})();

for (const k of ['rol_padres', 'rol_coordinador', 'rol_director', 'secretaria']) {
    ok('1 · el extra "' + k + '" existe en _CRONOS_EXTRAS_DEF', defs.includes(k), defs);
}
ok('1e · ⚠️ ninguna clave repetida (una key reutilizada apaga dos cosas a la vez)',
   new Set(defs).size === defs.length, defs);
ok('1f · ⚠️ NO se puede apagar el rol de entrenador ni el de admin de club',
   !defs.includes('rol_entrenador') && !defs.includes('rol_club_admin'), defs);

// El mapa rol→extra vive en un solo sitio y cubre los tres alias de familia.
const MAPA = (() => {
    const s = SETUP.indexOf('window.CRONOS_ROL_EXTRA = {');
    const e = SETUP.indexOf('};', s);
    return SETUP.slice(s, e);
})();
ok('1g · 🔑 los TRES alias de familia caen del mismo lado del interruptor',
   /parent:\s*'rol_padres'/.test(MAPA) &&
   /parent_individual:\s*'rol_padres'/.test(MAPA) &&
   /padre_individual:\s*'rol_padres'/.test(MAPA), MAPA);
ok('1h · director y coordinator estan mapeados',
   /director:\s*'rol_director'/.test(MAPA) && /coordinator:\s*'rol_coordinador'/.test(MAPA));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · 🔴 la puerta de COMUNICACIONES del entrenador ──');
// ───────────────────────────────────────────────────────────────────────────
//  Se EJECUTA _openCoachCommsMenu de verdad. El defecto original era que
//  entraba siempre: pintaba su modal con el extra apagado.
const FN_COMMS = extraerAsignada(SETUP, '_openCoachCommsMenu');
ok('2a · se puede aislar _openCoachCommsMenu del fuente', !!FN_COMMS);

function correrComms(extras) {
    const modal = { style: {}, innerHTML: '' };
    const avisos = [];
    const sandbox = {
        console, Object, Array, String, JSON,
        document: { getElementById: (id) => (id === 'setup-modal' ? modal : null) },
        showToast: (m) => avisos.push(String(m)),
        navScreen: function () { sandbox.window.__apilado = true; },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.__apilado = false;
    // Los tres porteros reales, copiados del fuente para no reimplementarlos.
    sandbox._cronosCurrentUser = { extras };
    vm.createContext(sandbox);
    const helpers = SETUP.slice(SETUP.indexOf('window._cronosExtraEnabled = function'),
                                SETUP.indexOf('// FIX: re-renderizar el modal'));
    vm.runInContext(helpers + '\n' + FN_COMMS, sandbox);
    sandbox.window._openCoachCommsMenu();
    return { html: modal.innerHTML, display: modal.style.display, avisos, apilado: sandbox.__apilado };
}

{
    const r = correrComms({ comunicaciones: false });
    ok('2b · 🔑🔑 CON EL EXTRA APAGADO NO PINTA LA PANTALLA (el defecto de v596)',
       r.html === '' && r.display === undefined, { html: r.html.length, display: r.display });
    ok('2c · y avisa del motivo', r.avisos.some(a => /no está disponible|no esta disponible/i.test(a)), r.avisos);
    ok('2d · ⚠️ tampoco la mete en la pila de navegacion (v425: apilar lo que no se abre)',
       r.apilado === false);
}
{
    const r = correrComms({ comunicaciones: true });
    ok('2e · con el extra activo entra con normalidad',
       r.html.includes('Comunicaciones') && r.display === 'flex', { display: r.display });
}
{
    // ⚠️ EL CLUB ANTIGUO SIN MAPA `extras`. Es el fallo mas caro posible aqui.
    const r = correrComms({});
    ok('2f · ⚠️⚠️ un club SIN mapa de extras entra (por defecto TODO activo, `!== false`)',
       r.display === 'flex');
}

// El boton del panel tambien lleva candado (politica: se ve, bloqueado).
{
    const _s = sinComs(SETUP);
    const i = _s.indexOf('COMUNICACIONES\n');
    const bloque = i === -1 ? '' : _s.slice(Math.max(0, i - 1400), i + 40);
    ok('2g · el boton 💬 COMUNICACIONES del panel se pinta bloqueado si no hay extra',
       /_cronosExtraEnabled\('comunicaciones'\)/.test(bloque) &&
       /disabled/.test(bloque) && /grayscale/.test(bloque));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · las tarjetas desactivadas se VEN apagadas ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const apagado = correrComms({ comunicaciones: true, partidos_terminados: false, partidos_en_vivo: false }).html;
    const activo  = correrComms({ comunicaciones: true }).html;

    // ⚠️ SE PARTE POR <button, NO por una ventana de N caracteres alrededor del
    // titulo. El titulo aparece DOS veces en la misma tarjeta (una en la
    // etiqueta del portero, dentro del onclick, y otra en el <div class=title>)
    // y una ventana fija cogia media tarjeta y media de la vecina: daba rojo
    // sobre codigo correcto y podria dar VERDE con el atributo de la de al lado.
    const tarjeta = (html, titulo) =>
        html.split('<button').find(b => b.includes('>' + titulo + '<')) || '';

    for (const [titulo, icono] of [['Partidos Terminados', '📋'], ['Partidos en Vivo', '🔴']]) {
        const off = tarjeta(apagado, titulo);
        const on  = tarjeta(activo,  titulo);
        ok('3 · "' + titulo + '" apagado: sale con disabled', /\bdisabled\b/.test(off), off.slice(0, 160));
        ok('3 · "' + titulo + '" apagado: en escala de grises y sombreado',
           /grayscale\(1\)/.test(off) && /box-shadow:\s*inset/.test(off), off.slice(0, 400));
        ok('3 · "' + titulo + '" apagado: con 🔒 en vez de su icono',
           off.includes('🔒') && !off.includes('>' + icono + '<'));
        ok('3 · "' + titulo + '" apagado: dice el motivo, no su descripcion',
           /No contratado en el plan/.test(off));
        ok('3 · "' + titulo + '" ACTIVO: sin disabled, con su icono y a color',
           !/\bdisabled\b/.test(on) && on.includes('>' + icono + '<') && !/grayscale\(1\)/.test(on),
           on.slice(0, 400));
    }
    // ⚠️ EL AVISO AL PULSAR SE QUEDA — pero cada tarjeta lo tiene en un sitio
    // distinto, y darlo por hecho es como nacio el defecto de v596:
    //  · Partidos Terminados lo lleva EN EL ONCLICK;
    //  · Partidos en Vivo NO, porque su portero vive dentro de la pantalla que
    //    abre (_cronosOpenLiveMatchesPanel). Se comprueba ALLI.
    ok('3k · el aviso al pulsar sigue en Terminados (disabled es cosmetico, v548)',
       /_cronosExtraGate\('partidos_terminados'/.test(tarjeta(apagado, 'Partidos Terminados')));
    const FN_LIVE = extraerAsignada(SETUP, '_cronosOpenLiveMatchesPanel') || '';
    const _live = sinComs(FN_LIVE);
    ok('3k2 · 🔑 y el de En Vivo esta dentro de _cronosOpenLiveMatchesPanel...',
       /_cronosExtraGate\('partidos_en_vivo'/.test(_live));
    ok('3k3 · ⚠️ ...y ANTES del navScreen (no se apila una pantalla que no se abre)',
       _live.indexOf("_cronosExtraGate('partidos_en_vivo'") < _live.indexOf('navScreen('),
       { gate: _live.indexOf("_cronosExtraGate('partidos_en_vivo'"), nav: _live.indexOf('navScreen(') });
}
{
    // El otro menu de Comunicaciones (js/coach/comms/panel.js) usa CSS.
    // ⚠️⚠️ AQUI HAY QUE BORRAR TAMBIEN LOS COMENTARIOS DE BLOQUE. La primera
    // version de esta asercion salio ROJA sobre codigo correcto porque el
    // comentario que hay dentro de la regla dice literalmente "box-shadow:none
    // lo borraba": el guard casaba con la EXPLICACION del defecto, no con el
    // defecto. Es la misma familia del guard que daba verde casando con un
    // comentario que nombraba la funcion que faltaba (v429).
    const _p = sinComs(PANEL).replace(/\/\*[\s\S]*?\*\//g, '');
    const regla = (_p.match(/\.btn-comms-card\[disabled\]\s*\{[^}]*\}/) || [''])[0];
    ok('3l · la hoja del menu unificado apaga del todo (grayscale 1, no 0.7)',
       /grayscale\(1\)/.test(regla) && /box-shadow:\s*inset/.test(regla), regla);
    const hover = (_p.match(/\.btn-comms-card\[disabled\]:hover\s*\{[^}]*\}/) || [''])[0];
    ok('3m · ⚠️ y el :hover NO borra el sombreado (box-shadow:none lo iluminaba)',
       !/box-shadow:\s*none/.test(hover) && /inset/.test(hover), hover);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · 🔑 los ROLES como extras: se EJECUTA el selector ──');
// ───────────────────────────────────────────────────────────────────────────
const BLOQUE_LAUNCH = (() => {
    const m = LAUNCH.match(/export\s+(?:async\s+)?function\s+enterApp\(\)/);
    return LAUNCH.slice(m.index).replace(/^export\s+(?=(?:async\s+)?function\b)/gm, '')
                               .replace(/\bimport\s*\(/g, '__imp(');
})();

function mkEl(id) {
    return {
        id, style: {}, dataset: {}, innerHTML: '', textContent: '',
        attrs: {},
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
        setAttribute(n, v) { this.attrs[n] = String(v); },
        getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
        removeAttribute(n) { delete this.attrs[n]; },
        addEventListener() {}, appendChild() {},
        querySelector: () => null, querySelectorAll: () => [],
    };
}

function correrSelector({ me, extrasPorEntidad }) {
    const els = {};
    const toasts = [];
    const lanzados = [];
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON,
        parseInt, isNaN, RegExp, Error,
        setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
        clearTimeout: () => {},
        document: {
            getElementById: (id) => (els[id] = els[id] || mkEl(id)),
            body: mkEl('body'), createElement: () => mkEl('nuevo'),
            querySelector: () => null, querySelectorAll: () => [],
        },
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        showToast: (m) => toasts.push(String(m)),
        escapeHtml: (s) => String(s == null ? '' : s),
        init: () => {},
        _cronos_auth: { db: {}, auth: {} },
        _cronosCurrentUser: me,
        // El mapa y los motivos, que en produccion los pone setup-modal.js.
        CRONOS_ROL_EXTRA: { director: 'rol_director', coordinator: 'rol_coordinador',
                            parent: 'rol_padres', parent_individual: 'rol_padres',
                            padre_individual: 'rol_padres' },
        CRONOS_ROL_EXTRA_MOTIVO: { rol_director: 'MOTIVO-DIR', rol_coordinador: 'MOTIVO-COORD',
                                   rol_padres: 'MOTIVO-FAM', secretaria: 'MOTIVO-SEC' },
        _cronosExtrasEntidad: extrasPorEntidad,
        __imp: async () => { throw new Error('sin red en el guard'); },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    // _launchWithRole termina llamando a cosas del arranque; se registra y corta.
    vm.createContext(sandbox);
    vm.runInContext(BLOQUE_LAUNCH, sandbox);
    const original = sandbox._launchWithRole;
    sandbox.selectOptionEspia = (o) => { lanzados.push(o); };
    return { w: sandbox, els, toasts, lanzados, original };
}

const plaza = (role, clubId) => ({ role, clubId, isAuthorized: true, status: 'active' });

{
    // Director + entrenador. El club NO tiene contratado el rol de director.
    const me = { role: 'user', clubId: 'C1', allRoles: [plaza('director', 'C1'), plaza('user', 'C1')] };
    const t = correrSelector({ me, extrasPorEntidad: { C1: { rol_director: false } } });
    t.w.showRoleSelection();
    const card = t.els['card-opt-director'];
    ok('4a · 🔑 la tarjeta de Director se PINTA (no se esconde)', card && card.style.display === 'block');
    ok('4b · 🔑 y sale bloqueada, con su motivo a la vista',
       card && card.getAttribute('data-bloqueado') === '1' && card.getAttribute('title') === 'MOTIVO-DIR',
       card && card.attrs);
    ok('4c · ⚠️⚠️ se le QUITA la accion, no solo el color (v548: disabled es cosmetico)',
       card && card.getAttribute('onclick') === null && card.onclick === null);
    ok('4d · apagada de verdad: gris, sombreada y sin cursor de mano',
       card && card.style.filter === 'grayscale(1)' && /inset/.test(card.style.boxShadow || '')
       && card.style.cursor === 'not-allowed', card && card.style);
    ok('4e · la tarjeta de Entrenador, que NO tiene extra, sigue intacta',
       t.els['card-opt-coach'] && t.els['card-opt-coach'].getAttribute('data-bloqueado') === null);
}
{
    // La SEGUNDA PUERTA: llamar a selectOption a mano no entra.
    const me = { role: 'user', clubId: 'C1', allRoles: [plaza('director', 'C1'), plaza('user', 'C1')] };
    const t = correrSelector({ me, extrasPorEntidad: { C1: { rol_director: false } } });
    t.w.selectOption('director');
    ok('4f · 🔑🔑 selectOption("director") desde la consola NO entra',
       me._activeRole === undefined, me._activeRole);
    ok('4g · y explica por que', t.toasts.some(x => x.includes('MOTIVO-DIR')), t.toasts);
}
{
    // ⚠️ EL ATAJO. Con una sola opcion el selector entra solo; si esa opcion
    // esta bloqueada, entrar directamente se saltaria el candado entero.
    const me = { role: 'coordinator', clubId: 'C1', allRoles: [plaza('coordinator', 'C1')] };
    const t = correrSelector({ me, extrasPorEntidad: { C1: { rol_coordinador: false } } });
    t.w.showRoleSelection();
    ok('4h · 🔑🔑🔑 el atajo de "una sola opcion" NO salta por encima del candado',
       me._activeRole === undefined && t.els['card-opt-coordinator'].getAttribute('data-bloqueado') === '1',
       me._activeRole);
}
{
    // Dos clubes, uno lo contrata y el otro no: TIENE que poder entrar.
    const me = { role: 'coordinator', clubId: 'C1',
                 allRoles: [plaza('coordinator', 'C1'), plaza('coordinator', 'C2')] };
    const t = correrSelector({ me, extrasPorEntidad: { C1: { rol_coordinador: false }, C2: {} } });
    t.w.showRoleSelection();
    ok('4i · ⚠️ con una plaza abierta en OTRO club, la opcion NO se bloquea',
       t.els['card-opt-coordinator'].getAttribute('data-bloqueado') === null);
}
{
    // ⚠️⚠️ FAIL-OPEN. Sin extras leidos (fallo de red, lectura colgada) se entra.
    const me = { role: 'director', clubId: 'C1',
                 allRoles: [plaza('director', 'C1'), plaza('user', 'C1')] };
    const t = correrSelector({ me, extrasPorEntidad: {} });
    t.w.showRoleSelection();
    ok('4j · ⚠️⚠️ SIN datos de extras NO se bloquea nada (falla hacia el "si")',
       t.els['card-opt-director'].getAttribute('data-bloqueado') === null);
}
{
    // El SuperAdmin entra a todo por diseno.
    const me = { role: 'superadmin', clubId: 'C1', allRoles: [] };
    const t = correrSelector({ me, extrasPorEntidad: { C1: { rol_director: false, rol_padres: false } } });
    t.w.showRoleSelection();
    ok('4k · el SuperAdmin nunca se bloquea',
       t.els['card-opt-director'].getAttribute('data-bloqueado') === null &&
       t.els['card-opt-parent'].getAttribute('data-bloqueado') === null);
}
{
    // Y se DESBLOQUEA cuando el club lo contrata (la tarjeta no se queda tocada).
    const me = { role: 'user', clubId: 'C1', allRoles: [plaza('parent', 'C1'), plaza('user', 'C1')] };
    const t = correrSelector({ me, extrasPorEntidad: { C1: { rol_padres: false } } });
    t.w.showRoleSelection();
    const antes = t.els['card-opt-parent'].getAttribute('data-bloqueado');
    t.w._cronosExtrasEntidad.C1 = { rol_padres: true };
    t.w.showRoleSelection();
    const card = t.els['card-opt-parent'];
    ok('4l · 🔑 al contratarlo la tarjeta vuelve a la vida (onclick, color e icono)',
       antes === '1' && card.getAttribute('data-bloqueado') === null &&
       card.getAttribute('onclick') === "selectOption('parent')" &&
       !card.style.filter, { antes, ahora: card.attrs, style: card.style });
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · Secretaria, sub-opcion del Director ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const _c = sinComs(CLUBREP);
    ok('5a · la opcion del tablero se bloquea con motivo si el extra esta apagado',
       /_secMotivo/.test(_c) && /extras\.secretaria\s*!==\s*false|_extras\.secretaria\s*!==\s*false/.test(_c));
    // La rama de la ruta: tiene que CORTAR antes de llamar a saSecretary.
    const rama = (_c.match(/if \(tab === 'secretaria'\) \{[\s\S]{0,2600}?saSecretary\(/) || [''])[0];
    ok('5b · ⚠️⚠️ SEGUNDA PUERTA: la ruta corta antes de saSecretary',
       /secretaria\s*===\s*false/.test(rama) && /return;/.test(rama), rama.length);
    // ⚠️ EL `>= 0` NO SOBRA. Sin el, con la puerta BORRADA el indexOf devolvia
    // -1, y -1 < (posicion de saSecretary) es cierto: la asercion daba VERDE
    // sobre el defecto. Lo destapo el red-check, no la lectura.
    ok('5c · y el corte va ANTES de la llamada (no despues de pintarla)',
       rama.indexOf('secretaria === false') >= 0 &&
       rama.indexOf('secretaria === false') < rama.indexOf('saSecretary('),
       { corte: rama.indexOf('secretaria === false'), llamada: rama.indexOf('saSecretary(') });
    ok('5d · un rol no contratado no se puede invitar desde Secretaria',
       /CRONOS_ROL_EXTRA \|\| \{\}\)\[_r\]/.test(_c) && /_rolesDir/.test(_c));
    ok('5e · ⚠️ pero el desplegable nunca se queda vacio: queda el Entrenador',
       /_rolesDir\.length \? _rolesDir : \['user'\]/.test(_c));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 6 · el fichero compila (la trampa del backtick) ──');
// ───────────────────────────────────────────────────────────────────────────
//  🔑 setup-modal.js NO estaba en la lista de scripts/_check_syntax.js y por
//  eso un backtick dentro de un comentario de un template literal lo dejo sin
//  compilar sin que nada avisara. Ahora el checker recorre js/ entero.
{
    const chk = leer('scripts/_check_syntax.js');
    ok('6a · 🔑 _check_syntax.js RECORRE js/ en vez de una lista a mano',
       /function walk\(/.test(chk) && /walk\(path\.join\(root, 'js'\)/.test(chk));
    ok('6b · y setup-modal.js esta declarado explicitamente',
       chk.includes("'js/core/setup-modal.js'"));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════');
console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '  ❌ ' + fallos + ' FALLOS' : '  ✅'));
process.exit(fallos ? 1 : 0);
