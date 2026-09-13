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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));

  console.log("Collecting data pack (exchanges, calendar, news, trad-fi)...");
  const pack = await buildDataPack();
  const dStr = pack.dateUTC;
  const dayDir = path.join(ROOT, "reports", dStr);
  fs.mkdirSync(dayDir, { recursive: true });
  fs.writeFileSync(path.join(dayDir, "datapack.json"), JSON.stringify(pack, null, 2), "utf8");
  console.log(`  venues: ${pack.sources.exchangesOnline.join(", ") || "none"}`);
  console.log(`  calendar: ${pack.calendar.today.length} today / ${pack.calendar.week.length} upcoming · news candidates: ${pack.news.items.length} · trad-fi: ${pack.sources.tradFi}`);

  console.log("Writing the report (synthesis)...");
  const synth = await synthesize(pack, config, dayDir);
  console.log(`  synthesis source: ${synth._source}`);

  const html = buildReportHtml(pack, synth);
  const htmlPath = path.join(dayDir, `summary_${dStr}.html`);
  const pdfPath = path.join(dayDir, `summary_${dStr}.pdf`);
  fs.writeFileSync(htmlPath, html, "utf8");
  console.log("Rendering PDF...");
  await renderPdf(html, htmlPath, pdfPath);

  console.log(`\nDone -> reports/${dStr}/summary_${dStr}.html + .pdf`);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
