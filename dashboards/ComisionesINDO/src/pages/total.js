import { api, isSupervisorReadonly } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { exportToCSV } from '../components/exportExcel.js';
import { resolverMontosParaCalculo } from '../utils/confirmMontos.js';

const TABS = [
  { key: 'sucursales',  label: 'Sucursales' },
  { key: 'cajeros',     label: 'Cajeros' },
  { key: 'operadores',  label: 'Operadores' },
  { key: 'encargados',  label: 'Encargados' },
  { key: 'supervisores',label: 'Supervisores' }
];

export async function renderTotal(container, periodo) {
  container.innerHTML = `
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">📋 Vista TOTAL — ${periodo}</h2>
    <div class="toolbar" style="margin-bottom:12px">
      <button class="btn btn-primary" id="btn-calc" ${isSupervisorReadonly() ? 'style="display:none"' : ''}>▶ Ejecutar cálculo</button>
      <button class="btn btn-secondary" id="btn-reload">🔄 Cargar último</button>
      <button class="btn btn-secondary" id="btn-export">⬇ Exportar CSV</button>
      <span id="calc-info" style="font-size:12px;color:var(--color-muted)"></span>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:0;border-bottom:2px solid var(--color-border)">
      ${TABS.map((t, i) => `
        <button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.key}"
          style="padding:8px 18px;font-size:13px;font-weight:600;border:none;border-radius:6px 6px 0 0;cursor:pointer;
                 background:${i === 0 ? 'var(--color-primary)' : 'var(--color-card)'};
                 color:${i === 0 ? '#fff' : 'var(--color-text)'};border-bottom:none">
          ${t.label}
        </button>
      `).join('')}
    </div>
    <div id="total-wrap" style="margin-top:0">
      <p style="color:var(--color-muted);text-align:center;padding:40px">
        Ejecutá el cálculo o cargá el último resultado guardado.
      </p>
    </div>
  `;

  let resultado = null;
  let activeTab = 'sucursales';

  function switchTab(tabKey) {
    activeTab = tabKey;
    container.querySelectorAll('.tab-btn').forEach(b => {
      const active = b.dataset.tab === tabKey;
      b.style.background = active ? 'var(--color-primary)' : 'var(--color-card)';
      b.style.color       = active ? '#fff' : 'var(--color-text)';
      b.classList.toggle('active', active);
    });
    if (resultado) renderActiveTab();
  }

  container.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  function renderActiveTab() {
    const wrap = container.querySelector('#total-wrap');
    if (!resultado) return;
    switch (activeTab) {
      case 'sucursales':  renderSucursales(wrap, resultado.sucursales || []); break;
      case 'cajeros':     renderCajeros(wrap, resultado.cajeros || []); break;
      case 'operadores':  renderOperadores(wrap, resultado.operadores || []); break;
      case 'encargados':  renderEncargados(wrap, resultado.encargados || []); break;
      case 'supervisores':renderSupervisores(wrap, resultado.supervisores || []); break;
    }
  }

  container.querySelector('#btn-calc').addEventListener('click', async () => {
    const usarMontosActuales = await resolverMontosParaCalculo(periodo);
    if (usarMontosActuales === null) return;
    const btn = container.querySelector('#btn-calc');
    btn.disabled = true; btn.textContent = 'Calculando…';
    try {
      const res = await api.post('/calculo/ejecutar', { periodo, usarMontosActuales });
      resultado = res.resultado;
      renderActiveTab();
      container.querySelector('#calc-info').textContent =
        `Ejecutado ahora — ${res.total_sucursales} suc, ${res.total_operadores} oper, ${res.total_cajeros} caj, ${res.total_encargados} enc, ${res.total_supervisores} sup`;
      showToast('Cálculo completado', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '▶ Ejecutar cálculo';
    }
  });

  container.querySelector('#btn-reload').addEventListener('click', async () => {
    try {
      const res = await api.get(`/calculo/ultimo?periodo=${periodo}`);
      resultado = res.resultado;
      renderActiveTab();
      container.querySelector('#calc-info').textContent =
        `Último: ${new Date(res.fecha_calculo).toLocaleString('es-AR')} — ${res.usuario}`;
    } catch (err) { showToast(err.message, 'error'); }
  });

  container.querySelector('#btn-export').addEventListener('click', () => {
    if (!resultado) { showToast('Nada que exportar', 'error'); return; }
    const data = resultado[activeTab] || [];
    if (!data.length) { showToast('Sin datos en esta pestaña', 'error'); return; }
    exportToCSV(data, `${activeTab.toUpperCase()}_${periodo}`);
  });

  // Auto cargar último
  try {
    const res = await api.get(`/calculo/ultimo?periodo=${periodo}`);
    resultado = res.resultado;
    renderActiveTab();
    container.querySelector('#calc-info').textContent =
      `Último: ${new Date(res.fecha_calculo).toLocaleString('es-AR')} — ${res.usuario}`;
  } catch { /* sin cálculo previo */ }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtMoney(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(v) { return v != null ? (v * 100).toFixed(1) + '%' : '—'; }
function semCell(v) { return `<span class="sem-${v}">${v}</span>`; }
function catBadge(v) { return `<span class="badge badge-${(v||'c').toLowerCase()}">${v}</span>`; }

function simpleTable(wrap, cols, rows) {
  if (!rows.length) {
    wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Sin datos</p></div></div>';
    return;
  }
  const heads = cols.map(c => `<th>${c.label}</th>`).join('');
  const body  = rows.map(r => `<tr>${cols.map(c => `<td>${c.render ? c.render(r[c.key], r) : (r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('');
  wrap.innerHTML = `
    <div class="card" style="margin-top:0">
      <div class="table-wrap"><table>
        <thead><tr>${heads}</tr></thead>
        <tbody>${body}</tbody>
      </table></div>
    </div>`;
}

// ─── Sucursales (resumen) ────────────────────────────────────────────────────
function renderSucursales(wrap, data) {
  const cols = [
    { key: 'sucursal_id',        label: 'ID' },
    { key: 'sucursal_nombre',    label: 'Sucursal' },
    { key: 'categoria',          label: 'Cat.', render: v => catBadge(v) },
    { key: 'semaforo_efectivo',  label: 'Sem.Ef.', render: v => semCell(v) },
    { key: 'escalon_efectivo',   label: 'Esc.Ef.' },
    { key: 'ratio_efectivo',     label: 'Ratio Ef.', render: v => fmtPct(v) },
    { key: 'vta_efectivo',       label: 'Vta.Ef.', render: v => fmtMoney(v) },
    { key: 'obj_efectivo',       label: 'Obj.Ef.', render: v => fmtMoney(v) },
    { key: 'semaforo_consumo',   label: 'Sem.Con.', render: v => semCell(v) },
    { key: 'escalon_consumo',    label: 'Esc.Con.' },
    { key: 'ratio_consumo',      label: 'Ratio Con.', render: v => fmtPct(v) },
    { key: 'vta_consumo',        label: 'Vta.Con.', render: v => fmtMoney(v) },
    { key: 'obj_consumo',        label: 'Obj.Con.', render: v => fmtMoney(v) },
    { key: 'tiene_efectivo',      label: 'Tipo Op.', render: v => v
        ? '<span class="badge badge-a">CON ef.</span>'
        : '<span class="badge badge-c">SIN ef.</span>' },
    { key: 'monto_con_efect',    label: 'CON Ef.', render: v => fmtMoney(v) },
    { key: 'monto_sin_efect',    label: 'SIN Ef.', render: v => fmtMoney(v) },
    { key: 'monto_encargado',    label: 'Encarg.', render: v => fmtMoney(v) },
    { key: 'monto_enc_millon',   label: 'Enc.Mill.', render: v => fmtMoney(v) },
    { key: 'vend_full',          label: 'Vend.Full', render: v => fmtMoney(v) },
    { key: 'vend_part',          label: 'Vend.Part', render: v => fmtMoney(v) },
    { key: 'vend_cajero',        label: 'Caj/persona', render: v => fmtMoney(v) },
    { key: 'sup_consumo_suc',    label: 'Sup.Con.Suc', render: v => fmtMoney(v) },
    { key: 'sup_efectivo_suc',   label: 'Sup.Ef.Suc', render: v => fmtMoney(v) },
    { key: 'prest_suc',          label: 'Prest.Suc', render: v => fmtMoney(v) },
    { key: 'cajero_fijo',        label: 'Caj.Fijo', render: v => fmtMoney(v) }
  ];
  simpleTable(wrap, cols, data);
}

// ─── Cajeros ─────────────────────────────────────────────────────────────────
function renderCajeros(wrap, data) {
  const cols = [
    { key: 'nro_vendedor',   label: 'N° Vend.' },
    { key: 'nombre',         label: 'Nombre' },
    { key: 'sucursal_id',    label: 'Suc. ID' },
    { key: 'sucursal_nombre',label: 'Sucursal' },
    { key: 'categoria',      label: 'Cat.', render: v => catBadge(v) },
    { key: 'escalon',        label: 'Escalón' },
    { key: 'parcial',        label: 'Part.', render: v => v ? '<span class="badge badge-c">Sí</span>' : '—' },
    { key: 'monto',          label: 'Comisión $', render: v => fmtMoney(v) }
  ];
  simpleTable(wrap, cols, data);
}

// ─── Operadores ──────────────────────────────────────────────────────────────
function renderOperadores(wrap, data) {
  const cols = [
    { key: 'nro_vendedor',    label: 'N° Vend.' },
    { key: 'nombre',          label: 'Nombre' },
    { key: 'sucursal_id',     label: 'Suc. ID' },
    { key: 'sucursal_nombre', label: 'Sucursal' },
    { key: 'categoria',       label: 'Cat.', render: v => catBadge(v) },
    { key: 'escalon',         label: 'Escalón' },
    { key: 'tipo_operador',   label: 'Tipo', render: v => v === 'OPER_CON_EFECT'
        ? '<span class="badge badge-a">CON ef.</span>'
        : '<span class="badge badge-c">SIN ef.</span>' },
    { key: 'tipo_contrato',   label: 'Contrato' },
    { key: 'parcial',         label: 'Mes parc.', render: v => v ? '<span class="badge badge-c">Sí</span>' : '—' },
    { key: 'monto',           label: 'Comisión $', render: v => fmtMoney(v) }
  ];
  simpleTable(wrap, cols, data);
}

// ─── Encargados ──────────────────────────────────────────────────────────────
function renderEncargados(wrap, data) {
  const cols = [
    { key: 'id',              label: 'ID' },
    { key: 'nombre',          label: 'Nombre' },
    { key: 'sucursal_id',     label: 'Suc. ID' },
    { key: 'sucursal_nombre', label: 'Sucursal' },
    { key: 'categoria',       label: 'Cat.', render: v => catBadge(v) },
    { key: 'escalon',         label: 'Escalón' },
    { key: 'monto_encargado', label: 'Encargado $', render: v => fmtMoney(v) },
    { key: 'monto_millon',    label: 'Millón $', render: v => fmtMoney(v) },
    { key: 'monto',           label: 'Total $', render: v => fmtMoney(v) }
  ];
  simpleTable(wrap, cols, data);
}

// ─── Supervisores ────────────────────────────────────────────────────────────
function renderSupervisores(wrap, data) {
  if (!data.length) {
    wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Sin supervisores. Registralos en la sección Supervisores.</p></div></div>';
    return;
  }
  const rows = data.map(s => `
    <tr>
      <td>${s.nombre}</td>
      <td>${s.sucursales.length}</td>
      <td style="font-size:11px;max-width:220px;white-space:normal">
        ${s.sucursales.map(d => `<span class="badge badge-${(d.categoria||'c').toLowerCase()}" style="margin:1px" title="${d.sucursal_nombre}">${d.sucursal_id}</span>`).join('')}
      </td>
      <td style="text-align:right">${fmtMoney(s.total_por_sucursales)}</td>
      <td style="text-align:right">${fmtMoney(s.total_por_plaza)}</td>
      <td style="text-align:right;font-weight:700">${fmtMoney(s.monto)}</td>
    </tr>
  `).join('');
  wrap.innerHTML = `
    <div class="card" style="margin-top:0">
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Supervisor</th><th># Suc.</th><th>Sucursales</th>
          <th style="text-align:right">Por suc. $</th>
          <th style="text-align:right">Por plaza $</th>
          <th style="text-align:right">Total $</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}
