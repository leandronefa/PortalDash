/* ═══════════════════════════════════════════════════════════════════════
   Consultas de control: comparar el tablero web contra QlikView.

   Corré cada una y contrastá con lo que muestra el .qvw para el mismo
   período. Mientras no cierren, no publiques el tablero como fuente oficial.
   ═══════════════════════════════════════════════════════════════════════ */

DECLARE @desde date = '2025-12-01';
DECLARE @hasta date = '2025-12-29';   -- F1 y F2 del .qvw al momento del port

/* ── 1 · Totales de la red, con IVA y sin recargo financiero ─────────────
   Es la combinación por defecto del tablero (IVA='SI', RF='NO').           */
SELECT
    SUM(v.importe + v.iva_importe)                                   AS ventas,
    SUM(CASE WHEN v.Articulo <> 'ZZZZZZZZ' THEN v.cantidad ELSE 0 END) AS unidades,
    COUNT(DISTINCT CASE WHEN v.cantidad > 0 THEN v.Idventa END)
  - COUNT(DISTINCT CASE WHEN v.cantidad < 0 THEN v.Idventa END)      AS operaciones,
    COUNT(DISTINCT v.Codsuc)                                          AS bocas,
    COUNT(DISTINCT CAST(v.fecha AS date))                             AS dias
FROM dbo.QVENTAS v
WHERE v.fecha >= @desde AND v.fecha < DATEADD(day,1,@hasta);
GO

/* ── 2 · Margen operativo de la red ──────────────────────────────────────
   Reproduce Mrg Op% tal como está en el .qvw, con IVA incluido.            */
DECLARE @desde date = '2025-12-01', @hasta date = '2025-12-29';

SELECT
    CAST( (SUM(base) - SUM(costo)) / NULLIF(SUM(base),0) * 100 AS decimal(6,2) ) AS margen_op_pct
FROM (
    SELECT
        v.importe + v.descuento
          - v.RECARGO_ENVIO - v.IVA_RECARGO_ENVIO
          - v.RECARGO_FINANCIERO - v.IVA_RECARGO_FINANCIERO
          + v.iva_importe                        AS base,
        v.precio_rep + v.iva_precio_rep          AS costo
    FROM dbo.QVENTAS v
    WHERE v.fecha >= @desde AND v.fecha < DATEADD(day,1,@hasta)
) x;
GO

/* ── 3 · El control que importa: ¿algún Idventa cruza fechas o sucursales? ─
   El tablero pre-agrega por sucursal × día y después suma. Si una misma
   venta apareciera en más de una fecha o boca, las operaciones se contarían
   dos veces. Esto tiene que devolver CERO filas.                           */
DECLARE @desde date = '2025-01-01', @hasta date = '2025-12-31';

SELECT TOP 50
    v.Idventa,
    COUNT(DISTINCT CAST(v.fecha AS date)) AS fechas_distintas,
    COUNT(DISTINCT v.Codsuc)              AS bocas_distintas
FROM dbo.QVENTAS v
WHERE v.fecha >= @desde AND v.fecha < DATEADD(day,1,@hasta)
GROUP BY v.Idventa
HAVING COUNT(DISTINCT CAST(v.fecha AS date)) > 1
    OR COUNT(DISTINCT v.Codsuc) > 1;
GO

/* Si devuelve filas, la suma de operaciones del tablero queda inflada. En ese
   caso hay dos salidas: (a) sumar por Idventa a una única fecha/boca en el
   origen, o (b) pasar el COUNT(DISTINCT) al servidor por rango completo en vez
   de pre-agregar por día — implica una consulta por cambio de período, sin la
   caché por mes. Anotá el resultado antes de decidir. */

/* ── 4 · Objetivos y días hábiles del mes que estés comparando ──────────── */
SELECT o.Codsuc, o.ANIOOBJ, o.MESOBJ,
       o.OBJ_VTAS_CON_IVA, o.OBJ_VTAS_SIN_IVA,
       o.OBJ_UNIDADES_VTAS, o.OBJ_OPERACIONES,
       o.OBJ_UNIDADES_CLIENTES, o.OBJ_MARGEN_OPE, o.OBJ_MARGEN_TOT
FROM dbo.QOBJETIVOS o
WHERE o.ANIOOBJ = 2025 AND o.MESOBJ = 12
ORDER BY o.Codsuc;
GO

SELECT h.ANIOHAB, h.MESHAB, h.Codsuc, h.DIAS_HABILES
FROM dbo.QDIAS_HABILES h
WHERE h.ANIOHAB = 2025 AND h.MESHAB = 12
ORDER BY h.Codsuc;
GO

/* ── 5 · ¿Los días hábiles varían por sucursal? ──────────────────────────
   El tablero los toma a nivel mes (MAX). Si esta consulta devuelve filas,
   leé la nota "Días hábiles por sucursal" en DEPLOY.md.                    */
SELECT h.ANIOHAB, h.MESHAB,
       MIN(h.DIAS_HABILES) AS minimo,
       MAX(h.DIAS_HABILES) AS maximo,
       COUNT(DISTINCT h.DIAS_HABILES) AS valores_distintos
FROM dbo.QDIAS_HABILES h
WHERE h.ANIOHAB >= 2024
GROUP BY h.ANIOHAB, h.MESHAB
HAVING COUNT(DISTINCT h.DIAS_HABILES) > 1
ORDER BY h.ANIOHAB, h.MESHAB;
GO
