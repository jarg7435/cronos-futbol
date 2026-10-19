# ✅ Validación E2E y App Check — Chronos Fútbol

| | |
|---|---|
| **Fecha del informe** | 2026-10-19 |
| **Versiones** | E2E sobre v824–v828 (18-19 oct) · App Check medido con v830 en testeo y v828 en producción |
| **Validado por** | José Alberto Romero García (titular), con el asistente de desarrollo |
| **Datos** | sólo **ficticios**: dos clubes de prueba y cuentas `jarg7435+e2e…@gmail.com` |
| **Reproducir** | E2E: `node scripts/semilla_e2e_testeo.js --escribir` · App Check: `node scripts/ops/evidencia_appcheck.js` |

> Responde al punto 3 de la reauditoría del 19-10: «no hay evidencia en la entrega de
> una validación end-to-end reciente». Este documento la deja fechada, dice **dónde** se
> hizo cada prueba y también **lo que no se ha cubierto**.

---

## 1. Dónde se prueba, y por qué no en producción

- **Las pruebas E2E se hicieron en TESTEO** (`cronos-futbol-test`). Es un proyecto
  Firebase **aislado desde v761**: base de datos, Auth, Functions y App Check propios. Su
  configuración se elige por el nombre del host.
- **Testeo ejecuta lo mismo que producción:**
  - el mismo código;
  - el mismo `firestore.rules`;
  - las mismas 22 Cloud Functions (desplegadas en testeo el 18-10);
  - **App Check ENFORCED** en los mismos servicios desde el 19-10.
- **En producción no se hacen pruebas con datos.** Es una norma expresa del titular
  desde el 24-09, porque una prueba escribe en datos reales de clubes.
- **En producción se verificó la configuración** (Parte 3), con lecturas `GET` y una
  sonda que se rechaza. Además se comprobó que las reglas vivas coinciden con el repo
  (`scripts/lee_reglas_vivas.js`).

---

## 2. Pruebas E2E en testeo con dos clubes ficticios (18-19 oct 2026)

### Escenario

Lo siembra `scripts/semilla_e2e_testeo.js`, con cerrojo que aborta ante cualquier URL de
producción:

- **Clubes:** `club_test_e2e_norte` y `club_test_e2e_sur`.
- **Cuentas por club:** admin, director, dos entrenadores y familia.
- **Equipos:** Alevín A en los dos clubes, con la **misma plantilla y los mismos
  códigos** (ALA01-18). Es a propósito, para que un fallo de aislamiento se notase.
- **Familias:** aprobadas y sin vincular.
- **Extras:** vídeos y estadísticas activados.

### Comprobaciones previas por API (18-10)

| Comprobación | Resultado |
|---|---|
| Inicio de sesión de las 10 cuentas | ✅ |
| Un usuario de Norte lee datos de Sur (y al revés) | ✅ **403** |
| Una familia intenta crear su propio vínculo jugador-familia | ✅ **403** (regla v824) |
| Espejos `clubs_public` creados por la Function nueva | ✅ |

### Protocolo en navegador real

Cada resultado se **verificó en la base de datos**, no sólo en pantalla.

| # | Prueba | Resultado |
|---|---|---|
| **P1** | Alta de familia **sin teclear código** → «pendiente de asignación» → el entrenador asigna el jugador desde Contactos | ✅ Norte: ALA03 · Sur: ALA05. Cada vínculo, en su club |
| **P2** | Aislamiento entre clubes con códigos idénticos | ✅ Nadie ve el jugador del otro club |
| **P3** | Informe de partido a la familia: llega el suyo y sólo el suyo | ✅ Norte recibe 1 informe (su jugador). Sur recibe 0 |
| **P4** | Invitación por Secretaría → alta → **un solo uso** | ✅ Marcada `usedAt`/`usedBy`. Al reabrir el enlace ya no sirve |
| **P5** | **Revocación** de un usuario (entrenador 2 de Sur) | ✅ Pierde el acceso. Plaza liberada |
| **P6** | **Borrado y purga** (`archiveAndDeleteCoach`) | ✅ Cuenta eliminada de Auth y de `users`. Trabajo archivado en el club |

Esta ronda destapó dos defectos, ya corregidos y en producción:

- **v826:** en la primera visita a un navegador limpio, el alta salía vacía hasta
  recibir el primer token de App Check.
- **v827:** la invitación podía no quedar marcada como usada si la sesión se cerraba
  antes de confirmarse.

### Invitaciones caducadas, usadas y manipuladas

| Caso | Cómo está cubierto |
|---|---|
| **Usada** | P4 en navegador real |
| **Caducada** | 14 días por regla y por `CRONOS_INVITE_DIAS`. Guards `test_invitacion_token_opaco`, `test_invitacion_autocarga` |
| **Enlace antiguo con datos en la URL** | caducado el 2026-10-07 (v828). Verificado en Chrome real en testeo: no rellena nada y limpia la barra |
| **Manipulada** (cambiar correo, rol o club) | las reglas sólo dejan actualizar `usedAt`/`usedBy`. Probado contra el motor real de reglas (`:test` de la Rules API) en `test_invites_rules.js` |

---

## 3. App Check en Firebase real (medido el 2026-10-19)

Salida de `node scripts/ops/evidencia_appcheck.js` (sólo `GET`):

| | Producción `cronos-futbol-app` | Testeo `cronos-futbol-test` |
|---|---|---|
| Firestore | **ENFORCED** | **ENFORCED** |
| Auth (identitytoolkit) | **ENFORCED** | **ENFORCED** |
| Proveedor | reCAPTCHA v3 · umbral 0,5 · TTL 24 h | igual |
| Sonda anónima **sin** token | **403 PERMISSION_DENIED** ✅ | **403** ✅ |
| Verificaciones (12→19 oct) | **11 984 VALID → permitidas** · 2 INVALID → **denegadas** · 0 sin token permitidas | 19 715 VALID. Las «MISSING → ALLOW» son de antes de activar ENFORCED en testeo (19-10); después, DENY |
| Tokens de depuración | **ninguno** ✅ (retirado el 19-10, ver 3.1) | ninguno ✅ |
| Dominios autorizados de Auth | **sólo** `cronos-futbol-app.web.app` y `.firebaseapp.com` ✅ (ver 3.1) | incluye `localhost` (necesario para `npm run dev`) |

**Cliente válido aceptado y cliente sin token rechazado, en producción: demostrado.**
Las Functions sensibles comprueban App Check en el propio código; sin token responden
`FAILED_PRECONDITION`. Verificado tras desplegarlas el 19-10.

### 3.1 Dos restos de desarrollo en producción

- **Token de depuración `arnes-rest-local`.** Se creó en la v634 (agosto) para los
  scripts REST que validaban consultas cuando testeo compartía la base de datos de
  producción. Desde la v761 testeo está aislado y **nada del repositorio lo usa**.
  Quien tuviera su secreto podría saltarse App Check.
- **`localhost` en los dominios autorizados de Auth de producción.** En `localhost` la
  app usa la configuración de **testeo**, así que producción no lo necesita.

**Estado: ✅ RETIRADOS el 2026-10-19, con autorización expresa del titular.**

- Se borró el token (`DELETE …/debugTokens/…`).
- Se quitó `localhost` de `authorizedDomains` (`PATCH …/config?updateMask=authorizedDomains`).
- Antes de cambiar nada se guardó una copia del estado previo.
- Medición repetida justo después (18:26 UTC):
  - tokens de depuración: **ninguno**;
  - dominios: **sólo los dos de producción**;
  - sonda sin token: **403**;
  - la app responde con normalidad.

---

## 4. Lo que este informe NO cubre todavía

Se dice para no afirmar más de lo hecho. Son los puntos de la lista del auditor sin
prueba E2E fechada:

| Punto del auditor | Estado |
|---|---|
| Storage rechaza club, audiencia o uploader incorrectos | Cubierto por reglas y guards (`test_clips_video`, `scripts/ops/testeo_rol_storage_firestore.js`). **Sin E2E en navegador**: en P3 testeo no tenía clips |
| Partido completo con pérdida de red y recuperación | Cubierto por la batería (reloj, cola de sucesos, *replay*). **Sin prueba de campo continuada** con dispositivos reales |
| Restauración de Firestore y Auth desde copias externas | PITR y copia diaria activos. **Simulacro de restauración pendiente** (Fase 5) |
| Logs sin datos personales innecesarios | **Sin revisión formal** |
| Monitorización y alertas (App Check, errores, correo) | **Pendiente** (P1 de la reauditoría) |
| Pentest independiente | Fuera del alcance de este informe |
