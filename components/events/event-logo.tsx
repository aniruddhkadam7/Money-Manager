"use client";

import { brandFor } from "@/lib/finance/brands";
import type { FinancialEvent } from "@/lib/finance/types";
import { BrandLogo } from "../brand-logo";
import { CategoryIcon } from "../category-icon";
import { useFinance } from "../finance-provider";
import { PictureIcon } from "../picture-icon";
import { eventPicture } from "./event-meta";

/**
 * An entry's picture, the same everywhere it appears: spending at (or money back from) a recognisable service
 * shows its logo; anything else keeps its category picture. The bank's own narration is read too, so
 * "PCI/6496/GITHUB* ..." is GitHub even if named oddly. `tile` is the list size; otherwise size it with `className`.
 */
export function EventLogo({ event, tile = false, className }: { event: FinancialEvent; tile?: boolean; className?: string }) {
  const { describer, getCategory } = useFinance();
  const picture = eventPicture(event, getCategory);
  const withMerchant = event.type === "expense" || event.type === "income" || event.type === "reimbursable_expense" || event.type === "split_expense";
  const narration = (event.sources ?? []).map((s) => s.narration ?? "").join(" ");
  const brand = withMerchant ? (event.description ? brandFor(event.description) : null) ?? (narration ? brandFor(narration) : null) : null;
  return (
    <BrandLogo
      slug={brand?.slug}
      name={brand?.name ?? describer.title(event)}
      className={className}
      fallback={
        picture.category ? (
          <CategoryIcon category={picture.category} tile={tile} className={className} />
        ) : (
          <PictureIcon name={picture.name} tile={tile} className={className} />
        )
      }
    />
  );
}
