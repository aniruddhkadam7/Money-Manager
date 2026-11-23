"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDisplayDate, shiftMonth, todayISO } from "@/lib/domain/dates";
import { formatAmountField } from "@/lib/domain/money";
import { formatRupees } from "@/lib/finance/describe";
import { formatCompactINR } from "@/lib/charts/format";
import { loanPlan } from "@/lib/finance/loan";
import type { LoanTerms } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { RangeTabs } from "../charts/primitives";
import { useWidth } from "../charts/use-width";
import { LoanTools } from "./loan-tools";
import type { Account } from "@/lib/finance/types";

/*
 * The two parts of what you repay, in the validated categorical pair (slots 1 and 2 of the app's chart palette,
 * light / dark): principal blue, interest orange. Text stays in ink colours; the swatch beside it carries identity.
 */
const PRINCIPAL = "text-[#2a78d6] dark:text-[#3987e5]";
const INTEREST = "text-[#eb6834] dark:text-[#d95926]";

const AMOUNT = { min: 10_000, max: 2_00_00_000, step: 10_000 };
const RATE = { min: 1, max: 30, step: 0.05 };
const YEARS = { min: 1, max: 30 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rupeesText = (rupees: number) => rupees.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/**
 * A loan calculator on the Loans tab: slide or type the amount, rate and tenure; the EMI, total interest and total
 * repaid update as you go, with the split drawn as a ring and the year-by-year (or month-by-month) schedule under it.
 * The same arithmetic as your own loans (lib/finance/loan.ts). "Add as a loan" opens Add loan with these filled in.
 */
export function EmiCalculator({
  onAddLoan,
  className,
  planning,
  onStopPlanning,
  onClose,
}: {
  onAddLoan: (terms: LoanTerms) => void;
  className?: string;
  /** One of your loans, opened with its Plan button: the calculator starts from what's owed now and the EMIs left. */
  planning?: { account: Account; owedMinor: number; monthsLeft: number };
  onStopPlanning?: () => void;
  /** Opened from outside (the Loans tab's tile): it starts open, and closing it hands back to the tile. */
  onClose?: () => void;
}) {
  const [amount, setAmount] = useState(planning ? Math.max(10_000, Math.round(planning.owedMinor / 100)) : 10_00_000);
  const [rate, setRate] = useState(planning?.account.loanTerms ? planning.account.loanTerms.annualRateBps / 100 : 8.5);
  const [tenure, setTenure] = useState(planning ? Math.max(1, planning.monthsLeft) : 5);
  const [unit, setUnit] = useState<"years" | "months">(planning ? "months" : "years");
  const [showSchedule, setShowSchedule] = useState(false);
  // Closed until you open it (the Loans tab leads with your loans), unless a loan's Plan button opened it.
  const [openHere, setOpen] = useState(!!planning);
  const open = onClose ? true : openHere;
  const [by, setBy] = useState<"year" | "month">("year");

  const months = Math.max(1, Math.round(unit === "years" ? tenure * 12 : tenure));
  // EMIs start next month, on the 5th, unless the loan you add says otherwise.
  const firstEmiDate = `${shiftMonth(todayISO().slice(0, 7), 1)}-05`;
  const terms: LoanTerms = useMemo(
    () => ({ principalMinor: Math.round(amount * 100), annualRateBps: Math.round(rate * 100), tenureMonths: months, firstEmiDate }),
    [amount, rate, months, firstEmiDate],
  );
  const plan = useMemo(() => loanPlan(terms), [terms]);
  const interestShare = plan.totalPaidMinor > 0 ? plan.totalInterestMinor / plan.totalPaidMinor : 0;

  // Year by year: what each calendar year of EMIs pays off and in interest, and what's owed at its end.
  const years = useMemo(() => {
    const out: { year: string; principalMinor: number; interestMinor: number; balanceMinor: number; emis: number }[] = [];
    for (const r of plan.rows) {
      const year = r.date.slice(0, 4);
      const last = out.at(-1);
      if (last && last.year === year) {
        last.principalMinor += r.principalMinor;
        last.interestMinor += r.interestMinor;
        last.balanceMinor = r.balanceMinor;
        last.emis++;
      } else out.push({ year, principalMinor: r.principalMinor, interestMinor: r.interestMinor, balanceMinor: r.balanceMinor, emis: 1 });
    }
    return out;
  }, [plan]);

  return (
    <Card id="emi-calculator" className={className} data-testid="emi-calculator">
      <CardHeader className={cn("max-sm:px-4 max-sm:pt-4", !open && "max-sm:pb-4")}>
        <button
          type="button"
          onClick={() => (onClose ? onClose() : setOpen((v) => !v))}
          aria-expanded={open}
          aria-controls="emi-calculator-body"
          className="-m-1 flex w-full items-center justify-between gap-3 rounded-lg p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="emi-calculator-toggle"
        >
          <span>
            <CardTitle>EMI calculator</CardTitle>
            {!open && <span className="mt-0.5 block text-xs text-muted-foreground">Work out the EMI, interest and schedule for any loan</span>}
          </span>
          <ChevronDown className={cn("size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CardHeader>
      {open && (
      <CardContent id="emi-calculator-body" className="grid gap-6 max-sm:px-4 lg:grid-cols-[1fr_auto] lg:gap-10">
        {planning && (
          <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm lg:col-span-2" data-testid="calc-planning">
            <span>
              Planning <strong>{planning.account.name}</strong>: what you owe now, {planning.monthsLeft} EMIs left.
            </span>
            {onStopPlanning && (
              <button type="button" onClick={onStopPlanning} className="text-xs font-medium text-primary hover:underline">
                Use a blank calculator
              </button>
            )}
          </p>
        )}
        <div className="grid content-start gap-5">
          <SliderField
            id="calc-amount"
            label="Loan amount"
            prefix="₹"
            value={amount}
            display={rupeesText(amount)}
            {...AMOUNT}
            onChange={setAmount}
            parse={(t) => Number(t.replace(/[,₹\s]/g, ""))}
            grouped
          />
          <SliderField
            id="calc-rate"
            label="Interest rate (a year)"
            suffix="%"
            value={rate}
            display={String(rate)}
            {...RATE}
            onChange={(v) => setRate(Math.round(v * 100) / 100)}
            parse={(t) => Number(t.replace(/[%\s]/g, ""))}
          />
          <SliderField
            id="calc-tenure"
            label="Tenure"
            value={tenure}
            display={String(tenure)}
            min={unit === "years" ? YEARS.min : 1}
            max={unit === "years" ? YEARS.max : YEARS.max * 12}
            step={1}
            onChange={setTenure}
            parse={(t) => Number(t)}
            unitSwitch={
              <div role="radiogroup" aria-label="Tenure in" className="flex rounded-md border bg-muted p-0.5 text-xs">
                {(["years", "months"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    role="radio"
                    aria-checked={unit === u}
                    onClick={() => {
                      if (u === unit) return;
                      // Keep the same length of loan when switching units.
                      setTenure(u === "months" ? months : clamp(Math.round(months / 12), YEARS.min, YEARS.max));
                      setUnit(u);
                    }}
                    className={cn("rounded px-1.5 py-0.5 font-medium", unit === u ? "bg-card shadow-sm" : "text-muted-foreground")}
                  >
                    {u === "years" ? "Yr" : "Mo"}
                  </button>
                ))}
              </div>
            }
          />

          <dl className="grid gap-2.5 border-t pt-4 text-sm tabular-nums">
            <Row label="Monthly EMI" value={wholeRupees(plan.emiMinor)} strong />
            <Row label="Principal amount" value={wholeRupees(terms.principalMinor)} swatch={PRINCIPAL} />
            <Row label="Total interest" value={wholeRupees(plan.totalInterestMinor)} swatch={INTEREST} />
            <Row label="Total amount" value={wholeRupees(plan.totalPaidMinor)} />
          </dl>
        </div>

        <div className="grid content-start justify-items-center gap-3">
          <Ring interestShare={interestShare} principalMinor={terms.principalMinor} interestMinor={plan.totalInterestMinor} />
          <Button size="sm" onClick={() => onAddLoan(terms)} data-testid="calc-add-loan">
            <Plus /> Add as a loan
          </Button>
        </div>

        <EmiSplitChart rows={plan.rows} />

        <LoanTools
          loan={{ balanceMinor: terms.principalMinor, annualRateBps: terms.annualRateBps, emiMinor: plan.emiMinor, monthsLeft: months }}
          rows={plan.rows}
          realLoan={planning?.account}
        />

        <div className="grid gap-3 lg:col-span-2">
          <button
            type="button"
            onClick={() => setShowSchedule((v) => !v)}
            aria-expanded={showSchedule}
            className="flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Repayment schedule (yearly / monthly)
            <ChevronDown className={cn("size-4 transition-transform", showSchedule && "rotate-180")} />
          </button>
          {showSchedule && (
            <>
              <div className="justify-self-center">
                <RangeTabs
                  label="Schedule by"
                  value={by}
                  options={[
                    { value: "year", label: "Yearly" },
                    { value: "month", label: "Monthly" },
                  ]}
                  onChange={setBy}
                />
              </div>
              <div className="max-h-96 overflow-auto rounded-lg border">
                <table className="w-full text-xs tabular-nums" data-testid="calc-schedule">
                  <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-[0_1px_0_var(--border)] [&_th]:bg-muted/60">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">{by === "year" ? "Year" : "Month"}</th>
                      <th className="px-2 py-1.5 text-right font-medium">Principal</th>
                      <th className="px-2 py-1.5 text-right font-medium">Interest</th>
                      <th className="px-2 py-1.5 text-right font-medium">Owed after</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {by === "year"
                      ? years.map((y) => (
                          <tr key={y.year}>
                            <td className="px-2 py-1.5">
                              {y.year} <span className="text-muted-foreground">· {y.emis} EMI{y.emis === 1 ? "" : "s"}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right">{formatRupees(y.principalMinor)}</td>
                            <td className="px-2 py-1.5 text-right">{formatRupees(y.interestMinor)}</td>
                            <td className="px-2 py-1.5 text-right">{formatRupees(y.balanceMinor)}</td>
                          </tr>
                        ))
                      : plan.rows.map((r) => (
                          <tr key={r.n}>
                            <td className="whitespace-nowrap px-2 py-1.5">
                              {r.n}. {formatDisplayDate(r.date)}
                            </td>
                            <td className="px-2 py-1.5 text-right">{formatRupees(r.principalMinor)}</td>
                            <td className="px-2 py-1.5 text-right">{formatRupees(r.interestMinor)}</td>
                            <td className="px-2 py-1.5 text-right">{formatRupees(r.balanceMinor)}</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </CardContent>
      )}
    </Card>
  );
}

/** A label with its value in a box you can type in, and a slider under it; either one moves the other. */
function SliderField({
  id,
  label,
  value,
  display,
  min,
  max,
  step,
  prefix,
  suffix,
  unitSwitch,
  onChange,
  parse,
  grouped,
}: {
  id: string;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  unitSwitch?: React.ReactNode;
  onChange: (v: number) => void;
  parse: (text: string) => number;
  /** A rupee amount: commas appear as you type. */
  grouped?: boolean;
}) {
  // Typing keeps your text until it's a number; the slider and results follow once it is.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm text-muted-foreground">
          {label}
        </label>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {prefix && <span aria-hidden>{prefix}</span>}
            <input
              id={id}
              inputMode="decimal"
              className="w-24 bg-transparent text-right tabular-nums outline-none sm:w-28"
              value={draft ?? display}
              onChange={(e) => {
                if (grouped) formatAmountField(e.currentTarget);
                setDraft(e.target.value);
                const v = parse(e.target.value);
                if (Number.isFinite(v) && v > 0) onChange(clamp(v, min, max));
              }}
              onBlur={() => setDraft(null)}
            />
            {suffix && <span aria-hidden>{suffix}</span>}
          </div>
          {unitSwitch}
        </div>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={clamp(value, min, max)}
        onChange={(e) => {
          setDraft(null);
          onChange(Number(e.target.value));
        }}
        className="w-full accent-emerald-600"
      />
    </div>
  );
}

/** The calculator's figures in whole rupees, as loan calculators show them. */
const wholeRupees = (minor: number) => formatRupees(Math.round(minor / 100) * 100);

type SplitRow = { n: number; date: string; interestMinor: number; principalMinor: number; balanceMinor: number };

/**
 * How each EMI splits over the life of the loan: the interest part (orange) starts high, because it's charged on
 * everything still owed, and falls as the loan is paid down; the principal part (blue) rises to match. Where they
 * cross, most of each EMI starts paying the loan itself. Hover or tap anywhere for that EMI's split.
 */
function EmiSplitChart({ rows }: { rows: SplitRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const HEIGHT = 170;
  const AXIS_X = 18; // years under the plot
  const AXIS_Y = 44; // amounts on the left
  const TOP = 8;
  const plotH = HEIGHT - AXIS_X - TOP;
  const plotW = Math.max(width - AXIS_Y - 4, 1);
  if (rows.length === 0) return null;

  const max = Math.max(...rows.map((r) => Math.max(r.interestMinor, r.principalMinor)), 1);
  const x = (i: number) => AXIS_Y + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const y = (v: number) => TOP + plotH - (v / max) * plotH;
  const path = (pick: (r: SplitRow) => number) => rows.map((r, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(pick(r)).toFixed(1)}`).join(" ");
  // The first EMI where principal is at least the interest.
  const cross = rows.findIndex((r) => r.principalMinor >= r.interestMinor);
  // Amounts on the left: zero, half and the top.
  const ticks = [0, max / 2, max];
  // Years along the bottom: the first EMI's year, then about four more.
  const yearMarks = rows
    .map((r, i) => ({ i, year: r.date.slice(0, 4) }))
    .filter((m, k, all) => k === 0 || m.year !== all[k - 1].year)
    .filter((_, k, all) => k % Math.max(1, Math.ceil(all.length / 5)) === 0);
  const shown = hover !== null ? rows[hover] : null;

  const pick = (clientX: number, box: DOMRect) => {
    const i = Math.round(((clientX - box.left - AXIS_Y) / plotW) * (rows.length - 1));
    setHover(Math.min(rows.length - 1, Math.max(0, i)));
  };

  return (
    <div className="grid gap-2 lg:col-span-2" data-testid="calc-split-chart">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium">What each EMI pays</h3>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={cn("h-0.5 w-3 rounded-full bg-current", INTEREST)} /> Interest
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className={cn("h-0.5 w-3 rounded-full bg-current", PRINCIPAL)} /> Principal
          </span>
        </div>
      </div>
      <div ref={ref} className="relative touch-pan-y" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Each EMI's interest falls from ${wholeRupees(rows[0].interestMinor)} to ${wholeRupees(rows.at(-1)!.interestMinor)}, while its principal rises from ${wholeRupees(rows[0].principalMinor)}.`}
            className="block overflow-visible"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t, k) => (
              <g key={k}>
                <line x1={AXIS_Y} x2={AXIS_Y + plotW} y1={y(t)} y2={y(t)} className={k === 0 ? "stroke-slate-300 dark:stroke-slate-600" : "stroke-slate-200 dark:stroke-slate-700"} strokeDasharray={k === 0 ? undefined : "2 4"} />
                <text x={AXIS_Y - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
                  {formatCompactINR(t)}
                </text>
              </g>
            ))}
            {yearMarks.map((m) => (
              <text key={m.i} x={x(m.i)} y={HEIGHT - 4} textAnchor="middle" className="fill-slate-500 text-[10px] tabular-nums">
                {m.year}
              </text>
            ))}

            {/* Where principal overtakes interest. */}
            {cross > 0 && (
              <g>
                <line x1={x(cross)} x2={x(cross)} y1={TOP} y2={TOP + plotH} className="stroke-slate-400 dark:stroke-slate-500" strokeDasharray="3 3" />
                <text x={x(cross)} y={TOP + 2} dy="0.8em" textAnchor={cross > rows.length * 0.7 ? "end" : "start"} dx={cross > rows.length * 0.7 ? -4 : 4} className="fill-slate-600 text-[10px] dark:fill-slate-300">
                  EMI {rows[cross].n}: principal &gt; interest
                </text>
              </g>
            )}

            <path d={path((r) => r.interestMinor)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" className={INTEREST} />
            <path d={path((r) => r.principalMinor)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" className={PRINCIPAL} />

            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={TOP + plotH} className="stroke-slate-400" strokeWidth={1} />
                <circle cx={x(hover)} cy={y(rows[hover].interestMinor)} r={4} fill="currentColor" className={cn(INTEREST, "stroke-card")} strokeWidth={2} />
                <circle cx={x(hover)} cy={y(rows[hover].principalMinor)} r={4} fill="currentColor" className={cn(PRINCIPAL, "stroke-card")} strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
        {shown && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 w-48 rounded-lg border bg-card p-2 text-xs shadow-lg"
            style={{ top: 0, left: Math.min(Math.max(x(hover) - 96, 0), Math.max(width - 192, 0)) }}
            role="status"
          >
            <p className="font-medium">
              EMI {shown.n} · {formatDisplayDate(shown.date)}
            </p>
            <p className="mt-1 flex justify-between gap-2 tabular-nums">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span aria-hidden className={cn("size-2 rounded-full bg-current", INTEREST)} /> Interest
              </span>
              {wholeRupees(shown.interestMinor)}
            </p>
            <p className="flex justify-between gap-2 tabular-nums">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span aria-hidden className={cn("size-2 rounded-full bg-current", PRINCIPAL)} /> Principal
              </span>
              {wholeRupees(shown.principalMinor)}
            </p>
            <p className="mt-1 flex justify-between gap-2 border-t pt-1 tabular-nums text-muted-foreground">
              <span>Owed after</span>
              {wholeRupees(shown.balanceMinor)}
            </p>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Interest is charged each month on what you still owe, so the first EMI is {Math.round((rows[0].interestMinor / (rows[0].interestMinor + rows[0].principalMinor)) * 100)}% interest. As the loan shrinks, more of the same EMI pays it off. Paying extra early saves the most interest.
      </p>
    </div>
  );
}

function Row({ label, value, strong, swatch }: { label: string; value: string; strong?: boolean; swatch?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted-foreground">
        {swatch && <span aria-hidden className={cn("size-2.5 rounded-full bg-current", swatch)} />}
        {label}
      </dt>
      <dd className={cn("text-foreground", strong ? "text-base font-semibold" : "font-medium")}>{value}</dd>
    </div>
  );
}

/**
 * What you repay, as a ring: principal and interest, a small gap between them, the interest share in the middle.
 * Hovering a part names it with its amount; the legend beside the numbers above carries the same colours.
 */
function Ring({ interestShare, principalMinor, interestMinor }: { interestShare: number; principalMinor: number; interestMinor: number }) {
  const size = 176;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // A 2px surface gap at each join (in arc length), unless one part is the whole ring.
  const gap = interestShare > 0 && interestShare < 1 ? 2 : 0;
  const interestLen = Math.max(0, c * interestShare - gap);
  const principalLen = Math.max(0, c * (1 - interestShare) - gap);
  const [hover, setHover] = useState<"principal" | "interest" | null>(null);
  const label =
    hover === "interest"
      ? { title: "Interest", value: wholeRupees(interestMinor) }
      : hover === "principal"
        ? { title: "Principal", value: wholeRupees(principalMinor) }
        : { title: "Interest", value: `${Math.round(interestShare * 100)}%` };

  return (
    <div className="grid justify-items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label={`Principal ${wholeRupees(principalMinor)}, interest ${wholeRupees(interestMinor)}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={hover === "principal" ? stroke + 4 : stroke}
            stroke="currentColor"
            className={cn(PRINCIPAL, "cursor-pointer transition-[stroke-width]")}
            strokeDasharray={`${principalLen} ${c - principalLen}`}
            strokeDashoffset={-(c * interestShare + gap / 2)}
            onPointerEnter={() => setHover("principal")}
            onPointerLeave={() => setHover(null)}
          >
            <title>Principal {wholeRupees(principalMinor)}</title>
          </circle>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={hover === "interest" ? stroke + 4 : stroke}
            stroke="currentColor"
            className={cn(INTEREST, "cursor-pointer transition-[stroke-width]")}
            strokeDasharray={`${interestLen} ${c - interestLen}`}
            strokeDashoffset={-(gap / 2)}
            onPointerEnter={() => setHover("interest")}
            onPointerLeave={() => setHover(null)}
          >
            <title>Interest {wholeRupees(interestMinor)}</title>
          </circle>
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="text-xs text-muted-foreground">{label.title}</span>
          <span className="text-lg font-semibold tabular-nums text-foreground">{label.value}</span>
        </div>
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-full bg-current", PRINCIPAL)} /> Principal
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-full bg-current", INTEREST)} /> Interest
        </span>
      </div>
    </div>
  );
}
