import { describe, expect, it } from "vitest";
import { buildStories, decode, FEEDS, isNoise, parseRss, topicOf, type FeedItem } from "@/lib/market/news";

const NOW = Date.UTC(2026, 9, 12, 12);
const H = 3600_000;
const item = (title: string, source: string, hoursAgo = 1, extra: Partial<FeedItem> = {}): FeedItem => ({
  title,
  link: `https://example.com/${source}/${encodeURIComponent(title)}`,
  summary: null,
  published: NOW - hoursAgo * H,
  source,
  official: false,
  ...extra,
});

describe("reading feeds", () => {
  it("reads items, CDATA and entities, and splits Google's 'Headline - Publisher'", () => {
    const google = FEEDS.find((f) => f.kind === "google")!;
    const xml = `<rss><channel><item><title>RBI holds rates &amp; flags inflation - Reuters</title><link>https://news.google.com/a</link>
      <pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate><source url="https://reuters.com">Reuters</source></item>
      <item><title>New bike launched - BikeWale</title><link>https://news.google.com/b</link><pubDate>Mon, 12 Oct 2026 10:00:00 GMT</pubDate><source url="x">BikeWale</source></item></channel></rss>`;
    const items = parseRss(xml, google);
    // Outlets outside the trusted newsrooms are dropped.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "RBI holds rates & flags inflation", source: "Reuters", summary: null, published: Date.UTC(2026, 9, 12, 10) });

    const et = FEEDS.find((f) => f.name === "Economic Times")!;
    const etXml = `<item><title><![CDATA[Retail inflation rises to 5.54%]]></title><description><![CDATA[<p>Food prices drove it &#8212; up 7.74%.</p>]]></description><link>https://et/x</link><pubDate>Mon, 12 Oct 2026 11:00:00 +0530</pubDate></item>`;
    expect(parseRss(etXml, et)[0]).toMatchObject({ title: "Retail inflation rises to 5.54%", summary: "Food prices drove it — up 7.74%.", source: "Economic Times" });
  });

  it("decodes numeric and named entities", () => {
    expect(decode("Tom &amp; Jerry&#39;s &#x20B9;5 &lt;b&gt;")).toBe("Tom & Jerry's ₹5 <b>");
  });
});

describe("choosing what matters", () => {
  it("leaves out tips, launches and market chatter", () => {
    for (const t of ["5 stocks to buy this week", "Trading Plan: can Nifty hold 22,500?", "Stock Market Today: Gift Nifty up", "Honda launches new bike", "Q2 results this week"]) expect(isNoise(t)).toBe(true);
    expect(isNoise("RBI may hike repo rate as inflation persists")).toBe(false);
  });

  it("files stories by topic, and drops what isn't about money or the economy", () => {
    expect(topicOf("RBI may hike repo rate by 75 bps")).toBe("rates");
    expect(topicOf("Retail inflation rises to 5.54% in September")).toBe("prices");
    expect(topicOf("Brent crude jumps on Gulf supply fears")).toBe("energy");
    expect(topicOf("Monsoon deficit may hit kharif output")).toBe("food");
    // "reports" is not "repo".
    expect(topicOf("Airlines ask Mumbai airport for safety reports")).toBeNull();
    expect(topicOf("Google DeepMind is hiring engineers")).toBeNull();
  });

  it("groups the same story across outlets and puts the widely covered first", () => {
    const stories = buildStories(
      [
        item("Retail inflation rises to 5.54% in September as food prices zoom", "Economic Times", 2),
        item("India retail inflation rises to 5.54% in September, food prices zoom", "Business Standard", 1),
        item("Retail inflation at 5.54% in September as food prices zoom: data", "Reuters", 3),
        item("Rupee falls to record low against the dollar", "Mint", 0.5),
        item("Cardamom gains aroma on demand", "BusinessLine", 0.2),
      ],
      NOW,
    );
    expect(stories[0]).toMatchObject({ topic: "prices", important: true });
    // Reuters leads the shown headline; all three outlets are listed.
    expect(stories[0].sources.map((s) => s.name)).toEqual(["Reuters", "Business Standard", "Economic Times"]);
    expect(stories[0].published).toBe(NOW - 1 * H);
    // A single outlet on a big lever (the rupee) still counts; a single outlet on cardamom doesn't.
    expect(stories.map((s) => s.title)).toEqual(["Retail inflation at 5.54% in September as food prices zoom: data", "Rupee falls to record low against the dollar"]);
  });

  it("keeps the RBI's policy releases and drops its routine ones", () => {
    const stories = buildStories(
      [item("Monetary Policy Statement, 2026-27", "RBI", 1, { official: true }), item("Money Market Operations as on October 11, 2026", "RBI", 1, { official: true })],
      NOW,
    );
    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({ official: true, important: true, topic: "rates" });
  });

  it("drops the stale, and a summary that only repeats the headline", () => {
    const stories = buildStories([item("Rupee hits record low", "Mint", 60), item("GST collections rise 9% in September", "Mint", 1, { summary: "GST collections rise 9% in September" })], NOW, 48);
    expect(stories).toHaveLength(1);
    expect(stories[0].summary).toBeNull();
  });
});
