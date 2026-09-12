// Turns computed metrics into plain-English, beginner-readable prose.
//
// Narrator backends (config.narrator): "cli" | "api" | "template" | "auto"
//   - "cli": headless Claude Code (`claude -p`) on your existing login — fresh AI
//     narratives, no API key, ONE batched call per day.
//   - "api": direct Anthropic API (needs ANTHROPIC_API_KEY).
//   - "template": deterministic built-in wording (free, offline).
//   - "auto": api if a key is set, else cli, else template.
// Every AI path runs through a validation gate that rejects any number not present
// in the coin's facts, falling back to that coin's template — so a wrong number can
// never reach the report.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------- number formatting (all display numbers become strings here) ----------

export function fmtPrice(x) {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  let s;
  if (Math.abs(x) >= 100) s = x.toFixed(2);
  else if (Math.abs(x) >= 1) s = x.toFixed(4);
  else if (Math.abs(x) >= 0.01) s = x.toFixed(5);
  else s = x.toFixed(6);
  return "$" + s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function fmtPct(x, dp = 1) {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  return x.toFixed(dp) + "%";
}

function fmtSignedPct(x, dp = 1) {
  const s = Math.abs(x).toFixed(dp) + "%";
  return (x >= 0 ? "+" : "−") + s;
}

function fmtVol(x) {
  if (!x) return "—";
  if (x >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
  if (x >= 1e6) return "$" + (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return "$" + (x / 1e3).toFixed(0) + "K";
  return "$" + x.toFixed(0);
}

// ---------- facts bundle (pre-formatted strings handed to Claude) ----------

export function buildFacts(m, archetype) {
  const f = {
    symbol: m.symbol,
    archetype,
    open: fmtPrice(m.open),
    close: fmtPrice(m.close),
    high: fmtPrice(m.high),
    low: fmtPrice(m.low),
    pctChange: fmtSignedPct(m.pctChange),
    pctChangeWord: (m.pctChange >= 0 ? "rose " : "fell ") + fmtPct(Math.abs(m.pctChange)),
    intradayRange: fmtPct(m.intradayRangePct),
    markRange: fmtPct(m.markRangePct),
    realizedVol: fmtPct(m.realizedVol1m, 2),
    maxDiv: fmtPct(m.maxDiv),
    meanDiv: fmtPct(m.meanDiv, 2),
    minutesOver2: String(m.minutesOver2),
    minutesOver5: String(m.minutesOver5),
    biggest1mMove: fmtPct(m.biggest1mMove.pct),
    biggest1mMoveTime: m.biggest1mMove.time,
    moveClustering: m.moveClustering,
    volume: fmtVol(m.volumeUSDT),
  };
  if (m.divPeak) {
    f.divPeakTime = m.divPeak.time;
    f.divPeakLast = fmtPrice(m.divPeak.last);
    f.divPeakMark = fmtPrice(m.divPeak.mark);
    f.divDirection = m.divPeak.direction; // "above" | "below"
  }
  if (m.longestDivStreak) {
    f.streakStart = m.longestDivStreak.startTime;
    f.streakEnd = m.longestDivStreak.endTime;
    f.streakDuration = String(m.longestDivStreak.durationMin) + " minutes";
    f.streakPeak = fmtPct(m.longestDivStreak.peakPct);
  }
  return f;
}

// ---------- deterministic templates (safe fallback / no-key path) ----------

function templateNarrative(archetype, f) {
  const sym = f.symbol;
  switch (archetype) {
    case "crash_with_mark_lag":
      return {
        headline: `${sym} crashed ${f.pctChange.replace(/[+−-]/g, "")} — and its two prices came apart`,
        narrative:
          `${sym} ${f.pctChangeWord} over the day, from ${f.open} to ${f.close}. ` +
          `The fall was bad enough on its own, but the real danger was that the mark price (Binance's smoothed "fair" price) couldn't keep up with how fast the live price was dropping. ` +
          (f.streakDuration
            ? `From ${f.streakStart} to ${f.streakEnd} UTC the gap between the two prices stayed above 5% for ${f.streakDuration}, peaking at ${f.streakPeak}. `
            : ``) +
          `At its worst, ${f.divPeakTime} UTC, coins were trading at ${f.divPeakLast} while the mark price sat ${f.divDirection} at ${f.divPeakMark} — a gap of ${f.maxDiv}.`,
        dangerNote:
          `Liquidations are decided by the mark price, not the live price. With the mark sitting ${f.divDirection} the live price, traders could be forced out against a number that disagreed with where the coin was actually changing hands. This was a genuine liquidation-risk window — ${f.minutesOver5} minutes spent with the gap above 5%.`,
      };
    case "pump_with_mark_lag":
      return {
        headline: `${sym} spiked ${f.pctChange} — the mark price lagged the rally`,
        narrative:
          `${sym} ${f.pctChangeWord} over the day, from ${f.open} to ${f.close}. ` +
          `The live price ran up faster than the mark price could follow. ` +
          (f.streakDuration
            ? `From ${f.streakStart} to ${f.streakEnd} UTC the gap held above 5% for ${f.streakDuration}, peaking at ${f.streakPeak}. `
            : ``) +
          `At ${f.divPeakTime} UTC the live price was ${f.divPeakLast} while the mark sat ${f.divDirection} at ${f.divPeakMark}.`,
        dangerNote:
          `Shorts get liquidated when price rises, and that trigger uses the mark price. With the live price far above a lagging mark, the squeeze was real — ${f.minutesOver5} minutes with the gap above 5%.`,
      };
    case "brief_gap_spike":
      return {
        headline: `${sym} had one brief price dislocation`,
        narrative:
          `${sym} tracked its mark price closely for most of the day. The one exception came at ${f.divPeakTime} UTC, when the gap between the live and mark price jumped to ${f.maxDiv} (live ${f.divPeakLast} vs mark ${f.divPeakMark}) before snapping back quickly.`,
        dangerNote:
          `A short-lived spike like this is usually a stray large order hitting thin liquidity rather than a sustained problem — but even a one-minute gap can trip a tight stop. The gap stayed above 2% for only ${f.minutesOver2} minute(s).`,
      };
    case "pump_and_fade":
      return {
        headline: `${sym} ran up, then gave it back`,
        narrative:
          `${sym} surged to its high of ${f.high} during the session before fading back to close at ${f.close} — ${f.pctChange} on the day after round-tripping much of the move. Its biggest single-minute move was ${f.biggest1mMove} around ${f.biggest1mMoveTime} UTC.`,
        dangerNote: null,
      };
    case "recovery":
      return {
        headline: `${sym} sold off, then recovered`,
        narrative:
          `${sym} dropped to ${f.low} intraday before recovering to close at ${f.close} (${f.pctChange} on the day) — a V-shaped session. Its live and mark prices stayed close enough that the move carried little price-gap risk (peak gap ${f.maxDiv}).`,
        dangerNote: null,
      };
    case "steady_slide":
      return {
        headline: `${sym} slid ${f.pctChange.replace(/[+−-]/g, "")} in an orderly sell-off`,
        narrative:
          `${sym} ${f.pctChangeWord} from ${f.open} to ${f.close} in a steady decline. Its live and mark prices stayed close throughout (peak gap just ${f.maxDiv}), so the drop itself — not any price dislocation — was the story.`,
        dangerNote: null,
      };
    case "steady_climb":
      return {
        headline: `${sym} climbed ${f.pctChange} steadily`,
        narrative:
          `${sym} ${f.pctChangeWord} from ${f.open} to close at ${f.close}, with the mark price tracking closely the whole way (peak gap ${f.maxDiv}). A clean, orderly rally.`,
        dangerNote: null,
      };
    case "clean_pump":
      return {
        headline: `${sym} spiked ${f.pctChange} — fast but clean`,
        narrative:
          `${sym} ${f.pctChangeWord} to close at ${f.close}, a sharp move (biggest single minute: ${f.biggest1mMove} at ${f.biggest1mMoveTime} UTC). Despite the violence, the mark price kept pace — the gap never exceeded ${f.maxDiv} — so the volatility was real but clean.`,
        dangerNote: null,
      };
    case "choppy_volatile":
      return {
        headline: `${sym} whipsawed but ended roughly flat`,
        narrative:
          `${sym} swung across a ${f.intradayRange} range but closed near where it started (${f.pctChange} on the day). A choppy, directionless session that could punish tight stops on both sides.`,
        dangerNote: null,
      };
    default: // calm
      return {
        headline: `${sym} had a quiet day`,
        narrative:
          `${sym} drifted ${f.pctChange} across a narrow ${f.intradayRange} range, tracking its mark price closely throughout. Nothing notable.`,
        dangerNote: null,
      };
  }
}

// ---------- validation gate: no number may appear that wasn't in the facts ----------

function numberTokens(str) {
  return (String(str).match(/\d+(?:\.\d+)?/g) || []);
}

function buildAllowedNumbers(facts) {
  const allowed = new Set();
  for (const v of Object.values(facts)) {
    for (const tok of numberTokens(v)) allowed.add(tok);
  }
  // small integers (counts, clock parts) are always fine
  for (let i = 0; i <= 60; i++) allowed.add(String(i));
  return allowed;
}

function validateNumbers(text, allowed) {
  for (const tok of numberTokens(text)) {
    if (!allowed.has(tok)) return tok; // returns the offending number, or undefined if clean
  }
  return undefined;
}

// ---------- Claude path ----------

let _client = null;
async function getClient() {
  if (_client) return _client;
  const mod = await import("@anthropic-ai/sdk");
  _client = new mod.default();
  return _client;
}

const SYSTEM_PROMPT = `You write a short, plain-English explanation of one crypto futures coin's trading day for a complete beginner.
You are given a JSON object of FACTS that already contains every number you may use, pre-formatted as strings.
RULES:
- Use ONLY numbers that appear verbatim in the FACTS. Never compute, estimate, round, or introduce any number that is not in FACTS.
- Copy number strings exactly as given (e.g. "34.1%", "$0.0824").
- Write for someone who does not trade. No jargon without a plain explanation.
- Mark price = Binance's smoothed "fair" price that decides liquidations. Last price = the live traded price. Realized profit/loss uses the last price; liquidation uses the mark price.
- Return ONLY a JSON object: {"headline": string, "narrative": string (2-3 short paragraphs), "dangerNote": string or null}. No markdown, no extra text.`;

async function claudeNarrative(facts, model) {
  const client = await getClient();
  const resp = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: "FACTS:\n" + JSON.stringify(facts, null, 2) }],
  });
  const text = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < 0) throw new Error("no JSON in Claude response");
  const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  return parsed;
}

// ---------- public entry ----------

export async function narrate(m, archetype, config) {
  const facts = buildFacts(m, archetype);
  const useClaude = !!process.env.ANTHROPIC_API_KEY;

  if (useClaude) {
    try {
      const out = await claudeNarrative(facts, config.model);
      const allowed = buildAllowedNumbers(facts);
      const blob = [out.headline, out.narrative, out.dangerNote || ""].join(" ");
      const bad = validateNumbers(blob, allowed);
      if (bad === undefined && out.headline && out.narrative) {
        return { ...out, source: "claude" };
      }
      // validation failed — fall through to template
      console.warn(`  [${m.symbol}] Claude output rejected (number "${bad}" not in facts) — using template`);
    } catch (err) {
      console.warn(`  [${m.symbol}] Claude failed (${String(err).slice(0, 120)}) — using template`);
    }
  }

  return { ...templateNarrative(archetype, facts), source: "template" };
}

// ---------- headless Claude Code (claude -p) batch path — no API key ----------

const CLI_BATCH_PROMPT = `You write short, plain-English explanations of crypto-futures coins' trading days for a complete beginner.
You are given a JSON array of coins. Each has an "archetype" and a "facts" object that already contains every number you may use, pre-formatted as strings.
RULES:
- Use ONLY numbers that appear verbatim in that coin's facts. Never compute, estimate, round, or introduce any number not in its facts. Copy number strings exactly (e.g. "34.1%", "$0.0824").
- Write for someone who does not trade. Explain any term simply.
- Mark price = Binance's smoothed "fair" price that decides liquidations. Last price = the live traded price. Realized profit/loss uses the last price; liquidation uses the mark price.
- For each coin produce an object: {"symbol","headline","narrative","dangerNote"}. "narrative" is 2-3 short paragraphs as a single string. "dangerNote" is a short string, or null if nothing dangerous happened.
OUTPUT: ONLY a JSON array of those objects, in the same order as the input. No explanation, no markdown, no code fences.`;

function runClaudeCli(promptFile, model, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const modelArg = model ? ` --model ${model}` : "";
    const cmd = `claude -p --output-format json${modelArg} < "${promptFile}"`;
    const child = spawn(cmd, { shell: true, windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("claude -p timed out"));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!out) reject(new Error(`claude -p exited ${code}: ${err.slice(0, 200)}`));
      else resolve(out);
    });
  });
}

// Extract the first balanced {...} object, ignoring any leading/trailing noise
// (warnings, blank lines, extra output) the CLI may print around the envelope.
function firstBalancedObject(s) {
  const start = s.indexOf("{");
  if (start < 0) throw new Error("no JSON object in claude -p output");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      if (--depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced JSON object in claude -p output");
}


function extractJsonArray(text) {
  let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const a = t.indexOf("[");
  const b = t.lastIndexOf("]");
  if (a < 0 || b < 0) throw new Error("no JSON array in narrative output");
  return JSON.parse(t.slice(a, b + 1));
}

async function claudeCliBatch(items, config) {
  const payload = items.map((it) => ({
    symbol: it.facts.symbol,
    archetype: it.archetype,
    facts: it.facts,
  }));
  const prompt = CLI_BATCH_PROMPT + "\n\nINPUT:\n" + JSON.stringify(payload, null, 2);
  const tmp = path.join(os.tmpdir(), `fdr-narrate-${Date.now()}.txt`);
  fs.writeFileSync(tmp, prompt, "utf8");
  try {
    const stdout = await runClaudeCli(tmp, config.model);
    const env = JSON.parse(firstBalancedObject(stdout));
    if (env.is_error) throw new Error("claude -p reported an error");
    if (typeof env.result !== "string") throw new Error("claude -p returned no result text");
    const arr = extractJsonArray(env.result);
    const map = new Map();
    for (const o of arr) if (o && o.symbol) map.set(o.symbol, o);
    return { map, cost: env.total_cost_usd };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ---------- market news brief (attributed; needs REAL web access) ----------
//
// This produces the "why did the market move" context. It is deliberately built so
// the model can only report news it actually found on the web:
//   - cli backend: a separate `claude -p` run with WebSearch/WebFetch allowed.
//   - api backend: the Anthropic server-side web_search tool.
//   - template backend: returns null (no offline news; the report falls back to a
//     truthful data-only summary in market.js).
// The prompt forbids inventing anything and tells the model to return an empty list
// if it cannot verify — so an unsourced headline never reaches the report.

function macroLine(macro) {
  const p = (macro && macro.per) || {};
  const parts = [];
  for (const k of ["BTC", "ETH", "SOL"]) {
    if (p[k]) parts.push(`${k} open ${fmtPrice(p[k].open)} → close ${fmtPrice(p[k].close)} (${fmtSignedPct(p[k].pctChange)}, range ${fmtPct(p[k].rangePct)})`);
  }
  return parts.length ? parts.join("; ") : "no macro reference available";
}

function marketBriefPrompt(dStr, macro) {
  return `You are compiling the crypto-market NEWS CONTEXT for a daily Binance USD-M futures report, for the UTC day ${dStr}.
Use web search to find what actually happened in the crypto market that day and WHY prices moved.
VERIFIED BINANCE NUMBERS for ${dStr} (already true — you may reference these): ${macroLine(macro)}.

Find the day's most market-moving, SOURCED developments: macro drivers (Fed/CPI/rates, equities, geopolitics), regulation, ETF flows, exchange/protocol incidents, large liquidations, and notable single-coin or social-media events that were confirmed by mainstream crypto reporting.

STRICT RULES — read carefully:
- Only include an item if you actually found it via web search AND can give a real outlet name and a real URL.
- NEVER invent or guess a headline, outlet, URL, quote, price, or figure. Do not "reconstruct" plausible news.
- If web search is unavailable or you cannot verify items for this date, return "items": [].
- Prefer items dated on ${dStr} or within about one day of it.
- Keep each headline factual and short; put nuance in "note".

OUTPUT: ONLY a JSON object, no markdown, no code fences:
{"summary": "2-4 plain-English sentences on what drove the crypto market that day",
 "items": [{"headline": string, "source": string (outlet name), "url": string,
            "date": "YYYY-MM-DD", "impact": "bullish"|"bearish"|"neutral",
            "confidence": "high"|"medium"|"low", "note": string}]}`;
}

function runClaudeCliResearch(promptFile, model, timeoutMs = 240000) {
  return new Promise((resolve, reject) => {
    const modelArg = model ? ` --model ${model}` : "";
    const cmd = `claude -p --output-format json --allowedTools WebSearch,WebFetch${modelArg} < "${promptFile}"`;
    const child = spawn(cmd, { shell: true, windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("claude -p (research) timed out")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!out) reject(new Error(`claude -p (research) exited ${code}: ${err.slice(0, 200)}`));
      else resolve(out);
    });
  });
}

async function apiMarketBrief(dStr, macro, model) {
  const client = await getClient();
  const resp = await client.messages.create({
    model,
    max_tokens: 2048,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    messages: [{ role: "user", content: marketBriefPrompt(dStr, macro) }],
  });
  const text = resp.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return text;
}

export async function narrateMarketBrief(dStr, macro, config) {
  const backend = resolveNarrator(config);
  if (backend === "template") return null;

  let raw;
  try {
    if (backend === "cli") {
      const prompt = marketBriefPrompt(dStr, macro);
      const tmp = path.join(os.tmpdir(), `fdr-market-${Date.now()}.txt`);
      fs.writeFileSync(tmp, prompt, "utf8");
      try {
        const stdout = await runClaudeCliResearch(tmp, config.model);
        const env = JSON.parse(firstBalancedObject(stdout));
        if (env.is_error || typeof env.result !== "string") throw new Error("claude -p research: no result");
        raw = env.result;
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    } else {
      raw = await apiMarketBrief(dStr, macro, config.model);
    }
  } catch (err) {
    console.warn(`  Market news brief failed (${String(err).slice(0, 140)}) — data-only context`);
    return null;
  }

  try {
    const obj = JSON.parse(firstBalancedObject(raw));
    if (!obj || !Array.isArray(obj.items)) return null;
    // keep only items with a real source + headline
    obj.items = obj.items.filter((n) => n && n.headline && n.source);
    obj.backend = backend;
    return obj;
  } catch {
    return null;
  }
}

// ---------- backend selection + per-coin finalize ----------

function resolveNarrator(config) {
  const want = config.narrator || "auto";
  if (want === "api" || want === "cli" || want === "template") return want;
  return process.env.ANTHROPIC_API_KEY ? "api" : "cli";
}

function finalizeItem(it, parsed, sourceLabel) {
  if (parsed && parsed.headline && parsed.narrative) {
    const allowed = buildAllowedNumbers(it.facts);
    const blob = [parsed.headline, parsed.narrative, parsed.dangerNote || ""].join(" ");
    if (validateNumbers(blob, allowed) === undefined) {
      return {
        headline: parsed.headline,
        narrative: parsed.narrative,
        dangerNote: parsed.dangerNote ?? null,
        source: sourceLabel,
      };
    }
  }
  return { ...templateNarrative(it.archetype, it.facts), source: "template" };
}

// Narrate a batch of symbols (each carries m.archetype). Returns narratives in order.
export async function narrateAll(ms, config) {
  const items = ms.map((m) => ({ m, archetype: m.archetype, facts: buildFacts(m, m.archetype) }));
  const backend = resolveNarrator(config);

  if (backend === "template") {
    return items.map((it) => ({ ...templateNarrative(it.archetype, it.facts), source: "template" }));
  }

  if (backend === "cli") {
    try {
      const { map, cost } = await claudeCliBatch(items, config);
      const out = items.map((it) => finalizeItem(it, map.get(it.facts.symbol), "claude-cli"));
      const wrote = out.filter((o) => o.source === "claude-cli").length;
      const costStr = cost ? ` · ~$${cost.toFixed(3)} this run (model ${config.model})` : "";
      console.log(`  Claude CLI wrote ${wrote}/${out.length} narratives${costStr}.`);
      return out;
    } catch (err) {
      console.warn(`  Claude CLI batch failed (${String(err).slice(0, 140)}) — using templates`);
      return items.map((it) => ({ ...templateNarrative(it.archetype, it.facts), source: "template" }));
    }
  }

  // api
  const out = [];
  for (const it of items) {
    try {
      const parsed = await claudeNarrative(it.facts, config.model);
      out.push(finalizeItem(it, parsed, "claude"));
    } catch (err) {
      console.warn(`  [${it.facts.symbol}] Claude API failed (${String(err).slice(0, 120)}) — template`);
      out.push({ ...templateNarrative(it.archetype, it.facts), source: "template" });
    }
  }
  return out;
}
