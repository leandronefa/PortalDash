using DashboardPortal.Data;
using DashboardPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace DashboardPortal.Services;

public interface IDashboardService
{
    Task<List<Dashboard>> GetAllAsync();
    Task<List<Dashboard>> GetActiveAsync();
    Task<Dashboard?> GetByIdAsync(int id);
    Task<List<Dashboard>> GetForUserAsync(string username, bool isMaster);
    Task<Dashboard> CreateAsync(Dashboard dashboard);
    Task UpdateAsync(Dashboard dashboard);
    Task DeleteAsync(int id);
    Task SetActiveAsync(int id, bool active);
    Task<int> CountAsync();
}

public class DashboardService(AppDbContext db) : IDashboardService
{
    public Task<List<Dashboard>> GetAllAsync() =>
        db.Dashboards.AsNoTracking().OrderBy(d => d.Name).ToListAsync();

    public Task<List<Dashboard>> GetActiveAsync() =>
        db.Dashboards.AsNoTracking().Where(d => d.IsActive).OrderBy(d => d.Name).ToListAsync();

    public Task<Dashboard?> GetByIdAsync(int id) =>
        db.Dashboards.FirstOrDefaultAsync(d => d.Id == id);

    public Task<List<Dashboard>> GetForUserAsync(string username, bool isMaster)
    {
        if (isMaster)
            return GetActiveAsync();

        var uname = Normalize(username);
        return db.Dashboards.AsNoTracking()
            .Where(d => d.IsActive && d.Permissions.Any(p => p.User!.Username == uname && p.User.IsActive))
            .OrderBy(d => d.Name)
            .ToListAsync();
    }

    public async Task<Dashboard> CreateAsync(Dashboard dashboard)
    {
        dashboard.CreatedAt = DateTime.Now;
        Sanitize(dashboard);
        db.Dashboards.Add(dashboard);
        await db.SaveChangesAsync();
        return dashboard;
    }

    public async Task UpdateAsync(Dashboard dashboard)
    {
        var existing = await db.Dashboards.FirstOrDefaultAsync(d => d.Id == dashboard.Id)
            ?? throw new InvalidOperationException("El dashboard no existe.");

        existing.Name = dashboard.Name.Trim();
        existing.Description = dashboard.Description?.Trim();
        existing.Port = dashboard.Port;
        existing.Host = string.IsNullOrWhiteSpace(dashboard.Host) ? null : dashboard.Host.Trim();
        existing.UrlOverride = string.IsNullOrWhiteSpace(dashboard.UrlOverride) ? null : dashboard.UrlOverride.Trim();
        existing.Icon = string.IsNullOrWhiteSpace(dashboard.Icon) ? "chart" : dashboard.Icon.Trim();
        existing.IsActive = dashboard.IsActive;

        await db.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var d = await db.Dashboards.FirstOrDefaultAsync(x => x.Id == id);
        if (d is null) return;
        db.Dashboards.Remove(d); // los permisos se eliminan en cascada
        await db.SaveChangesAsync();
    }

    public async Task SetActiveAsync(int id, bool active)
    {
        var d = await db.Dashboards.FirstOrDefaultAsync(x => x.Id == id);
        if (d is null) return;
        d.IsActive = active;
        await db.SaveChangesAsync();
    }

    public Task<int> CountAsync() => db.Dashboards.CountAsync();

    private static void Sanitize(Dashboard d)
    {
        d.Name = d.Name.Trim();
        d.Description = d.Description?.Trim();
        d.Host = string.IsNullOrWhiteSpace(d.Host) ? null : d.Host.Trim();
        d.UrlOverride = string.IsNullOrWhiteSpace(d.UrlOverride) ? null : d.UrlOverride.Trim();
        d.Icon = string.IsNullOrWhiteSpace(d.Icon) ? "chart" : d.Icon.Trim();
    }

    private static string Normalize(string username) => (username ?? string.Empty).Trim().ToLowerInvariant();
}
