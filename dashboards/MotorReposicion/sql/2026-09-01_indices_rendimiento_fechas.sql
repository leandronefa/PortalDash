-- Indices no-clusterizados cubrientes para acelerar QUERY_QUIEBRE_DETALLE (server.js) cuando se
-- pide un rango de fechas NUEVO (cache-miss en cacheQuiebre). Aditivos: no se toca ningun indice
-- existente. Ver docs/superpowers/specs/2026-09-01-rendimiento-tablero-design.md, seccion 3, para
-- el analisis completo (conteo de filas real, indices existentes, por que estas columnas puntuales).
--
-- IF NOT EXISTS: seguro de correr mas de una vez sin error si ya se aplico antes.

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VtaDetalle_Fecha_Cubriente' AND object_id = OBJECT_ID('Vta_detalle'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_VtaDetalle_Fecha_Cubriente
    ON Vta_detalle (FECHA)
    INCLUDE (ESTAB, ARTCEGID, COLOR, TALLE, CANTIDAD, NUMERO, CODBARRA_prin);
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DisTransfEmitidas_Fecha_Cubriente' AND object_id = OBJECT_ID('dis_transf_emitidas'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_DisTransfEmitidas_Fecha_Cubriente
    ON dis_transf_emitidas (fecha)
    INCLUDE (destino, arprove, color, talle, cantpend);
END
