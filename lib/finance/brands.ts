/**
 * Well-known services and companies, recognised from however a bank or a person writes them.
 * Logos are static files in /public/brands (fetched once with scripts/fetch-brand-logos.mjs),
 * so showing them never makes a network request.
 */
export interface Brand {
  slug: string;
  name: string;
  /** Site the logo is fetched from. */
  domain: string;
  re: RegExp;
  /** A service you keep paying for (as opposed to a shop you merely buy from). */
  subscription: boolean;
  /** Also sells one-off things (App Store, Google Play), so its name alone doesn't make a payment a subscription. */
  ambiguous?: boolean;
}

const b = (slug: string, name: string, domain: string, re: RegExp, subscription = true, ambiguous = false): Brand => ({ slug, name, domain, re, subscription, ...(ambiguous ? { ambiguous } : {}) });

export const BRANDS: Brand[] = [
  b("netflix", "Netflix", "netflix.com", /netflix/),
  b("spotify", "Spotify", "spotify.com", /spotify/),
  b("hotstar", "Disney+ Hotstar", "hotstar.com", /hotstar|disney/),
  b("primevideo", "Amazon Prime", "primevideo.com", /prime video|amazon prime|primevideo|amzn prime/),
  b("youtube", "YouTube", "youtube.com", /youtube|google youtube/),
  b("jiocinema", "JioCinema", "jiohotstar.com", /jiocinema|jio cinema|jiohotstar/),
  b("sonyliv", "SonyLIV", "sonyliv.com", /sonyliv|sony liv/),
  b("zee5", "ZEE5", "zee5.com", /zee5/),
  b("apple", "Apple", "apple.com", /apple/, true, true),
  b("google", "Google One", "one.google.com", /google (one|play|storage)|google\*/, true, true),
  b("microsoft", "Microsoft", "microsoft.com", /microsoft|office 365|xbox/, true, true),
  b("adobe", "Adobe", "adobe.com", /adobe/),
  b("canva", "Canva", "canva.com", /canva/),
  b("notion", "Notion", "notion.so", /notion/),
  b("chatgpt", "ChatGPT", "chatgpt.com", /openai|chatgpt/),
  b("claude", "Claude", "claude.ai", /anthropic|claude\.ai|\bclaude\b/),
  b("github", "GitHub", "github.com", /github/),
  b("godaddy", "GoDaddy", "godaddy.com", /godaddy|go daddy/),
  b("linkedin", "LinkedIn", "linkedin.com", /linkedin/),
  b("audible", "Audible", "audible.in", /audible/),
  b("gaana", "Gaana", "gaana.com", /gaana/),
  b("wynk", "Wynk Music", "wynk.in", /wynk/),
  b("jiosaavn", "JioSaavn", "jiosaavn.com", /jiosaavn|saavn/),
  b("cultfit", "cult.fit", "cult.fit", /cult\.?fit|curefit/),
  b("swiggy", "Swiggy One", "swiggy.com", /swiggy one/),
  b("zomato", "Zomato Gold", "zomato.com", /zomato gold|zomato pro/),
  b("cred", "CRED", "cred.club", /dreamplug|cred club|cred\.club/, false), // pays card bills: not a subscription
  b("tinder", "Tinder", "tinder.com", /tinder/),
  b("bumble", "Bumble", "bumble.com", /bumble/),
  b("jio", "Jio", "jio.com", /reliance jio|\bjio\b|jiofiber|jio fiber/),
  b("airtel", "Airtel", "airtel.in", /airtel/),
  b("vi", "Vi", "myvi.in", /vodafone|\bvi\b|vi prepaid|vi postpaid/),
  b("bsnl", "BSNL", "bsnl.in", /bsnl/),
  b("act", "ACT Fibernet", "actcorp.in", /act fibernet|actcorp/),
  b("hathway", "Hathway", "hathway.net", /hathway/),
  b("tataplay", "Tata Play", "tataplay.com", /tata play|tata sky|tatasky/),
  b("dishtv", "Dish TV", "dishtv.in", /dish tv|dishtv/),
  b("lic", "LIC", "licindia.in", /lic of india|lic premium|\blic\b/),
  b("hdfclife", "HDFC Life", "hdfclife.com", /hdfc life/),
  b("iciciprulife", "ICICI Prudential", "iciciprulife.com", /icici pru/),
  b("starhealth", "Star Health", "starhealth.in", /star health/),
  b("maxlife", "Max Life", "axismaxlife.com", /max life/),
  b("policybazaar", "Policybazaar", "policybazaar.com", /policybazaar/),
  // Shops and apps people pay but don't subscribe to: logos only.
  b("swiggyapp", "Swiggy", "swiggy.com", /swiggy/, false),
  b("zomatoapp", "Zomato", "zomato.com", /zomato/, false),
  b("amazon", "Amazon", "amazon.in", /amazon|amzn/, false),
  b("flipkart", "Flipkart", "flipkart.com", /flipkart/, false),
  b("uber", "Uber", "uber.com", /\buber\b/, false),
  b("ola", "Ola", "olacabs.in", /\bola\b|olacabs/, false),
  b("irctc", "IRCTC", "irctc.com", /irctc/, false),
  b("zepto", "Zepto", "zeptonow.com", /zepto/, false),
  b("blinkit", "Blinkit", "blinkit.com", /blinkit/, false),
  b("myntra", "Myntra", "myntra.com", /myntra/, false),
  b("bookmyshow", "BookMyShow", "bookmyshow.com", /bookmyshow/, false),
  b("oyo", "OYO", "oyorooms.com", /\boyo\b/, false),
  b("makemytrip", "MakeMyTrip", "makemytrip.com", /makemytrip/, false),
  b("redbus", "redBus", "redbus.in", /redbus/, false),
  b("zerodha", "Zerodha", "zerodha.com", /zerodha/, false),
  b("groww", "Groww", "groww.in", /groww/, false),
  // Employers and companies that pay you or reimburse you.
  // "EY" only on its own (or EY LLP / GDS / India): a bank line like "PAN EY TEA STALL" is not EY.
  b("ey", "EY", "ey.com", /^\s*ey(\s+(llp|gds|india|global|services))?\s*$|ernst\s*(&|and)?\s*young/, false),
];

/** Services found by name in any text (a description, a bank narration). Subscriptions win over plain shops. */
/** Brands whose official vector logo is in /public/brands as `<slug>.svg`; the rest use `<slug>.png`. */
const VECTOR = new Set(["ey"]);

export const brandLogoSrc = (slug: string): string => `/brands/${slug}.${VECTOR.has(slug) ? "svg" : "png"}`;

export function brandFor(text: string): Brand | null {
  const t = text.toLowerCase();
  const hits = BRANDS.filter((x) => x.re.test(t));
  return hits.find((x) => x.subscription) ?? hits[0] ?? null;
}

export const subscriptionBrandFor = (text: string): Brand | null => {
  const t = text.toLowerCase();
  return BRANDS.find((x) => x.subscription && x.re.test(t)) ?? null;
};

export const logoSrc = (brand: Pick<Brand, "slug">) => brandLogoSrc(brand.slug);

/** Insurance and similar with no specific brand: still a subscription, no logo. */
export const GENERIC_SUBSCRIPTION = /insurance|premium|mutual fund sip/;

export const brandBySlug = (slug?: string) => BRANDS.find((x) => x.slug === slug);
