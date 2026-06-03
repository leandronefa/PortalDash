<#
    install-service.ps1  ·  Instala el portal como Servicio de Windows.
    Ejecutar EN EL SERVIDOR 10.0.0.118, en una consola PowerShell COMO ADMINISTRADOR.

    Supone que ya copio la carpeta publicada (publish.ps1) al servidor.

    Uso (con valores por defecto: C:\apps\portal y puerto 80):
        .\install-service.ps1

    Uso personalizado:
        .\install-service.ps1 -InstallPath "C:\apps\portal" -Port 80
#>
param(
    [string]$InstallPath = "C:\apps\portal",
    [string]$ServiceName = "DashboardPortal",
    [int]$Port = 80
)

$ErrorActionPreference = "Stop"

# 1) Requiere privilegios de administrador
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Error "Debe ejecutar este script como Administrador."
    exit 1
}

# 2) Verificar el ejecutable
$bin = Join-Path $InstallPath "DashboardPortal.exe"
if (-not (Test-Path $bin)) {
    Write-Error "No se encontro $bin. Copie primero la carpeta publicada a $InstallPath."
    exit 1
}

# 3) Si el servicio ya existe, detenerlo y eliminarlo
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "El servicio '$ServiceName' ya existe. Reinstalando..." -ForegroundColor Yellow
    if ($existing.Status -ne 'Stopped') { Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue }
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# 4) Crear el servicio (cuenta LocalSystem: puede escuchar en el puerto 80)
Write-Host "Creando el servicio '$ServiceName' -> $bin" -ForegroundColor Cyan
New-Service -Name $ServiceName `
            -BinaryPathName "`"$bin`"" `
            -DisplayName "Portal de Dashboards" `
            -Description "Portal centralizado de dashboards (responde en http://servidor/)." `
            -StartupType Automatic | Out-Null

# 5) Auto-recuperacion: reiniciar el servicio si falla
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/60000 | Out-Null

# 6) Regla de firewall para el puerto del portal
$ruleName = "DashboardPortal HTTP $Port"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    Write-Host "Regla de firewall creada para el puerto $Port." -ForegroundColor Green
}

# 7) Iniciar
Write-Host "Iniciando el servicio..." -ForegroundColor Cyan
Start-Service $ServiceName
Start-Sleep -Seconds 3
Get-Service $ServiceName | Format-Table Name, Status, StartType -AutoSize

$portSuffix = if ($Port -ne 80) { ":$Port" } else { "" }
Write-Host ""
Write-Host "Listo. El portal deberia responder en:  http://10.0.0.118$portSuffix/" -ForegroundColor Green
Write-Host "Usuario Master inicial: admin / admin  (cambielo en appsettings.json)." -ForegroundColor Yellow
Write-Host "Recuerde: los dashboards deben escuchar en 0.0.0.0 (no solo localhost) y permitir ser embebidos en iframe." -ForegroundColor Yellow
