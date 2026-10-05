"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accountIdsUsedBy, personIdsUsedBy } from "@/lib/finance/book-ops";
import { formatRupees } from "@/lib/finance/describe";
import { isMoneyBack } from "@/lib/finance/state";
import type { EventType, FinancialEvent } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "../category-icon";
import { useEventDialog } from "../events/event-dialog";
import { EVENT_OPTIONS } from "../events/event-meta";
import { EventRow, headline } from "../events/event-row";
import { useQuickRepaymentReceived } from "../events/quick-repay";
import { PictureIcon } from "../picture-icon";
import { useFinance } from "../finance-provider";
import { DuplicatesBanner } from "./duplicates-banner";
import { WaitingLines } from "./waiting-lines";

const ALL = "all";

type SortKey = "newest" | "oldest" | "highest" | "lowest";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "highest", label: "Highest amount" },
  { value: "lowest", label: "Lowest amount" },
];
const amountOf = (e: FinancialEvent): number => ("amountMinor" in e ? e.amountMinor : 0);

/** Broad shortcuts, kept alongside the individual entry types. */
const GROUPS: { id: string; label: string; types: EventType[] }[] = [
  { id: "credit", label: "Received · money in", types: ["income", "repayment_received", "borrow", "sell_investment"] },
  { id: "debit", label: "Paid · money out", types: ["expense", "split_expense", "reimbursable_expense", "lend", "repayment_made", "invest"] },
  { id: "spending", label: "Spending", types: ["expense", "split_expense", "reimbursable_expense"] },
  { id: "income", label: "Income", types: ["income"] },
  { id: "people", label: "Lent & borrowed", types: ["lend", "borrow", "repayment_received", "repayment_made"] },
  { id: "borrowed", label: "Money I borrowed", types: ["borrow", "repayment_made"] },
  { id: "lent", label: "Money I lent", types: ["lend", "repayment_received"] },
  { id: "investments", label: "Investments", types: ["invest", "sell_investment", "update_valuation"] },
  { id: "transfers", label: "Transfers & payments", types: ["transfer"] },
];

/** One-tap filters shown above the list; each sets the same "Show" value the menu does. */
const QUICK: { label: string; value: string }[] = [
  { label: "All", value: ALL },
  { label: "Paid", value: "group:debit" },
  { label: "Received", value: "group:credit" },
  { label: "Spending", value: "group:spending" },
  { label: "Income", value: "type:income" },
  { label: "Refunds & reimbursements", value: "group:moneyback" },
  { label: "Transfers", value: "type:transfer" },
  { label: "Investments", value: "group:investments" },
];

/** Income and money back are told apart: a refund or reimbursement is never shown as income. */
const MONEY_BACK_GROUP = "group:moneyback";
function matchesShow(show: string, e: FinancialEvent, types: EventType[]): boolean {
  if (show === MONEY_BACK_GROUP) return isMoneyBack(e);
  if (types.length > 0 && !types.includes(e.type)) return false;
  if ((show === "type:income" || show === "group:income") && isMoneyBack(e)) return false;
  return true;
}

/** Who an entry was with, as text: the name the bank printed (or the entry's title). */
const partyNameOf = (e: FinancialEvent, title: string): string => (e.description || title).trim().toLowerCase();

const ALL_TYPES = new Set<string>(EVENT_OPTIONS.map((o) => o.type));

/** What the "Show" menu is set to: "all", "type:<entry type>" or "group:<shortcut>". */
function initialShow(group: string | null, type: string | null): string {
  if (type && ALL_TYPES.has(type)) return `type:${type}`;
  if (group === "moneyback") return MONEY_BACK_GROUP;
  const g = GROUPS.find((x) => x.id === group);
  if (!g) return ALL;
  // A shortcut that is really just one category maps to that category.
  return g.types.length === 1 ? `type:${g.types[0]}` : `group:${g.id}`;
}

function typesFor(show: string): EventType[] {
  if (show.startsWith("type:")) return [show.slice(5) as EventType];
  if (show.startsWith("group:")) return GROUPS.find((g) => g.id === show.slice(6))?.types ?? [];
  return [];
}

const categoryOf = (e: FinancialEvent): string | null => ("categoryId" in e ? e.categoryId : null);

/**
 * Cards and charts link here with their filters in the URL, so tapping something
 * lands on exactly what it represents. The inner view is re-created whenever the
 * link changes so the filters always match it.
 */
export function ActivityView() {
  const params = useSearchParams();
  return <ActivityContent key={params.toString()} />;
}

function ActivityContent() {
  const { status, book, categories, describer, state } = useFinance();
  const { openAdd } = useEventDialog();
  const theyPaidMe = useQuickRepaymentReceived();

  const params = useSearchParams();
  const [group, setGroup] = useState(initialShow(params.get("group"), params.get("type")));
  const [categoryId, setCategoryId] = useState(params.get("category") ?? ALL);
  const [accountId, setAccountId] = useState(params.get("account") ?? ALL);
  const [personId, setPersonId] = useState(params.get("person") ?? ALL);
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  const [query, setQuery] = useState(params.get("q") ?? "");
  // "me": only people who still owe me; "you": only people I still owe (from the dashboard cards).
  const [sort, setSort] = useState<SortKey>("newest");
  // Tapping an entry narrows the list to everything with the same shop, company or name.
  const [party, setParty] = useState<{ key: string; label: string } | null>(null);
  const [owed, setOwed] = useState<string | null>(params.get("owed"));

  const owedPeople = useMemo(() => {
    if (!owed) return null;
    return new Set(state.people.filter((p) => (owed === "me" ? p.owedToMe.outstandingMinor : p.iOwe.outstandingMinor) > 0).map((p) => p.person.id));
  }, [owed, state.people]);

  const filtered = useMemo(() => {
    const types = typesFor(group);
    const q = query.trim().toLowerCase();
    return [...book.events]
      .filter(
        (e) =>
          (q === "" || `${describer.title(e)} ${describer.subtitle(e)} ${e.description ?? ""} ${e.note ?? ""}`.toLowerCase().includes(q)) &&
          (accountId === ALL || accountIdsUsedBy(e).includes(accountId)) &&
          (personId === ALL || personIdsUsedBy(e).includes(personId)) &&
          (!owedPeople || personIdsUsedBy(e).some((id) => owedPeople.has(id))) &&
          matchesShow(group, e, types) &&
          (!party || partyNameOf(e, describer.title(e)) === party.key) &&
          (categoryId === ALL || categoryOf(e) === categoryId) &&
          (!from || e.date >= from) &&
          (!to || e.date <= to),
      )
      .sort((a, b) => {
        const byDate = b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
        if (sort === "newest") return byDate;
        if (sort === "oldest") return -byDate;
        const byAmount = amountOf(b) - amountOf(a);
        return (sort === "highest" ? byAmount : -byAmount) || byDate;
      });
  }, [book.events, group, categoryId, accountId, personId, from, to, query, describer, owedPeople, sort, party]);

  const hasFilters =
    party !== null || group !== ALL || categoryId !== ALL || accountId !== ALL || personId !== ALL || from !== "" || to !== "" || query !== "" || owed !== null;
  const person = personId === ALL ? undefined : state.people.find((p) => p.person.id === personId);

  if (status === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;

  const clear = () => {
    setGroup(ALL);
    setCategoryId(ALL);
    setAccountId(ALL);
    setPersonId(ALL);
    setFrom("");
    setTo("");
    setQuery("");
    setOwed(null);
    setParty(null);
  };

  /** Everything with this entry's person, or else with the same shop / company / name, across all dates. */
  const showParty = (e: FinancialEvent) => {
    clear();
    const people = personIdsUsedBy(e);
    if (people.length === 1) setPersonId(people[0]);
    else setParty({ key: partyNameOf(e, describer.title(e)), label: e.description || describer.title(e) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const partyTotals = party
    ? filtered.reduce(
        (t, e) => {
          const h = headline(e);
          if (h.tone === "in") t.in += h.amountMinor;
          else if (h.tone === "out") t.out += h.amountMinor;
          return t;
        },
        { in: 0, out: 0 },
      )
    : null;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-4 sm:gap-6">
      <DuplicatesBanner />

      {party && partyTotals && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm" data-testid="party-banner">
          <span>
            Everything with <strong>{party.label}</strong> · {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
            {partyTotals.out > 0 && <> · paid {formatRupees(partyTotals.out)}</>}
            {partyTotals.in > 0 && <> · received {formatRupees(partyTotals.in)}</>}
          </span>
          <button type="button" onClick={() => setParty(null)} className="font-medium text-primary hover:underline">
            Show all entries
          </button>
        </div>
      )}

      {owedPeople && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm" data-testid="owed-banner">
          <span>
            {owed === "me" ? "Only people who still owe you" : "Only people you still owe"} <strong>({owedPeople.size})</strong>
          </span>
          <button type="button" onClick={() => setOwed(null)} className="font-medium text-primary hover:underline">
            Show everyone
          </button>
        </div>
      )}

      {person && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            <div className="flex items-center gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-indigo-50 text-lg font-semibold text-indigo-600">
                {person.person.name.charAt(0).toUpperCase()}
              </span>
              <div>
                <button
                  type="button"
                  onClick={() => setPersonId(ALL)}
                  className="mb-0.5 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="size-3" /> All people
                </button>
                <h1 className="text-xl font-semibold leading-tight">{person.person.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {person.owedToMe.outstandingMinor > 0 && (
                    <span className="font-medium text-foreground">Owes you {formatRupees(person.owedToMe.outstandingMinor)}</span>
                  )}
                  {person.owedToMe.outstandingMinor > 0 && person.iOwe.outstandingMinor > 0 && " · "}
                  {person.iOwe.outstandingMinor > 0 && (
                    <span className="font-medium text-foreground">You owe {formatRupees(person.iOwe.outstandingMinor)}</span>
                  )}
                  {person.owedToMe.outstandingMinor === 0 && person.iOwe.outstandingMinor === 0 && "All settled"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {person.owedToMe.originalMinor > 0 &&
                    `Lent ${formatRupees(person.owedToMe.originalMinor)}, paid back ${formatRupees(person.owedToMe.receivedMinor)}. `}
                  {person.iOwe.originalMinor > 0 &&
                    `Borrowed ${formatRupees(person.iOwe.originalMinor)}, repaid ${formatRupees(person.iOwe.repaidMinor)}.`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {person.owedToMe.outstandingMinor > 0 && (
                <Button onClick={() => theyPaidMe(person.person.id)}>They paid me back</Button>
              )}
              {person.iOwe.outstandingMinor > 0 && (
                <Button onClick={() => openAdd("repayment_made", { person: person.person.name })}>I paid them back</Button>
              )}
              <Button variant="outline" onClick={() => openAdd("lend", { person: person.person.name })}>
                Lend more
              </Button>
              <Button variant="outline" onClick={() => openAdd("borrow", { person: person.person.name })}>
                Borrow more
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick filters" data-testid="quick-filters">
            {QUICK.map((q) => (
              <button
                key={q.value}
                type="button"
                aria-pressed={group === q.value}
                onClick={() => setGroup(q.value)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  group === q.value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {q.label}
              </button>
            ))}
          </div>

          <div className="flex items-end gap-3">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="search">Search</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="search"
                  type="search"
                  autoComplete="off"
                  className="pl-9"
                  placeholder="Search by name, person, category or note"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>
            <Button variant="ghost" disabled={!hasFilters} onClick={clear}>
              Clear
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div className="grid gap-1.5">
              <Label htmlFor="filter-group">Show</Label>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger id="filter-group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[32rem]">
                  <SelectItem value={ALL}>Everything</SelectItem>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Type of entry</SelectLabel>
                    {EVENT_OPTIONS.map((o) => (
                      <SelectItem key={o.type} value={`type:${o.type}`}>
                        <span className="flex items-center gap-2">
                          <PictureIcon name={o.picture} />
                          {o.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Combined</SelectLabel>
                    {GROUPS.filter((g) => g.types.length > 1).map((g) => (
                      <SelectItem key={g.id} value={`group:${g.id}`}>
                        {g.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={MONEY_BACK_GROUP}>Refunds & reimbursements</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-category">Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="filter-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <CategoryIcon category={c} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-account">Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger id="filter-account">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All accounts</SelectItem>
                  {book.accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-person">Person</Label>
              <Select value={personId} onValueChange={setPersonId}>
                <SelectTrigger id="filter-person">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Everyone</SelectItem>
                  {book.people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-from">From</Label>
              <Input id="filter-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="filter-to">To</Label>
              <Input id="filter-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <WaitingLines query={query} />

      <div className="-mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {hasFilters ? `${filtered.length} of ${book.events.length} entries` : `${book.events.length} ${book.events.length === 1 ? "entry" : "entries"}`}
          {book.events.length > 0 && " · use the pencil to correct, the bin to remove"}
        </p>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Sort entries">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        {filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <p className="text-muted-foreground">
              {book.events.length === 0 ? "Nothing recorded yet." : "Nothing matches these filters."}
            </p>
            {book.events.length === 0 ? (
              <Button onClick={() => openAdd()}>
                <Plus /> Record something
              </Button>
            ) : (
              <Button variant="outline" onClick={clear}>
                Clear filters
              </Button>
            )}
          </CardContent>
        ) : (
          <ul className="divide-y py-2">
            {filtered.map((e) => (
              <EventRow key={e.id} event={e} onOpen={() => showParty(e)} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

