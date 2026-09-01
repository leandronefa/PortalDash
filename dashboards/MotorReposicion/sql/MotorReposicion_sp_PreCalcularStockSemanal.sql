
CREATE PROCEDURE dbo.MotorReposicion_sp_PreCalcularStockSemanal
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @ahora DATETIME = GETDATE();
  -- Ventana ampliada de 12 a 18 meses (2026-09-12, a pedido explicito, para equiparar el
  -- historial de "dias con stock" con el de ventas -- antes ventas no tenia limite de fecha en
  -- las consultas de server.js/Etapa 6, mientras que dias-con-stock se cortaba a 12 meses, una
  -- asimetria real -- ver el caso DINK-6128/Calzados 13 donde eso se noto). Se probo primero con
  -- 24 meses (medido: Etapa 1 de ~87s a ~209s, 2,4x) y se bajo a 18 (2026-09-13, a pedido
  -- explicito) para aliviar el procesamiento nocturno -- punto medio entre los 12 originales y
  -- los 24 probados, sigue resolviendo la asimetria de DINK-6128/Calzados 13 (14 meses de
  -- antiguedad) sin llevar el costo al maximo medido.
  DECLARE @fechaDesde DATE = DATEADD(MONTH, -18, CAST(@ahora AS DATE));

  -- Etapa 1: detalle semanal (dbo.MotorReposicion_StockSemanal)
  IF OBJECT_ID('tempdb..#StockSemanalNuevo') IS NOT NULL DROP TABLE #StockSemanalNuevo;

  SELECT fs.Sucursal, ISNULL(fs.artprove, '') AS CodArticulo, ISNULL(fs.color, '') AS COLOR, ISNULL(fs.talle, '') AS TALLE,
         DATEADD(DAY, (5 - DATEDIFF(DAY,0,fs.fecha)%7 + 7)%7, CAST(fs.fecha AS DATE)) AS FechaSemana,
         MAX(fs.stock) AS StockSemana,
         @ahora AS FechaCalculo
  INTO #StockSemanalNuevo
  FROM FotoStock fs
  INNER JOIN Sucursales s
    ON s.Sucursal = fs.Sucursal
   AND (s.viewSuc = 'S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111'))
   AND s.Sucursal NOT IN ('000226','000235')
  LEFT JOIN (
    SELECT GA_CODEARTICLE AS CodArticulo, COLOR, TALLE
    FROM cgd_ARTICULOS
    WHERE GA_CODEARTICLE IS NOT NULL AND UPPER(ISNULL(PERTARIFA, '')) LIKE '%LIQUI%'
  ) cl ON cl.CodArticulo = fs.artprove AND cl.COLOR = fs.color AND cl.TALLE = fs.talle
  WHERE fs.fecha >= @fechaDesde AND cl.CodArticulo IS NULL
  GROUP BY fs.Sucursal, ISNULL(fs.artprove,''), ISNULL(fs.color,''), ISNULL(fs.talle,''),
           DATEADD(DAY, (5 - DATEDIFF(DAY,0,fs.fecha)%7 + 7)%7, CAST(fs.fecha AS DATE));

  -- Relleno de huecos: una semana sin ninguna foto con stock (quiebre real) no genera fila en
  -- #StockSemanalNuevo -- sin esto, no hay diferencia entre "nunca existio aca" y "se quedo sin
  -- stock esta semana". Se generan las semanas esperadas entre la primera y la ultima semana
  -- REAL de cada combinacion (nunca mas alla -- no se inventa quiebre para algo descontinuado)
  -- y se insertan con StockSemana=0 las que falten. Ver docs/superpowers/specs/2026-08-18-dias-con-stock-huecos-design.md.
  --
  -- EFECTO SOBRE LA ETAPA 2 (MotorReposicion_VelocidadAmplia, revision final 2026-08-18): la Etapa
  -- 2 mas abajo tiene su propio rescate por NOT EXISTS para semanas con recepcion real de
  -- transferencia (dis_transf_recibidas) que no tuvieran fila en #StockAmplioNuevo -- pensado para
  -- cuando esta Etapa 1 (antes del fix de relleno de huecos) no generaba NINGUNA fila para una
  -- semana de quiebre real. Ahora que el relleno de arriba SI genera esa fila (con StockSemana=0),
  -- el NOT EXISTS de la Etapa 2 da FALSO para esas semanas y su rescate ya NO se dispara -- una
  -- semana con recepcion real ahora cuenta como quiebre en la Etapa 2 en vez de "con stock". Hoy
  -- esto es inofensivo porque server.js ya no lee MotorReposicion_VelocidadAmplia (respaldo de
  -- venta esporadica sacado el mismo dia, ver backups/2026-08-18_quitar-velocidad-esporadica/),
  -- pero si se re-habilita esa lectura en el futuro, se heredaria este efecto en silencio. Ver
  -- tambien el comentario junto a la Etapa 2 mas abajo, y
  -- .superpowers/sdd/2026-08-18-dias-con-stock-huecos/task-final-fixes-report.md (Hallazgo 1).
  --
  -- GUARDA DE SEGURIDAD (Hallazgo 4a, revision final 2026-08-18, corregida en re-revision
  -- 2026-08-18; umbral ampliado 2026-09-12 al llevar @fechaDesde de 12 a 24 meses): la tabla Nums
  -- de mas abajo cubre 0..127 (128 numeros), que alcanza de sobra para la ventana de @fechaDesde
  -- (24 meses, ~105 semanas maximo). Si @fechaDesde alguna vez se ampliara a mas de 127 semanas, el
  -- CROSS JOIN de mas abajo dejaria de cubrir el resto EN SILENCIO (SemanasEsperadas se corta en la
  -- semana 127 sin avisar). RAISERROR por si solo NO interrumpe el batch en SQL Server -- por eso
  -- el RETURN explicito debajo: sin el, este chequeo avisaba pero el SP igual seguia y
  -- truncaba/insertaba la tabla real con el relleno incompleto.
  IF EXISTS (
    SELECT 1 FROM #StockSemanalNuevo
    GROUP BY Sucursal, CodArticulo, COLOR, TALLE
    HAVING DATEDIFF(WEEK, MIN(FechaSemana), MAX(FechaSemana)) > 127
  )
  BEGIN
    RAISERROR('Relleno de huecos: alguna combinacion Sucursal/CodArticulo/COLOR/TALLE abarca mas de 127 semanas entre su primera y ultima semana real -- la tabla Nums (0..127) no la cubre por completo y el relleno de huecos quedaria incompleto EN SILENCIO. Ampliar Nums (mas cruces de E1, o una E1 mas grande) antes de continuar.', 16, 1);
    DROP TABLE #StockSemanalNuevo;
    RETURN;
  END;

  ;WITH E1(N) AS (
    SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
    UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 1
  ),
  E2(N) AS (
    SELECT 1 UNION ALL SELECT 1
  ),
  Nums(N) AS (
    SELECT ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1
    FROM E1 a CROSS JOIN E1 b CROSS JOIN E2 c   -- 8x8x2 = 128 numeros: 0..127 (suficiente para 24 meses ~105 semanas)
  ),
  RangoPorCombo AS (
    SELECT Sucursal, CodArticulo, COLOR, TALLE,
           MIN(FechaSemana) AS Primera, MAX(FechaSemana) AS Ultima
    FROM #StockSemanalNuevo
    GROUP BY Sucursal, CodArticulo, COLOR, TALLE
  ),
  SemanasEsperadas AS (
    SELECT r.Sucursal, r.CodArticulo, r.COLOR, r.TALLE,
           DATEADD(DAY, n.N * 7, r.Primera) AS FechaSemana
    FROM RangoPorCombo r
    CROSS JOIN Nums n
    WHERE DATEADD(DAY, n.N * 7, r.Primera) <= r.Ultima
  ),
  Huecos AS (
    SELECT se.Sucursal, se.CodArticulo, se.COLOR, se.TALLE, se.FechaSemana,
           0 AS StockSemana, @ahora AS FechaCalculo
    FROM SemanasEsperadas se
    LEFT JOIN #StockSemanalNuevo real2
      ON real2.Sucursal = se.Sucursal AND real2.CodArticulo = se.CodArticulo
     AND real2.COLOR = se.COLOR AND real2.TALLE = se.TALLE AND real2.FechaSemana = se.FechaSemana
    WHERE real2.FechaSemana IS NULL
  )
  INSERT INTO #StockSemanalNuevo (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo)
  SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo
  FROM Huecos;

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_StockSemanal;
    INSERT INTO dbo.MotorReposicion_StockSemanal (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo)
    SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana, FechaCalculo
    FROM #StockSemanalNuevo;
  COMMIT TRANSACTION;

  DROP TABLE #StockSemanalNuevo;

  -- Etapa 2: velocidad AMPLIA de respaldo (dbo.MotorReposicion_VelocidadAmplia)
  --
  -- EFECTO DEL RELLENO DE HUECOS DE LA ETAPA 1 SOBRE ESTA ETAPA (revision final 2026-08-18, ver
  -- comentario extendido junto al bloque de relleno de huecos arriba en la Etapa 1): el rescate
  -- por NOT EXISTS de mas abajo (semanas con recepcion real de dis_transf_recibidas sin fila en
  -- #StockAmplioNuevo, a las que se les asigna StockSemana=1 "a mano") dejo de dispararse para las
  -- ~526.541 semanas que el relleno de huecos de la Etapa 1 ahora SI puebla con una fila real
  -- (StockSemana=0) -- antes de ese fix, esas semanas no tenian fila en absoluto y el NOT EXISTS
  -- daba verdadero; ahora da falso, y la semana queda contando como quiebre en vez de "con stock
  -- por recepcion". Comportamiento CORRECTO por definicion (la fila StockSemana=0 es mas fiel a la
  -- realidad que el rescate a ciegas), pero es un cambio de comportamiento silencioso heredado del
  -- fix de Etapa 1 -- documentado aca porque, aunque hoy esta etapa no se usa (server.js no lee
  -- MotorReposicion_VelocidadAmplia desde el 2026-08-18, ver
  -- backups/2026-08-18_quitar-velocidad-esporadica/), si se re-habilitara en el futuro heredaria
  -- este efecto sin que quede evidente en el codigo de esta Etapa 2 por si sola.
  DECLARE @fechaDesdeAmplio DATE = DATEADD(MONTH, -6, CAST(@ahora AS DATE));

  IF OBJECT_ID('tempdb..#StockAmplioNuevo') IS NOT NULL DROP TABLE #StockAmplioNuevo;
  SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana
  INTO #StockAmplioNuevo
  FROM dbo.MotorReposicion_StockSemanal
  WHERE FechaSemana >= DATEADD(DAY,-7,@fechaDesdeAmplio);

  INSERT INTO #StockAmplioNuevo (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana)
  SELECT DISTINCT r.Sucursal, r.CodArticulo, r.COLOR, r.TALLE, r.FechaSemana, 1
  FROM (
      SELECT tr.destino AS Sucursal, ISNULL(tr.arprove,'') AS CodArticulo, ISNULL(tr.color,'') AS COLOR, ISNULL(tr.talle,'') AS TALLE,
             DATEADD(DAY, (5 - DATEDIFF(DAY,0,tr.fecha)%7 + 7)%7, tr.fecha) AS FechaSemana
      FROM dis_transf_recibidas tr
  ) r
  WHERE r.FechaSemana >= DATEADD(DAY,-7,@fechaDesdeAmplio)
    AND NOT EXISTS (
      SELECT 1 FROM #StockAmplioNuevo ss
      WHERE ss.Sucursal=r.Sucursal AND ss.CodArticulo=r.CodArticulo AND ss.COLOR=r.COLOR AND ss.TALLE=r.TALLE AND ss.FechaSemana=r.FechaSemana
    );

  CREATE INDEX ix_stockamplio ON #StockAmplioNuevo (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana);

  IF OBJECT_ID('tempdb..#VelocidadAmpliaNueva') IS NOT NULL DROP TABLE #VelocidadAmpliaNueva;

  ;WITH PrimeraAceptacionA AS (
      SELECT destino AS Sucursal, arprove AS CodArticulo, color AS COLOR, talle AS TALLE, MIN(fecha) AS PrimeraAceptacion
      FROM dis_transf_recibidas GROUP BY destino, arprove, color, talle
  ),
  NumeradoA AS (
      SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana,
             ROW_NUMBER() OVER (PARTITION BY Sucursal, CodArticulo, COLOR, TALLE ORDER BY FechaSemana) AS rn
      FROM #StockAmplioNuevo
  ),
  ConAnteriorA AS (
      SELECT n.Sucursal, n.CodArticulo, n.COLOR, n.TALLE, n.FechaSemana, n.StockSemana,
             ant.FechaSemana AS FechaAnterior, ant.StockSemana AS StockAnterior
      FROM NumeradoA n
      LEFT JOIN NumeradoA ant ON ant.Sucursal=n.Sucursal AND ant.CodArticulo=n.CodArticulo AND ant.COLOR=n.COLOR AND ant.TALLE=n.TALLE AND ant.rn = n.rn - 1
  ),
  BaseA AS (
      SELECT ca.Sucursal, ca.CodArticulo, ca.COLOR, ca.TALLE,
             SUM(
               CASE
                 WHEN ca.FechaAnterior IS NOT NULL AND ca.FechaAnterior >= @fechaDesdeAmplio
                      AND ca.StockAnterior > 0 AND ca.StockSemana > 0
                      AND ca.FechaSemana >= @fechaDesdeAmplio
                   THEN DATEDIFF(DAY,
                          CASE WHEN pa.PrimeraAceptacion IS NOT NULL AND ca.FechaAnterior < pa.PrimeraAceptacion THEN pa.PrimeraAceptacion ELSE ca.FechaAnterior END,
                          ca.FechaSemana)
                 WHEN ca.FechaSemana >= @fechaDesdeAmplio AND ca.StockSemana > 0
                      AND (pa.PrimeraAceptacion IS NULL OR ca.FechaSemana >= pa.PrimeraAceptacion)
                   THEN 7
                 ELSE 0
               END
             ) AS DiasConStockSemanal
      FROM ConAnteriorA ca
      LEFT JOIN PrimeraAceptacionA pa ON pa.Sucursal=ca.Sucursal AND pa.CodArticulo=ca.CodArticulo AND pa.COLOR=ca.COLOR AND pa.TALLE=ca.TALLE
      GROUP BY ca.Sucursal, ca.CodArticulo, ca.COLOR, ca.TALLE
  ),
  CorreccionA AS (
      SELECT vd.ESTAB AS Sucursal, vd.ARTCEGID AS CodArticulo, vd.COLOR, vd.TALLE,
             COUNT(DISTINCT vd.FECHA) AS DiasVentaEnSemanaSinStock
      FROM Vta_detalle vd
      INNER JOIN #StockAmplioNuevo ss
          ON ss.Sucursal=vd.ESTAB AND ss.CodArticulo=vd.ARTCEGID AND ss.COLOR=vd.COLOR AND ss.TALLE=vd.TALLE
         AND vd.FECHA <= ss.FechaSemana AND vd.FECHA > DATEADD(DAY,-7,ss.FechaSemana) AND ss.StockSemana <= 0
      WHERE vd.ESTAB IS NOT NULL AND vd.FECHA >= @fechaDesdeAmplio
      GROUP BY vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE
  ),
  VentasA AS (
      SELECT ESTAB AS Sucursal, ARTCEGID AS CodArticulo, COLOR, TALLE,
             SUM(CASE WHEN ISNUMERIC(CANTIDAD)=1 THEN CAST(CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS VentasAmplio
      FROM Vta_detalle
      WHERE ESTAB IS NOT NULL AND FECHA >= @fechaDesdeAmplio
      GROUP BY ESTAB, ARTCEGID, COLOR, TALLE
  )
  SELECT b.Sucursal, b.CodArticulo, b.COLOR, b.TALLE,
         ISNULL(va.VentasAmplio,0) AS VentasAmplio,
         b.DiasConStockSemanal + ISNULL(c.DiasVentaEnSemanaSinStock,0) AS DiasConStockAmplio,
         @ahora AS FechaCalculo
  INTO #VelocidadAmpliaNueva
  FROM BaseA b
  LEFT JOIN CorreccionA c ON c.Sucursal=b.Sucursal AND c.CodArticulo=b.CodArticulo AND c.COLOR=b.COLOR AND c.TALLE=b.TALLE
  LEFT JOIN VentasA va ON va.Sucursal=b.Sucursal AND va.CodArticulo=b.CodArticulo AND va.COLOR=b.COLOR AND va.TALLE=b.TALLE;

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_VelocidadAmplia;
    INSERT INTO dbo.MotorReposicion_VelocidadAmplia (Sucursal, CodArticulo, COLOR, TALLE, VentasAmplio, DiasConStockAmplio, FechaCalculo)
    SELECT Sucursal, CodArticulo, COLOR, TALLE, VentasAmplio, DiasConStockAmplio, FechaCalculo
    FROM #VelocidadAmpliaNueva;
  COMMIT TRANSACTION;

  DROP TABLE #StockAmplioNuevo;
  DROP TABLE #VelocidadAmpliaNueva;

  -- Etapa 3: dias-con-stock POR SEMANA (dbo.MotorReposicion_DiasConStockPorSemana)
  IF OBJECT_ID('tempdb..#DiasConStockPorSemanaNuevo') IS NOT NULL DROP TABLE #DiasConStockPorSemanaNuevo;

  ;WITH PrimeraAceptacionH AS (
      SELECT destino AS Sucursal, arprove AS CodArticulo, color AS COLOR, talle AS TALLE, MIN(fecha) AS PrimeraAceptacion
      FROM dis_transf_recibidas GROUP BY destino, arprove, color, talle
  ),
  NumeradoH AS (
      SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, StockSemana,
             ROW_NUMBER() OVER (PARTITION BY Sucursal, CodArticulo, COLOR, TALLE ORDER BY FechaSemana) AS rn
      FROM dbo.MotorReposicion_StockSemanal
  ),
  ConAnteriorH AS (
      SELECT n.Sucursal, n.CodArticulo, n.COLOR, n.TALLE, n.FechaSemana, n.StockSemana,
             ant.FechaSemana AS FechaAnterior, ant.StockSemana AS StockAnterior
      FROM NumeradoH n
      LEFT JOIN NumeradoH ant ON ant.Sucursal=n.Sucursal AND ant.CodArticulo=n.CodArticulo AND ant.COLOR=n.COLOR AND ant.TALLE=n.TALLE AND ant.rn = n.rn - 1
  ),
  CorreccionH AS (
      SELECT vd.ESTAB AS Sucursal, vd.ARTCEGID AS CodArticulo, vd.COLOR, vd.TALLE, ss.FechaSemana,
             COUNT(DISTINCT vd.FECHA) AS DiasVentaEnSemanaSinStock
      FROM Vta_detalle vd
      INNER JOIN dbo.MotorReposicion_StockSemanal ss
          ON ss.Sucursal=vd.ESTAB AND ss.CodArticulo=vd.ARTCEGID AND ss.COLOR=vd.COLOR AND ss.TALLE=vd.TALLE
         AND vd.FECHA <= ss.FechaSemana AND vd.FECHA > DATEADD(DAY,-7,ss.FechaSemana) AND ss.StockSemana <= 0
      GROUP BY vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE, ss.FechaSemana
  ),
  -- CORRECCION (2026-09-04, a pedido explicito de Claudia con un caso real: KJ1736-1074/CORE
  -- BLACK-CLOUD WHITE-SILVER METAL/talle 8.5/Calzados 15 -- recibio el 16/06 en la semana que
  -- cierra el 20/06, pero esa semana entera (14/06-20/06) se contaba con los 7 dias completos,
  -- de mas los 2 dias antes de la recepcion real). Primera recepcion real DENTRO de cada semana
  -- (dis_transf_recibidas, misma tabla real usada en #UltimaAceptacion de server.js) -- solo
  -- importa para la semana que ARRANCA una racha nueva (la anterior estaba en quiebre o no
  -- existia todavia): si hay una recepcion real esa semana, se cuenta desde esa fecha hasta el
  -- cierre de semana en vez de acreditar los 7 dias completos a ciegas. Las semanas donde la
  -- racha YA venia con stock de la semana anterior no se tocan (siguen con DATEDIFF=7, ya son
  -- correctas). "Semana anterior sin ninguna foto" NO es un caso especial aparte: el relleno de
  -- huecos de la Etapa 1 ya garantiza una fila StockSemana=0 para toda semana sin stock dentro
  -- del rango de vida del combo, y la logica de abajo (FechaAnterior IS NULL OR StockAnterior<=0)
  -- ya cubre tanto "no hay fila anterior en absoluto" (primera semana historica) como "la fila
  -- anterior existe y esta en 0" -- exactamente lo mismo que ya distinguia el CASE original.
  RecepcionArranqueH AS (
      SELECT dt.destino AS Sucursal, dt.arprove AS CodArticulo, dt.color AS COLOR, dt.talle AS TALLE, ss.FechaSemana,
             MIN(dt.fecha) AS FechaRecepcionSemana
      FROM dis_transf_recibidas dt
      INNER JOIN dbo.MotorReposicion_StockSemanal ss
          ON ss.Sucursal=dt.destino AND ss.CodArticulo=dt.arprove AND ss.COLOR=dt.color AND ss.TALLE=dt.talle
         AND dt.fecha <= ss.FechaSemana AND dt.fecha > DATEADD(DAY,-7,ss.FechaSemana)
      GROUP BY dt.destino, dt.arprove, dt.color, dt.talle, ss.FechaSemana
  )
  SELECT ca.Sucursal, ca.CodArticulo, ca.COLOR, ca.TALLE, ca.FechaSemana,
         (CASE
            WHEN ca.FechaAnterior IS NOT NULL AND ca.StockAnterior > 0 AND ca.StockSemana > 0
                 AND (pa.PrimeraAceptacion IS NULL OR ca.FechaAnterior >= pa.PrimeraAceptacion)
              THEN DATEDIFF(DAY, ca.FechaAnterior, ca.FechaSemana)
            WHEN ca.StockSemana > 0 AND (pa.PrimeraAceptacion IS NULL OR ca.FechaSemana >= pa.PrimeraAceptacion)
              THEN CASE WHEN re.FechaRecepcionSemana IS NOT NULL THEN DATEDIFF(DAY, re.FechaRecepcionSemana, ca.FechaSemana) + 1 ELSE 7 END
            ELSE 0
          END) + ISNULL(c.DiasVentaEnSemanaSinStock,0) AS DiasConStockContribucion,
         CASE
           WHEN ca.StockSemana <= 0 AND (pa.PrimeraAceptacion IS NULL OR ca.FechaSemana >= pa.PrimeraAceptacion)
             THEN CASE WHEN 7 - ISNULL(c.DiasVentaEnSemanaSinStock,0) < 0 THEN 0 ELSE 7 - ISNULL(c.DiasVentaEnSemanaSinStock,0) END
           ELSE 0
         END AS DiasQuiebreContribucion,
         @ahora AS FechaCalculo
  INTO #DiasConStockPorSemanaNuevo
  FROM ConAnteriorH ca
  LEFT JOIN PrimeraAceptacionH pa ON pa.Sucursal=ca.Sucursal AND pa.CodArticulo=ca.CodArticulo AND pa.COLOR=ca.COLOR AND pa.TALLE=ca.TALLE
  LEFT JOIN CorreccionH c ON c.Sucursal=ca.Sucursal AND c.CodArticulo=ca.CodArticulo AND c.COLOR=ca.COLOR AND c.TALLE=ca.TALLE AND c.FechaSemana=ca.FechaSemana
  LEFT JOIN RecepcionArranqueH re ON re.Sucursal=ca.Sucursal AND re.CodArticulo=ca.CodArticulo AND re.COLOR=ca.COLOR AND re.TALLE=ca.TALLE AND re.FechaSemana=ca.FechaSemana;

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_DiasConStockPorSemana;
    INSERT INTO dbo.MotorReposicion_DiasConStockPorSemana (Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, DiasConStockContribucion, DiasQuiebreContribucion, FechaCalculo)
    SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaSemana, DiasConStockContribucion, DiasQuiebreContribucion, FechaCalculo
    FROM #DiasConStockPorSemanaNuevo;
  COMMIT TRANSACTION;

  DROP TABLE #DiasConStockPorSemanaNuevo;

  -- Etapa 4: "hoy" precalculado (dbo.MotorReposicion_CatalogoValido / _UniversoHoy / _DepositoHoy)
  IF OBJECT_ID('tempdb..#CatalogoValidoNuevo') IS NOT NULL DROP TABLE #CatalogoValidoNuevo;
  ;WITH CatDedup AS (
      SELECT GA_CODEARTICLE AS CodArticulo, COLOR, TALLE, NOMBREART, NOMPROV, NOMLINEA, NOMFLIA, PVP_VIGENTE, COSTO_UNI,
             ROW_NUMBER() OVER (PARTITION BY GA_CODEARTICLE, COLOR, TALLE ORDER BY (SELECT NULL)) AS rn
      FROM cgd_ARTICULOS
      WHERE GA_CODEARTICLE IS NOT NULL AND COLOR IS NOT NULL AND TALLE IS NOT NULL
        AND UPPER(ISNULL(PERTARIFA, '')) NOT LIKE '%LIQUI%'
  )
  SELECT CodArticulo, COLOR, TALLE, NOMBREART, NOMPROV, NOMLINEA, NOMFLIA, PVP_VIGENTE, COSTO_UNI
  INTO #CatalogoValidoNuevo FROM CatDedup WHERE rn = 1;

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_CatalogoValido;
    INSERT INTO dbo.MotorReposicion_CatalogoValido (CodArticulo, COLOR, TALLE, NOMBREART, NOMPROV, NOMLINEA, NOMFLIA, PVP_VIGENTE, COSTO_UNI)
    SELECT CodArticulo, COLOR, TALLE, NOMBREART, NOMPROV, NOMLINEA, NOMFLIA, PVP_VIGENTE, COSTO_UNI
    FROM #CatalogoValidoNuevo;
  COMMIT TRANSACTION;

  IF OBJECT_ID('tempdb..#UniversoHoyNuevo') IS NOT NULL DROP TABLE #UniversoHoyNuevo;
  SELECT f.Sucursal, f.artprove AS CodArticulo, f.color AS COLOR, f.talle AS TALLE,
         SUM(CASE WHEN ISNUMERIC(f.stock)=1 THEN CAST(f.stock AS DECIMAL(18,4)) ELSE 0 END) AS StockTienda
  INTO #UniversoHoyNuevo
  FROM FOTOSTOCK_Diaria f
  INNER JOIN Sucursales s ON s.Sucursal = f.Sucursal AND (s.viewSuc='S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
  INNER JOIN #CatalogoValidoNuevo cv ON cv.CodArticulo = f.artprove AND cv.COLOR = f.color AND cv.TALLE = f.talle
  WHERE f.Tipo = 'STOCK' AND f.Sucursal NOT IN ('000098','000099')
  GROUP BY f.Sucursal, f.artprove, f.color, f.talle;

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_UniversoHoy;
    INSERT INTO dbo.MotorReposicion_UniversoHoy (Sucursal, CodArticulo, COLOR, TALLE, StockTienda)
    SELECT Sucursal, CodArticulo, COLOR, TALLE, StockTienda
    FROM #UniversoHoyNuevo;
  COMMIT TRANSACTION;

  IF OBJECT_ID('tempdb..#DepositoHoyNuevo') IS NOT NULL DROP TABLE #DepositoHoyNuevo;
  SELECT artprove AS CodArticulo, color AS COLOR, talle AS TALLE,
         SUM(CASE WHEN Sucursal='000098' AND ISNUMERIC(stock)=1 THEN CAST(stock AS DECIMAL(18,4)) ELSE 0 END) AS DepositoTESI,
         SUM(CASE WHEN Sucursal='000099' AND ISNUMERIC(stock)=1 THEN CAST(stock AS DECIMAL(18,4)) ELSE 0 END) AS DepositoPUEBLO
  INTO #DepositoHoyNuevo
  FROM FOTOSTOCK_Diaria
  WHERE Tipo='STOCK' AND Sucursal IN ('000098','000099')
  GROUP BY artprove, color, talle;

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_DepositoHoy;
    INSERT INTO dbo.MotorReposicion_DepositoHoy (CodArticulo, COLOR, TALLE, DepositoTESI, DepositoPUEBLO)
    SELECT CodArticulo, COLOR, TALLE, DepositoTESI, DepositoPUEBLO
    FROM #DepositoHoyNuevo;
  COMMIT TRANSACTION;

  DROP TABLE #CatalogoValidoNuevo;
  DROP TABLE #UniversoHoyNuevo;
  DROP TABLE #DepositoHoyNuevo;

  -- Etapa 5 (NUEVA): ultima COMPRA real por SKU (dbo.MotorReposicion_UltimaRecepcion) -- fuente
  -- real de "Fecha de ultima compra". dis_recepciones es la recepcion real de mercaderia comprada
  -- al proveedor en el deposito de cada empresa (confirmado: NO es aceptacion de transferencia en
  -- la sucursal, es la fuente correcta) -- MAX(fecha) agrupado por articulo/color/talle/nomemp. La
  -- clave de catalogo en esta tabla es "articulo" (NO "artprove", que en dis_recepciones es el
  -- codigo del proveedor y no matchea cgd_ARTICULOS -- confirmado con datos reales: articulo
  -- matchea 27.567/27.586 codigos contra GA_CODEARTICLE, artprove matchea solo 63/26.903).
  -- La compra es por EMPRESA (deposito 98=Tesi, 99=Pueblo, mas 96/198 que son el mismo par bajo
  -- otro codigo de deposito) -- no por sucursal individual -- asi que la misma fecha se expande a
  -- todas las sucursales de esa empresa. Cobertura real confirmada contra la poblacion en QUIEBRE:
  -- 95.6% (73.998 de 77.380).
  IF OBJECT_ID('tempdb..#UltimaRecepcionNueva') IS NOT NULL DROP TABLE #UltimaRecepcionNueva;
  ;WITH RecepcionPorEmpresa AS (
      SELECT articulo AS CodArticulo, color AS COLOR, talle AS TALLE,
             UPPER(LTRIM(RTRIM(nomemp))) AS EmpresaNorm,
             MAX(fecha) AS FechaUltimaCompra
      FROM dis_recepciones
      GROUP BY articulo, color, talle, nomemp
  )
  SELECT s.Sucursal, r.CodArticulo, r.COLOR, r.TALLE, r.FechaUltimaCompra
  INTO #UltimaRecepcionNueva
  FROM RecepcionPorEmpresa r
  INNER JOIN Sucursales s
    ON UPPER(LTRIM(RTRIM(s.Empresa))) = r.EmpresaNorm
   AND (s.viewSuc = 'S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111'))
   AND s.Sucursal NOT IN ('000226','000235');

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_UltimaRecepcion;
    INSERT INTO dbo.MotorReposicion_UltimaRecepcion (Sucursal, CodArticulo, COLOR, TALLE, FechaUltimaCompra)
    SELECT Sucursal, CodArticulo, COLOR, TALLE, FechaUltimaCompra
    FROM #UltimaRecepcionNueva;
  COMMIT TRANSACTION;

  DROP TABLE #UltimaRecepcionNueva;

  -- Etapa 6 (NUEVA, 2026-09-12): evidencia historica completa por combo
  -- (dbo.MotorReposicion_EvidenciaHistorica) -- soporta el ajuste "evidencia historica" de la
  -- necesidad de compra (server.js, ver el comentario completo junto a #CandidatosEvidenciaHistorica
  -- en QUERY_QUIEBRE_DETALLE): antes esto se recalculaba en VIVO en cada request (agregando
  -- Vta_detalle/MotorReposicion_DiasConStockPorSemana enteras, aunque acotado a un preseleccionado
  -- de candidatos) -- ahora se precalcula UNA vez por noche para todo el catalogo, y el request en
  -- vivo solo hace un LEFT JOIN chico contra esta tabla ya lista, sin tocar Vta_detalle ni
  -- MotorReposicion_DiasConStockPorSemana en el camino en vivo. Se apoya en
  -- dbo.MotorReposicion_DiasConStockPorSemana YA actualizada por la Etapa 3 de arriba, en esta
  -- misma corrida -- coherente con el resto del precalculo de esta noche.
  -- estab IN ('000098','000099') en PrimeraAceptacionDepositoP: solo cuenta como "existia antes" si
  -- la aceptacion vino de un deposito real, no de un traspaso sucursal-a-sucursal (mismo criterio
  -- que server.js, ver el comentario junto al INSERT de #Universo criterio 2 en QUERY_QUIEBRE_DETALLE).
  -- TodosLosCombos (2026-09-13, a pedido explicito, para SinEvidenciaRealStock mas abajo): la
  -- tabla ya no se arma solo a partir de StockHistoricoP (combos con AL MENOS una fila en
  -- DiasConStockPorSemana) -- un combo que nunca aparecio en ninguna foto de stock (FotoStock) NI
  -- tuvo una recepcion real, pero SI tuvo venta real, antes quedaba directamente afuera de esta
  -- tabla (0 filas, invisible para la alerta). Ahora la tabla cubre la union de las 3 fuentes de
  -- evidencia (mismo criterio que el universo de server.js: dias con stock, aceptacion real, venta
  -- real) para que SinEvidenciaRealStock pueda marcar tambien esos casos extremos.
  IF OBJECT_ID('tempdb..#EvidenciaHistoricaNueva') IS NOT NULL DROP TABLE #EvidenciaHistoricaNueva;

  -- ISNULL en COLOR/TALLE (2026-09-13, corrigiendo un bug real: "Cannot insert the value NULL
  -- into column 'TALLE'" -- color/talle SI pueden venir NULL en dis_transf_recibidas/Vta_detalle
  -- crudas, a diferencia de MotorReposicion_DiasConStockPorSemana, que ya los normaliza desde la
  -- Etapa 1). TALLE es parte de la clave primaria de MotorReposicion_EvidenciaHistorica -- SQL
  -- Server no permite NULL en una columna de PK, el INSERT fallaba. Mismo patron ya usado en la
  -- Etapa 1 (ISNULL(fs.artprove,''), etc.).
  ;WITH TodosLosCombos AS (
      SELECT Sucursal, CodArticulo, COLOR, TALLE FROM dbo.MotorReposicion_DiasConStockPorSemana GROUP BY Sucursal, CodArticulo, COLOR, TALLE
      UNION
      SELECT destino, ISNULL(arprove,''), ISNULL(color,''), ISNULL(talle,'') FROM dis_transf_recibidas WHERE destino IS NOT NULL GROUP BY destino, ISNULL(arprove,''), ISNULL(color,''), ISNULL(talle,'')
      UNION
      SELECT ESTAB, ISNULL(ARTCEGID,''), ISNULL(COLOR,''), ISNULL(TALLE,'') FROM Vta_detalle WHERE ESTAB IS NOT NULL GROUP BY ESTAB, ISNULL(ARTCEGID,''), ISNULL(COLOR,''), ISNULL(TALLE,'')
  ),
  StockHistoricoP AS (
      SELECT Sucursal, CodArticulo, COLOR, TALLE,
             SUM(DiasConStockContribucion) AS DiasConStockHistorico,
             MIN(CASE WHEN DiasConStockContribucion > 0 THEN FechaSemana END) AS PrimeraStockSemana
      FROM dbo.MotorReposicion_DiasConStockPorSemana
      GROUP BY Sucursal, CodArticulo, COLOR, TALLE
  ),
  -- Evidencia REAL de stock (2026-09-13, para SinEvidenciaRealStock mas abajo): MAX(StockSemana)
  -- de dbo.MotorReposicion_StockSemanal (la foto real, ANTES de que la Etapa 3 le sume el rescate
  -- por venta) -- a diferencia de StockHistoricoP.DiasConStockHistorico, que YA incluye el rescate
  -- y por eso no sirve para distinguir "evidencia real" de "puro rescate por venta" (ver caso real
  -- DINK-6128/NEGRO/Calzados 02: dias con stock en DiasConStockHistorico > 0, pero 0 fotos reales
  -- con stock>0 -- esos dias son 100% rescate).
  StockRealP AS (
      SELECT Sucursal, CodArticulo, COLOR, TALLE, MAX(StockSemana) AS MaxStockRealAlgunaVez
      FROM dbo.MotorReposicion_StockSemanal
      GROUP BY Sucursal, CodArticulo, COLOR, TALLE
  ),
  -- Mismo ISNULL en COLOR/TALLE que en TodosLosCombos, arriba -- para que el JOIN contra esa CTE
  -- (por las 4 claves) matchee correctamente en vez de comparar NULL contra '' en silencio.
  PrimeraAceptacionDepositoP AS (
      SELECT destino AS Sucursal, ISNULL(arprove,'') AS CodArticulo, ISNULL(color,'') AS COLOR, ISNULL(talle,'') AS TALLE, MIN(fecha) AS PrimeraAceptacionDeposito
      FROM dis_transf_recibidas
      WHERE destino IS NOT NULL AND estab IN ('000098','000099')
      GROUP BY destino, ISNULL(arprove,''), ISNULL(color,''), ISNULL(talle,'')
  ),
  -- FECHA >= @fechaDesde (2026-09-12, a pedido explicito): antes esta ventana no tenia limite de
  -- fecha (todo el historico de Vta_detalle), mientras que DiasConStockHistorico (arriba) ya venia
  -- acotado a @fechaDesde -- una asimetria real entre numerador y denominador de la Vd de
  -- "evidencia historica" (caso real: DINK-6128/Calzados 13, donde el numerador incluia ventas de
  -- una ventana que el denominador ya no cubria). Ahora ambos usan la misma ventana de @fechaDesde
  -- (ver el valor actual junto a la declaracion de @fechaDesde, arriba del todo en este archivo).
  -- Mismo ISNULL en COLOR/TALLE que en TodosLosCombos, arriba.
  VentasHistoricoP AS (
      SELECT ESTAB AS Sucursal, ISNULL(ARTCEGID,'') AS CodArticulo, ISNULL(COLOR,'') AS COLOR, ISNULL(TALLE,'') AS TALLE,
             SUM(CASE WHEN ISNUMERIC(CANTIDAD)=1 THEN CAST(CANTIDAD AS DECIMAL(18,4)) ELSE 0 END) AS VentasHistoricoTotal
      FROM Vta_detalle
      WHERE ESTAB IS NOT NULL AND FECHA >= @fechaDesde
      GROUP BY ESTAB, ISNULL(ARTCEGID,''), ISNULL(COLOR,''), ISNULL(TALLE,'')
  )
  SELECT t.Sucursal, t.CodArticulo, t.COLOR, t.TALLE,
         ISNULL(vh.VentasHistoricoTotal,0) AS VentasHistoricoTotal,
         -- ISNULL (2026-09-13, corrigiendo un bug real): con TodosLosCombos (union de las 3
         -- fuentes) puede haber filas sin match en StockHistoricoP (combo que solo tiene venta o
         -- aceptacion, nunca aparecio en DiasConStockPorSemana) -- sh.DiasConStockHistorico queda
         -- NULL para esas, y la columna real no admite nulos (INSERT fallaba). 0 dias con stock
         -- historico es ademas semanticamente correcto para ese caso: no hay ninguna evidencia de
         -- stock, ni siquiera por rescate de venta.
         ISNULL(sh.DiasConStockHistorico,0) AS DiasConStockHistorico,
         sh.PrimeraStockSemana,
         pad.PrimeraAceptacionDeposito,
         -- Alerta "sin evidencia real de stock" (2026-09-13, a pedido explicito, caso real
         -- DINK-6128/NEGRO/Calzados 02): 1 si este combo NUNCA tuvo una foto de stock >0
         -- (FotoStock, via MotorReposicion_StockSemanal) NI una aceptacion real de deposito, en
         -- toda su vida -- si tiene algun "dia con stock" en DiasConStockHistorico, ese dia es
         -- 100% inferido por venta (rescate de la Etapa 3), no respaldado por evidencia real. El
         -- frontend solo muestra la marca cuando ADEMAS esta fila tiene algo real para comprar
         -- (comprar>0) -- medido antes de implementar: de 478.375 filas Quiebre/Riesgo/OK, 289.685
         -- caen aca sin evidencia, pero solo 312 tienen Vd>0 (generan una sugerencia de compra real
         -- construida sobre esa evidencia floja) -- ese filtro se aplica en el frontend, no aca.
         CASE WHEN ISNULL(sr.MaxStockRealAlgunaVez,0) <= 0 AND pad.PrimeraAceptacionDeposito IS NULL
              THEN 1 ELSE 0 END AS SinEvidenciaRealStock,
         @ahora AS FechaCalculo
  INTO #EvidenciaHistoricaNueva
  FROM TodosLosCombos t
  LEFT JOIN StockHistoricoP sh ON sh.Sucursal=t.Sucursal AND sh.CodArticulo=t.CodArticulo AND sh.COLOR=t.COLOR AND sh.TALLE=t.TALLE
  LEFT JOIN StockRealP sr ON sr.Sucursal=t.Sucursal AND sr.CodArticulo=t.CodArticulo AND sr.COLOR=t.COLOR AND sr.TALLE=t.TALLE
  LEFT JOIN PrimeraAceptacionDepositoP pad ON pad.Sucursal=t.Sucursal AND pad.CodArticulo=t.CodArticulo AND pad.COLOR=t.COLOR AND pad.TALLE=t.TALLE
  LEFT JOIN VentasHistoricoP vh ON vh.Sucursal=t.Sucursal AND vh.CodArticulo=t.CodArticulo AND vh.COLOR=t.COLOR AND vh.TALLE=t.TALLE
  -- MAXDOP 1 (2026-09-13, a pedido explicito): este SELECT INTO puntual se atasco DOS veces
  -- seguidas en CXPACKET (coordinacion entre hilos paralelos), con ventanas de @fechaDesde
  -- distintas (24 y 18 meses) -- el atasco no dependia del volumen de datos, sino de la ejecucion
  -- en paralelo de esta consulta puntual (UNION de 3 fuentes + 4 LEFT JOIN). Forzar serial (un solo
  -- hilo) evita esa sincronizacion -- mas lento en teoria, pero confiable (no se cuelga esperando
  -- a otros hilos bajo contencion real del servidor).
  OPTION (MAXDOP 1);

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_EvidenciaHistorica;
    INSERT INTO dbo.MotorReposicion_EvidenciaHistorica (Sucursal, CodArticulo, COLOR, TALLE, VentasHistoricoTotal, DiasConStockHistorico, PrimeraStockSemana, PrimeraAceptacionDeposito, SinEvidenciaRealStock, FechaCalculo)
    SELECT Sucursal, CodArticulo, COLOR, TALLE, VentasHistoricoTotal, DiasConStockHistorico, PrimeraStockSemana, PrimeraAceptacionDeposito, SinEvidenciaRealStock, FechaCalculo
    FROM #EvidenciaHistoricaNueva;
  COMMIT TRANSACTION;

  DROP TABLE #EvidenciaHistoricaNueva;

  -- Etapa 7 (NUEVA, 2026-08-31, a pedido explicito: "reducir los tiempos al cambiar los filtros
  -- de fecha"): universo COMPLETO de sucursal x SKU (dbo.MotorReposicion_UniversoCompleto).
  -- Hasta ahora, QUERY_QUIEBRE_DETALLE (server.js) armaba esto EN VIVO en cada request -- union de
  -- (1) stock hoy, MotorReposicion_UniversoHoy, (2) alguna vez recibio esa talla por transferencia
  -- real desde deposito, dis_transf_recibidas, (3) alguna vez tuvo una venta real ahi, Vta_detalle,
  -- SIN acotar fecha en NINGUNA de las 3 fuentes -- ver el comentario completo junto a #Universo en
  -- QUERY_QUIEBRE_DETALLE, con la historia completa de por que existen esas 3 fuentes. Medido con
  -- datos reales: armar esto en vivo tardaba ~10s de los ~31s de calculo total -- pero el resultado
  -- es IDENTICO para cualquier combinacion de Periodo de ventas/Fecha de ultima compra (no depende
  -- de ningun filtro), asi que se reconstruia entero en CADA cambio de filtro sin ninguna razon
  -- para que cambiara. Se precalcula ahora, en la MISMA corrida que MotorReposicion_UniversoHoy
  -- (Etapa 4, arriba) -- mismo "hoy" congelado, sin perdida de frescura real: UniversoHoy tampoco
  -- cambia intradia, asi que juntarlos en el mismo momento nocturno no atrasa nada que hoy ya
  -- estuviera al dia. QUERY_ARTICULO_COMPLETO (un solo articulo, ya acotada por @modelo y por eso
  -- rapida) NO se toco -- no tenia este problema, y tocarla hoy no traia ningun beneficio medido.
  IF OBJECT_ID('tempdb..#UniversoCompletoNuevo') IS NOT NULL DROP TABLE #UniversoCompletoNuevo;

  SELECT Sucursal, CodArticulo, COLOR, TALLE, StockTienda
  INTO #UniversoCompletoNuevo
  FROM dbo.MotorReposicion_UniversoHoy;

  INSERT INTO #UniversoCompletoNuevo (Sucursal, CodArticulo, COLOR, TALLE, StockTienda)
  SELECT DISTINCT dt.destino, dt.arprove, dt.color, dt.talle, 0
  FROM dis_transf_recibidas dt
  INNER JOIN Sucursales s ON s.Sucursal = dt.destino AND (s.viewSuc = 'S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
  INNER JOIN dbo.MotorReposicion_CatalogoValido cv ON cv.CodArticulo = dt.arprove AND cv.COLOR = dt.color AND cv.TALLE = dt.talle
  WHERE dt.destino IS NOT NULL AND dt.estab IN ('000098','000099')
    AND NOT EXISTS (SELECT 1 FROM #UniversoCompletoNuevo u WHERE u.Sucursal = dt.destino AND u.CodArticulo = dt.arprove AND u.COLOR = dt.color AND u.TALLE = dt.talle);

  INSERT INTO #UniversoCompletoNuevo (Sucursal, CodArticulo, COLOR, TALLE, StockTienda)
  SELECT DISTINCT vd.ESTAB, vd.ARTCEGID, vd.COLOR, vd.TALLE, 0
  FROM Vta_detalle vd
  INNER JOIN Sucursales s ON s.Sucursal = vd.ESTAB AND (s.viewSuc = 'S' OR s.Sucursal IN ('WEB','WEB2','ML1','ML2','FK','000102','000111')) AND s.Sucursal NOT IN ('000226','000235')
  INNER JOIN dbo.MotorReposicion_CatalogoValido cv ON cv.CodArticulo = vd.ARTCEGID AND cv.COLOR = vd.COLOR AND cv.TALLE = vd.TALLE
  WHERE vd.ESTAB IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM #UniversoCompletoNuevo u WHERE u.Sucursal = vd.ESTAB AND u.CodArticulo = vd.ARTCEGID AND u.COLOR = vd.COLOR AND u.TALLE = vd.TALLE);

  BEGIN TRANSACTION;
    TRUNCATE TABLE dbo.MotorReposicion_UniversoCompleto;
    INSERT INTO dbo.MotorReposicion_UniversoCompleto (Sucursal, CodArticulo, COLOR, TALLE, StockTienda, FechaCalculo)
    SELECT Sucursal, CodArticulo, COLOR, TALLE, StockTienda, @ahora
    FROM #UniversoCompletoNuevo;
  COMMIT TRANSACTION;

  DROP TABLE #UniversoCompletoNuevo;
END
