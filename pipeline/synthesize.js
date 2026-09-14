// Turns the verified data pack into the WRITTEN report (Step 4 of REPORT_SPEC).
//
// The data pack already holds every number (exchange figures, calendar, trad-fi). This
// step asks Claude to do only what a model should: write plain-English prose, do the
// editorial news work (drop price recaps, keep causes, dedupe, group, separate confirmed
// from unconfirmed), web-enrich the softer tiers (ETF flows via Farside/SoSoValue with a
// date check, exchange announcements), and build the glossary from the terms actually
// used. It returns structured JSON the renderer lays out beside the data tables.
//
// Backends mirror narrate.js: "cli" = headless `claude -p` (with WebSearch/WebFetch) on
// the user's login; "api" = Anthropic web_search tool; "template" = a deterministic,
// data-only fallback that writes no news but never fabricates. A per-day override at
// reports/<date>/synthesis.json always wins (hand-editable / re-runnable).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUTPUT_SCHEMA = `Return ONLY this JSON object, no markdown, no code fences:
{
  "oneLine": string,                         // Step 1: the day in one sentence a person can repeat out loud
  "priceVolumeSummary": string,              // 1-2 plain sentences: did the venues agree on price, who led volume
  "positioningSummary": string,              // plain sentences: what funding / open interest / long-short did, and what it means
  "stocksSummary": string,                   // plain sentences on the stock/commodity perps — lead with the Asian names (Korea/HK/China: KOSPI, Hang Seng, CSI) and any market news you found, then a line on US equities and commodities (gold/oil/copper) if notable. "" if nothing notable.
  "movers": [ { "symbol": string, "explanation": string, "hasCause": boolean } ],
  "news": {
    "topThree": [ { "headline": string, "what": string, "coins": string, "timeUTC": string, "source": string, "url": string } ],
    "groups": {
      "Regulation and policy": [ ITEM ],
      "Institutional flows and ETFs": [ ITEM ],
      "Exchange and platform changes": [ ITEM ],
      "Hacks, exploits and outages": [ ITEM ],
      "Traditional markets": [ ITEM ],
      "Unconfirmed and watch items": [ ITEM ]
    }
  },
  "etfFlows": { "date": string, "summary": string, "source": string, "url": string } | null,
  "calendarNotes": [ { "event": string, "typicalReaction": string } ],
  "glossary": [ { "term": string, "definition": string } ]
}
Where ITEM = { "headline": string, "what": string (2-3 plain sentences), "coins": string, "timeUTC": string, "source": string, "url": string }.
Include a group key ONLY if it has items; use [] otherwise.`;

export function buildSynthesisPrompt(pack) {
  return `You are writing today's crypto-futures market report for customer-support agents who do NOT read finance news and do NOT know finance vocabulary. Write ordinary, everyday English. Put every definition in the glossary, never in the body.

This report covers ONE full UTC calendar day (00:00–23:59 UTC) and is generated at 00:00 UTC. Use UTC for every time you write — never a local timezone.

You are given a DATA PACK with verified numbers already collected (exchange figures across venues, the macro calendar in UTC, and traditional-market moves). You are also given NEWS CANDIDATES (raw RSS headlines from the last ~30h).

YOUR JOB:
- Write the plain-English prose: the one-line summary, the price/volume read, the positioning read, and a short explanation for each biggest mover (say "no clear public cause" when the news doesn't explain it).
- Do the EDITORIAL news work on the candidates: drop pure price recaps ("bitcoin rises as traders weigh..."), keep only causes (regulation, ETF/flows, exchange changes, hacks/outages, macro policy, listings, rulings, upgrades); dedupe; group under the fixed headings; pick "the three that mattered most". Separate confirmed from unconfirmed (rumours/whale/on-chain go under "Unconfirmed and watch items", clearly).
- USE WEB SEARCH to (a) verify/expand the important news items and add their real source URLs, (b) fetch US spot BTC & ETH ETF net flow for the latest available day (Farside/SoSoValue) and VERIFY the date is yesterday/today — omit if stale, (c) check the major exchanges' announcement pages for listings/delistings/leverage/funding-cap/collateral/halt notices, (d) check the ASIAN stock markets the desk trades on Binance — Korea (KOSPI, Samsung, SK Hynix), Hong Kong (Hang Seng, Tencent, BYD, Xiaomi) and China (CSI/Shanghai) — for anything that explains the moves in the stock table, and write that into "stocksSummary" (plain English, sourced where you can).
- Build the glossary from EVERY finance term you actually use, alphabetical, plain-language, rebuilt fresh.

STRICT RULES:
- NEVER invent a number, a headline, an outlet, a URL, or a finding. If web search can't verify something, leave it out. For any data figure, use ONLY what's in the DATA PACK.
- No trading advice, predictions, or price targets. No support-operations content.
- Every news item needs a real source name + URL and a UTC time.
- If there is genuinely little news, return fewer items — do not pad.

DATA PACK:
${JSON.stringify({
  date: pack.dateUTC, coversUTC: pack.coversUTC,
  exchanges: pack.exchanges, calendar: pack.calendar, tradfi: pack.tradfi,
  binanceStocks: pack.stocks && pack.stocks.ok ? {
    Korea: (pack.stocks.markets.KR_EQUITY || []).slice(0, 8).map((r) => ({ name: r.name, chgPct: r.chgPct, volUSD: r.volUSD })),
    HongKong: (pack.stocks.markets.HK_EQUITY || []).slice(0, 8).map((r) => ({ name: r.name, chgPct: r.chgPct, volUSD: r.volUSD })),
    China: (pack.stocks.markets.CN_EQUITY || []).map((r) => ({ name: r.name, chgPct: r.chgPct, volUSD: r.volUSD })),
    usMovers: (pack.stocks.usMovers || []).map((r) => ({ name: r.name, chgPct: r.chgPct })),
    commodities: (pack.stocks.commodities || []).map((r) => ({ name: r.name, chgPct: r.chgPct })),
    asiaTopMovers: (pack.stocks.topMovers || []).map((r) => ({ name: r.name, chgPct: r.chgPct })),
  } : null,
  sources: pack.sources,
}, null, 1)}

NEWS CANDIDATES (raw, unfiltered):
${JSON.stringify((pack.news.items || []).map((n) => ({ source: n.source, tier: n.tier, title: n.title, url: n.link, ms: n.ms, summary: (n.summary || "").slice(0, 200) })), null, 0)}

${OUTPUT_SCHEMA}`;
}

// ---- balanced-JSON extraction (reused from the narrator) ----
function firstBalancedObject(s) {
  const start = s.indexOf("{");
  if (start < 0) throw new Error("no JSON object");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { if (--depth === 0) return s.slice(start, i + 1); }
  }
  throw new Error("unbalanced JSON");
}

// Resolve the Claude Code CLI. Bare `claude` isn't always on a scheduled task's PATH,
// so prefer a full path: CLAUDE_CLI_PATH override, then the common install locations.
function claudeBin() {
  const cands = [
    process.env.CLAUDE_CLI_PATH,
    path.join(os.homedir(), ".local", "bin", "claude.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "claude", "claude.exe"),
    path.join(process.env.APPDATA || "", "npm", "claude.cmd"),
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return `"${c}"`; } catch { /* ignore */ } }
  return "claude"; // last resort: hope it's on PATH
}

function runClaudeCli(promptFile, model, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const modelArg = model ? ` --model ${model}` : "";
    const cmd = `${claudeBin()} -p --output-format json --allowedTools WebSearch,WebFetch${modelArg} < "${promptFile}"`;
    const child = spawn(cmd, { shell: true, windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("claude -p synthesis timed out")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); out ? resolve(out) : reject(new Error(`claude -p exited ${code}: ${err.slice(0, 200)}`)); });
  });
}

async function apiSynthesis(prompt, model) {
  const mod = await import("@anthropic-ai/sdk");
  const client = new mod.default();
  const resp = await client.messages.create({
    model, max_tokens: 8192,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 10 }],
    messages: [{ role: "user", content: prompt }],
  });
  return resp.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}

function dataOnly(pack) {
  // deterministic fallback: no news synthesis, but everything truthful
  const p = pack.exchanges?.majors?.BTC || {};
  const lead = pack.exchanges?.venuesOnline?.[0];
  return {
    oneLine: `Market data collected across ${(pack.exchanges?.venuesOnline || []).length} venues; news synthesis was unavailable for this run.`,
    priceVolumeSummary: "See the exchange table below. (Automated narrative unavailable this run — figures are shown directly.)",
    positioningSummary: "See the positioning table below.",
    movers: (pack.exchanges?.movers || []).map((m) => ({ symbol: m.symbol, explanation: "No narrative available this run.", hasCause: false })),
    news: { topThree: [], groups: {} },
    etfFlows: null,
    calendarNotes: [],
    glossary: [],
    _source: "data-only",
  };
}

export async function synthesize(pack, config, dayDir) {
  // (a) per-day override wins
  try {
    const ov = path.join(dayDir, "synthesis.json");
    if (fs.existsSync(ov)) {
      const parsed = JSON.parse(fs.readFileSync(ov, "utf8"));
      if (parsed && parsed.oneLine) return { ...parsed, _source: "override" };
    }
  } catch { /* fall through */ }

  // Backend order to try. "auto" (default) prefers the API when a key is present
  // (no OAuth expiry → the nightly job can't silently break), then falls back to the
  // CLI, then to a truthful data-only report. Explicit narrator values pin one backend.
  const order = backendOrder(config);
  if (!order.length) return dataOnly(pack);

  const prompt = buildSynthesisPrompt(pack);
  let lastErr;
  for (const backend of order) {
    try {
      const obj = await runBackend(backend, prompt, config);
      if (!obj.oneLine) throw new Error("synthesis missing oneLine");
      try { fs.writeFileSync(path.join(dayDir, "synthesis.json"), JSON.stringify(obj, null, 2), "utf8"); } catch {}
      return { ...obj, _source: backend };
    } catch (err) {
      lastErr = String(err).slice(0, 300);
      console.warn(`  ${backend} synthesis failed (${lastErr.slice(0, 160)})`);
    }
  }
  console.warn("  all synthesis backends failed — data-only fallback");
  return { ...dataOnly(pack), _error: lastErr, _backend: order.join("+") };
}

function backendOrder(config) {
  const want = config.narrator || "auto";
  if (want === "template") return [];
  if (want === "cli") return ["cli"];
  if (want === "api") return ["api"];
  // auto
  return process.env.ANTHROPIC_API_KEY ? ["api", "cli"] : ["cli"];
}

async function runBackend(backend, prompt, config) {
  let raw;
  if (backend === "cli") {
    const tmp = path.join(os.tmpdir(), `fdr-synth-${Date.now()}.txt`);
    fs.writeFileSync(tmp, prompt, "utf8");
    try {
      const stdout = await runClaudeCli(tmp, config.model);
      const env = JSON.parse(firstBalancedObject(stdout));
      if (env.is_error || typeof env.result !== "string") {
        throw new Error("claude -p error" + (env.api_error_status ? ` [${env.api_error_status}]` : "") + ": " + (typeof env.result === "string" ? env.result.slice(0, 200) : JSON.stringify(env.subtype || "no result")));
      }
      raw = env.result;
    } finally { fs.rmSync(tmp, { force: true }); }
  } else {
    raw = await apiSynthesis(prompt, config.model);
  }
  return JSON.parse(firstBalancedObject(raw));
}
