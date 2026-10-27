"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatExactINR } from "@/lib/charts/format";
import { activityHref } from "@/lib/charts/links";
import { familyIds } from "@/lib/domain/categories";
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
  const { book, ledger, today, expenseCategories } = useFinance();
  const budgets = useBudgets();
  return useMemo(() => {
    const ym = monthKey(today);
    const spent = periodReport(book, ledger, monthStart(ym), monthEnd(ym)).expensesByCategory;
    // A main category's budget counts what was spent on its subcategories too.
    const rolledUp = Object.keys(budgets).map((id) => {
      const family = new Set(familyIds(id, expenseCategories));
      return { categoryId: id, amountMinor: spent.filter((s) => family.has(s.categoryId)).reduce((t, s) => t + s.amountMinor, 0) };
    });
    return budgetLines(budgets, rolledUp);
  }, [budgets, book, ledger, today, expenseCategories]);
}

const CHART_HEIGHT = 140;

/** Short rupee amounts (₹1.2k) so labels never crowd neighbouring bars. */
function compactINR(minor: number): string {
  const rupees = Math.round(minor / 100);
  if (rupees >= 100000) return `₹${+(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000) return `₹${+(rupees / 1000).toFixed(1)}k`;
  return `₹${rupees}`;
}

/** One vertical bar per category: the grey track is the budget, the fill is what's spent, red pokes above it when over. */
function BudgetColumns({ line, category, scaleMinor, index, dense }: { line: BudgetLine; category: ReturnType<ReturnType<typeof useFinance>["getCategory"]>; scaleMinor: number; index: number; dense: boolean }) {
  const { limitMinor, spentMinor, state } = line;
  const px = (minor: number) => Math.round((minor / scaleMinor) * CHART_HEIGHT);
  const trackPx = Math.max(4, px(limitMinor));
  const fillPx = Math.min(trackPx, px(Math.min(spentMinor, limitMinor)));
  const overPx = px(Math.max(0, spentMinor - limitMinor));
  // Bars grow up from the baseline once mounted, staggered by position.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const grow = (ms: number) => ({ transition: `height 800ms cubic-bezier(0.22, 1, 0.36, 1) ${ms}ms` });
  const fillGradient = state === "near" ? "from-amber-400 to-orange-500" : "from-emerald-400 to-teal-500";

  return (
    <li className="min-w-0">
      <Link
        href={activityHref({ category: line.categoryId })}
        aria-label={`${category.name}: spent ${formatExactINR(spentMinor)} of a ${formatExactINR(limitMinor)} budget`}
        title={`${category.name}: ${formatExactINR(spentMinor)} of ${formatExactINR(limitMinor)}`}
        className="group block rounded-2xl px-0 py-1.5 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex flex-col items-center justify-end" style={{ height: CHART_HEIGHT + 18 }}>
          <span
            className={cn(
              "mb-1 text-[11px] font-semibold tabular-nums transition-opacity duration-700",
              shown ? "opacity-100" : "opacity-0",
              state === "over" ? "text-rose-600" : "text-slate-900",
            )}
          >
            {compactINR(spentMinor)}
          </span>
          <div className="flex w-full max-w-11 flex-col justify-end transition-transform duration-300 group-hover:scale-105">
            {overPx > 0 && (
              <div
                className="rounded-t-xl bg-gradient-to-t from-rose-500 to-red-400 shadow-[0_0_14px_rgba(244,63,94,0.55)]"
                style={{ height: shown ? overPx : 0, ...grow(index * 90 + 500) }}
              />
            )}
            <div
              className={cn(
                "flex flex-col justify-end overflow-hidden bg-gradient-to-t from-slate-100 to-slate-200 ring-1 ring-inset ring-slate-200/70",
                overPx > 0 ? "" : "rounded-t-xl",
              )}
              style={{ height: trackPx }}
            >
              <div
                className={cn("bg-gradient-to-t", fillGradient)}
                style={{ height: shown ? fillPx : 0, ...grow(index * 90) }}
              />
            </div>
          </div>
        </div>
        <div className="h-px bg-slate-200" />
        {dense ? (
          <p
            className="mx-auto mt-2 h-16 overflow-hidden text-[11px] font-medium text-slate-700"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", textOverflow: "ellipsis" }}
          >
            {category.name}
          </p>
        ) : (
          <p className="mt-2 w-full truncate text-center text-[11px] font-medium text-slate-700">{category.name}</p>
        )}
      </Link>
    </li>
  );
}

export function BudgetsSection() {
  const { getCategory } = useFinance();
  const lines = useMonthBudgetLines();
  const [editing, setEditing] = useState(false);
  // One shared scale so every category's bars are comparable.
  const scaleMinor = Math.max(1, ...lines.map((l) => Math.max(l.limitMinor, l.spentMinor)));

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
          <div>
            <div className="mb-3 flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-slate-200" /> Budget</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-gradient-to-t from-emerald-400 to-teal-500" /> Spent</span>
              <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-gradient-to-t from-rose-500 to-red-400" /> Over budget</span>
            </div>
            <ul className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${lines.length}, minmax(0, 1fr))` }} data-testid="budgets-list">
              {lines.map((l, i) => (
                <BudgetColumns key={l.categoryId} line={l} category={getCategory(l.categoryId)} scaleMinor={scaleMinor} index={i} dense={lines.length > 6} />
              ))}
            </ul>
          </div>
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
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.parentId ? `↳ ${c.name}` : c.name}</span>
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
