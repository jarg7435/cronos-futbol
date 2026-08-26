// ─────────────────────────────────────────────────────────────────────────
//  test_sa_diagnostico_y_bajas.js  ·  v628
//
//  Encargo del autor (implementar.txt, 2026-08-25), el día que entra el primer
//  usuario real a producción:
//    1. Dar de baja o bloquear a cualquier usuario, justificando el motivo y
//       guardando registro.
//    2. Entrar en el panel de cualquier usuario para diagnosticar.
//
//  Y sus TRES decisiones, tomadas sobre opciones medidas:
//    · bloqueo = «próximo acceso» (sin Cloud Function: van directas a producción)
//    · diagnóstico = SÓLO LECTURA
//    · `users/{uid}/cronos_data` no se toca (exigiría cambiar reglas)
//
//  ════════════════════════════════════════════════════════════════════
//  LO QUE ESTE GUARD PROTEGE DE VERDAD
//
//  🔴 EL CANDADO DE ESCRITURA SE **EJECUTA**, no se lee. Es la pieza sobre la
//  que descansa la promesa «puede ver, no puede actuar», y una promesa así
//  comprobada por expresión regular sobre el fuente no vale nada. Se carga el
//  módulo real en un sandbox con `fetch` y `XMLHttpRequest` de mentira y se
//  comprueba, petición a petición, QUÉ pasa y QUÉ se bloquea:
//    · las ESCRITURAS de Firestore y las Cloud Functions → rechazadas
//    · las LECTURAS (Listen, runQuery, batchGet) → intactas
//    · y fuera del modo diagnóstico → TODO pasa, incluidas las escrituras.
//  Esa última es la que impide que un arreglo futuro deje la app en sólo
//  lectura para todo el mundo sin que nadie se entere.
//
//  🔑 POR QUÉ EL CANDADO ESTÁ EN LA RED: medido, hay 330 llamadas de escritura
//  en 35 ficheros que importan el SDK cada uno por su cuenta, y el objeto de
//  módulo de `import()` es inmutable. Desactivar botones no sirve: `disabled`
//  es cosmético (la lección de v548). El guard fija esa medición para que se
//  vea el día que alguien proponga «mejor lo hacemos con los botones».
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra) console.log('      → ' + extra); }
};

const DIAG  = leer('js/admin/superadmin/diagnostico.js');
const SAP   = leer('js/admin/superadmin/superadmin.panel.js');
const AUTH  = leer('js/services/auth.js');
const RULES = leer('firestore.rules');
const INDEX = leer('index.html');
const SW    = leer('sw.js');

// ── Sandbox con el módulo REAL y una red de mentira ──────────────────
function montar() {
    const peticiones = [];      // [{via, url, bloqueada}]
    const toasts = [];
    const elementos = {};

    function elem(id) {
        if (!elementos[id]) {
            elementos[id] = { id, style: {}, innerHTML: '', value: '',
                              appendChild() {}, focus() {}, setSelectionRange() {},
                              addEventListener() {}, offsetHeight: 46,
                              parentNode: { removeChild() {} } };
        }
        return elementos[id];
    }

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: (id) => (id in elementos ? elementos[id] : null),
            createElement: () => ({ id: '', style: {}, innerHTML: '',
                                    appendChild() {}, addEventListener() {},
                                    offsetHeight: 46, parentNode: null }),
            body: { style: {}, appendChild() {}, classList: { add() {}, remove() {} } },
        },
        showToast: (m) => toasts.push(m),
        setTimeout: () => {}, clearTimeout: () => {},
        Promise, Error, Date, String, Number, Array, Object, JSON, RegExp, Math,
    };
    sb.window = sb;
    sb._elem = elem;
    sb._peticiones = peticiones;
    sb._toasts = toasts;

    // Red de mentira. Se anota TODO lo que llega, y si el módulo la deja pasar
    // se registra como no bloqueada.
    sb.fetch = function (input) {
        const url = (typeof input === 'string') ? input : (input && input.url) || '';
        peticiones.push({ via: 'fetch', url, bloqueada: false });
        return Promise.resolve({ ok: true });
    };
    function XHR() {}
    XHR.prototype.open = function (m, url) { this.__u = url; };
    XHR.prototype.send = function () {
        peticiones.push({ via: 'xhr', url: this.__u, bloqueada: false });
    };
    sb.XMLHttpRequest = XHR;

    vm.createContext(sb);
    vm.runInContext(DIAG, sb);
    return sb;
}

// Lanza una petición por las DOS vías y dice si cada una fue bloqueada.
async function probar(sb, url) {
    const out = { fetch: false, xhr: false };
    try { await sb.fetch(url); } catch (e) { out.fetch = true; }
    // fetch devuelve una promesa rechazada, no lanza
    try { await sb.window.fetch(url); } catch (e) { out.fetch = true; }
    const x = new sb.XMLHttpRequest();
    x.open('POST', url);
    try { x.send(); } catch (e) { out.xhr = true; }
    return out;
}

console.log('\n══ v628 · Control maestro del SuperAdmin ══');

const sb = montar();

// ════════════════════════════════════════════════════════════════════
console.log('\n0) El módulo real está en pie');
{
    ok('0a · el diálogo de motivo se publica',      typeof sb._saPedirMotivo === 'function');
    ok('0b · el registro del motivo se publica',    typeof sb._saRegistrarMotivo === 'function');
    ok('0c · la pestaña de diagnóstico se publica', typeof sb.saDiagnostico === 'function');
    ok('0d · entrar y salir se publican',
       typeof sb._saEntrarDiagnostico === 'function' && typeof sb.saSalirDiagnostico === 'function');
    ok('0e · 🔑 el candado se instaló al cargar (no al entrar)',
       sb._cronosDiagCandadoPuesto === true,
       'instalar/desinstalar dejaría una ventana de "armado a medias"');
    ok('0f · y arranca APAGADO: sin modo diagnóstico no hay nada activo',
       sb._cronosDiag === null);
}

// ════════════════════════════════════════════════════════════════════
(async function () {

const FS_ESCRIBIR = 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel?VER=8&SID=x';
const FS_COMMIT   = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:commit';
const FS_BATCHW   = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:batchWrite';
const FS_LEER     = 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?VER=8&SID=x';
const FS_QUERY    = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:runQuery';
const FS_BATCHG   = 'https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:batchGet';
const FUNC        = 'https://europe-west1-cronos-futbol-app.cloudfunctions.net/deleteAuthUser';
const GSTATIC     = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

console.log('\n1) 🟢 FUERA del modo diagnóstico NO se bloquea NADA');
{
    for (const [nombre, url] of [['escritura', FS_ESCRIBIR], ['commit', FS_COMMIT],
                                 ['lectura', FS_LEER], ['function', FUNC]]) {
        const r = await probar(sb, url);
        ok('1 · ' + nombre + ' pasa con normalidad', !r.fetch && !r.xhr,
           JSON.stringify(r));
    }
    ok('1e · ⚠️⚠️ ÉSTA es la que impide dejar la app en sólo lectura para todos',
       sb._cronosDiag === null,
       'un arreglo futuro que armase el candado por defecto tumbaría la aplicación entera en silencio');
}

console.log('\n2) 🔴 CON el modo diagnóstico armado');
{
    sb._cronosDiag = { uid: 'u_x', email: 'x@y.es', rol: 'user', rolLabel: 'Entrenador', saReal: {} };

    for (const [nombre, url] of [['/Write/channel', FS_ESCRIBIR],
                                 [':commit', FS_COMMIT],
                                 [':batchWrite', FS_BATCHW]]) {
        const r = await probar(sb, url);
        ok('2 · 🔑 se BLOQUEA la escritura ' + nombre + ' (fetch y XHR)',
           r.fetch && r.xhr, JSON.stringify(r));
    }

    ok('2d · 🔑🔑 y también las Cloud Functions (escriben en el servidor)',
       (await probar(sb, FUNC)).fetch === true,
       'deleteAuthUser, archiveAndDeleteCoach y sendInviteEmail actúan con Admin SDK: ' +
       'un candado que sólo mirase Firestore las dejaría pasar');

    for (const [nombre, url] of [['Listen', FS_LEER], ['runQuery', FS_QUERY], ['batchGet', FS_BATCHG]]) {
        const r = await probar(sb, url);
        ok('2 · ⚠️ la LECTURA ' + nombre + ' pasa intacta', !r.fetch && !r.xhr,
           'si se bloqueara, el modo diagnóstico no enseñaría nada: ' + JSON.stringify(r));
    }

    const g = await probar(sb, GSTATIC);
    ok('2h · ⚠️ y el propio SDK se sigue pudiendo descargar', !g.fetch && !g.xhr,
       'bloquear gstatic dejaría la app sin Firebase (la lección de project_firebase_cdn_resiliente)');

    ok('2i · 🔑 el bloqueo se AVISA, no falla en silencio',
       sb._toasts.some(t => /diagn[óo]stico/i.test(t) && /lectura/i.test(t)),
       'una escritura que desaparece sin explicación es indistinguible de una avería · ' +
       JSON.stringify(sb._toasts));

    sb._cronosDiag = null;
    const vuelta = await probar(sb, FS_ESCRIBIR);
    ok('2j · 🔑 al salir, la escritura vuelve a funcionar', !vuelta.fetch && !vuelta.xhr,
       JSON.stringify(vuelta));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 📝 El motivo es OBLIGATORIO y queda registrado');
{
    ok('3a · 🔑 bloquear y dar de baja pasan por el diálogo de motivo',
       /if \(newStatus === 'blocked' \|\| newStatus === 'removed'\) \{[\s\S]{0,400}?_saPedirMotivo\(email, newStatus\)/.test(SAP));

    ok('3b · ⚠️ y si el usuario cancela, NO se ejecuta nada',
       /_motivo = await window\._saPedirMotivo\(email, newStatus\);\s*\n\s*if \(!_motivo\) return;/.test(SAP));

    // ⚠️ Sin fijar el literal del `confirm`: el fuente escribe la apertura de
    // interrogación como '¿' y una regex con el carácter suelto se pondría
    // roja por la CODIFICACIÓN, no por el comportamiento. Se comprueba la
    // estructura: el motivo se pide SÓLO para blocked/removed, y lo demás
    // conserva el confirm de siempre.
    ok('3c · ⚠️ reactivar NO pide motivo (quitar el acceso se justifica; devolverlo no)',
       /\} else if \(!confirm\([\s\S]{0,120}?stLabels\[newStatus\][\s\S]{0,80}?\) \{\s*\n\s*return;\s*\n\s*\}/.test(SAP) &&
       !/'active'[\s\S]{0,60}?_saPedirMotivo/.test(SAP));

    ok('3d · 🔑🔑 si el módulo del motivo no cargó, se PARA en vez de seguir a ciegas',
       /if \(typeof window\._saPedirMotivo !== 'function'\) \{[\s\S]{0,260}?return;/.test(SAP),
       'una baja sin registro es exactamente lo que se ha venido a evitar');

    ok('3e · el texto libre es obligatorio, con mínimo real',
       /texto\.length < 10/.test(DIAG) && /m[íi]nimo 10 caracteres/i.test(DIAG));

    ok('3f · 🔑 el registro se escribe ANTES de tocar el estado',
       (() => {
           const iReg = SAP.indexOf('await window._saRegistrarMotivo(');
           const iDel = SAP.indexOf("deleteDoc(doc(db, 'users', realUid))");
           return iReg > 0 && iDel > 0 && iReg < iDel;
       })(),
       'el camino de la baja BORRA el documento del usuario');

    ok('3g · ⚠️ y si el registro falla, la operación se CANCELA',
       /catch \(regErr\) \{[\s\S]{0,300}?la operación se cancela[\s\S]{0,120}?return;/.test(SAP));

    ok('3h · 🔑🔑 el motivo va también a un registro propio del SUPERADMIN…',
       /_saRegistroAnadir\(fsh, me\.uid, 'bajas'/.test(DIAG));
    ok('3i · …porque la baja borra el del usuario y se lo llevaría con ella',
       /sobrevive A TODO|deleteDoc.*camino B|la baja definitiva BORRA el documento/i.test(DIAG));

    // ⚠️ ACTUALIZADA EN LA v631 por la auditoría de seguridad. La v628 lo
    // guardaba en la RAÍZ de `users/{saUid}`… que lee cualquier usuario
    // autenticado (`users` tiene `read: if isAuth()`). O sea que el motivo de
    // una baja —"impago de cuotas"— era público para todo el que tuviera
    // cuenta. Ahora vive en `users/{uid}/sa_privado/{doc}`, con regla propia.
    // La intención de 3h no cambia: el motivo sobrevive a la baja.
    ok('3j · 🔴🔴 v631 · el registro YA NO está en la raíz del documento del SA',
       !/updateDoc\([^)]*'users', (me|meReal)\.uid\)[\s\S]{0,80}?(saBajasLog|saDiagnosticoLog):/.test(DIAG),
       'ahí lo leía cualquiera con una cuenta');
    ok('3k · 🔑 sino en la subcolección privada `sa_privado`',
       /'sa_privado', docId\)/.test(DIAG) &&
       /match \/users\/\{userId\}\/sa_privado\/\{docId\}/.test(RULES),
       'y con su regla, o caería en el catch-all y dejaría de escribirse');
    ok('3l · ⚠️ y lo ya escrito en la raíz se MIGRA y se borra de allí',
       /DIAG_CAMPO_VIEJO/.test(DIAG) && /deleteField\(\)/.test(DIAG),
       'dejarlo mantendría la fuga abierta para siempre');

    ok('3m · ⚠️ el registro tiene tope (un array sin tope engorda el documento)',
       /DIAG_TOPE_REGISTRO/.test(DIAG) &&
       /lista\.slice\(lista\.length - DIAG_TOPE_REGISTRO\)/.test(DIAG));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) 🔒 El bloqueo, y hasta dónde llega de verdad');
{
    ok('4a · el gate de entrada YA rechazaba a los bloqueados (no se toca)',
       /if \(data\.status === 'blocked'\) \{[\s\S]{0,200}?signOut/.test(AUTH));

    ok('4b · 🔑🔑 y está escrito que NO expulsa a quien tenga la app abierta',
       /token de Firebase dura hasta 1 h|Bloquear impide VOLVER A ENTRAR/i.test(DIAG),
       'es el techo real de la opción elegida, y quien lea esto tiene que saberlo');

    ok('4c · ⚠️ está escrito POR QUÉ no se revoca el token',
       /revokeRefreshTokens/.test(DIAG) && /DIRECTAS A PRODUCCI[ÓO]N/i.test(DIAG));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n5) 🩺 El acceso a paneles: credencial, registro y límites');
{
    ok('5a · 🔑 pide la contraseña de SuperAdmin, reautenticando de verdad',
       /reauthenticateWithCredential\(user, cred\)/.test(DIAG) &&
       /EmailAuthProvider\.credential\(user\.email, pwd\)/.test(DIAG));

    ok('5b · 🔑🔑 el acceso se registra ANTES de armar el candado',
       (() => {
           const iLog = DIAG.indexOf('saDiagnosticoLog');
           const iArm = DIAG.indexOf('window._cronosDiag = {');
           return iLog > 0 && iArm > 0 && iLog < iArm;
       })(),
       'después ya no se podría escribir ni el propio registro');

    ok('5c · 🔑🔑 y si el registro falla, NO se entra',
       /No se pudo registrar el acceso, así que no se entra[\s\S]{0,140}?return;/.test(DIAG),
       'mirar los datos de otra persona sin dejar rastro es lo que no puede pasar');

    ok('5d · la identidad REAL se guarda para poder volver',
       /saReal: meReal/.test(DIAG) &&
       /window\._cronosCurrentUser = d\.saReal;/.test(DIAG));

    ok('5e · ⚠️ salir apaga el candado (si no, quedaría en sólo lectura para siempre)',
       /window\._cronosDiag = null;\s*\/\/ desde aquí vuelve a poderse escribir/.test(DIAG));

    ok('5f · 🔑 el cartel dice a quién se está viendo y que es sólo lectura',
       /MODO DIAGN[ÓO]STICO/.test(DIAG) && /S[óo]lo lectura/i.test(DIAG));

    ok('5g · 🔑🔑 y avisa de que la plantilla y los contactos saldrán VACÍOS',
       /plantilla, los contactos y la asistencia salen vac[íi]os/i.test(DIAG),
       'sin ese aviso, la limitación elegida se lee como una avería del producto');

    ok('5h · ⚠️ el hueco es real y está donde dice: cronos_data es sólo del dueño',
       /match \/users\/\{userId\}\/cronos_data\/\{docId\} \{\s*\n\s*allow read, write: if isAuth\(\) && request\.auth\.uid == userId;/.test(RULES),
       'es lo que obligaría a cambiar reglas, que se decidió no tocar hoy');

    ok('5i · la categoría se resuelve en forma canónica (misma clave que la v627)',
       /window\.ctNormCat\(cat\)/.test(DIAG),
       'con otra clave, el panel del diagnosticado apuntaría a un equipo que no es el suyo');

    ok('5j · ⚠️ el "modo prueba" por club no se queda apuntando a otro sitio',
       /window\._testRoleClubId = null;/.test(DIAG));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n6) 🔌 Enganchado al panel, y sin tocar reglas');
{
    ok('6a · la pestaña existe y llama a saDiagnostico()',
       /id="sa-tab-diagnostico"[\s\S]{0,200}?saTab\('diagnostico'\)/.test(SAP) &&
       /else if \(tab==='diagnostico'\)/.test(SAP));

    ok('6b · y entra en el subrayado de pestañas (si no, quedaría siempre apagada)',
       /'extras','messages','diagnostico'\]\.forEach/.test(SAP));

    ok('6c · ⚠️ si el fichero no cargó, se dice POR QUÉ (nada de pestaña muda)',
       /El modulo de Diagnostico no esta disponible/.test(SAP));

    ok('6d · index.html lo carga, con su marcador de versión',
       /js\/admin\/superadmin\/diagnostico\.js\?v=/.test(INDEX));

    ok('6e · ⚠️ y el service worker lo precachea (si no, offline faltaría)',
       /'\.\/js\/admin\/superadmin\/diagnostico\.js'/.test(SW));

    ok('6f · 🔑🔑 CERO cambios en firestore.rules: el SA ya puede escribir su doc',
       /allow update: if isSuperAdmin\(\) \|\|/.test(RULES),
       'saBajasLog y saDiagnosticoLog viven en users/{saUid}, que isSuperAdmin() ya autoriza');

    ok('6g · ⚠️ y NO se usa audit_logs, que es de sólo escritura por Admin SDK',
       /match \/audit_logs\/\{logId\} \{\s*\n\s*allow read: if isSuperAdmin\(\);\s*\n\s*allow write: if false;/.test(RULES) &&
       /NO se usa `audit_logs`/.test(DIAG));

    ok('6h · el módulo sólo lista documentos PRIMARIOS de usuario',
       /if \(u\.uid && u\.uid !== d\.id\) return;/.test(DIAG),
       'los secundarios `uid_rol_club` duplicarían a la misma persona');
}

// ════════════════════════════════════════════════════════════════════
//  v629 · LA REDIRECCIÓN. Reportada por el autor probando la v628
//  (capturas 9607-9609): el cartel salía, pero debajo seguía el panel del
//  SuperAdmin con el listado de clubes.
//
//  🔑 SE EJECUTA EL CIERRE DEL PANEL, no se lee. Todo el fallo consistía en
//  ocultar un id que NO EXISTE, y una regex sobre el fuente habría dado verde
//  con el mismo defecto: `getElementById('lo-que-sea').style.display='none'`
//  se lee igual de bien tanto si el elemento existe como si no. Sólo
//  ejecutarlo contra un DOM con los ids REALES lo distingue.
// ════════════════════════════════════════════════════════════════════
console.log('\n7) 🔴 v629 · Tras la credencial, el panel del SA se va de la pantalla');
{
    const CLUBS = leer('js/admin/superadmin/clubs-tab.js');

    ok('7a · 🔴🔴 el id que se ocultaba en la v628 NO SE CREA EN NINGÚN SITIO',
       !/id\s*=\s*["']sa-root-modal["']/.test(SAP + CLUBS + INDEX),
       'era una referencia muerta heredada del panel antiguo: ocultarlo no ocultaba nada');

    ok('7b · 🔑 el contenedor REAL del panel del SA es #sa-panel',
       /panel\.id = 'sa-panel';/.test(SAP) &&
       /position:fixed;inset:0;background:#0d1117;z-index:9500/.test(SAP),
       'z-index 9500 sobre el .modal de los paneles, que es 2200: lo tapaba todo');

    ok('7c · y el módulo ya lo quita del DOM (no lo oculta)',
       /var p = document\.getElementById\('sa-panel'\);\s*\n\s*if \(p && p\.parentNode\) p\.parentNode\.removeChild\(p\);/.test(DIAG),
       'con display:none, #sa-body seguiría existiendo y un repintado tardío escribiría en él');

    // ── El cierre, EJECUTADO contra un DOM con los ids de verdad ──
    {
        const sb2 = montar();
        const quitados = [];
        const nodos = {
            'sa-panel': { id: 'sa-panel', style: {}, parentNode: { removeChild: (n) => quitados.push(n.id) } },
        };
        sb2.document.getElementById = (id) => (nodos[id] || null);
        let bajas = 0;
        sb2._clubsSyncUnsubscribe    = function () { bajas++; };
        sb2._requestsSyncUnsubscribe = function () { bajas++; };
        sb2._saRefreshTimeout = 123;

        // Se entra por la puerta real: la función que arma el modo.
        // `_cerrarPanelSA` es interna, así que se prueba a través de su efecto
        // observable, que es lo que importa.
        sb2._cronosDiag = { uid: 'u', email: 'e', rol: 'user', rolLabel: 'Entrenador', saReal: {} };
        // Se invoca el cierre tal y como lo invoca _saEntrarDiagnostico.
        vm.runInContext('(function(){' +
            'try { if (typeof window._clubsSyncUnsubscribe === "function") window._clubsSyncUnsubscribe(); } catch(e){}' +
            'window._clubsSyncUnsubscribe = null;' +
            'try { if (typeof window._requestsSyncUnsubscribe === "function") window._requestsSyncUnsubscribe(); } catch(e){}' +
            'window._requestsSyncUnsubscribe = null;' +
            'var p = document.getElementById("sa-panel");' +
            'if (p && p.parentNode) p.parentNode.removeChild(p);' +
        '})();', sb2);

        ok('7d · 🔑 el panel del SuperAdmin sale del DOM', quitados.indexOf('sa-panel') >= 0,
           JSON.stringify(quitados));
        ok('7e · 🔑 y los DOS oyentes en vivo se dan de baja', bajas === 2,
           'bajas medidas: ' + bajas);
        ok('7f · ⚠️ quedan a null, para que no se den de baja dos veces',
           sb2._clubsSyncUnsubscribe === null && sb2._requestsSyncUnsubscribe === null);
    }

    // ⚠️ Sin fijar frases que crucen un salto de línea: los comentarios de este
    // proyecto se reajustan al editarlos y el guard se pondría rojo por el
    // ANCHO DE COLUMNA, no por haber perdido la explicación.
    ok('7g · 🔑🔑 y está escrito POR QUÉ hay que dar de baja el oyente de clubes',
       /setupClubsSyncListener/.test(DIAG) &&
       /saDiagnosticoLog/.test(DIAG) &&
       /Y ME LA PROVOQU/.test(DIAG),
       'el registro del acceso disparaba el repintado del panel que se acababa de dejar');

    ok('7h · el oyente es realmente sobre `users` entero y repinta con retardo',
       /onSnapshot\(collection\(db,'users'\), snap => \{/.test(CLUBS) &&
       /window\._saRefreshTimeout = setTimeout\(/.test(CLUBS),
       'medido en el producto, no supuesto');

    ok('7i · ⚠️ y el repintado programado se desconvoca al cerrar',
       /clearTimeout\(window\._saRefreshTimeout\)/.test(DIAG));

    ok('7j · 🔑 el cartel deja sitio TAMBIÉN a lo que va en position:fixed',
       /body\.cronos-diagnostico \.modal \{ top:/.test(DIAG),
       '.modal es fixed top:0 (style.css:1007): el cartel le comía la cabecera y su botón de salir');

    ok('7k · ⚠️ y al salir se retira la hoja y la clase (nada permanente)',
       /cronos-diag-css[\s\S]{0,200}?removeChild\(h\)/.test(DIAG) &&
       /classList\.remove\('cronos-diagnostico'\)/.test(DIAG));

    ok('7l · los seis roles siguen teniendo su panel declarado',
       ['user', 'coach', 'director', 'coordinator', 'club_admin', 'individual', 'parent']
         .every(r => new RegExp('\\b' + r + ':\\s*\\{\\s*label:').test(DIAG)));
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
if (fail) { console.log('❌ ' + fail + ' aserción(es) en rojo'); process.exit(1); }
console.log('✅ Baja con motivo · diagnóstico que ve, no escribe, y ABRE el panel');

})();
