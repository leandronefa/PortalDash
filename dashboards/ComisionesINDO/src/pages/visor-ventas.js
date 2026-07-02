import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

const TABS = [
  { key: 'consumo',      label: 'Consumo',       endpoint: key => `/datos/consumo?periodo=${key}`,       type: 'ventas' },
  { key: 'efectivo',     label: 'Efectivo',       endpoint: key => `/datos/efectivo?periodo=${key}`,      type: 'ventas' },
  { key: 'originaciones',label: 'Originaciones',  endpoint: key => `/datos/reporte?periodo=${key}`,       type: 'orig'   },
];

function fmt(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(v)    { return v != null ? (Number(v) * 100).toFixed(1) + '%' : '—'; }
function fmtPctDir(v) { return v != null ? Number(v).toFixed(2) + '%' : '—'; }

const SPINNER = `<p style="color:var(--color-muted);text-align:center;padding:40px">
  <span style="display:inline-block;animation:spin 1s linear infinite;font-size:24px">⏳</span><br>Cargando…
</p>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;

export async function renderVisorVentas(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">
      <h2 style="flex-shrink:0;font-size:20px;font-weight:700;margin-bottom:10px">📈 Ventas — ${periodo}</h2>
      <div style="flex-shrink:0;display:flex;gap:4px;margin-bottom:0;border-bottom:2px solid var(--color-border)">
        ${TABS.map((t, i) => `
          <button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.key}"
            style="padding:8px 18px;font-size:13px;font-weight:600;border:none;border-radius:6px 6px 0 0;cursor:pointer;
                   background:${i === 0 ? 'var(--color-primary)' : 'var(--color-card)'};
                   color:${i === 0 ? '#fff' : 'var(--color-text)'};border-bottom:none">
            ${t.label}
          </button>
        `).join('')}
      </div>
      <div id="ventas-header" style="flex-shrink:0;display:flex;align-items:center;gap:12px;padding:8px 0 4px">
        <button id="btn-reload" class="btn btn-secondary" style="font-size:13px">🔄 Recargar</button>
        <span id="badge-count" style="font-size:12px;color:var(--color-muted)"></span>
      </div>
      <div id="ventas-wrap" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">${SPINNER}</div>
    </div>
  `;

  let activeTab = 'consumo';

  function switchTab(key) {
    activeTab = key;
    container.querySelectorAll('.tab-btn').forEach(b => {
      const active = b.dataset.tab === key;
      b.style.background = active ? 'var(--color-primary)' : 'var(--color-card)';
      b.style.color      = active ? '#fff' : 'var(--color-text)';
      b.classList.toggle('active', active);
    });
    loadTab(key);
  }

  async function loadTab(key) {
    const wrap  = container.querySelector('#ventas-wrap');
    const badge = container.querySelector('#badge-count');
    const tabDef = TABS.find(t => t.key === key);
    if (!tabDef) return;

    wrap.innerHTML = SPINNER;
    badge.textContent = '';
    try {
      const raw  = await api.get(tabDef.endpoint(periodo));
      const rows = Array.isArray(raw) ? raw : (raw.data ?? raw.datos ?? raw.reporte ?? []);
      badge.textContent = `${rows.length} registros`;
      renderTab(wrap, tabDef.type, rows);
    } catch (err) {
      showToast(err.message, 'error');
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Error al cargar datos.</p></div></div>';
    }
  }

  function renderTab(wrap, type, rows) {
    if (!rows.length) {
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Sin datos.</p></div></div>';
      return;
    }

    let cols;
    if (type === 'ventas') {
      cols = [
        { key: 'sucursal_id',     label: 'ID' },
        { key: 'sucursal_nombre', label: 'Sucursal' },
        { key: 'ventas',          label: 'Ventas',       render: fmt },
        { key: 'vta_diaria',      label: 'VtaDiaria',    render: fmt },
        { key: 'particip_vta',    label: 'ParticipVta',  render: fmtPct },
        { key: 'vta_vta_tot',     label: 'Vta/VtaTot',   render: fmtPctDir },
        { key: 'credito_promedio',label: 'CredProm',     render: fmt },
        { key: 'operaciones',     label: 'Operac',       render: fmt },
        { key: 'pers_op',         label: 'PersOp',       render: fmt },
        { key: 'particip_op',     label: 'ParticipOp',   render: fmtPct },
        { key: 'cobranzas',       label: 'Cobranzas',    render: fmt },
        { key: 'cob_diaria',      label: 'CobDiaria',    render: fmt },
        { key: 'particip_cob',    label: 'ParticipCob',  render: fmtPct },
        { key: 'cant_cob',        label: 'CantCob',      render: fmt },
        { key: 'pers_cob',        label: 'PersCob',      render: fmt },
        { key: 'obj_vtas',        label: 'Obj.Vtas',     render: fmt },
      ];
    } else {
      cols = [
        { key: 'id_originacion',   label: 'ID Orig.' },
        { key: 'estado',           label: 'Estado' },
        { key: 'usuario_originador', label: 'Operador' },
        { key: 'fecha_alta',       label: 'Fecha' },
        { key: 'producto',         label: 'Producto' },
        { key: 'importe_capital',  label: 'Importe',  render: fmt },
        { key: 'cantidad_cuotas',  label: 'Cuotas',   render: fmt },
        { key: 'sucursal',         label: 'Sucursal' },
      ];
    }

    const heads = cols.map(c => `<th>${c.label}</th>`).join('');
    const body  = rows.map(r =>
      `<tr>${cols.map(c => `<td>${c.render ? c.render(r[c.key], r) : (r[c.key] ?? '—')}</td>`).join('')}</tr>`
    ).join('');
    wrap.innerHTML = `
      <table style="width:100%">
        <thead style="position:sticky;top:0;z-index:1;background:var(--color-surface)">
          <tr>${heads}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  container.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  container.querySelector('#btn-reload').addEventListener('click', () => loadTab(activeTab));

  loadTab(activeTab);
}
