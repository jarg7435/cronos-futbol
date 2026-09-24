// ─────────────────────────────────────────────────────────────────────────
//  test_copias_seguridad.js  ·  🛟 Fase 5 (2026-09-22)
//
//  Vigila las DOS cosas que pueden pudrirse de la política de copias, y
//  ninguna de las dos consulta a Google: este guard corre en la batería, así
//  que todo lo que comprueba es local.
//
//  1. 🔴 QUE `backups/` SIGA FUERA DE GIT.
//     `npm run backup:auth` escribe ahí el correo y el HASH DE CONTRASEÑA de
//     todas las familias, menores incluidos. Si alguien toca .gitignore, el
//     siguiente `git add -A` los sube a un repositorio y eso no se deshace:
//     un secreto que ha estado en un commit está quemado aunque se borre.
//     Se comprueba con `git check-ignore`, que es lo que git hará de verdad,
//     y no leyendo .gitignore a ojo — que es como se cuela una regla que
//     parece cubrir y no cubre.
//
//  2. 🔴 QUE EL VERIFICADOR SIGA FALLANDO HACIA EL NO.
//     `scripts/ops/copias_estado.js` sale con 1 cuando falta algo. Si alguien
//     lo «arregla» para que no moleste —un SKIP sin sesión, un exit(0) al
//     final—, se convierte en el `echo TODO` del build: un verde permanente
//     que tapa que no hay copias. Ese defecto ya se pagó en la Fase 0.
//
//  ⚠️ LO QUE ESTE GUARD **NO** PUEDE HACER: decir si hoy hay copias. Eso sólo
//  lo sabe Google, y se pregunta con `npm run backup:estado`. Aquí se vigila
//  que la herramienta que lo pregunta siga siendo capaz de decir que no.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const leer = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + n); }
    else { fail++; console.log('  ✗ ' + n); if (extra !== undefined) console.log('      → ' + String(extra).slice(0, 400)); }
};

const PKG = JSON.parse(leer('package.json').replace(/^﻿/, ''));
const EST = leer('scripts/ops/copias_estado.js');
const EXP = leer('scripts/ops/exporta_auth.js');
const DOC = leer('RECUPERACION.md');

console.log('\n══ 🛟 Fase 5 · la política de copias no se pudre ══');

// ════════════════════════════════════════════════════════════════════
console.log('\n1) 🔴 Los hashes de contraseña de las familias, fuera de git');
{
    // ⚠️ DOS FORMAS DE LLEGAR AQUÍ (reauditoría 23-09): desde un checkout, o
    //    desde un ZIP/`git archive`, que NO trae `.git`. En el ZIP, check-ignore
    //    fallaba por «no es un repositorio» y el guard daba un rojo que no
    //    decía nada de .gitignore. Se distinguen los dos casos, pero en NINGUNO
    //    se deja de preguntar a GIT: sin metadatos, se le pregunta a un repo
    //    desechable con el MISMO .gitignore. Leerlo a ojo sigue prohibido.
    //
    //    Se anula el excludesFile global: un `backups/` en el ignore personal
    //    de quien corre el test daría verde aquí y rojo en cualquier otro clon.
    const SIN_GLOBAL = ['-c', 'core.excludesFile=' + path.join(require('os').tmpdir(), 'cronos_no_existe_' + process.pid)];
    const git = (args, cwd) => cp.spawnSync('git', SIN_GLOBAL.concat(args), { cwd, encoding: 'utf8' });
    const RUTA = 'backups/auth_users_x.json';

    const version = git(['--version'], ROOT);
    const top = git(['rev-parse', '--show-toplevel'], ROOT);
    const mismoDir = (a, b) => { try { return fs.realpathSync(a).toLowerCase() === fs.realpathSync(b).toLowerCase(); } catch (_) { return false; } };
    // Un ZIP descomprimido DENTRO de otro repo tampoco es un checkout propio:
    // ahí check-ignore contestaría con las reglas del repo de fuera.
    const esCheckout = top.status === 0 && mismoDir((top.stdout || '').trim(), ROOT);

    if (version.status !== 0) {
        ok('1a · 🔑🔑 `backups/` está ignorado por git', false,
           'no hay `git` instalado: sin él no se puede medir, y un guard que no puede medir no aprueba');
    } else if (esCheckout) {
        const r = git(['check-ignore', '-q', RUTA], ROOT);
        ok('1a · 🔑🔑 `backups/` está ignorado por git (check-ignore sobre el checkout)',
           r.status === 0,
           'si esto cae, la siguiente exportación de Auth se puede subir a un commit');

        // Y que nunca se haya colado una.
        const seguidos = git(['ls-files', 'backups/'], ROOT);
        ok('1b · y no hay NI UN fichero de backups/ ya seguido por git',
           seguidos.status === 0 && (seguidos.stdout || '').trim() === '',
           seguidos.status !== 0 ? (seguidos.stderr || '') : (seguidos.stdout || '').slice(0, 300));
    } else {
        console.log('  ℹ️  artefacto SIN metadatos de git (ZIP / git archive): se mide con un repo desechable');
        const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cronos_gi_'));
        let r;
        try {
            fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(tmp, '.gitignore'));
            git(['init', '-q'], tmp);
            r = git(['check-ignore', '-q', RUTA], tmp);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
        // status 1 = git ha mirado y NO está ignorado → rojo, igual que en un
        // checkout. Sólo el 0 aprueba; cualquier otra cosa es no haber medido.
        ok('1a · 🔑🔑 `backups/` está ignorado por el .gitignore entregado (check-ignore en repo desechable)',
           r && r.status === 0,
           r && r.status === 1 ? 'git dice que backups/ NO está ignorado' : 'no se pudo medir: ' + (r && r.stderr));

        // En el artefacto no hay índice que consultar, así que lo que se
        // comprueba es lo que de verdad importa en un ZIP: que no VIAJE dentro.
        // (Antes esta aserción pasaba en verde falso: `ls-files` fallaba y su
        // salida vacía se leía como «nada seguido».)
        const dir = path.join(ROOT, 'backups');
        const dentro = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
        ok('1b · y el artefacto no lleva NI UN fichero de backups/ dentro',
           dentro.length === 0, dentro.slice(0, 10).join(', '));
    }

    ok('1c · 🔑 el exportador ABORTA si backups/ dejara de estar ignorado',
       /check-ignore/.test(EXP) && /ABORTADO/.test(EXP) && /process\.exit\(1\)/.test(EXP),
       'comprobarlo DESPUÉS de escribir el fichero no serviría de nada');

    // ⚠️ SE MIDE SOBRE EL CÓDIGO, SIN COMENTARIOS. Esta aserción comparaba la
    //    posición de las CADENAS 'check-ignore' y 'auth:export' en el fichero
    //    entero, y se puso roja cuando un comentario nuevo —el que explica por
    //    qué la ruta va relativa— MENCIONÓ `auth:export` más arriba. El orden
    //    del código no había cambiado; lo que cambió fue una explicación.
    //    Tercera vez esta sesión que una aserción mide una palabra en vez de
    //    una propiedad (ver SEC-INV2 y `test_gift_passes` 7g).
    {
        const _cod = EXP.replace(/\/\*[\s\S]*?\*\//g, '')
            .split(/\r?\n/).map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
        ok('1d · …y lo comprueba ANTES de escribir nada',
           _cod.indexOf('check-ignore') > -1 &&
           _cod.indexOf('check-ignore') < _cod.indexOf("'auth:export'"),
           'el orden es la mitad del arreglo');
    }
}

// ════════════════════════════════════════════════════════════════════
console.log('\n2) 🔴 El verificador sigue sabiendo decir que NO');
{
    ok('2a · 🔑🔑 sale con 1 cuando falta algo',
       /if \(fallos\)/.test(EST) && /process\.exit\(1\)/.test(EST),
       'un verificador que siempre sale con 0 tapa que no hay copias');

    // ⚠️ AQUÍ SE MIDE LA SALIDA, NO LA PALABRA. La primera versión de esta
    //    aserción buscaba que no apareciera «SKIP» en el fichero… y lo
    //    encontraba EN EL COMENTARIO QUE EXPLICA QUE NO HAY SKIP. Rojo en
    //    falso sobre una explicación, la misma trampa que el `<script>` dentro
    //    de un comentario HTML en la Fase 0. Lo que importa es con qué código
    //    SALE cuando no hay sesión.
    {
        const _salidasCero = (EST.match(/process\.exit\(0\)/g) || []).length;
        ok('2b · 🔑 sin sesión del CLI NO aprueba: sale con 1',
           /ESTADO DESCONOCIDO/.test(EST) && _salidasCero === 1,
           'exit(0) aparece ' + _salidasCero + ' vez/veces; sólo puede estar en el éxito final');
    }

    ok('2c · un error de red tampoco aprueba',
       /catch\s*\(\s*e\s*\)\s*=>\s*\{[\s\S]{0,200}process\.exit\(1\)/.test(EST) ||
       /No lo sé/.test(EST),
       'el catch final tiene que salir con 1');

    // Los cinco puntos que mide. Si alguien quita uno, deja de vigilarse.
    for (const [n, patron] of [
        ['PITR',                        /pointInTimeRecoveryEnablement/],
        ['las programaciones',          /backupSchedules/],
        ['que las copias EXISTAN',      /locations\/-\/backups/],
        ['la exportación de Auth',      /auth_users_/],
        ['la fecha del simulacro',      /Registro de simulacros/],
    ]) {
        ok('2d · comprueba ' + n, patron.test(EST));
    }

    // 🔑 Que exista la PROGRAMACIÓN no prueba que la copia se haya HECHO.
    ok('2e · 🔑 distingue «programada» de «hecha» (mira el estado READY)',
       /READY/.test(EST),
       'son dos cosas distintas y la segunda es la que salva el día malo');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n3) 📄 El runbook cubre lo que la copia NO trae');
{
    ok('3a · 🔑🔑 avisa de que Auth NO va dentro de la copia de Firestore',
       /no.{0,40}contiene/i.test(DOC) && /Auth/.test(DOC) && /uid/.test(DOC),
       'es lo que convierte una restauración en un desastre a medias');

    ok('3b · nombra los custom claims (role/clubId)',
       /customAttributes/.test(DOC) && /claims/i.test(DOC));

    ok('3c · dice que se restaura a una base NUEVA, nunca sobre (default)',
       /nunca sobre|base NUEVA/i.test(DOC));

    ok('3d · tiene procedimiento de simulacro y su registro con fecha',
       /## Parte 3 · El simulacro/.test(DOC) && /## Registro de simulacros/.test(DOC));

    ok('3e · declara RPO y RTO (si no, no se puede medir si se cumple)',
       /RPO/.test(DOC) && /RTO/.test(DOC));

    ok('3f · ⚠️ dice CLARAMENTE que todavía no está activado',
       /NO HAY NINGUNA COPIA DE SEGURIDAD/.test(DOC),
       'un runbook que suena a que ya funciona es peor que no tenerlo');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n4) 🔌 Está enchufado donde se usa');
{
    const s = PKG.scripts || {};
    ok('4a · `npm run backup:auth` existe', /exporta_auth\.js/.test(s['backup:auth'] || ''), s['backup:auth']);
    ok('4b · `npm run backup:estado` existe', /copias_estado\.js/.test(s['backup:estado'] || ''), s['backup:estado']);
    ok('4c · el runbook manda usar el verificador',
       /backup:estado|copias_estado\.js/.test(DOC));
}

console.log('\n──────────────────────────────────────────────────────────');
console.log('Resultado: ' + pass + '/' + (pass + fail) + (fail ? '  ❌' : '  ✅'));
process.exit(fail ? 1 : 0);
