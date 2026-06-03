using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages.Admin.Dashboards;

public class IndexModel(IDashboardService dashboards, IUrlBuilder urlBuilder) : PageModel
{
    public List<Row> Rows { get; private set; } = new();

    public record Row(Dashboard Dashboard, string Url);

    public async Task OnGetAsync()
    {
        var list = await dashboards.GetAllAsync();
        foreach (var d in list)
            Rows.Add(new Row(d, await urlBuilder.BuildAsync(d)));
    }

    public async Task<IActionResult> OnPostToggleAsync(int id, bool active)
    {
        await dashboards.SetActiveAsync(id, active);
        TempData["Success"] = active ? "Dashboard activado." : "Dashboard desactivado.";
        return RedirectToPage();
    }
}
