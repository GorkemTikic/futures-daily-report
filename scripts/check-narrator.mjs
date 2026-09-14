// Probe whether the narrator backend can authenticate, WITHOUT waiting for a nightly
// failure. Runs a one-token `claude -p` (and, if ANTHROPIC_API_KEY is set, a tiny API
// call) and reports the result. Refresh the CLI token with `claude setup-token`.
//
//   node scripts/check-narrator.mjs
//   npm run check-narrator

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../pipeline/env.js";
import { redact } from "../pipeline/redact.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));

function claudeBin() {
  const cands = [
    process.env.CLAUDE_CLI_PATH,
    path.join(os.homedir(), ".local", "bin", "claude.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "claude", "claude.exe"),
    path.join(process.env.APPDATA || "", "npm", "claude.cmd"),
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch { /* ignore */ } }
  return "claude";
}

function probeCli() {
  return new Promise((resolve) => {
    const bin = claudeBin();
    const model = /^[A-Za-z0-9._-]+$/.test(config.model || "") ? config.model : null;
    const args = ["-p", "--output-format", "json"];
    if (model) args.push("--model", model);
    const useShell = /\.(cmd|bat)$/i.test(bin);
    const child = spawn(useShell ? `"${bin}"` : bin, args, { shell: useShell, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "", done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(t); resolve(r); };
    const t = setTimeout(() => { try { if (process.platform === "win32" && child.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill("SIGKILL"); } catch {} finish({ ok: false, reason: "timeout" }); }, 60000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => finish({ ok: false, reason: "spawn-error", detail: String(e).slice(0, 120) }));
    child.on("close", () => {
      try {
        const env = JSON.parse(out.slice(out.indexOf("{")));
        if (env.is_error) return finish({ ok: false, reason: "cli-error", status: env.api_error_status || null, detail: String(env.result || env.subtype || "").slice(0, 140) });
        return finish({ ok: true, bin });
      } catch { return finish({ ok: false, reason: "unparseable", detail: redact(String(err || out)).slice(0, 140) }); }
    });
    try { child.stdin.write("Reply with the single word: ok"); child.stdin.end(); } catch (e) { finish({ ok: false, reason: "stdin", detail: String(e).slice(0, 80) }); }
  });
}

async function probeApi() {
  if (!process.env.ANTHROPIC_API_KEY) return { skipped: true };
  try {
    const mod = await import("@anthropic-ai/sdk");
    const client = new mod.default();
    await client.messages.create({ model: config.model, max_tokens: 8, messages: [{ role: "user", content: "Reply with: ok" }] });
    return { ok: true };
  } catch (e) { return { ok: false, detail: redact(String(e.message || e)).slice(0, 140) }; }
}

const cli = await probeCli();
console.log("CLI (claude -p):", cli.ok ? `OK (${cli.bin})` : `FAILED — ${cli.reason}${cli.status ? ` [${cli.status}]` : ""}${cli.detail ? " — " + cli.detail : ""}`);
if (!cli.ok && (cli.reason === "cli-error" || cli.status === 401)) console.log("  → refresh the login token:  claude setup-token   (then paste it into .env as CLAUDE_CODE_OAUTH_TOKEN)");
const api = await probeApi();
if (api.skipped) console.log("API: skipped (no ANTHROPIC_API_KEY set)");
else console.log("API:", api.ok ? "OK" : `FAILED — ${api.detail}`);

process.exit(cli.ok || api.ok ? 0 : 1);
