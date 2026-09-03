import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

const TABS = [
  { key: 'con_efect', label: 'Oper. CON Efectivo', seccion: 'OPER_CON_EFECT' },
  { key: 'sin_efect', label: 'Oper. SIN Efectivo', seccion: 'OPER_SIN_EFECT' },
  { key: 'encargado', label: 'Encargado',          seccion: 'ENCARGADO' },
  { key: 'enc_millon',label: 'Enc. Millón',         seccion: 'ENC_MILLON' },
  { key: 'vendedor',  label: 'Vendedores',          tipo: 'vendedor' },
  { key: 'supervisor',label: 'Supervisor',          tipo: 'supervisor' },
  { key: 'prestamos', label: 'Sucursal',             tipo: 'prestamos' },
  { key: 'cajero',    label: 'Cajero',               tipo: 'cajero' }
];

let activeTab = 'con_efect';
let allData   = {};
let multiplicadores = {}; // { 'A': 1.3, 'B': 1.15, 'C': 1 }
let rootEl;
let activeCat = null;

// Tabs donde NO se aplica multiplicador
const SIN_MULTIPLICADOR = new Set(['vendedor', 'cajero']);

function roundTo1000(v) {
  return Math.round(v / 1000) * 1000;
}

function applyMultiplier(rows, factor, columns) {
  return rows.map(row => {
    const out = { ...row };
    for (const col of columns) {
      if (col.editable && typeof out[col.key] === 'number') {
        out[col.key] = roundTo1000(out[col.key] * factor);
      }
    }
    out.categoria_suc = activeCat;
    return out;
  });
}

export async function renderMontos(container, _periodo) {
  rootEl = container;

  container.innerHTML = `
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">💰 ABM Montos</h2>
    <div class="tabs" id="montos-tabs">
      ${TABS.map(t => `<button class="tab-btn ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
    <div id="montos-body"></div>
  `;

  container.querySelector('#montos-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    activeTab = btn.dataset.tab;
    activeCat = null;
    container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
    renderTab();
  });

  await loadAll();
  renderTab();
}

async function loadAll() {
  const tipos = ['base', 'vendedor', 'supervisor', 'prestamos', 'cajero'];
  const [multResult, ...dataResults] = await Promise.allSettled([
    api.get('/ranking/multiplicadores'),
    ...tipos.map(t => api.get(`/montos/${t}`))
  ]);
  if (multResult.value) {
    multResult.value.forEach(m => { multiplicadores[m.categoria] = m.multiplicador ?? m.factor ?? 1; });
  }
  multiplicadores['C'] = multiplicadores['C'] ?? 1;
  tipos.forEach((t, i) => allData[t] = dataResults[i].value || []);
}

function renderTab() {
  const body = rootEl.querySelector('#montos-body');
  const tab  = TABS.find(t => t.key === activeTab);
  if (!tab) return;

  let data, columns;

  if (tab.key === 'con_efect' || tab.key === 'sin_efect') {
    data = allData.base?.filter(r => r.seccion === tab.seccion) || [];
    columns = [
      { key: 'escalon',        label: 'Escalón' },
      { key: 'categoria_suc',  label: 'Categoría' },
      { key: 'participacion',  label: 'Participación', editable: true },
      { key: 'escalon_monto',  label: 'Monto Escalón', editable: true },
      { key: 'ticket_promedio',label: 'Ticket Prom.',  editable: true },
      { key: 'operacion',      label: 'Operación',      editable: true },
    ];
  } else if (tab.key === 'encargado') {
    data = allData.base?.filter(r => r.seccion === tab.seccion) || [];
    columns = [
      { key: 'escalon',       label: 'Escalón' },
      { key: 'categoria_suc', label: 'Categoría' },
      { key: 'participacion', label: 'Participación', editable: true },
      { key: 'escalon_monto', label: 'Monto Escalón', editable: true },
    ];
  } else if (tab.key === 'enc_millon') {
    data = allData.base?.filter(r => r.seccion === tab.seccion) || [];
    columns = [
      { key: 'escalon',       label: 'Escalón' },
      { key: 'categoria_suc', label: 'Categoría' },
      { key: 'escalon_monto', label: 'Monto Escalón', editable: true },
    ];
  } else if (tab.tipo === 'vendedor') {
    renderVendedorPivot(body);
    return;
  } else if (tab.tipo === 'supervisor') {
    // consumo=por_sucursal (Retail) y efectivo=por_plaza (Millón, plaza) son la base;
    // efectivo=por_sucursal (Millón, individual, convive con por_plaza) se agregó 03/09/2026.
    data = allData.supervisor?.filter(r =>
      (r.concepto === 'consumo'  && r.tipo === 'por_sucursal') ||
      (r.concepto === 'efectivo' && r.tipo === 'por_plaza') ||
      (r.concepto === 'efectivo' && r.tipo === 'por_sucursal')
    ) || [];
    columns = [
      { key: 'concepto',      label: 'Concepto' },
      { key: 'tipo',          label: 'Tipo' },
      { key: 'categoria_suc', label: 'Categoría' },
      { key: 'monto',         label: 'Monto', editable: true },
    ];
  } else if (tab.tipo === 'prestamos') {
    data = allData.prestamos?.filter(r => r.tipo === 'suc') || [];
    columns = [
      { key: 'escalon',       label: 'Escalón' },
      { key: 'categoria_suc', label: 'Categoría' },
      { key: 'monto',         label: 'Monto', editable: true }
    ];
  } else {
    data = allData.cajero || [];
    columns = [
      { key: 'categoria_suc', label: 'Categoría' },
      { key: 'monto',         label: 'Monto', editable: true }
    ];
  }

  const tipoApi = tab.seccion ? 'base' : tab.tipo;
  const usaMultiplicador = !SIN_MULTIPLICADOR.has(tab.tipo || tab.key);

  // Siempre base C; si se selecciona B o A se calculan
  const baseCData = tab.seccion
    ? allData.base?.filter(r => r.seccion === tab.seccion && r.categoria_suc === 'C') || []
    : data.filter(r => r.categoria_suc === 'C');

  let displayData;
  let isReadOnly = false;
  if (!activeCat || activeCat === 'C' || !usaMultiplicador) {
    displayData = baseCData;
  } else {
    const factor = multiplicadores[activeCat] ?? 1;
    displayData = applyMultiplier(baseCData, factor, columns);
    isReadOnly = true;
  }

  // Botones de categoría fijos: C editable, B y A calculados
  const catBtns = (usaMultiplicador ? ['C', 'B', 'A'] : ['C']).map(c => {
    const label = c === 'C' ? 'C (base)' : `${c} ×${multiplicadores[c] ?? '?'}`;
    const active = (!activeCat && c === 'C') || activeCat === c;
    return `<button class="btn btn-sm${active ? ' btn-primary' : ''}" data-cat="${c}">${label}</button>`;
  }).join('');

  body.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
      <span style="font-size:13px;color:var(--color-muted)">Categoría:</span>
      ${catBtns}
      ${isReadOnly ? '<span style="font-size:12px;color:var(--color-muted);margin-left:8px">⚠ Valores calculados — solo lectura</span>' : ''}
    </div>
    ${renderInlineTable(displayData, columns, tipoApi, isReadOnly)}
  `;

  body.querySelectorAll('[data-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCat = btn.dataset.cat || null;
      renderTab();
    });
  });

  attachSaveHandlers(body, displayData, columns, tipoApi);
}

// ── Vendedor pivot ─────────────────────────────────────────────────────────
function renderVendedorPivot(body) {
  const rawC = allData.vendedor?.filter(r => r.categoria_suc === 'C' && r.tipo_vendedor !== 'CAJERO') || [];
  const escalones = [...new Set(rawC.map(r => r.escalon))].sort((a, b) => a - b);
  const pivoted = escalones.map(esc => ({
    escalon:    esc,
    categoria_suc: 'C',
    monto_full: rawC.find(r => r.escalon === esc && r.tipo_vendedor === 'FULL')?.monto ?? 0,
    monto_part: rawC.find(r => r.escalon === esc && r.tipo_vendedor === 'PART')?.monto ?? 0,
  }));

  if (!pivoted.length) {
    body.innerHTML = '<p style="color:var(--color-muted);padding:20px">Sin datos.</p>';
    return;
  }

  const rows = pivoted.map((row, i) => `
    <tr>
      <td>${row.escalon}</td>
      <td>${row.categoria_suc}</td>
      <td><input class="form-control" style="width:100%;min-width:80px" type="number" step="1"
          data-row="${i}" data-key="monto_full" value="${row.monto_full}"></td>
      <td><input class="form-control" style="width:100%;min-width:80px" type="number" step="1"
          data-row="${i}" data-key="monto_part" value="${row.monto_part}"></td>
      <td><button class="btn btn-sm btn-primary btn-save-vend" data-row="${i}" data-escalon="${row.escalon}">💾</button></td>
    </tr>`).join('');

  body.innerHTML = `
    <div class="card"><div class="table-wrap">
      <table><thead><tr>
        <th>Escalón</th><th>Categoría</th><th>Monto FULL</th><th>Monto PART</th><th>Guardar</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </div></div>`;

  body.querySelectorAll('.btn-save-vend').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i      = +btn.dataset.row;
      const escalon = +btn.dataset.escalon;
      const monto_full = parseFloat(body.querySelector(`[data-row="${i}"][data-key="monto_full"]`).value) || 0;
      const monto_part = parseFloat(body.querySelector(`[data-row="${i}"][data-key="monto_part"]`).value) || 0;
      btn.disabled = true;
      try {
        await api.put(`/montos/vendedor-pivot/${escalon}`, { monto_full, monto_part });
        allData.vendedor = await api.get('/montos/vendedor');
        showToast('Guardado correctamente', 'success');
        renderTab();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

function renderInlineTable(data, columns, tipo, isReadOnly = false) {
  if (!data.length) return '<p style="color:var(--color-muted);padding:20px">Sin datos. Ejecutá el seed SQL primero.</p>';
  const heads = columns.map(c => `<th>${c.label}</th>`).join('') + (isReadOnly ? '' : '<th>Guardar</th>');
  const rows = data.map((row, i) => {
    const cells = columns.map(c => {
      if (c.editable && !isReadOnly) {
        return `<td><input class="form-control" style="width:100%;min-width:80px" type="number" step="0.01"
            data-row="${i}" data-key="${c.key}" value="${row[c.key] ?? ''}"></td>`;
      }
      return `<td>${row[c.key] ?? ''}</td>`;
    }).join('');
    const saveBtn = isReadOnly ? '' : `<td><button class="btn btn-sm btn-primary btn-save" data-row="${i}" data-id="${row.id}" data-tipo="${tipo}">💾</button></td>`;
    return `<tr>${cells}${saveBtn}</tr>`;
  }).join('');
  return `<div class="card"><div class="table-wrap"><table><thead><tr>${heads}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function attachSaveHandlers(body, data, columns, tipo) {
  body.querySelectorAll('.btn-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i   = +btn.dataset.row;
      const id  = btn.dataset.id;
      const row = { ...data[i] };

      body.querySelectorAll(`[data-row="${i}"]`).forEach(inp => {
        row[inp.dataset.key] = parseFloat(inp.value) || 0;
      });

      btn.disabled = true;
      try {
        await api.put(`/montos/${tipo}/${id}`, row);
        // Recargar datos frescos desde el servidor (incluye cascade A/B)
        const fresh = await api.get(`/montos/${tipo}`);
        allData[tipo] = fresh;
        showToast('Guardado correctamente', 'success');
        renderTab();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}
