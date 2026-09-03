// ─────────────────────────────────────────────────────────────────────────
// test_extras_lock_and_messaging.js  ·  candados 🔒 de extras + permisos de
// mensajería (v429)
//
// Peticion del autor (2026-08-03, implementar.txt):
//   1. Un extra DESACTIVADO no esconde su pestaña/seccion: la deja a la vista
//      con un candado y en estado bloqueado.
//   2. Extra nuevo "Mensajeria" que habilita el chat del club.
//   3. Con el extra activo: comunicacion abierta entre roles internos; TODOS
//      los padres RECIBEN siempre; ENVIAR lo autoriza el entrenador padre a
//      padre con una casilla en su listado de contactos.
//
// LO QUE ESTE GUARD PROTEGE (y por que cada cosa puede volver a romperse):
//
//  A · POR DEFECTO TODO ESTA ACTIVO. La regla es "distinto de false", no
//      "igual a true". Un club antiguo no tiene el mapa `extras` en su
//      documento: con `=== true` se le apagaria media aplicacion de golpe.
//      Es el fallo mas caro posible aqui y no da ningun error, solo candados
//      donde no toca.
//
//  B · EL CANDADO DEL PADRE FALLA HACIA EL "SI". Sin campo canSendMsg (todos
//      los vinculos de hoy), con la consulta rota, o con varios hijos donde
//      al menos un vinculo lo permita -> puede enviar. Decision del autor:
//      nadie pierde de golpe una capacidad que ya tenia.
//
//  C · HAY DOS VIAS DE ENVIO DEL PADRE, no una: _sendUnifiedMessage (motor
//      unificado) y ppSendChatMessage (panel de padres, que escribe en
//      cronos_messages por su cuenta). Gatear solo el motor deja la otra
//      abierta, y no falla a gritos: el padre simplemente sigue escribiendo.
//
//  D · EL PANEL DE FAMILIAS NO PUEDE ARRANCAR EN UNA PESTAÑA BLOQUEADA. La
//      pestaña inicial es 'conv' por defecto; sin el extra de convocatorias
//      el Area de Familias abriria sobre un candado con el cuerpo vacio.
//
//  E · 'comunicaciones' era el UNICO extra del panel del SuperAdmin sin un
//      solo lector en todo el proyecto: se podia apagar y no pasaba nada.
//      Y 'contactos' se usaba en el codigo pero NO estaba en la definicion,
//      asi que el SuperAdmin no podia tocarlo. Las dos cosas se arreglan en
//      v429 y las fija la PARTE 1.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ⚠️ LAS ASERCIONES DE CODIGO MIRAN EL CODIGO, NO LOS COMENTARIOS.
// Costo real, medido en esta misma ronda: la asercion 4g daba VERDE con el
// cerrojo de ppSendChatMessage BORRADO, porque casaba con un comentario que
// nombraba _cronosParentCanSendMsg. Un guard que no se ha visto en rojo puede
// estar defendiendo el aire. Se comprueba con `sinComs`, no con el fuente.
// ⚠️ v434 · `split(/\r?\n/)` y no `split('\n')`: el `.` de una regex no casa
// `\r`, así que en un fichero con CRLF `//.*$` no llegaba al final de línea y
// este helper no borraba NI UN comentario. Ver la nota larga en
// scripts/test_live_cleanup_and_reads.js, donde se descubrió.
const sinComs = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

// Aisla el cuerpo de una funcion desde su firma, para no casar con cualquier
// aparicion suelta del nombre en otro punto del fichero.
const cuerpoDesde = (src, firma, largo) => {
    const i = src.indexOf(firma);
    return i === -1 ? '' : src.slice(i, i + (largo || 1200));
};

console.log('── extras bloqueados y permisos de mensajeria (v429) ──\n');

const DEF     = read('js/admin/superadmin/extras-toggle.js');
const SETUP   = read('js/core/setup-modal.js');
const PANEL   = read('js/coach/comms/panel.js');
const CONTACT = read('js/coach/comms/contact-manager.js');
const PARENT  = read('js/parent/panel.js');

// ═══════════ PARTE 1 · la definicion de extras del SuperAdmin ═══════════
console.log('── PARTE 1 · el panel del SuperAdmin ──');
{
    // Se ejecuta el fichero de verdad para leer la lista, en vez de parsearla
    // a ojo: si alguien cambia la forma de la definicion, esto se entera.
    const sb = { window: {} };
    sb.window.window = sb.window;
    vm.createContext(sb);
    vm.runInContext(DEF.replace(/window\.saExtras[\s\S]*$/, ''), sb);
    const keys = (sb.window._CRONOS_EXTRAS_DEF || []).map(e => e.key);

    ok('1a · existe el extra "mensajeria"', keys.includes('mensajeria'), keys.join(', '));
    ok('1b · y sigue existiendo "comunicaciones" (son palancas distintas)',
       keys.includes('comunicaciones'), keys.join(', '));
    ok('1c · "contactos" ya esta en la definicion (se usaba y no se podia apagar)',
       keys.includes('contactos'), keys.join(', '));
    ok('1d · no hay claves duplicadas',
       new Set(keys).size === keys.length, keys.join(', '));
    ok('1e · la descripcion de "comunicaciones" ya no promete "Mensajes"',
       !/Mensajes/.test((sb.window._CRONOS_EXTRAS_DEF.find(e => e.key === 'comunicaciones') || {}).desc || ''),
       'sigue solapandose con mensajeria');
}

// ═══════════ PARTE 2 · el punto unico de decision ═══════════
console.log('\n── PARTE 2 · _cronosExtraEnabled / _cronosExtraGate ──');
{
    // Se aisla el bloque de helpers y se ejecuta de verdad.
    const ini = SETUP.indexOf('window._cronosExtraEnabled');
    const fin = SETUP.indexOf('window._cronosRefreshExtras');
    const sb = { window: {}, document: null, showToast: null };
    sb.window.window = sb.window;
    const avisos = [];
    sb.showToast = (t) => avisos.push(t);
    sb.window.showToast = sb.showToast;
    vm.createContext(sb);
    vm.runInContext(SETUP.slice(ini, fin), sb);
    const enabled = sb.window._cronosExtraEnabled;
    const gate    = sb.window._cronosExtraGate;

    // A · por defecto TODO activo
    sb.window._cronosCurrentUser = { uid: 'u1' };                 // sin extras
    ok('2a · [DEFECTO A] sin mapa `extras`, el extra esta ACTIVO',
       enabled('mensajeria') === true, 'un club antiguo se quedaria sin app');

    sb.window._cronosCurrentUser = { uid: 'u1', extras: {} };     // mapa vacio
    ok('2b · con `extras` vacio, tambien ACTIVO',
       enabled('mensajeria') === true);

    sb.window._cronosCurrentUser = { uid: 'u1', extras: { mensajeria: false } };
    ok('2c · solo se apaga con false explicito',
       enabled('mensajeria') === false);

    sb.window._cronosCurrentUser = { uid: 'u1', extras: { mensajeria: true } };
    ok('2d · con true, activo', enabled('mensajeria') === true);

    // El portero devuelve booleano y avisa
    sb.window._cronosCurrentUser = { uid: 'u1', extras: { mensajeria: false } };
    avisos.length = 0;
    ok('2e · el portero DENIEGA y avisa', gate('mensajeria', 'La mensajeria') === false);
    ok('2f · el aviso lleva el candado', avisos.some(a => a.includes('🔒')), avisos);

    sb.window._cronosCurrentUser = { uid: 'u1', extras: {} };
    avisos.length = 0;
    ok('2g · con el extra activo DEJA pasar y no molesta',
       gate('mensajeria') === true && avisos.length === 0, avisos);

    // Usuario efectivo (cuentas multi-rol)
    sb.window._getEffectiveUser = () => ({ uid: 'u2', extras: { mensajeria: false } });
    sb.window._cronosCurrentUser = { uid: 'u1', extras: {} };
    ok('2h · manda el usuario EFECTIVO (cuentas multi-rol)',
       enabled('mensajeria') === false);
    delete sb.window._getEffectiveUser;
}

// ═══════════ PARTE 3 · donde se aplica el candado ═══════════
console.log('\n── PARTE 3 · las superficies bloqueadas ──');
{
    ok('3a · el motor de mensajeria gatea con "mensajeria"',
       /_renderUnifiedMessagingView[\s\S]{0,900}_cronosExtraGate\(\s*['"]mensajeria['"]/.test(PANEL),
       'el chat no comprueba su extra');

    // El motor es el unico paso de los SEIS roles: si alguien vuelve a gatear
    // en cada open*Messaging por separado, un rol nuevo se quedara sin candado.
    ok('3b · y lo hace en el MOTOR, no en cada entrada por rol',
       (PANEL.match(/_cronosExtraGate\(\s*['"]mensajeria['"]/g) || []).length === 1,
       'hay mas de un gateo de mensajeria: se dispersara');

    ok('3c · [DEFECTO E] el menu de Comunicaciones ya gatea "comunicaciones"',
       /openUnifiedCommsMenu[\s\S]{0,600}_cronosExtraGate\(\s*['"]comunicaciones['"]/.test(PANEL),
       'seguia siendo un extra sin ningun lector');

    ok('3d · las tarjetas del menu se bloquean sin esconderse',
       /_umCardLock\(/.test(PANEL) && /disabled title="No disponible/.test(PANEL));

    ok('3e · y el aspecto va por CSS, no por un segundo style inline',
       /\.btn-comms-card\[disabled\]/.test(PANEL),
       'dos atributos style en el mismo boton: gana el primero y se pierden --color/--bg');

    // ══════════════════════════════════════════════════════════════════
    //  🔄 v591 · YA NO HAY PESTAÑAS: LA PUERTA VISIBLE ES EL TABLERO
    //
    //  El autor retiró la barra de pestañas del Área de Familias. El
    //  invariante NO cambia —una opción sin extra contratado no puede
    //  ofrecerse abierta—, cambia dónde vive: ahora es el botón del tablero.
    //
    //  ⚠️ El cerrojo de verdad sigue siendo `ppTab` (3g, aquí debajo). El
    //  tablero es interfaz, no permiso.
    // ══════════════════════════════════════════════════════════════════
    for (const [tab, key] of [['conv','convocatorias'], ['train','entrenamientos'],
                              ['player','informes'], ['chat','mensajeria'],
                              ['live','partidos_en_vivo']]) {
        ok('3f·' + tab + ' · la opción del tablero consulta su extra (' + key + ')',
           new RegExp("'" + tab + "',\\s*'" + key + "'").test(PARENT),
           'esa opcion del tablero no consulta ningun extra');
    }
    ok('3f2 · 🔑 una opción sin extra sale BLOQUEADA, no oculta',
       /bloqueado: _libre\(extraKey\) \? '' :/.test(PARENT),
       'una opcion que desaparece sin explicacion parece una averia');

    ok('3g · el router ppTab tambien cierra (se llega desde la pila, sin click)',
       /_PP_TAB_EXTRA\[tab\][\s\S]{0,220}_cronosExtraGate/.test(PARENT),
       'una pestaña bloqueada seguiria siendo alcanzable al volver atras');

    ok('3h · [DEFECTO D] el panel no arranca en una pestaña bloqueada',
       /_ppArrancarEnPestanaValida/.test(PARENT),
       'sin extra de convocatorias, el Area de Familias abriria sobre un candado');

    // v591 · Los id de pestaña ya no existen: se retiró la barra. El invariante
    // que los sustituye es el que el autor pidió expresamente — que desde
    // CUALQUIER sección se pueda volver al tablero, para no quedarse atrapado.
    ok('3i · 🔑 desde cualquier sección hay vuelta al tablero',
       /_ppNav\.innerHTML =/.test(PARENT) && /Volver al Men/.test(PARENT),
       'sin vuelta, el usuario queda atrapado dentro de una seccion');
}

// ═══════════ PARTE 4 · el permiso de envio del padre ═══════════
console.log('\n── PARTE 4 · quien puede ENVIAR ──');
{
    ok('4a · la tabla de contactos tiene la casilla "ENVIAR"',
       /contact-cansend/.test(CONTACT) && /ENVIAR/.test(CONTACT));

    ok('4b · [DEFECTO B] se pinta marcada salvo false explicito',
       /link\.canSendMsg\s*!==\s*false\s*\?\s*'checked'/.test(CONTACT),
       'con === true, todos los padres de hoy se quedarian mudos de golpe');

    ok('4c · se guarda en cronos_player_links como canSendMsg',
       /canSendMsg:\s*sendEl\s*\?\s*sendEl\.checked\s*:\s*true/.test(CONTACT),
       'el respaldo tiene que ser true, no false');

    // Por que en cronos_player_links y no en la lista de contactos: es el
    // unico documento del entrenador que el padre puede leer (isLinkOwner).
    ok('4d · el resolutor del padre lee sus propios vinculos',
       /_cronosParentCanSendMsg[\s\S]{0,900}cronos_player_links/.test(PANEL) &&
       /where\(\s*'parentUid'\s*,\s*'=='/.test(PANEL),
       'el padre no puede leer la lista de contactos del entrenador');

    ok('4e · las filas de familiares MANUALES tienen su celda (o se desalinea la tabla)',
       /Solo aplica a familiares y jugadores vinculados/.test(CONTACT),
       'las dos clases de fila comparten el mismo tbody');

    // C · las DOS vias de envio. Se mira el CUERPO de cada funcion, sobre el
    // fuente sin comentarios: ver la nota de `sinComs` al principio.
    const cuerpoMotor = cuerpoDesde(sinComs(PANEL),
        'async function _sendUnifiedMessage(', 1400);
    ok('4f · via 1 · el motor unificado comprueba el permiso antes de escribir',
       /_cronosParentCanSendMsg/.test(cuerpoMotor),
       'el padre podria enviar desde el motor');

    const cuerpoPP = cuerpoDesde(sinComs(PARENT),
        'window.ppSendChatMessage = async (threadId) => {', 1400);
    ok('4g · [DEFECTO C] via 2 · ppSendChatMessage tambien lo comprueba',
       /_cronosParentCanSendMsg/.test(cuerpoPP),
       'el panel de padres escribe en cronos_messages por su cuenta');

    // Y el cerrojo va ANTES de la escritura, no despues.
    ok('4g2 · el cerrojo va antes del import de Firestore, no despues',
       cuerpoPP.indexOf('_cronosParentCanSendMsg') > -1 &&
       cuerpoPP.indexOf('_cronosParentCanSendMsg') < cuerpoPP.indexOf('firebase-firestore.js'),
       'comprobar el permiso despues de escribir no sirve de nada');

    ok('4h · y el redactor se sustituye por un aviso de solo lectura',
       /um-composer/.test(PANEL) && /Solo lectura/.test(PANEL));

    // B · falla hacia el "si"
    ok('4i · si la consulta falla, el padre PUEDE enviar (falla hacia el si)',
       /catch[\s\S]{0,220}return true;/.test(PANEL),
       'un error de red dejaria mudo al padre');
    ok('4j · sin vinculos tampoco se restringe',
       /!links\.length\s*\|\|\s*links\.some/.test(PANEL),
       'un padre recien registrado se quedaria mudo');
    ok('4k · con varios hijos basta que UN vinculo lo permita',
       /links\.some\(\s*l\s*=>\s*l\.canSendMsg\s*!==\s*false\s*\)/.test(PANEL));

    // El padre RECIBE siempre: no puede haber ningun gateo en la lectura.
    ok('4l · nadie condiciona la LECTURA de mensajes del padre',
       !/_cronosParentCanSendMsg[\s\S]{0,120}_loadUnifiedThreadMessages/.test(PANEL),
       'todos los padres deben recibir SIEMPRE');
}

// ═══════════ PARTE 5 · trampas del proyecto que no pueden volver ═══════════
console.log('\n── PARTE 5 · trampas conocidas ──');
{
    // La que costo los 8 fallos de test_contact_manager_module en esta ronda:
    // un backtick dentro de un comentario HTML que va DENTRO de un template
    // literal cierra la cadena, y node --check NO lo ve.
    // Se buscan los bloques <!-- ... --> COMPLETOS y se mira si alguno lleva
    // un backtick dentro. Precision importa: una heuristica por sangria marca
    // como sospechosos los template literals legitimos del propio fichero.
    const comentariosConBacktick = (rel, src) => {
        const out = [];
        const re = /<!--[\s\S]*?-->/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            if (m[0].includes('`')) {
                const linea = src.slice(0, m.index).split('\n').length;
                out.push(rel + ':' + linea);
            }
        }
        return out;
    };
    const sospechosos = [
        ...comentariosConBacktick('contact-manager.js', CONTACT),
        ...comentariosConBacktick('parent/panel.js',    PARENT),
        ...comentariosConBacktick('comms/panel.js',     PANEL),
        ...comentariosConBacktick('setup-modal.js',     SETUP),
    ];
    ok('5a · ningun comentario HTML lleva backticks (cierran el template literal)',
       sospechosos.length === 0, sospechosos.join(' | '));

    // El panel de padres ya tenia esta advertencia escrita; que siga.
    ok('5b · el aviso de "sin backticks" sigue documentado donde toca',
       /SIN BACKTICKS/.test(PARENT) && /SIN BACKTICKS/.test(CONTACT));

    // _cronosExtraBtn no puede volver a llevar su propia copia de la regla.
    ok('5c · _cronosExtraBtn delega en el portero, no repite la lectura',
       /const guard = "if\(typeof window\._cronosExtraGate/.test(SETUP),
       'dos reglas distintas de extras pueden divergir (y divergian)');
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
