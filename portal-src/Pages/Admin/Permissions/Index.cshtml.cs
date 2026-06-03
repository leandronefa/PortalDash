using DashboardPortal.Data;
using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace DashboardPortal.Pages.Admin.Permissions;

public class IndexModel(IUserService users, IDashboardService dashboards, AppDbContext db) : PageModel
{
    public List<AppUser> Users { get; private set; } = new();
    public List<Dashboard> Dashboards { get; private set; } = new();
    public HashSet<(int UserId, int DashboardId)> Grants { get; private set; } = new();

    public async Task OnGetAsync()
    {
        Users = await users.GetAllAsync();
        Dashboards = await dashboards.GetAllAsync();

        var perms = await db.Permissions.AsNoTracking()
            .Select(p => new { p.AppUserId, p.DashboardId })
            .ToListAsync();

        foreach (var p in perms)
            Grants.Add((p.AppUserId, p.DashboardId));
    }

    public bool HasGrant(int userId, int dashboardId) => Grants.Contains((userId, dashboardId));
}
