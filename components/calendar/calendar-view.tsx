"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCompactINR, formatExactINR } from "@/lib/charts/format";
import { formatMonthLong, formatWeekdayDate, monthKey, shiftMonth } from "@/lib/domain/dates";
import { calendarMonth, type CalendarDay } from "@/lib/finance/calendar";
import { cn } from "@/lib/utils";
import { useEventDialog } from "../events/event-dialog";
import { EventRow } from "../events/event-row";
import { useFinance } from "../finance-provider";
import { PageTitle } from "../page-title";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isMonth = (s: string | null): s is string => !!s && /^\d{4}-\d{2}$/.test(s);

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
                  <DayCell key={d.date} day={d} today={d.date === today} selected={d.date === selected} onPick={() => pick(d)} />
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
                    "Nothing recorded"
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
            {dayEvents.length > 0 ? (
              <ul className={cn("divide-y py-1", embedded && "max-h-[26rem] overflow-y-auto")}>
                {dayEvents.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </ul>
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

function DayCell({ day, today, selected, onPick }: { day: CalendarDay; today: boolean; selected: boolean; onPick: () => void }) {
  const dayNumber = Number(day.date.slice(8));
  const weekday = new Date(`${day.date}T00:00:00`).getDay();
  const label = [
    formatWeekdayDate(day.date),
    day.incomeMinor > 0 && `income ${formatExactINR(day.incomeMinor)}`,
    day.expensesMinor > 0 && `spent ${formatExactINR(day.expensesMinor)}`,
    day.expensesMinor < 0 && `${formatExactINR(-day.expensesMinor)} came back`,
    day.entryCount > 0 && `${day.entryCount} ${day.entryCount === 1 ? "entry" : "entries"}`,
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
      <span
        className={cn(
          "grid size-6 place-items-center rounded-full text-xs font-medium tabular-nums sm:text-sm",
          day.inMonth && weekday === 0 && "text-red-600",
          day.inMonth && weekday === 6 && "text-sky-700",
          today && "bg-primary font-semibold text-primary-foreground",
        )}
      >
        {dayNumber}
      </span>
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
