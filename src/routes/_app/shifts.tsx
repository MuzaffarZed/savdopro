import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useOpenShifts } from "@/lib/use-active-shift";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { StatCard } from "@/components/layout/StatCard";
import { Clock, Play, Square, Banknote, CreditCard, AlertCircle, ShoppingCart, ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fetchAll } from "@/lib/fetch-all";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_app/shifts")({ component: ShiftsPage });

function ShiftsPage() {
  const { user, profile, isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const { data: openShifts } = useOpenShifts();
  const [openDlg, setOpenDlg] = useState(false);
  const [openingCash, setOpeningCash] = useState("0");
  const [warehouseId, setWarehouseId] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [closeDlg, setCloseDlg] = useState(false);
  const [note, setNote] = useState("");
  const [closingShift, setClosingShift] = useState<{ id: string; opening_cash: number; warehouse_name?: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses-shift"],
    queryFn: async () => {
      let q = supabase.from("warehouses").select("id,name,branch_id,type").is("deleted_at", null).eq("type", "branch");
      if (!isSuperAdmin && profile?.branch_id) q = q.eq("branch_id", profile.branch_id);
      return (await q).data ?? [];
    },
  });

  const { data: shifts } = useQuery({
    queryKey: ["shifts-history", user?.id, profile?.branch_id, isSuperAdmin],
    queryFn: async () => {
      let q = supabase.from("shifts").select("*").order("opened_at", { ascending: false });
      // Sotuvchi ham o'z filialidagi barcha smenalarni ko'rsin (admin tomonidan u uchun ochilgan)
      if (!isSuperAdmin && profile?.branch_id) q = q.eq("branch_id", profile.branch_id);
      const rows = await fetchAll<any>(q);
      const warehouseIds = Array.from(new Set(rows.map((r: any) => r.warehouse_id).filter(Boolean))) as string[];
      const branchIds = Array.from(new Set(rows.map((r: any) => r.branch_id).filter(Boolean))) as string[];
      const [{ data: whs }, { data: brs }] = await Promise.all([
        warehouseIds.length ? supabase.from("warehouses").select("id,name").in("id", warehouseIds) : Promise.resolve({ data: [] }),
        branchIds.length ? supabase.from("branches").select("id,name").in("id", branchIds) : Promise.resolve({ data: [] }),
      ]);
      const warehouseMap = new Map((whs ?? []).map((w) => [w.id, w.name]));
      const branchMap = new Map((brs ?? []).map((b) => [b.id, b.name]));
      // Fetch cashier names separately (profiles RLS now allows reading names)
      const userIds = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean))) as string[];
      let nameMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id,name").in("id", userIds);
        nameMap = new Map((profs ?? []).map((p) => [p.id, p.name]));
      }
      return rows.map((r: any) => ({
        ...r,
        cashier_name: nameMap.get(r.user_id) ?? "—",
        warehouses: r.warehouse_id ? { name: warehouseMap.get(r.warehouse_id) ?? "—" } : null,
        branches: r.branch_id ? { name: branchMap.get(r.branch_id) ?? "—" } : null,
      }));
    },
    enabled: !!user,
  });

  // Live aggregates for any shift (used in close dialog and open shift cards)
  const fetchLive = async (shiftId: string) => {
      const [s, p] = await Promise.all([
        supabase.from("sales").select("total_sale,amount_paid,remaining_debt,payment_method").eq("shift_id", shiftId).eq("status", "completed"),
        supabase.from("payments").select("amount,method,sale_id").eq("shift_id", shiftId),
      ]);
      const sales = s.data ?? [];
      const debtPays = (p.data ?? []).filter((x) => !x.sale_id);
      return {
        count: sales.length,
        sales: sales.reduce((a, x) => a + Number(x.total_sale), 0),
        cash: sales.filter((x) => x.payment_method === "cash").reduce((a, x) => a + Number(x.amount_paid), 0)
          + debtPays.filter((x) => x.method === "cash").reduce((a, x) => a + Number(x.amount), 0),
        click: sales.filter((x) => x.payment_method === "click").reduce((a, x) => a + Number(x.amount_paid), 0)
          + debtPays.filter((x) => x.method === "click").reduce((a, x) => a + Number(x.amount), 0),
        debt: sales.reduce((a, x) => a + Number(x.remaining_debt), 0),
      };
  };

  const { data: liveByShift } = useQuery({
    queryKey: ["shift-live-multi", (openShifts ?? []).map((s) => s.id).join(",")],
    queryFn: async () => {
      const map: Record<string, Awaited<ReturnType<typeof fetchLive>>> = {};
      for (const sh of openShifts ?? []) {
        map[sh.id] = await fetchLive(sh.id);
      }
      return map;
    },
    enabled: (openShifts?.length ?? 0) > 0,
    refetchInterval: 5000,
  });

  const openShift = useMutation({
    mutationFn: async () => {
      const wh = warehouses?.find((w) => w.id === warehouseId);
      if (!wh) throw new Error("Sklad tanlang");
      const { error } = await supabase.rpc("open_shift", {
        _branch_id: wh.branch_id, _warehouse_id: wh.id,
        _opening_cash: Number(openingCash || 0), _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Smena ochildi"); setOpenDlg(false); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const closeShift = useMutation({
    mutationFn: async () => {
      const target = closingShift;
      if (!target) throw new Error("Smena tanlanmagan");
      const { error } = await supabase.rpc("close_shift", {
        _shift_id: target.id, _closing_cash: Number(closingCash || 0),
        _note: note || null, _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Smena yopildi"); setCloseDlg(false); setClosingCash(""); setNote(""); setClosingShift(null); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteShift = useMutation({
    mutationFn: async (shiftId: string) => {
      const { error } = await supabase.rpc("delete_shift", { _shift_id: shiftId, _user_id: user!.id } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Smena o'chirildi"); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const groupedShifts = (() => {
    const map = new Map<string, any[]>();
    (shifts ?? []).forEach((sh: any) => {
      const day = new Date(sh.opened_at).toLocaleDateString("uz-UZ", { year: "numeric", month: "long", day: "2-digit", weekday: "short" });
      const arr = map.get(day) ?? [];
      arr.push(sh);
      map.set(day, arr);
    });
    return Array.from(map.entries());
  })();

  // Realtime — admin/sotuvchi sinxron
  useEffect(() => {
    const ch = supabase.channel("shifts-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "shifts" }, () => {
        qc.invalidateQueries({ queryKey: ["shifts-history"] });
        qc.invalidateQueries({ queryKey: ["open-shifts"] });
        qc.invalidateQueries({ queryKey: ["active-shift"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const closingLive = closingShift ? liveByShift?.[closingShift.id] : null;
  const expectedCash = closingShift ? Number(closingShift.opening_cash) + (closingLive?.cash ?? 0) : 0;

  const firstOpenShift = (openShifts ?? [])[0];

  const openCloseDialog = (sh: { id: string; opening_cash: number; warehouse_name?: string }) => {
    const live = liveByShift?.[sh.id];
    setClosingShift(sh);
    setClosingCash(String(Number(sh.opening_cash) + (live?.cash ?? 0)));
    setCloseDlg(true);
  };

  return (
    <>
      <PageHeader title="Smena (Kassa)" description="Smena boshlash, yopish va sotuv hisoboti" action={
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={() => setOpenDlg(true)} className="w-full sm:w-auto">
            <Play className="h-4 w-4 mr-1.5" /> Smena ochish
          </Button>
          <Button
            variant="destructive"
            disabled={!firstOpenShift}
            onClick={() => {
              if (!firstOpenShift) return;
              const wh = (firstOpenShift.warehouses as unknown as { name: string } | null)?.name ?? "—";
              openCloseDialog({ id: firstOpenShift.id, opening_cash: Number(firstOpenShift.opening_cash), warehouse_name: wh });
            }}
            className="w-full sm:w-auto"
          >
            <Square className="h-4 w-4 mr-1.5" /> Smenani yopish
          </Button>
        </div>
      } />

      <div className="p-3 lg:p-6 space-y-4 pb-24 lg:pb-6">
        {(openShifts?.length ?? 0) > 0 ? (
          <div className="space-y-3">
            {(openShifts ?? []).map((sh) => {
              const wh = (sh.warehouses as unknown as { name: string } | null)?.name ?? "—";
              const stats = liveByShift?.[sh.id];
              const exp = Number(sh.opening_cash) + (stats?.cash ?? 0);
              return (
                <div key={sh.id} className="rounded-lg border border-success/30 bg-success/5 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-success" />
                      <span className="font-medium">{wh}</span>
                      <span className="text-muted-foreground">— {fmtDate(sh.opened_at)}</span>
                    </div>
                    <Button size="sm" variant="destructive" onClick={() => openCloseDialog({ id: sh.id, opening_cash: Number(sh.opening_cash), warehouse_name: wh })}>
                      <Square className="h-4 w-4 mr-1.5" /> Shu smenani yopish
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                    <StatCard label="Sotuvlar" value={String(stats?.count ?? 0)} icon={<ShoppingCart className="h-4 w-4" />} />
                    <StatCard label="Tushum" value={fmtMoney(stats?.sales ?? 0)} icon={<Banknote className="h-4 w-4" />} />
                    <StatCard label="Naqd" value={fmtMoney(stats?.cash ?? 0)} icon={<Banknote className="h-4 w-4" />} accent="success" />
                    <StatCard label="Click" value={fmtMoney(stats?.click ?? 0)} icon={<CreditCard className="h-4 w-4" />} />
                    <StatCard label="Qarz" value={fmtMoney(stats?.debt ?? 0)} icon={<AlertCircle className="h-4 w-4" />} accent="warning" />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Ochilish naqdi: <span className="font-mono">{fmtMoney(sh.opening_cash)}</span> · Kutilayotgan kassa: <span className="font-mono font-semibold text-foreground">{fmtMoney(exp)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Hozir ochiq smena yo'q. Sotuv qilish uchun filial/sklad smenasini oching.
          </div>
        )}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Smena tarixi</div>
          <div className="divide-y">
            {groupedShifts.map(([day, list]) => {
              const sumSales = list.reduce((a, s) => a + Number(s.total_sales || 0), 0);
              return (
                <div key={day}>
                  <div className="bg-muted/30 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                    <span>{day} · {list.length} smena</span>
                    <span className="font-mono text-foreground">{fmtMoney(sumSales)}</span>
                  </div>
                  <div className="divide-y">
                    {list.map((sh: any) => {
                      const wh = (sh.warehouses as unknown as { name: string } | null)?.name;
                      const diff = Number(sh.difference ?? 0);
                      const isOpen = expanded[sh.id];
                      return (
                        <div key={sh.id}>
                          <button onClick={() => toggleExpand(sh.id)} className="w-full text-left px-3 py-2.5 hover:bg-accent/40 transition-colors flex items-center gap-2">
                            <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", isOpen && "rotate-180")} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium text-sm truncate">{sh.cashier_name ?? "—"}</span>
                                {wh && <span className="text-xs text-muted-foreground truncate">· {wh}</span>}
                                <span className={cn("rounded px-1.5 py-0.5 text-[10px] uppercase", sh.status === "open" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{sh.status}</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {new Date(sh.opened_at).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })} → {sh.closed_at ? new Date(sh.closed_at).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" }) : "ochiq"}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-mono font-semibold text-sm">{fmtMoney(sh.total_sales)}</div>
                              {sh.difference != null && (
                                <div className={cn("font-mono text-[11px]", diff < 0 ? "text-destructive" : diff > 0 ? "text-success" : "text-muted-foreground")}>
                                  {diff > 0 ? "+" : ""}{fmtMoney(diff)}
                                </div>
                              )}
                            </div>
                          </button>
                          {isOpen && (
                            <div className="px-3 pb-3 pt-1 space-y-2 bg-muted/10">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                                <div className="rounded bg-card border px-2 py-1.5"><div className="text-muted-foreground">Naqd</div><div className="font-mono font-semibold">{fmtMoney(sh.total_cash)}</div></div>
                                <div className="rounded bg-card border px-2 py-1.5"><div className="text-muted-foreground">Click</div><div className="font-mono font-semibold">{fmtMoney(sh.total_click)}</div></div>
                                <div className="rounded bg-card border px-2 py-1.5"><div className="text-warning/80">Qarz</div><div className="font-mono font-semibold text-warning">{fmtMoney(sh.total_debt)}</div></div>
                                <div className="rounded bg-card border px-2 py-1.5"><div className="text-muted-foreground">Sotuvlar</div><div className="font-mono font-semibold">{sh.sales_count ?? 0}</div></div>
                                <div className="rounded bg-card border px-2 py-1.5"><div className="text-muted-foreground">Boshlang'ich</div><div className="font-mono">{fmtMoney(sh.opening_cash)}</div></div>
                                <div className="rounded bg-card border px-2 py-1.5"><div className="text-muted-foreground">Kutilgan</div><div className="font-mono">{sh.expected_cash != null ? fmtMoney(sh.expected_cash) : "—"}</div></div>
                                <div className="rounded bg-card border px-2 py-1.5"><div className="text-muted-foreground">Haqiqiy</div><div className="font-mono">{sh.closing_cash != null ? fmtMoney(sh.closing_cash) : "—"}</div></div>
                                <div className={cn("rounded border px-2 py-1.5", diff < 0 ? "bg-destructive/10 border-destructive/30" : diff > 0 ? "bg-success/10 border-success/30" : "bg-card")}>
                                  <div className="text-muted-foreground">Farq</div>
                                  <div className={cn("font-mono font-semibold", diff < 0 ? "text-destructive" : diff > 0 ? "text-success" : "")}>{sh.difference != null ? fmtMoney(diff) : "—"}</div>
                                </div>
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Ochildi: {fmtDate(sh.opened_at)}{sh.closed_at ? ` · Yopildi: ${fmtDate(sh.closed_at)}` : ""}
                              </div>
                              {sh.note && <div className="text-xs rounded bg-card border px-2 py-1.5"><span className="text-muted-foreground">Izoh: </span>{sh.note}</div>}
                              {isSuperAdmin && (
                                <div className="flex justify-end pt-1">
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive">
                                        <Trash2 className="h-3.5 w-3.5 mr-1" /> O'chirish
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Smenani o'chirish?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          Smena tarixdan olib tashlanadi. Sotuvlar va to'lovlar saqlanib qoladi (faqat smena bog'lanishi uziladi). Ushbu amalni qaytarib bo'lmaydi.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Bekor</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => deleteShift.mutate(sh.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">O'chirish</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {(shifts ?? []).length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Smenalar yo'q</div>}
          </div>
        </div>
      </div>

      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>Smena ochish</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Sklad / Filial *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                <SelectContent>{(warehouses ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Boshlang'ich naqd</Label>
              <Input type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
            </div>
          </div>
          <DialogFooter><Button onClick={() => openShift.mutate()} disabled={openShift.isPending || !warehouseId}>Ochish</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDlg} onOpenChange={setCloseDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>Smenani yopish{closingShift?.warehouse_name ? ` — ${closingShift.warehouse_name}` : ""}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Boshlang'ich</span><span className="font-mono">{fmtMoney(closingShift?.opening_cash ?? 0)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Naqd kirim</span><span className="font-mono">{fmtMoney(closingLive?.cash ?? 0)}</span></div>
              <div className="flex justify-between font-semibold"><span>Kutilayotgan kassa</span><span className="font-mono">{fmtMoney(expectedCash)}</span></div>
            </div>
            <div className="space-y-1.5"><Label>Haqiqiy kassada *</Label><Input type="number" value={closingCash} onChange={(e) => setClosingCash(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Izoh</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ixtiyoriy" /></div>
            {closingCash !== "" && (
              <div className={cn("rounded-md p-2.5 text-sm flex justify-between", Number(closingCash) - expectedCash < 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success")}>
                <span>Farq</span><span className="font-mono font-semibold">{fmtMoney(Number(closingCash) - expectedCash)}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDlg(false)}>Bekor</Button>
            <Button variant="destructive" onClick={() => closeShift.mutate()} disabled={closeShift.isPending || closingCash === ""}>Yopish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}