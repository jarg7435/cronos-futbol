// ─────────────────────────────────────────────────────────────────────────
// test_season_reset.js · VACIADO DE TEMPORADA (v436)
//
// El SuperAdmin puede vaciar los datos deportivos de un club CONSERVANDO el
// club y todos sus usuarios. Es lo contrario de saDeleteClubComplete, que hace
// desaparecer el club y libera a sus usuarios — y confundirlos es lo caro:
// las dos acciones viven en el mismo sitio y ninguna tiene deshacer.
//
// ESTE GUARD EJECUTA EL MODULO contra un Firestore de mentira y mira QUE
// CONSULTAS SE HACEN Y QUE SE BORRA. Lo que protege:
//
//  A · TODA consulta va acotada por clubId. Un where que faltara aqui no daria
//      error: borraria los datos de TODOS los clubes de la plataforma, en una
//      accion sin deshacer. Es el defecto mas caro posible en este fichero.
//  B · NO se tocan users ni clubs. Es literalmente lo que distingue esta
//      accion del borrado de club.
//  C · La confirmacion por nombre exacto es la unica barrera contra el clic
//      accidental.
//  D · audit_logs NO aparece: su regla es `allow write: if false`, asi que no
//      lo borra nadie. Ofrecerlo seria ofrecer algo que falla.
//  E · Los vinculos jugador-padre NO vienen marcados: no son datos de
//      temporada sino la estructura que conecta a cada familia con su hijo.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const SRC   = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/season-reset.js'), 'utf8');
const TAB   = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/clubs-tab.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

const sinComs = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const SRCc = sinComs(SRC);

console.log('── vaciado de temporada (v436) ──');

// ═══════════ Arnes: Firestore de mentira ═══════════
function montar(datos) {
    const consultas = [];   // {col, campo, valor}
    const borrados  = [];   // {col, id}
    const els = {};
    const doc = { id: null, value: '', checked: false };

    const fakeFS = {
        db: {},
        collection: (db, col) => ({ __col: col }),
        where: (campo, op, valor) => ({ campo, op, valor }),
        query: (colRef, ...conds) => ({ __col: colRef.__col, conds }),
        getDocs: async (q) => {
            const cond = (q.conds || [])[0] || {};
            consultas.push({ col: q.__col, campo: cond.campo, valor: cond.valor });
            const st = (datos[q.__col] || []).filter(d =>
                !cond.campo || d[cond.campo] === cond.valor);
            return { size: st.length, forEach: (cb) => st.forEach(d => cb({ id: d.id, data: () => d })) };
        },
        doc: (db, col, id) => ({ __col: col, __id: id }),
        deleteDoc: async (ref) => { borrados.push({ col: ref.__col, id: ref.__id }); },
    };

    const sandbox = {
        window: {},
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON,
        saFS: async () => fakeFS,
        escapeHtml: (s) => String(s == null ? '' : s),
        _saShowSpinner: () => {}, _saHideSpinner: () => {},
        _saToast: (m) => { sandbox.__toast = m; },
        saTab: () => {},
        alert: (m) => { sandbox.__alert = m; },
        document: {
            getElementById: (id) => els[id] || null,
            createElement: () => { const e = { style: {}, id: '', innerHTML: '' }; return e; },
            querySelectorAll: (sel) => sandbox.__checks || [],
            body: { appendChild: () => {}, removeChild: () => {} },
        },
        __checks: [], __toast: null, __alert: null,
        __els: els,
    };
    sandbox.window.document = sandbox.document;
    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox);
    return { sandbox, consultas, borrados, els };
}

// ═══════════ PARTE 1 · el catalogo de colecciones ═══════════
console.log('\n── PARTE 1 · qué se ofrece vaciar ──');
{
    const { sandbox } = montar({});
    const cols = sandbox.window._SA_SEASON_COLS;
    ok('1a · el catálogo existe', Array.isArray(cols) && cols.length > 0);

    const nombres = cols.map(c => c.col);
    ok('1b · incluye partidos e informes', nombres.includes('live_matches') && nombres.includes('cronos_player_reports'));
    ok('1c · [DEFECTO D] NO ofrece audit_logs',
       !nombres.includes('audit_logs'),
       'su regla es `allow write: if false`: no lo borra nadie, ni el SuperAdmin');
    ok('1d · NO ofrece users', !nombres.includes('users'));
    ok('1e · NO ofrece clubs', !nombres.includes('clubs'));

    const links = cols.find(c => c.col === 'cronos_player_links');
    ok('1f · [DEFECTO E] los vínculos jugador-padre NO vienen marcados',
       !!links && links.porDefecto === false,
       'no son datos de temporada: son la estructura que conecta a cada familia con su hijo');
    ok('1g · y llevan aviso explícito', !!links && typeof links.aviso === 'string' && links.aviso.length > 10);

    const porDefecto = cols.filter(c => c.porDefecto).map(c => c.col);
    ok('1h · lo marcado por defecto son los datos deportivos de la temporada',
       porDefecto.includes('live_matches') && porDefecto.includes('cronos_player_reports')
       && !porDefecto.includes('cronos_player_links'),
       porDefecto.join(','));
}

// ═══════════ PARTE 2 · el recuento previo ═══════════
console.log('\n── PARTE 2 · el recuento acota por club ──');
{
    const datos = {
        live_matches: [
            { id: 'M1', clubId: 'A' }, { id: 'M2', clubId: 'A' }, { id: 'M3', clubId: 'B' },
        ],
        cronos_player_reports: [{ id: 'R1', clubId: 'A' }, { id: 'R2', clubId: 'B' }],
    };
    const { sandbox, consultas } = montar(datos);
    const conteo = vm.runInContext('window._saCountSeasonData("A")', sandbox);

    return conteo.then(c => {
        ok('2a · cuenta solo los del club pedido',
           c.live_matches === 2 && c.cronos_player_reports === 1,
           JSON.stringify(c));
        ok('2b · [DEFECTO A] TODAS las consultas del recuento llevan where clubId',
           consultas.length > 0 && consultas.every(q => q.campo === 'clubId' && q.valor === 'A'),
           JSON.stringify(consultas));
        return seguir();
    });
}

// ═══════════ PARTE 3 · el borrado ═══════════
async function seguir() {
    console.log('\n── PARTE 3 · el borrado, ejecutado ──');

    const datos = () => ({
        live_matches:          [{ id: 'M1', clubId: 'A' }, { id: 'M2', clubId: 'A' }, { id: 'M3', clubId: 'B' }],
        cronos_player_reports: [{ id: 'R1', clubId: 'A' }, { id: 'R2', clubId: 'B' }],
        cronos_notifications:  [{ id: 'N1', clubId: 'A' }],
        cronos_player_links:   [{ id: 'L1', clubId: 'A' }],
        users:                 [{ id: 'U1', clubId: 'A' }],
        clubs:                 [{ id: 'A' }],
    });

    // Simula: usuario marca partidos+informes, escribe bien el nombre y pulsa.
    const lanzar = async ({ marcadas, nombreEscrito, clubName }) => {
        const { sandbox, consultas, borrados, els } = montar(datos());
        sandbox.__checks = marcadas.map(v => ({ value: v, checked: true }));
        els['sa-season-confirm'] = { value: nombreEscrito };
        // Capturamos los onclick que el modulo asigna al pintar el modal.
        const botones = {};
        ['sa-season-cancel', 'sa-season-go'].forEach(id => { botones[id] = {}; els[id] = botones[id]; });
        els['sa-season-reset-modal'] = null;

        await vm.runInContext(`window.saResetClubSeason("A", ${JSON.stringify(clubName)})`, sandbox);
        if (typeof botones['sa-season-go'].onclick === 'function') {
            await botones['sa-season-go'].onclick();
        }
        return { sandbox, consultas, borrados };
    };

    {
        const { consultas, borrados } = await lanzar({
            marcadas: ['live_matches', 'cronos_player_reports'],
            nombreEscrito: 'CD Ejemplo', clubName: 'CD Ejemplo',
        });

        ok('3a · borra los partidos del club A',
           borrados.some(b => b.col === 'live_matches' && b.id === 'M1')
           && borrados.some(b => b.col === 'live_matches' && b.id === 'M2'));
        ok('3b · [DEFECTO A] y NO toca los de otro club',
           !borrados.some(b => b.id === 'M3'),
           'sin el where por clubId se borraria la plataforma entera');
        ok('3c · borra los informes del club A', borrados.some(b => b.col === 'cronos_player_reports' && b.id === 'R1'));
        ok('3d · y no los de otro club', !borrados.some(b => b.id === 'R2'));

        ok('3e · [DEFECTO B] NO toca users',
           !borrados.some(b => b.col === 'users'),
           'esto es lo que distingue el vaciado del borrado de club');
        ok('3f · [DEFECTO B] NO toca clubs', !borrados.some(b => b.col === 'clubs'));
        ok('3g · no borra lo que no se marcó',
           !borrados.some(b => b.col === 'cronos_notifications')
           && !borrados.some(b => b.col === 'cronos_player_links'));

        ok('3h · [DEFECTO A] toda consulta de borrado va acotada por clubId',
           consultas.every(q => q.campo === 'clubId' && q.valor === 'A'),
           JSON.stringify(consultas));
    }

    {
        // ⚠️ DEFECTO C: el nombre no coincide -> no se borra NADA.
        const { borrados, sandbox } = await lanzar({
            marcadas: ['live_matches'],
            nombreEscrito: 'otra cosa', clubName: 'CD Ejemplo',
        });
        ok('3i · [DEFECTO C] con el nombre mal escrito NO se borra nada',
           borrados.length === 0,
           'la confirmacion por nombre es la unica barrera contra el clic accidental');
        ok('3j · y se avisa de por qué', /no coincide/i.test(String(sandbox.__alert || '')));
    }

    {
        // Sin nada marcado tampoco se borra.
        const { borrados, sandbox } = await lanzar({
            marcadas: [], nombreEscrito: 'CD Ejemplo', clubName: 'CD Ejemplo',
        });
        ok('3k · sin colecciones marcadas no se borra nada', borrados.length === 0);
        ok('3l · y se dice', /no has elegido/i.test(String(sandbox.__alert || '')));
    }

    // ═══════════ PARTE 4 · integracion ═══════════
    console.log('\n── PARTE 4 · integración ──');
    {
        ok('4a · el botón está en la lista de clubes', /saResetClubSeason\('\$\{c\.id\}'/.test(TAB));
        ok('4b · con guarda typeof, por si el módulo no cargara',
           /typeof saResetClubSeason==='function'/.test(TAB));
        ok('4c · y NO sustituye al borrado de club, que sigue ahí',
           /saDeleteClubComplete\('\$\{c\.id\}'/.test(TAB),
           'son dos acciones distintas y ambas deben existir');
        ok('4d · los dos botones se distinguen en el title',
           /Vaciar los datos de la temporada CONSERVANDO/.test(TAB)
           && /el club DESAPARECE/.test(TAB),
           'confundirlos es el riesgo real: ninguna de las dos tiene deshacer');
        ok('4e · el módulo se carga en index.html',
           /js\/admin\/superadmin\/season-reset\.js/.test(INDEX));
    }

    // ═══════════ PARTE 5 · las reglas lo permiten ═══════════
    console.log('\n── PARTE 5 · que el borrado no falle en silencio ──');
    {
        // Se recorta el `allow delete` CONCRETO de cronos_messages. Dos cosas
        // aprendidas escribiendo esto: un `slice(i, i+3000)` desde el `match`
        // no llegaba hasta el delete (topes a ojo otra vez), y la asercion
        // negativa hay que acotarla al delete — el read/create/update del mismo
        // bloque siguen accediendo directo a `participants`, que es un defecto
        // preexistente ANOTADO PERO NO TOCADO aqui: el vaciado no lo necesita y
        // cambiarlo ampliaria el alcance de esta ronda sin pedirlo.
        const iMsg = RULES.indexOf('match /cronos_messages/');
        const iDel = iMsg === -1 ? -1 : RULES.indexOf('allow delete', iMsg);
        const delMsg = iDel === -1 ? '' : RULES.slice(iDel, iDel + 600);

        ok('5a · el SuperAdmin puede borrar en cronos_messages',
           /allow delete: if isAuth\(\) &&\s*\(isSuperAdmin\(\)/.test(delMsg),
           'y va PRIMERO: si una rama anterior lanza, la condicion entera es error = DENY');
        ok('5b · [TRAMPA] y ese delete ya no accede directo a claves que pueden faltar',
           !/resource\.data\.participants\b/.test(delMsg)
           && /resource\.data\.get\('participants', \[\]\)/.test(delMsg),
           'un hilo sin `participants` hacia LANZAR la regla y el SA no podia borrarlo');
        ok('5c · audit_logs sigue siendo inmutable',
           /match \/audit_logs\/[\s\S]{0,400}allow write: if false/.test(RULES),
           'por eso el vaciado no lo ofrece');
    }

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
}
