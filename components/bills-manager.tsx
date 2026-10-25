"use client";

import { useState } from "react";
import { CalendarClock, Check, HelpCircle, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatExactINR } from "@/lib/charts/format";
import { formatDayMonth } from "@/lib/domain/dates";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import { currentBills, markPaid, newBill, REPEAT_LABEL, updateBills, useBills, type Bill, type Repeat } from "@/lib/finance/bills";
import { dueWording, type Reminder } from "@/lib/finance/reminders";
import { cn } from "@/lib/utils";
import { useFinance } from "./finance-provider";
import { ReminderLogo } from "./reminder-logo";
import { useReminders } from "./reminders";
import { useToast } from "./toast";

const REPEATS: Repeat[] = ["none", "weekly", "monthly", "yearly"];

/** Marks a bill you added as paid (it moves to its next date, or goes if it was once-only), with Undo. */
export function usePayBill() {
  const { today } = useFinance();
  const toast = useToast();
  return (billId: string) => {
    const before = currentBills().bills.find((b) => b.id === billId);
    if (!before) return;
    const after = markPaid(before, today);
    updateBills((d) => ({ ...d, bills: after ? d.bills.map((b) => (b.id === billId ? after : b)) : d.bills.filter((b) => b.id !== billId) }));
    toast.show({
      message: after ? `${before.name} paid. Next: ${formatDayMonth(after.dueDate)}.` : `${before.name} paid.`,
      actionLabel: "Undo",
      onAction: () => updateBills((d) => ({ ...d, bills: after ? d.bills.map((b) => (b.id === billId ? before : b)) : [...d.bills, before] })),
      duration: 6000,
    });
  };
}

/** Every date being tracked, soonest first, with ways to move it, mark it paid, or change the bill. */
export function BillsDialog({ onClose }: { onClose: () => void }) {
  const all = useReminders(true);
  const pay = usePayBill();
  const toast = useToast();
  const stopped = Object.entries(useBills().stopped ?? {});
  const [dateFor, setDateFor] = useState<Reminder | null>(null);
  const [autopayFor, setAutopayFor] = useState<Reminder | null>(null);
  const [form, setForm] = useState<{ bill?: Bill } | null>(null);

  const resume = (key: string) => updateBills((d) => ({ ...d, stopped: Object.fromEntries(Object.entries(d.stopped ?? {}).filter(([k]) => k !== key)) }));

  const remove = (r: Reminder) => {
    const bill = currentBills().bills.find((b) => b.id === r.billId);
    if (!bill) return;
    updateBills((d) => ({ ...d, bills: d.bills.filter((b) => b.id !== bill.id) }));
    toast.show({ message: `Removed ${bill.name}`, actionLabel: "Undo", onAction: () => updateBills((d) => ({ ...d, bills: [...d.bills, bill] })), duration: 6000 });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bills & due dates</DialogTitle>
          <DialogDescription>Card bills and subscriptions are found from your statements and history. Add your own, like rent or insurance, move any date, and mark a subscription not active if it was a one-off or you cancelled it.</DialogDescription>
        </DialogHeader>

        <Button type="button" variant="outline" onClick={() => setForm({})}>
          <Plus /> Add a bill
        </Button>

        {all.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing tracked yet.</p>
        ) : (
          <ul className="grid max-h-[50vh] divide-y overflow-y-auto" data-testid="bills-list">
            {all.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2.5">
                <ReminderLogo r={r} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className={cn("text-xs", r.days < 0 ? "text-amber-700" : "text-muted-foreground")}>
                    {formatDayMonth(r.dueDate)} · {dueWording(r.days)}
                    {r.repeat && r.repeat !== "none" && ` · ${REPEAT_LABEL[r.repeat].toLowerCase()}`}
                    {r.moved && " · date moved"}
                    {r.autopay && " · autopay"}
                  </p>
                  {r.amountMinor > 0 && <p className="text-xs tabular-nums text-muted-foreground">{formatExactINR(r.amountMinor)}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  {r.kind === "custom" && (
                    <Button type="button" size="icon" variant="ghost" aria-label={`Mark ${r.title} paid`} title="Mark paid" onClick={() => r.billId && pay(r.billId)}>
                      <Check />
                    </Button>
                  )}
                  <Button type="button" size="icon" variant="ghost" aria-label={`Change ${r.title} date`} title="Change date" onClick={() => setDateFor(r)}>
                    <CalendarClock />
                  </Button>
                  {r.kind === "subscription" && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={r.autopay ? `${r.title} is on autopay. Change` : `Is ${r.title} on autopay?`}
                      title={r.autopay ? "On autopay. Tap to change" : "Is it on autopay?"}
                      onClick={() => setAutopayFor(r)}
                    >
                      {r.autopay ? <RefreshCw className="text-emerald-600" /> : <HelpCircle />}
                    </Button>
                  )}
                  {r.kind === "custom" && (
                    <>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${r.title}`} title="Edit" onClick={() => setForm({ bill: currentBills().bills.find((b) => b.id === r.billId) })}>
                        <Pencil />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${r.title}`} title="Remove" onClick={() => remove(r)}>
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {stopped.length > 0 && (
          <section aria-label="Not active" className="grid gap-1 border-t pt-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Not active</h3>
            <p className="text-xs text-muted-foreground">If one charges you again, it comes back on its own.</p>
            <ul className="grid">
              {stopped.map(([key, { name }]) => (
                <li key={key} className="flex items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{name}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => resume(key)}>
                    <Undo2 /> Track again
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>

        {dateFor && <DateDialog reminder={dateFor} onClose={() => setDateFor(null)} />}
        {autopayFor && <AutopayDialog reminder={autopayFor} onClose={() => setAutopayFor(null)} />}
        {form && <BillForm bill={form.bill} onClose={() => setForm(null)} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Asks whether a found subscription is on autopay. Yes: it renews by itself, so it stays tracked and reminded. No: it was
 * a one-off or is cancelled, so it's marked not active (until it charges you again).
 */
export function AutopayDialog({ reminder, onClose }: { reminder: Reminder; onClose: () => void }) {
  const toast = useToast();
  const without = <T,>(rec: Record<string, T> | undefined, key: string) => Object.fromEntries(Object.entries(rec ?? {}).filter(([k]) => k !== key));

  const yes = () => {
    updateBills((d) => ({ ...d, autopay: { ...d.autopay, [reminder.baseKey]: true }, stopped: without(d.stopped, reminder.baseKey) }));
    toast.show({ message: `${reminder.title} is on autopay. We'll keep reminding you before it renews.`, duration: 5000 });
    onClose();
  };
  const no = () => {
    const before = currentBills();
    updateBills((d) => ({
      ...d,
      autopay: without(d.autopay, reminder.baseKey) as Record<string, true>,
      overrides: without(d.overrides, reminder.baseKey),
      stopped: { ...d.stopped, [reminder.baseKey]: { name: reminder.title, lastDate: reminder.lastDate ?? reminder.dueDate } },
    }));
    toast.show({
      message: `${reminder.title} marked not active. No more reminders for it.`,
      actionLabel: "Undo",
      onAction: () => updateBills(() => before),
      duration: 6000,
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Is {reminder.title} on autopay?</DialogTitle>
          <DialogDescription>
            On autopay means it renews by itself, so we keep it tracked and remind you before each renewal. If it was a one-time payment or you cancelled it, we stop tracking it, and
            pick it up again if it ever charges you again.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Button type="button" onClick={yes} data-testid="autopay-yes">
            <RefreshCw /> Yes, it&apos;s on autopay
          </Button>
          <Button type="button" variant="outline" onClick={no} data-testid="autopay-no">
            No, it was one-time or I cancelled it
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Moves one due date. For a found bill it holds until the next statement or renewal, which brings its own date. */
export function DateDialog({ reminder, onClose }: { reminder: Reminder; onClose: () => void }) {
  const [date, setDate] = useState(reminder.dueDate);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);

  const save = (to: string) => {
    updateBills((d) => {
      if (reminder.kind === "custom") return { ...d, bills: d.bills.map((b) => (b.id === reminder.billId ? { ...b, dueDate: to } : b)) };
      const overrides = { ...d.overrides };
      if (to === reminder.originalDate) delete overrides[reminder.baseKey];
      else overrides[reminder.baseKey] = { from: reminder.originalDate, to };
      return { ...d, overrides };
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{reminder.title}: due date</DialogTitle>
          <DialogDescription>
            {reminder.kind === "custom"
              ? "When it next falls due."
              : `The date found is ${formatDayMonth(reminder.originalDate)}. Moving it only changes your reminder, and applies to this bill only.`}
          </DialogDescription>
        </DialogHeader>
        <Input type="date" value={date} aria-label="Due date" onChange={(e) => setDate(e.target.value)} />
        <DialogFooter className="flex-wrap">
          {reminder.moved && (
            <Button type="button" variant="ghost" className="mr-auto" onClick={() => save(reminder.originalDate)}>
              <RotateCcw /> Back to {formatDayMonth(reminder.originalDate)}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!valid} onClick={() => save(date)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A bill you track yourself: its name, usual amount (optional), next due date and how often it repeats. */
export function BillForm({ bill, onClose }: { bill?: Bill; onClose: () => void }) {
  const { today } = useFinance();
  const [name, setName] = useState(bill?.name ?? "");
  const [amount, setAmount] = useState(bill?.amountMinor ? minorToInputString(bill.amountMinor) : "");
  const [dueDate, setDueDate] = useState(bill?.dueDate ?? today);
  const [repeat, setRepeat] = useState<Repeat>(bill?.repeat ?? "monthly");

  const amountMinor = amount.trim() ? parseAmountToMinor(amount) : undefined;
  const valid = name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && amountMinor !== null;

  const save = () => {
    const draft = { name: name.trim(), dueDate, repeat, ...(amountMinor ? { amountMinor } : {}) };
    updateBills((d) => ({ ...d, bills: bill ? d.bills.map((b) => (b.id === bill.id ? { id: bill.id, ...draft } : b)) : [...d.bills, newBill(draft)] }));
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bill ? "Edit bill" : "Add a bill"}</DialogTitle>
          <DialogDescription>You&apos;ll see it on Home a week before it&apos;s due.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            Name
            <Input value={name} placeholder="Rent, car insurance, home loan EMI" onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="grid gap-1 text-sm">
            Usual amount <span className="text-xs text-muted-foreground">(optional)</span>
            <span className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
              <Input inputMode="decimal" className="pl-7" value={amount} aria-invalid={amountMinor === null} onChange={(e) => setAmount(e.target.value)} />
            </span>
          </label>
          <label className="grid gap-1 text-sm">
            Next due date
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <div className="grid gap-1 text-sm">
            Repeats
            <div role="radiogroup" aria-label="Repeats" className="grid grid-cols-4 gap-1 rounded-xl border bg-muted p-1">
              {REPEATS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={repeat === r}
                  onClick={() => setRepeat(r)}
                  className={cn("rounded-lg py-1.5 text-sm font-medium", repeat === r ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {REPEAT_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!valid} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
