using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages.Admin.Dashboards;

public class DeleteModel(IDashboardService dashboards) : PageModel
{
    public Dashboard? Dashboard { get; private set; }

    public async Task<IActionResult> OnGetAsync(int id)
    {
        Dashboard = await dashboards.GetByIdAsync(id);
        if (Dashboard is null)
        {
            TempData["Error"] = "El dashboard solicitado no existe.";
            return RedirectToPage("Index");
        }
        return Page();
    }

    public async Task<IActionResult> OnPostAsync(int id)
    {
        var d = await dashboards.GetByIdAsync(id);
        var name = d?.Name ?? "dashboard";
        await dashboards.DeleteAsync(id);
        TempData["Success"] = $"Se eliminó «{name}» y sus permisos asociados.";
        return RedirectToPage("Index");
    }
}
