import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Send,
  Bot,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCw,
  Search,
  Filter,
  Eye,
  ShieldCheck,
  QrCode,
  Unlink,
  MessageSquare,
  Sparkles,
  Phone,
} from "lucide-react";
import { toast } from "sonner";
import { fmtDate, fmtMoney } from "@/lib/format";
import {
  loadTelegramSettings,
  saveTelegramSettings,
  loadLocalOutbox,
  saveLocalOutbox,
  resendTelegramMessage,
  sendTelegramDirectMessage,
  formatSaleReceiptMessage,
  formatPaymentReceiptMessage,
  getCustomerTelegramLink,
  disconnectCustomerTelegram,
  type TelegramBotSettings,
  type TelegramOutboxMessage,
  type CustomerTelegramLink,
} from "@/lib/telegram-service";
import { CustomerTelegramLinkDialog } from "@/components/customers/CustomerTelegramLinkDialog";

export const Route = createFileRoute("/_app/telegram-notifications")({
  component: TelegramNotificationsPage,
});

function TelegramNotificationsPage() {
  const { isSuperAdmin } = useAuth();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<"logs" | "customers" | "templates">("logs");
  const [settings, setSettings] = useState<TelegramBotSettings>(loadTelegramSettings);
  const [outboxList, setOutboxList] = useState<TelegramOutboxMessage[]>(loadLocalOutbox);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"all" | "sale" | "payment" | "test">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "sent" | "pending" | "failed">("all");

  // Selected message detail modal
  const [selectedMsg, setSelectedMsg] = useState<TelegramOutboxMessage | null>(null);

  // Link dialog state
  const [linkCustomer, setLinkCustomer] = useState<{ id: string; name: string; phone?: string | null } | null>(null);

  // Test message state
  const [testChatId, setTestChatId] = useState("");
  const [testSending, setTestSending] = useState(false);

  // Load customers
  const { data: customers = [] } = useQuery({
    queryKey: ["customers-telegram-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone, balance, credit_limit")
        .is("deleted_at", null)
        .order("name");
      return (data || []) as Array<{
        id: string;
        name: string;
        phone: string | null;
        balance: number;
        credit_limit: number;
      }>;
    },
  });

  // Calculate stats
  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayMsgs = outboxList.filter((m) => m.createdAt.slice(0, 10) === todayStr);

    const todaySales = todayMsgs.filter((m) => m.eventType === "sale").length;
    const todayPayments = todayMsgs.filter((m) => m.eventType === "payment").length;

    const sentCount = outboxList.filter((m) => m.status === "sent").length;
    const pendingCount = outboxList.filter((m) => m.status === "pending").length;
    const failedCount = outboxList.filter((m) => m.status === "failed").length;

    return {
      todaySales,
      todayPayments,
      sentCount,
      pendingCount,
      failedCount,
      isConfigured: !!settings.botToken && settings.botToken.length > 10,
    };
  }, [outboxList, settings]);

  // Filtered messages
  const filteredMessages = useMemo(() => {
    return outboxList.filter((m) => {
      if (filterType !== "all" && m.eventType !== filterType) return false;
      if (filterStatus !== "all" && m.status !== filterStatus) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesCust = m.customerName?.toLowerCase().includes(q);
        const matchesChat = String(m.telegramChatId).includes(q);
        const matchesId = m.id.toLowerCase().includes(q);
        const matchesText = m.formattedText.toLowerCase().includes(q);
        if (!matchesCust && !matchesChat && !matchesId && !matchesText) return false;
      }
      return true;
    });
  }, [outboxList, filterType, filterStatus, searchTerm]);

  // Save settings handler
  const handleSaveSettings = () => {
    const saved = saveTelegramSettings(settings);
    setSettings(saved);
    toast.success("Telegram sozlamalari saqlandi");
  };

  // Test ping handler
  const handleSendTestMessage = async () => {
    if (!settings.botToken) {
      toast.error("Bot tokeni kiritilmagan");
      return;
    }
    const cid = Number(testChatId.trim());
    if (!cid || isNaN(cid)) {
      toast.error("Yaroqli Telegram Chat ID kiriting (masalan: 123456789)");
      return;
    }

    setTestSending(true);
    const testText = [
      `🤖 <b>${settings.businessName.toUpperCase()} — TELEGRAM BOT TEST</b>`,
      ``,
      `✅ Integratsiya muvaffaqiyatli ishlamoqda!`,
      `📅 Sana: ${fmtDate(new Date())}`,
      ``,
      `Ushbu bot orqali mijozlaringizga xarid va to'lov cheklari xavfsiz jo'natiladi.`,
      `Dasturchi: MuzaffarZed`,
    ].join("\n");

    try {
      const res = await sendTelegramDirectMessage(settings.botToken, cid, testText);
      if (res.ok) {
        toast.success("Sinov xabari muvaffaqiyatli yetkazildi! ✓");
        // Log to outbox
        const newMsg: TelegramOutboxMessage = {
          id: `TEST-${Date.now()}`,
          eventType: "test",
          telegramChatId: cid,
          status: "sent",
          formattedText: testText,
          attemptCount: 1,
          createdAt: new Date().toISOString(),
          sentAt: new Date().toISOString(),
          idempotencyKey: `test-${Date.now()}`,
        };
        const updated = [newMsg, ...outboxList];
        setOutboxList(updated);
        saveLocalOutbox(updated);
      } else {
        toast.error("Xabar yetkazilmadi", { description: res.error });
      }
    } catch (err: unknown) {
      toast.error("Xatolik", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setTestSending(false);
    }
  };

  // Resend handler
  const handleResend = async (msgId: string) => {
    const res = await resendTelegramMessage(msgId);
    if (res.ok) {
      toast.success("Xabar qayta yuborildi! ✓");
      setOutboxList(loadLocalOutbox());
    } else {
      toast.error("Qayta yuborishda xatolik", { description: res.error });
    }
  };

  // Live sample previews
  const sampleSaleText = useMemo(() => {
    return formatSaleReceiptMessage(
      {
        saleNumber: "CHK-00892",
        date: new Date(),
        items: [
          { name: "Aprel 900g (qopda)", quantity: 2, unitPrice: 139000, lineTotal: 278000 },
          { name: "Tuxum D1 (katta)", quantity: 3, unitPrice: 43000, lineTotal: 129000 },
          { name: "Salafan 5kg", quantity: 5, unitPrice: 9000, lineTotal: 45000 },
        ],
        saleTotal: 452000,
        salePaid: 200000,
        saleDebt: 252000,
        previousBalance: 500000,
        newDebt: 252000,
        currentBalance: 752000,
        paymentMethod: "Naqd",
      },
      settings.businessName
    );
  }, [settings.businessName]);

  const samplePaymentText = useMemo(() => {
    return formatPaymentReceiptMessage(
      {
        paymentNumber: "PAY-00341",
        date: new Date(),
        paymentMethod: "Click",
        paymentAmount: 752000,
        previousBalance: 752000,
        currentBalance: 0,
      },
      settings.businessName
    );
  }, [settings.businessName]);

  return (
    <div className="flex-1 space-y-4 p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Telegram xabarnomalari"
        description="Mijozlar bilan avtomatik xarid cheklari, qarz hisob-kitoblari va shaxsiy bot boshqaruvi"
      />

      {/* 4 ta Asosiy KPI Kartasi */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. Bot Holati */}
        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Bot holati</span>
            <Bot className="h-4 w-4 text-sky-400" />
          </div>
          <div className="flex items-center gap-2">
            {stats.isConfigured ? (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Faol (@{settings.botUsername.replace("@", "")})
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-rose-400">
                <span className="h-2 w-2 rounded-full bg-rose-400" />
                Sozlanmagan
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {stats.isConfigured ? "Cheklar avto-yuborilmoqda" : "BotFather tokenini kiriting"}
          </div>
        </div>

        {/* 2. Ulangan Mijozlar */}
        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Mijozlar bazasi</span>
            <Users className="h-4 w-4 text-sky-400" />
          </div>
          <div className="text-xl font-bold font-mono text-foreground">
            {customers.length} <span className="text-xs font-normal text-muted-foreground">ta do'kon</span>
          </div>
          <div className="text-[11px] text-emerald-400 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" /> QR-kod orqali 1-bosishda ulanadi
          </div>
        </div>

        {/* 3. Bugungi Cheklar */}
        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Bugungi cheklar</span>
            <Send className="h-4 w-4 text-sky-400" />
          </div>
          <div className="flex items-baseline gap-2 font-mono">
            <span className="text-lg font-bold text-foreground">{stats.todaySales}</span>
            <span className="text-[11px] text-muted-foreground">savdo</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-lg font-bold text-emerald-400">{stats.todayPayments}</span>
            <span className="text-[11px] text-muted-foreground">to'lov</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Jami: {stats.todaySales + stats.todayPayments} ta elektron chek
          </div>
        </div>

        {/* 4. Xabarlar Oqimi (Outbox) */}
        <div className="rounded-xl border border-border/70 bg-card p-3.5 space-y-1.5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Xabarlar holati</span>
            <CheckCircle2 className="h-4 w-4 text-sky-400" />
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 px-1.5 py-0">
              ✓ {stats.sentCount}
            </Badge>
            <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 px-1.5 py-0">
              ⏳ {stats.pendingCount}
            </Badge>
            <Badge variant="outline" className="border-rose-500/30 text-rose-400 bg-rose-500/10 px-1.5 py-0">
              ✕ {stats.failedCount}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {stats.failedCount > 0 ? "Xatoliklar qayta yuborilishi mumkin" : "Barcha xabarlar yetkazilgan"}
          </div>
        </div>
      </div>

      {/* Tabs Menu */}
      <div className="flex items-center gap-1.5 border-b border-border/60 pb-2">
        <Button
          variant={activeTab === "logs" ? "default" : "ghost"}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setActiveTab("logs")}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Xabarlar jurnali ({outboxList.length})
        </Button>
        <Button
          variant={activeTab === "customers" ? "default" : "ghost"}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setActiveTab("customers")}
        >
          <Users className="h-3.5 w-3.5" />
          Mijozlarni ulash ({customers.length})
        </Button>
        <Button
          variant={activeTab === "templates" ? "default" : "ghost"}
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => setActiveTab("templates")}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Shablonlar va Sinov
        </Button>
      </div>

      {/* TAB 1: XABARLAR JURNALI (AUDIT LOG & OUTBOX) */}
      {activeTab === "logs" && (
        <div className="space-y-3">
          {/* Filtrlash paneli */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-card p-2.5 rounded-xl border border-border/70">
            <div className="sm:col-span-2 relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Mijoz, chek raqami yoki xabar matnini qidirish..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            <div>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as never)}
                className="w-full h-8 text-xs rounded-md border border-input bg-background px-2.5 text-foreground focus:outline-none"
              >
                <option value="all">Barcha turlar</option>
                <option value="sale">Savdo cheki</option>
                <option value="payment">To'lov cheki</option>
                <option value="test">Sinov xabari</option>
              </select>
            </div>
            <div>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as never)}
                className="w-full h-8 text-xs rounded-md border border-input bg-background px-2.5 text-foreground focus:outline-none"
              >
                <option value="all">Barcha holatlar</option>
                <option value="sent">Yetkazilgan (Sent)</option>
                <option value="pending">Navbatda (Pending)</option>
                <option value="failed">Xatolik (Failed)</option>
              </select>
            </div>
          </div>

          {/* Xabarlar jadvali */}
          <div className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-36 text-xs">Vaqt</TableHead>
                  <TableHead className="text-xs">Mijoz / Chat ID</TableHead>
                  <TableHead className="w-28 text-xs">Turi</TableHead>
                  <TableHead className="w-28 text-xs">Holat</TableHead>
                  <TableHead className="w-20 text-xs text-center">Urinish</TableHead>
                  <TableHead className="w-32 text-xs text-right">Amallar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMessages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-xs">
                      Xabarlar topilmadi. Savdo yakunlanganda yoki to'lov qilinganda cheklar shu yerda aks etadi.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMessages.map((msg) => (
                    <TableRow key={msg.id} className="text-xs hover:bg-muted/20">
                      <TableCell className="font-mono text-muted-foreground">
                        {fmtDate(new Date(msg.createdAt))}
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-foreground">{msg.customerName || "Do'kon mijoz"}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">Chat ID: {msg.telegramChatId}</div>
                      </TableCell>
                      <TableCell>
                        {msg.eventType === "sale" ? (
                          <Badge variant="outline" className="border-sky-500/30 text-sky-400 bg-sky-500/10 text-[10px]">
                            Savdo cheki
                          </Badge>
                        ) : msg.eventType === "payment" ? (
                          <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px]">
                            To'lov cheki
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-purple-500/30 text-purple-400 bg-purple-500/10 text-[10px]">
                            Sinov pingi
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {msg.status === "sent" ? (
                          <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Yetkazildi
                          </Badge>
                        ) : msg.status === "failed" ? (
                          <Badge variant="destructive" className="text-[10px] gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-white" /> Xatolik
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10 text-[10px] gap-1">
                            <Clock className="h-3 w-3" /> Navbatda
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono">{msg.attemptCount}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => setSelectedMsg(msg)}
                            title="Xabar matnini ko'rish"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-sky-400 hover:bg-sky-500/10"
                            onClick={() => handleResend(msg.id)}
                            title="Qayta yuborish"
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* TAB 2: MIJOZLARNI TELEGRAMGA ULASH */}
      {activeTab === "customers" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border/70 bg-card p-3 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <span>
                Har bir mijoz uchun <b>bir martalik maxfiy QR-kod va havola</b> yaratiladi. Mijoz botga kirib /start bosgach, profilingizga bog'lanadi.
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-card overflow-hidden shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs">Mijoz nomi</TableHead>
                  <TableHead className="w-36 text-xs">Telefon</TableHead>
                  <TableHead className="w-36 text-xs">Qarz balansi</TableHead>
                  <TableHead className="w-44 text-xs text-right">Telegram holati</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id} className="text-xs hover:bg-muted/20">
                    <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{c.phone || "—"}</TableCell>
                    <TableCell className="font-mono">
                      <span className={Number(c.balance) > 0 ? "text-amber-400 font-semibold" : "text-emerald-400"}>
                        {fmtMoney(c.balance)} so'm
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-sky-500/30 text-sky-400 hover:bg-sky-500/10 gap-1"
                        onClick={() => setLinkCustomer({ id: c.id, name: c.name, phone: c.phone })}
                      >
                        <QrCode className="h-3 w-3" />
                        Telegramni ulash
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* TAB 3: SHABLONLAR VA SOZLAMALAR */}
      {activeTab === "templates" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chap ustun: Jonli shablonlar preview */}
          <div className="space-y-4">
            {/* Savdo cheki shabloni */}
            <div className="rounded-xl border border-border/70 bg-card p-4 space-y-2.5 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5 text-foreground">
                  <MessageSquare className="h-4 w-4 text-sky-400" />
                  Savdo Cheki Shabloni (Section 4)
                </span>
                <Badge variant="outline" className="border-sky-500/30 text-sky-400 text-[10px]">
                  Jonli ko'rinish
                </Badge>
              </div>
              <pre className="bg-muted/40 border border-border/50 rounded-xl p-3 text-[11px] font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
                {sampleSaleText}
              </pre>
            </div>

            {/* To'lov cheki shabloni */}
            <div className="rounded-xl border border-border/70 bg-card p-4 space-y-2.5 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5 text-foreground">
                  <MessageSquare className="h-4 w-4 text-emerald-400" />
                  To'lov Cheki Shabloni (Section 5)
                </span>
                <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 text-[10px]">
                  Jonli ko'rinish
                </Badge>
              </div>
              <pre className="bg-muted/40 border border-border/50 rounded-xl p-3 text-[11px] font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-52 overflow-y-auto">
                {samplePaymentText}
              </pre>
            </div>
          </div>

          {/* O'ng ustun: Bot Sozlamalari & Test ping */}
          <div className="space-y-4">
            {/* Sozlamalar paneli */}
            <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3.5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Bot className="h-4 w-4 text-sky-400" />
                Telegram Bot Sozlamalari
              </div>

              <div className="space-y-2.5 text-xs">
                <div>
                  <Label className="text-xs">Biznes / Filial Nomi ({'{business_name}'}):</Label>
                  <Input
                    className="h-8 text-xs mt-1"
                    value={settings.businessName}
                    onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                    placeholder="Masalan: SavdoPro"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Cheklar tagida ko'rsatiladigan rasmiy brend nomi.
                  </p>
                </div>

                <div>
                  <Label className="text-xs">Telegram Bot @username:</Label>
                  <Input
                    className="h-8 text-xs mt-1"
                    value={settings.botUsername}
                    onChange={(e) => setSettings({ ...settings, botUsername: e.target.value })}
                    placeholder="Masalan: SavdoProOfficialBot"
                  />
                </div>

                <div>
                  <Label className="text-xs">Telegram BotFather Tokeni (Maxfiy):</Label>
                  <Input
                    type="password"
                    className="h-8 text-xs font-mono mt-1"
                    value={settings.botToken}
                    onChange={(e) => setSettings({ ...settings, botToken: e.target.value })}
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Faqat administratorlarga ko'rinadi. Oddiy sotuvchilarga ko'rsatilmaydi.
                  </p>
                </div>

                <div className="pt-2 border-t border-border/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-foreground">Savdoda avtomatik jo'natish</div>
                      <div className="text-[10px] text-muted-foreground">Kassada har bir sotuv yakunlangach chek yuborilsin</div>
                    </div>
                    <Switch
                      checked={settings.autoSendSale}
                      onCheckedChange={(v) => setSettings({ ...settings, autoSendSale: v })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-foreground">To'lovda avtomatik jo'natish</div>
                      <div className="text-[10px] text-muted-foreground">Qarz to'langanda kvitansiya mijoz lichkasiga yuborilsin</div>
                    </div>
                    <Switch
                      checked={settings.autoSendPayment}
                      onCheckedChange={(v) => setSettings({ ...settings, autoSendPayment: v })}
                    />
                  </div>
                </div>

                <Button className="w-full h-8 text-xs mt-2" onClick={handleSaveSettings}>
                  Sozlamalarni saqlash
                </Button>
              </div>
            </div>

            {/* Test Ping jo'natish */}
            <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 space-y-2.5 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold text-sky-400">
                <Send className="h-4 w-4" />
                Sinov Xabarini Yuborish (Test Ping)
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Bot to'g'ri sozlanganini va xabar yetib borishini tekshirish uchun o'z shaxsiy Chat ID raqamingizni kiriting va sinab ko'ring.
              </p>

              <div className="flex items-center gap-1.5">
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="Telegram Chat ID (masalan: 987654321)"
                  value={testChatId}
                  onChange={(e) => setTestChatId(e.target.value)}
                />
                <Button
                  size="sm"
                  className="h-8 text-xs bg-sky-500 hover:bg-sky-600 text-white shrink-0"
                  disabled={testSending}
                  onClick={handleSendTestMessage}
                >
                  {testSending ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                  Sinash
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Xabar tafsiloti modali */}
      <Dialog open={!!selectedMsg} onOpenChange={(v) => !v && setSelectedMsg(null)}>
        <DialogContent className="max-w-md p-5 bg-card text-foreground border-border/80 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center justify-between">
              <span>Elektron Chek Tafsiloti</span>
              <Badge variant="outline" className="text-[10px] font-mono">
                {selectedMsg?.id}
              </Badge>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {selectedMsg?.customerName && `Mijoz: ${selectedMsg.customerName} · `}
              Chat ID: {selectedMsg?.telegramChatId}
            </DialogDescription>
          </DialogHeader>

          {selectedMsg && (
            <div className="space-y-3 py-1">
              {selectedMsg.status === "failed" && selectedMsg.lastError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-2.5 text-xs text-destructive space-y-1">
                  <div className="font-semibold flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Xatolik sababi:
                  </div>
                  <div className="font-mono text-[11px]">{selectedMsg.lastError}</div>
                </div>
              )}

              <pre className="bg-muted/40 border border-border/50 rounded-xl p-3 text-[11px] font-mono leading-relaxed text-muted-foreground whitespace-pre-wrap max-h-72 overflow-y-auto">
                {selectedMsg.formattedText}
              </pre>

              <div className="flex items-center justify-between pt-2 border-t border-border/40">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(selectedMsg.formattedText);
                    toast.success("Chek matni nusxalandi!");
                  }}
                >
                  Matnni nusxalash
                </Button>
                <Button
                  size="sm"
                  className="text-xs bg-sky-500 hover:bg-sky-600 text-white"
                  onClick={() => {
                    void handleResend(selectedMsg.id);
                    setSelectedMsg(null);
                  }}
                >
                  <RotateCw className="h-3.5 w-3.5 mr-1" />
                  Qayta yuborish
                </Button>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-border/40 text-[10px] text-muted-foreground/40 text-center font-mono">
            Dasturchi: MuzaffarZed · SavdoPro Engine
          </div>
        </DialogContent>
      </Dialog>

      {/* Customer Telegram Link Dialog */}
      <CustomerTelegramLinkDialog
        open={!!linkCustomer}
        onOpenChange={(v) => !v && setLinkCustomer(null)}
        customer={linkCustomer}
        onLinkUpdated={() => qc.invalidateQueries({ queryKey: ["customers-telegram-list"] })}
      />

      {/* Dasturchi Imzosi (7-QONUN) */}
      <div className="pt-6 pb-2 text-center text-[10px] text-muted-foreground/40 font-mono tracking-wider">
        Dasturchi: MuzaffarZed · SavdoPro Telegram Engine v2.0
      </div>
    </div>
  );
}
