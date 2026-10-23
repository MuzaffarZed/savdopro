import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  User,
  Wallet,
  ChevronRight,
  Phone,
  AlertCircle,
  ShoppingCart,
  Pencil,
  ExternalLink,
  MessageSquare,
  Clock,
  Search,
  Users,
  Package,
  ChevronDown,
  MapPin,
  Navigation,
  Upload,
  Camera,
  Bell,
  Send,
  FileText,
  Share2,
  CheckCircle2,
  Printer,
  QrCode,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { fmtMoney, fmtDate, newIdempotencyKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import { lazy, Suspense, useMemo } from "react";
import { NasiyaSettingsDialog } from "@/components/nasiya/NasiyaSettingsDialog";
import { CustomerTelegramLinkDialog } from "@/components/customers/CustomerTelegramLinkDialog";
import {
  formatPaymentReceiptMessage,
  enqueueAndSendTelegramMessage,
  getCustomerTelegramLink,
  getLocalCustomerTelegramLink,
} from "@/lib/telegram-service";
import {
  dispatchNasiyaPaymentNotification,
  getCustomerTelegramChatId,
  loadNasiyaSettings,
} from "@/lib/nasiya-notify";
import {
  enqueueDebtPayment,
  applyLocalOptimisticDebtPayment,
  type QueuedDebtPayment,
} from "@/lib/offline-store";
import { printDebtPaymentReceipt, printAktSverka } from "@/lib/receipt";
const LocationPicker = lazy(() =>
  import("@/components/LocationPicker").then((m) => ({ default: m.LocationPicker })),
);
function MapFallback() {
  return <div className="h-[280px] rounded-md border bg-muted/30 animate-pulse" />;
}

export const Route = createFileRoute("/_app/customers")({ component: CustomersPage });

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function CustomersPage() {
  const { profile, isSuperAdmin, user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [createLat, setCreateLat] = useState<number | null>(null);
  const [createLng, setCreateLng] = useState<number | null>(null);
  const [createImageUrl, setCreateImageUrl] = useState<string | null>(null);
  const [createUploading, setCreateUploading] = useState(false);
  const createFileRef = useRef<HTMLInputElement>(null);
  const createCameraRef = useRef<HTMLInputElement>(null);
  const [openingBalance, setOpeningBalance] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [search, setSearch] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payCustomer, setPayCustomer] = useState<{
    id: string;
    name: string;
    balance: number;
    phone?: string | null;
  } | null>(null);
  const [linkCustomer, setLinkCustomer] = useState<{
    id: string;
    name: string;
    phone?: string | null;
  } | null>(null);
  const [nasiyaSettingsOpen, setNasiyaSettingsOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "click">("cash");
  const [payNote, setPayNote] = useState("");
  const [payIdemKey, setPayIdemKey] = useState(newIdempotencyKey());
  const [paymentSuccess, setPaymentSuccess] = useState<{
    customerName: string;
    customerPhone?: string | null;
    amountPaid: number;
    debtCleared: number;
    remainingDebt: number;
    paymentMethod: "cash" | "click";
    paymentNo: string;
    note?: string;
    date: Date;
    isOffline?: boolean;
  } | null>(null);
  const [aktSverkaCustomer, setAktSverkaCustomer] = useState<{
    id: string;
    name: string;
    balance: number;
    phone?: string | null;
    opening_balance?: number | string | null;
  } | null>(null);
  const [quickId, setQuickId] = useState<string | null>(null);
  const [editPay, setEditPay] = useState<{
    id: string;
    amount: string;
    note: string;
    method: "cash" | "click";
  } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [deletePayId, setDeletePayId] = useState<string | null>(null);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const [editCustomer, setEditCustomer] = useState<{
    id: string;
    name: string;
    phone: string;
    balance: string;
    creditLimit: string;
    address: string;
    lat: string;
    lng: string;
    imageUrl: string | null;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [expandedSale, setExpandedSale] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () =>
      (await supabase.from("customers").select("*").is("deleted_at", null).order("name")).data ??
      [],
  });

  const create = useMutation({
    mutationFn: async () => {
      const branch_id = isSuperAdmin ? null : (profile?.branch_id ?? null);
      const opening = Number(openingBalance);
      const balance = Number.isFinite(opening) && opening !== 0 ? opening : 0;
      const limit = Number(creditLimit);
      const credit_limit = Number.isFinite(limit) && limit > 0 ? limit : 0;
      const { error } = await supabase.from("customers").insert({
        name: name.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
        latitude: createLat,
        longitude: createLng,
        image_url: createImageUrl,
        branch_id,
        balance,
        opening_balance: balance,
        credit_limit,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mijoz qo'shildi");
      setOpen(false);
      setName("");
      setPhone("");
      setAddress("");
      setCreateLat(null);
      setCreateLng(null);
      setCreateImageUrl(null);
      setOpeningBalance("");
      setCreditLimit("");
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateCustomer = useMutation({
    mutationFn: async () => {
      if (!editCustomer) return;
      const trimmedName = editCustomer.name.trim();
      if (!trimmedName) throw new Error("Ism bo'sh bo'lmasligi kerak");
      const lat = editCustomer.lat.trim() ? Number(editCustomer.lat) : null;
      const lng = editCustomer.lng.trim() ? Number(editCustomer.lng) : null;
      if ((lat !== null && Number.isNaN(lat)) || (lng !== null && Number.isNaN(lng)))
        throw new Error("Lokatsiya raqam bo'lishi kerak");
      const payload: {
        name: string;
        phone: string | null;
        address: string | null;
        latitude: number | null;
        longitude: number | null;
        image_url: string | null;
        opening_balance?: number;
        credit_limit?: number;
      } = {
        name: trimmedName,
        phone: editCustomer.phone.trim() || null,
        address: editCustomer.address.trim() || null,
        latitude: lat,
        longitude: lng,
        image_url: editCustomer.imageUrl,
      };
      const limit = Number(editCustomer.creditLimit);
      payload.credit_limit = Number.isFinite(limit) && limit > 0 ? limit : 0;
      if (isSuperAdmin) {
        const op = Number(editCustomer.balance);
        if (!Number.isFinite(op)) throw new Error("Boshlang'ich qarz noto'g'ri");
        payload.opening_balance = op;
      }
      const { error } = await supabase.from("customers").update(payload).eq("id", editCustomer.id);
      if (error) throw error;
      if (isSuperAdmin) {
        await supabase.rpc("recalc_customer_balance" as never, { _customer_id: editCustomer.id } as never);
      }
    },
    onSuccess: () => {
      toast.success("Mijoz yangilandi");
      setEditCustomer(null);
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openEditFor(c: {
    id: string;
    name: string;
    phone: string | null;
    balance: number | string;
    opening_balance?: number | string;
    credit_limit?: number;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    image_url?: string | null;
  }) {
    setEditCustomer({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      balance: String(c.opening_balance ?? c.balance),
      creditLimit: String(c.credit_limit ?? 0),
      address: c.address ?? "",
      lat: c.latitude != null ? String(c.latitude) : "",
      lng: c.longitude != null ? String(c.longitude) : "",
      imageUrl: c.image_url ?? null,
    });
  }

  async function uploadCustomerImage(file: File) {
    if (!editCustomer) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${editCustomer.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("customer-images")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("customer-images").getPublicUrl(path);
      setEditCustomer((prev) => (prev ? { ...prev, imageUrl: data.publicUrl } : prev));
      toast.success("Rasm yuklandi");
    } catch (e) {
      toast.error("Rasm yuklanmadi", { description: (e as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function uploadImageForCreate(file: File) {
    setCreateUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `new/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("customer-images")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("customer-images").getPublicUrl(path);
      setCreateImageUrl(data.publicUrl);
      toast.success("Rasm yuklandi");
    } catch (e) {
      toast.error("Rasm yuklanmadi", { description: (e as Error).message });
    } finally {
      setCreateUploading(false);
    }
  }

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("delete_customer", {
        _customer_id: id,
        _user_id: user!.id,
      } as never);
      if (error) throw error;
      return data as unknown as string;
    },
    onSuccess: (result) => {
      toast.success(
        result === "deleted" ? "Mijoz butunlay o'chirildi" : "Mijoz arxivlandi (tarixi saqlandi)",
      );
      qc.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pay = useMutation({
    mutationFn: async () => {
      if (!payCustomer) throw new Error("Mijoz tanlanmagan");
      const amt = Number(payAmount);
      if (!(amt > 0)) throw new Error("Summa to'g'ri kiritilmagan");
      const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

      const qItem: QueuedDebtPayment = {
        id: payIdemKey,
        created_at: Date.now(),
        payload: {
          _customer_id: payCustomer.id,
          _amount: amt,
          _method: payMethod,
          _note: payNote || null,
          _user_id: user!.id,
          _idempotency_key: payIdemKey,
        },
        status: "pending",
        attempts: 0,
      };

      if (!isOnline) {
        await enqueueDebtPayment(qItem);
        await applyLocalOptimisticDebtPayment(payCustomer.id, amt);
        return { offline: true };
      }

      try {
        const { error } = await supabase.rpc("process_debt_payment", qItem.payload as never);
        if (error) throw error;
        return { offline: false };
      } catch (err: unknown) {
        const msg = String((err as Error)?.message ?? err).toLowerCase();
        if (!navigator.onLine || msg.includes("failed to fetch") || msg.includes("network")) {
          await enqueueDebtPayment(qItem);
          await applyLocalOptimisticDebtPayment(payCustomer.id, amt);
          return { offline: true };
        }
        throw err;
      }
    },
    onSuccess: (res) => {
      if (payCustomer) {
        const amt = Number(payAmount);
        const prevDebt = Number(payCustomer.balance || 0);
        const finalDebt = Math.max(0, prevDebt - amt);
        const debtCleared = Math.min(prevDebt, amt);

        if (res?.offline) {
          toast.success("Oflayn to'lov saqlandi", {
            description: "Aloqa tiklanganda avtomatik serverga yuboriladi",
          });
        } else {
          toast.success("To'lov qabul qilindi");
        }

        // Telegram Engine v2 (Xusniddin 2002 Section 5 Exact Template)
        void (async () => {
          let directSent = false;
          try {
            const link = await getCustomerTelegramLink(payCustomer.id);
            if (link.linkStatus === "linked" && link.telegramChatId) {
              const paymentText = formatPaymentReceiptMessage({
                paymentNumber: payIdemKey.slice(0, 8),
                date: new Date(),
                paymentMethod: payMethod === "cash" ? "Naqd" : "Click",
                paymentAmount: amt,
                previousBalance: prevDebt,
                currentBalance: finalDebt,
              });

              await enqueueAndSendTelegramMessage({
                customerId: payCustomer.id,
                customerName: payCustomer.name,
                paymentId: payIdemKey,
                eventType: "payment",
                telegramChatId: link.telegramChatId,
                formattedText: paymentText,
                idempotencyKey: `pay-${payIdemKey}`,
              });
              directSent = true;
            }
          } catch (tgErr) {
            console.warn("Telegram payment check dispatch error:", tgErr);
          }

          if (!directSent) {
            void dispatchNasiyaPaymentNotification({
              shopName: "SavdoPro",
              cashierName: profile?.name,
              customerName: payCustomer.name,
              customerPhone: payCustomer.phone ?? undefined,
              paymentNo: payIdemKey,
              amountPaid: amt,
              previousDebt: prevDebt,
              debtCleared,
              finalDebt,
              paymentMethod: payMethod === "cash" ? "Naqd" : "Click",
              note: payNote || undefined,
            });
          }
        })();

        setPaymentSuccess({
          customerName: payCustomer.name,
          customerPhone: payCustomer.phone,
          amountPaid: amt,
          debtCleared,
          remainingDebt: finalDebt,
          paymentMethod: payMethod,
          paymentNo: payIdemKey,
          note: payNote || undefined,
          date: new Date(),
          isOffline: !!res?.offline,
        });
      }

      setPayOpen(false);
      setPayAmount("");
      setPayNote("");
      setPayCustomer(null);
      setPayIdemKey(newIdempotencyKey());
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data: aktSales, isLoading: aktSalesLoading } = useQuery({
    queryKey: ["akt-sales", aktSverkaCustomer?.id],
    queryFn: async () => {
      if (!aktSverkaCustomer) return [];
      return (
        (
          await supabase
            .from("sales")
            .select("id,total_sale,amount_paid,remaining_debt,created_at,status")
            .eq("customer_id", aktSverkaCustomer.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
        ).data ?? []
      );
    },
    enabled: !!aktSverkaCustomer,
  });

  const { data: aktPayments, isLoading: aktPaymentsLoading } = useQuery({
    queryKey: ["akt-payments", aktSverkaCustomer?.id],
    queryFn: async () => {
      if (!aktSverkaCustomer) return [];
      return (
        (
          await supabase
            .from("payments")
            .select("id,amount,method,note,created_at,sale_id")
            .eq("customer_id", aktSverkaCustomer.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
        ).data ?? []
      );
    },
    enabled: !!aktSverkaCustomer,
  });

  const aktLedger = useMemo(() => {
    if (!aktSverkaCustomer) return { items: [], totalDebit: 0, totalCredit: 0, finalBalance: 0 };
    const list: Array<{
      date: string;
      rawDate: number;
      type: "sale" | "payment";
      title: string;
      docNo?: string;
      debit: number;
      credit: number;
      balance: number;
    }> = [];

    const opening = Number(aktSverkaCustomer.opening_balance ?? 0);
    let running = opening;

    if (opening !== 0) {
      list.push({
        date: "Boshlang'ich",
        rawDate: 0,
        type: "sale",
        title: "Boshlang'ich qoldiq",
        debit: opening > 0 ? opening : 0,
        credit: opening < 0 ? -opening : 0,
        balance: running,
      });
    }

    (aktSales ?? []).forEach((s) => {
      const saleDebt = Number(s.remaining_debt ?? 0);
      if (saleDebt > 0) {
        running += saleDebt;
        list.push({
          date: fmtDate(s.created_at),
          rawDate: new Date(s.created_at).getTime(),
          type: "sale",
          title: `Nasiya xarid (№ ${s.id.slice(0, 6)})`,
          docNo: s.id.slice(0, 6),
          debit: saleDebt,
          credit: 0,
          balance: running,
        });
      }
    });

    (aktPayments ?? []).forEach((p) => {
      if (!p.sale_id) {
        const amt = Number(p.amount ?? 0);
        running = Math.max(0, running - amt);
        list.push({
          date: fmtDate(p.created_at),
          rawDate: new Date(p.created_at).getTime(),
          type: "payment",
          title: `Qarz to'lovi (${p.method})`,
          docNo: p.id.slice(0, 6),
          debit: 0,
          credit: amt,
          balance: running,
        });
      }
    });

    list.sort((a, b) => a.rawDate - b.rawDate);

    let bal = opening;
    let totalDebit = opening > 0 ? opening : 0;
    let totalCredit = opening < 0 ? -opening : 0;

    list.forEach((item) => {
      if (item.rawDate !== 0) {
        if (item.debit > 0) {
          bal += item.debit;
          totalDebit += item.debit;
        }
        if (item.credit > 0) {
          bal = Math.max(0, bal - item.credit);
          totalCredit += item.credit;
        }
        item.balance = bal;
      }
    });

    return {
      items: list,
      totalDebit,
      totalCredit,
      finalBalance: Number(aktSverkaCustomer.balance ?? bal),
    };
  }, [aktSverkaCustomer, aktSales, aktPayments]);

  const handleShareAktTelegram = () => {
    if (!aktSverkaCustomer) return;
    const nowStr = new Date().toLocaleDateString("uz-UZ");
    const msg = [
      `📄 SAVDOPRO — AKT SVERKA`,
      `━━━━━━━━━━━━━━━━━━━`,
      `👤 Mijoz: ${aktSverkaCustomer.name}`,
      `📅 Holati: ${nowStr}`,
      `━━━━━━━━━━━━━━━━━━━`,
      `Jami olingan qarz: ${fmtMoney(aktLedger.totalDebit)}`,
      `Jami to'langan summa: ${fmtMoney(aktLedger.totalCredit)}`,
      `━━━━━━━━━━━━━━━━━━━`,
      `📌 HOZIRGI QARZ QOLDIG'I: ${fmtMoney(aktLedger.finalBalance)}`,
      `━━━━━━━━━━━━━━━━━━━`,
      `Xaridingiz uchun rahmat!`,
    ].join("\n");

    void navigator.clipboard.writeText(msg);
    toast.success("Akt sverka xabari nusxalandi!", { description: "Telegramga yuborishingiz mumkin" });
    window.open(`https://t.me/share/url?url=&text=${encodeURIComponent(msg)}`, "_blank");
  };

  const handlePrintAkt = () => {
    if (!aktSverkaCustomer) return;
    printAktSverka(
      aktSverkaCustomer.name,
      aktLedger.items,
      aktLedger.finalBalance,
      new Date().toLocaleDateString("uz-UZ"),
    );
  };

  const { data: history } = useQuery({
    queryKey: ["customer-payments", payCustomer?.id],
    queryFn: async () => {
      if (!payCustomer) return [];
      return (
        (
          await supabase
            .from("payments")
            .select("id,amount,method,note,created_at")
            .eq("customer_id", payCustomer.id)
            .order("created_at", { ascending: false })
            .limit(20)
        ).data ?? []
      );
    },
    enabled: !!payCustomer,
  });

  // Quick view data
  const quickCustomer = (customers ?? []).find((c) => c.id === quickId) ?? null;
  const { data: quickSales } = useQuery({
    queryKey: ["quick-sales", quickId],
    queryFn: async () =>
      (
        await supabase
          .from("sales")
          .select(
            "id,total_sale,amount_paid,remaining_debt,payment_method,status,created_at,sale_items(quantity,total_price,products(name))",
          )
          .eq("customer_id", quickId!)
          .order("created_at", { ascending: false })
          .limit(10)
      ).data ?? [],
    enabled: !!quickId,
  });
  const { data: quickPayments } = useQuery({
    queryKey: ["quick-payments", quickId],
    queryFn: async () =>
      (
        await supabase
          .from("payments")
          .select("id,amount,method,note,sale_id,created_at")
          .eq("customer_id", quickId!)
          .order("created_at", { ascending: false })
          .limit(10)
      ).data ?? [],
    enabled: !!quickId,
  });

  const updatePay = useMutation({
    mutationFn: async () => {
      if (!editPay) return;
      const { error } = await supabase
        .from("payments")
        .update({
          amount: Number(editPay.amount),
          note: editPay.note || null,
          method: editPay.method,
        })
        .eq("id", editPay.id);
      if (error) throw error;
      // Find which customer this payment belongs to and recompute their balance
      const { data: pay } = await supabase
        .from("payments")
        .select("customer_id,sale_id")
        .eq("id", editPay.id)
        .maybeSingle();
      const cid = pay?.customer_id ?? quickId;
      if (cid)
        await supabase.rpc("recalc_customer_balance" as never, { _customer_id: cid } as never);
    },
    onSuccess: () => {
      toast.success("To'lov yangilandi, qarz qoldig'i qayta hisoblandi");
      setEditPay(null);
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deletePay = useMutation({
    mutationFn: async (pid: string) => {
      const { error } = await supabase.rpc("delete_payment", {
        _payment_id: pid,
        _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("O'chirildi, qarz qoldig'i qayta hisoblandi");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rollbackSale = useMutation({
    mutationFn: async (sid: string) => {
      const { error } = await supabase.rpc("rollback_sale", {
        _sale_id: sid,
        _user_id: user!.id,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sotuv bekor qilindi");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openPayFor = (c: { id: string; name: string; balance: number | string; phone?: string | null }) => {
    const balance = Number(c.balance);
    setPayCustomer({ id: c.id, name: c.name, balance, phone: c.phone ?? null });
    setPayAmount(balance > 0 ? String(balance) : "");
    setPayMethod("cash");
    setPayNote("");
    setPayIdemKey(newIdempotencyKey());
    setPayOpen(true);
  };

  const filtered = (customers ?? []).filter(
    (c) => c.name.toLowerCase().includes(search.toLowerCase()) || (c.phone ?? "").includes(search),
  );

  // Inactive customers: no purchase in the last N days
  const [inactiveDays, setInactiveDays] = useState(10);
  const [inactiveOpen, setInactiveOpen] = useState(false);
  const { data: lastSales } = useQuery({
    queryKey: ["customers-last-sale"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select("customer_id,created_at")
        .not("customer_id", "is", null)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(5000);
      const map = new Map<string, string>();
      (data ?? []).forEach((s) => {
        if (s.customer_id && !map.has(s.customer_id)) map.set(s.customer_id, s.created_at);
      });
      return map;
    },
  });

  // Recent sale (with items) per customer for compact breakdown on cards
  type RecentSale = {
    id: string;
    customer_id: string | null;
    total_sale: number;
    created_at: string;
    sale_items: Array<{
      quantity: number;
      total_price: number;
      products: { name: string } | null;
    }> | null;
  };
  const { data: lastSaleByCustomer } = useQuery({
    queryKey: ["customers-last-sale-items"],
    queryFn: async () => {
      const { data } = await supabase
        .from("sales")
        .select(
          "id,customer_id,total_sale,created_at,sale_items(quantity,total_price,products(name))",
        )
        .not("customer_id", "is", null)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(500);
      const map = new Map<string, RecentSale>();
      ((data ?? []) as unknown as RecentSale[]).forEach((s) => {
        if (s.customer_id && !map.has(s.customer_id)) map.set(s.customer_id, s);
      });
      return map;
    },
  });

  const inactiveList = (customers ?? [])
    .map((c) => {
      const last = lastSales?.get(c.id) ?? null;
      const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
      return { ...c, lastSaleAt: last, daysSince: days };
    })
    .filter((c) => c.daysSince === null || c.daysSince >= inactiveDays)
    .sort((a, b) => (b.daysSince ?? 99999) - (a.daysSince ?? 99999));

  return (
    <>
      <PageHeader
        title="Mijozlar"
        description="Mijoz va qarzlarni boshqarish"
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs font-medium"
              onClick={() => setNasiyaSettingsOpen(true)}
              title="Nasiya Xabarnomalari Sozlamasi"
            >
              <Bell className="h-4 w-4 text-primary" />
              <span className="hidden sm:inline">Nasiya xabarlari</span>
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Yangi mijoz
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[calc(100dvh-1rem)] overflow-hidden p-0 gap-0">
                <DialogHeader className="px-4 pt-4 pb-3 border-b">
                  <DialogTitle>Yangi mijoz</DialogTitle>
                  <DialogDescription className="sr-only">
                    Mijoz ma'lumotlari, rasm va lokatsiya kiritish oynasi
                  </DialogDescription>
                </DialogHeader>
                <div className="max-h-[calc(100dvh-9rem)] overflow-y-auto px-4 py-3 space-y-3">
                  <div className="space-y-1.5">
                    <Label>Ism *</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Telefon</Label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+998..."
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Telegram bot va elektron cheklar aynan shu raqam orqali mijoz lichkasiga avtomatik yuboriladi.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Manzil</Label>
                    <Input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Ko'cha, uy..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Lokatsiya (xaritadan tanlang)</Label>
                    <Suspense fallback={<MapFallback />}>
                      <LocationPicker
                        value={
                          createLat != null && createLng != null
                            ? { lat: createLat, lng: createLng }
                            : null
                        }
                        onChange={(p) => {
                          setCreateLat(p?.lat ?? null);
                          setCreateLng(p?.lng ?? null);
                        }}
                      />
                    </Suspense>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Rasm</Label>
                    {createImageUrl && (
                      <img
                        src={createImageUrl}
                        alt=""
                        onClick={() => setPreviewImage(createImageUrl)}
                        className="h-32 w-full object-cover rounded-md border cursor-zoom-in"
                      />
                    )}
                    <input
                      ref={createFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadImageForCreate(f);
                      }}
                    />
                    <input
                      ref={createCameraRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadImageForCreate(f);
                      }}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => createFileRef.current?.click()}
                        disabled={createUploading}
                      >
                        <Upload className="h-4 w-4 mr-1.5" />{" "}
                        {createUploading ? "Yuklanmoqda..." : "Rasm yuklash"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => createCameraRef.current?.click()}
                        disabled={createUploading}
                      >
                        <Camera className="h-4 w-4 mr-1.5" /> Rasmga olish
                      </Button>
                      {createImageUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setCreateImageUrl(null)}
                        >
                          O'chirish
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Boshlang'ich qoldiq</Label>
                    <Input
                      type="number"
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(e.target.value)}
                      placeholder="0"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Musbat son — mijoz qarzdor, manfiy — bizdan oldindan to'lagan. Bo'sh qoldiring
                      agar 0.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Qarz limiti</Label>
                    <Input
                      type="number"
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(e.target.value)}
                      placeholder="0 = limitsiz"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Mijoz qarzi shu summadan oshsa, sotuv taqiqlanadi. 0 = limit yo'q.
                    </p>
                  </div>
                </div>
                <DialogFooter className="px-4 py-3 border-t">
                  <Button onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
                    Saqlash
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />
      <div className="p-3 lg:p-6 space-y-4 max-w-5xl mx-auto w-full">
        {/* Stats strip */}
        {(() => {
          const all = customers ?? [];
          const debtors = all.filter((c) => Number(c.balance) > 0);
          const totalDebt = debtors.reduce((s, c) => s + Number(c.balance), 0);
          return (
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className="relative overflow-hidden rounded-xl border border-blue-500/20 bg-card/75 backdrop-blur-md p-3 sm:p-4 shadow-sm">
                <div className="absolute -top-8 -right-8 h-20 w-20 rounded-full bg-blue-500/10 blur-xl pointer-events-none" />
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  <Users className="h-3.5 w-3.5 text-blue-400" /> Jami mijoz
                </div>
                <div className="mt-1.5 text-lg sm:text-2xl font-bold font-mono text-foreground">{all.length}</div>
              </div>
              <div className="relative overflow-hidden rounded-xl border border-amber-500/25 bg-card/75 backdrop-blur-md p-3 sm:p-4 shadow-sm">
                <div className="absolute -top-8 -right-8 h-20 w-20 rounded-full bg-amber-500/10 blur-xl pointer-events-none" />
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-400/90 font-semibold">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-400" /> Qarzdorlar
                </div>
                <div className="mt-1.5 text-lg sm:text-2xl font-bold font-mono text-amber-400">
                  {debtors.length}
                </div>
              </div>
              <div className="relative overflow-hidden rounded-xl border border-rose-500/25 bg-card/75 backdrop-blur-md p-3 sm:p-4 shadow-sm">
                <div className="absolute -top-8 -right-8 h-20 w-20 rounded-full bg-rose-500/10 blur-xl pointer-events-none" />
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-rose-400/90 font-semibold">
                  <Wallet className="h-3.5 w-3.5 text-rose-400" /> Jami nasiya
                </div>
                <div className="mt-1.5 text-sm sm:text-lg font-bold font-mono text-rose-400 truncate">
                  {fmtMoney(totalDebt)}
                </div>
              </div>
            </div>
          );
        })()}

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md rounded-xl border border-border/60 bg-card/75 backdrop-blur-md p-0.5 flex items-center shadow-sm">
            <Search className="ml-2.5 h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Ism yoki telefon raqami..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-0 bg-transparent shadow-none pl-2 h-9 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setInactiveOpen(true)} className="rounded-xl border-border/60 bg-card/70 backdrop-blur">
            <Clock className="h-3.5 w-3.5 mr-1" /> Faolsiz
            {inactiveList.length > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
                {inactiveList.length}
              </span>
            )}
          </Button>
        </div>

        {/* Premium card grid (mobile + tablet) */}
        <div className="grid sm:hidden gap-2.5">
          {filtered.map((c) => {
            const bal = Number(c.balance);
            const limit = Number(c.credit_limit ?? 0);
            const isOverLimit = limit > 0 && bal > limit;
            const initials =
              c.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0])
                .join("")
                .toUpperCase() || c.name.slice(0, 2).toUpperCase();
            const last = lastSaleByCustomer?.get(c.id);
            const phoneDigits = c.phone ? c.phone.replace(/[^0-9]/g, "") : "";

            return (
              <button
                key={c.id}
                onClick={() => setQuickId(c.id)}
                className={cn(
                  "group relative text-left rounded-xl border p-3.5 active:scale-[0.99] transition-all overflow-hidden",
                  "bg-card/75 backdrop-blur-md border-border/60 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5",
                  bal > 0 && (isOverLimit ? "border-rose-500/40 bg-rose-500/[0.02]" : "border-amber-500/30 bg-amber-500/[0.02]"),
                )}
              >
                {bal > 0 && (
                  <div
                    className={cn(
                      "absolute top-0 right-0 h-full w-1",
                      isOverLimit ? "bg-rose-500" : "bg-gradient-to-b from-amber-500/70 to-amber-500/20",
                    )}
                  />
                )}
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "shrink-0 flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold font-mono transition-transform group-hover:scale-105",
                      bal > 0
                        ? isOverLimit
                          ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                          : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                        : bal < 0
                          ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                          : "bg-muted/70 text-muted-foreground border border-border/50",
                    )}
                  >
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold truncate text-foreground group-hover:text-primary transition-colors">
                        {c.name}
                      </div>
                      <div
                        className={cn(
                          "text-sm font-mono font-bold tabular-nums shrink-0",
                          bal > 0
                            ? isOverLimit
                              ? "text-rose-400"
                              : "text-amber-400"
                            : bal < 0
                              ? "text-cyan-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {fmtMoney(Math.abs(bal))}
                      </div>
                    </div>

                    {/* Sub row with status badge and phone */}
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {bal === 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/60 text-muted-foreground border border-border/50">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Qarzsiz
                          </span>
                        ) : bal > 0 ? (
                          isOverLimit ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30 animate-pulse">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Limitdan oshgan
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/25">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Nasiyada
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/25">
                            Haqdor
                          </span>
                        )}

                        {c.phone ? (
                          <span className="text-[11px] text-muted-foreground font-mono hidden xs:inline truncate">
                            {c.phone}
                          </span>
                        ) : null}
                      </div>

                      {last && (
                        <div className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-1">
                          <ShoppingCart className="h-2.5 w-2.5" />
                          {last.sale_items?.length ?? 0} ta · {fmtMoney(last.total_sale)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Quick action buttons */}
                  <div className="shrink-0 flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setLinkCustomer({ id: c.id, name: c.name, phone: c.phone });
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition-colors"
                      title="Telegram botga ulash"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openPayFor(c);
                      }}
                      className="inline-flex h-8 px-2.5 items-center justify-center rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[11px] font-semibold shadow-sm transition-colors"
                    >
                      <Wallet className="h-3 w-3 mr-1" /> To'lov
                    </button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="rounded-xl border border-border/60 bg-card/60 p-10 text-center text-sm text-muted-foreground">
              Mijozlar yo'q
            </div>
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block rounded-xl border border-border/60 bg-card/80 backdrop-blur-md overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="px-4 py-3 text-left">Ism</th>
                  <th className="px-4 py-3 text-left">Holat</th>
                  <th className="px-4 py-3 text-left hidden sm:table-cell">Aloqa</th>
                  <th className="px-4 py-3 text-right">Qarz balansi</th>
                  <th className="px-4 py-3 w-28 text-right">Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((c) => {
                  const bal = Number(c.balance);
                  const limit = Number(c.credit_limit ?? 0);
                  const isOverLimit = limit > 0 && bal > limit;
                  const phoneDigits = c.phone ? c.phone.replace(/[^0-9]/g, "") : "";

                  return (
                    <tr key={c.id} className="hover:bg-accent/30 transition-colors">
                      <td className="px-4 py-3 font-medium">
                        <button
                          onClick={() => setQuickId(c.id)}
                          className="flex items-center gap-2 hover:text-primary text-left transition-colors"
                        >
                          <div className="h-7 w-7 rounded-lg bg-accent/60 flex items-center justify-center text-muted-foreground">
                            <User className="h-3.5 w-3.5" />
                          </div>
                          <span className="truncate font-semibold">{c.name}</span>
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {bal === 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted/60 text-muted-foreground border border-border/50">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Qarzsiz
                          </span>
                        ) : bal > 0 ? (
                          isOverLimit ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30 animate-pulse">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Limitdan oshgan
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/25">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Nasiyada
                            </span>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/25">
                            Haqdor
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                        {c.phone ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                            <span>{c.phone}</span>
                            <a
                              href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                              className="inline-flex h-6 w-6 items-center justify-center rounded border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                              aria-label="Qo'ng'iroq"
                              title="Qo'ng'iroq"
                            >
                              <Phone className="h-3 w-3" />
                            </a>
                            {phoneDigits && (
                              <a
                                href={`https://t.me/+${phoneDigits}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex h-6 w-6 items-center justify-center rounded border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition-colors"
                                aria-label="Telegram"
                                title="Telegram"
                              >
                                <MessageSquare className="h-3 w-3" />
                              </a>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-mono font-bold whitespace-nowrap text-sm",
                          bal > 0
                            ? isOverLimit
                              ? "text-rose-400"
                              : "text-amber-400"
                            : bal < 0
                              ? "text-cyan-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {fmtMoney(bal)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2 rounded-lg border-sky-500/30 text-sky-400 hover:bg-sky-500/10"
                            onClick={() => setLinkCustomer({ id: c.id, name: c.name, phone: c.phone })}
                            title="Telegram botga ulash (QR-kod va havola)"
                          >
                            <Send className="h-3 w-3 mr-1" /> Telegram
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2 rounded-lg border-primary/30 text-primary hover:bg-primary/10"
                            onClick={() => setAktSverkaCustomer(c)}
                            title="Akt sverka (solishtirma dalolatnoma)"
                          >
                            <FileText className="h-3 w-3 mr-1" /> Akt
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2 rounded-lg border-border/70 hover:border-primary/40"
                            onClick={() => openPayFor(c)}
                          >
                            <Wallet className="h-3 w-3 mr-1 text-primary" /> To'lov
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 rounded-lg"
                            onClick={() => openEditFor(c as Parameters<typeof openEditFor>[0])}
                            aria-label="Tahrirlash"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg text-rose-400 hover:text-rose-300" onClick={() => setRemoveId(c.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                      Mijozlar yo'q
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Quick view modal */}
      <Dialog open={!!quickId} onOpenChange={(v) => !v && setQuickId(null)}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          {quickCustomer && (
            <>
              <DialogHeader className="px-3 pt-3 pb-2 border-b">
                <div className="flex items-center gap-2.5">
                  {(quickCustomer as { image_url?: string | null }).image_url ? (
                    <img
                      src={(quickCustomer as { image_url?: string | null }).image_url ?? ""}
                      alt={quickCustomer.name}
                      onClick={() =>
                        setPreviewImage(
                          (quickCustomer as { image_url?: string | null }).image_url ?? null,
                        )
                      }
                      className="h-9 w-9 shrink-0 rounded-full object-cover border cursor-zoom-in hover:ring-2 hover:ring-primary/40 transition"
                    />
                  ) : (
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase",
                        Number(quickCustomer.balance) > 0
                          ? "bg-warning/15 text-warning"
                          : "bg-accent text-foreground",
                      )}
                    >
                      {quickCustomer.name.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <DialogTitle className="text-sm text-left truncate">
                      {quickCustomer.name}
                    </DialogTitle>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {quickCustomer.phone || "Telefon yo'q"}
                    </div>
                    {(quickCustomer as { address?: string | null }).address && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {(quickCustomer as { address?: string | null }).address}
                      </div>
                    )}
                    {(() => {
                      const c = quickCustomer as {
                        latitude?: number | null;
                        longitude?: number | null;
                      };
                      return c.latitude != null && c.longitude != null ? (
                        <a
                          href={mapsUrl(c.latitude, c.longitude)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-primary inline-flex items-center gap-1 mt-0.5"
                        >
                          <Navigation className="h-3 w-3" /> Yo'l ko'rsatish
                        </a>
                      ) : null;
                    })()}
                  </div>
                  {quickCustomer.phone && (
                    <div className="flex gap-1 shrink-0">
                      <a
                        href={`tel:${quickCustomer.phone.replace(/[^+\d]/g, "")}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-card hover:bg-accent"
                        title="Telefon qilish"
                      >
                        <Phone className="h-3 w-3 text-success" />
                      </a>
                      <a
                        href={`sms:${quickCustomer.phone.replace(/[^+\d]/g, "")}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border bg-card hover:bg-accent"
                        title="SMS yuborish"
                      >
                        <MessageSquare className="h-3 w-3 text-primary" />
                      </a>
                      <a
                        href={`https://t.me/+${quickCustomer.phone.replace(/[^\d]/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400"
                        title="Telegram orqali yozish"
                      >
                        <Send className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              </DialogHeader>

              <div className="p-3 space-y-2.5 max-h-[75vh] overflow-y-auto">
                {/* Telegram Bot bog'lanish statusi */}
                {(() => {
                  const tgLink = getLocalCustomerTelegramLink(quickCustomer.id);
                  const isLinked = tgLink?.linkStatus === "linked" || (quickCustomer.phone && !!getCustomerTelegramChatId(quickCustomer.phone));
                  return (
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-6 w-6 rounded-md bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
                          <Send className="h-3 w-3" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider">Telegram bot (Lichka chek)</div>
                          {isLinked ? (
                            <div className="text-emerald-500 font-semibold text-[11px] flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Ulangan (chek avto-boradi)
                            </div>
                          ) : (
                            <div className="text-muted-foreground text-[11px] flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Hali ulanmagan
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-[11px] border-sky-500/40 text-sky-400 hover:bg-sky-500/15 shrink-0 gap-1.5 font-medium"
                        onClick={() => {
                          setLinkCustomer({
                            id: quickCustomer.id,
                            name: quickCustomer.name,
                            phone: quickCustomer.phone,
                          });
                        }}
                      >
                        <QrCode className="h-3 w-3" /> Telegramni ulash
                      </Button>
                    </div>
                  );
                })()}
                {/* Balance + actions */}
                <div
                  className={cn(
                    "rounded-lg border p-2.5 flex items-center justify-between gap-2",
                    Number(quickCustomer.balance) > 0
                      ? "border-warning/30 bg-warning/5"
                      : "bg-muted/30",
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Joriy qarz
                    </div>
                    <div
                      className={cn(
                        "text-base font-mono font-bold",
                        Number(quickCustomer.balance) > 0
                          ? "text-warning"
                          : Number(quickCustomer.balance) < 0
                            ? "text-success"
                            : "",
                      )}
                    >
                      {fmtMoney(quickCustomer.balance)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => {
                      openPayFor(quickCustomer);
                      setQuickId(null);
                    }}
                  >
                    <Wallet className="h-3.5 w-3.5" /> To'lov
                  </Button>
                </div>

                {/* Action row — icon buttons */}
                <div className="grid grid-cols-4 gap-1.5">
                  <Button variant="outline" size="sm" asChild className="h-8 text-xs px-2">
                    <Link to="/customers/$id" params={{ id: quickCustomer.id }}>
                      <ExternalLink className="h-3 w-3" /> Batafsil
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2 font-medium border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => {
                      setAktSverkaCustomer(quickCustomer);
                    }}
                  >
                    <FileText className="h-3 w-3 mr-1" /> Akt
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2"
                    onClick={() => {
                      openEditFor(quickCustomer as Parameters<typeof openEditFor>[0]);
                      setQuickId(null);
                    }}
                  >
                    <Pencil className="h-3 w-3" /> Tahrir
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs px-2 text-destructive hover:text-destructive"
                    onClick={() => {
                      setRemoveId(quickCustomer.id);
                      setQuickId(null);
                    }}
                  >
                    <Trash2 className="h-3 w-3" /> O'chir
                  </Button>
                </div>

                {/* Recent sales — summary + expandable */}
                {(() => {
                  const sales = quickSales ?? [];
                  const totalSum = sales.reduce((a, s) => a + Number(s.total_sale || 0), 0);
                  const totalDebt = sales.reduce((a, s) => a + Number(s.remaining_debt || 0), 0);
                  const totalQty = sales.reduce((a, s) => {
                    const items =
                      (s as unknown as { sale_items?: Array<{ quantity: number }> }).sale_items ??
                      [];
                    return a + items.reduce((b, it) => b + Number(it.quantity || 0), 0);
                  }, 0);
                  const avgSale = sales.length > 0 ? totalSum / sales.length : 0;
                  return (
                    <div>
                      <div className="flex items-center justify-between mb-1.5 px-0.5">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <ShoppingCart className="h-3 w-3" /> Xaridlar ({sales.length})
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Jami:{" "}
                          <span className="font-mono font-semibold text-foreground">
                            {fmtMoney(totalSum)}
                          </span>
                          {totalDebt > 0 && (
                            <>
                              {" "}
                              · <span className="text-warning">{fmtMoney(totalDebt)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {sales.length > 0 && (
                        <div className="grid grid-cols-3 gap-1.5 mb-2">
                          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
                            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                              Dona
                            </div>
                            <div className="text-xs font-mono font-semibold tabular-nums">
                              {totalQty}
                            </div>
                          </div>
                          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
                            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                              O'rtacha
                            </div>
                            <div className="text-xs font-mono font-semibold tabular-nums truncate">
                              {fmtMoney(avgSale)}
                            </div>
                          </div>
                          <div className="rounded-md border bg-muted/30 px-2 py-1.5">
                            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                              Sotuvlar
                            </div>
                            <div className="text-xs font-mono font-semibold tabular-nums">
                              {sales.length}
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="rounded-lg border divide-y overflow-hidden">
                        {sales.map((s) => {
                          const items =
                            (
                              s as unknown as {
                                sale_items?: Array<{
                                  quantity: number;
                                  total_price: number;
                                  products: { name: string } | null;
                                }>;
                              }
                            ).sale_items ?? [];
                          const isOpen = expandedSale === s.id;
                          const itemCount = items.reduce(
                            (a, it) => a + Number(it.quantity || 0),
                            0,
                          );
                          return (
                            <div
                              key={s.id}
                              className={cn(s.status === "rolled_back" && "opacity-50")}
                            >
                              <button
                                onClick={() => setExpandedSale(isOpen ? null : s.id)}
                                className="w-full p-2 flex items-center gap-2 hover:bg-accent/40 text-left"
                              >
                                <ChevronDown
                                  className={cn(
                                    "h-3 w-3 text-muted-foreground shrink-0 transition-transform",
                                    !isOpen && "-rotate-90",
                                  )}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-muted-foreground truncate">
                                      {fmtDate(s.created_at)}
                                    </span>
                                    <span className="text-xs font-mono font-semibold shrink-0">
                                      {fmtMoney(s.total_sale)}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-2 mt-0.5">
                                    <span className="text-[10px] text-muted-foreground uppercase">
                                      {s.payment_method ?? "—"} · {items.length} mahsulot (
                                      {itemCount} dona)
                                    </span>
                                    {Number(s.remaining_debt) > 0 && (
                                      <span className="text-[10px] text-warning font-mono shrink-0">
                                        Qarz: {fmtMoney(s.remaining_debt)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                              {isOpen && (
                                <div className="px-2 pb-2 pl-7 bg-muted/20">
                                  {items.length > 0 ? (
                                    <div className="space-y-0.5 py-1">
                                      {items.map((it, i) => (
                                        <div
                                          key={i}
                                          className="flex items-center justify-between gap-2 text-[11px]"
                                        >
                                          <span className="flex items-center gap-1 min-w-0 truncate">
                                            <Package className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                                            <span className="truncate">
                                              {it.products?.name ?? "—"}
                                            </span>
                                            <span className="text-muted-foreground shrink-0">
                                              × {Number(it.quantity)}
                                            </span>
                                          </span>
                                          <span className="font-mono shrink-0">
                                            {fmtMoney(it.total_price)}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-[10px] text-muted-foreground py-1">
                                      Mahsulot yo'q
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1 pt-1 mt-1 border-t">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-2 text-[10px]"
                                      asChild
                                    >
                                      <Link to="/sales/$id" params={{ id: s.id }}>
                                        <ExternalLink className="h-3 w-3" /> Ochish
                                      </Link>
                                    </Button>
                                    {isSuperAdmin && s.status === "completed" && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 px-2 text-[10px] text-destructive"
                                        onClick={() => setRollbackId(s.id)}
                                      >
                                        <Trash2 className="h-3 w-3" /> Bekor
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {sales.length === 0 && (
                          <div className="p-4 text-center text-xs text-muted-foreground">
                            Xaridlar yo'q
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Recent payments */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Wallet className="h-3 w-3" /> Oxirgi to'lovlar
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {quickPayments?.length ?? 0}
                    </span>
                  </div>
                  <div className="rounded-lg border divide-y">
                    {(quickPayments ?? []).map((p) => (
                      <div key={p.id} className="p-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                            {fmtDate(p.created_at)} · <span className="uppercase">{p.method}</span>
                            <span
                              className={cn(
                                "rounded px-1 py-0.5 text-[9px]",
                                p.sale_id
                                  ? "bg-muted text-muted-foreground"
                                  : "bg-success/15 text-success",
                              )}
                            >
                              {p.sale_id ? "sotuv" : "qarz"}
                            </span>
                          </div>
                          <div className="text-sm font-mono font-semibold">
                            {fmtMoney(p.amount)}
                          </div>
                          {p.note && (
                            <div className="text-[10px] text-muted-foreground truncate">
                              {p.note}
                            </div>
                          )}
                        </div>
                        {isSuperAdmin && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() =>
                                setEditPay({
                                  id: p.id,
                                  amount: String(p.amount),
                                  note: p.note ?? "",
                                  method: p.method === "click" ? "click" : "cash",
                                })
                              }
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => setDeletePayId(p.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                    {(quickPayments ?? []).length === 0 && (
                      <div className="p-4 text-center text-xs text-muted-foreground">
                        To'lovlar yo'q
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit payment modal */}
      <Dialog open={!!editPay} onOpenChange={(v) => !v && setEditPay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>To'lovni tahrirlash</DialogTitle>
          </DialogHeader>
          {editPay && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/50 border p-2.5 text-xs text-muted-foreground">
                Saqlangach mijoz qarz qoldig'i avtomatik qayta hisoblanadi.
              </div>
              <div className="space-y-1.5">
                <Label>Summa</Label>
                <Input
                  type="number"
                  value={editPay.amount}
                  onChange={(e) => setEditPay({ ...editPay, amount: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>To'lov turi</Label>
                <Select
                  value={editPay.method}
                  onValueChange={(v) => setEditPay({ ...editPay, method: v as "cash" | "click" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Naqd</SelectItem>
                    <SelectItem value="click">Click</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Izoh</Label>
                <Input
                  value={editPay.note}
                  onChange={(e) => setEditPay({ ...editPay, note: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPay(null)}>
              Bekor
            </Button>
            <Button onClick={() => updatePay.mutate()} disabled={updatePay.isPending}>
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={payOpen}
        onOpenChange={(v) => {
          setPayOpen(v);
          if (!v) setPayCustomer(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>To'lov — {payCustomer?.name}</DialogTitle>
          </DialogHeader>
          {payCustomer && (
            <div className="space-y-3">
              <div
                className={cn(
                  "rounded-md border p-2.5 text-sm flex justify-between",
                  payCustomer.balance > 0 ? "bg-warning/10 border-warning/30" : "bg-success/10 border-success/30",
                )}
              >
                <span className="text-muted-foreground">
                  {payCustomer.balance > 0 ? "Joriy qarz" : payCustomer.balance < 0 ? "Oldindan to'langan" : "Balans"}
                </span>
                <span className={cn("font-mono font-semibold", payCustomer.balance > 0 ? "text-warning" : "text-success")}>
                  {fmtMoney(Math.abs(payCustomer.balance))}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Summa *</Label>
                  <Input
                    type="number"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Usul</Label>
                  <Select
                    value={payMethod}
                    onValueChange={(v) => setPayMethod(v as "cash" | "click")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Naqd</SelectItem>
                      <SelectItem value="click">Click</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Izoh</Label>
                <Input
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="Ixtiyoriy"
                />
              </div>
              {(history ?? []).length > 0 && (
                <div className="border rounded-md max-h-44 overflow-y-auto">
                  <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/30">
                    Oxirgi to'lovlar
                  </div>
                  <div className="divide-y text-xs">
                    {(history ?? []).map((h) => (
                      <div key={h.id} className="px-3 py-1.5 flex justify-between">
                        <span className="text-muted-foreground">
                          {fmtDate(h.created_at)} · {h.method}
                        </span>
                        <span className="font-mono">{fmtMoney(h.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              Bekor
            </Button>
            <Button onClick={() => pay.mutate()} disabled={pay.isPending || !payAmount}>
              To'lovni qabul qilish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removeId} onOpenChange={(v) => !v && setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mijozni o'chirish?</AlertDialogTitle>
            <AlertDialogDescription>
              Mijoz arxivga ko'chiriladi. Sotuvlar va to'lovlar saqlanib qoladi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removeId) remove.mutate(removeId);
                setRemoveId(null);
              }}
            >
              O'chirish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit customer dialog */}
      <Dialog open={!!editCustomer} onOpenChange={(v) => !v && setEditCustomer(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mijozni tahrirlash</DialogTitle>
          </DialogHeader>
          {editCustomer && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Ism *</Label>
                <Input
                  value={editCustomer.name}
                  onChange={(e) => setEditCustomer({ ...editCustomer, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Telefon</Label>
                <Input
                  value={editCustomer.phone}
                  onChange={(e) => setEditCustomer({ ...editCustomer, phone: e.target.value })}
                  placeholder="+998..."
                />
                <p className="text-[11px] text-muted-foreground">
                  Telegram bot va elektron cheklar aynan shu raqam orqali mijoz lichkasiga avtomatik yuboriladi.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Manzil</Label>
                <Input
                  value={editCustomer.address}
                  onChange={(e) => setEditCustomer({ ...editCustomer, address: e.target.value })}
                  placeholder="Ko'cha, uy..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Lokatsiya (xaritadan tanlang)</Label>
                <Suspense fallback={<MapFallback />}>
                  <LocationPicker
                    value={
                      editCustomer.lat && editCustomer.lng
                        ? { lat: Number(editCustomer.lat), lng: Number(editCustomer.lng) }
                        : null
                    }
                    onChange={(p) =>
                      setEditCustomer({
                        ...editCustomer,
                        lat: p ? String(p.lat) : "",
                        lng: p ? String(p.lng) : "",
                      })
                    }
                  />
                </Suspense>
              </div>
              <div className="space-y-1.5">
                <Label>Rasm</Label>
                {editCustomer.imageUrl && (
                  <img
                    src={editCustomer.imageUrl}
                    alt=""
                    onClick={() => setPreviewImage(editCustomer.imageUrl)}
                    className="h-32 w-full object-cover rounded-md border cursor-zoom-in"
                  />
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadCustomerImage(f);
                  }}
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadCustomerImage(f);
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                  >
                    <Upload className="h-4 w-4 mr-1.5" />{" "}
                    {uploading ? "Yuklanmoqda..." : "Rasm yuklash"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => cameraRef.current?.click()}
                    disabled={uploading}
                  >
                    <Camera className="h-4 w-4 mr-1.5" /> Rasmga olish
                  </Button>
                  {editCustomer.imageUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditCustomer({ ...editCustomer, imageUrl: null })}
                    >
                      O'chirish
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Qarz limiti</Label>
                <Input
                  type="number"
                  value={editCustomer.creditLimit}
                  onChange={(e) =>
                    setEditCustomer({ ...editCustomer, creditLimit: e.target.value })
                  }
                  placeholder="0 = limitsiz"
                />
                <p className="text-[11px] text-muted-foreground">
                  Mijoz qarzi shu summadan oshsa, sotuv taqiqlanadi. 0 = limit yo'q.
                </p>
              </div>
              {isSuperAdmin && (
                <div className="space-y-1.5">
                  <Label>Boshlang'ich qarz (ochilish)</Label>
                  <Input
                    type="number"
                    value={editCustomer.balance}
                    onChange={(e) => setEditCustomer({ ...editCustomer, balance: e.target.value })}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Joriy balans = Boshlang'ich qarz + sotuvlar − to'lovlar (avtomatik qayta hisoblanadi).
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCustomer(null)}>
              Bekor
            </Button>
            <Button
              onClick={() => updateCustomer.mutate()}
              disabled={updateCustomer.isPending || !editCustomer?.name.trim()}
            >
              Saqlash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePayId} onOpenChange={(v) => !v && setDeletePayId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>To'lovni o'chirish?</AlertDialogTitle>
            <AlertDialogDescription>
              To'lov yozuvi bazadan o'chiriladi va mijoz qarz qoldig'i avtomatik qayta hisoblanadi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Bekor</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deletePayId) deletePay.mutate(deletePayId);
                setDeletePayId(null);
              }}
            >
              O'chirish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!rollbackId} onOpenChange={(v) => !v && setRollbackId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sotuvni bekor qilish?</AlertDialogTitle>
            <AlertDialogDescription>
              Sotuv bekor qilinadi, mahsulotlar sklatga qaytariladi va mijoz qarzi to'g'rilanadi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Yo'q</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (rollbackId) rollbackSale.mutate(rollbackId);
                setRollbackId(null);
              }}
            >
              Ha, bekor qil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={inactiveOpen} onOpenChange={setInactiveOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Clock className="h-4 w-4 text-warning" /> Faolsiz mijozlar
            </DialogTitle>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Label className="text-xs text-muted-foreground">Kunlar:</Label>
              <Input
                type="number"
                value={inactiveDays}
                onChange={(e) => setInactiveDays(Math.max(1, Number(e.target.value) || 10))}
                className="h-7 w-20 text-xs"
              />
              <span className="text-muted-foreground">dan ko'p vaqt mahsulot olmagan</span>
            </div>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto divide-y">
            {inactiveList.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">Hammasi faol</div>
            )}
            {inactiveList.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setInactiveOpen(false);
                  setQuickId(c.id);
                }}
                className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning text-xs font-semibold uppercase">
                  {c.name.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {c.phone ?? "—"} ·{" "}
                    {c.lastSaleAt
                      ? `oxirgi: ${fmtDate(c.lastSaleAt)}`
                      : "hech qachon sotib olmagan"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-mono font-semibold text-warning">
                    {c.daysSince === null ? "—" : `${c.daysSince} kun`}
                  </div>
                  {Number(c.balance) > 0 && (
                    <div className="text-[10px] font-mono text-warning">
                      qarz: {fmtMoney(c.balance)}
                    </div>
                  )}
                </div>
                {c.phone && (
                  <a
                    onClick={(e) => e.stopPropagation()}
                    href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-card hover:bg-accent"
                  >
                    <Phone className="h-3.5 w-3.5 text-success" />
                  </a>
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Image preview lightbox */}
      <Dialog open={!!previewImage} onOpenChange={(v) => !v && setPreviewImage(null)}>
        <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden bg-background/95 border-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Rasm</DialogTitle>
          </DialogHeader>
          {previewImage && (
            <img
              src={previewImage}
              alt=""
              className="w-full max-h-[85vh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Nasiya Xabarnomalari Sozlamasi Markazi */}
      <NasiyaSettingsDialog open={nasiyaSettingsOpen} onOpenChange={setNasiyaSettingsOpen} />

      {/* To'lov muvaffaqiyatli qabul qilindi & Tezkor ulashish oynasi */}
      <Dialog open={!!paymentSuccess} onOpenChange={(v) => !v && setPaymentSuccess(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader className="text-center sm:text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 mb-2">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <DialogTitle className="text-lg">
              {paymentSuccess?.isOffline ? "Oflayn to'lov saqlandi ✓" : "To'lov muvaffaqiyatli qabul qilindi ✓"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {paymentSuccess?.isOffline
                ? "Internet mavjud bo'lmagani sababli to'lov xotiraga saqlandi. Aloqa tiklanganda avtomatik yuboriladi."
                : "Nasiya to'lovi rasmiylashtirildi va mijoz hisob-kitobiga kiritildi."}
            </DialogDescription>
          </DialogHeader>

          {paymentSuccess && (
            <div className="space-y-3 pt-1">
              <div className="rounded-xl border border-border/70 bg-card/80 p-3.5 space-y-2 text-sm shadow-sm">
                <div className="flex justify-between items-center text-xs pb-2 border-b border-border/50">
                  <span className="text-muted-foreground">Mijoz:</span>
                  <span className="font-semibold text-foreground">{paymentSuccess.customerName}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">To'langan summa:</span>
                  <span className="font-mono font-bold text-foreground text-sm">{fmtMoney(paymentSuccess.amountPaid)}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">To'lov usuli:</span>
                  <span className="font-semibold uppercase text-xs">{paymentSuccess.paymentMethod}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Qoplangan qarz:</span>
                  <span className="font-mono text-emerald-400 font-semibold">{fmtMoney(paymentSuccess.debtCleared)}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-2 border-t border-border/50">
                  <span className="text-muted-foreground font-medium">Qolgan qarz:</span>
                  <span className={cn("font-mono font-bold text-sm", paymentSuccess.remainingDebt > 0 ? "text-amber-400" : "text-emerald-400")}>
                    {fmtMoney(paymentSuccess.remainingDebt)}
                  </span>
                </div>
                {paymentSuccess.paymentNo && (
                  <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1">
                    <span>Chek №:</span>
                    <span className="font-mono">{paymentSuccess.paymentNo.slice(0, 10)}</span>
                  </div>
                )}
              </div>

              {/* 3 ta tezkor ulashish harakati */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 text-xs flex flex-col items-center justify-center gap-0.5 border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400"
                  onClick={() => {
                    const text = [
                      `SavdoPro — Qarz to'lovi cheki 📄`,
                      `━━━━━━━━━━━━━━━━━━━`,
                      `👤 Mijoz: ${paymentSuccess.customerName}`,
                      `💰 To'landi: ${fmtMoney(paymentSuccess.amountPaid)} (${paymentSuccess.paymentMethod.toUpperCase()})`,
                      `📌 Qolgan qarz: ${fmtMoney(paymentSuccess.remainingDebt)}`,
                      `📅 Sana: ${fmtDate(paymentSuccess.date)}`,
                      `━━━━━━━━━━━━━━━━━━━`,
                      `To'lovingiz uchun rahmat!`,
                    ].join("\n");
                    void navigator.clipboard.writeText(text);
                    toast.success("Telegram xabari nusxalandi!");
                    window.open(`https://t.me/share/url?url=&text=${encodeURIComponent(text)}`, "_blank");
                  }}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span className="text-[10px]">Telegram</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="h-10 text-xs flex flex-col items-center justify-center gap-0.5 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400"
                  onClick={() => {
                    const text = `Hurmatli ${paymentSuccess.customerName}, sizdan ${fmtMoney(paymentSuccess.amountPaid)} to'lov qabul qilindi. Qolgan qarz: ${fmtMoney(paymentSuccess.remainingDebt)}. Rahmat!`;
                    const phone = paymentSuccess.customerPhone?.replace(/[^+\d]/g, "") || "";
                    void navigator.clipboard.writeText(text);
                    toast.success("SMS matni nusxalandi!");
                    if (phone) {
                      window.location.href = `sms:${phone}?body=${encodeURIComponent(text)}`;
                    }
                  }}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="text-[10px]">SMS</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="h-10 text-xs flex flex-col items-center justify-center gap-0.5"
                  onClick={() => {
                    printDebtPaymentReceipt({
                      shop: "SavdoPro",
                      cashier: profile?.name,
                      customer: paymentSuccess.customerName,
                      amount: paymentSuccess.amountPaid,
                      debtCleared: paymentSuccess.debtCleared,
                      remainingDebt: paymentSuccess.remainingDebt,
                      method: paymentSuccess.paymentMethod === "cash" ? "Naqd" : "Click",
                      receiptNo: paymentSuccess.paymentNo,
                      note: paymentSuccess.note,
                      date: paymentSuccess.date,
                    });
                  }}
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span className="text-[10px]">Chek</span>
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button className="w-full" onClick={() => setPaymentSuccess(null)}>
              Tugatish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Akt Sverka (O'zaro hisob-kitob solishtirma dalolatnomasi) Dialog */}
      <Dialog open={!!aktSverkaCustomer} onOpenChange={(v) => !v && setAktSverkaCustomer(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 border-b">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" /> Akt Sverka — {aktSverkaCustomer?.name}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Barcha nasiya savdolar va to'lovlarning xronologik hisob-kitob varaqasi
                </DialogDescription>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleShareAktTelegram}>
                  <Share2 className="h-3.5 w-3.5 mr-1 text-sky-400" /> Telegram
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handlePrintAkt}>
                  <Printer className="h-3.5 w-3.5 mr-1" /> Chop etish
                </Button>
              </div>
            </div>
          </DialogHeader>

          {/* Summary Strip */}
          <div className="p-3 bg-muted/20 border-b grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border bg-card p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Jami nasiya xarid</div>
              <div className="font-mono font-bold text-xs sm:text-sm text-foreground mt-0.5">
                {fmtMoney(aktLedger.totalDebit)}
              </div>
            </div>
            <div className="rounded-lg border bg-card p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Jami to'langan</div>
              <div className="font-mono font-bold text-xs sm:text-sm text-emerald-400 mt-0.5">
                {fmtMoney(aktLedger.totalCredit)}
              </div>
            </div>
            <div className="rounded-lg border bg-card p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hozirgi qarz</div>
              <div className={cn("font-mono font-bold text-xs sm:text-sm mt-0.5", aktLedger.finalBalance > 0 ? "text-amber-400" : "text-emerald-400")}>
                {fmtMoney(aktLedger.finalBalance)}
              </div>
            </div>
          </div>

          {/* Transactions table */}
          <div className="flex-1 overflow-y-auto p-4">
            {aktSalesLoading || aktPaymentsLoading ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                Yuklanmoqda...
              </div>
            ) : aktLedger.items.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted-foreground">
                Hisob-kitoblar tarixi topilmadi
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Sana</th>
                      <th className="px-3 py-2 text-left">Operatsiya</th>
                      <th className="px-3 py-2 text-right">Kirim (+)</th>
                      <th className="px-3 py-2 text-right">Chiqim (-)</th>
                      <th className="px-3 py-2 text-right">Qoldiq</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono">
                    {aktLedger.items.map((row, idx) => (
                      <tr key={idx} className="hover:bg-muted/20">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{row.date}</td>
                        <td className="px-3 py-2 font-sans font-medium text-foreground">{row.title}</td>
                        <td className="px-3 py-2 text-right text-rose-400 font-semibold">
                          {row.debit > 0 ? `+${fmtMoney(row.debit)}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-400 font-semibold">
                          {row.credit > 0 ? `-${fmtMoney(row.credit)}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-foreground">
                          {fmtMoney(row.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter className="p-3 border-t bg-muted/10 flex justify-between items-center sm:justify-between">
            <div className="text-[11px] text-muted-foreground">
              SavdoPro tizimida qayd etilgan rasmiy dalolatnoma
            </div>
            <Button variant="outline" size="sm" onClick={() => setAktSverkaCustomer(null)}>
              Yopish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Telegram Botga Ulash (QR-kod va bir martalik maxfiy havola modali) */}
      <CustomerTelegramLinkDialog
        open={!!linkCustomer}
        onOpenChange={(v) => !v && setLinkCustomer(null)}
        customer={linkCustomer}
        onLinkUpdated={() => qc.invalidateQueries()}
      />
    </>
  );
}
