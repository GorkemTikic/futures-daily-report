// Multi-exchange daily report orchestrator (see pipeline/REPORT_SPEC.md).
//   node pipeline/index.js                     -> the most recent completed UTC day
//   node pipeline/index.js --date 2026-09-13   -> a specific past UTC day (day-bounded)
//   node pipeline/index.js --reuse-synthesis   -> reuse cached prose instead of regenerating
//
// Produces reports/<date>/summary_<date>.{html,pdf} (+ .tr/.zh) in the shape the website
// reads, plus report.json (manifest metadata + status) and run.json (per-run health).
// A run whose data/synthesis is degraded still writes a truthful report, but marks itself
// degraded, shows a banner, records why in run.json, alerts, and exits non-zero.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDataPack, resolveWindow } from "./datapack.js";
import { synthesize, resolveTranslation } from "./synthesize.js";
import { buildReportHtml, renderPdf } from "./render.js";
import { loadEnv } from "./env.js";
import { redact } from "./redact.js";

// --- Node version gate (item 15): the pipeline relies on global fetch (Node >= 18). ---
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
if (NODE_MAJOR < 18) {
  console.error(`Node ${process.versions.node} is too old — this pipeline needs Node >= 18 (global fetch). Please upgrade.`);
  process.exit(1);
}

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXTRA_LANGS = ["tr", "zh"];
const DAY_MS = 86400000;

// --- logging: capture console, append (never overwrite) a per-day log, redact secrets ---
const RUN_ID = new Date().toISOString();
const LOG = [`=== run ${RUN_ID} ===`];
let LOG_DATE = null; // set once the report date is known
for (const lvl of ["log", "warn", "error"]) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => { const line = redact(a.map(String).join(" ")); LOG.push(line); orig(line); };
}
function writeLog() {
  try {
    fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
    const name = (LOG_DATE || RUN_ID.slice(0, 10)) + ".log";
    fs.appendFileSync(path.join(ROOT, "logs", name), redact(LOG.join("\n")) + "\n", "utf8");
    LOG.length = 0; // avoid re-writing the same lines on a later writeLog()
  } catch { /* logging must never crash the run */ }
}
process.on("unhandledRejection", (r) => { console.error("UNHANDLED REJECTION:", redact(String(r && r.stack || r))); writeLog(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error("UNCAUGHT EXCEPTION:", redact(String(e && e.stack || e))); writeLog(); process.exit(1); });

function writeAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, file);
}

async function renderPdfAtomic(html, htmlPath, pdfPath) {
  const tmp = pdfPath + ".tmp";
  await renderPdf(html, htmlPath, tmp);
  fs.renameSync(tmp, pdfPath);
}

// --- rolling record of already-published news URLs (item 35) ---
function loadPublishedNews() {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(ROOT, "reports", "published-news.json"), "utf8"));
    const cutoff = Date.now() - 7 * DAY_MS;
    return (Array.isArray(arr) ? arr : []).filter((x) => x && x.at && x.at >= cutoff);
  } catch { return []; }
}
function savePublishedNews(existing, synth) {
  try {
    const urls = [];
    const push = (n) => { if (n && n.url) urls.push(n.url); };
    (synth?.news?.topThree || []).forEach(push);
    Object.values(synth?.news?.groups || {}).forEach((g) => (g || []).forEach(push));
    if (synth?.etfFlows) push(synth.etfFlows);
    const now = Date.now();
    const merged = existing.concat(urls.map((url) => ({ url, at: now })));
    const cutoff = now - 7 * DAY_MS;
    const kept = merged.filter((x) => x.at >= cutoff).slice(-400);
    writeAtomic(path.join(ROOT, "reports", "published-news.json"), JSON.stringify(kept, null, 0));
  } catch { /* non-fatal */ }
}

async function notify(kind, summary) {
  try {
    const { notify: n } = await import("../scripts/notify.mjs");
    await n(kind, summary);
  } catch (e) { console.warn(`notify failed: ${redact(String(e)).slice(0, 120)}`); }
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const args = process.argv.slice(2);
  const di = args.indexOf("--date");
  const dateOverride = di >= 0 ? args[di + 1] : null;
  const reuseSynthesis = args.includes("--reuse-synthesis");
  const scheduled = args.includes("--scheduled");

  // Scheduled model: the task fires hourly (DST-proof) and the pipeline decides whether
  // this is the run for a not-yet-generated UTC day. If the target day's report already
  // exists and is not degraded, exit cheaply (item 12) — no network, no work.
  if (scheduled && !reuseSynthesis && !dateOverride) {
    try {
      const win = resolveWindow({});
      const rj = path.join(ROOT, "reports", win.dateUTC, "report.json");
      if (fs.existsSync(rj)) {
        const m = JSON.parse(fs.readFileSync(rj, "utf8"));
        const haveLangs = Array.isArray(m.languages) && ["en", ...EXTRA_LANGS].every((l) => m.languages.includes(l));
        if (m.status !== "degraded" && haveLangs) {
          console.log(`Report for ${win.dateUTC} already generated (status ok) — nothing to do.`);
          LOG_DATE = win.dateUTC; writeLog();
          process.exit(0);
        }
      }
    } catch { /* fall through and run normally */ }
  }

  const startMs = Date.now();
  const budgetMs = (Number(config.wallClockMinutes) || 45) * 60 * 1000;
  const overBudget = () => Date.now() - startMs > budgetMs;

  const reasons = [];       // human-readable degraded reasons (shown in banner + run.json)
  const runInfo = { runId: RUN_ID, dateOverride, reuseSynthesis, startedAt: RUN_ID, status: "ok" };

  console.log(`Collecting data pack (exchanges, calendar, news, trad-fi, stocks)...`);
  let pack;
  try {
    pack = await buildDataPack({ dateOverride, config });
  } catch (err) {
    // e.g. a future --date, or day-bounded data unfetchable -> refuse, non-zero (item 2)
    console.error(`FATAL: cannot build data pack: ${redact(String(err.message || err)).slice(0, 200)}`);
    writeLog();
    await notify("failed", `data pack failed: ${String(err.message || err).slice(0, 120)}`);
    process.exit(1);
  }
  LOG_DATE = pack.dateUTC;
  const dStr = pack.dateUTC;
  const dayDir = path.join(ROOT, "reports", dStr);
  fs.mkdirSync(dayDir, { recursive: true });
  writeAtomic(path.join(dayDir, "datapack.json"), JSON.stringify(pack, null, 2));

  const venues = pack.sources.exchanges.online;
  console.log(`  window: ${pack.windowLabel}${pack.rolling ? " [ROLLING FALLBACK]" : ""}`);
  console.log(`  venues: ${venues.join(", ") || "none"}`);
  console.log(`  calendar: ${(pack.calendar.reportDay || []).length} on report day / ${(pack.calendar.next24h || []).length} next24h · news candidates: ${(pack.news.items || []).length} · trad-fi: ${pack.sources.tradfi.ok ? "ok" : pack.sources.tradfi.reason}`);

  // --- health conditions known before rendering (item 6) ---
  if (pack.live && venues.length < 3) reasons.push(`only ${venues.length} exchange venue(s) online`);
  const feedsFailed = (pack.sources.news.failed || []).length;
  if (pack.live && feedsFailed >= 2) reasons.push(`${feedsFailed} news feeds failed`);
  if (pack.live && pack.sources.tradfi.requested && !pack.sources.tradfi.ok) reasons.push("traditional-markets data unavailable");

  console.log("Writing the report (synthesis)...");
  const publishedNews = loadPublishedNews().map((x) => x.url);
  const synth = await synthesize(pack, config, dayDir, { reuseSynthesis, publishedNews });
  console.log(`  synthesis source: ${synth._source}`);
  if (synth._error) console.log(`  synthesis error [${synth._errorKind}]: ${redact(String(synth._error)).slice(0, 160)}`);
  if (synth._fellBack) reasons.push(`narrative fell back to data-only${synth._cliOnly ? " (CLI-only backend)" : ""}`);
  if (!synth._fellBack) savePublishedNews(loadPublishedNews(), synth);

  const health = { status: reasons.length ? "degraded" : "ok", reasons: reasons.slice() };

  // --- English report (atomic) ---
  const html = buildReportHtml(pack, synth, "en", health);
  const htmlPath = path.join(dayDir, `summary_${dStr}.html`);
  writeAtomic(htmlPath, html);
  console.log("Rendering PDF (en)...");
  const pdfResults = { en: false };
  try { await renderPdfAtomic(html, htmlPath, path.join(dayDir, `summary_${dStr}.pdf`)); pdfResults.en = true; }
  catch (e) { console.warn(`  en PDF failed: ${redact(String(e)).slice(0, 140)}`); reasons.push("English PDF failed"); }
  writeLog();

  // --- localised versions (skipped if over the wall-clock budget, item 9) ---
  const languages = ["en"];
  for (const lang of EXTRA_LANGS) {
    if (overBudget()) { console.warn(`  ${lang}: skipped — wall-clock budget exceeded`); reasons.push(`${lang} report skipped (time budget)`); continue; }
    const synthL = await resolveTranslation(synth, lang, config, dayDir, { reuseSynthesis });
    if (synthL) {
      const h = buildReportHtml(pack, synthL, lang, { ...health, reasons });
      const hp = path.join(dayDir, `summary_${dStr}.${lang}.html`);
      writeAtomic(hp, h);
      try { await renderPdfAtomic(h, hp, path.join(dayDir, `summary_${dStr}.${lang}.pdf`)); languages.push(lang); pdfResults[lang] = true; console.log(`  ${lang}: written (${synthL._source})`); }
      catch (e) { console.warn(`  ${lang} PDF failed: ${redact(String(e)).slice(0, 140)}`); reasons.push(`${lang} PDF failed`); pdfResults[lang] = false; }
    } else {
      console.log(`  ${lang}: translation unavailable — skipped`);
      reasons.push(`${lang} report unavailable`);
    }
  }

  // --- website manifest metadata + plain-text summary ---
  const groups = (synth.news && synth.news.groups) || {};
  const newsCount = ((synth.news && synth.news.topThree) || []).length + Object.values(groups).reduce((n, g) => n + (g ? g.length : 0), 0);
  const btc = pack.exchanges?.majors?.BTC || {};
  const eth = pack.exchanges?.majors?.ETH || {};
  const lead = (v) => Object.values(v).find((r) => r && r.ok) || {};
  const topMover = (pack.exchanges?.movers || [])[0] || null;
  const finalStatus = reasons.length ? "degraded" : "ok";
  const meta = {
    date: dStr, kind: "market", dateLong: pack.dateLong, coversUTC: pack.coversUTC,
    oneLine: synth.oneLine || "", newsCount,
    macro: { BTC: lead(btc).chgPct ?? null, ETH: lead(eth).chgPct ?? null },
    topMover: topMover ? { symbol: topMover.symbol, chgPct: topMover.chgPct } : null,
    venues, generatedAtUTC: pack.generatedAtUTC, languages,
    status: finalStatus, degradedReasons: reasons.slice(),
  };
  writeAtomic(path.join(dayDir, "report.json"), JSON.stringify(meta, null, 2));

  const md = [
    `# Futures Daily Report — ${dStr} (${pack.coversUTC})`, ``,
    synth.oneLine || "", ``,
    `Venues: ${venues.join(", ")} · BTC ${meta.macro.BTC != null ? (meta.macro.BTC >= 0 ? "+" : "") + meta.macro.BTC.toFixed(2) + "%" : "—"} · ETH ${meta.macro.ETH != null ? (meta.macro.ETH >= 0 ? "+" : "") + meta.macro.ETH.toFixed(2) + "%" : "—"}`,
    topMover && topMover.chgPct != null ? `Top mover: ${topMover.symbol} ${topMover.chgPct >= 0 ? "+" : ""}${topMover.chgPct.toFixed(1)}%` : ``,
    `Sourced news items: ${newsCount}`, ``,
    `Generated ${pack.generatedAtUTC}. Information only, not financial advice.`,
  ].join("\n");
  writeAtomic(path.join(dayDir, `summary_${dStr}.md`), md);

  console.log(`\nDone -> reports/${dStr}/summary_${dStr}.{html,pdf,md}`);

  // --- publish (structured result; a diverged/failed push degrades the run, item 13) ---
  let publishResult = { pushed: false, reason: "disabled" };
  if (config.autoPublish && !overBudget()) {
    try {
      const { publish } = await import("../scripts/publish.mjs");
      publishResult = await publish();
      console.log(publishResult.pushed ? "Published to GitHub Pages site." : `Publish skipped (${publishResult.reason}).`);
    } catch (err) {
      publishResult = { pushed: false, reason: "error", detail: String(err.message || err).slice(0, 160) };
      console.warn(`Publish step failed: ${redact(String(err.message || err)).slice(0, 160)}`);
    }
    const okReasons = new Set(["no-changes", "no-git", "no-origin", "disabled"]);
    if (!publishResult.pushed && !okReasons.has(publishResult.reason)) reasons.push(`publish failed (${publishResult.reason})`);
  } else if (overBudget()) {
    publishResult = { pushed: false, reason: "skipped-time-budget" };
    reasons.push("publish skipped (time budget)");
  }

  // --- run.json health record (item 6) ---
  const status = reasons.length ? "degraded" : "ok";
  runInfo.status = status;
  const run = {
    ...runInfo, status,
    finishedAt: new Date().toISOString(),
    durationSec: Math.round((Date.now() - startMs) / 1000),
    date: dStr, live: pack.live,
    window: { label: pack.windowLabel, startMs: pack.windowStartMs, endMs: pack.windowEndMs, dayAligned: pack.dayAligned, rolling: pack.rolling, asOfUTC: pack.asOfUTC },
    sources: pack.sources,
    synthesis: { source: synth._source, fellBack: !!synth._fellBack, cliOnly: !!synth._cliOnly, errorKind: synth._errorKind || null },
    languages, pdf: pdfResults,
    publish: publishResult,
    reasons,
  };
  writeAtomic(path.join(dayDir, "run.json"), JSON.stringify(run, null, 2));

  if (status === "degraded") {
    console.warn(`RUN DEGRADED: ${reasons.join(" · ")}`);
    await notify("degraded", `${dStr}: ${reasons.join("; ")}`);
  }
  writeLog();
  process.exit(status === "degraded" ? 1 : 0);
}

main().catch(async (err) => {
  console.error("FATAL:", redact(String(err && err.stack || err)));
  writeLog();
  await notify("failed", `fatal: ${String(err && err.message || err).slice(0, 120)}`);
  process.exit(1);
});
