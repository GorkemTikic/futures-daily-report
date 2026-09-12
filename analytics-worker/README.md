# Analytics Worker — Futures Daily Report

A tiny Cloudflare Worker + D1 database that powers the **Analytics** tab of the
website. Same design as the Futures DeskMate analytics Worker: it stores only
safe metadata (which report was opened, where a click landed, a hashed IP, a
country), never any report content, and the admin dashboard is bearer-token
gated.

You deploy this once. Nothing here runs automatically from your desktop — the
website talks to it from the browser.

## What gets tracked

`page_view`, `view_reports`, `view_analytics`, `report_open` (which date),
`report_nav`, `report_search`, `filter_change`, `sort_change`,
`report_pdf_open`, `report_copy_link`, `report_link_click` (which host),
`ticker_error`, `error`.

## One-time deploy

Requires a (free) Cloudflare account and `wrangler` (`npm i -g wrangler`, then
`wrangler login`).

```bash
cd analytics-worker

# 1) create the database, then paste the printed database_id into wrangler.toml
wrangler d1 create fdr-analytics-db

# 2) create the tables
wrangler d1 execute fdr-analytics-db --file=schema.sql --remote

# 3) set the admin password (any long random string — you'll type this into the
#    site's Analytics tab). Keep it secret; it is never committed.
wrangler secret put ADMIN_TOKEN

# 4) confirm ALLOWED_ORIGIN in wrangler.toml is your Pages origin, e.g.
#    https://gorkemtikic.github.io   (no trailing slash)

# 5) ship it
wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://fdr-analytics.<your-subdomain>.workers.dev`.

## Connect the site to it

Edit **`../assets/config.js`** and set:

```js
window.FDR_CONFIG = { analyticsUrl: "https://fdr-analytics.<your-subdomain>.workers.dev" };
```

Commit + push. Open the site's **Analytics** tab, enter the `ADMIN_TOKEN` you
set in step 3, and the dashboard appears (visitors, sessions per day, most-read
reports, click destinations, countries, recent events).

## Optional: rate limiting

To blunt anonymous flooding, create a KV namespace and uncomment the
`[[kv_namespaces]]` block in `wrangler.toml`:

```bash
wrangler kv namespace create RATE_LIMIT_KV
```

The Worker fails **open** without it, so this is optional.

## Notes

- CORS is deny-by-default: only your `ALLOWED_ORIGIN` may post events from a
  browser. The bearer token and (optional) rate limit are the real gates.
- Raw IPs are never stored — only a 16-char SHA-256 prefix, enough to count
  unique visitors, not enough to reverse.
- Cost: comfortably within Cloudflare's free tier for a team-sized audience.
