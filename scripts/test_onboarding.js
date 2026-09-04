// ══════════════════════════════════════════════════════════════════════
//  test_onboarding.js  ·  el asistente de bienvenida (v670)
//
//  🔴 POR QUÉ EXISTE. Al paso de REGISTRO le faltaba su `{` de apertura y
//  sus campos de cabecera, así que sus `stepDesc`/`cardTitle`/`cardBody`
//  caían DENTRO del objeto de Instalación. Como la última clave repetida
//  gana, el Paso 1 conservaba el rótulo "Instalación" y pintaba la tarjeta
//  "Cómo registrarse" — y la guía de instalación, escrita entera, no se
//  había pintado NUNCA. El asistente anunciaba 9 pasos y enseñaba 8.
//
//  🔑🔑 `node --check` DABA VERDE: el fichero era JavaScript perfectamente
//  válido. Una regex sobre el fuente tampoco lo habría visto —los textos
//  estaban todos ahí—. La única forma de cazarlo es EVALUAR el array y
//  mirar los objetos que salen. Eso es lo que hace la PARTE 1.
// ══════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FBINIT = fs.readFileSync(path.join(ROOT, 'js/services/firebase-init.js'), 'utf8');

let pass = 0, fail = 0;
function ok(n, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + n); }
    else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '\n       ' + JSON.stringify(extra) : '')); }
}

// ── Extraer y EVALUAR OB_STEPS ────────────────────────────────────────
function leerPasos(ua) {
    const ini = INDEX.indexOf('const OB_STEPS = [');
    if (ini === -1) throw new Error('no se encontró OB_STEPS en index.html');
    // El array termina en la primera línea que sea exactamente "    ];"
    const resto = INDEX.slice(ini);
    const fin = resto.search(/\n\s*\];/);
    if (fin === -1) throw new Error('no se encontró el cierre de OB_STEPS');
    const src = resto.slice(0, fin) + '\n];';

    const ctx = { navigator: { userAgent: ua || 'Mozilla/5.0 (Windows NT 10.0)' } };
    vm.createContext(ctx);
    vm.runInContext(src + '\n; globalThis.__PASOS = OB_STEPS;', ctx);
    return ctx.__PASOS;
}

console.log('\n── PARTE 1 · la estructura de los pasos (el defecto de v670) ──');
const PASOS = leerPasos();
{
    ok('1a · el array se evalúa y trae pasos', Array.isArray(PASOS) && PASOS.length > 0);

    // ══════════════════════════════════════════════════════════════════
    //  🔑🔑 EL CENSO QUE CAZA LA FUSIÓN: EL FUENTE CONTRA EL ARRAY.
    //
    //  ⚠️ La primera versión de esta aserción miraba si a algún objeto del
    //  array le faltaba cabecera, y el red-check la desmintió: NO detecta
    //  nada. Cuando a un objeto le falta la llave, sus campos se suman al
    //  ANTERIOR —que ya tiene su cabecera— y el objeto simplemente
    //  desaparece del array. Todos los que quedan están completos.
    //
    //  Lo que sí lo delata es contar las claves EN EL FUENTE y compararlas
    //  con cuántos objetos salen al evaluar: 9 `stepDesc:` escritos y 8
    //  objetos significa que uno se ha comido a otro. Ésa es la firma
    //  exacta del defecto de v670.
    // ══════════════════════════════════════════════════════════════════
    const iniSrc = INDEX.indexOf('const OB_STEPS = [');
    const restoSrc = INDEX.slice(iniSrc);
    const SRC_PASOS = restoSrc.slice(0, restoSrc.search(/\n\s*\];/));
    const cuenta = (re) => (SRC_PASOS.match(re) || []).length;
    const censo = {
        objetos:   PASOS.length,
        sideLabel: cuenta(/^\s*sideLabel:/gm),
        heroTitle: cuenta(/^\s*icon:.*heroTitle:/gm),
        stepDesc:  cuenta(/^\s*stepDesc:/gm),
        cardTitle: cuenta(/^\s*cardTitle:/gm),
        cardBody:  cuenta(/^\s*cardBody:/gm),
    };
    ok('1b · 🔑🔑 el fuente escribe tantas claves como objetos salen (nada se ha fusionado)',
        Object.values(censo).every(n => n === PASOS.length), censo);

    const completos = PASOS.filter(p =>
        p.icon && p.heroTitle && p.heroSub && p.sideLabel && p.stepTitle && p.stepDesc &&
        typeof p.cardTitle === 'function' && typeof p.cardBody === 'function').length;
    ok('1c · y los seis campos que usa obRender()', completos === PASOS.length,
        { completos, total: PASOS.length });

    // El comentario que anuncia cuántos hay tiene que decir la verdad.
    const anunciados = (INDEX.match(/Definición de los (\d+) pasos/) || [])[1];
    ok('1d · ⚠️ el comentario anuncia tantos pasos como hay de verdad',
        String(PASOS.length) === anunciados, { anunciados, reales: PASOS.length });

    const cab = (INDEX.match(/ONBOARDING — (\d+) PASOS/) || [])[1];
    ok('1e · y la cabecera del bloque también', String(PASOS.length) === cab,
        { cabecera: cab, reales: PASOS.length });

    ok('1f · ningún rótulo lateral se repite',
        new Set(PASOS.map(p => p.sideLabel)).size === PASOS.length,
        PASOS.map(p => p.sideLabel));
}

console.log('\n── PARTE 2 · el Paso 1 habla de INSTALAR, no de registrarse ──');
{
    const p1 = PASOS[0];
    ok('2a · el paso 1 es el de instalación', /Instalaci/i.test(p1.sideLabel), p1.sideLabel);

    // 🔴 ESTA ES LA ASERCIÓN QUE HABRÍA CAZADO EL DEFECTO. El rótulo decía
    //    "Instalación" y el cuerpo hablaba de registrarse.
    for (const [nombre, ua] of [['iPhone', 'iphone'], ['Android', 'android'], ['ordenador', 'windows']]) {
        const p = leerPasos('Mozilla/5.0 (' + ua + ')')[0];
        const cuerpo = p.cardBody();
        const titulo = p.cardTitle();
        ok('2b · en ' + nombre + ' el paso 1 explica cómo instalar',
            !/registrar/i.test(titulo) && !/REGISTRARSE/.test(cuerpo),
            { titulo });
        ok('2c · en ' + nombre + ' menciona la pantalla de inicio',
            /pantalla de inicio|pantalla del móvil|propia ventana|Instalar/i.test(cuerpo));
    }

    // El encargo del autor: el botón de compartir de iOS, explicado.
    const iOS = leerPasos('Mozilla/5.0 (iphone)')[0].cardBody();
    ok('2d · 🔑 en iPhone se explica el botón de COMPARTIR', /Compartir/i.test(iOS));
    ok('2e · y que tiene que ser Safari', /Safari/i.test(iOS));
    ok('2f · y que se abre a pantalla completa, sin barra del navegador',
        /pantalla completa/i.test(iOS) && /barra del navegador/i.test(iOS));

    const andr = leerPasos('Mozilla/5.0 (android)')[0].cardBody();
    ok('2g · en Android se explica el aviso de Chrome y el plan B de los ⋮',
        /Instalar Chronos/i.test(andr) && /⋮/.test(andr) && /pantalla de inicio/i.test(andr));

    ok('2h · existe un paso propio para crear la cuenta',
        PASOS.some(p => /cuenta/i.test(p.sideLabel)), PASOS.map(p => p.sideLabel));
}

console.log('\n── PARTE 3 · nada de cupos escritos a mano en los textos ──');
{
    // 🔑 Los cupos de convocatoria tienen UNA definición
    //    (`cronosCupoConvocatoria`, js/core/utils.js) y ya están copiados en
    //    más sitios de la cuenta. Un texto de ayuda con cifras sería una
    //    copia más — y la que nadie recordaría actualizar. De hecho la que
    //    había MENTÍA: decía "máx. 18 en F7" cuando el tope real son 14.
    const textos = PASOS.map(p => p.stepDesc + ' ' + p.cardBody()).join(' ');
    const sospechosos = textos.match(/m[áa]x\.?\s*\d+|hasta\s+\d+\s+convocad|\d+\s*(jugadores)?\s*(en|para)\s*F(7|11)/gi) || [];
    ok('3a · 🔑 ningún texto fija a mano el cupo de convocatoria',
        sospechosos.length === 0, sospechosos);
    ok('3b · y se remite a lo que muestra la pantalla',
        /cuántos puedes llevar|te va diciendo/i.test(textos));
}

console.log('\n── PARTE 4 · estabilidad: nadie desmonta el asistente ──');
{
    ok('4a · index.html publica el interruptor _cronosOnboardingAbierto',
        /window\._cronosOnboardingAbierto\s*=\s*function/.test(INDEX));
    ok('4b · se enciende al mostrar el asistente y se apaga en goToAuth',
        /_obAbierto\s*=\s*true/.test(INDEX) && /_obAbierto\s*=\s*false/.test(INDEX));

    // 🔴 LA RAMA QUE ARRANCABA AL USUARIO. Se mira el CUERPO del else de
    //    "no hay usuario" en onAuthStateChanged.
    const iElse = FBINIT.indexOf('_asistenteAbierto');
    ok('4c · 🔑 firebase-init consulta el interruptor antes de mostrar el login',
        iElse !== -1);
    const bloque = iElse === -1 ? '' : FBINIT.slice(iElse, iElse + 1200);
    ok('4d · ⚠️ y falla hacia MOSTRAR el login si el interruptor no existe',
        /typeof window\._cronosOnboardingAbierto === 'function'/.test(bloque),
        'sin la guarda typeof, un index.html viejo dejaría al usuario sin pantalla de acceso');
    ok('4e · sólo se salta el cambio de pantalla cuando el asistente está abierto',
        /if \(!_asistenteAbierto\)/.test(bloque));

    // 🔴 EL DESTELLO DE ENTRADA: la decisión no puede colgar sólo de `load`.
    ok('4f · 🔑 la pantalla inicial se decide sin esperar a load',
        /_obDecidirPantalla\(\);/.test(INDEX));
    ok('4g · y `load` se conserva como red de seguridad',
        /addEventListener\('load', _obDecidirPantalla\)/.test(INDEX));
    ok('4h · la decisión es idempotente (no se pinta dos veces)',
        /_obYaDecidido/.test(INDEX));

    // Si la decisión temprana revienta, no puede dejar la pantalla en blanco.
    ok('4i · ⚠️ un fallo al decidir se registra y deja pasar al login',
        /catch \(e\)[\s\S]{0,220}_obYaDecidido = false/.test(INDEX));
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);
