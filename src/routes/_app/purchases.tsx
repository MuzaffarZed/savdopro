import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Warehouse, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtNum, fmtDate, newIdempotencyKey } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";

export const Route = createFileRoute("/_app/purchases")({ component: PurchasesPage });

function PurchasesPage() {
  const { isSuperAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<{ id: string; quantity: string; cost_price: string; note: string } | null>(null);

  const { data: products } = useQuery({ queryKey: ["products"], queryFn: async () => (await supabase.from("products").select("id,name,category").is("deleted_at", null).order("name")).data ?? [] });
  const { data: warehouses } = useQuery({ queryKey: ["warehouses"], queryFn: async () => (await supabase.from("warehouses").select("id,name,type").is("deleted_at", null).order("type")).data ?? [] });
  const { data: purchases } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => fetchAll<any>(supabase.from("purchases").select("id,quantity,cost_price,total_cost,note,created_at,products(name,category),warehouses(name)").order("created_at", { ascending: false })),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("process_purchase", {
        _product_id: productId,
        _warehouse_id: warehouseId,
        _quantity: Number(quantity),
        _cost_price: Number(costPrice),
        _note: note.trim() || "",
        _user_id: user!.id,
        _idempotency_key: newIdempotencyKey(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Xarid qabul qilindi", { description: "Yangi FIFO partiyasi yaratildi" });
      setOpen(false); setProductId(""); setQuantity(""); setCostPrice(""); setNote("");
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["batches"] });
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const { error } = await supabase.rpc("update_purchase", {
        _purchase_id: editing.id,
        _quantity: Number(editing.quantity),
        _cost_price: Number(editing.cost_price),
        _note: editing.note.trim() || "",
        _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Xarid yangilandi");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["batches"] });
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_purchase", {
        _purchase_id: id,
        _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Xarid o'chirildi");
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["batches"] });
    },
    onError: (e: Error) => toast.error("O'chirib bo'lmadi", { description: e.message }),
  });

  if (!isSuperAdmin) return <Navigate to="/dashboard" />;

  return (
    <>
      <PageHeader title="Xaridlar (Kirim)" description="Yangi FIFO partiyalari" action={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1.5" /><span className="hidden sm:inline">Yangi xarid</span><span className="sm:hidden">Yangi</span></Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Yangi xarid (kirim)</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Mahsulot *</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>{(products ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Sklad *</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                  <SelectContent>{(warehouses ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(() => {
                  const selectedP = (products ?? []).find((p) => p.id === productId);
                  const isQop = (selectedP?.category || "").toLowerCase().includes("parashok") || (selectedP?.name || "").toLowerCase().includes("parashok") || (selectedP?.name || "").toLowerCase().includes("aprel") || (selectedP?.name || "").toLowerCase().includes("avtomat") || (selectedP?.name || "").toLowerCase().includes("nixol");
                  const unitLabel = isQop ? "qop" : "dona";
                  return (
                    <div className="space-y-1.5"><Label>Miqdor ({unitLabel}) *</Label><Input type="number" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
                  );
                })()}
                <div className="space-y-1.5"><Label>Tannarx *</Label><Input type="number" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} /></div>
              </div>
              <div className="space-y-1.5"><Label>Izoh</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
              {quantity && costPrice && <div className="rounded-md bg-accent/50 px-3 py-2 text-sm">Jami: <span className="font-semibold">{fmtMoney(Number(quantity) * Number(costPrice))}</span></div>}
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={!productId || !warehouseId || !quantity || !costPrice || create.isPending}>Qabul qilish</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      } />
      <div className="p-3 lg:p-6 pb-24 lg:pb-6">
        <div className="rounded-lg border bg-card overflow-hidden">
          {/* Mobile cards */}
          <div className="sm:hidden divide-y">
            {(purchases ?? []).map((p) => {
              const pr = p.products as unknown as { name: string } | null;
              const w = p.warehouses as unknown as { name: string } | null;
              return (
                <div key={p.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate flex items-center gap-1.5"><Warehouse className="h-3.5 w-3.5 text-primary" />{pr?.name ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{w?.name ?? "—"} · {fmtDate(p.created_at)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      {(() => {
                        const isPQop = (pr?.category || "").toLowerCase().includes("parashok") || (pr?.name || "").toLowerCase().includes("parashok") || (pr?.name || "").toLowerCase().includes("aprel") || (pr?.name || "").toLowerCase().includes("avtomat") || (pr?.name || "").toLowerCase().includes("nixol");
                        const pUnit = isPQop ? "qop" : "dona";
                        return (
                          <>
                            <div className="font-mono text-sm font-semibold">{fmtMoney(p.total_cost)}</div>
                            <div className="text-[11px] text-muted-foreground font-mono">{fmtNum(p.quantity)} {pUnit} × {fmtMoney(p.cost_price)}</div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  {isSuperAdmin && (
                    <div className="mt-1.5 flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing({ id: p.id, quantity: String(p.quantity), cost_price: String(p.cost_price), note: p.note ?? "" })}>
                        <Pencil className="h-3 w-3 mr-1" /> Tahrir
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => { if (confirm("Xaridni o'chirish? Bu amalni bekor qilib bo'lmaydi.")) remove.mutate(p.id); }}>
                        <Trash2 className="h-3 w-3 mr-1" /> O'chir
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {(purchases ?? []).length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Hali xaridlar yo'q</div>}
          </div>
          <div className="hidden sm:block overflow-x-auto"><table className="w-full text-sm min-w-[720px]">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2.5 text-left">Sana</th><th className="px-4 py-2.5 text-left">Mahsulot</th><th className="px-4 py-2.5 text-left">Sklad</th><th className="px-4 py-2.5 text-right">Miqdor</th><th className="px-4 py-2.5 text-right">Tannarx</th><th className="px-4 py-2.5 text-right">Jami</th><th className="w-24" /></tr>
            </thead>
            <tbody className="divide-y">
              {(purchases ?? []).map((p) => {
                const pr = p.products as unknown as { name: string } | null;
                const w = p.warehouses as unknown as { name: string } | null;
                return (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(p.created_at)}</td>
                    <td className="px-4 py-2.5 font-medium flex items-center gap-2"><Warehouse className="h-3.5 w-3.5 text-primary" />{pr?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{w?.name ?? "—"}</td>
                    {(() => {
                      const isPQop = (pr?.category || "").toLowerCase().includes("parashok") || (pr?.name || "").toLowerCase().includes("parashok") || (pr?.name || "").toLowerCase().includes("aprel") || (pr?.name || "").toLowerCase().includes("avtomat") || (pr?.name || "").toLowerCase().includes("nixol");
                      const pUnit = isPQop ? "qop" : "dona";
                      return (
                        <td className="px-4 py-2.5 text-right font-mono">{fmtNum(p.quantity)} <span className="text-xs text-muted-foreground">{pUnit}</span></td>
                      );
                    })()}
                    <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(p.cost_price)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtMoney(p.total_cost)}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditing({ id: p.id, quantity: String(p.quantity), cost_price: String(p.cost_price), note: p.note ?? "" })}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm("Xaridni o'chirish? Bu amalni bekor qilib bo'lmaydi.")) remove.mutate(p.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(purchases ?? []).length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">Hali xaridlar yo'q</td></tr>}
            </tbody>
          </table></div>
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Xaridni tahrirlash</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="rounded-md bg-warning/10 border border-warning/30 p-2.5 text-xs text-warning">
                Diqqat: faqat sotilmagan/ko'chirilmagan partiyani o'zgartirish mumkin.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Miqdor *</Label><Input type="number" step="0.001" value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Tannarx *</Label><Input type="number" step="0.01" value={editing.cost_price} onChange={(e) => setEditing({ ...editing, cost_price: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Izoh</Label><Input value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} /></div>
              {editing.quantity && editing.cost_price && <div className="rounded-md bg-accent/50 px-3 py-2 text-sm">Jami: <span className="font-semibold">{fmtMoney(Number(editing.quantity) * Number(editing.cost_price))}</span></div>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Bekor</Button>
            <Button onClick={() => update.mutate()} disabled={!editing?.quantity || !editing?.cost_price || update.isPending}>Saqlash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
