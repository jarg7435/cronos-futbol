/**
 * fix-sa-claim.js — Script de un solo uso
 * Asigna custom claims correctos al SuperAdmin principal.
 * Usa el refresh token del Firebase CLI autenticado.
 *
 * Uso:  cd functions && node fix-sa-claim.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const os = require('os');

/* ══════════════════════════════════════════════════════════════════════
   🔴 v633 · ADAPTADOR PARA firebase-admin 14 (mismo caso que index.js)

   La v14 borro la API con espacio de nombres: `admin.credential`,
   `admin.auth` y `admin.firestore` ya no existen. Las fabricas de
   credencial subieron a la raiz (`admin.refreshToken`, `admin.cert`,
   `admin.applicationDefault`) y el resto se pide por su propia puerta.

   ⚠️ AQUI EL ADAPTADOR VA PARTIDO EN DOS, y esa es la diferencia con
   index.js: la credencial hace falta ANTES de initializeApp, y `getAuth()`
   solo funciona DESPUES. Ponerlo todo junto arriba lanzaria; ponerlo todo
   junto abajo dejaria sin arreglar la linea que construye la credencial.

   🚨 Este guion NO se despliega, asi que nadie lo prueba: reventaria en la
   cara el dia que haga falta usarlo — que es justo un dia de urgencia,
   porque lo que hace es devolverle los claims al SuperAdmin.
   ══════════════════════════════════════════════════════════════════════ */
if (!admin.credential) {
    admin.credential = {
        refreshToken:       admin.refreshToken,
        applicationDefault: admin.applicationDefault,
        cert:               admin.cert,
    };
}

// ── Obtener refresh token del Firebase CLI ──
const configPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
let refreshToken;

try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    refreshToken = config.tokens && config.tokens.refresh_token;
    if (!refreshToken) {
        // Puede estar en otra estructura
        refreshToken = config.user && config.user.tokens && config.user.tokens.refresh_token;
    }
    if (!refreshToken) {
        console.error('ERROR: No se encontro refresh_token en', configPath);
        console.error('Estructura encontrada:', JSON.stringify(Object.keys(config), null, 2));
        process.exit(1);
    }
    console.log('OK: refresh token encontrado en Firebase CLI config');
} catch (err) {
    console.error('ERROR leyendo config:', err.message);
    process.exit(1);
}

// ── Inicializar Admin SDK con refresh token ──
const credential = admin.credential.refreshToken({
    type: 'authorized_user',
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
    refresh_token: refreshToken
});

admin.initializeApp({
    credential: credential,
    projectId: 'cronos-futbol-app'
});

/* 🔴 v633 · La segunda mitad del adaptador: `getAuth()` necesita la app ya
   inicializada, por eso va aqui y no arriba con la credencial. */
const { getAuth } = require('firebase-admin/auth');
if (typeof admin.auth !== 'function') {
    admin.auth = () => getAuth();
}

// ── Ejecutar ──
const TARGET_UID = 'uvtqRyO3OjWEGUZ7qkhnpMtThwS2';
const NEW_CLAIMS = {
    role: 'superadmin',
    superAdmin: true,
    admin: true
};

async function main() {
    try {
        const user = await admin.auth().getUser(TARGET_UID);
        console.log('-----------------------------------');
        console.log('Usuario:', user.email);
        console.log('UID:    ', user.uid);
        console.log('Claims ANTES:', JSON.stringify(user.customClaims || {}));
        console.log('-----------------------------------');

        await admin.auth().setCustomUserClaims(TARGET_UID, NEW_CLAIMS);

        const updated = await admin.auth().getUser(TARGET_UID);
        console.log('Claims DESPUES:', JSON.stringify(updated.customClaims || {}));
        console.log('-----------------------------------');
        console.log('OK Claims actualizados correctamente.');
    } catch (err) {
        console.error('ERROR:', err.code || '', err.message);
        process.exit(1);
    }
    process.exit(0);
}

main();
