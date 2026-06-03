<#
    publish.ps1  ·  Genera el paquete listo para copiar al servidor.
    Ejecutar en la maquina de DESARROLLO (la que tiene el .NET SDK 9).

    Resultado: una carpeta autocontenida (incluye el runtime .NET) que se puede
    copiar al servidor 10.0.0.118 SIN instalar nada alli.

    Uso:
        .\deploy\publish.ps1
        .\deploy\publish.ps1 -Output "C:\publish\DashboardPortal"
#>
param(
    [string]$Output = "C:\publish\DashboardPortal"
)

$ErrorActionPreference = "Stop"
$proj = Join-Path $PSScriptRoot "..\DashboardPortal.csproj"

Write-Host "Publicando (self-contained, win-x64) ..." -ForegroundColor Cyan
dotnet publish $proj -c Release -r win-x64 --self-contained true -o $Output

# Incluir los scripts de despliegue dentro del paquete (para tenerlos en el servidor).
Write-Host "Copiando scripts de despliegue al paquete..." -ForegroundColor Cyan
$deployDst = Join-Path $Output "deploy"
if (Test-Path $deployDst) { Remove-Item $deployDst -Recurse -Force }
Copy-Item -Path $PSScriptRoot -Destination $Output -Recurse -Force
# Quitar node_modules si existiera (no debe viajar)
$nm = Join-Path $deployDst "dashboards\node_modules"
if (Test-Path $nm) { Remove-Item $nm -Recurse -Force }

Write-Host ""
Write-Host "OK. Paquete generado en: $Output" -ForegroundColor Green
Write-Host "Incluye la subcarpeta 'deploy' con install-service.ps1 y deploy\dashboards\." -ForegroundColor Green
Write-Host "Copie TODA esa carpeta al servidor, por ejemplo a  C:\apps\portal" -ForegroundColor Yellow
