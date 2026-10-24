"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Leaf, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { monthEnd, monthKey, monthStart } from "@/lib/domain/dates";
import { minorToInputString, parseAmountToMinor } from "@/lib/domain/money";
import { budgetLines, saveBudgets, useBudgets, type BudgetLine, type Budgets } from "@/lib/finance/budgets";
import { periodReport } from "@/lib/finance/state";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "../category-icon";
import { ChartCard } from "../charts/primitives";
import { useFinance } from "../finance-provider";

/** This month's budgets against what was spent, the most stretched first. */
function useMonthBudgetLines(): BudgetLine[] {
  const { book, ledger, today } = useFinance();
  const budgets = useBudgets();
  return useMemo(() => {
    const ym = monthKey(today);
    return budgetLines(budgets, periodReport(book, ledger, monthStart(ym), monthEnd(ym)).expensesByCategory);
  }, [budgets, book, ledger, today]);
}

/** One calm sentence about a budget: how much is left, or how far past it went. */
function sentence(name: string, l: BudgetLine): string {
  if (l.state === "over") return `${name} is ${formatExactINR(l.spentMinor - l.limitMinor)} past its ${formatExactINR(l.limitMinor)} plan this month.`;
  if (l.state === "near") return `${name} is at ${Math.round(l.ratio * 100)}% of its ${formatExactINR(l.limitMinor)} plan, with ${formatExactINR(l.limitMinor - l.spentMinor)} left this month.`;
  return `${formatExactINR(l.limitMinor - l.spentMinor)} left for ${name}.`;
}

/** A soft heads-up on Home when a budget is getting full. Nothing shows while all of them are comfortable. */
export function BudgetNudge({ className }: { className?: string }) {
  const { getCategory } = useFinance();
  const lines = useMonthBudgetLines().filter((l) => l.state !== "ok");
  if (lines.length === 0) return null;
  const first = lines[0];
  return (
    <a href="#budgets" className={cn("flex items-center gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 hover:bg-amber-100", className)}>
      <Leaf className="size-4 shrink-0" />
      <span>
        {sentence(getCategory(first.categoryId).name, first)}
        {lines.length > 1 && ` And ${lines.length - 1} more ${lines.length === 2 ? "budget is" : "budgets are"} close.`}
      </span>
    </a>
  );
}

export function BudgetsSection() {
  const { getCategory } = useFinance();
  const lines = useMonthBudgetLines();
  const [editing, setEditing] = useState(false);

  return (
    <div id="budgets" className="min-w-0 scroll-mt-24 [&>section]:h-full">
      <ChartCard
        title="Budgets this month"
        action={
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {lines.length > 0 ? <Pencil /> : <Plus />} {lines.length > 0 ? "Edit" : "Set budgets"}
          </Button>
        }
      >
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            Pick a monthly amount for the things you want to keep an eye on, like Food. You&apos;ll get a quiet note when one is nearly used up.
          </p>
        ) : (
          <ul className="grid gap-3" data-testid="budgets-list">
            {lines.map((l) => {
              const category = getCategory(l.categoryId);
              return (
                <li key={l.categoryId}>
                  <Link
                    href={activityHref({ category: l.categoryId })}
                    className="-mx-2 block rounded-xl px-2 py-1.5 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-3">
                      <CategoryIcon category={category} tile className="!size-9 !rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-[15px] font-medium text-slate-900">{category.name}</p>
                          <p className="shrink-0 text-xs tabular-nums text-slate-500">
                            {formatExactINR(l.spentMinor)} of {formatExactINR(l.limitMinor)}
                          </p>
                        </div>
                        <div
                          role="progressbar"
                          aria-label={`${category.name} budget`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.min(100, Math.round(l.ratio * 100))}
                          className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
                        >
                          <div
                            className={cn("h-full rounded-full", l.state === "ok" ? "bg-emerald-500" : "bg-amber-500")}
                            style={{ width: `${Math.min(100, l.ratio * 100)}%` }}
                          />
                        </div>
                        {l.state !== "ok" && <p className="mt-1 text-xs text-amber-700">{sentence(category.name, l)}</p>}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </ChartCard>
      {editing && <BudgetsDialog onClose={() => setEditing(false)} />}
    </div>
  );
}

/** A monthly amount per spending category; leave one blank for no budget. */
function BudgetsDialog({ onClose }: { onClose: () => void }) {
  const { expenseCategories } = useFinance();
  const budgets = useBudgets();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(budgets).map(([id, minor]) => [id, minorToInputString(minor)])),
  );
  const parsed = (id: string) => (values[id]?.trim() ? parseAmountToMinor(values[id]) : null);
  const invalid = expenseCategories.some((c) => values[c.id]?.trim() && parsed(c.id) === null);

  const save = () => {
    const next: Budgets = {};
    for (const c of expenseCategories) {
      const minor = parsed(c.id);
      if (minor) next[c.id] = minor;
    }
    saveBudgets(next);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Monthly budgets</DialogTitle>
          <DialogDescription>How much you&apos;d like to spend on each, per month. Leave blank for no budget.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1">
          {expenseCategories.map((c) => (
            <label key={c.id} className="flex items-center gap-3">
              <CategoryIcon category={c} tile className="!size-8 !rounded-lg" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
              <span className="relative w-32 shrink-0">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₹</span>
                <Input
                  inputMode="decimal"
                  className="pl-7"
                  placeholder="No budget"
                  aria-label={`${c.name} monthly budget`}
                  aria-invalid={!!values[c.id]?.trim() && parsed(c.id) === null}
                  value={values[c.id] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
                />
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={invalid}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
