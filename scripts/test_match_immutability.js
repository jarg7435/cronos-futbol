// ─────────────────────────────────────────────────────────────────────────
// test_match_immutability.js · UN PARTIDO TERMINADO NO SE EDITA (v434)
//
// Regla de negocio del autor: lo ocurrido en un partido es sagrado. Tres
// estados, y el borrado automatico cierra el ciclo:
//
//    live    · status 'active'            -> se escribe con normalidad
//    grace   · terminado hace MENOS de 2h -> SOLO se pueden ANADIR sucesos
//    frozen  · terminado hace MAS de 2h   -> ni edicion ni borrado
//    >10h    · lo borra cleanupLiveMatches en el servidor
//
//  2h de gracia + 8h congelado = las 10h de retencion de v431.
//
// ESTE GUARD TIENE CUATRO PARTES Y LAS DOS PRIMERAS EJECUTAN CODIGO DE VERDAD:
//   1 · el modulo js/match/immutability.js, corrido contra partidos fabricados
//   2 · las puertas del cliente (censo de fuente)
//   3 · la Cloud Function
//   4 · firestore.rules EVALUADAS EN EL SERVIDOR DE GOOGLE (Rules REST API)
//
// ⚠️ LA PARTE 4 ES LA QUE IMPORTA. Todo lo demas corre en el navegador del
// usuario y es un ayudante de interfaz: apaga botones y evita intentos que van
// a fallar, pero cualquiera se lo salta desde la consola. Quien impide de
// verdad la falsificacion son las reglas. Un guard que solo mirase el cliente
// daria una sensacion de seguridad FALSA.
//
// ⚠️ DOS TRAMPAS DE LA RULES REST API, pagadas al escribir esto:
//   · `request.time` NO EXISTE si no se pasa explicitamente en el testCase.
//     Sin el, toda expresion que lo use LANZA — y como un error equivale a
//     DENY, los casos DENY salian "SUCCESS" por el motivo equivocado. Es decir:
//     la mitad de la suite habria estado verde sin probar nada.
//   · Los timestamps van como STRING ISO 8601. Con {seconds,nanos} el valor
//     llega como `map` y la aritmetica lanza.
//
// La parte 4 se SALTA con aviso si no hay sesion del CLI, para no romper CI.
// ─────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const PROJECT = 'cronos-futbol-app';
const CONFIG = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');
const DB = '/databases/(default)/documents';

let fail = 0, pass = 0;
const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name); if (extra !== undefined) console.log('       ' + String(extra).slice(0, 300)); }
};

const LOCK  = fs.readFileSync(path.join(ROOT, 'js/match/immutability.js'), 'utf8');
const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const FUNCS = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
const RETRO = fs.readFileSync(path.join(ROOT, 'js/match/events/retroactive-modal.js'), 'utf8');
const PACT  = fs.readFileSync(path.join(ROOT, 'js/match/events/player-actions.js'), 'utf8');
const SYNC  = fs.readFileSync(path.join(ROOT, 'js/match/live/sync.js'), 'utf8');
const LIVE  = fs.readFileSync(path.join(ROOT, 'live.html'), 'utf8');
const INIT  = fs.readFileSync(path.join(ROOT, 'js/core/app-init.js'), 'utf8');
const FTAB  = fs.readFileSync(path.join(ROOT, 'js/coach/reports/finished-matches-tab.js'), 'utf8');

console.log('── inmutabilidad del partido terminado (v434) ──');

// ═══════════ PARTE 1 · el modulo, ejecutado ═══════════
console.log('\n── PARTE 1 · los tres estados (codigo ejecutado) ──');
const sandbox = { window: {}, console: { warn: () => {} }, Date, Math, isNaN };
vm.createContext(sandbox);
vm.runInContext(LOCK, sandbox);
const L = sandbox.window.CronosMatchLock;

ok('1a · el modulo se publica en window.CronosMatchLock', !!L);
if (!L) { console.log('\n' + pass + ' PASS / ' + fail + ' FAIL'); process.exit(1); }

const H = 3600 * 1000;
const AHORA = Date.now();
const ts = (ms) => ({ toDate: () => new Date(ms) });

ok('1b · la ventana es de 2 h', L.GRACE_MS === 2 * H, L.GRACE_MS);
ok('1c · la retencion es de 10 h', L.RETENTION_MS === 10 * H, L.RETENTION_MS);

ok('1d · un partido en juego esta vivo',
   L.state({ status: 'active' }, AHORA) === 'live');
ok('1e · recien terminado -> ventana de gracia',
   L.state({ status: 'finished', finishedAt: ts(AHORA - 10 * 60000) }, AHORA) === 'grace');
ok('1f · terminado hace 1h59 -> sigue en gracia',
   L.state({ status: 'finished', finishedAt: ts(AHORA - (2 * H - 60000)) }, AHORA) === 'grace');
ok('1g · [BORDE] terminado hace 2h01 -> CONGELADO',
   L.state({ status: 'finished', finishedAt: ts(AHORA - (2 * H + 60000)) }, AHORA) === 'frozen',
   'la ventana se pasaria de las 2 h pactadas');
ok('1h · terminado hace 9h -> congelado',
   L.state({ status: 'finished', finishedAt: ts(AHORA - 9 * H) }, AHORA) === 'frozen');
ok('1i · un partido cancelado tampoco esta vivo',
   L.state({ status: 'cancelled', finishedAt: ts(AHORA - 5 * H) }, AHORA) === 'frozen');

// El respaldo del ancla. No es cosmetico: cubre el hueco en que finishedAt
// todavia es null en la copia local porque serverTimestamp no ha vuelto.
ok('1j · [RESPALDO] sin finishedAt se usa updatedAt',
   L.state({ status: 'finished', updatedAt: ts(AHORA - 30 * 60000) }, AHORA) === 'grace',
   'justo tras finalizar, finishedAt llega NULL al cliente y el partido nace congelado');
ok('1k · sin NINGUNA fecha utilizable -> congelado, nunca editable',
   L.state({ status: 'finished' }, AHORA) === 'frozen',
   'si no se puede fechar el final, no se puede demostrar que estemos dentro');
ok('1l · una fecha corrupta se trata como ausente',
   L.state({ status: 'finished', finishedAt: 'no-es-una-fecha' }, AHORA) === 'frozen');
ok('1m · acepta epoch en milisegundos',
   L.state({ status: 'finished', finishedAt: AHORA - 10 * 60000 }, AHORA) === 'grace');
ok('1n · acepta ISO',
   L.state({ status: 'finished', finishedAt: new Date(AHORA - 10 * 60000).toISOString() }, AHORA) === 'grace');
ok('1o · acepta {seconds} de Firestore',
   L.state({ status: 'finished', seconds: 0, finishedAt: { seconds: Math.floor((AHORA - 600000) / 1000) } }, AHORA) === 'grace');

ok('1p · en gracia SI se pueden anadir sucesos',
   L.canAddEvent({ status: 'finished', finishedAt: ts(AHORA - H) }, AHORA) === true);
ok('1q · congelado NO',
   L.canAddEvent({ status: 'finished', finishedAt: ts(AHORA - 5 * H) }, AHORA) === false);

ok('1r · [DECISION DEL AUTOR] congelado tampoco se BORRA',
   L.canDelete({ status: 'finished', finishedAt: ts(AHORA - 5 * H) }, false, AHORA) === false,
   'lo que no se puede editar se falsificaria por omision haciendolo desaparecer');
ok('1s · pero el SuperAdmin conserva la valvula',
   L.canDelete({ status: 'finished', finishedAt: ts(AHORA - 5 * H) }, true, AHORA) === true);
ok('1t · en gracia si se puede borrar',
   L.canDelete({ status: 'finished', finishedAt: ts(AHORA - H) }, false, AHORA) === true);

ok('1u · el tiempo restante se cuenta bien',
   L.graceRemainingText({ status: 'finished', finishedAt: ts(AHORA - H) }, AHORA) === '1h 0min',
   L.graceRemainingText({ status: 'finished', finishedAt: ts(AHORA - H) }, AHORA));
ok('1v · congelado no tiene restante', L.graceRemainingMs({ status: 'finished', finishedAt: ts(AHORA - 5 * H) }, AHORA) === 0);

// ═══════════ PARTE 2 · las puertas del cliente ═══════════
console.log('\n── PARTE 2 · puertas en el navegador (interfaz) ──');
{
    // v439: el 5o argumento (`extra`) dejo de ser el literal `null` — ahora lleva
    // el equipo en campos estructurados. Lo que fija esta asercion es el 6o, el
    // partido DESTINO, asi que el hueco de `extra` se acepta abierto: exigir
    // `null` ahi era fijar un detalle ajeno al bug que protege.
    ok('2a · [BUG v434] el modal retroactivo pasa el partido DESTINO',
       /_registerMatchEvent\(eventType, text, icon, matchTime, [^,]+,[\s\S]{0,120}matchId: _targetMatchId/.test(RETRO),
       'sin esto el evento se escribia en la global liveMatchId: el partido equivocado');
    ok('2b · y _registerMatchEvent acepta ese destino',
       /function _registerMatchEvent\(type, text, icon, matchTimeOverride, extra, target\)/.test(PACT));
    ok('2c · el destino manda sobre la global',
       /var _id = \(target && target\.matchId\)/.test(PACT));
    ok('2d · el buffer del modal NO pierde el destino al reenviar',
       /_modalBuffer\.push\(\[type, text, icon, matchTimeOverride, extra, target\]\)/.test(PACT),
       '_confirmarEventosModal reenvia la tupla con apply: sin target volveria a liveMatchId');

    ok('2e · el modal comprueba el candado al ABRIR',
       /openRetroactiveEventModal = async function[\s\S]{0,1200}canAddEvent\(_targetMatchData\)/.test(RETRO));
    ok('2f · y REVALIDA al guardar',
       /submitRetroactiveEvent = async function[\s\S]{0,400}canAddEvent\(_targetMatchData\)/.test(RETRO),
       'dejar el modal abierto seria la forma de saltarse la congelacion');
    ok('2g · lee el partido del SERVIDOR y no de la pantalla',
       /async function _cargarPartido[\s\S]{0,500}getDoc\(/.test(RETRO));
    ok('2h · _registerMatchEvent tambien tiene puerta',
       /CronosMatchLock[\s\S]{0,80}canAddEvent\(target\.matchData\)/.test(PACT));

    ok('2i · el borrado desde el historial comprueba el candado',
       /window\.deleteMatch = async function[\s\S]{0,400}canDelete\(_m, false\)/.test(LIVE));
    // Se recorta el cuerpo de la funcion y se busca DENTRO, en vez de fiarlo a
    // un `[\s\S]{0,N}` con un tope a ojo: en v435 se le anadieron comentarios y
    // la comprobacion quedo fuera del rango, dando un rojo que no era un
    // defecto sino un limite mal elegido.
    {
        const iniD = INIT.indexOf('window.deleteFinishedMatchFromCloud = async function');
        const cuerpoD = iniD === -1 ? '' : INIT.slice(iniD, iniD + 4000);
        ok('2j · y el borrado del listado de terminados tambien',
           /canDelete\(/.test(cuerpoD) && /CronosMatchLock/.test(cuerpoD),
           'sin la puerta, un partido congelado se podria borrar desde ese listado');
    }
    ok('2k · deleteLiveMatch igual',
       /window\.deleteLiveMatch = async function[\s\S]{0,600}canDelete\(_m, false\)/.test(LIVE));

    ok('2l · el boton "Guardar" (keep) ya no escribe',
       !/updateDoc\(doc\(db, 'live_matches', matchId\), \{ keep: newKeep \}\)/.test(LIVE),
       'escribir keep es editar un partido terminado, y ademas prometia algo falso');
    ok('2m · se acabo el auto-borrado a 24 h desde el navegador',
       !/twentyFourHoursAgo/.test(LIVE),
       'contradecia la retencion de 10 h y ya no tendria permisos');
    ok('2n · la lista de terminados filtra por la ventana de retencion',
       /_cortRetencion/.test(LIVE) && /RETENTION_MS/.test(LIVE));
    ok('2o · el enriquecimiento de categorias no escribe sobre partidos',
       /_esPartido = colName === 'live_matches'[\s\S]{0,200}&& !_esPartido/.test(FTAB) &&
       /_esPartido = colName === 'live_matches'[\s\S]{0,200}&& !_esPartido/.test(INIT),
       'escribia category/subcategory durante el render sobre partidos cerrados');
    ok('2p · sync.js ya no borra a 7 dias desde el cliente',
       !/sevenDaysAgo/.test(SYNC),
       'inalcanzable desde v431 e imposible desde v434');
    ok('2q · el cierre por 4 h del cliente SELLA finishedAt',
       /status: 'finished',[\s\S]{0,120}finishedAt: serverTimestamp\(\)/.test(SYNC),
       'sin sello el partido nace congelado y con la retencion medio gastada');
    ok('2r · los dos listados marcan el estado en la ficha',
       /🔒 CERRADO/.test(FTAB) && /🔒 CERRADO/.test(INIT));
    ok('2s · el modulo se carga en los DOS html, antes de sus consumidores',
       /js\/match\/immutability\.js/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')) &&
       /js\/match\/immutability\.js/.test(LIVE));
}

// ═══════════ PARTE 3 · la Cloud Function ═══════════
console.log('\n── PARTE 3 · el borrado en servidor ──');
{
    const pasoB = FUNCS.slice(FUNCS.indexOf('PASO B'), FUNCS.indexOf('cleanupLiveMatches] cerrados'));

    ok('3a · [APLAZAMIENTO] el paso B ya NO filtra por updatedAt',
       !/where\('updatedAt', '<', corte10h\)/.test(pasoB),
       'una edicion posterior refrescaba updatedAt y retrasaba el borrado otras 10 h');
    ok('3b · recoge tambien los cancelados',
       /where\('status', 'in', \['finished', 'cancelled'\]\)/.test(pasoB),
       'un partido cancelado se quedaba para siempre, y ya no se puede borrar a mano');
    ok('3c · ordena de mas antiguo a mas reciente',
       /orderBy\('updatedAt', 'asc'\)/.test(pasoB),
       'sin orden, con acumulacion cada pasada mordería los mismos 450');
    ok('3d · el ancla real sigue siendo finishedAt',
       /data\.finishedAt \|\| data\.cancelledAt \|\| data\.updatedAt/.test(pasoB));
    ok('3e · sin fecha utilizable NO se borra',
       /if \(!finMs\) return;/.test(pasoB),
       'mas vale un documento de mas que destruir el partido de alguien');
    ok('3f · se conserva el tope de 450 por el limite de 500 del batch',
       /limit\(450\)/.test(pasoB));
}

// ═══════════ PARTE 4 · LAS REGLAS, evaluadas en el servidor ═══════════
console.log('\n── PARTE 4 · firestore.rules (Rules REST API) ──');

function getAccessToken(refreshToken) {
    const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
    const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
    const body = new URLSearchParams({
        refresh_token: refreshToken, client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET, grant_type: 'refresh_token',
    }).toString();
    return new Promise((resolve, reject) => {
        const req = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        }, res => {
            const cs = []; res.on('data', c => cs.push(c));
            res.on('end', () => { const d = Buffer.concat(cs).toString('utf8');
                try { const j = JSON.parse(d); j.access_token ? resolve(j.access_token) : reject(new Error(d.slice(0, 200))); }
                catch (e) { reject(new Error(d.slice(0, 200))); } });
        });
        req.on('error', reject); req.write(body); req.end();
    });
}
function post(url, token, payload) {
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: {
            Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body) } },
            // Buffers, no `d += chunk`: acumular string CORROMPE los multibyte
            // que caen partidos entre dos chunks (trampa ya pagada en v391).
            res => { const cs = []; res.on('data', c => cs.push(c));
                     res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(cs).toString('utf8') })); });
        req.on('error', reject); req.write(body); req.end();
    });
}

function mocksUsuario(uid, data) {
    const p = `${DB}/users/${uid}`;
    return [
        { function: 'exists', args: [{ exactValue: p }], result: { value: data !== null } },
        { function: 'get', args: [{ exactValue: p }], result: { value: { data: data || {} } } },
        { function: 'exists', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: false } },
        { function: 'get', args: [{ exactValue: `${DB}/cronos_config/superadmins` }], result: { value: { data: { emails: [] } } } },
    ];
}

const CLUB_A = 'clubA';
const COACH_A = 'coachA_uid';
const docCoachA = { clubId: CLUB_A, isAuthorized: true, role: 'user' };
const authCoach = { uid: COACH_A, token: { email: 'a@club.es', firebase: { sign_in_provider: 'password' } } };
const authSA = { uid: 'sa_uid', token: { email: 'sa@x.es', role: 'superadmin', firebase: { sign_in_provider: 'password' } } };
// ⚠️ ISO 8601. Con {seconds,nanos} el valor llega como `map` y la suma lanza.
const iso = (ms) => new Date(ms).toISOString();

function partido(extra) {
    return Object.assign({
        clubId: CLUB_A, createdBy: 'otro_uid', coachEmail: 'otro@club.es',
        events: ['e1'], homeTeam: { name: 'L', score: 1 }, awayTeam: { name: 'V', score: 0 },
    }, extra);
}

function casosReglas() {
    const enJuego    = partido({ status: 'active',   updatedAt: iso(AHORA - 60000) });
    const enGracia   = partido({ status: 'finished', finishedAt: iso(AHORA - H), updatedAt: iso(AHORA - H) });
    const congelado  = partido({ status: 'finished', finishedAt: iso(AHORA - 5 * H), updatedAt: iso(AHORA - 5 * H) });
    const sinSello   = partido({ status: 'finished', updatedAt: iso(AHORA - 30 * 60000) });
    const sinFechas  = partido({ status: 'finished' });

    // Un update que SOLO anade sucesos.
    const soloEventos = (base) => Object.assign({}, base, { events: ['e1', 'e2'] });
    // Un update que toca el MARCADOR.
    const tocaMarcador = (base) => Object.assign({}, base, { homeTeam: { name: 'L', score: 9 } });

    return [
        { n: '4a · partido EN JUEGO: el coach escribe con normalidad',
          exp: 'ALLOW', auth: authCoach, method: 'update',
          existing: enJuego, entrante: soloEventos(enJuego) },

        { n: '4b · la transicion a FINALIZADO se permite (el estado que manda es el anterior)',
          exp: 'ALLOW', auth: authCoach, method: 'update',
          existing: enJuego,
          entrante: partido({ status: 'finished', finishedAt: iso(AHORA), updatedAt: iso(AHORA) }) },

        { n: '4c · [VENTANA] en gracia SI se anade un suceso',
          exp: 'ALLOW', auth: authCoach, method: 'update',
          existing: enGracia, entrante: soloEventos(enGracia) },

        { n: '4d · [EL NUCLEO] en gracia NO se puede tocar el marcador',
          exp: 'DENY', auth: authCoach, method: 'update',
          existing: enGracia, entrante: tocaMarcador(enGracia),
          why: 'sin el hasOnly, la ventana permitiria reescribir el resultado durante 2 h' },

        { n: '4e · [EL NUCLEO] congelado NO admite ni un suceso',
          exp: 'DENY', auth: authCoach, method: 'update',
          existing: congelado, entrante: soloEventos(congelado) },

        { n: '4f · [SIN EXCEPCIONES] ni el SuperAdmin edita un partido congelado',
          exp: 'DENY', auth: authSA, method: 'update',
          existing: congelado, entrante: soloEventos(congelado),
          why: 'un rol con permiso para reescribir el resultado ES la falsificacion' },

        { n: '4g · [RESPALDO] sin finishedAt vale updatedAt para la ventana',
          exp: 'ALLOW', auth: authCoach, method: 'update',
          existing: sinSello, entrante: soloEventos(sinSello) },

        { n: '4h · sin ninguna fecha: cerrado',
          exp: 'DENY', auth: authCoach, method: 'update',
          existing: sinFechas, entrante: soloEventos(sinFechas) },

        { n: '4i · [BORRADO] congelado NO se borra',
          exp: 'DENY', auth: authCoach, method: 'delete', existing: congelado },

        { n: '4j · en gracia si se puede borrar',
          exp: 'ALLOW', auth: authCoach, method: 'delete', existing: enGracia },

        { n: '4k · el partido en juego se puede borrar (huerfano/duplicado)',
          exp: 'ALLOW', auth: authCoach, method: 'delete', existing: enJuego },

        { n: '4l · [VALVULA] el SuperAdmin SI borra un partido congelado',
          exp: 'ALLOW', auth: authSA, method: 'delete', existing: congelado },
    ];
}

(async () => {
    let refresh = null;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
        refresh = cfg.tokens && cfg.tokens.refresh_token;
    } catch (e) { /* sin sesion */ }

    if (!refresh) {
        console.log('SKIP · sin sesion del CLI (firebase login): no se evaluan las reglas.');
        console.log('       ⚠️ La barrera real queda SIN PROBAR en esta ejecucion.');
    } else {
        try {
            const token = await getAccessToken(refresh);
            const casos = casosReglas();
            const testCases = casos.map(c => ({
                expectation: c.exp,
                request: {
                    auth: c.auth,
                    path: `${DB}/live_matches/M1`,
                    method: c.method,
                    // ⚠️ SIN ESTO, request.time no existe, la expresion LANZA y
                    // todo error equivale a DENY: los casos DENY saldrian verdes
                    // sin haber probado nada.
                    time: iso(AHORA),
                    resource: c.entrante ? { data: c.entrante } : undefined,
                },
                resource: { data: c.existing },
                functionMocks: mocksUsuario(c.auth.uid,
                    c.auth.uid === 'sa_uid' ? { isAuthorized: true, role: 'superadmin' } : docCoachA),
                pathEncoding: 'PLAIN',
            }));

            const r = await post(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
                                 token,
                                 { source: { files: [{ name: 'firestore.rules', content: RULES }] },
                                   testSuite: { testCases } });
            const j = JSON.parse(r.body);
            const res = j.testResults || [];

            if (!res.length) {
                ok('4· la API respondio con resultados', false, r.body.slice(0, 400));
            } else {
                casos.forEach((c, i) => {
                    const t = res[i] || {};
                    // Un errorPosition es un DENY por AVERIA, no por logica: en un
                    // caso DENY saldria "SUCCESS" y taparia una regla rota.
                    const rota = !!t.errorPosition;
                    ok(c.n, t.state === 'SUCCESS' && !rota,
                       rota ? ('LA REGLA LANZA: ' + JSON.stringify(t.debugMessages || t.errorPosition).slice(0, 220))
                            : (c.why ? c.why + ' | estado=' + t.state : 'estado=' + t.state));
                });
            }
        } catch (e) {
            ok('4· las reglas se pudieron evaluar', false, e.message);
        }
    }

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();
