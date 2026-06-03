/* ============================================================================
   Portal de Dashboards · Procedimiento de validacion de usuarios (REFERENCIA)
   ----------------------------------------------------------------------------
   IMPORTANTE
   ----------
   En PRODUCCION, el procedimiento  db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS
   YA EXISTE en el SQL Server corporativo (10.0.0.115) y es provisto por Cegid.
   La aplicacion SOLO lo invoca; NO consulta tablas directamente.

   Este script es un MOCK / REFERENCIA para entornos de PRUEBA donde no se tiene
   acceso al servidor corporativo. Permite probar el login de punta a punta.

   >>> NO EJECUTAR sobre la base de datos corporativa real. <<<

   Contrato que la aplicacion entiende (configurable en appsettings.json):
     - Parametros de entrada:  @USUARIO (nvarchar), @PSW (nvarchar)
     - Devuelve UNA fila con, al menos, una columna indicadora de resultado.
       La app autodetecta columnas cuyo nombre contiene "result", "valid",
       "estado", "acceso", "login", etc., y la compara contra CorporateAuth:SuccessValues.
     - Opcionalmente una columna de nombre (NombreCompleto, Nombre, DisplayName...)
       que se usa para mostrar el nombre del usuario.
   ============================================================================ */

/* ---- (Solo PRUEBAS) crear la base si no existe ---- */
IF DB_ID('db_Cegid') IS NULL
    CREATE DATABASE [db_Cegid];
GO

USE [db_Cegid];
GO

/* ---- (Solo PRUEBAS) tabla demo de usuarios ----
   En produccion la validacion la resuelve el SP real contra el sistema corporativo. */
IF OBJECT_ID('dbo.USUARIOS_APP_DEMO', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.USUARIOS_APP_DEMO (
        Usuario        NVARCHAR(150) NOT NULL PRIMARY KEY,
        Password       NVARCHAR(200) NOT NULL,   -- demo en texto plano: SOLO para pruebas
        NombreCompleto NVARCHAR(200) NULL,
        Activo         BIT NOT NULL DEFAULT(1)
    );

    INSERT INTO dbo.USUARIOS_APP_DEMO (Usuario, Password, NombreCompleto, Activo) VALUES
        ('jperez',  '1234',   'Juan Perez',     1),
        ('mgomez',  'abcd',   'Maria Gomez',    1),
        ('usuario', 'clave',  'Usuario Prueba', 1);
END
GO

/* ---- Procedimiento de validacion (mock con el mismo contrato que el real) ---- */
CREATE OR ALTER PROCEDURE dbo.SP_VALIDAR_INICIO_SESION_APPS
    @USUARIO NVARCHAR(150),
    @PSW     NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Resultado BIT = 0;
    DECLARE @Nombre NVARCHAR(200) = NULL;
    DECLARE @Mensaje NVARCHAR(200) = N'Usuario o contrasena incorrectos.';

    SELECT
        @Resultado = 1,
        @Nombre    = NombreCompleto
    FROM dbo.USUARIOS_APP_DEMO
    WHERE Usuario = @USUARIO
      AND Password = @PSW
      AND Activo = 1;

    IF @Resultado = 1
        SET @Mensaje = N'Acceso correcto.';

    /* Devuelve SIEMPRE una fila con el indicador de resultado y el nombre. */
    SELECT
        Resultado      = @Resultado,
        Mensaje        = @Mensaje,
        NombreCompleto = @Nombre,
        Usuario        = @USUARIO;
END
GO

PRINT 'SP de referencia SP_VALIDAR_INICIO_SESION_APPS creado (entorno de prueba).';
GO
