# 📋 Registro de solicitudes de derechos — Chronos Fútbol

Registro de las solicitudes de derechos (RGPD arts. 15-22) que **llegan a Chronos** o en
las que Chronos **asiste** a un club. Procedimiento en `PROTECCION_DATOS.md` Parte 7.

> 🔒 **Sin datos personales.** El solicitante se identifica por rol y club («familiar,
> club A», «jugador adulto, ente B»). El detalle nominal y la correspondencia se
> guardan fuera del proyecto (`CRONOS_RESPALDOS_PRIVADOS`), sólo lo necesario y
> mientras haga falta para acreditar la respuesta.

---

## 1 · Quién responde y en qué plazo

- **Responsable:** el **club**. Chronos es encargado (`encargo.html` §4).
- **Si la solicitud llega a Chronos:** se traslada al club en **5 días hábiles**, sin
  contestar el fondo por él, y se le ayuda a atenderla.
- **Plazo de respuesta al interesado:** **un mes** desde que la recibe el club,
  prorrogable dos meses más si es compleja, avisando dentro del primer mes (art. 12.3).
- **Gratuito**, salvo que la solicitud sea manifiestamente infundada o excesiva (art. 12.5).
- **Identidad:** el club verifica que quien pide es el interesado o su representante
  legal (con menores, quien ejerce la patria potestad).

## 2 · Cómo se atiende cada derecho en la plataforma

| Derecho | Medio | Quién lo ejecuta |
|---|---|---|
| Acceso (art. 15) | paneles + exportación de informes (TXT/PDF) | el club |
| Rectificación (art. 16) | paneles | el club |
| Supresión (art. 17) | baja con purga en cascada (`functions/purga_usuario.js`) | el club o el SuperAdmin |
| Limitación (art. 18) | bloqueo temporal de usuario (v853) | el SuperAdmin, a petición del club |
| Portabilidad (art. 20) | «📦 Datos de un jugador»: JSON + 2 CSV (v848) | Dirección / Admin de Club |
| Oposición (art. 21) | por solicitud, la gestiona el club | el club |
| Decisiones automatizadas (art. 22) | no aplica: la app no perfila | — |

> Las **bajas hechas desde la propia app** quedan registradas en la plataforma
> (`deletion_requests`, `audit_logs`) y no se copian aquí una a una. Este registro es
> para las solicitudes que llegan **por otra vía** (correo, teléfono, escrito) o que
> necesitan la intervención de Chronos.

## 3 · Plantilla

Copiar debajo del último registro y rellenar.

### DER-AAAA-NNN · derecho · club

| Campo | Valor |
|---|---|
| Recibida | fecha · vía (correo, app, escrito) · por Chronos o por el club |
| Solicitante | rol y club (sin nombre) · ¿menor? ¿representante? |
| Derecho | acceso / rectificación / supresión / limitación / portabilidad / oposición |
| Traslado al club | fecha (≤ 5 días hábiles) / no procede (llegó al club) |
| Identidad verificada | sí, por el club (cómo) / no |
| Actuación | qué se hizo, con qué herramienta |
| Respuesta al interesado | fecha (≤ 1 mes) · por el club |
| Prórroga | no / sí, motivo y fecha del aviso |
| Denegación | no / sí, motivo (art. 12.5, 17.3…) e información sobre reclamar ante la AEPD |
| Estado | abierta / cerrada (fecha) |

---

## 4 · Registro

_(Ninguna solicitud de derechos anotada a 2026-11-22.)_
