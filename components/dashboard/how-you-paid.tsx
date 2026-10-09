"use client";

import { useMemo } from "react";
import Link from "next/link";
import { formatHeadlineINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { PAID_FROM_LABEL, spendByAccount, type PaidFrom } from "@/lib/finance/spend-by-method";
import { useFinance } from "../finance-provider";

const COLOR: Record<PaidFrom, string> = { bank: "#2a78d6", credit_card: "#eb6834", cash: "#1baf7a" };

/**
 * Of everything spent in the period: how much was paid from the bank account (UPI, debit card, net
 * banking), from a credit card, and in cash. The parts add up to Spent. (What you owe on
 * cards, and when the bill is due, is on the Credit cards card.)
 */
export function HowYouPaid({ from, to }: { from: string; to: string }) {
  const { book, state } = useFinance();
  const split = useMemo(() => spendByAccount(book, from, to), [book, from, to]);

  const cards = state.accounts.filter((a) => a.account.type === "credit_card");

  if (split.parts.length === 0) return null;
  const gross = split.parts.reduce((t, p) => t + p.amountMinor, 0);
  const oneCard = cards.length === 1 ? cards[0].account.id : null;

  return (
    <div className="mt-5 rounded-2xl border p-4" data-testid="how-you-paid">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Paid from</h3>
        <span className="text-xs text-muted-foreground">
          of {formatHeadlineINR(split.totalMinor)} spent{split.refundsMinor > 0 ? ` (after ${formatHeadlineINR(split.refundsMinor)} refunds)` : ""}
        </span>
      </div>

      {gross > 0 && (
        <>
          <div className="mt-3 flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Spending by where it was paid from">
            {split.parts.map((p) => (
              <span key={p.from} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.amountMinor / gross) * 100}%`, background: COLOR[p.from] }} />
            ))}
          </div>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-3">
            {split.parts.map((p) => {
              const body = (
                <>
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLOR[p.from] }} />
                  <span className="flex-1">{PAID_FROM_LABEL[p.from]}</span>
                  <span className="font-semibold tabular-nums">{formatHeadlineINR(p.amountMinor)}</span>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round((p.amountMinor / gross) * 100)}%</span>
                </>
              );
              return (
                <li key={p.from}>
                  {p.from === "credit_card" && oneCard ? (
                    <Link href={activityHref({ account: oneCard, from, to })} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                      {body}
                    </Link>
                  ) : (
                    <span className="flex items-center gap-2 px-1 py-0.5 text-sm">{body}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">Bank account includes UPI, debit card and net banking: they all take money from your bank.</p>
        </>
      )}

    </div>
  );
}
