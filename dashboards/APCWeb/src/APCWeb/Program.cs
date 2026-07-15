using System.Collections.Concurrent;
using System.Data;
using System.Globalization;
using System.Security.Claims;
using APCWeb.Data;
using APCWeb.Domain;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;

// Cultura es-AR fija: los CSV deben salir byte a byte iguales a los de la Desktop
// (coma decimal, fechas d/M/yyyy). NO cambiar.
var esAR = CultureInfo.GetCultureInfo("es-AR");
CultureInfo.DefaultThreadCurrentCulture = esAR;
CultureInfo.DefaultThreadCurrentUICulture = esAR;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWindowsService();

builder.Services.AddSingleton<Db>();
builder.Services.AddSingleton<APCWeb.Data.UncShares>();
builder.Services.AddSingleton<ValidacionService>();
builder.Services.AddSingleton<LiquiService>();

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "apcweb.auth";
        o.ExpireTimeSpan = TimeSpan.FromHours(10);
        o.SlidingExpiration = true;
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

// Los errores de negocio viajan a la UI como 400 + mensaje (equivalente a los MsgBox)
app.Use(async (ctx, next) =>
{
    try { await next(); }
    catch (Exception ex)
    {
        ctx.Response.StatusCode = 400;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        await ctx.Response.WriteAsJsonAsync(new { error = ex.Message });
    }
});

// Estado de trabajo por usuario (equivalente a los DataTables de frmMain)
var sesiones = new ConcurrentDictionary<string, WorkSession>(StringComparer.OrdinalIgnoreCase);

WorkSession Sesion(ClaimsPrincipal user)
{
    var nombre = user.Identity?.Name ?? throw new InvalidOperationException("Sin sesión");
    return sesiones.GetOrAdd(nombre, _ => new WorkSession
    {
        Usuario = nombre,
        Perfil = user.FindFirstValue("perfil") ?? ""
    });
}

static object[] Filas(DataTable dt) =>
    dt.Rows.Cast<DataRow>().Select(r => FilaObj(dt, r)).ToArray();

static object FilaObj(DataTable dt, DataRow r)
{
    var d = new Dictionary<string, string?>();
    foreach (DataColumn c in dt.Columns)
        d[c.ColumnName] = r[c] == DBNull.Value ? null : Convert.ToString(r[c]);
    return d;
}

var db = app.Services.GetRequiredService<Db>();
var val = app.Services.GetRequiredService<ValidacionService>();
var liqui = app.Services.GetRequiredService<LiquiService>();

// ---------------------------------------------------------------- LOGIN
app.MapPost("/api/login", async (HttpContext ctx, LoginDto dto) =>
{
    // Mismo esquema que frmLogin: SP_VALIDAR_INICIO_SESION_APPS + perfil
    var dtResult = db.EjecutarSP(Sp.ValidarInicioSesion, dto.Usuario, dto.Password);
    var respuesta = Convert.ToString(dtResult?.Rows[0][0]) ?? "Error de autenticación";

    if (respuesta != "ok")
        return Results.BadRequest(new { error = respuesta });

    var dtPerfil = db.EjecutarSP(Sp.ObtenerPerfil, dto.Usuario);
    if (dtPerfil is null)
        return Results.BadRequest(new { error = "Usuario sin perfil asociado." });

    var perfil = Convert.ToString(dtPerfil.Rows[0][0]) ?? "";

    var identity = new ClaimsIdentity(CookieAuthenticationDefaults.AuthenticationScheme);
    identity.AddClaim(new Claim(ClaimTypes.Name, dto.Usuario));
    identity.AddClaim(new Claim("perfil", perfil));
    await ctx.SignInAsync(new ClaimsPrincipal(identity));

    sesiones.TryRemove(dto.Usuario, out _); // sesión de trabajo limpia
    return Results.Ok(new { usuario = dto.Usuario, perfil });
});

app.MapPost("/api/logout", async (HttpContext ctx) =>
{
    await ctx.SignOutAsync();
    return Results.Ok();
}).RequireAuthorization();

// ---------------------------------------------------------------- ESTADO / COMBOS
app.MapGet("/api/estado", (ClaimsPrincipal user) =>
{
    var s = Sesion(user);

    // Advertencia de reglas (LlenarReglas / LlenarReglasLiqui)
    var reglas = db.EjecutarSP(Sp.ObtenerReglas);
    var reglasLiqui = db.EjecutarSP(Sp.ObtenerReglasLiquidacion);
    bool alguna(DataTable? dt) => dt is not null &&
        dt.Rows.Cast<DataRow>().Any(r => Convert.ToInt32(r[2]) == 0);

    return Results.Ok(new
    {
        usuario = s.Usuario,
        perfil = s.Perfil,
        tab = s.Tab,
        proveedor = s.NombreProveedor,
        marca = s.NombreMarca,
        contadores = s.Contadores(),
        reglaDesactivada = alguna(reglas),
        reglaLiquiDesactivada = alguna(reglasLiqui),
        version = typeof(Program).Assembly.GetName().Version?.ToString(3)
    });
}).RequireAuthorization();

app.MapGet("/api/proveedores", () =>
    Results.Ok(Filas(db.EjecutarSP(Sp.ObtenerNombreProveedores) ?? new DataTable()))).RequireAuthorization();

app.MapGet("/api/marcas", () =>
    Results.Ok(Filas(db.EjecutarSP(Sp.ObtenerNombreMarcas) ?? new DataTable()))).RequireAuthorization();

app.MapGet("/api/marcas-por-proveedor", (string proveedor) =>
    Results.Ok(Filas(db.EjecutarSP(Sp.ObtenerMarcaProveedor, proveedor) ?? new DataTable()))).RequireAuthorization();

app.MapGet("/api/proveedores-por-marca", (string marca) =>
    Results.Ok(Filas(db.EjecutarSP(Sp.ObtenerProveedorMarca, marca) ?? new DataTable()))).RequireAuthorization();

app.MapGet("/api/empresas", () =>
    Results.Ok(Filas(db.EjecutarSP(Sp.ObtenerEmpresas) ?? new DataTable()))).RequireAuthorization();

app.MapGet("/api/sucursales", () =>
    Results.Ok(Filas(db.EjecutarSP(Sp.ObtenerSucursales) ?? new DataTable()))).RequireAuthorization();

// ---------------------------------------------------------------- SELECCIÓN
app.MapPost("/api/seleccionar", (ClaimsPrincipal user, SeleccionDto dto) =>
{
    var s = Sesion(user);

    if ((dto.Tab == "tabLiquidación" || dto.Tab == "tabRebaja") && s.Perfil != "Administrador")
        return Results.BadRequest(new { error = "Solo el perfil Administrador puede usar Liquidación/Rebaja." });

    s.Tab = dto.Tab;
    s.NombreProveedor = dto.Proveedor ?? "";
    s.NombreMarca = dto.Marca ?? "";
    return Results.Ok();
}).RequireAuthorization();

// ---------------------------------------------------------------- IMPORTAR
app.MapPost("/api/importar", (ClaimsPrincipal user, IFormFile archivo, [FromForm] bool noInformados,
                              [FromForm] int liquiModo, [FromForm] string? liquiValor) =>
{
    var s = Sesion(user);
    using var stream = archivo.OpenReadStream();
    using var ms = new MemoryStream();
    stream.CopyTo(ms);
    ms.Position = 0;

    List<string> errores = s.Tab is "tabLiquidación" or "tabRebaja"
        ? liqui.Importar(s, ms, liquiModo, liquiValor ?? "")
        : val.Importar(s, ms, noInformados);

    return Results.Ok(new { contadores = s.Contadores(), errores });
}).RequireAuthorization().DisableAntiforgery();

// ---------------------------------------------------------------- GRILLA
app.MapGet("/api/grilla", (ClaimsPrincipal user, int filtro) =>
{
    var s = Sesion(user);
    if (s.Tab is "tabLiquidación" or "tabRebaja")
    {
        var rows = s.DtMain.Rows.Cast<DataRow>();
        rows = filtro == 0
            ? rows.Where(r => Convert.ToString(r["ESTADO"]) == "OK")
            : rows.Where(r => Convert.ToString(r["ESTADO"]) == "ERROR");
        return Results.Ok(new
        {
            columnas = s.DtMain.Columns.Cast<DataColumn>().Select(c => c.ColumnName),
            filas = rows.Select(r => FilaObj(s.DtMain, r)).ToArray(),
            contadores = s.Contadores()
        });
    }

    var filas = val.FiltrarFilas(s, filtro).Select(r => FilaObj(s.DtMain, r)).ToArray();
    return Results.Ok(new
    {
        columnas = s.DtMain.Columns.Cast<DataColumn>().Select(c => c.ColumnName),
        filas,
        contadores = s.Contadores()
    });
}).RequireAuthorization();

// ---------------------------------------------------------------- EDICIÓN
app.MapPost("/api/editar", (ClaimsPrincipal user, EditarDto dto) =>
{
    var s = Sesion(user);
    val.Editar(s, dto.Codigo, dto.Costo, dto.Pvp);
    return Results.Ok(new { contadores = s.Contadores() });
}).RequireAuthorization();

app.MapPost("/api/masivo", (ClaimsPrincipal user, MasivoDto dto) =>
{
    var s = Sesion(user);
    val.Masivo(s, dto.Costo, dto.Pvp, dto.Filtro);
    return Results.Ok(new { contadores = s.Contadores() });
}).RequireAuthorization();

// ---------------------------------------------------------------- EXPORTS
app.MapPost("/api/exportar", (ClaimsPrincipal user) =>
{
    var s = Sesion(user);
    var archivos = s.Tab is "tabLiquidación" or "tabRebaja" ? liqui.Exportar(s) : val.Exportar(s);
    return Results.Ok(new { archivos, mensaje = "Exportado con Éxito..!!" });
}).RequireAuthorization();

app.MapPost("/api/no-informados", (ClaimsPrincipal user) =>
{
    var s = Sesion(user);
    var archivo = val.ExportarNoInformados(s);
    return Results.Ok(new { archivo });
}).RequireAuthorization();

app.MapPost("/api/liqui-lista", (ClaimsPrincipal user) =>
{
    var s = Sesion(user);
    var archivo = val.ExportarLiquiLista(s);
    return Results.Ok(new { archivo });
}).RequireAuthorization();

app.MapPost("/api/enviar-fail", (ClaimsPrincipal user) =>
{
    var s = Sesion(user);
    var archivo = s.Tab is "tabLiquidación" ? liqui.EnviarFail(s)
                : s.Tab is "tabRebaja" ? "" // fiel a la Desktop: Rebaja no hace nada
                : val.EnviarFail(s);
    return Results.Ok(new { archivo });
}).RequireAuthorization();

app.MapPost("/api/enviar-todo", (ClaimsPrincipal user) =>
{
    var s = Sesion(user);
    var archivo = val.EnviarTodo(s);
    return Results.Ok(new { archivo });
}).RequireAuthorization();

// ---------------------------------------------------------------- CANCELAR (Inicializar)
app.MapPost("/api/cancelar", (ClaimsPrincipal user) =>
{
    var s = Sesion(user);
    s.LimpiarLabels();
    s.InicializarCsvTables();
    s.NombreProveedor = "";
    s.NombreMarca = "";
    return Results.Ok();
}).RequireAuthorization();

// Diagnóstico: verifica que el proceso del servicio pueda escribir en los shares
// de exportación (solo accesible desde el server: la app escucha en 127.0.0.1).
app.MapGet("/api/diag-escritura", (IConfiguration config, APCWeb.Data.UncShares unc) =>
{
    var resultados = new Dictionary<string, string>();
    foreach (var ruta in new[] { config["Rutas:Precios"]!, config["Rutas:Auxiliar"]! })
    {
        try
        {
            unc.Asegurar(ruta);
            var probe = Path.Combine(ruta, "apcweb-diag-" + Guid.NewGuid().ToString("N") + ".tmp");
            File.WriteAllText(probe, "diag");
            File.Delete(probe);
            resultados[ruta] = "OK escritura";
        }
        catch (Exception ex)
        {
            resultados[ruta] = "ERROR: " + ex.Message;
        }
    }
    return Results.Ok(resultados);
});

app.Run();

record LoginDto(string Usuario, string Password);
record SeleccionDto(string Tab, string? Proveedor, string? Marca);
record EditarDto(string Codigo, double? Costo, double? Pvp);
record MasivoDto(double Costo, double Pvp, int Filtro);
