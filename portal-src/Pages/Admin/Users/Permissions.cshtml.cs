using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages.Admin.Users;

public class PermissionsModel(
    IUserService users,
    IDashboardService dashboards,
    IPermissionService permissions) : PageModel
{
    public AppUser? AppUser { get; private set; }
    public List<Dashboard> AllDashboards { get; private set; } = new();
    public HashSet<int> Granted { get; private set; } = new();

    [BindProperty]
    public int Id { get; set; }

    [BindProperty]
    public List<int> Selected { get; set; } = new();

    public async Task<IActionResult> OnGetAsync(int id)
    {
        AppUser = await users.GetByIdAsync(id);
        if (AppUser is null)
        {
            TempData["Error"] = "El usuario solicitado no existe.";
            return RedirectToPage("Index");
        }

        Id = id;
        AllDashboards = await dashboards.GetAllAsync();
        Granted = await permissions.GetDashboardIdsForUserAsync(id);
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        var user = await users.GetByIdAsync(Id);
        if (user is null)
        {
            TempData["Error"] = "El usuario solicitado no existe.";
            return RedirectToPage("Index");
        }

        await permissions.SetPermissionsAsync(Id, Selected ?? new List<int>());
        TempData["Success"] = $"Permisos actualizados para «{user.Username}».";
        return RedirectToPage("Index");
    }
}
