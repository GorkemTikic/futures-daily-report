// Multi-venue futures data collector for the daily report.
//
// Pulls BTC + ETH perpetuals (plus the day's biggest Binance movers) from every venue
// and NORMALISES everything so the numbers are comparable:
//   - open interest  -> USD (via each venue's own mark/last price)
//   - 24h volume     -> USD/USDT
//   - funding rate   -> annualised % (all these venues settle every 8h)
//   - timestamps     -> Europe/Istanbul (done at render time; raw ms kept here)
// Every field records which venue it came from. Nothing is invented: a venue that
// fails is returned with ok:false and omitted from the comparison.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FuturesDailyReport/2.0";

async function fetchJson(url, { retries = 2, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, redirect: "follow", signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const annualise = (ratePerInterval, intervalH = 8) => ratePerInterval == null ? null : ratePerInterval * (24 / intervalH) * 365 * 100;

// canonical base ("BTC"/"ETH") -> each venue's symbol
const SYMS = {
  binance: (b) => `${b}USDT`,
  bybit: (b) => `${b}USDT`,
  okx: (b) => `${b}-USDT-SWAP`,
  bitget: (b) => `${b}USDT`,
  gate: (b) => `${b}_USDT`,
};

// ---- per-venue adapters: return a normalised record ----

async function binance(base) {
  const s = SYMS.binance(base);
  const [t, prem, oi, fi] = await Promise.all([
    fetchJson(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${s}`),
    fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${s}`),
    fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${s}`),
    fetchJson(`https://fapi.binance.com/fapi/v1/fundingInfo`).catch(() => []),
  ]);
  const mark = num(prem.markPrice);
  const oiCoins = num(oi.openInterest);
  const info = Array.isArray(fi) ? fi.find((x) => x.symbol === s) : null;
  const intervalH = info && num(info.fundingIntervalHours) ? num(info.fundingIntervalHours) : 8;
  const fundingRaw = num(prem.lastFundingRate);
  return {
    venue: "Binance", symbol: s, ok: true,
    last: num(t.lastPrice), chgPct: num(t.priceChangePercent), high: num(t.highPrice), low: num(t.lowPrice),
    volUSD: num(t.quoteVolume), oiCoins, oiUSD: oiCoins != null && mark != null ? oiCoins * mark : null,
    fundingRaw, fundingIntervalH: intervalH, fundingAnnPct: annualise(fundingRaw, intervalH),
    mark, nextFunding: num(prem.nextFundingTime),
  };
}

async function bybit(base) {
  const s = SYMS.bybit(base);
  const r = await fetchJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${s}`);
  const t = r.result.list[0];
  const fundingRaw = num(t.fundingRate);
  return {
    venue: "Bybit", symbol: s, ok: true,
    last: num(t.lastPrice), chgPct: num(t.price24hPcnt) != null ? num(t.price24hPcnt) * 100 : null,
    high: num(t.highPrice24h), low: num(t.lowPrice24h), volUSD: num(t.turnover24h),
    oiCoins: num(t.openInterest), oiUSD: num(t.openInterestValue),
    fundingRaw, fundingIntervalH: 8, fundingAnnPct: annualise(fundingRaw, 8),
    mark: num(t.markPrice), nextFunding: num(t.nextFundingTime),
  };
}

async function okx(base) {
  const s = SYMS.okx(base);
  const [tk, fr, oi] = await Promise.all([
    fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${s}`),
    fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${s}`),
    fetchJson(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${s}`),
  ]);
  const t = tk.data[0], f = fr.data[0], o = oi.data[0];
  const last = num(t.last), open = num(t.open24h);
  const chgPct = last != null && open ? ((last - open) / open) * 100 : null;
  const volCoins = num(t.volCcy24h); // base-currency (coin) volume
  const fundingRaw = num(f.fundingRate);
  return {
    venue: "OKX", symbol: s, ok: true,
    last, chgPct, high: num(t.high24h), low: num(t.low24h),
    volUSD: volCoins != null && last != null ? volCoins * last : null,
    oiCoins: num(o.oiCcy), oiUSD: num(o.oiUsd),
    fundingRaw, fundingIntervalH: 8, fundingAnnPct: annualise(fundingRaw, 8),
    mark: last, nextFunding: num(f.fundingTime),
  };
}

async function bitget(base) {
  const s = SYMS.bitget(base);
  const r = await fetchJson(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${s}&productType=USDT-FUTURES`);
  const t = r.data[0];
  const mark = num(t.markPrice), oiCoins = num(t.holdingAmount);
  const fundingRaw = num(t.fundingRate);
  return {
    venue: "Bitget", symbol: s, ok: true,
    last: num(t.lastPr), chgPct: num(t.change24h) != null ? num(t.change24h) * 100 : null,
    high: num(t.high24h), low: num(t.low24h), volUSD: num(t.usdtVolume),
    oiCoins, oiUSD: oiCoins != null && mark != null ? oiCoins * mark : null,
    fundingRaw, fundingIntervalH: 8, fundingAnnPct: annualise(fundingRaw, 8),
    mark, nextFunding: null,
  };
}

let _gateMult = {};
async function gate(base) {
  const s = SYMS.gate(base);
  const [tkArr, contract] = await Promise.all([
    fetchJson(`https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${s}`),
    _gateMult[s] ? Promise.resolve(_gateMult[s]) : fetchJson(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${s}`).then((c) => (_gateMult[s] = c)),
  ]);
  const t = Array.isArray(tkArr) ? tkArr[0] : tkArr;
  const mult = num(contract.quanto_multiplier) || 0.0001;
  const mark = num(contract.mark_price) || num(t.mark_price);
  const oiContracts = num(t.total_size);
  const oiCoins = oiContracts != null ? oiContracts * mult : null;
  const intervalH = num(contract.funding_interval) ? num(contract.funding_interval) / 3600 : 8;
  const fundingRaw = num(t.funding_rate) != null ? num(t.funding_rate) : num(contract.funding_rate);
  return {
    venue: "Gate", symbol: s, ok: true,
    last: num(t.last), chgPct: num(t.change_percentage), high: num(t.high_24h), low: num(t.low_24h),
    volUSD: num(t.volume_24h_quote), oiCoins, oiUSD: oiCoins != null && mark != null ? oiCoins * mark : null,
    fundingRaw, fundingIntervalH: intervalH, fundingAnnPct: annualise(fundingRaw, intervalH),
    mark, nextFunding: null,
  };
}

const ADAPTERS = { Binance: binance, Bybit: bybit, OKX: okx, Bitget: bitget, Gate: gate };

async function collectBase(base) {
  const out = {};
  await Promise.all(Object.entries(ADAPTERS).map(async ([name, fn]) => {
    try { out[name] = await fn(base); }
    catch (err) { out[name] = { venue: name, symbol: SYMS[name.toLowerCase()](base), ok: false, err: String(err).slice(0, 80) }; }
  }));
  return out;
}

// Biggest Binance movers today (USDT perps, liquidity-filtered), then cross-venue.
async function collectMovers(topN = 3, minQuoteVol = 5e6) {
  const [info, all] = await Promise.all([
    fetchJson(`https://fapi.binance.com/fapi/v1/exchangeInfo`),
    fetchJson(`https://fapi.binance.com/fapi/v1/ticker/24hr`),
  ]);
  const perps = new Set(info.symbols.filter((x) => x.status === "TRADING" && x.contractType === "PERPETUAL" && x.quoteAsset === "USDT").map((x) => x.symbol));
  const ranked = all
    .filter((t) => perps.has(t.symbol) && num(t.quoteVolume) > minQuoteVol && !["BTCUSDT", "ETHUSDT"].includes(t.symbol))
    .map((t) => ({ symbol: t.symbol, base: t.symbol.replace(/USDT$/, ""), chgPct: num(t.priceChangePercent), last: num(t.lastPrice), volUSD: num(t.quoteVolume), high: num(t.highPrice), low: num(t.lowPrice) }))
    .sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct))
    .slice(0, topN);
  // cross-venue for each mover (best-effort; not every coin is listed everywhere)
  for (const m of ranked) {
    m.venues = {};
    await Promise.all(Object.entries(ADAPTERS).map(async ([name, fn]) => {
      try { m.venues[name] = await fn(m.base); } catch { /* not listed here */ }
    }));
  }
  return ranked;
}

export async function collectExchanges() {
  const [btc, eth, movers] = await Promise.all([collectBase("BTC"), collectBase("ETH"), collectMovers()]);
  return {
    fetchedAt: Date.now(),
    majors: { BTC: btc, ETH: eth },
    movers,
    venuesOnline: Object.keys(ADAPTERS).filter((v) => btc[v] && btc[v].ok),
  };
}
