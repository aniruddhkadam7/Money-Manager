"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * A page's tab kept in the address (`?tab=…`), so switching tabs is a step Back returns through, a refresh keeps the
 * tab, and a link can open one. The first tab is the page's own address, with no `?tab`. Pages using this sit inside
 * a Suspense boundary (useSearchParams needs one).
 */
export function useUrlTab<T extends string>(tabs: readonly { value: T }[]): [T, (tab: T, options?: { replace?: boolean }) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const first = tabs[0].value;
  const asked = params.get("tab");
  const tab = tabs.find((t) => t.value === asked)?.value ?? first;
  const setTab = (next: T, options?: { replace?: boolean }) => {
    if (next === tab) return;
    const query = new URLSearchParams(params.toString());
    if (next === first) query.delete("tab");
    else query.set("tab", next);
    const href = query.toString() ? `${pathname}?${query}` : pathname;
    // Switching tabs keeps your place on the page; Back puts the previous tab back.
    if (options?.replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  };
  return [tab, setTab];
}
