// Traditional-markets collector (Step 5): S&P 500, Nasdaq, US Dollar Index, gold, US 10Y.
// Uses Twelve Data (free tier covers indices, FX and metals). Reads TRADFI_API_KEY from
// .env; if no key is set it returns ok:false and the report says the figures were
// unavailable — never guessed. Each symbol is fetched independently so a symbol the free
// plan doesn't cover is simply omitted rather than failing the whole section.
//
// Get a free key: https://twelvedata.com/pricing (Basic/free). Then either paste it to me
// or add a line to .env:   TRADFI_API_KEY=your_key_here

import { loadEnv } from "./env.js";
loadEnv();

const KEY = process.env.TRADFI_API_KEY || "";
const BASE = "https://api.twelvedata.com/quote";

// The free ("Basic 8") plan gates US indices, so we use US-listed ETF proxies that ARE
// on the free tier, each labelled honestly as a proxy. One call per target (5 total),
// which stays under the 8-requests/minute free-tier limit. The report cares about the
// day's DIRECTION, which these track closely.
const TARGETS = [
  { label: "S&P 500", symbol: "SPY", proxy: "SPY ETF" },
  { label: "Nasdaq Composite", symbol: "ONEQ", proxy: "ONEQ ETF" },
  { label: "US Dollar", symbol: "UUP", proxy: "UUP ETF (dollar-bullish)" },
  { label: "Gold", symbol: "XAU/USD", proxy: "spot" },
  { label: "US 10Y Treasuries", symbol: "IEF", proxy: "IEF ETF — bond price, moves inverse to the 10-year yield" },
];

async function quote(symbol) {
  const url = `${BASE}?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(KEY)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const j = await res.json();
  if (!j || j.status === "error" || (j.code && j.code >= 400) || j.close == null) return { err: (j && j.message) ? String(j.message).slice(0, 80) : "no data" };
  const price = Number(j.close);
  const pct = j.percent_change != null ? Number(j.percent_change) : null;
  if (!Number.isFinite(price)) return { err: "non-numeric" };
  return { symbol, name: j.name || symbol, price, changePct: Number.isFinite(pct) ? pct : null };
}

export async function collectTradFi() {
  if (!KEY) return { ok: false, reason: "no-key", items: [] };
  const items = [];
  const missing = [];
  for (const t of TARGETS) {
    let got;
    try { got = await quote(t.symbol); } catch (e) { got = { err: String(e).slice(0, 60) }; }
    if (got && got.price != null) items.push({ label: t.label, proxy: t.proxy, symbol: got.symbol, name: got.name, price: got.price, changePct: got.changePct });
    else missing.push({ label: t.label, err: got ? got.err : "failed" });
  }
  return { ok: items.length > 0, provider: "Twelve Data", items, missing };
}
