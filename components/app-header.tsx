"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { FileUp, LayoutDashboard, Plus, ReceiptText, RefreshCw, Wallet } from "lucide-react";
import { flush } from "@/lib/cloud/sync";
import { Button } from "@/components/ui/button";
import { LiquidButton, LiquidGlass } from "@/components/ui/liquid-glass-button";
import { cn } from "@/lib/utils";
import { BackButton } from "./back-button";
import { ProfileMenu } from "./profile-menu";
import { useEventDialog } from "./events/event-dialog";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/activity", label: "Activity" },
  { href: "/calendar", label: "Calendar" },
  { href: "/money", label: "Money" },
];

/**
 * Tablet and up: a floating liquid glass bar with the pages, Import and Add; the current page is a glass tab.
 * Phones: a slim full-width top bar (no room to float), and a bottom tab bar (MobileNav) within thumb reach.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { openAdd } = useEventDialog();

  return (
    <>
      <header className="glass-bar sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] shadow-sm sm:border-0 sm:bg-transparent sm:px-4 sm:pt-3 sm:shadow-none sm:[-webkit-backdrop-filter:none] sm:[backdrop-filter:none] lg:px-6">
        {/* The liquid layers distort what scrolls behind the bar, so the bar itself has no blur of its own (it would hide the effect). */}
        <LiquidGlass
          layersClassName="max-sm:hidden"
          className="mx-auto flex max-w-[2000px] items-center justify-between gap-x-6 px-4 py-2 sm:rounded-full sm:bg-card/75 sm:py-1.5 sm:pl-3 sm:pr-2 sm:shadow-lg sm:shadow-slate-900/10"
        >
          <div className="flex min-w-0 items-center gap-1">
            <Suspense fallback={null}>
              <BackButton />
            </Suspense>
            <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:rounded-full">
                <Wallet className="size-4" />
              </span>
              <span className="truncate font-brand text-xl font-bold leading-none tracking-tight">Money Manager</span>
            </Link>
          </div>

          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {NAV.map(({ href, label }) =>
              pathname === href ? (
                <LiquidButton key={href} asChild size="sm" className="rounded-full px-4 text-sm font-semibold text-foreground">
                  <Link href={href} aria-current="page">
                    {label}
                  </Link>
                </LiquidButton>
              ) : (
                <Link key={href} href={href} className="flex h-8 items-center rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                  {label}
                </Link>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2">
            <LiquidButton asChild size="default" className="hidden rounded-full text-foreground sm:inline-flex" data-testid="import-statement">
              <Link href="/import">
                <FileUp /> Import statement
              </Link>
            </LiquidButton>
            <LiquidButton size="default" className="hidden rounded-full font-semibold sm:inline-flex" onClick={() => openAdd()}>
              <Plus /> Add
            </LiquidButton>
            <RefreshButton />
            <ProfileMenu />
          </div>
        </LiquidGlass>
      </header>
      <MobileNav pathname={pathname} onAdd={() => openAdd()} />
    </>
  );
}

const TABS = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  // The calendar is Activity's other view (List / Calendar), so the tab stays lit on it.
  { href: "/activity", label: "Activity", icon: ReceiptText, also: "/calendar" },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/import", label: "Import", icon: FileUp },
];

function MobileNav({ pathname, onAdd }: { pathname: string; onAdd: () => void }) {
  const tab = ({ href, label, icon: Icon, also }: (typeof TABS)[number]) => {
    const active = pathname === href || pathname === also;
    const body = (
      <>
        <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
        {label}
      </>
    );
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center justify-center text-[11px] font-medium transition-transform active:scale-95",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        <span className={cn("flex flex-col items-center gap-0.5 px-2 py-1.5", active && "font-semibold")}>{body}</span>
      </Link>
    );
  };

  return (
    // A floating liquid glass pill (like the header from tablet width up). The bar itself has no blur: it would hide the glass distortion.
    <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:hidden">
      <LiquidGlass className="pointer-events-auto flex h-16 items-stretch rounded-full bg-card/75 px-1 shadow-lg shadow-slate-900/15">
        {TABS.slice(0, 2).map(tab)}
        <div className="flex flex-1 items-center justify-center">
          {/* The same white liquid glass as the bar, centred in it; the green + marks the main action. */}
          <LiquidButton
            size="icon"
            onClick={onAdd}
            aria-label="Add an entry"
            className="z-20 size-12 rounded-full bg-card/85 text-primary shadow-lg shadow-slate-900/15 hover:scale-100 active:scale-95"
          >
            <Plus className="size-7" strokeWidth={2.6} />
          </LiquidButton>
        </div>
        {TABS.slice(2).map(tab)}
      </LiquidGlass>
    </nav>
  );
}

/**
 * Phones have no reload button in a home-screen app, and pull-to-refresh is easy to miss: this saves anything
 * waiting to upload, then reloads so the latest data (from other devices too) is shown.
 */
function RefreshButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="sm:hidden"
      aria-label="Refresh"
      title="Refresh"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await flush().catch(() => undefined);
        window.location.reload();
      }}
    >
      <RefreshCw className={cn(busy && "animate-spin")} />
    </Button>
  );
}
