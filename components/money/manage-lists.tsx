"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronRight, Lock, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { findPeopleInEntries } from "@/lib/finance/found-people";
import { hideFoundName, useNotPeople } from "@/lib/not-people";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { activityHref } from "@/lib/charts/links";
import { formatRupees } from "@/lib/finance/describe";
import { CategoryIcon } from "../category-icon";
import { useFinance } from "../finance-provider";
import { PersonAvatar } from "./person-photo";
import { usePersonSheet } from "./person-sheet-provider";
import { SamePeopleBanner } from "./same-people-banner";

/** One line with inline rename and delete. Shows why when something can't be removed. */
function ManagedRow({
  lead,
  name,
  detail,
  href,
  onRename,
  onDelete,
  locked,
  extra,
}: {
  lead: ReactNode;
  name: string;
  detail?: string;
  /** Where tapping the name goes (e.g. a person's history). */
  href?: string;
  onRename?: (name: string) => Promise<string | null> | string | null;
  onDelete?: () => Promise<string | null> | string | null;
  locked?: boolean;
  /** More actions, before rename and delete (a person's names & merge). */
  extra?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const message = await onRename?.(value);
    if (message) return setError(message);
    setEditing(false);
    setError(null);
  }

  async function remove() {
    const message = await onDelete?.();
    if (message) {
      setError(message);
      setConfirming(false);
    }
  }

  return (
    <li className="px-4 py-2.5 sm:px-5">
      <div className="flex items-center gap-3">
        {lead}
        {editing ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Input autoFocus value={value} maxLength={40} aria-label="Name" onChange={(e) => setValue(e.target.value)} />
            <Button type="submit" size="icon" aria-label="Save name">
              <Check />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Cancel"
              onClick={() => {
                setEditing(false);
                setValue(name);
                setError(null);
              }}
            >
              <X />
            </Button>
          </form>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              {href ? (
                <Link href={href} className="block truncate text-sm font-medium hover:text-emerald-700 hover:underline">
                  {name}
                </Link>
              ) : (
                <p className="truncate text-sm font-medium">{name}</p>
              )}
              {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
            </div>
            {locked ? (
              <Lock className="size-4 text-muted-foreground" aria-label="Built in" />
            ) : confirming ? (
              <div className="flex items-center gap-1">
                <span className="mr-1 text-xs text-red-800">Delete?</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  No
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void remove()}>
                  Yes
                </Button>
              </div>
            ) : (
              <div className="flex items-center">
                {extra}
                {onRename && (
                  <Button variant="ghost" size="icon" aria-label={`Rename ${name}`} title="Rename" onClick={() => setEditing(true)}>
                    <Pencil />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${name}`}
                    title="Delete"
                    className="hover:bg-red-50 hover:text-destructive"
                    onClick={() => {
                      setError(null);
                      setConfirming(true);
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {error && <p className="mt-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-800">{error}</p>}
    </li>
  );
}

/** People: tap someone for everything about them (photo, names, merging, what went between you, deleting). */
export function PeopleList({ className }: { className?: string }) {
  const f = useFinance();
  const people = f.state.people;
  const { openPerson } = usePersonSheet();
  // Everyone else the entries name (a UPI payment to someone, "paid to Rahul"), so nobody is missed.
  const notPeople = useNotPeople();
  const found = useMemo(() => findPeopleInEntries(f.book, notPeople), [f.book, notPeople]);

  return (
    <Card className={className}>
      <CardHeader className="max-sm:px-4 max-sm:pt-4">
        <CardTitle>People</CardTitle>
      </CardHeader>
      <SamePeopleBanner className="mx-4 sm:mx-5" />
      {people.length === 0 ? (
        found.length === 0 && (
          <CardContent className="py-6 text-sm text-muted-foreground">
            Added when you lend, borrow or split a bill, or when a payment names someone.
          </CardContent>
        )
      ) : (
        <ul className="divide-y py-2">
          {people.map((p) => {
            const owed = p.owedToMe.outstandingMinor;
            const owe = p.iOwe.outstandingMinor;
            const money = owed > 0 ? `Owes you ${formatRupees(owed)}` : owe > 0 ? `You owe ${formatRupees(owe)}` : "All settled";
            const aka = p.person.aliases?.length ? ` · also ${p.person.aliases.join(", ")}` : "";
            const detail = money + aka;
            return (
              <li key={p.person.id}>
                <button
                  type="button"
                  onClick={() => openPerson(p.person.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none sm:px-5"
                >
                  <PersonAvatar
                    person={p.person}
                    logoClassName="!rounded-full [&>img]:!size-6"
                    fallback={<span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{p.person.name.charAt(0).toUpperCase()}</span>}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.person.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {found.length > 0 && (
        <section aria-labelledby="found-people" className="border-t">
          <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-4 sm:px-5">
            <div className="min-w-0">
              <h3 id="found-people" className="text-sm font-semibold">
                Found in your entries ({found.length})
              </h3>
              <p className="text-xs text-muted-foreground">Payments that name someone not in your list yet.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => found.forEach((p) => f.resolvePerson(p.name))}>
              <UserPlus /> Add all
            </Button>
          </div>
          <ul className="divide-y py-2">
            {found.map((p) => {
              const money = [p.paidMinor > 0 && `Paid ${formatRupees(p.paidMinor)}`, p.receivedMinor > 0 && `Received ${formatRupees(p.receivedMinor)}`].filter(Boolean).join(" · ");
              return (
                <li key={p.key} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border border-dashed border-slate-300 text-sm font-semibold text-slate-500">
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={activityHref({ q: p.name })} className="block truncate text-sm font-medium hover:text-emerald-700 hover:underline">
                      {p.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {money} · {p.entries} {p.entries === 1 ? "entry" : "entries"}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`Add ${p.name} to People`} title="Add to People" onClick={() => f.resolvePerson(p.name)}>
                    <UserPlus />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={`${p.name} isn't a person`} title="Not a person (hide)" onClick={() => hideFoundName(p.key)}>
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Card>
  );
}

/** Spending categories you added: rename or remove them, or add a subcategory (e.g. Hair care under Health). The built-in ones are listed below them. Lives in the profile's settings. */
export function CategoriesList() {
  const f = useFinance();
  const custom = f.expenseCategories.filter((c) => !c.isDefault);
  const builtIn = f.expenseCategories.filter((c) => c.isDefault);
  const parents = f.expenseCategories.filter((c) => !c.parentId);
  const [parentId, setParentId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addSub() {
    const trimmed = name.trim();
    if (!parentId) return setError("Choose the main category first.");
    if (!trimmed) return setError("Enter a name.");
    if (f.expenseCategories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      return setError(`You already have a category called “${trimmed}”.`);
    }
    setBusy(true);
    try {
      await f.addCategory(trimmed, parentId);
      setName("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add it.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <form
        className="grid gap-2 border-b p-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void addSub();
        }}
      >
        <select
          aria-label="Main category"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Under which category?</option>
          {parents.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Input value={name} maxLength={30} placeholder="Subcategory, e.g. Hair care" aria-label="Subcategory name" onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={busy}>
          Add
        </Button>
        {error && <p className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-800 sm:col-span-3">{error}</p>}
      </form>
      <ul className="divide-y">
        {custom.map((c) => {
          const used = f.categoryUsage(c.id);
          const parent = c.parentId ? f.expenseCategories.find((x) => x.id === c.parentId) : undefined;
          const usage = used > 0 ? `Used in ${used} ${used === 1 ? "entry" : "entries"}` : "Not used yet";
          return (
            <ManagedRow
              key={c.id}
              lead={<CategoryIcon category={c} tile className="!size-9 !rounded-lg" />}
              name={c.name}
              detail={parent ? `Under ${parent.name} · ${usage}` : usage}
              onRename={async (name) => {
                const r = await f.renameCategory(c.id, name);
                return r.ok ? null : r.message;
              }}
              onDelete={async () => {
                const r = await f.deleteCategory(c.id);
                return r.ok ? null : r.message;
              }}
            />
          );
        })}
        {custom.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted-foreground">
            Categories you add show up here.
          </li>
        )}
      </ul>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">
        Built in: {builtIn.map((c) => c.name).join(", ")}.
      </p>
    </div>
  );
}
