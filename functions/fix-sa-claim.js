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
