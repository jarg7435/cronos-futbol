// ─────────────────────────────────────────────────────────────────────────
//  test_clubs_sin_barrido.js  ·  SEC-L04 (Paso 2, 2026-08-31)
//
//  El documento de club lleva `adminEmail` —el correo del administrador— y
//  `createdBySA`. Mientras la regla tenga que dejar LISTAR la coleccion
//  entera a cualquier cuenta, ese correo es cosechable en masa: basta
//  registrarse y hacer un `getDocs(collection(db,'clubs'))`.
//
//  🔑 LA REGLA NO SE PUEDE APRETAR HASTA QUE NADIE NECESITE EL BARRIDO. Por
//  eso este guard va del lado del CLIENTE y es el paso PREVIO al cambio de
//  regla: primero se quitan los barridos que hace gente que no es
//  SuperAdmin, se comprueba en produccion que nada se rompe, y solo despues
//  se cierra el `list`. Al reves, un fallo se descubre en produccion — que
//  es donde viven las reglas, porque `deploy:staging` las publica en una BD
//  que no usa nadie.
//
//  ⚠️ SE DESPOJA DE COMENTARIOS ANTES DE CONTAR. Las propias notas que
//  explican el cambio citan `getDocs(collection(db,'clubs'))` y se contaban
//  como barridos. Es la quinta vez en esta auditoria que un comentario
//  contamina una comprobacion: anclar SIEMPRE en codigo.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sinCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
                       .replace(/^\s*\/\/.*$/gm, '')
                       .replace(/<!--[\s\S]*?-->/g, '');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 400)); }
};

// ⚠️ ALAMBRE TRAMPA. Quien puede barrer la coleccion entera, y cuantas veces.
// Todos son pantallas del SuperAdmin salvo la ultima, que es la limpieza de
// roles huerfanos de auth.js: esa NECESITA la lista completa para saber que
// clubes ya no existen, y degrada sola —su `try/catch` se traga la
// denegacion y se salta la limpieza, igual que ya hace a proposito cuando los
// datos vienen de cache—.
// 🔑 SUBIR UN NUMERO AQUI ES DELIBERADO: significa que alguien ha vuelto a
// descargar todos los clubes, y hay que preguntarse si esa pantalla la ve
// alguien que no sea el SuperAdmin.
const PERMITIDOS = {
    'js/admin/club/panel.js':                 1,   // selector de club del SA
    'js/admin/superadmin/billing.js':         1,
    'js/admin/superadmin/clubs-tab.js':       1,
    'js/admin/superadmin/extras-toggle.js':   1,
    'js/admin/superadmin/extras.js':          1,
    'js/admin/superadmin/individuals-tab.js': 2,
    // ⚠️ Este lo encontro el propio guard, no el inventario a mano: usa
    // `fsh.getDocs(fsh.collection(...))` y el grep inicial —que solo buscaba
    // `getDocs(collection(`— lo dejo fuera. Justo para eso esta el censo.
    'js/admin/superadmin/diagnostico.js':     1,
    'js/coach/reports/club-reports.js':       1,   // con puerta de rol superadmin/admin
    'js/services/auth/role-launch.js':        1,   // _saPickTestClub, solo SA
    'js/services/auth.js':                    1,   // limpieza de roles huerfanos
    'live.html':                              1,   // filtro de club, solo SA
};

// Todo fichero de cliente que pueda contener un barrido.
function ficheros(dir, acc) {
    acc = acc || [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = dir + '/' + e.name;
        if (e.isDirectory()) ficheros(rel, acc);
        else if (/\.(js|html)$/.test(e.name)) acc.push(rel);
    }
    return acc;
}

// ⚠️ LAS TRES COMILLAS. El red-check anyadio un barrido con comillas DOBLES y
// el guard no se inmuto: la regex solo miraba las simples. Un guard que no ve
// la mitad de las formas de escribir lo mismo da un verde que no vale nada.
// El prefijo opcional (`fsh.`) es el que hizo falta para ver diagnostico.js.
const RE_BARRIDO = /getDocs\(\s*(?:[A-Za-z_$][\w$]*\.)?collection\(\s*[A-Za-z_$][\w$.]*\s*,\s*['"`]clubs['"`]\s*\)\s*\)/g;

console.log('\n══ SEC-L04 · nadie barre `clubs` salvo quien debe ══');

console.log('\n1) 🔑 El censo de barridos');
{
    const todos = ficheros('js').concat(['live.html', 'index.html']);
    const censo = {};
    todos.forEach(f => {
        const n = (sinCom(leer(f)).match(RE_BARRIDO) || []).length;
        if (n) censo[f.replace(/\\/g, '/')] = n;
    });

    const sobran = Object.keys(censo).filter(f => !PERMITIDOS[f] || censo[f] > PERMITIDOS[f])
                         .map(f => f + ' (' + censo[f] + ', permitidos ' + (PERMITIDOS[f] || 0) + ')');
    const faltan = Object.keys(PERMITIDOS).filter(f => !censo[f]);

    ok('1a · 🔑🔑 ningun barrido NUEVO fuera del censo',
       sobran.length === 0, 'de mas: ' + sobran.join(' · '));

    // Si uno desaparece tambien hay que enterarse: puede ser una mejora que
    // merece bajar el numero, o un fichero renombrado que deja el censo mintiendo.
    ok('1b · …y ninguno del censo ha desaparecido sin actualizarlo',
       faltan.length === 0, 'ya no estan: ' + faltan.join(' · '));
}

console.log('\n2) 🔒 Los dos rastreos de «lo mio» van FILTRADOS');
{
    const PANEL = sinCom(leer('js/admin/club/panel.js'));
    const AUTH  = sinCom(leer('js/services/auth.js'));

    // panel.js · el club propio, por los TRES campos del `find` original.
    // ⚠️ DOS CAMPOS, NO LOS CUATRO DEL `find` ORIGINAL, y el recorte esta
    // MEDIDO sobre los 5 documentos de produccion (2026-08-31): `createdBy` no
    // existe en ninguno y `email` no lleva correo utilizable en ninguno.
    // 🚨 No es cosmetico: dejarlos en la REGLA habria averiado el `list`, ya
    // que en una consulta la condicion se evalua contra CADA documento y el
    // `||` solo cortocircuita en verdadero. Ver SEC-L04 en firestore.rules.
    ok('2a · club/panel.js pregunta por adminEmail y adminUid (los que existen)',
       /'adminEmail'/.test(PANEL) && /'adminUid'/.test(PANEL) &&
       /where\(campo, '==', valor\)/.test(PANEL),
       'perder uno deja al club_admin sin encontrar su club, y sin error');

    ok('2a2 · ⚠️ y NO por createdBy, que no existe en ningun documento',
       !/'createdBy'/.test(PANEL),
       'la consulta no devolveria nada y en la regla averiaria el list');

    // auth.js · la entidad individual, por el campo que SI esta en los 5.
    ok('2b · 🔑 auth.js pregunta por adminEmail con `where`',
       /where\('adminEmail', '==', user\.email\)/.test(AUTH),
       'es el unico de los dos campos originales que lleva un correo real');

    ok('2c · ⚠️ y sigue exigiendo type === \'individual\'',
       /c\.type === 'individual'/.test(AUTH),
       'la consulta no lo puede filtrar sin un indice compuesto que no existe');
}

console.log('\n3) 🗑️ La heuristica que adivinaba, fuera');
{
    const PANEL = sinCom(leer('js/admin/club/panel.js'));
    ok('3a · ya no existe el «si solo hay un club, asumir que es el suyo»',
       !/clubs\.length === 1/.test(PANEL),
       'asignaba al club_admin un club que podia no ser suyo, y lo PERSISTIA con updateDoc');
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
