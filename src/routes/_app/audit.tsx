import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { fetchAll } from "@/lib/fetch-all";
import { ArrowRight, Calendar, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/audit")({ component: AuditPage });

interface AuditRow {
  id: string;
  table_name: string;
  record_id: string | null;
  action: "UPDATE" | "DELETE" | "INSERT";
  actor_id: string | null;
  changed_at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
}

const TABLE_LABELS: Record<string, string> = {
  customers: "Mijozlar",
  sales: "Sotuvlar",
  sale_items: "Sotuv qatorlari",
  payments: "To'lovlar",
  inventory_batches: "Ombor partiyalari",
  purchases: "Kirimlar",
  transfers: "Ko'chirishlar",
  transfer_items: "Ko'chirish qatorlari",
  shifts: "Smenalar",
  pricelist_overrides: "Narxlar (override)",
  damages: "Yaroqsizlar",
  products: "Mahsulotlar",
  warehouses: "Omborlar",
  branches: "Filiallar",
  profiles: "Foydalanuvchilar",
};

const FIELD_LABELS: Record<string, string> = {
  name: "Nomi",
  phone: "Telefon",
  balance: "Balans",
  opening_balance: "Boshlang'ich balans",
  branch_id: "Filial",
  warehouse_id: "Ombor",
  customer_id: "Mijoz",
  product_id: "Mahsulot",
  shift_id: "Smena",
  sale_id: "Sotuv",
  status: "Holat",
  total_sale: "Sotuv summasi",
  total_cost: "Tannarx",
  total_price: "Jami narx",
  total_quantity: "Jami miqdor",
  total_debt: "Jami qarz",
  total_cash: "Naqd jami",
  total_click: "Click jami",
  amount: "Summa",
  amount_paid: "To'langan",
  remaining_debt: "Qarz qoldig'i",
  remaining: "Qoldiq",
  quantity: "Miqdor",
  cost_price: "Tannarx (dona)",
  sell_price: "Sotuv (dona)",
  profit: "Foyda",
  payment_method: "To'lov turi",
  method: "To'lov turi",
  note: "Izoh",
  reason: "Sabab",
  category: "Kategoriya",
  price: "Narx",
  markup: "Ustama (%)",
  default_markup: "Standart ustama (%)",
  closing_cash: "Yopilish naqdi",
  opening_cash: "Ochilish naqdi",
  expected_cash: "Kutilgan naqd",
  difference: "Farq",
  closed_at: "Yopilgan vaqt",
  opened_at: "Ochilgan vaqt",
  deleted_at: "O'chirilgan vaqt",
  created_at: "Yaratilgan",
  updated_at: "Yangilangan",
  to_warehouse_id: "Qabul qiluvchi ombor",
  from_warehouse_id: "Yuboruvchi ombor",
  source_batch_id: "Manba partiya",
  dest_batch_id: "Maqsad partiya",
};

const MONEY_FIELDS = new Set([
  "balance","opening_balance","total_sale","total_cost","total_price","total_debt","total_cash","total_click",
  "amount","amount_paid","remaining_debt","cost_price","sell_price","profit","price","closing_cash","opening_cash","expected_cash","difference",
]);
const QTY_FIELDS = new Set(["quantity","remaining","total_quantity","markup","default_markup"]);
const DATE_FIELDS = new Set(["created_at","updated_at","closed_at","opened_at","deleted_at","changed_at"]);

const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function AuditPage() {
  const { isSuperAdmin } = useAuth();
  const [table, setTable] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [limit, setLimit] = useState(100);

  const { data: rows } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => fetchAll<AuditRow>(supabase.from("audit_logs").select("*").order("changed_at", { ascending: false })),
    enabled: isSuperAdmin,
  });

  const { data: profiles } = useQuery({
    queryKey: ["audit-profiles"],
    queryFn: async () => (await supabase.from("profiles").select("id,name")).data ?? [],
  });
  const { data: customers } = useQuery({
    queryKey: ["audit-customers"],
    queryFn: async () => (await supabase.from("customers").select("id,name")).data ?? [],
  });
  const { data: products } = useQuery({
    queryKey: ["audit-products"],
    queryFn: async () => (await supabase.from("products").select("id,name")).data ?? [],
  });
  const { data: warehouses } = useQuery({
    queryKey: ["audit-warehouses"],
    queryFn: async () => (await supabase.from("warehouses").select("id,name")).data ?? [],
  });
  const { data: branches } = useQuery({
    queryKey: ["audit-branches"],
    queryFn: async () => (await supabase.from("branches").select("id,name")).data ?? [],
  });

  const lookup = useMemo(() => {
    const m = new Map<string, string>();
    [profiles, customers, products, warehouses, branches].forEach((arr) => {
      (arr ?? []).forEach((r) => m.set(r.id, r.name));
    });
    return m;
  }, [profiles, customers, products, warehouses, branches]);

  const nameOf = (id: string | null | undefined) => {
    if (!id) return "—";
    return lookup.get(id) ?? id.slice(0, 8);
  };

  const labelTable = (t: string) => TABLE_LABELS[t] ?? t;
  const labelField = (f: string) => FIELD_LABELS[f] ?? f;

  const formatValue = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (DATE_FIELDS.has(field)) return fmtDate(v as string);
    if (MONEY_FIELDS.has(field)) return fmtMoney(v as number);
    if (QTY_FIELDS.has(field)) return fmtNum(v as number);
    if (typeof v === "boolean") return v ? "Ha" : "Yo'q";
    if (typeof v === "object") return JSON.stringify(v);
    if (isUuid(v)) return lookup.get(String(v)) ?? String(v).slice(0, 8) + "…";
    return String(v);
  };

  const tables = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.table_name))).sort(), [rows]);

  const filtered = useMemo(() => {
    return (rows ?? []).filter((r) => {
      if (r.action !== "UPDATE" && r.action !== "DELETE") return false;
      if (table !== "all" && r.table_name !== table) return false;
      if (action !== "all" && r.action !== action) return false;
      if (dateFrom && new Date(r.changed_at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(r.changed_at) > new Date(dateTo + "T23:59:59")) return false;
      if (search) {
        const s = search.toLowerCase();
        const blob = `${labelTable(r.table_name)} ${r.record_id ?? ""} ${nameOf(r.actor_id)} ${(r.changed_fields ?? []).map(labelField).join(" ")}`.toLowerCase();
        if (!blob.includes(s)) return false;
      }
      return true;
    });
  }, [rows, table, action, search, dateFrom, dateTo, lookup]);

  const visible = filtered.slice(0, limit);

  if (!isSuperAdmin) return <Navigate to="/dashboard" />;

  const ActionIcon = ({ a }: { a: AuditRow["action"] }) =>
    a === "DELETE" ? <Trash2 className="h-3.5 w-3.5" /> : a === "UPDATE" ? <Pencil className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />;
  const actionLabel = (a: AuditRow["action"]) => a === "DELETE" ? "O'chirildi" : a === "UPDATE" ? "Tahrirlandi" : "Qo'shildi";

  // Build a "subject" name for the row — record's primary identifier
  const subjectOf = (r: AuditRow): string => {
    const data = r.new_data ?? r.old_data ?? {};
    const d = data as Record<string, unknown>;
    if (typeof d.name === "string") return d.name;
    if (d.product_id) return nameOf(String(d.product_id));
    if (d.customer_id) return nameOf(String(d.customer_id));
    return r.record_id ? r.record_id.slice(0, 8) : "—";
  };

  return (
    <>
      <PageHeader title="Audit jurnal" description="Har bir o'zgarish: kim, qachon, qaysi yozuv va aniq nimalar o'zgargan" />
      <div className="p-3 lg:p-6 pb-24 lg:pb-6 space-y-3">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          <Input className="col-span-2 lg:col-span-1" placeholder="Qidirish..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={table} onValueChange={setTable}>
            <SelectTrigger><SelectValue placeholder="Jadval" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha jadvallar</SelectItem>
              {tables.map((t) => <SelectItem key={t} value={t}>{labelTable(t)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger><SelectValue placeholder="Amal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Barcha amallar</SelectItem>
              <SelectItem value="UPDATE">Tahrir</SelectItem>
              <SelectItem value="DELETE">O'chirish</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span>Jami: <b className="text-foreground">{filtered.length}</b> yozuv · ko'rinmoqda: {visible.length}</span>
          {(search || table !== "all" || action !== "all" || dateFrom || dateTo) && (
            <button onClick={() => { setSearch(""); setTable("all"); setAction("all"); setDateFrom(""); setDateTo(""); }} className="text-primary hover:underline">Filterlarni tozalash</button>
          )}
        </div>

        <div className="rounded-lg border bg-card divide-y overflow-hidden">
          {visible.map((r) => {
            const fields = r.changed_fields ?? [];
            const previewFields = fields.slice(0, 3);
            return (
              <button key={r.id} onClick={() => setSelected(r)} className="w-full text-left p-3 hover:bg-accent/40 transition-colors flex items-start gap-3">
                <div className={cn(
                  "shrink-0 mt-0.5 h-8 w-8 rounded-md flex items-center justify-center",
                  r.action === "DELETE" && "bg-destructive/15 text-destructive",
                  r.action === "UPDATE" && "bg-primary/15 text-primary",
                  r.action === "INSERT" && "bg-success/15 text-success",
                )}>
                  <ActionIcon a={r.action} />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{labelTable(r.table_name)}</Badge>
                    <span className="text-sm font-semibold truncate">{subjectOf(r)}</span>
                  </div>
                  <div className="text-[12px] text-foreground/80">
                    <b>{nameOf(r.actor_id)}</b> {actionLabel(r.action).toLowerCase()}
                    {fields.length > 0 && <> · <span className="text-muted-foreground">{fields.length} ta maydon</span></>}
                  </div>

                  {/* Inline diff preview for UPDATE */}
                  {r.action === "UPDATE" && previewFields.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {previewFields.map((f) => (
                        <div key={f} className="flex items-center gap-2 text-[11px] flex-wrap">
                          <span className="text-muted-foreground shrink-0">{labelField(f)}:</span>
                          <span className="font-mono text-destructive line-through opacity-70 truncate max-w-[120px]">{formatValue(f, r.old_data?.[f])}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="font-mono text-success font-semibold truncate max-w-[140px]">{formatValue(f, r.new_data?.[f])}</span>
                        </div>
                      ))}
                      {fields.length > previewFields.length && (
                        <div className="text-[10px] text-primary">+ yana {fields.length - previewFields.length} maydon</div>
                      )}
                    </div>
                  )}

                  <div className="text-[10px] text-muted-foreground flex items-center gap-2 pt-0.5">
                    <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDate(r.changed_at)}</span>
                  </div>
                </div>
              </button>
            );
          })}
          {visible.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Yozuv yo'q</div>}
        </div>

        {filtered.length > visible.length && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => setLimit(limit + 100)}>Yana ko'rsatish (+100)</Button>
          </div>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className={cn(
                "h-7 w-7 rounded-md flex items-center justify-center",
                selected?.action === "DELETE" && "bg-destructive/15 text-destructive",
                selected?.action === "UPDATE" && "bg-primary/15 text-primary",
                selected?.action === "INSERT" && "bg-success/15 text-success",
              )}>
                {selected && <ActionIcon a={selected.action} />}
              </span>
              {selected && actionLabel(selected.action)} · {selected && labelTable(selected.table_name)}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs rounded-md border bg-muted/30 p-3">
                <div><span className="text-muted-foreground">Foydalanuvchi:</span> <b>{nameOf(selected.actor_id)}</b></div>
                <div><span className="text-muted-foreground">Vaqt:</span> <b>{fmtDate(selected.changed_at)}</b></div>
                <div className="sm:col-span-2"><span className="text-muted-foreground">Yozuv:</span> <b>{subjectOf(selected)}</b> <span className="font-mono text-[10px] text-muted-foreground ml-2">{selected.record_id}</span></div>
              </div>

              {selected.action === "UPDATE" && selected.changed_fields && selected.changed_fields.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">O'zgarishlar ({selected.changed_fields.length})</div>
                  <div className="rounded-md border overflow-hidden">
                    {selected.changed_fields.map((f, i) => (
                      <div key={f} className={cn("px-3 py-2 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_1fr] sm:items-center gap-2", i > 0 && "border-t")}>
                        <div className="font-medium text-xs">{labelField(f)} <span className="text-[10px] text-muted-foreground font-mono">{f}</span></div>
                        <div className="hidden sm:block text-muted-foreground"><ArrowRight className="h-3 w-3" /></div>
                        <div className="font-mono text-xs text-destructive break-all line-through opacity-80">{formatValue(f, selected.old_data?.[f])}</div>
                        <div className="font-mono text-xs text-success break-all">{formatValue(f, selected.new_data?.[f])}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(selected.action === "DELETE" || selected.action === "INSERT") && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    {selected.action === "DELETE" ? "O'chirilgan yozuv" : "Qo'shilgan yozuv"}
                  </div>
                  <div className="rounded-md border divide-y">
                    {Object.entries((selected.action === "DELETE" ? selected.old_data : selected.new_data) ?? {}).map(([k, v]) => (
                      <div key={k} className="px-3 py-1.5 grid grid-cols-[1fr_2fr] gap-2 text-xs">
                        <div className="text-muted-foreground">{labelField(k)}</div>
                        <div className={cn("font-mono break-all", selected.action === "DELETE" ? "text-destructive" : "text-success")}>{formatValue(k, v)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Xom ma'lumot (JSON)</summary>
                <pre className="mt-2 text-[10px] bg-muted/40 p-3 rounded-md overflow-x-auto max-h-72">{JSON.stringify({ old: selected.old_data, new: selected.new_data }, null, 2)}</pre>
              </details>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
