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
ok('1d · el cronograma pinta la ENTRADA en verde con ▼',
   /abajo\.push\(\{[^}]*color: '#3fb950'[\s\S]{0,120}?txt: '▼ '/.test(REPOC));
ok('1e · y la SALIDA en rojo con ▲',
   /arriba\.push\(\{[^}]*color: '#ff5858'[\s\S]{0,160}?\+ ' ▲'/.test(REPOC));
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
console.log('\n── PARTE 2 · avisos justo debajo del marcador ──');
// ───────────────────────────────────────────────────────────────────────────
// Antes cada formato tenía su `top` a ojo (1rem / 100px / 130px), calculado
// sobre la altura que tenía la cabecera aquel día. En v422 se compactó la
// cabecera del móvil y esos números se quedaron mal sin que nada fallara.

ok('2a · la posición sale de una variable CSS, no de un número por formato',
   /#event-toast-stack\s*\{[^}]*top:\s*var\(--toast-top/.test(LIVEC));
ok('2b · 🔑 y NADIE la vuelve a clavar en ningún @media',
   !/#event-toast-stack\s*\{[^}]*top:\s*(calc\()?\s*\d/.test(LIVEC),
   (LIVEC.match(/#event-toast-stack\s*\{[^}]*top:[^;]*/g) || []).join(' // '));
ok('2c · existe la función que mide', /function _posicionaAvisos\(\)/.test(LIVEC));
ok('2d · 🔑 mide el borde INFERIOR del marcador (no la cabecera)',
   /getElementById\('scoreboard'\)/.test(LIVEC) &&
   /sb\.getBoundingClientRect\(\)\.bottom/.test(LIVEC));
ok('2e · con la cabecera como respaldo si el marcador está oculto',
   /hdr\.getBoundingClientRect\(\)\.bottom/.test(LIVEC));
ok('2f · se re-mide al girar la pantalla y al redimensionar',
   /addEventListener\('orientationchange', remedir\)/.test(LIVEC) &&
   /addEventListener\('resize', remedir\)/.test(LIVEC));
ok('2g · y cuando cambia la caja de la cabecera o del marcador (ResizeObserver)',
   /new ResizeObserver\(remedir\)/.test(LIVEC));
ok('2h · 🔑 se mide también justo antes de enseñar un aviso',
   /function showEventToast[\s\S]{0,400}?_posicionaAvisos\(\);/.test(LIVEC),
   'si no, el primer aviso tras entrar a un partido sale mal colocado');
// El bloque corre al cargar el módulo: si lanzara, se llevaría el visor entero.
ok('2i · 🔑 el observador tolera que no exista requestAnimationFrame',
   /typeof requestAnimationFrame === 'function'/.test(LIVEC),
   'se ejecuta al cargar: una excepción aquí tumba TODO el <script>');

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
