/* ════════════════════════════════════════════════════════════════════
   backfill-firstName-cddia.console.js  —  BACKFILL PUNTUAL (2 docs)

   PASO 1: rellenar `firstName` a nivel RAÍZ en 2 usuarios históricos de
   CD DÍA (registrados antes de que el nombre fuese obligatorio).

   Mismo patrón ya usado hoy con category/subcategory:
     · leer el documento COMPLETO (estado ANTES, verbatim)
     · updateDoc({ firstName }) → updateMask afecta SOLO a ese campo
     · releer el documento (estado DESPUÉS, verbatim) para verificar
   No se toca ningún otro campo.

   USO:
     1. Producción (https://cronos-futbol-app.web.app) logueado como SuperAdmin.
     2. F12 → Console → pega TODO → Enter.
     3. Revisa los bloques ANTES/DESPUÉS de cada documento.

   SEGURIDAD: solo escribe el campo `firstName` de los 2 UID indicados.
   ════════════════════════════════════════════════════════════════════ */
(async () => {
  const fa = window._cronos_auth;
  if (!fa || !fa.db) { console.error('[backfill] Firebase no inicializado. Recarga la página.'); return; }
  const fs = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  // Objetivos: UID → firstName a escribir. NADA MÁS se modifica.
  const TARGETS = [
    { uid: 'T7mDI9Bw3lgnZRKFfpQJ9Pfiki83', firstName: 'José Alberto', alias: 'arinagazone' },
    { uid: 'vG1ruwma2tcx7uoEK9ow0kLSz2K2', firstName: 'Dámaso',       alias: 'damasorv'   },
  ];

  for (const t of TARGETS) {
    console.log('%c══════════════════════════════════════════════', 'color:#58a6ff');
    console.log('%c[backfill] ' + t.alias + '  (' + t.uid + ')', 'font-weight:bold;color:#58a6ff');
    const ref = fs.doc(fa.db, 'users', t.uid);

    // ── ANTES ──────────────────────────────────────────────────────
    const before = await fs.getDoc(ref);
    if (!before.exists()) {
      console.error('  [ERROR] El documento NO existe. Se omite. UID=' + t.uid);
      continue;
    }
    const bData = before.data();
    console.log('%c  ANTES — firstName:', 'color:#ffa500', JSON.stringify(bData.firstName));
    console.log('  ANTES — doc completo (verbatim):');
    console.log(JSON.parse(JSON.stringify(bData)));

    if (bData.firstName === t.firstName) {
      console.log('%c  → Ya tenía firstName = ' + JSON.stringify(t.firstName) + '. No se escribe (idempotente).', 'color:#3fb950');
      continue;
    }

    // ── ESCRITURA (solo firstName) ─────────────────────────────────
    try {
      await fs.updateDoc(ref, { firstName: t.firstName });
      console.log('%c  ✔ updateDoc OK — firstName ← ' + JSON.stringify(t.firstName), 'color:#3fb950;font-weight:bold');
    } catch (e) {
      console.error('  [WRITE-ERR] ' + e.code + ' — ' + e.message);
      continue;
    }

    // ── DESPUÉS (releer para verificar) ────────────────────────────
    const after = await fs.getDoc(ref);
    const aData = after.data();
    console.log('%c  DESPUÉS — firstName:', 'color:#3fb950', JSON.stringify(aData.firstName));
    console.log('  DESPUÉS — doc completo (verbatim):');
    console.log(JSON.parse(JSON.stringify(aData)));

    // ── Comprobación de que SOLO cambió firstName ──────────────────
    const changed = [];
    const allKeys = new Set([...Object.keys(bData), ...Object.keys(aData)]);
    allKeys.forEach(k => {
      if (JSON.stringify(bData[k]) !== JSON.stringify(aData[k])) changed.push(k);
    });
    console.log('%c  Campos modificados:', 'color:#d2a8ff', changed.length ? changed.join(', ') : '(ninguno)');
    if (changed.length === 1 && changed[0] === 'firstName') {
      console.log('%c  ✅ Verificado: SOLO cambió firstName.', 'color:#3fb950;font-weight:bold');
    } else {
      console.warn('  ⚠️ Atención: cambiaron campos inesperados → revisa arriba.');
    }
  }
  console.log('%c══════════════════════════════════════════════', 'color:#58a6ff');
  console.log('%c[backfill] Terminado.', 'font-weight:bold;color:#58a6ff');
})();
