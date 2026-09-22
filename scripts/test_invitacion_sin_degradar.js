// ─────────────────────────────────────────────────────────────────────────
//  test_invitacion_sin_degradar.js  ·  🔒 SEC-INV2 (Fase 0, 2026-09-22)
//
//  LA INVITACIÓN NO PUEDE DEGRADAR A TEXTO EN CLARO. NUNCA. POR NINGÚN CAMINO.
//
//  v633 cambió el enlace de invitación a un token opaco (`?invite=<token>`) y
//  dejó el clásico —`?register=true&email=…&role=…&clubName=…`— como RESPALDO
//  «por si falla el acuñado». Ese respaldo era el defecto:
//
//    · `_secEnlaceReal` (secretary.js) caía a él ante cualquier excepción, y
//      lo anunciaba con un aviso. Un aviso no deshace nada: el correo de la
//      familia salía igual dentro de la URL, y una URL va al historial del
//      navegador, a los registros del servidor de correo, a la cabecera
//      `Referer` y a la captura que alguien reenvía por un grupo. Ese enlace
//      además no caducaba ni se consumía.
//    · `sendInviteEmail` (functions/index.js) admitía que no viniera token y
//      componía el clásico ÉL MISMO.
//    · Y por esa segunda puerta se colaban TRES ALTAS DIRIGIDAS que nadie
//      había mirado —create-direct.js (dos) e individual-entity.js—, porque
//      llamaban sin `inviteToken`. El defecto estaba documentado como «el de
//      secretary.js» y por eso sus tres hermanos sobrevivieron a v633.
//
//  🔑 LO QUE VIGILA ESTE GUARD ES QUE NO HAYA DESTINO. Mientras el fabricante
//  clásico exista en algún sitio, sigue siendo un lugar al que caerse. Por eso
//  no basta con comprobar que nadie lo llama: se comprueba que NO ESTÁ.
//
//  🔑🔑 Y LA PUERTA QUE DE VERDAD CIERRA ES LA DEL SERVIDOR. Esto es una PWA:
//  un navegador con el Service Worker viejo en caché ejecuta el cliente de
//  ayer durante días. Arreglar a los cuatro llamadores no basta mientras el
//  servidor siga dispuesto a componer el enlace con PII para quien se lo pida.
//
//  ⚠️ LO QUE **NO** SE TOCA: resolver un enlace viejo que ya está en el buzón
//  de alguien. De eso se encarga invite-prefill.js, que acepta las dos formas.
//  Fabricar ≠ resolver, y v633 confundió las dos cosas al justificar el
//  respaldo. La compatibilidad de lectura la cubre
//  test_invitacion_token_opaco.js (aserción 6c).
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 400)); }
};

// Quita comentarios: lo que se vigila es el CÓDIGO. Las notas de cabecera
// citan el enlace clásico a propósito —explican por qué se fue— y buscar la
// cadena a pelo daría rojo en falso sobre una explicación.
const soloCodigo = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

const UTILS = leer('js/core/utils.js');
const SEC   = leer('js/admin/superadmin/secretary.js');
const CRE   = leer('js/admin/superadmin/create-direct.js');
const ENT   = leer('js/admin/superadmin/individual-entity.js');
const FUNCS = leer('functions/index.js');

console.log('\n══ 🔒 SEC-INV2 · la invitación no degrada a texto en claro ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🧨 El fabricante clásico no existe en ninguna parte');
{
    const sb = { console: { log() {}, warn() {}, error() {} }, URLSearchParams };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(UTILS, sb);

    ok('1a · 🔑🔑 utils.js NO publica `cronosInviteUrl`',
       typeof sb.window.cronosInviteUrl === 'undefined',
       'era el destino de la caída; mientras exista, se puede volver a caer ahí');

    ok('1b · el fabricante bueno sí está, y es el único',
       typeof sb.window.cronosCrearInvitacion === 'function');

    ok('1c · `CRONOS_APP_URL` se queda (la necesita el enlace con token)',
       sb.window.CRONOS_APP_URL === 'https://cronos-futbol-app.web.app');

    // El respaldo que vivía DENTRO de secretary.js, escrito a mano, era tan
    // peligroso como el de utils.js: se disparaba justo cuando utils.js no
    // estaba cargado, que es el escenario de un arranque a medias.
    ok('1d · 🔑 secretary.js tampoco tiene un respaldo escrito a mano',
       !/register=true/.test(soloCodigo(SEC)) &&
       !/cronosInviteUrl/.test(soloCodigo(SEC)),
       'la copia de emergencia interna era la que el sandbox del guard viejo medía en verde');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🛑 EJECUTADO: si no se puede acuñar, LANZA (no devuelve nada)');
{
    // Se ejecuta el trozo real de secretary.js, como hace el guard de v633:
    // medir la forma del texto no distingue «lanza» de «devuelve una cadena».
    const trozo = SEC.slice(SEC.indexOf('const SEC_ENLACE_PENDIENTE'),
                            SEC.indexOf('// ── Plantillas de fábrica'));

    const nuevoSandbox = () => {
        const sb = {
            console: { log() {}, warn() {} },
            document: { getElementById: (id) => sb.__campos[id] || null, querySelector: () => null },
            __campos: {
                'sec-email': { value: 'familia@ejemplo.com' },
                'sec-role':  { value: 'parent' },
                'sec-club':  { value: 'CD Prueba' },
            },
            Date, Math, String, Number, Array, Object, JSON, RegExp, Promise, setTimeout,
            URLSearchParams, encodeURIComponent, Error,
        };
        sb.window = sb;
        sb._saToast = () => {};
        vm.createContext(sb);
        vm.runInContext(trozo, sb);
        return sb;
    };

    const capturar = async (sb) => {
        try { return { url: await sb.window._secEnlaceReal(), err: null }; }
        catch (e) { return { url: null, err: e }; }
    };

    (async () => {
        // (a) El fabricante NO está cargado (arranque a medias, utils.js tarde).
        const sinFabricante = nuevoSandbox();
        const r1 = await capturar(sinFabricante);
        ok('2a · 🔑🔑 sin `cronosCrearInvitacion` cargado → LANZA',
           r1.err instanceof Error && r1.url === null,
           r1.url !== null ? ('devolvió: ' + r1.url) : 'ok');

        ok('2b · 🔑🔑 y lo que NO hace es devolver una URL con el correo dentro',
           r1.url === null || (!/familia%40ejemplo/.test(r1.url) && !/register=true/.test(r1.url)),
           r1.url);

        // (b) El fabricante está, pero falla (sin red, permisos, cuota).
        const falla = nuevoSandbox();
        falla.window.cronosCrearInvitacion = async () => { throw new Error('offline'); };
        const r2 = await capturar(falla);
        ok('2c · 🔑🔑 si el acuñado FALLA → LANZA, no degrada',
           r2.err instanceof Error && r2.url === null,
           r2.url !== null ? ('devolvió: ' + r2.url) : 'ok');

        ok('2d · y el motivo que sale es legible para quien invita',
           r2.err && /enlace seguro/i.test(r2.err.message), r2.err && r2.err.message);

        // (c) El fabricante responde, pero a medias. Un `undefined` metido en
        //     `{enlace}` saldría dentro del correo sin que nadie lo notara.
        const aMedias = nuevoSandbox();
        aMedias.window.cronosCrearInvitacion = async () => ({ token: 'abc', url: '' });
        const r3 = await capturar(aMedias);
        ok('2e · 🔑 una respuesta INCOMPLETA tampoco pasa',
           r3.err instanceof Error && r3.url === null,
           r3.url !== null ? ('devolvió: ' + r3.url) : 'ok');

        // (d) Y el camino bueno sigue funcionando, claro.
        const bien = nuevoSandbox();
        bien.window.cronosCrearInvitacion = async () => ({ token: 'tok', url: 'https://x/?invite=tok' });
        const r4 = await capturar(bien);
        ok('2f · el camino bueno devuelve el enlace con token',
           r4.err === null && r4.url === 'https://x/?invite=tok', r4.err || r4.url);

        parte3();
    })();
}

// ════════════════════════════════════════════════════════════════════
function parte3() {
console.log('\n3) 🚪 Los dos caminos de salida PARAN en vez de seguir');
{
    const cod = soloCodigo(SEC);

    const copiar = cod.slice(cod.indexOf('saCopiarEnlace = async function'),
                             cod.indexOf('saSendInvite = async function'));
    ok('3a · Copiar captura el fallo, lo dice y hace `return`',
       /catch\s*\(e\)\s*\{[\s\S]*?_saToast\([\s\S]*?return;[\s\S]*?\}/.test(copiar),
       'sin el return seguiría hasta el portapapeles con la cadena vacía');

    const enviar = cod.slice(cod.indexOf('saSendInviteEmail = async function'),
                             cod.indexOf('function _limpiarFormularioSecretaria'));

    ok('3b · 🔑🔑 Enviar para ANTES de componer el cuerpo del correo',
       enviar.indexOf('return;') > -1 &&
       enviar.indexOf('return;') < enviar.indexOf('const datos'),
       'si parase después, el cuerpo ya llevaría dentro el aviso de «pendiente»');

    ok('3c · 🔑 y para ANTES de abrir el correo local (`_mailto`)',
       enviar.indexOf('return;') < enviar.indexOf('_mailto()'),
       'el respaldo de mailto abre el cliente de correo del SuperAdmin con el cuerpo ya escrito');

    ok('3d · el acuñado va dentro de un try/catch, no suelto',
       /try\s*\{\s*await _secEnlaceReal\(\);\s*\}\s*catch/.test(enviar),
       'una excepción suelta dejaría el spinner colgado y sin explicación');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) 📮 Las TRES altas dirigidas acuñan token (las que v633 no miró)');
{
    // 🔑 BARRIDO ESTRUCTURAL, NO UNA LISTA A MANO. Una lista escrita aquí
    //    envejece igual que envejeció la nota de v633: el cuarto llamador que
    //    alguien añada mañana no estaría en ella y no lo vería nadie. Se
    //    buscan TODAS las llamadas a `sendInviteEmail` de js/ y se exige que
    //    cada una lleve `inviteToken`.
    const ficheros = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith('.js')) ficheros.push(p);
        }
    })(path.join(ROOT, 'js'));

    const sitios = [];
    for (const f of ficheros) {
        const src = soloCodigo(fs.readFileSync(f, 'utf8'));
        const re = /httpsCallable\([^)]*,\s*'sendInviteEmail'\s*\)/g;
        let m;
        while ((m = re.exec(src)) !== null) {
            // La llamada real va justo después de obtener el callable.
            const ventana = src.slice(m.index, m.index + 500);
            sitios.push({
                fichero: path.relative(ROOT, f).replace(/\\/g, '/'),
                conToken: /inviteToken/.test(ventana),
            });
        }
    }

    ok('4a · se encuentran los cuatro puntos de envío conocidos',
       sitios.length >= 4, sitios.map(s => s.fichero).join(', '));

    const sinToken = sitios.filter(s => !s.conToken);
    ok('4b · 🔑🔑 TODA llamada a `sendInviteEmail` lleva `inviteToken`',
       sinToken.length === 0,
       sinToken.length ? ('sin token: ' + sinToken.map(s => s.fichero).join(', ')) : 'ok');

    // Y que acuñen de verdad, no que pasen una cadena vacía.
    ok('4c · create-direct.js acuña en sus DOS caminos (reactivar y crear)',
       (soloCodigo(CRE).match(/cronosCrearInvitacion\(/g) || []).length === 2,
       (soloCodigo(CRE).match(/cronosCrearInvitacion\(/g) || []).length);

    ok('4d · individual-entity.js acuña en el suyo',
       /cronosCrearInvitacion\(/.test(soloCodigo(ENT)));

    // ⚠️ El alta ya se ha hecho cuando llega el envío: si el acuñado falla, lo
    //    que NO puede pasar es que se pierda el aviso y el SuperAdmin crea que
    //    la persona ha recibido su invitación.
    ok('4e · 🔑 si el acuñado falla, el alta sobrevive y SE DICE',
       /Reenvíala desde Secretaría/.test(CRE) && /Reenvíala desde Secretaría/.test(ENT),
       'un envío que falla en silencio deja a alguien esperando un correo que no llegó');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n5) 🛡️ La puerta que de verdad cierra: el servidor');
{
    const bloque = FUNCS.slice(FUNCS.indexOf('exports.sendInviteEmail'),
                               FUNCS.indexOf('exports.registerStaffUid'));
    const cod = soloCodigo(bloque);

    ok('5a · 🔑🔑 la Function YA NO sabe componer el enlace con PII',
       !/inviteParams/.test(cod) &&
       !/set\('register'/.test(cod) &&
       !/set\('email'/.test(cod),
       'mientras supiera, un cliente viejo en caché seguiría consiguiéndolo');

    // ⚠️ SE ATA AL TOKEN, NO A LA CADENA SUELTA. Buscar `invalid-argument` a
    //    secas daba VERDE aunque el rechazo no existiera: esta misma función
    //    ya lanza `invalid-argument` dos veces más (destinatario vacío y
    //    destinatario con forma de lista). Lo cazó el red-check de este guard.
    ok('5b · 🔑🔑 sin token válido, RECHAZA (y el rechazo cuelga DEL TOKEN)',
       /!\/\^\[A-Za-z0-9_-\]\{8,64\}\$\/\.test\(tokenLimpio\)\)\s*\{[\s\S]{0,500}?HttpsError\(\s*\n?\s*'invalid-argument'/.test(cod),
       'el `if` del token y el `throw` tienen que ser el mismo bloque');

    ok('5c · y sigue validando la FORMA del token antes de meterlo en el href',
       /\/\^\[A-Za-z0-9_-\]\{8,64\}\$\/\.test\(tokenLimpio\)/.test(cod),
       'va dentro de un atributo href de un correo HTML');

    ok('5d · el rechazo queda anotado con su motivo',
       /RECHAZADA/.test(cod) && /sin inviteToken/.test(bloque));

    ok('5e · 🔑 la dirección la sigue componiendo el SERVIDOR, no el cliente',
       /inviteUrl = APP_URL \+ '\/\?invite=' \+ encodeURIComponent\(tokenLimpio\)/.test(cod) &&
       !/data\.inviteUrl/.test(cod),
       'aceptar una URL del payload sería phishing con la marca de la plataforma');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n6) ↩️ Lo que NO se ha roto: los enlaces ya enviados se resuelven');
{
    const PREF = leer('js/services/auth/invite-prefill.js');

    ok('6a · el resolutor sigue aceptando `?invite=<token>`',
       /p\.get\('invite'\)/.test(PREF));

    ok('6b · 🔑 y sigue aceptando la forma ANTIGUA de los correos ya enviados',
       /register/.test(PREF) || /email = inv\.email \|\| email/.test(PREF),
       'fabricar ≠ resolver: se ha quitado el fabricante, no el lector');
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
}
