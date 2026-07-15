using System.Data;
using System.Text;
using APCWeb.Data;

namespace APCWeb.Domain;

/// <summary>
/// Port fiel del flujo "Rebaja/original" de frmMain.vb (pestañas Proveedor / Marca /
/// Multimarca): importación, ValidarDatos, ValidarDatosEditados, No Informados,
/// exportación de CSVs y log. La lógica se conserva EXACTA, incluidas las
/// asimetrías entre ValidarDatos y ValidarDatosEditados de la Desktop.
/// </summary>
public class ValidacionService
{
    private readonly Db _db;
    private readonly UncShares _unc;
    private readonly string _rutaPrecios;
    private readonly string _rutaAuxiliar;

    public ValidacionService(Db db, UncShares unc, IConfiguration config)
    {
        _db = db;
        _unc = unc;
        _rutaPrecios = config["Rutas:Precios"] ?? @"\\vmapp.sportotal.com.ar\importar\PRECIOS";
        _rutaAuxiliar = config["Rutas:Auxiliar"] ?? @"\\10.0.0.115\Actualizar Precios y Costos";
    }

    private static double CDbl(object? v) => Convert.ToDouble(v);
    private static double Round(double v, int d) => Math.Round(v, d); // banker's, igual que VB

    // =============================================================================
    // IMPORTAR (btnImportar_Click, Case Else)
    // =============================================================================
    public List<string> Importar(WorkSession s, Stream xlsx, bool obtenerNoInformados)
    {
        var errores = new List<string>();

        s.LimpiarLabels();
        s.InicializarCsvTables();
        s.ObtenerNoInformados = obtenerNoInformados;
        s.DtReglas = _db.EjecutarSP(Sp.ObtenerReglas) ?? new DataTable();

        s.DtMain = ExcelImporter.ImportarXlsx(xlsx, "ListaPROV", "CODIGO");
        var dtMain = s.DtMain;

        // PrimaryKey CODIGO — código repetido aborta, igual que la Desktop
        try
        {
            dtMain.PrimaryKey = new[] { dtMain.Columns["CODIGO"]! };
        }
        catch
        {
            throw new InvalidOperationException("Codigo de Articulo Repetido");
        }

        if (!dtMain.Columns.Contains("MARCA")) dtMain.Columns.Add("MARCA");
        foreach (var c in new[] { "PVPAnt", "CostoAnt", "PerTarifa", "Margen", "Estado", "Nombre", "EstadoPVP",
                                  "Usuario", "Fecha", "IncCosto", "IncPVP", "Regla1", "Regla2", "Regla3",
                                  "Regla4", "Regla5", "Regla6", "Regla7", "Seccion" })
            dtMain.Columns.Add(c);

        s.DtNoInformados = new DataTable();
        foreach (var c in new[] { "Codigo", "Descripcion", "PVPAnt", "CostoAnt", "PerTarifa",
                                  "Estado", "Nombre", "EstadoPVP", "Seccion", "Marca" })
            s.DtNoInformados.Columns.Add(c);
        s.DtNoInformados.PrimaryKey = new[] { s.DtNoInformados.Columns["Codigo"]! };

        if (dtMain.Rows.Count == 0)
            throw new InvalidOperationException("Archivo Excel sin Datos");

        for (var j = 0; j < dtMain.Rows.Count; j++)
        {
            try
            {
                s.DtCodigoExcel.Rows.Add(Convert.ToString(dtMain.Rows[j][0]));

                DataTable? dtResult;
                if (s.Tab == "tabMultimarca")
                    dtResult = _db.EjecutarSP(Sp.ObtenerPrecioCosto,
                        Convert.ToString(dtMain.Rows[j][0]), s.NombreProveedor, Convert.ToString(dtMain.Rows[j][6]));
                else
                {
                    dtResult = _db.EjecutarSP(Sp.ObtenerPrecioCosto,
                        Convert.ToString(dtMain.Rows[j][0]), s.NombreProveedor, s.NombreMarca);
                    dtMain.Rows[j]["MARCA"] = s.NombreMarca;
                }

                // Redondeo Costo Nvo (la Desktop lo hace antes de chequear si existe el artículo)
                dtMain.Rows[j]["Costo EV"] = Round(CDbl(dtMain.Rows[j]["Costo EV"]), 2);

                if (dtResult is null)
                {
                    dtMain.Rows[j]["PVPAnt"] = "0";
                    dtMain.Rows[j]["CostoAnt"] = "0";
                    dtMain.Rows[j]["PerTarifa"] = "---";
                    s.NotFound += 1;
                }
                else
                {
                    var estado = ValidarDatos(s, dtResult, j);
                    switch (estado)
                    {
                        case "":
                            dtMain.Rows[j]["Estado"] = "OK";
                            s.Ok += 1;
                            break;
                        case "Sin Cambio":
                            dtMain.Rows[j]["Estado"] = estado;
                            s.SinCambios += 1;
                            break;
                        default:
                            dtMain.Rows[j]["Estado"] = estado;
                            s.Fail += 1;
                            break;
                    }
                }
            }
            catch (Exception ex)
            {
                errores.Add($"Fila {j + 1}: {ex.Message}"); // Desktop: MsgBox(ex.Message)
            }
        }

        if (obtenerNoInformados)
            ProcesarNoInformados(s);

        s.Total = s.Ok + s.Fail + s.NoInformado + s.SinCambios;
        return errores;
    }

    private void ProcesarNoInformados(WorkSession s)
    {
        var dtMain = s.DtMain;

        _db.EjecutarSP(Sp.BorrarTblOk);
        _db.BulkInsert(s.DtCodigoExcel, Sp.TblOk);

        if (s.Tab == "tabMultimarca")
        {
            var dtMarcas = new DataTable();
            dtMarcas.Columns.Add("MARCA");
            foreach (DataRow fila in dtMain.Rows)
                dtMarcas.Rows.Add(Convert.ToString(fila["MARCA"]));

            _db.BulkInsert(dtMarcas, Sp.TblMarcas);
            var marcas = _db.EjecutarSP(Sp.ObtenerMarcasDistinct) ?? new DataTable();

            for (var i = 0; i < marcas.Rows.Count; i++)
            {
                var dtNoInf = _db.EjecutarSP(Sp.ArticulosProveedorMarcaMovimientos,
                                             s.NombreProveedor, marcas.Rows[i][0]);
                if (dtNoInf is null) continue;

                dtNoInf.Columns.Add("MARCA");
                for (var h = 0; h < dtNoInf.Rows.Count; h++)
                    dtNoInf.Rows[h]["MARCA"] = marcas.Rows[i][0];

                s.DtNotFound.Merge(dtNoInf);
            }
        }
        else
        {
            s.DtNotFound = _db.EjecutarSP(Sp.ArticulosProveedorMarcaMovimientos,
                                          s.NombreProveedor, s.NombreMarca) ?? new DataTable();
            if (s.DtNotFound.Columns.Count > 0)
            {
                s.DtNotFound.Columns.Add("MARCA");
                for (var h = 0; h < s.DtNotFound.Rows.Count; h++)
                    s.DtNotFound.Rows[h]["MARCA"] = s.NombreMarca;
            }
        }

        var dtNotFound = s.DtNotFound;
        if (dtNotFound.Columns.Count == 0) return;

        if (!dtNotFound.Columns.Contains("INDICE"))
            dtNotFound.Columns.Add("INDICE");
        dtNotFound.PrimaryKey = new[] { dtNotFound.Columns["CODIGO"]! };

        for (var i = 0; i < dtNotFound.Rows.Count; i++)
        {
            var marcaFila = s.Tab == "tabMultimarca"
                ? Convert.ToString(dtNotFound.Rows[i]["MARCA"])
                : s.NombreMarca;

            var dtResult = _db.EjecutarSP(Sp.ObtenerPrecioCosto,
                Convert.ToString(dtNotFound.Rows[i][0]), s.NombreProveedor, marcaFila);

            string? periodo;
            if (dtResult is null || dtResult.Rows[0][2] == DBNull.Value)
                periodo = null;
            else
            {
                var t = Convert.ToString(dtResult.Rows[0][2])!;
                periodo = t.Substring(0, t.IndexOf("-")).Trim();
            }

            // Alta en dtMain (equivalente al Rows.Add posicional de la Desktop con el
            // Excel estándar de 6 columnas; acá por nombre para el mismo resultado)
            var nueva = s.DtMain.NewRow();
            nueva["CODIGO"] = dtNotFound.Rows[i][0];
            nueva["DESCRIPCION"] = dtResult?.Rows[0][4] ?? (object)DBNull.Value;
            nueva["MARCA"] = Convert.ToString(dtNotFound.Rows[i]["MARCA"]);
            nueva["PVPAnt"] = Round(CDbl(dtResult?.Rows[0][0] ?? 0), 2);
            nueva["CostoAnt"] = Round(CDbl(dtResult?.Rows[0][1] ?? 0), 2);
            nueva["PerTarifa"] = (object?)periodo ?? DBNull.Value;
            nueva["Estado"] = "No Informado";
            nueva["Nombre"] = dtResult?.Rows[0][4] ?? (object)DBNull.Value;
            nueva["EstadoPVP"] = dtResult?.Rows[0][6] ?? (object)DBNull.Value;
            nueva["Seccion"] = dtResult?.Rows[0][7] ?? (object)DBNull.Value;
            s.DtMain.Rows.Add(nueva);

            s.NoInformado += 1;
            dtNotFound.Rows[i]["INDICE"] = s.DtMain.Rows.Count - 1;

            s.DtNoInformados.Rows.Add(
                dtNotFound.Rows[i][0],
                dtResult?.Rows[0][4] ?? (object)DBNull.Value,
                Round(CDbl(dtResult?.Rows[0][0] ?? 0), 2),
                Round(CDbl(dtResult?.Rows[0][1] ?? 0), 2),
                (object?)periodo ?? DBNull.Value,
                "No Informado",
                dtResult?.Rows[0][4] ?? (object)DBNull.Value,
                dtResult?.Rows[0][6] ?? (object)DBNull.Value,
                dtResult?.Rows[0][7] ?? (object)DBNull.Value,
                Convert.ToString(dtNotFound.Rows[i]["MARCA"]));
        }
    }

    // =============================================================================
    // ValidarDatos — port literal (corta en la primera regla violada)
    // =============================================================================
    private string ValidarDatos(WorkSession s, DataTable dtDatos, int indice)
    {
        var dtMain = s.DtMain;

        var pvpAnt = Round(CDbl(dtDatos.Rows[0][0]), 2);
        var costoAnt = Round(CDbl(dtDatos.Rows[0][1]), 2);
        string periodo;
        var iva = Round(CDbl(dtDatos.Rows[0][3]), 1);
        var nombre = Convert.ToString(dtDatos.Rows[0][4]);
        var estadoPvp = Convert.ToString(dtDatos.Rows[0][6]);
        var seccion = Convert.ToString(dtDatos.Rows[0][7]);

        var costoNuevo = Round(CDbl(dtMain.Rows[indice]["Costo EV"]), 2);
        var pvpNuevo = Round(CDbl(dtMain.Rows[indice]["$ PUBL#"]), 2);

        dtMain.Rows[indice]["PVPAnt"] = pvpAnt;
        dtMain.Rows[indice]["CostoAnt"] = costoAnt;

        // Cambio 03-07-2025 de la Desktop: el periodo se fuerza SIEMPRE a PERMAN
        periodo = "PERMAN";
        dtMain.Rows[indice]["PerTarifa"] = periodo;

        dtMain.Rows[indice]["EstadoPVP"] = estadoPvp;

        var margen = Round((((pvpNuevo / (1 + iva / 100)) - costoNuevo)) / (pvpNuevo / (1 + iva / 100)) * 100, 2);
        dtMain.Rows[indice]["Margen"] = margen;
        dtMain.Rows[indice]["Nombre"] = nombre;
        dtMain.Rows[indice]["Usuario"] = s.Usuario;
        dtMain.Rows[indice]["Fecha"] = DateTime.Today.ToShortDateString() + " " + DateTime.Now.ToLongTimeString();
        dtMain.Rows[indice]["IncCosto"] = Round((costoNuevo - costoAnt) * 100 / costoAnt, 2);
        dtMain.Rows[indice]["IncPVP"] = Round((pvpNuevo - pvpAnt) * 100 / pvpAnt, 2);
        dtMain.Rows[indice]["Seccion"] = seccion;

        if (pvpNuevo == pvpAnt && costoNuevo == costoAnt)
            return "Sin Cambio";

        // La Desktop recarga las reglas del SQL en cada fila
        s.DtReglas = _db.EjecutarSP(Sp.ObtenerReglas) ?? new DataTable();
        var reglas = s.DtReglas;

        bool Activa(int fila) => Convert.ToBoolean(reglas.Rows[fila][2]);
        double Valor(int fila) => CDbl(reglas.Rows[fila][1]);
        string ValorStr(int fila) => Convert.ToString(reglas.Rows[fila][1])!;
        void Log(int nRegla, int fila, bool activa) =>
            dtMain.Rows[indice]["Regla" + nRegla] = (activa ? "True" : "False") + ":" + ValorStr(fila);

        // (1.1) Costo Nuevo no Mayor al X% del Anterior
        if (Activa(0))
        {
            Log(1, 0, true);
            if (costoNuevo > costoAnt * (1 + Valor(0) / 100))
                return "Costo Nvo. > " + ValorStr(0) + "%";
        }
        else Log(1, 0, false);

        // (1.2) Costo Nuevo no Menor al X% del Anterior
        if (Activa(1))
        {
            Log(2, 1, true);
            if (costoNuevo < costoAnt - costoAnt * (Valor(1) / 100))
                return "Costo Nvo. < " + ValorStr(1) + "%";
        }
        else Log(2, 1, false);

        // (2) Precio superior al Costo
        if (Activa(2))
        {
            Log(3, 2, true);
            if (costoNuevo > pvpNuevo)
                return "Costo > Precio";
        }
        else Log(3, 2, false);

        // (3.1) Margen mínimo periodo permanente
        if (Activa(3))
        {
            Log(4, 3, true);
            if ((periodo == "PERM" || periodo == "PERMAN") && margen < Valor(3))
                return "Margen < " + ValorStr(3) + "%";
        }
        else Log(4, 3, false);

        // (3.2) Margen mínimo periodo distinto de permanente
        if (Activa(4))
        {
            Log(5, 4, true);
            if ((periodo != "PERM" && periodo != "PERMAN") && margen < Valor(4))
                return "Margen < " + ValorStr(4) + "%";
        }
        else Log(5, 4, false);

        // (4) PVP nuevo no menor al X% del anterior
        if (Activa(5))
        {
            Log(6, 5, true);
            if (pvpNuevo < pvpAnt - pvpAnt * (Valor(5) / 100))
                return "Mas de " + ValorStr(5) + "% del Precio Anterior";
        }
        else Log(6, 5, false);

        // (5) Margen máximo
        if (Activa(6))
        {
            Log(7, 6, true);
            if (margen > Valor(6))
                return "Margen > " + ValorStr(6) + "%";
        }
        else Log(7, 6, false);

        // Pasó todas las reglas → genera filas de CSV por cada código de proveedor
        for (var i = 0; i < dtDatos.Rows.Count; i++)
        {
            var codigoProv = Convert.ToString(dtDatos.Rows[i][5])!;
            var tarifa = Convert.ToString(dtDatos.Rows[i][2])!;
            var periodoArt = tarifa.Substring(0, tarifa.IndexOf("-", StringComparison.Ordinal)).Trim();

            s.DtCsvCostos.Rows.Add("LP1C1_", codigoProv, costoNuevo, "VACOM", "PERMAN", "", "Y");
            s.DtCsvPrecios.Rows.Add("LP1C1_", codigoProv, pvpNuevo, "Z1", "PERMAN", "", "Y");

            var incPvpFactor = CDbl(dtMain.Rows[indice]["IncPVP"]) / 100 + 1;

            // Cambios 08-01-2023: PVP Vigente para periodos no permanentes
            if (!(periodoArt == "PERM" || periodoArt == "PERMAN"))
            {
                var pvpVigente = CDbl(_db.EjecutarSP(Sp.ObtenerPvpVigente,
                    Convert.ToString(dtMain.Rows[indice][0]), s.NombreProveedor, s.NombreMarca)!.Rows[0][0]);

                var pvpVigenteIncrementado = CDbl(_db.EjecutarSP(Sp.CalcularPvpVigente,
                    pvpVigente, incPvpFactor)!.Rows[0][0]);

                // Solo si se incrementa se exporta
                if (pvpVigenteIncrementado > pvpVigente)
                    s.DtCsvPvpVigente.Rows.Add("LP1C1_", codigoProv, pvpVigenteIncrementado, "Z1", periodoArt, "", "N");
            }

            // Cambios 13-06-2024 (y 14-07-2025: siempre se exporta): ZMELI
            var dtZmeli = _db.EjecutarSP(Sp.ObtenerPrecioZmeli, codigoProv);
            if (dtZmeli is not null)
            {
                var zmeli = CDbl(dtZmeli.Rows[0]["ZMELI"]);
                var zmeliIncrementado = CDbl(_db.EjecutarSP(Sp.CalcularPvpVigente, zmeli, incPvpFactor)!.Rows[0][0]);
                s.DtCsvPvpZmeli.Rows.Add("LP1C1_", codigoProv, zmeliIncrementado, "ZMELI", "MELIP", "", "N");
            }

            // Cambios 12-03-2025 (y 23-02-2026: siempre se exporta): ZMELI LIQUI
            var dtZmeliLiqui = _db.EjecutarSP(Sp.ObtenerPrecioDiferencialMeli, codigoProv);
            if (dtZmeliLiqui is not null)
            {
                var zmeliLiqui = CDbl(dtZmeliLiqui.Rows[0]["DIFERENCIAL"]);
                var zmeliPeriodo = Convert.ToString(dtZmeliLiqui.Rows[0]["PERIODO"]);
                var zmeliIncrementadoLiqui = CDbl(_db.EjecutarSP(Sp.CalcularPvpVigente, zmeliLiqui, incPvpFactor)!.Rows[0][0]);
                s.DtCsvPvpZmeliLiqui.Rows.Add("LP1C1_", codigoProv, zmeliIncrementadoLiqui, "ZMELI", zmeliPeriodo, "", "N");
            }
        }

        return "";
    }

    // =============================================================================
    // ValidarDatosEditados — port literal (evalúa TODAS las reglas en orden 7→1,
    // fórmulas y exclusiones tal cual la Desktop, incluidas sus asimetrías)
    // =============================================================================
    public void ValidarDatosEditados(WorkSession s, int indice)
    {
        var dtMain = s.DtMain;

        DataTable dtResult = (s.Tab == "tabMultimarca"
            ? _db.EjecutarSP(Sp.ObtenerPrecioCostoMM, Convert.ToString(dtMain.Rows[indice][0]), s.NombreProveedor, s.NombreMarca)
            : _db.EjecutarSP(Sp.ObtenerPrecioCosto, Convert.ToString(dtMain.Rows[indice][0]), s.NombreProveedor, s.NombreMarca))
            ?? throw new InvalidOperationException("Artículo inexistente");

        var pvpAnt = Round(CDbl(dtResult.Rows[0][0]), 2);
        var costoAnt = Round(CDbl(dtResult.Rows[0][1]), 2);
        string periodo;
        var iva = Round(CDbl(dtResult.Rows[0][3]), 1);
        var nombre = Convert.ToString(dtResult.Rows[0][4]);

        double costoNuevo = 0, pvpNuevo = 0;
        if (dtMain.Rows[indice]["Costo EV"] != DBNull.Value)
            costoNuevo = Round(CDbl(dtMain.Rows[indice]["Costo EV"]), 2);
        if (dtMain.Rows[indice]["$ PUBL#"] != DBNull.Value)
            pvpNuevo = Round(CDbl(dtMain.Rows[indice]["$ PUBL#"]), 2);

        var estado = "";

        dtMain.Rows[indice]["PVPAnt"] = pvpAnt;
        dtMain.Rows[indice]["CostoAnt"] = costoAnt;

        if (dtResult.Rows[0][2] == DBNull.Value)
            periodo = "PERMAN";
        else
        {
            var t = Convert.ToString(dtResult.Rows[0][2])!;
            periodo = t.Substring(0, t.IndexOf("-", StringComparison.Ordinal)).Trim();
        }
        dtMain.Rows[indice]["PerTarifa"] = periodo;

        var margen = Round((((pvpNuevo / (1 + iva / 100)) - costoNuevo)) / (pvpNuevo / (1 + iva / 100)) * 100, 2);
        dtMain.Rows[indice]["Margen"] = margen;
        dtMain.Rows[indice]["Nombre"] = nombre;
        dtMain.Rows[indice]["Usuario"] = s.Usuario;
        dtMain.Rows[indice]["Fecha"] = DateTime.Today.ToShortDateString() + " " + DateTime.Now.ToLongTimeString();
        dtMain.Rows[indice]["IncCosto"] = Round((costoNuevo - costoAnt) * 100 / costoAnt, 2);
        dtMain.Rows[indice]["IncPVP"] = Round((pvpNuevo - pvpAnt) * 100 / pvpAnt, 2);

        s.DtReglas = _db.EjecutarSP(Sp.ObtenerReglas) ?? new DataTable();
        var reglas = s.DtReglas;

        bool Activa(int fila) => Convert.ToBoolean(reglas.Rows[fila][2]);
        double Valor(int fila) => CDbl(reglas.Rows[fila][1]);
        string ValorStr(int fila) => Convert.ToString(reglas.Rows[fila][1])!;
        void Log(int nRegla, int fila, bool activa) =>
            dtMain.Rows[indice]["Regla" + nRegla] = (activa ? "True" : "False") + ":" + ValorStr(fila);

        // Orden 7→1 sin cortar: la ÚLTIMA regla violada define el Estado (así opera la Desktop)
        if (Activa(6))
        {
            Log(7, 6, true);
            if (margen > Valor(6)) estado = "Margen > " + ValorStr(6) + "%";
        }
        else Log(7, 6, false);

        if (Activa(5))
        {
            Log(6, 5, true);
            // Fórmula distinta a ValidarDatos y condición Or siempre verdadera: fiel a la Desktop
            if (pvpNuevo < pvpAnt - pvpAnt * (1 - (Valor(5) / 100)) && (periodo != "PERM" || periodo != "PERMAN"))
                estado = "Mas de " + ValorStr(5) + "% del Precio Anterior";
        }
        else Log(6, 5, false);

        if (Activa(4))
        {
            Log(5, 4, true);
            if ((periodo != "PERM" && periodo != "PERMAN") && margen < Valor(4))
                estado = "Margen < " + ValorStr(4) + "%";
        }
        else Log(5, 4, false);

        if (Activa(3))
        {
            Log(4, 3, true);
            if ((periodo == "PERM" || periodo == "PERMAN") && margen < Valor(3))
                estado = "Margen < " + ValorStr(3) + "%";
        }
        else Log(4, 3, false);

        if (Activa(2))
        {
            Log(3, 2, true);
            if (costoNuevo > pvpNuevo) estado = "Costo > Precio";
        }
        else Log(3, 2, false);

        if (Activa(1))
        {
            Log(2, 1, true);
            if (costoNuevo < costoAnt - costoAnt * (Valor(1) / 100))
                estado = "Costo Nvo. < " + ValorStr(1) + "%";
        }
        else Log(2, 1, false);

        if (Activa(0))
        {
            Log(1, 0, true);
            if (costoNuevo > costoAnt * (1 + Valor(0) / 100))
                estado = "Costo Nvo. > " + ValorStr(0) + "%";
        }
        else Log(1, 0, false);

        if (estado == "")
        {
            for (var i = 0; i < dtResult.Rows.Count; i++)
            {
                dtMain.Rows[indice]["Estado"] = "OK";

                var codigoProv = Convert.ToString(dtResult.Rows[i][5])!;
                s.DtCsvCostos.Rows.Add("LP1C1_", codigoProv, costoNuevo, "VACOM", "PERMAN", "", "Y");
                s.DtCsvPrecios.Rows.Add("LP1C1_", codigoProv, pvpNuevo, "Z1", "PERMAN", "", "Y");

                var incPvpFactor = CDbl(dtMain.Rows[indice]["IncPVP"]) / 100 + 1;

                // Acá además se excluye HS24 y se usa el periodo del registro (fiel a la Desktop)
                if (!(periodo == "PERM" || periodo == "PERMAN" || periodo == "HS24"))
                {
                    var pvpVigente = CDbl(_db.EjecutarSP(Sp.ObtenerPvpVigente,
                        Convert.ToString(dtMain.Rows[indice][0]), s.NombreProveedor, s.NombreMarca)!.Rows[0][0]);
                    var pvpVigenteIncrementado = CDbl(_db.EjecutarSP(Sp.CalcularPvpVigente,
                        pvpVigente, incPvpFactor)!.Rows[0][0]);
                    if (pvpVigenteIncrementado > pvpVigente)
                        s.DtCsvPvpVigente.Rows.Add("LP1C1_", codigoProv, pvpVigenteIncrementado, "Z1", periodo, "", "N");
                }

                var dtZmeli = _db.EjecutarSP(Sp.ObtenerPrecioZmeli, codigoProv);
                if (dtZmeli is not null)
                {
                    var zmeli = CDbl(dtZmeli.Rows[0]["ZMELI"]);
                    var zmeliIncrementado = CDbl(_db.EjecutarSP(Sp.CalcularPvpVigente, zmeli, incPvpFactor)!.Rows[0][0]);
                    s.DtCsvPvpZmeli.Rows.Add("LP1C1_", codigoProv, zmeliIncrementado, "ZMELI", "MELIP", "", "N");
                }

                var dtZmeliLiqui = _db.EjecutarSP(Sp.ObtenerPrecioDiferencialMeli, codigoProv);
                if (dtZmeliLiqui is not null)
                {
                    // La Desktop acá lee la columna "ZMELI" (no "DIFERENCIAL") — se preserva
                    var zmeliLiqui = CDbl(dtZmeliLiqui.Rows[0]["ZMELI"]);
                    var zmeliPeriodo = Convert.ToString(dtZmeliLiqui.Rows[0]["PERIODO"]);
                    var zmeliIncrementadoLiqui = CDbl(_db.EjecutarSP(Sp.CalcularPvpVigente, zmeliLiqui, incPvpFactor)!.Rows[0][0]);
                    s.DtCsvPvpZmeliLiqui.Rows.Add("LP1C1_", codigoProv, zmeliIncrementadoLiqui, "ZMELI", zmeliPeriodo, "", "N");
                }
            }
            s.Ok += 1;
        }
        else
        {
            dtMain.Rows[indice]["Estado"] = estado;
            s.Fail += 1;
        }
    }

    /// <summary>Edición de una fila (GridView_EditFormHidden de la Desktop).</summary>
    public void Editar(WorkSession s, string codigo, object? costoNuevo, object? pvpNuevo)
    {
        var fila = s.DtMain.Rows.Find(codigo)
            ?? throw new InvalidOperationException("Código no encontrado: " + codigo);

        var estadoActual = Convert.ToString(fila["Estado"]);
        if (estadoActual == "OK" || estadoActual == "Sin Cambio")
            throw new InvalidOperationException("La fila está OK / Sin Cambio: no es editable.");

        fila["Costo EV"] = costoNuevo ?? DBNull.Value;
        fila["$ PUBL#"] = pvpNuevo ?? DBNull.Value;

        var indice = s.DtMain.Rows.IndexOf(fila);

        if (estadoActual == "No Informado")
        {
            ValidarDatosEditados(s, indice);
            var enNoInf = s.DtNoInformados.Rows.Find(Convert.ToString(fila["CODIGO"]));
            if (enNoInf is not null) s.DtNoInformados.Rows.Remove(enNoInf);
            s.NoInformado -= 1;
        }
        else
        {
            ValidarDatosEditados(s, indice);
            s.Fail -= 1;
        }
    }

    /// <summary>Cambio masivo (btnMasivo): aplica costo/pvp a todas las filas del filtro activo.</summary>
    public void Masivo(WorkSession s, double costoNvo, double pvpNvo, int filtro)
    {
        var filas = FiltrarFilas(s, filtro).ToList();

        foreach (var fila in filas)
        {
            fila["Costo EV"] = costoNvo;
            fila["$ PUBL#"] = pvpNvo;

            ValidarDatosEditados(s, s.DtMain.Rows.IndexOf(fila));

            switch (filtro)
            {
                case 1:
                    s.Fail -= 1;
                    break;
                case 3:
                    var enNoInf = s.DtNoInformados.Rows.Find(Convert.ToString(fila["CODIGO"]));
                    if (enNoInf is not null) s.DtNoInformados.Rows.Remove(enNoInf);
                    s.NoInformado -= 1;
                    break;
            }
        }
    }

    /// <summary>Filtros de la grilla — réplica de ActualizarFiltros.</summary>
    public IEnumerable<DataRow> FiltrarFilas(WorkSession s, int filtro)
    {
        var rows = s.DtMain.Rows.Cast<DataRow>();
        string E(DataRow r) => Convert.ToString(r["Estado"]) ?? "";
        string P(DataRow r) => Convert.ToString(r["PerTarifa"]) ?? "";

        return filtro switch
        {
            0 => rows.Where(r => E(r) == "OK"),
            1 => rows.Where(r => E(r) != "OK" && E(r) != "No Informado" && E(r) != "Sin Cambio" && P(r) != "---"),
            2 => rows.Where(r => P(r) == "---"),
            3 => rows.Where(r => E(r) == "No Informado"),
            4 => rows.Where(r => E(r) == "Sin Cambio"),
            5 => rows.Where(r => P(r) != "---"),
            _ => rows
        };
    }

    // =============================================================================
    // EXPORTAR (btnExportar, Case Else) — CSVs a PRECIOS + log
    // =============================================================================
    public List<string> Exportar(WorkSession s)
    {
        var archivos = new List<string>();
        var destino = _rutaPrecios;
        _unc.Asegurar(destino);
        var hoy = DateTime.Today;
        var prov = s.NombreProveedor.Replace("*", "");
        var marca = s.NombreMarca.Replace("*", "");
        var basename = destino + "\\" + hoy.Day + "." + hoy.Month + "." + prov + " - " + marca;

        archivos.Add(CsvExporter.DtTableToCsv(s.DtCsvPrecios, basename + " - PRECIOS", Encoding.Unicode, true));
        archivos.Add(CsvExporter.DtTableToCsv(s.DtCsvCostos, basename + " - COSTOS", Encoding.Unicode, true));

        if (s.DtCsvPvpVigente.Rows.Count > 0)
            archivos.Add(CsvExporter.DtTableToCsv(s.DtCsvPvpVigente, basename + " - PVP Vigente", Encoding.Unicode, true));

        if (s.DtCsvPvpDiferencial.Rows.Count > 0)
            archivos.Add(CsvExporter.DtTableToCsv(s.DtCsvPvpDiferencial, basename + " - PVP Diferencial", Encoding.Unicode, true));

        if (s.DtCsvPvpZmeli.Rows.Count > 0)
            archivos.Add(CsvExporter.DtTableToCsv(s.DtCsvPvpZmeli, basename + " - ZMELI", Encoding.Unicode, true));

        if (s.DtCsvPvpZmeliLiqui.Rows.Count > 0)
            archivos.Add(CsvExporter.DtTableToCsv(s.DtCsvPvpZmeliLiqui, basename + " - ZMELI LIQUI", Encoding.Unicode, true));

        // Log al SQL (copia Web del log: APCWeb_TBL_ACTUALIZARPRECIOSCOSTOS_LOG)
        var okRows = s.DtMain.Select("Estado = 'OK'");
        if (okRows.Length == 0)
            throw new InvalidOperationException("No se pudo exportar: no hay filas OK para el log.");

        var dtLog = okRows.CopyToDataTable();
        dtLog.Columns.Remove("DESCRIPCION");
        dtLog.Columns.Remove("$ CONF#");
        dtLog.Columns.Remove("OBS");
        dtLog.Columns.Remove("Estado");
        dtLog.Columns.Remove("IncCosto");
        dtLog.Columns.Remove("IncPVP");
        dtLog.Columns.Remove("Seccion");

        EliminarColumnasVacias(dtLog);

        dtLog.Columns.Add("ObtenerNoInformados");
        for (var i = 0; i < dtLog.Rows.Count; i++)
            dtLog.Rows[i]["ObtenerNoInformados"] = s.ObtenerNoInformados ? "True" : "False";

        dtLog.Columns["MARCA"]!.SetOrdinal(19);

        _db.BulkInsert(dtLog, Sp.TblLog);

        return archivos;
    }

    private static void EliminarColumnasVacias(DataTable dataTable)
    {
        var columnasAVaciar = new List<string>();
        foreach (DataColumn columna in dataTable.Columns)
        {
            var todasFilasVacias = true;
            foreach (DataRow fila in dataTable.Rows)
            {
                if (!fila.IsNull(columna)) { todasFilasVacias = false; break; }
            }
            if (todasFilasVacias) columnasAVaciar.Add(columna.ColumnName);
        }
        foreach (var nombre in columnasAVaciar)
            dataTable.Columns.Remove(nombre);
    }

    // =============================================================================
    // Exports auxiliares (a \\10.0.0.115\Actualizar Precios y Costos, UTF-8)
    // =============================================================================
    public string ExportarNoInformados(WorkSession s)
    {
        var prov = s.NombreProveedor.Replace("*", "");
        var marca = s.Tab == "tabMultimarca" ? "Multimarca" : s.NombreMarca.Replace("*", "");

        _unc.Asegurar(_rutaAuxiliar);

        if (s.DtNoInformados.Columns.Count == 10)
            s.DtNoInformados.Columns.Add("Stock");

        for (var i = 0; i < s.DtNoInformados.Rows.Count; i++)
        {
            var marcaFila = s.Tab == "tabMultimarca"
                ? s.DtNoInformados.Rows[i]["MARCA"]
                : s.NombreMarca;
            var dtStock = _db.EjecutarSP(Sp.Stock, s.DtNoInformados.Rows[i][0], s.NombreProveedor, marcaFila);
            s.DtNoInformados.Rows[i]["Stock"] = Convert.ToString(dtStock!.Rows[0][0]);
        }

        var archivo = CsvExporter.DtTableToCsv(s.DtNoInformados,
            _rutaAuxiliar + "\\" + prov + " - " + marca + " - NO INFORMADOS", Encoding.UTF8, true);

        _db.EjecutarSP(Sp.EnviarCorreoNoInformados, s.Usuario, prov, marca);
        return archivo;
    }

    public string ExportarLiquiLista(WorkSession s)
    {
        var prov = s.NombreProveedor.Replace("*", "");
        var marca = s.NombreMarca.Replace("*", "");

        _unc.Asegurar(_rutaAuxiliar);

        var seleccion = s.DtMain.Select("PerTarifa <> 'PERMAN' AND PerTarifa <> 'PERM' ");
        var dtLiqui = seleccion.CopyToDataTable();

        dtLiqui.Columns.Add("Stock");
        dtLiqui.Columns.RemoveAt(2);
        foreach (var c in new[] { "OBS", "Estado", "Usuario", "Fecha", "Regla1", "Regla2", "Regla3", "Regla4",
                                  "Regla5", "Regla6", "Regla7", "DESCRIPCION", "PVPAnt", "CostoAnt", "Margen",
                                  "EstadoPVP", "IncCosto", "IncPVP" })
            dtLiqui.Columns.Remove(c);

        for (var i = 0; i < dtLiqui.Rows.Count; i++)
        {
            var dtStock = _db.EjecutarSP(Sp.Stock, dtLiqui.Rows[i][0], s.NombreProveedor, s.NombreMarca);
            dtLiqui.Rows[i]["Stock"] = Convert.ToString(dtStock!.Rows[0][0]);
        }

        var archivo = CsvExporter.DtTableToCsv(dtLiqui,
            _rutaAuxiliar + "\\" + prov + " - " + marca + " - LIQUI", Encoding.UTF8, true);

        _db.EjecutarSP(Sp.EnviarCorreoLiquis, s.Usuario, prov, marca);
        return archivo;
    }

    public string EnviarFail(WorkSession s)
    {
        var prov = s.NombreProveedor.Replace("*", "");
        var marca = s.NombreMarca.Replace("*", "");

        _unc.Asegurar(_rutaAuxiliar);

        var dtFail = s.DtMain.Clone();
        foreach (DataRow row in s.DtMain.Rows)
        {
            var estado = Convert.ToString(row["Estado"]) ?? "";
            var perTarifa = Convert.ToString(row["PerTarifa"]) ?? "";
            if (!string.IsNullOrEmpty(estado) &&
                !estado.Contains("OK") &&
                !estado.Contains("Sin Cambio") &&
                !estado.Contains("No Informado") &&
                !perTarifa.Contains("---"))
            {
                dtFail.ImportRow(row);
            }
        }

        var archivo = CsvExporter.DtTableToCsv(dtFail,
            _rutaAuxiliar + "\\" + prov + " - " + marca + " - ERRORES", Encoding.UTF8, true);

        _db.EjecutarSP(Sp.EnviarCorreoErrores, s.Usuario, prov, marca);
        return archivo;
    }

    public string EnviarTodo(WorkSession s)
    {
        // Fiel a la Desktop: exporta dtMain (que queda inutilizable tras el Dispose interno)
        _unc.Asegurar(_rutaAuxiliar);
        var archivo = CsvExporter.DtTableToCsv(s.DtMain, _rutaAuxiliar + "\\TODO", Encoding.UTF8, true);
        _db.EjecutarSP(Sp.EnviarCorreoTodo, s.Usuario);
        return archivo;
    }
}
