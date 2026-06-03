using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages;

public class AccessDeniedModel : PageModel
{
    [BindProperty(SupportsGet = true)]
    public int? Id { get; set; }

    public void OnGet()
    {
        // No se expone el nombre del dashboard para no filtrar informacion.
    }
}
