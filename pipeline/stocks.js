// Tokenized-stock perpetuals on Binance USD-M Futures (contractType TRADIFI_PERPETUAL).
// The desk cares most about the ASIAN markets — Korea (KR_EQUITY), Hong Kong (HK_EQUITY)
// and China (CN_EQUITY) — since those trade during the Asian session and the team gets
// tickets on them. We also surface US equities + commodities briefly. All prices are the
// Binance perp's own USDT price and 24h move; volume is in USD.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FuturesDailyReport/2.0";
const FAPI = "https://fapi.binance.com";

// Readable names for the notable Asian symbols (others fall back to the ticker).
const NAMES = {
  // Korea
  SAMSUNGUSDT: "Samsung Electronics", SAMSUNGEMUSDT: "Samsung Electronics (EM)", SKHYNIXUSDT: "SK Hynix",
  HYUNDAIUSDT: "Hyundai Motor", LGELECTRONICSUSDT: "LG Electronics", NAVERUSDT: "Naver", HANMIUSDT: "Hanmi",
  KODEX200USDT: "KODEX 200 (KOSPI ETF)",
  // Hong Kong
  TENCENTUSDT: "Tencent", HK0700USDT: "Tencent (0700)", HK1810USDT: "Xiaomi (1810)", HK0992USDT: "Lenovo (0992)",
  HK0625USDT: "Geely (0625)", MEITUANUSDT: "Meituan", KUAISHOUUSDT: "Kuaishou", BYDUSDT: "BYD", POPMARTUSDT: "Pop Mart",
  ZHIPUUSDT: "Zhipu AI", MINIMAXUSDT: "MiniMax", GIGADEVUSDT: "GigaDevice", ZHONGJIUSDT: "Zhongji Innolight",
  CSOPSAMSUNG2LUSDT: "CSOP Samsung 2x", CSOPSKHYNIX2LUSDT: "CSOP SK Hynix 2x",
  // China
  CXMTUSDT: "CXMT", UNITREEUSDT: "Unitree Robotics",
  // US indices/ETFs worth naming (the rest use their ticker, which is self-explanatory)
  SPYUSDT: "S&P 500 (SPY)", QQQUSDT: "Nasdaq 100 (QQQ)", IWMUSDT: "Russell 2000 (IWM)",
  SMHUSDT: "Semiconductors (SMH)", GDXUSDT: "Gold Miners (GDX)", XLEUSDT: "Energy (XLE)",
  // Commodities
  XAUUSDT: "Gold", XAGUSDT: "Silver", XPTUSDT: "Platinum", XPDUSDT: "Palladium",
  COPPERUSDT: "Copper", CLUSDT: "WTI Crude Oil", BZUSDT: "Brent Crude", NATGASUSDT: "Natural Gas",
};
const MARKET_LABEL = { KR_EQUITY: "Korea", HK_EQUITY: "Hong Kong", CN_EQUITY: "China", EQUITY: "US", COMMODITY: "Commodities", PREMARKET: "Pre-market" };

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const nice = (sym) => NAMES[sym] || sym.replace(/USDT$/, "");

export async function collectStocks() {
  let info, tickers;
  try {
    [info, tickers] = await Promise.all([
      fetchJson(`${FAPI}/fapi/v1/exchangeInfo`),
      fetchJson(`${FAPI}/fapi/v1/ticker/24hr`),
    ]);
  } catch (err) {
    return { ok: false, err: String(err).slice(0, 100), markets: {}, topMovers: [] };
  }

  const tk = new Map(tickers.map((t) => [t.symbol, t]));
  const tf = info.symbols.filter((s) => s.status === "TRADING" && s.contractType === "TRADIFI_PERPETUAL");

  const markets = {}; // underlyingType -> [ {symbol,name,last,chgPct,volUSD} ]
  const all = [];
  for (const s of tf) {
    const t = tk.get(s.symbol);
    if (!t) continue;
    const rec = {
      symbol: s.symbol, name: nice(s.symbol), market: s.underlyingType,
      last: num(t.lastPrice), chgPct: num(t.priceChangePercent), volUSD: num(t.quoteVolume),
      high: num(t.highPrice), low: num(t.lowPrice),
    };
    (markets[s.underlyingType] = markets[s.underlyingType] || []).push(rec);
    all.push(rec);
  }
  // sort each market by 24h volume (most-traded first)
  for (const k of Object.keys(markets)) markets[k].sort((a, b) => (b.volUSD || 0) - (a.volUSD || 0));

  // biggest movers among the ASIAN equities specifically (what the desk watches)
  const asia = all.filter((r) => ["KR_EQUITY", "HK_EQUITY", "CN_EQUITY"].includes(r.market) && r.volUSD > 1e5);
  const topMovers = asia.slice().sort((a, b) => Math.abs(b.chgPct || 0) - Math.abs(a.chgPct || 0)).slice(0, 6);

  // US equities are 150+ symbols — surface the most-traded and the biggest movers only.
  const us = markets.EQUITY || [];
  const usTopVol = us.slice(0, 10); // already volume-sorted
  const usMovers = us.filter((r) => r.volUSD > 1e6).sort((a, b) => Math.abs(b.chgPct || 0) - Math.abs(a.chgPct || 0)).slice(0, 8);
  const commodities = markets.COMMODITY || [];

  return {
    ok: true,
    markets,                                   // grouped by underlyingType
    labels: MARKET_LABEL,
    asiaMarkets: ["KR_EQUITY", "HK_EQUITY", "CN_EQUITY"],
    counts: Object.fromEntries(Object.entries(markets).map(([k, v]) => [k, v.length])),
    topMovers, usTopVol, usMovers, commodities,
  };
}
