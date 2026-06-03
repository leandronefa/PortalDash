using DashboardPortal.Data;
using DashboardPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace DashboardPortal.Services;

public interface ISettingsService
{
    Task<string?> GetAsync(string key, string? defaultValue = null);
    Task SetAsync(string key, string? value);
    Task<Dictionary<string, string?>> GetAllAsync();
}

/// <summary>
/// Configuracion editable persistida en la BD propia (clave/valor).
/// </summary>
public class SettingsService(AppDbContext db) : ISettingsService
{
    public async Task<string?> GetAsync(string key, string? defaultValue = null)
    {
        var s = await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == key);
        return s?.Value ?? defaultValue;
    }

    public async Task SetAsync(string key, string? value)
    {
        var s = await db.Settings.FirstOrDefaultAsync(x => x.Key == key);
        if (s is null)
        {
            db.Settings.Add(new AppSetting { Key = key, Value = value });
        }
        else
        {
            s.Value = value;
        }
        await db.SaveChangesAsync();
    }

    public async Task<Dictionary<string, string?>> GetAllAsync()
    {
        return await db.Settings.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Value);
    }
}
