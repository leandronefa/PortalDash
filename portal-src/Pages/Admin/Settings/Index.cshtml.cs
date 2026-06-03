using System.ComponentModel.DataAnnotations;
using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages.Admin.Settings;

public class IndexModel(ISettingsService settings) : PageModel
{
    [BindProperty]
    public InputModel Input { get; set; } = new();

    public class InputModel
    {
        [StringLength(100)]
        [Display(Name = "Título del portal")]
        public string? PortalTitle { get; set; }

        [StringLength(200)]
        [Display(Name = "Host del servidor")]
        public string? ServerHost { get; set; }

        [Display(Name = "Esquema")]
        public string DefaultScheme { get; set; } = "http";
    }

    public async Task OnGetAsync()
    {
        Input.PortalTitle = await settings.GetAsync(AppConstants.Settings.PortalTitle, "Portal de Dashboards");
        Input.ServerHost = await settings.GetAsync(AppConstants.Settings.ServerHost, string.Empty);
        Input.DefaultScheme = await settings.GetAsync(AppConstants.Settings.DefaultScheme, "http") ?? "http";
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (!ModelState.IsValid)
            return Page();

        await settings.SetAsync(AppConstants.Settings.PortalTitle,
            string.IsNullOrWhiteSpace(Input.PortalTitle) ? "Portal de Dashboards" : Input.PortalTitle.Trim());
        await settings.SetAsync(AppConstants.Settings.ServerHost, Input.ServerHost?.Trim() ?? string.Empty);
        await settings.SetAsync(AppConstants.Settings.DefaultScheme,
            Input.DefaultScheme == "https" ? "https" : "http");

        TempData["Success"] = "Configuración guardada.";
        return RedirectToPage();
    }
}
