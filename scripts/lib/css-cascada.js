// ═══════════════════════════════════════════════════════════════════════════
// LIB · Resolutor de cascada CSS para los guards (v692)
// ═══════════════════════════════════════════════════════════════════════════
// Nació dentro de test_fichas_f11_compactas.js (v691) y se saca aquí al
// necesitarlo el segundo guard. 🔑 El motivo de extraerlo y no copiarlo es el
// patrón que este proyecto ya ha pagado varias veces (tres renderizadores del
// plan semanal, el panel de familias divergido del motor de informes...): dos
// copias de la misma lógica divergen, y entonces un guard mide una cosa y el
// otro, otra.
//
// QUÉ RESUELVE: dada una hoja, una propiedad, un elemento simulado y un
// viewport, devuelve el valor GANADOR aplicando media query + `!important` +
// especificidad + orden. Sirve para preguntarle a la hoja "¿qué mide esto en
// un iPad?" sin abrir un navegador, que es justo lo que un `grep` no puede
// contestar cuando hay cuatro reglas peleando por la misma propiedad.
//
// ⚠️ EL MODELO DE DOM ES DELIBERADAMENTE ESTRECHO: una cadena de ancestros y
// un elemento objetivo, sin hermanos. Por eso los selectores con combinadores
// (`>`, `+`, `~`), con pseudoelementos (`::after`) o con atributos se declaran
// NO COINCIDENTES en vez de adivinarse. Si algún día hace falta medir uno de
// esos, hay que ampliar el motor — no confiar en lo que devuelva hoy.
'use strict';

// ── Parseo ──────────────────────────────────────────────────────────────────
// Aplana los @media anidados y devuelve una declaración por entrada, con el
// orden de aparición (que es el desempate final de la cascada).
function parsearCSS(texto) {
    const limpio = texto.replace(/\/\*[\s\S]*?\*\//g, '');
    const reglas = [];
    let orden = 0;

    function recorrer(fragmento, media) {
        const re = /([^{}]+)\{/g;
        let m;
        while ((m = re.exec(fragmento)) !== null) {
            const cabecera = m[1].trim();
            // Emparejar llaves para quedarse con el bloque completo.
            let prof = 1, i = re.lastIndex;
            while (i < fragmento.length && prof > 0) {
                if (fragmento[i] === '{') prof++;
                else if (fragmento[i] === '}') prof--;
                i++;
            }
            const cuerpo = fragmento.slice(re.lastIndex, i - 1);
            re.lastIndex = i;

            if (cabecera.startsWith('@media')) {
                recorrer(cuerpo, media ? media + ' and ' + cabecera : cabecera);
            } else if (cabecera.startsWith('@')) {
                // @keyframes, @font-face…: no participan en esta cascada.
            } else {
                cabecera.split(',').forEach(sel => {
                    sel = sel.trim();
                    if (!sel) return;
                    cuerpo.split(';').forEach(decl => {
                        const p = decl.indexOf(':');
                        if (p === -1) return;
                        const prop = decl.slice(0, p).trim().toLowerCase();
                        let val = decl.slice(p + 1).trim();
                        if (!prop || !val) return;
                        const bang = /!important$/i.test(val);
                        val = val.replace(/!important$/i, '').trim();
                        reglas.push({ media, sel, prop, val, bang, orden: orden++ });
                    });
                });
            }
        }
    }
    recorrer(limpio, null);
    return reglas;
}

// Saca el CSS embebido de un HTML (live.html lleva la hoja dentro).
function extraerStyle(html) {
    return [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
        .map(m => m[1]).join('\n');
}

// ── Especificidad ───────────────────────────────────────────────────────────
function especificidad(sel) {
    const sinNot = sel.replace(/:not\([^)]*\)/g, '');
    const ids    = (sinNot.match(/#[\w-]+/g) || []).length;
    const clases = (sinNot.match(/\.[\w-]+/g) || []).length +
                   (sinNot.match(/\[[^\]]+\]/g) || []).length +
                   (sinNot.match(/:(?!not\()[\w-]+/g) || []).length;
    // `:not()` no puntúa por sí mismo, pero su contenido sí.
    const dentroNot = (sel.match(/:not\(([^)]*)\)/g) || [])
        .map(x => x.replace(/^:not\(|\)$/g, ''))
        .reduce((acc, x) => ({
            ids:    acc.ids    + (x.match(/#[\w-]+/g) || []).length,
            clases: acc.clases + (x.match(/\.[\w-]+/g) || []).length
        }), { ids: 0, clases: 0 });
    const tipos = (sinNot.replace(/[.#:\[][^\s>+~]*/g, ' ').match(/\b[a-z][\w-]*\b/gi) || []).length;
    return [ids + dentroNot.ids, clases + dentroNot.clases, tipos];
}

function ganaEspecificidad(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

// ── Media queries ───────────────────────────────────────────────────────────
function mediaAplica(media, vp) {
    if (!media) return true;
    const cond = media.replace(/@media/g, '').trim();
    let aplica = true;
    [...cond.matchAll(/max-width\s*:\s*(\d+)px/g)].forEach(m  => { if (!(vp.ancho <= +m[1])) aplica = false; });
    [...cond.matchAll(/min-width\s*:\s*(\d+)px/g)].forEach(m  => { if (!(vp.ancho >= +m[1])) aplica = false; });
    [...cond.matchAll(/max-height\s*:\s*(\d+)px/g)].forEach(m => { if (!(vp.alto  <= +m[1])) aplica = false; });
    [...cond.matchAll(/min-height\s*:\s*(\d+)px/g)].forEach(m => { if (!(vp.alto  >= +m[1])) aplica = false; });
    if (/orientation\s*:\s*landscape/.test(cond) && !(vp.ancho >  vp.alto)) aplica = false;
    if (/orientation\s*:\s*portrait/.test(cond)  && !(vp.ancho <= vp.alto)) aplica = false;
    if (/pointer\s*:\s*coarse/.test(cond) && !vp.tactil) aplica = false;
    if (/pointer\s*:\s*fine/.test(cond)   &&  vp.tactil) aplica = false;
    return aplica;
}

// ── Coincidencia de selector ────────────────────────────────────────────────
// `el` = { tag, id, clases, ancestros: [...del más lejano al más cercano] }
function describe(parte, obj) {
    if (parte === '*') return true;
    if (/::/.test(parte)) return false;                 // pseudoelemento: fuera del modelo
    const nots   = [...parte.matchAll(/:not\(([^)]*)\)/g)].map(m => m[1]);
    const limpio = parte.replace(/:not\([^)]*\)/g, '');
    if (/[\[:]/.test(limpio)) return false;             // atributos y pseudoclases: fuera del modelo

    const id     = (limpio.match(/#([\w-]+)/) || [null, null])[1];
    const clases = (limpio.match(/\.[\w-]+/g) || []).map(c => c.slice(1));
    const tipo   = (limpio.match(/^[a-z][\w-]*/i) || [null])[0];

    if (tipo && tipo !== obj.tag) return false;
    if (id && id !== obj.id) return false;
    if (!clases.every(c => (obj.clases || []).includes(c))) return false;
    return nots.every(n => {
        const cn = (n.match(/\.[\w-]+/g) || []).map(c => c.slice(1));
        const nid = (n.match(/#([\w-]+)/) || [null, null])[1];
        const coincide = cn.every(c => (obj.clases || []).includes(c)) && (!nid || nid === obj.id);
        return !coincide;
    });
}

function casaSelector(sel, el) {
    if (/::|,/.test(sel)) return false;
    const partes = sel.trim().split(/\s+/);
    if (partes.some(p => p === '>' || p === '+' || p === '~')) return false; // combinadores: fuera del modelo
    if (!describe(partes[partes.length - 1], el)) return false;

    // Los ancestros del selector deben aparecer EN ORDEN en la cadena real.
    const cadena = (el.ancestros || []).slice();
    let idx = cadena.length - 1;
    for (let i = partes.length - 2; i >= 0; i--) {
        let encontrado = false;
        while (idx >= 0) {
            if (describe(partes[i], cadena[idx])) { encontrado = true; idx--; break; }
            idx--;
        }
        if (!encontrado) return false;
    }
    return true;
}

// ── Resolución ──────────────────────────────────────────────────────────────
function resolver(reglas, prop, el, vp) {
    let mejor = null;
    for (const r of reglas) {
        if (r.prop !== prop) continue;
        if (!mediaAplica(r.media, vp)) continue;
        if (!casaSelector(r.sel, el)) continue;
        if (!mejor) { mejor = r; continue; }
        if (r.bang !== mejor.bang) { if (r.bang) mejor = r; continue; }
        const eR = especificidad(r.sel), eM = especificidad(mejor.sel);
        if (ganaEspecificidad(eR, eM)) { mejor = r; continue; }
        if (!ganaEspecificidad(eM, eR) && r.orden > mejor.orden) mejor = r;
    }
    return mejor ? mejor.val : null;
}

module.exports = {
    parsearCSS, extraerStyle, especificidad, ganaEspecificidad,
    mediaAplica, casaSelector, resolver
};
