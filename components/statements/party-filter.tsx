"use client";

import { useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupees } from "@/lib/finance/describe";
import { looksLikePerson } from "@/lib/statements/normalize";
import type { StatementEventType, StatementRow } from "@/lib/statements/types";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";
import { EVENT_LABEL, optionsFor } from "./labels";
import { needs } from "./review-card";
import { useStatements } from "./statements-provider";

/**
 * Lines are grouped per counterparty and direction: paying Rahul and being paid by Rahul are different
 * questions. Banks truncate long names differently ("Pancharatna Sup" / "Pancharatna Su"), so a name that
 * is the start of another (at least 8 letters) counts as the same one.
 */
export function partyIndex(rows: StatementRow[]): (r: StatementRow) => string {
  const keys = [...new Set(rows.map((r) => r.normalized.counterpartyKey).filter(Boolean))].sort((a, b) => a.length - b.length);
  const canonical = new Map<string, string>();
  for (const k of keys) {
    const root = keys.find((other) => other.length >= 8 && other.length <= k.length && k.startsWith(other));
    canonical.set(k, root ?? k);
  }
  return (r) => `${r.direction}|${canonical.get(r.normalized.counterpartyKey) ?? (r.normalized.counterpartyKey || r.id)}`;
}


export interface PartyFilters {
  /** Money received, money paid, or both. */
  direction: "all" | "credit" | "debit";
  /** Individuals, businesses, or both. */
  who: "all" | "people" | "shops";
  sort: "count" | "amount";
  query: string;
  /** Also list names that appear only once. */
  oneOffs: boolean;
}

export const DEFAULT_FILTERS: PartyFilters = { direction: "all", who: "all", sort: "count", query: "", oneOffs: false };

export const filtersActive = (f: PartyFilters) => f.direction !== "all" || f.who !== "all" || f.query.trim() !== "";

const isPerson = (r: StatementRow) =>
  looksLikePerson(r.normalized.counterpartyKey, r.normalized.vpa) || r.classification?.eventType === "MONEY_LENT" || r.classification?.eventType === "LENDING_REPAYMENT";

/** Which lines the current filters let through (the one-offs option only shapes the ranking). */
export function lineMatches(r: StatementRow, f: PartyFilters): boolean {
  if (f.direction !== "all" && r.direction !== f.direction) return false;
  if (f.who === "people" && !isPerson(r)) return false;
  if (f.who === "shops" && isPerson(r)) return false;
  const q = f.query.trim().toLowerCase();
  if (q && !`${r.normalized.counterparty} ${r.rawDescription}`.toLowerCase().includes(q)) return false;
  return true;
}

export interface Party {
  key: string;
  name: string;
  direction: StatementRow["direction"];
  rows: StatementRow[];
  totalMinor: number;
}

/** Counterparties ranked by how often they appear, then by money moved. */
export function rankParties(rows: StatementRow[], sort: PartyFilters["sort"] = "count"): Party[] {
  const keyOf = partyIndex(rows);
  const map = new Map<string, Party>();
  for (const r of rows) {
    const key = keyOf(r);
    const p = map.get(key) ?? { key, name: r.normalized.counterparty || r.rawDescription.slice(0, 30), direction: r.direction, rows: [], totalMinor: 0 };
    p.rows.push(r);
    p.totalMinor += r.amountMinor;
    if ((r.normalized.counterparty || "").length > p.name.length) p.name = r.normalized.counterparty;
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) =>
    sort === "amount"
      ? b.totalMinor - a.totalMinor || b.rows.length - a.rows.length || a.name.localeCompare(b.name)
      : b.rows.length - a.rows.length || b.totalMinor - a.totalMinor || a.name.localeCompare(b.name),
  );
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors", value === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const PREVIEW = 6;

export function PartyRanking({
  parties,
  selected,
  onSelect,
  filters,
  onFilters,
  totalLines,
  shownLines,
}: {
  parties: Party[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  filters: PartyFilters;
  onFilters: (f: PartyFilters) => void;
  totalLines: number;
  shownLines: number;
}) {
  const [all, setAll] = useState(false);
  // Names ticked for answering together.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // One-offs are hidden to keep the list short, unless every name is a one-off (then hiding them hides everything).
  const repeats = parties.filter((p) => p.rows.length > 1);
  const list = filters.oneOffs || repeats.length === 0 ? parties : repeats;
  const shown = all ? list : list.slice(0, PREVIEW);
  const maxMinor = Math.max(1, ...shown.map((p) => p.totalMinor));
  const set = (patch: Partial<PartyFilters>) => onFilters({ ...filters, ...patch });
  const extraActive = filters.who !== "all" || filters.sort !== "count" || filters.oneOffs;
  const dirty = filtersActive(filters) || extraActive;

  return (
    <section className="rounded-2xl border bg-card p-4" data-testid="party-ranking" aria-label="Who you transact with most">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3" data-testid="party-filters">
        <div>
          <h3 className="text-sm font-semibold">{filters.sort === "amount" ? "Biggest by amount" : "Who you transact with most"}</h3>
          <p className="text-xs text-muted-foreground" data-testid="filters-count">
            Showing {shownLines} of {totalLines} lines{selected ? " · tap the name again to see everyone" : " · tap a name to sort out all its lines together"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 p-1.5" data-testid="more-filters">
          <Segmented
            label="Money direction"
            value={filters.direction}
            onChange={(direction) => set({ direction })}
            options={[
              { value: "all", label: "All" },
              { value: "credit", label: "Received" },
              { value: "debit", label: "Paid" },
            ]}
          />
          <Select value={filters.who} onValueChange={(who) => set({ who: who as PartyFilters["who"] })}>
            <SelectTrigger className="h-8 w-40 bg-card" aria-label="Who">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              <SelectItem value="people">People</SelectItem>
              <SelectItem value="shops">Shops & services</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.sort} onValueChange={(sort) => set({ sort: sort as PartyFilters["sort"] })}>
            <SelectTrigger className="h-8 w-40 bg-card" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="count">Most lines</SelectItem>
              <SelectItem value="amount">Biggest amount</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            aria-pressed={filters.oneOffs}
            onClick={() => set({ oneOffs: !filters.oneOffs })}
            className={cn("h-8 rounded-lg border px-2.5 text-xs font-medium", filters.oneOffs ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:bg-muted")}
          >
            One-offs
          </button>
          <Input value={filters.query} onChange={(e) => set({ query: e.target.value })} placeholder="Search a name" aria-label="Search a name" className="h-8 w-40 bg-card" />
          {dirty && (
            <button type="button" onClick={() => onFilters(DEFAULT_FILTERS)} className="text-xs font-medium text-primary hover:underline" data-testid="filters-reset">
              Reset
            </button>
          )}
        </div>
      </div>

      {list.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" data-testid="party-select">
          <label className="flex cursor-pointer items-center gap-1.5 font-medium">
            <input
              type="checkbox"
              checked={list.length > 0 && list.every((p) => picked.has(p.key))}
              ref={(el) => {
                if (el) el.indeterminate = picked.size > 0 && !list.every((p) => picked.has(p.key));
              }}
              onChange={(e) => setPicked(e.target.checked ? new Set(list.map((p) => p.key)) : new Set())}
              aria-label="Select all names"
            />
            Select all {list.length}
          </label>
          {picked.size > 0 && (
            <>
              <span className="text-muted-foreground">
                {picked.size} {picked.size === 1 ? "name" : "names"} selected
              </span>
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </>
          )}
          <span className="text-muted-foreground">Tick names to answer all their lines at once</span>
        </div>
      )}

      {list.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nobody matches these filters{filters.oneOffs ? "" : " (turn on “One-offs” above to also see names that appear once)"}.</p>
      ) : (
        <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {shown.map((p, i) => {
            const active = selected === p.key;
            const credit = p.direction === "credit";
            const share = Math.max(4, Math.round((p.totalMinor / maxMinor) * 100));
            return (
              <li key={p.key} className="flex items-stretch gap-1.5">
                <label className="flex shrink-0 cursor-pointer items-center px-1" aria-label={`Select ${p.name}`}>
                  <input type="checkbox" checked={picked.has(p.key)} onChange={() => toggle(p.key)} data-testid="party-pick" />
                </label>
                <button
                  type="button"
                  onClick={() => onSelect(active ? null : p.key)}
                  aria-pressed={active}
                  data-testid="party-chip"
                  className={cn(
                    "group relative w-full min-w-0 overflow-hidden rounded-lg border bg-card px-2.5 py-1.5 text-left transition hover:bg-muted/50",
                    active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : picked.has(p.key) ? "border-primary/50 bg-primary/5" : "hover:border-foreground/20",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums", i < 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold leading-tight">{p.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.rows.length} {p.rows.length === 1 ? "line" : "lines"} · {credit ? "received" : "paid"}
                      </span>
                    </span>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[13px] font-semibold tabular-nums", credit ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
                      {credit ? "+" : "−"}
                      {formatRupees(p.totalMinor)}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className={cn("block h-full rounded-full", credit ? "bg-emerald-400" : "bg-rose-400")} style={{ width: `${share}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {list.length > PREVIEW && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 rounded-md border px-2.5 py-1 text-xs font-medium text-primary hover:bg-muted">
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
      {picked.size > 0 && (
        <MultiBulkApply parties={parties.filter((p) => picked.has(p.key))} onDone={() => setPicked(new Set())} />
      )}
    </section>
  );
}

/** One answer for every line of the selected counterparty: the same Type / Category dropdowns as a single line. */
export function BulkApply({ party, onDone }: { party: Party; onDone: () => void }) {
  const { book, expenseCategories, incomeCategories } = useFinance();
  const statements = useStatements();
  const credit = party.direction === "credit";
  const open = useMemo(() => party.rows.filter((r) => r.status === "review" || r.status === "auto_flagged"), [party]);
  const n = open.length;
  const sample = open[0] ?? party.rows[0];

  const types = useMemo(() => optionsFor(party.direction, sample?.classification), [party.direction, sample]);
  const [type, setType] = useState<StatementEventType>(credit ? "INCOME" : "EXPENSE");
  const [category, setCategory] = useState(credit ? "Other income" : "Other");
  const [person, setPerson] = useState(party.name);
  const [account, setAccount] = useState("");
  const [holding, setHolding] = useState(party.name);
  const [message, setMessage] = useState<string | null>(null);

  const need = needs(type, party.direction);
  const categories = (credit ? incomeCategories : expenseCategories).map((c) => c.name);
  const accounts = book.accounts.filter(
    (a) => a.id !== sample?.accountId && (type === "CREDIT_CARD_PAYMENT" ? a.type === "credit_card" : type === "LOAN_REPAYMENT" ? a.type === "loan" : a.type === "bank" || a.type === "cash"),
  );
  const ready = (!need.person || person.trim()) && (!need.account || account) && (!need.holding || holding.trim());
  const total = open.reduce((t, r) => t + r.amountMinor, 0);

  const save = () => {
    let failed = 0;
    for (const r of open) {
      const res = statements.resolve(r.id, {
        kind: "classify",
        eventType: type,
        category: need.category ? category : null,
        person: need.person ? person.trim() : null,
        counterAccountId: need.account ? account : null,
        holding: need.holding ? holding.trim() : null,
      });
      if (!res.ok) failed++;
    }
    setMessage(failed ? `${failed} of ${n} couldn't be set. The rest are done.` : null);
    if (!failed) onDone();
  };

  return (
    <div className="rounded-2xl border border-primary/40 bg-primary/5 p-3" data-testid="bulk-apply">
      <p className="mb-2 text-sm font-medium">
        All {n} {n === 1 ? "line" : "lines"} {credit ? "from" : "to"} {party.name} ({formatRupees(total)})
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Type</span>
          <Select value={type} onValueChange={(t) => setType(t as StatementEventType)}>
            <SelectTrigger className="h-8 w-56" aria-label="Type for all">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {EVENT_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {need.category && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Category</span>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8 w-44" aria-label="Category for all">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {need.person && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Who</span>
            <Input list="bulk-people" value={person} onChange={(e) => setPerson(e.target.value)} className="h-8 w-44" aria-label="Person for all" />
            <datalist id="bulk-people">
              {book.people.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </div>
        )}

        {need.account && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{type === "CREDIT_CARD_PAYMENT" ? "Card" : type === "LOAN_REPAYMENT" ? "Loan" : credit ? "From" : "To"}</span>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger className="h-8 w-44" aria-label="Account for all">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {need.holding && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Investment</span>
            <Input value={holding} onChange={(e) => setHolding(e.target.value)} className="h-8 w-44" aria-label="Investment for all" />
          </div>
        )}

        <Button size="sm" disabled={!ready || n === 0} onClick={save} data-testid="bulk-save">
          <Check /> Save all {n}
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => {
          for (const r of open) statements.resolve(r.id, { kind: "skip" });
          onDone();
        }}>
          <X /> Skip all {n}
        </Button>
      </div>
      {message && <p className="mt-2 text-sm text-destructive">{message}</p>}
    </div>
  );
}

/**
 * One answer for every line of several names at once: same Type (and Category or account), with each
 * name's own lines using that name as the person or investment. Lines going the other way (money in when
 * you picked a money-out type) are left for you and counted in the message.
 */
function MultiBulkApply({ parties, onDone }: { parties: Party[]; onDone: () => void }) {
  const { book, expenseCategories, incomeCategories } = useFinance();
  const statements = useStatements();
  const open = useMemo(() => parties.flatMap((p) => p.rows.filter((r) => r.status === "review" || r.status === "auto_flagged").map((r) => ({ r, party: p }))), [parties]);
  const debits = open.filter((x) => x.r.direction === "debit").length;
  const direction: StatementRow["direction"] = debits >= open.length - debits ? "debit" : "credit";
  const credit = direction === "credit";
  const types = useMemo(() => optionsFor(direction, undefined), [direction]);

  const [type, setType] = useState<StatementEventType>(credit ? "INCOME" : "EXPENSE");
  const [category, setCategory] = useState(credit ? "Other income" : "Other");
  const [account, setAccount] = useState("");
  const [always, setAlways] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const need = needs(type, direction);
  const categories = (credit ? incomeCategories : expenseCategories).map((c) => c.name);
  const sourceAccount = open[0]?.r.accountId;
  const accounts = book.accounts.filter(
    (a) => a.id !== sourceAccount && (type === "CREDIT_CARD_PAYMENT" ? a.type === "credit_card" : type === "LOAN_REPAYMENT" ? a.type === "loan" : a.type === "bank" || a.type === "cash"),
  );
  const matching = open.filter((x) => x.r.direction === direction);
  const total = matching.reduce((t, x) => t + x.r.amountMinor, 0);
  const ready = (!need.account || account) && matching.length > 0;

  const save = () => {
    let failed = 0;
    for (const { r, party } of matching) {
      const res = statements.resolve(r.id, {
        kind: "classify",
        eventType: type,
        category: need.category ? category : null,
        person: need.person ? party.name : null,
        counterAccountId: need.account ? account : null,
        holding: need.holding ? party.name : null,
        scope: always ? "always" : "once",
      });
      if (!res.ok) failed++;
    }
    const otherWay = open.length - matching.length;
    const notes = [failed ? `${failed} couldn't be set` : "", otherWay ? `${otherWay} ${credit ? "money-out" : "money-in"} ${otherWay === 1 ? "line was" : "lines were"} left for you` : ""].filter(Boolean);
    setMessage(notes.length ? `Done. ${notes.join("; ")}.` : null);
    if (notes.length === 0) onDone();
  };

  return (
    <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/5 p-3" data-testid="multi-bulk-apply">
      <p className="mb-2 text-sm font-medium">
        {matching.length} {matching.length === 1 ? "line" : "lines"} from {parties.length} {parties.length === 1 ? "name" : "names"} ({formatRupees(total)})
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Type</span>
          <Select value={type} onValueChange={(t) => setType(t as StatementEventType)}>
            <SelectTrigger className="h-8 w-56" aria-label="Type for the selected names">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {EVENT_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {need.category && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Category</span>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8 w-44" aria-label="Category for the selected names">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {need.account && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{type === "CREDIT_CARD_PAYMENT" ? "Card" : type === "LOAN_REPAYMENT" ? "Loan" : credit ? "From" : "To"}</span>
            <Select value={account} onValueChange={setAccount}>
              <SelectTrigger className="h-8 w-44" aria-label="Account for the selected names">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {need.person && <span className="text-xs text-muted-foreground">Each name is used as the person</span>}
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Remember for these names
        </label>
        <Button size="sm" disabled={!ready} onClick={save} data-testid="multi-bulk-save">
          <Check /> Save all {matching.length}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => {
            for (const { r } of open) statements.resolve(r.id, { kind: "skip" });
            onDone();
          }}
        >
          <X /> Skip all {open.length}
        </Button>
      </div>
      {message && <p className="mt-2 text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
