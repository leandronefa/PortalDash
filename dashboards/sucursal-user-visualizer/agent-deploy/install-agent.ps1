# install-agent.ps1
# Instala el agente de monitoreo en este servidor con PM2
# Uso: .\install-agent.ps1 -ServerId "10.104.12.2"
# Para desinstalar: .\install-agent.ps1 -Uninstall

param(
    [switch]$Uninstall,
    [string]$AppName     = "sucursal-agent",
    [string]$CentralUrl  = "http://10.0.0.118:3003",
    [string]$AgentToken  = "sucursal-agent-token",
    [string]$ServerId    = "",
    [string]$Processes   = "FileAppCliente.exe,DOAStatus.exe",
    [string]$IntervalMs  = "300000",
    [string]$PassresetEnabled      = "true",
    [string]$PassresetSqlServer    = "10.0.0.115",
    [string]$PassresetSqlDb        = "db_Cegid",
    [string]$PassresetSqlUser      = "sa",
    [string]$PassresetSqlPass      = "",
    [string]$PassresetExcludeUsers = "Administrador,Administrator,SYSTEM,DefaultAccount,WDAGUtilityAccount,Invitado,Guest"
)

$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AgentScript = "$AgentDir\index.js"

# ---- Validar Node.js ----
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeCmd) {
    Write-Error "Node.js no encontrado. Instala Node.js primero."
    exit 1
}

# ---- Instalar PM2 si falta ----
$Pm2Cmd = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $Pm2Cmd) {
    Write-Host "Instalando PM2..." -ForegroundColor Cyan
    npm install -g pm2
}

# ---- Desinstalar ----
if ($Uninstall) {
    Write-Host "Eliminando '$AppName' de PM2..." -ForegroundColor Yellow
    pm2 delete $AppName
    pm2 save
    $TaskName = "PM2-$AppName-Startup"
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Tarea programada '$TaskName' eliminada." -ForegroundColor Yellow
    Write-Host "Listo." -ForegroundColor Green
    exit 0
}

# ---- Detectar IP local si no se proporcionó ----
if (-not $ServerId) {
    $ServerId = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -First 1).IPAddress
    Write-Host "SERVER_ID detectado automáticamente: $ServerId" -ForegroundColor Cyan
}

# ---- Escribir .env del agente ----
$EnvContent = @"
CENTRAL_URL=$CentralUrl
AGENT_TOKEN=$AgentToken
SERVER_ID=$ServerId
PROCESSES=$Processes
INTERVAL_MS=$IntervalMs
PASSRESET_ENABLED=$PassresetEnabled
PASSRESET_SQL_SERVER=$PassresetSqlServer
PASSRESET_SQL_DB=$PassresetSqlDb
PASSRESET_SQL_USER=$PassresetSqlUser
PASSRESET_SQL_PASSWORD=$PassresetSqlPass
PASSRESET_EXCLUDE_USERS=$PassresetExcludeUsers
"@
Set-Content -Path "$AgentDir\.env" -Value $EnvContent
Write-Host ".env del agente configurado (SERVER_ID=$ServerId)" -ForegroundColor Green

# ---- Crear carpeta de logs ----
New-Item -ItemType Directory -Force -Path "$AgentDir\logs" | Out-Null

# ---- Generar ecosystem.config.cjs ----
$AgentDirFwd = $AgentDir -replace '\\', '/'
$EcoContent = @"
module.exports = {
  apps: [{
    name: '$AppName',
    script: '$AgentDirFwd/index.js',
    interpreter: 'node',
    cwd: '$AgentDirFwd',
    out_file: '$AgentDirFwd/logs/out.log',
    error_file: '$AgentDirFwd/logs/err.log',
    time: true,
    restart_delay: 5000,
    env: {
      CENTRAL_URL: '$CentralUrl',
      AGENT_TOKEN: '$AgentToken',
      SERVER_ID: '$ServerId',
      PROCESSES: '$Processes',
      INTERVAL_MS: '$IntervalMs',
      PASSRESET_ENABLED: '$PassresetEnabled',
      PASSRESET_SQL_SERVER: '$PassresetSqlServer',
      PASSRESET_SQL_DB: '$PassresetSqlDb',
      PASSRESET_SQL_USER: '$PassresetSqlUser',
      PASSRESET_SQL_PASSWORD: '$PassresetSqlPass',
      PASSRESET_EXCLUDE_USERS: '$PassresetExcludeUsers'
    }
  }]
};
"@
Set-Content -Path "$AgentDir\ecosystem.config.cjs" -Value $EcoContent

# ---- Instalar dependencias npm ----
# Instalar dependencias npm del agente (mssql para PassReset)
Write-Host "Instalando dependencias npm del agente..." -ForegroundColor Cyan
npm install --prefix $AgentDir mssql
if ($LASTEXITCODE -ne 0) {
    Write-Warning "npm install falló. El agente arrancará pero PassReset no funcionará sin mssql."
}

# ---- Iniciar con PM2 ----
Write-Host "Iniciando agente con PM2..." -ForegroundColor Cyan
pm2 delete $AppName 2>$null
pm2 start "$AgentDir\ecosystem.config.cjs"
pm2 save

# ---- Configurar arranque automatico via Programador de Tareas ----
$TaskName = "PM2-$AppName-Startup"
$NodePath = (Get-Command node).Source
$Pm2Path  = (Get-Command pm2).Source

# Eliminar tarea anterior si existe
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$Action  = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$Pm2Path`" resurrect" -WorkingDirectory $AgentDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host ""
Write-Host "Agente corriendo. Reportando a: $CentralUrl" -ForegroundColor Green
Write-Host "SERVER_ID: $ServerId" -ForegroundColor Cyan
Write-Host ""
Write-Host "IMPORTANTE: Tarea programada '$TaskName' creada para arranque automatico tras reinicio." -ForegroundColor Green
Write-Host "Para verificar despues de reiniciar: pm2 status" -ForegroundColor Yellow
Write-Host ""
Write-Host "Comandos utiles:" -ForegroundColor Yellow
Write-Host "  Ver logs:      pm2 logs $AppName"
Write-Host "  Ver uptime:    pm2 show $AppName"
Write-Host "  Ver estado:    pm2 status"
Write-Host "  Ver tarea:     Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Desinstalar:   .\install-agent.ps1 -Uninstall"
