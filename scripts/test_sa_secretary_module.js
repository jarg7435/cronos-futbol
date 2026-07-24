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
    return Object.assign({ value: '', innerHTML: '', style: {}, classList: makeClassList(), addEventListener: () => {} }, initial);
}

function buildSandbox({ elements = {}, secMethod = 'email', hasFunctions = true, confirmReturns = true, sendEmailResult = null, sendEmailThrows = null } = {}) {
    const toasts = [];
    const spinners = [];
    const openCalls = [];
    const httpsCallableCalls = [];
    const els = {};
    for (const [id, init] of Object.entries(elements)) els[id] = makeEl(init);
    // ids que las funciones asumen presentes salvo que el test los omita a propósito
    for (const id of ['sec-name', 'sec-email', 'sec-phone', 'sec-club', 'sec-role', 'sec-subject', 'sec-body', 'sec-btn-text', 'sec-email-block', 'sec-phone-block', 'sec-subject-block', 'sa-body']) {
        if (!els[id]) els[id] = makeEl({});
    }

    const fns = {
        fa: { functions: hasFunctions ? {} : null },
        httpsCallable: (functionsRef, name) => {
            return async (payload) => {
                httpsCallableCalls.push({ name, payload });
                if (sendEmailThrows) throw new Error(sendEmailThrows);
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
        ok('4a · plantilla email incluye nombre/rol/club', /Ana/.test(els['sec-body'].value) && /Administrador de Club/.test(els['sec-body'].value) && /CD Prueba/.test(els['sec-body'].value));
        ok('4b · plantilla email NO usa formato markdown de WhatsApp', !els['sec-body'].value.includes('*Invitación'));
    }
    {
        const { sandbox, els } = buildSandbox({ secMethod: 'whatsapp', elements: { 'sec-name': { value: 'Luis' }, 'sec-role': { value: 'user' } } });
        sandbox.window.saUpdateInviteTemplate();
        ok('4c · plantilla whatsapp usa formato markdown y nombre', /\*Luis\*/.test(els['sec-body'].value) && /Invitación a Chronos/.test(els['sec-body'].value));
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
        ok('5b · regenera la plantilla', /Ana/.test(els['sec-body'].value));
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
        ok('10a · error + confirm aceptado -> abre mailto', openCalls.some(u => u.startsWith('mailto:err@x.com')));
        ok('10b · toast de apertura de cliente de correo', toasts.some(t => /Abriendo cliente de correo/i.test(t)));
    }
    {
        const { sandbox, openCalls, toasts } = buildSandbox({
            elements: { 'sec-email': { value: 'err2@x.com' }, 'sec-name': { value: 'Ana' } },
            sendEmailThrows: 'network down', confirmReturns: false,
        });
        await sandbox.window.saSendInviteEmail();
        ok('10c · error + confirm rechazado -> NO abre mailto', openCalls.length === 0);
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

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
