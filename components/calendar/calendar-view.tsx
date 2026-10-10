"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, CreditCard, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCompactINR, formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { daysBetween, formatDayMonth, formatMonthLong, formatWeekdayDate, monthEnd, monthKey, shiftMonth } from "@/lib/domain/dates";
import { calendarMonth, expectedPayments, monthOutlook, type CalendarCardDue, type CalendarDay, type ExpectedPayment } from "@/lib/finance/calendar";
import { cardDueDates } from "@/lib/finance/card-bill-status";
import { detectRecurring, type Frequency } from "@/lib/finance/recurring";
import { cn } from "@/lib/utils";
import { BrandLogo } from "../brand-logo";
import { CategoryIcon } from "../category-icon";
import { useEventDialog } from "../events/event-dialog";
import { EventRow } from "../events/event-row";
import { useFinance } from "../finance-provider";
import { PageTitle } from "../page-title";
import { PictureIcon } from "../picture-icon";
import { useStatements } from "../statements/statements-provider";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isMonth = (s: string | null): s is string => !!s && /^\d{4}-\d{2}$/.test(s);
const RHYTHM: Record<Frequency, string> = { weekly: "every week", monthly: "every month", yearly: "every year" };

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
      {tab("list", "/activity", "List")}
      {tab("calendar", "/calendar", "Calendar")}
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
 * `embedded` drops the cards around the two halves, for when it sits inside a dashboard card.
 */
export function CalendarBoard({ initialMonth, embedded = false }: { initialMonth?: string; embedded?: boolean }) {
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
    () => (selected ? book.events.filter((e) => e.date === selected).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [book.events, selected],
  );
  const selectedDay = weeks.flat().find((d) => d.date === selected);

  // What's still to come: repeating payments on the days they're expected, and the due dates card statements print.
  const charges = useMemo(() => detectRecurring(book, ledger, today), [book, ledger, today]);
  const gridFrom = weeks[0][0].date;
  const gridTo = weeks[weeks.length - 1][6].date;
  const expected = useMemo(() => expectedPayments(charges, today, gridFrom, gridTo), [charges, today, gridFrom, gridTo]);
  const dues = useMemo<CalendarCardDue[]>(
    () =>
      book.accounts
        .filter((a) => a.type === "credit_card")
        .flatMap((a) =>
          cardDueDates(
            book,
            a.id,
            statements.imports.filter((i) => i.accountId === a.id && i.status !== "FAILED").map((i) => i.cardBill ?? {}),
          ).map((d) => ({ ...d, accountId: a.id, cardName: a.name })),
        ),
    [book, statements.imports],
  );
  const expectedByDay = useMemo(() => byDate(expected, (p) => p.date), [expected]);
  const duesByDay = useMemo(() => byDate(dues, (d) => d.dueDate), [dues]);
  const outlook = monthOutlook(ym, today, expected, dues);
  const dayExpected = (selected && expectedByDay.get(selected)) || [];
  const dayDues = (selected && duesByDay.get(selected)) || [];

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
  const Pane = embedded ? "div" : Card;

  return (
    <div className={cn("grid grid-cols-1 items-start lg:grid-cols-[minmax(0,1fr)_420px]", embedded ? "gap-4 lg:gap-6" : "gap-4 sm:gap-6")}>
      <Pane className={cn(!embedded && "overflow-hidden")}>
        <div className={cn("grid gap-3 sm:gap-4", !embedded && "p-2 sm:p-5")}>
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

          <dl className="grid grid-cols-3 divide-x rounded-xl bg-muted/50 py-2 text-center">
            <div>
              <dt className="text-xs text-muted-foreground">Income</dt>
              <dd className="font-semibold tabular-nums text-emerald-700">{formatExactINR(totals.income)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Spent</dt>
              <dd className="font-semibold tabular-nums text-red-600">{formatExactINR(totals.spent)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Left over</dt>
              <dd className="font-semibold tabular-nums">{formatExactINR(left)}</dd>
            </div>
          </dl>
          {outlook && (outlook.expectedCount > 0 || outlook.cardBillCount > 0) && (
            <p className="-mt-1 px-1 text-sm text-muted-foreground" data-testid="month-outlook">
              {outlook.expectedCount > 0 && (
                <>
                  <span className="font-semibold tabular-nums text-foreground">{formatExactINR(outlook.expectedMinor)}</span>{" "}
                  {ym > monthKey(today) ? `expected to go out in ${formatMonthLong(ym)}` : `still expected to go out by ${formatDayMonth(monthEnd(ym))}`} (
                  {outlook.expectedCount} repeating {outlook.expectedCount === 1 ? "payment" : "payments"})
                </>
              )}
              {outlook.expectedCount > 0 && outlook.cardBillCount > 0 && ", plus "}
              {outlook.cardBillCount > 0 && (
                <>
                  <span className="font-semibold tabular-nums text-red-600">{formatExactINR(outlook.cardBillsMinor)}</span> left to pay on{" "}
                  {outlook.cardBillCount === 1 ? "a card bill" : `${outlook.cardBillCount} card bills`} due this month
                </>
              )}
              .
            </p>
          )}

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
                    expected={expectedByDay.get(d.date) ?? []}
                    dues={duesByDay.get(d.date) ?? []}
                    today={d.date === today}
                    selected={d.date === selected}
                    onPick={() => pick(d)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </Pane>

      <Pane className={cn(embedded ? "overflow-hidden rounded-2xl border bg-card" : "lg:sticky lg:top-24")}>
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
              <div>
                <h2 className="font-semibold">{formatWeekdayDate(selected)}</h2>
                <p className="text-sm text-muted-foreground">
                  {dayEvents.length === 0 ? (
                    dayExpected.length + dayDues.length > 0 ? "Nothing recorded yet" : "Nothing recorded"
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
            {dayEvents.length + dayExpected.length + dayDues.length > 0 ? (
              <div className={cn(embedded && "max-h-[26rem] overflow-y-auto")}>
                {dayEvents.length > 0 && (
                  <ul className="divide-y py-1">
                    {dayEvents.map((e) => (
                      <EventRow key={e.id} event={e} />
                    ))}
                  </ul>
                )}
                {dayExpected.length + dayDues.length > 0 && (
                  <section aria-label="Expected" className={cn(dayEvents.length > 0 && "border-t")}>
                    <h3 className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:px-5">Expected</h3>
                    <ul className="divide-y py-1">
                      {dayDues.map((d) => (
                        <CardDueRow key={`${d.accountId}-${d.statementDate}`} due={d} today={today} />
                      ))}
                      {dayExpected.map((p) => (
                        <ExpectedRow key={p.charge.key} payment={p} />
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
      </Pane>
    </div>
  );
}

/** A repeating payment that should come on this day: faded, since it hasn't happened yet. */
function ExpectedRow({ payment }: { payment: ExpectedPayment }) {
  const { getCategory } = useFinance();
  const { charge: c, overdue } = payment;
  return (
    <li>
      <Link
        href={activityHref({ q: c.name, category: c.categoryId })}
        aria-label={`${c.name}, expected: see every payment`}
        className="flex items-center gap-3 px-3 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 sm:px-5"
      >
        <span className="opacity-60">
          <BrandLogo slug={c.brand} name={c.name} fallback={<CategoryIcon category={getCategory(c.categoryId)} tile className="!size-9 !rounded-lg" />} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-muted-foreground">{c.name}</span>
          <span className={cn("block text-xs", overdue ? "text-amber-700" : "text-muted-foreground")}>
            {overdue ? "Expected, not recorded yet" : `Expected · ${RHYTHM[c.frequency]}`}
          </span>
        </span>
        <span className="text-sm font-semibold tabular-nums text-muted-foreground">−{formatExactINR(c.amountMinor)}</span>
      </Link>
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
  expected,
  dues,
  today,
  selected,
  onPick,
}: {
  day: CalendarDay;
  expected: ExpectedPayment[];
  dues: CalendarCardDue[];
  today: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  const dayNumber = Number(day.date.slice(8));
  const weekday = new Date(`${day.date}T00:00:00`).getDay();
  const expectedMinor = expected.reduce((t, p) => t + p.charge.amountMinor, 0);
  const owedOnCards = dues.filter((d) => d.latest).reduce((t, d) => t + d.remainingMinor, 0);
  const logo = expected.find((p) => p.charge.brand)?.charge;
  const label = [
    formatWeekdayDate(day.date),
    day.incomeMinor > 0 && `income ${formatExactINR(day.incomeMinor)}`,
    day.expensesMinor > 0 && `spent ${formatExactINR(day.expensesMinor)}`,
    day.expensesMinor < 0 && `${formatExactINR(-day.expensesMinor)} came back`,
    day.entryCount > 0 && `${day.entryCount} ${day.entryCount === 1 ? "entry" : "entries"}`,
    expected.length > 0 && `expected ${formatExactINR(expectedMinor)} (${expected.map((p) => p.charge.name).join(", ")})`,
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
        "relative flex min-h-16 min-w-0 flex-col items-stretch gap-0.5 bg-card p-1 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring sm:min-h-24 sm:p-2",
        !day.inMonth && "bg-muted/30 text-muted-foreground/60",
        selected && "z-10 bg-primary/5 ring-2 ring-inset ring-primary",
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
          {logo && <BrandLogo slug={logo.brand} name={logo.name} fallback={null} className="hidden !size-5 !rounded-md opacity-60 sm:grid [&>img]:!size-4" />}
          {dues.length > 0 &&
            (owedOnCards > 0 ? <span className="size-2 rounded-full bg-red-600 ring-2 ring-card" /> : <CreditCard className="size-3 text-muted-foreground" />)}
        </span>
      </span>
      <span className={cn("mt-auto grid min-w-0 text-right text-[10px] font-medium leading-tight tabular-nums sm:text-xs", !day.inMonth && "opacity-60")}>
        {day.incomeMinor > 0 && <span className="truncate text-emerald-700">+{formatCompactINR(day.incomeMinor)}</span>}
        {day.expensesMinor > 0 && <span className="truncate text-red-600">−{formatCompactINR(day.expensesMinor)}</span>}
        {day.expensesMinor < 0 && <span className="truncate text-emerald-700">↩{formatCompactINR(-day.expensesMinor)}</span>}
        {expectedMinor > 0 && <span className="truncate italic text-muted-foreground/80">~{formatCompactINR(expectedMinor)}</span>}
        {day.entryCount > 0 && day.incomeMinor <= 0 && day.expensesMinor === 0 && (
          // Only transfers, loans or investments that day: counted as neither, but still worth a look.
          <span className="ml-auto size-1.5 rounded-full bg-muted-foreground/50" aria-hidden />
        )}
      </span>
    </button>
  );
}
