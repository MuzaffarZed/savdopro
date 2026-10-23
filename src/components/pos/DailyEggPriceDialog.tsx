import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { usePricelist, upsertOverride } from "@/lib/use-pricelist";
import { fmtMoney } from "@/lib/format";
import { loadNasiyaSettings, sendTelegramMessage } from "@/lib/nasiya-notify";
import { Send, History, CheckCircle2, TrendingUp, Sparkles, Share2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export interface EggPriceRecord {
  timestamp: number;
  dateStr: string;
  d1: number;
  d2: number;
  d3: number;
}

const EGG_HISTORY_KEY = "savdopro_egg_price_history_v1";

export function loadEggPriceHistory(): EggPriceRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(EGG_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveEggPriceHistory(record: Omit<EggPriceRecord, "timestamp" | "dateStr">): void {
  if (typeof window === "undefined") return;
  try {
    const history = loadEggPriceHistory();
    const newEntry: EggPriceRecord = {
      ...record,
      timestamp: Date.now(),
      dateStr: new Date().toLocaleDateString("uz-UZ", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
    history.unshift(newEntry);
    localStorage.setItem(EGG_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  } catch {}
}

interface DailyEggPriceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products?: Array<{
    product_id: string;
    name: string;
    category: string | null;
    total: number;
    minCost: number;
    totalValue: number;
  }>;
}

export function DailyEggPriceDialog({
  open,
  onOpenChange,
  products = [],
}: DailyEggPriceDialogProps) {
  const qc = useQueryClient();
  const { overrides } = usePricelist();

  // Find Tuxum D1, D2, D3 items
  const d1Item = useMemo(
    () => products.find((p) => /tuxum.*d1|d1.*tuxum|\bd1\b/i.test(p.name)),
    [products]
  );
  const d2Item = useMemo(
    () => products.find((p) => /tuxum.*d2|d2.*tuxum|\bd2\b/i.test(p.name)),
    [products]
  );
  const d3Item = useMemo(
    () => products.find((p) => /tuxum.*d3|d3.*tuxum|\bd3\b/i.test(p.name)),
    [products]
  );

  const [d1Price, setD1Price] = useState<string>("");
  const [d2Price, setD2Price] = useState<string>("");
  const [d3Price, setD3Price] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<EggPriceRecord[]>([]);

  // Initialize input prices from overrides or current cost
  useEffect(() => {
    if (open) {
      if (d1Item) {
        const cur = overrides[d1Item.product_id]?.price ?? 43000;
        setD1Price(String(Math.round(cur)));
      } else {
        setD1Price("43000");
      }

      if (d2Item) {
        const cur = overrides[d2Item.product_id]?.price ?? 42000;
        setD2Price(String(Math.round(cur)));
      } else {
        setD2Price("42000");
      }

      if (d3Item) {
        const cur = overrides[d3Item.product_id]?.price ?? 41000;
        setD3Price(String(Math.round(cur)));
      } else {
        setD3Price("41000");
      }

      setHistory(loadEggPriceHistory());
    }
  }, [open, d1Item, d2Item, d3Item, overrides]);

  const handleSave = async (broadcastTelegram: boolean = false) => {
    const numD1 = Number(d1Price) || 0;
    const numD2 = Number(d2Price) || 0;
    const numD3 = Number(d3Price) || 0;

    if (numD1 <= 0 && numD2 <= 0 && numD3 <= 0) {
      toast.error("Kamida bitta tuxum narxini kiriting");
      return;
    }

    setSaving(true);
    try {
      if (d1Item && numD1 > 0) {
        await upsertOverride(d1Item.product_id, { price: numD1 });
      }
      if (d2Item && numD2 > 0) {
        await upsertOverride(d2Item.product_id, { price: numD2 });
      }
      if (d3Item && numD3 > 0) {
        await upsertOverride(d3Item.product_id, { price: numD3 });
      }

      // Record in history
      saveEggPriceHistory({ d1: numD1, d2: numD2, d3: numD3 });
      setHistory(loadEggPriceHistory());

      // Invalidate queries so POS and web update immediately
      qc.invalidateQueries({ queryKey: ["pricelist-overrides"] });
      qc.invalidateQueries({ queryKey: ["inventory-batches"] });

      toast.success("Tuxum narxlari muvaffaqiyatli yangilandi!", {
        description: "POS, Web sayt va APK tizimida darhol kuchga kirdi",
      });

      // Broadcast to Telegram if requested
      if (broadcastTelegram) {
        const settings = loadNasiyaSettings();
        const dateStr = new Date().toLocaleDateString("uz-UZ");
        const msg = [
          `🥚 <b>SAVDOPRO — BUGUNGI KUNLIK TUXUM NARXLARI</b>`,
          `📅 <b>Sana:</b> ${dateStr}`,
          `━━━━━━━━━━━━━━━━━━━`,
          `🔹 <b>Tuxum D1 (Eng kattasi):</b> ${fmtMoney(numD1)}`,
          `🔹 <b>Tuxum D2 (O'rtachasi):</b> ${fmtMoney(numD2)}`,
          `🔹 <b>Tuxum D3 (Eng kichigi):</b> ${fmtMoney(numD3)}`,
          `━━━━━━━━━━━━━━━━━━━`,
          `🚚 <i>Do'koningizga yetkazib berish bo'yicha buyurtmani botimiz orqali qoldirishingiz mumkin.</i>`,
          settings.shopPhone ? `📞 <b>Bog'lanish:</b> ${settings.shopPhone}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        if (settings.telegramBotToken && settings.telegramChatId) {
          const res = await sendTelegramMessage(
            msg,
            settings.telegramBotToken,
            settings.telegramChatId
          );
          if (res.ok) {
            toast.success("Telegram kanal/guruhga e'lon yuborildi!");
          } else {
            toast.error(`Telegramga yuborishda xato: ${res.error}`);
          }
        } else {
          // Open telegram share
          const shareText = msg.replace(/<[^>]*>/g, "");
          window.open(
            `https://t.me/share/url?url=&text=${encodeURIComponent(shareText)}`,
            "_blank"
          );
          toast.info("Telegram ulashish oynasi ochildi");
        }
      }

      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="p-4 border-b bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🥚</span>
            <div>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                Tuxum Kunlik Narxlari
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 border border-amber-500/30">
                  Bugungi Birja
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                Ertalabki narxni kiritish — bir zumda Kassa, Web sayt va Telegram botda yangilanadi
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {/* Price inputs card */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-500 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                Bugungi rasmiy narxlar
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">
                {new Date().toLocaleDateString("uz-UZ")}
              </span>
            </div>

            {/* D1 */}
            <div className="flex items-center justify-between gap-3 bg-card/80 p-2.5 rounded-lg border">
              <div className="min-w-0">
                <div className="font-semibold text-xs flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Tuxum D1
                </div>
                <div className="text-[11px] text-muted-foreground">Eng kattasi</div>
              </div>
              <div className="flex items-center gap-1.5 w-36 shrink-0">
                <Input
                  type="number"
                  value={d1Price}
                  onChange={(e) => setD1Price(e.target.value)}
                  placeholder="43000"
                  className="h-8 text-right font-mono font-bold text-xs"
                />
                <span className="text-xs text-muted-foreground shrink-0">so'm</span>
              </div>
            </div>

            {/* D2 */}
            <div className="flex items-center justify-between gap-3 bg-card/80 p-2.5 rounded-lg border">
              <div className="min-w-0">
                <div className="font-semibold text-xs flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  Tuxum D2
                </div>
                <div className="text-[11px] text-muted-foreground">O'rtachasi</div>
              </div>
              <div className="flex items-center gap-1.5 w-36 shrink-0">
                <Input
                  type="number"
                  value={d2Price}
                  onChange={(e) => setD2Price(e.target.value)}
                  placeholder="42000"
                  className="h-8 text-right font-mono font-bold text-xs"
                />
                <span className="text-xs text-muted-foreground shrink-0">so'm</span>
              </div>
            </div>

            {/* D3 */}
            <div className="flex items-center justify-between gap-3 bg-card/80 p-2.5 rounded-lg border">
              <div className="min-w-0">
                <div className="font-semibold text-xs flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Tuxum D3
                </div>
                <div className="text-[11px] text-muted-foreground">Eng kichigi</div>
              </div>
              <div className="flex items-center gap-1.5 w-36 shrink-0">
                <Input
                  type="number"
                  value={d3Price}
                  onChange={(e) => setD3Price(e.target.value)}
                  placeholder="41000"
                  className="h-8 text-right font-mono font-bold text-xs"
                />
                <span className="text-xs text-muted-foreground shrink-0">so'm</span>
              </div>
            </div>
          </div>

          {/* Explanation note */}
          <div className="rounded-lg border bg-muted/30 p-2.5 text-[11px] text-muted-foreground space-y-1">
            <div className="font-medium text-foreground flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              To'liq real-vaqt integratsiyasi:
            </div>
            <div>
              1. Kassir yo'lda savdo qilganda kassada avtomatik shu narx uriladi.
            </div>
            <div>
              2. Do'konchilar Telegram botdan narxni ko'rib, buyurtma bera oladi.
            </div>
            <div>
              3. Web sayt va APK dagi barcha skladlarda narx bir vaqtda yangilanadi.
            </div>
          </div>

          {/* History list */}
          {history.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <History className="h-3 w-3" />
                So'nggi narxlar tarixi
              </div>
              <div className="rounded-lg border divide-y max-h-36 overflow-y-auto text-xs font-mono">
                {history.slice(0, 5).map((h, i) => (
                  <div key={i} className="p-2 flex items-center justify-between bg-card/40">
                    <span className="text-[11px] text-muted-foreground">{h.dateStr}</span>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span>D1: <b>{fmtMoney(h.d1)}</b></span>
                      <span>D2: <b>{fmtMoney(h.d2)}</b></span>
                      <span>D3: <b>{fmtMoney(h.d3)}</b></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="p-3 border-t bg-muted/20 flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto text-xs"
            onClick={() => onOpenChange(false)}
          >
            Bekor qilish
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto text-xs border-sky-500/40 text-sky-400 hover:bg-sky-500/10 gap-1.5"
            disabled={saving}
            onClick={() => handleSave(true)}
          >
            <Send className="h-3.5 w-3.5 text-sky-400" />
            <span>Saqlash va Telegramga e'lon</span>
          </Button>
          <Button
            size="sm"
            className="w-full sm:w-auto text-xs bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            disabled={saving}
            onClick={() => handleSave(false)}
          >
            {saving ? "Saqlanmoqda..." : "Faqat Saqlash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
