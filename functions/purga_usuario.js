/* ══════════════════════════════════════════════════════════════════════════
   functions/purga_usuario.js  ·  🛡️ Fase 4 · punto 1 (2026-09-22)
   BORRADO EN CASCADA Y SEUDONIMIZACION AL DARSE DE BAJA UNA CUENTA

   ═════════════════════════════════════════════════════════════════════
   🔴 POR QUE EXISTE: LA POLITICA PROMETIA LO QUE EL CODIGO NO HACIA

   `privacy.html` §6 dice que tras la baja «los datos se eliminan en un plazo
   maximo de 30 dias». El `deleteUserData` original borraba DOS cosas:
   `users/{uid}` y sus `platform_requests`. Se quedaban vivos los informes,
   los mensajes, la asistencia, los vinculos jugador-familia, los tokens de
   notificacion, las sesiones y las dos subcolecciones del propio usuario.

   🚨 Y UNA MAS, QUE NO SE VE: borrar `users/{uid}` **NO borra sus
   subcolecciones**. Firestore las deja huerfanas, invisibles desde la consola
   pero vivas. `users/{uid}/cronos_data` y `users/{uid}/sa_privado` —esta
   ultima con el MOTIVO de una baja, dato personal de un tercero— llevaban ahi
   desde siempre.

   ═════════════════════════════════════════════════════════════════════
   🔑 LA REGLA DE ORO: BORRAR LO SUYO, SEUDONIMIZAR LO COMPARTIDO

   No todo lo que lleva su uid es «suyo». Un mensaje en un hilo con la familia
   de un jugador tambien es de la familia; un informe colectivo es del club y
   habla de un MENOR que no se esta dando de baja. Borrarlos destruiria datos
   de terceros que tienen derecho a conservarlos.

   Por eso hay tres tratos, y cada documento tiene el suyo declarado:

     🗑️  BORRAR       — es suyo y de nadie mas.
     🎭  SEUDONIMIZAR — el contenido es compartido: se le quita el nombre y el
                        vinculo, y queda «Usuario eliminado».
     📌  CONSERVAR    — obligacion legal o trazabilidad de seguridad
                        (`audit_logs`, `billing_*`). ⚠️ ESTO HAY QUE DECIRLO
                        EN LA POLITICA, que hoy no lo dice.

   ⚠️ EL CASO DEL INFORME, que es el que mejor enseña la diferencia:
     · si el que se va es el FAMILIAR, su copia (`parentUid`) es suya → SE BORRA
     · si el que se va es el ENTRENADOR que lo escribio, el informe habla de un
       jugador del club → SE SEUDONIMIZA el autor, el informe se queda.

   ═════════════════════════════════════════════════════════════════════
   ⚠️ DECISIONES QUE CONVIENE CONOCER ANTES DE TOCAR ESTO

   1. NO SE BORRA EL TEXTO que la persona escribio en un hilo compartido. Se
      le quita la autoria, no la conversacion. Es un equilibrio: borrar el
      texto dejaria a la otra parte con media conversacion sin sentido. Si
      algun dia se decide lo contrario, el sitio es `_seudonimizarMensajes`.
   2. NO SE TOCA `pseudonym_map`: mapea JUGADORES, no cuentas. Una cuenta de
      entrenador que se va no tiene nada ahi.
   3. NO SE TOCA la asistencia (las subcolecciones `attendance` y
      `attendance_players` que cuelgan de cada club): esta indexada por
      JUGADOR y por mes, no por uid de cuenta. Si el que se borra es un
      jugador con cuenta, su rastro deportivo lo gestiona el club — es dato
      del club, no de la cuenta. Queda anotado como limite conocido.
   4. SE MANTIENE `participants` en los hilos: es la clave por la que la OTRA
      parte encuentra su conversacion. Quitar el uid dejaria el hilo huerfano
      e ilegible para quien si tiene derecho.

   ═════════════════════════════════════════════════════════════════════
   ⚠️ SE PUEDE SIMULAR. `ejecutarPurga(db, uid, { simular: true })` recorre
   todo y devuelve el plan SIN escribir. Se usa en el guard y sirve para
   mirar antes de apretar en un caso real.

   ⚠️ NUNCA LANZA HACIA ARRIBA. Es un disparador `onDelete`: si revienta, la
   cuenta ya no existe y nadie se entera. Los fallos se acumulan y se
   devuelven para que quien llama los deje escritos en
   `auth_deletion_failures` — coleccion que ya existia para esto.

   Guard: scripts/test_purga_usuario.js
   ══════════════════════════════════════════════════════════════════════ */
'use strict';

// Marca con la que se sustituye a la persona en lo que se conserva.
const BORRADO_UID    = '__deleted__';
const BORRADO_NOMBRE = 'Usuario eliminado';

// Firestore admite 500 operaciones por lote. Se deja margen.
const LOTE = 400;
// Tope de documentos por coleccion en una sola pasada. Si se supera, se
// anota: mas vale una purga incompleta y RUIDOSA que un timeout silencioso.
const TOPE = 2000;

/* ── El plan, declarado como DATOS y no como codigo ────────────────────
   Cada entrada dice: coleccion, por que campo se busca, y que se hace.
   Tenerlo como tabla permite que el guard compruebe la COBERTURA (que no
   falte ninguna coleccion con datos personales) sin ejecutar nada.        */
const PLAN = [
    // 🗑️ SUYO Y DE NADIE MAS
    { col: 'push_tokens',          campos: ['uid', 'userUid'],            trato: 'borrar' },
    { col: 'cronos_role_sessions', campos: ['uid'],                        trato: 'borrar' },
    { col: 'platform_requests',    campos: ['uid', 'userUid'],             trato: 'borrar' },
    { col: 'slot_requests',        campos: ['userId'],                     trato: 'borrar' },
    // La copia que el FAMILIAR tiene del informe de su hijo es suya.
    { col: 'cronos_player_reports', campos: ['parentUid'],                 trato: 'borrar' },
    // v754b · Los avisos que RECIBIÓ (convocatorias, planificaciones…): cada
    // destinatario tiene su propia copia (`parentUid`/`userId` = él), así que
    // la suya se va. Hueco visto en la prueba real del 2026-09-23.
    { col: 'cronos_notifications', campos: ['parentUid', 'userId'],        trato: 'borrar' },

    // 🎭 COMPARTIDO: se le quita la autoria, el contenido se queda
    { col: 'cronos_player_reports', campos: ['coachUid'],                  trato: 'seudonimizar',
      renombrar: { coachUid: BORRADO_UID, coachName: BORRADO_NOMBRE, coachEmail: null } },
    // v754b · …y los que ENVIÓ: la copia es del destinatario y habla de sus
    // jugadores; se queda sin autoría (`coachName` lo sella v754).
    { col: 'cronos_notifications', campos: ['coachUid'],                  trato: 'seudonimizar',
      renombrar: { coachUid: BORRADO_UID, coachName: BORRADO_NOMBRE, coachEmail: null } },
    { col: 'cronos_staff_threads',  campos: ['coachUid'],                  trato: 'seudonimizar',
      renombrar: { coachUid: BORRADO_UID, coachName: BORRADO_NOMBRE } },
    { col: 'cronos_staff_messages', campos: ['senderUid'],                 trato: 'seudonimizar',
      renombrar: { senderUid: BORRADO_UID, senderName: BORRADO_NOMBRE, senderEmail: null } },
    { col: 'cronos_player_links',   campos: ['parentUid'],                 trato: 'seudonimizar',
      renombrar: { parentUid: BORRADO_UID, parentName: BORRADO_NOMBRE, parentEmail: null } },
    { col: 'succession_requests',   campos: ['outgoingAdminUid'],          trato: 'seudonimizar',
      renombrar: { outgoingAdminEmail: null, outgoingAdminName: BORRADO_NOMBRE } },
    { col: 'deletion_requests',     campos: ['userId', 'requestedBy'],     trato: 'seudonimizar',
      renombrar: { userEmail: null, userName: BORRADO_NOMBRE },
      porque: 'es la PRUEBA de que la baja se atendio: se conserva sin el dato personal' },
];

/* 🚨 LAS CLAVES POR PLAZA, Y POR QUE HAY QUE BUSCARLAS UNA A UNA
   `dismissedBy` no guarda el uid pelado: desde v2 la unidad es la PLAZA y la
   clave es `uid + '_' + rol` (reports-tab.js:363), porque una misma cuenta
   puede ser Director Y Coordinador y oculta por separado en cada panel.

   🔑 Y `array-contains` NO HACE PREFIJOS. Buscando solo el uid, un informe
   ocultado con `uid_director` **no aparece en la consulta**, asi que no se
   limpiaria nunca: quedaria el uid de una persona borrada dentro de un
   documento vivo. Lo cazo el guard, no el razonamiento.

   Se usa `array-contains-any`, que admite hasta 10 valores en UNA consulta.
   La lista de roles es la misma que ya enumera firestore.rules en
   `soloSeAnyadeUnoMismo` (SEC-R01): si se anyade un rol alli, anyadirlo aqui. */
const ROLES_EN_CLAVE = ['director', 'coordinator', 'coach', 'club_admin',
                        'individual_admin', 'user', 'parent'];
const clavesDe = (uid) => [uid].concat(ROLES_EN_CLAVE.map((r) => uid + '_' + r));

// Arrays de los que hay que sacar el uid allá donde aparezca.
const LISTAS = [
    { col: 'cronos_player_reports', campo: 'staffUids' },
    { col: 'cronos_player_reports', campo: 'dismissedBy' },
    { col: 'cronos_player_reports', campo: 'dismissedByStaff' },
    { col: 'cronos_messages',       campo: 'participants', seudonimizarAutores: true },
    // v754b · quien oculta un aviso se apunta aquí (events-tab.js, `me.uid`).
    { col: 'cronos_notifications',  campo: 'dismissedBy' },
];

// Subcolecciones de `users/{uid}` que NO se van con el documento padre.
const SUBCOLECCIONES = ['cronos_data', 'sa_privado'];

// Lo que se conserva a proposito, y por que. No se borra ni se toca.
const CONSERVAR = [
    { col: 'audit_logs',            porque: 'trazabilidad de seguridad' },
    { col: 'billing_invoices',      porque: 'obligacion mercantil (6 anyos)' },
    { col: 'billing_subscriptions', porque: 'obligacion mercantil' },
];

/* ── Ayudantes ─────────────────────────────────────────────────────── */

function _quitarDe(lista, uid) {
    if (!Array.isArray(lista)) return null;
    // ⚠️ Se quitan tambien las claves POR PLAZA (`uid_rol`): desde v2 la
    //    unidad de `dismissedBy` es la plaza, no la persona (reports-tab.js).
    //    Buscar solo el uid pelado dejaria basura con el uid dentro.
    const fuera = lista.filter((x) => {
        const s = String(x == null ? '' : x);
        return s !== uid && s.indexOf(uid + '_') !== 0;
    });
    return fuera.length === lista.length ? null : fuera;
}

async function _docsPorCampo(db, col, campo, uid) {
    const snap = await db.collection(col).where(campo, '==', uid).limit(TOPE).get();
    return snap.docs || [];
}

/* ── El motor ──────────────────────────────────────────────────────── */

async function ejecutarPurga(db, uid, opciones) {
    const o = opciones || {};
    const simular = o.simular === true;
    const resumen = { uid: uid, simulado: simular, borrados: 0, seudonimizados: 0,
                      listasLimpiadas: 0, porColeccion: {}, fallos: [], topeAlcanzado: [] };

    const anota = (col, clave) => {
        const c = resumen.porColeccion[col] || { borrados: 0, seudonimizados: 0, listas: 0 };
        c[clave]++; resumen.porColeccion[col] = c;
        resumen.porColeccion[col] = c;
    };

    /* 🚨🚨 v754b · UN DOCUMENTO, UNA ESCRITURA.
       Un mismo documento puede coincidir por VARIOS caminos: el informe que es
       su copia de familiar (`parentUid`) Y que escribió él (`coachUid`), o el
       aviso que se envió a sí mismo. Antes se empujaban las dos operaciones y
       el lote llevaba «borrar» y luego «actualizar» sobre el mismo documento:
       Firestore rechaza el `update` con NOT_FOUND y, como el lote es ATÓMICO,
       **se perdía el lote entero** — hasta 400 escrituras, la ficha del
       usuario incluida. Lo destapó el guard al hacer su base falsa atómica.
       Regla: borrar gana a actualizar; dos actualizaciones se FUNDEN.
       Devuelve true si la operación cuenta (para no inflar el desglose). */
    const escrituras = [];
    const porDoc = new Map();
    const claveRef = (ref) => ref.path || ((ref.__sub || ref.__col) + '/' + ref.__id);
    const empujar = (op) => {
        const k = claveRef(op.ref);
        const prev = porDoc.get(k);
        if (!prev) { porDoc.set(k, op); escrituras.push(op); return true; }
        if (prev.tipo === 'borrar') return false;
        if (op.tipo === 'borrar') {
            escrituras[escrituras.indexOf(prev)] = op; porDoc.set(k, op); return true;
        }
        Object.assign(prev.datos, op.datos);
        return false;
    };

    // ── 1. El documento del usuario y sus SUBCOLECCIONES ──────────────
    // 🚨 El orden importa: primero las hijas. Si se borra el padre y luego
    //    falla algo, las hijas quedan huerfanas y ya nadie las encuentra.
    for (const sub of SUBCOLECCIONES) {
        try {
            const snap = await db.collection('users').doc(uid).collection(sub).limit(TOPE).get();
            for (const d of (snap.docs || [])) {
                empujar({ tipo: 'borrar', ref: d.ref, col: 'users/' + sub });
                anota('users/' + sub, 'borrados');
            }
        } catch (e) { resumen.fallos.push('users/' + uid + '/' + sub + ': ' + e.message); }
    }
    if (empujar({ tipo: 'borrar', ref: db.collection('users').doc(uid), col: 'users' })) anota('users', 'borrados');

    // ── 2. El plan declarado ──────────────────────────────────────────
    for (const p of PLAN) {
        for (const campo of p.campos) {
            let docs;
            try { docs = await _docsPorCampo(db, p.col, campo, uid); }
            catch (e) { resumen.fallos.push(p.col + '.' + campo + ': ' + e.message); continue; }

            if (docs.length >= TOPE) resumen.topeAlcanzado.push(p.col + '.' + campo);

            for (const d of docs) {
                if (p.trato === 'borrar') {
                    if (empujar({ tipo: 'borrar', ref: d.ref, col: p.col })) anota(p.col, 'borrados');
                } else {
                    const cambios = Object.assign({}, p.renombrar);
                    // El campo por el que se encontro tambien se sustituye:
                    // si no, el vinculo con la persona seguiria ahi.
                    if (!(campo in cambios)) cambios[campo] = BORRADO_UID;
                    if (empujar({ tipo: 'actualizar', ref: d.ref, datos: cambios, col: p.col })) anota(p.col, 'seudonimizados');
                }
            }
        }
    }

    // ── 3. Los arrays donde aparece el uid ────────────────────────────
    for (const l of LISTAS) {
        let docs;
        // ⚠️ `array-contains-any` y no `array-contains`: hay que cazar también
        //    las claves por plaza `uid_rol` (ver la nota de ROLES_EN_CLAVE).
        try { docs = await db.collection(l.col).where(l.campo, 'array-contains-any', clavesDe(uid)).limit(TOPE).get(); }
        catch (e) { resumen.fallos.push(l.col + '.' + l.campo + ': ' + e.message); continue; }

        for (const d of (docs.docs || [])) {
            const datos = d.data() || {};
            const limpia = _quitarDe(datos[l.campo], uid);
            if (limpia === null) continue;

            // ⚠️ `participants` NO se toca: es la clave por la que la OTRA
            //    parte encuentra su hilo. Ahi solo se seudonimiza al autor.
            if (l.campo === 'participants') {
                const cambios = {};
                if (datos.senderUid === uid) { cambios.senderUid = BORRADO_UID; cambios.senderName = BORRADO_NOMBRE; }
                if (datos.authorUid === uid) { cambios.authorUid = BORRADO_UID; cambios.authorName = BORRADO_NOMBRE; }
                if (!Object.keys(cambios).length) continue;
                if (empujar({ tipo: 'actualizar', ref: d.ref, datos: cambios, col: l.col })) anota(l.col, 'seudonimizados');
                continue;
            }

            if (empujar({ tipo: 'actualizar', ref: d.ref, datos: { [l.campo]: limpia }, col: l.col })) anota(l.col, 'listas');
        }
    }

    // ── 4. Contar y, si toca, escribir ────────────────────────────────
    for (const e of escrituras) {
        if (e.tipo === 'borrar') resumen.borrados++;
        else if (e.datos && Object.keys(e.datos).length === 1 && Array.isArray(Object.values(e.datos)[0])) resumen.listasLimpiadas++;
        else resumen.seudonimizados++;
    }

    if (simular) { resumen.plan = escrituras.map((e) => ({ tipo: e.tipo, col: e.col, datos: e.datos })); return resumen; }

    for (let i = 0; i < escrituras.length; i += LOTE) {
        const trozo = escrituras.slice(i, i + LOTE);
        const lote = db.batch();
        for (const e of trozo) {
            if (e.tipo === 'borrar') lote.delete(e.ref);
            else lote.update(e.ref, e.datos);
        }
        try { await lote.commit(); }
        catch (err) { resumen.fallos.push('lote ' + (i / LOTE) + ': ' + err.message); }
    }

    return resumen;
}

module.exports = { ejecutarPurga, PLAN, LISTAS, SUBCOLECCIONES, CONSERVAR, ROLES_EN_CLAVE, clavesDe,
                   BORRADO_UID, BORRADO_NOMBRE, TOPE, LOTE, _quitarDe };
