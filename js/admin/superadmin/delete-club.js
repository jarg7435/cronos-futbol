// ════════════════════════════════════════════════════════════════════
//  js/admin/superadmin/delete-club.js
//  Borrado completo de un club (SuperAdmin).
//  Extraído de superadmin.panel.js (auditoría 2026-07-22, hallazgo #9 —
//  monolitos sin tests de framework) el 2026-07-24. Movimiento puramente
//  mecánico, sin cambios de lógica — depende de helpers ya definidos por
//  superadmin.panel.js (saFS, _saShowSpinner/_saHideSpinner/_saToast,
//  saTab), que debe cargarse ANTES que este archivo.
//  setupClubsSyncListener (que queda en superadmin.panel.js) llama a
//  saIndividuals/saClubs/saCountPendingRequests/saRequests -- mayor
//  acoplamiento, se extraerá junto a esas pestañas.
//  Cubierto por scripts/test_sa_delete_club_module.js.
// ════════════════════════════════════════════════════════════════════

window.saDeleteClubComplete = async function(clubId, clubName) {
    if (!confirm(
        '\u26a0\ufe0f BORRADO COMPLETO DEL CLUB\n\n' +
        'Club: ' + clubName + '\n\n' +
        'Esto hard\u00e1 lo siguiente:\n' +
        '\u2022 Borrar\u00e1 el documento del club\n' +
        '\u2022 Eliminar\u00e1 el clubId de todos sus usuarios\n' +
        '\u2022 Borrar\u00e1 todas sus platform_requests\n' +
        // v435: el borrado se lleva tambien lo deportivo. Antes quedaba
        // huerfano y sin nadie que pudiera verlo ni limpiarlo.
        '\u2022 Borrar\u00e1 TODOS sus informes, partidos y v\u00ednculos jugador-familiar\n' +
        '\u2022 Los usuarios quedar\u00e1n libres para re-registrarse con el mismo email\n\n' +
        '\u00bfConfirmas el borrado completo?'
    )) return;

    _saShowSpinner('Borrando club y reseteando usuarios...');
    try {
        const { db, doc, deleteDoc, collection, getDocs, query, where, updateDoc } = await saFS();

        // 1. Todos los usuarios que tengan ese clubId en su doc principal O en allRoles
        // Incluye también el SA u otros usuarios con roles en ese club
        const [usersSnap, allUsersSnap] = await Promise.all([
            getDocs(query(collection(db,'users'), where('clubId','==',clubId))),
            getDocs(collection(db,'users')), // para encontrar usuarios con allRoles del club
        ]);

        // Unir IDs únicos de ambas consultas
        const affectedUsers = new Map();
        usersSnap.forEach(d => affectedUsers.set(d.id, d));
        allUsersSnap.forEach(d => {
            const data = d.data();
            const hasRoleInClub = (data.allRoles||[]).some(r => r.clubId === clubId);
            if (hasRoleInClub) affectedUsers.set(d.id, d);
        });

        const userOps = [];
        affectedUsers.forEach((uDoc) => {
            const uData = uDoc.data();
            const cleanRoles = (uData.allRoles || []).filter(r => r.clubId !== clubId);
            const hasOtherActive = cleanRoles.some(r => r.isAuthorized);
            const isSA = uData.role === 'superadmin';

            if (isSA) {
                // SA: solo limpiar allRoles, mantener su rol de SA intacto
                userOps.push(updateDoc(doc(db,'users',uDoc.id), {
                    allRoles: cleanRoles,
                }));
            } else {
                userOps.push(updateDoc(doc(db,'users',uDoc.id), {
                    clubId:       uData.clubId === clubId ? null : uData.clubId,
                    clubName:     uData.clubId === clubId ? null : uData.clubName,
                    allRoles:     cleanRoles,
                    role:         hasOtherActive ? (cleanRoles.find(r=>r.isAuthorized)||{}).role || null : null,
                    status:       hasOtherActive ? 'active' : 'free',
                    isAuthorized: hasOtherActive,
                }));
            }
        });
        await Promise.all(userOps);

        // 2. Borrar platform_requests del club (por clubId)
        const prSnap = await getDocs(query(collection(db,'platform_requests'), where('clubId','==',clubId)));
        const prOps = [];
        prSnap.forEach(d => prOps.push(deleteDoc(doc(db,'platform_requests',d.id))));
        await Promise.all(prOps);

        // 2b. También borrar platform_requests por userUid de cada usuario del club
        // (cubre solicitudes sin clubId, como club_admin e individual)
        const prOps2 = [];
        affectedUsers.forEach((uDoc) => {
            const uid2 = uDoc.id;
            getDocs(query(collection(db,'platform_requests'), where('userUid','==',uid2)))
                .then(snap2 => {
                    snap2.forEach(d2 => deleteDoc(doc(db,'platform_requests',d2.id)).catch(()=>{}));
                }).catch(()=>{});
        });

        // \u2500\u2500 v435 \u00b7 3. LOS DATOS DEPORTIVOS DEL CLUB \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        // Hasta v435 el borrado dejaba hu\u00e9rfanos los informes, los partidos y
        // los v\u00ednculos jugador-padre: se borraba el club y sus usuarios, pero
        // `cronos_player_reports`, `live_matches` y `cronos_player_links`
        // segu\u00edan en la base de datos para siempre, sin nadie que pudiera
        // verlos ni limpiarlos \u2014porque el acceso se resuelve por clubId y ya no
        // quedaba ning\u00fan usuario con ese clubId\u2014. El criterio del autor es que
        // el SuperAdmin pueda vaciar la informaci\u00f3n al cerrar la temporada, as\u00ed
        // que el borrado del club se lleva ahora tambi\u00e9n lo deportivo.
        //
        // Se hace en tandas de 400: un batch de Firestore admite 500
        // operaciones y falla ENTERO al pasarse. Aqu\u00ed no se usa batch sino
        // borrados sueltos, pero se trocea igual para no lanzar miles de
        // promesas a la vez contra la cuota.
        const _borrarPorClub = async (col) => {
            let n = 0;
            try {
                const snap = await getDocs(query(collection(db, col), where('clubId', '==', clubId)));
                const ids = [];
                snap.forEach(d => ids.push(d.id));
                for (let i = 0; i < ids.length; i += 400) {
                    await Promise.all(ids.slice(i, i + 400)
                        .map(id => deleteDoc(doc(db, col, id)).then(() => { n++; }).catch(() => {})));
                }
            } catch (e) {
                console.warn('[saDeleteClubComplete] ' + col + ':', e && e.message);
            }
            return n;
        };

        // v572 · P2 · `live_index` va en la misma tanda que `live_matches`: es
        // el espejo ligero de cada partido y lleva su mismo `clubId`, así que
        // se acota igual. Si no se borrara, un club eliminado dejaría tras de sí
        // tarjetas de partido que nadie podría ver ni limpiar — exactamente los
        // huérfanos que v435 vino a cerrar, sólo que en la colección nueva.
        // El recuento del índice no se informa al usuario a propósito: es un
        // espejo interno de los partidos, no un dato suyo. "12 partidos y 12
        // índices eliminados" sólo confundiría.
        const [nRep, nLive, nLinks] = await Promise.all([
            _borrarPorClub('cronos_player_reports'),
            _borrarPorClub('live_matches'),
            _borrarPorClub('cronos_player_links'),
        ]);
        await _borrarPorClub('live_index');
        // 🪶 v639 · Y `finished_index`, el espejo ligero de los INFORMES. Mismo
        // razonamiento que el de arriba y mismo `clubId`: sin esto, un club
        // borrado dejaría su histórico de Partidos Terminados en pie, con los
        // nombres de equipo y las categorías de sus menores dentro.
        await _borrarPorClub('finished_index');

        // 4. Borrar el club
        await deleteDoc(doc(db,'clubs',clubId));

        _saHideSpinner();
        _saToast('\u2705 Club "' + clubName + '" borrado. ' + usersSnap.size + ' usuario(s) reseteados. '
               + nRep + ' informe(s), ' + nLive + ' partido(s) y ' + nLinks + ' v\u00ednculo(s) eliminados. '
               + 'Pueden re-registrarse con los mismos correos.', 7000);
        saTab('clubs');

    } catch(e) {
        _saHideSpinner();
        _saToast('\u274c Error al borrar: ' + e.message, 5000);
        console.error('[saDeleteClubComplete]', e);
    }
};
