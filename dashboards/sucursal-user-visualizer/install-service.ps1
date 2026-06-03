# install-service.ps1
# Instala la aplicacion con PM2
# Uso: .\install-service.ps1 -Port 3002
# Para desinstalar: .\install-service.ps1 -Uninstall

param(
    [switch]$Uninstall,
    [string]$AppName = "sucursal-visualizer",
    [string]$Port = "3002"
)

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---- Validaciones ----
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
$NodeExe = if ($NodeCmd) { $NodeCmd.Source } else { $null }
if (-not $NodeExe) {
    Write-Error "Node.js no encontrado. Instala Node.js y vuelve a intentar."
    exit 1
}

$Pm2Cmd = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $Pm2Cmd) {
    Write-Host "PM2 no encontrado. Instalando globalmente..." -ForegroundColor Cyan
    npm install -g pm2
}

# ---- Desinstalar ----
if ($Uninstall) {
    Write-Host "Deteniendo y eliminando '$AppName' de PM2..." -ForegroundColor Yellow
    pm2 delete $AppName
    pm2 save
    Write-Host "Listo." -ForegroundColor Green
    exit 0
}

# ---- Build ----
Write-Host "Instalando dependencias..." -ForegroundColor Cyan
Push-Location $AppDir
npm install
Write-Host "Compilando frontend..." -ForegroundColor Cyan
& "$AppDir\node_modules\.bin\vite.cmd" build
Write-Host "Compilando servidor..." -ForegroundColor Cyan
& "$AppDir\node_modules\.bin\tsc.cmd" --project "$AppDir\tsconfig.server.json"
Pop-Location

if ($LASTEXITCODE -ne 0) {
    Write-Error "El build fallo. Revisa los errores arriba."
    exit 1
}

# ---- Configurar .env de produccion ----
$envFile = "$AppDir\.env"
$envContent = "DB_SERVER=10.0.0.115`nDB_USER=sa`nDB_PASSWORD=MicroS123`nDB_NAME=TABLEROS`nPORT=$Port`nNODE_ENV=production`nREMOTE_SERVERS=10.104.12.2,10.104.12.6,10.104.12.10,10.104.12.14,10.104.12.18,10.104.12.22,10.104.12.26,10.104.12.30,10.104.12.33,10.104.12.38`nAGENT_TOKEN=sucursal-agent-token"
Set-Content -Path $envFile -Value $envContent
Write-Host ".env configurado (PORT=$Port)." -ForegroundColor Green

# Crear carpeta de logs
New-Item -ItemType Directory -Force -Path "$AppDir\logs" | Out-Null

# ---- Generar ecosystem.config.cjs ----
$AppDirFwd = $AppDir -replace '\\', '/'
$EcoContent = @"
module.exports = {
  apps: [{
    name: '$AppName',
    script: '$AppDirFwd/dist-server/index.js',
    interpreter: 'node',
    cwd: '$AppDirFwd',
    out_file: '$AppDirFwd/logs/pm2-out.log',
    error_file: '$AppDirFwd/logs/pm2-err.log',
    time: true,
    restart_delay: 3000
  }]
};
"@
Set-Content -Path "$AppDir\ecosystem.config.cjs" -Value $EcoContent
Write-Host "ecosystem.config.cjs generado." -ForegroundColor Green

# ---- Iniciar con PM2 ----
Write-Host "Iniciando con PM2 en puerto $Port..." -ForegroundColor Cyan
pm2 delete $AppName 2>$null
pm2 start "$AppDir\ecosystem.config.cjs"
pm2 save

Write-Host ""
Write-Host "App corriendo con PM2." -ForegroundColor Green
Write-Host "Acceder en: http://<IP-DEL-SERVIDOR>:$Port" -ForegroundColor Cyan
Write-Host ""
Write-Host "Comandos utiles:" -ForegroundColor Yellow
Write-Host "  Ver estado:    pm2 status"
Write-Host "  Ver logs:      pm2 logs $AppName"
Write-Host "  Reiniciar:     pm2 restart $AppName"
Write-Host "  Detener:       pm2 stop $AppName"
Write-Host "  Desinstalar:   .\install-service.ps1 -Uninstall"
