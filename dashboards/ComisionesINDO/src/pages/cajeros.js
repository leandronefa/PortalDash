import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { exportToCSV } from '../components/exportExcel.js';

function fmtMoney(v) {
  if (!v && v !== 0) return '—';
  return Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function semCell(v) {
  const label = v === 'verde' ? '✅' : v === 'amarillo' ? '⚠️' : '❌';
  return `<span class="sem-${v}" title="${v}">${label}</span>`;
}
function catBadge(v) {
  return `<span class="badge badge-${(v || 'c').toLowerCase()}">${v || 'C'}</span>`;
}

export async function renderCajeros(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">

      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <h2 style="font-size:20px;font-weight:700;margin:0">🧾 Cajeros — ${periodo}</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="caj-search" type="text" placeholder="Buscar nombre o sucursal…"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   background:var(--color-input);color:var(--color-text);font-size:13px;width:200px">
          <button class="btn btn-primary" id="btn-calcular">▶ Calcular comisiones</button>
          <button class="btn btn-secondary" id="btn-export" disabled>⬇ CSV</button>
        </div>
      </div>

      <div style="flex-shrink:0" class="card" style="margin-bottom:10px;padding:10px 14px;font-size:13px;color:var(--color-muted);
                                border-left:3px solid var(--color-primary)">
        Revisá las jornadas antes de calcular. Los marcados con
        <span style="color:var(--color-warning,#f59e0b)">⚠️</span> no tienen jornada registrada en el sistema — establecelas manualmente.
      </div>

      <div id="resumen-wrap" style="display:none;flex-shrink:0;margin-bottom:10px"></div>

      <div id="caj-wrap" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">
        <p style="color:var(--color-muted);text-align:center;padding:40px">Cargando cajeros…</p>
      </div>

    </div>
  `;

  // overrides manuales: { nro_vendedor: 'part'|'full' }
  const overrides = {};
  // últimos resultados del cálculo: { nro_vendedor: {comisiona, monto, ...} }
  let resultadoMap = {};
  let cajerosList = [];
  let sucursalesList = [];
  // sucursales expandidas en el acordeón (Set de strings de id)
  const expandedSucs = new Set();

  // ─── Cargar cajeros de la DB ──────────────────────────────────────
  try {
    [cajerosList, sucursalesList] = await Promise.all([
      api.get('/cajeros').catch(() => []),
      api.get('/sucursales').catch(() => [])
    ]);
    renderLista();
  } catch (err) {
    container.querySelector('#caj-wrap').innerHTML =
      `<p style="color:var(--color-error)">Error al cargar cajeros: ${err.message}</p>`;
  }

  // ─── Filtrar y renderizar la lista editable ───────────────────────
  function renderLista() {
    const q = (container.querySelector('#caj-search')?.value || '').toLowerCase();
    const sucMap = Object.fromEntries(sucursalesList.map(s => [s.id, s.nombre]));

    const filtrados = cajerosList.filter(c =>
      !q ||
      (c.nombre || '').toLowerCase().includes(q) ||
      String(c.nro_vendedor).includes(q) ||
      String(c.sucursal_id).includes(q) ||
      (sucMap[c.sucursal_id] || '').toLowerCase().includes(q)
    );

    // Agrupar por sucursal
    const grupos = {};
    for (const c of filtrados) {
      const k = c.sucursal_id ?? '—';
      if (!grupos[k]) grupos[k] = [];
      grupos[k].push(c);
    }

    const wrap = container.querySelector('#caj-wrap');
    if (!filtrados.length) {
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Sin cajeros.</p></div></div>';
      return;
    }

    const allRows = Object.entries(grupos)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([sucId, cajeros]) => {
        const sucNombre = sucMap[sucId] || `Sucursal ${sucId}`;
        const res        = resultadoMap[sucId];
        const isExpanded = expandedSucs.has(sucId);

        // ── Fila de cabecera de sucursal ──────────────────────────────
        const partTxt  = res ? `${res.vta_vta_tot?.toFixed(1)}%`  : '—';
        const objTxt   = res ? `${res.obj_particip?.toFixed(1)}%`  : '—';
        const comisBadge = res
          ? res.comisiona
            ? '<span class="badge badge-d">✔ Comisiona</span>'
            : '<span class="badge badge-c">✘ No comisiona</span>'
          : '';

        const sucRow = `
          <tr class="suc-acc-hdr" data-suc-id="${sucId}"
              style="cursor:pointer;background:var(--color-surface);border-top:2px solid var(--color-border)">
            <td style="padding:9px 10px;white-space:nowrap;font-weight:700;border-left:3px solid var(--color-primary)">
              <span class="acc-arrow" style="font-size:10px;margin-right:5px;color:var(--color-muted)">${isExpanded ? '▼' : '▶'}</span>#${sucId}
            </td>
            <td style="padding:9px 10px;font-weight:600">
              ${sucNombre}
              <span style="font-weight:400;color:var(--color-muted);font-size:12px;margin-left:5px">(${cajeros.length} cajero${cajeros.length !== 1 ? 's' : ''})</span>
            </td>
            <td style="padding:9px 10px;text-align:center;font-size:12px">
              <span style="color:var(--color-muted)">Part </span><strong>${partTxt}</strong>
            </td>
            <td style="padding:9px 10px;text-align:center;font-size:12px">
              <span style="color:var(--color-muted)">Obj </span><strong>${objTxt}</strong>
            </td>
            <td style="padding:9px 10px;text-align:right">${comisBadge}</td>
          </tr>`;

        // ── Filas de cajeros (ocultas si colapsado) ───────────────────
        const detailRows = cajeros.map(c => {
          const jornadaDB   = c.parcial_tipo === 'X' ? 'part' : 'full';
          const sinRegistro = c.parcial_tipo == null || c.parcial_tipo === '';
          const jornada     = overrides[String(c.nro_vendedor)] ?? jornadaDB;
          const resC        = resultadoMap[`c_${c.nro_vendedor}`];

          const comisionCelda = resC
            ? resC.comisiona
              ? `<td style="padding:6px 10px;text-align:right">
                   ${resC.jornada === 'part'
                     ? `<span style="font-size:11px;color:var(--color-muted)">Full: ${fmtMoney(resC.monto_full)}<br>Part: </span>`
                     : ''}
                   <strong>${fmtMoney(resC.monto)}</strong>
                 </td>`
              : `<td style="padding:6px 10px;text-align:right;color:var(--color-muted)">—</td>`
            : '<td></td>';

          return `
            <tr class="caj-detail" data-suc-id="${sucId}" style="${isExpanded ? '' : 'display:none'}">
              <td style="padding:6px 10px 6px 28px;color:var(--color-muted);font-size:12px">${c.nro_vendedor}</td>
              <td style="padding:6px 10px;font-weight:500">${c.nombre}</td>
              <td style="padding:6px 10px">
                ${sinRegistro
                  ? '<span style="color:#f59e0b">⚠️ Sin datos</span>'
                  : `<span class="badge ${jornadaDB === 'part' ? 'badge-c' : 'badge-a'}">${jornadaDB === 'part' ? 'Part-time' : 'Full-time'}</span>`}
              </td>
              <td style="padding:6px 10px">
                <select class="sel-jornada" data-nro="${c.nro_vendedor}"
                  style="padding:3px 6px;border:1px solid var(--color-border);border-radius:4px;
                         background:var(--color-input);color:var(--color-text);font-size:12px;cursor:pointer">
                  <option value="full" ${jornada === 'full' ? 'selected' : ''}>Full-time</option>
                  <option value="part" ${jornada === 'part' ? 'selected' : ''}>Part-time</option>
                </select>
              </td>
              ${comisionCelda}
            </tr>`;
        }).join('');

        return sucRow + detailRows;
      }).join('');

    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse">
          <colgroup>
            <col style="width:90px">
            <col>
            <col style="width:120px">
            <col style="width:140px">
            <col style="width:140px">
          </colgroup>
          <thead style="position:sticky;top:0;z-index:1;background:var(--color-surface)">
            <tr>
              <th style="padding:8px 10px">ID</th>
              <th style="padding:8px 10px">Nombre</th>
              <th style="padding:8px 10px;text-align:center">Jornada BD / Part.</th>
              <th style="padding:8px 10px;text-align:center">Cálculo / Obj.</th>
              <th style="padding:8px 10px;text-align:right">Comisión $</th>
            </tr>
          </thead>
          <tbody>${allRows}</tbody>
        </table>`;

    // Acordeón
    wrap.querySelectorAll('.suc-acc-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const sid   = hdr.dataset.sucId;
        const arrow = hdr.querySelector('.acc-arrow');
        if (expandedSucs.has(sid)) {
          expandedSucs.delete(sid);
          arrow.textContent = '▶';
        } else {
          expandedSucs.add(sid);
          arrow.textContent = '▼';
        }
        wrap.querySelectorAll(`.caj-detail[data-suc-id="${sid}"]`).forEach(tr => {
          tr.style.display = expandedSucs.has(sid) ? '' : 'none';
        });
      });
    });

    // Selects de jornada
    wrap.querySelectorAll('.sel-jornada').forEach(sel => {
      sel.addEventListener('change', e => {
        overrides[e.target.dataset.nro] = e.target.value;
      });
    });
  }

  // ─── Aplicar resultado (POST o GET) ──────────────────────────────
  function aplicarResultado(res, guardado = false) {
    resultadoMap = {};
    for (const c of res.resultado) {
      resultadoMap[`c_${c.nro_vendedor}`] = c;
      if (!resultadoMap[c.sucursal_id]) {
        resultadoMap[c.sucursal_id] = {
          vta_vta_tot:    c.vta_vta_tot,
          obj_particip:   c.obj_particip,
          ratio_particip: c.ratio_particip,
          comisiona:      c.comisiona,
        };
      }
    }
    const resWrap = container.querySelector('#resumen-wrap');
    resWrap.style.display = 'block';
    const fechaStr = (() => {
      if (!res.fecha_calculo) return '';
      const d = new Date(res.fecha_calculo);
      if (isNaN(d)) return String(res.fecha_calculo).replace('T', ' ').substring(0, 19);
      return d.toLocaleString('es-AR');
    })();
    const fechaTxt = fechaStr
      ? `<div style="font-size:11px;color:var(--color-muted);margin-top:4px">
           ${guardado ? '📂 Cálculo guardado del' : '🔄 Calculado el'} ${fechaStr}
         </div>`
      : '';
    resWrap.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div class="card" style="flex:1;min-width:140px;padding:12px 16px;text-align:center">
          <div style="font-size:24px;font-weight:700">${res.total}</div>
          <div style="font-size:12px;color:var(--color-muted)">Total cajeros</div>
        </div>
        <div class="card" style="flex:1;min-width:140px;padding:12px 16px;text-align:center;border-left:3px solid #22c55e">
          <div style="font-size:24px;font-weight:700;color:#22c55e">${res.comisionan}</div>
          <div style="font-size:12px;color:var(--color-muted)">Comisionan</div>
        </div>
        <div class="card" style="flex:1;min-width:140px;padding:12px 16px;text-align:center;border-left:3px solid #ef4444">
          <div style="font-size:24px;font-weight:700;color:#ef4444">${res.no_comisionan}</div>
          <div style="font-size:12px;color:var(--color-muted)">No comisionan</div>
        </div>
        <div class="card" style="flex:2;min-width:200px;padding:12px 16px;text-align:center;border-left:3px solid var(--color-primary)">
          <div style="font-size:24px;font-weight:700">$${fmtMoney(res.total_monto)}</div>
          <div style="font-size:12px;color:var(--color-muted)">Total a liquidar${fechaTxt}</div>
        </div>
      </div>
    `;
    renderLista();
    container.querySelector('#btn-export').disabled = false;
  }

  // ─── Cargar resultado guardado al iniciar ─────────────────────────
  try {
    const guardado = await api.get(`/calculo/cajeros?periodo=${periodo}`);
    aplicarResultado(guardado, true);
  } catch { /* sin cálculo guardado, esperar que el usuario calcule */ }

  // ─── Calcular ─────────────────────────────────────────────────────
  container.querySelector('#btn-calcular').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-calcular');
    btn.disabled = true; btn.textContent = 'Calculando…';
    try {
      const res = await api.post('/calculo/cajeros', { periodo, overrides });
      aplicarResultado(res, false);
      showToast(`Guardado — ${res.comisionan} cajero${res.comisionan !== 1 ? 's' : ''} comisionan — $${fmtMoney(res.total_monto)}`, 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '▶ Calcular comisiones';
    }
  });

  // ─── Exportar ─────────────────────────────────────────────────────
  container.querySelector('#btn-export').addEventListener('click', () => {
    const rows = Object.entries(resultadoMap)
      .filter(([k]) => k.startsWith('c_'))
      .map(([, v]) => v);
    if (!rows.length) { showToast('Sin datos para exportar', 'error'); return; }
    exportToCSV(rows, `CAJEROS_${periodo}`);
  });

  // ─── Búsqueda ─────────────────────────────────────────────────────
  container.querySelector('#caj-search').addEventListener('input', renderLista);
}
