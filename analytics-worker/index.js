/**
 * Futures Daily Report — Analytics Worker (Cloudflare Worker + D1).
 *
 * Same design as the Futures DeskMate analytics Worker:
 *   POST /track        — ingest one event (public, CORS-locked to your Pages origin)
 *   GET  /admin/stats  — aggregated dashboard stats  (Bearer ADMIN_TOKEN)
 *   GET  /admin/events — recent raw events           (Bearer ADMIN_TOKEN)
 *
 * Privacy: raw IPs are never stored (only a 16-char SHA-256 prefix); country
 * comes from Cloudflare's CF-IPCountry header; no cookies; the only id is a
 * client-generated device/session UUID. The site tracks only which report was
 * opened and where a click landed — all of it already public information.
 */

const ALLOWED_EVENTS = new Set([
  "page_view", "view_reports", "view_analytics",
  "report_open", "report_close", "report_nav",
  "report_search", "filter_change", "sort_change",
  "report_pdf_open", "report_raw_open", "report_copy_link",
  "report_link_click", "lang_switch", "ticker_error", "error",
]);

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

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

async function hashIp(ip) {
  const buf = new TextEncoder().encode(ip);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function withinRateLimit(request, env, bucket, limit, windowSec) {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return true; // fail-open when not provisioned
  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await hashIp(ip);
    const windowStart = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${bucket}:${ipHash}:${windowStart}`;
    const current = Number((await kv.get(key)) || "0");
    if (current >= limit) return false;
    await kv.put(key, String(current + 1), { expirationTtl: windowSec + 5 });
    return true;
  } catch {
    return true;
  }
}

function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization");
  if (typeof env.ADMIN_TOKEN !== "string" || env.ADMIN_TOKEN.length === 0) return false;
  if (typeof auth !== "string") return false;
  return timingSafeEqual(auth, `Bearer ${env.ADMIN_TOKEN}`);
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
      if (!(await withinRateLimit(request, env, "track", 300, 60))) return json({ error: "rate_limited" }, 429, cors);
      try {
        const text = await request.text();
        if (text.length > 16_384) return json({ error: "payload_too_large" }, 413, cors);
        let body;
        try { body = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400, cors); }
        if (!body || typeof body !== "object") return json({ error: "bad_request" }, 400, cors);

        const event = String(body.event || "");
        if (!ALLOWED_EVENTS.has(event)) return json({ error: "unknown_event" }, 400, cors);

        const ip = request.headers.get("CF-Connecting-IP") || "";
        const ipHash = ip ? await hashIp(ip) : null;
        const country = request.headers.get("CF-IPCountry") || "XX";
        const props = body.props && typeof body.props === "object" ? JSON.stringify(body.props).slice(0, 2000) : "{}";
        const ts = Number.isFinite(body.ts) ? Number(body.ts) : Date.now();

        await env.DB.prepare(
          `INSERT INTO events (event_type, session_id, device_id, ip_hash, country, tab, props, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          event,
          String(body.session_id || "unknown").slice(0, 64),
          String(body.device_id || "unknown").slice(0, 64),
          ipHash,
          String(country).slice(0, 2),
          String(body.tab || "").slice(0, 32),
          props,
          ts
        ).run();

        return json({ ok: true }, 200, cors);
      } catch (err) {
        return json({ error: "server_error", detail: String(err).slice(0, 120) }, 500, cors);
      }
    }

    // ---- GET /admin/* ----
    if (url.pathname.startsWith("/admin/")) {
      if (!requireAdmin(request, env)) return json({ error: "unauthorized" }, 401, cors);
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

          return json({ range, since, totals, today, perDay, events, topReports, topLinks, countries, recent }, 200, cors);
        }

        if (url.pathname === "/admin/events" && request.method === "GET") {
          const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
          const rows = (await env.DB.prepare(
            `SELECT event_type type, session_id, device_id, country, tab, props, ts
             FROM events WHERE ts>=? ORDER BY ts DESC LIMIT ?`).bind(since, limit).all()).results || [];
          return json({ range, count: rows.length, events: rows }, 200, cors);
        }

        return json({ error: "not_found" }, 404, cors);
      } catch (err) {
        return json({ error: "server_error", detail: String(err).slice(0, 160) }, 500, cors);
      }
    }

    return json({ error: "not_found" }, 404, cors);
  },
};
