// ════════════════════════════════════════════════════════════════════════════
//  v602 · La sección única "⚽ Mi Equipo" del panel del ente — EJECUTADA
//
//  🔑 POR QUÉ ESTE FICHERO EXISTE. La PARTE 10 de test_ente_individual_unificado
//  comprueba por regex que la unificación está ESCRITA. Eso no dice si FUNCIONA:
//  una sección que se construye a partir de plazas y de un índice puede
//  compilar perfectamente y aun así dejar un equipo sin entrenador, tragarse a
//  un padre o duplicar una fila. Aquí se recorta el bloque real de panel.js y
//  se EJECUTA en un vm con datos de verdad.
//
//  ⚠️ EL RECORTE ES LITERAL, del fichero vivo: si alguien renombra una variable
//  del bloque, este guard se cae y hay que mirarlo — que es justo lo que se
//  quiere. Lo que se simula alrededor son las piezas que YA tienen su propio
//  guard (el índice, la fila HTML, el validador de equipos).
// ════════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js', 'admin', 'individual', 'panel.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (nombre, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + nombre); }
    else { fail++; console.log('  ✗ ' + nombre + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

// ── Recorte del bloque real ─────────────────────────────────────────────────
// ⚠️ v685 · El recorte empieza en `_normalizaEquipo`, no en `_misEquiposNorm`:
//    la normalización se extrajo a su propia función para que la compartan los
//    equipos activos y los que esperan al SuperAdmin.
const ini = SRC.indexOf('    const _normalizaEquipo = (r) => {');
const finMarca = '        (_secOtros ? \'<div style="margin-top:0.6rem;">\' + _secOtros + \'</div>\' : \'\');';
const fin = SRC.indexOf(finMarca);
if (ini < 0 || fin < 0) {
    console.error('ERROR FATAL: no se localiza el bloque de la sección "Mi Equipo" en panel.js');
    process.exit(1);
}
const BLOQUE = SRC.slice(ini, fin + finMarca.length);

// ── Escenario: el ente lleva DOS equipos, guardados con los DOS formatos
//    históricos de categoría (uno 'alevin'+'A', otro 'infantil_b' de una pieza).
function correr(escenario) {
    const uid = 'DUENO';
    const _misEquipos = escenario.misEquipos;
    const filas = escenario.filas;          // [{_id, email, _activeRoleData}]

    // Índice cat|sub -> filas, igual que _buildIndIndex
    const byCatSub = new Map();
    filas.forEach(f => {
        const r = f._activeRoleData || {};
        const cat = String(r.category || '').toLowerCase().replace(/_[abc]$/, '');
        let sub = String(r.subcategory || '').toUpperCase();
        if (!sub) { const m = String(r.category || '').match(/_([abc])$/i); if (m) sub = m[1].toUpperCase(); }
        if (!cat || !sub) return;                       // el índice real también los descarta
        if (!byCatSub.has(cat)) byCatSub.set(cat, new Map());
        const sm = byCatSub.get(cat);
        if (!sm.has(sub)) sm.set(sub, []);
        sm.get(sub).push(f);
    });

    const sandbox = {
        console,
        Map, Set, String, Array, Object, RegExp,
        uid,
        me: { uid, email: 'dueno@ente.es' },
        userData: { firstName: 'Ana', lastName: 'Ruiz' },
        _misEquipos,
        sortedUsers: filas,
        _indIdx: { byCatSub, catHasAny: new Set(), subHasAny: new Set() },
        _IND_COACH: new Set(['user', 'entrenador_individual', 'individual', 'admin_individual']),
        // 🔢 v684 · El bloque recortado ahora CUENTA además de pintar, y para
        //    separar entrenadores de familias necesita las dos listas. Antes
        //    sólo usaba `_IND_COACH`.
        _IND_PARENT: new Set(['parent', 'parent_individual']),
        _MOD_LBL: { f7: 'Fútbol 7', f11: 'Fútbol 11' },
        _indModalidad: (c) => (/prebenjamin|benjamin|alevin/.test(String(c)) ? 'f7' : 'f11'),
        _indCatLabel: (c, s) => c + ' ' + s,
        _eH: (s) => String(s == null ? '' : s),
        // ⚠️ v684 · YA NO SE SIMULA `statsHTML`. El cuadro de cifras se declara
        //    DENTRO del bloque recortado desde la v684 (necesita las filas que
        //    el bloque construye), así que un `statsHTML` de sandbox quedaría
        //    sombreado y este guard estaría midiendo un marcador muerto. Se
        //    busca el cuadro REAL por su etiqueta.
        _secMisEquipos: '<!--GESTION-->',
        // Las otras dos cifras del cuadro se calculan mucho más arriba, fuera
        // del recorte: aquí sólo tienen que existir para que pinte.
        totalPending: 0,
        blockedParents: [],
        // ⏳ v685 · Los equipos que esperan al SuperAdmin. El escenario por
        //    defecto no tiene ninguno; la parte 15 los prueba aparte.
        _misEquiposPend: escenario.pendientes || [],
        // La fila real ya tiene su guard; aquí sólo hace falta poder RECONOCERLA.
        _indRowHeaderHtml: () => '<!--HEAD-->',
        _indUserRowHtml: (u) => '<!--FILA:' + (u._id || u.uid) + ':'
            + ((u._activeRoleData || {}).role || '') + '-->',
    };
    vm.createContext(sandbox);
    // ⚠️ UN `const` DEL BLOQUE NO SE VE DESDE FUERA. En un vm las declaraciones
    //    léxicas de nivel superior viven en el registro DECLARATIVO del ámbito,
    //    no como propiedad del objeto de contexto — la misma trampa que el
    //    proyecto ya documentó con `window.X = window.X || X`. Por eso el
    //    bloque se cierra con una asignación SIN declarar, que sí aterriza en
    //    el sandbox. Sin esto el test leía `undefined` y no probaba nada.
    vm.runInContext(BLOQUE + '\n;__out = { _misEquiposNorm, _secMiEquipo, _filasHuerfanas };', sandbox);
    return sandbox.__out;
}

const fila = (id, role, category, subcategory) => ({
    _id: id, uid: id, email: id + '@x.es',
    _activeRoleData: { role, category, subcategory, isAuthorized: true, status: 'active' },
});

console.log('── v602 · la sección "Mi Equipo", ejecutada ──');

{
    const s = correr({
        misEquipos: [
            { role: 'individual', category: 'alevin',     subcategory: 'A' },
            { role: 'individual', category: 'infantil_b', subcategory: '' },
        ],
        filas: [
            fila('P1', 'parent', 'alevin', 'A'),
            fila('P2', 'parent', 'alevin_a', ''),
            fila('P3', 'parent', 'infantil', 'B'),
            fila('X9', 'parent', 'juvenil', 'C'),          // categoría que NO es suya
            fila('X8', 'parent', '', ''),                  // sin categoría válida
        ],
    });

    // 1 · las DOS formas de guardar la categoría dan el MISMO equipo.
    ok('1 · normaliza los dos formatos históricos ("alevin"+"A" y "infantil_b")',
        s._misEquiposNorm.length === 2
        && s._misEquiposNorm[0].catId === 'alevin' && s._misEquiposNorm[0].sub === 'A'
        && s._misEquiposNorm[1].catId === 'infantil' && s._misEquiposNorm[1].sub === 'B',
        s._misEquiposNorm.map(e => e.catId + '|' + e.sub));

    ok('2 · y deriva la modalidad de cada uno (F7 y F11)',
        s._misEquiposNorm[0].mod === 'f7' && s._misEquiposNorm[1].mod === 'f11',
        s._misEquiposNorm.map(e => e.mod));

    const html = s._secMiEquipo;

    // 3 · 🔑 UNIFICAR NO ES BORRAR: las tres piezas siguen en la sección.
    ok('3 · 🔑 la sección lleva el resumen, la gestión y las fichas de equipo',
        html.indexOf('⚽ Entrenadores') >= 0
        && html.indexOf('⚽ Entrenadores') < html.indexOf('<!--GESTION-->')
        && html.includes('<!--GESTION-->')
        && html.includes('⚽ Entrenador')
        && html.includes('Familiares / Jugadores'));

    // 3bis · 🔢 Y EL CUADRO DICE LO MISMO QUE LAS FICHAS. Que estas cifras
    //     salgan del mismo bloque que pinta las filas es lo que corrigió la
    //     v684: antes el cuadro contaba aparte y decía 0 entrenadores.
    //     ⚠️ v685 · Y cuenta PLAZAS, no personas: el dueño lleva los dos
    //     equipos de este escenario, así que son 2 — decisión del autor, para
    //     que la cifra se lea contra el badge del tablero, que cuenta equipos.
    ok('3bis · 🔢 el cuadro cuenta 2 (una plaza por equipo, aunque sea el mismo entrenador)',
        />2<\/div><div[^>]*>⚽ Entrenadores/.test(html.replace(/\s*\n\s*/g, '')),
        (html.replace(/\s*\n\s*/g, '').match(/>(\d+)<\/div><div[^>]*>⚽ Entrenadores/) || [])[1]);

    // 4 · 🔑🔑 EL DUEÑO APARECE COMO ENTRENADOR DE SUS DOS EQUIPOS. Ninguna
    //     de las filas de entrada era suya: si no se inyectara, sus dos equipos
    //     saldrían "sin entrenador asignado" — el defecto más visible posible.
    ok('4 · 🔑🔑 el dueño sale como entrenador de sus DOS equipos aunque no esté en la lista',
        (html.match(/<!--FILA:DUENO:individual-->/g) || []).length === 2,
        (html.match(/<!--FILA:DUENO:individual-->/g) || []).length);

    ok('5 · ⚠️ y ningún equipo queda "sin entrenador"',
        !html.includes('no tiene entrenador asignado'));

    // 6 · las familias caen en SU equipo, con los dos formatos.
    ok('6 · 🔑 cada padre cae en su equipo (los dos formatos de categoría)',
        html.includes('<!--FILA:P1:parent-->')
        && html.includes('<!--FILA:P2:parent-->')
        && html.includes('<!--FILA:P3:parent-->'));

    // 7 · ⚠️⚠️ NADIE DESAPARECE. Es lo que puede romper una simplificación así.
    ok('7 · ⚠️⚠️ el de una categoría ajena NO se pierde: va a "Otros usuarios del ente"',
        html.includes('Otros usuarios del ente') && html.includes('<!--FILA:X9:parent-->'));

    ok('8 · ⚠️⚠️ y el que no tiene categoría válida tampoco (el índice lo descartaba)',
        html.includes('<!--FILA:X8:parent-->'));

    // 9 · ⚠️ pero NO se duplica: quien ya está en su equipo no sale además abajo.
    ok('9 · ⚠️ y quien ya está en un equipo no se repite en "Otros"',
        (html.match(/<!--FILA:P1:parent-->/g) || []).length === 1
        && (html.match(/<!--FILA:P3:parent-->/g) || []).length === 1,
        {
            P1: (html.match(/<!--FILA:P1:parent-->/g) || []).length,
            P3: (html.match(/<!--FILA:P3:parent-->/g) || []).length,
        });

    ok('10 · ⚠️ el dueño no aparece en "Otros usuarios" (sus plazas no son huérfanas)',
        html.split('Otros usuarios del ente')[1].indexOf('<!--FILA:DUENO') < 0);
}

{
    // ⚠️ SIN EQUIPOS TODAVÍA: no puede quedarse en blanco ni romper. Es el
    //    estado del ente recién aprobado, o sea el primero que ve un usuario nuevo.
    const s = correr({ misEquipos: [], filas: [fila('P1', 'parent', 'alevin', 'A')] });
    const html = s._secMiEquipo;
    ok('11 · ⚠️ sin equipos asignados sigue pintando resumen y gestión, sin romper',
        html.includes('⚽ Entrenadores') && html.includes('<!--GESTION-->'));
    ok('12 · ⚠️ y el padre suelto no se pierde: cae en "Otros usuarios del ente"',
        html.includes('Otros usuarios del ente') && html.includes('<!--FILA:P1:parent-->'));
}

{
    // ⚠️ Un equipo SIN familias todavía: tiene que decirlo, no salir vacío.
    const s = correr({
        misEquipos: [{ role: 'individual', category: 'cadete', subcategory: 'A' }],
        filas: [],
    });
    const html = s._secMiEquipo;
    ok('13 · ⚠️ un equipo sin familias lo dice en palabras, no se queda mudo',
        html.includes('Todavía no hay familias vinculadas a este equipo.'));
    ok('14 · ⚠️ y no inventa un bloque de "Otros" cuando no hay nadie suelto',
        !html.includes('Otros usuarios del ente'));
}

{
    // ══════════════════════════════════════════════════════════════════
    //  ⏳ v685 · UN EQUIPO ESPERANDO AL SUPERADMIN
    //
    //  Encargo del autor (2026-09-10, punto 4): el ente ya no se autoconcede
    //  el segundo equipo. Mientras espera tiene que VERSE —un equipo que
    //  desapareciera sería indistinguible de un fallo al guardar— pero sin
    //  contar como suyo en ningún sitio.
    // ══════════════════════════════════════════════════════════════════
    const s = correr({
        misEquipos: [{ role: 'individual', category: 'regional', subcategory: 'A' }],
        pendientes: [{ role: 'individual', category: 'prebenjamin', subcategory: 'A',
                       status: 'pending_sa_team', isAuthorized: false }],
        filas: [],
    });
    const html = s._secMiEquipo;
    const plano = html.replace(/\s*\n\s*/g, '');

    // ⚠️ El nombre sale por `_indCatLabel`, que aquí es el simulado del
    //    sandbox ('prebenjamin A'), no el bonito del catálogo.
    ok('15 · ⏳ el equipo pendiente SE VE, con su nombre y marcado como pendiente',
        html.includes('prebenjamin A') && plano.includes('>Pendiente<'),
        { nombre: html.includes('prebenjamin A'), badge: plano.includes('>Pendiente<') });
    ok('16 · ⚠️ y dice en palabras por qué todavía no puede usarlo',
        html.includes('todavía no lo ha aprobado'));
    ok('17 · 🔑🔑 pero NO suma en el cuadro: sigue contando 1 entrenador',
        />1<\/div><div[^>]*>⚽ Entrenadores/.test(plano),
        (plano.match(/>(\d+)<\/div><div[^>]*>⚽ Entrenadores/) || [])[1]);
    ok('18 · ⚠️ y no se le pinta bloque de familias (no es su equipo todavía)',
        (html.match(/Todavía no hay familias vinculadas a este equipo\./g) || []).length === 1);
}

console.log('\n────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
process.exit(fail ? 1 : 0);
