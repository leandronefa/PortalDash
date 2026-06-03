using DashboardPortal.Data;
using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace DashboardPortal.Pages.Admin;

public class IndexModel(IDashboardService dashboards, IUserService users, AppDbContext db) : PageModel
{
    public int DashboardCount { get; private set; }
    public int ActiveDashboardCount { get; private set; }
    public int UserCount { get; private set; }
    public int PermissionCount { get; private set; }
    public List<AccessLog> RecentLogs { get; private set; } = new();

    public async Task OnGetAsync()
    {
        var all = await dashboards.GetAllAsync();
        DashboardCount = all.Count;
        ActiveDashboardCount = all.Count(d => d.IsActive);
        UserCount = await users.CountAsync();
        PermissionCount = await db.Permissions.CountAsync();
        RecentLogs = await db.AccessLogs.AsNoTracking()
            .OrderByDescending(l => l.Timestamp)
            .Take(12)
            .ToListAsync();
    }
}
