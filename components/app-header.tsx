"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CalendarDays, FileUp, LayoutDashboard, Plus, RefreshCw, Wallet } from "lucide-react";
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
          className="mx-auto flex max-w-[2000px] items-center justify-between gap-x-3 px-4 py-2 lg:gap-x-6 sm:rounded-full sm:bg-card/75 sm:py-1.5 sm:pl-3 sm:pr-2 sm:shadow-lg sm:shadow-slate-900/10"
        >
          <div className="flex min-w-0 items-center gap-1 sm:shrink-0">
            <Suspense fallback={null}>
              <BackButton />
            </Suspense>
            <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:rounded-full">
                <Wallet className="size-4" />
              </span>
              {/* Phones sideways and small tablets: the pages and buttons need the room, so the logo stands alone and the bar is tighter. */}
              <span className="truncate font-brand text-xl font-bold leading-none tracking-tight sm:max-lg:sr-only">Money Manager</span>
            </Link>
          </div>

          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {NAV.map(({ href, label }) =>
              pathname === href ? (
                <LiquidButton key={href} asChild size="sm" className="rounded-full px-2.5 text-sm font-semibold text-foreground lg:px-4">
                  <Link href={href} aria-current="page">
                    {label}
                  </Link>
                </LiquidButton>
              ) : (
                <Link key={href} href={href} className="flex h-8 items-center rounded-full px-2.5 text-sm font-medium text-muted-foreground transition-colors lg:px-4 hover:text-foreground">
                  {label}
                </Link>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2">
            <LiquidButton asChild size="default" className="hidden rounded-full text-foreground sm:inline-flex" data-testid="import-statement">
              <Link href="/import" title="Import statement">
                <FileUp /> <span className="max-md:sr-only">Import</span> <span className="-ml-1 max-lg:hidden">statement</span>
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
  // Activity opens on its calendar; the list is its other view (Calendar / Statement), so the tab stays lit on it too.
  { href: "/calendar", label: "Calendar", icon: CalendarDays, also: "/activity" },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/import", label: "Import", icon: FileUp },
];

/** Past the top of the page, scrolling down shrinks the bar (as Instagram does); scrolling up or reaching the top brings it back. */
function useCompactOnScroll(pathname: string) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    setCompact(false);
    // Phones scroll the body (see globals.css), other screens the window; inner scrollers (the account cards) are ignored.
    let last = -1;
    let travel = 0;
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.scrollingElement : e.target;
      if (el !== document.body && el !== document.scrollingElement) return;
      const top = (el as Element).scrollTop;
      if (last < 0) last = top;
      const delta = top - last;
      last = top;
      if (top < 40) {
        travel = 0;
        setCompact(false);
        return;
      }
      // Small wobbles (a finger resting, iOS bounce) don't flip it: it takes a short run in one direction.
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel > 12) setCompact(true);
      else if (travel < -12) setCompact(false);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [pathname]);
  return compact;
}

/** An iOS-like glide: quick to start, long soft settle. */
const EASE = "duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

function MobileNav({ pathname, onAdd }: { pathname: string; onAdd: () => void }) {
  const compact = useCompactOnScroll(pathname);
  const tab = ({ href, label, icon: Icon, also }: (typeof TABS)[number]) => {
    const active = pathname === href || pathname === also;
    const body = (
      <>
        <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
        <span
          className={cn(
            "leading-tight transition-opacity duration-200 ease-out motion-reduce:transition-none",
            compact && "opacity-0",
          )}
        >
          {label}
        </span>
      </>
    );
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          // Positioned above the glass layers (they're positioned too, so they'd otherwise paint over the tabs, as Safari does).
          "relative z-10 flex min-w-0 flex-1 items-center justify-center text-[11px] font-medium transition-transform active:scale-95",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {/* Shrunk, the name fades and the icon slides down to the middle (a transform, so it stays smooth). */}
        <span
          className={cn(
            "flex flex-col items-center gap-0.5 px-2 py-1.5 transition-transform will-change-transform",
            EASE,
            compact && "translate-y-2",
            active && "font-semibold",
          )}
        >
          {body}
        </span>
      </Link>
    );
  };

  return (
    // A floating liquid glass pill (like the header from tablet width up). A light blur sits in its own layer behind the glass:
    // on the bar itself it would hide the glass distortion (which iPhones don't draw, so there the blur is what frosts it).
    // It dips 1rem into the home-indicator area (34pt on iPhones as a home-screen app) so it doesn't float high above it.
    <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,calc(env(safe-area-inset-bottom)_-_1rem))] sm:hidden">
      {/* touch-none: a drag on the bar would otherwise move the page around the scroller (taps still work). */}
      {/* Shrunk while scrolling down, icons only. Only transform and opacity animate: the phone's graphics chip runs them
          on its own, where changing the size would redo the layout (and the blur) every frame and stutter. */}
      <LiquidGlass
        className={cn(
          "pointer-events-auto mx-auto flex h-16 max-w-[32rem] origin-bottom touch-none items-stretch rounded-full bg-slate-200/75 px-1 dark:bg-card/75 shadow-lg shadow-slate-900/15",
          "transition-transform will-change-transform",
          EASE,
          compact && "scale-[0.86]",
        )}
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 -z-20 rounded-[inherit] [-webkit-backdrop-filter:blur(6px)] [backdrop-filter:blur(6px)]" />
        {TABS.slice(0, 2).map(tab)}
        <div className="flex flex-1 items-center justify-center">
          {/* White liquid glass, a shade lighter than the bar, centred in it; the green + marks the main action. */}
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
