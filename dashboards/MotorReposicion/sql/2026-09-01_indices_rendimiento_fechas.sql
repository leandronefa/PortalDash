-- ESTADO (2026-09-02): PROBADO Y REVERTIDO EN PRODUCCION. NO ESTAN APLICADOS HOY.
--
-- Se crearon los 3 indices de abajo, uno por uno, con WITH (ONLINE=ON), contra la base real
-- (db_Cegid, Enterprise Edition). Cada uno SI mejoro la operacion puntual que atacaba, confirmado
-- con sys.dm_db_index_usage_stats (seeks/scans reales) y con SET STATISTICS TIME:
--   - IX_VtaDetalle_Fecha_Cubriente: #VentasRango paso de tardar una parte no despreciable a 2ms.
--   - IX_CondComVtaDet_Join_Cubriente: #PromoRango dejo de escanear el heap de CGD_CONDCOM_VTA_DET
--     por cada fila candidata (era ~8.6s de un corrida) y paso a un scan/hash-join sobre el indice.
-- Pero el tiempo TOTAL de QUERY_QUIEBRE_DETALLE para una fecha nueva (cache-miss real) NO mejoro de
-- punta a punta -- medido antes (~25-32s en 3 combos reales) y despues de los 3 indices (~29-48s,
-- en un caso PEOR). Hipotesis mas probable: al cambiar el plan de una parte, el optimizador elige
-- un plan distinto (y peor) para el resto de la consulta multi-statement -- una consulta de este
-- tamaño (500+ lineas, multiples CTEs y tablas temporales) no se arregla con indices sueltos.
-- Se revirtieron los 3 (DROP INDEX) el mismo dia -- la base quedo igual que antes de este intento.
--
-- Para una mejora real haria falta un rediseño mas profundo (ej. pre-agregar ventas por dia en el
-- precalculo nocturno, en vez de escanear Vta_detalle en vivo por rango de fechas) -- señalado como
-- fuera de alcance en docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md, seccion
-- "No-objetivos", y confirmado necesario por este intento. Evaluar como un proyecto aparte.
--
-- El SQL de abajo queda como REGISTRO de lo que se probo (y como punto de partida si se retoma esto
-- con un enfoque distinto, ej. junto con un cambio en la consulta misma) -- no correr tal cual
-- esperando una mejora, ya midio que no la da.
--
-- IF NOT EXISTS: seguro de correr mas de una vez sin error si ya se aplico antes.
--
-- WITH (ONLINE=ON) (2026-09-02, confirmado edicion real via SERVERPROPERTY('Edition') =
-- "Enterprise Edition (64-bit)"): en Enterprise, crear el indice NO bloquea lecturas/escrituras de
-- la tabla mientras corre (a diferencia de Standard, que si la bloquea) -- reduce mucho el riesgo
-- de tocar estas tablas de produccion en horario normal.

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VtaDetalle_Fecha_Cubriente' AND object_id = OBJECT_ID('Vta_detalle'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_VtaDetalle_Fecha_Cubriente
    ON Vta_detalle (FECHA)
    INCLUDE (ESTAB, ARTCEGID, COLOR, TALLE, CANTIDAD, NUMERO, CODBARRA_prin)
    WITH (ONLINE=ON);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisTransfEmitidas_Fecha_Cubriente' AND object_id = OBJECT_ID('dis_transf_emitidas'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_DisTransfEmitidas_Fecha_Cubriente
    ON dis_transf_emitidas (fecha)
    INCLUDE (destino, arprove, color, talle, cantpend)
    WITH (ONLINE=ON);
END

-- Agregado 2026-09-02, tras perfilar QUERY_QUIEBRE_DETALLE con SET STATISTICS TIME (los 2 indices
-- de arriba no bajaron el tiempo total -- se perfilo para encontrar el cuello de botella real):
-- el cruce de #PromoRango (Vta_detalle JOIN CGD_CONDCOM_VTA_DET por ESTAB+NUMERO+FECHA+
-- CODBARRA_prin) tardaba ~8.6s de los ~25-32s totales, porque CGD_CONDCOM_VTA_DET (13.441 filas)
-- no tenia NINGUN indice (heap puro) -- probable nested loop escaneando la tabla entera por cada
-- fila candidata de Vta_detalle en el rango de fechas.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CondComVtaDet_Join_Cubriente' AND object_id = OBJECT_ID('CGD_CONDCOM_VTA_DET'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_CondComVtaDet_Join_Cubriente
    ON CGD_CONDCOM_VTA_DET (ESTAB, NUMERO, FECHA, CODBARRA_prin)
    INCLUDE (NOMBRE_COND, DESCUENTO, PVP_REBAJADO, PRECIOLLENO)
    WITH (ONLINE=ON);
END
