using DashboardPortal.Data;
using DashboardPortal.Models;
using DashboardPortal.Services;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// Permite ejecutar como Servicio de Windows (no-op si se ejecuta como app de consola).
// Ajusta automaticamente el content root al directorio del ejecutable.
builder.Host.UseWindowsService(options => options.ServiceName = "DashboardPortal");

// ---------------------------------------------------------------------------
// Base de datos PROPIA de la aplicacion: SQLite (por defecto) o SQL Server.
// ---------------------------------------------------------------------------
var dbProvider = config["Database:Provider"] ?? "Sqlite";

// Carpeta para el archivo SQLite (se crea si no existe).
var dataDir = Path.Combine(builder.Environment.ContentRootPath, "App_Data");
Directory.CreateDirectory(dataDir);
var defaultSqliteConn = $"Data Source={Path.Combine(dataDir, "portal.db")}";

// Persistir las claves de DataProtection en disco para que las sesiones (cookies)
// sobrevivan a reinicios del servicio, sin depender del perfil de la cuenta.
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataDir, "keys")))
    .SetApplicationName("DashboardPortal");

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (string.Equals(dbProvider, "SqlServer", StringComparison.OrdinalIgnoreCase))
    {
        var cs = config.GetConnectionString("AppDatabase");
        if (string.IsNullOrWhiteSpace(cs))
            throw new InvalidOperationException("Database:Provider=SqlServer requiere ConnectionStrings:AppDatabase.");
        options.UseSqlServer(cs);
    }
    else
    {
        var cs = config.GetConnectionString("AppDatabase");
        options.UseSqlite(string.IsNullOrWhiteSpace(cs) ? defaultSqliteConn : cs);
    }
});

// ---------------------------------------------------------------------------
// Servicios de aplicacion.
// ---------------------------------------------------------------------------
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICorporateAuthService, CorporateAuthService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IDashboardService, DashboardService>();
builder.Services.AddScoped<IPermissionService, PermissionService>();
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<ISettingsService, SettingsService>();
builder.Services.AddScoped<IUrlBuilder, UrlBuilder>();

// ---------------------------------------------------------------------------
// Autenticacion por cookies + Autorizacion (politica solo Master).
// ---------------------------------------------------------------------------
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = "/Login";
        options.LogoutPath = "/Logout";
        options.AccessDeniedPath = "/AccessDenied";
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.SlidingExpiration = true;
        options.Cookie.Name = "DashboardPortal.Auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // compatible con HTTP en red local
        options.Cookie.IsEssential = true;
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(AppConstants.Policies.MasterOnly,
        policy => policy.RequireRole(AppConstants.Roles.Master));
});

// ---------------------------------------------------------------------------
// Razor Pages: autorizacion por convencion + Antiforgery (CSRF) global en POST.
// ---------------------------------------------------------------------------
builder.Services.AddRazorPages(options =>
{
    options.Conventions.AuthorizeFolder("/");                                  // todo requiere sesion
    options.Conventions.AllowAnonymousToPage("/Login");
    options.Conventions.AllowAnonymousToPage("/Error");
    options.Conventions.AuthorizeFolder("/Admin", AppConstants.Policies.MasterOnly); // solo Master
})
.AddMvcOptions(o => o.Filters.Add(new AutoValidateAntiforgeryTokenAttribute()));

builder.Services.AddAntiforgery(o => o.HeaderName = "X-CSRF-TOKEN");

var app = builder.Build();

// ---------------------------------------------------------------------------
// Inicializacion y seed de la base de datos propia.
// ---------------------------------------------------------------------------
using (var scope = app.Services.CreateScope())
{
    var sp = scope.ServiceProvider;
    var db = sp.GetRequiredService<AppDbContext>();
    db.Database.EnsureCreated();
    await DbSeeder.SeedAsync(sp);
}

// ---------------------------------------------------------------------------
// Pipeline HTTP.
// ---------------------------------------------------------------------------
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
}

// Cabeceras de seguridad.
app.Use(async (context, next) =>
{
    var h = context.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "SAMEORIGIN";              // evita clickjacking del portal
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h["X-XSS-Protection"] = "0";
    await next();
});

app.UseStaticFiles();
app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.MapRazorPages();

app.Run();
