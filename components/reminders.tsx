"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CalendarClock, Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { formatDayMonth } from "@/lib/domain/dates";
import { isStopped, updateBills, useBills } from "@/lib/finance/bills";
import { detectRecurring, subscriptionsOf } from "@/lib/finance/recurring";
import { dueWording, stageOf, upcomingBills, type Reminder } from "@/lib/finance/reminders";
import { readSent, useRemindersOn, writeSent } from "@/lib/reminder-settings";
import { cn } from "@/lib/utils";
import { BillsDialog, DateDialog, usePayBill } from "./bills-manager";
import { useFinance } from "./finance-provider";
import { ReminderLogo } from "./reminder-logo";
import { useStatements } from "./statements/statements-provider";
import { useToast } from "./toast";

/**
 * Bills coming up or just missed: unpaid card bills (from the statements' due dates), subscriptions about to renew
 * and the bills you added, with any dates you moved. `all` lists everything tracked, for managing dates.
 */
export function useReminders(all = false): Reminder[] {
  const { status, book, today } = useFinance();
  const { imports } = useStatements();
  const subscriptions = useDetectedSubscriptions();
  const data = useBills();
  return useMemo(
    () => (status === "ready" ? upcomingBills(book, imports, subscriptions, today, { data, all }) : []),
    [status, book, today, imports, subscriptions, data, all],
  );
}

/** The subscriptions found in your history (before any are marked not active). */
function useDetectedSubscriptions() {
  const { book, ledger, today } = useFinance();
  return useMemo(() => subscriptionsOf(detectRecurring(book, ledger, today)), [book, ledger, today]);
}

const hrefOf = (r: Reminder) => (r.kind === "card" && r.accountId ? activityHref({ account: r.accountId }) : r.kind === "custom" ? "/" : activityHref({ q: r.title }));

const bodyOf = (r: Reminder) =>
  r.kind === "custom"
    ? `${dueWording(r.days)}${r.amountMinor > 0 ? ` · ${formatExactINR(r.amountMinor)}` : ""}`
    : r.kind === "card"
    ? `${dueWording(r.days)} · ${formatExactINR(r.amountMinor)} left to pay${r.minimumMinor ? ` (minimum ${formatExactINR(r.minimumMinor)})` : ""}`
    : `Renews ${r.days === 0 ? "today" : r.days === 1 ? "tomorrow" : `in ${r.days} days`} · about ${formatExactINR(r.amountMinor)}`;

/** The "Coming up" card on Home: what's due soon, with a way to mark your own bills paid, move any date, or add a bill. */
export function DueSoon({ className }: { className?: string }) {
  const reminders = useReminders();
  const pay = usePayBill();
  const [managing, setManaging] = useState(false);
  const [dateFor, setDateFor] = useState<Reminder | null>(null);
  // Nothing near: no card at all. Dates are managed from the profile menu (Bills & due dates).
  if (reminders.length === 0) return null;
  return (
    <section aria-label="Bills coming up" className={cn("rounded-3xl border glass p-4 sm:p-5", className)} data-testid="due-soon">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">Coming up</h2>
        <Button size="sm" variant="ghost" onClick={() => setManaging(true)}>
          <CalendarClock /> Bills & dates
        </Button>
      </div>
      <ul className="grid">
        {reminders.map((r) => (
          <li key={r.id} className="-mx-2 flex items-center gap-1 rounded-xl px-2 hover:bg-slate-50">
            {r.kind === "custom" ? (
              <RowBody r={r} className="flex-1" />
            ) : (
              <Link href={hrefOf(r)} className="min-w-0 flex-1 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <RowBody r={r} />
              </Link>
            )}
            {r.kind === "custom" && r.billId && (
              <Button size="icon" variant="ghost" aria-label={`Mark ${r.title} paid`} title="Mark paid" onClick={() => pay(r.billId!)}>
                <Check />
              </Button>
            )}
            <Button size="icon" variant="ghost" aria-label={`Change ${r.title} date`} title="Change date" onClick={() => setDateFor(r)}>
              <CalendarClock />
            </Button>
          </li>
        ))}
      </ul>

      {managing && <BillsDialog onClose={() => setManaging(false)} />}
      {dateFor && <DateDialog reminder={dateFor} onClose={() => setDateFor(null)} />}
    </section>
  );
}

function RowBody({ r, className }: { r: Reminder; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-3 py-2", className)}>
      <ReminderLogo r={r} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-slate-900">{r.title}</span>
        <span className={cn("block text-xs", r.days <= 1 ? "text-amber-700" : "text-slate-500")}>
          {bodyOf(r)} · {formatDayMonth(r.dueDate)}
          {r.moved && " (moved)"}
        </span>
      </span>
      {r.amountMinor > 0 && <span className="text-[15px] font-semibold tabular-nums text-slate-900">{formatExactINR(r.amountMinor)}</span>}
    </span>
  );
}

/**
 * Tells you when a bill gets closer: once at three days, again at one day or on the day, and once more when it is
 * overdue. It always shows a message inside the app; with Bill reminders on (and permission) it also sends a device
 * notification. It runs when the app opens or comes back to the front; amounts follow privacy mode.
 */
export function ReminderNotifier() {
  const reminders = useReminders();
  const on = useRemindersOn();
  const toast = useToast();
  const subscriptions = useDetectedSubscriptions();
  const { stopped } = useBills();

  // A subscription marked not active that charges you again is back: track it again and say so.
  useEffect(() => {
    const back = subscriptions.filter((s) => stopped?.[`sub:${s.key}`] && !isStopped(stopped, `sub:${s.key}`, s.lastDate));
    if (back.length === 0) return;
    updateBills((d) => ({ ...d, stopped: Object.fromEntries(Object.entries(d.stopped ?? {}).filter(([k]) => !back.some((s) => `sub:${s.key}` === k))) }));
    toast.show({ message: `${back.map((s) => s.name).join(", ")} charged you again, so it's tracked again.`, duration: 8000 });
  }, [subscriptions, stopped, toast]);

  useEffect(() => {
    if (reminders.length === 0) return;
    const sent = readSent();
    const next: Record<string, number> = {};
    const fire: Reminder[] = [];
    for (const r of reminders) {
      const stage = stageOf(r.days);
      next[r.id] = Math.max(sent[r.id] ?? 0, stage);
      if (stage > (sent[r.id] ?? 0)) fire.push(r);
    }
    writeSent(next);
    if (fire.length === 0) return;

    toast.show({
      message: fire.length === 1 ? `${fire[0].title}: ${bodyOf(fire[0])}` : `${fire.length} bills need attention: ${fire.map((r) => r.title).join(", ")}`,
      duration: 10000,
    });

    if (on && typeof Notification !== "undefined" && Notification.permission === "granted" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.ready.then((reg) => {
        for (const r of fire) {
          void reg.showNotification(r.title, { body: bodyOf(r), tag: r.id, icon: "/icon.png", data: { url: hrefOf(r) } });
        }
      });
    }
  }, [reminders, on, toast]);

  return null;
}

/** A bell in the top bar: a badge for bills due within three days (or overdue), and the list of what's coming. */
export function NotificationsBell() {
  const reminders = useReminders();
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const urgent = reminders.filter((r) => stageOf(r.days) > 0).length;
  return (
    <>
      <Button variant="ghost" size="icon" className="relative" aria-label={urgent > 0 ? `Notifications, ${urgent} due soon` : "Notifications"} title="Notifications" onClick={() => setOpen(true)}>
        <Bell />
        {urgent > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white" aria-hidden>
            {urgent}
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
            <DialogDescription>Bills due soon or overdue.</DialogDescription>
          </DialogHeader>
          {reminders.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up. Nothing is due soon.</p>
          ) : (
            <ul className="grid max-h-[50vh] divide-y overflow-y-auto" data-testid="notifications-list">
              {reminders.map((r) => (
                <li key={r.id}>
                  {r.kind === "custom" ? (
                    <RowBody r={r} />
                  ) : (
                    <Link href={hrefOf(r)} onClick={() => setOpen(false)} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <RowBody r={r} />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManaging(true)}>
              <CalendarClock /> Bills &amp; dates
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
          {managing && <BillsDialog onClose={() => setManaging(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
