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
    ok('1a · el módulo publica su criterio de acceso',
       typeof w.ccPuedeVerCanal === 'function' && typeof w.ccEsAdminDelClub === 'function');

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

    // 🚨 EXPULSAR ES DEL ADMINISTRADOR. `isAdminOfClub()` de las reglas incluye
    // al director y al coordinador: usarla habría dado a los tres la potestad
    // que el autor reserva a uno.
    ok('1h · 🔑🔑 sólo el ADMINISTRADOR DEL CLUB expulsa y vacía',
       w.ccEsAdminDelClub({ role: 'club_admin' }) === true &&
       w.ccEsAdminDelClub({ role: 'admin' }) === true &&
       w.ccEsAdminDelClub({ role: 'director' }) === false &&
       w.ccEsAdminDelClub({ role: 'coordinator' }) === false &&
       w.ccEsAdminDelClub({ role: 'coach' }) === false);
    ok('1i · y las reglas se lo reservan a la MISMA figura',
       /function ccEsAdminDelClub\(clubId\)\s*\{\s*return isClubAdmin\(clubId\) \|\| isClubAdminOf\(clubId\);/.test(RULES),
       'si aquí entrara isAdminOfClub(), el director podría expulsar');
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

    ok('4f · 🚨 el onSnapshot lleva callback de ERROR',
       /onSnapshot\([\s\S]{0,900}\}, \(err\) =>/.test(CHAT),
       'un onSnapshot sin callback de error queda MUERTO tras un permission-denied (v717)');
});

// ═════════════════════════════════════════════════════════════════════
console.log('\n5) BORRADO, EXPULSIÓN Y VACIADO DE TEMPORADA');
parte(() => {
    ok('5a · el remitente que se sella es QUIEN FIRMA',
       /senderUid:\s*yo\.uid/.test(CHAT));
    ok('5b · 🔑 el nombre y el rol se SELLAN en el mensaje, no se resuelven al leer',
       /senderName:\s*yo\.name/.test(CHAT) && /senderRole:\s*_ccRolFirma\(yo\)/.test(CHAT),
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

console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
process.exit(fallos ? 1 : 0);
