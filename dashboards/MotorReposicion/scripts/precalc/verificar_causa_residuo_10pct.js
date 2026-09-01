// scripts/precalc/verificar_causa_residuo_10pct.js
//
// Verifica, con datos reales, POR QUE el indicador de Task 6 (punto 3) no llega al 100%:
// de los articulos hoy en estado QUIEBRE real (StockTienda=0 y StockDeposito=0) que muestran
// diasQuiebrePeriodo=0 en /api/tablero/quiebre, ¿tienen realmente un "hueco viejo sin evidencia"
// (como decia la interpretacion original del reporte de Task 6), o tienen StockSemana POSITIVO en
// TODAS las semanas del periodo elegido (es decir: se quebraron MUY recientemente y el precalculo
// semanal, que corrio una sola vez, todavia no vio ninguna semana en cero para ellos)?
//
// Mismo periodo por defecto que usa /api/tablero/quiebre (server.js): [hoy-89, hoy].
// Misma logica de QUIEBRE que server.js (Estado='QUIEBRE' <=> StockTienda=0 AND StockDeposito=0,
// ver el CASE de Estado en QUERY_QUIEBRE_DETALLE).
//
// No escribe nada -- solo SELECTs de solo lectura.

require('dotenv').config();
const sql = require('mssql');
const dbConfig = {
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000,
};

const TAMANO_MUESTRA = 700; // dentro del rango 500-1000 pedido

async function main() {
  const pool = await sql.connect(dbConfig);

  const hasta = new Date();
  const desde = new Date();
  desde.setDate(desde.getDate() - 89);
  const fmt = (d) => d.toISOString().slice(0, 10);

  console.log('Periodo usado (igual al default de /api/tablero/quiebre):', fmt(desde), '->', fmt(hasta));

  // Todo en UN SOLO batch/.query() -- con mssql/tedious, cada llamada a pool.request().query()
  // puede tomar una conexion DISTINTA del pool, y las tablas #temp solo viven dentro de la
  // conexion/sesion que las creo. Separar esto en varias llamadas encadenadas (como en un primer
  // intento de este script) rompe con "Invalid object name '#Universo'" apenas la segunda llamada
  // cae en otra conexion del pool. server.js evita este problema exactamente asi: TODO
  // QUERY_QUIEBRE_DETALLE es un unico string ejecutado con un unico .query().
  const result = await pool.request()
    .input('fechaDesde', sql.Date, desde)
    .input('fechaHasta', sql.Date, hasta)
    .input('n', sql.Int, TAMANO_MUESTRA)
    .query(`
      -- 1) Universo de HOY (igual que #Universo en server.js): stock en tienda de
      --    MotorReposicion_UniversoHoy + combos vendidos en el periodo que no estaban ahi (con
      --    StockTienda=0 por construccion).
      SELECT Sucursal, CodArticulo, COLOR, TALLE, StockTienda
      INTO #Universo
      FROM dbo.MotorReposicion_UniversoHoy;

      INSERT INTO #Universo (Sucursal, CodArticulo, COLOR, TALLE, StockTienda)
      SELECT DISTINCT vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE, 0
      FROM Vta_detalle vd
      INNER JOIN Sucursales s ON s.Sucursal = vd.ESTAB AND (s.viewSuc='S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
      INNER JOIN dbo.MotorReposicion_CatalogoValido cv ON cv.CodArticulo = vd.ARTCEGID AND cv.COLOR = vd.COLOR AND cv.TALLE = vd.TALLE
      WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @fechaDesde AND vd.FECHA <= @fechaHasta
        AND NOT EXISTS (SELECT 1 FROM #Universo u WHERE u.Sucursal = vd.ESTAB AND u.CodArticulo = vd.ARTCEGID AND u.COLOR = vd.COLOR AND u.TALLE = vd.TALLE);

      -- 2) QUIEBRE real hoy: StockTienda=0 y StockDeposito=0 (mismo CASE que server.js: las dos
      --    ramas anteriores del CASE ya cubren StockDeposito>0, asi que "WHEN StockTienda=0 THEN
      --    QUIEBRE" solo se alcanza cuando StockDeposito=0 tambien).
      SELECT u.Sucursal, u.CodArticulo, u.COLOR, u.TALLE
      INTO #QuiebreHoy
      FROM #Universo u
      LEFT JOIN dbo.MotorReposicion_DepositoHoy dh ON dh.CodArticulo=u.CodArticulo AND dh.COLOR=u.COLOR AND dh.TALLE=u.TALLE
      WHERE u.StockTienda = 0
        AND (ISNULL(dh.DepositoTESI,0) + ISNULL(dh.DepositoPUEBLO,0)) = 0;

      SELECT COUNT(*) AS Total FROM #QuiebreHoy;

      -- 3) diasQuiebrePeriodo por combo (suma de DiasQuiebreContribucion dentro del periodo).
      SELECT q.Sucursal, q.CodArticulo, q.COLOR, q.TALLE, ISNULL(SUM(dc.DiasQuiebreContribucion),0) AS DiasQuiebrePeriodo
      INTO #QuiebreConDias
      FROM #QuiebreHoy q
      LEFT JOIN dbo.MotorReposicion_DiasConStockPorSemana dc
        ON dc.Sucursal=q.Sucursal AND dc.CodArticulo=q.CodArticulo AND dc.COLOR=q.COLOR AND dc.TALLE=q.TALLE
        AND dc.FechaSemana >= @fechaDesde AND dc.FechaSemana <= @fechaHasta
      GROUP BY q.Sucursal, q.CodArticulo, q.COLOR, q.TALLE;

      SELECT
        COUNT(*) AS Total,
        SUM(CASE WHEN DiasQuiebrePeriodo = 0 THEN 1 ELSE 0 END) AS ConDiasQuiebrePeriodoCero
      FROM #QuiebreConDias;

      -- 4) Muestra aleatoria de combos con diasQuiebrePeriodo=0, y para cada uno, estado real de
      --    MotorReposicion_StockSemanal DENTRO del mismo periodo.
      SELECT TOP (@n) Sucursal, CodArticulo, COLOR, TALLE
      INTO #Muestra
      FROM #QuiebreConDias
      WHERE DiasQuiebrePeriodo = 0
      ORDER BY NEWID();

      SELECT
        m.Sucursal, m.CodArticulo, m.COLOR, m.TALLE,
        COUNT(s.FechaSemana) AS FilasEnPeriodo,
        SUM(CASE WHEN s.StockSemana > 0 THEN 1 ELSE 0 END) AS FilasPositivas,
        SUM(CASE WHEN s.StockSemana <= 0 THEN 1 ELSE 0 END) AS FilasCeroONegativas
      FROM #Muestra m
      LEFT JOIN dbo.MotorReposicion_StockSemanal s
        ON s.Sucursal = m.Sucursal AND s.CodArticulo = m.CodArticulo AND s.COLOR = m.COLOR AND s.TALLE = m.TALLE
        AND s.FechaSemana >= @fechaDesde AND s.FechaSemana <= @fechaHasta
      GROUP BY m.Sucursal, m.CodArticulo, m.COLOR, m.TALLE;
    `);

  console.log('Articulos en QUIEBRE real hoy (StockTienda=0 y StockDeposito=0):', result.recordsets[0][0].Total);

  const resumen = result.recordsets[1][0];
  console.log('De esos, con diasQuiebrePeriodo=0:', resumen.ConDiasQuiebrePeriodoCero, 'de', resumen.Total,
    `(${(resumen.ConDiasQuiebrePeriodoCero / resumen.Total * 100).toFixed(1)}%, referencia Task 6: ~90%)`);

  const filas = result.recordsets[2];
  const n = filas.length;
  let patronA_todasPositivas = 0; // FilasEnPeriodo > 0, ninguna <= 0 -- "se quebro hace poco, precalculo no lo vio todavia"
  let patronB_sinFilasEnPeriodo = 0; // 0 filas en el periodo -- sin evidencia semanal alguna en la ventana
  let patronC_algunaCeroONegativa = 0; // hay >=1 fila <=0 pero DiasQuiebrePeriodo sigue en 0 (inesperado, a revisar)

  for (const f of filas) {
    if (f.FilasEnPeriodo === 0) patronB_sinFilasEnPeriodo++;
    else if (f.FilasCeroONegativas === 0) patronA_todasPositivas++;
    else patronC_algunaCeroONegativa++;
  }

  console.log('\n--- Muestra de', n, 'combos con diasQuiebrePeriodo=0 (QUIEBRE real hoy) ---');
  console.log('Patron A (StockSemana > 0 en TODAS las semanas del periodo -- quiebre muy reciente, precalculo aun no lo vio):',
    patronA_todasPositivas, `(${(patronA_todasPositivas / n * 100).toFixed(1)}%)`);
  console.log('Patron B (0 filas de StockSemanal dentro del periodo -- sin evidencia semanal en la ventana):',
    patronB_sinFilasEnPeriodo, `(${(patronB_sinFilasEnPeriodo / n * 100).toFixed(1)}%)`);
  console.log('Patron C (alguna semana con StockSemana<=0 en el periodo, pero DiasQuiebrePeriodo sigue en 0 -- inesperado):',
    patronC_algunaCeroONegativa, `(${(patronC_algunaCeroONegativa / n * 100).toFixed(1)}%)`);

  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
