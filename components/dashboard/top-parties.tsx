"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { activityHref } from "@/lib/charts/links";
import { formatBps, formatExactINR, formatHeadlineINR } from "@/lib/charts/format";
import { formatDayMonth, monthEnd, monthStart, shiftMonth } from "@/lib/domain/dates";
import { incomeSources } from "@/lib/finance/sources";
import type { FinancialState, PersonSummary } from "@/lib/finance/state";
import { CategoryIcon } from "../category-icon";
import { PartyLogo } from "../brand-logo";
import { ChartCard, EmptyChart, RangeTabs } from "../charts/primitives";
import { useFinance } from "../finance-provider";

const MAX_ROWS = 4;
const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6"];

function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function Avatar({ name }: { name: string }) {
  const color = colorFor(name);
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold"
      style={{ backgroundColor: `${color}1f`, color }}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Bar({ ratio, color }: { ratio: number; color: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: shown ? `${Math.max(ratio * 100, 3)}%` : "0%", backgroundColor: color }}
      />
    </div>
  );
}

function Row({
  lead,
  title,
  caption,
  amount,
  ratio,
  color,
  href,
}: {
  lead: ReactNode;
  title: string;
  caption: string;
  amount: string;
  ratio: number;
  color: string;
  href: string;
}) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-xl px-1.5 py-1.5 outline-none hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring">
        {lead}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="break-words text-sm font-medium text-slate-900">{title}</span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{amount}</span>
          </div>
          <Bar ratio={ratio} color={color} />
          <p className="mt-1 truncate text-[11px] text-slate-400">{caption}</p>
        </div>
      </Link>
    </li>
  );
}

function More({ count, href }: { count: number; href: string }) {
  return count > 0 ? (
    <Link href={href} className="mt-1 block px-1.5 py-1 text-xs font-medium text-emerald-700 hover:underline">
      +{count} more
    </Link>
  ) : null;
}

type Span = "month" | "6M" | "12M";

/** Who pays me? */
function IncomeSourcesCard() {
  const { book, ledger, today, getCategory } = useFinance();
  const [span, setSpan] = useState<Span>("6M");

  const range = useMemo(() => {
    const ym = today.slice(0, 7);
    if (span === "month") return { from: monthStart(ym), to: monthEnd(ym), label: "this month" };
    const months = span === "6M" ? 5 : 11;
    return { from: monthStart(shiftMonth(ym, -months)), to: monthEnd(ym), label: span === "6M" ? "the last 6 months" : "the last 12 months" };
  }, [today, span]);

  const sources = useMemo(
    () => incomeSources(book, ledger, range.from, range.to, (id) => getCategory(id).name),
    [book, ledger, range, getCategory],
  );
  const total = sources.reduce((t, s) => t + s.amountMinor, 0);
  const shown = sources.slice(0, MAX_ROWS);

  return (
    <ChartCard
      title="Top income sources"
      action={
        <RangeTabs
          label="Income sources period"
          value={span}
          options={[{ value: "month", label: "Month" }, { value: "6M", label: "6M" }, { value: "12M", label: "12M" }]}
          onChange={setSpan}
        />
      }
    >
      {shown.length === 0 ? (
        <EmptyChart height={120}>No income recorded {range.label}.</EmptyChart>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">
            <span className="text-base font-semibold tabular-nums text-slate-900">{formatHeadlineINR(total)}</span> earned in {range.label}
          </p>
          <ul key={span} className="grid gap-0.5">
            {shown.map((s) => (
              <Row
                key={s.key}
                href={activityHref({ category: s.categoryId, q: s.name, from: range.from, to: range.to })}
                lead={<PartyLogo name={s.name} className="!rounded-full [&>img]:!size-6" fallback={<CategoryIcon category={getCategory(s.categoryId)} tile className="!size-9 !rounded-full" />} />}
                title={s.name}
                caption={`${formatBps(Math.round((s.amountMinor / total) * 10_000))} of income · ${s.count} ${s.count === 1 ? "payment" : "payments"} · last ${formatDayMonth(s.lastDate)}`}
                amount={formatExactINR(s.amountMinor)}
                ratio={s.amountMinor / shown[0].amountMinor}
                color="#059669"
              />
            ))}
          </ul>
          <More count={sources.length - shown.length} href={activityHref({ group: "income", from: range.from, to: range.to })} />
        </>
      )}
    </ChartCard>
  );
}

/** People who owe me (my borrowers) or whom I owe (my lenders). */
function PeopleCard({ title, side, people }: { title: string; side: "borrowers" | "lenders"; people: PersonSummary[] }) {
  const mine = side === "borrowers";
  const rows = people
    .map((p) => ({
      person: p.person,
      outstanding: mine ? p.owedToMe.outstandingMinor : p.iOwe.outstandingMinor,
      original: mine ? p.owedToMe.originalMinor : p.iOwe.originalMinor,
      settled: mine ? p.owedToMe.receivedMinor : p.iOwe.repaidMinor,
    }))
    .filter((r) => r.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
  // Every open balance is listed: a debt shouldn't hide behind "+N more".
  const shown = rows;
  const total = rows.reduce((t, r) => t + r.outstanding, 0);

  return (
    <ChartCard
      title={title}
      action={
        <Link href={activityHref({ group: mine ? "lent" : "borrowed", owed: mine ? "me" : "you" })} className="text-xs font-medium text-emerald-700 hover:underline">
          {mine ? "All lending" : "All borrowing"}
        </Link>
      }
    >
      {shown.length === 0 ? (
        <EmptyChart height={120}>{mine ? "Nobody owes you money right now." : "You don't owe anyone right now."}</EmptyChart>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">
            <span className="text-base font-semibold tabular-nums text-slate-900">{formatHeadlineINR(total)}</span>{" "}
            {mine ? `owed to you by ${rows.length} ${rows.length === 1 ? "person" : "people"}` : `owed by you to ${rows.length} ${rows.length === 1 ? "person" : "people"}`}
          </p>
          <ul className="grid gap-0.5">
            {shown.map((r) => (
              <Row
                key={r.person.id}
                href={activityHref({ person: r.person.id })}
                lead={<PartyLogo name={r.person.name} className="!rounded-full [&>img]:!size-6" fallback={<Avatar name={r.person.name} />} />}
                title={r.person.name}
                caption={
                  r.settled > 0
                    ? `${mine ? "Paid back" : "You've repaid"} ${formatExactINR(r.settled)} of ${formatExactINR(r.original)}`
                    : `${mine ? "Lent" : "Borrowed"} ${formatExactINR(r.original)}`
                }
                amount={formatExactINR(r.outstanding)}
                ratio={r.outstanding / shown[0].outstanding}
                color={mine ? "#6366f1" : "#e11d48"}
              />
            ))}
          </ul>
        </>
      )}
    </ChartCard>
  );
}

/** Whether any of the three cards has something to show (otherwise the row is hidden). */
export function hasPartyData(state: FinancialState, hasIncome: boolean): boolean {
  return hasIncome || state.people.some((p) => p.owedToMe.outstandingMinor > 0 || p.iOwe.outstandingMinor > 0);
}

export function TopParties({ state }: { state: FinancialState }) {
  return (
    <div className="col-span-full grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="min-w-0 [&>section]:h-full">
        <IncomeSourcesCard />
      </div>
      <div className="min-w-0 [&>section]:h-full">
        <PeopleCard title="Who owes you" side="borrowers" people={state.people} />
      </div>
      <div className="min-w-0 [&>section]:h-full">
        <PeopleCard title="Who you owe" side="lenders" people={state.people} />
      </div>
    </div>
  );
}

