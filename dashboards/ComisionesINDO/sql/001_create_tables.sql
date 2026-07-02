-- =============================================
-- 001_create_tables.sql
-- Sistema de Comisiones INDO
-- Ejecutar en: db_Cegid / SQL Server 2012
-- =============================================

USE db_Cegid;
GO

-- Sucursales con datos de gestión
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_Sucursales') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_Sucursales (
    id          INT           PRIMARY KEY,
    nombre      VARCHAR(100),
    supervisor  VARCHAR(100),
    provincia   VARCHAR(50),
    provincia_code VARCHAR(10),
    marca       VARCHAR(50),
    region      VARCHAR(50),
    activa      BIT           DEFAULT 1
);
GO

-- Montos por sección/escalón/categoría
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_Montos') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_Montos (
    id               INT IDENTITY PRIMARY KEY,
    seccion          VARCHAR(50),
    escalon          INT,
    participacion    DECIMAL(12,2),
    escalon_monto    DECIMAL(12,2),
    subtotal         DECIMAL(12,2),
    ticket_promedio  DECIMAL(12,2),
    operacion        DECIMAL(12,2),
    total            DECIMAL(12,2),
    categoria_suc    CHAR(1)       DEFAULT 'C'
);
GO

-- Montos vendedores (FULL/PART/CAJERO)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_MontosVendedor') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_MontosVendedor (
    id              INT IDENTITY PRIMARY KEY,
    escalon         INT,
    tipo_vendedor   VARCHAR(10),
    monto           DECIMAL(12,2),
    categoria_suc   CHAR(1)       DEFAULT 'C'
);
GO

-- Montos supervisor
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_MontosSupervisor') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_MontosSupervisor (
    id             INT IDENTITY PRIMARY KEY,
    concepto       VARCHAR(20),
    monto          DECIMAL(12,2),
    tipo           VARCHAR(20),
    factor_plaza   DECIMAL(4,2)  DEFAULT 0.5,
    categoria_suc  CHAR(1)       DEFAULT 'C'
);
GO

-- Montos préstamos por sucursal
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_MontosPrestamos') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_MontosPrestamos (
    id             INT IDENTITY PRIMARY KEY,
    escalon        INT,
    tipo           VARCHAR(20),
    monto          DECIMAL(12,2),
    categoria_suc  CHAR(1)       DEFAULT 'C'
);
GO

-- Montos cajero fijo
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_MontosCajero') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_MontosCajero (
    id             INT IDENTITY PRIMARY KEY,
    monto          DECIMAL(12,2),
    categoria_suc  CHAR(1)       DEFAULT 'C'
);
GO

-- Ranking por período
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_Ranking') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_Ranking (
    id               INT IDENTITY PRIMARY KEY,
    sucursal_id      INT,
    categoria        CHAR(1),
    override_manual  BIT           DEFAULT 0,
    periodo          VARCHAR(7)
);
GO

-- Multiplicadores de ranking
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_RankingMultiplicador') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_RankingMultiplicador (
    categoria       CHAR(1)      PRIMARY KEY,
    multiplicador   DECIMAL(4,2)
);
GO

-- Objetivos consumo por período
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_ObjConsumo') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_ObjConsumo (
    id                INT IDENTITY PRIMARY KEY,
    sucursal_id       INT,
    periodo           VARCHAR(7),
    participacion     DECIMAL(6,4),
    primer_escalon    DECIMAL(14,2),
    credito_promedio  DECIMAL(12,2),
    operaciones       DECIMAL(10,2),
    cobranza          DECIMAL(14,2),
    dias              INT
);
GO

-- Objetivos efectivo por período
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_ObjEfectivo') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_ObjEfectivo (
    id                INT IDENTITY PRIMARY KEY,
    sucursal_id       INT,
    periodo           VARCHAR(7),
    primer_escalon    DECIMAL(14,2),
    credito_promedio  DECIMAL(12,2),
    operaciones       DECIMAL(10,2),
    dias              INT
);
GO

-- Datos de consumo
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_DatosConsumo') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_DatosConsumo (
    id                INT IDENTITY PRIMARY KEY,
    sucursal_id       INT,
    periodo           VARCHAR(7),
    ventas            DECIMAL(14,2),
    vta_diaria        DECIMAL(14,2),
    particip_vta      DECIMAL(8,4),
    vta_vta_tot       DECIMAL(8,4),
    credito_promedio  DECIMAL(12,2),
    operaciones       INT,
    pers_op           INT,
    particip_op       DECIMAL(8,4),
    cobranzas         DECIMAL(14,2),
    cob_diaria        DECIMAL(14,2),
    particip_cob      DECIMAL(8,4),
    cant_cob          INT,
    pers_cob          INT,
    obj_vtas          DECIMAL(14,2)
);
GO

-- Datos de efectivo
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_DatosEfectivo') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_DatosEfectivo (
    id                INT IDENTITY PRIMARY KEY,
    sucursal_id       INT,
    periodo           VARCHAR(7),
    ventas            DECIMAL(14,2),
    vta_diaria        DECIMAL(14,2),
    particip_vta      DECIMAL(10,6),
    vta_vta_tot       DECIMAL(8,4),
    credito_promedio  DECIMAL(12,2),
    operaciones       INT,
    pers_op           INT,
    particip_op       DECIMAL(10,6),
    cobranzas         DECIMAL(14,2),
    cob_diaria        DECIMAL(14,2),
    particip_cob      DECIMAL(10,6),
    cant_cob          INT,
    pers_cob          INT,
    obj_vtas          DECIMAL(14,2)
);
GO

-- Datos reporte (originaciones)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_DatosReporte') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_DatosReporte (
    id                  INT IDENTITY PRIMARY KEY,
    periodo             VARCHAR(7),
    id_originacion      INT,
    estado              VARCHAR(50),
    usuario_originador  VARCHAR(50),
    fecha_alta          DATETIME,
    producto            VARCHAR(50),
    importe_capital     DECIMAL(14,2),
    cantidad_cuotas     INT,
    id_prestamo         INT,
    id_sucursal         INT,
    sucursal            VARCHAR(100),
    id_plan             INT
);
GO

-- Historial de cálculos
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'dbo.tbl_CoVenAppINDO_CalculoHistorial') AND type = 'U')
CREATE TABLE dbo.tbl_CoVenAppINDO_CalculoHistorial (
    id              INT IDENTITY PRIMARY KEY,
    periodo         VARCHAR(7),
    fecha_calculo   DATETIME      DEFAULT GETDATE(),
    usuario         VARCHAR(50),
    resultado_json  NVARCHAR(MAX)
);
GO
