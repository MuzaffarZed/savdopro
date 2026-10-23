import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Minus, Trash2, ScanBarcode, Package, Loader2, Wifi, WifiOff, CloudUpload, Printer, ShoppingCart, ArrowUpDown, X, RotateCcw, AlertTriangle, Clock, Pause, Play, Bell, MessageSquare, Settings as SettingsIcon, Percent } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import { fmtMoney, fmtNum, newIdempotencyKey } from "@/lib/format";
import { enqueueSale, listQueued, subscribeQueue, syncQueue, retryQueued, removeQueued, type QueuedSale } from "@/lib/offline-queue";
import {
  saveHoldCart,
  listHoldCarts,
  deleteHoldCart,
  subscribeHoldCarts,
  type HoldCart,
  cacheLocalStock,
  getLocalStock,
  cacheLocalCustomers,
  getLocalCustomers,
  cacheLocalWarehouses,
  getLocalWarehouses,
  applyLocalOptimisticStockSale,
} from "@/lib/offline-store";
import {
  dispatchNasiyaSaleNotification,
  dispatchRegularSaleNotification,
  type NasiyaNotificationSettings,
} from "@/lib/nasiya-notify";
import {
  formatSaleReceiptMessage,
  enqueueAndSendTelegramMessage,
  getCustomerTelegramLink,
} from "@/lib/telegram-service";
import { NasiyaSettingsDialog } from "@/components/nasiya/NasiyaSettingsDialog";
import { DailyEggPriceDialog } from "@/components/pos/DailyEggPriceDialog";
import { printReceipt } from "@/lib/receipt";
import { useActiveShift } from "@/lib/use-active-shift";
import { usePricelist } from "@/lib/use-pricelist";
import { cn } from "@/lib/utils";
import { smartSearchMatch, toCyrillic, toLatin, matchPhone } from "@/lib/search-utils";

export const Route = createFileRoute("/_app/pos")({ component: POSPage });

export const isQopProduct = (name: string, category?: string | null) => {
  const n = (name || "").toLowerCase();
  const c = (category || "").toLowerCase();
  return c.includes("parashok") || n.includes("parashok") || n.includes("aprel") || n.includes("avtomat") || n.includes("nixol");
};

export const getProductUnit = (name: string, category?: string | null) => {
  if (isQopProduct(name, category)) return "qop";
  return "dona";
};

interface CartItem {
  product_id: string;
  name: string;
  quantity: number;
  sell_price: number;
  available: number;
  category?: string | null;
  unit?: string;
}

function POSPage() {
  const { profile, isSuperAdmin, user } = useAuth();
  const qc = useQueryClient();
  const { defaultMarkup, overrides } = usePricelist();
  // activeShift is bound to the selected warehouse so one branch/sklad shift is shared by admin and sellers.
  const [warehouseId, setWarehouseId] = useState<string>("");
  const { data: activeShift, isLoading: shiftLoading } = useActiveShift(warehouseId);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState<string>("walkin");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "click" | "split">("cash");
  const [cashPaid, setCashPaid] = useState("");
  const [clickPaid, setClickPaid] = useState("");
  const [autoPrint, setAutoPrint] = useState<boolean>(() => typeof window !== "undefined" && localStorage.getItem("nexus-auto-print") === "1");
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [queued, setQueued] = useState<QueuedSale[]>([]);
  const [category, setCategory] = useState<string>("all");
  const [sort, setSort] = useState<"name" | "price-asc" | "price-desc" | "qty-desc">("name");
  const [cartOpen, setCartOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [holdCarts, setHoldCarts] = useState<HoldCart[]>([]);
  const [holdListOpen, setHoldListOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eggPriceOpen, setEggPriceOpen] = useState(false);
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState<string>("");

  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    window.addEventListener("online", upd); window.addEventListener("offline", upd);
    const refresh = () => { void listQueued().then(setQueued); };
    refresh();
    const unsub = subscribeQueue(refresh);

    const refreshHold = () => { void listHoldCarts().then(setHoldCarts); };
    refreshHold();
    const unsubHold = subscribeHoldCarts(refreshHold);

    return () => {
      window.removeEventListener("online", upd);
      window.removeEventListener("offline", upd);
      unsub();
      unsubHold();
    };
  }, []);

  useEffect(() => { localStorage.setItem("nexus-auto-print", autoPrint ? "1" : "0"); }, [autoPrint]);

  const { data: warehouses } = useQuery({
    queryKey: ["warehouses-pos"],
    queryFn: async () => {
      try {
        let q = supabase.from("warehouses").select("id,name,type,branch_id").is("deleted_at", null);
        if (!isSuperAdmin && profile?.branch_id) q = q.eq("branch_id", profile.branch_id);
        else q = q.eq("type", "branch");
        const res = await q;
        if (res.error) throw res.error;
        void cacheLocalWarehouses(res.data ?? []);
        return res.data ?? [];
      } catch (err) {
        const local = await getLocalWarehouses();
        if (local && Array.isArray(local)) return local as Array<{ id: string; name: string; type: string; branch_id: string | null }>;
        throw err;
      }
    },
  });

  // Auto-pick first warehouse
  if (!warehouseId && warehouses && warehouses.length > 0) {
    setTimeout(() => setWarehouseId(warehouses[0].id), 0);
  }

  const { data: stock } = useQuery({
    queryKey: ["pos-stock", warehouseId],
    queryFn: async () => {
      if (!warehouseId) return [];
      try {
        const { data, error } = await supabase.from("inventory_batches").select("product_id,remaining,cost_price,products(name,category)").eq("warehouse_id", warehouseId).gt("remaining", 0);
        if (error) throw error;
        // Aggregate per product
        const map = new Map<string, { product_id: string; name: string; category: string | null; total: number; minCost: number; totalValue: number }>();
        (data ?? []).forEach((b) => {
          const p = b.products as unknown as { name: string; category: string | null } | null;
          const ex = map.get(b.product_id);
          const qty = Number(b.remaining);
          const cost = Number(b.cost_price);
          if (ex) { ex.total += qty; ex.totalValue += qty * cost; }
          else { map.set(b.product_id, { product_id: b.product_id, name: p?.name ?? "—", category: p?.category ?? null, total: qty, minCost: cost, totalValue: qty * cost }); }
        });
        const arr = Array.from(map.values());
        void cacheLocalStock(warehouseId, arr);
        return arr;
      } catch (err) {
        const local = await getLocalStock(warehouseId);
        if (local && Array.isArray(local)) return local as Array<{ product_id: string; name: string; category: string | null; total: number; minCost: number; totalValue: number }>;
        throw err;
      }
    },
    enabled: !!warehouseId,
  });

  // Markaziy narxnomadan sotuv narxini hisoblash (override yoki default markup)
  const sellPriceFor = (productId: string, avgCost: number) => {
    const ov = overrides[productId];
    if (ov?.price !== undefined) return Math.round(ov.price);
    const m = ov?.markup ?? defaultMarkup;
    return Math.round(avgCost * (1 + m / 100));
  };

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      try {
        const res = await supabase.from("customers").select("id,name,phone,balance,credit_limit").is("deleted_at", null).order("name");
        if (res.error) throw res.error;
        void cacheLocalCustomers(res.data ?? []);
        return res.data ?? [];
      } catch (err) {
        const local = await getLocalCustomers();
        if (local && Array.isArray(local)) return local as Array<{ id: string; name: string; phone?: string | null; balance: number; credit_limit?: number | null }>;
        throw err;
      }
    },
  });

  // Aqlli ikki alifboli (Lotin/Kirill) va shtrix-kodli qidiruv
  const filtered = useMemo(() => {
    if (!stock) return [];
    const q = search.trim();
    if (!q) return stock;
    return stock.filter((s) =>
      smartSearchMatch(s.name, q) ||
      (s.barcode && s.barcode.includes(q)) ||
      (s.category && smartSearchMatch(s.category, q))
    );
  }, [stock, search]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    (stock ?? []).forEach((s) => { if (s.category) set.add(s.category); });
    return Array.from(set).sort();
  }, [stock]);

  const visible = useMemo(() => {
    let arr = filtered;
    if (category !== "all") arr = arr.filter((s) => s.category === category);
    const out = [...arr];
    if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "price-asc") out.sort((a, b) => a.minCost - b.minCost);
    else if (sort === "price-desc") out.sort((a, b) => b.minCost - a.minCost);
    else if (sort === "qty-desc") out.sort((a, b) => b.total - a.total);
    return out;
  }, [filtered, category, sort]);

  const addToCart = (s: { product_id: string; name: string; category?: string | null; total: number; minCost: number; totalValue: number }) => {
    setCart((c) => {
      const ex = c.find((i) => i.product_id === s.product_id);
      if (ex) {
        if (ex.quantity + 1 > s.total) { toast.error("Qoldiq yetarli emas"); return c; }
        return c.map((i) => i.product_id === s.product_id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      const avgCost = s.total > 0 ? s.totalValue / s.total : s.minCost;
      const unit = getProductUnit(s.name, s.category);
      return [...c, { product_id: s.product_id, name: s.name, quantity: 1, sell_price: sellPriceFor(s.product_id, avgCost), available: s.total, category: s.category, unit }];
    });
  };

  const updateQty = (pid: string, delta: number) => setCart((c) => c.map((i) => i.product_id === pid ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i).filter((i) => i.quantity > 0));
  const setQty = (pid: string, q: number) => setCart((c) => c.map((i) => i.product_id === pid ? { ...i, quantity: Math.min(Math.max(q, 0), i.available) } : i));
  const updatePrice = (pid: string, price: number) => setCart((c) => c.map((i) => i.product_id === pid ? { ...i, sell_price: price } : i));
  const updateTotal = (pid: string, total: number) => setCart((c) => c.map((i) => {
    if (i.product_id !== pid) return i;
    const q = i.quantity > 0 ? i.quantity : 1;
    return { ...i, sell_price: Math.max(0, total / q) };
  }));
  const remove = (pid: string) => setCart((c) => c.filter((i) => i.product_id !== pid));

  const subtotal = cart.reduce((a, i) => a + i.quantity * i.sell_price, 0);
  const rawDiscount = Number(discountValue || 0);
  const discountAmount =
    discountType === "percent"
      ? Math.round((subtotal * Math.min(100, Math.max(0, rawDiscount))) / 100)
      : Math.min(subtotal, Math.max(0, rawDiscount));
  const total = Math.max(0, subtotal - discountAmount);

  const applyRounding = () => {
    if (subtotal <= 0) return;
    const remainder = subtotal % 1000;
    if (remainder > 0) {
      setDiscountType("amount");
      setDiscountValue(String(remainder));
      toast.success("1000 so'mga yaxlitlandi", { description: `${fmtMoney(remainder)} chegirma kiritildi` });
    } else {
      toast.message("Summa allaqachon yaxlit (1000 so'mga karrali)");
    }
  };

  const isSplit = paymentMethod === "split";
  const splitCash = Number(cashPaid || 0);
  const splitClick = Number(clickPaid || 0);
  const paid = isSplit ? splitCash + splitClick : Number(amountPaid || total);
  const debt = Math.max(0, total - paid);

  const checkout = useMutation({
    mutationFn: async () => {
      if (!activeShift) throw new Error("Avval smena oching");
      const branch = warehouses?.find((w) => w.id === warehouseId);
      if (!branch?.branch_id) throw new Error("Filial sklatdan foydalaning");
      if (cart.length === 0) throw new Error("Savat bo'sh");
      if (cart.some((i) => !(i.quantity > 0))) throw new Error("Savatda miqdori 0 bo'lgan mahsulot bor");
      if (customerId === "walkin") throw new Error("Sotuv uchun mijoz tanlang");
      const idem = newIdempotencyKey();

      const discountRatio = subtotal > 0 && discountAmount > 0 ? total / subtotal : 1;
      const payloadItems = cart.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        sell_price: discountAmount > 0 ? Math.max(0, Math.round(i.sell_price * discountRatio)) : i.sell_price,
      }));
      if (discountAmount > 0 && payloadItems.length > 0) {
        const sumCalc = payloadItems.reduce((acc, it) => acc + it.quantity * it.sell_price, 0);
        const drift = total - sumCalc;
        if (drift !== 0) {
          payloadItems[0].sell_price += Math.round(drift / payloadItems[0].quantity);
        }
      }

      const payload: QueuedSale["payload"] = {
        _branch_id: branch.branch_id,
        _warehouse_id: warehouseId,
        _customer_id: customerId === "walkin" ? null : customerId,
        _items: payloadItems,
        _amount_paid: paid,
        _payment_method: isSplit ? (splitCash >= splitClick ? "cash" : "click") : (paymentMethod as "cash" | "click"),
        _user_id: user!.id,
        _idempotency_key: idem,
        ...(isSplit ? { _cash_paid: splitCash, _click_paid: splitClick } : {}),
      };

      const snapshot = {
        items: cart.map((i) => ({
          name: i.name,
          qty: i.quantity,
          price: i.sell_price,
          unit: i.unit || getProductUnit(i.name, i.category),
        })),
        subtotal,
        discount: discountAmount,
        total, paid, debt, method: paymentMethod as "cash" | "click" | "split",
        customer: customerId === "walkin" ? undefined : (customers ?? []).find((c) => c.id === customerId)?.name,
        branch: branch ? warehouses?.find((w) => w.id === warehouseId)?.name : undefined,
      };

      const queueLocally = async () => {
        await enqueueSale({
          id: idem,
          created_at: Date.now(),
          payload,
          status: "pending",
          attempts: 0,
        });
      };

      // Offline branch — queue locally
      if (!navigator.onLine) {
        await queueLocally();
        return { offline: true as const, snapshot, idem };
      }

      try {
        const { error } = await supabase.rpc("process_sale", payload as never);
        if (error) {
          // Network / 5xx style errors → queue for replay; idempotency key
          // protects against double-commit if the server actually received it.
          const msg = (error.message ?? "").toLowerCase();
          const transient =
            msg.includes("failed to fetch") ||
            msg.includes("network") ||
            msg.includes("timeout") ||
            msg.includes("fetch") ||
            (error as { code?: string }).code === "503" ||
            (error as { code?: string }).code === "504";
          if (transient) {
            await queueLocally();
            return { offline: true as const, snapshot, deferred: true as const, idem };
          }
          throw error;
        }
        return { offline: false as const, snapshot, idem };
      } catch (e) {
        const msg = String((e as Error)?.message ?? e).toLowerCase();
        if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("load failed")) {
          await queueLocally();
          return { offline: true as const, snapshot, deferred: true as const, idem };
        }
        throw e;
      }
    },
    onSuccess: (res) => {
      if (res.offline) {
        toast.success(
          "deferred" in res && res.deferred ? "Tarmoq xato — navbatga qo'shildi" : "Offline saqlandi",
          { description: "Internet kelganda avtomatik yuboriladi" }
        );
      } else {
        toast.success("Sotuv yakunlandi", { description: debt > 0 ? `Qarz: ${fmtMoney(debt)}` : "To'liq to'landi" });
      }
      if (autoPrint) {
        printReceipt({
          shop: "SavdoPro",
          branch: res.snapshot.branch,
          date: new Date(),
          cashier: profile?.name,
          customer: res.snapshot.customer,
          items: res.snapshot.items,
          subtotal: res.snapshot.subtotal,
          discount: res.snapshot.discount,
          total: res.snapshot.total,
          paid: res.snapshot.paid,
          debt: res.snapshot.debt,
          method: res.snapshot.method === "cash" ? "Naqd" : res.snapshot.method === "click" ? "Click" : `Naqd ${fmtMoney(splitCash)} + Click ${fmtMoney(splitClick)}`,
        });
      }

      // 1. Optimistik lokal qoldiqni kamaytirish
      void applyLocalOptimisticStockSale(
        warehouseId,
        cart.map((c) => ({ product_id: c.product_id, quantity: c.quantity }))
      );

      // 2. Avtomatik Chek (Telegram Lichka & SMS: Nasiya yoki Oddiy savdo)
      if (customerId && customerId !== "walkin") {
        const custObj = customers?.find((c) => c.id === customerId);
        const curBal = Number(custObj?.balance || 0);
        const businessName = res.snapshot.branch || "SavdoPro";

        // Telegram Engine v2 (Xusniddin 2002 Section 4 Exact Template)
        void (async () => {
          let directSent = false;
          try {
            const link = await getCustomerTelegramLink(customerId);
            if (link.linkStatus === "linked" && link.telegramChatId) {
              const saleText = formatSaleReceiptMessage(
                {
                  saleNumber: res.idem.slice(0, 8),
                  date: new Date(),
                  items: res.snapshot.items.map((i) => ({
                    name: i.name,
                    quantity: i.qty,
                    unitPrice: i.price,
                    unit: i.unit || getProductUnit(i.name),
                    lineTotal: i.qty * i.price,
                  })),
                  saleTotal: total,
                  salePaid: paid,
                  saleDebt: debt,
                  previousBalance: curBal,
                  newDebt: debt,
                  currentBalance: Math.max(0, curBal + total - paid),
                  paymentMethod: paymentMethod === "cash" ? "Naqd" : paymentMethod === "click" ? "Click" : "Aralash",
                  splitCash: splitCash > 0 ? splitCash : undefined,
                  splitClick: splitClick > 0 ? splitClick : undefined,
                  discountAmount: discountVal > 0 ? discountVal : undefined,
                },
                businessName
              );

              await enqueueAndSendTelegramMessage({
                customerId,
                customerName: custObj?.name,
                saleId: res.idem,
                eventType: "sale",
                telegramChatId: link.telegramChatId,
                formattedText: saleText,
                idempotencyKey: `sale-${res.idem}`,
              });
              directSent = true;
            }
          } catch (tgErr) {
            console.warn("Telegram check dispatch error:", tgErr);
          }

          // Agar mijoz lichkasiga to'g'ridan-to'g'ri Telegram yuborilmagan bo'lsa, zaxira nasiya xabari
          if (!directSent) {
            if (debt > 0) {
              void dispatchNasiyaSaleNotification({
                shopName: businessName,
                branchName: res.snapshot.branch,
                cashierName: profile?.name,
                customerName: custObj?.name,
                customerPhone: (custObj as { phone?: string | null })?.phone ?? undefined,
                receiptNo: res.idem,
                items: res.snapshot.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
                totalSale: total,
                amountPaid: paid,
                previousDebt: curBal,
                newDebtAdded: debt,
                finalDebt: curBal + debt,
                paymentMethod: paymentMethod === "cash" ? "Naqd" : paymentMethod === "click" ? "Click" : "Aralash",
              });
            } else {
              void dispatchRegularSaleNotification({
                shopName: businessName,
                branchName: res.snapshot.branch,
                cashierName: profile?.name,
                customerName: custObj?.name,
                customerPhone: (custObj as { phone?: string | null })?.phone ?? undefined,
                receiptNo: res.idem,
                items: res.snapshot.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
                totalSale: total,
                amountPaid: paid,
                paymentMethod: paymentMethod === "cash" ? "Naqd" : paymentMethod === "click" ? "Click" : "Aralash",
                currentDebtBalance: curBal,
              });
            }
          }
        })();
      }

      setCart([]); setAmountPaid(""); setCashPaid(""); setClickPaid(""); setCustomerId("walkin"); setDiscountValue("");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error("Xato", { description: e.message }),
  });

  const handleHoldCart = async () => {
    if (cart.length === 0) {
      toast.message("Savat bo'sh — kutishga olish uchun avval mahsulot tanlang");
      return;
    }
    const custObj = customers?.find((c) => c.id === customerId);
    await saveHoldCart({
      label: "",
      customer_id: customerId,
      customer_name: custObj?.name,
      items: cart.map((c) => ({
        product_id: c.product_id,
        name: c.name,
        qty: c.quantity,
        price: c.sell_price,
        maxQty: c.available,
      })),
      total,
      amount_paid: amountPaid,
      payment_method: paymentMethod,
      cash_paid: cashPaid,
      click_paid: clickPaid,
      discount_type: discountType,
      discount_val: discountValue,
    });
    setCart([]);
    setAmountPaid("");
    setCashPaid("");
    setClickPaid("");
    setCustomerId("walkin");
    setDiscountValue("");
    toast.success("Savat kutishga olindi (F6)", {
      description: "Navbatdagi xaridorga xizmat ko'rsatishingiz mumkin",
    });
  };

  const handleRestoreCart = async (h: HoldCart) => {
    if (cart.length > 0) {
      const custObj = customers?.find((c) => c.id === customerId);
      await saveHoldCart({
        label: "",
        customer_id: customerId,
        customer_name: custObj?.name,
        items: cart.map((c) => ({
          product_id: c.product_id,
          name: c.name,
          qty: c.quantity,
          price: c.sell_price,
          maxQty: c.available,
        })),
        total,
        amount_paid: amountPaid,
        payment_method: paymentMethod,
        cash_paid: cashPaid,
        click_paid: clickPaid,
        discount_type: discountType,
        discount_val: discountValue,
      });
      toast.message("Amaldagi savat ham kutishga olindi");
    }

    setCart(
      h.items.map((i) => ({
        product_id: i.product_id,
        name: i.name,
        quantity: i.qty,
        sell_price: i.price,
        available: i.maxQty ?? 9999,
      }))
    );
    setCustomerId(h.customer_id || "walkin");
    setAmountPaid(h.amount_paid || "");
    setPaymentMethod(h.payment_method || "cash");
    setCashPaid(h.cash_paid || "");
    setClickPaid(h.click_paid || "");
    if (h.discount_type) setDiscountType(h.discount_type);
    if (h.discount_val !== undefined) setDiscountValue(h.discount_val);
    await deleteHoldCart(h.id);
    setHoldListOpen(false);
    toast.success("Savat tiklandi", { description: `${h.items.length} ta mahsulot yuklandi` });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F6") {
        e.preventDefault();
        void handleHoldCart();
      } else if (e.key === "F7") {
        e.preventDefault();
        setHoldListOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cart, customerId, amountPaid, paymentMethod, cashPaid, clickPaid, total]);

  // Hardware USB/Bluetooth Barcode Scanner listener
  useEffect(() => {
    let buffer = "";
    let lastKeyTime = Date.now();

    const onBarcodeInput = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (isInput && target.id !== "barcode-catch") return;

      const now = Date.now();
      const diff = now - lastKeyTime;
      lastKeyTime = now;

      if (e.key === "Enter") {
        if (buffer.length >= 2) {
          const raw = buffer.trim();
          const match = (stock ?? []).find(
            (s) => s.name.toLowerCase() === raw.toLowerCase() || s.product_id === raw
          );
          if (match) {
            addToCart(match);
            toast.success(`${match.name} savatga qo'shildi`, { description: `Skanerlandi: ${raw}` });
          }
          buffer = "";
        }
      } else if (e.key.length === 1) {
        if (diff > 150) {
          buffer = "";
        }
        buffer += e.key;
      }
    };

    window.addEventListener("keydown", onBarcodeInput);
    return () => window.removeEventListener("keydown", onBarcodeInput);
  }, [stock]);

  const manualSync = async () => {
    const r = await syncQueue();
    if (r.ok > 0) toast.success(`${r.ok} ta sotuv sinxronlandi`);
    if (r.failed > 0) toast.message(`${r.failed} ta qayta urinish navbatda`);
    if (r.blocked > 0) toast.error(`${r.blocked} ta bloklangan — tekshiring`);
    if (r.ok === 0 && r.failed === 0 && r.blocked === 0) toast.message("Kutilayotgan sotuv yo'q");
    qc.invalidateQueries();
  };

  const blockedCount = queued.filter((q) => q.status === "blocked").length;

  return (
    <>
      <PageHeader title="POS — Sotuv" description={isSuperAdmin ? "FIFO bo'yicha avtomatik tannarx hisoblanadi" : "Mahsulot tanlang va sotuvni rasmiylashtiring"} action={
        <div className="flex items-center gap-1.5 flex-wrap">
          {activeShift ? (
            <Link to="/shifts" className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] sm:text-xs text-success border-success/30 bg-success/5">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> Smena ochiq
            </Link>
          ) : (
            <Link to="/shifts" className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] sm:text-xs text-warning border-warning/30 bg-warning/5">
              ⚠ Smena yopiq
            </Link>
          )}
          <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] sm:text-xs ${online ? "text-success" : "text-warning"}`} title={online ? "Onlayn" : "Oflayn"}>
            {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            <span className="hidden xs:inline sm:inline">{online ? "Onlayn" : "Oflayn"}</span>
          </div>
          {holdCarts.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setHoldListOpen(true)} title="Kutishdagi savatlar (F7)">
              <Pause className="h-3.5 w-3.5" />
              <span>Kutishda ({holdCarts.length})</span>
            </Button>
          )}
          {queued.length > 0 && (
            <Button size="sm" variant={blockedCount > 0 ? "destructive" : "outline"} onClick={() => setQueueOpen(true)}>
              <CloudUpload className="h-3.5 w-3.5" />
              <span>Navbat ({queued.length})</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs font-semibold border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
            onClick={() => setEggPriceOpen(true)}
            title="Tuxum kunlik birja narxlarini belgilash (D1, D2, D3)"
          >
            <span>🥚</span>
            <span className="hidden sm:inline">Tuxum narxlari</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs font-medium" onClick={() => setSettingsOpen(true)} title="Nasiya Xabarnomalari Sozlamasi">
            <Bell className="h-3.5 w-3.5 text-primary" />
            <span className="hidden sm:inline">Nasiya xabarlari</span>
          </Button>
          {warehouses && warehouses.length > 1 ? (
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-[140px] sm:w-[180px] h-8"><SelectValue placeholder="Sklad" /></SelectTrigger>
              <SelectContent>{warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          ) : null}
        </div>
      } />
      {!shiftLoading && !activeShift && (
        <div className="px-4 lg:px-6 pt-4">
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm flex items-center justify-between">
            <span>Sotuv qilish uchun avval smena (kassa) oching.</span>
            <Button size="sm" variant="outline" asChild><Link to="/shifts">Smena boshlash</Link></Button>
          </div>
        </div>
      )}
      <div className="p-3 lg:p-6 grid gap-3 lg:gap-4 lg:grid-cols-[1fr_380px] pb-28 lg:pb-6">
        {/* Products */}
        <div className="space-y-3">
          <div className="relative rounded-xl border border-border/60 bg-card/75 backdrop-blur-md p-1 flex items-center shadow-sm">
            <ScanBarcode className="ml-2.5 h-4 w-4 text-primary shrink-0" />
            <Input
              className="border-0 bg-transparent shadow-none pl-2 pr-16 h-10 text-base sm:text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              placeholder="Mahsulot nomi yoki shtrix-kod skanerlang (Lotin / Kirill)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length > 0) {
                  const q = search.trim();
                  const exact = filtered.find((p) => p.barcode === q) || filtered[0];
                  if (exact) {
                    addToCart(exact);
                    toast.success(`Savatga qo'shildi: ${exact.name}`, { duration: 1500 });
                    setSearch("");
                  }
                }
              }}
            />
            {search && (
              <button onClick={() => setSearch("")} className="mr-2 text-muted-foreground hover:text-foreground p-1" aria-label="Tozalash">
                <X className="h-4 w-4" />
              </button>
            )}
            <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
              <SelectTrigger className="h-8 w-8 border-0 bg-accent/40 hover:bg-accent p-0 [&>svg]:hidden justify-center rounded-lg" aria-label="Saralash"><ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" /></SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="name">Nomi (A→Z)</SelectItem>
                <SelectItem value="price-asc">Narx ↑</SelectItem>
                <SelectItem value="price-desc">Narx ↓</SelectItem>
                <SelectItem value="qty-desc">Qoldiq ↓</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {/* Tez eslab qolish - Tezkor tovarlar paneli */}
          {!search && stock && stock.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 py-0.5 scrollbar-none text-xs">
              <span className="text-[11px] text-muted-foreground shrink-0 font-medium flex items-center gap-1">
                ⚡ Tezkor:
              </span>
              {stock.slice(0, 6).map((item) => (
                <button
                  key={`quick-${item.product_id}`}
                  onClick={() => {
                    addToCart(item);
                    toast.success(`+1 ${item.name}`, { duration: 1200 });
                  }}
                  className="shrink-0 px-2.5 py-1 rounded-lg bg-card/80 hover:bg-primary/20 border border-border/50 hover:border-primary/40 text-foreground transition-all flex items-center gap-1.5 active:scale-95 shadow-sm text-xs"
                >
                  <span className="truncate max-w-[110px]">{item.name}</span>
                  <span className="text-[10px] text-primary font-mono font-semibold">{fmtMoney(item.minCost)}</span>
                </button>
              ))}
            </div>
          )}
          {/* Category chips */}
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 scrollbar-none">
            <button
              onClick={() => setCategory("all")}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                category === "all"
                  ? "border-primary/50 bg-primary/15 text-primary font-semibold shadow-sm ring-1 ring-primary/20"
                  : "border-border/60 bg-card/60 backdrop-blur text-muted-foreground hover:text-foreground hover:border-primary/30"
              )}
            >
              Barchasi · {filtered.length}
            </button>
            {categories.map((c) => {
              const count = filtered.filter((s) => s.category === c).length;
              const isActive = category === c;
              return (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                    isActive
                      ? "border-primary/50 bg-primary/15 text-primary font-semibold shadow-sm ring-1 ring-primary/20"
                      : "border-border/60 bg-card/60 backdrop-blur text-muted-foreground hover:text-foreground hover:border-primary/30"
                  )}
                >
                  {c} · {count}
                </button>
              );
            })}
          </div>
          <div className="pos-products-grid">
            {visible.map((s) => {
              const inCart = cart.find((i) => i.product_id === s.product_id);
              const unitPrice = sellPriceFor(s.product_id, s.total > 0 ? s.totalValue / s.total : s.minCost);
              return (
                <button
                  key={s.product_id}
                  onClick={() => addToCart(s)}
                  className={cn(
                    "group relative flex flex-col justify-between rounded-xl border p-3 text-left transition-all duration-200 overflow-hidden",
                    "bg-card/75 backdrop-blur-md border-border/60 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 active:scale-[0.97]",
                    inCart && "border-primary/80 ring-2 ring-primary/30 shadow-lg shadow-primary/10 bg-primary/[0.04]"
                  )}
                >
                  {inCart && (
                    <div className="absolute -top-6 -right-6 h-14 w-14 rounded-full bg-primary/15 blur-xl pointer-events-none" />
                  )}

                  {inCart && (
                    <span className="absolute top-2 right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-primary-foreground px-1.5 text-[10px] font-bold shadow-md shadow-primary/30 animate-in zoom-in-75">
                      {inCart.quantity}
                    </span>
                  )}

                  <div>
                    <div className="flex items-center justify-between gap-1.5 mb-2">
                      <div className="h-7 w-7 rounded-lg bg-muted/60 border border-border/50 flex items-center justify-center text-muted-foreground group-hover:text-foreground group-hover:scale-105 transition-all">
                        <Package className="h-3.5 w-3.5" />
                      </div>
                      {/* Stock health indicator */}
                      {(() => {
                        const isQop = isQopProduct(s.name, s.category);
                        const unitName = isQop ? "qop" : "dona";
                        if (s.total <= 0) {
                          return (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                              Tugagan
                            </span>
                          );
                        }
                        if (s.total <= 5) {
                          return (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                              Oz: {fmtNum(s.total)} {unitName}
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded border border-border/50">
                            {fmtNum(s.total)} {unitName}
                          </span>
                        );
                      })()}
                    </div>

                    <div className="text-[13px] sm:text-sm font-semibold text-foreground line-clamp-2 leading-tight group-hover:text-primary transition-colors">
                      {s.name}
                    </div>

                    {/* Maxsus tovar belgilari (Parashok qopda va Tuxum kunlik narx) */}
                    {isQopProduct(s.name, s.category) && (
                      <div className="text-[10px] text-amber-500 font-medium mt-1 flex items-center gap-1">
                        📦 Qopda (1 dona = 1 qop{s.name.includes("250") ? " · 24 ta" : s.name.includes("900") ? " · 10 ta" : s.name.includes("1.8") ? " · 6 ta" : ""})
                      </div>
                    )}
                    {/tuxum|\bd1\b|\bd2\b|\bd3\b|bedana/i.test(s.name) && (
                      <div className="text-[10px] text-amber-400 font-medium mt-1 flex items-center gap-1">
                        🥚 Kunlik yangi narx
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-1 pt-2 border-t border-border/40">
                    <span className="inline-flex items-center rounded-md bg-secondary/80 px-2 py-0.5 text-[11px] sm:text-xs font-mono font-semibold text-foreground border border-border/60">
                      {fmtMoney(unitPrice)}
                    </span>
                    {s.category && (
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground truncate max-w-[50%] font-medium">
                        {s.category}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            {visible.length === 0 && <div className="col-span-full py-12 text-center text-sm text-muted-foreground">{warehouseId ? "Mahsulot topilmadi" : "Avval sklad tanlang"}</div>}
          </div>
        </div>

        {/* Cart — desktop sidebar */}
        <div className="hidden lg:flex rounded-xl border border-border/70 bg-card/85 backdrop-blur-md shadow-xl flex-col h-fit sticky top-20 max-h-[calc(100vh-7rem)]">
          <CartPanel
            cart={cart} updateQty={updateQty} setQty={setQty} updatePrice={updatePrice} updateTotal={updateTotal} remove={remove}
            customerId={customerId} setCustomerId={setCustomerId} customers={customers ?? []}
            paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
            amountPaid={amountPaid} setAmountPaid={setAmountPaid}
            cashPaid={cashPaid} setCashPaid={setCashPaid} clickPaid={clickPaid} setClickPaid={setClickPaid}
            subtotal={subtotal} discountType={discountType} setDiscountType={setDiscountType}
            discountValue={discountValue} setDiscountValue={setDiscountValue} discountAmount={discountAmount}
            onApplyRounding={applyRounding}
            total={total} debt={debt} autoPrint={autoPrint} setAutoPrint={setAutoPrint}
            online={online} warehouseId={warehouseId}
            isPending={checkout.isPending} onCheckout={() => checkout.mutate()}
            onHoldCart={handleHoldCart} heldCount={holdCarts.length} onOpenHeld={() => setHoldListOpen(true)}
          />
        </div>
      </div>

      {/* Mobile sticky checkout bar */}
      <div className="lg:hidden fixed bottom-[calc(3.25rem+env(safe-area-inset-bottom,0px))] left-0 right-0 z-30 border-t bg-background/95 backdrop-blur px-3 py-2 flex items-center gap-2 shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Jami</div>
          <div className="font-mono font-semibold text-base truncate">{fmtMoney(total)}</div>
        </div>
        <Button size="lg" disabled={cart.length === 0} onClick={() => setCartOpen(true)} className="relative">
          <ShoppingCart className="h-4 w-4" /> Savat
          {cart.length > 0 && <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-warning-foreground">{cart.length}</span>}
        </Button>
      </div>

      {/* Mobile cart sheet */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="lg:hidden p-0 h-[92vh] flex flex-col rounded-t-xl">
          <SheetHeader className="px-4 py-3 border-b shrink-0 flex flex-row items-center justify-between">
            <SheetTitle className="text-base">Savat ({cart.length})</SheetTitle>
            <div className="flex items-center gap-1.5 pr-8">
              {holdCarts.length > 0 && (
                <Button size="sm" variant="secondary" className="h-7 text-xs px-2" onClick={() => { setCartOpen(false); setHoldListOpen(true); }} title="Kutishdagi savatlar (F7)">
                  <Pause className="h-3 w-3 mr-1" /> ({holdCarts.length})
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2"
                onClick={() => { handleHoldCart(); setCartOpen(false); }}
                disabled={cart.length === 0}
                title="Savatni kutishga olish (F6)"
              >
                <Pause className="h-3 w-3 mr-1" /> Kutish (F6)
              </Button>
            </div>
          </SheetHeader>
          <CartPanel
            cart={cart} updateQty={updateQty} setQty={setQty} updatePrice={updatePrice} updateTotal={updateTotal} remove={remove}
            customerId={customerId} setCustomerId={setCustomerId} customers={customers ?? []}
            paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
            amountPaid={amountPaid} setAmountPaid={setAmountPaid}
            cashPaid={cashPaid} setCashPaid={setCashPaid} clickPaid={clickPaid} setClickPaid={setClickPaid}
            subtotal={subtotal} discountType={discountType} setDiscountType={setDiscountType}
            discountValue={discountValue} setDiscountValue={setDiscountValue} discountAmount={discountAmount}
            onApplyRounding={applyRounding}
            total={total} debt={debt} autoPrint={autoPrint} setAutoPrint={setAutoPrint}
            online={online} warehouseId={warehouseId}
            isPending={checkout.isPending}
            onCheckout={() => { checkout.mutate(undefined, { onSuccess: () => setCartOpen(false) }); }}
            onHoldCart={() => { handleHoldCart(); setCartOpen(false); }}
            heldCount={holdCarts.length}
            onOpenHeld={() => { setCartOpen(false); setHoldListOpen(true); }}
            hideHeader
          />
        </SheetContent>
      </Sheet>

      {/* Offline queue inspector */}
      <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b shrink-0">
            <SheetTitle className="text-base flex items-center gap-2">
              <CloudUpload className="h-4 w-4" /> Sinxron navbati ({queued.length})
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={manualSync} disabled={!online} className="flex-1">
              <CloudUpload className="h-3.5 w-3.5" /> Hammasini sinxronlash
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {queued.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">Navbat bo'sh — barcha sotuvlar yuborildi</div>
            )}
            {queued.map((q) => {
              const items = q.payload._items.length;
              const total = q.payload._items.reduce((a, i) => a + i.quantity * i.sell_price, 0);
              const statusColor =
                q.status === "blocked" ? "border-destructive/40 bg-destructive/5" :
                q.status === "syncing" ? "border-primary/40 bg-primary/5" :
                "border-warning/30 bg-warning/5";
              const StatusIcon =
                q.status === "blocked" ? AlertTriangle :
                q.status === "syncing" ? Loader2 : Clock;
              return (
                <div key={q.id} className={cn("rounded-lg border p-3 text-sm space-y-2", statusColor)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusIcon className={cn("h-4 w-4 shrink-0", q.status === "syncing" && "animate-spin")} />
                      <div className="min-w-0">
                        <div className="font-medium">{items} ta mahsulot · {fmtMoney(total)}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(q.created_at).toLocaleString("uz-UZ")} · urinish {q.attempts}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider font-semibold shrink-0">
                      {q.status === "blocked" ? "Bloklangan" : q.status === "syncing" ? "Yuborilmoqda" : "Kutilmoqda"}
                    </span>
                  </div>
                  {q.error && (
                    <div className="text-[11px] text-destructive line-clamp-3 font-mono bg-background/50 p-1.5 rounded">{q.error}</div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => retryQueued(q.id)} disabled={!online || q.status === "syncing"}>
                      <RotateCcw className="h-3 w-3" /> Qayta urinish
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={async () => {
                      if (confirm("Bu sotuvni navbatdan o'chirishga ishonchingiz komilmi? Agar server allaqachon qabul qilgan bo'lsa, sotuv saqlanib qoladi.")) {
                        await removeQueued(q.id);
                      }
                    }}>
                      <Trash2 className="h-3 w-3" /> O'chirish
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t p-3 text-[11px] text-muted-foreground shrink-0">
            Idempotency kalitlari tufayli bir sotuv ikki marta yozilmaydi. Bloklangan sotuvlarni server xatosi sabab tekshirib, qo'lda hal qiling.
          </div>
        </SheetContent>
      </Sheet>

      {/* Kutishdagi savatlar (Hold Carts) Sheet */}
      <Sheet open={holdListOpen} onOpenChange={setHoldListOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
          <SheetHeader className="p-4 border-b">
            <SheetTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Pause className="h-4 w-4 text-primary" /> Kutishdagi savatlar ({holdCarts.length})
              </span>
              <span className="text-xs font-normal text-muted-foreground font-mono">F7</span>
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {holdCarts.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                Kutishda saqlangan savatlar yo'q.<br />
                Savatda tovar bo'lganda <span className="font-semibold text-foreground">F6</span> yoki <span className="font-semibold text-foreground">Kutish</span> tugmasini bosing.
              </div>
            ) : (
              holdCarts.map((h) => (
                <div key={h.id} className="rounded-lg border p-3.5 space-y-2.5 bg-card hover:border-primary/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm">{h.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {h.items.length} xil mahsulot · {h.items.reduce((acc, i) => acc + i.qty, 0)} dona
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-sm text-primary font-mono">{fmtMoney(h.total)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(h.created_at).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                  {/* Item preview */}
                  <div className="bg-muted/40 rounded p-2 text-xs space-y-1">
                    {h.items.slice(0, 3).map((item, idx) => (
                      <div key={idx} className="flex justify-between text-muted-foreground truncate">
                        <span className="truncate">{item.name}</span>
                        <span className="shrink-0 font-mono ml-2">{item.qty} × {fmtMoney(item.price)}</span>
                      </div>
                    ))}
                    {h.items.length > 3 && (
                      <div className="text-[10px] text-muted-foreground italic">
                        va yana {h.items.length - 3} ta mahsulot…
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" className="flex-1 h-8 text-xs font-medium" onClick={() => handleRestoreCart(h)}>
                      <Play className="h-3 w-3 mr-1" /> Savatni tiklash
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs text-destructive hover:text-destructive"
                      onClick={async () => {
                        if (confirm("Bu kutishdagi savatni o'chirishga ishonchingiz komilmi?")) {
                          await deleteHoldCart(h.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="border-t p-3 text-[11px] text-muted-foreground shrink-0 bg-muted/20">
            Savatlar brauzer xotirasida xavfsiz saqlanadi — sahifa yangilansa ham yo'qolmaydi.
          </div>
        </SheetContent>
      </Sheet>

      {/* Mukammal Nasiya Xabarnomalari Sozlamasi Markazi */}
      <NasiyaSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* Tuxum Kunlik Narxlari Markazi (D1, D2, D3) */}
      <DailyEggPriceDialog open={eggPriceOpen} onOpenChange={setEggPriceOpen} products={stock} />
    </>
  );
}

interface CartPanelProps {
  cart: CartItem[];
  updateQty: (pid: string, delta: number) => void;
  setQty: (pid: string, q: number) => void;
  updatePrice: (pid: string, price: number) => void;
  updateTotal: (pid: string, total: number) => void;
  remove: (pid: string) => void;
  customerId: string;
  setCustomerId: (v: string) => void;
  customers: Array<{ id: string; name: string; balance: number; credit_limit?: number | null; phone?: string | null }>;
  paymentMethod: "cash" | "click" | "split";
  setPaymentMethod: (v: "cash" | "click" | "split") => void;
  amountPaid: string;
  setAmountPaid: (v: string) => void;
  cashPaid: string;
  setCashPaid: (v: string) => void;
  clickPaid: string;
  setClickPaid: (v: string) => void;
  subtotal: number;
  discountType: "amount" | "percent";
  setDiscountType: (v: "amount" | "percent") => void;
  discountValue: string;
  setDiscountValue: (v: string) => void;
  discountAmount: number;
  onApplyRounding: () => void;
  total: number;
  debt: number;
  autoPrint: boolean;
  setAutoPrint: (v: boolean) => void;
  online: boolean;
  warehouseId: string;
  isPending: boolean;
  onCheckout: () => void;
  hideHeader?: boolean;
  onHoldCart: () => void;
  heldCount: number;
  onOpenHeld: () => void;
}

function CartPanel(p: CartPanelProps) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      {!p.hideHeader && (
        <div className="border-b px-4 py-2.5 flex items-center justify-between">
          <div className="text-sm font-semibold">Savat ({p.cart.length})</div>
          <div className="flex items-center gap-1.5">
            {p.heldCount > 0 && (
              <Button size="sm" variant="secondary" className="h-7 text-xs px-2" onClick={p.onOpenHeld} title="Kutishdagi savatlar (F7)">
                <Pause className="h-3 w-3 mr-1" /> ({p.heldCount})
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-2"
              onClick={p.onHoldCart}
              disabled={p.cart.length === 0}
              title="Savatni kutishga olish (F6)"
            >
              <Pause className="h-3 w-3 mr-1" /> Kutish (F6)
            </Button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto divide-y">
        {p.cart.map((i) => (
          <div key={i.product_id} className="px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{i.name}</div>
                {isQopProduct(i.name, i.category) && (
                  <div className="text-[10px] text-amber-500 font-semibold">📦 Qopda (1 dona = 1 qop)</div>
                )}
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => p.updateQty(i.product_id, -1)}><Minus className="h-3 w-3" /></Button>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={i.quantity === 0 ? "" : i.quantity}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") { p.setQty(i.product_id, 0); return; }
                      const v = Number(raw);
                      if (Number.isNaN(v)) return;
                      p.setQty(i.product_id, Math.min(Math.max(v, 0), i.available));
                    }}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-7 w-14 text-center text-sm font-mono px-1"
                  />
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => p.updateQty(i.product_id, 1)}><Plus className="h-3 w-3" /></Button>
                  <span className="text-[11px] font-mono font-medium text-muted-foreground shrink-0">{i.unit || getProductUnit(i.name, i.category)}</span>
                  <Input className="h-8 ml-1 text-xs" type="number" value={i.sell_price} onChange={(e) => p.updatePrice(i.product_id, Number(e.target.value))} />
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Label className="text-[10px] text-muted-foreground shrink-0">Jami:</Label>
                  <Input
                    className="h-7 text-xs font-mono"
                    type="number"
                    inputMode="decimal"
                    value={Math.round(i.quantity * i.sell_price)}
                    onChange={(e) => p.updateTotal(i.product_id, Number(e.target.value))}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold">{fmtMoney(i.quantity * i.sell_price)}</div>
                <Button size="icon" variant="ghost" className="h-7 w-7 mt-1" onClick={() => p.remove(i.product_id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </div>
        ))}
        {p.cart.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">Mahsulot tanlang</div>}
      </div>

      <div className="border-t p-3 space-y-2.5 shrink-0">
        <div className="space-y-1.5">
          <Label className="text-xs">Mijoz</Label>
          <CustomerSearch customerId={p.customerId} setCustomerId={p.setCustomerId} customers={p.customers} />
        </div>

        {/* Chegirma / Yaxlitlash bo'limi */}
        <div className="space-y-1.5 p-2 rounded-lg border border-border/60 bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Percent className="h-3.5 w-3.5 text-primary" />
              <Label className="text-xs font-medium">Chegirma / Yaxlitlash</Label>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => p.setDiscountType("amount")}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-semibold transition-colors",
                  p.discountType === "amount" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                So'm
              </button>
              <button
                type="button"
                onClick={() => p.setDiscountType("percent")}
                className={cn(
                  "px-2 py-0.5 rounded text-[10px] font-semibold transition-colors",
                  p.discountType === "percent" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                %
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              placeholder={p.discountType === "percent" ? "Masalan: 5 (%)" : "Chegirma summasi"}
              value={p.discountValue}
              onChange={(e) => p.setDiscountValue(e.target.value)}
              className="h-8 text-xs font-mono flex-1"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-[11px] px-2 whitespace-nowrap"
              onClick={p.onApplyRounding}
              title="Oraliq summani 1000 so'mga yaxlitlash"
            >
              Yaxlitlash
            </Button>
          </div>
          {p.discountAmount > 0 && (
            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
              <span>Oraliq: {fmtMoney(p.subtotal)}</span>
              <span className="text-rose-400 font-semibold font-mono">-{fmtMoney(p.discountAmount)}</span>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">To'lov turi</Label>
          <Select value={p.paymentMethod} onValueChange={(v) => p.setPaymentMethod(v as "cash" | "click" | "split")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Naqd</SelectItem>
              <SelectItem value="click">Click</SelectItem>
              <SelectItem value="split">Aralash (Naqd + Click)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {p.paymentMethod !== "split" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">To'langan</Label>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3 w-3"
                  checked={p.amountPaid === "" || Number(p.amountPaid) >= p.total}
                  onChange={(e) => p.setAmountPaid(e.target.checked ? "" : "0")}
                />
                To'liq
              </label>
            </div>
            <Input type="number" value={p.amountPaid} onChange={(e) => p.setAmountPaid(e.target.value)} placeholder={String(p.total)} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Naqd</Label>
              <Input type="number" inputMode="decimal" value={p.cashPaid} onChange={(e) => p.setCashPaid(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Click</Label>
              <Input type="number" inputMode="decimal" value={p.clickPaid} onChange={(e) => p.setClickPaid(e.target.value)} placeholder="0" />
            </div>
          </div>
        )}
        <div className="rounded-xl border border-border/60 bg-accent/30 backdrop-blur-sm p-3 space-y-1.5 text-sm">
          {p.discountAmount > 0 && (
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Oraliq summa</span>
              <span className="font-mono">{fmtMoney(p.subtotal)}</span>
            </div>
          )}
          {p.discountAmount > 0 && (
            <div className="flex justify-between items-center text-xs">
              <span className="text-rose-400">Chegirma</span>
              <span className="font-mono text-rose-400 font-semibold">-{fmtMoney(p.discountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between items-center"><span className="text-muted-foreground font-medium">Jami</span><span className="font-mono font-bold text-base text-foreground">{fmtMoney(p.total)}</span></div>
          {(() => {
            const paidNum = p.paymentMethod === "split"
              ? (Number(p.cashPaid || 0) + Number(p.clickPaid || 0))
              : (p.amountPaid === "" ? p.total : Number(p.amountPaid || 0));
            const rawDebt = p.total - paidNum; // negative => overpayment
            const custObj = p.customerId && p.customerId !== "walkin" ? p.customers.find((c) => c.id === p.customerId) : null;
            const cur = custObj ? Number(custObj.balance ?? 0) : null;
            const limit = custObj ? Number(custObj.credit_limit ?? 0) : 0;
            const next = cur !== null ? cur + rawDebt : null;
            const overLimit = limit > 0 && next !== null && next > limit;
            return (
              <>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">To'langan</span><span className="font-mono">{fmtMoney(paidNum)}</span></div>
                {rawDebt > 0 && <div className="flex justify-between items-center"><span className="text-amber-400 font-medium">Qoladigan qarz</span><span className="font-mono font-bold text-amber-400">{fmtMoney(rawDebt)}</span></div>}
                {rawDebt < 0 && <div className="flex justify-between items-center"><span className="text-cyan-400 font-medium">Ortiqcha to'lov</span><span className="font-mono font-bold text-cyan-400">{fmtMoney(-rawDebt)}</span></div>}
                {cur !== null && (
                  <>
                    <div className="flex justify-between items-center border-t border-border/50 pt-1.5 mt-1.5"><span className="text-muted-foreground text-xs">Mijoz qarzi (hozir)</span><span className={cn("font-mono text-xs", cur > 0 ? "text-amber-400 font-semibold" : cur < 0 ? "text-cyan-400 font-semibold" : "")}>{fmtMoney(cur)}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground text-xs">Sotuvdan keyin</span><span className={cn("font-mono text-xs font-semibold", (next ?? 0) > 0 ? "text-amber-400" : (next ?? 0) < 0 ? "text-cyan-400" : "")}>{fmtMoney(next ?? 0)}</span></div>
                    {limit > 0 && (
                      <div className="flex justify-between items-center"><span className="text-muted-foreground text-xs">Qarz limiti</span><span className={cn("font-mono text-xs", overLimit ? "text-destructive font-semibold" : "")}>{fmtMoney(limit)}</span></div>
                    )}
                    {overLimit && (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1 mt-1 text-[11px] text-destructive font-medium">
                        ⚠ Mijozning qarz limiti oshib ketadi — sotuv bloklanadi
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={p.autoPrint} onChange={(e) => p.setAutoPrint(e.target.checked)} className="h-3.5 w-3.5" />
          <Printer className="h-3 w-3" /> Chekni avtomatik chop etish
        </label>
        <Button className="w-full h-11 text-sm font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all" size="lg" disabled={p.cart.length === 0 || p.isPending || !p.warehouseId} onClick={p.onCheckout}>
          {p.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : p.online ? "Sotuvni yakunlash" : "Oflayn saqlash"}
        </Button>
      </div>
    </div>
  );
}

function CustomerSearch({ customerId, setCustomerId, customers }: { customerId: string; setCustomerId: (v: string) => void; customers: Array<{ id: string; name: string; balance: number; credit_limit?: number | null; phone?: string | null }> }) {
  const [open, setOpen] = useState(false);
  const selected = customers.find((c) => c.id === customerId);
  const label = customerId === "walkin" ? "— Mijoz yo'q —" : selected?.name ?? "Mijoz tanlang";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Mijoz nomi yoki telefon raqami..." />
          <CommandList>
            <CommandEmpty>Topilmadi</CommandEmpty>
            <CommandGroup>
              <CommandItem value="walkin yo'q mijozsiz" onSelect={() => { setCustomerId("walkin"); setOpen(false); }}>
                <Check className={cn("h-4 w-4", customerId === "walkin" ? "opacity-100" : "opacity-0")} />
                — Mijoz yo'q —
              </CommandItem>
              {customers.map((c) => {
                const searchKeys = `${c.name} ${c.phone ?? ""} ${toCyrillic(c.name)} ${toLatin(c.name)}`;
                return (
                  <CommandItem key={c.id} value={searchKeys} onSelect={() => { setCustomerId(c.id); setOpen(false); }}>
                    <Check className={cn("h-4 w-4", customerId === c.id ? "opacity-100" : "opacity-0")} />
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.phone && <span className="text-xs text-muted-foreground ml-2 font-mono">{c.phone}</span>}
                    {Number(c.balance) > 0 && <span className="ml-2 text-[11px] text-warning font-mono">{fmtMoney(c.balance)}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
