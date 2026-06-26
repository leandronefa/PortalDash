# PassReset Agent — Diseño técnico
**Fecha:** 2026-06-26  
**Proyecto:** `sucursal-user-visualizer` — `agent/index.js`

---

## Objetivo

Extender el agente de monitoreo existente (`agent/index.js`) para que, además de reportar métricas, gestione el ciclo de vida de contraseñas de usuarios Windows en cada servidor remoto.

---

## Contexto

### Infraestructura existente
- El agente corre en cada servidor remoto gestionado (~10 servidores).
- Está escrito en CommonJS puro, sin dependencias npm (solo Node.js built-ins).
- Reporta métricas (CPU, RAM, disco, procesos) al servidor central vía `POST /api/agent` cada 5 minutos.
- Se instala con PM2 + Tarea Programada mediante `install-agent.ps1`.

### Base de datos
- **Servidor:** `10.0.0.115`
- **Base:** `db_Cegid`
- **Tablas:** `tbl_PassReset_Usuarios`, `tbl_PassReset_Log`
- **SPs de agente (ya creados):**
  - `sp_PassReset_AgentUpsertUsuario`
  - `sp_PassReset_AgentGetPendientes`
  - `sp_PassReset_AgentReportarCambio`
- **Database Mail:** configurado y operativo en `10.0.0.115`.

### Dashboard PassReset
Existe en `C:\apps\dashboards\PassReset` (puerto 3009). Lee la misma DB. Los registros de `tbl_PassReset_Usuarios` (incluyendo `CorreoDestino` y `MaxDias`) son gestionados por el admin desde ese dashboard o por SQL directo. El agente no crea usuarios nuevos — solo opera sobre los que ya existen en la tabla.

---

## Flujo de PassReset

```
Al arrancar el agente Y cada INTERVAL_MS:

  passreset()
    ├─ si PASSRESET_ENABLED != 'true' → salir sin hacer nada
    ├─ conectar a db_Cegid (pool persistente, reconecta si cae)
    ├─ EXEC sp_PassReset_AgentGetPendientes @Servidor
    │     devuelve: [{Id, UsuarioWindows, CorreoDestino, MaxDias, UltimoCambio}]
    │     (usuarios activos cuya contraseña venció o nunca se cambió)
    │
    └─ Para cada usuario pendiente:
         a) generatePassword()
              → 12 chars: ≥1 mayúscula, ≥1 minúscula, ≥1 dígito, ≥1 especial
              → generada con crypto.randomBytes (built-in, sin deps)
         b) execSync(`net user ${usuario} ${pass}`)
              → @Resultado = 'OK'        si exit code 0
              → @Resultado = 'ERROR'     si lanza excepción
         c) EXEC sp_PassReset_AgentReportarCambio
              @IdUsuario, @Servidor, @UsuarioWindows,
              @PasswordGenerada, @CorreoDestino, @Resultado,
              @MensajeError, @FechaProximoCambio, @Origen='AUTO'
                ├─ BEGIN TRAN: UPDATE UltimoCambio (si OK) + INSERT log
                ├─ COMMIT
                └─ EXEC sp_PassReset_EnviarCorreo ← fuera de la transacción
                       si @Resultado IN ('OK', 'OK_MAIL_ERROR')
```

El correo se envía **fuera de la transacción**: si falla el mail, el cambio de contraseña queda guardado. El resultado almacenado en el log es el del `net user` (no el del mail); si el mail falla, el SP actualiza el registro del log a `'OK_MAIL_ERROR'`.

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `agent/index.js` | +SQL pool + `generatePassword()` + `passreset()` |
| `agent/install-agent.ps1` | +parámetros SQL en `.env` + `npm install mssql` en agent dir |
| `PassReset/SQL/02_StoredProcedures.sql` | +`sp_PassReset_EnviarCorreo` + modificar `sp_PassReset_AgentReportarCambio` |

**Sin cambios en:** `server/index.ts`, frontend, tablas SQL, otros dashboards.

---

## Detalle por componente

### `agent/index.js`

**Nuevas variables de entorno:**
```
PASSRESET_ENABLED=true
PASSRESET_SQL_SERVER=10.0.0.115
PASSRESET_SQL_DB=db_Cegid
PASSRESET_SQL_USER=sa
PASSRESET_SQL_PASSWORD=<se configura en install-agent.ps1>
```

**Nuevas funciones:**

```js
// Pool SQL separado para PassReset (no afecta el pool del central si lo hubiera)
let sqlPool = null;
async function getPassResetPool() { /* conecta/reconecta */ }

function generatePassword() {
  // 12 chars: garantiza complejidad Windows
  // usa crypto.randomBytes — sin deps extra
}

async function passreset() {
  if (process.env.PASSRESET_ENABLED !== 'true') return;
  // 1. getPassResetPool()
  // 2. sp_PassReset_AgentGetPendientes
  // 3. por cada pendiente: generatePassword → net user → sp_PassReset_AgentReportarCambio
  // errores individuales loguean y continúan; no abortan el ciclo
}
```

**Integración con el loop existente:**
```js
// Al arrancar:
report();
passreset();

// Cada INTERVAL_MS:
setInterval(() => { report(); passreset(); }, INTERVAL_MS);
```

### `agent/install-agent.ps1`

Nuevos parámetros opcionales con defaults:
```powershell
param(
  ...
  [string]$PassresetEnabled  = "true",
  [string]$PassresetSqlSrv   = "10.0.0.115",
  [string]$PassresetSqlDb    = "db_Cegid",
  [string]$PassresetSqlUser  = "sa",
  [string]$PassresetSqlPass  = ""   # requerido al instalar
)
```

Antes de iniciar PM2:
```powershell
npm install --prefix $AgentDir mssql
```

Se agregan al `.env` generado y al `ecosystem.config.cjs`.

### `sp_PassReset_EnviarCorreo` (nuevo SP)

```sql
CREATE PROCEDURE dbo.sp_PassReset_EnviarCorreo
    @CorreoDestino      NVARCHAR(255),
    @UsuarioWindows     NVARCHAR(100),
    @PasswordGenerada   NVARCHAR(100),
    @Servidor           NVARCHAR(100),
    @FechaProximoCambio DATETIME
AS
BEGIN
    -- Lee el profile default de Database Mail
    DECLARE @profile NVARCHAR(255)
    SELECT TOP 1 @profile = profile_name
    FROM msdb.dbo.sysmail_principalprofile WHERE is_default = 1
    IF @profile IS NULL
        SELECT TOP 1 @profile = profile_name FROM msdb.dbo.sysmail_profile

    EXEC msdb.dbo.sp_send_dbmail
        @profile_name  = @profile,
        @recipients    = @CorreoDestino,
        @subject       = N'Tu contraseña fue actualizada',
        @body          = N'...',   -- incluye usuario, pass, servidor, próximo cambio
        @body_format   = 'TEXT'
END
```

### `sp_PassReset_AgentReportarCambio` (modificación)

Dentro de la transacción, capturar el ID del log recién insertado:
```sql
DECLARE @LogId INT;
-- (luego del INSERT en tbl_PassReset_Log)
SET @LogId = SCOPE_IDENTITY();
```

Después del COMMIT, agregar:
```sql
IF @Resultado IN ('OK', 'OK_MAIL_ERROR')
BEGIN
    BEGIN TRY
        EXEC dbo.sp_PassReset_EnviarCorreo
            @CorreoDestino, @UsuarioWindows, @PasswordGenerada,
            @Servidor, @FechaProximoCambio;
    END TRY
    BEGIN CATCH
        -- Si el mail falla y el resultado original era OK, actualizar el log
        IF @Resultado = 'OK'
            UPDATE dbo.tbl_PassReset_Log
            SET Resultado    = 'OK_MAIL_ERROR',
                MensajeError = ERROR_MESSAGE()
            WHERE Id = @LogId;
    END CATCH
END
```

---

## Manejo de errores

| Escenario | Comportamiento |
|---|---|
| SQL Server inaccesible al arrancar | Log de error, `passreset()` no corre. Reintenta en el próximo ciclo. |
| Usuario no existe en Windows | `net user` falla → `@Resultado='ERROR'` → se loguea, no se envía mail. |
| `net user` exitoso, mail falla | `@Resultado='OK_MAIL_ERROR'` en el log. `UltimoCambio` se actualiza igual. |
| Error en un usuario | Se loguea y continúa con el siguiente pendiente. |
| Pool SQL cae a mitad de ciclo | Reconecta en el próximo ciclo. |

---

## Generación de contraseña

- Longitud: 12 caracteres
- Juego de chars: `abcdefghijklmnopqrstuvwxyz` + `ABCDEFGHIJKLMNOPQRSTUVWXYZ` + `0123456789` + `@#$!%`
- Garantía: al menos 1 de cada clase antes de completar aleatoriamente
- Fuente de aleatoriedad: `crypto.randomBytes` (Node.js built-in)

---

## Consideraciones de seguridad

- Credenciales SQL van en `.env` del agente, no en el código.
- La contraseña generada se transmite a SQL vía `mssql` (canal TCP local a la red interna).
- La contraseña se guarda en `tbl_PassReset_Log.PasswordGenerada` (texto plano, por diseño de negocio).
- El agente corre como SYSTEM (ya tiene permisos para `net user`).
- `PASSRESET_ENABLED=false` permite excluir servidores sin reinstalar el agente.
