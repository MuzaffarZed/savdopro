import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Minus, Trash2, ArrowRightLeft, Loader2, Package, Filter, Eye, X, Pencil, FileDown, FileText } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { fmtMoney, fmtNum, fmtDate, newIdempotencyKey } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { downloadCSV } from "@/lib/csv";
import { generatePdfReport } from "@/lib/pdf-report";

export const Route = createFileRoute("/_app/transfers")({ component: TransfersPage });

interface Line { product_id: string; name: string; quantity: number; available: number; }

function TransfersPage() {
  const { user, isSuperAdmin, profile } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState<string>("");
  const [toId, setToId] = useState<string>("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  // History filters
  const [fFrom, setFFrom] = useState<string>("all");
  const [fTo, setFTo] = useState<string>("all");
  const [fProduct, setFProduct] = useState<string>("all");
  const [fDateFrom, setFDateFrom] = useState<string>("");
  const [fDateTo, setFDateTo] = useState<string>("");
  const [openFilter, setOpenFilter] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editNoteOpen, setEditNoteOpen] = useState(false);
  const [editNoteVal, setEditNoteVal] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editItemsOpen, setEditItemsOpen] = useState(false);
  const [editLines, setEditLines] = useState<Line[]>([]);
  const [editNote2, setEditNote2] = useState("");
  const [editSearch, setEditSearch] = useState("");

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses-all"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name,type,branch_id").is("deleted_at", null).order("name")).data ?? [],
  });

  const mainWh = useMemo(() => warehouses?.filter((w) => w.type === "main") ?? [], [warehouses]);
  const allBranchWh = useMemo(() => warehouses?.filter((w) => w.type === "branch") ?? [], [warehouses]);
  // Sotuvchi uchun: faqat o'z filiali sklatlarini ko'rsat
  const branchWh = useMemo(() => {
    if (isSuperAdmin) return allBranchWh;
    return allBranchWh.filter((w) => w.branch_id === profile?.branch_id);
  }, [allBranchWh, isSuperAdmin, profile?.branch_id]);

  useEffect(() => {
    if (!fromId && mainWh.length > 0) setFromId(mainWh[0].id);
  }, [mainWh, fromId]);

  // Sotuvchi uchun manzilni avtomatik o'z filiali sklatiga
  useEffect(() => {
    if (!isSuperAdmin && !toId && branchWh.length > 0) setToId(branchWh[0].id);
  }, [isSuperAdmin, toId, branchWh]);

  const { data: stock } = useQuery({
    queryKey: ["transfer-stock", fromId],
    queryFn: async () => {
      if (!fromId) return [];
      const { data } = await supabase.from("inventory_batches").select("product_id,remaining,products(name)").eq("warehouse_id", fromId).gt("remaining", 0);
      const map = new Map<string, { product_id: string; name: string; total: number }>();
      (data ?? []).forEach((b) => {
        const p = b.products as unknown as { name: string } | null;
        const ex = map.get(b.product_id);
        if (ex) ex.total += Number(b.remaining);
        else map.set(b.product_id, { product_id: b.product_id, name: p?.name ?? "—", total: Number(b.remaining) });
      });
      return Array.from(map.values());
    },
    enabled: !!fromId,
  });

  const filtered = useMemo(() => (stock ?? []).filter((s) => s.name.toLowerCase().includes(search.toLowerCase())), [stock, search]);

  const { data: transfers, refetch } = useQuery({
    queryKey: ["transfers", fFrom, fTo, fProduct, fDateFrom, fDateTo],
    queryFn: async () => {
      // Agar mahsulot filtri tanlangan bo'lsa, transfer_items'dan transfer_id'larni olamiz
      let allowedIds: Set<string> | null = null;
      if (fProduct !== "all") {
        const tis = await fetchAll<{ transfer_id: string }>(supabase.from("transfer_items").select("transfer_id").eq("product_id", fProduct));
        allowedIds = new Set(tis.map((x) => x.transfer_id));
        if (allowedIds.size === 0) return [];
      }
      let q = supabase.from("transfers").select("id,created_at,note,total_quantity,total_cost,from_warehouse_id,to_warehouse_id,created_by").order("created_at", { ascending: false });
      if (fFrom !== "all") q = q.eq("from_warehouse_id", fFrom);
      if (fTo !== "all") q = q.eq("to_warehouse_id", fTo);
      if (fDateFrom) q = q.gte("created_at", `${fDateFrom}T00:00:00`);
      if (fDateTo) q = q.lte("created_at", `${fDateTo}T23:59:59`);
      const list = await fetchAll<any>(q);
      return allowedIds ? list.filter((t) => allowedIds!.has(t.id)) : list;
    },
  });

  const { data: allProducts } = useQuery({
    queryKey: ["products-all-for-filter"],
    queryFn: async () => (await supabase.from("products").select("id,name").is("deleted_at", null).order("name")).data ?? [],
  });

  // Detail
  const { data: detail } = useQuery({
    queryKey: ["transfer-detail", detailId],
    queryFn: async () => {
      if (!detailId) return null;
      const [{ data: t }, { data: items }] = await Promise.all([
        supabase.from("transfers").select("*,from_warehouse_id,to_warehouse_id").eq("id", detailId).maybeSingle(),
        supabase.from("transfer_items").select("product_id,quantity,cost_price,products(name)").eq("transfer_id", detailId),
      ]);
      const list = items ?? [];
      // Fallback: agar products embed null bo'lsa, alohida so'rov bilan to'ldiramiz
      const missing = list.filter((it: any) => !it.products?.name).map((it: any) => it.product_id);
      if (missing.length > 0) {
        const { data: prods } = await supabase.from("products").select("id,name").in("id", missing);
        const pmap = new Map((prods ?? []).map((p) => [p.id, p.name]));
        list.forEach((it: any) => {
          if (!it.products?.name) it.products = { name: pmap.get(it.product_id) ?? "—" };
        });
      }
      return { t, items: list };
    },
    enabled: !!detailId,
  });

  // Audit log (super admin only)
  const { data: auditLog } = useQuery({
    queryKey: ["transfer-audit", detailId],
    queryFn: async () => {
      if (!detailId) return [];
      const { data } = await supabase
        .from("transfer_audit_log" as never)
        .select("id,action,actor_id,old_note,new_note,created_at")
        .eq("transfer_id", detailId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Array<{ id: string; action: string; actor_id: string | null; old_note: string | null; new_note: string | null; created_at: string }>;
    },
    enabled: !!detailId && isSuperAdmin,
  });

  // Realtime
  useEffect(() => {
    const ch = supabase.channel("transfers-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "transfers" }, () => { refetch(); qc.invalidateQueries({ queryKey: ["transfer-stock"] }); })
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_batches" }, () => qc.invalidateQueries({ queryKey: ["transfer-stock"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetch, qc]);

  const wmap = useMemo(() => new Map((warehouses ?? []).map((w) => [w.id, w.name])), [warehouses]);

  const updateNote = useMutation({
    mutationFn: async () => {
      if (!detailId) throw new Error("Transfer tanlanmagan");
      const { error } = await supabase.rpc("update_transfer_note", {
        _transfer_id: detailId,
        _note: editNoteVal || null,
        _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Izoh yangilandi");
      setEditNoteOpen(false);
      qc.invalidateQueries({ queryKey: ["transfer-detail", detailId] });
      refetch();
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  const deleteTransfer = useMutation({
    mutationFn: async () => {
      if (!detailId) throw new Error("Transfer tanlanmagan");
      const { error } = await supabase.rpc("delete_transfer", {
        _transfer_id: detailId,
        _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer o'chirildi", { description: "Sklat qoldiqlari tiklandi" });
      setConfirmDelete(false);
      setDetailId(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("O'chirib bo'lmadi", { description: e.message }),
  });

  // Source stock for edit dialog (current source warehouse)
  const { data: editStock } = useQuery({
    queryKey: ["transfer-edit-stock", detail?.t?.from_warehouse_id, editItemsOpen],
    queryFn: async () => {
      const wid = detail?.t?.from_warehouse_id;
      if (!wid) return [];
      const { data } = await supabase.from("inventory_batches").select("product_id,remaining,products(name)").eq("warehouse_id", wid).gt("remaining", 0);
      const map = new Map<string, { product_id: string; name: string; total: number }>();
      (data ?? []).forEach((b) => {
        const p = b.products as unknown as { name: string } | null;
        const ex = map.get(b.product_id);
        if (ex) ex.total += Number(b.remaining);
        else map.set(b.product_id, { product_id: b.product_id, name: p?.name ?? "—", total: Number(b.remaining) });
      });
      return Array.from(map.values());
    },
    enabled: !!detail?.t?.from_warehouse_id && editItemsOpen,
  });

  const editFiltered = useMemo(() => {
    const list = editStock ?? [];
    // Augment availability with the qty already in this transfer (will be returned to source on save)
    const carry = new Map(editLines.map((l) => [l.product_id, l.quantity]));
    return list
      .map((s) => ({ ...s, total: s.total + (carry.get(s.product_id) ?? 0) }))
      .filter((s) => s.name.toLowerCase().includes(editSearch.toLowerCase()));
  }, [editStock, editSearch, editLines]);

  const openEditItems = () => {
    if (!detail?.items) return;
    const lns: Line[] = detail.items.map((it: any) => ({
      product_id: it.product_id,
      name: (it.products as { name: string } | null)?.name ?? "—",
      quantity: Number(it.quantity),
      available: Number(it.quantity), // refined once editStock loads
    }));
    setEditLines(lns);
    setEditNote2(detail.t?.note ?? "");
    setEditSearch("");
    setEditItemsOpen(true);
  };

  // Refresh availability on each line once editStock loads
  useEffect(() => {
    if (!editItemsOpen || !editStock) return;
    setEditLines((cur) => cur.map((l) => {
      const s = editStock.find((x) => x.product_id === l.product_id);
      const sourceAvail = s?.total ?? 0;
      return { ...l, available: sourceAvail + l.quantity };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editStock, editItemsOpen]);

  const addEditLine = (s: { product_id: string; name: string; total: number }) => {
    setEditLines((c) => {
      const ex = c.find((l) => l.product_id === s.product_id);
      if (ex) {
        if (ex.quantity + 1 > s.total) { toast.error("Qoldiq yetarli emas"); return c; }
        return c.map((l) => l.product_id === s.product_id ? { ...l, quantity: l.quantity + 1, available: s.total } : l);
      }
      return [...c, { product_id: s.product_id, name: s.name, quantity: 1, available: s.total }];
    });
  };
  const setEditQty = (pid: string, q: number) => setEditLines((c) => c.map((l) => l.product_id === pid ? { ...l, quantity: Math.min(Math.max(0, q), l.available) } : l).filter((l) => l.quantity > 0));
  const removeEdit = (pid: string) => setEditLines((c) => c.filter((l) => l.product_id !== pid));

  const updateItems = useMutation({
    mutationFn: async () => {
      if (!detailId) throw new Error("Transfer tanlanmagan");
      if (editLines.length === 0) throw new Error("Mahsulot qo'shing");
      const idempotencyKey = `transfer-edit:${detailId}:${editLines.map((l) => `${l.product_id}x${l.quantity}`).sort().join("|")}:${editNote2 || ""}`;
      const { error } = await supabase.rpc("update_transfer_items" as never, {
        _transfer_id: detailId,
        _items: editLines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        _note: editNote2 || null,
        _user_id: user!.id,
        _idempotency_key: idempotencyKey,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer yangilandi", { description: "FIFO bo'yicha qayta hisoblandi" });
      setEditItemsOpen(false);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Tahrirlab bo'lmadi", { description: e.message }),
  });

  const addLine = (s: { product_id: string; name: string; total: number }) => {
    setLines((c) => {
      const ex = c.find((l) => l.product_id === s.product_id);
      if (ex) {
        if (ex.quantity + 1 > s.total) { toast.error("Qoldiq yetarli emas"); return c; }
        return c.map((l) => l.product_id === s.product_id ? { ...l, quantity: l.quantity + 1 } : l);
      }
      return [...c, { product_id: s.product_id, name: s.name, quantity: 1, available: s.total }];
    });
  };
  const setQty = (pid: string, q: number) => setLines((c) => c.map((l) => l.product_id === pid ? { ...l, quantity: Math.min(Math.max(0, q), l.available) } : l).filter((l) => l.quantity > 0));
  const remove = (pid: string) => setLines((c) => c.filter((l) => l.product_id !== pid));

  const submit = useMutation({
    mutationFn: async () => {
      if (!fromId || !toId) throw new Error("Sklatlarni tanlang");
      if (fromId === toId) throw new Error("Manba va manzil bir xil bo'lmasin");
      if (lines.length === 0) throw new Error("Mahsulot qo'shing");
      const { data, error } = await supabase.rpc("process_transfer", {
        _from_warehouse_id: fromId,
        _to_warehouse_id: toId,
        _items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        _note: note || null,
        _user_id: user!.id,
        _idempotency_key: newIdempotencyKey(),
      } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Transfer yakunlandi", { description: "FIFO bo'yicha partiyalar ko'chirildi" });
      setOpen(false); setLines([]); setNote(""); setToId("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  // Super admin emas va tegishli filial sklati yo'q bo'lsa — kira olmaydi
  if (!isSuperAdmin && (!profile?.branch_id || branchWh.length === 0)) {
    return <Navigate to="/dashboard" />;
  }

  return (
    <>
      <PageHeader
        title="Ichki transferlar"
        description="Asosiy sklatdan filiallarga FIFO bo'yicha mahsulot ko'chirish"
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><ArrowRightLeft className="h-4 w-4" /> Yangi transfer</Button></DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Yangi transfer</DialogTitle></DialogHeader>
              <div className="grid gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Manba (Asosiy sklad)</Label>
                    <Select value={fromId} onValueChange={setFromId}>
                      <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                      <SelectContent>{mainWh.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Manzil (Filial)</Label>
                    <Select value={toId} onValueChange={setToId}>
                      <SelectTrigger><SelectValue placeholder="Filial tanlang" /></SelectTrigger>
                      <SelectContent>{branchWh.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Mahsulot qidirish</Label>
                    <Input placeholder="Nom..." value={search} onChange={(e) => setSearch(e.target.value)} />
                    <div className="border rounded-md max-h-48 sm:max-h-64 overflow-y-auto divide-y">
                      {filtered.map((s) => (
                        <button key={s.product_id} onClick={() => addLine(s)} className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent">
                          <span className="flex items-center gap-2"><Package className="h-3.5 w-3.5 text-primary" />{s.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{fmtNum(s.total)}</span>
                        </button>
                      ))}
                      {filtered.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">{fromId ? "Bo'sh" : "Manba tanlang"}</div>}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Tanlangan ({lines.length})</Label>
                    <div className="border rounded-md max-h-48 sm:max-h-64 overflow-y-auto divide-y">
                      {lines.map((l) => (
                        <div key={l.product_id} className="px-3 py-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="text-sm font-medium flex-1 truncate">{l.name}</div>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove(l.product_id)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => setQty(l.product_id, l.quantity - 1)}><Minus className="h-3 w-3" /></Button>
                            <Input type="number" className="h-7 text-xs" value={l.quantity} onChange={(e) => setQty(l.product_id, Number(e.target.value))} />
                            <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => setQty(l.product_id, l.quantity + 1)}><Plus className="h-3 w-3" /></Button>
                            <span className="text-[10px] text-muted-foreground ml-1">/ {fmtNum(l.available)}</span>
                          </div>
                        </div>
                      ))}
                      {lines.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">Mahsulot tanlang</div>}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5"><Label className="text-xs">Izoh</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ixtiyoriy" /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Bekor</Button>
                <Button disabled={submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Yuborish"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <div className="p-3 lg:p-6 pb-24 lg:pb-6">
        <div className="rounded-lg border bg-card">
          <div className="border-b px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Tarix ({transfers?.length ?? 0})</div>
            <div className="flex items-center gap-1.5">
              {(fFrom !== "all" || fTo !== "all" || fProduct !== "all" || fDateFrom || fDateTo) && (
                <Button size="sm" variant="ghost" onClick={() => { setFFrom("all"); setFTo("all"); setFProduct("all"); setFDateFrom(""); setFDateTo(""); }}>
                  <X className="h-3.5 w-3.5" /> Tozalash
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={!transfers?.length} onClick={() => {
                const rows = (transfers ?? []).map((t: any) => ({
                  Sana: fmtDate(t.created_at),
                  Manba: wmap.get(t.from_warehouse_id) ?? "—",
                  Manzil: wmap.get(t.to_warehouse_id) ?? "—",
                  Soni: Number(t.total_quantity),
                  ...(isSuperAdmin ? { Qiymati: Number(t.total_cost) } : {}),
                  Izoh: t.note ?? "",
                }));
                downloadCSV(`transferlar-${new Date().toISOString().slice(0,10)}.csv`, rows);
              }}>
                <FileDown className="h-3.5 w-3.5" /> CSV
              </Button>
              <Button size="sm" variant="outline" disabled={!transfers?.length} onClick={() => {
                const cols = [
                  { header: "Sana", key: "date" },
                  { header: "Manba", key: "from" },
                  { header: "Manzil", key: "to" },
                  { header: "Soni", key: "qty", align: "right" as const, number: true },
                  ...(isSuperAdmin ? [{ header: "Qiymati", key: "cost", align: "right" as const, money: true }] : []),
                  { header: "Izoh", key: "note" },
                ];
                const rows = (transfers ?? []).map((t: any) => ({
                  date: fmtDate(t.created_at),
                  from: wmap.get(t.from_warehouse_id) ?? "—",
                  to: wmap.get(t.to_warehouse_id) ?? "—",
                  qty: Number(t.total_quantity),
                  cost: Number(t.total_cost),
                  note: t.note ?? "",
                }));
                const totalQty = rows.reduce((a, r) => a + r.qty, 0);
                const totalCost = rows.reduce((a, r) => a + r.cost, 0);
                generatePdfReport({
                  title: "Ichki transferlar",
                  subtitle: `Jami ${rows.length} ta transfer`,
                  columns: cols,
                  rows,
                  filename: `transferlar-${new Date().toISOString().slice(0,10)}.pdf`,
                  kpis: [
                    { label: "Transferlar", value: String(rows.length) },
                    { label: "Jami soni", value: fmtNum(totalQty) },
                    ...(isSuperAdmin ? [{ label: "Jami qiymati", value: fmtMoney(totalCost) }] : []),
                  ],
                });
              }}>
                <FileText className="h-3.5 w-3.5" /> PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpenFilter(true)}>
                <Filter className="h-3.5 w-3.5" /> Filtr
              </Button>
            </div>
          </div>
          <div className="divide-y max-h-[70vh] overflow-y-auto">
            {(transfers ?? []).map((t: any) => (
              <button key={t.id} onClick={() => setDetailId(t.id)} className="w-full text-left px-3 sm:px-4 py-2.5 sm:py-3 grid grid-cols-[1fr_auto_auto] gap-2 sm:gap-3 items-center text-sm hover:bg-accent/40">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium text-sm min-w-0">
                    <span className="truncate">{wmap.get(t.from_warehouse_id) ?? "—"}</span>
                    <ArrowRightLeft className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate">{wmap.get(t.to_warehouse_id) ?? "—"}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{fmtDate(t.created_at)}{t.note ? ` · ${t.note}` : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono font-semibold">{fmtNum(t.total_quantity)}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtMoney(t.total_cost)}</div>
                </div>
                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            ))}
            {(transfers ?? []).length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Transferlar topilmadi</div>}
          </div>
        </div>
      </div>

      {/* Filter dialog */}
      <Dialog open={openFilter} onOpenChange={setOpenFilter}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Transferlar tarixini filtrlash</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Manba sklad</Label>
                <Select value={fFrom} onValueChange={setFFrom}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Barchasi</SelectItem>
                    {(warehouses ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Manzil sklad</Label>
                <Select value={fTo} onValueChange={setFTo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Barchasi</SelectItem>
                    {(warehouses ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mahsulot</Label>
              <Select value={fProduct} onValueChange={setFProduct}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">Barcha mahsulotlar</SelectItem>
                  {(allProducts ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Sana (dan)</Label>
                <Input type="date" value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Sana (gacha)</Label>
                <Input type="date" value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFFrom("all"); setFTo("all"); setFProduct("all"); setFDateFrom(""); setFDateTo(""); }}>Tozalash</Button>
            <Button onClick={() => setOpenFilter(false)}>Qo'llash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detailId} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Transfer tafsilotlari</DialogTitle></DialogHeader>
          {detail?.t && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <span>{wmap.get(detail.t.from_warehouse_id) ?? "—"}</span>
                  <ArrowRightLeft className="h-3.5 w-3.5 text-primary" />
                  <span>{wmap.get(detail.t.to_warehouse_id) ?? "—"}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{fmtDate(detail.t.created_at)}</div>
                {detail.t.note && <div className="mt-1 text-xs">Izoh: {detail.t.note}</div>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-muted-foreground">Mahsulotlar ({detail.items.length})</div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" disabled={!detail.items.length} onClick={() => {
                    const rows = detail.items.map((it) => {
                      const p = it.products as unknown as { name: string } | null;
                      return {
                        Mahsulot: p?.name ?? "—",
                        Soni: Number(it.quantity),
                        ...(isSuperAdmin ? { Tannarx: Number(it.cost_price), Jami: Number(it.quantity) * Number(it.cost_price) } : {}),
                      };
                    });
                    downloadCSV(`transfer-${detailId?.slice(0,8)}.csv`, rows);
                  }}>
                    <FileDown className="h-3.5 w-3.5" /> CSV
                  </Button>
                  <Button size="sm" variant="outline" disabled={!detail.items.length} onClick={() => {
                    const cols = [
                      { header: "Mahsulot", key: "name" },
                      { header: "Soni", key: "qty", align: "right" as const, number: true },
                      ...(isSuperAdmin ? [
                        { header: "Tannarx", key: "cost", align: "right" as const, money: true },
                        { header: "Jami", key: "total", align: "right" as const, money: true },
                      ] : []),
                    ];
                    const rows = detail.items.map((it) => {
                      const p = it.products as unknown as { name: string } | null;
                      return {
                        name: p?.name ?? "—",
                        qty: Number(it.quantity),
                        cost: Number(it.cost_price),
                        total: Number(it.quantity) * Number(it.cost_price),
                      };
                    });
                    generatePdfReport({
                      title: "Transfer tafsilotlari",
                      subtitle: `${wmap.get(detail.t!.from_warehouse_id) ?? "—"} → ${wmap.get(detail.t!.to_warehouse_id) ?? "—"} · ${fmtDate(detail.t!.created_at)}`,
                      columns: cols,
                      rows,
                      filename: `transfer-${detailId?.slice(0,8)}.pdf`,
                    });
                  }}>
                    <FileText className="h-3.5 w-3.5" /> PDF
                  </Button>
                </div>
              </div>
              <div className="rounded-md border max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground sticky top-0">
                    <tr><th className="px-3 py-2 text-left">Mahsulot</th><th className="px-3 py-2 text-right">Soni</th>{isSuperAdmin && <th className="px-3 py-2 text-right">Tannarx</th>}{isSuperAdmin && <th className="px-3 py-2 text-right">Jami</th>}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {detail.items.map((it, i) => {
                      const p = it.products as unknown as { name: string } | null;
                      return (
                        <tr key={i}>
                          <td className="px-3 py-2">{p?.name ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmtNum(it.quantity)}</td>
                          {isSuperAdmin && <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmtMoney(it.cost_price)}</td>}
                          {isSuperAdmin && <td className="px-3 py-2 text-right font-mono font-semibold">{fmtMoney(Number(it.quantity) * Number(it.cost_price))}</td>}
                        </tr>
                      );
                    })}
                    {detail.items.length === 0 && <tr><td colSpan={isSuperAdmin ? 4 : 2} className="px-3 py-6 text-center text-xs text-muted-foreground">Mahsulotlar topilmadi</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Jami</span>
                <span className="font-mono font-semibold">{fmtNum(detail.t.total_quantity)} dona{isSuperAdmin ? ` · ${fmtMoney(detail.t.total_cost)}` : ""}</span>
              </div>
              {isSuperAdmin && (
                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Button size="sm" variant="outline" onClick={openEditItems}>
                    <Pencil className="h-3.5 w-3.5" /> Mahsulotlarni tahrirlash
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditNoteVal(detail.t?.note ?? ""); setEditNoteOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" /> Izohni tahrirlash
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-3.5 w-3.5" /> O'chirish
                  </Button>
                </div>
              )}
              {isSuperAdmin && auditLog && auditLog.length > 0 && (
                <div className="rounded-md border bg-muted/20 p-2">
                  <div className="text-xs font-semibold mb-1.5">Audit log ({auditLog.length})</div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {auditLog.map((a) => (
                      <div key={a.id} className="text-[11px] border-l-2 border-primary/40 pl-2">
                        <div className="font-medium">{a.action === "update_note" ? "Izoh o'zgartirildi" : "O'chirildi"} · {fmtDate(a.created_at)}</div>
                        {a.action === "update_note" && (
                          <div className="text-muted-foreground">
                            <span className="line-through">{a.old_note || "—"}</span> → <span className="text-foreground">{a.new_note || "—"}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit items dialog */}
      <Dialog open={editItemsOpen} onOpenChange={setEditItemsOpen}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Transfer mahsulotlarini tahrirlash</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="text-xs text-muted-foreground">
              Eslatma: faqat manzil partiyalaridan hech nima sotilmagan/ko'chirilmagan bo'lsa tahrirlash mumkin. Saqlaganda manba sklatdan FIFO bo'yicha qayta hisoblanadi.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Mahsulot qidirish (manba sklat)</Label>
                <Input placeholder="Nom..." value={editSearch} onChange={(e) => setEditSearch(e.target.value)} />
                <div className="border rounded-md max-h-48 sm:max-h-64 overflow-y-auto divide-y">
                  {editFiltered.map((s) => (
                    <button key={s.product_id} onClick={() => addEditLine(s)} className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent">
                      <span className="flex items-center gap-2"><Package className="h-3.5 w-3.5 text-primary" />{s.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{fmtNum(s.total)}</span>
                    </button>
                  ))}
                  {editFiltered.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">Bo'sh</div>}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tanlangan ({editLines.length})</Label>
                <div className="border rounded-md max-h-48 sm:max-h-64 overflow-y-auto divide-y">
                  {editLines.map((l) => (
                    <div key={l.product_id} className="px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-medium flex-1 truncate">{l.name}</div>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeEdit(l.product_id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => setEditQty(l.product_id, l.quantity - 1)}><Minus className="h-3 w-3" /></Button>
                        <Input type="number" className="h-7 text-xs" value={l.quantity} onChange={(e) => setEditQty(l.product_id, Number(e.target.value))} />
                        <Button size="icon" variant="outline" className="h-6 w-6" onClick={() => setEditQty(l.product_id, l.quantity + 1)}><Plus className="h-3 w-3" /></Button>
                        <span className="text-[10px] text-muted-foreground ml-1">/ {fmtNum(l.available)}</span>
                      </div>
                    </div>
                  ))}
                  {editLines.length === 0 && <div className="px-3 py-6 text-center text-xs text-muted-foreground">Mahsulot tanlang</div>}
                </div>
              </div>
            </div>
            <div className="space-y-1.5"><Label className="text-xs">Izoh</Label><Input value={editNote2} onChange={(e) => setEditNote2(e.target.value)} placeholder="Ixtiyoriy" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItemsOpen(false)}>Bekor</Button>
            <Button disabled={updateItems.isPending} onClick={() => updateItems.mutate()}>
              {updateItems.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit note dialog */}
      <Dialog open={editNoteOpen} onOpenChange={setEditNoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Izohni tahrirlash</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Izoh</Label>
            <Input value={editNoteVal} onChange={(e) => setEditNoteVal(e.target.value)} placeholder="Ixtiyoriy" />
            <p className="text-[11px] text-muted-foreground">Eslatma: faqat izoh tahrirlanadi. Mahsulot yoki miqdorni o'zgartirish uchun transferni o'chirib qaytadan yarating.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditNoteOpen(false)}>Bekor</Button>
            <Button disabled={updateNote.isPending} onClick={() => updateNote.mutate()}>
              {updateNote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transferni o'chirasizmi?</AlertDialogTitle>
            <AlertDialogDescription>
              Manba sklatga qoldiqlar tiklanadi va manzil partiyalari o'chiriladi. Agar manzil partiyasidan biror dona sotilgan yoki ko'chirilgan bo'lsa — o'chirib bo'lmaydi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction disabled={deleteTransfer.isPending} onClick={(e) => { e.preventDefault(); deleteTransfer.mutate(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteTransfer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ha, o'chirish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
