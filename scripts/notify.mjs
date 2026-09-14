// Alerting for degraded / failed runs. Zero-config: it ALWAYS appends a one-line summary
// to logs/ALERTS.log, and additionally POSTs a small generic JSON body to ALERT_WEBHOOK_URL
// if that is set in .env. No provider is assumed and no secret is ever put in the payload.
//
//   import { notify } from "./notify.mjs"; await notify("degraded", "2026-09-13: ...");

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../pipeline/env.js";
import { redact } from "../pipeline/redact.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

export async function notify(kind, summary) {
  const at = new Date().toISOString();
  const line = `${at} [${String(kind).toUpperCase()}] ${redact(String(summary || "")).slice(0, 500)}`;
  try {
    fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
    fs.appendFileSync(path.join(ROOT, "logs", "ALERTS.log"), line + "\n", "utf8");
  } catch { /* best effort */ }

  const hook = process.env.ALERT_WEBHOOK_URL;
  if (hook) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "futures-daily-report", kind, at, summary: redact(String(summary || "")).slice(0, 500) }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
    } catch (e) { console.warn(`notify webhook failed: ${redact(String(e)).slice(0, 120)}`); }
  }
  return line;
}

// CLI: node scripts/notify.mjs degraded "some message"
if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  await notify(process.argv[2] || "test", process.argv.slice(3).join(" ") || "manual notify test");
  console.log("notify: written to logs/ALERTS.log" + (process.env.ALERT_WEBHOOK_URL ? " and webhook" : ""));
}
