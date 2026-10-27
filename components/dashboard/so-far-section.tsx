"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { rollUpByParent } from "@/lib/domain/categories";
import { formatDisplayDate, todayISO } from "@/lib/domain/dates";
import { DEFAULT_PERIOD, PERIODS, rangeStart, type RangeKey } from "@/lib/finance/series";
import { HowYouPaid } from "./how-you-paid";
import { MONEY_BACK_CATEGORY_IDS } from "@/lib/finance/state";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "../category-icon";
import { shield } from "@/lib/privacy";
import { RangeTabs } from "../charts/primitives";
import { useFinance } from "../finance-provider";

const rupees = (minor: number) => {
  const sign = minor < 0 ? "−" : "";
  return shield(`${sign}₹${Math.round(Math.abs(minor) / 100).toLocaleString("en-IN")}`);
};

/**
 * "So far, how much did I earn, how much did I spend, and on what?" Exact totals for a chosen period,
 * straight from the same engine report the rest of the app uses. Every row opens the entries behind it.
 */
export function SoFarSection() {
  const { book, report, getCategory, categories } = useFinance();
  // The same periods as every other card on the dashboard.
  const [span, setSpan] = useState<RangeKey>(DEFAULT_PERIOD);
  // Phones show one breakdown at a time; wider screens show both side by side.
  const [side, setSide] = useState<"out" | "in">("out");

  const { from, to } = useMemo(() => {
    const today = todayISO();
    if (span !== "ALL") return { from: rangeStart(span, today, null), to: today };
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
    const rank = (list: Row[]) => new Map([...rollUpByParent(list.filter((c) => c.amountMinor > 0), categories)].sort((a, b) => b.amountMinor - a.amountMinor).map((c, i) => [c.categoryId, i] as const));
    return { spent: rank(all.expensesByCategory), earned: rank(all.incomeByCategory.filter((c) => !MONEY_BACK_CATEGORY_IDS.has(c.categoryId))) };
  }, [book.events, report, categories]);
  const spent = rollUpByParent([...r.expensesByCategory].filter((c) => c.amountMinor > 0), categories);
  const earned = [...r.incomeByCategory].filter((c) => c.amountMinor > 0 && !MONEY_BACK_CATEGORY_IDS.has(c.categoryId)).sort((a, b) => b.amountMinor - a.amountMinor);
  const flow = Object.values(r.cashFlow);
  const cameIn = flow.reduce((t, f) => t + f.inflowMinor, 0);
  const wentOut = flow.reduce((t, f) => t + f.outflowMinor, 0);
  const lentOut = r.cashFlow.lending?.outflowMinor ?? 0;
  const gotBack = r.cashFlow.lending?.inflowMinor ?? 0;

  return (
    <section className="rounded-3xl border glass p-4 sm:p-6" data-testid="so-far">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Earned & spent</h2>
          <p className="text-xs text-muted-foreground max-sm:hidden" data-testid="data-range">
            {coverage ? (
              <>
                Your records run from <strong className="font-medium text-foreground">{formatDisplayDate(coverage.first)}</strong> to{" "}
                <strong className="font-medium text-foreground">{formatDisplayDate(coverage.last)}</strong> · {coverage.count.toLocaleString("en-IN")} entries
                {span !== "ALL" && <> · showing {formatDisplayDate(from)} – {formatDisplayDate(to)}</>}
              </>
            ) : (
              "No entries yet"
            )}
          </p>
        </div>
        <RangeTabs label="Period" value={span} options={PERIODS} onChange={setSpan} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:grid-cols-4 sm:gap-3">
        <Big label="Earned" value={r.incomeMinor} tone="good" href={activityHref({ type: "income", from, to })} />
        <Big
          label="Spent"
          value={r.expensesMinor}
          tone="bad"
          sub={r.refundsMinor > 0 ? `after ${rupees(r.refundsMinor)} refunds & reimbursements` : undefined}
          href={activityHref({ group: "spending", from, to })}
        />
        <Big label={r.savingsMinor >= 0 ? "Saved" : "Overspent"} value={Math.abs(r.savingsMinor)} tone={r.savingsMinor >= 0 ? "good" : "bad"} />
        <Big label="Lent out / got back" value={lentOut} sub={`got back ${rupees(gotBack)}`} href={activityHref({ group: "people", from, to })} className="max-sm:hidden" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground max-sm:hidden">
        Bank & cash: in {formatExactINR(cameIn)} · out {formatExactINR(wentOut)}
      </p>

      <HowYouPaid from={from} to={to} />

      <div className="mt-4 lg:hidden">
        <RangeTabs
          label="Show"
          value={side}
          options={[
            { value: "out", label: "Where you spent" },
            { value: "in", label: "Where you earned" },
          ]}
          onChange={setSide}
        />
      </div>
      <div className="mt-3 grid gap-5 lg:mt-6 lg:grid-cols-2">
        <Breakdown
          className={cn(side !== "out" && "max-lg:hidden")}
          tone="out"
          title="Where you spent"
          rows={spent}
          net={{ minor: r.expensesMinor, href: activityHref({ group: "moneyback", from, to }) }}
          getCategory={getCategory}
          hrefFor={(id) => activityHref({ group: "spending", category: id, from, to })}
          slotOf={(id) => slots.spent.get(id)}
        />
        <Breakdown className={cn(side !== "in" && "max-lg:hidden")} tone="in" title="Where you earned from" rows={earned} getCategory={getCategory} hrefFor={(id) => activityHref({ type: "income", category: id, from, to })} slotOf={(id) => slots.earned.get(id)} />
      </div>
    </section>
  );
}

function Big({ label, value, tone, sub, href, className }: { label: string; value: number; tone?: "good" | "bad"; sub?: string; href?: string; className?: string }) {
  const body = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate text-base font-semibold tabular-nums sm:text-xl", tone === "good" && "text-emerald-700", tone === "bad" && "text-rose-700")} title={formatExactINR(value)}>
        {rupees(value)}
      </div>
      {sub && <div className="text-xs text-muted-foreground max-sm:hidden">{sub}</div>}
    </>
  );
  const cls = cn("block min-w-0 rounded-xl border bg-card px-2.5 py-2 sm:px-3 sm:py-2.5", className);
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
const PHONE_ROWS = 5;
const REST_ID = "__rest";

type Row = { categoryId: string; amountMinor: number; children?: Row[] };
type Slice = { id: string; label: string; amount: number; color: string };

const pctText = (part: number, total: number) => {
  const p = total > 0 ? (part / total) * 100 : 0;
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
};

/** Donut of where the money went (or came from), its legend, and the full list with each share. */
const TONES = {
  out: { kicker: "Money out", Icon: ArrowUpRight, head: "bg-rose-50/70 border-rose-100", badge: "bg-rose-100 text-rose-700", amount: "text-rose-700" },
  in: { kicker: "Money in", Icon: ArrowDownLeft, head: "bg-emerald-50/70 border-emerald-100", badge: "bg-emerald-100 text-emerald-700", amount: "text-emerald-700" },
} as const;

function Breakdown({
  className,
  tone,
  title,
  rows,
  net,
  getCategory,
  hrefFor,
  slotOf,
}: {
  className?: string;
  tone: keyof typeof TONES;
  title: string;
  rows: Row[];
  /**
   * Spending: the "Spent" total, after refunds that aren't taken off a category in this period (no matching
   * purchase, or the purchase was in an earlier period). The difference is listed as its own line so the
   * list adds up to the same total as the strip above.
   */
  net?: { minor: number; href: string };
  getCategory: ReturnType<typeof useFinance>["getCategory"];
  hrefFor: (id: string) => string;
  slotOf: (id: string) => number | undefined;
}) {
  const [hover, setHover] = useState<string | null>(null);
  // Phones list the top few; the rest open on request.
  const [all, setAll] = useState(false);
  // Main categories whose subcategories are showing; they start folded.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const total = rows.reduce((t, r) => t + r.amountMinor, 0);
  const shownTotal = net?.minor ?? total;
  const moneyBack = total - shownTotal;
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

  const t = TONES[tone];

  return (
    <div className={cn("glass overflow-hidden rounded-2xl border max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none max-sm:before:hidden", className)}>
      {/* Phones: the switch above names this list and the strip above has its total, so the header is for wider screens. */}
      <div className={cn("flex items-center gap-3 border-b px-4 py-3 max-sm:hidden", t.head)}>
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", t.badge)}>
          <t.Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t.kicker}</div>
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <span className={cn("shrink-0 text-lg font-semibold tabular-nums", t.amount)}>{rupees(shownTotal)}</span>
      </div>
      <div className="sm:p-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this period.</p>
        ) : (
          <>
            {/* Phones: the donut alone; the list below has each colour and share, so the legend is for wider screens. */}
            <div className="flex flex-col items-center gap-4 max-sm:mb-3 sm:flex-row">
              <Donut slices={slices} total={total} centerMinor={shownTotal} active={activeSlice} onHover={setHover} />
              <ul className="grid w-full flex-1 grid-cols-2 gap-x-4 gap-y-1 text-xs max-sm:hidden" aria-label={`${title}: legend`}>
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
            <p className="mt-2 h-4 text-xs text-muted-foreground max-sm:hidden" aria-live="polite">
              {caption ? (
                <>
                  <span className="font-medium text-foreground">{caption.label}</span> · {rupees(caption.amount)} · {pctText(caption.amount, total)}
                </>
              ) : (
                "Point at a slice or a row for its share"
              )}
            </p>

            <ul className="divide-y overflow-hidden rounded-xl border sm:mt-3">
              {rows.map((c, i) => {
                const cat = getCategory(c.categoryId);
                return (
                  <li key={c.categoryId} className={cn(!all && i >= PHONE_ROWS && "max-sm:hidden")}>
                    <div className="flex items-center">
                      {c.children && c.children.length > 0 ? (
                        <button
                          type="button"
                          aria-label={`${open.has(c.categoryId) ? "Hide" : "Show"} ${cat.name} subcategories`}
                          aria-expanded={open.has(c.categoryId)}
                          onClick={() => toggleOpen(c.categoryId)}
                          className="ml-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
                        >
                          <ChevronRight className={cn("size-4 transition-transform", open.has(c.categoryId) && "rotate-90")} />
                        </button>
                      ) : (
                        <span className="ml-1 size-7 shrink-0" />
                      )}
                      <Link
                        href={hrefFor(c.categoryId)}
                        onMouseEnter={() => setHover(c.categoryId)}
                        onMouseLeave={() => setHover(null)}
                        className={cn("flex min-w-0 flex-1 items-center gap-3 py-2 pl-1 pr-3 text-sm hover:bg-muted/60", hover === c.categoryId && "bg-muted/60")}
                      >
                        <CategoryIcon category={cat} />
                        <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                        <span className="flex w-14 shrink-0 items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums">
                          <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(c.categoryId) }} />
                          <span className="flex-1 text-center">{pctText(c.amountMinor, total)}</span>
                        </span>
                        <span className="min-w-0 flex-1 text-right font-medium tabular-nums">{rupees(c.amountMinor)}</span>
                      </Link>
                    </div>
                    {c.children && c.children.length > 0 && open.has(c.categoryId) && c.children.map((s) => (
                      <Link
                        key={s.categoryId}
                        href={hrefFor(s.categoryId)}
                        className="flex items-center gap-3 py-1.5 pl-9 pr-3 text-xs text-muted-foreground hover:bg-muted/60"
                      >
                        <span aria-hidden>↳</span>
                        <span className="min-w-0 flex-1 truncate">{getCategory(s.categoryId).name}</span>
                        <span className="w-14 shrink-0 text-center tabular-nums">{pctText(s.amountMinor, total)}</span>
                        <span className="min-w-0 flex-1 text-right font-medium tabular-nums">{rupees(s.amountMinor)}</span>
                      </Link>
                    ))}
                  </li>
                );
              })}
              {moneyBack > 0 && net && (
                <li>
                  <Link href={net.href} className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60" data-testid="money-back-row">
                    <span className="min-w-0 flex-1 truncate">Refunds & money back</span>
                    <span className="min-w-0 flex-1 text-right font-medium tabular-nums">{rupees(-moneyBack)}</span>
                  </Link>
                </li>
              )}
            </ul>
            {rows.length > PHONE_ROWS && (
              <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-medium text-emerald-700 hover:underline sm:hidden">
                {all ? "Show fewer" : `Show all ${rows.length}`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Donut with a 2px card-coloured gap between slices; the pointed-at slice pulls out a little. Total in the hole. */
function Donut({ slices, total, centerMinor, active, onHover }: { slices: Slice[]; total: number; /** The total printed in the hole. */ centerMinor: number; active: string | null; onHover: (id: string | null) => void }) {
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
        {rupees(centerMinor)}
      </text>
    </svg>
  );
}
