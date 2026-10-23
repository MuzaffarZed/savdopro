import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Loader2, Package, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtNum, fmtDate, newIdempotencyKey } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_app/damages")({ component: DamagesPage });

const REASONS = ["Sinish/Buzilish", "Muddati o'tgan", "Yo'qolgan", "Sifatsiz", "Boshqa"];

function DamagesPage() {
  const { user, isSuperAdmin, profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editReason, setEditReason] = useState(REASONS[0]);
  const [editNote, setEditNote] = useState("");

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses-all"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name,type,branch_id").is("deleted_at", null).order("name")).data ?? [],
  });

  // Sotuvchi faqat o'z filiali skladidan brak qila oladi
  const allowedWarehouses = useMemo(() => {
    if (!warehouses) return [];
    if (isSuperAdmin) return warehouses;
    return warehouses.filter((w) => w.branch_id === profile?.branch_id);
  }, [warehouses, isSuperAdmin, profile?.branch_id]);

  useEffect(() => {
    if (!warehouseId && allowedWarehouses.length > 0) setWarehouseId(allowedWarehouses[0].id);
  }, [allowedWarehouses, warehouseId]);

  const { data: stock } = useQuery({
    queryKey: ["damage-stock", warehouseId],
    queryFn: async () => {
      if (!warehouseId) return [] as { product_id: string; name: string; total: number }[];
      const { data } = await supabase.from("inventory_batches").select("product_id,remaining,products(name)").eq("warehouse_id", warehouseId).gt("remaining", 0);
      const map = new Map<string, { product_id: string; name: string; total: number }>();
      (data ?? []).forEach((b) => {
        const p = b.products as unknown as { name: string } | null;
        const ex = map.get(b.product_id);
        if (ex) ex.total += Number(b.remaining);
        else map.set(b.product_id, { product_id: b.product_id, name: p?.name ?? "—", total: Number(b.remaining) });
      });
      return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!warehouseId,
  });

  const filtered = useMemo(() => (stock ?? []).filter((s) => s.name.toLowerCase().includes(search.toLowerCase())), [stock, search]);
  const selectedProduct = useMemo(() => (stock ?? []).find((s) => s.product_id === productId), [stock, productId]);

  const { data: damages, refetch } = useQuery({
    queryKey: ["damages-list"],
    queryFn: async () => fetchAll<any>(supabase
      .from("damages")
      .select("id,created_at,quantity,total_cost,reason,note,warehouse_id,product_id,products(name),warehouses(name)")
      .order("created_at", { ascending: false })),
  });

  useEffect(() => {
    const ch = supabase.channel("damages-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "damages" }, () => {
        refetch();
        qc.invalidateQueries({ queryKey: ["damage-stock"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetch, qc]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!warehouseId) throw new Error("Sklatni tanlang");
      if (!productId) throw new Error("Mahsulotni tanlang");
      const q = Number(quantity);
      if (!q || q <= 0) throw new Error("Miqdor noto'g'ri");
      if (selectedProduct && q > selectedProduct.total) throw new Error("Qoldiq yetarli emas");
      const { data, error } = await supabase.rpc("process_damage", {
        _product_id: productId,
        _warehouse_id: warehouseId,
        _quantity: q,
        _reason: reason,
        _note: note || null,
        _user_id: user!.id,
        _idempotency_key: newIdempotencyKey(),
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Brak qayd etildi", { description: "Qoldiqdan ayrildi" });
      setOpen(false);
      setProductId(""); setQuantity(""); setNote("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_damage", { _damage_id: id, _user_id: user!.id } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("O'chirildi", { description: "Qoldiq tiklandi" }); qc.invalidateQueries(); refetch(); },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error("—");
      const q = Number(editQty);
      if (!q || q <= 0) throw new Error("Miqdor noto'g'ri");
      const { error } = await supabase.rpc("update_damage", {
        _damage_id: editing.id,
        _quantity: q,
        _reason: editReason,
        _note: editNote || null,
        _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Yangilandi"); setEditing(null); qc.invalidateQueries(); refetch(); },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  if (!isSuperAdmin && allowedWarehouses.length === 0) {
    return <Navigate to="/dashboard" />;
  }

  return (
    <>
      <PageHeader
        title="Brak (Defekt)"
        description="Yaroqsiz mahsulotlarni qoldiqdan hisobdan chiqarish"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><AlertTriangle className="h-4 w-4" /> Yangi brak</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Brak qayd etish</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Sklad</Label>
                  <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setProductId(""); }}>
                    <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                    <SelectContent>
                      {allowedWarehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Mahsulot qidirish</Label>
                  <Input placeholder="Nom..." value={search} onChange={(e) => setSearch(e.target.value)} />
                  <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                    {filtered.map((s) => (
                      <button
                        key={s.product_id}
                        type="button"
                        onClick={() => setProductId(s.product_id)}
                        className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent ${productId === s.product_id ? "bg-accent" : ""}`}
                      >
                        <span className="flex items-center gap-2 truncate"><Package className="h-3.5 w-3.5 text-primary shrink-0" />{s.name}</span>
                        <span className="font-mono text-xs text-muted-foreground shrink-0 ml-2">{fmtNum(s.total)}</span>
                      </button>
                    ))}
                    {filtered.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">Bo'sh</div>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Miqdor {selectedProduct ? `(max ${fmtNum(selectedProduct.total)})` : ""}</Label>
                    <Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Sabab</Label>
                    <Select value={reason} onValueChange={setReason}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Izoh</Label>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Qo'shimcha ma'lumot (ixtiyoriy)" rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Bekor</Button>
                <Button disabled={submit.isPending || !productId} onClick={() => submit.mutate()}>
                  {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Saqlash"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="p-3 lg:p-6 pb-24 lg:pb-6">
        <div className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3 text-sm font-semibold">Tarix</div>
          <div className="divide-y">
            {(damages ?? []).map((d: any) => {
              const p = d.products as unknown as { name: string } | null;
              const w = d.warehouses as unknown as { name: string } | null;
              return (
                <div key={d.id} className="px-3 sm:px-4 py-2.5 sm:py-3 grid grid-cols-[1fr_auto] gap-2 items-center">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{p?.name ?? "—"}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {w?.name ?? "—"} · {d.reason} · {fmtDate(d.created_at)}
                      {d.note ? ` · ${d.note}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-2">
                    <div>
                      <div className="font-mono font-semibold text-destructive">−{fmtNum(d.quantity)}</div>
                      {isSuperAdmin && <div className="text-[11px] text-muted-foreground">{fmtMoney(d.total_cost)}</div>}
                    </div>
                    {isSuperAdmin && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                          setEditing(d);
                          setEditQty(String(d.quantity));
                          setEditReason(d.reason);
                          setEditNote(d.note ?? "");
                        }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                          if (confirm("O'chirilsinmi? Qoldiq tiklanadi.")) remove.mutate(d.id);
                        }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {(damages ?? []).length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Hali brak yo'q</div>}
          </div>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Brakni tahrirlash</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3">
              <div className="text-sm text-muted-foreground">
                {(editing.products as any)?.name ?? "—"} · {(editing.warehouses as any)?.name ?? "—"}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Miqdor</Label>
                <Input type="number" min="0" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sabab</Label>
                <Select value={editReason} onValueChange={setEditReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Izoh</Label>
                <Textarea value={editNote} onChange={(e) => setEditNote(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Bekor</Button>
            <Button disabled={update.isPending} onClick={() => update.mutate()}>
              {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
