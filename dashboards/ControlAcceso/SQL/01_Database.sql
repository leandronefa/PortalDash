-- ControlAcceso — esquema de base de datos (db_Cegid @ 10.0.0.115)
-- NOTA: el servidor crea estas tablas automáticamente al arrancar (ensureSchema en server.cjs).
-- Este script es documentación / instalación manual. Es idempotente.

IF OBJECT_ID('dbo.tbl_CtrlAcceso_Usuarios') IS NULL
CREATE TABLE dbo.tbl_CtrlAcceso_Usuarios (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  Usuario   NVARCHAR(50)  NOT NULL UNIQUE,
  Nombre    NVARCHAR(100) NOT NULL,
  Hash      NVARCHAR(200) NOT NULL,          -- scrypt salt:hash
  Rol       NVARCHAR(10)  NOT NULL CHECK (Rol IN ('PORTERO','ADMIN')),
  Activo    BIT NOT NULL DEFAULT 1,
  CreadoEn  DATETIME NOT NULL DEFAULT GETDATE()
);
GO

IF OBJECT_ID('dbo.tbl_CtrlAcceso_Vehiculos') IS NULL
CREATE TABLE dbo.tbl_CtrlAcceso_Vehiculos (
  Id          INT IDENTITY(1,1) PRIMARY KEY,
  Patente     NVARCHAR(15)  NOT NULL UNIQUE,  -- normalizada: mayúsculas sin separadores
  Tipo        NVARCHAR(10)  NOT NULL CHECK (Tipo IN ('TRACTOR','SEMI')),
  Descripcion NVARCHAR(100) NULL,
  Activo      BIT NOT NULL DEFAULT 1,
  CreadoEn    DATETIME NOT NULL DEFAULT GETDATE()
);
GO

IF OBJECT_ID('dbo.tbl_CtrlAcceso_Conductores') IS NULL
CREATE TABLE dbo.tbl_CtrlAcceso_Conductores (
  Id        INT IDENTITY(1,1) PRIMARY KEY,
  Nombre    NVARCHAR(100) NOT NULL,
  Documento NVARCHAR(20)  NULL,
  Activo    BIT NOT NULL DEFAULT 1,
  CreadoEn  DATETIME NOT NULL DEFAULT GETDATE()
);
GO

IF OBJECT_ID('dbo.tbl_CtrlAcceso_Movimientos') IS NULL
CREATE TABLE dbo.tbl_CtrlAcceso_Movimientos (
  Id             INT IDENTITY(1,1) PRIMARY KEY,
  FechaHora      DATETIME      NOT NULL,
  Tipo           NVARCHAR(10)  NOT NULL CHECK (Tipo IN ('INGRESO','EGRESO')),
  EsPropio       BIT           NOT NULL,
  -- vehículos propios (referencias al catálogo)
  IdTractor      INT NULL REFERENCES dbo.tbl_CtrlAcceso_Vehiculos(Id),
  IdSemi         INT NULL REFERENCES dbo.tbl_CtrlAcceso_Vehiculos(Id),
  IdConductor    INT NULL REFERENCES dbo.tbl_CtrlAcceso_Conductores(Id),
  Kilometraje    DECIMAL(12,1) NULL,
  DestinoOrigen  NVARCHAR(200) NULL,
  NroViaje       NVARCHAR(30)  NULL,
  NroRemito      NVARCHAR(30)  NULL,
  -- vehículos no propios (texto normalizado)
  Patente        NVARCHAR(15)  NULL,
  TipoVehiculo   NVARCHAR(30)  NULL,
  ConductorNom   NVARCHAR(100) NULL,
  Observaciones  NVARCHAR(500) NULL,
  UsuarioCarga   NVARCHAR(50)  NOT NULL,
  CreadoEn       DATETIME NOT NULL DEFAULT GETDATE(),
  Anulado        BIT NOT NULL DEFAULT 0,      -- anulación lógica (solo ADMIN)
  AnuladoPor     NVARCHAR(50) NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='IX_CtrlAcceso_Mov_Fecha')
CREATE INDEX IX_CtrlAcceso_Mov_Fecha ON dbo.tbl_CtrlAcceso_Movimientos (FechaHora DESC) INCLUDE (Tipo, EsPropio, Anulado);
GO
