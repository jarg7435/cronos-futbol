// ─────────────────────────────────────────────────────────────────────────
// test_functions_identidad.js
//
// SEC-C1c · LA IDENTIDAD SE LEE DEL TOKEN, NUNCA DEL DOCUMENTO
// Auditoria de seguridad, 2026-08-26.
//
// ════════════════════════════════════════════════════════════════════
// EL DEFECTO, y estaba repetido en CINCO funciones
//
// Todas decidian si quien llamaba era SuperAdmin —o administrador de un
// club— leyendo `users/{callerUid}.role`. Y ese documento LO ESCRIBE EL
// PROPIO USUARIO: la regla `allow create` de users deja crear el tuyo con los
// campos que quieras salvo isAuthorized/status (y, desde SEC-C1b, salvo el
// `role` 'superadmin'/'admin'). El `clubId` lo elige el usuario del
// desplegable de alta y no se restringe, pero ya no concede nada por si
// solo: todo lo que lo lee exige ademas cuenta habilitada.
//
// Consecuencias medidas ANTES del arreglo:
//   · setCustomClaims        -> declararse 'superadmin' y recibir el claim
//   · approveIndividualAdmin -> aprobar entes ajenos
//   · deleteAuthUser         -> declararse 'club_admin' de un club AJENO y
//                               borrar cuentas de Auth de sus miembros
//   · archiveAndDeleteCoach  -> lo mismo, archivando a sus entrenadores
//   · sendInviteEmail        -> declararse 'director' y mandar correos con la
//                               marca de la plataforma
//   · registerStaffUid       -> registrarse como staff de un club ajeno
//
// 🔑 LOS CUSTOM CLAIMS SOLO LOS ESCRIBE EL ADMIN SDK, asi que
// `context.auth.token.role` no se puede falsificar. Y para lo que sigue
// leyendose del documento —el club de un director, que no viaja en el token—
// se exige ademas CUENTA HABILITADA: un documento recien creado nace con
// `isAuthorized:false` y deja de servir para nada.
//
// ════════════════════════════════════════════════════════════════════
// 🔑 LAS DOS FUNCIONES DE DECISION SE **EJECUTAN**, no se leen.
// `_esSuperAdmin` y `_cuentaHabilitada` se extraen del fuente real y se
// invocan con tokens y documentos de mentira. Una regex sobre el fuente no
// distingue "mira el token" de "cree que mira el token".
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
    if (c) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (x !== undefined) console.log('      → ' + JSON.stringify(x).slice(0, 260)); }
};

const FN  = leer('functions/index.js');
const PKG = JSON.parse(leer('functions/package.json'));

// ── Extrae una funcion del fuente por nombre, balanceando llaves ─────
function extraer(nombre) {
    const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
    const m = re.exec(FN);
    if (!m) throw new Error('no se encontro ' + nombre);
    let i = FN.indexOf('{', m.index), d = 0, fin = -1;
    for (let j = i; j < FN.length; j++) {
        if (FN[j] === '{') d++;
        else if (FN[j] === '}') { d--; if (d === 0) { fin = j + 1; break; } }
    }
    return FN.slice(m.index, fin);
}

// Sandbox con un `admin.firestore()` de mentira: devuelve la lista de correos
// legitimos que se le diga, o lanza si se quiere probar el fallo de lectura.
function sandbox(emails, lanza) {
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        admin: {
            firestore: () => ({
                doc: () => ({
                    get: async () => {
                        if (lanza) throw new Error('sin permisos');
                        return { exists: true, data: () => ({ emails: emails || [] }) };
                    },
                }),
            }),
        },
        Array, String, Object, Promise, Error,
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(extraer('_esSuperAdmin'), sb);
    vm.runInContext(extraer('_cuentaHabilitada'), sb);
    vm.runInContext(extraer('_callerHasClubPermission'), sb);
    return sb;
}

const ctx = (token) => ({ auth: { uid: 'u1', token: token || {} } });

(async () => {
console.log('\n══ SEC-C1c · identidad por TOKEN en las Cloud Functions ══\n');

// ════════════════════════════════════════════════════════════════════
console.log('1) 🔑 _esSuperAdmin — ejecutada');
{
    const sb = sandbox(['jefe@x.es']);
    const f = sb._esSuperAdmin;

    ok('1a · el CLAIM del token concede', await f(ctx({ role: 'superadmin' })) === true);
    ok('1b · el correo en cronos_config/superadmins concede',
       await f(ctx({ email: 'jefe@x.es' })) === true);
    ok('1c · 🔴🔴 un correo que NO esta en la lista NO concede',
       await f(ctx({ email: 'malo@x.es' })) === false);
    ok('1d · sin auth, no', await f({}) === false);
    ok('1e · sin correo ni claim, no', await f(ctx({})) === false);

    // La prueba que de verdad importa: el documento ya no pinta nada.
    ok('1f \u00b7 \ud83d\udd11\ud83d\udd11 NO consulta la coleccion `users` en ningun momento',
       !/collection\('users'\)/.test(extraer('_esSuperAdmin')) &&
       !/doc\('users\//.test(extraer('_esSuperAdmin')) &&
       /cronos_config\/superadmins/.test(extraer('_esSuperAdmin')),
       'ahi estaba la mitad de la escalada: bastaba declararse superadmin en tu propio doc');

    const sbFallo = sandbox([], true);
    ok('1g · ⚠️ si la lista no se puede leer, FALLA HACIA EL "NO"',
       await sbFallo._esSuperAdmin(ctx({ email: 'jefe@x.es' })) === false,
       'un error de lectura no puede conceder privilegios');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔒 _cuentaHabilitada — ejecutada');
{
    const sb = sandbox([]);
    const h = sb._cuentaHabilitada;
    ok('2a · cuenta activa y autorizada → si', h({ isAuthorized: true, status: 'active' }) === true);
    ok('2b · 🔴 recien creada (isAuthorized:false) → NO',
       h({ isAuthorized: false, status: 'pending' }) === false,
       'es EXACTAMENTE lo que crea el atacante');
    ok('2c · sin el campo → no', h({ status: 'active' }) === false);
    ok('2d · bloqueada → no', h({ isAuthorized: true, status: 'blocked' }) === false);
    ok('2e · dada de baja → no', h({ isAuthorized: true, status: 'removed' }) === false);
    ok('2f · rechazada → no', h({ isAuthorized: true, status: 'rejected' }) === false);
    ok('2g · nada → no', h(null) === false);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 🏟️ _callerHasClubPermission — ejecutada');
{
    const sb = sandbox([]);
    const p = sb._callerHasClubPermission;
    const doc = (d) => ({ exists: true, data: () => d });

    ok('3a · el SuperAdmin (resuelto por token) pasa siempre',
       p(doc({}), 'club_x', true) === true);

    ok('3b · 🔴🔴 EL ATAQUE: doc recien creado que se declara club_admin de un club AJENO',
       p(doc({ role: 'club_admin', clubId: 'club_victima', isAuthorized: false, status: 'pending' }),
         'club_victima', false) === false,
       'antes devolvia true y con eso se borraban cuentas de Auth de ese club');

    ok('3c · ✅ un club_admin DE VERDAD de ese club, si',
       p(doc({ role: 'club_admin', clubId: 'club_mio', isAuthorized: true, status: 'active' }),
         'club_mio', false) === true);

    ok('3d · ⚠️ pero no sobre OTRO club',
       p(doc({ role: 'club_admin', clubId: 'club_mio', isAuthorized: true, status: 'active' }),
         'club_ajeno', false) === false);

    ok('3e · ✅ una PLAZA viva de director tambien vale',
       p(doc({ isAuthorized: true, status: 'active',
               allRoles: [{ role: 'director', clubId: 'club_mio', isAuthorized: true }] }),
         'club_mio', false) === true);

    ok('3f · ⚠️ una plaza revocada NO',
       p(doc({ isAuthorized: true, status: 'active',
               allRoles: [{ role: 'director', clubId: 'club_mio', isAuthorized: true, status: 'removed' }] }),
         'club_mio', false) === false);

    ok('3g · ⚠️ sin club de destino, se deniega',
       p(doc({ role: 'club_admin', clubId: 'c', isAuthorized: true, status: 'active' }), null, false) === false);

    ok('3h · 🔑 y ya NO decide sobre el rol de superadmin por su cuenta',
       !/callerRole === 'superadmin'/.test(extraer('_callerHasClubPermission')));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) 🔌 Las cinco funciones usan la puerta nueva');
{
    const usos = (FN.match(/await _esSuperAdmin\(context\)/g) || []).length;
    ok('4a · _esSuperAdmin se usa en varias funciones', usos >= 4, 'usos: ' + usos);

    ok('4b · 🔴 setCustomClaims ya NO lee el rol del documento',
       !/const callerRole = callerData\?\.role \|\| context\.auth\.token\.role;/.test(FN) &&
       /if \(!\(await _esSuperAdmin\(context\)\)\) \{[\s\S]{0,200}?Solo SuperAdmin puede asignar roles/.test(FN));

    ok('4c · 🔴 approveIndividualAdmin tampoco',
       !/callerDoc\.data\(\)\.role !== 'superadmin'/.test(FN));

    ok('4d · 🔴 archiveAndDeleteCoach exige cuenta habilitada',
       /!_cuentaHabilitada\(_cd\)/.test(FN));

    ok('4e · 🔴 registerStaffUid tambien',
       /if \(!_cuentaHabilitada\(userData\)\) \{/.test(FN));

    ok('4f · 🔴 sendInviteEmail: SA por token y el resto con cuenta habilitada',
       /const _esSA = await _esSuperAdmin\(context\);/.test(FN) &&
       /const _habilitado = _cuentaHabilitada\(_cd\);/.test(FN) &&
       /_esStaffRaiz = _habilitado &&/.test(FN));

    ok('4g · ⚠️ no queda NINGUNA comparacion de rol contra el documento',
       !/callerDoc\.data\(\)\.role === 'superadmin'/.test(FN) &&
       !/callerData\?\.role/.test(FN));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n5) ✉️ Cabeceras de correo saneadas (SEC-DEP1)');
{
    ok('5a · `to` y `subject` se limpian de saltos de linea',
       /const _sinSaltos = /.test(FN) &&
       /\.replace\(\/\[\\r\\n\\u2028\\u2029\]\+\/g, ' '\)/.test(FN),
       'CR, LF y los separadores Unicode: los tres parten una cabecera en dos');

    ok('5b · y se acotan en longitud',
       /_sinSaltos\(data && data\.to, 254\)/.test(FN) &&
       /_sinSaltos\(data && data\.subject, 200\)/.test(FN));

    ok('5c · 🔑 el destinatario tiene que ser UN correo, no una lista',
       /Destinatario no valido/.test(FN));

    // Ejecutado: el saneador de verdad.
    const sb = { String, RegExp };
    vm.createContext(sb);
    vm.runInContext("var _sinSaltos = (t, max) => String(t == null ? '' : t)" +
        ".replace(/[\\r\\n\\u2028\\u2029]+/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, max || 200);", sb);
    const s = sb._sinSaltos;
    ok('5d · 🔴 un asunto con CRLF queda en UNA sola linea',
       s('Hola\r\nBcc: victima@x.es', 200) === 'Hola Bcc: victima@x.es',
       JSON.stringify(s('Hola\r\nBcc: victima@x.es', 200)));
    ok('5e \u00b7 y con los separadores de linea Unicode tambien',
       s('a\u2028b\u2029c', 200) === 'a b c',
       JSON.stringify(s('a\u2028b\u2029c', 200)));
    ok('5f · ⚠️ y se recorta a la longitud pedida', s('x'.repeat(500), 200).length === 200);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n6) 📦 Dependencias del servidor');
{
    const d = PKG.dependencies || {};
    const mayor = (v) => parseInt(String(v).replace(/[^0-9.]/g, '').split('.')[0], 10) || 0;

    ok('6a · nodemailer >= 9 (cierra el aviso de inyeccion CRLF)', mayor(d.nodemailer) >= 9, d.nodemailer);
    ok('6b · firebase-admin >= 13', mayor(d['firebase-admin']) >= 13, d['firebase-admin']);
    ok('6c · firebase-functions >= 6', mayor(d['firebase-functions']) >= 6, d['firebase-functions']);
    ok('6d · 🔑 y el fuente importa la API v1 EXPLICITAMENTE',
       /require\('firebase-functions\/v1'\)/.test(FN),
       'desde firebase-functions v6 la raiz exporta v2: sin el /v1 las 17 ' +
       'declaraciones de este fichero dejarian de existir');
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
if (fail) { console.log('❌ ' + fail + ' asercion(es) en rojo'); process.exit(1); }
console.log('✅ La identidad sale del token · el documento ya no autoriza nada');
})().catch(e => { console.error('\n❌', e.message); process.exit(1); });
