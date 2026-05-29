# 🚀 SPRINT 3: GUÍA DE DEPLOYMENT A FIREBASE

## 📋 TABLA DE CONTENIDOS
1. [Pre-requisitos](#pre-requisitos)
2. [Verificación Local](#verificación-local)
3. [Deploy de Cloud Functions](#deploy-de-cloud-functions)
4. [Deploy de Firestore Rules](#deploy-de-firestore-rules)
5. [Deploy de Web App](#deploy-de-web-app)
6. [Verificación Post-Deploy](#verificación-post-deploy)

---

## ✅ PRE-REQUISITOS

### Instalaciones Requeridas:
```bash
# Verificar Node.js v18+ (recomendado v20)
node --version

# Verificar npm v9+
npm --version

# Instalar Firebase CLI globalmente si no lo tienes
npm install -g firebase-tools@latest

# Verificar Firebase CLI
firebase --version
```

### Credenciales:
```bash
# Autenticar con Firebase (una única vez)
firebase login

# Verificar proyectos disponibles
firebase projects:list
```

---

## 🔍 VERIFICACIÓN LOCAL

### 1️⃣ Sprint 3 Feature Tests (Navegador)

Abre la app en `http://localhost:8000` (o donde esté alojada localmente):

```javascript
// En la consola del navegador (F12 → Console):
window.runSprint3Tests()
```

**Resultado esperado:**
```
✅ Pasados: 10/10
✅ SPRINT 3 VERIFICACIÓN EXITOSA
```

### 2️⃣ Verificar Cargas de Archivos

```bash
# Verificar que todos los archivos existen
ls -la js/services/audit-logger.js
ls -la js/core/render-optimizer.js
ls -la js/core/sprint3-init.js
ls -la js/core/sprint3-tests.js

# En Windows PowerShell:
Test-Path "js/services/audit-logger.js"
Test-Path "js/core/render-optimizer.js"
```

---

## ☁️ DEPLOY DE CLOUD FUNCTIONS

### PASO 1: Preparar el entorno

```bash
cd functions

# Instalar/actualizar dependencias
npm install

# Verificar que tenemos nodemailer (para email verification)
npm list nodemailer
# Si no está:
npm install nodemailer

cd ..
```

### PASO 2: Configurar variables de entorno (OPCIONAL - para Email)

Si deseas que el email verification funcione:

```bash
# Crear archivo .env.local en functions/
# Contenido (ejemplo con Gmail):
EMAIL_USER=tu-email@gmail.com
EMAIL_PASS=tu-app-password  # NO contraseña normal, usar App Password de Google

# Luego, en firebase deploy, las variables se sincronizarán
```

**Nota:** Sin variables de entorno, las funciones funcionan pero no envían emails.

### PASO 3: Deploy

```bash
# Desde la raíz del proyecto
firebase deploy --only functions

# ⏳ Esperará a que se compilen e implementen todas las funciones
# Debería ver:
# ✔ functions[sendEmailVerification] deployed successfully
# ✔ functions[verifyEmailCode] deployed successfully
# ✔ functions[cleanupExpiredRegistrationRequests] deployed successfully
# ✔ functions[deleteExpiredRequest] deployed successfully
# ✔ functions[logAuditEntry] deployed successfully
# ✔ functions[validateAndUpdatePlayerAction] deployed successfully
```

### PASO 4: Verificar Deploy

```bash
# Listar funciones desplegadas
firebase functions:list

# Ver logs de una función específica
firebase functions:log logAuditEntry

# Ver logs en tiempo real
firebase functions:log --follow
```

---

## 🔐 DEPLOY DE FIRESTORE RULES

### PASO 1: Validar sintaxis

```bash
# Firebase CLI valida automáticamente, pero puedes verificar:
firebase validate-firestore-rules

# Debería confirmar que no hay errores de sintaxis
```

### PASO 2: Preview Deploy (Recomendado)

```bash
# Ver qué cambios se harán (sin aplicar)
firebase deploy --only firestore:rules --dry-run

# Debería mostrar:
# - Cambios en email_verifications
# - Cambios en audit_logs
# - Cambios en platform_requests
```

### PASO 3: Deploy Definitivo

```bash
firebase deploy --only firestore:rules

# ✅ Si todo está bien:
# ✔ firestore.rules deployed successfully
```

### PASO 4: Verificar en Firebase Console

1. Abre https://console.firebase.google.com
2. Selecciona proyecto: **cronos-futbol-app**
3. Ve a **Firestore Database** → **Rules**
4. Verifica que las nuevas colecciones están protegidas:
   - `email_verifications`
   - `audit_logs`
   - `platform_requests`

---

## 🌐 DEPLOY DE WEB APP

### PASO 1: Compilar/Preparar assets (si aplica)

```bash
# Si tienes build script:
npm run build

# Si no hay build, salta a paso 2
```

### PASO 2: Deploy

```bash
firebase deploy --only hosting

# ⏳ Sube todos los archivos estáticos a Firebase Hosting
# Debería ver:
# ✔ hosted URL: https://cronos-futbol-app.web.app
```

---

## 📊 VERIFICACIÓN POST-DEPLOY

### 1️⃣ En Firebase Console

Abre https://console.firebase.google.com/project/cronos-futbol-app

**Cloud Functions:**
- ✅ Verifica que aparezcan estas funciones:
  ```
  - sendEmailVerification
  - verifyEmailCode
  - cleanupExpiredRegistrationRequests
  - deleteExpiredRequest
  - logAuditEntry
  - validateAndUpdatePlayerAction
  ```

**Firestore Collections:**
- ✅ Verifica que existan estas colecciones (aunque vacías):
  ```
  - email_verifications
  - audit_logs
  - platform_requests
  - match_audit_log
  ```

**Firestore Rules:**
- ✅ Ve a **Rules** y verifica que contienen:
  ```
  allow read, write: if isAuth() && request.auth.token.email == email;
  ```

### 2️⃣ En la App (Navegador)

Abre tu app: https://cronos-futbol-app.web.app (o tu dominio)

```javascript
// En consola:
window.runSprint3Tests()
```

Debería mostrar:
```
✅ Pasados: 10/10
✅ SPRINT 3 VERIFICACIÓN EXITOSA
```

### 3️⃣ Test de AuditLogger

```javascript
// En consola (durante un partido):
if (window.auditLogger && window.liveMatchId) {
  window.auditLogger.logPlayerAction(
    'test-p1',
    'Test Player',
    7,
    'goal',
    'goal_1',
    { goals: { before: 0, after: 1 } }
  );
  console.log('✅ Audit log enviado');
} else {
  console.warn('⚠️ AuditLogger o liveMatchId no disponibles');
}
```

Verifica en Firebase Console → Firestore → Collection `match_audit_log`:
- Debería haber un documento nuevo con `action: 'goal'`

### 4️⃣ Test de RenderOptimizer

Durante un partido en ejecución:

```javascript
// En consola:
if (window.renderOptimizer) {
  const stats = window.renderOptimizer.getStats();
  console.log('Render Stats:', stats);
  // Debería mostrar: { renders: N, avgMs: X.XX, lastRenderMs: Y.YY }
}
```

---

## 🐛 TROUBLESHOOTING

### ❌ Error: "Functions already deployed"
```bash
# Solución: Forzar update
firebase deploy --only functions --force
```

### ❌ Error: "Firestore Rules syntax error"
```bash
# Solución: Validar sintaxis localmente
firebase validate-firestore-rules

# Luego revisar el archivo:
cat firestore.rules | grep -A 5 "email_verifications"
```

### ❌ Cloud Functions no se ejecutan
```bash
# Verificar logs de error:
firebase functions:log --limit 50

# Si hay errores, revisar:
# 1. functions/index.js tiene sintaxis correcta
# 2. Dependencias en functions/package.json
```

### ❌ Audit logs no aparecen en Firestore
```javascript
// Verificar que se está llamando:
console.log('liveMatchId:', window.liveMatchId);
console.log('auditLogger:', window.auditLogger);

// Si liveMatchId falta, asegurar que el partido inició:
console.log('isRunning:', window.isRunning);
```

### ❌ Email verification no funciona
```bash
# Verificar que EMAIL_USER y EMAIL_PASS están configurados:
firebase functions:config:get

# Debería mostrar:
# {
#   email: { pass: "...", user: "..." }
# }

# Si falta, configurar:
firebase functions:config:set email.user="tu@email.com" email.pass="password"

# Luego redeploy:
firebase deploy --only functions
```

---

## 📝 CHECKLIST DE DEPLOYMENT

- [ ] ✅ Todos los tests pasan localmente (`window.runSprint3Tests()` → 10/10)
- [ ] ✅ Cloud Functions desplegadas sin errores
- [ ] ✅ Firestore Rules desplegadas sin errores
- [ ] ✅ Web App desplegada en Hosting
- [ ] ✅ Nuevas colecciones visibles en Firebase Console
- [ ] ✅ AuditLogger funciona (se crean docs en `match_audit_log`)
- [ ] ✅ RenderOptimizer activo (stats disponibles)
- [ ] ✅ Email verification configurado (opcional pero recomendado)
- [ ] ✅ No hay errores en Cloud Functions logs
- [ ] ✅ Prueba manual: crear partido, registrar acciones, verificar auditoría

---

## 🎯 PRÓXIMOS PASOS

Después de deployment exitoso:

1. **Sprint 4: Optimización UI/UX** (si aplica)
   - Mejorar interfaz del panel de auditoría
   - Agregar visualización de stats de render

2. **Sprint 5: Alertas y Notificaciones**
   - Notificar cuando se alcanza límite de expulsiones
   - Alertar sobre emails sin verificar

3. **Sprint 6: Analytics y Reporting**
   - Dashboard de uso de features
   - Reportes de auditoría

---

## 📞 SOPORTE

Si algo no funciona:

1. Revisar Firebase Console → Cloud Functions Logs
2. Ejecutar `firebase validate-firestore-rules`
3. Verificar `firebase functions:config:get`
4. Consultar logs: `firebase functions:log --follow`

---

**Fecha de Deploy:** 29-05-2026  
**Versión:** Sprint 3 - Auditoría, Email Verification, Cleanup & Render Optimization  
**Estado:** ✅ Listo para Production
