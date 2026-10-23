import { fmtMoney, fmtDate } from "./format";

export interface NasiyaItem {
  name: string;
  qty: number;
  price: number;
}

export interface RegularSaleData {
  shopName: string;
  branchName?: string;
  cashierName?: string;
  customerName?: string;
  customerPhone?: string;
  customerTelegramChatId?: string;
  receiptNo?: string;
  items: NasiyaItem[];
  totalSale: number;
  amountPaid: number;
  paymentMethod: string;
  currentDebtBalance?: number;
  date?: Date;
}

export interface NasiyaSaleData {
  shopName: string;
  branchName?: string;
  cashierName?: string;
  customerName?: string;
  customerPhone?: string;
  customerTelegramChatId?: string;
  receiptNo?: string;
  items: NasiyaItem[];
  totalSale: number;
  amountPaid: number;
  previousDebt: number;
  newDebtAdded: number;
  finalDebt: number;
  paymentMethod: string;
  date?: Date;
}

export interface NasiyaPaymentData {
  shopName: string;
  branchName?: string;
  cashierName?: string;
  customerName?: string;
  customerPhone?: string;
  customerTelegramChatId?: string;
  paymentNo?: string;
  amountPaid: number;
  previousDebt: number;
  debtCleared: number;
  finalDebt: number;
  paymentMethod: string;
  note?: string;
  date?: Date;
}

export interface NasiyaNotificationSettings {
  enabled: boolean;               // Asosiy ON/OFF kaliti
  telegramEnabled: boolean;       // Telegram orqali yuborish
  smsEnabled: boolean;            // SMS orqali yuborish
  
  // Do'kon & Chek shaxsiy ma'lumotlari
  shopDisplayName: string;        // Do'kon yoki brend nomi
  shopPhone: string;              // Bog'lanish uchun telefon
  receiptFooterNote: string;      // Xabar ostidagi minnatdorchilik / qoida eslatmasi
  includeCashierName: boolean;    // Kassir ismini chiqarish
  includeBranchName: boolean;     // Filial nomini chiqarish
  showItemDetails: boolean;       // Mahsulotlar ro'yxatini batafsil chiqarish
  
  // Telegram sozlamalari
  telegramBotToken: string;       // BotFather tokeni
  telegramBotUsername?: string;   // Botning @username i
  telegramChatId: string;         // Kanal yoki guruh IDsi
  
  // Maxfiylik va Shaxsiy Lichka (Privacy Core)
  directCustomerBotEnabled: boolean; // Chekni faqat mijozning shaxsiy Telegram lichkasiga yuborish
  sendGroupCopy: boolean;            // Kanal yoki guruhga zaxira nusxa tashlash (ixtiyoriy)
  
  // Oddiy savdolar
  regularSalesEnabled: boolean;      // Qarz bo'lmagan oddiy savdolarda ham elektron chek yuborish
  
  // SMS sozlamalari
  smsProvider: "device_sms" | "eskiz" | "playmobile";
  smsApiToken: string;            // SMS shlyuz tokeni
  eskizEmail?: string;            // Eskiz kabinet emaili
  eskizPassword?: string;         // Eskiz paroli
  
  // Avtomatlashtirish & Yuborish usullari
  autoSendOnSale: boolean;        // Nasiya savdoda avtomatik jo'natish
  autoSendOnPayment: boolean;     // Qarz to'langanda avtomatik jo'natish
  autoSendRegularSale: boolean;   // Oddiy savdoda avtomatik jo'natish
}

export const DEFAULT_NASIYA_SETTINGS: NasiyaNotificationSettings = {
  enabled: true,
  telegramEnabled: true,
  smsEnabled: false,
  shopDisplayName: "SavdoPro",
  shopPhone: "+998 90 000 00 00",
  receiptFooterNote: "Xaridingiz uchun rahmat!",
  includeCashierName: true,
  includeBranchName: true,
  showItemDetails: true,
  telegramBotToken: "",
  telegramBotUsername: "",
  telegramChatId: "",
  directCustomerBotEnabled: true,
  sendGroupCopy: false,
  regularSalesEnabled: true,
  smsProvider: "device_sms",
  smsApiToken: "",
  eskizEmail: "",
  eskizPassword: "",
  autoSendOnSale: true,
  autoSendOnPayment: true,
  autoSendRegularSale: true,
};

const SETTINGS_KEY = "nexus_nasiya_settings_v1";
const LOGS_KEY = "nexus_nasiya_logs_v1";
const CUSTOMER_TG_MAP_KEY = "savdopro_customer_telegrams_v1";

export function loadNasiyaSettings(): NasiyaNotificationSettings {
  if (typeof window === "undefined") return DEFAULT_NASIYA_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_NASIYA_SETTINGS;
    return { ...DEFAULT_NASIYA_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_NASIYA_SETTINGS;
  }
}

export function saveNasiyaSettings(settings: Partial<NasiyaNotificationSettings>): NasiyaNotificationSettings {
  const current = loadNasiyaSettings();
  const updated = { ...current, ...settings };
  if (typeof window !== "undefined") {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  }
  return updated;
}

// ======================= MIJOZ-TELEGRAM BOG'LASH (MAPPING) =======================

export function getCustomerTelegramMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CUSTOMER_TG_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCustomerTelegramMapping(phone: string, chatId: string): void {
  if (typeof window === "undefined" || !phone) return;
  try {
    const clean = phone.replace(/[^0-9]/g, "");
    const map = getCustomerTelegramMap();
    map[clean] = chatId;
    localStorage.setItem(CUSTOMER_TG_MAP_KEY, JSON.stringify(map));
  } catch {}
}

export function getCustomerTelegramChatId(phone?: string): string | null {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, "");
  const map = getCustomerTelegramMap();
  return map[clean] || null;
}

// ======================= XABARLAR JURNALI (AUDIT LOGS) =======================

export interface NasiyaLogEntry {
  id: string;
  timestamp: number;
  type: "sale" | "payment" | "regular_sale";
  customerName?: string;
  customerPhone?: string;
  amount: number;
  debt: number;
  channel: "telegram" | "sms" | "both" | "direct";
  status: "sent" | "failed" | "opened";
  errorText?: string;
  textPreview: string;
}

export function loadNasiyaLogs(): NasiyaLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOGS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function addNasiyaLog(entry: Omit<NasiyaLogEntry, "id" | "timestamp">): void {
  if (typeof window === "undefined") return;
  try {
    const logs = loadNasiyaLogs();
    const newEntry: NasiyaLogEntry = {
      ...entry,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now(),
    };
    // Faqat oxirgi 50 ta xabarni saqlash
    const updated = [newEntry, ...logs].slice(0, 50);
    localStorage.setItem(LOGS_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

export function clearNasiyaLogs(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(LOGS_KEY);
  }
}

// ======================= RECEIPT MATNLARI =======================

/**
 * Oddiy savdoda (naqd, click, aralash) qarz bo'lmaganda yoki to'liq to'langanda elektron chek matni.
 */
export function buildRegularSaleReceiptText(
  data: RegularSaleData,
  options?: { channel?: "telegram" | "sms"; settings?: NasiyaNotificationSettings }
): string {
  const s = options?.settings ?? loadNasiyaSettings();
  const isTg = options?.channel !== "sms";
  const showDetails = s.showItemDetails;
  const d = data.date ?? new Date();
  const dateStr = fmtDate(d);
  const shop = s.shopDisplayName || data.shopName || "SavdoPro";
  const footerNote = s.receiptFooterNote || "Xaridingiz uchun rahmat!";
  const phone = s.shopPhone;
  const debt = data.currentDebtBalance ?? 0;

  if (!isTg) {
    const itemsCount = data.items.reduce((acc, i) => acc + i.qty, 0);
    return (
      `[${shop}]\n` +
      `Savdo xarid cheki\n` +
      `Sana: ${dateStr}\n` +
      `Jami: ${fmtMoney(data.totalSale)} so'm (${data.items.length} xil, ${itemsCount} dona)\n` +
      `To'landi: ${fmtMoney(data.amountPaid)} so'm (${data.paymentMethod})\n` +
      `Qarz: ${debt > 0 ? `${fmtMoney(debt)} so'm` : "0 so'm (To'liq to'landi)"}\n` +
      (phone ? `Tel: ${phone}\n` : "") +
      `${footerNote}`
    );
  }

  let text = `🧾 *${shop.toUpperCase()} — XARID CHEKI*\n`;
  if (s.includeBranchName && data.branchName) text += `📍 Filial: ${data.branchName}\n`;
  text += `📅 Sana: ${dateStr}\n`;
  if (data.receiptNo) text += `🔢 Chek №: #${data.receiptNo.slice(0, 8)}\n`;
  if (s.includeCashierName && data.cashierName) text += `👤 Sotuvchi: ${data.cashierName}\n`;
  if (data.customerName) text += `🤝 Xaridor: ${data.customerName}\n`;
  text += `------------------------------------\n`;

  if (showDetails && data.items.length > 0) {
    text += `📦 *XARID QILINGAN TOVARLAR:*\n`;
    data.items.forEach((item, idx) => {
      const lineTotal = item.qty * item.price;
      text += `${idx + 1}. *${item.name}*\n`;
      text += `   ${item.qty} dona × ${fmtMoney(item.price)} = ${fmtMoney(lineTotal)} so'm\n`;
    });
    text += `------------------------------------\n`;
  }

  const totalQty = data.items.reduce((acc, i) => acc + i.qty, 0);
  text += `💰 Jami summa: *${fmtMoney(data.totalSale)} so'm* (${data.items.length} xil, ${totalQty} dona)\n`;
  text += `💳 To'landi: *${fmtMoney(data.amountPaid)} so'm* (${data.paymentMethod})\n`;
  text += `------------------------------------\n`;
  if (debt > 0) {
    text += `📊 Qoldiq qarz balansi: *${fmtMoney(debt)} so'm*\n`;
  } else {
    text += `🟢 *To'lov holati:* To'liq to'langan (Qarz: 0 so'm)\n`;
  }
  text += `------------------------------------\n`;
  if (phone) text += `📞 Aloqa: ${phone}\n`;
  text += `🙏 ${footerNote}`;

  return text;
}

/**
 * Nasiyaga tovar olinganda to'liq batafsil chek matnini shakllantiradi.
 */
export function buildNasiyaSaleReceiptText(
  data: NasiyaSaleData,
  options?: { channel?: "telegram" | "sms"; settings?: NasiyaNotificationSettings }
): string {
  const s = options?.settings ?? loadNasiyaSettings();
  const isTg = options?.channel !== "sms";
  const showDetails = s.showItemDetails;
  const d = data.date ?? new Date();
  const dateStr = fmtDate(d);
  const shop = s.shopDisplayName || data.shopName || "SavdoPro";
  const footerNote = s.receiptFooterNote || "Xaridingiz uchun rahmat!";
  const phone = s.shopPhone;

  if (!isTg) {
    // SMS uchun ixcham va tushunarli format
    const itemsCount = data.items.reduce((acc, i) => acc + i.qty, 0);
    return (
      `[${shop}]\n` +
      `Nasiya savdo cheki\n` +
      `Sana: ${dateStr}\n` +
      `Jami: ${fmtMoney(data.totalSale)} so'm (${data.items.length} xil, ${itemsCount} dona)\n` +
      `To'landi: ${fmtMoney(data.amountPaid)} so'm\n` +
      `Eski qarz: ${fmtMoney(data.previousDebt)} so'm\n` +
      `Qo'shilgan qarz: +${fmtMoney(data.newDebtAdded)} so'm\n` +
      `Qolgan qarz: ${fmtMoney(data.finalDebt)} so'm\n` +
      (phone ? `Tel: ${phone}\n` : "") +
      `${footerNote}`
    );
  }

  // Telegram uchun to'liq va mukammal format
  let text = `🧾 *${shop.toUpperCase()} — NASIYA SAVDO CHEKI*\n`;
  if (s.includeBranchName && data.branchName) text += `📍 Filial: ${data.branchName}\n`;
  text += `📅 Sana: ${dateStr}\n`;
  if (data.receiptNo) text += `🔢 Chek №: #${data.receiptNo.slice(0, 8)}\n`;
  if (s.includeCashierName && data.cashierName) text += `👤 Sotuvchi: ${data.cashierName}\n`;
  if (data.customerName) text += `🤝 Mijoz: ${data.customerName}\n`;
  text += `------------------------------------\n`;

  if (showDetails && data.items.length > 0) {
    text += `📦 *XARID QILINGAN TOVARLAR:*\n`;
    data.items.forEach((item, idx) => {
      const lineTotal = item.qty * item.price;
      text += `${idx + 1}. *${item.name}*\n`;
      text += `   ${item.qty} dona × ${fmtMoney(item.price)} = ${fmtMoney(lineTotal)} so'm\n`;
    });
    text += `------------------------------------\n`;
  }

  const totalQty = data.items.reduce((acc, i) => acc + i.qty, 0);
  text += `💰 Jami tovarlar: *${fmtMoney(data.totalSale)} so'm* (${data.items.length} xil, ${totalQty} dona)\n`;
  text += `💳 To'langan: *${fmtMoney(data.amountPaid)} so'm* (${data.paymentMethod})\n`;
  text += `------------------------------------\n`;
  text += `📊 *NASIYA VA QARZ HISOB-KITOBI:*\n`;
  text += `• Avvalgi qarz balansi: ${fmtMoney(data.previousDebt)} so'm\n`;
  text += `• Yangi qo'shilgan qarz: *+${fmtMoney(data.newDebtAdded)} so'm*\n`;
  text += `🔴 *YAKUNIY QOLGAN QARZ:* *${fmtMoney(data.finalDebt)} so'm*\n`;
  text += `------------------------------------\n`;
  if (phone) text += `📞 Aloqa: ${phone}\n`;
  text += `🙏 ${footerNote}`;

  return text;
}

/**
 * Qarz to'langanda to'lov kvitansiyasi matnini shakllantiradi.
 */
export function buildNasiyaPaymentReceiptText(
  data: NasiyaPaymentData,
  options?: { channel?: "telegram" | "sms"; settings?: NasiyaNotificationSettings }
): string {
  const s = options?.settings ?? loadNasiyaSettings();
  const isTg = options?.channel !== "sms";
  const d = data.date ?? new Date();
  const dateStr = fmtDate(d);
  const shop = s.shopDisplayName || data.shopName || "SavdoPro";
  const footerNote = s.receiptFooterNote || "To'lov uchun rahmat!";
  const phone = s.shopPhone;

  if (!isTg) {
    // SMS uchun ixcham format
    return (
      `[${shop}]\n` +
      `Qarz to'lovi qabul qilindi\n` +
      `Sana: ${dateStr}\n` +
      `To'landi: ${fmtMoney(data.amountPaid)} so'm (${data.paymentMethod})\n` +
      `Eski qarz: ${fmtMoney(data.previousDebt)} so'm\n` +
      `O'chirilgan qarz: -${fmtMoney(data.debtCleared)} so'm\n` +
      `Qolgan qarz: ${data.finalDebt <= 0 ? "0 so'm (To'liq yopildi!)" : `${fmtMoney(data.finalDebt)} so'm`}\n` +
      (phone ? `Tel: ${phone}\n` : "") +
      `${footerNote}`
    );
  }

  // Telegram uchun to'liq format
  let text = `✅ *${shop.toUpperCase()} — QARZ TO'LOVI KVITANSIYASI*\n`;
  if (s.includeBranchName && data.branchName) text += `📍 Filial: ${data.branchName}\n`;
  text += `📅 Sana: ${dateStr}\n`;
  if (data.paymentNo) text += `🔢 Kvitansiya №: #${data.paymentNo.slice(0, 8)}\n`;
  if (s.includeCashierName && data.cashierName) text += `👤 Qabul qildi: ${data.cashierName}\n`;
  if (data.customerName) text += `🤝 Mijoz: ${data.customerName}\n`;
  text += `------------------------------------\n`;
  text += `💵 *QABUL QILINGAN TO'LOV:* *${fmtMoney(data.amountPaid)} so'm*\n`;
  text += `💳 To'lov usuli: ${data.paymentMethod}\n`;
  if (data.note) text += `📝 Izoh: ${data.note}\n`;
  text += `------------------------------------\n`;
  text += `📊 *QARZ QOLDIG'I O'ZGARISHI:*\n`;
  text += `• To'lovdan oldingi qarz: ${fmtMoney(data.previousDebt)} so'm\n`;
  text += `• O'chirilgan (so'ndirilgan) qarz: *-${fmtMoney(data.debtCleared)} so'm*\n`;
  if (data.finalDebt <= 0) {
    text += `🎉 *QARZINGIZ TO'LIQ YOPILDI! Qoldiq: 0 so'm*\n`;
  } else {
    text += `🟢 *QOLGAN QARZ BALANSI:* *${fmtMoney(data.finalDebt)} so'm*\n`;
  }
  text += `------------------------------------\n`;
  if (phone) text += `📞 Aloqa: ${phone}\n`;
  text += `🙏 ${footerNote}`;

  return text;
}

// ======================= TELEGRAM & SMS YORDAMCHILARI =======================

/**
 * Telegram Bot tokenini tekshirish (getMe orqali)
 */
export async function verifyTelegramBotToken(token: string): Promise<{ ok: boolean; username?: string; firstName?: string; error?: string }> {
  if (!token || token.trim().length < 10) {
    return { ok: false, error: "Bot tokeni kiritilmagan yoki juda qisqa" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`);
    const json = await res.json();
    if (res.ok && json.ok && json.result) {
      return {
        ok: true,
        username: json.result.username,
        firstName: json.result.first_name,
      };
    }
    return { ok: false, error: json.description || "Token noto'g'ri yoki bot topilmadi" };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Internet tarmog'iga ulanib bo'lmadi" };
  }
}

/**
 * Telegram Bot orqali xabar yuborish funksiyasi.
 */
export async function sendTelegramMessage(
  text: string,
  botToken: string,
  chatId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!botToken || !chatId) {
    return { ok: false, error: "Telegram bot token yoki Chat ID kiritilmagan" };
  }
  try {
    const url = `https://api.telegram.org/bot${botToken.trim()}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: text,
        parse_mode: "Markdown",
      }),
    });
    const result = await res.json();
    if (!res.ok || !result.ok) {
      return { ok: false, error: result.description || "Telegram API xatolik berdi" };
    }
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * To'g'ridan-to'g'ri Telegramda ulashish (Direct Telegram Link)
 */
export function buildDirectTelegramShareUrl(phone?: string, text?: string): string {
  const encText = encodeURIComponent(text || "");
  const cleanPhone = phone?.replace(/[^0-9]/g, "");
  if (cleanPhone && cleanPhone.length >= 9) {
    const p = cleanPhone.startsWith("998") ? cleanPhone : `998${cleanPhone}`;
    return `https://t.me/+${p}?text=${encText}`;
  }
  return `https://t.me/share/url?url=&text=${encText}`;
}

/**
 * To'g'ridan-to'g'ri SMS havolasi
 */
export function buildDirectSmsShareUrl(phone: string, text: string): string {
  const cleanPhone = phone.replace(/[^0-9]/g, "");
  return `sms:${cleanPhone}?body=${encodeURIComponent(text)}`;
}

/**
 * SMS Gateway orqali xabar yuborish.
 */
export async function sendSmsMessage(
  phone: string,
  message: string,
  settings: NasiyaNotificationSettings
): Promise<{ ok: boolean; error?: string }> {
  const cleanPhone = phone.replace(/[^0-9]/g, "");
  if (!cleanPhone || cleanPhone.length < 9) {
    return { ok: false, error: "Mijoz telefon raqami noto'g'ri yoki mavjud emas" };
  }

  // Agar telefon qurilmasidagi SIM karta orqali jo'natish bo'lsa
  if (settings.smsProvider === "device_sms") {
    if (typeof window !== "undefined") {
      const smsUrl = buildDirectSmsShareUrl(cleanPhone, message);
      window.open(smsUrl, "_blank");
      return { ok: true };
    }
  }

  // Eskiz.uz provayderi orqali HTTP API
  if (settings.smsProvider === "eskiz") {
    if (!settings.smsApiToken) return { ok: false, error: "Eskiz.uz API token kiritilmagan" };
    try {
      const res = await fetch("https://notify.eskiz.uz/api/message/sms/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.smsApiToken}`,
        },
        body: JSON.stringify({
          mobile_phone: cleanPhone.startsWith("998") ? cleanPhone : `998${cleanPhone}`,
          message: message,
          from: "4546",
        }),
      });
      const data = await res.json();
      return res.ok ? { ok: true } : { ok: false, error: data.message || "Eskiz xatolik berdi" };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { ok: false, error: "SMS provayder sozlanmagan" };
}

// ======================= DISPATCHER FUNKSIYALARI =======================

/**
 * Nasiya xabarnomasini markaziy jo'natish:
 * - Sozlamadagi ON/OFF tekshiriladi
 * - Agar mijozning shaxsiy Telegram ID si bo'lsa, xabar guruhga EMAS, uning shaxsiy lichkasiga yuboriladi!
 * - Natija audit jurnaliga yoziladi
 */
export async function dispatchNasiyaSaleNotification(
  data: NasiyaSaleData
): Promise<{ sent: boolean; telegram?: boolean; sms?: boolean; errors?: string[] }> {
  const settings = loadNasiyaSettings();

  if (!settings.enabled || !settings.autoSendOnSale) {
    return { sent: false };
  }

  const errors: string[] = [];
  let tgSuccess = false;
  let smsSuccess = false;
  const tgText = buildNasiyaSaleReceiptText(data, { channel: "telegram", settings });

  // 1. Telegram Lichka yoki Kanal
  if (settings.telegramEnabled && settings.telegramBotToken) {
    const customerChatId = data.customerTelegramChatId || getCustomerTelegramChatId(data.customerPhone);
    const targetChatId = settings.directCustomerBotEnabled && customerChatId
      ? customerChatId
      : settings.telegramChatId;

    if (targetChatId) {
      const res = await sendTelegramMessage(tgText, settings.telegramBotToken, targetChatId);
      if (res.ok) tgSuccess = true;
      else errors.push(`Telegram: ${res.error}`);
    }

    // Guruh/kanalga zaxira nusxa (agar ruxsat berilgan bo'lsa va chat_id alohida bo'lsa)
    if (settings.sendGroupCopy && settings.telegramChatId && targetChatId !== settings.telegramChatId) {
      await sendTelegramMessage(tgText, settings.telegramBotToken, settings.telegramChatId);
    }
  }

  // 2. SMS
  if (settings.smsEnabled && data.customerPhone) {
    const smsText = buildNasiyaSaleReceiptText(data, { channel: "sms", settings });
    const res = await sendSmsMessage(data.customerPhone, smsText, settings);
    if (res.ok) smsSuccess = true;
    else errors.push(`SMS: ${res.error}`);
  }

  // Jurnalga kiritish
  addNasiyaLog({
    type: "sale",
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    amount: data.totalSale,
    debt: data.finalDebt,
    channel: tgSuccess && smsSuccess ? "both" : tgSuccess ? "telegram" : smsSuccess ? "sms" : "telegram",
    status: tgSuccess || smsSuccess ? "sent" : "failed",
    errorText: errors.join(", ") || undefined,
    textPreview: tgText.slice(0, 150) + "...",
  });

  return {
    sent: tgSuccess || smsSuccess,
    telegram: tgSuccess,
    sms: smsSuccess,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Qarz to'langanda to'lov kvitansiyasini markaziy jo'natish
 */
export async function dispatchNasiyaPaymentNotification(
  data: NasiyaPaymentData
): Promise<{ sent: boolean; telegram?: boolean; sms?: boolean; errors?: string[] }> {
  const settings = loadNasiyaSettings();

  if (!settings.enabled || !settings.autoSendOnPayment) {
    return { sent: false };
  }

  const errors: string[] = [];
  let tgSuccess = false;
  let smsSuccess = false;
  const tgText = buildNasiyaPaymentReceiptText(data, { channel: "telegram", settings });

  // 1. Telegram Lichka yoki Kanal
  if (settings.telegramEnabled && settings.telegramBotToken) {
    const customerChatId = data.customerTelegramChatId || getCustomerTelegramChatId(data.customerPhone);
    const targetChatId = settings.directCustomerBotEnabled && customerChatId
      ? customerChatId
      : settings.telegramChatId;

    if (targetChatId) {
      const res = await sendTelegramMessage(tgText, settings.telegramBotToken, targetChatId);
      if (res.ok) tgSuccess = true;
      else errors.push(`Telegram: ${res.error}`);
    }

    if (settings.sendGroupCopy && settings.telegramChatId && targetChatId !== settings.telegramChatId) {
      await sendTelegramMessage(tgText, settings.telegramBotToken, settings.telegramChatId);
    }
  }

  // 2. SMS
  if (settings.smsEnabled && data.customerPhone) {
    const smsText = buildNasiyaPaymentReceiptText(data, { channel: "sms", settings });
    const res = await sendSmsMessage(data.customerPhone, smsText, settings);
    if (res.ok) smsSuccess = true;
    else errors.push(`SMS: ${res.error}`);
  }

  // Jurnalga kiritish
  addNasiyaLog({
    type: "payment",
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    amount: data.amountPaid,
    debt: data.finalDebt,
    channel: tgSuccess && smsSuccess ? "both" : tgSuccess ? "telegram" : smsSuccess ? "sms" : "telegram",
    status: tgSuccess || smsSuccess ? "sent" : "failed",
    errorText: errors.join(", ") || undefined,
    textPreview: tgText.slice(0, 150) + "...",
  });

  return {
    sent: tgSuccess || smsSuccess,
    telegram: tgSuccess,
    sms: smsSuccess,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Oddiy savdoda elektron xarid chekini markaziy jo'natish (Qarzsiz savdolar uchun)
 */
export async function dispatchRegularSaleNotification(
  data: RegularSaleData
): Promise<{ sent: boolean; telegram?: boolean; sms?: boolean; errors?: string[] }> {
  const settings = loadNasiyaSettings();

  if (!settings.enabled || !settings.regularSalesEnabled || !settings.autoSendRegularSale) {
    return { sent: false };
  }

  const errors: string[] = [];
  let tgSuccess = false;
  let smsSuccess = false;
  const tgText = buildRegularSaleReceiptText(data, { channel: "telegram", settings });

  // 1. Telegram Lichka yoki Kanal
  if (settings.telegramEnabled && settings.telegramBotToken) {
    const customerChatId = data.customerTelegramChatId || getCustomerTelegramChatId(data.customerPhone);
    const targetChatId = settings.directCustomerBotEnabled && customerChatId
      ? customerChatId
      : settings.telegramChatId;

    if (targetChatId) {
      const res = await sendTelegramMessage(tgText, settings.telegramBotToken, targetChatId);
      if (res.ok) tgSuccess = true;
      else errors.push(`Telegram: ${res.error}`);
    }

    if (settings.sendGroupCopy && settings.telegramChatId && targetChatId !== settings.telegramChatId) {
      await sendTelegramMessage(tgText, settings.telegramBotToken, settings.telegramChatId);
    }
  }

  // 2. SMS
  if (settings.smsEnabled && data.customerPhone) {
    const smsText = buildRegularSaleReceiptText(data, { channel: "sms", settings });
    const res = await sendSmsMessage(data.customerPhone, smsText, settings);
    if (res.ok) smsSuccess = true;
    else errors.push(`SMS: ${res.error}`);
  }

  // Jurnalga kiritish
  addNasiyaLog({
    type: "regular_sale",
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    amount: data.totalSale,
    debt: data.currentDebtBalance ?? 0,
    channel: tgSuccess && smsSuccess ? "both" : tgSuccess ? "telegram" : smsSuccess ? "sms" : "telegram",
    status: tgSuccess || smsSuccess ? "sent" : "failed",
    errorText: errors.join(", ") || undefined,
    textPreview: tgText.slice(0, 150) + "...",
  });

  return {
    sent: tgSuccess || smsSuccess,
    telegram: tgSuccess,
    sms: smsSuccess,
    errors: errors.length > 0 ? errors : undefined,
  };
}
