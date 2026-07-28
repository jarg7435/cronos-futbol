// ─────────────────────────────────────────────────────────────────────────
// test_stale_chat_pane_reset.js  ·  5ª ronda tras pruebas del usuario:
// "los mensajes enviados al director deportivo se comparten o se mezclan
// erróneamente apareciendo también en el chat del coordinador (y viceversa)"
//
// El usuario confirmó con un diagnóstico contra Firestore real que AMBOS
// mensajes ("hola señor director" y "hola señor coordinador", enviados desde
// el rol de entrenador) acabaron en el MISMO documento
// (....clubId..._coach_..._staff_..._role_director) — es decir, un fallo de
// ESCRITURA, no de lectura/visualización.
//
// Causa: js/coach/comms/panel.js tiene pestañas (Padres/Director/Coordinador)
// que refrescan la LISTA de contactos de la izquierda
// (#coach-parent-list) al cambiar de pestaña, pero NUNCA reseteaban el panel
// de conversación de la DERECHA (#cm-chat-thread-pane). Si el entrenador
// abría "Director", enviaba un mensaje, cambiaba a la pestaña "Coordinador"
// SIN hacer clic en el contacto del coordinador, y escribía directamente en
// el textarea que seguía visible (de la conversación con el director), el
// mensaje se enviaba con el threadId VIEJO (el del director) porque ese
// threadId estaba incrustado en el textarea/botón desde que se abrió esa
// conversación — el cambio de pestaña no lo actualizaba.
//
// Fix: _resetChatThreadPane() — vuelve al placeholder "Selecciona un
// contacto" cada vez que se cambia de pestaña, obligando a un clic explícito
// en el contacto correcto antes de poder escribir.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── Panel de conversación no se reseteaba al cambiar de pestaña ──\n');

const src = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

// ═══════════════════ PARTE 1 · estructura ══════════════════
console.log('── PARTE 1 · estructura ──');
ok('1a · existe _resetChatThreadPane', /function _resetChatThreadPane\(\)/.test(src));
ok('1b · _loadStaffList llama a _resetChatThreadPane() al principio',
   /async function _loadStaffList\(selectedRole\) \{[\s\S]{0,1200}_resetChatThreadPane\(\)/.test(src));
ok('1c · _loadParentList llama a _resetChatThreadPane() al principio',
   /async function _loadParentList\(\) \{[\s\S]{0,600}_resetChatThreadPane\(\)/.test(src));

// ═══════════════════ PARTE 2 · ejecución REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecución del código real ──');

function extractFn(name) {
    const start = src.indexOf('function ' + name);
    let depth = 0, started = false, end = start;
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        if (src[i] === '}') { depth--; if (started && depth === 0) { end = i; break; } }
    }
    return src.slice(start, end + 1);
}

const sandbox = { console: { log(){}, warn(){} } };
vm.createContext(sandbox);
vm.runInContext(extractFn('_resetChatThreadPane'), sandbox);

// Simula el estado justo tras abrir una conversación con el Director: el
// pane tiene el threadId del director incrustado en su HTML (como lo dejaría
// openThreadWithStaff realmente).
let paneHtml = `<textarea onkeydown="sendCoachMessage('club_X_coach_C_staff_S_role_director', ...)"></textarea>`;
sandbox.document = {
    getElementById: (id) => (id === 'cm-chat-thread-pane' ? {
        get innerHTML() { return paneHtml; },
        set innerHTML(v) { paneHtml = v; },
    } : null),
};

ok('2a · antes del fix (simulado): el pane conserva el threadId viejo del director',
   paneHtml.includes('role_director'));

sandbox._resetChatThreadPane();

ok('2b · [HUECO CERRADO] tras cambiar de pestaña, el pane YA NO contiene el threadId viejo',
   !paneHtml.includes('role_director'), paneHtml);
ok('2c · el pane vuelve al placeholder "Selecciona un contacto"',
   /Selecciona un contacto/.test(paneHtml));
ok('2d · el placeholder ya no tiene ningún <textarea> ni onkeydown activo (no se puede escribir sin elegir contacto)',
   !/<textarea/.test(paneHtml) && !/onkeydown/.test(paneHtml));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
