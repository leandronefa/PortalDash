using System.Collections.Concurrent;
using System.Data;
using Microsoft.Data.SqlClient;

namespace APCWeb.Data;

/// <summary>
/// Réplica del contrato de ConexionBBDD.ConexionSQL usado por la app Desktop:
///  - EjecutarSP(nombre, params...) → DataTable, o NULL si el SP no devuelve filas
///    (el código Desktop chequea IsNothing/IsNot Nothing sobre el resultado).
///  - BulkInsert(dt, tabla) ≡ exportDataTableToTableSQL: inserta por ORDEN de columnas.
/// Los parámetros de los SP se asignan por POSICIÓN (igual que la DLL original):
/// se descubren con DeriveParameters y se cachean.
/// </summary>
public class Db
{
    private readonly string _connectionString;
    private readonly int _commandTimeout;
    private static readonly ConcurrentDictionary<string, SqlParameter[]> _paramCache = new();

    public Db(IConfiguration config)
    {
        _connectionString = config.GetConnectionString("db_cegid")
            ?? throw new InvalidOperationException("Falta ConnectionStrings:db_cegid en appsettings.");
        _commandTimeout = config.GetValue("Db:CommandTimeoutSeconds", 1600);
    }

    public DataTable? EjecutarSP(string nombre, params object?[] args)
    {
        using var cn = new SqlConnection(_connectionString);
        cn.Open();
        using var cmd = new SqlCommand(nombre, cn)
        {
            CommandType = CommandType.StoredProcedure,
            CommandTimeout = _commandTimeout
        };

        var plantilla = _paramCache.GetOrAdd(nombre, n =>
        {
            using var cn2 = new SqlConnection(_connectionString);
            cn2.Open();
            using var cmd2 = new SqlCommand(n, cn2) { CommandType = CommandType.StoredProcedure };
            SqlCommandBuilder.DeriveParameters(cmd2);
            return cmd2.Parameters.Cast<SqlParameter>()
                .Where(p => p.Direction != ParameterDirection.ReturnValue)
                .Select(p => new SqlParameter(p.ParameterName, p.SqlDbType) { Size = p.Size, Precision = p.Precision, Scale = p.Scale })
                .ToArray();
        });

        for (var i = 0; i < plantilla.Length; i++)
        {
            var p = new SqlParameter(plantilla[i].ParameterName, plantilla[i].SqlDbType)
            {
                Size = plantilla[i].Size,
                Precision = plantilla[i].Precision,
                Scale = plantilla[i].Scale,
                Value = i < args.Length ? (args[i] ?? DBNull.Value) : DBNull.Value
            };
            cmd.Parameters.Add(p);
        }

        var dt = new DataTable();
        using var da = new SqlDataAdapter(cmd);
        da.Fill(dt);

        // Contrato Desktop: sin filas ⇒ Nothing
        return dt.Rows.Count == 0 ? null : dt;
    }

    public void BulkInsert(DataTable dt, string tabla)
    {
        using var cn = new SqlConnection(_connectionString);
        cn.Open();
        using var bulk = new SqlBulkCopy(cn)
        {
            DestinationTableName = tabla,
            BulkCopyTimeout = _commandTimeout
        };

        // Si todas las columnas de origen existen en destino se mapea por NOMBRE
        // (caso del log, cuyas columnas varían); si no, por ORDEN (stagings cuyos
        // encabezados de Excel no coinciden con la tabla).
        var destino = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using (var cmd = new SqlCommand($"SELECT TOP (0) * FROM [{tabla}]", cn))
        using (var rd = cmd.ExecuteReader(CommandBehavior.SchemaOnly))
        {
            for (var i = 0; i < rd.FieldCount; i++) destino.Add(rd.GetName(i));
        }

        var porNombre = dt.Columns.Cast<DataColumn>().All(c => destino.Contains(c.ColumnName));
        for (var i = 0; i < dt.Columns.Count; i++)
        {
            if (porNombre)
                bulk.ColumnMappings.Add(dt.Columns[i].ColumnName, dt.Columns[i].ColumnName);
            else
                bulk.ColumnMappings.Add(i, i);
        }
        bulk.WriteToServer(dt);
    }
}
