// ─────────────────────────────────────────────────────────────────────────
// scripts/lib/rules_mock_suspension.js · v853
//
// Desde v853, `isAuth()` de firestore.rules consulta
// `cronos_suspensiones/{request.auth.uid}` (bloqueo temporal de usuario). En
// la Rules REST API (`:test`) todo get()/exists() SIN mock LANZA, así que los
// tests de reglas que ya existían necesitan decir «esta cuenta NO está
// suspendida». Este ayudante lo añade a cada caso, con el uid del propio caso,
// SIN pisar un mock que el test ya traiga para ese documento (así un test
// puede probar justo la cuenta suspendida).
//
// Uso:  testSuite: { testCases: conSuspensionMock(testCases) }
//
// 🔐 v864 · FASE 2 DEL MFA: `isSuperAdmin()` exige además una sesión abierta
// con segundo factor (`firebase.sign_in_second_factor == 'totp'`). El SA real
// siempre la tiene (no puede entrar sin el código), así que este ayudante
// añade el factor a TODOS los tokens de prueba que no lo traigan. A las
// cuentas que no son SA no les cambia nada: las reglas sólo lo miran en
// `isSuperAdmin()`. Para probar «sin factor», el caso lleva
// `sinSegundoFactor: true` (se quita antes de enviarlo: la API no lo admite).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const RUTA = (uid) => '/databases/(default)/documents/cronos_suspensiones/' + uid;

function conFactor(tc) {
    const sin = !!(tc && tc.sinSegundoFactor);
    const limpio = Object.assign({}, tc);
    delete limpio.sinSegundoFactor;
    const a = limpio.request && limpio.request.auth;
    if (sin || !a) return limpio;
    const token = Object.assign({}, a.token || {});
    const firebase = Object.assign({}, token.firebase || {});
    if (!('sign_in_second_factor' in firebase)) firebase.sign_in_second_factor = 'totp';
    token.firebase = firebase;
    limpio.request = Object.assign({}, limpio.request, { auth: Object.assign({}, a, { token }) });
    return limpio;
}

function conSuspensionMock(testCases) {
    return (testCases || []).map(conFactor).map((tc) => {
        const uid = tc && tc.request && tc.request.auth && tc.request.auth.uid;
        if (!uid) return tc;
        const mocks = Array.isArray(tc.functionMocks) ? tc.functionMocks.slice() : [];
        const ruta = RUTA(uid);
        const yaEsta = (fn) => mocks.some((m) => m && m.function === fn &&
            Array.isArray(m.args) && m.args[0] && m.args[0].exactValue === ruta);
        if (!yaEsta('exists')) {
            mocks.push({ function: 'exists', args: [{ exactValue: ruta }], result: { value: false } });
        }
        return Object.assign({}, tc, { functionMocks: mocks });
    });
}

module.exports = conSuspensionMock;
module.exports.conSuspensionMock = conSuspensionMock;
module.exports.rutaSuspension = RUTA;
module.exports.conFactor = conFactor;
