# 🔐 Propuesta: segundo factor (MFA) para la cuenta de SuperAdmin — Chronos Fútbol

| | |
|---|---|
| **Fecha** | 2026-11-23 |
| **Estado** | **PROPUESTA** — no se ha aplicado nada en Auth, código ni despliegues |
| **Titular / autoriza** | José Alberto Romero García |
| **Situación actual** | MFA **desactivado** en producción y testeo. Auth sólo con correo + contraseña. App Check **ENFORCED** en Auth |
| **Relacionado** | `PENTEST_ALCANCE.md` (S2, S7), `RECUPERACION.md`, `VALIDACION_E2E_Y_APPCHECK.md` §3.3 |

> El SuperAdmin puede leer y purgar datos de todos los clubes. Hoy basta su contraseña para
> entrar. Con un segundo factor, una contraseña robada ya no sirve para entrar.
> Cada paso marcado 🔐 se hace sólo con permiso expreso del titular.

---

## 1. Qué factor: TOTP (recomendado)

Códigos de 6 dígitos en una app del móvil (Google Authenticator, Microsoft Authenticator,
Authy…).

| | TOTP | SMS |
|---|---|---|
| Coste por uso | **0** | cada SMS se paga |
| Robo por duplicado de SIM | **no** | sí |
| Necesita reCAPTCHA extra | no | sí |
| Funciona sin cobertura | **sí** | no |

---

## 2. Qué implica en Auth (por proyecto)

1. **Pasar a «Firebase Authentication with Identity Platform».**
   - Con menos de 50.000 usuarios activos al mes, el coste no cambia.
   - ⚠️ Según la documentación de Firebase, **no se puede deshacer**. Por eso se hace
     primero en testeo.
2. **Activar MFA tipo TOTP** en la configuración del proyecto.
   - Activarlo **no obliga a nadie**: sólo usa segundo factor quien lo da de alta.
   - Clubes, familias, entrenadores y Dirección **no notan nada**.
3. **Alta del factor**: la hace **sólo el SuperAdmin**, desde su propia sesión.
4. **Un solo factor TOTP por cuenta, con la misma clave en 2 aparatos** (móvil y reserva).
   - ⚠️ **Medido en testeo el 24-11:** con un factor dado de alta, el segundo lo rechaza el
     servidor con `auth/maximum-second-factor-count-exceeded`. Firebase admite **un solo
     factor TOTP** por cuenta. El plan inicial de 2 factores separados no es posible.
   - **Reserva (opción 1, aprobada por el titular el 24-11):** en la pantalla de alta, la
     **misma clave secreta** se escribe en los dos aparatos antes de confirmar. Los dos dan el
     mismo código. La pantalla de alta y el aviso de «máximo» lo explican (v863).
   - Para añadir la reserva a un factor ya dado de alta: quitar el factor
     (`scripts/ops/mfa_quitar_factor.js`) y volver a darlo de alta con la clave en los dos.
   - Firebase **no da códigos de recuperación**.
   - Si se pierden todos los aparatos, el factor se quita con un script que usa la cuenta de
     servicio (Admin SDK, `updateUser(uid, { multiFactor: { enrolledFactors: [] } })`).
   - Ese procedimiento se añade a `RECUPERACION.md`.

---

## 3. Qué implica en el inicio de sesión (código)

Con MFA activo, Firebase responde `auth/multi-factor-auth-required` en vez de abrir la
sesión. Hoy **ningún** punto de la app trata ese error, así que el SuperAdmin se quedaría
fuera de estos 5 caminos:

| # | Dónde | Camino |
|---|---|---|
| 1 | `js/services/auth.js:2262` | inicio de sesión normal |
| 2 | `js/services/auth.js:2450` | registro con un correo que ya tiene cuenta (añadir rol) |
| 3 | `live.html:1999` | visor de partidos. Hoy diría «Email o contraseña incorrectos», que confunde |
| 4 | `js/services/auth/password.js:360` | reautenticar para cambiar la contraseña |
| 5 | `js/admin/superadmin/diagnostico.js:930` | confirmar con contraseña en el diagnóstico del SuperAdmin |

**El cambio sería añadir código, sin tocar lo que ya funciona:**

- **Módulo nuevo `js/services/auth/mfa.js`:**
  - pide el código de 6 dígitos;
  - completa el acceso (`getMultiFactorResolver` → `TotpMultiFactorGenerator.assertionForSignIn`
    → `resolver.resolveSignIn`);
  - en la reautenticación, igual, pero con `reauthenticate`.
- **En cada uno de los 5 puntos**, sólo una rama nueva para ese código de error. El resto
  del flujo queda igual.
- **Pantalla de alta del factor, visible sólo para el SuperAdmin:**
  - genera el secreto (`TotpMultiFactorGenerator.generateSecret`);
  - muestra la clave y el enlace `otpauth://` para la app;
  - confirma con un primer código.
- La versión del SDK que ya se usa (10.12.2) incluye TOTP: no hace falta cambiar de versión.
- Guards nuevos:
  - simulan el error y comprueban que se pide el código;
  - comprueban que un código erróneo no abre sesión;
  - comprueban que una cuenta sin MFA entra igual que hoy.

**Otros efectos:**

- La sesión es **por pestaña** (`browserSessionPersistence`): el código se pedirá en cada
  pestaña nueva.
- App Check está ENFORCED en Auth. Las llamadas de MFA van al mismo servicio
  (`identitytoolkit`), así que deberían funcionar igual, pero **hay que comprobarlo** en
  testeo.

### Fase 2 (opcional, más adelante)

Exigir en `firestore.rules`, `storage.rules` y en las *callables* de SuperAdmin que la sesión
se haya abierto con segundo factor (`request.auth.token.firebase.sign_in_second_factor`).
Así, ni siquiera una sesión antigua sin segundo factor conserva los poderes de SuperAdmin.

---

## 4. Cómo se prueba primero en testeo

| Paso | Qué | Tipo |
|---|---|---|
| T1 | Leer la configuración de Auth de testeo y producción: si ya tienen Identity Platform y el estado de `mfa` | Lectura |
| T2 | Pasar `cronos-futbol-test` a Identity Platform y activar TOTP | **Escritura en nube 🔐** |
| T3 | Programar `mfa.js`, las 5 ramas y la pantalla de alta, con sus guards (`npm run verify` en verde) | **Código 🔐** |
| T4 | `npm run deploy:staging` | **Despliegue a testeo 🔐** |
| T5 | Con el SuperAdmin de testeo: dar de alta el factor con la misma clave en 2 aparatos y probar los 5 caminos | Prueba del titular |
| T6 | Casos negativos: código erróneo; código caducado; quitar el factor por script (simula perder el móvil) y volver a darlo de alta; una cuenta de otro rol sin MFA entra igual que hoy | Prueba del titular (+ script 🔐) |
| T7 | Documentar la recuperación en `RECUPERACION.md` | **Documentación 🔐** |

### Resultado de T5–T6 en testeo (v863, 24-11-2026) — ✅ cerrados

Factor retirado con `mfa_quitar_factor.js --proyecto test --quitar` (~01:40 UTC) y dado de
alta de nuevo con la **misma clave en los 2 aparatos** (13:28:38 UTC); ficha INC-2026-005.

| Camino | Resultado |
|---|---|
| Login desde cero | código malo no entra ✅ · Cancelar vuelve atrás ✅ · código bueno entra, **con cada uno de los 2 aparatos** ✅ |
| Cambio de contraseña (reautenticación) | ✅ (24-11, antes de la nueva alta) |
| `live.html` | ✅ (24-11) |
| Clave maestra de Diagnóstico (usuario del club de prueba) | código malo ✅ · Cancelar ✅ · código bueno ✅ |
| Registro con el mismo correo | código malo ✅ · Cancelar ✅ · **positivo no probado a propósito**: añadiría un rol o una solicitud a la cuenta SA, y el código lo resuelve la misma `CronosMFA.resolver` que el login |
| Otra cuenta sin factor (entrenador) | entra sin código, igual que antes ✅ |
| Quitar el factor por script y volver a darlo de alta | ✅ (paso anterior) |
| Código caducado | no probado por separado (Firebase lo rechaza como un código malo) |
| Comprobaciones de lectura (14:13 UTC) | `test_mfa_superadmin.js` 45/45 · `npm run verify` 361/362 (el que falló, `test_ocultar_coordinador_rules.js`, fue un `ECONNRESET` de red y dio 14/14 al repetirlo) · 1 factor «Móvil» TOTP en testeo |

Producción sin tocar (hosting v860, Identity Platform sin activar).

## 5. Paso a producción (sólo después de T5–T6 aprobados por el titular)

1. **Hosting** con el código de MFA (`deploy:prod` 🔐). No cambia nada para nadie mientras no
   haya factores dados de alta.
2. **Identity Platform + TOTP** en `cronos-futbol-app` 🔐.
3. **Alta del factor** del SuperAdmin real, con la misma clave en los 2 aparatos, y prueba de los 5 caminos.
4. **Fila en `VALIDACION_E2E_Y_APPCHECK.md` §3.3**, con la medición de App Check y de las
   reglas.

## 6. Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| El SuperAdmin pierde el móvil | Misma clave en un 2.º aparato + script de recuperación probado en T6 |
| Quien tenga la clave secreta genera códigos | La clave sólo se escribe en los 2 aparatos propios, sin captura ni copia. Si se sospecha que se ha filtrado, se quita el factor y se da de alta con una clave nueva |
| Identity Platform no tiene vuelta atrás | Primero en testeo. Mientras se quede en el plan gratuito, no cambia nada para el resto de cuentas |
| Un camino de acceso olvidado deja fuera al SuperAdmin | Los 5 puntos se han localizado por búsqueda en todo el repositorio. Un guard fija que cada uno trate el error |
| App Check rechaza las llamadas de MFA | Se comprueba en testeo (T5), antes de tocar producción |

## 7. Decisiones pendientes del titular

1. ¿Se aprueba TOTP como factor?
2. Permiso para T2, T3 y T4, uno a uno.
3. ¿Fase 2 (exigir el segundo factor en reglas y *callables*) ahora o más adelante?
