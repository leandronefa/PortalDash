import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { exportToCSV } from '../components/exportExcel.js';

function fmtMoney(v) {
  if (v == null || v === '') return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function catBadge(v) {
  const c = (v || 'C').toUpperCase();
  return `<span class="badge badge-${c.toLowerCase()}">${c}</span>`;
}

function escalonBadge(escalon) {
  if (escalon === 3) return `<span class="badge badge-a">E3</span>`;
  if (escalon === 2) return `<span class="badge badge-b">E2</span>`;
  if (escalon === 1) return `<span class="badge badge-d">E1</span>`;
  return `<span class="badge badge-c">E0</span>`;
}

function fmtRatio(ratio) {
  if (!ratio && ratio !== 0) return '<span style="color:var(--color-muted);font-size:11px">—</span>';
  const pct = (ratio * 100).toFixed(1) + '%';
  const color = ratio >= 1.0 ? 'var(--color-success)' : ratio >= 0.96 ? 'var(--badge-e-t)' : 'var(--color-danger)';
  return `<span style="color:${color};font-size:12px;font-weight:600">${pct}</span>`;
}

function comisionaBadge(comisiona) {
  return comisiona
    ? `<span class="badge" style="background:var(--badge-d-bg);color:var(--badge-d-t)">SI</span>`
    : `<span class="badge" style="background:var(--sem-red);color:var(--sem-red-t)">NO</span>`;
}

// Agrupa filas planas por sucursal
function agruparPorSucursal(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.sucursal_id)) {
      map.set(r.sucursal_id, {
        sucursal_id:     r.sucursal_id,
        sucursal_nombre: r.sucursal_nombre,
        categoria:       r.categoria,
        obj_sucursal:    r.obj_sucursal,
        n_operadores:    r.n_operadores,
        obj_individual:  r.obj_individual,
        operadores:      [],
      });
    }
    map.get(r.sucursal_id).operadores.push(r);
  }
  return [...map.values()].sort((a, b) => a.sucursal_id - b.sucursal_id);
}

export async function renderOperadoresMillon(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">

      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="font-size:20px;font-weight:700;margin:0">Operadores Millón — ${periodo}</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="opm-search" type="text" placeholder="Sucursal u operador…"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   background:var(--color-input);color:var(--color-text);font-size:13px;width:200px">
          <select id="opm-filter-comisiona"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   background:var(--color-input);color:var(--color-text);font-size:13px">
            <option value="">Todos</option>
            <option value="si">Comisionan</option>
            <option value="no">No comisionan</option>
          </select>
          <button id="btn-calcular" class="btn btn-primary">⟳ Calcular</button>
          <button id="btn-export" class="btn btn-secondary">⬇ CSV</button>
        </div>
      </div>

      <div id="opm-summary" style="flex-shrink:0;display:flex;gap:12px;margin-bottom:10px"></div>
      <div id="opm-info" style="flex-shrink:0;font-size:12px;color:var(--color-muted);margin-bottom:6px"></div>

      <div id="opm-wrap" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">
        <p style="color:var(--color-muted);text-align:center;padding:40px">Cargando…</p>
      </div>

    </div>
  `;

  let allData      = [];
  let shownData    = [];
  const expandedSet = new Set();

  function renderSummary(rows) {
    const comisionan = rows.filter(r => r.comisiona).length;
    const totalMonto = rows.reduce((s, r) => s + (+r.monto || 0), 0);
    const sucursales = new Set(rows.map(r => r.sucursal_id)).size;
    const kpis = [
      { label: 'Sucursales',    value: sucursales },
      { label: 'Operadores',    value: rows.length },
      { label: 'Comisionan',    value: comisionan },
      { label: 'Total $',       value: `$ ${fmtMoney(totalMonto)}` },
    ];
    container.querySelector('#opm-summary').innerHTML = kpis.map(k => `
      <div class="card" style="padding:10px 16px;min-width:110px;text-align:center">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:4px">${k.label}</div>
        <div style="font-size:18px;font-weight:700">${k.value}</div>
      </div>
    `).join('');
  }

  function renderTabla(rows) {
    shownData = rows;
    const wrap = container.querySelector('#opm-wrap');
    if (!rows.length) {
      wrap.innerHTML = `<div class="card"><div class="card-body">
        <p style="color:var(--color-muted)">Sin datos. Usá <strong>⟳ Calcular</strong> para procesar el período.</p>
      </div></div>`;
      renderSummary([]);
      return;
    }

    renderSummary(rows);
    const grupos = agruparPorSucursal(rows);

    const html = grupos.map(g => {
      const expanded    = expandedSet.has(g.sucursal_id);
      const comisionan  = g.operadores.filter(o => o.comisiona).length;
      const totalMonto  = g.operadores.reduce((s, o) => s + (+o.monto_full || 0), 0);

      const trs = g.operadores.map(op => {
        const zero = 'opacity:.4';
        return `
          <tr>
            <td style="padding:8px 14px">${op.nombre || op.usuario}</td>
            <td style="padding:8px 8px;text-align:right;font-size:12px">$ ${fmtMoney(op.vta_efectivo)}</td>
            <td style="padding:8px 8px;text-align:right;font-size:12px">$ ${fmtMoney(op.obj_individual)}</td>
            <td style="padding:8px 8px;text-align:center">${fmtRatio(op.ratio)}</td>
            <td style="padding:8px 8px;text-align:center">${escalonBadge(op.escalon)}</td>
            <td style="padding:8px 8px;text-align:center">${comisionaBadge(op.comisiona)}</td>
            <td style="padding:8px 8px;text-align:right;font-weight:700;cursor:help;${op.monto_full === 0 ? zero : ''}"
                title="${op.escalon >= 1
                  ? `Monto de la tabla Préstamos (tipo suc), escalón E${op.escalon}, categoría ${op.categoria}. Valor final por categoría — sin multiplicador adicional.`
                  : 'No llegó a E1 → sin comisión.'}">$ ${fmtMoney(op.monto_full)}</td>
            <td style="padding:8px 14px 8px 8px;text-align:right;font-size:11px;color:var(--color-muted);${op.monto_part === 0 ? zero : ''}">$ ${fmtMoney(op.monto_part)}</td>
          </tr>`;
      }).join('');

      return `
        <div class="card" style="margin-bottom:6px" data-suc-id="${g.sucursal_id}">
          <div class="acc-header" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;user-select:none">
            <span class="acc-arrow" style="font-size:10px;transition:transform 150ms;transform:rotate(${expanded ? 90 : 0}deg)">▶</span>
            <span style="font-weight:600">#${g.sucursal_id} ${g.sucursal_nombre}</span>
            ${catBadge(g.categoria)}
            <span style="margin-left:auto;display:flex;gap:10px;align-items:center;font-size:12px">
              <span style="color:var(--color-muted)">
                Obj: <strong>$ ${fmtMoney(g.obj_sucursal)}</strong>
                <span style="font-size:10px;color:var(--color-muted)"> ÷${g.n_operadores} = $ ${fmtMoney(g.obj_individual)}</span>
              </span>
              <span class="badge badge-b">${comisionan}/${g.operadores.length} comisionan</span>
              <span style="font-weight:700">$ ${fmtMoney(totalMonto)}</span>
            </span>
          </div>
          <div class="acc-body" style="display:${expanded ? 'block' : 'none'}">
            <table style="width:100%;border-top:1px solid var(--color-border)">
              <colgroup>
                <col><col style="width:110px"><col style="width:120px">
                <col style="width:70px"><col style="width:56px"><col style="width:80px">
                <col style="width:110px"><col style="width:100px">
              </colgroup>
              <thead style="background:var(--color-bg)">
                <tr>
                  <th style="padding:6px 14px;text-align:left;font-size:11px">Operador</th>
                  <th style="padding:6px 8px;text-align:right;font-size:11px;cursor:help" title="Ventas efectivo del operador según REPORTE">Vta Ef $</th>
                  <th style="padding:6px 8px;text-align:right;font-size:11px;cursor:help" title="Objetivo de la sucursal dividido entre los operadores activos">Obj Individual $</th>
                  <th style="padding:6px 8px;text-align:center;font-size:11px;cursor:help" title="Ventas / Objetivo. ≥96% pasa por tolerancia, ≥100% estricto.">Ratio</th>
                  <th style="padding:6px 8px;text-align:center;font-size:11px">Esc.</th>
                  <th style="padding:6px 8px;text-align:center;font-size:11px">Comisiona</th>
                  <th style="padding:6px 8px;text-align:right;font-size:11px;cursor:help" title="Monto fijo de la tabla Préstamos (tipo suc) según escalón y categoría de la sucursal. Pasá el mouse sobre cada monto para ver la fila usada.">Full $</th>
                  <th style="padding:6px 14px 6px 8px;text-align:right;font-size:11px">Part $</th>
                </tr>
              </thead>
              <tbody>${trs}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');

    wrap.innerHTML = html;

    wrap.querySelectorAll('.acc-header').forEach(header => {
      header.addEventListener('click', () => {
        const card   = header.closest('[data-suc-id]');
        const sucId  = parseInt(card.dataset.sucId, 10);
        const body   = card.querySelector('.acc-body');
        const arrow  = header.querySelector('.acc-arrow');
        const open   = body.style.display !== 'none';
        body.style.display    = open ? 'none' : 'block';
        arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
        if (open) expandedSet.delete(sucId); else expandedSet.add(sucId);
      });
    });
  }

  function filtrar() {
    const q        = container.querySelector('#opm-search').value.toLowerCase();
    const filtroCo = container.querySelector('#opm-filter-comisiona').value;

    const filt = allData.filter(r => {
      const matchQ = !q
        || (r.sucursal_nombre || '').toLowerCase().includes(q)
        || String(r.sucursal_id).includes(q)
        || (r.nombre || '').toLowerCase().includes(q)
        || (r.usuario || '').toLowerCase().includes(q);
      const matchC = !filtroCo
        || (filtroCo === 'si' && r.comisiona)
        || (filtroCo === 'no' && !r.comisiona);
      return matchQ && matchC;
    });

    renderTabla(filt);
    const sucTotal  = new Set(allData.map(r => r.sucursal_id)).size;
    const sucShown  = new Set(filt.map(r => r.sucursal_id)).size;
    container.querySelector('#opm-info').textContent =
      `Mostrando ${filt.length} operadores en ${sucShown} de ${sucTotal} sucursales`;
  }

  container.querySelector('#opm-search').addEventListener('input', filtrar);
  container.querySelector('#opm-filter-comisiona').addEventListener('change', filtrar);

  container.querySelector('#btn-export').addEventListener('click', () => {
    if (!shownData.length) { showToast('Sin datos para exportar', 'error'); return; }
    exportToCSV(shownData, `COMISIONES_MILLON_${periodo}`);
  });

  container.querySelector('#btn-calcular').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-calcular');
    btn.disabled = true;
    btn.textContent = 'Calculando…';
    try {
      const res = await api.post('/millon/operadores/calcular', { periodo });
      allData = res.resultado || [];
      container.querySelector('#opm-info').textContent =
        `Calculado ahora — ${allData.length} operadores · $ ${fmtMoney(res.total_monto)}`;
      filtrar();
      showToast('Cálculo guardado correctamente', 'success');
    } catch (err) {
      showToast(err.message || 'Error al calcular', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⟳ Calcular';
    }
  });

  // Carga inicial
  try {
    const res = await api.get(`/millon/operadores/resultado?periodo=${periodo}`);
    allData = res.resultado || [];
    container.querySelector('#opm-info').textContent =
      `Último cálculo: ${new Date(res.fecha_calculo).toLocaleString('es-AR')} — ${allData.length} operadores`;
    filtrar();
  } catch {
    renderSummary([]);
    container.querySelector('#opm-wrap').innerHTML = `
      <div class="card"><div class="card-body">
        <p style="color:var(--color-muted)">Sin cálculo guardado para este período.<br>
        Presioná <strong>⟳ Calcular</strong> para procesar.</p>
      </div></div>
    `;
    container.querySelector('#opm-info').textContent = 'Sin datos para este período';
  }
}
