# 🛟 Copias de seguridad y recuperación — Chronos Fútbol

**Estado medido el 2026-11-22 con `npm run backup:estado`** (pregunta a Google, no a
este fichero):

| | Estado |
|---|---|
| PITR | ✅ encendido desde el 2026-09-22 (ventana de 7 días) |
| Copia diaria gestionada | ✅ programada (retención 7 días); 6 copias READY, la última de hace 1 día |
| Exportación de cuentas de Auth | ✅ 2026-11-22: 12 cuentas, 8 con *custom claims* (la anterior tenía 61 días) |
| Simulacro de restauración | ✅ primero hecho y anotado (registro final): 47/47 colecciones, RTO ~14 min. Se repite cada seis meses |
| Cloud Storage (vídeos de jugadas, v804) | ✅ **sin copia a propósito**: los clips son efímeros (24 h) por diseño (ver Parte 0, punto 5) |

Hay clubes reales en producción, con datos de menores. La Parte 2 ya se activó el
2026-09-22 y se deja como referencia. El verificador (`scripts/ops/copias_estado.js`)
existe para que «activado» y «comprobado» no dependan de la memoria de nadie.

---

## Parte 0 · Qué hay que poder recuperar

**40 colecciones raíz** y **7 subcolecciones**, todas en `cronos-futbol-app`
(base `(default)`):

```
audit_logs · auth_deletion_failures · billing_invoices · billing_plans
billing_subscriptions · clubs · clubs_public · config · cronos_config
cronos_email_config · cronos_messages · cronos_notifications · cronos_player_links
cronos_player_reports · cronos_role_sessions · cronos_staff_channel
cronos_staff_messages · cronos_staff_threads · deletion_requests · error_logs
events · finished_index · formations · individuals · invites · live_index
live_matches · matches · notifications · offline_events · platform_requests
players · pseudonym_map · push_tokens · slot_requests · substitutions
succession_requests · teams · trainingPlans · users

clubs/{id}/attendance · clubs/{id}/attendance_players · clubs/{id}/team_archives
clubs/{id}/team_rosters · trainingPlans/{id}/weeks · users/{uid}/cronos_data
users/{uid}/sa_privado
```

### 🚨 Lo IRREMPLAZABLE, que es lo que fija la política

No todo pesa igual. Si se pierde `live_index` se regenera solo; si se pierde
`cronos_player_reports` se ha perdido el trabajo de una temporada de un club.

| Nivel | Colecciones | Por qué |
|---|---|---|
| 🔴 **Irrecuperable si se pierde** | `users`, `clubs`, `individuals`, `teams`, `players`, `cronos_player_reports`, `matches`, `clubs/*/attendance*`, `clubs/*/team_rosters`, `trainingPlans/*` | Es el producto. Nadie puede reescribir la asistencia de seis meses ni los informes de un jugador. |
| 🟠 **Doloroso** | `cronos_messages`, `cronos_staff_*`, `audit_logs`, `platform_requests`, `billing_*` | Comunicación con familias, rastro de quién hizo qué, y el estado de las altas y los cobros. |
| 🟢 **Se regenera** | `live_index`, `live_matches`, `finished_index`, `offline_events`, `notifications`, `push_tokens`, `cronos_role_sessions`, `clubs_public` | Índices, colas y espejos. Se reconstruyen solos o los rehace un trigger. |

### 🔑🔑 Lo que una copia de Firestore **NO** contiene

Esto es lo que convierte una recuperación en un desastre a medias, y por eso va antes
que los comandos:

1. **Las cuentas de Firebase Auth.** `users/{uid}` está indexado por el **uid de Auth**.
   Restaurar Firestore sin Auth deja 40 colecciones apuntando a uids que ya no existen:
   **nadie puede entrar**, y las personas sólo se pueden volver a casar por `email`, a
   mano. La exportación de Auth es un paso APARTE (Parte 2.3) y no es opcional.
2. **Los *custom claims*** (`role`, `clubId`). La aplicación autoriza con ellos en medio
   fichero de reglas. Viajan dentro de la exportación de Auth (`customAttributes`), pero
   **eso se comprueba en el simulacro**, no se da por hecho.
3. **Los secretos de las funciones** (`EMAIL_USER`, `EMAIL_PASS`, en Secret Manager).
4. **Las reglas, los índices y las funciones.** Están en este repositorio, que es su
   copia de seguridad — siempre que esté *pusheado*. Son **tres despliegues distintos**
   (`deploy:prod`, `deploy:prod:rules`, índices): restaurar datos no los restaura.
5. **Cloud Storage**: desde la v804 (vídeos de jugadas) **sí hay bucket**
   (`cronos-futbol-app.firebasestorage.app`, reglas publicadas el 2026-10-12). La copia
   de Firestore **no incluye** los ficheros, sólo los documentos que los referencian.
   **Decisión (2026-11-22): Storage NO se copia, a propósito.** Los clips de jugadas son
   efímeros por diseño: se ven una vez por cuenta y **se borran a las 24 h** (regla de
   ciclo de vida `Delete` a 1 día en `clips/` + TTL `expiresAt` de sus fichas). La app
   lo promete así a clubes y familias, y en categorías de menores son imágenes de niños:
   copiarlos contradiría esa promesa y la minimización de datos. Medido ese día:
   **0 objetos**. El *soft delete* que Google pone por defecto (7 días) se **desactivó**
   el mismo día (`retentionDurationSeconds: 0`, con autorización del titular) para que
   «24 h» sea cierto: con él, un clip borrado seguía recuperable hasta 8 días.
   (Hasta la v804 el bucket no existía: 404.)

> 📏 **Recuento real del 2026-11-22** (`(default)`): `individuals`, `matches`,
> `players`, `teams` y `trainingPlans` tienen **0 documentos** en la raíz. Hoy lo
> irremplazable vive en `clubs` y sus subcolecciones (`attendance*`, `team_rosters`,
> `team_archives`), en `cronos_player_reports` (8 717), en `trainingPlans/*/weeks` (124,
> con padres sin documento) y en `users/*/cronos_data`. El simulacro cuenta todas.

---

## Parte 1 · La política, y por qué ésta

Dos capas, porque cubren incidentes distintos:

| | **PITR** | **Copias programadas** |
|---|---|---|
| Cubre | «Un script ha borrado algo esta mañana» | «Nos hemos dado cuenta tres semanas después» |
| Punto de recuperación | Continuo (minutos) | El de la última copia (24 h) |
| Ventana | 7 días | Semanas |
| Coste | Almacenamiento continuo | Por copia guardada |

**El incidente más probable en este proyecto no es que Google pierda los datos: es que lo
rompamos nosotros.** `scripts/ops/` tiene ocho scripts de purga y limpieza que escriben
directo contra producción con el Admin SDK —saltándose las reglas— y un despliegue de
funciones o de reglas puede hacer daño igual de rápido. Contra eso, **PITR es la defensa
principal**: permite volver a «hace dos horas» sin depender de a qué hora se hizo la
copia de anoche.

**Objetivos declarados** (lo que se promete, para poder medir si se cumple):

- **RPO** (cuánto dato se acepta perder): **minutos** dentro de la ventana de PITR;
  **24 h** fuera de ella.
- **RTO** (cuánto se tarda en volver): **< 4 h** para una restauración completa. La
  restauración crea una base NUEVA y luego hay que cambiar el proyecto de base, así que
  no es instantáneo por mucho que se quiera.

> ⚠️ **Se prefieren las copias GESTIONADAS de Firestore a una exportación a GCS.** La
> exportación clásica necesita crear un bucket, darle IAM, ponerle reglas de ciclo de
> vida y vigilar su tamaño — cuatro cosas más que pueden estar mal el día que hagan
> falta. Las copias gestionadas no necesitan bucket.

---

## Parte 2 · Activarlo (una vez)

`gcloud` **no está instalado en esta máquina**. La vía sin instalar nada es
**Cloud Shell**: <https://console.cloud.google.com/> → icono `>_` arriba a la derecha.

### 2.1 · Point-in-Time Recovery

```bash
gcloud config set project cronos-futbol-app

gcloud firestore databases update --database='(default)' --enable-pitr
```

Comprobarlo:

```bash
gcloud firestore databases describe --database='(default)' \
  --format='value(pointInTimeRecoveryEnablement)'
# se espera: POINT_IN_TIME_RECOVERY_ENABLED
```

### 2.2 · Copias diarias programadas

```bash
# Diaria. La retención se expresa en días; confirma el máximo admitido
# en la consola antes de subirla (los límites de GCP se mueven).
gcloud firestore backups schedules create \
  --database='(default)' \
  --recurrence=daily \
  --retention=7d

# Semanal, para tener una red más larga que la diaria.
gcloud firestore backups schedules create \
  --database='(default)' \
  --recurrence=weekly \
  --day-of-week=SUN \
  --retention=28d
```

Comprobarlo:

```bash
gcloud firestore backups schedules list --database='(default)'
gcloud firestore backups list --format='table(name,database,snapshotTime,state)'
```

> ⚠️ La primera copia **no aparece al instante**: la diaria se ejecuta dentro de su
> ventana. No des esto por hecho hasta que `backups list` devuelva una fila con
> `state: READY`. Es el mismo error que «desplegado ≠ vivo» que ya ha mordido tres veces
> con las reglas.

### 2.3 · 🔑 Exportar las cuentas de Auth (lo que la copia NO cubre)

Sin esto, una restauración deja la aplicación **sin nadie que pueda entrar**.

```bash
# Desde esta máquina, que ya tiene sesión del CLI:
npm run backup:auth
```

Eso escribe `auth_users_<fecha>.json` en **`C:\Users\<usuario>\CRONOS_RESPALDOS_PRIVADOS\`**
(o en la carpeta de la variable `CRONOS_RESPALDOS`), **siempre FUERA del proyecto**: si
se le apunta dentro, aborta sin escribir. Ese fichero contiene el correo y el hash de
contraseña de todas las familias. **Guárdalo cifrado y fuera de este ordenador.**

> 🚨 **Incidente 2026-10-02.** Hasta esa fecha la exportación iba a `backups/`, dentro del
> proyecto, y solo la protegía `.gitignore`. Pero el hosting publica la carpeta entera
> (`"public": "."`) y `firebase.json` no excluía `backups/`: los cinco respaldos (incluido
> este export) estuvieron **descargables en producción y en testeo**, y viajaron en el ZIP
> de la auditoría del 30-09. Se retiraron de los dos sitios el 2026-10-02.
> `.gitignore`, `firebase.json` y un ZIP son **tres listas distintas**: lo único seguro es
> que el dato no esté en la carpeta.

⚠️ Hazlo **cada vez que se aprueben altas nuevas**, y como mínimo una vez al mes.

---

## Parte 3 · El simulacro (obligatorio, y con fecha)

**Una copia que no se ha restaurado nunca no es una copia: es una suposición.** El
simulacro se hace **una vez al activar todo esto** y luego **cada seis meses**.

No toca la base de producción en ningún momento: se restaura a una base NUEVA.

```bash
# 1. Elegir una copia concreta
gcloud firestore backups list --format='value(name,snapshotTime,state)'

# 2. Restaurarla a una base NUEVA (nunca sobre '(default)')
gcloud firestore databases restore \
  --source-backup=projects/cronos-futbol-app/locations/<LOC>/backups/<ID> \
  --destination-database='simulacro'
```

Comprobaciones, en este orden (las cuatro, no sólo la primera):

| # | Qué se comprueba | Cómo |
|---|---|---|
| 1 | La base existe y tiene documentos | `gcloud firestore databases describe --database=simulacro` |
| 2 | 🔴 Está lo irremplazable | contar `users`, `clubs`, `cronos_player_reports` y comparar con producción |
| 3 | 🔑 Los uids de `users` **casan** con la exportación de Auth | cruzar los ids de `users` contra `localId` del JSON de la Parte 2.3 |
| 4 | 🔑 Los *custom claims* están en esa exportación | buscar `customAttributes` con `role`/`clubId` en el JSON |

Las comprobaciones 3 y 4 son las que de verdad se están probando aquí. La 1 y la 2 casi
siempre salen bien; **el fallo realista es descubrir el día malo que los datos volvieron
pero las cuentas no.**

Al terminar:

```bash
gcloud firestore databases delete --database='simulacro'
```

Y **anota la fecha del simulacro al final de este fichero.** Un simulacro sin fecha es
indistinguible de un simulacro que no se hizo.

---

## Parte 4 · Si hoy es el día malo

1. **PARAR.** No despliegues, no lances scripts de `scripts/ops/`, no «arregles» nada
   escribiendo encima. Cada escritura acorta lo que PITR puede devolver.
2. **Fijar la hora del incidente.** La última escritura buena. Cloud Logging la tiene;
   `audit_logs` también, si el rastro llegó.
3. **Decidir el alcance.** ¿Una colección o todo? Restaurar entero para arreglar un
   documento hace más daño del que repara.
4. **Restaurar a una base NUEVA**, nunca encima de `(default)`:

   ```bash
   gcloud firestore databases restore \
     --source-backup=<...> --destination-database='rescate'
   ```
   Desde PITR, con la hora:
   ```bash
   gcloud firestore export gs://<bucket>/rescate \
     --database='(default)' --snapshot-time='2026-09-22T08:00:00Z'
   ```
5. **Verificar en `rescate`** antes de tocar producción. Las cuatro comprobaciones de la
   Parte 3.
6. **Volcar sólo lo necesario** a producción, o cambiar la aplicación de base si el daño
   es total. El `databaseId` se elige en `firebase-init.js`.
7. **Cuentas**: si el incidente tocó Auth, reimportar desde el JSON de la Parte 2.3
   (`firebase auth:import`). ⚠️ Con el **mismo algoritmo de hash** que exportó, o las
   contraseñas no valdrán.
8. **Escribirlo.** Qué pasó, a qué hora, qué se restauró, qué se perdió. Sin esto, la
   Parte 6 del paquete de protección de datos (notificación de brechas) no se puede
   cumplir.

---

## Parte 5 · Que no se pudra

```bash
node scripts/ops/copias_estado.js
```

Pregunta a Google —no a este fichero— si PITR está encendido, si las programaciones
existen y si la copia más reciente es fresca. **Sale con 1 si algo falta**, para que
pueda colgarse de una tarea programada sin leerlo a ojo.

🔑 Existe porque este proyecto ya ha pagado tres veces el mismo error con las reglas:
creerse que algo está activo porque se lanzó el comando una vez. Una política de copias
sin verificador es un comentario que avisa, y los comentarios no comprueban nada.

---

## Parte 6 · Alertas automáticas

Activas en producción (`cronos-futbol-app`) desde el 2026-11-22, en **Cloud Monitoring**.
Avisan por correo al titular. Se probaron en testeo (A1-A4 llegaron, A5 no debía) y en
producción con dos líneas de log marcadas `[PRUEBA]` (A1 y A2 llegaron).

| # | Alerta | Salta cuando | Qué hacer |
|---|---|---|---|
| A1 | 🔴 Purga o borrado incompletos | log de error con `PURGA INCOMPLETA` (`deleteUserData`) o `VERIFICACIÓN FALLIDA` (`archiveAndDeleteCoach`) | Es una **baja RGPD sin completar**. Mirar `auth_deletion_failures` y el log; terminar la purga. Si quedaron datos visibles, abrir ficha en `INCIDENTES.md` |
| A2 | 🔴 Fallo de correo | log de error de `sendInviteEmail` con `Error Nodemailer` | Las invitaciones no llegan. Revisar los secretos `EMAIL_*` (Secret Manager) y el proveedor SMTP. Avisar a los clubes que estén dando altas |
| A3 | 🟠 Error en una función | **cualquier** log de nivel ERROR de las Cloud Functions (como mucho un aviso por hora) | Logs Explorer con `severity>=ERROR` y `resource.type="cloud_function"`, ver qué función falla y desde cuándo. Si coincide con un despliegue, valorar volver atrás |
| A4 | 🟠 Rechazos de App Check | más de 50 peticiones **rechazadas** (`result="DENY"`) en 1 h. Lo normal son unas pocas por semana | Posible abuso, cliente roto o reCAPTCHA caído. `node scripts/ops/evidencia_appcheck.js` para ver el reparto. Si es abuso: `INCIDENTES.md` |
| A5 | 🟠 La app no responde | la comprobación de `https://cronos-futbol-app.web.app/` (cada 5 min, desde Europa, EE. UU. y Sudamérica) falla desde más de una región | Abrir la web. Mirar la consola de Hosting y el último despliegue; si lo rompió un despliegue, volver a la versión anterior desde la consola |

- **Canal:** un correo al titular. Los avisos de una misma alerta se agrupan (como mucho
  uno cada 5 min), y llega otro correo cuando se resuelve.
- **Cada correo trae su «qué hacer»**: la columna de arriba va también en la
  documentación de cada alerta.

### ⚠️ Trampas medidas al montarlas

- La etiqueta `result` de la métrica de App Check vale **`ALLOW` / `DENY`**, no `VALID`.
  Un filtro `result!="VALID"` cuenta también las permitidas (~100/h en producción) y
  avisaría cada hora.
- Una métrica de logs recién creada tarda **hasta 10 min** en poder usarse en una alerta
  (la API responde 404 mientras tanto).
- 🚨 **Las funciones registran como `resource.type="cloud_function"`, no
  `cloud_run_revision`.** La primera A3 («más de 5 errores en 10 min») sólo miraba
  `cloud_run_revision` y **nunca habría saltado** con errores reales; la prueba pasó
  porque las líneas `[PRUEBA]` se escribieron con el tipo equivocado. Corregida el mismo
  22-11 (ahora salta con cualquier error). **Las pruebas se escriben como
  `cloud_function`.** Al corregirla salió un fallo real: `cleanupExpiredRequests` falla
  cada noche por falta de un índice (ver `INCIDENTES.md` si llega a tratarse como
  incidente; arreglo pendiente).

### Lo que estas alertas NO cubren (decidido así)

- **Que la copia diaria no se haga**: no hay alerta. **Recordatorio semanal** del titular
  (los lunes, en su calendario): `npm run backup:estado`, que sale en rojo si falta algo.
  Automatizarlo en la CI exigiría guardar en GitHub una credencial de producción:
  descartado.
- **Intentos repetidos de inicio de sesión**: Firebase Auth ya los frena por su cuenta;
  alertar exigiría activar los registros de acceso a datos (volumen y coste). Descartado
  por ahora.
- **Gasto anómalo**: no hay alerta de presupuesto (pendiente, requiere la cuenta de
  facturación).

### Comprobarlas o recrearlas

- Ver que siguen activas: consola de Google Cloud → Monitoring → Alerting (cinco
  políticas «Chronos · A1…A5», todas activas, un canal de correo).
- **Probar** A1 o A2 sin tocar nada: escribir en los logs una línea de nivel ERROR,
  con `resource.type="cloud_function"`, el texto de la alerta y la marca `[PRUEBA]`. Se
  hizo así el 2026-11-22 (entonces como `cloud_run_revision`, ver la trampa de arriba).
- **Retención de los logs** (`_Default`): **180 días** desde el 2026-11-22 (antes 30).
  La auditoría de administración (`_Required`) se guarda 400 días, fijo.
- **Recrearlas**: `node scripts/ops/alertas_crea.js cronos-futbol-app cronos-futbol-app.web.app`
  (sin `--crear` enseña lo que haría; con `--crear` crea sólo lo que falte).

---

## Registro de simulacros

> ⚠️ **En esta sección sólo puede aparecer con formato de fecha la fecha del propio
> simulacro.** `copias_estado.js` toma la fecha más reciente que encuentre aquí: una
> fecha de copia o de «próximo simulacro» le haría creer que hay un simulacro reciente.
> La hora de la copia se anota como hora, no como fecha (p. ej. «copia de la víspera,
> 19:23 UTC»), y el id de la copia sin fecha.

Ficha por simulacro (plantilla, copiar debajo y rellenar):

| Campo | Valor |
|---|---|
| Fecha del simulacro | AAAA-MM-DD |
| Responsable | |
| Copia usada | id de la copia · hora de la foto (`snapshotTime`, sólo hora) |
| Base destino | `simulacro` (borrada al terminar: sí/no) |
| Exportación de Auth usada | nombre del fichero (en `CRONOS_RESPALDOS_PRIVADOS`) |
| 1 · Base creada | ✓/✗ |
| 2 · Recuentos | colecciones irremplazables vacías: N · diferencias significativas |
| 3 · uids de `users` que casan con Auth | x/y · huérfanos explicados |
| 4 · Cuentas con claims en `customAttributes` | x/y · las que no los tienen, explicadas |
| RPO medido | antigüedad de la foto al empezar |
| RTO medido | desde lanzar `restore` hasta pasar la comprobación 4 |
| Incidencias | |

### Simulacro 1

| Campo | Valor |
|---|---|
| Fecha del simulacro | 2026-11-22 |
| Responsable | José Alberto (Cloud Shell: listar, restaurar, borrar) · Claude (verificación) |
| Copia usada | `6ccb35c6-40dc-46e7-8d5b-0da2edb90259` (`eur3`, copia diaria gestionada) · foto de las 19:32:50 UTC |
| Base destino | `simulacro` · **borrada al terminar: sí** (después sólo queda `(default)`, comprobado) |
| Exportación de Auth usada | `auth_users_…-19-42-18.json` en `CRONOS_RESPALDOS_PRIVADOS` (10 cuentas, 8 con claims) |
| 1 · Base creada | ✓ restauración `SUCCESSFUL` al 100 %; base creada a las 20:14:16 UTC |
| 2 · Recuentos | ✓ **47/47 colecciones idénticas a producción** (40 de la raíz + 7 subcolecciones por *collection group*) · 0 irremplazables vacías · p. ej. 8 717 informes, 4 clubes, 10 perfiles, 144 + 11 de asistencia, 18 plantillas, 124 semanas |
| 3 · uids de `users` que casan con Auth | 9/10 · el que no casa es un perfil ANTIGUO de SuperAdmin (marzo) que ya no tenía cuenta en producción antes de la copia: resto previo, no fallo de la restauración |
| 4 · Cuentas con claims en `customAttributes` | 8/10 · sin claims: un coordinador pendiente de aprobación del Admin del Club (los recibe al aprobarse) y una cuenta familiar sin perfil |
| RPO medido | ~40 min (foto de la copia diaria frente al inicio); con PITR serían minutos |
| RTO medido | ~14 min, de las 20:13 (listar copias) a las 20:27 (fin de la comprobación 4). **No incluye** volcar a `(default)` ni cambiar de base ni reimportar Auth, que una recuperación real añadiría |
| Incidencias | Ninguna en la restauración. Herramienta de verificación de sólo lectura (REST, recuentos e ids). Antes se retiraron de Auth dos cuentas de prueba `@ejemplo.invalid` (con permiso del titular) |
| Próximo | a los seis meses (Parte 3) |
