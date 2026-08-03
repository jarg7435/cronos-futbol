// ─────────────────────────────────────────────────────────────────────────
// test_parent_table_columns.js  ·  las 10 columnas de "Padres / Tutores"
//
// Peticion del autor (2026-08-03): la tabla de Padres/Tutores del modal de
// Gestion de Contactos debe tener EXACTAMENTE estas columnas, en este orden:
//   1 FAMILIAR · 2 CODIGO JUGADOR · 3 WHATSAPP · 4 EMAIL · 5 CONV ·
//   6 ENTR · 7 MSJ · 8 ENVIAR · 9 INF · 10 EN VIVO   (+ la de acciones)
// Y cada familiar tiene que quedar correctamente vinculado a su jugador.
//
// EL DEFECTO REAL QUE ESTO ARREGLA, y que es la razon de ser del guard:
// la fila del padre VINCULADO traia 12 celdas contra 11 cabeceras (llevaba el
// dorsal Y el codigo de invitacion en dos celdas, con una sola cabecera para
// las dos). Desde la 3a columna en adelante, cada palomilla del padre
// vinculado quedaba pintada bajo el rotulo de la ANTERIOR: el entrenador creia
// estar marcando MSJ. y marcaba ENTR.
//
// ⚠️ POR QUE NUNCA DIO UN ERROR NI LO CAZO NINGUN TEST: el guardado
// (saveContactManagerData) busca cada casilla por su CLASE
// (.contact-msg[data-linkid=...]), no por su posicion en la fila. Asi que los
// datos SIEMPRE se guardaron bien; lo unico equivocado era el rotulo que veia
// el entrenador. Un descuadre de tabla es invisible para cualquier assert de
// comportamiento: hay que CONTAR las celdas.
//
// ⚠️ LAS TRES FORMAS DE FILA TIENEN QUE CAMBIAR A LA VEZ. La cabecera, la fila
// del padre vinculado y la del padre manual comparten el MISMO <tbody>
// (renderParentRowMarkup se concatena detras de los vinculados), asi que basta
// tocar una para desalinear las otras dos.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + extra); }
};

const SRC = fs.readFileSync(path.join(ROOT, 'js', 'coach', 'comms', 'contact-manager.js'), 'utf8');

console.log('── tabla "Padres / Tutores": 10 columnas ──\n');

// ═══════ Recorte de las tres formas de fila ═══════
// La cabecera de la tabla de padres es la que precede al tbody de padres.
const iTbody   = SRC.indexOf('tbody-parent-contacts');
const iCab     = SRC.lastIndexOf('<tr style="color:var(--text-muted)', iTbody);
const cabecera = SRC.slice(iCab, SRC.indexOf('</thead>', iCab));

const iVinc    = SRC.indexOf('parent-contact-row firestore-linked');
const filaVinc = SRC.slice(iVinc, SRC.indexOf('</tr>', iVinc));

const iMan     = SRC.indexOf('function renderParentRowMarkup');
const filaMan  = SRC.slice(iMan, SRC.indexOf('</tr>`;', iMan));

const cuenta = (frag, tag) => (frag.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
const textoTh = (cabecera.match(/<th[^>]*>([\s\S]*?)<\/th>/g) || [])
    .map(t => t.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());

// ═══════════ PARTE 1 · las columnas pedidas, en orden ═══════════
console.log('── PARTE 1 · la cabecera ──');
{
    const ESPERADAS = ['FAMILIAR', 'CODIGO JUGADOR', 'WHATSAPP', 'EMAIL',
                       'CONV.', 'ENTR.', 'MSJ.', 'ENVIAR ✍️', 'INF.', 'EN VIVO 📡'];
    ESPERADAS.forEach((esp, i) => {
        ok('1.' + (i + 1) + ' · columna ' + (i + 1) + ' es "' + esp + '"',
           textoTh[i] === esp, 'encontrada: "' + (textoTh[i] || '(nada)') + '"');
    });
    ok('1z · y solo hay una columna mas, la de acciones (sin titulo)',
       textoTh.length === 11 && textoTh[10] === '',
       'cabeceras: ' + JSON.stringify(textoTh));
}

// ═══════════ PARTE 2 · EL RECUENTO (el defecto que nadie veia) ═══════════
console.log('\n── PARTE 2 · las tres formas de fila cuadran ──');
{
    const nTh   = cuenta(cabecera, 'th');
    const nVinc = cuenta(filaVinc, 'td');
    const nMan  = cuenta(filaMan,  'td');

    ok('2a · la cabecera declara 11 columnas (10 + acciones)', nTh === 11, 'th=' + nTh);
    ok('2b · [EL DEFECTO] la fila del padre VINCULADO tiene esas mismas 11',
       nVinc === nTh, 'th=' + nTh + ' vs td=' + nVinc + ' — las palomillas salen bajo el rotulo equivocado');
    ok('2c · y la del padre MANUAL tambien',
       nMan === nTh, 'th=' + nTh + ' vs td=' + nMan + ' — comparten el mismo tbody');
}

// ═══════════ PARTE 3 · cada celda, en su columna ═══════════
console.log('\n── PARTE 3 · el orden real de los controles ──');
{
    // Se extrae la clase de control de cada celda, en orden de aparicion.
    const clasesEn = (frag, prefijo) => {
        const out = [];
        const re = new RegExp('class="(' + prefijo + '[a-z-]*)"', 'g');
        let m;
        while ((m = re.exec(frag)) !== null) out.push(m[1]);
        return out;
    };

    const vinc = clasesEn(filaVinc, 'contact-');
    ok('3a · vinculado · el orden de controles es el pedido',
       JSON.stringify(vinc) === JSON.stringify([
           'contact-parent-name', 'contact-phone', 'contact-parent-email',
           'contact-cv', 'contact-tr', 'contact-msg', 'contact-cansend',
           'contact-rpt', 'contact-live']),
       JSON.stringify(vinc));

    const man = clasesEn(filaMan, 'p-');
    ok('3b · manual · el orden de controles es el mismo',
       JSON.stringify(man) === JSON.stringify([
           'p-name', 'p-player', 'p-phone', 'p-email',
           'p-cv', 'p-tr', 'p-msg', 'p-rpt', 'p-live']),
       JSON.stringify(man));

    // El manual no tiene casilla de ENVIAR (no tiene cuenta en la app), pero
    // SI tiene que ocupar su hueco o descuadra la tabla entera.
    ok('3c · el manual reserva el hueco de ENVIAR aunque no le aplique',
       /Solo aplica a padres vinculados/.test(filaMan),
       'sin esa celda, la tabla se desalinea de ENVIAR en adelante');
}

// ═══════════ PARTE 4 · el vinculo familiar ↔ jugador ═══════════
console.log('\n── PARTE 4 · cada familiar, con su jugador ──');
{
    ok('4a · la 1a columna muestra el nombre del FAMILIAR, no el del jugador',
       /class="contact-parent-name"[\s\S]{0,300}link\.parentName/.test(filaVinc),
       'la primera celda seguia pintando el alias del JUGADOR');

    ok('4b · y ese nombre se persiste en el vinculo',
       /parentName:\s*nameEl\s*\?\s*nameEl\.value\.trim\(\)/.test(SRC),
       'se podria editar y no se guardaria');

    // undefined, no '': Firestore ignora undefined en updateDoc, asi que un
    // formulario a medio montar no borra el nombre ya guardado.
    ok('4c · si la casilla no esta en el DOM se manda undefined, no cadena vacia',
       /parentName:\s*nameEl\s*\?[^:]*:\s*undefined/.test(SRC),
       'con cadena vacia se borraria el nombre ya guardado');

    ok('4d · la columna del codigo enseña el codigo de invitacion',
       /link\.inviteCode/.test(filaVinc), 'sin codigo no se sabe a que jugador va');
    ok('4e · y ademas el dorsal y el alias, para ver el vinculo de un vistazo',
       /link\.playerNumber/.test(filaVinc) &&
       /link\.playerAlias\s*\|\|\s*link\.playerName/.test(filaVinc),
       'el codigo solo no dice quien es el jugador');

    ok('4f · el padre manual elige su jugador con el selector de plantilla',
       /class="p-player"/.test(filaMan) && /_cronos_squad_cache/.test(filaMan),
       'un padre manual sin selector queda sin vincular');

    ok('4g · la fila vinculada conserva su data-linkid (es la clave del guardado)',
       /data-linkid=/.test(filaVinc));
}

// ═══════════ PARTE 5 · la trampa del backtick ═══════════
console.log('\n── PARTE 5 · trampa conocida ──');
{
    // Reincidio en v430 al documentar esta misma reestructuracion: un backtick
    // dentro de un comentario HTML cierra el template literal del innerHTML y
    // node --check NO lo ve como error del fichero completo hasta que rompe.
    const conBacktick = [];
    const re = /<!--[\s\S]*?-->/g;
    let m;
    while ((m = re.exec(SRC)) !== null) {
        if (m[0].includes('`')) conBacktick.push(SRC.slice(0, m.index).split('\n').length);
    }
    ok('5a · ningun comentario HTML lleva backticks',
       conBacktick.length === 0, 'lineas: ' + conBacktick.join(', '));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
