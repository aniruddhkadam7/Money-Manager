"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useSessionState } from "@/lib/use-session-state";
import { Donut, type Slice } from "../dashboard/so-far-section";
import { RangeTabs } from "../charts/primitives";
import { yahooSymbol } from "./use-ltp";
import { formatPrice } from "@/lib/finance/describe";
import { periodStats, type Journal, type Position } from "@/lib/trading/journal";
import { cn } from "@/lib/utils";
import { brokerCharges, KOTAK_NEO_RATES, type BrokerRates } from "@/lib/trading/charges";
import { setKotakRates, useKotakRates } from "@/lib/brokers/kotak-charges";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { InvestmentSection } from "../dashboard/investment-section";
import { useFinance } from "../finance-provider";
import { useBalances } from "../statements/use-statement-checks";

/** Calm, distinct colours for the allocation bar (the rest grey). */
const SLICES = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#dc2626"];

const tone = (minor: number) => (minor > 0 ? "text-emerald-600 dark:text-emerald-400" : minor < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground");
const signed = (minor: number) => `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${formatPrice(Math.abs(minor))}`;
const pct = (part: number, whole: number) => (whole ? `${part >= 0 ? "+" : "−"}${Math.abs((part / whole) * 100).toFixed(2)}%` : "");

interface Row {
  p: Position;
  price: number | null;
  value: number;
  pnl: number;
  dayChange: number | null;
}

/** Selling a holding now, at its last price: the charges, what you'd receive, and the profit after charges. */
function saleOf(r: Row, rates: BrokerRates) {
  const charges = brokerCharges({ product: r.p.product, side: "sell", valueMinor: r.value }, rates).total;
  const receive = r.value - charges;
  return { charges, receive, net: receive - r.p.openCostMinor };
}

/**
 * The Invest tab's dashboard: what your shares are worth now, what they cost, the gain on them and today's move;
 * profit booked this month and in all; how your money is spread across stocks; and the portfolio's value over time.
 */
export function PortfolioOverview({
  journal,
  open,
  ltp,
  prev,
  onOpenHoldings,
}: {
  journal: Journal;
  open: Position[];
  ltp: (symbol: string) => number | null;
  prev: (symbol: string) => number | null;
  onOpenHoldings: () => void;
}) {
  const { today, ledger } = useFinance();
  const { state } = useBalances();

  const rows = useMemo<Row[]>(
    () =>
      open
        .filter((p) => p.quantity > 0)
        .map((p) => {
          const price = ltp(p.symbol);
          const value = price === null ? p.openCostMinor : price * p.quantity;
          const close = prev(p.symbol);
          return { p, price, value, pnl: value - p.openCostMinor, dayChange: price !== null && close ? (price - close) * p.quantity : null };
        })
        .sort((a, b) => b.value - a.value),
    [open, ltp, prev],
  );
  const value = rows.reduce((t, r) => t + r.value, 0);
  const invested = rows.reduce((t, r) => t + r.p.openCostMinor, 0);
  const unrealized = value - invested;
  const withDay = rows.filter((r) => r.dayChange !== null);
  const dayChange = withDay.reduce((t, r) => t + (r.dayChange ?? 0), 0);
  const dayBase = withDay.reduce((t, r) => t + r.value - (r.dayChange ?? 0), 0);
  const month = periodStats(journal, `${today.slice(0, 7)}-01`, today);
  const allTime = journal.positions.reduce((t, p) => t + p.realizedGrossMinor - p.chargesMinor, 0);
  // Investments that aren't shares you trade (mutual funds, FDs, PPF…), at their recorded value.
  const others = state.investments.holdings.filter((h) => !h.account.style && h.valueMinor !== 0);
  const othersValue = others.reduce((t, h) => t + h.valueMinor, 0);
  const firstActivity = useMemo(() => {
    let first: string | null = null;
    for (const e of ledger.entries) if (e.kind !== "opening" && (!first || e.date < first)) first = e.date;
    return first;
  }, [ledger]);

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 [&>*]:min-w-0" data-testid="portfolio-overview">
      {/* What it's all worth. */}
      <section className="rounded-3xl border glass p-4 sm:p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Portfolio value</p>
        <p className="text-3xl font-semibold tabular-nums">{formatPrice(value + othersValue)}</p>
        <p className="mt-0.5 text-sm tabular-nums">
          <span className={tone(unrealized)}>
            {signed(unrealized)} {pct(unrealized, invested)}
          </span>{" "}
          <span className="text-muted-foreground">overall</span>
          {withDay.length > 0 && (
            <>
              {" · "}
              <span className={tone(dayChange)}>
                {signed(dayChange)} {pct(dayChange, dayBase)}
              </span>{" "}
              <span className="text-muted-foreground">today</span>
            </>
          )}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Figure label="Invested" value={formatPrice(invested)} hint={`${rows.length} ${rows.length === 1 ? "stock" : "stocks"}`} />
          <Figure label="Current value" value={formatPrice(value)} hint="shares, at market price" />
          <Figure label="Booked this month" value={signed(month.netMinor)} toneMinor={month.netMinor} hint={`after charges · ${month.orders} ${month.orders === 1 ? "order" : "orders"}`} />
          <Figure label="Booked in all" value={signed(allTime)} toneMinor={allTime} hint="after charges" />
        </dl>
        {othersValue !== 0 && (
          <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
            Includes {formatPrice(othersValue)} in other investments ({others.map((h) => h.account.name).join(", ")}).
          </p>
        )}
      </section>

      {/* How it's spread: by stock, or by sector. */}
      {rows.length > 0 && <Weightage rows={rows} value={value} onOpenHoldings={onOpenHoldings} />}

      {/* What went in against what it's worth now: each stock up or down. */}
      {rows.length > 0 && <UpDown rows={rows} />}

      {/* Over time (the same card as on Home). */}
      <InvestmentSection model={{ firstActivity }} />
    </div>
  );
}

function Figure({ label, value, hint, toneMinor }: { label: string; value: string; hint?: string; toneMinor?: number }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-base font-semibold tabular-nums", toneMinor !== undefined && tone(toneMinor))}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

const sharePct = (part: number, whole: number) => {
  const v = whole > 0 ? (part / whole) * 100 : 0;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
};

/** Each share's sector (from Yahoo), kept in this browser: sectors hardly change. */
const SECTOR_KEY = "stock-sectors";
function useSectors(symbols: string[]): Record<string, string> {
  const key = [...new Set(symbols.map((s) => yahooSymbol(s)))].sort().join(",");
  const [sectors, setSectors] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(SECTOR_KEY) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    const missing = key.split(",").filter((s) => s && !(s in sectors));
    if (!missing.length) return;
    let alive = true;
    fetch(`/api/stocks/sectors?symbols=${encodeURIComponent(missing.join(","))}`)
      .then((r) => (r.ok ? r.json() : { sectors: {} }))
      .then((d: { sectors: Record<string, { sector: string | null }> }) => {
        if (!alive) return;
        setSectors((prev) => {
          const next = { ...prev };
          for (const s of missing) next[s] = d.sectors?.[s]?.sector ?? "Other";
          try {
            window.localStorage.setItem(SECTOR_KEY, JSON.stringify(next));
          } catch {
            /* not kept */
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return Object.fromEntries(symbols.map((s) => [s.toUpperCase(), sectors[yahooSymbol(s)] ?? ""]));
}

/** A donut of where your money is (by stock, or by sector), with the list: value, weight and gain of each. */
function Weightage({ rows, value, onOpenHoldings }: { rows: Row[]; value: number; onOpenHoldings: () => void }) {
  const [by, setBy] = useSessionState<"stock" | "sector">("invest:weightage", "stock");
  const [hover, setHover] = useState<string | null>(null);
  const sectorOf = useSectors(rows.map((r) => r.p.symbol));

  const groups = useMemo(() => {
    if (by === "stock") return rows.map((r) => ({ id: r.p.holding.id, label: r.p.symbol, value: r.value, cost: r.p.openCostMinor, note: `${r.p.quantity} shares` }));
    const m = new Map<string, { id: string; label: string; value: number; cost: number; names: string[] }>();
    for (const r of rows) {
      const label = sectorOf[r.p.symbol.toUpperCase()] || "Finding sector…";
      const g = m.get(label) ?? { id: label, label, value: 0, cost: 0, names: [] };
      g.value += r.value;
      g.cost += r.p.openCostMinor;
      g.names.push(r.p.symbol);
      m.set(label, g);
    }
    return [...m.values()].sort((a, b) => b.value - a.value).map((g) => ({ ...g, note: g.names.join(", ") }));
  }, [by, rows, sectorOf]);
  const slices: Slice[] = groups.map((g, i) => ({ id: g.id, label: g.label, amount: Math.max(0, g.value), color: SLICES[i] ?? "#94a3b8" }));

  return (
    <section className="rounded-3xl border glass p-4 sm:p-5" data-testid="weightage">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Weightage</h2>
        <button type="button" onClick={onOpenHoldings} className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400">
          See all
        </button>
      </div>
      <RangeTabs
        label="Weightage by"
        value={by}
        options={[
          { value: "stock", label: "Stocks" },
          { value: "sector", label: "Sectors" },
        ]}
        onChange={(v) => {
          setBy(v);
          setHover(null);
        }}
      />
      <div className="mt-4 flex justify-center">
        <Donut slices={slices} total={value} centerMinor={value} active={hover} onHover={setHover} />
      </div>
      <ul className="mt-3 divide-y">
        {groups.map((g, i) => {
          const gain = g.value - g.cost;
          return (
            <li
              key={g.id}
              className={cn("flex items-center justify-between gap-3 py-2.5 transition-opacity", hover && hover !== g.id && "opacity-50")}
              onMouseEnter={() => setHover(g.id)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: SLICES[i] ?? "#94a3b8" }} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{g.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{g.note}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3 tabular-nums">
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">{sharePct(g.value, value)}</span>
                <span className="text-right">
                  <span className="block text-sm font-semibold">{formatPrice(g.value)}</span>
                  <span className={cn("block text-xs", tone(gain))}>{pct(gain, g.cost)}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Invested against current value for each stock: two bars, and whether it's up or down (and by how much). */
function UpDown({ rows }: { rows: Row[] }) {
  const rates = useKotakRates();
  const [editing, setEditing] = useState(false);
  const sales = rows.map((r) => saleOf(r, rates));
  const all = sales.reduce((t, s) => ({ charges: t.charges + s.charges, receive: t.receive + s.receive, net: t.net + s.net }), { charges: 0, receive: 0, net: 0 });
  const peak = Math.max(1, ...rows.map((r) => Math.max(r.value, r.p.openCostMinor)));
  const byMove = [...rows].sort((a, b) => b.pnl / (b.p.openCostMinor || 1) - a.pnl / (a.p.openCostMinor || 1));
  const up = rows.filter((r) => r.pnl > 0).length;
  const down = rows.filter((r) => r.pnl < 0).length;
  return (
    <section className="rounded-3xl border glass p-4 sm:p-5" data-testid="up-down">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Invested vs now</h2>
        <span className="flex items-center gap-3 text-sm tabular-nums">
          <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
            <ArrowUpRight className="size-4" /> {up} up
          </span>
          <span className="flex items-center gap-0.5 text-rose-600 dark:text-rose-400">
            <ArrowDownRight className="size-4" /> {down} down
          </span>
        </span>
      </div>
      <p className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-slate-400/60" /> Invested
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-emerald-500" /> Now (up)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-rose-500" /> Now (down)
        </span>
      </p>
      <ul className="grid gap-3">
        {byMove.map((r) => {
          const isUp = r.pnl >= 0;
          return (
            <li key={r.p.holding.id}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-1 font-medium">
                  {isUp ? <ArrowUpRight className="size-4 text-emerald-600" /> : <ArrowDownRight className="size-4 text-rose-600" />}
                  {r.p.symbol}
                </span>
                <span className={cn("tabular-nums font-semibold", tone(r.pnl))}>
                  {signed(r.pnl)} <span className="text-xs font-medium">{pct(r.pnl, r.p.openCostMinor)}</span>
                </span>
              </div>
              <div className="grid gap-1">
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-slate-400/60" style={{ width: `${(r.p.openCostMinor / peak) * 100}%` }} title={`Invested ${formatPrice(r.p.openCostMinor)}`} />
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className={cn("h-2 rounded-full", isUp ? "bg-emerald-500" : "bg-rose-500")} style={{ width: `${(Math.max(0, r.value) / peak) * 100}%` }} title={`Now ${formatPrice(r.value)}`} />
                </div>
              </div>
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {formatPrice(r.p.openCostMinor)} → {formatPrice(r.value)}
              </p>
              {(() => {
                const sale = saleOf(r, rates);
                return (
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                    Sell now: {formatPrice(sale.charges)} charges · you&apos;d get {formatPrice(sale.receive)} ·{" "}
                    <span className={cn("font-medium", tone(sale.net))}>{signed(sale.net)} after charges</span>
                  </p>
                );
              })()}
            </li>
          );
        })}
      </ul>

      {/* Selling everything now. */}
      <div className="mt-4 rounded-xl bg-muted/60 p-3 text-sm" data-testid="sell-all">
        <p className="mb-1 font-semibold">If you sold everything now</p>
        <div className="flex justify-between gap-3 tabular-nums text-muted-foreground">
          <span>Worth</span>
          <span>{formatPrice(rows.reduce((t, r) => t + r.value, 0))}</span>
        </div>
        <div className="flex justify-between gap-3 tabular-nums text-muted-foreground">
          <span>− Charges (brokerage, STT, DP, GST…)</span>
          <span>{formatPrice(all.charges)}</span>
        </div>
        <div className="mt-1 flex justify-between gap-3 border-t pt-1 font-semibold tabular-nums">
          <span>You&apos;d get</span>
          <span>{formatPrice(all.receive)}</span>
        </div>
        <div className="flex justify-between gap-3 tabular-nums">
          <span className="text-muted-foreground">Profit after charges</span>
          <span className={cn("font-semibold", tone(all.net))}>{signed(all.net)}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Kotak Neo rates: delivery {(rates.deliveryRate * 100).toFixed(2)}% · DP {(rates.dpRate * 100).toFixed(2)}% (min {formatPrice(rates.dpMinMinor)}) + GST, plus
          STT and exchange charges.{" "}
          <button type="button" onClick={() => setEditing(true)} className="font-medium text-foreground underline-offset-2 hover:underline">
            Change
          </button>
        </p>
      </div>
      {editing && <RatesDialog rates={rates} onClose={() => setEditing(false)} />}
    </section>
  );
}

/** Your Kotak Neo charges, to match a contract note: brokerage and DP (the rest are the same at every broker). */
function RatesDialog({ rates, onClose }: { rates: BrokerRates; onClose: () => void }) {
  const [form, setForm] = useState({
    delivery: String(rates.deliveryRate * 100),
    intraday: String(rates.intradayRate * 100),
    cap: String(rates.intradayCapMinor / 100),
    dp: String(rates.dpRate * 100),
    dpMin: String(rates.dpMinMinor / 100),
  });
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const next: BrokerRates = {
    deliveryRate: num(form.delivery) / 100,
    intradayRate: num(form.intraday) / 100,
    intradayCapMinor: Math.round(num(form.cap) * 100),
    dpRate: num(form.dp) / 100,
    dpMinMinor: Math.round(num(form.dpMin) * 100),
  };
  const valid = Object.values(next).every((v) => Number.isFinite(v) && v >= 0);
  const field = (key: keyof typeof form, label: string, unit: string) => (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex items-center gap-2">
        <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} inputMode="decimal" className="min-w-0 flex-1" />
        <span className="w-6 text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kotak Neo charges</DialogTitle>
          <DialogDescription>As on your contract note. STT, exchange, SEBI, stamp duty and GST are added the same as at any broker.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {field("delivery", "Delivery brokerage", "%")}
          <div className="grid grid-cols-2 gap-3">
            {field("intraday", "Intraday brokerage", "%")}
            {field("cap", "…but at most", "₹")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {field("dp", "DP charge on a sale", "%")}
            {field("dpMin", "…at least", "₹")}
          </div>
        </div>
        <div className="mt-2 flex justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setKotakRates(null);
              onClose();
            }}
          >
            Use published rates
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              setKotakRates(next);
              onClose();
            }}
          >
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Published (Nov 2026): delivery {KOTAK_NEO_RATES.deliveryRate * 100}%, intraday {KOTAK_NEO_RATES.intradayRate * 100}% up to ₹{KOTAK_NEO_RATES.intradayCapMinor / 100}, DP{" "}
          {KOTAK_NEO_RATES.dpRate * 100}% (min ₹{KOTAK_NEO_RATES.dpMinMinor / 100}).
        </p>
      </DialogContent>
    </Dialog>
  );
}
