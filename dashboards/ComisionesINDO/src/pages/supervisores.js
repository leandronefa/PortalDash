import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

// ─── Supervisores: gestión (crear, editar, asignar sucursales) ───────────────

export async function renderSupervisores(container) {
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <h2 style="font-size:20px;font-weight:700">Supervisores</h2>
      <button class="btn btn-primary" id="btn-nuevo-sup">+ Nuevo supervisor</button>
    </div>
    <div class="card">
      <div class="card-body">
        <div id="sup-table">Cargando…</div>
      </div>
    </div>
    <!-- Modal editar/crear -->
    <div id="sup-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center">
      <div style="background:#1e2130;border:1px solid #2e3450;border-radius:8px;padding:24px;width:580px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.6);color:#e2e8f0">
        <h3 id="sup-modal-title" style="font-size:16px;font-weight:700;margin-bottom:16px;color:#f1f5f9">Nuevo supervisor</h3>
        <div style="margin-bottom:12px">
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;color:#cbd5e1">Nombre</label>
          <input id="sup-nombre" class="form-control" type="text" placeholder="Nombre del supervisor" style="background:#262c42;color:#e2e8f0;border-color:#3e4a6e">
        </div>
        <div style="margin-bottom:16px">
          <label style="font-size:12px;font-weight:600;display:block;margin-bottom:6px;color:#cbd5e1">Sucursales asignadas</label>
          <input id="sup-suc-filter" class="form-control" style="margin-bottom:8px;background:#262c42;color:#e2e8f0;border-color:#3e4a6e" placeholder="Filtrar sucursales…" type="text">
          <div id="sup-suc-list" style="border:1px solid #2e3450;border-radius:6px;max-height:300px;overflow-y:auto;padding:6px;background:#161a27"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-secondary" id="sup-modal-cancel">Cancelar</button>
          <button class="btn btn-primary" id="sup-modal-save">Guardar</button>
        </div>
      </div>
    </div>
  `;

  let sucursalesList = [];
  let supervisoresList = [];
  let editingId = null;

  async function loadData() {
    [sucursalesList, supervisoresList] = await Promise.all([
      api.get('/sucursales').catch(() => []),
      api.get('/supervisores').catch(() => [])
    ]);
    renderTable();
  }

  function renderTable() {
    const tbl = container.querySelector('#sup-table');
    if (!supervisoresList.length) {
      tbl.innerHTML = '<p style="color:var(--color-muted);font-size:13px">No hay supervisores registrados.</p>';
      return;
    }
    const sucMap = Object.fromEntries(sucursalesList.map(s => [s.id, s.nombre]));
    tbl.innerHTML = `
      <table class="table">
        <thead><tr>
          <th>Nombre</th><th>Sucursales asignadas</th><th>Activo</th><th style="width:140px"></th>
        </tr></thead>
        <tbody>
          ${supervisoresList.map(s => `
            <tr>
              <td>${s.nombre}</td>
              <td style="font-size:11px;max-width:280px;white-space:normal">
                ${s.sucursales.length
                  ? s.sucursales.map(id => `<span class="badge badge-c" style="margin:1px">${sucMap[id] || id}</span>`).join('')
                  : '<span style="color:var(--color-muted)">—</span>'}
              </td>
              <td><span class="badge ${s.activo ? 'badge-a' : 'badge-c'}">${s.activo ? 'Sí' : 'No'}</span></td>
              <td>
                <button class="btn btn-sm btn-secondary btn-edit-sup" data-id="${s.id}">Editar</button>
                <button class="btn btn-sm btn-danger btn-del-sup" data-id="${s.id}">Eliminar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    tbl.querySelectorAll('.btn-edit-sup').forEach(btn => {
      btn.addEventListener('click', () => openModal(parseInt(btn.dataset.id)));
    });
    tbl.querySelectorAll('.btn-del-sup').forEach(btn => {
      btn.addEventListener('click', () => deleteSup(parseInt(btn.dataset.id)));
    });
  }

  function buildSucursalCheckboxes(selectedIds = [], ownerSupervisorId = null) {
    const listEl   = container.querySelector('#sup-suc-list');
    const filterEl = container.querySelector('#sup-suc-filter');
    const sel = new Set(selectedIds.map(Number));

    // Sucursales ocupadas por OTRO supervisor
    const ocupadas = new Set();
    for (const sup of supervisoresList) {
      if (sup.id === ownerSupervisorId) continue;
      for (const sid of (sup.sucursales || [])) ocupadas.add(Number(sid));
    }

    // Agrupar sucursales por provincia
    function groupByProvincia(list) {
      const map = {};
      for (const s of list) {
        const prov = s.provincia || 'Sin provincia';
        if (!map[prov]) map[prov] = [];
        map[prov].push(s);
      }
      return map;
    }

    function render(filter = '') {
      const lower = filter.toLowerCase();
      const filtered = lower
        ? sucursalesList.filter(s =>
            String(s.id).includes(lower) ||
            s.nombre.toLowerCase().includes(lower) ||
            (s.provincia || '').toLowerCase().includes(lower)
          )
        : sucursalesList;

      const groups = groupByProvincia(filtered);
      const provNames = Object.keys(groups).sort();

      listEl.innerHTML = provNames.map(prov => {
        const sucs = groups[prov];
        const ids  = sucs.map(s => s.id);
        const availableIds = ids.filter(id => !ocupadas.has(id));
        const allChecked  = availableIds.length > 0 && availableIds.every(id => sel.has(id));
        const someChecked = availableIds.some(id => sel.has(id));

        return `
          <div class="prov-group" style="margin-bottom:6px">
            <label style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:#262c42;border-radius:5px;cursor:pointer;font-weight:600;font-size:12px;color:#e2e8f0">
              <input type="checkbox" class="prov-check" data-prov="${prov}"
                ${allChecked ? 'checked' : ''}
                ${(!allChecked && someChecked) ? 'data-indeterminate="1"' : ''}>
              <span>🗺 ${prov} <span style="font-weight:400;color:var(--color-muted)">(${sucs.length} sucursales)</span></span>
            </label>
            <div class="prov-sucs" style="padding-left:20px">
              ${sucs.map(s => {
                const disabled = ocupadas.has(s.id);
                const otroSup = disabled
                  ? supervisoresList.find(sup => sup.id !== ownerSupervisorId && (sup.sucursales||[]).includes(s.id))
                  : null;
                const tooltip = otroSup ? `title="Asignada a: ${otroSup.nombre}"` : '';
                return `
                <label style="display:flex;align-items:center;gap:8px;padding:3px 6px;cursor:${disabled?'not-allowed':'pointer'};border-radius:4px;font-size:12px;opacity:${disabled?'0.45':'1'}" ${tooltip}>
                  <input type="checkbox" class="suc-check" value="${s.id}" data-prov="${prov}" ${sel.has(s.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
                  <span>${s.id} — ${s.nombre}${disabled ? ` <em style="font-size:10px;color:var(--color-muted)">(${otroSup?.nombre||'ocupada'})</em>` : ''}</span>
                </label>`;
              }).join('')}
            </div>
          </div>
        `;
      }).join('');

      // Aplicar estado indeterminado a checkboxes de provincia
      listEl.querySelectorAll('.prov-check[data-indeterminate="1"]').forEach(cb => {
        cb.indeterminate = true;
      });

      // Click en provincia → marca/desmarca solo las sucursales disponibles
      listEl.querySelectorAll('.prov-check').forEach(cb => {
        cb.addEventListener('change', () => {
          const prov = cb.dataset.prov;
          const sucsInProv = sucursalesList.filter(s => (s.provincia || 'Sin provincia') === prov && !ocupadas.has(s.id));
          sucsInProv.forEach(s => {
            if (cb.checked) sel.add(s.id);
            else sel.delete(s.id);
          });
          cb.indeterminate = false;
          listEl.querySelectorAll(`.suc-check[data-prov="${prov}"]:not(:disabled)`).forEach(sc => {
            sc.checked = cb.checked;
          });
        });
      });

      // Click en sucursal individual → actualiza estado del checkbox de provincia
      listEl.querySelectorAll('.suc-check').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) sel.add(Number(cb.value));
          else sel.delete(Number(cb.value));
          const prov = cb.dataset.prov;
          const provCb = listEl.querySelector(`.prov-check[data-prov="${prov}"]`);
          if (provCb) {
            const availableInProv = sucursalesList
              .filter(s => (s.provincia || 'Sin provincia') === prov && !ocupadas.has(s.id))
              .map(s => s.id);
            const allC  = availableInProv.length > 0 && availableInProv.every(id => sel.has(id));
            const someC = availableInProv.some(id => sel.has(id));
            provCb.checked = allC;
            provCb.indeterminate = !allC && someC;
          }
        });
      });
    }

    filterEl.addEventListener('input', () => render(filterEl.value));
    render();
    return () => [...sel];
  }

  let getSelectedSucursales = () => [];

  function openModal(supId = null) {
    editingId = supId;
    const modal  = container.querySelector('#sup-modal');
    const title  = container.querySelector('#sup-modal-title');
    const nombre = container.querySelector('#sup-nombre');
    const filterEl = container.querySelector('#sup-suc-filter');
    filterEl.value = '';

    const sup = supId ? supervisoresList.find(s => s.id === supId) : null;
    title.textContent = sup ? `Editar: ${sup.nombre}` : 'Nuevo supervisor';
    nombre.value = sup?.nombre || '';
    getSelectedSucursales = buildSucursalCheckboxes(sup?.sucursales || [], supId);
    modal.style.display = 'flex';
    nombre.focus();
  }

  function closeModal() {
    container.querySelector('#sup-modal').style.display = 'none';
    editingId = null;
  }

  container.querySelector('#btn-nuevo-sup').addEventListener('click', () => openModal(null));
  container.querySelector('#sup-modal-cancel').addEventListener('click', closeModal);

  container.querySelector('#sup-modal-save').addEventListener('click', async () => {
    const nombre = container.querySelector('#sup-nombre').value.trim();
    if (!nombre) { showToast('El nombre es requerido', 'error'); return; }
    const sucursales = getSelectedSucursales();
    try {
      if (editingId) {
        await api.put(`/supervisores/${editingId}`, { nombre, activo: 1 });
        await api.put(`/supervisores/${editingId}/sucursales`, { sucursales });
        showToast('Supervisor actualizado', 'success');
      } else {
        const created = await api.post('/supervisores', { nombre });
        await api.put(`/supervisores/${created.id}/sucursales`, { sucursales });
        showToast('Supervisor creado', 'success');
      }
      closeModal();
      await loadData();
    } catch (err) { showToast(err.message || 'Error al guardar', 'error'); }
  });

  async function deleteSup(id) {
    if (!confirm('¿Eliminar este supervisor y todas sus asignaciones de sucursales?')) return;
    try {
      await api.delete(`/supervisores/${id}`);
      showToast('Supervisor eliminado', 'success');
      await loadData();
    } catch (err) { showToast(err.message || 'Error al eliminar', 'error'); }
  }

  await loadData();
}
