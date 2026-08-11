// ════════════════════════════════════════════════════════════════════
// El registro no puede quedarse bloqueado SIN DECIR POR QUÉ.
// ════════════════════════════════════════════════════════════════════
// FALLO REPORTADO (captura 8605): al pulsar el botón de registro con un correo
// nuevo y su categoría/subcategoría, el formulario no avanza y NO HAY NINGÚN
// ERROR EN LA CONSOLA.
//
// "Sin errores en consola" es la pista: descarta una excepción y apunta a algo
// que no llega ni a ejecutarse, o que espera para siempre. Se cierran los tres
// caminos que pueden dejar el formulario mudo:
//
//  1. 🔑 EL BOTÓN `disabled`. En registro se ponía disabled hasta marcar la
//     casilla RGPD. Un botón disabled no dispara submit, no ejecuta nada y no
//     escribe nada. Y era REDUNDANTE: doAuth() ya comprueba el consentimiento
//     y lo explica. Había dos guardianes para lo mismo y el mudo se adelantaba.
//
//  2. 🔑 EL MODO DESINCRONIZADO. Las pestañas llaman a switchTab() desde un
//     onclick con guarda `typeof`. Si se pulsa "Registro" antes de que el
//     módulo evalúe, la guarda falla EN SILENCIO: se ven los campos de
//     registro pero el estado interno sigue en login, y el envío se va a
//     iniciar sesión con un correo que no existe.
//
//  3. 🔑 LA CREACIÓN DE CUENTA SIN TOPE. El login corría contra 6 s; el alta
//     no tenía ninguno, así que un tropiezo de red la dejaba esperando para
//     siempre en "⏳ Conectando…".
//
// El punto 1 se comprueba EJECUTANDO la función real.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'js', 'services', 'auth.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let fallos = 0;
const ok = (n, c, extra) => {
    if (c) console.log('  verde ' + n);
    else { fallos++; console.log('  ROJO  ' + n);
           if (extra !== undefined) console.log('        ' + JSON.stringify(extra)); }
};

// ── Ejecutar syncAuthBtnConsent tal cual sale del fichero ───────────
function extraerSync() {
    const ini = AUTH.indexOf('function syncAuthBtnConsent()');
    if (ini === -1) throw new Error('No se encuentra syncAuthBtnConsent en auth.js');
    let d = 0, i = AUTH.indexOf('{', ini);
    for (; i < AUTH.length; i++) {
        if (AUTH[i] === '{') d++;
        else if (AUTH[i] === '}') { d--; if (d === 0) { i++; break; } }
    }
    return AUTH.slice(ini, i);
}
const SYNC = extraerSync();

function correrSync({ modoLogin, consentimiento }) {
    const btn = { disabled: 'sin tocar', style: {}, title: '' };
    const chk = { checked: consentimiento };
    const sandbox = {
        _isLoginMode: modoLogin,
        document: { getElementById: (id) =>
            id === 'auth-btn' ? btn : (id === 'gdpr-consent' ? chk : null) },
        console: { log: () => {}, warn: () => {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(SYNC + '\n; syncAuthBtnConsent();', sandbox);
    return btn;
}

console.log('\n=== 1. El botón NUNCA queda deshabilitado ===');
{
    // Éste es el caso del fallo: modo registro, casilla sin marcar.
    const b = correrSync({ modoLogin: false, consentimiento: false });
    ok('registro SIN consentimiento: el botón sigue pulsable', b.disabled === false, b);
    ok('y da una pista de por qué no avanzará', /Pol[ií]tica de Privacidad/.test(b.title || ''), b.title);
}
{
    const b = correrSync({ modoLogin: false, consentimiento: true });
    ok('registro CON consentimiento: pulsable', b.disabled === false, b);
}
{
    const b = correrSync({ modoLogin: true, consentimiento: false });
    ok('login: pulsable', b.disabled === false, b);
}

console.log('\n=== 2. El consentimiento SIGUE siendo obligatorio (no se relaja el RGPD) ===');
ok('doAuth comprueba la casilla',
    /getElementById\('gdpr-consent'\)/.test(AUTH)
    && /!gdprConsent\.checked/.test(AUTH));
ok('y lo explica al usuario',
    /Debes aceptar la Pol[ií]tica de Privacidad para registrarte/.test(AUTH));

console.log('\n=== 3. El modo se reconcilia con el formulario visible ===');
ok('doAuth mira role-container', /_seVeRegistro/.test(AUTH));
ok('solo acepta el literal block que escribe la pestaña',
    /_roleCont\.style\.display === 'block'/.test(AUTH));
ok('NO acepta la cadena vacía (rompería el login)',
    !/_roleCont\.style\.display === ''/.test(AUTH));
ok('role-container nace oculto en el HTML',
    /id="role-container" style="display:none/.test(HTML));

console.log('\n=== 4. El alta de cuenta tiene tope de tiempo, como el login ===');
ok('hay un timeout para createUserWithEmailAndPassword', /_altaTimeout/.test(AUTH));
ok('se usa con Promise.race sobre la creación',
    /Promise\.race\(\[[\s\S]{0,140}createUserWithEmailAndPassword[\s\S]{0,80}_altaTimeout/.test(AUTH));
ok('el aviso temporal se limpia siempre (finally)',
    /finally \{[\s\S]{0,220}clearTimeout\(_altaTimer\)/.test(AUTH));
ok('el mensaje de agotado es comprensible',
    /El registro tard[óo] demasiado/.test(AUTH));

console.log('\n=== 5. Red de seguridad al enlazar el formulario ===');
{
    // Se extrae el CUERPO de la función en vez de medir distancias en el
    // texto: una ventana de N caracteres se rompe en cuanto alguien añade un
    // comentario, y entonces el guard se pone rojo sin que nada esté mal.
    const ini = AUTH.indexOf('function _cronosEnlazaFormularioAuth()');
    let cuerpo = '';
    if (ini !== -1) {
        let d = 0, i = AUTH.indexOf('{', ini);
        for (; i < AUTH.length; i++) {
            if (AUTH[i] === '{') d++;
            else if (AUTH[i] === '}') { d--; if (d === 0) { i++; break; } }
        }
        cuerpo = AUTH.slice(ini, i);
    }
    ok('existe la función de enlace', cuerpo.length > 0);
    ok('al enlazar se fuerza el botón a habilitado',
        /authBtn\.disabled = false/.test(cuerpo));
    ok('y se cablea la casilla de consentimiento también aquí',
        /_gdprWired/.test(cuerpo));
}

console.log('\n' + (fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)'));
process.exit(fallos === 0 ? 0 : 1);
