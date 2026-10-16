/** What the Market page shows: three headline indices and India's Nifty sector indices. */

export interface IndexItem {
  /** Yahoo's symbol. */
  symbol: string;
  name: string;
  /** NSE's list of the index's stocks: niftyindices.com/IndexConstituent/<this>.csv. */
  list: string;
}

export const INDICES: IndexItem[] = [
  { symbol: "^NSEI", name: "Nifty 50", list: "ind_nifty50list" },
  { symbol: "^NSEBANK", name: "Bank Nifty", list: "ind_niftybanklist" },
  { symbol: "^CNX100", name: "Nifty 100", list: "ind_nifty100list" },
];

export const SECTORS: IndexItem[] = [
  { symbol: "^NSEBANK", name: "Banks", list: "ind_niftybanklist" },
  { symbol: "NIFTY_PVT_BANK.NS", name: "Private banks", list: "ind_nifty_privatebanklist" },
  { symbol: "^CNXPSUBANK", name: "PSU banks", list: "ind_niftypsubanklist" },
  { symbol: "NIFTY_FIN_SERVICE.NS", name: "Financial services", list: "ind_niftyfinancelist" },
  { symbol: "^CNXIT", name: "IT", list: "ind_niftyitlist" },
  { symbol: "^CNXPHARMA", name: "Pharma", list: "ind_niftypharmalist" },
  { symbol: "NIFTY_HEALTHCARE.NS", name: "Healthcare", list: "ind_niftyhealthcarelist" },
  { symbol: "^CNXAUTO", name: "Auto", list: "ind_niftyautolist" },
  { symbol: "^CNXFMCG", name: "FMCG", list: "ind_niftyfmcglist" },
  { symbol: "^CNXCONSUM", name: "Consumption", list: "ind_niftyconsumptionlist" },
  { symbol: "NIFTY_CONSR_DURBL.NS", name: "Consumer durables", list: "ind_niftyconsumerdurableslist" },
  { symbol: "^CNXMETAL", name: "Metals", list: "ind_niftymetallist" },
  { symbol: "^CNXENERGY", name: "Energy", list: "ind_niftyenergylist" },
  { symbol: "NIFTY_OIL_AND_GAS.NS", name: "Oil & gas", list: "ind_niftyoilgaslist" },
  { symbol: "^CNXINFRA", name: "Infrastructure", list: "ind_niftyinfralist" },
  { symbol: "^CNXREALTY", name: "Realty", list: "ind_niftyrealtylist" },
  { symbol: "^CNXMEDIA", name: "Media", list: "ind_niftymedialist" },
  { symbol: "^CNXSERVICE", name: "Services", list: "ind_niftyservicelist" },
];

/** Every index the page can open, by Yahoo symbol. */
export const BY_SYMBOL: Record<string, IndexItem> = Object.fromEntries([...SECTORS, ...INDICES].map((i) => [i.symbol, i]));
