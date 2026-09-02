-- Tablas nuevas para pre-agregar ventas/promocion/transito por dia y acelerar cambios de fecha en
-- el tablero. Ver docs/superpowers/specs/2026-09-02-preagregado-ventas-diarias-design.md para el
-- analisis completo. Aditivas -- no se toca ninguna tabla existente.

IF OBJECT_ID('dbo.MotorReposicion_VentasPorDia') IS NULL
BEGIN
  CREATE TABLE dbo.MotorReposicion_VentasPorDia (
    Fecha                DATE          NOT NULL,
    Sucursal             VARCHAR(20)   NOT NULL,
    CodArticulo          VARCHAR(50)   NOT NULL,
    COLOR                VARCHAR(50)   NOT NULL,
    TALLE                VARCHAR(20)   NOT NULL,
    CantidadVendida      DECIMAL(18,4) NOT NULL,
    CantidadVentasPromo  INT           NOT NULL,
    NombrePromoDia       VARCHAR(100)  NULL,
    DescuentoPromoDia    FLOAT         NULL,
    CONSTRAINT PK_MotorReposicion_VentasPorDia PRIMARY KEY CLUSTERED (Fecha, Sucursal, CodArticulo, COLOR, TALLE)
  );
END

IF OBJECT_ID('dbo.MotorReposicion_TransitoHoy') IS NULL
BEGIN
  CREATE TABLE dbo.MotorReposicion_TransitoHoy (
    Sucursal          VARCHAR(20)   NOT NULL,
    CodArticulo       VARCHAR(50)   NOT NULL,
    COLOR             VARCHAR(50)   NOT NULL,
    TALLE             VARCHAR(20)   NOT NULL,
    TransitoPendiente DECIMAL(18,4) NOT NULL,
    CONSTRAINT PK_MotorReposicion_TransitoHoy PRIMARY KEY CLUSTERED (Sucursal, CodArticulo, COLOR, TALLE)
  );
END
