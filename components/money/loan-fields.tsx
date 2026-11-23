"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDisplayDate, shiftMonth, todayISO } from "@/lib/domain/dates";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import { formatRupees } from "@/lib/finance/describe";
import { calcEmi, loanPlan } from "@/lib/finance/loan";
import type { LoanTerms } from "@/lib/finance/types";
import { cn } from "@/lib/utils";

/** The loan form's boxes, as typed. */
export interface LoanFieldValues {
  principal: string;
  rate: string;
  tenure: string;
  unit: "years" | "months";
  firstEmi: string;
  emi: string;
}

export function loanFieldValues(terms?: LoanTerms): LoanFieldValues {
  if (!terms) {
    // The first EMI usually falls about a month after the money arrives.
    const ym = shiftMonth(todayISO().slice(0, 7), 1);
    return { principal: "", rate: "", tenure: "", unit: "years", firstEmi: `${ym}-05`, emi: "" };
  }
  const years = terms.tenureMonths % 12 === 0;
  return {
    principal: minorToInputString(terms.principalMinor),
    rate: String(terms.annualRateBps / 100),
    tenure: String(years ? terms.tenureMonths / 12 : terms.tenureMonths),
    unit: years ? "years" : "months",
    firstEmi: terms.firstEmiDate,
    emi: terms.emiMinor ? minorToInputString(terms.emiMinor) : "",
  };
}

/**
 * The terms the boxes describe: `null` when they're all blank (a loan without details), a message when they're
 * partly filled or wrong, else the terms.
 */
export function parseLoanFields(v: LoanFieldValues): { terms: LoanTerms | null } | { error: string } {
  const blank = !v.principal.trim() && !v.rate.trim() && !v.tenure.trim() && !v.emi.trim();
  if (blank) return { terms: null };
  const principalMinor = parseAmountToMinor(v.principal);
  if (!principalMinor || principalMinor <= 0) return { error: "Enter the amount borrowed." };
  const rate = Number(v.rate.replace(/[%\s]/g, ""));
  if (!v.rate.trim() || !Number.isFinite(rate) || rate < 0 || rate > 60) return { error: "Enter the interest rate a year, e.g. 8.5" };
  const n = Number(v.tenure);
  if (!Number.isFinite(n) || n <= 0) return { error: "Enter how long the loan runs, e.g. 20 years." };
  const tenureMonths = Math.round(v.unit === "years" ? n * 12 : n);
  if (tenureMonths < 1 || tenureMonths > 600) return { error: "The tenure should be between 1 month and 50 years." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.firstEmi)) return { error: "Pick the date of the first EMI." };
  const emiMinor = v.emi.trim() ? parseAmountToMinor(v.emi) : undefined;
  if (emiMinor === null || (emiMinor !== undefined && emiMinor <= 0)) return { error: "Enter the bank's EMI as an amount, or leave it blank." };
  const worked = calcEmi(principalMinor, Math.round(rate * 100), tenureMonths);
  return {
    terms: {
      principalMinor,
      annualRateBps: Math.round(rate * 100),
      tenureMonths,
      firstEmiDate: v.firstEmi,
      // Only kept when it differs from the worked-out one.
      ...(emiMinor && emiMinor !== worked ? { emiMinor } : {}),
    },
  };
}

/** Amount, rate, tenure and first EMI date, with the EMI and the loan's total cost worked out as you type. */
export function LoanFields({ value, onChange }: { value: LoanFieldValues; onChange: (v: LoanFieldValues) => void }) {
  const set = <K extends keyof LoanFieldValues>(k: K, v: LoanFieldValues[K]) => onChange({ ...value, [k]: v });
  const parsed = parseLoanFields(value);
  const plan = "terms" in parsed && parsed.terms ? loanPlan(parsed.terms) : null;
  const worked = "terms" in parsed && parsed.terms ? calcEmi(parsed.terms.principalMinor, parsed.terms.annualRateBps, parsed.terms.tenureMonths) : null;

  return (
    <fieldset className="grid gap-3 rounded-xl border p-3" data-testid="loan-fields">
      <legend className="px-1 text-sm font-medium">Loan details</legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="loan-principal">Amount borrowed</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
            <Input id="loan-principal" amount autoComplete="off" placeholder="10,00,000" className="pl-7 tabular-nums" value={value.principal} onChange={(e) => set("principal", e.target.value)} />
          </div>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="loan-rate">Interest (% a year)</Label>
          <div className="relative">
            <Input id="loan-rate" inputMode="decimal" autoComplete="off" placeholder="8.5" className="pr-7 tabular-nums" value={value.rate} onChange={(e) => set("rate", e.target.value)} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
          </div>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="loan-tenure">Tenure</Label>
          <div className="flex gap-1.5">
            <Input id="loan-tenure" inputMode="numeric" autoComplete="off" placeholder="20" className="min-w-0 tabular-nums" value={value.tenure} onChange={(e) => set("tenure", e.target.value)} />
            <div role="radiogroup" aria-label="Tenure in" className="flex shrink-0 rounded-lg border bg-muted p-0.5 text-xs">
              {(["years", "months"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={value.unit === u}
                  onClick={() => set("unit", u)}
                  className={cn("rounded-md px-2 font-medium", value.unit === u ? "bg-card shadow-sm" : "text-muted-foreground")}
                >
                  {u === "years" ? "Yrs" : "Mo"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="loan-first">First EMI on</Label>
          <Input id="loan-first" type="date" value={value.firstEmi} onChange={(e) => set("firstEmi", e.target.value)} />
        </div>
      </div>

      {plan && worked !== null ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-muted/50 p-3 text-sm tabular-nums" data-testid="loan-calculator">
          <span className="text-muted-foreground">EMI</span>
          <span className="text-right text-base font-semibold">{formatRupees(plan.emiMinor)}<span className="text-xs font-normal text-muted-foreground"> / month</span></span>
          <span className="text-muted-foreground">Total interest</span>
          <span className="text-right font-medium text-rose-600">{formatRupees(plan.totalInterestMinor)}</span>
          <span className="text-muted-foreground">Total you repay</span>
          <span className="text-right font-medium">{formatRupees(plan.totalPaidMinor)}</span>
          <span className="text-muted-foreground">Last EMI</span>
          <span className="text-right font-medium">{formatDisplayDate(plan.lastEmiDate)}</span>
          {"terms" in parsed && parsed.terms?.emiMinor && (
            <span className="col-span-2 text-xs text-muted-foreground">Worked out, the EMI would be {formatRupees(worked)}; your bank&apos;s is used.</span>
          )}
        </div>
      ) : (
        "error" in parsed && <p className="text-xs text-muted-foreground">{parsed.error}</p>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="loan-emi">
          Bank&apos;s EMI <span className="font-normal text-muted-foreground">(only if it&apos;s different)</span>
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
          <Input id="loan-emi" amount autoComplete="off" placeholder={worked ? minorToInputString(worked) : "Worked out for you"} className="pl-7 tabular-nums" value={value.emi} onChange={(e) => set("emi", e.target.value)} />
        </div>
      </div>
    </fieldset>
  );
}

