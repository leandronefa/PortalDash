-- Indice para soportar el fix de "evidencia historica" del 2026-09-04 (ver el comentario completo
-- junto a PrimeraVentaTrasRecepcionH en MotorReposicion_sp_PreCalcularStockSemanal.sql): esa CTE
-- nueva busca, para cada "arranque de racha" detectado (656.771 casos en toda la base), la primera
-- venta real dentro de esa semana puntual -- un JOIN correlacionado por (Sucursal, CodArticulo,
-- COLOR, TALLE) + rango de fecha contra Vta_detalle (8,75 millones de filas).
--
-- Ninguno de los indices existentes de Vta_detalle sirve para esta busqueda: todos intercalan
-- otras columnas (CANTIDAD, PRECIO, etc.) entre las columnas de igualdad y FECHA, rompiendo
-- cualquier seek eficiente. Sin este indice, el JOIN nuevo no llego a terminar en 20 minutos
-- (probado y revertido el mismo dia, ver git log).
--
-- Distinto del intento de IX_VtaDetalle_Fecha_Cubriente (2026-09-01, revertido): ese llevaba FECHA
-- primero (para un patron de "escanear un rango de fechas ancho"); este necesita las columnas de
-- igualdad primero y FECHA al final (para un patron de "muchos grupos chicos, cada uno con un
-- rango de fecha angosto de ~7 dias") -- son patrones de acceso opuestos, no reemplaza al anterior.
--
-- WITH (ONLINE=ON): confirmado Enterprise Edition (ver el comentario identico en
-- 2026-09-01_indices_rendimiento_fechas.sql) -- no bloquea lecturas/escrituras de la tabla mientras
-- se crea. IF NOT EXISTS: seguro de correr mas de una vez sin error si ya se aplico antes.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VtaDetalle_Sucursal_Articulo_Fecha' AND object_id = OBJECT_ID('Vta_detalle'))
BEGIN
  CREATE NONCLUSTERED INDEX IX_VtaDetalle_Sucursal_Articulo_Fecha
    ON Vta_detalle (ESTAB, ARTCEGID, COLOR, TALLE, FECHA)
    WITH (ONLINE=ON);
END
