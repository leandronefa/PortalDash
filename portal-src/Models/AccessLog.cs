using System.ComponentModel.DataAnnotations;

namespace DashboardPortal.Models;

/// <summary>
/// Registro de auditoria de accesos y acciones de seguridad.
/// </summary>
public class AccessLog
{
    public int Id { get; set; }

    [StringLength(150)]
    public string Username { get; set; } = string.Empty;

    /// <summary>Login, LoginFailed, Logout, OpenDashboard, AccessDenied, etc.</summary>
    [StringLength(60)]
    public string Action { get; set; } = string.Empty;

    public int? DashboardId { get; set; }

    [StringLength(300)]
    public string? Detail { get; set; }

    [StringLength(60)]
    public string? IpAddress { get; set; }

    public bool Success { get; set; }

    public DateTime Timestamp { get; set; }
}
