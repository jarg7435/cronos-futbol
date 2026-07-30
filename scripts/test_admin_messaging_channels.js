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
    ok('5a · 🔑 las reglas de cronos_messages permiten por PARTICIPANTE, no por rol',
       /request\.auth\.uid in resource\.data\.participants/.test(bloque) &&
       /request\.auth\.uid in request\.resource\.data\.participants/.test(bloque));
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
    const tabClubAdmin = bloque("role === 'director' && tabId === 'clubadmin'", "else if (window._umState.role === 'coordinator')");
    ok('6a · 🔑 el Director busca al Admin de Club en el DOCUMENTO del club',
       /'clubs'/.test(tabClubAdmin), tabClubAdmin.slice(0, 200));
    ok('6b · 🔑 y lo resuelve por adminUid, adminEmail o createdBy',
       /adminUid/.test(tabClubAdmin) && /adminEmail/.test(tabClubAdmin) &&
       /createdBy/.test(tabClubAdmin), tabClubAdmin.slice(0, 200));
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

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
