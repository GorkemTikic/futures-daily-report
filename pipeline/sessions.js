// Cash-market session detection for tokenised-stock perpetuals.
//
// Binance's tokenised-stock perps trade ~24/7, but the underlying cash markets (Korea,
// Hong Kong, China, US) are open only a few hours on weekdays. Over a weekend or a local
// holiday the perp keeps drifting, and that drift must NOT be presented as "the day's
// move in the stock". For each market this computes whether the cash market actually had
// a session inside the report's UTC day, and returns an explicit status the renderer and
// the synthesis prompt use instead of a stale number.
//
// Regular trading hours are given in UTC (they sit fully inside the same UTC day for all
// four markets: Asia in the early UTC hours, the US in mid-UTC). So "did a session occur
// on UTC day D" reduces to "is D a weekday and not a holiday for that exchange".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let HOLIDAYS = {};
try { HOLIDAYS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "market-holidays.json"), "utf8")); } catch { HOLIDAYS = {}; }

// underlyingType -> exchange group + human label + a plain-English hours note (UTC)
const MARKETS = {
  KR_EQUITY: { exchange: "KRX", label: "Korea", hoursUTC: "00:00–06:30 UTC (KRX)" },
  HK_EQUITY: { exchange: "HKEX", label: "Hong Kong", hoursUTC: "01:30–08:00 UTC (HKEX)" },
  CN_EQUITY: { exchange: "SSE", label: "China", hoursUTC: "01:30–07:00 UTC (SSE/SZSE)" },
  EQUITY: { exchange: "NYSE", label: "US", hoursUTC: "13:30–20:00 UTC (NYSE/Nasdaq, ±1h with US DST)" },
  COMMODITY: { exchange: null, label: "Commodities", hoursUTC: "nearly 24h (CME Globex), Sun–Fri" },
  PREMARKET: { exchange: null, label: "Pre-market", hoursUTC: "varies" },
};

// dateUTC: "YYYY-MM-DD". Returns { hadSession: boolean|null, reason, note, hoursUTC }.
export function marketStatus(underlyingType, dateUTC) {
  const cfg = MARKETS[underlyingType];
  if (!cfg || !dateUTC) return { hadSession: null, reason: null, note: null, hoursUTC: cfg?.hoursUTC || null };
  const d = new Date(dateUTC + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat

  if (underlyingType === "COMMODITY") {
    if (dow === 6) return { hadSession: false, reason: "weekend", note: "weekend — no session", hoursUTC: cfg.hoursUTC };
    return { hadSession: true, reason: null, note: null, hoursUTC: cfg.hoursUTC };
  }
  if (underlyingType === "PREMARKET") {
    return { hadSession: null, reason: null, note: null, hoursUTC: cfg.hoursUTC };
  }
  if (dow === 0 || dow === 6) {
    return { hadSession: false, reason: "weekend", note: "weekend — no cash session", hoursUTC: cfg.hoursUTC };
  }
  const holName = cfg.exchange && HOLIDAYS[cfg.exchange] ? HOLIDAYS[cfg.exchange][dateUTC] : null;
  if (holName) {
    return { hadSession: false, reason: "holiday", holiday: holName, note: `market closed (${holName})`, hoursUTC: cfg.hoursUTC };
  }
  return { hadSession: true, reason: null, note: null, hoursUTC: cfg.hoursUTC };
}

export const MARKET_META = MARKETS;
