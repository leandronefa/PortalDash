import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function catColor(c) {
  return c === 'A' ? '#16a34a' : c === 'B' ? '#ca8a04' : '#dc2626';
}

function catBg(c) {
  return c === 'A' ? 'rgba(22,163,74,.12)' : c === 'B' ? 'rgba(202,138,4,.12)' : 'rgba(220,38,38,.08)';
}

export async function renderRanking(container, periodo) {
  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">
      <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h2 style="font-size:20px;font-weight:700;margin:0">Ranking de Sucursales — ${periodo}</h2>
        <button id="btn-calcular" class="btn btn-primary">⟳ Calcular Ranking Automático</button>
      </div>

      <div id="mult-section" style="flex-shrink:0;margin-bottom:12px"></div>

      <div id="ranking-content" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0">
        <p style="color:var(--color-muted);text-align:center;padding:30px">
          Presioná <strong>Calcular Ranking Automático</strong> para generar el ranking del período,<br>
          o los datos ya calculados se cargarán a continuación.
        </p>
      </div>
    </div>
  `;

  loadMultiplicadores(container);
  await loadRankingGuardado(container, periodo);

  container.querySelector('#btn-calcular').addEventListener('click', async () => {
    const btn = container.querySelector('#btn-calcular');
    btn.disabled = true;
    btn.textContent = 'Calculando…';
    try {
      const res = await api.post('/ranking/calcular', { periodo });
      renderRankingTablas(container, periodo, res.retail || [], res.millon || []);
      showToast('Ranking calculado y guardado', 'success');
    } catch (err) {
      showToast(err.message || 'Error al calcular', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '⟳ Calcular Ranking Automático';
    }
  });
}

// ── Carga ranking guardado al entrar ─────────────────────────────────────────
async function loadRankingGuardado(container, periodo) {
  try {
    const rows = await api.get(`/ranking?periodo=${periodo}`);
    if (!rows.length) return;

    // Ya vienen ordenadas por posición desde el servidor
    const retail = rows.filter(r => r.grupo === 'retail' || (!r.grupo && r.sucursal_id < 100));
    const millon = rows.filter(r => r.grupo === 'millon' || (!r.grupo && r.sucursal_id >= 100 && r.sucursal_id < 200));

    if (retail.length || millon.length) {
      renderRankingTablas(container, periodo, retail, millon);
    }
  } catch {
    // sin datos previos, no pasa nada
  }
}

// ── Render tablas de ranking ──────────────────────────────────────────────────
function renderRankingTablas(container, periodo, retail, millon) {
  const content = container.querySelector('#ranking-content');

  const resumen = calcResumen(retail, millon);

  content.innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      ${resumen.map(r => `
        <div class="card" style="padding:10px 18px;text-align:center;min-width:110px;
             border-color:${catColor(r.cat)}40">
          <div style="font-size:11px;color:var(--color-muted)">Cat. ${r.cat}</div>
          <div style="font-size:22px;font-weight:800;color:${catColor(r.cat)}">${r.total}</div>
          <div style="font-size:10px;color:var(--color-muted)">${r.label}</div>
        </div>
      `).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div>
        <h3 style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--color-muted)">
          RETAIL (sucursales &lt; 100)
        </h3>
        ${renderGrupoTabla(retail, periodo)}
      </div>
      <div>
        <h3 style="font-size:14px;font-weight:700;margin-bottom:10px;color:var(--color-muted)">
          MILLÓN (sucursales 100–199)
        </h3>
        ${renderGrupoTabla(millon, periodo)}
      </div>
    </div>
  `;

  // Botones de override manual
  content.querySelectorAll('.btn-override').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sucId    = +btn.dataset.suc;
      const actual   = btn.dataset.cat;
      const opciones = ['A', 'B', 'C'].filter(c => c !== actual);
      const nueva    = prompt(`Sucursal ${sucId} — Categoría actual: ${actual}\nIngresá nueva categoría (A, B o C):`);
      if (!nueva || !['A','B','C'].includes(nueva.toUpperCase())) return;
      try {
        await api.post('/ranking', { sucursal_id: sucId, categoria: nueva.toUpperCase(), periodo });
        btn.dataset.cat = nueva.toUpperCase();
        btn.closest('tr').querySelector('.td-cat').innerHTML =
          `<span style="font-weight:700;color:${catColor(nueva.toUpperCase())}">${nueva.toUpperCase()}</span>`;
        showToast(`Sucursal ${sucId} → Cat. ${nueva.toUpperCase()}`, 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
}

function renderGrupoTabla(rows, periodo) {
  if (!rows.length) return '<p style="color:var(--color-muted);font-size:12px">Sin datos</p>';

  const encabezados = `
    <th style="text-align:center">#</th>
    <th>ID</th><th>Sucursal</th>
    <th style="text-align:right">Consumo $</th>
    <th style="text-align:right">Efectivo $</th>
    <th style="text-align:right">Total $</th>
    <th style="text-align:right">Particip %</th>
    <th style="text-align:right">Acum %</th>
    <th style="text-align:center">Categoría</th>
    <th></th>
  `;

  const filas = rows.map(r => {
    const bg = catBg(r.categoria);
    return `
      <tr style="background:${bg}">
        <td style="text-align:center;color:var(--color-muted)">${r.posicion ?? '—'}</td>
        <td style="font-weight:600">${r.sucursal_id}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${r.nombre}">${r.nombre ?? '—'}</td>
        <td style="text-align:right">${fmtMoney(r.venta_consumo)}</td>
        <td style="text-align:right">${fmtMoney(r.venta_efectivo)}</td>
        <td style="text-align:right;font-weight:600">${fmtMoney(r.venta_total)}</td>
        <td style="text-align:right">${r.particip_pct != null ? (+r.particip_pct).toFixed(2) + '%' : '—'}</td>
        <td style="text-align:right">${r.particip_acum != null ? (+r.particip_acum).toFixed(2) + '%' : '—'}</td>
        <td class="td-cat" style="text-align:center;font-weight:700;color:${catColor(r.categoria)}">
          ${r.categoria}
        </td>
        <td>
          <button class="btn-override" data-suc="${r.sucursal_id}" data-cat="${r.categoria}"
            style="background:none;border:none;cursor:pointer;color:var(--color-muted);font-size:11px;
                   padding:2px 6px;border-radius:4px;border:1px solid var(--color-border)"
            title="Cambiar manualmente">✏</button>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <table style="width:100%;font-size:12px">
      <thead style="position:sticky;top:0;z-index:1;background:var(--color-surface)">
        <tr>${encabezados}</tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  `;
}

function calcResumen(retail, millon) {
  const todos = [...retail, ...millon];
  return ['A','B','C'].map(cat => ({
    cat,
    total: todos.filter(r => r.categoria === cat).length,
    label: cat === 'A' ? '< 60% acum' : cat === 'B' ? '60–90% acum' : '> 90% acum',
  }));
}

// ── Multiplicadores ───────────────────────────────────────────────────────────
async function loadMultiplicadores(container) {
  const data = await api.get('/ranking/multiplicadores').catch(() => []);
  const sec  = container.querySelector('#mult-section');
  sec.innerHTML = `
    <div class="card">
      <div class="card-header">Multiplicadores por categoría</div>
      <div class="card-body" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center">
        ${data.map(m => `
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge badge-${m.categoria.toLowerCase()}">${m.categoria}</span>
            <span style="font-size:12px;color:var(--color-muted)">×</span>
            <input type="number" step="0.01" min="1" max="2"
              style="width:80px;padding:4px 8px;border:1px solid var(--color-border);
                     border-radius:6px;background:var(--color-input);color:var(--color-text);font-size:13px"
              data-cat="${m.categoria}" value="${m.multiplicador}">
            <button class="btn btn-sm btn-primary btn-save-mult" data-cat="${m.categoria}">Guardar</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  sec.querySelectorAll('.btn-save-mult').forEach(btn => {
    btn.addEventListener('click', async () => {
      const inp = sec.querySelector(`input[data-cat="${btn.dataset.cat}"]`);
      try {
        await api.put(`/ranking/multiplicadores/${btn.dataset.cat}`, { multiplicador: parseFloat(inp.value) });
        showToast('Multiplicador actualizado', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
}
