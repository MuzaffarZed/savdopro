import { openDB, type IDBPDatabase } from "idb";
import { supabase } from "@/integrations/supabase/client";

export interface HoldCartItem {
  product_id: string;
  name: string;
  qty: number;
  price: number;
  maxQty?: number;
}

export interface HoldCart {
  id: string;
  created_at: number;
  label: string;
  customer_id: string;
  customer_name?: string;
  items: HoldCartItem[];
  total: number;
  amount_paid: string;
  payment_method: "cash" | "click" | "split";
  cash_paid: string;
  click_paid: string;
  discount_type?: "amount" | "percent";
  discount_val?: string;
  note?: string;
}

export interface QueuedDebtPayment {
  id: string;
  created_at: number;
  payload: {
    _customer_id: string;
    _amount: number;
    _method: "cash" | "click";
    _note: string | null;
    _user_id: string;
    _idempotency_key: string;
  };
  status: "pending" | "syncing" | "failed" | "blocked";
  error?: string;
  attempts: number;
  next_attempt_at?: number;
}

const DB_NAME = "savdopro-offline-v2";
const STORE_HOLD_CARTS = "hold-carts";
const STORE_CATALOG_CACHE = "catalog-cache";
const STORE_PAYMENTS_QUEUE = "payments-queue";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getStoreDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_HOLD_CARTS)) {
          db.createObjectStore(STORE_HOLD_CARTS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_CATALOG_CACHE)) {
          db.createObjectStore(STORE_CATALOG_CACHE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_PAYMENTS_QUEUE)) {
          db.createObjectStore(STORE_PAYMENTS_QUEUE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

// ==================== HOLD CARTS (SAVATNI MUZLATISH) ====================

const holdListeners = new Set<() => void>();
export function subscribeHoldCarts(fn: () => void) {
  holdListeners.add(fn);
  return () => holdListeners.delete(fn);
}
function notifyHold() {
  holdListeners.forEach((fn) => fn());
}

export async function saveHoldCart(
  cart: Omit<HoldCart, "id" | "created_at">
): Promise<HoldCart> {
  const db = await getStoreDB();
  const id = `hold_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const timeStr = new Date(now).toLocaleTimeString("uz-UZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const label = cart.label || `Savat (${timeStr})${cart.customer_name ? ` — ${cart.customer_name}` : ""}`;

  const entry: HoldCart = {
    ...cart,
    id,
    created_at: now,
    label,
  };

  await db.put(STORE_HOLD_CARTS, entry);
  notifyHold();
  return entry;
}

export async function listHoldCarts(): Promise<HoldCart[]> {
  const db = await getStoreDB();
  const all = (await db.getAll(STORE_HOLD_CARTS)) as HoldCart[];
  return all.sort((a, b) => b.created_at - a.created_at);
}

export async function deleteHoldCart(id: string): Promise<void> {
  const db = await getStoreDB();
  await db.delete(STORE_HOLD_CARTS, id);
  notifyHold();
}

export async function clearAllHoldCarts(): Promise<void> {
  const db = await getStoreDB();
  await db.clear(STORE_HOLD_CARTS);
  notifyHold();
}

// ==================== LOCAL MASTER CATALOG CACHE ====================

export async function cacheLocalStock(warehouseId: string, stock: unknown[]): Promise<void> {
  if (!warehouseId || !stock) return;
  const db = await getStoreDB();
  await db.put(STORE_CATALOG_CACHE, {
    key: `stock_${warehouseId}`,
    data: stock,
    updated_at: Date.now(),
  });
}

export async function getLocalStock(warehouseId: string): Promise<unknown[] | null> {
  if (!warehouseId) return null;
  const db = await getStoreDB();
  const res = await db.get(STORE_CATALOG_CACHE, `stock_${warehouseId}`);
  return res ? (res.data as unknown[]) : null;
}

export async function cacheLocalCustomers(customers: unknown[]): Promise<void> {
  if (!customers) return;
  const db = await getStoreDB();
  await db.put(STORE_CATALOG_CACHE, {
    key: "customers",
    data: customers,
    updated_at: Date.now(),
  });
}

export async function getLocalCustomers(): Promise<unknown[] | null> {
  const db = await getStoreDB();
  const res = await db.get(STORE_CATALOG_CACHE, "customers");
  return res ? (res.data as unknown[]) : null;
}

export async function cacheLocalWarehouses(warehouses: unknown[]): Promise<void> {
  if (!warehouses) return;
  const db = await getStoreDB();
  await db.put(STORE_CATALOG_CACHE, {
    key: "warehouses",
    data: warehouses,
    updated_at: Date.now(),
  });
}

export async function getLocalWarehouses(): Promise<unknown[] | null> {
  const db = await getStoreDB();
  const res = await db.get(STORE_CATALOG_CACHE, "warehouses");
  return res ? (res.data as unknown[]) : null;
}

/**
 * Offline savdo bo'lganda ekrandagi mahalliy qoldiqni zudlik bilan kamaytiradi.
 * Bu orqali sotuvchi bir xil tovardan qayta sotib yubormaydi!
 */
export async function applyLocalOptimisticStockSale(
  warehouseId: string,
  soldItems: Array<{ product_id: string; quantity: number }>
): Promise<void> {
  if (!warehouseId || soldItems.length === 0) return;
  const cached = await getLocalStock(warehouseId);
  if (!cached || !Array.isArray(cached)) return;

  const soldMap = new Map<string, number>();
  soldItems.forEach((i) => soldMap.set(i.product_id, (soldMap.get(i.product_id) || 0) + i.quantity));

  const updated = cached.map((item) => {
    const raw = item as { product_id: string; total: number; totalValue?: number; minCost?: number };
    const soldQty = soldMap.get(raw.product_id);
    if (soldQty) {
      const newTotal = Math.max(0, raw.total - soldQty);
      return { ...raw, total: newTotal };
    }
    return raw;
  });

  await cacheLocalStock(warehouseId, updated);
}

/**
 * Offline qarz to'lovi bo'lganda mijoz balansini lokal keshda darhol yangilaydi.
 */
export async function applyLocalOptimisticDebtPayment(
  customerId: string,
  amount: number
): Promise<void> {
  if (!customerId || !(amount > 0)) return;
  const cached = await getLocalCustomers();
  if (!cached || !Array.isArray(cached)) return;

  const updated = cached.map((cust) => {
    const c = cust as { id: string; balance: number };
    if (c.id === customerId) {
      return { ...c, balance: Math.max(0, Number(c.balance || 0) - amount) };
    }
    return c;
  });

  await cacheLocalCustomers(updated);
}

// ==================== OFFLINE DEBT PAYMENT QUEUE ====================

const payListeners = new Set<() => void>();
export function subscribePaymentQueue(fn: () => void) {
  payListeners.add(fn);
  return () => payListeners.delete(fn);
}
function notifyPayments() {
  payListeners.forEach((fn) => fn());
}

export async function enqueueDebtPayment(item: QueuedDebtPayment): Promise<void> {
  const db = await getStoreDB();
  await db.put(STORE_PAYMENTS_QUEUE, item);
  notifyPayments();
}

export async function listQueuedDebtPayments(): Promise<QueuedDebtPayment[]> {
  const db = await getStoreDB();
  const all = (await db.getAll(STORE_PAYMENTS_QUEUE)) as QueuedDebtPayment[];
  return all.sort((a, b) => a.created_at - b.created_at);
}

export async function removeQueuedDebtPayment(id: string): Promise<void> {
  const db = await getStoreDB();
  await db.delete(STORE_PAYMENTS_QUEUE, id);
  notifyPayments();
}

export async function updateQueuedDebtPayment(item: QueuedDebtPayment): Promise<void> {
  const db = await getStoreDB();
  await db.put(STORE_PAYMENTS_QUEUE, item);
  notifyPayments();
}

let syncingPayments = false;

export async function syncDebtPaymentQueue(): Promise<{ ok: number; failed: number; blocked: number }> {
  if (syncingPayments || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return { ok: 0, failed: 0, blocked: 0 };
  }
  syncingPayments = true;
  let ok = 0;
  let failed = 0;
  let blocked = 0;

  try {
    const items = await listQueuedDebtPayments();
    const now = Date.now();

    for (const it of items) {
      if (it.status === "syncing" || it.status === "blocked") continue;
      if (it.next_attempt_at && it.next_attempt_at > now) continue;

      it.status = "syncing";
      it.attempts += 1;
      await updateQueuedDebtPayment(it);

      const { error } = await supabase.rpc("process_debt_payment", it.payload as never);

      if (!error) {
        await removeQueuedDebtPayment(it.id);
        ok++;
        continue;
      }

      const msg = error.message ?? String(error);
      if (msg.includes("Mijoz topilmadi") || msg.includes("Ruxsat yo'q")) {
        it.status = "blocked";
        it.error = msg;
        await updateQueuedDebtPayment(it);
        blocked++;
      } else if (it.attempts >= 8) {
        it.status = "blocked";
        it.error = `${msg} (max urinishlar tugadi)`;
        await updateQueuedDebtPayment(it);
        blocked++;
      } else {
        it.status = "pending";
        it.error = msg;
        it.next_attempt_at = Date.now() + Math.min(5000 * 2 ** (it.attempts - 1), 300000);
        await updateQueuedDebtPayment(it);
        failed++;
      }
    }
  } finally {
    syncingPayments = false;
  }

  return { ok, failed, blocked };
}
