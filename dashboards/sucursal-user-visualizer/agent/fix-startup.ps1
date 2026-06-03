# fix-startup.ps1
# Configura el agente para arrancar automaticamente tras un reinicio de Windows.
# Usa una Tarea Programada que corre como el usuario actual (no SYSTEM),
# porque PM2 guarda el dump en el perfil del usuario y SYSTEM no lo encuentra.
# Ejecutar como Administrador en cada servidor monitoreado.

param(
    [string]$AppName = "sucursal-agent"
)

# ---- Verificar que PM2 este instalado ----
$Pm2Cmd = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $Pm2Cmd) {
    Write-Error "PM2 no encontrado. Asegurate de que Node.js y PM2 esten instalados."
    exit 1
}

# ---- Detectar rutas ----
$NodePath  = (Get-Command node).Source
$Pm2Path   = (Get-Command pm2).Source
$AgentDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$EcoFile   = "$AgentDir\ecosystem.config.cjs"

if (-not (Test-Path $EcoFile)) {
    Write-Error "No se encontro ecosystem.config.cjs en $AgentDir. Ejecuta install-agent.ps1 primero."
    exit 1
}

# ---- Desinstalar pm2-windows-startup si esta presente (falla en Windows) ----
$HasModule = pm2 list 2>$null | Select-String "pm2-windows-startup"
if ($HasModule) {
    Write-Host "Desinstalando pm2-windows-startup (falla en Windows)..." -ForegroundColor Yellow
    pm2 uninstall pm2-windows-startup 2>$null
    Write-Host "Modulo eliminado." -ForegroundColor Green
}

# ---- Asegurarse de que el agente este corriendo y guardado ----
Write-Host "Asegurando que el agente este activo en PM2..." -ForegroundColor Cyan
$IsOnline = pm2 list 2>$null | Select-String $AppName | Select-String "online"
if (-not $IsOnline) {
    pm2 start $EcoFile
}
pm2 save
Write-Host "Estado guardado." -ForegroundColor Green

# ---- Crear script de arranque ----
# Usamos un .cmd intermedio para que la tarea tenga un PATH correcto al arrancar
$StartScript = "$AgentDir\start-agent.cmd"
$NodeDir = Split-Path -Parent $NodePath
$NpmGlobal = npm root -g 2>$null | Split-Path -Parent
@"
@echo off
SET PATH=$NodeDir;$NpmGlobal;%PATH%
"$NodePath" "$Pm2Path" start "$EcoFile"
"@ | Set-Content -Path $StartScript -Encoding ASCII
Write-Host "Script de arranque creado: $StartScript" -ForegroundColor Green

# ---- Crear Tarea Programada como usuario actual ----
# El usuario actual tiene el perfil correcto con los datos de PM2
$TaskName    = "PM2-$AppName-Startup"
$CurrentUser = "$env:USERDOMAIN\$env:USERNAME"

Write-Host "Creando tarea programada '$TaskName' para usuario '$CurrentUser'..." -ForegroundColor Cyan

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$Action   = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$StartScript`""
$Trigger  = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
$Settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

# Pedir contrasena para que la tarea pueda correr aunque la sesion este bloqueada
Write-Host ""
Write-Host "Se necesita la contrasena de '$CurrentUser' para que la tarea corra aunque el equipo este bloqueado." -ForegroundColor Yellow
$Cred = Get-Credential -UserName $CurrentUser -Message "Contrasena de Windows para la tarea programada"

Register-ScheduledTask `
    -TaskName  $TaskName `
    -Action    $Action `
    -Trigger   $Trigger `
    -Settings  $Settings `
    -User      $CurrentUser `
    -Password  $Cred.GetNetworkCredential().Password `
    -RunLevel  Highest `
    -Force | Out-Null

Write-Host ""
Write-Host "Listo." -ForegroundColor Green
Write-Host "Tarea '$TaskName' creada. El agente arrancara automaticamente al iniciar sesion." -ForegroundColor Green
Write-Host ""
Write-Host "Para probar sin reiniciar:" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Start-Sleep -Seconds 5"
Write-Host "  pm2 status"
Write-Host ""
Write-Host "Para ver la tarea:" -ForegroundColor Yellow
Write-Host "  Get-ScheduledTask -TaskName '$TaskName'"
