using System.ComponentModel.DataAnnotations;

namespace DashboardPortal.Models;

/// <summary>
/// Usuario corporativo conocido por el portal. NO almacena contrasenas:
/// la validacion siempre ocurre contra SQL Server mediante el Stored Procedure.
/// Este registro solo existe para poder asignarle permisos sobre dashboards.
/// </summary>
public class AppUser
{
    public int Id { get; set; }

    [Required]
    [StringLength(150)]
    [Display(Name = "Usuario")]
    public string Username { get; set; } = string.Empty;

    [StringLength(200)]
    [Display(Name = "Nombre")]
    public string? DisplayName { get; set; }

    [Display(Name = "Activo")]
    public bool IsActive { get; set; } = true;

    [Display(Name = "Alta")]
    public DateTime CreatedAt { get; set; }

    [Display(Name = "Ultimo ingreso")]
    public DateTime? LastLoginAt { get; set; }

    public ICollection<DashboardPermission> Permissions { get; set; } = new List<DashboardPermission>();
}
