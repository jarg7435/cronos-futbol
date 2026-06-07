# Auditoría de funciones deprecadas en Firebase

Fecha: 2026-06-04
Proyecto: cronos-futbol-app

## Resumen ejecutivo

| Severidad | Hallazgo | Estado |
|-----------|----------|--------|
| 🔴 Alta | `functions.config()` (Runtime Config) deprecado, eliminado mar/2026 | Acción requerida |
| 🟠 Media | API completa en Cloud Functions **Gen 1** (`firebase-functions/v1`) | Migración recomendada |
| 🟠 Media | `functions.pubsub.schedule()` (sintaxis Gen 1) | Migración recomendada |
| 🟡 Baja | `firebase-functions@^5.0.0` desactualizado (actual: v6.x) | Actualizar |
| 🟡 Baja | SDK web `firebasejs/10.12.2` desactualizado (actual: v11/12) | Actualizar |
| 🟢 Info | `firebase-admin@^12` desactualizado (actual: v13) | Opcional |

---

## 1. 🔴 `functions.config()` — DEPRECADO (crítico)

**Ubicación:** `functions/index.js:569,572`

```js
const emailUser = process.env.EMAIL_USER
  || (typeof functions.config === 'function' && functions.config().email && functions.config().email.user)
  || null;
const emailPass = process.env.EMAIL_PASS
  || (typeof functions.config === 'function' && functions.config().email && functions.config().email.pass)
  || null;
```

**Problema:** `functions.config()` y `firebase functions:config:set` quedaron
deprecados y la API de Runtime Config dejó de estar disponible (cierre
mar/2026). Google la reemplazó por **Secret Manager** (`process.env`) y
`.env` files.

**Buena noticia:** El código ya prioriza `process.env.EMAIL_USER/EMAIL_PASS`
y usa `.runWith({ secrets: [...] })` (línea 545). El fallback a
`functions.config()` es código muerto/legacy.

**Acción:**
1. Confirmar que los secrets están configurados:
   ```
   firebase functions:secrets:set EMAIL_USER
   firebase functions:secrets:set EMAIL_PASS
   ```
2. Eliminar el fallback deprecado (queda solo `process.env`):
   ```js
   const emailUser = process.env.EMAIL_USER || null;
   const emailPass = process.env.EMAIL_PASS || null;
   ```
3. Limpiar comentarios obsoletos en `functions/index.js:566`.

También en docs: `DEPLOYMENT_GUIDE_SPRINT3.md:329,337,384` aún recomiendan
`firebase functions:config:get/set`. Actualizar a `functions:secrets`.

---

## 2. 🟠 Cloud Functions Gen 1 (toda la API v1)

**Ubicación:** `functions/index.js:1` → `require('firebase-functions/v1')`

Todas las funciones usan la sintaxis Gen 1, que sigue soportada pero está en
modo mantenimiento. Google recomienda Gen 2 (`firebase-functions/v2`).

| Línea | Función | Sintaxis Gen 1 |
|-------|---------|----------------|
| 59 | setCustomClaims | `functions.https.onCall` |
| 142 | getMatchForSpectator | `functions.https.onCall` |
| 191 | (trigger) | `.firestore.document().onCreate` |
| 225,408 | (triggers) | `.firestore.document().onWrite` |
| 260 | deleteUserData | `functions.auth.user().onDelete` |
| 287 | deleteAuthUser | `functions.https.onCall` |
| 449 | cleanupExpiredRequests | `functions.pubsub.schedule` |
| 485 | (trigger) | `.onCreate` |
| 508 | (trigger) | `.onUpdate` |
| 544 | sendInviteEmail | `.runWith().https.onCall` |
| 727 | approveIndividualAdmin | `functions.https.onCall` |

**Cambios clave al migrar a Gen 2:**
- `onCall(async (data, context) =>` → `onCall(async (request) =>`
  (`request.data`, `request.auth`).
- `.runWith({ secrets })` → opción `{ secrets: [...] }` en el define.
- `functions.pubsub.schedule('every 24 hours')` → `onSchedule('every 24 hours')`.
- `functions.auth.user().onDelete` → **no existe** en Gen 2 (Identity
  triggers). Mantener en Gen 1 o usar `beforeUserDeleted` (blocking).

**Recomendación:** No urgente. Gen 1 sigue funcionando. Planificar migración
gradual; el trigger `auth.user().onDelete` obliga a mantener algo en Gen 1.

---

## 3. 🟠 `functions.pubsub.schedule()`

**Ubicación:** `functions/index.js:449-450`

```js
exports.cleanupExpiredRequests = functions.pubsub
  .schedule('every 24 hours')
```

Sintaxis Gen 1. En Gen 2 sería:
```js
const { onSchedule } = require('firebase-functions/v2/scheduler');
exports.cleanupExpiredRequests = onSchedule('every 24 hours', async (event) => {...});
```

---

## 4. 🟡 Versiones de paquetes desactualizadas

**`functions/package.json`:**
```json
"firebase-admin": "^12.0.0",     // actual: ^13.x
"firebase-functions": "^5.0.0",  // actual: ^6.x
"nodemailer": "^8.0.7"           // OK
```

- `firebase-functions@5` → `@6` recomendado (mejor soporte secrets/Gen2).
- `firebase-admin@12` → `@13` (compatible con Node 22 ya declarado).

**SDK web** (`firebasejs/10.12.2`) usado en 13+ archivos
(`firebase-init.js`, `live.html`, `firestore-*.js`, etc.). Versión actual
estable: v11/v12. No hay APIs deprecadas en uso (modular API ya correcta:
`getFirestore`, `onSnapshot`, `httpsCallable`), solo conviene actualizar.

---

## 5. 🟢 APIs web — sin deprecaciones detectadas

El cliente ya usa la **API modular** (v9+) correctamente:
- `initializeApp`, `getFirestore`, `getAuth`, `getFunctions` ✅
- `onSnapshot`, `doc`, `getDoc`, `setDoc`, `serverTimestamp` ✅
- `httpsCallable` (`js/services/audit-logger.js:131`) ✅

No se detectó uso de:
- `enableIndexedDbPersistence` (deprecado → `persistentLocalCache`)
- API namespaced/compat (`firebase.firestore()`) ❌ no presente
- `firebase.auth()` compat ❌ no presente

---

## Plan de acción priorizado

1. **[Crítico]** Eliminar fallback `functions.config()` en `index.js`
   y confirmar secrets EMAIL_USER/EMAIL_PASS. → cierra riesgo mar/2026.
2. **[Medio]** Actualizar `DEPLOYMENT_GUIDE_SPRINT3.md` a `functions:secrets`.
3. **[Medio]** Subir `firebase-functions@^6` y `firebase-admin@^13`,
   re-test deploy.
4. **[Bajo]** Planificar migración Gen 1 → Gen 2 (excepto `auth.onDelete`).
5. **[Bajo]** Actualizar SDK web a v11/v12 cuando se valide compatibilidad.
