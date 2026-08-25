// ─────────────────────────────────────────────────────────────────────────
// test_sa_secretary_module.js · Refactor de monolitos (auditoría
// 2026-07-22) — PASO 7: extracción de "Secretaría/invites"
// (saSecretary / saToggleMethod / saUpdateInviteTemplate /
// saResetInviteTemplate / saSendInvite / saSendInviteEmail /
// saSendInviteWhatsApp / _limpiarFormularioSecretaria) desde
// js/admin/superadmin/superadmin.panel.js a su propio archivo.
//
// Coupling verificado antes de escribir este test: la única entrada
// externa es saTab() (línea 230, fuera del bloque) llamando a
// saSecretary() al cambiar de pestaña. Ninguna otra sección del archivo
// ni de otros módulos referencia estos nombres — es la sección MÁS
// autocontenida hasta ahora (sin fan-out hacia saTab/saIndividuals/
// saClubs). Cero solapamiento con el WIP sin commitear de
// saSetClubUserStatus/setupClubsSyncListener (línea >=2110) ni con el de
// Mensajería SA (línea >=2655) — verificado con `git diff` antes de
// escribir este test.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCE = fs.existsSync(path.join(ROOT, 'js', 'admin', 'superadmin', 'secretary.js'))
    ? path.join(ROOT, 'js', 'admin', 'superadmin', 'secretary.js')
    : path.join(ROOT, 'js', 'admin', 'superadmin', 'superadmin.panel.js');

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Secretaría/invites — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Infra: fakes de DOM ═══════════════════════
function makeClassList() {
    const set = new Set();
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
}
function makeEl(initial) {
    // `textContent` lo escribe la vista previa de v594.
    return Object.assign({ value: '', innerHTML: '', textContent: '', style: {}, classList: makeClassList(), addEventListener: () => {}, setAttribute: () => {}, removeAttribute: () => {}, select: () => {} }, initial);
}

function buildSandbox({ elements = {}, secMethod = 'email', hasFunctions = true, confirmReturns = true, sendEmailResult = null, sendEmailThrows = null } = {}) {
    const toasts = [];
    const spinners = [];
    const openCalls = [];
    const httpsCallableCalls = [];
    const els = {};
    for (const [id, init] of Object.entries(elements)) els[id] = makeEl(init);
    // ids que las funciones asumen presentes salvo que el test los omita a propósito
    // v594 añade 'sec-link' (el enlace visible y copiable) y 'sec-preview'
    // (la vista previa ya sustituida). Sin ellos, saUpdateInvitePreview
    // sencillamente no pinta nada — no falla —, pero entonces el guard no
    // podría comprobar ninguna de las dos cosas nuevas.
    for (const id of ['sec-name', 'sec-email', 'sec-phone', 'sec-club', 'sec-role', 'sec-subject', 'sec-body', 'sec-btn-text', 'sec-email-block', 'sec-phone-block', 'sec-subject-block', 'sa-body', 'sec-link', 'sec-preview']) {
        if (!els[id]) els[id] = makeEl({});
    }

    const fns = {
        fa: { functions: hasFunctions ? {} : null },
        httpsCallable: (functionsRef, name) => {
            return async (payload) => {
                httpsCallableCalls.push({ name, payload });
                // v594: se admite lanzar un objeto {code, message} para poder
                // ejercitar la TRADUCCIÓN del fallo real del servidor. Una
                // cadena suelta sigue funcionando como siempre.
                if (sendEmailThrows) {
                    if (typeof sendEmailThrows === 'object') {
                        const err = new Error(sendEmailThrows.message || 'fallo');
                        err.code = sendEmailThrows.code;
                        throw err;
                    }
                    throw new Error(sendEmailThrows);
                }
                return { data: sendEmailResult || { success: true } };
            };
        },
    };

    const sandbox = {
        document: {
            getElementById: (id) => els[id] || null,
            querySelector: (sel) => {
                if (sel.includes('sec-method')) return { value: secMethod };
                return null;
            },
        },
        window: {},
        confirm: () => confirmReturns,
        console: { log() {}, warn() {}, error() {} },
        setTimeout, clearTimeout,
        Promise, Map, Array, Object, String, Date, Math, parseInt, JSON, encodeURIComponent,
        saFS: async () => fns,
    };
    sandbox.window.open = (url) => { openCalls.push(url); };
    sandbox.window.saFS = sandbox.saFS;
    vm.createContext(sandbox);

    const src = fs.readFileSync(SOURCE, 'utf8');
    const start = src.indexOf('window.saSecretary = async function');
    if (start === -1) throw new Error('No se encontró saSecretary en ' + SOURCE);
    const endMarker = 'Aprobación rápida paso 1 desde vista de clubes';
    const endIdx = src.indexOf(endMarker);
    const block = endIdx !== -1 ? src.slice(start, endIdx) : src.slice(start);

    const stubs = `
        var _saShowSpinner = function(msg) { __spinners.push({on:true, msg}); };
        var _saHideSpinner = function() { __spinners.push({on:false}); };
        var _saToast = function(msg, ms) { __toasts.push(msg); };
        var saFS = window.saFS;
        var confirm = window.confirm || confirm;
    `;
    sandbox.__spinners = spinners;
    sandbox.__toasts = toasts;
    vm.runInContext(stubs + block, sandbox);

    return { sandbox, els, toasts, spinners, openCalls, httpsCallableCalls };
}

(async () => {
    console.log('── PARTE 1 · estructura ──');
    const rawSrc = fs.readFileSync(SOURCE, 'utf8');
    ok('1a · saSecretary existe', /window\.saSecretary\s*=\s*async function/.test(rawSrc));
    ok('1b · saToggleMethod existe', /window\.saToggleMethod\s*=\s*function/.test(rawSrc));
    ok('1c · saUpdateInviteTemplate existe', /window\.saUpdateInviteTemplate\s*=\s*function/.test(rawSrc));
    ok('1d · saResetInviteTemplate existe', /window\.saResetInviteTemplate\s*=\s*function/.test(rawSrc));
    ok('1e · saSendInvite existe', /window\.saSendInvite\s*=\s*async function/.test(rawSrc));
    ok('1f · saSendInviteEmail existe', /window\.saSendInviteEmail\s*=\s*async function/.test(rawSrc));
    ok('1g · saSendInviteWhatsApp existe', /window\.saSendInviteWhatsApp\s*=\s*function/.test(rawSrc));
    ok('1h · _limpiarFormularioSecretaria existe (helper interno)', /function _limpiarFormularioSecretaria\s*\(/.test(rawSrc));

    console.log('\n── PARTE 2 · saSecretary (render) ──');
    {
        const { sandbox, els } = buildSandbox({});
        await sandbox.window.saSecretary();
        ok('2a · renderiza formulario con campos esperados', /Secretaría/.test(els['sa-body'].innerHTML) && /sec-name/.test(els['sa-body'].innerHTML) && /sec-body/.test(els['sa-body'].innerHTML));
    }

    console.log('\n── PARTE 3 · saToggleMethod ──');
    {
        const { sandbox, els } = buildSandbox({ elements: { 'sec-body': { classList: makeClassList() } } });
        sandbox.window.saToggleMethod('whatsapp');
        ok('3a · whatsapp -> muestra bloque teléfono, oculta email/asunto', els['sec-phone-block'].style.display === 'block' && els['sec-email-block'].style.display === 'none' && els['sec-subject-block'].style.display === 'none');
        ok('3b · whatsapp -> texto de botón actualizado', /WhatsApp/.test(els['sec-btn-text'].innerHTML));
    }
    {
        const { sandbox, els } = buildSandbox({ elements: { 'sec-body': { classList: makeClassList() } } });
        sandbox.window.saToggleMethod('email');
        ok('3c · email -> muestra bloque email/asunto, oculta teléfono', els['sec-email-block'].style.display === 'block' && els['sec-subject-block'].style.display === 'block' && els['sec-phone-block'].style.display === 'none');
    }

    console.log('\n── PARTE 4 · saUpdateInviteTemplate ──');
    {
        const { sandbox, els } = buildSandbox({ secMethod: 'email', elements: { 'sec-name': { value: 'Ana' }, 'sec-role': { value: 'club_admin' }, 'sec-club': { value: 'CD Prueba' } } });
        sandbox.window.saUpdateInviteTemplate();
        // ⚠️⚠️ v594 · CAMBIO DELIBERADO DE MODELO, NO UNA REGRESIÓN.
        // Antes el textarea llevaba el TEXTO FINAL, con el nombre del
        // destinatario ya dentro. Eso hacía imposible el encargo 3 del autor
        // —guardar la plantilla "para futuras invitaciones"—: la siguiente
        // invitación habría saludado a Luis llamándole Ana.
        // Ahora el textarea lleva la PLANTILLA con marcas y la sustitución se
        // ve en `sec-preview`. La comprobación de fondo NO cambia: los datos
        // del formulario tienen que llegar al mensaje que se envía.
        ok('4a · la plantilla lleva las MARCAS, no el nombre incrustado',
           /\{nombre\}/.test(els['sec-body'].value) && !/Ana/.test(els['sec-body'].value));
        ok('4a2 · 🔑 y la VISTA PREVIA sí trae nombre, rol y club ya sustituidos',
           /Ana/.test(els['sec-preview'].textContent) &&
           /Administrador de Club/.test(els['sec-preview'].textContent) &&
           /CD Prueba/.test(els['sec-preview'].textContent),
           els['sec-preview'].textContent.slice(0, 90));
        ok('4b · plantilla email NO usa formato markdown de WhatsApp', !els['sec-body'].value.includes('*Invitación'));
    }
    {
        const { sandbox, els } = buildSandbox({ secMethod: 'whatsapp', elements: { 'sec-name': { value: 'Luis' }, 'sec-role': { value: 'user' } } });
        sandbox.window.saUpdateInviteTemplate();
        ok('4c · plantilla whatsapp usa formato markdown, y la vista previa trae el nombre',
           /Invitación a Chronos/.test(els['sec-body'].value) && /\*Luis\*/.test(els['sec-preview'].textContent));
    }
    {
        const cl = makeClassList(); cl.add('user-edited');
        const { sandbox, els } = buildSandbox({ elements: { 'sec-body': { value: 'texto manual del usuario', classList: cl } } });
        sandbox.window.saUpdateInviteTemplate();
        ok('4d · si el usuario editó el mensaje, NO se sobrescribe', els['sec-body'].value === 'texto manual del usuario');
    }

    console.log('\n── PARTE 5 · saResetInviteTemplate ──');
    {
        const cl = makeClassList(); cl.add('user-edited');
        const { sandbox, els, toasts } = buildSandbox({ elements: { 'sec-body': { value: 'editado', classList: cl }, 'sec-name': { value: 'Ana' } } });
        sandbox.window.saResetInviteTemplate();
        ok('5a · quita la marca user-edited', !els['sec-body'].classList.contains('user-edited'));
        // v594: regenerar deja la plantilla DE FÁBRICA (con marcas) y la vista
        // previa ya sustituida. Se comprueban las dos: que el texto editado se
        // fue, y que el nombre vuelve a llegar al mensaje.
        ok('5b · regenera la plantilla de fábrica y la previa trae el nombre',
           !/editado/.test(els['sec-body'].value) && /\{nombre\}/.test(els['sec-body'].value) &&
           /Ana/.test(els['sec-preview'].textContent));
        ok('5c · toast de confirmación', toasts.some(t => /restablecido/i.test(t)));
    }

    console.log('\n── PARTE 6 · saSendInvite (enrutador) ──');
    {
        const { sandbox, toasts, httpsCallableCalls } = buildSandbox({ elements: { 'sec-name': { value: '' } } });
        await sandbox.window.saSendInvite();
        ok('6a · sin nombre -> ningún envío', httpsCallableCalls.length === 0);
        ok('6b · sin nombre -> toast de aviso', toasts.some(t => /nombre.*obligatorio/i.test(t)));
    }
    {
        const { sandbox, httpsCallableCalls } = buildSandbox({
            secMethod: 'email', elements: { 'sec-name': { value: 'Ana' }, 'sec-email': { value: 'ana@x.com' } },
        });
        await sandbox.window.saSendInvite();
        ok('6c · método email -> enruta a saSendInviteEmail (Cloud Function invocada)', httpsCallableCalls.some(c => c.name === 'sendInviteEmail'));
    }
    {
        const { sandbox, openCalls } = buildSandbox({
            secMethod: 'whatsapp', elements: { 'sec-name': { value: 'Ana' }, 'sec-phone': { value: '34600112233' } },
        });
        await sandbox.window.saSendInvite();
        ok('6d · método whatsapp -> enruta a saSendInviteWhatsApp (abre wa.me)', openCalls.some(u => u.startsWith('https://wa.me/')));
    }

    console.log('\n── PARTE 7 · saSendInviteEmail — validación ──');
    {
        const { sandbox, httpsCallableCalls, toasts } = buildSandbox({ elements: { 'sec-email': { value: '' } } });
        await sandbox.window.saSendInviteEmail();
        ok('7a · sin email -> ningún envío', httpsCallableCalls.length === 0);
        ok('7b · sin email -> toast de aviso', toasts.some(t => /email.*obligatorio/i.test(t)));
    }

    console.log('\n── PARTE 8 · saSendInviteEmail — éxito del servidor ──');
    {
        const { sandbox, toasts, els } = buildSandbox({
            elements: { 'sec-email': { value: 'ok@x.com' }, 'sec-name': { value: 'Ana' } },
            sendEmailResult: { success: true },
        });
        await sandbox.window.saSendInviteEmail();
        ok('8a · toast de éxito con el destinatario', toasts.some(t => /éxito/i.test(t) && /ok@x\.com/.test(t)));
        ok('8b · limpia el formulario (sec-email vacío tras enviar)', els['sec-email'].value === '');
    }

    console.log('\n── PARTE 9 · saSendInviteEmail — sin credenciales en servidor (fallback mailto) ──');
    {
        const { sandbox, toasts, openCalls } = buildSandbox({
            elements: { 'sec-email': { value: 'nocred@x.com' }, 'sec-name': { value: 'Ana' } },
            sendEmailResult: { noCredentials: true },
        });
        await sandbox.window.saSendInviteEmail();
        ok('9a · abre mailto automáticamente sin pedir confirmación', openCalls.some(u => u.startsWith('mailto:nocred@x.com')));
        ok('9b · toast explicativo', toasts.some(t => /correo local/i.test(t)));
    }

    console.log('\n── PARTE 10 · saSendInviteEmail — error de conexión (catch + confirm) ──');
    {
        const { sandbox, openCalls, toasts } = buildSandbox({
            elements: { 'sec-email': { value: 'err@x.com' }, 'sec-name': { value: 'Ana' } },
            sendEmailThrows: 'network down', confirmReturns: true,
        });
        await sandbox.window.saSendInviteEmail();
        ok('10a · el fallo del servidor lleva igualmente al correo local', openCalls.some(u => u.startsWith('mailto:err@x.com')));
        // ⚠️⚠️ v594 · YA NO HAY confirm(). Un modal para decir "no he podido"
        // obliga a contestar y la salida es la MISMA se conteste lo que se
        // conteste. Se abre el correo local y se explica el motivo.
        ok('10b · avisa de que abre el correo local', toasts.some(t => /correo local/i.test(t)));
    }
    {
        // 🔑🔑🔑 EL ENCARGO 1 DEL AUTOR, FIJADO: un permission-denied NO se
        // puede seguir enseñando como "error de conexión". Era lo que le hacía
        // mirar la red cuando lo que fallaba era un permiso del servidor
        // (mismo defecto de diagnóstico que costó v568).
        const { sandbox, toasts } = buildSandbox({
            elements: { 'sec-email': { value: 'err2@x.com' }, 'sec-name': { value: 'Ana' } },
            sendEmailThrows: { code: 'functions/permission-denied', message: 'denied' },
        });
        await sandbox.window.saSendInviteEmail();
        ok('10c · 🔑 un permiso denegado se nombra como permiso, NO como "error de conexión"',
           toasts.some(t => /permiso/i.test(t)) && !toasts.some(t => /error de conexi/i.test(t)),
           toasts.join(' | '));
    }
    {
        const { sandbox, toasts } = buildSandbox({
            elements: { 'sec-email': { value: 'err3@x.com' }, 'sec-name': { value: 'Ana' } },
            sendEmailThrows: { code: 'functions/unavailable', message: 'offline' },
        });
        await sandbox.window.saSendInviteEmail();
        ok('10d · … y un fallo de red SÍ se nombra como conexión',
           toasts.some(t => /conexi/i.test(t)), toasts.join(' | '));
    }

    console.log('\n── PARTE 11 · saSendInviteEmail — Functions no disponible en el cliente ──');
    {
        const { sandbox, openCalls } = buildSandbox({
            elements: { 'sec-email': { value: 'nofn@x.com' }, 'sec-name': { value: 'Ana' } },
            hasFunctions: false, confirmReturns: true,
        });
        await sandbox.window.saSendInviteEmail();
        ok('11a · fa.functions ausente -> cae al mismo fallback mailto', openCalls.some(u => u.startsWith('mailto:nofn@x.com')));
    }

    console.log('\n── PARTE 12 · saSendInviteWhatsApp ──');
    {
        const { sandbox, openCalls, toasts } = buildSandbox({ elements: { 'sec-phone': { value: '' } } });
        sandbox.window.saSendInviteWhatsApp();
        ok('12a · sin teléfono -> ningún window.open', openCalls.length === 0);
        ok('12b · sin teléfono -> toast de aviso', toasts.some(t => /teléfono.*obligatorio/i.test(t)));
    }
    {
        const { sandbox, openCalls, toasts } = buildSandbox({ elements: { 'sec-phone': { value: '12345' } } });
        sandbox.window.saSendInviteWhatsApp();
        ok('12c · teléfono demasiado corto -> ningún window.open', openCalls.length === 0);
        ok('12d · teléfono demasiado corto -> toast de aviso', toasts.some(t => /no parece ser válido/i.test(t)));
    }
    {
        const { sandbox, openCalls, toasts, els } = buildSandbox({ elements: { 'sec-phone': { value: '+34 600 11 22 33' }, 'sec-name': { value: 'Ana' }, 'sec-body': { value: 'hola' } } });
        sandbox.window.saSendInviteWhatsApp();
        ok('12e · limpia caracteres no numéricos del teléfono y abre wa.me', openCalls.some(u => u === 'https://wa.me/34600112233?text=hola'));
        ok('12f · toast de confirmación', toasts.some(t => /Abriendo WhatsApp/i.test(t)));
        ok('12g · limpia los campos del formulario', els['sec-phone'].value === '' && els['sec-name'].value === '');
    }

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 13 · v594 · el ENLACE, visible, correcto y copiable ──');
    // ═══════════════════════════════════════════════════════════════════
    //  🔑🔑🔑 EL DEFECTO QUE ÉL NO HABÍA REPORTADO. El enlace se construía en
    //  DOS sitios distintos: el cliente ponía `?invite=true` y la Cloud
    //  Function `?register=true&role=…&clubName=…`. Y sólo `register=true`
    //  DEJA AL INVITADO EN EL FORMULARIO DE ALTA — `invite` únicamente salta
    //  el onboarding. O sea, al invitado por WhatsApp (el único camino que
    //  funcionaba) se le mandaba el enlace flojo, y sin ningún error visible:
    //  la app abría y simplemente no hacía lo que debía.
    {
        const { sandbox, els } = buildSandbox({
            elements: { 'sec-email': { value: 'ana@x.com' }, 'sec-role': { value: 'coordinator' }, 'sec-club': { value: 'CD Prueba' } },
        });
        sandbox.window.saUpdateInviteTemplate();
        const url = els['sec-link'].value;
        ok('13a · el enlace se pinta en pantalla', !!url, url);
        ok('13b · 🔑 lleva register=true (lo que deja al invitado EN el alta), no invite=true',
           /register=true/.test(url) && !/invite=true/.test(url), url);
        ok('13c · lleva el correo, el rol y el club dentro',
           /email=ana%40x\.com/.test(url) && /role=coordinator/.test(url) && /clubName=CD\+Prueba|clubName=CD%20Prueba/.test(url), url);
        // ⚠️ ACTUALIZADA EN LA v630, y por PETICIÓN EXPRESA del autor
        // (implementar.txt 2026-08-25, punto 1): «elimina la línea de texto con
        // el enlace suelto del primer párrafo [...] de esta forma evitamos
        // repeticiones innecesarias». En el CORREO el enlace ya viaja dos veces
        // dentro del HTML (el botón y la frase de respaldo), así que el cuerpo
        // ya no lo repite.
        //
        // 🔑 LO QUE ESTA PARTE VINO A PROTEGER NO CAMBIA. El defecto de v594
        // era que el enlace se construía en DOS sitios con parámetros distintos
        // y el del mensaje era el flojo (`invite=true`). Eso se sigue midiendo:
        // en WhatsApp —donde el enlace SÍ va en el cuerpo, porque no hay botón—
        // tiene que ser exactamente el mismo que el de pantalla.
        ok('13d · ⚠️ v630 · en EMAIL el cuerpo ya NO repite el enlace',
           !els['sec-preview'].textContent.includes(url),
           'lo llevan el botón y la frase de respaldo del HTML (functions/index.js)');
    }
    {
        const { sandbox, els } = buildSandbox({
            secMethod: 'whatsapp',
            elements: { 'sec-email': { value: 'ana@x.com' }, 'sec-role': { value: 'coordinator' }, 'sec-club': { value: 'CD Prueba' } },
        });
        sandbox.window.saUpdateInviteTemplate();
        const url = els['sec-link'].value;
        ok('13d-wa · 🔑 en WhatsApp el enlace del MENSAJE sigue siendo el de pantalla',
           !!url && els['sec-preview'].textContent.includes(url),
           'ahí es el ÚNICO camino: no hay botón ni frase de respaldo · ' + url);
    }
    {
        // Cambiar un dato del formulario tiene que mover el enlace: enseñar
        // uno viejo sería peor que no enseñar ninguno, porque se copia y se
        // manda sin mirar.
        const { sandbox, els } = buildSandbox({ elements: { 'sec-email': { value: 'uno@x.com' } } });
        sandbox.window.saUpdateInviteTemplate();
        const antes = els['sec-link'].value;
        els['sec-email'].value = 'dos@x.com';
        sandbox.window.saUpdateInvitePreview();
        ok('13e · se actualiza al cambiar el destinatario',
           antes !== els['sec-link'].value && /dos%40x\.com/.test(els['sec-link'].value));
    }

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 14 · v594 · plantilla del club: editable y guardable ──');
    // ═══════════════════════════════════════════════════════════════════
    {
        const { sandbox, els } = buildSandbox({ elements: { 'sec-club': { value: 'CD Prueba' } } });
        sandbox.window.saUpdateInviteTemplate();
        ok('14a · 🔑 con club, la firma NO es "El Equipo de Chronos Fútbol" (era el encargo del autor)',
           !/El Equipo de Chronos/.test(els['sec-body'].value), els['sec-body'].value.slice(-70));
        ok('14b · … firma la dirección deportiva de ESE club',
           /Dirección Deportiva de CD Prueba/.test(els['sec-body'].value));
    }
    {
        const { sandbox, els } = buildSandbox({});
        sandbox.window.saUpdateInviteTemplate();
        ok('14c · sin club (SuperAdmin) se mantiene la firma genérica de siempre',
           /El Equipo de Chronos Fútbol/.test(els['sec-body'].value));
    }
    {
        // Lo guardado por el club MANDA sobre la plantilla de fábrica.
        const { sandbox, els } = buildSandbox({});
        sandbox.window._secGuardadas = { email: 'Plantilla propia para {nombre}' };
        els['sec-name'].value = 'Ana';
        sandbox.window.saUpdateInviteTemplate();
        ok('14d · la plantilla guardada del club sustituye a la de fábrica',
           els['sec-body'].value === 'Plantilla propia para {nombre}');
        ok('14e · y se sustituye en la vista previa',
           els['sec-preview'].textContent === 'Plantilla propia para Ana');
    }
    {
        // ⚠️ Editar a mano protege el texto: ni cambiar de rol, ni de club, ni
        // de método pueden pisarle lo que ha escrito.
        const cl = makeClassList();
        const { sandbox, els } = buildSandbox({ elements: { 'sec-body': { value: 'mi texto', classList: cl } } });
        sandbox.window.saOnBodyInput();
        sandbox.window.saUpdateInviteTemplate();
        ok('14f · lo escrito a mano no se sobrescribe', els['sec-body'].value === 'mi texto');
    }
    {
        // 🔑 SIN clubId (SuperAdmin) NO se intenta escribir en Firestore: se
        // guarda local y se DICE que es local. Un "guardado" que miente es
        // peor que un fallo (lección de v570).
        const { sandbox, toasts } = buildSandbox({ elements: { 'sec-body': { value: 'plantilla nueva' } } });
        sandbox.window._secCtx = { clubId: '', clubName: '', clubFijo: false };
        await sandbox.window.saGuardarPlantilla();
        ok('14g · sin club, avisa de que se guarda solo en este navegador',
           toasts.some(t => /este navegador/i.test(t)), toasts.join(' | '));
    }
    {
        const { sandbox, toasts } = buildSandbox({ elements: { 'sec-body': { value: '' } } });
        await sandbox.window.saGuardarPlantilla();
        ok('14h · un mensaje vacío no se guarda', toasts.some(t => /vacío/i.test(t)));
    }
    {
        // Guardar la de correo NO puede borrar la de WhatsApp.
        const { sandbox } = buildSandbox({ secMethod: 'whatsapp', elements: { 'sec-body': { value: 'wa nueva' } } });
        sandbox.window._secCtx = { clubId: '', clubName: '', clubFijo: false };
        sandbox.window._secGuardadas = { email: 'la de correo' };
        await sandbox.window.saGuardarPlantilla();
        ok('14i · guardar una modalidad conserva la otra',
           sandbox.window._secGuardadas.email === 'la de correo' &&
           sandbox.window._secGuardadas.whatsapp === 'wa nueva');
    }

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 15 · v594 · el envío manda TEXTO, no marcas ──');
    // ═══════════════════════════════════════════════════════════════════
    //  ⚠️ El servidor no sabe nada de {nombre}: si se le mandara la plantilla
    //  en crudo, el correo saldría con las llaves dentro. Es el fallo más
    //  fácil de cometer con este diseño, así que va fijado.
    {
        const { sandbox, httpsCallableCalls } = buildSandbox({
            elements: { 'sec-email': { value: 'ana@x.com' }, 'sec-name': { value: 'Ana' }, 'sec-body': { value: 'Hola {nombre}, entra en {enlace}' } },
        });
        await sandbox.window.saSendInviteEmail();
        const enviado = (httpsCallableCalls[0] || {}).payload || {};
        ok('15a · 🔑 el cuerpo enviado va ya sustituido, sin marcas',
           !/\{nombre\}/.test(enviado.body || '') && /Hola Ana/.test(enviado.body || ''), enviado.body);
        ok('15b · y con el enlace real dentro', /register=true/.test(enviado.body || ''));
    }
    {
        const { sandbox, openCalls } = buildSandbox({
            secMethod: 'whatsapp',
            elements: { 'sec-phone': { value: '34600112233' }, 'sec-name': { value: 'Luis' }, 'sec-body': { value: 'Hola {nombre}' } },
        });
        sandbox.window.saSendInviteWhatsApp();
        ok('15c · WhatsApp también manda el texto sustituido',
           openCalls.some(u => u.includes('Hola%20Luis') || u.includes('Hola+Luis')), openCalls[0]);
    }

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 16 · v594 · el constructor CANÓNICO (js/core/utils.js) ──');
    // ═══════════════════════════════════════════════════════════════════
    //  ⚠️⚠️ ESTA PARTE EXISTE POR UN AGUJERO QUE DESTAPÓ EL RED-CHECK.
    //  El sandbox de arriba NO carga utils.js, así que secretary.js cae a su
    //  respaldo interno: al romper `cronosInviteUrl` a propósito, las
    //  aserciones 13a-13e siguieron TODAS en verde. O sea, el guard no
    //  protegía la función que de verdad usa el navegador — sólo la copia de
    //  emergencia. Se prueba aquí directamente, contra el fichero real.
    {
        const vm2 = require('vm');
        const sbU = { console: { log() {}, warn() {}, error() {} }, URLSearchParams };
        sbU.window = sbU;
        vm2.createContext(sbU);
        vm2.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8'), sbU);
        const build = sbU.window.cronosInviteUrl;
        ok('16a · utils.js publica cronosInviteUrl', typeof build === 'function');
        if (typeof build === 'function') {
            const u = build({ email: 'ana@x.com', role: 'user', clubName: 'CD Prueba' });
            ok('16b · 🔑 register=true, NUNCA invite=true (ver la nota de utils.js)',
               /register=true/.test(u) && !/invite=true/.test(u), u);
            ok('16c · arrastra correo, rol y club', /ana%40x\.com/.test(u) && /role=user/.test(u) && /clubName=CD/.test(u), u);
            ok('16d · apunta al dominio de producción', u.indexOf('https://cronos-futbol-app.web.app/?') === 0, u);
            const vacio = build({});
            ok('16e · sin datos sigue siendo un enlace válido de alta',
               /register=true/.test(vacio) && !/email=/.test(vacio), vacio);
        }
    }
    {
        // 🔑 Y QUE LOS DOS LADOS NO SE SEPAREN. La Cloud Function construye su
        // propio enlace (no acepta el del cliente, a propósito: reenviar por
        // correo una URL que llega en el payload es una vía de suplantación).
        // Si alguien cambia una forma y no la otra, el invitado del correo y
        // el del WhatsApp acaban en sitios distintos — sin ningún error.
        const fnSrc = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        const bloque = fnSrc.slice(fnSrc.indexOf('exports.sendInviteEmail'), fnSrc.indexOf('exports.registerStaffUid'));
        ok('16f · la Function usa la MISMA forma de enlace que el cliente',
           /inviteParams\.set\('register',\s*'true'\)/.test(bloque) &&
           /inviteParams\.set\('email'/.test(bloque) &&
           /inviteParams\.set\('role'/.test(bloque) &&
           /inviteParams\.set\('clubName'/.test(bloque));
    }

    // ═══════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 17 · v594 · la PUERTA del servidor deja pasar al Director ──');
    // ═══════════════════════════════════════════════════════════════════
    //  🔑🔑🔑 LA CAUSA REAL DEL "error de conexión" QUE REPORTÓ EL AUTOR.
    //  v590 le dio la PANTALLA de Secretaría al Director y nadie abrió esta
    //  puerta: la Function sólo admitía superadmin/admin, devolvía
    //  permission-denied y el cliente lo pintaba como un fallo de red.
    //  Medido en los registros de producción: auth VALID + status code 403.
    {
        const fnSrc = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
        const bloque = fnSrc.slice(fnSrc.indexOf('exports.sendInviteEmail'), fnSrc.indexOf('exports.registerStaffUid'));
        ok('17a · 🔑 ya NO exige ser SuperAdmin para enviar',
           !/!\['superadmin',\s*'admin'\]\.includes\(callerDoc\.data\(\)\.role\)/.test(bloque));
        // ⚠️ ESTA ES LA QUE DE VERDAD CIERRA EL CASO, y la añadí porque el
        // red-check la echó en falta: al volver a poner `_puedeInvitar =
        // _esSA` —o sea, al recrear el defecto exacto que reportó el autor—
        // TODAS las demás aserciones de esta parte seguían en verde, porque
        // sólo censaban que ciertas palabras estuvieran en el fichero.
        ok('17a2 · 🔑🔑 la DECISIÓN no se reduce al SuperAdmin (recrear el defecto pone esto en rojo)',
           /_puedeInvitar\s*=\s*_esSA\s*\|\|\s*_esStaffRaiz\s*\|\|\s*!!_plazaStaff/.test(bloque));
        ok('17a3 · y la denegación cuelga de esa decisión',
           /if \(!callerDoc\.exists \|\| !_puedeInvitar\)/.test(bloque));
        ok('17b · admite director y club_admin', /'director',\s*'club_admin'/.test(bloque));
        ok('17c · 🔑 mira allRoles, no sólo la raíz (en este proyecto la raíz va desfasada: v563, v581)',
           /allRoles/.test(bloque));
        ok('17d · ⚠️ y descarta las plazas revocadas',
           /status\s*!==\s*'removed'/.test(bloque) && /isAuthorized\s*!==\s*false/.test(bloque));
        ok('17e · 🔑🔑 el club se IMPONE al que no es SuperAdmin (si no, el campo editable dejaría invitar en nombre de otro club)',
           /_esSA\s*\?\s*data\.clubName\s*:/.test(bloque));
        ok('17f · sigue exigiendo sesión', /if \(!context\.auth\)/.test(bloque));
    }

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
