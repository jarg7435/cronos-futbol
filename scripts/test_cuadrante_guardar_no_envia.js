// ═══════════════════════════════════════════════════════════════════════════
//  GUARD · v734 · GUARDAR EL CUADRANTE NO ES ENVIARLO
// ═══════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-17, capturas 10538-10540):
//  «GUARDAR debe limitarse estrictamente a guardar y persistir el cuadrante
//  para el director/coordinador, sin enviarlo a los entrenadores. La
//  sincronización con el panel del entrenador sólo debe producirse al pulsar
//  ENVIAR A ENTRENADORES».
//
//  📏 MEDIDO EN SUS CAPTURAS: pulsa GUARDAR y el panel del entrenador, abierto
//  al lado, pasa de «el club todavía no ha enviado el cuadrante» a enseñar la
//  semana entera. El documento era UNO SOLO: `celdas`/`filas` hacían de
//  borrador Y de pauta publicada, y lo único que decidía la visibilidad era
//  que existiera `publicadoEn`… que ya estaba de un envío anterior.
//
//  🚨 POR QUÉ ESTE GUARD EJECUTA EL CICLO ENTERO contra un Firestore de
//  mentira —guardar, mirar con los ojos del entrenador, enviar, volver a
//  mirar— en vez de comprobar por texto que existe una rama `publicado`:
//  porque lo que importa no es que el campo exista, sino QUÉ VE EL ENTRENADOR
//  en cada momento. Y porque el guardado escribe el documento entero sin
//  fusionar: un descuido ahí no rompe una pantalla, **borra la pauta de todos
//  los equipos del club** sin un solo error.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const RAIZ = path.join(__dirname, '..');
const CQ   = fs.readFileSync(path.join(RAIZ, 'js/coach/reports/cuadrante-club.js'), 'utf8');

let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else {
        console.log('  ✗ ' + nombre);
        if (detalle !== undefined) console.log('      → ' + String(detalle).slice(0, 300));
        fallos++;
    }
}

const CLUB = 'club_dia';
const SEM  = '2026-09-21';
const EQ   = 'club_dia__regional__b';
// El id del documento lo pone `_cqDocId` ('CUADRANTE__<lunes>'): se toma de la
// constante del módulo y no se copia, para que un cambio de prefijo no deje
// este guard mirando un documento que ya no existe.
const DOCID = (CQ.match(/function _cqDocId\(weekKey\) \{ return '([^']+)'/) || [])[1] + SEM;

// ── Un club con su semana, en memoria ─────────────────────────────────────
function montar(docInicial) {
    const docs = {};
    if (docInicial) docs[DOCID] = JSON.parse(JSON.stringify(docInicial));
    const notificaciones = [];

    const api = {
        db: {},
        doc: (db, col, club, sub, id) => ({ _col: col, _id: id === undefined ? sub : id }),
        getDoc: async (ref) => ({
            exists: () => !!docs[ref._id],
            data: () => docs[ref._id],
        }),
        setDoc: async (ref, data, op) => {
            if (ref._col === 'cronos_notifications') { notificaciones.push(data); return; }
            docs[ref._id] = (op && op.merge)
                ? Object.assign({}, docs[ref._id] || {}, JSON.parse(JSON.stringify(data)))
                : JSON.parse(JSON.stringify(data));
        },
        updateDoc: async () => {},
        deleteDoc: async (ref) => { delete docs[ref._id]; },
        collection: () => ({}), query: () => ({}), where: () => ({}), getDocs: async () => ({ forEach() {} }),
        onSnapshot: () => (() => {}),
    };

    const sb = {
        console: { log() {}, warn() {}, error() {} },
        String, Array, Number, Object, Date, parseInt, parseFloat, isNaN, RegExp, Math, JSON,
        Promise, Set, Error, setTimeout: (f) => { try { f(); } catch (e) {} return 1; },
        clearTimeout: () => {},
        document: {
            getElementById: () => null,
            body: { contains: () => false, appendChild() {} },
            addEventListener: () => {},
            querySelectorAll: (sel) => (sel === '.cq-env-chk' ? sb.__checks : []),
            createElement: () => ({ style: {}, addEventListener() {}, remove() {} }),
        },
        confirm: () => true,
        __checks: [],
    };
    sb.window = sb;
    sb.globalThis = sb;
    sb._sdFS = async () => api;                       // el adaptador que usa _cqFS()
    sb._cronosCurrentUser = { uid: 'uid_dd', clubId: CLUB, displayName: 'DIRECTOR' };
    sb.cronosMyTeamId = () => EQ;
    sb.cronosMyTeam   = () => ({ teamId: EQ, category: 'regional', subcategory: 'B' });
    vm.createContext(sb);
    // ⚠️ El probe se arma con `typeof` a propósito. Sin esto, el RED-CHECK
    // —cargar el módulo ANTERIOR, donde estas funciones aún no existen— moría
    // con un ReferenceError al montar el sandbox y el guard no llegaba a
    // decir qué falla. Un guard en rojo tiene que informar, no reventar.
    vm.runInContext(CQ +
        '\n;window.__p = {' +
        '  _cqGuardar:             (typeof _cqGuardar === "function") ? _cqGuardar : null,' +
        '  _cqHayCambiosSinEnviar: (typeof _cqHayCambiosSinEnviar === "function") ? _cqHayCambiosSinEnviar : function () { return false; },' +
        '  _cqRamaPublicada:       (typeof _cqRamaPublicada === "function") ? _cqRamaPublicada : function () { return null; },' +
        '  _cqDocId:               (typeof _cqDocId === "function") ? _cqDocId : null' +
        '};', sb);
    sb.__docs = docs;
    sb.__notifs = notificaciones;
    return sb;
}

// El borrador que tiene el director en pantalla.
function borrador(texto, extra) {
    return Object.assign({
        v: 1, weekKey: SEM, espacios: 2,
        filas:  [{ id: EQ, label: 'Regional B' }],
        celdas: { [EQ + '|2026-09-22']: { tipo: 'entreno', txt: texto, ini: '18:00', fin: '19:30' } },
        publicadoEn: '', publicadoPor: '', publicadoA: [],
        actualizado: '', actualizadoPorNombre: '',
    }, extra || {});
}

// Lo que ve el ENTRENADOR de ese equipo.
async function loQueVeElEntrenador(sb) {
    sb._cronosCurrentUser = { uid: 'uid_coach', clubId: CLUB };
    // La caché de 60 s del módulo mentiría entre pasadas: se vacía.
    vm.runInContext('for (var k in _cqCacheDirectriz) delete _cqCacheDirectriz[k];', sb);
    const info = await vm.runInContext(
        'window.cronosCuadranteClubDeMiEquipo(' + JSON.stringify(SEM) + ', true)', sb);
    sb._cronosCurrentUser = { uid: 'uid_dd', clubId: CLUB, displayName: 'DIRECTOR' };
    if (!info || !info.hayAlgo) return null;
    const dia = info.dias.filter(d => !d.vacio)[0];
    return dia ? (dia.txt || '') : null;
}

// Pulsar ENVIAR A ENTRENADORES con un entrenador marcado.
async function enviar(sb) {
    sb.__checks = [{ checked: true, dataset: { i: '0' } }];
    sb._cqEnvioLista = [{ uid: 'uid_coach', nombre: 'ENTRENADOR', cat: 'regional', sub: 'B' }];
    await vm.runInContext('window.cqEnviar()', sb);
}

console.log('\n══ v734 · el cuadrante se guarda y se envía por separado ══');

(async function () {
  try {
    // ═════════════════════════════════════════════════════════════════
    console.log('\n1) 🔑 EL CICLO COMPLETO, con los ojos del entrenador');
    {
        const sb = montar(null);
        sb._cqState = { doc: borrador('ENTRENO A'), offset: 0, sucio: true };

        await vm.runInContext('window.__p._cqGuardar(' + JSON.stringify(CLUB) + ', window._cqState.doc)', sb);
        ok('1a · guardado y nunca enviado: el entrenador no ve NADA',
           (await loQueVeElEntrenador(sb)) === null,
           'un borrador no es una directriz');

        await enviar(sb);
        ok('1b · 🔑 tras ENVIAR, el entrenador ve la semana',
           (await loQueVeElEntrenador(sb)) === 'ENTRENO A');
        ok('1c · …y le llega su aviso', sb.__notifs.length === 1 &&
           sb.__notifs[0].type === 'cuadrante_club');

        // 🔑🔑 EL CASO DE SUS CAPTURAS: cambiar y GUARDAR, sin enviar.
        sb._cqState.doc.celdas[EQ + '|2026-09-22'].txt = 'ENTRENO B (borrador)';
        await vm.runInContext('window.__p._cqGuardar(' + JSON.stringify(CLUB) + ', window._cqState.doc)', sb);
        ok('1d · 🔑🔑 se guarda un cambio y el entrenador SIGUE viendo el anterior',
           (await loQueVeElEntrenador(sb)) === 'ENTRENO A',
           'es exactamente la captura 10540: guardar publicaba');
        ok('1e · y el director ve que tiene cambios sin enviar',
           vm.runInContext('window.__p._cqHayCambiosSinEnviar(window._cqState.doc)', sb) === true);

        await enviar(sb);
        ok('1f · al volver a enviar, el entrenador ve lo nuevo',
           (await loQueVeElEntrenador(sb)) === 'ENTRENO B (borrador)');
        ok('1g · …y ya no hay nada pendiente de enviar',
           vm.runInContext('window.__p._cqHayCambiosSinEnviar(window._cqState.doc)', sb) === false);
    }

    // ═════════════════════════════════════════════════════════════════
    console.log('\n2) ⚠️ EL GUARDADO ESCRIBE EL DOCUMENTO ENTERO (merge:false)');
    {
        const sb = montar(null);
        sb._cqState = { doc: borrador('ENTRENO A'), offset: 0, sucio: true };
        await vm.runInContext('window.__p._cqGuardar(' + JSON.stringify(CLUB) + ', window._cqState.doc)', sb);
        await enviar(sb);
        const antes = JSON.stringify(sb.__docs[DOCID].publicado);

        // Tres guardados seguidos del director, sin enviar.
        for (const t of ['b1', 'b2', 'b3']) {
            sb._cqState.doc.celdas[EQ + '|2026-09-22'].txt = t;
            await vm.runInContext('window.__p._cqGuardar(' + JSON.stringify(CLUB) + ', window._cqState.doc)', sb);
        }
        ok('2a · 🔑🔑 la pauta publicada sobrevive intacta a los guardados',
           JSON.stringify(sb.__docs[DOCID].publicado) === antes,
           'sin `publicado` en el payload, cada guardado la borraría');
        ok('2b · y el entrenador sigue viendo lo último ENVIADO',
           (await loQueVeElEntrenador(sb)) === 'ENTRENO A');
    }

    // ═════════════════════════════════════════════════════════════════
    console.log('\n3) 🚨 LO YA ENVIADO ANTES DE v734 NO PUEDE DESAPARECER');
    {
        // Un documento como los que hay HOY en producción: publicado, con la
        // pauta en la raíz y sin rama `publicado`.
        const viejo = borrador('LO QUE YA VEN', {
            publicadoEn: '2026-09-15T16:53:00.000Z', publicadoPor: 'uid_dd',
            publicadoA: ['uid_coach'], actualizado: '2026-09-15T16:53:00.000Z',
        });
        const sb = montar(viejo);
        ok('3a · 🚨 un cuadrante enviado antes de v734 se sigue viendo',
           (await loQueVeElEntrenador(sb)) === 'LO QUE YA VEN',
           'sin el respaldo a la raíz, todos los clubes se quedarían en blanco');

        // El director abre, cambia algo y GUARDA: la rama publicada se siembra
        // con lo que había, no con el borrador nuevo.
        sb._cqState = { doc: JSON.parse(JSON.stringify(viejo)), offset: 0, sucio: true };
        sb._cqState.doc.celdas[EQ + '|2026-09-22'].txt = 'BORRADOR NUEVO';
        await vm.runInContext('window.__p._cqGuardar(' + JSON.stringify(CLUB) + ', window._cqState.doc)', sb);
        ok('3b · 🔑 al guardar se siembra lo publicado con lo que el servidor ya tenía',
           !!sb.__docs[DOCID].publicado && sb.__docs[DOCID].publicado.publicadoEn === viejo.publicadoEn);
        ok('3c · 🔑🔑 y el entrenador NO ve el borrador nuevo',
           (await loQueVeElEntrenador(sb)) === 'LO QUE YA VEN',
           'esta es la migración perezosa: sin ella, el primer guardado publicaría');
    }

    // ═════════════════════════════════════════════════════════════════
    console.log('\n4) EL CAMBIO AJENO NO SE LLEVA LA PAUTA POR DELANTE');
    // ⚠️ Se acota el bloque de verdad en vez de contar caracteres: la primera
    // versión de esta aserción usaba un `{0,600}` y salió ROJA sin defecto,
    // porque el comentario que explica el arreglo ocupa más que el margen.
    const _iEnt = CQ.indexOf('const entrante = {');
    const _bloqueEntrante = _iEnt < 0 ? '' : CQ.slice(_iEnt, CQ.indexOf('};', _iEnt));
    ok('4a · la rama publicada viaja en el objeto de la escucha en vivo',
       /publicado:\s*_cqRamaPublicada\(d\)/.test(_bloqueEntrante),
       'sin esto, adoptar el cambio de otro coordinador y guardar borraría la pauta');
    ok('4b · el envío es el ÚNICO sitio que escribe `st.doc.publicado`',
       (CQ.match(/st\.doc\.publicado\s*=\s*\{/g) || []).length === 1);
    ok('4c · la exportación distingue los tres estados',
       /Enviado, con cambios guardados SIN ENVIAR/.test(CQ));

    console.log('\n' + (total - fallos) + '/' + total + ' aserciones OK');
    process.exit(fallos ? 1 : 0);
  } catch (e) {
    console.log('\n  ✗ el arnés reventó: ' + (e && e.message));
    console.log('\n' + (total - fallos) + '/' + (total + 1) + ' aserciones OK');
    process.exit(1);
  }
})();
