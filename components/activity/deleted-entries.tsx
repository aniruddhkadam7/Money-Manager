"use client";

import { ChevronDown, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDisplayDate } from "@/lib/domain/dates";
import { formatRupees } from "@/lib/finance/describe";
import type { DeletedEntry } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { headline } from "../events/event-row";
import { useFinance } from "../finance-provider";
import { useToast } from "../toast";

/** Puts a deleted entry back, saying why when it can't (its account was deleted, say). */
export function useRestoreDeleted() {
  const { restoreEvent, describer } = useFinance();
  const toast = useToast();
  return (d: DeletedEntry) => {
    const r = restoreEvent(d.event);
    toast.show({ message: r.ok ? `Put back “${describer.title(d.event)}”` : (r.issues[0]?.message ?? "Couldn't put that back."), duration: r.ok ? 4000 : 6000 });
  };
}

/**
 * Entries you deleted: nothing is ever removed for good. They count for nothing until put back, and each one
 * can be put back exactly as it was.
 */
export function DeletedEntries() {
  const { book, describer } = useFinance();
  const restore = useRestoreDeleted();
  const deleted = [...(book.deleted ?? [])].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  if (deleted.length === 0) return null;
  return (
    <Card className="p-0">
      <details className="group" data-testid="deleted-entries">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 sm:px-5">
          <ChevronDown className="size-4 text-muted-foreground transition-transform [details:not([open])_&]:-rotate-90" />
          <span className="font-semibold">Deleted entries</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">{deleted.length}</span>
          <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Not counted anywhere. Put one back to count it again.</span>
        </summary>
        <ul className="divide-y border-t">
          {deleted.map((d) => {
            const { amountMinor, tone } = headline(d.event);
            return (
              <li key={d.event.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{describer.title(d.event)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDisplayDate(d.event.date)} · deleted {formatDisplayDate(d.deletedAt.slice(0, 10))}
                  </p>
                </div>
                <span className={cn("shrink-0 text-sm font-semibold tabular-nums", tone === "in" && "text-emerald-700")}>{formatRupees(amountMinor)}</span>
                <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={() => restore(d)}>
                  <Undo2 /> Put back
                </Button>
              </li>
            );
          })}
        </ul>
      </details>
    </Card>
  );
}
