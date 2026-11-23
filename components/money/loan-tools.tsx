"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays, daysBetween, formatDisplayDate } from "@/lib/domain/dates";
import { firstActivityDate } from "@/lib/finance/series";
import { groupAmountInput, parseAmountToMinor } from "@/lib/domain/money";
import { formatRupees } from "@/lib/finance/describe";
import { emiOf } from "@/lib/finance/loan";
import {
  affordability,
  balanceTransfer,
  homeLoanTax,
  LIMIT_24B_MINOR,
  LIMIT_80C_MINOR,
  offerCost,
  prepayment,
  rateChange,
  type AffordBand,
  type LoanNow,
  type Offer,
} from "@/lib/finance/loan-tools";
import type { Account } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";

type Tool = "prepay" | "afford" | "rate" | "tax" | "switch" | "compare";
const TOOLS: { value: Tool; label: string }[] = [
  { value: "prepay", label: "Prepay" },
  { value: "afford", label: "Afford" },
  { value: "rate", label: "Rate change" },
  { value: "tax", label: "Tax benefit" },
  { value: "switch", label: "Switch lender" },
  { value: "compare", label: "Compare offers" },
];

/** Whole rupees: what-ifs are estimates, and paise only clutter them. */
const rs = (minor: number) => formatRupees(Math.round(minor / 100) * 100);
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
const span = (months: number) => {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y > 0 && `${y} yr${y === 1 ? "" : "s"}`, m > 0 && `${m} mo`].filter(Boolean).join(" ") || "0 mo";
};
const amountOf = (text: string) => (text.trim() ? (parseAmountToMinor(text.replace(/[,₹\s]/g, "")) ?? 0) : 0);
const rateOf = (text: string) => {
  const n = Number(text.replace(/[%\s]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 60 ? Math.round(n * 100) : null;
};

/**
 * What-ifs for the loan the calculator is set to (or one of yours, opened with its Plan button): prepaying, whether
 * the EMI is affordable on your income, a rate change, the home loan tax deductions, switching lenders, and two offers
 * side by side.
 */
export function LoanTools({
  loan,
  rows,
  realLoan,
}: {
  loan: LoanNow;
  /** The loan's schedule from now, for the tax deductions. */
  rows: { date: string; principalMinor: number; interestMinor: number }[];
  /** Planning one of your loans: a rate change can be saved to it. */
  realLoan?: Account;
}) {
  const [tool, setTool] = useState<Tool>("prepay");
  return (
    <section className="grid gap-3 lg:col-span-2" aria-label="Plan and compare" data-testid="loan-tools">
      <h3 className="text-sm font-medium">Plan &amp; compare</h3>
      {/* Six tools: a row that scrolls sideways on phones. */}
      <div role="tablist" aria-label="Loan tools" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TOOLS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tool === t.value}
            onClick={() => setTool(t.value)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              tool === t.value ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="rounded-xl border p-3 sm:p-4">
        {tool === "prepay" && <Prepay loan={loan} />}
        {tool === "afford" && <Afford loan={loan} realLoan={realLoan} />}
        {tool === "rate" && <RateChange loan={loan} realLoan={realLoan} />}
        {tool === "tax" && <Tax rows={rows} />}
        {tool === "switch" && <Switch loan={loan} />}
        {tool === "compare" && <Compare loan={loan} />}
      </div>
    </section>
  );
}

/* ---------------- Prepay ---------------- */

function Prepay({ loan }: { loan: LoanNow }) {
  const [lump, setLump] = useState("1,00,000");
  const [lumpAt, setLumpAt] = useState("1");
  const [extra, setExtra] = useState("");
  const [lowerEmi, setLowerEmi] = useState(false);
  const at = Math.max(1, Math.min(loan.monthsLeft, Math.round(Number(lumpAt) || 1)));
  const p = prepayment(loan, { lumpMinor: amountOf(lump), lumpAt: at, extraMonthlyMinor: amountOf(extra), lowerEmi });
  const nothing = amountOf(lump) === 0 && amountOf(extra) === 0;

  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">Pay extra on top of your EMIs. Early prepayments save the most, because every rupee stops collecting interest for the rest of the loan.</p>
      <div className="grid grid-cols-2 gap-3">
        <Money id="pp-lump" label="One-time amount" value={lump} onChange={setLump} />
        <Field id="pp-at" label="Paid after EMI no.">
          <Input id="pp-at" inputMode="numeric" value={lumpAt} onChange={(e) => setLumpAt(e.target.value)} />
        </Field>
        <Money id="pp-extra" label="Extra every month" value={extra} onChange={setExtra} placeholder="0" />
        <Field id="pp-mode" label="After the one-time amount">
          <Choice
            value={lowerEmi ? "emi" : "tenure"}
            options={[
              { value: "tenure", label: "Finish sooner" },
              { value: "emi", label: "Lower EMI" },
            ]}
            onChange={(v) => setLowerEmi(v === "emi")}
          />
        </Field>
      </div>
      {nothing ? (
        <p className="text-sm text-muted-foreground">Enter an amount to see what it saves.</p>
      ) : (
        <Results>
          <Big label="Interest saved" value={rs(p.interestSavedMinor)} good />
          {lowerEmi && amountOf(lump) > 0 ? (
            <Big label="New EMI" value={`${rs(p.after.emiMinor)}`} sub={`${rs(p.emiDropMinor)} less a month`} />
          ) : (
            <Big label="Finishes sooner by" value={span(p.monthsCut)} sub={`${p.after.months} EMIs instead of ${p.base.months}`} />
          )}
          <Line label="Interest without prepaying" value={rs(p.base.interestMinor)} />
          <Line label="Interest with it" value={rs(p.after.interestMinor)} />
        </Results>
      )}
      <p className="text-xs text-muted-foreground">Floating-rate home loans have no prepayment charge in India; fixed-rate loans may charge 2–4%. To record a prepayment on one of your loans, add a Transfer from your bank to the loan.</p>
    </div>
  );
}

/* ---------------- Afford ---------------- */

const BAND: Record<AffordBand, { label: string; tone: string }> = {
  comfortable: { label: "Comfortable", tone: "text-emerald-700 dark:text-emerald-400" },
  manageable: { label: "Manageable", tone: "text-sky-700 dark:text-sky-400" },
  stretched: { label: "Stretched", tone: "text-amber-700 dark:text-amber-400" },
  risky: { label: "Risky", tone: "text-rose-700 dark:text-rose-400" },
};

const INCOME_KEY = "money-manager:afford-income";

/**
 * Your usual month over the last 3 months up to today: spending (EMI interest left out, it's in the EMIs), what you
 * paid people back, and EMIs paid on loans without their terms (whose EMI isn't known otherwise). Each is the total
 * over the span divided by the months it covers, and the span starts no earlier than your records do, so a short
 * history isn't averaged down by months with nothing in them.
 */
function useAverageMonth(skipLoanId?: string) {
  const { report, book, ledger, today } = useFinance();
  return useMemo(() => {
    const threeMonthsAgo = addDays(today, -90);
    const first = firstActivityDate(ledger);
    const from = first && first > threeMonthsAgo ? first : threeMonthsAgo;
    const to = today;
    // Months covered, at least one (a few days of records count as a month, not a fraction that inflates it).
    const months = Math.max(1, (daysBetween(from, to) + 1) / (365.25 / 12));
    const r = report(from, to);
    const emiInterest = r.expensesByCategory.filter((c) => c.categoryId === "emi").reduce((t, c) => t + c.amountMinor, 0);
    const inSpan = book.events.filter((e) => e.date >= from && e.date <= to);
    const repaid = inSpan.reduce((t, e) => t + (e.type === "repayment_made" ? e.amountMinor : 0), 0);
    // By person: what you paid each of them back in the span.
    const repaidBy = new Map<string, number>();
    for (const e of inSpan) if (e.type === "repayment_made") repaidBy.set(e.personId, (repaidBy.get(e.personId) ?? 0) + e.amountMinor);
    const withTerms = new Set(book.accounts.filter((a) => a.type === "loan" && a.loanTerms).map((a) => a.id));
    const otherLoanEmis = inSpan.reduce((t, e) => t + (e.type === "emi_payment" && !withTerms.has(e.toAccountId) && e.toAccountId !== skipLoanId ? e.amountMinor : 0), 0);
    return {
      spendMinor: Math.round((r.expensesMinor - emiInterest) / months),
      repayPeopleMinor: Math.round(repaid / months),
      repaidMonthlyBy: new Map([...repaidBy].map(([id, total]) => [id, Math.round(total / months)])),
      untrackedEmisMinor: Math.round(otherLoanEmis / months),
      from,
      to,
      months,
    };
  }, [report, book, ledger, today, skipLoanId]);
}

function Afford({ loan, realLoan }: { loan: LoanNow; realLoan?: Account }) {
  const { state } = useFinance();
  const avg = useAverageMonth(realLoan?.id);
  // Your income, as you enter it (never guessed from entries), kept on this device so it's there next time.
  const [income, setIncomeText] = useState(() => {
    try {
      return window.localStorage.getItem(INCOME_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const setIncome = (v: string) => {
    setIncomeText(v);
    try {
      window.localStorage.setItem(INCOME_KEY, v);
    } catch {
      /* private mode: it just isn't remembered */
    }
  };
  // EMIs you already pay: your other loans with their terms (still owing), and the average paid on loans without.
  const otherEmis =
    state.accounts
      .filter((a) => a.account.type === "loan" && a.account.loanTerms && a.balanceMinor > 0 && a.account.id !== realLoan?.id)
      .reduce((t, a) => t + emiOf(a.account.loanTerms!), 0) + avg.untrackedEmisMinor;
  const owePeople = state.liabilities.borrowedMinor;
  // Everyone you still owe: what you pay them a month on average, and what's left.
  const people = state.people
    .map((p) => ({ id: p.person.id, name: p.person.name, monthlyMinor: avg.repaidMonthlyBy.get(p.person.id) ?? 0, owedMinor: Math.max(0, p.iOwe.outstandingMinor) }))
    // Only people you still owe: someone you've paid back in full isn't listed.
    .filter((p) => p.owedMinor > 0)
    .sort((x, y) => y.owedMinor - x.owedMinor || y.monthlyMinor - x.monthlyMinor);
  const incomeMinor = amountOf(income);
  const a = affordability({
    emiMinor: loan.emiMinor,
    incomeMinor,
    outgoings: { spendMinor: avg.spendMinor, otherEmisMinor: otherEmis, repayPeopleMinor: avg.repayPeopleMinor },
  });

  const why =
    !a.band || a.leftShare === null || a.emiShare === null
      ? ""
      : a.leftMinor < 0
        ? `Everything together comes to ${rs(-a.leftMinor)} more than your income each month.`
        : a.by === "emi" && a.band !== "comfortable"
          ? `EMIs alone would take ${Math.round(a.emiShare * 100)}% of your income; banks usually stop at 40–50%.`
          : `After your usual spending, EMIs${avg.repayPeopleMinor > 0 ? " and paying people back" : ""}, ${Math.round(a.leftShare * 100)}% of your income is left${
              a.band === "comfortable" ? ": room for savings and surprises." : a.band === "manageable" ? ": workable, with a little room for surprises." : ": very little room for a bad month."
            }`;

  return (
    <div className="grid gap-4">
      <Money id="af-income" label="Monthly income (take-home)" value={income} onChange={setIncome} placeholder="What reaches your account each month" />
      {incomeMinor <= 0 || !a.band ? (
        <p className="text-sm text-muted-foreground">Enter your monthly income to see how this EMI fits with everything else you pay.</p>
      ) : (
        <>
          <div className="grid gap-1 rounded-lg bg-muted/40 p-3">
            <p className={cn("text-lg font-semibold", BAND[a.band].tone)} data-testid="afford-verdict">
              {BAND[a.band].label}
            </p>
            <p className="text-sm">{why}</p>
          </div>

          {/* Where the month's money goes, from income down to what's left. */}
          <dl className="grid gap-1.5 text-sm tabular-nums" data-testid="afford-breakdown">
            <Line label="Income" value={rs(incomeMinor)} />
            <Line label="− Usual spending (3-month average)" value={rs(avg.spendMinor)} />
            {otherEmis > 0 && <Line label="− EMIs you already pay" value={rs(otherEmis)} />}
            {(avg.repayPeopleMinor > 0 || people.length > 0) && <Line label="− Paying people back" value={rs(avg.repayPeopleMinor)} />}
            {people.length > 0 && (
              // Who: what you pay each a month, and what you still owe them.
              <ul className="col-span-2 -mt-0.5 mb-1 grid gap-1 border-l-2 pl-3 text-xs" data-testid="afford-people">
                {people.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="shrink-0 text-right text-muted-foreground">
                      {p.monthlyMinor > 0 ? <span className="text-foreground">{rs(p.monthlyMinor)}/mo</span> : "no payments lately"}
                      {" · "}
                      {rs(p.owedMinor)} still owed
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Line label="− This EMI" value={rs(loan.emiMinor)} />
            <div className="col-span-2 mt-1 flex justify-between gap-3 border-t pt-2">
              <dt className="font-medium">Left each month</dt>
              <dd className={cn("font-semibold", a.leftMinor < 0 ? "text-rose-700 dark:text-rose-400" : "text-foreground")}>
                {a.leftMinor < 0 ? `−${rs(-a.leftMinor)}` : rs(a.leftMinor)} <span className="text-xs font-normal text-muted-foreground">({Math.round(a.leftShare! * 100)}%)</span>
              </dd>
            </div>
          </dl>

          <dl className="grid gap-1.5 rounded-lg border p-3 text-sm tabular-nums">
            <Line label="All EMIs as a share of income" value={`${Math.round(a.emiShare! * 100)}%`} />
            <Line label="Most EMI that stays manageable" value={rs(a.roomMinor)} />
          </dl>

          <p className="text-xs text-muted-foreground">
            Spending, EMIs on loans without details, and paying people back are your monthly averages over {formatDisplayDate(avg.from)} – {formatDisplayDate(avg.to)} (
            {avg.months.toFixed(1)} months).
            {owePeople > 0 && ` You still owe people ${rs(owePeople)} in all${avg.repayPeopleMinor > 0 ? `; at ${rs(avg.repayPeopleMinor)} a month that's about ${Math.ceil(owePeople / avg.repayPeopleMinor)} more months` : ""}.`}
          </p>
        </>
      )}
    </div>
  );
}

/* ---------------- Rate change ---------------- */

function RateChange({ loan, realLoan }: { loan: LoanNow; realLoan?: Account }) {
  const { updateAccount } = useFinance();
  const [rate, setRate] = useState(String((loan.annualRateBps + 50) / 100));
  const [saved, setSaved] = useState<string | null>(null);
  const bps = rateOf(rate);
  const c = bps ? rateChange(loan, bps) : null;

  const save = (keep: "emi" | "tenure") => {
    if (!realLoan?.loanTerms || !c || !bps) return;
    // From now on: the new rate, with the EMI the bank set (the same one, or the new one to finish on time).
    const emiMinor = keep === "emi" ? emiOf(realLoan.loanTerms) : c.keepTenure.emiMinor;
    const r = updateAccount(realLoan.id, { loanTerms: { ...realLoan.loanTerms, annualRateBps: bps, emiMinor } });
    setSaved(r.ok ? `Saved: ${pct(bps)}, EMI ${rs(emiMinor)}.` : (r.issues[0]?.message ?? "Couldn't save that."));
  };

  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Floating rates move with the RBI&apos;s repo rate. When yours changes, banks usually keep the EMI and change the number of EMIs; you can ask them to change the EMI instead.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field id="rc-now" label="Rate now">
          <p className="flex h-10 items-center text-sm tabular-nums">{pct(loan.annualRateBps)}</p>
        </Field>
        <Field id="rc-new" label="New rate">
          <div className="relative">
            <Input id="rc-new" inputMode="decimal" className="pr-7 tabular-nums" value={rate} onChange={(e) => setRate(e.target.value)} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
          </div>
        </Field>
      </div>
      {c && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Option title="Same EMI, number of EMIs changes" detail="What banks do by default">
            {c.keepEmi.neverEnds ? (
              <p className="text-sm text-rose-700 dark:text-rose-400">At this rate the EMI no longer covers the interest: the bank would have to raise it.</p>
            ) : (
              <>
                <Line label="EMIs left" value={`${c.keepEmi.months} (${signed(c.keepEmi.monthsMore)})`} />
                <Line label="Extra interest" value={signedRs(c.keepEmi.interestMoreMinor)} />
              </>
            )}
            {realLoan?.loanTerms && !c.keepEmi.neverEnds && (
              <Button size="sm" variant="outline" onClick={() => save("emi")} className="mt-1 justify-self-start">
                <Check /> Save to {realLoan.name}
              </Button>
            )}
          </Option>
          <Option title="Same end date, EMI changes">
            <Line label="New EMI" value={`${rs(c.keepTenure.emiMinor)} (${signedRs(c.keepTenure.emiMoreMinor)})`} />
            <Line label="Extra interest" value={signedRs(c.keepTenure.interestMoreMinor)} />
            {realLoan?.loanTerms && (
              <Button size="sm" variant="outline" onClick={() => save("tenure")} className="mt-1 justify-self-start">
                <Check /> Save to {realLoan.name}
              </Button>
            )}
          </Option>
        </div>
      )}
      {saved && <p className="text-xs text-emerald-700 dark:text-emerald-400">{saved} Its schedule and reminders follow the new figures.</p>}
    </div>
  );
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "no change");
const signedRs = (minor: number) => (minor > 0 ? `+${rs(minor)}` : minor < 0 ? `−${rs(-minor)}` : "no change");

/* ---------------- Tax ---------------- */

function Tax({ rows }: { rows: { date: string; principalMinor: number; interestMinor: number }[] }) {
  const [slab, setSlab] = useState(30);
  const years = homeLoanTax(rows, slab);
  const total = years.reduce((t, y) => t + y.taxSavedMinor, 0);
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Home loans under the old tax regime: principal repaid counts under 80C (up to {rs(LIMIT_80C_MINOR)} a year, shared with PPF, ELSS, insurance…) and interest under 24(b) (up to{" "}
        {rs(LIMIT_24B_MINOR)} for a home you live in). The new regime allows neither for a self-occupied home.
      </p>
      <Field id="tx-slab" label="Your tax slab">
        <Choice value={String(slab)} options={[5, 10, 20, 30].map((s) => ({ value: String(s), label: `${s}%` }))} onChange={(v) => setSlab(Number(v))} />
      </Field>
      <Results>
        <Big label="Tax saved over the loan" value={rs(total)} good />
        <Big label="In the first full year" value={rs(years.find((y, i) => i > 0 || years.length === 1)?.taxSavedMinor ?? 0)} />
      </Results>
      <div className="max-h-64 overflow-auto rounded-lg border">
        <table className="w-full text-xs tabular-nums">
          <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)] [&_th]:bg-muted/60">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Year (Apr–Mar)</th>
              <th className="px-2 py-1.5 text-right font-medium">80C</th>
              <th className="px-2 py-1.5 text-right font-medium">24(b)</th>
              <th className="px-2 py-1.5 text-right font-medium">Tax saved</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {years.map((y) => (
              <tr key={y.fy}>
                <td className="px-2 py-1.5">FY {y.fy}</td>
                <td className="px-2 py-1.5 text-right">{rs(y.deduction80cMinor)}</td>
                <td className="px-2 py-1.5 text-right">{rs(y.deduction24bMinor)}</td>
                <td className="px-2 py-1.5 text-right font-medium">{rs(y.taxSavedMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Includes 4% cess. An estimate: check with your tax filing.</p>
    </div>
  );
}

/* ---------------- Switch lender ---------------- */

function Switch({ loan }: { loan: LoanNow }) {
  const [rate, setRate] = useState(String(Math.max(1, loan.annualRateBps - 50) / 100));
  // Processing fee, legal and valuation charges: about 0.5% of the loan is typical.
  const [fee, setFee] = useState(groupAmountInput(String(Math.round(loan.balanceMinor * 0.005 / 100))));
  const bps = rateOf(rate);
  const t = bps ? balanceTransfer(loan, bps, amountOf(fee)) : null;
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">Move what you owe to a lender charging less, for the same months left. Worth it when the saving comfortably beats the fees.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field id="sw-rate" label="New lender's rate">
          <div className="relative">
            <Input id="sw-rate" inputMode="decimal" className="pr-7 tabular-nums" value={rate} onChange={(e) => setRate(e.target.value)} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
          </div>
        </Field>
        <Money id="sw-fee" label="Fees to switch" value={fee} onChange={setFee} />
      </div>
      {t && (
        <Results>
          <Big label="You'd save" value={rs(Math.max(t.netSavingMinor, 0))} sub={t.netSavingMinor < 0 ? `The fees cost ${rs(-t.netSavingMinor)} more than it saves` : "after the fees"} good={t.netSavingMinor > 0} bad={t.netSavingMinor < 0} />
          <Big label="Fees paid back in" value={t.breakEvenMonth === null ? "Never" : span(t.breakEvenMonth)} />
          <Line label="New EMI" value={`${rs(t.newEmiMinor)} (now ${rs(loan.emiMinor)})`} />
          <Line label="Interest saved before fees" value={rs(t.grossSavingMinor)} />
        </Results>
      )}
    </div>
  );
}

/* ---------------- Compare offers ---------------- */

interface OfferText {
  amount: string;
  rate: string;
  years: string;
  fee: string;
}

function Compare({ loan }: { loan: LoanNow }) {
  const base: OfferText = {
    amount: groupAmountInput(String(Math.round(loan.balanceMinor / 100))),
    rate: String(loan.annualRateBps / 100),
    years: String(Math.max(1, Math.round(loan.monthsLeft / 12))),
    fee: "10,000",
  };
  const [a, setA] = useState<OfferText>(base);
  const [b, setB] = useState<OfferText>({ ...base, rate: String(Math.max(1, loan.annualRateBps - 25) / 100), fee: groupAmountInput(String(Math.round(loan.balanceMinor * 0.01 / 100))) });
  const parse = (o: OfferText): Offer | null => {
    const bps = rateOf(o.rate);
    const years = Number(o.years);
    const principalMinor = amountOf(o.amount);
    return bps && principalMinor > 0 && years > 0 ? { principalMinor, annualRateBps: bps, tenureMonths: Math.round(years * 12), feeMinor: amountOf(o.fee) } : null;
  };
  const oa = parse(a);
  const ob = parse(b);
  const ca = oa ? offerCost(oa) : null;
  const cb = ob ? offerCost(ob) : null;
  const better = ca && cb ? (ca.totalCostMinor === cb.totalCostMinor ? null : ca.totalCostMinor < cb.totalCostMinor ? "A" : "B") : null;

  const column = (name: "A" | "B", o: OfferText, set: (o: OfferText) => void, c: ReturnType<typeof offerCost> | null) => (
    <div className={cn("grid content-start gap-2 rounded-lg border p-3", better === name && "border-emerald-500/60 bg-emerald-500/5")}>
      <p className="flex items-center justify-between text-sm font-medium">
        Offer {name}
        {better === name && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">Cheaper</span>}
      </p>
      <Money id={`cmp-${name}-amount`} label="Amount" value={o.amount} onChange={(v) => set({ ...o, amount: v })} />
      <div className="grid grid-cols-2 gap-2">
        <Field id={`cmp-${name}-rate`} label="Rate %">
          <Input id={`cmp-${name}-rate`} inputMode="decimal" className="tabular-nums" value={o.rate} onChange={(e) => set({ ...o, rate: e.target.value })} />
        </Field>
        <Field id={`cmp-${name}-years`} label="Years">
          <Input id={`cmp-${name}-years`} inputMode="numeric" className="tabular-nums" value={o.years} onChange={(e) => set({ ...o, years: e.target.value })} />
        </Field>
      </div>
      <Money id={`cmp-${name}-fee`} label="Fees" value={o.fee} onChange={(v) => set({ ...o, fee: v })} />
      {c && (
        <dl className="mt-1 grid gap-1 border-t pt-2 text-sm tabular-nums">
          <Line label="EMI" value={rs(c.emiMinor)} />
          <Line label="Interest" value={rs(c.interestMinor)} />
          <Line label="Interest + fees" value={rs(c.totalCostMinor)} strong />
          <Line label="Real rate with fees" value={pct(c.effectiveRateBps)} />
        </dl>
      )}
    </div>
  );

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">A lower rate isn&apos;t always cheaper: fees count too. The real rate includes them.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {column("A", a, setA, ca)}
        {column("B", b, setB, cb)}
      </div>
      {ca && cb && better && (
        <p className="text-sm">
          Offer {better} costs <strong>{rs(Math.abs(ca.totalCostMinor - cb.totalCostMinor))}</strong> less over the loan.
        </p>
      )}
    </div>
  );
}

/* ---------------- Small pieces ---------------- */

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Money({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <Field id={id} label={label}>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
        <Input id={id} amount autoComplete="off" className="pl-7 tabular-nums" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

function Choice({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" className="flex h-10 rounded-lg border bg-muted p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("flex-1 rounded-md px-1.5 font-medium", value === o.value ? "bg-card shadow-sm" : "text-muted-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Results({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/40 p-3 text-sm tabular-nums">{children}</dl>;
}

function Big({ label, value, sub, subTone, good, bad }: { label: string; value: string; sub?: string; subTone?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-semibold", good && "text-emerald-700 dark:text-emerald-400", bad && "text-rose-700 dark:text-rose-400")}>{value}</dd>
      {sub && <dd className={cn("text-xs text-muted-foreground", subTone)}>{sub}</dd>}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="col-span-2 flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn(strong ? "font-semibold" : "font-medium")}>{value}</dd>
    </div>
  );
}

function Option({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5 rounded-lg border p-3 text-sm tabular-nums">
      <p className="font-medium">{title}</p>
      {detail && <p className="-mt-1 text-xs text-muted-foreground">{detail}</p>}
      <dl className="grid gap-1">{children}</dl>
    </div>
  );
}
