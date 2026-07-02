-- =============================================
-- 002_seed_data.sql
-- Datos iniciales del sistema
-- Ejecutar DESPUÉS de 001_create_tables.sql
-- =============================================

USE db_Cegid;
GO

-- Multiplicadores de ranking
IF NOT EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_RankingMultiplicador WHERE categoria = 'A')
INSERT INTO dbo.tbl_CoVenAppINDO_RankingMultiplicador (categoria, multiplicador) VALUES
  ('A', 1.30),
  ('B', 1.15),
  ('C', 1.00);
GO

-- ================================================================
-- MONTOS BASE (categoría C)
-- Sección OPER_CON_EFECT — 3 escalones
-- ================================================================
IF NOT EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_Montos WHERE seccion = 'OPER_CON_EFECT' AND escalon = 1 AND categoria_suc = 'C')
INSERT INTO dbo.tbl_CoVenAppINDO_Montos (seccion, escalon, participacion, escalon_monto, subtotal, ticket_promedio, operacion, total, categoria_suc) VALUES
  ('OPER_CON_EFECT', 1, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('OPER_CON_EFECT', 2, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('OPER_CON_EFECT', 3, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('OPER_SIN_EFECT', 1, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('OPER_SIN_EFECT', 2, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('OPER_SIN_EFECT', 3, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('ENCARGADO',       1, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('ENCARGADO',       2, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('ENCARGADO',       3, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('ENC_MILLON',      1, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('ENC_MILLON',      2, 0.5, 0, 0, 0, 0, 0, 'C'),
  ('ENC_MILLON',      3, 0.5, 0, 0, 0, 0, 0, 'C');
GO

-- Montos vendedores base
IF NOT EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosVendedor WHERE escalon = 1 AND tipo_vendedor = 'FULL' AND categoria_suc = 'C')
INSERT INTO dbo.tbl_CoVenAppINDO_MontosVendedor (escalon, tipo_vendedor, monto, categoria_suc) VALUES
  (1, 'FULL',   0, 'C'), (2, 'FULL',   0, 'C'), (3, 'FULL',   0, 'C'),
  (1, 'PART',   0, 'C'), (2, 'PART',   0, 'C'), (3, 'PART',   0, 'C'),
  (1, 'CAJERO', 0, 'C'), (2, 'CAJERO', 0, 'C'), (3, 'CAJERO', 0, 'C');
GO

-- Montos supervisor base
IF NOT EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosSupervisor WHERE concepto = 'consumo' AND tipo = 'por_sucursal' AND categoria_suc = 'C')
INSERT INTO dbo.tbl_CoVenAppINDO_MontosSupervisor (concepto, monto, tipo, factor_plaza, categoria_suc) VALUES
  ('consumo',  0, 'por_sucursal', 0.5, 'C'),
  ('efectivo', 0, 'por_sucursal', 0.5, 'C'),
  ('consumo',  0, 'por_plaza',    0.5, 'C'),
  ('efectivo', 0, 'por_plaza',    0.5, 'C');
GO

-- Montos préstamos base
IF NOT EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosPrestamos WHERE escalon = 1 AND tipo = 'suc' AND categoria_suc = 'C')
INSERT INTO dbo.tbl_CoVenAppINDO_MontosPrestamos (escalon, tipo, monto, categoria_suc) VALUES
  (1, 'suc',   0, 'C'), (2, 'suc',   0, 'C'), (3, 'suc',   0, 'C'),
  (1, 'suc13', 0, 'C'), (2, 'suc13', 0, 'C'), (3, 'suc13', 0, 'C');
GO

-- Montos cajero base
IF NOT EXISTS (SELECT 1 FROM dbo.tbl_CoVenAppINDO_MontosCajero WHERE categoria_suc = 'C')
INSERT INTO dbo.tbl_CoVenAppINDO_MontosCajero (monto, categoria_suc) VALUES (0, 'C');
GO
