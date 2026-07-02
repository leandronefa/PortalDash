import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { exportToCSV } from '../components/exportExcel.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(v) {
  if (v == null || v === 0) return '<span style="color:var(--color-muted)">—</span>';
  return '$' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function catBadge(v) {
  const c = (v || 'C').toUpperCase();
  return `<span class="badge badge-${c.toLowerCase()}">${c}</span>`;
}

function escalonBadge(esc, ratio) {
  if (esc === 3) return `<span class="badge badge-a">E3</span>`;
  if (esc === 2) return `<span class="badge badge-b">E2</span>`;
  if (esc === 1) {
    if (!ratio || ratio >= 1.0) return `<span class="badge badge-d">E1</span>`;
    return `<span class="badge badge-e">E1*</span>`;
  }
  return `<span class="badge badge-c">E0</span>`;
}

function fmtRatio(v) {
  if (v == null) return '<span style="color:var(--color-muted);font-size:11px">—</span>';
  const pct   = (v * 100).toFixed(1) + '%';
  const color = v >= 1.0 ? 'var(--color-success)' : v >= 0.96 ? 'var(--badge-e-t)' : 'var(--color-danger)';
  return `<span style="color:${color};font-size:12px;font-weight:600">${pct}</span>`;
}

// ── Render principal ──────────────────────────────────────────────────────────

export async function renderEncargadosMillon(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">

      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="font-size:20px;font-weight:700;margin:0">👔 Encargados Millón — ${periodo}</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="encm-search" type="text" placeholder="Sucursal…"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   font-size:13px;background:var(--color-surface);color:var(--color-text);width:180px">
          <button id="encm-export" class="btn btn-outline" style="font-size:12px;padding:6px 12px">↓ CSV</button>
        </div>
      </div>

      <div id="encm-summary" style="flex-shrink:0;margin-bottom:10px"></div>
      <div id="encm-alert"   style="flex-shrink:0;margin-bottom:8px"></div>

      <div id="encm-body" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">
        <div style="text-align:center;padding:60px;color:var(--color-muted)">
          <div style="font-size:32px;margin-bottom:12px">⏳</div>
          <p>Cargando…</p>
        </div>
      </div>

    </div>
  `;

  let data;
  try {
    data = await api.get(`/calculo/encargados-millon?periodo=${periodo}`);
  } catch {
    document.getElementById('encm-body').innerHTML = `
      <div style="text-align:center;padding:60px;color:var(--color-muted)">
        <div style="font-size:32px;margin-bottom:12px">📭</div>
        <p style="font-size:14px;font-weight:600">Sin cálculo guardado para ${periodo}</p>
        <p style="font-size:12px">Ejecutá el cálculo completo desde el Dashboard.</p>
      </div>`;
    return;
  }

  const encargados = data.resultado || [];

  if (!encargados.length) {
    document.getElementById('encm-alert').innerHTML = `
      <div style="background:var(--badge-e-bg,#fef9c3);color:var(--badge-e-t,#854d0e);
                  border:1px solid var(--badge-e-t,#854d0e);border-radius:6px;
                  padding:8px 14px;font-size:13px">
        ⚠️ No hay datos de Encargados Millón para este cálculo. Re-ejecutá el cálculo completo desde el Dashboard.
      </div>`;
    document.getElementById('encm-body').innerHTML = '';
    document.getElementById('encm-summary').innerHTML = '';
    return;
  }

  // ── Resumen ───────────────────────────────────────────────────────
  const totalMonto = encargados.reduce((s, e) => s + (e.monto || 0), 0);
  const conEscalon  = encargados.filter(e => e.llega_escalon).length;
  const fechaStr    = data.fecha_calculo
    ? new Date(data.fecha_calculo).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  document.getElementById('encm-summary').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px">
      <div class="card" style="flex:1;min-width:120px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Sucursales</div>
        <div style="font-size:20px;font-weight:700">${encargados.length}</div>
      </div>
      <div class="card" style="flex:1;min-width:120px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Cobra escalón</div>
        <div style="font-size:20px;font-weight:700;color:var(--color-success)">${conEscalon}</div>
      </div>
      <div class="card" style="flex:1;min-width:140px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Total a pagar</div>
        <div style="font-size:20px;font-weight:700">$${totalMonto.toLocaleString('es-AR')}</div>
      </div>
      <div class="card" style="flex:1;min-width:150px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Último cálculo</div>
        <div style="font-size:12px;font-weight:600">${fechaStr}</div>
        <div style="font-size:11px;color:var(--color-muted)">${data.usuario || ''}</div>
      </div>
    </div>
  `;

  // ── Tabla ─────────────────────────────────────────────────────────
  let filtrados = encargados;

  function renderTabla(rows) {
    if (!rows.length) {
      document.getElementById('encm-body').innerHTML =
        `<p style="color:var(--color-muted);padding:20px">Sin resultados.</p>`;
      return;
    }
    document.getElementById('encm-body').innerHTML = `
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:left;padding:8px 10px;white-space:nowrap">Suc</th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:left;padding:8px 10px;white-space:nowrap">Sucursal</th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:center;padding:8px 10px;white-space:nowrap">Cat</th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:center;padding:8px 10px;white-space:nowrap" title="Venta efectivo / Objetivo primer escalón">Ratio efect.</th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:center;padding:8px 10px;white-space:nowrap" title="Escalón alcanzado de efectivo">Esc</th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:right;padding:8px 10px;white-space:nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(e => `
            <tr>
              <td style="padding:7px 10px;color:var(--color-muted);font-size:11px">${e.sucursal_id}</td>
              <td style="padding:7px 10px;font-weight:500">${e.sucursal_nombre}</td>
              <td style="padding:7px 10px;text-align:center">${catBadge(e.categoria)}</td>
              <td style="padding:7px 10px;text-align:center">${fmtRatio(e.ratio_efectivo)}</td>
              <td style="padding:7px 10px;text-align:center">${escalonBadge(e.escalon_efectivo, e.ratio_efectivo)}</td>
              <td style="padding:7px 10px;text-align:right;font-weight:700">${e.monto ? '$' + e.monto.toLocaleString('es-AR') : '<span style="color:var(--color-muted)">—</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  renderTabla(filtrados);

  // ── Filtro búsqueda ───────────────────────────────────────────────
  document.getElementById('encm-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    filtrados = q
      ? encargados.filter(r =>
          (r.sucursal_nombre || '').toLowerCase().includes(q) ||
          String(r.sucursal_id).includes(q))
      : encargados;
    renderTabla(filtrados);
  });

  // ── Exportar CSV ──────────────────────────────────────────────────
  document.getElementById('encm-export').addEventListener('click', () => {
    exportToCSV(
      filtrados.map(e => ({
        'Suc ID':       e.sucursal_id,
        'Sucursal':     e.sucursal_nombre,
        'Categoría':    e.categoria,
        'Ratio efect.': e.ratio_efectivo != null ? (e.ratio_efectivo * 100).toFixed(1) + '%' : '',
        'Escalón':      e.escalon_efectivo,
        'Total':        e.monto || 0,
      })),
      `ENCARGADOS_MILLON_${periodo}`
    );
    showToast('CSV exportado', 'success');
  });
}
