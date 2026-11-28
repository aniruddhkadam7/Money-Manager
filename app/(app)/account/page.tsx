import { Suspense } from "react";
import { AccountView } from "@/components/money/account-view";

export const metadata = { title: "Account · Money Manager" };

export default function AccountPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />}>
      <AccountView />
    </Suspense>
  );
}
