-- =============================================================================
--  PassReset — 01_Database.sql
--  Crea tablas si no existen; agrega columna Servidor si falta.
--  Base: db_Cegid (existente) en 10.0.0.115
-- =============================================================================

USE db_Cegid;
GO

-- =============================================================================
--  tbl_PassReset_Usuarios
-- =============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'tbl_PassReset_Usuarios')
BEGIN
    CREATE TABLE dbo.tbl_PassReset_Usuarios
    (
        Id              INT           IDENTITY(1,1)  NOT NULL,
        Servidor        NVARCHAR(100)                NOT NULL  DEFAULT '',
        UsuarioWindows  NVARCHAR(100)                NOT NULL,
        CorreoDestino   NVARCHAR(255)                NOT NULL,
        MaxDias         INT           NOT NULL  DEFAULT 30,
        UltimoCambio    DATETIME                         NULL,
        Activo          BIT           NOT NULL  DEFAULT 1,
        FechaCreacion   DATETIME      NOT NULL  DEFAULT GETDATE(),
        FechaModif      DATETIME      NOT NULL  DEFAULT GETDATE(),

        CONSTRAINT PK_tbl_PassReset_Usuarios PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT UQ_tbl_PassReset_Usuarios_SrvWin UNIQUE (Servidor, UsuarioWindows),
        CONSTRAINT CHK_tbl_PassReset_Usuarios_MaxDias CHECK (MaxDias >= 1 AND MaxDias <= 3650)
    );

    CREATE NONCLUSTERED INDEX IX_tbl_PassReset_Usuarios_Servidor
        ON dbo.tbl_PassReset_Usuarios (Servidor, Activo);

    PRINT 'Tabla tbl_PassReset_Usuarios creada.';
END
ELSE
BEGIN
    -- Agregar columna Servidor si no existe (migración de versión anterior)
    IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.tbl_PassReset_Usuarios')
          AND name = 'Servidor'
    )
    BEGIN
        ALTER TABLE dbo.tbl_PassReset_Usuarios
            ADD Servidor NVARCHAR(100) NOT NULL DEFAULT '';
        PRINT 'Columna Servidor agregada a tbl_PassReset_Usuarios.';
    END
    -- Agregar columna ResetDesde si no existe
    IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.tbl_PassReset_Usuarios')
          AND name = 'ResetDesde'
    )
    BEGIN
        ALTER TABLE dbo.tbl_PassReset_Usuarios
            ADD ResetDesde DATETIME NULL;
        PRINT 'Columna ResetDesde agregada a tbl_PassReset_Usuarios.';
    END
    ELSE
        PRINT 'Tabla tbl_PassReset_Usuarios ya existe y tiene columna Servidor.';
END
GO

-- =============================================================================
--  tbl_PassReset_Log
-- =============================================================================
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'tbl_PassReset_Log')
BEGIN
    CREATE TABLE dbo.tbl_PassReset_Log
    (
        Id                 INT           IDENTITY(1,1)  NOT NULL,
        IdUsuario          INT                          NOT NULL,
        Servidor           NVARCHAR(100) NOT NULL  DEFAULT '',
        FechaHora          DATETIME      NOT NULL  DEFAULT GETDATE(),
        UsuarioWindows     NVARCHAR(100) NOT NULL,
        PasswordGenerada   NVARCHAR(100) NOT NULL,
        CorreoDestino      NVARCHAR(255) NOT NULL,
        Resultado          NVARCHAR(20)  NOT NULL,
        MensajeError       NVARCHAR(MAX)     NULL,
        FechaProximoCambio DATETIME      NOT NULL,
        Origen             NVARCHAR(20)  NOT NULL  DEFAULT 'AUTO',

        CONSTRAINT PK_tbl_PassReset_Log PRIMARY KEY CLUSTERED (Id),
        CONSTRAINT FK_tbl_PassReset_Log_Usuario
            FOREIGN KEY (IdUsuario) REFERENCES dbo.tbl_PassReset_Usuarios(Id),
        CONSTRAINT CHK_tbl_PassReset_Log_Resultado
            CHECK (Resultado IN ('OK', 'OK_MAIL_ERROR', 'ERROR')),
        CONSTRAINT CHK_tbl_PassReset_Log_Origen
            CHECK (Origen IN ('AUTO', 'MANUAL'))
    );

    CREATE NONCLUSTERED INDEX IX_tbl_PassReset_Log_IdUsuario
        ON dbo.tbl_PassReset_Log (IdUsuario, Id DESC);
    CREATE NONCLUSTERED INDEX IX_tbl_PassReset_Log_Servidor_Fecha
        ON dbo.tbl_PassReset_Log (Servidor, FechaHora DESC);

    PRINT 'Tabla tbl_PassReset_Log creada.';
END
ELSE
BEGIN
    -- Agregar columna Servidor si no existe
    IF NOT EXISTS (
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.tbl_PassReset_Log')
          AND name = 'Servidor'
    )
    BEGIN
        ALTER TABLE dbo.tbl_PassReset_Log
            ADD Servidor NVARCHAR(100) NOT NULL DEFAULT '';
        PRINT 'Columna Servidor agregada a tbl_PassReset_Log.';
    END
    ELSE
        PRINT 'Tabla tbl_PassReset_Log ya existe y tiene columna Servidor.';
END
GO

PRINT '=== 01_Database.sql completado ===';
GO
