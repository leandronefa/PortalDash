using DashboardPortal.Models;
using Microsoft.EntityFrameworkCore;

namespace DashboardPortal.Data;

/// <summary>
/// Contexto EF Core de la base de datos PROPIA del portal (dashboards, usuarios, permisos, config, auditoria).
/// </summary>
public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Dashboard> Dashboards => Set<Dashboard>();
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<DashboardPermission> Permissions => Set<DashboardPermission>();
    public DbSet<AppSetting> Settings => Set<AppSetting>();
    public DbSet<AccessLog> AccessLogs => Set<AccessLog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<AppUser>(e =>
        {
            e.HasIndex(u => u.Username).IsUnique();
            e.Property(u => u.Username).IsRequired();
        });

        b.Entity<Dashboard>(e =>
        {
            e.Property(d => d.Name).IsRequired();
            e.HasIndex(d => d.Port);
        });

        b.Entity<DashboardPermission>(e =>
        {
            e.HasIndex(p => new { p.AppUserId, p.DashboardId }).IsUnique();

            e.HasOne(p => p.User)
                .WithMany(u => u.Permissions)
                .HasForeignKey(p => p.AppUserId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(p => p.Dashboard)
                .WithMany(d => d.Permissions)
                .HasForeignKey(p => p.DashboardId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<AppSetting>().HasKey(s => s.Key);

        b.Entity<AccessLog>(e =>
        {
            e.HasIndex(l => l.Timestamp);
            e.HasIndex(l => l.Username);
        });
    }
}
