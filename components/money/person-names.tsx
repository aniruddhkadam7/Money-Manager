"use client";

import { useState } from "react";
import { GitMerge, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Person } from "@/lib/finance/types";
import { useFinance } from "../finance-provider";
import { useToast } from "../toast";

/**
 * One person's names: the other names they go by (as banks or UPI write them, nicknames, a business name), so
 * payments under any of them count as theirs; and merging another person into them when both are the same.
 */
export function PersonNamesDialog({ person, onClose }: { person: Person; onClose: () => void }) {
  const f = useFinance();
  const toast = useToast();
  // The person as they are now (names change as you add them here).
  const me = f.book.people.find((p) => p.id === person.id) ?? person;
  const aliases = me.aliases ?? [];
  const others = f.book.people.filter((p) => p.id !== me.id).sort((a, b) => a.name.localeCompare(b.name));
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mergeId, setMergeId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const merging = others.find((p) => p.id === mergeId);

  const save = (next: string[]) => {
    const r = f.setPersonAliases(me.id, next);
    setError(r.ok ? null : (r.issues[0]?.message ?? "Couldn't save that."));
    return r.ok;
  };
  const add = () => {
    if (!name.trim()) return;
    if (save([...aliases, name])) setName("");
  };

  const merge = () => {
    if (!merging) return;
    const r = f.mergePeople(me.id, merging.id);
    if (!r.ok) {
      setError(r.issues[0]?.message ?? "Couldn't merge them.");
      setConfirming(false);
      return;
    }
    toast.show({ message: `${merging.name} merged into ${me.name}.`, duration: 5000 });
    setMergeId("");
    setConfirming(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{me.name}</DialogTitle>
          <DialogDescription>Other names they go by, and merging when two people are the same person.</DialogDescription>
        </DialogHeader>

        <section className="grid gap-2" aria-label="Other names" data-testid="person-aliases">
          <Label htmlFor="alias">Other names</Label>
          {aliases.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {aliases.map((a) => (
                <li key={a} className="flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-2.5 pr-1 text-sm">
                  {a}
                  <button type="button" aria-label={`Remove ${a}`} onClick={() => save(aliases.filter((x) => x !== a))} className="grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">None yet.</p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <Input id="alias" value={name} maxLength={40} placeholder="e.g. BIT HUB TE, Raju, a shop name" onChange={(e) => setName(e.target.value)} />
            <Button type="submit" variant="outline" disabled={!name.trim()}>
              <Plus /> Add
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">Payments that name any of these (a UPI line from your bank statement, say) count as {me.name}&apos;s, and new statements find them by these names too.</p>
        </section>

        {others.length > 0 && (
          <section className="grid gap-2 border-t pt-4" aria-label="Merge" data-testid="person-merge">
            <Label>Same person as…</Label>
            <Select
              value={mergeId}
              onValueChange={(v) => {
                setMergeId(v);
                setConfirming(false);
              }}
            >
              <SelectTrigger aria-label="Person to merge in">
                <SelectValue placeholder="Pick someone to merge into this person" />
              </SelectTrigger>
              <SelectContent>
                {others.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {merging && !confirming && (
              <Button variant="outline" className="justify-self-start" onClick={() => setConfirming(true)}>
                <GitMerge /> Merge {merging.name} into {me.name}
              </Button>
            )}
            {merging && confirming && (
              <div className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p>
                  Everything with <strong>{merging.name}</strong> moves to <strong>{me.name}</strong>, and what you owe each other adds up as one. “{merging.name}” is kept as one of {me.name}&apos;s other
                  names.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={merge}>
                    Merge
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
