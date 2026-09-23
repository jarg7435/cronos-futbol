// ════════════════════════════════════════════════════════════════════
//  GUARD · EL INFORME GRUPAL FIRMA CON EL NOMBRE, NO CON EL CORREO · v755
// ════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-23, capturas 10755-10756): en
//  el Informe Grupal —PDF y vista previa del Panel de Dirección— la esquina
//  superior derecha y la ficha del partido decían «arinagazone@gmail.com».
//  v753b ya lo había resuelto para la convocatoria y la planificación, pero
//  con una función privada de events-tab.js que el informe no usaba.
//
//  🔑 Este guard mide el VALOR que se resuelve (sandbox con el código real
//  de club-chat.js), y además que ninguno de los cuatro sitios que pintan
//  la autoría del grupal vuelva a leer `coachEmail` a pelo.
// ════════════════════════════════════════════════════════════════════
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sinCom = (s) => s.split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');

let FALLOS = 0;
function ok(t, c, extra) {
    console.log((c ? 'PASS ' : 'FAIL ') + t + (c || extra === undefined ? '' : '   → ' + JSON.stringify(extra)));
    if (!c) FALLOS++;
}
function parte(nombre, fn) {
    console.log('\n── ' + nombre + ' ──');
    try { fn(); } catch (e) { FALLOS++; console.log('FAIL ' + nombre + ' · LANZÓ: ' + (e && e.message ? e.message : e)); }
}

function cargar(extra) {
    const src = leer('js/coach/comms/club-chat.js');
    const sb = Object.assign({ console, String, Array }, extra || {});
    sb.window = sb;
    vm.createContext(sb);
    ['_ccNombreDe', '_ccNombreAutor'].forEach(function (n) {
        const i = src.indexOf('function ' + n + '(');
        if (i === -1) throw new Error('no se encontró function ' + n);
        const fin = src.indexOf('\n}', i);
        vm.runInContext(src.slice(i, fin + 2), sb);
    });
    return sb;
}

const MAIL = 'arinagazone@gmail.com';

parte('PARTE 1 · 🔑 el resolutor único de autoría', () => {
    const sb = cargar();
    const f = sb._ccNombreAutor;
    ok('1a · existe', typeof f === 'function');
    ok('1b · el nombre SELLADO manda',
        f({ coachName: 'Pepe Díaz', coachEmail: MAIL, coachUid: 'u1' }) === 'Pepe Díaz');
    ok('1c · 🔑🔑 informe ANTIGUO (sin coachName): sale del censo por coachUid',
        f({ coachEmail: MAIL, coachUid: 'u1' }, { u1: 'Pepe Díaz' }) === 'Pepe Díaz');
    ok('1d · sin censo pasado, sirve el directorio del club ya cargado',
        cargar({ _ccState: { directorio: { nombres: { u1: 'Ana Ruiz' } } } })
            ._ccNombreAutor({ coachEmail: MAIL, coachUid: 'u1' }) === 'Ana Ruiz');
    ok('1e · si el autor soy YO, mi nombre (displayName / nombre+apellidos)',
        cargar({ _cronosCurrentUser: { uid: 'u1', firstName: 'Pepe', lastName: 'Díaz', email: MAIL } })
            ._ccNombreAutor({ coachEmail: MAIL, coachUid: 'u1' }) === 'Pepe Díaz');
    const ultimo = f({ coachEmail: MAIL, coachUid: 'desconocido' });
    ok('1f · 🔑🔑🔑 sin nada más, NUNCA el correo entero (sin dominio)',
        ultimo === 'arinagazone' && ultimo.indexOf('@') === -1, ultimo);
    ok('1g · documento vacío no lanza', f(null) === '' && f({}) === '');
});

parte('PARTE 2 · los cuatro sitios del grupal ya no pintan el correo', () => {
    const motor = sinCom(leer('js/coach/reports/report-engine.js'));
    // El motor es PURO (test_report_engine_module: cero globales), así que
    // lee el `coachName` que resuelven los agregadores y, como último
    // recurso, el correo SIN dominio.
    ok('2a · motor _RP (ficha del partido): 👤 lee coachName, nunca el correo entero',
        /👤 \$\{esc\(String\(m\.coachName/.test(motor) &&
        /String\(m\.coachEmail \|\| ''\)\.split\('@'\)\[0\]/.test(motor) &&
        !/👤 \$\{esc\(m\.coachEmail/.test(motor));
    ok('2a2 · el agregador de «Mis Informes» también resuelve coachName',
        /coachName:\s*\(typeof window\._ccNombreAutor === 'function' \? window\._ccNombreAutor\(r\)/
            .test(leer('js/coach/comms/individual-reports.js')));

    const tab = sinCom(leer('js/coach/reports/reports-tab.js'));
    ok('2b · tarjeta de Dirección: 👤 usa m.coachName',
        /👤 \$\{escapeHtml\(m\.coachName/.test(tab) && !/👤 \$\{escapeHtml\(m\.coachEmail/.test(tab));
    ok('2c · el agregador COPIA coachName (la trampa de v737)', /coachName:\s*r\.coachName/.test(tab));
    ok('2d · 🔑 el agregado se resuelve contra el censo ya leído (_sdUserDocs)',
        /_sdUserDocs\.forEach[\s\S]{0,200}_ccNombreDe/.test(tab) &&
        /_ccNombreAutor\(m, _sdNombres\)/.test(tab));

    const exp = sinCom(leer('js/coach/reports/reports-export.js'));
    ok('2e · PDF: la cabecera (meta) ya no lleva m.coachEmail',
        !/meta:\s*\[[\s\S]{0,300}m\.coachEmail/.test(exp) && /'Entrenador: ' \+ _rxAutor\(m\)/.test(exp));
    ok('2f · CSV: la fila «Entrenador» usa _rxAutor', /\['Entrenador', _rxAutor\(m\)/.test(exp));
});

parte('PARTE 3 · los informes NUEVOS sellan coachName al escribirse', () => {
    [
        'js/coach/comms/collective-report.js',
        'js/coach/comms/match-reports-auto.js',
        'js/coach/comms/match-reports-send.js',
        'js/coach/comms/manual-report.js',
    ].forEach(function (f) {
        ok('3 · ' + path.basename(f) + ' sella coachName', /coachName:\s*\(typeof window\._ccNombreDe/.test(leer(f)));
    });
});

parte('PARTE 4 · «Enviado por» de los avisos: familias y Dirección', () => {
    const fam = sinCom(leer('js/parent/panel.js'));
    ok('4a · panel de familias: «Enviado por» usa _ccNombreAutor',
        /Enviado por: \$\{\(\(\) => \{ const a = \(typeof window\._ccNombreAutor/.test(fam) &&
        !/escapeHtml\(d\.coachEmail/.test(fam) && !/Enviado por: \$\{d\.coachEmail/.test(fam));
    ok('4b · familias: carga el censo del club antes de pintar (avisos sin coachName)',
        /items\.some\(it => !it\.coachName\)[\s\S]{0,120}_ccCargarDirectorio\(clubId\)/.test(fam));
    const ev = sinCom(leer('js/coach/reports/events-tab.js'));
    ok('4c · lista de avisos de Dirección: «Enviado por» ya no pinta el correo',
        /'Enviado por ' \+ escapeHtml\(_cronosNombreEntrenadorAviso\(d\)\)/.test(ev) &&
        !/'Enviado por ' \+ escapeHtml\(d\.coachEmail\)/.test(ev));
    ok('4d · Dirección: carga el censo del club antes de pintar',
        /items\.some\(it => !it\.coachName\)[\s\S]{0,120}_ccCargarDirectorio\(clubId\)/.test(ev));
});

parte('PARTE 5 · v757 · «Mis Informes de Partido» descarga el colectivo como Dirección', () => {
    const src = leer('js/coach/comms/individual-reports.js');
    const mi = sinCom(src);
    ok('5a · existe miExportInforme', /window\.miExportInforme = \(key64, fmt\) =>/.test(mi));
    const i = mi.indexOf('window.miExportInforme =');
    const cuerpo = mi.slice(i, mi.indexOf('};', i));
    ok('5b · 🔑 usa el MISMO módulo que Dirección (rxExportarInformePDF / CSV)',
        /window\.rxExportarInformeCSV\(m\)/.test(cuerpo) && /window\.rxExportarInformePDF\(m, cuerpo/.test(cuerpo));
    ok('5c · 🔑 y el MISMO motor visual (_RP.build)', /_RP\.build\(m, window\._cronosCurrentUser\)/.test(cuerpo));
    ok('5d · 🚨 sin `await` antes de abrir la ventana (bloqueo de ventanas emergentes)', !/await/.test(cuerpo));
    ok('5e · botones 🖨️ y 📊 en la tarjeta, sin desplegar',
        /miExportInforme\('\$\{key64\}','pdf'\)"\s*title="Descargar este informe grupal en PDF"/.test(mi) &&
        /miExportInforme\('\$\{key64\}','csv'\)"\s*title="Descargar este informe grupal en CSV/.test(mi));
    ok('5f · y en la barra del informe desplegado', /🖨️ Descargar PDF/.test(mi) && /📊 Descargar CSV/.test(mi));
    ok('5g · sin el módulo cargado no se pinta ningún botón',
        /const _miPuedeExpInforme = typeof window\.rxExportarInformePDF === 'function' &&/.test(mi));
    ok('5h · el agregador copia subcategory (la cabecera imprime «regional B»)',
        /subcategory: r\.subcategory\|\|''/.test(mi));
});

console.log('\n' + (FALLOS ? '❌ ' + FALLOS + ' FALLO(S)' : '✅ TODO VERDE'));
process.exit(FALLOS ? 1 : 0);
