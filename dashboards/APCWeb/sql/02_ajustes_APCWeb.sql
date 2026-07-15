/**********************************************************************************************
  APCWeb — Etapa 4b: ajustes post-clonado (solo toca objetos APCWeb_, nunca originales)

  1. TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR (typo "ACTUALIZADOR", fuera del patrón de
     REPLACE) es staging que ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS borra y reinserta.
     → se clona como APCWeb_TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR y se repunta el SP Web.
  2. APCWeb_SP_..._VALIDAR_LIQUI quedó leyendo la copia VACÍA de VALIDACIONES_LIQUIDACION.
     Las reglas son configuración (única fuente de verdad, editada desde la Desktop)
     → el SP Web vuelve a leer la tabla ORIGINAL (solo SELECT, no la modifica).
  3. Se elimina la copia APCWeb_TBL_..._VALIDACIONES_LIQUIDACION (vacía, creada por el paso 1
     del script 01 y ya sin referencias).
**********************************************************************************************/
USE db_cegid;
SET NOCOUNT ON;

DECLARE @def NVARCHAR(MAX);

-- 1. Clonar staging SIN_INFORMAR y repuntar el SP Web
IF OBJECT_ID('APCWeb_TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR', 'U') IS NULL
BEGIN
    SELECT TOP (0) * INTO dbo.APCWeb_TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR
    FROM dbo.TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR;
    PRINT 'Creada APCWeb_TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR';
END

SET @def = OBJECT_DEFINITION(OBJECT_ID('APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS'));
IF @def LIKE '%dbo.TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR%'
BEGIN
    SET @def = REPLACE(@def, 'TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR', 'APCWeb_TBL_ACTUALIZADORPRECIOSCOSTOS_SIN_INFORMAR');
    SET @def = REPLACE(@def, 'APCWeb_APCWeb_', 'APCWeb_');
    SET @def = STUFF(@def, CHARINDEX('CREATE', @def), 6, 'ALTER');
    EXEC sp_executesql @def;
    PRINT 'Repuntado APCWeb_SP_..._ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS a la staging APCWeb_';
END
ELSE
    PRINT 'ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS ya estaba repuntado.';

-- 2. VALIDAR_LIQUI vuelve a leer las reglas ORIGINALES
SET @def = OBJECT_DEFINITION(OBJECT_ID('APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_LIQUI'));
IF @def LIKE '%APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_VALIDACIONES_LIQUIDACION%'
BEGIN
    SET @def = REPLACE(@def, 'APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_VALIDACIONES_LIQUIDACION', 'TBL_ACTUALIZARPRECIOSCOSTOS_VALIDACIONES_LIQUIDACION');
    SET @def = STUFF(@def, CHARINDEX('CREATE', @def), 6, 'ALTER');
    EXEC sp_executesql @def;
    PRINT 'APCWeb_SP_..._VALIDAR_LIQUI lee las reglas de la tabla ORIGINAL.';
END
ELSE
    PRINT 'VALIDAR_LIQUI ya leía la tabla original.';

-- 3. Borrar la copia vacía de reglas (objeto APCWeb_ nuestro, sin referencias)
IF OBJECT_ID('APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_VALIDACIONES_LIQUIDACION', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.sql_expression_dependencies
                   WHERE referenced_entity_name = 'APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_VALIDACIONES_LIQUIDACION')
BEGIN
    DROP TABLE dbo.APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_VALIDACIONES_LIQUIDACION;
    PRINT 'Eliminada la copia vacía APCWeb_TBL_..._VALIDACIONES_LIQUIDACION.';
END

-- Verificación
SELECT o.name AS sp, d.referenced_entity_name AS dependencia
FROM sys.objects o
JOIN sys.sql_expression_dependencies d ON d.referencing_id = o.object_id
WHERE o.name IN ('APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS',
                 'APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_LIQUI')
ORDER BY o.name, dependencia;
