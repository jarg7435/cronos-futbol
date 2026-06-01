# Cronos Fútbol — Estado de correcciones

_Última actualización: 2026-06-01 (sesión E3)_

## COMPLETADO

- [x] **C1**: Doble init Firebase eliminada (`cronos_post_update` movido a `firebase-init.js`)
- [x] **E1**: Goles bloqueados en banquillo; tarjetas y lesiones siempre visibles (`js/match/events/player-actions.js`)
- [x] **E2**: `deleteAuthUser` robusto + email liberado
  - Servidor (`functions/index.js`): resuelve UID real por email ante `auth/user-not-found`; distingue `alreadyAbsent`.
  - Cliente (`js/admin/superadmin/superadmin.panel.js`): `saSetClubUserStatus` y `saPurgeUser` abortan el borrado (aviso 🚫) si Auth falla por motivo distinto a `auth/user-not-found`.
  - Desplegado: Cloud Function `deleteAuthUser(us-central1)` + hosting. Commit `712d718` en `main`.

- [x] **E3**: Informes colectivos ahora llegan a coordinadores/directores
  - Causa: `_sendCollectiveReportNow` (`js/coach/comms/panel.js`, botón "Informe Colectivo → Dirección") guardaba los documentos `cronos_player_reports` con `type:'collective_match_report'` pero **sin** `staffReport:true`.
  - El panel de Dirección (`js/coach/reports/club-reports.js` → `_sdLoadReports`) filtra exclusivamente `data.staffReport === true`, por lo que esos informes nunca aparecían.
  - Fix: añadido `staffReport: true` al documento por jugador en `_sendCollectiveReportNow` (línea ~3107). Verificado con test de filtro (doc nuevo visible; doc antiguo sin flag, oculto).

## PENDIENTE (empezar por E4)

- [ ] **E4**: Informe individual triplicado a padres
- [ ] **E5**: Entradas/salidas duplicadas en línea de tiempo
- [ ] **E6**: Crono live sin progreso segundo a segundo
- [ ] **E7**: Tiempos con redondeo en informes
- [ ] **E8**: Zoom deshabilitado
- [ ] **E9**: Vista vertical móvil
- [ ] **C2**: Custom claims al aprobar usuarios (tras E1-E9)

## Notas técnicas

- Sin trackear: `firestore.rules.BACKUP` (no incluido en commits).
- Avisos Firebase no bloqueantes: `firebase-functions` desactualizado; `functions.config()` deprecado (límite marzo 2027).
- Entorno Windows: cmd requiere `chcp 65001` por acentos en la ruta del proyecto.
