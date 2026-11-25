"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { AccountLogo, useBankHints } from "../account-logo";
import { PersonAvatar } from "../money/person-photo";
import { formatBps, formatCompactINR, formatExactINR, formatSignedINR } from "@/lib/charts/format";
import { activityHref, monthFilter } from "@/lib/charts/links";
import { formatDisplayDate, formatMonthLong, monthEnd, shiftMonth } from "@/lib/domain/dates";
import { moneyHealth, type HealthLine, type HealthTone, type MoneyHealth } from "@/lib/finance/health";
import { firstActivityDate } from "@/lib/finance/series";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";
import { ChartCard } from "../charts/primitives";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  addFixedCost,
  FIXED_REPEAT_LABEL,
  hideFixedSuggestion,
  monthlyOf,
  removeFixedCost,
  updateFixedCost,
  useFixedCosts,
  useHiddenFixedSuggestions,
  type FixedCost,
  type FixedCostRepeat,
} from "@/lib/fixed-costs";
import { detectRecurring } from "@/lib/finance/recurring";
import { groupAmountInput, parseAmountToMinor } from "@/lib/domain/money";
import { useFinance } from "../finance-provider";
import { usePersonSheet } from "../money/person-sheet-provider";
import { useStatementGaps } from "../statements/use-statement-checks";
import { MonthStepper } from "./period";

export const STATUS: Record<HealthTone, string> = { good: "Healthy", ok: "Watch", bad: "Needs care", none: "No data yet" };
/** A touch of colour: the status word, the ratio in its popup, money taken off. */
export const TONE_TEXT: Record<HealthTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  ok: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  none: "text-muted-foreground",
};

/** Whole rupees: ₹54,982. */
const rs = (minor: number) => formatExactINR(Math.round(minor / 100) * 100).replace(/\.00$/, "");
/** Whole rupees with a sign: +₹1,40,460. */
const srs = (minor: number) => formatSignedINR(Math.round(minor / 100) * 100).replace(/\.00$/, "");
const pct = (bps: number | null) => (bps === null ? "—" : `${bps < 0 ? "−" : ""}${formatBps(Math.abs(bps), Math.abs(bps) < 1000 ? 1 : 0)}`);
const monthShort = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const FREQ: Record<string, string> = { weekly: "every week", monthly: "every month", yearly: "every year" };

/** One line of a breakdown: a label (and note), an amount; tapping opens its entries, account or person. */
interface Line {
  label: string;
  note?: string;
  value: string;
  href?: string;
  personId?: string;
  /** The account it's about (its bank's logo shows beside it). */
  accountId?: string;
  /** Money coming in, going out, or taken off: a small coloured mark, and red for what's taken off. */
  kind?: "in" | "out" | "off";
}

interface Section {
  title: string;
  lines: Line[];
  total?: string;
  /** What the total line says ("Total" unless set). */
  totalLabel?: string;
  empty?: string;
}

export interface Tile {
  key: string;
  label: string;
  value: string;
  tone: HealthTone;
  sub: string;
  /** What the ratio means and what's healthy. */
  about: string;
  /** The ratio as a number, for the month-by-month chart (months, %, or rupees for growth), and its short label. */
  num: number | null;
  short: string;
  sections: Section[];
  /** Shown before the figures (the fixed-cost list, to edit). */
  extra?: ReactNode;
  /** The sum at the bottom, ending in the ratio. */
  /** `sub`: a subtotal on the way (shown bold, with a line above), not the answer. */
  result: { label: string; value: string; op?: "÷" | "=" | "+" | "−"; sub?: boolean }[];
}

const lineOf = (l: HealthLine, note?: string): Line => ({
  label: l.label,
  note,
  value: rs(l.amountMinor),
  ...(l.personId ? { personId: l.personId } : l.accountId ? { href: activityHref({ account: l.accountId }), accountId: l.accountId } : {}),
});
const sum = (ls: HealthLine[]) => ls.reduce((t, l) => t + l.amountMinor, 0);

export function tilesOf(h: MoneyHealth, monthName: string): Tile[] {
  const d = h.detail;
  const typical = h.months.length === 0 ? "no complete month yet" : h.months.length === 1 ? formatMonthLong(h.months[0]) : `${monthShort(h.months[0])} to ${monthShort(h.months[h.months.length - 1])}`;
  const avgNote = `Average of ${h.months.length} ${h.months.length === 1 ? "month" : "months"} (${typical})`;
  const monthLines = (pick: (m: MoneyHealth["detail"]["monthly"][number]) => number, note?: (m: MoneyHealth["detail"]["monthly"][number]) => string, kind?: Line["kind"]): Line[] =>
    d.monthly.map((m) => ({ label: formatMonthLong(m.ym), note: note?.(m), value: rs(pick(m)), href: activityHref(monthFilter(m.ym)), kind }));

  return [
    {
      key: "runway",
      num: h.runway.months, short: h.runway.months === null ? "—" : `${h.runway.months}`,
      label: "Runway",
      value: h.runway.months === null ? "—" : `${h.runway.months} ${h.runway.months === 1 ? "month" : "months"}`,
      tone: h.runway.tone,
      sub: `Usable ${rs(h.runway.availableMinor)}`,
      about: "Months your money lasts with no income. Usable money is bank and cash less card dues and what you owe people; a month is your typical spending plus EMI repayments (their interest is already spending). Healthy: 6 months or more. 3 to 6: watch.",
      sections: [
        {
          title: "Bank & cash",
          lines: d.liquid.map((l) => lineOf(l)),
          total: rs(h.runway.liquidMinor),
          empty: "No bank or cash accounts.",
        },
        {
          title: "Taken off: what you owe",
          lines: [
            ...d.cards.filter((c) => c.duesMinor > 0).map((c) => ({ label: c.name, note: "Due on the card", value: `−${rs(c.duesMinor)}`, href: activityHref({ account: c.accountId }), accountId: c.accountId, kind: "off" as const })),
            ...d.owe.filter((l) => l.personId).map((l) => ({ label: l.label, note: "You owe them", value: `−${rs(l.amountMinor)}`, personId: l.personId, kind: "off" as const })),
          ],
          total: `−${rs(h.runway.cardDuesMinor + h.runway.owedToPeopleMinor)}`,
          empty: "Nothing: no card dues, and you owe no one.",
        },
        {
          title: "Going out each month",
          lines: [
            ...monthLines((m) => m.spentMinor, () => "Spending", "out"),
            ...(h.runway.avgEmiPrincipalMinor ? [{ label: "Loan EMIs (repaying the loan)", note: avgNote, value: rs(h.runway.avgEmiPrincipalMinor), kind: "out" as const }] : []),
          ],
          total: `${rs(h.runway.monthlyNeedMinor)} a month`,
          totalLabel: "Average month",
          empty: "No complete month yet.",
        },
      ],
      result: [
        { label: "Bank & cash", value: rs(h.runway.liquidMinor) },
        ...(h.runway.cardDuesMinor ? [{ label: "Card dues", value: rs(h.runway.cardDuesMinor), op: "−" as const }] : []),
        ...(h.runway.owedToPeopleMinor ? [{ label: "You owe people", value: rs(h.runway.owedToPeopleMinor), op: "−" as const }] : []),
        { label: "Usable money", value: rs(h.runway.availableMinor), op: "=" as const, sub: true },
        { label: "Going out each month", value: rs(h.runway.monthlyNeedMinor), op: "÷" },
        { label: "Runway", value: h.runway.months === null ? "—" : `${h.runway.months} months`, op: "=" },
      ],
    },
    {
      key: "savings",
      num: h.savings.bps === null ? null : h.savings.bps / 100, short: pct(h.savings.bps),
      label: "Savings rate",
      value: pct(h.savings.bps),
      tone: h.savings.bps === null ? h.savings.tone : h.savings.bps >= 2000 ? "good" : h.savings.bps >= 1000 ? "ok" : "bad",
      sub: h.savings.avgBps !== null ? `Typical month ${pct(h.savings.avgBps)}` : `Kept ${rs(h.savings.incomeMinor - h.savings.spentMinor)}`,
      about: "Share of your income you keep. Healthy: 20% or more. 10 to 20%: watch. The typical month is shown beside it, since one month can be unusual.",
      sections: [
        {
          title: monthName,
          lines: [
            { label: "Earned", value: rs(h.savings.incomeMinor), kind: "in" },
            { label: "Spent", value: rs(h.savings.spentMinor), kind: "out" },
            { label: "Kept", value: rs(h.savings.incomeMinor - h.savings.spentMinor) },
          ],
        },
        {
          title: "Month by month",
          lines: monthLines(
            (m) => m.incomeMinor - m.spentMinor,
            (m) => `Earned ${rs(m.incomeMinor)} · spent ${rs(m.spentMinor)} · kept ${pct(m.incomeMinor > 0 ? Math.round(((m.incomeMinor - m.spentMinor) / m.incomeMinor) * 10_000) : null)}`,
          ),
          total: pct(h.savings.avgBps),
          totalLabel: "Average month (kept)",
          empty: "No complete month yet.",
        },
      ],
      result: [
        { label: `Kept (${monthName.toLowerCase()})`, value: rs(h.savings.incomeMinor - h.savings.spentMinor) },
        { label: "Earned", value: rs(h.savings.incomeMinor), op: "÷" },
        { label: "Savings rate", value: pct(h.savings.bps), op: "=" },
      ],
    },
    {
      key: "emi",
      num: h.emi.bps === null ? (h.emi.avgIncomeMinor > 0 ? 0 : null) : h.emi.bps / 100, short: h.emi.avgEmiMinor === 0 ? "0%" : pct(h.emi.bps),
      label: "EMIs to income",
      value: h.emi.avgEmiMinor === 0 ? "No EMIs" : pct(h.emi.bps),
      tone: h.emi.avgEmiMinor === 0 && h.emi.avgIncomeMinor > 0 ? "good" : h.emi.tone,
      sub: h.emi.avgEmiMinor === 0 ? "Nothing to repay monthly" : `${rs(h.emi.avgEmiMinor)} a month`,
      about: "Share of your income going to loan EMIs. Healthy: up to 30%. 30 to 40%: watch. Banks lend up to about 40 to 50%.",
      sections: [
        { title: `EMIs paid (${typical})`, lines: d.emis.map((l) => lineOf(l, `${l.count} ${l.count === 1 ? "EMI" : "EMIs"}`)), total: rs(sum(d.emis)), empty: "No EMIs paid." },
        { title: "Income, month by month", lines: monthLines((m) => m.incomeMinor, undefined, "in"), total: `${rs(h.emi.avgIncomeMinor)} a month`, totalLabel: "Average month", empty: "No complete month yet." },
      ],
      result: [
        { label: "Typical month's EMIs", value: rs(h.emi.avgEmiMinor) },
        { label: "Typical month's income", value: rs(h.emi.avgIncomeMinor), op: "÷" },
        { label: "EMIs to income", value: h.emi.avgEmiMinor === 0 ? "0%" : pct(h.emi.bps), op: "=" },
      ],
    },
    {
      key: "fixed",
      num: h.fixed.bps === null ? null : h.fixed.bps / 100, short: pct(h.fixed.bps),
      label: "Fixed costs",
      value: h.fixed.totalMinor === 0 ? "Not set" : pct(h.fixed.bps),
      tone: h.fixed.totalMinor === 0 ? "none" : h.fixed.tone,
      sub: h.fixed.totalMinor === 0 ? "Add yours" : `${rs(h.fixed.totalMinor)} a month`,
      about: "What you pay whatever happens, against income. Your list plus loan EMIs. Healthy: up to 50%. 50 to 70%: watch.",
      extra: <FixedCostEditor />,
      sections: [
        {
          title: "Loan EMIs (from your loans)",
          lines: d.emis.map((l) => lineOf(l, `${l.count} ${l.count === 1 ? "EMI" : "EMIs"} in ${typical}`)),
          total: `${rs(h.fixed.emiMinor)} a month`,
          totalLabel: "Average month",
          empty: "No EMIs.",
        },
      ],
      result: [
        { label: "Your fixed costs", value: rs(h.fixed.recurringMinor) },
        { label: "Loan EMIs", value: rs(h.fixed.emiMinor), op: "+" },
        { label: "Fixed costs a month", value: rs(h.fixed.totalMinor), op: "=", sub: true },
        { label: "Typical month's income", value: rs(h.fixed.avgIncomeMinor), op: "÷" },
        { label: "Fixed costs", value: pct(h.fixed.bps), op: "=" },
      ],
    },
    {
      key: "debt",
      num: h.debt.bps === null ? null : h.debt.bps / 100, short: h.debt.liabilitiesMinor === 0 ? "0%" : pct(h.debt.bps),
      label: "Debt to assets",
      value: h.debt.liabilitiesMinor === 0 ? "Debt-free" : pct(h.debt.bps),
      tone: h.debt.liabilitiesMinor === 0 ? "good" : h.debt.tone,
      sub: `Owe ${rs(h.debt.liabilitiesMinor)}`,
      about: "Share of what you own that's borrowed. Healthy: up to 30%. 30 to 50%: watch. Over 100%: you owe more than you own.",
      sections: [
        { title: "What you owe", lines: d.owe.map((l) => lineOf(l)), total: rs(h.debt.liabilitiesMinor), empty: "You owe nothing." },
        { title: "What you own", lines: d.own.map((l) => lineOf(l)), total: rs(h.debt.assetsMinor), empty: "Nothing yet." },
      ],
      result: [
        { label: "What you owe", value: rs(h.debt.liabilitiesMinor) },
        { label: "What you own", value: rs(h.debt.assetsMinor), op: "÷" },
        { label: "Debt to assets", value: h.debt.liabilitiesMinor === 0 ? "0%" : pct(h.debt.bps), op: "=" },
      ],
    },
    {
      key: "cards",
      num: h.cards.bps === null ? null : h.cards.bps / 100, short: pct(h.cards.bps),
      label: "Card usage",
      value: h.cards.bps === null ? "No cards" : pct(h.cards.bps),
      tone: h.cards.tone,
      sub: h.cards.bps === null ? "—" : `${rs(h.cards.duesMinor)} of ${rs(h.cards.limitMinor)}`,
      about: "Share of your card limits in use. Healthy: under 30% (it helps your credit score). Up to 70%: watch. Set a card's limit on the Money page.",
      sections: [
        {
          title: "Your cards",
          lines: d.cards.map((c) => ({
            label: c.name,
            note: `Limit ${rs(c.limitMinor)}${c.limitSet ? "" : " (not set, ₹60,000 assumed)"} · ${pct(c.limitMinor > 0 ? Math.round((c.duesMinor / c.limitMinor) * 10_000) : null)} used`,
            value: rs(c.duesMinor),
            href: activityHref({ account: c.accountId }),
            accountId: c.accountId,
          })),
          total: `${rs(h.cards.duesMinor)} of ${rs(h.cards.limitMinor)}`,
          empty: "You have no credit cards.",
        },
      ],
      result: [
        { label: "Due on your cards", value: rs(h.cards.duesMinor) },
        { label: "Their limits", value: rs(h.cards.limitMinor), op: "÷" },
        { label: "Card usage", value: pct(h.cards.bps), op: "=" },
      ],
    },
    {
      key: "owed",
      num: h.owed.bps === null ? null : h.owed.bps / 100, short: h.owed.owedMinor === 0 ? "0%" : pct(h.owed.bps),
      label: "Owed to you",
      value: h.owed.owedMinor === 0 ? "Nothing" : pct(h.owed.bps),
      tone: h.owed.owedMinor === 0 ? (h.owed.assetsMinor > 0 ? "good" : "none") : h.owed.tone,
      sub: h.owed.owedMinor === 0 ? "No one owes you" : `${rs(h.owed.owedMinor)} with people`,
      about: "Money lent out and not back, against what you own. It counts as yours, but you can't use it. Healthy: up to 10%. 10 to 25%: watch.",
      sections: [
        { title: "Who owes you", lines: d.own.filter((l) => l.personId).map((l) => lineOf(l)), total: rs(h.owed.owedMinor), empty: "No one owes you anything." },
      ],
      result: [
        { label: "Owed to you", value: rs(h.owed.owedMinor) },
        { label: "What you own", value: rs(h.owed.assetsMinor), op: "÷" },
        { label: "Owed to you", value: h.owed.owedMinor === 0 ? "0%" : pct(h.owed.bps), op: "=" },
      ],
    },
    {
      key: "growth",
      num: h.growth.m1, short: h.growth.m1 === null ? "—" : formatCompactINR(h.growth.m1),
      label: "Net worth growth",
      value: h.growth.m3 !== null ? srs(h.growth.m3) : h.growth.m1 !== null ? srs(h.growth.m1) : "—",
      tone: h.growth.tone,
      sub: h.growth.m3 !== null ? "in 3 months" : h.growth.m1 !== null ? "in 1 month" : "Not enough history",
      about: "Is your net worth rising? Compared with 1, 3 and 12 months before.",
      sections: [
        {
          title: "Net worth on",
          lines: [...d.netWorth].reverse().map((p) => ({ label: formatDisplayDate(p.date), value: rs(p.minor) })),
        },
      ],
      result: [
        ...(h.growth.m1 !== null ? [{ label: "Over 1 month", value: srs(h.growth.m1) }] : []),
        ...(h.growth.m3 !== null ? [{ label: "Over 3 months", value: srs(h.growth.m3) }] : []),
        ...(h.growth.m12 !== null ? [{ label: "Over 12 months", value: srs(h.growth.m12) }] : []),
        ...(h.growth.m1 === null ? [{ label: "Not enough history yet", value: "—" }] : []),
      ],
    },
  ];
}

function LineRow({ line }: { line: Line }) {
  const { openPerson } = usePersonSheet();
  const { book } = useFinance();
  const bankHint = useBankHints();
  const account = line.accountId ? book.accounts.find((a) => a.id === line.accountId) : undefined;
  const lead = account ? (
    <AccountLogo account={account} bankHint={bankHint(account.id)} />
  ) : line.personId ? (
    <PersonAvatar
      person={{ id: line.personId, name: line.label }}
      className="size-8"
      logoClassName="!size-8 !rounded-full [&>img]:!size-5"
      fallback={<span className="grid size-8 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-xs font-semibold text-indigo-600 dark:text-indigo-300">{line.label.charAt(0).toUpperCase()}</span>}
    />
  ) : line.kind === "in" || line.kind === "out" ? (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", line.kind === "in" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600")}>
      {line.kind === "in" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
    </span>
  ) : null;
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        {lead}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{line.label}</span>
          {line.note && <span className="block text-xs text-muted-foreground">{line.note}</span>}
        </span>
      </span>
      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", line.kind === "off" && "text-rose-600 dark:text-rose-400")}>{line.value}</span>
    </>
  );
  const cls = "flex w-full items-center justify-between gap-3 py-2 text-left";
  return (
    <li>
      {line.personId ? (
        <button type="button" onClick={() => openPerson(line.personId!)} className={cn(cls, "hover:bg-muted/50")}>
          {body}
        </button>
      ) : line.href ? (
        <Link href={line.href} className={cn(cls, "hover:bg-muted/50")}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/** Your fixed costs: listed, edited and removed here. Nothing is guessed. */
function FixedCostEditor() {
  const list = useFixedCosts();
  const hidden = useHiddenFixedSuggestions();
  const { book, ledger, today } = useFinance();
  // Payments that repeat in your entries, not yet added (by where they came from, or the same name) or hidden.
  const suggestions = useMemo(() => {
    const added = new Set(list.flatMap((c) => [c.fromKey ?? "", c.name.trim().toLowerCase()]));
    return detectRecurring(book, ledger, today)
      .filter((c) => !hidden.has(c.key) && !added.has(c.key) && !added.has(c.name.trim().toLowerCase()))
      .sort((x, y) => y.monthlyEquivalentMinor - x.monthlyEquivalentMinor);
  }, [book, ledger, today, list, hidden]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [repeat, setRepeat] = useState<FixedCostRepeat>("monthly");
  const amountMinor = parseAmountToMinor(amount.replace(/[,₹\s]/g, ""));
  const start = (c?: FixedCost) => {
    setEditing(c?.id ?? "new");
    setName(c?.name ?? "");
    setAmount(c ? groupAmountInput(String(c.amountMinor / 100)) : "");
    setRepeat(c?.repeat ?? "monthly");
  };
  const save = () => {
    if (!name.trim() || !amountMinor) return;
    const cost = { name: name.trim(), amountMinor, repeat };
    if (editing === "new") addFixedCost(cost);
    else if (editing) updateFixedCost(editing, cost);
    setEditing(null);
  };
  const total = list.reduce((t, c) => t + monthlyOf(c), 0);

  return (
    <div data-testid="fixed-cost-editor">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your fixed costs</p>
      {list.length === 0 && editing === null && (
        <p className="py-2 text-sm text-muted-foreground">Nothing yet. Add your own, or pick from below.</p>
      )}
      {list.length > 0 && (
        <ul className="divide-y">
          {[...list]
            .sort((a, b) => monthlyOf(b) - monthlyOf(a))
            .map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {rs(c.amountMinor)} {FIXED_REPEAT_LABEL[c.repeat]}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="mr-1 text-sm font-semibold tabular-nums">{rs(monthlyOf(c))}</span>
                  <button type="button" onClick={() => start(c)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Change ${c.name}`}>
                    <Pencil className="size-4" />
                  </button>
                  <button type="button" onClick={() => removeFixedCost(c.id)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600" aria-label={`Remove ${c.name}`}>
                    <Trash2 className="size-4" />
                  </button>
                </span>
              </li>
            ))}
        </ul>
      )}
      {list.length > 1 && (
        <div className="mt-1 flex justify-between border-t pt-2 text-sm font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{rs(total)} a month</span>
        </div>
      )}
      {editing !== null ? (
        <form
          className="mt-3 grid gap-2 rounded-xl border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="What (rent, insurance, school fees…)" aria-label="What it is" autoFocus />
          <div className="flex gap-2">
            <Input
              value={amount}
              onChange={(e) => setAmount(groupAmountInput(e.target.value))}
              inputMode="decimal"
              placeholder="Amount ₹"
              aria-label="Amount"
              className="min-w-0 flex-1"
            />
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as FixedCostRepeat)}
              className="h-9 rounded-md border bg-card px-2 text-sm"
              aria-label="How often"
            >
              <option value="monthly">Every month</option>
              <option value="quarterly">Every 3 months</option>
              <option value="yearly">Every year</option>
            </select>
          </div>
          {amountMinor && repeat !== "monthly" ? <p className="text-xs text-muted-foreground">Comes to {rs(monthlyOf({ amountMinor, repeat }))} a month.</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!name.trim() || !amountMinor}>
              {editing === "new" ? "Add" : "Save"}
            </Button>
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => start()}>
          <Plus className="size-4" /> Add a fixed cost
        </Button>
      )}
      {/* Suggestions: payments that repeat in your entries, not yet added or hidden. Nothing counts until added. */}
      {suggestions.length > 0 && (
        <div className="mt-4" data-testid="fixed-suggestions">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested from your entries</p>
          <ul className="divide-y">
            {suggestions.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {rs(c.amountMinor)} {FREQ[c.frequency] ?? ""}, last on {formatDisplayDate(c.lastDate)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      addFixedCost(
                        c.frequency === "weekly"
                          ? { name: c.name, amountMinor: c.monthlyEquivalentMinor, repeat: "monthly", fromKey: c.key }
                          : { name: c.name, amountMinor: c.amountMinor, repeat: c.frequency, fromKey: c.key },
                      )
                    }
                    aria-label={`Add ${c.name} as a fixed cost`}
                  >
                    <Plus className="size-4" /> Add
                  </Button>
                  <button type="button" onClick={() => hideFixedSuggestion(c.key)} className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Not a fixed cost: hide ${c.name}`} title="Not fixed: hide">
                    <X className="size-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Your fixed costs, each with what it comes to a month, for moneyHealth. */
export function useFixedCostsMonthly() {
  const list = useFixedCosts();
  return useMemo(() => list.map((c) => ({ ...c, monthlyMinor: monthlyOf(c) })), [list]);
}

/** A ratio in full: what it means (folded to its first sentence), every figure behind it, and the sum that gives it. */
export function HealthBreakdown({ tile, when }: { tile: Tile; when: string }) {
  const [more, setMore] = useState(false);
  const cut = tile.about.indexOf(". ");
  const first = cut === -1 ? tile.about : tile.about.slice(0, cut + 1);
  const rest = cut === -1 ? "" : tile.about.slice(cut + 2);
  return (
    <div className="grid gap-4" data-testid="health-breakdown">
      <div>
        <p className="text-sm text-muted-foreground">{when}</p>
        <p className="mt-0.5 text-3xl font-semibold tabular-nums">
          <span className={TONE_TEXT[tile.tone]}>{tile.value}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {tile.tone !== "none" && (
            <>
              <span className={cn("font-medium", TONE_TEXT[tile.tone])}>{STATUS[tile.tone]}</span>.{" "}
            </>
          )}
          {first}
          {rest && (
            <>
              {more ? <> {rest} </> : " "}
              <button type="button" onClick={() => setMore((v) => !v)} className="font-medium text-foreground underline-offset-2 hover:underline">
                {more ? "Less" : "More"}
              </button>
            </>
          )}
        </p>
      </div>
      {tile.extra}
      {tile.sections.map((s) => (
        <div key={s.title}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</p>
          {s.lines.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{s.empty ?? "Nothing here."}</p>
          ) : (
            <ul className="divide-y">
              {s.lines.map((l, i) => (
                <LineRow key={`${l.label}-${i}`} line={l} />
              ))}
            </ul>
          )}
          {s.total && s.lines.length > 0 && (
            <div className="mt-1 flex justify-between border-t pt-2 text-sm font-semibold">
              <span>{s.totalLabel ?? "Total"}</span>
              <span className="tabular-nums">{s.total}</span>
            </div>
          )}
        </div>
      ))}
      <div className="rounded-xl bg-muted/60 p-3 text-sm">
        {tile.result.map((r, i) => {
          const last = i === tile.result.length - 1 && r.op === "=";
          return (
            <div
              key={`${r.label}-${i}`}
              className={cn(
                "flex justify-between gap-3 tabular-nums",
                last ? "mt-1 border-t pt-1 text-base font-semibold" : r.sub ? "my-1 border-y py-1 font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              <span>
                {r.op ? `${r.op} ` : ""}
                {r.label}
              </span>
              <span className={last ? TONE_TEXT[tile.tone] : undefined}>{r.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Money health: runway, savings rate, EMIs and fixed costs against income, debt, card usage, money owed to you and
 * net worth growth. Tap one for its own page: month by month, and every figure behind it. The month switcher shows
 * any month's last day.
 */
export function HealthSection() {
  const { book, ledger, today } = useFinance();
  const gaps = useStatementGaps();
  const first = useMemo(() => firstActivityDate(ledger), [ledger]);
  const [monthsBack, setMonthsBack] = useSessionState("health:monthsBack", 0);
  const ym = shiftMonth(today.slice(0, 7), -monthsBack);
  const asOf = monthsBack > 0 ? monthEnd(ym) : today;
  const fixedCosts = useFixedCostsMonthly();
  const health = useMemo(() => moneyHealth(book, ledger, asOf, gaps, fixedCosts), [book, ledger, asOf, gaps, fixedCosts]);
  const monthName = monthsBack > 0 ? formatMonthLong(ym) : "This month so far";
  const tiles = tilesOf(health, monthName);

  if (!first) return null;
  return (
    <ChartCard title="Money health" action={<MonthStepper ym={ym} monthsBack={monthsBack} canGoBack={ym > first.slice(0, 7)} onChange={setMonthsBack} />}>
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">{monthsBack > 0 ? `As at ${formatDisplayDate(asOf)}, the month's last day` : "As of today"}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="money-health">
        {tiles.map((t) => (
          <Link
            key={t.key}
            href={`/health?r=${t.key}&m=${monthsBack}`}
            aria-label={`${t.label}: ${t.value}. See it in detail, month by month.`}
            className="min-w-0 rounded-xl border bg-card px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`health-${t.key}`}
          >
            <div className="truncate text-xs text-muted-foreground">{t.label}</div>
            <div className="mt-0.5 truncate text-base font-semibold tabular-nums sm:text-lg">{t.value}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              <span className={cn("font-medium", TONE_TEXT[t.tone])}>{STATUS[t.tone]}</span> · {t.sub}
            </div>
          </Link>
        ))}
      </div>
    </ChartCard>
  );
}
