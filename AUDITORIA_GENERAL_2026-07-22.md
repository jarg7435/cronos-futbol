# Auditoría general — CRONOS FÚTBOL

Fecha: 2026-07-22
Alcance: HEAD (`main`) + working tree con cambios sin commitear (18 archivos modificados, ~1600 líneas) + archivos untracked en raíz y `functions/`.
Método: lectura de código real, `git diff`/`git log -S` para verificar intención vs. implementación, grep estructural para cuantificar duplicación. No sustituye a un pentest ni a los tests de emulador ya pendientes (ver `CORRECCIONES_ESTADO.md`).

Este documento complementa (no repite) `ARQUITECTO.md`, `CORRECCIONES_ESTADO.md`, `AUDITORIA_FIREBASE_DEPRECADOS.md` y `AUDITORIA_LIVESYNC_PARTE1.md`, ya existentes en el repo.

---

## Resumen — lista de prioridades

_Nota: este documento lo redactó inicialmente un pase de auditoría centrado en `firestore.rules`/paneles admin; se ha ampliado (sección "Ampliación") con hallazgos de dos pases paralelos sobre el resto del WIP (flujo de partido/informes y arquitectura/higiene) para que quede un único documento consolidado._

| # | Severidad | Hallazgo | Archivo |
|---|---|---|---|
| 1 | ✅ CORREGIDO | ~~`transitionalRead()` reintroducido en las reglas SIN comprobar que el club del documento coincida con el del usuario~~ — fix aplicado y verificado (16/16), pendiente de deploy | `firestore.rules` (WIP) |
| 2 | ✅ CORREGIDO | ~~`usuarios_temp.json`: volcado real de `passwordHash`+`salt` de usuarios de producción, sentado en una carpeta sincronizada automáticamente con OneDrive~~ — archivo eliminado (nunca estuvo en git; sin referencias en código) | raíz del repo |
| 3 | ✅ CORREGIDO | ~~5 scripts de investigación con OAuth client_secret + lectura del refresh-token local de la CLI, sueltos y untracked en `functions/`~~ — movidos a `scripts/ops/` (fuera del bundle de deploy) y la carpeta añadida a `.gitignore` | `scripts/ops/` |
| 4 | ✅ CORREGIDO | ~~`_cronosBuildLiveMatchId`/`startLiveSync` (commit `7b0a1f2`, "v266B") recalculaban el sufijo de hora en cada llamada → riesgo de reintroducir la duplicación de informes (P1 v167/v168)~~ — `startLiveSync()` ahora reutiliza el `liveMatchId` en curso; solo genera uno nuevo cuando de verdad arranca un partido nuevo | `js/match/live/sync.js` |
| 5 | ✅ CORREGIDO | ~~P11-D: informe colectivo con staff vacío sigue abortando la escritura~~ — restaurado el fix (guard sin `return`, `_collStaffUids`/`_allStaffUids` con `me.uid`, logs TOTAL); `test_p11d_collective_write.js` 9/9 PASS | `js/coach/comms/panel.js` |
| 6 | ✅ CORREGIDO | ~~`coachDeleteAllMessages`/`ppDeleteAllMessages`: vacían la conversación completa con el otro extremo de forma irreversible, sin auditoría~~ — borrado lógico: se archiva el contenido en `deletedMessagesLog` (quién/cuándo/cuántos) antes de vaciar | `js/coach/comms/panel.js`, `js/parent/panel.js` |
| 7 | 🟠 ALTO | SEC-C1 (create) y SEC-C3 (test de emulador) — deuda de seguridad ya documentada, sigue abierta | `firestore.rules` |
| 8 | ✅ CORREGIDO | ~~`replay-player.js`: reconstruye goles/tarjetas/sustituciones con `texto.includes(p.name)` — un nombre que sea subcadena de otro misatribuye el evento~~ — ahora busca por igualdad exacta del nombre extraído, no por subcadena | `js/match/replay/replay-player.js` |
| 9 | 🟡 MEDIO | Monolitos sin tests unitarios reales (solo scripts ad-hoc en `scripts/`) | `app-init.js` (6407 líneas), `auth.js` (3235), `superadmin.panel.js` (4122), `club-reports.js`, `comms/panel.js` |
| 10 | 🟡 MEDIO | `endMatch`/`startMatchWithConvocation` con múltiples definiciones globales; cuál "gana" depende del orden de `<script>` en `index.html` | `js/match/events/player-actions.js`, `js/match/persistence/active-match.js`, `js/ai/import.js`, `js/core/app-init.js` |
| 11 | 🟡 MEDIO | Wrapper de `endMatch` en `sprint3-init.js` depende de un `setInterval` async sin garantía formal de orden frente a los otros dos que reasignan `window.endMatch` de forma síncrona | `js/core/sprint3-init.js` |
| 12 | 🟢 BAJO | 8 copias idénticas de `logo.png` bajo nombres distintos (~1,2 MB muerto, se sirve en cada deploy) | `public/assets/img_*.png` |
| 13 | 🟢 BAJO | Código muerto confirmado: `generator.js`, `team-management.js`, `substitutions.js`, `firestore-sync.js`/`cloud-data.js` | `js/coach/reports/`, `js/roster/`, `js/match/`, `js/services/` |
| 14 | 🟢 BAJO | Cloud Functions en Gen 1 + `firebase-admin@12`/`firebase-functions@5` desactualizados (ya documentado, sin acción) | `functions/index.js`, `functions/package.json` |
| 15 | 🟢 BAJO | CI (`ci.yml`) corre ESLint con `continue-on-error: true` — el lint nunca bloquea un PR, solo `npm test` es gate real | `.github/workflows/ci.yml` |
| 16 | 🟢 BAJO | Sin `.gitattributes` — cada archivo tocado dispara avisos LF→CRLF y ensucia los diffs | raíz del repo |
| 17 | 🟢 BAJO | Archivos sueltos en la raíz sin función clara en producción (`diff_*.txt`, `_commitmsg*.txt`, `jdkinstall.txt`, `firestore.rules.BACKUP/.REVIEW/.OPCION_A.diff`, `v317`) | raíz del repo |

---

## ✅ 1. `transitionalRead()` — hueco cross-club en la ventana de gracia [CORREGIDO 2026-07-22]

> **Estado: fix aplicado en `firestore.rules` y verificado con `scripts/test_sec_transitionalread_clubid.js` (16/16 PASS) + `firebase deploy --only firestore:rules --dry-run` (compila OK). Detalle completo en `CORRECCIONES_ESTADO.md` → SEC-C4. Pendiente de commit/deploy a producción.**

**Dónde:** `firestore.rules`, cambios sin commitear (`git diff -- firestore.rules`).

**Qué pasó:** La función `transitionalRead()` ya había sido **eliminada por completo** en una auditoría de seguridad anterior, con el comentario textual: *"transitionalRead(clubId) concedía acceso [...] Era un backdoor por diseño"*. El diff actual la **reintroduce**, ahora midiendo la ventana desde `users/{uid}.createdAt` (inmutable, sólo el Admin SDK la escribe) en vez de `auth_time` — eso sí arregla el problema original (renovar la ventana con logout+login).

**Pero el nuevo problema es distinto y más grave:**

```
function transitionalRead(clubId) {
  return isAuth() && !hasClaims() && clubId != null
         && exists(/databases/$(database)/documents/users/$(request.auth.uid))
         && get(...).data.createdAt is timestamp
         && (request.time - get(...).data.createdAt) < duration.value(5, 'm');
}
```

Esta función **no compara `clubId` con el club del propio usuario en ningún punto** — sólo exige que el documento objetivo tenga *algún* `clubId` no nulo y que la cuenta del solicitante tenga menos de 5 minutos. Se añade como rama `OR` en ~15 sitios distintos (`users`, `individuals`, `trainingPlans`, hilos de mensajería, `cronos_player_links`, etc.).

**Consecuencia real:** durante los 5 minutos posteriores a **cualquier** registro nuevo, esa cuenta puede leer/escribir documentos de un club que **no es el suyo** (nombres y datos de menores, mensajería, informes) en todas las colecciones donde se OR-eó `transitionalRead`. Y como el diseño es "no renovable **por cuenta**" pero no limita la creación de cuentas nuevas, el hueco es repetible indefinidamente: basta con registrar una cuenta nueva cada vez que expira la anterior.

**Recomendación:** antes de desplegar, añadir la comprobación de que el `clubId` de la cuenta recién creada coincide con el `clubId` del documento objetivo (leer `users/{uid}.clubId` del propio solicitante y compararlo), o limitar `transitionalRead` a un único documento conocido (el propio `users/{uid}`) en vez de usarlo como comodín en colecciones de terceros.

---

## ✅ 2. Scripts de investigación con secreto OAuth + acceso al token local de la CLI [CORREGIDO 2026-07-22]

> **Estado: movidos fuera de `functions/` a `scripts/ops/` (que ya no se empaqueta en `firebase deploy --only functions`) y `scripts/ops/` añadida a `.gitignore` — no llegarán al repo. Confirmado sin referencias externas (`grep` en el resto del proyecto) antes de moverlos.**

**Dónde (histórico, ahora en `scripts/ops/`):**
- `inspect_club_dia_users.js`
- `inspect_club_dia_users_rest.js`
- `investigate-ind-rest.js`
- `investigate-ind.js`
- `list-messages.js`

**Qué contienen:** los 5 leen `~/.config/configstore/firebase-tools.json` (el refresh-token de la sesión local de `firebase login`) y lo combinan con un `client_id`/`client_secret` **hardcodeado** (`j9iVZfS8kkCEFUPaAeJV0sAi`) para autenticarse como Admin SDK contra `cronos-futbol-app` en producción. Ninguno exporta nada (`grep exports.` no encontró resultados) — son scripts standalone (`node script.js`), **no se desplegarían** con `firebase deploy --only functions`, así que no hay riesgo de ejecución accidental en Cloud Functions. El `client_secret` en sí es el conocido públicamente por ser el de la propia app OAuth "installed" de `firebase-tools` (no es un secreto exclusivo del proyecto), pero:

1. Son claramente herramientas de depuración puntual (buscan un club llamado "Día", investigan un "individual" concreto) que no deberían vivir dentro de `functions/`.
2. Si algún día alguien empaqueta o comparte esta carpeta completa (incluido, por error, el propio `configstore/firebase-tools.json` de quien los ejecutó), sí habría fuga real de credenciales de producción.
3. Ensucian `functions/` mezclando código de producto con scripts ad-hoc.

**Recomendación:** moverlos fuera del repo (o a una carpeta local ignorada por git) antes de cualquier commit; no quedó ninguno trackeado todavía, así que es un fix de 30 segundos.

---

## ✅ 2 bis. `usuarios_temp.json` — hashes de contraseñas reales en carpeta sincronizada [CORREGIDO 2026-07-22]

> **Estado: archivo eliminado del working tree.** Comprobado antes de borrar: `git log --all -- usuarios_temp.json` no devuelve nada (nunca se commiteó) y ningún script/código lo referenciaba (solo aparecía en `.gitignore` y en la lista `ignore` de `firebase.json`). Si algún proceso de mantenimiento vuelve a generarlo, debe escribir fuera de cualquier carpeta sincronizada con la nube (OneDrive/Drive/Dropbox).

**Dónde (histórico):** raíz del repo (working tree, no trackeado en git — confirmado por `.gitignore`).

**Qué contiene:** un volcado de Firebase Auth con `passwordHash`, `salt`, `localId` y `email` de usuarios reales (104 líneas). `.gitignore` evita que llegue al repo, pero **no evita que OneDrive lo suba a la nube de Microsoft**, porque todo el proyecto vive dentro de `OneDrive\Escritorio\...`. Es la única exposición real de credenciales de producción encontrada en toda la auditoría (los "secretos" de los scripts de `functions/` son el client OAuth público de `firebase-tools`, no un secreto del proyecto).

**Recomendación:** borrarlo ahora. Si algún script de mantenimiento lo regenera, que escriba fuera de cualquier carpeta sincronizada (p. ej. una ruta bajo `%TEMP%`), nunca en la raíz del proyecto.

---

## ✅ 3 bis. Borrado masivo de mensajes sin auditoría ni reversibilidad [CORREGIDO 2026-07-22]

> **Estado: fix aplicado — borrado lógico con `deletedMessagesLog` (arrayUnion) en ambos archivos, verificado con `scripts/test_delete_all_messages_audit.js` (15/15 PASS, ejecuta el código real de ambas funciones en sandbox). Detalle en `CORRECCIONES_ESTADO.md`. Pendiente de commit/deploy.**

**Dónde (histórico):** `js/coach/comms/panel.js:5268` (`coachDeleteAllMessages`) y `js/parent/panel.js:2192` (`ppDeleteAllMessages`), ambas nuevas en el WIP sin commitear.

```js
window.coachDeleteAllMessages = async (threadId, perspective) => {
    if (!confirm('¿Estás seguro...?')) return;
    await updateDoc(doc(db, 'cronos_messages', threadId), {
        messages: [], lastMessage: '— Sin mensajes —', lastMessageAt: new Date().toISOString()
    });
    ...
};
```

Vacía el array `messages` completo del hilo (incluidos los mensajes escritos por la OTRA parte) de un solo `updateDoc`, sin pasar por `auditLogger` (que sí se usa para otras acciones sensibles del producto) y sin posibilidad de recuperación. La única barrera es un `confirm()` de cliente. Para un hilo entrenador↔familia de un menor, es una pérdida de comunicación irreversible y sin rastro de quién la ejecutó ni cuándo.

**Recomendación:** registrar la acción en `auditLogger` antes de vaciar, y valorar un borrado lógico (mover a `deletedMessages` o marcar `deletedAt`) en vez de sobrescribir el array.

---

## ✅ 4 bis. `replay-player.js` — emparejamiento de eventos por subcadena de nombre [CORREGIDO 2026-07-22]

> **Estado: fix aplicado — nuevas `_extractPlayerNameFromEventText`/`_findPlayerByEventText` (igualdad exacta, no subcadena), verificado con `scripts/test_replay_player_name_match.js` (13/13 PASS). Limitación residual conocida: dos jugadores con nombre COMPLETO idéntico no se pueden distinguir solo con texto (requeriría que los eventos lleven `playerId`, fuera del alcance de este fix). Detalle en `CORRECCIONES_ESTADO.md`. Pendiente de commit/deploy.**

**Dónde (histórico):** `js/match/replay/replay-player.js`, líneas 335, 349, 358, 365, 370, 377 (archivo nuevo en el WIP).

```js
if (matchName.includes(p.name)) foundP = p;
...
if (ev.text && ev.text.includes(p.name)) { ... }   // se repite para gol/roja/entra/banquillo/lesión
```

El emparejamiento jugador↔evento se hace comparando si el texto del evento **contiene** el nombre del jugador como subcadena, no por ID. Dos problemas: (1) si el nombre de un jugador es subcadena de otro (p. ej. "Ana" dentro de "Anabel", o dos jugadores con el mismo nombre de pila), el evento se atribuye también al que no jugó ese lance; (2) al no haber `break`/exclusividad, un mismo evento puede marcar a **varios** jugadores del array a la vez. Afecta a los goles/tarjetas/entradas-salidas que se muestran y exportan en el vídeo de repetición.

**Recomendación:** emparejar por `p.number`/`p.id` (ya disponibles en el resto del producto) en vez de por texto libre.

---

## ✅ 3. `_cronosBuildLiveMatchId` / `startLiveSync` [CORREGIDO 2026-07-22]

> **Estado: fix aplicado en `js/match/live/sync.js` (`startLiveSync`) y verificado con `scripts/test_startlivesync_idempotent.js` (8/8 PASS, ejecuta el código REAL de la función en sandbox) + `scripts/test_livematchid_idempotency.js` (10/10 PASS, sigue en verde). Detalle completo en `CORRECCIONES_ESTADO.md` → SEC-C4 / bug liveMatchId. Pendiente de commit/deploy.**
>
> El fix quedó en el **llamador** (`js/match/live/sync.js`), no en `_cronosBuildLiveMatchId` (`js/core/utils.js`), que se dejó intacto: la función ya era determinista y tocarla habría invalidado el test existente que documenta por qué NO se restaura el guard ingenuo dentro del builder (`scripts/test_livematchid_idempotency.js`, PARTE C). El problema real estaba en que el llamador añadía un sufijo de hora NUEVO en cada invocación, sin importar si `_cronosBuildLiveMatchId` reutilizaba o no la base.

**Dónde (histórico):** `js/core/utils.js` — se quitó la reutilización del ID estable (riesgo de repetir P1 v167/v168)

**Dónde:** `js/core/utils.js` (función `_cronosBuildLiveMatchId`), commit `7b0a1f2` ("v266B: fix _cronosBuildLiveMatchId - nunca reutilizar ID viejo (siempre con hora)"), ya en `main`.

Todo el trabajo de v167/v168 (documentado extensamente en `CORRECCIONES_ESTADO.md`) consistió en hacer que `liveMatchId` fuera **estable** entre reinicios del mismo partido, precisamente porque un ID inestable rompía la deduplicación de informes al padre (`matchId+playerNumber`) y producía informes duplicados/triplicados.

El commit `7b0a1f2` elimina la rama de reutilización:

```diff
- if (!opts.forceNew && existing) {
-     return existing;
- }
+ // v266: NUNCA reutilizar el ID existente. Siempre generar uno nuevo
+ // con la hora actual para que cada partido tenga un ID Único.
```

y en el llamador (`js/match/live/sync.js:75-82`) se añade un sufijo `HHMM` (`_hourSlug`) calculado con `new Date()` **en cada llamada** a `startLiveSync()`. La variable `existing` se sigue calculando pero ya **no se usa en ningún punto** del `return` — código muerto que además contradice lo que dice el comentario de cabecera de la función (que sigue describiendo el comportamiento "estable" antiguo).

**Motivación del cambio (legítima):** dos partidos distintos el mismo día, mismo equipo y mismo rival, generaban antes el mismo `matchId` y mezclaban eventos. **Pero el fix no distingue "partido distinto" de "reinicio del mismo partido"**: cualquier llamada a `startLiveSync()` que ocurra ≥1 minuto después de la anterior (reconexión, recarga, doble disparo por los múltiples `setTimeout(() => startLiveSync(), 800)` repartidos en `app-init.js`/`import.js`) genera un `matchId` distinto dentro del **mismo** partido.

No encontré una ruta de "resume tras recarga" que dispare esto de forma determinista hoy (confirmado: `active-match.js` sólo *lee* `liveMatchId`, no lo regenera), así que no es una reproducción confirmada — pero el patrón (mismo bug que ya costó tres commits de fix) y el hecho de que ahora hay una feature nueva justo para "pérdida de batería/cobertura" (`retroactive-modal.js`, `PERDIDOS`) que asume reconexiones a mitad de partido, lo hacen un candidato de alta probabilidad para reaparecer.

**Recomendación:** separar los dos conceptos — usar `existing` para reutilizar el ID mientras sea el **mismo** partido activo (mismo `activeConvocation`/fecha/equipo/rival), y sólo generar sufijo nuevo cuando de verdad cambian esos datos (ej. comparar contra un snapshot del partido anterior, no contra "ha pasado un minuto").

---

## ✅ 4-5. P11-D [CORREGIDO 2026-07-22] y deuda de seguridad conocida (sin cambios)

- **P11-D**: restaurado en `js/coach/comms/panel.js` — `window._sendCollectiveReportNow` ya no hace `return` temprano con staff vacío (avisa y sigue escribiendo, visible por `clubId`); `_collStaffUids` (colectivo) y `_allStaffUids` (`autoDispatchMatchReports`) incluyen siempre `me.uid`; logs `[StaffReport] TOTAL ...` en ambos caminos. Verificado con `scripts/test_p11d_collective_write.js` (9/9 PASS, antes en rojo permanente) y retirado de `XFAIL` en `scripts/run-tests.js`. Detalle en `CORRECCIONES_ESTADO.md`.
- **SEC-C1 (create)**: riesgo residual bajo, sin cerrar por diseño (requiere rediseñar el descubrimiento de pendientes por club_admin primero). Sigue abierto.
- **SEC-C3**: test de emulador bloqueado por entorno (JDK 21 no instalable). Sigue sin verificarse el caso de "spoof" de creación cross-club vía `createdBy==uid`. Sigue abierto.

---

## 🟡 6-8. Deuda estructural (arquitectura)

- **Monolitos sin tests unitarios de framework** (Jest/Vitest): `app-init.js` (6407 líneas), `auth.js` (3235), `superadmin.panel.js` (4122), `club-reports.js`, `comms/panel.js`. La cobertura real viene de ~30 scripts en `scripts/test_*.js` que extraen funciones del código fuente con regex/`eval` y las ejecutan en sandbox — funciona, pero es frágil (si cambia el nombre de una función o su firma, el test dejar de encontrarla en vez de fallar por lógica) y no corre en CI estándar (no vi workflow de GitHub Actions ejecutando `npm test`; sólo hay `.github/workflows/` — revisar si está configurado).
- **Buena noticia respecto a `AUDITORIA_LIVESYNC_PARTE1.md`:** la duplicación de `startLiveSync`/`pushLiveSnapshot`/`stopLiveSync` en 3 archivos **ya se resolvió** — hoy sólo existe una copia, en `js/match/live/sync.js`. La recomendación de esa auditoría se aplicó.
- **Pendiente similar para `endMatch`:** sigue habiendo 2 definiciones reales (`player-actions.js:511`, con nota explícita de que queda "eclipsada"; `active-match.js:350`, la que gana según el orden de `<script>`) más 2 wrappers de monkey-patch (`patches.js`, con polling `setTimeout` que sí espera correctamente a que exista la versión final; `sprint3-init.js`, que envuelve `window.endMatch` dentro de un `setInterval` disparado en cuanto detecta las clases `AuditLogger`/`RenderOptimizer` — funciona hoy porque ese disparo ocurre de forma asíncrona después de que todos los `<script>` síncronos ya se ejecutaron, pero es un supuesto implícito, no garantizado, y ya se ha roto antes con este mismo patrón — ver el "HOTFIX informes" en `CORRECCIONES_ESTADO.md`).

---

## 🟢 9-12. Housekeeping (bajo impacto, fácil de arreglar)

- `public/assets/`: `logo.png`, `img_00aa783d.png`, `img_0f3942d4.png`, `img_29448ebf.png`, `img_7a937812.png`, `img_8cb8ccdc.png`, `img_9fb78c0a.png`, `img_b19deec4.png`, `img_e7cb36f5.png` son **el mismo archivo** (md5 idéntico), 150.350 bytes cada uno → ~1,2 MB muertos servidos en cada deploy de Hosting.
- Código muerto confirmado por tamaño/uso: `js/roster/team-management.js` (1 línea), `js/match/substitutions.js` (16 líneas, stub), `js/coach/reports/generator.js` (521 líneas, `ReportGenerator` nunca se instancia — ya lo confirmó `CORRECCIONES_ESTADO.md`), `js/services/firestore-sync.js`/`cloud-data.js` (wrappers mínimos).
- `functions/package.json`: `firebase-admin@^12` / `firebase-functions@^5` (Gen 1) siguen desactualizados; el punto crítico de esa auditoría (`functions.config()`) **ya se corrigió** (sólo queda `process.env`), buena noticia.
- Archivos sueltos en la raíz sin encaje claro en el build: `diff_1_tactical_move.txt`/`diff_2_retroactive_fix.txt`/`diff_3_wiring.txt` (son `git show` de commits ya mergeados, valen como nota pero no como archivo permanente), `_commitmsg.txt`/`_commitmsg3.txt`, `usuarios_temp.json` (¡nombre sugiere PII! aunque está en `.gitignore`, confirmar que nunca se commiteó: `git log --all -- usuarios_temp.json`), `jdkinstall.txt` (si documenta instalación de JDK local, no pertenece al repo del producto).

---

## Qué NO se encontró (puntos positivos)

- El API web de Firestore/Auth ya usa exclusivamente la API modular (v9+), sin rastros de la API `compat`.
- La duplicación de `startLiveSync` ya está resuelta (una sola fuente de verdad).
- El fallback deprecado `functions.config()` ya se eliminó del código activo.
- No se detectó uso de `eval`/`innerHTML` con datos de usuario sin sanitizar en una revisión rápida de los paneles admin (no exhaustiva — recomendable un pase específico de XSS si no se ha hecho).

---

## Orden de trabajo sugerido

1. **Antes de cualquier deploy de reglas:** cerrar el hueco de `transitionalRead()` (hallazgo #1) — es el único que expone PII de menores entre clubes distintos.
2. **Ahora mismo, sin esperar a nada:** borrar `usuarios_temp.json` de la carpeta OneDrive (hallazgo #2) y mover/eliminar los 5 scripts de `functions/` con el secreto OAuth (hallazgo #3) — ambos son fixes de minutos y cero riesgo de romper nada.
3. **Antes de la próxima jornada de partidos:** decidir sobre `_cronosBuildLiveMatchId` (hallazgo #4) — si la feature de "PERDIDOS/reconexión" ya está en producción, este es el bug con más probabilidad de manifestarse pronto y ya sabemos exactamente qué síntoma produce (informes duplicados al padre) por experiencia previa.
4. Restaurar el fix de P11-D (hallazgo #5) y añadir `auditLogger` + borrado lógico al vaciado de mensajes (hallazgo #6) antes de dar el WIP de comunicaciones por bueno.
5. Cambiar el emparejamiento por nombre en `replay-player.js` a `p.number`/`p.id` (hallazgo #8) antes de que el módulo de repeticiones llegue a más partidos reales.
6. Retomar SEC-C1/SEC-C3 (ya en el radar, sólo priorizar cuándo).
7. El resto (monolitos, duplicación de `endMatch`, housekeeping, CI, `.gitattributes`) es deuda técnica de fondo: no bloquea nada hoy, pero cada nuevo bug de "función ganadora según el orden de script" seguirá costando sesiones enteras de debugging mientras no se unifique.
