"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Info, ListTree } from "lucide-react";
import { formatExactINR } from "@/lib/charts/format";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export interface ExplainRow {
  label: string;
  note?: string;
  amountMinor: number;
  href?: string;
}

export interface ExplainSection {
  title: string;
  rows: ExplainRow[];
  /** Shown under the rows; defaults to their sum. */
  totalMinor?: number;
  empty?: string;
}

/** One step of the sum at the bottom: "What you own ₹X", "− What you owe ₹Y", "= Net worth ₹Z". */
export interface ExplainStep {
  label: string;
  amountMinor: number;
  op?: "+" | "−" | "=";
}

const signed = (minor: number) => (minor > 0 ? "+" : minor < 0 ? "−" : "") + formatExactINR(Math.abs(minor));

function Row({ row, showSign }: { row: ExplainRow; showSign: boolean }) {
  const body = (
    <>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900">{row.label}</span>
        {row.note && <span className="block text-xs text-slate-500">{row.note}</span>}
      </span>
      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", row.amountMinor < 0 && "text-rose-700", showSign && row.amountMinor > 0 && "text-emerald-700")}>
        {showSign ? signed(row.amountMinor) : formatExactINR(row.amountMinor)}
      </span>
    </>
  );
  return (
    <li>
      {row.href ? (
        <Link href={row.href} className="flex items-center justify-between gap-3 py-2 hover:bg-slate-50">
          {body}
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 py-2">{body}</div>
      )}
    </li>
  );
}

/**
 * "How it adds up": a number broken into the lines it is made of, with the sum at the bottom ending in the
 * number itself. `signed` shows rows as +/− (for changes); otherwise as plain amounts.
 */
export function ExplainSheet({
  open,
  onOpenChange,
  title,
  description,
  sections,
  steps,
  signed: showSign = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  sections: ExplainSection[];
  steps: ExplainStep[];
  signed?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="explain-sheet">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {sections.map((s) => {
          const total = s.totalMinor ?? s.rows.reduce((t, r) => t + r.amountMinor, 0);
          return (
            <div key={s.title}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</p>
              {s.rows.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">{s.empty ?? "Nothing here."}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {s.rows.map((r, i) => (
                    <Row key={`${r.label}-${i}`} row={r} showSign={showSign} />
                  ))}
                </ul>
              )}
              {s.rows.length > 1 && (
                <div className="mt-1 flex justify-between border-t border-slate-300 pt-2 text-sm font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{showSign ? signed(total) : formatExactINR(total)}</span>
                </div>
              )}
            </div>
          );
        })}
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          {steps.map((step, i) => {
            const last = i === steps.length - 1;
            return (
              <div
                key={step.label}
                className={cn(
                  "flex justify-between gap-3 tabular-nums",
                  last ? "mt-1 border-t border-slate-200 pt-1 text-base font-semibold text-slate-900" : "text-slate-600",
                  last && step.amountMinor < 0 && "text-rose-600",
                )}
              >
                <span>
                  {step.op ? `${step.op} ` : ""}
                  {step.label}
                </span>
                <span>{formatExactINR(step.amountMinor)}</span>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The pill that opens a breakdown, as under Net worth. */
export function HowButton({ onClick, children = "How it adds up", className }: { onClick: () => void; children?: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-white hover:text-slate-900",
        className,
      )}
    >
      <ListTree className="size-3.5" /> {children}
    </button>
  );
}

/** A small ⓘ next to a number's label that opens its breakdown. */
export function HowIcon({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-label={`How ${label} adds up`}
      title="How it adds up"
      className="inline-grid size-5 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      data-testid="how-icon"
    >
      <Info className="size-3.5" />
    </button>
  );
}

/** Opens a sheet on demand: `const how = useExplain();` then `how.open()` and `<ExplainSheet {...how.props} … />`. */
export function useExplain() {
  const [open, setOpen] = useState(false);
  return { open: () => setOpen(true), props: { open, onOpenChange: setOpen } };
}
