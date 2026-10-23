import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { fmtMoney, fmtDate, getProductUnit } from "@/lib/format";
import { Banknote, CreditCard, ShoppingCart, TrendingUp, Users, Boxes, Radio, Building2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchAll } from "@/lib/fetch-all";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/dashboard")({ component: Dashboard });

interface SaleItemPreview { quantity: number | string; products: { name: string } | null }
interface SaleRow { id: string; branch_id?: string | null; branches?: { name: string } | null; customers?: { name: string } | null; sale_items?: SaleItemPreview[] | null; total_sale: number | string; profit: number | string; amount_paid: number | string; payment_method: string | null; created_at: string; status: string; }

function Dashboard() {
  const { profile, isSuperAdmin } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", profile?.branch_id, isSuperAdmin],
    queryFn: async () => {
      // Only count sales from currently OPEN shifts. When all shifts are closed, totals are 0.
      let openShiftsQ = supabase.from("shifts").select("id,branch_id").eq("status", "open");
      if (!isSuperAdmin && profile?.branch_id) openShiftsQ = openShiftsQ.eq("branch_id", profile.branch_id);
      const { data: openShifts } = await openShiftsQ;
      const openShiftIds = (openShifts ?? []).map((s) => s.id);

      let list: SaleRow[] = [];
      if (openShiftIds.length > 0) {
        let salesQ = supabase.from("sales").select("total_sale,profit,amount_paid,payment_method,created_at,id,status,branch_id,branches(name),customers(name),sale_items(quantity,products(name))").in("shift_id", openShiftIds).eq("status", "completed").order("created_at", { ascending: false });
        if (!isSuperAdmin && profile?.branch_id) salesQ = salesQ.eq("branch_id", profile.branch_id);
        list = await fetchAll<SaleRow>(salesQ);
      }
      const totalRevenue = list.reduce((a, s) => a + Number(s.total_sale), 0);
      const totalProfit = list.reduce((a, s) => a + Number(s.profit), 0);
      const cash = list.filter((s) => s.payment_method === "cash").reduce((a, s) => a + Number(s.amount_paid), 0);
      const click = list.filter((s) => s.payment_method === "click").reduce((a, s) => a + Number(s.amount_paid), 0);

      // Per-branch breakdown
      const branchMap = new Map<string, { name: string; revenue: number; profit: number; count: number }>();
      list.forEach((s) => {
        const id = s.branch_id ?? "—";
        const ex = branchMap.get(id) ?? { name: s.branches?.name ?? "—", revenue: 0, profit: 0, count: 0 };
        ex.revenue += Number(s.total_sale);
        ex.profit += Number(s.profit);
        ex.count += 1;
        branchMap.set(id, ex);
      });
      const branchStats = Array.from(branchMap.values()).sort((a, b) => b.revenue - a.revenue);

      // Hourly aggregation for today (00 - 23)
      const byHour = new Map<number, { day: string; revenue: number; profit: number }>();
      for (let h = 0; h < 24; h++) {
        byHour.set(h, { day: `${String(h).padStart(2, "0")}:00`, revenue: 0, profit: 0 });
      }
      list.forEach((s) => {
        const h = new Date(s.created_at).getHours();
        const e = byHour.get(h);
        if (e) { e.revenue += Number(s.total_sale); e.profit += Number(s.profit); }
      });
      const series = Array.from(byHour.values());

      const [{ count: customerCount }, { count: batchCount }, debt] = await Promise.all([
        supabase.from("customers").select("*", { count: "exact", head: true }).is("deleted_at", null),
        supabase.from("inventory_batches").select("*", { count: "exact", head: true }).gt("remaining", 0),
        fetchAll<{ balance: number | string }>(supabase.from("customers").select("balance").is("deleted_at", null)),
      ]);
      const totalDebt = debt.reduce((a, c) => a + Number(c.balance), 0);

      return { totalRevenue, totalProfit, cash, click, salesCount: list.length, customerCount: customerCount ?? 0, batchCount: batchCount ?? 0, totalDebt, recent: list.slice(0, 8), series, branchStats };
    },
  });

  // Realtime: invalidate dashboard on any sale or batch change
  useEffect(() => {
    const ch = supabase.channel("dashboard-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => qc.invalidateQueries({ queryKey: ["dashboard"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => qc.invalidateQueries({ queryKey: ["dashboard"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => qc.invalidateQueries({ queryKey: ["dashboard"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => qc.invalidateQueries({ queryKey: ["dashboard"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  return (
    <>
      <PageHeader title="Boshqaruv paneli" description="Bugungi ko'rsatkichlar" action={
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Radio className="h-3 w-3 text-success animate-pulse" /> Realtime</span>
      } />
      <div className="p-4 lg:p-6 space-y-4 lg:space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Tushum (bugun)" value={isLoading ? "—" : fmtMoney(data?.totalRevenue)} icon={<TrendingUp className="h-4 w-4" />} accent="success" hint="Bugungi kassa tushumi" />
          {isSuperAdmin && (
            <StatCard label="Foyda (FIFO)" value={isLoading ? "—" : fmtMoney(data?.totalProfit)} icon={<TrendingUp className="h-4 w-4" />} accent="primary" hint="Avtomatik tannarx hisobi" />
          )}
          <StatCard label="Naqd to'lov" value={isLoading ? "—" : fmtMoney(data?.cash)} icon={<Banknote className="h-4 w-4" />} accent="success" />
          <StatCard label="Click / Karta" value={isLoading ? "—" : fmtMoney(data?.click)} icon={<CreditCard className="h-4 w-4" />} accent="cyan" />
          <StatCard label="Sotuvlar soni" value={isLoading ? "—" : (data?.salesCount ?? 0)} icon={<ShoppingCart className="h-4 w-4" />} accent="primary" />
          <StatCard label="Mijozlar" value={isLoading ? "—" : (data?.customerCount ?? 0)} icon={<Users className="h-4 w-4" />} accent="cyan" />
          <StatCard label="Aktiv partiyalar" value={isLoading ? "—" : (data?.batchCount ?? 0)} icon={<Boxes className="h-4 w-4" />} accent="primary" />
          <StatCard label="Mijozlar qarzi" value={isLoading ? "—" : fmtMoney(data?.totalDebt)} icon={<CreditCard className="h-4 w-4" />} accent={Number(data?.totalDebt) > 0 ? "warning" : "success"} hint={Number(data?.totalDebt) > 0 ? "Nasiya qoldig'i" : "Qarzlar yo'q"} />
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-card/90 backdrop-blur-md overflow-hidden shadow-lg shadow-black/20">
          <div className="border-b border-white/[0.08] px-4 py-3.5 flex items-center justify-between">
            <div className="text-sm font-semibold tracking-tight">{isSuperAdmin ? "Tushum va Foyda dinamikasi" : "Tushum dinamikasi"} — Bugun (soatlar)</div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />Tushum</span>
              {isSuperAdmin && (
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-400 shadow-sm shadow-blue-400/50" />Foyda</span>
              )}
            </div>
          </div>
          <div className="p-3 h-[270px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.series ?? []}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="profGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="day" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15, 23, 42, 0.95)",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: 10,
                    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                  formatter={(v: number) => fmtMoney(v)}
                />
                <Area type="monotone" dataKey="revenue" name="Tushum" stroke="#10B981" strokeWidth={2.5} fill="url(#revGrad)" />
                {isSuperAdmin && (
                  <Area type="monotone" dataKey="profit" name="Foyda" stroke="#3B82F6" strokeWidth={2.5} fill="url(#profGrad)" />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-card/90 backdrop-blur-md overflow-hidden shadow-lg shadow-black/20">
          <div className="border-b border-white/[0.08] px-4 py-3.5 text-sm font-semibold tracking-tight">So'nggi sotuvlar</div>
          <div className="divide-y divide-white/[0.05]">
            {(data?.recent ?? []).map((s) => {
              const itemsList = s.sale_items ?? [];
              const itemsCount = itemsList.length;
              const preview = itemsList.slice(0, 3).map((it) => `${it.products?.name ?? "—"} ×${Number(it.quantity)} ${getProductUnit(it.products?.name)}`).join(", ");
              const more = itemsCount > 3 ? ` +${itemsCount - 3}` : "";
              const isCash = s.payment_method === "cash";
              const isClick = s.payment_method === "click";
              return (
                <Link key={s.id} to="/sales/$id" params={{ id: s.id }} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-white/[0.03] transition-colors">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                      <ShoppingCart className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold font-mono text-sm text-foreground">{fmtMoney(s.total_sale)}</span>
                        <span className="text-xs text-muted-foreground truncate">{s.customers?.name ?? "Mijozsiz"}</span>
                      </div>
                      <div className="text-xs text-muted-foreground/80 truncate mt-0.5">
                        {preview ? <>{preview}{more} · </> : null}{fmtDate(s.created_at)}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase border",
                        isCash
                          ? "bg-secondary/70 text-foreground border-border/60"
                          : isClick
                          ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                          : "bg-muted text-muted-foreground border-border"
                      )}
                    >
                      {s.payment_method ?? "—"}
                    </span>
                  </div>
                </Link>
              );
            })}
            {!isLoading && (data?.recent.length ?? 0) === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">Hali sotuvlar yo'q</div>}
          </div>
        </div>

        {isSuperAdmin && (data?.branchStats?.length ?? 0) > 0 && (
          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-3 flex items-center justify-between">
              <div className="text-sm font-semibold flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" /> Filiallar bo'yicha bugun</div>
              <Link to="/reports" className="text-[11px] text-primary hover:underline">Batafsil →</Link>
            </div>
            <div className="divide-y">
              {(data?.branchStats ?? []).map((b) => (
                <div key={b.name} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">{b.name}</div>
                    <div className="text-[11px] text-muted-foreground">{b.count} sotuv</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-semibold text-sm">{fmtMoney(b.revenue)}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">+{fmtMoney(b.profit)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center text-[11px] text-muted-foreground/40 pt-2 pb-6 select-none pointer-events-none">
          Dasturchi: MuzaffarZed
        </div>
      </div>
    </>
  );
}
