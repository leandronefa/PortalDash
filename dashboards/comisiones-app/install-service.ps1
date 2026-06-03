# install-service.ps1
# Instala la aplicacion como servicio Windows usando NSSM
# Requiere: Node.js instalado en el servidor destino
# Uso: .\install-service.ps1
# Para desinstalar: .\install-service.ps1 -Uninstall

param(
    [switch]$Uninstall,
    [string]$ServiceName = "SucursalVisualizer",
    [string]$Port = "3000"
)

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeCmd = Get-Command node -ErrorAction SilentlyContinue
$NodeExe = if ($NodeCmd) { $NodeCmd.Source } else { $null }
$NssmPath = "$AppDir\nssm.exe"

# ---- Validaciones ----
if (-not $NodeExe) {
    Write-Error "Node.js no encontrado. Instala Node.js y vuelve a intentar."
    exit 1
}

# Descargar NSSM si no existe
if (-not (Test-Path $NssmPath)) {
    Write-Host "Descargando NSSM..." -ForegroundColor Cyan
    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    $zipPath = "$env:TEMP\nssm.zip"
    Invoke-WebRequest -Uri $nssmUrl -OutFile $zipPath
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    $entry = $zip.Entries | Where-Object { $_.Name -eq "nssm.exe" -and $_.FullName -match "win64" }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $NssmPath, $true)
    $zip.Dispose()
    Remove-Item $zipPath
    Write-Host "NSSM descargado." -ForegroundColor Green
}

# ---- Desinstalar ----
if ($Uninstall) {
    Write-Host "Desinstalando servicio '$ServiceName'..." -ForegroundColor Yellow
    & $NssmPath stop $ServiceName
    & $NssmPath remove $ServiceName confirm
    Write-Host "Servicio eliminado." -ForegroundColor Green
    exit 0
}

# ---- Build ----
Write-Host "Instalando dependencias..." -ForegroundColor Cyan
Push-Location $AppDir
npm install
Write-Host "Compilando aplicacion..." -ForegroundColor Cyan
npx vite build
npx tsc --project tsconfig.server.json
Pop-Location

if ($LASTEXITCODE -ne 0) {
    Write-Error "El build fallo. Revisa los errores arriba."
    exit 1
}

# Actualizar .env para produccion
$envFile = "$AppDir\.env"
$envContent = @"
DB_SERVER=10.0.0.115
DB_USER=sa
DB_PASSWORD=MicroS123
DB_NAME=TABLEROS
PORT=$Port
NODE_ENV=production
"@
Set-Content -Path $envFile -Value $envContent
Write-Host ".env de produccion configurado (PORT=$Port)." -ForegroundColor Green

# ---- Instalar servicio ----
Write-Host "Instalando servicio '$ServiceName' en puerto $Port..." -ForegroundColor Cyan

$ServerScript = "$AppDir\dist-server\index.js"

# Detener si ya existe
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Servicio ya existe, actualizando..." -ForegroundColor Yellow
    & $NssmPath stop $ServiceName
    & $NssmPath remove $ServiceName confirm
}

& $NssmPath install $ServiceName $NodeExe $ServerScript
& $NssmPath set $ServiceName AppDirectory $AppDir
& $NssmPath set $ServiceName AppEnvironmentExtra "NODE_ENV=production"
& $NssmPath set $ServiceName DisplayName "Sucursal User Visualizer"
& $NssmPath set $ServiceName Description "Aplicacion de visualizacion de asignaciones de sucursales"
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppStdout "$AppDir\logs\service-stdout.log"
& $NssmPath set $ServiceName AppStderr "$AppDir\logs\service-stderr.log"
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 5242880

# Crear carpeta de logs
New-Item -ItemType Directory -Force -Path "$AppDir\logs" | Out-Null

# Iniciar servicio
& $NssmPath start $ServiceName

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host ""
    Write-Host "Servicio instalado y corriendo." -ForegroundColor Green
    Write-Host "Acceder en: http://<IP-DEL-SERVIDOR>:$Port" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Comandos utiles:" -ForegroundColor Yellow
    Write-Host "  Detener:     Stop-Service $ServiceName"
    Write-Host "  Iniciar:     Start-Service $ServiceName"
    Write-Host "  Desinstalar: .\install-service.ps1 -Uninstall"
    Write-Host "  Logs:        Get-Content $AppDir\logs\service-stderr.log -Tail 50"
} else {
    Write-Warning "El servicio puede no haber iniciado correctamente."
    Write-Host "Verificar logs en: $AppDir\logs\"
    exit 1
}
