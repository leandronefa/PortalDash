using System.Data;
using System.Globalization;
using DashboardPortal.Models;
using Microsoft.Data.SqlClient;

namespace DashboardPortal.Services;

public interface ICorporateAuthService
{
    Task<AuthResult> ValidateAsync(string username, string password);
}

/// <summary>
/// Valida usuarios corporativos EXCLUSIVAMENTE a traves del Stored Procedure configurado.
/// Nunca consulta tablas directamente. Usa parametros (sin concatenacion = sin inyeccion SQL).
/// </summary>
public class CorporateAuthService(IConfiguration config, ILogger<CorporateAuthService> logger) : ICorporateAuthService
{
    public async Task<AuthResult> ValidateAsync(string username, string password)
    {
        var connString = config.GetConnectionString("CorporateSqlServer");
        if (string.IsNullOrWhiteSpace(connString))
        {
            logger.LogError("ConnectionStrings:CorporateSqlServer no esta configurada.");
            return AuthResult.Fail("La conexion al servidor corporativo no esta configurada.");
        }

        var sp = config["CorporateAuth:StoredProcedure"] ?? "db_Cegid.dbo.SP_VALIDAR_INICIO_SESION_APPS";
        var userParam = EnsureAt(config["CorporateAuth:UserParam"] ?? "@USUARIO");
        var pwdParam = EnsureAt(config["CorporateAuth:PasswordParam"] ?? "@PSW");
        var successColumn = config["CorporateAuth:SuccessColumn"];
        var successValues = config.GetSection("CorporateAuth:SuccessValues").Get<string[]>() ?? [];
        var displayNameCols = config.GetSection("CorporateAuth:DisplayNameColumns").Get<string[]>() ?? [];
        var treatAnyRowAsSuccess = config.GetValue<bool?>("CorporateAuth:TreatAnyRowAsSuccess") ?? true;
        var commandTimeout = config.GetValue<int?>("CorporateAuth:CommandTimeoutSeconds") ?? 20;

        try
        {
            await using var conn = new SqlConnection(connString);
            await using var cmd = new SqlCommand(sp, conn)
            {
                CommandType = CommandType.StoredProcedure,
                CommandTimeout = commandTimeout
            };

            cmd.Parameters.Add(new SqlParameter(userParam, SqlDbType.NVarChar, 200) { Value = username });
            cmd.Parameters.Add(new SqlParameter(pwdParam, SqlDbType.NVarChar, 200) { Value = password });

            var returnParam = new SqlParameter("@__RETURN_VALUE", SqlDbType.Int) { Direction = ParameterDirection.ReturnValue };
            cmd.Parameters.Add(returnParam);

            await conn.OpenAsync();

            bool hasRow = false;
            bool? explicitSuccess = null;
            string? displayName = null;

            await using (var reader = await cmd.ExecuteReaderAsync())
            {
                if (await reader.ReadAsync())
                {
                    hasRow = true;

                    var cols = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 0; i < reader.FieldCount; i++)
                    {
                        var name = reader.GetName(i);
                        var raw = reader.IsDBNull(i) ? null : Convert.ToString(reader.GetValue(i), CultureInfo.InvariantCulture);
                        cols[name] = raw;
                    }

                    logger.LogDebug("SP {sp} devolvio columnas: {cols}", sp, string.Join(", ", cols.Keys));

                    if (!string.IsNullOrWhiteSpace(successColumn) && cols.TryGetValue(successColumn, out var sv))
                    {
                        explicitSuccess = IsTruthy(sv, successValues);
                    }
                    else if (string.IsNullOrWhiteSpace(successColumn))
                    {
                        var candidate = cols.Keys.FirstOrDefault(LooksLikeSuccessColumn);
                        if (candidate is not null)
                            explicitSuccess = IsTruthy(cols[candidate], successValues);
                    }

                    displayName = displayNameCols
                        .Select(c => cols.TryGetValue(c, out var dn) ? dn : null)
                        .FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
                }

                // Drenar el resto para garantizar que el parametro de retorno quede poblado.
                while (await reader.ReadAsync()) { }
                while (await reader.NextResultAsync())
                {
                    while (await reader.ReadAsync()) { }
                }
            }

            bool success;
            if (explicitSuccess.HasValue)
                success = explicitSuccess.Value;
            else if (hasRow && treatAnyRowAsSuccess)
                success = true;
            else if (!hasRow)
                success = returnParam.Value is int rv && rv == 1; // fallback conservador
            else
                success = false;

            if (success)
                return AuthResult.Ok(username, string.IsNullOrWhiteSpace(displayName) ? null : displayName!.Trim(), false);

            return AuthResult.Fail("Usuario o contrasena incorrectos.");
        }
        catch (SqlException ex)
        {
            logger.LogError(ex, "Error de SQL Server al validar al usuario {user}.", username);
            return AuthResult.Fail("No se pudo validar el usuario contra el servidor corporativo. Intente nuevamente mas tarde.");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error inesperado al validar al usuario {user}.", username);
            return AuthResult.Fail("Ocurrio un error inesperado durante la autenticacion.");
        }
    }

    private static string EnsureAt(string p) => p.StartsWith('@') ? p : "@" + p;

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
