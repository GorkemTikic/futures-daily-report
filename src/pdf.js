// Builds the newbie-friendly HTML report and renders it to PDF via headless Chrome.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
const execFileP = promisify(execFile);

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Compact price for the macro cards (mirrors narrate.js fmtPrice, kept local so
// pdf.js stays dependency-free).
function fmtP(x) {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  let s;
  if (Math.abs(x) >= 100) s = x.toFixed(2);
  else if (Math.abs(x) >= 1) s = x.toFixed(4);
  else if (Math.abs(x) >= 0.01) s = x.toFixed(5);
  else s = x.toFixed(6);
  return "$" + s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

const STYLE = `
  @page { size: A4; margin: 15mm 14mm 16mm; }
  :root {
    --ink:#14181d; --ink2:#39414b; --muted:#6b727c; --faint:#9aa1ab;
    --accent:#c2410c; --accent-ink:#9a3409; --accent-soft:#fbeee6; --accent-line:#eecab2;
    --line:#e8eaee; --line2:#f0f2f5; --card:#f7f8fa;
    --pos:#0f8a4f; --pos-soft:#e7f4ec; --neg:#c62b3f; --neg-soft:#fbe9eb; --amb:#b45309;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  html { background:#fff; }
  body { font-family:'Segoe UI',-apple-system,'Helvetica Neue',Arial,sans-serif; background:#fff; color:var(--ink2); color-scheme:light; font-size:12px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  /* On screen (the website's document view) the @page print margins don't apply,
     so give the sheet its own padding. Page-breaks show as a thin rule instead. */
  @media screen {
    body { padding:34px 40px; }
    .page { padding-bottom:26px; margin-bottom:26px; border-bottom:1px solid var(--line2); }
    .page:last-child { border-bottom:none; margin-bottom:0; }
  }
  .page { page-break-after:always; }
  .page:last-child { page-break-after:auto; }
  .mono { font-family:'SF Mono','Consolas','Liberation Mono',monospace; font-variant-numeric:tabular-nums; }
  strong { color:var(--ink); font-weight:650; }

  /* section header system — makes "what is what" obvious */
  .kicker { font-size:9.5px; font-weight:700; letter-spacing:0.11em; text-transform:uppercase; color:var(--accent); display:flex; align-items:center; gap:8px; margin-bottom:5px; }
  .kicker::before { content:""; width:16px; height:2px; background:var(--accent); border-radius:2px; }
  h2 { font-size:19px; font-weight:700; color:var(--ink); letter-spacing:-0.02em; margin:0 0 4px; }
  .intro { font-size:12px; color:var(--muted); margin:0 0 14px; max-width:62ch; }
  h3 { font-size:11px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:var(--muted); margin:18px 0 8px; }
  p { margin-bottom:10px; }
  .lead { font-size:13.5px; color:var(--ink2); }

  /* cover */
  .cover-band { display:flex; align-items:center; gap:12px; padding-bottom:16px; margin-bottom:22px; border-bottom:1px solid var(--line); }
  .cover-mark { width:38px; height:38px; border-radius:10px; background:linear-gradient(150deg,#e05a1f,#c2410c); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:15px; }
  .cover-brand { font-size:12.5px; font-weight:700; color:var(--ink); letter-spacing:-0.01em; }
  .cover-brand span { display:block; font-size:10px; font-weight:500; color:var(--muted); letter-spacing:0.02em; }
  h1 { font-size:34px; font-weight:800; color:var(--ink); margin:6px 0 2px; letter-spacing:-0.03em; }
  .date { font-size:13px; color:var(--muted); margin-bottom:20px; }

  .tldr { background:var(--accent-soft); border:1px solid var(--accent-line); border-radius:11px; padding:15px 17px; margin:18px 0; }
  .tldr h3 { margin:0 0 6px; color:var(--accent-ink); font-size:10px; }
  .tldr p { margin:0; font-size:13px; color:var(--ink2); }

  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:11px; margin:18px 0; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:11px; padding:13px 14px; }
  .stat .v { font-family:'SF Mono','Consolas',monospace; font-size:23px; font-weight:700; color:var(--ink); letter-spacing:-0.02em; line-height:1.05; }
  .stat .v.red { color:var(--neg); } .stat .v.amb { color:var(--amb); } .stat .v.grn { color:var(--pos); }
  .stat .l { font-size:9.5px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; color:var(--muted); margin-top:6px; }

  .define { background:var(--card); border:1px solid var(--line); border-radius:11px; padding:13px 15px; margin:10px 0; }
  .define .term { font-weight:700; color:var(--ink); font-size:13px; }
  .define p { margin:5px 0 0; font-size:12px; }
  .define .why { color:var(--accent-ink); background:var(--accent-soft); border-radius:8px; padding:8px 11px; margin-top:9px; font-size:11.5px; }

  table { width:100%; border-collapse:collapse; font-size:11.5px; margin:6px 0 16px; }
  th { text-align:left; color:var(--muted); font-weight:700; font-size:9.5px; letter-spacing:0.05em; text-transform:uppercase; padding:0 10px 7px; border-bottom:1px solid var(--line); }
  td { padding:8px 10px; border-bottom:1px solid var(--line2); }
  tr:last-child td { border-bottom:none; }
  .red { color:var(--neg); font-weight:650; } .amb { color:var(--amb); font-weight:650; } .grn { color:var(--pos); font-weight:650; }

  .callout { background:var(--neg-soft); border:1px solid #f2ccd1; border-left:3px solid var(--neg); border-radius:0 10px 10px 0; padding:12px 15px; margin:14px 0; }
  .callout h3 { color:var(--neg); margin:0 0 5px; }
  .callout p { margin:0; font-size:12px; color:var(--ink2); }

  .tag { display:inline-block; font-size:10px; font-weight:650; padding:3px 10px; border-radius:999px; background:var(--card); border:1px solid var(--line); color:var(--ink2); margin-left:8px; vertical-align:middle; }
  .tag.danger { background:var(--neg-soft); border-color:#f2ccd1; color:var(--neg); }

  .coin-head { display:flex; align-items:baseline; gap:2px; margin-bottom:6px; }
  .coin-head h2 { font-family:'SF Mono','Consolas',monospace; letter-spacing:-0.01em; }

  .foot { margin-top:20px; padding-top:11px; border-top:1px solid var(--line); font-size:10px; color:var(--faint); }
  .src { color:var(--faint); }

  .chart { width:100%; height:auto; display:block; }
  .figure { border:1px solid var(--line); border-radius:11px; padding:12px 12px 6px; margin:12px 0; background:#fff; }
  .chartcap { font-size:10px; color:var(--muted); margin:6px 2px 0; }

  .news { list-style:none; margin:8px 0; }
  .news li { padding:12px 14px; border:1px solid var(--line); border-left:3px solid var(--faint); border-radius:0 11px 11px 0; margin-bottom:9px; background:#fff; }
  .news li.bullish { border-left-color:var(--pos); }
  .news li.bearish { border-left-color:var(--neg); }
  .news li.neutral { border-left-color:var(--faint); }
  .news .h { font-weight:650; color:var(--ink); font-size:12.5px; display:flex; align-items:center; gap:8px; }
  .news .meta { font-size:10.5px; color:var(--muted); margin-top:5px; }
  .news .note { font-size:11.5px; color:var(--ink2); margin-top:6px; line-height:1.55; }
  .pill { display:inline-block; font-size:9px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; padding:2px 8px; border-radius:999px; }
  .pill.bullish { background:var(--pos-soft); color:var(--pos); }
  .pill.bearish { background:var(--neg-soft); color:var(--neg); }
  .pill.neutral { background:var(--card); color:var(--muted); }
  .conf { color:var(--faint); }

  .macro { display:grid; grid-template-columns:repeat(3,1fr); gap:11px; margin:14px 0; }
  .macro .m { background:var(--card); border:1px solid var(--line); border-radius:11px; padding:12px 14px; }
  .macro .m .sym { font-weight:700; font-size:12.5px; color:var(--ink); }
  .macro .m .chg { font-family:'SF Mono','Consolas',monospace; font-size:19px; font-weight:700; letter-spacing:-0.02em; margin-top:2px; }
  .macro .m .sub { font-size:10px; color:var(--muted); margin-top:3px; }
`;

function statBox(label, value, cls = "") {
  return `<div class="stat"><div class="v ${cls}">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;
}

function rankTable(headers, rows) {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows
    .map((r) => "<tr>" + r.map((c) => `<td>${c}</td>`).join("") + "</tr>")
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function buildHtml(R) {
  const cover = `
  <div class="page">
    <div class="cover-band">
      <div class="cover-mark">FD</div>
      <div class="cover-brand">Futures Daily Report<span>Binance USD-M Futures · daily market report</span></div>
    </div>
    <div class="kicker">Daily market report</div>
    <h1>${esc(R.dateLong)}</h1>
    <div class="date">00:00 to ${esc(R.endLabel)} UTC · all coins on Binance USD-M Futures</div>
    <div class="stats">
      ${statBox("coins scanned", R.symbolCount)}
      ${statBox("moved more than 25%", R.bigMoveCount, "amb")}
      ${statBox("dangerous price gaps", R.dangerCount, "red")}
      ${statBox(R.widest ? "widest gap · " + R.widest.symbol : "widest gap", R.widest ? R.widest.maxDiv : "—", "red")}
    </div>
    <div class="tldr">
      <h3>The day in one paragraph</h3>
      <p>${R.tldr}</p>
    </div>
    <h3>What's inside this report</h3>
    ${rankTable(["", ""], [
      ['<span class="mono">01</span>', "<strong>Key terms</strong> — last price, mark price, divergence, volatility, explained simply"],
      ['<span class="mono">02</span>', "<strong>Market overview</strong> — the day's biggest movers and the dangerous price gaps"],
      ['<span class="mono">03</span>', "<strong>Whole-market context</strong> — BTC / ETH / SOL, a market chart, and the day's sourced news"],
      ['<span class="mono">04</span>', "<strong>Every flagged coin</strong> — its story, a price-vs-mark chart, and the numbers"],
    ])}
    <div class="foot">Generated automatically at ${esc(R.generatedAt)}. Source: Binance USD-M Futures public API (1-minute last-price and mark-price candles). Information only, not financial advice.</div>
  </div>`;

  const dictionary = `
  <div class="page">
    <div class="kicker">01 · Key terms</div>
    <h2>Four words, explained simply</h2>
    <p>Every coin on Binance Futures has <strong>two prices at the same time</strong>. Here's why, with no jargon.</p>
    <div class="define"><div class="term">1. Last Price</div>
      <p style="margin-bottom:0">The price of the <strong>most recent real trade</strong> — the live price flashing on screen. It can jump around when the market panics, because one big order can yank it for a moment.</p></div>
    <div class="define"><div class="term">2. Mark Price</div>
      <p>A calmer, <strong>"fair" price</strong> Binance calculates by blending sources and smoothing out spikes — the "sensible" price.</p>
      <div class="why"><strong>Why it matters:</strong> Binance uses the mark price to decide <strong>liquidations</strong>, and by default to show the unrealized profit/loss on open positions. When you actually close a trade, your <strong>realized</strong> profit/loss is based on the real traded (last) price — and you can switch the unrealized display to last price too. Liquidation, however, always uses the mark price.</div></div>
    <div class="define"><div class="term">3. Divergence (the gap between the two prices)</div>
      <p>Normally the two prices are almost identical. Divergence is how far apart they drift, as a percentage. 1% is notable; 30% is alarming.</p>
      <div class="why"><strong>Why it matters:</strong> because liquidation uses the <strong>mark</strong> price, a big gap means you can be liquidated even when the <strong>live</strong> price never looked that bad. This gap is the main thing this report watches.</div></div>
    <div class="define"><div class="term">4. Volatility</div>
      <p style="margin-bottom:0">Simply how much a price <strong>bounced around</strong>. A calm coin might move 2% all day; a volatile one swings 50%. More volatility = bigger chances to win <em>and</em> lose.</p></div>
    <div class="callout"><h3>The one-sentence takeaway</h3>
      <p style="margin-bottom:0">The price you trade at and the price that <strong>liquidates</strong> you are two different numbers — and a big gap between them is where people get hurt unexpectedly. That's what we flag.</p></div>
  </div>`;

  const overview = `
  <div class="page">
    <div class="kicker">02 · Market overview</div>
    <h2>What happened across the market today</h2>
    <p class="intro">${R.overviewLead}</p>
    <h3>Biggest movers · by how far the price swung</h3>
    ${rankTable(
      ["Coin", "Total swing", "Open → Close", "1-min vol"],
      R.topVolatility.map((r) => [
        `<span class="mono">${esc(r.symbol)}</span>`,
        `<span class="${r.cls}">${esc(r.range)}</span>`,
        `<span class="mono">${esc(r.openClose)}</span>`,
        `<span class="mono">${esc(r.vol)}</span>`,
      ])
    )}
    <h3 style="margin-top:20px">Dangerous price gaps (the important list) <span class="tag danger">watch these</span></h3>
    <p>These coins had their two prices drift far apart — the situation where people get liquidated unexpectedly. "Minutes in danger zone" counts minutes the gap stayed above 5%.</p>
    ${
      R.topDivergence.length
        ? rankTable(
            ["Coin", "Worst gap", "When (UTC)", "Min &gt;2%", "Min in danger zone (&gt;5%)"],
            R.topDivergence.map((r) => [
              `<span class="mono">${esc(r.symbol)}</span>`,
              `<span class="red">${esc(r.maxDiv)}</span>`,
              `<span class="mono">${esc(r.time)}</span>`,
              esc(r.over2),
              `<span class="${r.over5 > 0 ? "red" : ""}">${esc(r.over5)}</span>`,
            ])
          )
        : `<p><em>No coin had a divergence above 2% today — an unusually calm day for price gaps.</em></p>`
    }
    <div class="foot">Full machine-readable per-minute data for every flagged coin is saved alongside this PDF in the <span class="mono">data/</span> folder.</div>
  </div>`;

  // --- global market context + news page ---
  const macro = R.macro || {};
  const macroCards = Object.keys(macro).length
    ? `<div class="macro">` + Object.entries(macro).map(([sym, v]) => {
        const cls = v.pctChange >= 0 ? "grn" : "red";
        const sign = v.pctChange >= 0 ? "+" : "";
        return `<div class="m"><div class="sym">${esc(sym)}</div>
          <div class="chg ${cls}">${sign}${v.pctChange.toFixed(1)}%</div>
          <div class="sub">${esc(fmtP(v.open))} → ${esc(fmtP(v.close))} · day range ${v.rangePct.toFixed(1)}%</div></div>`;
      }).join("") + `</div>`
    : "";

  const news = R.news || { items: [], summary: "", source: "n/a" };
  const newsList = news.items && news.items.length
    ? `<ul class="news">` + news.items.map((n) => {
        const impact = ["bullish", "bearish", "neutral"].includes(n.impact) ? n.impact : "neutral";
        const link = n.url ? ` · <a href="${esc(n.url)}">${esc(n.source)}</a>` : ` · ${esc(n.source)}`;
        return `<li class="${impact}">
          <div class="h"><span class="pill ${impact}">${impact}</span>${esc(n.headline)}</div>
          <div class="meta"><span class="conf">confidence: ${esc(n.confidence || "—")}</span> · ${esc(n.date || "")}${link}</div>
          ${n.note ? `<div class="note">${esc(n.note)}</div>` : ""}
        </li>`;
      }).join("") + `</ul>`
    : `<div class="define"><p style="margin-bottom:0"><strong>No external news was researched for this day.</strong> The moves below are described from Binance price data only. (Source tag: ${esc(news.source)}.)</p></div>`;

  const marketPage = `
  <div class="page">
    <div class="kicker">03 · Whole-market context</div>
    <h2>What moved the whole crypto market</h2>
    <p class="intro">The backdrop the altcoins moved against — the majors, and the news that drove them. Altcoin futures rarely move in isolation; they mostly amplify what Bitcoin and the macro headlines are already doing.</p>
    ${macroCards || "<p><em>Macro reference data (BTC/ETH/SOL) was unavailable for this day.</em></p>"}
    ${R.marketChart ? `<div class="figure">${R.marketChart}<p class="chartcap">The majors through the UTC day, shown as % change from each coin's own open so they share one scale. Source: Binance USD-M Futures 1-minute candles.</p></div>` : ""}
    ${news.summary ? `<div class="tldr"><h3>Why the market moved</h3><p>${esc(news.summary)}</p></div>` : ""}
    <h3>The day's news &amp; social drivers · sourced</h3>
    <p class="intro">Each item was gathered from published reporting and carries its source and a confidence flag. Where a coin's move can't be tied to a confirmed event, it's left described by the data alone.</p>
    ${newsList}
    <div class="foot">News is compiled from public reporting at generation time and may be incomplete. Impact/confidence flags are editorial judgements, not guarantees. Information only, not financial advice.</div>
  </div>`;

  const deepDives = R.deepDives
    .map((d) => {
      const n = d.narrative;
      const worst =
        d.worstMinutes && d.worstMinutes.length
          ? `<h3>Worst minutes by price gap</h3>` +
            rankTable(
              ["Time (UTC)", "Last open", "Last high", "Last low", "Last close", "Mark close", "Gap"],
              d.worstMinutes.map((w) => [
                `<span class="mono">${esc(w.time)}</span>`,
                `<span class="mono">${esc(w.lOpen)}</span>`,
                `<span class="mono">${esc(w.lHigh)}</span>`,
                `<span class="mono">${esc(w.lLow)}</span>`,
                `<span class="mono">${esc(w.lClose)}</span>`,
                `<span class="mono">${esc(w.mClose)}</span>`,
                `<span class="red">${esc(w.div)}</span>`,
              ])
            )
          : "";
      const danger = n.dangerNote
        ? `<div class="callout"><h3>Why this matters</h3><p style="margin-bottom:0">${esc(n.dangerNote)}</p></div>`
        : "";
      return `
      <div class="page">
        <div class="kicker">04 · Flagged coin</div>
        <div class="coin-head"><h2>${esc(d.m.symbol)}</h2><span class="tag ${d.isDanger ? "danger" : ""}">${esc(d.archetypeLabel)}</span></div>
        <p class="lead"><strong>${esc(n.headline)}</strong></p>
        <p>${esc(n.narrative)}</p>
        ${d.chart ? `<div class="figure">${d.chart}<p class="chartcap">Live (last) price vs mark price through the day. Shaded bands mark the minutes the gap exceeded 5% — the danger zone for liquidations. Source: Binance 1-minute candles.</p></div>` : ""}
        ${danger}
        <h3>By the numbers</h3>
        <div class="stats">
          ${statBox("price change", d.facts.pctChange, d.m.pctChange < 0 ? "red" : "grn")}
          ${statBox("biggest gap", d.facts.maxDiv, "red")}
          ${statBox("min gap &gt;5%", d.facts.minutesOver5, d.m.minutesOver5 > 0 ? "red" : "")}
          ${statBox("day range", d.facts.intradayRange, "amb")}
        </div>
        ${worst}
        <div class="foot"><span class="src">Narrative source: ${esc(n.source)}.</span> Full per-minute data: <span class="mono">data/${esc(d.m.symbol)}.csv</span></div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${cover}${dictionary}${overview}${marketPage}${deepDives}</body></html>`;
}

export async function renderPdf(html, htmlPath, pdfPath) {
  fs.writeFileSync(htmlPath, html, "utf8");
  const chrome = findChrome();
  if (!chrome) throw new Error("No Chrome/Edge found for PDF rendering.");
  const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/");
  await execFileP(chrome, [
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    fileUrl,
  ]);
  if (!fs.existsSync(pdfPath)) throw new Error("PDF was not produced.");
  return pdfPath;
}
