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

        // 3. Borrar el club
        await deleteDoc(doc(db,'clubs',clubId));

        _saHideSpinner();
        _saToast('\u2705 Club "' + clubName + '" borrado. ' + usersSnap.size + ' usuario(s) reseteados. Pueden re-registrarse con los mismos correos.', 7000);
        saTab('clubs');

    } catch(e) {
        _saHideSpinner();
        _saToast('\u274c Error al borrar: ' + e.message, 5000);
        console.error('[saDeleteClubComplete]', e);
    }
};
