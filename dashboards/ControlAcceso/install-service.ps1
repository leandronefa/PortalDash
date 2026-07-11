# install-service.ps1 — Instala ControlAcceso como servicio de Windows
# Ejecutar como Administrador desde C:\apps\dashboards\ControlAcceso\

param(
    [switch]$Uninstall
)

$serviceName = "dashcontrolacceso.exe"
$displayName = "Dash-ControlAcceso"
$appDir      = "C:\apps\dashboards\ControlAcceso"
$installScript = "C:\apps\portal\deploy\dashboards\install-dashboard-service.js"
$port        = 3012

if ($Uninstall) {
    Write-Host "Desinstalando $displayName..." -ForegroundColor Yellow
    Stop-Service $serviceName -ErrorAction SilentlyContinue
    sc.exe delete $serviceName 2>$null
    Remove-Item "$appDir\daemon" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Servicio eliminado." -ForegroundColor Green
    exit
}

# Limpiar instalación previa si existe
$existing = Get-Service $serviceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Limpiando servicio anterior..." -ForegroundColor Yellow
    Stop-Service $serviceName -ErrorAction SilentlyContinue
    sc.exe delete $serviceName 2>$null
    Start-Sleep -Seconds 2
}
Remove-Item "$appDir\daemon" -Recurse -Force -ErrorAction SilentlyContinue

# Compilar frontend
Write-Host "Compilando frontend..." -ForegroundColor Cyan
Set-Location $appDir
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR al compilar." -ForegroundColor Red; exit 1 }

# Instalar servicio
Write-Host "Instalando servicio $displayName en puerto $port..." -ForegroundColor Cyan
node $installScript $displayName $appDir $port "server.cjs"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR al instalar servicio." -ForegroundColor Red; exit 1 }

Start-Sleep -Seconds 2
Start-Service $serviceName
Write-Host "Servicio $displayName iniciado en http://127.0.0.1:$port (solo loopback)" -ForegroundColor Green
Write-Host "Registrar en el portal: Administración -> Dashboards -> Puerto $port" -ForegroundColor Yellow
