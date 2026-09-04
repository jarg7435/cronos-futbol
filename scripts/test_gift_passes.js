// ══════════════════════════════════════════════════════════════════════
//  test_gift_passes.js  ·  pases de regalo (v672)
//
//  🔑 CARGA Y EJECUTA el módulo sobre un Firestore de juguete. Lo que hay
//  que demostrar no es que el marcado exista, sino que:
//    · cada pase funda SU PROPIA entidad (el aislamiento del encargo),
//    · el estado se DERIVA y no se guarda,
//    · el Director Deportivo no ve la sección,
//    · la invitación no deja colar campos que no son suyos.
// ══════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC   = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/gift-passes.js'), 'utf8');
const UTILS = fs.readFileSync(path.join(ROOT, 'js/core/utils.js'), 'utf8');
const SEC   = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/secretary.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SW    = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const CHK   = fs.readFileSync(path.join(ROOT, 'scripts/_check_syntax.js'), 'utf8');
const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');

let pass = 0, fail = 0;
function ok(n, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + n); }
    else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '\n       ' + JSON.stringify(extra) : '')); }
}

// ── Sandbox: DOM y Firestore de juguete ───────────────────────────────
function build(opts) {
    opts = opts || {};
    const els = {};
    const mkEl = (v) => ({ value: v || '', innerHTML: '', textContent: '', style: {},
                           select() {}, dataset: {} });
    ['gp-nombre', 'gp-nota', 'gp-lista', 'gp-nuevo', 'sa-body', 'gp-enlace']
        .forEach(id => { els[id] = mkEl(); });
    Object.assign(els['gp-nombre'], { value: opts.nombre === undefined ? 'Regalo de Ana' : opts.nombre });
    els['gp-nota'].value = opts.nota || '';

    const escritos = [];      // {col, id, data}
    const invitaciones = [];
    const toasts = [];

    const ctx = {
        console, Date, Math, JSON, navigator: {}, document: {
            getElementById: (id) => els[id] || null,
        },
    };
    ctx.window = ctx;
    ctx._cronosCurrentUser = opts.me === undefined
        ? { uid: 'sa1', email: 'sa@x.com', role: 'superadmin' } : opts.me;
    ctx.escapeHtml = (s) => String(s == null ? '' : s);
    ctx._saToast = (m) => toasts.push(m);
    ctx._saShowSpinner = () => {};
    ctx._saHideSpinner = () => {};
    ctx.CRONOS_APP_URL = 'https://app.test';

    ctx.saFS = async () => ({
        db: {},
        doc: (_db, col, id) => ({ col, id }),
        collection: (_db, col) => ({ col }),
        query: (c, w) => ({ c, w }),
        where: (campo, op, val) => ({ campo, op, val }),
        setDoc: async (ref, data) => { escritos.push({ col: ref.col, id: ref.id, data }); },
        getDoc: async (ref) => {
            const u = (opts.usuarios || {})[ref.id];
            return { exists: () => !!u, data: () => u };
        },
        getDocs: async (q) => {
            const lista = opts.pases || [];
            return { forEach: (f) => lista.forEach(p => f({ id: p._id, data: () => p })) };
        },
    });

    ctx.cronosCrearInvitacion = async (d) => {
        invitaciones.push(d);
        return { token: 'tok123', url: 'https://app.test/?invite=tok123' };
    };

    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return { ctx, els, escritos, invitaciones, toasts };
}

console.log('\n── PARTE 1 · el módulo se declara ──');
{
    const t = build({});
    ['cronosEstadoPase', 'cronosPuedeRegalar', 'cronosBloqueRegalos',
     'saAbrirPasesRegalo', 'saGenerarPaseRegalo', 'saListarPasesRegalo', 'saCopiarPase']
        .forEach(n => ok('1 · expone ' + n, typeof t.ctx.window[n] === 'function'));
}

console.log('\n── PARTE 2 · quién puede regalar (falla CERRADO) ──');
{
    const sa  = build({ me: { role: 'superadmin' } });
    const adm = build({ me: { role: 'admin' } });
    const dir = build({ me: { role: 'director' } });
    const nadie = build({ me: null });
    ok('2a · el SuperAdmin sí', sa.ctx.window.cronosPuedeRegalar() === true);
    ok('2b · el admin de plataforma también', adm.ctx.window.cronosPuedeRegalar() === true);
    ok('2c · 🔑 el Director Deportivo NO', dir.ctx.window.cronosPuedeRegalar() === false);
    ok('2d · ⚠️ y sin usuario tampoco (falla cerrado)', nadie.ctx.window.cronosPuedeRegalar() === false);

    // El bloque de Secretaría es lo que ve el Director: tiene que ser NADA.
    ok('2e · 🔑 el bloque sale VACÍO para el Director',
        dir.ctx.window.cronosBloqueRegalos() === '');
    ok('2f · y con contenido para el SuperAdmin',
        /Pases de regalo/.test(sa.ctx.window.cronosBloqueRegalos()));

    // Y la puerta también en la acción, no sólo en el marcado.
    ok('2g · ⚠️ la PUERTA está en la acción, no sólo en el botón',
        /cronosPuedeRegalar\(\)/.test(SRC.slice(SRC.indexOf('saGenerarPaseRegalo'))));
}

console.log('\n── PARTE 3 · generar: una entidad PROPIA por pase ──');
(async () => {
    {
        const t = build({ nombre: 'Regalo de Ana', nota: 'para un compañero' });
        await t.ctx.window.saGenerarPaseRegalo();

        const entes = t.escritos.filter(e => e.col === 'clubs');
        ok('3a · 🔑🔑 crea UNA entidad propia', entes.length === 1, t.escritos.map(e => e.col));
        const ente = entes[0] || { data: {} };
        ok('3b · es un ente individual y activo',
            ente.data.type === 'individual' && ente.data.status === 'active');
        ok('3c · nace SIN administrador (lo será quien lo canjee)',
            ente.data.hasAdmin === false && ente.data.adminUid === null);
        ok('3d · queda marcada como regalo, para reconocerla después',
            ente.data.giftPass === true);
        ok('3e · con el nombre que puso el SuperAdmin', ente.data.name === 'Regalo de Ana');

        const inv = t.invitaciones[0] || {};
        ok('3f · 🔑 la invitación ata el rol de Administrador Individual',
            inv.role === 'individual');
        ok('3g · 🔑 y la ATA A ESA entidad, por id y por nombre',
            inv.clubId === ente.id && inv.clubName === 'Regalo de Ana', inv);
        ok('3h · ⚠️ va SIN email: en un regalo no se sabe quién lo canjeará',
            inv.email === '');
        ok('3i · lleva la marca de regalo y la nota interna',
            inv.gift === true && inv.giftNota === 'para un compañero');

        // ⚠️ Aquí hubo una asercion "3j · dos pases NO comparten entidad" cuyo
        //    cuerpo devolvia `true` a secas: un VERDE FALSO, que en este repo
        //    es peor que un rojo. Lo que decia comprobar lo comprueba 3k de
        //    verdad, generando dos pases y mirando los dos ids.
    }
    {
        // 🔑🔑 EL PUNTO DEL ENCARGO: dos regalos, dos entidades distintas.
        const a = build({ nombre: 'Regalo 1' });
        await a.ctx.window.saGenerarPaseRegalo();
        const b = build({ nombre: 'Regalo 2' });
        await b.ctx.window.saGenerarPaseRegalo();
        const idA = a.escritos.find(e => e.col === 'clubs').id;
        const idB = b.escritos.find(e => e.col === 'clubs').id;
        ok('3k · 🔑🔑 dos pases = dos entidades DISTINTAS (el aislamiento)',
            idA !== idB, { idA, idB });
    }
    {
        const t = build({ nombre: '' });
        await t.ctx.window.saGenerarPaseRegalo();
        ok('3l · ⚠️ sin nombre no crea nada y avisa',
            t.escritos.length === 0 && t.invitaciones.length === 0
            && t.toasts.some(x => /nombre/i.test(x)), t.toasts);
    }
    {
        const t = build({ me: { role: 'director' }, nombre: 'Cuela' });
        await t.ctx.window.saGenerarPaseRegalo();
        ok('3m · 🔑 un Director NO puede generar, aunque llame a la función',
            t.escritos.length === 0 && t.invitaciones.length === 0
            && t.toasts.some(x => /SuperAdministrador/i.test(x)), t.toasts);
    }

    console.log('\n── PARTE 4 · el estado se DERIVA de los datos ──');
    {
        const E = build({}).ctx.window.cronosEstadoPase;
        const futuro = { toMillis: () => Date.now() + 86400000 };
        const pasado = { toMillis: () => Date.now() - 86400000 };

        ok('4a · sin canjear y en plazo -> pendiente',
            E({ expiresAt: futuro }, null) === 'pendiente');
        ok('4b · sin canjear y caducado -> caducada',
            E({ expiresAt: pasado }, null) === 'caducada');
        ok('4c · canjeado y sin aprobar -> registrada',
            E({ usedAt: 'x', usedBy: 'u1' }, { isAuthorized: false }) === 'registrada');
        ok('4d · canjeado y aprobado en la raíz -> aprobada',
            E({ usedAt: 'x', usedBy: 'u1' }, { isAuthorized: true }) === 'aprobada');
        ok('4e · 🔑 o aprobado en su PLAZA (allRoles) -> aprobada',
            E({ usedAt: 'x', usedBy: 'u1' },
              { isAuthorized: false, allRoles: [{ role: 'individual', isAuthorized: true }] }) === 'aprobada');
        ok('4f · ⚠️ canjeado pero sin poder leer al usuario -> registrada, no aprobada',
            E({ usedAt: 'x', usedBy: 'u1' }, null) === 'registrada',
            'no saber si está aprobado NO puede contarse como aprobado');
        ok('4g · un pase canjeado ya no vuelve a "caducada" aunque pase la fecha',
            E({ usedAt: 'x', usedBy: 'u1', expiresAt: pasado }, { isAuthorized: true }) === 'aprobada');

        // Y el estado NO se guarda en el documento.
        const t = build({ nombre: 'X' });
        await t.ctx.window.saGenerarPaseRegalo();
        ok('4h · 🔑 el estado NO se escribe en la invitación (se deriva)',
            !('estado' in (t.invitaciones[0] || {})) && !('status' in (t.invitaciones[0] || {})));
    }

    console.log('\n── PARTE 5 · el listado ──');
    {
        const futuro = { toMillis: () => Date.now() + 86400000 };
        const t = build({
            pases: [
                { _id: 'p1', clubName: 'Regalo 1', createdAt: '2026-09-01', expiresAt: futuro },
                { _id: 'p2', clubName: 'Regalo 2', createdAt: '2026-09-02', usedAt: 'x', usedBy: 'u2' },
            ],
            usuarios: { u2: { email: 'nuevo@x.com', isAuthorized: true } },
        });
        await t.ctx.window.saListarPasesRegalo();
        const h = t.els['gp-lista'].innerHTML;
        ok('5a · pinta los dos pases', /Regalo 1/.test(h) && /Regalo 2/.test(h));
        ok('5b · el sin canjear sale como pendiente y con su enlace',
            /Pendiente de canje/.test(h) && /invite=p1/.test(h));
        ok('5c · el canjeado y aprobado sale como aprobada', /Aprobada/.test(h));
        ok('5d · y dice quién lo canjeó', /nuevo@x\.com/.test(h));
        ok('5e · ⚠️ el enlace SÓLO se ofrece en los pendientes (uno ya usado no sirve)',
            (h.match(/invite=/g) || []).length === 1, (h.match(/invite=[a-z0-9]+/g) || []));
    }
    {
        const t = build({ pases: [] });
        await t.ctx.window.saListarPasesRegalo();
        ok('5f · sin pases lo dice, no deja el hueco en blanco',
            /ning[úu]n pase/i.test(t.els['gp-lista'].innerHTML));
    }
    {
        // La consulta tiene que ir ACOTADA: Secretaría emite muchas más
        // invitaciones y traérselas todas es pagar lecturas por nada.
        ok('5g · 🔑 consulta acotada con where(gift == true)',
            /where\('gift',\s*'==',\s*true\)/.test(SRC));
    }

    console.log('\n── PARTE 6 · la invitación no admite campos ajenos ──');
    {
        // 🔑 `cronosCrearInvitacion` construye una LISTA BLANCA. Si volcara
        //    lo que llega, quien invita podría escribir usedAt/createdBy y
        //    fabricarse una invitación eterna o a nombre de otro (v636).
        const bloque = UTILS.slice(UTILS.indexOf('cronosCrearInvitacion'),
                                   UTILS.indexOf('cronosLeerInvitacion'));
        ok('6a · ⚠️ no hay volcado a granel de lo que llega',
            !/\.\.\.d\b/.test(bloque) && !/Object\.assign\(\s*\{[^}]*\},\s*d\b/.test(bloque));
        ok('6b · los campos del regalo se declaran uno a uno',
            /gift:\s*true/.test(bloque) && /giftNota:/.test(bloque) && /giftEntityId:/.test(bloque));
        ok('6c · 🔑 `gift` sólo se guarda cuando es true (o la consulta del panel arrastraría todas)',
            /d\.gift === true/.test(bloque));
        ok('6d · createdBy sigue siendo el uid de quien invita, no lo que llegue',
            /createdBy:\s*yo\.uid/.test(bloque));
    }

    console.log('\n── PARTE 7 · integración y registro ──');
    {
        ok('7a · Secretaría interpola el bloque con guarda typeof',
            /typeof window\.cronosBloqueRegalos === 'function'/.test(SEC));
        ok('7b · <script> en index.html', /src="js\/admin\/superadmin\/gift-passes\.js/.test(INDEX));
        ok('7c · en el precache de sw.js', /'\.\/js\/admin\/superadmin\/gift-passes\.js'/.test(SW));
        ok('7d · en la cobertura de _check_syntax', /'js\/admin\/superadmin\/gift-passes\.js'/.test(CHK));

        // 🔑 Las reglas ya servían: se comprueba que siguen sirviendo.
        const rInv = RULES.slice(RULES.indexOf('match /invites/{token}'),
                                 RULES.indexOf('match /invites/{token}') + 900);
        ok('7e · 🔑 el SuperAdmin puede LISTAR invitaciones (el panel lo necesita)',
            /allow list: if isSuperAdmin\(\)/.test(rInv));
        ok('7f · ⚠️ y consumir sigue limitado a usedAt/usedBy del propio uid',
            /hasOnly\(\['usedAt', 'usedBy'\]\)/.test(rInv));
        ok('7g · 🔑 fundar la entidad sigue siendo exclusivo del SuperAdmin',
            /match \/clubs\/\{clubId\}[\s\S]{0,900}allow create: if isSuperAdmin\(\)/.test(RULES));
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
