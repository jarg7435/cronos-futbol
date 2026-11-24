# 🚨 Registro de incidentes y brechas — Chronos Fútbol

Registro de **todos** los incidentes de seguridad y de las brechas de datos personales,
se notifiquen o no (RGPD art. 33.5: el responsable documenta cualquier violación, sus
efectos y las medidas adoptadas). Chronos actúa como **encargado** de los clubes, que
son los responsables (`encargo.html`, `PROTECCION_DATOS.md` Parte 8).

> 🔒 **Este fichero NO lleva datos personales**: ni correos, ni nombres, ni uids
> completos. Se identifica a las personas afectadas por número y rol («10 cuentas;
> 7 de staff, 3 familiares»). El detalle nominal, si hace falta, va fuera del proyecto
> (`CRONOS_RESPALDOS_PRIVADOS`).

---

## 1 · Qué se registra

| Tipo | Ejemplos | ¿Brecha RGPD? |
|---|---|---|
| **Confidencialidad** | datos publicados o accesibles a quien no debía, cuenta comprometida, regla que deja leer a otro club | ✅ sí |
| **Integridad** | datos personales alterados o recreados sin querer (script, despliegue, regla) | ✅ sí, si afecta a datos personales |
| **Disponibilidad** | la app o los datos no accesibles; pérdida y restauración | ✅ sí, si hay pérdida o indisponibilidad relevante de datos personales |
| **Seguridad sin datos personales** | caída de una función, abuso bloqueado por App Check | ❌ se registra igual, como incidente |

## 2 · Plazos

| Quién | A quién | Plazo | Cuándo |
|---|---|---|---|
| Chronos (encargado) | cada **club** afectado | **48 h** desde que se conoce | siempre que haya brecha con datos de ese club |
| Club (responsable) | **AEPD** | **72 h** | salvo que sea improbable que suponga un riesgo |
| Club (responsable) | **personas afectadas** | sin dilación indebida | si el riesgo es **alto** (art. 34) |

Chronos asiste al club para la notificación (`encargo.html` §4), pero **no la decide
por él**.

## 3 · Procedimiento (en este orden)

1. **Contener sin destruir el rastro**: revocar sesiones o tokens, cerrar la regla y
   retirar lo publicado. **No borrar logs** ni «arreglar» escribiendo encima (ver
   `RECUPERACION.md` Parte 4).
2. **Fijar los hechos**: desde cuándo, hasta cuándo, qué datos, cuántas personas y de
   qué clubes. **Medido**, no supuesto: Cloud Logging, `audit_logs`, PITR (`readTime`),
   historial de publicaciones del hosting.
3. **Valorar el riesgo**: tipo de dato (¿menores?, ¿credenciales?, ¿salud?), si estaba
   cifrado o hasheado, si consta acceso real y qué podría hacer quien lo obtuviera.
4. **Avisar a los clubes en 48 h**, si hay brecha con sus datos.
5. **Abrir la ficha** en este registro (plantilla, §4) el mismo día, aunque esté
   incompleta.
6. **Corregir la causa** y añadir un guard que lo habría detectado.
7. **Cerrar la ficha**: medidas, decisión de notificación motivada y lecciones.

## 4 · Plantilla de ficha

Copiar debajo del último registro y rellenar.

### INC-AAAA-NNN · título corto

| Campo | Valor |
|---|---|
| Detectado | fecha y hora · quién o cómo |
| Periodo afectado | desde … hasta … (o «desconocido», y por qué) |
| Tipo | confidencialidad / integridad / disponibilidad / sin datos personales |
| Datos afectados | categorías (¿menores?, ¿credenciales?, ¿salud?) |
| Personas afectadas | número y rol, sin nombres · clubes afectados |
| Acceso real constatado | sí / no / no se puede saber (fuente) |
| Contención | qué, cuándo |
| Valoración de riesgo | improbable / riesgo / alto, motivado |
| Aviso a clubes (48 h) | fecha / no procede, motivo |
| Notificación AEPD (72 h) | decisión del club: fecha / no procede, motivo |
| Comunicación a afectados | fecha / no procede, motivo |
| Causa | |
| Corrección y guard | commit, test |
| Estado | abierta / cerrada (fecha) |

---

## 5 · Registro

### INC-2026-001 · Una versión recreó dos plazas retiradas a un usuario

| Campo | Valor |
|---|---|
| Detectado | 2026-09-24 · revisión del autor tras desplegar v758 en testeo |
| Periodo afectado | una noche (01:35 → reparación el mismo día) |
| Tipo | **integridad** (roles de un usuario) |
| Datos afectados | dos plazas (rol y categoría) del perfil de un administrador de club; sin datos de menores |
| Personas afectadas | 1 · un club (de pruebas) |
| Acceso real constatado | no aplica (sin exposición). Alcance medido en sólo lectura: 3 documentos escritos esa noche, ningún otro club |
| Contención | testeo devuelto a v757 |
| Valoración de riesgo | **improbable**: sin exposición, un solo usuario, reparado con PITR |
| Aviso a clubes / AEPD / afectados | no procede (motivo anterior) |
| Causa | arreglar un error que abortaba un bloque reactivó una rama que recreaba plazas; testeo escribía entonces en la base de producción |
| Corrección y guard | reparación con precondición `updateTime` = estado del PITR del 23-09 · v759 · `test_solicitud_no_resucita_plaza.js` · testeo aislado desde v761 |
| Estado | **cerrada** 2026-09-24 |

### INC-2026-002 · Respaldos publicados en el hosting (producción y testeo)

| Campo | Valor |
|---|---|
| Detectado | 2026-10-02 · revisión a raíz de la auditoría externa del 30-09 |
| Periodo afectado | **Exportación de Auth** (lo sensible): **producción del 2026-09-22 22:59 UTC al 2026-10-02 15:32 UTC** (~9,7 días); testeo del 2026-09-23 09:56 UTC al 2026-10-02. **Resto de respaldos** (documentos de usuario, solicitudes, partidos en vivo) y un fichero de configuración local: en testeo, **al menos desde el 2026-08-07** (versión más antigua que conserva el hosting); en producción, sin historial de versiones anterior al 11-11 (sólo guarda las 5 últimas), pero todo despliegue publicaba la carpeta entera, así que se presume la misma época |
| Cómo se ha fechado | historial del hosting medido el 2026-11-22 en sólo lectura: en testeo, ficheros de las 407 versiones conservadas; en producción, el recuento de ficheros de cada publicación (1 410 desde el 12-04): pasa de 142 a **143** en el despliegue de las 22:59 del 22-09, 48 min después de crearse la exportación (`auth_users_2026-09-22-22-11-56`, hora UTC), y de 146 a **140** el 02-10 al retirar los 6 ficheros |
| Tipo | **confidencialidad** |
| Datos afectados | exportación de Firebase Auth: **correo y hash de contraseña** de 10 cuentas (scrypt modificado de Firebase, con sal; la clave de firma del proyecto, necesaria para verificar un hash, **no** viaja en la exportación ni estaba publicada); respaldos de documentos de perfil y de solicitudes; `.claude/settings.local.json` (permisos de una herramienta local; revisado el 2026-11-22: **sin claves ni tokens**) |
| Personas afectadas | **10 cuentas**, de 3 clubes o entes distintos (según sus claims): 1 SuperAdmin, 1 administrador de club, 2 entes individuales, 3 usuarios de club (entrenador o familia según su plaza), 1 cuenta familiar sin perfil y 2 cuentas de prueba (`@ejemplo.invalid`, borradas el 2026-11-22). De las 10, **6 siguen existiendo** hoy |
| Acceso real constatado | ⏳ **no se puede saber**: no se revisaron los logs de acceso del hosting a tiempo |
| Contención | 2026-10-02: hosting redesplegado en los dos sitios sin esas rutas (verificado: devuelven `index.html`); respaldos movidos fuera del proyecto (`CRONOS_RESPALDOS_PRIVADOS`); `exporta_auth.js` aborta si el destino cae dentro |
| Valoración de riesgo | ⏳ **pendiente del titular** (ver nota) |
| Aviso a clubes (48 h) | ⏳ pendiente del titular |
| Notificación AEPD (72 h) | ⏳ decisión del club o clubes afectados, con asistencia de Chronos |
| Comunicación a afectados | ⏳ pendiente del titular |
| Mitigación adicional | ⏳ pendiente del titular (p. ej. forzar el cambio de contraseña de las 6 cuentas que siguen activas) |
| Causa | `firebase.json` publica la carpeta entera (`"public": "."`) y no excluía `backups/` ni `.claude/`; `.gitignore` sólo protegía de git |
| Corrección y guard | v780 · `test_artefacto_limpio.js` (mide lo que publica el hosting con la lista real de firebase-tools) · `npm run package:verificar` |
| Estado | **abierta**: contenida; faltan la valoración de riesgo y las decisiones de notificación y mitigación |

> **Nota para cerrarla.** Factores que **reducen** el riesgo: contraseñas hasheadas con
> sal y con una clave del proyecto que no se expuso; ningún dato de menores en la
> exportación de Auth; ventana de ~10 días para lo sensible. Factores que **no lo
> eliminan**: los correos quedaron expuestos (posible *phishing* dirigido), no se puede
> descartar el acceso y los respaldos de perfiles pudieron estar publicados más tiempo.
> La decisión (notificar o no, y forzar o no el cambio de contraseña) corresponde al
> titular y a los clubes responsables, a ser posible con su asesor. Una notificación
> fuera de plazo es posible si se motiva el retraso.

### INC-2026-003 · La app se congelaba al abrir un partido (v730)

| Campo | Valor |
|---|---|
| Detectado | 2026-09-17 · aviso de un club |
| Periodo afectado | ~1 h en producción |
| Tipo | **disponibilidad**, sin pérdida ni exposición de datos |
| Personas afectadas | entrenadores de clubes reales que abrieron un partido en esa hora |
| Valoración de riesgo | sin riesgo para datos personales |
| Aviso / notificación | no procede |
| Causa | `confirmSetup()` se llamaba a sí misma (bandera de reentrada liberada antes de tiempo) |
| Corrección y guard | v732 (hotfix) · guard que ejecuta la función y cuenta las pasadas |
| Estado | **cerrada** 2026-09-17 |

### INC-2026-004 · Solicitudes de alta legibles y modificables por cualquier miembro del club

| Campo | Valor |
|---|---|
| Detectado | 2026-11-22 · análisis en sólo lectura de las reglas de `platform_requests` a raíz del E2E de Storage (caso N5), confirmado con una **prueba real en testeo** con cuentas ficticias |
| Periodo afectado | **al menos desde el 2026-08-04** (la regla ya estaba así en la reorganización v435-v438; con este texto exacto desde v687, 10-09) **hasta el 2026-11-22**, corrección v859 desplegada en producción. Clubes reales en producción desde mediados de septiembre |
| Tipo | **confidencialidad** e **integridad** (vulnerabilidad de reglas; no consta explotación) |
| Qué permitía | Dentro de un mismo club o ente, **cualquier miembro autorizado —familias incluidas—** podía: **leer** todas las solicitudes de alta del club, y **crear** la suya ya aprobada, **aprobarse** la propia, **rechazar o modificar** la de otros (rol, categoría). Entre clubes distintos sí estaba aislado |
| Datos afectados | correo y nombre de quienes pidieron el alta (entrenadores, directivos, familias), club y rol pedido. **Medido en producción el 22-11: 29 solicitudes de 7 clubes/entes, todas con correo o nombre; ninguna con alias de jugador** (no había nombres de menores en esta colección) |
| Personas afectadas | quienes figuran en esas 29 solicitudes, sin nombres aquí · 7 clubes/entes |
| Acceso real constatado | **Lectura: no se puede saber** (los registros de acceso a datos de Firestore están desactivados, decisión de la Parte 6 de `RECUPERACION.md`). **Integridad: revisado el 2026-11-22, sin anomalías**: las 21 solicitudes aprobadas de producción las aprobó el SuperAdmin; ninguna se autoaprobó; las 20 reenviadas lo fueron por la Dirección de su club; ninguna se modificó después de aprobarse; y en las 15 cuentas que siguen existiendo el rol aprobado coincide con el que tienen |
| Alcance de la parte de integridad | una solicitud falsamente aprobada hacía que la **sesión** mostrara el panel de ese rol (`auth.js` la usaba como rol verificado), pero los **datos** los siguen protegiendo las reglas por el perfil raíz y los claims: no daba acceso a datos que el miembro no pudiera ya leer. Riesgo de ingeniería social ante el SuperAdmin |
| Contención | 2026-11-22: reglas v859 en testeo (prueba real 16/16) y en producción (`deploy:prod:rules`, vivas = repo) |
| Valoración de riesgo | ⏳ **pendiente del titular**. Propuesta: **bajo** — datos de contacto de adultos visibles sólo para miembros autorizados del mismo club, sin datos de menores ni credenciales, y sin indicios de uso |
| Aviso a clubes (48 h) | ⏳ pendiente del titular (si la valoración es «improbable que suponga un riesgo», no procede, pero se deja motivado aquí) |
| Notificación AEPD (72 h) | ⏳ decisión de los clubes responsables, con asistencia de Chronos |
| Comunicación a afectados | ⏳ pendiente del titular |
| Causa | las reglas usaban `sameClubAsDoc` («es del mismo club») para leer y modificar, pensando en la Dirección; el código daba por hecho que el estado «sólo lo escribe el SA» (comentario de `auth.js`), y no era así |
| Corrección y guard | v859 · `firestore.rules` (leer y modificar: SA, Dirección del club/ente e interesado; la propia nace `pending*`) · `test_platform_requests_rules.js` parte 3 (rojo 19/26 con la regla anterior, 26/26 ahora) · commit `99c5e54` · fila en `VALIDACION_E2E_Y_APPCHECK.md` §3.3 |
| Estado | **abierta**: corregida; faltan la valoración de riesgo y la decisión de aviso del titular |

### INC-2026-005 · Retirada planificada del segundo factor del SuperAdmin (testeo)

| Campo | Valor |
|---|---|
| Detectado | 2026-11-24 · operación **planificada**, no un incidente sobrevenido. Se registra porque `scripts/ops/mfa_quitar_factor.js` exige anotar cada retirada de factor |
| Periodo afectado | desde la retirada del factor «Móvil» anterior (**2026-11-24 hacia las 01:40 UTC**, paso 3 de testeo) hasta el **2026-11-24 13:28:38 UTC**, alta del nuevo (~11 h 50 min). En ese intervalo la cuenta SA **de testeo** sólo estaba protegida por la contraseña |
| Tipo | **sin datos personales** (cambio de configuración de seguridad de una cuenta) |
| Datos afectados | ninguno. Se retiró un factor TOTP; el secreto no se expone en ningún momento (el script sólo muestra nombre y fecha) |
| Personas afectadas | 1 cuenta (SuperAdmin), sólo en `cronos-futbol-test` · ningún club. **Producción sin tocar** |
| Acceso real constatado | no aplica |
| Contención | retirada con `mfa_quitar_factor.js --proyecto test --quitar`; factor nuevo dado de alta por el titular el 2026-11-24 13:28 UTC; comprobado en sólo lectura (13:35 UTC) con el mismo script en seco: **1 factor «Móvil» TOTP** |
| Valoración de riesgo | **improbable**: proyecto de testeo sin datos reales y cuenta protegida por contraseña durante el intervalo |
| Aviso a clubes / AEPD / afectados | no procede (motivo anterior) |
| Causa | Firebase sólo admite **un factor TOTP por cuenta** (`auth/maximum-second-factor-count-exceeded` al añadir el segundo aparato). El titular eligió guardar la **misma clave secreta en dos aparatos**, lo que obliga a retirar el factor y darlo de alta otra vez para cargar la clave en los dos |
| Corrección y guard | v863 (avisos del alta en `js/services/auth/mfa.js`) · `test_mfa_superadmin.js` A13-A13c · commit `2825a9b` |
| Estado | **cerrada** 2026-11-24 |
