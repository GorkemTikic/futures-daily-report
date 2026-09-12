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
  @page { size: A4; margin: 16mm 14mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif; color:#1c1c1c; font-size:12.5px; line-height:1.6; }
  .page { page-break-after:always; }
  .page:last-child { page-break-after:auto; }
  h1 { font-size:25px; font-weight:700; color:#0d1117; margin-bottom:2px; letter-spacing:-0.3px; }
  .date { font-size:14px; color:#555; margin-bottom:18px; }
  h2 { font-size:18px; font-weight:700; color:#0d1117; margin:24px 0 8px; padding-bottom:5px; border-bottom:2px solid #e3e5e9; }
  h3 { font-size:14px; font-weight:700; color:#0d1117; margin:16px 0 6px; }
  p { margin-bottom:10px; }
  .lead { font-size:14px; }
  strong { color:#0d1117; }
  .tldr { background:#eef4fb; border-left:5px solid #2f6fd0; border-radius:0 8px 8px 0; padding:14px 16px; margin:16px 0; }
  .tldr h3 { margin-top:0; color:#1a4b91; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin:16px 0; }
  .stat { background:#f5f6f8; border-radius:8px; padding:12px 10px; text-align:center; }
  .stat .v { font-size:20px; font-weight:700; color:#0d1117; }
  .stat .v.red { color:#c0392b; }
  .stat .v.amb { color:#9a6700; }
  .stat .l { font-size:10px; color:#666; margin-top:3px; }
  .define { background:#fbfbfc; border:1px solid #e7e9ed; border-radius:8px; padding:12px 14px; margin:10px 0; }
  .define .term { font-weight:700; color:#0d1117; font-size:13.5px; }
  .define .why { color:#7a5a00; background:#fdf7e8; border-radius:6px; padding:7px 10px; margin-top:7px; font-size:12px; }
  table { width:100%; border-collapse:collapse; font-size:12px; margin:8px 0 14px; }
  th { text-align:left; background:#eef0f3; color:#444; font-weight:700; padding:7px 9px; border-bottom:2px solid #d4d7dd; }
  td { padding:6px 9px; border-bottom:1px solid #edeff2; }
  tr:nth-child(even) td { background:#fafbfc; }
  .mono { font-family:'Consolas',monospace; }
  .red { color:#c0392b; font-weight:700; }
  .amb { color:#9a6700; font-weight:700; }
  .grn { color:#1a7a3c; font-weight:700; }
  .callout { background:#fdecec; border-left:5px solid #c0392b; border-radius:0 8px 8px 0; padding:12px 14px; margin:14px 0; }
  .callout h3 { color:#a02b1f; margin-top:0; }
  .tag { display:inline-block; font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:4px; background:#eef0f3; color:#444; margin-left:6px; vertical-align:middle; }
  .tag.danger { background:#fde8e8; color:#c0392b; }
  .src { font-size:10px; color:#aaa; }
  .foot { margin-top:18px; padding-top:10px; border-top:1px solid #e3e5e9; font-size:10.5px; color:#888; }
  .chart { width:100%; height:auto; margin:10px 0 6px; background:#fff; border:1px solid #eceef1; border-radius:8px; }
  .chartcap { font-size:10.5px; color:#888; margin:0 0 14px; }
  .news { list-style:none; margin:6px 0 8px; }
  .news li { padding:9px 12px; border:1px solid #e7e9ed; border-left-width:5px; border-radius:0 8px 8px 0; margin-bottom:8px; background:#fbfbfc; }
  .news li.bullish { border-left-color:#1a7a3c; }
  .news li.bearish { border-left-color:#c0392b; }
  .news li.neutral { border-left-color:#8a8f98; }
  .news .h { font-weight:700; color:#0d1117; font-size:12.5px; }
  .news .meta { font-size:10.5px; color:#777; margin-top:2px; }
  .news .note { font-size:11.5px; color:#444; margin-top:4px; }
  .pill { display:inline-block; font-size:9.5px; font-weight:700; padding:1px 7px; border-radius:10px; margin-right:6px; vertical-align:middle; }
  .pill.bullish { background:#e6f4ea; color:#1a7a3c; }
  .pill.bearish { background:#fdecec; color:#c0392b; }
  .pill.neutral { background:#eef0f3; color:#555; }
  .conf { font-size:9.5px; color:#999; }
  .macro { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:14px 0; }
  .macro .m { background:#f5f6f8; border-radius:8px; padding:11px 12px; }
  .macro .m .sym { font-weight:700; font-size:13px; color:#0d1117; }
  .macro .m .chg { font-size:18px; font-weight:700; }
  .macro .m .sub { font-size:10px; color:#777; margin-top:2px; }
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
    <h1>Binance Futures — Daily Market Report</h1>
    <div class="date">${esc(R.dateLong)} &middot; 00:00 to ${esc(R.endLabel)} UTC</div>
    <p class="lead">For every coin on Binance USD-M Futures, this report answers three simple questions in plain English: <strong>which coins moved the most, which had a dangerous gap between their two prices, and should anyone worry about it?</strong> No experience needed — page 2 explains every term.</p>
    <div class="stats">
      ${statBox("coins scanned", R.symbolCount)}
      ${statBox("moved a lot today", R.bigMoveCount, "amb")}
      ${statBox("had a dangerous price gap", R.dangerCount, "red")}
      ${statBox(R.widest ? "biggest gap (" + R.widest.symbol + ")" : "biggest gap", R.widest ? R.widest.maxDiv : "—", "red")}
    </div>
    <div class="tldr">
      <h3>The day in one paragraph</h3>
      <p style="margin-bottom:0">${R.tldr}</p>
    </div>
    <h2>What's inside</h2>
    ${rankTable(["", ""], [
      ['<span class="mono">p.2</span>', "<strong>Plain-English dictionary</strong> — last price, mark price, divergence, volatility"],
      ['<span class="mono">p.3</span>', "<strong>Market overview</strong> — the day's biggest movers and the dangerous price gaps"],
      ['<span class="mono">p.4</span>', "<strong>Whole-market context</strong> — BTC/ETH/SOL, a market chart, and the day's sourced news"],
      ['<span class="mono">p.5+</span>', "<strong>Story of each flagged coin</strong> — with a price-vs-mark chart"],
    ])}
    <div class="foot">Generated automatically at ${esc(R.generatedAt)}. Source: Binance USD-M Futures public API (1-minute last-price and mark-price candles). Information only, not financial advice.</div>
  </div>`;

  const dictionary = `
  <div class="page">
    <h2>First, four words explained simply</h2>
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
    <h2>What happened across the market today</h2>
    <p class="lead">${R.overviewLead}</p>
    <h3>Biggest movers (by how far the price swung)</h3>
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
    <h2>What happened across the whole crypto market</h2>
    <p class="lead">Before the individual coins, here's the market backdrop they moved against — the majors, and the news that drove them. Altcoin futures rarely move in isolation; they mostly amplify what Bitcoin and the macro headlines are already doing.</p>
    ${macroCards || "<p><em>Macro reference data (BTC/ETH/SOL) was unavailable for this day.</em></p>"}
    ${R.marketChart ? `${R.marketChart}<p class="chartcap">Majors through the UTC day, shown as % change from each coin's own open so they share one scale. Source: Binance USD-M Futures 1-minute candles.</p>` : ""}
    ${news.summary ? `<div class="tldr"><h3>Why the market moved</h3><p style="margin-bottom:0">${esc(news.summary)}</p></div>` : ""}
    <h3>The day's news &amp; social-media drivers <span class="tag">sourced</span></h3>
    <p>Each item below was gathered from published reporting and carries its source and a confidence flag. Where a coin's move can't be tied to a confirmed event, it's left described by the data alone.</p>
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
        <h2>${esc(d.m.symbol)} <span class="tag ${d.isDanger ? "danger" : ""}">${esc(d.archetypeLabel)}</span></h2>
        <p class="lead"><strong>${esc(n.headline)}</strong></p>
        <p>${esc(n.narrative)}</p>
        ${d.chart ? `${d.chart}<p class="chartcap">Live (last) price vs mark price through the day. Shaded bands mark the minutes the gap exceeded 5% — the danger zone for liquidations. Source: Binance 1-minute candles.</p>` : ""}
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
