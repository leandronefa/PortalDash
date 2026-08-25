-- Copia de dbo.SP_INSERTAR_TEMP_BI_EN_OBJ_PUEBLO_TESI (db_Cegid), para uso
-- exclusivo del dashboard VentaObjetivo. El SP original NO se toca.
--
-- Diferencias contra el original (ver sp-original-referencia.sql):
--   1) Las dos secciones finales (push a dw_vallejo.f_objetivos y
--      dw_vallejo.f_dias_habiles) estaban comentadas en el original —acá
--      quedan activas.
--   2) Esas dos secciones tenían el mes hardcodeado en 202606 — acá usan
--      @anomes, para poder llamarse con cualquier mes.
--   3) Se agregó un DELETE previo (acotado a las sucursales que trae
--      f_objetivos_TEMP / f_dias_habiles_TEMP para @anomes) antes de cada
--      INSERT a la tabla real, para poder re-ejecutar el SP sin duplicar
--      filas (ej. guardar Pueblo y más tarde guardar Tesi para el mismo mes).
--
-- Resto de la lógica (traducción de siglas viejas, cálculo de obj_margen_por/
-- obj_margen_ope_por con el ajuste fijo por empresa/canal, etc.) es idéntica
-- al original.

IF OBJECT_ID('dbo.SP_INSERTAR_TEMP_BI_EN_OBJ_PUEBLO_TESI_DASHBOARD', 'P') IS NOT NULL
    DROP PROCEDURE dbo.SP_INSERTAR_TEMP_BI_EN_OBJ_PUEBLO_TESI_DASHBOARD;
GO

CREATE PROCEDURE [dbo].[SP_INSERTAR_TEMP_BI_EN_OBJ_PUEBLO_TESI_DASHBOARD] @anomes INT
AS

UPDATE dbo.TEMP_BI_APP
SET SUCURSAL = 'E1'
WHERE SUCURSAL = 'ML'
      AND anomes = @anomes;
UPDATE dbo.TEMP_BI_APP
SET SUCURSAL = 'E2'
WHERE SUCURSAL = 'MLV'
      AND anomes = @anomes;
UPDATE dbo.TEMP_BI_APP
SET SUCURSAL = 'WE1'
WHERE SUCURSAL = 'Web SPT'
      AND anomes = @anomes;
UPDATE dbo.TEMP_BI_APP
SET SUCURSAL = 'WE2'
WHERE SUCURSAL = 'WEBV'
      AND anomes = @anomes;
UPDATE dbo.TEMP_BI_APP
SET SUCURSAL = 'FK1'
WHERE SUCURSAL = 'WEB FK'
      AND anomes = @anomes;


DELETE FROM dbo.f_objetivos_TEMP
WHERE id_mes = @anomes;

INSERT INTO [dbo].[f_objetivos_TEMP]
(
    [id_mes],
    [id_sucursal],
    [id_vendedor],
    [obj_vtas_pesos],
    [obj_vtas_sin_iva],
    [obj_vtas_con_iva],
    [obj_vta_diaria_sin_iva],
    [obj_vta_diaria_con_iva],
    [obj_unidades_vtas],
    [obj_par_promedio],
    [obj_operaciones],
    [obj_ticket_promedio],
    [obj_unidades_operacion],
    [obj_margen_ope_por],
    [obj_margen_por],
    [obj_margen_pesos],
    [obj_gmroi],
    [obj_gimros],
    [obj_gmrol],
    [obj_intencidad_pesos],
    [obj_stock_promedio_pesos],
    [obj_stock_promedio_unidades],
    [obj_intencidad_unidades],
    [obj_unidades_clientes],
    [id_tipo_credito]
)
SELECT @anomes,
       ls.id_sucursal,
       0,
       CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj sin IVA], ',', '.')),
       CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj sin IVA], ',', '.')),
       CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj con IVA], ',', '.')),
       CONVERT(DECIMAL(18, 2), REPLACE(tba.[Diario sin IVA], ',', '.')),
       CONVERT(DECIMAL(18, 2), REPLACE(tba.[Diario con IVA], ',', '.')),
       CONVERT(DECIMAL(18, 2), REPLACE(tba.Unidades, ',', '.')),
       CONVERT(
                  DECIMAL(18, 2),
                  CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj con IVA], ',', '.'))
                  / CONVERT(DECIMAL(18, 2), REPLACE(tba.Unidades, ',', '.'))
              ),
       CONVERT(DECIMAL(18, 2), REPLACE(tba.Operaciones, ',', '.')),
       CONVERT(
                  DECIMAL(10, 2),
                  CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj con IVA], ',', '.'))
                  / CONVERT(DECIMAL(18, 2), REPLACE(tba.Operaciones, ',', '.'))
              ),
       CONVERT(DECIMAL(18, 2), REPLACE(tba.UnidadesOperacion, ',', '.')),
       CASE
           WHEN ls.id_empresa = 1
                AND ls.id_sucursal NOT IN ( 37, 38, 63, 64 ) THEN
               '0.015' -- pueblo
           WHEN ls.id_sucursal IN ( 37, 38, 63, 64, 74 ) THEN
               '0.01'  -- ecommerce
           ELSE
               '0.00'  -- tesi
       END,
       CASE
           WHEN ls.id_empresa = 1
                AND ls.id_sucursal NOT IN ( 37, 38, 63, 64 ) THEN
               CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.')) + '0.015'
           WHEN ls.id_sucursal IN ( 37, 38, 63, 64, 74 ) THEN
               CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.')) + '0.01'
           ELSE
               CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.'))
       END,
       CASE
           WHEN ls.id_empresa = 1
                AND ls.id_sucursal NOT IN ( 37, 38, 63, 64 ) THEN
               CONVERT(
                          DECIMAL(18, 2),
                          CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj sin IVA], ',', '.'))
                          * (CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.')) + '0.015')
                      )
           WHEN ls.id_sucursal IN ( 37, 38, 63, 64, 74 ) THEN
               CONVERT(
                          DECIMAL(18, 2),
                          CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj sin IVA], ',', '.'))
                          * (CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.')) + '0.01')
                      )
           ELSE
               CONVERT(
                          DECIMAL(18, 2),
                          CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj sin IVA], ',', '.'))
                          * CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.'))
                      )
       END,
       '0.00',
       CONVERT(DECIMAL(18, 2), REPLACE(ISNULL(tba.GMROS, 0), ',', '.')),
       '0.00',
       '0.00',
       '0.00',
       '0.00',
       '0.00',
       CONVERT(DECIMAL(18, 2), REPLACE(tba.UnidadesOperacion, ',', '.')),
       NULL
FROM dbo.TEMP_BI_APP AS tba
    INNER JOIN dw_vallejo.dbo.l_sucursal AS ls
        ON ls.cod_sucursal = tba.SUCURSAL COLLATE SQL_Latin1_General_CP1_CI_AS
           OR ls.cod_sucursal = '0' + tba.SUCURSAL COLLATE SQL_Latin1_General_CP1_CI_AS
WHERE tba.anomes = @anomes;

DELETE FROM dbo.f_dias_habiles_TEMP
WHERE id_mes = @anomes;
INSERT INTO [f_dias_habiles_TEMP]
SELECT tmp.anomes,
       ls.id_sucursal,
       CONVERT(DECIMAL(10, 2), tmp.DIAS)
FROM TEMP_BI_APP tmp
    INNER JOIN dw_vallejo.dbo.l_sucursal AS ls
        ON ls.cod_sucursal = tmp.SUCURSAL COLLATE SQL_Latin1_General_CP1_CI_AS
           OR ls.cod_sucursal = '0' + tmp.SUCURSAL COLLATE SQL_Latin1_General_CP1_CI_AS
WHERE anomes = @anomes;


-- ── Activado (estaba comentado en el original) + parametrizado + con DELETE
--    previo acotado a las sucursales de este lote, para poder re-ejecutar
--    el SP sin duplicar filas en las tablas reales. ─────────────────────────
DELETE FROM dw_vallejo.dbo.f_objetivos
WHERE id_mes = @anomes
      AND id_vendedor = 0
      AND id_sucursal IN (SELECT id_sucursal FROM dbo.f_objetivos_TEMP WHERE id_mes = @anomes);

INSERT INTO dw_vallejo.dbo.f_objetivos
SELECT * FROM dbo.f_objetivos_TEMP AS fot WHERE fot.id_mes = @anomes;

DELETE FROM dw_vallejo.dbo.f_dias_habiles
WHERE id_mes = @anomes
      AND id_sucursal IN (SELECT id_sucursal FROM dbo.f_dias_habiles_TEMP WHERE id_mes = @anomes);

INSERT INTO dw_vallejo.dbo.f_dias_habiles (id_mes, id_sucursal, dias_habiles)
SELECT * FROM dbo.f_dias_habiles_TEMP AS fdht WHERE fdht.id_mes = @anomes;
GO
