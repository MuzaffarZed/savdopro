import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  Download, TrendingUp, TrendingDown, Package, Users, AlertCircle, Boxes, Crown,
  Filter, ShoppingBag, Calendar as CalendarIcon, Building2, ChevronDown,
  ChevronRight, Sparkles, Wallet, CreditCard, FileText, BarChart3, Search, CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtDate } from "@/lib/format";
import { downloadCSV } from "@/lib/csv";
import { generatePdfReport, type PdfReportColumn } from "@/lib/pdf-report";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { fetchAll } from "@/lib/fetch-all";
import { DailyReport } from "@/components/reports/DailyReport";

export const Route = createFileRoute("/_app/reports")({ component: ReportsPage });

function todayISO(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function startOfMonthISO() {
  const d = new Date(); d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function fmtCompact(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

type TabId = "overview" | "daily" | "products" | "branches" | "purchases" | "debtors" | "stock" | "top";
const ALL_TABS: { id: TabId; label: string; short: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean }[] = [
  { id: "overview",  label: "Umumiy",      short: "Umumiy",  icon: BarChart3 },
  { id: "daily",     label: "Kunlik",      short: "Kunlik",  icon: CalendarDays },
  { id: "products",  label: "Mahsulotlar", short: "Mahsulot",icon: ShoppingBag },
  { id: "branches",  label: "Filiallar",   short: "Filial",  icon: Building2, adminOnly: true },
  { id: "purchases", label: "Xaridlar",    short: "Xarid",   icon: Package, adminOnly: true },
  { id: "debtors",   label: "Qarzdorlar",  short: "Qarz",    icon: AlertCircle },
  { id: "stock",     label: "Qoldiqlar",   short: "Qoldiq",  icon: Boxes },
  { id: "top",       label: "Top mijoz",   short: "Top",     icon: Crown, adminOnly: true },
];

function ReportsPage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();
  const TABS = ALL_TABS.filter((t) => isSuperAdmin || !t.adminOnly);

  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO(0));
  const [tab, setTab] = useState<TabId>("overview");
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedBranch, setExpandedBranch] = useState<string | null>(null);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // Realtime invalidation
  useEffect(() => {
    const ch = supabase.channel("reports-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, () => qc.invalidateQueries({ queryKey: ["report-sales"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "sale_items" }, () => qc.invalidateQueries({ queryKey: ["report-items"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "purchases" }, () => qc.invalidateQueries({ queryKey: ["report-purchases"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory_batches" }, () => qc.invalidateQueries({ queryKey: ["report-stock"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => qc.invalidateQueries({ queryKey: ["report-debtors"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const fromTs = `${from}T00:00:00`;
  const toTs = `${to}T23:59:59`;

  // ---- Previous-period (for delta comparison)
  const periodDays = useMemo(() => {
    const a = new Date(from); const b = new Date(to);
    return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
  }, [from, to]);
  const prevFrom = useMemo(() => { const d = new Date(from); d.setDate(d.getDate() - periodDays); return d.toISOString().slice(0,10); }, [from, periodDays]);
  const prevTo = useMemo(() => { const d = new Date(from); d.setDate(d.getDate() - 1); return d.toISOString().slice(0,10); }, [from]);

  const { data: sales } = useQuery({
    queryKey: ["report-sales", from, to],
    queryFn: async () => fetchAll<any>(supabase
      .from("sales")
      .select("id,branch_id,total_sale,total_cost,profit,amount_paid,remaining_debt,payment_method,status,created_at,customers(name),branches(name)")
      .eq("status", "completed")
      .gte("created_at", fromTs).lte("created_at", toTs)
      .order("created_at", { ascending: false })
    ),
  });

  const { data: prevSales } = useQuery({
    queryKey: ["report-prev-sales", prevFrom, prevTo],
    queryFn: async () => fetchAll<any>(supabase
      .from("sales")
      .select("total_sale,profit")
      .eq("status", "completed")
      .gte("created_at", `${prevFrom}T00:00:00`).lte("created_at", `${prevTo}T23:59:59`)
    ),
  });

  const { data: items } = useQuery({
    queryKey: ["report-items", from, to],
    queryFn: async () => fetchAll<any>(supabase
      .from("sale_items")
      .select("quantity,sell_price,total_price,total_cost,products(name,category),sales!inner(created_at,status,branch_id,branches(name))")
      .gte("sales.created_at", fromTs).lte("sales.created_at", toTs)
      .eq("sales.status", "completed")
    ),
  });

  // Cost breakdown per product via inventory_movements (FIFO batch-level)
  const { data: costMovements } = useQuery({
    queryKey: ["report-cost-movements", from, to],
    queryFn: async () => fetchAll<any>(supabase
      .from("inventory_movements")
      .select("product_id,quantity,cost_price,created_at,products(name)")
      .eq("type", "sale")
      .gte("created_at", fromTs).lte("created_at", toTs)
    ),
  });

  const { data: purchases } = useQuery({
    queryKey: ["report-purchases", from, to],
    queryFn: async () => fetchAll<any>(supabase
      .from("purchases")
      .select("quantity,cost_price,total_cost,created_at,products(name),warehouses(name)")
      .gte("created_at", fromTs).lte("created_at", toTs)
      .order("created_at", { ascending: false })
    ),
  });

  const { data: debtors } = useQuery({
    queryKey: ["report-debtors"],
    queryFn: async () => fetchAll<any>(supabase
      .from("customers").select("id,name,phone,balance").gt("balance", 0).order("balance", { ascending: false })
    ),
  });

  const { data: stockRows } = useQuery({
    queryKey: ["report-stock"],
    queryFn: async () => fetchAll<any>(supabase
      .from("inventory_batches")
      .select("remaining,cost_price,products(name,category),warehouses(name)")
      .gt("remaining", 0)
    ),
  });

  const { data: topCustomers } = useQuery({
    queryKey: ["report-top-customers", from, to],
    queryFn: async () => fetchAll<any>(supabase
      .from("sales")
      .select("customer_id,total_sale,profit,remaining_debt,customers(name,phone)")
      .eq("status", "completed")
      .gte("created_at", fromTs).lte("created_at", toTs)
      .not("customer_id", "is", null)
    ),
  });

  // ---- Aggregations
  const totals = useMemo(() => {
    const s = sales ?? [];
    return {
      count: s.length,
      revenue: s.reduce((a, x) => a + Number(x.total_sale), 0),
      cost: s.reduce((a, x) => a + Number(x.total_cost), 0),
      profit: s.reduce((a, x) => a + Number(x.profit), 0),
      cash: s.filter((x) => x.payment_method === "cash").reduce((a, x) => a + Number(x.amount_paid), 0),
      click: s.filter((x) => x.payment_method === "click").reduce((a, x) => a + Number(x.amount_paid), 0),
      debt: s.reduce((a, x) => a + Number(x.remaining_debt), 0),
    };
  }, [sales]);

  const prevTotals = useMemo(() => {
    const s = prevSales ?? [];
    return {
      revenue: s.reduce((a, x) => a + Number(x.total_sale), 0),
      profit: s.reduce((a, x) => a + Number(x.profit), 0),
    };
  }, [prevSales]);

  const revenueDelta = prevTotals.revenue > 0 ? ((totals.revenue - prevTotals.revenue) / prevTotals.revenue) * 100 : null;
  const profitDelta = prevTotals.profit > 0 ? ((totals.profit - prevTotals.profit) / prevTotals.profit) * 100 : null;

  // Daily series for sparkline
  const dailySeries = useMemo(() => {
    const map = new Map<string, number>();
    const cursor = new Date(from);
    const end = new Date(to);
    while (cursor <= end) {
      map.set(cursor.toISOString().slice(0, 10), 0);
      cursor.setDate(cursor.getDate() + 1);
    }
    (sales ?? []).forEach((s) => {
      const k = String(s.created_at).slice(0, 10);
      if (map.has(k)) map.set(k, (map.get(k) || 0) + Number(s.total_sale));
    });
    return Array.from(map.entries()).map(([day, value]) => ({ day, value }));
  }, [sales, from, to]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; category: string | null; qty: number; revenue: number; profit: number }>();
    (items ?? []).forEach((i) => {
      const p = i.products as unknown as { name: string; category: string | null } | null;
      const key = p?.name ?? "—";
      const ex = map.get(key) ?? { name: key, category: p?.category ?? null, qty: 0, revenue: 0, profit: 0 };
      ex.qty += Number(i.quantity);
      ex.revenue += Number(i.total_price);
      ex.profit += Number(i.total_price) - Number(i.total_cost);
      map.set(key, ex);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [items]);

  // Per-product cost breakdown: { productName: [{ cost, qty, value }] }
  const productCostBreakdown = useMemo(() => {
    const map = new Map<string, Map<number, { cost: number; qty: number; value: number }>>();
    (costMovements ?? []).forEach((m) => {
      const p = m.products as unknown as { name: string } | null;
      const name = p?.name ?? "—";
      const cost = Math.round(Number(m.cost_price) || 0);
      const qty = Math.abs(Number(m.quantity) || 0);
      if (!map.has(name)) map.set(name, new Map());
      const inner = map.get(name)!;
      const ex = inner.get(cost) ?? { cost, qty: 0, value: 0 };
      ex.qty += qty;
      ex.value += qty * cost;
      inner.set(cost, ex);
    });
    const out: Record<string, Array<{ cost: number; qty: number; value: number }>> = {};
    map.forEach((inner, name) => {
      out[name] = Array.from(inner.values()).sort((a, b) => a.cost - b.cost);
    });
    return out;
  }, [costMovements]);

  const branchAgg = useMemo(() => {
    const map = new Map<string, { id: string; name: string; revenue: number; profit: number; cost: number; cash: number; click: number; debt: number; count: number }>();
    (sales ?? []).forEach((s) => {
      const b = s.branches as unknown as { name: string } | null;
      const id = (s.branch_id as string) ?? "—";
      const ex = map.get(id) ?? { id, name: b?.name ?? "—", revenue: 0, profit: 0, cost: 0, cash: 0, click: 0, debt: 0, count: 0 };
      ex.revenue += Number(s.total_sale);
      ex.profit += Number(s.profit);
      ex.cost += Number(s.total_cost);
      ex.debt += Number(s.remaining_debt);
      ex.count += 1;
      if (s.payment_method === "cash") ex.cash += Number(s.amount_paid);
      if (s.payment_method === "click") ex.click += Number(s.amount_paid);
      map.set(id, ex);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  const branchProducts = useMemo(() => {
    const map = new Map<string, Map<string, { name: string; qty: number; revenue: number; profit: number }>>();
    (items ?? []).forEach((i) => {
      const sale = i.sales as unknown as { branch_id: string } | null;
      if (!sale) return;
      const bId = sale.branch_id ?? "—";
      const p = i.products as unknown as { name: string } | null;
      const pname = p?.name ?? "—";
      if (!map.has(bId)) map.set(bId, new Map());
      const inner = map.get(bId)!;
      const ex = inner.get(pname) ?? { name: pname, qty: 0, revenue: 0, profit: 0 };
      ex.qty += Number(i.quantity);
      ex.revenue += Number(i.total_price);
      ex.profit += Number(i.total_price) - Number(i.total_cost);
      inner.set(pname, ex);
    });
    const result: Record<string, Array<{ name: string; qty: number; revenue: number; profit: number }>> = {};
    map.forEach((inner, bId) => {
      result[bId] = Array.from(inner.values()).sort((a, b) => b.revenue - a.revenue);
    });
    return result;
  }, [items]);

  const stockAgg = useMemo(() => {
    const map = new Map<string, { product: string; warehouse: string; qty: number; cost: number; value: number }>();
    (stockRows ?? []).forEach((r) => {
      const p = r.products as unknown as { name: string } | null;
      const w = r.warehouses as unknown as { name: string } | null;
      const key = `${p?.name ?? "—"}__${w?.name ?? "—"}`;
      const ex = map.get(key) ?? { product: p?.name ?? "—", warehouse: w?.name ?? "—", qty: 0, cost: 0, value: 0 };
      ex.qty += Number(r.remaining);
      ex.value += Number(r.remaining) * Number(r.cost_price);
      ex.cost = ex.qty > 0 ? ex.value / ex.qty : 0;
      map.set(key, ex);
    });
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [stockRows]);

  const topCustomersAgg = useMemo(() => {
    const map = new Map<string, { id: string; name: string; phone: string | null; revenue: number; profit: number; debt: number; count: number }>();
    (topCustomers ?? []).forEach((s) => {
      const c = s.customers as unknown as { name: string; phone: string | null } | null;
      const id = s.customer_id as string;
      const ex = map.get(id) ?? { id, name: c?.name ?? "—", phone: c?.phone ?? null, revenue: 0, profit: 0, debt: 0, count: 0 };
      ex.revenue += Number(s.total_sale);
      ex.profit += Number(s.profit);
      ex.debt += Number(s.remaining_debt);
      ex.count += 1;
      map.set(id, ex);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 50);
  }, [topCustomers]);

  // ---- Filter helper for current tab
  const q = search.trim().toLowerCase();
  const matches = (s: string | null | undefined) => !q || (s ?? "").toLowerCase().includes(q);

  const presets = [
    { label: "Bugun", from: todayISO(0), to: todayISO(0) },
    { label: "7 kun", from: todayISO(-6), to: todayISO(0) },
    { label: "30 kun", from: todayISO(-29), to: todayISO(0) },
    { label: "Bu oy", from: startOfMonthISO(), to: todayISO(0) },
  ];
  const activePreset = presets.find((p) => p.from === from && p.to === to);
  const rangeLabel = activePreset?.label ?? (from === to ? from : `${from.slice(5)} → ${to.slice(5)}`);

  // ---- Export
  const stamp = `${from}_${to}`;
  type ExportConfig = {
    title: string;
    file: string;
    columns: PdfReportColumn[];
    rows: Array<Record<string, unknown>>;
    kpis?: Array<{ label: string; value: string; tone?: "default" | "success" | "warning" | "danger" }>;
    chart?: { title: string; series: Array<{ label?: string; value: number }>; type?: "line" | "bar" };
  };
  const summaryKpis = (): ExportConfig["kpis"] => {
    const k = [
      { label: "Tushum", value: fmtMoney(totals.revenue), tone: "success" as const },
      { label: "Sotuvlar", value: String(totals.count) },
      { label: "Naqd", value: fmtMoney(totals.cash) },
      { label: "Click", value: fmtMoney(totals.click) },
      { label: "Qarz", value: fmtMoney(totals.debt), tone: (totals.debt > 0 ? "warning" : "default") as "warning" | "default" },
    ];
    if (isSuperAdmin) k.splice(1, 0, { label: "Foyda", value: fmtMoney(totals.profit), tone: "success" as const });
    return k;
  };
  const summaryChart = (): ExportConfig["chart"] => ({
    title: "Kunlik tushum",
    type: "line",
    series: dailySeries.map((d) => ({ label: d.day.slice(5), value: d.value })),
  });
  const buildExport = (id: TabId): ExportConfig => {
    if (id === "overview" || id === "products") {
      const cols: PdfReportColumn[] = [
        { header: "Mahsulot", key: "nomi" },
        { header: "Kategoriya", key: "kategoriya" },
        { header: "Soni", key: "soni", number: true },
        { header: "Tushum", key: "tushum", money: true },
      ];
      if (isSuperAdmin) cols.push({ header: "Foyda", key: "foyda", money: true });
      return {
        title: "Top mahsulotlar", file: `mahsulotlar-${stamp}`, columns: cols,
        rows: topProducts.map((p) => ({ nomi: p.name, kategoriya: p.category ?? "", soni: p.qty, tushum: p.revenue, foyda: p.profit })),
        kpis: summaryKpis(),
        chart: summaryChart(),
      };
    }
    if (id === "purchases") return {
      title: "Xaridlar", file: `xaridlar-${stamp}`,
      columns: [
        { header: "Sana", key: "sana" }, { header: "Mahsulot", key: "mahsulot" },
        { header: "Sklad", key: "sklad" }, { header: "Soni", key: "soni", number: true },
        { header: "Tannarx", key: "tannarx", money: true }, { header: "Jami", key: "jami", money: true },
      ],
      rows: (purchases ?? []).map((p) => {
        const prod = p.products as unknown as { name: string } | null;
        const wh = p.warehouses as unknown as { name: string } | null;
        return { sana: fmtDate(p.created_at), mahsulot: prod?.name ?? "", sklad: wh?.name ?? "", soni: p.quantity, tannarx: p.cost_price, jami: p.total_cost };
      }),
    };
    if (id === "branches") return {
      title: "Filiallar bo'yicha hisobot", file: `filiallar-${stamp}`,
      columns: [
        { header: "Filial", key: "filial" }, { header: "Sotuvlar", key: "sotuvlar", number: true },
        { header: "Tushum", key: "tushum", money: true }, { header: "Tannarx", key: "tannarx", money: true },
        { header: "Foyda", key: "foyda", money: true }, { header: "Naqd", key: "naqd", money: true },
        { header: "Click", key: "click", money: true }, { header: "Qarz", key: "qarz", money: true },
      ],
      rows: branchAgg.map((b) => ({ filial: b.name, sotuvlar: b.count, tushum: b.revenue, tannarx: b.cost, foyda: b.profit, naqd: b.cash, click: b.click, qarz: b.debt })),
      kpis: summaryKpis(),
      chart: { title: "Filiallar tushumi", type: "bar", series: branchAgg.map((b) => ({ label: b.name, value: b.revenue })) },
    };
    if (id === "debtors") return {
      title: "Qarzdor mijozlar", file: `qarzdorlar-${todayISO(0)}`,
      columns: [{ header: "Ism", key: "ism" }, { header: "Telefon", key: "telefon" }, { header: "Qarz", key: "qarz", money: true }],
      rows: (debtors ?? []).map((d) => ({ ism: d.name, telefon: d.phone ?? "", qarz: d.balance })),
    };
    if (id === "stock") {
      const cols: PdfReportColumn[] = [
        { header: "Mahsulot", key: "mahsulot" }, { header: "Sklad", key: "sklad" },
        { header: "Soni", key: "soni", number: true },
      ];
      if (isSuperAdmin) {
        cols.push({ header: "O'rt. tannarx", key: "ortacha_tannarx", money: true });
        cols.push({ header: "Qiymat", key: "qiymat", money: true });
      }
      return {
        title: "Ombor qoldiqlari", file: `qoldiqlar-${todayISO(0)}`, columns: cols,
        rows: stockAgg.map((s) => ({ mahsulot: s.product, sklad: s.warehouse, soni: s.qty, ortacha_tannarx: Math.round(s.cost), qiymat: Math.round(s.value) })),
      };
    }
    return {
      title: "Top mijozlar", file: `top-mijozlar-${stamp}`,
      columns: [
        { header: "Ism", key: "ism" }, { header: "Telefon", key: "telefon" },
        { header: "Sotuvlar", key: "sotuvlar", number: true }, { header: "Tushum", key: "tushum", money: true },
        { header: "Foyda", key: "foyda", money: true }, { header: "Qarz", key: "qarz", money: true },
      ],
      rows: topCustomersAgg.map((c) => ({ ism: c.name, telefon: c.phone ?? "", sotuvlar: c.count, tushum: c.revenue, foyda: c.profit, qarz: c.debt })),
    };
  };
  const exportNow = (format: "csv" | "pdf") => {
    try {
      if (tab === "daily") {
        toast.info("Kunlik bo'limning o'z eksporti bor", { description: "Pastdagi 'Eksport' tugmasini bosing." });
        return;
      }
      const c = buildExport(tab);
      if (!c.rows.length) {
        toast.warning("Tanlangan davrda ma'lumot yo'q", { description: "Filtr yoki sanalarni o'zgartirib ko'ring." });
        return;
      }
      if (format === "csv") {
        downloadCSV(`${c.file}.csv`, c.rows);
        toast.success("CSV yuklab olindi");
      } else {
        generatePdfReport({
          title: c.title,
          subtitle: `${from} — ${to}`,
          columns: c.columns,
          rows: c.rows,
          filename: `${c.file}.pdf`,
          kpis: c.kpis,
          chart: c.chart,
        });
        toast.success("PDF tayyor", { description: "Yangi tabda ochildi va yuklab olindi." });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Noma'lum xatolik";
      toast.error("Eksport xatosi", {
        description: msg,
        action: { label: "Qayta urinish", onClick: () => exportNow(format) },
        duration: 8000,
      });
    }
  };

  // ---- Filtered datasets per tab
  const fProducts = useMemo(() => topProducts.filter((p) => matches(p.name) || matches(p.category)), [topProducts, q]);
  const fPurchases = useMemo(() => (purchases ?? []).filter((p) => {
    const prod = p.products as unknown as { name: string } | null;
    const wh = p.warehouses as unknown as { name: string } | null;
    return matches(prod?.name) || matches(wh?.name);
  }), [purchases, q]);
  const fDebtors = useMemo(() => (debtors ?? []).filter((d) => matches(d.name) || matches(d.phone)), [debtors, q]);
  const fStock = useMemo(() => stockAgg.filter((s) => matches(s.product) || matches(s.warehouse)), [stockAgg, q]);
  const fTop = useMemo(() => topCustomersAgg.filter((c) => matches(c.name) || matches(c.phone)), [topCustomersAgg, q]);
  const fBranches = useMemo(() => branchAgg.filter((b) => matches(b.name)), [branchAgg, q]);

  return (
    <>
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b bg-background/90 px-3 py-3 backdrop-blur lg:px-6 lg:py-5">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">Hisobotlar</h1>
          <div className="hidden text-sm text-muted-foreground sm:block">Sotuv, foyda, qarz va ombor tahlili</div>
        </div>
        <div className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5"><Download className="h-3.5 w-3.5" /><span>Eksport</span></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-[11px]">Joriy bo'limni saqlash</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportNow("pdf")}><FileText className="h-4 w-4 mr-2" /> PDF hujjat</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportNow("csv")}><Download className="h-4 w-4 mr-2" /> CSV jadval</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
        </div>
      </div>

      <div className="max-w-full overflow-x-hidden px-3 lg:px-6 pt-3 lg:pt-5 pb-28 lg:pb-8 space-y-3 sm:space-y-4">
        {/* ===== Period chip + search row ===== */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
          <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
            <SheetTrigger asChild>
              <button className="group flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-sm font-medium hover:border-primary/40 transition-colors shrink-0">
                <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                <span className="max-w-[92px] truncate sm:max-w-none">{rangeLabel}</span>
                <span className="hidden text-[10px] text-muted-foreground xs:inline">· {periodDays}k</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl">
              <SheetHeader className="text-left mb-4">
                <SheetTitle className="flex items-center gap-2"><CalendarIcon className="h-4 w-4 text-primary" /> Sana oralig'i</SheetTitle>
              </SheetHeader>
              <div className="space-y-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Tezkor</div>
                  <div className="grid grid-cols-2 gap-2">
                    {presets.map((p) => {
                      const active = from === p.from && to === p.to;
                      return (
                        <button key={p.label} onClick={() => { setFrom(p.from); setTo(p.to); }}
                          className={cn(
                            "rounded-xl border px-3 py-3 text-sm font-medium transition-all active:scale-[0.98]",
                            active ? "border-primary bg-primary/15 text-primary shadow-sm" : "border-border bg-card hover:border-primary/30"
                          )}>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label className="text-xs">Boshlanish</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11" /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Tugash</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11" /></div>
                </div>
                <Button className="w-full" size="lg" onClick={() => setFilterOpen(false)}>Qo'llash</Button>
              </div>
            </SheetContent>
          </Sheet>

          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Qidirish..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 rounded-full text-sm"
            />
          </div>
        </div>

        {/* ===== HERO: Tushum + delta + sparkline ===== */}
        <HeroCard
          revenue={totals.revenue}
          profit={totals.profit}
          revenueDelta={revenueDelta}
          profitDelta={profitDelta}
          series={dailySeries}
          isSuperAdmin={isSuperAdmin}
          rangeLabel={rangeLabel}
        />

        {/* ===== Compact KPI grid ===== */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 min-w-0">
          <KpiTile icon={<ShoppingBag className="h-3.5 w-3.5" />} label="Sotuvlar" value={String(totals.count)} tone="default" />
          <KpiTile icon={<Wallet className="h-3.5 w-3.5" />} label="Naqd" value={fmtMoney(totals.cash)} tone="default" />
          <KpiTile icon={<CreditCard className="h-3.5 w-3.5" />} label="Click" value={fmtMoney(totals.click)} tone="default" />
          <KpiTile icon={<AlertCircle className="h-3.5 w-3.5" />} label="Qarz" value={fmtMoney(totals.debt)} tone={totals.debt > 0 ? "warning" : "default"} />
        </div>

        {/* ===== Segmented tabs (icon + counter) ===== */}
        <div className="max-w-full overflow-hidden">
          <div className="grid grid-cols-4 gap-1.5 lg:flex lg:min-w-max lg:pb-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              const counts: Partial<Record<TabId, number>> = {
                products: topProducts.length, branches: branchAgg.length, purchases: purchases?.length ?? 0,
                debtors: debtors?.length ?? 0, stock: stockAgg.length, top: topCustomersAgg.length,
              };
              const count = counts[t.id];
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={cn(
                    "min-w-0 flex items-center justify-center gap-1 rounded-full border px-2 py-1.5 text-[11px] sm:text-sm font-medium transition-all active:scale-[0.97] lg:px-3.5",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_oklch(0.65_0.22_255/0.5)]"
                      : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-border/80"
                  )}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t.short}</span>
                  {count !== undefined && count > 0 && (
                    <span className={cn("hidden rounded-full px-1.5 text-[10px] font-semibold tabular-nums sm:inline", active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground")}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ===== Tab content ===== */}
        {tab === "overview" && (
          <OverviewSection
            isSuperAdmin={isSuperAdmin}
            topProducts={fProducts.slice(0, 5)}
            branchAgg={branchAgg.slice(0, 4)}
            debtors={debtors ?? []}
            totals={totals}
            onJump={(id) => setTab(id)}
          />
        )}

        {tab === "daily" && <DailyReport embedded />}

        {tab === "products" && (
          <SectionCard title="Mahsulotlar" subtitle={`${fProducts.length} ta · tushum bo'yicha`} icon={<ShoppingBag className="h-4 w-4 text-primary" />}>
            {fProducts.length === 0 ? <Empty label="Mahsulot topilmadi" /> : (
              <div className="divide-y">
                {fProducts.map((p, i) => {
                  const max = Math.max(1, fProducts[0].revenue);
                  const isOpen = expandedProduct === p.name;
                  const breakdown = productCostBreakdown[p.name] ?? [];
                  return (
                    <div key={p.name}>
                      <button onClick={() => setExpandedProduct(isOpen ? null : p.name)} className="w-full px-3.5 py-2.5 text-left hover:bg-accent/30 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums",
                            i === 0 ? "bg-warning/20 text-warning" : i < 3 ? "bg-primary/15 text-primary" : "bg-accent text-muted-foreground")}>
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
                              <div className="font-medium text-sm truncate">{p.name}</div>
                              <div className="max-w-[132px] truncate text-right font-mono font-semibold text-xs sm:text-sm shrink-0">{fmtMoney(p.revenue)}</div>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="truncate">{p.category ?? "—"}</span>
                              <span>·</span>
                              <span className="font-mono">{p.qty} dona</span>
                              {isSuperAdmin && <span className="ml-auto text-success font-mono">+{fmtCompact(p.profit)}</span>}
                            </div>
                            <div className="mt-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-primary to-primary/50" style={{ width: `${(p.revenue / max) * 100}%` }} />
                            </div>
                          </div>
                          <ChevronRight className={cn("h-4 w-4 text-muted-foreground shrink-0 mt-0.5 transition-transform", isOpen && "rotate-90")} />
                        </div>
                      </button>
                      {isOpen && (
                        <div className="bg-accent/20 border-t px-3.5 py-3">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Tannarx bo'yicha taqsimot (FIFO)</div>
                          {breakdown.length === 0 ? (
                            <div className="text-xs text-muted-foreground py-2 text-center">Ma'lumot yo'q</div>
                          ) : (
                            <div className="space-y-1">
                              {breakdown.map((b) => (
                                <div key={b.cost} className="rounded-md bg-card/60 px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-mono font-semibold tabular-nums">{b.qty}</span>
                                    <span className="text-muted-foreground">dona ×</span>
                                    <span className="font-mono">{fmtMoney(b.cost)}</span>
                                  </div>
                                  {isSuperAdmin && (
                                    <span className="font-mono text-muted-foreground shrink-0">= {fmtMoney(b.value)}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        )}

        {tab === "branches" && isSuperAdmin && (
          <SectionCard title="Filiallar" subtitle={`${fBranches.length} ta filial`} icon={<Building2 className="h-4 w-4 text-primary" />}>
            {fBranches.length === 0 ? <Empty label="Filial sotuvi yo'q" /> : (
              <div className="divide-y">
                {fBranches.map((b) => {
                  const isOpen = expandedBranch === b.id;
                  const products = (branchProducts[b.id] ?? []).slice(0, isOpen ? undefined : 0);
                  const max = Math.max(1, fBranches[0].revenue);
                  const margin = b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0;
                  return (
                    <div key={b.id}>
                      <button onClick={() => setExpandedBranch(isOpen ? null : b.id)} className="w-full px-3.5 py-3 text-left hover:bg-accent/30 active:bg-accent/50 transition-colors">
                        <div className="flex items-start gap-3">
                          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold uppercase",
                            isOpen ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
                            {b.name.slice(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2">
                              <div className="font-semibold text-sm truncate">{b.name}</div>
                              <div className="max-w-[132px] truncate text-right font-mono font-semibold text-xs sm:text-sm shrink-0">{fmtMoney(b.revenue)}</div>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                              <span>{b.count} sotuv</span>
                              <span>·</span>
                              <span className="text-success font-mono">+{fmtMoney(b.profit)}</span>
                              <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold", margin >= 20 ? "bg-success/15 text-success" : margin >= 10 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground")}>
                                {margin.toFixed(0)}% marja
                              </span>
                            </div>
                            <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-primary to-primary/60" style={{ width: `${(b.revenue / max) * 100}%` }} />
                            </div>
                          </div>
                          <ChevronRight className={cn("h-4 w-4 text-muted-foreground shrink-0 mt-0.5 transition-transform", isOpen && "rotate-90")} />
                        </div>
                      </button>
                      {isOpen && (
                        <div className="bg-accent/20 border-t px-3.5 py-3 space-y-3">
                          <div className="grid grid-cols-3 gap-2">
                            <MicroStat label="Naqd" value={fmtCompact(b.cash)} icon={<Wallet className="h-3 w-3" />} />
                            <MicroStat label="Click" value={fmtCompact(b.click)} icon={<CreditCard className="h-3 w-3" />} />
                            <MicroStat label="Qarz" value={fmtCompact(b.debt)} icon={<AlertCircle className="h-3 w-3" />} tone={b.debt > 0 ? "warning" : "default"} />
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 px-0.5">Mahsulotlar</div>
                            {products.length === 0 ? (
                              <div className="text-xs text-muted-foreground py-2 text-center">Sotuv yo'q</div>
                            ) : (
                              <div className="space-y-1">
                                {(branchProducts[b.id] ?? []).slice(0, 8).map((p) => {
                                  const pmax = Math.max(1, (branchProducts[b.id] ?? [])[0]?.revenue ?? 1);
                                  return (
                                    <div key={p.name} className="rounded-md bg-card/60 px-2.5 py-1.5">
                                      <div className="flex items-baseline justify-between gap-2 text-xs">
                                        <span className="truncate font-medium">{p.name}</span>
                                        <span className="max-w-[120px] truncate text-right font-mono shrink-0">{fmtMoney(p.revenue)}</span>
                                      </div>
                                      <div className="mt-1 flex items-center gap-1.5">
                                        <div className="h-0.5 flex-1 rounded-full bg-muted overflow-hidden">
                                          <div className="h-full bg-primary/70" style={{ width: `${(p.revenue / pmax) * 100}%` }} />
                                        </div>
                                        <span className="text-[10px] text-muted-foreground tabular-nums">{p.qty}d</span>
                                        <span className="text-[10px] text-success font-mono">+{fmtCompact(p.profit)}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        )}

        {tab === "purchases" && isSuperAdmin && (
          <SectionCard title="Xaridlar" subtitle={`${fPurchases.length} ta`} icon={<Package className="h-4 w-4 text-primary" />}>
            {fPurchases.length === 0 ? <Empty label="Xarid yo'q" /> : (
              <div className="divide-y">
                {fPurchases.map((p, i) => {
                  const prod = p.products as unknown as { name: string } | null;
                  const wh = p.warehouses as unknown as { name: string } | null;
                  return (
                    <div key={i} className="px-3.5 py-2.5 flex items-start gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent">
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="font-medium text-sm truncate">{prod?.name ?? "—"}</div>
                          <div className="max-w-[128px] truncate text-right font-mono font-semibold text-xs sm:text-sm shrink-0">{fmtMoney(p.total_cost)}</div>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="truncate">{wh?.name ?? "—"}</span>
                          <span>·</span>
                          <span>{fmtDate(p.created_at)}</span>
                          <span className="ml-auto font-mono shrink-0">{p.quantity} × {fmtCompact(Number(p.cost_price))}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        )}

        {tab === "debtors" && (
          <SectionCard title="Qarzdor mijozlar" subtitle={`${fDebtors.length} ta · jami ${fmtMoney(fDebtors.reduce((a, d) => a + Number(d.balance), 0))}`} icon={<AlertCircle className="h-4 w-4 text-warning" />}>
            {fDebtors.length === 0 ? <Empty label="Qarzdorlar yo'q" /> : (
              <div className="divide-y">
                {fDebtors.map((d) => (
                  <div key={d.id} className="px-3.5 py-2.5 flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning text-xs font-bold uppercase">
                      {d.name.slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{d.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{d.phone ?? "—"}</div>
                    </div>
                    <div className="max-w-[128px] truncate text-right font-mono font-semibold text-warning text-xs sm:text-sm shrink-0">{fmtMoney(d.balance)}</div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {tab === "stock" && (
          <SectionCard title="Ombor qoldiqlari" subtitle={`${fStock.length} pozitsiya${isSuperAdmin ? ` · ${fmtMoney(fStock.reduce((a, s) => a + s.value, 0))} qiymat` : ""}`} icon={<Boxes className="h-4 w-4 text-primary" />}>
            {fStock.length === 0 ? <Empty label="Qoldiq yo'q" /> : (
              <div className="divide-y">
                {fStock.map((s, i) => {
                  const max = Math.max(1, fStock[0].qty);
                  return (
                    <div key={i} className="px-3.5 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="font-medium text-sm truncate flex-1">{s.product}</div>
                        {isSuperAdmin ? (
                          <div className="max-w-[128px] truncate text-right font-mono font-semibold text-xs sm:text-sm shrink-0">{fmtMoney(s.value)}</div>
                        ) : (
                          <div className="font-mono font-semibold text-sm shrink-0">{s.qty}</div>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{s.warehouse}</span>
                        <span className="ml-auto font-mono shrink-0">
                          {s.qty} dona{isSuperAdmin && ` · ${fmtCompact(s.cost)} tannarx`}
                        </span>
                      </div>
                      <div className="mt-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary/60" style={{ width: `${(s.qty / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        )}

        {tab === "top" && isSuperAdmin && (
          <SectionCard title="Top mijozlar" subtitle={`${fTop.length} ta · davr bo'yicha`} icon={<Crown className="h-4 w-4 text-warning" />}>
            {fTop.length === 0 ? <Empty label="Mijozli sotuv yo'q" /> : (
              <div className="divide-y">
                {fTop.map((c, i) => (
                  <div key={c.id} className="px-3.5 py-2.5 flex items-start gap-3">
                    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      i === 0 ? "bg-warning/20 text-warning" : i < 3 ? "bg-primary/15 text-primary" : "bg-accent text-muted-foreground")}>
                      {i < 3 ? <Crown className="h-4 w-4" /> : `#${i + 1}`}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="font-medium text-sm truncate">{c.name}</div>
                        <div className="max-w-[128px] truncate text-right font-mono font-semibold text-xs sm:text-sm shrink-0">{fmtMoney(c.revenue)}</div>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{c.phone ?? "—"}</span>
                        <span>·</span>
                        <span>{c.count} sotuv</span>
                        <span className="ml-auto text-success font-mono">+{fmtCompact(c.profit)}</span>
                        {c.debt > 0 && <span className="text-warning font-mono">-{fmtCompact(c.debt)}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}
      </div>

      {/* Mobile floating filter FAB */}
      <button onClick={() => setFilterOpen(true)}
        className="sm:hidden fixed bottom-20 right-4 z-30 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-[0_8px_24px_-4px_oklch(0.65_0.22_255/0.5)] flex items-center justify-center active:scale-95 transition-transform"
        aria-label="Filtr">
        <Filter className="h-5 w-5" />
      </button>
    </>
  );
}

// ---- Components ----

function HeroCard({ revenue, profit, revenueDelta, profitDelta, series, isSuperAdmin, rangeLabel }: {
  revenue: number; profit: number; revenueDelta: number | null; profitDelta: number | null;
  series: { day: string; value: number }[]; isSuperAdmin: boolean; rangeLabel: string;
}) {
  const max = Math.max(1, ...series.map((s) => s.value));
  const points = series.map((s, i) => {
    const x = (i / Math.max(1, series.length - 1)) * 100;
    const y = 100 - (s.value / max) * 100;
    return `${x},${y}`;
  }).join(" ");
  const areaPoints = series.length > 0 ? `0,100 ${points} 100,100` : "";

  return (
    <div className="relative max-w-full rounded-xl sm:rounded-2xl border bg-gradient-to-br from-card via-card to-primary/5 p-3.5 sm:p-5 overflow-hidden">
      <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="relative">
        <div className="grid gap-3 sm:flex sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3 w-3 text-primary" /> Tushum · {rangeLabel}
            </div>
            <div className="mt-1.5 text-[26px] sm:text-[34px] leading-none font-bold tracking-tight tabular-nums break-words">
              {fmtMoney(revenue)}
            </div>
            <DeltaPill delta={revenueDelta} className="mt-2" />
          </div>
          {isSuperAdmin && (
            <div className="min-w-0 text-left sm:text-right">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Sof foyda</div>
              <div className="mt-1.5 text-base sm:text-xl font-semibold tabular-nums text-success break-words">
                {fmtMoney(profit)}
              </div>
              <DeltaPill delta={profitDelta} className="mt-1.5 sm:ml-auto" />
            </div>
          )}
        </div>

        {/* Sparkline */}
        {series.length > 1 && (
          <div className="mt-4 h-20 -mx-1">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.65 0.22 255)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="oklch(0.65 0.22 255)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={areaPoints} fill="url(#heroFill)" />
              <polyline
                points={points}
                fill="none"
                stroke="oklch(0.65 0.22 255)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

function DeltaPill({ delta, className }: { delta: number | null; className?: string }) {
  if (delta === null) return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground", className)}>
      Yangi davr
    </span>
  );
  const positive = delta >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
      positive ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
      className
    )}>
      <Icon className="h-2.5 w-2.5" />
      {positive ? "+" : ""}{delta.toFixed(1)}%
      <span className="text-muted-foreground font-normal">vs oldin</span>
    </span>
  );
}

function KpiTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "default" | "warning" | "success" }) {
  return (
    <div className={cn(
      "min-w-0 rounded-xl border bg-card p-3",
      tone === "warning" && "border-warning/30 bg-warning/5"
    )}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className={cn(tone === "warning" && "text-warning", tone === "success" && "text-success")}>{icon}</span>
        {label}
      </div>
      <div className={cn("mt-1 text-sm sm:text-lg font-semibold tabular-nums break-words leading-tight", tone === "warning" && "text-warning")}>
        {value}
      </div>
    </div>
  );
}

function MicroStat({ icon, label, value, tone = "default" }: { icon: React.ReactNode; label: string; value: string; tone?: "default" | "warning" }) {
  return (
    <div className={cn("rounded-md bg-card/60 px-2 py-1.5", tone === "warning" && "bg-warning/10")}>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className={cn("mt-0.5 text-xs font-semibold tabular-nums", tone === "warning" && "text-warning")}>{value}</div>
    </div>
  );
}

function SectionCard({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="max-w-full rounded-xl sm:rounded-2xl border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 border-b px-3.5 py-3">
        {icon && <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">{icon}</div>}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function RankedList({ items }: { items: Array<{ key: string; rank: number; title: string; sub: string; primary: string; secondary: string; meta?: string; bar: number; positive?: boolean }> }) {
  return (
    <div className="divide-y overflow-hidden">
      {items.map((it) => (
        <div key={it.key} className="px-3.5 py-2.5">
          <div className="flex items-start gap-3">
            <div className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums",
              it.rank === 1 ? "bg-warning/20 text-warning" : it.rank <= 3 ? "bg-primary/15 text-primary" : "bg-accent text-muted-foreground"
            )}>
              {it.rank}
            </div>
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
                <div className="font-medium text-sm truncate">{it.title}</div>
                <div className="max-w-[132px] truncate text-right font-mono font-semibold text-xs sm:text-sm shrink-0 tabular-nums">{it.primary}</div>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate">{it.sub}</span>
                <span className={cn("ml-auto font-mono shrink-0", it.positive && "text-success")}>{it.secondary}</span>
              </div>
              <div className="mt-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-primary/50" style={{ width: `${Math.max(2, it.bar * 100)}%` }} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <FileText className="h-4 w-4 text-muted-foreground/60" />
      </div>
      {label}
    </div>
  );
}

function OverviewSection({ isSuperAdmin, topProducts, branchAgg, debtors, totals, onJump }: {
  isSuperAdmin: boolean;
  topProducts: Array<{ name: string; category: string | null; qty: number; revenue: number; profit: number }>;
  branchAgg: Array<{ id: string; name: string; revenue: number; profit: number; count: number }>;
  debtors: Array<{ id: string; name: string; phone: string | null; balance: number | string }>;
  totals: { count: number; debt: number };
  onJump: (id: TabId) => void;
}) {
  const totalDebt = debtors.reduce((a, d) => a + Number(d.balance), 0);
  return (
    <div className="space-y-3">
      <SectionCard title="Top mahsulotlar" subtitle="Eng ko'p tushum keltirgan 5 ta" icon={<ShoppingBag className="h-4 w-4 text-primary" />}>
        {topProducts.length === 0 ? <Empty label="Mahsulot sotilmadi" /> : (
          <RankedList
            items={topProducts.map((p, i) => ({
              key: p.name, rank: i + 1, title: p.name, sub: p.category ?? "—",
              primary: fmtMoney(p.revenue),
              secondary: isSuperAdmin ? `+${fmtMoney(p.profit)}` : `${p.qty} dona`,
              bar: p.revenue / Math.max(1, topProducts[0].revenue),
              positive: true,
            }))}
          />
        )}
        <button onClick={() => onJump("products")} className="w-full border-t px-3.5 py-2.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors flex items-center justify-center gap-1">
          Barchasini ko'rish <ChevronRight className="h-3 w-3" />
        </button>
      </SectionCard>

      {isSuperAdmin && branchAgg.length > 0 && (
        <SectionCard title="Filiallar tezkor ko'rinish" subtitle={`${branchAgg.length} ta filial`} icon={<Building2 className="h-4 w-4 text-primary" />}>
          <div className="divide-y">
            {branchAgg.map((b) => {
              const max = Math.max(1, branchAgg[0].revenue);
              return (
                <button key={b.id} onClick={() => onJump("branches")} className="w-full px-3.5 py-2.5 text-left hover:bg-accent/30 transition-colors">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
                    <div className="font-medium text-sm truncate">{b.name}</div>
                    <div className="max-w-[132px] truncate text-right font-mono font-semibold text-xs sm:text-sm shrink-0">{fmtMoney(b.revenue)}</div>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{b.count} sotuv</span>
                    <span className="ml-auto text-success font-mono">+{fmtCompact(b.profit)}</span>
                  </div>
                  <div className="mt-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary/60" style={{ width: `${(b.revenue / max) * 100}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        </SectionCard>
      )}

      {totalDebt > 0 && (
        <SectionCard title="Diqqatga sazovor" subtitle={`${debtors.length} ta qarzdor · ${fmtMoney(totalDebt)}`} icon={<AlertCircle className="h-4 w-4 text-warning" />}>
          <div className="divide-y">
            {debtors.slice(0, 3).map((d) => (
              <div key={d.id} className="px-3.5 py-2.5 flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning text-[10px] font-bold uppercase">
                  {d.name.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{d.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{d.phone ?? "—"}</div>
                </div>
                <div className="max-w-[128px] truncate text-right font-mono font-semibold text-warning text-xs sm:text-sm">{fmtMoney(d.balance)}</div>
              </div>
            ))}
          </div>
          <button onClick={() => onJump("debtors")} className="w-full border-t px-3.5 py-2.5 text-xs font-medium text-warning hover:bg-warning/5 transition-colors flex items-center justify-center gap-1">
            Barcha qarzdorlar <ChevronRight className="h-3 w-3" />
          </button>
        </SectionCard>
      )}

      {totals.count === 0 && totalDebt === 0 && (
        <SectionCard title="Bu davr bo'sh" icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}>
          <Empty label="Tanlangan davrda hali ma'lumotlar yo'q" />
        </SectionCard>
      )}
    </div>
  );
}
