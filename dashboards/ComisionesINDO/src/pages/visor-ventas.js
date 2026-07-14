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

// fecha_alta viene como ISO datetime → mostrar dd/mm/yyyy
function fmtFecha(v) {
  if (!v) return '—';
  const iso = String(v).slice(0, 10);          // YYYY-MM-DD
  const [y, m, d] = iso.split('-');
  return (y && m && d) ? `${d}/${m}/${y}` : String(v);
}
function fechaISO(v) { return v ? String(v).slice(0, 10) : ''; }

const SPINNER = `<p style="color:var(--color-muted);text-align:center;padding:40px">
  <span style="display:inline-block;animation:spin 1s linear infinite;font-size:24px">⏳</span><br>Cargando…
</p>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;

const COLS_VENTAS = [
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

const COLS_ORIG = [
  { key: 'id_originacion',   label: 'ID Orig.' },
  { key: 'estado',           label: 'Estado' },
  { key: 'usuario_originador', label: 'Operador' },
  { key: 'fecha_alta',       label: 'Fecha',    render: fmtFecha },
  { key: 'producto',         label: 'Producto' },
  { key: 'importe_capital',  label: 'Importe',  render: fmt },
  { key: 'cantidad_cuotas',  label: 'Cuotas',   render: fmt },
  { key: 'sucursal',         label: 'Sucursal' },
];

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
      <div id="ventas-header" style="flex-shrink:0;display:flex;align-items:center;gap:12px;padding:8px 0 4px;flex-wrap:wrap">
        <button id="btn-reload" class="btn btn-secondary" style="font-size:13px">🔄 Recargar</button>
        <div id="orig-filtros" style="display:none;align-items:center;gap:8px;flex-wrap:wrap">
          <select id="f-operador" style="font-size:13px;padding:5px 8px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-card);color:var(--color-text)">
            <option value="">Operador: todos</option>
          </select>
          <select id="f-sucursal" style="font-size:13px;padding:5px 8px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-card);color:var(--color-text)">
            <option value="">Sucursal: todas</option>
          </select>
          <label style="font-size:12px;color:var(--color-muted)">Desde
            <input type="date" id="f-desde" style="font-size:13px;padding:4px 6px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-card);color:var(--color-text)">
          </label>
          <label style="font-size:12px;color:var(--color-muted)">Hasta
            <input type="date" id="f-hasta" style="font-size:13px;padding:4px 6px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-card);color:var(--color-text)">
          </label>
          <button id="btn-limpiar" class="btn btn-secondary" style="font-size:13px">🧹 Limpiar</button>
          <button id="btn-csv" class="btn btn-secondary" style="font-size:13px">⬇️ CSV</button>
        </div>
        <span id="badge-count" style="font-size:12px;color:var(--color-muted)"></span>
      </div>
      <div id="ventas-wrap" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">${SPINNER}</div>
    </div>
  `;

  let activeTab = 'consumo';
  let origRows  = [];   // dataset completo de originaciones del período

  const $ = sel => container.querySelector(sel);

  function switchTab(key) {
    activeTab = key;
    container.querySelectorAll('.tab-btn').forEach(b => {
      const active = b.dataset.tab === key;
      b.style.background = active ? 'var(--color-primary)' : 'var(--color-card)';
      b.style.color      = active ? '#fff' : 'var(--color-text)';
      b.classList.toggle('active', active);
    });
    $('#orig-filtros').style.display = key === 'originaciones' ? 'flex' : 'none';
    loadTab(key);
  }

  async function loadTab(key) {
    const wrap  = $('#ventas-wrap');
    const badge = $('#badge-count');
    const tabDef = TABS.find(t => t.key === key);
    if (!tabDef) return;

    wrap.innerHTML = SPINNER;
    badge.textContent = '';
    try {
      const raw  = await api.get(tabDef.endpoint(periodo));
      const rows = Array.isArray(raw) ? raw : (raw.data ?? raw.datos ?? raw.reporte ?? []);
      if (tabDef.type === 'orig') {
        origRows = rows;
        poblarSelects(rows);
        aplicarFiltros();
      } else {
        badge.textContent = `${rows.length} registros`;
        renderTab(wrap, COLS_VENTAS, rows);
      }
    } catch (err) {
      showToast(err.message, 'error');
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Error al cargar datos.</p></div></div>';
    }
  }

  // ── Filtros de Originaciones ──────────────────────────────────
  function poblarSelects(rows) {
    const opSel  = $('#f-operador');
    const sucSel = $('#f-sucursal');
    const opPrev  = opSel.value;
    const sucPrev = sucSel.value;

    const ops  = [...new Set(rows.map(r => r.usuario_originador).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
    const sucs = [...new Set(rows.map(r => r.sucursal).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));

    opSel.innerHTML  = '<option value="">Operador: todos</option>'  + ops.map(o => `<option value="${o}">${o}</option>`).join('');
    sucSel.innerHTML = '<option value="">Sucursal: todas</option>' + sucs.map(s => `<option value="${s}">${s}</option>`).join('');
    if (ops.includes(opPrev))   opSel.value  = opPrev;
    if (sucs.includes(sucPrev)) sucSel.value = sucPrev;
  }

  function filtrarOrig() {
    const op    = $('#f-operador').value;
    const suc   = $('#f-sucursal').value;
    const desde = $('#f-desde').value;
    const hasta = $('#f-hasta').value;
    return origRows.filter(r => {
      if (op  && String(r.usuario_originador) !== op) return false;
      if (suc && String(r.sucursal) !== suc) return false;
      const f = fechaISO(r.fecha_alta);
      if (desde && f && f < desde) return false;
      if (hasta && f && f > hasta) return false;
      return true;
    });
  }

  function aplicarFiltros() {
    const rows = filtrarOrig();
    $('#badge-count').textContent = rows.length === origRows.length
      ? `${rows.length} registros`
      : `${rows.length} de ${origRows.length} registros`;
    renderTab($('#ventas-wrap'), COLS_ORIG, rows);
  }

  // ── Descarga CSV (filas filtradas, formato es-AR: sep ; y coma decimal)
  function descargarCSV() {
    const rows = filtrarOrig();
    if (!rows.length) { showToast('No hay registros para exportar.', 'error'); return; }

    const esc = v => {
      const s = v == null ? '' : String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const num = v => v == null ? '' : String(v).replace('.', ',');

    const header = COLS_ORIG.map(c => esc(c.label)).join(';');
    const lines  = rows.map(r => [
      r.id_originacion,
      esc(r.estado),
      esc(r.usuario_originador),
      fmtFecha(r.fecha_alta) === '—' ? '' : fmtFecha(r.fecha_alta),
      esc(r.producto),
      num(r.importe_capital),
      r.cantidad_cuotas ?? '',
      esc(r.sucursal),
    ].join(';'));

    const csv  = String.fromCharCode(0xFEFF) + [header, ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `originaciones_${periodo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function renderTab(wrap, cols, rows) {
    if (!rows.length) {
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Sin datos.</p></div></div>';
      return;
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

  $('#btn-reload').addEventListener('click', () => loadTab(activeTab));
  ['#f-operador', '#f-sucursal', '#f-desde', '#f-hasta'].forEach(sel => {
    $(sel).addEventListener('change', aplicarFiltros);
  });
  $('#btn-limpiar').addEventListener('click', () => {
    $('#f-operador').value = '';
    $('#f-sucursal').value = '';
    $('#f-desde').value = '';
    $('#f-hasta').value = '';
    aplicarFiltros();
  });
  $('#btn-csv').addEventListener('click', descargarCSV);

  loadTab(activeTab);
}
