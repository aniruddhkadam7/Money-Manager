"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronDown, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayISO } from "@/lib/domain/dates";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import { formatPrice } from "@/lib/finance/describe";
import { fill } from "@/lib/finance/fifo";
import type { TradeEvent, TradeSide, TradeStyle } from "@/lib/finance/types";
import { zerodhaCharges, type ChargeBreakdown } from "@/lib/trading/charges";
import { buildJournal } from "@/lib/trading/journal";
import { cn } from "@/lib/utils";
import { AccountField } from "../events/event-form";
import { useFinance } from "../finance-provider";
import { StockSearch } from "./stock-search";
import { StylePicker } from "./style-picker";
import { useLtp } from "./use-ltp";

/** What opens the order window already filled in: "Exit" on a position, say, or Buy from a holding. */
export interface TradePreset {
  side?: TradeSide;
  holdingId?: string;
  quantity?: number;
  style?: TradeStyle;
}

/** Zerodha's colours: blue to buy, orange-red to sell. */
export const SIDE_TONE = {
  buy: { solid: "bg-[#4184f3] hover:bg-[#3474e0] text-white", text: "text-[#4184f3]", soft: "bg-[#4184f3]/10 text-[#2f6fd8]" },
  sell: { solid: "bg-[#ff5722] hover:bg-[#ec4a17] text-white", text: "text-[#ff5722]", soft: "bg-[#ff5722]/10 text-[#e04712]" },
} as const;

const nowTime = () => new Date().toTimeString().slice(0, 8);

const CHARGE_ROWS: [keyof ChargeBreakdown, string][] = [
  ["brokerage", "Brokerage"],
  ["stt", "STT"],
  ["exchange", "Exchange charges"],
  ["sebi", "SEBI fee"],
  ["gst", "GST"],
  ["stamp", "Stamp duty"],
  ["dp", "DP charge"],
];

/**
 * The order window for a stock trade, laid out like a broker's: Buy or Sell, the stock, MIS or CNC, quantity and
 * price, when, and from which account. Below, the order's value, Zerodha's charges (worked out, editable) and,
 * when it closes shares, the profit it books.
 */
export function TradeForm({
  editing,
  template,
  preset,
  onBack,
  onSaved,
}: {
  editing?: TradeEvent;
  /** A new order copied from this one (Duplicate). */
  template?: TradeEvent;
  preset?: TradePreset;
  onBack?: () => void;
  onSaved: (eventId: string, wasEdit: boolean) => void;
}) {
  const f = useFinance();
  const from = editing ?? template;
  const accountOf = (id?: string) => (id ? f.book.accounts.find((a) => a.id === id) : undefined);
  const presetHolding = accountOf(preset?.holdingId ?? from?.holdingId);
  // A broker pays in and out of a bank account, so cash isn't offered (an older order that used it keeps it).
  const moneyAccounts = f.book.accounts.filter((a) => a.type === "bank" || a.id === from?.accountId);
  const lastTrade = [...f.book.events].reverse().find((e): e is TradeEvent => e.type === "trade");

  const [side, setSide] = useState<TradeSide>(preset?.side ?? from?.side ?? "buy");
  const [symbol, setSymbol] = useState(presetHolding?.name ?? "");
  const [exchange, setExchange] = useState<"NSE" | "BSE">(from?.exchange ?? "NSE");
  const [style, setStyle] = useState<TradeStyle | "">(preset?.style ?? presetHolding?.style ?? accountOf(lastTrade?.holdingId)?.style ?? "intraday");
  const [quantity, setQuantity] = useState(preset?.quantity ? String(preset.quantity) : from ? String(from.quantity) : "");
  const [price, setPrice] = useState(from ? minorToInputString(from.priceMinor) : "");
  const [priceTouched, setPriceTouched] = useState(!!from);
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [time, setTime] = useState(editing?.time ?? nowTime());
  const [accountId, setAccountId] = useState(
    from?.accountId ?? (moneyAccounts.some((a) => a.id === lastTrade?.accountId) ? lastTrade!.accountId : (moneyAccounts[0]?.id ?? "")),
  );
  const [chargesInput, setChargesInput] = useState<string | null>(editing ? minorToInputString(editing.chargesMinor) : null);
  const [showCharges, setShowCharges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Picked from the list (or already held): only then is it a real symbol worth asking a price for.
  const [picked, setPicked] = useState(!!presetHolding);

  const clean = symbol.trim().toUpperCase();
  const holding = f.book.accounts.find((a) => a.type === "investment" && a.style === style && a.name.toUpperCase() === clean);
  const qty = /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : null;
  const priceMinor = parseAmountToMinor(price);
  const valueMinor = qty && priceMinor ? qty * priceMinor : 0;

  // The position as it stands without this order (an edited order is left out, so it isn't counted twice).
  const position = useMemo(() => {
    if (!holding) return null;
    const book = editing ? { ...f.book, events: f.book.events.filter((e) => e.id !== editing.id) } : f.book;
    return buildJournal(book, f.ledger).positions.find((p) => p.holding.id === holding.id) ?? null;
  }, [holding, f.book, f.ledger, editing]);

  // Live price for the stock, to fill the price in when logging an order as it happens.
  const known = picked || f.book.accounts.some((a) => a.style && a.name.toUpperCase() === clean);
  const { ltp } = useLtp(known && clean ? [clean] : []);
  const last = known && clean ? ltp(clean) : null;
  // Logging an order as it happens: the price starts at the last traded price, until it's typed over.
  useEffect(() => {
    if (last !== null && !priceTouched && date === todayISO()) setPrice(minorToInputString(last));
  }, [last, priceTouched, date]);

  // DP is charged once per stock per day on delivery sells: not again if another sell that day already carries it.
  const dpAlreadyCharged =
    !!holding &&
    f.book.events.some((e) => e.type === "trade" && e.id !== editing?.id && e.holdingId === holding.id && e.side === "sell" && e.date === date);
  const breakdown = style ? zerodhaCharges({ product: style, side, valueMinor, exchange, dpAlreadyCharged }) : null;
  const chargesMinor = chargesInput !== null ? parseAmountToMinor(chargesInput, true) : (breakdown?.total ?? 0);

  const dir = side === "buy" ? 1 : -1;
  const preview = position && qty && priceMinor ? fill(position.lots, dir, qty, priceMinor) : null;
  const held = position?.quantity ?? 0;
  const cncShort = style === "delivery" && side === "sell" && qty !== null && qty > Math.max(held, 0);
  const tone = SIDE_TONE[side];

  function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!clean) return setError("Choose a stock.");
    if (!style) return setError("Choose Intraday (MIS) or Longterm (CNC).");
    if (!qty) return setError("Enter the quantity: a whole number of shares.");
    if (!priceMinor) return setError("Enter the price per share, e.g. 2850.50");
    if (chargesMinor === null) return setError("Enter the charges as an amount, or 0.");
    if (!accountId) return setError(`Choose the account the money ${side === "buy" ? "came from" : "went to"}.`);
    if (cncShort) return setError(held > 0 ? `You hold only ${held} ${clean} (CNC).` : `You don't hold any ${clean} (CNC). Only intraday (MIS) can be sold first.`);
    setSaving(true);
    const holdingId = f.resolveInvestment(clean, style);
    if (!holdingId) {
      setSaving(false);
      return setError("Couldn't set up that stock.");
    }
    const draft = {
      type: "trade" as const,
      date,
      ...(time ? { time } : {}),
      holdingId,
      side,
      quantity: qty,
      priceMinor,
      chargesMinor,
      accountId,
      exchange,
      ...(editing?.note ? { note: editing.note } : {}),
    };
    const result = editing ? f.updateEvent(editing.id, draft) : f.addEvent(draft);
    setSaving(false);
    if (!result.ok) return setError(result.issues[0]?.message ?? "Couldn't save that order.");
    onSaved(result.value, !!editing);
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3.5">
      <DialogHeader>
        <div className="flex items-center gap-2">
          {onBack && (
            <Button type="button" variant="ghost" size="icon" className="-ml-2" onClick={onBack} aria-label="Back">
              <ArrowLeft />
            </Button>
          )}
          <DialogTitle>{editing ? "Edit order" : "Stock order"}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Buy or sell shares, intraday or delivery</DialogDescription>
      </DialogHeader>

      {/* Buy | Sell */}
      <div role="radiogroup" aria-label="Buy or sell" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={side === s}
            onClick={() => setSide(s)}
            className={cn(
              "h-10 rounded-lg text-sm font-semibold uppercase tracking-wide transition-colors",
              side === s ? SIDE_TONE[s].solid : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="trade-symbol">Stock</Label>
          <div role="radiogroup" aria-label="Exchange" className="flex gap-1 text-xs">
            {(["NSE", "BSE"] as const).map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={exchange === x}
                onClick={() => setExchange(x)}
                className={cn("rounded px-2 py-0.5 font-semibold", exchange === x ? tone.soft : "text-muted-foreground")}
              >
                {x}
              </button>
            ))}
          </div>
        </div>
        <StockSearch
          id="trade-symbol"
          autoFocus={!editing && !presetHolding}
          value={symbol}
          onChange={(v) => {
            setSymbol(v.toUpperCase());
            setPicked(false);
            if (!from) setPriceTouched(false);
          }}
          onPick={(s) => {
            setExchange(s.exchange === "BSE" ? "BSE" : "NSE");
            setPicked(true);
          }}
          holdings={[...new Set(f.book.accounts.filter((a) => a.style).map((a) => a.name))]}
        />
        {position && position.quantity !== 0 && (
          <p className="text-xs text-muted-foreground">
            You&apos;re {position.quantity > 0 ? "holding" : "short"}{" "}
            <span className="font-medium text-foreground">
              {Math.abs(position.quantity)} @ {formatPrice(Math.abs(position.avgPriceMinor))}
            </span>{" "}
            ({style === "intraday" ? "MIS" : "CNC"})
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label>Product</Label>
        <StylePicker value={style} onChange={setStyle} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="trade-qty">Qty.</Label>
          <Input
            id="trade-qty"
            inputMode="numeric"
            autoComplete="off"
            autoFocus={!!presetHolding && !editing}
            placeholder="0"
            className="tabular-nums"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ""))}
          />
          {position && position.quantity !== 0 && Math.sign(position.quantity) === -dir && (
            <button type="button" className={cn("justify-self-start text-xs font-medium", tone.text)} onClick={() => setQuantity(String(Math.abs(position.quantity)))}>
              All {Math.abs(position.quantity)}
            </button>
          )}
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="trade-price">Price</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
            <Input
              id="trade-price"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className="pl-7 tabular-nums"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setPriceTouched(true);
              }}
            />
          </div>
          {last !== null && (
            <button
              type="button"
              className={cn("justify-self-start text-xs font-medium", tone.text)}
              onClick={() => {
                setPrice(minorToInputString(last));
                setPriceTouched(true);
              }}
            >
              LTP {formatPrice(last)}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="trade-date">Date</Label>
          <Input id="trade-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="grid content-start gap-1.5">
          <Label htmlFor="trade-time">Time</Label>
          <Input id="trade-time" type="time" step={1} value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>

      <AccountField
        id="trade-account"
        label={side === "buy" ? "Paid from" : "Received in"}
        value={accountId}
        onChange={setAccountId}
        accounts={moneyAccounts}
      />

      {/* The order in money: value, charges, what leaves or reaches the account, and the profit it books. */}
      <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 text-sm tabular-nums">
        <Row label="Order value" value={formatPrice(valueMinor)} />
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="flex items-center gap-1 text-muted-foreground" onClick={() => setShowCharges((v) => !v)} aria-expanded={showCharges}>
            Charges {chargesInput === null ? "(Zerodha)" : "(yours)"}
            <ChevronDown className={cn("size-3.5 transition-transform", showCharges && "rotate-180")} />
          </button>
          {chargesInput === null ? (
            <button type="button" className="flex items-center gap-1.5" onClick={() => setChargesInput(minorToInputString(breakdown?.total ?? 0))} aria-label="Edit charges">
              {formatPrice(chargesMinor ?? 0)} <Pencil className="size-3 text-muted-foreground" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setChargesInput(null)}>
                Auto
              </button>
              <Input aria-label="Charges" inputMode="decimal" className="h-8 w-24 text-right" value={chargesInput} onChange={(e) => setChargesInput(e.target.value)} />
            </div>
          )}
        </div>
        {showCharges && breakdown && (
          <div className="grid gap-1 border-l-2 pl-3 text-xs text-muted-foreground">
            {CHARGE_ROWS.filter(([k]) => breakdown[k] > 0).map(([k, label]) => (
              <Row key={k} label={label} value={formatPrice(breakdown[k])} />
            ))}
            {breakdown.total === 0 && <p>No charges on this order.</p>}
          </div>
        )}
      </div>

      {/* Pinned to the bottom of the sheet, so the order can be placed without scrolling: the total, what it books,
          anything stopping it, and the button. The negative margins reach the sheet's edges. */}
      <div className="sticky bottom-0 z-10 -mx-5 -mb-[calc(1.5rem+env(safe-area-inset-bottom))] grid gap-2 border-t bg-[var(--glass-solid)] px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-6">
        {cncShort && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {held > 0 ? `You hold only ${held} ${clean} in CNC.` : `You don't hold ${clean || "this stock"} in CNC.`} Only intraday (MIS) can be sold first.
          </p>
        )}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="flex items-baseline justify-between gap-3 text-sm tabular-nums">
          <span className="text-muted-foreground">
            {side === "buy" ? "Total debit" : "Net credit"}{" "}
            <span className="font-semibold text-foreground">
              {formatPrice(side === "buy" ? valueMinor + (chargesMinor ?? 0) : valueMinor - (chargesMinor ?? 0))}
            </span>
          </span>
          {preview && preview.closedQuantity > 0 && (
            <span className={cn("font-semibold", preview.grossMinor - (chargesMinor ?? 0) >= 0 ? "text-emerald-700" : "text-red-700")}>
              P&amp;L {signedPrice(preview.grossMinor - (chargesMinor ?? 0))}
            </span>
          )}
        </div>
        <Button type="submit" disabled={saving} className={cn("h-12 rounded-xl text-base font-semibold", tone.solid)}>
          {side === "buy" ? "Buy" : "Sell"}
          {qty && clean ? ` ${qty} ${clean}` : ""}
          {editing ? " · save" : ""}
        </Button>
      </div>
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(strong && "font-semibold")}>{value}</span>
    </div>
  );
}

export const signedPrice = (minor: number) => `${minor >= 0 ? "+" : "−"}${formatPrice(Math.abs(minor))}`;
