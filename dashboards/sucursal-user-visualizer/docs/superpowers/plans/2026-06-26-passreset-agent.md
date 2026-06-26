# PassReset Agent — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extender `agent/index.js` para que cada agente remoto consulte usuarios con contraseña vencida en `db_Cegid`, cambie la contraseña Windows con `net user`, reporte el resultado vía SP, y dispare el envío de correo desde SQL Server.

**Architecture:** El agente mantiene un pool SQL separado hacia `db_Cegid`. En cada ciclo (y al arrancar) llama `sp_PassReset_AgentGetPendientes`, cambia contraseñas con `execSync('net user ...')`, y reporta con `sp_PassReset_AgentReportarCambio`. Este SP, modificado, llama al nuevo `sp_PassReset_EnviarCorreo` post-commit para enviar el correo vía Database Mail.

**Tech Stack:** Node.js 18+ (CommonJS), `mssql` npm package, SQL Server 2014+, `msdb.dbo.sp_send_dbmail`.

## Global Constraints

- `agent/index.js` es CommonJS puro (`require`, no `import`). No cambiar módulo system.
- Sin bundler — el archivo se corre directamente con `node index.js`.
- El agente corre como SYSTEM en Windows → tiene permisos para `net user`.
- Credenciales SQL solo en `.env`, nunca hardcodeadas.
- `PASSRESET_ENABLED !== 'true'` → `passreset()` retorna sin hacer nada.
- Errores en un usuario individual no deben abortar el ciclo completo.
- El SP `sp_PassReset_EnviarCorreo` se crea en `db_Cegid` y necesita permiso EXECUTE sobre `msdb.dbo.sp_send_dbmail`.
- Archivo SQL a modificar: `C:\apps\dashboards\PassReset\SQL\02_StoredProcedures.sql`.

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `PassReset/SQL/02_StoredProcedures.sql` | Modificar | Agregar `sp_PassReset_EnviarCorreo` + reescribir `sp_PassReset_AgentReportarCambio` |
| `agent/index.js` | Modificar | Pool SQL PassReset + `generatePassword()` + `passreset()` |
| `agent/install-agent.ps1` | Modificar | Parámetros SQL nuevos + `npm install mssql` |

---

### Tarea 1: SQL — Nuevo SP `sp_PassReset_EnviarCorreo` + modificar `sp_PassReset_AgentReportarCambio`

**Archivos:**
- Modificar: `C:\apps\dashboards\PassReset\SQL\02_StoredProcedures.sql`

**Interfaces:**
- Produce: `dbo.sp_PassReset_EnviarCorreo(@CorreoDestino, @UsuarioWindows, @PasswordGenerada, @Servidor, @FechaProximoCambio)`
- Produce: `dbo.sp_PassReset_AgentReportarCambio` (misma firma, comportamiento extendido)

- [ ] **Paso 1: Agregar `sp_PassReset_EnviarCorreo` al final de `02_StoredProcedures.sql`**

Abrir `C:\apps\dashboards\PassReset\SQL\02_StoredProcedures.sql` y reemplazar el bloque final `PRINT '=== 02_StoredProcedures.sql completado...'` por:

```sql
-- =============================================================================
--  sp_PassReset_EnviarCorreo
--  Envía correo al usuario con su nueva contraseña.
--  Llamado por sp_PassReset_AgentReportarCambio después del COMMIT.
--  Lee el profile de Database Mail desde msdb (no hardcodeado).
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

    DECLARE @profile    NVARCHAR(255);
    DECLARE @subject    NVARCHAR(500);
    DECLARE @body       NVARCHAR(MAX);
    DECLARE @fechaStr   NVARCHAR(20);

    -- Leer profile default de Database Mail
    SELECT TOP 1 @profile = profile_name
    FROM msdb.dbo.sysmail_principalprofile
    WHERE is_default = 1;

    -- Fallback: primer profile disponible
    IF @profile IS NULL
        SELECT TOP 1 @profile = profile_name
        FROM msdb.dbo.sysmail_profile;

    IF @profile IS NULL
    BEGIN
        RAISERROR('No se encontró ningún profile de Database Mail configurado.', 16, 1);
        RETURN;
    END

    SET @fechaStr = CONVERT(VARCHAR(20), @FechaProximoCambio, 103); -- dd/mm/yyyy

    SET @subject = N'Contraseña actualizada — ' + @Servidor;

    SET @body =
        N'Se actualizó automáticamente la contraseña de tu cuenta Windows.' + CHAR(13) + CHAR(10) +
        CHAR(13) + CHAR(10) +
        N'  Servidor : ' + @Servidor       + CHAR(13) + CHAR(10) +
        N'  Usuario  : ' + @UsuarioWindows + CHAR(13) + CHAR(10) +
        N'  Contraseña nueva : ' + @PasswordGenerada + CHAR(13) + CHAR(10) +
        N'  Próximo cambio   : ' + @fechaStr + CHAR(13) + CHAR(10) +
        CHAR(13) + CHAR(10) +
        N'Guardá esta información en un lugar seguro.' + CHAR(13) + CHAR(10) +
        N'Este correo fue generado automáticamente.';

    EXEC msdb.dbo.sp_send_dbmail
        @profile_name  = @profile,
        @recipients    = @CorreoDestino,
        @subject       = @subject,
        @body          = @body,
        @body_format   = 'TEXT';
END
GO

PRINT '=== 02_StoredProcedures.sql completado en db_Cegid ===';
GO
```

- [ ] **Paso 2: Reemplazar `sp_PassReset_AgentReportarCambio` en `02_StoredProcedures.sql`**

Localizar el bloque completo del SP (desde `IF OBJECT_ID('dbo.sp_PassReset_AgentReportarCambio'...` hasta su `GO` final) y reemplazarlo por:

```sql
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
        THROW;
    END CATCH

    -- Envío de correo fuera de la transacción: si falla, el log ya quedó guardado
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
            -- Mail falló: actualizar el log a OK_MAIL_ERROR
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
```

- [ ] **Paso 3: Ejecutar el script en SQL Server**

Conectar a `10.0.0.115` (base `db_Cegid`) con SSMS o sqlcmd y ejecutar el archivo completo `02_StoredProcedures.sql`. Verificar que no haya errores.

```powershell
sqlcmd -S 10.0.0.115 -d db_Cegid -U sa -i "C:\apps\dashboards\PassReset\SQL\02_StoredProcedures.sql"
```

Salida esperada (últimas líneas):
```
sp_PassReset_EnviarCorreo creado.
sp_PassReset_AgentReportarCambio recreado.
=== 02_StoredProcedures.sql completado en db_Cegid ===
```

- [ ] **Paso 4: Verificar permisos de Database Mail**

Si el usuario SQL que usa el agente no es `sa`, asegurarse de que tenga acceso al profile:
```sql
USE msdb;
EXEC sp_addrolemember 'DatabaseMailUserRole', '<usuario_agente>';
```
Si el agente usa `sa`, este paso no es necesario.

- [ ] **Paso 5: Test manual del SP de correo**

En SSMS, ejecutar:
```sql
USE db_Cegid;
EXEC dbo.sp_PassReset_EnviarCorreo
    @CorreoDestino      = N'leandro.nefa@valenet.com.ar',
    @UsuarioWindows     = N'TestUser',
    @PasswordGenerada   = N'Test@1234xx',
    @Servidor           = N'TEST-SERVER',
    @FechaProximoCambio = DATEADD(DAY, 30, GETDATE());
```

Verificar que llegue el correo a la casilla de prueba.

- [ ] **Paso 6: Commit del SQL**

```powershell
cd C:\apps
git add dashboards/PassReset/SQL/02_StoredProcedures.sql
git commit -m "feat(sql): sp_PassReset_EnviarCorreo + AgentReportarCambio llama correo post-commit"
```

---

### Tarea 2: `agent/index.js` — Pool SQL + `generatePassword` + `passreset()`

**Archivos:**
- Modificar: `C:\apps\dashboards\sucursal-user-visualizer\agent\index.js`

**Interfaces:**
- Consume (Tarea 1): `dbo.sp_PassReset_AgentGetPendientes(@Servidor)` → `[{Id, UsuarioWindows, CorreoDestino, MaxDias, UltimoCambio}]`
- Consume (Tarea 1): `dbo.sp_PassReset_AgentReportarCambio(@IdUsuario, @Servidor, @UsuarioWindows, @PasswordGenerada, @CorreoDestino, @Resultado, @MensajeError, @FechaProximoCambio, @Origen)`
- Consume (Tarea 3): Variables de entorno `PASSRESET_ENABLED`, `PASSRESET_SQL_SERVER`, `PASSRESET_SQL_DB`, `PASSRESET_SQL_USER`, `PASSRESET_SQL_PASSWORD`

- [ ] **Paso 1: Agregar `require('mssql')` y leer env vars al inicio del archivo**

Abrir `C:\apps\dashboards\sucursal-user-visualizer\agent\index.js`.

Después de las líneas de `require` existentes (líneas 7-9), agregar:

```js
const sql    = require('mssql');
const crypto = require('crypto');
```

Después de la línea `const PROCESSES = ...` (línea 16), agregar:

```js
const PASSRESET_ENABLED      = process.env.PASSRESET_ENABLED === 'true';
const PASSRESET_SQL_SERVER   = process.env.PASSRESET_SQL_SERVER || '10.0.0.115';
const PASSRESET_SQL_DB       = process.env.PASSRESET_SQL_DB     || 'db_Cegid';
const PASSRESET_SQL_USER     = process.env.PASSRESET_SQL_USER   || 'sa';
const PASSRESET_SQL_PASSWORD = process.env.PASSRESET_SQL_PASSWORD || '';
```

- [ ] **Paso 2: Agregar pool SQL y `generatePassword`**

Después del bloque de constantes (antes de `function getLocalIP()`), agregar:

```js
// ---- PassReset: pool SQL ----
let prPool = null;

async function getPassResetPool() {
  if (prPool && prPool.connected) return prPool;
  prPool = new sql.ConnectionPool({
    server:   PASSRESET_SQL_SERVER,
    user:     PASSRESET_SQL_USER,
    password: PASSRESET_SQL_PASSWORD,
    database: PASSRESET_SQL_DB,
    options:  { trustServerCertificate: true, encrypt: false },
    pool:     { max: 3, min: 0, idleTimeoutMillis: 30000 },
  });
  await prPool.connect();
  return prPool;
}

function generatePassword() {
  const lower   = 'abcdefghijklmnopqrstuvwxyz';
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits  = '0123456789';
  const special = '@#$!%';
  const all     = lower + upper + digits + special;

  // Garantizar al menos 1 de cada clase
  const mandatory = [
    lower  [crypto.randomBytes(1)[0] % lower.length],
    upper  [crypto.randomBytes(1)[0] % upper.length],
    digits [crypto.randomBytes(1)[0] % digits.length],
    special[crypto.randomBytes(1)[0] % special.length],
  ];

  // Completar hasta 12 caracteres
  const rest = Array.from({ length: 8 }, () => all[crypto.randomBytes(1)[0] % all.length]);

  // Mezclar
  const chars = [...mandatory, ...rest];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
```

- [ ] **Paso 3: Agregar función `passreset()`**

Agregar antes de la línea `console.log(\`[${new Date()...]\` Agente iniciado...`)`:

```js
// ---- PassReset: ciclo de cambio de contraseñas ----
async function passreset() {
  if (!PASSRESET_ENABLED) return;

  let db;
  try {
    db = await getPassResetPool();
  } catch (e) {
    console.error(`[${new Date().toISOString()}] [passreset] Error conectando a SQL: ${e.message}`);
    prPool = null; // forzar reconexión en el próximo ciclo
    return;
  }

  let pendientes;
  try {
    const result = await db.request()
      .input('Servidor', sql.NVarChar, SERVER_ID)
      .execute('sp_PassReset_AgentGetPendientes');
    pendientes = result.recordset;
  } catch (e) {
    console.error(`[${new Date().toISOString()}] [passreset] Error consultando pendientes: ${e.message}`);
    return;
  }

  if (!pendientes || pendientes.length === 0) {
    console.log(`[${new Date().toISOString()}] [passreset] Sin pendientes para ${SERVER_ID}`);
    return;
  }

  console.log(`[${new Date().toISOString()}] [passreset] ${pendientes.length} usuario(s) pendiente(s)`);

  for (const u of pendientes) {
    const { Id, UsuarioWindows, CorreoDestino, MaxDias } = u;
    const password = generatePassword();
    const fechaProximoCambio = new Date(Date.now() + MaxDias * 86400000);

    let resultado    = 'OK';
    let mensajeError = null;

    try {
      execSync(`net user "${UsuarioWindows}" "${password}"`, { encoding: 'utf8', timeout: 10000 });
      console.log(`[${new Date().toISOString()}] [passreset] Contraseña cambiada: ${UsuarioWindows}`);
    } catch (e) {
      resultado    = 'ERROR';
      mensajeError = e.message.slice(0, 500);
      console.error(`[${new Date().toISOString()}] [passreset] Error net user ${UsuarioWindows}: ${mensajeError}`);
    }

    try {
      await db.request()
        .input('IdUsuario',          sql.Int,      Id)
        .input('Servidor',           sql.NVarChar, SERVER_ID)
        .input('UsuarioWindows',     sql.NVarChar, UsuarioWindows)
        .input('PasswordGenerada',   sql.NVarChar, password)
        .input('CorreoDestino',      sql.NVarChar, CorreoDestino)
        .input('Resultado',          sql.NVarChar, resultado)
        .input('MensajeError',       sql.NVarChar, mensajeError)
        .input('FechaProximoCambio', sql.DateTime, fechaProximoCambio)
        .input('Origen',             sql.NVarChar, 'AUTO')
        .execute('sp_PassReset_AgentReportarCambio');
    } catch (e) {
      console.error(`[${new Date().toISOString()}] [passreset] Error reportando cambio ${UsuarioWindows}: ${e.message}`);
    }
  }
}
```

- [ ] **Paso 4: Integrar `passreset()` en el loop existente**

Localizar las últimas líneas del archivo:

```js
report(); // reporte inmediato al arrancar
setInterval(report, INTERVAL_MS);
```

Reemplazarlas por:

```js
report();
passreset();

setInterval(() => { report(); passreset(); }, INTERVAL_MS);
```

- [ ] **Paso 5: Instalar `mssql` en la carpeta del agente**

```powershell
cd C:\apps\dashboards\sucursal-user-visualizer\agent
npm init -y   # solo si no hay package.json
npm install mssql
```

Verificar que se creó (o actualizó) `package.json` y `node_modules/mssql`.

- [ ] **Paso 6: Test manual en primer plano**

Crear un usuario de prueba en tbl_PassReset_Usuarios con `UltimoCambio = NULL` (o una fecha vieja):

```sql
USE db_Cegid;
-- Asegurarse de que el usuario Windows 'UsuarioDePrueba' exista en el servidor antes de este test.
-- Insertar o resetear la fecha para forzar que aparezca como pendiente:
IF NOT EXISTS (
    SELECT 1 FROM dbo.tbl_PassReset_Usuarios
    WHERE Servidor = '10.0.0.118' AND UsuarioWindows = 'UsuarioDePrueba'
)
    INSERT INTO dbo.tbl_PassReset_Usuarios (Servidor, UsuarioWindows, CorreoDestino, MaxDias)
    VALUES ('10.0.0.118', 'UsuarioDePrueba', 'leandro.nefa@valenet.com.ar', 30);
ELSE
    UPDATE dbo.tbl_PassReset_Usuarios
    SET UltimoCambio = NULL
    WHERE Servidor = '10.0.0.118' AND UsuarioWindows = 'UsuarioDePrueba';
```

Levantar el agente en primer plano con las vars de entorno configuradas:

```powershell
cd C:\apps\dashboards\sucursal-user-visualizer\agent
$env:CENTRAL_URL        = "http://10.0.0.118:3003"
$env:AGENT_TOKEN        = "sucursal-agent-token"
$env:SERVER_ID          = "10.0.0.118"
$env:PASSRESET_ENABLED  = "true"
$env:PASSRESET_SQL_SERVER = "10.0.0.115"
$env:PASSRESET_SQL_DB     = "db_Cegid"
$env:PASSRESET_SQL_USER   = "sa"
$env:PASSRESET_SQL_PASSWORD = "<password>"
node index.js
```

Verificar en consola:
```
[passreset] 1 usuario(s) pendiente(s)
[passreset] Contraseña cambiada: UsuarioDePrueba
```

Verificar en SQL:
```sql
SELECT TOP 1 * FROM dbo.tbl_PassReset_Log ORDER BY Id DESC;
-- Resultado esperado: Resultado='OK' o 'OK_MAIL_ERROR', UltimoCambio actualizado
```

- [ ] **Paso 7: Commit**

```powershell
cd C:\apps
git add dashboards/sucursal-user-visualizer/agent/index.js
git add dashboards/sucursal-user-visualizer/agent/package.json
git add dashboards/sucursal-user-visualizer/agent/package-lock.json
git commit -m "feat(agent): PassReset — pool SQL, generatePassword, passreset()"
```

---

### Tarea 3: `install-agent.ps1` — Parámetros SQL + `npm install mssql`

**Archivos:**
- Modificar: `C:\apps\dashboards\sucursal-user-visualizer\agent\install-agent.ps1`

**Interfaces:**
- Produce: `.env` del agente con las 5 variables nuevas de PassReset
- Produce: `ecosystem.config.cjs` con esas mismas variables en el bloque `env`
- Produce: `mssql` instalado en el directorio del agente antes de que PM2 lo arranque

- [ ] **Paso 1: Agregar parámetros al bloque `param()`**

Abrir `install-agent.ps1`. Localizar el bloque `param(` y agregar al final (antes del cierre `)`):

```powershell
    [string]$PassresetEnabled   = "true",
    [string]$PassresetSqlServer = "10.0.0.115",
    [string]$PassresetSqlDb     = "db_Cegid",
    [string]$PassresetSqlUser   = "sa",
    [string]$PassresetSqlPass   = ""
```

- [ ] **Paso 2: Agregar las variables al `.env` generado**

Localizar el heredoc `$EnvContent = @"..."@` y agregar al final del cuerpo (antes del `"@` de cierre):

```powershell
PASSRESET_ENABLED=$PassresetEnabled
PASSRESET_SQL_SERVER=$PassresetSqlServer
PASSRESET_SQL_DB=$PassresetSqlDb
PASSRESET_SQL_USER=$PassresetSqlUser
PASSRESET_SQL_PASSWORD=$PassresetSqlPass
```

- [ ] **Paso 3: Agregar las variables al bloque `env` del `ecosystem.config.cjs`**

Localizar el heredoc `$EcoContent = @"..."@`. Dentro del objeto `env: { ... }`, agregar después de la última variable existente:

```powershell
      PASSRESET_ENABLED: '$PassresetEnabled',
      PASSRESET_SQL_SERVER: '$PassresetSqlServer',
      PASSRESET_SQL_DB: '$PassresetSqlDb',
      PASSRESET_SQL_USER: '$PassresetSqlUser',
      PASSRESET_SQL_PASSWORD: '$PassresetSqlPass'
```

- [ ] **Paso 4: Instalar `mssql` antes de iniciar PM2**

Localizar la línea `Write-Host "Iniciando agente con PM2..."` e insertar antes de ella:

```powershell
# Instalar dependencias npm del agente (mssql)
Write-Host "Instalando dependencias npm del agente..." -ForegroundColor Cyan
npm install --prefix $AgentDir mssql
if ($LASTEXITCODE -ne 0) {
    Write-Warning "npm install falló. El agente arrancará pero PassReset no funcionará sin mssql."
}
```

- [ ] **Paso 5: Verificar el script completo**

Revisar que el `.env` generado tenga las 5 variables nuevas y que `ecosystem.config.cjs` las propague. No ejecutar el instalador todavía — solo revisión de código.

- [ ] **Paso 6: Test del instalador (en servidor remoto o en 10.0.0.118)**

```powershell
cd C:\apps\dashboards\sucursal-user-visualizer\agent
.\install-agent.ps1 `
    -ServerId "10.0.0.118" `
    -CentralUrl "http://10.0.0.118:3003" `
    -PassresetEnabled "true" `
    -PassresetSqlServer "10.0.0.115" `
    -PassresetSqlDb "db_Cegid" `
    -PassresetSqlUser "sa" `
    -PassresetSqlPass "<password>"
```

Verificar:
```powershell
cat "$AgentDir\.env"           # debe incluir las 5 variables PASSRESET_*
pm2 status                      # sucursal-agent debe estar online
pm2 logs sucursal-agent --lines 20  # debe mostrar "[passreset]" en los logs
```

- [ ] **Paso 7: Commit**

```powershell
cd C:\apps
git add dashboards/sucursal-user-visualizer/agent/install-agent.ps1
git commit -m "feat(agent): install-agent.ps1 agrega vars SQL PassReset + npm install mssql"
```

---

## Orden de ejecución recomendado

1. **Tarea 1** (SQL) — crear los SPs primero; el agente depende de ellos.
2. **Tarea 2** (agent/index.js) — agregar la lógica al agente.
3. **Tarea 3** (install-agent.ps1) — actualizar el instalador.

Las Tareas 2 y 3 son independientes entre sí y pueden hacerse en paralelo.
