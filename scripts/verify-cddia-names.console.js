/* ════════════════════════════════════════════════════════════════════
   verify-cddia-names.console.js  —  VERIFICACIÓN READ-ONLY (no modifica nada)

   OBJETIVO: antes de añadir la columna "Nombre" (solo nombre de pila) en el
   árbol de Usuarios del Club, comprobar VERBATIM qué campo de cada usuario de
   CD DÍA contiene SOLO el nombre de pila (firstName) y cuál podría exponer
   apellidos (displayName / lastName).

   CÓMO USARLO:
     1. Abre la app en producción (https://cronos-futbol-app.web.app) logueado
        como SuperAdmin (o como el Admin del club CD DÍA).
     2. Abre la consola del navegador (F12 → Console).
     3. Pega TODO este archivo y pulsa Enter.
     4. Lee la tabla que imprime: confirma para los 7 usuarios qué campo usar.

   GARANTÍA: SOLO usa getDocs (.get). No hay set/update/delete. No escribe nada.
   ════════════════════════════════════════════════════════════════════ */
(async () => {
  const fa = window._cronos_auth;
  if (!fa || !fa.db) { console.error('[verify] Firebase no inicializado. Recarga la página.'); return; }
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  // 1. Localizar el club "CD DÍA" por nombre (tolerante a tildes/mayúsculas).
  const norm = (s) => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quita tildes
      .toUpperCase().replace(/\s+/g, ' ').trim();
  const TARGET = norm('CD DÍA');

  const clubsSnap = await fs.getDocs(fs.collection(fa.db, 'clubs'));
  const clubs = clubsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const matchClubs = clubs.filter(c =>
      norm(c.name) === TARGET || norm(c.name).includes('CD DIA') || norm(c.name).includes(TARGET));

  console.log('%c[verify] Clubs que coinciden con "CD DÍA":', 'font-weight:bold;color:#58a6ff');
  console.table(matchClubs.map(c => ({ id: c.id, name: c.name })));
  if (!matchClubs.length) {
    console.warn('[verify] No se encontró el club por nombre. Revisa la lista completa:');
    console.table(clubs.map(c => ({ id: c.id, name: c.name })));
    return;
  }
  const clubIds = new Set(matchClubs.map(c => String(c.id)));

  // 2. Leer todos los usuarios y filtrar los que pertenecen a CD DÍA
  //    (por root clubId o por cualquier entrada de allRoles del club).
  const usersSnap = await fs.getDocs(fs.collection(fa.db, 'users'));
  const belongs = (u) => {
    if (clubIds.has(String(u.clubId || ''))) return true;
    if (clubIds.has(String(u.requestedClubId || ''))) return true;
    return (u.allRoles || []).some(r => clubIds.has(String(r.clubId || '')));
  };
  const cddiaUsers = usersSnap.docs
      .map(d => ({ _id: d.id, ...d.data() }))
      .filter(belongs);

  // 3. Volcado VERBATIM de los campos de nombre.
  const firstWord = (s) => String(s || '').trim().split(/\s+/)[0] || '';
  const rows = cddiaUsers.map(u => {
    // ¿displayName expone apellidos? (heurística: tiene más de una palabra
    // y NO empieza por "Administrador Individual ...")
    const dn = String(u.displayName || '');
    const dnWords = dn.trim().split(/\s+/).filter(Boolean);
    const dnLooksFullName = dnWords.length > 1;
    return {
      email: u.email,
      role: u.role || (u.allRoles && u.allRoles[0] && u.allRoles[0].role) || '',
      firstName: u.firstName == null ? '∅(falta)' : JSON.stringify(u.firstName),
      lastName: u.lastName == null ? '∅' : JSON.stringify(u.lastName),
      displayName: u.displayName == null ? '∅' : JSON.stringify(u.displayName),
      'displayName→1ª palabra': firstWord(dn),
      'displayName ¿multi-palabra?': dnLooksFullName ? '⚠️ SÍ (riesgo apellido)' : 'no',
    };
  });

  console.log('%c[verify] Usuarios de CD DÍA (' + rows.length + '):', 'font-weight:bold;color:#3fb950');
  console.table(rows);

  // 4. Resumen ejecutivo
  const withFirst = rows.filter(r => !r.firstName.startsWith('∅')).length;
  const dnRisk = rows.filter(r => r['displayName ¿multi-palabra?'].startsWith('⚠️')).length;
  console.log('%c[verify] RESUMEN:', 'font-weight:bold;color:#d2a8ff');
  console.log('  • Usuarios totales CD DÍA       :', rows.length);
  console.log('  • Con firstName presente        :', withFirst, '/', rows.length);
  console.log('  • displayName multi-palabra     :', dnRisk, '(estos expondrían apellido si se usa displayName)');
  console.log('\n  → Decisión segura: usar firstName; si firstName falta, displayName.split(" ")[0].');
  window.__cddiaVerify = { clubs: matchClubs, users: cddiaUsers, rows };
  console.log('  (datos crudos guardados en window.__cddiaVerify)');
})();
