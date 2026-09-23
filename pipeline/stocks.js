// Tokenized-stock perpetuals on Binance USD-M Futures (contractType TRADIFI_PERPETUAL).
// The desk cares most about the ASIAN markets — Korea (KR_EQUITY), Hong Kong (HK_EQUITY)
// and China (CN_EQUITY). We also surface US equities + commodities. Prices are the
// Binance perp's own USDT price and 24h move; volume is in USD.
//
// The perp trades ~24/7 but the underlying cash market is open only a few hours on
// weekdays. For each market group we attach a session status (pipeline/sessions.js) so a
// weekend/holiday drift is never presented as the day's move in the underlying stock.
// exchangeInfo + the 24h ticker are fetched ONCE in datapack.js and passed in (item 32).

import { fetchJson, num } from "./http.js";
import { marketStatus } from "./sessions.js";

const FAPI = "https://fapi.binance.com";

const NAMES = {
  SAMSUNGUSDT: "Samsung Electronics", SAMSUNGEMUSDT: "Samsung Electronics (EM)", SKHYNIXUSDT: "SK Hynix",
  HYUNDAIUSDT: "Hyundai Motor", LGELECTRONICSUSDT: "LG Electronics", NAVERUSDT: "Naver", HANMIUSDT: "Hanmi",
  KODEX200USDT: "KODEX 200 (KOSPI ETF)",
  TENCENTUSDT: "Tencent", HK0700USDT: "Tencent (0700)", HK1810USDT: "Xiaomi (1810)", HK0992USDT: "Lenovo (0992)",
  HK0625USDT: "Geely (0625)", MEITUANUSDT: "Meituan", KUAISHOUUSDT: "Kuaishou", BYDUSDT: "BYD", POPMARTUSDT: "Pop Mart",
  ZHIPUUSDT: "Zhipu AI", MINIMAXUSDT: "MiniMax", GIGADEVUSDT: "GigaDevice", ZHONGJIUSDT: "Zhongji Innolight",
  CSOPSAMSUNG2LUSDT: "CSOP Samsung 2x", CSOPSKHYNIX2LUSDT: "CSOP SK Hynix 2x",
  CXMTUSDT: "CXMT", UNITREEUSDT: "Unitree Robotics",
  SPYUSDT: "S&P 500 (SPY)", QQQUSDT: "Nasdaq 100 (QQQ)", IWMUSDT: "Russell 2000 (IWM)",
  SMHUSDT: "Semiconductors (SMH)", GDXUSDT: "Gold Miners (GDX)", XLEUSDT: "Energy (XLE)",
  XAUUSDT: "Gold (perp)", XAGUSDT: "Silver", XPTUSDT: "Platinum", XPDUSDT: "Palladium",
  COPPERUSDT: "Copper", CLUSDT: "WTI Crude Oil", BZUSDT: "Brent Crude", NATGASUSDT: "Natural Gas",
};
const MARKET_LABEL = { KR_EQUITY: "Korea", HK_EQUITY: "Hong Kong", CN_EQUITY: "China", EQUITY: "US", COMMODITY: "Commodities", PREMARKET: "Pre-market" };

const nice = (sym) => NAMES[sym] || sym.replace(/USDT$/, "");

export async function collectStocks(win = {}, { exchangeInfo = null, ticker24h = null } = {}) {
  const dateUTC = win.dateUTC || null;
  let info = exchangeInfo, tickers = ticker24h;
  try {
    if (!info) info = await fetchJson(`${FAPI}/fapi/v1/exchangeInfo`);
    if (!tickers) tickers = await fetchJson(`${FAPI}/fapi/v1/ticker/24hr`);
  } catch (err) {
    return { ok: false, err: String(err).slice(0, 100), markets: {}, topMovers: [], sessions: {} };
  }
  if (!info || !tickers) return { ok: false, err: "missing exchangeInfo or ticker snapshot", markets: {}, topMovers: [], sessions: {} };

  const tk = new Map(tickers.map((t) => [t.symbol, t]));
  const tf = info.symbols.filter((s) => s.status === "TRADING" && s.contractType === "TRADIFI_PERPETUAL");

  const markets = {};
  const all = [];
  for (const s of tf) {
    const t = tk.get(s.symbol);
    if (!t) continue;
    const rec = {
      symbol: s.symbol, name: nice(s.symbol), market: s.underlyingType,
      last: num(t.lastPrice), chgPct: num(t.priceChangePercent), volUSD: num(t.quoteVolume),
      high: num(t.highPrice), low: num(t.lowPrice), basis: "rolling-24h",
    };
    (markets[s.underlyingType] = markets[s.underlyingType] || []).push(rec);
    all.push(rec);
  }
  for (const k of Object.keys(markets)) markets[k].sort((a, b) => (b.volUSD || 0) - (a.volUSD || 0));

  // Per-market session status for the report day (item 33).
  const sessions = {};
  for (const k of Object.keys(markets)) sessions[k] = marketStatus(k, dateUTC);

  const asia = all.filter((r) => ["KR_EQUITY", "HK_EQUITY", "CN_EQUITY"].includes(r.market) && (r.volUSD || 0) > 1e5);
  const topMovers = asia.slice().sort((a, b) => Math.abs(b.chgPct || 0) - Math.abs(a.chgPct || 0)).slice(0, 6);

  const us = markets.EQUITY || [];
  const usTopVol = us.slice(0, 10);
  const usMovers = us.filter((r) => (r.volUSD || 0) > 1e6).sort((a, b) => Math.abs(b.chgPct || 0) - Math.abs(a.chgPct || 0)).slice(0, 8);
  const commodities = markets.COMMODITY || [];

  return {
    ok: true,
    markets,
    labels: MARKET_LABEL,
    asiaMarkets: ["KR_EQUITY", "HK_EQUITY", "CN_EQUITY"],
    counts: Object.fromEntries(Object.entries(markets).map(([k, v]) => [k, v.length])),
    topMovers, usTopVol, usMovers, commodities,
    sessions,
  };
}
