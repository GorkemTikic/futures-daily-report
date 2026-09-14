# Analytics Worker — Futures Daily Report

A small Cloudflare Worker + D1 database that powers the **Analytics** tab of the
website. It stores only safe metadata (which report was opened, where a click
landed, a per-day salted IP hash, a country), never any report content, and the
admin dashboard is bearer-token gated.

You deploy this once. Nothing here runs from your desktop — the website talks to
it from the browser, and a daily cron prunes old rows.

## What is sent and stored

The site's `assets/analytics.js` sends, per event: the event type, a `tab`, a small
`props` object, a `device_id`, a `session_id` and a client timestamp. `props` may carry
the UI `lang` and `theme` plus per-event details (a report `date`, a click `host`, a
`filter`/`sort`, a search `len`). It does **not** send user agent, screen size, device
pixel ratio, referrer or timezone.

The Worker validates every write and stores: `event_type`, `session_id`, `device_id`,
`ip_hash`, `country`, `tab`, a rebuilt/allow-listed `props`, and a server-clamped `ts`.

Events: `page_view`, `view_reports`, `view_analytics`, `report_open` (which date),
`report_close`, `report_nav`, `report_search`, `filter_change`, `sort_change`,
`report_pdf_open`, `report_raw_open`, `report_copy_link`, `report_link_click` (which
host), `lang_switch`, `ticker_error`, `error`.

## Privacy

- **No raw IP is stored.** The `ip_hash` is an **HMAC-SHA256** of the IP with a secret
  pepper (`IP_HASH_SECRET`) **combined with the current UTC day**, truncated to 16 hex
  chars. Because it is keyed and day-scoped, it is not brute-forceable across the IPv4
  space and does **not** link a device across days. If `IP_HASH_SECRET` is not set, **no**
  ip hash is stored at all (rather than a weak one). *Rows written before this change used
  an unsalted truncated SHA-256 and should be treated as the weaker scheme.*
- The only persistent id is a client-generated UUID the site keeps in **localStorage**
  (`_fdr_did`) to count unique devices; the session id lives in sessionStorage.
- No cookies; no report content (all of it is public anyway).

## One-time deploy

Requires a (free) Cloudflare account and `wrangler` (`npm i -g wrangler`, then
`wrangler login`).

```bash
cd analytics-worker

# 1) create the database, then paste the printed database_id into wrangler.toml
wrangler d1 create fdr-analytics-db

# 2) create the tables
wrangler d1 execute fdr-analytics-db --file=schema.sql --remote

# 3) create the rate-limit KV namespace, then PASTE its id into wrangler.toml
#    (replace PASTE_YOUR_KV_NAMESPACE_ID_HERE). The Worker fails CLOSED without it.
wrangler kv namespace create RATE_LIMIT_KV

# 4) secrets (never committed)
wrangler secret put ADMIN_TOKEN      # a long random string — you type this into the site
wrangler secret put IP_HASH_SECRET   # a long random string — pepper for the IP hash

# 5) confirm ALLOWED_ORIGIN in wrangler.toml is your Pages origin, no trailing slash:
#    https://gorkemtikic.github.io

# 6) ship it
wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://fdr-analytics.<your-subdomain>.workers.dev`.

## Connect the site to it

Edit **`../assets/config.js`** and set:

```js
window.FDR_CONFIG = { analyticsUrl: "https://fdr-analytics.<your-subdomain>.workers.dev" };
```

Commit + push, open the site's **Analytics** tab, enter the `ADMIN_TOKEN`.

## Security & retention notes

- **Writes are origin-gated**: `POST /track` is rejected (403) unless the request's
  `Origin` (or `Referer`) matches `ALLOWED_ORIGIN` — a bare `curl` with no Origin is
  rejected. CORS response headers are deny-by-default on top of this.
- **Rate limiting** is per-IP (100 / 5 min) and per-device (60 / 5 min), backed by
  `RATE_LIMIT_KV`. If the namespace is missing the Worker falls back to a conservative
  in-isolate guard (30 / min) and logs a warning — it never fails open.
- **Admin responses** carry `Cache-Control: no-store`; the token is compared in constant
  time over fixed-length digests.
- **Retention**: the `[triggers] crons` job deletes events older than `RETENTION_DAYS`
  (default **180**) daily at 04:00 UTC. Change the window in `wrangler.toml`.
- Cost: comfortably within Cloudflare's free tier for a team-sized audience.
