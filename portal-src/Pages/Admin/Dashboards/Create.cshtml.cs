using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages.Admin.Dashboards;

public class CreateModel(IDashboardService dashboards) : PageModel
{
    [BindProperty]
    public Dashboard Input { get; set; } = new() { Icon = "chart", IsActive = true, Port = 8501 };

    public static IReadOnlyList<(string Key, string Label)> Icons => IconLibrary.Options;

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        if (!ModelState.IsValid)
            return Page();

        await dashboards.CreateAsync(Input);
        TempData["Success"] = $"Dashboard «{Input.Name}» creado correctamente.";
        return RedirectToPage("Index");
    }
}
