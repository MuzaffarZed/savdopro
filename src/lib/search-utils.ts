// SavdoPro Enterprise - Aqlli, Tezkor va Laglarsiz Qidiruv Mexanizmi
// Lotin <-> Kirill transliteratsiyasi va Telefon normallashtirish
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
  "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "n": "н", "о": "o",
  "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "x",
  "ц": "ts", "ъ": "'", "ь": ""
};

/**
 * Lotin yozuvidagi matnni Kirillga o'giradi
 */
export function toCyrillic(text: string): string {
  if (!text) return "";
  let res = text.toLowerCase();
  
  // Avval 2 harfli kombinatsiyalar
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
 * Yuqori samarali (High Performance) qidiruv tekshiruvchisi.
 * Query'ni bir marta normallashtirib, minglab tovarlar bo'yicha laglarsiz tekshiradi.
 */
export interface SearchMatcher {
  (target: string | null | undefined): boolean;
}

export function createSearchMatcher(query: string): SearchMatcher {
  if (!query || !query.trim()) {
    return () => true;
  }

  const q = query.trim().toLowerCase();
  const qCyr = toCyrillic(q);
  const qLat = toLatin(q);
  const qPhone = normalizePhone(q);

  // Bir nechta variantlarni to'plab olamiz
  const searchVariants = Array.from(new Set([q, qCyr, qLat])).filter((v) => v.length > 0);

  return (target: string | null | undefined): boolean => {
    if (!target) return false;
    const t = target.toLowerCase();

    // 1. To'g'ridan-to'g'ri substring tekshiruvi (eng tezkor)
    for (const v of searchVariants) {
      if (t.includes(v)) return true;
    }

    // 2. Agar telefon raqami kiritilgan bo'lsa
    if (qPhone && qPhone.length >= 2) {
      const tPhone = normalizePhone(t);
      if (tPhone && tPhone.includes(qPhone)) return true;
    }

    // 3. Chuqur transliteratsiya tekshiruvi
    const tLat = toLatin(t);
    for (const v of searchVariants) {
      if (tLat.includes(v)) return true;
    }

    const tCyr = toCyrillic(t);
    for (const v of searchVariants) {
      if (tCyr.includes(v)) return true;
    }

    return false;
  };
}

/**
 * Ikki tilli (Lotin & Kirill) aqlli qidiruv (oddiy chaqiruvlar uchun)
 */
export function smartSearchMatch(target: string | null | undefined, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!target) return false;
  const matcher = createSearchMatcher(query);
  return matcher(target);
}

/**
 * Telefon raqamini faqat raqamlarga keltirish (+998, qavs, probel va defislarni olib tashlaydi)
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

/**
 * Telefon raqami bo'yicha qidiruv
 */
export function matchPhone(targetPhone: string | null | undefined, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!targetPhone) return false;

  const cleanQuery = normalizePhone(query);
  if (!cleanQuery) return false;

  const cleanTarget = normalizePhone(targetPhone);
  return cleanTarget.includes(cleanQuery);
}
