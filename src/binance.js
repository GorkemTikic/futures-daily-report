// Binance USD-M Futures data layer.
// IMPORTANT: calls go DIRECTLY to fapi.binance.com. Do NOT route through the
// Cloudflare Worker — Binance 403s the Worker's egress IPs (since 2026-06-10).

const FAPI = "https://fapi.binance.com";

async function fetchJson(url, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "futures-daily-report/1.0" } });
      if (res.status === 429 || res.status === 418) {
        const wait = Number(res.headers.get("retry-after") || 2) * 1000 || 2000;
        await sleep(wait * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} for ${url} :: ${body.slice(0, 200)}`);
      }
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// All TRADING perpetual USDT symbols.
export async function getPerpetualSymbols() {
  const info = await fetchJson(`${FAPI}/fapi/v1/exchangeInfo`);
  return info.symbols
    .filter(
      (s) =>
        s.status === "TRADING" &&
        s.contractType === "PERPETUAL" &&
        s.quoteAsset === "USDT"
    )
    .map((s) => s.symbol);
}

// 24h stats for every symbol in one call. Used to pre-rank volatility cheaply.
export async function get24hAll() {
  const arr = await fetchJson(`${FAPI}/fapi/v1/ticker/24hr`);
  const map = new Map();
  for (const t of arr) {
    map.set(t.symbol, {
      priceChangePct: Number(t.priceChangePercent),
      high: Number(t.highPrice),
      low: Number(t.lowPrice),
      last: Number(t.lastPrice),
      open: Number(t.openPrice),
      quoteVolume: Number(t.quoteVolume),
    });
  }
  return map;
}

// 1-minute klines (last price). Returns [{t, open, high, low, close}] for the window.
export async function getKlines(symbol, startMs, endMs) {
  const url = `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=1m&startTime=${startMs}&endTime=${endMs}&limit=1500`;
  const raw = await fetchJson(url);
  return raw.map((k) => ({
    t: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
  }));
}

// Single daily (1d) candle for the target day — a cheap way to rank a symbol's
// range for ANY date (the rolling 24h ticker only reflects the last 24h).
export async function getDayOHLC(symbol, startMs, endMs) {
  const url = `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=1d&startTime=${startMs}&endTime=${endMs}&limit=2`;
  const raw = await fetchJson(url);
  if (!raw.length) return null;
  const k = raw[0];
  const open = Number(k[1]), high = Number(k[2]), low = Number(k[3]), close = Number(k[4]);
  const rangePct = low > 0 ? ((high - low) / low) * 100 : 0;
  return { open, high, low, close, rangePct };
}

// 1-minute mark-price klines.
export async function getMarkKlines(symbol, startMs, endMs) {
  const url = `${FAPI}/fapi/v1/markPriceKlines?symbol=${symbol}&interval=1m&startTime=${startMs}&endTime=${endMs}&limit=1500`;
  const raw = await fetchJson(url);
  return raw.map((k) => ({
    t: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
  }));
}

// Run async tasks with a concurrency cap and a small progress callback.
export async function mapWithConcurrency(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let index = 0;
  let done = 0;
  async function runner() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { __error: String(err) };
      }
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, runner);
  await Promise.all(runners);
  return results;
}
