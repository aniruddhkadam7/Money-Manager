"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Pencil, Trash2, UsersRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { activityHref } from "@/lib/charts/links";
import { formatRupees } from "@/lib/finance/describe";
import { involvesPerson, personSummary } from "@/lib/finance/person-summary";
import { useEventDialog } from "../events/event-dialog";
import { EventRow } from "../events/event-row";
import { useFinance } from "../finance-provider";
import { PersonNamesDialog } from "./person-names";
import { PersonPhotoButton } from "./person-photo";
import { TogetherSummary } from "./person-together";

const RECENT = 5;

/**
 * Everything about one person in one place: their photo, name, other names and merging, what you owe each other,
 * every kind of money between you (by category too), their latest entries (tap one to change it), and deleting them.
 */
export function PersonSheet({ personId, onClose }: { personId: string; onClose: () => void }) {
  const f = useFinance();
  const entryDialog = useEventDialog();
  const summary = f.state.people.find((p) => p.person.id === personId);
  const person = summary?.person;

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [namesOpen, setNamesOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const entries = useMemo(
    () => (person ? f.book.events.filter((e) => involvesPerson(e, person)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)) : []),
    [f.book.events, person],
  );
  const together = useMemo(() => (person ? personSummary(f.book.events, person) : null), [f.book.events, person]);

  const entriesHref = person ? activityHref({ person: person.id }) : "";
  // Already on their entries: the link has nowhere to go, so it just closes the sheet (other pages close it on arrival).
  const toEntries = () => {
    if (location.pathname + location.search === entriesHref) onClose();
  };

  // Opens over the sheet, so Back returns here. But if this sheet was opened from an entry's window, that window is
  // underneath and would change out of sight: step aside so it shows.
  const openEntry = (id: string) => {
    if (entryDialog.isOpen) onClose();
    entryDialog.openDetail(id);
  };

  // Deleted, or merged into someone else: nothing left to show.
  if (!summary || !person) return null;

  const owed = summary.owedToMe.outstandingMinor;
  const owe = summary.iOwe.outstandingMinor;
  const initial = person.name.charAt(0).toUpperCase();

  const rename = () => {
    const r = f.renamePerson(person.id, name);
    if (!r.ok) return setError(r.issues[0]?.message ?? "Couldn't rename.");
    setEditing(false);
    setError(null);
  };
  const remove = () => {
    const r = f.deletePerson(person.id);
    if (!r.ok) {
      setError(r.issues[0]?.message ?? "Couldn't delete.");
      setConfirmDelete(false);
      return;
    }
    onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
          {/* Who: photo, name, where you stand. */}
          <div className="flex flex-col items-center gap-2 px-5 pb-4 pt-6 text-center">
            <PersonPhotoButton
              person={person}
              className="size-24"
              logoClassName="!size-24 !rounded-full"
              fallback={<span className="grid size-24 place-items-center rounded-full bg-indigo-50 text-3xl font-semibold text-indigo-600">{initial}</span>}
            />
            {editing ? (
              <form
                className="flex w-full max-w-xs items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename();
                }}
              >
                <Input autoFocus value={name} maxLength={40} aria-label="Name" onChange={(e) => setName(e.target.value)} />
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
                    setName(person.name);
                    setError(null);
                  }}
                >
                  <X />
                </Button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setName(person.name);
                  setEditing(true);
                }}
                className="group flex max-w-full items-center gap-1.5 rounded-lg px-2 py-0.5 hover:bg-muted"
                title="Rename"
              >
                <DialogTitle className="truncate text-xl">{person.name}</DialogTitle>
                <Pencil className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-label="Rename" />
              </button>
            )}
            <DialogDescription asChild>
              <div className="text-sm">
                {owed > 0 && <span className="font-medium text-emerald-700">Owes you {formatRupees(owed)}</span>}
                {owed > 0 && owe > 0 && " · "}
                {owe > 0 && <span className="font-medium text-rose-700">You owe {formatRupees(owe)}</span>}
                {owed === 0 && owe === 0 && "All settled"}
                {person.aliases?.length ? <p className="mt-0.5 text-xs text-muted-foreground">Also {person.aliases.join(", ")}</p> : null}
              </div>
            </DialogDescription>
            {error && <p className="w-full rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-800">{error}</p>}
          </div>

          {/* What you can do with them. */}
          <div className="grid border-y sm:grid-cols-2 sm:divide-x">
            <SheetAction icon={<UsersRound />} label="Other names & merge" onClick={() => setNamesOpen(true)} />
            <SheetAction icon={<ChevronRight />} label={`All ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`} href={entriesHref} onClick={toEntries} />
          </div>

          {/* The business between you, by kind and by category. */}
          {together && <TogetherSummary summary={together} categories={f.categories} categoryLimit={50} className="border-t-0 px-5 pt-4" />}

          {entries.length > 0 && (
            <section aria-label="Latest entries" className="mt-4 border-t">
              <h3 className="px-5 pt-3 text-xs font-medium text-muted-foreground">Latest entries · tap one to change it</h3>
              <ul className="divide-y">
                {entries.slice(0, RECENT).map((e) => (
                  <EventRow key={e.id} event={e} onOpen={entryDialog.isOpen ? () => openEntry(e.id) : undefined} />
                ))}
              </ul>
              {entries.length > RECENT && (
                <Link href={entriesHref} onClick={toEntries} className="block border-t px-5 py-3 text-sm font-medium text-emerald-700 hover:underline">
                  See all {entries.length} entries
                </Link>
              )}
            </section>
          )}

          <div className="border-t px-5 py-4">
            {confirmDelete ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-red-800">Delete {person.name}?</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="destructive" onClick={remove}>
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="w-full text-destructive hover:bg-red-50 hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete person
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* Over the sheet, so Back closes just this and returns to the sheet. */}
      {namesOpen && <PersonNamesDialog person={person} onClose={() => setNamesOpen(false)} />}
    </>
  );
}

function SheetAction({ icon, label, onClick, href }: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string }) {
  const cls = "flex items-center justify-between gap-2 px-5 py-3 text-sm font-medium hover:bg-muted/60 [&_svg]:size-4 [&_svg]:text-muted-foreground max-sm:border-b max-sm:last:border-b-0";
  return href ? (
    <Link href={href} onClick={onClick} className={cls}>
      {label}
      {icon}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {label}
      {icon}
    </button>
  );
}
