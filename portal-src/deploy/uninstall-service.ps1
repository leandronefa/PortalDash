<#
    uninstall-service.ps1  ·  Detiene y elimina el servicio del portal.
    Ejecutar EN EL SERVIDOR como Administrador.
    NO borra los datos (App_Data) ni los archivos publicados.

    Uso:
        .\uninstall-service.ps1
#>
param(
    [string]$ServiceName = "DashboardPortal",
    [int]$Port = 80,
    [switch]$RemoveFirewallRule
)

$ErrorActionPreference = "Stop"

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Error "Debe ejecutar este script como Administrador."
    exit 1
}

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "El servicio '$ServiceName' no existe." -ForegroundColor Yellow
} else {
    if ($svc.Status -ne 'Stopped') { Stop-Service $ServiceName -Force }
    sc.exe delete $ServiceName | Out-Null
    Write-Host "Servicio '$ServiceName' eliminado." -ForegroundColor Green
}

if ($RemoveFirewallRule) {
    $ruleName = "DashboardPortal HTTP $Port"
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host "Regla de firewall '$ruleName' eliminada." -ForegroundColor Green
}
