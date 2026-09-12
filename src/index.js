// Daily Binance USD-M Futures report — orchestrator.
//
//   node src/index.js                 -> report for today (UTC, up to now)
//   node src/index.js --date 2026-06-13   -> report for a specific past UTC day
//   node src/index.js --all           -> deep-scan ALL symbols (ignore prefilter)
//
// Output goes to reports/<YYYY-MM-DD>/ : the PDF, a markdown summary, and per-flagged
// -coin CSVs under data/. A run log is written to logs/<YYYY-MM-DD>.log.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPerpetualSymbols,
  get24hAll,
  getDayOHLC,
  getKlines,
  getMarkKlines,
  mapWithConcurrency,
} from "./binance.js";
import { computeMetrics } from "./metrics.js";
import { classify, isFlagged, severity, DANGER_ARCHETYPES } from "./classify.js";
import { narrateAll, buildFacts, fmtPrice, fmtPct } from "./narrate.js";
import { getMarketContext, getMarketNews } from "./market.js";
import { priceVsMarkChart, marketOverviewChart } from "./charts.js";
import { buildHtml, renderPdf } from "./pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const ARCHETYPE_LABEL = {
  crash_with_mark_lag: "Crash + lagging mark",
  pump_with_mark_lag: "Spike + lagging mark",
  brief_gap_spike: "Brief price gap",
  pump_and_fade: "Pumped then faded",
  recovery: "V-shaped recovery",
  steady_slide: "Steady decline",
  steady_climb: "Steady climb",
  clean_pump: "Clean spike",
  choppy_volatile: "Choppy / whipsaw",
  calm: "Calm",
};

const log = [];
function say(line) {
  console.log(line);
  log.push(line);
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function hhmm(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function dayStr(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let date = null;
  let all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--date") date = args[++i];
    else if (args[i] === "--all") all = true;
  }
  return { date, all };
}

async function main() {
  const { date, all } = parseArgs();
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const T = config.thresholds;

  // --- time window ---
  let startMs, endMs, isToday;
  if (date) {
    const [y, mo, d] = date.split("-").map(Number);
    startMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
    endMs = startMs + 24 * 3600 * 1000 - 1;
    isToday = dayStr(startMs) === dayStr(Date.now());
    if (endMs > Date.now()) endMs = Date.now();
  } else {
    const now = Date.now();
    startMs = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate(), 0, 0, 0, 0);
    endMs = now;
    isToday = true;
  }
  const dStr = dayStr(startMs);
  const endLabel = isToday ? hhmm(endMs) : "23:59";
  say(`=== Daily Futures Report for ${dStr} (00:00–${endLabel} UTC) ===`);

  // --- universe + cheap per-day ranking ---
  say("Fetching symbol list and 24h stats...");
  const [symbols, vol24h] = await Promise.all([getPerpetualSymbols(), get24hAll()]);
  say(`Perpetual USDT symbols: ${symbols.length}`);

  say("Ranking the day's movers (1d candle per symbol)...");
  const dayRanges = await mapWithConcurrency(
    symbols,
    config.concurrency,
    (sym) => getDayOHLC(sym, startMs, endMs),
    (done, total) => { if (done % 100 === 0 || done === total) process.stdout.write(`  ranked ${done}/${total}\r`); }
  );
  process.stdout.write("\n");

  const ranked = symbols
    .map((sym, i) => ({ sym, day: dayRanges[i] }))
    .filter((x) => x.day && !x.day.__error)
    .sort((a, b) => b.day.rangePct - a.day.rangePct);

  const topN = all || config.prefilterTopN === 0 ? ranked.length : Math.min(config.prefilterTopN, ranked.length);
  const candidates = ranked.slice(0, topN).map((x) => x.sym);
  say(`Deep-scanning top ${candidates.length} movers (1-minute mark + last klines)...`);

  // --- deep fetch + metrics for candidates ---
  const metricsList = await mapWithConcurrency(
    candidates,
    config.concurrency,
    async (sym) => {
      const [last, mark] = await Promise.all([
        getKlines(sym, startMs, endMs),
        getMarkKlines(sym, startMs, endMs),
      ]);
      return computeMetrics(sym, last, mark, vol24h.get(sym));
    },
    (done, total) => { if (done % 20 === 0 || done === total) process.stdout.write(`  scanned ${done}/${total}\r`); }
  );
  process.stdout.write("\n");

  const metrics = metricsList.filter((m) => m && !m.__error);

  // --- classify + flag ---
  for (const m of metrics) {
    m.archetype = classify(m, T);
    m.flagged = isFlagged(m, m.archetype, T);
    m.isDanger = DANGER_ARCHETYPES.has(m.archetype);
    m.severity = severity(m);
  }

  // "Dangerous" for the headline counts = the gap actually entered the >5% danger zone.
  // (2–5% brief blips still get a story page, but aren't called "dangerous".)
  const dangerSyms = metrics.filter((m) => m.maxDiv >= T.divDangerPct);
  const bigMovers = metrics.filter((m) => Math.abs(m.pctChange) >= T.bigMovePct);
  const flagged = metrics.filter((m) => m.flagged).sort((a, b) => b.severity - a.severity);

  // --- widest gap (cover stat) ---
  const widestM = metrics.reduce((best, m) => (!best || m.maxDiv > best.maxDiv ? m : best), null);

  // --- ranking tables ---
  // movers: rank the WHOLE market by the day's range (works for any date)
  const topVolatility = ranked.slice(0, 10).map((x) => {
    const m = metrics.find((mm) => mm.symbol === x.sym);
    return {
      symbol: x.sym,
      range: fmtPct(x.day.rangePct),
      cls: x.day.rangePct >= 25 ? "red" : x.day.rangePct >= 10 ? "amb" : "grn",
      openClose: `${fmtPrice(x.day.open)} → ${fmtPrice(x.day.close)}`,
      vol: m ? fmtPct(m.realizedVol1m, 2) : "—",
    };
  });

  const topDivergence = metrics
    .filter((m) => m.maxDiv >= T.divFlagPct)
    .sort((a, b) => b.maxDiv - a.maxDiv)
    .slice(0, 12)
    .map((m) => ({
      symbol: m.symbol,
      maxDiv: fmtPct(m.maxDiv),
      time: m.divPeak ? m.divPeak.time : "—",
      over2: m.minutesOver2,
      over5: m.minutesOver5,
    }));

  // --- deep-dive pages (narrated) ---
  say("Writing narratives...");
  const deepSyms = flagged.slice(0, config.deepDivePages);
  const narratives = await narrateAll(deepSyms, config);
  const deepDives = [];
  for (let i = 0; i < deepSyms.length; i++) {
    const m = deepSyms[i];
    const narrative = narratives[i];
    const facts = buildFacts(m, m.archetype);
    const worstMinutes = m.perMinute
      .filter((p) => p.div !== null)
      .sort((a, b) => b.div - a.div)
      .slice(0, 12)
      .map((p) => ({
        time: hhmm(p.t),
        lOpen: fmtPrice(p.lOpen),
        lHigh: fmtPrice(p.lHigh),
        lLow: fmtPrice(p.lLow),
        lClose: fmtPrice(p.lClose),
        mClose: fmtPrice(p.mClose),
        div: fmtPct(p.div),
      }));
    deepDives.push({
      m,
      facts,
      narrative,
      worstMinutes,
      chart: priceVsMarkChart(m.perMinute),
      archetypeLabel: ARCHETYPE_LABEL[m.archetype] || m.archetype,
      isDanger: m.isDanger,
    });
    say(`  ${m.symbol}: ${m.archetype} (${narrative.source})`);
  }

  // --- market-wide context (real BTC/ETH/SOL data) + attributed news ---
  say("Fetching market context (BTC/ETH/SOL) and news...");
  const dayDir = path.join(ROOT, "reports", dStr);
  const dataDir = path.join(dayDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const macro = await getMarketContext(startMs, endMs);
  const news = await getMarketNews(dayDir, dStr, macro, config);
  const marketChart = marketOverviewChart(macro.seriesMap);
  say(
    `  market: ${Object.entries(macro.per).map(([k, v]) => `${k} ${v.pctChange.toFixed(1)}%`).join(", ") || "—"}` +
    ` · news: ${news.items.length} item(s) [${news.source}]`
  );

  // --- narrative summary text ---
  const mood = bigMovers.filter((m) => m.pctChange < 0).length > bigMovers.filter((m) => m.pctChange > 0).length ? "soft, falling" : "mixed";
  let tldr;
  if (dangerSyms.length > 0 && widestM) {
    tldr = `It was a <strong>${mood}</strong> day. Most coins behaved normally, but <strong>${dangerSyms.length}</strong> had a dangerous gap open up between their two prices. The standout was <strong>${widestM.symbol}</strong>, whose mark and live prices drifted <strong>${fmtPct(widestM.maxDiv)}</strong> apart — the kind of gap that can get traders liquidated even when the live price doesn't look that bad. The flagged coins are explained one by one from page 4.`;
  } else {
    const mover = ranked[0];
    tldr = `A calm day for price gaps — no coin's two prices drifted dangerously apart. The biggest mover was <strong>${mover.sym}</strong>, which swung <strong>${fmtPct(mover.day.rangePct)}</strong> across the day. Details from page 4.`;
  }
  const overviewLead = `Out of <strong>${symbols.length}</strong> coins scanned, <strong>${bigMovers.length}</strong> moved more than ${T.bigMovePct}% and <strong>${dangerSyms.length}</strong> had a price gap big enough to be dangerous. ${dangerSyms.length === 0 ? "A quiet day for the thing that matters most — the gap between the two prices." : "The list to actually pay attention to is the second one below."}`;

  // --- assemble report data ---
  const dateLong = new Date(startMs).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  const R = {
    dateLong,
    endLabel,
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
    symbolCount: symbols.length,
    bigMoveCount: bigMovers.length,
    dangerCount: dangerSyms.length,
    widest: widestM && widestM.maxDiv >= T.divFlagPct ? { symbol: widestM.symbol, maxDiv: fmtPct(widestM.maxDiv) } : null,
    tldr,
    overviewLead,
    topVolatility,
    topDivergence,
    deepDives,
    macro: macro.per,
    marketChart,
    news,
  };

  // --- output ---
  // (dayDir / dataDir were created above for the news override file)

  // CSVs for every flagged coin
  for (const m of flagged) {
    const rows = ["TimeUTC,LP_Open,LP_High,LP_Low,LP_Close,Mark_Close,Divergence_%"];
    for (const p of m.perMinute) {
      const time = `${dStr} ${hhmm(p.t)}`;
      rows.push(
        [
          time,
          p.lOpen, p.lHigh, p.lLow, p.lClose,
          p.mClose ?? "",
          p.div !== null ? p.div.toFixed(4) : "",
        ].join(",")
      );
    }
    fs.writeFileSync(path.join(dataDir, `${m.symbol}.csv`), rows.join("\n"), "utf8");
  }

  // PDF
  const html = buildHtml(R);
  const htmlPath = path.join(dayDir, `summary_${dStr}.html`);
  const pdfPath = path.join(dayDir, `summary_${dStr}.pdf`);
  say("Rendering PDF...");
  await renderPdf(html, htmlPath, pdfPath);
  // keep the .html alongside the .pdf — it's a viewable web version of the same report

  // Markdown summary
  const md = [
    `# Binance Futures Daily Report — ${dStr}`,
    ``,
    `Coins scanned: ${symbols.length} · moved >${T.bigMovePct}%: ${bigMovers.length} · dangerous price gap: ${dangerSyms.length}`,
    widestM && widestM.maxDiv >= T.divFlagPct ? `Widest gap: ${widestM.symbol} ${fmtPct(widestM.maxDiv)} at ${widestM.divPeak?.time} UTC` : `No divergence above ${T.divFlagPct}% today.`,
    ``,
    `## Market backdrop`,
    Object.keys(R.macro || {}).length
      ? Object.entries(R.macro).map(([k, v]) => `- ${k}: ${fmtPrice(v.open)} → ${fmtPrice(v.close)} (${v.pctChange >= 0 ? "+" : ""}${v.pctChange.toFixed(1)}%, day range ${v.rangePct.toFixed(1)}%)`).join("\n")
      : `- (macro reference unavailable)`,
    R.news && R.news.summary ? `\n${R.news.summary}` : ``,
    ``,
    `## What moved the market (news & social context)`,
    R.news && R.news.items && R.news.items.length
      ? R.news.items.map((n) => `- [${(n.impact || "neutral").toUpperCase()} · conf: ${n.confidence || "?"}] ${n.headline} — ${n.source}${n.url ? ` (${n.url})` : ""}${n.note ? `\n    ${n.note}` : ""}`).join("\n")
      : `- No external news researched for this day (source: ${R.news ? R.news.source : "n/a"}). Moves below are described from price data only.`,
    ``,
    `## Dangerous price gaps`,
    topDivergence.length
      ? topDivergence.map((r) => `- ${r.symbol}: max gap ${r.maxDiv} at ${r.time} UTC (${r.over5} min >5%)`).join("\n")
      : `- none`,
    ``,
    `## Flagged coins (stories in the PDF)`,
    deepDives.map((d) => `- ${d.m.symbol} [${d.archetypeLabel}]: ${d.narrative.headline}`).join("\n"),
    ``,
    `Generated ${R.generatedAt}. Data: Binance USD-M Futures. Information only, not financial advice.`,
  ].join("\n");
  fs.writeFileSync(path.join(dayDir, `summary_${dStr}.md`), md, "utf8");

  say(`\nDone. Output folder: reports\\${dStr}\\`);
  say(`  - summary_${dStr}.pdf`);
  say(`  - summary_${dStr}.md`);
  say(`  - data\\ (${flagged.length} CSV files)`);

  fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "logs", `${dStr}.log`), log.join("\n"), "utf8");

  // --- publish to the GitHub Pages site (auto) ---
  if (config.autoPublish) {
    try {
      const { publish } = await import("../scripts/publish.mjs");
      const res = await publish();
      say(res.pushed ? "Published to GitHub Pages site." : `Publish skipped (${res.reason}).`);
    } catch (err) {
      say(`Publish step failed (non-fatal): ${String(err).slice(0, 160)}`);
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
