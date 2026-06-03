-- ============================================================
-- Tabla: mp_transaccionesCEGID
-- Propósito: Almacena el resultado del cruce entre ventas (Cegid)
--            y transacciones MercadoPago (Tesi/Pueblo).
-- Cada fila = una venta. Las columnas mp_* son NULL si no matcheó.
-- Se elimina y recrea por dia (fecha_proceso) en cada refresh.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'mp_transaccionesCEGID' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE [dbo].[mp_transaccionesCEGID] (
    [id]                     INT IDENTITY(1,1) PRIMARY KEY,
    [fecha_proceso]          DATETIME2(0)     NOT NULL,

    -- Datos de Venta (Cegid)
    [vta_fecha]              DATETIME2(0)     NULL,
    [vta_suc]                VARCHAR(10)      NULL,
    [vta_numero]             VARCHAR(20)      NULL,
    [vta_cod_cond]           VARCHAR(50)      NULL,
    [vta_nombre_cond]        VARCHAR(200)     NULL,
    [vta_descuento]          DECIMAL(18,2)    NULL,
    [vta_preciolleno]        DECIMAL(18,2)    NULL,
    [vta_importe]            DECIMAL(18,2)    NULL,
    [vta_cod_mp]             VARCHAR(10)      NULL,
    [vta_nom_mp]             VARCHAR(100)     NULL,
    [vta_cuota]              INT              NULL,

    -- Estado del cruce
    [mp_matched]             BIT              NOT NULL DEFAULT 0,
    [mp_fuente]              VARCHAR(10)      NULL,   -- 'Tesi' o 'Pueblo'

    -- Datos de MercadoPago (NULL si no matcheó)
    [mp_date_created]        DATETIME2(0)     NULL,
    [mp_transaction_amount]  DECIMAL(18,2)    NULL,
    [mp_mercadopago_fee]     DECIMAL(18,2)    NULL,
    [mp_net_received_amount] DECIMAL(18,2)    NULL,
    [mp_cuotas]              INT              NULL,
    [mp_payment_type]        VARCHAR(50)      NULL,
    [mp_description]         VARCHAR(200)     NULL,
    [mp_financing_fee]       DECIMAL(18,2)    NULL,
    [mp_sub_unit]            VARCHAR(50)      NULL,
    [mp_franchise]           VARCHAR(100)     NULL,
    [mp_issuer_name]         VARCHAR(100)     NULL
  );

  CREATE INDEX IX_mp_transaccionesCEGID_fecha_proceso
    ON [dbo].[mp_transaccionesCEGID] (fecha_proceso);

  CREATE INDEX IX_mp_transaccionesCEGID_vta_fecha
    ON [dbo].[mp_transaccionesCEGID] (vta_fecha);

  CREATE INDEX IX_mp_transaccionesCEGID_matched
    ON [dbo].[mp_transaccionesCEGID] (mp_matched);

  PRINT 'Tabla mp_transaccionesCEGID creada.';
END
ELSE
  PRINT 'Tabla mp_transaccionesCEGID ya existe.';
GO
