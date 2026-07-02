import { api } from '../api/client.js';
import { showToast } from '../components/toast.js';
import { createModal } from '../components/modal.js';

let activeTab = 'consumo';
let rootEl, periodo;
let allData = [];
let pageSize = 25;
let currentPage = 1;

export async function renderDatos(container, p) {
  rootEl = container;
  periodo = p;

  container.innerHTML = `
    <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">📥 Datos de Origen — ${periodo}</h2>
    <div class="tabs">
      <button class="tab-btn ${activeTab==='consumo'?'active':''}"  data-tab="consumo">Consumo</button>
      <button class="tab-btn ${activeTab==='efectivo'?'active':''}" data-tab="efectivo">Efectivo</button>
    </div>
    <div id="datos-body"></div>
  `;

  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
      loadTab();
    });
  });

  loadTab();
}

async function loadTab() {
  const body = rootEl.querySelector('#datos-body');
  body.innerHTML = 'Cargando…';
  currentPage = 1;

  try {
    await loadConsumoEfectivo(body, periodo);
  } catch (err) {
    body.innerHTML = `<p style="color:var(--color-danger)">${err.message}</p>`;
  }
}

// ── Consumo / Efectivo ────────────────────────────────────────────
async function loadConsumoEfectivo(body, p) {
  allData = await api.get(`/datos/${activeTab}?periodo=${p}`);
  renderConsumoEfectivo(body, p);
}

function renderConsumoEfectivo(body, p) {
  const tipo = activeTab;
  const label = tipo === 'consumo' ? 'Consumo' : 'Efectivo';
  const objLabel = tipo === 'consumo' ? 'Obj Vtas Cons $' : 'Obj Vtas Efe $';
  const slice = getSlice(allData);

  body.innerHTML = `
    <div class="card">
      <div class="card-header" style="display:flex;align-items:center">
        Datos ${label} — ${p}
        <button class="btn btn-sm btn-success" id="btn-export" style="margin-left:auto">&#128229; Exportar Excel</button>
      </div>
      ${buildPageSizeBar(allData.length)}
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Sucursal</th>
            <th>Ventas $</th>
            <th>VTA/VTATOT %</th>
            <th>Vta Diaria $</th>
            <th>Particip Vta</th>
            <th>Créd Prom $</th>
            <th>Operac</th>
            <th>Pers Op</th>
            <th>Particip Op</th>
            <th>Cobranzas $</th>
            <th>Cob Diaria $</th>
            <th>Particip Cob</th>
            <th>Cant Cob</th>
            <th>Pers Cob</th>
            <th>${objLabel}</th>
          </tr></thead>
          <tbody>
            ${slice.length ? slice.map(r => `
              <tr>
                <td>${r.sucursal_nombre || r.sucursal_id || '-'}</td>
                <td class="num">${fmt(r.ventas)}</td>
                <td class="num">${r.vta_vta_tot != null ? Number(r.vta_vta_tot).toFixed(2) + '%' : '-'}</td>
                <td class="num">${fmt(r.vta_diaria)}</td>
                <td class="num">${fmtPct(r.particip_vta)}</td>
                <td class="num">${fmt(r.credito_promedio)}</td>
                <td class="num">${r.operaciones ?? '-'}</td>
                <td class="num">${r.pers_op ?? '-'}</td>
                <td class="num">${fmtPct(r.particip_op)}</td>
                <td class="num">${fmt(r.cobranzas)}</td>
                <td class="num">${fmt(r.cob_diaria)}</td>
                <td class="num">${fmtPct(r.particip_cob)}</td>
                <td class="num">${r.cant_cob ?? '-'}</td>
                <td class="num">${r.pers_cob ?? '-'}</td>
                <td class="num">${fmt(r.obj_vtas)}</td>
              </tr>
            `).join('') : noData(14)}
          </tbody>
        </table>
      </div>
      ${buildPager(allData.length)}
    </div>
  `;

  attachPagerEvents(body, () => renderConsumoEfectivo(body, p));

  body.querySelector('#btn-export').addEventListener('click', () => {
    const headers = ['Sucursal', 'Ventas $', 'VTA/VTATOT %', 'Vta Diaria $', 'Particip Vta', 'Créd Prom $',
      'Operac', 'Pers Op', 'Particip Op', 'Cobranzas $', 'Cob Diaria $',
      'Particip Cob', 'Cant Cob', 'Pers Cob', objLabel];
    const rows = allData.map(r => [
      r.sucursal_nombre || r.sucursal_id || '',
      r.ventas, r.vta_vta_tot != null ? Number(r.vta_vta_tot).toFixed(2) : '',
      r.vta_diaria,
      r.particip_vta != null ? (Number(r.particip_vta) * 100).toFixed(2) : '',
      r.credito_promedio, r.operaciones ?? '', r.pers_op ?? '',
      r.particip_op != null ? (Number(r.particip_op) * 100).toFixed(2) : '',
      r.cobranzas, r.cob_diaria,
      r.particip_cob != null ? (Number(r.particip_cob) * 100).toFixed(2) : '',
      r.cant_cob ?? '', r.pers_cob ?? '', r.obj_vtas
    ]);
    exportCSV(headers, rows, `${tipo}_${p}`);
  });
}



function openDatoModal(row, sucursales, tipo) {
  const isConsumo = tipo === 'consumo';
  const content = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Sucursal</label>
        <select name="sucursal_id" class="form-control">
          ${sucursales.map(s => `<option value="${s.id}" ${row?.sucursal_id===s.id?'selected':''}>${s.nombre}</option>`).join('')}
        </select>
      </div>
      ${['ventas','vta_diaria','obj_vtas','credito_promedio'].map(k => `
        <div class="form-group"><label class="form-label">${k}</label><input name="${k}" type="number" step="0.01" class="form-control" value="${row?.[k]||''}"></div>
      `).join('')}
      ${['particip_vta','vta_vta_tot','particip_op','particip_cob'].map(k => `
        <div class="form-group"><label class="form-label">${k}</label><input name="${k}" type="number" step="0.0001" class="form-control" value="${row?.[k]||''}"></div>
      `).join('')}
      ${['operaciones','pers_op','cobranzas','cob_diaria','cant_cob','pers_cob'].map(k => `
        <div class="form-group"><label class="form-label">${k}</label><input name="${k}" type="number" step="0.01" class="form-control" value="${row?.[k]||''}"></div>
      `).join('')}
    </div>
  `;
  const modal = createModal({
    title: row ? `Editar ${tipo}` : `Nuevo ${tipo}`,
    content,
    confirmLabel: 'Guardar',
    onConfirm: async (backdrop) => {
      const g = (n) => parseFloat(backdrop.querySelector(`[name="${n}"]`)?.value) || 0;
      const body = {
        sucursal_id:      +backdrop.querySelector('[name="sucursal_id"]').value,
        periodo,
        ventas:           g('ventas'),
        vta_diaria:       g('vta_diaria'),
        obj_vtas:         g('obj_vtas'),
        credito_promedio: g('credito_promedio'),
        particip_vta:     g('particip_vta'),
        vta_vta_tot:      g('vta_vta_tot'),
        particip_op:      g('particip_op'),
        particip_cob:     g('particip_cob'),
        operaciones:      g('operaciones'),
        pers_op:          g('pers_op'),
        cobranzas:        g('cobranzas'),
        cob_diaria:       g('cob_diaria'),
        cant_cob:         g('cant_cob'),
        pers_cob:         g('pers_cob')
      };
      try {
        if (row) {
          await api.put(`/datos/${tipo}/${row.id}`, body);
        } else {
          await api.post(`/datos/${tipo}`, body);
        }
        showToast('Guardado', 'success');
        modal.close();
        loadTab();
      } catch (err) { showToast(err.message, 'error'); }
    }
  });
  modal.open();
}

// ── Paginación y exportación ─────────────────────────────────────
function getSlice(data) {
  if (pageSize === 0) return data;
  const start = (currentPage - 1) * pageSize;
  return data.slice(start, start + pageSize);
}

function buildPageSizeBar(total) {
  const opts = [10, 25, 50, 100, 0];
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:8px 12px;font-size:13px;border-bottom:1px solid var(--color-border,#e5e7eb)">
      <label>Mostrar:
        <select id="pg-size" style="margin-left:6px;padding:2px 6px">
          ${opts.map(n => `<option value="${n}"${pageSize===n?' selected':''}>${n===0?'Todos':n}</option>`).join('')}
        </select>
      </label>
      <span style="color:var(--color-muted,#6b7280)">${total} registros en total</span>
    </div>`;
}

function buildPager(total) {
  if (pageSize === 0 || total <= pageSize) return '';
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return '';
  const range = pages <= 7
    ? Array.from({ length: pages }, (_, i) => i + 1)
    : buildPageRange(pages, currentPage);
  const btns = range.map(pg =>
    pg === '...'
      ? `<span style="padding:0 4px;line-height:28px">&#8230;</span>`
      : `<button class="btn btn-sm pg-btn${pg === currentPage ? ' btn-primary' : ''}" data-page="${pg}" style="min-width:32px">${pg}</button>`
  ).join('');
  return `
    <div style="display:flex;align-items:center;gap:4px;padding:8px 12px;font-size:13px;border-top:1px solid var(--color-border,#e5e7eb)">
      <button class="btn btn-sm pg-btn" data-page="prev"${currentPage===1?' disabled':''}>&#8249; Ant</button>
      ${btns}
      <button class="btn btn-sm pg-btn" data-page="next"${currentPage===pages?' disabled':''}>Sig &#8250;</button>
      <span style="margin-left:8px;color:var(--color-muted,#6b7280)">P&#225;g ${currentPage} de ${pages}</span>
    </div>`;
}

function buildPageRange(pages, cur) {
  const r = [1];
  if (cur > 3) r.push('...');
  for (let i = Math.max(2, cur - 1); i <= Math.min(pages - 1, cur + 1); i++) r.push(i);
  if (cur < pages - 2) r.push('...');
  r.push(pages);
  return r;
}

function attachPagerEvents(body, renderFn) {
  body.querySelector('#pg-size')?.addEventListener('change', e => {
    pageSize = +e.target.value;
    currentPage = 1;
    renderFn();
  });
  body.querySelectorAll('.pg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const pages = pageSize === 0 ? 1 : Math.ceil(allData.length / pageSize);
      const pg = btn.dataset.page;
      if (pg === 'prev') currentPage = Math.max(1, currentPage - 1);
      else if (pg === 'next') currentPage = Math.min(pages, currentPage + 1);
      else currentPage = +pg;
      renderFn();
    });
  });
}

function exportCSV(headers, rows, filename) {
  const BOM = '\uFEFF';
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))];
  const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function fmt(v) { return v != null ? Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'; }
function fmtPct(v) { return v != null ? `${(Number(v) * 100).toFixed(2)}%` : '-'; }
function noData(cols) { return `<tr><td colspan="${cols}" style="text-align:center;color:var(--color-muted);padding:20px">Sin datos</td></tr>`; }
