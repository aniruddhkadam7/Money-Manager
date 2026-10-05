"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileUp, Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEventDialog } from "./events/event-dialog";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/activity", label: "Activity" },
  { href: "/money", label: "Money" },
];

export function AppHeader() {
  const pathname = usePathname();
  const { openAdd } = useEventDialog();

  return (
    <header className="sticky top-0 z-40 border-b bg-card/90 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-[2000px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wallet className="size-4" />
          </span>
          Money Manager
        </Link>

        <div className="flex items-center gap-2 sm:order-3">
          <Button asChild variant="outline" data-testid="import-statement">
            <Link href="/import">
              <FileUp /> <span className="hidden sm:inline">Import statement</span>
              <span className="sm:hidden">Import</span>
            </Link>
          </Button>
          <Button onClick={() => openAdd()}>
            <Plus /> Add
          </Button>
        </div>

        <nav className="order-last flex w-full gap-1 sm:order-2 sm:w-auto sm:flex-1">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                pathname === href
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
