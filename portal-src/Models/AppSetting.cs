using System.ComponentModel.DataAnnotations;

namespace DashboardPortal.Models;

/// <summary>
/// Configuracion editable de la aplicacion (clave/valor), persistida en la BD propia.
/// </summary>
public class AppSetting
{
    [Key]
    [StringLength(100)]
    public string Key { get; set; } = string.Empty;

    [StringLength(1000)]
    public string? Value { get; set; }
}
