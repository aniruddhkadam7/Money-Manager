import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The floating card shown while hovering a chart. */
export function TooltipCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "min-w-44 max-w-64 rounded-2xl palette-fixed border border-white/10 bg-slate-900/95 p-3.5 text-white shadow-2xl backdrop-blur-md",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TooltipTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-2">
      <p className="text-[13px] font-semibold leading-tight">{children}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

export function TooltipRow({
  label,
  value,
  color,
  tone,
  strong,
}: {
  label: ReactNode;
  value: ReactNode;
  color?: string;
  tone?: "positive" | "negative";
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-0.5 text-[12px]">
      <span className="flex items-center gap-1.5 text-slate-300">
        {color && <span className="size-2 rounded-full" style={{ backgroundColor: color }} />}
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "text-[13px] font-semibold" : "font-medium",
          tone === "positive" && "text-emerald-300",
          tone === "negative" && "text-rose-300",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function TooltipHint({ children }: { children: ReactNode }) {
  return <p className="mt-2 border-t border-white/10 pt-2 text-[11px] text-slate-400">{children}</p>;
}
