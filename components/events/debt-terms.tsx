"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import type { DebtTerms } from "@/lib/finance/types";
import { cn } from "@/lib/utils";

/** The repayment terms' boxes, as typed. */
export interface DebtTermsValues {
  dueDate: string;
  interest: "none" | "month" | "year";
  rate: string;
  instalment: string;
  firstInstalment: string;
}

export function debtTermsValues(t?: DebtTerms): DebtTermsValues {
  return {
    dueDate: t?.dueDate ?? "",
    interest: t?.interest?.per ?? "none",
    rate: t?.interest ? String(t.interest.rateBps / 100) : "",
    instalment: t?.instalments ? minorToInputString(t.instalments.amountMinor) : "",
    firstInstalment: t?.instalments?.firstDate ?? "",
  };
}

/** The terms the boxes describe (none when all are blank), or what's wrong with them. */
export function parseDebtTerms(v: DebtTermsValues): { terms?: DebtTerms } | { error: string } {
  const terms: DebtTerms = {};
  if (v.dueDate) terms.dueDate = v.dueDate;
  if (v.interest !== "none") {
    const rate = Number(v.rate.replace(/[%\s]/g, ""));
    if (!v.rate.trim() || !Number.isFinite(rate) || rate <= 0 || rate > 100) return { error: `Enter the interest, e.g. 2 (% a ${v.interest}), or choose No interest.` };
    terms.interest = { rateBps: Math.round(rate * 100), per: v.interest };
  }
  if (v.instalment.trim()) {
    const amountMinor = parseAmountToMinor(v.instalment);
    if (!amountMinor) return { error: "Enter the instalment as an amount, or leave it blank." };
    if (!v.firstInstalment) return { error: "Pick the date of the first instalment." };
    terms.instalments = { amountMinor, firstDate: v.firstInstalment };
  }
  return Object.keys(terms).length > 0 ? { terms } : {};
}

/**
 * How it's to be paid back, all optional: by a date, with interest (so much a month, as between people, or a year),
 * and in monthly instalments. Folded away until opened, unless the debt already has terms.
 */
export function DebtTermsFields({ value, onChange, startOpen = false }: { value: DebtTermsValues; onChange: (v: DebtTermsValues) => void; startOpen?: boolean }) {
  const has = !!(value.dueDate || value.interest !== "none" || value.instalment);
  const [open, setOpen] = useState(has || startOpen);
  const set = <K extends keyof DebtTermsValues>(k: K, v: DebtTermsValues[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="rounded-xl border" data-testid="debt-terms">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm">
        <span>
          <span className="font-medium">Repayment terms</span> <span className="text-muted-foreground">(optional)</span>
          {!open && <span className="block text-xs text-muted-foreground">Pay back by a date, with interest, or in instalments</span>}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-3 border-t px-3 pb-3 pt-3">
          <div className="grid gap-1.5">
            <Label htmlFor="debt-due">Pay back by</Label>
            <Input id="debt-due" type="date" value={value.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
          </div>

          <div className="grid gap-1.5">
            <Label>Interest</Label>
            <div role="radiogroup" aria-label="Interest" className="grid grid-cols-3 gap-1 rounded-lg border bg-muted p-0.5 text-xs">
              {(
                [
                  ["none", "No interest"],
                  ["month", "% a month"],
                  ["year", "% a year"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={value.interest === v}
                  onClick={() => set("interest", v)}
                  className={cn("rounded-md py-1.5 font-medium", value.interest === v ? "bg-card shadow-sm" : "text-muted-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
            {value.interest !== "none" && (
              <div className="relative">
                <Input id="debt-rate" inputMode="decimal" placeholder={value.interest === "month" ? "2" : "12"} className="pr-24 tabular-nums" value={value.rate} onChange={(e) => set("rate", e.target.value)} aria-label="Interest rate" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">% a {value.interest}</span>
              </div>
            )}
            {value.interest !== "none" && <p className="text-xs text-muted-foreground">Simple interest on what&apos;s still owed. When you pay back, the interest part counts as spending.</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="debt-inst">Instalment a month</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                <Input id="debt-inst" amount autoComplete="off" placeholder="None" className="pl-7 tabular-nums" value={value.instalment} onChange={(e) => set("instalment", e.target.value)} />
              </div>
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="debt-first">First instalment</Label>
              <Input id="debt-first" type="date" value={value.firstInstalment} onChange={(e) => set("firstInstalment", e.target.value)} disabled={!value.instalment.trim()} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Dates here remind you, like any bill, a week before.</p>
        </div>
      )}
    </div>
  );
}
