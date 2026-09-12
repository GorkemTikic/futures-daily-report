// Minimal .env loader (no dependency). Reads KEY=value lines from a .env file in the
// project root into process.env, without overwriting anything already set. The .env file
// is gitignored — it holds secrets like TRADFI_API_KEY that must never be committed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;
  try {
    const txt = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env — fine, sections that need a key omit themselves */ }
}
