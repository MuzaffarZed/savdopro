export const fmtMoney = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(v) + " so'm";
};

export const fmtNum = (n: number | string | null | undefined, digits = 3) => {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: digits }).format(v);
};

export const fmtDate = (s: string | Date | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  return new Intl.DateTimeFormat("uz-UZ", { dateStyle: "medium", timeStyle: "short" }).format(d);
};

export const newIdempotencyKey = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function isQopProduct(name?: string | null, category?: string | null): boolean {
  if (!name && !category) return false;
  const n = (name || "").toLowerCase();
  const c = (category || "").toLowerCase();
  if (c.includes("parashok") || c.includes("kir yuvish") || c.includes("poroshok")) return true;
  if (n.includes("aprel") || n.includes("avtomat") || n.includes("nixol") || n.includes("parashok") || n.includes("poroshok")) return true;
  return false;
}

export function getProductUnit(name?: string | null, category?: string | null): string {
  if (isQopProduct(name, category)) return "qop";
  const n = (name || "").toLowerCase();
  if (n.includes("tuxum") || n.includes("paket")) return "dona";
  return "dona";
}

