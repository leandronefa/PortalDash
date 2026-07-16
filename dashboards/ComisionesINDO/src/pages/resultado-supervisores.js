import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { exportToCSV } from '../components/exportExcel.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(v) {
  if (v == null || v === 0) return '<span style="color:var(--color-muted)">—</span>';
  return '$' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Render principal ──────────────────────────────────────────────────────────

export async function renderResultadoSupervisores(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">

      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="font-size:20px;font-weight:700;margin:0">👤 Supervisores — ${periodo}</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="rsup-search" type="text" placeholder="Supervisor…"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   font-size:13px;background:var(--color-surface);color:var(--color-text);width:180px">
          <button id="rsup-export" class="btn btn-outline" style="font-size:12px;padding:6px 12px">↓ CSV</button>
        </div>
      </div>

      <div id="rsup-summary" style="flex-shrink:0;margin-bottom:10px"></div>
      <div id="rsup-alert"   style="flex-shrink:0;margin-bottom:8px"></div>

      <div id="rsup-body" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">
        <div style="text-align:center;padding:60px;color:var(--color-muted)">
          <div style="font-size:32px;margin-bottom:12px">⏳</div>
          <p>Cargando…</p>
        </div>
      </div>

    </div>
  `;

  let data;
  try {
    data = await api.get(`/calculo/supervisores?periodo=${periodo}`);
  } catch {
    document.getElementById('rsup-body').innerHTML = `
      <div style="text-align:center;padding:60px;color:var(--color-muted)">
        <div style="font-size:32px;margin-bottom:12px">📭</div>
        <p style="font-size:14px;font-weight:600">Sin cálculo guardado para ${periodo}</p>
        <p style="font-size:12px">Ejecutá el cálculo completo desde el Dashboard.</p>
      </div>`;
    return;
  }

  const supervisores = data.resultado || [];

  if (!supervisores.length) {
    document.getElementById('rsup-alert').innerHTML = `
      <div style="background:var(--badge-e-bg,#fef9c3);color:var(--badge-e-t,#854d0e);
                  border:1px solid var(--badge-e-t,#854d0e);border-radius:6px;
                  padding:8px 14px;font-size:13px">
        ⚠️ No hay datos de Supervisores para este cálculo. Re-ejecutá el cálculo completo desde el Dashboard.
      </div>`;
    document.getElementById('rsup-body').innerHTML = '';
    document.getElementById('rsup-summary').innerHTML = '';
    return;
  }

  // Formato viejo (reglas < 2026-07-16): las filas retail no traen llega_particip.
  const formatoViejo = supervisores.some(s =>
    (s.sucursales || []).some(suc => suc.tipo === 'retail' && suc.llega_particip === undefined));
  if (formatoViejo) {
    document.getElementById('rsup-alert').innerHTML = `
      <div style="background:var(--badge-e-bg,#fef9c3);color:var(--badge-e-t,#854d0e);
                  border:1px solid var(--badge-e-t,#854d0e);border-radius:6px;
                  padding:8px 14px;font-size:13px">
        ⚠️ Este cálculo es anterior a las reglas de participación (2026-07-16). Re-ejecutá el cálculo del período desde la página Total para ver pesos/participación y los montos vigentes.
      </div>`;
  }

  // ── Resumen ───────────────────────────────────────────────────────
  const totalMonto = supervisores.reduce((s, e) => s + (e.monto || 0), 0);
  const fechaStr    = data.fecha_calculo
    ? new Date(data.fecha_calculo).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
    : '—';

  document.getElementById('rsup-summary').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px">
      <div class="card" style="flex:1;min-width:120px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Supervisores</div>
        <div style="font-size:20px;font-weight:700">${supervisores.length}</div>
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
  let filtrados = supervisores;
  let expandido = null;

  function renderTabla(rows) {
    if (!rows.length) {
      document.getElementById('rsup-body').innerHTML =
        `<p style="color:var(--color-muted);padding:20px">Sin resultados.</p>`;
      return;
    }
    document.getElementById('rsup-body').innerHTML = `
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:left;padding:8px 10px;white-space:nowrap"></th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:left;padding:8px 10px;white-space:nowrap">Supervisor</th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:center;padding:8px 10px;white-space:nowrap">Sucursales</th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:right;padding:8px 10px;white-space:nowrap" title="Sucursales Retail asignadas que llegaron por consumo: monto ABM por categoría, sin factor">$ por Sucursales</th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:right;padding:8px 10px;white-space:nowrap" title="Plazas Retail: suma de la plaza × 0,5 · Plazas Millón: monto fijo ABM sin factor">$ por Plaza</th>
            <th style="position:sticky;top:0;z-index:1;background:var(--color-surface);text-align:right;padding:8px 10px;white-space:nowrap">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(s => `
            <tr class="rsup-row" data-id="${s.id}" style="cursor:pointer">
              <td style="padding:7px 10px;color:var(--color-muted);font-size:11px">${expandido === s.id ? '▼' : '▶'}</td>
              <td style="padding:7px 10px;font-weight:500">${s.nombre}</td>
              <td style="padding:7px 10px;text-align:center">${s.sucursales?.length ?? 0}</td>
              <td style="padding:7px 10px;text-align:right">${fmtMoney(s.total_por_sucursales)}</td>
              <td style="padding:7px 10px;text-align:right">${fmtMoney(s.total_por_plaza)}</td>
              <td style="padding:7px 10px;text-align:right;font-weight:700">${fmtMoney(s.monto)}</td>
            </tr>
            ${expandido === s.id ? `
              <tr>
                <td colspan="6" style="padding:0 10px 10px 30px;background:var(--color-surface-2,rgba(127,127,127,.06))">
                  <div style="font-size:11px;font-weight:600;color:var(--color-muted);margin:8px 0 4px">Plazas (provincia) — Retail: si TODAS llegan a PARTICIPACIÓN, plus = suma pagada de la plaza × factor (0,5) · Millón: si TODAS llegaron por efectivo, monto fijo del ABM (sin factor, uno por plaza)</div>
                  <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px">
                    <thead>
                      <tr>
                        <th style="text-align:left;padding:4px 8px;color:var(--color-muted)">Provincia</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)">Suc Retail</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="TODAS las Retail de la plaza llegan a PARTICIPACIÓN (sin importar pesos)">¿Cumple?</th>
                        <th style="text-align:right;padding:4px 8px;color:var(--color-muted)" title="Lo pagado por las sucursales Retail de la plaza (va al total por Sucursales)">$ Sucursales</th>
                        <th style="text-align:right;padding:4px 8px;color:var(--color-muted)">$ Plus (×0,5)</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted);border-left:1px solid var(--color-border)">Suc Millón</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)">¿Cumple?</th>
                        <th style="text-align:right;padding:4px 8px;color:var(--color-muted)">$ Plaza Millón</th>
                        <th style="text-align:right;padding:4px 8px;color:var(--color-muted);border-left:1px solid var(--color-border)" title="Plus Retail + $ Plaza Millón (los premios de plaza)">Total plaza</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${(() => {
                        const porProv = {};
                        for (const p of (s.plazas || [])) {
                          const g = (porProv[p.provincia] ??= {});
                          g[p.tipo === 'millon' ? 'millon' : 'retail'] = p;
                        }
                        const dash = '<span style="color:var(--color-muted)">—</span>';
                        return Object.entries(porProv).map(([prov, g]) => {
                          const totalPlaza = (g.retail?.monto || 0) + (g.millon?.monto || 0);
                          return `
                          <tr>
                            <td style="padding:3px 8px">${prov}</td>
                            <td style="padding:3px 8px;text-align:center">${g.retail ? g.retail.cant_sucursales : dash}</td>
                            <td style="padding:3px 8px;text-align:center">${g.retail ? (g.retail.cumplida ? '✔' : '✘') : dash}</td>
                            <td style="padding:3px 8px;text-align:right">${g.retail ? fmtMoney(g.retail.suma_sucursales) : dash}</td>
                            <td style="padding:3px 8px;text-align:right">${g.retail ? fmtMoney(g.retail.monto) : dash}</td>
                            <td style="padding:3px 8px;text-align:center;border-left:1px solid var(--color-border)">${g.millon ? g.millon.cant_sucursales : dash}</td>
                            <td style="padding:3px 8px;text-align:center">${g.millon ? (g.millon.cumplida ? '✔' : '✘') : dash}</td>
                            <td style="padding:3px 8px;text-align:right">${g.millon ? fmtMoney(g.millon.monto) : dash}</td>
                            <td style="padding:3px 8px;text-align:right;font-weight:700;border-left:1px solid var(--color-border)">${fmtMoney(totalPlaza)}</td>
                          </tr>`;
                        }).join('');
                      })()}
                    </tbody>
                  </table>
                  <div style="font-size:11px;font-weight:600;color:var(--color-muted);margin:8px 0 4px">Sucursales — Retail paga por consumo: completo con pesos+participación, mitad con pesos sin participación, nada sin pesos · Millón no paga por sucursal, solo cuenta para su plaza (efectivo)</div>
                  <table style="width:100%;border-collapse:collapse;font-size:12px">
                    <thead>
                      <tr>
                        <th style="text-align:left;padding:4px 8px;color:var(--color-muted)">Suc</th>
                        <th style="text-align:left;padding:4px 8px;color:var(--color-muted)">Sucursal</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)">Tipo</th>
                        <th style="text-align:left;padding:4px 8px;color:var(--color-muted)">Provincia</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)">Cat</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="Retail: escalón consumo · Millón: escalón efectivo">Esc</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="Retail: llegó a los pesos (escalón consumo ≥ 1) · Millón: llegó por efectivo">¿Pesos?</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="Indicador G vs objetivo de participación (tolerancia 4%) — solo Retail">Particip.</th>
                        <th style="text-align:center;padding:4px 8px;color:var(--color-muted)" title="Completo (pesos+particip) · Mitad (pesos sin particip) · — (sin pesos)">Pago</th>
                        <th style="text-align:right;padding:4px 8px;color:var(--color-muted)">$ Sucursal</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${(s.sucursales || []).map(suc => {
                        const esRetail = suc.tipo === 'retail';
                        const dash = '<span style="color:var(--color-muted)">—</span>';
                        const particip = esRetail && suc.llega_particip !== undefined
                          ? `${suc.llega_particip ? '✔' : '✘'} <span style="color:var(--color-muted)">(${suc.indicador_g != null ? (suc.indicador_g * 100).toFixed(1) + '%' : 's/obj'})</span>`
                          : dash;
                        const pagoLbl = { completo: 'Completo', mitad: 'Mitad', nada: dash }[suc.pago]
                          ?? (esRetail ? dash : '<span style="color:var(--color-muted)" title="Millón no paga por sucursal">n/a</span>');
                        return `
                        <tr>
                          <td style="padding:3px 8px;color:var(--color-muted)">${suc.sucursal_id}</td>
                          <td style="padding:3px 8px">${suc.sucursal_nombre}</td>
                          <td style="padding:3px 8px;text-align:center">${suc.tipo === 'millon' ? 'Millón' : (esRetail ? 'Retail' : '—')}</td>
                          <td style="padding:3px 8px">${suc.provincia ?? '—'}</td>
                          <td style="padding:3px 8px;text-align:center">${suc.categoria}</td>
                          <td style="padding:3px 8px;text-align:center">${suc.escalon ?? '—'}</td>
                          <td style="padding:3px 8px;text-align:center">${(esRetail ? (suc.llega_pesos ?? suc.llego) : suc.llego) ? '✔' : '✘'}</td>
                          <td style="padding:3px 8px;text-align:center">${particip}</td>
                          <td style="padding:3px 8px;text-align:center">${pagoLbl}</td>
                          <td style="padding:3px 8px;text-align:right">${suc.tipo === 'millon' ? '<span style="color:var(--color-muted)" title="Millón no paga por sucursal">n/a</span>' : fmtMoney(suc.monto_por_suc)}</td>
                        </tr>`;
                      }).join('')}
                    </tbody>
                  </table>
                </td>
              </tr>
            ` : ''}
          `).join('')}
        </tbody>
      </table>
    `;

    document.querySelectorAll('.rsup-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = parseInt(tr.dataset.id, 10);
        expandido = expandido === id ? null : id;
        renderTabla(filtrados);
      });
    });
  }

  renderTabla(filtrados);

  // ── Filtro búsqueda ───────────────────────────────────────────────
  document.getElementById('rsup-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    filtrados = q
      ? supervisores.filter(r => (r.nombre || '').toLowerCase().includes(q))
      : supervisores;
    renderTabla(filtrados);
  });

  // ── Exportar CSV ──────────────────────────────────────────────────
  document.getElementById('rsup-export').addEventListener('click', () => {
    exportToCSV(
      filtrados.map(s => ({
        'Supervisor':         s.nombre,
        'Sucursales':         s.sucursales?.length ?? 0,
        '$ por Sucursales':   s.total_por_sucursales || 0,
        '$ por Plaza':        s.total_por_plaza || 0,
        'Total':              s.monto || 0,
      })),
      `SUPERVISORES_${periodo}`
    );
    showToast('CSV exportado', 'success');
  });
}
