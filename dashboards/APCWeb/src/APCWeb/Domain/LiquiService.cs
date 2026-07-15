using System.Data;
using System.Text;
using APCWeb.Data;

namespace APCWeb.Domain;

/// <summary>
/// Port fiel del flujo Liquidación / Rebaja de frmMain.vb
/// (btnImportar Case tabLiquidación/tabRebaja + ValidarDatosLiqui + export).
/// Usa las copias APCWeb_ del staging para no interferir con la Desktop.
/// </summary>
public class LiquiService
{
    private readonly Db _db;
    private readonly UncShares _unc;
    private readonly string _rutaPrecios;
    private readonly string _rutaAuxiliar;

    public LiquiService(Db db, UncShares unc, IConfiguration config)
    {
        _db = db;
        _unc = unc;
        _rutaPrecios = config["Rutas:Precios"] ?? @"\\vmapp.sportotal.com.ar\importar\PRECIOS";
        _rutaAuxiliar = config["Rutas:Auxiliar"] ?? @"\\10.0.0.115\Actualizar Precios y Costos";
    }

    private static double CDbl(object? v) => Convert.ToDouble(v);

    /// <param name="modo">0 = Grupo, 1 = Empresa, 2 = Sucursal (rgbLiqui)</param>
    /// <param name="valor">texto de cmbLiqui (empresa o sucursal)</param>
    public List<string> Importar(WorkSession s, Stream xlsx, int modo, string valor)
    {
        s.DtReglasLiqui = _db.EjecutarSP(Sp.ObtenerReglasLiquidacion) ?? new DataTable();
        s.LimpiarLabels();
        s.InicializarCsvTables();

        s.DtMain = ExcelImporter.ImportarXlsx(xlsx, "Z1", "CODIGO ARTICULO");
        var dtMain = s.DtMain;

        if (dtMain.Rows.Count == 0)
            throw new InvalidOperationException("Archivo Excel sin Datos");

        try
        {
            dtMain.PrimaryKey = new[] { dtMain.Columns["CODIGO ARTICULO"]! };
        }
        catch
        {
            throw new InvalidOperationException("Codigo de Articulo Repetido");
        }

        foreach (var c in new[] { "RECEPCION", "PVP", "MARGEN", "PENDIENTE", "PARETO", "ESTADO" })
            dtMain.Columns.Add(c);

        return ValidarDatosLiqui(s, modo, valor);
    }

    /// <summary>Réplica de ValidarDatosLiqui (incluidos sus efectos acumulativos al reeditar).</summary>
    public List<string> ValidarDatosLiqui(WorkSession s, int modo, string valor)
    {
        var errores = new List<string>();
        var dtMain = s.DtMain;

        // Copia para staging: quita 7 columnas desde el índice 2 (igual que la Desktop)
        var dtArtLiqui = dtMain.Copy();
        dtArtLiqui.PrimaryKey = Array.Empty<DataColumn>();
        for (var k = 0; k < 7; k++)
            dtArtLiqui.Columns.RemoveAt(2);

        _db.EjecutarSP(Sp.BorrarArticulosLiqui);
        _db.BulkInsert(dtArtLiqui, Sp.TblArticulosLiquidacionTemp);
        _db.EjecutarSP(Sp.ActualizarArticulosLiqui);

        DataTable dtMargenLiqui = modo switch
        {
            0 => _db.EjecutarSP(Sp.ValidarMargenLiqui)!,
            1 => _db.EjecutarSP(Sp.ValidarMargenLiquiEmpresa, valor)!,
            _ => _db.EjecutarSP(Sp.ValidarMargenLiquiSucursal, valor)!
        };

        DataTable dtPareto = modo switch
        {
            0 => _db.EjecutarSP(Sp.ValidarMargenLiquiPonderado)!,
            1 => _db.EjecutarSP(Sp.ValidarMargenLiquiEmpresaPonderado, valor)!,
            _ => _db.EjecutarSP(Sp.ValidarMargenLiquiSucursalPonderado, valor)!
        };

        var reglas = s.DtReglasLiqui;

        for (var j = 0; j < dtMain.Rows.Count; j++)
        {
            try
            {
                var dtResult = _db.EjecutarSP(Sp.ValidarLiqui,
                    Convert.ToString(dtMain.Rows[j][0]),
                    Convert.ToString(dtMain.Rows[j][1]),
                    CDbl(dtMargenLiqui.Rows[0][2]) * 100,
                    Math.Round(CDbl(dtPareto.Rows[0][0]) * 100, 2))!;

                // Reglas 0-4: si la regla está inactiva su resultado se fuerza a OK
                for (var r = 0; r <= 4; r++)
                {
                    if (Convert.ToBoolean(reglas.Rows[r][2]))
                        dtMain.Rows[j][3 + r] = dtResult.Rows[r][1];
                    else
                        dtResult.Rows[r][1] = "OK";
                }

                // Asignación incondicional final (igual que la Desktop)
                for (var r = 0; r <= 4; r++)
                    dtMain.Rows[j][3 + r] = dtResult.Rows[r][1];

                var todosOk = Enumerable.Range(0, 5)
                    .All(r => Convert.ToString(dtResult.Rows[r][1]) == "OK");

                if (todosOk)
                {
                    dtMain.Rows[j][8] = "OK";
                    s.OkLiqui += 1;

                    s.DtCsvLiqui.Rows.Add("LP1C1_", Convert.ToString(dtMain.Rows[j][0]),
                        Convert.ToString(dtMain.Rows[j][1]), "Z1",
                        Convert.ToString(dtMain.Rows[j][2]), "", "N");
                    s.DtCsvMeliLiqui.Rows.Add("LP1C1_", Convert.ToString(dtMain.Rows[j][0]),
                        Convert.ToString(dtMain.Rows[j][1]), "ZMELI", "MELIL", "", "N");
                }
                else
                {
                    dtMain.Rows[j][8] = "ERROR";
                    s.ErrorLiqui += 1;

                    var resultado = "";
                    for (var r = 0; r <= 4; r++)
                    {
                        var v = Convert.ToString(dtResult.Rows[r][1]);
                        if (v != "OK") resultado += v + "-";
                    }
                    resultado = resultado.Trim();

                    s.DtCsvErrorLiqui.Rows.Add("LP1C1_", Convert.ToString(dtMain.Rows[j][0]),
                        Convert.ToString(dtMain.Rows[j][1]), "Z1",
                        Convert.ToString(dtMain.Rows[j][2]), "", "N", resultado);
                    s.DtCsvErrorLiqui.Rows.Add("LP1C1_", Convert.ToString(dtMain.Rows[j][0]),
                        Convert.ToString(dtMain.Rows[j][1]), "ZMELI", "MELIL", "", "N", resultado);
                }
            }
            catch (Exception ex)
            {
                errores.Add($"Fila {j + 1}: {ex.Message}");
            }
        }

        return errores;
    }

    /// <summary>Export Liquidación (btnExportar Case tabLiquidación). Rebaja NO exporta (fiel a la Desktop).</summary>
    public List<string> Exportar(WorkSession s)
    {
        if (s.Tab == "tabRebaja")
            return new List<string>(); // la Desktop tiene el case vacío

        _unc.Asegurar(_rutaPrecios);
        var hoy = DateTime.Today;
        var archivos = new List<string>
        {
            CsvExporter.DtTableToCsv(s.DtCsvLiqui,
                _rutaPrecios + "\\" + hoy.Day + "." + hoy.Month + ". - LIQUI", Encoding.Unicode, true),
            CsvExporter.DtTableToCsv(s.DtCsvMeliLiqui,
                _rutaPrecios + "\\" + hoy.Day + "." + hoy.Month + ". - MELI LIQUI", Encoding.Unicode, true)
        };
        return archivos;
    }

    /// <summary>btnEnviarFail en tab Liquidación.</summary>
    public string EnviarFail(WorkSession s)
    {
        _unc.Asegurar(_rutaAuxiliar);
        var archivo = CsvExporter.DtTableToCsv(s.DtCsvErrorLiqui,
            _rutaAuxiliar + "\\LIQUI-ERRORES", Encoding.UTF8, true);
        _db.EjecutarSP(Sp.EnviarCorreoLiquiErrores, s.Usuario);
        return archivo;
    }
}
