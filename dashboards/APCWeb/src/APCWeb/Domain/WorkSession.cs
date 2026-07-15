using System.Data;

namespace APCWeb.Domain;

/// <summary>
/// Estado en memoria de una sesión de trabajo — equivalente a las variables
/// globales de frmMain (dtMain, dtCSV*, contadores, selección).
/// Una instancia por usuario logueado.
/// </summary>
public class WorkSession
{
    public string Usuario { get; set; } = "";
    public string Perfil { get; set; } = "";

    public string Tab { get; set; } = "tabProveedor";   // tabProveedor | tabMarca | tabMultimarca | tabLiquidación | tabRebaja
    public string NombreProveedor { get; set; } = "";
    public string NombreMarca { get; set; } = "";
    public bool ObtenerNoInformados { get; set; }

    public DataTable DtMain = new();
    public DataTable DtCsvCostos = new();
    public DataTable DtCsvPrecios = new();
    public DataTable DtCsvLiqui = new();
    public DataTable DtCsvMeliLiqui = new();
    public DataTable DtCsvErrorLiqui = new();
    public DataTable DtCsvPvpVigente = new();
    public DataTable DtCsvPvpDiferencial = new();
    public DataTable DtCsvPvpZmeli = new();
    public DataTable DtCsvPvpZmeliLiqui = new();
    public DataTable DtNotFound = new();
    public DataTable DtCodigoExcel = new();
    public DataTable DtNoInformados = new();
    public DataTable DtReglas = new();
    public DataTable DtReglasLiqui = new();

    public long Total, Ok, Fail, NotFound, NoInformado, SinCambios;
    public long OkLiqui, ErrorLiqui;

    private static readonly string[] ColumnasCsv = { "", "Codigo", "Precio", "Tarifa", "Periodo", "Depot", "Maestro" };

    public WorkSession() => InicializarCsvTables();

    /// <summary>Replica el armado de columnas de fmrMain_Load + LimpiarDT.</summary>
    public void InicializarCsvTables()
    {
        DtCsvCostos = NuevaCsv();
        DtCsvPrecios = NuevaCsv();
        DtCsvLiqui = NuevaCsv();
        DtCsvMeliLiqui = NuevaCsv();
        DtCsvErrorLiqui = NuevaCsv();
        DtCsvErrorLiqui.Columns.Add("ERROR");
        DtCsvPvpVigente = NuevaCsv();
        DtCsvPvpDiferencial = NuevaCsv();
        DtCsvPvpZmeli = NuevaCsv();
        DtCsvPvpZmeliLiqui = NuevaCsv();
        DtNotFound = new DataTable();
        DtCodigoExcel = new DataTable();
        DtCodigoExcel.Columns.Add("CODIGO");
        DtNoInformados = new DataTable();
        DtMain = new DataTable();
    }

    private static DataTable NuevaCsv()
    {
        var dt = new DataTable();
        foreach (var c in ColumnasCsv) dt.Columns.Add(c);
        return dt;
    }

    public void LimpiarLabels()
    {
        Ok = 0; Fail = 0; NotFound = 0; NoInformado = 0; SinCambios = 0; Total = 0;
        OkLiqui = 0; ErrorLiqui = 0;
    }

    public object Contadores() => new
    {
        ok = Ok, fail = Fail, notFound = NotFound, noInformado = NoInformado,
        sinCambios = SinCambios, total = Total, okLiqui = OkLiqui, errorLiqui = ErrorLiqui
    };
}
