-- ============================================================
-- DashConciliacionPunitorios - Schema
-- Servidor: 10.0.0.115  |  DB: DashboardsDB
-- Ejecutar una sola vez (o re-ejecutar; es idempotente)
-- ============================================================

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'DashboardsDB')
    CREATE DATABASE DashboardsDB;
GO
USE DashboardsDB;
GO

-- ------------------------------------------------------------
-- TABLA: Períodos procesados
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'DashConciliacionPunitorios_Periodos' AND type = 'U')
CREATE TABLE DashConciliacionPunitorios_Periodos (
    Id                    INT           IDENTITY(1,1) PRIMARY KEY,
    Periodo               VARCHAR(6)    NOT NULL,           -- '202603'
    MedioPago             VARCHAR(100)  NOT NULL,           -- 'PAGO INMEDIATO - QR'
    Descripcion           VARCHAR(200)  NULL,
    TotalRegistros1400    INT           NULL,
    TotalIdPrestamos1400  INT           NULL,
    TotalMovimientosMayor INT           NULL,
    TotalIdPrestamosMayor INT           NULL,
    TotalDebeGlobal       DECIMAL(18,2) NULL,
    TotalHaberGlobal      DECIMAL(18,2) NULL,
    TotalCol_AA           DECIMAL(18,2) NULL,               -- Total Punitorios
    TotalCol_AS           DECIMAL(18,2) NULL,               -- CUCGastos
    TotalCol_AT           DECIMAL(18,2) NULL,               -- CUCGastosIVA
    TotalCol_AU           DECIMAL(18,2) NULL,               -- CUCMSellado
    TotalCol_AV           DECIMAL(18,2) NULL,               -- Cargo Seg Vto
    TotalCol_AW           DECIMAL(18,2) NULL,               -- Cargo Seg Vto IVA
    Conciliados           INT           NULL,
    ConDiferencia         INT           NULL,
    SinMayor              INT           NULL,
    SoloMayor             INT           NULL,
    FechaProceso          DATETIME      DEFAULT GETDATE(),
    CONSTRAINT UQ_DashConc_Periodo UNIQUE (Periodo, MedioPago)
);
GO

-- ------------------------------------------------------------
-- TABLA: Detalle por IdPrestamo y período
-- ------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE name = 'DashConciliacionPunitorios_Detalle' AND type = 'U')
CREATE TABLE DashConciliacionPunitorios_Detalle (
    Id                 INT           IDENTITY(1,1) PRIMARY KEY,
    PeriodoId          INT           NOT NULL
                           REFERENCES DashConciliacionPunitorios_Periodos(Id) ON DELETE CASCADE,
    IdPrestamo         VARCHAR(20)   NOT NULL,
    Nombre             VARCHAR(200)  NULL,
    RegistrosArchivo   INT           NULL,
    Col_AA_Punitorio   DECIMAL(18,2) NULL,
    Col_AS_CUCGastos   DECIMAL(18,2) NULL,
    Col_AT_CUCGastosIVA DECIMAL(18,2) NULL,
    Col_AU_CUCMSellado DECIMAL(18,2) NULL,
    Col_AV_CargoSegVto DECIMAL(18,2) NULL,
    Col_AW_CargoSegVtoIVA DECIMAL(18,2) NULL,
    Total1400          DECIMAL(18,2) NULL,
    MayorDebe          DECIMAL(18,2) NULL,
    MayorHaber         DECIMAL(18,2) NULL,
    TotalMayor         DECIMAL(18,2) NULL,
    Diferencia         DECIMAL(18,2) NULL,
    Estado             VARCHAR(20)   NULL,    -- CONCILIADO | DIFERENCIA | SIN_MAYOR | SOLO_MAYOR
    FechaActualizacion DATETIME      DEFAULT GETDATE()
);
GO

CREATE INDEX IF NOT EXISTS IX_DashConc_Det_PeriodoId  ON DashConciliacionPunitorios_Detalle(PeriodoId);
CREATE INDEX IF NOT EXISTS IX_DashConc_Det_IdPrestamo ON DashConciliacionPunitorios_Detalle(IdPrestamo);
CREATE INDEX IF NOT EXISTS IX_DashConc_Det_Estado     ON DashConciliacionPunitorios_Detalle(Estado);
GO

-- ------------------------------------------------------------
-- SP: Limpiar un período (antes de recargar)
-- ------------------------------------------------------------
IF OBJECT_ID('DashConciliacionPunitorios_SP_LimpiarPeriodo', 'P') IS NOT NULL
    DROP PROCEDURE DashConciliacionPunitorios_SP_LimpiarPeriodo;
GO
CREATE PROCEDURE DashConciliacionPunitorios_SP_LimpiarPeriodo
    @Periodo   VARCHAR(6),
    @MedioPago VARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;
    DELETE FROM DashConciliacionPunitorios_Periodos
    WHERE Periodo = @Periodo AND MedioPago = @MedioPago;
    -- El DELETE en Periodos elimina en cascada el Detalle
END;
GO

-- ------------------------------------------------------------
-- SP: Resumen de un período
-- ------------------------------------------------------------
IF OBJECT_ID('DashConciliacionPunitorios_SP_GetResumen', 'P') IS NOT NULL
    DROP PROCEDURE DashConciliacionPunitorios_SP_GetResumen;
GO
CREATE PROCEDURE DashConciliacionPunitorios_SP_GetResumen
    @Periodo   VARCHAR(6)   = NULL,
    @MedioPago VARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT *
    FROM DashConciliacionPunitorios_Periodos
    WHERE (@Periodo   IS NULL OR Periodo   = @Periodo)
      AND (@MedioPago IS NULL OR MedioPago = @MedioPago)
    ORDER BY Periodo DESC, MedioPago;
END;
GO

-- ------------------------------------------------------------
-- SP: Detalle de un período (con filtro opcional por estado)
-- ------------------------------------------------------------
IF OBJECT_ID('DashConciliacionPunitorios_SP_GetDetalle', 'P') IS NOT NULL
    DROP PROCEDURE DashConciliacionPunitorios_SP_GetDetalle;
GO
CREATE PROCEDURE DashConciliacionPunitorios_SP_GetDetalle
    @Periodo    VARCHAR(6),
    @MedioPago  VARCHAR(100),
    @Estado     VARCHAR(20) = NULL      -- NULL = todos
AS
BEGIN
    SET NOCOUNT ON;
    SELECT d.*
    FROM DashConciliacionPunitorios_Detalle d
    JOIN DashConciliacionPunitorios_Periodos p ON p.Id = d.PeriodoId
    WHERE p.Periodo   = @Periodo
      AND p.MedioPago = @MedioPago
      AND (@Estado IS NULL OR d.Estado = @Estado)
    ORDER BY d.Diferencia DESC;
END;
GO
