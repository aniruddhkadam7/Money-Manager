"use client";

import type { Reminder } from "@/lib/finance/reminders";
import { AccountLogo, useBankHints } from "./account-logo";
import { BrandLogo, PartyLogo } from "./brand-logo";
import { CategoryIcon } from "./category-icon";
import { useFinance } from "./finance-provider";
import { PictureIcon } from "./picture-icon";

/**
 * A bill's real logo: the card's bank, a subscription's service, or the company a bill you added is named after;
 * a category picture (or a bill icon) when there is no logo for it.
 */
export function ReminderLogo({ r }: { r: Reminder }) {
  const { book, getCategory } = useFinance();
  const bankOf = useBankHints();

  if (r.kind === "card") {
    const account = book.accounts.find((a) => a.id === r.accountId);
    return account ? <AccountLogo account={account} bankHint={bankOf(account.id)} tile /> : <PictureIcon name="credit-card" className="size-9 shrink-0" />;
  }
  const fallback = r.categoryId ? <CategoryIcon category={getCategory(r.categoryId)} tile className="!size-9 !rounded-lg" /> : <PictureIcon name="bills" className="size-9 shrink-0" />;
  return r.brand ? <BrandLogo slug={r.brand} name={r.title} fallback={fallback} /> : <PartyLogo name={r.title} fallback={fallback} />;
}
