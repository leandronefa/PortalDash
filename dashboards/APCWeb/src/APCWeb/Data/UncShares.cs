using System.Runtime.InteropServices;

namespace APCWeb.Data;

/// <summary>
/// Conecta los shares UNC de exportación con credenciales propias por servidor
/// (equivalente a `net use \\server\share /user:... pass`), porque cada share
/// requiere una cuenta distinta y el servicio corre como LocalSystem.
/// Config: sección "Shares": [ { "Ruta": "\\\\server\\share", "Usuario": "dom\\user", "Password": "..." } ]
/// </summary>
public class UncShares
{
    private readonly List<(string Ruta, string Usuario, string Password)> _shares = new();
    private readonly HashSet<string> _conectados = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _lock = new();
    private readonly ILogger<UncShares> _log;

    public UncShares(IConfiguration config, ILogger<UncShares> log)
    {
        _log = log;
        foreach (var s in config.GetSection("Shares").GetChildren())
        {
            var ruta = s["Ruta"];
            var usuario = s["Usuario"];
            var password = s["Password"];
            if (!string.IsNullOrWhiteSpace(ruta) && !string.IsNullOrWhiteSpace(usuario))
                _shares.Add((ruta.TrimEnd('\\'), usuario!, password ?? ""));
        }
    }

    /// <summary>Asegura la conexión del share que contiene la ruta destino. Llamar antes de escribir.</summary>
    public void Asegurar(string rutaDestino)
    {
        foreach (var (ruta, usuario, password) in _shares)
        {
            if (!rutaDestino.StartsWith(ruta, StringComparison.OrdinalIgnoreCase)) continue;

            lock (_lock)
            {
                if (_conectados.Contains(ruta)) return;

                var nr = new NETRESOURCE { dwType = 1 /*RESOURCETYPE_DISK*/, lpRemoteName = ruta };
                var rc = WNetAddConnection2(ref nr, password, usuario, 0);
                if (rc == 0 || rc == 1219 /* ERROR_SESSION_CREDENTIAL_CONFLICT: ya hay sesión */)
                {
                    _conectados.Add(ruta);
                    _log.LogInformation("Share conectado: {Ruta} como {Usuario} (rc={Rc})", ruta, usuario, rc);
                }
                else
                {
                    _log.LogError("No se pudo conectar {Ruta} como {Usuario}: código {Rc}", ruta, usuario, rc);
                    throw new InvalidOperationException($"No se pudo conectar {ruta} (código Win32 {rc}).");
                }
            }
            return;
        }
        // Sin credenciales configuradas para esa ruta: se intenta con la identidad del proceso.
    }

    /// <summary>Fuerza reconexión (p. ej. si la sesión SMB se cayó).</summary>
    public void Reset()
    {
        lock (_lock) _conectados.Clear();
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NETRESOURCE
    {
        public int dwScope;
        public int dwType;
        public int dwDisplayType;
        public int dwUsage;
        public string? lpLocalName;
        public string lpRemoteName;
        public string? lpComment;
        public string? lpProvider;
    }

    [DllImport("mpr.dll", CharSet = CharSet.Unicode)]
    private static extern int WNetAddConnection2(ref NETRESOURCE lpNetResource, string? lpPassword, string? lpUserName, int dwFlags);
}
