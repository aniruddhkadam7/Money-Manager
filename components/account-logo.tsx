"use client";

import { useState } from "react";
import { bankBrandFor, bankLogoSrc } from "@/lib/finance/bank-logos";
import type { Account } from "@/lib/finance/types";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE_INFO } from "./money/account-dialog";
import { PictureIcon, type PictureName } from "./picture-icon";
import { useStatements } from "./statements/statements-provider";

/** The bank any of the account's imported statements names. */
export function useBankHints(): (accountId: string) => string | undefined {
  const { imports } = useStatements();
  return (id) => imports.find((i) => i.accountId === id && i.status !== "FAILED" && i.bankHint)?.bankHint;
}

/** What the account is, as an icon tile, for accounts no bank logo fits. Read from the name first, since "Debit card" and "Net banking" are both bank accounts. */
export function accountPicture(account: Pick<Account, "name" | "type">): PictureName {
  const name = account.name.toLowerCase();
  if (account.type === "cash") return /wallet|purse|paytm|phonepe|gpay|google pay|amazon pay|mobikwik/.test(name) ? "wallet" : "cash";
  if (account.type === "bank") return /card/.test(name) ? "debit-card" : /net ?banking|online/.test(name) ? "net-banking" : "bank";
  return ACCOUNT_TYPE_INFO[account.type].picture;
}

/**
 * The bank's official logo when the account or its statement names a known bank, else an icon of what the account is.
 * `tile` is the large list size (as tall as a PictureIcon tile); otherwise a compact badge.
 */
export function AccountLogo({ account, bankHint, tile = false }: { account: Account; bankHint?: string; tile?: boolean }) {
  const brand = bankBrandFor(account.name, bankHint);
  const [broken, setBroken] = useState(false);
  if (!brand || broken) return <PictureIcon name={accountPicture(account)} tile={tile} className={tile ? undefined : "size-8"} />;
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

/**
 * The bank's official logo at list-row size (inside a picker, beside a name), when the account names a known
 * bank; else `fallback`.
 */
export function BankMark({ name, bankHint, fallback = null }: { name: string; bankHint?: string; fallback?: React.ReactNode }) {
  const brand = bankBrandFor(name, bankHint);
  const [broken, setBroken] = useState(false);
  if (!brand || broken) return <>{fallback}</>;
  return (
    <span className="palette-fixed flex h-6 w-11 shrink-0 items-center justify-center rounded-md border border-slate-100 bg-white p-0.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={bankLogoSrc(brand)} alt={`${brand.name} logo`} className="h-full w-full object-contain" loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}
