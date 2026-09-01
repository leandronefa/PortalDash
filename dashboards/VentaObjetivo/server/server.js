require('dotenv').config();
const path = require('path');
const express = require('express');
const sql = require('mssql');
const {
  GRILLA, OBJETIVO_MES, SUCURSALES, COD_SUCURSAL_CON_VENTAS, SUCURSALES_ACTIVAS_RECIENTES,
  OBJETIVOS_DEL_MES, DIAS_MARGEN_DEL_MES, MESES_CON_OBJETIVO, DELETE_OBJETIVO, SUPERVISORES, SUCURSALES_DE_ENCARGADO,
  UPDATE_DIAS_MES, UPDATE_MARGEN_MES, INSERT_OBJETIVO, UPDATE_OBJETIVO,
  DELETE_TEMP_BI_APP_FILA, INSERT_TEMP_BI_APP_FILA, EXEC_SP_DASHBOARD
} = require('./consultas');
const { crearStoreObjetivos } = require('./objetivos-store');

const PORT = Number(process.env.PORT || 3016);
const HOST = process.env.HOST || '127.0.0.1';
const ANIOMES_DESDE = Number(process.env.ANIOMES_DESDE || 201401);
const TTL_CERRADO_MS = Number(process.env.TTL_CERRADO_MIN || 720) * 60 * 1000;
const TTL_ABIERTO_MS = Number(process.env.TTL_ABIERTO_MIN || 5) * 60 * 1000;
const TTL_SUCURSALES_MS = 60 * 60 * 1000;

const NOMBRES_MES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// "Calz SJ LIQUIDACION": no es una boca real, se saca de todo el tablero.
const SUCURSALES_ELIMINADAS = new Set(['14']);
// Sucursales que existen y venden, pero no cargan objetivo (pedido del usuario).
const SUCURSALES_SIN_OBJETIVO = new Set(['01']);

const store = crearStoreObjetivos({ dir: path.join(__dirname, '..', 'data-store') });
const storeMargenes = crearStoreObjetivos({ dir: path.join(__dirname, '..', 'data-store'), prefix: 'margenes' });
// Ajuste de margen a nivel grupo (Pueblo/Tesi) — un solo valor para todas
// sus sucursales, editable desde arriba de la pestaña Totales. Digitales
// sigue con su ajuste por sucursal (storeMargenes, campo ajusteMargen).
const storeAjusteGrupo = crearStoreObjetivos({ dir: path.join(__dirname, '..', 'data-store'), prefix: 'ajuste-grupo' });

// Canales web/MeLi: grupo aparte "WEB", con su propio ajuste de margen — no
// se cuentan dentro de PUEBLO/TESI aunque su empresa nominal sea esa.
const CANALES_WEB = new Set(['E1', 'E2', 'WE1', 'WE2', 'FK1']);
// Ajuste fijo (Total → Total ajustado), mismos valores ya validados en
// tablero-objetivos-web para este tipo de corrección de margen.
const AJUSTE_MARGEN = { PUEBLO: 0.015, TESI: 0, WEB: 0.01 };

/* Supervisores (28/08/2026): estos 6 usuarios del portal ven SOLO sus
   sucursales asignadas (TABLEROS.EncargadosSucursalObjetivos) — el resto
   de los usuarios sigue la lógica de siempre (vallejo/admin edita, el
   resto ve todo). El username del portal coincide (case-insensitive) con
   el NombreApellido real de la tabla — confirmado con el usuario, no es
   una convención general. */
const SUPERVISORES_RESTRINGIDOS = {
  lejarque: 'LEjarque',
  hmoran: 'HMoran',
  bjorda: 'BJorda',
  eelizondo: 'EElizondo',
  jrusnak: 'JRusnak',
  gastong: 'GastonG'
};

function log(nivel, msg) {
  console.log(`${new Date().toISOString()} [${nivel}] ${msg}`);
}

function mesActualAAAAMM() {
  const d = new Date();
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

/* El mes editable es SIEMPRE el siguiente al actual — nunca el mes en curso,
   nunca uno pasado, nunca dos meses adelante. Sigue el reloj del servidor.
   OJO: d.setMonth(d.getMonth()+1) sobre un Date de hoy se rompe el último
   día de cualquier mes de 31 cuyo mes siguiente tenga menos días (ej. 31 de
   agosto → intenta "31 de septiembre", que no existe, y JS lo desborda a 1
   de octubre) — construir con día 1 evita el desborde. */
function mesObjetivoAAAAMM() {
  const d = new Date();
  const siguiente = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return siguiente.getFullYear() * 100 + (siguiente.getMonth() + 1);
}

const cfgBase = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === '1',
    trustServerCertificate: process.env.DB_TRUST_CERT !== '0'
  },
  pool: { max: Number(process.env.DB_POOL_MAX || 6) },
  connectionTimeout: Number(process.env.DB_TIMEOUT_MS || 60000),
  requestTimeout: Number(process.env.DB_TIMEOUT_MS || 60000)
};

let poolTableros = null;
let poolDwVallejo = null;
let poolCegid = null;

async function getPoolTableros() {
  if (!poolTableros) {
    poolTableros = await new sql.ConnectionPool({ ...cfgBase, database: process.env.DB_DATABASE_TABLEROS }).connect();
  }
  return poolTableros;
}

async function getPoolDwVallejo() {
  if (!poolDwVallejo) {
    poolDwVallejo = await new sql.ConnectionPool({ ...cfgBase, database: process.env.DB_DATABASE_DWVALLEJO }).connect();
  }
  return poolDwVallejo;
}

/* Sólo para EXEC_SP_DASHBOARD: el parámetro @ajustes es un tipo de tabla
   (TVP) creado en db_Cegid — SQL Server resuelve ese tipo contra la base
   "actual" de la conexión, así que el EXEC tiene que hacerse con la
   conexión posicionada en db_Cegid (no alcanza con calificarlo como
   "db_Cegid.dbo.SP_..." desde una conexión a dw_vallejo). */
async function getPoolCegid() {
  if (!poolCegid) {
    poolCegid = await new sql.ConnectionPool({ ...cfgBase, database: 'db_Cegid' }).connect();
  }
  return poolCegid;
}

/* ── Sucursales (nombre real, mismo criterio que tablero-objetivos-web) ──── */
let cacheSucursales = { data: null, ts: 0 };

async function cargarCodSucursalConVentas() {
  const pool = await getPoolTableros();
  const r = await pool.request().query(COD_SUCURSAL_CON_VENTAS);
  return new Set(r.recordset.map((row) => row.cod_sucursal));
}

async function cargarSucursales() {
  const [pool, codsConVentas] = await Promise.all([getPoolDwVallejo(), cargarCodSucursalConVentas()]);
  const r = await pool.request().query(SUCURSALES);
  // Excluye INDO/liquidación/adheridos: existen en l_sucursal pero facturan
  // por otro sistema y nunca tienen fila en GrillaVentasComparativas.
  return r.recordset.filter((s) => codsConVentas.has(s.cod_sucursal) && !SUCURSALES_ELIMINADAS.has(s.cod_sucursal));
}

async function obtenerSucursalesCacheadas() {
  if (cacheSucursales.data && Date.now() - cacheSucursales.ts < TTL_SUCURSALES_MS) {
    return cacheSucursales.data;
  }
  const data = await cargarSucursales();
  cacheSucursales = { data, ts: Date.now() };
  return data;
}

/* ── Sucursales activas recientes (dinámico, sólo para el universo de
   OBJETIVOS — ver consultas.js) ──────────────────────────────────────────── */
let cacheSucursalesActivas = { data: null, ts: 0 };

async function cargarSucursalesActivasRecientes() {
  const pool = await getPoolTableros();
  const r = await pool.request().query(SUCURSALES_ACTIVAS_RECIENTES);
  return new Set(r.recordset.map((row) => row.cod_sucursal));
}

async function obtenerSucursalesActivasRecientes() {
  if (cacheSucursalesActivas.data && Date.now() - cacheSucursalesActivas.ts < TTL_SUCURSALES_MS) {
    return cacheSucursalesActivas.data;
  }
  const data = await cargarSucursalesActivasRecientes();
  cacheSucursalesActivas = { data, ts: Date.now() };
  return data;
}

/* ── Sucursales de un supervisor puntual (caché por nombre, cambia poco) ──── */
const cacheSucursalesSupervisor = new Map();

async function obtenerSucursalesDeSupervisor(nombreEncargado) {
  const cacheado = cacheSucursalesSupervisor.get(nombreEncargado);
  if (cacheado && Date.now() - cacheado.ts < TTL_SUCURSALES_MS) return cacheado.data;

  const pool = await getPoolTableros();
  const req = pool.request();
  req.input('nombre', sql.VarChar(200), nombreEncargado);
  const r = await req.query(SUCURSALES_DE_ENCARGADO);
  const data = new Set(r.recordset.map((row) => row.cod_sucursal));
  cacheSucursalesSupervisor.set(nombreEncargado, { data, ts: Date.now() });
  return data;
}

/* Devuelve null (sin restricción) o el Set de cod_sucursal permitidas para
   el usuario de esta request — sólo los 6 supervisores de arriba tienen
   restricción; todos los demás (incluido vallejo/admin) ven todo. */
async function sucursalesPermitidas(req) {
  const nombreEncargado = SUPERVISORES_RESTRINGIDOS[usuarioDe(req).toLowerCase()];
  if (!nombreEncargado) return null;
  return obtenerSucursalesDeSupervisor(nombreEncargado);
}

/* ── Caché en memoria de /api/grilla ──────────────────────────────────────── */
let cache = { data: null, ts: 0, mesAbierto: null };

function cacheVigente() {
  if (!cache.data) return false;
  const ttl = cache.mesAbierto === mesActualAAAAMM() ? TTL_ABIERTO_MS : TTL_CERRADO_MS;
  return Date.now() - cache.ts < ttl;
}

async function cargarGrilla() {
  const pool = await getPoolTableros();
  const req = pool.request();
  req.input('anioMesDesde', sql.Int, ANIOMES_DESDE);
  const r = await req.query(GRILLA);
  return r.recordset;
}

async function cargarObjetivoMesActual(anioMes) {
  const pool = await getPoolDwVallejo();
  const req = pool.request();
  req.input('anioMes', sql.Int, anioMes);
  const r = await req.query(OBJETIVO_MES);
  return r.recordset;
}

function filaObjetivoDesde(obj, anioMes, infoSucursal) {
  const anio = Math.floor(anioMes / 100);
  const mes = anioMes % 100;
  const info = infoSucursal || {};
  return {
    AñoMes: String(anioMes),
    Empresa: info.empresa || null,
    cod_sucursal: obj.cod_sucursal,
    desc_sucursal2: info.nombre || obj.cod_sucursal,
    anio,
    mes,
    nombreMes: NOMBRES_MES[mes],
    vta_neta: null,
    unidades_vta: null,
    margen_pesos: null,
    ventas_sin_iva: null,
    cant_operaciones: null,
    ticketPromIVA: null,
    unidadCliente: null,
    ventas_ano_anterior: null,
    unidades_vta_anterior: null,
    margen_pesos_anterior: null,
    cant_operaciones_anterior: null,
    ticketPromIVA_anterior: null,
    unidadCliente_anterior: null,
    cumplimiento2: null,
    obj_vtas_sin_iva: obj.obj_vtas_sin_iva,
    obj_vta_neta: obj.obj_vtas_con_iva,
    obj_operaciones: obj.obj_operaciones,
    obj_unidades_vtas: obj.obj_unidades_vtas,
    obj_unidades_clientes: obj.obj_unidades_clientes,
    obj_ticket_promedio: obj.obj_ticket_promedio,
    esObjetivo: true
  };
}

async function construirRespuesta() {
  const anioMesActual = mesActualAAAAMM();
  let [filasReales, filasObjetivo, sucursales] = await Promise.all([
    cargarGrilla(),
    cargarObjetivoMesActual(anioMesActual).catch((e) => {
      log('warn', `objetivo mes actual (${anioMesActual}) falló: ${e.message}`);
      return [];
    }),
    obtenerSucursalesCacheadas().catch((e) => {
      log('warn', `sucursales falló: ${e.message}`);
      return [];
    })
  ]);
  filasReales = filasReales.filter((f) => !SUCURSALES_ELIMINADAS.has(f.cod_sucursal));
  filasObjetivo = filasObjetivo.filter((o) => !SUCURSALES_ELIMINADAS.has(o.cod_sucursal));

  const nombrePorCod = new Map(sucursales.map((s) => [s.cod_sucursal, s]));

  for (const f of filasReales) {
    f.esObjetivo = false;
    const s = nombrePorCod.get(f.cod_sucursal);
    if (s) f.desc_sucursal2 = s.nombre;
  }

  const infoPorSucursal = new Map();
  for (const f of filasReales) {
    infoPorSucursal.set(f.cod_sucursal, { nombre: f.desc_sucursal2, empresa: f.Empresa });
  }
  for (const s of sucursales) {
    if (!infoPorSucursal.has(s.cod_sucursal)) {
      infoPorSucursal.set(s.cod_sucursal, { nombre: s.nombre, empresa: s.empresa });
    }
  }

  const filasObjetivoCompletas = filasObjetivo
    .filter(() => !filasReales.some((f) => Number(f.AñoMes) === anioMesActual))
    .map((o) => filaObjetivoDesde(o, anioMesActual, infoPorSucursal.get(o.cod_sucursal)));

  return {
    filas: [...filasReales, ...filasObjetivoCompletas],
    anioMesActual,
    recarga: new Date().toISOString()
  };
}

async function obtenerGrillaCacheada() {
  if (cacheVigente()) return cache.data;
  const data = await construirRespuesta();
  cache = { data, ts: Date.now(), mesAbierto: data.anioMesActual };
  return data;
}

/* ── Objetivos del mes que viene ──────────────────────────────────────────── */
async function cargarObjetivosDelMesDb(mes) {
  const pool = await getPoolDwVallejo();
  const req = pool.request();
  req.input('mes', sql.Int, mes);
  const r = await req.query(OBJETIVOS_DEL_MES);
  return new Map(r.recordset.map((row) => [row.id_sucursal, row]));
}

/* Días Venta/Margen % ya guardados de verdad — se usa como fallback cuando
   una sucursal ya se guardó (GUARDAR OBJETIVOS) y el borrador local, que es
   lo único que leía Totales antes, ya se borró (ver construirVistaMargenes). */
async function cargarDiasMargenDelMesDb(mes) {
  const pool = await getPoolDwVallejo();
  const req = pool.request();
  req.input('mes', sql.Int, mes);
  const r = await req.query(DIAS_MARGEN_DEL_MES);
  return new Map(r.recordset.map((row) => [row.id_sucursal, row]));
}

/* ── Meses con objetivo cargado (para el selector de Totales) ─────────────── */
let cacheMesesConObjetivo = { data: null, ts: 0 };

async function obtenerMesesConObjetivoCacheados() {
  if (cacheMesesConObjetivo.data && Date.now() - cacheMesesConObjetivo.ts < TTL_SUCURSALES_MS) {
    return cacheMesesConObjetivo.data;
  }
  const pool = await getPoolDwVallejo();
  const r = await pool.request().query(MESES_CON_OBJETIVO);
  // Filtra basura de pruebas viejas (ej. 999999, 190001) que haya quedado
  // en f_objetivos — nada legítimo cae fuera de [ANIOMES_DESDE, mes editable].
  const tope = mesObjetivoAAAAMM();
  const data = r.recordset.map((row) => row.id_mes).filter((m) => m >= ANIOMES_DESDE && m <= tope);
  cacheMesesConObjetivo = { data, ts: Date.now() };
  return data;
}

function calcular(valores) {
  const uniXCli = Number(valores.uniXCli);
  const tktProm = Number(valores.tktProm);
  const operaciones = Number(valores.operaciones);
  const unidades = uniXCli * operaciones;
  const ventaConIva = tktProm * operaciones;
  const ventaSinIva = ventaConIva / 1.21;
  return { uniXCli, tktProm, operaciones, unidades, ventaConIva, ventaSinIva };
}

/* "cargado" ahora exige objetivo (Operaciones/Tkt Prom/Uni x Cli, pestaña
   Comparativas) Y días/margen (pestaña Por Empresa): el SP que arma la fila
   real necesita las dos partes juntas (TEMP_BI_APP no admite Margen/DIAS en
   NULL con sentido). `valores` sigue reflejando sólo el objetivo — la celda
   editable de Comparativas no debe vaciarse aunque falte el margen. */
async function construirVistaObjetivoProximo() {
  const mes = mesObjetivoAAAAMM();
  const [sucursales, draft, dbRows, draftMargenes, dbDiasMargen, activasRecientes] = await Promise.all([
    obtenerSucursalesCacheadas(),
    Promise.resolve(store.leer(mes)),
    cargarObjetivosDelMesDb(mes),
    Promise.resolve(storeMargenes.leer(mes)),
    cargarDiasMargenDelMesDb(mes).catch((e) => {
      log('warn', `días/margen guardados falló, no hay fallback a lo ya guardado: ${e.message}`);
      return new Map();
    }),
    obtenerSucursalesActivasRecientes().catch((e) => {
      log('warn', `sucursales activas recientes falló, no se filtra por eso: ${e.message}`);
      return null;
    })
  ]);

  const filas = sucursales
    .filter((s) => !SUCURSALES_SIN_OBJETIVO.has(s.cod_sucursal))
    .filter((s) => !activasRecientes || activasRecientes.has(s.cod_sucursal))
    .map((s) => {
    const enDb = dbRows.get(s.id_sucursal);
    const enDraft = draft[s.cod_sucursal];
    let valores = null;
    let origen = null;
    if (enDraft) {
      valores = calcular(enDraft);
      origen = 'borrador';
    } else if (enDb) {
      valores = calcular({
        uniXCli: enDb.obj_unidades_clientes,
        tktProm: enDb.obj_ticket_promedio,
        operaciones: enDb.obj_operaciones
      });
      origen = 'guardado';
    }
    const m = draftMargenes[s.cod_sucursal] || {};
    // Si ya se guardó de verdad y no queda nada en el borrador de márgenes,
    // se recupera de la base — si no, "completo" se apagaba solo apenas se
    // guardaba (GUARDAR OBJETIVOS borra el borrador), aunque las 5 cosas
    // ya estaban bien guardadas (28/08/2026).
    const guardadoDb = origen === 'guardado' ? dbDiasMargen.get(s.id_sucursal) : null;
    const diasVenta = m.diasVenta != null ? Number(m.diasVenta) : (guardadoDb ? Number(guardadoDb.dias_venta) : null);
    const margenPct = m.margenPct != null ? Number(m.margenPct) : (guardadoDb ? Number(guardadoDb.margen_pct) : null);
    return {
      cod_sucursal: s.cod_sucursal,
      id_sucursal: s.id_sucursal,
      nombre: s.nombre,
      empresa: s.empresa,
      objetivoCargado: !!valores,
      diasVenta,
      margenPct,
      // "cargado" = sólo el objetivo (lo que ve Cargar/Editar Objetivos).
      // "completo" = las 5 cosas juntas — lo que de verdad exige GUARDAR,
      // porque el SP necesita Margen y Días sí o sí.
      cargado: !!valores,
      completo: !!valores && diasVenta != null && margenPct != null,
      origen,
      valores
    };
  });

  const totalUniverso = filas.length;
  const totalCargadas = filas.filter((f) => f.cargado).length;
  const totalCompletas = filas.filter((f) => f.completo).length;

  return {
    mes,
    mesNombre: `${NOMBRES_MES[mes % 100]} ${Math.floor(mes / 100)}`,
    sucursales: filas,
    totalUniverso,
    totalCargadas,
    totalCompletas,
    listoParaGuardar: totalUniverso > 0 && totalCompletas === totalUniverso
  };
}

/* ── Sugerencia de objetivos (27/08/2026) ─────────────────────────────────
   Propone Operaciones/Tkt Prom/Uni x Cli por sucursal para el mes que viene,
   sólo como punto de partida editable en la pestaña "Sugerencia" — no toca
   el borrador real hasta que el usuario confirma.
   - Operaciones: Base (mismo mes, año pasado) × (1 + 0,5 × Tendencia).
     Tendencia = promedio de la variación interanual de los últimos 2 meses
     cerrados (si el segundo punto es mayor que el primero, el negocio viene
     acelerando). Se probó además un factor "Sesgo" (real/objetivo de los
     últimos meses, para corregir sub/sobreestimación histórica al cargar)
     pero contra lo que TESI ya cargó a mano para septiembre da MUCHO peor
     (grid search sobre las 17 sucursales cargadas: MAPE 16% con Sesgo activo
     vs 3,4% sin él) — Tendencia y Sesgo miden en la práctica lo mismo (una
     sucursal que viene cayendo respecto al año pasado también viene por
     debajo de su objetivo reciente), así que multiplicarlas duplica el
     castigo/premio en vez de corregir algo nuevo. El peso 0,5 en Tendencia
     (en vez de 1) también salió del mismo ajuste — el directivo se ancla
     fuerte en "mismo mes año pasado" y sólo matiza la mitad de la tendencia
     reciente, no la aplica entera.
   - Tkt Prom: promedio simple de los últimos 3 meses cerrados, sin Base ni
     Tendencia — es más estable y no estacional; usar el mismo mes año
     pasado arrastra 12 meses de inflación y empeora la sugerencia (validado
     con datos reales de 24 meses: error medio 7% vs 26%, a favor del
     promedio reciente).
   - Uni x Cli: NO se calcula con venta real — es una política casi fija por
     sucursal (ej. 1,85 en la mayoría de Pueblo/Tesi, 1 en los canales web,
     con alguna sucursal puntual en otro valor) que cambia por decisión, no
     por tendencia de venta. Se toma la **moda** (el valor que más se repite)
     del **objetivo** cargado (`obj_unidades_clientes`) en los últimos 12
     meses cerrados de esa sucursal — reproduce la política vigente y no se
     deja arrastrar por un mes puntual distinto. */
function moda(valores) {
  if (!valores.length) return null;
  const conteo = new Map();
  for (const v of valores) {
    const clave = Math.round(v * 100) / 100;
    conteo.set(clave, (conteo.get(clave) || 0) + 1);
  }
  let mejor = null;
  let mejorConteo = 0;
  for (const [valor, veces] of conteo) {
    if (veces > mejorConteo) { mejor = valor; mejorConteo = veces; }
  }
  return mejor;
}

function calcularSugerenciaSucursal(filasSucursal, anioObjetivo, mesObjetivo) {
  const porAnioMes = new Map(filasSucursal.map((f) => [f.anio * 100 + f.mes, f]));
  const real = (a, m) => porAnioMes.get(a * 100 + m) || null;

  const ordenadas = filasSucursal.slice().sort((a, b) => (b.anio * 100 + b.mes) - (a.anio * 100 + a.mes));
  const recientes = ordenadas.slice(0, 3);
  if (recientes.length < 3) return null;

  const base = real(anioObjetivo - 1, mesObjetivo);
  if (!base || !base.cant_operaciones) return null;

  const variacionInteranual = (f) => {
    const ant = real(f.anio - 1, f.mes);
    if (!ant || !ant.cant_operaciones) return null;
    return f.cant_operaciones / ant.cant_operaciones - 1;
  };
  const variaciones = [recientes[0], recientes[1]].map(variacionInteranual).filter((v) => v != null);
  const tendencia = variaciones.length ? variaciones.reduce((s, v) => s + v, 0) / variaciones.length : 0;

  const promedio = (campo) => recientes.reduce((s, f) => s + (f[campo] || 0), 0) / recientes.length;

  const uniXCliObjetivo = ordenadas.slice(0, 12).map((f) => f.obj_unidades_clientes).filter((v) => v != null);
  const uniXCli = moda(uniXCliObjetivo) ?? promedio('unidadCliente');

  return {
    operaciones: Math.round(base.cant_operaciones * (1 + 0.5 * tendencia)),
    tktProm: promedio('ticketPromIVA'),
    uniXCli,
    tendenciaPct: tendencia
  };
}

async function construirVistaSugerencia() {
  const mes = mesObjetivoAAAAMM();
  const anio = Math.floor(mes / 100);
  const mesNum = mes % 100;
  const [vistaObjetivo, grilla] = await Promise.all([construirVistaObjetivoProximo(), obtenerGrillaCacheada()]);

  const filasPorSucursal = new Map();
  for (const f of grilla.filas) {
    if (f.esObjetivo) continue;
    if (!filasPorSucursal.has(f.cod_sucursal)) filasPorSucursal.set(f.cod_sucursal, []);
    filasPorSucursal.get(f.cod_sucursal).push(f);
  }

  const sucursales = vistaObjetivo.sucursales.map((s) => {
    const propuesta = calcularSugerenciaSucursal(filasPorSucursal.get(s.cod_sucursal) || [], anio, mesNum);
    const sugerido = propuesta
      ? calcular({ uniXCli: propuesta.uniXCli, tktProm: propuesta.tktProm, operaciones: propuesta.operaciones })
      : null;
    const cargado = s.valores;
    let desfasaje = null;
    if (cargado && sugerido) {
      // Uno por campo: unidades = cargado - sugerido, pct = esa diferencia sobre lo sugerido.
      const campos = ['operaciones', 'tktProm', 'uniXCli', 'unidades', 'ventaSinIva'];
      desfasaje = {};
      for (const campo of campos) {
        const dif = cargado[campo] - sugerido[campo];
        desfasaje[campo] = { unidades: dif, pct: sugerido[campo] ? dif / sugerido[campo] : null };
      }
    }
    return {
      cod_sucursal: s.cod_sucursal,
      nombre: s.nombre,
      empresa: s.empresa,
      cargado: s.cargado,
      valoresCargados: cargado,
      sugerido,
      tendenciaPct: propuesta ? propuesta.tendenciaPct : null,
      desfasaje
    };
  });

  return { mes, mesNombre: vistaObjetivo.mesNombre, sucursales };
}

/* ── Supervisores (para "Por Empresa"), caché larga — cambian poco ────────── */
let cacheSupervisores = { data: null, ts: 0 };

async function cargarSupervisores() {
  const pool = await getPoolTableros();
  const r = await pool.request().query(SUPERVISORES);
  return new Map(r.recordset.map((row) => [row.cod_sucursal, row.supervisor]));
}

async function obtenerSupervisoresCacheados() {
  if (cacheSupervisores.data && Date.now() - cacheSupervisores.ts < TTL_SUCURSALES_MS) {
    return cacheSupervisores.data;
  }
  const data = await cargarSupervisores();
  cacheSupervisores = { data, ts: Date.now() };
  return data;
}

/* ── Por Empresa: Días Venta y Margen% a mano, resto viene de lo ya cargado
   en la pestaña de Objetivos. Grupos PUEBLO / TESI / WEB, cada uno con su
   propio ajuste fijo de margen (misma lógica que "PUEBLO - OBJETIVOS VENTA
   2026.xlsx": Total ponderado + ajuste fijo = Objetivo Margen Total). ────── */
function calcularTotalGrupo(filas) {
  const sumObjSinIva = filas.reduce((s, f) => s + f.objetivoSinIva, 0);
  const sumObjConIva = filas.reduce((s, f) => s + f.objetivoConIva, 0);
  const conDiario = filas.filter((f) => f.diarioSinIva != null);
  const sumDiarioSinIva = conDiario.reduce((s, f) => s + f.diarioSinIva, 0);
  const sumDiarioConIva = conDiario.reduce((s, f) => s + f.diarioConIva, 0);
  const sumUnidadesDiarias = conDiario.reduce((s, f) => s + (f.unidadesDiarias || 0), 0);
  const sumOperacionesDiarias = conDiario.reduce((s, f) => s + (f.operacionesDiarias || 0), 0);
  const sumUnidades = filas.reduce((s, f) => s + f.unidades, 0);
  const sumOperaciones = filas.reduce((s, f) => s + f.operaciones, 0);
  const conMargen = filas.filter((f) => f.margenPct != null);
  const sumMargenPesos = conMargen.reduce((s, f) => s + f.margenPesos, 0);
  const margenPct = sumObjSinIva ? sumMargenPesos / sumObjSinIva : 0;
  const uniXOper = sumOperaciones ? sumUnidades / sumOperaciones : 0;
  const tktProm = sumOperaciones ? sumObjConIva / sumOperaciones : 0;
  // Sólo se usa en Digitales, donde el ajuste ya no es un % fijo de grupo
  // sino uno por sucursal: pondera el ajuste propio de cada una.
  const margenPesosAjustadoPorSucursal = conMargen.reduce((s, f) => s + (f.margenPct + (f.ajusteMargen || 0)) * f.objetivoSinIva, 0);
  const margenPctAjustadoPorSucursal = sumObjSinIva ? margenPesosAjustadoPorSucursal / sumObjSinIva : 0;
  return {
    objetivoSinIva: sumObjSinIva,
    objetivoConIva: sumObjConIva,
    diarioSinIva: conDiario.length ? sumDiarioSinIva : null,
    diarioConIva: conDiario.length ? sumDiarioConIva : null,
    unidadesDiarias: conDiario.length ? sumUnidadesDiarias : null,
    operacionesDiarias: conDiario.length ? sumOperacionesDiarias : null,
    unidades: sumUnidades,
    operaciones: sumOperaciones,
    uniXOper,
    tktProm,
    margenPct,
    margenPesos: sumMargenPesos,
    margenPctAjustadoPorSucursal,
    // El % ponderado sólo es exacto si TODAS las sucursales del grupo ya
    // tienen su margen cargado — si falta alguna, es un total parcial.
    completo: filas.length > 0 && conMargen.length === filas.length
  };
}

/* "Totales" para cualquier mes que NO sea el editable (31/08/2026, ajustado
   30/08/2026) — a pedido del usuario, poder ver Agosto/Julio/etc., y que
   SIEMPRE muestre el objetivo cargado para ese mes (no la venta real: eso
   es cosa de Comparativas). Sale 100% de dw_vallejo (f_objetivos +
   f_dias_habiles), nunca de GrillaVentasComparativas — así un mes recién
   cerrado (sin fila real todavía por el ETL) también se puede ver, y un
   mes viejo muestra lo que se había targeteado, no lo que terminó pasando.
   100% solo lectura: no hay borrador, no hay ajuste editable, no hay
   guardado — un mes que no es el editable no se edita nunca, ni para
   vallejo/admin. */
async function construirVistaMargenesParaMes(anioMes) {
  const [sucursales, dbRows, supervisores, dbDiasMargen] = await Promise.all([
    obtenerSucursalesCacheadas().catch(() => []),
    cargarObjetivosDelMesDb(anioMes),
    obtenerSupervisoresCacheados().catch((e) => {
      log('warn', `supervisores falló: ${e.message}`);
      return new Map();
    }),
    cargarDiasMargenDelMesDb(anioMes).catch((e) => {
      log('warn', `días/margen del mes ${anioMes} falló: ${e.message}`);
      return new Map();
    })
  ]);
  const infoPorId = new Map(sucursales.map((s) => [s.id_sucursal, s]));

  const filas = [...dbRows.entries()]
    .filter(([idSucursal]) => infoPorId.has(idSucursal))
    .map(([idSucursal, obj]) => {
      const info = infoPorId.get(idSucursal);
      const grupo = CANALES_WEB.has(info.cod_sucursal) ? 'WEB' : info.empresa;
      const valores = calcular({ uniXCli: obj.obj_unidades_clientes, tktProm: obj.obj_ticket_promedio, operaciones: obj.obj_operaciones });
      const guardadoDb = dbDiasMargen.get(idSucursal);
      const diasVenta = guardadoDb && guardadoDb.dias_venta != null ? Number(guardadoDb.dias_venta) : null;
      const margenPct = guardadoDb && guardadoDb.margen_pct != null ? Number(guardadoDb.margen_pct) : null;
      const objetivoSinIva = valores.ventaSinIva;
      const objetivoConIva = valores.ventaConIva;
      const diarioSinIva = diasVenta ? objetivoSinIva / diasVenta : null;
      const diarioConIva = diarioSinIva != null ? diarioSinIva * 1.21 : null;
      const unidadesDiarias = diasVenta ? valores.unidades / diasVenta : null;
      const operacionesDiarias = diasVenta ? valores.operaciones / diasVenta : null;
      const margenPesos = margenPct != null ? margenPct * objetivoSinIva : null;
      const ajusteGuardado = guardadoDb && guardadoDb.ajuste_usado != null ? Number(guardadoDb.ajuste_usado) : null;
      const ajusteMargen = grupo === 'WEB' ? (ajusteGuardado != null ? ajusteGuardado : AJUSTE_MARGEN.WEB) : null;
      const margenPctAjustadoFila = grupo === 'WEB' && margenPct != null ? margenPct + ajusteMargen : null;
      return {
        cod_sucursal: info.cod_sucursal,
        nombre: info.nombre,
        grupo,
        empresaReal: info.empresa,
        supervisor: supervisores.get(info.cod_sucursal) || null,
        objetivoSinIva,
        objetivoConIva,
        unidades: valores.unidades,
        operaciones: valores.operaciones,
        uniXOper: valores.uniXCli,
        tktProm: valores.tktProm,
        diasVenta,
        margenPct,
        diarioSinIva,
        diarioConIva,
        unidadesDiarias,
        operacionesDiarias,
        margenPesos,
        ajusteMargen,
        margenPctAjustadoFila,
        cargado: diasVenta != null && margenPct != null
      };
    });

  const grupos = {};
  for (const g of ['PUEBLO', 'TESI', 'WEB']) {
    const filasGrupo = filas.filter((f) => f.grupo === g);
    const total = calcularTotalGrupo(filasGrupo);
    const esDigital = g === 'WEB';
    grupos[g] = {
      sucursales: filasGrupo,
      total,
      ajuste: esDigital ? null : AJUSTE_MARGEN[g],
      margenPctAjustado: esDigital ? total.margenPctAjustadoPorSucursal : total.margenPct + AJUSTE_MARGEN[g]
    };
  }

  return {
    mes: anioMes,
    mesNombre: `${NOMBRES_MES[anioMes % 100]} ${Math.floor(anioMes / 100)}`,
    soloLectura: true,
    grupos
  };
}

async function construirVistaMargenes() {
  const mes = mesObjetivoAAAAMM();
  const [vistaObjetivo, supervisores, dbDiasMargen] = await Promise.all([
    construirVistaObjetivoProximo(),
    obtenerSupervisoresCacheados().catch((e) => {
      log('warn', `supervisores falló: ${e.message}`);
      return new Map();
    }),
    cargarDiasMargenDelMesDb(mes).catch((e) => {
      log('warn', `días/margen guardados falló, no hay fallback a lo ya guardado: ${e.message}`);
      return new Map();
    })
  ]);
  const draft = storeMargenes.leer(mes);

  const filas = vistaObjetivo.sucursales
    .filter((s) => s.valores) // sin objetivo cargado no hay venta/unidades que mostrar acá
    .map((s) => {
      const grupo = CANALES_WEB.has(s.cod_sucursal) ? 'WEB' : s.empresa;
      const m = draft[s.cod_sucursal] || {};
      // Si ya se guardó de verdad (GUARDAR OBJETIVOS borra el borrador local)
      // y no queda nada en el borrador, se recupera de la base — si no,
      // Totales quedaba en blanco para Días/Margen apenas se guardaba, y
      // parecía que no se había cargado nada (28/08/2026).
      const guardadoDb = s.origen === 'guardado' ? dbDiasMargen.get(s.id_sucursal) : null;
      const diasVenta = m.diasVenta != null ? Number(m.diasVenta) : (guardadoDb ? Number(guardadoDb.dias_venta) : null);
      const margenPct = m.margenPct != null ? Number(m.margenPct) : (guardadoDb ? Number(guardadoDb.margen_pct) : null);
      const objetivoSinIva = s.valores.ventaSinIva;
      const objetivoConIva = s.valores.ventaConIva;
      const diarioSinIva = diasVenta ? objetivoSinIva / diasVenta : null;
      const diarioConIva = diarioSinIva != null ? diarioSinIva * 1.21 : null;
      const unidadesDiarias = diasVenta ? s.valores.unidades / diasVenta : null;
      const operacionesDiarias = diasVenta ? s.valores.operaciones / diasVenta : null;
      const margenPesos = margenPct != null ? margenPct * objetivoSinIva : null;
      // Sólo Digitales usa ajuste por sucursal (antes era +1% fijo de grupo);
      // Pueblo/Tesi siguen con el ajuste fijo a nivel grupo (AJUSTE_MARGEN).
      const ajusteGuardado = guardadoDb && guardadoDb.ajuste_usado != null ? Number(guardadoDb.ajuste_usado) : null;
      const ajusteMargen = grupo === 'WEB'
        ? (m.ajusteMargen != null ? Number(m.ajusteMargen) : (ajusteGuardado != null ? ajusteGuardado : AJUSTE_MARGEN.WEB))
        : null;
      const margenPctAjustadoFila = grupo === 'WEB' && margenPct != null ? margenPct + ajusteMargen : null;
      return {
        cod_sucursal: s.cod_sucursal,
        nombre: s.nombre,
        grupo,
        empresaReal: s.empresa,
        supervisor: supervisores.get(s.cod_sucursal) || null,
        objetivoSinIva,
        objetivoConIva,
        unidades: s.valores.unidades,
        operaciones: s.valores.operaciones,
        uniXOper: s.valores.uniXCli,
        tktProm: s.valores.tktProm,
        diasVenta,
        margenPct,
        diarioSinIva,
        diarioConIva,
        unidadesDiarias,
        operacionesDiarias,
        margenPesos,
        ajusteMargen,
        margenPctAjustadoFila,
        cargado: diasVenta != null && margenPct != null
      };
    });

  const draftAjusteGrupo = storeAjusteGrupo.leer(mes);
  const grupos = {};
  for (const g of ['PUEBLO', 'TESI', 'WEB']) {
    const filasGrupo = filas.filter((f) => f.grupo === g);
    const total = calcularTotalGrupo(filasGrupo);
    const esDigital = g === 'WEB';
    // Pueblo/Tesi: un solo % editable para todo el grupo (antes hardcodeado
    // en AJUSTE_MARGEN, ahora persistido y con ese valor de fallback).
    const ajusteGrupo = draftAjusteGrupo[g] != null ? Number(draftAjusteGrupo[g].valor) : AJUSTE_MARGEN[g];
    grupos[g] = {
      sucursales: filasGrupo,
      total,
      // Digitales: el ajuste es por sucursal, no hay un único % de grupo.
      ajuste: esDigital ? null : ajusteGrupo,
      margenPctAjustado: esDigital ? total.margenPctAjustadoPorSucursal : total.margenPct + ajusteGrupo
    };
  }

  return { mes, mesNombre: vistaObjetivo.mesNombre, grupos };
}

/* Permisos por usuario (28/08/2026): el portal (DashboardProxy.cs) manda el
   username logueado en el header X-Portal-User al reenviar la request. Sólo
   puede editar quien tenga "vallejo" en el usuario, o el admin del portal —
   el resto es sólo lectura. Sin el header (ej. pegándole directo al puerto
   para diagnóstico local) se asume solo lectura, nunca edición. */
function usuarioDe(req) {
  return String(req.headers['x-portal-user'] || '').trim();
}
function puedeEditar(req) {
  const u = usuarioDe(req).toLowerCase();
  return u.includes('vallejo') || u === 'admin';
}
function exigirEdicion(req, res, next) {
  if (!puedeEditar(req)) {
    return res.status(403).json({ error: 'Este usuario es de sólo lectura — no puede cargar ni modificar objetivos.' });
  }
  next();
}

/* Recortan la respuesta ya armada a las sucursales permitidas — nunca
   mutan el objeto original (las 4 vistas de acá salen de cachés
   compartidas entre requests/usuarios). Se aplican sólo si
   sucursalesPermitidas(req) devolvió un Set (supervisor restringido). */
function filtrarGrilla(data, permitidas) {
  return { ...data, filas: data.filas.filter((f) => permitidas.has(f.cod_sucursal)) };
}
function filtrarObjetivoProximo(data, permitidas) {
  const sucursales = data.sucursales.filter((s) => permitidas.has(s.cod_sucursal));
  const totalUniverso = sucursales.length;
  const totalCargadas = sucursales.filter((s) => s.cargado).length;
  const totalCompletas = sucursales.filter((s) => s.completo).length;
  return {
    ...data, sucursales, totalUniverso, totalCargadas, totalCompletas,
    listoParaGuardar: totalUniverso > 0 && totalCompletas === totalUniverso
  };
}
function filtrarSugerencia(data, permitidas) {
  return { ...data, sucursales: data.sucursales.filter((s) => permitidas.has(s.cod_sucursal)) };
}
function filtrarMargenes(data, permitidas) {
  const grupos = {};
  for (const [g, val] of Object.entries(data.grupos)) {
    const sucursales = val.sucursales.filter((s) => permitidas.has(s.cod_sucursal));
    const total = calcularTotalGrupo(sucursales);
    const esDigital = g === 'WEB';
    grupos[g] = {
      sucursales, total,
      ajuste: val.ajuste,
      margenPctAjustado: esDigital ? total.margenPctAjustadoPorSucursal : total.margenPct + val.ajuste
    };
  }
  return { ...data, grupos };
}

const app = express();
app.use(express.json());

app.get('/api/permisos', (req, res) => {
  res.json({ usuario: usuarioDe(req), puedeEditar: puedeEditar(req) });
});

app.get('/api/salud', async (_req, res) => {
  try {
    await getPoolTableros();
    await getPoolDwVallejo();
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.get('/api/grilla', async (req, res) => {
  try {
    const data = await obtenerGrillaCacheada();
    const permitidas = await sucursalesPermitidas(req);
    res.json(permitidas ? filtrarGrilla(data, permitidas) : data);
  } catch (e) {
    log('error', `grilla: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/objetivos-proximo', async (req, res) => {
  try {
    const data = await construirVistaObjetivoProximo();
    const permitidas = await sucursalesPermitidas(req);
    res.json(permitidas ? filtrarObjetivoProximo(data, permitidas) : data);
  } catch (e) {
    log('error', `objetivos-proximo: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/objetivos-proximo/sugerencia', async (req, res) => {
  try {
    const data = await construirVistaSugerencia();
    const permitidas = await sucursalesPermitidas(req);
    res.json(permitidas ? filtrarSugerencia(data, permitidas) : data);
  } catch (e) {
    log('error', `objetivos-proximo sugerencia: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});


/* Mapa cod_sucursal → ajuste real a aplicar, a partir de construirVistaMargenes()
   (que ya sabe recuperar de la base el ajuste de una sucursal ya guardada
   cuyo borrador se borró) — NO leer el borrador crudo acá: una sucursal de
   Digitales que ya se guardó antes con un ajuste custom pierde ese valor de
   su borrador (se borra al guardar), así que recalcularlo desde el
   borrador puro la hacía caer al default apenas se volvía a guardar otra
   cosa del mismo lote (28/08/2026, bug real reportado por el usuario). */
async function obtenerAjustesPorSucursal() {
  const vistaMargenes = await construirVistaMargenes();
  const mapa = new Map();
  for (const g of Object.values(vistaMargenes.grupos)) {
    for (const fila of g.sucursales) {
      mapa.set(fila.cod_sucursal, fila.grupo === 'WEB' ? fila.ajusteMargen : g.ajuste);
    }
  }
  return mapa;
}

/* Guarda vía TEMP_BI_APP + SP_INSERTAR_TEMP_BI_EN_OBJ_PUEBLO_TESI_DASHBOARD
   (db_Cegid) — ya NO escribe dw_vallejo.f_objetivos directo. El dashboard
   llena TEMP_BI_APP con lo cargado en las dos pestañas (Objetivo + Días/
   Margen) y el SP hace el resto (igual que el proceso manual real, pero
   automático y parametrizado por mes). Por defecto todo el universo, o sólo
   una empresa (PUEBLO/TESI) si se pasa {empresa} en el body — permite cargar
   Pueblo y guardarlo, y seguir con Tesi después sin esperar a la red
   completa. Sólo se borra del borrador local lo que efectivamente se guardó. */
app.post('/api/objetivos-proximo/guardar', exigirEdicion, async (req, res) => {
  const mes = mesObjetivoAAAAMM();
  const empresa = req.body && req.body.empresa ? String(req.body.empresa) : null;
  try {
    const vista = await construirVistaObjetivoProximo();
    const universo = empresa ? vista.sucursales.filter((s) => s.empresa === empresa) : vista.sucursales;
    if (!universo.length) {
      return res.status(400).json({ error: 'No hay sucursales para ese filtro' });
    }
    const faltan = universo.filter((s) => !s.completo);
    if (faltan.length) {
      const detalle = faltan.map((s) => {
        const partes = [];
        if (!s.objetivoCargado) partes.push('objetivo');
        if (s.diasVenta == null || s.margenPct == null) partes.push('días/margen');
        return `${s.nombre} (falta ${partes.join(' y ')})`;
      });
      return res.status(409).json({ error: 'Faltan sucursales sin cargar', faltan: detalle });
    }

    const ajustesPorSucursal = await obtenerAjustesPorSucursal();

    const pool = await getPoolCegid();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const s of universo) {
        const diarioSinIva = s.valores.ventaSinIva / s.diasVenta;
        const diarioConIva = diarioSinIva * 1.21;
        const mgPesos = s.margenPct * s.valores.ventaSinIva;

        const reqDel = new sql.Request(tx);
        reqDel.input('mes', sql.Int, mes);
        reqDel.input('cod', sql.VarChar(50), s.cod_sucursal);
        await reqDel.query(DELETE_TEMP_BI_APP_FILA);

        const reqIns = new sql.Request(tx);
        reqIns.input('mes', sql.Int, mes);
        reqIns.input('cod', sql.VarChar(50), s.cod_sucursal);
        reqIns.input('objSinIva', sql.VarChar(500), String(s.valores.ventaSinIva));
        reqIns.input('objConIva', sql.VarChar(500), String(s.valores.ventaConIva));
        reqIns.input('dias', sql.VarChar(500), String(s.diasVenta));
        reqIns.input('diarioSinIva', sql.VarChar(500), String(diarioSinIva));
        reqIns.input('diarioConIva', sql.VarChar(500), String(diarioConIva));
        reqIns.input('margen', sql.VarChar(50), String(s.margenPct));
        reqIns.input('unidades', sql.VarChar(500), String(s.valores.unidades));
        reqIns.input('operaciones', sql.VarChar(500), String(s.valores.operaciones));
        reqIns.input('uniXOper', sql.VarChar(500), String(s.valores.uniXCli));
        reqIns.input('mgPesos', sql.VarChar(500), String(mgPesos));
        await reqIns.query(INSERT_TEMP_BI_APP_FILA);
      }

      const tvpAjustes = new sql.Table('dbo.VentaObjetivo_AjusteMargenType');
      tvpAjustes.columns.add('SUCURSAL', sql.VarChar(50));
      tvpAjustes.columns.add('Ajuste', sql.Decimal(18, 4));
      for (const s of universo) {
        const ajuste = ajustesPorSucursal.get(s.cod_sucursal);
        tvpAjustes.rows.add(s.cod_sucursal, ajuste != null ? ajuste : AJUSTE_MARGEN[s.empresa]);
      }

      const reqExec = new sql.Request(tx);
      reqExec.input('mes', sql.Int, mes);
      reqExec.input('ajustes', tvpAjustes);
      await reqExec.query(EXEC_SP_DASHBOARD);

      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    for (const s of universo) {
      store.eliminarUno(mes, s.cod_sucursal);
      storeMargenes.eliminarUno(mes, s.cod_sucursal);
    }
    res.json({ ok: true, mes, empresa, guardadas: universo.length });
  } catch (e) {
    log('error', `objetivos-proximo guardar: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/objetivos-proximo/:cod', exigirEdicion, async (req, res) => {
  try {
    const { cod } = req.params;
    const { uniXCli, tktProm, operaciones } = req.body || {};
    const nums = [uniXCli, tktProm, operaciones].map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) {
      return res.status(400).json({ error: 'uniXCli, tktProm y operaciones deben ser números ≥ 0' });
    }
    const mes = mesObjetivoAAAAMM();
    const guardado = store.guardarUno(mes, cod, { uniXCli: nums[0], tktProm: nums[1], operaciones: nums[2] });
    res.json({ ok: true, mes, cod_sucursal: cod, valores: calcular(guardado) });
  } catch (e) {
    log('error', `objetivos-proximo POST: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

/* Borra el objetivo cargado de una sucursal: del borrador local si todavía no
   se guardó, y de dw_vallejo.f_objetivos si ya se había guardado antes
   (guardado parcial por empresa). */
app.delete('/api/objetivos-proximo/:cod', exigirEdicion, async (req, res) => {
  try {
    const { cod } = req.params;
    const mes = mesObjetivoAAAAMM();
    store.eliminarUno(mes, cod);

    const sucursales = await obtenerSucursalesCacheadas();
    const s = sucursales.find((x) => x.cod_sucursal === cod);
    if (s) {
      const pool = await getPoolDwVallejo();
      const req2 = pool.request();
      req2.input('mes', sql.Int, mes);
      req2.input('idSucursal', sql.Int, s.id_sucursal);
      await req2.query(DELETE_OBJETIVO);
    }
    res.json({ ok: true, mes, cod_sucursal: cod });
  } catch (e) {
    log('error', `objetivos-proximo DELETE: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/margenes-empresa/meses', async (_req, res) => {
  try {
    res.json({ meses: await obtenerMesesConObjetivoCacheados() });
  } catch (e) {
    log('error', `margenes-empresa meses: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/margenes-empresa', async (req, res) => {
  try {
    const mesPedido = req.query.mes ? Number(req.query.mes) : null;
    const data = (mesPedido && mesPedido !== mesObjetivoAAAAMM())
      ? await construirVistaMargenesParaMes(mesPedido)
      : await construirVistaMargenes();
    const permitidas = await sucursalesPermitidas(req);
    res.json(permitidas ? filtrarMargenes(data, permitidas) : data);
  } catch (e) {
    log('error', `margenes-empresa: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/margenes-empresa/:cod', exigirEdicion, async (req, res) => {
  try {
    const { cod } = req.params;
    const { diasVenta, margenPct } = req.body || {};
    const mes = mesObjetivoAAAAMM();
    // guardarUno pisa todo el registro — hay que partir de lo ya guardado
    // (incluido el ajuste de Digitales) y sólo pisar los campos que vinieron
    // en este POST. Días Venta y Margen% se guardan de forma independiente
    // (uno puede llegar sin el otro si el usuario carga por columna en vez
    // de por fila): antes se exigían los dos juntos y el primero en cargarse
    // se perdía en silencio si el usuario cambiaba de fila/pestaña antes de
    // completar el segundo.
    const actual = storeMargenes.leer(mes)[cod] || {};
    const nuevo = { ...actual };
    if (diasVenta !== undefined && diasVenta !== null && diasVenta !== '') {
      const dv = Number(diasVenta);
      if (!Number.isFinite(dv) || dv <= 0) {
        return res.status(400).json({ error: 'diasVenta debe ser > 0' });
      }
      nuevo.diasVenta = dv;
    }
    if (margenPct !== undefined && margenPct !== null && margenPct !== '') {
      const mp = Number(margenPct);
      if (!Number.isFinite(mp) || mp < 0 || mp > 1) {
        return res.status(400).json({ error: 'margenPct debe ser una fracción entre 0 y 1' });
      }
      nuevo.margenPct = mp;
    }
    if (nuevo.diasVenta == null && nuevo.margenPct == null) {
      return res.status(400).json({ error: 'nada para guardar' });
    }
    storeMargenes.guardarUno(mes, cod, nuevo);
    res.json({ ok: true, mes, cod_sucursal: cod });
  } catch (e) {
    log('error', `margenes-empresa POST: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

/* Ajuste de margen personalizado por sucursal (sólo Digitales — Pueblo/Tesi
   usan el endpoint de grupo de abajo, un solo valor para todas). */
app.post('/api/margenes-empresa/:cod/ajuste', exigirEdicion, async (req, res) => {
  try {
    const { cod } = req.params;
    const aj = Number(req.body && req.body.ajusteMargen);
    if (!Number.isFinite(aj) || aj < -1 || aj > 1) {
      return res.status(400).json({ error: 'ajusteMargen debe ser una fracción entre -1 y 1' });
    }
    const mes = mesObjetivoAAAAMM();
    const actual = storeMargenes.leer(mes)[cod] || {};
    storeMargenes.guardarUno(mes, cod, { diasVenta: actual.diasVenta, margenPct: actual.margenPct, ajusteMargen: aj });
    res.json({ ok: true, mes, cod_sucursal: cod });
  } catch (e) {
    log('error', `margenes-empresa ajuste POST: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

/* Ajuste de margen a nivel grupo — un solo valor para Pueblo o Tesi (no
   por sucursal). Digitales no pasa por acá. */
app.post('/api/margenes-empresa/grupo/:grupo/ajuste', exigirEdicion, async (req, res) => {
  try {
    const { grupo } = req.params;
    if (grupo !== 'PUEBLO' && grupo !== 'TESI') {
      return res.status(400).json({ error: 'grupo debe ser PUEBLO o TESI' });
    }
    const aj = Number(req.body && req.body.ajuste);
    if (!Number.isFinite(aj) || aj < -1 || aj > 1) {
      return res.status(400).json({ error: 'ajuste debe ser una fracción entre -1 y 1' });
    }
    const mes = mesObjetivoAAAAMM();
    storeAjusteGrupo.guardarUno(mes, grupo, { valor: aj });
    res.json({ ok: true, mes, grupo });
  } catch (e) {
    log('error', `margenes-empresa grupo ajuste POST: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

/* Operaciones/Tkt Prom/Uni x Cli del MES EN CURSO (30/08/2026) — mismo
   endpoint que el "mes que viene" pero escribiendo DIRECTO a
   dw_vallejo.f_objetivos (sin borrador): ese mes ya se guardó de verdad,
   esto es corregirlo. Recalcula además obj_margen_pesos con la venta
   nueva, para no dejarlo desincronizado del margen % ya cargado. Sólo
   habilitado desde Totales tras confirmar "Editar objetivos del mes en
   curso" — Comparativas sigue siendo sólo para el mes que viene. */
app.post('/api/objetivo-actual/:cod', exigirEdicion, async (req, res) => {
  try {
    const { cod } = req.params;
    const { uniXCli, tktProm, operaciones } = req.body || {};
    const nums = [uniXCli, tktProm, operaciones].map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) {
      return res.status(400).json({ error: 'uniXCli, tktProm y operaciones deben ser números ≥ 0' });
    }
    const sucursales = await obtenerSucursalesCacheadas();
    const s = sucursales.find((x) => x.cod_sucursal === cod);
    if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
    const mes = mesActualAAAAMM();
    const valores = calcular({ uniXCli: nums[0], tktProm: nums[1], operaciones: nums[2] });

    const pool = await getPoolDwVallejo();
    const camposComunes = (r) => {
      r.input('mes', sql.Int, mes);
      r.input('idSucursal', sql.Int, s.id_sucursal);
      r.input('uniXCli', sql.Decimal(18, 4), valores.uniXCli);
      r.input('tktProm', sql.Decimal(18, 4), valores.tktProm);
      r.input('operaciones', sql.Decimal(18, 4), valores.operaciones);
      r.input('unidades', sql.Decimal(18, 4), valores.unidades);
      r.input('ventaConIva', sql.Decimal(18, 4), valores.ventaConIva);
      r.input('ventaSinIva', sql.Decimal(18, 4), valores.ventaSinIva);
    };
    const reqUpd = pool.request();
    camposComunes(reqUpd);
    const r = await reqUpd.query(UPDATE_OBJETIVO);
    if (r.rowsAffected[0] === 0) {
      const reqIns = pool.request();
      camposComunes(reqIns);
      await reqIns.query(INSERT_OBJETIVO);
    }

    // obj_margen_pesos depende de la venta — si cambió, hay que recalcularlo
    // con el margen % y ajuste que ya estaban cargados (no cambian acá).
    const dbDiasMargen = await cargarDiasMargenDelMesDb(mes);
    const actual = dbDiasMargen.get(s.id_sucursal);
    if (actual && actual.margen_pct != null) {
      const ajusteActual = actual.ajuste_usado != null ? Number(actual.ajuste_usado) : 0;
      const margenPorAjustado = Number(actual.margen_pct) + ajusteActual;
      const reqMargen = pool.request();
      reqMargen.input('mes', sql.Int, mes);
      reqMargen.input('idSucursal', sql.Int, s.id_sucursal);
      reqMargen.input('margenPor', sql.Decimal(18, 4), margenPorAjustado);
      reqMargen.input('ajuste', sql.Decimal(18, 4), ajusteActual);
      reqMargen.input('margenPesos', sql.Decimal(18, 2), margenPorAjustado * valores.ventaSinIva);
      await reqMargen.query(UPDATE_MARGEN_MES);
    }

    cache = { data: null, ts: 0, mesAbierto: null }; // la columna "mes en curso" de Comparativas sale de acá
    res.json({ ok: true, mes, cod_sucursal: cod, valores });
  } catch (e) {
    log('error', `objetivo-actual POST: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

/* Ajuste puntual del MES EN CURSO (30/08/2026) — ese mes ya se guardó de
   verdad (GUARDAR OBJETIVOS corrió, TEMP_BI_APP+SP ya empujaron todo a
   dw_vallejo), así que corregir algo acá escribe DIRECTO a la base, sin
   borrador ni SP: no hay "guardar" pendiente, cada cambio YA es el cambio
   real. Body parcial — cualquier combinación de diasVenta/margenPct/
   ajusteMargen; lo que no venga se completa con lo que ya hay en la base. */
app.post('/api/objetivo-actual/:cod/margen', exigirEdicion, async (req, res) => {
  try {
    const { cod } = req.params;
    const sucursales = await obtenerSucursalesCacheadas();
    const s = sucursales.find((x) => x.cod_sucursal === cod);
    if (!s) return res.status(404).json({ error: 'Sucursal no encontrada' });
    const mes = mesActualAAAAMM();
    const grupo = CANALES_WEB.has(cod) ? 'WEB' : s.empresa;

    const [dbDiasMargen, dbRows] = await Promise.all([
      cargarDiasMargenDelMesDb(mes),
      cargarObjetivosDelMesDb(mes)
    ]);
    const obj = dbRows.get(s.id_sucursal);
    if (!obj) return res.status(409).json({ error: 'Esta sucursal no tiene objetivo cargado el mes en curso' });
    const actual = dbDiasMargen.get(s.id_sucursal) || {};

    const body = req.body || {};
    const diasVenta = body.diasVenta != null ? Number(body.diasVenta) : (actual.dias_venta != null ? Number(actual.dias_venta) : null);
    const margenPctRaw = body.margenPct != null ? Number(body.margenPct) : (actual.margen_pct != null ? Number(actual.margen_pct) : null);
    const ajusteDefault = grupo === 'WEB' ? AJUSTE_MARGEN.WEB : AJUSTE_MARGEN[grupo];
    const ajusteMargen = body.ajusteMargen != null ? Number(body.ajusteMargen) : (actual.ajuste_usado != null ? Number(actual.ajuste_usado) : ajusteDefault);

    if (!(diasVenta > 0)) return res.status(400).json({ error: 'diasVenta debe ser > 0' });
    if (margenPctRaw == null || !Number.isFinite(margenPctRaw) || margenPctRaw < 0 || margenPctRaw > 1) {
      return res.status(400).json({ error: 'margenPct debe ser una fracción entre 0 y 1' });
    }
    if (!Number.isFinite(ajusteMargen) || ajusteMargen < -1 || ajusteMargen > 1) {
      return res.status(400).json({ error: 'ajusteMargen debe ser una fracción entre -1 y 1' });
    }

    const valores = calcular({ uniXCli: obj.obj_unidades_clientes, tktProm: obj.obj_ticket_promedio, operaciones: obj.obj_operaciones });
    const margenPorAjustado = margenPctRaw + ajusteMargen;
    const margenPesos = margenPorAjustado * valores.ventaSinIva;

    const pool = await getPoolDwVallejo();
    const reqDias = pool.request();
    reqDias.input('mes', sql.Int, mes);
    reqDias.input('idSucursal', sql.Int, s.id_sucursal);
    reqDias.input('dias', sql.Decimal(10, 2), diasVenta);
    await reqDias.query(UPDATE_DIAS_MES);

    const reqMargen = pool.request();
    reqMargen.input('mes', sql.Int, mes);
    reqMargen.input('idSucursal', sql.Int, s.id_sucursal);
    reqMargen.input('margenPor', sql.Decimal(18, 4), margenPorAjustado);
    reqMargen.input('ajuste', sql.Decimal(18, 4), ajusteMargen);
    reqMargen.input('margenPesos', sql.Decimal(18, 2), margenPesos);
    await reqMargen.query(UPDATE_MARGEN_MES);

    res.json({ ok: true, mes, cod_sucursal: cod });
  } catch (e) {
    log('error', `objetivo-actual margen POST: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

/* Ajuste puntual de grupo (Pueblo/Tesi) del mes en curso — recalcula cada
   sucursal del grupo preservando su margenPct "crudo" propio, sólo cambia
   el ajuste. Las que no tienen margen cargado ese mes quedan afuera (nada
   que reajustar). */
app.post('/api/objetivo-actual/grupo/:grupo/ajuste', exigirEdicion, async (req, res) => {
  try {
    const { grupo } = req.params;
    if (grupo !== 'PUEBLO' && grupo !== 'TESI') {
      return res.status(400).json({ error: 'grupo debe ser PUEBLO o TESI' });
    }
    const aj = Number(req.body && req.body.ajuste);
    if (!Number.isFinite(aj) || aj < -1 || aj > 1) {
      return res.status(400).json({ error: 'ajuste debe ser una fracción entre -1 y 1' });
    }
    const mes = mesActualAAAAMM();
    const [sucursales, dbRows, dbDiasMargen] = await Promise.all([
      obtenerSucursalesCacheadas(),
      cargarObjetivosDelMesDb(mes),
      cargarDiasMargenDelMesDb(mes)
    ]);
    const delGrupo = sucursales.filter((s) => !CANALES_WEB.has(s.cod_sucursal) && s.empresa === grupo && dbRows.has(s.id_sucursal));

    const pool = await getPoolDwVallejo();
    let actualizadas = 0;
    for (const s of delGrupo) {
      const actual = dbDiasMargen.get(s.id_sucursal);
      if (!actual || actual.margen_pct == null) continue; // sin margen cargado, nada que reajustar
      const obj = dbRows.get(s.id_sucursal);
      const margenPctRaw = Number(actual.margen_pct);
      const valores = calcular({ uniXCli: obj.obj_unidades_clientes, tktProm: obj.obj_ticket_promedio, operaciones: obj.obj_operaciones });
      const margenPorAjustado = margenPctRaw + aj;
      const margenPesos = margenPorAjustado * valores.ventaSinIva;

      const reqMargen = pool.request();
      reqMargen.input('mes', sql.Int, mes);
      reqMargen.input('idSucursal', sql.Int, s.id_sucursal);
      reqMargen.input('margenPor', sql.Decimal(18, 4), margenPorAjustado);
      reqMargen.input('ajuste', sql.Decimal(18, 4), aj);
      reqMargen.input('margenPesos', sql.Decimal(18, 2), margenPesos);
      await reqMargen.query(UPDATE_MARGEN_MES);
      actualizadas++;
    }
    res.json({ ok: true, mes, grupo, actualizadas });
  } catch (e) {
    log('error', `objetivo-actual grupo ajuste POST: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/margenes-empresa/:cod', exigirEdicion, async (req, res) => {
  try {
    const { cod } = req.params;
    const mes = mesObjetivoAAAAMM();
    storeMargenes.eliminarUno(mes, cod);
    res.json({ ok: true, mes, cod_sucursal: cod });
  } catch (e) {
    log('error', `margenes-empresa DELETE: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, HOST, () => {
  log('info', `http: escuchando en http://${HOST}:${PORT}`);
});

process.on('SIGTERM', () => process.exit(0));
