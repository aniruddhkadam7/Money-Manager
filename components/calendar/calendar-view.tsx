"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CreditCard, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCompactINR, formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { daysBetween, formatMonthLong, formatMonthShort, formatWeekdayDate, monthEnd, monthKey, monthStart, shiftMonth } from "@/lib/domain/dates";
import { calendarMonth, monthPace, spendLevels, type CalendarCardDue, type CalendarDay, type SpendLevel } from "@/lib/finance/calendar";
import { cardDueDates, cardStatementBills } from "@/lib/finance/card-bill-status";
import { chronological } from "@/lib/finance/order";
import { cn } from "@/lib/utils";
import { billDatesBetween, dueWording, type Reminder } from "@/lib/finance/reminders";
import { useEventDialog } from "../events/event-dialog";
import { EventRow } from "../events/event-row";
import { useFinance } from "../finance-provider";
import { PageTitle } from "../page-title";
import { PictureIcon } from "../picture-icon";
import { ReminderLogo } from "../reminder-logo";
import { useReminders } from "../reminders";
import { useStatements } from "../statements/statements-provider";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isMonth = (s: string | null): s is string => !!s && /^\d{4}-\d{2}$/.test(s);
// A day's shading for what went out, from barely there to the month's heaviest days. It's laid over the cell's own
// background (not in place of it), so the grid lines behind the cells don't show through.
const HEAT: Record<SpendLevel, string> = {
  0: "",
  1: "[background-image:linear-gradient(rgb(239_68_68/0.07),rgb(239_68_68/0.07))]",
  2: "[background-image:linear-gradient(rgb(239_68_68/0.14),rgb(239_68_68/0.14))]",
  3: "[background-image:linear-gradient(rgb(239_68_68/0.22),rgb(239_68_68/0.22))]",
  4: "[background-image:linear-gradient(rgb(239_68_68/0.32),rgb(239_68_68/0.32))]",
};

const byDate = <T,>(items: T[], dateOf: (item: T) => string) => {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(dateOf(item), [...(map.get(dateOf(item)) ?? []), item]);
  return map;
};

/** Switches between the Activity list and this calendar; both pages show it in their title row. */
export function ActivityViewSwitch({ current }: { current: "list" | "calendar" }) {
  const tab = (key: "list" | "calendar", href: string, label: string) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={cn(
        "rounded-full px-3 py-1 text-sm font-medium transition-colors",
        current === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label="View" className="flex rounded-full bg-muted p-0.5">
      {tab("calendar", "/calendar", "Calendar")}
      {tab("list", "/activity", "Statement")}
    </nav>
  );
}

/** The Calendar page: Activity's other view. A link can open a month with `?month=YYYY-MM`. */
export function CalendarView() {
  const params = useSearchParams();
  const linked = params.get("month");
  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-4 sm:gap-6">
      <PageTitle actions={<ActivityViewSwitch current="calendar" />}>Activity</PageTitle>
      <CalendarBoard initialMonth={isMonth(linked) ? linked : undefined} />
    </div>
  );
}

/**
 * A month at a glance, like a paper money diary: every day shows what came in and what was spent, and
 * tapping a day lists its entries. Swipe sideways (or use the arrows) to move between months.
 */
export function CalendarBoard({ initialMonth }: { initialMonth?: string }) {
  const { status, book, ledger, today } = useFinance();
  const statements = useStatements();
  const { openAdd } = useEventDialog();
  const [ym, setYm] = useState(() => initialMonth ?? monthKey(today));
  const [selected, setSelected] = useState(() => (initialMonth ? null : today));
  const weeks = useMemo(() => calendarMonth(book, ledger, ym), [book, ledger, ym]);
  const totals = useMemo(
    () =>
      weeks.flat().reduce(
        (t, d) => (d.inMonth ? { income: t.income + d.incomeMinor, spent: t.spent + d.expensesMinor } : t),
        { income: 0, spent: 0 },
      ),
    [weeks],
  );
  const dayEvents = useMemo(
    () => {
      if (!selected) return [];
      const oldestFirst = chronological(book.events);
      return book.events.filter((e) => e.date === selected).sort((a, b) => oldestFirst(b, a));
    },
    [book.events, selected],
  );
  const selectedDay = weeks.flat().find((d) => d.date === selected);
  const heat = useMemo(() => spendLevels(weeks.flat()), [weeks]);

  // The due dates card statements print.
  const dues = useMemo<CalendarCardDue[]>(
    () =>
      book.accounts
        .filter((a) => a.type === "credit_card")
        .flatMap((a) =>
          cardDueDates(book, a.id, cardStatementBills(statements.imports, a.id)).map((d) => ({ ...d, accountId: a.id, cardName: a.name })),
        ),
    [book, statements.imports],
  );
  const duesByDay = useMemo(() => byDate(dues, (d) => d.dueDate), [dues]);
  const pace = useMemo(() => monthPace(book, ledger, ym, today, totals.spent), [book, ledger, ym, today, totals.spent]);
  const dayDues = (selected && duesByDay.get(selected)) || [];
  // Your own bills and renewing subscriptions, on the days they fall due (repeating ones on every date they repeat to).
  // Card bills are already drawn from their statements above.
  const tracked = useReminders(true);
  const billsByDay = useMemo(
    () => billDatesBetween(tracked.filter((r) => r.kind !== "card"), weeks[0][0].date, weeks[weeks.length - 1][6].date),
    [tracked, weeks],
  );
  const dayBills = (selected && billsByDay.get(selected)) || [];

  const goTo = (next: string) => {
    setYm(next);
    // Keep today picked when coming back to this month; otherwise nothing is picked until a day is tapped.
    setSelected(next === monthKey(today) ? today : null);
  };
  const pick = (day: CalendarDay) => {
    if (!day.inMonth) setYm(monthKey(day.date));
    setSelected(day.date);
  };

  // Phones: swipe left for the next month, right for the previous one.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) goTo(shiftMonth(ym, dx < 0 ? 1 : -1));
  };

  if (status === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;

  const left = totals.income - totals.spent;
  // Average spend per day over the days gone by: all of a past month, up to today in this one, none in a future one.
  const daysGone = ym < monthKey(today) ? daysBetween(monthStart(ym), monthEnd(ym)) + 1 : ym === monthKey(today) ? daysBetween(monthStart(ym), today) + 1 : 0;
  const perDay = daysGone > 0 ? Math.round(totals.spent / daysGone / 100) * 100 : null;

  return (
    <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <Card className="overflow-hidden">
        <div className="grid gap-2 p-2 sm:gap-4 sm:p-5">
          <div className="flex items-center justify-between gap-2 px-1">
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => goTo(shiftMonth(ym, -1))}>
              <ChevronLeft />
            </Button>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold sm:text-lg" aria-live="polite">
                {formatMonthLong(ym)}
              </h2>
              {ym !== monthKey(today) && (
                <button type="button" onClick={() => goTo(monthKey(today))} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium hover:bg-muted/70">
                  Today
                </button>
              )}
            </div>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => goTo(shiftMonth(ym, 1))}>
              <ChevronRight />
            </Button>
          </div>

          <div className="rounded-xl bg-muted/50 text-center">
            <dl className="grid grid-cols-3 divide-x py-1.5 sm:py-2">
              <div>
                <dt className="text-[11px] text-muted-foreground sm:text-xs">Income</dt>
                <dd className="text-sm font-semibold tabular-nums text-emerald-700 sm:text-base">{formatExactINR(totals.income)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground sm:text-xs">Spent</dt>
                <dd className="text-sm font-semibold tabular-nums text-red-600 sm:text-base">{formatExactINR(totals.spent)}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground sm:text-xs">Left over</dt>
                <dd className="text-sm font-semibold tabular-nums sm:text-base">{formatExactINR(left)}</dd>
              </div>
            </dl>
            {/* The month's pace, laid out like the totals above: a day's average, against last month, and where it's heading. */}
            {(perDay !== null || pace?.previousMinor != null || pace?.projectedMinor != null) && (
              <dl className="grid auto-cols-fr grid-flow-col divide-x border-t py-1.5 sm:py-2" data-testid="month-pace">
                {perDay !== null && (
                  <div>
                    <dt className="text-[11px] text-muted-foreground sm:text-xs">Per day</dt>
                    <dd className="text-sm font-semibold tabular-nums sm:text-base">{formatExactINR(perDay)}</dd>
                  </div>
                )}
                {pace?.previousMinor != null &&
                  (() => {
                    const diff = totals.spent - pace.previousMinor;
                    const same = Math.abs(diff) < 100;
                    return (
                      <div title={pace.wholeMonth ? undefined : "Against the same days of last month"}>
                        <dt className="text-[11px] text-muted-foreground sm:text-xs">vs {formatMonthShort(pace.previousMonth)}</dt>
                        <dd className={cn("text-sm font-semibold tabular-nums sm:text-base", !same && (diff > 0 ? "text-red-600" : "text-emerald-700"))}>
                          {same ? "Same" : `${diff > 0 ? "▲" : "▼"}${formatExactINR(Math.round(Math.abs(diff) / 100) * 100)}`}
                        </dd>
                      </div>
                    );
                  })()}
                {pace?.projectedMinor != null && (
                  <div>
                    <dt className="text-[11px] text-muted-foreground sm:text-xs">By month end</dt>
                    <dd className="text-sm font-semibold tabular-nums sm:text-base">~{formatExactINR(Math.round(pace.projectedMinor / 100) * 100)}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>

          <div
            role="grid"
            aria-label={`${formatMonthLong(ym)} calendar`}
            className="grid select-none gap-px overflow-hidden rounded-xl border bg-border"
            onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
            onTouchEnd={onTouchEnd}
          >
            <div role="row" className="grid grid-cols-7 gap-px">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  role="columnheader"
                  className={cn("bg-card py-1.5 text-center text-xs font-medium text-muted-foreground", i === 0 && "text-red-600", i === 6 && "text-sky-700")}
                >
                  {w}
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div key={week[0].date} role="row" className="grid grid-cols-7 gap-px">
                {week.map((d) => (
                  <DayCell
                    key={d.date}
                    day={d}
                    dues={duesByDay.get(d.date) ?? []}
                    bills={billsByDay.get(d.date) ?? []}
                    heat={heat.get(d.date) ?? 0}
                    today={d.date === today}
                    selected={d.date === selected}
                    onPick={() => pick(d)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="lg:sticky lg:top-24">
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
              <div>
                <h2 className="font-semibold">{formatWeekdayDate(selected)}</h2>
                <p className="text-sm text-muted-foreground">
                  {dayEvents.length === 0 ? (
                    dayDues.length + dayBills.length > 0 ? "Nothing recorded yet" : "Nothing recorded"
                  ) : (
                    <>
                      {dayEvents.length} {dayEvents.length === 1 ? "entry" : "entries"}
                      {selectedDay && selectedDay.incomeMinor > 0 && <span className="text-emerald-700"> · in {formatExactINR(selectedDay.incomeMinor)}</span>}
                      {selectedDay && selectedDay.expensesMinor > 0 && <span className="text-red-600"> · spent {formatExactINR(selectedDay.expensesMinor)}</span>}
                      {selectedDay && selectedDay.expensesMinor < 0 && <span className="text-emerald-700"> · {formatExactINR(-selectedDay.expensesMinor)} came back</span>}
                    </>
                  )}
                </p>
              </div>
              <Button size="sm" onClick={() => openAdd(undefined, { date: selected })}>
                <Plus /> Add
              </Button>
            </div>
            {dayEvents.length + dayDues.length + dayBills.length > 0 ? (
              <div>
                {dayEvents.length > 0 && (
                  <ul className="divide-y py-1">
                    {dayEvents.map((e) => (
                      <EventRow key={e.id} event={e} />
                    ))}
                  </ul>
                )}
                {dayBills.length > 0 && (
                  <section aria-label="Bills due" className={cn(dayEvents.length > 0 && "border-t")}>
                    <h3 className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-5">Bills due</h3>
                    <ul className="divide-y py-1">
                      {dayBills.map((r) => (
                        <BillDueRow key={r.id} bill={r} today={today} date={selected!} />
                      ))}
                    </ul>
                  </section>
                )}
                {dayDues.length > 0 && (
                  <section aria-label="Due" className={cn(dayEvents.length + dayBills.length > 0 && "border-t")}>
                    <h3 className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-5">Due</h3>
                    <ul className="divide-y py-1">
                      {dayDues.map((d) => (
                        <CardDueRow key={`${d.accountId}-${d.statementDate}`} due={d} today={today} />
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            ) : (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">Tap Add to record something on this day.</p>
            )}
          </>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Tap a day to see what happened on it.</p>
        )}
      </Card>
    </div>
  );
}

/** A bill you track, or a subscription renewing, falling on the selected day. */
function BillDueRow({ bill, today, date }: { bill: Reminder; today: string; date: string }) {
  const days = daysBetween(today, date);
  return (
    <li className="flex items-center gap-3 px-3 py-3 sm:px-5">
      <ReminderLogo r={bill} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{bill.title}</span>
        <span className={cn("block text-xs font-medium", days < 0 ? "text-amber-700" : "text-muted-foreground")}>
          {bill.kind === "subscription" ? (days < 0 ? "Renewal not recorded yet" : days === 0 ? "Renews today" : `Renews ${dueWording(days).replace("Due ", "")}`) : dueWording(days)}
        </span>
      </span>
      {bill.amountMinor > 0 && <span className="text-sm font-semibold tabular-nums">{formatExactINR(bill.amountMinor)}</span>}
    </li>
  );
}

/** A card bill's printed due date and how much of it is paid. */
function CardDueRow({ due, today }: { due: CalendarCardDue; today: string }) {
  const days = daysBetween(today, due.dueDate);
  const unpaid = due.remainingMinor > 0;
  const note = !unpaid
    ? "Paid in full"
    : due.latest
      ? `${formatExactINR(due.remainingMinor)} left to pay${days < 0 ? ` · ${-days} ${days === -1 ? "day" : "days"} overdue` : days === 0 ? " · due today" : ""}`
      : `${formatExactINR(due.remainingMinor)} unpaid, carried into the next bill`;
  return (
    <li>
      <Link
        href={activityHref({ account: due.accountId })}
        aria-label={`${due.cardName} bill due: ${note}`}
        className="flex items-center gap-3 px-3 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 sm:px-5"
      >
        <PictureIcon name="credit-card" className="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{due.cardName} bill due</span>
          <span className={cn("block text-xs font-medium", !unpaid ? "text-emerald-700" : due.latest ? "text-red-600" : "text-amber-700")}>{note}</span>
        </span>
        <span className="text-right">
          <span className="block text-sm font-semibold tabular-nums">{formatExactINR(due.billMinor)}</span>
          <span className="text-[11px] text-muted-foreground">bill</span>
        </span>
      </Link>
    </li>
  );
}

function DayCell({
  day,
  dues,
  bills,
  heat,
  today,
  selected,
  onPick,
}: {
  day: CalendarDay;
  dues: CalendarCardDue[];
  bills: Reminder[];
  heat: SpendLevel;
  today: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  const dayNumber = Number(day.date.slice(8));
  const weekday = new Date(`${day.date}T00:00:00`).getDay();
  const owedOnCards = dues.filter((d) => d.latest).reduce((t, d) => t + d.remainingMinor, 0);
  const label = [
    formatWeekdayDate(day.date),
    day.incomeMinor > 0 && `income ${formatExactINR(day.incomeMinor)}`,
    day.expensesMinor > 0 && `spent ${formatExactINR(day.expensesMinor)}`,
    day.expensesMinor < 0 && `${formatExactINR(-day.expensesMinor)} came back`,
    day.entryCount > 0 && `${day.entryCount} ${day.entryCount === 1 ? "entry" : "entries"}`,
    bills.length > 0 && `due: ${bills.map((b) => b.title).join(", ")}`,
    dues.length > 0 && (owedOnCards > 0 ? `card bill due, ${formatExactINR(owedOnCards)} left to pay` : "card bill due"),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      role="gridcell"
      aria-selected={selected}
      aria-label={label}
      onClick={onPick}
      className={cn(
        "relative flex min-h-12 min-w-0 flex-col items-stretch gap-0.5 bg-card p-1 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-24 sm:p-2",
        !day.inMonth && "bg-muted/30 text-muted-foreground/60",
        selected && "z-10 bg-primary/5 ring-2 ring-inset ring-primary",
        HEAT[heat],
      )}
    >
      <span className="flex items-start justify-between gap-0.5">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium tabular-nums sm:text-sm",
            day.inMonth && weekday === 0 && "text-red-600",
            day.inMonth && weekday === 6 && "text-sky-700",
            today && "bg-primary font-semibold text-primary-foreground",
          )}
        >
          {dayNumber}
        </span>
        <span className={cn("flex items-center gap-0.5 pt-0.5", !day.inMonth && "opacity-60")} aria-hidden>
          {bills.length > 0 && <span className="size-2 rounded-full bg-teal-500 ring-2 ring-card sm:hidden" />}
          {dues.length > 0 &&
            (owedOnCards > 0 ? <span className="size-2 rounded-full bg-red-600 ring-2 ring-card" /> : <CreditCard className="size-3 text-muted-foreground" />)}
        </span>
      </span>
      {/* Bigger screens have room to name what's due. */}
      {bills.length > 0 && (
        <span className={cn("hidden min-w-0 gap-0.5 sm:grid", !day.inMonth && "opacity-60")} aria-hidden>
          {bills.slice(0, 2).map((r) => (
            <span key={r.id} className="truncate rounded bg-teal-500/15 px-1 text-[10px] font-medium leading-4 text-teal-700" title={r.title}>
              {r.title}
            </span>
          ))}
          {bills.length > 2 && <span className="px-1 text-[10px] text-muted-foreground">+{bills.length - 2} more</span>}
        </span>
      )}
      <span className={cn("mt-auto grid min-w-0 text-right text-[10px] font-medium leading-tight tabular-nums sm:text-xs", !day.inMonth && "opacity-60")}>
        {day.incomeMinor > 0 && <span className="truncate text-emerald-700">+{formatCompactINR(day.incomeMinor)}</span>}
        {day.expensesMinor > 0 && <span className="truncate text-red-600">−{formatCompactINR(day.expensesMinor)}</span>}
        {day.expensesMinor < 0 && <span className="truncate text-emerald-700">↩{formatCompactINR(-day.expensesMinor)}</span>}
        {day.entryCount > 0 && day.incomeMinor <= 0 && day.expensesMinor === 0 && (
          // Only transfers, loans or investments that day: counted as neither, but still worth a look.
          <span className="ml-auto size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
        )}
      </span>
    </button>
  );
}
