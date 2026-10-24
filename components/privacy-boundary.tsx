"use client";

import type { ReactNode } from "react";
import { usePrivate } from "@/lib/privacy";

/**
 * The money formatters are plain functions, so flipping privacy mode has to redraw the screen they fed.
 * Keying the page on the mode does that; the data lives in providers above, so nothing is lost but
 * unsaved filters on the page.
 */
export function PrivacyBoundary({ children }: { children: ReactNode }) {
  const hidden = usePrivate();
  return <div key={hidden ? "hidden" : "shown"}>{children}</div>;
}
