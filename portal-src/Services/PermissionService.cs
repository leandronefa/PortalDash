using DashboardPortal.Data;
using DashboardPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace DashboardPortal.Services;

public interface IPermissionService
{
    Task<bool> CanAccessAsync(string username, bool isMaster, int dashboardId);
    Task<HashSet<int>> GetDashboardIdsForUserAsync(int appUserId);
    Task SetPermissionsAsync(int appUserId, IEnumerable<int> dashboardIds);
    Task<int> CountForUserAsync(int appUserId);
}

/// <summary>
/// Modelo de permisos simple: existe el registro = puede ver; no existe = no puede ver.
/// </summary>
public class PermissionService(AppDbContext db) : IPermissionService
{
    public async Task<bool> CanAccessAsync(string username, bool isMaster, int dashboardId)
    {
        // El dashboard debe existir y estar activo para cualquiera.
        var active = await db.Dashboards.AnyAsync(d => d.Id == dashboardId && d.IsActive);
        if (!active) return false;

        if (isMaster) return true;

        var uname = (username ?? string.Empty).Trim().ToLowerInvariant();
        return await db.Permissions.AnyAsync(p =>
            p.DashboardId == dashboardId &&
            p.User!.Username == uname &&
            p.User.IsActive);
    }

    public async Task<HashSet<int>> GetDashboardIdsForUserAsync(int appUserId)
    {
        var ids = await db.Permissions
            .Where(p => p.AppUserId == appUserId)
            .Select(p => p.DashboardId)
            .ToListAsync();
        return ids.ToHashSet();
    }

    public async Task SetPermissionsAsync(int appUserId, IEnumerable<int> dashboardIds)
    {
        var desired = dashboardIds.Distinct().ToHashSet();

        var current = await db.Permissions.Where(p => p.AppUserId == appUserId).ToListAsync();
        var currentIds = current.Select(p => p.DashboardId).ToHashSet();

        // Quitar los que ya no estan
        var toRemove = current.Where(p => !desired.Contains(p.DashboardId)).ToList();
        if (toRemove.Count > 0)
            db.Permissions.RemoveRange(toRemove);

        // Agregar los nuevos (validando que el dashboard exista)
        var toAdd = desired.Where(id => !currentIds.Contains(id)).ToList();
        if (toAdd.Count > 0)
        {
            var validIds = await db.Dashboards.Where(d => toAdd.Contains(d.Id)).Select(d => d.Id).ToListAsync();
            foreach (var id in validIds)
            {
                db.Permissions.Add(new DashboardPermission
                {
                    AppUserId = appUserId,
                    DashboardId = id,
                    GrantedAt = DateTime.Now
                });
            }
        }

        await db.SaveChangesAsync();
    }

    public Task<int> CountForUserAsync(int appUserId) =>
        db.Permissions.CountAsync(p => p.AppUserId == appUserId);
}
