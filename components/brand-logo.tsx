"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** A service's real logo (a static file in /public/brands), on a white tile. Falls back to `fallback` if there is none. */
export function BrandLogo({ slug, name, className, fallback }: { slug?: string; name: string; className?: string; fallback: React.ReactNode }) {
  const [broken, setBroken] = useState(false);
  if (!slug || broken) return <>{fallback}</>;
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-100 bg-white", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brands/${slug}.png`} alt={`${name} logo`} width={28} height={28} className="size-7 object-contain" loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}
