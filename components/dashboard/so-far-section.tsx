"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { currentMonthKey, formatDisplayDate, monthStart, shiftMonth, todayISO } from "@/lib/domain/dates";
import { MONEY_BACK_CATEGORY_IDS } from "@/lib/finance/state";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "../category-icon";
import { useFinance } from "../finance-provider";

type Span = "month" | "3m" | "year" | "all";
const SPANS: { id: Span; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "3m", label: "Last 3 months" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
];

const rupees = (minor: number) => {
  const sign = minor < 0 ? "−" : "";
  return `${sign}₹${Math.round(Math.abs(minor) / 100).toLocaleString("en-IN")}`;
};

/**
 * "So far, how much did I earn, how much did I spend, and on what?" Exact totals for a chosen period,
 * straight from the same engine report the rest of the app uses. Every row opens the entries behind it.
 */
export function SoFarSection() {
  const { book, report, getCategory } = useFinance();
  const [span, setSpan] = useState<Span>("all");

  const { from, to } = useMemo(() => {
    const today = todayISO();
    const ym = currentMonthKey();
    if (span === "month") return { from: monthStart(ym), to: today };
    if (span === "3m") return { from: monthStart(shiftMonth(ym, -2)), to: today };
    if (span === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today };
    const first = book.events.reduce((m, e) => (e.date < m ? e.date : m), today);
    return { from: first, to: today };
  }, [span, book.events]);

  const r = useMemo(() => report(from, to), [report, from, to]);
  // The span of dates the app actually has entries for (opening balances aside).
  const coverage = useMemo(() => {
    if (book.events.length === 0) return null;
    let first = book.events[0].date;
    let last = first;
    for (const e of book.events) {
      if (e.date < first) first = e.date;
      if (e.date > last) last = e.date;
    }
    return { first, last, count: book.events.length };
  }, [book.events]);
  // Colour slots come from the all-time ranking, so switching the period never repaints a category.
  const slots = useMemo(() => {
    const first = book.events.reduce((m, e) => (e.date < m ? e.date : m), todayISO());
    const all = report(first, todayISO());
    const rank = (list: Row[]) => new Map([...list].filter((c) => c.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor).map((c, i) => [c.categoryId, i] as const));
    return { spent: rank(all.expensesByCategory), earned: rank(all.incomeByCategory.filter((c) => !MONEY_BACK_CATEGORY_IDS.has(c.categoryId))) };
  }, [book.events, report]);
  const spent = [...r.expensesByCategory].filter((c) => c.amountMinor > 0).sort((a, b) => b.amountMinor - a.amountMinor);
  const earned = [...r.incomeByCategory].filter((c) => c.amountMinor > 0 && !MONEY_BACK_CATEGORY_IDS.has(c.categoryId)).sort((a, b) => b.amountMinor - a.amountMinor);
  const flow = Object.values(r.cashFlow);
  const cameIn = flow.reduce((t, f) => t + f.inflowMinor, 0);
  const wentOut = flow.reduce((t, f) => t + f.outflowMinor, 0);
  const lentOut = r.cashFlow.lending?.outflowMinor ?? 0;
  const gotBack = r.cashFlow.lending?.inflowMinor ?? 0;

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm sm:p-6" data-testid="so-far">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Earned & spent</h2>
          <p className="text-xs text-muted-foreground" data-testid="data-range">
            {coverage ? (
              <>
                Your records run from <strong className="font-medium text-foreground">{formatDisplayDate(coverage.first)}</strong> to{" "}
                <strong className="font-medium text-foreground">{formatDisplayDate(coverage.last)}</strong> · {coverage.count.toLocaleString("en-IN")} entries
                {span !== "all" && <> · showing {formatDisplayDate(from)} – {formatDisplayDate(to)}</>}
              </>
            ) : (
              "No entries yet"
            )}
          </p>
        </div>
        <div role="group" aria-label="Period" className="inline-flex rounded-lg bg-muted p-0.5">
          {SPANS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={span === s.id}
              onClick={() => setSpan(s.id)}
              className={cn("rounded-md px-3 py-1 text-xs font-medium", span === s.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Big label="Earned" value={r.incomeMinor} tone="good" href={activityHref({ type: "income", from, to })} />
        <Big
          label="Spent"
          value={r.expensesMinor}
          tone="bad"
          sub={r.refundsMinor > 0 ? `after ${rupees(r.refundsMinor)} refunds & reimbursements` : undefined}
          href={activityHref({ group: "spending", from, to })}
        />
        <Big label={r.savingsMinor >= 0 ? "Saved" : "Overspent"} value={Math.abs(r.savingsMinor)} tone={r.savingsMinor >= 0 ? "good" : "bad"} />
        <Big label="Lent out / got back" value={lentOut} sub={`got back ${rupees(gotBack)}`} href={activityHref({ group: "people", from, to })} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        All money that came into your bank & cash: {formatExactINR(cameIn)} · went out: {formatExactINR(wentOut)}. Earned and spent leave out transfers between your own accounts, loans and repayments. Refunds, cashback and reimbursements are money back, so they lower spending instead of counting as earned.
      </p>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <Breakdown title="Where you spent" rows={spent} getCategory={getCategory} hrefFor={(id) => activityHref({ group: "spending", category: id, from, to })} slotOf={(id) => slots.spent.get(id)} />
        <Breakdown title="Where you earned from" rows={earned} getCategory={getCategory} hrefFor={(id) => activityHref({ type: "income", category: id, from, to })} slotOf={(id) => slots.earned.get(id)} />
      </div>
    </section>
  );
}

function Big({ label, value, tone, sub, href }: { label: string; value: number; tone?: "good" | "bad"; sub?: string; href?: string }) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone === "good" && "text-emerald-700", tone === "bad" && "text-rose-700")} title={formatExactINR(value)}>
        {rupees(value)}
      </div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </>
  );
  const cls = "block rounded-xl border bg-card px-3 py-2.5";
  return href ? (
    <Link href={href} className={cn(cls, "hover:bg-muted/50")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * Validated categorical slots (light, dark) in fixed order. A category's slot is its all-time rank,
 * so its colour never changes with the period. Beyond 7, categories fold into one grey slice.
 */
const SLOTS = [
  ["#2a78d6", "#3987e5"],
  ["#eb6834", "#d95926"],
  ["#1baf7a", "#199e70"],
  ["#eda100", "#c98500"],
  ["#e87ba4", "#d55181"],
  ["#008300", "#008300"],
  ["#4a3aa7", "#9085e9"],
] as const;
const REST_COLOR = "#a3a29d";
const REST_ID = "__rest";

type Row = { categoryId: string; amountMinor: number };
type Slice = { id: string; label: string; amount: number; color: string };

const pctText = (part: number, total: number) => {
  const p = total > 0 ? (part / total) * 100 : 0;
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
};

/** Donut of where the money went (or came from), its legend, and the full list with each share. */
function Breakdown({
  title,
  rows,
  getCategory,
  hrefFor,
  slotOf,
}: {
  title: string;
  rows: Row[];
  getCategory: ReturnType<typeof useFinance>["getCategory"];
  hrefFor: (id: string) => string;
  slotOf: (id: string) => number | undefined;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const total = rows.reduce((t, r) => t + r.amountMinor, 0);
  const hasOwn = (id: string) => (slotOf(id) ?? SLOTS.length) < SLOTS.length;
  const colorOf = (id: string) => (hasOwn(id) ? SLOTS[slotOf(id)!][0] : REST_COLOR);

  const restAmount = rows.filter((r) => !hasOwn(r.categoryId)).reduce((t, r) => t + r.amountMinor, 0);
  const slices: Slice[] = [
    ...rows.filter((r) => hasOwn(r.categoryId)).map((r) => ({ id: r.categoryId, label: getCategory(r.categoryId).name, amount: r.amountMinor, color: colorOf(r.categoryId) })),
    ...(restAmount > 0 ? [{ id: REST_ID, label: "Everything else", amount: restAmount, color: REST_COLOR }] : []),
  ];
  // A hovered list row that lives in the grey slice highlights that slice.
  const sliceOf = (id: string | null) => (id === null ? null : hasOwn(id) || id === REST_ID ? id : REST_ID);
  const activeSlice = sliceOf(hover);
  const activeRow = hover && hover !== REST_ID ? rows.find((r) => r.categoryId === hover) : undefined;
  const caption = activeRow
    ? { label: getCategory(activeRow.categoryId).name, amount: activeRow.amountMinor }
    : hover === REST_ID
      ? { label: "Everything else", amount: restAmount }
      : null;

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in this period.</p>
      ) : (
        <>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <Donut slices={slices} total={total} active={activeSlice} onHover={setHover} />
            <ul className="grid w-full flex-1 grid-cols-2 gap-x-4 gap-y-1 text-xs" aria-label={`${title}: legend`}>
              {slices.map((s) => (
                <li
                  key={s.id}
                  className={cn("flex items-center gap-1.5 rounded px-1 py-0.5", activeSlice === s.id && "bg-muted")}
                  onMouseEnter={() => setHover(s.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                  <span className="truncate">{s.label}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">{pctText(s.amount, total)}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 h-4 text-xs text-muted-foreground" aria-live="polite">
            {caption ? (
              <>
                <span className="font-medium text-foreground">{caption.label}</span> · {rupees(caption.amount)} · {pctText(caption.amount, total)}
              </>
            ) : (
              "Point at a slice or a row for its share"
            )}
          </p>

          <ul className="mt-3 divide-y overflow-hidden rounded-xl border">
            {rows.map((c) => {
              const cat = getCategory(c.categoryId);
              return (
                <li key={c.categoryId}>
                  <Link
                    href={hrefFor(c.categoryId)}
                    onMouseEnter={() => setHover(c.categoryId)}
                    onMouseLeave={() => setHover(null)}
                    className={cn("flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/60", hover === c.categoryId && "bg-muted/60")}
                  >
                    <span className="flex w-14 shrink-0 items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(c.categoryId) }} />
                      {pctText(c.amountMinor, total)}
                    </span>
                    <CategoryIcon category={cat} />
                    <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                    <span className="shrink-0 font-medium tabular-nums">{rupees(c.amountMinor)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** Donut with a 2px card-coloured gap between slices; the pointed-at slice pulls out a little. Total in the hole. */
function Donut({ slices, total, active, onHover }: { slices: Slice[]; total: number; active: string | null; onHover: (id: string | null) => void }) {
  const size = 176;
  const outer = 76;
  const inner = 48;
  const c = size / 2;
  const at = (radius: number, a: number) => `${c + radius * Math.cos(a)},${c + radius * Math.sin(a)}`;
  let angle = -Math.PI / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Share of each category" className="shrink-0 overflow-visible">
      {slices.map((s) => {
        const sweep = total > 0 ? (s.amount / total) * Math.PI * 2 : 0;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        const handlers = { onMouseEnter: () => onHover(s.id), onMouseLeave: () => onHover(null) };
        const dim = active !== null && active !== s.id ? 0.45 : 1;
        if (sweep >= Math.PI * 2 - 1e-6) {
          return <circle key={s.id} cx={c} cy={c} r={(outer + inner) / 2} fill="none" stroke={s.color} strokeWidth={outer - inner} {...handlers} />;
        }
        const mid = (start + end) / 2;
        const pull = active === s.id ? 5 : 0;
        const large = sweep > Math.PI ? 1 : 0;
        return (
          <path
            key={s.id}
            d={`M${at(outer, start)} A${outer},${outer} 0 ${large} 1 ${at(outer, end)} L${at(inner, end)} A${inner},${inner} 0 ${large} 0 ${at(inner, start)} Z`}
            fill={s.color}
            stroke="var(--card)"
            strokeWidth={2}
            strokeLinejoin="round"
            opacity={dim}
            transform={`translate(${Math.cos(mid) * pull} ${Math.sin(mid) * pull})`}
            className="cursor-pointer transition-[opacity,transform] duration-150"
            {...handlers}
          >
            <title>{`${s.label}: ${rupees(s.amount)} (${pctText(s.amount, total)})`}</title>
          </path>
        );
      })}
      <text x={c} y={c - 5} textAnchor="middle" fontSize="11" className="fill-muted-foreground">
        Total
      </text>
      <text x={c} y={c + 12} textAnchor="middle" fontSize="14" fontWeight={600} className="fill-foreground">
        {rupees(total)}
      </text>
    </svg>
  );
}
