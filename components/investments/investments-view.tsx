"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Pencil, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, formatDisplayDate, formatWeekdayDate } from "@/lib/domain/dates";
import { formatPrice, formatRupees } from "@/lib/finance/describe";
import type { Account, TradeEvent } from "@/lib/finance/types";
import { buildJournal, dayPositions, periodStats, type Position, type TradeFill } from "@/lib/trading/journal";
import { cn } from "@/lib/utils";
import { RangeTabs } from "../charts/primitives";
import { useEventDialog } from "../events/event-dialog";
import { useFinance } from "../finance-provider";
import { AccountDialog } from "../money/account-dialog";
import { PageTitle } from "../page-title";
import { PictureIcon } from "../picture-icon";
import { SIDE_TONE, signedPrice, type TradePreset } from "./trade-form";
import { useLtp } from "./use-ltp";

type Tab = "positions" | "holdings" | "orders" | "pnl";
const TABS: { value: Tab; label: string }[] = [
  { value: "positions", label: "Positions" },
  { value: "holdings", label: "Holdings" },
  { value: "orders", label: "Orders" },
  { value: "pnl", label: "P&L" },
];

type Period = "today" | "week" | "month" | "fy" | "all";
const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "fy", label: "FY" },
  { value: "all", label: "All" },
];

/** The first day of a period ending today. Weeks start on Monday; India's financial year on 1 April. */
function periodStart(period: Period, today: string): string {
  if (period === "today") return today;
  if (period === "week") {
    const day = new Date(`${today}T00:00:00`).getDay();
    return addDays(today, -((day + 6) % 7));
  }
  if (period === "month") return `${today.slice(0, 7)}-01`;
  if (period === "fy") {
    const y = Number(today.slice(0, 4));
    return `${Number(today.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
  }
  return "0000-01-01";
}

const tone = (minor: number) => (minor > 0 ? "text-emerald-700 dark:text-emerald-400" : minor < 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground");
const product = (a: Account) => (a.style === "intraday" ? "MIS" : "CNC");

function ProductTag({ account }: { account: Account }) {
  const mis = account.style === "intraday";
  return (
    <span className={cn("rounded px-1 py-px text-[10px] font-semibold", mis ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" : "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200")}>
      {product(account)}
    </span>
  );
}

function SideTag({ side }: { side: TradeEvent["side"] }) {
  return <span className={cn("rounded px-1.5 py-px text-[10px] font-bold uppercase", SIDE_TONE[side].soft)}>{side}</span>;
}

/**
 * The trading desk, laid out like Zerodha's Kite: today's P&L with Buy and Sell, then Positions (intraday, live P&L),
 * Holdings (delivery), Orders (the tradebook) and P&L (how the trading is going: net after charges, win rate…).
 */
export function InvestmentsView() {
  const { status, book, ledger, state, today } = useFinance();
  const { openAdd } = useEventDialog();
  const [tab, setTab] = useState<Tab>("positions");
  const journal = useMemo(() => buildJournal(book, ledger), [book, ledger]);
  const todays = useMemo(() => dayPositions(journal, today), [journal, today]);
  const open = journal.positions.filter((p) => p.quantity !== 0);
  const { ltp, at } = useLtp(open.map((p) => p.symbol));

  if (status === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;

  const order = (preset: TradePreset) => openAdd("trade", { trade: preset });
  /** Profit still on open shares at the last price (null when the price isn't known). */
  const unrealized = (p: Position) => {
    const last = ltp(p.symbol);
    return last === null || p.quantity === 0 ? null : last * p.quantity - p.openCostMinor;
  };
  const todayStats = periodStats(journal, today, today);
  // Today's P&L is the Positions total, as on Kite: what today's orders booked, plus open positions at the last price.
  const rows = positionRows(journal.positions, todays);
  const booked = rows.reduce((t, p) => t + bookedToday(todays, p), 0);
  const live = rows.reduce((t, p) => t + (unrealized(p) ?? 0), 0);
  const anyOpen = rows.some((p) => p.quantity !== 0);
  const rejected = ledger.issues.filter((i) => book.events.some((e) => e.id === i.eventId && e.type === "trade"));

  return (
    <div className="mx-auto grid w-full max-w-[1100px] gap-4 sm:gap-5">
      <PageTitle>Investments</PageTitle>

      {/* Solid, not frosted: the glass blur smeared the bright Buy / Sell colours into a band across the card. */}
      <Card className="bg-[var(--glass-solid)] [&::before]:[-webkit-backdrop-filter:none] [&::before]:[backdrop-filter:none]">
        <CardContent className="grid gap-4 pt-5 max-sm:px-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Today&apos;s P&amp;L</p>
            <p className={cn("text-3xl font-semibold tabular-nums", tone(booked + live))}>{signedPrice(booked + live)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              Booked {signedPrice(booked)} after {formatPrice(todayStats.chargesMinor)} charges
              {anyOpen && ` · open ${signedPrice(live)}`} · {todayStats.orders} {todayStats.orders === 1 ? "order" : "orders"}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:w-64">
            <Button className={cn("h-12 rounded-xl text-base font-semibold", SIDE_TONE.buy.solid)} onClick={() => order({ side: "buy" })}>
              Buy
            </Button>
            <Button className={cn("h-12 rounded-xl text-base font-semibold", SIDE_TONE.sell.solid)} onClick={() => order({ side: "sell" })}>
              Sell
            </Button>
          </div>
        </CardContent>
      </Card>

      {rejected.length > 0 && (
        <div className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">
              {rejected.length} {rejected.length === 1 ? "order isn't" : "orders aren't"} counted:
            </strong>{" "}
            {rejected[0].message} Open Orders to fix {rejected.length === 1 ? "it" : "them"}.
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <RangeTabs label="Show" value={tab} options={TABS} onChange={setTab} />
      </div>

      {tab === "positions" && <Positions rows={rows} total={booked + live} todays={todays} today={today} unrealized={unrealized} ltp={ltp} at={at} order={order} />}
      {tab === "holdings" && <Holdings positions={open.filter((p) => p.product === "delivery")} unrealized={unrealized} ltp={ltp} order={order} others={state.investments.holdings.filter((h) => !h.account.style)} />}
      {tab === "orders" && <Orders fills={journal.fills} rejected={rejected.map((r) => r.eventId)} />}
      {tab === "pnl" && <PnL journal={journal} today={today} />}
    </div>
  );
}

/* ---------------- Positions ---------------- */

/** Intraday positions that are open, and anything traded today (as Kite lists them); open ones first. */
function positionRows(positions: Position[], todays: ReturnType<typeof dayPositions>) {
  return positions
    .filter((p) => (p.product === "intraday" && p.quantity !== 0) || todays.has(p.holding.id))
    .sort((a, b) => Number(b.quantity !== 0) - Number(a.quantity !== 0) || a.symbol.localeCompare(b.symbol));
}

/** What a position's orders today booked, after their charges. */
function bookedToday(todays: ReturnType<typeof dayPositions>, p: Position) {
  const d = todays.get(p.holding.id);
  return d ? d.grossMinor - d.chargesMinor : 0;
}

function Positions({
  rows,
  total,
  todays,
  today,
  unrealized,
  ltp,
  at,
  order,
}: {
  rows: Position[];
  total: number;
  todays: ReturnType<typeof dayPositions>;
  today: string;
  unrealized: (p: Position) => number | null;
  ltp: (s: string) => number | null;
  at: number | null;
  order: (p: TradePreset) => void;
}) {
  const stale = rows.filter((p) => p.product === "intraday" && p.quantity !== 0 && p.lastDate < today);

  if (rows.length === 0) {
    return (
      <Empty>
        No positions today. Record an order with <strong>Buy</strong> or <strong>Sell</strong> as you trade; intraday (MIS) ones show here with live
        P&amp;L.
      </Empty>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="max-sm:px-4 max-sm:pt-4">
        <CardTitle>Positions ({rows.length})</CardTitle>
        <div className="text-right">
          <p className={cn("text-sm font-semibold tabular-nums", tone(total))}>{signedPrice(total)}</p>
          {at && <p className="text-[10px] text-muted-foreground">LTP {new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>}
        </div>
      </CardHeader>
      {stale.length > 0 && (
        <p className="mx-4 mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:mx-6">
          {stale.map((p) => p.symbol).join(", ")} MIS {stale.length === 1 ? "is" : "are"} still open from an earlier day. Zerodha squares MIS off at 3:20 PM:
          record that exit.
        </p>
      )}
      <ul className="divide-y">
        {rows.map((p) => {
          const d = todays.get(p.holding.id);
          const booked = bookedToday(todays, p);
          const live = unrealized(p);
          const pnl = booked + (live ?? 0);
          const last = ltp(p.symbol);
          const flat = p.quantity === 0;
          return (
            <li key={p.holding.id} className={cn("grid gap-1.5 px-4 py-3 sm:px-6", flat && "opacity-70")}>
              <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ProductTag account={p.holding} />
                  Qty.{" "}
                  <span className={cn("font-semibold tabular-nums", p.quantity > 0 ? SIDE_TONE.buy.text : p.quantity < 0 ? SIDE_TONE.sell.text : "")}>
                    {p.quantity > 0 ? `+${p.quantity}` : p.quantity}
                  </span>
                  {!flat && <span className="tabular-nums">· Avg. {formatPrice(Math.abs(p.avgPriceMinor))}</span>}
                </span>
                {d && <span className="tabular-nums">{d.buyQuantity + d.sellQuantity} traded today</span>}
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{p.symbol}</span>
                <span className={cn("font-semibold tabular-nums", tone(pnl))}>{signedPrice(pnl)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="tabular-nums">{last !== null ? `LTP ${formatPrice(last)}` : flat ? "Closed" : "LTP —"}</span>
                <span className="flex gap-4">
                  <button type="button" className={cn("font-semibold", p.quantity < 0 ? SIDE_TONE.sell.text : SIDE_TONE.buy.text)} onClick={() => order({ holdingId: p.holding.id, side: p.quantity < 0 ? "sell" : "buy" })}>
                    Add
                  </button>
                  {!flat && (
                    <button
                      type="button"
                      className={cn("font-semibold", p.quantity > 0 ? SIDE_TONE.sell.text : SIDE_TONE.buy.text)}
                      onClick={() => order({ holdingId: p.holding.id, side: p.quantity > 0 ? "sell" : "buy", quantity: Math.abs(p.quantity) })}
                    >
                      Exit
                    </button>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/* ---------------- Holdings ---------------- */

function Holdings({
  positions,
  unrealized,
  ltp,
  order,
  others,
}: {
  positions: Position[];
  unrealized: (p: Position) => number | null;
  ltp: (s: string) => number | null;
  order: (p: TradePreset) => void;
  others: ReturnType<typeof useFinance>["state"]["investments"]["holdings"];
}) {
  const { openAdd } = useEventDialog();
  const [editing, setEditing] = useState<Account | null>(null);
  const invested = positions.reduce((t, p) => t + p.openCostMinor, 0);
  const priced = positions.every((p) => ltp(p.symbol) !== null);
  const current = positions.reduce((t, p) => t + (ltp(p.symbol) ?? 0) * p.quantity, 0);
  const pnl = current - invested;

  return (
    <div className="grid gap-4">
      {positions.length === 0 ? (
        <Empty>
          No delivery holdings. Buy with <strong>Longterm CNC</strong> to keep shares; they show here with their value at today&apos;s price.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="grid grid-cols-2 gap-3 pt-5 text-sm tabular-nums max-sm:px-4">
            <Stat label="Invested" value={formatPrice(invested)} />
            <Stat label="Current" value={priced ? formatPrice(current) : "—"} />
            <Stat
              label="Total P&L"
              value={priced ? `${signedPrice(pnl)}${invested > 0 ? ` (${((pnl / invested) * 100).toFixed(2)}%)` : ""}` : "—"}
              className={priced ? tone(pnl) : undefined}
            />
            <Stat label="Holdings" value={String(positions.length)} />
          </CardContent>
          <ul className="divide-y border-t">
            {positions.map((p) => {
              const last = ltp(p.symbol);
              const gain = unrealized(p);
              return (
                <li key={p.holding.id} className="grid gap-1.5 px-4 py-3 sm:px-6">
                  <div className="flex justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                    <span>
                      Qty. {p.quantity} · Avg. {formatPrice(p.avgPriceMinor)}
                    </span>
                    {gain !== null && p.openCostMinor > 0 && <span className={tone(gain)}>{((gain / p.openCostMinor) * 100).toFixed(2)}%</span>}
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{p.symbol}</span>
                    <span className={cn("font-semibold tabular-nums", gain !== null ? tone(gain) : "")}>{gain !== null ? signedPrice(gain) : "—"}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                    <span>
                      Invested {formatPrice(p.openCostMinor)}
                      {last !== null && ` · LTP ${formatPrice(last)}`}
                    </span>
                    <span className="flex gap-4">
                      <button type="button" className={cn("font-semibold", SIDE_TONE.buy.text)} onClick={() => order({ holdingId: p.holding.id, side: "buy" })}>
                        Buy
                      </button>
                      <button type="button" className={cn("font-semibold", SIDE_TONE.sell.text)} onClick={() => order({ holdingId: p.holding.id, side: "sell", quantity: p.quantity })}>
                        Sell
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Investments recorded by amount (funds, gold…), from before stock orders. */}
      {others.length > 0 && (
        <Card>
          <CardHeader className="max-sm:px-4 max-sm:pt-4">
            <CardTitle>Other investments</CardTitle>
            <span className="text-sm font-semibold tabular-nums">{formatRupees(others.reduce((t, h) => t + h.valueMinor, 0))}</span>
          </CardHeader>
          <ul className="divide-y">
            {others.map((h) => (
              <li key={h.account.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
                <PictureIcon name="invest" className="size-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{h.account.name}</p>
                  <p className={cn("truncate text-xs", tone(h.gainMinor))}>
                    Put in {formatRupees(h.costBasisMinor)} · {h.gainMinor >= 0 ? "+" : "−"}
                    {formatRupees(Math.abs(h.gainMinor))}
                  </p>
                </div>
                <p className="font-semibold tabular-nums">{formatRupees(h.valueMinor)}</p>
                <Button variant="ghost" size="icon" aria-label={`Update the value of ${h.account.name}`} onClick={() => openAdd("update_valuation", { holdingId: h.account.id })}>
                  <RefreshCw />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Edit ${h.account.name}`} onClick={() => setEditing(h.account)}>
                  <Pencil />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <AccountDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} editing={editing} />
    </div>
  );
}

/* ---------------- Orders (tradebook) ---------------- */

function Orders({ fills, rejected }: { fills: TradeFill[]; rejected: string[] }) {
  const { book } = useFinance();
  const { openDetail } = useEventDialog();
  // Orders the ledger turned down are listed too (marked), so they can be opened and fixed.
  const refused = book.events.filter((e): e is TradeEvent => e.type === "trade" && rejected.includes(e.id));
  const rows = [
    ...fills.map((f) => ({ event: f.event, fill: f as TradeFill | null })),
    ...refused.map((event) => ({ event, fill: null })),
  ].sort((a, b) => b.event.date.localeCompare(a.event.date) || (b.event.time ?? "").localeCompare(a.event.time ?? "") || b.event.createdAt.localeCompare(a.event.createdAt));

  if (rows.length === 0) return <Empty>No orders yet. Every Buy and Sell you record is listed here, newest first.</Empty>;

  const days = new Map<string, typeof rows>();
  for (const r of rows) days.set(r.event.date, [...(days.get(r.event.date) ?? []), r]);
  const accounts = new Map(book.accounts.map((a) => [a.id, a]));

  return (
    <div className="grid gap-4">
      {[...days.entries()].map(([date, list]) => {
        const net = list.reduce((t, r) => t + (r.fill ? r.fill.grossMinor - r.event.chargesMinor : 0), 0);
        return (
          <Card key={date} className="overflow-hidden">
            <CardHeader className="py-3 max-sm:px-4">
              <CardTitle className="text-sm">{formatWeekdayDate(date)}</CardTitle>
              <span className={cn("text-sm font-semibold tabular-nums", tone(net))}>{signedPrice(net)}</span>
            </CardHeader>
            <ul className="divide-y border-t">
              {list.map(({ event: e, fill }) => {
                const holding = accounts.get(e.holdingId);
                // The closed shares' profit before charges: the day's total (and the P&L tab) take every charge off.
                const pnl = fill && fill.closedQuantity > 0 ? fill.grossMinor : null;
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => openDetail(e.id)} className="grid w-full gap-1 px-4 py-2.5 text-left hover:bg-muted/50 sm:px-6">
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <SideTag side={e.side} />
                          {holding && <ProductTag account={holding} />}
                          {e.time && <span className="tabular-nums">{e.time}</span>}
                        </span>
                        {fill ? (
                          <span className="tabular-nums">Charges {formatPrice(e.chargesMinor)}</span>
                        ) : (
                          <span className="font-medium text-amber-700">Not counted</span>
                        )}
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold">{holding?.name ?? "?"}</span>
                        <span className="tabular-nums">
                          {e.quantity} × {formatPrice(e.priceMinor)}
                        </span>
                      </div>
                      {pnl !== null && (
                        <p className={cn("text-right text-xs font-medium tabular-nums", tone(pnl))}>
                          P&amp;L {signedPrice(pnl)} on {fill!.closedQuantity} · before charges
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------- P&L ---------------- */

function PnL({ journal, today }: { journal: ReturnType<typeof buildJournal>; today: string }) {
  const [period, setPeriod] = useState<Period>("month");
  const s = periodStats(journal, periodStart(period, today), today);
  const peak = Math.max(1, ...s.days.map((d) => Math.abs(d.netMinor)));

  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto">
        <RangeTabs label="Period" value={period} options={PERIODS} onChange={setPeriod} />
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-5 max-sm:px-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Net realised P&amp;L</p>
            <p className={cn("text-3xl font-semibold tabular-nums", tone(s.netMinor))}>{signedPrice(s.netMinor)}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              Gross {signedPrice(s.grossMinor)} − charges {formatPrice(s.chargesMinor)} · turnover {formatRupees(s.turnoverMinor)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm tabular-nums sm:grid-cols-4">
            <Stat label="Trades" value={`${s.trips}`} hint={`${s.orders} orders`} />
            <Stat label="Win rate" value={s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`} hint={`${s.wins} won · ${s.losses} lost`} />
            <Stat label="Avg. win" value={s.wins ? signedPrice(s.avgWinMinor) : "—"} className={tone(s.avgWinMinor)} />
            <Stat label="Avg. loss" value={s.losses ? signedPrice(s.avgLossMinor) : "—"} className={tone(s.avgLossMinor)} />
            <Stat label="Best trade" value={s.trips ? signedPrice(s.bestMinor) : "—"} className={tone(s.bestMinor)} />
            <Stat label="Worst trade" value={s.trips ? signedPrice(s.worstMinor) : "—"} className={tone(s.worstMinor)} />
            <Stat label="Profit factor" value={s.profitFactor === null ? (s.wins ? "∞" : "—") : s.profitFactor.toFixed(2)} hint="won ÷ lost" />
            <Stat label="Charges" value={formatPrice(s.chargesMinor)} hint={s.grossMinor > 0 ? `${Math.round((s.chargesMinor / s.grossMinor) * 100)}% of gross` : undefined} />
          </div>
          <p className="text-xs text-muted-foreground">A trade is a position from flat back to flat; it counts as won or lost after its charges.</p>
        </CardContent>
      </Card>

      {s.days.length > 0 && (
        <Card>
          <CardHeader className="max-sm:px-4 max-sm:pt-4">
            <CardTitle>Day by day</CardTitle>
          </CardHeader>
          <ul className="grid gap-1.5 px-4 pb-4 sm:px-6">
            {[...s.days].reverse().map((d) => (
              <li key={d.date} className="grid grid-cols-[5.5rem_1fr_6.5rem] items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground">{formatDisplayDate(d.date)}</span>
                {/* A bar either side of the middle line: profit to the right, loss to the left. */}
                <span className="relative h-3">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <span
                    className={cn("absolute inset-y-0 rounded-sm", d.netMinor >= 0 ? "left-1/2 bg-emerald-500" : "right-1/2 bg-red-500")}
                    style={{ width: `${(Math.abs(d.netMinor) / peak) * 50}%` }}
                  />
                </span>
                <span className={cn("text-right font-medium tabular-nums", tone(d.netMinor))}>{signedPrice(d.netMinor)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {s.bySymbol.length > 0 && (
        <Card>
          <CardHeader className="max-sm:px-4 max-sm:pt-4">
            <CardTitle>By stock</CardTitle>
          </CardHeader>
          <ul className="divide-y">
            {s.bySymbol.map((r) => (
              <li key={`${r.symbol}-${r.product}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-6">
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{r.symbol}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.product === "intraday" ? "MIS" : "CNC"} · {r.orders} {r.orders === 1 ? "order" : "orders"}
                  </span>
                </span>
                <span className={cn("font-medium tabular-nums", tone(r.netMinor))}>{signedPrice(r.netMinor)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {s.orders === 0 && <Empty>No orders in this period.</Empty>}
    </div>
  );
}

/* ---------------- Bits ---------------- */

function Stat({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("truncate font-semibold", className)}>{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}
