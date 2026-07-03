using System.Data;
using System.Data.Odbc;
using System.Globalization;
using DashboardPortal.Models;

namespace DashboardPortal.Services;

public interface ICorporateAuthService
{
    Task<AuthResult> ValidateAsync(string username, string password);
}

/// <summary>
/// Valida usuarios corporativos via ODBC (evita Microsoft.Data.SqlClient SNI que falla
/// tras Windows Security Updates en este servidor). Usa parametros para evitar inyeccion SQL.
/// </summary>
public class CorporateAuthService(IConfiguration config, ILogger<CorporateAuthService> logger) : ICorporateAuthService
{
    public async Task<AuthResult> ValidateAsync(string username, string password)
    {
        var sqlConnStr = config.GetConnectionString("CorporateSqlServer");
        if (string.IsNullOrWhiteSpace(sqlConnStr))
        {
            logger.LogError("ConnectionStrings:CorporateSqlServer no esta configurada.");
            return AuthResult.Fail("La conexion al servidor corporativo no esta configurada.");
        }

        var odbcConnStr = BuildOdbcConnectionString(sqlConnStr);

        var spConfig    = config["CorporateAuth:StoredProcedure"] ?? "SP_VALIDAR_INICIO_SESION_APPS";
        var successCol  = config["CorporateAuth:SuccessColumn"];
        var successVals = config.GetSection("CorporateAuth:SuccessValues").Get<string[]>() ?? [];
        var displayCols = config.GetSection("CorporateAuth:DisplayNameColumns").Get<string[]>() ?? [];
        var anyRowOk    = config.GetValue<bool?>("CorporateAuth:TreatAnyRowAsSuccess") ?? true;
        var timeout     = config.GetValue<int?>("CorporateAuth:CommandTimeoutSeconds") ?? 20;

        // ODBC usa solo el nombre del SP (sin prefijo de base de datos)
        var spName = spConfig.Split('.').Last();

        try
        {
            await using var conn = new OdbcConnection(odbcConnStr);
            await using var cmd  = conn.CreateCommand();

            // Sintaxis ODBC para llamar a un stored procedure con 2 parametros posicionales
            cmd.CommandText    = $"{{CALL dbo.{spName}(?,?)}}";
            cmd.CommandTimeout = timeout;

            cmd.Parameters.Add(new OdbcParameter { OdbcType = OdbcType.NVarChar, Size = 200, Value = username });
            cmd.Parameters.Add(new OdbcParameter { OdbcType = OdbcType.NVarChar, Size = 200, Value = password });

            await conn.OpenAsync();

            bool   hasRow        = false;
            bool?  explicitOk    = null;
            string? displayName  = null;

            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                if (await reader.ReadAsync())
                {
                    hasRow = true;
                    var cols = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 0; i < reader.FieldCount; i++)
                    {
                        var colName = reader.GetName(i);
                        var raw     = reader.IsDBNull(i) ? null : Convert.ToString(reader.GetValue(i), CultureInfo.InvariantCulture);
                        cols[colName] = raw;
                    }

                    logger.LogDebug("SP {sp} devolvio columnas: {cols}", spName, string.Join(", ", cols.Keys));

                    if (!string.IsNullOrWhiteSpace(successCol) && cols.TryGetValue(successCol, out var sv))
                        explicitOk = IsTruthy(sv, successVals);
                    else if (string.IsNullOrWhiteSpace(successCol))
                    {
                        var candidate = cols.Keys.FirstOrDefault(LooksLikeSuccessColumn);
                        if (candidate is not null)
                            explicitOk = IsTruthy(cols[candidate], successVals);
                        else if (reader.FieldCount == 1)
                        {
                            // SP corporativo real: devuelve SIEMPRE una fila con una unica columna
                            // sin nombre ('ok' o 'Acceso denegado!'). El valor ES el indicador.
                            explicitOk = IsTruthy(cols.Values.FirstOrDefault(), successVals);
                        }
                    }

                    displayName = displayCols
                        .Select(c => cols.TryGetValue(c, out var dn) ? dn : null)
                        .FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
                }

                while (await reader.ReadAsync()) { }
                while (await reader.NextResultAsync()) { while (await reader.ReadAsync()) { } }
            }

            bool success = explicitOk.HasValue ? explicitOk.Value
                         : hasRow && anyRowOk  ? true
                         : false;

            if (success)
                return AuthResult.Ok(username, string.IsNullOrWhiteSpace(displayName) ? null : displayName!.Trim(), false);

            return AuthResult.Fail("Usuario o contrasena incorrectos.");
        }
        catch (OdbcException ex)
        {
            logger.LogError(ex, "Error de ODBC al validar al usuario {user}.", username);
            return AuthResult.Fail("No se pudo validar el usuario contra el servidor corporativo. Intente nuevamente mas tarde.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error inesperado al validar al usuario {user}.", username);
            return AuthResult.Fail("Ocurrio un error inesperado durante la autenticacion.");
        }
    }

    /// <summary>
    /// Convierte una connection string de SQL Server al formato ODBC {SQL Server}.
    /// Extrae Server, Database, User Id y Password.
    /// </summary>
    private static string BuildOdbcConnectionString(string sqlConnStr)
    {
        var kv = sqlConnStr
            .Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Split('=', 2))
            .Where(p => p.Length == 2)
            .ToDictionary(p => p[0].Trim(), p => p[1].Trim(), StringComparer.OrdinalIgnoreCase);

        var server = kv.GetValueOrDefault("Server") ?? kv.GetValueOrDefault("Data Source") ?? "";
        var db     = kv.GetValueOrDefault("Database") ?? kv.GetValueOrDefault("Initial Catalog") ?? "";
        var uid    = kv.GetValueOrDefault("User Id") ?? kv.GetValueOrDefault("UID") ?? "";
        var pwd    = kv.GetValueOrDefault("Password") ?? kv.GetValueOrDefault("PWD") ?? "";

        return $"Driver={{SQL Server}};Server={server};Database={db};UID={uid};PWD={pwd};";
    }

    private static bool IsTruthy(string? value, string[] truthyValues)
    {
        if (value is null) return false;
        var v = value.Trim();
        return truthyValues.Any(t => string.Equals(t?.Trim(), v, StringComparison.OrdinalIgnoreCase));
    }

    private static bool LooksLikeSuccessColumn(string name)
    {
        var n = name.ToLowerInvariant();
        return n.Contains("result") || n.Contains("valid") || n.Contains("estado")
            || n.Contains("acceso") || n.Contains("login") || n == "ok"
            || n.Contains("success") || n.Contains("autoriz") || n.Contains("permit");
    }
}
