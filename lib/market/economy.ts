import { z } from "zod";
import { ECONOMIES } from "./catalog";
import type { Economy, EconomyIndicators, PolicyRate, YearValue } from "./types";

/**
 * How economies are doing: the IMF's World Economic Outlook (growth, inflation, jobs, debt, budgets,
 * trade, income, with its forecasts), the BIS's table of central bank policy rates, and the World
 * Bank's foreign-exchange reserves. All free, no key. None changes more than monthly, so the page
 * fetches them a couple of times a day at most.
 */
const IMF = "https://www.imf.org/external/datamapper/api/v1";
const BIS = "https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0";
const WORLD_BANK = "https://api.worldbank.org/v2/country";

export const INDICATORS: Record<keyof EconomyIndicators, string> = {
  gdpGrowth: "NGDP_RPCH",
  inflation: "PCPIPCH",
  unemployment: "LUR",
  debt: "GGXWDG_NGDP",
  currentAccount: "BCA_NGDPD",
  fiscalBalance: "GGXCNL_NGDP",
  gdpPerCapita: "NGDPDPC",
  gdpSize: "NGDPD",
};

// Read loosely: the IMF's JSON has stray entries (an empty key holding null), so only what's used is checked.
const ImfJson = z.object({ values: z.record(z.string(), z.unknown()).nullish() });
const ImfYears = z.record(z.string(), z.unknown());

/** One IMF indicator for the chosen countries: seven years of outturns and two ahead (the IMF's estimate for this year, and its forecast for next). */
export function parseImf(json: unknown, indicator: string, codes: string[], thisYear: number): Record<string, YearValue[]> {
  const indicatorValues = ImfJson.parse(json).values?.[indicator];
  const byCountry = indicatorValues && typeof indicatorValues === "object" ? (indicatorValues as Record<string, unknown>) : {};
  const out: Record<string, YearValue[]> = {};
  for (const code of codes) {
    const parsed = ImfYears.safeParse(byCountry[code]);
    const years = parsed.success ? parsed.data : {};
    out[code] = [];
    for (let year = thisYear - 7; year <= thisYear + 1; year++) {
      const value = years[String(year)];
      if (typeof value === "number") out[code].push({ year, value, forecast: year >= thisYear });
    }
  }
  return out;
}

/**
 * Each chosen economy's place by GDP among the world's countries in `year` (1 = largest). `countries`
 * is the IMF's list of countries, so groups like the euro area or the world aren't counted (nor ranked).
 */
export function rankBySize(json: unknown, countries: Set<string>, codes: string[], year: number): Record<string, number> {
  const all = ImfJson.parse(json).values?.NGDPD;
  const byCountry = all && typeof all === "object" ? (all as Record<string, unknown>) : {};
  const sizes: { code: string; v: number }[] = [];
  for (const [code, years] of Object.entries(byCountry)) {
    if (!countries.has(code)) continue;
    const parsed = ImfYears.safeParse(years);
    const v = parsed.success ? parsed.data[String(year)] : undefined;
    if (typeof v === "number") sizes.push({ code, v });
  }
  sizes.sort((a, b) => b.v - a.v);
  const out: Record<string, number> = {};
  for (const code of codes) {
    const i = sizes.findIndex((s) => s.code === code);
    if (i >= 0) out[code] = i + 1;
  }
  return out;
}

const WbJson = z.tuple([z.unknown(), z.array(z.object({ countryiso3code: z.string(), date: z.string(), value: z.number().nullable() })).nullable()]);

/** World Bank: reserves in months of imports, the latest year each economy has. */
export function parseReserves(json: unknown): Record<string, { year: number; months: number }> {
  const out: Record<string, { year: number; months: number }> = {};
  for (const r of WbJson.parse(json)[1] ?? []) {
    if (r.value === null) continue;
    const year = Number(r.date);
    if (!out[r.countryiso3code] || out[r.countryiso3code].year < year) out[r.countryiso3code] = { year, months: r.value };
  }
  return out;
}

/** BIS "dataonly" CSV: FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE. One PolicyRate per country, latest move found. */
export function parseBis(csv: string, banks: Record<string, string>): Record<string, PolicyRate> {
  const series: Record<string, { month: string; value: number }[]> = {};
  const [header, ...rows] = csv.trim().split(/\r?\n/);
  const cols = header.split(",");
  const [area, period, value] = ["REF_AREA", "TIME_PERIOD", "OBS_VALUE"].map((c) => cols.indexOf(c));
  if (area < 0 || period < 0 || value < 0) throw new Error("Unexpected BIS format");
  for (const row of rows) {
    const cells = row.split(",");
    const v = Number(cells[value]);
    if (!cells[value] || !Number.isFinite(v)) continue;
    (series[cells[area]] ??= []).push({ month: cells[period], value: v });
  }
  const out: Record<string, PolicyRate> = {};
  for (const [code, list] of Object.entries(series)) {
    list.sort((a, b) => a.month.localeCompare(b.month));
    const last = list[list.length - 1];
    let lastChange: PolicyRate["lastChange"] = null;
    for (let i = list.length - 1; i > 0; i--) {
      if (list[i].value !== list[i - 1].value) {
        lastChange = { month: list[i].month, by: Math.round((list[i].value - list[i - 1].value) * 1000) / 1000 };
        break;
      }
    }
    out[code] = { bank: banks[code] ?? code, rate: last.value, asOf: last.month, lastChange, history: list.map((p) => p.value) };
  }
  return out;
}

/** Tries once more after a short pause: the IMF's big answers sometimes time out. A refusal (403) isn't retried. */
async function twice<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Error && / 403$/.test(err.message)) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return fn();
  }
}

/**
 * The World Bank's versions of the IMF's figures, used when the IMF turns a request away (it refuses
 * many cloud servers). Actual years only: the World Bank publishes no forecasts. Debt and the budget
 * balance are sparse there (none for India), so those may simply be missing.
 */
export const WB_INDICATORS: Record<keyof EconomyIndicators, { code: string; scale?: number }> = {
  gdpGrowth: { code: "NY.GDP.MKTP.KD.ZG" },
  inflation: { code: "FP.CPI.TOTL.ZG" },
  unemployment: { code: "SL.UEM.TOTL.ZS" },
  debt: { code: "GC.DOD.TOTL.GD.ZS" },
  currentAccount: { code: "BN.CAB.XOKA.GD.ZS" },
  fiscalBalance: { code: "GC.NLD.TOTL.GD.ZS" },
  gdpPerCapita: { code: "NY.GDP.PCAP.CD" },
  // The IMF's size is in billions of dollars; the World Bank's in dollars.
  gdpSize: { code: "NY.GDP.MKTP.CD", scale: 1e-9 },
};

const WbSeries = z.tuple([z.unknown(), z.array(z.object({ countryiso3code: z.string(), date: z.string(), value: z.number().nullable() })).nullable()]);

/** A World Bank indicator for the chosen economies (keyed by IMF code), oldest year first, all actual. */
export function parseWorldBank(json: unknown, imfOf: Record<string, string>, fromYear: number, scale = 1): Record<string, YearValue[]> {
  const out: Record<string, YearValue[]> = {};
  for (const r of WbSeries.parse(json)[1] ?? []) {
    const code = imfOf[r.countryiso3code];
    const year = Number(r.date);
    if (!code || r.value === null || !Number.isFinite(year) || year < fromYear) continue;
    (out[code] ??= []).push({ year, value: Math.round(r.value * scale * 100) / 100, forecast: false });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.year - b.year);
  return out;
}

const WbCountries = z.tuple([z.unknown(), z.array(z.object({ id: z.string(), region: z.object({ id: z.string() }) })).nullable()]);
const WbAll = z.tuple([z.unknown(), z.array(z.object({ countryiso3code: z.string(), value: z.number().nullable() })).nullable()]);

/** GDP rank among real countries (the World Bank lists regions and income groups too, under region "NA"). */
export function rankByWorldBank(countriesJson: unknown, gdpJson: unknown, imfOf: Record<string, string>): Record<string, number> {
  const real = new Set((WbCountries.parse(countriesJson)[1] ?? []).filter((c) => c.region.id !== "NA").map((c) => c.id));
  const sizes = (WbAll.parse(gdpJson)[1] ?? []).filter((r) => r.value !== null && real.has(r.countryiso3code)).sort((a, b) => b.value! - a.value!);
  const out: Record<string, number> = {};
  sizes.forEach((r, i) => {
    const code = imfOf[r.countryiso3code];
    if (code) out[code] = i + 1;
  });
  return out;
}

const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  "accept-language": "en-IN,en;q=0.9",
  referer: "https://www.imf.org/external/datamapper/",
};

async function get(url: string): Promise<Response> {
  // Browser-like headers: the IMF's firewall turns away requests that don't look like one.
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000), headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res;
}

export interface EconomiesResult {
  economies: Economy[];
  /** The figures that came from the World Bank because the IMF refused or failed (actual years only). */
  fromWorldBank: (keyof EconomyIndicators)[];
}

export async function fetchEconomies(now = new Date()): Promise<EconomiesResult> {
  const thisYear = now.getUTCFullYear();
  const codes = ECONOMIES.map((e) => e.code);
  const bisCodes = ECONOMIES.filter((e) => e.bis);
  const start = `${thisYear - 5}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const keys = Object.keys(INDICATORS) as (keyof EconomyIndicators)[];
  const wbCodes = ECONOMIES.map((e) => e.wb).join(";");
  const [raw, bis, reserves, countries] = await Promise.all([
    // The IMF answers with every country whichever are asked for; the size ranking uses that.
    Promise.allSettled(keys.map((k) => twice(async () => (await get(`${IMF}/${INDICATORS[k]}/${codes.join("/")}`)).json() as Promise<unknown>))),
    get(`${BIS}/M.${bisCodes.map((e) => e.bis).join("+")}?startPeriod=${start}&format=csv&detail=dataonly`)
      .then(async (r) => parseBis(await r.text(), Object.fromEntries(bisCodes.map((e) => [e.bis!, e.bank!]))))
      .catch(() => ({}) as Record<string, PolicyRate>),
    twice(async () => parseReserves(await (await get(`${WORLD_BANK}/${wbCodes}/indicator/FI.RES.TOTL.MO?format=json&mrnev=1&per_page=50`)).json()))
      .catch(() => ({}) as Record<string, { year: number; months: number }>),
    get(`${IMF}/countries`)
      .then(async (r) => new Set(Object.keys(((await r.json()) as { countries?: Record<string, unknown> }).countries ?? {})))
      .catch(() => new Set<string>()),
  ]);
  // A source that fails is left out of the page, but the reason goes to the server log so it can be fixed.
  raw.forEach((r, i) => r.status === "rejected" && console.error(`IMF ${INDICATORS[keys[i]]} failed:`, r.reason instanceof Error ? `${r.reason.name}: ${r.reason.message}` : r.reason));
  const series: (Record<string, YearValue[]> | null)[] = raw.map((r, i) => (r.status === "fulfilled" ? parseImf(r.value, INDICATORS[keys[i]], codes, thisYear) : null));

  // What the IMF wouldn't give, the World Bank fills in (actual years only).
  const imfOf = Object.fromEntries(ECONOMIES.map((e) => [e.wb, e.code]));
  const missing = keys.filter((_, i) => series[i] === null);
  const sizeJson = raw[keys.indexOf("gdpSize")];
  const [wb, wbRanks] = await Promise.all([
    Promise.all(
      missing.map((k) =>
        twice(async () => {
          const { code, scale } = WB_INDICATORS[k];
          const json = await (await get(`${WORLD_BANK}/${wbCodes}/indicator/${code}?format=json&date=${thisYear - 7}:${thisYear}&per_page=200`)).json();
          return parseWorldBank(json, imfOf, thisYear - 7, scale);
        }).catch((err) => {
          console.error(`World Bank ${WB_INDICATORS[k].code} failed:`, err instanceof Error ? err.message : err);
          return null;
        }),
      ),
    ),
    sizeJson.status === "fulfilled"
      ? Promise.resolve(null)
      : Promise.all([get(`${WORLD_BANK}?format=json&per_page=400`).then((r) => r.json()), get(`${WORLD_BANK}/all/indicator/NY.GDP.MKTP.CD?format=json&date=${thisYear - 1}&per_page=400`).then((r) => r.json())])
          .then(([list, gdp]) => rankByWorldBank(list, gdp, imfOf))
          .catch(() => null),
  ]);
  const fromWorldBank: (keyof EconomyIndicators)[] = [];
  missing.forEach((k, j) => {
    if (wb[j]) {
      series[keys.indexOf(k)] = wb[j];
      fromWorldBank.push(k);
    }
  });
  if (series.every((r) => r === null) && !Object.keys(bis).length) throw new Error("No economic data");
  const ranks = sizeJson.status === "fulfilled" && countries.size ? rankBySize(sizeJson.value, countries, codes, thisYear - 1) : (wbRanks ?? {});

  const economies = ECONOMIES.map((e) => {
    const indicators = Object.fromEntries(keys.map((k, i) => [k, series[i]?.[e.code] ?? []])) as unknown as EconomyIndicators;
    return {
      code: e.code,
      name: e.name,
      group: e.group,
      ...indicators,
      policy: e.bis ? (bis[e.bis] ?? null) : null,
      reserves: reserves[e.wb] ?? null,
      sizeRank: ranks[e.code] ?? null,
    };
  });
  return { economies, fromWorldBank };
}
