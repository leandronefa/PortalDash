-- Asegura que existan las filas A/B/C del concepto 'efectivo'/'por_sucursal' en
-- tbl_CoVenAppINDO_MontosSupervisor. La fila C ya la crea 002_seed_data.sql (monto 0),
-- pero A y B nunca se generaron porque el ABM no mostraba este concepto y el cascade
-- de montos.js solo hace UPDATE (no INSERT) sobre filas que ya existen.
-- Nuevo concepto (03/09/2026): Millón paga, además de la plaza ('efectivo'/'por_plaza'),
-- un monto individual por sucursal que llega por efectivo ('efectivo'/'por_sucursal').

IF NOT EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosSupervisor WHERE concepto = 'efectivo' AND tipo = 'por_sucursal' AND categoria_suc = 'C')
INSERT INTO dbo.tbl_CoVenAppINDO_MontosSupervisor (concepto, monto, tipo, factor_plaza, categoria_suc) VALUES
  ('efectivo', 0, 'por_sucursal', 0.5, 'C');
GO

IF NOT EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosSupervisor WHERE concepto = 'efectivo' AND tipo = 'por_sucursal' AND categoria_suc = 'B')
INSERT INTO dbo.tbl_CoVenAppINDO_MontosSupervisor (concepto, monto, tipo, factor_plaza, categoria_suc) VALUES
  ('efectivo', 0, 'por_sucursal', 0.5, 'B');
GO

IF NOT EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosSupervisor WHERE concepto = 'efectivo' AND tipo = 'por_sucursal' AND categoria_suc = 'A')
INSERT INTO dbo.tbl_CoVenAppINDO_MontosSupervisor (concepto, monto, tipo, factor_plaza, categoria_suc) VALUES
  ('efectivo', 0, 'por_sucursal', 0.5, 'A');
GO
