using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages;

public class IndexModel(IDashboardService dashboards, IUrlBuilder urlBuilder) : PageModel
{
    public List<DashboardCard> Cards { get; private set; } = new();
    public bool IsMaster { get; private set; }

    public async Task OnGetAsync()
    {
        IsMaster = User.IsInRole(AppConstants.Roles.Master);
        var username = User.Identity?.Name ?? string.Empty;

        var list = await dashboards.GetForUserAsync(username, IsMaster);
        foreach (var d in list)
        {
            Cards.Add(new DashboardCard(d, await urlBuilder.BuildAsync(d)));
        }
    }

    public record DashboardCard(Dashboard Dashboard, string Url);
}
