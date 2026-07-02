import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

const TABS = [
  { key: 'ranking',         label: 'Ranking' },
  { key: 'multiplicadores', label: 'Multiplicadores' },
];

function catBadge(v) {
  return `<span class="badge badge-${(v || 'c').toLowerCase()}">${v ?? '—'}</span>`;
}

export async function renderVisorRanking(container, periodo) {
  container.innerHTML = `
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">🏆 Ranking — ${periodo}</h2>
    <div style="display:flex;gap:4px;margin-bottom:0;border-bottom:2px solid var(--color-border)">
      ${TABS.map((t, i) => `
        <button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.key}"
          style="padding:8px 18px;font-size:13px;font-weight:600;border:none;border-radius:6px 6px 0 0;cursor:pointer;
                 background:${i === 0 ? 'var(--color-primary)' : 'var(--color-card)'};
                 color:${i === 0 ? '#fff' : 'var(--color-text)'};border-bottom:none">
          ${t.label}
        </button>
      `).join('')}
    </div>
    <div id="ranking-wrap" style="margin-top:0">
      <p style="color:var(--color-muted);text-align:center;padding:40px">Cargando…</p>
    </div>
  `;

  let activeTab = 'ranking';
  const cache = {};

  function switchTab(key) {
    activeTab = key;
    container.querySelectorAll('.tab-btn').forEach(b => {
      const active = b.dataset.tab === key;
      b.style.background = active ? 'var(--color-primary)' : 'var(--color-card)';
      b.style.color      = active ? '#fff' : 'var(--color-text)';
      b.classList.toggle('active', active);
    });
    loadTab(key);
  }

  async function loadTab(key) {
    const wrap = container.querySelector('#ranking-wrap');
    if (cache[key]) { renderTab(wrap, key, cache[key]); return; }
    wrap.innerHTML = '<p style="color:var(--color-muted);text-align:center;padding:40px">Cargando…</p>';
    try {
      let rows;
      if (key === 'ranking') {
        const raw = await api.get(`/ranking?periodo=${periodo}`);
        rows = Array.isArray(raw) ? raw : (raw.data ?? raw.ranking ?? []);
      } else {
        const raw = await api.get('/ranking/multiplicadores');
        rows = Array.isArray(raw) ? raw : (raw.data ?? raw.multiplicadores ?? []);
      }
      cache[key] = rows;
      renderTab(wrap, key, rows);
    } catch (err) {
      showToast(err.message, 'error');
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Error al cargar datos.</p></div></div>';
    }
  }

  function renderTab(wrap, key, rows) {
    if (!rows.length) {
      wrap.innerHTML = '<div class="card"><div class="card-body"><p style="color:var(--color-muted)">Sin datos.</p></div></div>';
      return;
    }
    if (key === 'ranking') {
      const body = rows.map(r => `
        <tr>
          <td>${r.id ?? r.sucursal_id ?? '—'}</td>
          <td>${r.sucursal ?? r.sucursal_nombre ?? '—'}</td>
          <td>${r.supervisor ?? '—'}</td>
          <td>${r.provincia ?? '—'}</td>
          <td>${catBadge(r.categoria ?? r.category)}</td>
        </tr>
      `).join('');
      wrap.innerHTML = `
        <div class="card" style="margin-top:0">
          <div class="table-wrap"><table>
            <thead><tr><th>ID</th><th>Sucursal</th><th>Supervisor</th><th>Provincia</th><th>Categoría</th></tr></thead>
            <tbody>${body}</tbody>
          </table></div>
        </div>`;
    } else {
      const body = rows.map(r => `
        <tr>
          <td>${catBadge(r.categoria ?? r.category)}</td>
          <td>${r.multiplicador ?? r.factor ?? '—'}</td>
        </tr>
      `).join('');
      wrap.innerHTML = `
        <div class="card" style="margin-top:0">
          <div class="table-wrap"><table>
            <thead><tr><th>Categoría</th><th>Multiplicador</th></tr></thead>
            <tbody>${body}</tbody>
          </table></div>
        </div>`;
    }
  }

  container.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  loadTab(activeTab);
}
