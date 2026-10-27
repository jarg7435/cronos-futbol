// ═══════════════════════════════════════════════════════════════════════════
//  GUARD v844 · «Reenviar al SA» con el perfil del solicitante NO legible
// ═══════════════════════════════════════════════════════════════════════════
//  Reportado por el autor (CD Doramas, captura 5173): el Administrador del
//  Club pulsa «Reenviar al SA» sobre un Coordinador y salta
//  "Error al reenviar: Missing or insufficient permissions".
//
//  🔑 caForwardToSA leía `users/{uid}` FUERA de todo try/catch. Las reglas
//  lo deniegan —con razón— cuando la raíz del perfil pertenece a OTRA
//  entidad (alguien que ya tenía cuenta y pide aquí un rol nuevo). Ese
//  error abortaba el reenvío entero.
//
//  Este guard EJECUTA la función con un Firestore simulado que deniega esa
//  lectura y comprueba que la solicitud `fwd_…` se crea igual, con los datos
//  de la solicitud original, y que la original se retira.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const PANEL_PATH = process.argv[2] || path.join(__dirname, '..', 'js', 'admin', 'club', 'panel.js');
const PANEL = fs.readFileSync(PANEL_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(nombre, cond, detalle) {
    if (cond) { pass++; console.log('  ✓ ' + nombre); }
    else { fail++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + detalle : '')); }
}

const ini = PANEL.indexOf('window.caForwardToSA = async');
const fin = PANEL.indexOf('// ── Cambiar estado de un usuario', ini);
ok('0 · se localiza caForwardToSA', ini > 0 && fin > ini);
const CODIGO = PANEL.slice(ini, fin);

function denegado() { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; }

async function ejecuta({ perfilLegible }) {
    const CID = 'club_doramas', UID = 'uid_rober';
    const escritos = {}, borrados = [], toasts = [];
    const origen = {
        id: 'self_reg_' + UID + '_coordinator_' + CID,
        data: { type: 'self_registration', clubId: CID, requestedEmail: 'Robermarrero77@gmail.com',
                requestedName: 'Rober Marrero', requestedRole: 'coordinator',
                requestedCoordinatorType: 'f11', userUid: UID, status: 'pending_club_admin' }
    };
    const perfil = { email: 'robermarrero77@gmail.com', clubId: 'otro_club', role: 'user',
                     isAuthorized: true, status: 'active', allRoles: [] };
    const fsMock = {
        db: {},
        doc: (_db, col, id) => ({ col, id }),
        collection: (_db, col) => ({ col }),
        where: (f, op, v) => ({ f, op, v }),
        query: (c, ...w) => ({ col: c.col, w }),
        getDoc: async (ref) => {
            if (ref.col === 'users') {
                if (!perfilLegible) throw denegado();
                return { exists: () => true, data: () => JSON.parse(JSON.stringify(perfil)) };
            }
            if (ref.col === 'clubs') return { exists: () => true, data: () => ({ name: 'CD DORAMAS' }) };
            return { exists: () => false, data: () => ({}) };
        },
        getDocs: async (q) => {
            const okFiltro = q.w.some(x => x.f === 'clubId' && x.v === CID) && q.w.some(x => x.f === 'userUid' && x.v === UID);
            const lista = okFiltro ? [origen] : [];
            return { forEach: fn => lista.forEach(o => fn({ id: o.id, data: () => o.data })) };
        },
        updateDoc: async (ref) => { if (ref.col === 'users' && !perfilLegible) throw denegado(); },
        setDoc: async (ref, data) => { escritos[ref.col + '/' + ref.id] = data; },
        deleteDoc: async (ref) => { borrados.push(ref.col + '/' + ref.id); },
    };
    const window = { _cronosCurrentUser: { email: 'admin@doramas.es' } };
    const ctx = {
        window, console: { log() {}, warn() {}, error() {} },
        confirm: () => true,
        saFS: async () => fsMock,
        showToast: (m) => toasts.push(m),
        navReload: () => {},
        openClubAdminPanel: () => {},
    };
    vm.createContext(ctx);
    vm.runInContext(CODIGO, ctx);
    await window.caForwardToSA(UID, 'coordinator', 'Robermarrero77@gmail.com', CID, '', '');
    return { escritos, borrados, toasts, origenId: origen.id };
}

(async () => {
    // A · perfil NO legible (el caso de la captura)
    {
        const r = await ejecuta({ perfilLegible: false });
        const fwdKey = Object.keys(r.escritos).find(k => k.startsWith('platform_requests/fwd_'));
        ok('A1 · no sale «Error al reenviar»', !r.toasts.some(t => /Error al reenviar/.test(t)), r.toasts.join(' | '));
        ok('A2 · se crea la solicitud fwd_ para el SuperAdmin', !!fwdKey, Object.keys(r.escritos).join(', '));
        const fwd = fwdKey ? r.escritos[fwdKey] : {};
        ok('A3 · va como pending_sa, coordinador y del club', fwd.status === 'pending_sa' &&
           fwd.requestedRole === 'coordinator' && fwd.clubId === 'club_doramas' && fwd.userUid === 'uid_rober');
        ok('A4 · nombre y tipo de coordinador salen de la solicitud original',
           fwd.requestedName === 'Rober Marrero' && fwd.requestedCoordinatorType === 'f11',
           JSON.stringify({ n: fwd.requestedName, t: fwd.requestedCoordinatorType }));
        ok('A5 · la solicitud original se retira', r.borrados.includes('platform_requests/' + r.origenId), r.borrados.join(', '));
        ok('A6 · el perfil ajeno NO se escribe', !Object.keys(r.escritos).some(k => k.startsWith('users/')));
    }
    // B · perfil legible (lo de siempre) sigue funcionando
    {
        const r = await ejecuta({ perfilLegible: true });
        ok('B1 · con el perfil legible también reenvía', Object.keys(r.escritos).some(k => k.startsWith('platform_requests/fwd_')) &&
           !r.toasts.some(t => /Error al reenviar/.test(t)), r.toasts.join(' | '));
    }
    // C · la regla NO se ha abierto: users sigue leyéndose por la raíz
    {
        const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
        const m = RULES.match(/match \/users\/\{userId\} \{[\s\S]*?allow read: if ([\s\S]*?\);)/);
        ok('C1 · la lectura de users no concede por platform_requests', !!m && !/platform_requests/.test(m[1]));
    }
    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
