# 🛟 Copias de seguridad y recuperación — Chronos Fútbol

**Estado a 2026-09-22: NO HAY NINGUNA COPIA DE SEGURIDAD.** Ni PITR, ni copias
programadas, ni exportación de cuentas. Lo único que existe son respaldos *ad hoc* que
algunos scripts de `scripts/ops/` escriben en local antes de purgar, y eso cubre
exactamente el documento que ese script iba a tocar: nada más.

Hay clubes reales en producción, con datos de menores. Este documento es el plan para
cerrar eso, y el procedimiento para usarlo cuando haga falta.

> ⚠️ **Nada de lo que hay aquí está activado todavía.** Los comandos de la Parte 2 hay
> que lanzarlos una vez; hasta entonces, este fichero describe un plan, no una defensa.
> El verificador (`scripts/ops/copias_estado.js`) existe justamente para que la
> diferencia entre las dos cosas no dependa de la memoria de nadie.

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
5. **Cloud Storage**: no hay bucket (comprobado, 404). Nada que copiar — por ahora.

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

Eso escribe `backups/auth_users_<fecha>.json`. **`backups/` está en `.gitignore`**, y
tiene que seguir estándolo: ese fichero contiene el correo y el hash de contraseña de
todas las familias. **Guárdalo cifrado y fuera de este ordenador.**

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

## Registro de simulacros

| Fecha | Quién | Copia usada | Resultado |
|---|---|---|---|
| _(pendiente: el primero, al activar la Parte 2)_ | | | |
