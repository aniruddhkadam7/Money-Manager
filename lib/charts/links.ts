import { monthEnd, monthStart } from "@/lib/domain/dates";

/** Where clicking a chart element should take the user: Activity, pre-filtered. */
export function activityHref(filters: { category?: string; group?: string; type?: string; account?: string; person?: string; owed?: "me" | "you"; q?: string; from?: string; to?: string }): string {
  const params = new URLSearchParams();
  if (filters.group) params.set("group", filters.group);
  if (filters.type) params.set("type", filters.type);
  if (filters.category) params.set("category", filters.category);
  if (filters.account) params.set("account", filters.account);
  if (filters.person) params.set("person", filters.person);
  if (filters.owed) params.set("owed", filters.owed);
  if (filters.q) params.set("q", filters.q);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const query = params.toString();
  return query ? `/activity?${query}` : "/activity";
}

export const monthFilter = (ym: string) => ({ from: monthStart(ym), to: monthEnd(ym) });
