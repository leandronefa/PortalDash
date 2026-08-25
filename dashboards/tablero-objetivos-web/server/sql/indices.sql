/* ═══════════════════════════════════════════════════════════════════════
   Índices para la consulta agregada del tablero.

   Sin esto, cada mes hace un scan de las 5.913.998 filas de QVENTAS y la
   primera carga puede tardar minutos. Con el índice de cobertura, un mes
   resuelve en pocos segundos.

   Corré esto UNA VEZ, en una ventana de baja actividad: crear el índice
   ordena y copia los datos, y bloquea la tabla salvo que uses ONLINE=ON
   (disponible en Enterprise).
   ═══════════════════════════════════════════════════════════════════════ */

-- 1 · Cuánto pesa hoy la tabla y qué índices tiene
SELECT
    i.name                       AS indice,
    i.type_desc                  AS tipo,
    SUM(p.rows)                  AS filas,
    CAST(SUM(a.total_pages) * 8.0 / 1024 AS decimal(10,1)) AS mb
FROM sys.indexes i
JOIN sys.partitions p     ON p.object_id = i.object_id AND p.index_id = i.index_id
JOIN sys.allocation_units a ON a.container_id = p.partition_id
WHERE i.object_id = OBJECT_ID('dbo.QVENTAS')
GROUP BY i.name, i.type_desc
ORDER BY mb DESC;
GO

-- 2 · Índice de cobertura. Ajustá los nombres si tu tabla difiere.
--     Si tenés Enterprise, agregá WITH (ONLINE = ON) para no bloquear.
CREATE NONCLUSTERED INDEX IX_QVENTAS_tablero
    ON dbo.QVENTAS (fecha, Codsuc)
    INCLUDE (
        Idventa, cantidad, Articulo,
        importe, iva_importe, descuento,
        RECARGO_ENVIO, IVA_RECARGO_ENVIO,
        RECARGO_FINANCIERO, IVA_RECARGO_FINANCIERO,
        recfin, iva_recfin,
        precio_rep, iva_precio_rep
    )
    WITH (FILLFACTOR = 95, DATA_COMPRESSION = PAGE);
GO

/* Nota sobre DATA_COMPRESSION = PAGE: reduce bastante el tamaño en disco a
   cambio de algo de CPU en lectura. Para una tabla de hechos que se lee
   agregada, casi siempre conviene. Si tu edición no lo soporta, sacá esa
   parte de la cláusula WITH. */

-- 3 · Índices chicos para el resto
CREATE NONCLUSTERED INDEX IX_QOBJETIVOS_tablero
    ON dbo.QOBJETIVOS (ANIOOBJ, MESOBJ, Codsuc);
GO

CREATE NONCLUSTERED INDEX IX_QDIAS_HABILES_tablero
    ON dbo.QDIAS_HABILES (ANIOHAB, MESHAB);
GO

-- 4 · Estadísticas al día
UPDATE STATISTICS dbo.QVENTAS      WITH FULLSCAN;
UPDATE STATISTICS dbo.QOBJETIVOS   WITH FULLSCAN;
UPDATE STATISTICS dbo.QDIAS_HABILES WITH FULLSCAN;
GO

-- 5 · Control: cuánto tarda un mes y qué devuelve
SET STATISTICS TIME ON;
DECLARE @desde date = '2025-12-01', @hasta date = '2025-12-31';

SELECT COUNT(*) AS filas_de_salida
FROM (
    SELECT v.Codsuc, CONVERT(char(10), v.fecha, 23) AS f
    FROM dbo.QVENTAS v
    WHERE v.fecha >= @desde AND v.fecha < DATEADD(day, 1, @hasta)
    GROUP BY v.Codsuc, CONVERT(char(10), v.fecha, 23)
) x;
SET STATISTICS TIME OFF;
GO

/* Referencia de lo que debería dar: alrededor de 1.200 filas para un mes de
   la red completa (47 bocas × ~26 jornadas). Si tarda más de ~10 s con el
   índice creado, revisá el plan de ejecución: lo más probable es que el tipo
   de la columna fecha esté forzando una conversión y anulando el seek. */
