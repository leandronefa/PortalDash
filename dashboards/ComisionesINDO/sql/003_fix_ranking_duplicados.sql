-- =============================================
-- 003_fix_ranking_duplicados.sql
-- Elimina duplicados en tbl_CoVenAppINDO_Ranking y agrega constraint UNIQUE.
-- Ejecutar en: db_Cegid
-- =============================================

USE db_Cegid;
GO

-- Paso 1: Ver cuántos duplicados hay (verificación previa)
SELECT sucursal_id, periodo, COUNT(*) AS cant
FROM dbo.tbl_CoVenAppINDO_Ranking
GROUP BY sucursal_id, periodo
HAVING COUNT(*) > 1
ORDER BY periodo, sucursal_id;
GO

-- Paso 2: Eliminar duplicados — conserva el registro con id más alto (el más reciente)
WITH cte AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY sucursal_id, periodo ORDER BY id DESC) AS rn
    FROM dbo.tbl_CoVenAppINDO_Ranking
)
DELETE FROM cte WHERE rn > 1;
GO

-- Paso 3: Agregar restricción UNIQUE para prevenir futuros duplicados
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.tbl_CoVenAppINDO_Ranking')
      AND name = 'UQ_Ranking_SucursalPeriodo'
)
ALTER TABLE dbo.tbl_CoVenAppINDO_Ranking
ADD CONSTRAINT UQ_Ranking_SucursalPeriodo UNIQUE (sucursal_id, periodo);
GO

-- Verificación final: no debe devolver filas
SELECT sucursal_id, periodo, COUNT(*) AS cant
FROM dbo.tbl_CoVenAppINDO_Ranking
GROUP BY sucursal_id, periodo
HAVING COUNT(*) > 1;
GO
