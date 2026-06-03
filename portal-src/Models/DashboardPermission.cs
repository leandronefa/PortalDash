namespace DashboardPortal.Models;

/// <summary>
/// Permiso simple (puede ver / no puede ver). La existencia del registro = acceso concedido.
/// </summary>
public class DashboardPermission
{
    public int Id { get; set; }

    public int AppUserId { get; set; }
    public AppUser? User { get; set; }

    public int DashboardId { get; set; }
    public Dashboard? Dashboard { get; set; }

    public DateTime GrantedAt { get; set; }
}
