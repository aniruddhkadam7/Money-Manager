import type { Metal } from "./ibja";
import type { EconomyGroup } from "./types";

/** What the Market page shows, section by section. Names here replace Yahoo's shouty ones. */

export interface CatalogItem {
  symbol: string;
  name: string;
  /**
   * Where the history comes from when Yahoo keeps none for the index itself (most Nifty sector
   * indices): an ETF that tracks it, whose returns stand in for the index's beyond today; or, with no
   * such ETF, "members": an equal-weighted index built from the stocks in `constituents`.
   */
  history?: string;
  /** NSE's list of the index's stocks: niftyindices.com/IndexConstituent/<this>.csv. */
  constituents?: string;
  /** The index's name in NSE's list of all indices, which publishes its PE, PB and dividend yield. */
  nse?: string;
  /** The world sector it's valued against: an iShares global sector ETF in GLOBAL_SECTORS. */
  global?: string;
}

export const INDIA: CatalogItem[] = [
  { symbol: "^NSEI", name: "Nifty 50", nse: "NIFTY 50" },
  { symbol: "^BSESN", name: "Sensex" },
  { symbol: "^NSMIDCP", name: "Nifty Next 50", nse: "NIFTY NEXT 50" },
  { symbol: "^NSEMDCP50", name: "Nifty Midcap 50", nse: "NIFTY MIDCAP 50" },
  { symbol: "^CNXSC", name: "Nifty Smallcap 100", history: "HDFCSML250.NS", nse: "NIFTY SMALLCAP 100" },
  { symbol: "^INDIAVIX", name: "India VIX (fear gauge)" },
];

export const SECTORS: CatalogItem[] = [
  { symbol: "^NSEBANK", name: "Banks", constituents: "ind_niftybanklist", nse: "NIFTY BANK", global: "IXG" },
  { symbol: "^CNXPSUBANK", name: "Public sector banks", history: "PSUBNKBEES.NS", constituents: "ind_niftypsubanklist", nse: "NIFTY PSU BANK", global: "IXG" },
  { symbol: "NIFTY_FIN_SERVICE.NS", name: "Financial services", history: "members", constituents: "ind_niftyfinancelist", nse: "NIFTY FINANCIAL SERVICES", global: "IXG" },
  { symbol: "^CNXIT", name: "IT", constituents: "ind_niftyitlist", nse: "NIFTY IT", global: "IXN" },
  { symbol: "^CNXPHARMA", name: "Pharma", constituents: "ind_niftypharmalist", nse: "NIFTY PHARMA", global: "IXJ" },
  { symbol: "NIFTY_HEALTHCARE.NS", name: "Healthcare", history: "HEALTHIETF.NS", constituents: "ind_niftyhealthcarelist", nse: "NIFTY HEALTHCARE INDEX", global: "IXJ" },
  { symbol: "^CNXAUTO", name: "Auto", history: "AUTOBEES.NS", constituents: "ind_niftyautolist", nse: "NIFTY AUTO", global: "RXI" },
  { symbol: "^CNXFMCG", name: "FMCG", history: "FMCGIETF.NS", constituents: "ind_niftyfmcglist", nse: "NIFTY FMCG", global: "KXI" },
  { symbol: "^CNXCONSUM", name: "Consumption", history: "CONSUMBEES.NS", constituents: "ind_niftyconsumptionlist", nse: "NIFTY INDIA CONSUMPTION", global: "RXI" },
  { symbol: "^CNXMETAL", name: "Metals", history: "METALIETF.NS", constituents: "ind_niftymetallist", nse: "NIFTY METAL", global: "MXI" },
  { symbol: "^CNXENERGY", name: "Energy", history: "members", constituents: "ind_niftyenergylist", nse: "NIFTY ENERGY", global: "IXC" },
  { symbol: "NIFTY_OIL_AND_GAS.NS", name: "Oil & gas", history: "OILIETF.NS", constituents: "ind_niftyoilgaslist", nse: "NIFTY OIL & GAS", global: "IXC" },
  { symbol: "^CNXINFRA", name: "Infrastructure", history: "INFRABEES.NS", constituents: "ind_niftyinfralist", nse: "NIFTY INFRASTRUCTURE", global: "EXI" },
  { symbol: "^CNXREALTY", name: "Real estate", history: "MOREALTY.NS", constituents: "ind_niftyrealtylist", nse: "NIFTY REALTY", global: "REET" },
  { symbol: "^CNXMEDIA", name: "Media", history: "members", constituents: "ind_niftymedialist", nse: "NIFTY MEDIA", global: "IXP" },
];

export const WORLD: CatalogItem[] = [
  { symbol: "^GSPC", name: "S&P 500 (US)" },
  { symbol: "^IXIC", name: "Nasdaq (US)" },
  { symbol: "^DJI", name: "Dow Jones (US)" },
  { symbol: "^STOXX50E", name: "Euro Stoxx 50" },
  { symbol: "^GDAXI", name: "DAX (Germany)" },
  { symbol: "^FTSE", name: "FTSE 100 (UK)" },
  { symbol: "^N225", name: "Nikkei 225 (Japan)" },
  { symbol: "000001.SS", name: "Shanghai (China)" },
  { symbol: "^HSI", name: "Hang Seng (Hong Kong)" },
];

export const YIELDS: CatalogItem[] = [
  { symbol: "^IRX", name: "US 3-month T-bill" },
  { symbol: "^TNX", name: "US 10-year bond" },
  { symbol: "^TYX", name: "US 30-year bond" },
];

export const CURRENCY: CatalogItem[] = [
  { symbol: "USDINR=X", name: "US dollar" },
  { symbol: "EURINR=X", name: "Euro" },
  { symbol: "GBPINR=X", name: "British pound" },
  { symbol: "JPYINR=X", name: "Japanese yen" },
  { symbol: "AEDINR=X", name: "UAE dirham" },
  { symbol: "DX-Y.NYB", name: "Dollar index" },
];

export const COMMODITIES: CatalogItem[] = [
  { symbol: "GOLD-INR", name: "Gold" },
  { symbol: "SILVER-INR", name: "Silver" },
  { symbol: "BZ=F", name: "Brent crude" },
  { symbol: "NG=F", name: "Natural gas" },
  { symbol: "HG=F", name: "Copper" },
  { symbol: "BTC-INR", name: "Bitcoin" },
];

/** The world's sectors: iShares' global sector ETFs, which track MSCI's all-country sector indices (in dollars). */
export const GLOBAL_SECTORS: CatalogItem[] = [
  { symbol: "IXN", name: "Global technology" },
  { symbol: "IXG", name: "Global financials" },
  { symbol: "IXJ", name: "Global healthcare" },
  { symbol: "IXC", name: "Global energy" },
  { symbol: "KXI", name: "Global consumer staples" },
  { symbol: "RXI", name: "Global consumer discretionary" },
  { symbol: "MXI", name: "Global materials" },
  { symbol: "EXI", name: "Global industrials" },
  { symbol: "REET", name: "Global real estate" },
  { symbol: "IXP", name: "Global communication" },
  { symbol: "JXI", name: "Global utilities" },
];

/** India against the world, sector by sector: each global sector beside the Nifty sector closest to it. */
export const SECTOR_PAIRS: { label: string; india: string | null; world: string }[] = [
  { label: "Technology", india: "^CNXIT", world: "IXN" },
  { label: "Financials", india: "NIFTY_FIN_SERVICE.NS", world: "IXG" },
  { label: "Healthcare", india: "NIFTY_HEALTHCARE.NS", world: "IXJ" },
  { label: "Energy", india: "^CNXENERGY", world: "IXC" },
  { label: "Consumer staples", india: "^CNXFMCG", world: "KXI" },
  { label: "Cars & consumer", india: "^CNXAUTO", world: "RXI" },
  { label: "Materials & metals", india: "^CNXMETAL", world: "MXI" },
  { label: "Industrials & infra", india: "^CNXINFRA", world: "EXI" },
  { label: "Real estate", india: "^CNXREALTY", world: "REET" },
  { label: "Media & telecom", india: "^CNXMEDIA", world: "IXP" },
  { label: "Utilities", india: null, world: "JXI" },
];

/** Everything on the page: one list, fetched and cached as one. */
export const OVERVIEW: CatalogItem[] = [...INDIA, ...SECTORS, ...GLOBAL_SECTORS, ...WORLD, ...YIELDS, ...CURRENCY, ...COMMODITIES];

export const CATALOG: Record<string, CatalogItem> = Object.fromEntries(OVERVIEW.map((c) => [c.symbol, c]));

/** A troy ounce in grams: world gold and silver are priced per ounce. */
const OUNCE_G = 31.1034768;

/**
 * Gold and silver in rupees: India's own rate from IBJA, which includes import duty. Before IBJA's
 * few months of history, returns follow the world price in dollars times the dollar's rate.
 */
export const DERIVED: Record<string, { metal: Metal; what: string; base: string; fx: string; factor: number; unit: string }> = {
  "GOLD-INR": { metal: "gold999", what: "24-carat (999) gold", base: "GC=F", fx: "USDINR=X", factor: 10 / OUNCE_G, unit: "10 g" },
  "SILVER-INR": { metal: "silver999", what: "999 silver", base: "SI=F", fx: "USDINR=X", factor: 1000 / OUNCE_G, unit: "kg" },
};

export const UNITS: Record<string, string> = { "BZ=F": "barrel", "NG=F": "MMBtu", "HG=F": "lb" };

/**
 * The economies on the page: IMF code, how they're judged, World Bank code (for reserves), and the BIS
 * code and name of the central bank.
 */
export const ECONOMIES: { code: string; name: string; group: EconomyGroup; wb: string; bis?: string; bank?: string }[] = [
  { code: "WEOWORLD", name: "World", group: "world", wb: "WLD" },
  { code: "IND", name: "India", group: "emerging", wb: "IND", bis: "IN", bank: "Reserve Bank of India (repo rate)" },
  { code: "USA", name: "United States", group: "advanced", wb: "USA", bis: "US", bank: "US Federal Reserve" },
  { code: "CHN", name: "China", group: "emerging", wb: "CHN", bis: "CN", bank: "People's Bank of China" },
  { code: "EURO", name: "Euro area", group: "advanced", wb: "EMU", bis: "XM", bank: "European Central Bank" },
  { code: "JPN", name: "Japan", group: "advanced", wb: "JPN", bis: "JP", bank: "Bank of Japan" },
  { code: "GBR", name: "United Kingdom", group: "advanced", wb: "GBR", bis: "GB", bank: "Bank of England" },
];
