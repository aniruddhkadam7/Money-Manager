"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Lock, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { activityHref } from "@/lib/charts/links";
import { formatRupees } from "@/lib/finance/describe";
import { CategoryIcon } from "../category-icon";
import { useFinance } from "../finance-provider";
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
}: {
  lead: ReactNode;
  name: string;
  detail?: string;
  /** Where tapping the name goes (e.g. a person's history). */
  href?: string;
  onRename?: (name: string) => Promise<string | null> | string | null;
  onDelete?: () => Promise<string | null> | string | null;
  locked?: boolean;
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

/** People and categories: fix a typo, tidy up, or remove what you never used. */
export function ManageLists() {
  const f = useFinance();
  const people = f.state.people;
  const custom = f.expenseCategories.filter((c) => !c.isDefault);
  const builtIn = f.expenseCategories.filter((c) => c.isDefault);

  return (
    <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
        </CardHeader>
        <SamePeopleBanner className="mx-4 sm:mx-5" />
        {people.length === 0 ? (
          <CardContent className="py-6 text-sm text-muted-foreground">
            People appear here when you lend, borrow or split a bill.
          </CardContent>
        ) : (
          <ul className="divide-y py-2">
            {people.map((p) => {
              const owed = p.owedToMe.outstandingMinor;
              const owe = p.iOwe.outstandingMinor;
              const detail = owed > 0 ? `Owes you ${formatRupees(owed)}` : owe > 0 ? `You owe ${formatRupees(owe)}` : "All settled";
              return (
                <ManagedRow
                  key={p.person.id}
                  lead={<span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{p.person.name.charAt(0).toUpperCase()}</span>}
                  name={p.person.name}
                  detail={detail}
                  href={activityHref({ person: p.person.id })}
                  onRename={(name) => {
                    const r = f.renamePerson(p.person.id, name);
                    return r.ok ? null : r.issues[0]?.message ?? "Couldn't rename.";
                  }}
                  onDelete={() => {
                    const r = f.deletePerson(p.person.id);
                    return r.ok ? null : r.issues[0]?.message ?? "Couldn't delete.";
                  }}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spending categories</CardTitle>
        </CardHeader>
        <ul className="divide-y py-2">
          {custom.map((c) => {
            const used = f.categoryUsage(c.id);
            return (
              <ManagedRow
                key={c.id}
                lead={<CategoryIcon category={c} tile className="!size-9 !rounded-lg" />}
                name={c.name}
                detail={used > 0 ? `Used in ${used} ${used === 1 ? "entry" : "entries"}` : "Not used yet"}
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
            <li className="px-5 py-4 text-sm text-muted-foreground">
              Categories you create while adding an entry show up here, where you can rename or remove them.
            </li>
          )}
        </ul>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          Built in: {builtIn.map((c) => c.name).join(", ")}.
        </p>
      </Card>
    </div>
  );
}
