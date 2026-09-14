// Assembles the full "data pack" for one day's report: normalised multi-venue exchange
// data + the macro calendar + news candidates + stocks + trad-fi. This is the
// deterministic, verified input the synthesis step turns into the written report.
//
// The report covers ONE full UTC calendar day. Day-boundable figures (price/volume) come
// from each venue's daily kline bounded to that day (see exchanges.js); point-in-time
// figures (funding/OI/mark) are captured "as of" the window end and labelled as such.
// A past --date backfill fetches day-bounded klines for that date and marks everything
// that cannot be reconstructed for a past day (funding/OI/mark/news/trad-fi) unavailable,
// so the renderer omits it — never a live snapshot wearing a past date.
//
//   node pipeline/datapack.js            -> writes reports/<UTC date>/datapack.json
//   import { buildDataPack } from ...     -> returns the object

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson } from "./http.js";
import { collectExchanges } from "./exchanges.js";
import { collectCalendar } from "./calendar.js";
import { collectNews } from "./news.js";
import { collectTradFi } from "./tradfi.js";
import { collectStocks } from "./stocks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DAY_MS = 86400000;

function startOfUTCDay(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function utcDateStr(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function utcLong(ms) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));
}
function utcShort(ms) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}
function utcTime(ms) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms));
}
function utcDateTime(ms) {
  return utcShort(ms).replace(",", "") + " UTC";
}

// Resolve which UTC day the report covers, and whether the run is live or a backfill.
// Throws (caught upstream -> non-zero exit) for a future --date.
export function resolveWindow({ nowMs = Date.now(), dateOverride = null } = {}) {
  const todayStart = startOfUTCDay(nowMs);
  let dayStartMs;
  let live;
  if (dateOverride) {
    const parsed = Date.parse(dateOverride + "T00:00:00Z");
    if (!Number.isFinite(parsed)) throw new Error(`--date "${dateOverride}" is not a valid YYYY-MM-DD.`);
    dayStartMs = startOfUTCDay(parsed);
    if (dayStartMs > todayStart) throw new Error(`--date ${dateOverride} is in the future (UTC). Refusing to write a report for a day that hasn't happened.`);
    // "today" as an override is still live; any earlier day is a backfill.
    live = dayStartMs === todayStart;
    // A same-day override never makes sense (the day isn't closed) — treat as the
    // just-closed day unless it's genuinely today's backfill request. Keep live semantics.
  } else {
    // Normal run: the most recently completed UTC day (the day before the run's UTC date).
    dayStartMs = todayStart - DAY_MS;
    live = true;
  }
  const dayEndMs = dayStartMs + DAY_MS - 1;
  const asOfMs = live ? nowMs : dayEndMs;
  const dayAligned = live && nowMs - (dayStartMs + DAY_MS) <= 15 * 60 * 1000 && nowMs >= dayStartMs + DAY_MS;
  return {
    nowMs, live,
    dayStartMs, dayEndMs, asOfMs,
    windowStartMs: dayStartMs, windowEndMs: dayEndMs,
    dayAligned,
    dateUTC: utcDateStr(dayStartMs),
    dateLong: utcLong(dayStartMs),
  };
}

function windowLabel(win, rolling) {
  if (rolling && win.live) {
    return `${utcShort(win.nowMs - DAY_MS)} → ${utcShort(win.nowMs)} UTC (rolling 24h)`;
  }
  return `${utcDateStr(win.dayStartMs)} 00:00 → 24:00 UTC`;
}

export async function buildDataPack({ nowMs = Date.now(), dateOverride = null, config = {} } = {}) {
  const win = resolveWindow({ nowMs, dateOverride });

  // Fetch the two heavy Binance snapshots ONCE and share them with both the exchange
  // movers scan and the stocks collector (item 32) — each is weight ~80.
  let exchangeInfo = null, ticker24h = null;
  if (win.live) {
    [exchangeInfo, ticker24h] = await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/exchangeInfo`).catch(() => null),
      fetchJson(`https://fapi.binance.com/fapi/v1/ticker/24hr`).catch(() => null),
    ]);
  }

  const [exchanges, calendar, news, tradfi, stocks] = await Promise.all([
    collectExchanges(win, { config, exchangeInfo, ticker24h }).catch((e) => ({ error: String(e).slice(0, 120), majors: { BTC: {}, ETH: {} }, movers: [], lowLiqMovers: [], venuesOnline: [] })),
    collectCalendar({ nowMs, reportDayKey: win.dateUTC }).catch((e) => ({ ok: false, err: String(e).slice(0, 120), reportDay: [], next24h: [], week: [] })),
    win.live
      ? collectNews({ nowMs, win, config }).catch((e) => ({ ok: false, err: String(e).slice(0, 120), items: [], failed: [], sourcesOnline: [] }))
      : Promise.resolve({ ok: false, reason: "unavailable-for-backfill", items: [], failed: [], sourcesOnline: [], backfill: true }),
    win.live
      ? collectTradFi({ dateUTC: win.dateUTC }).catch((e) => ({ ok: false, reason: String(e).slice(0, 120), items: [] }))
      : Promise.resolve({ ok: false, reason: "unavailable-for-backfill", items: [], backfill: true }),
    // Stocks are the perp's live 24h move — only meaningful for a live run.
    win.live
      ? collectStocks(win, { exchangeInfo, ticker24h }).catch((e) => ({ ok: false, err: String(e).slice(0, 120), markets: {}, topMovers: [] }))
      : Promise.resolve({ ok: false, reason: "unavailable-for-backfill", markets: {}, topMovers: [], sessions: {}, backfill: true }),
  ]);

  // Backfill with no day-bounded data at all -> refuse (item 2), caught in index.js.
  if (!win.live && (!exchanges.venuesOnline || exchanges.venuesOnline.length === 0)) {
    throw new Error(`backfill: no UTC-day kline data available for ${win.dateUTC} — refusing to write an empty past-dated report.`);
  }

  // The global honesty note fires only when the BENCHMARK (Binance BTC) itself fell back
  // to a rolling window — otherwise the day IS the full UTC day. Individual venues that
  // fell back are marked per-row in the renderer instead of stamping every report.
  const btcObj = exchanges.majors?.BTC || {};
  const bench = btcObj.Binance && btcObj.Binance.ok ? btcObj.Binance : Object.values(btcObj).find((r) => r && r.ok);
  const rolling = bench ? bench.basis === "rolling-24h" : false;
  const anyRolling = [...Object.values(btcObj), ...Object.values(exchanges.majors?.ETH || {})].some((r) => r && r.ok && r.basis === "rolling-24h");

  const sources = {
    exchanges: { online: exchanges.venuesOnline || [], count: (exchanges.venuesOnline || []).length, bySymbol: exchanges.venuesOnlineBySymbol || {} },
    calendar: { ok: !!calendar.ok, reason: calendar.ok ? null : (calendar.err || "unavailable") },
    news: { ok: !!news.ok, sourcesOnline: news.sourcesOnline || [], failed: news.failed || [], count: (news.items || []).length, backfill: !!news.backfill },
    tradfi: { ok: !!tradfi.ok, reason: tradfi.ok ? null : (tradfi.reason || "unavailable"), requested: !!tradfi.requested, backfill: !!tradfi.backfill },
    stocks: { ok: !!stocks.ok, reason: stocks.ok ? null : (stocks.err || "unavailable") },
    etfFlows: win.live ? "pending-synthesis" : "unavailable-for-backfill",
    backfill: win.live ? null : { unavailable: ["funding", "open interest", "mark price", "news", "traditional markets"] },
  };

  return {
    generatedAtMs: nowMs,
    live: win.live,
    dateUTC: win.dateUTC,
    dateLong: win.dateLong,
    windowStartMs: win.windowStartMs,
    windowEndMs: win.windowEndMs,
    asOfMs: win.asOfMs,
    asOfUTC: utcTime(win.asOfMs) + " UTC",
    dayAligned: win.dayAligned,
    rolling, anyRolling,
    windowLabel: windowLabel(win, rolling),
    coversUTC: `${win.dateUTC} 00:00–23:59 UTC`,
    generatedAtUTC: utcDateTime(nowMs),
    timezone: "UTC",
    exchanges, calendar, news, tradfi, stocks,
    sources,
  };
}

// CLI: write the pack to the day's report folder
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  const args = process.argv.slice(2);
  const di = args.indexOf("--date");
  const pack = await buildDataPack({ dateOverride: di >= 0 ? args[di + 1] : null });
  const dir = path.join(ROOT, "reports", pack.dateUTC);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "datapack.json"), JSON.stringify(pack, null, 2), "utf8");
  console.log(`datapack.json written -> reports/${pack.dateUTC}/datapack.json`);
  console.log(`  window: ${pack.windowLabel}${pack.rolling ? " [ROLLING FALLBACK]" : ""}`);
  console.log(`  exchanges online: ${pack.sources.exchanges.online.join(", ") || "none"}`);
}
