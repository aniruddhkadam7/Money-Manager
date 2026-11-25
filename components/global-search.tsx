"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { activityHref } from "@/lib/charts/links";
import { formatRupees } from "@/lib/finance/describe";
import { namesOf } from "@/lib/finance/person-summary";
import { cn } from "@/lib/utils";
import { AccountLogo, useBankHints } from "./account-logo";
import { PartyLogo } from "./brand-logo";
import { CategoryIcon } from "./category-icon";
import { useEventDialog } from "./events/event-dialog";
import { EventLogo } from "./events/event-logo";
import { useFinance } from "./finance-provider";
import { PersonAvatar } from "./money/person-photo";
import { usePersonSheet } from "./money/person-sheet-provider";

/** Lower case, spaces squeezed: how names are compared. */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Every word typed appears somewhere in the text ("om guna" finds "Omprakash Guna"). */
const matches = (text: string, q: string) => {
  const t = norm(text);
  return norm(q)
    .split(" ")
    .every((w) => t.includes(w));
};

const LIMIT = 5;

/**
 * Search in the header: one box for everything. People (by any of their names), shops and payees, accounts,
 * categories and single entries; tapping one opens everything with it (a person's page, the shop's entries, the
 * account's or category's entries), and the last line searches all entries for the words typed.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);

  // "/" opens it from anywhere (unless you're typing in a box), as on most sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || t?.closest("input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button variant="ghost" size="icon" aria-label="Search" title="Search (/)" onClick={() => setOpen(true)} data-testid="global-search">
        <Search />
      </Button>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const f = useFinance();
  const router = useRouter();
  const { openDetail } = useEventDialog();
  // Over the search, so Back returns to the results.
  const { openPerson: showPerson } = usePersonSheet();
  const bankOf = useBankHints();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const query = q.trim();
    if (!query) return null;
    const owe = new Map(f.state.people.map((p) => [p.person.id, p]));
    const people = f.book.people
      .filter((p) => namesOf(p).some((n) => matches(n, query)))
      .slice(0, LIMIT)
      .map((p) => {
        const s = owe.get(p.id);
        const also = (p.aliases ?? []).find((a) => matches(a, query) && !matches(p.name, query));
        const money = s && s.owedToMe.outstandingMinor > 0 ? `Owes you ${formatRupees(s.owedToMe.outstandingMinor)}` : s && s.iOwe.outstandingMinor > 0 ? `You owe ${formatRupees(s.iOwe.outstandingMinor)}` : "All settled";
        return { person: p, detail: also ? `${money} · also “${also}”` : money };
      });
    // Shops and payees: the names entries were recorded under, with how many and the latest.
    const shops = new Map<string, { name: string; count: number; last: string }>();
    const personNames = new Set(f.book.people.flatMap((p) => namesOf(p).map(norm)));
    for (const e of f.book.events) {
      const name = e.description?.trim();
      if (!name || personNames.has(norm(name)) || !matches(name, query)) continue;
      const key = norm(name);
      const s = shops.get(key);
      if (s) {
        s.count++;
        if (e.date > s.last) s.last = e.date;
      } else shops.set(key, { name, count: 1, last: e.date });
    }
    const shopList = [...shops.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last)).slice(0, LIMIT);
    const accounts = f.book.accounts.filter((a) => matches(a.name, query)).slice(0, LIMIT);
    const categories = f.categories.filter((c) => matches(c.name, query)).slice(0, LIMIT);
    // Single entries: by reason, payee, title or amount ("6500" finds ₹6,500).
    const digits = query.replace(/[₹,\s]/g, "");
    const byAmount = /^\d+(\.\d{1,2})?$/.test(digits) ? Math.round(Number(digits) * 100) : null;
    const entries = [...f.book.events]
      .filter((e) => {
        const text = `${f.describer.title(e)} ${e.description ?? ""} ${e.note ?? ""}`;
        const amount = "amountMinor" in e ? e.amountMinor : "totalMinor" in e ? e.totalMinor : null;
        return matches(text, query) || (byAmount !== null && amount === byAmount);
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, LIMIT);
    return { people, shopList, accounts, categories, entries };
  }, [q, f.book, f.state.people, f.categories, f.describer]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  const nothing = results && !results.people.length && !results.shopList.length && !results.accounts.length && !results.categories.length && !results.entries.length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* Wide screens: near the top. Phones: the whole screen, the box at the top, clear of the keyboard. */}
      <DialogContent
        className="top-16 max-h-[80vh] max-w-lg translate-y-0 content-start gap-3 overflow-y-auto p-4 max-sm:top-[env(safe-area-inset-top)] max-sm:max-h-none max-sm:rounded-t-none max-sm:p-4"
        data-testid="search-dialog"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search people, shops, accounts, categories and entries.</DialogDescription>
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) go(activityHref({ q: q.trim() }));
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={input}
            autoFocus
            type="search"
            enterKeyHint="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people, shops, accounts, amounts…"
            aria-label="Search"
            className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-9 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
          {q && (
            <button type="button" aria-label="Clear" onClick={() => (setQ(""), input.current?.focus())} className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted">
              <X className="size-4" />
            </button>
          )}
        </form>

        {!results && <p className="px-1 text-sm text-muted-foreground">Type a name (any name they go by), a shop, an account, a category or an amount.</p>}
        {nothing && <p className="px-1 text-sm text-muted-foreground">Nothing found for “{q.trim()}”.</p>}

        {results && (
          <div className="grid gap-3">
            {results.people.length > 0 && (
              <Group title="People">
                {results.people.map(({ person, detail }) => (
                  <Row
                    key={person.id}
                    lead={
                      <PersonAvatar
                        person={person}
                        logoClassName="!rounded-full [&>img]:!size-6"
                        fallback={<span className="grid size-9 shrink-0 place-items-center rounded-full bg-indigo-500/15 text-sm font-semibold text-indigo-600 dark:text-indigo-300">{person.name.charAt(0).toUpperCase()}</span>}
                      />
                    }
                    title={person.name}
                    detail={detail}
                    onClick={() => showPerson(person.id)}
                  />
                ))}
              </Group>
            )}
            {results.shopList.length > 0 && (
              <Group title="Shops & payees">
                {results.shopList.map((s) => (
                  <Row
                    key={s.name}
                    lead={<PartyLogo name={s.name} fallback={<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-sm font-semibold">{s.name.charAt(0).toUpperCase()}</span>} />}
                    title={s.name}
                    detail={`${s.count} ${s.count === 1 ? "entry" : "entries"}`}
                    onClick={() => go(activityHref({ party: s.name }))}
                  />
                ))}
              </Group>
            )}
            {results.accounts.length > 0 && (
              <Group title="Accounts">
                {results.accounts.map((a) => (
                  <Row key={a.id} lead={<AccountLogo account={a} bankHint={bankOf(a.id)} />} title={a.name} detail="All its entries" onClick={() => go(activityHref({ account: a.id }))} />
                ))}
              </Group>
            )}
            {results.categories.length > 0 && (
              <Group title="Categories">
                {results.categories.map((c) => (
                  <Row key={c.id} lead={<CategoryIcon category={c} />} title={c.name} detail="Everything in it" onClick={() => go(activityHref({ category: c.id }))} />
                ))}
              </Group>
            )}
            {results.entries.length > 0 && (
              <Group title="Entries">
                {results.entries.map((e) => (
                  <Row
                    key={e.id}
                    lead={<EventLogo event={e} className="size-9" />}
                    title={e.note?.trim() || f.describer.title(e)}
                    detail={`${e.date.split("-").reverse().join("-")} · ${f.describer.subtitle(e)}`}
                    onClick={() => {
                      onClose();
                      openDetail(e.id);
                    }}
                  />
                ))}
              </Group>
            )}
            <button
              type="button"
              onClick={() => go(activityHref({ q: q.trim() }))}
              className="flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-medium text-primary hover:bg-muted"
            >
              Search all entries for “{q.trim()}”
              <ArrowRight className="size-4" />
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-0.5">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="grid">{children}</ul>
    </section>
  );
}

function Row({ lead, title, detail, onClick }: { lead: ReactNode; title: string; detail?: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-3 rounded-xl px-1.5 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted")}>
        <span className="flex size-9 shrink-0 items-center justify-center">{lead}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
        </span>
      </button>
    </li>
  );
}
