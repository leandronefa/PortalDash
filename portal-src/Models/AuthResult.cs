namespace DashboardPortal.Models;

/// <summary>
/// Resultado de un intento de autenticacion (master local o usuario corporativo via SP).
/// </summary>
public class AuthResult
{
    public bool Success { get; set; }
    public string Username { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public bool IsMaster { get; set; }
    public string? Message { get; set; }

    public static AuthResult Fail(string message) => new() { Success = false, Message = message };

    public static AuthResult Ok(string username, string? displayName, bool isMaster) => new()
    {
        Success = true,
        Username = username,
        DisplayName = displayName,
        IsMaster = isMaster
    };
}
