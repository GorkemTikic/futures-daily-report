# Futures Daily Report

📊 **Live site:** https://gorkemtikic.github.io/futures-daily-report/ — a searchable,
interactive browser for every daily report. It updates itself whenever a new report is
generated.

A daily, **plain-English** crypto-futures market report for customer-support agents who do
not read finance news. It covers **one full UTC calendar day** across the major venues —
**Binance, Bybit, OKX, Bitget, Gate** — and answers, in ordinary words:

1. What did price and volume do, and did the exchanges agree?
2. How were traders leaning (funding, open-interest change, long/short)?
3. What news actually moved the market — and what's scheduled next?

Each report is produced in **English, Turkish and Chinese**, plus a one-tap **Caveman
mode** ("explain it like I'm 10"). It also covers the tokenised **stock** perps on Binance
(Korea, Hong Kong, China, US) and **commodities**, and notes when a cash market was closed.

> **Hard rule:** the report never fabricates a number, headline, outlet, URL or finding.
> Everything is sourced and web-verified; if a source is unavailable, its section is
> omitted and the report says so. When in doubt it renders "—", never an estimate.

`src/` is the **retired** per-coin "mark-vs-last divergence" generator, kept only so the
site can still open its old reports. The current product is everything under `pipeline/`.

---

## Folder layout

```
Futures-Daily-Report/
├─ README.md
├─ config.json                ← settings (model, budgets, movers floor, …)
├─ install-scheduler.ps1      ← register the Windows scheduled task
├─ pipeline/                  ← THE CURRENT GENERATOR
│  ├─ index.js                ← orchestrator (entry point)
│  ├─ REPORT_SPEC.md          ← the report spec (source of truth)
│  ├─ datapack.js             ← assembles the verified data pack for one UTC day
│  ├─ exchanges.js            ← BTC/ETH + movers across 5 venues (UTC-day klines)
│  ├─ stocks.js / sessions.js ← tokenised-stock perps + cash-session status
│  ├─ calendar.js / news.js / tradfi.js
│  ├─ synthesize.js           ← Claude writes the prose/news/glossary/caveman + TR/ZH
│  ├─ render.js               ← lays verified data beside the prose → HTML + PDF
│  └─ http.js / redact.js / env.js
├─ scripts/                   ← build-manifest, publish, notify, check-narrator
├─ data/market-holidays.json  ← exchange holidays (verify & extend annually)
├─ analytics-worker/          ← Cloudflare Worker + D1 (usage analytics)
├─ assets/, index.html        ← the GitHub Pages site
├─ logs/                      ← per-day logs + ALERTS.log (gitignored)
└─ reports/
   └─ 2026-09-13/
      ├─ summary_2026-09-13.html / .pdf   (+ .tr / .zh)
      ├─ summary_2026-09-13.md
      ├─ report.json           ← manifest metadata + run status
      ├─ run.json              ← per-run health (see below)
      └─ synthesis.manual.json ← optional hand-edited prose (always wins)
```

---

## Run it by hand

```bash
node pipeline/index.js                    # the most recent completed UTC day
node pipeline/index.js --date 2026-09-13  # a specific PAST UTC day (day-bounded klines)
node pipeline/index.js --reuse-synthesis  # reuse cached prose instead of regenerating
```

`--date` for a past day fetches that day's daily klines and marks everything that can't be
reconstructed for a past day (funding/OI/mark/news/trad-fi) as unavailable. A future date,
or a day whose klines can't be fetched, exits non-zero rather than writing a report.

Re-running the same day **regenerates** the prose (it is not silently cached); pass
`--reuse-synthesis` to reuse `synthesis.auto.json`.

## Run it automatically

```powershell
.\install-scheduler.ps1
```

Registers a scheduled task that fires **hourly** and lets the pipeline generate the
just-closed UTC day once (then exit cheaply the rest of the day). This is **DST-proof** —
the decision is made in UTC in code, not by a fixed local trigger time. Verify with the
command the script prints at the end.

---

## Editing a day's prose

Drop a `reports/<date>/synthesis.manual.json` (same shape as `synthesis.auto.json`) to
override the writing for that day — a manual file **always wins** and is never overwritten.
Same for `synthesis.tr.manual.json` / `synthesis.zh.manual.json`.

## Reading `run.json`

Every run writes `reports/<date>/run.json`: `status` (`ok` / `degraded`), the per-source
status, which synthesis backend actually ran (and whether it fell back), languages/PDFs
produced, the publish result, the data window, and duration. A **degraded** run still
writes a truthful report, shows a banner naming what was missing, appends a line to
`logs/ALERTS.log` (and POSTs to `ALERT_WEBHOOK_URL` if set), and exits non-zero.

## Settings (`config.json`)

| Setting | What it does |
|---|---|
| `narrator` | `auto` (API if `ANTHROPIC_API_KEY`, else `claude -p`), `cli`, `api`, or `template`. |
| `model` | Which Claude model writes the prose. |
| `maxTokens` | Output cap for synthesis/translation (raise for richer models). |
| `moversMinQuoteVolUSD` | Liquidity floor for a "biggest mover" (below it → low-liquidity list). |
| `newsLookbackH` | Hours before 00:00 UTC to still pull news candidates. |
| `wallClockMinutes` | Soft budget; over it, translations/publish are skipped and the run is degraded. |
| `autoPublish` | Rebuild the manifest and push after each run. |

## The `.env` (gitignored — names only, never values)

`TRADFI_API_KEY` (Twelve Data), `CLAUDE_CODE_OAUTH_TOKEN` (subscription token for the
nightly `claude -p`), `CLAUDE_CLI_PATH` (full path to `claude.exe`), and optionally
`ANTHROPIC_API_KEY` and `ALERT_WEBHOOK_URL`.

**Refresh the CLI token** when it expires (~yearly) with `claude setup-token`, then paste
it into `.env` as `CLAUDE_CODE_OAUTH_TOKEN`. Check auth any time with
`npm run check-narrator` — don't wait for a nightly failure.

## The website & auto-publishing

The repo doubles as a static site served from its root. `scripts/build-manifest.mjs` writes
a small `manifest.json` (fast first paint) plus a full `manifest.full.json` (fetched lazily
on search). With `autoPublish` on, each run pushes `reports/` + the manifests and GitHub
Pages redeploys itself. A diverged remote is rebased, never force-pushed; a failed push
marks the run degraded.

## Usage analytics

The **Analytics** tab (token-gated) is powered by a small Cloudflare Worker + D1 — hashed
IPs (per-day salted), no cookies, no report content. One-time deploy:
[`analytics-worker/README.md`](analytics-worker/README.md).

---

## Notes

- Market data is fetched **directly from the exchanges**; Binance/Bybit require a network
  they allow (this desktop works; a cloud server would be geo-blocked).
- Information only, **not financial advice**.
