/**
 * Futures Daily Report — Analytics Worker (Cloudflare Worker + D1).
 *
 *   POST /track        — ingest one event. Rejected unless the Origin (or Referer) matches
 *                        ALLOWED_ORIGIN (403), rate-limited per-IP and per-device, body
 *                        size-capped. No raw request body field is trusted.
 *   GET  /admin/stats  — aggregated dashboard stats  (Bearer ADMIN_TOKEN, no-store)
 *   GET  /admin/events — recent raw events           (Bearer ADMIN_TOKEN, no-store)
 *   scheduled cron     — deletes events older than the retention window.
 *
 * What is STORED per event: event_type, session_id, device_id, a per-UTC-day salted
 * HMAC of the IP (never the raw IP, and hashes do not link across days), country (from
 * Cloudflare's header), tab, a validated props object (allow-listed keys, length-capped),
 * and a server-clamped timestamp. No user agent, screen, referrer or timezone is accepted.
 */

const ALLOWED_EVENTS = new Set([
  "page_view", "view_reports", "view_analytics",
  "report_open", "report_close", "report_nav",
  "report_search", "filter_change", "sort_change",
  "report_pdf_open", "report_raw_open", "report_copy_link",
  "report_link_click", "lang_switch", "ticker_error", "error",
]);

// props keys the client may set (everything else is dropped); each value length-capped.
const PROP_STR_KEYS = ["date", "host", "dir", "filter", "sort", "lang", "theme"];

function corsHeaders(request, env) {
  const allowed = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const effective = allowed && origin === allowed ? origin : "null";
  return {
    "Access-Control-Allow-Origin": effective,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
    "Access-Control-Max-Age": "86400",
  };
}

// Server-side origin gate for writes: curl (no Origin/Referer) is rejected (item 18).
function originAllowed(request, env) {
  const allowed = env.ALLOWED_ORIGIN || "";
  if (!allowed) return false;
  const origin = request.headers.get("Origin");
  if (origin) return origin === allowed;
  const ref = request.headers.get("Referer");
  if (ref) return ref.startsWith(allowed);
  return false;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extra } });
}

async function sha256Hex(str, n = 32) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).slice(0, n).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Per-UTC-day salted HMAC of the IP (item 20). Requires IP_HASH_SECRET; without it we
// store NO ip hash rather than a weak, brute-forceable one.
async function hashIp(ip, env) {
  const secret = env.IP_HASH_SECRET;
  if (!secret) return null;
  const dayKey = new Date().toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ip}|${dayKey}`));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-length comparison: compare SHA-256 digests, never the raw strings, so neither
// value nor its length leaks via early return (item 22).
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization");
  if (typeof env.ADMIN_TOKEN !== "string" || env.ADMIN_TOKEN.length === 0) return false;
  if (typeof auth !== "string") return false;
  return safeEqual(auth, `Bearer ${env.ADMIN_TOKEN}`);
}

// Per-isolate fallback counter used only when RATE_LIMIT_KV is not bound — fail closed-ish
// (a low cap) instead of the old fail-open behaviour (item 18).
const isoGuard = new Map();
async function withinRateLimit(env, ipHashKey, deviceKey) {
  const nowSec = Math.floor(Date.now() / 1000);
  const kv = env.RATE_LIMIT_KV;
  // per-IP: 100 / 5 min; per-device: 60 / 5 min (tighter) — defensible for a support desk.
  const checks = [["ip", ipHashKey, 100, 300], ["dev", deviceKey, 60, 300]];
  if (kv) {
    for (const [b, id, limit, win] of checks) {
      const key = `rl:${b}:${id}:${Math.floor(nowSec / win)}`;
      const cur = Number((await kv.get(key)) || "0");
      if (cur >= limit) return false;
      await kv.put(key, String(cur + 1), { expirationTtl: win + 5 });
    }
    return true;
  }
  // No KV bound: conservative in-request guard (30 / min) held in the isolate + a log.
  console.warn("RATE_LIMIT_KV not bound — using conservative in-isolate guard. Provision KV for durable limits.");
  const win = 60, limit = 30, bucket = Math.floor(nowSec / win);
  if (isoGuard.size > 5000) isoGuard.clear();
  for (const [b, id] of checks) {
    const key = `${b}:${id}:${bucket}`;
    const cur = (isoGuard.get(key) || 0) + 1;
    isoGuard.set(key, cur);
    if (cur > limit) return false;
  }
  return true;
}

function buildProps(raw, clientTs) {
  const out = {};
  if (raw && typeof raw === "object") {
    for (const k of PROP_STR_KEYS) {
      if (typeof raw[k] === "string" && raw[k]) out[k] = raw[k].slice(0, 64);
    }
    if (Number.isFinite(raw.len)) out.len = Math.min(Math.max(Math.trunc(raw.len), 0), 100000);
  }
  if (clientTs != null) out.client_ts = clientTs;
  return out;
}

function sinceForRange(range) {
  const now = Date.now();
  if (range === "today") {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  }
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  return now - days * 86400 * 1000;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // ---- POST /track ----
    if (request.method === "POST" && url.pathname === "/track") {
      if (!originAllowed(request, env)) return json({ error: "forbidden_origin" }, 403, cors);
      try {
        const text = await request.text();
        if (text.length > 16_384) return json({ error: "payload_too_large" }, 413, cors);
        let body;
        try { body = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400, cors); }
        if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400, cors);

        const event = String(body.event || "");
        if (!ALLOWED_EVENTS.has(event)) return json({ error: "unknown_event" }, 400, cors);

        const ip = request.headers.get("CF-Connecting-IP") || "";
        const ipHash = ip ? await hashIp(ip, env) : null;
        const rlIpKey = ip ? await sha256Hex(ip, 8) : "noip"; // ephemeral rate-limit key only
        const deviceId = String(body.device_id || "unknown").slice(0, 64);
        if (!(await withinRateLimit(env, rlIpKey, deviceId))) return json({ error: "rate_limited" }, 429, cors);

        const country = request.headers.get("CF-IPCountry") || "XX";

        // clamp the client timestamp to now ± 5 min; otherwise use server time and keep
        // the client value inside props for reference (item 19).
        const now = Date.now();
        let ts = now, clientTs = null;
        if (Number.isFinite(body.ts)) { const t = Number(body.ts); if (Math.abs(t - now) <= 5 * 60 * 1000) ts = t; else clientTs = t; }

        const props = JSON.stringify(buildProps(body.props, clientTs)); // always valid JSON

        await env.DB.prepare(
          `INSERT INTO events (event_type, session_id, device_id, ip_hash, country, tab, props, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          event,
          String(body.session_id || "unknown").slice(0, 64),
          deviceId,
          ipHash,
          String(country).slice(0, 2),
          String(body.tab || "").slice(0, 32),
          props,
          ts
        ).run();

        return json({ ok: true }, 200, cors);
      } catch (err) {
        return json({ error: "server_error" }, 500, cors);
      }
    }

    // ---- GET /admin/* ----
    if (url.pathname.startsWith("/admin/")) {
      const noStore = { ...cors, "Cache-Control": "no-store" };
      if (!(await requireAdmin(request, env))) return json({ error: "unauthorized" }, 401, noStore);
      const range = url.searchParams.get("range") || "30d";
      const since = sinceForRange(range);

      try {
        if (url.pathname === "/admin/stats" && request.method === "GET") {
          const q = (sql, ...args) => env.DB.prepare(sql).bind(...args);

          const totals = await q(
            `SELECT COUNT(*) events, COUNT(DISTINCT session_id) sessions,
                    COUNT(DISTINCT device_id) devices, COUNT(DISTINCT ip_hash) ips,
                    COUNT(DISTINCT CASE WHEN country!='XX' THEN country END) countries
             FROM events WHERE ts>=?`, since).first();

          const todayStart = sinceForRange("today");
          const today = await q(`SELECT COUNT(DISTINCT session_id) sessions FROM events WHERE ts>=?`, todayStart).first();

          const perDay = (await q(
            `SELECT date(ts/1000,'unixepoch') day, COUNT(DISTINCT session_id) sessions, COUNT(*) events
             FROM events WHERE ts>=? GROUP BY day ORDER BY day`, since).all()).results || [];

          const events = (await q(
            `SELECT event_type type, COUNT(*) n FROM events WHERE ts>=? GROUP BY event_type ORDER BY n DESC LIMIT 15`, since).all()).results || [];

          const topReports = (await q(
            `SELECT json_extract(props,'$.date') date, COUNT(*) n FROM events
             WHERE ts>=? AND event_type='report_open' AND json_extract(props,'$.date') IS NOT NULL
             GROUP BY date ORDER BY n DESC LIMIT 12`, since).all()).results || [];

          const topLinks = (await q(
            `SELECT json_extract(props,'$.host') host, COUNT(*) n FROM events
             WHERE ts>=? AND event_type='report_link_click' AND json_extract(props,'$.host') IS NOT NULL AND json_extract(props,'$.host')!=''
             GROUP BY host ORDER BY n DESC LIMIT 12`, since).all()).results || [];

          const countries = (await q(
            `SELECT country, COUNT(*) n FROM events WHERE ts>=? AND country!='XX' GROUP BY country ORDER BY n DESC LIMIT 12`, since).all()).results || [];

          const recentRaw = (await q(
            `SELECT event_type type, props, ts FROM events WHERE ts>=? ORDER BY ts DESC LIMIT 20`, since).all()).results || [];
          const recent = recentRaw.map((r) => {
            let p = {};
            try { p = JSON.parse(r.props || "{}"); } catch {}
            return { ts: r.ts, type: r.type, date: p.date || null, host: p.host || null };
          });

          return json({ range, since, totals, today, perDay, events, topReports, topLinks, countries, recent }, 200, noStore);
        }

        if (url.pathname === "/admin/events" && request.method === "GET") {
          const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
          const rows = (await env.DB.prepare(
            `SELECT event_type type, session_id, device_id, country, tab, props, ts
             FROM events WHERE ts>=? ORDER BY ts DESC LIMIT ?`).bind(since, limit).all()).results || [];
          return json({ range, count: rows.length, events: rows }, 200, noStore);
        }

        return json({ error: "not_found" }, 404, noStore);
      } catch (err) {
        return json({ error: "server_error" }, 500, noStore);
      }
    }

    return json({ error: "not_found" }, 404, cors);
  },

  // Retention: delete events older than the window (default 180 days), on the cron schedule.
  async scheduled(event, env, ctx) {
    const days = Number(env.RETENTION_DAYS) || 180;
    const cutoff = Date.now() - days * 86400 * 1000;
    ctx.waitUntil(env.DB.prepare(`DELETE FROM events WHERE ts < ?`).bind(cutoff).run());
  },
};
