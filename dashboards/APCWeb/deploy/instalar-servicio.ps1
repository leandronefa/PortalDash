# Instala APCWeb como servicio Windows (dashapcweb) en 127.0.0.1:3013
# EJECUTAR COMO ADMINISTRADOR. Requiere:
#   1. sql/01_crear_objetos_APCWeb.sql ejecutado en 10.0.0.115/db_cegid
#   2. appsettings.Production.json con la cadena de conexión (ver .example)
#   3. Una CUENTA DE SERVICIO con acceso a \\vmapp.sportotal.com.ar\importar\PRECIOS
#      y \\10.0.0.115\Actualizar Precios y Costos (LocalSystem NO sirve para UNC)

$ErrorActionPreference = 'Stop'

$src     = 'C:\apps\dashboards\APCWeb\src\APCWeb'
$publish = 'C:\apps\dashboards\APCWeb\publish'
$svc     = 'dashapcweb'

Write-Host "Publicando..."
dotnet publish $src -c Release -o $publish
if ($LASTEXITCODE -ne 0) { throw "Fallo dotnet publish" }

if (-not (Test-Path (Join-Path $publish 'appsettings.Production.json'))) {
    Write-Warning "Falta appsettings.Production.json en $publish (copiar desde el .example y completar la conexión)."
}

$existe = Get-Service $svc -ErrorAction SilentlyContinue
if ($existe) {
    Write-Host "El servicio $svc ya existe. Deteniendo para actualizar binarios..."
    Stop-Service $svc -Force
    Start-Sleep -Seconds 2
} else {
    Write-Host "Creando servicio $svc..."
    # Cambiar obj= por la cuenta de servicio con acceso a los shares UNC:
    #   sc.exe create dashapcweb binPath= "...APCWeb.exe" obj= "DOMINIO\cuenta" password= "..."
    sc.exe create $svc binPath= "$publish\APCWeb.exe --environment Production" start= auto DisplayName= "Dash-APCWeb (Actualizar Precios y Costos)"
    sc.exe description $svc "APCWeb - version web de ActualizarPreciosCostos. Puerto 127.0.0.1:3013, proxy portal /d/apcweb/"
    Write-Warning "Servicio creado con LocalSystem: asignarle la cuenta de servicio antes de usar los exports UNC (services.msc > Iniciar sesion)."
}

Start-Service $svc
Get-Service $svc | Format-Table Name, Status, DisplayName

Write-Host "Verificacion:"
Write-Host "  Invoke-WebRequest http://localhost:3013/ -UseBasicParsing"
Write-Host "Recordar: registrar el dashboard en el portal (YARP /d/apcweb/ -> 127.0.0.1:3013) y actualizar portal-src\deploy\OPERATIONS-10.0.0.118.md"
