# 📶 Prueba de campo: pérdida de red — Chronos Fútbol

Guion para comprobar **con aparatos reales** que un partido sobrevive a la pérdida de
cobertura. Es el punto «prueba de campo de pérdida de red en dispositivos reales» de la
reauditoría del 19-11 (`VALIDACION_E2E_Y_APPCHECK.md` §4 lo marca hoy como pendiente).

> 🧪 **Siempre en TESTEO** (`https://cronos-futbol-test.web.app`), con las cuentas
> ficticias del club **E2E CLUB NORTE** (`scripts/semilla_e2e_testeo.js`). Nunca en
> producción.

---

## 1 · Lo que se prueba (cómo se comporta la app sin red, según el código)

- **Los sucesos esperan en el aparato** (cola por partido, `js/match/live/outbox.js`,
  v724) y salen solos al volver la red, en orden.
- **El reloj del entrenador sigue en local**: no depende de la red.
- **El visor deriva su reloj** del instante de inicio de la fase, y al volver la red
  **se resincroniza solo** (v567).
- **«Recuperar partido»** reabre el partido en curso con su reloj y su cola.
- **Un vídeo que no puede subir se cancela a los ~45 s** con aviso, sin perder el
  suceso (v836).

## 2 · Material y preparación (10 min)

| | Aparato | Cuenta (contraseña común de testeo) |
|---|---|---|
| **A · entrenador** | **iPad** | `jarg7435+e2enortecoach@gmail.com` (Entrenador Norte, Alevín A) |
| **B · visor** | **móvil** | `jarg7435+e2enortedirector@gmail.com` (Director Norte) |

1. **En el iPad, instala testeo como app aparte**: Safari → `https://cronos-futbol-test.web.app`
   → Compartir → «Añadir a pantalla de inicio». Así no se mezcla con la app de
   producción y **puede abrirse sin red** (escenario E3).
2. En los dos aparatos, entra con su cuenta y **comprueba el sello «CHRONOS v860»** (o
   superior) abajo a la derecha. Si sale uno anterior, cierra y vuelve a abrir.
3. **iPad:** crea un **partido de prueba** de Alevín A (rival «Prueba»), elige titulares
   y llega a la pantalla del partido sin arrancar el reloj.
4. **Móvil:** como Director Norte, abre **Partidos en vivo** y entra en ese partido.
5. Ten a mano el **reloj del móvil** para anotar horas y haz **capturas con el sello
   visible**.

**Cómo cortar la red:**
- **iPad:** Centro de control (desliza desde la esquina superior derecha) → **modo
  avión**. ⚠️ Comprueba que el **Wi-Fi también se apaga** (en iPad el modo avión puede
  dejarlo encendido si lo activaste antes a mano): el icono de Wi-Fi debe quedar gris.
- **Móvil:** igual, modo avión desde el Centro de control (iPhone) o el panel rápido
  (Android), con el Wi-Fi apagado.
- **Volver la red:** quitar el modo avión y esperar a que vuelva el icono de Wi-Fi o de
  datos.

---

## 3 · Escenarios

> Para cada uno: **anota la hora** de cortar y de volver la red, **cuántos sucesos y de
> qué tipo** registraste sin red, y lo que ves en el móvil. Si algo no cuadra, captura
> de los dos aparatos.

### E1 · Corte corto en juego (≈ 3 min) — imprescindible

1. iPad: **arranca el reloj**. Espera a ver el partido en marcha en el móvil.
2. iPad: **modo avión**.
3. iPad: registra **un gol, una tarjeta amarilla y un cambio**.
4. Espera ~30 s. Mira el móvil: debe quedarse con el marcador anterior.
5. iPad: **quita el modo avión**.

✅ **Esperado:** el reloj del iPad **no se para** en ningún momento. Al volver la red,
el móvil recibe **los 3 sucesos en el orden en que los hiciste, sin repetidos**, y el
**marcador correcto**, en menos de un minuto.

### E2 · Corte largo con descanso (≈ 10 min)

1. iPad: **modo avión**.
2. Registra 2 sucesos. **Termina la 1ª parte.** Espera 2-3 min (descanso).
3. **Empieza la 2ª parte** y registra 1 suceso más.
4. **Quita el modo avión.**

✅ **Esperado:** en el móvil, al reconectar: **fases correctas** (1ª → descanso → 2ª),
reloj coherente con el del iPad, **los 3 sucesos** y ninguno repetido.

### E3 · La app se cierra sin red (≈ 5 min) — imprescindible

1. iPad: **modo avión**. Registra **2 sucesos**.
2. **Cierra la app del todo** (desliza hacia arriba desde la barra inferior y quítala de
   la lista de apps abiertas).
3. **Sin quitar el modo avión**, ábrela otra vez desde su icono.
4. Entra en **«Recuperar partido»**.
5. **Quita el modo avión.**

✅ **Esperado:** la app **abre sin red**. El partido se recupera **con su reloj** y los
**2 sucesos siguen pendientes**. Al volver la red **llegan al móvil**, sin repetidos.

### E4 · Red intermitente (≈ 3 min)

Repite **3 veces**: 20 s en **modo avión** registrando **1 suceso** → 20 s **con red**.

✅ **Esperado:** los **3 sucesos** llegan al móvil **en orden y sin repetidos**. El
iPad **no se bloquea** en ningún momento.

### E5 · El visor pierde la red (≈ 3 min) — imprescindible

1. **Móvil**: modo avión (el iPad sigue con red).
2. iPad: registra **2-3 sucesos**.
3. Espera ~30 s. **Móvil**: quita el modo avión.

✅ **Esperado:** el móvil **se pone al día solo** (sucesos, marcador y reloj) **sin
tener que recargar**.

### E6 · Vídeo sin red (≈ 2 min)

1. iPad: **modo avión**.
2. Registra un suceso y **adjunta un vídeo corto** (galería).

✅ **Esperado:** el **suceso se guarda** (queda pendiente). La subida del vídeo **se
cancela a los ~45 s con un aviso**: no se queda colgada ni bloquea la pantalla. Al
volver la red, el suceso llega al móvil (el vídeo no: es lo esperado).

### E7 · Fin del partido sin red (≈ 3 min)

1. iPad: **modo avión**. **Finaliza el partido.**
2. Espera ~1 min. **Quita el modo avión.**

✅ **Esperado:** el partido queda **finalizado** en el iPad. Al volver la red, el móvil
lo ve **finalizado** y los **informes se generan y se envían** (aparecen en «Mis
Informes» del entrenador y en el panel del Director).

---

## 4 · Qué cuenta como fallo

Cualquiera de estos: un suceso que **no llega**, uno **repetido**, un **orden cambiado**,
un **marcador que no cuadra**, un **reloj que salta o retrocede**, la app **bloqueada**
o un partido que **no se recupera**. Anota hora, aparato y captura.

**Duración total:** unos 45 min. Si se hace en dos tandas, primero **E1, E3 y E5**
(unos 15 min).

## 5 · Después: comprobación en Firestore (la hace Claude, sólo lectura en testeo)

Para cada escenario se compara **lo registrado** (la hoja de abajo) con lo que hay en
Firestore de testeo: el documento del partido en vivo, sus sucesos, el marcador y las
fases. Detecta pérdidas o duplicados que no se ven en pantalla. El resultado se anota,
con fecha, aparatos y versión, en `VALIDACION_E2E_Y_APPCHECK.md` §4.

## 6 · Hoja de registro

Fecha: ______ · Versión (sello): ______ · iPad (modelo / iPadOS): ______ · Móvil (modelo / sistema): ______

| Escenario | Hora corte → vuelta | Sucesos registrados sin red (tipo y nº) | ¿Llegaron todos? | ¿Repetidos? | ¿Orden bien? | ¿Reloj bien? | Notas / capturas |
|---|---|---|---|---|---|---|---|
| E1 | | | | | | | |
| E2 | | | | | | | |
| E3 | | | | | | | |
| E4 | | | | | | | |
| E5 | | | | | | | |
| E6 | | | | | | | |
| E7 | | | | | | | |
