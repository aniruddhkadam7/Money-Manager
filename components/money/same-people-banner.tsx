"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { likelySamePeople } from "@/lib/finance/book-ops";
import { formatRupees } from "@/lib/finance/describe";
import { cn } from "@/lib/utils";
import { useFinance } from "../finance-provider";
import { useToast } from "../toast";

/**
 * "Govindraj Ingle" and "Govindraj Ing" are one person the bank printed two ways. Until they're merged,
 * what you owe or are owed is split between two names and neither total is right. One tap merges them.
 */
export function SamePeopleBanner({ className }: { className?: string }) {
  const { book, state, mergePeople } = useFinance();
  const toast = useToast();
  const pairs = useMemo(() => likelySamePeople(book), [book]);
  if (pairs.length === 0) return null;

  const balance = (id: string) => {
    const p = state.people.find((x) => x.person.id === id);
    if (!p) return "";
    const net = p.owedToMe.outstandingMinor - p.iOwe.outstandingMinor;
    return net > 0 ? `owes you ${formatRupees(net)}` : net < 0 ? `you owe ${formatRupees(-net)}` : "settled";
  };

  const merge = (keepId: string, dropId: string, keepName: string, dropName: string) => {
    const r = mergePeople(keepId, dropId);
    toast.show({ message: r.ok ? `Merged “${dropName}” into “${keepName}”` : (r.issues[0]?.message ?? "Couldn't merge them.") });
  };

  return (
    <div className={cn("rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950", className)} data-testid="same-people">
      <p className="flex items-center gap-2 font-semibold">
        <Users className="size-4 shrink-0" />
        {pairs.length === 1 ? "These look like the same person" : `${pairs.length} people appear under two names`}
      </p>
      <p className="mt-0.5 text-amber-900/80">Banks sometimes cut names short. Until they're merged, what you owe or are owed is split between two names, so the totals are wrong.</p>
      <ul className="mt-3 grid gap-2">
        {pairs.map(([keep, drop]) => (
          <li key={drop.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2">
            <span>
              <strong>{keep.name}</strong> <span className="text-amber-900/70">({balance(keep.id)})</span> and <strong>{drop.name}</strong>{" "}
              <span className="text-amber-900/70">({balance(drop.id)})</span>
            </span>
            <Button size="sm" variant="outline" className="bg-white" onClick={() => merge(keep.id, drop.id, keep.name, drop.name)} data-testid="merge-people">
              Merge into “{keep.name}”
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
