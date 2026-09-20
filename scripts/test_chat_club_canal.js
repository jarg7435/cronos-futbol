// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v739 · EL CANAL COMÚN DEL CLUB (lado cliente)
// ═══════════════════════════════════════════════════════════════════════════
//  Las REGLAS las mide scripts/test_chat_club_rules.js contra el servidor de
//  Google. Aquí se mide lo otro: que la pantalla ofrezca EXACTAMENTE el mismo
//  canal que la base de datos permite.
//
//  🚨 POR QUÉ ESA PAREJA IMPORTA MÁS QUE DE COSTUMBRE: si la interfaz pinta la
//  pestaña a alguien a quien las reglas se la van a negar, el síntoma es un
//  «Missing or insufficient permissions» que parece un fallo de permisos y es
//  un fallo de criterio. Y al revés —reglas que permiten y pantalla que no
//  pinta— es una función invisible que nadie reporta. Por eso la parte 1
//  EJECUTA la lista de roles del cliente y la compara, uno a uno, con la lista
//  blanca escrita en firestore.rules: la misma técnica que impide que diverjan
//  las dos tablas de tipos de partido (v735).
//
//  ⚠️ Y LAS DOS LISTAS DE PESTAÑAS. js/coach/comms/panel.js mantiene la lista
//  de pestañas DOS VECES —una para pintarlas y otra para subrayar la activa— y
//  su propio comentario avisa: «si se añade una pestaña allí y no aquí, el
//  botón se pinta pero al pulsarlo no cambia nada». La parte 2 lo fija.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
//  ⚠️ SE NORMALIZAN LOS FINALES DE LÍNEA, y no es cosmética: en JavaScript el
//  punto de un regex NO casa con `\r`, y `$` sin la bandera `m` es el final de
//  TODA la cadena. Con ficheros en CRLF —que es como los deja este repo en
//  otra máquina, por el .gitattributes— un `//.*$` deja de quitar comentarios y
//  varias aserciones de texto empiezan a medir lo que se escribe SOBRE el
//  código en vez del código. Lo destapó el red-check de v740: la misma
//  comprobación salía verde aquí y roja sobre una copia en CRLF.
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');

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

const CHAT   = leer('js/coach/comms/club-chat.js');
const PANEL  = leer('js/coach/comms/panel.js');
const RULES  = leer('firestore.rules');
const SEASON = leer('js/admin/superadmin/season-reset.js');
const INDEX  = leer('index.html');
const IDX    = JSON.parse(leer('firestore.indexes.json'));

const parte = (fn) => {
    try { fn(); }
    catch (e) {
        console.log('  ✗ esta parte se detuvo: ' + (e && e.message));
        fallos++; total++;
    }
};

// El módulo, ejecutado. No toca el DOM al cargar: sólo declara y publica.
function cargar() {
    const sb = { console: { log() {}, warn() {}, error() {} },
                 String, Object, Array, Number, Boolean, Date, JSON, Math, isNaN };
    sb.window = sb;
    sb.globalThis = sb;
    sb.document = { getElementById: () => null };
    vm.createContext(sb);
    vm.runInContext(CHAT, sb);
    return sb;
}

console.log('\n══ v739 · el canal común del club ══');

const w = cargar();

// ═════════════════════════════════════════════════════════════════════
console.log('\n1) 🔑 PANTALLA Y REGLAS DICEN LO MISMO SOBRE QUIÉN ENTRA');
parte(() => {
    ok('1a · el módulo publica su criterio de acceso y el de gestión',
       typeof w.ccPuedeVerCanal === 'function' && typeof w.ccEsAdminDelClub === 'function' &&
       typeof w.ccPuedeGestionar === 'function');

    // La lista blanca escrita en las reglas, extraída del fichero real.
    const m = RULES.match(/function ccEsTecnicoDelClub[\s\S]*?\.data\.get\('role', ''\) in \[([^\]]+)\]/);
    ok('1b · se localiza la lista blanca de roles en firestore.rules', !!m);
    const deLasReglas = m ? m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : [];

    // Y la del cliente, ejecutando su predicado rol por rol.
    const todos = ['director', 'coordinator', 'coach', 'user', 'club_admin', 'admin',
                   'parent', 'entrenador_individual', 'parent_individual',
                   'admin_individual', 'individual_admin', 'superadmin'];
    const delCliente = todos.filter(r => w.ccPuedeVerCanal({ clubId: 'clubA', role: r }));

    ok('1c · 🔑🔑 la lista del cliente y la de las reglas son LA MISMA',
       deLasReglas.slice().sort().join(',') === delCliente.slice().sort().join(','),
       'reglas: [' + deLasReglas.join(', ') + ']  ·  cliente: [' + delCliente.join(', ') + ']');

    ok('1d · 🔑 están los CUATRO roles del encargo (y «user», que también es entrenador)',
       ['director', 'coordinator', 'coach', 'user', 'club_admin'].every(r => delCliente.indexOf(r) !== -1),
       delCliente.join(', '));
    ok('1e · 🔑🔑 el FAMILIAR queda fuera',
       w.ccPuedeVerCanal({ clubId: 'clubA', role: 'parent' }) === false);
    ok('1f · 🔑 y el ENTE INDIVIDUAL, en sus cuatro variantes',
       ['entrenador_individual', 'parent_individual', 'admin_individual', 'individual_admin']
         .every(r => w.ccPuedeVerCanal({ clubId: 'ente1', role: r }) === false));
    ok('1g · sin club no hay canal',
       w.ccPuedeVerCanal({ role: 'director' }) === false &&
       w.ccPuedeVerCanal({ clubId: '', role: 'coach' }) === false);

    // 🚨 GESTIONAR (expulsar y vaciar) ES DE DOS FIGURAS, NO DE CINCO.
    //  ⚠️ ACTUALIZADA EN v742 por PETICIÓN EXPRESA del autor (implementar.txt
    //  2026-09-18): «sólo pueden ver y utilizar el botón de Gestionar el
    //  Administrador del Club y el Director Deportivo». Antes era sólo el
    //  administrador. Lo que el guard protege NO cambia —que el COORDINADOR y
    //  el ENTRENADOR no gestionen— y es lo que sigue midiéndose abajo, ahora
    //  además desde la plaza activa.
    ok('1h · 🔑🔑 gestionan el ADMINISTRADOR y el DIRECTOR, y nadie más',
       w.ccPuedeGestionar({ role: 'club_admin' }) === true &&
       w.ccPuedeGestionar({ role: 'admin' }) === true &&
       w.ccPuedeGestionar({ role: 'director' }) === true &&
       w.ccPuedeGestionar({ role: 'coordinator' }) === false &&
       w.ccPuedeGestionar({ role: 'coach' }) === false &&
       w.ccPuedeGestionar({ role: 'user' }) === false &&
       w.ccPuedeGestionar({ role: 'parent' }) === false);
    //  🚨 EL DEFECTO DE SUS CAPTURAS 10587-10591: la misma cuenta con rol raíz
    //  `club_admin` veía «Gestionar» actuando de entrenador y de coordinador,
    //  porque sólo se preguntaba por el rol raíz.
    ok('1h2 · 🚨🚨 la PLAZA ACTIVA también manda: de entrenador, no se gestiona',
       w.ccPuedeGestionar({ role: 'club_admin', _activeRole: 'coach' }) === false &&
       w.ccPuedeGestionar({ role: 'club_admin', _activeRole: 'coordinator' }) === false &&
       w.ccPuedeGestionar({ role: 'director',  _activeRole: 'coach' }) === false,
       'en sus 4 capturas salía el botón en las 4 plazas: era la misma cuenta');
    ok('1h3 · 🔑 y desde una plaza de gestión, sí',
       w.ccPuedeGestionar({ role: 'club_admin', _activeRole: 'club_admin' }) === true &&
       w.ccPuedeGestionar({ role: 'club_admin', _activeRole: 'director' }) === true &&
       w.ccPuedeGestionar({ role: 'director', _activeRole: 'director' }) === true);
    ok('1h4 · ⚠️⚠️ la plaza activa sólo QUITA, nunca da (es autoescribible)',
       w.ccPuedeGestionar({ role: 'coach', _activeRole: 'club_admin' }) === false &&
       w.ccPuedeGestionar({ role: 'coordinator', _activeRole: 'director' }) === false,
       'si `_activeRole` pudiera conceder, se falsifica desde la consola en dos palabras');
    ok('1h5 · sin plaza activa declarada manda el rol raíz',
       w.ccPuedeGestionar({ role: 'club_admin' }) === true &&
       w.ccPuedeGestionar({ role: 'coach' }) === false);
    ok('1i · 🔑🔑 y las reglas dicen lo mismo: administrador O director',
       /function ccPuedeGestionarCanal\(clubId\)\s*\{\s*return ccEsAdminDelClub\(clubId\) \|\| ccEsDirectorDelClub\(clubId\);/.test(RULES),
       'si aquí entrara isAdminOfClub(), el COORDINADOR podría expulsar');
    ok('1i2 · ⚠️ el director de las reglas se resuelve por el ROL RAÍZ del documento',
       /function ccEsDirectorDelClub\(clubId\)[\s\S]{0,700}data\.get\('role', ''\) == 'director'[\s\S]{0,400}data\.get\('isAuthorized', false\) == true/.test(RULES) &&
       !/function ccEsDirectorDelClub\(clubId\)[\s\S]{0,700}allRoles/.test(RULES),
       '`allRoles` es autoescribible: una regla apoyada en él la falsifica cualquiera');
    ok('1i3 · 🚨 y NO exige `status`, que documentos antiguos pueden no tener',
       !/function ccEsDirectorDelClub\(clubId\)[\s\S]{0,700}status/.test(RULES),
       'un director sin ese campo vería el botón y recibiría un «permissions» al pulsarlo');
    ok('1i4 · 🔑 las DOS puertas de escritura usan el mismo criterio',
       /allow create, update: if isAuth\(\) && ccPuedeGestionarCanal\(clubId\)/.test(RULES) &&
       /ccPuedeGestionarCanal\(resource\.data\.get\('clubId', null\)\)/.test(RULES),
       'la cabecera guarda a los expulsados y el borrado vacía el histórico: gestionar es las dos');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n2) ⚠️ LA PESTAÑA, EN LAS **DOS** LISTAS DE panel.js');
parte(() => {
    // Lista 1: la que PINTA los botones (objetos con id/label/icon).
    //  ⚠️ SE ANCLA AL BLOQUE «Definición de pestañas por rol», no al primer
    //  `role === '…'` del fichero: ese patrón aparece a docenas por todo
    //  panel.js (el motor decide mil cosas por rol) y buscarlo a pelo medía
    //  trozos de OTRAS funciones — tres aserciones en rojo sin defecto detrás.
    const BLOQUE_TABS = (() => {
        const i = PANEL.indexOf('// Definición de pestañas por rol');
        const j = PANEL.indexOf("if (!tabs.find(t => t.id === tab))", i);
        return (i < 0 || j < 0) ? '' : PANEL.slice(i, j);
    })();
    ok('2z · se localiza el bloque que define las pestañas', !!BLOQUE_TABS);
    const pintadas = (rol) => {
        const i = BLOQUE_TABS.indexOf(`role === '${rol}'`);
        if (i < 0) return '';
        const resto = BLOQUE_TABS.slice(i);
        const fin = resto.indexOf('} else if (');
        return fin > 0 ? resto.slice(0, fin) : resto;
    };
    ok('2a · el DIRECTOR tiene la pestaña del canal', /id: 'club'/.test(pintadas('director')));
    ok('2b · el COORDINADOR también', /id: 'club'/.test(pintadas('coordinator')));
    ok('2c · el ADMINISTRADOR DEL CLUB también', /id: 'club'/.test(pintadas('club_admin')));
    ok('2d · y el ENTRENADOR la tiene en su literal, como los otros tres',
       /id: 'club'/.test(pintadas('coach')));
    //  🚨 LA EXCLUSIÓN DEL ENTE VA AL FINAL, FILTRANDO, no como un `push`
    //  condicional dentro de la rama del entrenador: así lo obligó la aserción
    //  1h de test_admin_messaging_channels.js, que compara las DOS listas de
    //  pestañas rol a rol y cazó que una decía tres y la otra cuatro.
    ok('2d2 · 🔑 y el ENTE queda fuera filtrando DESPUÉS de construir las listas',
       /if \(_esEnteIndividual\) tabs = tabs\.filter\(t => t\.id !== 'club'\)/.test(PANEL),
       'el encargo dice que el canal aplica exclusivamente a clubes');

    // Lista 2: la de los ids, la que subraya la pestaña activa.
    const l2 = (rol) => {
        const m = PANEL.match(new RegExp(`role === '${rol}'\\) tabs = \\[([^\\]]*)\\]`));
        return m ? m[1] : '';
    };
    ok('2e · 🔑🔑 y la SEGUNDA lista dice lo mismo para los cuatro',
       ['coach', 'director', 'coordinator', 'club_admin'].every(r => /'club'/.test(l2(r))),
       'sin esto el botón se pinta y al pulsarlo no cambia nada (lo avisa el propio fichero)');
    ok('2f · 🔑 el FAMILIAR no la tiene en ninguna de las dos',
       !/'club'/.test(l2('parent')) && !/id: 'club'/.test(pintadas('parent')));
    ok('2g · 🔑 ni el administrador del ENTE individual',
       !/'club'/.test(l2('admin_individual')) && !/id: 'club'/.test(pintadas('admin_individual')));
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n3) EL MOTOR DE MENSAJERÍA LA TRATA COMO LO QUE ES');
parte(() => {
    ok('3a · la pestaña del canal se corta ANTES de construir destinatarios',
       /if \(tabId === 'club'\)/.test(PANEL),
       'el canal no tiene contactos que elegir: es un único destino compartido');
    ok('3b · y pinta el canal en la columna derecha',
       /ccAbrirCanal\('um-chat-view'\)/.test(PANEL));
    ok('3c · ⚠️ esconde «Enviar grupal», que dentro del canal no significa nada',
       /if \(tabId === 'club'\)[\s\S]{0,600}um-bulk-bar[\s\S]{0,120}display = 'none'/.test(PANEL));
    ok('3d · 🔑 y la devuelve al salir (si no, se quedaría oculta para siempre)',
       /_bulk\.style\.display = ''/.test(PANEL));
    ok('3e · 🔑🔑 el oyente en vivo se CORTA al salir del canal',
       /_ccCortarOyente/.test(PANEL) && /window\._ccCortarOyente = _ccCortarOyente/.test(CHAT),
       'sin esto cada visita a la pestaña deja una consulta viva (v719)');
    ok('3f · el módulo se carga en index.html',
       /js\/coach\/comms\/club-chat\.js/.test(INDEX));
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n4) LA CONSULTA EN VIVO Y SU ÍNDICE');
parte(() => {
    // 🚨 `limit` SIN `orderBy` es una ventana en lo MÁS VIEJO (v508): en un chat
    // eso son los primeros 100 mensajes de la temporada, para siempre.
    ok('4a · 🚨 la consulta lleva orderBy DESCENDENTE, no sólo limit',
       /orderBy\('createdAt', 'desc'\)[\s\S]{0,80}limit\(CC_TOPE\)/.test(CHAT),
       'limit sin orderBy devolvería los mensajes MÁS VIEJOS (lección de v508)');
    ok('4b · y se le da la vuelta para pintar del más viejo al más nuevo',
       /out\.reverse\(\)/.test(CHAT));
    ok('4c · va acotada por clubId', /where\('clubId', '==', clubId\)/.test(CHAT));

    // Sin el índice compuesto, esa consulta falla ENTERA en producción.
    const idx = (IDX.indexes || []).find(i => i.collectionGroup === 'cronos_staff_messages');
    ok('4d · 🔑🔑 el índice compuesto está declarado', !!idx,
       'sin él la consulta del canal falla con failed-precondition');
    ok('4e · y es el que pide la consulta (clubId ASC + createdAt DESC)',
       !!idx && idx.fields.length === 2 &&
       idx.fields[0].fieldPath === 'clubId'    && idx.fields[0].order === 'ASCENDING' &&
       idx.fields[1].fieldPath === 'createdAt' && idx.fields[1].order === 'DESCENDING',
       JSON.stringify(idx && idx.fields));

    //  ⚠️ LA VENTANA SUBIÓ A 1400 EN v743, y no es un aflojamiento: el cuerpo
    //  del oyente creció (ahora marca el canal como leído desde dentro) y el
    //  `}, (err) =>` se salió de los 900 caracteres. El guard se puso rojo con
    //  el callback de error INTACTO — medía la distancia, no su existencia.
    ok('4f · 🚨 el onSnapshot lleva callback de ERROR',
       /onSnapshot\([\s\S]{0,1400}\}, \(err\) =>/.test(CHAT),
       'un onSnapshot sin callback de error queda MUERTO tras un permission-denied (v717)');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n5) BORRADO, EXPULSIÓN Y VACIADO DE TEMPORADA');
parte(() => {
    ok('5a · el remitente que se sella es QUIEN FIRMA',
       /senderUid:\s*yo\.uid/.test(CHAT));
    //  ⚠️ ACTUALIZADA EN v741. Fijaba `senderName: yo.name`… y ESE CAMPO NO
    //  EXISTE: el usuario de sesión lleva firstName/lastName/displayName, así
    //  que la cadena caía siempre al correo y el canal firmaba «arinagazone».
    //  El guard daba verde sobre el defecto porque medía la FORMA de la línea,
    //  no lo que la línea produce. Lo que protegía —que el nombre y el rol se
    //  SELLEN y no se resuelvan al leer— no cambia y se sigue midiendo.
    ok('5b · 🔑 el nombre y el rol se SELLAN en el mensaje, no se resuelven al leer',
       /senderName:\s*_ccNombreDe\(yo\)/.test(CHAT) && /senderRole:\s*_ccRolFirma\(yo\)/.test(CHAT),
       'quien lo escribió puede cambiar de rol o dejar el club');
    ok('5c · el borrado propio avisa de que es para TODO el canal',
       /Desaparecerá para todos los miembros del canal/.test(CHAT),
       'v669: un botón que promete borrar y sólo oculta es peor que no tenerlo');
    ok('5d · el vaciado del administrador va ACOTADO POR clubId',
       /ccVaciarCanal[\s\S]{0,900}where\('clubId', '==', yo\.clubId\)/.test(CHAT),
       'sin acotar borraría el canal de OTROS clubes, y esto no tiene deshacer');
    ok('5e · y pide confirmación antes de borrar el histórico',
       /ccVaciarCanal[\s\S]{0,400}confirm\(/.test(CHAT));
    ok('5f · 🔑 el vaciado de temporada del SuperAdmin también lo alcanza',
       /col: 'cronos_staff_messages'/.test(SEASON));
    ok('5g · ⚠️ pero NO viene marcado por defecto (son mensajes de personas)',
       /col: 'cronos_staff_messages'[\s\S]{0,120}porDefecto: false/.test(SEASON));
    // ── 🔐 v742 · «Ni estar accesible bajo ningún concepto» ───────────
    //  Esconder el botón no cierra nada: las tres funciones están publicadas
    //  en `window` y se invocan desde la consola en dos palabras.
    ok('5d2 · 🚨 las TRES puertas de gestión preguntan, no sólo el botón',
       /async function ccAbrirGestion\(\)\s*\{\s*const yo = _ccYo\(\);\s*if \(!ccPuedeGestionar\(yo\)\) return;/.test(CHAT) &&
       /async function ccCambiarAcceso\(uid, expulsar\)\s*\{\s*const yo = _ccYo\(\);\s*if \(!ccPuedeGestionar\(yo\) \|\| !uid\) return;/.test(CHAT) &&
       /async function ccVaciarCanal\(\)\s*\{\s*const yo = _ccYo\(\);\s*if \(!ccPuedeGestionar\(yo\)\) return;/.test(CHAT),
       'el encargo dice «ni estar accesible bajo ningún concepto»');
    ok('5d3 · y el botón «Gestionar» sale del MISMO criterio',
       /const puedeGestionar = ccPuedeGestionar\(yo\)/.test(CHAT) &&
       /\$\{puedeGestionar \? `/.test(CHAT) &&
       !/soyAdmin \? `[\s\S]{0,200}ccAbrirGestion/.test(CHAT));
    ok('5d4 · 🛡️ al ADMINISTRADOR del club no se le puede expulsar',
       /ccEsAdminDelClub\(u\) \? '<span[^']*>administrador<\/span>'/.test(CHAT),
       'la pantalla del expulsado se pinta ANTES que el botón de gestión: no habría vuelta');
    ok('5h · la pertenencia NO se mantiene en una lista: sólo se anota lo excepcional',
       /expelledUids/.test(CHAT) && !/memberUids|miembrosUids/.test(CHAT),
       'el alta es automática al registrar a alguien en el club (encargo)');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n6) 🎨 v740 · SE DISTINGUE QUIÉN DICE QUÉ');
parte(() => {
    //  Encargo (implementar.txt 2026-09-18, capturas 10575-10579): lo mío a la
    //  derecha, lo de los demás a la izquierda, y un color por persona.

    // ── El color sale del uid, no del orden de llegada ────────────────
    ok('6a · el módulo publica el color por persona', typeof w._ccColorDe === 'function');
    const paleta = w.CC_PALETA || [];
    ok('6b · 🔑🔑 la MISMA persona siempre el MISMO color, en cualquier pantalla',
       w._ccColorDe('uidAna') === w._ccColorDe('uidAna') &&
       w._ccColorDe('uidAna') !== undefined,
       'repartirlo por orden de llegada lo cambiaría al borrar un mensaje o al pasar el tope');
    ok('6c · y personas distintas, colores distintos (en un caso real)',
       new Set(['u1', 'u2', 'u3', 'u4'].map(w._ccColorDe)).size >= 3,
       ['u1', 'u2', 'u3', 'u4'].map(w._ccColorDe).join(' '));
    //  ⚠️ SE MIRA EL CUERPO DE LA FUNCIÓN **SIN SUS COMENTARIOS**. Esta
    //  aserción salió roja DOS veces por la misma razón y ninguna era un
    //  defecto: primero por el comentario de cabecera del fichero y luego por
    //  el que va DENTRO de la propia función, que dice «no se usa
    //  Math.random». Un censo de texto no distingue el código de lo que se
    //  escribe sobre él — es la trampa que la aserción 1c de
    //  test_report_engine_module.js documenta desde v735, y que aquí se
    //  esquiva quitando los comentarios antes de buscar.
    const sinCom = (s) => s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
    const cuerpoColor = (() => {
        const i = CHAT.indexOf('function _ccColorDe(uid) {');
        return i < 0 ? '' : sinCom(CHAT.slice(i, CHAT.indexOf('\n}', i)));
    })();
    ok('6d · ⚠️ el hash no depende de la sesión (nada de Math.random ni Date)',
       !!cuerpoColor && !/Math\.random|Date\.now|new Date/.test(cuerpoColor),
       'un color que cambie entre sesiones no sirve para reconocer a nadie');
    ok('6e · sin uid no revienta: devuelve un gris',
       w._ccColorDe('') === '#8b949e' && w._ccColorDe(null) === '#8b949e');
    ok('6f · 🔑 el verde de MIS mensajes NO está en la paleta de los demás',
       Array.isArray(paleta) && paleta.indexOf('#3fb950') === -1,
       'si coincidiera, un compañero se vería como si fuera yo');

    // ── Alineación ────────────────────────────────────────────────────
    ok('6g · 🔑🔑 lo MÍO a la derecha y lo de los demás a la izquierda',
       /flex-direction:\$\{mio \? 'row-reverse' : 'row'\}/.test(CHAT));
    ok('6h · y la esquina sin redondear apunta a quien habla',
       /const radio = mio \? '14px 14px 4px 14px' : '14px 14px 14px 4px'/.test(CHAT));
    ok('6i · la burbuja se tiñe con el color de la persona',
       /background:\$\{col\}1a/.test(CHAT) && /const col = mio \? CC_COLOR_MIO : _ccColorDe\(m\.senderUid\)/.test(CHAT));
    ok('6j · ⚠️ la píldora sigue siendo del CARGO, no de la persona',
       /colRol = CC_COLOR_ROL\[rol\]/.test(CHAT),
       'quién lo dice y desde qué puesto son dos preguntas: un solo color pierde una');

    // ── El correo entero no cabe (se ve en su captura 10579) ──────────
    ok('6k · el nombre se acorta por la arroba',
       /_ccNombreCorto/.test(CHAT) && /n\.slice\(0, n\.indexOf\('@'\)\)/.test(CHAT));

    // ── 🚨 El rol con el que se FIRMA ─────────────────────────────────
    //  En su captura los tres mensajes salieron como «ADMINISTRADOR» aunque los
    //  mandó actuando de tres cargos distintos: se firmaba con el rol RAÍZ.
    ok('6l · 🚨 se firma con la PLAZA ACTIVA, no con el rol raíz',
       typeof w._ccRolFirma === 'function' &&
       w._ccRolFirma({ role: 'club_admin', _activeRole: 'coordinator' }) === 'coordinator',
       'tres mensajes suyos con tres cargos salieron los tres como ADMINISTRADOR');
    ok('6m · 🔑 pero el ACCESO lo sigue decidiendo el rol RAÍZ (es lo que miran las reglas)',
       /ccPuedeVerCanal[\s\S]{0,300}CC_ROLES\.indexOf\(_ccRolDe\(u\)\)/.test(CHAT),
       '`allRoles`/`_activeRole` son autoescribibles: no pueden dar acceso');
    ok('6n · ⚠️ una plaza activa ajena al canal cae al rol raíz',
       w._ccRolFirma({ role: 'club_admin', _activeRole: 'parent' }) === 'club_admin' &&
       w._ccRolFirma({ role: 'director' }) === 'director');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n7) 🗂️ v740 · LA BARRA DE PESTAÑAS NO CORTA NINGUNA');
parte(() => {
    const CSS = leer('style.css');
    //  📏 La barra vive en una columna de 340px con `overflow:hidden`, y sus
    //  botones nacían con `flex:1` + `white-space:nowrap`: cuatro etiquetas no
    //  caben y el padre recorta la última SIN scroll y SIN aviso.
    ok('7a · 🔑🔑 la barra puede pasar a varias filas',
       /\.um-tabbar\s*\{[^}]*flex-wrap:\s*wrap/.test(CSS),
       'con 4 pestañas, deslizar esconde la mitad; envolviendo se ven todas');
    ok('7b · 🔑 y los botones pueden ENCOGER hasta su contenido',
       /\.um-tab\s*\{[^}]*flex:\s*1 1 auto\s*!important/.test(CSS),
       '`flex:1` reparte el sobrante pero no baja del contenido de un nowrap');
    ok('7c · ⚠️ con !important, que es lo único que vence a un style="" inline',
       /\.um-tab\s*\{[^}]*!important/.test(CSS));
    ok('7d · ningún botón baja de su ancho mínimo legible',
       /\.um-tab\s*\{[^}]*min-width:\s*max-content/.test(CSS));
    ok('7e · las CUATRO pestañas del Director caben en el recuento',
       (PANEL.match(/id: 'club'/g) || []).length >= 4,
       'una por cada rol que tiene canal: coach, director, coordinator, club_admin');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n8) 🪪 v741 · NOMBRE REGISTRADO Y ROL, NUNCA EL CORREO');
parte(() => {
    //  Encargo (implementar.txt 2026-09-18, capturas 10583-10585): «desaparece
    //  el correo y se sustituye por el nombre de usuario registrado junto a su
    //  rol».
    //
    //  🚨 SE MIDE EJECUTANDO, no por la forma de la cadena: el defecto de v740
    //  era precisamente una cadena con la forma correcta y el campo
    //  equivocado (`yo.name`, que no existe en este proyecto). Un guard de
    //  texto lo habría vuelto a dejar pasar.
    ok('8a · el módulo publica la resolución de nombre', typeof w._ccNombreDe === 'function');

    //  El usuario de sesión REAL, tal y como lo arma js/services/auth.js:1942.
    //  Ni un `name` a la vista: ése era el campo que se leía.
    const sesion = { uid: 'u1', email: 'arinagazone@gmail.com', role: 'club_admin',
                     firstName: 'José Alberto', lastName: null, displayName: null };
    ok('8b · 🔑🔑 con el usuario REAL de la app sale el NOMBRE, no el correo',
       w._ccNombreDe(sesion) === 'José Alberto',
       'devolvió: ' + JSON.stringify(w._ccNombreDe(sesion)));
    ok('8c · `displayName` manda cuando existe',
       w._ccNombreDe({ displayName: 'Dámaso RV', firstName: 'Dámaso', email: 'd@x.com' }) === 'Dámaso RV');
    ok('8d · y si no, nombre y apellido juntos',
       w._ccNombreDe({ firstName: 'Ana', lastName: 'Ruiz', email: 'ana@x.com' }) === 'Ana Ruiz');
    ok('8e · ⚠️ la plaza es el ÚLTIMO recurso, no el primero',
       w._ccNombreDe({ email: 'x@y.com', allRoles: [{ role: 'coach', firstName: 'Luis' }] }) === 'Luis' &&
       w._ccNombreDe({ firstName: 'Raíz', allRoles: [{ firstName: 'Plaza' }] }) === 'Raíz',
       'el nombre de la plaza se copia al dar el alta y puede haberse quedado viejo');
    ok('8f · sin ningún nombre registrado, el correo va SIN dominio',
       w._ccNombreDe({ email: 'arinagazone@gmail.com' }) === 'arinagazone' &&
       w._ccNombreDe({}) === '',
       'una cuenta sin nombre tiene que seguir siendo distinguible');

    // ── El censo arregla lo YA ESCRITO ────────────────────────────────
    //  Los mensajes que ya están en producción se sellaron con el correo. Sin
    //  esto, el encargo quedaría cumplido sólo para los mensajes futuros y el
    //  autor seguiría viendo «arinagazone» en todo su histórico.
    ok('8g · 🔑 hay censo de nombres del club y se cachea por clubId',
       typeof w._ccCargarDirectorio === 'function' &&
       /st\.directorio && st\.directorio\.clubId === clubId/.test(CHAT),
       'el canal se abre cada vez que se entra en la pestaña: una lectura por sesión');
    ok('8h · 🔑🔑 el nombre pintado sale del censo ANTES que el sellado',
       /const vivo = dir\[m && m\.senderUid\];\s*\n\s*if \(vivo\) return vivo;/.test(CHAT),
       'sin esto, el histórico ya escrito seguiría mostrando el correo');
    ok('8i · ⚠️ y si el censo no se puede leer, se cae al nombre sellado',
       /catch \(_\) \{ \/\* sin censo se pinta el nombre sellado/.test(CHAT),
       'quien ya dejó el club no está en el censo y conserva su firma');
    ok('8j · el censo se carga ANTES de enganchar el oyente en vivo',
       CHAT.indexOf('await _ccCargarDirectorio(clubId)') > 0 &&
       CHAT.indexOf('await _ccCargarDirectorio(clubId)') < CHAT.indexOf('onSnapshot(q,'),
       'el primer snapshot llega de inmediato y pintaría los correos');

    // ── Nombre Y ROL, que es lo que pide el encargo ───────────────────
    ok('8k · 🔑 junto al nombre sigue yendo el CARGO, con su etiqueta legible',
       /\$\{_ccEsc\(etiq\.toUpperCase\(\)\)\}/.test(CHAT) &&
       /const etiq = CC_ETIQUETA_ROL\[rol\] \|\| 'Miembro'/.test(CHAT),
       '«José Alberto, entrenador»: el nombre identifica y el cargo sitúa');
    ok('8l · y el avatar dice las dos cosas al pasar por encima',
       /title="\$\{_ccEsc\(nombre \+ ' · ' \+ etiq\)\}"/.test(CHAT));
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n9) 🖼️ v741 · UN SOLO CONTENEDOR PARA LOS CUATRO PANELES');
parte(() => {
    //  Encargo: «los paneles de mensajería de los diferentes roles deben ser
    //  exactamente iguales […] el mismo formato amplio, grande y espacioso que
    //  tiene el panel del administrador del club».
    //
    //  🔑 NO ERAN DOS DISEÑOS: era el MISMO motor en dos contenedores. Pasarle
    //  un contenedor lo empotra en el panel anfitrión (960px); no pasárselo lo
    //  abre en modal, que es lo que ven el Administrador y el Entrenador.
    const SD = leer('js/coach/reports/club-reports.js');
    ok('9a · 🔑🔑 el Director ya NO empotra la mensajería en su panel',
       /openDirectorMessaging\('coordinators'\)/.test(SD) &&
       !/openDirectorMessaging\([^)]*staff-dashboard-content/.test(SD),
       'con contenedor se pinta dentro de min(96vw,960px): la mitad de ancho');
    ok('9b · 🔑🔑 ni el Coordinador',
       /openCoordinatorMessaging\('director'\)/.test(SD) &&
       !/openCoordinatorMessaging\([^)]*staff-dashboard-content/.test(SD));
    ok('9c · 🚨 y la raíz del panel vuelve al TABLERO antes de abrirla',
       /navRootScreen\('openStaffDashboard', 'menu'\)[\s\S]{0,400}openDirectorMessaging/.test(SD),
       'si la raíz siguiera en «mensajes», el "Volver" de la mensajería la reabriría: bucle');
    ok('9d · 🔑 los cuatro roles pasan por el MISMO render',
       /async function _renderUnifiedMessagingView\(role, tab, targetContainerId\)/.test(PANEL) &&
       (PANEL.match(/_renderUnifiedMessagingView\(/g) || []).length >= 5,
       'la unificación no es copiar estilos: es no pasar contenedor');
});

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);
