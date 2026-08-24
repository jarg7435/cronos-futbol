// test_exclusion_rol_padres.js
// ════════════════════════════════════════════════════════════════════
//  👨‍👩‍👧 EXCLUSIÓN ESTRICTA DEL ROL DE FAMILIAS (v623)
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (2026-08-24): cuando se anula el rol de padres/madres/
//  tutores en la configuración del club o del ente, la aplicación debe
//  ignorar POR COMPLETO todo rastro de ese colectivo; y al terminar el
//  partido, la opción de enviar el informe individual a las familias tiene
//  que desaparecer.
//
//  🔑 EL INTERRUPTOR YA EXISTÍA Y CASI NADIE LO MIRABA. `rol_padres` está en
//  los extras desde v596, pero sólo lo consultaba la pantalla de acceso para
//  bloquear la tarjeta de Familias. El resto de la aplicación seguía
//  ofreciendo padres — y el despacho AUTOMÁTICO seguía mandándoles informes.
//
//  ⚠️⚠️ LA FASE B ES LA QUE IMPORTA. El despacho automático corre en tres
//  fases (A staff, B padres, C copia) y NO LA PULSA NADIE: se dispara sola al
//  terminar el partido. Esconder el botón del post-partido no la habría
//  parado. La PARTE 3 existe por eso.
//
//  ⚠️ DECISIÓN SUYA: el botón del post-partido NO se oculta, porque su envío
//  incluye también al staff (director y coordinador) y eso no tiene que ver
//  con las familias. Se le quitan los padres y se renombra. Ocultarlo entero
//  habría dejado al club sin informe para su propia dirección.
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let n = 0, ok_ = 0, mal = 0;
function ok(nombre, cond, detalle) {
    n++;
    if (cond) { ok_++; console.log('  PASS  ' + nombre); }
    else { mal++; console.error('  FAIL  ' + nombre + (detalle ? ' -> ' + detalle : '')); }
}

const RAIZ = path.join(__dirname, '..');
const P_UTILS = process.env.CRONOS_UTILS || path.join(RAIZ, 'js/core/utils.js');
const SRC_UTILS = fs.readFileSync(P_UTILS, 'utf8');
const SRC_AUTO  = fs.readFileSync(path.join(RAIZ, 'js/coach/comms/match-reports-auto.js'), 'utf8');
const SRC_SEND  = fs.readFileSync(path.join(RAIZ, 'js/coach/comms/match-reports-send.js'), 'utf8');
const SRC_POST  = fs.readFileSync(path.join(RAIZ, 'js/match/persistence/team-persistence.js'), 'utf8');
const SRC_DIR   = fs.readFileSync(path.join(RAIZ, 'js/coach/reports/director-config.js'), 'utf8');
const SRC_CONT  = fs.readFileSync(path.join(RAIZ, 'js/coach/comms/contact-manager.js'), 'utf8');
const SRC_SETUP = fs.readFileSync(path.join(RAIZ, 'js/core/setup-modal.js'), 'utf8');

const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const AUTO = sinCom(SRC_AUTO), SEND = sinCom(SRC_SEND), POST = sinCom(SRC_POST),
      DIR = sinCom(SRC_DIR), CONT = sinCom(SRC_CONT), SETUP = sinCom(SRC_SETUP);

// Extrae y ejecuta las dos funciones del producto (utils.js entero arrastra
// medio proyecto; estas dos son autónomas).
function cargaPredicados(extras) {
    const sb = { console: { log() {}, warn() {}, error() {}, info() {} }, JSON, Object, String };
    sb.window = sb;
    vm.createContext(sb);
    const bloque = (SRC_UTILS.match(/if \(typeof window\.cronosHayPadres[\s\S]*?\n\}/) || [''])[0] +
                   '\n' +
                   (SRC_UTILS.match(/if \(typeof window\.isParentReportEnabledForCategory[\s\S]*?\n\}/) || [''])[0];
    vm.runInContext(bloque, sb);
    sb._cronosCurrentUser = { extras: extras };
    sb.getCategoryGroupKey = () => 'juvenil_a';
    sb._clubCategoryConfigs = { juvenil_a: { sendIndividualReports: true } };
    return sb;
}

console.log('=== TEST: exclusion estricta del rol de familias ===\n');

// ── PARTE 1 · el predicado ──────────────────────────────────────────
console.log('PARTE 1 · la puerta unica');
{
    const conRol = cargaPredicados({ rol_padres: true });
    const sinRol = cargaPredicados({ rol_padres: false });
    const sinDato = cargaPredicados({});

    ok('1a · existe cronosHayPadres', typeof conRol.cronosHayPadres === 'function');
    ok('1b · con el rol activo, hay familias', conRol.cronosHayPadres() === true);
    ok('1c · 🔑 desactivado expresamente, NO hay familias', sinRol.cronosHayPadres() === false);
    // ⚠️ Por defecto SI. Un club al que no se le ha escrito el extra tiene
    //    familias, como siempre; y un `extras` que aun no ha bajado de
    //    Firestore no puede dejar a un club entero sin ellas por unos segundos.
    ok('1d · ⚠️ sin el dato escrito, SI hay familias (solo apaga el `false` expreso)',
       sinDato.cronosHayPadres() === true);
    ok('1e · y sin usuario tampoco se apaga nada',
       cargaPredicados(undefined).cronosHayPadres() === true);
}

// ── PARTE 2 · el informe por categoria se subordina al rol ──────────
console.log('\nPARTE 2 · el informe a familias, subordinado al rol');
{
    const conRol = cargaPredicados({ rol_padres: true });
    const sinRol = cargaPredicados({ rol_padres: false });
    ok('2a · con rol y categoria activa, se puede enviar',
       conRol.isParentReportEnabledForCategory('juvenil', 'A') === true);
    // 🔑 El Director puede tener el interruptor de su categoria encendido DE
    //    ANTES: sin el rol tiene que dar que NO igualmente.
    ok('2b · 🔑 sin rol da NO aunque la categoria lo tenga encendido',
       sinRol.isParentReportEnabledForCategory('juvenil', 'A') === false);
    // ⚠️ Se exige la COMPOSICION, no que las dos palabras esten cerca: la
    //    version anterior casaba con la DEFINICION de `_hayFamilias` una linea
    //    antes y daba verde con el `&&` borrado. Presencia != uso, otra vez.
    ok('2c · …y el interruptor del Director queda subordinado',
       /_hayFamilias && extras\.informes_padres/.test(DIR), 'informes_padres sin subordinar');
}

// ── PARTE 3 · ⚠️ LA FASE QUE NO PULSA NADIE ─────────────────────────
console.log('\nPARTE 3 · el despacho AUTOMATICO no manda a familias que no existen');
ok('3a · ⚠️⚠️ la fase de padres se omite sin rol', /cronosHayPadres/.test(AUTO));
ok('3b · …y se omite RESOLVIENDO CERO destinatarios, no a mitad del bucle',
   /_parentTargets = _hayFamilias[\s\S]{0,200}: \[\]/.test(AUTO),
   'si se cortara dentro del bucle, algun padre podria colarse');
ok('3c · la fase del STAFF no se toca', /type !== 'parent'/.test(AUTO));

// ── PARTE 4 · el envio manual del post-partido ──────────────────────
console.log('\nPARTE 4 · post-partido: sin padres, pero el staff se queda');
ok('4a · la lista de destinatarios excluye a los padres sin rol',
   /const activeParents = !_hayFamilias \? \[\]/.test(SEND));
ok('4b · ⚠️ el STAFF sigue en la lista (decision suya)',
   /const staff = contacts\.filter\(c => c\.type !== 'parent'\)/.test(SEND) &&
   !/staff = !_hayFamilias/.test(SEND),
   'ocultarlo entero dejaria al club sin informe para su direccion');
ok('4c · el boton se renombra cuando no hay familias',
   /cronosHayPadres\(\)[\s\S]{0,120}'Enviar Informes'/.test(POST));
ok('4d · …y sigue existiendo (NO se oculta)',
   /_postMatchSendReports\(\)/.test(POST));

// ── PARTE 5 · el resto del rastro ───────────────────────────────────
console.log('\nPARTE 5 · el resto del rastro del colectivo');
ok('5a · la seccion Padres/Tutores de Contactos desaparece',
   /cronosHayPadres\(\)\) \? '' :/.test(CONT), 'es donde se dan de alta: sin ella no hay raiz');
// Lo que YA existia y no se toca: la tarjeta de acceso de Familias.
ok('5b · la pantalla de acceso sigue bloqueando la tarjeta de Familias',
   /rol_padres/.test(SETUP));
// ⚠️ Los tres alias del rol tienen que caer del mismo lado.
ok('5c · ⚠️ los tres alias de la plaza de familia siguen mapeados',
   /parent:\s*'rol_padres'/.test(SETUP) &&
   /parent_individual:\s*'rol_padres'/.test(SETUP) &&
   /padre_individual:\s*'rol_padres'/.test(SETUP),
   'olvidar un alias no da error: deja una puerta abierta');

// ── PARTE 6 · v624 · lo que quedó abierto en la primera vuelta ──────
console.log('\nPARTE 6 · el resolvedor y el selector (2a vuelta)');
const SRC_PANEL = fs.readFileSync(path.join(RAIZ, 'js/coach/comms/panel.js'), 'utf8');
const SRC_IND   = fs.readFileSync(path.join(RAIZ, 'js/coach/comms/individual-reports.js'), 'utf8');
const SRC_WA    = fs.readFileSync(path.join(RAIZ, 'js/shared/whatsapp-email.js'), 'utf8');
const PANEL = sinCom(SRC_PANEL), IND = sinCom(SRC_IND), WA = sinCom(SRC_WA);

// 🔑🔑 LA PUERTA VA EN EL ORIGEN. `_cronosResolveParentReportTargets` lo llaman
//  TRES sitios; en v623 se taparon dos y se escapó el del envío MANUAL, que
//  resuelve sus propios targets (`_parentTargetsManual`) aparte de la lista que
//  enseña: podía seguir alcanzando a familias que ya no se mostraban.
const _cuerpoResolver = (function () {
    const i = PANEL.indexOf('function _cronosResolveParentReportTargets');
    return i === -1 ? '' : PANEL.slice(i, i + 900);
})();
ok('6a · 🔑🔑 el RESOLVEDOR de destinatarios-padre corta en origen',
   /cronosHayPadres\(\)\) \{\s*return \[\];/.test(_cuerpoResolver), _cuerpoResolver.slice(0, 120));
ok('6b · …y el envio MANUAL sigue pasando por ese resolvedor',
   /_parentTargetsManual = _cronosResolveParentReportTargets\(/.test(SEND),
   'si se resolviera por su cuenta, el corte del origen no le llegaria');
ok('6c · el enriquecido con padres de localStorage tambien se corta',
   /!_hayFamilias \? \[\] : emailConfig\.contacts\.filter\(c => c\.type === 'parent'/.test(IND),
   'volverian a entrar en `links` los padres guardados antes de apagar el rol');

// ⚠️⚠️ EL SELECTOR COMPARTIDO Y SU RESPALDO. Pedir padres sin rol daba CERO, y
//  el respaldo caia al `else` de «Todos»: la peticion devolvia el CLUB ENTERO.
ok('6d · el selector no "quiere padres" cuando no los hay',
   /wantsPadres = _hayFamilias &&/.test(WA));
ok('6e · ⚠️⚠️ …y su RESPALDO no se aplica: sin familias la lista queda VACIA',
   /_pedianSoloFamilias/.test(WA) && /&& !_pedianSoloFamilias\)/.test(WA),
   'sin esto, pedir padres devolvia todos los usuarios del club');

// ⚠️ Lo que se comprobo y NO era un rastro: collective-report.js filtra con
//    `!== 'parent'`, o sea que YA excluye a las familias. No se toco.
const COL = sinCom(fs.readFileSync(path.join(RAIZ, 'js/coach/comms/collective-report.js'), 'utf8'));
ok('6f · [comprobado] el informe colectivo ya excluia a las familias de suyo',
   /filter\(c => c\.type !== 'parent'\)/.test(COL), 'si esto cambiara, habria que darle puerta');

console.log('\n------------------------------------------------------------');
console.log('Resultado: ' + ok_ + '/' + n + ' pruebas superadas.');
process.exit(mal > 0 ? 1 : 0);
