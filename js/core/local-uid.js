// ══════════════════════════════════════════════════════════════════════
//  🔐 v720 · LOS DATOS LOCALES, AISLADOS POR USUARIO
//  js/core/local-uid.js
// ══════════════════════════════════════════════════════════════════════
//  Encargo del autor (implementar.txt 2026-09-15, capturas 10438-10440):
//  «si se inician sesión con diferentes correos en distintas pestañas del
//  mismo navegador, deben convivir y operar simultáneamente sin bloqueos»,
//  y el requisito técnico: «eliminar el bloqueo global por localStorage a
//  nivel de navegador y acotar el control de exclusividad exclusivamente al
//  nivel estricto del partido en curso».
//
//  Él eligió, sobre las dos opciones que se le plantearon: **aislar por uid
//  en vez de borrar**.
//
//  📏 QUÉ HABÍA MEDIDO ANTES DE ESCRIBIR ESTO
//  ─────────────────────────────────────────────────────────────────────
//  1 · La sesión YA ES POR PESTAÑA desde v638 (`browserSessionPersistence`,
//      que vive en `sessionStorage`). O sea que dos pestañas con dos correos
//      distintos ya eran posibles a nivel de Firebase Auth, y el aviso que
//      él fotografió —«sólo se puede tener una sesión por navegador»— es
//      TEXTO OBSOLETO de v570 que sobrevivió a v638. Se corrige aparte.
//
//  2 · 🔴 LO QUE SÍ LAS ROMPÍA ERA NUESTRO: `cronos_owner_uid`. Al entrar un
//      uid distinto del «propietario» del navegador,
//      `_purgeStaleLocalDataIfNeeded` BARRÍA TODAS las claves `cronos_*` —y
//      ahí viven la ranura del partido EN VIVO de la otra pestaña, las
//      plantillas (`cronos_teams`), las convocatorias, las planificaciones y
//      los partidos terminados, que NO se restauran de Firestore—. No era un
//      bloqueo: era destrucción cruzada entre pestañas.
//
//  🔑 LA SOLUCIÓN, Y POR QUÉ ASÍ
//  ─────────────────────────────────────────────────────────────────────
//  Cada usuario escribe y lee en SU espacio: la clave lógica `cronos_teams`
//  se guarda de verdad como `cronos_teams@<uid>`. Dos cuentas en dos pestañas
//  no se ven ni se pisan, y **nadie pierde nada** (que es la diferencia con
//  purgar). La privacidad se mantiene sin borrar: la cuenta B no puede leer
//  las plantillas de A porque su clave no existe en el espacio de B.
//
//  ⚠️ EL UID VA COMO SUFIJO, no como prefijo, Y NO ES CAPRICHO. Hay código
//  que busca por prefijo (`startsWith('cronos_active_match_v2::')`, las
//  ranuras de partido de v465). Con el uid delante, esas búsquedas dejarían
//  de encontrar nada; detrás, siguen funcionando igual.
//
//  ⚠️ SE ENVUELVE `localStorage` EN VEZ DE TOCAR LOS 67 ACCESOS. Medido:
//  67 llamadas en 26 ficheros. Reescribirlas una a una es la vía segura de
//  olvidarse de tres. Envolviendo `getItem`/`setItem`/`removeItem` el cambio
//  es invisible para todas, y los ÚNICOS sitios que hay que tocar a mano son
//  los 5 que ENUMERAN el almacén (`Object.keys(localStorage)`), porque esos
//  ven la clave real y tienen que pasar por `cronosClavesLocales`.
//
//  ⚠️ LO QUE NO SE AÍSLA, a propósito: la lista blanca de claves DEL
//  DISPOSITIVO (preferencia de mute, banner de instalación, tutorial visto,
//  la orden de limpiar la caché…). No son de nadie y aislarlas haría que el
//  banner reapareciera con cada cuenta.
//
//  ⚠️ Y ANTES DE QUE HAYA SESIÓN no se aísla nada: sin uid no hay espacio al
//  que ir. Lo que se escriba entonces queda en la clave lógica y lo adopta la
//  migración en cuanto se sepa quién es (ver `cronosMigraClavesLocales`).
//
//  Cubierto por scripts/test_datos_locales_por_uid.js.
// ══════════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // El separador. MEDIDO antes de elegirlo: se inventariaron las 24 claves
    // lógicas `cronos_*` que la app escribe (y las cuatro que se componen en
    // caliente, `cronos_reports_sent_<matchId>`, `cronos_<prefijo>_preselection`,
    // `cronos_active_match_v2::<id>` y `cronos_pr::<id>`) y NINGUNA contiene
    // '@': son `[A-Za-z0-9_:.-]`. Y el uid de Firebase tampoco lo lleva.
    // Además se parte por el ÚLTIMO '@' (el uid se añade al final), así que
    // aunque algún día una clave lleve un correo dentro, lo que escribamos
    // nosotros seguirá leyéndose bien.
    var SEP = '@';

    // Las claves del DISPOSITIVO, que no pertenecen a ningún usuario. Es la
    // misma lista que ya usaba la purga (firestore-storage.js) y se lee de
    // allí si está cargada, para no tener dos verdades.
    var _PROPIAS_DEL_DISPOSITIVO = [
        'cronos_owner_uid',
        'cronos_install_shown',
        'cronos_live_muted',
        'cronos_tutorial_done',
        'cronos_post_update',
        'cronos_pending_cache_clear',
    ];
    function _esDelDispositivo(clave) {
        var lista = (window._CRONOS_LOCAL_KEEP_KEYS &&
                     typeof window._CRONOS_LOCAL_KEEP_KEYS.has === 'function')
                  ? window._CRONOS_LOCAL_KEEP_KEYS : null;
        if (lista) return lista.has(clave);
        return _PROPIAS_DEL_DISPOSITIVO.indexOf(clave) >= 0;
    }

    function _uid() {
        try {
            var u = window._cronosCurrentUser;
            if (u && u.uid) return String(u.uid);
            // Respaldo: el usuario de Firebase Auth, que existe antes de que
            // el perfil esté cargado.
            var fa = window._cronos_auth;
            if (fa && fa.auth && fa.auth.currentUser && fa.auth.currentUser.uid) {
                return String(fa.auth.currentUser.uid);
            }
        } catch (e) {}
        return '';
    }

    // ¿Esta clave lógica se aísla? Sólo las `cronos_*` que no sean del
    // dispositivo, y sólo cuando ya sabemos de quién es la sesión.
    function _seAisla(clave) {
        if (typeof clave !== 'string' || clave.indexOf('cronos_') !== 0) return false;
        if (_esDelDispositivo(clave)) return false;
        if (clave.indexOf(SEP) >= 0) return false;   // ya viene con dueño
        return !!_uid();
    }

    // cronosClaveLocal('cronos_teams') → 'cronos_teams@<uid>'
    function cronosClaveLocal(clave) {
        return _seAisla(clave) ? (clave + SEP + _uid()) : clave;
    }

    // Enumera las claves DEL USUARIO EN SESIÓN y las devuelve con su nombre
    // LÓGICO (sin el sufijo), que es lo que esperan los `getItem` de siempre.
    // Con `prefijo`, filtra por él. Incluye las heredadas sin dueño: así un
    // navegador a medio migrar sigue encontrando su partido en curso.
    function cronosClavesLocales(prefijo) {
        var salida = [];
        var pre = prefijo || '';
        var uid = _uid();
        var todas = [];
        try { todas = Object.keys(localStorage); } catch (e) { return salida; }
        for (var i = 0; i < todas.length; i++) {
            var real = todas[i];
            if (real.indexOf('cronos_') !== 0) continue;
            var corte = real.lastIndexOf(SEP);
            var logica, dueño;
            if (corte >= 0) { logica = real.slice(0, corte); dueño = real.slice(corte + 1); }
            else            { logica = real; dueño = ''; }
            // De otro usuario: no existe para mí.
            if (dueño && uid && dueño !== uid) continue;
            if (dueño && !uid) continue;
            if (pre && logica.indexOf(pre) !== 0) continue;
            if (salida.indexOf(logica) < 0) salida.push(logica);
        }
        return salida;
    }

    // ── La envoltura ────────────────────────────────────────────────
    //  ⚠️ Se guarda el original y se llama SIEMPRE a través de él: si otro
    //  módulo volviera a envolver, esto no se dispararía dos veces.
    if (!window._cronosLocalOriginal) {
        var proto = window.Storage && window.Storage.prototype;
        if (proto && typeof proto.getItem === 'function') {
            window._cronosLocalOriginal = {
                getItem:    proto.getItem,
                setItem:    proto.setItem,
                removeItem: proto.removeItem,
            };
            var O = window._cronosLocalOriginal;
            // ⚠️ SÓLO SE TOCA `localStorage`. `sessionStorage` comparte el
            // prototipo `Storage`, y ahí NO hace falta aislar: ya es por
            // pestaña (es donde vive la sesión desde v638, y la ranura de
            // pestaña de v465). Por eso cada método comprueba `this`.
            proto.getItem = function (clave) {
                if (this === window.localStorage) {
                    var real = cronosClaveLocal(clave);
                    var v = O.getItem.call(this, real);
                    // Respaldo de migración: si aún no está en mi espacio pero
                    // existe la heredada sin dueño, se devuelve esa. Así el
                    // primer arranque tras la actualización no pierde nada
                    // aunque la migración no haya corrido todavía.
                    if (v === null && real !== clave) v = O.getItem.call(this, clave);
                    return v;
                }
                return O.getItem.call(this, clave);
            };
            proto.setItem = function (clave, valor) {
                if (this === window.localStorage) {
                    return O.setItem.call(this, cronosClaveLocal(clave), valor);
                }
                return O.setItem.call(this, clave, valor);
            };
            proto.removeItem = function (clave) {
                if (this === window.localStorage) {
                    var real = cronosClaveLocal(clave);
                    O.removeItem.call(this, real);
                    // Y la heredada, si quedaba: borrar significa borrar.
                    if (real !== clave) O.removeItem.call(this, clave);
                    return;
                }
                return O.removeItem.call(this, clave);
            };
        }
    }

    // ── Migración ───────────────────────────────────────────────────
    //  Se llama en cuanto se sabe quién ha entrado. Mueve las claves
    //  heredadas (sin dueño) al espacio de SU dueño de verdad:
    //    · si el navegador tenía un propietario anterior (`cronos_owner_uid`)
    //      y NO es el que entra, se guardan a nombre de AQUÉL — no se borran
    //      ni se le regalan al recién llegado;
    //    · si no había propietario, o es el mismo, son del que entra.
    //  Es idempotente: lo ya migrado no lleva el sufijo dos veces.
    function cronosMigraClavesLocales(uidEntrante) {
        var uid = String(uidEntrante || _uid() || '');
        if (!uid) return { movidas: 0, dueño: '' };
        var O = window._cronosLocalOriginal;
        if (!O) return { movidas: 0, dueño: uid };
        var anterior = '';
        try { anterior = O.getItem.call(localStorage, 'cronos_owner_uid') || ''; } catch (e) {}
        var dueño = (anterior && anterior !== uid) ? anterior : uid;
        var movidas = 0, nombres = [];
        var todas = [];
        try { todas = Object.keys(localStorage); } catch (e) { return { movidas: 0, dueño: dueño }; }
        for (var i = 0; i < todas.length; i++) {
            var clave = todas[i];
            if (clave.indexOf('cronos_') !== 0) continue;
            if (clave.indexOf(SEP) >= 0) continue;       // ya tiene dueño
            if (_esDelDispositivo(clave)) continue;      // no es de nadie
            try {
                var valor = O.getItem.call(localStorage, clave);
                if (valor === null) continue;
                O.setItem.call(localStorage, clave + SEP + dueño, valor);
                O.removeItem.call(localStorage, clave);
                movidas++;
                if (nombres.length < 12) nombres.push(clave);
            } catch (e) { /* una clave que no se puede mover no tumba el arranque */ }
        }
        try { O.setItem.call(localStorage, 'cronos_owner_uid', uid); } catch (e) {}
        if (movidas) {
            console.log('[v720] Datos locales aislados por usuario: ' + movidas +
                        ' clave(s) asignadas a ' + (dueño === uid ? 'la sesión actual' : 'su dueño anterior') +
                        '.', nombres);
        }
        return { movidas: movidas, dueño: dueño };
    }

    // Cuántas claves tiene un usuario (para el guard y para diagnosticar).
    function cronosClavesDeUsuario(uid) {
        var O = window._cronosLocalOriginal;
        var todas = [];
        try { todas = Object.keys(localStorage); } catch (e) { return []; }
        var suf = SEP + String(uid || '');
        return todas.filter(function (k) {
            return k.indexOf('cronos_') === 0 && k.slice(-suf.length) === suf;
        });
    }

    window.cronosClaveLocal          = cronosClaveLocal;
    window.cronosClavesLocales       = cronosClavesLocales;
    window.cronosMigraClavesLocales  = cronosMigraClavesLocales;
    window.cronosClavesDeUsuario     = cronosClavesDeUsuario;
    window.CRONOS_LOCAL_SEP          = SEP;
})();
