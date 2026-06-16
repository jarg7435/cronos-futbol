/**
 * billing.js — Sistema de Facturación Cronos Fútbol v1.0
 * SuperAdmin: gestión de planes, suscripciones, facturas y resumen mensual
 * Club Admin: vista de suscripción y facturas del club
 * Administrador Individual: vista de suscripción personal
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTES DE PLANES POR DEFECTO
// El SA puede editarlas desde el panel — estos son los valores iniciales
// ═══════════════════════════════════════════════════════════════════

window.BILLING_PLAN_DEFAULTS = [
    {
        code: 'free',
        name: 'Gratuito',
        icon: '🆓',
        color: '#8b949e',
        description: 'Acceso básico sin coste',
        monthlyPrice: 0,
        annualPrice: 0,
        trialDays: 0,
        maxUsers: 5,
        maxPlayers: 15,
        features: ['Cronómetros individuales', 'Seguimiento en vivo (1 partido)', 'Panel básico'],
        targetType: 'both',
        status: 'active',
    },
    {
        code: 'trial',
        name: 'Prueba',
        icon: '🎯',
        color: '#f0883e',
        description: 'Período de prueba gratuito',
        monthlyPrice: 0,
        annualPrice: 0,
        trialDays: 30,
        maxUsers: 20,
        maxPlayers: 50,
        features: ['Todo incluido durante el período de prueba', 'Sin tarjeta de crédito'],
        targetType: 'both',
        status: 'active',
    },
    {
        code: 'basic',
        name: 'Básico',
        icon: '⭐',
        color: '#58a6ff',
        description: 'Para equipos pequeños o individuales',
        monthlyPrice: null,
        annualPrice: null,
        trialDays: 14,
        maxUsers: 30,
        maxPlayers: 100,
        features: ['Cronómetros individuales', 'Informes post-partido', 'Seguimiento en vivo', 'Convocatorias'],
        targetType: 'both',
        status: 'active',
    },
    {
        code: 'pro',
        name: 'Profesional',
        icon: '🚀',
        color: '#d2a8ff',
        description: 'Para clubs con múltiples equipos',
        monthlyPrice: null,
        annualPrice: null,
        trialDays: 14,
        maxUsers: 100,
        maxPlayers: 500,
        features: ['Todo lo de Básico', 'Múltiples equipos', 'Informes avanzados', 'Exportación CSV', 'Soporte prioritario'],
        targetType: 'club',
        status: 'active',
    },
    {
        code: 'premium',
        name: 'Premium',
        icon: '👑',
        color: '#ffd700',
        description: 'Para clubs de alto rendimiento',
        monthlyPrice: null,
        annualPrice: null,
        trialDays: 14,
        maxUsers: null,
        maxPlayers: null,
        features: ['Todo ilimitado', 'API acceso', 'Informes personalizados', 'Gestor de cuenta dedicado', 'SLA garantizado'],
        targetType: 'club',
        status: 'active',
    },
];

// ═══════════════════════════════════════════════════════════════════
// HELPERS INTERNOS
// ═══════════════════════════════════════════════════════════════════

function _billingFS() { return saFS(); }

function _fmtPrice(p) {
    if (p === null || p === undefined) return '<span style="color:#8b949e">Por definir</span>';
    if (p === 0) return '<span style="color:#3fb950">Gratis</span>';
    return `<strong>${Number(p).toFixed(2)} €</strong>`;
}

function _fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('es-ES'); } catch { return iso; }
}

function _statusBadge(status) {
    const map = {
        active:    { color: '#3fb950', label: 'Activo' },
        trial:     { color: '#f0883e', label: 'Prueba' },
        expired:   { color: '#f85149', label: 'Expirado' },
        cancelled: { color: '#8b949e', label: 'Cancelado' },
        pending:   { color: '#ffd700', label: 'Pendiente' },
        paid:      { color: '#3fb950', label: 'Pagada' },
        free:      { color: '#8b949e', label: 'Gratuito' },
    };
    const s = map[status] || { color: '#8b949e', label: status };
    return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:700;background:${s.color}22;color:${s.color}">${s.label}</span>`;
}

function _planBadge(planCode) {
    const plan = (window.BILLING_PLAN_DEFAULTS || []).find(p => p.code === planCode)
        || { icon: '❓', name: planCode || 'Sin plan', color: '#8b949e' };
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:0.7rem;font-weight:700;background:${plan.color}22;color:${plan.color}">${plan.icon} ${plan.name}</span>`;
}

function _nextInvoiceNumber() {
    const year = new Date().getFullYear();
    const rndArray = new Uint32Array(1);
    crypto.getRandomValues(rndArray);
    const rnd = (rndArray[0] % 900000) + 100000;
    return `CF-${year}-${rnd}`;
}

// ═══════════════════════════════════════════════════════════════════
// CSS ADICIONAL DE FACTURACIÓN
// ═══════════════════════════════════════════════════════════════════

(function injectBillingCSS() {
    if (document.getElementById('billing-css')) return;
    const s = document.createElement('style');
    s.id = 'billing-css';
    s.textContent = `
.bill-tabs{display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:1rem;overflow-x:auto;}
.bill-tab{padding:0.6rem 1rem;background:none;border:none;border-bottom:2px solid transparent;color:#8b949e;font-size:0.8rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:all 0.15s;}
.bill-tab.active{border-bottom-color:#58a6ff;color:#58a6ff;}
.bill-tab:hover:not(.active){color:#c9d1d9;}
.bill-plan-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:1rem;position:relative;transition:border-color 0.2s;}
.bill-plan-card:hover{border-color:rgba(255,255,255,0.25);}
.bill-input{width:100%;padding:0.5rem 0.7rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:white;font-size:0.85rem;box-sizing:border-box;font-family:Inter,sans-serif;}
.bill-input:focus{outline:none;border-color:#58a6ff;}
.bill-label{display:block;font-size:0.72rem;color:#8b949e;margin-bottom:0.3rem;font-weight:600;}
.bill-table{width:100%;border-collapse:collapse;font-size:0.82rem;}
.bill-table th{text-align:left;padding:0.5rem 0.7rem;color:#8b949e;font-size:0.72rem;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.08);white-space:nowrap;}
.bill-table td{padding:0.55rem 0.7rem;border-bottom:1px solid rgba(255,255,255,0.04);color:#c9d1d9;vertical-align:middle;}
.bill-table tr:hover td{background:rgba(255,255,255,0.02);}
.bill-summary-card{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:1rem 1.2rem;text-align:center;}
.bill-summary-val{font-size:1.8rem;font-weight:800;color:#3fb950;}
.bill-summary-label{font-size:0.72rem;color:#8b949e;margin-top:0.2rem;}
.bill-action-btn{padding:0.3rem 0.65rem;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:white;font-size:0.75rem;font-weight:600;cursor:pointer;}
.bill-action-btn:hover{filter:brightness(1.3);}
.bill-section-title{font-size:0.88rem;font-weight:700;color:white;margin:1rem 0 0.6rem;display:flex;align-items:center;gap:0.5rem;}
`;
    document.head.appendChild(s);
})();

// ═══════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL SA — saBilling()
// Se llama desde saTab('billing')
// ═══════════════════════════════════════════════════════════════════

window.saBilling = async function saBilling(subTab) {
    const body = document.getElementById('sa-body');
    if (!body) return;
    subTab = subTab || 'overview';

    body.innerHTML = `
        <div class="bill-tabs">
            <button class="bill-tab ${subTab==='overview'?'active':''}" onclick="saBilling('overview')">📊 Resumen</button>
            <button class="bill-tab ${subTab==='plans'?'active':''}"    onclick="saBilling('plans')">📋 Planes</button>
            <button class="bill-tab ${subTab==='subs'?'active':''}"     onclick="saBilling('subs')">🔄 Suscripciones</button>
            <button class="bill-tab ${subTab==='invoices'?'active':''}" onclick="saBilling('invoices')">🧾 Facturas</button>
        </div>
        <div id="bill-content"><div style="text-align:center;padding:2rem;color:#8b949e;">⏳ Cargando…</div></div>
    `;

    if      (subTab === 'overview')  await _billOverview();
    else if (subTab === 'plans')     await _billPlans();
    else if (subTab === 'subs')      await _billSubs();
    else if (subTab === 'invoices')  await _billInvoices();
};

// ═══════════════════════════════════════════════════════════════════
// TAB 1 — RESUMEN MENSUAL
// ═══════════════════════════════════════════════════════════════════

async function _billOverview() {
    const cont = document.getElementById('bill-content');
    try {
        const { db, collection, getDocs, query, where } = await _billingFS();

        // Cargar suscripciones activas
        const subsSnap = await getDocs(collection(db, 'billing_subscriptions')).catch(() => null);
        const subs = subsSnap ? subsSnap.docs.map(d => ({ id: d.id, ...d.data() })) : [];

        // Cargar facturas
        const invSnap = await getDocs(collection(db, 'billing_invoices')).catch(() => null);
        const invoices = invSnap ? invSnap.docs.map(d => ({ id: d.id, ...d.data() })) : [];

        // Métricas
        const activeSubs   = subs.filter(s => s.status === 'active');
        const trialSubs    = subs.filter(s => s.status === 'trial');
        const expiredSubs  = subs.filter(s => s.status === 'expired');
        const clubSubs     = activeSubs.filter(s => s.entityType === 'club');
        const indSubs      = activeSubs.filter(s => s.entityType === 'individual');

        // Ingresos del mes actual
        const now = new Date();
        const thisMonth = invoices.filter(inv => {
            const d = new Date(inv.issueDate || inv.createdAt);
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && inv.status === 'paid';
        });
        const monthlyRevenue = thisMonth.reduce((sum, inv) => sum + (Number(inv.finalAmount) || 0), 0);

        // Ingresos totales
        const totalRevenue = invoices.filter(i => i.status === 'paid')
            .reduce((sum, inv) => sum + (Number(inv.finalAmount) || 0), 0);

        cont.innerHTML = `
            <div class="bill-section-title">📊 Resumen de facturación</div>

            <!-- Métricas principales -->
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:0.7rem;margin-bottom:1.5rem;">
                <div class="bill-summary-card">
                    <div class="bill-summary-val" style="color:#3fb950">${activeSubs.length}</div>
                    <div class="bill-summary-label">Suscripciones activas</div>
                </div>
                <div class="bill-summary-card">
                    <div class="bill-summary-val" style="color:#58a6ff">${clubSubs.length}</div>
                    <div class="bill-summary-label">Clubs activos</div>
                </div>
                <div class="bill-summary-card">
                    <div class="bill-summary-val" style="color:#79c0ff">${indSubs.length}</div>
                    <div class="bill-summary-label">Individuales activos</div>
                </div>
                <div class="bill-summary-card">
                    <div class="bill-summary-val" style="color:#f0883e">${trialSubs.length}</div>
                    <div class="bill-summary-label">En período de prueba</div>
                </div>
                <div class="bill-summary-card">
                    <div class="bill-summary-val" style="color:#ffd700">${monthlyRevenue.toFixed(2)} €</div>
                    <div class="bill-summary-label">Ingresos este mes</div>
                </div>
                <div class="bill-summary-card">
                    <div class="bill-summary-val" style="color:#3fb950">${totalRevenue.toFixed(2)} €</div>
                    <div class="bill-summary-label">Ingresos totales</div>
                </div>
            </div>

            <!-- Últimas facturas -->
            <div class="bill-section-title">🧾 Últimas facturas</div>
            ${invoices.length === 0 ? `<div style="text-align:center;padding:1.5rem;color:#8b949e;font-size:0.85rem;">No hay facturas generadas aún</div>` : `
            <div style="overflow-x:auto;">
            <table class="bill-table">
                <thead><tr>
                    <th>Nº Factura</th><th>Cliente</th><th>Plan</th>
                    <th>Importe</th><th>Fecha</th><th>Estado</th><th></th>
                </tr></thead>
                <tbody>
                ${invoices.slice(0,8).map(inv => `
                    <tr>
                        <td style="font-family:monospace;font-size:0.78rem">${inv.invoiceNumber||'—'}</td>
                        <td><div style="font-weight:600">${inv.entityName||'—'}</div>
                            <div style="font-size:0.7rem;color:#8b949e">${inv.entityType==='club'?'Club':'Individual'}</div></td>
                        <td>${_planBadge(inv.planCode)}</td>
                        <td style="font-weight:700">${(inv.finalAmount||0).toFixed(2)} €</td>
                        <td style="font-size:0.78rem">${_fmtDate(inv.issueDate||inv.createdAt)}</td>
                        <td>${_statusBadge(inv.status)}</td>
                        <td>
                            <button class="bill-action-btn" onclick="billMarkPaid('${inv.id}')" title="Marcar pagada" style="color:#3fb950;border-color:rgba(63,185,80,0.3)">✓</button>
                            <button class="bill-action-btn" onclick="billDownloadInvoice('${inv.id}')" title="Descargar PDF" style="margin-left:4px">📄</button>
                        </td>
                    </tr>
                `).join('')}
                </tbody>
            </table>
            </div>`}

            <!-- Accesos rápidos -->
            <div class="bill-section-title" style="margin-top:1.5rem">⚡ Acciones rápidas</div>
            <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
                <button onclick="saBilling('subs')" class="sa-btn" style="color:#58a6ff;border-color:rgba(88,166,255,0.3)">🔄 Ver suscripciones</button>
                <button onclick="saBilling('invoices')" class="sa-btn" style="color:#ffd700;border-color:rgba(255,215,0,0.3)">🧾 Ver todas las facturas</button>
                <button onclick="saBilling('plans')" class="sa-btn" style="color:#d2a8ff;border-color:rgba(210,168,255,0.3)">📋 Gestionar planes</button>
                <button onclick="billExportCSV()" class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.3)">📥 Exportar CSV</button>
            </div>
        `;
    } catch(e) {
        cont.innerHTML = `<div style="color:#f85149;padding:1rem">Error cargando resumen: ${e.message}</div>`;
    }
}

// ═══════════════════════════════════════════════════════════════════
// TAB 2 — GESTIÓN DE PLANES
// ═══════════════════════════════════════════════════════════════════

async function _billPlans() {
    const cont = document.getElementById('bill-content');
    try {
        const { db, collection, getDocs, doc, setDoc } = await _billingFS();

        // Cargar planes guardados en Firestore, o usar defaults
        const plansSnap = await getDocs(collection(db, 'billing_plans')).catch(() => null);
        let plans = plansSnap && !plansSnap.empty
            ? plansSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            : window.BILLING_PLAN_DEFAULTS.map(p => ({ ...p, id: p.code }));

        cont.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
                <div class="bill-section-title" style="margin:0">📋 Planes disponibles</div>
                <div style="display:flex;gap:0.5rem;">
                    <button onclick="billSaveAllPlans()" class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.3)">💾 Guardar cambios</button>
                    <button onclick="billAddCustomPlan()" class="sa-btn" style="color:#58a6ff;border-color:rgba(88,166,255,0.3)">+ Nuevo plan</button>
                </div>
            </div>
            <div style="font-size:0.78rem;color:#8b949e;margin-bottom:1rem;">
                Edita los precios y características de cada plan. Los cambios solo afectan a nuevas suscripciones.
            </div>

            <div id="bill-plans-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0.8rem;">
            ${plans.map(plan => _renderPlanCard(plan)).join('')}
            </div>

            <div style="margin-top:1.5rem;padding:0.8rem;background:rgba(88,166,255,0.06);border:1px solid rgba(88,166,255,0.2);border-radius:8px;font-size:0.78rem;color:#8b949e;">
                💡 Los precios en blanco aparecerán como "Por definir" a los usuarios. Los precios a 0 aparecen como "Gratis".
            </div>
        `;

        // Guardar planes en window para poder guardar desde billSaveAllPlans
        window._billingPlans = plans;

    } catch(e) {
        cont.innerHTML = `<div style="color:#f85149;padding:1rem">Error cargando planes: ${e.message}</div>`;
    }
}

function _renderPlanCard(plan) {
    const featuresStr = (plan.features || []).join('\n');
    return `
    <div class="bill-plan-card" id="plan-card-${plan.code}" data-plan-code="${plan.code}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.7rem;">
            <div style="display:flex;align-items:center;gap:0.4rem;">
                <span style="font-size:1.2rem">${plan.icon||'📋'}</span>
                <input class="bill-input" id="plan-name-${plan.code}" value="${plan.name}" 
                    style="width:130px;font-weight:700;font-size:0.9rem;padding:0.3rem 0.5rem;">
            </div>
            <select id="plan-status-${plan.code}" class="bill-input" style="width:110px;padding:0.3rem 0.5rem;font-size:0.75rem;">
                <option value="active" ${plan.status==='active'?'selected':''}>✅ Activo</option>
                <option value="inactive" ${plan.status==='inactive'?'selected':''}>⏸️ Inactivo</option>
            </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.7rem;">
            <div>
                <label class="bill-label">Precio mensual (€)</label>
                <input class="bill-input" id="plan-monthly-${plan.code}" type="number" min="0" step="0.01"
                    value="${plan.monthlyPrice !== null ? plan.monthlyPrice : ''}"
                    placeholder="Por definir">
            </div>
            <div>
                <label class="bill-label">Precio anual (€)</label>
                <input class="bill-input" id="plan-annual-${plan.code}" type="number" min="0" step="0.01"
                    value="${plan.annualPrice !== null ? plan.annualPrice : ''}"
                    placeholder="Por definir">
            </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-bottom:0.7rem;">
            <div>
                <label class="bill-label">Días prueba</label>
                <input class="bill-input" id="plan-trial-${plan.code}" type="number" min="0"
                    value="${plan.trialDays||0}">
            </div>
            <div>
                <label class="bill-label">Máx. usuarios</label>
                <input class="bill-input" id="plan-maxusers-${plan.code}" type="number" min="0"
                    value="${plan.maxUsers||''}" placeholder="Ilimitado">
            </div>
            <div>
                <label class="bill-label">Máx. jugadores</label>
                <input class="bill-input" id="plan-maxplayers-${plan.code}" type="number" min="0"
                    value="${plan.maxPlayers||''}" placeholder="Ilimitado">
            </div>
        </div>

        <div>
            <label class="bill-label">Para (tipo cliente)</label>
            <select id="plan-target-${plan.code}" class="bill-input" style="padding:0.35rem 0.5rem;font-size:0.8rem;">
                <option value="both"       ${plan.targetType==='both'?'selected':''}>Club e Individual</option>
                <option value="club"       ${plan.targetType==='club'?'selected':''}>Solo Clubs</option>
                <option value="individual" ${plan.targetType==='individual'?'selected':''}>Solo Individuales</option>
            </select>
        </div>

        <div style="margin-top:0.6rem;">
            <label class="bill-label">Características (una por línea)</label>
            <textarea class="bill-input" id="plan-features-${plan.code}"
                rows="4" style="resize:vertical;font-size:0.78rem;">${(plan.features||[]).join('\n')}</textarea>
        </div>
    </div>`;
}

window.billSaveAllPlans = async function() {
    try {
        const { db, doc, setDoc } = await _billingFS();
        _saShowSpinner('Guardando planes…');

        const codes = Array.from(document.querySelectorAll('[data-plan-code]'))
            .map(el => el.dataset.planCode);

        for (const code of codes) {
            const name      = document.getElementById(`plan-name-${code}`)?.value.trim() || code;
            const monthly   = document.getElementById(`plan-monthly-${code}`)?.value;
            const annual    = document.getElementById(`plan-annual-${code}`)?.value;
            const trial     = document.getElementById(`plan-trial-${code}`)?.value;
            const maxUsers  = document.getElementById(`plan-maxusers-${code}`)?.value;
            const maxPlay   = document.getElementById(`plan-maxplayers-${code}`)?.value;
            const status    = document.getElementById(`plan-status-${code}`)?.value || 'active';
            const target    = document.getElementById(`plan-target-${code}`)?.value || 'both';
            const featText  = document.getElementById(`plan-features-${code}`)?.value || '';
            const features  = featText.split('\n').map(f => f.trim()).filter(Boolean);

            const existing = (window.BILLING_PLAN_DEFAULTS||[]).find(p => p.code === code) || {};

            await setDoc(doc(db, 'billing_plans', code), {
                code,
                name,
                icon:         existing.icon || '📋',
                color:        existing.color || '#8b949e',
                description:  existing.description || '',
                monthlyPrice: monthly !== '' ? Number(monthly) : null,
                annualPrice:  annual  !== '' ? Number(annual)  : null,
                trialDays:    Number(trial) || 0,
                maxUsers:     maxUsers !== '' ? Number(maxUsers) : null,
                maxPlayers:   maxPlay  !== '' ? Number(maxPlay)  : null,
                targetType:   target,
                features,
                status,
                updatedAt: new Date().toISOString(),
            }, { merge: true });
        }

        _saHideSpinner();
        _saToast('✅ Planes guardados correctamente', 3000);
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 4000);
    }
};

window.billAddCustomPlan = function() {
    const grid = document.getElementById('bill-plans-grid');
    if (!grid) return;
    const code = 'custom_' + Date.now().toString(36);
    const newPlan = {
        code, name: 'Nuevo Plan', icon: '📋', color: '#8b949e',
        monthlyPrice: null, annualPrice: null, trialDays: 0,
        maxUsers: null, maxPlayers: null, targetType: 'both',
        features: [], status: 'active',
    };
    const div = document.createElement('div');
    div.innerHTML = _renderPlanCard(newPlan);
    grid.appendChild(div.firstElementChild);
    _saToast('Plan añadido — recuerda guardar cambios', 3000);
};

// ═══════════════════════════════════════════════════════════════════
// TAB 3 — SUSCRIPCIONES
// ═══════════════════════════════════════════════════════════════════

async function _billSubs() {
    const cont = document.getElementById('bill-content');
    try {
        const { db, collection, getDocs } = await _billingFS();

        const [subsSnap, clubsSnap, plansSnap] = await Promise.all([
            getDocs(collection(db, 'billing_subscriptions')).catch(() => null),
            getDocs(collection(db, 'clubs')).catch(() => null),
            getDocs(collection(db, 'billing_plans')).catch(() => null),
        ]);

        const subs   = subsSnap   ? subsSnap.docs.map(d => ({ id: d.id, ...d.data() }))   : [];
        const clubs  = clubsSnap  ? clubsSnap.docs.map(d => ({ id: d.id, ...d.data() }))  : [];
        const plans  = plansSnap && !plansSnap.empty
            ? plansSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            : window.BILLING_PLAN_DEFAULTS;

        // Crear mapa de suscripciones por entityId
        const subMap = {};
        subs.forEach(s => { subMap[s.entityId] = s; });

        // Lista de entidades sin suscripción explícita
        const withoutSub = clubs.filter(c => !subMap[c.id]);

        cont.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
                <div class="bill-section-title" style="margin:0">🔄 Suscripciones activas</div>
                <button onclick="billNewSubscription()" class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.3)">+ Nueva suscripción</button>
            </div>

            ${subs.length === 0 ? `<div style="text-align:center;padding:2rem;color:#8b949e;font-size:0.85rem;">
                No hay suscripciones registradas.<br>
                <span style="font-size:0.78rem">Los clubes y entidades se crean inicialmente en plan Free.</span>
            </div>` : `
            <div style="overflow-x:auto;">
            <table class="bill-table">
                <thead><tr>
                    <th>Cliente</th><th>Tipo</th><th>Plan</th><th>Período</th>
                    <th>Precio</th><th>Próxima factura</th><th>Estado</th><th>Acciones</th>
                </tr></thead>
                <tbody>
                ${subs.map(sub => `
                    <tr>
                        <td>
                            <div style="font-weight:600;font-size:0.85rem">${typeof escapeHtml==='function'?escapeHtml(sub.entityName||sub.entityId):(sub.entityName||sub.entityId)}</div>
                            <div style="font-size:0.7rem;color:#8b949e">${typeof escapeHtml==='function'?escapeHtml(sub.entityEmail||''):(sub.entityEmail||'')}</div>
                        </td>
                        <td style="font-size:0.78rem">${sub.entityType==='club'?'🏟️ Club':'👤 Individual'}</td>
                        <td>${_planBadge(sub.planCode)}</td>
                        <td style="font-size:0.78rem">${sub.period==='annual'?'Anual':sub.period==='trial'?'Prueba':'Mensual'}</td>
                        <td style="font-weight:700">${sub.price !== null && sub.price !== undefined ? sub.price.toFixed(2)+' €' : '—'}</td>
                        <td style="font-size:0.78rem">${_fmtDate(sub.nextBillingDate)}</td>
                        <td>${_statusBadge(sub.status)}</td>
                        <td>
                            <button class="bill-action-btn" onclick="billEditSub('${sub.id}')" title="Editar">✏️</button>
                            <button class="bill-action-btn" onclick="billGenerateInvoice('${sub.id}')" title="Generar factura" style="margin-left:3px;color:#ffd700;border-color:rgba(255,215,0,0.3)">🧾</button>
                        </td>
                    </tr>
                `).join('')}
                </tbody>
            </table>
            </div>`}

            <!-- Clubes sin suscripción explícita (plan Free por defecto) -->
            ${withoutSub.length > 0 ? `
            <div class="bill-section-title" style="margin-top:1.5rem">🆓 En plan Free (sin suscripción registrada)</div>
            <div style="overflow-x:auto;">
            <table class="bill-table">
                <thead><tr><th>Club/Entidad</th><th>Plan actual</th><th>Creado</th><th>Acción</th></tr></thead>
                <tbody>
                ${withoutSub.slice(0,20).map(c => `
                    <tr>
                        <td>
                            <div style="font-weight:600;font-size:0.85rem">${c.name||c.id}</div>
                            <div style="font-size:0.7rem;color:#8b949e">${c.adminEmail||''}</div>
                        </td>
                        <td>${_planBadge(c.plan||'free')}</td>
                        <td style="font-size:0.78rem">${_fmtDate(c.createdAt)}</td>
                        <td>
                            <button class="bill-action-btn" onclick="billAssignPlan('${c.id}','${c.name||c.id}','${c.adminEmail||''}','club')"
                                style="color:#58a6ff;border-color:rgba(88,166,255,0.3)">Asignar plan</button>
                        </td>
                    </tr>
                `).join('')}
                </tbody>
            </table>
            </div>` : ''}
        `;
    } catch(e) {
        cont.innerHTML = `<div style="color:#f85149;padding:1rem">Error: ${e.message}</div>`;
    }
}

// Modal — Asignar / Nueva suscripción
window.billAssignPlan = async function(entityId, entityName, entityEmail, entityType) {
    const { db, collection, getDocs } = await _billingFS();
    const plansSnap = await getDocs(collection(db, 'billing_plans')).catch(() => null);
    const plans = plansSnap && !plansSnap.empty
        ? plansSnap.docs.map(d => ({ ...d.data() }))
        : window.BILLING_PLAN_DEFAULTS;

    const modal = document.createElement('div');
    modal.id = 'bill-assign-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem;';
    modal.innerHTML = `
        <div style="background:#161b22;border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:1.5rem;width:100%;max-width:440px;color:white;font-family:Inter,sans-serif;">
            <div style="font-size:1rem;font-weight:700;margin-bottom:0.3rem">🔄 Asignar plan a suscripción</div>
            <div style="font-size:0.82rem;color:#8b949e;margin-bottom:1.2rem">${entityName}</div>

            <label class="bill-label">Plan</label>
            <select id="bam-plan" class="bill-input" style="margin-bottom:0.8rem;">
                ${plans.map(p => `<option value="${p.code}">${p.icon||''} ${p.name}</option>`).join('')}
            </select>

            <label class="bill-label">Período de facturación</label>
            <select id="bam-period" class="bill-input" style="margin-bottom:0.8rem;">
                <option value="monthly">Mensual</option>
                <option value="annual">Anual</option>
                <option value="trial">Período de prueba</option>
                <option value="seasonal">Temporada deportiva (sept–junio)</option>
            </select>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-bottom:0.8rem;">
                <div>
                    <label class="bill-label">Precio acordado (€)</label>
                    <input id="bam-price" class="bill-input" type="number" min="0" step="0.01" placeholder="0.00">
                </div>
                <div>
                    <label class="bill-label">Descuento (%)</label>
                    <input id="bam-discount" class="bill-input" type="number" min="0" max="100" step="1" placeholder="0">
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;margin-bottom:0.8rem;">
                <div>
                    <label class="bill-label">Fecha inicio</label>
                    <input id="bam-start" class="bill-input" type="date" value="${new Date().toISOString().split('T')[0]}">
                </div>
                <div>
                    <label class="bill-label">Próxima factura</label>
                    <input id="bam-next" class="bill-input" type="date">
                </div>
            </div>

            <label class="bill-label">Notas internas</label>
            <textarea id="bam-notes" class="bill-input" rows="2" style="resize:none;margin-bottom:1rem;" placeholder="Oferta especial, negociación…"></textarea>

            <div style="display:flex;gap:0.6rem;justify-content:flex-end;">
                <button onclick="document.getElementById('bill-assign-modal').remove()"
                    class="bill-action-btn">Cancelar</button>
                <button onclick="billSaveSubscription('${entityId}','${entityName}','${entityEmail}','${entityType}')"
                    class="bill-action-btn" style="background:rgba(63,185,80,0.15);color:#3fb950;border-color:rgba(63,185,80,0.4)">
                    💾 Guardar suscripción
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.billNewSubscription = function() {
    billAssignPlan('', 'Nueva suscripción manual', '', 'club');
};

window.billSaveSubscription = async function(entityId, entityName, entityEmail, entityType) {
    try {
        const { db, doc, setDoc, collection } = await _billingFS();
        _saShowSpinner('Guardando suscripción…');

        const planCode   = document.getElementById('bam-plan')?.value || 'free';
        const period     = document.getElementById('bam-period')?.value || 'monthly';
        const price      = Number(document.getElementById('bam-price')?.value) || 0;
        const discount   = Number(document.getElementById('bam-discount')?.value) || 0;
        const startDate  = document.getElementById('bam-start')?.value || new Date().toISOString().split('T')[0];
        const nextBill   = document.getElementById('bam-next')?.value || '';
        const notes      = document.getElementById('bam-notes')?.value.trim() || '';

        const subId = 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,4);

        await setDoc(doc(db, 'billing_subscriptions', subId), {
            entityId, entityName, entityEmail, entityType,
            planCode, period, price, discount,
            finalPrice: price * (1 - discount / 100),
            status: planCode === 'trial' ? 'trial' : price === 0 ? 'active' : 'active',
            startDate: new Date(startDate).toISOString(),
            nextBillingDate: nextBill ? new Date(nextBill).toISOString() : null,
            notes,
            createdBy: window._cronosCurrentUser?.email || 'superadmin',
            createdAt: new Date().toISOString(),
        });

        // Actualizar plan en el documento del club/entidad
        if (entityId) {
            const entityRef = entityType === 'club'
                ? doc(db, 'clubs', entityId)
                : doc(db, 'individuals', entityId);
            await setDoc(entityRef, { plan: planCode }, { merge: true }).catch(() => {});
        }

        _saHideSpinner();
        document.getElementById('bill-assign-modal')?.remove();
        _saToast('✅ Suscripción guardada', 3000);
        saBilling('subs');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 4000);
    }
};

window.billEditSub = async function(subId) {
    try {
        const { db, doc, getDoc } = await _billingFS();
        const snap = await getDoc(doc(db, 'billing_subscriptions', subId));
        if (!snap.exists()) { _saToast('Suscripción no encontrada', 3000); return; }
        const sub = snap.data();
        billAssignPlan(sub.entityId, sub.entityName, sub.entityEmail, sub.entityType);
    } catch(e) {
        _saToast('❌ Error: ' + e.message, 4000);
    }
};

// ═══════════════════════════════════════════════════════════════════
// TAB 4 — FACTURAS
// ═══════════════════════════════════════════════════════════════════

async function _billInvoices() {
    const cont = document.getElementById('bill-content');
    try {
        const { db, collection, getDocs } = await _billingFS();
        const invSnap = await getDocs(collection(db, 'billing_invoices')).catch(() => null);
        const invoices = invSnap ? invSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];

        // Filtros básicos
        cont.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
                <div class="bill-section-title" style="margin:0">🧾 Facturas</div>
                <div style="display:flex;gap:0.5rem;">
                    <select id="bill-filter-status" class="bill-input" style="width:130px;padding:0.35rem 0.5rem;font-size:0.78rem;" onchange="billFilterInvoices()">
                        <option value="">Todos los estados</option>
                        <option value="pending">Pendiente</option>
                        <option value="paid">Pagada</option>
                        <option value="cancelled">Cancelada</option>
                    </select>
                    <button onclick="billExportCSV()" class="sa-btn" style="color:#3fb950;border-color:rgba(63,185,80,0.3)">📥 CSV</button>
                </div>
            </div>

            ${invoices.length === 0 ? `<div style="text-align:center;padding:2.5rem;color:#8b949e;font-size:0.85rem;">
                No hay facturas generadas.<br>
                <span style="font-size:0.78rem;">Genera facturas desde la pestaña Suscripciones.</span>
            </div>` : `
            <div style="overflow-x:auto;">
            <table class="bill-table" id="bill-invoices-table">
                <thead><tr>
                    <th>Nº Factura</th><th>Cliente</th><th>Plan</th><th>Período</th>
                    <th>Importe</th><th>Emisión</th><th>Vencimiento</th><th>Estado</th><th>Acciones</th>
                </tr></thead>
                <tbody>
                ${invoices.map(inv => `
                    <tr data-status="${inv.status}">
                        <td style="font-family:monospace;font-size:0.78rem;color:#79c0ff">${inv.invoiceNumber||'—'}</td>
                        <td>
                            <div style="font-weight:600;font-size:0.83rem">${inv.entityName||'—'}</div>
                            <div style="font-size:0.7rem;color:#8b949e">${inv.entityEmail||''}</div>
                        </td>
                        <td>${_planBadge(inv.planCode)}</td>
                        <td style="font-size:0.78rem">${inv.period==='annual'?'Anual':inv.period==='trial'?'Prueba':'Mensual'}</td>
                        <td>
                            <div style="font-weight:700">${(inv.finalAmount||0).toFixed(2)} €</div>
                            ${inv.discount>0?`<div style="font-size:0.7rem;color:#3fb950">-${inv.discount}%</div>`:''}
                        </td>
                        <td style="font-size:0.78rem">${_fmtDate(inv.issueDate||inv.createdAt)}</td>
                        <td style="font-size:0.78rem">${_fmtDate(inv.dueDate)}</td>
                        <td>${_statusBadge(inv.status)}</td>
                        <td>
                            <div style="display:flex;gap:3px;">
                                <button class="bill-action-btn" onclick="billDownloadInvoice('${inv.id}')" title="Descargar PDF">📄</button>
                                <button class="bill-action-btn" onclick="billMarkPaid('${inv.id}')" title="Marcar pagada" style="color:#3fb950;border-color:rgba(63,185,80,0.3)">✓</button>
                                <button class="bill-action-btn" onclick="billCancelInvoice('${inv.id}')" title="Cancelar" style="color:#f85149;border-color:rgba(248,81,73,0.3)">✕</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
                </tbody>
            </table>
            </div>`}
        `;

        window._billingInvoices = invoices;
    } catch(e) {
        cont.innerHTML = `<div style="color:#f85149;padding:1rem">Error: ${e.message}</div>`;
    }
}

window.billFilterInvoices = function() {
    const status = document.getElementById('bill-filter-status')?.value;
    const rows = document.querySelectorAll('#bill-invoices-table tbody tr');
    rows.forEach(row => {
        row.style.display = (!status || row.dataset.status === status) ? '' : 'none';
    });
};

// Generar factura desde suscripción
window.billGenerateInvoice = async function(subId) {
    try {
        const { db, doc, getDoc, setDoc, collection } = await _billingFS();
        _saShowSpinner('Generando factura…');

        const snap = await getDoc(doc(db, 'billing_subscriptions', subId));
        if (!snap.exists()) { _saHideSpinner(); _saToast('Suscripción no encontrada', 3000); return; }
        const sub = snap.data();

        const invId     = 'inv_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2,4);
        const invNumber = _nextInvoiceNumber();
        const now       = new Date();
        const dueDate   = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 días

        const invoice = {
            invoiceNumber: invNumber,
            entityId:      sub.entityId,
            entityType:    sub.entityType,
            entityName:    sub.entityName,
            entityEmail:   sub.entityEmail || '',
            subscriptionId: subId,
            planCode:      sub.planCode,
            planName:      (window.BILLING_PLAN_DEFAULTS||[]).find(p=>p.code===sub.planCode)?.name || sub.planCode,
            period:        sub.period,
            amount:        sub.price || 0,
            discount:      sub.discount || 0,
            finalAmount:   sub.finalPrice || sub.price || 0,
            status:        sub.price === 0 ? 'paid' : 'pending',
            issueDate:     now.toISOString(),
            dueDate:       dueDate.toISOString(),
            paidDate:      null,
            notes:         sub.notes || '',
            createdBy:     window._cronosCurrentUser?.email || 'superadmin',
            createdAt:     now.toISOString(),
        };

        await setDoc(doc(db, 'billing_invoices', invId), invoice);

        _saHideSpinner();
        _saToast(`✅ Factura ${invNumber} generada`, 4000);
        saBilling('invoices');
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 4000);
    }
};

window.billMarkPaid = async function(invId) {
    try {
        const { db, doc, setDoc } = await _billingFS();
        await setDoc(doc(db, 'billing_invoices', invId), {
            status: 'paid',
            paidDate: new Date().toISOString(),
        }, { merge: true });
        _saToast('✅ Factura marcada como pagada', 3000);
        saBilling('invoices');
    } catch(e) {
        _saToast('❌ Error: ' + e.message, 3000);
    }
};

window.billCancelInvoice = async function(invId) {
    if (!confirm('¿Cancelar esta factura? No se puede deshacer.')) return;
    try {
        const { db, doc, setDoc } = await _billingFS();
        await setDoc(doc(db, 'billing_invoices', invId), { status: 'cancelled' }, { merge: true });
        _saToast('Factura cancelada', 3000);
        saBilling('invoices');
    } catch(e) {
        _saToast('❌ Error: ' + e.message, 3000);
    }
};

// ═══════════════════════════════════════════════════════════════════
// GENERACIÓN DE PDF — usando window.print() con estilos de impresión
// Compatible sin dependencias externas
// ═══════════════════════════════════════════════════════════════════

window.billDownloadInvoice = async function(invId) {
    try {
        const { db, doc, getDoc } = await _billingFS();
        _saShowSpinner('Preparando factura PDF…');
        const snap = await getDoc(doc(db, 'billing_invoices', invId));
        if (!snap.exists()) { _saHideSpinner(); _saToast('Factura no encontrada', 3000); return; }
        const inv = snap.data();
        _saHideSpinner();
        _billPrintInvoice(inv);
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 4000);
    }
};

function _billPrintInvoice(inv) {
    const discountLine = inv.discount > 0
        ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;">Descuento (${inv.discount}%)</td><td style="text-align:right;color:#e53e3e">-${((inv.amount||0) * (inv.discount/100)).toFixed(2)} €</td></tr>`
        : '';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Factura ${inv.invoiceNumber}</title>
<style>
  @page { size: A4; margin: 20mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a2e; background: white; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 3px solid #2563eb; }
  .brand { font-size: 22px; font-weight: 900; color: #2563eb; letter-spacing: -0.5px; }
  .brand-sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .inv-box { text-align: right; }
  .inv-num { font-size: 18px; font-weight: 700; color: #1a1a2e; }
  .inv-date { font-size: 11px; color: #6b7280; margin-top: 4px; }
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-bottom: 6px; }
  .client-box { background: #f8fafc; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; }
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  table.items th { background: #2563eb; color: white; padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; }
  table.items td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
  .total-row { font-weight: 900; font-size: 15px; color: #2563eb; }
  .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 10px; font-weight: 700; }
  .status-paid { background: #dcfce7; color: #16a34a; }
  .status-pending { background: #fef9c3; color: #ca8a04; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; text-align: center; }
  @media print { button { display: none !important; } }
</style>
</head>
<body>
<div style="max-width:680px;margin:0 auto;padding:16px;">

  <div class="header">
    <div>
      <div class="brand">⚽ CRONOS FÚTBOL</div>
      <div class="brand-sub">Sistema de Gestión Deportiva</div>
    </div>
    <div class="inv-box">
      <div class="inv-num">FACTURA ${inv.invoiceNumber}</div>
      <div class="inv-date">Emisión: ${_fmtDate(inv.issueDate||inv.createdAt)}</div>
      <div class="inv-date">Vencimiento: ${_fmtDate(inv.dueDate)}</div>
      <div style="margin-top:8px;">
        <span class="status-badge ${inv.status==='paid'?'status-paid':'status-pending'}">
          ${inv.status==='paid'?'✓ PAGADA':'PENDIENTE DE PAGO'}
        </span>
      </div>
    </div>
  </div>

  <div class="client-box">
    <div class="section-title">Facturado a</div>
    <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${inv.entityName||'—'}</div>
    <div style="color:#4b5563;font-size:12px;">${inv.entityEmail||''}</div>
    <div style="color:#4b5563;font-size:12px;">${inv.entityType==='club'?'Club deportivo':'Usuario individual'}</div>
  </div>

  <table class="items">
    <thead>
      <tr><th>Descripción</th><th style="text-align:right">Importe</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>
          <strong>Plan ${inv.planName||inv.planCode} — ${inv.period==='annual'?'Anual':inv.period==='trial'?'Período de prueba':'Mensual'}</strong><br>
          <span style="color:#6b7280;font-size:11px;">Suscripción Cronos Fútbol · ${_fmtDate(inv.issueDate)} – ${_fmtDate(inv.dueDate)}</span>
          ${inv.notes?`<br><span style="color:#9ca3af;font-size:11px;font-style:italic;">${inv.notes}</span>`:''}
        </td>
        <td style="text-align:right;font-weight:600">${(inv.amount||0).toFixed(2)} €</td>
      </tr>
      ${discountLine}
      <tr class="total-row">
        <td style="padding:12px 12px;text-transform:uppercase;font-size:12px;">Total a pagar</td>
        <td style="text-align:right;padding:12px 12px;font-size:18px;">${(inv.finalAmount||0).toFixed(2)} €</td>
      </tr>
    </tbody>
  </table>

  ${inv.status==='paid'&&inv.paidDate?`<div style="background:#dcfce7;border-radius:8px;padding:10px 14px;font-size:12px;color:#16a34a;margin-bottom:16px;">✓ Pagada el ${_fmtDate(inv.paidDate)}</div>`:''}

  <div style="text-align:center;margin:24px 0;">
    <button onclick="window.print()" style="padding:10px 28px;background:#2563eb;color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
      🖨️ Imprimir / Guardar como PDF
    </button>
  </div>

  <div class="footer">
    <p>Cronos Fútbol · Sistema de Gestión Deportiva</p>
    <p style="margin-top:4px;">Esta factura ha sido generada electrónicamente y es válida sin firma.</p>
  </div>
</div>
</body>
</html>`;

    const w = window.open('', '_blank', 'width=750,height=900');
    if (w) {
        w.document.write(html);
        w.document.close();
    } else {
        _saToast('⚠️ Permite las ventanas emergentes para ver la factura', 4000);
    }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORTAR CSV
// ═══════════════════════════════════════════════════════════════════

window.billExportCSV = async function() {
    try {
        const { db, collection, getDocs } = await _billingFS();
        _saShowSpinner('Generando CSV…');
        const invSnap = await getDocs(collection(db, 'billing_invoices')).catch(() => null);
        const invoices = invSnap ? invSnap.docs.map(d => ({ id: d.id, ...d.data() })) : [];
        _saHideSpinner();

        if (invoices.length === 0) { _saToast('No hay facturas para exportar', 3000); return; }

        const headers = ['Nº Factura','Cliente','Email','Tipo','Plan','Período','Importe base','Descuento%','Importe final','Estado','Fecha emisión','Fecha vencimiento','Fecha pago'];
        const rows = invoices.map(inv => [
            inv.invoiceNumber||'',
            inv.entityName||'',
            inv.entityEmail||'',
            inv.entityType==='club'?'Club':'Individual',
            inv.planCode||'',
            inv.period||'',
            (inv.amount||0).toFixed(2),
            (inv.discount||0),
            (inv.finalAmount||0).toFixed(2),
            inv.status||'',
            _fmtDate(inv.issueDate||inv.createdAt),
            _fmtDate(inv.dueDate),
            _fmtDate(inv.paidDate),
        ]);

        const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cronos-facturas-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        _saToast('✅ CSV descargado', 3000);
    } catch(e) {
        _saHideSpinner();
        _saToast('❌ Error: ' + e.message, 4000);
    }
};

// ═══════════════════════════════════════════════════════════════════
// VISTA PARA CLUB ADMIN — billClubView()
// Se llama desde el panel del Club Admin
// ═══════════════════════════════════════════════════════════════════

window.billClubView = async function(containerId) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    cont.innerHTML = `<div style="text-align:center;padding:1.5rem;color:#8b949e;">⏳ Cargando información de suscripción…</div>`;

    try {
        const { db, collection, getDocs, query, where } = await _billingFS();
        const me = window._cronosCurrentUser;
        const clubId = me?.clubId;
        if (!clubId) { cont.innerHTML = `<div style="color:#8b949e;padding:1rem;font-size:0.85rem;">No se encontró información del club.</div>`; return; }

        // Suscripción del club
        const subSnap = await getDocs(query(collection(db, 'billing_subscriptions'),
            where('entityId', '==', clubId))).catch(() => null);
        const sub = subSnap && !subSnap.empty ? { id: subSnap.docs[0].id, ...subSnap.docs[0].data() } : null;

        // Facturas del club
        const invSnap = await getDocs(query(collection(db, 'billing_invoices'),
            where('entityId', '==', clubId))).catch(() => null);
        const invoices = invSnap ? invSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];

        const planCode = sub?.planCode || me?.plan || 'free';
        const planInfo = (window.BILLING_PLAN_DEFAULTS||[]).find(p => p.code === planCode) || { name: planCode, icon: '📋' };

        cont.innerHTML = `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:1.2rem;margin-bottom:1rem;">
                <div style="font-size:0.75rem;color:#8b949e;font-weight:700;margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.5px;">Tu suscripción actual</div>
                <div style="display:flex;align-items:center;gap:0.8rem;flex-wrap:wrap;">
                    <span style="font-size:1.6rem">${planInfo.icon||'📋'}</span>
                    <div>
                        <div style="font-size:1.1rem;font-weight:700;color:white">${planInfo.name}</div>
                        <div style="font-size:0.78rem;color:#8b949e">${sub ? `${sub.period==='annual'?'Anual':sub.period==='trial'?'Período de prueba':'Mensual'} · Próxima factura: ${_fmtDate(sub.nextBillingDate)}` : 'Plan gratuito'}</div>
                    </div>
                    <div style="margin-left:auto">${_statusBadge(sub?.status || 'active')}</div>
                </div>
                ${sub?.price > 0 ? `<div style="margin-top:0.8rem;font-size:0.85rem;color:#c9d1d9">Precio: <strong>${sub.finalPrice?.toFixed(2)||sub.price?.toFixed(2)} € / ${sub.period==='annual'?'año':'mes'}</strong>${sub.discount>0?` <span style="color:#3fb950">(${sub.discount}% dto.)</span>`:''}</div>` : ''}
            </div>

            <div style="font-size:0.82rem;font-weight:700;color:white;margin-bottom:0.6rem">🧾 Historial de facturas</div>
            ${invoices.length === 0
                ? `<div style="text-align:center;padding:1.5rem;color:#8b949e;font-size:0.82rem;">No hay facturas registradas.</div>`
                : `<div style="overflow-x:auto;"><table class="bill-table">
                <thead><tr><th>Nº Factura</th><th>Período</th><th>Importe</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                ${invoices.map(inv => `
                    <tr>
                        <td style="font-family:monospace;font-size:0.78rem;color:#79c0ff">${inv.invoiceNumber||'—'}</td>
                        <td style="font-size:0.78rem">${_fmtDate(inv.issueDate||inv.createdAt)}</td>
                        <td style="font-weight:700">${(inv.finalAmount||0).toFixed(2)} €</td>
                        <td>${_statusBadge(inv.status)}</td>
                        <td><button class="bill-action-btn" onclick="billDownloadInvoice('${inv.id}')" title="Descargar PDF">📄 PDF</button></td>
                    </tr>
                `).join('')}
                </tbody></table></div>`}
        `;
    } catch(e) {
        cont.innerHTML = `<div style="color:#f85149;font-size:0.82rem;padding:0.5rem">Error: ${e.message}</div>`;
    }
};

// ═══════════════════════════════════════════════════════════════════
// VISTA PARA ADMIN INDIVIDUAL — billIndividualView()
// Se llama desde el panel del Admin Individual
// ═══════════════════════════════════════════════════════════════════

window.billIndividualView = async function(containerId) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    cont.innerHTML = `<div style="text-align:center;padding:1.5rem;color:#8b949e;">⏳ Cargando suscripción…</div>`;

    try {
        const { db, collection, getDocs, query, where } = await _billingFS();
        const me = window._cronosCurrentUser;
        const uid = me?.uid;
        if (!uid) return;

        const entityId = me?.individualEntityId || me?.clubId || uid;

        const subSnap = await getDocs(query(collection(db, 'billing_subscriptions'),
            where('entityId', '==', entityId))).catch(() => null);
        const sub = subSnap && !subSnap.empty ? { id: subSnap.docs[0].id, ...subSnap.docs[0].data() } : null;

        const invSnap = await getDocs(query(collection(db, 'billing_invoices'),
            where('entityId', '==', entityId))).catch(() => null);
        const invoices = invSnap ? invSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];

        const planCode = sub?.planCode || 'free';
        const planInfo = (window.BILLING_PLAN_DEFAULTS||[]).find(p => p.code === planCode) || { name: planCode, icon: '📋' };

        cont.innerHTML = `
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:1.2rem;margin-bottom:1rem;">
                <div style="font-size:0.75rem;color:#8b949e;font-weight:700;margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:0.5px;">Mi suscripción</div>
                <div style="display:flex;align-items:center;gap:0.8rem;">
                    <span style="font-size:1.6rem">${planInfo.icon||'📋'}</span>
                    <div>
                        <div style="font-size:1.1rem;font-weight:700;color:white">${planInfo.name}</div>
                        <div style="font-size:0.78rem;color:#8b949e">${sub ? `${sub.period==='annual'?'Anual':'Mensual'} · Próxima factura: ${_fmtDate(sub.nextBillingDate)}` : 'Plan gratuito'}</div>
                    </div>
                    <div style="margin-left:auto">${_statusBadge(sub?.status||'active')}</div>
                </div>
                ${sub?.price > 0 ? `<div style="margin-top:0.8rem;font-size:0.85rem;color:#c9d1d9">Precio: <strong>${(sub.finalPrice||sub.price||0).toFixed(2)} € / ${sub.period==='annual'?'año':'mes'}</strong></div>` : ''}
            </div>

            <div style="font-size:0.82rem;font-weight:700;color:white;margin-bottom:0.6rem">🧾 Mis facturas</div>
            ${invoices.length === 0
                ? `<div style="text-align:center;padding:1.5rem;color:#8b949e;font-size:0.82rem;">No hay facturas disponibles.</div>`
                : `<div style="overflow-x:auto;"><table class="bill-table">
                <thead><tr><th>Nº Factura</th><th>Fecha</th><th>Importe</th><th>Estado</th><th></th></tr></thead>
                <tbody>
                ${invoices.map(inv => `
                    <tr>
                        <td style="font-family:monospace;font-size:0.78rem;color:#79c0ff">${inv.invoiceNumber||'—'}</td>
                        <td style="font-size:0.78rem">${_fmtDate(inv.issueDate||inv.createdAt)}</td>
                        <td style="font-weight:700">${(inv.finalAmount||0).toFixed(2)} €</td>
                        <td>${_statusBadge(inv.status)}</td>
                        <td><button class="bill-action-btn" onclick="billDownloadInvoice('${inv.id}')" title="PDF">📄</button></td>
                    </tr>
                `).join('')}
                </tbody></table></div>`}
        `;
    } catch(e) {
        cont.innerHTML = `<div style="color:#f85149;font-size:0.82rem;padding:0.5rem">Error: ${e.message}</div>`;
    }
};

