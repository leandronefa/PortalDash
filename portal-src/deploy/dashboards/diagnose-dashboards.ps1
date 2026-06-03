<#
    diagnose-dashboards.ps1  ·  Revisa por que algunos dashboards no arrancan.
    Ejecutar EN EL SERVIDOR (10.0.0.118), usando la ruta LOCAL (no la UNC \\...\).

    Uso:
        .\diagnose-dashboards.ps1                       # usa C:\apps\dashboards
        .\diagnose-dashboards.ps1 -Root "C:\apps\dashboards"
#>
param(
    [string]$Root = "C:\apps\dashboards"
)

if ($Root -like "\\*") {
    Write-Warning "Esta usando una ruta de RED ($Root). Ejecute esto en el server con la ruta LOCAL, p.ej. C:\apps\dashboards."
}
if (-not (Test-Path $Root)) { Write-Error "No existe la ruta $Root"; exit 1 }

Write-Host "Analizando dashboards en: $Root`n" -ForegroundColor Cyan

$rows = @()
Get-ChildItem $Root -Directory | ForEach-Object {
    $dir = $_.FullName
    $envFile = Join-Path $dir ".env"
    $eco = Join-Path $dir "ecosystem.config.cjs"

    $envPort = $null
    if (Test-Path $envFile) {
        $m = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $envPort = [int]$m.Matches[0].Groups[1].Value }
    }
    $ecoPort = $null
    if (Test-Path $eco) {
        $m2 = Select-String -Path $eco -Pattern 'PORT\s*:\s*(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m2) { $ecoPort = [int]$m2.Matches[0].Groups[1].Value }
    }
    $effPort = if ($envPort) { $envPort } elseif ($ecoPort) { $ecoPort } else { 3005 }

    $rows += [PSCustomObject]@{
        Carpeta      = $_.Name
        server_js    = (Test-Path (Join-Path $dir "server.js"))
        node_modules = (Test-Path (Join-Path $dir "node_modules"))
        dist         = (Test-Path (Join-Path $dir "dist"))
        env          = (Test-Path $envFile)
        PortEnv      = $envPort
        PortEco      = $ecoPort
        PortEfectivo = $effPort
    }
}

$rows | Format-Table -AutoSize

# Puertos duplicados
$dups = $rows | Group-Object PortEfectivo | Where-Object { $_.Count -gt 1 }
if ($dups) {
    Write-Host "`n*** CONFLICTO DE PUERTOS (causa tipica de que NO arranquen) ***" -ForegroundColor Red
    foreach ($g in $dups) {
        Write-Host ("  Puerto {0}: {1}" -f $g.Name, (($g.Group.Carpeta) -join ", ")) -ForegroundColor Red
    }
    Write-Host "  -> Asigne un puerto UNICO a cada dashboard (lo mas simple: registrarlos como servicios con install-all.ps1, que fija el PORT)." -ForegroundColor Yellow
}

# Faltantes
$missNM = $rows | Where-Object { -not $_.node_modules }
if ($missNM) { Write-Host "`nSin node_modules (correr 'npm install' en la carpeta): $(( $missNM.Carpeta) -join ', ')" -ForegroundColor Yellow }
$missDist = $rows | Where-Object { -not $_.dist }
if ($missDist) { Write-Host "Sin dist (correr 'npm run build' en la carpeta): $(( $missDist.Carpeta) -join ', ')" -ForegroundColor Yellow }

# Puertos que estan escuchando ahora
Write-Host "`n=== Puertos en escucha actualmente ===" -ForegroundColor Cyan
$ports = $rows.PortEfectivo | Sort-Object -Unique
foreach ($p in $ports) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        $proc = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Write-Host ("  Puerto {0}: ESCUCHANDO (proceso: {1}, PID {2})" -f $p, $proc, $conn.OwningProcess) -ForegroundColor Green
    } else {
        Write-Host ("  Puerto {0}: libre / nadie escuchando" -f $p) -ForegroundColor DarkGray
    }
}

# Logs de servicios node-windows (si existen)
Write-Host "`n=== Ultimos errores en logs de servicios (si los hay) ===" -ForegroundColor Cyan
Get-ChildItem $Root -Recurse -Filter "*.err.log" -ErrorAction SilentlyContinue | ForEach-Object {
    $tail = Get-Content $_.FullName -Tail 5 -ErrorAction SilentlyContinue
    if ($tail) {
        Write-Host ("--- {0} ---" -f $_.FullName) -ForegroundColor Yellow
        $tail | ForEach-Object { Write-Host "    $_" }
    }
}

Write-Host "`nSugerencia: para ver el error exacto de uno, entre a su carpeta y ejecute:  node server.js" -ForegroundColor Cyan
