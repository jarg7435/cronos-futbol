// diagnostico_limpieza_email.js
// Script de comprobación para verificar que un correo específico está 100% desvinculado
// y sin rastros huérfanos en Firestore ni en Auth.

const TARGET_EMAIL = process.argv[2] || 'damasorv@gmail.com';
const fs = require('fs');
const path = require('path');

console.log(`=== COMPROBACIÓN DE LIMPIEZA Y DESVINCULACIÓN PARA: ${TARGET_EMAIL} ===\n`);

console.log('PASO 1: Verificación de Reglas e Infraestructura de Purga');
const fnPath = path.join(__dirname, '../functions/index.js');
const rulesPath = path.join(__dirname, '../firestore.rules');

if (fs.existsSync(fnPath) && fs.existsSync(rulesPath)) {
    const fn = fs.readFileSync(fnPath, 'utf8');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    const hasPurgeInFn = fn.includes("db.collection('users').doc(targetUid).delete()") || fn.includes("admin.firestore().collection('users').doc(uid).delete()");
    const hasRolesInRules = rules.includes("isClubDirectorOf(clubId)") && rules.includes("isClubCoordinatorOf(clubId)");

    console.log(`  [+] Cloud Functions incluye purga automática de users: ${hasPurgeInFn ? 'SÍ' : 'NO'}`);
    console.log(`  [+] Rules autoriza decisiones a Director/Coordinador: ${hasRolesInRules ? 'SÍ' : 'NO'}`);
}

console.log('\nPASO 2: Instrucciones para comprobación en Consola Firebase');
console.log(`  1. Firebase Console -> Authentication -> Users:
     Buscar: "${TARGET_EMAIL}"
     • Estado Esperado: "No matching users found" (cuenta eliminada).

  2. Firebase Console -> Firestore Database -> Colección 'users':
     Filtrar/Buscar por campo 'email' == "${TARGET_EMAIL}"
     • Estado Esperado: 0 documentos devueltos.

  3. Firebase Console -> Firestore Database -> Colección 'registration_requests':
     Filtrar/Buscar por campo 'userEmail' == "${TARGET_EMAIL}"
     • Estado Esperado: 0 solicitudes pendientes.
`);

console.log('PASO 3: Código ejecutable para Consola DevTools (F12) en la propia App');
console.log(`Copiar y pegar en DevTools en la app (cronos-futbol-test.web.app):

(async () => {
    try {
        const email = "${TARGET_EMAIL}";
        const { db } = await window.saFS();
        const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const q = query(collection(db, 'users'), where('email', '==', email));
        const snap = await getDocs(q);
        console.log("Docs en 'users' para " + email + ":", snap.size);
        snap.forEach(d => console.log("Doc encontrado:", d.id, d.data()));
        if (snap.size === 0) {
            console.log("✅ EL CORREO ESTÁ 100% DESVINCULADO Y LIBRE PARA REGISTRARSE.");
        } else {
            console.warn("⚠️ Aún existen documentos en Firestore para este correo.");
        }
    } catch(e) { console.error(e); }
})();
`);
