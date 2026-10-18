"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { formatCompactINR, formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { formatDayMonth, formatDisplayDate } from "@/lib/domain/dates";
import { explainAccountBalance } from "@/lib/finance/explain";
import type { FinancialState } from "@/lib/finance/state";
import type { Account, Book } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { ExplainSheet, HowIcon, useExplain } from "../explainer";
import { useFinance } from "../finance-provider";
import { AccountLogo, useBankHints } from "../account-logo";
import { useCardUsage, useStatementChecks } from "../statements/use-statement-checks";

/**
 * Every bank account and credit card you use, compactly, as its bank app would show it: the logo and what's
 * available (for a card, what's left of its limit, going by its statements). This month's spending is in the summary at the top.
 */
export function AccountsSection({ book, state }: { book: Book; state: FinancialState }) {
  const checks = useStatementChecks();
  // The bank any of the account's statements names (card statements print no closing balance, so not only `checks`).
  const bankOf = useBankHints();
  const usageOf = useCardUsage();
  const used = (id: string) =>
    book.events.some((e) => ("accountId" in e && e.accountId === id) || ("fromAccountId" in e && e.fromAccountId === id) || ("toAccountId" in e && e.toAccountId === id));

  const order = { bank: 0, credit_card: 1, cash: 2 } as Record<string, number>;
  const rows = state.accounts
    .filter((a) => a.account.type in order && (a.balanceMinor !== 0 || used(a.account.id) || checks.has(a.account.id)))
    .sort((a, b) => order[a.account.type] - order[b.account.type]);
  const rowRef = useTicker(rows.length);
  if (rows.length === 0) return null;

  const tile = ({ account, balanceMinor }: (typeof rows)[number], set: number) => {
    const copy = set > 0;
    const card = account.type === "credit_card";
    const check = checks.get(account.id);
    // `state` already starts bank balances from the latest statement; name the statement while nothing has moved since.
    const asStatement = !!check && !card && balanceMinor === check.closingMinor;
    // Cash below zero only means the starting cash was never set: show nothing left, not a debt.
    const noStartingCash = account.type === "cash" && balanceMinor < 0;
    // A card shows what's left of its limit, as the bank's app does: the latest bill's unpaid part and what's been
    // spent since its statement are taken off.
    const usage = card ? usageOf(account, balanceMinor) : null;
    const shown = usage ? usage.availableMinor : noStartingCash ? 0 : balanceMinor;
    return (
      <div
        key={copy ? `copy${set}-${account.id}` : account.id}
        className={cn("group relative flex w-[42%] min-w-0 shrink-0 flex-col gap-1 glass rounded-xl border p-2.5 sm:w-auto sm:gap-1.5 sm:p-3", copy && "sm:hidden")}
        data-testid={copy ? undefined : "account-tile"}
        data-ticker-copy={copy || undefined}
        aria-hidden={copy || undefined}
      >
        {/* The link's ::after covers the whole tile, so a tap anywhere on it opens the account (the ⓘ sits above it). */}
        <Link
          href={activityHref({ account: account.id })}
          tabIndex={copy ? -1 : undefined}
          className="flex items-center gap-2 after:absolute after:inset-0 after:rounded-xl after:content-[''] group-hover:[&>span:last-child]:underline max-sm:[&>span:first-child]:h-7 max-sm:[&>span:first-child]:max-w-11"
        >
          <AccountLogo account={account} bankHint={bankOf(account.id)} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900 sm:text-sm">
            {account.name}
            {check?.accountMask && <span className="font-normal text-slate-500"> ••{check.accountMask}</span>}
          </span>
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
          <span className="flex items-center gap-1 text-xs text-slate-500">
            {asStatement && check
              ? `Statement ${formatDisplayDate(check.date)}`
              : usage
                ? usage.dueMinor > 0
                  ? `${formatCompactINR(usage.dueMinor)} due${usage.dueDate ? ` ${formatDayMonth(usage.dueDate)}` : ""}`
                  : usage.usedMinor > 0
                    ? `Available · ${formatCompactINR(usage.usedMinor)} used`
                    : "Available"
                : noStartingCash
                  ? "Set starting cash"
                  : "Available"}
            {!copy && (!check || card) && (
              <span className="relative z-10 flex">
                <AccountBalanceHow account={account} />
              </span>
            )}
          </span>
          <span
            className={cn(
              "text-base font-semibold tabular-nums sm:text-lg",
              shown < 0 ? "text-red-700" : "text-slate-900",
            )}
          >
            {formatExactINR(shown)}
          </span>
        </div>
      </div>
    );
  };

  return (
    // Phones: one endless row that glides sideways like a stock ticker; the tiles are repeated so it never runs out,
    // whichever way you swipe. Wider screens: a grid, without the repeats.
    <section
      ref={rowRef}
      aria-label="Your accounts"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-2.5 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 xl:grid-cols-4 [&::-webkit-scrollbar]:hidden"
    >
      {rows.map((r) => tile(r, 0))}
      {rows.length > 1 && [1, 2, 3].flatMap((set) => rows.map((r) => tile(r, set)))}
    </section>
  );
}

/**
 * Makes the phone row of tiles an endless ticker. The tiles are drawn four times over; the row is kept inside the
 * second and third sets, and whenever it drifts out (by gliding or by your swipe, either way) it is moved back by
 * exactly one set, which looks identical, so it never reaches an end. It glides left at a steady pace, and holds still
 * while you touch or swipe it (and for a moment after), when everything fits (the grid on wider screens), for reduced
 * motion, and in a hidden tab.
 */
function useTicker(count: number) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || count < 2) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const SPEED = 30; // px per second
    let pausedUntil = 0;
    let pos = el.scrollLeft;
    let last = performance.now();
    let frame = 0;

    // One set of tiles wide; zero when the repeats are hidden (wider screens).
    const loopWidth = () => {
      const first = el.firstElementChild as HTMLElement | null;
      const copy = el.querySelector<HTMLElement>("[data-ticker-copy]");
      return first && copy && copy.offsetParent ? copy.offsetLeft - first.offsetLeft : 0;
    };
    // Back into the middle sets, by whole sets.
    const wrap = (x: number, loop: number) => (x < loop ? x + loop : x >= 2 * loop ? x - loop : x);

    const pause = () => (pausedUntil = performance.now() + 2500);
    const events = ["pointerdown", "touchstart", "touchmove", "wheel", "focusin"] as const;
    for (const e of events) el.addEventListener(e, pause, { passive: true });
    // A swipe that runs past the middle sets is moved back too, so swiping never meets an end either.
    const onScroll = () => {
      const loop = loopWidth();
      if (loop <= 0) return;
      const x = wrap(el.scrollLeft, loop);
      if (x !== el.scrollLeft) el.scrollLeft = pos = x;
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    const start = loopWidth();
    if (start > 0) el.scrollLeft = pos = start;

    const step = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const loop = loopWidth();
      if (still || now < pausedUntil || document.hidden || loop <= 0) {
        pos = el.scrollLeft; // pick up wherever a swipe left it
      } else {
        pos = wrap(pos + (SPEED * dt) / 1000, loop);
        el.scrollLeft = pos;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      for (const e of events) el.removeEventListener(e, pause);
      el.removeEventListener("scroll", onScroll);
    };
  }, [count]);
  return ref;
}

/** ⓘ beside an account's balance: its starting balance, then everything in and out, ending in the balance. */
function AccountBalanceHow({ account }: { account: Account }) {
  const { book, ledger, today } = useFinance();
  const how = useExplain();
  const debt = account.type === "credit_card" || account.type === "loan";
  const x = how.props.open ? explainAccountBalance(book, ledger, account.id, today) : null;
  return (
    <>
      <HowIcon onClick={how.open} label={`${account.name} balance`} />
      {x && (
        <ExplainSheet
          {...how.props}
          signed
          title={debt ? `What you owe on ${account.name}` : `${account.name}: how the balance adds up`}
          description={
            debt
              ? "The starting amount you owed, plus purchases and charges, less payments and refunds."
              : `The starting balance you set${x.openedOn && x.openedOn > "2000-01-01" ? ` (from ${formatDisplayDate(x.openedOn)})` : ""}, plus everything that came in, less everything that went out.`
          }
          sections={[{ title: debt ? "Since you started tracking" : "Money in and out", rows: x.lines.map((l) => ({ ...l, href: activityHref({ account: account.id }) })), empty: "No entries yet." }]}
          steps={[
            { label: debt ? "Owed at the start" : "Starting balance", amountMinor: x.startMinor },
            ...x.lines.map((l) => ({ label: l.label, amountMinor: Math.abs(l.amountMinor), op: (l.amountMinor >= 0 ? "+" : "−") as "+" | "−" })),
            debt && x.totalMinor < 0
              ? { label: "Paid more than the purchases recorded", amountMinor: -x.totalMinor, op: "=" as const }
              : { label: debt ? "To pay now" : "Balance now", amountMinor: x.totalMinor, op: "=" as const },
          ]}
        />
      )}
    </>
  );
}
