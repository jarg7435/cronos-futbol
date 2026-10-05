// ════════════════════════════════════════════════════════════════════════
//  test_plantilla_vigente.js — v784
//  ⚠️ SIN «secret» EN EL NOMBRE: `.gitignore` ignora `*secret*`.
// ════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-10-05, capturas 11104-11105):
//  el ente veía la plantilla de fábrica nueva (v783) y el Administrador del
//  CD DÍA la antigua. Misma fábrica: el club tenía una plantilla GUARDADA
//  anterior, y la guardada mandaba.
//
//  🔑 LO QUE SE PROTEGE (ejecutando la carga de verdad, no por regex):
//   · Una guardada SIN sello de fábrica (o con otro) NO se aplica: se pinta
//     la de fábrica, con aviso y «Recuperar la guardada».
//   · Una guardada sellada con la fábrica vigente SÍ manda.
//   · Recuperar pone su texto; Guardar la sella y quita el aviso.
//   · Sin guardada, se pinta la fábrica aunque quedara otra de antes.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const SECR = fs.readFileSync(path.join(ROOT, 'js/admin/superadmin/secretary.js'), 'utf8');

const VIEJA_CD_DIA = 'Hola, {nombre}:\n\nTe damos la bienvenida a Chronos Fútbol. Has sido invitado a unirte a ' +
    'nuestra plataforma como {rol} del CD DÍA.\n\nUn saludo,\nCD DÍA';

function montar(clubDoc) {
    const els = {};
    const el = (id) => els[id] || (els[id] = {
        id, value: '', innerHTML: '', style: {},
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    });
    el('sec-club').value = 'CD DÍA';
    el('sec-role').value = 'director';
    const escrito = [];
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: { getElementById: el },
        localStorage: { getItem() { return null; }, setItem() {} },
        setTimeout() {},
        _saToast() {}, _saShowSpinner() {}, _saHideSpinner() {},
    };
    sb.window = sb;
    sb._secCtx = { clubId: 'club_cd_dia' };
    sb.saFS = async () => ({
        db: {}, doc: (_db, c, id) => ({ c, id }),
        getDoc: async () => ({ exists: () => !!clubDoc, data: () => clubDoc }),
        updateDoc: async (_ref, data) => { escrito.push(data); },
    });
    vm.createContext(sb);
    vm.runInContext(SECR, sb);
    return { W: sb.window, el, escrito };
}

(async () => {
    const FABRICA = (W) => W.secPlantillaFabrica('email', 'CD DÍA');

    console.log('\nPARTE 1 · guardada ANTERIOR a la fábrica (el caso del CD DÍA)');
    {
        const { W, el } = montar({ inviteTemplate: { email: VIEJA_CD_DIA } });
        await W.saCargarPlantillaGuardada();
        ok('1a · se pinta la plantilla de FÁBRICA, no la guardada', el('sec-body').value === FABRICA(W), el('sec-body').value.slice(0, 80));
        ok('1b · la vista previa lleva la negrita nueva', /<strong>CHRONOS FÚTBOL<\/strong>/.test(el('sec-preview').innerHTML));
        ok('1c · aparece el aviso con «Recuperar la guardada»',
           el('sec-aviso-antigua').style.cssText && /display:flex/.test(el('sec-aviso-antigua').style.cssText) &&
           /saRecuperarPlantillaAntigua/.test(el('sec-aviso-antigua').innerHTML));
        ok('1d · la guardada NO se borra: queda aparte', W._secGuardadaAntigua && W._secGuardadaAntigua.email === VIEJA_CD_DIA);

        W.saRecuperarPlantillaAntigua();
        ok('1e · Recuperar pone SU texto en el mensaje', el('sec-body').value === VIEJA_CD_DIA);
        ok('1f · …marcado como suyo (un cambio de rol no lo pisa)', el('sec-body').classList.contains('user-edited'));
        ok('1g · …y el aviso se va', el('sec-aviso-antigua').style.display === 'none');
    }

    console.log('\nPARTE 2 · guardar sella con la fábrica vigente');
    {
        const { W, el, escrito } = montar({ inviteTemplate: { email: VIEJA_CD_DIA } });
        await W.saCargarPlantillaGuardada();
        W.saRecuperarPlantillaAntigua();
        await W.saGuardarPlantilla();
        const t = escrito[0] && escrito[0].inviteTemplate;
        ok('2a · se escribe en el club su texto', t && t.email === VIEJA_CD_DIA, t);
        ok('2b · 🔑 sellado con SEC_FABRICA_VERSION', t && t.fabrica === W.SEC_FABRICA_VERSION, t);
        ok('2c · sólo la clave inviteTemplate (las reglas lo exigen)', escrito[0] && Object.keys(escrito[0]).join() === 'inviteTemplate');
    }

    console.log('\nPARTE 3 · guardada VIGENTE manda');
    {
        const PROPIA = 'Mi texto, {nombre}, para el {club}.';
        const { W, el } = montar(null);
        const m = montar({ inviteTemplate: { email: PROPIA, fabrica: W.SEC_FABRICA_VERSION } });
        await m.W.saCargarPlantillaGuardada();
        ok('3a · la guardada sellada con la fábrica actual se usa', m.el('sec-body').value === PROPIA, m.el('sec-body').value);
        ok('3b · sin aviso', m.el('sec-aviso-antigua').style.display === 'none');
        void el;
    }

    console.log('\nPARTE 4 · sin guardada (el ente) y sin restos de otra apertura');
    {
        const { W, el } = montar({ name: 'CD DÍA' });
        W._secGuardadas = { email: 'RESTO DE OTRO CLUB', fabrica: W.SEC_FABRICA_VERSION };
        await W.saCargarPlantillaGuardada();
        ok('4a · se pinta la de fábrica, no lo que quedaba en window', el('sec-body').value === FABRICA(W), el('sec-body').value.slice(0, 40));
        ok('4b · saSecretary olvida la guardada anterior antes de pintar',
           /window\._secGuardadas = null;\s*window\._secGuardadaAntigua = null;\s*setTimeout/.test(SECR));
    }

    console.log('\nPARTE 5 · la versión de fábrica');
    {
        const { W } = montar(null);
        ok('5a · la fábrica declara versión', typeof W.SEC_FABRICA_VERSION === 'string' && /^v\d+$/.test(W.SEC_FABRICA_VERSION));
        ok('5b · secGuardadaVigente: sin sello → no vigente', W.secGuardadaVigente({ email: 'x' }) === false);
        ok('5c · secGuardadaVigente: sello actual → vigente', W.secGuardadaVigente({ email: 'x', fabrica: W.SEC_FABRICA_VERSION }) === true);
    }

    console.log(`\n${total - fallos}/${total} aserciones`);
    process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
