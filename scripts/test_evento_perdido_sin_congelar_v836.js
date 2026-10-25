// ════════════════════════════════════════════════════════════════════════
//  test_evento_perdido_sin_congelar_v836.js
//  🧊 «REGISTRAR EVENTO PERDIDO» YA NO SE QUEDA CONGELADO — v836
// ════════════════════════════════════════════════════════════════════════
//  Reporte del autor (2026-10-25): en el iPad y en el móvil, al pulsar en
//  Evento Perdido, cargar un vídeo o cualquier dato, a veces la pantalla se
//  quedaba quieta sin hacer caso.
//
//  🔑 Eran ESPERAS DE RED SIN TOPE. Con la caché persistente de Firestore una
//  escritura no termina hasta que el servidor la confirma: sin cobertura el
//  `await` de Guardar no volvía nunca. Además el modal no aparecía hasta que
//  respondía la red, la lista de partidos bajaba 500 informes de golpe y la
//  subida del vídeo reintentaba 10 min sin decir nada.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const RM = leer('js/match/events/retroactive-modal.js');
const CL = leer('js/match/events/match-clips.js');
const cuerpo = (src, firma) => {
    const i = src.indexOf(firma);
    if (i < 0) return '';
    const j = src.indexOf('\n    }', i);
    return src.slice(i, j < 0 ? undefined : j);
};

console.log('\n🧊  EVENTO PERDIDO SIN CONGELARSE (v836)\n' + '─'.repeat(70));

(async () => {
    // ── 1 · El tope, de verdad ───────────────────────────────────────────
    const m = RM.match(/function _conTope\(promesa, ms\) \{[\s\S]*?\n    \}/);
    ok('1a · existe _conTope', !!m);
    const _conTope = m ? new Function(m[0] + '; return _conTope;')() : null;
    if (_conTope) {
        const nunca = new Promise(() => {});
        let err = null;
        try { await _conTope(nunca, 30); } catch (e) { err = e; }
        ok('1b · 🔑 una promesa que no vuelve NUNCA se corta con cronos/tope', err && err.code === 'cronos/tope', err);
        ok('1c · lo que vuelve a tiempo pasa intacto', (await _conTope(Promise.resolve(7), 1000)) === 7);
        let err2 = null;
        try { await _conTope(Promise.reject({ code: 'permission-denied' }), 1000); } catch (e) { err2 = e; }
        ok('1d · un error real NO se disfraza de tope', err2 && err2.code === 'permission-denied', err2);
    }

    // ── 2 · Toda espera de red del modal lleva tope ─────────────────────
    ok('2a · leer el partido (getDoc) con tope',
       /_conTope\(fs\.getDoc\(fs\.doc\(fa\.db, 'live_matches', matchId\)\), _TOPE_LECTURA\)/.test(RM));
    ok('2b · reconstruir desde informes con tope',
       /_conTope\(fsm\.getDocs\(fsm\.query\(fsm\.collection\(fa\.db, 'cronos_player_reports'\),\s*fsm\.where\('coachUid', '==', me\.uid\), fsm\.where\('matchId'/.test(RM));
    ok('2c · el permiso de desbloqueo con tope', /_conTope\(Promise\.resolve\(window\.CronosUnlocks\.leer\(_targetMatchId\)\), _TOPE_LECTURA\)/.test(RM));
    ok('2d · las consultas de la corrección del informe con tope',
       /Promise\.allSettled\(consultas\.map\(c => _conTope\(c, _TOPE_LECTURA\)\)\)/.test(RM));
    ok('2e · 🔑 la ficha del partido (setDoc) con tope', /_conTope\(fsm\.setDoc\(fsm\.doc\(fa\.db, 'live_matches', _targetMatchId\)/.test(RM));
    ok('2f · 🔑 el lote de informes (commit) con tope', /_conTope\(lote\.commit\(\), _TOPE_ESCRITURA\)/.test(RM));
    ok('2g · ningún getDocs/getDoc/setDoc/commit suelto sin tope en el modal',
       !/await fsm?\.(getDocs?|setDoc)\(/.test(RM) && !/await lote\.commit\(\)/.test(RM));

    // ── 3 · Una escritura que vence va EN COLA, no es un fallo ──────────
    const per = cuerpo(RM, 'async function _persisteCorreccionDestino');
    ok('3a · ficha del partido: tope → en cola y éxito (no fallo)', /if \(_esTope\(e\)\) \{ _quedoEnCola = true; return true; \}/.test(per));
    const inf = cuerpo(RM, 'async function _corrigeInformesDelPartido');
    ok('3b · 🔑 informe: tope → en cola; reintentar SUMARÍA dos veces el gol',
       /catch \(e\) \{ if \(!_esTope\(e\)\) throw e; _quedoEnCola = true; \}/.test(inf));
    ok('3c · el aviso final dice que va en cola', /if \(_quedoEnCola\) \{ aviso \+= ' · 📶 Conexión lenta/.test(RM));

    // ── 4 · Guardar: un solo guardado y el botón dice qué pasa ──────────
    const sub = cuerpo(RM, 'window.submitRetroactiveEvent = async function');
    ok('4a · 🔑 doble pulsación: el segundo toque no lanza otro guardado', /if \(_guardando\) return;\s*_guardando = true;/.test(sub));
    ok('4b · el botón pasa a «Guardando…» al pulsar', /_estadoGuardar\('⏳ Guardando…'\)/.test(sub));
    ok('4c · y se libera SIEMPRE (finally), también si algo lanza',
       /finally \{ _guardando = false; _estadoGuardar\(null\); \}/.test(sub));
    ok('4d · el % de la subida del vídeo se ve en el botón',
       /\(f\) => _estadoGuardar\('⏳ Subiendo vídeo ' \+ \(i \+ 1\) \+ ' de ' \+ conClip\.length \+ ' · ' \+ Math\.round\(f \* 100\) \+ ' %'\)/.test(RM));
    ok('4e · reintentar el informe tampoco se pisa a sí mismo', /if \(!_informePendiente \|\| _guardando\) return;/.test(RM));

    // ── 5 · El modal sale en el acto ────────────────────────────────────
    const abrir = RM.slice(RM.indexOf('window.openRetroactiveEventModal = async function'));
    const iEspera = abrir.indexOf('⏳ Cargando el partido…');
    const iLeer = abrir.indexOf('await _cargarPartido(_targetMatchId)');
    ok('5a · 🔑 el «Cargando…» se pinta ANTES de esperar a la red', iEspera > 0 && iLeer > 0 && iEspera < iLeer, { iEspera, iLeer });
    ok('5b · cerrar mientras carga cancela la apertura',
       /const tokAbrir = \+\+_tokEleccion;/.test(abrir) &&
       (abrir.match(/if \(tokAbrir !== _tokEleccion\) return;/g) || []).length >= 3 &&
       /_tokEleccion\+\+;   \/\/ 🧊 v836/.test(RM));

    // ── 6 · La lista de partidos, por páginas ───────────────────────────
    const lista = cuerpo(RM, 'async function _cargaPartidosDelEquipo');
    ok('6a · ya no baja 500 informes de golpe', !/fsm\.limit\(500\)/.test(lista));
    ok('6b · páginas de 60 con startAfter, y para al tener los partidos',
       /_PAGINA = 60/.test(lista) && /fsm\.startAfter\(ultimo\)/.test(lista) && /mids\.size > _MAX_PARTIDOS \+ 2/.test(lista));
    ok('6c · sólo cuentan los partidos del equipo seleccionado', /\(!eq \|\| !r\.teamId \|\| String\(r\.teamId\) === eq\)/.test(lista));
    ok('6d · sin red, la nota lo dice (no «no hay partidos»)', /lista\._sinRed = true/.test(lista) && /nota\.textContent = lista\._sinRed/.test(RM));

    // ── 7 · El vídeo ────────────────────────────────────────────────────
    ok('7a · 🔑 subida que no avanza en 45 s → se cancela y falla', /const ATASCO_MS = 45 \* 1000;/.test(CL) && /tarea\.cancel\(\)/.test(CL) && /cronos\/subida-atascada/.test(CL));
    ok('7b · la ficha del clip no espera para siempre', /Promise\.race\(\[ficha, new Promise\(\(r\) => \{ reloj = setTimeout\(r, 15000\); \}\)\]\)/.test(CL));
    ok('7c · la comprobación suelta el <video> (iOS tiene pocos descodificadores)', /v\.removeAttribute\('src'\); v\.load\(\);/.test(CL));

    console.log('\n' + '─'.repeat(70));
    console.log('Resultado: ' + (total - fallos) + '/' + total);
    if (fallos) { console.log('❌ ' + fallos + ' fallo(s)'); process.exit(1); }
    console.log('✅ Evento Perdido no se queda esperando a una red que no contesta');
})();
