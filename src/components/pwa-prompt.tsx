import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode (already installed as PWA or in native app)
    const isInStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
      typeof (window as unknown as { SavdoProNative?: unknown }).SavdoProNative !== "undefined";

    if (isInStandalone) {
      setIsStandalone(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // Register Service Worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  if (isStandalone || !deferredPrompt || isDismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  return (
    <aside
      aria-label="Ilovani o'rnatish"
      className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between gap-3 rounded-2xl border border-primary/30 bg-[#090D16]/95 p-3.5 shadow-2xl backdrop-blur-xl sm:left-auto sm:right-6 sm:w-96"
    >
      <div className="flex items-center gap-3">
        <img
          src="/savdopro_logo.png"
          alt="SavdoPro"
          className="h-10 w-10 rounded-xl border border-white/10 object-cover shadow-sm"
        />
        <div>
          <p className="text-sm font-semibold text-white">SavdoPro Ilovasi</p>
          <p className="text-xs text-slate-400">1 bosishda o'rnatish (Xavfsiz WebAPK)</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleInstallClick}
          className="h-9 gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-3 text-xs font-semibold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-600 hover:to-teal-700"
        >
          <Download className="h-3.5 w-3.5" />
          O'rnatish
        </Button>
        <button
          onClick={() => setIsDismissed(true)}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
          aria-label="Yopish"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
