"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A large, quiet panel for one chart. */
export function ChartCard({
  title,
  action,
  children,
  className,
  headerClassName,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
}) {
  return (
    <section className={cn("rounded-3xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] sm:p-5", className)}>
      <div className={cn("mb-3 flex flex-wrap items-center justify-between gap-2", headerClassName)}>
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The big number and the one-line answer that sits above a chart. */
export function Headline({
  value,
  caption,
  delta,
  tone = "neutral",
}: {
  value: ReactNode;
  caption?: ReactNode;
  delta?: ReactNode;
  tone?: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums text-slate-900">{value}</p>
        {delta && <DeltaPill tone={tone}>{delta}</DeltaPill>}
      </div>
      {caption && <p className="mt-1.5 text-[13px] leading-snug text-slate-500">{caption}</p>}
    </div>
  );
}

export function DeltaPill({ tone, children }: { tone: "positive" | "negative" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        tone === "positive" && "bg-emerald-50 text-emerald-700",
        tone === "negative" && "bg-rose-50 text-rose-700",
        tone === "neutral" && "bg-slate-100 text-slate-600",
      )}
    >
      {tone === "positive" && <ArrowUpRight className="size-3.5" />}
      {tone === "negative" && <ArrowDownRight className="size-3.5" />}
      {children}
    </span>
  );
}

/** 1M · 3M · 6M · 1Y · All */
export function RangeTabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-full bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
            o.value === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Shown in place of a chart when there is nothing to draw yet. */
export function EmptyChart({ children, height = 220 }: { children: ReactNode; height?: number }) {
  return (
    <div style={{ minHeight: height }} className="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
      <p className="max-w-xs">{children}</p>
    </div>
  );
}
