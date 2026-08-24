// ════════════════════════════════════════════════════════════════════════
//  test_un_correo_una_entidad.js
//  UN CORREO, UNA SOLA ENTIDAD — v585
// ════════════════════════════════════════════════════════════════════════
//  REGLA DE NEGOCIO fijada por el autor (2026-08-19), venida del reglamento de
//  la competición: **una misma persona no puede estar en dos clubes, ni en dos
//  entes, ni en un club y un ente a la vez.**
//
//  🔑 POR QUÉ ES CÓDIGO Y NO SÓLO UNA NORMA. El documento de usuario tiene UNA
//  raíz (`role` + `clubId`) y sólo puede describir UNA pertenencia. Cuando un
//  correo se solapa entre entidades, esa raíz apunta a una sola y aparecen
//  exactamente los tres fallos de esta semana:
//    · v582 — el Benjamín C desaparecía del panel del SuperAdmin;
//    · v583/v584 — el ente contaba y pintaba plazas que eran de un club;
//    · v583 — el residuo "Administrador Individual sin ente", imposible de quitar.
//  Una norma que nadie comprueba no evita nada: se comprueba.
//
//  ⚠️ LO QUE ESTA REGLA **NO** CUBRE, y por eso el resto de guards siguen
//  siendo imprescindibles: varias plazas DENTRO del mismo club son legales y
//  existen hoy en la base (v537 — un F7 y un F11). La exclusividad es por
//  ENTIDAD, no por plaza.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'js/services/auth.js'), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}

// ── Se aísla el BLOQUE REAL y se ejecuta, igual que hace
//    test_baja_no_resucita_al_entrar.js: no se comprueba que exista un `if`,
//    se comprueba el RESULTADO.
function bloqueExclusividad() {
    // 🕳️ 2026-08-23 · El trozo empieza en `_fundaEntidadNueva`, no en el `if`:
    // esa constante es la que decide si un alta SIN club de destino (fundar una
    // entidad) pasa por la comprobación, y sin ella el bloque no se puede
    // ejecutar aquí. Antes el `if` se localizaba por su texto exacto; al
    // cambiarlo, este guard reventaba con "no se encuentra el bloque" — que es
    // lo correcto: obliga a mirar el guard cuando se toca la regla.
    const inicio = AUTH.indexOf('const _fundaEntidadNueva =');
    if (inicio === -1) throw new Error('No se encuentra _fundaEntidadNueva (¿se ha reabierto el agujero de fundar entidad?)');
    const marca = AUTH.indexOf("if (isAddingRole && (clubId || _fundaEntidadNueva) && finalRole !== 'superadmin') {", inicio);
    if (marca === -1) throw new Error('No se encuentra el bloque de exclusividad de entidad');
    let prof = 0, i = marca;
    for (; i < AUTH.length; i++) {
        if (AUTH[i] === '{') prof++;
        else if (AUTH[i] === '}') { prof--; if (prof === 0) { i++; break; } }
    }
    return AUTH.slice(inicio, i);
}
const BLOQUE = bloqueExclusividad();

// Ejecuta el bloque con un mundo controlado y cuenta qué pasó.
async function correr({ isAddingRole = true, clubId = 'club_B', finalRole = 'user',
                        docUsuario = {}, entidades = {}, leerFalla = false,
                        // 🕳️ 2026-08-23 · lo que describe un alta que FUNDA
                        // una entidad: sin club de destino y con nombre nuevo.
                        requestedRole = 'user', newClubName = '', selectedIndivId = null } = {}) {
    const efectos = { errores: [], signOut: 0, avisos: [] };
    const sandbox = {
        isAddingRole, clubId, finalRole, requestedRole, newClubName, selectedIndivId,
        cred: { user: { uid: 'U1' } },
        window: {},
        console: { warn: (...a) => efectos.avisos.push(a.join(' ')), log() {}, error() {} },
        clearTimeout: () => {},
        _altaTimer: null,
        showAuthError: (m) => efectos.errores.push(m),
        String, Set, Array, Object, Promise,
        fa: {
            db: {},
            auth: {},
            signOut: async () => { efectos.signOut++; },
        },
        // El `import()` dinámico del SDK, simulado.
        __import: async () => ({
            doc: (db, col, id) => ({ col, id }),
            getDoc: async (ref) => {
                if (leerFalla) throw new Error('sin red');
                if (ref.col === 'users') {
                    return { exists: () => true, data: () => docUsuario };
                }
                const e = entidades[ref.id];
                return { exists: () => !!e, data: () => e || {} };
            },
        }),
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    // `import(...)` no existe en vm: se sustituye por el doble, conservando
    // el resto del bloque intacto.
    const src = BLOQUE.replace(
        /await import\('https:\/\/www\.gstatic\.com\/firebasejs\/[^']+'\)/g, 'await __import()');
    const envoltorio = '(async () => {' + src + '\nreturn "SIGUE";})()';
    let salida;
    try { salida = await vm.runInContext(envoltorio, sandbox); }
    catch (e) { efectos.excepcion = e.message; }
    // El bloque hace `return` cuando bloquea: la envoltura devuelve undefined.
    efectos.bloqueado = (salida !== 'SIGUE');
    return efectos;
}

(async () => {

console.log('\n── 1 · el caso que hay que impedir ──');
{
    // Ya es entrenador del club A (vivo) y se registra en el club B.
    const r = await correr({
        clubId: 'club_B',
        docUsuario: { allRoles: [
            { role: 'user', clubId: 'club_A', category: 'benjamin', subcategory: 'C', status: 'active' } ] },
        entidades: { club_A: { name: 'CD DÍA' } },
    });
    ok('1a · 🔑🔑🔑 se BLOQUEA el alta en un segundo club', r.bloqueado === true, r);
    ok('1b · y se dice a qué entidad pertenece ya', /CD DÍA/.test(r.errores.join(' ')), r.errores);
    ok('1c · ⚠️ se cierra la sesión que se acababa de abrir (no queda a medias)', r.signOut === 1, r.signOut);
    ok('1d · y se afirma que NO se ha tocado nada', /No se ha creado ni modificado nada/.test(r.errores.join(' ')));
    ok('1e · se explica la salida: darse de baja en la anterior',
       /de baja/.test(r.errores.join(' ')));
}
{
    // Club → ente individual. También prohibido.
    const r = await correr({
        clubId: 'ente_X',
        docUsuario: { allRoles: [{ role: 'user', clubId: 'club_A', status: 'active' }] },
        entidades: { club_A: { name: 'CD DÍA' } },
    });
    ok('1f · 🔑 un club y un ente a la vez, también se bloquea', r.bloqueado === true);
}
{
    // Ente → club. Simétrico.
    const r = await correr({
        clubId: 'club_A',
        docUsuario: { allRoles: [
            { role: 'individual', individualEntityId: 'ente_X', status: 'active' } ] },
        entidades: { ente_X: { name: 'Ente Libre', type: 'individual' } },
    });
    ok('1g · y en el sentido contrario también', r.bloqueado === true);
    ok('1h · nombrando el ente, no un club', /ente individual/.test(r.errores.join(' ')), r.errores);
}

console.log('\n── 2 · lo que NO puede bloquearse ──');
{
    // ⚠️ v537: un F7 y un F11 EN EL MISMO CLUB son legales y existen hoy.
    const r = await correr({
        clubId: 'club_A',
        docUsuario: { allRoles: [
            { role: 'user', clubId: 'club_A', category: 'cadete', subcategory: 'B', status: 'active' } ] },
        entidades: { club_A: { name: 'CD DÍA' } },
    });
    ok('2a · 🔑🔑🔑 un SEGUNDO equipo en el MISMO club sigue permitido (v537)',
       r.bloqueado === false, r);
}
{
    // ⚠️⚠️ El caso de brunoromar2012 esta misma mañana: un resto que apunta a
    //      un ente YA BORRADO no puede dejarle sin poder registrarse nunca más.
    const r = await correr({
        clubId: 'club_A',
        docUsuario: { allRoles: [
            { role: 'individual', clubId: 'ente_MUERTO', status: 'active' } ] },
        entidades: { /* ente_MUERTO no existe */ },
    });
    ok('2b · 🔑🔑🔑 una referencia a una entidad BORRADA no bloquea nada',
       r.bloqueado === false, r);
}
{
    // Una plaza revocada en otro club ya no le ata a ese club.
    const r = await correr({
        clubId: 'club_B',
        docUsuario: { allRoles: [
            { role: 'user', clubId: 'club_A', status: 'removed', isAuthorized: false } ] },
        entidades: { club_A: { name: 'CD DÍA' } },
    });
    ok('2c · 🔑 si le dieron de baja en la anterior, SÍ puede registrarse',
       r.bloqueado === false, r);
}
{
    const r = await correr({ isAddingRole: false, clubId: 'club_B',
        docUsuario: { allRoles: [{ role: 'user', clubId: 'club_A', status: 'active' }] },
        entidades: { club_A: { name: 'CD DÍA' } } });
    ok('2d · una cuenta NUEVA (no existía el correo) no pasa por aquí', r.bloqueado === false);
}
{
    const r = await correr({ finalRole: 'superadmin', clubId: 'club_B',
        docUsuario: { allRoles: [{ role: 'user', clubId: 'club_A', status: 'active' }] },
        entidades: { club_A: { name: 'CD DÍA' } } });
    ok('2e · ⚠️ el SuperAdmin queda exento: no pertenece a ninguna entidad', r.bloqueado === false);
}
{
    // ⚠️ FAIL-OPEN: un fallo de lectura no puede impedir un alta legítima.
    const r = await correr({ leerFalla: true, clubId: 'club_B',
        docUsuario: { allRoles: [{ role: 'user', clubId: 'club_A', status: 'active' }] },
        entidades: { club_A: { name: 'CD DÍA' } } });
    ok('2f · 🔑 sin red o sin permisos NO se bloquea (fail-open deliberado)',
       r.bloqueado === false, r);
    ok('2g · pero queda constancia en la consola para poder auditarlo',
       r.avisos.join(' ').indexOf('exclusividad') >= 0, r.avisos);
}

console.log('\n── 3 · de dónde sale la verdad ──');
{
    // La raíz va desfasada con frecuencia (v562/v563/v582): si hay allRoles,
    // manda allRoles.
    const r = await correr({
        clubId: 'club_A',
        docUsuario: { clubId: 'club_VIEJO',        // raíz obsoleta
                      allRoles: [{ role: 'user', clubId: 'club_A', status: 'active' }] },
        entidades: { club_A: { name: 'CD DÍA' }, club_VIEJO: { name: 'Club Antiguo' } },
    });
    ok('3a · 🔑🔑 manda `allRoles`, no la raíz: una raíz desfasada no bloquea',
       r.bloqueado === false, r);
}
{
    // Sin allRoles utilizable, la raíz es lo único que hay.
    const r = await correr({
        clubId: 'club_B',
        docUsuario: { clubId: 'club_A', allRoles: [] },
        entidades: { club_A: { name: 'CD DÍA' } },
    });
    ok('3b · sin `allRoles`, la raíz sí decide', r.bloqueado === true, r);
}

// ════════════════════════════════════════════════════════════════════
console.log('\n── 3bis · 🕳️ FUNDAR UNA ENTIDAD TAMBIÉN PASA POR LA REGLA ──');
// ════════════════════════════════════════════════════════════════════
//  EL AGUJERO (2026-08-23, medido en datos reales): la condición era
//  `isAddingRole && clubId && …`, y al CREAR una entidad todavía no hay
//  `clubId` — se saltaba entera. Así acabó damasorv@gmail.com siendo
//  coordinador F11 de CD DÍA y administrador de ESTRELLA CF **a la vez**, que
//  es exactamente lo que esta regla existe para impedir. Lo descubrió al
//  chocar DESPUÉS, al querer añadirse como entrenador en su propio club.
{
    const r = await correr({
        clubId: null, requestedRole: 'club_admin', newClubName: 'ESTRELLA CF', finalRole: 'club_admin',
        docUsuario: { allRoles: [
            { role: 'coordinator', clubId: 'club_A', status: 'active', isAuthorized: true } ] },
        entidades: { club_A: { name: 'CD DÍA' } },
    });
    ok('3c · 🔑🔑🔑 con plaza viva en otro club NO se puede fundar uno nuevo',
       r.bloqueado === true, r);
    ok('3d · y el aviso NO dice "podrá registrarse aquí" (el club aún no existe)',
       /Para fundar una entidad nueva/.test(r.errores.join(' ')) &&
       !/podrá registrarse aquí/.test(r.errores.join(' ')), r.errores);
    ok('3e · nombra la entidad que hay que dejar', /CD DÍA/.test(r.errores.join(' ')));
    ok('3f · y no deja la sesión abierta', r.signOut === 1);
}
{
    // Sin ninguna plaza viva, fundar sigue siendo legítimo.
    const r = await correr({
        clubId: null, requestedRole: 'club_admin', newClubName: 'ESTRELLA CF', finalRole: 'club_admin',
        docUsuario: { allRoles: [
            { role: 'user', clubId: 'club_A', status: 'removed', isAuthorized: false } ] },
        entidades: { club_A: { name: 'CD DÍA' } },
    });
    ok('3g · ⚠️ si ya le dieron de baja, SÍ puede fundar su club', r.bloqueado === false, r);
}
{
    // ⚠️ Y no se estropea el alta normal bajo un ente que YA existe: ahí hay
    // `selectedIndivId`, así que no es "fundar" y manda el camino de siempre.
    const r = await correr({
        clubId: null, requestedRole: 'individual', selectedIndivId: 'ente_1', finalRole: 'individual',
        docUsuario: { allRoles: [] },
        entidades: {},
    });
    ok('3h · unirse a un ente existente no entra por la vía de fundar', r.bloqueado === false, r);
}

console.log('\n── 4 · el bloqueo ocurre ANTES de escribir ──');
{
    const i = AUTH.indexOf("if (isAddingRole && (clubId || _fundaEntidadNueva) && finalRole !== 'superadmin') {");
    const primerSetDoc = AUTH.indexOf('fa.setDoc(fa.doc(fa.db, \'users\', cred.user.uid)', i);
    ok('4a · 🔑🔑🔑 la comprobación va ANTES del primer setDoc del usuario',
       i > 0 && primerSetDoc > i, { i, primerSetDoc });
    ok('4b · ⚠️ y antes de crear ninguna platform_request',
       AUTH.indexOf("'platform_requests'", i) > i);
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos === 0) console.log('✅ Un correo, una sola entidad — comprobado, no confiado');
else console.log('❌ ' + fallos + ' aserción(es) en rojo');
process.exit(fallos === 0 ? 0 : 1);
})();
