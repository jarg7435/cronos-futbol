// ─────────────────────────────────────────────────────────────
//  CRONOS FUTBOL - Service Worker v229
//  v455: VARIOS PARTIDOS A LA VEZ + EL NEGRO DEL MOVIL. Tres incidencias de las
//        pruebas reales con un F7 y un Juvenil en curso.
//        A) LAS TARJETAS BAILABAN. La lista se ordenaba por `updatedAt`
//           descendente, y pushLiveSnapshot reescribe ese campo CADA 5 SEGUNDOS
//           en todos los partidos activos: el que acababa de latir saltaba al
//           primer puesto y era imposible pulsar el que uno queria. El
//           documento NO guarda hora de inicio, asi que se ordena por lo que NO
//           cambia durante el partido — categoria, subcategoria, modalidad y
//           equipo local— con el id de desempate para que el orden sea TOTAL.
//        B) LOS AVISOS SE QUEDABAN PEGADOS AL ULTIMO PARTIDO ABIERTO. El
//           watcher de fondo hacia `if (m.id !== currentMatchId) return;`
//           (v274). Aquello arreglaba un problema REAL —los sucesos de un
//           partido se colaban en el CAJON de otro— pero cortando por lo sano:
//           dejaba de procesar los demas partidos, asi que un gol en el otro
//           campo NO se anunciaba JAMAS.
//           🔑 La separacion correcta no es "procesar o no procesar", es POR
//           DESTINO, y ya se puede hacer porque el aviso dice de que partido es
//           (.et-match, v449): AVISO FLOTANTE global para todos los partidos
//           seguidos, CAJON DE HISTORIAL solo para el que se esta viendo. Lo
//           decide showEventToast con el matchId que ahora recibe.
//           ⚠️ Y el respaldo que deduce el equipo por `lastSnapshot` solo se usa
//           si el suceso es del partido VISIBLE: en uno de fondo atribuiria el
//           gol al equipo equivocado. Ahi se prefiere no decir nada (v439).
//        C) 🔴 PANTALLA EN NEGRO EN EL MOVIL (en iPad no se veia). Causa
//           EXACTA: `checkUserAccess` escribia su error en #auth-error… que
//           vive DENTRO de #auth-overlay, y ese overlay estaba en display:none.
//           Como la pantalla de arranque ya se habia ocultado
//           INCONDICIONALMENTE y el resto de vistas siguen ocultas hasta
//           conceder el acceso, cualquier fallo dejaba la pagina COMPLETAMENTE
//           NEGRA, sin mensaje y sin salida. En el iPad la lectura de Firestore
//           iba bien y el agujero no se veia; en el movil fallaba y quedaba al
//           descubierto. No era el Service Worker: si lo fuera, habria fallado
//           en los dos.
//           Ahora todo fallo de acceso ENSEÑA el overlay con un mensaje legible
//           y un boton de reintento, el observador de sesion tiene su propio
//           catch, y hay una red de seguridad final: si a los 6 s NINGUNA vista
//           esta visible, se muestra el aviso. Una pantalla en negro delante de
//           un cliente no puede volver a ocurrir en silencio.
//        Guard nuevo scripts/test_live_multipartido.js 23/23, red-check de 7
//        mutaciones con las 7 cazadas. Se INVIERTE la asercion 5a de
//        test_live_event_dedup.js (fijaba el filtro de v274) y se actualizan
//        dos de test_sucesos_equipo_hora.js por el cambio de firma.
//        Suite 103/103 activos + 11 xfail.
//  v454: 🔴 EL SERVICE WORKER DEJA DE TOCAR EL SDK DE FIREBASE + PURGA TOTAL.
//        El bloqueo del panel en vivo PERSISTIA en movil y en iPad despues de
//        v453, y eso descarto el diagnostico inicial: v453 hizo IMPOSIBLE el
//        TypeError, asi que la causa ya no podia ser esa.
//        🔑 LA CAUSA REAL, y es de v447: `live.html` importa el SDK con
//        `import` ESTATICOS en la cabecera de su modulo. Si UNA sola de esas
//        peticiones no devuelve JavaScript valido, el modulo ENTERO no se
//        evalua y la pagina se queda EN BLANCO, sin mensaje. v453 solo cambio
//        el sintoma: donde habia un TypeError paso a haber un 504 fabricado por
//        nosotros, y el import seguia fallando igual.
//        CURA: se REVIERTE la "Pieza D" de v447. El SW ya no intercepta
//        gstatic (pasa a _esCanalVivo) ni lo precachea. Lo sirve el navegador,
//        que es como funciono el proyecto hasta v447 y como debe ser:
//        ⚠️ interceptar peticiones de OTRO ORIGEN que alimentan `import` de
//        modulos es asumir una responsabilidad que no nos corresponde.
//        Coste asumido: sin cobertura y con el cache HTTP vacio, la app no
//        arranca. Escenario poco frecuente y RECUPERABLE; una pantalla en
//        negro al abrir el panel en vivo no lo es.
//        PURGA TOTAL DE UN SOLO USO (PURGA_TOTAL): los dispositivos arrastraban
//        entradas envenenadas DENTRO de la cache vigente, asi que borrar solo
//        "las que no son la actual" no bastaba. Con el sello nuevo se borran
//        TODAS —salvo `cronos-meta`, que guarda el propio sello— y se repuebla
//        el shell acto seguido. Es un martillo: solo se sube ante sospecha de
//        cache corrupta en dispositivos reales.
//        AUTOCURACION EN EL CLIENTE (live.html): un vigilante en script
//        CLASICO, ANTES del modulo para que sobreviva a su muerte. Si a los 8 s
//        la vista no ha dado senyal de vida, borra todas las caches, da de baja
//        el Service Worker y recarga. 🔑 UNA SOLA VEZ, marcado en
//        sessionStorage: sin esa marca, una pagina que no arranque por un
//        motivo AJENO a la cache entraria en un bucle infinito de recargas, que
//        es peor que la pantalla en blanco.
//        Ademas: `install` ya no puede fallar por un recurso de otro origen —
//        un install que falla deja mandando al Service Worker VIEJO.
//        ⚠️ Se INVIERTEN las aserciones de la Parte 6 de
//        test_offline_resilience.js y los casos del SDK de
//        test_sw_respuesta_garantizada.js: fijaban la Pieza D, que es
//        justamente lo que rompio la aplicacion. Se invierten, no se borran
//        (mismo criterio que los cuatro guards de v440).
//        Guards 28/28 y 43/43. Suite 102/102 activos + 11 xfail.
//  v453: 🔴 FIX CRITICO — "TypeError: Failed to convert value to 'Response'" y
//        live.html EN NEGRO, con Ctrl+Shift+R obligatorio. Reportado en
//        produccion la vispera de una demostracion.
//        CAUSA EXACTA: `event.respondWith()` EXIGE una Response; si la promesa
//        que recibe resuelve a `undefined`, el navegador lanza ese TypeError y
//        la peticion MUERE — no cae al comportamiento por defecto, no se
//        reintenta, simplemente no hay respuesta. Y `caches.match()` resuelve a
//        `undefined` cuando no hay coincidencia: NO rechaza. El `.catch` de la
//        rama cache-first terminaba en `return caches.match(request)`, asi que
//        un recurso NO CACHEADO cuya red fallara respondia `undefined`.
//        ⚠️ POR QUE SE VOLVIO CRITICO EN v447 Y NO ANTES: hasta entonces esa
//        rama solo servia iconos y fuentes, donde fallar es cosmetico. En v447
//        se metio ahi el SDK de Firebase (gstatic) para que la app arrancase
//        sin cobertura. Desde ese momento, un tropiezo de red sobre
//        firebase-app.js tumbaba el `import` del modulo y live.html se quedaba
//        EN NEGRO, porque su contenido entero lo pinta ese modulo.
//        CURA, en dos capas redundantes a proposito:
//          · las dos estrategias pasan a ser funciones async con su PROPIO
//            ultimo recurso, que siempre construye una Response de verdad;
//          · y ademas todo pasa por `_respuestaGarantizada`, que sustituye por
//            una Response cualquier valor que no lo sea. Con eso el TypeError
//            es ESTRUCTURALMENTE IMPOSIBLE. (El red-check lo confirma: hay que
//            quitar las DOS capas para que el guard se ponga rojo.)
//        Y para que nadie tenga que refrescar a mano: en `activate`, la purga
//        de caches antiguas YA NO PUEDE IMPEDIR EL CLAIM. Antes iban
//        encadenadas con `.then`, asi que un `caches.delete` fallido rechazaba
//        la promesa y `clients.claim()` no llegaba a ejecutarse: el SW nuevo
//        quedaba activo pero SIN controlar las pestanyas abiertas. Ahora el
//        claim se ejecuta pase lo que pase. Con skipWaiting() en install y el
//        `controllerchange` que ya recarga en index.html y live.html, la cadena
//        queda completa: version nueva -> activa al instante -> toma las
//        pestanyas -> se recargan solas.
//        ⚠️ TRAMPA PAGADA POR EL CAMINO: el comentario `/* ... */` que se
//        anyadio aqui dejo CIEGAS 1100 lineas a los guards. sw.js es el unico
//        fichero sin comentarios de bloque y su changelog contiene
//        `js/admin/superadmin/*` DENTRO de un comentario de linea (v390); los
//        limpiadores de comentarios quitaban los bloques ANTES que las lineas,
//        asi que ese `/*` abria un bloque que se comia todo hasta el primer
//        `*/` del fichero. Tumbo 9 aserciones de test_offline_resilience.js sin
//        que nada estuviera roto. Se corrige el ORDEN en los dos guards y aqui
//        no se usan comentarios de bloque.
//        Guard nuevo scripts/test_sw_respuesta_garantizada.js 22/22: monta un
//        `self` falso y DISPARA el evento fetch en los escenarios que importan.
//        Red-check de 4 mutaciones, las 4 cazadas.
//        Suite 102/102 activos + 11 xfail. Bump para forzar recarga.
//  v452: PUESTA A PUNTO PREVIA A LA DEMO. Auditoria global de v446-v451 y UN
//        arreglo real, el unico que la auditoria encontro con impacto para el
//        usuario:
//        🔑 EL ZOOM DE iOS AL TOCAR UN CAMPO. Safari amplia automaticamente al
//        enfocar un input con font-size < 16px, y al hacerlo descoloca la
//        pantalla y NO vuelve solo. v422 puso el antizoom SOLO en el redactor
//        de mensajeria (.um-input) y se quedaron fuera los demas — entre ellos
//        LOS DEL LOGIN, a 0.95rem = 15.2px. O sea que en un iPhone o un iPad la
//        PRIMERISIMA interaccion con la app (tocar el campo de email) daba un
//        salto de zoom. Ahora suben a 16px todos los input de texto, select y
//        textarea en punteros gruesos.
//          · va por TIPO DE PUNTERO y no por ancho: un iPad en horizontal tiene
//            1024px y sigue siendo tactil;
//          · checkbox y radio quedan fuera (font-size no les afecta y solo
//            descolocaria su caja);
//          · el !important es obligatorio: esos campos se pintan con `style=""`
//            inline y a eso solo lo vence la hoja con !important (v422);
//          · 16px es el umbral EXACTO de iOS y no hay alternativa, porque
//            `user-scalable=no` se retiro a proposito en v200 por accesibilidad;
//          · la tabla de plantilla es densa: se compensa el alto de fila con
//            menos relleno para que la maqueta quede como en escritorio.
//        AUDITORIA (sin cambios de codigo, todo verde): precache del SW con sus
//        77 recursos existentes en disco —un solo 404 rechaza el addAll ENTERO
//        y dejaria la app sin precache—, los 81 scripts enlazados existen y van
//        con su ?v=, los 82 .js compilan, sin mojibake, los 7 bloques inline de
//        los HTML compilan, las 33 funciones invocadas desde onclick estan
//        declaradas, y produccion sirve BYTE A BYTE lo mismo que el disco en los
//        83 ficheros comprobados. Reglas de Firestore sin cambios locales desde
//        v438.
//        Se reescribe la asercion 1v de test_responsive_layout.js: saltaba con
//        `[^}]*` desde la cabecera del @media dando por hecho que .um-input era
//        la PRIMERA regla del bloque, asi que insertar algo delante la ponia
//        roja sin que nada estuviera mal. Ahora extrae el bloque balanceando
//        llaves. Guard 66 -> 70, red-check de 3 mutaciones, las 3 cazadas.
//        Suite 101/101 activos + 11 xfail. Bump para forzar recarga.
//  v451: RECUPERAR Y CAMBIAR LA CONTRASEÑA (implementar.txt).
//        1) "¿Has olvidado tu contraseña?" en el login -> sendPasswordResetEmail.
//        2) "Cambiar contraseña" con la sesion iniciada -> updatePassword.
//        Fichero nuevo js/services/auth/password.js, script CLASICO (no
//        modulo): tiene que publicar en window para los onclick del HTML, y
//        el ambito de un modulo ES no cuelga de window (trampa de v383). Por
//        eso las funciones de Firebase Auth se publican en _cronos_auth desde
//        firebase-init.js en vez de importarse alli donde se usan.
//        🔑 DOS DECISIONES DE SEGURIDAD:
//         · NO SE REVELA SI UN CORREO ESTA REGISTRADO.
//           sendPasswordResetEmail lanza 'auth/user-not-found' cuando la
//           cuenta no existe; contarlo convertiria el formulario en un
//           comprobador de altas y cualquiera podria averiguar que familias
//           estan en el club. Se responde EXACTAMENTE lo mismo exista o no.
//         · SE REAUTENTICA SIEMPRE ANTES DE CAMBIARLA, no solo cuando Firebase
//           lo exija. updatePassword unicamente pide sesion RECIENTE, asi que
//           recien iniciada dejaria cambiar la contraseña SIN pedir la actual:
//           un movil desbloqueado encima de la mesa bastaria para quedarse con
//           la cuenta. Pedir la actual y reautenticar lo cierra y, de paso,
//           hace imposible el 'requires-recent-login'.
//        La contraseña nueva pasa por validatePasswordStrength, LA MISMA del
//        registro: si aqui se aceptara una mas floja, este formulario seria la
//        puerta de atras para saltarse la politica del alta.
//        Entradas: el enlace del login va DENTRO de #login-pwd-section, que
//        switchTab ya oculta en modo registro (asi aparece y desaparece solo);
//        "Cambiar contraseña" va en el landing de roles —que ve TODO rol— y en
//        la cabecera del entrenador.
//        Guard nuevo scripts/test_password_recovery.js 35/35: no mira el texto,
//        PULSA los botones contra un Firebase falso y comprueba a que se llama
//        y en que orden. Red-check de 12 mutaciones, las 12 cazadas; destapo
//        ademas DOS fragilidades del propio guard (un `undefined.orden` que
//        cortaba la cadena de promesas y una excepcion sin capturar), porque
//        un guard que MUERE no informa.
//        Suite 101/101 activos + 11 xfail. Bump para forzar recarga.
//  v450: UNA LINEA POR PERSONA REAL — la regla del autor, matizada.
//        "Varias lineas SI, si son PERSONAS DISTINTAS (padre, madre,
//        entrenador, padres separados). Nunca dos lineas del MISMO
//        usuario/familiar."
//        ⚠️ LA DEDUPLICACION DE v449 SE QUEDABA CORTA, y no en teoria: cuatro
//        escenarios reales daban dos lineas del mismo familiar y el mismo hijo.
//        CAUSA: agrupaba PRIMERO por un codigo de hijo elegido con una cadena
//        de respaldos (`playerId || '#'+dorsal || nombre`) y solo comparaba
//        identidades DENTRO de ese grupo. Pero los cuatro origenes escriben el
//        hijo distinto para el MISMO niño:
//          · contact-manager.js  -> playerId: l.playerId || ('J' + dorsal)
//          · match-reports-send  -> playerId: l.playerId, crudo
//          · usuarios 'parent'   -> playerId: u.playerId || '', a menudo VACIO
//        'J-01', 'J1', el dorsal 1 y "Marcos" son el mismo hijo y caian en
//        grupos distintos, asi que las dos copias NUNCA se llegaban a comparar.
//        AHORA el algoritmo va al reves: manda la PERSONA y el hijo solo
//        SEPARA cuando se demuestra que son distintos.
//          🔑 El hijo aporta un CONJUNTO de alias (id, dorsal derivado de los
//             digitos —que es lo que 'J-01', 'J1' y el 1 comparten—, y nombre),
//             y los alias se ACUMULAN al fusionar. Sin acumularlos, una copia
//             sin dato de hijo que llegue la PRIMERA deja el cubo en blanco
//             para siempre y el hermano siguiente tampoco lo contradice: los
//             dos hijos acaban en la misma linea (lo destapo el red-check).
//          🔑 SEPARAR EXIGE CONTRADICCION, no simple ausencia de coincidencia:
//             dos codigos que no se solapan separan; si solo una de las dos
//             trae codigo, no hay contradiccion posible y se funden.
//          🔑 La identidad de la PERSONA admite el nombre como ultimo recurso
//             (una copia manual trae solo el telefono y otra solo el correo),
//             pero NUNCA si los identificadores fuertes se contradicen, ni si
//             el nombre es un relleno tipo "Padre/Tutor" — podrian ser el
//             padre y la madre del mismo hijo, cada uno con un dato.
//        SIGUE INTACTO lo que el autor confirmo expresamente: varias lineas
//        para personas DISTINTAS (padre, madre, entrenador, padres separados),
//        el mismo familiar con DOS hijos convocados, y quien es staff Y padre.
//        Guard test_avisos_y_destinatarios.js 32 -> 49. Red-check de 7
//        mutaciones, las 7 cazadas; destapo ademas DOS huecos de mis propias
//        pruebas (la acumulacion de alias segun el orden de llegada, y el
//        nombre frente a identificadores contradictorios).
//        Suite 100/100 activos + 11 xfail. Bump para forzar recarga.
//  v449: EL AVISO DICE DE QUE PARTIDO ES · UNA LINEA POR FAMILIAR.
//        Dos reportes del autor, independientes.
//        1) AVISOS FLOTANTES SIN PARTIDO. ⚠️ El dato NO faltaba: viajaba desde
//           v220 y se pintaba... en `.et-sub`, gris `--muted`, 0.72rem y en
//           SEGUNDA linea, debajo de un titulo que desde v445 empieza por el
//           chip del EQUIPO de la incidencia. Se leia "ARINAGA 7 · GOL ·
//           Pedro" y el encuentro pasaba desapercibido. Ahora encabeza el
//           aviso en `.et-match`, en color primario y a dos lineas si hace
//           falta (nunca cortado con puntos suspensivos: un nombre de equipo
//           recortado es justo el problema que se venia a resolver).
//           Ademas, respaldo: si un llamante olvidase la etiqueta se
//           reconstruye del ultimo snapshot; y si no hay de donde, NO SE
//           INVENTA (leccion de v439) — mejor sin linea que un "Local vs
//           Visitante" falso.
//        2) DESTINATARIOS DUPLICADOS AL TERMINAR EL PARTIDO. La lista se
//           compone de CUATRO origenes que no se conocen entre si
//           (emailConfig, staff real, cronos_player_links y usuarios con rol
//           parent) y las comprobaciones de "¿ya existe?" de cada uno fallaban
//           por dos motivos silenciosos:
//             🔑 el familiar SIN `parentUid` recibe como id el ID DEL
//                DOCUMENTO DEL VINCULO, asi que dos vinculos del mismo padre
//                dan dos ids distintos y no se reconocian;
//             🔑 cada origen compara por un campo distinto (uid / email /
//                phone): si una copia trae solo el correo y otra solo el
//                telefono, NINGUNA comparacion las une.
//           Helper nuevo `_cronosDedupeRecipients` (core/utils.js): dos
//           entradas son la misma persona si comparten CUALQUIER
//           identificador, y se FUSIONAN (la linea que queda se lleva el
//           correo, el telefono y el nombre mas completos).
//           ⚠️ LO QUE NO SE PUEDE "ARREGLAR" DE MAS: el codigo del jugador
//           forma parte de la identidad, asi que un padre con DOS hijos
//           convocados SIGUE viendo DOS lineas (son dos informes); y no se
//           funde entre roles, porque quien es staff Y padre recibe el
//           resumen global Y el individual de su hijo.
//           ⚠️ Y la preseleccion guardada se comprueba contra TODOS los ids
//           fusionados: si no, fusionar habria DESELECCIONADO en silencio a
//           destinatarios ya elegidos.
//        Guard nuevo scripts/test_avisos_y_destinatarios.js 32/32: pinta el
//        aviso y la lista de verdad, no mira el texto del codigo. Red-check de
//        11 mutaciones, las 11 cazadas — y tumbo TRES aserciones mias que
//        miraban solo si el nombre del helper aparecia (la misma clase de
//        asercion-que-defiende-el-bug de v417 y v447): reescritas para
//        EJECUTAR los dos constructores y contar las casillas.
//        Se reapunta la asercion 2e3 de test_live_view_cleanup.js, que fijaba
//        la FORMA antigua (`.et-sub`) de algo cuya intencion no cambia.
//        Suite 100/100 activos + 11 xfail. Bump para forzar recarga.
//  v448: EL BOTON SUPERIOR DE TIEMPO FUNCIONA TAMBIEN EN EL DESCANSO.
//        Reporte del autor: "REANUDAR va bien al pausar y reanudar un partido
//        en juego, pero se queda inactivo en el descanso y obliga a usar el
//        play pequeño de la 2a parte".
//        CAUSA: el boton colgaba DIRECTAMENTE de toggleGame(), que solo levanta
//        la bandera `isRunning` y programa el intervalo. Pero `tick()` unicamente
//        suma tiempo en '1st_half' y '2nd_half'. ⚠️ Y por eso desconcertaba
//        tanto: el boton NO estaba muerto —cambiaba a PAUSAR y arrancaba su
//        intervalo tan campante—, lo que no ocurria es que el CRONOMETRO
//        AVANZARA, porque la fase seguia siendo 'break'. Cero errores en consola.
//        AHORA el boton enruta por FASE: en 'break' llama a startSecondHalf(),
//        la MISMA funcion que el ▶️ pequeño, asi que el comportamiento es
//        identico (fase, "Entra (2ªP)" en los del campo, semilla de lastTickTime,
//        snapshot en vivo y guardado). En cualquier otra fase, nada cambia.
//        🔑 EL ENRUTADO VA EN EL MANEJADOR DEL CLIC, NO DENTRO DE toggleGame():
//        a esa funcion la llaman TAMBIEN la recuperacion de partido
//        (setup-modal.js, cuando el snapshot trae isRunning) y la propia
//        startSecondHalf(). Metiendolo dentro, retomar un partido guardado en
//        DESCANSO habria arrancado la 2a parte SOLO —escribiendo "Entra (2ªP)"
//        en el historial de cada jugador— y startSecondHalf se llamaria a si
//        misma. El guard tiene una prueba dedicada a eso.
//        Guard nuevo scripts/test_play_pause_universal.js 31/31: no mira el
//        texto, EJECUTA el clic en cada fase con el tick real. Red-check de 2
//        mutaciones (el codigo original y el atajo tentador), las 2 cazadas.
//        Suite 99/99 activos + 11 xfail. Bump para forzar recarga.
//  v447: LA APP SIN COBERTURA. Cuatro piezas, tras la pregunta del autor de
//        que pasa si se queda sin cobertura en el campo. La respuesta era
//        mala en tres frentes distintos y ninguno se veia desde la interfaz.
//        A) cloudSet escribia en localStorage DESPUES de `await setDoc`, y
//           setDoc no resuelve hasta que el SERVIDOR confirma: sin red se
//           queda pendiente PARA SIEMPRE, no lanza y no entra en el catch.
//           Guardar una plantilla sin cobertura no la guardaba en NINGUN
//           sitio, y team-persistence.js ya habia enseñado "✅ guardado".
//           Ahora local primero y la nube sin esperar el ACK (el SDK la
//           reenvia solo). ⚠️ Esto NO lo arregla la caché de la pieza B: la
//           promesa espera al servidor haya o no persistencia.
//        B) Firestore se creaba con getFirestore() a secas: caché SOLO EN
//           MEMORIA, que muere con la pestaña. Pasa a persistentLocalCache
//           con persistentMultipleTabManager -- el gestor multipestaña NO es
//           opcional: live.html se abre con window.open y es otro documento
//           con su propia instancia, asi que con el gestor de una sola
//           pestaña el segundo en arrancar se quedaba sin persistencia.
//           [Privacy] Las lecturas desde esa caché NO PASAN POR LAS REGLAS
//           (leccion de v199 en la capa nueva): se borra en los dos logout y
//           en el cambio de uid, enganchada al purgado de PII que ya existia.
//        C) Sin cobertura NO SE PODIA ENTRAR, y encima deslogueaba:
//           · getIdToken(true) fuerza ida al servidor -> signOut. Ahora el
//             refresco forzado solo con red (SEC-M01 intacto) y un fallo de
//             RED no cuesta la sesion;
//           · 🔑🔑 con caché en disco una lectura sin red NO LANZA, devuelve
//             un snapshot vacio marcado fromCache. `exists()` en false hacia
//             caer al usuario en la rama de "tu cuenta no esta registrada",
//             que cierra sesion. Guarda nueva (CASO 0);
//           · la misma trampa en la limpieza de roles huerfanos llegaba a
//             ESCRIBIR un allRoles recortado con lo poco que hubiera en
//             caché: perdida de roles permanente al volver la red;
//           · `await setDoc(lastLogin)` era la ultima linea antes de
//             enterApp(): sin cobertura no se entraba NUNCA, sin error.
//           SEC-M08 sigue en pie: nadie entra sin datos verificados, y al
//           recuperar la red se revalida contra el SERVIDOR y se expulsa si
//           la cuenta ya no vale.
//        D) El SW excluia gstatic.com, asi que los 4 modulos del SDK
//           dependian del caché HTTP del navegador: si lo soltaba, la app no
//           arrancaba sin red y B y C daban igual. Ahora se precachean en su
//           PROPIA lista (un addAll unico dejaria el shell sin cachear si
//           gstatic falla) y se sirven cache-first. googleapis.com sigue
//           excluido: ese es el canal vivo de Firestore.
//        Guard nuevo scripts/test_offline_resilience.js, visto ROJO antes
//        (33 fallos). Bump para forzar recarga.
//  v393: VUELVE LA LISTA DE PLANTILLAS GUARDADAS, con sus botones de borrado
//        y filtrada por modalidad. Tres archivos declaraban el mismo bloque de
//        persistencia y ganaba el que carga el ULTIMO, ai/import.js, con unas
//        copias FOSILES peores heredadas de cuando se llamaba 08_ai_import.js.
//        Lo que el usuario nota:
//          · los <div saved-teams-list-home|away> que pinta setup-modal.js
//            NUNCA se rellenaban -> los botones de borrado por plantilla no
//            existian. Ahora si;
//          · el desplegable ofrecia TODAS las plantillas, tambien las de otra
//            modalidad (en F7 salian las de F11). Ahora filtra;
//          · cargar una plantilla no pasaba por loadTeamData, asi que se
//            perdian la sincronizacion de CATEGORIA y la de _pendingSetupState
//            (que existe para evitar sobreescrituras). Ahora si pasa.
//        Medido ejecutando la cadena real con 3 plantillas (2 F7, 1 F11):
//        antes 0 filas y 3 opciones sin filtrar; despues 2 filas y 2 opciones.
//        Limpieza que lo acompanya: active-match.js 609 -> 125 lineas, se queda
//        SOLO con endMatch (es su unico duenyo); sus otras 11 funciones eran
//        copias que ya perdian, dos de ellas la version VIEJA de la pantalla de
//        post-partido. team-persistence.js es la fuente canonica del bloque.
//        ⚠️ `diff` decia que los dos archivos diferian entero: era la trampa
//        CRLF-vs-LF. Normalizando, 9 de 11 cuerpos eran identicos.
//        Equivalencia global con los 72 scripts: cambian EXACTAMENTE las 2
//        funciones buscadas, ni un global perdido ni uno nuevo.
//        Guard nuevo test_persistence_duplication.js 18/18, visto ROJO antes
//        (9 fallos). Suite 64/64 + 11 xfail.
//  v392: "Descargar TXT" de Mis Informes vuelve a descargar. No habia
//        descargado NUNCA nada: miDescargarInforme delegaba en
//        window.sdDownloadInforme, que vivia en js/23_staff_dashboard.js y
//        desaparecio al refactorizar ese archivo, asi que la guarda typeof no
//        se cumplia jamas y el boton salia siempre por el toast de "no
//        disponible". Ahora es autocontenido (ya tenia el informe en la mano,
//        el rodeo por window._sdMatches sobraba).
//        No se resucito la version antigua tal cual: imprimia m.teamName, un
//        campo que este objeto NO tiene, asi que habria puesto "Equipo"
//        siempre. Se usan los campos reales — competicion, categoria, campo,
//        hora y el historial de eventos con su minuto.
//        Dos arreglos de robustez del estilo de la casa: BOM al principio (sin
//        el, el Bloc de notas de Windows rompe los acentos) y adjuntar el <a>
//        al DOM antes del click (un a.click() suelto no descarga en Firefox).
//        El veredicto V/D/E usa la MISMA regla que la tarjeta en pantalla, con
//        el respaldo a 'home' para informes antiguos sin myTeamRole.
//        Test 78/78 visto ROJO antes (10 fallos). Suite 63/63 + 11 xfail.
//  v391: La pestanya "Config." pasa a ser exclusiva del DIRECTOR DEPORTIVO y
//        del SUPERADMIN. El COORDINADOR ya no la ve ni puede llegar a ella.
//        Antes no habia NINGUNA comprobacion de rol: el boton se pintaba
//        siempre y switchStaffTab enrutaba sin mirar nada.
//        Tres puertas con UNA sola funcion de permiso (_sdCanSeeConfigTab):
//        el boton, la ruta switchStaffTab('config') y la propia vista
//        _renderDirectorConfig (invocable suelta desde window). Una sola
//        funcion a proposito: si cada puerta lo calculase por su cuenta
//        podrian divergir.
//        ⚠️ Y LA OTRA MITAD, sin la cual esto seria cosmetico: el DIRECTOR NO
//        PODIA GUARDAR. La pestanya escribe en clubs/{clubId} y esa regla solo
//        admitia superadmin, club_admin e individual_admin, asi que la
//        pestanya se quedaba SIN DUENYO FUNCIONAL. Se anyade una rama acotada
//        (requiere desplegar tambien firestore:rules): el director de ESTE
//        club puede escribir SOLO categoryConfigs, timerThresholds y
//        features.sendIndividualReports. No reabre el agujero de v188: aquella
//        rama era abierta y permitia escalada cross-club; esta ata al director
//        a su club y deja fuera directorUids, coordinatorUids, adminUid, plan,
//        status, expiresAt y features.live_view (que gestiona el club_admin).
//        Test 40/40 visto ROJO antes (14 fallos). Suite 63/63 + 11 xfail.
//  v390: FASE D del monolito #5 — fuera el PANEL SUPERADMIN LEGACY v3.
//        app-init.js 2941 -> 1710 lineas. Acumulado A+B+C+D: 6407 -> 1710,
//        un 73% menos. 20 funciones (1172 lineas) + 3 alias + 23 lineas de
//        cabeceras que ya no encabezaban nada.
//          openSuperAdminPanel, saFS, saGet -> superadmin/superadmin.panel.js
//          saClubs                          -> superadmin/clubs-tab.js
//          saRequests                       -> superadmin/requests-tab.js
//          saSendPaymentEmail               -> billing/payments.js
//          y las 14 del panel legacy (saOverview, saOpenEditor, saIndividual,
//          saPayments, saNewClub y ayudantes) ELIMINADAS sin destino.
//        No se borraron por "no encontrarles consumidores": colgaban todas de
//        openSuperAdminPanel, muerta porque superadmin.panel.js la redeclara y
//        carga despues. Ademas openAdminPanel llamaba a openSuperAdminPanel()
//        por nombre pelado, o sea que incluso invocandolo se abria el panel
//        MODERNO. El panel vivo es el de js/admin/superadmin/*.
//        SOBREVIVEN saWrite, saOpenIndividualEditor y checkClubAccess, que si
//        tienen consumidores reales.
//        ⚠️ Trampa v378 POR TRIPLICADO: window.openAdminPanel,
//        window.openSuperAdminPanel y window.saSendPaymentEmail eran alias de
//        NIVEL SUPERIOR; dejarlos tras borrar sus funciones habria sido un
//        ReferenceError al cargar el primer script, o sea la app en blanco.
//        Borrado FUNCION A FUNCION: saWrite estaba entre saGetAll y saUpd, y
//        saOpenIndividualEditor entre saIndividual y saPayments — las vivas
//        intercaladas entre las muertas. Guard 45/45 visto ROJO antes;
//        equivalencia en runtime: 544 globales comunes sin un solo cambio y
//        los unicos que desaparecen son exactamente los 14.
//        Suite 62/62 + 11 xfail.
//  v389: FASE C del monolito #5 — app-init.js 3689 -> 2941 lineas. Otras 25
//        copias duplicadas MUERTAS fuera (773 lineas, 25 comentarios puntero
//        en su hueco). Acumulado A+B+C: 6407 -> 2941, un 54% menos.
//        Cada nombre queda con su fuente canonica:
//          pintado de plantilla y chips -> ui/render.js
//          arrastrar y soltar           -> ui/drag-drop.js
//          formaciones predefinidas     -> roster/formations.js
//          guardado de alineaciones     -> match/persistence/team-persistence.js
//          plantillas guardadas         -> ai/import.js
//          placeOnField                 -> roster/legacy-formations.js
//          injectBenchScrollButtons     -> ui/bench-scroll.js
//          logEvent                     -> match/events/movement-log.js
//        ⚠️ Esta vez SI aplicaba la trampa v378: el alias de nivel superior
//        window.updateCategoryOptions se ejecutaba al cargar el PRIMER script
//        de index.html, cuando formations.js aun no existe. Dejarlo tras
//        borrar la funcion habria sido un ReferenceError, o sea la app en
//        blanco. Se borro con la funcion; su consumidor real
//        (services/auth/role-launch.js) sigue servido porque la declaracion
//        clasica de formations.js ya publica la propiedad en el global.
//        Borrado FUNCION A FUNCION: entre las muertas sobreviven 6
//        declaraciones load-bearing (FIELD_MARGIN, touchData, lastTouchTime,
//        FORMATIONS, FORMATIONS_FULL, FORMATION_PRESETS) que ningun archivo
//        duenyo declara. Guard 33/33 visto ROJO antes; equivalencia en
//        runtime con los 72 scripts: las 25 resuelven a codigo byte-identico.
//        Suite 62/62 + 11 xfail.
//  v388: FASE B del monolito #5 — app-init.js 5203 -> 3689 lineas. Otras 41
//        copias duplicadas MUERTAS fuera (1539 lineas). Borrado puro, ninguna
//        linea modificada. Acumulado con la Fase A: 6407 -> 3689, un 42% menos.
//        Misma clase que la Fase A: codigo que nunca se ejecuta porque un
//        script POSTERIOR declara el mismo nombre y gana. Cada nombre queda ya
//        con UNA SOLA declaracion en toda la cadena:
//          nube + emailjs + SW    -> services/firestore-storage.js
//          transmision en vivo    -> match/live/sync.js
//          tutorial               -> match/demo-tutorial.js
//          acciones de jugador    -> match/events/player-actions.js
//          importacion, convocatoria e ir al partido -> ai/import.js
//        HUECO DEL INVENTARIO que encontro el propio guard: solo se buscaba
//        `function NOMBRE(` en columna 0 y no las publicadas como
//        `window.NOMBRE = function`. notifyAllLiveContacts era un duplicado de
//        esa segunda forma y se habia escapado.
//        La parte 4 del guard pasa a fijar 27 declaraciones de estado
//        compartido (antes 3). Estan INTERCALADAS entre las funciones muertas,
//        que es por que se borra funcion a funcion y nunca por rangos: un
//        borrado por rangos habria dejado un ReferenceError en produccion.
//        CERO cambio de comportamiento, medido: los 72 scripts clasicos
//        cargados dos veces, antes y despues, y las 41 funciones resuelven a
//        codigo BYTE-IDENTICO, con el mismo estado global.
//        Bump para forzar recarga.
//  v387: FASE A del monolito #5 — app-init.js 6285 -> 5203 lineas. Borrado
//        PURO de 30 funciones duplicadas MUERTAS (1107 lineas fuera, 25
//        comentarios puntero dentro). Ninguna linea modificada.
//        app-init.js no es un monolito que descomponer, es una CAPA FOSIL:
//        102 de sus 133 funciones estaban muertas porque un script POSTERIOR
//        declara el mismo nombre y gana (los scripts clasicos comparten el
//        ambito global y la ULTIMA declaracion de funcion es la que queda).
//        Los extractos de epocas anteriores se hicieron COPIANDO, no moviendo,
//        y app-init.js carga el primero, asi que su copia siempre perdia.
//        Lo peligroso era que 62 de esas copias han DIVERGIDO: app-init.js
//        guardaba versiones viejas de codigo que parecia vivo (su assignCard
//        tenia 88 lineas; la que se ejecuta, en player-actions.js, 158).
//        Fuera las cinco secciones con mas del 90% muerto: acciones de
//        jugador, entrenamiento semanal, cuerpo tecnico, importacion con IA y
//        envio de convocatoria. Cada una tiene ya un unico duenyo.
//        CERO cambio de comportamiento, medido y no supuesto: se cargan los 72
//        scripts clasicos en el orden real de index.html dos veces, con el
//        app-init.js de antes y el de despues, y las 30 funciones resuelven a
//        codigo BYTE-IDENTICO, con el mismo estado global.
//        Guard: scripts/test_app_init_dead_duplicates.js (24/24, visto rojo
//        antes). Se borra funcion a funcion y nunca por rangos: dentro de esas
//        secciones sobrevive estado load-bearing (activeActionPlayerId,
//        _tesseractLoaded) que otros archivos leen sin declararlo.
//        Bump para forzar recarga.
//  v386: FIX de staffConfig (cuerpo tecnico), sexto caso de la misma clase de
//        bug que v385 y encontrado por el guard que se anyadio alli.
//        app-init.js declaraba un `let staffConfig` y staff-and-comms.js creaba
//        ADEMAS un window.staffConfig. Como app-init.js carga el primero y una
//        declaracion lexica de nivel superior se resuelve ANTES que window,
//        todas las lecturas y escrituras por nombre pelado del archivo vivo
//        caian sobre el `let` y el objeto de window se quedaba VACIO PARA
//        SIEMPRE. Sin dano visible (el archivo vivo usa el nombre pelado de
//        punta a punta), pero era una mina: quien escribiera
//        window.staffConfig.coach1 leia el objeto vacio.
//        El duenyo pasa a ser staff-and-comms.js, que es quien lo lee y lo
//        escribe de verdad; app-init.js solo conserva un comentario puntero.
//        Prueba de regresion: parte 6 de test_admin_shared_constants.js, que
//        carga la CADENA REAL de los dos archivos y comprueba que son el mismo
//        objeto. Verificada ROJA sobre el codigo anterior.
//        Bump para forzar recarga.
//  v385: FIX de la tabla de roles del panel Admin de Club, que mostraba datos
//        erroneos en pantalla. Una declaracion lexica de nivel superior en un
//        script clasico no crea propiedad de window: vive en el registro
//        DECLARATIVO del ambito global, que se resuelve ANTES que window. Como
//        app-init.js es el PRIMER script de index.html, sus constantes
//        ensombrecian a las de admin-shared.js en toda lectura por nombre
//        pelado, y las dos tablas de roles coexistian con contenidos
//        distintos. club/panel.js mezcla las dos formas en el mismo archivo,
//        asi que se veia: el rol Entrenador con el emoji DUPLICADO, el rol
//        'parent' sin traducir (salia el codigo crudo en vez de "Padre /
//        Madre / Tutor"), las solicitudes de acceso degradadas a "Usuario" y
//        un literal "<span>undefined</span>" por cada usuario activo.
//        Las guardas `typeof window.X === 'undefined'` nunca saltaban: miran
//        window, que si existe, mientras las lecturas peladas cogian la const.
//        SA_CONFIG, ROLE_META, PLAN_META, STATUS_META y SA_CSS pasan a
//        js/shared/admin-shared.js como window.*; app-init.js solo conserva un
//        comentario puntero. SA_CSS se movio VERBATIM y no se sustituyo: las
//        dos versiones definen las mismas 18 clases pero con valores distintos
//        (.sa-modal 1060px frente a 860px), y la que se aplicaba de verdad era
//        la de app-init, asi que borrarla habria encogido en silencio los
//        paneles de Admin de Club y de Individual.
//        Guard permanente: scripts/test_admin_shared_constants.js (31/31),
//        visto ROJO antes del cambio. Barre todos los scripts clasicos en el
//        orden real de carga y prohibe la clase de bug entera.
//        Bump para forzar recarga.
//  v384: DOS correcciones de la auditoria 2026-07-22, ambas de datos que ve
//        el usuario final.
//        1) DURACION REGLAMENTARIA EN LOS INFORMES (report-engine.js). La
//        auditoria decia que prebenjamin salia a 50 min en vez de 40; al
//        medirlo contra el cronometro resulto que la tabla estaba mal en 5 de
//        las 7 categorias (benjamin -20, prebenjamin/alevin/infantil -10,
//        cadete +10) y que "arreglar" prebenjamin a 40 lo habria dejado a -20.
//        Duracion oficial = 2 x los minutos por tiempo: prebenjamin 60,
//        benjamin 70, alevin 70, infantil 80, cadete 80, juvenil 90,
//        regional 90. El margen del cronometro (+10 F7 / +15 F11) es
//        prolongacion y proteccion ante cortes, va aparte como +N'.
//        OJO: window.matchDuration no se asigna en ningun sitio, asi que esa
//        tabla se usa SIEMPRE; y no decide solo la escala del Gantt, sino los
//        minutos atribuidos a cada jugador. Los informes ya existentes pasan a
//        mostrar la duracion correcta (el Gantt se regenera al abrirlos; no se
//        reescribe nada en Firestore).
//        2) VOLCADO DE AUDITORIA AL TERMINAR EL PARTIDO (sprint3-init.js,
//        hallazgo #11). Se perdia EN SILENCIO en conexiones lentas: el
//        envoltorio corria dentro de un setInterval y capturaba un no-op si
//        active-match.js aun no habia bajado; despues ese script sobrescribia
//        window.endMatch y tiraba el envoltorio. Ahora espera a que exista, con
//        guarda de idempotencia. Se elimina ademas el envoltorio fantasma de
//        window.startMatch, funcion que no existe en el proyecto.
//        Bump para forzar recarga.
//  v383: FIX del boton "Rol" del panel SuperAdmin, que expulsaba al usuario a
//        la PANTALLA DE LOGIN en vez de abrir el selector de roles. La rama
//        que abria el selector nunca se ejecutaba y el `else` borraba la
//        sesion en memoria y saltaba a 'auth-screen'.
//        CAUSA (clase de fallo, no despiste puntual): extras.js es un script
//        CLASICO y comprobaba con typeof el nombre PELADO del selector
//        multi-rol, que vive en el ambito de un MODULO ES (auth.js). El ambito
//        de modulo NO cuelga de window, asi que ese typeof es SIEMPRE
//        'undefined'. saGoBackToRoles tenia el mismo problema y funcionaba de
//        casualidad por su reserva.
//        NO se resucita el selector antiguo: al elegir rol reescribe
//        _cronosCurrentUser con un objeto minimo que pierde allRoles,
//        isAuthorized y status, y el showRoleSelection posterior se queda EN
//        BLANCO (verificado ejecutando el codigo real). Ahora saCambiarRol
//        delega en saGoBackToRoles, que abre el selector real de cada login.
//        Guard permanente nuevo (asercion 3c de test_extracted_modules_load):
//        ningun script clasico puede referenciar por nombre pelado algo del
//        ambito de modulo. Verificado que caza el fallo original.
//        Bump para forzar recarga.
//  v382: refactor monolitos (auditoria 2026-07-22). Arranca el MONOLITO #4,
//        js/services/auth.js (3235 lineas): paso 1 -- extraida "seleccion de
//        rol y arranque de la app" (enterApp, showRoleSelection, selectOption,
//        _saPickTestClub, _launchWithRole y _renderCoordinatorTypePill, 456
//        lineas) a js/services/auth/role-launch.js. Movimiento mecanico, sin
//        cambios de comportamiento (test dedicado en verde antes y despues:
//        34/34 -> 39/39). auth.js queda en 2792 lineas.
//        ⚠️ OJO, ESTE MONOLITO ES UN MODULO ES, no un script clasico: el
//        archivo nuevo NO se enlaza con <script> en index.html, entra por un
//        `import` estatico en la cabecera de auth.js. Anadirlo ademas como
//        <script> suelto lo ejecutaria DOS VECES. Si va al precache porque el
//        navegador lo pide como recurso aparte.
//        FAN-OUT CERO: el bloque no usa nada de lo que se queda en auth.js.
//        Se amplia el guard test_extracted_modules_load.js con una parte 3
//        para modulos: comprueba que cada `import { X }` resuelve a un export
//        real del destino, un error de enlace que `node --check` NO ve.
//        Bump para forzar recarga.
//  v381: refactor monolitos (auditoria 2026-07-22), monolito #3, pasos 6a y 6b
//        -- FIN DEL MONOLITO #3. El §8 "Envio de informes de partido" eran
//        1359 lineas en DOS CAMINOS INDEPENDIENTES (cero referencias cruzadas,
//        verificado en ambos sentidos) y se extraen por separado:
//          · comms/match-reports-send.js (846 lineas) -- camino MANUAL: el
//            entrenador abre la modal, elige destinatarios y envia.
//            Entrada: match/persistence/team-persistence.js.
//          · comms/match-reports-auto.js (510 lineas) -- camino AUTOMATICO:
//            autoDispatchMatchReports + saveAllMatchReportsInternal, que se
//            disparan al terminar el partido y en cada accion de jugador.
//            Entradas: match/events/player-actions.js y
//            match/persistence/active-match.js.
//        Movimiento mecanico en ambos, sin cambios de comportamiento (tests
//        dedicados en verde antes y despues: 49->53 y 33->38).
//        Los dos aliases del bloque de exports (sendMatchReportsToParents y
//        saveAllMatchReportsInternal) se convierten a autoasignacion en el
//        mismo movimiento: referenciarlos por nombre pelado desde panel.js
//        habria repetido el ReferenceError de carga de v378.
//        panel.js queda en 1953 lineas, desde las 5879 del inicio: un 67%
//        menos. Lo que queda es el nucleo de mensajeria unificada, sus helpers
//        y openUnifiedCommsMenu como router.
//        Se corrige ademas una asercion de test_p11d_collective_write.js que
//        llevaba tiempo verde por el motivo equivocado: su regex del FIX P11-D
//        casaba con codigo de otras funciones y no habria detectado la perdida
//        de me.uid. Bump para forzar recarga.
//  v380: refactor monolitos (auditoria 2026-07-22), monolito #3, paso 5 de 6
//        -- extraido el COMPOSITOR DE MENSAJERIA MASIVA LEGACY
//        (toggleSelectAllParents, updateBulkCount, openBulkMessageComposer,
//        _msgSavePreselection, _msgGetSelected y los tres _sendBulkMsg*,
//        252 lineas) a comms/bulk-messaging.js. Movimiento mecanico, sin
//        cambios de comportamiento (test dedicado en verde antes y despues:
//        46/46 -> 50/50). Solo depende de _cFS y openCoachMessaging, que SE
//        QUEDAN en panel.js.
//        ALCANCE REDUCIDO A PROPOSITO: openUnifiedCommsMenu NO se mueve. Es
//        el router del area (25 referencias externas en 8 archivos, entre
//        ellas los cuatro modulos ya extraidos) y dejarla quieta evita tocar
//        su alias del bloque de exports, que es justo lo que rompio en v378.
//        OJO: el compositor extraido NO SE EJECUTA HOY. Nadie lo invoca, y
//        ademas lee la clase .parent-select-chk, que ningun archivo pinta.
//        Su sustituta viva es la familia _um* de panel.js. Se movio tal cual,
//        sin borrar nada; si algun dia se retira, ese archivo es la unidad.
//        panel.js queda en 3288 lineas. Bump para forzar recarga.
//  v379: FIX de la regresion introducida en v378. Al extraer
//        comms/contact-manager.js, panel.js seguia referenciando
//        openContactManager y saveContactManagerData por su NOMBRE PELADO en
//        su bloque de exports final. Ese archivo se carga DESPUES, asi que
//        era un ReferenceError EN TIEMPO DE CARGA que abortaba el resto de
//        panel.js: error no capturado en consola en cada arranque y
//        window._cronosForceRedispatch sin definir. El resto del archivo, y
//        el nucleo de mensajeria entero, se ejecutaban con normalidad, y las
//        funciones afectadas seguian publicandose desde su propio archivo,
//        por eso no se noto en la interfaz. Pasan a autoasignacion inocua.
//        Se anade scripts/test_extracted_modules_load.js: comprueba de forma
//        ESTATICA que ningun alias cuelgue de un nombre ausente y carga en
//        RUNTIME los cinco archivos de comms en el orden real de index.html
//        exigiendo que ninguno lance. Era el hueco que dejaban los tests
//        dedicados, que solo cargan el bloque movido y nunca el origen
//        entero. Bump para forzar recarga.
//  v378: refactor monolitos (auditoria 2026-07-22), monolito #3, paso 4 de 6
//        -- extraido el "Gestor de Contactos" (openContactManager,
//        saveContactManagerData, renderContactRowMarkup, renderParentRowMarkup,
//        addNewContactRow y addNewParentRow, 631 lineas) a
//        comms/contact-manager.js. Movimiento mecanico, sin cambios de
//        comportamiento (test dedicado en verde antes y despues: 62/62 -> 66/66).
//        Depende de cinco helpers que SE QUEDAN en panel.js: _cFS, _cGetStaff,
//        _catAndSubcatMatch, _loadParentList y openUnifiedCommsMenu. Escribe
//        window._cronos_squad_cache, que lee comms/individual-reports.js.
//        Se reapunta test_contact_manager_crash.js al archivo nuevo (localizaba
//        la funcion por indexOf sobre panel.js; al estar en XFAIL su rotura
//        habria sido invisible). Sigue en 3 PASS/4 FAIL exactos.
//        panel.js queda en 3524 lineas. Bump para forzar recarga.
//  v377: refactor monolitos (auditoria 2026-07-22), monolito #3, paso 3 de 6
//        -- extraido "Mis informes / Informes individuales" (openMisInformes,
//        openIndividualReports y _sendAllIndividualReports, 575 lineas) a
//        comms/individual-reports.js. Movimiento mecanico, sin cambios de
//        comportamiento (test dedicado en verde antes y despues: 66/66 -> 71/71).
//        El bloque solo depende de tres helpers de panel.js: _cFS, _cMyTeamKey
//        y openUnifiedCommsMenu, que SE QUEDAN alli y resuelven via window en
//        tiempo de click. Se actualiza test_report_engine_module.js, porque el
//        consumidor de _RP que vivia en comms/panel.js se mudo con el bloque.
//        OJO: openIndividualReports y _sendAllIndividualReports no tienen
//        ningun punto de entrada localizable en el repositorio; se movieron tal
//        cual, sin borrar nada.
//        panel.js queda en 4147 lineas. Bump para forzar recarga.
//  v376: refactor monolitos (auditoria 2026-07-22), monolito #3, paso 2 de 6
//        -- extraido "Informe colectivo" (openCollectiveReport/
//        _sendCollectiveReportNow, 472 lineas) a comms/collective-report.js.
//        Movimiento mecanico, sin cambios de comportamiento (test dedicado en
//        verde antes y despues). OJO: el despacho automatico de informes al
//        terminar un partido es autoDispatchMatchReports, que SE QUEDA en
//        panel.js y es una implementacion DISTINTA de la de este archivo.
//        Se actualiza test_p11d_collective_write.js para que lea los dos
//        ficheros: vigila que staffUids incluya siempre me.uid, sin lo cual
//        el partido no aparece en el Panel de Informes.
//        panel.js queda en 4715 lineas. Bump para forzar recarga.
//  v375: refactor monolitos (auditoria 2026-07-22), monolito #3, paso 1 de 6
//        -- extraida "Notificacion de entrenamiento" (openTrainingNotification/
//        _sendTrainingNotification, 213 lineas) a comms/training-notify.js.
//        Movimiento mecanico, sin cambios de comportamiento (test dedicado en
//        verde antes y despues). Es la seccion mas desacoplada del monolito:
//        no usa _cFS() sino su propio import() dinamico. OJO: NO es autonoma,
//        llama a openUnifiedCommsMenu(), que sigue en panel.js y se ira a
//        bulk-messaging.js en el paso 5 (resuelve via window, da igual el
//        orden). panel.js queda en 5181 lineas. Bump para forzar recarga.
//  v374: refactor monolitos (auditoria 2026-07-22). Arranca el MONOLITO #3,
//        js/coach/comms/panel.js (5879 lineas), con un PASO 0 de limpieza:
//        eliminadas 487 lineas de CODIGO MUERTO por doble declaracion.
//        _loadUnifiedContactList, _selectUnifiedContact,
//        _loadUnifiedThreadMessages y _sendUnifiedMessage estaban declaradas
//        DOS VECES en el mismo archivo; con declaraciones de funcion gana la
//        ultima, asi que las cuatro primeras nunca se ejecutaban (y diferian
//        de las vivas en 443, 9, 17 y 20 lineas). La muerta de
//        _sendUnifiedMessage ni siquiera podia funcionar: usaba db y
//        tabContext sin declararlos. Borrado PURO, sin una sola linea
//        modificada, con test que lo demuestra en sandbox.
//        panel.js queda en 5392 lineas. Bump para forzar recarga.
//  v373: refactor monolitos (auditoria 2026-07-22), monolito #2, paso 5 de 6
//        -- extraida "TAB: Informes de partido" (_sdLoadReports, con
//        sdToggleReport/sdDeleteReport/_sdMatchData anidados, 474 lineas) a
//        coach/reports/reports-tab.js. Movimiento mecanico, sin cambios de
//        comportamiento (test dedicado en verde antes y despues).
//        club-reports.js queda en 305 lineas, desde las 2249 del inicio.
//        Este paso ademas actualiza tres tests que contaban ocurrencias sobre
//        el monolito: los dos de SEC-C1 (call-sites de _cResolveClubId, ahora
//        repartidos 1+1) y test_v269_fixes, que habria dado un FALSO VERDE al
//        irse el codigo contado; ahora lee los dos archivos y sigue en rojo,
//        senalando la regresion real del dismissKey. Bump para forzar recarga.
//  v372: refactor monolitos (auditoria 2026-07-22), monolito #2, paso 4 de 6
//        -- extraido el MOTOR DE INFORMES VISUAL (_RP, 682 lineas, el bloque
//        mas grande del refactor) a coach/reports/report-engine.js. Funcion
//        PURA: sin window, document, console ni try/catch; el test la carga en
//        un sandbox desnudo para demostrarlo. Movimiento mecanico, sin cambios
//        de comportamiento. OJO: report-engine.js va ANTES de club-reports.js
//        en index.html (al contrario que los tres modulos de los pasos 1-3),
//        porque _RP es un `const` en el ambito lexico global y la guarda
//        `typeof _RP` de comms/panel.js es ilusoria en zona muerta temporal.
//        NO declarar `const _RP` en otro archivo: seria SyntaxError y abortaria
//        el script entero. club-reports.js queda en 775 lineas.
//        Bump para forzar recarga.
//  v371: refactor monolitos (auditoria 2026-07-22), monolito #2, paso 3 de 6
//        -- extraida "TAB: Partidos Terminados" (_renderFinishedMatchesTab,
//        378 lineas) a coach/reports/finished-matches-tab.js. Movimiento
//        mecanico, sin cambios de comportamiento (test dedicado en verde antes
//        y despues). OJO: este archivo NO es autonomo, tiene un CICLO con
//        app-init.js (su HTML llama a deleteFinishedMatchFromCloud y esa
//        llama de vuelta al render). Ademas app-init.js:1086 mantiene un
//        renderizador PARALELO del mismo listado (showFinishedMatches) y el
//        borrado refresca los dos. La pestaña ESCRIBE en Firestore durante el
//        render (enriquecimiento retroactivo de categoria).
//        club-reports.js queda en 1454 lineas. Bump para forzar recarga.
//  v370: refactor monolitos (auditoria 2026-07-22), monolito #2, paso 2 de 6
//        -- extraida "TAB: Convocatorias/Entrenamientos" (_sdLoadEvents, con
//        sdViewEventDetail y sdDeleteNotif anidados dentro, 227 lineas) a
//        coach/reports/events-tab.js. Primer corte INTERMEDIO del refactor.
//        Movimiento mecanico, sin cambios de comportamiento (test dedicado en
//        verde antes y despues). Fan-in externo cero; el orden de <script> es
//        indiferente. OJO: esta pestaña BORRA de Firestore los avisos mas
//        antiguos cuando pasan de 40, para todos los roles, de forma
//        irreversible y con el error silenciado. club-reports.js queda en
//        1828 lineas. Bump para forzar recarga.
//  v369: refactor monolitos (auditoria 2026-07-22). Arranca el MONOLITO #2,
//        js/coach/reports/club-reports.js (2249 lineas): paso 1 de 6 --
//        extraida "TAB: Configuracion del Club" (_renderDirectorConfig/
//        _dirSaveCategoryConfigs, 200 lineas) a
//        coach/reports/director-config.js. Movimiento mecanico, sin cambios
//        de comportamiento (test dedicado en verde antes y despues). Punto de
//        entrada unico switchStaffTab('config'), fan-in externo cero, y el
//        orden de <script> es indiferente porque todo se resuelve en tiempo
//        de llamada. OJO: _dirSaveCategoryConfigs publica
//        window._clubCategoryConfigs y window._clubTimerThresholds, que
//        deciden el color del semaforo del cronometro en partido.
//        club-reports.js queda en 2052 lineas. Bump para forzar recarga.
//  v368: refactor monolitos (auditoria 2026-07-22), paso 11 y ULTIMO de
//        superadmin.panel.js -- extraida "Mensajeria SA" (saEscapeHtml/
//        saEscapeAttr/saMessages/saUpdateCount/saSendMessages/saOpenThread/
//        saSendReply/saDeleteSingleMessage/saDeleteAllMessages, 409 lineas)
//        a su propio archivo (admin/superadmin/messaging.js). Movimiento
//        mecanico, bloque byte a byte identico, sin cambios de
//        comportamiento (test dedicado en verde antes y despues). Es la
//        seccion mas aislada: fan-in y fan-out externos cero, asi que su
//        orden de carga NO es critico. superadmin.panel.js queda en 548
//        lineas (desde 4122). Este bump ademas publica el boton "Vaciar
//        hilo" (saDeleteAllMessages) commiteado en 3ef5a49, aun no
//        desplegado. Bump para forzar recarga del JS.
//  v367: refactor monolitos (auditoria 2026-07-22), paso 10 -- extraida
//        "Solicitudes/Aprobacion" (saCountPendingRequests/saRequests/
//        saApproveRequest, 844 lineas) de superadmin.panel.js a su propio
//        archivo (admin/superadmin/requests-tab.js). Movimiento mecanico,
//        bloque byte a byte identico, sin cambios de comportamiento (test
//        dedicado en verde antes y despues). OJO: requests-tab.js debe
//        cargarse DESPUES de app-init.js (saRequests legacy) y ANTES de
//        extras.js (que la reemplaza pero exige que exista). Bump para
//        forzar recarga del JS.
//  v366: refactor monolitos (auditoria 2026-07-22), paso 9 -- extraida
//        "Pestana Clubes" (saClubs/saQuickApprove/setupClubsSyncListener)
//        de superadmin.panel.js a su propio archivo
//        (admin/superadmin/clubs-tab.js). Movimiento mecanico, bloques
//        byte a byte identicos, sin cambios de comportamiento (test
//        dedicado en verde antes y despues). OJO: clubs-tab.js debe
//        cargarse DESPUES de app-init.js, que tiene un saClubs legacy
//        duplicado. Bump para forzar recarga del JS.
//  v365: refactor monolitos (auditoria 2026-07-22), paso 8 -- extraido
//        "Individuales tab" (saIndividuals/saActivateIndividual/
//        saAssignOrphanToEntity) de superadmin.panel.js a su propio
//        archivo (admin/superadmin/individuals-tab.js). Movimiento
//        mecanico, sin cambios de comportamiento (test dedicado antes y
//        despues). Bump para forzar recarga del JS.
//  v364: refactor monolitos (auditoria 2026-07-22), paso 7 -- extraido
//        "Secretaria/invites" (saSecretary/saToggleMethod/
//        saUpdateInviteTemplate/saResetInviteTemplate/saSendInvite/
//        saSendInviteEmail/saSendInviteWhatsApp/
//        _limpiarFormularioSecretaria) de superadmin.panel.js a su
//        propio archivo (admin/superadmin/secretary.js). Movimiento
//        mecanico, sin cambios de comportamiento (test dedicado antes y
//        despues). Bump para forzar recarga del JS.
//  v363: refactor monolitos (auditoria 2026-07-22), paso 6 -- extraido
//        "Crear/editar ente individual" (saShowCreateIndividualEntity/
//        saCreateIndividualEntityConfirm/saEditIndividualEntity/
//        saEditIndividualEntityConfirm/saDeleteIndividualEntity/
//        saShowEntityUsers/saShowCreateIndividualForEntity/
//        saCreateIndividualForEntityConfirm) de superadmin.panel.js a su
//        propio archivo (admin/superadmin/individual-entity.js).
//        Movimiento mecanico, sin cambios de comportamiento (test
//        dedicado antes y despues). Bump para forzar recarga del JS.
//  v362: refactor monolitos (auditoria 2026-07-22), paso 5 -- extraido
//        "Crear club/individual directo" (saShowCreateClub/
//        saCreateClubConfirm/saShowCreateIndividual/
//        saCreateIndividualConfirm) de superadmin.panel.js a su propio
//        archivo (admin/superadmin/create-direct.js). Movimiento
//        mecanico, sin cambios de comportamiento (test dedicado antes y
//        despues). Bump para forzar recarga del JS.
//  v361: refactor monolitos (auditoria 2026-07-22), paso 4 -- extraido
//        "Borrado completo de club" (saDeleteClubComplete) de
//        superadmin.panel.js a su propio archivo
//        (admin/superadmin/delete-club.js). Movimiento mecanico, sin
//        cambios de comportamiento (test dedicado antes y despues). Bump
//        para forzar recarga del JS.
//  v360: refactor monolitos (auditoria 2026-07-22), paso 3 -- extraido
//        "Extras por Club" (_CRONOS_EXTRAS_DEF/saExtras/saSaveExtras) de
//        superadmin.panel.js a su propio archivo
//        (admin/superadmin/extras-toggle.js, nombrado asi para no chocar
//        con extras.js ya existente). Movimiento mecanico, sin cambios de
//        comportamiento (test dedicado antes y despues). Bump para forzar
//        recarga del JS.
//  v359: refactor monolitos (auditoria 2026-07-22), paso 2 -- extraido
//        "Editar Slots y Plan de Club" (saEditClubSlots/
//        saEditClubSlotsConfirm) de superadmin.panel.js a su propio
//        archivo (admin/superadmin/club-slots.js). Movimiento mecanico,
//        sin cambios de comportamiento (test dedicado antes y despues).
//        Bump para forzar recarga del JS.
//  v358: refactor monolitos (auditoria 2026-07-22), paso 1 -- extraida la
//        Papelera del SuperAdmin (saTrash/saReactivateAsIndividual/
//        saPurgeUser) de superadmin.panel.js a su propio archivo
//        (admin/superadmin/trash.js). Movimiento mecanico, sin cambios de
//        comportamiento (verificado con test dedicado antes y despues).
//        Bump para forzar recarga del JS.
//  v357: deuda "endMatch duplicado" (auditoria 2026-07-22) -- eliminada la
//        definicion muerta de window.endMatch en player-actions.js (siempre
//        quedaba eclipsada por la de active-match.js, cargada despues); una
//        sola fuente de verdad ahora. Bump para forzar recarga del JS.
//  v356: SEC-C1 (comms/panel.js, club-reports.js) -- _cResolveClubId ya no
//        escribe clubId con updateDoc directo desde el cliente (bloqueado
//        por firestore.rules, fallaba en silencio); ahora delega la
//        migracion de la raiz en la Cloud Function syncRootClubId. Bump
//        para forzar recarga del JS.
//  v355: fix isMine en burbujas de chat (comms/panel.js) -- cuentas
//        multi-rol con el mismo uid (ej. Entrenador=Padre) marcaban TODOS
//        los mensajes del hilo como "míos" al comparar solo por uid. Ahora
//        también exige que coincida senderRole con el rol activo. Bump
//        para forzar recarga del JS.
//  v354: burbujas de chat (comms/panel.js) -- enviados en azul, recibidos
//        en naranja, para diferenciar de un vistazo en el mismo hilo.
//        Bump para forzar recarga del JS.
//  v353: fix canal Entrenador<->Padre (comms/panel.js) -- contactos MANUALES
//        (emailConfig.contacts, sin enlace real en cronos_player_links)
//        sintetizaban parentUid = c.uid || c.id, usando el id LOCAL del
//        contacto como si fuera un uid real y bloqueando el fallback por
//        email que resuelve la cuenta real del padre. Bump para forzar
//        recarga del JS.
//  v352: fix canal Entrenador<->Padre (comms/panel.js) -- resuelve el uid
//        real del padre por email en clubUsers cuando cronos_player_links
//        no tiene parentUid. Bump para forzar recarga del JS.
//  v351: fix enrutamiento de mensajes entre roles (comms/panel.js) --
//        excluidos documentos "secundarios" de users (categoria vacia
//        actuando de comodin) + reconciliacion multi-clubId en la lista
//        de contactos (Director/Coordinador<->Entrenador). Bump para
//        forzar recarga del JS.
//  v350: restaurada auditoria de borrado en _clearUnifiedThread (panel.js) +
//        restaurada pestana Partidos Terminados y config por categoria del
//        Director (club-reports.js). Bump para forzar recarga del JS.
//  v349: fix threadId canonico entre roles (coach/comms/panel.js) +
//        restaurada red de seguridad me.uid en staffUids (regresion P11-D).
//        Bump para forzar recarga del JS cacheado.
//  v299 (cache): Unificado el render del aviso de entrenamiento
//        (planificacion_semanal) en un helper compartido
//        _cronosRenderTrainingWeekCards (js/shared/whatsapp-email.js).
//        El panel de padres dejaba de mostrar una tabla vertical y ahora
//        usa las mismas tarjetas horizontales con scroll lateral que el
//        panel de coordinador/director. Bump para forzar recarga del JS.
//  v229: FIX v221 - sincronización de umbrales del semáforo entre
//        coach y live.html:
//        · pushLiveSnapshot ahora lee DIRECTAMENTE clubs/{clubId}.timerThresholds
//          de Firestore (con caché 60s) en vez de fiarse de window._clubTimerThresholds
//          que podía ser null o estar desactualizado.
//        · live.html añadido fallback asincrónico: si el snapshot llega sin
//          timerThresholds, lee clubs/{clubId} directamente y re-renderiza.
//        Esto garantiza que el live SIEMPRE aplique los umbrales configurados
//        por el Director Deportivo, aunque los haya cambiado a mitad de partido.
//  v228: FIX v220 - dos bugs críticos:
//        1) Panel "en vivo" solo mostraba 5 cambios aunque se hiciesen 7:
//           · Subido el límite de toasts simultáneos de 5 a 15.
//           · Añadido panel persistente "HISTORIAL DEL PARTIDO" que acumula
//             TODOS los eventos (goles/tarjetas/lesiones/cambios) en una
//             lista no efímera en la parte inferior de la pantalla.
//        2) Colores del cronómetro distintos en panel entrenador vs "en vivo":
//           · tickPlayerTimes ahora recalcula el color en cada tick 250ms
//             (antes solo actualizaba el texto; el color iba retrasado 5s).
//           · getTimerColor en app-init.js usa fallback mode-aware
//             (F7=1800+1800=3600, F11=2400+2400=4800) consistente con live.html.
//           · sync.js envía half1MaxTime/half2MaxTime >0 (antes enviaba 0
//             si el global era 0, y live caía a defaults distintos del coach).
//           · renderPlayers() llama colorAllTimers() sincrónicamente para
//             evitar la ventana de 1s donde los chips mostraban los colores
//             por defecto del CSS (amarillo #ffde59) en lugar del semáforo.
//  v227: FIX v219 - inversión de flechas de sustitución:
//        · ▼ verde = ENTRA al campo (señala el campo hacia abajo).
//        · ▲ roja = SALE del campo (señala hacia fuera, hacia arriba).
//        Motivo: el toast aparece arriba a la derecha, así que ▼ señala
//        el campo (entra) y ▲ señala fuera (sale).
//  v226: FIX v218 - formato de mensajes de eventos:
//        · Sin '#' antes del dorsal del jugador (solo nombre).
//        · Palabras GOL/TARJETA/LESIÓN/CAMBIO en MAYÚSCULAS con color
//          (verde/amarillo/rojo/rojo/azul respectivamente) en HTML.
//        · Flecha ▲ verde = ENTRA al campo; flecha ▼ roja = SALE del campo.
//        · Texto plano (WhatsApp/email) usa emojis + MAYÚSCULAS.
//  v225: FIX v217 - semaforo respeta umbrales del Director Deportivo
//        (patches.js ya no pisa window.getTimerColor; live.html lee
//        data.timerThresholds del snapshot) + checkbox per-partido del
//        modal de informes se respeta ESTRICTAMENTE (authorizedIds en
//        _cronosResolveParentReportTargets y autoDispatch FASE A/B).
//  v224: Banquillo en flujo flex (no fixed) - campo se ajusta solo, sin solapamiento
//  v216: Bump tras feat del silbato de arbitro + overlay de fin de parte/partido
//         (js/core/event-listeners.js: _cronosWhistle, _cronosMatchMomentOverlay;
//         enganche en endMatch de active-match.js) y fix de no pausar el cronometro
//         al volver al setup en modo autonomo (movement-log.js). Invalida el precache.
//  v215: Bump tras fix de emparejado de sustituciones simultaneas por subId en
//         el informe colectivo (coach/reports/club-reports.js) + captura de subId
//         en _parseHistoryForFirestore (coach/comms/panel.js). Invalida el precache
//         para servir el club-reports.js corregido en vez de la version con el bug.
//  v214: Bump tras fix de duplicado Solicitudes de Registro / Nuevos Roles Solicitados (panel.js).
//  v211: Panel del SuperAdmin â€” saClubs() y saShowEntityUsers() ahora
//         renderizan el arbol jerarquico Categoria/Subcategoria (solo
//         lectura) via window.renderCategoryTreeReadOnly, en lugar de la
//         lista plana. Helper compartido en js/admin/shared/category-tree.js
//         (modo club con bloque Staff; modo individual sin Staff). Bump
//         fuerza recarga de js/admin/superadmin/superadmin.panel.js y del
//         nuevo js/admin/shared/category-tree.js.
//  v209: Panel del Club — dentro de cada Subcategoria, la lista de usuarios
//         pasa a columnas alineadas: Rol · Nombre · Email · Fecha (+acciones),
//         con fila de cabecera. "Nombre" muestra solo el nombre de pila
//         (firstName, con fallback a displayName.split(' ')[0]). Bump fuerza
//         recarga de js/admin/club/panel.js.
//  v208: Panel del Club — la lista plana de "Usuarios del Club" pasa a un
//         arbol jerarquico: bloque Staff fijo (Director + Coordinadores con
//         su modalidad F7/F11/F7&11) y 7 Categorias x 3 Subcategorias
//         plegables (Entrenadores/Padres por grupo). Selector CSS de hijo
//         directo para soportar el plegado anidado. Bump fuerza recarga de
//         js/admin/club/panel.js.
//  v207: Bump tras fix de category/subcategory en el flujo de alta del Club.
//  v206: Bump tras fix del contador "Admin de Club" (countByRole via allRoles).
//  v205: Pieza 2 - Resolutor de staff por modalidad del partido. Al despachar
//         el informe colectivo (auto y manual) los Coordinadores se filtran por
//         su coordinatorType (f7/f11/f711) segun la modalidad de la categoria
//         del partido: F7 solo lo reciben coords f7/f711/sin-tipo, F11 solo
//         f11/f711/sin-tipo; el Director Deportivo lo recibe SIEMPRE. Helpers
//         puros en js/core/utils.js (_cronosMatchModality /
//         _cronosStaffCoordinatorType / _cronosResolveStaffForMatch). Bump
//         fuerza recarga de utils.js + coach/comms/panel.js.
//  v204: FIX CRITICO PERDIDA DE DATOS EN CADA ACTUALIZACION. La logica de
//         privacidad introducida en v199 (_purgeStaleLocalDataIfNeeded) borraba
//         TODAS las claves cronos_* cuando el dispositivo no tenia el marcador
//         'cronos_owner_uid'. Como ese marcador solo existe desde v199, cualquier
//         usuario con datos previos (o que limpiara la cache) entraba en la rama
//         de "limpieza preventiva" en su siguiente login tras CADA actualizacion,
//         perdiendo plantillas, formaciones, convocatorias y planificaciones de
//         entrenamiento (claves que solo viven en localStorage). FIX: la purga
//         ahora SOLO se dispara ante un cambio de uid REAL y comprobado (CASO 3).
//         Si no hay marcador previo (CASO 2) se ADOPTA el uid actual como
//         propietario SIN purgar, preservando los datos del usuario entrante.
//         Bump fuerza recarga del bundle de firestore-storage.js.
//  v203: Anade selector de tipo de Coordinador (F7/F11/F7&11) en registro.
//  v202: Persiste subcategory en los informes colectivos (deriva de allRoles del entrenador, base para futuro resumen agregado de estadisticas)
//  v201: Corrige etiquetas entrada/salida en linea de tiempo de informes colectivos (verde=entra, roja=sale, con nombre propio y minuto)
//  v200: Habilitado pinch-to-zoom en movil y iPad. Se quito
//         maximum-scale=1.0 y user-scalable=no del meta viewport en
//         index.html, live.html y sound-test.html. Se cambio touch-action
//         de 'none' a 'pinch-zoom' en .player-chip (campo y banquillo) para
//         permitir zoom con 2 dedos sin afectar el arrastre con 1 dedo. El
//         drag-and-drop tactil no requirio cambios (el touchcancel existente
//         en render.js ya limpia el clon de arrastre si el navegador
//         intercepta el gesto de 2 dedos).
//  v199: FIX CRITICO DE PRIVACIDAD - localStorage no estaba aislado por usuario,
//         causando que un usuario nuevo en el mismo dispositivo heredara plantillas,
//         jugadores, partidos y datos de la cuenta anterior. Se anade
//         _purgeStaleLocalDataIfNeeded() y _cronosPurgeAllLocalPII() en
//         firestore-storage.js: purga automatica de claves cronos_* con PII al
//         detectar cambio de uid en login (checkAuthorization, _launchWithRole,
//         auto-recovery de superadmin/individual) y en logout (logoutUser,
//         cerrarSesion). Autosanea dispositivos ya afectados en su proximo login,
//         sin accion manual. No afecta sincronizacion legitima entre dispositivos
//         del mismo usuario (Firestore ya estaba aislado por uid correctamente).
//         Bump fuerza recarga obligatoria de todos los bundles para que el fix
//         llegue a todos los usuarios cuanto antes.
//  v198: Fix condicion de carrera en live.html entre el watcher de fondo
//         (background) y el listener visible del partido abierto. Durante la
//         ventana de "partido recien creado + interaccion temprana", ambos
//         listeners competian por el mismo estado de seeding/monotonia
//         (_matchSeeded/_matchLastTs/_matchPrevState), de modo que el watcher de
//         fondo gastaba el seed o avanzaba la monotonia del partido a punto de
//         abrirse y el listener visible descartaba el snapshot del gol sin
//         comparar el delta de marcador (gol del rival no disparaba alerta).
//         Fix: loadMatch() resetea de forma SINCRONA esos tres objetos para el
//         matchId justo antes de suscribir su onSnapshot, quedando como dueno
//         unico de la deteccion. Bump fuerza recarga del bundle de live.html.
//  v197: Fix alerta de gol (sonido+imagen) que no se disparaba en live.html para
//         goles del equipo rival sin plantilla cargada, ni para goles no
//         asignados/propia puerta del equipo propio. detectAndAlert() ahora
//         compara el delta de marcador agregado (homeTeam.score/awayTeam.score)
//         restando los goles ya atribuidos a jugadores, evitando alertas
//         duplicadas. Usa el nombre real del equipo configurado. Bump fuerza
//         recarga del bundle de live.html.
//  v196: Fix ficha difuminada tras confirmar cambio de jugador por toque (tap)
//         en iPad/movil. renderPlayers() exigia ahora que exista un clon de
//         arrastre activo (touchData.clone) antes de aplicar opacity:0.3,
//         evitando que un draggedPlayerId residual deje la ficha entrante
//         atenuada hasta el siguiente gesto. Bump fuerza recarga del bundle de UI.
//  v195: Restaura panel.js de Administrador de Club (443 lineas borradas en
//         edicion local recuperadas) + elimina boton Cambiar Rol de ese panel
//         por decision de Jose Alberto. Alinea VERSION y CACHE_NAME (desfasados
//         entre v191/v194 por cambios de sesion anterior sin commitear). Bump
//         fuerza recarga completa del bundle de admin.
//  v191: Boton explicito "Activar sonido" en live.html para iPhone PWA
//         standalone. live.html se abre con window.open(_blank), un documento
//         separado que NO hereda el gesto del usuario de la pagina padre, asi que
//         su AudioContext nunca se desbloqueaba (en iPhone; PC/iPad iban OK por
//         politica de autoplay mas laxa). El boton da un gesto GARANTIZADO en
//         este documento: desbloquea el AudioContext + keep-alive y emite un bip
//         de confirmacion. Tras desbloquear pasa a "Sonido activo". Bump fuerza
//         recarga de live.html.
//  v190: FIX audio de alertas En Vivo en iPhone PWA standalone (instalada en
//         pantalla de inicio): no sonaba NUNCA, ni la 1a repeticion (PC/iPad ya
//         iban OK tras v189). iOS standalone suspende el AudioContext entre
//         gestos y no permite resume() fuera de un gesto; las alertas llegan por
//         Firestore (sin gesto). Fix: keep-alive del AudioContext (loop de
//         silencio inaudible) que lo mantiene 'running' de forma continua tras
//         el primer toque, para que _playSeq suene sin gesto. Bump fuerza
//         recarga de live.html.
//  v189: FIX sonido de alerta En Vivo: se oia "una vez y corta" en partidos
//         reales. Las alertas llegan desde el callback de Firestore (no es un
//         gesto del usuario), con el AudioContext en 'suspended'; al leer
//         currentTime congelado las repeticiones colapsaban en un golpe. Ahora
//         playEventSound() solo programa con ctx.state 'running' (si no, resume()
//         + then) y _playSeq() repite 3 veces fijas una secuencia CORTA por
//         evento con envolvente sostenida. Bump fuerza recarga de live.html.
//  v188: NUEVO — Alertas sonoras + visuales en la pestaña "En Vivo" del Panel
//         de Direccion (live.html). Al ocurrir un evento (gol, tarjeta amarilla/
//         roja, cambio o lesion) en cualquier partido seguido, se muestra un
//         toast con flash de pantalla, un sonido sintetico (WebAudio, sin
//         archivos) distinto por evento y vibracion en movil. Funciona aunque
//         el director este viendo otro partido: un watcher en segundo plano
//         (onSnapshot a todos los partidos seguidos) detecta los cambios
//         comparando snapshots consecutivos por jugador. Boton de silenciar
//         (persistente en localStorage). Bump fuerza recarga de live.html.
//  v187: FIX campo mostraba AMBOS equipos al jugar de VISITANTE con el checkbox
//         "Analizar Contrario" DESACTIVADO. RAIZ: setup-modal.js forzaba
//         analyzeAway=true cuando _userTeamRole==='away', ignorando el checkbox,
//         y spawnInitialPlayers creaba siempre el equipo home (rival generico).
//         AHORA: spawnInitialPlayers se reescribe en torno a "mi equipo" (team =
//         userRole, siempre) vs "el contrario" (solo si analyzeAway). Se elimina
//         el forzado de analyzeAway. Como de visitante mi banca esta en la sidebar
//         derecha, se anade clase body.role-away + CSS para que hide-visitor oculte
//         la sidebar izquierda (rival) en vez de la derecha (mia). Bug especifico
//         del rol visitante; de local sin el checkbox ya funcionaba bien.
//  CRONOS FUTBOL - Service Worker v186
//  v186: FIX (continuacion v185) resultado V/D/E AUN invertido de VISITANTE en
//         el Panel de Direccion y Mis Informes pese a que los docs en Firestore
//         SI tenian myTeamRole correcto. RAIZ: al AGRUPAR los docs por partido
//         (matches[key]) los 3 puntos de agrupacion (club-reports.js _sdLoadReports,
//         panel.js openMisInformes) NO copiaban myTeamRole al objeto agrupado, asi
//         que el calculo leia m.myTeamRole=undefined -> fallback 'home' -> DERROTA.
//         AHORA: se propaga myTeamRole en la construccion del objeto agrupado y se
//         adopta del primer doc que lo traiga. Sin backfill.
//  v185: FIX resultado V/D/E invertido al jugar de VISITANTE. Los informes
//         guardaban scoreHome/scoreAway como marcador local-visitante pero la
//         formula asumia scoreHome=mi equipo, dando DERROTA cuando se ganaba de
//         visitante. AHORA: (1) escritura -> se persiste myTeamRole (_cMyTeamKey)
//         en parent_player_report, staff_match_report, collective_match_report y
//         la notificacion informe_partido; (2) lectura -> los 4 puntos de calculo
//         (coach/reports/club-reports.js x2, coach/comms/panel.js, parent/panel.js)
//         comparan goles propios vs rival segun myTeamRole. Docs antiguos sin el
//         campo -> fallback 'home' (comportamiento previo intacto, sin backfill).
//         C-25 (resuelto): js/club-reports.js (duplicado muerto) ELIMINADO del
//         repo; el activo es js/coach/reports/club-reports.js. Pendiente aun:
//         linea 2413 aviso_partido_finalizado (consistencia, no afecta al bug).
//  v183: FIX panel de Direccion mostraba solo 1 partido al director/coordinador.
//         RAIZ: _sdLoadReports hacia where(clubId==cid).limit(500) SIN orden ni
//         filtro; con clubs de miles de docs el cupo de 500 se llenaba de docs
//         _coach_pN / _parent_* y, tras el filtro cliente staffReport===true,
//         apenas sobrevivia 1 partido. AHORA la query primaria filtra ya por
//         staffReport==true + orderBy(createdAt desc) + limit(500) (indice
//         compuesto clubId,staffReport,createdAt desc desplegado), con fallback
//         sin orderBy y fallback legacy. El fallback staffUids array-contains
//         downstream se conserva intacto como red de seguridad.
//  v179: P14 — eliminado el banner flotante "Partido interrumpido" del panel
//         del entrenador (recuperacion sigue en "RECUPERAR PARTIDO" del modal).
//         P15 — panel de Comunicaciones simplificado (openUnifiedCommsMenu):
//         quitadas 5 tarjetas redundantes/rotas (Convocatoria, Entrenamiento,
//         Informe Colectivo, Mis Informes, Gestion de Contactos); se conservan
//         Mensajes, Informes Individuales, Partidos Terminados y Retransmision.
//  v178: Ocultar informes de staff por usuario sin borrar el doc compartido.
//         El Director/Coordinador ya no borra fisicamente el documento de
//         cronos_player_reports: ahora anade su propio UID a dismissedByStaff
//         (arrayUnion) y la lectura (_sdLoadReports) filtra en cliente los
//         docs donde dismissedByStaff contiene su UID. Asi cada rol ve/oculta
//         de forma independiente sin afectar al otro. firestore.rules: el
//         update de dismissedByStaff lo permite solo a UIDs listados en
//         staffUids; el delete fisico de informes staffReport=true queda
//         reservado al coach autor (coachUid) y al SuperAdmin.
//  v177: FIX (P11-C/P11-D) el Panel de Informes seguia sin mostrar partidos
//         nuevos al Director/Coordinador.
//         P11-C: las 3 llamadas a _cResolveClubId en club-reports.js no pasaban
//           updateDoc, asi que el clubId resuelto desde allRoles[] nunca se
//           migraba al campo raiz de users/{uid} -> userDocClubId() fallaba y la
//           Query A (por clubId) era rechazada. Ahora pasan { doc, getDoc,
//           updateDoc } y la migracion se persiste.
//         P11-D: _sendCollectiveReportNow hacia `return` si la lista de staff
//           estaba vacia, ABORTANDO la escritura de cronos_player_reports -> el
//           partido nuevo nunca aparecia (el panel se alimenta de esos docs).
//           Ahora se escriben igualmente; staffUids incluye SIEMPRE me.uid
//           (red de seguridad para la Query B array-contains) tanto en el
//           colectivo como en autoDispatchMatchReports. Anadidos logs
//           [StaffReport] con conteo TOTAL de docs escritos para diagnostico.
//  v176: FIX (P11) panel de Informes no mostraba TODOS los partidos al
//         Director/Coordinador. (1) La agrupacion usaba matchDate+rival+coach
//         pero los docs staff_match_report guardan matchDate=hoy -> partidos
//         distintos contra el mismo rival el mismo dia colapsaban en una
//         tarjeta. Ahora se agrupa por matchId. (2) La query por clubId no
//         filtraba staffReport, agotando limit(500) con docs irrelevantes;
//         ahora ambas queries (clubId+staffReport / staffUids) corren en
//         paralelo con Promise.allSettled y se fusionan. Nuevo indice
//         compuesto cronos_player_reports(clubId, staffReport).
//  v175: FIX permission-denied del informe colectivo al staff (director/
//         coordinador). Causa: el hilo coach<->staff usaba threadId
//         {coachUid}_{staffUid}; los docs antiguos no tenian coachUid ni
//         participants, asi que updateDoc/setDoc(merge) los rechazaba contra
//         las reglas de cronos_messages -> el informe no llegaba al staff.
//         Solucion: nuevo helper _cStaffThreadId -> el hilo pasa a
//         {clubId}_{staffUid} (pertenece al CLUB) y los setDoc incluyen
//         clubId + participants + staffUids, de modo que sameClubAsDoc/
//         participants/coachUid SIEMPRE pasan. Aplicado en las 4 rutas:
//         listado de hilos, openThreadWithStaff (chat manual), sendCoachMessage,
//         _executeReportsSend (informe colectivo) y la 2a ruta de envio staff.
//         El staff sigue leyendo por query (staffUid==uid / staffUids
//         array-contains), asi que el cambio de ID no afecta a su bandeja.
//         No requiere cambio en firestore.rules.
//  v174: dos bugs confirmados del envio de informes:
//         Bug 1 (clubId null): _cResolveClubId lee clubId de users/{uid}
//           cuando el token no trae el claim -> staff y padres dejan de
//           recibir por sameClubAsDoc(null). Aplicado en ambas rutas.
//         Bug 2 (contacto manual): _cronosResolveParentReportTargets empareja
//           por playerId/dorsal de forma robusta (J10/J-10/playerNumber) para
//           recuperar el parentUid del link; el target lleva su contacto y la
//           ruta manual reempareja con las MISMAS vias que el helper.
//  v173: el catch de 'Error creando hilo staff' ahora vuelca code+message+
//         threadId+staffUid+clubId para diagnosticar el permission-denied de
//         las reglas de cronos_messages (sin cambio de comportamiento).
//  v172: logging de diagnostico opcional para informes (activar con
//         window._cronosDiagReports = true en consola). Sin efecto en
//         produccion si la bandera no esta activada. Registra por que se
//         omite cada padre/staff al enviar informes.
//  v171: REDISENO del envio de informes de partido (raiz: padres recibian
//         informes de jugadores que NO son sus hijos).
//         - Helper compartido _cronosResolveParentReportTargets usado por
//           AMBAS rutas (auto-despacho y envio manual): emparejado ESTRICTO
//           SOLO por dorsal (inviteCode 'J10'), nunca por nombre; maximo 1
//           informe por padre; solo si el padre tiene parentUid registrado y
//           su hijo fue convocado (si no, se omite en silencio).
//         - _cGetStaff Regla 1/2: director y coordinador SIEMPRE reciben el
//           informe colectivo aunque no tengan el checkbox INF; el resto del
//           staff solo con el checkbox.
//         - IDs deterministas {matchId}_parent_{parentUid}_p{dorsal} (idempotentes).
//  v170: FIX DEFINITIVO panel del padre (2 bugs latentes tras v169):
//         (1) Perdida de datos: _rptDedupKey ignoraba matchId y deduplicaba por
//         fecha+rival+marcador, asi que DOS partidos distintos el mismo dia contra
//         el mismo rival con identico marcador colapsaban a una clave y el cleanup
//         borraba de Firestore el informe del 2o partido. Fix: la clave usa matchId
//         (mid:<matchId>_<dorsal>) cuando existe; solo cae a fecha+rival+marcador
//         (dt:...) para los rpt_* legacy sin matchId.
//         (2) Asimetria de filtro: el loop de Prioridad 1 (parentUid) NO filtraba
//         por type===parent_player_report (solo lo hacia Prioridad 2 desde v169),
//         de modo que un collective_match_report con parentUid del padre habria
//         colado. Anadido el mismo filtro estricto a Prioridad 1.
//         Verificado con scripts/test_parent_dedup.js (6/6): incl. escenario de
//         perdida de datos y colectivo con parentUid.
//  v168: Refuerzo de los fixes v167 (P1/P2):
//         P1: eliminado Math.random() por completo de las 3 copias de
//         startLiveSync; el sufijo se deriva de uid+fecha+equipo(+rival+convo)
//         via _cronosBuildLiveMatchId (sin componente aleatorio).
//         P2: la query de links cargaba por clubId/individualOwnerId/coachUid;
//         si el link de un padre tiene clubId distinto/ausente quedaba fuera y
//         el match devolvia undefined. Anadido _fetchLinkByParentUid: fallback
//         que consulta cronos_player_links por parentUid SIN filtro de club
//         (cacheado) en _executeReportsSend y autoDispatchMatchReports.
//  v167: FIX raiz informes duplicados a padres + link padre-jugador undefined.
//         P1: liveMatchId usaba Math.random() en sus 3 copias de startLiveSync
//         (app-init.js, match/live/sync.js, services/firestore-sync.js); reiniciar
//         el sync cambiaba el sufijo (eq1u->x9k2) y, como _stableMatchId deriva de
//         liveMatchId, el matchId del informe dejaba de ser estable y el dedup del
//         padre no colapsaba. Fix: sufijo DETERMINISTA (hash FNV-1a de equipo+
//         fecha+rival+convocatoria) via window._cronosBuildLiveMatchId, que ademas
//         reutiliza el liveMatchId existente. v166 solo corrigio el Date.now() de
//         _stableMatchId; la aleatoriedad real estaba aguas arriba.
//         P2: el emparejado link padre-jugador (autoDispatchMatchReports/FaseC)
//         comparaba email/telefono con === sin normalizar -> link undefined aunque
//         el doc existiera (case/espacios o prefijo +34). Fix: _cronosNormEmail /
//         _cronosNormPhone + fallback de link por playerNumber/playerAlias + log
//         diagnostico que distingue "no cargado por clubId" de "no caso".
//  v166: FIX informes individuales duplicados a padres (llegaban 10+ veces).
//         Causa: sharedMatchId usaba Date.now(), así que cada disparo del fin
//         de partido que se colaba por los guards creaba docs con matchId nuevo
//         (setDoc no idempotente) y el dedup del panel del padre no los colapsaba.
//         Fix: matchId DETERMINISTA (helper _stableMatchId: liveMatchId o
//         uid+fecha+rival, sin marcador) en auto y manual dispatch + dedup
//         defensivo en parent/panel.js (fallback parentUid+playerNumber+fecha).
//  v165: FIX informes club — ocultado suave por usuario (hiddenBy) en lugar de
//         borrado físico. Director y coordinador comparten los mismos docs en
//         Firestore: al borrar uno, el otro perdía el informe. Ahora sdDeleteReport
//         hace updateDoc con hiddenBy: arrayUnion(uid); el filtro cliente excluye
//         los docs ocultados por el propio uid y firestore.rules permite el update.
//  v163: FIX CRÍTICO — al reanudar la 2ª parte tras el descanso el partido se
//         reiniciaba (marcador 0-0, cronómetro a cero, vuelta a 1ª parte). Causa:
//         el técnico volvía a «Configuración» durante el descanso para hacer
//         cambios y, al re-confirmar la convocatoria, goToTitularSelection() /
//         startMatchWithConvocation() (versión ACTIVA en js/ai/import.js)
//         ejecutaban el RESET GLOBAL del partido. Fix: nuevo guard
//         _guardAgainstMatchReset() (app-init.js) detecta un partido EN CURSO
//         (1ª/descanso/2ª con marcador o tiempo) y ofrece REANUDAR (conserva
//         marcador y cronómetro vía _restoreActiveMatch) o empezar de cero.
//  v162: Bump cache — fuerza recarga de los fixes de partido en vivo (clubId en
//         live_matches), del filtro del visor (live.html) y de setCustomClaims al
//         activar miembros (panel.js). Sin el bump no se purga la cache v161.
//  v161: FIX CRÍTICO — informes de partido no se enviaban a nadie a partir
//         del 2º partido. La versión ACTIVA de startMatchWithConvocation
//         (js/ai/import.js, carga DESPUÉS de app-init.js y la eclipsa) no
//         limpiaba los guards de idempotencia de informes (cronos_reports_sent_*
//         + _cronosLastDispatchedMatch + liveMatchId), por lo que
//         saveAllMatchReportsInternal() omitía el despacho del 2º partido en
//         adelante. Bump fuerza recarga de import.js parcheado.
//  v159: RGPD (P1) — el enlace «Política de Privacidad» del pie ahora solo
//         se muestra en modo login (en registro queda el del checkbox). Se
//         gestiona en los onclick de las pestañas y en switchTab (auth.js).
//  v158: RGPD (P1, fix definitivo) — una regla CSS ofuscada con
//         display:none !important sobreescribia el display:block inline del
//         checkbox. Ahora se usa setProperty('display', ..., 'important') en
//         los onclick de las pestañas y en switchTab (auth.js). Bump cache.
//  v157: Fix ojo de contraseña — se desactiva initPasswordToggles() en
//         auth-improvements.js (duplicaba el listener de wireToggle() de
//         index.html y alternaba el tipo dos veces por clic). Bump cache.
//  v156: RGPD (P1, hotfix 2) — el onclick de las pestañas muestra el GDPR
//         ANTES de switchTab y solo llama a switchTab si existe (evita que
//         un ReferenceError rompa la cadena y oculte el checkbox). Bump cache.
//  v155: RGPD (P1, hotfix) — el onclick de las pestañas muestra/oculta
//         #gdpr-consent-container inline (independiente de switchTab/cache),
//         para que el checkbox aparezca en registro. Bump invalida cache.
//  v154: CSP (hotfix) — bump para forzar descarte de cache en clientes y
//         recoger la cabecera CSP nueva (cdn.jsdelivr.net en connect-src).
//  v153: RGPD (P1) — #auth-btn se deshabilita en registro hasta aceptar el
//         consentimiento (switchTab + syncAuthBtnConsent). Bump fuerza
//         recarga de auth.js parcheado.
//  v152: RGPD (P1) — el registro persiste el consentimiento explicito en el
//         documento del usuario (gdprConsent / gdprConsentDate /
//         gdprConsentVersion) en las 4 rutas de creacion de usuario.
//         Bump fuerza recarga de auth.js parcheado.
//  v151: Privacidad (P9, 2/2) — refuerza el cierre de la fuga:
//         (1) firestore.rules: live_matches read pasa de isAuth() a
//         isRegisteredUser() (exige users/{uid}.isAuthorized==true, no
//         solo autenticado). (2) live.html: el coachEmail en las tarjetas
//         de showLiveNow()/showHistory() solo se muestra a role
//         superadmin/admin; el resto de usuarios ya no ve el correo del
//         entrenador. Bump fuerza recarga de live.html parcheado.
//  v150: Privacidad (P9) — firestore.rules: live_matches pasa de
//         `allow read: if true` (PII publica: coachEmail, nombres de
//         jugadores menores, dorsales, club, colores) a `allow read:
//         if isAuth()`. live.html y parent/panel.js ya gatean por login
//         antes de consultar, asi que no rompe ningun flujo. Cierra la
//         fuga de datos que v149 solo mitigaba a nivel de XSS. (El
//         comentario "se lee sin auth" de v149 queda obsoleto tras este
//         deploy de reglas.)
//  v149: Seguridad — fix XSS almacenado en live.html. Se anaden
//         escapeHtml() (nombres de equipo/jugador, email del entrenador,
//         dorsales, nombre de club) y safeColor() (validacion de color
//         CSS contra regex) en los ~20 puntos de innerHTML que inyectaban
//         datos de Firestore controlables por el entrenador. live_matches
//         se lee sin auth, asi que el payload era explotable por visitantes
//         anonimos. Bump fuerza recarga del live.html parcheado.
//  v148: Limpieza — elimina el log de debug temporal de v147 y baja a
//         console.debug el permission-denied transitorio de syncFromFirestore
//         (esperado para coach/club_admin con claims aun no propagados; el SA
//         no inicializa TrainingSync). Menos ruido en consola.
//  v147: Log de debug TEMPORAL en training-firestore-sync.js para
//         inspeccionar en produccion el estado de _cronos_auth.auth.currentUser
//         y los claims reales (role/clubId) del ID token vs el clubId que se
//         consulta. Diagnostico del permission-denied persistente.
//  v146: Bump cache — fuerza recarga de js/services/training-firestore-sync.js
//         con el fix de Race B: se reemplaza el setTimeout(2000ms) fijo por
//         _whenTokenReady() (getIdToken(true)) antes de syncFromFirestore,
//         evitando el permission-denied espurio cuando el ID token aun no
//         tiene los custom claims role/clubId propagados.
//  v145: Bump cache — fuerza recarga de js/parent/panel.js con el fix
//         que evita crear IDs basura 'null_N' en cronos_player_links
//         (guarda && clubId en auto-vinculacion + guard if(!clubId) en
//         vinculacion manual). Sin el bump los clientes seguirian con el
//         panel.js antiguo que generaba docs como null_10.
//  v141: Logs del SW usan `${VERSION}` (antes hardcodeado '[SW v134]',
//         desincronizado desde v135). Bump fuerza a clientes con SW
//         antiguo (<=v139) a migrar al SW con el CSP que permite
//         cdn.jsdelivr.net en connect-src, eliminando el error real de
//         consola al hacer fetch del bundle de EmailJS/Tesseract.
//  v140: Bump cache — purga el manifest.json cacheado con la antigua URL
//         de Flaticon (CDN externo). Ahora el icono PWA usa el logo local
//         /public/assets/logo.png. Sin el bump, CACHE_NAME no cambia y el
//         activate no borra cronos-cache-v139, que servia el manifest viejo.
//  v139: Rediseno de privacy.html con tema oscuro CHRONOS FUTBOL: hero con
//         logo a 120px, header sticky con logo a 64px y marca actualizada.
//  v138: Anadida pagina privacy.html (Politica de Privacidad RGPD) al
//         precache + enlace en el pie de la pantalla de login (index.html).
//  v137: Bump cache — revertir tarjeta roja (rectificacion arbitral) en
//         player-actions.js: boton en el modal que deshace la expulsion
//         sin mover al jugador, con registro en auditLogger/matchEvents.
//  v136: Eliminado js/coach/convocation.js (duplicado obsoleto que
//         sobrescribia las funciones canonicas de shared/whatsapp-email.js).
//         Quitado del precache + index.html. Sin perdida de funciones.
//  v134: isClubAdminOf con fallback adminEmail (club_admin sin adminUid lee su club) + saCreateClubConfirm escribe adminUid:null
//         (pending/pending_club_admin accionables + pending_sa solo lectura).
//  v131: Bump cache — fix multi-rol (anadir rol a cuenta existente sin
//         escalada) + badge de Solicitudes del SuperAdmin con conteo real.
//  v130: Bump cache — multi-rol + fallo deleteAuthUser visible/persistente
//         en individual_panel.js y superadmin_panel.js.
//  v129: Bump cache — multi-rol club admin (quitar rol vs eliminar
//         usuario) + fallo deleteAuthUser registrado/visible.
//  v128: Bump cache — fuerza recarga de utils.js (fix export roto
//         que rompia el <script> clasico con SyntaxError).
//  v127: Fix todas las rutas fin partido limpian localStorage +
//         dedup padres por email + clubId staff docs.
//  v126: Guard idempotencia con huella granular (uid+fecha+marcador)
//         + logs diagnostico staffReport en autoDispatchMatchReports.
//  v125: Fix informes duplicados (dedupe rutas endMatch muertas +
//         guard idempotencia persistente en localStorage).
//  v124: Fix nombre superadmin.panel.js en ASSETS, eliminar
//         email-whatsapp.js del precache, quitar ?v= de index.html.
// ─────────────────────────────────────────────────────────────
// CHRONOS FÚTBOL — SERVICE WORKER
// v142: SPRINT 4 — Offline Fallback + Local Icons
// ─────────────────────────────────────────────────────────────
const VERSION = 'v399';
const CACHE_NAME = 'cronos-cache-v455';

const ASSETS = [
    './',
    './index.html',
    './offline.html',
    './privacy.html',
    './manifest.json',
    './style.css',
    './js/core/app-init.js',
    './js/core/setup-modal.js',
    './js/core/patches.js',
    './js/core/security-and-state.js',
    './js/core/utils.js',
    './js/core/pseudonymizer.js',
    './js/core/accessibility-wcag.js',
    './js/core/staff-and-comms.js',
    './js/core/event-listeners.js',
    './js/services/firebase-init.js',
    './js/services/auth.js',
    './js/services/auth/role-launch.js',
    './js/services/auth-improvements.js',
    './js/services/auth/password.js',
    './js/services/firestore-sync.js',
    './js/services/firestore-storage.js',
    './js/services/offline-manager.js',
    './js/services/notification-dismiss-sync.js',
    './js/services/training-firestore-sync.js',
    './js/services/user-management.js',
    './js/match/events/player-actions.js',
    './js/match/demo-tutorial.js',
    './js/match/persistence/active-match.js',
    './js/match/timer/core.js',
    './js/match/events/movement-log.js',
    './js/match/persistence/team-persistence.js',
    './js/match/live/sync.js',
    './js/roster/formations.js',
    './js/roster/legacy-formations.js',
    './js/ui/bench-scroll.js',
    './js/ui/render.js',
    './js/ui/drag-drop.js',
    './js/shared/whatsapp-email.js',
    './js/shared/admin-shared.js',
    './js/ai/import.js',
    './js/admin/superadmin/superadmin.panel.js',
    './js/admin/superadmin/trash.js',
    './js/admin/superadmin/club-slots.js',
    './js/admin/superadmin/extras-toggle.js',
    './js/admin/superadmin/delete-club.js',
    './js/admin/superadmin/create-direct.js',
    './js/admin/superadmin/individual-entity.js',
    './js/admin/superadmin/secretary.js',
    './js/admin/superadmin/individuals-tab.js',
    './js/admin/superadmin/clubs-tab.js',
    './js/admin/superadmin/requests-tab.js',
    './js/admin/superadmin/messaging.js',
    './js/admin/superadmin/extras.js',
    './js/admin/superadmin/billing.js',
    './js/admin/shared/category-tree.js',
    './js/admin/club/panel.js',
    './js/admin/individual/panel.js',
    './js/admin/billing/payments.js',
    './js/admin/billing/ui.js',
    './js/coach/comms/panel.js',
    './js/coach/comms/training-notify.js',
    './js/coach/comms/collective-report.js',
    './js/coach/comms/individual-reports.js',
    './js/coach/comms/contact-manager.js',
    './js/coach/comms/bulk-messaging.js',
    './js/coach/comms/match-reports-send.js',
    './js/coach/comms/match-reports-auto.js',
    './js/coach/reports/report-engine.js',
    './js/coach/reports/club-reports.js',
    './js/coach/reports/director-config.js',
    './js/coach/reports/events-tab.js',
    './js/coach/reports/finished-matches-tab.js',
    './js/coach/reports/reports-tab.js',
    './js/coach/training/panel.js',
    './js/parent/panel.js',
    // SPRINT 4: Iconos locales para PWA
    './public/assets/icons/chronos-192.svg',
    './public/assets/icons/chronos-512.svg',
];

// ── SDK de Firebase (gstatic) ─────────────────────────────────────────
// Sin estos cuatro módulos la app NO ARRANCA sin cobertura: se cargan por
// `import()` desde firebase-init.js y live.html, y hasta ahora el SW los
// excluía a propósito, así que dependían del caché HTTP del navegador. Si
// éste los soltaba, daba igual toda la persistencia de Firestore: no había
// SDK con el que leerla.
//
// Van en su propia lista y con su propio addAll porque son de OTRO ORIGEN:
// si gstatic falla o cambia de política CORS, un addAll único se rechazaría
// entero y dejaría el shell de la app SIN PRECACHEAR, que es peor que no
// tener el SDK. Las URL llevan la versión dentro, así que son inmutables:
// al subir de 10.12.2 cambian las claves y las viejas se van con el
// CACHE_NAME antiguo en el 'activate'.
// v454 · Aquí vivía FIREBASE_SDK, la lista de módulos de gstatic que v447
// precacheaba. Se retira junto con su interceptación: precachear algo que ya
// no se sirve desde la caché no aporta nada, y `cache.addAll` sobre URLs de
// OTRO ORIGEN es además una fuente de fallos de instalación en iOS —
// exactamente el dispositivo donde apareció el problema.

// ══════════════════════════════════════════════════════════════════
//  🔴 v454 · EL SERVICE WORKER NO TOCA EL SDK DE FIREBASE. NUNCA.
//
//  Esto REVIERTE la "Pieza D" de v447, que precacheaba los módulos del SDK
//  (gstatic) y los servía cache-first para que la app arrancase sin cobertura.
//  La idea era buena; la ejecución rompió la aplicación en móvil y en iPad.
//
//  🔑 POR QUÉ: `live.html` importa el SDK con `import` ESTÁTICOS en la cabecera
//  de su módulo. Si UNA sola de esas peticiones devuelve algo que no sea el
//  JavaScript esperado —una respuesta de error, una entrada de caché a medio
//  escribir, o cualquier cosa que el Service Worker fabrique— el módulo ENTERO
//  no se evalúa y la página se queda EN BLANCO. Sin mensaje y sin recuperación.
//
//  v453 hizo imposible el `TypeError: Failed to convert value to 'Response'`,
//  pero eso sólo cambió el sintoma: donde antes había un TypeError pasó a haber
//  un 504 fabricado por nosotros, y el `import` seguía fallando igual. La
//  pantalla negra persistió en los dispositivos del autor.
//
//  ⚠️ LA LECCIÓN: interceptar peticiones de OTRO ORIGEN que alimentan `import`
//  de módulos es asumir una responsabilidad que no nos corresponde. El
//  navegador ya cachea el SDK por su cuenta con las cabeceras de gstatic, y lo
//  hace bien: así funcionó el proyecto hasta v447.
//
//  Coste asumido a conciencia: sin cobertura y con el caché HTTP del navegador
//  vacío, la app no arranca. Es un escenario poco frecuente y RECUPERABLE;
//  una pantalla en negro al abrir el panel en vivo no lo es.
// ══════════════════════════════════════════════════════════════════

// Peticiones que el Service Worker NO intercepta jamás:
//  · googleapis / firebaseio → el canal VIVO de datos. Cachearlo mostraría un
//    marcador muerto.
//  · gstatic/firebasejs      → el CÓDIGO del SDK. Ver el bloque de arriba: que
//    lo sirva el navegador, que para eso está.
function _esCanalVivo(url) {
    return url.includes('googleapis.com') ||
           url.includes('firebaseio.com') ||
           url.includes('gstatic.com');
}

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .catch(err => {
                // Nunca se deja fallar la instalación: un Service Worker que no
                // instala es un Service Worker VIEJO que se queda mandando.
                console.warn(`[SW ${VERSION}] Error al precargar recursos:`, err);
            })
    );
});

// ── ACTIVACIÓN: purgar lo viejo y tomar el control YA ─────────────
// v453 · Reforzado para que nadie tenga que refrescar a mano:
//  · la purga de cachés antiguas NO puede impedir el claim. Antes iba
//    encadenada con `.then`, así que si un `caches.delete` fallaba, la promesa
//    se rechazaba y `clients.claim()` NO LLEGABA A EJECUTARSE: el Service
//    Worker nuevo quedaba activo pero SIN controlar las pestañas abiertas, que
//    seguían con el viejo hasta un refresco manual. Ahora el claim va en un
//    `finally` lógico: pase lo que pase con el borrado, se toma el control.
//  · `skipWaiting()` (en install) + `clients.claim()` (aquí) + el
//    `controllerchange` que ya recarga en index.html y live.html forman la
//    cadena completa: versión nueva → activa al instante → toma las pestañas →
//    se recargan solas. Sin banner, sin Ctrl+Shift+R.
// v454 · PURGA TOTAL DE UN SOLO USO.
// Los dispositivos del autor arrastraban cachés envenenadas de versiones
// anteriores y no bastaba con borrar "las que no son la actual": la caché
// ACTUAL podía contener ya entradas malas escritas por el Service Worker roto
// (respuestas de error guardadas como si fueran buenas). Subiendo este sello se
// fuerza a borrar ABSOLUTAMENTE TODAS las cachés, incluida la del nombre
// vigente, y a repoblarlas desde cero.
// ⚠️ Es un martillo: sólo se sube cuando hay sospecha de caché corrupta en
// dispositivos reales, no en cada versión.
const PURGA_TOTAL = 'v454-limpieza-integral';

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();

            // ¿Toca purga total? Se guarda el sello dentro de la propia caché
            // para saber si este dispositivo ya la hizo.
            let selloPrevio = null;
            try {
                const meta = await caches.open('cronos-meta');
                const r = await meta.match('purga-total');
                if (r) selloPrevio = await r.text();
            } catch (e) { /* sin metadatos: se asume que toca */ }

            const tocaPurgaTotal = selloPrevio !== PURGA_TOTAL;
            const viejas = tocaPurgaTotal
                ? keys.filter(k => k !== 'cronos-meta')       // TODAS
                : keys.filter(k => k !== CACHE_NAME && k !== 'cronos-meta');

            await Promise.all(viejas.map(key => caches.delete(key).catch(() => false)));
            if (viejas.length) {
                console.log(`[SW ${VERSION}] ${tocaPurgaTotal ? '🧹 PURGA TOTAL' : 'Purga'}: ` +
                            `${viejas.length} caché(s) borrada(s):`, viejas);
            }

            if (tocaPurgaTotal) {
                // Repoblar el shell inmediatamente: si no, la primera navegación
                // tras la purga se queda sin red de seguridad.
                try {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.addAll(ASSETS);
                } catch (e) {
                    console.warn(`[SW ${VERSION}] No se pudo repoblar tras la purga:`, e && e.message);
                }
                try {
                    const meta = await caches.open('cronos-meta');
                    await meta.put('purga-total', new Response(PURGA_TOTAL));
                } catch (e) { /* si no se puede sellar, se repetirá: inofensivo */ }
            }
        } catch (e) {
            console.warn(`[SW ${VERSION}] No se pudieron purgar las cachés antiguas:`, e && e.message);
        }
        // Pase lo que pase con la purga, tomar el control de las pestañas.
        try { await self.clients.claim(); }
        catch (e) { console.warn(`[SW ${VERSION}] clients.claim() falló:`, e && e.message); }
    })());
});

// ══════════════════════════════════════════════════════════════════
//  🔑🔑 v453 · TODA RESPUESTA ES UNA `Response`. SIN EXCEPCIONES.
//
//  `event.respondWith()` EXIGE una Response. Si la promesa que recibe se
//  resuelve a `undefined`, el navegador lanza
//      TypeError: Failed to convert value to 'Response'
//  y la petición muere: no cae al comportamiento normal, no se reintenta,
//  simplemente NO HAY RESPUESTA.
//
//  Y `caches.match()` resuelve a `undefined` cuando no hay coincidencia — no
//  rechaza. Ese era exactamente el fallo: el `.catch` de la rama cache-first
//  hacía `return caches.match(request)` como último recurso, así que un
//  recurso NO CACHEADO cuya red fallara respondía `undefined`.
//
//  ⚠️ POR QUÉ SE VOLVIÓ CRÍTICO EN v447 Y NO ANTES: hasta entonces esa rama
//  sólo servía iconos y fuentes, donde fallar es cosmético. En v447 se metió
//  ahí el SDK de Firebase (gstatic) para que la app arrancara sin cobertura.
//  Desde ese momento, un tropiezo de red sobre `firebase-app.js` tumbaba el
//  `import` del módulo y `live.html` se quedaba EN NEGRO, porque su contenido
//  entero lo pinta ese módulo. Obligaba a un Ctrl+Shift+R.
//
//  La cura no es parchear ese `.catch`: es que NINGÚN camino pueda devolver
//  algo que no sea una Response. Por eso las dos estrategias son funciones
//  `async` con su propio último recurso, y además pasan por
//  `_respuestaGarantizada`, que sustituye cualquier valor que no sea una
//  Response por una de verdad. Cinturón y tirantes, a propósito: este fallo
//  no puede repetirse en una demostración.
// ══════════════════════════════════════════════════════════════════

// Último recurso: una Response real y explícita, nunca `undefined`.
function _respuestaDeEmergencia(url, motivo) {
    return new Response(
        'No se pudo obtener el recurso: ' + (motivo || 'desconocido'),
        { status: 504, statusText: 'Gateway Timeout',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
}

// Red de seguridad final. Si algo, en cualquier rama, resuelve a undefined o a
// un valor que no es Response, aquí se convierte en Response antes de llegar a
// respondWith. Es lo que hace IMPOSIBLE el TypeError.
async function _respuestaGarantizada(promesa, url) {
    try {
        const r = await promesa;
        if (r instanceof Response) return r;
        console.warn(`[SW ${VERSION}] Respuesta no válida para ${url}; se sustituye.`);
        return _respuestaDeEmergencia(url, 'respuesta no válida');
    } catch (e) {
        console.warn(`[SW ${VERSION}] Error resolviendo ${url}:`, e && e.message);
        return _respuestaDeEmergencia(url, (e && e.message) || 'excepción');
    }
}

// Guardar en caché nunca puede tumbar la respuesta: va aparte y silencioso.
function _guardaEnCache(request, response) {
    try {
        if (!response || !response.ok) return;
        const copia = response.clone();
        caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, copia))
            .catch(() => {});
    } catch (e) {
        // Guardar en caché JAMÁS puede romper el flujo de la respuesta.
        //
        // ⚠️ Y este comentario va con `//` a propósito, no con `/* */`: es el
        // ÚNICO fichero del proyecto sin comentarios de bloque, y su changelog
        // contiene la cadena `js/admin/superadmin/*` dentro de un comentario de
        // línea (v390). Los limpiadores de comentarios de los guards quitan los
        // bloques ANTES que las líneas, así que ese `/*` abre un bloque que se
        // come todo hasta el primer `*/` del fichero. Introducir aquí un
        // comentario de bloque dejó ciegas 1100 líneas y tumbó 9 aserciones de
        // test_offline_resilience.js sin que nada estuviera roto de verdad.
    }
}

// CACHE FIRST — para lo inmutable: iconos, fuentes, manifest y el SDK.
async function _cacheFirst(request) {
    const cacheado = await caches.match(request).catch(() => undefined);
    if (cacheado) return cacheado;
    try {
        const red = await fetch(request);
        _guardaEnCache(request, red);
        // Puede ser un 404, pero ES una Response: se devuelve tal cual.
        return red;
    } catch (e) {
        // La red falló y no estaba cacheado. Se reintenta la caché por si
        // otra pestaña acaba de guardarlo, y si no, respuesta explícita.
        const segundo = await caches.match(request).catch(() => undefined);
        return segundo || _respuestaDeEmergencia(request.url, 'sin red y sin copia local');
    }
}

// NETWORK FIRST — para el resto: siempre lo más fresco, con la caché detrás.
async function _networkFirst(request) {
    try {
        const red = await fetch(request);
        _guardaEnCache(request, red);
        return red;
    } catch (e) {
        const cacheado = await caches.match(request).catch(() => undefined);
        if (cacheado) return cacheado;

        if (request.destination === 'document') {
            const offline = await caches.match('./offline.html').catch(() => undefined);
            if (offline) return offline;
            return new Response(
                '⚠️ Sin conexión y página no disponible en caché',
                { status: 503, statusText: 'Service Unavailable',
                  headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
            );
        }
        return new Response(
            'Recurso no disponible',
            { status: 404, statusText: 'Not Found',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
    }
}

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (!event.request.url.startsWith('http')) return;

    // No cachear el canal VIVO de Firebase (datos en tiempo real).
    if (_esCanalVivo(event.request.url)) return;

    const req = event.request;
    const url = req.url;

    // CACHE FIRST para iconos, fuentes y assets estáticos PROPIOS.
    // (v454: el SDK de Firebase ya no entra aquí — ver _esCanalVivo.)
    const esInmutable =
        url.includes('/public/assets/icons/') ||
        url.includes('.svg') ||
        url.includes('.woff') ||
        url.includes('.woff2') ||
        url.includes('manifest.json');

    event.respondWith(
        _respuestaGarantizada(esInmutable ? _cacheFirst(req) : _networkFirst(req), url)
    );
});

self.addEventListener('message', event => {
    if (event.data === 'force-update') {
        self.skipWaiting();
    }
    // v229: soporte para mensaje { action: 'skipWaiting' } desde el banner
    // de actualización. Esto activa el nuevo SW inmediatamente.
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});
