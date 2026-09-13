// Renders the multi-exchange daily report to HTML (and PDF via the shared Chrome path).
// Verified numbers come from the data pack; prose/news/glossary come from the synthesis.
// Same visual system as the site's document view (macOS graphite + orange, cover band,
// numbered section kickers, clean tables) so it drops straight into the existing reader.

import { renderPdf } from "../src/pdf.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function fmtUSD(x) {
  if (x == null || !isFinite(x)) return "—";
  if (Math.abs(x) >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
  if (Math.abs(x) >= 1e6) return "$" + (x / 1e6).toFixed(0) + "M";
  if (Math.abs(x) >= 1e3) return "$" + (x / 1e3).toFixed(0) + "K";
  return "$" + x.toFixed(0);
}
function fmtPrice(x) {
  if (x == null || !isFinite(x)) return "—";
  if (Math.abs(x) >= 100) return "$" + x.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(x) >= 1) return "$" + x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return "$" + x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
const sgn = (x, dp = 2) => x == null || !isFinite(x) ? "—" : (x >= 0 ? "+" : "") + x.toFixed(dp) + "%";
const cls = (x) => x == null ? "" : x > 0.02 ? "grn" : x < -0.02 ? "red" : "";

const STYLE = `
  @page { size: A4; margin: 15mm 14mm 16mm; }
  :root{--ink:#14181d;--ink2:#39414b;--muted:#6b727c;--faint:#9aa1ab;--accent:#c2410c;--accent-ink:#9a3409;--accent-soft:#fbeee6;--accent-line:#eecab2;--line:#e8eaee;--line2:#f0f2f5;--card:#f7f8fa;--pos:#0f8a4f;--pos-soft:#e7f4ec;--neg:#c62b3f;--neg-soft:#fbe9eb;--amb:#b45309;}
  *{margin:0;padding:0;box-sizing:border-box;}
  html{background:#fff;} body{font-family:'Segoe UI',-apple-system,'Helvetica Neue',Arial,sans-serif;background:#fff;color:var(--ink2);color-scheme:light;font-size:12px;line-height:1.6;-webkit-font-smoothing:antialiased;}
  @media screen{ body{font-size:14px;padding:44px 56px;} h1{font-size:38px;} h2{font-size:22px;} table{font-size:13px;} .lead{font-size:17px;} .section{padding-bottom:30px;margin-bottom:30px;border-bottom:1px solid var(--line2);} .section:last-child{border-bottom:none;} }
  .mono{font-family:'SF Mono','Consolas',monospace;font-variant-numeric:tabular-nums;}
  strong{color:var(--ink);font-weight:650;}
  .cover-band{display:flex;align-items:center;gap:12px;padding-bottom:16px;margin-bottom:22px;border-bottom:1px solid var(--line);}
  .cover-mark{width:38px;height:38px;border-radius:10px;background:linear-gradient(150deg,#e05a1f,#c2410c);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;}
  .cover-brand{font-size:12.5px;font-weight:700;color:var(--ink);} .cover-brand span{display:block;font-size:10px;font-weight:500;color:var(--muted);}
  .kicker{font-size:9.5px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:var(--accent);display:flex;align-items:center;gap:8px;margin-bottom:5px;}
  .kicker::before{content:"";width:16px;height:2px;background:var(--accent);border-radius:2px;}
  h1{font-size:32px;font-weight:800;color:var(--ink);letter-spacing:-0.03em;margin:6px 0 2px;}
  .date{font-size:13px;color:var(--muted);margin-bottom:18px;}
  h2{font-size:19px;font-weight:700;color:var(--ink);letter-spacing:-0.02em;margin:0 0 4px;}
  .intro{font-size:12px;color:var(--muted);margin:0 0 12px;max-width:64ch;}
  h3{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:16px 0 8px;}
  .lead{font-size:15px;color:var(--ink2);line-height:1.6;}
  .section{margin-bottom:26px;}
  .oneline{background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:12px;padding:16px 18px;margin:14px 0 22px;}
  .oneline .k{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:6px;}
  .oneline p{margin:0;font-size:16px;color:var(--ink);font-weight:600;}
  table{width:100%;border-collapse:collapse;font-size:11.5px;margin:6px 0 12px;}
  th{text-align:right;color:var(--muted);font-weight:700;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;padding:0 10px 7px;border-bottom:1px solid var(--line);}
  th:first-child{text-align:left;} td{padding:8px 10px;border-bottom:1px solid var(--line2);text-align:right;} td:first-child{text-align:left;}
  tr:last-child td{border-bottom:none;} tbody tr.lead-row td{background:var(--card);}
  .grn{color:var(--pos);font-weight:650;} .red{color:var(--neg);font-weight:650;} .amb{color:var(--amb);font-weight:650;}
  .say{font-size:12.5px;color:var(--ink2);margin:8px 0 4px;line-height:1.55;}
  .newscard{background:#fff;border:1px solid var(--line);border-left:3px solid var(--faint);border-radius:0 11px 11px 0;padding:12px 15px;margin-bottom:9px;}
  .newscard.top{border-left-color:var(--accent);background:var(--accent-soft);}
  .newscard .h{font-weight:650;color:var(--ink);font-size:12.5px;}
  .newscard .what{font-size:11.5px;color:var(--ink2);margin-top:5px;line-height:1.55;}
  .newscard .meta{font-size:10px;color:var(--muted);margin-top:6px;}
  .newscard a{color:var(--accent-ink);}
  .movers .m{padding:9px 0;border-bottom:1px solid var(--line2);} .movers .m:last-child{border-bottom:none;}
  .movers .sym{font-family:'SF Mono','Consolas',monospace;font-weight:700;color:var(--ink);}
  .cal{margin:6px 0;} .cal .e{display:flex;gap:12px;padding:7px 0;border-bottom:1px solid var(--line2);font-size:12px;}
  .cal .e:last-child{border-bottom:none;} .cal .t{font-family:'SF Mono','Consolas',monospace;color:var(--accent-ink);white-space:nowrap;}
  .cal .fc{color:var(--muted);white-space:nowrap;}
  .gloss{columns:2;column-gap:26px;} @media screen{.gloss{column-gap:40px;}}
  .gloss .g{break-inside:avoid;margin-bottom:11px;} .gloss .term{font-weight:700;color:var(--ink);font-size:12px;} .gloss .def{font-size:11.5px;color:var(--ink2);}
  .foot{margin-top:22px;padding-top:11px;border-top:1px solid var(--line);font-size:10px;color:var(--faint);}
  .none{font-size:12px;color:var(--muted);font-style:italic;}
`;

function venueTable(majorObj, cols) {
  const rows = Object.values(majorObj).filter((r) => r && r.ok);
  if (!rows.length) return `<p class="none">No venue data available.</p>`;
  const head = "<tr>" + cols.map((c) => `<th>${c.h}</th>`).join("") + "</tr>";
  const body = rows.map((r) => "<tr>" + cols.map((c) => `<td>${c.f(r)}</td>`).join("") + "</tr>").join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function buildReportHtml(pack, synth) {
  const s = synth || {};
  const priceCols = [
    { h: "Venue", f: (r) => `<strong>${esc(r.venue)}</strong>` },
    { h: "Last", f: (r) => `<span class="mono">${fmtPrice(r.last)}</span>` },
    { h: "24h", f: (r) => `<span class="mono ${cls(r.chgPct)}">${sgn(r.chgPct)}</span>` },
    { h: "24h high", f: (r) => `<span class="mono">${fmtPrice(r.high)}</span>` },
    { h: "24h low", f: (r) => `<span class="mono">${fmtPrice(r.low)}</span>` },
    { h: "24h volume", f: (r) => `<span class="mono">${fmtUSD(r.volUSD)}</span>` },
  ];
  const posCols = [
    { h: "Venue", f: (r) => `<strong>${esc(r.venue)}</strong>` },
    { h: "Funding (ann.)", f: (r) => `<span class="mono ${cls(r.fundingAnnPct)}">${sgn(r.fundingAnnPct, 1)}</span>` },
    { h: "Open interest", f: (r) => `<span class="mono">${fmtUSD(r.oiUSD)}</span>` },
    { h: "Mark", f: (r) => `<span class="mono">${fmtPrice(r.mark)}</span>` },
  ];

  const section = (kicker, title, intro, body) =>
    `<div class="section"><div class="kicker">${esc(kicker)}</div><h2>${esc(title)}</h2>${intro ? `<p class="intro">${esc(intro)}</p>` : ""}${body}</div>`;

  const cover = `
    <div class="cover-band"><div class="cover-mark">FD</div><div class="cover-brand">Futures Daily Report<span>Crypto futures across the major venues · daily</span></div></div>
    <div class="kicker">Daily market report</div>
    <h1>${esc(pack.dateLong || pack.dateUTC)}</h1>
    <div class="date">${esc(pack.coversUTC || "00:00–23:59 UTC")} · all times UTC · data from Binance, Bybit, OKX, Bitget, Gate${pack.tradfi?.ok ? " + Twelve Data" : ""}</div>
    <div class="oneline"><div class="k">The day in one line</div><p>${esc(s.oneLine || "—")}</p></div>`;

  // 2 — price & volume
  const priceVol = section("01 · Price & volume", "What every venue's price and volume did",
    "The same two contracts on every exchange. When the prices line up, nothing unusual is happening; a gap or a big volume difference is worth noticing.",
    `<h3>Bitcoin (BTC perpetual)</h3>${venueTable(pack.exchanges?.majors?.BTC || {}, priceCols)}
     <h3>Ethereum (ETH perpetual)</h3>${venueTable(pack.exchanges?.majors?.ETH || {}, priceCols)}
     ${s.priceVolumeSummary ? `<p class="say">${esc(s.priceVolumeSummary)}</p>` : ""}`);

  // 3 — positioning
  const positioning = section("02 · Positioning", "How traders were leaning",
    "Funding shows which side is paying to hold its position (positive = longs pay shorts). Open interest is how much money is in open bets. Both are shown in the same units so the venues compare.",
    `<h3>Bitcoin</h3>${venueTable(pack.exchanges?.majors?.BTC || {}, posCols)}
     <h3>Ethereum</h3>${venueTable(pack.exchanges?.majors?.ETH || {}, posCols)}
     ${s.positioningSummary ? `<p class="say">${esc(s.positioningSummary)}</p>` : ""}`);

  // 4 — movers
  const movers = pack.exchanges?.movers || [];
  const moverExpl = new Map((s.movers || []).map((m) => [m.symbol, m]));
  const moversBody = movers.length
    ? `<div class="movers">${movers.map((m) => {
        const e = moverExpl.get(m.symbol);
        const venues = Object.keys(m.venues || {}).filter((v) => m.venues[v]?.ok);
        return `<div class="m"><div><span class="sym">${esc(m.symbol)}</span> <span class="mono ${cls(m.chgPct / 100)}">${sgn(m.chgPct, 1)}</span> <span class="mono" style="color:var(--muted)">· ${fmtUSD(m.volUSD)} vol · on ${esc(venues.join(", ") || "Binance")}</span></div>${e ? `<div class="say">${esc(e.explanation)}</div>` : ""}</div>`;
      }).join("")}</div>`
    : `<p class="none">No standout movers today.</p>`;
  const moversSection = section("03 · Biggest movers", "The coins that moved the most", "The largest 24-hour moves on Binance, with the reason where the news supports one.", moversBody);

  // 5 — news
  const nTime = (n) => n.timeUTC || n.timeIstanbul || "";
  const newsItem = (n, top) => `<div class="newscard${top ? " top" : ""}"><div class="h">${esc(n.headline)}</div><div class="what">${esc(n.what)}</div><div class="meta">${n.coins ? esc(n.coins) + " · " : ""}${nTime(n) ? esc(nTime(n)) + " · " : ""}${n.url ? `<a href="${esc(n.url)}">${esc(n.source || "source")}</a>` : esc(n.source || "")}</div></div>`;
  const groups = (s.news && s.news.groups) || {};
  const groupOrder = ["Regulation and policy", "Institutional flows and ETFs", "Exchange and platform changes", "Hacks, exploits and outages", "Traditional markets", "Unconfirmed and watch items"];
  const tradfiCard = pack.tradfi?.ok
    ? `<h3>Traditional markets</h3><table><thead><tr><th>Market</th><th>Today</th><th>Note</th></tr></thead><tbody>${pack.tradfi.items.map((t) => `<tr><td><strong>${esc(t.label)}</strong></td><td><span class="mono ${cls(t.changePct / 100)}">${sgn(t.changePct)}</span></td><td style="text-align:left;color:var(--muted);font-size:10.5px">${esc(t.proxy)}</td></tr>`).join("")}</tbody></table>`
    : "";
  const newsBody =
    (s.news?.topThree?.length ? `<h3>The three that mattered most</h3>${s.news.topThree.map((n) => newsItem(n, true)).join("")}` : "") +
    groupOrder.filter((g) => (groups[g] || []).length).map((g) => `<h3>${esc(g)}</h3>${groups[g].map((n) => newsItem(n, false)).join("")}`).join("") +
    (s.etfFlows ? `<h3>ETF flows</h3><div class="newscard"><div class="what">${esc(s.etfFlows.summary)}</div><div class="meta">${esc(s.etfFlows.date || "")} · ${s.etfFlows.url ? `<a href="${esc(s.etfFlows.url)}">${esc(s.etfFlows.source || "source")}</a>` : esc(s.etfFlows.source || "")}</div></div>` : "") +
    tradfiCard +
    (!s.news?.topThree?.length && !groupOrder.some((g) => (groups[g] || []).length) && !tradfiCard ? `<p class="none">No market-moving news was confirmed in the last 24 hours${pack.sources?.newsFailed?.length ? ` (unavailable feeds: ${pack.sources.newsFailed.map((f) => f.source).join(", ")})` : ""}.</p>` : "");
  const newsSection = section("04 · Market news", "What drove the market — and what didn't", "Only causes that move prices, each with its source. Rumours and unconfirmed reports are kept separate at the end.", newsBody);

  // 6 — calendar
  const cal = pack.calendar || { today: [], week: [] };
  const calNote = new Map((s.calendarNotes || []).map((c) => [c.event, c.typicalReaction]));
  const calRow = (e) => `<div class="e"><span class="t">${esc(e.time)}</span><span style="flex:1"><strong>${esc(e.title)}</strong>${calNote.get(e.title) ? ` — <span style="color:var(--muted)">${esc(calNote.get(e.title))}</span>` : ""}</span><span class="fc">fc ${esc(e.forecast || "—")} · prev ${esc(e.previous || "—")}</span></div>`;
  const calBody =
    (cal.today.length ? `<h3>Today</h3><div class="cal">${cal.today.map(calRow).join("")}</div>` : `<p class="none">No US high-impact events scheduled today.</p>`) +
    (cal.week.length ? `<h3>Rest of the week</h3><div class="cal">${cal.week.map((e) => `<div class="e"><span class="t">${esc(e.when.split(",")[0])}</span><span style="flex:1"><strong>${esc(e.title)}</strong></span><span class="fc">${esc(e.time)}</span></div>`).join("")}</div>` : "");
  const calSection = section("05 · Scheduled events", "What's coming (UTC)", "US economic releases that tend to move crypto. A number only matters against its forecast.", calBody);

  // 7 — glossary
  const gloss = (s.glossary || []).slice().sort((a, b) => (a.term || "").localeCompare(b.term || ""));
  const glossSection = section("06 · Glossary", "Every term used today, in plain words", "",
    gloss.length ? `<div class="gloss">${gloss.map((g) => `<div class="g"><span class="term">${esc(g.term)}</span> — <span class="def">${esc(g.definition)}</span></div>`).join("")}</div>` : `<p class="none">No special terms used today.</p>`);

  const foot = `<div class="foot">Covers the UTC day ${esc(pack.coversUTC || "00:00–23:59 UTC")}. Generated ${esc(pack.generatedAtUTC || "")}. Numbers from each venue's public API; news from public reporting at generation time. Information only, not financial advice.${synth?._source ? ` · narrative: ${esc(synth._source)}` : ""}</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${cover}${priceVol}${positioning}${moversSection}${newsSection}${calSection}${glossSection}${foot}</body></html>`;
}

export { renderPdf };
