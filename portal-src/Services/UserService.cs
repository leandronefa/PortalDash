using DashboardPortal.Data;
using DashboardPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace DashboardPortal.Services;

public interface IUserService
{
    Task<List<AppUser>> GetAllAsync(string? search = null);
    Task<AppUser?> GetByIdAsync(int id);
    Task<AppUser?> GetByUsernameAsync(string username);
    Task<AppUser> EnsureExistsAsync(string username, string? displayName = null);
    Task<(bool created, AppUser user)> CreateAsync(string username, string? displayName);
    Task SetActiveAsync(int id, bool active);
    Task DeleteAsync(int id);
    Task UpdateLastLoginAsync(string username);
    Task<int> CountAsync();
}

/// <summary>
/// Gestion de usuarios corporativos conocidos por el portal (para asignarles permisos).
/// El nombre de usuario se normaliza a minusculas para una coincidencia consistente.
/// </summary>
public class UserService(AppDbContext db) : IUserService
{
    public Task<List<AppUser>> GetAllAsync(string? search = null)
    {
        var q = db.Users.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            q = q.Where(u => u.Username.Contains(s) || (u.DisplayName != null && u.DisplayName.ToLower().Contains(s)));
        }
        return q.OrderBy(u => u.Username).ToListAsync();
    }

    public Task<AppUser?> GetByIdAsync(int id) =>
        db.Users.FirstOrDefaultAsync(u => u.Id == id);

    public Task<AppUser?> GetByUsernameAsync(string username)
    {
        var uname = Normalize(username);
        return db.Users.FirstOrDefaultAsync(u => u.Username == uname);
    }

    public async Task<AppUser> EnsureExistsAsync(string username, string? displayName = null)
    {
        var uname = Normalize(username);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Username == uname);
        if (user is not null)
        {
            if (!string.IsNullOrWhiteSpace(displayName) && string.IsNullOrWhiteSpace(user.DisplayName))
            {
                user.DisplayName = displayName.Trim();
                await db.SaveChangesAsync();
            }
            return user;
        }

        user = new AppUser
        {
            Username = uname,
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? null : displayName.Trim(),
            IsActive = true,
            CreatedAt = DateTime.Now
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    public async Task<(bool created, AppUser user)> CreateAsync(string username, string? displayName)
    {
        var uname = Normalize(username);
        var existing = await db.Users.FirstOrDefaultAsync(u => u.Username == uname);
        if (existing is not null)
            return (false, existing);

        var user = new AppUser
        {
            Username = uname,
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? null : displayName.Trim(),
            IsActive = true,
            CreatedAt = DateTime.Now
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return (true, user);
    }

    public async Task SetActiveAsync(int id, bool active)
    {
        var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id);
        if (u is null) return;
        u.IsActive = active;
        await db.SaveChangesAsync();
    }

    public async Task DeleteAsync(int id)
    {
        var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id);
        if (u is null) return;
        db.Users.Remove(u); // permisos en cascada
        await db.SaveChangesAsync();
    }

    public async Task UpdateLastLoginAsync(string username)
    {
        var uname = Normalize(username);
        var u = await db.Users.FirstOrDefaultAsync(x => x.Username == uname);
        if (u is null) return;
        u.LastLoginAt = DateTime.Now;
        await db.SaveChangesAsync();
    }

    public Task<int> CountAsync() => db.Users.CountAsync();

    private static string Normalize(string username) => (username ?? string.Empty).Trim().ToLowerInvariant();
}
