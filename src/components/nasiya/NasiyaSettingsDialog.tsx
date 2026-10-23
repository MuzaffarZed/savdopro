import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell,
  Send,
  MessageSquare,
  Bot,
  Smartphone,
  Eye,
  History,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Trash2,
  Loader2,
  Check,
  Store,
  PhoneCall,
  HeartHandshake,
} from "lucide-react";
import { toast } from "sonner";
import {
  loadNasiyaSettings,
  saveNasiyaSettings,
  verifyTelegramBotToken,
  sendTelegramMessage,
  buildNasiyaSaleReceiptText,
  buildNasiyaPaymentReceiptText,
  buildRegularSaleReceiptText,
  loadNasiyaLogs,
  clearNasiyaLogs,
  buildDirectTelegramShareUrl,
  type NasiyaNotificationSettings,
  type NasiyaLogEntry,
} from "@/lib/nasiya-notify";
import { fmtDate, fmtMoney } from "@/lib/format";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NasiyaSettingsDialog({ open, onOpenChange }: Props) {
  const [settings, setSettings] = useState<NasiyaNotificationSettings>(loadNasiyaSettings());
  const [logs, setLogs] = useState<NasiyaLogEntry[]>([]);
  const [verifyingBot, setVerifyingBot] = useState(false);
  const [botStatus, setBotStatus] = useState<{ verified: boolean; username?: string; error?: string } | null>(null);
  const [testingMsg, setTestingMsg] = useState(false);
  const [previewType, setPreviewType] = useState<"sale" | "payment" | "regular">("sale");
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const loaded = loadNasiyaSettings();
      setSettings(loaded);
      setLogs(loadNasiyaLogs());
      if (loaded.telegramBotToken) {
        setBotStatus(null);
      }
    }
  }, [open]);

  const update = <K extends keyof NasiyaNotificationSettings>(key: K, value: NasiyaNotificationSettings[K]) => {
    const updated = saveNasiyaSettings({ [key]: value });
    setSettings(updated);
  };

  const handleVerifyBot = async () => {
    if (!settings.telegramBotToken.trim()) {
      toast.error("Bot tokeni kiritilmagan");
      return;
    }
    setVerifyingBot(true);
    setBotStatus(null);
    try {
      const res = await verifyTelegramBotToken(settings.telegramBotToken);
      if (res.ok && res.username) {
        setBotStatus({ verified: true, username: res.username });
        update("telegramBotUsername", res.username);
        toast.success(`Bot muvaffaqiyatli ulandi: @${res.username}`);
      } else {
        setBotStatus({ verified: false, error: res.error || "Token noto'g'ri" });
        toast.error(res.error || "Botni tekshirib bo'lmadi");
      }
    } finally {
      setVerifyingBot(false);
    }
  };

  const handleSendTestMessage = async () => {
    if (!settings.telegramBotToken || !settings.telegramChatId) {
      toast.error("Bot token va Chat ID kiritilishi shart");
      return;
    }
    setTestingMsg(true);
    try {
      const testText =
        `🔔 *${settings.shopDisplayName.toUpperCase()} — SINOV XABARI*\n\n` +
        `✅ Nasiya xabarnomalari tizimi muvaffaqiyatli ishlamoqda!\n` +
        `📅 Sana: ${fmtDate(new Date())}\n` +
        `📞 Aloqa: ${settings.shopPhone}\n\n` +
        `🙏 ${settings.receiptFooterNote}`;

      const res = await sendTelegramMessage(testText, settings.telegramBotToken, settings.telegramChatId);
      if (res.ok) {
        toast.success("Sinov xabari Telegramga muvaffaqiyatli yuborildi!");
      } else {
        toast.error("Xatolik: " + (res.error || "Yuborib bo'lmadi"));
      }
    } finally {
      setTestingMsg(false);
    }
  };

  const handleClearLogs = () => {
    clearNasiyaLogs();
    setLogs([]);
    toast.success("Xabarlar jurnali tozalandi");
  };

  const copyToClipboard = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedIndex(id);
    toast.success("Nusxa olindi");
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  // Sample data for live preview
  const sampleSaleData = {
    shopName: settings.shopDisplayName,
    branchName: "Markaziy Filial",
    cashierName: "Kassir (Siz)",
    customerName: "Alisher Aka",
    customerPhone: "+998 90 123 45 67",
    receiptNo: "a8f7c9e1",
    items: [
      { name: "Kungaboqar yog'i 1L", qty: 2, price: 18000 },
      { name: "Shakar 1kg", qty: 3, price: 13000 },
      { name: "Choy (Qora) 100g", qty: 1, price: 15000 },
    ],
    totalSale: 90000,
    amountPaid: 40000,
    previousDebt: 60000,
    newDebtAdded: 50000,
    finalDebt: 110000,
    paymentMethod: "Naqd",
    date: new Date(),
  };

  const samplePaymentData = {
    shopName: settings.shopDisplayName,
    branchName: "Markaziy Filial",
    cashierName: "Kassir (Siz)",
    customerName: "Alisher Aka",
    customerPhone: "+998 90 123 45 67",
    paymentNo: "pay77231",
    amountPaid: 50000,
    previousDebt: 110000,
    debtCleared: 50000,
    finalDebt: 60000,
    paymentMethod: "Click",
    note: "Kassaga to'landi",
    date: new Date(),
  };

  const sampleRegularSaleData = {
    shopName: settings.shopDisplayName,
    branchName: "Markaziy Filial",
    cashierName: "Kassir (Siz)",
    customerName: "Alisher Aka",
    customerPhone: "+998 90 123 45 67",
    receiptNo: "reg9213a",
    items: [
      { name: "Non (Tandir)", qty: 2, price: 5000 },
      { name: "Sut 1L (Musaffo)", qty: 1, price: 12000 },
      { name: "Shokolad Nestle", qty: 2, price: 14000 },
    ],
    totalSale: 50000,
    amountPaid: 50000,
    paymentMethod: "Click",
    currentDebtBalance: 0,
    date: new Date(),
  };

  const previewTelegramText =
    previewType === "sale"
      ? buildNasiyaSaleReceiptText(sampleSaleData, { channel: "telegram", settings })
      : previewType === "payment"
      ? buildNasiyaPaymentReceiptText(samplePaymentData, { channel: "telegram", settings })
      : buildRegularSaleReceiptText(sampleRegularSaleData, { channel: "telegram", settings });

  const previewSmsText =
    previewType === "sale"
      ? buildNasiyaSaleReceiptText(sampleSaleData, { channel: "sms", settings })
      : previewType === "payment"
      ? buildNasiyaPaymentReceiptText(samplePaymentData, { channel: "sms", settings })
      : buildRegularSaleReceiptText(sampleRegularSaleData, { channel: "sms", settings });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-background border-border shadow-2xl">
        <DialogHeader className="p-4 sm:p-5 border-b border-border/70 shrink-0 bg-card/60 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Bell className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-semibold tracking-tight text-foreground">
                  Nasiya Xabarnomalari Sozlamasi
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Telegram Bot va SMS orqali mijozlarga avtomatik qarz cheklarini yuborish
                </DialogDescription>
              </div>
            </div>

            {/* Asosiy Master Switch */}
            <div className="flex items-center gap-2 bg-secondary/60 px-3 py-1.5 rounded-full border border-border/60">
              <span className="text-xs font-medium text-muted-foreground">Tizim holati:</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => update("enabled", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="grid grid-cols-5 w-full h-10 p-1 mb-4 bg-muted/70 rounded-xl">
              <TabsTrigger value="general" className="text-xs gap-1.5 rounded-lg">
                <Store className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Asosiy</span>
              </TabsTrigger>
              <TabsTrigger value="telegram" className="text-xs gap-1.5 rounded-lg">
                <Send className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Telegram</span>
              </TabsTrigger>
              <TabsTrigger value="sms" className="text-xs gap-1.5 rounded-lg">
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">SMS Shlyuz</span>
              </TabsTrigger>
              <TabsTrigger value="preview" className="text-xs gap-1.5 rounded-lg">
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Jonli ko'rish</span>
              </TabsTrigger>
              <TabsTrigger value="logs" className="text-xs gap-1.5 rounded-lg">
                <History className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Tarix</span>
              </TabsTrigger>
            </TabsList>

            {/* ================= TAB 1: ASOSIY ================= */}
            <TabsContent value="general" className="space-y-4 focus-visible:outline-none">
              <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Store className="h-3.5 w-3.5 text-primary" /> Do'kon va Chek ma'lumotlari
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Do'kon / Brend nomi</Label>
                    <Input
                      placeholder="SavdoPro"
                      value={settings.shopDisplayName}
                      onChange={(e) => update("shopDisplayName", e.target.value)}
                      className="h-9 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">Chekning eng yuqorisida ko'rinadi</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Aloqa telefoni</Label>
                    <Input
                      placeholder="+998 90 123 45 67"
                      value={settings.shopPhone}
                      onChange={(e) => update("shopPhone", e.target.value)}
                      className="h-9 text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">Mijoz savol bilan qayta qo'ng'iroq qilishi uchun</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Chek ostidagi minnatdorchilik yozuvi</Label>
                  <Input
                    placeholder="Xaridingiz uchun rahmat!"
                    value={settings.receiptFooterNote}
                    onChange={(e) => update("receiptFooterNote", e.target.value)}
                    className="h-9 text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">Chek oxiridagi xushmuomala so'zlar</p>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-3.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <HeartHandshake className="h-3.5 w-3.5 text-primary" /> Avtomatlashtirish qoidalari
                </div>

                <div className="space-y-2.5">
                  <label className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-pointer transition-colors border border-border/40">
                    <div>
                      <div className="text-xs font-medium text-foreground">Nasiya savdo bo'lganda avtomatik jo'natish</div>
                      <div className="text-[11px] text-muted-foreground">Kassada qarzga sotuv amalga oshishi bilan chek mijozga yuboriladi</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.autoSendOnSale}
                      onChange={(e) => update("autoSendOnSale", e.target.checked)}
                      className="h-4 w-4 rounded accent-primary cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-pointer transition-colors border border-border/40">
                    <div>
                      <div className="text-xs font-medium text-foreground">Qarz to'langanda to'lov kvitansiyasini jo'natish</div>
                      <div className="text-[11px] text-muted-foreground">Mijoz qarzini to'laganda unga o'chirilgan summa va qolgan qoldiq darhol boradi</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.autoSendOnPayment}
                      onChange={(e) => update("autoSendOnPayment", e.target.checked)}
                      className="h-4 w-4 rounded accent-primary cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-pointer transition-colors border border-border/40">
                    <div>
                      <div className="text-xs font-medium text-foreground">Oddiy savdolarda ham elektron chek jo'natish (Qarzsiz)</div>
                      <div className="text-[11px] text-muted-foreground">Naqd yoki karta to'langan 100% to'langan savdolar ham mijoz lichkasiga chek bo'lib boradi</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.regularSalesEnabled}
                      onChange={(e) => update("regularSalesEnabled", e.target.checked)}
                      className="h-4 w-4 rounded accent-primary cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-pointer transition-colors border border-border/40">
                    <div>
                      <div className="text-xs font-medium text-foreground">Oddiy savdoda avtomatik jo'natish</div>
                      <div className="text-[11px] text-muted-foreground">Savdo yakunlanishi bilan bir zumda avtomatik yuborish (o'chirilsa: faqat qo'lda yuboriladi)</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.autoSendRegularSale}
                      onChange={(e) => update("autoSendRegularSale", e.target.checked)}
                      className="h-4 w-4 rounded accent-primary cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 hover:bg-secondary/50 cursor-pointer transition-colors border border-border/40">
                    <div>
                      <div className="text-xs font-medium text-foreground">Chekda tovarlar ro'yxatini batafsil chiqarish</div>
                      <div className="text-[11px] text-muted-foreground">Har bir tovar nomi, donasi va narxini alohida qator qilib ko'rsatish</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.showItemDetails}
                      onChange={(e) => update("showItemDetails", e.target.checked)}
                      className="h-4 w-4 rounded accent-primary cursor-pointer"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <label className="flex items-center gap-2 p-2 rounded-lg bg-secondary/20 hover:bg-secondary/40 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={settings.includeCashierName}
                        onChange={(e) => update("includeCashierName", e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
                      />
                      <span>Kassir ismini ko'rsatish</span>
                    </label>

                    <label className="flex items-center gap-2 p-2 rounded-lg bg-secondary/20 hover:bg-secondary/40 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={settings.includeBranchName}
                        onChange={(e) => update("includeBranchName", e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-primary cursor-pointer"
                      />
                      <span>Filial nomini ko'rsatish</span>
                    </label>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ================= TAB 2: TELEGRAM ================= */}
            <TabsContent value="telegram" className="space-y-4 focus-visible:outline-none">
              <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                      <Send className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-foreground">Telegram orqali xabar yuborish</div>
                      <div className="text-[11px] text-muted-foreground">Bot orqali guruh, kanal yoki shaxsiy chatga yuborish</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.telegramEnabled}
                    onChange={(e) => update("telegramEnabled", e.target.checked)}
                    className="h-4 w-4 rounded accent-primary cursor-pointer"
                  />
                </div>

                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Telegram Bot Token (BotFather dan)</Label>
                      {botStatus?.verified && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> @{botStatus.username} faol
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz..."
                        value={settings.telegramBotToken}
                        onChange={(e) => update("telegramBotToken", e.target.value)}
                        className="h-9 text-xs font-mono"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-9 text-xs shrink-0 gap-1.5"
                        onClick={handleVerifyBot}
                        disabled={verifyingBot || !settings.telegramBotToken}
                      >
                        {verifyingBot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                        Tekshirish
                      </Button>
                    </div>
                    {botStatus && !botStatus.verified && (
                      <p className="text-[11px] text-destructive flex items-center gap-1">
                        <AlertCircle className="h-3 w-3 shrink-0" /> {botStatus.error}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Telegram Chat ID (Guruh, Kanal yoki Foydalanuvchi ID)</Label>
                    <Input
                      placeholder="-1001234567890 yoki foydalanuvchi IDsi"
                      value={settings.telegramChatId}
                      onChange={(e) => update("telegramChatId", e.target.value)}
                      className="h-9 text-xs font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Do'konning zaxira arxivi uchun guruh/kanal IDsi (masalan: -100...)
                    </p>
                  </div>

                  {/* Shaxsiy Lichka & Maxfiylik Sozlamalari */}
                  <div className="space-y-2 pt-1 border-t border-border/50">
                    <label className="flex items-center justify-between p-2.5 rounded-lg bg-sky-500/10 border border-sky-500/20 cursor-pointer">
                      <div>
                        <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          🔒 Maxfiylik: Cheklarni faqat mijozning shaxsiy lichkasiga yuborish
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Botga /start bosgan mijozga chek to'g'ridan-to'g'ri shaxsiy chatiga boradi. Guruhdagi 50 ta odam ko'rmaydi!
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.directCustomerBotEnabled}
                        onChange={(e) => update("directCustomerBotEnabled", e.target.checked)}
                        className="h-4 w-4 rounded accent-primary cursor-pointer"
                      />
                    </label>

                    <label className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/30 border border-border/40 cursor-pointer">
                      <div>
                        <div className="text-xs font-medium text-foreground">
                          Do'kon kanaliga/guruhiga ham zaxira nusxa tashlash
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Lichkaga yuborilgandan tashqari, do'kon arxivi uchun umumiy kanalga ham nusxa saqlab boradi
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.sendGroupCopy}
                        onChange={(e) => update("sendGroupCopy", e.target.checked)}
                        className="h-4 w-4 rounded accent-primary cursor-pointer"
                      />
                    </label>
                  </div>

                  <div className="pt-2 flex gap-2">
                    <Button
                      size="sm"
                      className="text-xs gap-1.5 h-8 bg-sky-600 hover:bg-sky-500 text-white"
                      onClick={handleSendTestMessage}
                      disabled={testingMsg || !settings.telegramBotToken || !settings.telegramChatId}
                    >
                      {testingMsg ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Sinov xabarini yuborish
                    </Button>
                  </div>
                </div>
              </div>

              {/* Bot ochish yo'riqnomasi */}
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-3.5 space-y-2 text-xs">
                <div className="font-semibold text-sky-400 flex items-center gap-1.5">
                  <Bot className="h-4 w-4" /> 3 daqiqada bepul Telegram Bot yaratish:
                </div>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-[11px] leading-relaxed">
                  <li>Telegramda <strong className="text-foreground">@BotFather</strong> rasmiy botiga kiring va <code className="bg-muted px-1 rounded text-foreground">/newbot</code> buyrug'ini bering.</li>
                  <li>Botingizga istalgan nom (masalan: <em>Mening Do'konim Bot</em>) va username bering.</li>
                  <li>BotFather bergan uzun API Tokenni yuqoridagi maydonga kiriting va <strong>Tekshirish</strong> tugmasini bosing.</li>
                  <li>Botingizni guruhga admin qilib qo'shing va guruh ID sini Chat ID maydoniga yozing.</li>
                </ol>
              </div>
            </TabsContent>

            {/* ================= TAB 3: SMS SHLYUZ ================= */}
            <TabsContent value="sms" className="space-y-4 focus-visible:outline-none">
              <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <MessageSquare className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-foreground">SMS orqali xabar yuborish</div>
                      <div className="text-[11px] text-muted-foreground">Mijoz telefon raqamiga to'g'ridan-to'g'ri SMS chek</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.smsEnabled}
                    onChange={(e) => update("smsEnabled", e.target.checked)}
                    className="h-4 w-4 rounded accent-primary cursor-pointer"
                  />
                </div>

                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">SMS yuborish usuli (Provayder)</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => update("smsProvider", "device_sms")}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          settings.smsProvider === "device_sms"
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-border/60 bg-secondary/30 hover:bg-secondary/50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <Smartphone className="h-3.5 w-3.5 text-primary" /> Qurilma SMS ilovasi
                          </span>
                          <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-medium">100% Bepul</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          Planshet/telefondagi native SMS dasturida chek tayyor holda ochiladi, kassir 1 tugma bilan yuboradi.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => update("smsProvider", "eskiz")}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          settings.smsProvider === "eskiz"
                            ? "border-primary bg-primary/10 shadow-sm"
                            : "border-border/60 bg-secondary/30 hover:bg-secondary/50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                            <MessageSquare className="h-3.5 w-3.5 text-emerald-400" /> Eskiz.uz Gateway
                          </span>
                          <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">Avtomatik</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          O'zbekistondagi rasmiy SMS shlyuz orqali to'g'ridan-to'g'ri fonda xabar yuboradi (API Token talab qilinadi).
                        </p>
                      </button>
                    </div>
                  </div>

                  {settings.smsProvider === "eskiz" && (
                    <div className="space-y-1.5 p-3 rounded-xl bg-secondary/30 border border-border/50 animate-in fade-in-50">
                      <Label className="text-xs font-medium">Eskiz.uz API Token (Bearer)</Label>
                      <Input
                        type="password"
                        placeholder="eyJ0eXAiOiJKV1QiLC..."
                        value={settings.smsApiToken}
                        onChange={(e) => update("smsApiToken", e.target.value)}
                        className="h-9 text-xs font-mono"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Eskiz.uz shaxsiy kabinetingizdan olingan API kalit
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ================= TAB 4: JONLI KO'RISH (PREVIEW) ================= */}
            <TabsContent value="preview" className="space-y-3 focus-visible:outline-none">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs text-muted-foreground">Chek turini tanlang:</span>
                <div className="flex gap-1 bg-muted p-0.5 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPreviewType("sale")}
                    className={`text-xs px-2.5 py-1 rounded-md transition-all font-medium ${
                      previewType === "sale" ? "bg-background shadow text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    🛍️ Nasiya savdo
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewType("payment")}
                    className={`text-xs px-2.5 py-1 rounded-md transition-all font-medium ${
                      previewType === "payment" ? "bg-background shadow text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    💳 Qarz to'lovi
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewType("regular")}
                    className={`text-xs px-2.5 py-1 rounded-md transition-all font-medium ${
                      previewType === "regular" ? "bg-background shadow text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    🛒 Oddiy savdo
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Telegram ko'rinishi */}
                <div className="rounded-xl border border-sky-500/20 bg-card/80 p-3 flex flex-col justify-between shadow-md">
                  <div>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/50 text-xs">
                      <span className="font-semibold text-sky-400 flex items-center gap-1.5">
                        <Send className="h-3.5 w-3.5" /> Telegram formati
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => copyToClipboard(previewTelegramText, "tg-preview")}
                      >
                        {copiedIndex === "tg-preview" ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        Nusxa
                      </Button>
                    </div>
                    <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-sans text-foreground/90 bg-muted/40 p-3 rounded-lg border border-border/40 select-all max-h-[300px] overflow-y-auto">
                      {previewTelegramText}
                    </pre>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground text-center">
                    Barcha formatlash (qalin yozuvlar, belgilar) Telegramda chiroyli ko'rinadi
                  </div>
                </div>

                {/* SMS ko'rinishi */}
                <div className="rounded-xl border border-emerald-500/20 bg-card/80 p-3 flex flex-col justify-between shadow-md">
                  <div>
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/50 text-xs">
                      <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5" /> SMS formati (Ixcham)
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {previewSmsText.length} belgi
                      </span>
                    </div>
                    <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono text-foreground/90 bg-muted/40 p-3 rounded-lg border border-border/40 select-all max-h-[300px] overflow-y-auto">
                      {previewSmsText}
                    </pre>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground text-center">
                    Harflar chegarasini tejash uchun qisqartirilgan aniq hisobot
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ================= TAB 5: TARIX & JURNAL ================= */}
            <TabsContent value="logs" className="space-y-3 focus-visible:outline-none">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Yuborilgan oxirgi xabarlar ({logs.length} ta):
                </span>
                {logs.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:bg-destructive/10 gap-1"
                    onClick={handleClearLogs}
                  >
                    <Trash2 className="h-3 w-3" /> Tarixni tozalash
                  </Button>
                )}
              </div>

              {logs.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                  Hozircha yuborilgan xabarlar yo'q
                </div>
              ) : (
                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="p-3 rounded-xl border border-border/60 bg-card/60 flex items-start justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              log.type === "sale"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            }`}
                          >
                            {log.type === "sale" ? "Nasiya savdo" : "Qarz to'lovi"}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {fmtDate(new Date(log.timestamp))}
                          </span>
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.2 rounded ${
                              log.status === "sent" ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {log.status === "sent" ? "● Yuborildi" : "✕ Xato"}
                          </span>
                        </div>

                        <div className="font-semibold text-foreground truncate">
                          {log.customerName || "Noma'lum mijoz"} ·{" "}
                          <span className="font-mono text-muted-foreground">{log.customerPhone || "Tel yo'q"}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          Summa: <strong className="text-foreground">{fmtMoney(log.amount)} so'm</strong> | Qoldiq:{" "}
                          <strong className="text-amber-400">{fmtMoney(log.debt)} so'm</strong>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {log.customerPhone && (
                          <a
                            href={buildDirectTelegramShareUrl(log.customerPhone, log.textPreview)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-7 px-2 items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 text-[11px]"
                            title="Telegramda ulashish"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Telegram
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => copyToClipboard(log.textPreview, log.id)}
                          title="Nusxa olish"
                        >
                          {copiedIndex === log.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <div className="p-3 sm:p-4 border-t border-border/70 bg-card/60 flex items-center justify-between shrink-0">
          <span className="text-xs text-muted-foreground">
            O'zgarishlar avtomatik saqlanadi
          </span>
          <Button size="sm" onClick={() => onOpenChange(false)} className="text-xs px-4">
            Tayyor
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
