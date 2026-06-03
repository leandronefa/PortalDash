using System.Security.Claims;
using DashboardPortal.Data;
using DashboardPortal.Models;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace DashboardPortal.Services;

public interface IAuthService
{
    Task<AuthResult> AuthenticateAsync(string username, string password, string? ip);
    ClaimsPrincipal BuildPrincipal(AuthResult result);
    Task LogAsync(string username, string action, bool success, string? ip, int? dashboardId = null, string? detail = null);
}

/// <summary>
/// Orquesta el inicio de sesion: primero el usuario Master local, luego el SP corporativo.
/// Crea/actualiza el usuario local y registra auditoria.
/// </summary>
public class AuthService(
    IConfiguration config,
    ICorporateAuthService corporate,
    IUserService users,
    AppDbContext db,
    ILogger<AuthService> logger) : IAuthService
{
    public async Task<AuthResult> AuthenticateAsync(string username, string password, string? ip)
    {
        username = (username ?? string.Empty).Trim();
        password ??= string.Empty;

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
            return AuthResult.Fail("Ingrese usuario y contrasena.");

        var masterUser = config["Master:Username"] ?? "admin";
        var masterPass = config["Master:Password"] ?? "admin";

        AuthResult result;

        if (string.Equals(username, masterUser, StringComparison.OrdinalIgnoreCase))
        {
            // Usuario Master local, independiente de SQL Server.
            result = string.Equals(password, masterPass, StringComparison.Ordinal)
                ? AuthResult.Ok(masterUser, "Administrador", isMaster: true)
                : AuthResult.Fail("Usuario o contrasena incorrectos.");
        }
        else
        {
            // Usuario corporativo: validado SOLO por el Stored Procedure.
            result = await corporate.ValidateAsync(username, password);

            if (result.Success)
            {
                var appUser = await users.EnsureExistsAsync(username, result.DisplayName);
                if (!appUser.IsActive)
                {
                    result = AuthResult.Fail("El usuario esta deshabilitado en el portal. Contacte al administrador.");
                }
                else
                {
                    await users.UpdateLastLoginAsync(username);
                    if (string.IsNullOrWhiteSpace(result.DisplayName))
                        result.DisplayName = appUser.DisplayName ?? username;
                }
            }
        }

        await LogAsync(username, result.Success ? "Login" : "LoginFailed", result.Success, ip, detail: result.Success ? null : result.Message);
        if (result.Success)
            logger.LogInformation("Inicio de sesion correcto: {user} (master={master}).", username, result.IsMaster);

        return result;
    }

    public ClaimsPrincipal BuildPrincipal(AuthResult r)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, r.Username),
            new(ClaimTypes.Role, r.IsMaster ? AppConstants.Roles.Master : AppConstants.Roles.User),
            new(AppConstants.Claims.DisplayName, r.DisplayName ?? r.Username),
            new(AppConstants.Claims.IsMaster, r.IsMaster ? "true" : "false")
        };

        var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
        return new ClaimsPrincipal(identity);
    }

    public async Task LogAsync(string username, string action, bool success, string? ip, int? dashboardId = null, string? detail = null)
    {
        try
        {
            db.AccessLogs.Add(new AccessLog
            {
                Username = (username ?? string.Empty).Trim(),
                Action = action,
                Success = success,
                IpAddress = ip,
                DashboardId = dashboardId,
                Detail = detail,
                Timestamp = DateTime.Now
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "No se pudo registrar la auditoria de acceso.");
        }
    }
}
