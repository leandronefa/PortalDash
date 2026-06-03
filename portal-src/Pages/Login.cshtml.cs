using System.ComponentModel.DataAnnotations;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace DashboardPortal.Pages;

[AllowAnonymous]
public class LoginModel(IAuthService auth) : PageModel
{
    [BindProperty]
    public InputModel Input { get; set; } = new();

    [BindProperty(SupportsGet = true)]
    public string? ReturnUrl { get; set; }

    public string? ErrorMessage { get; set; }

    public class InputModel
    {
        [Required(ErrorMessage = "Ingrese su usuario.")]
        [StringLength(150)]
        [Display(Name = "Usuario")]
        public string Username { get; set; } = string.Empty;

        [Required(ErrorMessage = "Ingrese su contraseña.")]
        [DataType(DataType.Password)]
        [Display(Name = "Contraseña")]
        public string Password { get; set; } = string.Empty;
    }

    public IActionResult OnGet()
    {
        if (User.Identity?.IsAuthenticated == true)
            return LocalRedirect(SafeReturnUrl());
        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (!ModelState.IsValid)
            return Page();

        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        var result = await auth.AuthenticateAsync(Input.Username, Input.Password, ip);

        if (!result.Success)
        {
            ErrorMessage = result.Message ?? "No se pudo iniciar sesión.";
            ModelState.AddModelError(string.Empty, ErrorMessage);
            return Page();
        }

        var principal = auth.BuildPrincipal(result);
        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            principal,
            new AuthenticationProperties
            {
                IsPersistent = false,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(8)
            });

        return LocalRedirect(SafeReturnUrl());
    }

    private string SafeReturnUrl()
    {
        if (!string.IsNullOrWhiteSpace(ReturnUrl) && Url.IsLocalUrl(ReturnUrl))
            return ReturnUrl!;
        return "/";
    }
}
