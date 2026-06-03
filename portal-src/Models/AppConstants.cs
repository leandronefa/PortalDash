namespace DashboardPortal.Models;

/// <summary>
/// Constantes transversales: roles, politicas y claims personalizados.
/// </summary>
public static class AppConstants
{
    public static class Roles
    {
        public const string Master = "Master";
        public const string User = "User";
    }

    public static class Policies
    {
        public const string MasterOnly = "MasterOnly";
    }

    public static class Claims
    {
        public const string DisplayName = "DisplayName";
        public const string IsMaster = "IsMaster";
    }

    public static class Settings
    {
        public const string PortalTitle = "Portal.Title";
        public const string ServerHost = "Portal.ServerHost";
        public const string DefaultScheme = "Portal.DefaultScheme";
    }
}
