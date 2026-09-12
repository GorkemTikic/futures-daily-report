// Build docs/manifest.json — the index the website reads to list every report.
//
// It parses each reports/<date>/summary_<date>.md into structured metadata and
// records which output files exist. It is deliberately TOLERANT: if a field is
// missing (older report, or a future format change) it is simply left null, so
// the site keeps working across report redesigns. The only hard contract the
// site relies on is that each day has a folder reports/<YYYY-MM-DD>/ containing
// summary_<date>.md and summary_<date>.html.
//
//   node scripts/build-manifest.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");
const OUT = path.join(ROOT, "manifest.json");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function num(s) {
  const n = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseReport(date, md) {
  const r = {
    date,
    scanned: null,
    movedBig: null,
    dangerCount: null,
    widest: null,       // { symbol, pct, time }
    macro: null,        // { BTC, ETH, SOL } as % numbers
    marketSummary: null,
    newsCount: 0,
    flagged: [],        // [{ symbol, label, headline }]
  };
  if (!md) return r;
  const lines = md.split(/\r?\n/);

  // header counts line: "Coins scanned: 528 · moved >25%: 3 · dangerous price gap: 0"
  const head = md.match(/Coins scanned:\s*([\d,]+).*?moved\s*>?\s*\d+%?:\s*(\d+).*?dangerous price gap:\s*(\d+)/i);
  if (head) {
    r.scanned = num(head[1]);
    r.movedBig = num(head[2]);
    r.dangerCount = num(head[3]);
  }

  // widest gap: "Widest gap: IOSTUSDT 3.7% at 11:50 UTC"
  const widest = md.match(/Widest gap:\s*(\S+)\s+([\d.]+%)\s+at\s+([\d:]+)\s*UTC/i);
  if (widest) r.widest = { symbol: widest[1], pct: widest[2], time: widest[3] };

  // macro backdrop lines: "- BTC: $78264 → $76535.7 (-2.2%, day range 2.8%)"
  const macro = {};
  for (const m of md.matchAll(/^-\s*(BTC|ETH|SOL):.*?\(([-+]?[\d.]+)%/gim)) {
    macro[m[1]] = num(m[2]);
  }
  if (Object.keys(macro).length) r.macro = macro;

  // market summary paragraph: the non-bullet line right after "## Market backdrop"
  const mbIdx = lines.findIndex((l) => /^##\s*Market backdrop/i.test(l));
  if (mbIdx >= 0) {
    for (let i = mbIdx + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith("##")) break;
      if (l && !l.startsWith("-")) { r.marketSummary = l; break; }
    }
  }

  // news items under "## What moved the market": count top-level "- [" bullets
  const newsIdx = lines.findIndex((l) => /^##\s*What moved the market/i.test(l));
  if (newsIdx >= 0) {
    for (let i = newsIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^##\s/.test(l)) break;
      if (/^-\s*\[/.test(l)) r.newsCount++;
      // a "no external news" bullet counts as zero
      if (/No external news researched/i.test(l)) r.newsCount = 0;
    }
  }

  // flagged coins: "- SYM [Label]: headline"
  const flIdx = lines.findIndex((l) => /^##\s*Flagged coins/i.test(l));
  if (flIdx >= 0) {
    for (let i = flIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^##\s/.test(l)) break;
      const m = l.match(/^-\s*(\S+)\s*\[([^\]]+)\]:\s*(.+)$/);
      if (m) r.flagged.push({ symbol: m[1], label: m[2], headline: m[3].trim() });
    }
  }
  return r;
}

function main() {
  if (!fs.existsSync(REPORTS)) {
    console.error("No reports/ directory found.");
    process.exit(1);
  }
  const dates = fs
    .readdirSync(REPORTS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && DATE_RE.test(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();

  const reports = [];
  for (const date of dates) {
    const dir = path.join(REPORTS, date);
    const mdPath = path.join(dir, `summary_${date}.md`);
    const htmlPath = path.join(dir, `summary_${date}.html`);
    const pdfPath = path.join(dir, `summary_${date}.pdf`);
    let md = null;
    try { md = fs.readFileSync(mdPath, "utf8"); } catch { /* no md */ }
    const entry = parseReport(date, md);
    entry.files = {
      html: fs.existsSync(htmlPath) ? `reports/${date}/summary_${date}.html` : null,
      pdf: fs.existsSync(pdfPath) ? `reports/${date}/summary_${date}.pdf` : null,
      md: fs.existsSync(mdPath) ? `reports/${date}/summary_${date}.md` : null,
    };
    reports.push(entry);
  }

  const manifest = {
    title: "Futures Daily Report",
    generatedAt: new Date().toISOString(),
    count: reports.length,
    latest: reports[0]?.date ?? null,
    reports,
  };

  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`manifest.json written: ${reports.length} reports (latest ${manifest.latest}).`);
}

main();
