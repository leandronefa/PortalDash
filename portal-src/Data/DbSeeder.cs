using DashboardPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace DashboardPortal.Data;

/// <summary>
/// Inicializa la base de datos con configuracion por defecto y dashboards de ejemplo.
/// </summary>
public static class DbSeeder
{
    public static async Task SeedAsync(IServiceProvider services)
    {
        var db = services.GetRequiredService<AppDbContext>();
        var config = services.GetRequiredService<IConfiguration>();
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DbSeeder");

        // 1) Configuracion editable (sembrada desde appsettings la primera vez)
        await EnsureSettingAsync(db, AppConstants.Settings.PortalTitle,
            config["Portal:Title"] ?? "Portal de Dashboards");
        await EnsureSettingAsync(db, AppConstants.Settings.ServerHost,
            config["Portal:ServerHost"] ?? string.Empty);
        await EnsureSettingAsync(db, AppConstants.Settings.DefaultScheme,
            config["Portal:DefaultScheme"] ?? "http");

        // 2) Dashboards de ejemplo (solo si la tabla esta vacia)
        if (!await db.Dashboards.AnyAsync())
        {
            var now = DateTime.Now;
            db.Dashboards.AddRange(
                new Dashboard { Name = "Dashboard Ventas", Description = "Indicadores comerciales y de facturacion.", Port = 8501, Icon = "sales", IsActive = true, CreatedAt = now },
                new Dashboard { Name = "Dashboard RRHH", Description = "Personal, ausentismo y nomina.", Port = 8502, Icon = "people", IsActive = true, CreatedAt = now },
                new Dashboard { Name = "Dashboard Finanzas", Description = "Tesoreria, flujo de fondos y resultados.", Port = 8503, Icon = "finance", IsActive = true, CreatedAt = now }
            );
            await db.SaveChangesAsync();
            logger.LogInformation("Sembrados dashboards de ejemplo (Ventas, RRHH, Finanzas).");
        }
    }

    private static async Task EnsureSettingAsync(AppDbContext db, string key, string? value)
    {
        if (!await db.Settings.AnyAsync(s => s.Key == key))
        {
            db.Settings.Add(new AppSetting { Key = key, Value = value });
            await db.SaveChangesAsync();
        }
    }
}
