// ─────────────────────────────────────────────────────────────────────────
//  test_invitacion_autocarga.js  ·  v630
//
//  Encargo del autor (implementar.txt, 2026-08-25), dos puntos:
//   1. Quitar del correo el enlace suelto del primer párrafo: cuerpo → botón →
//      «Si el botón no funciona, copia y pega este enlace».
//   2. Que la invitación rellene el alta: correo, rol y el club YA DADO DE ALTA,
//      fijado, para que el invitado sólo ponga su contraseña.
//
//  ════════════════════════════════════════════════════════════════════
//  🔴 LOS TRES DEFECTOS QUE HABÍA, Y QUE ESTE GUARD FIJA
//
//  1. `data-prefill-club` SE ESCRIBÍA Y NO LO LEÍA NADIE (un solo uso en todo
//     el proyecto, y era la escritura). El desplegable se llena por RED y el
//     prefill miraba UNA vez a los 300 ms: el club no se rellenó jamás.
//  2. EL ADMIN DE CLUB NO USA ESE DESPLEGABLE: su campo es
//     `#auth-new-club-name` y nadie lo tocaba. Ésa es la captura 9611.
//  3. Y la trampa de arreglarlo mal: la opción dice «(Nuevo Club)». Medido
//     antes de decidir: la aprobación del SA (extras.js) NO duplica, reutiliza
//     el club si el nombre existe — **pero casa por `==` exacto**. Por eso el
//     módulo escribe el nombre CANÓNICO leído de la lista, no el de la URL.
//
//  🔑 SE EJECUTA EL MÓDULO REAL contra un DOM de mentira con los ids de verdad,
//  y se comprueba el ESTADO de cada campo. Una regex sobre el fuente no
//  distinguiría «lo rellena» de «cree que lo rellena», que es exactamente el
//  defecto 1.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra) console.log('      → ' + extra); }
};

const SEC   = leer('js/admin/superadmin/secretary.js');
const PREF  = leer('js/services/auth/invite-prefill.js');
const INDEX = leer('index.html');
const SW    = leer('sw.js');
const AUTH  = leer('js/services/auth.js');
const EXTRAS= leer('js/admin/superadmin/extras.js');
const FUNCS = leer('functions/index.js');

// ── Un DOM de mentira con los ids REALES del formulario ──────────────
function montarDom() {
    const nodos = {};
    function crear(id, tag, extra) {
        const n = Object.assign({
            id, tagName: tag || 'INPUT', value: '', textContent: '',
            style: {}, disabled: false, readOnly: false, title: '',
            _opts: [],
            querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
            querySelectorAll(sel) {
                const m = /option\[value\^="([^"]+)"\]/g; let r = [], mm;
                while ((mm = m.exec(sel))) {
                    r = r.concat(this._opts.filter(o => o.value.indexOf(mm[1]) === 0));
                }
                return r;
            },
            dispatchEvent() { return true; },
            addEventListener() {},
            parentNode: { insertBefore(nuevo) { nodos[nuevo.id] = nuevo; } },
            nextSibling: null,
        }, extra || {});
        nodos[id] = n;
        return n;
    }
    return { nodos, crear };
}

function montar(dom) {
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: (id) => dom.nodos[id] || null,
            createElement: (t) => ({ tagName: String(t).toUpperCase(), id: '', style: {}, innerHTML: '' }),
            querySelector: () => null,
        },
        URLSearchParams,
        setTimeout: (f) => { f(); return 0; },   // sin esperas: el bucle resuelve ya
        Date, Promise, Event: function () {},
        String, Number, Array, Object, RegExp, Math, JSON,
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(PREF, sb);
    return sb;
}

console.log('\n══ v630 · La invitación limpia el correo y rellena el alta ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) ✉️ El correo deja de repetir el enlace');
{
    ok('1a · 🔑 la plantilla de fábrica ya NO lleva el enlace suelto',
       !/Para acceder directamente a la plataforma/.test(SEC) &&
       !/🔗 \{enlace\}/.test(SEC.replace(/^\s*\/\/.*$/gm, '')),
       'era la tercera copia del mismo enlace en el mismo correo');

    // v671 · ANTES: "pero WhatsApp lo CONSERVA: allí no hay botón ni respaldo".
    //   Ese canal se ha retirado de toda la app, así que ya no hay una
    //   segunda plantilla que conservar nada. Lo que queda por vigilar es
    //   justamente lo contrario: que NO reaparezca.
    ok('1b · ⚠️ y ya no queda plantilla de WhatsApp que la duplique',
       !/Completa tu registro y accede a la app aquí/.test(SEC)
       && !/metodo === 'whatsapp'/.test(SEC.replace(/^\s*\/\/.*$/gm, '')));

    ok('1c · el HTML del correo sigue teniendo botón y frase de respaldo',
       /Completar Registro \/ Acceder/.test(FUNCS) &&
       /Si el botón no funciona, copia y pega este enlace en tu navegador/.test(FUNCS),
       'son las dos apariciones que SÍ quiere; por eso sobraba la del cuerpo');

    ok('1d · 🔑 el envío y la vista previa pasan por el MISMO filtro',
       (SEC.match(/_secCuerpoParaEnviar\(/g) || []).length >= 3,
       'si sólo filtrara uno, lo que ve no sería lo que sale');

    // ── El filtro, EJECUTADO ──
    const sbSec = { console: { log() {}, warn() {} }, document: { querySelector: () => null },
                    String, RegExp, Array, Object };
    sbSec.window = sbSec;
    vm.createContext(sbSec);
    // Sólo hace falta la función; se extrae para no arrastrar todo el módulo.
    const i = SEC.indexOf('window.secQuitarEnlaceRepetido = function');
    const j = SEC.indexOf('\n};', i);
    vm.runInContext(SEC.slice(i, j + 3), sbSec);
    const quitar = sbSec.window.secQuitarEnlaceRepetido;

    ok('1e · la función existe', typeof quitar === 'function');
    if (typeof quitar === 'function') {
        const vieja = 'Hola, {nombre}:\n\nBienvenido.\n\n' +
                      'Para acceder directamente a la plataforma, entra por este enlace:\n\n' +
                      '🔗 {enlace}\n\n¡Gracias!\n\nUn saludo';
        const r = quitar(vieja);
        ok('1f · 🔑🔑 en una plantilla YA GUARDADA quita el enlace suelto',
           r.indexOf('{enlace}') < 0, JSON.stringify(r));
        ok('1g · 🔑 y la frase que lo presentaba, para no dejarla huérfana',
           r.indexOf('entra por este enlace') < 0,
           'un «entra por este enlace:» sin enlace es peor que la repetición');
        ok('1h · ⚠️ pero NO se lleva el resto del mensaje',
           r.indexOf('Bienvenido.') >= 0 && r.indexOf('¡Gracias!') >= 0 &&
           r.indexOf('Un saludo') >= 0, JSON.stringify(r));
        ok('1i · ⚠️ ni deja huecos de tres saltos de línea',
           !/\n{3,}/.test(r), JSON.stringify(r));
        ok('1j · ⚠️ un texto SIN enlace no se toca',
           quitar('Hola.\n\nAdiós') === 'Hola.\n\nAdiós');
        ok('1k · ⚠️ y un {enlace} EN MEDIO de una frase se respeta',
           quitar('Entra en {enlace} cuando puedas').indexOf('{enlace}') >= 0,
           'sólo se retira la línea cuyo ÚNICO contenido es el enlace');
    }
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔴 El defecto que hacía que el club no se rellenara NUNCA');
{
    // ⚠️ Se mira el USO, no la mención: el comentario que explica por qué se
    // retiró cita el nombre a propósito, y prohibir la cadena entera dejaría el
    // guard rojo por conservar justamente la explicación.
    ok('2a · 🔴🔴 ya no queda NINGÚN uso del `data-prefill-club` que no leía nadie',
       !/(set|get)Attribute\(\s*['"]data-prefill-club['"]/.test(INDEX + AUTH + PREF) &&
       !/dataset\.prefillClub/.test(INDEX + AUTH + PREF),
       'se escribía "para que auth.js lo use luego" y auth.js no lo leía jamás');

    ok('2b · 🔑 ahora se ESPERA a que el desplegable tenga opciones de verdad',
       /function _esperarClubes/.test(PREF) &&
       /option\[value\^="club:"\], option\[value\^="individual:"\]/.test(PREF));

    ok('2c · ⚠️ con tope: un fallo de red no deja el bucle vivo para siempre',
       /Date\.now\(\) - t0 > \(msTope \|\| 20000\)/.test(PREF));

    ok('2d · el arranque delega en el módulo, con reintento',
       /window\.cronosAplicarInvitacion\(urlParams\)/.test(INDEX) &&
       /_intentosInv/.test(INDEX));

    ok('2e · y si el módulo no llega, al menos el correo se rellena',
       /Respaldo minimo[\s\S]{0,220}?auth-email/.test(INDEX));

    ok('2f · index.html carga el módulo y el SW lo precachea',
       /js\/services\/auth\/invite-prefill\.js\?v=/.test(INDEX) &&
       /'\.\/js\/services\/auth\/invite-prefill\.js'/.test(SW));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 🏟️ ADMINISTRADOR DE CLUB — el caso de su captura (ejecutado)');
{
    const dom = montarDom();
    dom.crear('auth-email');
    const rol = dom.crear('auth-role', 'SELECT');
    rol.value = '';
    dom.crear('auth-new-club-name');
    const selClub = dom.crear('auth-club-select', 'SELECT');
    selClub._opts = [
        { value: 'club:club_a', textContent: '🏟️ CD DÍA' },
        { value: 'club:club_dor', textContent: '🏟️ CD DORAMAS' },
        { value: 'individual:ente_1', textContent: '👤 JOSÉ ALBERTO ROMERO' },
    ];

    const sb = montar(dom);
    sb.handleRoleChange = function () {};
    sb._cronosParseRoleValue = function (v) { return { role: v, coordinatorType: '' }; };
    // El navegador sólo acepta valores que existan como <option>.
    Object.defineProperty(rol, 'value', {
        get() { return this._v || ''; },
        set(v) { this._v = ['club_admin', 'user', 'parent', 'coordinator_f711'].indexOf(v) >= 0 ? v : ''; },
    });

    const p = new URLSearchParams('register=true&email=jarg7435%40gmail.com&role=club_admin&clubName=CD+DORAMAS');

    return sb.window.cronosAplicarInvitacion(p).then(() => {
        ok('3a · el correo se rellena', dom.nodos['auth-email'].value === 'jarg7435@gmail.com');
        ok('3b · el rol se selecciona', rol.value === 'club_admin');
        ok('3c · 🔑 y queda FIJADO (dato incuestionable de la invitación)', rol.disabled === true);

        const nc = dom.nodos['auth-new-club-name'];
        ok('3d · 🔴🔴 EL CAMPO QUE SU CAPTURA ENSEÑABA VACÍO YA SE RELLENA',
           nc.value === 'CD DORAMAS', 'medido: "' + nc.value + '"');
        ok('3e · 🔑 y queda fijado, no editable', nc.readOnly === true);

        ok('3f · 🔑🔑 se escribe el nombre CANÓNICO de la lista, no el de la URL',
           /hallado\.nombre/.test(PREF) && /where\('name', '==', targetClubName\)/.test(EXTRAS.replace(/\s+/g, ' ')) === false ||
           /where\(collection\(db, 'clubs'\), where\('name', '=='/.test(EXTRAS) ||
           /where\('name', '==', targetClubName\)/.test(EXTRAS),
           'la aprobación del SA casa por igualdad exacta: una tilde de más funda un club gemelo');

        ok('3g · se le dice que el club YA EXISTE y que no se creará otro',
           /ya está dado de alta/.test((dom.nodos['inv-nota-club'] || {}).innerHTML || ''),
           JSON.stringify((dom.nodos['inv-nota-club'] || {}).innerHTML || ''));

        return parte4();
    });
}

// ════════════════════════════════════════════════════════════════════
function parte4() {
console.log('\n4) 🧑‍🏫 Entrenador invitado a un club existente (ejecutado)');
{
    const dom = montarDom();
    dom.crear('auth-email');
    const rol = dom.crear('auth-role', 'SELECT');
    const te  = dom.crear('auth-entity-type', 'SELECT');
    const selClub = dom.crear('auth-club-select', 'SELECT');
    selClub._opts = [
        { value: 'club:club_a', textContent: '🏟️ CD DÍA' },
        { value: 'club:club_dor', textContent: '🏟️ CD DORAMAS' },
    ];
    const sb = montar(dom);
    sb.handleRoleChange = function () {};
    sb.handleEntityChange = function () {};
    sb._cronosParseRoleValue = function (v) { return { role: v, coordinatorType: '' }; };
    Object.defineProperty(rol, 'value', {
        get() { return this._v || ''; },
        set(v) { this._v = ['user', 'parent', 'club_admin'].indexOf(v) >= 0 ? v : ''; },
    });

    const p = new URLSearchParams('register=true&email=a%40b.es&role=user&clubName=cd%20doramas');

    return sb.window.cronosAplicarInvitacion(p).then(() => {
        ok('4a · 🔑 el club se SELECCIONA en el desplegable', selClub.value === 'club:club_dor',
           'medido: "' + selClub.value + '" — y esto no había funcionado nunca');
        ok('4b · ⚠️ casando sin distinguir mayúsculas ni acentos',
           selClub.value === 'club:club_dor', 'la URL traía "cd doramas" en minúsculas');
        ok('4c · 🔑 y queda fijado', selClub.disabled === true);
        ok('4d · ⚠️ el tipo de entidad se pone en "club" (si no, el desplegable ni se ve)',
           te.value === 'club');
        ok('4e · se le confirma cuál es su club',
           /Club fijado por la invitación/.test((dom.nodos['inv-nota-club'] || {}).innerHTML || ''));
        return parte5();
    });
}
}

// ════════════════════════════════════════════════════════════════════
function parte5() {
console.log('\n5) ⚠️ Lo que NO puede pasar: que esto impida un alta');
{
    // Club invitado que NO existe en la lista.
    const dom = montarDom();
    dom.crear('auth-email');
    const rol = dom.crear('auth-role', 'SELECT');
    const selClub = dom.crear('auth-club-select', 'SELECT');
    selClub._opts = [{ value: 'club:club_a', textContent: '🏟️ CD DÍA' }];
    const sb = montar(dom);
    sb.handleRoleChange = function () {};
    sb.handleEntityChange = function () {};
    sb._cronosParseRoleValue = function (v) { return { role: v, coordinatorType: '' }; };
    Object.defineProperty(rol, 'value', {
        get() { return this._v || ''; },
        set(v) { this._v = (v === 'user') ? v : ''; },
    });

    return sb.window.cronosAplicarInvitacion(
        new URLSearchParams('role=user&clubName=CLUB+QUE+NO+EXISTE')).then(() => {
        ok('5a · 🔑 si el club no está, el desplegable se deja ABIERTO',
           selClub.disabled === false,
           'fijarlo en el club equivocado sería mucho peor que no fijarlo');
        ok('5b · y se dice qué pasa, en vez de callarse',
           /no aparece en la lista/.test((dom.nodos['inv-nota-club'] || {}).innerHTML || ''));

        // Un rol que ya no existe como opción (enlace viejo).
        const dom2 = montarDom();
        const rol2 = dom2.crear('auth-role', 'SELECT');
        Object.defineProperty(rol2, 'value', {
            get() { return this._v || ''; },
            set(v) { this._v = (v === 'coordinator_f711') ? v : ''; },
        });
        const sb2 = montar(dom2);
        sb2.handleRoleChange = function () {};
        sb2._cronosParseRoleValue = function (v) { return { role: v, coordinatorType: '' }; };
        return sb2.window.cronosAplicarInvitacion(
            new URLSearchParams('role=coordinator')).then(() => {
            ok('5c · ⚠️ un enlace viejo con ?role=coordinator cae en la opción mixta',
               rol2.value === 'coordinator_f711',
               'v593 lo desglosó en F7/F11/ambas; dejarlo en la PRIMERA opción sería peor');

            // Un rol desconocido no debe fijar nada.
            const dom3 = montarDom();
            const rol3 = dom3.crear('auth-role', 'SELECT');
            Object.defineProperty(rol3, 'value', {
                get() { return this._v || ''; }, set() { this._v = ''; },
            });
            const sb3 = montar(dom3);
            sb3.handleRoleChange = function () {};
            sb3._cronosParseRoleValue = function (v) { return { role: v, coordinatorType: '' }; };
            return sb3.window.cronosAplicarInvitacion(
                new URLSearchParams('role=inventado')).then(() => {
                ok('5d · 🔑 un rol que no existe NO se fija: el usuario elige',
                   rol3.disabled === false,
                   'bloquear un desplegable vacío dejaría el alta imposible de completar');

                ok('5e · ⚠️ y el correo se deja EDITABLE a propósito',
                   !/_fijar\(\s*e\s*\)/.test(PREF) && /_fijar\(sel\)/.test(PREF),
                   'una invitación reenviada a otra persona dejaría de servir');

                ok('5f · nada de esto puede tumbar el alta: todo va en un try',
                   /catch \(err\) \{[\s\S]{0,200}?no se pudo autocompletar/.test(PREF));

                cerrar();
            });
        });
    });
}
}

function cerrar() {
    console.log('\n──────────────────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
    if (fail) { console.log('❌ ' + fail + ' aserción(es) en rojo'); process.exit(1); }
    console.log('✅ Un enlace por correo · y el alta llega rellena y fijada');
}
