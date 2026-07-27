import { api, isSupervisorReadonly } from '../api/client.js';
import { showToast } from '../components/toast.js';

function catBadge(v) {
  if (!v) return '<span style="color:var(--color-muted)">—</span>';
  const c = v.toUpperCase();
  return `<span class="badge badge-${c.toLowerCase()}">${c}</span>`;
}

function efectivoBadge(v) {
  return v
    ? '<span class="badge badge-a">CON efectivo</span>'
    : '<span class="badge badge-c">SIN efectivo</span>';
}

function activaBadge(v) {
  return v
    ? '<span class="badge badge-d">Habilitada</span>'
    : '<span class="badge" style="background:var(--sem-red);color:var(--sem-red-t)">Deshabilitada</span>';
}


export async function renderSucursales(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">
      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="font-size:20px;font-weight:700;margin:0">Sucursales — ${periodo}</h2>
        <div style="display:flex;gap:8px">
          <input type="text" id="suc-search" placeholder="Buscar…"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   background:var(--color-input);color:var(--color-text);font-size:13px;width:200px">
          <select id="suc-filter-efect"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   background:var(--color-input);color:var(--color-text);font-size:13px">
            <option value="">Todas</option>
            <option value="1">CON efectivo</option>
            <option value="0">SIN efectivo</option>
          </select>
          <select id="suc-filter-activa"
            style="padding:6px 10px;border:1px solid var(--color-border);border-radius:6px;
                   background:var(--color-input);color:var(--color-text);font-size:13px">
            <option value="">Habilitadas y no</option>
            <option value="1">Habilitadas</option>
            <option value="0">Deshabilitadas</option>
          </select>
        </div>
      </div>
      <div id="suc-info" style="flex-shrink:0;font-size:12px;color:var(--color-muted);margin-bottom:6px"></div>
      <div id="suc-table" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">Cargando…</div>
    </div>
  `;

  let allData = [];

  function filtrar() {
    const q      = container.querySelector('#suc-search').value.toLowerCase();
    const efect  = container.querySelector('#suc-filter-efect').value;
    const activa = container.querySelector('#suc-filter-activa').value;
    const filt   = allData.filter(s => {
      const matchQ = !q || `${s.id} ${s.nombre} ${s.provincia ?? ''}`.toLowerCase().includes(q);
      const matchE = efect === '' || String(s.con_efectivo ? 1 : 0) === efect;
      const matchA = activa === '' || String(s.activa ? 1 : 0) === activa;
      return matchQ && matchE && matchA;
    });
    renderTabla(filt);
    container.querySelector('#suc-info').textContent =
      `${filt.length} de ${allData.length} sucursales · Período: ${periodo}`;
  }

  function renderTabla(data) {
    const tbl = container.querySelector('#suc-table');
    if (!data.length) {
      tbl.innerHTML = `<div class="card"><div class="card-body">
        <p style="color:var(--color-muted)">Sin sucursales.</p>
      </div></div>`;
      return;
    }

    const readonly = isSupervisorReadonly();
    const rows = data.map(s => `
      <tr style="${s.activa ? '' : 'opacity:.45'}">
        <td style="font-weight:600">${s.id}</td>
        <td>${s.nombre ?? '—'}</td>
        <td>${s.provincia ?? '—'}</td>
        <td style="text-align:center">${catBadge(s.categoria)}</td>
        <td style="text-align:center">
          ${readonly ? efectivoBadge(s.con_efectivo) : `
          <button class="btn-efect" data-id="${s.id}" data-val="${s.con_efectivo ? 1 : 0}"
            style="border:none;background:none;cursor:pointer;padding:0">
            ${efectivoBadge(s.con_efectivo)}
          </button>`}
        </td>
        <td style="text-align:center">
          ${readonly ? activaBadge(s.activa) : `
          <button class="btn-activa" data-id="${s.id}" data-val="${s.activa ? 1 : 0}"
            style="border:none;background:none;cursor:pointer;padding:0"
            title="${s.activa ? 'Clic para deshabilitar: desaparece de todas las páginas y del cálculo' : 'Clic para volver a habilitarla'}">
            ${activaBadge(s.activa)}
          </button>`}
        </td>
      </tr>
    `).join('');

    tbl.innerHTML = `
      <table style="width:100%">
        <thead style="position:sticky;top:0;z-index:1;background:var(--color-surface)">
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th>Provincia</th>
            <th style="text-align:center">Cat. ${periodo}</th>
            <th style="text-align:center">Efectivo <span style="font-size:10px;color:var(--color-muted)">(clic para cambiar)</span></th>
            <th style="text-align:center">Estado <span style="font-size:10px;color:var(--color-muted)">(clic para cambiar)</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // Toggle con_efectivo al hacer clic en el badge
    tbl.querySelectorAll('.btn-efect').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id         = parseInt(btn.dataset.id, 10);
        const valActual  = btn.dataset.val === '1';
        const nuevoVal   = !valActual;

        // Optimista
        const suc = allData.find(s => s.id === id);
        if (suc) suc.con_efectivo = nuevoVal;
        btn.innerHTML    = efectivoBadge(nuevoVal);
        btn.dataset.val  = nuevoVal ? '1' : '0';

        try {
          await api.patch(`/sucursales/${id}/efectivo`, { con_efectivo: nuevoVal });
          showToast(`Sucursal ${id}: ${nuevoVal ? 'CON efectivo' : 'SIN efectivo'}`, 'success');
        } catch (err) {
          // Revertir
          if (suc) suc.con_efectivo = valActual;
          btn.innerHTML   = efectivoBadge(valActual);
          btn.dataset.val = valActual ? '1' : '0';
          showToast('Error al guardar', 'error');
        }
      });
    });

    // Toggle activa (habilitar/deshabilitar sucursal)
    tbl.querySelectorAll('.btn-activa').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id        = parseInt(btn.dataset.id, 10);
        const valActual = btn.dataset.val === '1';
        const nuevoVal  = !valActual;

        try {
          await api.patch(`/sucursales/${id}/activa`, { activa: nuevoVal });
          const suc = allData.find(s => s.id === id);
          if (suc) suc.activa = nuevoVal;
          filtrar();
          showToast(
            nuevoVal
              ? `Sucursal ${id} habilitada — vuelve a verse en las páginas y a entrar en el cálculo`
              : `Sucursal ${id} deshabilitada — se oculta de las páginas y del cálculo. Los resultados ya guardados la conservan hasta recalcular.`,
            'success'
          );
        } catch (err) {
          showToast(err.message || 'Error al guardar', 'error');
        }
      });
    });
  }

  container.querySelector('#suc-search').addEventListener('input', filtrar);
  container.querySelector('#suc-filter-efect').addEventListener('change', filtrar);
  container.querySelector('#suc-filter-activa').addEventListener('change', filtrar);

  try {
    allData = await api.get(`/sucursales?periodo=${periodo}&todas=1`);
    const conEfecto  = allData.filter(s => s.con_efectivo).length;
    const inactivas  = allData.filter(s => !s.activa).length;
    container.querySelector('#suc-info').textContent =
      `${allData.length} sucursales · ${conEfecto} CON efectivo · ${inactivas} deshabilitadas · Período: ${periodo}`;
    filtrar();
  } catch (err) {
    container.querySelector('#suc-table').innerHTML =
      `<p style="color:var(--color-danger)">${err.message}</p>`;
  }
}
