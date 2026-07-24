// ─────────────────────────────────────────────────────────────────────────
// test_manual_contact_parentuid.js · Canal Entrenador<->Padre sin recibir
// mensajes en NINGUNA dirección cuando el "padre" es un contacto MANUAL
// (emailConfig.contacts, añadido a mano por el entrenador — p.ej. desde la
// gestión de WhatsApp/email) en vez de un enlace real de
// cronos_player_links (caso confirmado en producción: Bruno, cuenta
// arinagazone@gmail.com, clubId club_mqvr9m11_g9kj — la consulta a
// cronos_player_links para ese clubId devuelve 0 documentos).
//
// Causa: en js/coach/comms/panel.js, _loadUnifiedContactList sintetiza una
// entrada de rawLinks por cada contacto manual con
// `parentUid: c.uid || c.id`. Los contactos manuales casi nunca tienen
// c.uid (son solo nombre/email/teléfono tecleados a mano), así que caía en
// c.id — el identificador LOCAL del contacto (p.ej. "new_1784759436505"),
// NO un uid real de Firebase Auth.
//
// Esto envenenaba la resolución posterior: `resolvedUid = l.parentUid || ''`
// encontraba ese id falso ya "presente" y JAMÁS llegaba a intentar el
// fallback por email contra clubUsers (que SÍ habría encontrado la cuenta
// real del padre, si existe con ese email). El resultado: el entrenador
// calcula el threadId con un uid inventado que el padre real nunca lee, y
// el padre calcula el hilo con su propio uid real — nunca coinciden, en
// NINGUNA dirección (exactamente el síntoma reportado).
//
// Fix: sintetizar `parentUid: c.uid || ''` (sin caer a c.id), dejando que
// la resolución posterior (ya con fallback por email, ver
// test_parent_uid_resolution.js) encuentre el uid real del padre.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── Contactos manuales (emailConfig.contacts) no deben envenenar parentUid ──\n');

const commsSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

console.log('── PARTE 1 · estructura del código real ──');
ok('1a · [FIX] ya no queda `parentUid: c.uid || c.id` al sintetizar contactos manuales',
   !/parentUid:\s*c\.uid \|\| c\.id/.test(commsSrc));
// Debe existir al menos una vez la forma corregida (aparece 2 veces: bloque
// activo y bloque duplicado legacy del mismo archivo).
const fixedOccurrences = (commsSrc.match(/parentUid:\s*c\.uid \|\| ''/g) || []).length;
ok('1b · [FIX] sintetiza parentUid vacío cuando el contacto manual no trae un uid real',
   fixedOccurrences >= 2, 'ocurrencias encontradas: ' + fixedOccurrences);

// ═══════════ PARTE 2 · simulación del algoritmo completo ═══════════
console.log('\n── PARTE 2 · simulación con el caso real reportado (contacto manual "Bruno") ──');

function synthesizeManualLink(c) {
    return {
        _id: c.id || 'm_random',
        parentUid: c.uid || '', // FIX: ya no cae a c.id
        parentEmail: c.email || '',
        parentPhone: c.phone || c.wa || '',
        playerAlias: c.player || c.name || 'Familiar',
        category: c.category || '',
        subcategory: c.subcategory || '',
    };
}

function resolveParentUid(l, clubUsers) {
    let resolvedUid = l.parentUid || '';
    if (!resolvedUid && l.parentEmail) {
        const match = clubUsers.find(u => u.email && String(u.email).toLowerCase() === String(l.parentEmail).toLowerCase());
        if (match) resolvedUid = match.uid;
    }
    return resolvedUid || l._id;
}

// Contacto manual real: añadido por el entrenador a mano (sin invite code),
// sin uid propio, con el email de la cuenta multi-rol que SÍ está registrada
// como padre real en 'users'.
const manualContactBruno = {
    id: 'new_1784759436505',
    type: 'parent',
    name: 'Bruno',
    email: 'arinagazone@gmail.com',
    category: 'alevin', subcategory: 'C',
};

const clubUsers = [
    { uid: 'GkycFVeqFsWD9JODEjjE3JSMw2v1', email: 'arinagazone@gmail.com', role: 'club_admin' },
];

const link = synthesizeManualLink(manualContactBruno);
ok('2a · la síntesis ya NO deja el id local ("new_...") como parentUid',
   link.parentUid === '', 'parentUid sintetizado: ' + JSON.stringify(link.parentUid));

const resolved = resolveParentUid(link, clubUsers);
ok('2b · [HUECO CERRADO] contacto manual sin uid propio resuelve al uid REAL vía email',
   resolved === 'GkycFVeqFsWD9JODEjjE3JSMw2v1', 'resuelto: ' + resolved);

// Regresión: si ALGUNA VEZ el contacto manual sí trae un uid real (por
// ejemplo, un flujo futuro que lo capture), debe seguir usándose tal cual,
// sin pasar por el fallback de email.
const manualContactConUid = { ...manualContactBruno, uid: 'uid-directo-conocido' };
const linkConUid = synthesizeManualLink(manualContactConUid);
ok('2c · si el contacto manual sí trae un uid real, se usa directamente (no rompe ese caso)',
   resolveParentUid(linkConUid, clubUsers) === 'uid-directo-conocido');

// Caso sin ninguna cuenta real con ese email -> último recurso, el id local
// del contacto (comportamiento previo, no regresa: no puede inventarse un
// uid que no existe).
const manualContactSinCuenta = { ...manualContactBruno, email: 'nadie@example.com' };
const linkSinCuenta = synthesizeManualLink(manualContactSinCuenta);
ok('2d · sin uid propio NI cuenta registrada con ese email, cae al id local (último recurso)',
   resolveParentUid(linkSinCuenta, clubUsers) === 'new_1784759436505');

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
