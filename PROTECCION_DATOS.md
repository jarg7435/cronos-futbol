# 🛡️ Protección de datos — Chronos Fútbol (BORRADOR)

> **Qué es esto y qué no.** Es un borrador **técnico**, escrito midiendo el código y la
> base de datos reales, para que lo revises y lo lleves a quien corresponda. **No es
> asesoramiento jurídico**, y varias decisiones de este documento —sobre todo la base
> jurídica y el papel de cada parte— las tiene que confirmar un profesional. Lo que sí
> aporta: el inventario de verdad, y **cuatro sitios donde la política que ya publicas
> promete algo que el código no hace**.
>
> Fecha del borrador: 2026-09-22 · versión de la app: v752

---

## Parte 0 · Las cuatro discrepancias medidas (empieza por aquí)

Esto es lo urgente: `privacy.html` ya está publicada y dice cosas que hoy no se cumplen.
Una política que promete de más es peor que una incompleta.

| # | Lo que dice `privacy.html` | Lo que hace el código | Gravedad |
|---|---|---|---|
| **1** | §6: «Tras la baja del usuario o del club, los datos se eliminan en un plazo máximo de **30 días**» | `deleteUserData` borra **sólo** `users/{uid}` y `platform_requests`. Informes, mensajes, asistencia, enlaces jugador‑familia, tokens de notificación y sesiones **se quedan** | 🔴 **Alta** |
| **2** | §5: «servidores en la **Unión Europea**» | Firestore sí (`eur3`: Bélgica + Países Bajos). Pero **las Cloud Functions corren en `us-central1` (Iowa, EE. UU.)** y procesan esos mismos datos | 🟠 Media |
| **3** | §10: de los menores «solo se registra un nombre o alias y datos deportivos, **sin ningún dato identificativo adicional**» | Además hay dorsal, posición, asistencia con motivo, y **informes de TEXTO LIBRE** donde cabe cualquier cosa | 🟠 Media |
| **4** | §1: el responsable «facilitará sus datos de contacto **a solicitud**» | El RGPD exige identificar al responsable **en la propia información**, no bajo petición | 🟡 Formal |

**El #1 es el que yo arreglaría primero**, y es trabajo de código: o `deleteUserData`
borra de verdad lo que promete, o la política deja de prometerlo. Hoy hay un tercer
estado —promesa incumplida— que es el único que no vale.

---

## Parte 1 · Quién es quién

El modelo que se desprende del producto (y que hay que confirmar):

- **Cada club o ente individual = RESPONSABLE del tratamiento.** Es quien decide
  inscribir a sus jugadores, qué informes hace y a quién se los manda.
- **Chronos Fútbol (tú, como operador) = ENCARGADO del tratamiento.** Tratas datos por
  cuenta del club, siguiendo sus instrucciones.
- **Google (Firebase) = SUBENCARGADO.**

👉 **Consecuencia práctica que hoy no existe: hace falta un CONTRATO DE ENCARGADO
(art. 28 RGPD) firmado con cada club.** Sin él, el club está cediendo datos de menores a
un tercero sin cobertura. Es un documento de una vez, reutilizable, y debería ser
requisito para dar de alta un club nuevo.

⚠️ Si en algún caso tú decides finalidades propias (por ejemplo, estadísticas agregadas
para mejorar el producto), en esa parte serías **responsable**, no encargado. Conviene
dejarlo escrito antes de hacerlo, no después.

---

## Parte 2 · Registro de actividades de tratamiento

Inventario real: **40 colecciones raíz + 7 subcolecciones**, todas en
`cronos-futbol-app`, base `(default)`, región **`eur3`**.

### 2.1 · Contienen datos personales de MENORES

| Colección | Qué guarda | Categoría |
|---|---|---|
| `players` | nombre/alias, dorsal, posición | Identificativo + deportivo |
| `cronos_player_reports` | informes individuales y colectivos, **texto libre** | Deportivo + 🔴 riesgo art. 9 |
| `clubs/*/attendance`, `attendance_players` | asistencia, faltas y **motivo** (`medico`) | 🟠 rozando salud |
| `clubs/*/team_rosters`, `team_archives` | plantillas por equipo | Identificativo |
| `cronos_player_links` | vínculo jugador ↔ familiar | Relación familiar |
| `matches`, `substitutions`, `events`, `formations` | minutos, cambios, sucesos | Deportivo |
| `live_matches`, `live_index`, `finished_index` | lo mismo, en vivo | Deportivo (efímero) |
| `pseudonym_map` | correspondencia seudónimo ↔ persona | 🔴 reidentificación |

### 2.2 · Datos personales de ADULTOS

| Colección | Qué guarda |
|---|---|
| `users` | correo, nombre, rol, club, plazas (`allRoles`) |
| `clubs`, `individuals` | nombre de la entidad, **`adminEmail`**, `adminUid` |
| `invites` | correo del invitado, rol, club, caducidad |
| `cronos_messages`, `cronos_staff_messages`, `cronos_staff_threads`, `cronos_staff_channel` | **contenido de conversaciones**, incluidas familia ↔ entrenador |
| `platform_requests`, `slot_requests`, `succession_requests`, `deletion_requests` | solicitudes de alta y baja |
| `billing_invoices`, `billing_subscriptions`, `billing_plans` | facturación |
| `push_tokens` | identificador de dispositivo |
| `audit_logs`, `error_logs`, `auth_deletion_failures` | rastro de acciones y fallos |
| `cronos_role_sessions` | sesión activa por plaza |
| `users/*/cronos_data`, `users/*/sa_privado` | datos privados, incluido el **motivo de una baja** |

### 2.3 · Sin datos personales (o derivados públicos)

`clubs_public` (nombre, tipo, estado, `hasAdmin`), `config`, `cronos_config`,
`cronos_email_config`, `trainingPlans` y sus `weeks`, `notifications`, `offline_events`,
`teams`.

---

## Parte 3 · Menores: lo que está bien y lo que falta

### ✅ Lo que ya se hizo bien, y conviene saber defenderlo

**No existe la causa «enfermedad».** Está escrito en
`js/coach/attendance/attendance-store.js:64`:

> *«El estado de salud de un menor es categoría especial del RGPD (art. 9). Se dejó una
> causa genérica `medico` que cubre lesión y enfermedad sin registrar el diagnóstico, y
> no hay texto libre donde poder escribirlo.»*

Las cuatro causas son `estudios`, `trabajo`, `medico`, `otros`. Es una decisión de
minimización tomada a conciencia y **es un argumento a tu favor** ante cualquier revisión.

También: se retiró el teléfono con WhatsApp (v671), y la Fase 1b acaba de eliminar la
exposición del correo del administrador.

### 🔴 El riesgo que queda: el texto libre

`cronos_player_reports` y los mensajes son **campos abiertos**. Nada impide que un
entrenador escriba *«no vino, sigue con la lesión de rodilla»*. Eso es un dato de salud de
un menor, en texto libre, dentro de un informe que además **se comparte** con el cuerpo
técnico y con la familia.

No se arregla sólo con tecnología. Lo que propongo:

1. **Un aviso en el propio formulario** de informe: «No escribas diagnósticos médicos ni
   datos de salud». Barato y eficaz.
2. **Instrucción escrita al club** (va en el contrato de encargado): el informe es
   deportivo, no médico.
3. Valorar una **retención más corta** para los informes con texto libre.

### Consentimiento y patria potestad

- Los menores **no se registran solos**: los inscribe el club o entra la familia con un
  código de invitación. Está bien planteado.
- Lo que **falta**: dejar constancia de que la **familia ha sido informada** y, cuando
  proceda, ha autorizado. Hoy no hay ningún registro de eso.
- En España, para servicios de la sociedad de la información, **por debajo de 14 años** el
  consentimiento lo da quien ejerce la patria potestad (LOPDGDD art. 7). En fútbol base
  eso es la mayoría de los jugadores.

---

## Parte 4 · Base jurídica (propuesta, a confirmar)

| Tratamiento | Base propuesta | Comentario |
|---|---|---|
| Gestión deportiva del equipo (convocatorias, minutos, asistencia) | **Interés legítimo** del club, o **ejecución de contrato** con el socio | Es la actividad propia del club |
| Comunicación club ↔ familia | Ejecución de contrato / interés legítimo | |
| Informes individuales del jugador | Interés legítimo, **con información clara a la familia** | Si entra texto sensible, decae |
| Cuentas de usuario y acceso | Ejecución de contrato | |
| Facturación | **Obligación legal** | |
| Notificaciones push | **Consentimiento** | Es un permiso del dispositivo |
| Registro de auditoría | Interés legítimo (seguridad) | |

⚠️ **El consentimiento no es la mejor base para casi nada de esto**, y es un error común:
si el club necesita los datos para funcionar, no puede pedir un consentimiento que en
realidad no se puede retirar sin dejar de jugar. La información, en cambio, es obligatoria
siempre.

---

## Parte 5 · Encargados y transferencias

| Proveedor | Servicio | Dónde | Qué hace falta |
|---|---|---|---|
| Google (Firebase) | Firestore | **`eur3`** — UE ✅ | DPA de Google (ya aplica al usar el servicio) |
| Google | **Cloud Functions** | 🟠 **`us-central1` — EE. UU.** | Ver abajo |
| Google | Firebase Auth | global (no se elige región) | Correo y hash de contraseña |
| Google | Cloud Scheduler, Hosting | — | |
| Google reCAPTCHA | App Check | — | IP y señales del navegador |
| Firebase Cloud Messaging | notificaciones push | — | |
| Gmail / SMTP (nodemailer) | correos de invitación | — | Credenciales en Secret Manager ✅ |

### 🟠 La discrepancia nº 2, en detalle

Los datos **reposan** en la UE, pero **se procesan** en Iowa cada vez que corre una
función: aprobar un alta, borrar una cuenta, enviar una invitación, asignar claims.
`privacy.html` dice «servidores en la Unión Europea» sin matizarlo.

**Dos salidas, y la primera es mejor:**

1. **Mover las funciones a `europe-west1`.** Técnicamente es cambiar la región y
   redesplegar. ⚠️ No es gratis: las funciones se **recrean**, y hay que revisar que
   ningún disparador se pierda por el camino. Es un trabajo acotado y yo lo puedo hacer.
2. **Corregir la política** para decir la verdad: almacenamiento en la UE, procesamiento
   en EE. UU. al amparo del DPA de Google y el marco de adecuación vigente.

Lo que no vale es dejarlo como está.

---

## Parte 6 · Conservación y supresión

### Lo que YA caduca solo ✅

| Dato | Plazo | Quién lo hace |
|---|---|---|
| `live_matches` | 10 h tras el partido | `cleanupLiveMatches` (cada 60 min) |
| Solicitudes de plaza caducadas | — | `cleanupExpiredRequests` (cada 24 h) |
| `invites` | **14 días** y un solo uso | Regla + `CRONOS_INVITE_DIAS` |
| Copias de Firestore | 7 días | Programación diaria (Fase 5) |
| PITR | 7 días | — |

### 🔴 La discrepancia nº 1, en detalle

`deleteUserData` (`functions/index.js:633`) se dispara al borrar la cuenta de Auth y
borra **exactamente dos cosas**:

```js
await admin.firestore().collection('users').doc(uid).delete();
// + los platform_requests con ese uid
```

**Se quedan**: `cronos_player_reports`, `cronos_messages` y los hilos de staff,
`clubs/*/attendance*`, `cronos_player_links`, `push_tokens`, `cronos_role_sessions`,
`users/{uid}/cronos_data`, `users/{uid}/sa_privado`, `pseudonym_map`, `audit_logs`.

La política promete 30 días para todo. **Hay que cerrar la brecha por uno de los dos
lados**, y mi recomendación es ampliar la función:

- Borrado **en cascada** de lo que es puramente de esa persona.
- **Seudonimización** de lo que no se puede borrar sin destruir información legítima de
  terceros (un mensaje en un hilo compartido, un informe colectivo): sustituir al autor
  por «Usuario eliminado» en vez de borrar el hilo entero.
- `audit_logs` y `billing_*` **se conservan** por obligación legal y trazabilidad — pero
  eso hay que **decirlo** en la política, que hoy no lo dice.

Plazos que propongo declarar:

| Dato | Plazo |
|---|---|
| Cuenta y perfil | Borrado en **30 días** desde la baja |
| Informes y asistencia | Fin de temporada + **1 año**, o borrado a petición del club |
| Mensajes | **2 años** |
| Auditoría | **3 años** (seguridad) |
| Facturación | **6 años** (obligación mercantil) |

---

## Parte 7 · Derechos de los interesados

| Derecho | ¿Se puede hoy? | Qué falta |
|---|---|---|
| **Acceso** | Parcial — hay exportación de informes a TXT/PDF | Un procedimiento que reúna **todo** lo de una persona |
| **Rectificación** | Sí, desde los paneles | — |
| **Supresión** | 🔴 Incompleta (Parte 6) | Ampliar `deleteUserData` |
| **Oposición** | No formalizada | Procedimiento |
| **Limitación** | No existe | Valorar un estado «tratamiento limitado» |
| **Portabilidad** | Parcial (TXT) | Formato estructurado y reutilizable (JSON/CSV) |
| **No decisiones automatizadas** | No aplica | La app no perfila automáticamente |

**Procedimiento propuesto:** un correo de contacto único y visible, plazo de respuesta de
**un mes**, identificación del solicitante, y **registro de cada solicitud y su respuesta**
(sin eso, no se puede demostrar que se atendió).

⚠️ Ojo: la solicitud de una familia llega normalmente **al club**, no a ti. El contrato de
encargado tiene que decir cómo te la traslada y en cuánto tiempo.

---

## Parte 8 · Incidentes y brechas

**Plazo legal: 72 horas** desde que se tiene conocimiento, para notificar a la AEPD si hay
riesgo para los derechos de las personas. Si el riesgo es alto, además a los afectados.

Lo que hay que tener escrito **antes** de necesitarlo:

1. **Quién decide** que algo es una brecha (tú, como operador).
2. **Cómo se detecta.** Hoy: `error_logs`, `audit_logs`, los registros de Cloud Logging y
   el aviso de un usuario. No hay alertas automáticas — es una carencia conocida.
3. **Qué se hace primero**: contener (revocar sesiones, cerrar la regla, desplegar),
   **sin destruir el rastro**.
4. **Registro de la brecha**, se notifique o no. Esto es obligatorio siempre.
5. **Cómo se avisa a los clubes afectados.**
6. **Recuperación**: ya existe, es `RECUPERACION.md`.

👉 Sugiero un `INCIDENTES.md` corto, con la plantilla del registro. Lo puedo redactar.

---

## Parte 9 · Evaluación de impacto (DPIA)

**Mi lectura: sí hace falta.** No por una sola razón, sino porque se juntan tres de los
criterios que la disparan:

- tratamiento de **datos de menores** a escala,
- **evaluación sistemática** de aspectos personales (minutos, asistencia, informes de
  rendimiento),
- **datos que rozan la salud** (motivo `medico`, y el texto libre).

No es un trámite enorme para un proyecto de este tamaño, y tiene una ventaja: obliga a
escribir lo que ya sabemos. Buena parte del material está en este documento y en el
dictamen de auditoría.

---

## Parte 10 · Plan de trabajo

| # | Tarea | Quién | Esfuerzo |
|---|---|---|---|
| 1 | Ampliar `deleteUserData` (cascada + seudonimización) | **Yo** | Medio |
| 2 | Corregir `privacy.html`: transferencias, retención real, responsable identificado, matizar §10 | Tú + yo | Bajo |
| 3 | Contrato de encargado, requisito para alta de club | Tú (con asesor) | Medio |
| 4 | Aviso «no escribas datos de salud» en el formulario de informe | **Yo** | Bajo |
| 5 | Procedimiento de derechos + registro de solicitudes | Tú | Bajo |
| 6 | `INCIDENTES.md` con plantilla de registro | **Yo** | Bajo |
| 7 | Decidir sobre `us-central1`: mover funciones o corregir la política | Tú decide, yo ejecuto | Medio |
| 8 | DPIA | Tú (con asesor) | Medio |
| 9 | Registro de información a familias / autorización | Tú | Medio |

**Orden que propongo:** 1, 2 y 4 primero — son código y texto, los hago yo, y cierran la
brecha entre lo prometido y lo real. El 3 y el 9 son los que de verdad te protegen a ti
frente a un club. El 8 va al final, cuando el resto esté escrito.

---

## Anexo · Cómo se ha medido esto

Nada de este documento es genérico. Procede de:

- `firestore.rules` (las 40 colecciones + 7 subcolecciones)
- la API de Firestore, para la región: `locationId: eur3`
- `functions/index.js` para la región de las funciones y para `deleteUserData`
- `js/coach/attendance/attendance-store.js` para las causas de falta
- `privacy.html` para las cuatro discrepancias
- la exportación de Auth del 2026-09-22: **10 cuentas, 7 con custom claims**
