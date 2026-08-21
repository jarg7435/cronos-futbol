// ═══════════════════════════════════════════════════════════════════════════
//  v597-v598 · LOS DOS PANELES DE ADMINISTRACIÓN — GUARD
// ═══════════════════════════════════════════════════════════════════════════
//  Tres encargos del autor en la v597 (implementar.txt):
//   1. que el panel del Admin de Club y el del Admin Individual adopten la
//      estética de tablero de los otros cuatro paneles;
//   2. fuera las opciones duplicadas de enviar informes a padres;
//   3. fuera la tabla de permisos por casillas.
//
//  Y seis más en la v598, tras probarlo en pantalla:
//   1. las Cuotas, dentro de Usuarios          → partes 2 y 2y
//   2. aviso VISIBLE en Solicitudes            → parte 8a-8d
//   3. fuera "Solicitar Alta"                  → parte 8h-8j
//   4. "Volver al Menú" en Contactos           → parte 8k (+ el guard propio)
//   5. fuera el toggle de informes a padres    → parte 5, reescrita
//   6. fuera "Transmitir al SuperAdmin"        → parte 8e-8g
//
//  🔑 QUÉ PUEDE SALIR MAL EN UN REFACTOR COMO ÉSTE, que es lo que vigila este
//  guard: el contenido de los bloques NO se ha reescrito, sólo se ha cortado en
//  constantes. El riesgo no es que un bloque quede feo — es que un bloque
//  quede en la SECCIÓN EQUIVOCADA, o que se pierda por el camino al mover una
//  costura. Eso no lo ve `node --check`: las comillas siguen cuadrando y el
//  fichero compila igual con la tabla de usuarios metida dentro de "Cuotas".
//  Por eso las partes 2 y 5 comprueban, bloque a bloque, que cada marca está
//  en su sección Y EN NINGUNA OTRA.
//
//  🔑🔑 Y la parte 4 es la que impide que el punto 3 se deshaga solo: las seis
//  claves de permisos tienen que valer CERO en todo el proyecto. Mientras
//  quede una, alguien puede volver a pintar la tabla creyendo que sirve.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); fallos++; }
}

const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
// ⚠️ \r?\n: el repositorio es CRLF y un /^\s*\/\// con \n pelado no borra nada.
const sinComs = (s) => s.split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');

const CLUB = leer('js/admin/club/panel.js');
const IND  = leer('js/admin/individual/panel.js');
const _CLUB = sinComs(CLUB);
const _IND  = sinComs(IND);

// Extrae el cuerpo de `const _secX = ` ... `;` (la plantilla, sin comentarios
// de línea, para que ninguna aserción case con una explicación).
function seccion(src, nombre) {
    const i = src.indexOf('const ' + nombre + ' = `');
    if (i === -1) return null;
    const desde = i + ('const ' + nombre + ' = `').length;
    const j = src.indexOf('\n    `;', desde);
    if (j === -1) return null;
    return sinComs(src.slice(desde, j));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · los dos paneles entran por el TABLERO compartido ──');
// ───────────────────────────────────────────────────────────────────────────
for (const [rot, src] of [['Club', _CLUB], ['Individual', _IND]]) {
    ok('1 · el panel de ' + rot + ' usa cronosTableroHtml (la pieza compartida)',
       /window\.cronosTableroHtml\(\{/.test(src));
    ok('1 · el panel de ' + rot + ' tiene respaldo si el helper no cargó',
       /typeof window\.cronosTableroHtml === 'function'/.test(src) && /:\s*Object\.keys\(/.test(src));
}
ok('1e · 🔑 el tablero se pinta DESPUÉS del innerHTML (si no, no hay dónde)',
   _CLUB.indexOf('modal.innerHTML = modalHTML;') < _CLUB.indexOf('window.caTab(window._caSeccionActual'),
   { innerHTML: _CLUB.indexOf('modal.innerHTML = modalHTML;'),
     caTab: _CLUB.indexOf('window.caTab(window._caSeccionActual') });
ok('1f · ídem en el Individual',
   _IND.indexOf('setupModal.innerHTML = SA_CSS') < _IND.indexOf('window.indTab(window._indSeccionActual'));
ok('1g · ⚠️ caTab se define DENTRO del panel (cierra sobre los datos ya leídos)',
   /\n    window\.caTab = function caTab\(sec\)/.test(_CLUB));
ok('1h · ⚠️ ídem indTab',
   /\n    window\.indTab = function indTab\(sec\)/.test(_IND));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · 🔑 cada bloque, en SU sección y en ninguna otra ──');
// ───────────────────────────────────────────────────────────────────────────
//  La marca de cada bloque es un trozo de su marcado original, no una palabra
//  suelta: una palabra suelta aparece en media docena de sitios.
//
//  ⚠️ v598 · TRES SECCIONES MENOS. `_secCuotas` se fundió dentro de
//  `_secUsuarios` (el resumen de plazas se calcula de esos mismos usuarios) y
//  `_secSolicitarAlta` y `_secConfig` se retiraron enteras. La lista de abajo
//  refleja el panel de HOY; que las tres retiradas no vuelvan lo vigila 2y,
//  que es la aserción que sustituye a las suyas.
const SECCIONES_CLUB = {
    _secSolicitudes:    ['Solicitudes enviadas al SuperAdmin', 'Pendientes de tu confirmación',
                         'Solicitudes de Registro', 'Nuevos Roles Solicitados'],
    // 🔑 Las cuotas viven AQUÍ ahora. La marca es la misma que vigilaba
    //    `_secCuotas`, así que si el bloque se pierde al mover la costura —el
    //    riesgo real de este refactor— esta aserción se pone roja igual.
    _secUsuarios:       ['👥 Usuarios del Club', 'class="sa-stats"', '💰 Plazas del club'],
    _secContactos:      ['No hay nada que configurar aquí'],
    _secPlan:           ['Mi suscripción', 'club-billing-container'],
};
const cuerpos = {};
for (const nombre of Object.keys(SECCIONES_CLUB)) {
    const cuerpo = seccion(CLUB, nombre);
    ok('2 · la sección ' + nombre + ' existe y está delimitada', cuerpo !== null);
    cuerpos[nombre] = cuerpo || '';
}
for (const [nombre, marcas] of Object.entries(SECCIONES_CLUB)) {
    for (const marca of marcas) {
        const dentro = cuerpos[nombre].includes(marca);
        const fuera  = Object.entries(cuerpos)
            .filter(([n]) => n !== nombre)
            .filter(([, c]) => c.includes(marca))
            .map(([n]) => n);
        ok('2 · "' + marca.slice(0, 34) + '" vive en ' + nombre + ' y en ninguna otra',
           dentro && fuera.length === 0, { dentro, tambienEn: fuera });
    }
}
// ⚠️⚠️ v598 · LO QUE SUSTITUYE A LAS ASERCIONES DE LAS TRES SECCIONES
// RETIRADAS. Borrarlas y ya está habría dejado el hueco abierto: mañana
// alguien vuelve a pegar el formulario de alta y ningún guard se entera.
// Aquí se exige que NO existan — ni la constante, ni su marcado, ni su entrada
// en el mapa de secciones.
for (const [nombre, marca] of [
    ['_secCuotas',        null],
    ['_secSolicitarAlta', 'Solicitar nuevo usuario al SuperAdmin'],
    ['_secConfig',        'Enviar informes individualizados a padres'],
]) {
    ok('2y · la sección retirada ' + nombre + ' no ha vuelto',
       seccion(CLUB, nombre) === null &&
       !new RegExp('html:\\s*' + nombre + '\\b').test(_CLUB) &&
       (marca === null || !_CLUB.includes(marca)),
       { constante: seccion(CLUB, nombre) !== null,
         enElMapa: new RegExp('html:\\s*' + nombre + '\\b').test(_CLUB),
         marcado: marca !== null && _CLUB.includes(marca) });
}
ok('2z · las secciones que quedan están declaradas en el mapa _CA_SECCIONES',
   Object.keys(SECCIONES_CLUB).every(n => new RegExp('html:\\s*' + n + '\\b').test(_CLUB)),
   Object.keys(SECCIONES_CLUB).filter(n => !new RegExp('html:\\s*' + n + '\\b').test(_CLUB)));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · no se ha perdido nada por el camino ──');
// ───────────────────────────────────────────────────────────────────────────
//  Marcas de cosas que TIENEN que seguir existiendo tras mover las costuras.
//  Si una costura se cierra donde no toca, un bloque entero desaparece del
//  fichero sin que nada falle al compilar.
for (const marca of [
    'caForwardToSA', 'caConfirmClubAccess', 'caRejectRequest', 'caRejectMultiRole',
    'unifiedUserTable()', 'billClubView', 'caShowSuccession',
]) {
    ok('3 · sigue existiendo: ' + marca, _CLUB.includes(marca));
}
for (const marca of ['billIndividualView', 'openSetupModal', 'indForwardToSA']) {
    ok('3 · Individual, sigue existiendo: ' + marca, _IND.includes(marca));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · 🔑🔑 la tabla de permisos, ERRADICADA ──');
// ───────────────────────────────────────────────────────────────────────────
//  Se censa TODO el proyecto, no sólo el panel: el motivo por el que se quitó
//  es que nadie leía estas claves. Si alguna reaparece, o vuelve la tabla o
//  —peor— alguien empieza a leerlas sin que nadie las escriba.
function censoProyecto(patron) {
    const hits = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name === '.git' || e.name === 'backups') continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!/\.(js|html)$/.test(e.name)) continue;
            const rel = path.relative(RAIZ, p).replace(/\\/g, '/');
            if (rel.startsWith('scripts/')) continue;          // los guards citan las claves
            const txt = sinComs(fs.readFileSync(p, 'utf8'));
            if (patron.test(txt)) hits.push(rel);
        }
    })(RAIZ);
    return hits;
}
for (const clave of ['receiveConvocatorias', 'receiveEntrenamientos', 'receiveMessages',
                     'receiveReports', 'receiveIndividualReports']) {
    const hits = censoProyecto(new RegExp('\\b' + clave + '\\b'));
    ok('4 · la clave muerta "' + clave + '" no queda en ningún sitio', hits.length === 0, hits);
}
{
    const hits = censoProyecto(/\bcaSetPermission\b/);
    ok('4f · 🔑 caSetPermission retirada: ni se define ni se llama', hits.length === 0, hits);
}
ok('4g · y la sección de Contactos dice que no hay nada que configurar',
   /No hay nada que configurar aquí/.test(cuerpos._secContactos));
ok('4h · ⚠️ lo que da cada rol se deriva del ROL, no de un campo por persona',
   /_caLoQueDaElRol/.test(_CLUB) && /case 'director'/.test(_CLUB) && /case 'parent'/.test(_CLUB));
ok('4i · ⚠️⚠️ y respeta los extras del club con `!== false` (nunca `=== true`)',
   /_caExtras\[k\] !== false/.test(_CLUB) && !/_caExtras\[k\] === true/.test(_CLUB));
ok('4j · ⚠️ NO se tocan las casillas del entrenador (contact-manager.js), que sí funcionan',
   /canSendMsg/.test(leer('js/coach/comms/contact-manager.js')));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 5 · el envío de informes a padres: UN dueño, el DIRECTOR ──');
// ───────────────────────────────────────────────────────────────────────────
//  ⚠️⚠️ v598 · PARTE REESCRITA, Y LA INTENCIÓN SE INVIERTE SIN CAMBIAR DE
//  OBJETIVO. En la v597 lo que se vigilaba era "un solo interruptor, y en
//  Configuración". El autor pidió (2026-08-21) retirarlo del panel del club
//  entero: «esa decisión recae exclusivamente en el director deportivo».
//
//  🔑 Y NO ERA UNA CUESTIÓN DE GUSTO. `director-config.js` ya dejaba al
//  director decidirlo POR CATEGORÍA y escribía el agregado en el mismo campo
//  `features.sendIndividualReports`. El interruptor del club era global: una
//  pulsación suya barría el criterio por categorías del director. Eran dos
//  dueños de una misma llave, y por eso lo que hay que vigilar ahora es que
//  quede EXACTAMENTE UNO — no cero. Retirar el mando del club sin comprobar
//  que el del director sigue vivo sería haber apagado la función entera.
{
    // 5a · en el panel del club NO queda ningún control.
    const n = (_CLUB.match(/caToggleFeature\(/g) || []).length;
    ok('5a · 🔑 el panel del Club ya no tiene NINGÚN interruptor de informes a padres',
       n === 0, n);
    ok('5b · ⚠️ tampoco queda ninguno suelto en otra sección',
       Object.values(cuerpos).every(c => !c.includes('caToggleFeature') &&
                                        !c.includes('sendIndividualReports')));
    // 5c · y la función que lo escribía se ha ido de TODO el proyecto: mientras
    //      exista, alguien puede volver a colgarle un onchange.
    {
        const hits = censoProyecto(/\bcaToggleFeature\b/);
        ok('5c · 🔑 caToggleFeature retirada: ni se define ni se llama', hits.length === 0, hits);
    }
    // 5d · 🔑🔑 LA OTRA MITAD, la que impide que "limpiar" sea "romper":
    //      el DIRECTOR sigue siendo dueño de la llave y sigue escribiéndola.
    {
        const DIR = sinComs(leer('js/coach/reports/director-config.js'));
        ok('5d · 🔑🔑 el Director SIGUE decidiéndolo (y por categoría): escribe la llave',
           /'features\.sendIndividualReports'/.test(DIR) &&
           /sendIndividualReports:/.test(DIR));
    }
    // 5e · y quien la lee para repartir informes sigue leyéndola. Si esto se
    //      pusiera rojo, habríamos retirado un mando Y apagado la función.
    ok('5e · ⚠️ y quien reparte los informes la sigue leyendo (la función NO se ha apagado)',
       /sendIndividualReports/.test(sinComs(leer('js/core/utils.js'))));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 6 · entrar por el menú, pero no perder el sitio ──');
// ───────────────────────────────────────────────────────────────────────────
ok('6a · ⚠️ un navReload() de una acción devuelve a la sección, no al tablero',
   /window\._caSeccionActual = sec;/.test(_CLUB) &&
   /window\.caTab\(window\._caSeccionActual \|\| 'menu'\)/.test(_CLUB));
ok('6b · 🔑 pero al ENTRAR de nuevo al panel se empieza en el menú',
   /if \(!preClubId\) window\._caSeccionActual = 'menu';/.test(_CLUB));
ok('6c · en el Individual es un parámetro EXPLÍCITO, no una heurística',
   /async function openIndividualAdminPanel\(mantenerSeccion = false\)/.test(_IND) &&
   /if \(!mantenerSeccion\) window\._indSeccionActual = 'menu';/.test(_IND));
{
    // Todas las reinvocaciones internas tienen que pedir que se mantenga.
    const sueltas = _IND.split(/\r?\n/)
        .filter(l => /openIndividualAdminPanel\(\)/.test(l))
        .filter(l => !/^async function/.test(l.trim()));
    ok('6d · ⚠️ ninguna reinvocación interna se dejó sin el flag (te echaría al tablero)',
       sueltas.length === 0, sueltas.map(s => s.trim().slice(0, 70)));
}
{
    // ═══════════════════════════════════════════════════════════════════
    //  🔴🔴 6e · LA COLISIÓN DE NOMBRE, que es lo que destapó este guard.
    //
    //  js/admin/individual/panel.js tenía, al final y en su propio ámbito de
    //  fichero, un `window.indTab = function indTab() { /* sin tabs */ };`
    //  —un NO-OP heredado de una versión con pestañas— con el MISMO nombre que
    //  la función del tablero nuevo. Ganaba el bueno por orden (uno se asigna
    //  al cargar el fichero, el otro al abrir el panel), pero un no-op que
    //  gane no da ningún error: el menú simplemente deja de responder.
    //
    //  Se exige UNA sola asignación en todo el proyecto. Contar asignaciones y
    //  no menciones es lo que hace que esto sirva: los onclick del tablero
    //  citan indTab ocho veces y ninguna es una definición.
    // ═══════════════════════════════════════════════════════════════════
    const asig = (patron) => {
        const hits = [];
        (function walk(dir) {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (e.name === 'node_modules' || e.name === '.git' || e.name === 'backups') continue;
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { walk(p); continue; }
                if (!/\.(js|html)$/.test(e.name)) continue;
                const rel = path.relative(RAIZ, p).replace(/\\/g, '/');
                if (rel.startsWith('scripts/')) continue;
                const txt = sinComs(fs.readFileSync(p, 'utf8'));
                const m = txt.match(patron);
                if (m) hits.push(rel + ' ×' + m.length);
            }
        })(RAIZ);
        return hits;
    };
    const iT = asig(/window\.indTab\s*=/g);
    ok('6e · 🔴 window.indTab se asigna UNA sola vez (había un no-op que lo eclipsaba)',
       iT.length === 1 && iT[0].endsWith('×1'), iT);
    const cT = asig(/window\.caTab\s*=/g);
    ok('6f · ídem window.caTab', cT.length === 1 && cT[0].endsWith('×1'), cT);
    for (const muerta of ['indRenderOverview', 'indRenderPending', 'indRenderRequestForm', 'indRenderMembers']) {
        ok('6 · el envoltorio muerto ' + muerta + ' ya no existe',
           asig(new RegExp('\\b' + muerta + '\\b', 'g')).length === 0);
    }
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 7 · el onclick del tablero no puede romper el atributo ──');
// ───────────────────────────────────────────────────────────────────────────
//  🔑 cronosTableroHtml pega el onclick TAL CUAL dentro de comillas dobles:
//     ' onclick="' + String(o.onclick || '') + '"'
//  Una comilla doble dentro de un manejador cerraría el atributo a media
//  cadena y el navegador se comería el resto sin dar ningún error.
{
    const manejadores = [];
    for (const src of [CLUB, IND]) {
        const re = /onclick:\s*("(?:[^"\\]|\\.)*")/g;
        let m;
        while ((m = re.exec(src))) manejadores.push(m[1]);
    }
    ok('7a · hay manejadores de tablero que revisar', manejadores.length >= 8, manejadores.length);
    const rotos = manejadores.filter(h => h.slice(1, -1).includes('"'));
    ok('7b · 🔑 ninguno lleva comillas dobles dentro', rotos.length === 0, rotos);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 8 · v598 · el aviso que SE VE y los botones que NO mienten ──');
// ───────────────────────────────────────────────────────────────────────────
{
    // ── 8a-8c · EL BADGE DE SOLICITUDES ──────────────────────────────────
    //  🔑 EL DEFECTO QUE ARREGLA: el número de pendientes se pegaba al TÍTULO
    //  (`'Solicitudes' + (n ? ' · ' + n : '')`). Eso se pinta con la misma
    //  tipografía, el mismo tamaño y el mismo color que el resto del rótulo:
    //  es texto, no un aviso. El autor lo pidió "visual y claro".
    //  ⚠️ SE COMPRUEBA QUE EL PEGOTE NO VUELVA, no sólo que el badge esté: las
    //  dos cosas pueden convivir, y entonces saldría el número dos veces.
    for (const [rot, src] of [['Club', _CLUB], ['Individual', _IND]]) {
        ok('8a · ' + rot + ': la tarjeta de Solicitudes lleva badge con el nº de pendientes',
           /badge:\s*_(?:ca|ind)Pendientes/.test(src));
        ok('8b · ⚠️ ' + rot + ': y el número YA NO se pega al título',
           !/titulo:\s*'Solicitudes'\s*\+/.test(src));
    }
    // El badge lo pinta la pieza COMPARTIDA, no cada panel por su cuenta.
    const UTILS = leer('js/core/utils.js');
    ok('8c · 🔑 lo pinta cronosTableroHtml (compartido), no cada panel a mano',
       /const badge = \(bloqueado \|\| o\.badge == null/.test(UTILS));
    // ⚠️ Un badge sobre una opción con candado promete algo que no se puede ir
    //    a ver; y un 0 dentro de una píldora roja llama igual que un 5.
    ok('8d · ⚠️ una opción BLOQUEADA no luce badge, y un 0 tampoco es aviso',
       /bloqueado \|\| o\.badge == null \|\| o\.badge === '' \|\| Number\(o\.badge\) === 0/.test(UTILS));

    // ── 8e-8g · LOS DOS BOTONES FANTASMA ─────────────────────────────────
    //  🔴🔴🔴 `caNotifySuperAdmin` e `indNotifySuperAdmin` ("📡 Transmitir al
    //  SuperAdmin") escribían en `platform_requests` con `type:'sync_request'`
    //  / `'individual_notification'` y `status:'unread'`. El SuperAdmin sólo
    //  lee de esa colección `status=='pending_sa'` o
    //  `type=='quota_increase' && status=='unread'` (requests-tab.js). Ninguna
    //  de las dos casaba: NADIE las leyó jamás. Y encima confirmaban el envío.
    for (const clave of ['caNotifySuperAdmin', 'indNotifySuperAdmin',
                         'sync_request', 'individual_notification']) {
        const hits = censoProyecto(new RegExp('\\b' + clave + '\\b'));
        ok('8e · el botón fantasma "' + clave + '" no queda en ningún sitio',
           hits.length === 0, hits);
    }
    //  🔑🔑 LA MITAD QUE IMPIDE QUE ESTO SEA UNA PÉRDIDA: se retira el canal
    //  falso porque HAY uno de verdad. Si la mensajería interna desapareciera,
    //  el administrador se quedaría sin forma de hablar con el SuperAdmin.
    ok('8f · 🔑 pero la mensajería interna de VERDAD sigue en los dos tableros',
       /openClubAdminMessaging\(/.test(_CLUB) && /openIndividualAdminMessaging\(/.test(_IND));
    //  Y la consulta que define "lo que el SuperAdmin llega a ver" sigue donde
    //  estaba: si alguien la ampliara, este razonamiento habría que rehacerlo.
    {
        const RT = sinComs(leer('js/admin/superadmin/requests-tab.js'));
        ok('8g · ⚠️ el SA sigue leyendo SÓLO pending_sa y quota_increase/unread',
           /where\('status','==','pending_sa'\)/.test(RT) &&
           /where\('type','==','quota_increase'\),where\('status','==','unread'\)/.test(RT.replace(/\s+/g, '')));
    }

    // ── 8h-8i · FUERA "SOLICITAR ALTA" EN LOS DOS PANELES ────────────────
    //  El alta la inicia el interesado registrándose; el formulario del
    //  administrador era una segunda puerta al mismo sitio.
    for (const clave of ['caSolicitarUsuario', 'caAddUser', 'caRoleChanged', 'indSolicitarPadre']) {
        const hits = censoProyecto(new RegExp('\\b' + clave + '\\b'));
        ok('8h · el alta manual "' + clave + '" ya no existe', hits.length === 0, hits);
    }
    ok('8i · ⚠️ ni queda la tarjeta ni la sección en ninguno de los dos tableros',
       !/caTab\('alta'\)/.test(_CLUB) && !/indTab\('alta'\)/.test(_IND) &&
       !/alta:\s*\{/.test(_CLUB) && !/alta:\s*\{/.test(_IND));
    //  🔑 PERO EL CAMINO BUENO NO SE TOCA: la solicitud del interesado sigue
    //  llegando y sigue pudiéndose reenviar al SuperAdmin.
    ok('8j · 🔑 el reenvío de la solicitud del interesado sigue intacto',
       /caForwardToSA/.test(_CLUB) && /indForwardToSA/.test(_IND) &&
       /solicitudes:\s*\{/.test(_CLUB) && /solicitudes:\s*\{/.test(_IND));

    // ── 8k · CONTACTOS TIENE VUELTA AL MENÚ ──────────────────────────────
    //  Reportado por el autor: entrar en Contactos "obliga a salir totalmente
    //  del rol". El detalle de comportamiento lo cubre
    //  scripts/test_contact_manager_module.js (3f2-3f5), que EJECUTA la
    //  función; aquí basta con dejar constancia de que el botón existe.
    ok('8k · Contactos tiene su Volver al Menú (detalle en test_contact_manager_module)',
       /cmVolverAlMenu/.test(leer('js/coach/comms/contact-manager.js')));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════');
console.log('Resultado: ' + (total - fallos) + '/' + total + (fallos ? '  ❌ ' + fallos + ' FALLOS' : '  ✅'));
process.exit(fallos ? 1 : 0);
