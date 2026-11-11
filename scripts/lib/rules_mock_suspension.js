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
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const RUTA = (uid) => '/databases/(default)/documents/cronos_suspensiones/' + uid;

function conSuspensionMock(testCases) {
    return (testCases || []).map((tc) => {
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
