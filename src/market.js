// Market-wide context layer — the "what happened across the whole market and why"
// that the per-coin pages can't show on their own.
//
//  1. MACRO DATA (always, deterministic): BTC + ETH (+ SOL) real 1-minute candles
//     from Binance for the day. Real numbers, no network beyond Binance, never faked.
//  2. NEWS / SOCIAL CONTEXT: attributed headlines explaining the day. Resolved in
//     priority order:
//        a. reports/<date>/news.json  — a hand- or research-provided override (wins).
//        b. the narrator (claude -p / API) researching the day's crypto news.
//        c. a deterministic data-only summary derived from the macro numbers.
//     Every news item carries a source; the report never presents an unsourced claim
//     as news. Whatever is resolved is written back to news.json for reproducibility.

import fs from "node:fs";
import path from "node:path";
import { getKlines } from "./binance.js";
import { narrateMarketBrief } from "./narrate.js";

const MACRO_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const SHORT = { BTCUSDT: "BTC", ETHUSDT: "ETH", SOLUSDT: "SOL" };

function thin(series, everyMs = 120000) {
  // keep first, last, and one point per `everyMs` — keeps the SVG small
  if (series.length <= 2) return series;
  const out = [series[0]];
  let lastT = series[0].t;
  for (let i = 1; i < series.length - 1; i++) {
    if (series[i].t - lastT >= everyMs) { out.push(series[i]); lastT = series[i].t; }
  }
  out.push(series[series.length - 1]);
  return out;
}

// Real macro numbers + thinned series for the overview chart.
export async function getMarketContext(startMs, endMs) {
  const per = {};
  const seriesMap = {};
  for (const sym of MACRO_SYMBOLS) {
    try {
      const k = await getKlines(sym, startMs, endMs);
      if (!k || k.length < 2) continue;
      const open = k[0].open;
      const close = k[k.length - 1].close;
      let high = -Infinity, low = Infinity;
      for (const c of k) { if (c.high > high) high = c.high; if (c.low < low) low = c.low; }
      const pctChange = ((close - open) / open) * 100;
      const rangePct = low > 0 ? ((high - low) / low) * 100 : 0;
      const short = SHORT[sym];
      per[short] = { symbol: sym, open, close, high, low, pctChange, rangePct };
      seriesMap[short] = thin(k.map((c) => ({ t: c.t, close: c.close })));
    } catch {
      /* skip a macro symbol that fails; the report degrades gracefully */
    }
  }
  return { per, seriesMap };
}

function validNewsArray(x) {
  return Array.isArray(x) && x.every((n) => n && typeof n.headline === "string" && typeof n.source === "string");
}

// Resolve the news/social context for the day.
export async function getMarketNews(dayDir, dStr, macro, config) {
  const overridePath = path.join(dayDir, "news.json");

  // (a) override file wins
  try {
    if (fs.existsSync(overridePath)) {
      const parsed = JSON.parse(fs.readFileSync(overridePath, "utf8"));
      const items = parsed.items || parsed;
      if (validNewsArray(items)) {
        return { summary: parsed.summary || "", items, source: parsed.source || "override (news.json)" };
      }
    }
  } catch {
    /* malformed override — fall through */
  }

  // (b) narrator research (claude -p / API). Off unless config.marketNews is enabled.
  if (config.marketNews !== false) {
    try {
      const brief = await narrateMarketBrief(dStr, macro, config);
      if (brief && validNewsArray(brief.items) && brief.items.length) {
        // persist for reproducibility / auditing
        try { fs.writeFileSync(overridePath, JSON.stringify(brief, null, 2), "utf8"); } catch {}
        return { summary: brief.summary || "", items: brief.items, source: "researched (" + (brief.backend || "narrator") + ")" };
      }
    } catch {
      /* research unavailable — fall through to data-only */
    }
  }

  // (c) deterministic, data-only fallback — always truthful, derived from real numbers
  return { summary: dataOnlySummary(macro), items: [], source: "data-only (no external news available)" };
}

function fmtPct(x) {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  return (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
}

export function dataOnlySummary(macro) {
  const p = macro && macro.per ? macro.per : {};
  const bits = [];
  for (const k of ["BTC", "ETH", "SOL"]) {
    if (p[k]) bits.push(`${k} ${fmtPct(p[k].pctChange)}`);
  }
  if (!bits.length) return "No macro reference data was available for this day.";
  const dir = p.BTC ? (p.BTC.pctChange >= 0 ? "up" : "down") : "mixed";
  return `Market backdrop from Binance price data only (no external news was researched for this day): ${bits.join(", ")} over the UTC day. ` +
    `Bitcoin — the market's anchor — finished ${dir}. Altcoin futures moves below should be read against this backdrop.`;
}
