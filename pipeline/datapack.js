// Assembles the full "data pack" for one day's report: normalised multi-venue exchange
// data + the macro calendar + news candidates. This is the deterministic, verified input
// the synthesis step turns into the written report. Flows (ETF) and traditional-markets
// data are attached when available and otherwise flagged unavailable — never guessed.
//
//   node pipeline/datapack.js            -> writes reports/<UTC date>/datapack.json
//   import { buildDataPack } from ...     -> returns the object

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectExchanges } from "./exchanges.js";
import { collectCalendar } from "./calendar.js";
import { collectNews } from "./news.js";
import { collectTradFi } from "./tradfi.js";
import { collectStocks } from "./stocks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function utcDateStr(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function utcLong(ms) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(ms));
}
function utcDateTime(ms) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms)) + " UTC";
}

export async function buildDataPack({ nowMs = Date.now() } = {}) {
  // The report covers a full UTC calendar day and is generated at 00:00 UTC (03:00
  // Istanbul) for the day that just closed. Anchor the report date to the centre of the
  // rolling-24h window (nowMs - 12h): at 00:00 UTC that resolves to the completed day.
  const reportMs = nowMs - 12 * 3600e3;

  const [exchanges, calendar, news, tradfi, stocks] = await Promise.all([
    collectExchanges().catch((e) => ({ error: String(e).slice(0, 120), majors: { BTC: {}, ETH: {} }, movers: [], venuesOnline: [] })),
    collectCalendar(nowMs).catch((e) => ({ ok: false, err: String(e).slice(0, 120), today: [], week: [] })),
    collectNews({ nowMs }).catch((e) => ({ ok: false, err: String(e).slice(0, 120), items: [], failed: [], sourcesOnline: [] })),
    collectTradFi().catch((e) => ({ ok: false, reason: String(e).slice(0, 120), items: [] })),
    collectStocks().catch((e) => ({ ok: false, err: String(e).slice(0, 120), markets: {}, topMovers: [] })),
  ]);

  const sources = {
    exchangesOnline: exchanges.venuesOnline || [],
    calendarOk: !!calendar.ok,
    newsSourcesOnline: news.sourcesOnline || [],
    newsFailed: news.failed || [],
    // ETF flows are gathered by the synthesis step via web (Farside/SoSoValue) and
    // date-validated there; recorded here as not-yet-collected.
    etfFlows: "pending-synthesis",
    tradFi: tradfi.ok ? "ok" : tradfi.reason || "unavailable",
  };

  return {
    generatedAtMs: nowMs,
    dateUTC: utcDateStr(reportMs),          // the completed UTC day this report covers
    dateLong: utcLong(reportMs),            // e.g. "Friday, 12 September 2026"
    coversUTC: "00:00–23:59 UTC",
    generatedAtUTC: utcDateTime(nowMs),     // when this run happened, for the footer
    timezone: "UTC",
    exchanges,
    calendar,
    news,
    tradfi,
    stocks,
    sources,
  };
}

// CLI: write the pack to the day's report folder
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  const pack = await buildDataPack();
  const dir = path.join(ROOT, "reports", pack.dateUTC);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "datapack.json");
  fs.writeFileSync(out, JSON.stringify(pack, null, 2), "utf8");
  console.log(`datapack.json written -> reports/${pack.dateUTC}/datapack.json`);
  console.log(`  exchanges online: ${pack.sources.exchangesOnline.join(", ")}`);
  console.log(`  calendar: today ${pack.calendar.today.length}, upcoming ${pack.calendar.week.length}`);
  console.log(`  news candidates: ${pack.news.items.length} (sources: ${pack.sources.newsSourcesOnline.length}/${pack.sources.newsSourcesOnline.length + (pack.sources.newsFailed?.length || 0)})`);
}
