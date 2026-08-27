// ─────────────────────────────────────────────────────────────────────────
// test_stale_chat_pane_reset.js  ·  5ª ronda tras pruebas del usuario:
// "los mensajes enviados al director deportivo se comparten o se mezclan
// erróneamente apareciendo también en el chat del coordinador (y viceversa)"
//
// El usuario confirmó con un diagnóstico contra Firestore real que AMBOS
// mensajes ("hola señor director" y "hola señor coordinador", enviados desde
// el rol de entrenador) acabaron en el MISMO documento — es decir, un fallo
// de ESCRITURA, no de lectura.
//
// Causa: el threadId venía INCRUSTADO en el marcado del panel de conversación
// (sendCoachMessage('...role_director', …) dentro del textarea). Cambiar de
// pestaña repintaba la LISTA de la izquierda pero no ese panel, así que se
// podía escribir en el redactor que seguía en pantalla y el mensaje salía con
// el threadId VIEJO. El arreglo de entonces fue _resetChatThreadPane(), que
// devolvía el panel al placeholder "Selecciona un contacto".
//
// ══════════════════════════════════════════════════════════════════════════
//  ⚠️ 2026-08-27 · EL ARREGLO DE ENTONCES YA NO EXISTE — Y NO HACE FALTA
//
//  _resetChatThreadPane se retiró con la arquitectura unificada (_umState).
//  Este test seguía buscándola y llevaba un año en xfail etiquetado como
//  "test muerto". NO lo estaba: el hueco que vigila sigue siendo real; lo que
//  cambió es cómo se cierra, y ahora se cierra POR CONSTRUCCIÓN en vez de por
//  limpieza:
//
//   1. El threadId ya NO viaja en el marcado. _sendUnifiedMessage lo RECALCULA
//      en el momento del envío desde _umState.role + _umState.activeTab. El
//      puente heredado sendCoachMessage(threadId, recipientUid) sigue ahí para
//      el marcado antiguo y DESCARTA su primer argumento.
//   2. _switchUnifiedTab pone selectedContact = null al cambiar de pestaña, así
//      que no queda un destinatario colgando de la pestaña anterior.
//
//  Por eso ya no se vigila la limpieza del panel, sino las DOS piezas que
//  hacen imposible el defecto. Que el hilo se calcule igual desde los dos
//  lados lo cubre test_role_thread_canonical.js.
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── El redactor no puede quedarse apuntando al hilo anterior ──\n');

const src = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');

function extractFn(name) {
    const start = src.search(new RegExp('(?:async )?function ' + name + '\\('));
    if (start === -1) throw new Error('No se encontró ' + name);
    let depth = 0, started = false, end = start;
    for (let i = start; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        if (src[i] === '}') { depth--; if (started && depth === 0) { end = i; break; } }
    }
    return src.slice(start, end + 1);
}

// ═══════════════════ PARTE 1 · estructura ══════════════════
console.log('── PARTE 1 · estructura ──');

ok('1a · el puente heredado sendCoachMessage(threadId, …) DESCARTA el threadId',
   /window\.sendCoachMessage\s*=\s*\(threadId,\s*recipientUid\)\s*=>\s*_sendUnifiedMessage\(recipientUid\)/.test(src),
   'si volviera a reenviarlo, un marcado viejo podría escribir en el hilo equivocado');

ok('1b · _sendUnifiedMessage recalcula el hilo en el envío (no lo recibe)',
   /async function _sendUnifiedMessage\(recipientUid\)/.test(src) &&
   /const tabContext = _getCanonicalContext\(window\._umState\.role, window\._umState\.activeTab\);\s*\n\s*const threadId = _cThreadId\(me\.uid, recipientUid, tabContext\);/.test(src));

ok('1c · cambiar de pestaña suelta el contacto seleccionado y las palomillas',
   /async function _switchUnifiedTab\(tabId\) \{[\s\S]{0,300}window\._umState\.selectedContact = null;[\s\S]{0,120}window\._umState\.checkedUids\.clear\(\);/.test(src));

// ═══════════════════ PARTE 2 · ejecución REAL en sandbox ═══════════════════
console.log('\n── PARTE 2 · ejecución del código real ──');

async function run() {
    const escrituras = [];
    const me = { uid: 'coachUID', clubId: 'clubX' };

    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        showToast: () => {},
        document: {
            getElementById: (id) => (id === 'um-msg-input' ? { value: 'hola señor coordinador' } : null),
        },
        _loadUnifiedThreadMessages: async () => {},
        _loadUnifiedContactList: () => {},
        _cFS: async () => ({
            db: {},
            doc: (_db, col, id) => ({ col, id }),
            getDoc: async () => ({ exists: () => false, data: () => null }),
            setDoc: async (ref, data) => { escrituras.push({ id: ref.id, data }); },
            updateDoc: async (ref, data) => { escrituras.push({ id: ref.id, data }); },
            arrayUnion: (...v) => ({ __arrayUnion: v }),
        }),
        window: {
            _cronosCurrentUser: me,
            _umState: { role: 'coach', activeTab: 'director', selectedContact: null, contacts: [], checkedUids: new Set() },
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(
        extractFn('_getCanonicalContext') + '\n' +
        extractFn('_cThreadId') + '\n' +
        extractFn('_sendUnifiedMessage') + '\n' +
        'this.__enviar = _sendUnifiedMessage;',
        sandbox, { filename: 'panel-envio.js' });

    // 1) El entrenador está en la pestaña "Director" y envía. Se apunta el hilo.
    await sandbox.__enviar('directorUID');
    const hiloDirector = escrituras.length ? escrituras[0].id : null;
    ok('2a · con la pestaña Director, el mensaje va a su hilo', !!hiloDirector, hiloDirector);

    // 2) Cambia a "Coordinador" SIN pulsar el contacto y vuelve a escribir: es
    //    el gesto exacto que reportó el usuario.
    escrituras.length = 0;
    sandbox.window._umState.activeTab = 'coordinator';
    await sandbox.__enviar('coordinadorUID');
    const hiloCoordinador = escrituras.length ? escrituras[0].id : null;

    ok('2b · [HUECO CERRADO] tras cambiar de pestaña el mensaje NO cae en el hilo del director',
       !!hiloCoordinador && hiloCoordinador !== hiloDirector,
       'director=' + hiloDirector + ' coordinador=' + hiloCoordinador);
    ok('2c · el hilo nuevo lleva el contexto del coordinador',
       !!hiloCoordinador && /coordinator/.test(hiloCoordinador), hiloCoordinador);

    // 3) Y el puente heredado tampoco puede colar un threadId de fuera.
    escrituras.length = 0;
    sandbox.window._umState.activeTab = 'director';
    vm.runInContext('this.__puente = (threadId, recipientUid) => __enviar(recipientUid);', sandbox);
    await sandbox.__puente('clubX_coach_C_staff_S_role_coordinator', 'directorUID');
    ok('2d · el threadId que llega por el marcado heredado se IGNORA',
       escrituras.length === 1 && escrituras[0].id === hiloDirector,
       escrituras.length ? escrituras[0].id : '(sin escritura)');
}

run().then(() => {
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
}).catch(e => { console.error('ERROR ejecutando el test:', e); process.exit(1); });
