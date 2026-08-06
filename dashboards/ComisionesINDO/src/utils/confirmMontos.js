import { api } from '../api/client.js';

// Antes de calcular, consulta si la foto de montos congelada del período
// difiere de los valores vivos del ABM. Si son iguales (o el período todavía
// no tiene foto), no pregunta nada y sigue con el histórico de siempre.
// Si difieren, muestra un diálogo para elegir con cuál calcular.
//
// Devuelve `true`  si hay que pasar `usarMontosActuales: true` al endpoint,
//          `false` si hay que calcular con el histórico (comportamiento actual),
//          `null`  si el usuario canceló (no calcular).
export async function resolverMontosParaCalculo(periodo) {
  let diff;
  try {
    diff = await api.get(`/calculo/montos-diff?periodo=${periodo}`);
  } catch {
    // Si el chequeo falla, no bloqueamos el cálculo — se sigue con el histórico.
    return false;
  }

  if (!diff.distinto) return false;

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" style="max-width:480px">
        <div class="modal-header">
          <span>⚠️ Los montos del ABM cambiaron</span>
        </div>
        <div class="modal-body">
          <p>Los montos vigentes en el ABM son distintos a los que se usaron la última vez
             que se calculó el período <strong>${periodo}</strong>.</p>
          <p style="margin-top:8px">¿Con cuáles montos querés calcular?</p>
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <button class="btn btn-secondary" id="mc-cancelar">Cancelar</button>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" id="mc-historico">Usar históricos</button>
            <button class="btn btn-primary" id="mc-actuales">Usar actuales</button>
          </div>
        </div>
      </div>
    `;

    function close(valor) {
      backdrop.remove();
      resolve(valor);
    }

    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    backdrop.querySelector('#mc-cancelar').addEventListener('click', () => close(null));
    backdrop.querySelector('#mc-historico').addEventListener('click', () => close(false));
    backdrop.querySelector('#mc-actuales').addEventListener('click', () => close(true));

    document.body.appendChild(backdrop);
  });
}
