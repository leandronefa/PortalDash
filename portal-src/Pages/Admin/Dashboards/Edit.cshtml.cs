using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages.Admin.Dashboards;

public class EditModel(IDashboardService dashboards) : PageModel
{
    [BindProperty]
    public Dashboard Input { get; set; } = new();

    public IReadOnlyList<(string Key, string Label)> Icons => IconLibrary.Options;

    public async Task<IActionResult> OnGetAsync(int id)
    {
        var d = await dashboards.GetByIdAsync(id);
        if (d is null)
        {
            TempData["Error"] = "El dashboard solicitado no existe.";
            return RedirectToPage("Index");
        }
        Input = d;
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (!ModelState.IsValid)
            return Page();

        await dashboards.UpdateAsync(Input);
        TempData["Success"] = $"Dashboard «{Input.Name}» actualizado.";
        return RedirectToPage("Index");
    }
}
