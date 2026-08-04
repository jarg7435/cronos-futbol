// ─────────────────────────────────────────────────────────────────────────
// test_admin_messaging_channels.js · Red de Mensajes Internos completa
// (implementar.txt, 2026-07-30): Administrador de Club y Administrador
// Individual entran en la mensajería, y el Director gana el canal con el
// Administrador de Club.
//
// 🔑 LO QUE DE VERDAD HAY QUE FIJAR ES LA SIMETRÍA DEL CONTEXTO. El id de hilo
// se deriva de los dos uids ORDENADOS más un "contexto"
// (_getCanonicalContext + _cThreadId). Si los dos lados de un canal no calculan
// el MISMO contexto, cada uno escribe en un documento distinto: los dos ven su
// propio mensaje, ninguno ve el del otro, y no falla nada a gritos. Es el
// defecto más caro posible en una mensajería, y por eso casi todo este guard
// compara los dos lados en vez de mirar un lado solo.
//
// LAS DOS DECISIONES DEL AUTOR (2026-07-30), que este guard defiende:
//   A. El canal con el SUPERADMIN usa la convención de la bandeja del
//      SuperAdmin: `sa_<uidA>_<uidB>`. Su módulo filtra los hilos por
//      `threadId.includes('sa_')`, así que respetarla es lo que hace que los
//      mensajes que inicia un administrador aparezcan ahí SIN tocar su código.
//   B. Se REUTILIZAN contextos existentes en vez de inventar canales nuevos:
//      Administrador Individual ↔ Entrenador viaja por `coach_director`, que es
//      el contexto que el Entrenador ya usa en su pestaña "Director" — y esa
//      pestaña ya lista a los club_admin/admin. Así el panel del Entrenador no
//      se toca.
//
// ⚠️ NO HACEN FALTA REGLAS NUEVAS: las de cronos_messages son por PARTICIPANTE
// (`request.auth.uid in participants`) en lectura, creación y actualización, no
// por rol. La PARTE 5 fija que todo hilo nuevo lleve los dos uids en
// `participants`, que es lo único que sostiene ese permiso.
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
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const sinCom = (s) => s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

console.log('── Red de Mensajes Internos: Admin de Club e Individual ──\n');

const SRC = leer('js/coach/comms/panel.js');

// Las dos funciones son PURAS: se extraen y se ejecutan en un sandbox desnudo.
function cargarPuras() {
    const a = SRC.indexOf('function _getCanonicalContext');
    const b = SRC.indexOf('async function _resolveThreadDoc');
    if (a === -1 || b === -1) throw new Error('no encuentro _getCanonicalContext/_resolveThreadDoc');
    const sb = { console: { log() {}, warn() {} } };
    vm.createContext(sb);
    vm.runInContext(SRC.slice(a, b) + '\nthis.__ctx = _getCanonicalContext; this.__tid = _cThreadId;', sb);
    return { ctx: sb.__ctx, tid: sb.__tid };
}

const API_OK = (() => { try { const f = cargarPuras(); return typeof f.ctx === 'function' && typeof f.tid === 'function'; }
                        catch (_) { return false; } })();
ok('0 · se pueden extraer _getCanonicalContext y _cThreadId', API_OK);

// ═══════ PARTE 1 · las pestañas nuevas ═══════
console.log('── PARTE 1 · pestañas por rol ──');
{
    const s = sinCom(SRC);
    ok('1a · existe la entrada del Administrador de Club',
       /window\.openClubAdminMessaging\s*=/.test(s));
    ok('1b · y la del Administrador Individual',
       /window\.openIndividualAdminMessaging\s*=/.test(s));
    ok('1c · ambas están en el mapa de entradas por rol (lo usa la pila de navegación)',
       /club_admin:\s*'openClubAdminMessaging'/.test(s) &&
       /admin_individual:\s*'openIndividualAdminMessaging'/.test(s));

    // Pestañas: se acota al bloque de definición, no a todo el fichero.
    // ⚠️ Sobre SRC en crudo y NO sobre `s`: el marcador natural del bloque es un
    // comentario, y sinCom() los borra — la primera versión de este guard
    // buscaba un texto que ya no existía y daba rojo por la razón equivocada.
    const tabsBlock = SRC.slice(SRC.indexOf('let tabs = [];'),
                                SRC.indexOf("if (!tabs.find(t => t.id === tab))"));
    ok('1d · 🔑 el Admin de Club tiene SuperAdmin y Director',
       /role === 'club_admin'/.test(tabsBlock) &&
       /id: 'superadmin'/.test(tabsBlock) && /id: 'director'/.test(tabsBlock));
    ok('1e · 🔑 el Admin Individual tiene SuperAdmin y Entrenador',
       /role === 'admin_individual'/.test(tabsBlock) && /id: 'coaches'/.test(tabsBlock));
    ok('1f · 🔑 el Director gana la pestaña de Administrador de Club',
       /id: 'clubadmin'/.test(tabsBlock));
    ok('1g · y conserva las que ya tenía',
       /id: 'coordinators'/.test(tabsBlock) && /id: 'coaches'/.test(tabsBlock));

    // 🔑 HAY DOS LISTAS DE PESTAÑAS: la del render y la de _switchUnifiedTab.
    // Si una gana una pestaña y la otra no, el botón se pinta pero al pulsarlo
    // no pasa nada — sin error en consola. Se comparan rol a rol.
    const switchBlock = SRC.slice(SRC.indexOf("if (role === 'coach') tabs = ["),
                                  SRC.indexOf("if (!tabs.includes(tabId)") > -1
                                      ? SRC.indexOf("if (!tabs.includes(tabId)")
                                      : SRC.indexOf("if (role === 'coach') tabs = [") + 700);
    const delRender = (rol) => {
        const i = tabsBlock.indexOf(`role === '${rol}'`);
        if (i === -1) return [];
        const trozo = tabsBlock.slice(i, tabsBlock.indexOf('];', i));
        return (trozo.match(/id: '(\w+)'/g) || []).map(s => s.replace(/id: '|'/g, '')).sort();
    };
    const delSwitch = (rol) => {
        const m = switchBlock.match(new RegExp(`role === '${rol}'\\) tabs = \\[([^\\]]*)\\]`));
        return m ? m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean).sort() : [];
    };
    const rolesConPestanas = ['coach', 'director', 'coordinator', 'parent', 'club_admin', 'admin_individual'];
    const desalineados = rolesConPestanas.filter(r =>
        JSON.stringify(delRender(r)) !== JSON.stringify(delSwitch(r)));
    ok('1h · 🔑 las DOS listas de pestañas coinciden rol a rol',
       desalineados.length === 0,
       desalineados.map(r => r + ': render=' + JSON.stringify(delRender(r)) +
                             ' switch=' + JSON.stringify(delSwitch(r))).join(' | '));
}

// ═══════ PARTE 2 · 🔑 SIMETRÍA: los dos lados, el mismo hilo ═══════
console.log('\n── PARTE 2 · 🔑 los dos lados calculan el MISMO hilo ──');
if (!API_OK) { ok('2 · omitida: no se pudieron extraer las funciones', false); } else {
    const { ctx, tid } = cargarPuras();
    const A = 'uid_admin', D = 'uid_director', C = 'uid_coach', S = 'uid_superadmin';

    // Admin de Club ↔ Director Deportivo
    const cAdmin = ctx('club_admin', 'director');
    const cDir   = ctx('director', 'clubadmin');
    ok('2a · 🔑 Admin de Club → Director y Director → Admin de Club comparten contexto',
       cAdmin === cDir && !!cAdmin, 'admin=' + cAdmin + ' director=' + cDir);
    ok('2b · 🔑 y por tanto el MISMO id de hilo en los dos sentidos',
       tid(A, D, cAdmin) === tid(D, A, cDir), tid(A, D, cAdmin) + ' vs ' + tid(D, A, cDir));

    // Admin Individual ↔ Entrenador (decisión B: reutiliza coach_director)
    const cInd  = ctx('admin_individual', 'coaches');
    const cCoach = ctx('coach', 'director');
    ok('2c · 🔑 Admin Individual → Entrenador viaja por el contexto que el Entrenador ya usa',
       cInd === cCoach && cInd === 'coach_director', 'ind=' + cInd + ' coach=' + cCoach);
    ok('2d · 🔑 mismo id de hilo, así el Entrenador responde sin tocar su panel',
       tid(A, C, cInd) === tid(C, A, cCoach), tid(A, C, cInd) + ' vs ' + tid(C, A, cCoach));

    // El orden de los uids no puede cambiar el id.
    ok('2e · el id no depende de quién escriba primero',
       tid(A, D, cAdmin) === tid(D, A, cAdmin));

    // Los canales NO se pueden mezclar entre sí.
    ok('2f · 🔑 el canal con el Director y el canal con el Entrenador son distintos',
       tid(A, D, cAdmin) !== tid(A, D, cInd));
    ok('2g · y el contexto del Admin de Club no colisiona con director↔coordinador',
       cAdmin !== ctx('director', 'coordinators'), cAdmin);
}

// ═══════ PARTE 3 · 🔑 DECISIÓN A: el canal del SuperAdmin ═══════
console.log('\n── PARTE 3 · 🔑 el canal con el SuperAdmin usa la convención sa_ ──');
if (!API_OK) { ok('3 · omitida: no se pudieron extraer las funciones', false); } else {
    const { ctx, tid } = cargarPuras();
    const A = 'uid_admin', S = 'uid_superadmin';

    const cSaClub = ctx('club_admin', 'superadmin');
    const cSaInd  = ctx('admin_individual', 'superadmin');
    ok('3a · los dos tipos de administrador usan el mismo contexto de SuperAdmin',
       cSaClub === cSaInd && !!cSaClub, cSaClub + ' / ' + cSaInd);

    const hilo = tid(A, S, cSaClub);
    ok('3b · 🔑 el id empieza por "sa_", que es por donde filtra la bandeja del SuperAdmin',
       /^sa_/.test(hilo), hilo);
    ok('3c · 🔑 y contiene los dos uids ordenados',
       hilo === 'sa_' + [A, S].sort().join('_'), hilo);
    ok('3d · el id es el mismo escriba quien escriba primero',
       tid(A, S, cSaClub) === tid(S, A, cSaClub));

    // El filtro real de la bandeja del SuperAdmin, tal cual está en su módulo.
    const sa = sinCom(leer('js/admin/superadmin/messaging.js'));
    ok('3e · 🔑 la bandeja del SuperAdmin sigue filtrando por "sa_" (si cambia, esto deja de llegar)',
       /threadId\?\.includes\('sa_'\)/.test(sa) || /threadId.*includes.*'sa_'/.test(sa));
    ok('3f · y el SuperAdmin ya lista a los dos tipos de administrador',
       /club_admin/.test(sa) && /admin_individual/.test(sa));
    ok('3g · 🔑 el id "sa_" NO lleva sufijo de contexto, o no coincidiría con el del SuperAdmin',
       hilo.split('_').length === 3 + (A.split('_').length - 1) + (S.split('_').length - 1),
       hilo);
}

// ═══════ PARTE 4 · los botones en los paneles ═══════
console.log('\n── PARTE 4 · acceso desde los dos paneles ──');
{
    const club = sinCom(leer('js/admin/club/panel.js'));
    const ind  = sinCom(leer('js/admin/individual/panel.js'));
    ok('4a · el panel del Admin de Club abre su mensajería',
       /openClubAdminMessaging\(/.test(club));
    ok('4b · y el del Admin Individual la suya',
       /openIndividualAdminMessaging\(/.test(ind));
    ok('4c · los dos botones se llaman "Mensajes"',
       /Mensajes/.test(club) && /Mensajes/.test(ind));
    // ⚠️ En index.html comms/panel.js va DESPUÉS de los dos paneles de admin, y
    // da igual: la llamada ocurre al pulsar el botón, no al cargar. Lo que sí
    // importa es que siga siendo así — invocarla en tiempo de carga rompería por
    // orden de <script>. Se comprueba que la llamada viva dentro de un onclick.
    ok('4d · 🔑 la mensajería se invoca al pulsar, no al cargar el panel',
       /onclick="[^"]*openClubAdminMessaging\(/.test(club) &&
       /onclick="[^"]*openIndividualAdminMessaging\(/.test(ind));
}

// ═══════ PARTE 5 · 🔑 participants: lo que sostiene el permiso ═══════
console.log('\n── PARTE 5 · 🔑 participants, que es lo que permiten las reglas ──');
{
    const rules = leer('firestore.rules');
    const bloque = rules.slice(rules.indexOf('match /cronos_messages/'),
                               rules.indexOf('match /cronos_notifications/'));
    // v437: el acceso sigue siendo POR PARTICIPANTE, que es lo que esta
    // asercion protege; lo que cambió es la forma de leer el campo, que pasó a
    // `.get('participants', [])` para que un hilo sin ese campo no haga lanzar
    // la rama. El regex admite las dos formas para no atarse a la sintaxis.
    ok('5a · 🔑 las reglas de cronos_messages permiten por PARTICIPANTE, no por rol',
       /request\.auth\.uid in resource\.data(\.participants|\.get\('participants', \[\]\))/.test(bloque) &&
       /request\.auth\.uid in request\.resource\.data(\.participants|\.get\('participants', \[\]\))/.test(bloque));
    // Si esto cambiara, los canales nuevos dejarían de funcionar en producción
    // aunque toda la suite siguiera verde: por eso se fija aquí.
    ok('5b · 🔑 y por eso NO hace falta desplegar reglas para los canales nuevos',
       !/role\s*==\s*'club_admin'/.test(bloque));

    const s = sinCom(SRC);
    ok('5c · 🔑 el motor escribe participants con los dos uids al crear un hilo',
       /participants:\s*\[/.test(s));
}

// ═══════ PARTE 6 · los dos fallos vistos en el navegador ═══════
// El autor probó los canales nuevos en producción (2026-07-30) y encontró dos
// destinatarios que NO se resolvían. Las dos causas son de IDENTIDAD, no de
// hilo: el contexto era correcto, pero la lista de destinatarios salía vacía.
//
//  1. DIRECTOR → ADMIN DE CLUB: "No se encontraron destinatarios". El vínculo
//     autoritativo del administrador NO está en users/{uid}.role sino en el
//     DOCUMENTO DEL CLUB (clubs/{clubId}.adminUid / .adminEmail / .createdBy) —
//     es lo que usa el propio openClubAdminPanel para saber qué club abrir.
//     Buscar sólo por rol en `users` deja la pestaña vacía en cuanto el doc de
//     usuario no lleva el rol propagado, que es el caso normal.
//
//  2. ENTRENADOR → ADMIN INDIVIDUAL: el Entrenador no tenía por dónde
//     escribirle. La pestaña "Director" del Entrenador acepta
//     director/club_admin/admin, pero un administrador individual tiene rol
//     `individual` o `admin_individual` — nombres distintos, así que quedaba
//     fuera del filtro. (El contexto `coach_director` ya era el correcto: lo que
//     faltaba era que apareciese en la lista.)
console.log('\n── PARTE 6 · resolución de destinatarios (fallos de producción) ──');
{
    const s = sinCom(SRC);
    const bloque = (marca, fin) => {
        const i = s.indexOf(marca);
        return i === -1 ? '' : s.slice(i, fin ? s.indexOf(fin, i) : i + 2600);
    };

    // — Fallo 1 —
    // ⚠️ Ancla actualizada: la pestaña pasó a estar ANIDADA dentro de la rama del
    // Director (antes era un `else if` hermano, y por eso era inalcanzable).
    const tabClubAdmin = bloque("else if (tabId === 'clubadmin')", "else if (window._umState.role === 'coordinator')");
    ok('6a · 🔑 el Director busca al Admin de Club en el DOCUMENTO del club',
       /'clubs'/.test(tabClubAdmin), tabClubAdmin.slice(0, 200));
    // ⚠️ ESTA ASERCIÓN PEDÍA `createdBy` Y ERA ELLA LA QUE FIJABA EL FALLO:
    // el creador de un club es el SUPERADMIN (js/admin/club/panel.js escribe
    // createdBy: me.uid), así que resolver por ahí metía al SuperAdmin en la
    // lista del Director etiquetado como Administrador de Club. Ver PARTE 10.
    ok('6b · 🔑 y lo resuelve por adminUid o adminEmail (NO por createdBy)',
       /adminUid/.test(tabClubAdmin) && /adminEmail/.test(tabClubAdmin),
       tabClubAdmin.slice(0, 200));
    ok('6c · sin perder la búsqueda por rol, que sigue como respaldo',
       /club_admin/.test(tabClubAdmin));
    // Se comprueba que la lectura del club esté ENVUELTA en un try/catch, no
    // por distancia en caracteres: el bloque es largo y una ventana fija daba
    // rojo con el código ya correcto.
    ok('6d · 🔑 y tolera que la lectura del club falle, sin dejar la pestaña rota',
       /try\s*\{[\s\S]*?'clubs'[\s\S]*?\}\s*catch/.test(tabClubAdmin));

    // — Fallo 2 —
    const tabDirCoach = bloque("else if (tabId === 'director')", "else if (tabId === 'coordinator')");
    // ⚠️ Estas dos son CENSOS DE FUENTE, no pruebas de comportamiento: montar un
    // sandbox de _loadUnifiedContactList exige simular Firestore y el DOM
    // enteros. Por eso se fijan los CONSTRUCTOS exactos y no la mera presencia
    // de un identificador: con `/admin_individual/` a secas, vaciar la lista o
    // cambiar la etiqueta dejaba el guard en verde — lo destapó la prueba de rojo.
    ok('6e · 🔑 la lista de destinatarios del Entrenador INCLUYE a los admins individuales',
       /const firestoreIndAdmins = clubUsers\.filter\(_esAdminIndividual\)/.test(tabDirCoach) &&
       /\[\.\.\.staffList, \.\.\.firestoreDirs, \.\.\.firestoreIndAdmins\]/.test(tabDirCoach),
       tabDirCoach.slice(0, 300));
    ok('6f · 🔑 y se etiqueta según lo que es, no siempre como Director',
       /subtitle: `\$\{esInd \? 'Administrador Individual' : 'Director Deportivo'\}/.test(tabDirCoach),
       (tabDirCoach.match(/subtitle:[^\n]*/) || ['(no aparece)'])[0]);
    ok('6g · sin dejar de listar a los directores de siempre',
       /'director'/.test(tabDirCoach));

    // 🔑 El contexto NO cambia: el hilo del Admin Individual con su Entrenador
    // sigue siendo el mismo que ya calculaba la PARTE 2. Esto era un fallo de
    // LISTA, no de hilo, y confundirlos habría roto los hilos ya creados.
    if (API_OK) {
        const { ctx } = cargarPuras();
        ok('6h · 🔑 el contexto Admin Individual ↔ Entrenador NO se ha tocado',
           ctx('admin_individual', 'coaches') === 'coach_director' &&
           ctx('coach', 'director') === 'coach_director');
    } else { ok('6h · omitida: no se pudieron extraer las funciones', false); }
}

// ═══════ PARTE 7 · consulta DIRECTA de administradores ═══════
// Segunda ronda de pruebas del autor (2026-07-30): con v413 los destinatarios
// SEGUÍAN sin aparecer.
//
// 🔑 POR QUÉ NO BASTABA CON clubUsers NI CON _cGetStaff: la lista `clubUsers`
// descarta A PROPÓSITO los documentos SECUNDARIOS de usuario —los que auth.js
// crea al añadir un rol extra, con id `${uid}_${role}_${clubId}`— porque no
// llevan category/subcategory y contaminaban otras pestañas. Pero el rol
// `club_admin` vive justamente ahí en muchas cuentas, así que el administrador
// quedaba invisible por diseño. La solución es una consulta DIRECTA a `users`
// por clubId + rol, que no pasa por ese filtro.
//
// 🔑 Y LOS ENTES INDIVIDUALES viven en la MISMA colección `clubs` con
// type:'individual'; su administrador se enlaza por users.individualEntityId.
// Ahí no hay Director, así que la pestaña del Entrenador se ETIQUETA como
// "Admin. Individual" — pero conserva el id 'director' para no cambiar el
// contexto del hilo (ver 7f).
console.log('\n── PARTE 7 · consulta directa (segunda ronda de producción) ──');
{
    const s = sinCom(SRC);
    const bloque = (marca, fin) => {
        const i = s.indexOf(marca);
        return i === -1 ? '' : s.slice(i, fin ? s.indexOf(fin, i) : i + 3200);
    };
    // ⚠️ Ancla actualizada: la pestaña pasó a estar ANIDADA dentro de la rama del
    // Director (antes era un `else if` hermano, y por eso era inalcanzable).
    const tabClubAdmin = bloque("else if (tabId === 'clubadmin')", "else if (window._umState.role === 'coordinator')");
    const tabDirCoach  = bloque("else if (tabId === 'director')", "else if (tabId === 'coordinator')");

    // La consulta pasó a recorrer TODOS los clubIds descubiertos (PARTE 8), así
    // que el filtro es por la variable del bucle, no por `clubId` a secas.
    ok('7a · 🔑 el Director consulta users DIRECTAMENTE por clubId y rol de admin',
       /where\('clubId', '==', (clubId|cid)\)/.test(tabClubAdmin) &&
       /where\('role', 'in', \[/.test(tabClubAdmin), tabClubAdmin.slice(0, 260));
    ok('7b · y esa consulta cubre club_admin y admin',
       /'club_admin'/.test(tabClubAdmin) && /'admin'/.test(tabClubAdmin));
    ok('7c · 🔑 no depende de clubUsers, que descarta los documentos secundarios',
       /getDocs\(/.test(tabClubAdmin));

    ok('7d · 🔑 el Entrenador localiza al admin del ente por individualEntityId',
       /const _entId = me\.individualEntityId \|\| clubId/.test(tabDirCoach) &&
       /where\('individualEntityId', '==', _entId\)/.test(tabDirCoach),
       (tabDirCoach.match(/const _entId[^\n]*/) || ['(no aparece)'])[0]);
    ok('7e · y también acepta el adminUid del documento del ente',
       /adminUid/.test(tabDirCoach));

    // 🔑 La pestaña se RENOMBRA, pero su id sigue siendo 'director': el contexto
    // del hilo (coach_director) NO puede cambiar o se quedan huérfanos los hilos
    // ya creados.
    const tabsBlock = SRC.slice(SRC.indexOf('let tabs = [];'),
                                SRC.indexOf("if (!tabs.find(t => t.id === tab))"));
    ok('7f · 🔑 en ente individual la pestaña se llama "Admin. Individual"…',
       /label: _esEnteIndividual \? 'Admin\. Individual' : 'Director'/.test(tabsBlock),
       (tabsBlock.match(/label:[^\n]*Director[^\n]*/) || ['(no aparece)'])[0]);
    ok('7g · 🔑 …pero conserva el id "director", para no romper los hilos ya creados',
       /id: 'director'/.test(tabsBlock));
    if (API_OK) {
        const { ctx } = cargarPuras();
        ok('7h · 🔑 y el contexto sigue siendo coach_director',
           ctx('coach', 'director') === 'coach_director' &&
           ctx('admin_individual', 'coaches') === 'coach_director');
    } else { ok('7h · omitida', false); }

    ok('7i · las consultas nuevas toleran su propio fallo',
       /catch/.test(tabClubAdmin) && /catch/.test(tabDirCoach));

    // 🔑 ÍNDICES: una consulta compuesta sin índice declarado falla con
    // failed-precondition, y como va dentro de un catch el fallo sería MUDO —
    // el destinatario volvería a no aparecer. Se comprueba contra el fichero de
    // índices real, no de memoria.
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8'));
    const tieneIndice = (a, b) => (idx.indexes || []).some(i =>
        i.collectionGroup === 'users' && i.fields.length === 2 &&
        i.fields[0].fieldPath === a && i.fields[1].fieldPath === b);
    ok('7j · 🔑 la consulta clubId+role del Director SÍ tiene índice declarado',
       tieneIndice('clubId', 'role'));
    ok('7k · 🔑 y la del ente NO usa consulta compuesta, porque individualEntityId+role NO existe',
       !tieneIndice('individualEntityId', 'role') &&
       !/where\('individualEntityId'[\s\S]{0,120}where\('role'/.test(tabDirCoach),
       'si algún día se declara ese índice, esta aserción avisa de que ya se puede simplificar');
}

// ═══════ PARTE 8 · el Director TIENE que ver a quien ya le escribió ═══════
// Tercera ronda (2026-07-30): Entrenador ↔ Admin Individual YA FUNCIONA, pero
// Director ↔ Admin de Club no. El Admin ve al Director y le escribe; al
// Director no le llega y su pestaña sigue diciendo "sin destinatarios".
//
// ⚠️ EL DIAGNÓSTICO DEL INFORME APUNTA AL CONTEXTO, PERO NO ES ESO: las
// aserciones 2a/2b ya prueban que los dos lados derivan 'clubadmin_director' y
// el MISMO threadId. El problema es que la LISTA del Director sale vacía, y sin
// una fila que pulsar no hay hilo que abrir aunque exista el documento.
//
// 🔑 LAS DOS CAUSAS REALES:
//  1. `_allClubIds` —el descubrimiento de TODOS los clubIds asociados, que este
//     fichero ya hacía para otras pestañas— se declaraba dentro de otro bloque
//     y NO estaba en el alcance de esta pestaña. La consulta usaba un único
//     clubId, y en este proyecto está documentado que el del Director puede
//     diferir del de los demás miembros del mismo club real.
//  2. El documento del club puede traer sólo `adminEmail` (sin adminUid), y sin
//     resolver ese email a un uid no hay con quién abrir hilo.
//
// 🔑 Y EL RESPALDO QUE CIERRA EL CASO: descubrir contactos desde los HILOS QUE
// YA EXISTEN. Si alguien ya escribió al Director, ese documento lo tiene como
// participante; leerlo garantiza que el mensaje aparezca aunque los roles o los
// clubId estén mal poblados. Es lo que convierte "no me llega" en imposible.
console.log('\n── PARTE 8 · el Director ve a quien ya le escribió ──');
{
    const s = sinCom(SRC);
    const i = s.indexOf("else if (tabId === 'clubadmin')");
    const tab = i === -1 ? '' : s.slice(i, s.indexOf("else if (window._umState.role === 'coordinator')", i));

    ok('8a · 🔑 busca en TODOS los clubIds descubiertos, no sólo en el propio',
       /_umAllClubIds/.test(tab), tab.slice(0, 200));
    ok('8b · y ese conjunto se rellena donde ya se descubrían los clubIds',
       /_umAllClubIds/.test(s.slice(s.indexOf('const _allClubIds = new Set'),
                                   s.indexOf('const _allClubIds = new Set') + 1400)));
    ok('8c · 🔑 resuelve adminEmail a un uid consultando users por email',
       /where\('email', '==', /.test(tab), tab.slice(0, 300));

    ok('8d · 🔑 descubre contactos desde los HILOS ya existentes',
       /'cronos_messages'/.test(tab) &&
       /array-contains/.test(tab), tab.slice(0, 300));
    // Mejor que el literal: el filtro deriva el contexto de la MISMA función que
    // construye los hilos, así que no pueden desincronizarse.
    ok('8e · 🔑 y filtra esos hilos por el contexto canónico del canal',
       /_getCanonicalContext\('director', 'clubadmin'\)/.test(tab) &&
       /endsWith\('_' \+ ctxCanal\)/.test(tab),
       (tab.match(/ctxCanal[^\n]*/) || ['(no aparece)'])[0]);
    ok('8f · esa búsqueda tolera su propio fallo',
       /'cronos_messages'[\s\S]{0,900}?catch/.test(tab));

    // 🔑 El id que se deriva del hilo encontrado tiene que ser el MISMO que
    // calcula _cThreadId: si no, se abriría un documento distinto del que trae
    // el mensaje.
    if (API_OK) {
        const { ctx, tid } = cargarPuras();
        const D = 'uid_dir', A = 'uid_adm';
        const esperado = tid(D, A, ctx('director', 'clubadmin'));
        ok('8g · 🔑 el hilo del canal termina en el contexto que se busca',
           esperado.endsWith('_clubadmin_director'), esperado);
        ok('8h · y coincide con el que deriva el Admin de Club',
           esperado === tid(A, D, ctx('club_admin', 'director')), esperado);
    } else { ok('8g · omitida', false); }
}

// ═══════ PARTE 9 · 🔑 NINGUNA RAMA INALCANZABLE ═══════
// LA CAUSA RAÍZ DE LAS TRES RONDAS (v412-v415), y no se parecía a nada de lo
// que se investigó: la pestaña 'clubadmin' estaba escrita como un `else if`
// HERMANO —`else if (role === 'director' && tabId === 'clubadmin')`— colocado
// DESPUÉS del `else if (role === 'director')` genérico. Ese genérico captura
// TODAS las pestañas del Director, así que la rama hermana era INALCANZABLE y
// `contacts` se quedaba en []: "No se encontraron destinatarios".
//
// 🔑 TRES RONDAS DE CORRECCIONES DENTRO DE ESA RAMA NO CAMBIARON NADA PORQUE EL
// CÓDIGO NUNCA SE EJECUTÓ. Y el guard no lo veía: censaba que el código
// EXISTIERA en el fuente, no que fuese ALCANZABLE. Es la diferencia entre
// "está escrito" y "se ejecuta", y es exactamente el punto ciego de un censo.
console.log('\n── PARTE 9 · 🔑 ninguna rama de rol queda inalcanzable ──');
{
    const s = sinCom(SRC);
    const i = s.indexOf("if (window._umState.role === 'coach')");
    const despacho = i === -1 ? '' : s.slice(i, s.indexOf('window._umState.contacts = contacts;', i));

    // Todas las ramas de PRIMER nivel del despacho, en orden.
    // ⚠️ `\s+` y no una indentación fija: la primera versión exigía exactamente
    // 8 espacios y NO detectaba la rama inalcanzable cuando venía indentada de
    // otra forma — que es como estaba en el bug real. Lo destapó la prueba de
    // rojo, donde 9a se quedó callada y sólo saltó 9c.
    const ramas = [...despacho.matchAll(/\n\s+(?:else )?if \(window\._umState\.role === '(\w+)'([^)]*)\)/g)]
        .map(m => ({ rol: m[1], extra: (m[2] || '').trim() }));

    // Una rama con condición EXTRA (p. ej. `&& tabId === 'x'`) que llegue
    // DESPUÉS de otra rama del MISMO rol sin condición extra es inalcanzable.
    const inalcanzables = [];
    const vistosSinExtra = new Set();
    ramas.forEach(r => {
        if (r.extra && vistosSinExtra.has(r.rol)) inalcanzables.push(r.rol + ' ' + r.extra);
        if (!r.extra) vistosSinExtra.add(r.rol);
    });
    ok('9a · 🔑 ninguna rama queda tras un else-if del MISMO rol sin condición',
       inalcanzables.length === 0, JSON.stringify(inalcanzables));

    // Y cada rol con pestañas tiene UNA sola rama de primer nivel.
    const cuenta = {};
    ramas.forEach(r => { cuenta[r.rol] = (cuenta[r.rol] || 0) + 1; });
    const duplicados = Object.keys(cuenta).filter(k => cuenta[k] > 1);
    ok('9b · 🔑 un rol, una sola rama de despacho',
       duplicados.length === 0, JSON.stringify(cuenta));

    // 🔑 Y la pestaña 'clubadmin' se resuelve DENTRO de la rama del Director.
    const ramaDir = despacho.slice(despacho.indexOf("else if (window._umState.role === 'director')"),
                                   despacho.indexOf("else if (window._umState.role === 'coordinator')"));
    ok('9c · 🔑 la pestaña clubadmin vive DENTRO de la rama del Director',
       /else if \(tabId === 'clubadmin'\)/.test(ramaDir), ramaDir.slice(0, 160));
    ok('9d · y ahí dentro están las consultas que la resuelven',
       /'clubs'/.test(ramaDir) && /cronos_messages/.test(ramaDir) && /_umAllClubIds/.test(ramaDir));

    // Cada pestaña declarada para un rol debe tener resolución alcanzable.
    const tabsBlock2 = SRC.slice(SRC.indexOf('let tabs = [];'),
                                 SRC.indexOf("if (!tabs.find(t => t.id === tab))"));
    const tabsDir = (() => {
        const j = tabsBlock2.indexOf("role === 'director'");
        const t = tabsBlock2.slice(j, tabsBlock2.indexOf('];', j));
        return (t.match(/id: '(\w+)'/g) || []).map(x => x.replace(/id: '|'/g, ''));
    })();
    const sinResolver = tabsDir.filter(t => !new RegExp(`tabId === '${t}'`).test(ramaDir));
    ok('9e · 🔑 todas las pestañas del Director tienen resolución dentro de su rama',
       sinResolver.length === 0, JSON.stringify(sinResolver));
}

// ═══════ PARTE 10 · 🔑 el SuperAdmin NO es un Administrador de Club ═══════
// Fallo visto en producción (2026-07-30, ya con el canal funcionando): en la
// pestaña "Admin. Club" del Director aparecía el email del SUPERADMIN,
// etiquetado como Administrador de Club.
//
// 🔑 CAUSA: la resolución usaba `adminUid || createdBy`, y `createdBy` es QUIEN
// CREÓ EL CLUB — que es el SuperAdmin (js/admin/club/panel.js escribe
// `createdBy: me.uid` al crearlo). O sea: el campo no significa "administrador",
// significa "creador", y confundirlos metía al SuperAdmin en la lista.
//
// REGLA DE NEGOCIO DEL AUTOR: el Director NO tiene canal con el SuperAdmin —
// eso es competencia exclusiva del Administrador de Club. Así que además de
// quitar `createdBy` se excluye al SuperAdmin en TODOS los caminos, incluido el
// respaldo por hilos existentes.
console.log('\n── PARTE 10 · 🔑 el SuperAdmin fuera de la pestaña del Director ──');
{
    const s = sinCom(SRC);
    const i = s.indexOf("else if (tabId === 'clubadmin')");
    const tab = i === -1 ? '' : s.slice(i, s.indexOf("else if (window._umState.role === 'coordinator')", i));

    ok('10a · 🔑 la pestaña del Director NO resuelve por createdBy (= el creador, el SuperAdmin)',
       !/createdBy/.test(tab), (tab.match(/createdBy[^\n]*/) || [''])[0]);
    // Se fija la GUARDA dentro del helper, no la mera presencia del nombre:
    // borrar el `return` dejaba el guard en verde.
    ok('10b · 🔑 y excluye explícitamente a los SuperAdmin al añadir el contacto',
       /_addAdmin = \([\s\S]{0,220}?if \(_esSuperAdmin\(u\)\) return;/.test(tab),
       (tab.match(/_addAdmin = [\s\S]{0,160}/) || ['(no aparece)'])[0]);

    // 🔑 INVARIANTE FUERTE: TODA creación de contacto de esta pestaña pasa por
    // _addAdmin, que es la única puerta donde se filtra al SuperAdmin. Si algún
    // camino construye el contacto a mano con byUid.set, se salta el filtro —
    // y eso es exactamente lo que hacía el camino del documento del club.
    ok('10f · 🔑 un solo punto de alta de contactos (byUid.set sólo dentro de _addAdmin)',
       (tab.match(/byUid\.set\(/g) || []).length === 1,
       'apariciones de byUid.set: ' + (tab.match(/byUid\.set\(/g) || []).length);
    ok('10c · la exclusión mira el rol raíz y también allRoles',
       /_esSuperAdmin = [\s\S]{0,240}allRoles/.test(s));
    ok('10d · 🔑 se aplica también al respaldo por hilos, no sólo a la búsqueda por rol',
       (() => {
           const j = tab.indexOf('cronos_messages');
           return j > -1 && /_esSuperAdmin|_addAdmin/.test(tab.slice(j));
       })(), 'el respaldo por hilos debe pasar por el mismo filtro');

    // 🔑 En un ENTE INDIVIDUAL sí vale createdBy: ahí el creador ES el
    // administrador individual, no el SuperAdmin. La distinción importa.
    const k = s.indexOf("const _entId = me.individualEntityId");
    const tabEnte = k === -1 ? '' : s.slice(k, k + 2200);
    ok('10e · 🔑 en el ente individual SÍ se conserva createdBy: allí el creador ES el admin',
       /createdBy/.test(tabEnte), tabEnte.slice(0, 200));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
