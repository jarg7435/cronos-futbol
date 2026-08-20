// ─────────────────────────────────────────────────────────────────────────
// test_config_tab_director_only.js
//
// REGLA DE PRODUCTO (fijada por el autor el 2026-07-28): la pestanya "Config."
// del Panel de Direccion es exclusiva del DIRECTOR DEPORTIVO y del SUPERADMIN.
// El COORDINADOR no debe verla NI poder llegar a ella. El coordinador ejecuta;
// el director decide.
//
// ESTADO ANTERIOR AL ARREGLO: la pestanya no tenia NINGUNA comprobacion de rol.
// El boton se pintaba incondicionalmente (club-reports.js) y switchStaffTab
// enrutaba a _renderDirectorConfig() sin mirar nada. No es que el coordinador
// tuviera permiso: es que nadie lo comprobaba.
//
// EL OTRO LADO DEL PROBLEMA, que es lo que hacia que esto no fuese cosmetico:
// el DIRECTOR NO PODIA GUARDAR. La pestanya escribe en clubs/{clubId} y esa
// regla solo admitia superadmin, club_admin e individual_admin. Ocultarsela al
// coordinador sin mas habria dejado la pestanya SIN DUENYO FUNCIONAL: visible
// para el director y fallando siempre con permission-denied. Por eso la PARTE 4
// fija tambien los invariantes de la regla de Firestore.
//
// ⚠️ LIMITACION CONOCIDA: las aserciones de la PARTE 4 son sobre el TEXTO de
// firestore.rules, no sobre su comportamiento. El emulador de Firestore
// necesita un JDK moderno y esta maquina tiene Java 1.8 (el mismo bloqueo que
// mantiene abiertos SEC-C1 y SEC-C3). Fijan que la rama existe y que sigue
// acotada a los campos correctos, que es lo que puede romperse por descuido.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};
const rd = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('── Pestanya "Config." exclusiva del Director Deportivo ──\n');

const CR = 'js/coach/reports/club-reports.js';
const DC = 'js/coach/reports/director-config.js';
const crSrc = rd(CR), dcSrc = rd(DC);

// ────────── PARTE 1 · el permiso, ejecutando la funcion real ──────────
// No se comprueba el texto: se carga club-reports.js y se llama de verdad.
function sandbox() {
    const sb = {};
    vm.createContext(sb);
    sb.window = sb; sb.self = sb;
    const el = () => ({ style: {}, classList: { add() {}, remove() {} }, innerHTML: '',
        addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] });
    sb.document = { getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [],
        createElement: el, addEventListener() {}, body: el() };
    sb.console = { log() {}, warn() {}, error() {} };
    sb.setTimeout = () => 0; sb.setInterval = () => 0; sb.clearInterval = () => {};
    sb.showToast = () => {}; sb.showSpinner = () => {}; sb.hideSpinner = () => {};
    sb.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    sb.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
    try { vm.runInContext(crSrc, sb, { timeout: 15000, filename: CR }); }
    catch (e) { console.log('       (aviso: club-reports.js lanzo al cargar: ' + e.message + ')'); }
    return sb;
}
const sb = sandbox();

ok('1a · club-reports.js publica window._sdCanSeeConfigTab',
    typeof sb._sdCanSeeConfigTab === 'function', typeof sb._sdCanSeeConfigTab);

if (typeof sb._sdCanSeeConfigTab === 'function') {
    const puede = u => sb._sdCanSeeConfigTab(u);
    // los dos que SI
    ok('1b · el DIRECTOR la ve', puede({ role: 'director', clubId: 'c1' }) === true);
    ok('1c · el SUPERADMIN la ve', puede({ role: 'superadmin', clubId: 'c1' }) === true);
    ok('1d · el rol admin la ve', puede({ role: 'admin', clubId: 'c1' }) === true);
    // ⚠️ EL CASO QUE ORIGINA TODO ESTO
    ok('1e · ⚠️ el COORDINADOR **NO** la ve', puede({ role: 'coordinator', clubId: 'c1' }) === false);
    // el resto tampoco
    ok('1f · el entrenador (rol `user`) no la ve', puede({ role: 'user', clubId: 'c1' }) === false);
    ok('1g · el padre/tutor no la ve', puede({ role: 'parent', clubId: 'c1' }) === false);
    ok('1h · el club_admin no llega a este panel y no la ve aqui', puede({ role: 'club_admin', clubId: 'c1' }) === false);
    ok('1i · sin usuario no la ve (no puede reventar)', puede(null) === false && puede(undefined) === false);

    // multi-rol: manda el rol ACTIVO, como en todo el resto del panel
    ok('1j · multi-rol actuando de DIRECTOR: la ve',
        puede({ role: 'user', _activeRole: 'director', clubId: 'c1' }) === true);
    ok('1k · ⚠️ multi-rol actuando de COORDINADOR: NO la ve, aunque su rol raiz sea director',
        puede({ role: 'director', _activeRole: 'coordinator', clubId: 'c1' }) === false);
    // el superadmin probando como director sigue siendo superadmin
    ok('1l · el SUPERADMIN probando como director la sigue viendo',
        puede({ role: 'superadmin', _activeRole: 'director', clubId: 'c1' }) === true);
}

// ────────── PARTE 2 · las TRES puertas usan la MISMA funcion ──────────
// Si cada una calculase el permiso por su cuenta podrian divergir, que es
// exactamente como nacen estos defectos.
{
    // ══════════════════════════════════════════════════════════════════
    //  🔄 v591 · YA NO HAY PESTAÑAS: LA PUERTA VISIBLE ES EL TABLERO
    //
    //  El autor retiró la barra de pestañas (v591) y el panel entra por un
    //  tablero de botones. La aserción miraba el BOTÓN DE PESTAÑA, que ya no
    //  existe; lo que hay que fijar sigue siendo lo mismo: **que la entrada a
    //  Configuración sólo se OFREZCA al director**. Ahora esa oferta es la
    //  opción del tablero, que se añade dentro de `if (_esDir)`.
    //
    //  ⚠️ Y esto es sólo la puerta VISIBLE. La que de verdad cierra el acceso
    //  es la de la ruta (2c/2d, más abajo), porque `switchStaffTab('config')`
    //  se puede llamar a mano desde la consola. Las dos siguen fijadas.
    // ══════════════════════════════════════════════════════════════════
    ok('2a · la entrada a Config. solo se OFRECE si es director (opcion del tablero)',
        /if \(_esDir\) \{[\s\S]{0,700}?switchStaffTab\('config'\)/.test(crSrc),
        'la opcion de Configuracion tiene que nacer dentro del if de director');
    // ⚠️ SE CUENTAN LLAMADAS, NO MENCIONES: el fichero cita
    //    switchStaffTab('config') en tres comentarios que explican justamente
    //    esta regla. Contar el texto crudo daba 4 y el guard saleía en rojo
    //    describiendo un defecto que no existe.
    const _crSinCom = crSrc.split(/\r?\n/).filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
    ok('2b · ⚠️ y no hay ninguna otra via visible incondicional a Config.',
        (_crSinCom.match(/switchStaffTab\('config'\)/g) || []).length === 1,
        'una segunda entrada fuera del if la ofreceria a cualquiera');
    // la ruta: switchStaffTab tiene que cortar ANTES de renderizar
    // ⚠️ DOS trampas juntas en esta sola asercion, las dos ya conocidas:
    //  · el limite va ACOTADO a proposito (un `[\s\S]*?` sin techo puede abarcar
    //    codigo ajeno y dar verde por accidente);
    //  · y hay que escribir `\r?\n`, NUNCA `\n` pelado: este repo es CRLF, y un
    //    `\n\}` no casa `\r\n}`. Es la misma familia que el limpiador de
    //    comentarios `//.*$` que no borraba nada en ficheros CRLF.
    const ruta = crSrc.match(/if \(tab === 'config'\) \{[\s\S]{0,1500}?\r?\n\s{4}\}\r?\n\};/);
    ok('2c · la rama `config` de switchStaffTab existe', !!ruta);
    if (ruta) {
        const cuerpo = ruta[0];
        ok('2d · ⚠️ la RUTA tambien comprueba el permiso (ocultar el boton no basta)',
            /_sdCanSeeConfigTab\(\)/.test(cuerpo));
        ok('2e · ⚠️ y CORTA con return antes de llamar a _renderDirectorConfig',
            cuerpo.indexOf('return;') !== -1
            && cuerpo.indexOf('return;') < cuerpo.indexOf('_renderDirectorConfig'));
    }
    ok('2f · la vista tiene su propia guarda (window._renderDirectorConfig es invocable sola)',
        /_sdCanSeeConfigTab\b/.test(dcSrc));
    ok('2g · esa guarda corta antes de leer el club',
        dcSrc.indexOf('_sdCanSeeConfigTab') < dcSrc.indexOf("getDoc(doc(db, 'clubs'"));
    // la guarda de la vista usa typeof: club-reports.js podria no haber cargado
    ok('2h · la guarda de la vista tolera que club-reports.js no haya cargado',
        /typeof window\._sdCanSeeConfigTab === 'function'/.test(dcSrc));
}

// ────────── PARTE 3 · nadie mas puede colar la pestanya ──────────
{
    const otros = [];
    const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? walk(d + '/' + e.name) : (e.name.endsWith('.js') ? [d + '/' + e.name] : []));
    // ⚠️ hay que quitar los comentarios ANTES de buscar: director-config.js
    // documenta su propio punto de entrada ("switchStaffTab('config') ->
    // _renderDirectorConfig()") y sin esto cuenta como una ruta real. Es la
    // misma trampa que ya me comio una asercion en extras.js: mi propio texto
    // explicativo disparando mi propia comprobacion.
    const sinComentarios = src => src.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
    walk('js').forEach(f => {
        if (f === CR) return;
        if (/switchStaffTab\(\s*['"]config['"]\s*\)/.test(sinComentarios(rd(f)))) otros.push(f);
    });
    ok('3a · ningun otro .js enruta a la pestanya config por su cuenta', otros.length === 0, otros);
    const html = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
        .filter(f => /switchStaffTab\(\s*['"]config['"]\s*\)/.test(rd(f)));
    ok('3b · ningun .html tiene un onclick suelto a la pestanya config', html.length === 0, html);
}

// ────────── PARTE 4 · ⚠️ LA REGLA QUE HACE QUE LA PESTANYA TENGA DUENYO ──────────
// Sin esta rama el director veia la pestanya pero su guardado fallaba siempre.
// (Aserciones sobre el TEXTO — ver la limitacion del JDK en la cabecera.)
{
    const rules = rd('firestore.rules');
    ok('4a · existe el helper isClubDirectorOf', /function isClubDirectorOf\(clubId\)/.test(rules));
    ok('4b · existe el helper isClubConfigOnlyUpdate', /function isClubConfigOnlyUpdate\(\)/.test(rules));
    // los parentesis son explicitos en la regla: `&&` liga mas fuerte que `||`,
    // asi que el agrupamiento ya era el correcto, pero se escribe a la vista
    // para que no dependa de recordar la precedencia.
    ok('4c · ⚠️ clubs/{clubId} admite al director SOLO junto a la acotacion de campos',
        /\(isClubDirectorOf\(clubId\)\s*&&\s*isClubConfigOnlyUpdate\(\)\)/.test(rules));

    // ── lo que impide la escalada CROSS-CLUB que motivo retirar la rama de v188
    const helper = (rules.match(/function isClubDirectorOf\(clubId\)[\s\S]*?\n    \}/) || [''])[0];
    ok('4d · ⚠️ el director queda ATADO a ESTE club (compara users/{uid}.clubId con {clubId})',
        /\.data\.get\('clubId', ''\) == clubId/.test(helper));
    ok('4e · exige rol director en el documento users/{uid}',
        /\.data\.get\('role', ''\) == 'director'/.test(helper));
    ok('4f · exige que la cuenta este autorizada y activa',
        /isAuthorized/.test(helper) && /'status', ''\) == 'active'/.test(helper));

    // ── lo que impide la escalada DE PRIVILEGIOS
    const acot = (rules.match(/function isClubConfigOnlyUpdate\(\)[\s\S]*?\n    \}/) || [''])[0];
    ok('4g · ⚠️ la escritura se limita a categoryConfigs, timerThresholds y features',
        /hasOnly\(\['categoryConfigs', 'timerThresholds', 'features'\]\)/.test(acot));
    ok('4h · ⚠️ y DENTRO de features, solo a sendIndividualReports (features contiene live_view, que gestiona el club_admin)',
        /\.diff\(resource\.data\.get\('features', \{\}\)\)[\s\S]{0,80}hasOnly\(\['sendIndividualReports'\]\)/.test(acot));

    // los campos peligrosos NO pueden aparecer en la acotacion
    ['directorUids', 'coordinatorUids', 'adminUid', 'plan', 'status', 'expiresAt', 'live_view']
        .forEach(campo => {
            ok("4i · el campo peligroso '" + campo + "' queda FUERA de lo que el director puede escribir",
                !acot.includes(campo));
        });

    // la nota de v188 tiene que seguir ahi: explica por que la rama vieja se fue
    ok('4j · se conserva la nota de v188 sobre la escalada cross-club',
        /se ELIMINO la rama que permitia a/.test(rules) && /cross-club/.test(rules));
}

// ────────── PARTE 5 · lo que la pestanya escribe no ha cambiado ──────────
// Si alguien anyade un cuarto campo al guardado, la regla lo rechazara en
// produccion. Esta parte lo detecta antes de desplegar.
{
    ok('5a · el guardado sigue escribiendo exactamente categoryConfigs, timerThresholds y features.sendIndividualReports',
        /categoryConfigs: categoryConfigs,\s*\n\s*timerThresholds: \{ red: f7Red, yellow: f7Yellow \},\s*\n\s*'features\.sendIndividualReports': anyReportsActive/.test(dcSrc));
    ok('5b · y sigue escribiendo en clubs/{clubId}', /updateDoc\(doc\(db, 'clubs', clubId\)/.test(dcSrc));
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);
