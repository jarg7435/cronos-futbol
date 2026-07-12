# Auditoría formal — Parte 1: Duplicación de `pushLiveSnapshot` / `startLiveSync`

_Fecha: 2026-07-12 · Método: verificación empírica (no suposición) vía `scripts/audit_livesync_duplication.js` (16/16 PASS)._

## Resumen ejecutivo

Existen **3 copias globales** de `startLiveSync`, `pushLiveSnapshot` y `stopLiveSync`,
todas como `async function …(){}` en scripts **clásicos** a nivel global. Por la
semántica de "última declaración gana", **la copia que corre en producción es
`js/services/firestore-sync.js`**, la última en el orden de `<script>` de
`index.html`. Los comentarios del código asumen erróneamente que la copia activa
es `js/match/live/sync.js`.

La copia ganadora es la **más antigua / pobre en features**: no emite varios
campos que `live.html` sí consume, degradando funciones ya implementadas.

## Censo de copias

| Función | `js/core/app-init.js` (L1258) | `js/match/live/sync.js` (L1289) | `js/services/firestore-sync.js` (L1292 ← **gana**) |
|---|:---:|:---:|:---:|
| `startLiveSync`   | L1456 | L53  | **L17** |
| `pushLiveSnapshot`| L1496 | L205 | **L63** |
| `stopLiveSync`    | L1563 | L357 | **L107** |

Además, `js/ai/import.js` (L1303, tras la ganadora) **llama** a `startLiveSync()`
pero no la redefine, así que usa la copia de `firestore-sync.js`.

## Demostración del ganador (no suposición)

`scripts/audit_livesync_duplication.js` extrae el texto REAL de las 3 copias de
`pushLiveSnapshot`, las declara en el MISMO orden que `index.html` en un único
contexto (reproduciendo el hoisting con reasignación del navegador), ejecuta la
superviviente con un `import()` de Firestore interceptado y captura el snapshot.

Snapshot del ganador:

| Campo | Ganador (`firestore-sync.js`) | `match/live/sync.js` | ¿`live.html` lo consume? |
|---|:---:|:---:|:---:|
| `phaseStartedAt`  | ❌ no | ✅ sí | ✅ **sí** (crono autónomo) |
| `timerThresholds` | ❌ no | ✅ sí | ✅ **sí** (semáforo del club) |
| `createdBy` / `coachEmail` / `clubName` | ❌ no | ✅ sí | ✅ sí (respaldo/permiso) |
| `clubId` | ✅ sí | ✅ sí | ✅ sí (permiso primario) |
| `players[].color/shortsColor/textColor` | ✅ sí | ❌ no | ✅ sí |
| `setDoc({ merge: true })` | ✅ sí | ✅ sí | — |

## Impacto (regresiones reales)

1. **Crono autónomo roto** (`phaseStartedAt`). `live.html` (L1750, L2276, L2962)
   cuenta el reloj de forma independiente cuando el entrenador cierra la app usando
   el instante absoluto `phaseStartedAt`. El ganador NO lo emite → el espectador se
   queda sin el avance segundo a segundo en background (relacionado con E6).

2. **Semáforo del club roto** (`timerThresholds`). `live.html` (L2547) pinta los
   colores rojo/amarillo con los umbrales del Director (`clubs/{id}.timerThresholds`).
   El ganador NO los emite → cae a defaults 33/50 → colores distintos entre coach y
   live para el mismo jugador.

3. **Degradación menor de permisos** (`createdBy` / `coachEmail`). El permiso
   primario en `_userCanFollow` es `m.clubId === userData.clubId`, que el ganador
   SÍ emite → el staff del mismo club sigue viendo el partido. Se pierden solo las
   rutas de respaldo: coach sin `clubId`, y el display del email para superadmin/admin.

## Divergencias de comportamiento en `startLiveSync`

| Aspecto | Ganador (`firestore-sync.js`) | `match/live/sync.js` | `app-init.js` |
|---|---|---|---|
| Periodo del intervalo | **1000 ms** | 5000 ms | 5000 ms |
| ¿Empuja en pausa? | No (`liveIsActive && isRunning`) | Sí (`liveIsActive`) | Sí (`liveIsActive`) |
| Guard anti-doble-intervalo | ❌ **fuga de timers** | ❌ | ✅ `clearInterval` previo |
| Reset del array `events` (v265) | ❌ | ✅ | ❌ |

- **Fuga de timers**: el ganador hace `setInterval` sin `clearInterval(liveSyncTimer)`
  previo. Si `startLiveSync()` se invoca 2× (p. ej. share-modal + import), deja
  intervalos huérfanos empujando snapshots en paralelo. Solo `app-init.js` (perdedora)
  tiene el guard correcto.

## Recomendación

Unificar en un **único módulo** (`js/match/live/sync.js` es el candidato por ser
el más completo) y eliminar las otras dos copias. El módulo unificado debe:
- Emitir `phaseStartedAt`, `timerThresholds`, `createdBy/coachEmail/clubName`
  **y** los colores por jugador (fusionar lo mejor de las 3).
- Usar `setDoc({ merge: true })` y NO incluir `events` (arrayUnion aparte, v246).
- Incluir el guard `clearInterval(liveSyncTimer)` antes del `setInterval`.
- Decidir un único periodo/condición de push (recomendado: 1000 ms, y empujar
  también en pausa para reflejar cambios de banquillo/tarjetas al instante).

Mientras tanto, la deuda ya estaba anotada en `CORRECCIONES_ESTADO.md` (E5) como
"unificar las definiciones globales redundantes".

## Reproducción

```
node scripts/audit_livesync_duplication.js   # 16/16 PASS
```
