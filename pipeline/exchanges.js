// Multi-venue futures data collector for the daily report.
//
// Pulls BTC + ETH perpetuals (plus the day's biggest Binance movers) from every venue
// and NORMALISES everything so the numbers are comparable:
//   - price/open/close/high/low/volume come from the venue's DAILY (1d) kline bounded
//     to the report's UTC day, so a report headed "13 Sep" contains 13 Sep's numbers,
//     not a rolling 24h window. Each record is tagged basis:"utc-day". If the daily
//     kline can't be fetched or isn't UTC-aligned, we fall back to the 24h ticker and
//     tag basis:"rolling-24h" so the renderer can say so — never silently mislabel.
//   - open interest -> USD (via each venue's own mark price); funding -> annualised %.
//   - funding / open interest / mark price are point-in-time by nature and are captured
//     "as of" the window end (asOfMs); the renderer labels them as such.
// Nothing is invented: a venue that fails is returned ok:false and omitted; a field that
// can't be normalised (e.g. Gate with a missing contract multiplier) is null -> "—".

import { fetchJson, num } from "./http.js";

const annualise = (ratePerInterval, intervalH = 8) => ratePerInterval == null ? null : ratePerInterval * (24 / intervalH) * 365 * 100;

// A daily-kline open time is accepted as "the report day" only if it lands on the UTC
// day start within this tolerance. This guards against venues whose "1d" candle is
// aligned to a non-UTC timezone (e.g. UTC+8) — those fall back to the 24h ticker.
const DAY_TOL_MS = 60 * 1000;

// canonical base ("BTC"/"ETH") -> each venue's symbol
const SYMS = {
  binance: (b) => `${b}USDT`,
  bybit: (b) => `${b}USDT`,
  okx: (b) => `${b}-USDT-SWAP`,
  bitget: (b) => `${b}USDT`,
  gate: (b) => `${b}_USDT`,
};

// ---- daily (1d) kline per venue, bounded to the report's UTC day ----
// Each returns { ts, open, high, low, close, quoteVol } for the UTC day, or null.

async function klineBinance(symbol, dayStartMs, dayEndMs) {
  const arr = await fetchJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1d&startTime=${dayStartMs}&endTime=${dayEndMs}&limit=1`);
  const k = Array.isArray(arr) ? arr.find((r) => Math.abs(Number(r[0]) - dayStartMs) <= DAY_TOL_MS) : null;
  if (!k) return null;
  return { ts: Number(k[0]), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), quoteVol: num(k[7]) };
}

async function klineBybit(symbol, dayStartMs, dayEndMs) {
  const r = await fetchJson(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=D&start=${dayStartMs}&end=${dayEndMs}&limit=2`);
  const list = r?.result?.list || [];
  const k = list.find((x) => Math.abs(Number(x[0]) - dayStartMs) <= DAY_TOL_MS);
  if (!k) return null;
  return { ts: Number(k[0]), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), quoteVol: num(k[6]) };
}

async function klineOkx(instId, dayStartMs) {
  // bar=1Dutc aligns the daily candle to UTC 00:00 (default 1D is UTC+8).
  const r = await fetchJson(`https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=1Dutc&limit=10`);
  const rows = r?.data || [];
  const k = rows.find((x) => Math.abs(Number(x[0]) - dayStartMs) <= DAY_TOL_MS);
  if (!k) return null;
  // SWAP candle: [ts,o,h,l,c,vol(contracts),volCcy(base),volCcyQuote(USDT),confirm]
  return { ts: Number(k[0]), open: num(k[1]), high: num(k[2]), low: num(k[3]), close: num(k[4]), quoteVol: num(k[7]) };
}

async function klineBitget(symbol, dayStartMs, dayEndMs) {
  // Bitget's "1D" candle is aligned to UTC+8 (opens 16:00 UTC), so it can't represent a
  // UTC day. Build the UTC day from its 24 hourly candles instead (each [ts,o,h,l,c,base,quote]).
  const r = await fetchJson(`https://api.bitget.com/api/v2/mix/market/history-candles?symbol=${symbol}&granularity=1H&productType=USDT-FUTURES&startTime=${dayStartMs}&endTime=${dayEndMs + 1}&limit=48`);
  const rows = (r?.data || []).filter((x) => Number(x[0]) >= dayStartMs && Number(x[0]) <= dayEndMs).sort((a, b) => Number(a[0]) - Number(b[0]));
  if (!rows.length) return null;
  let high = -Infinity, low = Infinity, quoteVol = 0;
  for (const x of rows) { high = Math.max(high, num(x[2]) ?? -Infinity); low = Math.min(low, num(x[3]) ?? Infinity); quoteVol += num(x[6]) || 0; }
  return { ts: dayStartMs, open: num(rows[0][1]), high, low, close: num(rows[rows.length - 1][4]), quoteVol };
}

async function klineGate(contract, dayStartMs, dayEndMs) {
  const from = Math.floor(dayStartMs / 1000), to = Math.floor(dayEndMs / 1000);
  const arr = await fetchJson(`https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=${contract}&interval=1d&from=${from}&to=${to}`);
  const k = Array.isArray(arr) ? arr.find((x) => Math.abs(Number(x.t) * 1000 - dayStartMs) <= DAY_TOL_MS) : null;
  if (!k) return null;
  // { t(sec), v(size), c, h, l, o, sum(quote USDT) }
  return { ts: Number(k.t) * 1000, open: num(k.o), high: num(k.h), low: num(k.l), close: num(k.c), quoteVol: num(k.sum) };
}

// Merge a point-in-time snapshot with the day-bounded kline into one normalised record.
// `win` = { dayStartMs, dayEndMs, asOfMs, live }. When live is false (backfill of a past
// day) the snapshot fields (funding/OI/mark/last) are null and only the kline is used.
function makeRecord(venue, symbol, snap, kline, fallback, win) {
  const rec = {
    venue, symbol, ok: true, asOfMs: win.asOfMs,
    // point-in-time (as of window end); null on backfill
    last: win.live ? snap.last : null,
    mark: win.live ? snap.mark : null,
    oiCoins: win.live ? snap.oiCoins : null,
    oiUSD: win.live ? snap.oiUSD : null,
    fundingRaw: win.live ? snap.fundingRaw : null,
    fundingIntervalH: snap.fundingIntervalH ?? 8,
    fundingAnnPct: win.live ? annualise(snap.fundingRaw, snap.fundingIntervalH ?? 8) : null,
    nextFunding: win.live ? (snap.nextFunding ?? null) : null,
  };
  if (kline && kline.open != null && kline.close != null) {
    rec.basis = "utc-day";
    rec.open = kline.open; rec.high = kline.high; rec.low = kline.low; rec.close = kline.close;
    rec.chgPct = kline.open ? ((kline.close - kline.open) / kline.open) * 100 : null;
    rec.volUSD = kline.quoteVol;
    rec.volBasis = "quote";
  } else if (win.live && fallback) {
    rec.basis = "rolling-24h";
    rec.open = fallback.open ?? null; rec.high = fallback.high; rec.low = fallback.low; rec.close = fallback.last;
    rec.chgPct = fallback.chgPct; rec.volUSD = fallback.volUSD; rec.volBasis = fallback.volBasis || "quote";
  } else {
    // backfill with no kline -> not usable
    return { venue, symbol, ok: false, err: "no UTC-day kline" };
  }
  return rec;
}

// ---- per-venue point-in-time snapshots (funding / OI / mark / last + 24h fallback) ----

async function snapBinance(base) {
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
  return {
    last: num(t.lastPrice), mark, oiCoins, oiUSD: oiCoins != null && mark != null ? oiCoins * mark : null,
    fundingRaw: num(prem.lastFundingRate), fundingIntervalH: intervalH, nextFunding: num(prem.nextFundingTime),
    fallback: { last: num(t.lastPrice), open: num(t.openPrice), high: num(t.highPrice), low: num(t.lowPrice), chgPct: num(t.priceChangePercent), volUSD: num(t.quoteVolume), volBasis: "quote" },
  };
}

async function snapBybit(base) {
  const s = SYMS.bybit(base);
  const r = await fetchJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${s}`);
  const t = r.result.list[0];
  const chgPct = num(t.price24hPcnt) != null ? num(t.price24hPcnt) * 100 : null;
  return {
    last: num(t.lastPrice), mark: num(t.markPrice), oiCoins: num(t.openInterest), oiUSD: num(t.openInterestValue),
    fundingRaw: num(t.fundingRate), fundingIntervalH: 8, nextFunding: num(t.nextFundingTime),
    fallback: { last: num(t.lastPrice), open: num(t.prevPrice24h), high: num(t.highPrice24h), low: num(t.lowPrice24h), chgPct, volUSD: num(t.turnover24h), volBasis: "quote" },
  };
}

async function snapOkx(base) {
  const s = SYMS.okx(base);
  const [tk, fr, oi, mp] = await Promise.all([
    fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${s}`),
    fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${s}`),
    fetchJson(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${s}`),
    fetchJson(`https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=${s}`).catch(() => null),
  ]);
  const t = tk.data[0], f = fr.data[0], o = oi.data[0];
  const last = num(t.last), open = num(t.open24h);
  const volCoins = num(t.volCcy24h);
  const mark = mp?.data?.[0] ? num(mp.data[0].markPx) : null; // real mark price, not last (item 26)
  return {
    last, mark, oiCoins: num(o.oiCcy), oiUSD: num(o.oiUsd),
    fundingRaw: num(f.fundingRate), fundingIntervalH: 8, nextFunding: num(f.fundingTime),
    fallback: { last, open, high: num(t.high24h), low: num(t.low24h), chgPct: last != null && open ? ((last - open) / open) * 100 : null, volUSD: volCoins != null && last != null ? volCoins * last : null, volBasis: "approx" },
  };
}

async function snapBitget(base) {
  const s = SYMS.bitget(base);
  const r = await fetchJson(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${s}&productType=USDT-FUTURES`);
  const t = r.data[0];
  const mark = num(t.markPrice), oiCoins = num(t.holdingAmount);
  return {
    last: num(t.lastPr), mark, oiCoins, oiUSD: oiCoins != null && mark != null ? oiCoins * mark : null,
    fundingRaw: num(t.fundingRate), fundingIntervalH: 8, nextFunding: null,
    fallback: { last: num(t.lastPr), open: num(t.openUtc) ?? null, high: num(t.high24h), low: num(t.low24h), chgPct: num(t.change24h) != null ? num(t.change24h) * 100 : null, volUSD: num(t.usdtVolume), volBasis: "quote" },
  };
}

// Gate: cache ONLY the multiplier + funding interval (item 27), fetch mark fresh via ticker.
let _gateMeta = {};
async function snapGate(base) {
  const s = SYMS.gate(base);
  if (!_gateMeta[s]) {
    try {
      const c = await fetchJson(`https://api.gateio.ws/api/v4/futures/usdt/contracts/${s}`);
      _gateMeta[s] = { mult: num(c.quanto_multiplier), intervalH: num(c.funding_interval) ? num(c.funding_interval) / 3600 : 8 };
    } catch { _gateMeta[s] = { mult: null, intervalH: 8 }; }
  }
  const meta = _gateMeta[s];
  const tkArr = await fetchJson(`https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${s}`);
  const t = Array.isArray(tkArr) ? tkArr[0] : tkArr;
  const mark = num(t.mark_price);
  const oiContracts = num(t.total_size);
  // Never invent a multiplier: if it's missing/zero, OI in coins/USD is unknown -> null.
  const oiCoins = meta.mult && oiContracts != null ? oiContracts * meta.mult : null;
  return {
    last: num(t.last), mark, oiCoins, oiUSD: oiCoins != null && mark != null ? oiCoins * mark : null,
    fundingRaw: num(t.funding_rate), fundingIntervalH: meta.intervalH, nextFunding: null,
    fallback: { last: num(t.last), open: null, high: num(t.high_24h), low: num(t.low_24h), chgPct: num(t.change_percentage), volUSD: num(t.volume_24h_quote), volBasis: "quote" },
  };
}

const VENUES = {
  Binance: { snap: snapBinance, kline: (b, s, e) => klineBinance(SYMS.binance(b), s, e) },
  Bybit: { snap: snapBybit, kline: (b, s, e) => klineBybit(SYMS.bybit(b), s, e) },
  OKX: { snap: snapOkx, kline: (b, s) => klineOkx(SYMS.okx(b), s) },
  Bitget: { snap: snapBitget, kline: (b, s, e) => klineBitget(SYMS.bitget(b), s, e) },
  Gate: { snap: snapGate, kline: (b, s, e) => klineGate(SYMS.gate(b), s, e) },
};

async function venueRecord(name, base, win) {
  const v = VENUES[name];
  const kline = await v.kline(base, win.dayStartMs, win.dayEndMs).catch(() => null);
  let snap = null;
  if (win.live) snap = await v.snap(base).catch(() => null);
  if (!win.live && !kline) return { venue: name, symbol: SYMS[name.toLowerCase()](base), ok: false, err: "no UTC-day kline" };
  if (win.live && !snap && !kline) return { venue: name, symbol: SYMS[name.toLowerCase()](base), ok: false, err: "venue unavailable" };
  return makeRecord(name, SYMS[name.toLowerCase()](base), snap || {}, kline, snap ? snap.fallback : null, win);
}

async function collectBase(base, win) {
  const out = {};
  await Promise.all(Object.keys(VENUES).map(async (name) => {
    try { out[name] = await venueRecord(name, base, win); }
    catch (err) { out[name] = { venue: name, symbol: SYMS[name.toLowerCase()](base), ok: false, err: String(err).slice(0, 80) }; }
  }));
  return out;
}

// ---- positioning extras (item 30): OI change over the day + long/short ratios ----
// Binance has the richest, third-party-free data; Bybit adds OI change; OKX adds a ratio.
// Every call is best-effort — any failure just omits that field.

async function binancePositioning(base, win) {
  const s = SYMS.binance(base);
  const out = {};
  try {
    const hist = await fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${s}&period=1d&limit=10`);
    if (Array.isArray(hist) && hist.length) {
      const atStart = hist.find((h) => Math.abs(Number(h.timestamp) - win.dayStartMs) <= 2 * 3600e3);
      const atEnd = hist.find((h) => Math.abs(Number(h.timestamp) - win.dayEndMs) <= 2 * 3600e3);
      if (atStart && atEnd && num(atStart.sumOpenInterestValue)) {
        out.oiChangePct = ((num(atEnd.sumOpenInterestValue) - num(atStart.sumOpenInterestValue)) / num(atStart.sumOpenInterestValue)) * 100;
      }
    }
  } catch { /* omit */ }
  try {
    const g = await fetchJson(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${s}&period=1d&limit=1`);
    if (Array.isArray(g) && g[0]) out.longShortAccount = num(g[0].longShortRatio);
  } catch { /* omit */ }
  try {
    const tp = await fetchJson(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${s}&period=1d&limit=1`);
    if (Array.isArray(tp) && tp[0]) out.topPositionRatio = num(tp[0].longShortRatio);
  } catch { /* omit */ }
  return out;
}

async function bybitOiChange(base, win) {
  try {
    const s = SYMS.bybit(base);
    const r = await fetchJson(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${s}&intervalTime=1d&limit=10`);
    const list = r?.result?.list || [];
    const atStart = list.find((x) => Math.abs(Number(x.timestamp) - win.dayStartMs) <= 2 * 3600e3);
    const atEnd = list.find((x) => Math.abs(Number(x.timestamp) - win.dayEndMs) <= 2 * 3600e3);
    if (atStart && atEnd && num(atStart.openInterest)) return ((num(atEnd.openInterest) - num(atStart.openInterest)) / num(atStart.openInterest)) * 100;
  } catch { /* omit */ }
  return undefined;
}

async function okxAccountRatio(base) {
  try {
    const r = await fetchJson(`https://www.okx.com/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${base}&period=1D&limit=1`);
    const row = r?.data?.[0];
    if (row) return num(row[1]);
  } catch { /* omit */ }
  return undefined;
}

async function attachPositioning(baseObj, base, win) {
  if (!win.live) return;
  const [bin, byOi, okxR] = await Promise.all([
    binancePositioning(base, win),
    bybitOiChange(base, win),
    okxAccountRatio(base),
  ]);
  if (baseObj.Binance?.ok) Object.assign(baseObj.Binance, bin);
  if (baseObj.Bybit?.ok && byOi !== undefined) baseObj.Bybit.oiChangePct = byOi;
  if (baseObj.OKX?.ok && okxR !== undefined) baseObj.OKX.longShortAccount = okxR;
}

// ---- movers: biggest Binance USDT-perp moves on the report day ----
async function collectMovers(win, { topN = 3, minQuoteVol = 50e6, exchangeInfo = null, ticker24h = null } = {}) {
  const [info, all] = await Promise.all([
    exchangeInfo ? Promise.resolve(exchangeInfo) : fetchJson(`https://fapi.binance.com/fapi/v1/exchangeInfo`),
    ticker24h ? Promise.resolve(ticker24h) : fetchJson(`https://fapi.binance.com/fapi/v1/ticker/24hr`),
  ]);
  const perps = new Set(info.symbols.filter((x) => x.status === "TRADING" && x.contractType === "PERPETUAL" && x.quoteAsset === "USDT").map((x) => x.symbol));
  const ranked = all
    .filter((t) => perps.has(t.symbol) && !["BTCUSDT", "ETHUSDT"].includes(t.symbol) && num(t.quoteVolume) != null)
    .map((t) => ({ symbol: t.symbol, base: t.symbol.replace(/USDT$/, ""), chgPct24h: num(t.priceChangePercent), last: num(t.lastPrice), volUSD: num(t.quoteVolume), high: num(t.highPrice), low: num(t.lowPrice) }))
    .sort((a, b) => Math.abs(b.chgPct24h) - Math.abs(a.chgPct24h));
  const liquid = ranked.filter((m) => (m.volUSD || 0) >= minQuoteVol);
  const main = liquid.slice(0, topN);
  // low-liquidity / newly-listed movers, surfaced separately (item 34)
  const lowLiq = ranked.filter((m) => (m.volUSD || 0) < minQuoteVol).slice(0, topN);

  // day-bounded numbers for the headlined movers (fall back to 24h ticker)
  for (const m of main) {
    const k = await klineBinance(m.symbol, win.dayStartMs, win.dayEndMs).catch(() => null);
    if (k && k.open) {
      m.basis = "utc-day"; m.chgPct = ((k.close - k.open) / k.open) * 100; m.high = k.high; m.low = k.low; m.volUSD = k.quoteVol; m.close = k.close;
    } else {
      m.basis = "rolling-24h"; m.chgPct = m.chgPct24h;
    }
    m.venues = ["Binance"];
  }
  for (const m of lowLiq) { m.basis = "rolling-24h"; m.chgPct = m.chgPct24h; }
  return { main, lowLiq };
}

export async function collectExchanges(win, { config = {}, exchangeInfo = null, ticker24h = null } = {}) {
  const minQuoteVol = num(config.moversMinQuoteVolUSD) ?? 50e6;
  // Movers are ranked from the live 24h ticker, so they only make sense for a live run.
  // A past-date backfill omits them rather than mixing today's movers into a past report.
  const [btc, eth, moversRes] = await Promise.all([
    collectBase("BTC", win),
    collectBase("ETH", win),
    win.live ? collectMovers(win, { minQuoteVol, exchangeInfo, ticker24h }) : Promise.resolve({ main: [], lowLiq: [] }),
  ]);
  await Promise.all([attachPositioning(btc, "BTC", win), attachPositioning(eth, "ETH", win)]);

  // venuesOnline = union of venues with at least one OK record across BTC/ETH (item 29)
  const onlineForSym = (obj) => Object.keys(VENUES).filter((v) => obj[v] && obj[v].ok);
  const btcOnline = onlineForSym(btc), ethOnline = onlineForSym(eth);
  const venuesOnline = Object.keys(VENUES).filter((v) => btcOnline.includes(v) || ethOnline.includes(v));

  return {
    fetchedAt: Date.now(),
    majors: { BTC: btc, ETH: eth },
    movers: moversRes.main,
    lowLiqMovers: moversRes.lowLiq,
    venuesOnline,
    venuesOnlineBySymbol: { BTC: btcOnline, ETH: ethOnline },
  };
}
