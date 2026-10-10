"use client";

import { Copy, Info, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDisplayDate } from "@/lib/domain/dates";
import { formatRupees } from "@/lib/finance/describe";
import { matchRefunds } from "@/lib/finance/state";
import type { FinancialEvent } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";
import { useEventDialog } from "./event-dialog";
import { EventLogo } from "./event-logo";

/** Amount shown for a row, and whether money came in, went out, or just moved. */
export function headline(e: FinancialEvent): { amountMinor: number; tone: "in" | "out" | "neutral" } {
  switch (e.type) {
    case "expense":
    case "reimbursable_expense":
    case "lend":
    case "repayment_made":
      return { amountMinor: e.amountMinor, tone: "out" };
    case "split_expense":
      return { amountMinor: e.totalMinor, tone: "out" };
    case "income":
    case "borrow":
    case "repayment_received":
      return { amountMinor: e.amountMinor, tone: "in" };
    case "sell_investment":
      return { amountMinor: e.proceedsMinor, tone: "in" };
    case "transfer":
    case "invest":
      return { amountMinor: e.amountMinor, tone: "neutral" };
    case "update_valuation":
      return { amountMinor: e.valueMinor, tone: "neutral" };
  }
}

/**
 * One entry in a list. Click the row for the full "what changed" view; the
 * pencil is always visible so correcting a mistake is obvious. Copy and bin show
 * from tablet width up; on phones they live in the row's details.
 */
export function EventRow({ event, onOpen }: { event: FinancialEvent; /** Tapping the row does this instead of opening the details. */ onOpen?: () => void }) {
  const { book, describer, issuesByEvent } = useFinance();
  const refunded = event.type === "expense" ? [...matchRefunds(book).values()].filter((m) => m.expenseId === event.id).reduce((t, m) => t + m.amountMinor, 0) : 0;
  const refundFor = matchRefunds(book).get(event.id);
  const refundedItem = refundFor ? book.events.find((e) => e.id === refundFor.expenseId) : undefined;
  const { openDetail, openEdit, openDuplicate, requestDelete } = useEventDialog();
  const { amountMinor, tone } = headline(event);
  const issue = issuesByEvent.get(event.id)?.[0];
  const title = describer.title(event);

  return (
    <li className="flex items-center gap-0.5 pr-1 transition-colors hover:bg-muted/50 sm:gap-1 sm:pr-3">
      <button
        type="button"
        onClick={() => (onOpen ? onOpen() : openDetail(event.id))}
        aria-label={onOpen ? `${title}. See every entry with ${title}.` : `${title}. See what changed.`}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-3 pl-3 pr-1 text-left outline-none focus-visible:bg-muted/60 sm:gap-3 sm:px-5"
      >
        <EventLogo event={event} tile />

        <div className="min-w-0 flex-1">
          <p className="break-words font-medium leading-snug">{title}</p>
          <p className="truncate text-sm text-muted-foreground">
            {formatDisplayDate(event.date)} · {describer.subtitle(event)}
          </p>
          {refunded > 0 && (
            <p className="mt-0.5 text-xs font-medium text-emerald-700">
              {refunded >= headline(event).amountMinor ? "Fully refunded" : `Refunded ${formatRupees(refunded)}`} · not counted as spending
            </p>
          )}
          {refundedItem && (
            <p className="mt-0.5 text-xs font-medium text-emerald-700">
              Refund of the {formatDisplayDate(refundedItem.date)} purchase · not counted as income
            </p>
          )}
          {issue && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700">
              <TriangleAlert className="size-3" /> Not counted: {issue.message}
            </p>
          )}
        </div>

        <p
          className={cn(
            "shrink-0 font-semibold tabular-nums",
            tone === "in" && "text-emerald-700",
            tone === "neutral" && "text-muted-foreground",
            issue && "line-through opacity-50",
          )}
        >
          {tone === "in" ? "+" : tone === "out" ? "−" : ""}
          {formatRupees(amountMinor)}
        </p>
      </button>

      <div className="flex shrink-0 items-center">
        {onOpen && (
          <Button variant="ghost" size="icon" aria-label={`Details of ${title}`} title="Details" onClick={() => openDetail(event.id)}>
            <Info />
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label={`Edit ${title}`} title="Edit" onClick={() => openEdit(event.id)}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon" aria-label={`Duplicate ${title}`} title="Duplicate" className="hidden sm:inline-flex" onClick={() => openDuplicate(event.id)}>
          <Copy />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${title}`}
          title="Delete"
          // Phones: tap the row instead; its details offer Delete, which leaves room for the title.
          className="hidden hover:bg-red-50 hover:text-destructive sm:inline-flex"
          onClick={() => requestDelete(event.id)}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}
