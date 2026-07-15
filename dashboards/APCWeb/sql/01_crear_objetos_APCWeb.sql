/**********************************************************************************************
  APCWeb — Etapa 4: creación de objetos SQL con prefijo APCWeb_
  Servidor: 10.0.0.115  ·  Base: db_cegid

  QUÉ HACE:
    1. Clona las TABLAS de estado compartido como APCWeb_TBL_... (estructura idéntica,
       vacías) — detecta automáticamente también las tablas TBL_ACTUALIZARPRECIOSCOSTOS_%
       que los SPs clonados referencian internamente (p. ej. la tabla definitiva de Liqui).
    2. Clona los SPs de estado compartido como APCWeb_SP_... reemplazando dentro de su
       definición los prefijos SP_ACTUALIZARPRECIOSCOSTOS_ y TBL_ACTUALIZARPRECIOSCOSTOS_
       por sus equivalentes APCWeb_ (fidelidad total: es el MISMO código).
    3. Reporta dependencias que NO siguen el patrón de prefijos, para revisión manual.

  QUÉ NO HACE (garantía "no romper nada"):
    - NO modifica, borra ni renombra NINGÚN objeto existente. Solo CREATE de objetos APCWeb_.
    - Si un objeto APCWeb_ ya existe, lo saltea e informa (re-ejecutable / idempotente).

  EJECUTAR con un usuario con permisos CREATE TABLE / CREATE PROCEDURE y VIEW DEFINITION.
**********************************************************************************************/
USE db_cegid;
SET NOCOUNT ON;

DECLARE @sps TABLE (nombre SYSNAME PRIMARY KEY);
INSERT INTO @sps (nombre) VALUES
 ('SP_ACTUALIZARPRECIOSCOSTOS_BORRAR_ARTICULOS_LIQUI')
,('SP_ACTUALIZARPRECIOSCOSTOS_ACTUALIZAR_ARTICULOS_LIQUI')
,('SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_LIQUI')
,('SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI')
,('SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_EMPRESA')
,('SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_SUCURSAL')
,('SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_PONDERADO')
,('SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_EMPRESA_PONDERADO')
,('SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_SUCURSAL_PONDERADO')
,('SP_ACTUALIZARPRECIOSCOSTOS_BORRAR_TLBOK')
,('SP_ACTUALIZARPRECIOSCOSTOS_ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS')
,('SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_MARCAS_DISTINCT');

-- Tablas base conocidas desde el código VB (se agregan las detectadas por dependencia)
DECLARE @tablas TABLE (nombre SYSNAME PRIMARY KEY);
INSERT INTO @tablas (nombre) VALUES
 ('TBL_ACTUALIZARPRECIOSCOSTOS_ARTICULOS_LIQUIDACION_TEMP')
,('TBL_ACTUALIZARPRECIOSCOSTOS_OK')
,('TBL_ACTUALIZARPRECIOSCOSTOS_MARCAS')
,('TBL_ACTUALIZARPRECIOSCOSTOS_LOG');

/*----------------------------------------------------------------------------------
 1. Detectar tablas TBL_ACTUALIZARPRECIOSCOSTOS_% referenciadas por los SPs a clonar
----------------------------------------------------------------------------------*/
INSERT INTO @tablas (nombre)
SELECT DISTINCT d.referenced_entity_name
FROM @sps s
JOIN sys.sql_expression_dependencies d
     ON d.referencing_id = OBJECT_ID(s.nombre)
WHERE d.referenced_entity_name LIKE 'TBL[_]ACTUALIZARPRECIOSCOSTOS[_]%'
  AND OBJECT_ID(d.referenced_entity_name, 'U') IS NOT NULL
  AND d.referenced_entity_name NOT IN (SELECT nombre FROM @tablas);

/*----------------------------------------------------------------------------------
 2. Reporte de dependencias FUERA del patrón (informativo: tablas del ERP compartidas
    de solo lectura; revisar que ninguna sea escrita por los SPs de Liqui)
----------------------------------------------------------------------------------*/
PRINT '=== Dependencias fuera del patrón TBL_ACTUALIZARPRECIOSCOSTOS_ (revisar) ===';
SELECT s.nombre AS sp, d.referenced_entity_name AS dependencia
FROM @sps s
JOIN sys.sql_expression_dependencies d ON d.referencing_id = OBJECT_ID(s.nombre)
WHERE (d.referenced_entity_name NOT LIKE 'TBL[_]ACTUALIZARPRECIOSCOSTOS[_]%'
   AND d.referenced_entity_name NOT LIKE 'SP[_]ACTUALIZARPRECIOSCOSTOS[_]%')
ORDER BY s.nombre, d.referenced_entity_name;

/*----------------------------------------------------------------------------------
 3. Clonar tablas (estructura idéntica, vacías) — SELECT INTO conserva tipos,
    nulabilidad e identity. Se scriptean aparte PK/índices/defaults si existieran.
----------------------------------------------------------------------------------*/
DECLARE @t SYSNAME, @nuevo SYSNAME, @sql NVARCHAR(MAX);

DECLARE curT CURSOR LOCAL FAST_FORWARD FOR SELECT nombre FROM @tablas;
OPEN curT;
FETCH NEXT FROM curT INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @nuevo = 'APCWeb_' + @t;

    IF OBJECT_ID(@t, 'U') IS NULL
        PRINT 'AVISO: no existe la tabla original ' + @t + ' — saltada.';
    ELSE IF OBJECT_ID(@nuevo, 'U') IS NOT NULL
        PRINT 'Ya existe ' + @nuevo + ' — saltada.';
    ELSE
    BEGIN
        SET @sql = N'SELECT TOP (0) * INTO ' + QUOTENAME(@nuevo) + N' FROM ' + QUOTENAME(@t) + N';';
        EXEC sp_executesql @sql;
        PRINT 'Creada ' + @nuevo;

        -- Aviso si la original tiene índices/constraints que SELECT INTO no copia
        IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(@t) AND index_id > 0)
           OR EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id = OBJECT_ID(@t))
            PRINT '  AVISO: ' + @t + ' tiene índices o defaults; revisar si deben replicarse en ' + @nuevo + ' (ver SELECT final).';
    END
    FETCH NEXT FROM curT INTO @t;
END
CLOSE curT; DEALLOCATE curT;

/*----------------------------------------------------------------------------------
 4. Clonar SPs con reemplazo de prefijos dentro de la definición
----------------------------------------------------------------------------------*/
DECLARE @sp SYSNAME, @def NVARCHAR(MAX);

DECLARE curS CURSOR LOCAL FAST_FORWARD FOR SELECT nombre FROM @sps;
OPEN curS;
FETCH NEXT FROM curS INTO @sp;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @nuevo = 'APCWeb_' + @sp;

    IF OBJECT_ID(@sp, 'P') IS NULL
        PRINT 'AVISO: no existe el SP original ' + @sp + ' — saltado.';
    ELSE IF OBJECT_ID(@nuevo, 'P') IS NOT NULL
        PRINT 'Ya existe ' + @nuevo + ' — saltado.';
    ELSE
    BEGIN
        SET @def = OBJECT_DEFINITION(OBJECT_ID(@sp));
        IF @def IS NULL
        BEGIN
            PRINT 'ERROR: sin permiso VIEW DEFINITION sobre ' + @sp;
        END
        ELSE
        BEGIN
            -- Mismo código, nuevos nombres: SP_ACT..→APCWeb_SP_ACT.. y TBL_ACT..→APCWeb_TBL_ACT..
            SET @def = REPLACE(@def, 'SP_ACTUALIZARPRECIOSCOSTOS_',  'APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_');
            SET @def = REPLACE(@def, 'TBL_ACTUALIZARPRECIOSCOSTOS_', 'APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_');
            -- Por si el REPLACE anterior duplicó el prefijo en objetos ya prefijados dentro del texto
            SET @def = REPLACE(@def, 'APCWeb_APCWeb_', 'APCWeb_');

            BEGIN TRY
                EXEC sp_executesql @def;
                PRINT 'Creado ' + @nuevo;
            END TRY
            BEGIN CATCH
                PRINT 'ERROR creando ' + @nuevo + ': ' + ERROR_MESSAGE();
            END CATCH
        END
    END
    FETCH NEXT FROM curS INTO @sp;
END
CLOSE curS; DEALLOCATE curS;

/*----------------------------------------------------------------------------------
 5. Verificación final
----------------------------------------------------------------------------------*/
PRINT '=== Objetos APCWeb_ creados ===';
SELECT name, type_desc, create_date
FROM sys.objects
WHERE name LIKE 'APCWeb[_]%'
ORDER BY type_desc, name;

PRINT '=== Índices/defaults de las tablas originales clonadas (replicar a mano si aplica) ===';
SELECT t.name AS tabla_original, i.name AS indice, i.type_desc, i.is_primary_key
FROM sys.indexes i
JOIN sys.tables t ON t.object_id = i.object_id
WHERE t.name IN (SELECT nombre FROM @tablas) AND i.index_id > 0
ORDER BY t.name, i.name;
