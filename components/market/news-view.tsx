"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, ExternalLink, Newspaper } from "lucide-react";
import { NEWS_TOPICS, type NewsResponse, type NewsStory, type NewsTopic } from "@/lib/market/news";
import { cn } from "@/lib/utils";

const TOPIC_LABEL = Object.fromEntries(NEWS_TOPICS.map((t) => [t.value, t.label])) as Record<NewsTopic, string>;

/** "12 min ago", "3 h ago", "Yesterday", "9 Oct". */
function ago(ms: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return "Yesterday";
  return new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** A short outlet name for the chips: "Economic Times", not "The Economic Times | Markets". */
const outlet = (name: string) => name.replace(/^the\s+/i, "").replace(/\.com$/i, "").replace(/\s*[|–-].*$/, "");

function Story({ story }: { story: NewsStory }) {
  const lead = story.sources[0];
  const others = story.sources.slice(1);
  return (
    <li className="rounded-2xl border glass p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        {story.official ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700">
            <BadgeCheck className="size-3" /> RBI official
          </span>
        ) : story.sources.length > 1 ? (
          <span className="rounded-md bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700">Covered by {story.sources.length} outlets</span>
        ) : null}
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">{TOPIC_LABEL[story.topic]}</span>
        <span className="text-slate-500">{ago(story.published)}</span>
      </div>
      <a href={lead.link} target="_blank" rel="noopener noreferrer" className="group mt-2 block">
        <h3 className="text-[15px] font-semibold leading-snug text-slate-900 group-hover:underline">{story.title}</h3>
        {story.summary && <p className="mt-1 line-clamp-2 text-sm leading-snug text-slate-600">{story.summary}</p>}
      </a>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        <a href={lead.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-slate-700 hover:underline">
          {outlet(lead.name)} <ExternalLink className="size-3" />
        </a>
        {others.map((s) => (
          <a key={s.link} href={s.link} target="_blank" rel="noopener noreferrer" className="hover:text-slate-800 hover:underline">
            {outlet(s.name)}
          </a>
        ))}
      </p>
    </li>
  );
}

/**
 * Important finance and economy news: only stories about money or the economy, kept when an RBI policy
 * release, when two or more outlets cover them, or when they're about the big levers. Filter by topic.
 */
export function NewsView({ data, status, onRetry }: { data: NewsResponse | null; status: "loading" | "ready" | "error"; onRetry: () => void }) {
  const [topic, setTopic] = useState<NewsTopic | "all">("all");
  const stories = useMemo(() => data?.stories ?? [], [data]);
  const present = NEWS_TOPICS.filter((t) => stories.some((s) => s.topic === t.value));
  const shown = topic === "all" ? stories : stories.filter((s) => s.topic === topic);

  if (!data && status === "error")
    return (
      <section className="rounded-3xl border glass px-6 py-16 text-center">
        <p className="font-medium text-slate-900">Couldn&apos;t reach the news right now.</p>
        <button type="button" onClick={onRetry} className="mt-3 text-sm font-medium text-primary">
          Try again
        </button>
      </section>
    );
  if (!data)
    return (
      <div className="grid gap-3" aria-busy>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-3">
      {/* Topics: only those with stories today. */}
      <div data-swipe-ignore className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {[{ value: "all" as const, label: "All" }, ...present].map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTopic(t.value)}
            className={cn(
              "shrink-0 select-none rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              topic === t.value ? "border-transparent bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {t.label}
          </button>
        ))}
        <span aria-hidden className="w-px shrink-0 sm:hidden" />
      </div>

      {shown.length === 0 ? (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
          <Newspaper className="size-4" /> Nothing important on this right now.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((s) => (
            <Story key={s.id} story={s} />
          ))}
        </ul>
      )}

      <p className="text-center text-xs leading-relaxed text-slate-500">
        Only news about money and the economy. A story makes the list when two or more outlets cover it, when it&apos;s an RBI policy release, or
        when it&apos;s about rates, prices, growth, the rupee, oil, the budget, trade or food. Market tips and chatter are left out. From the
        Economic Times, Mint, Business Standard, BusinessLine, the RBI and Google News; refreshed about every 30 minutes.
        {data.failed.length > 0 && ` Not reachable just now: ${data.failed.join(", ")}.`}
      </p>
    </div>
  );
}
