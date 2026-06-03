<#
    install-all.ps1  ·  Registra TODOS los dashboards Node.js como servicios de Windows.
    Ejecutar EN EL SERVIDOR como Administrador, parado en esta carpeta (deploy\dashboards).

    Antes de ejecutar: EDITE la lista $dashboards de abajo con sus rutas y puertos reales.
#>
$ErrorActionPreference = "Stop"

# --- Verificar Administrador ---
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Error "Debe ejecutar este script como Administrador."
    exit 1
}

# =======================================================================
#  EDITE ESTA LISTA con sus 3 dashboards (nombre del servicio, carpeta y puerto)
# =======================================================================
#  - Script: opcional. Archivo de entrada (por defecto "server.js").
#            Para apps que compilan el backend (TypeScript), use "dist-server\index.js".
$dashboards = @(
    @{ Name = "Dash-Comisiones";  Path = "C:\apps\dashboards\comisiones-app";          Port = 3001 },
    @{ Name = "Dash-Promociones"; Path = "C:\apps\dashboards\DashPromocionesMP";        Port = 3002 },
    @{ Name = "Dash-Sucursal";    Path = "C:\apps\dashboards\sucursal-user-visualizer"; Port = 3003; Script = "dist-server\index.js" }
)
# =======================================================================

# --- Verificar Node.js ---
try { $nodeV = (node --version) } catch { Write-Error "Node.js no esta en el PATH del sistema. Instale Node.js."; exit 1 }
Write-Host "Node.js detectado: $nodeV" -ForegroundColor Cyan

# --- Instalar node-windows en esta carpeta ---
Push-Location $PSScriptRoot
Write-Host "Instalando dependencia node-windows..." -ForegroundColor Cyan
npm install --silent
Pop-Location

# --- Por cada dashboard: firewall + servicio ---
foreach ($d in $dashboards) {
    Write-Host ""
    Write-Host "==== $($d.Name)  (puerto $($d.Port)) ====" -ForegroundColor Green

    $entry = if ($d.ContainsKey('Script')) { $d.Script } else { 'server.js' }
    $entryPath = Join-Path $d.Path $entry
    if (-not (Test-Path $entryPath)) {
        Write-Warning "No se encontro $entryPath. Salteado."
        continue
    }

    # Firewall
    $rule = "Dashboard $($d.Name) $($d.Port)"
    if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $d.Port -Action Allow | Out-Null
        Write-Host "  Firewall abierto en el puerto $($d.Port)." -ForegroundColor DarkGray
    }

    # Servicio (node-windows)
    node (Join-Path $PSScriptRoot "install-dashboard-service.js") $d.Name $d.Path $d.Port $entry
}

Write-Host ""
Write-Host "Listo. Verifique en services.msc o con: Get-Service Dash-*" -ForegroundColor Green
Write-Host "Luego registre cada dashboard en el portal (Administracion -> Dashboards) usando su PUERTO." -ForegroundColor Yellow
