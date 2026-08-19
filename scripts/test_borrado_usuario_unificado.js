// ═══════════════════════════════════════════════════════════════════════════
//  BORRADO DE USUARIO: UNO SOLO Y CON ARCHIVADO PREVIO — v535
// ═══════════════════════════════════════════════════════════════════════════
//  El autor pidió poder eliminar usuarios desde los tres paneles (SuperAdmin,
//  Club e Individual), "con paridad". Antes de escribir nada se miró qué había:
//
//   · CLUB      · ya lo tenía, y bien: revoca, archiva y VERIFICA.
//   · INDIVIDUAL· tenía botón, pero llamaba directo a `deleteAuthUser` y se
//                 SALTABA el archivado → la pérdida de datos de v502.
//   · SUPERADMIN· no lo tenía en el árbol de categorías.
//   · y suelta, una `deleteUserPermanently()` que borraba sin archivar y no
//     llamaba nadie: una mina esperando a que alguien la cableara.
//
//  🔑 PARIDAD DE VERDAD = los tres archivan antes de borrar. No que los tres
//  tengan botón.
//
//  Reglas suyas (implementar.txt, 2026-08-14):
//   1. El SuperAdmin puede borrar a cualquiera de los niveles inferiores.
//   2. En el árbol del SA la confirmación es OBLIGATORIAMENTE tecleando el
//      correo — "máxima seguridad".
//   3. Para un Administrador de Club se ofrece el desmantelado completo del
//      club (saDeleteClubComplete), porque borrar sólo su cuenta dejaría el
//      club vivo y sin nadie que lo administre.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const SRC_TREE = fs.readFileSync(path.join(RAIZ, 'js/admin/shared/category-tree.js'), 'utf8');
const SRC_IND  = fs.readFileSync(path.join(RAIZ, 'js/admin/individual/panel.js'), 'utf8');
const SRC_UM   = fs.readFileSync(path.join(RAIZ, 'js/services/user-management.js'), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}
const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '')
                     .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

// ── Sandbox que EJECUTA el flujo, con el servidor y los diálogos simulados ──
// ⚠️ v581 · `revocaOK` modela lo que DEVUELVE `caSetUserStatus`. Desde v581 la
//    revocación de una plaza puede no ocurrir (la fila no corresponde a ninguna
//    plaza viva) y el borrado tiene que DETENERSE ahí: archivar y borrar la
//    cuenta después de una revocación que no pasó es media operación, y era
//    justo el daño que reportó el autor. El doble suelta `true` por defecto,
//    que es el caso normal.
function entorno({ tecleado = null, confirma = true, revocaOK = true } = {}) {
    const llamadas = { function: [], club: [], prompts: [], alerts: [], revocaciones: [] };
    const sb = {
        console: { log() {}, warn() {}, error() {} },
        document: { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {} }),
                    addEventListener() {}, querySelectorAll: () => [] },
        setTimeout: () => {}, ROLE_META: {}, showToast: () => {},
        prompt: (txt) => { llamadas.prompts.push(txt); return tecleado; },
        confirm: (txt) => { llamadas.prompts.push(txt); return confirma; },
        alert: (txt) => { llamadas.alerts.push(txt); },
        navReload: () => {},
        caSetUserStatus: async (uid, email, estado, cid, rol, sinConfirmar, plaza) => {
            llamadas.revocaciones.push({ uid, email, estado, cid, rol, sinConfirmar, plaza,
                                         orden: llamadas.function.length });
            return revocaOK;
        },
        saDeleteClubComplete: (clubId, clubName) => { llamadas.club.push({ clubId, clubName }); return true; },
        saFS: async () => ({
            fa: { functions: {} },
            httpsCallable: (fns, nombre) => async (payload) => {
                llamadas.function.push({ nombre, payload });
                return { data: { documentosArchivados: 3, clavesArchivadas: 9, cuentaBorrada: true, rolesRestantes: [] } };
            },
        }),
        _llamadas: llamadas,
    };
    sb.window = sb;
    vm.createContext(sb);
    try { vm.runInContext(SRC_TREE, sb); } catch (e) { console.log('  (aviso: ' + e.message + ')'); }
    return sb;
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · nadie se borra sin archivar antes ──');
// ───────────────────────────────────────────────────────────────────────────
{
    const sb = entorno({ tecleado: 'nena@club.es' });
    ok('1a · existe un único flujo de borrado', typeof sb.window.cronosEliminarUsuarioSeguro === 'function');
}
(async () => {
    {
        const sb = entorno({ tecleado: 'nena@club.es' });
        const r = await sb.window.cronosEliminarUsuarioSeguro({
            uid: 'U1', email: 'nena@club.es', role: 'user', clubId: 'club_1',
        });
        const f = sb._llamadas.function[0];
        ok('1b · 🔑🔑 se borra llamando a archiveAndDeleteCoach (archiva y VERIFICA)',
           !!f && f.nombre === 'archiveAndDeleteCoach', f ? f.nombre : '(no llamó a nada)');
        ok('1c · con el uid y el correo del objetivo',
           !!f && f.payload.uid === 'U1' && f.payload.email === 'nena@club.es',
           f ? JSON.stringify(f.payload) : '—');
        ok('1d · y devuelve que se hizo', r === true);

        // ════════════════════════════════════════════════════════════════
        //  🔑🔑🔑 EL FALLO DE v535, REPORTADO POR ÉL: desde el árbol del SA
        //  "la acción no termina y el miembro sigue apareciendo". Faltaba
        //  REVOCAR LA CASILLA ANTES de llamar a la Function: ésta decide con
        //  `rolesVivos.length === 0`, así que con el rol vivo archivaba pero
        //  no borraba, y el rol se seguía pintando en el árbol.
        // ════════════════════════════════════════════════════════════════
        const rev = sb._llamadas.revocaciones[0];
        ok('1d2 · 🔑🔑🔑 se revoca la casilla ANTES de archivar (era el fallo de v535)',
           !!rev && rev.orden === 0, rev ? JSON.stringify(rev) : '(no se revocó nada)');
        ok('1d3 · la revocación va con el club y el rol de la fila',
           !!rev && rev.estado === 'removed' && rev.cid === 'club_1' && rev.rol === 'user',
           rev ? JSON.stringify(rev) : '—');
        ok('1d4 · y sin volver a preguntar: ya confirmó tecleando el correo',
           !!rev && rev.sinConfirmar === true);
    }
    {
        // ════════════════════════════════════════════════════════════════
        //  🔑🔑🔑 v581 · SE REVOCA UNA **PLAZA**, NO UN ROL
        //
        //  Reporte del autor (CD Días): borrar desde una fila descolocada
        //  del árbol del SA amenazaba el equipo que el entrenador SÍ tenía
        //  bien asignado. La causa: `caSetUserStatus` selecciona por (club +
        //  nombre de rol), y desde v537 un entrenador tiene DOS entradas
        //  'user' en el mismo club (un F7 y un F11). Sin la categoría de la
        //  fila, la puntería coge las dos.
        // ════════════════════════════════════════════════════════════════
        const sb = entorno({ tecleado: 'nena@club.es' });
        await sb.window.cronosEliminarUsuarioSeguro({
            uid: 'U1', email: 'nena@club.es', role: 'user', clubId: 'club_1',
            category: 'Prebenjamín', subcategory: 'A',
        });
        const rev = sb._llamadas.revocaciones[0];
        ok('1d6 · 🔑🔑🔑 la revocación viaja con la CATEGORÍA de la fila (la plaza, no el rol)',
           !!rev && !!rev.plaza && rev.plaza.category === 'Prebenjamín' && rev.plaza.subcategory === 'A',
           rev ? JSON.stringify(rev.plaza) : '(no se revocó nada)');
        const f = sb._llamadas.function[0];
        ok('1d7 · y la Function también la recibe, para archivar en el equipo correcto',
           !!f && f.payload.category === 'Prebenjamín' && f.payload.subcategory === 'A',
           f ? JSON.stringify(f.payload) : '—');
    }
    {
        // ⚠️ v581 · SI LA PLAZA NO SE LIBERA, NO SE ARCHIVA NI SE BORRA.
        //    Antes se daba la revocación por hecha pasara lo que pasara: el
        //    aviso "la plaza NO se ha liberado" llegaba DESPUÉS de archivar y
        //    con la cuenta ya en manos de la Function.
        const sb = entorno({ tecleado: 'nena@club.es', revocaOK: false });
        const r = await sb.window.cronosEliminarUsuarioSeguro({
            uid: 'U1', email: 'nena@club.es', role: 'user', clubId: 'club_1',
            category: 'Prebenjamín', subcategory: 'A',
        });
        ok('1d8 · 🔑🔑🔑 si la plaza no se libera, NO se llama al servidor',
           sb._llamadas.function.length === 0 && r === false,
           'llamadas=' + sb._llamadas.function.length + ' r=' + r);
        ok('1d9 · y se dice que su vínculo real sigue intacto',
           sb._llamadas.alerts.some(a => /No se ha tocado nada|INTACTO/i.test(a)),
           JSON.stringify(sb._llamadas.alerts).slice(0, 140));
    }
    {
        // Sin clubId no se puede revocar una casilla concreta: se archiva
        // igual, pero se DICE, en vez de aparentar un borrado que no ocurrió.
        const sb = entorno({ tecleado: 'sub@ente.es' });
        await sb.window.cronosEliminarUsuarioSeguro({ uid: 'S1', email: 'sub@ente.es' });
        ok('1d5 · ⚠️ sin club no se revoca, y el aviso lo dice',
           sb._llamadas.revocaciones.length === 0 &&
           sb._llamadas.alerts.some(a => /no había plaza que liberar|NO se ha liberado/i.test(a)),
           JSON.stringify(sb._llamadas.alerts).slice(0, 140));
    }
    {
        // ⚠️ LA REGLA 2 DEL AUTOR: sin teclear el correo NO se borra.
        const sb = entorno({ tecleado: 'otro@correo.es' });
        const r = await sb.window.cronosEliminarUsuarioSeguro({
            uid: 'U1', email: 'nena@club.es', role: 'user',
        });
        ok('1e · 🔑🔑🔑 si el correo tecleado NO coincide, no se llama al servidor',
           sb._llamadas.function.length === 0 && r === false,
           JSON.stringify(sb._llamadas.function));
        ok('1e2 · y se dice que no se ha hecho nada',
           sb._llamadas.alerts.some(a => /no se ha hecho nada/i.test(a)));
    }
    {
        // Cancelar el diálogo tampoco borra.
        const sb = entorno({ tecleado: null });
        const r = await sb.window.cronosEliminarUsuarioSeguro({
            uid: 'U1', email: 'nena@club.es', role: 'user',
        });
        ok('1f · cancelar el diálogo no borra nada',
           sb._llamadas.function.length === 0 && r === false);
    }
    {
        const sb = entorno({ tecleado: 'NENA@CLUB.ES  ' });
        await sb.window.cronosEliminarUsuarioSeguro({ uid: 'U1', email: 'nena@club.es', role: 'user' });
        ok('1g · el cotejo del correo no distingue mayúsculas ni espacios',
           sb._llamadas.function.length === 1);
    }

    // ───────────────────────────────────────────────────────────────────────
    console.log('\n── PARTE 2 · un Administrador de Club desmantela el club ──');
    // ───────────────────────────────────────────────────────────────────────
    {
        const sb = entorno({ confirma: true });
        await sb.window.cronosEliminarUsuarioSeguro({
            uid: 'A1', email: 'admin@club.es', role: 'club_admin',
            clubId: 'club_1', clubName: 'CD DÍA',
        });
        ok('2a · 🔑 se ofrece el borrado completo del club, no el de la cuenta suelta',
           sb._llamadas.club.length === 1 && sb._llamadas.club[0].clubId === 'club_1',
           JSON.stringify(sb._llamadas.club));
        ok('2b · ⚠️ y NO se intenta borrar su cuenta por la vía del entrenador',
           sb._llamadas.function.length === 0,
           JSON.stringify(sb._llamadas.function));
        ok('2c · se avisa de la consecuencia antes de seguir',
           sb._llamadas.prompts.some(p => /sin nadie|administre|BORRADO COMPLETO/i.test(p)));
    }
    {
        const sb = entorno({ confirma: false });
        await sb.window.cronosEliminarUsuarioSeguro({
            uid: 'A1', email: 'admin@club.es', role: 'club_admin', clubId: 'club_1',
        });
        ok('2d · si no confirma, no se desmantela nada',
           sb._llamadas.club.length === 0 && sb._llamadas.function.length === 0);
    }
    {
        // Un admin individual tampoco se borra por la vía del entrenador.
        const sb = entorno({ tecleado: 'ind@x.es' });
        await sb.window.cronosEliminarUsuarioSeguro({
            uid: 'I1', email: 'ind@x.es', role: 'individual_admin',
        });
        ok('2e · una cuenta administradora individual no se borra desde aquí',
           sb._llamadas.function.length === 0 && sb._llamadas.club.length === 0);
    }

    // ───────────────────────────────────────────────────────────────────────
    console.log('\n── PARTE 3 · los tres paneles, el mismo flujo ──');
    // ───────────────────────────────────────────────────────────────────────
    {
        const COD_IND = sinCom(SRC_IND);
        // ⚠️ NO BASTA CON QUE EL NOMBRE APAREZCA. La primera versión de esta
        // aserción daba VERDE con el defecto puesto: el `if (typeof
        // window.cronosEliminarUsuarioSeguro === 'function')` seguía ahí
        // mientras el cuerpo volvía a `indDeleteParent`. Lo cazó el red-check
        // por mutación. Se mide lo que la función DEVUELVE.
        const _iInd = COD_IND.indexOf('window.indEliminarUsuario');
        const _cuerpoInd = _iInd === -1 ? '' : COD_IND.slice(_iInd, _iInd + 900);
        ok('3a · 🔑🔑 el panel Individual DELEGA en el borrado seguro',
           /return window\.cronosEliminarUsuarioSeguro\(/.test(_cuerpoInd),
           'indEliminarUsuario no delega: ' + _cuerpoInd.replace(/\s+/g, ' ').slice(0, 110));
        ok('3a0 · 🔑 y ya no llama al borrado sin archivar',
           !/indDeleteParent\(/.test(_cuerpoInd),
           'sigue cayendo en indDeleteParent, que se salta el archivado');
        ok('3a2 · y su botón 🗑️ sigue existiendo', /indEliminarUsuario/.test(COD_IND));

        const CLUB = sinCom(fs.readFileSync(path.join(RAIZ, 'js/admin/club/panel.js'), 'utf8'));
        ok('3b · el panel de Club conserva su archivado verificado',
           /archiveAndDeleteCoach/.test(CLUB));

        const CLUBS_TAB = sinCom(fs.readFileSync(path.join(RAIZ, 'js/admin/superadmin/clubs-tab.js'), 'utf8'));
        const ENT = sinCom(fs.readFileSync(path.join(RAIZ, 'js/admin/superadmin/individual-entity.js'), 'utf8'));
        ok('3c · 🔑 el árbol del SuperAdmin pide el botón de borrar',
           /conBorrado\s*:\s*true/.test(CLUBS_TAB), 'el árbol del SA seguiría sin poder eliminar');
        ok('3c2 · y también el árbol de entes individuales del SA',
           /conBorrado\s*:\s*true/.test(ENT));

        // ⚠️ OPT-IN: el helper es compartido. Sin la opción, ni un botón.
        const COD_TREE = sinCom(SRC_TREE);
        ok('3d · ⚠️ el botón es OPT-IN: sin `conBorrado` no se pinta',
           /_opcionesRender\.conBorrado/.test(COD_TREE) &&
           /if \(!_opcionesRender \|\| !_opcionesRender\.conBorrado\) return '';/.test(COD_TREE),
           'una acción destructiva por defecto se colaría en paneles que no la piden');
        // 🔑 La trampa del map: `usersArr.map(_userRowHtml)` pasa el ÍNDICE.
        ok('3e · 🔑 las opciones no viajan como 2º parámetro de la fila (map pasa el índice)',
           !/function _userRowHtml\(u,\s*opts\)/.test(COD_TREE),
           'con map(), `opts` sería un número y el botón nunca aparecería');
    }
    {
        const COD_UM = sinCom(SRC_UM);
        ok('3f · ⚠️ la `deleteUserPermanently()` que borraba sin archivar ya no existe',
           !/function deleteUserPermanently/.test(COD_UM) &&
           !/window\.deleteUserPermanently\s*=/.test(COD_UM),
           'seguiría suelta, esperando a que alguien la cableara');
    }

    // ───────────────────────────────────────────────────────────────────────
    console.log('\n── PARTE 4 · lo que NO puede romperse ──');
    // ───────────────────────────────────────────────────────────────────────
    {
        const sb = entorno({ tecleado: 'x@y.z' });
        const r1 = await sb.window.cronosEliminarUsuarioSeguro({});
        const r2 = await sb.window.cronosEliminarUsuarioSeguro({ uid: 'U1' });
        ok('4a · sin uid o sin correo no se llama al servidor',
           r1 === false && r2 === false && sb._llamadas.function.length === 0);
    }
    {
        // Si el servidor falla, se dice y NO se da por hecho el borrado.
        const sb = entorno({ tecleado: 'nena@club.es' });
        sb.saFS = async () => ({ fa: { functions: {} },
            httpsCallable: () => async () => { throw new Error('no se pudo verificar el archivado'); } });
        const r = await sb.window.cronosEliminarUsuarioSeguro({
            uid: 'U1', email: 'nena@club.es', role: 'user',
        });
        ok('4b · 🔑 si el archivado no se verifica, se avisa y no se canta éxito',
           r === false && sb._llamadas.alerts.some(a => /No se ha completado/i.test(a)),
           JSON.stringify(sb._llamadas.alerts).slice(0, 120));
    }

    console.log('\n' + '─'.repeat(70));
    console.log(`Resultado: ${total - fallos}/${total}`);
    if (fallos) {
        console.log(`❌ ${fallos} aserción(es) en rojo`);
        process.exit(1);
    }
    console.log('✅ Un solo borrado, con archivado previo, en los tres paneles');
})();
