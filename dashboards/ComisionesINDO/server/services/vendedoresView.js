// Lógica pura del módulo Vendedores. No accede a la DB: recibe filas ya
// leídas y devuelve la vista que consume el frontend.
//
// Replica criterios que viven en SQL (sp_CoVenApp_LlenarEscalonesINDO y
// sp_CoVenApp_CalcularComisionesINDO). Si esos SPs cambian, estos tests
// son el lugar donde se nota.

const DESCRIPCIONES = {
  'PRIMER ESCALON':  'primer',
  'SEGUNDO ESCALON': 'segundo',
  'TERCER ESCALON':  'tercer',
};

/**
 * Escalón alcanzado por una venta. Mismo criterio que
 * sp_CoVenApp_CalcularComisionesINDO: compara de mayor a menor con >=.
 * Un umbral en 0 o nulo no se puede alcanzar (sucursal sin objetivo).
 */
export function escalonAlcanzado(venta, umbrales) {
  const v = Number(venta) || 0;
  const t = Number(umbrales?.tercer)  || 0;
  const s = Number(umbrales?.segundo) || 0;
  const p = Number(umbrales?.primer)  || 0;
  if (t > 0 && v >= t) return 3;
  if (s > 0 && v >= s) return 2;
  if (p > 0 && v >= p) return 1;
  return 0;
}

/**
 * Las 3 filas por vigencia de tbl_CoVenApp_ImportesEscalonesINDO
 * colapsadas en una fila por vigencia, de la más nueva a la más vieja.
 */
export function agruparVigencias(rows) {
  const mapa = new Map();
  for (const r of rows || []) {
    const clave = `${r.Año}-${r.Mes}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, { anio: Number(r.Año), mes: Number(r.Mes), primer: 0, segundo: 0, tercer: 0 });
    }
    const campo = DESCRIPCIONES[String(r.Descripcion || '').trim().toUpperCase()];
    if (campo) mapa.get(clave)[campo] = Number(r.FullTime) || 0;
  }
  return [...mapa.values()].sort((a, b) => (b.anio * 100 + b.mes) - (a.anio * 100 + a.mes));
}

function clave(anio, mes) { return Number(anio) * 100 + Number(mes); }

function claveDePeriodo(periodo) {
  const [a, m] = String(periodo).split('-');
  return clave(a, m);
}

function fmtPeriodo(anio, mes) {
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

/**
 * Réplica del TOP 1 ... WHERE (Año*100+Mes) <= periodo ORDER BY Año DESC, Mes DESC
 * de sp_CoVenApp_LlenarEscalonesINDO. Sin vigencia aplicable → null.
 */
export function vigenciaParaPeriodo(vigencias, periodo) {
  const k = claveDePeriodo(periodo);
  const aplicables = (vigencias || []).filter(v => clave(v.anio, v.mes) <= k);
  if (!aplicables.length) return null;
  return aplicables.reduce((mejor, v) =>
    clave(v.anio, v.mes) > clave(mejor.anio, mejor.mes) ? v : mejor);
}

/**
 * Rango de períodos que gobierna una vigencia: desde ella misma hasta el mes
 * anterior a la vigencia siguiente. La más nueva no tiene fin (hasta: null).
 * Sirve para advertir en la UI qué períodos cambiarían si se los recalcula.
 */
export function periodosAlcanzados(vigencias, vigencia) {
  const k = clave(vigencia.anio, vigencia.mes);
  const siguientes = (vigencias || [])
    .filter(v => clave(v.anio, v.mes) > k)
    .sort((a, b) => clave(a.anio, a.mes) - clave(b.anio, b.mes));
  const desde = fmtPeriodo(vigencia.anio, vigencia.mes);
  if (!siguientes.length) return { desde, hasta: null };
  const sig = siguientes[0];
  const mesPrevio = sig.mes === 1 ? 12 : sig.mes - 1;
  const anioPrevio = sig.mes === 1 ? sig.anio - 1 : sig.anio;
  return { desde, hasta: fmtPeriodo(anioPrevio, mesPrevio) };
}
