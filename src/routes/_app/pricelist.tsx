import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Tag, Search, Printer, Pencil, Check, X, RotateCcw } from "lucide-react";
import { fmtMoney, fmtNum } from "@/lib/format";
import { downloadCSV } from "@/lib/csv";
import { StatCard } from "@/components/layout/StatCard";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { usePricelist, setDefaultMarkup, upsertOverride, deleteOverride, deleteAllOverrides } from "@/lib/use-pricelist";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_app/pricelist")({ component: PricelistPage });

function PricelistPage() {
  const { isSuperAdmin } = useAuth();
  const { defaultMarkup: markup, overrides } = usePricelist();
  const [warehouseId, setWarehouseId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMarkup, setEditMarkup] = useState<string>("");
  const [editPrice, setEditPrice] = useState<string>("");

  const setMarkupSafe = async (n: number) => {
    try { await setDefaultMarkup(n); }
    catch (e) { toast.error((e as Error).message); }
  };

  const { data: warehouses } = useQuery({
    queryKey: ["pricelist-warehouses"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name").is("deleted_at", null).order("name")).data ?? [],
  });

  const { data: batches } = useQuery({
    queryKey: ["pricelist-batches", warehouseId],
    queryFn: async () => {
      let q = supabase.from("inventory_batches")
        .select("product_id,remaining,cost_price,products(name,category)")
        .gt("remaining", 0);
      if (warehouseId !== "all") q = q.eq("warehouse_id", warehouseId);
      return fetchAll<any>(q);
    },
  });

  const rows = useMemo(() => {
    const map = new Map<string, { product_id: string; name: string; category: string | null; qty: number; value: number }>();
    (batches ?? []).forEach((b) => {
      const p = b.products as unknown as { name: string; category: string | null } | null;
      const ex = map.get(b.product_id) ?? { product_id: b.product_id, name: p?.name ?? "—", category: p?.category ?? null, qty: 0, value: 0 };
      ex.qty += Number(b.remaining);
      ex.value += Number(b.remaining) * Number(b.cost_price);
      map.set(b.product_id, ex);
    });
    const arr = Array.from(map.values()).map((r) => {
      const avgCost = r.qty > 0 ? r.value / r.qty : 0;
      const ov = overrides[r.product_id];
      const effMarkup = ov?.markup ?? markup;
      let sell: number;
      let isCustom = false;
      if (ov?.price !== undefined) {
        sell = Math.round(ov.price);
        isCustom = true;
      } else if (ov?.markup !== undefined) {
        sell = Math.round(avgCost * (1 + effMarkup / 100));
        isCustom = true;
      } else {
        sell = Math.round(avgCost * (1 + markup / 100));
      }
      const realMarkup = avgCost > 0 ? Math.round(((sell - avgCost) / avgCost) * 100) : 0;
      return { ...r, avgCost, sell, profitPerUnit: sell - avgCost, isCustom, effMarkup: realMarkup };
    });
    return arr.sort((a, b) => a.name.localeCompare(b.name));
  }, [batches, markup, overrides]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.category && s.add(r.category));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = rows.filter((r) =>
    (category === "all" || r.category === category) &&
    (!search.trim() || r.name.toLowerCase().includes(search.toLowerCase()))
  );

  const totals = filtered.reduce((a, r) => ({
    qty: a.qty + r.qty,
    cost: a.cost + r.value,
    sell: a.sell + r.sell * r.qty,
  }), { qty: 0, cost: 0, sell: 0 });

  const exportCsv = () => {
    const wh = warehouseId === "all" ? "barcha" : (warehouses ?? []).find((w) => w.id === warehouseId)?.name ?? "sklad";
    downloadCSV(`narxnoma-${wh}-mark${markup}%.csv`,
      filtered.map((r) => ({
        mahsulot: r.name,
        kategoriya: r.category ?? "",
        qoldiq: r.qty,
        ortacha_tannarx: Math.round(r.avgCost),
        sotuv_narxi: r.sell,
        markup_foiz: r.effMarkup,
        ozgartirilgan: r.isCustom ? "ha" : "yoq",
      })));
  };

  const startEdit = (r: { product_id: string; sell: number; effMarkup: number }) => {
    setEditingId(r.product_id);
    setEditMarkup(String(r.effMarkup));
    setEditPrice(String(r.sell));
  };
  const cancelEdit = () => { setEditingId(null); setEditMarkup(""); setEditPrice(""); };

  const saveEdit = async (productId: string, avgCost: number, mode: "markup" | "price") => {
    if (mode === "markup") {
      const m = Number(editMarkup);
      if (!Number.isFinite(m) || m < -100 || m > 1000) { toast.error("Markup -100% dan 1000% gacha bo'lishi kerak"); return; }
      try { await upsertOverride(productId, { markup: m }); toast.success(`Markup saqlandi: ${m}%`); }
      catch (e) { toast.error((e as Error).message); return; }
    } else {
      const p = Number(editPrice);
      if (!Number.isFinite(p) || p < 0) { toast.error("Narx 0 dan kichik bo'lmasligi kerak"); return; }
      try {
        await upsertOverride(productId, { price: p });
        const m = avgCost > 0 ? Math.round(((p - avgCost) / avgCost) * 100) : 0;
        toast.success(`Narx saqlandi: ${fmtMoney(p)} (≈ ${m}%)`);
      } catch (e) { toast.error((e as Error).message); return; }
    }
    cancelEdit();
  };

  const resetOne = async (productId: string) => {
    try { await deleteOverride(productId); cancelEdit(); toast.success("Standart markupga qaytarildi"); }
    catch (e) { toast.error((e as Error).message); }
  };

  const resetAll = async () => {
    if (Object.keys(overrides).length === 0) return;
    if (!confirm("Barcha individual narxlarni tiklashga ishonchingiz komilmi?")) return;
    try { await deleteAllOverrides(); toast.success("Barcha o'zgartirishlar tiklandi"); }
    catch (e) { toast.error((e as Error).message); }
  };

  const customCount = Object.keys(overrides).length;

  if (!isSuperAdmin) return <Navigate to="/dashboard" />;

  return (
    <>
      <PageHeader title="Narxnoma" description="Joriy ombor qoldiqlari va tavsiya etilgan sotuv narxlari" action={
        <div className="flex items-center gap-2 flex-wrap">
          {customCount > 0 && (
            <Button size="sm" variant="outline" onClick={resetAll} title="Barcha individual narxlarni tiklash">
              <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{customCount} ta tiklash</span><span className="sm:hidden">{customCount}</span>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => window.print()} className="hidden sm:inline-flex">
            <Printer className="h-3.5 w-3.5" /> Chop
          </Button>
          <Button size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      } />

      <div className="p-3 lg:p-6 pb-24 lg:pb-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Mahsulotlar" value={String(filtered.length)} icon={<Tag className="h-4 w-4" />} />
          <StatCard label="Umumiy qoldiq" value={fmtNum(totals.qty)} icon={<Tag className="h-4 w-4" />} />
          <StatCard label="Tannarx jami" value={fmtMoney(totals.cost)} icon={<Tag className="h-4 w-4" />} />
          <StatCard label="Sotuv qiymati" value={fmtMoney(totals.sell)} icon={<Tag className="h-4 w-4" />} accent="success" />
        </div>

        <div className="rounded-lg border bg-card p-3 lg:p-4 grid gap-3 grid-cols-2 sm:grid-cols-[1fr_180px_180px_140px]">
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label className="text-xs">Qidiruv</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Mahsulot nomi..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sklad</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barcha skladlar</SelectItem>
                {(warehouses ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Kategoriya</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Barchasi</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Markup, %</Label>
            <Input type="number" min={0} max={500} value={markup} onChange={(e) => setMarkupSafe(Number(e.target.value) || 0)} />
          </div>
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {filtered.map((r) => {
              const isEditing = editingId === r.product_id;
              return (
                <div key={r.product_id} className={cn("px-3 py-2.5", isEditing && "bg-primary/5")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate flex items-center gap-1.5">
                        {r.name}
                        {r.isCustom && <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-warning/15 text-warning font-semibold shrink-0">Custom</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.category ?? "—"} · qold: <span className="font-mono">{fmtNum(r.qty)}</span></div>
                      <div className="text-[11px] text-muted-foreground font-mono mt-0.5">Tan: {fmtMoney(r.avgCost)} → <span className={cn("font-semibold", r.isCustom ? "text-warning" : "text-primary")}>{fmtMoney(r.sell)}</span> ({r.effMarkup}%)</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isEditing ? (
                        <>
                          <Button size="icon" variant="default" className="h-7 w-7" onClick={() => saveEdit(r.product_id, r.avgCost, "price")}><Check className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit}><X className="h-3.5 w-3.5" /></Button>
                        </>
                      ) : (
                        <>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                          {r.isCustom && <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => resetOne(r.product_id)}><RotateCcw className="h-3.5 w-3.5" /></Button>}
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[10px]">Markup %</Label>
                        <Input type="number" value={editMarkup} onChange={(e) => { setEditMarkup(e.target.value); const m = Number(e.target.value); if (Number.isFinite(m)) setEditPrice(String(Math.round(r.avgCost * (1 + m / 100)))); }} className="h-8 font-mono" />
                      </div>
                      <div>
                        <Label className="text-[10px]">Narx</Label>
                        <Input type="number" value={editPrice} onChange={(e) => { setEditPrice(e.target.value); const p = Number(e.target.value); if (Number.isFinite(p) && r.avgCost > 0) setEditMarkup(String(Math.round(((p - r.avgCost) / r.avgCost) * 100))); }} className="h-8 font-mono" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {filtered.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Mahsulot topilmadi</div>}
          </div>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Mahsulot</th>
                  <th className="px-4 py-2 text-left hidden sm:table-cell">Kategoriya</th>
                  <th className="px-4 py-2 text-right">Qoldiq</th>
                  <th className="px-4 py-2 text-right">Tannarx</th>
                  <th className="px-4 py-2 text-right">Markup %</th>
                  <th className="px-4 py-2 text-right">Sotuv narxi</th>
                  <th className="px-4 py-2 text-right hidden sm:table-cell">Foyda/dona</th>
                  <th className="px-4 py-2 w-[1%]"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isEditing = editingId === r.product_id;
                  return (
                    <tr key={r.product_id} className={cn("border-b last:border-0 hover:bg-muted/20", isEditing && "bg-primary/5")}>
                      <td className="px-4 py-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          {r.name}
                          {r.isCustom && !isEditing && <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/15 text-warning font-semibold">Custom</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell">{r.category ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtNum(r.qty)}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{fmtMoney(r.avgCost)}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editMarkup}
                            onChange={(e) => {
                              setEditMarkup(e.target.value);
                              const m = Number(e.target.value);
                              if (Number.isFinite(m)) setEditPrice(String(Math.round(r.avgCost * (1 + m / 100))));
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(r.product_id, r.avgCost, "markup"); if (e.key === "Escape") cancelEdit(); }}
                            className="h-8 w-20 ml-auto text-right font-mono"
                          />
                        ) : (
                          <span className={cn(r.isCustom && "text-warning font-semibold")}>{r.effMarkup}%</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editPrice}
                            onChange={(e) => {
                              setEditPrice(e.target.value);
                              const p = Number(e.target.value);
                              if (Number.isFinite(p) && r.avgCost > 0) setEditMarkup(String(Math.round(((p - r.avgCost) / r.avgCost) * 100)));
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter") saveEdit(r.product_id, r.avgCost, "price"); if (e.key === "Escape") cancelEdit(); }}
                            className="h-8 w-28 ml-auto text-right font-mono"
                          />
                        ) : (
                          <span className={cn("font-semibold", r.isCustom ? "text-warning" : "text-primary")}>{fmtMoney(r.sell)}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-success hidden sm:table-cell">
                        {fmtMoney(Number(isEditing ? Number(editPrice) - r.avgCost : r.profitPerUnit))}
                      </td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="icon" variant="default" className="h-7 w-7" onClick={() => saveEdit(r.product_id, r.avgCost, "price")} title="Saqlash (Enter)">
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit} title="Bekor (Esc)">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 justify-end">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(r)} title="Tahrirlash">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {r.isCustom && (
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => resetOne(r.product_id)} title="Standart markupga qaytarish">
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">Mahsulot topilmadi</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}