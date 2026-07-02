import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

const TABS = [
  { key: 'consumo',  label: 'Consumo' },
  { key: 'efectivo', label: 'Efectivo' },
];

function fmt(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(v)    { return v != null ? (Number(v) * 100).toFixed(1) + '%' : '—'; }
function fmtPctDir(v) { return v != null ? Number(v).toFixed(2) + '%' : '—'; }

export async function renderVisorObjetivos(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">
      <h2 style="flex-shrink:0;font-size:20px;font-weight:700;margin-bottom:10px">🎯 Objetivos — ${periodo}</h2>
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
      <div id="obj-wrap" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">
        <p style="color:var(--color-muted);text-align:center;padding:40px">Cargando…</p>
      </div>
    </div>
  `;

  let activeTab = 'consumo';
  const cache = {};

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
    const wrap = container.querySelector('#obj-wrap');
    if (cache[key]) { renderTab(wrap, key, cache[key]); return; }
    wrap.innerHTML = '<p style="color:var(--color-muted);text-align:center;padding:40px">Cargando…</p>';
    try {
      const raw = await api.get(`/objetivos/${key}?periodo=${periodo}`);
      const rows = Array.isArray(raw) ? raw : (raw.data ?? raw.objetivos ?? []);
      cache[key] = rows;
      renderTab(wrap, key, rows);
    } catch (err) {
      showToast(err.message, 'error');
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Error al cargar datos.</p></div></div>';
    }
  }

  function renderTab(wrap, key, rows) {
    if (!rows.length) {
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Sin datos.</p></div></div>';
      return;
    }

    let cols;
    if (key === 'consumo') {
      cols = [
        { key: 'sucursal_id',          label: 'ID' },
        { key: 'sucursal_nombre',      label: 'Sucursal' },
        { key: 'OBJETIVO_VENTAS',      label: 'Obj.Ventas',      render: fmt },
        { key: 'OBJETIVO_COBRANZAS',   label: 'Obj.Cobranzas',   render: fmt },
        { key: 'OBJETIVO_OPERACIONES', label: 'Obj.Operaciones', render: fmt },
        { key: 'OBJETIVO_PARTICIPA',   label: 'Participación',   render: fmtPctDir },
        { key: 'OBJETIVO_CREDPRO',     label: 'Créd.Prom.',      render: fmt },
      ];
    } else {
      cols = [
        { key: 'sucursal_id',              label: 'ID' },
        { key: 'sucursal_nombre',          label: 'Sucursal' },
        { key: 'OBJETIVO_VENTAS_EFE',      label: 'Obj.Ventas Ef.',      render: fmt },
        { key: 'OBJETIVO_COBRANZAS_EFE',   label: 'Obj.Cobranzas Ef.',   render: fmt },
        { key: 'OBJETIVO_OPERACIONES_EFE', label: 'Obj.Operaciones Ef.', render: fmt },
        { key: 'OBJETIVO_PARTICIPA_EFE',   label: 'Participación Ef.',   render: fmtPctDir },
        { key: 'OBJETIVO_CREDPRO_EFE',     label: 'Créd.Prom. Ef.',      render: fmt },
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

  loadTab(activeTab);
}
