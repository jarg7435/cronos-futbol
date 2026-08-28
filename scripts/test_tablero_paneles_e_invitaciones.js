// ════════════════════════════════════════════════════════════════════════
//  test_tablero_paneles_e_invitaciones.js
//  ⚠️ EL NOMBRE NO ES CAPRICHOSO: se llamaba ..._y_secretaria.js y
//  `.gitignore` tiene la regla `*secret*` —puesta para que ningún fichero de
//  credenciales acabe en el repo—, así que este guard **estaba siendo
//  ignorado en silencio**: se ejecutaba en local pero no existía en git. En
//  un clon limpio la suite habría bajado de 179 a 178 sin que nadie lo notara
//  y estos invariantes se habrían quedado sin proteger. NO renombrar hacia
//  atrás, y NO forzarlo con `git add -f`: la regla está bien, el nombre no.
//  TABLERO DE BOTONES EN LOS TRES PANELES · Y SECRETARÍA PARA EL DIRECTOR — v590
// ════════════════════════════════════════════════════════════════════════
//  Petición del autor (implementar.txt, 2026-08-19):
//   1. Que Dirección, Coordinación y el Área de Familias entren por un
//      TABLERO de botones como el del entrenador, en vez de caer
//      directamente en un árbol de categorías dentro de pestañas planas.
//   2. Que el Director Deportivo tenga la Secretaría del SuperAdmin, para
//      invitar él mismo a entrenadores sin depender de nadie.
//
//  🔑 DECISIONES QUE ESTE GUARD PROTEGE, y que no son cosméticas:
//
//   · UNA SOLA PIEZA para los tres tableros (`cronosTableroHtml`). Tres
//     copias se irían separando al primer retoque — es la historia de este
//     proyecto (los contadores del ente, las listas de grupos, la regla del
//     semáforo en cuatro copias).
//   · EL TABLERO ES ADITIVO: las pestañas siguen existiendo y funcionando.
//     Sustituir la navegación de tres paneles a ciegas habría sido temerario;
//     así, si el tablero fallara, el panel de siempre está a un clic.
//   · UNA OPCIÓN BLOQUEADA SE ENSEÑA APAGADA Y DICE POR QUÉ. Que desaparezca
//     sin explicación es lo que hace pensar que la aplicación está rota.
//   · Y NO LLEVA `onclick`: apagar sólo con CSS deja la acción viva para quien
//     pulse igual (la lección de v548 — `disabled` es cosmético).
//   · SECRETARÍA NO SE DUPLICA: se parametriza el módulo del SuperAdmin. Y al
//     Director se le ofrecen SÓLO los roles que su club puede dar de alta:
//     ofrecerle crear administradores de club sería prometerle algo que las
//     reglas le van a denegar.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const UTILS  = leer('js/core/utils.js');
const STAFF  = leer('js/coach/reports/club-reports.js');
const PARENT = leer('js/parent/panel.js');
const SECR   = leer('js/admin/superadmin/secretary.js');
const SAP    = leer('js/admin/superadmin/superadmin.panel.js');
const CLUBST = leer('js/admin/superadmin/clubs-tab.js');

// ── El helper REAL, ejecutado ──────────────────────────────────────────
const sb = { console: { log() {}, warn() {} }, String, Array, Number, parseInt, isNaN };
sb.window = sb;
vm.createContext(sb);
{
    const i = UTILS.indexOf("if (typeof window.cronosTableroHtml !== 'function') {");
    const j = UTILS.indexOf('\n}', UTILS.indexOf('window._cronosHexRgb = _cronosHexRgb;'));
    vm.runInContext(UTILS.slice(i, j + 2), sb);
}
const tablero = sb.window.cronosTableroHtml;

console.log('\n── 1 · el tablero, la misma pieza para los tres paneles ──');
{
    const html = tablero({
        titulo: 'Panel de Dirección', subtitulo: 'Elige',
        opciones: [
            { icono: '📋', titulo: 'Convocatorias', desc: 'El árbol', onclick: "switchStaffTab('convocatorias')", color: '#3fb950' },
            { icono: '🎬', titulo: 'Partidos Terminados', desc: 'x', onclick: "switchStaffTab('pt')", color: '#79c0ff',
              bloqueado: 'Extra no activado para tu club.' },
        ],
    });
    ok('1a · la opción viva lleva su acción', /switchStaffTab\('convocatorias'\)/.test(html));
    ok('1b · 🔑🔑 la BLOQUEADA no lleva onclick (apagarla con CSS no basta — v548)',
       !/switchStaffTab\('pt'\)/.test(html), 'la acción seguiría viva para quien pulse igual');
    ok('1c · 🔑 y DICE por qué está bloqueada, en vez de desaparecer',
       /🔒/.test(html) && /Extra no activado para tu club/.test(html));
    ok('1d · el título y el subtítulo se pintan', /Panel de Dirección/.test(html) && /Elige/.test(html));
    ok('1e · el color de cada opción se compone en rgba', /rgba\(63,185,80/.test(html));
    ok('1f · ⚠️ el texto va escapado (los nombres de club los escribe un humano)',
       (() => {
           const h = tablero({ opciones: [{ titulo: '<img src=x onerror=alert(1)>', onclick: 'f()' }] });
           return !/<img src=x/.test(h) && /&lt;img/.test(h);
       })(), 'un titulo con HTML se inyectaría en el panel');
    ok('1g · sin opciones no revienta', typeof tablero({}) === 'string');
    ok('1h · sin argumentos tampoco', typeof tablero() === 'string');
}

console.log('\n── 2 · los tres paneles entran por el tablero ──');
{
    ok('2a · 🔑 Dirección/Coordinación entra en "menu"', /const _tab = initialTab \|\| 'menu';/.test(STAFF));
    ok('2b · 🔑 el Área de Familias también', /const _tab = initialTab \|\| 'menu';/.test(PARENT));
    ok('2c · el panel de staff pinta el tablero con la pieza compartida',
       /if \(tab === 'menu'\)/.test(STAFF) && /window\.cronosTableroHtml\(/.test(STAFF));
    ok('2d · y el de familias igual',
       /window\.ppMenu = \(\) =>/.test(PARENT) && /window\.cronosTableroHtml\(/.test(PARENT));
    ok('2e · el router de familias conoce la ruta "menu"', /menu:\s*ppMenu,/.test(PARENT));
    // ══════════════════════════════════════════════════════════════════
    //  🔄 v591 · LAS PESTAÑAS SE RETIRAN — Y ES UNA DECISIÓN, NO UN DESCUIDO
    //
    //  En v590 el tablero se hizo ADITIVO a propósito: no podía verlo, así que
    //  dejé las pestañas como red. El autor lo probó, le gustó, y pidió el
    //  panel limpio "como el de un entrenador profesional". Así que la red se
    //  retira y estas aserciones cambian de signo.
    //
    //  🔑 Lo que ahora hay que garantizar es lo contrario: que NO haya barra de
    //  pestañas Y que desde cualquier sección se pueda volver — sin vuelta,
    //  quitar las pestañas dejaría al usuario atrapado, que es exactamente el
    //  riesgo que él señaló.
    // ══════════════════════════════════════════════════════════════════
    ok('2f · 🔄 en Dirección ya NO hay barra de pestañas',
       !/class="staff-tab"/.test(STAFF),
       'quedaria la navegacion vieja conviviendo con el tablero');
    ok('2g · 🔄 y en Familias tampoco',
       !/id="pp-tab-conv"/.test(PARENT) && !/id="pp-tab-chat"/.test(PARENT));
    ok('2h · 🔑🔑🔑 pero desde CUALQUIER sección se vuelve al tablero',
       /id="staff-navbar"/.test(STAFF) && /Volver al Men/.test(STAFF) &&
       /id="pp-navbar"/.test(PARENT) && /Volver al Men/.test(PARENT),
       'sin vuelta, entrar en una seccion seria un callejon sin salida');
    ok('2h2 · ⚠️ y esa barra se oculta EN el tablero (no estorba en la portada)',
       /_navbar\.style\.display = 'none'/.test(STAFF) &&
       /_ppNav\.style\.display = 'none'/.test(PARENT));
    ok('2h3 · 🔑 la barra vive FUERA del contenedor de contenido',
       /id="staff-navbar"[\s\S]{0,200}<\/div>[\s\S]{0,600}id="staff-dashboard-content"/.test(STAFF),
       'dentro, la primera seccion que se pintara la borraria de un innerHTML');
    ok('2h4 · y la sección se nombra, para saber dónde se está',
       /_SD_TITULOS\[tab\]/.test(STAFF) && /_PP_TITULOS\[tab\]/.test(PARENT));
    // ⚠️ v592 · Reportado por el autor: los subtítulos del tablero seguían
    //    invitando a "usar las pestañas de arriba" DESPUÉS de haberlas
    //    retirado. Un texto que describe algo que ya no está confunde más que
    //    no decir nada, y es la clase de resto que sobrevive a un rediseño
    //    porque nadie vuelve a leer las cadenas.
    ok('2h5 · ⚠️ ningún texto de los paneles menciona ya las pestañas',
       !/pestañas de arriba/.test(STAFF) && !/pestañas de arriba/.test(PARENT),
       'quedaria invitando a usar una navegacion que ya no existe');
    ok('2i · ⚠️ si el helper no estuviera cargado, el panel NO se queda en blanco',
       /: \(await switchStaffTab\('convocatorias'\), ''\)/.test(STAFF) &&
       /: \(ppNotifsByType\('convocatoria'\), ''\)/.test(PARENT),
       'un menú que no pinta dejaría a un director sin panel');
}

console.log('\n── 3 · Secretaría para el Director ──');
{
    ok('3a · 🔑 el módulo del SuperAdmin se PARAMETRIZA, no se duplica',
       /window\.saSecretary = async function saSecretary\(opciones\)/.test(SECR) &&
       /_opts\.contenedorId \|\| 'sa-body'/.test(SECR));
    ok('3b · el panel de staff lo reutiliza en su propio contenedor',
       /contenedorId: 'sd-secretaria-body'/.test(STAFF));
    ok('3c · 🔑🔑 al Director se le ofrecen SÓLO los roles de su club',
       /CRONOS_SECRETARIA_ROLES_DIRECTOR = \['user', 'coordinator', 'parent'\]/.test(SECR),
       'ofrecerle crear administradores de club le prometería algo que las reglas deniegan');
    ok('3d · ⚠️ y NO están club_admin ni los individuales en esa lista',
       !/CRONOS_SECRETARIA_ROLES_DIRECTOR = \[[^\]]*club_admin/.test(SECR) &&
       !/CRONOS_SECRETARIA_ROLES_DIRECTOR = \[[^\]]*individual/.test(SECR));
    ok('3e · su club va ya escrito en el formulario', /value="\$\{_clubPrefijado\}"/.test(SECR));
    ok('3f · 🔑 la puerta es la MISMA que la de Configuración (sólo Director)',
       /if \(tab === 'secretaria'\) \{[\s\S]{0,400}_sdCanSeeConfigTab\(_me\)/.test(STAFF),
       'un Coordinador no da altas en el club');
    ok('3g · ⚠️ y la ruta se protege, no sólo el botón (switchStaffTab es invocable a mano)',
       /if \(!_sdCanSeeConfigTab\(_me\)\) \{/.test(STAFF));
    ok('3h · si el módulo no estuviera cargado, se dice en vez de romperse',
       /typeof window\.saSecretary !== 'function'/.test(STAFF));
    ok('3i · ⚠️ el catálogo de roles tiene respaldo propio (el guard lo ejecuta aislado)',
       /const _CAT = \(typeof window !== 'undefined' && window\.CRONOS_SECRETARIA_ROLES\) \|\| \{/.test(SECR));
}

// ════════════════════════════════════════════════════════════════════════
//  🎛️ v641 · EL CUARTO PANEL: EL DEL SUPERADMIN
//
//  Encargo del autor (implementar.txt, 2026-08-28): «rediseña la vista del
//  SuperAdmin para que coincida con el estilo visual, botones, tarjetas,
//  modales y jerarquía tipográfica de los paneles de Director Deportivo,
//  Coordinador y Entrenador», manteniendo intacta toda su funcionalidad.
//
//  🔑 SE COMPRUEBA EJECUTANDO, no leyendo. `saTab` cambió de contrato: ahora
//  fija `window._saSeccionActual`, enseña u oculta la barra de vuelta y manda
//  al tablero lo que no reconoce. Una regex sobre el fuente daría verde con
//  cualquiera de esas tres cosas rota — es justo la trampa que dejó viva la
//  baja del SuperAdmin durante trece versiones (ver test_sa_diagnostico).
//
//  ⚠️ Y SE VIGILA QUE NO QUEDE NADA DE LA BARRA DE PESTAÑAS: mientras exista
//  un solo `sa-tab-*`, hay dos navegaciones conviviendo y un sitio más desde
//  el que preguntarle al DOM en qué sección estamos.
console.log('\n── 4 · v641 · el panel del SuperAdmin, con el mismo marco ──');
{
    // ── El módulo REAL, ejecutado: SA_SECCIONES + saMenu + saTab ──────
    const sbSA = {
        console: { log() {}, warn() {}, error() {} },
        String, Array, Number, Object, JSON, Boolean, parseInt, isNaN, Math, Date,
    };
    sbSA.window = sbSA;
    sbSA.escapeHtml = (x) => String(x == null ? '' : x);
    const cuerpos = {
        'sa-body':   { id: 'sa-body',   innerHTML: '', style: {}, scrollTop: 0 },
        'sa-navbar': { id: 'sa-navbar', innerHTML: '', style: { display: 'none' } },
    };
    sbSA.document = { getElementById: (id) => cuerpos[id] || null };
    sbSA.cronosTableroHtml = tablero;
    sbSA.window.cronosTableroHtml = tablero;
    const pintadas = [];
    ['saClubs', 'saIndividuals', 'saRequests', 'saSecretary',
     'saBilling', 'saExtras', 'saMessages', 'saDiagnostico'].forEach((f) => {
        sbSA[f] = () => { pintadas.push(f); };
        sbSA.window[f] = sbSA[f];
    });
    vm.createContext(sbSA);
    {
        const i = SAP.indexOf('window.SA_SECCIONES = {');
        const j = SAP.indexOf('// saClubs() — Pestaña de clubes');
        ok('4a · el bloque del panel se localiza para ejecutarlo', i > 0 && j > i);
        vm.runInContext(SAP.slice(i, j), sbSA);
    }
    const saTab = sbSA.window.saTab;

    // ── El tablero de entrada ─────────────────────────────────────────
    saTab('menu');
    const menuHtml = cuerpos['sa-body'].innerHTML;
    ok('4b · 🔑 el SuperAdmin entra por un TABLERO, con la pieza compartida',
       /Panel del SuperAdmin/.test(menuHtml) && /grid-template-columns:repeat\(auto-fill/.test(menuHtml),
       'la misma cronosTableroHtml que Dirección, Coordinación, Club, Ente y Familias');

    ok('4c · 🔑🔑 y NO se ha perdido ninguna puerta: las ocho secciones siguen ahí',
       ['clubs', 'individuals', 'requests', 'secretary',
        'billing', 'extras', 'messages', 'diagnostico']
         .every((t) => menuHtml.indexOf("saTab('" + t + "')") >= 0),
       'el encargo era homogeneizar el aspecto, no recortar funcionalidad');

    ok('4d · cada tarjeta DICE para qué sirve (era lo que no hacía la pestaña)',
       /Altas y bajas de clubes/.test(menuHtml) && /modo sólo lectura/.test(menuHtml));

    ok('4e · ⚠️ en el tablero, la barra de vuelta está oculta',
       cuerpos['sa-navbar'].style.display === 'none' && cuerpos['sa-navbar'].innerHTML === '');

    // ── Entrar en una sección ─────────────────────────────────────────
    saTab('clubs');
    ok('4f · 🔑 la sección activa es un DATO, no el color de un borde',
       sbSA.window._saSeccionActual === 'clubs' && pintadas.indexOf('saClubs') >= 0);
    ok('4g · 🔑🔑 y desde cualquier sección se puede VOLVER',
       cuerpos['sa-navbar'].style.display === 'flex' &&
       /Volver al Men/.test(cuerpos['sa-navbar'].innerHTML) &&
       /saTab\('menu'\)/.test(cuerpos['sa-navbar'].innerHTML),
       'sin vuelta, quitar las pestañas dejaría al SuperAdmin atrapado');
    ok('4h · y la sección se nombra, para saber dónde se está',
       /Clubes/.test(cuerpos['sa-navbar'].innerHTML));

    saTab('diagnostico');
    ok('4i · Diagnóstico sigue siendo alcanzable y se pinta',
       sbSA.window._saSeccionActual === 'diagnostico' && pintadas.indexOf('saDiagnostico') >= 0);

    // ── 🗑️ Rastros: retirado por encargo ──────────────────────────────
    const antes = pintadas.length;
    saTab('trash');
    ok('4j · 🗑️ "Rastros" ya no existe: una llamada superviviente cae al TABLERO',
       sbSA.window._saSeccionActual === 'menu' && pintadas.length === antes &&
       /Panel del SuperAdmin/.test(cuerpos['sa-body'].innerHTML),
       'un else-if que no casa con nada dejaría el cuerpo en blanco sin decir por qué');

    saTab('loquesea');
    ok('4k · ⚠️ y cualquier sección desconocida también (nunca cuerpo en blanco)',
       sbSA.window._saSeccionActual === 'menu');

    // ── El aviso de solicitudes, ahora en la tarjeta ──────────────────
    sbSA.window._saPendingCount = 4;
    saTab('menu');
    ok('4l · 🔴 el aviso de Solicitudes es una PÍLDORA en su tarjeta',
       /border-radius:999px/.test(cuerpos['sa-body'].innerHTML) &&
       />4</.test(cuerpos['sa-body'].innerHTML),
       'un número pegado al título se pinta igual que el título: desde el tablero no se ve');
    sbSA.window._saPendingCount = 0;
    saTab('menu');
    ok('4m · ⚠️ y con 0 pendientes no se pinta nada (un 0 llama igual que un 5)',
       !/border-radius:999px/.test(cuerpos['sa-body'].innerHTML));

    // ── Nada de la barra de pestañas puede sobrevivir ─────────────────
    ok('4n · 🔄 en el SuperAdmin ya NO hay barra de pestañas',
       !/id="sa-tab-/.test(SAP),
       'quedaría la navegación vieja conviviendo con el tablero');
    ok('4o · 🔑🔑 y NADIE pregunta ya al DOM en qué sección está',
       !/sa-tab-/.test(SAP) && !/sa-tab-/.test(CLUBST),
       'getElementById de un botón retirado devuelve null y falla EN SILENCIO: ' +
       'el refresco automático se iría siempre a Clubes sin que nada avisara');
    ok('4p · el marco toma la jerarquía tipográfica de los otros paneles',
       /linear-gradient\(to right,#161b22,#0d1117\)/.test(SAP) &&
       /class="sap-title"/.test(SAP) && /id="sa-navbar"/.test(SAP));
    ok('4q · ⚠️ si utils.js no cargó, el panel NO se queda en blanco',
       /if \(!body\.innerHTML\) \{ saTab\('clubs'\); return; \}/.test(SAP),
       'un menú que no pinta dejaría al SuperAdmin sin el único sitio donde se aprueban altas');
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos === 0) console.log('✅ Los tres paneles, con tablero; y el Director, con su Secretaría');
else console.log('❌ ' + fallos + ' aserción(es) en rojo');
process.exit(fallos === 0 ? 0 : 1);
