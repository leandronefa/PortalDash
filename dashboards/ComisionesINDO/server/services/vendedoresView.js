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

function importeDeEscalon(suc, escalon) {
  if (escalon === 3) return Number(suc.importe_tercer)  || 0;
  if (escalon === 2) return Number(suc.importe_segundo) || 0;
  if (escalon === 1) return Number(suc.importe_primer)  || 0;
  return 0;
}

// Tolerancia de medio peso: los montos son float en SQL.
function difierePlata(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.5;
}

/**
 * Filas planas del JOIN → sucursales con sus vendedores anidados.
 *
 * La comisión que se expone es SIEMPRE la persistida en
 * tbl_CoVenApp_GrillaComisionesINDO: acá no se recalcula nada. Lo que sí se
 * deriva es el escalón alcanzado, y de la comparación entre ambos sale
 * `desfasado` — que significa "la comisión guardada no coincide con el
 * importe CONGELADO del escalón alcanzado en este período". Es una
 * desincronización interna del propio job (p.ej. escalones rellenados sin
 * recalcular comisiones), NO lo que dispara editar una vigencia: el importe
 * congelado de `tbl_CoVenApp_EscalonesINDO` no se toca al editar vigencias,
 * solo lo actualiza `sp_CoVenApp_LlenarEscalonesINDO` cuando el job procesa
 * ese período — y ahí siempre corre encadenado con el cálculo de comisiones.
 *
 * Lo que SÍ detecta una edición de importes sin reprocesar es el segundo
 * parámetro opcional `vigencia` — la vigencia que rige HOY para el período
 * (ver `vigenciaParaPeriodo`). Si algún importe congelado de la sucursal
 * difiere del de esa vigencia, la sucursal queda con
 * `importes_desactualizados: true`: la card de "importes vigentes" y las
 * comisiones mostradas dejaron de coincidir. Sin vigencia (o `null`), da
 * `false` en todas — y el llamado sin este argumento sigue funcionando
 * exactamente igual que antes.
 *
 * La jornada usada es la CONGELADA (`parcial`, de la grilla del período), no
 * la actual del legajo: es la que el SP aplicó al dividir por 2.
 */
export function armarVista(filas, vigencia = null) {
  const porSucursal = new Map();

  for (const f of filas || []) {
    const id = Number(f.sucursal_id);
    if (!porSucursal.has(id)) {
      const importePrimer  = Number(f.importe_primer)  || 0;
      const importeSegundo = Number(f.importe_segundo) || 0;
      const importeTercer  = Number(f.importe_tercer)  || 0;
      const importesDesactualizados = !!vigencia && (
        difierePlata(importePrimer,  vigencia.primer)  ||
        difierePlata(importeSegundo, vigencia.segundo) ||
        difierePlata(importeTercer,  vigencia.tercer)
      );
      porSucursal.set(id, {
        sucursal_id: id,
        sucursal_nombre: f.sucursal_nombre || `Sucursal ${id}`,
        cant_vendedores: Number(f.cant_vendedores) || 0,
        primer_escalon:  Number(f.primer_escalon)  || 0,
        segundo_escalon: Number(f.segundo_escalon) || 0,
        tercer_escalon:  Number(f.tercer_escalon)  || 0,
        importe_primer:  importePrimer,
        importe_segundo: importeSegundo,
        importe_tercer:  importeTercer,
        importes_desactualizados: importesDesactualizados,
        total_comision: 0,
        vendedores: [],
      });
    }
    const suc = porSucursal.get(id);

    const ventaTotal = (Number(f.venta_calculada) || 0) + (Number(f.vta_proporcional) || 0);
    const escalon = escalonAlcanzado(ventaTotal, {
      primer: suc.primer_escalon, segundo: suc.segundo_escalon, tercer: suc.tercer_escalon,
    });
    const esPart = String(f.parcial || '').trim().toUpperCase() === 'X';
    const comision = Number(f.comision) || 0;
    const esperado = esPart ? importeDeEscalon(suc, escalon) / 2 : importeDeEscalon(suc, escalon);

    suc.vendedores.push({
      legajo: String(f.legajo).trim(),
      nombre: (f.nombre || '').trim() || `Legajo ${f.legajo}`,
      jornada: esPart ? 'part' : 'full',
      jornada_cambio: String(f.parcial_actual || '').trim().toUpperCase() !== String(f.parcial || '').trim().toUpperCase(),
      venta_real:       Number(f.venta_real)       || 0,
      dias_venta:       Number(f.dias_venta)       || 0,
      venta_calculada:  Number(f.venta_calculada)  || 0,
      vta_proporcional: Number(f.vta_proporcional) || 0,
      venta_total:      ventaTotal,
      dias_licencia:    Number(f.dias_licencia)    || 0,
      comisiona: Number(f.comisiona) === 1,
      escalon,
      comision,
      desfasado: difierePlata(comision, esperado),
    });
    suc.total_comision += comision;
  }

  const sucursales = [...porSucursal.values()].sort((a, b) => a.sucursal_id - b.sucursal_id);
  for (const s of sucursales) {
    s.vendedores.sort((a, b) => (Number(a.legajo) || 0) - (Number(b.legajo) || 0));
  }

  return {
    sucursales,
    totales: {
      sucursales: sucursales.length,
      vendedores: sucursales.reduce((n, s) => n + s.vendedores.length, 0),
      comision:   sucursales.reduce((n, s) => n + s.total_comision, 0),
      sucursales_desactualizadas: sucursales.filter(s => s.importes_desactualizados).length,
    },
  };
}

function esEnteroNoNegativo(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * Reglas de negocio del ABM de vigencias. La tabla no tiene PK ni índice
 * único, así que la unicidad se valida acá.
 * modo: 'crear' | 'editar' | 'borrar'
 */
export function validarVigencia(body, vigencias, modo) {
  const anio = Number(body?.anio);
  const mes  = Number(body?.mes);

  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) {
    return { ok: false, status: 400, error: 'El año debe ser un entero entre 2020 y 2100' };
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    return { ok: false, status: 400, error: 'El mes debe ser un entero entre 1 y 12' };
  }

  if (modo !== 'borrar') {
    for (const campo of ['primer', 'segundo', 'tercer']) {
      if (!esEnteroNoNegativo(body?.[campo])) {
        return { ok: false, status: 400, error: `El importe del escalón "${campo}" debe ser un entero mayor o igual a 0` };
      }
    }
  }

  const existe = (vigencias || []).some(v => v.anio === anio && v.mes === mes);

  if (modo === 'crear' && existe) {
    return { ok: false, status: 409, error: `La vigencia ${fmtPeriodo(anio, mes)} ya existe: editala en vez de crearla de nuevo` };
  }
  if (modo !== 'crear' && !existe) {
    return { ok: false, status: 404, error: `No existe la vigencia ${fmtPeriodo(anio, mes)}` };
  }
  if (modo === 'borrar' && (vigencias || []).length <= 1) {
    return { ok: false, status: 409, error: 'No se puede borrar la única vigencia: sin ninguna, el cálculo resolvería importe $0 para todos los períodos' };
  }

  return { ok: true };
}

// ── Reproceso de un período ──────────────────────────────────────────────────

/**
 * Fila de `tbl_CoVenApp_FechaCalculoINDO` que le corresponde a un período.
 *
 * ⚠️ La fila de un período es la del PRIMER DÍA DEL MES SIGUIENTE: el SP procesa
 * el mes anterior a su propia fecha (`MONTH(DATEADD(MONTH, -1, @FechaProceso))`).
 * O sea, el período 2026-07 vive en la fila `fecha = 2026-08-01`. Confundir esto
 * reprocesaría el mes equivocado, así que va con test.
 *
 * Devuelve `{anio, mes, fecha: 'YYYY-MM-01'}` o `null` si el período es inválido.
 */
export function filaDePeriodo(periodo) {
  if (!/^\d{4}-\d{2}$/.test(String(periodo || ''))) return null;
  const [anio, mes] = String(periodo).split('-').map(Number);
  if (mes < 1 || mes > 12) return null;
  const sigMes  = mes === 12 ? 1 : mes + 1;
  const sigAnio = mes === 12 ? anio + 1 : anio;
  return { anio: sigAnio, mes: sigMes, fecha: `${sigAnio}-${String(sigMes).padStart(2, '0')}-01` };
}

/**
 * Las guardas que tienen que pasar antes de disparar un reproceso. Recibe datos
 * ya leídos de la DB — no consulta nada.
 *
 * @param periodo            'YYYY-MM' pedido
 * @param fila               {idFechaCalculo, fecha:'YYYY-MM-DD'} | null
 * @param hoy                'YYYY-MM-DD'
 * @param pendienteAnterior  {fecha:'YYYY-MM-DD'} | null — período pendiente más viejo que el pedido
 * @param jobCorriendo       boolean
 * @param tieneDatos         boolean — el período tiene comisiones calculadas
 */
export function evaluarReproceso({ periodo, fila, hoy, pendienteAnterior, jobCorriendo, tieneDatos }) {
  if (!fila) {
    return { ok: false, status: 404,
      error: `No hay fila de proceso para el período ${periodo}: el cálculo de vendedores nunca lo incluyó` };
  }
  if (!tieneDatos) {
    return { ok: false, status: 409,
      error: `El período ${periodo} no tiene comisiones calculadas: no hay nada que reprocesar` };
  }
  if (String(fila.fecha) > String(hoy)) {
    return { ok: false, status: 409,
      error: `El período ${periodo} se procesa a partir del ${fila.fecha}: todavía no cerró` };
  }
  if (jobCorriendo) {
    return { ok: false, status: 409,
      error: 'Ya hay un reproceso en curso: esperá a que termine' };
  }
  if (pendienteAnterior) {
    // El SP toma SIEMPRE el pendiente más viejo, así que reprocesaría ese y no el pedido.
    return { ok: false, status: 409,
      error: `Hay un período anterior pendiente (fila ${pendienteAnterior.fecha}) y el proceso toma siempre el más viejo: se reprocesaría ese en vez de ${periodo}` };
  }
  return { ok: true };
}

/**
 * Estado de un reproceso, para que la página sepa si seguir esperando.
 *
 * La señal de que terminó bien NO es que el job se detuvo, sino que la fila del
 * período volvió a `enviado = 1`: es lo último que hace el SP.
 *
 * Ojo con 'pendiente': `sp_start_job` vuelve ANTES de que el job aparezca como
 * corriendo, así que justo después de disparar el estado es 'pendiente' por unos
 * segundos. La página tiene que seguir esperando mientras sea 'corriendo' o
 * 'pendiente', y recién tomar 'pendiente' como final si se agota el tiempo (ahí
 * significa que el job no arrancó y lo va a levantar la corrida de las 09:00).
 *
 * @param enviado       boolean — la fila del período está marcada como enviada
 * @param jobCorriendo  boolean
 * @param ultima        {exito: boolean, mensaje: string} | null — última corrida del job
 */
export function estadoReproceso({ enviado, jobCorriendo, ultima }) {
  if (jobCorriendo) return 'corriendo';
  if (enviado) return 'ok';
  if (ultima && ultima.exito === false) return 'error';
  return 'pendiente';
}
