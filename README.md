# Futures Daily Report

A daily, **plain-English** report on every coin on Binance USD-M Futures. It answers
three questions a beginner can follow:

1. Which coins **moved the most** today?
2. Which coins had a **dangerous gap** between their two prices (last vs mark)?
3. **Should anyone worry** about it — and why?

The output is one newbie-friendly **PDF** plus machine-readable **CSVs**, filed into a
folder for each day.

Since **2026-09-12** every report also includes:

- **Charts** — each flagged coin gets a *live-price vs mark-price* line chart with the
  >5% danger-gap minutes shaded, so the story is visual, not just a table.
- **A whole-market context page** — real BTC / ETH / SOL numbers for the day and a
  normalised market chart, so an altcoin's move can be read against the majors.
- **Sourced news & social context** — an attributed list of the day's market-moving
  headlines (macro, ETF flows, regulation, notable single-coin/social events) that
  explains *why* the market moved. Every item carries a **source, a URL, an impact tag
  and a confidence flag**. Nothing is ever invented: if a move can't be tied to a
  confirmed, sourced event, it's left described by the price data alone.

---

## Folder layout

```
Futures-Daily-Report/
├─ README.md                 ← this file
├─ config.json               ← settings (thresholds, model, how many coins to scan)
├─ run.ps1                   ← run a report by hand
├─ install-scheduler.ps1     ← set up the automatic 23:45 UTC daily run
├─ src/                      ← the program (you don't need to touch this)
├─ logs/                     ← one log file per day
└─ reports/
   └─ 2026-06-13/            ← ONE FOLDER PER DAY
      ├─ summary_2026-06-13.pdf    ← the readable report (now with charts + market/news pages)
      ├─ summary_2026-06-13.md     ← same thing as plain text
      ├─ news.json                 ← the day's sourced news (auto-written; hand-editable, always wins)
      └─ data/
         ├─ ESPORTSUSDT.csv        ← per-minute last + mark + gap, one file per flagged coin
         └─ ...
```

Every run drops everything for that day into `reports/<date>/`, so it's always obvious
where a given day's report and its raw data live.

---

## How to run it by hand

Open PowerShell in this folder and run:

```powershell
.\run.ps1                    # today's report (up to the current minute, UTC)
.\run.ps1 -Date 2026-06-13   # a specific past UTC day
.\run.ps1 -All               # deep-scan EVERY symbol (slower, most thorough)
```

When it finishes, open `reports\<date>\summary_<date>.pdf`.

## How to make it run automatically every day

```powershell
.\install-scheduler.ps1
```

This registers a Windows Scheduled Task that runs the report **daily at 23:45 UTC**
(just before the day closes). It writes that day's folder with no further action needed.

---

## Settings (`config.json`)

| Setting | What it does |
|---|---|
| `prefilterTopN` | Scan the whole market cheaply, then deep-analyse the top N movers (default 75). Set `0` to deep-scan everything. |
| `deepDivePages` | How many coins get a full "story" page in the PDF (default 15). The rest still appear in the summary tables. |
| `thresholds` | What counts as a "big move", a "dangerous gap", etc. |
| `model` | Which Claude model writes the narratives (used only if `ANTHROPIC_API_KEY` is set). |

## Narratives: who writes the daily stories

Set `narrator` in `config.json`:

| `narrator` | What it does | API key? | Cost |
|---|---|---|---|
| `"cli"` *(default)* | Fresh AI narratives via **headless Claude Code** (`claude -p`) on your existing login — one batched call per day | **No** | ~$2.50/mo on Haiku, ~$15/mo on Opus |
| `"api"` | Direct Anthropic API | Yes (`ANTHROPIC_API_KEY`) | cheapest for AI prose |
| `"template"` | Built-in plain-English wording | No | Free, offline |
| `"auto"` | `api` if a key is set, else `cli`, else `template` | — | — |

**No matter which AI path runs, a safety gate checks the output and rejects any number
that wasn't in the real data**, falling back to that coin's template — so a wrong number
can never reach the PDF.

The default (`cli` + Haiku) gives genuinely fresh, varied narratives every day with **no
API key** at about **$2.50/month** on your Claude login. For richer prose, set
`"model": "claude-opus-4-8"` (≈$15/mo on the CLI route) — or use a direct API key, where
Opus is much cheaper.

**Requirements for the `cli` route:** Claude Code must be installed and **logged in** on
this machine, and the scheduled task runs as your user so it can use that login. If you
ever log out of Claude Code, the report quietly falls back to templates (never fails).

## Where the news comes from (and why you can trust the numbers)

The **"What moved the market"** page is compiled at generation time by the narrator:

- **`cli`** (default): a separate `claude -p` run **with web search allowed** researches the
  day's crypto headlines and returns them with sources.
- **`api`**: uses the Anthropic **web_search** tool.
- **`template` / offline / research fails**: the page falls back to a **truthful,
  data-only** summary built from the real BTC/ETH/SOL numbers — and lists **no** headlines
  rather than guessing.

Whatever is resolved is saved to **`reports/<date>/news.json`**. That file is the source of
truth for the page and **always wins**, so you can:

- **pre-fill it** for a day (e.g. paste in your own researched, sourced items), or
- **edit/curate** what the automated run produced before a meeting,

then re-run the report for that date and it will use your version.

**Guarantee:** the prompt forbids inventing a headline, outlet, URL, quote or figure, and
tells the model to return an empty list if it can't verify — so an unsourced claim never
reaches the report. Impact/confidence flags are editorial judgements, not guarantees.

> The nightly scheduled task runs standalone (not nested inside another Claude session), so
> its `claude -p` news research works there. If you ever run a report from *inside* another
> Claude Code session, the nested `claude -p` is blocked and the day falls back to the
> data-only summary — pre-fill `news.json` for that date if you need the headlines.

---

## Notes

- Market data is fetched **directly from Binance** (`fapi.binance.com`). It must run from
  a network Binance allows — this desktop works; a cloud server or the Cloudflare Worker
  would get blocked.
- The report is **information only, not financial advice**.
- "Last price" = the live traded price (drives realized PnL). "Mark price" = Binance's
  smoothed fair price (drives liquidations). The gap between them is what this tool watches.
