"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const KEY = "money-manager:navigated";

/**
 * "Back" at the top of every page except the dashboard. It returns to the previous screen when you got
 * here inside the app, and to the dashboard when the page was opened directly (a bookmark, a new tab),
 * so it never leaves the app. Screens with their own way back (a statement's "All imports") don't show it.
 */
export function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const first = useRef(pathname + params.toString());

  // Remember, for this tab, that a navigation inside the app has happened.
  useEffect(() => {
    if (pathname + params.toString() !== first.current) {
      try {
        window.sessionStorage.setItem(KEY, "1");
      } catch {
        /* private mode: falls back to the dashboard */
      }
    }
  }, [pathname, params]);

  if (pathname === "/" || (pathname === "/import" && params.get("import"))) return null;

  const back = () => {
    let inApp = false;
    try {
      inApp = window.sessionStorage.getItem(KEY) === "1" && window.history.length > 1;
    } catch {
      inApp = false;
    }
    if (inApp) router.back();
    else router.push("/");
  };

  return (
    <button
      type="button"
      onClick={back}
      className="mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      data-testid="back-button"
    >
      <ArrowLeft className="size-4" /> Back
    </button>
  );
}
