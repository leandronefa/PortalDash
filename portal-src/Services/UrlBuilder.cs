using DashboardPortal.Models;

namespace DashboardPortal.Services;

public interface IUrlBuilder
{
    Task<string> BuildAsync(Dashboard dashboard);
}

/// <summary>
/// Construye la URL final de un dashboard: {scheme}://{host}:{port}.
/// Prioridad del host: URL manual > Host del dashboard > Host global configurado > Host del propio portal.
/// </summary>
public class UrlBuilder(ISettingsService settings, IHttpContextAccessor http) : IUrlBuilder
{
    public async Task<string> BuildAsync(Dashboard d)
    {
        if (!string.IsNullOrWhiteSpace(d.UrlOverride))
            return d.UrlOverride.Trim();

        var scheme = (await settings.GetAsync(AppConstants.Settings.DefaultScheme, "http"))?.Trim();
        if (string.IsNullOrWhiteSpace(scheme)) scheme = "http";

        var configuredHost = (await settings.GetAsync(AppConstants.Settings.ServerHost, string.Empty))?.Trim();

        string host;
        if (!string.IsNullOrWhiteSpace(d.Host))
            host = d.Host.Trim();
        else if (!string.IsNullOrWhiteSpace(configuredHost))
            host = configuredHost;
        else
            host = http.HttpContext?.Request.Host.Host ?? "localhost";

        return $"{scheme}://{host}:{d.Port}";
    }
}
