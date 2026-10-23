import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FileDown, Trash2, Pencil, AlertCircle, ShoppingCart, Wallet, Phone, MessageSquare, ExternalLink, TrendingUp, TrendingDown, Package, Receipt, Sparkles, Send } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtDate, newIdempotencyKey, getProductUnit } from "@/lib/format";
import { cn } from "@/lib/utils";
import { generateAkt, type AktRow } from "@/lib/pdf-akt";
import { enqueueDebtPayment, applyLocalOptimisticDebtPayment } from "@/lib/offline-store";
import { dispatchNasiyaPaymentNotification } from "@/lib/nasiya-notify";
import { CustomerTelegramLinkDialog } from "@/components/customers/CustomerTelegramLinkDialog";
import {
  getCustomerTelegramLink,
  formatPaymentReceiptMessage,
  enqueueAndSendTelegramMessage,
  loadTelegramSettings,
  type CustomerTelegramLink,
} from "@/lib/telegram-service";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_app/customers/$id")({ component: CustomerDetail });

function CustomerDetail() {
  const { id } = useParams({ from: "/_app/customers/$id" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isSuperAdmin } = useAuth();

  useEffect(() => {
    const ch = supabase
      .channel(`customer-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales", filter: `customer_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["customer-sales", id] });
        qc.invalidateQueries({ queryKey: ["customer", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `customer_id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["customer-payments-all", id] });
        qc.invalidateQueries({ queryKey: ["customer", id] });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "customers", filter: `id=eq.${id}` }, () => {
        qc.invalidateQueries({ queryKey: ["customer", id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, qc]);

  const [editPay, setEditPay] = useState<{ id: string; amount: string; note: string } | null>(null);
  const [deletePayId, setDeletePayId] = useState<string | null>(null);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const [editCustomer, setEditCustomer] = useState<{ name: string; phone: string; balance: string } | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "click">("cash");
  const [payNote, setPayNote] = useState("");
  const [payIdemKey, setPayIdemKey] = useState<string>("");
  const [tgDialogOpen, setTgDialogOpen] = useState(false);
  const [tgLinkInfo, setTgLinkInfo] = useState<CustomerTelegramLink | null>(null);

  const loadTgStatus = async () => {
    if (!id) return;
    try {
      const info = await getCustomerTelegramLink(id);
      setTgLinkInfo(info);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadTgStatus();
  }, [id]);

  const { data: customer } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => (await supabase.from("customers").select("*").eq("id", id).maybeSingle()).data,
  });

  const updateCustomer = useMutation({
    mutationFn: async () => {
      if (!editCustomer) return;
      const trimmed = editCustomer.name.trim();
      if (!trimmed) throw new Error("Ism bo'sh bo'lmasligi kerak");
      const payload: { name: string; phone: string | null; balance?: number; opening_balance?: number } = {
        name: trimmed,
        phone: editCustomer.phone.trim() || null,
      };
      if (isSuperAdmin) {
        const bal = Number(editCustomer.balance);
        if (!Number.isFinite(bal)) throw new Error("Balans noto'g'ri");
        payload.balance = bal;
        payload.opening_balance = bal;
      }
      const { error } = await supabase.from("customers").update(payload).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Mijoz yangilandi"); setEditCustomer(null); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeCustomer = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.rpc("delete_customer", { _customer_id: id, _user_id: user!.id } as never);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (result) => {
      toast.success(result === "deleted" ? "Mijoz butunlay o'chirildi" : "Mijoz arxivlandi (tarixi saqlandi)");
      qc.invalidateQueries({ queryKey: ["customers"] });
      navigate({ to: "/customers" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: sales } = useQuery({
    queryKey: ["customer-sales", id],
    queryFn: async () => (await supabase.from("sales").select("id,total_sale,amount_paid,remaining_debt,payment_method,status,created_at,sale_items(quantity,total_price,product_id,products(name))").eq("customer_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  const { data: payments } = useQuery({
    queryKey: ["customer-payments-all", id],
    queryFn: async () => (await supabase.from("payments").select("id,amount,method,note,sale_id,created_at").eq("customer_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  const updatePay = useMutation({
    mutationFn: async () => {
      if (!editPay) return;
      const { error } = await supabase.from("payments").update({ amount: Number(editPay.amount), note: editPay.note || null }).eq("id", editPay.id);
      if (error) throw error;
      // Always recompute the customer's authoritative balance after manual edits
      await supabase.rpc("recalc_customer_balance" as never, { _customer_id: id } as never);
    },
    onSuccess: () => { toast.success("To'lov yangilandi"); setEditPay(null); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePay = useMutation({
    mutationFn: async (pid: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.rpc("delete_payment", { _payment_id: pid, _user_id: user!.id } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("O'chirildi, qarz qoldig'i qayta hisoblandi"); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rollbackSale = useMutation({
    mutationFn: async (sid: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.rpc("rollback_sale", { _sale_id: sid, _user_id: user!.id } as never);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Sotuv bekor qilindi"); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const pay = useMutation({
    mutationFn: async () => {
      const amt = Number(payAmount);
      if (!(amt > 0)) throw new Error("Summa to'g'ri kiritilmagan");
      const { data: { user } } = await supabase.auth.getUser();

      // Offline handling
      if (!navigator.onLine) {
        await enqueueDebtPayment({
          id: payIdemKey,
          created_at: Date.now(),
          payload: {
            _customer_id: id,
            _amount: amt,
            _method: payMethod as "cash" | "click",
            _note: payNote || null,
            _user_id: user?.id || "offline-user",
            _idempotency_key: payIdemKey,
          },
          status: "pending",
          attempts: 0,
        });
        await applyLocalOptimisticDebtPayment(id, amt);
        return { offline: true, amt };
      }

      const { error } = await supabase.rpc("process_debt_payment", {
        _customer_id: id,
        _amount: amt,
        _method: payMethod,
        _note: payNote || null,
        _user_id: user!.id,
        _idempotency_key: payIdemKey,
      } as never);
      if (error) throw error;
      return { offline: false, amt };
    },
    onSuccess: (res) => {
      if (res?.offline) {
        toast.success("Oflayn to'lov saqlandi", { description: "Internet kelganda avtomatik serverga yuboriladi" });
      } else {
        toast.success("To'lov qabul qilindi");
      }

      // Avtomatik Nasiya To'lov Kvitansiyasi (Telegram Bot v2 & Zaxira SMS)
      if (customer) {
        const curBal = Number(customer.balance || 0);
        const amt = Number(payAmount);
        const finalDebt = Math.max(0, curBal - amt);

        void (async () => {
          let directSent = false;
          try {
            const link = await getCustomerTelegramLink(id);
            if (link.linkStatus === "linked" && link.telegramChatId) {
              const paymentText = formatPaymentReceiptMessage({
                paymentNumber: payIdemKey.slice(0, 8),
                date: new Date(),
                paymentMethod: payMethod === "cash" ? "Naqd" : "Click",
                paymentAmount: amt,
                previousBalance: curBal,
                currentBalance: finalDebt,
              });

              await enqueueAndSendTelegramMessage({
                customerId: id,
                customerName: customer.name,
                paymentId: payIdemKey,
                eventType: "payment",
                telegramChatId: link.telegramChatId,
                formattedText: paymentText,
                idempotencyKey: `pay-${payIdemKey}`,
              });
              directSent = true;
            }
          } catch (tgErr) {
            console.warn("Telegram payment receipt dispatch error:", tgErr);
          }

          if (!directSent) {
            void dispatchNasiyaPaymentNotification({
              shopName: loadTelegramSettings().businessName || "SavdoPro",
              customerName: customer.name,
              customerPhone: (customer as unknown as { phone?: string })?.phone,
              paymentNo: payIdemKey,
              amountPaid: amt,
              previousDebt: curBal,
              debtCleared: amt,
              finalDebt,
              paymentMethod: payMethod === "cash" ? "Naqd" : "Click",
              note: payNote || undefined,
            });
          }
        })();
      }

      setPayOpen(false); setPayAmount(""); setPayNote("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportAkt = () => {
    if (!customer) return;
    const events: { date: string; type: "sale" | "payment"; description: string; debit: number; credit: number }[] = [];
    (sales ?? []).filter((s) => s.status === "completed").forEach((s) => {
      events.push({ date: s.created_at, type: "sale", description: `Sotuv #${s.id.slice(0, 8)} (${s.payment_method ?? "—"})`, debit: Number(s.total_sale), credit: Number(s.amount_paid) });
    });
    (payments ?? []).filter((p) => !p.sale_id).forEach((p) => {
      events.push({ date: p.created_at, type: "payment", description: `Qarz to'lov (${p.method})${p.note ? " — " + p.note : ""}`, debit: 0, credit: Number(p.amount) });
    });
    events.sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    const rows: AktRow[] = events.map((e) => {
      bal += e.debit - e.credit;
      return { date: e.date, type: e.type, description: e.description, debit: e.debit, credit: e.credit, balance: bal };
    });
    generateAkt({
      shopName: loadTelegramSettings().businessName || "SavdoPro",
      customerName: customer.name,
      customerPhone: customer.phone,
      rows,
      finalBalance: Number(customer.balance),
    });
  };

  if (!customer) return <div className="p-4 lg:p-6 text-muted-foreground">Yuklanmoqda...</div>;

  const tel = (customer.phone ?? "").replace(/[^+\d]/g, "");
  const bal = Number(customer.balance);
  const completedSales = (sales ?? []).filter((s) => s.status === "completed");
  const totalPurchased = completedSales.reduce((sum, s) => sum + Number(s.total_sale ?? 0), 0);
  const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
  const opening = Number(customer.opening_balance ?? 0);
  const computedBalance = opening + totalPurchased - totalPaid;
  const initials = customer.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || customer.name.slice(0, 2).toUpperCase();

  return (
    <>
      <PageHeader
        title={customer.name}
        description={
          customer.phone ? (
            <span className="inline-flex items-center gap-2">
              <span>{customer.phone}</span>
              {tel && (
                <>
                  <a href={`tel:${tel}`} aria-label="Qo'ng'iroq" className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-card hover:bg-accent transition-colors">
                    <Phone className="h-3.5 w-3.5 text-success" />
                  </a>
                  <a href={`sms:${tel}`} aria-label="SMS yuborish" className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-card hover:bg-accent transition-colors">
                    <MessageSquare className="h-3.5 w-3.5 text-primary" />
                  </a>
                </>
              )}
            </span>
          ) : "Telefon kiritilmagan"
        }
        action={
          <div className="hidden sm:flex items-center gap-2">
            <Button variant="outline" size="sm" asChild><Link to="/customers"><ArrowLeft className="h-3.5 w-3.5" /> Orqaga</Link></Button>
            <Button size="sm" onClick={exportAkt}><FileDown className="h-3.5 w-3.5" /> Akt-sverka PDF</Button>
          </div>
        }
      />
      <div className="p-3 lg:p-6 space-y-4 max-w-3xl mx-auto w-full">
        {/* Premium hero card */}
        <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-elegant)]">
          <div className="absolute inset-0 opacity-60 pointer-events-none" style={{ background: "radial-gradient(ellipse 80% 50% at 50% -10%, oklch(0.65 0.22 255 / 0.18), transparent 60%)" }} />
          <div className="relative p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <div className="absolute inset-0 rounded-full blur-md opacity-50" style={{ background: "var(--gradient-primary)" }} />
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold tracking-wide text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>
                  {initials}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{customer.name}</h2>
                  <Sparkles className="h-4 w-4 text-primary/70 shrink-0" />
                </div>
                {customer.phone && (
                  <div className="mt-1 text-sm text-muted-foreground inline-flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" />{customer.phone}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {customer.phone && tel && (
                    <>
                      <a href={`tel:${tel}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 backdrop-blur px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors">
                        <Phone className="h-3 w-3 text-success" /> Qo'ng'iroq
                      </a>
                      <a href={`sms:${tel}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/40 backdrop-blur px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors">
                        <MessageSquare className="h-3 w-3 text-primary" /> SMS
                      </a>
                    </>
                  )}
                  {tgLinkInfo?.linkStatus === "linked" ? (
                    <Badge
                      className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border-emerald-500/30 cursor-pointer gap-1.5 py-1 px-2.5 transition-colors"
                      onClick={() => setTgDialogOpen(true)}
                    >
                      <Send className="h-3 w-3" /> Telegram: Ulangan
                    </Badge>
                  ) : tgLinkInfo?.linkStatus === "pending" ? (
                    <Badge
                      className="bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border-amber-500/30 cursor-pointer gap-1.5 py-1 px-2.5 transition-colors"
                      onClick={() => setTgDialogOpen(true)}
                    >
                      <Send className="h-3 w-3" /> Telegram: Kutilmoqda
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5 border-sky-500/40 text-sky-400 hover:bg-sky-500/10"
                      onClick={() => setTgDialogOpen(true)}
                    >
                      <Send className="h-3 w-3" /> Telegramni ulash
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Big balance row */}
            <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{bal > 0 ? "Joriy qarz" : bal < 0 ? "Oldindan to'langan" : "Balans"}</div>
                <div className={cn("mt-1 text-3xl sm:text-4xl font-bold font-mono tracking-tight", bal > 0 ? "text-warning" : bal < 0 ? "text-success" : "text-foreground")}>{fmtMoney(Math.abs(bal))}</div>
              </div>
              <Button size="lg" onClick={() => { setPayAmount(bal > 0 ? String(bal) : ""); setPayMethod("cash"); setPayNote(""); setPayIdemKey(newIdempotencyKey()); setPayOpen(true); }} className="shadow-lg shadow-primary/20">
                <Wallet className="h-4 w-4" /> To'lov qabul qilish
              </Button>
            </div>

            {/* Mini stats */}
            <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3 pt-4 border-t border-border/50">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><ShoppingCart className="h-3 w-3" /> Xaridlar</div>
                <div className="mt-0.5 text-sm sm:text-base font-semibold tabular-nums">{completedSales.length}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Jami olgan</div>
                <div className="mt-0.5 text-sm sm:text-base font-semibold font-mono tabular-nums truncate">{fmtMoney(totalPurchased)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Jami to'lagan</div>
                <div className="mt-0.5 text-sm sm:text-base font-semibold font-mono tabular-nums text-success truncate">{fmtMoney(totalPaid)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Action row */}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" onClick={exportAkt}><FileDown className="h-3.5 w-3.5" /> Akt PDF</Button>
          <Button variant="outline" size="sm" onClick={() => setEditCustomer({ name: customer.name, phone: customer.phone ?? "", balance: String(customer.balance) })}><Pencil className="h-3.5 w-3.5" /> Tahrirlash</Button>
          {isSuperAdmin ? (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setRemoveOpen(true)}><Trash2 className="h-3.5 w-3.5" /> O'chirish</Button>
          ) : (
            <Button variant="outline" size="sm" asChild><Link to="/customers"><ArrowLeft className="h-3.5 w-3.5" /> Orqaga</Link></Button>
          )}
        </div>

        {/* Balance breakdown */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Balans hisoboti</div>
            <span className="text-[10px] text-muted-foreground">Ochilish + Sotuv − To'lov</span>
          </div>
          <div className="divide-y">
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="text-sm text-muted-foreground inline-flex items-center gap-2"><Wallet className="h-3.5 w-3.5" /> Ochilish qarzi</div>
              <div className={cn("text-sm font-mono font-semibold tabular-nums", opening > 0 ? "text-warning" : opening < 0 ? "text-success" : "")}>{fmtMoney(opening)}</div>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="text-sm text-muted-foreground inline-flex items-center gap-2"><ShoppingCart className="h-3.5 w-3.5" /> Jami sotuvlar <span className="text-[10px] text-muted-foreground">({completedSales.length} ta)</span></div>
              <div className="text-sm font-mono font-semibold tabular-nums">+ {fmtMoney(totalPurchased)}</div>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <div className="text-sm text-muted-foreground inline-flex items-center gap-2"><TrendingDown className="h-3.5 w-3.5" /> Jami to'lovlar <span className="text-[10px] text-muted-foreground">({(payments ?? []).length} ta)</span></div>
              <div className="text-sm font-mono font-semibold tabular-nums text-success">− {fmtMoney(totalPaid)}</div>
            </div>
            <div className="flex items-center justify-between px-4 py-3 bg-muted/20">
              <div className="text-sm font-semibold">{computedBalance > 0 ? "Joriy qarz" : computedBalance < 0 ? "Oldindan to'langan" : "Balans"}</div>
              <div className={cn("text-base font-mono font-bold tabular-nums", computedBalance > 0 ? "text-warning" : computedBalance < 0 ? "text-success" : "")}>{fmtMoney(Math.abs(computedBalance))}</div>
            </div>
            {Math.abs(computedBalance - bal) > 0.01 && (
              <div className="px-4 py-2 text-[11px] text-warning bg-warning/10 inline-flex items-center gap-1.5"><AlertCircle className="h-3 w-3" /> Saqlangan balans ({fmtMoney(bal)}) hisoblangandan farq qiladi. Qayta hisoblash kerak.</div>
            )}
          </div>
        </div>

        {/* Sales list — premium itemized cards */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1.5"><ShoppingCart className="h-3.5 w-3.5 text-primary" /> Xaridlar tarixi</div>
            <span className="text-[10px] text-muted-foreground tabular-nums">{sales?.length ?? 0} ta</span>
          </div>
          <div className="space-y-2">
            {(sales ?? []).map((s) => {
              const items = ((s as unknown as { sale_items?: { quantity: number; total_price: number; products: { name: string } | null }[] }).sale_items) ?? [];
              const totalQty = items.reduce((sum, it) => sum + Number(it.quantity), 0);
              const isRolled = s.status === "rolled_back";
              return (
                <div key={s.id} className={cn("rounded-xl border bg-card overflow-hidden transition-all hover:border-primary/40", isRolled && "opacity-60")}>
                  {/* Card header */}
                  <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-muted/30 border-b">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Receipt className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{fmtDate(s.created_at)}</div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 flex-wrap">
                          <span>{s.payment_method ?? "—"}</span>
                          <span>·</span>
                          <span>{items.length} mahsulot · {totalQty} dona</span>
                          {Number(s.remaining_debt) > 0 && <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[9px] text-warning">qarz {fmtMoney(s.remaining_debt)}</span>}
                          {isRolled && <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[9px] text-destructive">bekor</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-7 w-7" asChild><Link to="/sales/$id" params={{ id: s.id }}><ExternalLink className="h-3.5 w-3.5" /></Link></Button>
                      {isSuperAdmin && s.status === "completed" && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setRollbackId(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      )}
                    </div>
                  </div>
                  {/* Items */}
                  {items.length > 0 ? (
                    <div className="divide-y">
                      {items.map((it, idx) => (
                        <div key={idx} className="flex items-center gap-3 px-3.5 py-2">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <Package className="h-3.5 w-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{it.products?.name ?? "—"}</div>
                            <div className="text-[11px] text-muted-foreground tabular-nums">× {Number(it.quantity)} {getProductUnit(it.products?.name)}</div>
                          </div>
                          <div className="text-sm font-mono font-semibold shrink-0 tabular-nums">{fmtMoney(it.total_price)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3.5 py-2 text-[11px] text-muted-foreground italic">Mahsulot ma'lumoti yo'q</div>
                  )}
                  {/* Total footer */}
                  <div className="flex items-center justify-between px-3.5 py-2.5 bg-muted/20 border-t">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Jami</span>
                    <span className={cn("text-base font-mono font-bold tabular-nums", isRolled && "line-through")}>{fmtMoney(s.total_sale)}</span>
                  </div>
                </div>
              );
            })}
            {(sales ?? []).length === 0 && <div className="rounded-xl border bg-card p-8 text-center text-xs text-muted-foreground">Xaridlar yo'q</div>}
          </div>
        </div>

        {/* Payments list */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5 text-success" /> To'lovlar tarixi</div>
            <span className="text-[10px] text-muted-foreground tabular-nums">{payments?.length ?? 0} ta</span>
          </div>
          <div className="rounded-xl border bg-card divide-y overflow-hidden">
            {(payments ?? []).map((p) => (
              <div key={p.id} className="p-3 flex items-center gap-3">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", p.sale_id ? "bg-muted text-muted-foreground" : "bg-success/15 text-success")}>
                  <Wallet className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                    <span>{fmtDate(p.created_at)}</span>
                    <span>·</span>
                    <span className="uppercase">{p.method}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[9px] uppercase", p.sale_id ? "bg-muted text-muted-foreground" : "bg-success/15 text-success")}>{p.sale_id ? "sotuvga" : "qarzga"}</span>
                  </div>
                  <div className="text-base font-mono font-bold tabular-nums text-success">+{fmtMoney(p.amount)}</div>
                  {p.note && <div className="text-[11px] text-muted-foreground truncate">{p.note}</div>}
                </div>
                {isSuperAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditPay({ id: p.id, amount: String(p.amount), note: p.note ?? "" })}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeletePayId(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                )}
              </div>
            ))}
            {(payments ?? []).length === 0 && <div className="p-8 text-center text-xs text-muted-foreground">To'lovlar yo'q</div>}
          </div>
        </div>
      </div>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>To'lov — {customer.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className={cn("rounded-md border p-2.5 text-sm flex justify-between", bal > 0 ? "bg-warning/10 border-warning/30" : "bg-success/10 border-success/30")}>
              <span className="text-muted-foreground">{bal > 0 ? "Joriy qarz" : bal < 0 ? "Oldindan to'langan" : "Balans"}</span>
              <span className={cn("font-mono font-semibold", bal > 0 ? "text-warning" : "text-success")}>{fmtMoney(Math.abs(bal))}</span>
            </div>
            {Number(payAmount) > 0 && (
              <div className="rounded-md border bg-muted/30 p-2.5 text-xs flex justify-between">
                <span className="text-muted-foreground">To'lovdan keyin</span>
                <span className="font-mono font-semibold">
                  {(() => { const after = bal - Number(payAmount || 0); return after > 0 ? `Qarz: ${fmtMoney(after)}` : after < 0 ? `Oldindan: ${fmtMoney(-after)}` : "0"; })()}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Summa *</Label><Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Usul</Label>
                <Select value={payMethod} onValueChange={(v) => setPayMethod(v as "cash" | "click")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="cash">Naqd</SelectItem><SelectItem value="click">Click</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Izoh</Label><Input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Ixtiyoriy" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Bekor</Button>
            <Button onClick={() => pay.mutate()} disabled={pay.isPending || !payAmount}>To'lovni qabul qilish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPay} onOpenChange={(v) => !v && setEditPay(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>To'lovni tahrirlash</DialogTitle></DialogHeader>
          {editPay && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/50 border p-2.5 text-xs text-muted-foreground">
                Saqlangach mijoz qarz qoldig'i avtomatik qayta hisoblanadi.
              </div>
              <div className="space-y-1.5"><Label>Summa</Label><Input type="number" value={editPay.amount} onChange={(e) => setEditPay({ ...editPay, amount: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Izoh</Label><Input value={editPay.note} onChange={(e) => setEditPay({ ...editPay, note: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPay(null)}>Bekor</Button>
            <Button onClick={() => updatePay.mutate()} disabled={updatePay.isPending}>Saqlash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePayId} onOpenChange={(v) => !v && setDeletePayId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>To'lovni o'chirish?</AlertDialogTitle>
            <AlertDialogDescription>To'lov yozuvi bazadan o'chiriladi va mijoz qarz qoldig'i avtomatik qayta hisoblanadi.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (deletePayId) deletePay.mutate(deletePayId); setDeletePayId(null); }}>O'chirish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!rollbackId} onOpenChange={(v) => !v && setRollbackId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sotuvni bekor qilish?</AlertDialogTitle>
            <AlertDialogDescription>Sotuv bekor qilinadi, mahsulotlar sklatga qaytariladi va mijoz qarzi to'g'rilanadi.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Yo'q</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (rollbackId) rollbackSale.mutate(rollbackId); setRollbackId(null); }}>Ha, bekor qil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editCustomer} onOpenChange={(v) => !v && setEditCustomer(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mijozni tahrirlash</DialogTitle></DialogHeader>
          {editCustomer && (
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Ism *</Label><Input value={editCustomer.name} onChange={(e) => setEditCustomer({ ...editCustomer, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Telefon</Label><Input value={editCustomer.phone} onChange={(e) => setEditCustomer({ ...editCustomer, phone: e.target.value })} placeholder="+998..." /></div>
              {isSuperAdmin && (
                <div className="space-y-1.5">
                  <Label>Joriy qarz balansi</Label>
                  <Input type="number" value={editCustomer.balance} onChange={(e) => setEditCustomer({ ...editCustomer, balance: e.target.value })} />
                  <p className="text-[11px] text-muted-foreground">Diqqat: balansni qo'lda o'zgartirish boshlang'ich qoldiqni ham yangilaydi.</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCustomer(null)}>Bekor</Button>
            <Button onClick={() => updateCustomer.mutate()} disabled={updateCustomer.isPending}>Saqlash</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mijozni o'chirish?</AlertDialogTitle>
            <AlertDialogDescription>Agar mijozda sotuv yoki to'lov tarixi bo'lsa — arxivlanadi (tarix saqlanadi). Aks holda butunlay o'chiriladi.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { setRemoveOpen(false); removeCustomer.mutate(); }}>O'chirish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CustomerTelegramLinkDialog
        open={tgDialogOpen}
        onOpenChange={setTgDialogOpen}
        customer={customer}
        onLinkUpdated={() => {
          void loadTgStatus();
          qc.invalidateQueries({ queryKey: ["customer", id] });
        }}
      />

      <div className="text-center text-[11px] text-muted-foreground/40 pt-4 pb-8 select-none pointer-events-none">
        Dasturchi: MuzaffarZed
      </div>
    </>
  );
}