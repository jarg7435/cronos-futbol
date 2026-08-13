// ════════════════════════════════════════════════════════════════════
//  CONTROL DE ASISTENCIA — PANTALLAS (2026-08-13)
// ════════════════════════════════════════════════════════════════════
//  Dos vistas sobre el mismo dato:
//
//   · PASAR LISTA — la de diario. Abre en la sesión de HOY y muestra SÓLO
//     los días que el cuadrante tiene programados esa semana. Una fila por
//     jugador y dos botones grandes. Cada toque guarda solo.
//
//   · PARTE MENSUAL — la de revisar. La rejilla jugadores × sesiones con
//     los acumulados y los totales, con selector de mes.
//
//  🔑🔑 POR QUÉ NO ES UNA COLUMNA DE LA TABLA DE PLANTILLA, que es como se
//  pidió al principio: un mes son 30 días × 25 jugadores = 750 celdas dentro
//  de un modal de 800 px que YA scrollea en horizontal, en una app que se usa
//  en el campo con el móvil en la mano. Para marcar el día 13 habría que
//  buscar su columna. Separadas, la de diario cabe en una pantalla de móvil.
//
//  ⚠️ NADA ESPERA A UN BOTÓN GUARDAR. Estas pantallas se repintan enteras
//  (innerHTML) igual que el resto de la app; si la marca viviera en el DOM
//  hasta un guardado final, cambiar de día la perdería.
// ════════════════════════════════════════════════════════════════════

// Estado de navegación de la pantalla. Vive en window porque el modal se
// repinta entero y no puede guardar nada en el DOM.
window._attWeekOffset = 0;      // semanas respecto a la actual
window._attDayKey     = null;   // sesión seleccionada (YYYY-MM-DD)
window._attMonth      = null;   // mes del parte (YYYY-MM)
window._attMes        = { sessions: {}, marks: {} };   // datos del mes cargados
window._attMotivoFor  = null;   // ficha con el selector de motivo desplegado

function _attEsc(s) {
    return (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : s) : String(s == null ? '' : s);
}

function _attNombreEquipo() {
    var eq = (typeof window.cronosMyTeam === 'function') ? window.cronosMyTeam() : null;
    if (!eq) return '';
    if (typeof window._cronosTeamRosterLabel === 'function') {
        return window._cronosTeamRosterLabel(eq.category, eq.subcategory);
    }
    return String(eq.category || '') + ' ' + String(eq.subcategory || '');
}

function _attLunes(offset) {
    var hoy = new Date();
    var d = window.CronosAttendance.lunesDe(hoy);
    d.setDate(d.getDate() + (offset || 0) * 7);
    return d;
}

var _ATT_DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
function _attNombreDia(fecha) {
    var d = new Date(fecha + 'T12:00:00');
    var i = d.getDay();
    return _ATT_DIAS[i === 0 ? 6 : i - 1];
}
function _attDiaMes(fecha) {
    var d = new Date(fecha + 'T12:00:00');
    return d.getDate() + '/' + (d.getMonth() + 1);
}

// ════════════════════════════════════════════════════════════════════
//  PASAR LISTA
// ════════════════════════════════════════════════════════════════════
async function openAttendancePanel() {
    if (typeof navScreen === 'function') navScreen('openAttendancePanel');

    var eq = (typeof window.cronosMyTeam === 'function') ? window.cronosMyTeam() : null;
    if (!eq) {
        if (typeof showToast === 'function') {
            showToast('⚠️ La asistencia es de un equipo: entra con tu rol de entrenador.', 4000);
        }
        if (typeof navBack === 'function') navBack();
        return;
    }

    var modal = document.getElementById('setup-modal');
    if (modal) modal.style.display = 'flex';

    // Sesión por defecto: HOY si hay, si no la primera de la semana.
    var sesiones = window.CronosAttendance.sesionesDeSemana(
        window._cronosLocalDateKey(_attLunes(window._attWeekOffset || 0)));
    var hoyKey = window._cronosLocalDateKey(new Date());
    if (!window._attDayKey || !sesiones.some(function (s) { return s.fecha === window._attDayKey; })) {
        var deHoy = sesiones.filter(function (s) { return s.fecha === hoyKey; })[0];
        window._attDayKey = deHoy ? deHoy.fecha : (sesiones[0] ? sesiones[0].fecha : null);
    }

    // El mes que hace falta es el de la sesión elegida, no el natural: una
    // semana a caballo entre dos meses tiene sesiones en documentos distintos.
    var mes = window.CronosAttendance.mesDe(window._attDayKey || hoyKey);
    window._attMes = await window.CronosAttendance.cargarMes(mes, eq);
    _attRenderSemana();
}

function _attRenderSemana() {
    var modal = document.getElementById('setup-modal');
    if (!modal) return;

    var isMobile = window.innerWidth < 640;
    var offset   = window._attWeekOffset || 0;
    var lunes    = _attLunes(offset);
    var domingo  = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
    var weekKey  = window._cronosLocalDateKey(lunes);

    var sesiones = window.CronosAttendance.sesionesDeSemana(weekKey);
    var plantel  = window.CronosAttendance.jugadores();
    var marks    = (window._attMes && window._attMes.marks) || {};
    var fmtD     = function (d) { return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); };

    var sel = null;
    for (var i = 0; i < sesiones.length; i++) if (sesiones[i].fecha === window._attDayKey) sel = sesiones[i];

    // ── Cabecera ────────────────────────────────────────────────────
    var html = '' +
    '<div class="modal-content" style="width:min(98vw,1000px); max-height:94vh; display:flex; flex-direction:column; overflow-y:auto; padding:' + (isMobile ? '0.6rem' : '1.3rem') + ';">' +
      '<div style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.7rem;">' +
        '<div>' +
          '<h2 style="margin:0 0 0.05rem; font-size:' + (isMobile ? '1rem' : '1.3rem') + ';">✅ Asistencia</h2>' +
          '<p style="font-size:0.72rem; color:var(--text-muted); margin:0;">' + _attEsc(_attNombreEquipo()) + '</p>' +
        '</div>' +
        '<div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">' +
          '<button class="btn" onclick="_attCambiarSemana(-1)" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">◀</button>' +
          '<span style="font-size:0.8rem; font-weight:700; color:white; min-width:' + (isMobile ? '120px' : '175px') + '; text-align:center;">' +
            fmtD(lunes) + ' — ' + fmtD(domingo) + '</span>' +
          '<button class="btn" onclick="_attCambiarSemana(1)" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">▶</button>' +
          '<button class="btn" onclick="_attHoy()" style="padding:0.35rem 0.7rem; font-size:0.68rem; background:rgba(88,166,255,0.12); border-color:rgba(88,166,255,0.3); color:#58a6ff;">HOY</button>' +
          '<button class="btn" onclick="openAttendanceMonth()" title="Parte mensual con los acumulados" style="padding:0.35rem 0.7rem; font-size:0.68rem; background:rgba(210,168,255,0.12); border-color:rgba(210,168,255,0.4); color:#d2a8ff; font-weight:700;">📅 PARTE MENSUAL</button>' +
          '<button class="btn" onclick="navBack()" style="padding:0.35rem 0.7rem; font-size:0.68rem;">← VOLVER</button>' +
          '<button class="btn" onclick="if(typeof navExitToRoles===\'function\') navExitToRoles(); else navExit();" title="Salir al selector de roles" style="padding:0.35rem 0.6rem; font-size:0.8rem; color:var(--text-muted);">✕</button>' +
        '</div>' +
      '</div>';

    // ── Sin sesiones: se dice POR QUÉ y qué hacer ────────────────────
    if (!sesiones.length) {
        html += '' +
        '<div style="padding:2rem 1rem; text-align:center; border:1px dashed var(--glass-border); border-radius:12px;">' +
          '<div style="font-size:2rem; margin-bottom:0.5rem;">🗓️</div>' +
          '<div style="font-weight:700; margin-bottom:0.4rem;">Esta semana no tiene sesiones programadas</div>' +
          '<div style="font-size:0.8rem; color:var(--text-muted); line-height:1.6; max-width:460px; margin:0 auto;">' +
            'La asistencia se pasa sobre los días de tu <strong>Planificación Semanal</strong>. ' +
            'Programa los entrenamientos y partidos de la semana —cada día necesita su <strong>TIPO</strong>— y aparecerán aquí.' +
          '</div>' +
          '<button class="btn" onclick="openTrainingPanel()" style="margin-top:1rem; background:rgba(63,185,80,0.15); border:1px solid rgba(63,185,80,0.4); color:#3fb950; font-weight:700;">🏃 IR A LA PLANIFICACIÓN</button>' +
        '</div></div>';
        modal.innerHTML = html;
        return;
    }

    // ── Pestañas de sesión ──────────────────────────────────────────
    var fichas = plantel.map(function (p) { return p.ficha; });
    html += '<div style="display:flex; gap:0.4rem; overflow-x:auto; padding-bottom:0.5rem; margin-bottom:0.7rem; flex-shrink:0;">';
    sesiones.forEach(function (s) {
        var activa = s.fecha === window._attDayKey;
        var res = window.CronosAttendance.resumenSesion(marks, s.fecha, fichas);
        var hechas = res.P + res.I + res.J;
        var icono = s.tipo === 'partido' ? '⚽' : '🏃';
        var col = s.tipo === 'partido' ? '#f0883e' : '#3fb950';
        html += '' +
        '<button onclick="_attElegirDia(\'' + s.fecha + '\')" style="' +
          'flex-shrink:0; cursor:pointer; text-align:center; padding:0.45rem 0.7rem; border-radius:10px;' +
          'border:1px solid ' + (activa ? col : 'var(--glass-border)') + ';' +
          'background:' + (activa ? 'rgba(255,255,255,0.07)' : 'transparent') + ';' +
          'color:var(--text); min-width:74px;">' +
          '<div style="font-size:0.72rem; font-weight:700; color:' + col + ';">' + icono + ' ' + _attNombreDia(s.fecha) + '</div>' +
          '<div style="font-size:0.66rem; color:var(--text-muted);">' + _attDiaMes(s.fecha) + '</div>' +
          '<div style="font-size:0.62rem; margin-top:2px; color:' + (hechas ? '#58a6ff' : 'var(--text-muted)') + ';">' + hechas + '/' + fichas.length + '</div>' +
        '</button>';
    });
    html += '</div>';

    if (!plantel.length) {
        html += '' +
        '<div style="padding:2rem 1rem; text-align:center; border:1px dashed var(--glass-border); border-radius:12px;">' +
          '<div style="font-size:2rem; margin-bottom:0.5rem;">👥</div>' +
          '<div style="font-weight:700; margin-bottom:0.4rem;">Tu plantilla está vacía</div>' +
          '<div style="font-size:0.8rem; color:var(--text-muted);">Rellena la plantilla y pulsa GUARDAR para poder pasar lista.</div>' +
        '</div></div>';
        modal.innerHTML = html;
        return;
    }

    // ── Resumen de la sesión elegida ────────────────────────────────
    var resSel = window.CronosAttendance.resumenSesion(marks, window._attDayKey, fichas);
    html += '' +
    '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.6rem;' +
    '            padding:0.6rem 0.8rem; margin-bottom:0.6rem; border-radius:10px;' +
    '            background:rgba(88,166,255,0.06); border:1px solid rgba(88,166,255,0.18);">' +
      '<div style="font-size:0.78rem;">' +
        '<strong>' + (sel && sel.tipo === 'partido' ? '⚽ Partido' : '🏃 Entrenamiento') + '</strong>' +
        (sel && sel.hora ? ' · 🕐 ' + _attEsc(sel.hora) : '') +
        (sel && sel.lugar ? ' · 🏟️ ' + _attEsc(sel.lugar) : '') +
      '</div>' +
      '<div style="display:flex; gap:0.7rem; align-items:center; flex-wrap:wrap; font-size:0.78rem; font-weight:700;">' +
        '<span style="color:#3fb950;">✅ ' + resSel.P + '</span>' +
        '<span style="color:#ff5858;">❌ ' + resSel.I + '</span>' +
        '<span style="color:#f0883e;">🩹 ' + resSel.J + '</span>' +
        '<span style="color:var(--text-muted); font-weight:400;">sin marcar ' + resSel.sinMarcar + '</span>' +
        '<button class="btn" onclick="_attTodosPresentes()" title="Marca presente a todos los que aún no tienen marca"' +
        ' style="padding:0.3rem 0.6rem; font-size:0.68rem; background:rgba(63,185,80,0.15); border:1px solid rgba(63,185,80,0.4); color:#3fb950; font-weight:700;">✅ TODOS PRESENTES</button>' +
      '</div>' +
    '</div>';

    // ── Lista de jugadores ──────────────────────────────────────────
    var mesActual  = window.CronosAttendance.mesDe(window._attDayKey);
    var sesionesMes = window.CronosAttendance.sesionesDeMes(mesActual);

    html += '<div style="flex:1; display:flex; flex-direction:column; gap:0.35rem;">';
    plantel.forEach(function (p) {
        var m = (marks[window._attDayKey] || {})[p.ficha] || null;
        var estado = m && m.s ? m.s : '';
        var rSem = window.CronosAttendance.resumenJugador(marks, sesiones, p.ficha);
        var rMes = window.CronosAttendance.resumenJugador(marks, sesionesMes, p.ficha);

        var fondo = estado === 'P' ? 'rgba(63,185,80,0.08)'
                  : estado === 'I' ? 'rgba(255,88,88,0.08)'
                  : estado === 'J' ? 'rgba(240,136,62,0.08)' : 'transparent';
        var borde = estado === 'P' ? 'rgba(63,185,80,0.35)'
                  : estado === 'I' ? 'rgba(255,88,88,0.35)'
                  : estado === 'J' ? 'rgba(240,136,62,0.35)' : 'var(--glass-border)';

        html += '' +
        '<div style="border:1px solid ' + borde + '; background:' + fondo + '; border-radius:10px; padding:0.45rem 0.6rem;">' +
          '<div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">' +
            '<span style="flex-shrink:0; min-width:26px; text-align:center; font-weight:700; font-size:0.8rem; color:var(--primary);">' + _attEsc(p.dorsal) + '</span>' +
            '<span style="flex:1; min-width:110px; font-size:0.85rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
              _attEsc(p.alias || p.nombre) +
              (p.isGuest ? '<span style="margin-left:0.35rem; font-size:0.6rem; font-weight:700; color:#d2a8ff; background:rgba(210,168,255,0.12); border:1px solid rgba(210,168,255,0.3); padding:1px 5px; border-radius:5px;">' + _attEsc(p.origen.trim()) + '</span>' : '') +
            '</span>' +
            '<span title="Semana · Mes" style="flex-shrink:0; font-size:0.64rem; color:var(--text-muted); white-space:nowrap;">' +
              'S ' + rSem.P + '/' + (rSem.registradas || 0) + ' · M ' + rMes.P + '/' + (rMes.registradas || 0) +
              (rMes.pct != null ? ' · ' + rMes.pct + '%' : '') +
            '</span>' +
            '<span style="flex-shrink:0; display:flex; gap:0.3rem;">' +
              '<button onclick="_attMarcar(\'' + _attEsc(p.ficha) + '\',\'P\')" title="Presente" style="cursor:pointer; border-radius:8px; padding:0.3rem 0.6rem; font-size:0.9rem;' +
                'border:1px solid ' + (estado === 'P' ? '#3fb950' : 'var(--glass-border)') + ';' +
                'background:' + (estado === 'P' ? 'rgba(63,185,80,0.25)' : 'transparent') + '; color:' + (estado === 'P' ? '#3fb950' : 'var(--text-muted)') + ';">✅</button>' +
              '<button onclick="_attAbrirMotivo(\'' + _attEsc(p.ficha) + '\')" title="Falta" style="cursor:pointer; border-radius:8px; padding:0.3rem 0.6rem; font-size:0.9rem;' +
                'border:1px solid ' + (estado === 'I' ? '#ff5858' : (estado === 'J' ? '#f0883e' : 'var(--glass-border)')) + ';' +
                'background:' + (estado === 'I' ? 'rgba(255,88,88,0.25)' : (estado === 'J' ? 'rgba(240,136,62,0.25)' : 'transparent')) + ';' +
                'color:' + (estado === 'I' ? '#ff5858' : (estado === 'J' ? '#f0883e' : 'var(--text-muted)')) + ';">' + (estado === 'J' ? '🩹' : '❌') + '</button>' +
            '</span>' +
          '</div>';

        // Etiqueta del motivo, cuando la falta es justificada
        if (estado === 'J' && m.m) {
            html += '<div style="margin-top:0.3rem; font-size:0.68rem; color:#f0883e;">🩹 ' +
                    _attEsc(window.CronosAttendance.motivoLabel(m.m)) + '</div>';
        }

        // Selector de causa, desplegado bajo la fila que se está marcando
        if (window._attMotivoFor === p.ficha) {
            html += '<div style="margin-top:0.5rem; padding-top:0.5rem; border-top:1px dashed var(--glass-border); display:flex; gap:0.35rem; flex-wrap:wrap;">' +
              '<span style="font-size:0.68rem; color:var(--text-muted); align-self:center; margin-right:0.2rem;">Causa:</span>' +
              '<button onclick="_attMarcar(\'' + _attEsc(p.ficha) + '\',\'I\')" style="cursor:pointer; font-size:0.7rem; font-weight:700; padding:0.3rem 0.6rem; border-radius:8px; border:1px solid rgba(255,88,88,0.45); background:rgba(255,88,88,0.12); color:#ff5858;">Injustificada</button>';
            window.CronosAttendance.MOTIVOS.forEach(function (mo) {
                html += '<button onclick="_attMarcar(\'' + _attEsc(p.ficha) + '\',\'J\',\'' + mo.id + '\')" style="cursor:pointer; font-size:0.7rem; padding:0.3rem 0.6rem; border-radius:8px; border:1px solid rgba(240,136,62,0.4); background:rgba(240,136,62,0.1); color:#f0883e;">' + mo.icon + ' ' + _attEsc(mo.label) + '</button>';
            });
            if (estado) {
                html += '<button onclick="_attDesmarcar(\'' + _attEsc(p.ficha) + '\')" title="Quitar la marca de este jugador" style="cursor:pointer; font-size:0.7rem; padding:0.3rem 0.6rem; border-radius:8px; border:1px solid var(--glass-border); background:transparent; color:var(--text-muted);">↺ Sin marcar</button>';
            }
            html += '</div>';
        }

        html += '</div>';
    });
    html += '</div>';

    html += '<p style="margin-top:0.8rem; font-size:0.68rem; color:var(--text-muted); text-align:center;">' +
            'Cada marca se guarda al instante. <strong>S</strong> = esta semana · <strong>M</strong> = este mes.</p>';
    html += '</div>';

    modal.innerHTML = html;
}

// ── Acciones ────────────────────────────────────────────────────────
// Al salir de la sesión que se está marcando se fuerza la publicación de los
// extractos pendientes, en vez de esperar al retardo: el entrenador puede
// cerrar la app justo después y los padres se quedarían sin ver la falta.
function _attSoltarPendientes() {
    try { if (window.CronosAttendance) window.CronosAttendance.publicarYa(); } catch (e) {}
}
if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', _attSoltarPendientes);
}

window._attCambiarSemana = async function (delta) {
    _attSoltarPendientes();
    window._attWeekOffset = (window._attWeekOffset || 0) + delta;
    window._attDayKey = null;
    window._attMotivoFor = null;
    await openAttendancePanel();
};

window._attHoy = async function () {
    window._attWeekOffset = 0;
    window._attDayKey = null;
    window._attMotivoFor = null;
    await openAttendancePanel();
};

window._attElegirDia = async function (fecha) {
    window._attMotivoFor = null;
    var mesAntes = window.CronosAttendance.mesDe(window._attDayKey || '');
    window._attDayKey = fecha;
    // Cambiar de día puede cambiar de MES, y el mes es otro documento.
    if (window.CronosAttendance.mesDe(fecha) !== mesAntes) {
        var eq = window.cronosMyTeam();
        window._attMes = await window.CronosAttendance.cargarMes(window.CronosAttendance.mesDe(fecha), eq);
    }
    _attRenderSemana();
};

// Abre el selector de causa. Si ya estaba abierto para ese jugador, lo cierra:
// así el mismo botón sirve para desplegar y para arrepentirse.
window._attAbrirMotivo = function (ficha) {
    window._attMotivoFor = (window._attMotivoFor === ficha) ? null : ficha;
    _attRenderSemana();
};

window._attMarcar = function (ficha, estado, motivo) {
    var sel = null;
    var sesiones = window.CronosAttendance.sesionesDeSemana(
        window._cronosLocalDateKey(_attLunes(window._attWeekOffset || 0)));
    for (var i = 0; i < sesiones.length; i++) if (sesiones[i].fecha === window._attDayKey) sel = sesiones[i];

    var okMarca = window.CronosAttendance.marcar(window._attDayKey, ficha, estado, motivo, sel);
    if (!okMarca) {
        if (typeof showToast === 'function') showToast('⚠️ No se pudo guardar la marca', 3000);
        return;
    }
    // Refrescar la copia en memoria desde la caché, que es donde marcar()
    // acaba de escribir.
    var eq = window.cronosMyTeam();
    if (eq) {
        window._attMes = window.CronosAttendance._mesLocal(
            window.CronosAttendance.docId(eq.teamId, window.CronosAttendance.mesDe(window._attDayKey)));
    }
    window._attMotivoFor = null;
    _attRenderSemana();
};

window._attDesmarcar = function (ficha) {
    window.CronosAttendance.desmarcar(window._attDayKey, ficha);
    var eq = window.cronosMyTeam();
    if (eq) {
        window._attMes = window.CronosAttendance._mesLocal(
            window.CronosAttendance.docId(eq.teamId, window.CronosAttendance.mesDe(window._attDayKey)));
    }
    window._attMotivoFor = null;
    _attRenderSemana();
};

// Marca presente a TODOS los que aún no tienen marca. No pisa a los ya
// marcados: el entrenador suele señalar primero las tres ausencias que sabe
// y rematar con este botón, y si machacara sus faltas sería una trampa.
window._attTodosPresentes = function () {
    var sesiones = window.CronosAttendance.sesionesDeSemana(
        window._cronosLocalDateKey(_attLunes(window._attWeekOffset || 0)));
    var sel = null;
    for (var i = 0; i < sesiones.length; i++) if (sesiones[i].fecha === window._attDayKey) sel = sesiones[i];

    var marks = (window._attMes && window._attMes.marks) || {};
    var dia = marks[window._attDayKey] || {};
    var n = 0;
    window.CronosAttendance.jugadores().forEach(function (p) {
        if (dia[p.ficha] && dia[p.ficha].s) return;
        if (window.CronosAttendance.marcar(window._attDayKey, p.ficha, 'P', null, sel)) n++;
    });

    var eq = window.cronosMyTeam();
    if (eq) {
        window._attMes = window.CronosAttendance._mesLocal(
            window.CronosAttendance.docId(eq.teamId, window.CronosAttendance.mesDe(window._attDayKey)));
    }
    if (typeof showToast === 'function') showToast('✅ ' + n + ' marcados como presentes', 2500);
    _attRenderSemana();
};

// ════════════════════════════════════════════════════════════════════
//  DISTINTIVO DE ASISTENCIA EN LA CONVOCATORIA
// ════════════════════════════════════════════════════════════════════
//  Rellena los <span class="conv-att"> que openConvocationModal deja
//  preparados, con la asistencia de las últimas 4 semanas.
//
//  🔑 NO REPINTA NADA: escribe sobre los spans ya existentes. La rejilla de
//  convocatoria guarda el estado de cada jugador (convocado / titular) en
//  atributos del DOM, así que reconstruirla se llevaría por delante la
//  selección en curso.
//
//  ⚠️ Es informativo. No bloquea, no ordena la lista y no descarta a nadie:
//  la decisión sigue siendo del entrenador.
window._cronosPintarAsistenciaConv = async function () {
    if (!window.CronosAttendance) return;
    var spans = document.querySelectorAll('.conv-att[data-att-ficha]');
    if (!spans.length) return;

    try { await window.CronosAttendance.precargarMeses(28); } catch (e) { return; }

    // La pantalla puede haber cambiado mientras se cargaba.
    spans = document.querySelectorAll('.conv-att[data-att-ficha]');
    for (var i = 0; i < spans.length; i++) {
        var el = spans[i];
        var ficha = el.getAttribute('data-att-ficha') || '';
        if (!ficha) continue;

        var r = null;
        try { r = window.CronosAttendance.resumenReciente(ficha, 28); } catch (e) { r = null; }
        if (!r || !r.registradas) { el.style.display = 'none'; continue; }

        var pct = r.pct == null ? 0 : r.pct;
        var col = pct >= 80 ? '#3fb950' : (pct >= 60 ? '#f0883e' : '#ff5858');
        var fondo = pct >= 80 ? 'rgba(63,185,80,0.15)'
                  : (pct >= 60 ? 'rgba(240,136,62,0.15)' : 'rgba(255,88,88,0.15)');

        el.textContent = r.P + '/' + r.registradas + (r.I ? ' ⚠' : '');
        el.title = 'Últimas 4 semanas: ' + r.P + ' de ' + r.registradas + ' sesiones (' + pct + '%)' +
                   (r.I ? ' · ' + r.I + ' falta(s) injustificada(s)' : '') +
                   (r.J ? ' · ' + r.J + ' justificada(s)' : '');
        el.style.background = fondo;
        el.style.color = col;
        el.style.display = '';
    }
};

// ════════════════════════════════════════════════════════════════════
//  PARTE MENSUAL
// ════════════════════════════════════════════════════════════════════
async function openAttendanceMonth() {
    _attSoltarPendientes();
    if (typeof navScreen === 'function') navScreen('openAttendanceMonth');

    var eq = (typeof window.cronosMyTeam === 'function') ? window.cronosMyTeam() : null;
    if (!eq) { if (typeof navBack === 'function') navBack(); return; }

    if (!window._attMonth) {
        window._attMonth = window.CronosAttendance.mesDe(
            window._attDayKey || window._cronosLocalDateKey(new Date()));
    }
    window._attMes = await window.CronosAttendance.cargarMes(window._attMonth, eq);
    _attRenderMes();
}

window._attCambiarMes = async function (delta) {
    var y = parseInt(window._attMonth.slice(0, 4), 10);
    var m = parseInt(window._attMonth.slice(5, 7), 10) + delta;
    var d = new Date(y, m - 1, 1, 12, 0, 0);
    window._attMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    await openAttendanceMonth();
};

function _attRenderMes() {
    var modal = document.getElementById('setup-modal');
    if (!modal) return;

    var isMobile = window.innerWidth < 640;
    var mes      = window._attMonth;
    var sesiones = window.CronosAttendance.sesionesDeMes(mes);
    var plantel  = window.CronosAttendance.jugadores();
    var marks    = (window._attMes && window._attMes.marks) || {};

    var nombreMes = new Date(parseInt(mes.slice(0, 4), 10), parseInt(mes.slice(5, 7), 10) - 1, 1)
        .toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    var html = '' +
    '<div class="modal-content" style="width:min(98vw,1200px); max-height:94vh; display:flex; flex-direction:column; overflow-y:auto; padding:' + (isMobile ? '0.6rem' : '1.3rem') + ';">' +
      '<div style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.8rem;">' +
        '<div>' +
          '<h2 style="margin:0 0 0.05rem; font-size:' + (isMobile ? '1rem' : '1.3rem') + ';">📅 Parte mensual de asistencia</h2>' +
          '<p style="font-size:0.72rem; color:var(--text-muted); margin:0;">' + _attEsc(_attNombreEquipo()) + '</p>' +
        '</div>' +
        '<div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">' +
          '<button class="btn" onclick="_attCambiarMes(-1)" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">◀</button>' +
          '<span style="font-size:0.8rem; font-weight:700; color:white; min-width:' + (isMobile ? '120px' : '160px') + '; text-align:center; text-transform:capitalize;">' + _attEsc(nombreMes) + '</span>' +
          '<button class="btn" onclick="_attCambiarMes(1)" style="padding:0.35rem 0.6rem; font-size:0.85rem; line-height:1;">▶</button>' +
          '<button class="btn" onclick="openAttendancePanel()" style="padding:0.35rem 0.7rem; font-size:0.68rem; background:rgba(63,185,80,0.12); border-color:rgba(63,185,80,0.35); color:#3fb950; font-weight:700;">✅ PASAR LISTA</button>' +
          '<button class="btn" onclick="navBack()" style="padding:0.35rem 0.7rem; font-size:0.68rem;">← VOLVER</button>' +
        '</div>' +
      '</div>';

    if (!sesiones.length || !plantel.length) {
        html += '<div style="padding:2rem 1rem; text-align:center; border:1px dashed var(--glass-border); border-radius:12px;">' +
                '<div style="font-size:2rem; margin-bottom:0.5rem;">🗓️</div>' +
                '<div style="font-weight:700;">Sin sesiones registradas en este mes</div>' +
                '<div style="font-size:0.8rem; color:var(--text-muted); margin-top:0.4rem;">Las sesiones salen de la Planificación Semanal.</div>' +
                '</div></div>';
        modal.innerHTML = html;
        return;
    }

    // ── Rejilla ─────────────────────────────────────────────────────
    // ⚠️ La tabla scrollea DENTRO de su contenedor. Un mes con 20 sesiones
    // no cabe en un móvil y sin este overflow el modal entero se desplazaría
    // en horizontal.
    html += '<div style="flex:1; overflow:auto; border:1px solid var(--glass-border); border-radius:12px;">' +
            '<table style="border-collapse:collapse; font-size:0.72rem; min-width:100%;">' +
            '<thead><tr style="background:rgba(88,166,255,0.08);">' +
            '<th style="position:sticky; left:0; z-index:2; background:#12161c; padding:0.5rem 0.6rem; text-align:left; white-space:nowrap; border-bottom:2px solid rgba(88,166,255,0.25);">JUGADOR</th>';

    sesiones.forEach(function (s) {
        var icono = s.tipo === 'partido' ? '⚽' : '🏃';
        var col = s.tipo === 'partido' ? '#f0883e' : '#3fb950';
        html += '<th title="' + _attEsc(s.tipoRaw) + (s.lugar ? ' · ' + _attEsc(s.lugar) : '') + '" style="padding:0.4rem 0.25rem; border-bottom:2px solid rgba(88,166,255,0.25); color:' + col + '; font-size:0.62rem; white-space:nowrap;">' +
                icono + '<br>' + _attDiaMes(s.fecha) + '</th>';
    });

    html += '<th style="padding:0.4rem 0.5rem; border-bottom:2px solid rgba(88,166,255,0.25); color:#3fb950; white-space:nowrap;">✅</th>' +
            '<th style="padding:0.4rem 0.5rem; border-bottom:2px solid rgba(88,166,255,0.25); color:#ff5858; white-space:nowrap;">❌</th>' +
            '<th style="padding:0.4rem 0.5rem; border-bottom:2px solid rgba(88,166,255,0.25); color:#f0883e; white-space:nowrap;">🩹</th>' +
            '<th style="padding:0.4rem 0.5rem; border-bottom:2px solid rgba(88,166,255,0.25); color:var(--primary); white-space:nowrap;">%</th>' +
            '</tr></thead><tbody>';

    plantel.forEach(function (p) {
        var r = window.CronosAttendance.resumenJugador(marks, sesiones, p.ficha);
        html += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);">' +
                '<td style="position:sticky; left:0; z-index:1; background:#12161c; padding:0.35rem 0.6rem; white-space:nowrap;">' +
                  '<span style="color:var(--primary); font-weight:700;">' + _attEsc(p.dorsal) + '</span> ' + _attEsc(p.alias || p.nombre) +
                '</td>';
        sesiones.forEach(function (s) {
            var m = (marks[s.fecha] || {})[p.ficha];
            var txt = '·', col = 'rgba(255,255,255,0.15)', tit = 'Sin marcar';
            if (m && m.s === 'P') { txt = '✅'; col = '#3fb950'; tit = 'Presente'; }
            else if (m && m.s === 'I') { txt = '❌'; col = '#ff5858'; tit = 'Falta injustificada'; }
            else if (m && m.s === 'J') { txt = '🩹'; col = '#f0883e'; tit = 'Justificada: ' + window.CronosAttendance.motivoLabel(m.m); }
            html += '<td title="' + _attEsc(tit) + '" style="text-align:center; padding:0.3rem 0.2rem; color:' + col + ';">' + txt + '</td>';
        });
        html += '<td style="text-align:center; font-weight:700; color:#3fb950;">' + r.P + '</td>' +
                '<td style="text-align:center; font-weight:700; color:#ff5858;">' + r.I + '</td>' +
                '<td style="text-align:center; font-weight:700; color:#f0883e;">' + r.J + '</td>' +
                '<td style="text-align:center; font-weight:700; color:var(--primary);">' + (r.pct == null ? '—' : r.pct + '%') + '</td>' +
                '</tr>';
    });

    // ── Sumatoria final ─────────────────────────────────────────────
    var fichas = plantel.map(function (x) { return x.ficha; });
    var totP = 0, totI = 0, totJ = 0;
    html += '<tr style="background:rgba(88,166,255,0.06); border-top:2px solid rgba(88,166,255,0.25);">' +
            '<td style="position:sticky; left:0; z-index:1; background:#12161c; padding:0.45rem 0.6rem; font-weight:700; white-space:nowrap;">TOTAL PRESENTES</td>';
    sesiones.forEach(function (s) {
        var rs = window.CronosAttendance.resumenSesion(marks, s.fecha, fichas);
        totP += rs.P; totI += rs.I; totJ += rs.J;
        html += '<td style="text-align:center; padding:0.35rem 0.2rem; font-weight:700; color:#58a6ff;">' + rs.P + '</td>';
    });
    html += '<td style="text-align:center; font-weight:700; color:#3fb950;">' + totP + '</td>' +
            '<td style="text-align:center; font-weight:700; color:#ff5858;">' + totI + '</td>' +
            '<td style="text-align:center; font-weight:700; color:#f0883e;">' + totJ + '</td>' +
            '<td style="text-align:center; font-weight:700; color:var(--primary);">' +
              ((totP + totI + totJ) ? Math.round(totP / (totP + totI + totJ) * 100) + '%' : '—') + '</td>' +
            '</tr>';

    html += '</tbody></table></div>';

    // ── Desglose de faltas ──────────────────────────────────────────
    var porMotivo = {}, faltasPartido = 0, faltasEntreno = 0;
    plantel.forEach(function (p) {
        var r = window.CronosAttendance.resumenJugador(marks, sesiones, p.ficha);
        faltasPartido += r.faltasPartido;
        faltasEntreno += r.faltasEntreno;
        Object.keys(r.motivos).forEach(function (k) { porMotivo[k] = (porMotivo[k] || 0) + r.motivos[k]; });
    });

    html += '<div style="margin-top:0.9rem; padding:0.8rem 1rem; border-radius:10px; background:var(--glass); border:1px solid var(--glass-border);">' +
            '<div style="font-size:0.75rem; font-weight:700; color:var(--text-muted); margin-bottom:0.5rem;">📊 DESGLOSE DE FALTAS DEL MES</div>' +
            '<div style="display:flex; gap:1.2rem; flex-wrap:wrap; font-size:0.78rem;">' +
              '<span>Total faltas: <strong style="color:#ff5858;">' + (totI + totJ) + '</strong></span>' +
              '<span>Injustificadas: <strong style="color:#ff5858;">' + totI + '</strong></span>' +
              '<span>Justificadas: <strong style="color:#f0883e;">' + totJ + '</strong></span>' +
              '<span title="Faltar a un partido no pesa igual que faltar a un entrenamiento">⚽ a partidos: <strong style="color:#f0883e;">' + faltasPartido + '</strong></span>' +
              '<span>🏃 a entrenamientos: <strong style="color:#f0883e;">' + faltasEntreno + '</strong></span>' +
            '</div>';

    var motivosTxt = window.CronosAttendance.MOTIVOS
        .filter(function (mo) { return porMotivo[mo.id]; })
        .map(function (mo) { return mo.icon + ' ' + _attEsc(mo.label) + ': <strong>' + porMotivo[mo.id] + '</strong>'; })
        .join(' &nbsp;·&nbsp; ');
    if (motivosTxt) {
        html += '<div style="margin-top:0.5rem; font-size:0.75rem; color:var(--text-muted);">' + motivosTxt + '</div>';
    }
    html += '</div>';

    html += '</div>';
    modal.innerHTML = html;
}
