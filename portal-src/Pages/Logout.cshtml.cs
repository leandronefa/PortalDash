using DashboardPortal.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages;

public class LogoutModel(IAuthService auth) : PageModel
{
    public async Task<IActionResult> OnPostAsync()
    {
        var name = User.Identity?.Name ?? string.Empty;
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();

        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        await auth.LogAsync(name, "Logout", true, ip);

        return RedirectToPage("/Login");
    }

    // Acceso directo por GET: simplemente vuelve al login.
    public IActionResult OnGet() => RedirectToPage("/Login");
}
