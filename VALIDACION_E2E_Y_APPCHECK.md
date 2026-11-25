# ✅ Validación E2E y App Check — Chronos Fútbol

| | |
|---|---|
| **Fecha del informe** | 2026-10-19 · **re-medido el 2026-11-18** (ver 3.2) · última fila de §3.3: 2026-11-24 (v863) · §4 actualizado el 2026-11-24 |
| **Versiones** | E2E sobre v824–v828 (18-19 oct) · App Check medido con v830 en testeo y v828 en producción · re-medición con **v853** en los dos |
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
  - las mismas 23 Cloud Functions, incluida `syncPlazasAdultas`, desplegadas en testeo
    desde `HEAD` el 25-11 (paso P3 de `PENTEST_ALCANCE.md`, §1.4). Hasta ese día, testeo
    tenía 22 functions del 18/19-10;
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

### 3.2 Re-medición del 2026-11-18 (reauditoría del 17-11, punto P0-3)

El auditor pide repetir la sonda **después de cada despliegue** y archivarla junto a la
versión desplegada, porque la evidencia de 3.1 era del 19-10. Medido con las mismas
herramientas, sólo `GET`, sobre **v853** (commit `c86b940`) en producción y testeo,
**antes** del despliegue de la corrección de dependencias:

| | Producción `cronos-futbol-app` | Testeo `cronos-futbol-test` |
|---|---|---|
| Firestore | **ENFORCED** | **ENFORCED** |
| Auth (identitytoolkit) | **ENFORCED** | **ENFORCED** |
| Proveedor | reCAPTCHA v3 · umbral 0,5 · TTL 24 h | igual |
| Tokens de depuración | **ninguno** ✅ | ninguno ✅ |
| Dominios autorizados de Auth | sólo `.web.app` y `.firebaseapp.com` ✅ | incluye `localhost` (esperado, `npm run dev`) |
| Verificaciones (11→18 nov) | **9 124 VALID → permitidas**; ninguna sin token permitida | sin tráfico en la ventana |
| Sonda anónima **sin** token | **403 PERMISSION_DENIED** ✅ | **403** ✅ |
| `firestore.rules` vivas vs repo | **0 diferencias** (`scripts/lee_reglas_vivas.js`) | — |
| `storage.rules` vivas vs repo | **idénticas** (release del 2026-10-12) | idénticas |

### 3.3 Comprobación OBLIGATORIA tras cada despliegue a producción

Rellenar una fila por despliegue. Sin esta fila, el despliegue no se da por validado.

```
node scripts/ops/evidencia_appcheck.js          # ENFORCED ×2, 0 tokens debug, sonda 403
node scripts/lee_reglas_vivas.js firestore.rules # 0 diferencias de código
```

| Fecha | Versión · commit | Qué se desplegó | Firestore / Auth | Sonda sin token | Reglas = repo |
|---|---|---|---|---|---|
| 2026-11-18 | v853 · `c86b940` (antes de desplegar) | — (medición de partida) | ENFORCED / ENFORCED | 403 ✅ | ✅ |
| 2026-11-18 23:33 UTC | v853 · `6460a1e` (fast-xml-parser 5.12.1) · paquete `cronos-futbol_6460a1e.zip` sha256 `19dd829e…2051d2` | hosting + 22 functions | ENFORCED / ENFORCED · 0 tokens debug | 403 ✅ (1 `MISSING_UNKNOWN_ORIGIN` → DENY = la propia sonda) | ✅ Firestore 0 dif. · Storage idénticas |
| 2026-11-22 18:36 UTC (despliegue del 20-11, fila que faltaba) | v856 · `c4b61c6` (v854-v856) · paquete `cronos-futbol_c4b61c6.zip` sha256 `d1df562d…7c7d8e5e` (`package:verificar` desde cero ✅: 581 ficheros idénticos, `npm ci` + build 9/9 + lint 0 + 359/359) | hosting (backend sin cambios desde `6460a1e`: `functions/`, reglas, índices y lockfiles con 0 diferencias) | ENFORCED / ENFORCED · 0 tokens debug · dominios sólo `.web.app`/`.firebaseapp.com` | 403 ✅ · 15→22 nov: 17 232 `VALID` → ALLOW, 4 `MISSING_UNKNOWN_ORIGIN` → DENY | ✅ Firestore 0 dif. · Storage idénticas (release 12-10, prod y testeo) · hosting `index.html`/`live.html`/`sw.js` = repo por sha256 |
| 2026-11-22 22:25 UTC | v857 · `2f07ece` (consola del navegador sin datos personales) + `145edb6` (índice `slot_requests`) | **índices** (`firestore:indexes`, sin `--force`: los 2 *field overrides* son los TTL de `cronos_clips`/`vistas`, siguen ACTIVE; índice nuevo READY 22:02) + **hosting** v857. Sin cambios en reglas ni functions | ENFORCED / ENFORCED · 0 tokens debug | 403 ✅ · 15→22 nov: 17 885 `VALID` → ALLOW, 5 `MISSING_UNKNOWN_ORIGIN` → DENY | ✅ Firestore 0 dif. · 34 índices = repo · hosting `index.html`, `live.html`, `sw.js` y los 3 JS tocados = repo por sha256 (sello v857) |
| 2026-11-22 22:48 UTC | v858 · `storage.rules` con `resource == null` en la regla de crear (caso N10 del E2E de Storage: sobrescribir un clip se aceptaba) | **reglas de Storage** (`firebase deploy --only storage`), antes en testeo y probadas con el E2E real (`scripts/ops/e2e_storage_testeo.js`: N10 → 403, P1 → 200). Sin cambios en hosting, Firestore ni functions | ENFORCED / ENFORCED · 0 tokens debug | 403 ✅ | ✅ Firestore 0 dif. · **Storage vivas = repo en producción y testeo** (releases del 22-11) |
| 2026-11-22 (noche) | v859 · `platform_requests`: leer y modificar sólo SA, Dirección del club/ente (`isAdminOfClub`) y el interesado; la propia nace `pending*` | **reglas de Firestore** (`deploy:prod:rules`), antes en testeo: prueba real 16/16 (6 agujeros → 403, 4 controles, 6 flujos legítimos → 200) y guard `test_platform_requests_rules` 26/26 (rojo 19/26 contra la anterior). `verify` 360/360. Los 3 `club_admin` y el ente de producción tienen sus claims (`role` + `clubId`) | ENFORCED / ENFORCED · 0 tokens debug | 403 ✅ | ✅ Firestore 0 dif. tras el despliegue |
| 2026-11-22 23:56 UTC | v860 · `32cd2ae` · compartir clips con familias exige `clubs/{id}.plazasAdultas` (N5 del E2E de Storage) | **hosting** v860 → **reglas de Firestore** (`deploy:prod:rules`) + **reglas de Storage** (`--only storage`) → **carga de la lista** (`scripts/ops/plazas_adultas_club.js --escribir`, 2 cuentas aprobadas por el titular: CD ARINAGA y CD DÍA, 1 uid cada uno; resto del documento del club intacto). Antes en testeo: E2E real 18/18, guard 99/99 (rojo 96/99 con las reglas anteriores), `verify` 360/360 | ENFORCED / ENFORCED · 0 tokens debug | 403 ✅ | ✅ Firestore 0 dif. · Storage vivas = repo (prod y testeo) · hosting `index.html`, `live.html`, `sw.js` y los 3 JS tocados = repo por sha256 (sello v860) |
| 2026-11-23 00:23 UTC | v861 · `81aebe6` · function `syncPlazasAdultas` (fase 2 de N5) en **MODO SOMBRA** | **una function nueva** (`deploy:prod:function -- functions:syncPlazasAdultas`): 2ª gen, Node 22, `europe-west1`, disparador `firestore.document.v1.written.withAuthContext` sobre `users/{uid}` (región `eur3`). Primer intento rechazado por la propagación del permiso de Eventarc (primera function de 2ª gen del proyecto); el reintento a los 4 min, correcto. `cronos_config/plazasAdultasSync` NO existe → sólo registra. Política de limpieza de imágenes en `europe-west1` **configurada el 23-11** (`functions:artifacts:setpolicy --location europe-west1 --days 1`: borra imágenes de más de 1 día, igual que `us-central1`). Guard 36/36, `verify` 361/361 | — (no se tocaron hosting ni reglas) | — | ✅ 23 functions ACTIVE en producción |
| 2026-11-24 ~15:10 UTC | v863 · `2825a9b` (v862 `1400ed5` + v863) · segundo factor TOTP del SuperAdmin, **código inerte** hasta activar Identity Platform en producción | **hosting** (`deploy:prod`, paso 1 de `PROPUESTA_MFA_SA.md` §5): 8 ficheros nuevos (`mfa.js` y las ramas en `auth.js`, `password.js`, `diagnostico.js`, `firebase-init.js`, `live.html`; `index.html` y `sw.js` con el sello y `cronos-cache-v863`). Sin cambios en reglas, functions ni Auth (Identity Platform **sin activar** en producción). Antes en testeo: T1–T7 (`9894650`, `6cc2de9`), guard `test_mfa_superadmin` 45/45, `verify` 361/362 (el que falló, `test_ocultar_coordinador_rules`, fue un `ECONNRESET` de red y dio 14/14 al repetirlo). Prueba del titular en producción con sello v863: el SA entra **sin** código y otra cuenta entra normal | ENFORCED / ENFORCED · 0 tokens debug · dominios sólo `.web.app`/`.firebaseapp.com` | 403 ✅ · 17→24 nov: 18 182 `VALID` → ALLOW, 2 `INVALID` → DENY, 9 `MISSING_UNKNOWN_ORIGIN` → DENY (medido 22:14 UTC) | ✅ Firestore 0 dif. · hosting `index.html`, `live.html`, `sw.js` y los 5 JS tocados = repo por sha256 (sello v863) |
| 2026-11-24 23:17 UTC | v863 · `2f3f968` (sin código nuevo) · **segundo factor TOTP del SuperAdmin ACTIVO en producción** (pasos 2 y 3 de `PROPUESTA_MFA_SA.md` §5) | **Auth, no código**: 2a.2 el titular pasó `cronos-futbol-app` a **Identity Platform** en la consola, con SMS inhabilitado (irreversible; la configuración leída antes y después solo difiere en `subtype FIREBASE_AUTH → IDENTITY_PLATFORM`) → 2b ~23:00 UTC `PATCH config?updateMask=mfa` comprobando antes el estado (HTTP 200; solo cambia `mfa.providerConfigs: [{TOTP ENABLED, adjacentIntervals 5}]`, `mfa.state` sigue `DISABLED` = sin SMS) → 3: el titular dio de alta el factor «Móvil» TOTP a las 23:10:38 UTC, con la **misma clave en 2 aparatos** (lectura en seco con `mfa_quitar_factor.js --proyecto prod`: 1 factor), y probó en producción, con resultado correcto según él: entrar desde cero con cada aparato, código malo y Cancelar, `live.html`, cambio de contraseña con reautenticación, clave maestra de Diagnóstico y otra cuenta que entra sin código. Facturación Blaze, tramo gratuito hasta 49 999 MAU, TOTP sin SMS: coste 0 €. Deshacer 2b = el mismo PATCH con `DISABLED`. Sin cambios en hosting, reglas ni functions | ENFORCED / ENFORCED · 0 tokens debug · dominios sólo `.web.app`/`.firebaseapp.com` | 403 ✅ · 17→24 nov: 18 395 `VALID` → ALLOW, 2 `INVALID` → DENY, 10 `MISSING_UNKNOWN_ORIGIN` → DENY | ✅ Firestore 0 dif. · configuración de Auth tras el alta = la de 2b (0 dif.) |

---

## 4. Estado de los puntos del auditor (actualizado el 2026-11-24)

Se dice para no afirmar más de lo hecho. Puntos de la reauditoría del 19-11, con lo que
está hecho y lo que sigue abierto:

| Punto del auditor | Estado |
|---|---|
| Storage rechaza club, audiencia o uploader incorrectos | ✅ **E2E real en testeo (22-11)**: `scripts/ops/e2e_storage_testeo.js` hace peticiones reales a Storage y Firestore con cuentas de los clubes E2E y un token temporal de App Check, que se borra al terminar. La primera pasada encontró dos agujeros: **N10**, sobrescribir un clip (cerrado en v858), y **N5**, compartir con familias sin estar en `plazasAdultas` (cerrado en v860). Resultado final: **18/18** (filas v858 y v860 de §3.3). Lo mantienen los guards `test_clips_video` (99/99) y `testeo_rol_storage_firestore.js`. No se ha repetido a través de la interfaz con clips grabados en un aparato |
| Partido completo con pérdida de red y recuperación | Cubierto por la batería (reloj, cola de sucesos, *replay*). Guion de prueba de campo escrito en `PRUEBA_PERDIDA_RED.md` (`daeb97f`). ⏳ **Falta ejecutarlo** en iPad y móvil reales |
| Restauración de Firestore y Auth desde copias externas | ✅ **Primer simulacro hecho el 22-11** (`RECUPERACION.md`, registro de simulacros): 47/47 colecciones idénticas, uids de `users` que casan con Auth 9/10 y claims 8/10, con los huérfanos explicados; RTO unos 14 min, sin contar el volcado a `(default)` ni la reimportación de Auth. Se repite cada seis meses; `npm run backup:estado` avisa. ⏳ Qué hace `auth:export/import` con el factor TOTP del SuperAdmin está **sin medir** (`RECUPERACION.md` 7.4) |
| Logs sin datos personales innecesarios | ✅ **Backend (v848)**: 66 llamadas de `functions/` revisadas; correo enmascarado, sin URL con token y error SMTP filtrado (`test_logs_sin_pii.js`). ✅ **Consola del navegador (v857, en producción el 22-11)**: 638 llamadas `console.*` revisadas y 6 fugas corregidas (`test_consola_sin_pii.js`). ✅ **Retención de Cloud Logging** fijada en **180 días** desde el 22-11 (`RECUPERACION.md` Parte 6) |
| Monitorización y alertas (App Check, errores, correo) | ✅ **Alertas A1–A5 activas en producción desde el 22-11** (`RECUPERACION.md` Parte 6): A1 purga o borrado incompletos, A2 fallo de correo, A3 errores de functions, A4 rechazos de App Check (más de 50 por hora), A5 disponibilidad de la web. Avisan por correo al titular; probadas en testeo y, en producción, con líneas `[PRUEBA]`. No cubren, por decisión documentada allí: el fallo de la copia diaria (lo cubre un recordatorio semanal), los intentos repetidos de inicio de sesión y el gasto anómalo (⏳ alerta de presupuesto pendiente) |
| Pentest independiente | Alcance escrito en `PENTEST_ALCANCE.md` (sólo testeo). P1 a P4 hechos (functions de testeo iguales a `HEAD` desde el 25-11); ⏳ P5–P8 y la elección del proveedor, pendientes de decisión del titular |
| Segundo factor del SuperAdmin (no estaba en la lista; se añade) | ✅ TOTP activo en testeo y producción (24-11, `PROPUESTA_MFA_SA.md`, fila de §3.3). ⏳ Fase 2 (exigir el factor en reglas y functions), sin decidir |
