// scripts/cache-bust.js
// Sincroniza un parametro ?v=<VERSION> en todos los <script src="js/..."> de
// index.html, derivando la version del CACHE_NAME de sw.js (fuente de verdad).
// Idempotente: elimina cualquier ?v= previo antes de reescribir.
// Uso: node scripts/cache-bust.js          → escribe
//      node scripts/cache-bust.js --check  → NO escribe; sale con 1 si algo
//                                            se habria quedado desincronizado.
//
// ⚠️ v751 (Fase 0) · EL MODO --check EXISTE POR EL BUILD.
//   Este script hay que ACORDARSE de lanzarlo tras subir el CACHE_NAME, y un
//   paso que hay que recordar se olvida justo el dia que importa: un despliegue
//   con los `?v=` viejos deja a medio mundo con los modulos cacheados de la
//   version anterior, sin ningun sintoma — la pagina simplemente se comporta
//   como una version vieja (la leccion de v422 y v427). `npm run build` lanza
//   este modo y CORTA, asi que el olvido ya no puede llegar a produccion.
const fs = require('fs');

const SOLO_COMPROBAR = process.argv.includes('--check');
const desincronizados = [];

const sw = fs.readFileSync('sw.js', 'utf8');
// Lee la constante real, no los comentarios: const CACHE_NAME = 'cronos-cache-vNNN';
const m = sw.match(/const\s+CACHE_NAME\s*=\s*'cronos-cache-(v\d+)'/);
if (!m) { console.error('No se encontro la constante CACHE_NAME en sw.js'); process.exit(1); }
const VERSION = m[1];

// ⚠️ LOS DOS HTML QUE CARGAN JS LOCAL, no solo index.html.
// live.html tambien enlaza dos modulos de js/ (replay-player.js y
// retroactive-modal.js) y este script NUNCA los tocaba: se quedaron clavados
// en ?v=v348 mientras el resto del proyecto avanzaba hasta v426. Consecuencia
// real: todo el trabajo de fidelidad de la repeticion (v418-v421, v427...) no
// llegaba a quien abre "Revivir" DESDE EL VISOR, porque su navegador seguia
// sirviendo la copia cacheada de v348 — sin ningun sintoma, la pagina
// simplemente se comportaba como una version vieja. Detectado en v427.
// live.html no enlaza style.css (tiene la hoja embebida), asi que ahi el
// contador de CSS sera 0; no es un error.
const files = ['index.html', 'live.html'];
const resumen = [];

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  let html = original;

  // Solo scripts LOCALES (src="js/..."). Evita CDNs (https://...).
  // Captura: <script ... src="js/....js"  + (opcional ?v=...)  + "
  const re = /(<script\b[^>]*\bsrc=")(js\/[^"?]+\.js)(\?v=[^"]*)?(")/g;
  let count = 0;
  html = html.replace(re, (_full, pre, path, _old, post) => {
    count++;
    return `${pre}${path}?v=${VERSION}${post}`;
  });

  // ⚠️ LA HOJA DE ESTILOS TAMBIEN. En firebase.json, **/*.css se sirve con
  // "Cache-Control: public, max-age=86400": el navegador se queda con style.css
  // DURANTE 24 HORAS. Sin este marcador, un despliegue que solo cambie CSS es
  // invisible para quien ya haya entrado, y ni el service worker lo salva (es
  // network-first, pero su fetch tambien pasa por la cache HTTP del navegador).
  // Se descubrio en v422, el primer despliegue solo-CSS del proyecto.
  const reCss = /(<link\b[^>]*\bhref=")(style\.css)(\?v=[^"]*)?(")/g;
  let countCss = 0;
  html = html.replace(reCss, (_full, pre, path, _old, post) => {
    countCss++;
    return `${pre}${path}?v=${VERSION}${post}`;
  });

  // 🔑 EL SELLO DE VERSION VISIBLE EN LA PANTALLA DE ACCESO.
  // Se escribe desde aqui —y no a mano— porque un sello que hay que acordarse
  // de actualizar miente antes o despues, y justo entonces es cuando hace
  // falta. Sirve para saber de un vistazo si el navegador tiene el codigo
  // nuevo o una copia vieja del service worker: tres rondas de un mismo fallo
  // se fueron en no poder responder a esa pregunta.
  let countVer = 0;
  html = html.replace(
    /(<span id="build-version" data-version=")[^"]*(">)[^<]*(<\/span>)/g,
    (_full, pre, mid, post) => { countVer++; return `${pre}${VERSION}${mid}${VERSION}${post}`; }
  );

  // 🔑 Y LA FRANJA DE VERSION DE LA CABECERA (v526). El sello de arriba solo
  // se ve en la PANTALLA DE ACCESO, asi que desaparece justo cuando se empieza
  // a probar. La franja se ve siempre — y por eso mismo tiene que escribirla
  // este script: la insignia que habia antes en ese sitio estaba clavada a
  // mano en "v341", 185 versiones atras, y nadie lo noto nunca.
  html = html.replace(
    /(<div id="cronos-version-badge" data-version=")[^"]*(")([^>]*>)\s*CHRONOS v[\d.]+\s*(<\/div>)/g,
    (_full, pre, comilla, resto, fin) => {
      countVer++;
      return `${pre}${VERSION}${comilla}${resto}CHRONOS ${VERSION}${fin}`;
    }
  );

  if (html !== original) desincronizados.push(file);
  if (!SOLO_COMPROBAR) fs.writeFileSync(file, html);
  resumen.push(`${file}: ${count} scripts + ${countCss} hoja(s) de estilo + ${countVer} sello(s) de version`);
}

// ⚠️ v751 (Fase 0) · Y EL SELLO QUE LLEVA EL PROPIO SERVICE WORKER.
//   `const VERSION` de sw.js prefija cada linea de registro del SW. Estaba
//   clavado a mano en 'v736' con el CACHE_NAME ya en 'v750': catorce versiones
//   de desfase en el dato que se mira JUSTO cuando hay que averiguar que copia
//   tiene un navegador. Es el mismo defecto que la insignia de la cabecera
//   —clavada en "v341" durante 185 versiones— y se arregla igual: lo escribe
//   este script, que no se olvida.
{
  const original = sw;
  const nuevo = original.replace(/(const\s+VERSION\s*=\s*')v\d+(';)/, `$1${VERSION}$2`);
  if (nuevo !== original) {
    desincronizados.push('sw.js');
    if (!SOLO_COMPROBAR) fs.writeFileSync('sw.js', nuevo);
  }
  resumen.push(`sw.js: sello de registro del SW -> ${VERSION}`);
}

console.log(`cache-bust${SOLO_COMPROBAR ? ' (--check)' : ''}: -> ?v=${VERSION}\n  ` + resumen.join('\n  '));

if (SOLO_COMPROBAR && desincronizados.length) {
  console.error('\n❌ DESINCRONIZADO: ' + desincronizados.join(', '));
  console.error('   El CACHE_NAME de sw.js dice ' + VERSION + ', pero esos ficheros');
  console.error('   llevan otra cosa. Desplegar asi sirve los modulos VIEJOS desde');
  console.error('   la cache del navegador, sin ningun sintoma visible.');
  console.error('   Arreglo:  node scripts/cache-bust.js');
  process.exit(1);
}
