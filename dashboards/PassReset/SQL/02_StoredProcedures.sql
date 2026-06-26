-- =============================================================================
--  PassReset — 02_StoredProcedures.sql
--  SPs de LECTURA para la web app (read-only).
--  SPs de ESCRITURA para los agentes.
--  Base de datos: db_Cegid (existente en 10.0.0.115)
-- =============================================================================

USE db_Cegid;
GO

-- =============================================================================
--  ██████  LECTURA — usados por la web app PassReset
-- =============================================================================

-- -----------------------------------------------------------------------------
--  sp_PassReset_GetUsuarios
--  Lista todos los usuarios con estado y días calculados.
--  Filtrable por servidor.
-- -----------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_PassReset_GetUsuarios', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PassReset_GetUsuarios;
GO

CREATE PROCEDURE dbo.sp_PassReset_GetUsuarios
    @SoloActivos BIT          = 1,
    @Servidor    NVARCHAR(100) = NULL   -- NULL = todos los servidores
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        u.Id,
        u.Servidor,
        u.UsuarioWindows,
        u.CorreoDestino,
        u.MaxDias,
        u.UltimoCambio,
        u.Activo,
        CONVERT(VARCHAR(20), u.FechaCreacion, 120) AS FechaCreacion,

        -- Días transcurridos desde el último cambio reportado por el agente
        CASE WHEN u.UltimoCambio IS NULL THEN NULL
             ELSE DATEDIFF(DAY, u.UltimoCambio, GETDATE())
        END AS DiasTranscurridos,

        -- Días restantes (negativo = ya venció)
        CASE WHEN u.UltimoCambio IS NULL THEN 0
             ELSE u.MaxDias - DATEDIFF(DAY, u.UltimoCambio, GETDATE())
        END AS DiasRestantes,

        -- Fecha estimada del próximo cambio automático
        CASE WHEN u.UltimoCambio IS NULL THEN NULL
             ELSE DATEADD(DAY, u.MaxDias, u.UltimoCambio)
        END AS FechaProximoCambio,

        -- Estado calculado
        CASE
            WHEN u.UltimoCambio IS NULL                                                  THEN 'VENCIDA'
            WHEN DATEDIFF(DAY, u.UltimoCambio, GETDATE()) >= u.MaxDias                  THEN 'VENCIDA'
            WHEN u.MaxDias - DATEDIFF(DAY, u.UltimoCambio, GETDATE()) <= 5              THEN 'PROXIMA'
            ELSE 'OK'
        END AS Estado

    FROM dbo.tbl_PassReset_Usuarios u
    WHERE (@SoloActivos = 0 OR u.Activo = 1)
      AND (@Servidor IS NULL OR u.Servidor = @Servidor)
    ORDER BY
        -- Vencidas primero
        CASE
            WHEN u.UltimoCambio IS NULL THEN 1
            WHEN DATEDIFF(DAY, u.UltimoCambio, GETDATE()) >= u.MaxDias THEN 1
            WHEN u.MaxDias - DATEDIFF(DAY, u.UltimoCambio, GETDATE()) <= 5 THEN 2
            ELSE 3
        END,
        -- Por servidor, luego por días restantes
        u.Servidor,
        CASE WHEN u.UltimoCambio IS NULL THEN 0
             ELSE u.MaxDias - DATEDIFF(DAY, u.UltimoCambio, GETDATE())
        END ASC;
END
GO

-- -----------------------------------------------------------------------------
--  sp_PassReset_GetServidores
--  Lista distinta de servidores registrados (para el filtro de la web app).
-- -----------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_PassReset_GetServidores', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PassReset_GetServidores;
GO

CREATE PROCEDURE dbo.sp_PassReset_GetServidores
AS
BEGIN
    SET NOCOUNT ON;
    SELECT DISTINCT Servidor
    FROM dbo.tbl_PassReset_Usuarios
    WHERE Activo = 1
    ORDER BY Servidor;
END
GO

-- -----------------------------------------------------------------------------
--  sp_PassReset_GetResumen
--  Métricas globales para las tarjetas de la web app.
--  Opcionalmente filtrado por servidor.
-- -----------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_PassReset_GetResumen', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PassReset_GetResumen;
GO

CREATE PROCEDURE dbo.sp_PassReset_GetResumen
    @Servidor NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        COUNT(*) AS Total,
        SUM(CASE
            WHEN UltimoCambio IS NULL
              OR DATEDIFF(DAY, UltimoCambio, GETDATE()) >= MaxDias
            THEN 1 ELSE 0 END) AS Vencidas,
        SUM(CASE
            WHEN UltimoCambio IS NOT NULL
             AND DATEDIFF(DAY, UltimoCambio, GETDATE()) < MaxDias
             AND MaxDias - DATEDIFF(DAY, UltimoCambio, GETDATE()) <= 5
            THEN 1 ELSE 0 END) AS Proximas,
        SUM(CASE
            WHEN UltimoCambio IS NOT NULL
             AND DATEDIFF(DAY, UltimoCambio, GETDATE()) < MaxDias
             AND MaxDias - DATEDIFF(DAY, UltimoCambio, GETDATE()) > 5
            THEN 1 ELSE 0 END) AS Ok
    FROM dbo.tbl_PassReset_Usuarios
    WHERE Activo = 1
      AND (@Servidor IS NULL OR Servidor = @Servidor);
END
GO

-- -----------------------------------------------------------------------------
--  sp_PassReset_GetLog
--  Historial de operaciones. La web app solo lee; los agentes son los que insertan.
-- -----------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_PassReset_GetLog', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PassReset_GetLog;
GO

CREATE PROCEDURE dbo.sp_PassReset_GetLog
    @Limite    INT           = 200,
    @Servidor  NVARCHAR(100) = NULL,   -- NULL = todos
    @IdUsuario INT           = NULL    -- NULL = todos
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP (@Limite)
        l.Id,
        l.IdUsuario,
        l.Servidor,
        CONVERT(VARCHAR(20), l.FechaHora, 120)          AS FechaHora,
        l.UsuarioWindows,
        l.PasswordGenerada,
        l.CorreoDestino,
        l.Resultado,
        l.MensajeError,
        CONVERT(VARCHAR(20), l.FechaProximoCambio, 120) AS FechaProximoCambio,
        l.Origen
    FROM dbo.tbl_PassReset_Log l
    WHERE (@Servidor  IS NULL OR l.Servidor  = @Servidor)
      AND (@IdUsuario IS NULL OR l.IdUsuario = @IdUsuario)
    ORDER BY l.Id DESC;
END
GO

-- =============================================================================
--  ██████  ESCRITURA — usados por los agentes en cada servidor
--           La web app NO llama a ninguno de estos.
-- =============================================================================

-- -----------------------------------------------------------------------------
--  sp_PassReset_AgentUpsertUsuario
--  El agente se registra/actualiza al arrancar.
--  Si el usuario ya existe en ese servidor, actualiza; si no, inserta.
-- -----------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_PassReset_AgentUpsertUsuario', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PassReset_AgentUpsertUsuario;
GO

CREATE PROCEDURE dbo.sp_PassReset_AgentUpsertUsuario
    @Servidor       NVARCHAR(100),
    @UsuarioWindows NVARCHAR(100),
    @CorreoDestino  NVARCHAR(255) = NULL,  -- NULL = no sobreescribir correo existente
    @MaxDias        INT           = 30
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT 1 FROM dbo.tbl_PassReset_Usuarios
        WHERE Servidor = @Servidor AND UsuarioWindows = @UsuarioWindows
    )
    BEGIN
        UPDATE dbo.tbl_PassReset_Usuarios
        SET -- Solo actualizar correo si se provee explícitamente (no NULL)
            CorreoDestino = CASE WHEN @CorreoDestino IS NOT NULL THEN @CorreoDestino ELSE CorreoDestino END,
            MaxDias       = @MaxDias,
            FechaModif    = GETDATE()
        WHERE Servidor = @Servidor AND UsuarioWindows = @UsuarioWindows;
    END
    ELSE
    BEGIN
        INSERT INTO dbo.tbl_PassReset_Usuarios
            (Servidor, UsuarioWindows, CorreoDestino, MaxDias)
        VALUES
            (@Servidor, @UsuarioWindows, ISNULL(@CorreoDestino, ''), @MaxDias);
    END

    SELECT Id FROM dbo.tbl_PassReset_Usuarios
    WHERE Servidor = @Servidor AND UsuarioWindows = @UsuarioWindows;
END
GO

-- -----------------------------------------------------------------------------
--  sp_PassReset_AgentReportarCambio
--  El agente llama a este SP después de cambiar (o intentar cambiar) la contraseña.
--  Actualiza UltimoCambio si fue exitoso y registra en el log.
-- -----------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_PassReset_AgentReportarCambio', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PassReset_AgentReportarCambio;
GO

CREATE PROCEDURE dbo.sp_PassReset_AgentReportarCambio
    @IdUsuario          INT,
    @Servidor           NVARCHAR(100),
    @UsuarioWindows     NVARCHAR(100),
    @PasswordGenerada   NVARCHAR(100),
    @CorreoDestino      NVARCHAR(255),
    @Resultado          NVARCHAR(20),      -- 'OK' | 'OK_MAIL_ERROR' | 'ERROR'
    @MensajeError       NVARCHAR(MAX) = NULL,
    @FechaProximoCambio DATETIME,
    @Origen             NVARCHAR(20)  = 'AUTO'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @LogId INT;

    BEGIN TRANSACTION;
    BEGIN TRY
        IF @Resultado IN ('OK', 'OK_MAIL_ERROR')
        BEGIN
            UPDATE dbo.tbl_PassReset_Usuarios
            SET UltimoCambio = GETDATE(),
                FechaModif   = GETDATE()
            WHERE Id = @IdUsuario;
        END

        INSERT INTO dbo.tbl_PassReset_Log
            (IdUsuario, Servidor, UsuarioWindows, PasswordGenerada, CorreoDestino,
             Resultado, MensajeError, FechaProximoCambio, Origen)
        VALUES
            (@IdUsuario, @Servidor, @UsuarioWindows, @PasswordGenerada, @CorreoDestino,
             @Resultado, @MensajeError, @FechaProximoCambio, @Origen);

        SET @LogId = SCOPE_IDENTITY();

        COMMIT;
    END TRY
    BEGIN CATCH
        ROLLBACK;
        DECLARE @msg NVARCHAR(2048) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH

    -- Envío de correo fuera de la transacción
    IF @Resultado IN ('OK', 'OK_MAIL_ERROR')
    BEGIN
        BEGIN TRY
            EXEC dbo.sp_PassReset_EnviarCorreo
                @CorreoDestino      = @CorreoDestino,
                @UsuarioWindows     = @UsuarioWindows,
                @PasswordGenerada   = @PasswordGenerada,
                @Servidor           = @Servidor,
                @FechaProximoCambio = @FechaProximoCambio;
        END TRY
        BEGIN CATCH
            IF @Resultado = 'OK' AND @LogId IS NOT NULL
            BEGIN
                UPDATE dbo.tbl_PassReset_Log
                SET Resultado    = 'OK_MAIL_ERROR',
                    MensajeError = ERROR_MESSAGE()
                WHERE Id = @LogId;
            END
        END CATCH
    END
END
GO

-- -----------------------------------------------------------------------------
--  sp_PassReset_AgentGetPendientes
--  El agente consulta si hay usuarios pendientes de cambio en SU servidor.
--  Cada agente solo consulta sus propios usuarios.
-- -----------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_PassReset_AgentGetPendientes', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PassReset_AgentGetPendientes;
GO

CREATE PROCEDURE dbo.sp_PassReset_AgentGetPendientes
    @Servidor NVARCHAR(100)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        Id,
        UsuarioWindows,
        CorreoDestino,
        MaxDias,
        UltimoCambio
    FROM dbo.tbl_PassReset_Usuarios
    WHERE Servidor = @Servidor
      AND Activo = 1
      AND CorreoDestino <> ''          -- solo usuarios con correo asignado
      AND (
          UltimoCambio IS NULL
          OR DATEDIFF(DAY, UltimoCambio, GETDATE()) >= MaxDias
      );
END
GO

-- =============================================================================
--  sp_PassReset_EnviarCorreo
--  Envía correo al usuario con su nueva contraseña vía Database Mail.
--  Llamado por sp_PassReset_AgentReportarCambio después del COMMIT.
--  Lee el profile de Database Mail automáticamente desde msdb.
-- =============================================================================
IF OBJECT_ID('dbo.sp_PassReset_EnviarCorreo', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PassReset_EnviarCorreo;
GO

CREATE PROCEDURE dbo.sp_PassReset_EnviarCorreo
    @CorreoDestino      NVARCHAR(255),
    @UsuarioWindows     NVARCHAR(100),
    @PasswordGenerada   NVARCHAR(100),
    @Servidor           NVARCHAR(100),
    @FechaProximoCambio DATETIME
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @profile  NVARCHAR(255);
    DECLARE @subject  NVARCHAR(500);
    DECLARE @body     NVARCHAR(MAX);
    DECLARE @fechaStr NVARCHAR(20);

    -- Leer profile default de Database Mail (columna 'name' en sysmail_profile)
    SELECT TOP 1 @profile = p.name
    FROM msdb.dbo.sysmail_principalprofile pp
    JOIN msdb.dbo.sysmail_profile p ON p.profile_id = pp.profile_id
    WHERE pp.is_default = 1;

    -- Fallback: primer profile disponible si no hay default marcado
    IF @profile IS NULL
        SELECT TOP 1 @profile = name
        FROM msdb.dbo.sysmail_profile;

    IF @profile IS NULL
    BEGIN
        RAISERROR('No se encontró ningún profile de Database Mail configurado.', 16, 1);
        RETURN;
    END

    SET @fechaStr = CONVERT(VARCHAR(10), @FechaProximoCambio, 103); -- dd/mm/yyyy

    SET @subject = N'Contraseña actualizada — ' + @Servidor;

    SET @body =
        N'Se actualizó automáticamente la contraseña de tu cuenta Windows.' + CHAR(13) + CHAR(10) +
        CHAR(13) + CHAR(10) +
        N'  Servidor         : ' + @Servidor         + CHAR(13) + CHAR(10) +
        N'  Usuario          : ' + @UsuarioWindows   + CHAR(13) + CHAR(10) +
        N'  Contraseña nueva : ' + @PasswordGenerada + CHAR(13) + CHAR(10) +
        N'  Próximo cambio   : ' + @fechaStr         + CHAR(13) + CHAR(10) +
        CHAR(13) + CHAR(10) +
        N'Guardá esta información en un lugar seguro.' + CHAR(13) + CHAR(10) +
        N'Este correo fue generado automáticamente.';

    EXEC msdb.dbo.sp_send_dbmail
        @profile_name = @profile,
        @recipients   = @CorreoDestino,
        @subject      = @subject,
        @body         = @body,
        @body_format  = 'TEXT';
END
GO

-- =============================================================================
--  sp_PassReset_SetCorreo
--  La web app llama a este SP para asignar/actualizar el correo de un usuario.
-- =============================================================================
IF OBJECT_ID('dbo.sp_PassReset_SetCorreo', 'P') IS NOT NULL
    DROP PROCEDURE dbo.sp_PassReset_SetCorreo;
GO

CREATE PROCEDURE dbo.sp_PassReset_SetCorreo
    @Id            INT,
    @CorreoDestino NVARCHAR(255)
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE dbo.tbl_PassReset_Usuarios
    SET CorreoDestino = @CorreoDestino,
        FechaModif    = GETDATE()
    WHERE Id = @Id;
    SELECT @@ROWCOUNT AS Updated;
END
GO

PRINT '=== 02_StoredProcedures.sql completado en db_Cegid ===';
GO
