import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { exportToCSV } from '../components/exportExcel.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function catBadge(v) {
  const c = (v || 'C').toUpperCase();
  return `<span class="badge badge-${c.toLowerCase()}">${c}</span>`;
}

const MARCADOR_STYLE = {
  'SI':  { bg: 'var(--badge-d-bg)', t: 'var(--badge-d-t)', title: 'Escalón + participación' },
  '%':   { bg: 'var(--badge-b-bg)', t: 'var(--badge-b-t)', title: 'Solo participación' },
  '$$':  { bg: 'var(--badge-b-bg)', t: 'var(--badge-b-t)', title: 'Solo escalón (sin participación)' },
  'NO':  { bg: 'var(--sem-red)',    t: 'var(--sem-red-t)', title: 'No alcanza nada' },
};
function marcadorBadge(v) {
  const s = MARCADOR_STYLE[v];
  if (!s) return '<span style="color:var(--color-muted)">—</span>';
  return `<span class="badge" style="background:${s.bg};color:${s.t}" title="${s.title}">${v}</span>`;
}

function fmtRatio(v) {
  if (!v) return '<span style="color:var(--color-muted);font-size:11px">—</span>';
  const pct = (v * 100).toFixed(1) + '%';
  const color = v >= 1.0 ? 'var(--color-success)' : v >= 0.96 ? 'var(--badge-e-t)' : 'var(--color-danger)';
  return `<span style="color:${color};font-size:11px">${pct}</span>`;
}

function fmtInd(v) {
  if (v == null || v === -1) return '<span style="color:var(--color-muted);font-size:11px">—</span>';
  const pct = (v * 100).toFixed(1);
  const ok = v > -0.04;
  const color = ok ? 'var(--color-success)' : 'var(--color-danger)';
  const sign = v >= 0 ? '+' : '';
  return `<span style="color:${color};font-size:11px">${sign}${pct}%</span>`;
}

function tipoBadge(v) {
  return v === 'OPER_CON_EFECT'
    ? '<span class="badge badge-a">CON efectivo</span>'
    : '<span class="badge badge-c">SIN efectivo</span>';
}

function escalonBadge(escalon, ratio) {
  if (escalon === 3) return `<span class="badge badge-a">E3</span>`;
  if (escalon === 2) return `<span class="badge badge-b">E2</span>`;
  if (escalon === 1) {
    // ratio >= 1.0 → llegó al objetivo estrictamente (verde E1)
    // 0 < ratio < 1.0 → pasó solo por tolerancia del 4% (ámbar, muestra E1)
    // ratio == 0 → sin dato de ratio (período viejo sin migrar), mostrar E1 verde
    if (!ratio || ratio >= 1.0) return `<span class="badge badge-d">E1</span>`;
    return `<span class="badge badge-e">E1</span>`;
  }
  return `<span class="badge badge-c">E0</span>`;
}

// ── Render principal ──────────────────────────────────────────────────────────

export async function renderOperadores(container, periodo, tipo = 'all') {
  const tituloTipo = tipo === 'retail' ? 'Retail' : tipo === 'millon' ? 'Millón' : '';
  const titulo = tituloTipo ? `Operadores ${tituloTipo} — ${periodo}` : `Operadores — ${periodo}`;
  const csvNombre = tipo === 'retail' ? `COMISIONES_RETAIL_${periodo}`
                  : tipo === 'millon' ? `COMISIONES_MILLON_${periodo}`
                  : `COMISIONES_SUC_${periodo}`;

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">

      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="font-size:20px;font-weight:700;margin:0">${titulo}</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="op-search" type="text" placeholder="Sucursal…"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   background:var(--color-input);color:var(--color-text);font-size:13px;width:180px">
          <select id="op-filter-tipo"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   background:var(--color-input);color:var(--color-text);font-size:13px">
            <option value="">Todos</option>
            <option value="OPER_CON_EFECT">CON efectivo</option>
            <option value="OPER_SIN_EFECT">SIN efectivo</option>
          </select>
          <button id="btn-calcular" class="btn btn-primary">⟳ Calcular</button>
          <button id="btn-export" class="btn btn-secondary">⬇ CSV</button>
        </div>
      </div>

      <div id="op-summary" style="flex-shrink:0;display:flex;gap:12px;margin-bottom:10px"></div>
      <div id="op-info" style="flex-shrink:0;font-size:12px;color:var(--color-muted);margin-bottom:6px"></div>

      <div id="op-wrap" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">
        <p style="color:var(--color-muted);text-align:center;padding:40px">Cargando…</p>
      </div>

    </div>
  `;

  let allData = [];
  let currentGroups = [];
  const expandedSet = new Set();

  // ── Resumen KPIs ─────────────────────────────────────────────────────────────
  function renderSummary(groups) {
    const conEfect   = groups.filter(g => g.tiene_efectivo).length;
    const totalFull  = groups.reduce((s, g) => s + g.monto_full, 0);
    const totalPart  = groups.reduce((s, g) => s + g.monto_part, 0);
    const kpis = [
      { label: 'Sucursales',     value: groups.length },
      { label: 'CON efectivo',   value: conEfect },
      { label: 'Total Full $',   value: `$ ${fmtMoney(totalFull)}` },
      { label: 'Total Part $',   value: `$ ${fmtMoney(totalPart)}` },
    ];
    container.querySelector('#op-summary').innerHTML = kpis.map(k => `
      <div class="card" style="padding:10px 16px;min-width:120px;text-align:center">
        <div style="font-size:11px;color:var(--color-muted);margin-bottom:4px">${k.label}</div>
        <div style="font-size:18px;font-weight:700">${k.value}</div>
      </div>
    `).join('');
  }

  // ── Tabla plana por sucursal ──────────────────────────────────────────────────
  const MULT_MAP = { A: '×1.30', B: '×1.15', C: '×1.00' };

  function renderTabla(data) {
    const wrap = container.querySelector('#op-wrap');
    if (!data.length) {
      wrap.innerHTML = `<div class="card"><div class="card-body">
        <p style="color:var(--color-muted)">Sin datos. Usá <strong>Calcular</strong> para procesar el período.</p>
      </div></div>`;
      renderSummary([]);
      return;
    }

    // Una fila por sucursal (primer registro de cada una lleva los valores de sucursal)
    const seen = new Set();
    const groups = [];
    for (const r of data) {
      if (!seen.has(r.sucursal_id)) {
        seen.add(r.sucursal_id);
        groups.push({
          sucursal_id:      r.sucursal_id,
          sucursal_nombre:  r.sucursal_nombre ?? `Suc. ${r.sucursal_id}`,
          categoria:        r.categoria,
          tiene_efectivo:   r.tiene_efectivo,
          tipo_operador:    r.tipo_operador,
          escalon_consumo:  r.escalon_consumo ?? r.escalon ?? 0,
          escalon_efectivo: r.escalon_efectivo ?? 0,
          ratio_consumo:    +r.ratio_consumo   || 0,
          ratio_efectivo:   +r.ratio_efectivo  || 0,
          marcador:         r.marcador ?? null,
          indicador_g:      r.indicador_g  ?? -1,
          indicador_o:      r.indicador_o  ?? -1,
          indicador_r:      r.indicador_r  ?? -1,
          calc_consumo:     +r.calc_consumo  || 0,
          calc_efectivo:    +r.calc_efectivo || 0,
          // null = cálculo guardado con formato viejo (sin desglose); 0 = componente no aplicado
          comp_escalon:     r.comp_escalon   == null ? null : +r.comp_escalon,
          comp_particip:    r.comp_particip  == null ? null : +r.comp_particip,
          comp_ticket:      r.comp_ticket    == null ? null : +r.comp_ticket,
          comp_operacion:   r.comp_operacion == null ? null : +r.comp_operacion,
          monto_full:       +r.monto_full    || 0,
          monto_part:       +r.monto_part    || 0,
        });
      }
    }

    currentGroups = groups;
    renderSummary(groups);

    // Desglose de la composición del monto (fila expandible)
    const MULT_VAL = { A: 1.30, B: 1.15, C: 1.00 };
    function detalleHTML(g) {
      if (g.comp_escalon == null) {
        return `<div style="padding:12px 16px;font-size:12px;color:var(--badge-e-t)">
          ⚠ Este cálculo fue guardado con un formato anterior que no incluye el desglose por componente.
          Presioná <strong>⟳ Calcular</strong> para regenerarlo con el detalle.
        </div>`;
      }
      const mult = MULT_VAL[g.categoria] ?? 1.0;
      const ok   = '<span style="color:var(--color-success);font-weight:700">✓</span>';
      const no   = '<span style="color:var(--color-danger);font-weight:700">✗</span>';
      const gOk  = g.indicador_g > -0.04;
      const item = (label, monto, aplica, motivo) => `
        <tr>
          <td style="padding:3px 10px 3px 0;color:var(--color-muted)">${label}</td>
          <td style="padding:3px 10px;text-align:center">${aplica ? ok : no}</td>
          <td style="padding:3px 0;text-align:right;font-weight:600;${monto === 0 ? 'opacity:.45' : ''}">$ ${fmtMoney(monto)}</td>
          <td style="padding:3px 0 3px 14px;color:var(--color-muted);font-size:11px">${motivo}</td>
        </tr>`;

      const consumoRows = [
        item(`Escalón consumo`, g.comp_escalon, g.escalon_consumo >= 1,
             g.escalon_consumo >= 1 ? `llegó a E${g.escalon_consumo}` : 'no llegó a E1'),
        item(`Participación (G)`, g.comp_particip, gOk,
             gOk ? `G ${(g.indicador_g * 100).toFixed(1)}% &gt; −4%` : `G ${(g.indicador_g * 100).toFixed(1)}% ≤ −4%`),
        item(`Ticket promedio (O)`, g.comp_ticket, gOk && g.indicador_o > -0.04,
             !gOk ? 'bloqueado: requiere G' : g.indicador_o > -0.04 ? `O ${(g.indicador_o * 100).toFixed(1)}% &gt; −4%` : `O ${(g.indicador_o * 100).toFixed(1)}% ≤ −4%`),
        item(`Operaciones (R)`, g.comp_operacion, gOk && g.indicador_r > -0.04,
             !gOk ? 'bloqueado: requiere G' : g.indicador_r > -0.04 ? `R ${(g.indicador_r * 100).toFixed(1)}% &gt; −4%` : `R ${(g.indicador_r * 100).toFixed(1)}% ≤ −4%`),
      ].join('');

      const efectivoHTML = g.tiene_efectivo
        ? `<table style="width:auto;font-size:12px">
             ${item(`Escalón efectivo`, g.calc_efectivo, g.escalon_efectivo >= 1,
                    g.escalon_efectivo >= 1 ? `llegó a E${g.escalon_efectivo} (tabla Préstamos)` : 'no llegó a E1')}
           </table>`
        : `<div style="font-size:12px;color:var(--color-muted)">Sucursal SIN efectivo — no aplica.</div>`;

      return `
        <div style="display:flex;gap:36px;flex-wrap:wrap;padding:12px 16px 14px 34px;background:var(--color-bg)">
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--color-muted);text-transform:uppercase;margin-bottom:6px">Consumo (montos base cat. C)</div>
            <table style="width:auto;font-size:12px">
              ${consumoRows}
              <tr style="border-top:1px solid var(--color-border)">
                <td style="padding:4px 10px 0 0;font-weight:700">Base consumo</td><td></td>
                <td style="padding:4px 0 0;text-align:right;font-weight:700">$ ${fmtMoney(g.calc_consumo)}</td><td></td>
              </tr>
            </table>
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--color-muted);text-transform:uppercase;margin-bottom:6px">Efectivo (montos base cat. C)</div>
            ${efectivoHTML}
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:var(--color-muted);text-transform:uppercase;margin-bottom:6px">Monto final</div>
            <div style="font-size:12px;line-height:1.9">
              ($ ${fmtMoney(g.calc_consumo)} + $ ${fmtMoney(g.calc_efectivo)}) × <strong>${mult.toFixed(2)}</strong> (cat. ${g.categoria})
              = $ ${fmtMoney((g.calc_consumo + g.calc_efectivo) * mult)}<br>
              <span style="color:var(--color-muted)">redondeado a miles →</span>
              <strong>$ ${fmtMoney(g.monto_full)}</strong>
              <span style="color:var(--color-muted);font-size:11px">(part-time: $ ${fmtMoney(g.monto_part)})</span>
            </div>
          </div>
        </div>`;
    }

    const rows = groups.map(g => {
      const zero = 'opacity:.45';
      const multStr = MULT_MAP[g.categoria] ?? '×1.00';
      const expanded = expandedSet.has(g.sucursal_id);
      return `
        <tr class="op-row" data-suc-id="${g.sucursal_id}" style="cursor:pointer" title="Click para ver el desglose del monto">
          <td style="padding:10px 14px;font-weight:600">
            <span class="op-arrow" style="display:inline-block;font-size:9px;color:var(--color-muted);margin-right:6px;transition:transform 150ms;transform:rotate(${expanded ? 90 : 0}deg)">▶</span><span style="font-weight:700;color:var(--color-muted);font-size:12px;margin-right:4px">#${g.sucursal_id}</span>
            ${g.sucursal_nombre}
            ${catBadge(g.categoria)}
            ${tipoBadge(g.tipo_operador)}
          </td>
          <td style="padding:10px 6px;text-align:center">${marcadorBadge(g.marcador)}</td>
          <td style="padding:10px 6px;text-align:center">${escalonBadge(g.escalon_consumo, g.ratio_consumo)}</td>
          <td style="padding:10px 6px;text-align:center">${escalonBadge(g.escalon_efectivo, g.ratio_efectivo)}</td>
          <td style="padding:10px 6px;text-align:right;border-left:1px solid var(--color-border)">${fmtRatio(g.ratio_consumo)}</td>
          <td style="padding:10px 6px;text-align:right">${fmtInd(g.indicador_g)}</td>
          <td style="padding:10px 6px;text-align:right">${fmtInd(g.indicador_o)}</td>
          <td style="padding:10px 6px;text-align:right">${fmtInd(g.indicador_r)}</td>
          <td style="padding:10px 6px;text-align:right;font-size:11px;border-left:1px solid var(--color-border);${g.calc_consumo === 0 ? zero : ''}">${fmtMoney(g.calc_consumo)}</td>
          <td style="padding:10px 6px;text-align:right;font-size:11px;${g.calc_efectivo === 0 ? zero : ''}">${fmtMoney(g.calc_efectivo)}</td>
          <td style="padding:10px 6px;text-align:right;font-size:11px;font-weight:600;border-left:1px solid var(--color-border)">${fmtMoney(g.calc_consumo + g.calc_efectivo)}</td>
          <td style="padding:10px 6px;text-align:center;font-size:11px;font-weight:600;color:var(--color-muted)">${multStr}</td>
          <td style="padding:10px 6px;text-align:right;font-weight:700">${fmtMoney(g.monto_full)}</td>
          <td style="padding:10px 14px 10px 6px;text-align:right;font-size:11px;color:var(--color-muted)">${fmtMoney(g.monto_part)}</td>
        </tr>
        <tr class="op-detail" data-suc-id="${g.sucursal_id}" style="display:${expanded ? '' : 'none'}">
          <td colspan="14" style="padding:0;border-bottom:2px solid var(--color-border)">${detalleHTML(g)}</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table style="width:100%">
          <colgroup>
            <col><col style="width:52px"><col style="width:68px"><col style="width:68px">
            <col style="width:58px"><col style="width:58px"><col style="width:58px"><col style="width:58px">
            <col style="width:90px"><col style="width:90px"><col style="width:90px">
            <col style="width:52px"><col style="width:100px"><col style="width:100px">
          </colgroup>
          <thead style="position:sticky;top:0;z-index:1;background:var(--color-surface)">
            <tr>
              <th style="padding:8px 14px;text-align:left">Sucursal</th>
              <th style="padding:8px 6px;text-align:center">Marca</th>
              <th style="padding:8px 6px;text-align:center">Cons.</th>
              <th style="padding:8px 6px;text-align:center">Ef.</th>
              <th style="padding:8px 6px;text-align:right;border-left:1px solid var(--color-border);cursor:help" title="Ventas vs objetivo del escalón (≥96% pasa por tolerancia, ≥100% estricto)">Vta%</th>
              <th style="padding:8px 6px;text-align:right;cursor:help" title="G — Participación de mercado: VTA/VTATOT real vs objetivo. Si &gt; −4% desbloquea el componente de participación (y habilita O y R).">G</th>
              <th style="padding:8px 6px;text-align:right;cursor:help" title="O — Ticket promedio / Crédito promedio: real vs objetivo. Requiere G &gt; −4%.">O</th>
              <th style="padding:8px 6px;text-align:right;cursor:help" title="R — Operaciones: cantidad real vs objetivo. Requiere G &gt; −4%.">R</th>
              <th style="padding:8px 6px;text-align:right;border-left:1px solid var(--color-border)">Base Cons $</th>
              <th style="padding:8px 6px;text-align:right">Base Ef $</th>
              <th style="padding:8px 6px;text-align:right;border-left:1px solid var(--color-border)">Subtotal $</th>
              <th style="padding:8px 6px;text-align:center">Cat.</th>
              <th style="padding:8px 6px;text-align:right">Full $</th>
              <th style="padding:8px 14px 8px 6px;text-align:right">Part $</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;

    wrap.querySelectorAll('.op-row').forEach(tr => {
      tr.addEventListener('click', () => {
        const sucId  = parseInt(tr.dataset.sucId, 10);
        const detail = wrap.querySelector(`.op-detail[data-suc-id="${sucId}"]`);
        const arrow  = tr.querySelector('.op-arrow');
        const open   = detail.style.display !== 'none';
        detail.style.display  = open ? 'none' : '';
        arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
        if (open) expandedSet.delete(sucId); else expandedSet.add(sucId);
      });
    });
  }

  // ── Filtros ───────────────────────────────────────────────────────────────────
  function filtrar() {
    const q          = container.querySelector('#op-search').value.toLowerCase();
    const tipoEfect  = container.querySelector('#op-filter-tipo').value;

    const filt = allData.filter(r => {
      const matchSegmento = tipo === 'retail' ? r.sucursal_id < 100
                          : tipo === 'millon' ? r.sucursal_id >= 100
                          : true;
      const matchQ = !q
        || (r.sucursal_nombre || '').toLowerCase().includes(q)
        || String(r.sucursal_id).includes(q);
      return matchSegmento && matchQ && (!tipoEfect || r.tipo_operador === tipoEfect);
    });

    renderTabla(filt);
    const base  = tipo === 'all' ? allData : allData.filter(r => tipo === 'retail' ? r.sucursal_id < 100 : r.sucursal_id >= 100);
    const total = new Set(base.map(r => r.sucursal_id)).size;
    const shown = new Set(filt.map(r => r.sucursal_id)).size;
    container.querySelector('#op-info').textContent = `Mostrando ${shown} de ${total} sucursales`;
  }

  // ── Eventos ───────────────────────────────────────────────────────────────────
  container.querySelector('#op-search').addEventListener('input', filtrar);
  container.querySelector('#op-filter-tipo').addEventListener('change', filtrar);

  container.querySelector('#btn-export').addEventListener('click', () => {
    if (!currentGroups.length) { showToast('Sin datos para exportar', 'error'); return; }
    exportToCSV(currentGroups, csvNombre);
  });

  container.querySelector('#btn-calcular').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-calcular');
    btn.disabled = true;
    btn.textContent = 'Calculando…';
    try {
      const res = await api.post('/operadores/calcular', { periodo });
      allData = res.resultado || [];
      container.querySelector('#op-info').textContent =
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

  // ── Carga inicial ─────────────────────────────────────────────────────────
  try {
    const res = await api.get(`/operadores?periodo=${periodo}`);
    allData = res.resultado || [];
    container.querySelector('#op-info').textContent =
      `Último cálculo: ${new Date(res.fecha_calculo).toLocaleString('es-AR')} — ${allData.length} operadores`;
    filtrar();
  } catch {
    renderSummary([]);
    container.querySelector('#op-wrap').innerHTML = `
      <div class="card"><div class="card-body">
        <p style="color:var(--color-muted)">Sin cálculo guardado para este período.<br>
        Presioná <strong>⟳ Calcular</strong> para procesar.</p>
      </div></div>
    `;
    container.querySelector('#op-info').textContent = 'Sin datos para este período';
  }
}
