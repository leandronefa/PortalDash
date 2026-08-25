using System.Net;
using DashboardPortal.Models;
using Microsoft.AspNetCore.Http.Features;
using Yarp.ReverseProxy.Forwarder;

namespace DashboardPortal.Services;

/// <summary>
/// Proxy inverso hacia los dashboards Node. El navegador ya no habla con los
/// puertos 3001..3010: toda petición entra por el portal (puerto 80) y pasa por
/// la sesión + permisos antes de reenviarse.
///
/// Rutas:
///  - /d/{id}/{**rest}  → entrada explícita a un dashboard. Valida permiso,
///    setea la cookie de "dashboard activo" y reenvía a 127.0.0.1:{puerto}.
///  - Fallback (todo lo que no matchea páginas/estáticos del portal) → las apps
///    Node piden rutas absolutas (/api/..., /assets/...) sin el prefijo /d/{id};
///    la cookie de dashboard activo indica a cuál reenviarlas.
/// </summary>
public static class DashboardProxy
{
    public const string ActiveDashCookie = "DashboardPortal.ActiveDash";

    private static readonly HttpMessageInvoker Client = new(new SocketsHttpHandler
    {
        UseProxy = false,
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.None,
        UseCookies = false,
        ConnectTimeout = TimeSpan.FromSeconds(15),
    });

    // ActivityTimeout alto: tolera SSE, long-polling y descargas grandes.
    private static readonly ForwarderRequestConfig RequestConfig = new()
    {
        ActivityTimeout = TimeSpan.FromMinutes(10),
    };

    public static void Map(WebApplication app)
    {
        app.Map("/d/{id:int}/{**rest}", HandleEntry).RequireAuthorization();
        // Patrón explícito: el default de MapFallback es {*path:nonfile}, que
        // excluye URLs con extensión (.js/.css) y rompía los assets de las SPAs.
        app.MapFallback("{**path}", HandleFallback).RequireAuthorization();
    }

    /// <summary>Entrada explícita: /d/{id}/... (la URL que abre cada tarjeta del catálogo, en pestaña nueva).</summary>
    private static async Task HandleEntry(
        HttpContext ctx, int id, string? rest,
        IDashboardService dashboards, IPermissionService permissions, IHttpForwarder forwarder, IAuthService auth)
    {
        var dash = await AuthorizeAsync(ctx, id, dashboards, permissions);
        if (dash is null) return;

        // Solo se loguea en la raíz del dashboard (rest vacío): evita spamear
        // el log con cada asset/api que la SPA pide bajo el mismo prefijo.
        if (string.IsNullOrEmpty(rest))
        {
            var username = ctx.User.Identity?.Name ?? string.Empty;
            var ip = ctx.Connection.RemoteIpAddress?.ToString();
            await auth.LogAsync(username, "OpenDashboard", true, ip, id, dash.Name);
        }

        if (!string.IsNullOrWhiteSpace(dash.UrlOverride))
        {
            ctx.Response.Redirect(dash.UrlOverride.Trim());
            return;
        }

        // Cookie de dashboard activo para poder rutear las peticiones absolutas
        // (/api, /assets) que la app hace sin el prefijo /d/{id}.
        ctx.Response.Cookies.Append(ActiveDashCookie, id.ToString(), new CookieOptions
        {
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
            Secure = ctx.Request.IsHttps,
            IsEssential = true,
            Path = "/",
        });

        ctx.Request.Path = "/" + (rest ?? string.Empty);
        await ForwardAsync(ctx, dash, forwarder);
    }

    /// <summary>Peticiones absolutas de la app activa (no matchearon nada del portal).</summary>
    private static async Task HandleFallback(
        HttpContext ctx,
        IDashboardService dashboards, IPermissionService permissions, IHttpForwarder forwarder)
    {
        if (!ctx.Request.Cookies.TryGetValue(ActiveDashCookie, out var raw) || !int.TryParse(raw, out var id))
        {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        var dash = await AuthorizeAsync(ctx, id, dashboards, permissions);
        if (dash is null) return;

        await ForwardAsync(ctx, dash, forwarder);
    }

    /// <summary>Valida permiso del usuario sobre el dashboard. Escribe la respuesta y devuelve null si no puede.</summary>
    private static async Task<Dashboard?> AuthorizeAsync(
        HttpContext ctx, int id, IDashboardService dashboards, IPermissionService permissions)
    {
        var isMaster = ctx.User.IsInRole(AppConstants.Roles.Master);
        var username = ctx.User.Identity?.Name ?? string.Empty;

        if (!await permissions.CanAccessAsync(username, isMaster, id))
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            return null;
        }

        var dash = await dashboards.GetByIdAsync(id);
        if (dash is null)
        {
            ctx.Response.StatusCode = StatusCodes.Status404NotFound;
            return null;
        }
        return dash;
    }

    private static async Task ForwardAsync(HttpContext ctx, Dashboard dash, IHttpForwarder forwarder)
    {
        // Los dashboards pueden recibir uploads grandes; el límite lo pone la app destino.
        var sizeFeature = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (sizeFeature is { IsReadOnly: false })
            sizeFeature.MaxRequestBodySize = null;

        var host = string.IsNullOrWhiteSpace(dash.Host) ? "127.0.0.1" : dash.Host.Trim();
        var destination = $"http://{host}:{dash.Port}";

        var error = await forwarder.SendAsync(ctx, destination, Client, RequestConfig);
        if (error != ForwarderError.None && !ctx.Response.HasStarted)
        {
            ctx.Response.StatusCode = StatusCodes.Status502BadGateway;
            await ctx.Response.WriteAsync($"El dashboard '{dash.Name}' no respondió ({error}).");
        }
    }
}
