import { api, isSupervisorReadonly } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { exportToCSV } from '../components/exportExcel.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(v) {
  if (v == null || v === 0) return '<span style="color:var(--color-muted)">—</span>';
  return '$' + Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function fmtNum(v) {
  return Number(v || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

function fmtVend(v) {
  // CantidadVendedores es decimal: los part time pesan 0,5.
  return Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function escBadge(esc) {
  if (esc === 3) return '<span class="badge badge-a">E3</span>';
  if (esc === 2) return '<span class="badge badge-b">E2</span>';
  if (esc === 1) return '<span class="badge badge-d">E1</span>';
  return '<span class="badge badge-c">E0</span>';
}

function jornadaBadge(v) {
  return v === 'part'
    ? '<span class="badge badge-e" title="Part time: cobra la mitad del importe">PT</span>'
    : '<span class="badge badge-c" title="Full time">FT</span>';
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Render principal ──────────────────────────────────────────────────────────

export async function renderVendedores(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">

      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="font-size:20px;font-weight:700;margin:0">🛍️ Vendedores — ${esc(periodo)}</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="vend-search" type="text" placeholder="Sucursal o vendedor…"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   font-size:13px;background:var(--color-surface);color:var(--color-text);width:200px">
          <button id="vend-export" class="btn btn-outline" style="font-size:12px;padding:6px 12px">↓ CSV</button>
          <button id="vend-vigencias" class="btn btn-primary"
            style="font-size:12px;padding:6px 12px${isSupervisorReadonly() ? ';display:none' : ''}">💰 Vigencias</button>
        </div>
      </div>

      <div id="vend-importes" style="flex-shrink:0;margin-bottom:10px"></div>
      <div id="vend-summary"  style="flex-shrink:0;margin-bottom:10px"></div>

      <div id="vend-body" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">
        <div style="text-align:center;padding:60px;color:var(--color-muted)">
          <div style="font-size:32px;margin-bottom:12px">⏳</div>
          <p>Cargando…</p>
        </div>
      </div>

    </div>
  `;

  let data;
  try {
    data = await api.get(`/vendedores?periodo=${periodo}`);
  } catch (err) {
    const body = document.getElementById('vend-body');
    body.innerHTML = '<div style="text-align:center;padding:60px;color:var(--color-danger)"></div>';
    body.firstElementChild.textContent = `No se pudo cargar: ${err.message}`;
    return;
  }

  const sucursales = data.sucursales || [];

  // ── Card de importes vigentes ─────────────────────────────────────
  const vig = data.vigencia;
  document.getElementById('vend-importes').innerHTML = vig
    ? `<div class="card" style="padding:10px 14px;display:flex;gap:24px;align-items:center;flex-wrap:wrap">
         <div>
           <div style="font-size:11px;color:var(--color-muted)">Importes vigentes</div>
           <div style="font-size:12px;color:var(--color-muted)">desde ${vig.anio}-${String(vig.mes).padStart(2, '0')}</div>
         </div>
         <div><div style="font-size:11px;color:var(--color-muted)">1er escalón</div>
              <div style="font-size:16px;font-weight:700">$${fmtNum(vig.primer)}</div></div>
         <div><div style="font-size:11px;color:var(--color-muted)">2do escalón</div>
              <div style="font-size:16px;font-weight:700">$${fmtNum(vig.segundo)}</div></div>
         <div><div style="font-size:11px;color:var(--color-muted)">3er escalón</div>
              <div style="font-size:16px;font-weight:700">$${fmtNum(vig.tercer)}</div></div>
         <div style="font-size:11px;color:var(--color-muted);max-width:280px">
           Part time cobra la mitad. El cálculo lo corre el job SQL de INDO, no esta página.
         </div>
       </div>`
    : `<div class="card" style="padding:10px 14px;font-size:13px;color:var(--badge-e-t,#854d0e);
              background:var(--badge-e-bg,#fef9c3);border:1px solid var(--badge-e-t,#854d0e)">
         ⚠️ No hay ninguna vigencia de importes cargada para este período: el cálculo resolvería $0.
       </div>`;

  // ── Estado vacío ──────────────────────────────────────────────────
  if (!sucursales.length) {
    document.getElementById('vend-summary').innerHTML = '';
    document.getElementById('vend-body').innerHTML = `
      <div style="text-align:center;padding:60px;color:var(--color-muted)">
        <div style="font-size:32px;margin-bottom:12px">📭</div>
        <p style="font-size:14px;font-weight:600">Sin comisiones de vendedores para ${esc(periodo)}</p>
        <p style="font-size:12px;max-width:460px;margin:8px auto">
          El cálculo de vendedores lo corre el job SQL de INDO (<code>SP_ComisionesINDO</code>), no el dashboard.
          Si el período ya cerró y no aparece, el job todavía no lo procesó.
        </p>
      </div>`;
    return;
  }

  // ── Resumen ───────────────────────────────────────────────────────
  const todos      = sucursales.flatMap(s => s.vendedores);
  const cobran     = todos.filter(v => v.comision > 0).length;
  const desfasados = todos.filter(v => v.desfasado).length;

  document.getElementById('vend-summary').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <div class="card" style="flex:1;min-width:120px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Sucursales</div>
        <div style="font-size:20px;font-weight:700">${data.totales.sucursales}</div>
      </div>
      <div class="card" style="flex:1;min-width:120px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Vendedores</div>
        <div style="font-size:20px;font-weight:700">${data.totales.vendedores}</div>
      </div>
      <div class="card" style="flex:1;min-width:120px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Cobran comisión</div>
        <div style="font-size:20px;font-weight:700;color:var(--color-success)">${cobran}</div>
      </div>
      <div class="card" style="flex:1;min-width:140px;padding:10px 14px">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">Total a pagar</div>
        <div style="font-size:20px;font-weight:700">$${fmtNum(data.totales.comision)}</div>
      </div>
      ${desfasados ? `
      <div class="card" style="flex:1;min-width:180px;padding:10px 14px;border-color:var(--badge-e-t,#854d0e)">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">⚠️ Desfasados</div>
        <div style="font-size:20px;font-weight:700;color:var(--badge-e-t,#854d0e)">${desfasados}</div>
        <div style="font-size:10px;color:var(--color-muted)">importes editados sin reprocesar</div>
      </div>` : ''}
    </div>`;

  // ── Tabla por sucursal, expandible ────────────────────────────────
  const abiertas = new Set();
  let filtradas = sucursales;

  function detalleHTML(s) {
    return `
      <div style="padding:8px 12px 12px 36px;background:var(--color-bg)">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="color:var(--color-muted)">
              <th style="text-align:left;padding:4px 8px">Legajo</th>
              <th style="text-align:left;padding:4px 8px">Nombre</th>
              <th style="text-align:center;padding:4px 8px">Jorn.</th>
              <th style="text-align:right;padding:4px 8px">Venta real</th>
              <th style="text-align:center;padding:4px 8px">Días</th>
              <th style="text-align:right;padding:4px 8px" title="Venta ajustada por días trabajados">Vta calculada</th>
              <th style="text-align:right;padding:4px 8px" title="Ajuste por licencias">Proporcional</th>
              <th style="text-align:center;padding:4px 8px">Lic.</th>
              <th style="text-align:center;padding:4px 8px">¿Comisiona?</th>
              <th style="text-align:center;padding:4px 8px">Esc.</th>
              <th style="text-align:right;padding:4px 8px">Comisión</th>
            </tr>
          </thead>
          <tbody>
            ${s.vendedores.map(v => `
              <tr>
                <td style="padding:4px 8px;color:var(--color-muted)">${esc(v.legajo)}</td>
                <td style="padding:4px 8px;font-weight:500">${esc(v.nombre)}${
                  v.jornada_cambio ? ' <span style="font-size:10px;color:var(--color-muted)" title="La jornada actual del legajo difiere de la usada en el cálculo">(jornada cambió)</span>' : ''}</td>
                <td style="padding:4px 8px;text-align:center">${jornadaBadge(v.jornada)}</td>
                <td style="padding:4px 8px;text-align:right">$${fmtNum(v.venta_real)}</td>
                <td style="padding:4px 8px;text-align:center">${v.dias_venta}</td>
                <td style="padding:4px 8px;text-align:right">$${fmtNum(v.venta_calculada)}</td>
                <td style="padding:4px 8px;text-align:right">${v.vta_proporcional ? '$' + fmtNum(v.vta_proporcional) : '—'}</td>
                <td style="padding:4px 8px;text-align:center">${v.dias_licencia || '—'}</td>
                <td style="padding:4px 8px;text-align:center">${v.comisiona ? '✅' : '—'}</td>
                <td style="padding:4px 8px;text-align:center">${escBadge(v.escalon)}</td>
                <td style="padding:4px 8px;text-align:right;font-weight:600">${fmtMoney(v.comision)}${
                  v.desfasado ? ' <span title="La comisión guardada no coincide con el importe del escalón alcanzado: se editaron importes y el período no se reprocesó">⚠️</span>' : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function renderTabla(rows) {
    const body = document.getElementById('vend-body');
    if (!rows.length) {
      body.innerHTML = '<p style="color:var(--color-muted);padding:20px">Sin resultados.</p>';
      return;
    }
    const th = 'position:sticky;top:0;z-index:1;background:var(--color-surface);padding:8px 10px;white-space:nowrap';
    body.innerHTML = `
      <table class="data-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr>
            <th style="${th};text-align:left">Suc</th>
            <th style="${th};text-align:left">Sucursal</th>
            <th style="${th};text-align:center" title="Full time = 1, part time = 0,5 (solo con más de 5 días de venta)">Vend.</th>
            <th style="${th};text-align:right">1er esc.</th>
            <th style="${th};text-align:right">2do esc.</th>
            <th style="${th};text-align:right">3er esc.</th>
            <th style="${th};text-align:right">Total $</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(s => {
            const open = abiertas.has(s.sucursal_id);
            return `
            <tr class="vend-row" data-suc="${s.sucursal_id}" style="cursor:pointer">
              <td style="padding:7px 10px;color:var(--color-muted);font-size:11px">
                <span style="display:inline-block;font-size:9px;margin-right:6px;transition:transform 150ms;transform:rotate(${open ? 90 : 0}deg)">▶</span>${s.sucursal_id}
              </td>
              <td style="padding:7px 10px;font-weight:500">${esc(s.sucursal_nombre)}</td>
              <td style="padding:7px 10px;text-align:center">${fmtVend(s.cant_vendedores)}</td>
              <td style="padding:7px 10px;text-align:right;font-size:12px">$${fmtNum(s.primer_escalon)}</td>
              <td style="padding:7px 10px;text-align:right;font-size:12px">$${fmtNum(s.segundo_escalon)}</td>
              <td style="padding:7px 10px;text-align:right;font-size:12px">$${fmtNum(s.tercer_escalon)}</td>
              <td style="padding:7px 10px;text-align:right;font-weight:700">${fmtMoney(s.total_comision)}</td>
            </tr>
            <tr class="vend-detail" data-suc="${s.sucursal_id}" style="display:${open ? '' : 'none'}">
              <td colspan="7" style="padding:0;border-bottom:2px solid var(--color-border)">${detalleHTML(s)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    body.querySelectorAll('.vend-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const id = Number(tr.dataset.suc);
        if (abiertas.has(id)) abiertas.delete(id); else abiertas.add(id);
        renderTabla(rows);
      });
    });
  }

  renderTabla(filtradas);

  // ── Filtro ────────────────────────────────────────────────────────
  document.getElementById('vend-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      filtradas = sucursales;
    } else {
      filtradas = sucursales
        .map(s => {
          const matchSuc = (s.sucursal_nombre || '').toLowerCase().includes(q) || String(s.sucursal_id).includes(q);
          if (matchSuc) return s;
          const vend = s.vendedores.filter(v =>
            v.nombre.toLowerCase().includes(q) || String(v.legajo).includes(q));
          return vend.length ? { ...s, vendedores: vend } : null;
        })
        .filter(Boolean);
    }
    renderTabla(filtradas);
  });

  // ── CSV: una fila por vendedor ────────────────────────────────────
  document.getElementById('vend-export').addEventListener('click', () => {
    const filas = filtradas.flatMap(s => s.vendedores.map(v => ({
      'Suc ID': s.sucursal_id,
      'Sucursal': s.sucursal_nombre,
      'Legajo': v.legajo,
      'Nombre': v.nombre,
      'Jornada': v.jornada === 'part' ? 'Part Time' : 'Full Time',
      'Venta real': Math.round(v.venta_real),
      'Días venta': v.dias_venta,
      'Venta calculada': Math.round(v.venta_calculada),
      'Proporcional': Math.round(v.vta_proporcional),
      'Días licencia': v.dias_licencia,
      '1er escalón': Math.round(s.primer_escalon),
      '2do escalón': Math.round(s.segundo_escalon),
      '3er escalón': Math.round(s.tercer_escalon),
      'Escalón alcanzado': v.escalon,
      'Comisión': Math.round(v.comision),
      'Desfasado': v.desfasado ? 'SI' : '',
    })));
    if (!filas.length) { showToast('Nada para exportar', 'error'); return; }
    exportToCSV(filas, `VENDEDORES_${periodo}`);
    showToast('CSV exportado', 'success');
  });
}
