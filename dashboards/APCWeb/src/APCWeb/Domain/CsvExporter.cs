using System.Data;
using System.Text;

namespace APCWeb.Domain;

/// <summary>
/// Réplica EXACTA de frmMain.dtTableToCSV de la app Desktop.
/// Cualquier cambio acá rompe la compatibilidad byte a byte de los CSV.
/// </summary>
public static class CsvExporter
{
    /// <returns>Ruta final del archivo escrito (puede llevar sufijo _H-m-s si ya existía).</returns>
    public static string DtTableToCsv(DataTable dt, string filename, Encoding codificacion,
                                      bool headers = true, string delim = ";")
    {
        var txt = "";
        var fileloc = filename + ".csv";

        if (File.Exists(fileloc))
        {
            var ahora = DateTime.Now;
            filename += "_" + ahora.Hour + "-" + ahora.Minute + "-" + ahora.Second;
            fileloc = filename + ".csv";
        }

        var n = 0;

        if (headers)
        {
            foreach (DataColumn column in dt.Columns)
            {
                if (n == 0)
                    txt += column.ColumnName;
                else
                    txt += delim + column.ColumnName;
                n += 1;
            }
        }

        txt += "\r\n";
        n = 0;

        foreach (DataRow row in dt.Rows)
        {
            var line = "";
            foreach (DataColumn column in dt.Columns)
                line += delim + Convert.ToString(row[column.ColumnName]);

            if (dt.Rows.Count - 1 == n)
                txt += line.Substring(1);
            else
                txt += line.Substring(1) + "\r\n";

            n += 1;
        }

        using (var sw = new StreamWriter(fileloc, false, codificacion))
            sw.Write(txt);

        // La Desktop hace dt.Dispose(): el DataTable queda inutilizado tras exportar.
        dt.Dispose();

        return fileloc;
    }
}
