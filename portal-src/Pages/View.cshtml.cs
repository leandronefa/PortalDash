using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages;

public class ViewModel(
    IDashboardService dashboards,
    IPermissionService permissions,
    IUrlBuilder urlBuilder,
    IAuthService auth) : PageModel
{
    public Dashboard? Dashboard { get; private set; }
    public string? DashboardUrl { get; private set; }

    public async Task<IActionResult> OnGetAsync(int id)
    {
        var isMaster = User.IsInRole(AppConstants.Roles.Master);
        var username = User.Identity?.Name ?? string.Empty;
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();

        // Validacion de permisos ANTES de exponer la URL del dashboard.
        var allowed = await permissions.CanAccessAsync(username, isMaster, id);
        if (!allowed)
        {
            await auth.LogAsync(username, "AccessDenied", false, ip, id, "Acceso a dashboard sin permiso o inactivo.");
            return RedirectToPage("/AccessDenied", new { id });
        }

        Dashboard = await dashboards.GetByIdAsync(id);
        if (Dashboard is null)
            return RedirectToPage("/AccessDenied");

        DashboardUrl = await urlBuilder.BuildAsync(Dashboard);
        await auth.LogAsync(username, "OpenDashboard", true, ip, id, Dashboard.Name);

        ViewData["FullBleed"] = true;
        ViewData["Title"] = Dashboard.Name;
        return Page();
    }
}
