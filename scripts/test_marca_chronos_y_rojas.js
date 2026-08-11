// ─────────────────────────────────────────────────────────────────────────
// test_marca_chronos_y_rojas.js  ·  v476
//
// DOS correcciones que el autor pidio tras las capturas 8565/8566/8567:
//
//  A · LA MARCA SE ESCRIBE **CHRONOS**, con hache. Habia 93 sitios con
//      "CRONOS"/"Cronos" — cabeceras de informes, el pie de los mensajes de
//      padres, los correos y WhatsApp de facturacion, el aviso de
//      actualizacion, la pagina de prueba de sonido…— mientras index.html ya
//      usaba "Chronos" en todas partes. La app se leia con las dos grafias.
//
//      🔑 LO DELICADO ES QUE **NO** HAY QUE TOCAR: el nombre suelto es marca,
//      pero pegado a `_`, `-` o `.` es CODIGO, y cambiarlo rompe cosas que no
//      dan error hasta que fallan:
//        · colecciones de Firestore  (cronos_messages, cronos_player_reports…)
//        · claves de localStorage    (cronos_active_match_v2, cronos_teams…)
//          ⚠️ renombrar una de estas PIERDE los datos ya guardados del usuario
//        · variables globales        (window._cronosCurrentUser, _CRONOS_DEBUG)
//        · proyectos y dominios      (cronos-futbol-app, cronos.app)
//      Por eso la sustitucion se hizo con limites que excluyen [A-Za-z0-9_-.]
//      y por eso este guard vigila las DOS direcciones: que no vuelva la
//      errata Y que los identificadores sigan intactos.
//
//  B · LA COLUMNA "ROJAS" PINTABA UN CUADRADO VERDE (captura 8567). Los
//      cuadrados grandes van SEGUIDOS en Unicode y es facilisimo coger el de
//      al lado: &#128997; 🟥 rojo · &#128998; azul · &#128999; naranja ·
//      &#129000; 🟨 amarillo · &#129001; 🟩 VERDE. Estaba puesto el 129001.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── la marca es CHRONOS · y las rojas son ROJAS (v476) ──\n');

// ── Ficheros que se sirven al usuario ───────────────────────────────────
function servidos() {
    const out = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules') continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (/\.(js|html|css)$/.test(e.name)) out.push(full);
        }
    };
    walk(path.join(ROOT, 'js'));
    ['index.html', 'live.html', 'privacy.html', 'sound-test.html', 'offline.html', 'sw.js', 'app.js', 'style.css']
        .forEach(f => { const p = path.join(ROOT, f); if (fs.existsSync(p)) out.push(p); });
    return out;
}
const FICHEROS = servidos();
ok('0 · se localizan los ficheros servidos', FICHEROS.length > 50, FICHEROS.length);

// ── A1 · no queda la marca sin hache ────────────────────────────────────
// La palabra SUELTA: pegada a _ - . es un identificador y no cuenta.
//
// ⚠️ SE SALTAN LAS LINEAS DE COMENTARIO PURO, y no por comodidad: la primera
// version de este guard se puso ROJA con el arreglo YA HECHO porque la
// entrada del changelog de sw.js **cita** la errata para explicarla
// ("93 sitios decian CRONOS/Cronos"). Documentar un defecto exige nombrarlo.
// Lo que se vigila es lo que se EJECUTA y se RENDERIZA; una linea con codigo
// y un comentario al final SI se analiza entera, que es el lado conservador.
const RE_MARCA = /(?<![A-Za-z0-9_\-.])(CRONOS|Cronos)(?![A-Za-z0-9_\-.])/g;
const ES_COMENTARIO = (l) => /^\s*(\/\/|\*|\/\*|<!--)/.test(l);
const erratas = [];
for (const f of FICHEROS) {
    const txt = fs.readFileSync(f, 'utf8');
    txt.split(/\r?\n/).forEach((linea, i) => {
        if (ES_COMENTARIO(linea)) return;
        RE_MARCA.lastIndex = 0;
        if (RE_MARCA.test(linea)) erratas.push(path.relative(ROOT, f) + ':' + (i + 1) + '  ' + linea.trim().slice(0, 110));
    });
}
ok('A1 · 🐛 no queda ni un "CRONOS"/"Cronos" sin hache en lo que se sirve',
   erratas.length === 0, erratas.slice(0, 12).join('\n       ') + (erratas.length > 12 ? '\n       …y ' + (erratas.length - 12) + ' mas' : ''));

// ── A2 · y la marca CON hache sigue estando donde se ve ─────────────────
const conMarca = [
    ['js/coach/reports/report-engine.js', 'CHRONOS FÚTBOL', 'cabecera del informe de partido'],
    ['js/coach/reports/events-tab.js',    'CHRONOS FÚTBOL', 'cabecera de la convocatoria'],
    ['js/parent/panel.js',                'CHRONOS FÚTBOL', 'panel de padres'],
    ['index.html',                        'CHRONOS FÚTBOL', 'index'],
];
conMarca.forEach(([rel, txt, donde]) => {
    const c = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    ok('A2 · ' + donde + ' dice CHRONOS', c.includes(txt), rel);
});
{
    const pp = fs.readFileSync(path.join(ROOT, 'js', 'parent', 'panel.js'), 'utf8');
    ok('A2b · el pie de los mensajes a padres dice Chronos', /_Enviado desde Chronos Fútbol_/.test(pp));
}

// ── A3 · ⚠️ LO QUE NO SE PODIA TOCAR sigue intacto ──────────────────────
// Si el barrido hubiera pillado un identificador, esto se pone rojo. Las
// claves de localStorage son las mas graves: renombrarlas pierde datos.
const INTACTOS = [
    ['cronos_messages',          'coleccion de Firestore'],
    ['cronos_player_reports',    'coleccion de Firestore'],
    ['cronos_player_links',      'coleccion de Firestore'],
    ['cronos_notifications',     'coleccion de Firestore'],
    ['cronos_config',            'coleccion de Firestore'],
    ['cronos_active_match_v2',   '⚠️ clave de localStorage (renombrarla PIERDE el partido guardado)'],
    ['cronos_master_roster',     '⚠️ clave de localStorage'],
    ['cronos_teams',             '⚠️ clave de localStorage'],
    ['window._cronosCurrentUser', 'global de la sesion'],
    ['_CRONOS_DEBUG',            'bandera global'],
    ['cronos-futbol-app',        'projectId de Firebase'],
    ['cronos-cache-',            'nombre de la cache del service worker'],
];
const TODO = FICHEROS.map(f => fs.readFileSync(f, 'utf8')).join('\n');
INTACTOS.forEach(([token, que]) => {
    ok('A3 · sigue intacto `' + token + '` (' + que + ')', TODO.includes(token));
});
// Y el reverso: que el barrido no haya inventado "chronos_" en identificadores.
ok('A3b · ⚠️ no se ha colado ningun identificador "chronos_" nuevo',
   !/chronos_[a-z]/.test(TODO), (TODO.match(/chronos_[a-z]+/) || [''])[0]);
ok('A3c · ni un "chronos-futbol-app" (romperia la conexion con Firebase)',
   !TODO.includes('chronos-futbol-app'));

// ── B · el cuadrado de la columna ROJAS ─────────────────────────────────
const CT = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'shared', 'category-tree.js'), 'utf8');
const cab = CT.slice(CT.indexOf('Resumen acumulado de la temporada'), CT.indexOf('</tr></thead>'));
ok('B0 · se localiza la cabecera de la tabla de resumen acumulado', cab.length > 0);
ok('B1 · 🐛 la columna ROJAS ya NO lleva el cuadrado verde (129001)',
   !/&#129001;[^<]*Rojas/.test(cab), (cab.match(/&#\d+;\s*Rojas/) || ['(no encontrado)'])[0]);
ok('B2 · lleva el ROJO (128997 = U+1F7E5 🟥)',
   /&#128997;\s*Rojas/.test(cab), (cab.match(/&#\d+;\s*Rojas/) || ['(no encontrado)'])[0]);
ok('B3 · y las amarillas siguen con el AMARILLO (129000 = U+1F7E8 🟨)',
   /&#129000;\s*Amarillas/.test(cab), (cab.match(/&#\d+;\s*Amarillas/) || ['(no encontrado)'])[0]);
ok('B4 · los dos cuadrados son distintos', !/&#(\d+);\s*Amarillas[\s\S]*&#\1;\s*Rojas/.test(cab));

// El verde sigue siendo legitimo donde SI significa "entra" (textos legacy de
// sustituciones que el visor todavia parsea): no se ha barrido a lo bruto.
const LIVE = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
ok('B5 · el 🟩 legacy de "ENTRA" del visor sigue reconociendose',
   /🟩/.test(LIVE), 'se ha perdido el glifo legacy que parsea las sustituciones antiguas');

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);
