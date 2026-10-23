import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  QrCode,
  Copy,
  Check,
  Unlink,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Radio,
} from "lucide-react";
import { toast } from "sonner";
import {
  createCustomerDeepLink,
  getCustomerTelegramLink,
  disconnectCustomerTelegram,
  pollTelegramBotUpdates,
  type CustomerTelegramLink,
  type GeneratedDeepLinkResult,
  loadTelegramSettings,
} from "@/lib/telegram-service";
import { fmtDate } from "@/lib/format";

interface CustomerTelegramLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customer: {
    id: string;
    name: string;
    phone?: string | null;
  } | null;
  onLinkUpdated?: () => void;
}

export const CustomerTelegramLinkDialog: React.FC<CustomerTelegramLinkDialogProps> = ({
  open,
  onOpenChange,
  customer,
  onLinkUpdated,
}) => {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkInfo, setLinkInfo] = useState<CustomerTelegramLink | null>(null);
  const [generated, setGenerated] = useState<GeneratedDeepLinkResult | null>(null);

  const loadStatus = async () => {
    if (!customer?.id) return;
    setLoading(true);
    try {
      const info = await getCustomerTelegramLink(customer.id);
      setLinkInfo(info);
      if (info.linkStatus !== "linked") {
        const gen = await createCustomerDeepLink(customer.id);
        setGenerated(gen);
      } else {
        setGenerated(null);
      }
    } catch {
      toast.error("Ma'lumotlarni yuklashda xatolik");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && customer?.id) {
      void loadStatus();
    } else {
      setGenerated(null);
      setLinkInfo(null);
      setCopied(false);
    }
  }, [open, customer?.id]);

  // Real-time Telegram Bot Polling: Mijoz QR kodni skaner qilganda avtomatik sezish
  useEffect(() => {
    if (!open || !customer?.id) return;

    let stopped = false;
    const interval = setInterval(async () => {
      if (stopped) return;
      try {
        const res = await pollTelegramBotUpdates();
        if (res.boundCustomerIds.includes(customer.id)) {
          const fresh = await getCustomerTelegramLink(customer.id);
          setLinkInfo(fresh);
          toast.success("🎉 Mijozning Telegram hisobi muvaffaqiyatli bog'landi!");
          onLinkUpdated?.();
        }
      } catch {}
    }, 2000);

    const handleSuccess = (e: Event) => {
      const customEvt = e as CustomEvent<{ customerId: string }>;
      if (customEvt.detail?.customerId === customer.id) {
        void getCustomerTelegramLink(customer.id).then((fresh) => {
          setLinkInfo(fresh);
          toast.success("🎉 Mijozning Telegram hisobi muvaffaqiyatli bog'landi!");
          onLinkUpdated?.();
        });
      }
    };

    window.addEventListener("savdopro_telegram_link_success", handleSuccess);

    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener("savdopro_telegram_link_success", handleSuccess);
    };
  }, [open, customer?.id, onLinkUpdated]);

  const handleCopy = () => {
    if (!generated?.deepLink) return;
    void navigator.clipboard.writeText(generated.deepLink);
    setCopied(true);
    toast.success("Havola nusxalandi!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareTelegram = () => {
    if (!generated?.deepLink || !customer) return;
    const settings = loadTelegramSettings();
    const shareText = `Hurmatli ${customer.name}, ${settings.businessName || "do'konimiz"}dan xarid cheklari va hisob-kitoblarni shaxsiy lichkangizda olish uchun botimizga kiring:\n${generated.deepLink}`;
    window.open(`https://t.me/share/url?url=${encodeURIComponent(generated.deepLink)}&text=${encodeURIComponent(shareText)}`, "_blank");
  };

  const handleDisconnect = async () => {
    if (!customer?.id) return;
    if (!confirm("Mijozning Telegram bog'lanishini uzishni tasdiqlaysizmi?")) return;
    setLoading(true);
    try {
      await disconnectCustomerTelegram(customer.id);
      toast.success("Telegram bog'lanishi uzildi");
      await loadStatus();
      onLinkUpdated?.();
    } catch {
      toast.error("Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!customer?.id) return;
    setLoading(true);
    try {
      const gen = await createCustomerDeepLink(customer.id);
      setGenerated(gen);
      toast.success("Yangi ulanish havolasi va QR-kod yaratildi");
    } catch {
      toast.error("Yangi havola yaratishda xato");
    } finally {
      setLoading(false);
    }
  };

  if (!customer) return null;

  const isLinked = linkInfo?.linkStatus === "linked";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 bg-card text-foreground border-border/80 shadow-2xl">
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <Send className="h-3.5 w-3.5" />
              </div>
              Telegram Botga Ulash
            </DialogTitle>
            {isLinked ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[11px] gap-1 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Ulangan
              </Badge>
            ) : linkInfo?.linkStatus === "disconnected" ? (
              <Badge variant="outline" className="border-rose-500/30 text-rose-400 bg-rose-500/10 text-[11px] gap-1 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                Uzilgan
              </Badge>
            ) : (
              <Badge variant="outline" className="border-slate-500/30 text-slate-400 bg-slate-500/10 text-[11px] gap-1 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                Ulanmagan
              </Badge>
            )}
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Mijoz: <span className="font-semibold text-foreground">{customer.name}</span>
            {customer.phone && ` · ${customer.phone}`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-sky-400" />
            <span className="text-xs">Ulanish holati tekshirilmoqda...</span>
          </div>
        ) : isLinked ? (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2.5">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-emerald-300">Telegram hisobi muvaffaqiyatli bog'langan</div>
                  <p className="text-muted-foreground leading-relaxed">
                    Kassada savdo yakunlanganda yoki qarz to'langanda elektron cheklar avtomatik tarzda mijozning shaxsiy Telegram lichkasiga boradi.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-500/20 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Telegram Chat ID:</span>
                  <div className="font-mono font-semibold text-foreground">{linkInfo?.telegramChatId || "—"}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Telegram User:</span>
                  <div className="font-mono font-semibold text-sky-400">
                    {linkInfo?.telegramUsername ? `@${linkInfo.telegramUsername}` : "Mijoz lichkasi"}
                  </div>
                </div>
                <div className="col-span-2 pt-1">
                  <span className="text-muted-foreground">Bog'langan sana:</span>
                  <div className="font-semibold text-foreground">
                    {linkInfo?.linkedAt ? fmtDate(new Date(linkInfo.linkedAt)) : "Muvaffaqiyatli"}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={handleDisconnect}
              >
                <Unlink className="h-3.5 w-3.5 mr-1" />
                Bog'lanishni uzish
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
                onClick={handleRegenerate}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Qayta havola yaratish
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {generated?.qrDataUrl && (
              <div className="flex flex-col items-center justify-center p-3 rounded-2xl border border-border/70 bg-white/5 shadow-inner">
                <div className="bg-white p-2.5 rounded-xl shadow-md">
                  <img
                    src={generated.qrDataUrl}
                    alt="Telegram ulanish QR-kodi"
                    className="w-48 h-48 object-contain"
                  />
                </div>
                <div className="mt-2.5 text-center text-[11px] text-muted-foreground flex items-center gap-1.5 font-medium">
                  <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
                  <span>Jonli skaner kutilmoqda: mijoz botda <b>Start</b> bosishi bilan o'zi ulanadi</span>
                </div>
              </div>
            )}

            {/* Havola qatori */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground">Bir martalik xavfsiz ulanish havolasi:</div>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={generated?.deepLink || ""}
                  className="flex-1 bg-muted/40 border border-border/70 rounded-lg px-2.5 py-1.5 text-xs font-mono text-muted-foreground truncate select-all focus:outline-none focus:border-sky-500"
                />
                <Button size="sm" variant="outline" className="h-8 text-xs shrink-0" onClick={handleCopy}>
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="ml-1 hidden sm:inline">{copied ? "Nusxalandi" : "Nusxa"}</span>
                </Button>
              </div>
            </div>

            {/* Ulashish tugmalari */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                className="flex-1 h-9 text-xs bg-sky-500 hover:bg-sky-600 text-white font-medium shadow-sm hover:shadow"
                onClick={handleShareTelegram}
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                Telegramda ulashish
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 text-xs"
                onClick={handleRegenerate}
                title="Yangi QR va token yaratish"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="rounded-lg bg-muted/30 border border-border/50 p-2.5 text-[10px] text-muted-foreground flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                Ushbu havola 24 soat davomida faol. Mijoz botni ochib <b>/start</b> bosishi bilan uning profili avtomatik bog'lanadi va token bir martalik qilib bekor qilinadi.
              </div>
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-border/40 text-[10px] text-muted-foreground/40 text-center font-mono">
          Dasturchi: MuzaffarZed · SavdoPro Telegram Engine v2.1
        </div>
      </DialogContent>
    </Dialog>
  );
};
