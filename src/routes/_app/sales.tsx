import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { fmtMoney, fmtDate, getProductUnit } from "@/lib/format";
import { ShoppingCart, Download, ExternalLink, Pencil, Trash2, Loader2, Package, Plus, X, CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { downloadCSV } from "@/lib/csv";
import { useAuth } from "@/lib/auth-context";
import { fetchAll } from "@/lib/fetch-all";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/sales")({ component: SalesPage });

type SaleRow = {
  id: string;
  total_sale: number;
  total_cost: number;
  profit: number;
  amount_paid: number;
  remaining_debt: number;
  payment_method: string | null;
  status: string;
  created_at: string;
  customer_id: string | null;
  branch_id: string | null;
  customers: { name: string } | null;
  sale_items: { id: string; product_id: string; quantity: number; sell_price: number; total_price: number; products: { name: string } | null }[] | null;
};

function SalesPage() {
  const { isSuperAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [editSale, setEditSale] = useState<SaleRow | null>(null);
  const [delSale, setDelSale] = useState<SaleRow | null>(null);
  const [itemsSale, setItemsSale] = useState<SaleRow | null>(null);
  const [eItems, setEItems] = useState<Array<{ product_id: string; quantity: string; sell_price: string }>>([]);
  const [eAmount, setEAmount] = useState("");
  const [eMethod, setEMethod] = useState("cash");
  const [eCustomer, setECustomer] = useState("none");
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [branchFilter, setBranchFilter] = useState<string>("all");

  const { data: branches } = useQuery({
    queryKey: ["branches-light"],
    queryFn: async () => (await supabase.from("branches").select("id,name").is("deleted_at", null).order("name")).data ?? [],
  });

  const { data: sales } = useQuery({
    queryKey: ["sales", fromDate?.toISOString() ?? null, toDate?.toISOString() ?? null, branchFilter],
    queryFn: async () => {
      let q = supabase
          .from("sales")
          .select("id,total_sale,total_cost,profit,amount_paid,remaining_debt,payment_method,status,created_at,customer_id,branch_id,customers(name),sale_items(id,product_id,quantity,sell_price,total_price,products(name))")
          .neq("status", "rolled_back");
      if (fromDate) q = q.gte("created_at", new Date(fromDate.setHours(0,0,0,0)).toISOString());
      if (toDate) {
        const end = new Date(toDate); end.setHours(23,59,59,999);
        q = q.lte("created_at", end.toISOString());
      }
      if (branchFilter !== "all") q = q.eq("branch_id", branchFilter);
      return fetchAll<SaleRow>(q.order("created_at", { ascending: false }));
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers-light"],
    queryFn: async () => (await supabase.from("customers").select("id,name").is("deleted_at", null).order("name")).data ?? [],
    enabled: isSuperAdmin && (!!editSale || !!itemsSale),
  });

  const { data: allProducts } = useQuery({
    queryKey: ["products-light"],
    queryFn: async () => (await supabase.from("products").select("id,name").is("deleted_at", null).order("name")).data ?? [],
    enabled: isSuperAdmin && !!itemsSale,
  });

  const openEdit = (s: SaleRow) => {
    setEditSale(s);
    setEAmount(String(s.amount_paid));
    setEMethod((s.payment_method as string) ?? "cash");
    setECustomer(s.customer_id ?? "none");
  };

  const openItems = (s: SaleRow) => {
    setItemsSale(s);
    setEItems((s.sale_items ?? []).map((it) => ({
      product_id: it.product_id,
      quantity: String(it.quantity),
      sell_price: String(it.sell_price),
    })));
  };

  const updateItemsMut = useMutation({
    mutationFn: async () => {
      if (!itemsSale || !user) return;
      const payload = eItems
        .filter((i) => i.product_id && Number(i.quantity) > 0)
        .map((i) => ({ product_id: i.product_id, quantity: Number(i.quantity), sell_price: Number(i.sell_price || 0) }));
      if (payload.length === 0) throw new Error("Kamida bitta mahsulot kerak");
      const { error } = await supabase.rpc("update_sale_items", {
        _sale_id: itemsSale.id,
        _items: payload as never,
        _user_id: user.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sotuv mahsulotlari yangilandi");
      setItemsSale(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMut = useMutation({
    mutationFn: async () => {
      if (!editSale || !user) return;
      const { error } = await supabase.rpc("update_sale_payment", {
        _sale_id: editSale.id,
        _amount_paid: Number(eAmount || 0),
        _payment_method: eMethod,
        _customer_id: eCustomer === "none" ? null : eCustomer,
        _user_id: user.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sotuv yangilandi");
      setEditSale(null);
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customer"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (sid: string) => {
      if (!user) return;
      const { error } = await supabase.rpc("delete_sale", { _sale_id: sid, _user_id: user.id } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sotuv to'liq o'chirildi");
      setDelSale(null);
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customer"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCSV = () => {
    const rows = (sales ?? []).map((s) => {
      const base: Record<string, unknown> = {
        sana: fmtDate(s.created_at),
        mijoz: s.customers?.name ?? "",
        tolov: s.payment_method ?? "",
        sotuv: s.total_sale,
        tolangan: s.amount_paid,
        qarz: s.remaining_debt,
        status: s.status,
      };
      if (isSuperAdmin) {
        base.tannarx = s.total_cost;
        base.foyda = s.profit;
      }
      return base;
    });
    downloadCSV(`sotuvlar-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <>
      <PageHeader
        title="Sotuvlar"
        description="Barcha sotuvlar tarixi"
        action={
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!sales?.length}>
            <Download className="h-3.5 w-3.5" /> CSV eksport
          </Button>
        }
      />
      <div className="p-3 lg:p-6 pb-24 lg:pb-6">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Dan</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-8 justify-start font-normal", !fromDate && "text-muted-foreground")}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {fromDate ? format(fromDate, "dd.MM.yyyy") : "Sana"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={fromDate} onSelect={setFromDate} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase text-muted-foreground">Gacha</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("h-8 justify-start font-normal", !toDate && "text-muted-foreground")}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {toDate ? format(toDate, "dd.MM.yyyy") : "Sana"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={toDate} onSelect={setToDate} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
          {isSuperAdmin && (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Filial</Label>
              <Select value={branchFilter} onValueChange={setBranchFilter}>
                <SelectTrigger className="h-8 w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barchasi</SelectItem>
                  {(branches ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {(fromDate || toDate || branchFilter !== "all") && (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => { setFromDate(undefined); setToDate(undefined); setBranchFilter("all"); }}>
              Tozalash
            </Button>
          )}
        </div>
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {(sales ?? []).map((s) => (
              <div key={s.id} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <Link to="/sales/$id" params={{ id: s.id }} className="min-w-0 flex-1 active:bg-muted/40 rounded">
                    <div className="font-medium text-sm truncate flex items-center gap-1.5">
                      <ShoppingCart className="h-3.5 w-3.5 text-primary shrink-0" />
                      {s.customers?.name ?? <span className="text-muted-foreground">Mijozsiz</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {fmtDate(s.created_at)} · <span className="uppercase">{s.payment_method ?? "—"}</span>
                    </div>
                    {(s.sale_items?.length ?? 0) > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                        {s.sale_items!.slice(0, 3).map((it) => `${it.products?.name ?? "—"} ×${Number(it.quantity)} ${getProductUnit(it.products?.name)}`).join(", ")}
                        {s.sale_items!.length > 3 ? ` +${s.sale_items!.length - 3}` : ""}
                      </div>
                    )}
                  </Link>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm font-semibold">{fmtMoney(s.total_sale)}</div>
                    {isSuperAdmin && <div className="text-[11px] font-mono text-success">+{fmtMoney(s.profit)}</div>}
                    {Number(s.remaining_debt) > 0 && <div className="text-[11px] font-mono text-warning">-{fmtMoney(s.remaining_debt)}</div>}
                  </div>
                </div>
                {isSuperAdmin && (
                  <div className="mt-2 flex items-center justify-end gap-1.5">
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openItems(s)} title="Mahsulotlar">
                      <Package className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => openEdit(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setDelSale(s)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {(sales ?? []).length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Hali sotuvlar yo'q</div>}
          </div>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left">Sana</th>
                  <th className="px-4 py-2.5 text-left">Mijoz</th>
                  <th className="px-4 py-2.5 text-left hidden sm:table-cell">To'lov</th>
                  <th className="px-4 py-2.5 text-right">Sotuv</th>
                  {isSuperAdmin && <th className="px-4 py-2.5 text-right hidden md:table-cell">Tannarx</th>}
                  {isSuperAdmin && <th className="px-4 py-2.5 text-right">Foyda</th>}
                  <th className="px-4 py-2.5 text-right">Qarz</th>
                  <th className="px-4 py-2.5 text-left hidden md:table-cell">Status</th>
                  {isSuperAdmin && <th className="px-4 py-2.5 text-right">Amal</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {(sales ?? []).map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      <Link to="/sales/$id" params={{ id: s.id }} className="hover:text-primary inline-flex items-center gap-1">
                        {fmtDate(s.created_at)} <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 max-w-[260px]">
                      <Link to="/sales/$id" params={{ id: s.id }} className="block hover:text-primary">
                        <div className="truncate">{s.customers?.name ?? <span className="text-muted-foreground">—</span>}</div>
                        {(s.sale_items?.length ?? 0) > 0 && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {s.sale_items!.slice(0, 3).map((it) => `${it.products?.name ?? "—"} ×${Number(it.quantity)} ${getProductUnit(it.products?.name)}`).join(", ")}
                            {s.sale_items!.length > 3 ? ` +${s.sale_items!.length - 3}` : ""}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs uppercase hidden sm:table-cell">{s.payment_method ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtMoney(s.total_sale)}</td>
                    {isSuperAdmin && <td className="px-4 py-2.5 text-right font-mono text-muted-foreground hidden md:table-cell">{fmtMoney(s.total_cost)}</td>}
                    {isSuperAdmin && <td className="px-4 py-2.5 text-right font-mono text-success">{fmtMoney(s.profit)}</td>}
                    <td className={cn("px-4 py-2.5 text-right font-mono", Number(s.remaining_debt) > 0 ? "text-warning" : "text-muted-foreground")}>{fmtMoney(s.remaining_debt)}</td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide", s.status === "completed" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
                        <ShoppingCart className="h-3 w-3" />
                        {s.status}
                      </span>
                    </td>
                    {isSuperAdmin && (
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openItems(s)} title="Mahsulotlar">
                            <Package className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(s)} title="Tahrirlash">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDelSale(s)} title="O'chirish">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {(sales ?? []).length === 0 && (
                  <tr>
                    <td colSpan={isSuperAdmin ? 9 : 6} className="px-4 py-12 text-center text-muted-foreground">Hali sotuvlar yo'q</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog open={!!editSale} onOpenChange={(v) => !v && setEditSale(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sotuvni tahrirlash</DialogTitle>
          </DialogHeader>
          {editSale && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-2.5 text-xs">
                Jami: <span className="font-mono font-semibold">{fmtMoney(editSale.total_sale)}</span>
              </div>
              <div className="space-y-1.5">
                <Label>Mijoz</Label>
                <Select value={eCustomer} onValueChange={setECustomer}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Mijozsiz —</SelectItem>
                    {(customers ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>To'lov usuli</Label>
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
                <Label>To'langan summa</Label>
                <Input type="number" value={eAmount} onChange={(e) => setEAmount(e.target.value)} />
                <div className="text-[11px] text-muted-foreground">
                  Yangi qarz: <span className="font-mono">{fmtMoney(Math.max(editSale.total_sale - Number(eAmount || 0), 0))}</span>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSale(null)}>Bekor</Button>
            <Button onClick={() => updateMut.mutate()} disabled={updateMut.isPending}>
              {updateMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delSale} onOpenChange={(v) => !v && setDelSale(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sotuvni butunlay o'chirish?</AlertDialogTitle>
            <AlertDialogDescription>
              Sotuv, sotuv pozitsiyalari, bog'liq to'lovlar va inventarizatsiya harakatlari bazadan butunlay o'chiriladi.
              Mahsulotlar sklatga qaytariladi va mijoz qarzi qayta hisoblanadi. Bu amalni ortga qaytarib bo'lmaydi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => delSale && deleteMut.mutate(delSale.id)}
            >
              Ha, butunlay o'chir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Items edit dialog */}
      <Dialog open={!!itemsSale} onOpenChange={(v) => !v && setItemsSale(null)}>
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
                <div className="col-span-1 flex justify-end">
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setEItems((arr) => arr.filter((_, i) => i !== idx))}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" className="w-full" onClick={() => setEItems((arr) => [...arr, { product_id: "", quantity: "1", sell_price: "0" }])}>
              <Plus className="h-3.5 w-3.5" /> Qator qo'shish
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemsSale(null)}>Bekor</Button>
            <Button onClick={() => updateItemsMut.mutate()} disabled={updateItemsMut.isPending}>
              {updateItemsMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
