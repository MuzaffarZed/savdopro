import { createFileRoute, Outlet, Navigate, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Loader2, LayoutDashboard, Package, Boxes, Warehouse, Users, ShoppingCart, Building2, UserCog, ScanBarcode, LogOut, Box, ArrowRightLeft, FileBarChart, Clock, Menu, X, Tag, AlertTriangle, CalendarDays, History, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { startAutoSync, subscribeSyncEvents } from "@/lib/offline-queue";
import { toast } from "sonner";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

const NAV: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }[] = [
  { to: "/dashboard", label: "Boshqaruv paneli", icon: LayoutDashboard },
  { to: "/pos", label: "POS — Sotuv", icon: ScanBarcode },
  { to: "/shifts", label: "Smena (Kassa)", icon: Clock },
  { to: "/sales", label: "Sotuvlar", icon: ShoppingCart },
  { to: "/reports", label: "Hisobotlar", icon: FileBarChart },
  { to: "/daily-report", label: "Kunlik hisobot", icon: CalendarDays },
  { to: "/customers", label: "Mijozlar", icon: Users },
  { to: "/telegram-notifications", label: "Telegram bot", icon: Bot, adminOnly: true },
  { to: "/products", label: "Mahsulotlar", icon: Package, adminOnly: true },
  { to: "/pricelist", label: "Narxnoma", icon: Tag, adminOnly: true },
  { to: "/inventory", label: "Sklad qoldiqlari", icon: Boxes },
  { to: "/purchases", label: "Xaridlar (Kirim)", icon: Warehouse, adminOnly: true },
  { to: "/transfers", label: "Transferlar", icon: ArrowRightLeft },
  { to: "/damages", label: "Brak (Defekt)", icon: AlertTriangle },
  { to: "/warehouses", label: "Skladlar", icon: Warehouse, adminOnly: true },
  { to: "/branches", label: "Filiallar", icon: Building2, adminOnly: true },
  { to: "/users", label: "Foydalanuvchilar", icon: UserCog, adminOnly: true },
  { to: "/audit", label: "Audit jurnal", icon: History, adminOnly: true },
];

function AppLayout() {
  const { session, loading, profile, isSuperAdmin, signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    const stop = startAutoSync();
    const unsub = subscribeSyncEvents((ev) => {
      const short = ev.id.slice(0, 6);
      if (ev.type === "start") {
        toast.loading(`Sotuv yuborilmoqda… #${short}`, { id: `sync-${ev.id}` });
      } else if (ev.type === "ok") {
        toast.success(`Sotuv sinxronlandi ✓ #${short}`, { id: `sync-${ev.id}`, duration: 3000 });
      } else if (ev.type === "fail") {
        const wait = Math.max(1, Math.round((ev.nextAt - Date.now()) / 1000));
        toast.error(`Sinxronlash xato (urinish ${ev.attempt}) — ${wait}s dan keyin qayta`, { id: `sync-${ev.id}`, description: ev.error, duration: 4000 });
      } else if (ev.type === "blocked") {
        toast.error(`Sotuv bloklandi #${short}`, { id: `sync-${ev.id}`, description: ev.error, duration: 8000 });
      }
    });
    return () => { stop?.(); unsub(); };
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" />;

  const items = NAV.filter((i) => !i.adminOnly || isSuperAdmin);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Sidebar */}
      <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-2.5 border-b px-4">
          <img src="/savdopro_logo.png" className="h-7 w-7 rounded-md object-cover shadow-sm" alt="SavdoPro" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div className="text-sm font-semibold tracking-tight">SavdoPro</div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <div className="mb-2 px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</div>
          {items.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold uppercase">
              {(profile?.name ?? "?").slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{profile?.name ?? "User"}</div>
              <div className="truncate text-[10px] text-muted-foreground">
                {isSuperAdmin ? "Super Admin" : "Branch User"}
              </div>
            </div>
            <Button size="icon" variant="ghost" onClick={handleSignOut} title="Chiqish">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
          <div className="pt-2 text-[9px] text-muted-foreground/35 text-center font-mono select-none">
            Dasturchi: MuzaffarZed
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <header className="lg:hidden flex h-14 items-center justify-between border-b bg-sidebar px-4 safe-top">
          <div className="flex items-center gap-2">
            <img src="/savdopro_logo.png" className="h-7 w-7 rounded-md object-cover shadow-sm" alt="SavdoPro" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <div className="text-sm font-semibold">SavdoPro</div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={() => setMobileOpen((v) => !v)}>{mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}</Button>
            <Button size="icon" variant="ghost" onClick={handleSignOut}><LogOut className="h-4 w-4" /></Button>
          </div>
        </header>

        {/* Mobile slide-down menu */}
        {mobileOpen && (
          <div className="lg:hidden border-b bg-sidebar max-h-[70vh] overflow-y-auto">
            <nav className="p-2 grid grid-cols-2 gap-1">
              {items.map((item) => {
                const active = pathname === item.to || pathname.startsWith(item.to + "/");
                const Icon = item.icon;
                return (
                  <Link key={item.to} to={item.to} className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                    active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
                  )}>
                    <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        )}

        {/* Mobile bottom nav */}
        <nav className="lg:hidden order-last fixed bottom-0 left-0 right-0 z-30 flex border-t bg-sidebar safe-nav-bottom">
          {[
            items.find((i) => i.to === "/dashboard"),
            items.find((i) => i.to === "/pos"),
            items.find((i) => i.to === "/shifts"),
            items.find((i) => i.to === "/customers"),
            items.find((i) => i.to === "/reports"),
          ].filter(Boolean).slice(0, 5).map((item) => {
            if (!item) return null;
            const active = pathname === item.to;
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className={cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px]", active ? "text-primary" : "text-muted-foreground")}>
                <Icon className="h-4 w-4" />
                <span className="truncate">{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
