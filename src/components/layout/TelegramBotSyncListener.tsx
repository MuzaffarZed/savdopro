import { useEffect } from "react";
import { pollTelegramBotUpdates, loadTelegramSettings } from "@/lib/telegram-service";

/**
 * SavdoPro Enterprise - Background Telegram Bot Poller
 * Foydalanuvchi tizimda ishlayotgan vaqtda Telegram bot yangilanishlarini
 * va mijozlarning savollarini (/balans, /qarz, /start link_...) fon rejimida
 * hech qanday qotishlarsiz avtomatik qayta ishlab turadi.
 *
 * Dasturchi: MuzaffarZed
 */
export function TelegramBotSyncListener() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let stopped = false;
    let timer: NodeJS.Timeout | null = null;

    const scheduleNext = (delayMs: number) => {
      if (stopped) return;
      timer = setTimeout(async () => {
        if (stopped) return;
        const settings = loadTelegramSettings();
        if (settings.botToken) {
          try {
            await pollTelegramBotUpdates();
          } catch {
            // silent catch
          }
        }
        // Sahifa ko'rinib tursa har 4s, orqa fonda bo'lsa har 15s
        const nextDelay = document.visibilityState === "visible" ? 4000 : 15000;
        scheduleNext(nextDelay);
      }, delayMs);
    };

    // Dastlabki 2 soniyadan so'ng ishga tushirish
    scheduleNext(2000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !stopped) {
        if (timer) clearTimeout(timer);
        scheduleNext(500); // Foydalanuvchi qaytishi bilan darhol tekshirish
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
