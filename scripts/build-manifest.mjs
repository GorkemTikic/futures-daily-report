// Build the website's report index. Writes TWO files (item 25):
//   manifest.json       — a small head: the latest N entries + counts, for the first paint
//   manifest.full.json  — every report, fetched lazily by the site when the user searches
// Both are written atomically (write .tmp then rename) so a crash never leaves a half file.
//
// It reads each reports/<date>/report.json (new multi-exchange format) or parses the old
// summary_<date>.md (retired divergence format), so the site keeps working across both.
//
//   node scripts/build-manifest.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const REPORTS = path.join(ROOT, "reports");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEAD_COUNT = 30; // entries in the small manifest

function writeAtomic(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, file);
}

function num(s) {
  const n = Number(String(s).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseReport(date, md) {
  const r = { date, scanned: null, movedBig: null, dangerCount: null, widest: null, macro: null, marketSummary: null, newsCount: 0, flagged: [] };
  if (!md) return r;
  const lines = md.split(/\r?\n/);
  const head = md.match(/Coins scanned:\s*([\d,]+).*?moved\s*>?\s*\d+%?:\s*(\d+).*?dangerous price gap:\s*(\d+)/i);
  if (head) { r.scanned = num(head[1]); r.movedBig = num(head[2]); r.dangerCount = num(head[3]); }
  const widest = md.match(/Widest gap:\s*(\S+)\s+([\d.]+%)\s+at\s+([\d:]+)\s*UTC/i);
  if (widest) r.widest = { symbol: widest[1], pct: widest[2], time: widest[3] };
  const macro = {};
  for (const m of md.matchAll(/^-\s*(BTC|ETH|SOL):.*?\(([-+]?[\d.]+)%/gim)) macro[m[1]] = num(m[2]);
  if (Object.keys(macro).length) r.macro = macro;
  const mbIdx = lines.findIndex((l) => /^##\s*Market backdrop/i.test(l));
  if (mbIdx >= 0) { for (let i = mbIdx + 1; i < lines.length; i++) { const l = lines[i].trim(); if (l.startsWith("##")) break; if (l && !l.startsWith("-")) { r.marketSummary = l; break; } } }
  const newsIdx = lines.findIndex((l) => /^##\s*What moved the market/i.test(l));
  if (newsIdx >= 0) { for (let i = newsIdx + 1; i < lines.length; i++) { const l = lines[i]; if (/^##\s/.test(l)) break; if (/^-\s*\[/.test(l)) r.newsCount++; if (/No external news researched/i.test(l)) r.newsCount = 0; } }
  const flIdx = lines.findIndex((l) => /^##\s*Flagged coins/i.test(l));
  if (flIdx >= 0) { for (let i = flIdx + 1; i < lines.length; i++) { const l = lines[i]; if (/^##\s/.test(l)) break; const m = l.match(/^-\s*(\S+)\s*\[([^\]]+)\]:\s*(.+)$/); if (m) r.flagged.push({ symbol: m[1], label: m[2], headline: m[3].trim() }); } }
  return r;
}

function main() {
  if (!fs.existsSync(REPORTS)) { console.error("No reports/ directory found."); process.exit(1); }
  const dates = fs.readdirSync(REPORTS, { withFileTypes: true }).filter((d) => d.isDirectory() && DATE_RE.test(d.name)).map((d) => d.name).sort().reverse();

  const reports = [];
  for (const date of dates) {
    const dir = path.join(REPORTS, date);
    const mdPath = path.join(dir, `summary_${date}.md`);
    const htmlPath = path.join(dir, `summary_${date}.html`);
    const pdfPath = path.join(dir, `summary_${date}.pdf`);
    let md = null;
    try { md = fs.readFileSync(mdPath, "utf8"); } catch { /* no md */ }

    let entry;
    const jsonPath = path.join(dir, "report.json");
    if (fs.existsSync(jsonPath)) {
      let m = {};
      try { m = JSON.parse(fs.readFileSync(jsonPath, "utf8")); } catch { /* malformed */ }
      entry = {
        date, kind: "market",
        scanned: null, movedBig: null, dangerCount: null, widest: null,
        macro: m.macro && (m.macro.BTC != null || m.macro.ETH != null) ? m.macro : null,
        marketSummary: m.oneLine || null,
        oneLine: m.oneLine || null,
        newsCount: m.newsCount || 0,
        topMover: m.topMover || null,
        venues: Array.isArray(m.venues) ? m.venues : [],
        languages: Array.isArray(m.languages) && m.languages.length ? m.languages : ["en"],
        status: m.status || "ok",
        degradedReasons: Array.isArray(m.degradedReasons) ? m.degradedReasons : [],
        flagged: [],
      };
    } else {
      entry = parseReport(date, md);
      entry.kind = "divergence";
    }
    entry.files = {
      html: fs.existsSync(htmlPath) ? `reports/${date}/summary_${date}.html` : null,
      pdf: fs.existsSync(pdfPath) ? `reports/${date}/summary_${date}.pdf` : null,
      md: fs.existsSync(mdPath) ? `reports/${date}/summary_${date}.md` : null,
    };
    reports.push(entry);
  }

  const now = new Date().toISOString();
  const counts = {
    total: reports.length,
    market: reports.filter((r) => r.kind === "market").length,
    divergence: reports.filter((r) => r.kind === "divergence").length,
    degraded: reports.filter((r) => r.status === "degraded").length,
  };
  const full = { title: "Futures Daily Report", generatedAt: now, count: reports.length, counts, latest: reports[0]?.date ?? null, reports };
  const head = { title: "Futures Daily Report", generatedAt: now, count: reports.length, counts, latest: reports[0]?.date ?? null, head: HEAD_COUNT, reports: reports.slice(0, HEAD_COUNT) };

  writeAtomic(path.join(ROOT, "manifest.full.json"), JSON.stringify(full, null, 2));
  writeAtomic(path.join(ROOT, "manifest.json"), JSON.stringify(head, null, 2));
  console.log(`manifest written: ${reports.length} reports (head ${head.reports.length}, latest ${full.latest}, degraded ${counts.degraded}).`);
}

main();
