import { openDB, type IDBPDatabase } from "idb";
import { supabase } from "@/integrations/supabase/client";

export interface QueuedSale {
  id: string; // idempotency key
  created_at: number;
  payload: {
    _branch_id: string;
    _warehouse_id: string;
    _customer_id: string | null;
    _items: Array<{ product_id: string; quantity: number; sell_price: number }>;
    _amount_paid: number;
    _payment_method: "cash" | "click";
    _user_id: string;
    _idempotency_key: string;
    _cash_paid?: number | null;
    _click_paid?: number | null;
  };
  status: "pending" | "syncing" | "failed" | "blocked";
  error?: string;
  attempts: number;
  next_attempt_at?: number;
}

const DB_NAME = "nexus-offline";
const STORE = "sales-queue";
let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function enqueueSale(item: QueuedSale) {
  const db = await getDB();
  await db.put(STORE, item);
  notify();
}

export async function listQueued(): Promise<QueuedSale[]> {
  const db = await getDB();
  const all = (await db.getAll(STORE)) as QueuedSale[];
  return all.sort((a, b) => a.created_at - b.created_at);
}

export async function removeQueued(id: string) {
  const db = await getDB();
  await db.delete(STORE, id);
  notify();
}

export async function updateQueued(item: QueuedSale) {
  const db = await getDB();
  await db.put(STORE, item);
  notify();
}

export async function retryQueued(id: string) {
  const db = await getDB();
  const it = (await db.get(STORE, id)) as QueuedSale | undefined;
  if (!it) return;
  it.status = "pending";
  it.error = undefined;
  it.next_attempt_at = Date.now();
  await db.put(STORE, it);
  notify();
  void syncQueue();
}

const listeners = new Set<() => void>();
export function subscribeQueue(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach((f) => f());
}

// Heuristic: errors that won't go away by retrying — block them for manual review.
function isPermanentError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("not enough stock") ||
    m.includes("insufficient stock") ||
    m.includes("missing") ||
    m.includes("must be") ||
    m.includes("cannot be negative") ||
    m.includes("no items") ||
    m.includes("violates") ||
    m.includes("foreign key") ||
    m.includes("duplicate key")
  );
}

const MAX_ATTEMPTS = 8;
function backoffMs(attempts: number) {
  // 5s, 10s, 20s, 40s, ... capped at 5 min
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 5 * 60_000);
}

let syncing = false;
let syncListeners = new Set<(ev: SyncEvent) => void>();
export type SyncEvent =
  | { type: "start"; id: string }
  | { type: "ok"; id: string }
  | { type: "fail"; id: string; error: string; attempt: number; nextAt: number }
  | { type: "blocked"; id: string; error: string };

export function subscribeSyncEvents(fn: (ev: SyncEvent) => void) {
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
}
function emit(ev: SyncEvent) { syncListeners.forEach((f) => f(ev)); }

export async function syncQueue(): Promise<{ ok: number; failed: number; blocked: number }> {
  if (syncing || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return { ok: 0, failed: 0, blocked: 0 };
  }
  syncing = true;
  let ok = 0, failed = 0, blocked = 0;
  try {
    const items = await listQueued();
    const now = Date.now();
    for (const it of items) {
      if (it.status === "syncing" || it.status === "blocked") continue;
      if (it.next_attempt_at && it.next_attempt_at > now) continue;

      it.status = "syncing"; it.attempts += 1;
      await updateQueued(it);
      emit({ type: "start", id: it.id });

      const { error } = await supabase.rpc("process_sale", it.payload as never);

      if (!error) {
        // Success — RPC's idempotency_keys table guarantees no double-charge
        // even if this is a replay of a previously committed sale.
        await removeQueued(it.id);
        ok++;
        emit({ type: "ok", id: it.id });
        continue;
      }

      const msg = error.message ?? String(error);
      if (isPermanentError(msg)) {
        it.status = "blocked";
        it.error = msg;
        await updateQueued(it);
        blocked++;
        emit({ type: "blocked", id: it.id, error: msg });
      } else if (it.attempts >= MAX_ATTEMPTS) {
        it.status = "blocked";
        it.error = `${msg} (max urinishlar tugadi)`;
        await updateQueued(it);
        blocked++;
        emit({ type: "blocked", id: it.id, error: msg });
      } else {
        it.status = "pending";
        it.error = msg;
        it.next_attempt_at = Date.now() + backoffMs(it.attempts);
        await updateQueued(it);
        failed++;
        emit({ type: "fail", id: it.id, error: msg, attempt: it.attempts, nextAt: it.next_attempt_at });
      }
    }
  } finally {
    syncing = false;
  }
  return { ok, failed, blocked };
}

import { syncDebtPaymentQueue } from "./offline-store";

export function startAutoSync() {
  if (typeof window === "undefined") return;
  const tick = () => {
    void syncQueue();
    void syncDebtPaymentQueue();
  };
  window.addEventListener("online", tick);
  // Poll every 15s; syncQueue itself respects per-item backoff.
  const iv = window.setInterval(tick, 15_000);
  void syncQueue();
  void syncDebtPaymentQueue();
  return () => { window.removeEventListener("online", tick); window.clearInterval(iv); };
}