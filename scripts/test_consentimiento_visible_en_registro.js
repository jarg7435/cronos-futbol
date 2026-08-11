// ════════════════════════════════════════════════════════════════════
// El bloque de consentimiento RGPD, IDÉNTICO AL DE PRODUCCIÓN.
// ════════════════════════════════════════════════════════════════════
// ⚠️⚠️⚠️ ESTE GUARD NO DEFIENDE UNA IDEA MÍA. Defiende que el código de aquí
//    siga siendo el MISMO que sirve cronos-futbol-app, donde el registro
//    funciona y la casilla se ve al final del formulario, encima del botón.
//
// HISTORIAL, QUE ES EL MOTIVO DE QUE ESTE FICHERO EXISTA ASÍ:
//    Entre v485 y v490 este bloque se "arregló" SEIS veces persiguiendo una
//    hipótesis equivocada —que algún script lo ocultaba, o que el formulario
//    lo empujaba fuera de la pantalla—. Se probó:
//      · hacerlo nacer visible (v485)
//      · gobernarlo con una clase del <body> y una hoja con !important (v486)
//      · meterlo en una banda `position:sticky` (v487)
//      · quitar toda excepción para que se viera también en "Entrar" (v488)
//      · subirlo al principio del formulario (v489)
//      · meterlo dentro de #role-container (v490)
//    Ninguna hacía falta. Producción llevaba todo ese tiempo funcionando con
//    cuatro líneas en switchTab() y dos onclick. Lo que estaba roto era la
//    versión de testeo, no el mecanismo.
//
// 🔑 LA LECCIÓN, Y LA REGLA QUE IMPONE ESTE GUARD: cuando existe una versión
//    que FUNCIONA, se compara contra ella ANTES de teorizar. Una descarga de
//    producción y un diff habrían cerrado esto en la primera ronda.
//
// Por eso las cadenas de referencia están copiadas literalmente de lo que
// sirve producción. Si alguna vez hay que cambiarlas, primero se cambia en
// producción y se comprueba allí.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const AUTH = fs.readFileSync(path.join(ROOT, 'js', 'services', 'auth.js'), 'utf8');

// ⚠️ SE BORRAN LOS COMENTARIOS ANTES DE MIRAR NADA. Sin esto el barrido se
//    mide a sí mismo: los avisos que explican este fallo nombran
//    `gdpr-consent-container`, `switchTab(` y `auth-modo-login`, así que
//    satisfacían las búsquedas y el guard daba verde con el defecto puesto.
//    Ya pasó dos veces, una de ellas en este mismo fichero.
const sinComentarios = (s) => s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');

const HTML_COD = sinComentarios(HTML);
const AUTH_COD = sinComentarios(AUTH);

let fallos = 0;
const ok = (n, c, extra) => {
    if (c) console.log('  verde ' + n);
    else { fallos++; console.log('  ROJO  ' + n);
           if (extra !== undefined) console.log('        ' + String(extra).slice(0, 300)); }
};

console.log('\n=== 1. El marcado, tal cual lo sirve producción ===');
{
    // Nace OCULTO y lo muestran las pestañas. Es lo que hace producción, y
    // funciona. No "nace visible": eso fue v485 y trajo el parpadeo.
    const div = (HTML_COD.match(/<div id="gdpr-consent-container"[^>]*>/) || [''])[0];
    ok('existe el contenedor', div.length > 0);
    ok('nace con display:none (como producción)',
        /style="display:none; margin-bottom:1\.2rem;"/.test(div), div);
    ok('existe la casilla dentro', /id="gdpr-consent"/.test(HTML_COD) &&
        HTML_COD.indexOf('id="gdpr-consent"') > HTML_COD.indexOf('id="gdpr-consent-container"'));
    ok('el enlace a la política está dentro de la etiqueta',
        /<a href="privacy\.html"[^>]*>Política de Privacidad<\/a>/.test(HTML_COD));
    ok('hay UNA sola casilla en todo el documento',
        (HTML_COD.match(/id="gdpr-consent-container"/g) || []).length === 1);
}

console.log('\n=== 2. Su sitio: al final del formulario, justo encima del botón ===');
{
    const iGdpr = HTML_COD.indexOf('id="gdpr-consent-container"');
    const iBtn  = HTML_COD.indexOf('id="auth-btn"');
    const iForm = HTML_COD.indexOf('<form id="auth-form"');
    const iRol  = HTML_COD.indexOf('<div id="role-container"');
    ok('está dentro del formulario', iForm !== -1 && iForm < iGdpr);
    // ⚠️ NO BASTA CON `iGdpr < iBtn`: con la casilla al principio del
    //    formulario (v489) eso también se cumplía y el guard daba VERDE con el
    //    defecto puesto. Lo cazó el red-check. Tiene que ir JUSTO antes: entre
    //    su cierre y el botón no puede quedar ningún otro campo.
    ok('precede al botón', iGdpr !== -1 && iBtn !== -1 && iGdpr < iBtn);
    {
        const re = /<(\/?)div\b[^>]*>/g;
        re.lastIndex = iGdpr;
        let m, prof = 0, iCierre = -1;
        while ((m = re.exec(HTML_COD)) !== null) {
            prof += m[1] === '/' ? -1 : 1;
            if (prof === 0) { iCierre = m.index + m[0].length; break; }
        }
        const entre = iCierre === -1 ? '' : HTML_COD.slice(iCierre, iBtn);
        ok('y NADA se interpone entre la casilla y el botón',
            iCierre !== -1 && !/<(div|input|select|textarea|label)\b/.test(entre),
            entre.replace(/\s+/g, ' ').slice(0, 200));
    }
    // Y NO metida dentro de otro contenedor con vida propia: eso fue v490 y
    // dejó la casilla a merced del display de su padre.
    ok('NO está dentro de #role-container', iRol !== -1 && iGdpr > iRol
        ? !dentroDe(HTML_COD, iRol, iGdpr) : true);
    ok('es hermana del botón, no de otro bloque',
        !/<div id="[a-z-]*container"[^>]*>\s*<div id="gdpr-consent-container"/.test(HTML_COD));
}

function dentroDe(cod, iAbre, iObjetivo) {
    const re = /<(\/?)div\b[^>]*>/g;
    re.lastIndex = iAbre;
    let m, prof = 0;
    while ((m = re.exec(cod)) !== null) {
        prof += m[1] === '/' ? -1 : 1;
        if (prof === 0) return iObjetivo < m.index;
    }
    return false;
}

console.log('\n=== 3. Quién lo muestra: los onclick de las pestañas ===');
{
    // Cadenas literales de producción. Funcionan aunque el módulo no haya
    // cargado, que es justo lo que hace falta en una pantalla de acceso.
    const btnR = (HTML_COD.match(/<button id="tab-register" onclick="[^"]*"/) || [''])[0];
    const btnL = (HTML_COD.match(/<button id="tab-login" onclick="[^"]*"/) || [''])[0];
    ok('REGISTRARSE muestra el consentimiento',
        /gdpr-consent-container'\);\s*if\(g\)g\.style\.setProperty\('display','block','important'\)/.test(btnR), btnR);
    ok('REGISTRARSE oculta el pie',
        /privacy-link-footer'\);\s*if\(pf\)pf\.style\.setProperty\('display','none','important'\)/.test(btnR), btnR);
    ok('REGISTRARSE muestra el selector de rol',
        /role-container'\)\.style\.display='block'/.test(btnR), btnR);
    ok('ENTRAR oculta el consentimiento',
        /gdpr-consent-container'\);\s*if\(g\)g\.style\.setProperty\('display','none','important'\)/.test(btnL), btnL);
    ok('ENTRAR devuelve el pie',
        /privacy-link-footer'\);\s*if\(pf\)pf\.style\.setProperty\('display','block','important'\)/.test(btnL), btnL);
    ok('ambos llaman a switchTab si existe',
        /typeof switchTab==='function'\)switchTab\('register'\)/.test(btnR) &&
        /typeof switchTab==='function'\)switchTab\('login'\)/.test(btnL));
}

console.log('\n=== 4. switchTab(): las cuatro líneas de producción ===');
{
    ok('muestra/oculta el consentimiento según el modo',
        /const gdprCont = document\.getElementById\('gdpr-consent-container'\);\s*\n\s*if \(gdprCont\) gdprCont\.style\.setProperty\('display', _isLoginMode \? 'none' : 'block', 'important'\);/.test(AUTH_COD));
    ok('resetea la casilla al volver a login',
        /if \(gdprChk && _isLoginMode\) gdprChk\.checked = false;/.test(AUTH_COD));
    ok('el pie hace lo contrario',
        /if \(privacyFooter\) privacyFooter\.style\.setProperty\('display', _isLoginMode \? 'block' : 'none', 'important'\);/.test(AUTH_COD));
    ok('_isLoginMode se fija en la PRIMERA línea de switchTab',
        /function switchTab\(tab\) \{\s*\n\s*_isLoginMode = \(tab === 'login'\);/.test(AUTH_COD));
}

console.log('\n=== 5. NADA muta este bloque al cargar la página ===');
{
    // 🔑 EL APARTADO CLAVE. Producción no toca el formulario al cargar: el
    //    aspecto inicial lo da entero el marcado y solo lo cambian los clics.
    //    La llamada a switchTab('login') desde el arranque del módulo —que
    //    llega ~1 s tarde— es lo que hacía aparecer y desaparecer la casilla.
    const i = AUTH_COD.indexOf('function _cronosEnlazaFormularioAuth');
    const cuerpo = i === -1 ? '' : AUTH_COD.slice(i, AUTH_COD.indexOf('\n}', i));
    ok('se localiza el arranque', cuerpo.length > 0);
    ok('el arranque NO llama a switchTab()', !/switchTab\(/.test(cuerpo), cuerpo.slice(-300));
    ok('el arranque NO toca el consentimiento',
        !/gdpr-consent-container/.test(cuerpo), cuerpo.slice(-300));
    // Sigue haciendo lo suyo, que sí hace falta (captura 8594).
    ok('pero sigue enganchando el submit', /addEventListener\('submit'/.test(cuerpo));
    ok('y sigue dejando el botón utilizable', /authBtn\.disabled = false/.test(cuerpo));

    // ⚠️⚠️ LAS CINCO CAPAS QUE SE APILARON ENTRE v477 Y v500, CADA UNA TAPANDO
    //    A LA ANTERIOR, PERSIGUIENDO UN FALLO QUE PRODUCCIÓN NO TIENE. Ninguna
    //    hizo falta. Si alguna vuelve, este apartado se pone rojo.
    for (const [nombre, re] of [
        ['la clase auth-modo-login del <body>',       /auth-modo-login/],
        ['el vigía MutationObserver',                 /_cronosVigila|_cronosGdprRescates/],
        ['la banda sticky #auth-actions',             /auth-actions/],
        ['las clases mode-login / mode-register',     /mode-login|mode-register/],
        ['el autodiagnóstico temporal',               /_cronosDiagRGPD|diag-rgpd/],
    ]) {
        ok('no queda ' + nombre, !re.test(HTML_COD) && !re.test(AUTH_COD));
    }
    // 🔑 Y LA REGLA DE FONDO: dentro del bloque de acceso no puede haber
    //    scripts inline propios. Producción no tiene ninguno, y cada uno de
    //    los que hubo aquí fue una capa más de las de arriba.
    {
        // ⚠️ El cierre se ancla en un ELEMENTO, no en un rótulo de comentario:
        //    este guard borra los comentarios antes de mirar y el ancla no
        //    existía (falso rojo). Tercera vez que caigo en esto.
        const i = HTML_COD.indexOf('<div id="auth-screen"');
        const j = HTML_COD.indexOf('<div id="role-selection-screen"');
        const bloque = (i === -1 || j === -1) ? '' : HTML_COD.slice(i, j);
        ok('se acota el bloque de acceso', bloque.length > 0);
        ok('sin scripts inline dentro del bloque',
            !/<script/.test(bloque), (bloque.match(/<script[\s\S]{0,80}/) || [''])[0]);
    }
    // Ninguna hoja de estilos puede decidir sobre este bloque: en producción
    // no hay ninguna, y una regla !important aquí volvería a crear dos mandos.
    const css = path.join(ROOT, 'style.css');
    const CSS = fs.existsSync(css) ? sinComentarios(fs.readFileSync(css, 'utf8')) : '';
    ok('ninguna hoja toca #gdpr-consent-container',
        !/#gdpr-consent-container\s*\{/.test(HTML_COD) && !/#gdpr-consent-container\s*\{/.test(CSS));
}

console.log('\n=== 6. La ruta del enlace de invitación (lo ÚNICO añadido) ===');
{
    // Esto sí es un arreglo real sobre producción: el respaldo de
    // `?register=true` montaba la vista de registro a mano y se dejaba la
    // casilla, dejando SIN casilla a quien llega invitado (capturas
    // 8615/8616). Se arregla con el MISMO mecanismo, no con uno nuevo.
    const i = HTML_COD.indexOf("registerParam === 'true'");
    const bloque = i === -1 ? '' : HTML_COD.slice(i, i + 2600);
    ok('se localiza el bloque de invitación', bloque.length > 0);
    ok('PRIMERO espera a switchTab (que ya lo hace todo)',
        /typeof switchTab === 'function'[\s\S]{0,120}switchTab\('register'\)/.test(bloque), bloque.slice(0, 200));
    ok('reintenta en vez de sustituirlo a la primera', /_intentosReg/.test(bloque));
    ok('el respaldo manual muestra el consentimiento',
        /gdprCont\.style\.setProperty\('display', 'block', 'important'\)/.test(bloque), bloque.slice(-400));
    ok('el respaldo manual oculta el pie',
        /privacyFooter\.style\.setProperty\('display', 'none', 'important'\)/.test(bloque), bloque.slice(-400));
}

console.log('\n=== 7. Red de seguridad: no se exige algo invisible ===');
{
    const i = AUTH_COD.indexOf("const gdprConsent = document.getElementById('gdpr-consent')");
    const bloque = i === -1 ? '' : AUTH_COD.slice(i, i + 1200);
    ok('se localiza la comprobación en doAuth', bloque.length > 0);
    ok('al fallar, muestra la casilla con el mecanismo de producción',
        /setProperty\('display', 'block', 'important'\)/.test(bloque), bloque.slice(0, 240));
    ok('y la lleva a la vista', /scrollIntoView/.test(bloque));
    ok('el consentimiento SIGUE siendo obligatorio', /return;/.test(bloque));
}

console.log('\n=== 7b. El CONTENEDOR también es el de producción ===');
{
    // 🔑🔑🔑 LA ÚLTIMA DIFERENCIA REAL, y la que costó siete rondas: el bloque
    //    de consentimiento estaba bien; lo que había cambiado en v477 era el
    //    contenedor que lo enmarca (`position:fixed` inset 0 + z-index + padding
    //    con safe-area, y a la tarjeta se le quitó `margin:auto 0`). Producción
    //    no tiene nada de eso. Se culpó al contenido en vez de al marco.
    //
    // El detalle vive en test_auth_screen_scroll.js; aquí se fija lo mínimo
    // para que este guard no dé por buena una pantalla que ya no es la de
    // producción mientras el bloque sí lo sea.
    const cont = (HTML_COD.match(/<div id="auth-screen"[^>]*>/) || [''])[0];
    ok('se localiza #auth-screen', cont.length > 0);
    ok('NO es position:fixed (producción lo tiene en flujo normal)',
        !/position\s*:\s*fixed/.test(cont), cont);
    ok('NO declara z-index', !/z-index/.test(cont), cont);
    ok('NO usa env(safe-area-*)', !/env\(safe-area/.test(cont), cont);
    ok('conserva min-height/max-height:100dvh + overflow-y:auto',
        /min-height\s*:\s*100dvh/.test(cont) && /max-height\s*:\s*100dvh/.test(cont) &&
        /overflow-y\s*:\s*auto/.test(cont), cont);
    const tarjeta = (HTML_COD.slice(HTML_COD.indexOf(cont) + cont.length)
                        .match(/<div style="width:100%; max-width:380px;[\s\S]*?>/) || [''])[0];
    ok('la tarjeta conserva margin:auto 0', /margin\s*:\s*auto\s+0/.test(tarjeta), tarjeta);
}

console.log('\n=== 8. El sello de versión visible en la pantalla de acceso ===');
{
    // Se queda: es lo que permitió por fin saber qué código se estaba
    // probando. No toca el bloque de consentimiento.
    const sello = (HTML_COD.match(/<span id="build-version" data-version="(v\d+)">(v\d+)<\/span>/) || []);
    ok('existe el sello', sello.length > 0, (HTML_COD.match(/<span id="build-version"[^<]*<\/span>/) || [''])[0]);
    // ⚠️ Y TIENE QUE ESTAR EN LA PANTALLA DE ACCESO. Al sincronizar el panel
    //    desde producción, un replace() sobre la PRIMERA aparición de "Coach
    //    Assistant · v7.0" lo dejó en la pantalla de bienvenida: el sello
    //    existía, el guard daba verde, y bajo el logo del acceso no se veía
    //    nada. Sólo se detectó comparando el panel servido contra producción.
    {
        const i = HTML_COD.indexOf('<div id="auth-screen"');
        const j = HTML_COD.indexOf('<div id="role-selection-screen"');
        const panel = (i === -1 || j === -1) ? '' : HTML_COD.slice(i, j);
        ok('el sello está DENTRO del panel de acceso', /id="build-version"/.test(panel),
            (panel.match(/Coach Assistant[^\n]{0,80}/) || [''])[0]);
        ok('y sólo hay uno en todo el documento',
            (HTML_COD.match(/id="build-version"/g) || []).length === 1);
    }
    ok('el atributo y el texto dicen lo mismo', sello[1] === sello[2], sello.slice(1).join(' vs '));
    const CB = fs.readFileSync(path.join(ROOT, 'scripts', 'cache-bust.js'), 'utf8');
    ok('cache-bust.js lo mantiene sincronizado', /build-version/.test(CB));
    const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const ver = (SW.match(/const\s+CACHE_NAME\s*=\s*'cronos-cache-(v\d+)'/) || [])[1];
    ok('coincide con el CACHE_NAME de sw.js', ver === sello[1], ver + ' vs ' + sello[1]);
}

console.log('\n' + (fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)'));
process.exit(fallos === 0 ? 0 : 1);
