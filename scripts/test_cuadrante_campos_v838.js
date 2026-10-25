// ════════════════════════════════════════════════════════════════════════
//  test_cuadrante_campos_v838.js
//  🏟️ CAMPO / INSTALACIÓN EN EL CUADRANTE — v838
// ════════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt, 2026-10-25, capturas 11698-11700):
//  como la «Cancha / pista» de Chronos Basket, al programar una actividad en
//  el cuadrante se elige el CAMPO (con nombres que el club personaliza) y,
//  dentro de él, los 4 espacios. Los solapamientos se miden por campo.
//
//   1. Lista del club en CUADRANTE__CAMPOS (cero reglas nuevas), una casilla
//      sin `campo` es del primero (lo cuadrado antes no se mueve).
//   2. Mismos espacios y hora en campos distintos NO chocan; en el mismo, sí.
//   3. El editor ofrece el campo y Aplicar lo guarda (salvo partido fuera).
//   4. Copiar/pegar conserva el campo; la copia viaja en guardar y en enviar.
//   5. La casilla, el PDF, el aviso y la directriz dicen el campo cuando hay
//      más de uno — y con uno solo, todo se lee como antes.
// ════════════════════════════════════════════════════════════════════════
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..');
let fallos = 0, total = 0;
function ok(nombre, cond, detalle) {
    total++;
    if (cond) console.log('  ✓ ' + nombre);
    else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
}
const CQ = fs.readFileSync(path.join(ROOT, 'js/coach/reports/cuadrante-club.js'), 'utf8');

const sb = {
    console: { log() {}, warn() {}, error() {} },
    String, Array, Number, Object, Date, parseInt, parseFloat, isNaN, RegExp, Math, JSON,
    document: { getElementById: () => null, body: { contains: () => false },
                addEventListener: () => {},
                querySelectorAll: () => [], createElement: () => ({ style: {}, addEventListener() {} }) },
    confirm: () => true,
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(CQ + '\n;window.__probe = { _cqCamposTodos, _cqCamposActivos, _cqCampoDe, _cqNombreCampo, ' +
                     '_cqMostrarCampo, _cqRotuloCampo, _cqCopiaCelda, _cqHtmlEspacios, _cqHtmlCelda, ' +
                     '_cqOpcionesCampo, _cqResumenDe, _cqLunes, _cqFechaKey, CQ_DOC_CAMPOS };', sb);
const P = sb.window.__probe;

console.log('\n🏟️  CAMPO / INSTALACIÓN EN EL CUADRANTE (v838)\n' + '─'.repeat(70));

const DOS = [{ id: 'c1', nombre: 'Campo Municipal' }, { id: 'c2', nombre: 'Campo Anexo' }];

// ── 1. La lista y el campo por defecto ───────────────────────────────
console.log('\n1) La lista del club y la casilla sin campo');
{
    sb._cqState.camposClub = null; sb._cqState.doc = null;
    ok('1a · sin nada configurado hay UN campo: «Campo 1»',
       JSON.stringify(P._cqCamposActivos()) === JSON.stringify([{ id: 'c1', nombre: 'Campo 1' }]));
    ok('1b · una casilla anterior a v838 (sin `campo`) es del primero', P._cqCampoDe({ tipo: 'entreno' }) === 'c1');
    ok('1c · con un solo campo NO se nombra (las casillas se leen como antes)',
       P._cqMostrarCampo({ tipo: 'entreno', esp: [1] }) === false && P._cqRotuloCampo({ tipo: 'entreno' }) === '');

    sb._cqState.camposClub = DOS.concat([{ id: 'c3', nombre: 'Pista vieja', baja: true }]);
    ok('1d · con dos activos SÍ se nombra', P._cqMostrarCampo({ tipo: 'entreno' }) === true);
    ok('1e · el retirado no está entre los activos pero conserva su nombre',
       P._cqCamposActivos().length === 2 && P._cqNombreCampo('c3') === 'Pista vieja (retirado)');
    ok('1f · una casilla en un campo retirado NO salta a otro', P._cqCampoDe({ campo: 'c3' }) === 'c3');
    ok('1g · un id desconocido cae en el primero', P._cqCampoDe({ campo: 'zz' }) === 'c1');
    ok('1h · el desplegable ofrece los activos (y el retirado sólo si es el de la casilla)',
       !/Pista vieja/.test(P._cqOpcionesCampo('c1')) && /value="c3" selected/.test(P._cqOpcionesCampo('c3')) &&
       /value="c2" selected/.test(P._cqOpcionesCampo('c2')));
    ok('1i · con lista explícita (panel del entrenador) se usa SÓLO esa',
       P._cqCamposActivos([]).length === 1 && P._cqCamposActivos(DOS).length === 2);
    ok('1j · 🔑 vive en un doc hermano de trainingPlans/weeks (cero reglas nuevas)',
       P.CQ_DOC_CAMPOS === 'CUADRANTE__CAMPOS' &&
       /fs\.doc\(fs\.db, 'trainingPlans', clubId, 'weeks', CQ_DOC_CAMPOS\)/.test(CQ));
    ok('1k · se lee al abrir el cuadrante, junto a las filas del club', /await _cqLeerCamposClub\(clubId\);/.test(CQ));
}

// ── 2. Los choques se miden por campo ───────────────────────────────
console.log('\n2) 🔑 Mismo espacio y hora en campos distintos NO chocan');
{
    const lunes = P._cqLunes(0);
    const f = new Date(lunes); f.setDate(lunes.getDate() + 2);
    const fecha = P._cqFechaKey(f);
    sb._cqState.camposClub = DOS.slice();
    sb._cqState.dia = 2;
    sb._cqState.campoVista = '';
    sb._cqState.doc = {
        espacios: 4,
        filas: [ { id: 'ale', tipo: 'equipo', cat: 'alevin', label: 'Alevín C' },
                 { id: 'fut', tipo: 'equipo', cat: 'futurefem', label: 'FUTureFEM C' },
                 { id: 'reg', tipo: 'equipo', cat: 'regional', label: 'Regional B' } ],
        celdas: {},
    };
    const C = sb._cqState.doc.celdas;
    C['ale|' + fecha] = { tipo: 'entreno', ini: '18:15', fin: '19:15', esp: [3, 4] };              // sin campo → c1
    C['fut|' + fecha] = { tipo: 'entreno', ini: '18:15', fin: '19:15', esp: [3, 4], campo: 'c2' };
    C['reg|' + fecha] = { tipo: 'entreno', ini: '18:15', fin: '19:15', esp: [1, 2], campo: 'c2' };
    let html = P._cqHtmlEspacios(lunes);
    ok('2a · Alevín C (Campo 1) y FUTureFEM C (Campo 2) en 3-4 a la misma hora: SIN conflicto',
       !/conflicto\(s\)/.test(html), (html.match(/Hay <strong>\d+<\/strong>/) || [''])[0]);
    ok('2b · la parrilla ofrece elegir campo, con cuántas actividades tiene cada uno',
       /cqCampoVista\('c1'\)/.test(html) && /cqCampoVista\('c2'\)/.test(html) &&
       /Campo Municipal <span[^>]*>\(1\)/.test(html) && /Campo Anexo <span[^>]*>\(2\)/.test(html));
    ok('2c · la parrilla del Campo 1 no pinta a los del Campo 2',
       /Alevín C/.test(html) && !/FUTureFEM C/.test(html) && !/Regional B/.test(html));

    sb._cqState.campoVista = 'c2';
    html = P._cqHtmlEspacios(lunes);
    ok('2d · en el Campo 2 salen los suyos y no Alevín C',
       /FUTureFEM C/.test(html) && /Regional B/.test(html) && !/Alevín C/.test(html));

    C['ale|' + fecha].campo = 'c2';
    sb._cqState.campoVista = 'c1';
    html = P._cqHtmlEspacios(lunes);
    ok('2e · 🔴 si los dos pasan al MISMO campo, el selector marca ⚠️ ese campo aunque se mire otro',
       /⚠️ Campo Anexo/.test(html) && !/⚠️ Campo Municipal/.test(html));
    sb._cqState.campoVista = 'c2';
    html = P._cqHtmlEspacios(lunes);
    ok('2f · y en su parrilla sale el conflicto, diciendo de qué campo es',
       /Hay <strong>2<\/strong> conflicto\(s\)[^]*del <strong>Campo Anexo<\/strong>/.test(html));

    sb._cqState.camposClub = [{ id: 'c1', nombre: 'Campo 1' }];
    sb._cqState.campoVista = '';
    delete C['ale|' + fecha].campo; delete C['fut|' + fecha].campo; delete C['reg|' + fecha].campo;
    html = P._cqHtmlEspacios(lunes);
    ok('2g · con un solo campo no hay selector y los choques son los de siempre',
       !/cqCampoVista/.test(html) && /Hay <strong>2<\/strong> conflicto/.test(html));
}

// ── 3. El editor y Aplicar ───────────────────────────────────────────
console.log('\n3) El editor de la casilla');
{
    const editor = CQ.slice(CQ.indexOf('window.cqEditarCelda = function'), CQ.indexOf('window.cqTipoCambiado = function'));
    ok('3a · el selector «Campo / instalación» va ENCIMA de los espacios, dentro de su bloque',
       /id="cq-ce-espbloque"[\s\S]*Campo \/ instalación[\s\S]*id="cq-ce-campo"[\s\S]*Espacios del campo que ocupa/.test(editor));
    ok('3b · con la casilla abierta en su campo', /_cqOpcionesCampo\(_cqCampoDe\(c\)\)/.test(editor));
    ok('3c · y los nombres se gestionan sin salir del editor',
       /cqGestorCamposEnEditor\(\)/.test(editor) && /id="cq-ce-campos-gestor"/.test(editor));
    ok('3d · un partido fuera apaga también el selector de campo',
       /selCampo\.disabled = juegaFuera/.test(CQ));
    ok('3e · Aplicar guarda el campo, salvo en un partido fuera',
       /const campo = g\('cq-ce-campo'\);\s*if \(metaT\.ocupa !== false && campo\) celda\.campo = campo;/.test(CQ));
    ok('3f · el gestor exige nombre, sin repetir, y al menos un campo',
       /Ponle nombre a todos los campos/.test(CQ) && /Hay dos campos llamados/.test(CQ) &&
       /Tiene que quedar al menos un campo/.test(CQ));
    ok('3g · ⚠️ quitar un campo lo marca `baja`, no lo borra', /x\.baja = true;/.test(CQ));
    ok('3h · hay un botón 🏟️ CAMPOS en la barra del cuadrante', /onclick="cqAbrirCampos\(\)"/.test(CQ));
}

// ── 4. Copiar, pegar, guardar, enviar ───────────────────────────────
console.log('\n4) El campo viaja con la casilla');
{
    const copia = P._cqCopiaCelda({ tipo: 'entreno', ini: '18:00', fin: '19:00', esp: [1], campo: 'c2', txt: '', nota: '' });
    ok('4a · la copia conserva el campo', copia.campo === 'c2' && copia.esp[0] === 1);
    ok('4b · sin campo no inventa la clave (Firestore no admite undefined)',
       !('campo' in P._cqCopiaCelda({ tipo: 'entreno', esp: [] })));
    ok('4c · los CINCO pegados usan la misma copia (no queda ninguno enumerando a mano)',
       (CQ.match(/_cqCopiaCelda\(/g) || []).length >= 6 && !/esp: \(c\.esp \|\| \[\]\)\.slice\(\), txt: c\.txt, nota: c\.nota \}\s*\}\);/.test(CQ) &&
       (CQ.match(/esp: \((c|d)\.esp \|\| \[\]\)\.slice\(\)/g) || []).length === 1);
    ok('4d · guardar la semana lleva la copia de los campos', /campos:   _cqCamposTodos\(\),\n\s*\/\/ 🔑 v734/.test(CQ));
    ok('4e · enviar también (el entrenador no lee el doc del club)',
       /campos:   _cqCamposTodos\(\),\n\s*publicadoEn:  st\.doc\.publicadoEn/.test(CQ));
    ok('4f · lo publicado y el cambio en vivo conservan `campos`',
       /campos:   Array\.isArray\(p\.campos\)/.test(CQ) && /campos: Array\.isArray\(d\.campos\) \? d\.campos : \[\],\n\s*publicadoEn/.test(CQ));
}

// ── 5. Lo que se lee en cada sitio ──────────────────────────────────
console.log('\n5) La casilla, el aviso y la directriz dicen el campo');
{
    const lunes = P._cqLunes(0);
    const fecha = P._cqFechaKey(lunes);
    sb._cqState.camposClub = DOS.slice();
    sb._cqState.portapapeles = null;
    const celda = { tipo: 'entreno', ini: '18:00', fin: '19:00', esp: [1, 2], campo: 'c2' };
    const h = P._cqHtmlCelda('ale', fecha, celda);
    ok('5a · la casilla dice el campo y sus espacios', /🏟️ Campo Anexo/.test(h) && /1·2/.test(h));
    const fuera = P._cqHtmlCelda('ale', fecha, { tipo: 'partido_fuera', ini: '12:00', esp: [] });
    ok('5b · un partido fuera no lleva campo', !/Campo Anexo|Campo Municipal/.test(fuera));

    sb._cqState.doc = { espacios: 4, filas: [{ id: 'ale', label: 'Alevín C', tipo: 'equipo' }], celdas: {} };
    sb._cqState.doc.celdas['ale|' + fecha] = celda;
    ok('5c · el aviso al entrenador nombra el campo', /Campo Anexo · espacio 1 y 2/.test(P._cqResumenDe(['ale'], lunes)));

    sb._cqState.camposClub = [{ id: 'c1', nombre: 'Campo 1' }];
    const h1 = P._cqHtmlCelda('ale', fecha, { tipo: 'entreno', ini: '18:00', fin: '19:00', esp: [1, 2] });
    ok('5d · con un solo campo la casilla es la de siempre', !/Campo 1/.test(h1) && /🏟️ 1·2/.test(h1));

    ok('5e · la directriz del entrenador resuelve el nombre con la copia publicada',
       /campoNombre:  \(espEf\.length && camposPub\.length\) \? _cqRotuloCampo\(c, camposPub\) : ''/.test(CQ) &&
       /d\.campoNombre \? d\.campoNombre \+ ' · '/.test(CQ));
    ok('5f · el PDF del Ayuntamiento nombra campo e instalaciones',
       /const campo = espL\.length \? _cqRotuloCampo\(c\) : '';/.test(CQ) && /Instalaciones: <strong>/.test(CQ));
}

console.log('\n' + '─'.repeat(70));
console.log('Resultado: ' + (total - fallos) + '/' + total);
if (fallos) { console.log('❌ ' + fallos + ' fallo(s)'); process.exit(1); }
console.log('✅ Cada actividad tiene su campo, y sólo chocan los del mismo campo');
