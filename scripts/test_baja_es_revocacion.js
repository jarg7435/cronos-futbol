// ════════════════════════════════════════════════════════════════
// La baja de un usuario es una REVOCACIÓN, no un borrado.
// ════════════════════════════════════════════════════════════════
// Cubre dos cosas que se rompen en silencio:
//
//  1. Que el camino 'removed' de caSetUserStatus no vuelva a borrar
//     documentos ni la cuenta de Auth.
//  2. ⚠️ Que TODO campo que ese camino escribe en users/{uid} esté en la
//     lista blanca de isMembershipDecision() de firestore.rules. Esto no
//     es cosmético: las reglas usan hasOnly(), así que UN SOLO campo
//     fuera de la lista no se ignora — hace fallar la escritura ENTERA
//     con "Missing or insufficient permissions", y el administrador de
//     club se queda sin poder dar de baja a nadie. El fallo aparecería
//     solo en producción, porque staging habla con las reglas de prod.
//
// Se compara CÓDIGO contra REGLAS, que son los dos artefactos que tienen
// que estar de acuerdo. Si alguien añade un campo a la revocación sin
// tocar las reglas (o al revés), esto se pone rojo.

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const panel = fs.readFileSync(path.join(RAIZ, 'js/admin/club/panel.js'), 'utf8');
const reglas = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');

let fallos = 0;
const rojo = (msg, detalle) => {
    fallos++;
    console.log('  ROJO  ' + msg + (detalle ? '\n        ' + detalle : ''));
};
const verde = (msg) => console.log('  verde ' + msg);

// ── Aislar el cuerpo de caSetUserStatus ─────────────────────────
// Desde su declaración hasta la siguiente asignación a window.ca*, que es
// como está estructurado el fichero.
const ini = panel.indexOf('window.caSetUserStatus = async');
if (ini === -1) {
    rojo('No se encuentra window.caSetUserStatus en panel.js');
    process.exit(1);
}
const resto = panel.slice(ini + 30);
const sig = resto.search(/\n    window\.ca[A-Za-z]+ = /);
const cuerpo = sig === -1 ? resto : resto.slice(0, sig);

// El camino de la baja: desde `if (newStatus === 'removed')` hasta el
// bloque de ACTIVAR / BLOQUEAR.
const iniBaja = cuerpo.indexOf("if (newStatus === 'removed')");
const finBaja = cuerpo.indexOf('ACTIVAR / BLOQUEAR');
if (iniBaja === -1 || finBaja === -1 || finBaja < iniBaja) {
    rojo('No se puede aislar el camino de baja dentro de caSetUserStatus');
    process.exit(1);
}
const caminoBaja = cuerpo.slice(iniBaja, finBaja);

// Quitar comentarios: el bloque explica LARGAMENTE el borrado que se
// retiró, y buscar "deleteDoc" sobre el texto con comentarios daría un
// rojo falso por las propias explicaciones.
const sinComentarios = caminoBaja
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n');

console.log('\n=== 1. La baja NO destruye nada ===');
const prohibidos = [
    ['deleteDoc(',        'borra documentos de Firestore'],
    ['deleteAuthUser',    'borra la cuenta de Firebase Auth'],
    ['auth_deletion_failures', 'cola de fallos del borrado de Auth'],
];
prohibidos.forEach(([aguja, que]) => {
    if (sinComentarios.includes(aguja)) rojo(`la baja todavía usa ${aguja} (${que})`);
    else verde(`sin ${aguja} — ${que}`);
});

console.log('\n=== 2. Los enlaces padre-jugador se conservan ===');
if (/cronos_player_links/.test(sinComentarios)) {
    rojo('la baja sigue tocando cronos_player_links');
} else {
    verde('cronos_player_links intacta');
}

console.log('\n=== 3. Sigue liberando la plaza del club ===');
// La plaza SÍ debe liberarse: la persona deja de ocuparla. Si esto
// desapareciera, el club se quedaría sin plazas al rotar entrenadores.
if (/usedSlots|_slotKey\(/.test(sinComentarios)) verde('libera usedSlots');
else rojo('la baja ya no libera la plaza del club');

console.log('\n=== 4. Revoca de verdad (isAuthorized:false) ===');
if (/isAuthorized:\s*false/.test(sinComentarios)) verde('escribe isAuthorized:false');
else rojo('la baja no escribe isAuthorized:false — no revocaría el acceso');

console.log('\n=== 5. Deja constancia de la baja ===');
if (/deletion_requests/.test(sinComentarios)) verde('registra en deletion_requests');
else rojo('la baja no deja rastro en deletion_requests');

// ── 6. Campos escritos en users/ vs. lista blanca de las reglas ──
console.log('\n=== 6. Campos escritos en users/ ⊆ isMembershipDecision() ===');

const mDecision = reglas.match(/function isMembershipDecision\(\)[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/);
if (!mDecision) {
    rojo('No se puede leer la lista blanca de isMembershipDecision() en firestore.rules');
} else {
    const permitidos = mDecision[1]
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    console.log('        lista blanca de las reglas: ' + permitidos.join(', '));

    // Campos que el camino de baja escribe en users/{...}. Se recogen de:
    //   a) el objeto `revocaRaiz` (documento primario)
    //   b) los updateDoc(doc(db, 'users', ...), { ... }) en línea (secundarios)
    const escritos = new Set();

    const mRaiz = sinComentarios.match(/var revocaRaiz = \{([\s\S]*?)\n\s*\};/);
    if (mRaiz) {
        mRaiz[1].replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g, (_, k) => { escritos.add(k); return _; });
    } else {
        rojo('No se encuentra el objeto revocaRaiz en el camino de baja');
    }
    // Asignaciones posteriores del tipo revocaRaiz.campo = ...
    sinComentarios.replace(/revocaRaiz\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g,
        (_, k) => { escritos.add(k); return _; });

    // updateDoc sobre users/ con objeto literal en línea
    const reUpd = /updateDoc\(\s*doc\(db,\s*'users',[^)]*\),\s*\{([\s\S]*?)\}\s*\)/g;
    let m;
    while ((m = reUpd.exec(sinComentarios)) !== null) {
        m[1].replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g, (_, k) => { escritos.add(k); return _; });
    }

    if (escritos.size === 0) {
        rojo('No se ha detectado ningún campo escrito en users/ — el análisis no está midiendo nada');
    } else {
        console.log('        campos que escribe la baja:  ' + [...escritos].join(', '));
        [...escritos].forEach(campo => {
            if (permitidos.includes(campo)) verde(`'${campo}' permitido por las reglas`);
            else rojo(`'${campo}' NO está en isMembershipDecision()`,
                      'hasOnly() haría fallar TODA la escritura, no solo este campo');
        });
    }
}

console.log('\n' + (fallos === 0 ? 'TODO VERDE' : fallos + ' FALLO(S)'));
process.exit(fallos === 0 ? 0 : 1);
