/* ============================================================================
   Portal de Dashboards · Datos de ejemplo (OPCIONAL, solo provider SqlServer)
   ----------------------------------------------------------------------------
   La aplicacion siembra automaticamente estos dashboards y la configuracion al
   iniciar (tanto en SQLite como en SQL Server). Use este script solo si desea
   cargar los ejemplos manualmente. Es idempotente: no inserta si ya hay datos.
   ============================================================================ */

USE [DashboardPortal];
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Dashboards)
BEGIN
    INSERT INTO dbo.Dashboards (Name, Description, Port, Icon, IsActive, CreatedAt) VALUES
        (N'Dashboard Ventas',   N'Indicadores comerciales y de facturacion.', 8501, N'sales',   1, SYSDATETIME()),
        (N'Dashboard RRHH',     N'Personal, ausentismo y nomina.',            8502, N'people',  1, SYSDATETIME()),
        (N'Dashboard Finanzas', N'Tesoreria, flujo de fondos y resultados.',  8503, N'finance', 1, SYSDATETIME());
END
GO

/* Configuracion base (clave/valor) */
IF NOT EXISTS (SELECT 1 FROM dbo.Settings WHERE [Key] = N'Portal.Title')
    INSERT INTO dbo.Settings ([Key], Value) VALUES (N'Portal.Title', N'Portal de Dashboards');
IF NOT EXISTS (SELECT 1 FROM dbo.Settings WHERE [Key] = N'Portal.ServerHost')
    INSERT INTO dbo.Settings ([Key], Value) VALUES (N'Portal.ServerHost', N'');
IF NOT EXISTS (SELECT 1 FROM dbo.Settings WHERE [Key] = N'Portal.DefaultScheme')
    INSERT INTO dbo.Settings ([Key], Value) VALUES (N'Portal.DefaultScheme', N'http');
GO

PRINT 'Datos de ejemplo cargados.';
GO
