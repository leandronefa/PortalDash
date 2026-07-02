import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { exportToCSV } from '../components/exportExcel.js';

export async function renderMillon(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:20px;font-weight:700;margin:0">⭐ Sucursales Millón — ${periodo}</h2>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" id="mill-search" class="search-input" placeholder="Buscar sucursal/operador…" style="width:220px">
        <button class="btn btn-secondary" id="btn-refresh" title="Actualizar datos desde BeClever">↻ Actualizar</button>
        <button class="btn btn-secondary" id="btn-export-mill">⬇ CSV</button>
      </div>
    </div>
    <div id="mill-info" style="font-size:12px;color:var(--color-muted);margin-bottom:12px">Cargando…</div>
    <div id="millon-wrap"></div>
  `;

  let allSucursales = [];  // [{sucursal_id, sucursal, operadores:[{operador,total_operaciones,total_importe,es_operador}]}]
  let flagsMap = {};       // "suc_id|OP" → true/false (espejo local para toggles rápidos)
  const expandedSet = new Set(); // suc_ids expandidos (persiste entre renders)

  function buildFlagsMap() {
    flagsMap = {};
    for (const s of allSucursales)
      for (const op of s.operadores)
        flagsMap[`${s.sucursal_id}|${op.operador}`] = op.es_operador;
  }

  function flatRows() {
    return allSucursales.flatMap(s =>
      s.operadores.map(op => ({
        sucursal: s.sucursal, sucursal_id: s.sucursal_id, ...op,
      }))
    );
  }

  function render(data) {
    const wrap = container.querySelector('#millon-wrap');
    if (!data.length) {
      wrap.innerHTML = '<p style="text-align:center;color:var(--color-muted);padding:40px">Sin datos de Millón para este período.</p>';
      return;
    }

    wrap.innerHTML = data.map(suc => {
      const totalOps     = suc.operadores.reduce((a, r) => a + (+r.total_operaciones || 0), 0);
      const totalImporte = suc.operadores.reduce((a, r) => a + (+r.total_importe     || 0), 0);
      const opCount      = suc.operadores.filter(r => flagsMap[`${suc.sucursal_id}|${r.operador}`] !== false).length;

      const rowsHtml = suc.operadores.map(op => {
        const isOp = flagsMap[`${suc.sucursal_id}|${op.operador}`] !== false;
        return `
          <tr>
            <td>${op.operador || '—'}</td>
            <td style="text-align:right">${fmt(op.total_operaciones)}</td>
            <td style="text-align:right">${fmt(op.total_importe)}</td>
            <td style="text-align:center">
              <label class="switch-label">
                <input type="checkbox" class="op-toggle"
                  data-suc="${suc.sucursal_id}" data-op="${op.operador}"
                  ${isOp ? 'checked' : ''}>
                <span class="switch-track"><span class="switch-thumb"></span></span>
                <span class="switch-text ${isOp ? 'op-si' : 'op-no'}">${isOp ? 'OPERADOR' : 'NO'}</span>
              </label>
            </td>
          </tr>
        `;
      }).join('');

      const expanded = expandedSet.has(suc.sucursal_id);
      return `
        <div class="card" style="margin-bottom:8px" data-suc-id="${suc.sucursal_id}">
          <div class="card-header acc-header" style="display:flex;align-items:center;gap:12px;cursor:pointer;user-select:none">
            <span class="acc-arrow" style="font-size:11px;transition:transform 150ms;transform:rotate(${expanded ? 90 : 0}deg)">▶</span>
            <span>🏪 ${suc.sucursal}</span>
            <span class="suc-op-count badge badge-b" style="margin-left:auto;font-size:11px">${opCount} operador${opCount !== 1 ? 'es' : ''}</span>
            <span style="font-size:12px;color:var(--color-muted)">${totalOps} orig. &nbsp;|&nbsp; <strong>${fmt(totalImporte)}</strong></span>
          </div>
          <div class="acc-body" style="display:${expanded ? 'block' : 'none'}">
            <div class="table-wrap">
              <table style="table-layout:fixed;width:100%">
                <colgroup>
                  <col style="width:35%"><col style="width:18%">
                  <col style="width:22%"><col style="width:25%">
                </colgroup>
                <thead>
                  <tr>
                    <th>Operador</th>
                    <th style="text-align:right">Originaciones</th>
                    <th style="text-align:right">Importe total</th>
                    <th style="text-align:center">¿Es operador?</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                  <tr style="font-weight:600;background:var(--color-bg)">
                    <td>TOTAL</td>
                    <td style="text-align:right">${fmt(totalOps)}</td>
                    <td style="text-align:right">${fmt(totalImporte)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Acordeón
    wrap.querySelectorAll('.acc-header').forEach(header => {
      header.addEventListener('click', e => {
        if (e.target.closest('.switch-label')) return; // no colapsar al hacer clic en toggle
        const card   = header.closest('[data-suc-id]');
        const sucId  = parseInt(card.dataset.sucId, 10);
        const body   = card.querySelector('.acc-body');
        const arrow  = header.querySelector('.acc-arrow');
        const open   = body.style.display !== 'none';
        body.style.display  = open ? 'none' : 'block';
        arrow.style.transform = open ? 'rotate(0deg)' : 'rotate(90deg)';
        if (open) expandedSet.delete(sucId); else expandedSet.add(sucId);
      });
    });

    // Eventos toggle
    wrap.querySelectorAll('.op-toggle').forEach(chk => {
      chk.addEventListener('change', async () => {
        const sucId  = parseInt(chk.dataset.suc, 10);
        const opName = chk.dataset.op;
        const val    = chk.checked;
        const opKey  = `${sucId}|${opName}`;

        flagsMap[opKey] = val;
        const label = chk.closest('.switch-label');
        const txt   = label.querySelector('.switch-text');
        txt.textContent = val ? 'OPERADOR' : 'NO';
        txt.className   = `switch-text ${val ? 'op-si' : 'op-no'}`;

        const card  = chk.closest('[data-suc-id]');
        const count = [...card.querySelectorAll('.op-toggle')].filter(c => c.checked).length;
        card.querySelector('.suc-op-count').textContent = `${count} operador${count !== 1 ? 'es' : ''}`;

        try {
          await api.patch('/millon/operadores', { sucursal_id: sucId, operador: opName, es_operador: val, periodo });
        } catch {
          chk.checked     = !val;
          flagsMap[opKey] = !val;
          txt.textContent = !val ? 'OPERADOR' : 'NO';
          txt.className   = `switch-text ${!val ? 'op-si' : 'op-no'}`;
          showToast('Error al guardar', 'error');
        }
      });
    });
  }

  function applySearch() {
    const q = container.querySelector('#mill-search').value.toLowerCase().trim();
    if (!q) { render(allSucursales); return; }
    const filt = allSucursales
      .map(s => {
        if (s.sucursal.toLowerCase().includes(q)) return s;
        const ops = s.operadores.filter(o => o.operador.toLowerCase().includes(q));
        return ops.length ? { ...s, operadores: ops } : null;
      })
      .filter(Boolean);
    render(filt);
  }

  function updateInfo(fecha_carga) {
    const totalOps = allSucursales.reduce((a, s) => a + s.operadores.filter(o => o.es_operador).length, 0);
    const fechaTxt = fecha_carga
      ? `· Datos: ${new Date(fecha_carga).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`
      : '';
    container.querySelector('#mill-info').textContent =
      `${allSucursales.length} sucursales · ${totalOps} operadores marcados ${fechaTxt}`;
  }

  async function load(forceRefresh = false) {
    const infoEl = container.querySelector('#mill-info');
    const btnRef = container.querySelector('#btn-refresh');
    infoEl.textContent = forceRefresh ? 'Actualizando desde BeClever…' : 'Cargando…';
    btnRef.disabled = true;

    try {
      const endpoint = forceRefresh
        ? `/millon/cache/refresh?periodo=${periodo}`
        : `/millon/sucursales?periodo=${periodo}`;
      const resp = forceRefresh
        ? await api.post(endpoint)
        : await api.get(endpoint);

      allSucursales = resp.sucursales;
      buildFlagsMap();
      updateInfo(resp.fecha_carga);
      applySearch();
      if (forceRefresh) showToast('Datos actualizados desde BeClever', 'success');
    } catch (err) {
      infoEl.textContent = 'Error al cargar';
      container.querySelector('#millon-wrap').innerHTML =
        `<p style="color:var(--color-danger)">${err.message}</p>`;
    } finally {
      btnRef.disabled = false;
    }
  }

  container.querySelector('#mill-search').addEventListener('input', applySearch);
  container.querySelector('#btn-refresh').addEventListener('click', () => load(true));
  container.querySelector('#btn-export-mill').addEventListener('click', () => {
    exportToCSV(flatRows(), `MILLON_${periodo}`);
  });

  await load(false);
}

function fmt(v) {
  return v != null
    ? Number(v).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : '-';
}
