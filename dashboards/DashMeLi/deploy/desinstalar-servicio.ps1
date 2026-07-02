# =============================================================
#  desinstalar-servicio.ps1
#  Elimina el servicio pm2 del tablero de stock
#  Ejecutar como ADMINISTRADOR
# =============================================================

param(
    [string]$AppName = "tablero-stock"
)

Write-Host ""
Write-Host "=== Desinstalador: Tablero Stock ===" -ForegroundColor Cyan
Write-Host ""

try {
    Write-Host "Deteniendo servicio '$AppName'..." -ForegroundColor Yellow
    pm2 stop $AppName 2>$null
    pm2 delete $AppName 2>$null
    pm2 save --force 2>$null
    Write-Host "Servicio eliminado de pm2." -ForegroundColor Green
} catch {
    Write-Host "Advertencia: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Si queres eliminar pm2 completamente:" -ForegroundColor Gray
Write-Host "  npm uninstall -g pm2 pm2-windows-startup" -ForegroundColor Gray
Write-Host ""
Write-Host "Listo." -ForegroundColor Green
