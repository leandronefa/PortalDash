import { sql } from '../config/db.js';

// Migración self-healing (mismo patrón que ranking.js/sucursales.js): crea la
// tabla de fotos de montos por período si no existe.
export async function ensureMontosHistorialTable(pool) {
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT * FROM sys.objects
      WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_MontosHistorial') AND type = 'U'
    )
    CREATE TABLE dbo.tbl_CoVenAppINDO_MontosHistorial (
      periodo         VARCHAR(7) PRIMARY KEY,
      montos_json     NVARCHAR(MAX),
      fecha_snapshot  DATETIME DEFAULT GETDATE()
    )
  `);
}

// Lee las 6 fuentes de montos "vivas" (valor actual del ABM) tal cual las
// carga hoy calculo.js::cargarContexto — sin filtro de período, son tablas
// de configuración global por categoría/escalón.
export async function leerMontosVivos(pool) {
  const [montosR, montosVendR, montoSupR, montosPresR, montosCajR, multR] = await Promise.all([
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_Montos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosVendedor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosSupervisor'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosPrestamos'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_MontosCajero'),
    pool.request().query('SELECT * FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador'),
  ]);
  return {
    montos:            montosR.recordset,
    montosVendedor:    montosVendR.recordset,
    montosSupervisor:  montoSupR.recordset,
    montosPrestamaos:  montosPresR.recordset,
    montosCajero:      montosCajR.recordset,
    multiplicadores:   multR.recordset,
  };
}

// Devuelve la foto congelada de montos de un período: si ya existe, la lee
// y la devuelve tal cual (sin importar qué se haya editado después en el
// ABM); si es la primera vez que se calcula ese período, la crea a partir
// de los valores vivos actuales y la persiste.
// `forzarActuales: true` salta la foto existente y la regenera con los
// valores vivos de HOY (usado cuando el usuario elige explícitamente
// recalcular con los montos actuales del ABM).
export async function cargarMontosDelPeriodo(pool, periodo, { forzarActuales = false } = {}) {
  await ensureMontosHistorialTable(pool);

  if (forzarActuales) {
    return regenerarMontosDelPeriodo(pool, periodo);
  }

  const existente = await pool.request()
    .input('periodo', sql.VarChar, periodo)
    .query('SELECT montos_json FROM dbo.tbl_CoVenAppINDO_MontosHistorial WHERE periodo = @periodo');

  if (existente.recordset.length) {
    return JSON.parse(existente.recordset[0].montos_json);
  }

  const snapshot = await leerMontosVivos(pool);
  try {
    await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .input('json', sql.NVarChar(sql.MAX), JSON.stringify(snapshot))
      .query(`
        INSERT INTO dbo.tbl_CoVenAppINDO_MontosHistorial (periodo, montos_json)
        VALUES (@periodo, @json)
      `);
    return snapshot;
  } catch (err) {
    // Condición de carrera: otro request insertó la foto de este período
    // entre el SELECT de arriba y este INSERT (periodo es PK). Releemos
    // y devolvemos la foto que ganó la carrera en vez de fallar.
    const retry = await pool.request()
      .input('periodo', sql.VarChar, periodo)
      .query('SELECT montos_json FROM dbo.tbl_CoVenAppINDO_MontosHistorial WHERE periodo = @periodo');
    if (retry.recordset.length) {
      return JSON.parse(retry.recordset[0].montos_json);
    }
    throw err;
  }
}

// Sobreescribe (o crea) la foto congelada de un período con los valores
// vivos actuales del ABM — adopta el "actual" como el nuevo "histórico"
// de ese período de acá en adelante.
export async function regenerarMontosDelPeriodo(pool, periodo) {
  await ensureMontosHistorialTable(pool);
  const snapshot = await leerMontosVivos(pool);
  await pool.request()
    .input('periodo', sql.VarChar, periodo)
    .input('json', sql.NVarChar(sql.MAX), JSON.stringify(snapshot))
    .query(`
      MERGE dbo.tbl_CoVenAppINDO_MontosHistorial AS target
      USING (SELECT @periodo AS periodo) AS src
      ON target.periodo = src.periodo
      WHEN MATCHED THEN UPDATE SET montos_json = @json, fecha_snapshot = GETDATE()
      WHEN NOT MATCHED THEN INSERT (periodo, montos_json) VALUES (@periodo, @json);
    `);
  return snapshot;
}

// Serializa cada una de las 6 fuentes de montos de forma estable (sin
// importar el orden de filas que devuelva el SELECT) para poder comparar
// dos fotos por igualdad de contenido.
function serializarMontos(snapshot) {
  const canon = (rows) => (rows || []).map(r => JSON.stringify(r)).sort().join('|');
  return {
    montos:            canon(snapshot.montos),
    montosVendedor:    canon(snapshot.montosVendedor),
    montosSupervisor:  canon(snapshot.montosSupervisor),
    montosPrestamaos:  canon(snapshot.montosPrestamaos),
    montosCajero:      canon(snapshot.montosCajero),
    multiplicadores:   canon(snapshot.multiplicadores),
  };
}

// Compara la foto congelada de un período contra los montos vivos del ABM.
// `hayFoto: false` significa que el período todavía no se calculó nunca —
// no hay nada con qué comparar, la primera corrida va a crear la foto sola.
export async function diffMontosPeriodo(pool, periodo) {
  await ensureMontosHistorialTable(pool);

  const existente = await pool.request()
    .input('periodo', sql.VarChar, periodo)
    .query('SELECT montos_json, fecha_snapshot FROM dbo.tbl_CoVenAppINDO_MontosHistorial WHERE periodo = @periodo');

  if (!existente.recordset.length) {
    return { hayFoto: false, distinto: false, fechaSnapshot: null };
  }

  const historial = JSON.parse(existente.recordset[0].montos_json);
  const vivo = await leerMontosVivos(pool);
  const a = serializarMontos(historial);
  const b = serializarMontos(vivo);
  const distinto = Object.keys(a).some(k => a[k] !== b[k]);

  return { hayFoto: true, distinto, fechaSnapshot: existente.recordset[0].fecha_snapshot };
}

// Para cada período que ya tiene algo calculado (en cualquiera de las 4
// tablas de resultado) y todavía no tiene foto en MontosHistorial, crea una
// con los montos vivos de HOY (mejor dato disponible — no es retroactivamente
// exacto, pero evita que a futuro un reproceso tome valores que ni existían
// cuando ese período se calculó originalmente). Corre en cada arranque del
// servidor; es barato e idempotente (cargarMontosDelPeriodo no hace nada si
// la foto ya existe).
export async function backfillMontosHistorial(pool) {
  await ensureMontosHistorialTable(pool);

  const r = await pool.request().query(`
    SELECT periodo FROM dbo.tbl_CoVenAppINDO_CalculoHistorial
    UNION
    SELECT periodo FROM dbo.tbl_CoVenAppINDO_ResultadoCajeros
    UNION
    SELECT periodo FROM dbo.tbl_CoVenAppINDO_ResultadoOperadores
    UNION
    SELECT periodo FROM dbo.tbl_CoVenAppINDO_ResultadoOpMillon
  `);

  const periodos = [...new Set(r.recordset.map(x => x.periodo))];
  for (const periodo of periodos) {
    await cargarMontosDelPeriodo(pool, periodo);
  }
  return periodos.length;
}
