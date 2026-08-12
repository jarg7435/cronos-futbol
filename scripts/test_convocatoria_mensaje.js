// ════════════════════════════════════════════════════════════════════
//  GUARD · MENSAJE DEL ENTRENADOR Y PROCEDENCIA DEL INVITADO
//  en la convocatoria · 2026-08-12
// ════════════════════════════════════════════════════════════════════
//  💥 EL FALLO QUE FIJA (parte 1). Los dos publicadores de convocatorias
//  hacían `const extra = sv.type || …`, y `sv.type` es el TIPO DE PARTIDO
//  ('liga'|'copa'|'amistoso'|'torneo'), que SIEMPRE viene relleno. El `||`
//  cortocircuitaba y el mensaje del entrenador no se leía jamás: las doce
//  últimas convocatorias de PRODUCCIÓN llevaban extra="amistoso"/"copa",
//  y eso es lo que salía dentro del globo 💬 del Director y de los padres.
//
//  🔑 El recuadro y las tres vistas YA EXISTÍAN. Lo que faltaba era una
//  línea. Por eso este guard mira el VALOR que se resuelve, no si hay un
//  textarea en el HTML: un censo de marcado habría dado verde con el fallo
//  dentro.
//
//  Parte 2: el jugador de apoyo dice de qué categoría viene, en las cuatro
//  vistas que consumen `players` (Director, dos del padre y WhatsApp/email).
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

// Extrae una función suelta de whatsapp-email.js y la ejecuta en un sandbox.
function cargar(nombres, doc) {
    const src = leer('js/shared/whatsapp-email.js');
    const sb = { console, String, Number, Object, Array, JSON, document: doc || { getElementById: () => null } };
    sb.window = sb;
    vm.createContext(sb);
    nombres.forEach(function (n) {
        const i = src.indexOf('function ' + n + '(');
        if (i === -1) throw new Error('no se encontró function ' + n);
        // Hasta la primera línea que empieza en columna 0 con '}' tras el inicio.
        const fin = src.indexOf('\n}', i);
        vm.runInContext(src.slice(i, fin + 2), sb);
    });
    return sb;
}

parte('PARTE 1 · 🔑🔑🔑 el mensaje del entrenador SÍ se lee', () => {
    const sb = cargar(['_cronosConvExtra']);
    const f = sb._cronosConvExtra;
    ok('1a · existe el resolutor único', typeof f === 'function');

    // 💥 EL CASO DEL FALLO: type relleno (siempre lo está) y message escrito.
    ok('1b · 🔑🔑🔑 con type="amistoso" y message escrito, gana el MENSAJE',
       f({ type: 'amistoso', message: '¡Vamos equipo!' }) === '¡Vamos equipo!',
       f({ type: 'amistoso', message: '¡Vamos equipo!' }));
    ok('1c · 🔑 y el tipo de partido NO se cuela nunca como mensaje',
       f({ type: 'copa' }) === '' && f({ type: 'liga' }) === '',
       [f({ type: 'copa' }), f({ type: 'liga' })]);
    ok('1d · sin nada, cadena vacía (no "undefined")', f({}) === '' && f(null) === '');
    ok('1e · el `extra` histórico sigue respetándose',
       f({ type: 'liga', extra: 'texto viejo' }) === 'texto viejo');

    // Si el panel de WhatsApp está en pantalla y tiene texto, gana ése.
    const sb2 = cargar(['_cronosConvExtra'], { getElementById: (id) =>
        id === 'cv-extra' ? { value: '  Lo escrito en el panel de envío  ' } : null });
    ok('1f · lo tecleado en el panel de envío gana al del panel de convocatoria',
       sb2._cronosConvExtra({ message: 'del otro panel' }) === 'Lo escrito en el panel de envío');
    ok('1g · pero un panel VACÍO no pisa el mensaje',
       cargar(['_cronosConvExtra'], { getElementById: () => ({ value: '   ' }) })
           ._cronosConvExtra({ message: 'este vale' }) === 'este vale');

    // Censo: ningún publicador puede volver a leer sv.type como mensaje.
    const wa = sinCom(leer('js/shared/whatsapp-email.js'));
    ok('1h · 🔑🔑 NINGÚN publicador vuelve a usar sv.type de mensaje',
       !/const\s+extra\s*=\s*sv\.type/.test(wa), (wa.match(/const\s+extra\s*=\s*sv\.type.*/g) || []));
    // ⚠️ Se excluye la DECLARACIÓN (`function _cronosConvExtra(sv)`), que casa
    // con el mismo patrón: contándola salían 3 y el rojo era del test.
    ok('1i · los dos publicadores usan el resolutor',
       (wa.match(/=\s*_cronosConvExtra\(sv\)/g) || []).length === 2,
       (wa.match(/=\s*_cronosConvExtra\(sv\)/g) || []).length);

    // El campo nuevo del panel de convocatoria se guarda.
    const imp = sinCom(leer('js/ai/import.js'));
    ok('1j · el panel de convocatoria tiene su textarea', /id="conv-message"/.test(leer('js/ai/import.js')));
    ok('1k · y saveConvData lo guarda en `message`, no en `type`',
       /message:\s*document\.getElementById\('conv-message'\)/.test(imp));

    // Las tres vistas ya lo pintaban: que sigan haciéndolo.
    ok('1l · el Panel de Dirección lo pinta', /d\.extra\s*\?/.test(leer('js/coach/reports/events-tab.js')));
    ok('1m · y las dos vistas del padre también',
       (leer('js/parent/panel.js').match(/\bn\.extra\b|\bd\.extra\b/g) || []).length >= 2);
});

parte('PARTE 2 · 🔑 la procedencia del jugador de apoyo', () => {
    const sb = cargar(['_cronosFormatConvokedPlayer']);
    const f = sb._cronosFormatConvokedPlayer;

    ok('2a · un jugador normal no gana campos raros',
       JSON.stringify(f('15. CUCO', 0)) === JSON.stringify({ num: '15', name: 'CUCO', origin: '' }),
       f('15. CUCO', 0));

    // 🔑 EL CASO DEL AUTOR: Sisto, del Alevín C, con el Juvenil B.
    const s = f('18. SISTO (Alevín C)', 0);
    ok('2b · 🔑🔑 el invitado se parte en nombre y procedencia',
       s.num === '18' && s.name === 'SISTO' && s.origin === 'Alevín C', s);
    ok('2c · el nombre sale SIN el paréntesis, para poder pintarlo aparte',
       s.name.indexOf('(') === -1, s.name);

    ok('2d · sin dorsal también', JSON.stringify(f('SISTO (Alevín C)', 3)) ===
       JSON.stringify({ num: '4', name: 'SISTO', origin: 'Alevín C' }), f('SISTO (Alevín C)', 3));
    ok('2e · una entrada que es sólo un número no revienta',
       JSON.stringify(f('7', 0)) === JSON.stringify({ num: '7', name: '', origin: '' }));
    ok('2f · y las convocatorias antiguas siguen igual',
       f('14. PEDRO', 0).origin === '' && f('', 2).num === '3');

    // El suffix se construye al resolver la lista de convocados.
    const wa = sinCom(leer('js/shared/whatsapp-email.js'));
    ok('2g · 🔑 la procedencia se añade al construir `players`',
       /p\.isGuest === true/.test(wa) && /label \+= ' \(' \+ _org \+ '\)'/.test(wa));
    ok('2h · usando la etiqueta legible del club, no el id crudo',
       /_cronosTeamRosterLabel\(p\.originCategory, p\.originSubcategory\)/.test(wa));

    // Y las tres vistas la pintan destacada.
    ok('2i · 🔑 el Panel de Dirección la pinta destacada',
       /f\.origin/.test(sinCom(leer('js/coach/reports/events-tab.js'))));
    ok('2j · y las dos vistas del padre',
       (sinCom(leer('js/parent/panel.js')).match(/f\.origin/g) || []).length >= 2,
       (sinCom(leer('js/parent/panel.js')).match(/f\.origin/g) || []).length);
});

parte('PARTE 3 · el recorrido completo, de la plantilla a la tarjeta', () => {
    // Se simula _savedConvokedPlayers tal y como lo deja saveConvPlayers y se
    // comprueba que la cadena que acaba en Firestore ya trae la procedencia.
    const src = leer('js/shared/whatsapp-email.js');
    const sb = { console, String, Number, Object, Array, JSON };
    sb.window = sb;
    sb.document = { querySelectorAll: () => [], getElementById: () => null };
    sb.localStorage = { getItem: () => null };
    sb.window._cronosTeamRosterLabel = function (c, s) {
        return (String(c || '') === 'alevin' ? 'Alevín' : String(c || '')) + ' ' + String(s || '');
    };
    sb.window._savedConvokedPlayers = [
        { number: '10', alias: 'IKER' },
        { number: '26', alias: 'SISTO', isGuest: true, originPlayerId: 'ALC18',
          originCategory: 'alevin', originSubcategory: 'C' },
    ];
    vm.createContext(sb);
    const i = src.indexOf('function _cronosResolvePlayersArr(');
    vm.runInContext(src.slice(i, src.indexOf('\n}', i) + 2), sb);

    const arr = sb._cronosResolvePlayersArr();
    ok('3a · salen los dos convocados', arr.length === 2, arr);
    ok('3b · el de la casa, tal cual', arr[0] === '10. IKER', arr[0]);
    ok('3c · 🔑🔑 y el invitado con su categoría de origen',
       arr[1] === '26. SISTO (Alevín C)', arr[1]);

    // Y al pintarlo, vuelve a separarse.
    const sb2 = cargar(['_cronosFormatConvokedPlayer']);
    const f = sb2._cronosFormatConvokedPlayer(arr[1], 1);
    ok('3d · 🔑 ida y vuelta sin perder nada',
       f.num === '26' && f.name === 'SISTO' && f.origin === 'Alevín C', f);
});

console.log('\n' + (FALLOS ? '❌ ' + FALLOS + ' FALLOS' : '✅ TODO VERDE'));
process.exit(FALLOS ? 1 : 0);
