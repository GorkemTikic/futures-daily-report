// New report orchestrator (multi-exchange report per REPORT_SPEC.md).
//   node pipeline/index.js            -> today's report (UTC date folder)
//   node pipeline/index.js --date X   -> a specific day (data is live, so only "today"
//                                        gives meaningful market numbers; kept for testing)
//
// Produces reports/<date>/summary_<date>.{html,pdf} in the same shape the website reads.
// Phase 3 will add manifest rebuild + publish and point the scheduled task here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDataPack } from "./datapack.js";
import { synthesize } from "./synthesize.js";
import { buildReportHtml, renderPdf } from "./render.js";
import { loadEnv } from "./env.js";

loadEnv(); // pick up ANTHROPIC_API_KEY / TRADFI_API_KEY from the gitignored .env

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Capture all console output to a per-day log so a scheduled run (whose stdout Task
// Scheduler discards) still leaves a diagnostic — especially why synthesis fell back.
const LOG = [];
for (const lvl of ["log", "warn", "error"]) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => { LOG.push(a.map(String).join(" ")); orig(...a); };
}
function writeLog(dStr) {
  try { fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true }); fs.writeFileSync(path.join(ROOT, "logs", `${dStr}.log`), LOG.join("\n"), "utf8"); } catch {}
}

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const args = process.argv.slice(2);
  const di = args.indexOf("--date");
  const dateOverride = di >= 0 ? args[di + 1] : null;

  console.log(`=== ${new Date().toISOString()} · pipeline run ===`);
  console.log("Collecting data pack (exchanges, calendar, news, trad-fi, stocks)...");
  const pack = await buildDataPack({ dateOverride });
  const dStr = pack.dateUTC;
  const dayDir = path.join(ROOT, "reports", dStr);
  fs.mkdirSync(dayDir, { recursive: true });
  fs.writeFileSync(path.join(dayDir, "datapack.json"), JSON.stringify(pack, null, 2), "utf8");
  console.log(`  venues: ${pack.sources.exchangesOnline.join(", ") || "none"}`);
  console.log(`  calendar: ${pack.calendar.today.length} today / ${pack.calendar.week.length} upcoming · news candidates: ${pack.news.items.length} · trad-fi: ${pack.sources.tradFi}`);

  console.log("Writing the report (synthesis)...");
  const synth = await synthesize(pack, config, dayDir);
  console.log(`  synthesis source: ${synth._source}${synth._backend ? ` (attempted backend: ${synth._backend})` : ""}`);
  if (synth._error) console.log(`  synthesis error: ${synth._error}`);
  writeLog(dStr);

  const html = buildReportHtml(pack, synth);
  const htmlPath = path.join(dayDir, `summary_${dStr}.html`);
  const pdfPath = path.join(dayDir, `summary_${dStr}.pdf`);
  fs.writeFileSync(htmlPath, html, "utf8");
  console.log("Rendering PDF...");
  await renderPdf(html, htmlPath, pdfPath);

  // --- metadata for the website manifest + a plain-text summary ---
  const groups = (synth.news && synth.news.groups) || {};
  const newsCount = ((synth.news && synth.news.topThree) || []).length + Object.values(groups).reduce((n, g) => n + (g ? g.length : 0), 0);
  const btc = pack.exchanges?.majors?.BTC || {};
  const eth = pack.exchanges?.majors?.ETH || {};
  const lead = (v) => Object.values(v).find((r) => r && r.ok) || {};
  const topMover = (pack.exchanges?.movers || [])[0] || null;
  const meta = {
    date: dStr, kind: "market", dateLong: pack.dateLong, coversUTC: pack.coversUTC,
    oneLine: synth.oneLine || "", newsCount,
    macro: { BTC: lead(btc).chgPct ?? null, ETH: lead(eth).chgPct ?? null },
    topMover: topMover ? { symbol: topMover.symbol, chgPct: topMover.chgPct } : null,
    venues: pack.sources.exchangesOnline, generatedAtUTC: pack.generatedAtUTC,
  };
  fs.writeFileSync(path.join(dayDir, "report.json"), JSON.stringify(meta, null, 2), "utf8");

  const md = [
    `# Futures Daily Report — ${dStr} (${pack.coversUTC})`, ``,
    synth.oneLine || "", ``,
    `Venues: ${pack.sources.exchangesOnline.join(", ")} · BTC ${meta.macro.BTC != null ? (meta.macro.BTC >= 0 ? "+" : "") + meta.macro.BTC.toFixed(2) + "%" : "—"} · ETH ${meta.macro.ETH != null ? (meta.macro.ETH >= 0 ? "+" : "") + meta.macro.ETH.toFixed(2) + "%" : "—"}`,
    topMover ? `Top mover: ${topMover.symbol} ${topMover.chgPct >= 0 ? "+" : ""}${topMover.chgPct.toFixed(1)}%` : ``,
    `Sourced news items: ${newsCount}`, ``,
    `Generated ${pack.generatedAtUTC}. Information only, not financial advice.`,
  ].join("\n");
  fs.writeFileSync(path.join(dayDir, `summary_${dStr}.md`), md, "utf8");

  console.log(`\nDone -> reports/${dStr}/summary_${dStr}.{html,pdf,md}`);

  // --- publish to the website (auto) ---
  if (config.autoPublish) {
    try {
      const { publish } = await import("../scripts/publish.mjs");
      const res = await publish();
      console.log(res.pushed ? "Published to GitHub Pages site." : `Publish skipped (${res.reason}).`);
    } catch (err) {
      console.warn(`Publish step failed (non-fatal): ${String(err).slice(0, 160)}`);
    }
  }
  writeLog(dStr);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
