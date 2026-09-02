-- PortalDash — sesión de chat persistida por (Aplicacion, Usuario), para que
-- la conversación con el asistente sobreviva un reinicio del servicio (no
-- sólo un F5 del navegador). Correr UNA sola vez contra 10.0.0.115, base db_Cegid.
-- Ver C:\apps\dashboards\_compartido\CLAUDE.md para el convenio de uso.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PortalDash_ChatSesion' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.PortalDash_ChatSesion (
    Aplicacion      NVARCHAR(50)   NOT NULL,  -- ej. 'VentaObjetivo'
    Usuario         NVARCHAR(100)  NOT NULL,  -- usuario del portal (X-Portal-User)
    HistorialJson   NVARCHAR(MAX)  NOT NULL,  -- array JSON [{role,content}, ...], ya recortado
    ActualizadoEn   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT PK_PortalDash_ChatSesion PRIMARY KEY (Aplicacion, Usuario)
  );
END
