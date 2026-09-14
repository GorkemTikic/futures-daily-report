// Traditional-markets collector (Step 5): S&P 500, Nasdaq, US Dollar Index, gold, US 10Y.
// Uses Twelve Data (free tier). Reads TRADFI_API_KEY from .env; with no key it returns
// ok:false and the report says the figures were unavailable — never guessed.
//
// Twelve Data's percent_change is the LATEST completed session's move, which may be an
// earlier calendar day than the report (e.g. a Monday report carrying Friday's move). We
// keep the session date from the quote so the renderer can label the column with the real
// session date instead of "Today" — and note when it differs from the report day.

import { loadEnv } from "./env.js";
import { fetchJson } from "./http.js";
loadEnv();

const KEY = process.env.TRADFI_API_KEY || "";
const BASE = "https://api.twelvedata.com/quote";

const TARGETS = [
  { label: "S&P 500", symbol: "SPY", proxy: "SPY ETF" },
  { label: "Nasdaq Composite", symbol: "ONEQ", proxy: "ONEQ ETF" },
  { label: "US Dollar", symbol: "UUP", proxy: "UUP ETF (dollar-bullish)" },
  { label: "Gold", symbol: "XAU/USD", proxy: "spot" },
  { label: "US 10Y Treasuries", symbol: "IEF", proxy: "IEF ETF — bond price, moves inverse to the 10-year yield" },
];

function sessionDateFrom(j) {
  // Prefer the numeric timestamp, then the datetime string. Return YYYY-MM-DD (UTC-ish;
  // the exact session close TZ isn't material for a date label) or null.
  if (j.timestamp != null && Number.isFinite(Number(j.timestamp))) {
    return new Date(Number(j.timestamp) * 1000).toISOString().slice(0, 10);
  }
  if (typeof j.datetime === "string" && /^\d{4}-\d{2}-\d{2}/.test(j.datetime)) return j.datetime.slice(0, 10);
  return null;
}

async function quote(symbol) {
  const url = `${BASE}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(KEY)}`;
  const j = await fetchJson(url, { retries: 1, timeoutMs: 15000 });
  if (!j || j.status === "error" || (j.code && j.code >= 400) || j.close == null) {
    return { err: (j && j.message) ? String(j.message).slice(0, 80) : "no data" };
  }
  const price = Number(j.close);
  const pct = j.percent_change != null ? Number(j.percent_change) : null;
  if (!Number.isFinite(price)) return { err: "non-numeric" };
  return {
    symbol, name: j.name || symbol, price, changePct: Number.isFinite(pct) ? pct : null,
    sessionDate: sessionDateFrom(j), isMarketOpen: j.is_market_open === true || j.is_market_open === "true",
  };
}

export async function collectTradFi({ dateUTC = null } = {}) {
  if (!KEY) return { ok: false, reason: "no-key", requested: false, items: [] };
  const items = [];
  const missing = [];
  for (const t of TARGETS) {
    let got;
    try { got = await quote(t.symbol); } catch (e) { got = { err: String(e).slice(0, 60) }; }
    if (got && got.price != null && got.sessionDate) {
      items.push({
        label: t.label, proxy: t.proxy, symbol: got.symbol, name: got.name,
        price: got.price, changePct: got.changePct,
        sessionDate: got.sessionDate, staleForReport: dateUTC ? got.sessionDate !== dateUTC : false,
      });
    } else {
      // no usable session date -> omit the row rather than mislabel it (item 5)
      missing.push({ label: t.label, err: got ? (got.err || "no session date") : "failed" });
    }
  }
  return { ok: items.length > 0, provider: "Twelve Data", requested: true, items, missing };
}
