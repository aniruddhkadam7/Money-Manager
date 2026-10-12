/**
 * Finance and economy news that matters, from free RSS feeds: the economy desks of Indian business
 * papers, Google News' Indian business front page (which carries Reuters and others), and the RBI's own
 * press releases. A story is kept only if it's about money or the economy, and counts as important when
 * it's an RBI policy release, when two or more outlets are covering it (the same story is grouped across
 * feeds), or when its headline is about one of the big levers (rates, inflation, growth, the rupee, oil,
 * the budget, trade, food). Market chatter (stock tips, IPO buzz, product launches) is left out.
 */

export type NewsTopic = "rates" | "prices" | "growth" | "markets" | "energy" | "trade" | "budget" | "food" | "world" | "banking";

export const NEWS_TOPICS: { value: NewsTopic; label: string }[] = [
  { value: "rates", label: "RBI & rates" },
  { value: "prices", label: "Prices" },
  { value: "growth", label: "Growth & jobs" },
  { value: "markets", label: "Markets" },
  { value: "energy", label: "Oil & energy" },
  { value: "trade", label: "Trade & rupee" },
  { value: "budget", label: "Budget & tax" },
  { value: "food", label: "Food & farming" },
  { value: "banking", label: "Banks & money" },
  { value: "world", label: "World" },
];

export interface NewsSource {
  name: string;
  link: string;
}

export interface NewsStory {
  id: string;
  title: string;
  summary: string | null;
  /** Every outlet covering it; the first is the one whose headline is shown. */
  sources: NewsSource[];
  /** Newest report, ms. */
  published: number;
  topic: NewsTopic;
  /** An RBI press release on policy. */
  official: boolean;
  /** Covered widely (or official): the page's "important" list. */
  important: boolean;
}

export interface NewsResponse {
  stories: NewsStory[];
  fetchedAt: number;
  /** Feeds that couldn't be read this time. */
  failed: string[];
}

export const FEEDS: { name: string; url: string; kind?: "google" | "rbi" }[] = [
  { name: "Economic Times", url: "https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms" },
  { name: "Mint", url: "https://www.livemint.com/rss/economy" },
  { name: "Business Standard", url: "https://www.business-standard.com/rss/economy-102.rss" },
  { name: "BusinessLine", url: "https://www.thehindubusinessline.com/economy/feeder/default.rss" },
  { name: "Google News", url: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en", kind: "google" },
  { name: "RBI", url: "https://www.rbi.org.in/pressreleases_rss.xml", kind: "rbi" },
];

/** Outlets trusted from Google News' mix (the papers' own feeds are trusted already). */
const TRUSTED =
  /reuters|bloomberg|business standard|mint|economic times|businessline|moneycontrol|financial express|cnbc|ndtv|the hindu|indian express|hindustan times|times of india|press trust|\bpti\b|business today|theprint|the print|bbc|financial times|wall street journal|associated press|investing\.com|the economist/i;

export interface FeedItem {
  title: string;
  link: string;
  summary: string | null;
  published: number;
  source: string;
  official: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .trim();
}
const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1];

/** RSS items, with Google News' "Headline - Publisher" split into headline and outlet. */
export function parseRss(xml: string, feed: (typeof FEEDS)[number]): FeedItem[] {
  const out: FeedItem[] = [];
  for (const item of xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? []) {
    let title = decode(tag(item, "title") ?? "");
    const link = decode(tag(item, "link") ?? "");
    const published = Date.parse(decode(tag(item, "pubDate") ?? ""));
    if (!title || !link) continue;
    let source = feed.name;
    if (feed.kind === "google") {
      const publisher = decode(tag(item, "source") ?? "");
      const cut = title.lastIndexOf(" - ");
      if (cut > 0) {
        source = publisher || title.slice(cut + 3);
        title = title.slice(0, cut);
      } else if (publisher) source = publisher;
    }
    // Google's description is a list of links, the RBI's a table: only the papers' are worth a line.
    const raw = feed.kind ? null : tag(item, "description");
    const summary = raw ? stripTags(decode(raw)).slice(0, 240) || null : null;
    if (feed.kind === "google" && !TRUSTED.test(source)) continue;
    out.push({ title, link, summary, published: Number.isFinite(published) ? published : 0, source, official: feed.kind === "rbi" });
  }
  return out;
}

/** The RBI's routine releases (daily operations, auctions, penalties on single banks) aren't news. */
const RBI_IMPORTANT = /monetary policy|policy repo|repo rate|governor|statement on development|financial stability report|annual report|inflation|forex reserves|rupee|liquidity measures|crr|cash reserve/i;

/** Market chatter, tips and fluff: not what this page is for. */
const NOISE =
  /stocks? to (buy|watch)|buy or sell|multibagger|target price|share price today|stock picks?|technical(s| view| chart)|penny stock|52-w(ee)?k high|gmp\b|ipo (gmp|subscription|allotment|listing)|top gainers|top losers|quiz|horoscope|photos?\b|in pics|video\b|watch:|live updates?|webinar|podcast|sponsored|brand ?post|which (stock|mutual fund)|q[1-4] results? (preview|live)|dividend|record date|bonus issue|stock split|adds new stock|portfolio|wealth|crorepati|trading plan|stock market today|market (outlook|prediction|wrap)|gift nifty|key factors|pre-?market|opening bell|closing bell|results? this week|q[1-4] results|earnings (preview|calendar)|launch(es|ed)?\b|price list|on-road price/i;

const TOPICS: [NewsTopic, RegExp][] = [
  ["rates", /\brbi\b|\brepo\b|monetary policy|interest rates?|rate (cut|hike)|central bank|federal reserve|\bfed\b|ecb\b|bond yield|yields?\b/i],
  ["prices", /inflation|\bcpi\b|\bwpi\b|prices? (rise|surge|jump|fall)|price rise|costlier|cost of living/i],
  ["energy", /crude|\boil\b|petrol|diesel|\blpg\b|\blng\b|opec|fuel|energy|power (cut|demand|tariff)|coal/i],
  ["food", /food|grain|wheat|rice|pulses|fertili[sz]er|monsoon|el ni[nñ]o|kharif|rabi|farm|crop|onion|tomato|sugar|edible oil/i],
  ["trade", /tariff|exports?|imports?|trade (deal|deficit|war|pact)|rupee|forex|current account|\bfdi\b|\bfpi\b|\bfii\b|dollar/i],
  ["budget", /budget|fiscal|\bgst\b|income tax|tax(es)?\b|deficit|borrowing|disinvestment|subsid/i],
  ["growth", /\bgdp\b|growth|recession|slowdown|jobs?\b|unemployment|employment|manufacturing|\bpmi\b|\biip\b|industrial output|imf|world bank|econom(y|ic|ics)|nobel/i],
  ["banking", /\bbanks?\b|lending|loans?|credit|nbfc|\bupi\b|deposits?|\bsebi\b|insurance|pension|\bepfo?\b|payments?/i],
  ["markets", /sensex|nifty|stock market|markets?\b|shares|equit|\bipo\b|gold|silver|bitcoin|crypto/i],
  ["world", /\bus\b|china|europe|global|world|ukraine|russia|iran|gulf|middle east|g20|wto/i],
];

/** The story's topic, from its headline first (a summary wanders); null when it isn't about money or the economy. */
export function topicOf(title: string, summary = ""): NewsTopic | null {
  return TOPICS.find(([, re]) => re.test(title))?.[0] ?? TOPICS.find(([, re]) => re.test(summary))?.[0] ?? null;
}

/** The big levers: a headline about one of these matters even if only one outlet has it yet. */
const MACRO =
  /\brbi\b|\brepo\b|monetary policy|inflation|\bcpi\b|\bwpi\b|\bgdp\b|recession|rupee|forex reserves|current account|crude|oil prices?|fuel prices?|petrol|diesel|budget|fiscal deficit|\bgst\b|income tax|tariff|trade deal|trade deficit|exports?|\bfed\b|federal reserve|\bimf\b|world bank|monsoon|el ni[nñ]o|fertili[sz]er|food (crisis|prices|inflation|security)|unemployment|jobs data|\bfdi\b|\bfpi\b|interest rates?|rate (cut|hike)|bond yields?|sensex|nifty|credit rating|downgrade|default/i;

export const isNoise = (title: string) => NOISE.test(title);

const STOP = new Set(
  "a an the of to in on for and or but with at by from as is are was were be been has have had its it this that these those will would can could may might should over after before into about amid says said say new more than up down vs why how what who when where here there india india's indian govt government cr crore lakh per cent percent rs year years week month today first".split(" "),
);
/** A headline's meaningful words, for telling whether two outlets are on the same story. */
export function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']s\b/g, "")
      .replace(/[^a-z0-9%.\s-]/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^[-.]+|[-.]+$/g, "").replace(/(?<=[a-z]{3})s$/, ""))
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function sameStory(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const union = a.size + b.size - shared;
  return shared >= 3 && shared / union >= 0.22;
}

const OUTLET_RANK = ["RBI", "Reuters", "Business Standard", "Mint", "Economic Times", "The Economic Times", "BusinessLine", "The Hindu BusinessLine", "Bloomberg", "Moneycontrol"];
const rank = (name: string) => {
  const i = OUTLET_RANK.findIndex((n) => name.toLowerCase().includes(n.toLowerCase()));
  return i < 0 ? OUTLET_RANK.length : i;
};

/**
 * Groups the items into stories (the same news across outlets), drops the noise and the stale, and
 * orders them: widely covered and official first, then by how recent.
 */
export function buildStories(items: FeedItem[], now = Date.now(), windowHours = 48): NewsStory[] {
  const fresh = items.filter(
    (i) => i.published > now - windowHours * 3600_000 && i.published <= now + 3600_000 && !isNoise(i.title) && (!i.official || RBI_IMPORTANT.test(i.title)),
  );
  const groups: { words: Set<string>; items: FeedItem[] }[] = [];
  for (const item of fresh.sort((a, b) => b.published - a.published)) {
    const w = words(item.title);
    const g = groups.find((x) => sameStory(x.words, w));
    if (g) {
      g.items.push(item);
      for (const word of w) g.words.add(word);
    } else groups.push({ words: w, items: [item] });
  }

  const stories = groups.map((g) => {
    const byOutlet = new Map<string, FeedItem>();
    for (const i of g.items) if (!byOutlet.has(i.source)) byOutlet.set(i.source, i);
    const outlets = [...byOutlet.values()].sort((a, b) => rank(a.source) - rank(b.source));
    const lead = outlets[0];
    const official = g.items.some((i) => i.official);
    // A summary that only repeats the headline adds nothing.
    const same = (x: string, y: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "") === y.toLowerCase().replace(/[^a-z0-9]/g, "");
    const summary = outlets.find((i) => i.summary && !same(i.summary, i.title) && !same(i.summary, lead.title))?.summary ?? null;
    return {
      id: lead.link,
      title: lead.title,
      summary,
      sources: outlets.map((i) => ({ name: i.source, link: i.link })),
      published: Math.max(...g.items.map((i) => i.published)),
      topic: topicOf(lead.title, summary ?? ""),
      official,
      important: official || outlets.length >= 2 || MACRO.test(lead.title),
    };
  });

  // Only what's about money or the economy, and important; widely covered and official first, then the latest.
  const kept = stories.filter((s): s is NewsStory => s.topic !== null && s.important);
  const score = (s: NewsStory) => (s.official ? 6 : 0) + s.sources.length * 2 + (MACRO.test(s.title) ? 1.5 : 0) - (now - s.published) / (12 * 3600_000);
  return kept.sort((a, b) => score(b) - score(a)).slice(0, 30);
}

export async function fetchNews(): Promise<NewsResponse> {
  const failed: string[] = [];
  const results = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
          headers: { "user-agent": "Mozilla/5.0 (compatible; MoneyManager/1.0)", accept: "application/rss+xml, application/xml, text/xml" },
        });
        if (!res.ok) throw new Error(String(res.status));
        return parseRss(await res.text(), feed);
      } catch {
        failed.push(feed.name);
        return [];
      }
    }),
  );
  const items = results.flat();
  if (!items.length) throw new Error("No news feeds answered");
  let stories = buildStories(items);
  // A quiet stretch (a weekend, a holiday): look back further rather than show almost nothing.
  if (stories.length < 6) stories = buildStories(items, Date.now(), 96);
  return { stories, fetchedAt: Date.now(), failed };
}
