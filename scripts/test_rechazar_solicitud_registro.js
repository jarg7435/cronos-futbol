// ─────────────────────────────────────────────────────────────────────────
// test_rechazar_solicitud_registro.js  ·  el ✕ de "Solicitudes de Registro"
// retira la solicitud de verdad (v474)
//
// Reporte del autor (captura 8564): al rechazar la solicitud pendiente de
// damasorv@gmail.com desde el Panel de Administrador de Club salta
// "Error al rechazar: Missing or insufficient permissions" y la solicitud se
// queda colgada en el listado.
//
// LA CAUSA PRINCIPAL ERAN LAS REGLAS (ver scripts/test_reject_request_rules.js:
// ni platform_requests.delete ni users.update dejaban actuar a nadie que no
// fuera el SuperAdmin). Pero `caRejectRequest` tenia ADEMAS dos defectos
// propios que este guard fija, y que por si solos ya dejaban la solicitud
// colgada:
//
//  A · LAS DOS LIMPIEZAS IBAN ENCADENADAS. Marcar el perfil como rechazado y
//      retirar el documento de la solicitud son cosas independientes, pero un
//      fallo al escribir el PERFIL lanzaba y la solicitud ni se intentaba
//      borrar. Ahora se intentan las dos y solo hay error si fallan AMBAS: lo
//      que el administrador ve en pantalla es la solicitud, y retirarla es lo
//      que de verdad le desatasca.
//
//  B · ⚠️ LOS BORRADOS NO SE ESPERABAN. Iban lanzados dentro de un forEach sin
//      await, asi que navReload() repintaba el panel ANTES de que Firestore
//      hubiera borrado nada: la solicitud recien rechazada volvia a aparecer y
//      parecia que el boton no hacia nada. Aqui se comprueba el ORDEN real.
//
// El guard EJECUTA la funcion extraida del panel con dobles de Firestore. Un
// regex veria que existe el deleteDoc, no si se espera ni por que camino se
// llega a el.
// ─────────────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const PANEL_REL = path.join('js', 'admin', 'club', 'panel.js');
const PANEL = fs.readFileSync(path.join(ROOT, PANEL_REL), 'utf8');

console.log('── rechazar una solicitud de registro (v474) ──\n');

// 0. Un guard de regex no puede ver un fichero que no compila: se comprueba
//    PRIMERO que el panel parsea.
try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, PANEL_REL)], { stdio: 'pipe' });
    ok('0a · js/admin/club/panel.js compila', true);
} catch (e) {
    ok('0a · js/admin/club/panel.js compila', false, String(e.stderr || e).slice(0, 400));
    process.exit(1);
}

// ── Extraccion de la funcion ────────────────────────────────────────────
const INI = PANEL.indexOf('window.caRejectRequest = async');
const FIN = PANEL.indexOf('window.caRejectMultiRole = async');
ok('0b · se puede extraer caRejectRequest', INI !== -1 && FIN > INI);
if (INI === -1 || FIN <= INI) process.exit(1);
const FUENTE = PANEL.slice(INI, PANEL.lastIndexOf('};', FIN) + 2);

// ── Caja de arena ───────────────────────────────────────────────────────
// `escenario` decide que rechaza cada escritura, para reproducir el fallo de
// permisos tal y como lo vio el autor.
function montar(op) {
    const traza = [];
    const borrados = [];
    const perfiles = [];
    const toasts = [];
    const consultas = [];
    const prsDelUsuario = op.prsDelUsuario || [];

    const tick = () => new Promise(r => setTimeout(r, 0));

    const sb = {
        window: {},
        console: { log() {}, warn(...a) { traza.push('warn'); } },
        setTimeout,
        confirm: () => op.confirmar !== false,
        showToast: (m) => { toasts.push(m); },
        me: { uid: 'ca_a', email: 'admin@a.es' },
        clubId: 'CLUB_A',
        db: {},
        doc: (_db, col, id) => ({ col, id }),
        collection: (_db, col) => ({ col }),
        query: (c, ...filtros) => ({ col: c.col, filtros }),
        where: (f, o, v) => ({ f, o, v }),
        getDocs: async (q) => {
            consultas.push(q);
            await tick();
            // Una consulta sin el filtro por clubId es la que Firestore DENIEGA
            // (la regla no puede darse por cierta sin leer los documentos).
            if (!(q.filtros || []).some(x => x.f === 'clubId')) {
                throw new Error('Missing or insufficient permissions.');
            }
            return { forEach: (cb) => prsDelUsuario.forEach(id => cb({ id, data: () => ({}) })) };
        },
        updateDoc: async (ref, data) => {
            await tick();
            if (op.fallaPerfil) { const e = new Error(op.fallaPerfil); throw e; }
            perfiles.push({ id: ref.id, data });
            traza.push('update:' + ref.id);
        },
        deleteDoc: async (ref) => {
            await tick();
            if (op.fallaBorrado) throw new Error(op.fallaBorrado);
            borrados.push(ref.id);
            traza.push('delete:' + ref.id);
        },
        navReload: () => { traza.push('repintar'); },
        openClubAdminPanel: () => { traza.push('repintar'); },
    };
    vm.createContext(sb);
    vm.runInContext(FUENTE, sb, { filename: 'caRejectRequest.js' });
    return { sb, traza, borrados, perfiles, toasts, consultas };
}

const DENEGADO = 'Missing or insufficient permissions.';

(async () => {
    // ── A · NO REGRESION · el camino de platform_requests, que ya iba bien ─
    {
        const t = montar({ prsDelUsuario: ['self_reg_u1'] });
        await t.sb.window.caRejectRequest('self_reg_u1', 'damasorv@gmail.com', 'true', 'u1');
        ok('A1 · borra el documento de la solicitud', t.borrados.includes('self_reg_u1'), t.borrados.join());
        ok('A2 · y marca el perfil como rechazado',
           t.perfiles.length === 1 && t.perfiles[0].id === 'u1' && t.perfiles[0].data.status === 'rejected',
           JSON.stringify(t.perfiles));
        ok('A3 · sin dejar rastro de error', !t.toasts.some(x => x.includes('Error')), t.toasts.join(' | '));
        ok('A4 · ⚠️ repinta DESPUES de borrar, no antes',
           t.traza.indexOf('repintar') === t.traza.length - 1 && t.traza.includes('delete:self_reg_u1'),
           t.traza.join(' → '));
        ok('A5 · no borra dos veces la misma solicitud',
           t.borrados.filter(x => x === 'self_reg_u1').length === 1, t.borrados.join());
    }

    // ── B · el perfil no existe todavia: no es un fallo ─────────────────
    {
        const t = montar({ fallaPerfil: 'No document to update: users/u1', prsDelUsuario: [] });
        await t.sb.window.caRejectRequest('self_reg_u1', 'damasorv@gmail.com', 'true', 'u1');
        ok('B1 · retira igualmente la solicitud', t.borrados.includes('self_reg_u1'));
        ok('B2 · y NO muestra error', !t.toasts.some(x => x.includes('Error')), t.toasts.join(' | '));
    }

    // ── C · 🐛 EL DEFECTO A, en el camino donde estaba de verdad ─────────
    //    ⚠️ El red-check lo dejo claro: por el camino de platform_requests el
    //    fallo del perfil YA se toleraba (el .catch de la version anterior).
    //    El encadenamiento roto estaba en el OTRO camino, el del uid de
    //    usuario: alli un `throw updErr` abortaba antes de limpiar nada, y la
    //    solicitud se quedaba colgada. Este caso prueba ESE camino.
    {
        const t = montar({ fallaPerfil: DENEGADO, prsDelUsuario: ['self_reg_u1'] });
        await t.sb.window.caRejectRequest('u1', 'damasorv@gmail.com', 'false', '');
        ok('C1 · 🐛 con el perfil denegado, AUN ASI retira la solicitud del panel',
           t.borrados.includes('self_reg_u1'), t.borrados.join());
        ok('C2 · y da la accion por hecha en vez de dejarla a medias',
           t.toasts.some(x => x.includes('rechazada')) && !t.toasts.some(x => x.includes('Error')),
           t.toasts.join(' | '));
    }

    // ── D · sin id de solicitud: uid de USUARIO (bloques que pasan isPR=false)
    {
        const t = montar({ prsDelUsuario: ['self_reg_u1', 'fwd_CLUB_A_u1_user'] });
        await t.sb.window.caRejectRequest('u1', 'damasorv@gmail.com', 'false', '');
        ok('D1 · marca el perfil', t.perfiles.length === 1 && t.perfiles[0].id === 'u1');
        ok('D2 · y barre TODAS sus solicitudes fantasma',
           t.borrados.length === 2 && t.borrados.includes('fwd_CLUB_A_u1_user'), t.borrados.join());
        ok('D3 · ⚠️ esperando a los dos borrados antes de repintar',
           t.traza.indexOf('repintar') === t.traza.length - 1 &&
           t.traza.filter(x => x.startsWith('delete:')).length === 2,
           t.traza.join(' → '));
    }

    // ── E · si NO se consigue nada, si hay que decirlo ───────────────────
    {
        const t = montar({ fallaPerfil: DENEGADO, fallaBorrado: DENEGADO, prsDelUsuario: ['self_reg_u1'] });
        await t.sb.window.caRejectRequest('self_reg_u1', 'damasorv@gmail.com', 'true', 'u1');
        ok('E1 · muestra el error cuando ninguna limpieza sale adelante',
           t.toasts.some(x => x.includes('Error al rechazar')), t.toasts.join(' | '));
        ok('E2 · y NO repinta como si hubiera funcionado',
           !t.traza.includes('repintar'), t.traza.join(' → '));
    }

    // ── F · cancelar el dialogo no escribe nada ─────────────────────────
    {
        const t = montar({ confirmar: false, prsDelUsuario: ['self_reg_u1'] });
        await t.sb.window.caRejectRequest('self_reg_u1', 'damasorv@gmail.com', 'true', 'u1');
        ok('F1 · cancelar no borra ni marca nada',
           t.borrados.length === 0 && t.perfiles.length === 0 && t.traza.length === 0, t.traza.join(' → '));
    }

    // ── G · los ids de solicitud se reconocen aunque no venga la bandera ──
    //    Los cuatro prefijos que se crean en el proyecto (auth.js y panel.js).
    for (const pref of ['self_reg_u9', 'fwd_CLUB_A_u9_user', 'ind_reg_IND_1_u9_x', 'user_req_CLUB_A_x']) {
        const t = montar({ prsDelUsuario: [] });
        await t.sb.window.caRejectRequest(pref, 'x@x.es', undefined, '');
        ok('G · reconoce "' + pref.split('_').slice(0, 2).join('_') + '…" como solicitud y la borra',
           t.borrados.includes(pref), t.borrados.join());
    }

    // ── H · 🐛 EL SEGUNDO REPORTE (captura 8569): LA CONSULTA ────────────
    //    "No se pudieron listar las solicitudes: Missing or insufficient
    //    permissions". Firestore autoriza una consulta SIN leer los
    //    documentos: la regla tiene que quedar garantizada por los FILTROS.
    //    Con `userUid` a secas, `resource.data.clubId` es desconocido y la
    //    consulta entera se deniega. El listado principal del panel ya filtra
    //    por clubId; esta limpieza no lo hacia.
    {
        const t = montar({ prsDelUsuario: ['self_reg_u1', 'fwd_CLUB_A_u1_user'] });
        await t.sb.window.caRejectRequest('u1', 'damasorv@gmail.com', 'false', '');
        ok('H1 · 🐛 la consulta de limpieza filtra por clubId',
           t.consultas.length === 1 && t.consultas[0].filtros.some(x => x.f === 'clubId' && x.v === 'CLUB_A'),
           JSON.stringify(t.consultas));
        ok('H2 · y sigue filtrando por el usuario',
           t.consultas[0].filtros.some(x => x.f === 'userUid' && x.v === 'u1'), JSON.stringify(t.consultas[0]));
        ok('H3 · asi la limpieza SI encuentra y retira las solicitudes',
           t.borrados.length === 2, t.borrados.join());
    }

    // ── I · censo: NINGUNA consulta a platform_requests sin clubId ───────
    //    Vale para todo el panel, no solo para la funcion extraida:
    //    caForwardToSA tenia el mismo defecto y lo tapaba un catch mudo.
    {
        const consultas = PANEL.match(/query\(\s*_?col\w*\(\s*f?[Dd]b\s*,\s*'platform_requests'\s*\)[^;]*?\)/g) || [];
        ok('I1 · se localizan las consultas a platform_requests del panel',
           consultas.length >= 2, 'encontradas: ' + consultas.length);
        const sinClub = consultas.filter(q => !/_?w\w*\(\s*'clubId'/.test(q) && !/where\(\s*'clubId'/.test(q));
        ok('I2 · ⚠️ ninguna consulta a platform_requests va sin filtro de clubId',
           sinClub.length === 0, sinClub.join('\n       '));
    }

    // ── J · caForwardToSA tampoco silencia ya sus fallos ─────────────────
    {
        const fw = PANEL.slice(PANEL.indexOf('window.caForwardToSA = async'),
                               PANEL.indexOf('window.caSetUserStatus = async'));
        ok('J1 · el barrido de solicitudes originales ya no tiene un catch mudo',
           !/\}\s*catch\(_\)\s*\{\}/.test(fw), 'sigue habiendo un catch(_) {} que se traga el error');
        ok('J2 · y espera sus borrados', /await\s+fDeleteDoc\(/.test(fw));
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})();
