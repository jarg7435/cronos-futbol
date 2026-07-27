// ─────────────────────────────────────────────────────────────────────────
// test_report_engine_module.js · Refactor de monolitos (auditoría 2026-07-22)
// MONOLITO #2 (js/coach/reports/club-reports.js), PASO 4 de 6: extracción del
// "MOTOR DE INFORMES VISUAL" (_RP) a js/coach/reports/report-engine.js.
//
// Escrito y ejecutado EN VERDE contra el código todavía SIN mover (Puerta 3).
//
// ── POR QUÉ ESTE MÓDULO ES DISTINTO A LOS TRES ANTERIORES ──
//  · Es una FUNCIÓN PURA: 682 líneas sin una sola referencia a window,
//    document, console, escapeHtml, _sdFS ni try/catch. Recibe (matchData,
//    currentUser) y devuelve un string de HTML. La parte 1d lo demuestra
//    cargándolo en un sandbox DESNUDO (sólo built-ins) en vez de suponerlo.
//  · Es un `const` de nivel superior, NO una propiedad de window. Vive en el
//    entorno léxico global, compartido entre scripts clásicos.
//
// ── ⚠️ EL RIESGO ESTÁ CONCENTRADO EN UN ÚNICO PUNTO ──
// Dos `const _RP` en el ámbito léxico global NO son un "last script wins":
// son `SyntaxError: Identifier '_RP' has already been declared`, y ese error
// ABORTA EL SCRIPT COMPLETO. Si la extracción dejara la declaración en los dos
// ficheros, club-reports.js no se cargaría en absoluto y el Panel de Dirección
// desaparecería. La parte 1g lo fija: sólo puede existir UNA declaración en
// todo el repo.
//
// ── ORDEN DE CARGA: AL CONTRARIO QUE LOS PASOS 1-3 ──
// report-engine.js se carga ANTES de club-reports.js, no después. Motivo:
// el consumidor de comms/ (miToggleInforme, hoy en comms/individual-reports.js
// tras el paso 3 del monolito #3) comprueba `typeof _RP !== 'undefined'`, y para un const
// en su zona muerta temporal `typeof` LANZA ReferenceError en lugar de
// devolver 'undefined' — la guarda es ilusoria. Hoy es inocuo porque sólo
// corre al hacer click, cuando ya está inicializado; cargar el motor antes
// reduce esa ventana en lugar de agrandarla. NO promover a window._RP: eso
// arreglaría la guarda, pero es un cambio de comportamiento ajeno al refactor.
// La parte 1h aserta el orden en ESA dirección; no "corregirlo" por simetría
// con los otros tres módulos.
//
// ── ✅ BUG DE DURACIONES: ENCONTRADO AQUÍ, CORREGIDO EL 2026-07-27 ──
// Al escribir este test se descubrió que la rama de prebenjamín era
// INALCANZABLE ('prebenjamin' contiene 'benjamin' y se comprobaba después).
// Al ir a corregirlo se vio que el problema era mayor: la tabla entera estaba
// mal en 5 de las 7 categorías, medido contra la duración real que usa el
// cronómetro (js/core/setup-modal.js, half1MaxTime/half2MaxTime):
//     prebenjamín −10   benjamín −20   alevín −10   infantil −10   cadete +10
// Sólo juvenil y regional acertaban, por casualidad. Es decir: "arreglar"
// prebenjamín a 40, como suponía la auditoría, lo habría dejado a −20.
// La duración oficial confirmada por el autor es 2 × los minutos por tiempo:
//     prebenjamín 60 · benjamín 70 · alevín 70 · infantil 80 · cadete 80 ·
//     juvenil 90 · regional 90.
// El margen del cronómetro (+10 F7 / +15 F11) es prolongación y protección
// ante cortes de conexión: no entra en la base reglamentaria y ya se muestra
// aparte como +N' (parte 2h).
// ESTO NO ES SÓLO LA ESCALA DEL GANTT: un jugador sin cambios se acredita el
// intervalo [0, totMin] entero, así que la tabla fija los minutos que se
// muestran a cada jugador. Y `window.matchDuration` no se asigna en ningún
// sitio del proyecto, así que `m.duration` viene siempre vacío y esta tabla se
// usa SIEMPRE. La parte 2b recorre las siete categorías con los slugs reales
// ('f7_prebenjamin'…) y con las etiquetas acentuadas; 2d/2e son el cortafuegos
// contra reordenar las comprobaciones y reintroducir el bug.
//
// ── OTRO DETALLE QUE CONVIENE SABER ──
// `esc` (el escapador propio del motor) NO coincide con el escapeHtml global:
// usa &#39; para la comilla simple (no &#039;) y NO escapa "/". Parte 7a/7b.
// Y `build` MUTA su argumento: escribe m.participantsCount (parte 3e).
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ORIGIN = path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js');
const EXTRACTED = path.join(ROOT, 'js', 'coach', 'reports', 'report-engine.js');
const IS_EXTRACTED = fs.existsSync(EXTRACTED);
const SOURCE = IS_EXTRACTED ? EXTRACTED : ORIGIN;

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + JSON.stringify(extra)); }
};

console.log('── Motor de Informes (_RP) — fuente: ' + path.relative(ROOT, SOURCE) + ' ──\n');

// ═══════════════════════ Extracción del bloque ═════════════════════════════
function readBlock() {
    const src = fs.readFileSync(SOURCE, 'utf8');
    const s = src.indexOf('const _RP = (() => {');
    if (s === -1) throw new Error('No se encontró _RP en ' + SOURCE);
    const e = src.indexOf('\n})();', s);
    if (e === -1) throw new Error('No se encontró el cierre del IIFE');
    return src.slice(s, e + 6);
}
const BLOCK = readBlock();

// SANDBOX DESNUDO: ni window, ni document, ni console. Si el motor necesitara
// cualquiera de ellos, esto reventaría — que es justo lo que queremos saber.
function loadRP() {
    const sb = { Math, Array, Object, String, Number, JSON, Date, Map, Set, parseInt, parseFloat, isNaN };
    vm.createContext(sb);
    vm.runInContext(BLOCK + '\nthis.__rp = _RP;', sb);
    return sb.__rp;
}

const idxOf = (s, sub) => s.indexOf(sub);
const MARK = {
    timelines: 'Tiempos de partido · Línea individual por jugador',
    legend: 'En campo',
    summary: '⏱ Tiempo jugado por jugador',
    rot: 'Panel de rotaciones · Quién por quién',
    events: 'Registro cronológico de incidencias',
};

// Jugador mínimo que SIEMPRE cuenta como participante (titular sin historial).
const titular = (alias, num, extra) => Object.assign(
    { playerAlias: alias, playerNumber: String(num), titular: true, history: [] }, extra);
const suplente = (alias, num, extra) => Object.assign(
    { playerAlias: alias, playerNumber: String(num), history: [] }, extra);
const ev = (type, minute, extra) => Object.assign({ type, minute, second: 0 }, extra);

const build = (players, m, me) => {
    const RP = loadRP();
    const match = Object.assign({ players, rival: 'Rival FC', scoreHome: 1, scoreAway: 0 }, m || {});
    return { html: RP.build(match, me === undefined ? { clubName: 'CD Test' } : me), match };
};

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
}

(async () => {
    // ═════════════════════════════════════════════════════════════════════
    console.log('── PARTE 1 · autocontención, declaración y orden de carga ──');
    ok('1a · es un const de nivel superior, NO window._RP',
        /^const _RP = \(\(\) => \{/m.test(BLOCK) && !/window\._RP\s*=/.test(BLOCK));
    ok('1b · expone únicamente build', /return \{ build \};/.test(BLOCK)
        && Object.keys(loadRP()).join(',') === 'build', Object.keys(loadRP()));
    ok('1c · cero window / document / console / try en las 682 líneas',
        !/\bwindow\./.test(BLOCK) && !/\bdocument\./.test(BLOCK)
        && !/\bconsole\./.test(BLOCK) && !/\btry\s*\{/.test(BLOCK));
    {
        // Demostración, no suposición: carga y produce HTML sin window/document/console.
        let okBare = false, len = 0;
        try {
            const { html } = build([titular('Ana', 1), titular('Luis', 7)]);
            len = html.length; okBare = typeof html === 'string' && len > 500;
        } catch (e) { okBare = false; len = String(e.message); }
        ok('1d · carga y genera HTML en un sandbox DESNUDO (sólo built-ins)', okBare, len);
    }
    {
        // Se excluyen del recuento de CONSUMIDORES los ficheros que sólo
        // NOMBRAN _RP en comentarios o manifiestos: sw.js (changelog + precache)
        // e index.html (el comentario que explica por qué el <script> va antes).
        // Mismo falso positivo que ya nos mordió con el changelog de sw.js.
        const skip = new Set([SOURCE, path.join(ROOT, 'sw.js'), path.join(ROOT, 'index.html')]
            .map(p => path.resolve(p)));
        const decls = [], users = [];
        for (const f of walk(ROOT, [])) {
            const abs = path.resolve(f);
            if (path.relative(ROOT, f).replace(/\\/g, '/').startsWith('scripts/')) continue;
            const txt = fs.readFileSync(f, 'utf8');
            const rel = path.relative(ROOT, f).replace(/\\/g, '/');
            if (/(^|\n)\s*(const|let|var)\s+_RP\s*=/.test(txt)) decls.push(rel);
            // Sólo cuenta como CONSUMIDOR quien lo nombra en código. Los
            // comentarios-puntero que dejó el refactor (p. ej. el de
            // club-reports.js apuntando a report-engine.js) mencionan _RP.build()
            // y no deben contar. OJO: .trim() antes de recortar el comentario,
            // porque los ficheros son CRLF y en una regex el punto no consume
            // el retorno de carro.
            const code = txt.split('\n')
                .map(l => l.trim().replace(/\/\/.*$/, ''))
                .join('\n');
            if (!skip.has(abs) && /\b_RP\b/.test(code)) users.push(rel);
        }
        // ⚠️ EL ASSERT CRÍTICO: dos declaraciones = SyntaxError que aborta el script.
        ok('1g · ⚠️ existe EXACTAMENTE UNA declaración de _RP en todo el repo',
            decls.length === 1, decls);
        // Tras el paso 5 el consumidor de club-reports.js (_sdLoadReports) se
        // mudó a reports-tab.js; en club-reports.js sólo queda el puntero.
        const consumer = fs.existsSync(path.join(ROOT, 'js', 'coach', 'reports', 'reports-tab.js'))
            ? 'js/coach/reports/reports-tab.js'
            : 'js/coach/reports/club-reports.js';
        // Y tras el paso 3 del monolito #3, el consumidor de comms/panel.js
        // (miToggleInforme, dentro de openMisInformes) se mudó a
        // comms/individual-reports.js; en panel.js sólo queda el puntero, que
        // deliberadamente NO nombra _RP para no falsear este barrido.
        const commsConsumer = fs.existsSync(path.join(ROOT, 'js', 'coach', 'comms', 'individual-reports.js'))
            ? 'js/coach/comms/individual-reports.js'
            : 'js/coach/comms/panel.js';
        const expected = IS_EXTRACTED
            ? [commsConsumer, consumer]
            : [commsConsumer];
        ok('1e · los consumidores son los esperados',
            JSON.stringify(users.sort()) === JSON.stringify(expected.sort()), users);
        const cp = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', commsConsumer.split('/').pop()), 'utf8');
        ok('1f · el consumidor de comms/ usa la guarda typeof (ilusoria para un const en TDZ)',
            /typeof _RP !== 'undefined' && typeof _RP\.build === 'function'/.test(cp));
    }
    if (IS_EXTRACTED) {
        const idxHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const engine = idxOf(idxHtml, 'js/coach/reports/report-engine.js');
        const reports = idxOf(idxHtml, 'js/coach/reports/club-reports.js');
        // OJO: ANTES, no después. Ver la cabecera de este archivo.
        ok('1h · report-engine.js se carga ANTES de club-reports.js (a propósito)',
            engine !== -1 && reports !== -1 && engine < reports, { engine, reports });
        ok('1i · está en el precache de sw.js',
            fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes('js/coach/reports/report-engine.js'));
        ok('1j · está en la lista de _check_syntax.js',
            fs.readFileSync(path.join(ROOT, 'scripts', '_check_syntax.js'), 'utf8')
                .includes('js/coach/reports/report-engine.js'));
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 2 · getTotMin: duración del partido ──');
    // Observable en la cabecera como `${totMin}'` y en el resumen como MM:SS
    // del titular sin historial (su _tot es exactamente totMin).
    // La duración se lee de la CABECERA (`${totMin}'`, la primera aparición).
    // No vale un `includes("40'")` a secas: el Gantt dibuja etiquetas de eje
    // (10' 20' 30'...) que también terminan en apóstrofo.
    const headerDur = (m) => {
        const html = build([titular('Solo', 9)], m).html;
        const hit = html.match(/>(\d{2,3})'/);
        return hit ? Number(hit[1]) : null;
    };
    ok('2a · m.duration manda sobre la categoría',
        headerDur({ duration: 45, category: 'Cadete' }) === 45, headerDur({ duration: 45, category: 'Cadete' }));
    // ── La tabla oficial: 2 × los minutos por tiempo del cronómetro ──────
    // Confirmada por el autor 2026-07-27. Estos valores TIENEN que coincidir
    // con js/core/setup-modal.js, donde se fijan half1MaxTime/half2MaxTime; si
    // alguien cambia una de las dos tablas, tiene que cambiar la otra.
    // Se prueban los SLUGS que de verdad se guardan en los informes
    // (window._currentMatchCategory = el value del <select>, p.ej.
    // 'f7_prebenjamin') Y las etiquetas acentuadas, porque los informes
    // antiguos o importados pueden traerlas.
    {
        const OFICIAL = [
            ['f7_prebenjamin', 60], ['Prebenjamín', 60], ['prebenjamin', 60], ['PREBENJAMIN', 60],
            ['f7_benjamin', 70],    ['Benjamín', 70],
            ['f7_alevin', 70],      ['Alevín', 70],
            ['f11_infantil', 80],   ['Infantil A', 80],
            ['f11_cadete', 80],     ['Cadete', 80],
            ['f11_juvenil', 90],    ['Juvenil', 90],
            ['f11_regional', 90],   ['Regional', 90],  ['Senior', 90],
        ];
        const malos = OFICIAL.filter(([c, esperado]) => headerDur({ category: c }) !== esperado)
                             .map(([c, esperado]) => c + ': ' + headerDur({ category: c }) + ' (esperado ' + esperado + ')');
        ok('2b · la duración de las 7 categorías coincide con la oficial (2 × tiempo)',
            malos.length === 0, malos);
    }
    ok('2c · una categoría desconocida o ausente cae a 60',
        headerDur({ category: 'Veteranos' }) === 60 && headerDur({}) === 60);
    // ⚠️ LA TRAMPA QUE CAUSÓ EL BUG: 'prebenjamin' CONTIENE 'benjamin'. Si
    // alguien reordena las comprobaciones, prebenjamín vuelve a resolverse como
    // benjamín (70 en vez de 60). Esta aserción es el cortafuegos.
    ok('2d · ⚠️ prebenjamín NO se resuelve como benjamín pese a contener su nombre',
        headerDur({ category: 'f7_prebenjamin' }) === 60
        && headerDur({ category: 'f7_benjamin' }) === 70
        && headerDur({ category: 'f7_prebenjamin' }) !== headerDur({ category: 'f7_benjamin' }),
        { pre: headerDur({ category: 'f7_prebenjamin' }), ben: headerDur({ category: 'f7_benjamin' }) });
    ok('2e · y el orden de las comprobaciones lo garantiza en el propio código',
        BLOCK.indexOf("cat.includes('prebenjamin')") < BLOCK.indexOf("cat.includes('benjamin')"));
    ok('2f · las tres grafías de prebenjamín dan lo mismo',
        headerDur({ category: 'Prebenjamín' }) === 60
        && headerDur({ category: 'prebenjamin' }) === 60
        && headerDur({ category: 'PREBENJAMIN' }) === 60,
        ['Prebenjamín', 'prebenjamin', 'PREBENJAMIN'].map(c => headerDur({ category: c })));
    // OJO: si m.duration es truthy pero no parseable, devuelve 60 DIRECTAMENTE;
    // no cae a la categoría (el `return parseInt(...) || 60` corta ahí).
    ok('2g · duration no numérico devuelve 60 sin consultar la categoría',
        headerDur({ duration: 'abc', category: 'Infantil' }) === 60,
        headerDur({ duration: 'abc', category: 'Infantil' }));
    ok('2g-bis · duration 0 sí cae a la categoría (0 es falsy)',
        headerDur({ duration: 0, category: 'Cadete' }) === 80,
        headerDur({ duration: 0, category: 'Cadete' }));
    const htmlOf = (m) => build([titular('Solo', 9)], m).html;
    ok('2h · el tiempo de descuento se muestra aparte',
        htmlOf({ duration: 60, stoppageTime: 4 }).includes("+4'"));
    ok('2i · el titular sin historial acumula todo el partido',
        htmlOf({ duration: 90 }).includes('90:00'));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 3 · selección, orden y mutación ──');
    {
        const largo = titular('Largo', 5, { history: [ev('sub_out', 20), ev('sub_in', 30)] });
        const corto = titular('Corto', 5, { history: [] });
        const { html } = build([corto, largo], { duration: 60 });
        ok('3a · deduplica por dorsal quedándose con el de historial más largo',
            html.includes('Largo') && !html.includes('Corto'));
    }
    {
        const { html } = build([titular('Jugo', 4), suplente('NoJugo', 8)], { duration: 60 });
        ok('3b · descarta a quien no jugó ni fue convocado',
            html.includes('Jugo') && !html.includes('NoJugo'));
    }
    {
        const { html } = build([titular('Jugo', 4), suplente('Banca', 8, { convocado: true })], { duration: 60 });
        ok('3c · conserva al convocado aunque no tenga minutos', html.includes('Banca'));
    }
    {
        const { html } = build([titular('Diez', 10), titular('Dos', 2), titular('SinDorsal', '')], { duration: 60 });
        ok('3d · ordena por dorsal y los sin dorsal van al final (99)',
            idxOf(html, MARK.timelines) > 0
            && idxOf(html, 'Dos') < idxOf(html, 'Diez'), { dos: idxOf(html, 'Dos'), diez: idxOf(html, 'Diez') });
    }
    {
        const { html, match } = build([titular('A', 1), titular('B', 2), suplente('C', 3)], { duration: 60 });
        ok('3e · ⚠️ build MUTA su argumento escribiendo m.participantsCount',
            match.participantsCount === 2, match.participantsCount);
        ok('3e-bis · y sólo cuenta a los participantes reales', !html.includes('>C<'));
    }
    {
        let threw = null;
        try { loadRP().build({ rival: 'X' }, {}); } catch (e) { threw = e.constructor.name; }
        ok('3f · sin m.players lanza TypeError (no hay guarda)', threw === 'TypeError', threw);
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 4 · buildIvs: reconstrucción de intervalos ──');
    const timeOf = (player, m) => build([player], Object.assign({ duration: 60 }, m || {})).html;
    ok('4a · titular sin historial → todo el partido',
        timeOf(titular('T', 1)).includes('60:00'));
    ok('4b · suplente que entra en el 10 → 50 minutos',
        timeOf(suplente('S', 2, { history: [ev('sub_in', 10)] })).includes('50:00'));
    ok('4c · titular que sale en el 20 → 20 minutos',
        timeOf(titular('T', 3, { history: [ev('sub_out', 20)] })).includes('20:00'));
    ok('4d · sale y vuelve → suma de los dos tramos (20 + 20 = 40)',
        timeOf(titular('T', 4, { history: [ev('sub_out', 20), ev('sub_in', 40)] })).includes('40:00'));
    ok('4e · sub_in y sub_out simultáneos se anulan (cambio de posición)',
        timeOf(titular('T', 5, { history: [ev('sub_in', 30), ev('sub_out', 30)] })).includes('60:00'));
    ok('4f · status:"field" cuenta como titularidad',
        timeOf(suplente('S', 6, { status: 'field', history: [ev('sub_out', 25)] })).includes('25:00'));
    ok('4g · initialStatus:"field" también',
        timeOf(suplente('S', 7, { initialStatus: 'field', history: [ev('sub_out', 15)] })).includes('15:00'));
    ok('4h · los segundos cuentan en el cálculo',
        timeOf(titular('T', 8, { history: [ev('sub_out', 20, { second: 30 })] })).includes('20:30'));
    ok('4i · si el primer evento es sub_out se asume que empezó en campo',
        timeOf(suplente('S', 9, { history: [ev('sub_out', 12)] })).includes('12:00'));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 5 · getExactTime: prioridad del cronómetro ──');
    ok('5a · minutesPlayed en formato "MM:SS" se usa tal cual',
        timeOf(titular('T', 1, { minutesPlayed: '37:42' })).includes('37:42'));
    ok('5b · minutesPlayed numérico se interpreta en SEGUNDOS',
        timeOf(titular('T', 2, { minutesPlayed: 3725 })).includes('62:05'));
    ok('5c · p.time se interpreta en segundos cuando no hay minutesPlayed',
        timeOf(titular('T', 3, { time: 125 })).includes('02:05'));
    ok('5d · sin ninguno de los dos, cae al total calculado del historial',
        timeOf(titular('T', 4, { history: [ev('sub_out', 33)] })).includes('33:00'));
    {
        const { html } = build([
            titular('Poco', 1, { minutesPlayed: '10:00' }),
            titular('Mucho', 2, { minutesPlayed: '80:00' }),
            titular('Medio', 3, { minutesPlayed: '45:00' }),
        ], { duration: 90 });
        const tail = html.slice(idxOf(html, MARK.summary));
        ok('5e · el resumen ordena por tiempo jugado descendente',
            idxOf(tail, 'Mucho') < idxOf(tail, 'Medio') && idxOf(tail, 'Medio') < idxOf(tail, 'Poco'),
            { mucho: idxOf(tail, 'Mucho'), medio: idxOf(tail, 'Medio'), poco: idxOf(tail, 'Poco') });
    }

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 6 · buildSubs: quién por quién ──');
    const rotOf = (players, m) => {
        const { html } = build(players, Object.assign({ duration: 60 }, m || {}));
        return html.includes(MARK.rot) ? html.slice(idxOf(html, MARK.rot)) : '';
    };
    {
        const rot = rotOf([
            titular('Ana', 5, { history: [ev('sub_out', 20, { subId: 7, timeStr: '20:00' })] }),
            suplente('Bea', 12, { history: [ev('sub_in', 20, { subId: 7, timeStr: '20:00' })] }),
        ]);
        ok('6a · empareja salida y entrada por subId',
            /▲<\/span> Ana/.test(rot) && /▼<\/span> Bea/.test(rot), rot.slice(0, 0) || rot.length);
    }
    {
        const rot = rotOf([
            titular('Ana', 5, { history: [ev('sub_out', 25)] }),
            suplente('Bea', 12, { history: [ev('sub_in', 25)] }),
        ]);
        ok('6b · sin subId empareja por proximidad temporal',
            /▲<\/span> Ana/.test(rot) && /▼<\/span> Bea/.test(rot));
    }
    {
        // Dos cambios en el MISMO minuto con subIds cruzados: la proximidad sola
        // emparejaría mal; el subId lo resuelve con exactitud.
        const rot = rotOf([
            titular('Ana', 5, { history: [ev('sub_out', 30, { subId: 1 })] }),
            titular('Bea', 6, { history: [ev('sub_out', 30, { subId: 2 })] }),
            suplente('Carla', 12, { history: [ev('sub_in', 30, { subId: 2 })] }),
            suplente('Dani', 13, { history: [ev('sub_in', 30, { subId: 1 })] }),
        ]);
        const anaRow = rot.slice(idxOf(rot, 'Ana'), idxOf(rot, 'Ana') + 400);
        const beaRow = rot.slice(idxOf(rot, 'Bea'), idxOf(rot, 'Bea') + 400);
        ok('6c · con dos cambios en el mismo minuto, el subId empareja correctamente',
            anaRow.includes('Dani') && beaRow.includes('Carla'),
            { ana: anaRow.includes('Dani'), bea: beaRow.includes('Carla') });
    }
    {
        // El mismo jugador sale y entra casi a la vez: NO puede emparejarse consigo.
        const rot = rotOf([
            titular('Ana', 5, { history: [ev('sub_out', 20), ev('sub_in', 20, { second: 2 })] }),
        ]);
        ok('6d · nunca empareja a un jugador consigo mismo → "banquillo"',
            rot.includes('banquillo'), rot.length);
    }
    {
        const rot = rotOf([titular('Ana', 5, { history: [ev('sub_out', 20)] })]);
        ok('6e · una salida sin entrada libre muestra "banquillo"', rot.includes('banquillo'));
    }
    {
        const rot = rotOf([
            titular('Ana', 5, { history: [ev('sub_out', 40)] }),
            suplente('Bea', 12, { history: [ev('sub_in', 10), ev('sub_out', 20), ev('sub_in', 40)] }),
        ]);
        ok('6f · marca el regreso de un jugador con su nº de período',
            rot.includes('Regresa · 2º per.'), rot.slice(0, 0) || rot.includes('Regresa'));
    }
    {
        const rot = rotOf([
            titular('Ana', 5, { history: [ev('sub_out', 30), ev('injury', 30)] }),
            suplente('Bea', 12, { history: [ev('sub_in', 30)] }),
        ]);
        ok('6g · marca la sustitución por lesión', rot.includes('Lesión'));
    }
    {
        const rot = rotOf([
            titular('Ana', 5, { history: [ev('sub_out', 20), ev('sub_in', 40)] }),
            suplente('Bea', 12, { history: [ev('sub_in', 20)] }),
        ]);
        ok('6h · indica el período del jugador que sale cuando tiene varios',
            rot.includes('º per.)'), rot.includes('per.'));
    }
    ok('6i · sin sustituciones, el panel de rotaciones no se pinta',
        !build([titular('Solo', 1)], { duration: 60 }).html.includes(MARK.rot));

    // ═════════════════════════════════════════════════════════════════════
    console.log('\n── PARTE 7 · escapado, composición y eventos ──');
    {
        const { html } = build([titular('T', 1)], { rival: `A&B <i> "x" 'y' a/b` });
        ok('7a · esc escapa & < > " y la comilla simple como &#39; (NO &#039;)',
            html.includes('A&amp;B &lt;i&gt; &quot;x&quot; &#39;y&#39;')
            && !html.includes('&#039;y&#039;'));
        ok('7b · esc NO escapa la barra "/" (a diferencia del escapeHtml global)',
            html.includes('a/b'));
    }
    {
        const { html } = build([titular(`Ana <b>'x'`, 5, { history: [ev('sub_out', 20)] })], { duration: 60 });
        ok('7c · los nombres de jugador también se escapan',
            html.includes('Ana &lt;b&gt;&#39;x&#39;'));
    }
    {
        const { html } = build([titular('T', 1, { history: [ev('goal', 10), ev('yellow', 20)] })], { duration: 60 });
        ok('7d · orden de composición: cabecera → timelines → leyenda → resumen → rotaciones → eventos',
            idxOf(html, MARK.timelines) < idxOf(html, MARK.legend)
            && idxOf(html, MARK.legend) < idxOf(html, MARK.summary)
            && idxOf(html, MARK.summary) < idxOf(html, MARK.events),
            { t: idxOf(html, MARK.timelines), l: idxOf(html, MARK.legend),
              s: idxOf(html, MARK.summary), e: idxOf(html, MARK.events) });
        ok('7e · registra los eventos relevantes en la lista cronológica',
            html.includes(MARK.events));
    }
    ok('7f · sin eventos relevantes, la lista cronológica no se pinta',
        !build([titular('Solo', 1)], { duration: 60 }).html.includes(MARK.events));
    {
        const { html } = build([titular('T', 1)], {}, { clubName: 'CD Mío' });
        ok('7g · usa el clubName del usuario en la cabecera', html.includes('CD Mío'));
    }
    {
        const { html } = build([titular('T', 1)], {}, null);
        ok('7h · sin usuario cae a "CD Local"', html.includes('CD Local'));
    }
    {
        const { html } = build([titular('T', 1)], { rival: '' });
        ok('7i · sin rival cae a "Sin rival"', html.includes('Sin rival'));
    }
    {
        const { html } = build([titular('T', 1)], { scoreHome: 3, scoreAway: 2 });
        ok('7j · el marcador aparece en la cabecera',
            html.includes('3') && html.includes('2') && html.length > 1000);
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
