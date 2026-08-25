


CREATE PROCEDURE [dbo].[SP_INSERTAR_TEMP_BI_EN_OBJ_PUEBLO_TESI] @anomes INT
AS

--DECLARE @anomes INT = 202207
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
WHERE id_mes = @anomes; --AND id_sucursal IN (SELECT DISTINCT id_sucursal FROM dbo.f_objetivos_TEMP AS fot WHERE @anomes = @anomes)

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
--DECLARE @anomes INT =202209
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
                AND ls.id_sucursal NOT IN ( 37, 38, 63, 64 ) THEN --excluyo las sucursales de ecommerce para que tengan 0 en [obj_margen_ope_por]
               '0.015' -- antes 0.012 --despues 0.015 ---pueblo
           WHEN ls.id_sucursal IN ( 37, 38, 63, 64, 74 ) THEN
               '0.01'  --ecommerce
           ELSE
               '0.00'  --tesi
       END,
       CASE
           WHEN ls.id_empresa = 1
                AND ls.id_sucursal NOT IN ( 37, 38, 63, 64 ) THEN --excluyo las sucursales de ecommerce para que mantenga el margen del archivo enviado
               CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.')) + '0.015' -- antes 0.012 --despues 0.015 --depsues 0.023 -recien 0.15
           WHEN ls.id_sucursal IN ( 37, 38, 63, 64, 74 ) THEN
               CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.')) + '0.01'  --ecommerce
           ELSE
               CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.'))           --TESI
       END,
       CASE
           WHEN ls.id_empresa = 1
                AND ls.id_sucursal NOT IN ( 37, 38, 63, 64 ) THEN --excluyo las sucursales de ecommerce para que mantenga el margen del archivo enviado

               CONVERT(
                          DECIMAL(18, 2),
                          CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj sin IVA], ',', '.'))
                          * (CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.')) + '0.015')
                      ) --sucursales PUEBLO
           WHEN ls.id_sucursal IN ( 37, 38, 63, 64, 74 ) THEN
               CONVERT(
                          DECIMAL(18, 2),
                          CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj sin IVA], ',', '.'))
                          * (CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.')) + '0.01')
                      ) --ecommerce
           ELSE
               CONVERT(
                          DECIMAL(18, 2),
                          CONVERT(DECIMAL(18, 2), REPLACE(tba.[Obj sin IVA], ',', '.'))
                          * CONVERT(DECIMAL(18, 4), REPLACE(tba.Margen, ',', '.'))
                      ) --sucursales TESI
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
--AND id_sucursal IN(52)

DELETE FROM dbo.f_dias_habiles_TEMP
WHERE id_mes = @anomes; -- es mejor que siempre borre de la tempo los datos para que los nuevos sean los que se hayan cargado recien en la app.
INSERT INTO [f_dias_habiles_TEMP]
SELECT tmp.anomes,
       ls.id_sucursal,
       CONVERT(DECIMAL(10, 2), tmp.DIAS)
FROM TEMP_BI_APP tmp
    INNER JOIN dw_vallejo.dbo.l_sucursal AS ls
        ON ls.cod_sucursal = tmp.SUCURSAL COLLATE SQL_Latin1_General_CP1_CI_AS
           OR ls.cod_sucursal = '0' + tmp.SUCURSAL COLLATE SQL_Latin1_General_CP1_CI_AS
WHERE anomes = @anomes;



--INSERT INTO dw_vallejo.dbo.f_objetivos
--SELECT * FROM dbo.f_objetivos_TEMP AS fot WHERE fot.id_mes = 202606;

--INSERT INTO dw_vallejo.dbo.f_dias_habiles (id_mes, id_sucursal, dias_habiles)
--SELECT * FROM dbo.f_dias_habiles_TEMP AS fdht WHERE fdht.id_mes = 202606 AND fdht.id_sucursal NOT IN (SELECT id_sucursal FROM dw_vallejo.dbo.f_dias_habiles WHERE id_mes = 202606)
