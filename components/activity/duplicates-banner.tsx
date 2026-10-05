"use client";

import { useMemo, useState } from "react";
import { CopyX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDisplayDate } from "@/lib/domain/dates";
import { formatRupees } from "@/lib/finance/describe";
import { findImportedDuplicates } from "@/lib/finance/duplicates";
import type { FinancialEvent } from "@/lib/finance/types";
import { useFinance } from "../finance-provider";
import { useToast } from "../toast";

const amountOf = (e: FinancialEvent) => ("amountMinor" in e ? e.amountMinor : "proceedsMinor" in e ? e.proceedsMinor : "totalMinor" in e ? e.totalMinor : 0);

/** "These entries look imported twice": shows what would go, lets the person untick anything, then removes the repeats. */
export function DuplicatesBanner() {
  const { book, describer, deleteEvent } = useFinance();
  const toast = useToast();
  const groups = useMemo(() => findImportedDuplicates(book), [book]);
  const extras = useMemo(() => groups.flatMap((g) => g.extras), [groups]);
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);

  if (groups.length === 0) return null;
  const chosen = extras.filter((e) => !skip.has(e.id));

  function remove() {
    // Newest first, so a repeated repayment goes before the repeated loan it settles.
    const order = [...chosen].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const failed: string[] = [];
    let done = 0;
    for (const e of order) {
      const r = deleteEvent(e.id);
      if (r.ok) done++;
      else failed.push(`${describer.title(e)} (${formatDisplayDate(e.date)}): ${r.issues[0]?.message ?? "couldn't be removed"}`);
    }
    setErrors(failed);
    if (done) toast.show({ message: `Removed ${done} repeated ${done === 1 ? "entry" : "entries"}` });
    if (failed.length === 0) setOpen(false);
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" data-testid="duplicates-banner">
        <span className="flex items-center gap-2">
          <CopyX className="size-4 shrink-0" />
          <span>
            <strong>{extras.length}</strong> {extras.length === 1 ? "entry looks" : "entries look"} like {extras.length === 1 ? "a repeat" : "repeats"} from importing the same statement twice.
          </span>
        </span>
        <Button size="sm" variant="outline" className="bg-white" onClick={() => { setSkip(new Set()); setErrors([]); setOpen(true); }} data-testid="review-duplicates">
          Review and remove
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Remove repeated entries</DialogTitle>
            <DialogDescription>
              Each pair below is the same statement line recorded twice. The first is kept; tick the repeats you want to remove. Anything you untick stays.
            </DialogDescription>
          </DialogHeader>

          <ul className="grid gap-3" data-testid="duplicate-groups">
            {groups.map((g) => (
              <li key={g.key} className="rounded-xl border p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Keeping</p>
                <p className="text-sm font-medium">
                  {describer.title(g.keep[0])} · {formatDisplayDate(g.keep[0].date)} · {formatRupees(amountOf(g.keep[0]))}
                  {g.keep.length > 1 ? ` (×${g.keep.length})` : ""}
                </p>
                {g.extras.map((e) => (
                  <label key={e.id} className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-sm text-red-900">
                    <input
                      type="checkbox"
                      checked={!skip.has(e.id)}
                      onChange={(ev) => {
                        const next = new Set(skip);
                        if (ev.target.checked) next.delete(e.id);
                        else next.add(e.id);
                        setSkip(next);
                      }}
                    />
                    <span className="flex-1">Remove the repeat · added {new Date(e.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                  </label>
                ))}
              </li>
            ))}
          </ul>

          {errors.length > 0 && (
            <ul className="list-disc rounded-lg bg-red-50 py-2 pl-7 pr-3 text-sm text-red-800">
              {errors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={chosen.length === 0} onClick={remove} data-testid="remove-duplicates">
              Remove {chosen.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
