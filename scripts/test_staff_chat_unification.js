// ─────────────────────────────────────────────────────────────────────────
// test_staff_chat_unification.js  ·  Fix chats entrenador<->director/coordinador
//
// Problema reportado: (1) "Missing or insufficient permissions"/"Error al
// cargar" al leer/escribir mensajes entre roles; (2) estructura rota: cada
// destinatario debe verse en un chat independiente segun la logistica:
//   Padre <-> solo su entrenador. Entrenador <-> director+coordinador+padres.
//   Coordinador <-> director+entrenadores. Director <-> coordinador+entrenadores.
//
// Causa raiz encontrada entonces:
//   A) DOS formulas distintas para el MISMO hilo (comms/panel.js calculaba
//      `${clubId}_${staffUid}`, club-reports.js `${clubId}_${coachUid}`) ->
//      dos documentos de Firestore que nunca se reconciliaban.
//   B) club-reports.js reutilizaba sender:'parent' y la perspectiva 'parent'
//      del renderizador del padre (copia-pega): etiquetaba siempre
//      "Padre/Tutor" y, en un hilo staff<->staff, AMBOS lados escribian
//      'parent' -> imposible distinguir quien escribio que.
//   C) firestore.rules no tenia rama explicita por `staffUid` en
//      cronos_messages.
//
// ══════════════════════════════════════════════════════════════════════════
//  ⚠️ 2026-08-27 · 20 DE 36 ASERCIONES BUSCABAN CODIGO QUE YA NO EXISTE…
//     …Y LAS 16 QUE PASABAN ERAN LAS QUE PROBABAN CODIGO MUERTO
//
//  El arreglo original vivia en dos helpers compartidos de js/core/utils.js
//  (_cronosStaffChatThreadId / _cronosPeerChatThreadId) y en las funciones de
//  envio de club-reports.js. Hoy:
//
//   · club-reports.js NO ENVIA NADA: sdSendBulkMsg y sdSendReplyToCoach se
//     retiraron al unificar la mensajeria en el motor _um* de panel.js.
//   · El hilo del chat lo calculan _cThreadId + _getCanonicalContext, no los
//     dos helpers de utils.js — que siguen DEFINIDOS pero YA NO LOS LLAMA
//     NADIE (comprobado sobre todo js/). Las Partes 2, 8 y 9 de este test
//     ejercitaban justo eso: 16 aserciones en verde sobre codigo muerto.
//
//  🔑 Que los dos lados calculen el MISMO hilo lo cubre hoy, contra el codigo
//     vivo, test_role_thread_canonical.js (11 aserciones). Aqui se queda lo
//     que ese no mira: que no vuelva a haber DOS formulas, que el remitente
//     viaje de verdad, y las ramas de firestore.rules.
//
//  ⚠️ La Parte 7 fallaba por REDACCION, no por fondo: v436/v437 reescribieron
//     las reglas para leer con .get(campo, default) —porque leer una clave
//     AUSENTE de un mapa LANZA, y un error en la condicion equivale a DENY
//     para la condicion ENTERA— y el test seguia buscando `staffUid != null`.
//     Las ramas staffUid estan todas. Ahora se mide la forma SEGURA.
// ══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

console.log('── Unificación de chats entrenador<->director/coordinador ──\n');

const utilsSrc   = fs.readFileSync(path.join(ROOT, 'js', 'core', 'utils.js'), 'utf8');
const commsSrc   = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'panel.js'), 'utf8');
const reportsSrc = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'reports', 'club-reports.js'), 'utf8');
const rulesSrc   = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const indexSrc   = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ═══════════════════ PARTE 1 · orden de carga (index.html) ═════════════════
console.log('── PARTE 1 · orden de carga ──');
const idxUtils   = indexSrc.indexOf('core/utils.js');
const idxComms   = indexSrc.indexOf('coach/comms/panel.js');
const idxReports = indexSrc.indexOf('coach/reports/club-reports.js');
ok('1a · utils.js carga ANTES que comms/panel.js', idxUtils !== -1 && idxComms !== -1 && idxUtils < idxComms);
ok('1b · utils.js carga ANTES que club-reports.js', idxUtils !== -1 && idxReports !== -1 && idxUtils < idxReports);

// ═══════ PARTE 2 · UNA sola fórmula para el hilo del chat ═════════════════
// El fondo del defecto A no era qué fórmula, era que hubiera DOS.
console.log('\n── PARTE 2 · una sola fórmula para el hilo del chat ──');

ok('2a · el hilo del chat lo calcula _cThreadId sobre el contexto canónico',
   /function _cThreadId\(senderUid, recipientUid, tabContext\)/.test(commsSrc) &&
   /function _getCanonicalContext\(role, tabId\)/.test(commsSrc));

// Ningún call-site puede pasar la pestaña CRUDA: la misma relación se llama
// distinto según quién mire (el entrenador ve "director"; el director ve
// "coaches" para hablar con entrenadores), así que sin canonicalizar cada lado
// escribiría en un documento distinto. Unos canonicalizan en línea y otros lo
// guardan antes en `tabContext`; lo que no vale es ninguna de las dos.
{
    // Los call-sites que ESCRIBEN o abren un hilo van todos con `me.uid`.
    const llamadas = (sinComentarios(commsSrc)
        .match(/_cThreadId\(me\.uid,(?:[^()]|\([^()]*\))*\)/g) || []);
    const sinCanonizar = llamadas.filter(c => !/_getCanonicalContext\(|tabContext/.test(c));
    ok('2b · y NINGÚN call-site de escritura pasa la pestaña cruda',
       llamadas.length >= 3 && sinCanonizar.length === 0,
       'llamadas=' + llamadas.length + ' sin canonizar=' + JSON.stringify(sinCanonizar));

    // ⚠️ La ÚNICA llamada que sí usa la pestaña cruda es deliberada y de
    //    LECTURA: _resolveThreadDoc rastrea hilos heredados (los que se
    //    escribieron antes de canonicalizar) para no perder historial. Pero el
    //    id canónico tiene que ir PRIMERO en la lista de candidatos, o un
    //    documento viejo ganaría al bueno y la conversación volvería a
    //    partirse en dos.
    ok('2c · _resolveThreadDoc rastrea ids heredados, pero prueba el canónico PRIMERO',
       /const canonicalId = _cThreadId\(myUid, contactUid, canonicalCtx\);\s*\n\s*const candidates = \[\s*\n\s*canonicalId,/.test(commsSrc));
}

ok('2d · [FIX] ya no queda la fórmula vieja `${clubId}_${u.uid}` para coach<->staff',
   !/u\.role === 'user' \? `\$\{clubId\}_\$\{u\.uid\}`/.test(reportsSrc));

// 🔑 LOS DOS HELPERS VIEJOS SIGUEN DEFINIDOS EN utils.js PERO NO LOS LLAMA
//    NADIE. Mientras nadie los llame son inofensivos; el dia que alguien los
//    reconecte vuelve a haber DOS formulas para el mismo hilo, que es
//    exactamente el defecto A. Esta aserción es el pestillo.
{
    const productos = [utilsSrc, commsSrc, reportsSrc,
        fs.readFileSync(path.join(ROOT, 'js', 'parent', 'panel.js'), 'utf8')];
    const usos = productos
        .map(s => (sinComentarios(s).match(/_cronos(Staff|Peer)ChatThreadId\s*\(/g) || []).length)
        .reduce((a, b) => a + b, 0);
    ok('2e · 🔑 nadie CALCULA hilos de chat con los helpers antiguos de utils.js',
       usos === 0,
       'si esto cae, han vuelto las DOS fórmulas para la misma conversación (defecto A)');
}

// ═══════ PARTE 3 · _cStaffThreadId es el hilo de AVISOS, no el del chat ════
// No es lo mismo y conviene que no se confundan: {clubId}_{staffUid} es la
// bandeja del staff en el club (v175, deliberado), y ahí sí se juntan los
// avisos de varios entrenadores. Si alguien lo usara para el chat, dos
// entrenadores hablando con el mismo director compartirían conversación.
console.log('\n── PARTE 3 · el hilo de avisos no se mezcla con el del chat ──');

ok('3a · _cStaffThreadId sigue siendo el hilo del club para los avisos',
   /function _cStaffThreadId\(clubId, coachUid, staffUid\)/.test(commsSrc));

{
    const consumidores = ['collective-report.js', 'match-reports-auto.js', 'match-reports-send.js']
        .map(f => path.join(ROOT, 'js', 'coach', 'comms', f))
        .filter(p => fs.existsSync(p));
    const fuera = sinComentarios(commsSrc + reportsSrc);
    ok('3b · 🔑 el motor del chat NO lo usa (sólo lo usan los despachos de informes)',
       !/_cStaffThreadId\(/.test(fuera.replace(/function _cStaffThreadId\([^)]*\)/, '')) &&
       consumidores.length === 3,
       'consumidores encontrados: ' + consumidores.length);
}

// ═══════ PARTE 4 · el remitente viaja de verdad (defecto B) ═══════════════
console.log('\n── PARTE 4 · sender real, no "parent" cableado ──');

const envios = (commsSrc.match(/senderUid: me\.uid,\s*\n\s*senderRole: window\._umState\.role,/g) || []).length;
ok('4a · las dos vías de envío (individual y grupal) firman con uid Y rol activos',
   envios === 2, 'ocurrencias: ' + envios);

ok('4b · [FIX] club-reports.js ya no envía nada: no queda `sender: \'parent\'` cableado',
   !/sender:\s*'parent'/.test(sinComentarios(reportsSrc)));
ok('4c · [FIX] y sus dos funciones de envío se retiraron al unificar',
   !/sdSendBulkMsg|sdSendReplyToCoach/.test(reportsSrc),
   'si reaparecen, hay una segunda implementación de envío que se quedará atrás');

// 🔑 Con cuentas multi-rol (mismo uid como director Y coordinador) comparar
//    sólo por uid marca TODO el hilo como "mío". El rol tiene que entrar en la
//    comparación, o el propio usuario no distingue quién escribió qué.
ok('4d · 🔑 "es mío" se decide por senderUid Y senderRole (cuentas multi-rol)',
   /const isMine = m\.senderUid\s*\n?\s*\? \(m\.senderUid === me\.uid && \(!m\.senderRole \|\| m\.senderRole === window\._umState\.role\)\)/.test(commsSrc));
ok('4e · y los mensajes antiguos (sin senderUid) siguen resolviéndose por `sender`',
   /: \(m\.sender === window\._umState\.role\);/.test(commsSrc),
   'los hilos escritos antes de senderUid no pueden quedarse sin lado');

// ═══════════════════ PARTE 5 · reglas: cronos_messages ════════════════════
console.log('\n── PARTE 5 · firestore.rules ──');
const cmStart = rulesSrc.indexOf('match /cronos_messages/{threadId}');
const cmEnd = rulesSrc.indexOf('\n    match /', cmStart + 1);
const cmBlock = sinComentarios(rulesSrc.slice(cmStart, cmEnd === -1 ? undefined : cmEnd));

ok('5a · existe el bloque match /cronos_messages/{threadId}', cmStart !== -1);

// v436/v437: la forma segura es .get(campo, default). `staffUid != null` ya no
// aparece porque `uid == .get('staffUid', null)` es equivalente y no lanza.
for (const verbo of ['read', 'create', 'update', 'delete']) {
    const re = new RegExp('allow ' + verbo + ':[\\s\\S]*?staffUid[\\s\\S]*?\\);');
    ok('5b · allow ' + verbo + ' tiene rama staffUid', re.test(cmBlock));
}
ok('5c · conserva las ramas legítimas previas (participants/coachUid/parentUid)',
   /get\('coachUid'/.test(cmBlock) && /get\('parentUid'/.test(cmBlock) && /get\('participants'/.test(cmBlock));

// FIX (2ª ronda): getDoc() sobre un threadId que aún no existe deja `resource`
// a null; cualquier rama que lea resource.data.X ERRORA (no da false), y un
// error deniega la condición ENTERA. `resource == null` es seguro: un doc
// inexistente no tiene datos que proteger.
ok('5d · allow read permite resource == null (primera conversación, doc aún no creado)',
   /allow read:[\s\S]*?resource == null[\s\S]*?\);/.test(cmBlock));

// ⚠️ v437 · Y EL CAMPO AUSENTE, no sólo el documento ausente: leer una clave
//    que no está en un mapa LANZA igual. Por eso TODAS las lecturas de este
//    bloque tienen que ir por .get(campo, default) — una sola lectura cruda
//    puede tumbar la evaluación entera y devolver "Missing or insufficient
//    permissions" a quien sí tenía derecho.
{
    const crudas = (cmBlock.match(/resource\.data\.(?!get\()[a-zA-Z_]+/g) || []);
    ok('5e · 🔑 ninguna lectura cruda resource.data.<campo>: todas usan .get(campo, default)',
       crudas.length === 0, JSON.stringify(crudas));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
