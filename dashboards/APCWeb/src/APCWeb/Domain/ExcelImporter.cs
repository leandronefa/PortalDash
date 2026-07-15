using System.Data;
using ClosedXML.Excel;

namespace APCWeb.Domain;

/// <summary>
/// Réplica de ImportarArchivoXLSX de la Desktop (OleDb ACE, HDR=YES, SELECT * FROM [hoja$]).
/// - Primera fila = encabezados.
/// - Se eliminan las filas cuya columna clave (CODIGO / CODIGO ARTICULO) esté vacía.
/// - Valores tipados como los entrega OleDb: número → double, fecha → DateTime, texto → string.
/// </summary>
public static class ExcelImporter
{
    public static DataTable ImportarXlsx(Stream archivo, string hoja, string columnaClave)
    {
        using var wb = new XLWorkbook(archivo);
        if (!wb.TryGetWorksheet(hoja, out var ws))
            throw new InvalidOperationException($"El Excel no contiene la hoja '{hoja}'.");

        var dt = new DataTable();
        var rango = ws.RangeUsed();
        if (rango is null) return dt;

        var primeraFila = rango.FirstRow();
        var nCols = rango.ColumnCount();

        for (var c = 1; c <= nCols; c++)
        {
            var nombre = primeraFila.Cell(c).GetString().Trim();
            if (string.IsNullOrEmpty(nombre)) nombre = $"F{c}";
            // El proveedor ACE de OleDb (que usa la Desktop) reemplaza '.' y '!' por '#'
            // en los nombres de columna: "$ PUBL." → "$ PUBL#", "$ CONF." → "$ CONF#".
            nombre = nombre.Replace('.', '#').Replace('!', '#');
            // OleDb desambigua duplicados; acá igual
            var final = nombre; var k = 1;
            while (dt.Columns.Contains(final)) { final = nombre + k; k++; }
            dt.Columns.Add(final, typeof(object));
        }

        foreach (var fila in rango.RowsUsed().Skip(1))
        {
            var valores = new object[nCols];
            var vacia = true;
            for (var c = 1; c <= nCols; c++)
            {
                var celda = fila.Cell(c);
                object valor = celda.Value.Type switch
                {
                    XLDataType.Blank => DBNull.Value,
                    XLDataType.Number => celda.Value.GetNumber(),
                    XLDataType.Boolean => celda.Value.GetBoolean(),
                    XLDataType.DateTime => celda.Value.GetDateTime(),
                    XLDataType.TimeSpan => celda.Value.GetTimeSpan(),
                    _ => celda.GetString()
                };
                if (valor is string s && s.Length == 0) valor = DBNull.Value;
                if (valor != DBNull.Value) vacia = false;
                valores[c - 1] = valor;
            }
            if (!vacia) dt.Rows.Add(valores);
        }

        // Igual que la Desktop: quitar filas con la columna clave vacía
        // (equivale a dt.Select("ISNULL([clave], '') = ''") sobre columnas object)
        if (dt.Columns.Contains(columnaClave))
        {
            var aQuitar = dt.Rows.Cast<DataRow>()
                .Where(r => r[columnaClave] == DBNull.Value || Convert.ToString(r[columnaClave])!.Length == 0)
                .ToList();
            foreach (var row in aQuitar)
                dt.Rows.Remove(row);
        }

        return dt;
    }
}
