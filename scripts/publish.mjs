// Publish new reports to the GitHub Pages site.
//   node scripts/publish.mjs
//
// Rebuild the manifest(s), then commit reports/ + manifest files and push. GitHub Pages
// redeploys itself on push. Every git call is timeout-bounded and runs with credential
// prompts DISABLED, so a diverged remote or a missing credential fails fast instead of
// hanging the nightly run. Returns a structured result for every path so the caller
// (pipeline/index.js) can record in run.json exactly why a push did or did not happen.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Non-interactive git: never block on a credential/GPG prompt.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_ASKPASS: "echo" };

function git(args, { timeout = 60000, allowFail = false } = {}) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: GIT_ENV, timeout }).trim();
  } catch (err) {
    if (allowFail) return { __error: String(err.stderr || err.message || err).slice(0, 200) };
    throw err;
  }
}

export async function publish({ quiet = false } = {}) {
  const log = quiet ? () => {} : (m) => console.log(m);

  // 1) rebuild the manifest(s)
  await import("./build-manifest.mjs?ts=" + Date.now());

  // 2) must be a git repo with an 'origin' remote
  try { git(["rev-parse", "--is-inside-work-tree"]); }
  catch { log("publish: not a git repository — skipping."); return { pushed: false, reason: "no-git" }; }
  try { git(["remote", "get-url", "origin"]); }
  catch { log("publish: no 'origin' remote — skipping push."); return { pushed: false, reason: "no-origin" }; }

  let branch = "main";
  try { const b = git(["rev-parse", "--abbrev-ref", "HEAD"]); if (typeof b === "string" && b) branch = b; } catch { /* keep main */ }

  // 3) stage the published outputs only (never sweeps unrelated local edits)
  git(["add", "reports", "manifest.json", "manifest.full.json"]);

  // anything staged?
  try { git(["diff", "--cached", "--quiet"]); log("publish: nothing new to publish."); return { pushed: false, reason: "no-changes", branch }; }
  catch { /* non-zero means there ARE staged changes — continue */ }

  const stamp = new Date().toISOString().slice(0, 10);
  git(["commit", "-m", `reports: publish ${stamp} (auto)`]);

  // 4) sync with the remote before pushing (item 13). If diverged, rebase-autostash;
  //    if that can't be done cleanly, do NOT force — report diverged.
  const fetchRes = git(["fetch", "origin", branch], { timeout: 90000, allowFail: true });
  if (fetchRes && fetchRes.__error) { log(`publish: fetch failed — ${fetchRes.__error}`); return { pushed: false, reason: "fetch-failed", branch, detail: fetchRes.__error }; }

  let behind = 0, ahead = 0;
  const counts = git(["rev-list", "--left-right", "--count", `origin/${branch}...HEAD`], { allowFail: true });
  if (typeof counts === "string") { const [l, r] = counts.split(/\s+/).map((n) => Number(n) || 0); behind = l; ahead = r; }

  if (behind > 0) {
    const pull = git(["pull", "--rebase", "--autostash", "origin", branch], { timeout: 120000, allowFail: true });
    if (pull && pull.__error) {
      // abort any half-done rebase so the tree is left clean; never force-push.
      git(["rebase", "--abort"], { allowFail: true });
      log(`publish: remote diverged and rebase failed — not pushing. ${pull.__error}`);
      return { pushed: false, reason: "diverged", branch, detail: pull.__error };
    }
  }

  const push = git(["push", "origin", branch], { timeout: 120000, allowFail: true });
  if (push && push.__error) { log(`publish: push failed — ${push.__error}`); return { pushed: false, reason: "push-failed", branch, detail: push.__error }; }

  log(`publish: pushed to origin/${branch}. Pages will redeploy shortly.`);
  return { pushed: true, branch };
}

// Run directly?
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publish().then((r) => { if (!r.pushed && !["no-changes"].includes(r.reason)) process.exitCode = 2; }).catch((err) => { console.error("publish failed:", String(err).slice(0, 300)); process.exit(1); });
}
