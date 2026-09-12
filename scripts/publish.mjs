// Publish new reports to the GitHub Pages site.
//   node scripts/publish.mjs
//
// Steps: rebuild manifest.json, then commit reports/ + manifest.json and push.
// GitHub Pages redeploys itself on push, so the site updates within a minute.
//
// This is invoked automatically at the end of a report run when config.autoPublish
// is true (see src/index.js), and can also be run by hand any time. It is safe to
// run repeatedly: if nothing changed, it does nothing. All failures are non-fatal
// to the caller — a network hiccup must never break report generation.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

export async function publish({ quiet = false } = {}) {
  const log = quiet ? () => {} : (m) => console.log(m);

  // 1) rebuild the manifest (importing runs its main())
  await import("./build-manifest.mjs?ts=" + Date.now());

  // 2) must be a git repo with an 'origin' remote
  try { git(["rev-parse", "--is-inside-work-tree"]); }
  catch { log("publish: not a git repository — skipping."); return { pushed: false, reason: "no-git" }; }
  let hasOrigin = true;
  try { git(["remote", "get-url", "origin"]); } catch { hasOrigin = false; }
  if (!hasOrigin) { log("publish: no 'origin' remote — skipping push."); return { pushed: false, reason: "no-origin" }; }

  // 3) stage reports + manifest only (never sweeps unrelated local edits)
  git(["add", "reports", "manifest.json"]);

  // anything staged?
  try { git(["diff", "--cached", "--quiet"]); log("publish: nothing new to publish."); return { pushed: false, reason: "no-changes" }; }
  catch { /* non-zero exit means there ARE staged changes — continue */ }

  // 4) commit + push
  const stamp = new Date().toISOString().slice(0, 10);
  git(["commit", "-m", `reports: publish ${stamp} (auto)`]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]) || "main";
  git(["push", "origin", branch]);
  log(`publish: pushed to origin/${branch}. Pages will redeploy shortly.`);
  return { pushed: true, branch };
}

// Run directly?
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publish().catch((err) => { console.error("publish failed:", String(err).slice(0, 300)); process.exit(1); });
}
