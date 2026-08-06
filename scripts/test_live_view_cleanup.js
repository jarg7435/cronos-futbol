// ═══════════════════════════════════════════════════════════════════════════
// GUARD · implementar.txt del 2026-08-02 (v424) — visor en vivo
// ═══════════════════════════════════════════════════════════════════════════
//   1. Flechas de sustitución unificadas: ▲ ROJA = SALE, ▼ VERDE = ENTRA.
//   2. Avisos flotantes justo debajo del marcador, en los tres formatos.
//   3. Un gol se registra UNA vez en el historial (era el bug de verdad).
//   4. Cabecera sin duplicados: un "EN VIVO", un "VOLVER", un control de sonido.
//
// La PARTE 3 no se conforma con mirar el código: EJECUTA las dos vías que
// alimentan el historial sobre el mismo suceso y comprueba que sale una sola
// fila. Es el único modo de fijar de verdad un bug que era una CARRERA entre
// dos escritores; una aserción de regex habría seguido en verde con el bug
// dentro, porque las dos funciones existían y parecían correctas por separado.
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = f => fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/\r\n/g, '\n');

let fallos = 0, total = 0;
function ok(nombre, cond, extra) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}`); if (extra !== undefined) console.log('      ' + extra); fallos++; }
}

const LIVE  = leer('live.html');
const ACT   = leer('js/match/events/player-actions.js');
const REPO  = leer('js/coach/reports/report-engine.js');
const REPL  = leer('js/match/replay/replay-player.js');
const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const LIVEC = sinCom(LIVE), ACTC = sinCom(ACT), REPOC = sinCom(REPO);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 0 · el fichero sigue parseando ──');
// ───────────────────────────────────────────────────────────────────────────
// Primero de todo: si live.html no parsea, TODO lo de abajo daría verde leyendo
// texto de un fichero que el navegador ni ejecuta.
{
    const bloques = [...LIVE.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
        .filter(m => !/\bsrc\s*=/.test(m[1] || '') && (m[2] || '').trim());
    let malos = 0;
    bloques.forEach(m => {
        try { new vm.Script((m[2] || '').replace(/^\s*import\s[^;]*;?$/gm, '')); }
        catch (e) { malos++; console.log('      ' + e.message); }
    });
    ok('0a · todos los <script> de live.html parsean', malos === 0);
    ok('0b · y hay más de uno (no se ha vaciado el fichero)', bloques.length >= 2);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · flechas: ▲ ROJA = SALE, ▼ VERDE = ENTRA ──');
// ───────────────────────────────────────────────────────────────────────────
// El autor vio "rombos negros con ?" en móvil: es U+FFFD, el hueco que deja una
// fuente sin ese glifo. Los 🟥/🟩 anteriores son Unicode 12 (2019) y en fuentes
// más viejas no existen. ▲/▼ son de Unicode 1.1 y están en todas.

ok('1a · el emisor de sustituciones usa ▲ SALE / ▼ ENTRA',
   /equipo \+ ' \| ▲ SALE: ' \+ outName \+ ' \| ▼ ENTRA: ' \+ inName/.test(ACTC));
ok('1b · el movimiento suelto también',
   /' \| ▼ ENTRA: ' \+ nombre/.test(ACTC) && /' \| ▲ SALE: ' \+ nombre/.test(ACTC));
ok('1c · 🔑 no queda NINGÚN glifo descartado en el emisor',
   !/[🟥🟩🔺🔻]\s*(SALE|ENTRA)/.test(ACTC),
   (ACTC.match(/[🟥🟩🔺🔻][^\n]*/) || ['(limpio)'])[0]);

// El cronograma de informes usaba la convención CONTRARIA hasta v423.
// v426: el formato de la etiqueta pasó a llevar la pareja explícita
// ("▼ ENTRA: X (por Y) 30'"), pero la CONVENCIÓN de flecha y color es la misma.
ok('1d · el cronograma pinta la ENTRADA en verde con ▼',
   /abajo\.push\(\{[^}]*color: '#3fb950'[\s\S]{0,200}?txt: `▼ ENTRA:/.test(REPOC));
ok('1e · y la SALIDA en rojo con ▲',
   /arriba\.push\(\{[^}]*color: '#ff5858'[\s\S]{0,200}?txt: `▲ SALE:/.test(REPOC));
ok('1f · 🔑 y la leyenda dice lo mismo que el cronograma (no al revés)',
   /#3fb950[^<]*>▼ NOMBRE<\/span> Entra/.test(REPO) &&
   /#ff5858[^<]*>NOMBRE ▲<\/span> Sale/.test(REPO));

// Compatibilidad: un partido ya guardado conserva su texto viejo.
ok('1g · 🔑 el coloreado sigue aceptando los TRES juegos de glifos',
   /\[▲🟥🔺\]\\s\*SALE:/.test(LIVEC) && /\[▼🟩🔻\]\\s\*ENTRA:/.test(LIVEC),
   'sin esto, los partidos anteriores dejan de colorearse');

// El replay saca los nombres del texto para los eventos antiguos: si alguien
// metiera el glifo en esa expresión, cambiarlo otra vez rompería la repetición.
ok('1h · 🔑 el parseo del replay NO depende del glifo, solo de SALE:/ENTRA:',
   /text\.match\(\/SALE:\\s\*\(\.\+\?\)\\s\*\\\|\\s\*\[\^\|\]\*ENTRA:/.test(REPL));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · v444 · LOS AVISOS FLOTANTES, DE VUELTA ──');
// ───────────────────────────────────────────────────────────────────────────
// ⚠️ ESTA PARTE HA CAMBIADO DE SIGNO DOS VECES, y conviene saberlo antes de
// tocarla otra vez:
//   · v424 la escribió para fijar que la pila de avisos se colocara justo
//     debajo del marcador, midiendo su borde inferior (--toast-top).
//   · v440 la invirtió: el autor retiró la pila entera porque, siendo GLOBAL,
//     no decía a qué partido pertenecía con varios en curso.
//   · v444 la devuelve a su intención original: el autor pidió los avisos de
//     vuelta —"no sólo deben sonar, también tienen que mostrarse"—, porque el
//     aviso emergente es lo único que se ve SIN mirar y la ventana inferior no
//     lo sustituye (en reposo está plegada).
// Lo que NO se ha deshecho de v440 es la ventana inferior: ahora conviven, y
// scripts/test_live_events_drawer.js fija que ninguna dependa de la otra.
//
// 🔑 Se mide sobre LIVEC (sin comentarios): los comentarios de este proyecto
// CITAN lo que se retira y lo que vuelve, así que un censo sobre el fuente
// crudo daría verde o rojo por la razón equivocada.

ok('2a · 🔑 la pila de avisos flotantes está en el marcado',
   /<div id="event-toast-stack"><\/div>/.test(LIVEC.replace(/<!--[\s\S]*?-->/g, '')),
   'el autor los pidió de vuelta en v444');
ok('2b · con sus estilos y la variable que la coloca',
   /#event-toast-stack\s*\{/.test(LIVEC) && /\.event-toast\s*\{/.test(LIVEC) &&
   /--toast-top/.test(LIVEC));
ok('2b2 · 🔑 la posición sale de una variable CSS, no de un número por formato',
   /#event-toast-stack\s*\{[^}]*top:\s*var\(--toast-top/.test(LIVEC),
   'v424: con un número por formato se rompía al cambiar la cabecera');
ok('2b3 · 🔑 y NADIE la vuelve a clavar en ningún @media',
   !/#event-toast-stack\s*\{[^}]*top:\s*(calc\()?\s*\d/.test(LIVEC),
   (LIVEC.match(/#event-toast-stack\s*\{[^}]*top:[^;]*/g) || []).join(' // '));
ok('2c · existe la función que mide',
   /function _posicionaAvisos\(\)/.test(LIVEC));
ok('2c2 · 🔑 mide el borde INFERIOR del marcador, con la cabecera de respaldo',
   /sb\.getBoundingClientRect\(\)\.bottom/.test(LIVEC) &&
   /hdr\.getBoundingClientRect\(\)\.bottom/.test(LIVEC));
ok('2c3 · y se re-mide al girar, al redimensionar y al cambiar la caja',
   /addEventListener\('orientationchange', remedir\)/.test(LIVEC) &&
   /addEventListener\('resize', remedir\)/.test(LIVEC) &&
   /new ResizeObserver\(remedir\)/.test(LIVEC));
ok('2d · y sus animaciones',
   /@keyframes toastIn/.test(LIVEC) && /@keyframes toastOut/.test(LIVEC));

// El anuncio va por VARIAS vías y ninguna puede llevarse a las otras por
// delante. Se acota el cuerpo de showEventToast por la siguiente declaración en
// columna 0, no por un número fijo de caracteres: la función acaba de crecer y
// una ventana de 900 se quedó corta (trampa ya pagada en la ronda 2 del
// nav-stack).
const _cuerpoToast = (() => {
    const i = LIVEC.indexOf('function showEventToast(');
    if (i === -1) return '';
    const j = LIVEC.indexOf('\n}', i);
    return j === -1 ? LIVEC.slice(i) : LIVEC.slice(i, j);
})();
ok('2e · 🔑 el suceso se anuncia con AVISO FLOTANTE',
   /getElementById\("event-toast-stack"\)/.test(_cuerpoToast) &&
   /stack\.appendChild\(el\)/.test(_cuerpoToast));
// ⚠️ v457 · REAPUNTADA, no borrada. La intención NO cambia —el aviso se va solo
// a los 8 s y también al tocarlo—, pero las dos vías pasan ahora por un
// intermediario y la forma literal de v424 (`setTimeout(quitar, 8000)` /
// `el.onclick = quitar`) ya no aparece:
//   · el cierre automático se aplaza mientras se está LEYENDO la pila (si no,
//     deslizarla para leer un cambio grupal hacía desaparecer los primeros
//     avisos a media lectura);
//   · el clic no cierra si el toque fue el comienzo de un DESLIZAMIENTO.
// Lo que se fija aquí es que los 8 s y el cierre por toque siguen existiendo, y
// que ninguna de las dos guardas nuevas puede saltar en un contexto donde no
// existan (se consultan con `typeof`, porque esta función se extrae y se
// ejecuta sola en varios guards).
ok('2e2 · …que se va solo a los 8 s y también al tocarlo',
   /setTimeout\(cierreAutomatico, 8000\)/.test(_cuerpoToast) &&
   /el\.onclick = \(\) => \{/.test(_cuerpoToast) &&
   /quitar\(\);/.test(_cuerpoToast));
ok('2e2b · v457 · el cierre automático se aplaza mientras se lee la pila',
   /typeof _avisosEnLectura === 'function' && _avisosEnLectura\(\)/.test(_cuerpoToast) &&
   /setTimeout\(cierreAutomatico, 600\)/.test(_cuerpoToast),
   'sin esto, deslizar para leer un cambio grupal hace desaparecer los avisos');
ok('2e2c · v457 · y un deslizamiento no cuenta como toque de cierre',
   /typeof _fueArrastreDeLectura === 'function' && _fueArrastreDeLectura\(\)/.test(_cuerpoToast));
// v449: la etiqueta del partido SIGUE siendo obligatoria —la intención de esta
// aserción no cambia— pero ya no se pinta en `.et-sub` (gris, segunda línea):
// encabeza el aviso en `.et-match`. Se reapunta a la forma nueva en vez de
// borrarla. El detalle de dónde va y de que no se invente cuando no hay datos
// lo cubre scripts/test_avisos_y_destinatarios.js.
ok('2e3 · 🔑 el aviso lleva la etiqueta del partido (es global: hace falta)',
   /_partido \? '<div class="et-match">' \+ escapeHtml\(_partido\)/.test(_cuerpoToast));
ok('2f · …con destello', /getElementById\("event-flash"\)/.test(_cuerpoToast));
ok('2g · …con sonido', /playEventSound\(type\)/.test(_cuerpoToast));
ok('2h · …con vibración, salvo silenciado',
   /if \(!_alertsMuted\) vibrate\(meta\.vib\)/.test(_cuerpoToast));
ok('2h2 · …y va a parar a la ventana inferior de sucesos',
   /_appendEventToHistoryPanel\(type, line, sub, _metaExt\)/.test(_cuerpoToast),
   'es el único punto por el que detectAndAlert anuncia un suceso');
ok('2h3 · 🔑 y NINGUNA de esas vías puede abortar a las siguientes',
   !/const stack = document\.getElementById\("event-toast-stack"\);\s*if \(!stack\) return;/.test(_cuerpoToast),
   'antes de v440 un `if (!stack) return` se llevaba por delante historial, destello, sonido y vibración');
ok('2i · el mando de sonido sigue en la cabecera (no se ha quedado sin dueño)',
   /id="btn-mute" onclick="toggleSound\(\)"/.test(LIVE));

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · 🔑 UN GOL, UNA LÍNEA (ejecutado de verdad) ──');
// ───────────────────────────────────────────────────────────────────────────
// El bug: el historial lo alimentaban DOS escritores sobre el mismo snapshot.
// _loadMatchEventsFromSnapshot reconstruía la lista desde Firestore con el texto
// plano, y acto seguido _appendEventToHistoryPanel añadía el suceso nuevo con la
// palabra clave coloreada → el mismo gol, dos veces y con dos aspectos.
{
    // Se extrae el bloque del módulo y se ejecuta con lo justo para que las dos
    // vías funcionen sobre un DOM de mentira que cuenta las filas.
    const mod = (LIVE.match(/<script type="module">([\s\S]*?)<\/script>/) || [, ''])[1]
        .replace(/^\s*import\s[^;]*;?$/gm, '')
        .replace(/import\s*{[^}]*}\s*from\s*['"][^'"]*['"];/g, '');

    const filas = [];
    const elLista = {
        _hijos: filas,
        appendChild(r) { filas.push(r); },
        set innerHTML(v) { if (v === '') filas.length = 0; },
        get innerHTML() { return ''; },
        scrollTop: 0, scrollHeight: 0, style: {},
    };
    const elGenerico = () => ({
        style: {}, classList: { toggle(){}, add(){}, remove(){} },
        appendChild(){}, remove(){}, set innerHTML(v){}, get innerHTML(){ return ''; },
        set textContent(v){}, get textContent(){ return ''; },
        get firstChild(){ return null; }, children: { length: 0 }, offsetWidth: 0,
        offsetParent: null, getBoundingClientRect: () => ({ bottom: 0, height: 0 }),
        addEventListener(){}, removeEventListener(){}, querySelector(){ return null; },
    });
    const sb = {
        console: { log(){}, warn(){}, error(){} },
        localStorage: { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=v; } },
        document: {
            documentElement: { style: { setProperty(){} } },
            readyState: 'complete',
            getElementById(id) {
                if (id === 'match-events-list') return elLista;
                return elGenerico();
            },
            createElement() { return { style: { cssText: '' }, set innerHTML(v){ this._h = v; }, get innerHTML(){ return this._h || ''; } }; },
            addEventListener(){}, get body(){ return elGenerico(); },
        },
        navigator: { vibrate(){} },
        location: { search:'', pathname:'/live.html', origin:'http://x' },
        history: { pushState(){} },
        setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
        URLSearchParams: function(){ return { get(){ return null; } }; },
        escapeHtml(s){ return String(s == null ? '' : s); },
        AudioContext: function(){ return { state:'suspended', currentTime:0, resume(){},
            createOscillator(){ return { frequency:{}, connect(){}, start(){}, stop(){} }; },
            createGain(){ return { gain:{ setValueAtTime(){}, exponentialRampToValueAtTime(){} }, connect(){} }; },
            destination:{} }; },
        initializeApp(){ return {}; }, getAuth(){ return {}; }, getFirestore(){ return {}; },
        signInWithEmailAndPassword(){}, signOut(){}, onAuthStateChanged(){},
        browserLocalPersistence:{}, setPersistence(){ return { catch(){} }; },
        doc(){ return {}; }, getDoc(){}, collection(){ return {}; },
        onSnapshot(){ return () => {}; }, getDocs(){ return Promise.resolve({ forEach(){} }); },
    };
    sb.window = sb; sb.globalThis = sb;
    sb.addEventListener = function(){}; sb.removeEventListener = function(){};
    sb.webkitAudioContext = sb.AudioContext;
    vm.createContext(sb);
    vm.runInContext(mod + '\n;globalThis.__x = { _appendEventToHistoryPanel, _formateaLineaEvento, EVENT_META };', sb, { filename: 'live-mod.js' });

    const X = sb.__x;
    const cargar = sb.window._loadMatchEventsFromSnapshot;

    ok('3a · las dos vías del historial existen',
       typeof X._appendEventToHistoryPanel === 'function' && typeof cargar === 'function');

    // ── EL ESCENARIO DEL BUG, tal cual ocurría ──
    // 1) Llega el snapshot con el gol: se reconstruye la lista entera.
    filas.length = 0;
    cargar([{ type:'goal', text:'GOL · PEDRO', icon:'⚽', matchTime:"12'", realTime:'19:04:11' }]);
    const trasSnapshot = filas.length;
    ok('3b · la reconstrucción desde Firestore pinta el gol', trasSnapshot === 1, 'filas=' + trasSnapshot);

    // 2) Acto seguido detectAndAlert anuncia ESE MISMO gol y lo añade otra vez.
    X._appendEventToHistoryPanel('goal', X._formateaLineaEvento('goal', 'GOL · PEDRO'), 'A vs B',
                                 Object.assign({}, X.EVENT_META.goal, { matchTime: "12'" }));
    ok('3c · 🔑 EL BUG: el mismo gol NO se añade una segunda vez',
       filas.length === 1,
       'filas=' + filas.length + ' (antes de v424 salían 2, con formatos distintos)');

    // 3) Un gol DISTINTO sí tiene que entrar.
    X._appendEventToHistoryPanel('goal', X._formateaLineaEvento('goal', 'GOL · LUIS'), 'A vs B',
                                 Object.assign({}, X.EVENT_META.goal, { matchTime: "31'" }));
    ok('3d · 🔑 pero un gol DISTINTO sí entra (el dedup no se come sucesos)',
       filas.length === 2, 'filas=' + filas.length);

    // 4) Y el MISMO jugador marcando OTRA VEZ, en otro minuto, también.
    X._appendEventToHistoryPanel('goal', X._formateaLineaEvento('goal', 'GOL · PEDRO'), 'A vs B',
                                 Object.assign({}, X.EVENT_META.goal, { matchTime: "44'" }));
    ok('3e · 🔑 el mismo jugador marcando otra vez en otro minuto también entra',
       filas.length === 3, 'filas=' + filas.length);

    // 5) Una reconstrucción posterior no puede salir vacía por auto-dedup.
    filas.length = 0;
    cargar([
        { type:'goal', text:'GOL · PEDRO', icon:'⚽', matchTime:"12'" },
        { type:'goal', text:'GOL · LUIS',  icon:'⚽', matchTime:"31'" },
        { type:'goal', text:'GOL · PEDRO', icon:'⚽', matchTime:"44'" },
    ]);
    ok('3f · 🔑 una recarga posterior repinta los 3, no 0',
       filas.length === 3,
       'filas=' + filas.length + ' (si sale 0, el registro de claves no se reinicia)');

    // 6) Y las dos vías tienen que producir el MISMO HTML, o el dedup emparejaría
    //    mal y además se verían dos aspectos del mismo suceso.
    ok('3g · 🔑 el formateador colorea la palabra clave del texto plano',
       /color:#3fb950[^>]*>GOL<\/span> · PEDRO/.test(X._formateaLineaEvento('goal', 'GOL · PEDRO')),
       X._formateaLineaEvento('goal', 'GOL · PEDRO'));
    ok('3h · y las sustituciones por su lado (rojo SALE, verde ENTRA)',
       /#ff5858[^>]*>▲ SALE:/.test(X._formateaLineaEvento('sub', 'EQ | ▲ SALE: A | ▼ ENTRA: B')) &&
       /#3fb950[^>]*>▼ ENTRA:/.test(X._formateaLineaEvento('sub', 'EQ | ▲ SALE: A | ▼ ENTRA: B')));
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · cabecera sin duplicados ──');
// ───────────────────────────────────────────────────────────────────────────
// ⚠️ TRAMPA YA PAGADA (dos veces: aquí y en test_responsive_layout.js): los
// comentarios de este proyecto CITAN lo que se acaba de quitar —"se retiró el
// botón 🏠 INICIO", "antes decía MI PARTIDO"—. Contar apariciones sin quitar
// antes los <!-- --> da 3 "EN VIVO" donde el usuario ve 1, y hace fallar
// aserciones correctas (o peor, pasar aserciones falsas).
const cabeceraCruda = (LIVE.match(/<header id="live-header"[\s\S]*?<\/header>/) || [''])[0];
const cabecera = cabeceraCruda.replace(/<!--[\s\S]*?-->/g, '');

ok('4a · la cabecera se encontró', cabecera.length > 200);
ok('4a2 · y el recuento ignora los comentarios (si no, cuenta lo ya retirado)',
   cabeceraCruda.length > cabecera.length);
ok('4b · 🔑 "EN VIVO" aparece UNA sola vez en la cabecera',
   (cabecera.match(/EN VIVO/g) || []).length === 1,
   (cabecera.match(/EN VIVO/g) || []).length + ' apariciones');
ok('4c · 🔑 y ese único "EN VIVO" es a la vez indicador y botón',
   /<button id="live-badge" onclick="showLiveNow\(\)"/.test(cabecera),
   'no se pudo borrar sin más: #badge-text también muestra FINALIZADO');
ok('4d · el badge sigue pudiendo decir FINALIZADO',
   /badge-text'\)\.textContent\s*=\s*isLive \? 'EN VIVO' : 'FINALIZADO'/.test(LIVE));

ok('4e · 🔑 el botón dice "VOLVER", no "MI PARTIDO"',
   /←\s*VOLVER/.test(cabecera) && !/MI PARTIDO/.test(cabecera));
ok('4f · y conserva su función de volver a la ventana que abrió el visor',
   /id="btn-back-to-match" onclick="backToMatch\(\)"/.test(cabecera) &&
   /window\.opener && !window\.opener\.closed[\s\S]{0,120}window\.close\(\)/.test(LIVE));
ok('4g · 🔑 ya no nace oculto (era la única salida y sólo se veía a veces)',
   !/id="btn-back-to-match"[^>]*style="display:none/.test(cabecera));
ok('4h · 🔑 se retiró el 🏠 INICIO duplicado (backToMatch ya cae a index.html)',
   !/INICIO/.test(cabecera) &&
   /window\.location\.href = 'index\.html'/.test(LIVE));

ok('4i · 🔑 UN solo control de sonido en la cabecera',
   (cabecera.match(/id="btn-mute"/g) || []).length === 1 &&
   !/btn-activate-sound/.test(cabecera));
ok('4j · y llama al mando unificado',
   /id="btn-mute" onclick="toggleSound\(\)"/.test(cabecera));
ok('4k · 🔑 el primer toque DESBLOQUEA el audio en vez de silenciar',
   /window\.toggleSound = function\(\)[\s\S]{0,700}?if \(!desbloqueado\)[\s\S]{0,400}?window\.activateSound\(\)/.test(LIVEC),
   'en iPhone standalone el AudioContext arranca bloqueado: sin esto se queda mudo');
ok('4l · y a partir de ahí es un silenciador normal',
   /window\.toggleSound = function\(\)[\s\S]{0,900}?window\.toggleMute\(\);/.test(LIVEC));
ok('4m · el botón refleja los TRES estados (bloqueado / silenciado / sonando)',
   /needs-unlock/.test(LIVEC) && /Activar sonido/.test(LIVEC) &&
   /classList\.toggle\("muted"/.test(LIVEC));
ok('4n · 🔑 no quedan referencias al botón retirado',
   !/getElementById\(['"]btn-activate-sound['"]\)/.test(LIVEC),
   (LIVEC.match(/btn-activate-sound[^\n]*/g) || ['(limpio)'])[0]);

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) { console.log(`❌ ${fallos} aserción(es) en rojo`); process.exit(1); }
console.log('✅ Visor en vivo v424: todas las aserciones en verde');
