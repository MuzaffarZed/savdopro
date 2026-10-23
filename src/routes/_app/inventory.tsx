import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { fmtMoney, fmtNum, fmtDate } from "@/lib/format";
import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Boxes, Radio, Tag } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { usePricelist } from "@/lib/use-pricelist";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_app/inventory")({ component: InventoryPage });

function InventoryPage() {
  const [warehouseId, setWarehouseId] = useState<string>("all");
  const { isSuperAdmin, profile } = useAuth();
  const qc = useQueryClient();
  const { defaultMarkup, overrides } = usePricelist();

  // Realtime — boshqa foydalanuvchining sotuvi/transferi/braki ham qoldiqni yangilaydi
  useEffect(() => {
    const ch = supabase.channel("inventory-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_batches" }, () => qc.invalidateQueries({ queryKey: ["batches"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_movements" }, () => qc.invalidateQueries({ queryKey: ["batches"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses", isSuperAdmin, profile?.branch_id],
    queryFn: async () => {
      let q = supabase.from("warehouses").select("id,name,type,branch_id").is("deleted_at", null).order("type");
      if (!isSuperAdmin && profile?.branch_id) q = q.eq("branch_id", profile.branch_id);
      return (await q).data ?? [];
    },
  });

  const { data: rows } = useQuery({
    queryKey: ["batches", warehouseId, isSuperAdmin, profile?.branch_id],
    queryFn: async () => {
      let q = supabase.from("inventory_batches")
        .select("id,quantity,remaining,cost_price,created_at,product_id,warehouse_id,products(name,category),warehouses(name)")
        .gt("remaining", 0).order("created_at");
      if (warehouseId !== "all") q = q.eq("warehouse_id", warehouseId);
      else if (!isSuperAdmin && warehouses && warehouses.length > 0) {
        q = q.in("warehouse_id", warehouses.map((w) => w.id));
      } else if (!isSuperAdmin) {
        // Wait until warehouses load before fetching anything for non-admin
        return [];
      }
      return fetchAll<any>(q);
    },
    enabled: isSuperAdmin || !!warehouses,
  });

  const totalValue = (rows ?? []).reduce((a, r) => a + Number(r.remaining) * Number(r.cost_price), 0);

  // Per-product avg cost map -> sell price (pricelist mantig'i)
  const productAgg = new Map<string, { qty: number; value: number }>();
  (rows ?? []).forEach((r) => {
    const ex = productAgg.get(r.product_id) ?? { qty: 0, value: 0 };
    ex.qty += Number(r.remaining);
    ex.value += Number(r.remaining) * Number(r.cost_price);
    productAgg.set(r.product_id, ex);
  });
  const sellPriceFor = (productId: string, fallbackCost: number): number => {
    const agg = productAgg.get(productId);
    const avgCost = agg && agg.qty > 0 ? agg.value / agg.qty : fallbackCost;
    const ov = overrides[productId];
    if (ov?.price !== undefined) return Math.round(ov.price);
    const m = ov?.markup ?? defaultMarkup;
    return Math.round(avgCost * (1 + m / 100));
  };
  const totalSellValue = (rows ?? []).reduce((a, r) => a + Number(r.remaining) * sellPriceFor(r.product_id, Number(r.cost_price)), 0);

  return (
    <>
      <PageHeader title="Sklad qoldiqlari" description={
        <span className="inline-flex items-center gap-1.5">FIFO partiyalari bo'yicha aktiv qoldiqlar <Radio className="h-3 w-3 text-success animate-pulse" /></span>
      } action={
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger className="w-[160px] sm:w-[200px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Barcha sklatlar</SelectItem>
            {(warehouses ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
      } />
      <div className="p-3 lg:p-6 space-y-3 lg:space-y-4 pb-24 lg:pb-6">
        <div className={`grid gap-3 ${isSuperAdmin ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"}`}>
          {isSuperAdmin && (
            <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
              <Boxes className="h-5 w-5 text-primary" />
              <div>
                <div className="text-xs text-muted-foreground">Umumiy sklad qiymati (FIFO tannarx)</div>
                <div className="text-lg font-semibold tabular-nums">{fmtMoney(totalValue)}</div>
              </div>
            </div>
          )}
          <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
            <Tag className="h-5 w-5 text-success" />
            <div>
              <div className="text-xs text-muted-foreground">Qoldiqlarning umumiy sotuv qiymati</div>
              <div className="text-lg font-semibold tabular-nums">{fmtMoney(totalSellValue)}</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {(rows ?? []).map((r) => {
              const p = r.products as unknown as { name: string; category: string | null } | null;
              const w = r.warehouses as unknown as { name: string } | null;
              const isQop = (p?.category || "").toLowerCase().includes("parashok") || (p?.name || "").toLowerCase().includes("parashok") || (p?.name || "").toLowerCase().includes("aprel") || (p?.name || "").toLowerCase().includes("avtomat") || (p?.name || "").toLowerCase().includes("nixol");
              const unit = isQop ? "qop" : "dona";
              return (
                <div key={r.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{p?.name ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{w?.name ?? "—"} · {fmtDate(r.created_at)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm font-semibold">{fmtNum(r.remaining)} <span className="text-[11px] text-muted-foreground font-normal">{unit}</span></div>
                      <div className="text-[11px] text-muted-foreground font-mono">/ {fmtNum(r.quantity)} {unit}</div>
                    </div>
                  </div>
                  {isSuperAdmin && (
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Tannarx: <span className="font-mono text-foreground">{fmtMoney(r.cost_price)}</span></span>
                      <span className="font-mono font-semibold">{fmtMoney(Number(r.remaining) * Number(r.cost_price))}</span>
                    </div>
                  )}
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Sotuv: <span className="font-mono text-foreground">{fmtMoney(sellPriceFor(r.product_id, Number(r.cost_price)))}</span></span>
                    <span className="font-mono font-semibold text-success">{fmtMoney(Number(r.remaining) * sellPriceFor(r.product_id, Number(r.cost_price)))}</span>
                  </div>
                </div>
              );
            })}
            {(rows ?? []).length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Sklatda mahsulot yo'q. Avval xarid qo'shing.</div>}
          </div>
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left">Mahsulot</th>
                <th className="px-4 py-2.5 text-left">Sklad</th>
                <th className="px-4 py-2.5 text-right hidden md:table-cell">Boshlang'ich</th>
                <th className="px-4 py-2.5 text-right">Qoldiq</th>
                {isSuperAdmin && <th className="px-4 py-2.5 text-right">Tannarx</th>}
                {isSuperAdmin && <th className="px-4 py-2.5 text-right">Qiymati</th>}
                <th className="px-4 py-2.5 text-right">Sotuv narxi</th>
                <th className="px-4 py-2.5 text-right">Sotuv qiymati</th>
                <th className="px-4 py-2.5 text-left hidden md:table-cell">Yaratilgan</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(rows ?? []).map((r) => {
                const p = r.products as unknown as { name: string; category: string | null } | null;
                const w = r.warehouses as unknown as { name: string } | null;
                const isQop = (p?.category || "").toLowerCase().includes("parashok") || (p?.name || "").toLowerCase().includes("parashok") || (p?.name || "").toLowerCase().includes("aprel") || (p?.name || "").toLowerCase().includes("avtomat") || (p?.name || "").toLowerCase().includes("nixol");
                const unit = isQop ? "qop" : "dona";
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 font-medium">{p?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{w?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-muted-foreground hidden md:table-cell">{fmtNum(r.quantity)} {unit}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtNum(r.remaining)} <span className="text-xs text-muted-foreground font-normal">{unit}</span></td>
                    {isSuperAdmin && <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(r.cost_price)}</td>}
                    {isSuperAdmin && <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(Number(r.remaining) * Number(r.cost_price))}</td>}
                    <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(sellPriceFor(r.product_id, Number(r.cost_price)))}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-success">{fmtMoney(Number(r.remaining) * sellPriceFor(r.product_id, Number(r.cost_price)))}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{fmtDate(r.created_at)}</td>
                  </tr>
                );
              })}
              {(rows ?? []).length === 0 && <tr><td colSpan={isSuperAdmin ? 9 : 7} className="px-4 py-12 text-center text-muted-foreground">Sklatda mahsulot yo'q. Avval xarid qo'shing.</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </>
  );
}
