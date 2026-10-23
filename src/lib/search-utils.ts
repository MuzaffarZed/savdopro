// SavdoPro Enterprise - Aqlli va Tezkor Qidiruv Mexanizmi (Lotin <-> Kirill va Telefon normallashtirish)
// Dasturchi: MuzaffarZed

const LAT_TO_CYR_MAP: Record<string, string> = {
  "sh": "ш", "ch": "ч", "yo": "ё", "yu": "ю", "ya": "я", "ye": "е",
  "o'": "ў", "o`": "ў", "g'": "ғ", "g`": "ғ",
  "a": "а", "b": "б", "d": "д", "e": "е", "f": "ф", "g": "г", "h": "ҳ",
  "i": "и", "j": "ж", "k": "к", "l": "л", "m": "м", "n": "н", "o": "о",
  "p": "п", "q": "қ", "r": "р", "s": "с", "t": "т", "u": "у", "v": "в",
  "x": "х", "y": "й", "z": "з", "'": "ъ", "`": "ъ"
};

const CYR_TO_LAT_MAP: Record<string, string> = {
  "ш": "sh", "ч": "ch", "ё": "yo", "ю": "yu", "я": "ya", "е": "e",
  "ў": "o'", "ғ": "g'", "қ": "q", "ҳ": "h",
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "ж": "j", "з": "z",
  "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
  "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "x",
  "ц": "ts", "ъ": "'", "ь": ""
};

/**
 * Lotin yozuvidagi matnni Kirillga o'giradi
 */
export function toCyrillic(text: string): string {
  if (!text) return "";
  let res = text.toLowerCase();
  
  // Avval ko'p harfli kombinatsiyalar
  for (const [lat, cyr] of [
    ["sh", "ш"], ["ch", "ч"], ["yo", "ё"], ["yu", "ю"], ["ya", "я"], ["ye", "е"],
    ["o'", "ў"], ["o`", "ў"], ["g'", "ғ"], ["g`", "ғ"]
  ]) {
    res = res.replaceAll(lat, cyr);
  }
  
  // Qolgan yakka harflar
  let out = "";
  for (let i = 0; i < res.length; i++) {
    const char = res[i];
    out += LAT_TO_CYR_MAP[char] || char;
  }
  return out;
}

/**
 * Kirill yozuvidagi matnni Lotinga o'giradi
 */
export function toLatin(text: string): string {
  if (!text) return "";
  let res = text.toLowerCase();
  let out = "";
  for (let i = 0; i < res.length; i++) {
    const char = res[i];
    out += CYR_TO_LAT_MAP[char] || char;
  }
  return out;
}

/**
 * Ikki tilli (Lotin & Kirill) aqlli qidiruv
 * Tovar nomi yoki shtrix-kodini har ikki alifboda ham topadi
 */
export function smartSearchMatch(target: string | null | undefined, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!target) return false;

  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();

  // 1. To'g'ridan-to'g'ri moslik
  if (t.includes(q)) return true;

  // 2. Lotin -> Kirill
  const qCyr = toCyrillic(q);
  if (t.includes(qCyr)) return true;

  // 3. Kirill -> Lotin
  const qLat = toLatin(q);
  if (t.includes(qLat)) return true;

  // 4. Targetning o'zini o'girib solishtirish
  const tLat = toLatin(t);
  if (tLat.includes(q) || tLat.includes(qLat)) return true;

  const tCyr = toCyrillic(t);
  if (tCyr.includes(q) || tCyr.includes(qCyr)) return true;

  return false;
}

/**
 * Telefon raqamini faqat raqamlarga keltirish (+998, qavs, probel va defislarni olib tashlaydi)
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

/**
 * Telefon raqami bo'yicha qidiruv (masalan: "90123" yoki "1234567")
 */
export function matchPhone(targetPhone: string | null | undefined, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!targetPhone) return false;

  const cleanQuery = normalizePhone(query);
  if (!cleanQuery) return false;

  const cleanTarget = normalizePhone(targetPhone);
  return cleanTarget.includes(cleanQuery);
}
