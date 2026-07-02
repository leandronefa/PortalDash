import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

export async function renderSucursalesMillon(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:700;margin:0">⭐ Sucursales Millón — ${periodo}</h2>
      <input type="text" id="sm-search" placeholder="Buscar sucursal u operador…"
        style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
               background:var(--color-input);color:var(--color-text);font-size:13px;width:240px">
    </div>
    <div id="sm-info" style="font-size:12px;color:var(--color-muted);margin-bottom:12px"></div>
    <div id="sm-wrap">Cargando…</div>
  `;

  let allData = [];

  function renderAll(data) {
    const wrap = container.querySelector('#sm-wrap');
    if (!data.length) {
      wrap.innerHTML = '<p style="color:var(--color-muted);padding:40px;text-align:center">Sin datos para este período.</p>';
      return;
    }

    wrap.innerHTML = data.map(suc => {
      const totalOps = suc.operadores.filter(o => o.es_operador).length;
      const rows = suc.operadores.map(op => `
        <tr>
          <td>${op.operador}</td>
          <td style="text-align:center">
            <label class="switch-label" title="${op.es_operador ? 'Operador' : 'No operador'}">
              <input type="checkbox" class="op-toggle"
                data-suc="${suc.sucursal_id}"
                data-op="${op.operador}"
                ${op.es_operador ? 'checked' : ''}>
              <span class="switch-track">
                <span class="switch-thumb"></span>
              </span>
              <span class="switch-text ${op.es_operador ? 'op-si' : 'op-no'}">
                ${op.es_operador ? 'OPERADOR' : 'NO'}
              </span>
            </label>
          </td>
        </tr>
      `).join('');

      return `
        <div class="card" style="margin-bottom:16px" data-suc-id="${suc.sucursal_id}">
          <div class="card-header" style="display:flex;align-items:center;gap:12px">
            <span>🏪 ${suc.sucursal}</span>
            <span class="badge badge-b" style="margin-left:auto;font-size:11px">
              ${totalOps} operador${totalOps !== 1 ? 'es' : ''}
            </span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th style="text-align:center;width:160px">¿Es operador?</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    // Eventos toggle
    wrap.querySelectorAll('.op-toggle').forEach(chk => {
      chk.addEventListener('change', async () => {
        const sucId   = parseInt(chk.dataset.suc, 10);
        const operador = chk.dataset.op;
        const val      = chk.checked;

        // Actualizar datos locales
        const suc = allData.find(s => s.sucursal_id === sucId);
        const op  = suc?.operadores.find(o => o.operador === operador);
        if (op) op.es_operador = val;

        // Actualizar texto y badge
        const label    = chk.closest('.switch-label');
        const txt      = label.querySelector('.switch-text');
        txt.textContent = val ? 'OPERADOR' : 'NO';
        txt.className   = `switch-text ${val ? 'op-si' : 'op-no'}`;

        // Actualizar badge de conteo en el card
        const card       = chk.closest('[data-suc-id]');
        const totalOps   = suc?.operadores.filter(o => o.es_operador).length ?? 0;
        const badge      = card.querySelector('.badge');
        badge.textContent = `${totalOps} operador${totalOps !== 1 ? 'es' : ''}`;

        try {
          await api.patch('/millon/operadores', { sucursal_id: sucId, operador, es_operador: val });
        } catch {
          // Revertir
          chk.checked = !val;
          if (op) op.es_operador = !val;
          txt.textContent = !val ? 'OPERADOR' : 'NO';
          txt.className   = `switch-text ${!val ? 'op-si' : 'op-no'}`;
          showToast('Error al guardar', 'error');
        }
      });
    });
  }

  function filtrar() {
    const q = container.querySelector('#sm-search').value.toLowerCase().trim();
    if (!q) { renderAll(allData); return; }

    const filt = allData
      .map(suc => {
        if (suc.sucursal.toLowerCase().includes(q)) return suc;
        const ops = suc.operadores.filter(o => o.operador.toLowerCase().includes(q));
        if (ops.length) return { ...suc, operadores: ops };
        return null;
      })
      .filter(Boolean);

    renderAll(filt);
  }

  container.querySelector('#sm-search').addEventListener('input', filtrar);

  try {
    allData = await api.get(`/millon/sucursales?periodo=${periodo}`);
    const totalOps = allData.reduce((a, s) => a + s.operadores.filter(o => o.es_operador).length, 0);
    container.querySelector('#sm-info').textContent =
      `${allData.length} sucursales · ${totalOps} operadores marcados · Período: ${periodo}`;
    renderAll(allData);
  } catch (err) {
    container.querySelector('#sm-wrap').innerHTML =
      `<p style="color:var(--color-danger)">${err.message}</p>`;
  }
}
