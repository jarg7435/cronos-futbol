// ─────────────────────────────────────────────────────────────────────────
// test_parent_uid_resolution.js · Canal Entrenador<->Padre sin recibir
// mensajes en NINGUNA direccion (mensajes.txt, ronda de pruebas con
// "hola, papa de Bruno" / "Hola entrenador, soy el papa de Bruno").
//
// Causa: la pestana "Padres" del Entrenador (js/coach/comms/panel.js,
// _loadUnifiedContactList) construye cada contacto con
// `uid: l.parentUid || l._id` (l = doc de cronos_player_links). Si el
// enlace se creo ANTES de que el padre completara su registro (o si la
// vinculacion automatica por inviteCode fallo en auth.js), l.parentUid
// queda vacio y el contacto usa `l._id` (el id del documento del enlace,
// tipo `${clubId}_${playerNumber}` - NO un uid de Firebase Auth real) como
// uid del padre.
//
// _cThreadId ordena [uid_entrenador, uid_padre] + contexto canonico. Si el
// entrenador calcula el hilo con `l._id` (falso) y el padre (con su sesion
// real) calcula el MISMO hilo con su uid REAL, los dos ids nunca coinciden
// -> ninguno de los 2 paneles ve los mensajes del otro, en NINGUNA
// direccion (exactamente el sintoma reportado).
//
// Fix: si l.parentUid falta, resolver el uid real buscando por email en
// clubUsers (ya cargado y reconciliado por clubId/allRoles mas arriba en
// la misma funcion) - mismo patron de robustez que ya usa
// _cronosResolveParentReportTargets para los informes.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── Resolución robusta del uid real del padre (pestaña Padres del Entrenador) ──\n');

const commsSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

console.log('── PARTE 1 · estructura del código real ──');
ok('1a · [FIX] ya no queda `uid: l.parentUid || l._id` sin resolución robusta',
   !/uid:\s*l\.parentUid \|\| l\._id/.test(commsSrc));
ok('1b · [FIX] si falta parentUid, busca por email en clubUsers antes de caer al id del enlace',
   /let resolvedUid = l\.parentUid \|\| '';[\s\S]{0,300}clubUsers\.find\(u => u\.email/.test(commsSrc));
ok('1c · el id del enlace (l._id) sigue como último recurso si tampoco hay match por email',
   /resolvedUid = resolvedUid \|\| l\._id;/.test(commsSrc));

// ═══════════ PARTE 2 · simulación del algoritmo de resolución ═══════════
console.log('\n── PARTE 2 · simulación con el caso real reportado (link sin parentUid) ──');

function resolveParentUid(l, clubUsers) {
    let resolvedUid = l.parentUid || '';
    if (!resolvedUid && l.parentEmail) {
        const match = clubUsers.find(u => u.email && String(u.email).toLowerCase() === String(l.parentEmail).toLowerCase());
        if (match) resolvedUid = match.uid;
    }
    return resolvedUid || l._id;
}

// El enlace de Bruno se creó cuando el entrenador lo dio de alta, ANTES de
// que el padre completara su registro -> parentUid quedó vacío.
const linkSinParentUid = {
    _id: 'club-cddia_10',
    clubId: 'club-cddia',
    playerAlias: 'Bruno',
    playerNumber: '10',
    parentEmail: 'papa.bruno@example.com',
    parentUid: '', // <- vacío, el bug real
    category: 'alevin', subcategory: 'C',
};

// El padre SÍ está registrado en 'users' con el mismo email (ya reconciliado
// en clubUsers por el fix de clubId/documentos secundarios).
const clubUsers = [
    { uid: 'coach-uid', email: 'coach@cddia.com', role: 'user', category: 'alevin', subcategory: 'C' },
    { uid: 'papa-bruno-real-uid', email: 'papa.bruno@example.com', role: 'parent' },
];

const resolved = resolveParentUid(linkSinParentUid, clubUsers);
ok('2a · [HUECO CERRADO] con parentUid vacío pero email coincidente, resuelve el uid REAL del padre',
   resolved === 'papa-bruno-real-uid', 'resuelto: ' + resolved);

// Caso normal: el enlace SÍ tiene parentUid (flujo de vinculación inmediata
// funcionó) -> debe usarse directamente, sin depender del email.
const linkConParentUid = { ...linkSinParentUid, parentUid: 'papa-bruno-real-uid' };
ok('2b · con parentUid ya presente, se usa directamente (no rompe el caso normal)',
   resolveParentUid(linkConParentUid, clubUsers) === 'papa-bruno-real-uid');

// Caso sin ningún registro real (ni parentUid ni cuenta con ese email) ->
// último recurso, el id del propio enlace (comportamiento previo, no regresa).
const linkSinNadie = { ...linkSinParentUid, parentEmail: 'nadie@example.com' };
ok('2c · sin parentUid NI cuenta registrada con ese email, cae al id del enlace (último recurso)',
   resolveParentUid(linkSinNadie, clubUsers) === 'club-cddia_10');

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
