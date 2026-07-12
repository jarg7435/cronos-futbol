/**
 * js/services/firestore-sync.js
 *
 * v276 (unificación de live-sync): este archivo ALOJABA copias legacy de
 * startLiveSync / pushLiveSnapshot / stopLiveSync que, por orden de <script>
 * en index.html, GANABAN al resto (última declaración gana). Se han ELIMINADO
 * y la fuente única de verdad es ahora js/match/live/sync.js, que:
 *   - emite phaseStartedAt (crono autónomo en live.html),
 *   - emite timerThresholds del club (semáforo),
 *   - emite createdBy/coachEmail (permiso de vista),
 *   - emite colores por jugador (portados desde esta copia),
 *   - late cada 5000ms SOLO con isRunning y con guard anti-doble-intervalo.
 *
 * El estado auxiliar (liveMatchStartTime, LIVE_MATCH_MAX_MS) se retiró con las
 * funciones: solo se escribía aquí, nunca se leía en ningún otro sitio.
 *
 * El archivo se conserva (referenciado por index.html) para no alterar el
 * orden de carga de <script>.
 */

