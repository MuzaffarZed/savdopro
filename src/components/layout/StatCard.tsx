import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  accent?: "primary" | "success" | "warning" | "destructive" | "cyan";
  className?: string;
}

export function StatCard({ label, value, hint, icon, accent = "primary", className }: StatCardProps) {
  const styles: Record<string, { iconBg: string; text: string; glow: string; border: string }> = {
    primary: {
      iconBg: "bg-blue-500/10 text-blue-400 border-blue-500/20 shadow-blue-500/10",
      text: "text-blue-400",
      glow: "from-blue-500/15 via-blue-500/5 to-transparent",
      border: "hover:border-blue-500/40",
    },
    success: {
      iconBg: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20 shadow-emerald-500/5",
      text: "text-foreground",
      glow: "from-emerald-500/10 via-emerald-500/5 to-transparent",
      border: "hover:border-emerald-500/30",
    },
    warning: {
      iconBg: "bg-amber-500/10 text-amber-400 border-amber-500/20 shadow-amber-500/10",
      text: "text-amber-400",
      glow: "from-amber-500/15 via-amber-500/5 to-transparent",
      border: "hover:border-amber-500/40",
    },
    destructive: {
      iconBg: "bg-rose-500/10 text-rose-400 border-rose-500/20 shadow-rose-500/10",
      text: "text-rose-400",
      glow: "from-rose-500/15 via-rose-500/5 to-transparent",
      border: "hover:border-rose-500/40",
    },
    cyan: {
      iconBg: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20 shadow-cyan-500/10",
      text: "text-cyan-400",
      glow: "from-cyan-500/15 via-cyan-500/5 to-transparent",
      border: "hover:border-cyan-500/40",
    },
  };

  const current = styles[accent] || styles.primary;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-white/[0.08] bg-card/90 p-4 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40",
        current.border,
        className
      )}
    >
      {/* Ambient background light */}
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-br opacity-60 blur-2xl",
          current.glow
        )}
      />

      <div className="relative flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground/90">{label}</div>
        {icon && (
          <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm", current.iconBg)}>
            {icon}
          </div>
        )}
      </div>

      <div className="relative mt-2.5 text-xl sm:text-2xl font-bold font-mono tracking-tight text-foreground tabular-nums">
        {value}
      </div>

      {hint && (
        <div className="relative mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
}
