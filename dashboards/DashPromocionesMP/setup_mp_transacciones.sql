-- =============================================================================
-- Ejecutar en SQL Server 10.0.0.115 / db_Cegid
-- Crea la tabla historica de transacciones MercadoPago (Tesi + Pueblo)
-- y el SP que usa el dashboard para consultarlas.
-- =============================================================================

USE [db_Cegid];
GO

-- ── Tabla principal ──────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.tables WHERE name = 'mp_transacciones' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
    CREATE TABLE [dbo].[mp_transacciones] (
        [id]                  INT IDENTITY(1,1) NOT NULL,
        [fuente]              VARCHAR(10)    NOT NULL,        -- 'Tesi' | 'Pueblo'
        [fecha_descarga]      DATE           NOT NULL,        -- fecha en que se descargo el archivo
        [date_created]        DATETIME2(0)   NULL,
        [transaction_amount]  DECIMAL(18,2)  NULL,
        [mercadopago_fee]     DECIMAL(18,2)  NULL,
        [net_received_amount] DECIMAL(18,2)  NULL,
        [cuotas]              INT            NULL,
        [payment_type]        VARCHAR(50)    NULL,
        [description]         VARCHAR(200)   NULL,           -- nombre de sucursal (ej: "Suc.20")
        [financing_fee]       DECIMAL(18,2)  NULL,
        [sub_unit]            VARCHAR(50)    NULL,
        [franchise]           VARCHAR(100)   NULL,
        [issuer_name]         VARCHAR(100)   NULL,
        CONSTRAINT [PK_mp_transacciones] PRIMARY KEY CLUSTERED ([id] ASC)
    );

    CREATE INDEX [IX_mp_trans_fuente_fecha]   ON [dbo].[mp_transacciones] ([fuente], [fecha_descarga]);
    CREATE INDEX [IX_mp_trans_date_created]   ON [dbo].[mp_transacciones] ([date_created]);

    PRINT 'Tabla mp_transacciones creada.';
END
ELSE
    PRINT 'Tabla mp_transacciones ya existe, no se modifica.';
GO

-- ── SP de consulta ────────────────────────────────────────────────────────────
-- Devuelve todas las transacciones de los ultimos @dias dias (default 60).
-- @fuente: 'Tesi', 'Pueblo', o NULL para ambas.
CREATE OR ALTER PROCEDURE [dbo].[sp_GrillaPromosMPTesi]
    @fuente VARCHAR(10) = NULL,
    @dias   INT         = 60
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        fuente,
        date_created,
        transaction_amount,
        mercadopago_fee,
        net_received_amount,
        cuotas,
        payment_type,
        description,
        financing_fee,
        sub_unit,
        franchise,
        issuer_name
    FROM [dbo].[mp_transacciones]
    WHERE (@fuente IS NULL OR fuente = @fuente)
      AND (date_created IS NULL OR date_created >= DATEADD(DAY, -@dias, GETUTCDATE()))
    ORDER BY date_created DESC;
END
GO

PRINT 'SP sp_GrillaPromosMPTesi creado/actualizado.';
GO
