"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/cloud/client";
import { appStorage } from "@/lib/cloud/sync";
import { recordKotakFunds, recordKotakPositions, useKotakPositions } from "@/lib/brokers/kotak-store";
import type { KotakHolding, KotakPosition, KotakSync, KotakTrade } from "@/lib/brokers/kotak-neo";
import { formatPrice } from "@/lib/finance/describe";
import type { TradeEvent } from "@/lib/finance/types";
import { buildJournal } from "@/lib/trading/journal";
import { brokerCharges } from "@/lib/trading/charges";
import { useKotakRates } from "@/lib/brokers/kotak-charges";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { SIDE_TONE } from "./trade-form";
import { useLtp } from "./use-ltp";

/** A trade from Kotak, and whether it's already in your entries (by Kotak's reference, or the same order typed in). */
interface Row extends KotakTrade {
  already: boolean;
}

/**
 * Sync from Kotak Neo: with the day's TOTP and your MPIN, the server reads your trade book and holdings (read only).
 * New trades are added as orders (charges estimated as for orders you type in); holdings are compared with yours.
 */
export function KotakSyncButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="kotak-sync">
        <RefreshCw className="size-4" /> Sync Kotak Neo
      </Button>
      {open && <KotakSyncDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The MPIN, when you ask for it to be remembered: in this browser only (localStorage, outside the synced
 * "money-manager" keys, so never sent to the cloud or other devices). Logging in still needs the day's TOTP.
 */
const MPIN_KEY = "kotak-neo:mpin";
/** The bank or cash account Kotak trades settle in: synced, like your other settings. */
const ACCOUNT_KEY = "money-manager:v1:kotak-account";

/** The day's Kotak session, sealed by the server (only it can read it): this browser only, gone at day's end. */
const SESSION_KEY = "kotak-neo:session";

const readLocal = (key: string) => {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};
const writeLocal = (key: string, value: string | null) => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode: not kept */
  }
};

/**
 * What a sync or refresh brings, put where it shows: the day's positions, and Kotak's balance as the "Kotak Neo"
 * account (made the first time). Both are synced, so every page and device shows them. Returns the account's id.
 */
function applyKotak(f: ReturnType<typeof useFinance>, data: KotakSync): string | null {
  recordKotakPositions(f.today, { positions: data.positions ?? [], trades: data.trades ?? [], holdings: data.holdings ?? [], funds: data.funds ?? null });
  if (!data.funds) return null;
  const existing = f.book.accounts.find((a) => a.type === "bank" && a.name.trim().toLowerCase() === "kotak neo");
  const created = existing ? null : f.addAccount({ name: "Kotak Neo", type: "bank", openingBalanceMinor: 0, openedOn: f.today });
  const id = existing?.id ?? (created?.ok ? created.value.id : null);
  if (id) recordKotakFunds(id, f.today, data.funds.availableMinor);
  return id;
}

/** How often the balance refreshes while the app is open (and when you come back to it). */
const REFRESH_MS = 5 * 60_000;
/** Ask the refresher to run now (the card's refresh button). */
const REFRESH_EVENT = "kotak-neo:refresh";

/** Whether a refresh is running, for the card's spinner. */
let refreshingNow = false;
const refreshListeners = new Set<() => void>();
function setRefreshing(on: boolean) {
  refreshingNow = on;
  for (const l of refreshListeners) l();
}
function useRefreshing(): boolean {
  return useSyncExternalStore(
    (l) => {
      refreshListeners.add(l);
      return () => refreshListeners.delete(l);
    },
    () => refreshingNow,
    () => false,
  );
}

/** Kotak's trades, each marked if it's already in your entries (by Kotak's reference, or the same order typed in). */
function matchTrades(book: ReturnType<typeof useFinance>["book"], kotak: KotakTrade[]): Row[] {
  const trades = book.events.filter((e): e is TradeEvent => e.type === "trade");
  const nameOf = (id: string) => book.accounts.find((a) => a.id === id)?.name.toUpperCase() ?? "";
  const used = new Set<string>();
  return kotak.map((t) => {
    const match = trades.find(
      (e) =>
        !used.has(e.id) &&
        (e.brokerRef === t.ref ||
          (!e.brokerRef && e.date === t.date && e.side === t.side && e.quantity === t.quantity && e.priceMinor === t.priceMinor && nameOf(e.holdingId) === t.symbol)),
    );
    if (match) used.add(match.id);
    return { ...t, already: !!match };
  });
}

/**
 * Keeps your Kotak balance and positions fresh all day: after the morning's sync (TOTP), every few minutes while the
 * app is open and whenever you come back to it, with the day's sealed session. When it ends, it stops until the
 * next sync. Renders nothing.
 */
export function KotakAutoRefresh() {
  const f = useFinance();
  const fRef = useRef(f);
  fRef.current = f;
  const ready = f.status === "ready";
  useEffect(() => {
    if (!ready) return;
    let last = 0;
    let running = false;
    let autoOff = false;
    const run = async (asked = false) => {
      const session = readLocal(SESSION_KEY);
      if ((!session && autoOff && !asked) || running || document.visibilityState !== "visible") return;
      running = true;
      last = Date.now();
      setRefreshing(true);
      try {
        const res = await authFetch("/api/brokers/kotak", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(session ? { session, today: fRef.current.today } : { auto: true, today: fRef.current.today }),
        });
        if (res.status === 401 || res.status === 503) {
          // Ended, and the server can't log in by itself: wait for a sync with a TOTP.
          writeLocal(SESSION_KEY, null);
          autoOff = true;
        } else if (res.ok) {
          const data = (await res.json()) as KotakSync & { session?: string | null };
          if (typeof data.session === "string") writeLocal(SESSION_KEY, data.session);
          applyKotak(fRef.current, data);
        }
      } catch {
        /* offline: try again later */
      }
      running = false;
      setRefreshing(false);
    };
    void run();
    const timer = setInterval(() => void run(), REFRESH_MS);
    const onShow = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 60_000) void run();
    };
    document.addEventListener("visibilitychange", onShow);
    const onAsk = () => void run(true);
    window.addEventListener(REFRESH_EVENT, onAsk);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener(REFRESH_EVENT, onAsk);
    };
  }, [ready]);
  return null;
}

function KotakSyncDialog({ onClose }: { onClose: () => void }) {
  const f = useFinance();
  const money = f.book.accounts.filter((a) => a.type === "bank" || a.type === "cash");
  const lastTrade = [...f.book.events].reverse().find((e): e is TradeEvent => e.type === "trade");
  const saved = readLocal(ACCOUNT_KEY);
  const [accountId, setAccountIdOnly] = useState(
    (money.some((a) => a.id === saved) ? saved : "") || lastTrade?.accountId || money.find((a) => a.type === "bank")?.id || money[0]?.id || "",
  );
  const setAccountId = (id: string) => {
    setAccountIdOnly(id);
    appStorage.setItem(ACCOUNT_KEY, id);
  };
  const [totp, setTotp] = useState("");
  const [mpin, setMpin] = useState(() => readLocal(MPIN_KEY));
  const [remember, setRemember] = useState(() => !!readLocal(MPIN_KEY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KotakSync | null>(null);
  // Whether the server logs in by itself (TOTP secret and MPIN set there): then there's nothing to type.
  const [auto, setAuto] = useState<boolean | null>(null);
  useEffect(() => {
    void authFetch("/api/brokers/kotak")
      .then((r) => (r.ok ? r.json() : { auto: false }))
      .then((d: { auto?: boolean }) => setAuto(!!d.auto))
      .catch(() => setAuto(false));
  }, []);
  const [added, setAdded] = useState<number | null>(null);
  const rates = useKotakRates();

  /** Keeps (this browser only) or forgets the MPIN, as the tick box says. */
  const keepMpin = (keep: boolean) => {
    try {
      if (keep) window.localStorage.setItem(MPIN_KEY, mpin);
      else window.localStorage.removeItem(MPIN_KEY);
    } catch {
      /* private mode: just not remembered */
    }
  };

  const sync = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/api/brokers/kotak", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(auto ? { auto: true, today: f.today } : { totp, mpin, today: f.today }),
      });
      const data = (await res.json().catch(() => ({}))) as KotakSync & { message?: string; session?: string | null };
      if (!res.ok) {
        const message = data.message ?? "Couldn't sync with Kotak Neo.";
        // Kotak took the MPIN when the failure came after it (not the login or the MPIN check): keep it if asked.
        if (remember && !/^(Login|MPIN check)\b/.test(message) && res.status !== 400) keepMpin(true);
        if (/^MPIN check\b/.test(message)) keepMpin(false);
        throw new Error(message);
      }
      setResult(data);
      // The day's session (sealed by the server), kept in this browser so the balance refreshes all day by itself.
      if (typeof data.session === "string") writeLocal(SESSION_KEY, data.session);
      const id = applyKotak(f, data);
      // Trades settle in the Kotak account, unless you chose another.
      if (id && !readLocal(ACCOUNT_KEY)) setAccountId(id);
      // Remembered (this browser only) when asked; otherwise forgotten.
      keepMpin(remember);
      if (!remember) setMpin("");
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  // Already in your entries: added by an earlier sync (Kotak's reference), or typed in (same day, stock, side, qty, price).
  const rows = useMemo<Row[]>(() => (result ? matchTrades(f.book, result.trades) : []), [result, f.book]);
  const fresh = rows.filter((r) => !r.already);

  const addAll = () => {
    setError(null);
    let count = 0;
    const dpCharged = new Set<string>();
    for (const t of [...fresh].sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))) {
      const holdingId = f.resolveInvestment(t.symbol, t.product);
      if (!holdingId) continue;
      const valueMinor = t.quantity * t.priceMinor;
      // DP is charged once per stock per day on delivery sells.
      const dayKey = `${holdingId}|${t.date}`;
      const dpAlreadyCharged = dpCharged.has(dayKey) || f.book.events.some((e) => e.type === "trade" && e.holdingId === holdingId && e.side === "sell" && e.date === t.date);
      if (t.side === "sell") dpCharged.add(dayKey);
      const charges = brokerCharges({ product: t.product, side: t.side, valueMinor, exchange: t.exchange, dpAlreadyCharged }, rates);
      const r = f.addEvent({
        type: "trade",
        date: t.date,
        ...(t.time ? { time: t.time } : {}),
        holdingId,
        side: t.side,
        quantity: t.quantity,
        priceMinor: t.priceMinor,
        chargesMinor: charges.total,
        accountId,
        exchange: t.exchange,
        brokerRef: t.ref,
        note: "From Kotak Neo",
      });
      if (r.ok) count++;
      else setError(r.issues[0]?.message ?? `Couldn't add the ${t.symbol} order.`);
    }
    setAdded(count);
  };

  // Your delivery holdings in the app, by stock, to compare with Kotak's.
  const yours = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of buildJournal(f.book, f.ledger).positions) if (p.product === "delivery" && p.quantity > 0) m.set(p.symbol.toUpperCase(), (m.get(p.symbol.toUpperCase()) ?? 0) + p.quantity);
    return m;
  }, [f.book, f.ledger]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="kotak-sync-dialog">
        <DialogHeader>
          <DialogTitle>Sync Kotak Neo</DialogTitle>
          <DialogDescription>Reads your funds, today&apos;s trades and your holdings. Read only: nothing is ever bought or sold.</DialogDescription>
        </DialogHeader>

        {!result ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void sync();
            }}
          >
            {auto === false && (
              <>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">TOTP</span>
              <Input value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 digits from your authenticator app" autoFocus />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">MPIN</span>
              <Input value={mpin} onChange={(e) => setMpin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" type="password" autoComplete="off" placeholder="Your Kotak Neo MPIN (usually 6 digits)" />
            </label>
              </>
            )}
            {auto && <p className="rounded-xl bg-muted/60 p-3 text-sm">Logs in by itself: nothing to type.</p>}
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Money goes from / to</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 rounded-md border bg-card px-2 text-sm">
                {money.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {auto === false && (
              <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-emerald-600" />
              <span>Remember MPIN on this device</span>
              {readLocal(MPIN_KEY) && (
                <button
                  type="button"
                  className="ml-auto text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    try {
                      window.localStorage.removeItem(MPIN_KEY);
                    } catch {
                      /* nothing to forget */
                    }
                    setRemember(false);
                    setMpin("");
                  }}
                >
                  Forget
                </button>
              )}
            </label>
            <p className="text-xs text-muted-foreground">
              {remember ? "Your MPIN stays in this browser only (never synced). Each sync still needs the day's TOTP." : "The TOTP and MPIN are used for this sync only, never saved."}
            </p>
              </>
            )}
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <Button type="submit" disabled={busy || auto === null || (!auto && (totp.length !== 6 || mpin.length < 4)) || !accountId}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Sync
            </Button>
          </form>
        ) : (
          <div className="grid gap-4">
            {result.funds && (
              <div className="rounded-xl border p-3" data-testid="kotak-funds">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Funds in Kotak</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums">{formatPrice(result.funds.availableMinor)}</p>
                <p className="text-xs text-muted-foreground">Available to trade · shown as Kotak Neo on the Money page</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Margin used</dt>
                  <dd className="text-right tabular-nums">{formatPrice(result.funds.marginUsedMinor)}</dd>
                  {result.funds.collateralMinor > 0 && (
                    <>
                      <dt className="text-muted-foreground">Collateral (pledged)</dt>
                      <dd className="text-right tabular-nums">{formatPrice(result.funds.collateralMinor)}</dd>
                    </>
                  )}
                  {(result.funds.payInMinor > 0 || result.funds.payOutMinor > 0) && (
                    <>
                      <dt className="text-muted-foreground">Added / withdrawn today</dt>
                      <dd className="text-right tabular-nums">
                        {formatPrice(result.funds.payInMinor)} / {formatPrice(result.funds.payOutMinor)}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            )}
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Today&apos;s trades</p>
              {rows.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No trades today{result.skipped ? ` (${result.skipped} in F&O or other segments, not tracked here)` : ""}.</p>
              ) : (
                <ul className="divide-y">
                  {rows.map((t) => (
                    <li key={t.ref} className={cn("flex items-center justify-between gap-3 py-2", t.already && "opacity-50")}>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          <span className={cn("mr-1.5 rounded px-1.5 py-px text-[10px] font-semibold uppercase", SIDE_TONE[t.side].solid)}>{t.side}</span>
                          {t.symbol}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t.product === "intraday" ? "Intraday (MIS)" : "Longterm (CNC)"} · {t.exchange}
                          {t.time ? ` · ${t.time.slice(0, 5)}` : ""}
                          {t.already ? " · already in your entries" : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {t.quantity} × {formatPrice(t.priceMinor)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {added !== null ? (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
                  <Check className="size-4" /> Added {added} {added === 1 ? "order" : "orders"}. Charges are worked out with your Kotak Neo rates; edit an order to change them.
                </p>
              ) : fresh.length > 0 ? (
                <Button className="mt-2 w-full" onClick={addAll}>
                  Add {fresh.length} new {fresh.length === 1 ? "order" : "orders"}
                </Button>
              ) : rows.length > 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">All of today&apos;s trades are already in your entries.</p>
              ) : null}
              {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
            </div>

            <KotakPositionsList positions={result.positions ?? []} />
            <Holdings holdings={result.holdings} yours={yours} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Kotak's holdings against yours: the same stocks, the same quantities (or what differs). */
function Holdings({ holdings, yours }: { holdings: KotakHolding[]; yours: Map<string, number> }) {
  if (holdings.length === 0) return <p className="text-sm text-muted-foreground">No holdings in your Kotak demat account.</p>;
  const total = holdings.reduce((t, h) => t + h.valueMinor, 0);
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Holdings in Kotak</p>
      <ul className="divide-y">
        {holdings.map((h) => {
          const mine = yours.get(h.symbol) ?? 0;
          return (
            <li key={h.symbol} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm font-medium">{h.symbol}</span>
                <span className={cn("block text-xs", mine === h.quantity ? "text-muted-foreground" : "text-amber-600")}>
                  {h.quantity} at {formatPrice(h.avgPriceMinor)} avg
                  {mine === h.quantity ? " · matches yours" : ` · you have ${mine} in the app`}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatPrice(h.valueMinor)}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex justify-between border-t pt-2 text-sm font-semibold">
        <span>Total value</span>
        <span className="tabular-nums">{formatPrice(total)}</span>
      </div>
    </div>
  );
}

const signed = (minor: number) => `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${formatPrice(Math.abs(minor))}`;

/** Kotak's positions for the day: open ones first (what you hold or are short), then closed ones with their P&L. */
export function KotakPositionsList({ positions, total = true }: { positions: KotakPosition[]; total?: boolean }) {
  const open = positions.filter((p) => p.netQty !== 0);
  const closed = positions.filter((p) => p.netQty === 0);
  const booked = positions.reduce((t, p) => t + p.realizedMinor, 0);
  if (positions.length === 0) return <p className="text-sm text-muted-foreground">No positions today.</p>;
  const row = (p: KotakPosition) => (
    <li key={`${p.symbol}-${p.market}-${p.product}`} className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{p.symbol}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {p.product} · {p.market}
          {p.buyQty > 0 && ` · bought ${p.buyQty} at ${formatPrice(p.buyAvgMinor)}`}
          {p.sellQty > 0 && ` · sold ${p.sellQty} at ${formatPrice(p.sellAvgMinor)}`}
        </span>
      </span>
      <span className="shrink-0 text-right text-sm tabular-nums">
        {p.netQty !== 0 && <span className="block font-semibold">{p.netQty > 0 ? `${p.netQty} held` : `${-p.netQty} short`}</span>}
        {Math.min(p.buyQty, p.sellQty) > 0 && (
          <span className={cn("block font-semibold", p.realizedMinor > 0 ? "text-emerald-600" : p.realizedMinor < 0 ? "text-rose-600" : "text-muted-foreground")}>{signed(p.realizedMinor)}</span>
        )}
      </span>
    </li>
  );
  return (
    <div className="grid gap-3" data-testid="kotak-positions">
      {open.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open positions</p>
          <ul className="divide-y">{open.map(row)}</ul>
        </div>
      )}
      {closed.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Closed positions</p>
          <ul className="divide-y">{closed.map(row)}</ul>
        </div>
      )}
      {total && <div className="flex justify-between border-t pt-2 text-sm font-semibold">
        <span>Booked today (before charges)</span>
        <span className={cn("tabular-nums", booked > 0 ? "text-emerald-600" : booked < 0 ? "text-rose-600" : undefined)}>{signed(booked)}</span>
      </div>}
    </div>
  );
}

/** An investment that's really your broker account ("Secu", "Kotak Sec", "Kotak Securities", "Kotak Neo"). */
const BROKER_HOLDING = /^(kotak\s*)?(secu(rities)?|sec)\b|^kotak\s*(sec|neo)/i;

/** "just now", "4 min ago", "2:15 pm". */
function ago(at: string, now: number): string {
  const min = Math.floor((now - Date.parse(at)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

/**
 * The top of the Invest page: your Kotak Neo account at a glance. Funds, margin, today's booked P&L and holdings,
 * when it was last updated (it refreshes by itself), new trades not yet in your entries, and today's positions.
 */
export function KotakCard() {
  const f = useFinance();
  const rec = useKotakPositions();
  const refreshing = useRefreshing();
  const [dialog, setDialog] = useState(false);
  const [showPositions, setShowPositions] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const todays = rec && rec.date === f.today ? rec : null;
  const fresh = useMemo(() => (todays?.trades ? matchTrades(f.book, todays.trades).filter((t) => !t.already) : []), [todays, f.book]);
  const booked = todays ? todays.positions.reduce((t, p) => t + p.realizedMinor, 0) : 0;
  const holdingsValue = todays?.holdings?.reduce((t, h) => t + h.valueMinor, 0) ?? 0;
  const openCount = todays ? todays.positions.filter((p) => p.netQty !== 0).length : 0;

  // What's invested: shares held (today's open buys, and holdings from before), each at its buy price and now.
  const invested = useMemo(() => {
    const out: { symbol: string; qty: number; costMinor: number }[] = [];
    for (const p of todays?.positions ?? []) if (p.netQty > 0 && (p.market === "NSE" || p.market === "BSE")) out.push({ symbol: p.symbol, qty: p.netQty, costMinor: p.buyAvgMinor * p.netQty });
    for (const h of todays?.holdings ?? []) if (!out.some((o) => o.symbol === h.symbol)) out.push({ symbol: h.symbol, qty: h.quantity, costMinor: h.avgPriceMinor * h.quantity });
    return out;
  }, [todays]);
  const { ltp } = useLtp(invested.map((i) => i.symbol), 60_000);
  const closeOf = (symbol: string) => todays?.holdings?.find((h) => h.symbol === symbol)?.closePriceMinor ?? null;
  const costMinor = invested.reduce((t, i) => t + i.costMinor, 0);
  const nowMinor = invested.reduce((t, i) => t + (ltp(i.symbol) ?? closeOf(i.symbol) ?? i.costMinor / i.qty) * i.qty, 0);
  const cashMinor = todays?.funds?.availableMinor ?? 0;
  // Money you put in: transfers into the Kotak Neo account less what came back out; else cash left plus invested.
  const addedMinor = useMemo(() => {
    const id = f.book.accounts.find((a) => a.type === "bank" && /^kotak neo$/i.test(a.name.trim()))?.id;
    if (!id) return null;
    const net = f.book.events.reduce((t, e) => (e.type === "transfer" ? t + (e.toAccountId === id ? e.amountMinor : 0) - (e.fromAccountId === id ? e.amountMinor : 0) : t), 0);
    return net > 0 ? net : null;
  }, [f.book]);
  const putIn = addedMinor ?? cashMinor + costMinor;
  const accountMinor = cashMinor + nowMinor;
  const live = !!todays && now - Date.parse(todays.at) < 15 * 60_000;

  // Money sent to the broker that was filed as buying an investment ("Secu", "Kotak Securities"): really a transfer
  // into your Kotak account, so the shares bought with it were counted twice.
  const kotakId = f.book.accounts.find((a) => a.type === "bank" && /^kotak neo$/i.test(a.name.trim()))?.id;
  const misfiled = useMemo(() => {
    const holdings = f.book.accounts.filter((a) => a.type === "investment" && !a.style && BROKER_HOLDING.test(a.name.trim()));
    const ids = new Set(holdings.map((a) => a.id));
    const events = f.book.events.filter((e) => (e.type === "invest" || e.type === "sell_investment") && ids.has(e.holdingId));
    return { holdings, events, inMinor: events.reduce((t, e) => (e.type === "invest" ? t + e.amountMinor : t), 0) };
  }, [f.book]);
  const fixMisfiled = () => {
    if (!kotakId) return;
    for (const e of misfiled.events) {
      const base = { date: e.date, ...(e.description ? { description: e.description } : {}), ...(e.note ? { note: e.note } : {}) };
      if (e.type === "invest") f.updateEvent(e.id, { ...base, type: "transfer", fromAccountId: e.fromAccountId, toAccountId: kotakId, amountMinor: e.amountMinor });
      else if (e.type === "sell_investment") f.updateEvent(e.id, { ...base, type: "transfer", fromAccountId: kotakId, toAccountId: e.toAccountId, amountMinor: e.proceedsMinor });
    }
    // The holding is empty now: remove it (with any value updates left on it).
    for (const h of misfiled.holdings) {
      if (!f.book.events.some((e) => !misfiled.events.includes(e) && "holdingId" in e && e.holdingId === h.id && e.type !== "update_valuation")) f.deleteAccount(h.id, { withEntries: true });
    }
  };

  return (
    <section className="rounded-3xl border glass p-4 sm:p-5" data-testid="kotak-card">
      <div className="flex items-center gap-3">
        <span className="palette-fixed flex h-10 w-14 shrink-0 items-center justify-center rounded-xl border border-slate-200/80 bg-white p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brands/bank-kotak.svg" alt="Kotak" className="h-full w-full object-contain" onError={(e) => (e.currentTarget.style.display = "none")} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Kotak Neo</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <span className={cn("size-1.5 shrink-0 rounded-full", live ? "bg-emerald-500" : todays ? "bg-amber-500" : "bg-muted-foreground/40")} aria-hidden />
            {refreshing ? "Updating…" : todays ? `Updated ${ago(todays.at, now)} · refreshes by itself` : "Not synced today"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh now"
          title="Refresh now"
          disabled={refreshing}
          onClick={() => window.dispatchEvent(new Event(REFRESH_EVENT))}
        >
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setDialog(true)} data-testid="kotak-sync">
          Sync
        </Button>
      </div>

      {todays ? (
        <>
          {/* The account at a glance: what it's worth, and against what you put in. */}
          <div className="mt-4">
            <p className="text-xs text-muted-foreground">Account value</p>
            <p className="text-2xl font-semibold tabular-nums">{formatPrice(accountMinor)}</p>
            {putIn > 0 && (
              <p className={cn("text-sm font-medium tabular-nums", accountMinor - putIn > 0 ? "text-emerald-600" : accountMinor - putIn < 0 ? "text-rose-600" : "text-muted-foreground")}>
                {signed(accountMinor - putIn)} ({accountMinor - putIn < 0 ? "−" : "+"}{((Math.abs(accountMinor - putIn) / putIn) * 100).toFixed(2)}%) on {formatPrice(putIn)} put in
              </p>
            )}
          </div>

          {/* Where the money is: added, invested, cash left, and how it splits. */}
          <div className="mt-3 grid grid-cols-3 gap-2" data-testid="kotak-statement">
            <Tile label={addedMinor ? "Added" : "In account"} value={formatPrice(putIn)} />
            <Tile label="Invested" value={formatPrice(costMinor)} accent="bg-blue-500" />
            <Tile label="Cash left" value={formatPrice(cashMinor)} accent="bg-emerald-500" />
          </div>
          {putIn > 0 && (
            <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`Invested ${formatPrice(costMinor)}, cash ${formatPrice(cashMinor)}`}>
              <span className="bg-blue-500" style={{ width: `${Math.min(100, (costMinor / putIn) * 100)}%` }} />
              <span className="bg-emerald-500" style={{ width: `${Math.min(100, (cashMinor / putIn) * 100)}%` }} />
            </div>
          )}

          {/* Each stock: bought at, now, worth and gain. */}
          {invested.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {invested.map((i) => {
                const price = ltp(i.symbol) ?? closeOf(i.symbol);
                const now = price !== null ? price * i.qty : i.costMinor;
                const gain = now - i.costMinor;
                return (
                  <div key={i.symbol} className="rounded-xl border bg-card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{i.symbol}</p>
                        <p className="truncate text-xs text-muted-foreground tabular-nums">
                          {i.qty} × {formatPrice(Math.round(i.costMinor / i.qty))}
                          {price !== null && <> → {formatPrice(price)}</>}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                          gain > 0 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : gain < 0 ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {i.costMinor ? `${gain < 0 ? "−" : "+"}${((Math.abs(gain) / i.costMinor) * 100).toFixed(2)}%` : "—"}
                      </span>
                    </div>
                    <div className="mt-2 flex items-end justify-between gap-2 tabular-nums">
                      <div>
                        <p className="text-[11px] text-muted-foreground">Worth now</p>
                        <p className="font-semibold">{formatPrice(now)}</p>
                      </div>
                      <p className={cn("text-sm font-semibold", gain > 0 ? "text-emerald-600" : gain < 0 ? "text-rose-600" : "text-muted-foreground")}>{signed(gain)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Figure label="Booked today" value={signed(booked)} tone={booked > 0 ? "up" : booked < 0 ? "down" : undefined} hint="before charges" />
            <Figure label="Margin used" value={todays.funds ? formatPrice(todays.funds.marginUsedMinor) : "—"} hint={holdingsValue ? `Holdings ${formatPrice(holdingsValue)}` : undefined} />
          </dl>

          {fresh.length > 0 && (
            <button
              type="button"
              onClick={() => setDialog(true)}
              className="palette-fixed mt-4 flex w-full items-center justify-between gap-3 rounded-xl bg-emerald-600 px-3 py-2.5 text-left text-sm text-white shadow-sm hover:bg-emerald-700"
            >
              <span>
                <strong className="font-semibold">
                  {fresh.length} {fresh.length === 1 ? "trade" : "trades"}
                </strong>{" "}
                in Kotak {fresh.length === 1 ? "isn't" : "aren't"} in your entries yet
              </span>
              <span className="flex shrink-0 items-center gap-1 font-semibold">
                <Plus className="size-4" /> Add
              </span>
            </button>
          )}

          {kotakId && misfiled.events.length > 0 && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm" data-testid="kotak-misfiled">
              <span className="min-w-0">
                <strong className="font-semibold">{formatPrice(misfiled.inMinor)}</strong> sent to &ldquo;{misfiled.holdings.map((h) => h.name).join(", ")}&rdquo; was money added to Kotak, not an investment, so it&apos;s counted twice.
              </span>
              <Button size="sm" className="shrink-0" onClick={fixMisfiled}>
                Fix
              </Button>
            </div>
          )}

          {todays.positions.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <button type="button" onClick={() => setShowPositions((v) => !v)} className="flex w-full items-center justify-between text-sm font-semibold" aria-expanded={showPositions}>
                <span>
                  Today&apos;s positions · {todays.positions.length}
                  {openCount > 0 && <span className="font-normal text-muted-foreground"> ({openCount} open)</span>}
                </span>
                <ChevronDown className={cn("size-4 transition-transform", showPositions && "rotate-180")} />
              </button>
              {showPositions && (
                <div className="mt-2">
                  <KotakPositionsList positions={todays.positions} total={false} />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Sync once to see your funds, today&apos;s positions and holdings here. After that it keeps itself up to date.</p>
      )}

      {dialog && <KotakSyncDialog onClose={() => setDialog(false)} />}
    </section>
  );
}

/** A small figure tile: a label (with a colour mark) and an amount. */
function Tile({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card px-2.5 py-2">
      <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
        {accent && <span className={cn("size-2 shrink-0 rounded-full", accent)} aria-hidden />}
        {label}
      </p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Figure({ label, value, hint, strong, tone }: { label: string; value: string; hint?: string; strong?: boolean; tone?: "up" | "down" }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-semibold tabular-nums", strong ? "text-xl" : "text-base", tone === "up" && "text-emerald-600", tone === "down" && "text-rose-600")}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
