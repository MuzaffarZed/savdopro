import type { ReactNode } from "react";

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end sm:justify-between gap-2 sm:gap-3 border-b bg-background/80 backdrop-blur px-4 lg:px-6 py-3 sm:py-5 sticky top-0 z-20">
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-semibold tracking-tight truncate">{title}</h1>
        {description && <div className="mt-0.5 text-xs sm:text-sm text-muted-foreground">{description}</div>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2 -mx-1 px-1 overflow-x-auto sm:overflow-visible">{action}</div>}
    </div>
  );
}
