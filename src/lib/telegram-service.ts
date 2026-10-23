/**
 * SavdoPro POS — Telegram Bot Integratsiyasi & Mijozlarni Xavfsiz Bog'lash Moduli
 * Rasmiy Standart: Xusniddin 2002 / Janob Muzaffar texnik spetsifikatsiyasi
 * Dasturchi: MuzaffarZed
 */

import { supabase } from "@/integrations/supabase/client";
import { fmtMoney, fmtDate } from "./format";
import QRCode from "qrcode";

// ======================= MODELLAR VA TURLAR =======================

export type LinkStatus = "not_linked" | "linked" | "disconnected";

export interface CustomerTelegramLink {
  id?: string;
  customerId: string;
  telegramChatId?: number | null;
  telegramUsername?: string | null;
  linkStatus: LinkStatus;
  tokenHash?: string | null;
  tokenExpiresAt?: string | null;
  linkedAt?: string | null;
  updatedAt?: string;
}

export interface TelegramOutboxMessage {
  id: string;
  customerId?: string | null;
  customerName?: string;
  saleId?: string | null;
  paymentId?: string | null;
  eventType: "sale" | "payment" | "test";
  telegramChatId: number;
  status: "pending" | "processing" | "sent" | "failed";
  telegramMessageId?: number | null;
  formattedText: string;
  attemptCount: number;
  lastError?: string | null;
  idempotencyKey: string;
  createdAt: string;
  sentAt?: string | null;
  nextRetryAt?: string | null;
}

export interface TelegramBotSettings {
  botToken: string;
  botUsername: string;
  businessName: string;
  autoSendSale: boolean;
  autoSendPayment: boolean;
}

export interface SaleReceiptPayload {
  saleNumber: string;
  date: Date;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    unit?: string;
    lineTotal: number;
  }>;
  saleTotal: number;
  salePaid: number;
  saleDebt: number;
  previousBalance: number;
  newDebt: number;
  currentBalance: number;
  paymentMethod: string;
  splitCash?: number;
  splitClick?: number;
  discountAmount?: number;
}

export interface PaymentReceiptPayload {
  paymentNumber: string;
  date: Date;
  paymentMethod: string;
  paymentAmount: number;
  previousBalance: number;
  currentBalance: number;
}

// ======================= DOIMIY SOZLAMALAR VA LOCAL STORE =======================

const TG_SETTINGS_STORAGE_KEY = "savdopro_telegram_settings_v2";
const TG_LINKS_STORAGE_KEY = "savdopro_customer_telegram_links_v2";
const TG_MESSAGES_STORAGE_KEY = "savdopro_telegram_messages_outbox_v2";

export const DEFAULT_TELEGRAM_SETTINGS: TelegramBotSettings = {
  botToken: "",
  botUsername: "SavdoProBot",
  businessName: "SavdoPro",
  autoSendSale: true,
  autoSendPayment: true,
};

export function loadTelegramSettings(): TelegramBotSettings {
  if (typeof window === "undefined") return DEFAULT_TELEGRAM_SETTINGS;
  try {
    const raw = localStorage.getItem(TG_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_TELEGRAM_SETTINGS;
    return { ...DEFAULT_TELEGRAM_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_TELEGRAM_SETTINGS;
  }
}

export function saveTelegramSettings(settings: Partial<TelegramBotSettings>): TelegramBotSettings {
  const current = loadTelegramSettings();
  const updated = { ...current, ...settings };
  if (typeof window !== "undefined") {
    localStorage.setItem(TG_SETTINGS_STORAGE_KEY, JSON.stringify(updated));
  }
  return updated;
}

// Local cache for links
export function loadLocalLinks(): Record<string, CustomerTelegramLink> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(TG_LINKS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getLocalCustomerTelegramLink(customerId: string): CustomerTelegramLink | null {
  const local = loadLocalLinks();
  return local[customerId] ?? null;
}

export function getAllLocalCustomerTelegramLinks(): Record<string, CustomerTelegramLink> {
  return loadLocalLinks();
}

export function saveLocalLinks(links: Record<string, CustomerTelegramLink>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TG_LINKS_STORAGE_KEY, JSON.stringify(links));
  } catch {}
}

// Local cache for messages outbox
export function loadLocalOutbox(): TelegramOutboxMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TG_MESSAGES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLocalOutbox(messages: TelegramOutboxMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TG_MESSAGES_STORAGE_KEY, JSON.stringify(messages.slice(0, 500)));
  } catch {}
}

// ======================= SHA-256 VA TOKEN XAVFSIZLIGI =======================

export async function computeSha256(str: string): Promise<string> {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Oddiy fallback
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, "0");
}

export function generateRandomToken(): string {
  if (typeof window !== "undefined" && window.crypto) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// ======================= MIJOZNI TELEGRAMGA BOG'LASH =======================

export interface GeneratedDeepLinkResult {
  deepLink: string;
  rawToken: string;
  qrDataUrl: string;
  expiresAt: string;
}

/**
 * Mijoz uchun xavfsiz, bir martalik va muddati 24 soat bo'lgan ulanish havolasi va QR-kod yaratadi.
 */
export async function createCustomerDeepLink(
  customerId: string,
  botUsernameOverride?: string
): Promise<GeneratedDeepLinkResult> {
  const settings = loadTelegramSettings();
  const rawBotUser = (botUsernameOverride || settings.botUsername || "SavdoProBot").replace("@", "").trim();
  const rawToken = generateRandomToken();
  const tokenHash = await computeSha256(rawToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Local saqlash
  const local = loadLocalLinks();
  const existing = local[customerId];
  local[customerId] = {
    customerId,
    telegramChatId: existing?.telegramChatId ?? null,
    telegramUsername: existing?.telegramUsername ?? null,
    linkStatus: existing?.linkStatus === "linked" ? "linked" : "not_linked",
    tokenHash,
    tokenExpiresAt: expiresAt,
    linkedAt: existing?.linkedAt ?? null,
    updatedAt: new Date().toISOString(),
  };
  saveLocalLinks(local);

  // Supabase saqlashga urinish (agar jadval bo'lsa)
  try {
    await supabase.from("customer_telegram_links" as never).upsert({
      customer_id: customerId,
      token_hash: tokenHash,
      token_expires_at: expiresAt,
      link_status: existing?.linkStatus === "linked" ? "linked" : "not_linked",
      updated_at: new Date().toISOString(),
    } as never);
  } catch {
    // remote table mavjud bo'lmasa xato bermaydi
  }

  const deepLink = `https://t.me/${rawBotUser}?start=link_${rawToken}`;
  const qrDataUrl = await QRCode.toDataURL(deepLink, {
    width: 280,
    margin: 1.5,
    color: {
      dark: "#0284c7",
      light: "#ffffff",
    },
  });

  return {
    deepLink,
    rawToken,
    qrDataUrl,
    expiresAt,
  };
}

/**
 * Mijozning joriy Telegram bog'lanish statusini tekshirish
 */
export async function getCustomerTelegramLink(customerId: string): Promise<CustomerTelegramLink> {
  const local = loadLocalLinks();
  const localData = local[customerId];

  try {
    const { data, error } = await supabase
      .from("customer_telegram_links" as never)
      .select("*")
      .eq("customer_id", customerId)
      .maybeSingle();

    if (!error && data) {
      const row = data as {
        customer_id: string;
        telegram_chat_id: number | null;
        telegram_username: string | null;
        link_status: LinkStatus;
        token_hash: string | null;
        token_expires_at: string | null;
        linked_at: string | null;
      };
      const merged: CustomerTelegramLink = {
        customerId: row.customer_id,
        telegramChatId: row.telegram_chat_id,
        telegramUsername: row.telegram_username,
        linkStatus: row.link_status || "not_linked",
        tokenHash: row.token_hash,
        tokenExpiresAt: row.token_expires_at,
        linkedAt: row.linked_at,
      };
      local[customerId] = merged;
      saveLocalLinks(local);
      return merged;
    }
  } catch {
    // fallback to local
  }

  if (localData) return localData;

  return {
    customerId,
    linkStatus: "not_linked",
  };
}

/**
 * Mijozning Telegram bog'lanishini uzish (Disconnect)
 */
export async function disconnectCustomerTelegram(customerId: string): Promise<boolean> {
  const local = loadLocalLinks();
  if (local[customerId]) {
    local[customerId].linkStatus = "disconnected";
    local[customerId].telegramChatId = null;
    local[customerId].tokenHash = null;
    local[customerId].updatedAt = new Date().toISOString();
    saveLocalLinks(local);
  }

  try {
    await supabase.from("customer_telegram_links" as never).upsert({
      customer_id: customerId,
      link_status: "disconnected",
      telegram_chat_id: null,
      token_hash: null,
      updated_at: new Date().toISOString(),
    } as never);
  } catch {
    // fallback
  }

  return true;
}

/**
 * Bot tomondan tokenni tekshirish va Chat ID ni bog'lash
 */
export async function verifyAndBindCustomerTelegram(
  rawToken: string,
  chatId: number,
  username?: string
): Promise<{ ok: boolean; customerId?: string; error?: string }> {
  const tokenHash = await computeSha256(rawToken);
  const now = new Date();

  // 1. Bir Telegram hisobini boshqa mijozga noqonuniy ulanishidan himoya (Unique Constraint)
  const local = loadLocalLinks();
  for (const [cid, link] of Object.entries(local)) {
    if (link.telegramChatId === chatId && link.linkStatus === "linked" && link.tokenHash !== tokenHash) {
      return {
        ok: false,
        error: "Ushbu Telegram hisobi allaqachon boshqa do'kon mijoziga bog'langan.",
      };
    }
  }

  // 2. Token mosligini topish
  let targetCustomerId: string | null = null;
  for (const [cid, link] of Object.entries(local)) {
    if (link.tokenHash === tokenHash) {
      if (link.tokenExpiresAt && new Date(link.tokenExpiresAt) < now) {
        return { ok: false, error: "Ulanish havolasi muddati o'tgan (24 soat tugagan)." };
      }
      targetCustomerId = cid;
      break;
    }
  }

  if (!targetCustomerId) {
    return { ok: false, error: "Ulanish kodi topilmadi yoki allaqachon ishlatilgan." };
  }

  // 3. Bog'lashni yakunlash (Tokenni bir martalik qilib bekor qilish)
  local[targetCustomerId] = {
    ...local[targetCustomerId],
    telegramChatId: chatId,
    telegramUsername: username || null,
    linkStatus: "linked",
    linkedAt: now.toISOString(),
    tokenHash: null, // Bir martalik qilib o'chiriladi
    tokenExpiresAt: null,
    updatedAt: now.toISOString(),
  };
  saveLocalLinks(local);

  try {
    await supabase.from("customer_telegram_links" as never).upsert({
      customer_id: targetCustomerId,
      telegram_chat_id: chatId,
      telegram_username: username || null,
      link_status: "linked",
      linked_at: now.toISOString(),
      token_hash: null,
      token_expires_at: null,
      updated_at: now.toISOString(),
    } as never);
  } catch {}

  return { ok: true, customerId: targetCustomerId };
}

// ======================= EXACT SHABLON FORMATTERLAR (UZBEK UZS) =======================

/**
 * 4-QISM: SAVDODAN KEYINGI XABAR SHABLONI (100% spetsifikatsiya talabiga mos)
 */
export function formatSaleReceiptMessage(
  payload: SaleReceiptPayload,
  businessNameOverride?: string
): string {
  const settings = loadTelegramSettings();
  const businessName = businessNameOverride || settings.businessName || "SavdoPro";
  const dateStr = fmtDate(payload.date);

  const productLines = payload.items
    .map((item) => {
      const unit = item.unit ? ` ${item.unit}` : "";
      return `${item.name} — ${item.quantity}${unit} × ${fmtMoney(item.unitPrice)} = ${fmtMoney(item.lineTotal)} so‘m`;
    })
    .join("\n");

  let paymentMethodDetail = payload.paymentMethod;
  if (payload.splitCash && payload.splitClick) {
    paymentMethodDetail = `Naqd ${fmtMoney(payload.splitCash)} so‘m, Click ${fmtMoney(payload.splitClick)} so‘m`;
  }

  return [
    `🧾 POS APP — XARID CHEKI`,
    ``,
    `Assalomu alaykum, hurmatli mijoz!`,
    ``,
    `Savdo №: ${payload.saleNumber}`,
    `Sana: ${dateStr}`,
    `To‘lov usuli: ${paymentMethodDetail}`,
    ``,
    `Mahsulotlar:`,
    productLines,
    ``,
    payload.discountAmount && payload.discountAmount > 0
      ? `Chegirma: ${fmtMoney(payload.discountAmount)} so‘m\n`
      : ``,
    `Xarid jami: ${fmtMoney(payload.saleTotal)} so‘m`,
    `Ushbu savdoda to‘landi: ${fmtMoney(payload.salePaid)} so‘m`,
    `Ushbu savdodan qolgan qarz: ${fmtMoney(payload.saleDebt)} so‘m`,
    ``,
    `📊 UMUMIY HISOB-KITOB`,
    `Oldingi qarz: ${fmtMoney(payload.previousBalance)} so‘m`,
    `Yangi savdo qarzi: ${fmtMoney(payload.newDebt)} so‘m`,
    `Umumiy qarz qoldig‘i: ${fmtMoney(payload.currentBalance)} so‘m`,
    ``,
    `Xaridingiz uchun rahmat!`,
    `${businessName}`,
    `by MuzaffarZed`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

/**
 * 5-QISM: TO'LOVDAN KEYINGI XABAR SHABLONI (100% spetsifikatsiya talabiga mos)
 */
export function formatPaymentReceiptMessage(
  payload: PaymentReceiptPayload,
  businessNameOverride?: string
): string {
  const settings = loadTelegramSettings();
  const businessName = businessNameOverride || settings.businessName || "SavdoPro";
  const dateStr = fmtDate(payload.date);

  const lines = [
    `💰 POS APP — TO‘LOV CHEKI`,
    ``,
    `Assalomu alaykum!`,
    ``,
    `To‘lov qabul qilindi.`,
    `To‘lov №: ${payload.paymentNumber}`,
    `Sana: ${dateStr}`,
    `To‘lov usuli: ${payload.paymentMethod}`,
    ``,
    `To‘langan summa: ${fmtMoney(payload.paymentAmount)} so‘m`,
    `To‘lovdan oldingi umumiy qarz: ${fmtMoney(payload.previousBalance)} so‘m`,
    `To‘lovdan keyingi umumiy qarz: ${fmtMoney(payload.currentBalance)} so‘m`,
    ``,
  ];

  if (payload.currentBalance <= 0) {
    lines.push(`“Qarzingiz to‘liq yopildi. To‘lov uchun rahmat!”`);
    lines.push(``);
  }

  lines.push(`${businessName}`);
  lines.push(`by MuzaffarZed`);

  return lines.join("\n");
}

// ======================= TELEGRAM DISPATCHER & OUTBOX QUEUE =======================

/**
 * Telegram bot orqali to'g'ridan-to'g'ri xabar yuborish
 */
export async function sendTelegramDirectMessage(
  botToken: string,
  chatId: number,
  text: string
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  if (!botToken || !chatId) {
    return { ok: false, error: "Bot tokeni yoki Chat ID kiritilmagan" };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken.trim()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });

    const data = await res.json();
    if (res.ok && data.ok) {
      return { ok: true, messageId: data.result?.message_id };
    }
    return { ok: false, error: data.description || "Telegram API xatolik berdi" };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Tranzaksiyani to'xtatmaydigan (Non-blocking) xabar navbati va jo'natish
 */
export async function enqueueAndSendTelegramMessage(
  msg: Omit<TelegramOutboxMessage, "id" | "createdAt" | "attemptCount" | "status">
): Promise<{ enqueued: boolean; sent: boolean; error?: string }> {
  const settings = loadTelegramSettings();
  const id = `MSG-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const outbox = loadLocalOutbox();

  // Idempotency tekshiruvi — bir xil savdo yoki to'lov ikki marta yuborilmasin
  const exists = outbox.find((m) => m.idempotencyKey === msg.idempotencyKey);
  if (exists && exists.status === "sent") {
    return { enqueued: true, sent: true };
  }

  const outboxEntry: TelegramOutboxMessage = {
    ...msg,
    id,
    attemptCount: 1,
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  outbox.unshift(outboxEntry);
  saveLocalOutbox(outbox);

  // Supabase telegram_messages jadvaliga ham saqlashga urinish
  try {
    await supabase.from("telegram_messages" as never).insert({
      id,
      customer_id: msg.customerId || null,
      sale_id: msg.saleId || null,
      payment_id: msg.paymentId || null,
      event_type: msg.eventType,
      telegram_chat_id: msg.telegramChatId,
      status: "pending",
      formatted_text: msg.formattedText,
      attempt_count: 1,
      idempotency_key: msg.idempotencyKey,
      created_at: outboxEntry.createdAt,
    } as never);
  } catch {}

  // Fon rejimida darhol jo'natish (Non-blocking)
  if (settings.botToken && msg.telegramChatId) {
    try {
      const sendRes = await sendTelegramDirectMessage(settings.botToken, msg.telegramChatId, msg.formattedText);
      const updatedOutbox = loadLocalOutbox();
      const item = updatedOutbox.find((m) => m.id === id);

      if (sendRes.ok) {
        if (item) {
          item.status = "sent";
          item.sentAt = new Date().toISOString();
          item.telegramMessageId = sendRes.messageId;
          saveLocalOutbox(updatedOutbox);
        }
        try {
          await supabase
            .from("telegram_messages" as never)
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              telegram_message_id: sendRes.messageId,
            } as never)
            .eq("id", id);
        } catch {}

        return { enqueued: true, sent: true };
      } else {
        if (item) {
          item.status = "failed";
          item.lastError = sendRes.error;
          saveLocalOutbox(updatedOutbox);
        }
        try {
          await supabase
            .from("telegram_messages" as never)
            .update({
              status: "failed",
              last_error: sendRes.error,
            } as never)
            .eq("id", id);
        } catch {}

        return { enqueued: true, sent: false, error: sendRes.error };
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { enqueued: true, sent: false, error: errorMsg };
    }
  }

  return { enqueued: true, sent: false, error: "Bot tokeni sozlanmagan yoki Chat ID yo'q" };
}

/**
 * Xabarni qayta yuborish (Resend)
 */
export async function resendTelegramMessage(
  messageId: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = loadTelegramSettings();
  if (!settings.botToken) {
    return { ok: false, error: "Bot token sozlanmagan" };
  }

  const outbox = loadLocalOutbox();
  const msg = outbox.find((m) => m.id === messageId);
  if (!msg) {
    return { ok: false, error: "Xabar topilmadi" };
  }

  msg.attemptCount = (msg.attemptCount || 0) + 1;
  const sendRes = await sendTelegramDirectMessage(settings.botToken, msg.telegramChatId, msg.formattedText);

  if (sendRes.ok) {
    msg.status = "sent";
    msg.sentAt = new Date().toISOString();
    msg.lastError = null;
    msg.telegramMessageId = sendRes.messageId;
    saveLocalOutbox(outbox);

    try {
      await supabase
        .from("telegram_messages" as never)
        .update({
          status: "sent",
          sent_at: msg.sentAt,
          attempt_count: msg.attemptCount,
          telegram_message_id: sendRes.messageId,
          last_error: null,
        } as never)
        .eq("id", messageId);
    } catch {}

    return { ok: true };
  } else {
    msg.status = "failed";
    msg.lastError = sendRes.error;
    saveLocalOutbox(outbox);

    try {
      await supabase
        .from("telegram_messages" as never)
        .update({
          status: "failed",
          attempt_count: msg.attemptCount,
          last_error: sendRes.error,
        } as never)
        .eq("id", messageId);
    } catch {}

    return { ok: false, error: sendRes.error };
  }
}
