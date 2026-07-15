namespace APCWeb.Domain;

/// <summary>
/// Nombres de objetos SQL. Los de estado compartido usan la copia APCWeb_
/// (creada por sql/01_crear_objetos_APCWeb.sql); el resto se reutiliza tal cual.
/// </summary>
public static class Sp
{
    // ---- Reutilizados sin cambios (solo lectura / correo) ----
    public const string ValidarInicioSesion = "SP_VALIDAR_INICIO_SESION_APPS";
    public const string ObtenerPerfil = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_PERFIL";
    public const string ObtenerNombreProveedores = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_NOMBRE_PROVEEDORES";
    public const string ObtenerNombreMarcas = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_NOMBRE_MARCAS";
    public const string ObtenerMarcaProveedor = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_MARCA_PROVEEDOR";
    public const string ObtenerProveedorMarca = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_PROVEEDOR_MARCA";
    public const string ObtenerEmpresas = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_EMPRESAS";
    public const string ObtenerSucursales = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_SUCURSALES";
    public const string ObtenerPrecioCosto = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_PRECIO_COSTO";
    public const string ObtenerPrecioCostoMM = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_PRECIO_COSTO_MM";
    public const string ObtenerPvpVigente = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_PVPVigente";
    public const string CalcularPvpVigente = "SP_ACTUALIZARPRECIOSCOSTOS_CALCULAR_PVPVigente";
    public const string ObtenerPrecioZmeli = "ObtenerPrecioZMELI";
    public const string ObtenerPrecioDiferencialMeli = "ObtenerPrecioDiferencialMELI";
    public const string ObtenerReglas = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_REGLAS";
    public const string ObtenerReglasLiquidacion = "SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_REGLAS_LIQUIDACION";
    public const string Stock = "SP_ACTUALIZARPRECIOSCOSTOS_STOCK";
    public const string EnviarCorreoNoInformados = "SP_ACTUALIZARPRECIOSCOSTOS_ENVIAR_CORREO_NO_INFORMADOS";
    public const string EnviarCorreoLiquis = "SP_ACTUALIZARPRECIOSCOSTOS_ENVIAR_CORREO_LIQUIS";
    public const string EnviarCorreoErrores = "SP_ACTUALIZARPRECIOSCOSTOS_ENVIAR_CORREO_ERRORES";
    public const string EnviarCorreoTodo = "SP_ACTUALIZARPRECIOSCOSTOS_ENVIAR_CORREO_TODO";
    public const string EnviarCorreoLiquiErrores = "SP_ACTUALIZARPRECIOSCOSTOS_ENVIAR_CORREO_LIQUI_ERRORES";

    // ---- Copias APCWeb_ (estado compartido: la Web usa las suyas) ----
    public const string BorrarTblOk = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_BORRAR_TLBOK";
    public const string TblOk = "APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_OK";
    public const string ArticulosProveedorMarcaMovimientos = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_ARTICULOS_PROVEEDOR_MARCA_MOVIMIENTOS";
    public const string TblMarcas = "APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_MARCAS";
    public const string ObtenerMarcasDistinct = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_OBTENER_MARCAS_DISTINCT";
    public const string TblLog = "APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_LOG";
    public const string BorrarArticulosLiqui = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_BORRAR_ARTICULOS_LIQUI";
    public const string TblArticulosLiquidacionTemp = "APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_ARTICULOS_LIQUIDACION_TEMP";
    public const string ActualizarArticulosLiqui = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_ACTUALIZAR_ARTICULOS_LIQUI";
    public const string ValidarLiqui = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_LIQUI";
    public const string ValidarMargenLiqui = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI";
    public const string ValidarMargenLiquiEmpresa = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_EMPRESA";
    public const string ValidarMargenLiquiSucursal = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_SUCURSAL";
    public const string ValidarMargenLiquiPonderado = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_PONDERADO";
    public const string ValidarMargenLiquiEmpresaPonderado = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_EMPRESA_PONDERADO";
    public const string ValidarMargenLiquiSucursalPonderado = "APCWeb_SP_ACTUALIZARPRECIOSCOSTOS_VALIDAR_MARGEN_LIQUI_SUCURSAL_PONDERADO";
}
