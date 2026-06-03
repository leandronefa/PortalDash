using System.ComponentModel.DataAnnotations;
using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages.Admin.Users;

public class IndexModel(IUserService users, IPermissionService permissions) : PageModel
{
    public List<Row> Rows { get; private set; } = new();

    [BindProperty(SupportsGet = true)]
    public string? Q { get; set; }

    [BindProperty]
    public NewUserInput Input { get; set; } = new();

    public record Row(AppUser User, int PermissionCount);

    public class NewUserInput
    {
        [Required(ErrorMessage = "Ingrese el nombre de usuario corporativo.")]
        [StringLength(150)]
        [Display(Name = "Usuario corporativo")]
        public string Username { get; set; } = string.Empty;

        [StringLength(200)]
        [Display(Name = "Nombre (opcional)")]
        public string? DisplayName { get; set; }
    }

    public async Task OnGetAsync() => await LoadAsync();

    public async Task<IActionResult> OnPostAddAsync()
    {
        if (string.IsNullOrWhiteSpace(Input.Username))
        {
            TempData["Error"] = "Ingrese el nombre de usuario corporativo.";
            return RedirectToPage(new { Q });
        }

        var (created, user) = await users.CreateAsync(Input.Username, Input.DisplayName);
        TempData[created ? "Success" : "Error"] = created
            ? $"Usuario «{user.Username}» agregado. Asígnele dashboards desde Permisos."
            : $"El usuario «{user.Username}» ya existe.";
        return RedirectToPage(new { Q });
    }

    public async Task<IActionResult> OnPostToggleAsync(int id, bool active)
    {
        await users.SetActiveAsync(id, active);
        TempData["Success"] = active ? "Usuario habilitado." : "Usuario deshabilitado.";
        return RedirectToPage(new { Q });
    }

    public async Task<IActionResult> OnPostDeleteAsync(int id)
    {
        await users.DeleteAsync(id);
        TempData["Success"] = "Usuario y sus permisos eliminados.";
        return RedirectToPage(new { Q });
    }

    private async Task LoadAsync()
    {
        var list = await users.GetAllAsync(Q);
        Rows.Clear();
        foreach (var u in list)
            Rows.Add(new Row(u, await permissions.CountForUserAsync(u.Id)));
    }
}
