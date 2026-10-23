import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtMoney, getProductUnit } from "@/lib/format";
import { generatePdfReport, type PdfReportColumn } from "@/lib/pdf-report";
import { downloadCSV } from "@/lib/csv";
import { toast } from "sonner";
import { Download, FileText, Building2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function todayISO() { return new Date().toISOString().slice(0, 10); }

interface DailyReportProps {
  /** When true, the component is embedded inside the Reports page (skip own header). */
  embedded?: boolean;
}

export function DailyReport({ embedded = false }: DailyReportProps) {
  const { profile, isSuperAdmin } = useAuth();
  const qc = useQueryClient();

  const [date, setDate] = useState(todayISO());
  const [branchId, setBranchId] = useState<string>(
    isSuperAdmin ? "all" : (profile?.branch_id ?? "all"),
  );

  const fromTs = `${date}T00:00:00`;
  const toTs = `${date}T23:59:59`;

  // Branches for filter
  const { data: branches } = useQuery({
    queryKey: ["daily-report-branches"],
    queryFn: async () =>
      (await supabase.from("branches").select("id,name").is("deleted_at", null).order("name"))
        .data ?? [],
    enabled: isSuperAdmin,
  });

  // Sales for the day
  const { data: sales } = useQuery({
    queryKey: ["daily-report-sales", date, branchId],
    queryFn: async () => {
      let q = supabase
        .from("sales")
        .select(
          "id,customer_id,branch_id,total_sale,amount_paid,payment_method,remaining_debt,status,created_at,customers(id,name,phone,balance)",
        )
        .eq("status", "completed")
        .gte("created_at", fromTs)
        .lte("created_at", toTs)
        .order("created_at", { ascending: true });
      if (branchId !== "all") q = q.eq("branch_id", branchId);
      return (await q).data ?? [];
    },
  });

  const saleIds = useMemo(() => (sales ?? []).map((s) => s.id as string), [sales]);

  // Sale items joined to product
  const { data: items } = useQuery({
    queryKey: ["daily-report-items", saleIds.join(",")],
    enabled: saleIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("sale_items")
        .select("sale_id,product_id,quantity,products(id,name)")
        .in("sale_id", saleIds);
      return data ?? [];
    },
  });

  // Payments today: sale-linked payments + customer profile debt payments.
  // Branch filtering uses sale/shift first, because customer.branch_id may differ from where cash was received.
  const { data: payments } = useQuery({
    queryKey: ["daily-report-payments", date, branchId],
    queryFn: async () => {
      const q = supabase
        .from("payments")
        .select("id,customer_id,amount,method,sale_id,created_at,customers(id,name,balance,branch_id),sales(customer_id,branch_id)")
        .gte("created_at", fromTs)
        .lte("created_at", toTs);
      const { data } = await q;
      const rows = data ?? [];
      if (branchId === "all") return rows;
      return rows.filter((r) => {
        const sale = r.sales as unknown as { branch_id: string | null } | null;
        const c = r.customers as unknown as { branch_id: string | null } | null;
        return sale?.branch_id === branchId || c?.branch_id === branchId;
      });
    },
  });

  // Realtime invalidation
  useEffect(() => {
    const ch = supabase
      .channel("daily-report-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () =>
        qc.invalidateQueries({ queryKey: ["daily-report-sales"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, () =>
        qc.invalidateQueries({ queryKey: ["daily-report-items"] }),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () =>
        {
          qc.invalidateQueries({ queryKey: ["daily-report-payments"] });
          qc.invalidateQueries({ queryKey: ["daily-report-sales"] });
          qc.invalidateQueries({ queryKey: ["daily-report-name-lookup"] });
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () =>
        {
          qc.invalidateQueries({ queryKey: ["daily-report-sales"] });
          qc.invalidateQueries({ queryKey: ["daily-report-name-lookup"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  // ---- Aggregate into pivot
  type Row = {
    customerId: string;
    customerName: string;
    productQty: Map<string, number>; // productName -> qty
    summa: number;
    naqd: number;
    click: number;
    qarz: number; // bugungi qarz (from sales today)
    eskiQarzTolovi: number; // payments today (no sale link)
    customerBalance: number; // current balance (hozirgi qarz, includes today)
    firstSaleAt: number; // earliest sale timestamp (ms) for ordering
  };

  const productOrder = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    (items ?? []).forEach((it) => {
      const p = it.products as unknown as { name: string } | null;
      const name = p?.name ?? "—";
      if (!seen.has(name)) {
        seen.add(name);
        order.push(name);
      }
    });
    return order;
  }, [items]);

  const rows = useMemo<Row[]>(() => {
    const byCust = new Map<string, Row>();
    const get = (id: string, name: string, balance: number) => {
      let r = byCust.get(id);
      if (!r) {
        r = {
          customerId: id,
          customerName: name,
          productQty: new Map(),
          summa: 0,
          naqd: 0,
          click: 0,
          qarz: 0,
          eskiQarzTolovi: 0,
          customerBalance: balance,
          firstSaleAt: Number.POSITIVE_INFINITY,
        };
        byCust.set(id, r);
      }
      return r;
    };

    // Sales
    (sales ?? []).forEach((s) => {
      const c = s.customers as unknown as
        | { id: string; name: string; balance: number }
        | null;
      const cid = (s.customer_id as string) ?? "no-customer";
      const cname = c?.name ?? "Mijozsiz";
      const cbal = Number(c?.balance ?? 0);
      const r = get(cid, cname, cbal);
      const amount = Number(s.total_sale);
      r.summa += amount;
      const ts = new Date(s.created_at as string).getTime();
      if (ts < r.firstSaleAt) r.firstSaleAt = ts;
    });

    // Items into pivot — match sale_id back to customer_id
    const saleToCust = new Map<string, string>();
    (sales ?? []).forEach((s) =>
      saleToCust.set(s.id as string, (s.customer_id as string) ?? "no-customer"),
    );
    (items ?? []).forEach((it) => {
      const cid = saleToCust.get(it.sale_id as string);
      if (!cid) return;
      const r = byCust.get(cid);
      if (!r) return;
      const p = it.products as unknown as { name: string } | null;
      const pname = p?.name ?? "—";
      r.productQty.set(pname, (r.productQty.get(pname) ?? 0) + Number(it.quantity));
    });

    // All payments today (at-sale + customer profile payments) feed NAQD/CLICK so cashflow is real.
    (payments ?? []).forEach((p) => {
      const sale = p.sales as unknown as { customer_id?: string | null } | null;
      const cid = ((p.customer_id as string | null) ?? sale?.customer_id) ?? "no-customer";
      const c = p.customers as unknown as { name?: string | null; balance?: number | string | null } | null;
      let r = byCust.get(cid);
      if (!r) r = get(cid, c?.name ?? "—", Number(c?.balance ?? 0));
      const amt = Number(p.amount);
      if (p.method === "cash") r.naqd += amt;
      else if (p.method === "click") r.click += amt;
    });

    // Per-row:
    // bugungi qarz = bugungi sotuv - bugun tushgan barcha to'lovlar.
    // Mijoz profilidan kiritilgan naqd/click ham shu kundagi qarzni kamaytiradi.
    return Array.from(byCust.values())
      .map((r) => {
        const paidToday = r.naqd + r.click;
        r.qarz = Math.max(0, r.summa - paidToday);
        r.eskiQarzTolovi = Math.max(0, paidToday - r.summa);
        return r;
      })
      .sort((a, b) => a.firstSaleAt - b.firstSaleAt);
  }, [sales, items, payments]);

  // Backfill names for repayment-only rows
  const missingNameIds = rows.filter((r) => r.customerName === "—").map((r) => r.customerId);
  const { data: nameLookup } = useQuery({
    queryKey: ["daily-report-name-lookup", missingNameIds.join(",")],
    enabled: missingNameIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id,name,balance")
        .in("id", missingNameIds);
      return data ?? [];
    },
  });
  const enrichedRows = useMemo(() => {
    if (!nameLookup?.length) return rows;
    const m = new Map(nameLookup.map((c) => [c.id, c]));
    return rows.map((r) => {
      const lookup = m.get(r.customerId);
      return lookup
        ? { ...r, customerName: lookup.name, customerBalance: Number(lookup.balance) }
        : r;
    });
  }, [rows, nameLookup]);

  // Totals (JAMI row)
  const totals = useMemo(() => {
    const t = {
      summa: 0,
      naqd: 0,
      click: 0,
      qarz: 0,
      eskiQarzTolovi: 0,
      customerBalance: 0,
      productQty: new Map<string, number>(),
    };
    enrichedRows.forEach((r) => {
      t.summa += r.summa;
      t.naqd += r.naqd;
      t.click += r.click;
      t.qarz += r.qarz;
      t.eskiQarzTolovi += r.eskiQarzTolovi;
      t.customerBalance += r.customerBalance;
      r.productQty.forEach((qty, name) =>
        t.productQty.set(name, (t.productQty.get(name) ?? 0) + qty),
      );
    });
    // eski qarz = balance_now - bugungi yangi qarz + bugun eski qarzga to'langan summa
    return { ...t, eskiQarz: t.customerBalance - t.qarz + t.eskiQarzTolovi };
  }, [enrichedRows]);

  // ---- Export
  const buildExportRows = () => {
    const data: Array<Record<string, unknown>> = enrichedRows.map((r, i) => {
      const base: Record<string, unknown> = {
        n: i + 1,
        mijoz: r.customerName,
      };
      productOrder.forEach((p) => {
        const q = r.productQty.get(p) ?? 0;
        base[`p_${p}`] = q ? q : "";
      });
      base.summa = r.summa;
      base.naqd = r.naqd;
      base.click = r.click;
      base.qarz = r.qarz;
      base.eski_qarz = r.customerBalance - r.qarz + r.eskiQarzTolovi;
      base.eski_qarz_tolovi = r.eskiQarzTolovi;
      base.hozirgi_qarz = r.customerBalance;
      return base;
    });
    // JAMI footer
    const totalRow: Record<string, unknown> = { n: "", mijoz: "JAMI" };
    productOrder.forEach((p) => (totalRow[`p_${p}`] = totals.productQty.get(p) ?? ""));
    totalRow.summa = totals.summa;
    totalRow.naqd = totals.naqd;
    totalRow.click = totals.click;
    totalRow.qarz = totals.qarz;
    totalRow.eski_qarz = totals.eskiQarz;
    totalRow.eski_qarz_tolovi = totals.eskiQarzTolovi;
    totalRow.hozirgi_qarz = totals.customerBalance;
    data.push(totalRow);
    return data;
  };

  const buildColumns = (): PdfReportColumn[] => {
    const cols: PdfReportColumn[] = [
      { header: "№", key: "n", align: "right" },
      { header: "Mijoz", key: "mijoz" },
    ];
    productOrder.forEach((p) =>
      cols.push({ header: `${p} (${getProductUnit(p)})`, key: `p_${p}`, number: true }),
    );
    cols.push({ header: "SUMMA", key: "summa", money: true });
    cols.push({ header: "NAQD", key: "naqd", money: true });
    cols.push({ header: "CLICK", key: "click", money: true });
    cols.push({ header: "QARZ", key: "qarz", money: true });
    cols.push({ header: "ESKI QARZ", key: "eski_qarz", money: true });
    cols.push({ header: "ESKI QARZ TO'LOVI", key: "eski_qarz_tolovi", money: true });
    cols.push({ header: "HOZIRGI QARZ", key: "hozirgi_qarz", money: true });
    return cols;
  };

  const branchLabel =
    branchId === "all"
      ? "Barcha filiallar"
      : branches?.find((b) => b.id === branchId)?.name ?? "—";

  const exportNow = (format: "pdf" | "csv") => {
    try {
      if (!enrichedRows.length) {
        toast.warning("Bu kunda ma'lumot yo'q");
        return;
      }
      const cols = buildColumns();
      const rows = buildExportRows();
      const file = `kunlik-${date}`;
      if (format === "csv") {
        downloadCSV(`${file}.csv`, rows);
        toast.success("CSV yuklab olindi");
      } else {
        generatePdfReport({
          title: "Kunlik hisobot",
          subtitle: `${date} · ${branchLabel} · ${enrichedRows.length} ta mijoz`,
          columns: cols,
          rows,
          filename: `${file}.pdf`,
          orientation: cols.length > 8 ? "landscape" : "portrait",
          kpis: [
            { label: "Jami sotuv", value: fmtMoney(totals.summa), tone: "success" },
            { label: "Naqd", value: fmtMoney(totals.naqd) },
            { label: "Click", value: fmtMoney(totals.click) },
            {
              label: "Bugungi qarz",
              value: fmtMoney(totals.qarz),
              tone: totals.qarz > 0 ? "warning" : "default",
            },
            { label: "Eski qarz to'lovi", value: fmtMoney(totals.eskiQarzTolovi), tone: "success" },
            {
              label: "Hozirgi qarz",
              value: fmtMoney(totals.customerBalance),
              tone: totals.customerBalance > 0 ? "warning" : "default",
            },
          ],
        });
        toast.success("PDF tayyor");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Noma'lum xatolik";
      toast.error("Eksport xatosi", {
        description: msg,
        action: { label: "Qayta urinish", onClick: () => exportNow(format) },
      });
    }
  };

  // ---- KPI cards (UI)
  const kpis = [
    { label: "Jami sotuv", value: totals.summa, tone: "primary" as const },
    { label: "Naqd", value: totals.naqd, tone: "success" as const },
    { label: "Click", value: totals.click, tone: "info" as const },
    { label: "Bugungi qarz", value: totals.qarz, tone: "danger" as const },
    { label: "Eski qarz to'lovi", value: totals.eskiQarzTolovi, tone: "success" as const },
    { label: "Hozirgi qarz", value: totals.customerBalance, tone: "warning" as const },
  ];

  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-background/90 px-3 py-3 backdrop-blur lg:px-6 lg:py-5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">Kunlik hisobot</h1>
            <div className="text-xs text-muted-foreground sm:text-sm truncate">
              {date} · {branchLabel} · {enrichedRows.length} ta mijoz
            </div>
          </div>
          <div className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  <span>PDF</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-[11px]">Eksport</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportNow("pdf")}>
                  <FileText className="h-4 w-4 mr-2" /> PDF hujjat
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportNow("csv")}>
                  <Download className="h-4 w-4 mr-2" /> CSV jadval
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      <div className={cn("space-y-3", !embedded && "px-3 lg:px-6 pb-28")}>
        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sana</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
          </div>
          {isSuperAdmin && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Filial</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-10">
                  <Building2 className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Barcha filiallar</SelectItem>
                  {branches?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {embedded && (
            <div className="flex items-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-10 gap-1.5 w-full sm:w-auto">
                    <Download className="h-3.5 w-3.5" />
                    <span>Eksport</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => exportNow("pdf")}>
                    <FileText className="h-4 w-4 mr-2" /> PDF hujjat
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportNow("csv")}>
                    <Download className="h-4 w-4 mr-2" /> CSV jadval
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {kpis.map((k) => (
            <div
              key={k.label}
              className={cn(
                "rounded-xl border p-3 text-center",
                k.tone === "primary" && "border-primary/30 bg-primary/5",
                k.tone === "success" && "border-emerald-500/30 bg-emerald-500/5",
                k.tone === "info" && "border-sky-500/30 bg-sky-500/5",
                k.tone === "danger" && "border-rose-500/30 bg-rose-500/5",
                k.tone === "warning" && "border-amber-500/30 bg-amber-500/5",
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
              <div
                className={cn(
                  "mt-1 text-sm font-semibold tabular-nums break-words sm:text-base",
                  k.tone === "primary" && "text-primary",
                  k.tone === "success" && "text-emerald-500",
                  k.tone === "info" && "text-sky-500",
                  k.tone === "danger" && "text-rose-500",
                  k.tone === "warning" && "text-amber-500",
                )}
              >
                {fmtMoney(k.value)}
              </div>
            </div>
          ))}
        </div>

        {/* Pivot table */}
        <div className="rounded-xl border overflow-x-auto">
          {enrichedRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Tanlangan kunda sotuv yoki to'lov yo'q
            </div>
          ) : (
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">№</th>
                  <th className="px-2 py-2 text-left font-medium">Mijoz</th>
                  {productOrder.map((p) => (
                    <th key={p} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                      {p} <span className="text-[10px] text-muted-foreground/70">({getProductUnit(p)})</span>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium bg-muted">SUMMA</th>
                  <th className="px-2 py-2 text-right font-medium text-emerald-600">NAQD</th>
                  <th className="px-2 py-2 text-right font-medium text-sky-600">CLICK</th>
                  <th className="px-2 py-2 text-right font-medium text-rose-600">QARZ</th>
                  <th className="px-2 py-2 text-right font-medium">ESKI QARZ</th>
                  <th className="px-2 py-2 text-right font-medium text-emerald-600 whitespace-nowrap">
                    ESKI QARZ TO'LOVI
                  </th>
                  <th className="px-2 py-2 text-right font-medium text-amber-600 whitespace-nowrap">
                    HOZIRGI QARZ
                  </th>
                </tr>
              </thead>
              <tbody>
                {enrichedRows.map((r, i) => {
                  const eskiQarz = r.customerBalance - r.qarz + r.eskiQarzTolovi;
                  return (
                    <tr key={r.customerId} className="border-t hover:bg-muted/30">
                      <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-2 font-medium whitespace-nowrap max-w-[160px] truncate">
                        {r.customerName}
                      </td>
                      {productOrder.map((p) => {
                        const q = r.productQty.get(p) ?? 0;
                        return (
                          <td key={p} className="px-2 py-2 text-right tabular-nums">
                            {q ? q : <span className="text-muted-foreground/40">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-right tabular-nums font-semibold bg-muted/30">
                        {r.summa ? fmtMoney(r.summa) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-600">
                        {r.naqd ? fmtMoney(r.naqd) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-sky-600">
                        {r.click ? fmtMoney(r.click) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-rose-600">
                        {r.qarz ? fmtMoney(r.qarz) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {eskiQarz ? fmtMoney(eskiQarz) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-600">
                        {r.eskiQarzTolovi
                          ? fmtMoney(r.eskiQarzTolovi)
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-amber-600 font-medium">
                        {r.customerBalance
                          ? fmtMoney(r.customerBalance)
                          : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-primary/40 bg-muted/60 font-semibold">
                  <td className="px-2 py-2"></td>
                  <td className="px-2 py-2">JAMI</td>
                  {productOrder.map((p) => (
                    <td key={p} className="px-2 py-2 text-right tabular-nums">
                      {totals.productQty.get(p) ?? ""}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(totals.summa)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-emerald-600">
                    {fmtMoney(totals.naqd)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-sky-600">
                    {fmtMoney(totals.click)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-rose-600">
                    {fmtMoney(totals.qarz)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(totals.eskiQarz)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-emerald-600">
                    {fmtMoney(totals.eskiQarzTolovi)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-amber-600">
                    {fmtMoney(totals.customerBalance)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
        <div className="text-center text-[10px] text-muted-foreground/40 pt-4 pb-2 select-none pointer-events-none">
          Dasturchi: MuzaffarZed
        </div>
      </div>
    </div>
  );
}
