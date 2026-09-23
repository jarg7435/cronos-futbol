// ─────────────────────────────────────────────────────────────────────────
//  test_purga_usuario.js  ·  🛡️ Fase 4 · punto 1 (2026-09-22)
//
//  `deleteUserData` borraba DOS cosas mientras `privacy.html` §6 prometía que
//  «tras la baja los datos se eliminan en un plazo máximo de 30 días».
//
//  🔑 ESTE GUARD EJECUTA LA PURGA DE VERDAD contra una base de datos FALSA.
//  No mide texto: siembra documentos, corre `ejecutarPurga` y comprueba qué
//  quedó. En algo que BORRA datos de familias en producción, una regex que
//  dice «el fichero menciona cronos_player_reports» no vale de nada.
//
//  ⚠️⚠️ LAS DOS MITADES PESAN IGUAL, y la segunda más:
//    1. que se borre lo que es suyo — si no, la política sigue mintiendo;
//    2. 🔴 **que NO se borre lo que es de otros**. Un informe colectivo habla
//       de un MENOR que no se está dando de baja; un hilo con la familia es
//       también de la familia. Una cascada demasiado ancha destruye datos de
//       terceros y eso no se deshace.
//
//  Por eso casi la mitad de las aserciones comprueban SUPERVIVENCIA.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { ejecutarPurga, PLAN, LISTAS, SUBCOLECCIONES, CONSERVAR,
        BORRADO_UID, BORRADO_NOMBRE, _quitarDe } = require(path.join(ROOT, 'functions', 'purga_usuario.js'));

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + JSON.stringify(extra).slice(0, 400)); }
};

// ── Una Firestore de juguete, con lo justo que usa la purga ────────────
function baseFalsa(semilla) {
    const datos = JSON.parse(JSON.stringify(semilla));   // colección → { id: doc }
    const sub = {};                                       // 'users/UID/col' → { id: doc }
    const borrados = [];

    const refDe = (col, id) => ({ __col: col, __id: id });
    const subRefDe = (clave, id) => ({ __sub: clave, __id: id });

    const docsDe = (col, filtro) => Object.entries(datos[col] || {})
        .filter(([, d]) => filtro(d))
        .map(([id, d]) => ({ id: id, ref: refDe(col, id), data: () => JSON.parse(JSON.stringify(d)) }));

    const consulta = (col) => ({
        where(campo, op, valor) {
            const f = op === 'array-contains'
                ? (d) => Array.isArray(d[campo]) && d[campo].indexOf(valor) !== -1
                : op === 'array-contains-any'
                ? (d) => Array.isArray(d[campo]) && valor.some((v) => d[campo].indexOf(v) !== -1)
                : (d) => d[campo] === valor;
            const docs = docsDe(col, f);
            return { limit: () => ({ get: async () => ({ docs: docs }) }) };
        },
        doc(id) {
            return {
                collection(nombre) {
                    const clave = col + '/' + id + '/' + nombre;
                    const docs = Object.entries(sub[clave] || {})
                        .map(([sid, d]) => ({ id: sid, ref: subRefDe(clave, sid), data: () => d }));
                    return { limit: () => ({ get: async () => ({ docs: docs }) }) };
                },
                __col: col, __id: id,
            };
        },
        limit: () => ({ get: async () => ({ docs: docsDe(col, () => true) }) }),
    });

    const db = {
        collection: consulta,
        batch() {
            const ops = [];
            return {
                delete: (ref) => ops.push({ t: 'd', ref }),
                update: (ref, d) => ops.push({ t: 'u', ref, d }),
                commit: async () => {
                    for (const o of ops) {
                        if (o.t === 'd') {
                            if (o.ref.__sub) { delete (sub[o.ref.__sub] || {})[o.ref.__id]; borrados.push(o.ref.__sub + '/' + o.ref.__id); }
                            else { delete (datos[o.ref.__col] || {})[o.ref.__id]; borrados.push(o.ref.__col + '/' + o.ref.__id); }
                        } else {
                            const d = (datos[o.ref.__col] || {})[o.ref.__id];
                            if (d) Object.assign(d, o.d);
                        }
                    }
                },
            };
        },
    };
    db.__datos = datos; db.__sub = sub; db.__borrados = borrados;
    return db;
}

const YO = 'uid_que_se_va';
const OTRO = 'uid_de_otro';

const semilla = () => ({
    users: { [YO]: { email: 'yo@x.es' }, [OTRO]: { email: 'otro@x.es' } },
    push_tokens: { t1: { uid: YO, token: 'aaa' }, t2: { uid: OTRO, token: 'bbb' } },
    cronos_role_sessions: { s1: { uid: YO }, s2: { uid: OTRO } },
    platform_requests: { r1: { uid: YO }, r2: { userUid: YO }, r3: { uid: OTRO } },
    slot_requests: { sr1: { userId: YO }, sr2: { userId: OTRO } },
    cronos_player_reports: {
        // su copia como FAMILIAR → se borra
        rep_fam:   { parentUid: YO, texto: 'informe de mi hijo' },
        // informe que él ESCRIBIÓ sobre un menor → se conserva, sin autoría
        rep_coach: { coachUid: YO, coachName: 'Yo', coachEmail: 'yo@x.es',
                     jugador: 'MENOR', texto: 'buen partido',
                     staffUids: [YO, OTRO], dismissedBy: [YO + '_director', OTRO] },
        // informe ajeno → intacto
        rep_ajeno: { coachUid: OTRO, jugador: 'OTRO MENOR', texto: 'intacto' },
    },
    cronos_staff_messages: { m1: { senderUid: YO, senderName: 'Yo', texto: 'hola' },
                             m2: { senderUid: OTRO, texto: 'ajeno' } },
    cronos_staff_threads:  { h1: { coachUid: YO, coachName: 'Yo' } },
    cronos_player_links:   { l1: { parentUid: YO, parentName: 'Yo', playerId: 'MENOR' } },
    succession_requests:   { su1: { outgoingAdminUid: YO, outgoingAdminEmail: 'yo@x.es' } },
    deletion_requests:     { d1: { userId: YO, userEmail: 'yo@x.es' } },
    cronos_messages:       { hilo1: { participants: [YO, OTRO], senderUid: YO, texto: 'conversación' } },
    audit_logs:            { a1: { actorUid: YO, accion: 'borró algo' } },
    billing_invoices:      { f1: { uid: YO, importe: 100 } },
});

console.log('\n══ 🛡️ Fase 4·1 · la purga borra lo suyo y respeta lo de otros ══');

(async () => {
    // ════════════════════════════════════════════════════════════════
    console.log('\n1) 🗑️ EJECUTADO: se borra lo que es SUYO');
    const db = baseFalsa(semilla());
    db.__sub['users/' + YO + '/cronos_data'] = { c1: { x: 1 } };
    db.__sub['users/' + YO + '/sa_privado']  = { p1: { motivo: 'impago' } };

    const r = await ejecutarPurga(db, YO);
    const D = db.__datos;

    ok('1a · su documento de usuario', !D.users[YO]);
    ok('1b · 🚨 y sus SUBCOLECCIONES (Firestore NO las borra con el padre)',
       !Object.keys(db.__sub['users/' + YO + '/cronos_data']).length &&
       !Object.keys(db.__sub['users/' + YO + '/sa_privado']).length,
       'sa_privado guarda el MOTIVO de una baja: dato personal de un tercero');
    ok('1c · sus tokens de notificación', !D.push_tokens.t1);
    ok('1d · sus sesiones', !D.cronos_role_sessions.s1);
    ok('1e · sus solicitudes (por `uid` y por `userUid`)',
       !D.platform_requests.r1 && !D.platform_requests.r2);
    ok('1f · sus peticiones de plaza', !D.slot_requests.sr1);
    ok('1g · 🔑 su copia FAMILIAR del informe (ésa sí es suya)', !D.cronos_player_reports.rep_fam);

    // ════════════════════════════════════════════════════════════════
    console.log('\n2) 🔴 LO QUE NO PUEDE DESAPARECER: datos de terceros');
    ok('2a · 🔑🔑 el informe que ESCRIBIÓ sobre un menor SIGUE EXISTIENDO',
       !!D.cronos_player_reports.rep_coach,
       'habla de un menor que no se está dando de baja: es del club');
    ok('2b · …y conserva su contenido',
       D.cronos_player_reports.rep_coach.texto === 'buen partido' &&
       D.cronos_player_reports.rep_coach.jugador === 'MENOR');
    ok('2c · 🔑 pero ya no lleva su nombre ni su correo',
       D.cronos_player_reports.rep_coach.coachUid === BORRADO_UID &&
       D.cronos_player_reports.rep_coach.coachName === BORRADO_NOMBRE &&
       D.cronos_player_reports.rep_coach.coachEmail === null,
       D.cronos_player_reports.rep_coach);

    ok('2d · 🔴 los documentos de OTRA persona ni se tocan',
       !!D.push_tokens.t2 && !!D.cronos_role_sessions.s2 &&
       !!D.platform_requests.r3 && !!D.slot_requests.sr2 &&
       D.cronos_player_reports.rep_ajeno.texto === 'intacto' &&
       D.cronos_staff_messages.m2.senderUid === OTRO,
       'una cascada demasiado ancha destruye datos que no se pueden recuperar');

    ok('2e · 🔑 el hilo compartido SOBREVIVE y la otra parte lo sigue encontrando',
       !!D.cronos_messages.hilo1 &&
       D.cronos_messages.hilo1.participants.indexOf(OTRO) !== -1,
       'quitar `participants` dejaría el hilo huérfano para quien sí tiene derecho');
    ok('2f · …con el autor seudonimizado',
       D.cronos_messages.hilo1.senderUid === BORRADO_UID);

    ok('2g · 📌 `audit_logs` se CONSERVA (trazabilidad de seguridad)', !!D.audit_logs.a1);
    ok('2h · 📌 `billing_invoices` se CONSERVA (obligación mercantil)', !!D.billing_invoices.f1);

    // ════════════════════════════════════════════════════════════════
    console.log('\n3) 🧹 Su uid desaparece de las listas');
    ok('3a · sale de `staffUids`',
       D.cronos_player_reports.rep_coach.staffUids.indexOf(YO) === -1 &&
       D.cronos_player_reports.rep_coach.staffUids.indexOf(OTRO) !== -1);
    ok('3b · 🔑 y también su clave POR PLAZA (`uid_rol`) de `dismissedBy`',
       D.cronos_player_reports.rep_coach.dismissedBy.join('|').indexOf(YO) === -1 &&
       D.cronos_player_reports.rep_coach.dismissedBy.indexOf(OTRO) !== -1,
       'desde v2 la unidad es la PLAZA: buscar el uid pelado dejaría basura con el uid dentro');

    ok('3c · `_quitarDe` no toca una lista donde no está',
       _quitarDe(['a', 'b'], YO) === null);
    ok('3d · …y quita las dos formas',
       JSON.stringify(_quitarDe([YO, YO + '_director', 'a'], YO)) === '["a"]');

    // ════════════════════════════════════════════════════════════════
    console.log('\n4) 🎭 Seudonimizado, no borrado, donde toca');
    ok('4a · el vínculo jugador-familia se queda (es del jugador)',
       !!D.cronos_player_links.l1 && D.cronos_player_links.l1.playerId === 'MENOR' &&
       D.cronos_player_links.l1.parentUid === BORRADO_UID);
    ok('4b · el mensaje de staff conserva el texto, no el autor',
       D.cronos_staff_messages.m1.texto === 'hola' &&
       D.cronos_staff_messages.m1.senderUid === BORRADO_UID);
    ok('4c · 🔑 la solicitud de baja se CONSERVA sin el dato personal',
       !!D.deletion_requests.d1 && D.deletion_requests.d1.userEmail === null,
       'es la prueba de que la baja se atendió');
    ok('4d · la sucesión pierde el correo saliente',
       D.succession_requests.su1.outgoingAdminEmail === null);

    // ════════════════════════════════════════════════════════════════
    console.log('\n5) 👀 Se puede SIMULAR antes de apretar');
    const db2 = baseFalsa(semilla());
    // ⚠️ SE SIEMBRA IGUAL QUE EL REAL, subcolecciones incluidas. Sin esto, 5c
    //    comparaba dos escenarios distintos (7 borrados contra 9) y acusaba al
    //    código de una diferencia que era del propio test.
    db2.__sub['users/' + YO + '/cronos_data'] = { c1: { x: 1 } };
    db2.__sub['users/' + YO + '/sa_privado']  = { p1: { motivo: 'impago' } };
    const sim = await ejecutarPurga(db2, YO, { simular: true });
    ok('5a · 🔑 en modo simular NO se escribe nada',
       !!db2.__datos.users[YO] && !!db2.__datos.push_tokens.t1 &&
       db2.__borrados.length === 0);
    ok('5b · …pero devuelve el plan completo', Array.isArray(sim.plan) && sim.plan.length > 5, sim.plan && sim.plan.length);
    ok('5c · y el recuento coincide con lo que haría',
       sim.borrados === r.borrados && sim.seudonimizados === r.seudonimizados,
       { sim: sim.borrados + '/' + sim.seudonimizados, real: r.borrados + '/' + r.seudonimizados });

    // ════════════════════════════════════════════════════════════════
    console.log('\n6) 📋 Cobertura y rastro');
    const cubiertas = new Set([].concat(PLAN.map((p) => p.col), LISTAS.map((l) => l.col),
                                        CONSERVAR.map((c) => c.col), ['users']));
    // Las colecciones con datos personales inventariadas en PROTECCION_DATOS.md
    // que se enlazan a una CUENTA. Si mañana aparece otra, esto se pone rojo.
    for (const c of ['push_tokens', 'cronos_role_sessions', 'platform_requests', 'slot_requests',
                     'cronos_player_reports', 'cronos_staff_messages', 'cronos_staff_threads',
                     'cronos_player_links', 'succession_requests', 'deletion_requests',
                     'cronos_messages', 'audit_logs', 'billing_invoices']) {
        ok('6a · `' + c + '` tiene trato declarado', cubiertas.has(c));
    }
    ok('6b · 🔑 las subcolecciones de users están declaradas',
       SUBCOLECCIONES.indexOf('cronos_data') !== -1 && SUBCOLECCIONES.indexOf('sa_privado') !== -1);
    ok('6c · no hubo fallos ni se alcanzó el tope', r.fallos.length === 0 && r.topeAlcanzado.length === 0,
       { fallos: r.fallos, tope: r.topeAlcanzado });
    ok('6d · el resumen desglosa por colección', Object.keys(r.porColeccion).length >= 8, Object.keys(r.porColeccion));

    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR FATAL:', e); process.exit(1); });
