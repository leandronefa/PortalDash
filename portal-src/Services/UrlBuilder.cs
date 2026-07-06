using DashboardPortal.Models;

namespace DashboardPortal.Services;

public interface IUrlBuilder
{
    Task<string> BuildAsync(Dashboard dashboard);
}

/// <summary>
/// Construye la URL pública de un dashboard. Con el proxy inverso del portal,
/// la URL es siempre relativa (/d/{id}/): el navegador nunca habla directo con
/// los puertos 3001..3010. UrlOverride (dashboards externos) se respeta tal cual.
/// </summary>
public class UrlBuilder : IUrlBuilder
{
    public Task<string> BuildAsync(Dashboard d)
    {
        if (!string.IsNullOrWhiteSpace(d.UrlOverride))
            return Task.FromResult(d.UrlOverride.Trim());

        return Task.FromResult($"/d/{d.Id}/");
    }
}
