"use client";

import { useState } from "react";
import { bankBrandFor, bankLogoSrc } from "@/lib/finance/bank-logos";
import type { Account } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE_INFO } from "./money/account-dialog";
import { PictureIcon } from "./picture-icon";
import { useStatements } from "./statements/statements-provider";

/** The bank any of the account's imported statements names. */
export function useBankHints(): (accountId: string) => string | undefined {
  const { imports } = useStatements();
  return (id) => imports.find((i) => i.accountId === id && i.status !== "FAILED" && i.bankHint)?.bankHint;
}

/**
 * A 3D picture of what the account is (Microsoft's Fluent emoji, MIT, in /public/icons3d), for accounts no
 * bank logo fits. Read from the name first, since "Debit card" and "Net banking" are both bank accounts.
 */
function picture3d(account: Account): string | null {
  const name = account.name.toLowerCase();
  if (account.type === "credit_card") return "card";
  if (account.type === "cash") return /wallet|purse|paytm|phonepe|gpay|google pay|amazon pay|mobikwik/.test(name) ? "wallet" : "cash";
  if (account.type === "bank") return /card/.test(name) ? "card" : /net ?banking|online/.test(name) ? "laptop" : "bank";
  return null;
}

/**
 * The bank's official logo when the account or its statement names a known bank, else its 3D picture (or, failing that, the account-type picture).
 * `tile` is the large list size (as tall as a PictureIcon tile); otherwise a compact badge.
 */
export function AccountLogo({ account, bankHint, tile = false }: { account: Account; bankHint?: string; tile?: boolean }) {
  const brand = bankBrandFor(account.name, bankHint);
  const [broken, setBroken] = useState(false);
  const [broken3d, setBroken3d] = useState(false);
  const pic = picture3d(account);
  if ((!brand || broken) && pic && !broken3d) {
    return (
      <span
        className={cn(
          "palette-fixed flex shrink-0 items-center justify-center border border-slate-200/80 bg-gradient-to-b from-white to-slate-50",
          tile ? "size-11 rounded-[14px] p-1 shadow-[0_4px_10px_-6px_rgba(15,23,42,0.25)]" : "size-8 rounded-md border-slate-100 p-0.5",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/icons3d/${pic}.png`} alt="" className="h-full w-full object-contain" loading="lazy" onError={() => setBroken3d(true)} />
      </span>
    );
  }
  if (!brand || broken) return <PictureIcon name={ACCOUNT_TYPE_INFO[account.type].picture} tile={tile} className={tile ? undefined : "size-8"} />;
  return (
    // A fixed box: most bank logos carry the bank's name, so they need width more than height.
    <span
      className={cn(
        "palette-fixed flex shrink-0 items-center justify-center border border-slate-200/80 bg-white",
        tile ? "h-11 w-16 rounded-[14px] p-1.5 shadow-[0_4px_10px_-6px_rgba(15,23,42,0.25)]" : "h-8 w-16 rounded-md border-slate-100 p-1",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={bankLogoSrc(brand)} alt={`${brand.name} logo`} className="h-full w-full object-contain" loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}
