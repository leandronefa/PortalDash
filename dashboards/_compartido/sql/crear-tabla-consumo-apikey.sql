-- PortalDash — registro de consumo de la ApiKey compartida (OpenRouter/Anthropic)
-- entre todos los dashboards y aplicativos del monorepo C:\apps.
-- Correr UNA sola vez contra 10.0.0.115, base db_Cegid.
-- Ver C:\apps\dashboards\_compartido\CLAUDE.md para el convenio de uso.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PortalDash_ConsumoApiKey' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.PortalDash_ConsumoApiKey (
    Id                BIGINT IDENTITY(1,1) PRIMARY KEY,
    Fecha             DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    Aplicacion        NVARCHAR(50)   NOT NULL,  -- nombre del dashboard/app, ej. 'VentaObjetivo'
    Usuario           NVARCHAR(100)  NULL,      -- usuario del portal que disparó la consulta
    Proveedor         NVARCHAR(30)   NOT NULL DEFAULT 'OpenRouter',
    Modelo            NVARCHAR(100)  NOT NULL,
    TokensEntrada     INT            NOT NULL,
    TokensSalida      INT            NOT NULL,
    TokensTotal       INT            NOT NULL,
    CostoEstimadoUSD  DECIMAL(10,6)  NULL,       -- NULL si el modelo no está en la tabla de precios
    Detalle           NVARCHAR(200)  NULL        -- libre, ej. nombre del endpoint/feature
  );

  CREATE INDEX IX_PortalDash_ConsumoApiKey_Aplicacion_Fecha
    ON dbo.PortalDash_ConsumoApiKey (Aplicacion, Fecha);
END
