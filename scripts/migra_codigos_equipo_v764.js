// ─────────────────────────────────────────────────────────────────────────
//  migra_codigos_equipo_v764.js  ·  🆔🔒 v764, opción (b) del autor (2026-09-24)
//
//  v764 hace que el código del jugador salga del EQUIPO. Los datos ya
//  guardados con el código viejo (el Regional B de José con «ALC..», los
//  entes con «JA..») hay que llevarlos al nuevo SIN perder su asistencia:
//
//   1. Plantilla del equipo (clubs/{c}/team_rosters/{equipo}.players_f7|f11[].ficha)
//   2. Asistencia del mes  (clubs/{c}/attendance/{equipo}__{mes}.marks[fecha][ficha])
//   3. Ficha de asistencia (clubs/{c}/attendance_players/{equipo}__{ficha}) → id nuevo
//   4. Copia de la plantilla de cada entrenador
//      (users/{uid}/cronos_data/main.cronos_master_roster, JSON: porEquipo[equipo][f7|f11][].id)
//   5. Vínculos de familia sin equipo → teamId/category/subcategory, sacados de
//      la plaza de familiar (la misma regla que cronosEquipoDeFamilia).
//
//  🔑 LA REGLA ES LA DE LA APP: sólo las FILAS BASE (18 en F7, 25 en F11) se
//  renombran, a prefijo_del_equipo + número de fila; los invitados (filas de
//  apoyo) conservan su código de origen. El prefijo sale de
//  cronosPrefijoJugador de js/core/utils.js, ejecutada tal cual: no hay copia.
//
//  🔒 SALVAGUARDAS
//   · Por defecto SIMULA (sólo GET) e imprime el plan con su HUELLA.
//   · Escribe sólo con  --escribir --huella=<la de la simulación>. Si los datos
//     cambiaron desde la simulación, la huella no coincide y no se escribe NADA.
//   · Cada escritura lleva la precondición updateTime del documento leído; un
//     equipo se escribe en UN commit atómico (todo o nada).
//   · Proyecto: --proyecto=cronos-futbol-app (producción, por defecto) o
//     --proyecto=cronos-futbol-test. Credenciales: la sesión del CLI.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const arg = (k) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : null; };
const PROYECTO = arg('proyecto') || 'cronos-futbol-app';
if (!['cronos-futbol-app', 'cronos-futbol-test'].includes(PROYECTO)) throw new Error('Proyecto no válido: ' + PROYECTO);
const ESCRIBIR = process.argv.includes('--escribir');
const HUELLA_PEDIDA = arg('huella');
// 🔒 --solo=<clubId|enteId>: la migración NO puede tocar nada fuera de esa entidad
// (orden del autor, 2026-09-25: los datos de equipo de usuarios reales no se tocan).
const SOLO = arg('solo');
const BASE = `https://firestore.googleapis.com/v1/projects/${PROYECTO}/databases/(default)/documents`;
const NOMBRE = (p) => `projects/${PROYECTO}/databases/(default)/documents/${p}`;
const FILAS_BASE = { f7: 18, f11: 25 };

// ── La regla del prefijo, la MISMA de la app ─────────────────────────────
const UTILS = fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'utils.js'), 'utf8');
const trozo = (s, a, b) => { const i = s.indexOf(a); if (i < 0) throw new Error('No está en utils.js: ' + a); return s.slice(i, s.indexOf(b, i) + b.length); };
const SB = { console };
vm.createContext(SB);
vm.runInContext([trozo(UTILS, 'function _cronosNoEsAcento(', '\n}\n'), trozo(UTILS, 'function cronosTeamSlug(', '\n}\n'),
    trozo(UTILS, 'function cronosSinModalidad(', '\n}\n'), trozo(UTILS, 'function cronosTeamId(', '\n}\n'),
    trozo(UTILS, 'function cronosPrefijoJugador(', '\n}\n')].join('\n') +
    '\nglobalThis.pref = cronosPrefijoJugador; globalThis.tid = cronosTeamId;', SB);
const codigo = (equipo, i) => SB.pref(equipo) + String(i + 1).padStart(2, '0');
const esCodigo = (x) => /^[A-Z]{1,4}\d{2}$/.test(String(x || ''));

// ── Red ──────────────────────────────────────────────────────────────────
function http(url, method, cuerpo, tok) {
    return new Promise((res, rej) => {
        const headers = { 'x-goog-user-project': PROYECTO };
        if (tok) headers.Authorization = 'Bearer ' + tok;
        let body;
        if (cuerpo !== undefined) { body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
            headers['Content-Type'] = typeof cuerpo === 'string' ? 'application/x-www-form-urlencoded' : 'application/json'; }
        const r = https.request(url, { method, headers }, (x) => { const b = []; x.on('data', (c) => b.push(c));
            x.on('end', () => { const t = Buffer.concat(b).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (_) {} res({ s: x.statusCode, j, t }); }); });
        r.on('error', rej); if (body) r.write(body); r.end();
    });
}
let TOK;
async function token() {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'));
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.tokens.refresh_token,
        client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com', client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' }).toString();
    TOK = (await http('https://oauth2.googleapis.com/token', 'POST', body)).j.access_token;
}
async function GET(url) {
    const r = await http(url, 'GET', undefined, TOK);
    if (r.s === 404) return null;
    if (r.s !== 200) throw new Error('GET ' + r.s + ' ' + url + ' ' + r.t.slice(0, 200));
    return r.j;
}
async function listar(col) {
    const out = []; let pt = '';
    do { const j = await GET(`${BASE}/${col}?pageSize=300${pt ? '&pageToken=' + encodeURIComponent(pt) : ''}`);
         ((j && j.documents) || []).forEach((d) => out.push(d)); pt = (j && j.nextPageToken) || ''; } while (pt);
    return out;
}
const str = (v) => (v && 'stringValue' in v) ? v.stringValue : '';
const idDe = (d) => d.name.split('/').pop();

// ── El plan ──────────────────────────────────────────────────────────────
async function planificar() {
    const equipos = [];    // { club, equipo, mapa:{viejo:nuevo}, writes:[], resumen:[] }
    const avisos = [];
    const copiasEscritas = [];   // una escritura por documento de copia
    const clubs = (await listar('clubs')).map(idDe).filter((c) => !SOLO || c === SOLO);
    if (SOLO && !clubs.length) throw new Error('--solo=' + SOLO + ' no existe');
    const users = await listar('users');

    // Las copias COMPLETAS de la plantilla de cada entrenador (una por equipo):
    // son las únicas que dicen qué filas son INVITADOS. La de team_rosters es
    // COMPACTA (sólo filas rellenas): su posición NO es la fila. Lo destapó la
    // primera simulación («CDC10→CDC01» en el Cadete C). Se leen UNA vez: un
    // entrenador con equipos en dos clubes acumula aquí todos sus cambios.
    const copias = [];
    for (const u of users) {
        const main = await GET(`${BASE}/users/${idDe(u)}/cronos_data/main`);
        const campo = main && main.fields && main.fields.cronos_master_roster;
        if (!campo || !('stringValue' in campo)) continue;
        let raiz; try { raiz = JSON.parse(campo.stringValue); } catch (_) { continue; }
        if (raiz && raiz.porEquipo) copias.push({ u, main, raiz });
    }

    for (const club of clubs) {
        const rosters = await listar(`clubs/${club}/team_rosters`);
        const asis = await listar(`clubs/${club}/attendance`);
        const fichas = await listar(`clubs/${club}/attendance_players`);
        const invitadosDe = (equipo) => {
            const s = new Set();
            for (const c of copias) {
                const eq = c.raiz.porEquipo[equipo]; if (!eq) continue;
                for (const modo of ['f7', 'f11']) (Array.isArray(eq[modo]) ? eq[modo] : []).forEach((p, i) => {
                    if (p && p.id && (p.isGuest || p.isSupport || i >= FILAS_BASE[modo])) s.add(String(p.id));
                });
            }
            return s;
        };
        // 🔑 LA FILA VA DENTRO DEL CÓDIGO: 'ALC07' es la fila 7. Se renombra si su
        // prefijo no es el del equipo, su fila es BASE y no es un invitado.
        const nuevoPara = (equipo, modo, c, invitados) => {
            if (!esCodigo(c) || invitados.has(c)) return null;
            const n = parseInt(c.slice(-2), 10), pref = c.slice(0, -2);
            if (!(n >= 1 && n <= FILAS_BASE[modo]) || pref === SB.pref(equipo)) return null;
            return codigo(equipo, n - 1);
        };

        for (const r of rosters) {
            const equipo = str(r.fields.teamId) || idDe(r);
            const invitados = invitadosDe(equipo);
            const mapa = {};
            const f = JSON.parse(JSON.stringify(r.fields));
            let conflicto = '';
            let enPlantillaCambian = 0;   // renombres REALES de la plantilla
            for (const modo of ['f7', 'f11']) {
                const vals = ((f['players_' + modo] || {}).arrayValue || {}).values || [];
                const actuales = new Set(vals.map((v) => str(((v.mapValue || {}).fields || {}).ficha)));
                vals.forEach((v) => {
                    const pf = v.mapValue && v.mapValue.fields; if (!pf || !pf.ficha) return;
                    const viejo = str(pf.ficha), nuevo = nuevoPara(equipo, modo, viejo, invitados);
                    if (!nuevo) return;
                    if (actuales.has(nuevo)) conflicto = 'el código nuevo ' + nuevo + ' ya lo usa otro jugador de la plantilla';
                    if (mapa[viejo] && mapa[viejo] !== nuevo) conflicto = 'el código ' + viejo + ' aparece dos veces';
                    mapa[viejo] = nuevo; pf.ficha = { stringValue: nuevo }; enPlantillaCambian++;
                });
            }
            // 🔑 LA PLANTILLA PUEDE ESTAR BIEN Y LA ASISTENCIA NO. Descubierto al
            // verificar la 1.ª aplicación (2026-09-25): el Regional A del ente de
            // jose_arg027 ya tenía la plantilla en RGA, pero sus 115 marcas y 23
            // fichas seguían en JA (de antes de que la plantilla cambiara): esa
            // asistencia no se veía. Los códigos a renombrar se buscan también
            // en la asistencia y en las fichas, con la misma regla.
            const modoEq = (f.players_f11 && !f.players_f7) ? 'f11' : ((f.players_f7 && !f.players_f11) ? 'f7' : null);
            if (modoEq) {
                const extra = [];
                asis.filter((d) => str(d.fields.teamId) === equipo || idDe(d).startsWith(equipo + '__')).forEach((d) => {
                    const dias = ((d.fields.marks || {}).mapValue || {}).fields || {};
                    Object.values(dias).forEach((dv) => Object.keys((dv.mapValue || {}).fields || {}).forEach((k) => extra.push(k)));
                });
                fichas.filter((d) => idDe(d).startsWith(equipo + '__')).forEach((d) => extra.push(idDe(d).slice(equipo.length + 2)));
                const enPlantilla = new Set(((f['players_' + modoEq] || {}).arrayValue || {}).values ?
                    f['players_' + modoEq].arrayValue.values.map((v) => str(((v.mapValue || {}).fields || {}).ficha)) : []);
                extra.forEach((c) => {
                    if (mapa[c]) return;
                    const nuevo = nuevoPara(equipo, modoEq, c, invitados);
                    if (!nuevo) return;
                    // Sólo si el código nuevo es de la plantilla (el jugador existe) y
                    // nadie de la asistencia lo usa ya: si no, no se sabe de quién es.
                    if (!enPlantilla.has(nuevo) || extra.includes(nuevo)) { conflicto = 'asistencia con ' + c + ' → ' + nuevo + ' ambiguo'; return; }
                    mapa[c] = nuevo;
                });
            }
            if (!Object.keys(mapa).length) continue;
            const e = { club, equipo, mapa, writes: [], resumen: [] };
            e.resumen.push('invitados que conservan su código: ' + invitados.size);
            if (conflicto) { avisos.push(equipo + ': ' + conflicto + ' — equipo NO migrado'); continue; }
            // La plantilla sólo se escribe si cambia (puede estar ya bien y faltar la asistencia).
            if (enPlantillaCambian) {
                e.writes.push({ update: { name: r.name, fields: f }, currentDocument: { updateTime: r.updateTime } });
                e.resumen.push('plantilla: ' + enPlantillaCambian + ' códigos');
            } else {
                e.resumen.push('plantilla: ya correcta, no se toca');
            }

            for (const a of asis.filter((d) => str(d.fields.teamId) === equipo || idDe(d).startsWith(equipo + '__'))) {
                const af = JSON.parse(JSON.stringify(a.fields));
                let n = 0;
                const dias = (af.marks && af.marks.mapValue && af.marks.mapValue.fields) || {};
                for (const dia of Object.keys(dias)) {
                    const m = (dias[dia].mapValue && dias[dia].mapValue.fields) || {};
                    for (const k of Object.keys(m)) {
                        if (!mapa[k]) continue;
                        if (m[mapa[k]] && !mapa[mapa[k]]) { conflicto = 'asistencia ' + idDe(a) + ' ya tiene ' + mapa[k]; }
                    }
                    const nuevo = {};
                    for (const k of Object.keys(m)) { nuevo[mapa[k] || k] = m[k]; if (mapa[k]) n++; }
                    dias[dia].mapValue.fields = nuevo;
                }
                if (n) { e.writes.push({ update: { name: a.name, fields: af }, currentDocument: { updateTime: a.updateTime } });
                         e.resumen.push('asistencia ' + idDe(a).split('__').pop() + ': ' + n + ' marcas'); }
            }
            let nf = 0;
            for (const fp of fichas.filter((d) => idDe(d).startsWith(equipo + '__'))) {
                const viejo = idDe(fp).slice(equipo.length + 2);
                if (!mapa[viejo]) continue;
                const nuevoId = equipo + '__' + mapa[viejo];
                if (fichas.some((d) => idDe(d) === nuevoId) && !mapa[mapa[viejo]]) { conflicto = 'ya existe la ficha ' + nuevoId; continue; }
                const ff = JSON.parse(JSON.stringify(fp.fields)); ff.ficha = { stringValue: mapa[viejo] };
                e.writes.push({ update: { name: NOMBRE(`clubs/${club}/attendance_players/${nuevoId}`), fields: ff }, currentDocument: { exists: false } });
                e.writes.push({ delete: fp.name, currentDocument: { updateTime: fp.updateTime } });
                nf++;
            }
            if (nf) e.resumen.push('fichas de asistencia: ' + nf);

            // La copia de un entrenador puede tener VARIOS equipos a migrar (la de
            // José: Regional A y B). Se modifica aquí y se escribe UNA vez al final.
            for (const c of copias) {
                const eq = c.raiz.porEquipo[equipo];
                if (!eq) continue;
                let n = 0;
                for (const modo of ['f7', 'f11']) {
                    (Array.isArray(eq[modo]) ? eq[modo] : []).forEach((p, i) => {
                        if (!p || i >= FILAS_BASE[modo] || p.isGuest || p.isSupport) return;
                        // Las filas VACÍAS no están en team_rosters (es compacta):
                        // se les aplica la misma regla, para que la copia quede entera.
                        const nv = mapa[p.id] || nuevoPara(equipo, modo, String(p.id || ''), invitados);
                        if (nv && nv !== p.id) { p.id = nv; n++; }
                    });
                }
                if (!n) continue;
                c.tocada = true;
                e.resumen.push('copia de ' + str(c.u.fields.email) + ': ' + n);
            }
            if (conflicto) { avisos.push(equipo + ': ' + conflicto + ' — MIGRACIÓN ABORTADA'); throw new Error('Conflicto en ' + equipo + ': ' + conflicto); }
            equipos.push(e);
        }
    }

    for (const c of copias) {
        if (!c.tocada || c.escrita) continue;
        c.escrita = true;
        copiasEscritas.push({ email: str(c.u.fields.email), write: {
            update: { name: c.main.name, fields: { cronos_master_roster: { stringValue: JSON.stringify(c.raiz) } } },
            updateMask: { fieldPaths: ['cronos_master_roster'] }, currentDocument: { updateTime: c.main.updateTime } } });
    }

    // Vínculos de familia sin equipo
    const vinculos = [];
    for (const l of (await listar('cronos_player_links')).filter((x) => !SOLO || str((x.fields || {}).clubId) === SOLO)) {
        const lf = l.fields || {};
        if (str(lf.teamId)) continue;
        const club = str(lf.clubId), dorsal = str(lf.playerNumber) || String((lf.playerNumber || {}).integerValue || '');
        const u = users.find((x) => idDe(x) === str(lf.parentUid));
        const roles = u && u.fields.allRoles && u.fields.allRoles.arrayValue ? (u.fields.allRoles.arrayValue.values || []) : [];
        const plazas = roles.map((v) => (v.mapValue || {}).fields || {}).filter((r) =>
            ['parent', 'parent_individual'].includes(str(r.role)) && (str(r.clubId) === club || str(r.individualEntityId) === club) && str(r.status) !== 'removed');
        let p = null;
        if (plazas.length === 1) p = plazas[0];
        else { const dd = plazas.filter((r) => str(r.playerNumber) === dorsal || str(r.inviteCode).replace(/^J-?/i, '') === dorsal); if (dd.length === 1) p = dd[0]; }
        if (!p || !str(p.category)) { avisos.push('vínculo ' + idDe(l) + ': su familia no tiene plaza que diga su equipo — se queda SIN equipo (no recibirá informes hasta volver a vincularse)'); continue; }
        const teamId = SB.tid(club, str(p.category), str(p.subcategory));
        vinculos.push({ id: idDe(l), teamId, write: { update: { name: l.name, fields: {
            teamId: { stringValue: teamId }, category: { stringValue: str(p.category) }, subcategory: { stringValue: str(p.subcategory) } } },
            updateMask: { fieldPaths: ['teamId', 'category', 'subcategory'] }, currentDocument: { updateTime: l.updateTime } } });
    }
    return { equipos, vinculos, avisos, copiasEscritas };
}

(async () => {
    await token();
    console.log('\n🆔 Migración v764 · proyecto ' + PROYECTO + (SOLO ? ' · SÓLO ' + SOLO : ' · TODAS las entidades') +
                (ESCRIBIR ? ' · ESCRIBE' : ' · SIMULACIÓN (sólo lectura)'));
    const plan = await planificar();
    // 🔑 JSON CANÓNICO (claves ordenadas). La API REST devuelve las claves de
    // los mapas en un orden distinto en cada lectura (las marcas de asistencia,
    // `requestedQuotas`…): con JSON.stringify a secas, la huella cambiaba sin
    // que cambiara ningún dato y la escritura se negaba siempre (2026-09-25).
    const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v))
        ? Object.keys(v).sort().reduce((o, kk) => { o[kk] = v[kk]; return o; }, {}) : v);
    const huella = crypto.createHash('sha256').update(canon({
        equipos: plan.equipos.map((e) => ({ equipo: e.equipo, mapa: e.mapa, writes: e.writes })),
        copias: plan.copiasEscritas.map((c) => c.write), vinculos: plan.vinculos.map((v) => v.write), avisos: plan.avisos,
    })).digest('hex').slice(0, 16);

    for (const e of plan.equipos) {
        console.log('\n▸ ' + e.equipo);
        const pares = Object.entries(e.mapa);
        console.log('   códigos: ' + pares.slice(0, 3).map(([a, b]) => a + '→' + b).join(', ') + (pares.length > 3 ? ', … (' + pares.length + ')' : ''));
        e.resumen.forEach((r) => console.log('   · ' + r));
        console.log('   escrituras de este equipo: ' + e.writes.length);
    }
    plan.copiasEscritas.forEach((c) => console.log('\n▸ copia de la plantilla de ' + c.email + ' (1 escritura con todos sus equipos)'));
    plan.vinculos.forEach((v) => console.log('\n▸ vínculo ' + v.id + ' → equipo ' + v.teamId));
    plan.avisos.forEach((a) => console.log('\n⚠️ ' + a));
    const total = plan.equipos.reduce((s, e) => s + e.writes.length, 0) + plan.copiasEscritas.length + plan.vinculos.length;
    console.log('\nTOTAL: ' + plan.equipos.length + ' equipos, ' + plan.vinculos.length + ' vínculos, ' + total + ' escrituras · HUELLA ' + huella);

    if (!ESCRIBIR) { console.log('SIMULACIÓN: no se ha escrito nada. Para aplicarlo: --escribir --huella=' + huella); return; }
    if (HUELLA_PEDIDA !== huella) { console.log('❌ La huella no coincide (' + HUELLA_PEDIDA + ' ≠ ' + huella + '): los datos cambiaron o no es el plan revisado. No se escribe nada.'); process.exit(1); }
    if (SOLO) {
        const fuera = [].concat(...plan.equipos.map((e) => e.writes)).filter((w) => !JSON.stringify(w.update ? w.update.name : w.delete).includes(SOLO));
        if (fuera.length) { console.log('❌ ' + fuera.length + ' escrituras de equipo fuera de ' + SOLO + ': no se escribe nada.'); process.exit(1); }
    }
    // 🔑 UN SOLO COMMIT ATÓMICO: o se aplica toda la migración o nada.
    const writes = [].concat(...plan.equipos.map((e) => e.writes), plan.copiasEscritas.map((c) => c.write), plan.vinculos.map((v) => v.write));
    const r = await http(BASE + ':commit', 'POST', { writes }, TOK);
    console.log(r.s === 200 ? '✅ Migración aplicada: ' + writes.length + ' escrituras en un commit atómico.' : '❌ Commit rechazado (NO se ha aplicado nada): ' + r.t.slice(0, 300));
    if (r.s !== 200) process.exit(1);
})().catch((e) => { console.error('❌ ' + e.message); process.exit(1); });
