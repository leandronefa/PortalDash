/* ============================================================================
   Portal de Dashboards · Base de datos PROPIA de la aplicacion (SQL Server)
   ----------------------------------------------------------------------------
   USO: SOLO si configura  Database:Provider = "SqlServer"  en appsettings.json.
        Por defecto la aplicacion usa SQLite y NO necesita este script
        (Entity Framework crea el esquema automaticamente al iniciar).

   Este script reproduce exactamente el modelo que genera EF Core, de modo que
   ambos caminos (EF o script) sean compatibles.

   Ejecutar con un usuario con permisos para crear bases de datos.
   ============================================================================ */

IF DB_ID('DashboardPortal') IS NULL
    CREATE DATABASE [DashboardPortal];
GO

USE [DashboardPortal];
GO

/* ---------- Dashboards ---------- */
IF OBJECT_ID('dbo.Dashboards', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Dashboards (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Dashboards PRIMARY KEY,
        Name         NVARCHAR(120)  NOT NULL,
        Description  NVARCHAR(500)  NULL,
        Port         INT            NOT NULL,
        Host         NVARCHAR(200)  NULL,
        UrlOverride  NVARCHAR(500)  NULL,
        Icon         NVARCHAR(40)   NOT NULL CONSTRAINT DF_Dashboards_Icon DEFAULT('chart'),
        IsActive     BIT            NOT NULL CONSTRAINT DF_Dashboards_IsActive DEFAULT(1),
        CreatedAt    DATETIME2(7)   NOT NULL CONSTRAINT DF_Dashboards_CreatedAt DEFAULT(SYSDATETIME())
    );
    CREATE INDEX IX_Dashboards_Port ON dbo.Dashboards(Port);
END
GO

/* ---------- Usuarios (corporativos conocidos por el portal) ---------- */
IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Users PRIMARY KEY,
        Username     NVARCHAR(150)  NOT NULL,
        DisplayName  NVARCHAR(200)  NULL,
        IsActive     BIT            NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT(1),
        CreatedAt    DATETIME2(7)   NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT(SYSDATETIME()),
        LastLoginAt  DATETIME2(7)   NULL
    );
    CREATE UNIQUE INDEX UX_Users_Username ON dbo.Users(Username);
END
GO

/* ---------- Permisos (usuario <-> dashboard) ---------- */
IF OBJECT_ID('dbo.Permissions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Permissions (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Permissions PRIMARY KEY,
        AppUserId    INT            NOT NULL,
        DashboardId  INT            NOT NULL,
        GrantedAt    DATETIME2(7)   NOT NULL CONSTRAINT DF_Permissions_GrantedAt DEFAULT(SYSDATETIME()),
        CONSTRAINT FK_Permissions_Users     FOREIGN KEY (AppUserId)   REFERENCES dbo.Users(Id)      ON DELETE CASCADE,
        CONSTRAINT FK_Permissions_Dashboards FOREIGN KEY (DashboardId) REFERENCES dbo.Dashboards(Id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX UX_Permissions_User_Dashboard ON dbo.Permissions(AppUserId, DashboardId);
END
GO

/* ---------- Configuracion (clave/valor) ---------- */
IF OBJECT_ID('dbo.Settings', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Settings (
        [Key]   NVARCHAR(100)  NOT NULL CONSTRAINT PK_Settings PRIMARY KEY,
        Value   NVARCHAR(1000) NULL
    );
END
GO

/* ---------- Auditoria de accesos ---------- */
IF OBJECT_ID('dbo.AccessLogs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccessLogs (
        Id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccessLogs PRIMARY KEY,
        Username     NVARCHAR(150)  NOT NULL,
        Action       NVARCHAR(60)   NOT NULL,
        DashboardId  INT            NULL,
        Detail       NVARCHAR(300)  NULL,
        IpAddress    NVARCHAR(60)   NULL,
        Success      BIT            NOT NULL,
        [Timestamp]  DATETIME2(7)   NOT NULL CONSTRAINT DF_AccessLogs_Timestamp DEFAULT(SYSDATETIME())
    );
    CREATE INDEX IX_AccessLogs_Timestamp ON dbo.AccessLogs([Timestamp]);
    CREATE INDEX IX_AccessLogs_Username  ON dbo.AccessLogs(Username);
END
GO

PRINT 'Base de datos DashboardPortal lista.';
GO
