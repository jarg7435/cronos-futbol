// ═══════════════════════════════════════════════════════════════════════════
//  PROTECCIÓN ESTRUCTURAL: NINGÚN APROBAR PUEDE PERDER UNA PLAZA — v552
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-08-16), punto 2: *"una protección
//  estructural global para que ningún club ni usuario sufra pérdidas de roles
//  al gestionar múltiples equipos"*. Y con razón: **el mismo defecto ha
//  aparecido CUATRO veces**, en cuatro ficheros distintos, siempre igual —
//  comparar `allRoles` por `role` (a veces + club) e ignorar la CATEGORÍA:
//
//    v540  js/admin/superadmin/extras.js   · saExtApprove
//    v540  js/admin/club/panel.js          · caApproveRequest / caForwardToSA
//    v547  js/admin/club/panel.js          · pendingFromPlatformReqs (la ocultaba)
//    v552  js/admin/superadmin/requests-tab.js · saApproveRequest ← éste
//
//  🔑 LA UNIDAD ES LA PLAZA: rol + club + categoría + subcategoría
//  (`cronosMismaPlaza`, js/core/utils.js). Un `find`/`some`/`map` por rol coge
//  la plaza equivocada, y cuando decide si "ya existe" hace que la nueva **no
//  se cree jamás**. No se borra nada: nunca llega a existir, que es peor de
//  diagnosticar.
//
//  ⚠️ ESTE GUARD NO MIRA UN CASO: BARRE LOS CUATRO FICHEROS. Si mañana alguien
//  añade un quinto aprobar con el atajo de siempre, se pone rojo aquí.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) { console.log(`  ✓ ${nombre}`); }
    else { console.log(`  ✗ ${nombre}${detalle !== undefined ? '  → ' + detalle : ''}`); fallos++; }
}
// ⚠️ Sin comentarios: los ficheros CITAN el código viejo para explicar por qué
// se retiró, y eso ponía rojas las aserciones. Tres veces en la misma sesión.
const sinCom = t => t.replace(/\/\*[\s\S]*?\*\//g, '')
                     .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');

const F = {
    extras:  'js/admin/superadmin/extras.js',
    reqs:    'js/admin/superadmin/requests-tab.js',
    club:    'js/admin/club/panel.js',
    utils:   'js/core/utils.js',
    auth:    'js/services/auth.js',
};
const SRC = {};
Object.entries(F).forEach(([k, p]) => { SRC[k] = sinCom(fs.readFileSync(path.join(RAIZ, p), 'utf8')); });

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 1 · el resolutor único existe y lo usan TODOS ──');
// ───────────────────────────────────────────────────────────────────────────
ok('1a · `cronosMismaPlaza` vive en utils.js (fuente única)',
   /window\.cronosMismaPlaza\s*=/.test(SRC.utils));

[['extras', 'el aprobar del SuperAdmin (extras)'],
 ['reqs',   'el aprobar del SuperAdmin (pestaña Solicitudes)'],
 ['club',   'el panel del club'],
 ['auth',   'el registro']].forEach(([k, nombre]) => {
    ok('1b · ' + nombre + ' compara por PLAZA',
       /cronosMismaPlaza/.test(SRC[k]),
       'sin esto, la segunda plaza no se crea nunca');
});

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 2 · el atajo prohibido no ha vuelto ──');
// ───────────────────────────────────────────────────────────────────────────
//  Cada patrón de aquí es el que causó una pérdida real, con su fecha.
const PROHIBIDOS = [
    ['reqs',   /const isMatch = r4\.role === r\.requestedRole/,
     'v552 · el `isMatch` que impedía crear la 2ª plaza (arinagazone: Regional A)'],
    ['extras', /var isThisRole = \(ar\.role === role\);/,
     'v540 · activaba TODAS las entradas del rol y nunca creaba la nueva (brunoromar: Benjamín)'],
    ['club',   /some\(r => r\.role === pr\.requestedRole && r\.isAuthorized/,
     'v547 · ocultaba del panel la solicitud del segundo equipo'],
];
PROHIBIDOS.forEach(([k, re, porque]) => {
    ok('2 · ' + porque, !re.test(SRC[k]), 'ha vuelto el atajo por rol');
});

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 3 · al aprobar, la plaza se CREA si no existía ──');
// ───────────────────────────────────────────────────────────────────────────
//  🔑 No basta con casar bien: si la plaza aprobada no está en `allRoles` hay
//  que añadirla, o la solicitud queda "aprobada" y la persona sin equipo — es
//  literalmente lo que le pasó a brunoromar2012 con Benjamín.
ok('3a · extras.js crea la plaza que no existía',
   /_plazaExiste/.test(SRC.extras));
ok('3b · requests-tab.js también',
   /alreadyHas/.test(SRC.reqs) && /updRoles4\.push\(/.test(SRC.reqs));
ok('3c · 🔑 y la crea CON su categoría y subcategoría',
   /category: _plazaAprob\.category/.test(SRC.reqs) &&
   /subcategory: _plazaAprob\.subcategory/.test(SRC.reqs),
   'sin categoría, la plaza nace sin equipo y el entrenador entra sin nada');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n── PARTE 4 · nadie REEMPLAZA allRoles al dar de alta ──');
// ───────────────────────────────────────────────────────────────────────────
//  v551 · la rama `status==='removed'` de auth.js escribía un `allRoles` de UNA
//  entrada con un `setDoc` sin merge: brunoromar2012 pasó de 6 roles a 1.
ok('4a · el alta tras una baja CONSERVA los roles vivos',
   /_sobreviven/.test(SRC.auth) && /freshAllRoles = _yaEsta \? _sobreviven/.test(SRC.auth),
   'reemplazar el array entero borra roles que siguen vigentes');
ok('4b · ⚠️ y los campos del alta se escriben en el rol NUEVO, no en la posición 0',
   !/freshAllRoles\[0\]\./.test(SRC.auth),
   'al conservar los viejos, la posición 0 puede ser un rol ajeno');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── PARTE 5 · ⚠️ v560 · EL BARRIDO COMPLETO: TODO LO QUE ESCRIBE allRoles ──');
// ═══════════════════════════════════════════════════════════════════════════
//  Reportado por el autor (captura 9062): "Regional A" volvió a desaparecer
//  sola. **Y el defecto era el mismo por sexta vez**, pero fuera de los
//  aprobares — que es lo único que vigilaban las PARTES 1-4. Por eso este
//  barrido pasa a cubrir CUALQUIER fichero que deduplique o filtre `allRoles`,
//  apruebe o no.
//
//  🔑🔑🔑 LA CLAVE `rol|club` ES EL VENENO. Escrita así, Alevín C y Regional A
//  del mismo entrenador dan la MISMA clave: la segunda se descarta por
//  "duplicada" y, como estos sitios PERSISTEN el resultado, el equipo se
//  pierde de Firestore para siempre. Ya pasó en los tres deduplicadores del
//  arranque de sesión (v554) y volvió a pasar en la Limpieza Total del
//  SuperAdmin (v560), que además recorre `users` ENTERA: una pulsación le
//  quitaba el segundo equipo a todos los entrenadores de la plataforma.
const F5 = {
    extras: 'js/admin/superadmin/extras.js',
    auth:   'js/services/auth.js',
    club:   'js/admin/club/panel.js',
    reqs:   'js/admin/superadmin/requests-tab.js',
    trash:  'js/admin/superadmin/trash.js',
    sapanel:'js/admin/superadmin/superadmin.panel.js',
    delclub:'js/admin/superadmin/delete-club.js',
    indiv:  'js/admin/individual/panel.js',
};
const SRC5 = {};
Object.entries(F5).forEach(([k, p]) => { SRC5[k] = sinCom(fs.readFileSync(path.join(RAIZ, p), 'utf8')); });

// ⚠️ LA CLAVE PELADA, PROHIBIDA POR FORMA. Se busca cualquier clave construida
// como rol + club — la forma, no un nombre concreto, para que también cace la
// próxima copia se llame como se llame— y se exige que LA CATEGORÍA aparezca
// cerca. Componer `rol|club` está bien como BASE de la clave de plaza; lo que
// no puede es quedarse ahí.
const RE_CLAVE_ROL_CLUB = /\(\s*r\.role\s*\|\|\s*''\s*\)\s*\+\s*'\|'\s*\+\s*\(\s*r\.clubId[^)]*\)/g;
Object.keys(SRC5).forEach(k => {
    const src = SRC5[k];
    let m, culpables = [];
    RE_CLAVE_ROL_CLUB.lastIndex = 0;
    while ((m = RE_CLAVE_ROL_CLUB.exec(src)) !== null) {
        // ±500 caracteres alrededor: si la categoría no entra en la clave, es
        // la clave pelada que ha costado seis pérdidas de datos.
        const ventana = src.slice(Math.max(0, m.index - 500), m.index + 500);
        if (!/categor/i.test(ventana)) culpables.push('offset ' + m.index);
    }
    ok('5 · ' + F5[k] + ' no deduplica con la clave `rol|club` pelada',
       culpables.length === 0,
       'esa clave hace que el 2º equipo del entrenador cuente como duplicado · ' + culpables.join(', '));
});

// El sitio concreto que se llevó por delante los equipos esta vez.
ok('5a · 🔑🔑🔑 la Limpieza Total del SuperAdmin deduplica por PLAZA',
   /_clavePlaza/.test(SRC5.extras) &&
   /saExtLimpiezaTotal/.test(SRC5.extras),
   'recorre `users` entera: con la clave vieja borraba el 2º equipo de TODOS');

ok('5b · ⚠️ y no limpia nunca con datos de CACHÉ',
   /clubsSnap\.metadata && clubsSnap\.metadata\.fromCache/.test(SRC5.extras),
   'sin cobertura, "clubes que no existen" son todos: borraría media plataforma');

// Los tres del arranque de sesión (v554) siguen usando la clave de plaza.
ok('5c · los deduplicadores del ARRANQUE DE SESIÓN siguen usando la plaza',
   (SRC5.auth.match(/_clavePlaza|_clavePlazaHuerfana/g) || []).length >= 3,
   'es donde la víctima se borraba a sí misma el equipo al entrar');

// ── Lo que se CREA al entrar tiene que traer su equipo ──────────────────
//  🔑 Un rol de entrenador SIN categoría es un entrenador SIN EQUIPO:
//  `cronosEquiposDeEntrenador` descarta esas entradas (`if (!cat) return`), así
//  que la persona aparece "desvinculada" aunque el rol exista. Eran TRES pushes
//  en el arranque, los tres sin categoría, y los tres se persisten.
ok('5d · 🔑 el arranque, al añadir un rol de entrenador, le pone su categoría',
   /category: reqCat, subcategory: reqSub,/.test(SRC5.auth) &&
   /category: _cat, subcategory: _sub,/.test(SRC5.auth) &&
   /_esCoach \? \(data\.category \|\| data\.categoryLabel \|\| null\) : null/.test(SRC5.auth),
   'sin categoría el rol nace sin equipo y el entrenador entra sin nada');

ok('5e · y las solicitudes aprobadas se casan por PLAZA, no por rol',
   /const existingIdx = updatedAllRoles\.findIndex\(_esLaPlaza\)/.test(SRC5.auth),
   'con rol+club, la solicitud del Regional casaba con la entrada del Alevín');

// ── Cambiar de equipo mueve UNA plaza, no todas ─────────────────────────
ok('5f · 🔑 "Cambiar equipo" del panel del club mueve SÓLO la plaza editada',
   /_plazaOrigen/.test(SRC5.club) &&
   /cronosMismaPlaza\(r, _plazaOrigen\)/.test(SRC5.club),
   'reetiquetaba los DOS equipos: el segundo se volvía copia del primero y el arranque lo borraba');

ok('5g · ⚠️ y la fila enseña la plaza de ESA fila, no la raíz del documento',
   /const _rowRole = u\._activeRoleData \|\| null;/.test(SRC5.club),
   'con la raíz, las dos filas del entrenador mostraban la misma categoría');

// ── El borrado por "club inexistente" ───────────────────────────────────
ok('5h · el borrado por club inexistente respeta la plaza y no actúa desde caché',
   /cronosMismaPlaza\(r, duplicate\)/.test(SRC5.auth) &&
   /const _desdeCache = !!\(dupClubSnap\.metadata && dupClubSnap\.metadata\.fromCache\)/.test(SRC5.auth),
   'borraba TODAS las plazas del rol en ese club, y con caché borraba las de un club vivo');

// ── La baja de un equipo no puede llevarse el otro ──────────────────────
ok('5i · ⚠️ dar de baja un equipo no retira la verificación del otro',
   /_quedaViva/.test(SRC5.auth),
   '`_roleKey` es rol+club: sin esto, la baja del Alevín dejaba al Regional fuera de la sesión');

// ───────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(70));
console.log(`Resultado: ${total - fallos}/${total}`);
if (fallos) {
    console.log(`❌ ${fallos} aserción(es) en rojo`);
    process.exit(1);
}
console.log('✅ Ningún aprobar puede perder una plaza');
