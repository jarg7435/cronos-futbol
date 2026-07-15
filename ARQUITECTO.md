# 🏗️ ARQUITECTO — CRONOS FÚTBOL
> **Última actualización:** 2026-07-15
> **Versión App:** 1.0.0 · Sprint 3 activo
> **Stack:** Vanilla JS + Firebase (Hosting / Firestore / Functions)
> **Deploy:** Firebase Hosting → `cronos-futbol-app` (prod) / `cronos-futbol-staging` (staging)

---

## 📐 ARQUITECTURA GLOBAL

```
ROOT/
├── index.html          ← SPA principal (83 KB) — carga todos los módulos JS
├── live.html           ← Vista pública partido en vivo (180 KB)
├── landing.html        ← Landing marketing (30 KB)
├── style.css           ← Estilos globales (35 KB)
├── sw.js               ← Service Worker PWA (41 KB) — cache + offline
├── firebase.json       ← Hosting / Firestore / Functions config
├── firestore.rules     ← Reglas de seguridad (43 KB) — ACTIVO
├── firestore.indexes.json
├── functions/
│   └── index.js        ← Cloud Functions (47 KB) — backend serverless
└── js/                 ← Módulos frontend (organizados por dominio)
    ├── core/           ← Bootstrap, estado, utilidades globales
    ├── services/       ← Firebase, auth, storage, sync
    ├── match/          ← Lógica partido (timer, eventos, live, persistencia)
    ├── ui/             ← Render, drag-drop, bench
    ├── roster/         ← Formaciones, plantilla
    ├── coach/          ← Entrenamiento, informes, comunicaciones
    ├── admin/          ← Paneles admin (club, individual, superadmin, billing)
    ├── parent/         ← Panel padres/tutores
    ├── ai/             ← Módulo IA (importación)
    └── shared/         ← Utilidades compartidas entre admin y coach
```

---

## 📂 MAPA DE MÓDULOS

### js/core/ — Núcleo de la aplicación
| Archivo | KB | Responsabilidad |
|---|---|---|
| app-init.js | 309 | 🔴 Inicialización principal, estado global, orquestador |
| setup-modal.js | 64 | Modal configuración inicial de partido |
| patches.js | 21 | Parches y fixes aplicados en runtime |
| staff-and-comms.js | 17 | Gestión staff + comunicaciones básicas |
| event-listeners.js | 16 | Registro centralizado de event listeners |
| utils.js | 13 | Utilidades generales (fecha, formato, validación) |
| accessibility-wcag.js | 9 | Accesibilidad WCAG |
| render-optimizer.js | 7 | Optimización de renders |
| sprint3-init.js | 6 | Inicialización funcionalidades Sprint 3 |
| pseudonymizer.js | 8 | Pseudonimización de datos (GDPR) |
| security-and-state.js | 2 | Seguridad y gestión de estado |
| logger.js | 1 | Logger centralizado |

### js/services/ — Capa de servicios / Firebase
| Archivo | KB | Responsabilidad |
|---|---|---|
| auth.js | 173 | 🔴 Autenticación completa (login, roles, sesión) |
| firestore-storage.js | 21 | CRUD Firestore + Storage |
| user-management.js | 18 | Gestión usuarios (crear, editar, roles) |
| auth-improvements.js | 15 | Mejoras auth (2FA, validaciones extras) |
| offline-manager.js | 12 | Gestión modo offline + sync cola |
| firebase-init.js | 11 | Inicialización SDK Firebase |
| training-firestore-sync.js | 10 | Sync entrenamientos ↔ Firestore |
| audit-logger.js | 7 | Log de auditoría (acciones críticas) |
| notification-dismiss-sync.js | 4 | Sync dismissal notificaciones |
| email-whatsapp.js | 3 | Envío email/WhatsApp vía EmailJS |
| firestore-sync.js | 1 | Sync genérico Firestore |
| cloud-data.js | 1 | Acceso datos cloud (stub/wrapper) |

### js/match/ — Lógica de partido
| Archivo | KB | Responsabilidad |
|---|---|---|
| events/player-actions.js | 32 | Acciones de jugador (gol, tarjeta, sustitución) |
| live/sync.js | 33 | 🔴 Sync partido en vivo → Firestore realtime |
| persistence/active-match.js | 30 | Persistencia estado partido activo |
| persistence/team-persistence.js | 28 | Persistencia equipo durante partido |
| events/movement-log.js | 25 | Registro de movimientos y cambios |
| timer/core.js | 12 | Cronómetro principal |
| demo-tutorial.js | 9 | Modo demo/tutorial |
| substitutions.js | 1 | Lógica sustituciones (stub vacío) |

### js/ui/ — Interfaz de usuario
| Archivo | KB | Responsabilidad |
|---|---|---|
| render.js | 23 | Renderizado de vistas principales |
| drag-drop.js | 11 | Drag & drop jugadores |
| bench-scroll.js | 2 | Scroll banquillo |

### js/roster/ — Gestión plantilla
| Archivo | KB | Responsabilidad |
|---|---|---|
| formations.js | 6 | Formaciones tácticas |
| legacy-formations.js | 1 | Formaciones antiguas (legacy) |
| team-management.js | 0 | Gestión equipo (stub vacío) |

### js/coach/ — Panel Entrenador
| Archivo | KB | Responsabilidad |
|---|---|---|
| reports/club-reports.js | 119 | 🔴 Informes de club (estadísticas, exportación) |
| training/panel.js | 24 | Panel de entrenamientos |
| reports/generator.js | 19 | Generador de informes PDF/HTML |

### js/admin/ — Paneles Administración
| Archivo | KB | Responsabilidad |
|---|---|---|
| superadmin/superadmin.panel.js | 212 | 🔴 Panel superadmin completo |
| club/panel.js | 127 | Panel administrador de club |
| individual/panel.js | 75 | Panel usuario individual |
| superadmin/billing.js | 62 | Facturación (superadmin) |
| superadmin/extras.js | 46 | Funciones extra superadmin |
| shared/whatsapp-email.js | 70 | WhatsApp/Email masivo (admin) |
| shared/admin-shared.js | 4 | Utilidades compartidas admin |
| billing/payments.js | 8 | Pagos genéricos |
| billing/ui.js | 3 | UI billing |

### js/parent/ & js/ai/
| Archivo | KB | Responsabilidad |
|---|---|---|
| parent/panel.js | 114 | Panel de padres/tutores |
| ai/import.js | 53 | Importación IA (jugadores, datos) |

---

## 🗄️ FIRESTORE — COLECCIONES PRINCIPALES

```
clubs/
  {clubId}/
    teams/
      {teamId}/
        players/
        matches/
        trainings/
users/
  {userId}/
    profile
    notifications/
liveMatches/
  {matchId}/            ← Sync realtime para live.html
```

Reglas de seguridad: firestore.rules (43 KB) — revisar antes de cambios

---

## ☁️ CLOUD FUNCTIONS (functions/index.js — 47 KB)

- Gestión de usuarios y roles (custom claims)
- Triggers Firestore (onCreate, onUpdate)
- Envío de emails/notificaciones
- Validaciones server-side
- Billing/pagos

---

## 🔑 ROLES Y PERMISOS

| Rol | Acceso |
|---|---|
| superadmin | Todo el sistema, todos los clubes |
| club_admin | Su club completo |
| coach | Sus equipos asignados |
| parent | Solo datos de sus hijos |
| player | Solo sus propios datos |

---

## 🏃 COMANDOS RÁPIDOS

```bash
npm run dev                    # Firebase serve local (hosting + functions)
npm run deploy:hosting         # Solo hosting
npm run deploy:functions       # Solo functions
npm run deploy:rules           # Solo reglas Firestore
npm run deploy:prod            # Todo a producción
npm run deploy:staging         # Todo a staging
npm run lint                   # ESLint check
npm run lint:fix               # ESLint autofix
npm run format                 # Prettier format
```

---

## 📋 ESTADO ACTUAL DEL PROYECTO

### ✅ Completado (Sprint 3)
- Sistema de autenticación multi-rol
- Live sync partido en tiempo real
- Panel superadmin completo
- Informes y estadísticas
- PWA + offline manager
- Auditoría de acciones críticas
- Sistema de notificaciones
- Integración WhatsApp/Email

### 🔄 En Progreso
- (actualizar aquí)

### ⚠️ Deuda Técnica / Issues Conocidos
> Ver también: CORRECCIONES_ESTADO.md, AUDITORIA_FIREBASE_DEPRECADOS.md, AUDITORIA_LIVESYNC_PARTE1.md
- app-init.js (309 KB) — monolítico, candidato a split
- auth.js (173 KB) — grande, pendiente de refactor
- substitutions.js / team-management.js / end-and-reports.js — stubs sin implementar
- firestore-sync.js / cloud-data.js — wrappers mínimos (verificar si necesarios)

---

## 🔄 CHANGELOG DE SESIONES

### 2026-07-15 — Sesión inicial
- ✅ Creado ARQUITECTO.md como workspace del arquitecto
- 📊 Mapeada arquitectura completa del proyecto (todos los módulos con KB)

---

## 📌 PROTOCOLO DE TRABAJO EFICIENTE

### Al pedir cambios, indicar:
1. Archivo exacto (usar tabla de módulos arriba)
2. Qué cambiar (función, sección, comportamiento)
3. Por qué (bug / mejora / nueva feature)

### Prefijos de tarea:
- 🐛 FIX:     Corrección de bug
- ✨ FEAT:    Nueva funcionalidad
- ♻️ REFACTOR: Mejora de código sin cambio funcional
- 📦 DEPLOY:  Tarea de despliegue
- 🔒 SEC:     Seguridad / reglas Firestore
- 🎨 UI:      Cambios visuales

### Proceso al iniciar sesión:
1. Referenciar este archivo para contexto
2. Indicar tipo de tarea con prefijo
3. El arquitecto actualizará el Changelog al finalizar
