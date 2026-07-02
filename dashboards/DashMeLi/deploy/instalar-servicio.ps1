# =============================================================
#  instalar-servicio.ps1
#  Instala el tablero de stock como servicio Windows usando pm2
#  Ejecutar como ADMINISTRADOR desde la carpeta raíz del proyecto
# =============================================================

param(
    [string]$AppDir  = "C:\tablero-stock",
    [string]$AppName = "tablero-stock",
    [int]   $Port    = 3001
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Instalador de Servicio: Tablero Stock ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. Verificar Node.js ──────────────────────────────────────
Write-Host "[1/6] Verificando Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = node --version 2>&1
    Write-Host "      Node.js encontrado: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "      ERROR: Node.js no esta instalado." -ForegroundColor Red
    Write-Host "      Descargalo desde https://nodejs.org (LTS recomendado)" -ForegroundColor Red
    exit 1
}

# ── 2. Copiar archivos si es necesario ───────────────────────
Write-Host "[2/6] Preparando directorio de instalacion: $AppDir" -ForegroundColor Yellow
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceDir  = Split-Path -Parent $scriptDir   # carpeta raiz del proyecto

if ($AppDir -ne $sourceDir) {
    if (-not (Test-Path $AppDir)) {
        New-Item -ItemType Directory -Force $AppDir | Out-Null
    }
    $items = @("server.js", "package.json", "package-lock.json", "public", ".env.example")
    foreach ($item in $items) {
        $src = Join-Path $sourceDir $item
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination $AppDir -Recurse -Force
            Write-Host "      Copiado: $item" -ForegroundColor Gray
        }
    }
    Write-Host "      Archivos copiados a $AppDir" -ForegroundColor Green
} else {
    Write-Host "      Instalando en el directorio actual: $AppDir" -ForegroundColor Green
}

# ── 3. Configurar .env ───────────────────────────────────────
Write-Host "[3/6] Configurando variables de entorno (.env)..." -ForegroundColor Yellow
$envFile = Join-Path $AppDir ".env"
if (-not (Test-Path $envFile)) {
    $envExample = Join-Path $AppDir ".env.example"
    if (Test-Path $envExample) {
        Copy-Item $envExample $envFile
        Write-Host "      .env creado desde .env.example" -ForegroundColor Yellow
        Write-Host "      IMPORTANTE: Edita $envFile con los datos correctos antes de continuar." -ForegroundColor Magenta
        Write-Host ""
        $resp = Read-Host "      Presiona ENTER cuando hayas editado el .env (o escribe 'skip' para continuar igual)"
    }
} else {
    Write-Host "      .env ya existe, no se sobreescribe." -ForegroundColor Green
}

# Asegurar que el puerto en .env coincida con el parametro
(Get-Content $envFile) -replace "^PORT=.*", "PORT=$Port" | Set-Content $envFile

# ── 4. Instalar dependencias npm ─────────────────────────────
Write-Host "[4/6] Instalando dependencias npm..." -ForegroundColor Yellow
Set-Location $AppDir
npm install --omit=dev 2>&1 | Tail -3
Write-Host "      Dependencias instaladas." -ForegroundColor Green

# ── 5. Instalar pm2 globalmente ───────────────────────────────
Write-Host "[5/6] Instalando pm2..." -ForegroundColor Yellow
$pm2Path = (Get-Command pm2 -ErrorAction SilentlyContinue)?.Source
if (-not $pm2Path) {
    npm install -g pm2 2>&1 | Select-Object -Last 3
    Write-Host "      pm2 instalado globalmente." -ForegroundColor Green
} else {
    Write-Host "      pm2 ya esta instalado: $pm2Path" -ForegroundColor Green
}

# ── 6. Registrar como servicio con pm2 ───────────────────────
Write-Host "[6/6] Registrando servicio '$AppName' con pm2..." -ForegroundColor Yellow

# Detener si ya existe
pm2 stop $AppName 2>$null
pm2 delete $AppName 2>$null

# Iniciar la app
pm2 start server.js --name $AppName --cwd $AppDir

# Guardar lista de procesos
pm2 save

# Configurar inicio automatico con Windows
pm2-startup install 2>$null
if ($LASTEXITCODE -ne 0) {
    # Alternativa: usar pm2-windows-startup
    npm install -g pm2-windows-startup 2>&1 | Select-Object -Last 2
    pm2-startup install
}

Write-Host ""
Write-Host "=== Instalacion completada ===" -ForegroundColor Green
Write-Host ""
Write-Host "  Servicio: $AppName"
Write-Host "  URL:      http://localhost:$Port"
Write-Host "  Directorio: $AppDir"
Write-Host ""
Write-Host "Comandos utiles:"
Write-Host "  pm2 status              -- ver estado"
Write-Host "  pm2 logs $AppName       -- ver logs en vivo"
Write-Host "  pm2 restart $AppName    -- reiniciar"
Write-Host "  pm2 stop $AppName       -- detener"
Write-Host ""
