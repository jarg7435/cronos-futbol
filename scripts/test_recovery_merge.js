// ─────────────────────────────────────────────────────────────────────────
// test_recovery_merge.js · UNA sola tarjeta por partido en "Recuperar Partido
// en Curso" (v441)
//
// Reporte del autor: al salir y volver a entrar, el mismo partido salía DOS
// veces —"DISPOSITIVO LOCAL" y "NUBE"— y había que elegir entre dos tarjetas
// que son lo mismo.
//
// ESTE GUARD NO MIRA (solo) EL FUENTE: extrae las funciones de fusión de
// js/core/setup-modal.js y las EJECUTA contra los escenarios reales.
//
// LO QUE PROTEGE, y por qué cada cosa se rompe sola si nadie la vigila:
//
//  A · EL DEDUP POR ID NO BASTA. El que había comparaba sólo
//      `localMatch.liveMatchId === d.id`. Hay al menos dos formas de que esos
//      ids no coincidan aunque el partido sea el mismo: que el estado se
//      guardara antes de que startLiveSync asignase el id (arranca 800 ms
//      después de pintar a los jugadores), o que el partido se reanudara sin
//      pasar por "Retomar", en cuyo caso startLiveSync lo trata como NUEVO y
//      genera otro id —lleva hora y minuto en el sufijo— dejando huérfano el
//      documento anterior. Con el filtro por id, las dos tarjetas.
//
//  B · LA IDENTIDAD QUE AGUANTA SON LOS EQUIPOS + LA MODALIDAD, y es válida
//      PORQUE las dos fuentes ya vienen filtradas por el límite de duración
//      (80 min en F-7, 110/120 en F-11): la lista sólo contiene partidos de las
//      últimas dos horas, y en esa ventana no se juega dos veces el mismo
//      enfrentamiento. Si alguien quitara ese filtro, esta fusión empezaría a
//      juntar partidos distintos del mismo rival.
//
//  C · SE ENSEÑA LA FUENTE MÁS RECIENTE. Cada una sabe algo que la otra no: el
//      dispositivo tiene el estado más fresco si se perdió la cobertura; la
//      nube, si el partido se siguió desde otro aparato.
//
//  D · BORRAR TIENE QUE LLEVARSE LAS DOS FUENTES. Si sólo se borra una, la otra
//      reaparece sola en el siguiente repintado y el usuario vuelve a ver el
//      partido que acaba de eliminar.
//
//  E · 🐛 Y BORRAR UN DOCUMENTO CADUCADO NO PUEDE LLEVARSE EL PARTIDO DE HOY.
//      _doDeleteLiveMatch borraba el localStorage SIEMPRE, y se llama en
//      silencio para cada documento caducado al abrir el panel: un partido
//      viejo de la nube borraba el estado del partido en curso. Pérdida de
//      datos real y silenciosa.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 240)); }
};

const SM = fs.readFileSync(path.join(ROOT, 'js/core/setup-modal.js'), 'utf8');
const sinCom = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
const SMC = sinCom(SM);

console.log('── una sola tarjeta por partido al recuperar (v441) ──\n');

// ═══════ Se extraen las funciones de fusión y se EJECUTAN ═══════
const ini = SM.indexOf('function _recoveryNorm(');
const fin = SM.indexOf('window._fusionaCandidatosRecuperacion');
ok('0a · el bloque de fusión sigue en setup-modal.js', ini !== -1 && fin > ini);
if (ini === -1 || fin <= ini) { console.log('\n' + pass + ' PASS / ' + (fail + 1) + ' FAIL'); process.exit(1); }

const sandbox = { console: { log() {}, warn() {} }, window: {}, Map };
vm.createContext(sandbox);
vm.runInContext(SM.slice(ini, fin) +
    '\n;globalThis.fusiona = _fusionaCandidatosRecuperacion;' +
    '\n;globalThis.claves  = _recoveryClaves;' +
    '\n;globalThis.ts      = _recoveryTs;', sandbox);
const { fusiona, claves, ts } = sandbox;

// Los dos candidatos tal como los arma openLiveMatchRecovery.
const local = (o) => Object.assign({
    _id: 'local_active', isLocal: true,
    liveMatchId: 'cronos-04082026-ab12-1830',
    savedAt: '2026-08-04T18:45:00.000Z',
    homeTeam: { name: 'CRONOS A', score: 1 },
    awayTeam: { name: 'RIVAL FC', score: 0 },
    mode: 'f7', phase: '1st_half', timeH1: 600, playerCount: 12,
}, o);
const nube = (o) => Object.assign({
    _id: 'cronos-04082026-ab12-1830',
    updatedAt: { toMillis: () => new Date('2026-08-04T18:44:00.000Z').getTime() },
    homeTeam: { name: 'CRONOS A', score: 1 },
    awayTeam: { name: 'RIVAL FC', score: 0 },
    mode: 'f7', phase: '1st_half', timeH1: 590,
}, o);

// ═══════════ PARTE 1 · el caso que reportó el autor ═══════════
console.log('\n── PARTE 1 · dispositivo + nube = UNA tarjeta ──');
{
    // 1 · con los ids coincidiendo (lo que el dedup viejo sí cubría)
    let e = fusiona(local(), [nube()]);
    ok('1a · mismo id → una sola entrada', e.length === 1, e.length + ' entradas');
    ok('1b · y consta que está en las DOS fuentes',
       e[0].tieneLocal === true && e[0].idsNube.length === 1);

    // 2 · [DEFECTO A] el id local NO coincide: es el caso que fallaba
    e = fusiona(local({ liveMatchId: 'cronos-04082026-ab12-1902' }), [nube()]);
    ok('1c · [DEFECTO A] 🔑 ids DISTINTOS del mismo partido → sigue siendo UNA',
       e.length === 1, e.length + ' entradas: es el bug reportado');
    ok('1d · y se anota el documento de nube para poder borrarlo',
       e[0].tieneLocal === true && e[0].idsNube[0] === 'cronos-04082026-ab12-1830');

    // 3 · [DEFECTO A] el estado local se guardó SIN id
    e = fusiona(local({ liveMatchId: null }), [nube()]);
    ok('1e · [DEFECTO A] 🔑 sin id en el dispositivo → también UNA',
       e.length === 1, e.length + ' entradas');

    // 4 · dos documentos de nube huérfanos del mismo partido
    e = fusiona(local(), [nube(), nube({ _id: 'cronos-04082026-ab12-1902' })]);
    ok('1f · dos documentos de nube del mismo partido → UNA entrada',
       e.length === 1 && e[0].idsNube.length === 2,
       JSON.stringify(e.map(x => x.idsNube)));

    // 5 · 🔑 EL CASO QUE HACE FALTA LA CLAVE POR ID: mismo partido, pero
    // alguien renombró un equipo a mitad (se corrige el nombre del rival, por
    // ejemplo), así que la identidad por equipos YA NO casa. El id sí.
    e = fusiona(local({ awayTeam: { name: 'RIVAL C.F.', score: 0 } }), [nube()]);
    ok('1g · 🔑 equipo renombrado a mitad → el ID lo sigue fusionando',
       e.length === 1,
       'sin la clave por id, corregir un nombre partiría la tarjeta en dos');
    ok('1h · y conserva las dos procedencias',
       e[0].tieneLocal === true && e[0].idsNube.length === 1);
}

// ═══════════ PARTE 2 · lo que NO se puede fusionar ═══════════
console.log('\n── PARTE 2 · dos partidos distintos siguen siendo dos ──');
{
    let e = fusiona(local(), [nube({ _id: 'otro-1', homeTeam: { name: 'CRONOS B', score: 0 } })]);
    ok('2a · distinto equipo local → dos entradas', e.length === 2, e.length);

    e = fusiona(local(), [nube({ _id: 'otro-2', awayTeam: { name: 'OTRO RIVAL', score: 0 } })]);
    ok('2b · distinto rival → dos entradas', e.length === 2, e.length);

    e = fusiona(local(), [nube({ _id: 'otro-3', mode: 'f11' })]);
    ok('2c · distinta modalidad → dos entradas', e.length === 2, e.length);

    // Sin nombres no hay identidad por equipos: fusionar sería peor que no.
    const anon = { _id: 'x1', homeTeam: {}, awayTeam: {}, mode: 'f7', updatedAt: { toMillis: () => 1 } };
    const anon2 = { _id: 'x2', homeTeam: {}, awayTeam: {}, mode: 'f7', updatedAt: { toMillis: () => 2 } };
    e = fusiona(null, [anon, anon2]);
    ok('2d · 🔑 dos partidos SIN nombres de equipo no se fusionan entre sí',
       e.length === 2, e.length + ': sin nombres sólo vale el id, y son distintos');
    ok('2e · y sus claves no incluyen la de equipos',
       claves(anon).every(k => k.indexOf('eq:') !== 0), JSON.stringify(claves(anon)));

    // Mayúsculas y espacios no crean partidos nuevos.
    e = fusiona(local(), [nube({ _id: 'otro-4', homeTeam: { name: '  cronos a ', score: 1 } })]);
    ok('2f · el nombre se normaliza (mayúsculas y espacios)', e.length === 1, e.length);
}

// ═══════════ PARTE 3 · [DEFECTO C] manda la fuente más reciente ═══════════
console.log('\n── PARTE 3 · se enseña lo más fresco ──');
{
    // El dispositivo es más nuevo (18:45 vs 18:44)
    let e = fusiona(local(), [nube()]);
    ok('3a · gana el dispositivo cuando es el último guardado',
       e[0].datos.isLocal === true && e[0].datos.timeH1 === 600);

    // La nube es más nueva
    e = fusiona(local({ savedAt: '2026-08-04T18:40:00.000Z' }), [nube()]);
    ok('3b · [DEFECTO C] 🔑 gana la nube cuando es la última guardada',
       e[0].datos.isLocal !== true && e[0].datos.timeH1 === 590,
       'el marcador y el minuto que se enseñan tienen que ser los buenos');
    ok('3c · pero la entrada sigue sabiendo que también está en el dispositivo',
       e[0].tieneLocal === true,
       'de eso depende que al borrar se limpien las dos');

    ok('3d · updatedAt de Firestore se lee por toMillis',
       ts({ updatedAt: { toMillis: () => 1234 } }) === 1234);
    ok('3e · y también en su forma toDate',
       ts({ updatedAt: { toDate: () => new Date(5000) } }) === 5000);
    ok('3f · un candidato sin marca de tiempo no revienta ni gana',
       ts({}) === 0 && ts(null) === 0);

    // Orden entre entradas distintas: la más reciente primero.
    const e2 = fusiona(local(), [nube({ _id: 'z', homeTeam: { name: 'OTRO', score: 0 },
        updatedAt: { toMillis: () => new Date('2026-08-04T19:10:00.000Z').getTime() } })]);
    ok('3g · las entradas se ordenan por la más recientemente guardada',
       e2.length === 2 && e2[0].datos.homeTeam.name === 'OTRO', JSON.stringify(e2.map(x => x.ts)));
}

// ═══════════ PARTE 4 · nada se pierde por el camino ═══════════
console.log('\n── PARTE 4 · casos límite ──');
{
    ok('4a · sin partido local, la nube se lista igual',
       fusiona(null, [nube()]).length === 1);
    ok('4b · sin nube, el local se lista igual',
       fusiona(local(), []).length === 1 && fusiona(local(), null).length === 1);
    ok('4c · sin nada, lista vacía (no revienta)',
       fusiona(null, []).length === 0 && fusiona(undefined, undefined).length === 0);
    ok('4d · el local sin id ni nube produce UNA entrada, no cero',
       fusiona(local({ liveMatchId: null }), []).length === 1,
       'perder el partido del dispositivo por no tener id sería lo peor que puede pasar aquí');
}

// ═══════════ PARTE 5 · la interfaz pinta UNA tarjeta ═══════════
console.log('\n── PARTE 5 · el panel usa la fusión ──');
{
    // v465 · ACTUALIZADA A PROPOSITO: el primer argumento pasa a ser una LISTA
    // (`localMatches`). Ya no puede haber un solo partido local: desde v465 hay
    // una ranura por partido y un entrenador puede tener el Alevin y el Juvenil
    // abiertos a la vez, asi que el panel tiene que poder ensenyarlos todos o el
    // segundo seria irrecuperable. La intencion de la asercion no cambia: el
    // panel se pinta desde la FUSION, no desde una fuente suelta.
    // v561 · La fusión sigue siendo el origen; lo que se le añade encima es el
    // descarte de ranuras imposibles (incoherentes Y sin un segundo jugado, ver
    // test_recuperar_sin_ranuras_fantasma.js). La intención de la aserción no
    // cambia: el panel se pinta desde la FUSIÓN, no desde una fuente suelta.
    ok('5a · 🔑 el panel pinta a partir de las entradas fusionadas',
       /_fusionaCandidatosRecuperacion\(localMatches, docsNube\)/.test(SMC) &&
       /const entradas = _cronosDescartaRanurasImposibles\(/.test(SMC) &&
       /list\.innerHTML = entradas\.map\(/.test(SMC));
    ok('5a2 · v465 · y los candidatos locales salen de TODAS las ranuras',
       /_cronosMatchSlots\.listar\(\)/.test(SMC) && /const localMatches = \[\]/.test(SMC),
       'con una sola ranura, el segundo partido del entrenador no aparecia');
    ok('5b · y ya NO existe el descarte por id suelto que había',
       !/isSameId/.test(SMC),
       'era el dedup que sólo veía ids idénticos');
    ok('5c · 🔑 UNA sola etiqueta de procedencia, no dos tarjetas compitiendo',
       /DISPOSITIVO \+ ☁️ NUBE/.test(SM) && /SOLO EN ESTE DISPOSITIVO/.test(SM) &&
       (SMC.match(/const localTag = /g) || []).length === 1);
    // v465 · la llamada lleva un tercer argumento: QUE ranura local es esta
    // entrada. Con varios partidos abiertos, "tiene local" ya no basta para
    // borrar — habria que adivinar cual, y adivinar aqui significa llevarse por
    // delante el partido que sigue jugandose.
    ok('5d · [DEFECTO D] 🔑 eliminar se lleva las DOS fuentes',
       /_doDeleteRecoveryEntry\('\$\{idsAttr\}', \$\{entrada\.tieneLocal \? 'true' : 'false'\}, '\$\{idsLocalAttr\}'\)/.test(SM));
    ok('5e · y esa función borra cada documento de nube Y el estado del dispositivo',
       /async function _doDeleteRecoveryEntry[\s\S]{0,1200}?_doDeleteLiveMatch\(id, null, true\)[\s\S]{0,800}?S\.cerrar\(sid, true\)/.test(SMC));
    ok('5f · con UNA sola confirmación, no una por fuente',
       (SMC.match(/function _doDeleteRecoveryEntry[\s\S]{0,900}?confirm\(/g) || []).length === 1);
    // v465 · retomar dice QUE ranura. Sin el argumento, con dos partidos
    // abiertos las dos tarjetas llamaban a lo mismo y la segunda retomaba el
    // primero — la version anterior de esta asercion fijaba justo eso.
    ok('5g · retomar usa la fuente más reciente de la entrada, y dice CUÁL',
       /if \(m\.isLocal\) \{[\s\S]{0,600}?clickResume = `_doResumeLocalMatch\('\$\{safeSlot\}'\)`;/.test(SMC));
    ok('5h · el recuento de jugadores sale de cualquiera de las dos fuentes',
       /m\.playerCount \|\| \(Array\.isArray\(m\.players\) \? m\.players\.length : 0\)/.test(SMC),
       'el documento de nube guarda `players`, no `playerCount`: antes decía 0');
}

// ═══════════ PARTE 6 · [DEFECTO E] el borrado silencioso ═══════════
console.log('\n── PARTE 6 · borrar un caducado no borra el partido de hoy ──');
{
    // v465 · misma intencion, apuntando ademas a la RANURA correcta: ya no hay
    // "el estado local", hay uno por partido y hoy conviven dos igual de vivos.
    ok('6a · 🐛 el borrado sólo limpia el dispositivo si es el MISMO partido',
       /const _sid = _recoveryRanuraDelPartido\(matchId\);\s*\n\s*if \(_sid\) window\._cronosMatchSlots\?\.cerrar\(_sid, true\);/.test(SMC),
       'se llama en silencio por cada documento caducado al abrir el panel');
    ok('6b · y esa comprobación existe',
       /function _recoveryRanuraDelPartido\(matchId\)/.test(SMC));
    ok('6c · el barrido de caducados sigue siendo silencioso',
       /if \(isExpired\) \{\s*_doDeleteLiveMatch\(d\.id, null, true\);/.test(SMC));

    // Ejecutado: la comprobación decide bien con y sin id.
    // v465 · El corte empieza en `_recoveryRanuraDelPartido` porque es donde
    // vive ahora la lógica; `_recoveryEsElPartidoLocal` quedó como envoltorio
    // booleano y, extraído solo, reventaba con un ReferenceError. Y en vez de
    // un localStorage con un único valor, se le da un `_cronosMatchSlots` con
    // VARIAS ranuras: es la situación real desde v465 y la que hace falta para
    // que 6e signifique algo.
    const ini2 = SM.indexOf('function _recoveryRanuraDelPartido(matchId)');
    const fin2 = SM.indexOf('window._recoveryEsElPartidoLocal');
    if (ini2 !== -1 && fin2 > ini2) {
        const ranuras = { _lista: [] };
        const sb2 = { console: { log() {}, warn() {} }, JSON,
            _recoveryNorm: sandbox.window._recoveryNorm || ((s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ')) };
        sb2.window = { _cronosMatchSlots: { listar: () => ranuras._lista } };
        vm.createContext(sb2);
        vm.runInContext(SM.slice(ini2, fin2) +
            '\n;globalThis.esLocal = _recoveryEsElPartidoLocal;' +
            '\n;globalThis.ranuraDe = _recoveryRanuraDelPartido;', sb2);
        const esLocal = sb2.esLocal, ranuraDe = sb2.ranuraDe;

        // Dos partidos abiertos a la vez: exactamente el caso del autor.
        ranuras._lista = [
            { id: 'cronos-0408-aaa-1830', state: { liveMatchId: 'cronos-0408-aaa-1830', teamNames: { home: 'CRONOS A' } } },
            { id: 'cronos-0408-bbb-1900', state: { liveMatchId: 'cronos-0408-bbb-1900', teamNames: { home: 'CRONOS B' } } },
        ];
        ok('6d · con el MISMO id, sí limpia', esLocal('cronos-0408-aaa-1830') === true);
        ok('6d2 · v465 · 🔑 y dice QUÉ ranura, no sólo que hay alguna',
           ranuraDe('cronos-0408-bbb-1900') === 'cronos-0408-bbb-1900',
           'un booleano haría que borrar un partido se llevara el de al lado: ' + ranuraDe('cronos-0408-bbb-1900'));
        ok('6e · 🔑 con OTRO id (un caducado de otro día), NO limpia',
           esLocal('viejo-0308-bbb-1200') === false,
           'aquí estaba la pérdida de datos');
        ranuras._lista = [];
        ok('6f · sin partido en el dispositivo, no hay nada que limpiar',
           esLocal('cualquiera') === false);
        ranuras._lista = [{ id: 'roto', state: null }];
        ok('6g · y una ranura corrupta no revienta el borrado',
           esLocal('cualquiera') === false);
    } else {
        ok('6d · se pudo extraer _recoveryRanuraDelPartido', false);
    }
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
