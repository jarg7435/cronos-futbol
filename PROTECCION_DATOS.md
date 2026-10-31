# 🛡️ Protección de datos — Chronos Fútbol

| | |
|---|---|
| **Versión** | **2.0 — vigente** |
| **Fecha** | 2026-10-19 · app v830 |
| **Aprobada por** | José Alberto Romero García, titular de la plataforma |
| **Sustituye a** | Borrador técnico v1 (2026-09-22, app v752) |
| **Documentos públicos alineados** | `privacy.html` v2.0 · `encargo.html` v1.0 (Contrato de Encargado, art. 28) |

> **Qué es este documento.** Es el registro **interno** de cómo trata datos personales
> Chronos Fútbol, medido sobre el código y la base de datos reales. No se publica:
> `firebase.json` excluye los `*.md` de Hosting. Lo que se informa al público está en
> `privacy.html`, y lo que se acepta con cada club en `encargo.html`. **Los tres dicen
> lo mismo**, y `scripts/test_politica_alineada.js` (parte 6) corta si dejan de
> coincidir.
>
> Lo que **no** sustituye: una revisión jurídica externa. Se recomienda que un asesor
> revise `encargo.html` y la DPIA (Parte 9) antes de una operación comercial estable.

---

## Parte 0 · Estado de las discrepancias del borrador v1

En el borrador del 22-09 se midieron cuatro promesas de `privacy.html` que el código
no cumplía. **Las cuatro están cerradas:**

| # | Discrepancia (2026-09-22) | Estado |
|---|---|---|
| **1** | Borrado «en 30 días» con un `deleteUserData` que borraba dos cosas | ✅ v754b: purga en cascada (`functions/purga_usuario.js`), probada en producción; §6.1 de la política describe borrar / anonimizar / conservar |
| **2** | «Servidores en la UE» con Functions en `us-central1` | ✅ La política lo dice: almacenamiento en `eur3`, procesamiento en EE. UU. con garantías |
| **3** | Menores «sin ningún dato identificativo adicional» | ✅ §10 enumera dorsal, posición, asistencia con causa genérica e informes de texto libre |
| **4** | Responsable «a solicitud» | ✅ El encargado se identifica en la política (§1.2) y en el contrato |

---

## Parte 1 · Quién es quién (modelo vigente)

**Decidido por el titular el 2026-10-19.** Es el modelo habitual de una plataforma
que presta servicio a clubes:

- **Cada club o ente individual = RESPONSABLE del tratamiento.** Decide inscribir a
  sus jugadores, qué datos registra, qué informes elabora y a quién los envía.
- **Chronos Fútbol (el titular) = ENCARGADO del tratamiento** (art. 28 RGPD). Trata
  los datos por cuenta del club, sólo con sus instrucciones.
- **Google (Firebase / Google Cloud) y el proveedor SMTP = SUBENCARGADOS**, con
  autorización general del club en el contrato.

**Chronos es responsable propio sólo de** la relación con cada club (alta, contacto de
su administrador, facturación) y de la seguridad de la plataforma (auditoría,
antiabuso). No usa los datos de los clubes para fines propios. Si algún día lo hiciera,
por ejemplo con estadísticas agregadas, en esa parte sería responsable y habría que
decirlo antes de hacerlo.

### Cómo se formaliza

- **Contrato de Encargado: `encargo.html` (v1.0).** Recoge las cláusulas del art. 28.3:
  - instrucciones;
  - confidencialidad;
  - seguridad;
  - subencargados;
  - derechos (traslado en 5 días hábiles);
  - brechas (aviso al club en 48 h);
  - asistencia;
  - fin del contrato;
  - auditoría.
- **Aceptación en el alta.** Quien registra un club (`club_admin`) o un ente
  (`individual`) debe marcar `#dpa-consent`. Sin marcarla, `doAuth` no deja continuar.
  Queda registrado en `users/{uid}`:
  - `dpaAccepted`;
  - `dpaAcceptedAt`, la hora del servidor;
  - `dpaVersion`.
- **Política para todos los usuarios.** Cada usuario acepta `privacy.html`. Se guardan
  `gdprConsent`, `gdprConsentDate` y `gdprConsentVersion`.
- **Versiones.** `CRONOS_PRIVACY_VERSION` y `CRONOS_DPA_VERSION` en
  `js/services/auth.js`. Se suben si el texto cambia de forma sustancial.

⚠️ **Los clubes dados de alta antes del 19-10-2026 no han aceptado el contrato en la
app.** Hay que recabarlo, por correo o con una aceptación en el primer acceso. Ver
Parte 10.

---

## Parte 2 · Registro de actividades de tratamiento (por cuenta de los clubes)

Inventario real: **40 colecciones raíz + 7 subcolecciones**, en `cronos-futbol-app`,
base `(default)`, región **`eur3`**.

### 2.1 · Contienen datos personales de MENORES

| Colección | Qué guarda | Categoría |
|---|---|---|
| `players` | nombre/alias, dorsal, posición | Identificativo + deportivo |
| `cronos_player_reports` | informes individuales y colectivos, **texto libre** | Deportivo + 🟠 riesgo art. 9 (mitigado, Parte 3) |
| `clubs/*/attendance`, `attendance_players` | asistencia, faltas y causa genérica (`medico`) | 🟠 rozando salud, sin diagnóstico |
| `clubs/*/team_rosters`, `team_archives` | plantillas por equipo | Identificativo |
| `cronos_player_links` | vínculo jugador ↔ familiar | Relación familiar |
| `matches`, `substitutions`, `events`, `formations` | minutos, cambios, sucesos | Deportivo |
| `live_matches`, `live_index`, `finished_index` | lo mismo, en vivo | Deportivo (efímero) |
| `pseudonym_map` | correspondencia seudónimo ↔ persona | 🔴 reidentificación |

### 2.2 · Datos personales de ADULTOS

| Colección | Qué guarda |
|---|---|
| `users` | correo, nombre, rol, club, plazas (`allRoles`), aceptaciones legales |
| `clubs`, `individuals` | nombre de la entidad, `adminEmail`, `adminUid` |
| `invites` | correo del invitado, rol, club, caducidad (token opaco, 14 días, un uso) |
| `cronos_messages`, `cronos_staff_messages`, `cronos_staff_threads`, `cronos_staff_channel` | contenido de conversaciones |
| `platform_requests`, `slot_requests`, `succession_requests`, `deletion_requests` | solicitudes de alta y baja |
| `billing_invoices`, `billing_subscriptions`, `billing_plans` | facturación *(Chronos responsable)* |
| `push_tokens` | identificador de dispositivo |
| `audit_logs`, `error_logs`, `auth_deletion_failures` | rastro de acciones y fallos *(Chronos responsable: seguridad)* |
| `cronos_role_sessions` | sesión activa por plaza |
| `users/*/cronos_data`, `users/*/sa_privado` | datos privados, incluido el motivo de una baja |

### 2.3 · Sin datos personales (o derivados públicos)

`clubs_public` (nombre, tipo, estado, `hasAdmin`), `config`, `cronos_config`,
`cronos_email_config`, `trainingPlans` y sus `weeks`, `notifications`, `offline_events`,
`teams`.

---

## Parte 3 · Menores

### Lo que está hecho

- **No existe la causa «enfermedad».** Ver `js/coach/attendance/attendance-store.js`.
  Hay una causa genérica `medico`, sin texto libre.
- **Aviso en el formulario.** El comentario del suceso dice «No anotes datos de salud»
  en un bloque propio, no en el `placeholder`. Al guardar se pide confirmación si el
  texto contiene términos médicos. Ver `js/match/events/retroactive-modal.js`.
- **Instrucción escrita al club** en el contrato (`encargo.html` §6): los informes son
  deportivos, no médicos.
- Fuera el teléfono con WhatsApp (v671). La Fase 1b retiró la exposición del correo
  del administrador.
- **Las familias no teclean códigos** (v824). El entrenador asigna el jugador a cada
  familia aprobada.

### Consentimiento y patria potestad (responsabilidad del club)

Los menores no se registran solos: los inscribe el club. Con el modelo vigente,
**informar a las familias y recabar el consentimiento** de quien ejerce la patria
potestad de los menores de 14 años (LOPDGDD art. 7) cuando la base sea el
consentimiento, **es obligación del club**. Lo recoge `encargo.html` §6.

---

## Parte 4 · Base jurídica (la decide cada club; la orientación es ésta)

| Tratamiento | Base habitual |
|---|---|
| Gestión deportiva (convocatorias, minutos, asistencia) | Ejecución de contrato (relación con el club) / interés legítimo |
| Comunicación club ↔ familia | Ejecución de contrato / interés legítimo |
| Informes individuales del jugador | Interés legítimo, con información clara a la familia |
| Cuentas de usuario y acceso | Ejecución de contrato |
| Facturación *(Chronos)* | Obligación legal |
| Notificaciones push | Consentimiento (permiso del dispositivo) |
| Auditoría y antiabuso *(Chronos)* | Interés legítimo (seguridad) |

`privacy.html` §4 recoge estas bases. El consentimiento queda **sólo** para lo opcional.

---

## Parte 5 · Subencargados y transferencias

| Proveedor | Servicio | Dónde |
|---|---|---|
| Google (Firebase) | Firestore | `eur3`, UE ✅ |
| Google | Cloud Functions | `us-central1`, EE. UU. Lo declaran la política §5 y el contrato §5, con CCT y el marco de adecuación |
| Google | Firebase Auth | global (no se elige región) |
| Google | Cloud Scheduler, Hosting | — |
| Google reCAPTCHA | App Check | IP y señales del navegador |
| Firebase Cloud Messaging | notificaciones push | — |
| Gmail / SMTP (nodemailer) | correos de invitación | credenciales en Secret Manager ✅ |

Mejora posible, no obligatoria: mover las Functions a `europe-west1`. Las funciones se
recrean al moverlas, así que hay que planificarlo.

---

## Parte 6 · Conservación y supresión

| Dato | Plazo | Mecanismo |
|---|---|---|
| `live_matches` | 10 h tras el partido | `cleanupLiveMatches` (cada 60 min) |
| Solicitudes de plaza caducadas | — | `cleanupExpiredRequests` (cada 24 h) |
| `invites` | 14 días, un solo uso | reglas + `CRONOS_INVITE_DIAS` |
| Enlaces de invitación antiguos con datos en la URL | caducados el 2026-10-07 | v828 |
| Copias de Firestore | 7 días | programación diaria |
| PITR | 7 días | — |
| Baja de una cuenta | borrar / anonimizar («Usuario eliminado») / conservar | `functions/purga_usuario.js` (tabla `PLAN`) |
| `audit_logs`, `billing_*` | plazos legales | se conservan |
| Baja de un club | supresión tras exportar; las copias caducan en 7 días | `encargo.html` §7 |

---

## Parte 7 · Derechos de los interesados

- **Quién responde:** el club, como responsable. Si la solicitud llega a Chronos, se
  traslada al club en **5 días hábiles** y Chronos le ayuda a atenderla (`encargo.html`
  §4). Plazo de respuesta: **un mes** (art. 12).

| Derecho | Medio en la plataforma |
|---|---|
| Acceso | paneles + exportación de informes (TXT/PDF) |
| Rectificación | paneles |
| Supresión | baja con purga en cascada |
| Oposición / limitación | por solicitud, gestionada por el club |
| Portabilidad | **v848**: Dirección / Admin de Club → Informes → equipo → «📦 Datos de un jugador»: JSON estructurado (`chronos.portabilidad.jugador/1`) + CSV de partidos + CSV de asistencia. Excluye datos de terceros y los contactos de la familia (lo dice el propio JSON). Guard `test_portabilidad_jugador.js` |
| Decisiones automatizadas | no aplica: la app no perfila |

---

## Parte 8 · Incidentes y brechas

- **Plazos:** el encargado avisa al club en **48 h**, y el club notifica a la AEPD en
  **72 h** si hay riesgo.
- **Detección hoy:** `error_logs`, `audit_logs`, Cloud Logging y avisos de usuarios.
  No hay alertas automáticas; es una carencia conocida (P1 de la reauditoría).
- **Primero se contiene, sin destruir el rastro:**
  - revocar sesiones;
  - cerrar la regla;
  - desplegar.
- **Registro de cada brecha, se notifique o no.**
- **Recuperación:** `RECUPERACION.md`.

---

## Parte 9 · Evaluación de impacto (DPIA)

**Necesaria**, porque coinciden tres criterios:
- datos de **menores**;
- **evaluación sistemática** (minutos, asistencia, informes de rendimiento);
- datos que **rozan la salud**.

Como Chronos es encargado, la DPIA **corresponde al club**, con la asistencia de Chronos
(`encargo.html` §4). Chronos debería preparar una **DPIA tipo** del servicio que cada
club pueda adoptar. Para ello sirve el material de este documento.

---

## Parte 10 · Estado del plan

| # | Tarea | Estado |
|---|---|---|
| 1 | Purga en cascada al darse de baja | ✅ v754b |
| 2 | `privacy.html` veraz: transferencias, retención, identificación | ✅ v1.1 (23-09) → v2.0 (19-10, modelo club responsable) |
| 3 | Contrato de encargado como requisito del alta | ✅ `encargo.html` + casilla obligatoria (v830). ⏳ **Recabar la aceptación de los clubes existentes** |
| 4 | Aviso «no anotes datos de salud» | ✅ |
| 5 | Procedimiento de derechos | ✅ definido (Parte 7). ⏳ Registro de solicitudes atendidas |
| 6 | `INCIDENTES.md` con plantilla de registro | ⏳ |
| 7 | `us-central1` | ✅ declarado. Mover a `europe-west1` es opcional |
| 8 | DPIA tipo para los clubes | ⏳ con asesor |
| 9 | Información a familias / autorización | Responsabilidad del club (`encargo.html` §6) |
| 10 | Revisión jurídica externa de `encargo.html` | ⏳ recomendada |

---

## Anexo · Fuentes medidas

- `firestore.rules`: las 40 colecciones y 7 subcolecciones.
- API de Firestore: `locationId: eur3`.
- `functions/index.js`: región de las funciones.
- `functions/purga_usuario.js`: la purga.
- `js/coach/attendance/attendance-store.js`: las causas de falta.
- `js/services/auth.js`: las aceptaciones (`_gdprConsentFields`, `CRONOS_*_VERSION`).
- `scripts/test_politica_alineada.js`: el guard que ata política, contrato, este documento
  y el código.
