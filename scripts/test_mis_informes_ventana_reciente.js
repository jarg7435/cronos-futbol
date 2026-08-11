// ─────────────────────────────────────────────────────────────────────────
// test_mis_informes_ventana_reciente.js · "Mis Informes" alcanza el partido
// de HOY aunque el club tenga miles de informes (v508)
//
// 🔑🔑🔑 EL FALLO, MEDIDO SOBRE LOS DATOS REALES el 2026-08-11:
//
//   La consulta de "Mis Informes" pedía `limit(500)` **sin `orderBy`**. Un
//   `limit` sin orden NO son "los últimos 500": Firestore devuelve los 500
//   PRIMEROS POR ID DE DOCUMENTO. Y el ID de estos informes empieza por
//   `match_{uid}_{AAAA-MM-DD}_…`, así que el orden por ID es CRONOLÓGICO
//   ASCENDENTE: la ventana estaba clavada en lo MÁS VIEJO.
//
//   Números reales del club `club_mqvr9m11_g9kj`: **3620 informes**; los 500
//   que traía la consulta iban del **2026-06-27 al 2026-07-01**. El informe
//   recién guardado era el documento ~3600. Inalcanzable. De ahí el "Sin
//   informes aún" del reporte, con la copia del entrenador correctamente
//   escrita en la base de datos (verificado por REST: existe, con su
//   `coachUid`, su `clubId` y su `teamId`).
//
// 🔑 LA ASIMETRÍA QUE LO EXPLICABA: el Panel de Dirección (reports-tab.js) SÍ
//   ordena por `createdAt desc`. Misma colección, dos consultas distintas —
//   por eso "al Director le llega y al Entrenador no". No era permisos, no era
//   la cuenta multi-rol y no era la escritura.
//
// ⚠️ POR QUÉ SE ORDENA POR `__name__` Y NO POR `createdAt`: con una sola
//   igualdad, ordenar por el ID no necesita índice compuesto nuevo (verificado
//   contra producción por REST); `createdAt` sí lo exigiría y habría que
//   desplegar índices aparte, que en este proyecto no se puede probar en
//   testeo (comparte la BD con producción).
//
// LO QUE PROTEGE (ejecutando `openMisInformes` de verdad, con un Firestore de
// mentira que SIMULA el comportamiento real de Firestore: filtra, ORDENA como
// se le pida —por ID ascendente si no se pide nada— y recorta al `limit`):
//
//  A · Con 3620 informes en el club, el partido de HOY aparece.
//  B · ⚠️ Y aparece también cuando los 500 más recientes del club son casi
//      todos de OTROS entrenadores: lo que él firmó no puede depender del
//      volumen ajeno.
//  C · ⚠️ Sigue funcionando el caso pequeño (sin miles de documentos), que es
//      donde esto "funcionaba" y por eso nadie lo vio.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const SRC = fs.readFileSync(path.join(ROOT, 'js/coach/comms/individual-reports.js'), 'utf8');

function extrae(src, ancla) {
    const ini = src.indexOf(ancla);
    if (ini === -1) return null;
    const abre = src.indexOf('{', ini);
    let n = 0;
    for (let i = abre; i < src.length; i++) {
        if (src[i] === '{') n++;
        else if (src[i] === '}') { n--; if (n === 0) return src.slice(ini, i + 1); }
    }
    return null;
}

const HOY   = '2026-08-11';
const UID   = 'coachA';
const CLUB  = 'club1';
const CAT   = 'f7_alevin';
const TEAM  = 'club1__f7_alevin__';

// Genera el corpus: muchos informes viejos + los de HOY al final.
function corpus({ viejos = 3600, deOtros = false } = {}) {
    const docs = [];
    // ⚠️ Las fechas del histórico tienen que quedar ESTRICTAMENTE ANTES de
    // HOY, como en los datos reales (2026-06-27 → 2026-08-10, 45 días). En la
    // primera versión de este guard repartía 1 día por cada 30 documentos y
    // con 3600 se iba hasta OCTUBRE: informes "viejos" con fecha posterior a
    // la del partido de hoy, que lo desplazaban con toda la razón. Una
    // fixture que no respeta el orden real no prueba nada.
    const DIAS = 45;   // 2026-06-27 … 2026-08-10
    const dia = (i) => {
        const d = new Date('2026-06-27T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + Math.floor((i * DIAS) / Math.max(viejos, 1)));
        return d.toISOString().split('T')[0];
    };
    for (let i = 0; i < viejos; i++) {
        const autor = deOtros ? 'coachB' : UID;
        const f = dia(i);
        docs.push({
            id: `match_${autor}_${f}_rival_1x0_coach_p${i % 20}`,
            data: {
                matchId: `match_${autor}_${f}_rival_1x0`,
                _forCoach: true, staffReport: false, type: 'collective_match_report',
                clubId: CLUB, coachUid: autor, matchDate: f, createdAt: f + 'T10:00:00.000Z',
                rival: 'CD Viejo', scoreHome: '1', scoreAway: '0',
                category: CAT, subcategory: '', teamId: TEAM,
                playerNumber: String(i % 20), playerAlias: 'J' + (i % 20),
                minutesPlayed: '10', goals: 0, history: [],
            }
        });
    }
    // El partido de HOY, firmado por ÉL. Su id ordena EL ÚLTIMO por nombre.
    for (let p = 1; p <= 3; p++) {
        docs.push({
            id: `match_${UID}_${HOY}_visitante_7x1_coach_p${p}`,
            data: {
                matchId: `match_${UID}_${HOY}_visitante_7x1`,
                _forCoach: true, staffReport: false, type: 'collective_match_report',
                clubId: CLUB, coachUid: UID, matchDate: HOY, createdAt: HOY + 'T18:00:00.000Z',
                rival: 'CD DEMOSTRACION', scoreHome: '7', scoreAway: '1',
                category: CAT, subcategory: '', teamId: TEAM,
                playerNumber: String(p), playerAlias: 'Jugador' + p,
                minutesPlayed: '40', goals: 1, history: [],
            }
        });
    }
    return docs;
}

// Firestore de mentira que se comporta como el de verdad: filtra por las
// igualdades, ORDENA (por id ascendente si NO se pide orden) y recorta.
function firestoreFalso(docs) {
    const consultas = [];
    return {
        consultas,
        api: {
            collection: () => ({ __col: 'cronos_player_reports' }),
            where: (f, o, v) => ({ __t: 'where', f, v }),
            limit: (n) => ({ __t: 'limit', n }),
            orderBy: (f, dir) => ({ __t: 'orderBy', f, dir: dir || 'asc' }),
            query: (col, ...partes) => ({ __col: col.__col, partes }),
            getDocs: async (q) => {
                const wheres = q.partes.filter(p => p.__t === 'where');
                const ord    = q.partes.find(p => p.__t === 'orderBy');
                const lim    = q.partes.find(p => p.__t === 'limit');
                consultas.push({
                    campos: wheres.map(w => w.f).join('+'),
                    orden: ord ? ord.f + ' ' + ord.dir : '(SIN ORDEN)',
                    limite: lim ? lim.n : null,
                });
                let r = docs.filter(d => wheres.every(w => d.data[w.f] === w.v));
                // Firestore ordena por __name__ ASC cuando no se pide nada.
                const desc = ord && String(ord.dir).toLowerCase() === 'desc';
                r = r.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
                if (desc) r.reverse();
                if (lim) r = r.slice(0, lim.n);
                return { forEach: (fn) => r.forEach(d => fn({ id: d.id, data: () => d.data })) };
            },
        }
    };
}

const mkEl = () => {
    const el = {
        innerHTML: '', value: '', textContent: '', style: {}, dataset: {},
        querySelector: () => null, addEventListener: () => {},
        appendChild: () => {}, classList: { add(){}, remove(){}, contains(){ return false; } },
    };
    return el;
};

async function abrirMisInformes(docs, me) {
    const ff = firestoreFalso(docs);
    const els = {};
    const sb = {
        _cronosCurrentUser: me,
        _cronos_auth: { db: {} },
        document: {
            getElementById: (id) => (els[id] = els[id] || mkEl()),
            createElement: () => mkEl(),
        },
        console: { log() {}, warn() {}, error() {} },
        Promise, Map, Set, Array, Object, String, Number, Date, Math, JSON, Intl,
        parseInt, parseFloat, isNaN, RegExp, Error,
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
        btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
        atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
        encodeURIComponent, decodeURIComponent, unescape, escape,
        escapeHtml: (s) => String(s == null ? '' : s),
        formatTime: (s) => String(s),
        showToast: () => {},
        _cFS: async () => Object.assign({ db: {} }, ff.api),
        cronosTeamId: (c, cat, sub) => (c && cat ? c + '__' + cat + '__' + (sub || '') : ''),
        cronosTeamIdOfDoc: (d) => d.teamId || '',
        cronosDocEsDeEquipo: (d, equipos) => {
            const propio = d.teamId || '';
            return propio ? equipos.indexOf(propio) !== -1 : false;
        },
    };
    vm.createContext(sb);
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInContext(SRC_FN, sb);
    await sb.window.openMisInformes();
    return { cuerpo: (els['mis-informes-body'] || {}).innerHTML || '', consultas: ff.consultas };
}

const SRC_FN = extrae(SRC, 'window.openMisInformes = async function openMisInformes()');

// ⚠️ El `catch` de openMisInformes pinta un div rojo. Sin comprobarlo, un
// "no dice Sin informes aún" daría VERDE con la función reventada — que es
// justo lo que me pasó en la primera pasada de este guard (faltaba `btoa`).
// OJO: `#ff5858` se usa TAMBIÉN en las tarjetas normales (derrota, botón de
// borrar…). Hay que reconocer el contenedor de error EXACTO, no el color.
const salioBien = (cuerpo) =>
    !/Sin informes a[úu]n/.test(cuerpo) &&
    !/text-align:center;padding:2rem;color:#ff5858/.test(cuerpo);
const traeElDeHoy = (cuerpo) => /CD DEMOSTRACION/.test(cuerpo) && salioBien(cuerpo);

console.log('── "Mis Informes" alcanza el partido de hoy (v508) ──\n');
ok('0 · se puede extraer openMisInformes', !!SRC_FN);
if (!SRC_FN) process.exit(1);

(async () => {

// ═══ PARTE 1 · el caso EXACTO del reporte ═══
console.log('── PARTE 1 · 3620 informes en el club, el de hoy el último ──');
{
    const me = { uid: UID, clubId: CLUB, category: CAT, subcategory: '' };
    const r = await abrirMisInformes(corpus({ viejos: 3600 }), me);

    ok('1a · 🔑🔑🔑 el partido de HOY aparece (antes: "Sin informes aún")',
       traeElDeHoy(r.cuerpo), r.cuerpo.slice(0, 220));
    ok('1b · y NO se queda en el estado vacío NI revienta',
       salioBien(r.cuerpo), r.cuerpo.slice(0, 220));
    ok('1c · 🔑 la consulta pide los MÁS NUEVOS primero, no una ventana ciega',
       r.consultas.length > 0 && r.consultas.every(c => c.orden !== '(SIN ORDEN)'),
       JSON.stringify(r.consultas));
}

// ═══ PARTE 2 · el club lleno de informes de OTROS entrenadores ═══
console.log('\n── PARTE 2 · los 500 más recientes del club son de otros ──');
{
    const me = { uid: UID, clubId: CLUB, category: CAT, subcategory: '' };
    // 3600 informes de OTRO entrenador, con fechas POSTERIORES a las suyas no:
    // aquí basta con que sean tantos que copen cualquier ventana del club.
    const docs = corpus({ viejos: 3600, deOtros: true });
    const r = await abrirMisInformes(docs, me);
    ok('2a · ⚠️ aun así aparece SU partido de hoy',
       traeElDeHoy(r.cuerpo), r.cuerpo.slice(0, 220));
    ok('2b · 🔑 porque además se consulta SIEMPRE por su coachUid',
       r.consultas.some(c => c.campos === 'coachUid'),
       JSON.stringify(r.consultas));
}

// ═══ PARTE 3 · contraprueba: el caso pequeño sigue bien ═══
console.log('\n── PARTE 3 · contraprueba: pocos informes ──');
{
    const me = { uid: UID, clubId: CLUB, category: CAT, subcategory: '' };
    const r = await abrirMisInformes(corpus({ viejos: 6 }), me);
    ok('3a · ⚠️ con pocos informes sigue mostrándose todo',
       traeElDeHoy(r.cuerpo), r.cuerpo.slice(0, 220));

    // Y sin categoría asignada (la rama del `else`), que es la de este usuario
    // según su documento de `users`.
    const r2 = await abrirMisInformes(corpus({ viejos: 3600 }), { uid: UID, clubId: CLUB });
    ok('3b · ⚠️ sin categoría asignada también alcanza el de hoy',
       traeElDeHoy(r2.cuerpo), r2.cuerpo.slice(0, 220));
}

console.log('\n' + (fail === 0 ? 'TODO OK' : 'FALLOS: ' + fail) + ' (pass=' + pass + ')');
process.exit(fail === 0 ? 0 : 1);

})();
