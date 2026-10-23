import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Layers, Package, Pencil, Trash2, Loader2, ShoppingBag, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtDate, fmtNum, getProductUnit } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_app/sales/$id")({ component: SaleDetail });

function SaleDetail() {
  const { id } = useParams({ from: "/_app/sales/$id" });
  const { isSuperAdmin, user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [eAmount, setEAmount] = useState<string>("");
  const [eMethod, setEMethod] = useState<string>("cash");
  const [eCustomer, setECustomer] = useState<string>("none");
  const [itemsOpen, setItemsOpen] = useState(false);
  const [eItems, setEItems] = useState<Array<{ product_id: string; quantity: string; sell_price: string }>>([]);

  const { data: sale } = useQuery({
    queryKey: ["sale", id],
    queryFn: async () => (await supabase.from("sales").select("*,customers(name,phone),branches(name),warehouses(name)").eq("id", id).maybeSingle()).data,
  });

  const { data: cashier } = useQuery({
    queryKey: ["sale-cashier", sale?.created_by],
    queryFn: async () => (await supabase.from("profiles").select("name,username").eq("id", sale!.created_by!).maybeSingle()).data,
    enabled: !!sale?.created_by,
  });

  const { data: items } = useQuery({
    queryKey: ["sale-items", id],
    queryFn: async () => (await supabase.from("sale_items").select("id,product_id,quantity,sell_price,total_price,total_cost,products(name)").eq("sale_id", id)).data ?? [],
  });

  // FIFO trace via inventory_movements
  const { data: trace } = useQuery({
    queryKey: ["sale-trace", id, items?.map((i) => i.id).join(",")],
    queryFn: async () => {
      if (!items || items.length === 0) return [];
      const ids = items.map((i) => i.id);
      const { data } = await supabase.from("inventory_movements")
        .select("ref_id,batch_id,quantity,cost_price,inventory_batches(created_at,cost_price,quantity)")
        .in("ref_id", ids).eq("ref_type", "sale_item").eq("type", "sale");
      return data ?? [];
    },
    enabled: !!items?.length,
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-light"],
    queryFn: async () => (await supabase.from("customers").select("id,name").is("deleted_at", null).order("name")).data ?? [],
    enabled: isSuperAdmin && editOpen,
  });

  const { data: allProducts } = useQuery({
    queryKey: ["products-light"],
    queryFn: async () => (await supabase.from("products").select("id,name").is("deleted_at", null).order("name")).data ?? [],
    enabled: isSuperAdmin && itemsOpen,
  });

  const updateSale = useMutation({
    mutationFn: async () => {
      const amount = Number(eAmount || 0);
      const { error } = await supabase.rpc("update_sale_payment", {
        _sale_id: id,
        _amount_paid: amount,
        _payment_method: eMethod as never,
        _customer_id: eCustomer === "none" ? null : eCustomer,
        _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sotuv yangilandi");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["sale", id] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  const deleteSale = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("delete_sale", { _sale_id: id, _user_id: user!.id } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sotuv o'chirildi", { description: "Sklat va mijoz balansi tiklandi" });
      qc.invalidateQueries();
      navigate({ to: "/sales" });
    },
    onError: (e: Error) => toast.error("O'chirib bo'lmadi", { description: e.message }),
  });

  const updateItems = useMutation({
    mutationFn: async () => {
      const payload = eItems
        .filter((i) => i.product_id && Number(i.quantity) > 0)
        .map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity), sell_price: Number(i.sell_price || 0) }));
      if (payload.length === 0) throw new Error("Kamida bitta mahsulot kerak");
      const { error } = await supabase.rpc("update_sale_items", {
        _sale_id: id,
        _items: payload as never,
        _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sotuv mahsulotlari yangilandi");
      setItemsOpen(false);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  const openItemsEdit = () => {
    if (!items) return;
    setEItems(items.map((it) => ({
      product_id: (it as { product_id?: string }).product_id ?? "",
      quantity: String(it.quantity),
      sell_price: String(it.sell_price),
    })));
    setItemsOpen(true);
  };

  const openEdit = () => {
    if (!sale) return;
    setEAmount(String(sale.amount_paid ?? 0));
    setEMethod((sale.payment_method ?? "cash") as string);
    setECustomer(sale.customer_id ?? "none");
    setEditOpen(true);
  };

  if (!sale) return <div className="p-4 lg:p-6 text-muted-foreground">Yuklanmoqda...</div>;

  const cust = sale.customers as unknown as { name: string; phone: string | null } | null;
  const wh = sale.warehouses as unknown as { name: string } | null;

  const traceByItem = new Map<string, typeof trace>();
  (trace ?? []).forEach((m) => {
    const arr = traceByItem.get(m.ref_id!) ?? [];
    arr.push(m as never);
    traceByItem.set(m.ref_id!, arr);
  });

  return (
    <>
      <PageHeader title={`Sotuv #${id.slice(0, 8)}`} description={fmtDate(sale.created_at)} action={
        <div className="flex items-center gap-1.5">
          {isSuperAdmin && sale.status === "completed" && (
            <>
              <Button variant="outline" size="sm" onClick={openItemsEdit}><ShoppingBag className="h-3.5 w-3.5" /> Mahsulotlar</Button>
              <Button variant="outline" size="sm" onClick={openEdit}><Pencil className="h-3.5 w-3.5" /> Tahrir</Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmDel(true)}><Trash2 className="h-3.5 w-3.5" /> O'chirish</Button>
            </>
          )}
          <Button variant="outline" size="sm" asChild><Link to="/sales"><ArrowLeft className="h-3.5 w-3.5" /> Orqaga</Link></Button>
        </div>
      } />
      <div className="p-4 lg:p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Info label="Mijoz" value={cust?.name ?? "—"} />
          <Info label="Kassir" value={cashier?.name ?? "—"} />
          <Info label="Sklad" value={wh?.name ?? "—"} />
          <Info label="To'lov" value={(sale.payment_method ?? "—").toString().toUpperCase()} />
          <Info label="Jami" value={fmtMoney(sale.total_sale)} />
          {isSuperAdmin && <Info label="Tannarx (FIFO)" value={fmtMoney(sale.total_cost)} />}
          {isSuperAdmin && <Info label="Foyda" value={fmtMoney(sale.profit)} accent="success" />}
          <Info label="Qarz" value={fmtMoney(sale.remaining_debt)} accent={Number(sale.remaining_debt) > 0 ? "warning" : undefined} />
        </div>

        {isSuperAdmin && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="border-b px-4 py-2.5 text-sm font-semibold flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> FIFO batch trace</div>
          <div className="divide-y">
            {(items ?? []).map((it) => {
              const p = it.products as unknown as { name: string } | null;
              const traces = traceByItem.get(it.id) ?? [];
              return (
                <div key={it.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-medium">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      {p?.name ?? "—"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-mono">{fmtNum(it.quantity)} {getProductUnit(p?.name)}</span> × <span className="font-mono">{fmtMoney(it.sell_price)}</span> = <span className="font-mono font-semibold text-foreground">{fmtMoney(it.total_price)}</span>
                    </div>
                  </div>
                  <div className="rounded-md border bg-muted/20 overflow-hidden">
                    <div className="overflow-x-auto"><table className="w-full text-xs min-w-[520px]">
                      <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <tr><th className="px-3 py-1.5 text-left">Batch ID</th><th className="px-3 py-1.5 text-left">Kirim sanasi</th><th className="px-3 py-1.5 text-right">Ishlatildi</th><th className="px-3 py-1.5 text-right">Tannarx/dona</th><th className="px-3 py-1.5 text-right">Jami tannarx</th></tr>
                      </thead>
                      <tbody className="divide-y">
                        {traces.map((t, i) => {
                          const bb = (t as unknown as { inventory_batches: { created_at: string } | null }).inventory_batches;
                          const used = Math.abs(Number(t.quantity));
                          return (
                            <tr key={i}>
                              <td className="px-3 py-1.5 font-mono text-[10px]">{(t.batch_id ?? "").slice(0, 8)}…</td>
                              <td className="px-3 py-1.5 text-muted-foreground">{bb ? fmtDate(bb.created_at) : "—"}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{fmtNum(used)}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{fmtMoney(t.cost_price)}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{fmtMoney(used * Number(t.cost_price))}</td>
                            </tr>
                          );
                        })}
                        {traces.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-center text-muted-foreground">Trace topilmadi</td></tr>}
                      </tbody>
                      <tfoot className="bg-muted/30">
                        <tr><td colSpan={4} className="px-3 py-1.5 text-right text-muted-foreground">Jami tannarx</td><td className="px-3 py-1.5 text-right font-mono font-semibold">{fmtMoney(it.total_cost)}</td></tr>
                      </tfoot>
                    </table></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {!isSuperAdmin && (
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">Mahsulotlar</div>
            <div className="divide-y">
              {(items ?? []).map((it) => {
                const p = it.products as unknown as { name: string } | null;
                return (
                  <div key={it.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <Package className="h-4 w-4 text-muted-foreground" />{p?.name ?? "—"}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span className="font-mono">{fmtNum(it.quantity)} {getProductUnit(p?.name)}</span> × <span className="font-mono">{fmtMoney(it.sell_price)}</span> = <span className="font-mono font-semibold text-foreground">{fmtMoney(it.total_price)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Sotuvni tahrirlash</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
              <div className="flex items-center justify-between"><span className="text-muted-foreground">Jami sotuv</span><span className="font-mono font-semibold">{fmtMoney(sale.total_sale)}</span></div>
              <p className="mt-1 text-[11px] text-muted-foreground">Mahsulot va miqdorlar tahrirlanmaydi. Faqat to'lov ma'lumotlari.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mijoz</Label>
              <Select value={eCustomer} onValueChange={setECustomer}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="none">— Mijozsiz —</SelectItem>
                  {(customers ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">To'lov turi</Label>
                <Select value={eMethod} onValueChange={setEMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Naqd</SelectItem>
                    <SelectItem value="click">Click</SelectItem>
                    <SelectItem value="debt">Qarz</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">To'langan summa</Label>
                <Input type="number" inputMode="decimal" value={eAmount} onChange={(e) => setEAmount(e.target.value)} />
              </div>
            </div>
            <div className="rounded-md border bg-muted/20 p-2 text-xs flex items-center justify-between">
              <span className="text-muted-foreground">Yangi qarz</span>
              <span className="font-mono font-semibold">{fmtMoney(Math.max(Number(sale.total_sale) - Number(eAmount || 0), 0))}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Bekor</Button>
            <Button disabled={updateSale.isPending} onClick={() => updateSale.mutate()}>
              {updateSale.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sotuvni o'chirasizmi?</AlertDialogTitle>
            <AlertDialogDescription>
              Bu amal qaytarib bo'lmaydi. Sotilgan mahsulotlar sklat qoldig'iga qaytariladi va mijoz qarzi tiklanadi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction disabled={deleteSale.isPending} onClick={(e) => { e.preventDefault(); deleteSale.mutate(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteSale.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ha, o'chirish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Items edit dialog */}
      <Dialog open={itemsOpen} onOpenChange={setItemsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Mahsulotlarni tahrirlash</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            <p className="text-[11px] text-muted-foreground">Sklad qoldig'i va FIFO tannarx avtomatik qayta hisoblanadi. Yetarli qoldiq bo'lishi shart.</p>
            {eItems.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-1.5 items-end rounded border p-2">
                <div className="col-span-6 space-y-1">
                  <Label className="text-[10px]">Mahsulot</Label>
                  <Select value={it.product_id} onValueChange={(v) => setEItems((arr) => arr.map((x, i) => i === idx ? { ...x, product_id: v } : x))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tanlang" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {(allProducts ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-[10px]">Miqdor</Label>
                  <Input className="h-8 text-xs" type="number" value={it.quantity} onChange={(e) => setEItems((arr) => arr.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} />
                </div>
                <div className="col-span-3 space-y-1">
                  <Label className="text-[10px]">Narx</Label>
                  <Input className="h-8 text-xs" type="number" value={it.sell_price} onChange={(e) => setEItems((arr) => arr.map((x, i) => i === idx ? { ...x, sell_price: e.target.value } : x))} />
                </div>
                <div className="col-span-1">
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEItems((arr) => arr.filter((_, i) => i !== idx))}><X className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setEItems((arr) => [...arr, { product_id: "", quantity: "1", sell_price: "0" }])}>
              <Plus className="h-3.5 w-3.5" /> Mahsulot qo'shish
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemsOpen(false)}>Bekor</Button>
            <Button disabled={updateItems.isPending} onClick={() => updateItems.mutate()}>
              {updateItems.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Info({ label, value, accent }: { label: string; value: string; accent?: "success" | "warning" }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-sm font-mono font-semibold truncate", accent === "success" && "text-success", accent === "warning" && "text-warning")}>{value}</div>
    </div>
  );
}