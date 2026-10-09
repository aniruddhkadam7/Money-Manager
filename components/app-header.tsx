"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileUp, LayoutDashboard, Plus, ReceiptText, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CloudStatus } from "./cloud-status";
import { useEventDialog } from "./events/event-dialog";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/activity", label: "Activity" },
  { href: "/money", label: "Money" },
];

/**
 * Tablet and up: one header with the pages, Import and Add.
 * Phones: a slim top bar, and a bottom tab bar (MobileNav) within thumb reach.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { openAdd } = useEventDialog();

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card/90 shadow-sm backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-[2000px] items-center justify-between gap-x-6 px-4 py-2 sm:py-2.5 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wallet className="size-4" />
            </span>
            Money Manager
          </Link>

          <nav className="hidden flex-1 gap-1 sm:flex">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname === href ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="hidden sm:inline-flex" data-testid="import-statement">
              <Link href="/import">
                <FileUp /> Import statement
              </Link>
            </Button>
            <Button className="hidden sm:inline-flex" onClick={() => openAdd()}>
              <Plus /> Add
            </Button>
            <CloudStatus />
          </div>
        </div>
      </header>
      <MobileNav pathname={pathname} onAdd={() => openAdd()} />
    </>
  );
}

const TABS = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/activity", label: "Activity", icon: ReceiptText },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/import", label: "Import", icon: FileUp },
];

function MobileNav({ pathname, onAdd }: { pathname: string; onAdd: () => void }) {
  const tab = ({ href, label, icon: Icon }: (typeof TABS)[number]) => {
    const active = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors active:bg-muted",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
        {label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)] backdrop-blur sm:hidden"
    >
      <div className="flex h-16 items-stretch">
        {TABS.slice(0, 2).map(tab)}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={onAdd}
            aria-label="Add an entry"
            className="-mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-card transition-transform active:scale-95"
          >
            <Plus className="size-7" />
          </button>
        </div>
        {TABS.slice(2).map(tab)}
      </div>
    </nav>
  );
}
