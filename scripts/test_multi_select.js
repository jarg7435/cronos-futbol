// ══════════════════════════════════════════════════════════════════════
//  test_multi_select.js  ·  el motor de selección múltiple (v669)
//
//  🔑 CARGA Y EJECUTA EL MÓDULO DE VERDAD sobre un DOM de juguete. Una
//  regex sobre el fuente no distingue "el botón está deshabilitado" de "la
//  acción no se ejecuta", y aquí eso es justo lo que importa: `disabled` es
//  cosmético en este proyecto desde v548, así que hay que COMPROBAR que
//  lanzar() con cero marcados no llama a `ejecutar`.
//
//  PARTE 6 es un censo estructural sobre los seis listados cableados: que
//  el grupo con el que se REGISTRA sea el mismo con el que se pintan las
//  casillas. Un desajuste ahí no da ningún error — simplemente las casillas
//  no las cuenta nadie y el botón nunca se enciende.
// ══════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(n, cond, extra) {
    if (cond) { pass++; console.log('  PASS ' + n); }
    else { fail++; console.log('  FAIL ' + n + (extra !== undefined ? '\n       ' + JSON.stringify(extra) : '')); }
}

// ── DOM de juguete: lo justo que el módulo toca ───────────────────────
function nuevoDom() {
    const porId = Object.create(null);
    const casillas = [];          // {clase, dataset:{k}, checked, indeterminate}

    const crear = (props) => Object.assign({
        checked: false, indeterminate: false, disabled: false,
        textContent: '', innerHTML: '', style: {}, dataset: {},
    }, props);

    return {
        porId, casillas, crear,
        document: {
            getElementById: (id) => porId[id] || null,
            querySelectorAll: (sel) => {
                const m = /^\.cms-chk-([A-Za-z0-9_-]+)$/.exec(sel);
                if (!m) return [];
                return casillas.filter(c => c.grupo === m[1]);
            },
        },
    };
}

function cargar(dom, extras) {
    const ctx = {
        window: {}, console,
        document: dom.document,
        confirm: (extras && extras.confirm) || (() => true),
        prompt: (extras && extras.prompt) || (() => 'BORRAR'),
        showToast: (extras && extras.showToast) || (() => {}),
        showSpinner: (extras && extras.showSpinner) || (() => {}),
        hideSpinner: () => {},
    };
    ctx.window = ctx;          // el módulo escribe en window.* y lee window.confirm
    ctx.window.document = dom.document;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/shared/multi-select.js'), 'utf8'), ctx);
    return ctx;
}

// Monta N casillas de un grupo + los elementos de la barra que sync() toca.
function montarGrupo(dom, grupo, n, acciones) {
    for (let i = 0; i < n; i++) {
        dom.casillas.push(dom.crear({ grupo, dataset: { k: 'k' + i } }));
    }
    dom.porId['cms-cnt-' + grupo] = dom.crear({});
    dom.porId['cms-all-' + grupo] = dom.crear({});
    dom.porId['cms-alltxt-' + grupo] = dom.crear({});
    (acciones || []).forEach((_, i) => {
        dom.porId['cms-btn-' + grupo + '-' + i] = dom.crear({});
        dom.porId['cms-lbl-' + grupo + '-' + i] = dom.crear({});
    });
}

console.log('\n── PARTE 1 · el módulo se declara y no borra nada ──');
{
    const dom = nuevoDom();
    const ctx = cargar(dom);
    ok('1a · expone window.cronosMS', typeof ctx.window.cronosMS === 'object');
    const api = ['registrar', 'chk', 'barra', 'claves', 'sync', 'todos', 'limpiar', 'lanzar', 'enTandas'];
    ok('1b · con la API completa',
        api.every(k => typeof ctx.window.cronosMS[k] === 'function'),
        api.filter(k => typeof ctx.window.cronosMS[k] !== 'function'));

    // 🔑🔑 LA REGLA DE ORO DEL MÓDULO: no sabe borrar. El borrado lo pone
    // cada listado, porque las claves de ocultación difieren entre pantallas
    // (uid vs uid_rol) y unificarlas haría reaparecer informes sin error.
    const src = fs.readFileSync(path.join(ROOT, 'js/shared/multi-select.js'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    ok('1c · 🔑 NO escribe en Firestore: ni deleteDoc, ni updateDoc, ni arrayUnion',
        !/\bdeleteDoc\b/.test(src) && !/\bupdateDoc\b/.test(src) && !/\barrayUnion\b/.test(src));
    ok('1d · ni siquiera importa el SDK', !/firebasejs/.test(src) && !/_cFS\b/.test(src));
}

console.log('\n── PARTE 2 · marcado: casilla y barra ──');
{
    const dom = nuevoDom();
    const ctx = cargar(dom);
    const MS = ctx.window.cronosMS;
    MS.registrar('g1', [{ id: 'x', etiqueta: 'Eliminar seleccionados', ejecutar: async () => ({}) }]);

    const chk = MS.chk('g1', 'abc');
    ok('2a · la casilla lleva la clase del grupo', /class="cms-chk cms-chk-g1"/.test(chk), chk);
    ok('2b · y la clave en data-k', /data-k="abc"/.test(chk));
    // ⚠️ Sin stopPropagation, marcar una casilla dispararía el onclick de la
    //    tarjeta que la contiene (desplegar el informe, abrir el hilo…).
    ok('2c · 🔑 detiene la propagación del click', /event\.stopPropagation\(\)/.test(chk));

    const barra = MS.barra('g1');
    ok('2d · la barra trae el "seleccionar todos"', /id="cms-all-g1"/.test(barra));
    ok('2e · el contador', /id="cms-cnt-g1"/.test(barra));
    ok('2f · y el botón de la acción, deshabilitado de salida',
        /id="cms-btn-g1-0"/.test(barra) && /disabled/.test(barra));

    ok('2g · ⚠️ un nombre de grupo con comillas se rechaza (partiría el HTML)',
        MS.registrar('g"1', []) === false && MS.chk('g"1', 'x') === '' && MS.barra('g"1') === '');
}

console.log('\n── PARTE 3 · contar, marcar todos, estado intermedio ──');
{
    const dom = nuevoDom();
    const ctx = cargar(dom);
    const MS = ctx.window.cronosMS;
    const accs = [{ id: 'x', etiqueta: 'Eliminar seleccionados', ejecutar: async () => ({}) }];
    MS.registrar('g2', accs);
    montarGrupo(dom, 'g2', 3, accs);

    ok('3a · sin nada marcado, el contador lo dice',
        MS.sync('g2') === 0 && dom.porId['cms-cnt-g2'].textContent === 'Ninguno seleccionado');
    ok('3b · y el botón sale apagado', dom.porId['cms-btn-g2-0'].disabled === true);

    dom.casillas[0].checked = true;
    MS.sync('g2');
    // El singular concuerda con el 1, no con el 3: "1 de 3 seleccionado".
    ok('3c · con uno marcado cuenta "1 de 3", en singular',
        dom.porId['cms-cnt-g2'].textContent === '1 de 3 seleccionado',
        dom.porId['cms-cnt-g2'].textContent);
    dom.casillas[1].checked = true;
    MS.sync('g2');
    ok('3c2 · y con dos, en plural',
        dom.porId['cms-cnt-g2'].textContent === '2 de 3 seleccionados',
        dom.porId['cms-cnt-g2'].textContent);
    dom.casillas[1].checked = false;
    MS.sync('g2');
    ok('3d · 🔑 la maestra queda INDETERMINADA, que no es lo mismo que marcada',
        dom.porId['cms-all-g2'].indeterminate === true && dom.porId['cms-all-g2'].checked === false);
    ok('3e · el botón se enciende y lleva el número',
        dom.porId['cms-btn-g2-0'].disabled === false &&
        dom.porId['cms-lbl-g2-0'].textContent === 'Eliminar seleccionados (1)',
        dom.porId['cms-lbl-g2-0'].textContent);

    MS.todos('g2', true);
    ok('3f · "todos" marca las tres', MS.claves('g2').length === 3);
    ok('3g · la maestra pasa a marcada y deja de estar indeterminada',
        dom.porId['cms-all-g2'].checked === true && dom.porId['cms-all-g2'].indeterminate === false);
    ok('3h · y el rótulo se ofrece a deseleccionar',
        dom.porId['cms-alltxt-g2'].textContent === 'Deseleccionar todos');

    // ⚠️ Sólo lo PINTADO. Una casilla de otro grupo no entra ni por asomo.
    dom.casillas.push(dom.crear({ grupo: 'otro', dataset: { k: 'z' } }));
    MS.todos('g2', true);
    ok('3i · 🔑 "todos" no toca las casillas de otro grupo',
        dom.casillas.find(c => c.grupo === 'otro').checked === false);

    MS.limpiar('g2');
    ok('3j · limpiar desmarca todo', MS.claves('g2').length === 0);
}

console.log('\n── PARTE 4 · lanzar: la guarda real, el confirm y el resumen ──');
(async () => {
    {
        const dom = nuevoDom();
        let ejecutada = 0;
        const accs = [{ id: 'x', etiqueta: 'Borrar', ejecutar: async () => { ejecutada++; return {}; } }];
        const ctx = cargar(dom);
        ctx.window.cronosMS.registrar('g3', accs);
        montarGrupo(dom, 'g3', 2, accs);

        // 🔑🔑 EL BOTÓN SE PUEDE FORZAR: `disabled` es cosmético (v548). La
        //     guarda de verdad vive dentro de lanzar().
        dom.porId['cms-btn-g3-0'].disabled = false;
        await ctx.window.cronosMS.lanzar('g3', 0);
        ok('4a · 🔑 con CERO marcados NO se ejecuta, aunque el botón esté habilitado',
            ejecutada === 0, { ejecutada });

        dom.casillas[0].checked = true;
        await ctx.window.cronosMS.lanzar('g3', 0);
        ok('4b · con uno marcado sí se ejecuta', ejecutada === 1);
    }
    {
        // El listado aborta devolviendo null: ni confirm ni ejecución.
        const dom = nuevoDom();
        let ejecutada = 0, confirms = 0;
        const accs = [{ id: 'x', etiqueta: 'B', confirmar: () => null,
                        ejecutar: async () => { ejecutada++; return {}; } }];
        const ctx = cargar(dom, { confirm: () => { confirms++; return true; } });
        ctx.window.cronosMS.registrar('g4', accs);
        montarGrupo(dom, 'g4', 1, accs);
        dom.casillas[0].checked = true;
        await ctx.window.cronosMS.lanzar('g4', 0);
        ok('4c · confirmar()=null aborta sin abrir ninguna ventana',
            ejecutada === 0 && confirms === 0, { ejecutada, confirms });
    }
    {
        // confirmar()=true: el listado ya preguntó a su manera (el ritual de
        // teclear BORRAR). El motor NO puede encadenar otra ventana.
        const dom = nuevoDom();
        let ejecutada = 0, confirms = 0;
        const accs = [{ id: 'x', etiqueta: 'B', confirmar: () => true,
                        ejecutar: async () => { ejecutada++; return {}; } }];
        const ctx = cargar(dom, { confirm: () => { confirms++; return true; } });
        ctx.window.cronosMS.registrar('g5', accs);
        montarGrupo(dom, 'g5', 1, accs);
        dom.casillas[0].checked = true;
        await ctx.window.cronosMS.lanzar('g5', 0);
        ok('4d · 🔑 confirmar()=true ejecuta SIN volver a preguntar',
            ejecutada === 1 && confirms === 0, { ejecutada, confirms });
    }
    {
        // Un texto se muestra en confirm(); si el usuario dice que no, nada.
        const dom = nuevoDom();
        let ejecutada = 0; let visto = '';
        const accs = [{ id: 'x', etiqueta: 'B', confirmar: (ks) => 'Van ' + ks.length,
                        ejecutar: async () => { ejecutada++; return {}; } }];
        const ctx = cargar(dom, { confirm: (t) => { visto = t; return false; } });
        ctx.window.cronosMS.registrar('g6', accs);
        montarGrupo(dom, 'g6', 2, accs);
        dom.casillas[0].checked = true; dom.casillas[1].checked = true;
        await ctx.window.cronosMS.lanzar('g6', 0);
        ok('4e · el texto del listado llega al confirm con el nº real', visto === 'Van 2', visto);
        ok('4f · y si se cancela, no se ejecuta', ejecutada === 0);
    }
    {
        // ⚠️ EL RESUMEN LO DA QUIEN EJECUTA. El motor no puede inventar un
        //    "N borrados" contando lo seleccionado: fallaría en cuanto uno
        //    fuese denegado por permisos.
        const dom = nuevoDom();
        const toasts = [];
        const accs = [{ id: 'x', etiqueta: 'B',
                        ejecutar: async () => ({ ok: 1, fallos: 2, resumen: '1 sí, 2 no' }) }];
        const ctx = cargar(dom, { showToast: (m) => toasts.push(m) });
        ctx.window.cronosMS.registrar('g7', accs);
        montarGrupo(dom, 'g7', 3, accs);
        dom.casillas.forEach(c => { c.checked = true; });
        await ctx.window.cronosMS.lanzar('g7', 0);
        ok('4g · 🔑 el aviso final es el del listado, no un recuento inventado',
            toasts.includes('1 sí, 2 no'), toasts);
    }
    {
        // Un fallo dentro de ejecutar no puede dejar el spinner colgado.
        const dom = nuevoDom();
        const toasts = []; let oculto = 0;
        const accs = [{ id: 'x', etiqueta: 'B', ejecutar: async () => { throw new Error('boom'); } }];
        const ctx = cargar(dom, { showToast: (m) => toasts.push(m) });
        ctx.hideSpinner = () => { oculto++; };
        ctx.window.cronosMS.registrar('g8', accs);
        montarGrupo(dom, 'g8', 1, accs);
        dom.casillas[0].checked = true;
        await ctx.window.cronosMS.lanzar('g8', 0);
        ok('4h · si ejecutar revienta, se avisa y se cierra el spinner',
            oculto > 0 && toasts.some(t => /boom/.test(t)), { oculto, toasts });
    }

    console.log('\n── PARTE 5 · enTandas ──');
    {
        const dom = nuevoDom();
        const ctx = cargar(dom);
        const vistos = [], avances = [];
        const r = await ctx.window.cronosMS.enTandas([1, 2, 3, 4, 5], 2,
            async (x) => { vistos.push(x); return x * 2; },
            (hechos, total) => avances.push(hechos + '/' + total));
        ok('5a · los procesa todos y devuelve sus resultados',
            JSON.stringify(r) === JSON.stringify([2, 4, 6, 8, 10]), r);
        ok('5b · en tandas del tamaño pedido, informando del avance',
            JSON.stringify(avances) === JSON.stringify(['2/5', '4/5', '5/5']), avances);
        // Un tamaño de tanda absurdo no puede colgar el bucle.
        const r0 = await ctx.window.cronosMS.enTandas([1, 2], 0, async (x) => x);
        ok('5c · ⚠️ tamaño 0 no cuelga: se trata como 1',
            JSON.stringify(r0) === JSON.stringify([1, 2]), r0);
    }

    console.log('\n── PARTE 6 · censo: los seis listados cableados ──');
    {
        // 🔑 QUE EL GRUPO CON EL QUE SE REGISTRA SEA EL MISMO CON EL QUE SE
        //    PINTAN LAS CASILLAS. Si no coinciden, no salta ningún error:
        //    simplemente nadie cuenta esas casillas y el botón no se enciende
        //    nunca. Es el fallo silencioso que este censo existe para cazar.
        const listados = {
            'js/coach/comms/individual-reports.js':   'misinf',
            'js/coach/reports/reports-tab.js':        'sdinf',
            'js/coach/reports/finished-matches-tab.js': 'fmatch',
            'js/coach/reports/events-tab.js':         'sdavisos',
            'js/coach/comms/panel.js':                'ummsg',
        };
        for (const [rel, grupo] of Object.entries(listados)) {
            const txt = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            const reg = new RegExp("cronosMS\\.registrar\\('" + grupo + "'").test(txt);
            const chk = new RegExp("cronosMS\\.chk\\('" + grupo + "'").test(txt);
            const bar = new RegExp("cronosMS\\.barra\\('" + grupo + "'").test(txt);
            ok('6 · ' + rel.split('/').pop() + ' registra, pinta y muestra el grupo "' + grupo + '"',
                reg && chk && bar, { reg, chk, bar });
        }
        // Contactos usa dos grupos y pasa por helpers propios.
        const cm = fs.readFileSync(path.join(ROOT, 'js/coach/comms/contact-manager.js'), 'utf8');
        ok('6 · contact-manager.js cablea sus dos tablas',
            /_cmChk\('ctstaff'/.test(cm) && /_cmBarra\('ctstaff'\)/.test(cm) &&
            /_cmChk\('ctfam'/.test(cm)   && /_cmBarra\('ctfam'\)/.test(cm));
    }

    console.log('\n── PARTE 7 · registrado en los tres sitios ──');
    {
        const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        const sw  = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
        const chk = fs.readFileSync(path.join(ROOT, 'scripts/_check_syntax.js'), 'utf8');
        ok('7a · <script> en index.html', /src="js\/shared\/multi-select\.js/.test(idx));
        ok('7b · en el precache de sw.js', /'\.\/js\/shared\/multi-select\.js'/.test(sw));
        ok('7c · en la cobertura declarada de _check_syntax.js',
            /'js\/shared\/multi-select\.js'/.test(chk));
    }

    console.log('\n────────────────────────────────────────────');
    console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌ ' + fail + ' FALLOS' : '  ✅'));
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR FATAL:', e); process.exit(1); });
