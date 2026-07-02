import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

export async function renderVisorSucursales(container) {
  container.innerHTML = `
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">🏪 Sucursales</h2>
    <div style="margin-bottom:12px">
      <input id="suc-search" type="text" placeholder="Buscar por ID, nombre o provincia…"
        style="padding:8px 12px;font-size:13px;border:1px solid var(--color-border);
               border-radius:6px;background:var(--color-input);color:var(--color-text);width:320px;outline:none">
    </div>
    <div id="suc-wrap">
      <p style="color:var(--color-muted);text-align:center;padding:40px">Cargando…</p>
    </div>
  `;

  let allData = [];

  function renderTable(rows) {
    const wrap = container.querySelector('#suc-wrap');
    if (!rows.length) {
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Sin resultados.</p></div></div>';
      return;
    }
    const body = rows.map(r => `
      <tr>
        <td>${r.id ?? r.sucursal_id ?? '—'}</td>
        <td>${r.nombre ?? r.sucursal_nombre ?? '—'}</td>
        <td>${r.provincia ?? '—'}</td>
      </tr>
    `).join('');
    wrap.innerHTML = `
      <div class="card" style="margin-top:0">
        <div class="table-wrap"><table>
          <thead><tr>
            <th>ID</th><th>Nombre</th><th>Provincia</th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table></div>
      </div>`;
  }

  function applyFilter() {
    const q = (container.querySelector('#suc-search').value || '').toLowerCase().trim();
    if (!q) { renderTable(allData); return; }
    const filtered = allData.filter(r => {
      const id   = String(r.id ?? r.sucursal_id ?? '').toLowerCase();
      const nom  = (r.nombre ?? r.sucursal_nombre ?? '').toLowerCase();
      const prov = (r.provincia ?? '').toLowerCase();
      return id.includes(q) || nom.includes(q) || prov.includes(q);
    });
    renderTable(filtered);
  }

  container.querySelector('#suc-search').addEventListener('input', applyFilter);

  try {
    const data = await api.get('/sucursales');
    allData = Array.isArray(data) ? data : (data.sucursales ?? data.data ?? []);
    renderTable(allData);
  } catch (err) {
    showToast(err.message, 'error');
    container.querySelector('#suc-wrap').innerHTML =
      '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Error al cargar sucursales.</p></div></div>';
  }
}
