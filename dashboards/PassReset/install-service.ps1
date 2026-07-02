# install-service.ps1 — Instala PassReset como servicio de Windows
# Ejecutar como Administrador desde C:\apps\dashboards\PassReset\
# Requiere que node-windows esté instalado localmente (npm install node-windows)

param(
    [switch]$Uninstall
)

$serviceName = "dashpassreset.exe"
$displayName = "Dash-PassReset"
$appDir      = "C:\apps\dashboards\PassReset"
$installScript = "C:\apps\portal\deploy\dashboards\install-dashboard-service.js"

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
Write-Host "Instalando servicio $displayName en puerto 3009..." -ForegroundColor Cyan
node $installScript $displayName $appDir 3009 "server.cjs"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR al instalar servicio." -ForegroundColor Red; exit 1 }

Start-Sleep -Seconds 2
Start-Service $serviceName
Write-Host "Servicio $displayName iniciado en http://10.0.0.118:3009" -ForegroundColor Green
Write-Host "Registrar en el portal: Administración -> Dashboards -> Puerto 3009" -ForegroundColor Yellow
