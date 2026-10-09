"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { accountIdsUsedBy, personIdsUsedBy } from "@/lib/finance/book-ops";
import { formatRupees } from "@/lib/finance/describe";
import { isMoneyBack } from "@/lib/finance/state";
import type { EventType, FinancialEvent } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { ActivityViewSwitch } from "../calendar/calendar-view";
import { CategoryIcon } from "../category-icon";
import { PartyLogo } from "../brand-logo";
import { useEventDialog } from "../events/event-dialog";
import { EVENT_OPTIONS } from "../events/event-meta";
import { EventRow, headline } from "../events/event-row";
import { useQuickRepaymentReceived } from "../events/quick-repay";
import { PageTitle } from "../page-title";
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

/** The short "Show" menu: the everyday views. Specific entry types live in their own "Type" filter. */
const SHOW: { label: string; value: string }[] = [
  { label: "Everything", value: "all" },
  { label: "Paid · money out", value: "group:debit" },
  { label: "Received · money in", value: "group:credit" },
  { label: "Spending", value: "group:spending" },
  { label: "Income", value: "type:income" },
  { label: "Refunds & reimbursements", value: "group:moneyback" },
  { label: "Lent & borrowed", value: "group:people" },
  { label: "Investments", value: "group:investments" },
  { label: "Transfers", value: "type:transfer" },
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
  // A link to one specific entry type (say "Lend") sets the Type filter; everything else sets Show.
  const [initial] = useState(() => {
    const show = initialShow(params.get("group"), params.get("type"));
    return show.startsWith("type:") && !SHOW.some((o) => o.value === show) ? { show: ALL, type: show.slice(5) } : { show, type: ALL };
  });
  const [group, setGroup] = useState(initial.show);
  const [entryType, setEntryType] = useState(initial.type);
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
  // Phones: the detailed filters fold away behind the filter button, whose badge counts the ones set (a dashboard link sets dates).
  const detailFilters = [entryType !== ALL, categoryId !== ALL, accountId !== ALL, personId !== ALL, from !== "", to !== ""].filter(Boolean).length;
  const [moreOpen, setMoreOpen] = useState(false);

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
          (entryType === ALL || (e.type === entryType && !(entryType === "income" && isMoneyBack(e)))) &&
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
  }, [book.events, group, entryType, categoryId, accountId, personId, from, to, query, describer, owedPeople, sort, party]);

  const hasFilters =
    party !== null || group !== ALL || entryType !== ALL || categoryId !== ALL || accountId !== ALL || personId !== ALL || from !== "" || to !== "" || query !== "" || owed !== null;
  const person = personId === ALL ? undefined : state.people.find((p) => p.person.id === personId);

  // A dashboard link can open a view that isn't on the short menu (e.g. "Money I lent"); it's listed while it's on.
  const extraShow = group !== ALL && !SHOW.some((o) => o.value === group) ? GROUPS.find((g) => `group:${g.id}` === group) : undefined;
  const typeOptions: SearchableOption[] = [
    { value: ALL, label: "All types" },
    ...EVENT_OPTIONS.map((o) => ({ value: o.type, label: o.label, icon: <PictureIcon name={o.picture} /> })),
  ];
  const categoryOptions: SearchableOption[] = [
    { value: ALL, label: "All categories" },
    ...categories.map((c) => ({ value: c.id, label: c.name, icon: <CategoryIcon category={c} /> })),
  ];
  const accountOptions: SearchableOption[] = [{ value: ALL, label: "All accounts" }, ...book.accounts.map((a) => ({ value: a.id, label: a.name }))];
  const personOptions: SearchableOption[] = [{ value: ALL, label: "Everyone" }, ...book.people.map((p) => ({ value: p.id, label: p.name }))];

  const sortMenu = (
    <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
      <SelectTrigger className="text-sm sm:h-8 sm:w-44 sm:text-xs" aria-label="Sort entries">
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
  );

  if (status === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;

  const clear = () => {
    setGroup(ALL);
    setEntryType(ALL);
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
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-4 sm:gap-6">
      <PageTitle actions={<ActivityViewSwitch current="list" />}>Activity</PageTitle>
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
              <PartyLogo
                name={person.person.name}
                className="!size-12 !rounded-full"
                fallback={
                  <span className="grid size-12 shrink-0 place-items-center rounded-full bg-indigo-50 text-lg font-semibold text-indigo-600">
                    {person.person.name.charAt(0).toUpperCase()}
                  </span>
                }
              />
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
        <CardContent className="grid gap-2 p-3 sm:gap-4 sm:p-5">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative flex-1">
              <Label htmlFor="search" className="sr-only">
                Search
              </Label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                type="search"
                autoComplete="off"
                className="pl-9 max-sm:h-10"
                placeholder="Search name, person, category or note"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              className="relative size-10 shrink-0 sm:hidden"
              aria-label={detailFilters > 0 ? `Filters (${detailFilters} set)` : "Filters"}
              aria-expanded={moreOpen}
              aria-controls="detail-filters"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <SlidersHorizontal />
              {detailFilters > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {detailFilters}
                </span>
              )}
            </Button>
            <Button variant="ghost" className="max-sm:hidden" disabled={!hasFilters} onClick={clear}>
              Clear
            </Button>
          </div>

          <div id="detail-filters" className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4 xl:grid-cols-7">
            {/* Phones: "Show" is always there (it replaces the old chips); the rest fold behind the filter button. */}
            <div className="grid gap-1.5 max-sm:col-span-2 max-sm:flex max-sm:items-center max-sm:gap-2">
              <Label htmlFor="filter-group" className="max-sm:sr-only">
                Show
              </Label>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger id="filter-group" className="max-sm:flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHOW.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                  {extraShow && <SelectItem value={group}>{extraShow.label}</SelectItem>}
                </SelectContent>
              </Select>
              {/* Phones: sorting sits beside Show instead of taking its own line under the card. */}
              <div className="flex-1 sm:hidden">{sortMenu}</div>
            </div>
            <div className={cn("grid gap-1.5", !moreOpen && "max-sm:hidden")}>
              <Label htmlFor="filter-type">Type</Label>
              <SearchableSelect id="filter-type" value={entryType} onValueChange={setEntryType} options={typeOptions} placeholder="Search types…" />
            </div>
            <div className={cn("grid gap-1.5", !moreOpen && "max-sm:hidden")}>
              <Label htmlFor="filter-category">Category</Label>
              <SearchableSelect id="filter-category" value={categoryId} onValueChange={setCategoryId} options={categoryOptions} placeholder="Search categories…" />
            </div>
            <div className={cn("grid gap-1.5", !moreOpen && "max-sm:hidden")}>
              <Label htmlFor="filter-account">Account</Label>
              <SearchableSelect id="filter-account" value={accountId} onValueChange={setAccountId} options={accountOptions} placeholder="Search accounts…" />
            </div>
            <div className={cn("grid gap-1.5", !moreOpen && "max-sm:hidden")}>
              <Label htmlFor="filter-person">Person</Label>
              <SearchableSelect id="filter-person" value={personId} onValueChange={setPersonId} options={personOptions} placeholder="Search people…" />
            </div>
            <div className={cn("grid gap-1.5", !moreOpen && "max-sm:hidden")}>
              <Label htmlFor="filter-from">From</Label>
              <Input id="filter-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className={cn("grid gap-1.5", !moreOpen && "max-sm:hidden")}>
              <Label htmlFor="filter-to">To</Label>
              <Input id="filter-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <WaitingLines query={query} />

      <div className="-my-2 flex flex-wrap items-center justify-between gap-2 px-1 sm:-mt-0">
        <p className="text-xs text-muted-foreground sm:text-sm" aria-live="polite">
          {hasFilters ? `${filtered.length} of ${book.events.length} entries` : `${book.events.length} ${book.events.length === 1 ? "entry" : "entries"}`}
          {book.events.length > 0 && <span className="max-sm:hidden"> · tap an entry to see, fix or remove it</span>}
          {hasFilters && (
            <>
              {" · "}
              <button type="button" onClick={clear} className="font-medium text-primary hover:underline sm:hidden">
                Clear all
              </button>
            </>
          )}
        </p>
        <div className="max-sm:hidden">{sortMenu}</div>
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

