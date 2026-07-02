/**
 * calcEngine.js
 * Motor de cálculo de comisiones INDO
 *
 * calcularTotal()      → array de filas por sucursal (vista resumen)
 * calcularCajeros()    → array de filas por cajero individual
 * calcularOperadores() → array de filas por operador individual
 * calcularEncargados() → array de filas por encargado individual
 * calcularSupervisores()→ array de filas por supervisor individual
 */

// ------------------------------------------------------------------
// Determinar escalón a partir del ratio real/objetivo
// Tolerancia: shortfall estrictamente menor a 4% del umbral → se
// considera alcanzado (igual a -4% exacto NO alcanza).
// Umbrales:  esc1=1.00, esc2=1.10, esc3=1.10×1.15=1.265
// Con tol:   ratio > umbral×0.96 → cuenta como ese escalón
// ------------------------------------------------------------------
function getEscalon(ratio) {
  const T3 = 1.10 * 1.15;          // 1.265
  if (ratio > T3  * 0.96) return 3; // shortfall < 4% de 126.5%
  if (ratio > 1.10 * 0.96) return 2; // shortfall < 4% de 110%
  if (ratio > 1.00 * 0.96) return 1; // shortfall < 4% de 100%
  return 0;
}

// ------------------------------------------------------------------
// Calcular comisión de una sucursal
// ------------------------------------------------------------------
export function calcularSucursal({
  sucursal,
  ranking,
  multiplicador,
  consumo,
  efectivo,
  reporte,
  objConsumo,
  objEfectivo,
  montos,
  montosVendedor,
  montosSupervisor,
  montosPrestamaos,
  montosCajero
}) {
  const cat = ranking?.categoria || 'C';
  const mult = multiplicador || 1.0;

  // ── ¿Tiene efectivo? ────────────────────────────────────────────
  // Valor fijo de la tabla de sucursales: con_efectivo = 1 → CON efectivo.
  // Se configura en el ABM de Sucursales y no cambia por período.
  const tieneEfectivo = !!(sucursal.con_efectivo);

  // ── Efectivo ────────────────────────────────────────────────────
  const efRatio = (tieneEfectivo && objEfectivo?.primer_escalon)
    ? (efectivo?.ventas || 0) / objEfectivo.primer_escalon
    : 0;
  const efEscalon = getEscalon(efRatio);

  // ── Consumo ─────────────────────────────────────────────────────
  const conRatio = objConsumo?.primer_escalon
    ? (consumo?.ventas || 0) / objConsumo.primer_escalon
    : 0;
  const conEscalon = getEscalon(conRatio);

  // ── Semáforo ─────────────────────────────────────────────────────
  function semaforo(ratio) {
    if (ratio >= 0.97) return 'verde';
    if (ratio >= 0.93) return 'amarillo';
    return 'rojo';
  }

  // ── Montos base por sección/escalón/categoría ───────────────────
  function getMonto(seccion, escalon) {
    const row = montos.find(m => m.seccion === seccion && m.escalon === escalon && m.categoria_suc === cat)
      || montos.find(m => m.seccion === seccion && m.escalon === escalon && m.categoria_suc === 'C');
    return row?.total || 0;
  }

  function getMontoVendedor(tipo, escalon) {
    const row = montosVendedor.find(m => m.tipo_vendedor === tipo && m.escalon === escalon && m.categoria_suc === cat)
      || montosVendedor.find(m => m.tipo_vendedor === tipo && m.escalon === escalon && m.categoria_suc === 'C');
    return row?.monto || 0;
  }

  function getMontoSup(concepto, tipo) {
    const row = montosSupervisor.find(m => m.concepto === concepto && m.tipo === tipo && m.categoria_suc === cat)
      || montosSupervisor.find(m => m.concepto === concepto && m.tipo === tipo && m.categoria_suc === 'C');
    return row?.monto || 0;
  }

  function getMontoPrestamo(tipo, escalon) {
    const row = montosPrestamaos.find(m => m.tipo === tipo && m.escalon === escalon && m.categoria_suc === cat)
      || montosPrestamaos.find(m => m.tipo === tipo && m.escalon === escalon && m.categoria_suc === 'C');
    return row?.monto || 0;
  }

  function getMontoCajero() {
    const row = montosCajero.find(m => m.categoria_suc === cat)
      || montosCajero.find(m => m.categoria_suc === 'C');
    return row?.monto || 0;
  }

  // ── Calcular comisiones operadores con/sin efectivo ──────────────
  // Solo una de las dos aplica según tieneEfectivo
  const montoConEfect  = tieneEfectivo ? getMonto('OPER_CON_EFECT', efEscalon)  * mult : 0;
  const montoSinEfect  = tieneEfectivo ? 0 : getMonto('OPER_SIN_EFECT', conEscalon) * mult;
  // ENCARGADO/ENC_MILLON: los montos ya están guardados por categoría (categoria_suc),
  // no se multiplica de nuevo por `mult` (mismo fix que calcularEncargados).
  const montoEnc       = getMonto('ENCARGADO',      Math.max(efEscalon, conEscalon));
  const montoEncMillon = getMonto('ENC_MILLON',     Math.max(efEscalon, conEscalon));

  // ── Vendedores (usando escalón de efectivo por defecto) ──────────
  const vendFull   = getMontoVendedor('FULL',   efEscalon) * mult;
  const vendPart   = getMontoVendedor('PART',   efEscalon) * mult;
  const vendCajero = getMontoVendedor('CAJERO', efEscalon) * mult;

  // ── Supervisor ───────────────────────────────────────────────────
  const supConsumoPorSuc = getMontoSup('consumo',  'por_sucursal') * mult;
  const supEfectoPorSuc  = getMontoSup('efectivo', 'por_sucursal') * mult;
  const supConsumoPorPlaza = getMontoSup('consumo', 'por_plaza') * mult;
  const supEfectoPorPlaza  = getMontoSup('efectivo','por_plaza') * mult;

  // ── Préstamos / Vta Ef. Retail ───────────────────────────────────
  const prestSuc = getMontoPrestamo('suc', efEscalon) * mult;

  // ── Cajero fijo ──────────────────────────────────────────────────
  const cajeroMonto = getMontoCajero() * mult;

  return {
    sucursal_id:          sucursal.id,
    sucursal_nombre:      sucursal.nombre,
    supervisor:           sucursal.supervisor,
    provincia:            sucursal.provincia,
    categoria:            cat,
    multiplicador:        mult,
    tiene_efectivo:       tieneEfectivo,

    // Efectivo
    vta_efectivo:         efectivo?.ventas || 0,
    obj_efectivo:         objEfectivo?.primer_escalon || 0,
    ratio_efectivo:       +efRatio.toFixed(4),
    escalon_efectivo:     efEscalon,
    semaforo_efectivo:    semaforo(efRatio),

    // Consumo
    vta_consumo:          consumo?.ventas || 0,
    obj_consumo:          objConsumo?.primer_escalon || 0,
    ratio_consumo:        +conRatio.toFixed(4),
    escalon_consumo:      conEscalon,
    semaforo_consumo:     semaforo(conRatio),

    // Comisiones
    monto_con_efect:      +montoConEfect.toFixed(2),
    monto_sin_efect:      +montoSinEfect.toFixed(2),
    monto_encargado:      +montoEnc.toFixed(2),
    monto_enc_millon:     +montoEncMillon.toFixed(2),
    vend_full:            +vendFull.toFixed(2),
    vend_part:            +vendPart.toFixed(2),
    vend_cajero:          +vendCajero.toFixed(2),
    sup_consumo_suc:      +supConsumoPorSuc.toFixed(2),
    sup_efectivo_suc:     +supEfectoPorSuc.toFixed(2),
    sup_consumo_plaza:    +supConsumoPorPlaza.toFixed(2),
    sup_efectivo_plaza:   +supEfectoPorPlaza.toFixed(2),
    prest_suc:            +prestSuc.toFixed(2),
    cajero_fijo:          +cajeroMonto.toFixed(2)
  };
}

// ------------------------------------------------------------------
// Calcular resumen por sucursal
// ------------------------------------------------------------------
export function calcularTotal(ctx) {
  const {
    sucursales, rankingMap, multiplicadores,
    datosConsumo, datosEfectivo,
    datosReporte, objConsumo, objEfectivo,
    montos, montosVendedor, montosSupervisor, montosPrestamaos, montosCajero
  } = ctx;

  const multMap = {};
  for (const m of multiplicadores) multMap[m.categoria] = m.multiplicador;

  return sucursales.map(suc => {
    const rk = rankingMap[suc.id] || { categoria: 'C' };
    return calcularSucursal({
      sucursal:       suc,
      ranking:        rk,
      multiplicador:  multMap[rk.categoria] || 1.0,
      consumo:        datosConsumo.find(d => d.sucursal_id === suc.id),
      efectivo:       datosEfectivo.find(d => d.sucursal_id === suc.id),
      reporte:        datosReporte.filter(d => d.id_sucursal === suc.id),
      objConsumo:     objConsumo.find(d => d.sucursal_id === suc.id),
      objEfectivo:    objEfectivo.find(d => d.sucursal_id === suc.id),
      montos, montosVendedor, montosSupervisor, montosPrestamaos, montosCajero
    });
  });
}

// ------------------------------------------------------------------
// Helpers para cálculos individuales
// ------------------------------------------------------------------
function _getMontoVendedor(montosVendedor, tipo, escalon, cat) {
  return (montosVendedor.find(m => m.tipo_vendedor === tipo && m.escalon === escalon && m.categoria_suc === cat)
    || montosVendedor.find(m => m.tipo_vendedor === tipo && m.escalon === escalon && m.categoria_suc === 'C'))
    ?.monto || 0;
}

function _getMonto(montos, seccion, escalon, cat) {
  return (montos.find(m => m.seccion === seccion && m.escalon === escalon && m.categoria_suc === cat)
    || montos.find(m => m.seccion === seccion && m.escalon === escalon && m.categoria_suc === 'C'))
    ?.total || 0;
}

function _getMontoSup(montosSupervisor, concepto, tipo, cat) {
  return (montosSupervisor.find(m => m.concepto === concepto && m.tipo === tipo && m.categoria_suc === cat)
    || montosSupervisor.find(m => m.concepto === concepto && m.tipo === tipo && m.categoria_suc === 'C'))
    ?.monto || 0;
}

// ------------------------------------------------------------------
// Calcular comisiones individuales de Cajeros
//
//   Condición para comisionar: ratio participación > 0.96
//   (tolerancia 4%: shortfall < 4% del objetivo cuenta como alcanzado,
//    mismo criterio que getEscalon y los indicadores G/O/R)
//
//   Monto base: tbl_CoVenAppINDO_MontosCajero (valor único, sin multiplicador de categoría)
//   Part-time:  mitad del valor, redondeado a múltiplos de 1000
//
//   Jornada: se toma de la DB (GCL_TEMPSPARTIEL='X' → part).
//   Si viene parcial_override ('part'|'full') en el cajero, ese valor tiene prioridad.
// ------------------------------------------------------------------
export function calcularCajeros(ctx, sucResultados) {
  const { cajerosSucursal, montosCajero, datosConsumo } = ctx;

  return cajerosSucursal
    .filter(c => c.sucursal_id != null)
    .map(c => {
      const sucRes = sucResultados.find(s => s.sucursal_id === c.sucursal_id);
      if (!sucRes) return null;

      // ── Participación real vs objetivo ────────────────────────────
      // vta_vta_tot viene en % directo desde BeClever (ej: 51.21)
      // obj_particip_pct también viene en % directo desde OBJETIVOS_MILLON (ej: 42.00)
      const consumoRow    = datosConsumo?.find(d => d.sucursal_id === c.sucursal_id);
      const vtaVtaTot     = consumoRow?.vta_vta_tot      ?? 0;
      const objParticipPct = consumoRow?.obj_particip_pct ?? 0;
      const ratioParticip  = objParticipPct > 0 ? vtaVtaTot / objParticipPct : 0;
      const comisiona      = objParticipPct > 0 && ratioParticip > 0.96;

      // ── Monto base fijo (sin multiplicador de categoría) ──────────
      const montoBase = (
        montosCajero.find(m => m.categoria_suc === sucRes.categoria) ||
        montosCajero.find(m => m.categoria_suc === 'C')
      )?.monto || 0;

      const montoFull = comisiona ? montoBase : 0;
      const montoPart = comisiona ? Math.round((montoBase * 0.5) / 1000) * 1000 : 0;

      // ── Jornada: override manual > DB ─────────────────────────────
      const jornadaDB = c.parcial_tipo === 'X' ? 'part' : 'full';
      const jornada   = c.parcial_override != null ? c.parcial_override : jornadaDB;
      const esParcial = jornada === 'part';

      return {
        nro_vendedor:     c.nro_vendedor,
        nombre:           c.nombre,
        sucursal_id:      c.sucursal_id,
        sucursal_nombre:  sucRes.sucursal_nombre,
        categoria:        sucRes.categoria,
        vta_vta_tot:      vtaVtaTot,
        obj_particip:     objParticipPct,
        ratio_particip:   +ratioParticip.toFixed(4),
        comisiona,
        jornada_db:       jornadaDB,
        jornada,
        monto_base:       montoBase,
        monto_full:       montoFull,
        monto_part:       montoPart,
        monto:            esParcial ? montoPart : montoFull,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sucursal_id - b.sucursal_id || a.nombre.localeCompare(b.nombre));
}

// ------------------------------------------------------------------
// Calcular comisiones individuales de Operadores
//
//   CALCULO CONSUMO: suma de componentes según indicadores G, O, R.
//     G = (VTA/VTATOT_real/100 - participacion_obj) / participacion_obj  ← market share
//     O = (credito_prom_real - credito_prom_obj) / credito_prom_obj
//     R = (operaciones_real - operaciones_obj) / operaciones_obj
//     Condición de cada indicador: valor > -0.04 (tolerancia estricta < 4%)
//     G es puerta: sin G no hay O ni R.
//     Componentes (de tbl_CoVenAppINDO_Montos):
//       escalon_monto  (C) → siempre, cuando escalon > 0
//       participacion  (B) → solo si G > -0.04
//       ticket_promedio(E) → solo si G > -0.04 y O > -0.04
//       operacion      (F) → solo si G > -0.04 y R > -0.04
//     Caso esc=0 y G > -0.04: solo participacion del esc1
//     Caso esc≥1 y G ≤ -0.04: solo escalon_monto
//
//   CALCULO EFECTIVO: monto fijo de MontosPrestamos tipo='suc' según esc_efectivo.
//     Solo aplica si con_efectivo=true y esc_efectivo > 0.
//
//   Los valores en Montos/MontosPrestamos ya son per-categoría (el factor de ranking
//   está embebido en el ABM). No se aplica mult adicional.
//
//   ctx.datosReporte   = filas de sp_ReporteOriginacionesCreditos
//   ctx.operadorMap    = { USUARIO_UPPER: "Nombre Completo" }
//   ctx.datosConsumo   = [{ sucursal_id, ventas, credito_promedio, operaciones }]
//   ctx.objConsumo     = [{ sucursal_id, primer_escalon, credito_promedio, operaciones }]
//   ctx.montos         = tbl_CoVenAppINDO_Montos
//   ctx.montosPrestamaos = tbl_CoVenAppINDO_MontosPrestamos
//   sucResultados      = output de calcularTotal()
// ------------------------------------------------------------------
export function calcularOperadores(ctx, sucResultados) {
  const {
    datosReporte, operadorMap, jornadasMap = {},
    datosConsumo, objConsumo, montos, montosPrestamaos,
  } = ctx;

  // Deduplica combinaciones únicas (usuario_originador, id_sucursal)
  const visto = new Set();
  const ops = [];
  for (const r of datosReporte) {
    const usuario = (r.usuario_originador || '').toUpperCase().trim();
    if (!usuario) continue;
    const key = `${usuario}|${r.id_sucursal}`;
    if (!visto.has(key)) {
      visto.add(key);
      ops.push({ usuario, id_sucursal: r.id_sucursal });
    }
  }

  // Sucursales sin ningún operador en el reporte → fila sintética para mostrar comisión
  const sucIdsConOp = new Set(ops.map(o => o.id_sucursal));
  for (const sucRes of sucResultados) {
    if (!sucIdsConOp.has(sucRes.sucursal_id)) {
      ops.push({ usuario: `_SUC${sucRes.sucursal_id}`, id_sucursal: sucRes.sucursal_id, sinOperador: true });
    }
  }

  return ops.map(op => {
    const sucRes = sucResultados.find(s => s.sucursal_id === op.id_sucursal);
    if (!sucRes) return null;

    const cat           = sucRes.categoria;
    const tieneEfectivo = sucRes.tiene_efectivo;
    const conEscalon    = sucRes.escalon_consumo;
    const efEscalon     = sucRes.escalon_efectivo;
    const seccion       = tieneEfectivo ? 'OPER_CON_EFECT' : 'OPER_SIN_EFECT';

    // ── Indicadores G, O, R ──────────────────────────────────────────
    const datCon = datosConsumo?.find(d => d.sucursal_id === op.id_sucursal);
    const objCon = objConsumo?.find(d => d.sucursal_id === op.id_sucursal);

    // G: VTA/VTATOT real (viene en %, ej: 50.27) vs objetivo participacion (decimal, ej: 0.485)
    const G = (objCon?.participacion   > 0) ? ((datCon?.vta_vta_tot       ?? 0) / 100 - objCon.participacion) / objCon.participacion : -1;
    const O = (objCon?.credito_promedio > 0) ? ((datCon?.credito_promedio  ?? 0) - objCon.credito_promedio) / objCon.credito_promedio : -1;
    const R = (objCon?.operaciones      > 0) ? ((datCon?.operaciones       ?? 0) - objCon.operaciones)      / objCon.operaciones      : -1;

    // ── Helper: siempre busca la fila base cat C; mult se aplica al final ──
    const getRow = (esc) =>
      montos.find(m => m.seccion === seccion && m.escalon === esc && m.categoria_suc === 'C');

    // ── CALCULO CONSUMO (base cat C) ──────────────────────────────────
    let calcConsumo;
    if (conEscalon === 0) {
      // No llegó al escalón 1, pero dentro de la tolerancia → solo participacion del esc1
      calcConsumo = (G > -0.04) ? (getRow(1)?.participacion ?? 0) : 0;
    } else {
      const row = getRow(conEscalon);
      calcConsumo = row?.escalon_monto ?? 0;        // C: siempre
      if (G > -0.04) {                               // G es la puerta: sin participación no hay O ni R
        calcConsumo += row?.participacion   ?? 0;   // B
        if (O > -0.04) calcConsumo += row?.ticket_promedio ?? 0;  // E
        if (R > -0.04) calcConsumo += row?.operacion       ?? 0;  // F
      }
    }

    // ── CALCULO EFECTIVO (base cat C) ────────────────────────────────
    let calcEfectivo = 0;
    if (tieneEfectivo && efEscalon > 0) {
      const prestRow =
        montosPrestamaos.find(m => m.tipo === 'suc' && m.escalon === efEscalon && m.categoria_suc === 'C');
      calcEfectivo = prestRow?.monto ?? 0;
    }

    // ── Marcador automático según qué componentes se activan ─────────
    let marcador;
    if (conEscalon === 0) {
      marcador = G > -0.04 ? '%' : 'NO';   // solo participación / nada
    } else {
      marcador = G > -0.04 ? 'SI' : '$$';  // escalón+partic / solo escalón
    }

    // ── Monto final: (consumo + efectivo) × multiplicador de categoría ──
    const mult       = sucRes.multiplicador;
    const monto_full = Math.round((calcConsumo + calcEfectivo) * mult / 1000) * 1000;
    const monto_part = Math.round(monto_full * 0.5 / 1000) * 1000;

    const jornada   = jornadasMap[op.usuario] || 'full';
    const esParcial = jornada === 'part';

    return {
      usuario:          op.usuario,
      nombre:           op.sinOperador ? null : (operadorMap[op.usuario] || op.usuario),
      sin_operador:     op.sinOperador ?? false,
      sucursal_id:      op.id_sucursal,
      sucursal_nombre:  sucRes.sucursal_nombre,
      categoria:        cat,
      tiene_efectivo:   tieneEfectivo,
      tipo_operador:    seccion,
      escalon_consumo:  conEscalon,
      escalon_efectivo: efEscalon,
      ratio_consumo:    sucRes.ratio_consumo  ?? 0,
      ratio_efectivo:   sucRes.ratio_efectivo ?? 0,
      marcador,
      indicador_g:      +G.toFixed(4),
      indicador_o:      +O.toFixed(4),
      indicador_r:      +R.toFixed(4),
      calc_consumo:     calcConsumo,
      calc_efectivo:    calcEfectivo,
      jornada,
      monto_full:       monto_full,
      monto_part:       monto_part,
      monto:            esParcial ? monto_part : monto_full,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.sucursal_id - b.sucursal_id || a.nombre.localeCompare(b.nombre));
}

// ------------------------------------------------------------------
// Calcular comisiones individuales de Encargados Retail
//
//   Solo sucursales < 100. Solo CONSUMO (efectivo ignorado).
//
//   Dos componentes INDEPENDIENTES (ninguno es condición del otro):
//     ESCALÓN:      conEscalon >= 1 → row(conEscalon).escalon_monto
//     PARTICIPACIÓN: G > -0.04      → row(max(conEscalon,1)).participacion
//
//   G = (vta_vta_tot/100 - objConsumo.participacion) / objConsumo.participacion
//   Tolerancia 4%: G > -0.04 (igual que operadores)
//
//   Monto final = (calcEscalon + calcParticip) × mult, redondeado a múltiplos de 1000
//   Siempre full time.
//
//   ctx.encargados   = [{ idEncargado, apellido_nombre, codSucursal }]
//   ctx.datosConsumo = [{ sucursal_id, vta_vta_tot }]
//   ctx.objConsumo   = [{ sucursal_id, participacion }]
//   ctx.montos       = tbl_CoVenAppINDO_Montos
//   sucResultados    = output de calcularTotal()
// ------------------------------------------------------------------
export function calcularEncargados(ctx, sucResultados) {
  const { montos, datosConsumo, objConsumo } = ctx;

  return sucResultados
    .filter(sucRes => sucRes.sucursal_id < 100)
    .map(sucRes => {
      const sucId = sucRes.sucursal_id;
      const cat   = sucRes.categoria;

      // ── Indicador G (participación de mercado) ──────────────────────
      const datCon = datosConsumo?.find(d => d.sucursal_id === sucId);
      const objCon = objConsumo?.find(d => d.sucursal_id === sucId);
      const G = (objCon?.participacion > 0)
        ? ((datCon?.vta_vta_tot ?? 0) / 100 - objCon.participacion) / objCon.participacion
        : -1;

      const conEscalon = sucRes.escalon_consumo;

      const getRow = (esc) =>
        montos.find(m => m.seccion === 'ENCARGADO' && m.escalon === esc && m.categoria_suc === cat)
        || montos.find(m => m.seccion === 'ENCARGADO' && m.escalon === esc && m.categoria_suc === 'C');

      // ── Componente escalón (independiente de G) ─────────────────────
      const calcEscalon = conEscalon >= 1 ? (getRow(conEscalon)?.escalon_monto ?? 0) : 0;

      // ── Componente participación (independiente de escalón) ─────────
      const calcParticip = G > -0.04 ? (getRow(Math.max(conEscalon, 1))?.participacion ?? 0) : 0;

      // Los valores de la tabla Montos ya están guardados por categoría (categoria_suc),
      // es decir ya incluyen el factor de la categoría. NO multiplicar de nuevo por `mult`.
      const monto = Math.round((calcEscalon + calcParticip) / 1000) * 1000;

      return {
        sucursal_id:     sucId,
        sucursal_nombre: sucRes.sucursal_nombre,
        categoria:       cat,
        escalon_consumo: conEscalon,
        ratio_consumo:   sucRes.ratio_consumo,
        indicador_g:     +G.toFixed(4),
        llega_escalon:   conEscalon >= 1,
        llega_particip:  G > -0.04,
        calc_escalon:    calcEscalon,
        calc_particip:   calcParticip,
        monto,
      };
    })
    .sort((a, b) => a.sucursal_id - b.sucursal_id);
}

// ------------------------------------------------------------------
// Calcular comisiones individuales de Operadores Millón
//
//   Lógica simplificada frente a Retail:
//     - Solo efectivo: vta = total_importe del cache de REPORTE (sp_ReporteOriginacionesCreditos)
//     - Objetivo individual = obj_efectivo.primer_escalon / n_operadores_activos (es_operador=true)
//     - ratio = vta_efectivo / obj_individual
//     - escalon = getEscalon(ratio) — misma tolerancia 4% que retail
//     - monto = montosPrestamaos[tipo='suc', escalon] × multiplicador categoría
//     - Sin indicadores G/O/R, sin consumo, sin participación
//
//   ctx.cacheRows       = [{sucursal_id, sucursal, operador, total_importe}]  (MillonCache)
//   ctx.objEfectivo     = [{sucursal_id, primer_escalon}]
//   ctx.operadoresMillon = [{sucursal_id, operador, es_operador}]
//   ctx.sucursalesMillon = [{id, nombre}] (id >= 100)
//   ctx.montosPrestamaos = tbl_CoVenAppINDO_MontosPrestamos
//   ctx.rankingMap       = { sucursal_id: {categoria} }
//   ctx.multiplicadores  = tbl_CoVenAppINDO_RankingMultiplicador
//   ctx.jornadasMap      = { USUARIO: 'full'|'part' }
//   ctx.operadorMap      = { USUARIO: 'Nombre Completo' }
// ------------------------------------------------------------------
export function calcularOperadoresMillon(ctx) {
  const {
    cacheRows,
    objEfectivo,
    operadoresMillon,
    sucursalesMillon,
    montosPrestamaos,
    rankingMap,
    multiplicadores,
    jornadasMap = {},
    operadorMap = {},
  } = ctx;

  const multMap = {};
  for (const m of multiplicadores) multMap[m.categoria] = m.multiplicador;

  // Operadores explícitamente desactivados (es_operador=false) para este período.
  // Los que no tienen fila se tratan como activos (valor por defecto = true).
  const excludedSet = new Set();
  for (const op of operadoresMillon) {
    if (!op.es_operador) excludedSet.add(`${op.sucursal_id}|${op.operador}`);
  }

  // Base: todos los operadores del cache que no están explícitamente excluidos
  const baseRows = cacheRows.filter(
    row => !excludedSet.has(`${row.sucursal_id}|${row.operador}`)
  );

  // Conteo de operadores activos por sucursal (para dividir el objetivo)
  const nOpsBySuc = {};
  for (const row of baseRows)
    nOpsBySuc[row.sucursal_id] = (nOpsBySuc[row.sucursal_id] || 0) + 1;

  return baseRows.map(row => {
    const suc = sucursalesMillon.find(s => s.id === row.sucursal_id);
    if (!suc) return null;

    const rk   = rankingMap[row.sucursal_id] || { categoria: 'C' };
    const cat  = rk.categoria || 'C';
    const mult = multMap[cat] || 1.0;

    const objSuc      = objEfectivo.find(o => o.sucursal_id === row.sucursal_id);
    const objSucValor = objSuc?.primer_escalon || 0;

    // Si no hay marcados como operador, usar 1 para no dividir por cero
    const nOps        = nOpsBySuc[row.sucursal_id] || 1;
    const objIndiv    = objSucValor > 0 ? objSucValor / nOps : 0;

    const vtaEfectivo = row.total_importe || 0;
    const ratio       = objIndiv > 0 ? vtaEfectivo / objIndiv : 0;
    const escalon     = getEscalon(ratio);

    const prestRow =
      montosPrestamaos.find(m => m.tipo === 'suc' && m.escalon === escalon && m.categoria_suc === cat)
      || montosPrestamaos.find(m => m.tipo === 'suc' && m.escalon === escalon && m.categoria_suc === 'C');
    const monto_full = prestRow?.monto ?? 0;
    const monto_part = Math.round(monto_full * 0.5 / 1000) * 1000;

    const jornada   = jornadasMap[row.operador] || 'full';
    const esParcial = jornada === 'part';

    return {
      usuario:         row.operador,
      nombre:          operadorMap[row.operador] || row.operador,
      sucursal_id:     row.sucursal_id,
      sucursal_nombre: suc.nombre,
      categoria:       cat,
      vta_efectivo:    +vtaEfectivo.toFixed(2),
      obj_sucursal:    objSucValor,
      n_operadores:    nOps,
      obj_individual:  +objIndiv.toFixed(2),
      ratio:           +ratio.toFixed(4),
      escalon,
      comisiona:       escalon >= 1,
      jornada,
      monto_full,
      monto_part,
      monto:           esParcial ? monto_part : monto_full,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.sucursal_id - b.sucursal_id || a.nombre.localeCompare(b.nombre));
}

// ------------------------------------------------------------------
// Calcular comisiones de Encargados Millón
//
//   Una fila por sucursal Millón (id >= 100). Solo EFECTIVO, sin
//   indicador de participación (a diferencia de Encargados Retail):
//
//     escalon_efectivo >= 1  →  row(escalon_efectivo).escalon_monto
//     escalon_efectivo == 0  →  0
//
//   Los montos de la sección ENC_MILLON ya están guardados por
//   categoría (igual que ENCARGADO) — no se multiplica de nuevo
//   por el multiplicador de categoría.
//
//   ctx.montos    = tbl_CoVenAppINDO_Montos
//   sucResultados = output de calcularTotal()
// ------------------------------------------------------------------
export function calcularEncargadosMillon(ctx, sucResultados) {
  const { montos } = ctx;

  return sucResultados
    .filter(sucRes => sucRes.sucursal_id >= 100)
    .map(sucRes => {
      const sucId = sucRes.sucursal_id;
      const cat   = sucRes.categoria;
      const efEscalon = sucRes.escalon_efectivo;

      const getRow = (esc) =>
        montos.find(m => m.seccion === 'ENC_MILLON' && m.escalon === esc && m.categoria_suc === cat)
        || montos.find(m => m.seccion === 'ENC_MILLON' && m.escalon === esc && m.categoria_suc === 'C');

      const calcMonto = efEscalon >= 1 ? (getRow(efEscalon)?.escalon_monto ?? 0) : 0;
      const monto = Math.round(calcMonto / 1000) * 1000;

      return {
        sucursal_id:      sucId,
        sucursal_nombre:  sucRes.sucursal_nombre,
        categoria:        cat,
        escalon_efectivo: efEscalon,
        ratio_efectivo:   sucRes.ratio_efectivo,
        llega_escalon:    efEscalon >= 1,
        monto,
      };
    })
    .sort((a, b) => a.sucursal_id - b.sucursal_id);
}

// ------------------------------------------------------------------
// Calcular comisiones individuales de Supervisores
//   ctx.supervisores         = [{ id, nombre }]
//   ctx.supervisorSucursales = [{ supervisor_id, sucursal_id }]
//   sucResultados            = output de calcularTotal()
//
//   "Llegar a comisionar" en una sucursal = pagó el escalón 1 (consumo si no
//   tiene efectivo, efectivo si sí tiene) — mismo criterio que ya calcula
//   calcularTotal() por sucursal, sin recalcular nada de cero.
//
//   $ por sucursal: se paga por sucursal asignada SOLO si esa sucursal llegó.
//   $ por plaza: la plaza es la PROVINCIA. Se paga un monto fijo único (la
//   tabla MontosSupervisor tiene el mismo valor en A/B/C para tipo='por_plaza',
//   por eso se toma siempre la fila 'C' como referencia) una vez por cada
//   provincia donde TODAS las sucursales asignadas al supervisor llegaron a
//   comisionar. Si al menos una no llegó, esa plaza no paga nada.
// ------------------------------------------------------------------
export function calcularSupervisores(ctx, sucResultados) {
  const { supervisores, supervisorSucursales, montosSupervisor } = ctx;

  const plazaConsumido = _getMontoSup(montosSupervisor, 'consumo',  'por_plaza', 'C');
  const plazaEfectivo  = _getMontoSup(montosSupervisor, 'efectivo', 'por_plaza', 'C');
  const factorPlaza    = montosSupervisor.find(m => m.tipo === 'por_plaza' && m.categoria_suc === 'C')?.factor_plaza || 1;
  const montoPorPlaza  = +((plazaConsumido + plazaEfectivo) * factorPlaza).toFixed(2);

  return supervisores
    .filter(s => s.activo)
    .map(sup => {
      const asigs = supervisorSucursales.filter(ss => ss.supervisor_id === sup.id);
      if (!asigs.length) return {
        id: sup.id, nombre: sup.nombre, sucursales: [], plazas: [],
        total_por_sucursales: 0, total_por_plaza: 0, monto: 0
      };

      const sucDetails = [];
      const llegadasPorProvincia = {};
      let totalPorSucursales = 0;

      for (const asig of asigs) {
        const sucRes = sucResultados.find(s => s.sucursal_id === asig.sucursal_id);
        if (!sucRes) continue;
        const cat = sucRes.categoria;
        const escalon = sucRes.tiene_efectivo ? sucRes.escalon_efectivo : sucRes.escalon_consumo;
        const llego = escalon >= 1;

        // Los montos de MontosSupervisor (tipo='por_sucursal') ya están guardados por
        // categoría — no se multiplica de nuevo por `mult` (mismo fix que Encargados).
        const porSucConsumido = _getMontoSup(montosSupervisor, 'consumo', 'por_sucursal', cat);
        const porSucEfectivo  = _getMontoSup(montosSupervisor, 'efectivo', 'por_sucursal', cat);
        const subtotal = llego ? +(porSucConsumido + porSucEfectivo).toFixed(2) : 0;
        totalPorSucursales += subtotal;

        const provincia = sucRes.provincia || 'SIN PROVINCIA';
        (llegadasPorProvincia[provincia] ??= []).push(llego);

        sucDetails.push({
          sucursal_id:     sucRes.sucursal_id,
          sucursal_nombre: sucRes.sucursal_nombre,
          categoria:       cat,
          provincia,
          escalon,
          llego,
          monto_por_suc:   subtotal
        });
      }

      const plazas = Object.entries(llegadasPorProvincia).map(([provincia, llegadas]) => {
        const cumplida = llegadas.every(Boolean);
        return { provincia, cumplida, monto: cumplida ? montoPorPlaza : 0 };
      });
      const totalPorPlaza = +plazas.reduce((s, p) => s + p.monto, 0).toFixed(2);
      const monto = +(totalPorSucursales + totalPorPlaza).toFixed(2);

      return {
        id:                    sup.id,
        nombre:                sup.nombre,
        sucursales:            sucDetails,
        plazas,
        total_por_sucursales:  +totalPorSucursales.toFixed(2),
        total_por_plaza:       totalPorPlaza,
        monto
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}
