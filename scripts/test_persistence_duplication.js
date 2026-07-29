// ─────────────────────────────────────────────────────────────────────────
// test_persistence_duplication.js
//
// LIMPIEZA DE LA DUPLICACION DE PERSISTENCIA (2026-07-29).
//
// TRES archivos declaraban el mismo bloque de "plantillas guardadas":
//   · js/match/persistence/active-match.js      (15o en index.html)
//   · js/match/persistence/team-persistence.js  (17o)
//   · js/ai/import.js                           (40o)
// Sus primeras 320 lineas eran BYTE-IDENTICAS entre los dos primeros. `diff`
// decia "1185 lineas distintas", pero eso era PURAMENTE la trampa CRLF-vs-LF
// (active-match es CRLF y team-persistence LF): al normalizar el EOL, 9 de los
// 11 cuerpos comunes resultaron identicos.
//
// ⚠️ NO ERA SOLO DESORDEN. Como ai/import.js carga EL ULTIMO, sus versiones
// ganaban pese a ser FOSILES peores, con dos consecuencias VISIBLES:
//   1. su populateSavedTeams (12 lineas) no rellenaba la lista visual de
//      plantillas —los <div id="saved-teams-list-home|away"> que pinta
//      core/setup-modal.js (119 y 162)—, asi que los botones de borrado por
//      plantilla NO EXISTIAN en produccion; y no filtraba por modalidad, de
//      modo que en F7 se ofrecian tambien las plantillas de F11;
//   2. su loadTeamFromDropdown duplicaba EN LINEA una version parcial de
//      loadTeamData, saltandose la sincronizacion de categoria y la de
//      _pendingSetupState (que existe "para evitar sobreescritura accidental").
// La prueba de que el codigo vivo esperaba la version rica: loadTeamData —que
// SI esta viva— resalta filas leyendo `row.dataset.originalIndex`, atributo que
// SOLO pone la version rica. El codigo vivo dependia de un marcado que ya nadie
// construia.
//
// ESTADO FINAL: team-persistence.js es la fuente canonica de todo el bloque;
// active-match.js se queda SOLO con endMatch, de la que es unico duenyo.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra).slice(0, 400)); }
};
const rd = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('── Duplicacion de persistencia (active-match / team-persistence / import) ──\n');

const AM = 'js/match/persistence/active-match.js';
const TP = 'js/match/persistence/team-persistence.js';
const IM = 'js/ai/import.js';
const ORDER = [...rd('index.html').matchAll(/<script src="(js\/[^"?]+)/g)]
    .map(m => m[1]).filter(f => fs.existsSync(path.join(ROOT, f)));

// declaraciones de nivel superior (las dos formas, columna 0)
function decls(rel) {
    const out = new Map();
    rd(rel).split(/\r?\n/).forEach((l, i) => {
        const m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
            || l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/);
        if (m && !out.has(m[1])) out.set(m[1], i + 1);
    });
    return out;
}

// ────────── PARTE 1 · el reparto de responsabilidades ──────────
const BLOQUE = ['loadTeamData', 'populateSavedTeams', 'loadTeamByIndex', 'deleteTeamByIndex',
    'deleteTeamFromDropdown', 'loadTeamFromDropdown', 'saveCurrentTeam', 'saveTeamSetup',
    'deleteTeamSetup', '_showPostMatchOptions', '_postMatchSendReports', '_postMatchReturn',
    '_postMatchNewSetup'];
{
    const dAM = decls(AM), dTP = decls(TP), dIM = decls(IM);

    ok('1a · ⚠️ active-match.js declara UNA sola cosa: endMatch',
        dAM.size === 1 && dAM.has('endMatch'), [...dAM.keys()]);
    ok('1b · y sigue siendo su UNICO duenyo en toda la cadena',
        ORDER.filter(f => decls(f).has('endMatch')).join() === AM,
        ORDER.filter(f => decls(f).has('endMatch')));

    const enAM = BLOQUE.filter(n => dAM.has(n));
    ok('1c · ⚠️ active-match.js ya no declara nada del bloque de plantillas', enAM.length === 0, enAM);
    const enIM = BLOQUE.filter(n => dIM.has(n));
    ok('1d · ⚠️ ai/import.js tampoco (sus 3 copias fosiles se fueron)', enIM.length === 0, enIM);

    const faltan = BLOQUE.filter(n => !dTP.has(n));
    ok('1e · team-persistence.js declara las ' + BLOQUE.length + ' del bloque', faltan.length === 0, faltan);

    // y cada una con UNA sola declaracion en toda la cadena
    const dup = BLOQUE.filter(n => ORDER.filter(f => decls(f).has(n)).length > 1);
    ok('1f · ⚠️ ninguna del bloque conserva mas de una declaracion', dup.length === 0,
        dup.map(n => n + ' -> ' + ORDER.filter(f => decls(f).has(n)).join(', ')));
}

// ────────── PARTE 2 · el orden de carga sigue sosteniendo el reparto ──────────
{
    ok('2a · team-persistence.js carga DESPUES de active-match.js',
        ORDER.indexOf(TP) > ORDER.indexOf(AM), { AM: ORDER.indexOf(AM), TP: ORDER.indexOf(TP) });
    ok('2b · ai/import.js carga despues de los dos (por eso ganaba)',
        ORDER.indexOf(IM) > ORDER.indexOf(TP));
    // endMatch: quien lo consume esta en otros archivos y lo llama por window o
    // por nombre pelado en tiempo de click, asi que el orden no le afecta; lo
    // que importa es que nadie mas lo declare (1b).
    // ⚠️ hay que aceptar LAS DOS FORMAS: app-init.js y setup-modal.js usan solo
    // `window.endMatch`, y un lookbehind `(?<![.\w$])` los excluye precisamente
    // a ellos. Mi primera version exigia el nombre pelado y daba rojo por eso.
    const CONSUMIDORES = ['js/core/app-init.js', 'js/core/patches.js', 'js/core/setup-modal.js',
        'js/core/sprint3-init.js', 'js/match/timer/core.js'];
    const sinRef = CONSUMIDORES.filter(f =>
        !/(?<![.\w$])endMatch\b/.test(rd(f)) && !/window\.endMatch\b/.test(rd(f)));
    ok('2c · los 5 consumidores de endMatch siguen referenciandolo', sinRef.length === 0, sinRef);
}

// ────────── PARTE 3 · ⚠️ EL DEFECTO VISIBLE, EJECUTADO DE VERDAD ──────────
// No se comprueba el texto: se carga la CADENA REAL de los 72 scripts clasicos
// y se llama a la populateSavedTeams que gana, con plantillas de dos
// modalidades. Es la prueba que demuestra que la lista vuelve a pintarse.
{
    function nodo(id) {
        return { id, innerHTML: '', value: '', style: {}, dataset: {}, children: [],
            classList: { add() {}, remove() {}, contains: () => false },
            appendChild(c) { this.children.push(c); return c; },
            removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
            querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
            setAttribute() {}, getAttribute: () => null, insertAdjacentHTML() {}, remove() {} };
    }
    const els = {};
    ['saved-teams-home', 'saved-teams-away', 'saved-teams-list-home', 'saved-teams-list-away',
     'setup-mode'].forEach(id => { els[id] = nodo(id); });
    els['setup-mode'].value = 'f7';

    const equipos = [
        { name: 'Alevin A', mode: 'f7', players: [{ name: 'A', number: 1 }] },
        { name: 'Alevin B', mode: 'f7', players: [{ name: 'B', number: 2 }] },
        { name: 'Cadete F11', mode: 'f11', players: [{ name: 'C', number: 3 }] },
    ];
    const sb = {};
    vm.createContext(sb);
    sb.window = sb; sb.self = sb;
    sb.document = { getElementById: id => els[id] || null, querySelector: () => null,
        querySelectorAll: () => [], createElement: t => nodo('n-' + t),
        addEventListener() {}, body: nodo('body'), head: nodo('head'), readyState: 'complete' };
    sb.localStorage = { _d: { cronos_teams: JSON.stringify(equipos) },
        getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); },
        removeItem(k) { delete this._d[k]; } };
    sb.navigator = { userAgent: 'node', serviceWorker: { register: () => Promise.resolve() } };
    sb.location = { href: 'https://x/', hostname: 'x', search: '' };
    sb.setTimeout = () => 0; sb.setInterval = () => 0; sb.clearInterval = () => {}; sb.clearTimeout = () => {};
    sb.console = { log() {}, warn() {}, error() {} };
    sb.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
    sb.MutationObserver = function () { return { observe() {}, disconnect() {} }; };
    sb.alert = () => {}; sb.confirm = () => true; sb.showToast = () => {};

    ORDER.forEach(f => { try { vm.runInContext(rd(f), sb, { timeout: 20000, filename: f }); } catch (e) { /* deps ausentes */ } });

    ok('3a · la cadena expone populateSavedTeams', typeof sb.populateSavedTeams === 'function');
    const fuente = String(sb.populateSavedTeams);
    ok('3b · ⚠️ la que gana es la RICA (la que construye la lista con originalIndex)',
        fuente.includes('originalIndex'), fuente.split('\n').length + ' lineas');

    sb.populateSavedTeams('home');
    const sel = els['saved-teams-home'], list = els['saved-teams-list-home'];

    // ⚠️ ESTA ES LA ASERCION QUE FIJA EL ARREGLO: antes daba 0 filas.
    ok('3c · ⚠️ la lista visual de plantillas SE RELLENA (antes se quedaba vacia y los botones de borrado no existian)',
        list.children.length === 2, { filas: list.children.length });
    // ⚠️ y esta fija el filtrado: antes salian las 3, incluida la de F11.
    ok('3d · ⚠️ el desplegable FILTRA POR MODALIDAD: en F7 salen 2 de 3, no las 3',
        sel.children.length === 2, { opciones: sel.children.length });

    // cambiar de modalidad tiene que cambiar lo que se ofrece
    els['setup-mode'].value = 'f11';
    els['saved-teams-home'] = nodo('saved-teams-home');
    els['saved-teams-list-home'] = nodo('saved-teams-list-home');
    sb.populateSavedTeams('home');
    ok('3e · al pasar a F11 se ofrece solo la plantilla de F11',
        els['saved-teams-home'].children.length === 1 && els['saved-teams-list-home'].children.length === 1,
        { opciones: els['saved-teams-home'].children.length, filas: els['saved-teams-list-home'].children.length });

    // loadTeamFromDropdown tiene que pasar por la canonica loadTeamData
    ok('3f · ⚠️ loadTeamFromDropdown delega en loadTeamData (asi recupera categoria y _pendingSetupState)',
        /loadTeamData\s*\(/.test(String(sb.loadTeamFromDropdown)), String(sb.loadTeamFromDropdown).slice(0, 200));
}

// ────────── PARTE 4 · autotest: que el detector no de verde por no mirar ──────────
{
    const d = decls(TP);
    ok('4a · el detector encuentra declaraciones reales en team-persistence.js', d.size >= 10, d.size);
    ok('4b · y ve las dos formas (`function X(` y `window.X = function`)',
        d.has('loadTeamData') && d.has('saveTeamSetup'));
    // la trampa CRLF: si alguien compara estos dos archivos, que sepa por que
    const amCRLF = /\r\n/.test(rd(AM));
    ok('4c · nota: active-match.js sigue en ' + (amCRLF ? 'CRLF' : 'LF')
        + ' y team-persistence.js en ' + (/\r\n/.test(rd(TP)) ? 'CRLF' : 'LF')
        + ' (por eso `diff` exagera: normalizar el EOL antes de comparar)', true);
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);
