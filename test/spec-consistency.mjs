// Drift guard (item 37): fails when REPORT_SPEC.md, the synthesis prompt, and the renderer
// disagree on the fixed news-group headings or the section list. Run: npm test.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GROUP_KEYS, SECTION_KEYS } from "../pipeline/render.js";
import { buildSynthesisPrompt } from "../pipeline/synthesize.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const spec = fs.readFileSync(path.join(ROOT, "pipeline", "REPORT_SPEC.md"), "utf8");

// A minimal pack sufficient to build the prompt.
const pack = {
  dateUTC: "2026-09-13", coversUTC: "2026-09-13 00:00–23:59 UTC", windowLabel: "x", asOfUTC: "00:00 UTC",
  generatedAtUTC: "y", rolling: false,
  exchanges: { majors: { BTC: {}, ETH: {} }, movers: [], venuesOnline: [] },
  calendar: { reportDay: [], next24h: [], week: [] },
  tradfi: { ok: false, items: [] }, stocks: { ok: false }, news: { items: [] }, sources: {},
};
const prompt = buildSynthesisPrompt(pack, {});

const failures = [];
for (const key of GROUP_KEYS) {
  if (!prompt.includes(key)) failures.push(`synthesis prompt is missing group heading: "${key}"`);
  if (!spec.includes(key)) failures.push(`REPORT_SPEC.md is missing group heading: "${key}"`);
}
if (SECTION_KEYS.length !== 7) failures.push(`expected 7 section keys, got ${SECTION_KEYS.length}`);
// REPORT_SPEC Step 4 must enumerate sections (1)..(7)
for (let i = 1; i <= 7; i++) {
  if (!spec.includes(`(${i})`)) failures.push(`REPORT_SPEC.md Step 4 is missing section (${i})`);
}

if (failures.length) {
  console.error("SPEC CONSISTENCY FAILED:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`spec-consistency OK: ${GROUP_KEYS.length} group headings and ${SECTION_KEYS.length} sections agree across REPORT_SPEC.md, the prompt and the renderer.`);
