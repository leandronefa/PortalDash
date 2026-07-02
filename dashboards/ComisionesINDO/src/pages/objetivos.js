import { api } from '../api/client.js';

let activeTab = 'consumo';
let rootEl, periodo;

export async function renderObjetivos(container, p) {
  rootEl = container;
  periodo = p;

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 48px)">
      <h2 style="flex-shrink:0;font-size:20px;font-weight:700;margin-bottom:10px">🎯 Objetivos — ${periodo}</h2>
      <div class="tabs" style="flex-shrink:0">
        <button class="tab-btn ${activeTab==='consumo'?'active':''}" data-tab="consumo">Consumo</button>
        <button class="tab-btn ${activeTab==='efectivo'?'active':''}" data-tab="efectivo">Efectivo</button>
      </div>
      <div id="obj-body" style="flex:1;overflow-y:auto;overflow-x:auto;min-height:0"></div>
    </div>
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
  const body = rootEl.querySelector('#obj-body');
  body.innerHTML = 'Cargando…';

  try {
    const data = await api.get(`/objetivos/${activeTab}?periodo=${periodo}`);
    const isConsumo = activeTab === 'consumo';

    if (isConsumo) {
      body.innerHTML = `
        <table style="width:100%">
          <thead style="position:sticky;top:0;z-index:1;background:var(--color-surface)">
            <tr>
              <th>Sucursal</th>
              <th>Obj. Ventas $</th>
              <th>Obj. Cobranzas $</th>
              <th>Obj. Operaciones</th>
              <th>Obj. Participación %</th>
              <th>Créd. Prom. $</th>
            </tr>
          </thead>
          <tbody>
            ${data.length ? data.map(r => `
              <tr>
                <td>${r.sucursal_nombre || r.sucursal_id}</td>
                <td class="num">${fmt(r.OBJETIVO_VENTAS)}</td>
                <td class="num">${fmt(r.OBJETIVO_COBRANZAS)}</td>
                <td class="num">${r.OBJETIVO_OPERACIONES ?? '-'}</td>
                <td class="num">${r.OBJETIVO_PARTICIPA ?? '-'} %</td>
                <td class="num">${fmt(r.OBJETIVO_CREDPRO)}</td>
              </tr>
            `).join('') : noData(6)}
          </tbody>
        </table>
      `;
    } else {
      body.innerHTML = `
        <table style="width:100%">
          <thead style="position:sticky;top:0;z-index:1;background:var(--color-surface)">
            <tr>
              <th>Sucursal</th>
              <th>Obj. Ventas EFE $</th>
              <th>Obj. Cobranzas EFE $</th>
              <th>Obj. Operaciones EFE</th>
              <th>Obj. Participación EFE %</th>
              <th>Créd. Prom. EFE $</th>
            </tr>
          </thead>
          <tbody>
            ${data.length ? data.map(r => `
              <tr>
                <td>${r.sucursal_nombre || r.sucursal_id}</td>
                <td class="num">${fmt(r.OBJETIVO_VENTAS_EFE)}</td>
                <td class="num">${fmt(r.OBJETIVO_COBRANZAS_EFE)}</td>
                <td class="num">${r.OBJETIVO_OPERACIONES_EFE ?? '-'}</td>
                <td class="num">${r.OBJETIVO_PARTICIPA_EFE ?? '-'} %</td>
                <td class="num">${fmt(r.OBJETIVO_CREDPRO_EFE)}</td>
              </tr>
            `).join('') : noData(6)}
          </tbody>
        </table>
      `;
    }
  } catch (err) {
    body.innerHTML = `<p style="color:var(--color-danger)">${err.message}</p>`;
  }
}

function fmt(v) { return v != null ? Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'; }
function noData(cols) { return `<tr><td colspan="${cols}" style="text-align:center;color:var(--color-muted);padding:20px">Sin datos</td></tr>`; }