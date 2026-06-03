using System.ComponentModel.DataAnnotations;

namespace DashboardPortal.Models;

/// <summary>
/// Representa un dashboard publicado en un puerto del servidor.
/// La URL se construye automaticamente como {scheme}://{host}:{port}.
/// </summary>
public class Dashboard
{
    public int Id { get; set; }

    [Required(ErrorMessage = "El nombre es obligatorio.")]
    [StringLength(120, ErrorMessage = "El nombre admite hasta 120 caracteres.")]
    [Display(Name = "Nombre")]
    public string Name { get; set; } = string.Empty;

    [StringLength(500, ErrorMessage = "La descripcion admite hasta 500 caracteres.")]
    [Display(Name = "Descripcion")]
    public string? Description { get; set; }

    [Required(ErrorMessage = "El puerto es obligatorio.")]
    [Range(1, 65535, ErrorMessage = "El puerto debe estar entre 1 y 65535.")]
    [Display(Name = "Puerto")]
    public int Port { get; set; }

    /// <summary>
    /// Host opcional. Si esta vacio se usa el host global configurado o el host del propio portal.
    /// </summary>
    [StringLength(200)]
    [Display(Name = "Host (opcional)")]
    public string? Host { get; set; }

    /// <summary>
    /// URL completa opcional. Si se especifica tiene prioridad sobre Host + Puerto.
    /// </summary>
    [StringLength(500)]
    [Display(Name = "URL manual (opcional)")]
    public string? UrlOverride { get; set; }

    /// <summary>
    /// Clave del icono representativo (ver <see cref="Services.IconLibrary"/>).
    /// </summary>
    [StringLength(40)]
    [Display(Name = "Icono")]
    public string Icon { get; set; } = "chart";

    [Display(Name = "Estado")]
    public bool IsActive { get; set; } = true;

    [Display(Name = "Fecha de creacion")]
    public DateTime CreatedAt { get; set; }

    public ICollection<DashboardPermission> Permissions { get; set; } = new List<DashboardPermission>();
}
