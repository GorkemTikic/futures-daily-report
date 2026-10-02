// Renders the multi-exchange daily report to HTML (and PDF via the shared Chrome path).
// Verified numbers come from the data pack; prose/news/glossary come from the synthesis.
//
// Security: the report is opened same-origin in the site's reader, so all interpolation
// is escaped (esc for text, escAttr for attributes) and every model-supplied URL is run
// through safeUrl (http/https only). The page carries a strict CSP and uses NO inline
// JavaScript (the Caveman toggle is a CSS-only <details>), so an injected string inside a
// report cannot execute or exfiltrate anything.

import { renderPdf } from "../src/pdf.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intradayPriceChart, intradayOiChart, trendChart, moversBars, fundingHeatmap, volumeProfile } from "./charts.js";

// --- report ownership badge (top-right of every page) ---
const AVATAR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "avatars");
function avatarDataUri(base) {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    try {
      const p = path.join(AVATAR_DIR, `${base}.${ext}`);
      if (fs.existsSync(p)) return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${fs.readFileSync(p).toString("base64")}`;
    } catch { /* ignore */ }
  }
  return null;
}
let _ownersBadge = null;
let _ownersBadgePrint = null;
function ownersBadge() {
  if (_ownersBadge !== null) return _ownersBadge;
  const people = [
    { name: "CS Gorkem T", file: "gorkem", ini: "GT" },
    { name: "CS Tarik O", file: "tarik", ini: "TO" },
  ];
  const inner = people.map((p) => {
    const src = avatarDataUri(p.file);
    const av = src ? `<img class="av" src="${src}" alt="">` : `<span class="av av-ini">${p.ini}</span>`;
    return `<div class="owner">${av}<span class="onm">${esc(p.name)}</span></div>`;
  }).join("");
  _ownersBadge = `<div class="owners" aria-hidden="true">${inner}</div>`;
  _ownersBadgePrint = `<div class="owners-print" aria-hidden="true">${inner}</div>`;
  return _ownersBadge;
}

// Escape text: & < > and both quote characters.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// Attribute values use the same escaping (quotes matter most here).
const escAttr = (s) => esc(s);
// Only allow http/https URLs from model-supplied fields; otherwise no link.
function safeUrl(u) {
  try { const url = new URL(String(u)); return url.protocol === "http:" || url.protocol === "https:" ? url.href : null; }
  catch { return null; }
}

function fmtUSD(x) {
  if (x == null || !isFinite(x)) return "—";
  if (Math.abs(x) >= 1e12) return "$" + (x / 1e12).toFixed(2) + "T";
  if (Math.abs(x) >= 1e9) return "$" + (x / 1e9).toFixed(2) + "B";
  if (Math.abs(x) >= 1e6) return "$" + (x / 1e6).toFixed(0) + "M";
  if (Math.abs(x) >= 1e3) return "$" + (x / 1e3).toFixed(0) + "K";
  return "$" + x.toFixed(0);
}
function fmtPrice(x) {
  if (x == null || !isFinite(x)) return "—";
  if (Math.abs(x) >= 100) return "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (Math.abs(x) >= 1) return "$" + x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return "$" + x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
function fmtPct(x, dp = 1) { return x == null || !isFinite(x) ? "—" : x.toFixed(dp) + "%"; }
function fmtShortDate(d) { try { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); } catch { return d; } }
function fngColor(v) { if (v <= 25) return "var(--neg)"; if (v <= 45) return "var(--amb)"; if (v <= 55) return "var(--muted)"; if (v <= 75) return "var(--pos)"; return "#16a34a"; }
const sgn = (x, dp = 2) => x == null || !isFinite(x) ? "—" : (x >= 0 ? "+" : "") + x.toFixed(dp) + "%";
const fmtRatio = (x) => x == null || !isFinite(x) ? "—" : x.toFixed(2);
// Colour by a PERCENT value against a named per-column threshold (item 31). All callers
// pass percent (e.g. 3.5 means 3.5%), never fractions.
const cls = (x, t = 2) => x == null || !isFinite(x) ? "" : x > t ? "grn" : x < -t ? "red" : "";
const TH = { price: 2, funding: 10, stocks: 1, tradfi: 1 };

const LOCALE = { en: "en-GB", tr: "tr-TR", zh: "zh-CN" };
function createFmt(lang) {
  const loc = LOCALE[lang] || "en-GB";
  const nfInt = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const _pf = {};
  const pf = (dp) => _pf[dp] || (_pf[dp] = new Intl.NumberFormat(loc, { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const price24 = new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const price26 = new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return {
    fmtUSD(x) {
      if (x == null || !isFinite(x)) return "—";
      if (Math.abs(x) >= 1e12) return "$" + nf2.format(x / 1e12) + "T";
      if (Math.abs(x) >= 1e9) return "$" + nf2.format(x / 1e9) + "B";
      if (Math.abs(x) >= 1e6) return "$" + nfInt.format(Math.round(x / 1e6)) + "M";
      if (Math.abs(x) >= 1e3) return "$" + nfInt.format(Math.round(x / 1e3)) + "K";
      return "$" + nfInt.format(Math.round(x));
    },
    fmtPrice(x) {
      if (x == null || !isFinite(x)) return "—";
      if (Math.abs(x) >= 100) return "$" + nf2.format(x);
      if (Math.abs(x) >= 1) return "$" + price24.format(x);
      return "$" + price26.format(x);
    },
    fmtPct(x, dp = 1) { return x == null || !isFinite(x) ? "—" : pf(dp).format(x) + "%"; },
    sgn(x, dp = 2) { return x == null || !isFinite(x) ? "—" : (x >= 0 ? "+" : "") + pf(dp).format(x) + "%"; },
    fmtRatio(x) { return x == null || !isFinite(x) ? "—" : nf2.format(x); },
    fmtShortDate(d) { try { return new Date(d + "T00:00:00Z").toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); } catch { return d; } },
  };
}

const STYLE = `
  @page { size: A4; margin: 15mm 14mm 16mm; }
  :root{--ink:#14181d;--ink2:#39414b;--muted:#6b727c;--faint:#9aa1ab;--accent:#c2410c;--accent-ink:#9a3409;--accent-soft:#fbeee6;--accent-line:#eecab2;--line:#e8eaee;--line2:#f0f2f5;--card:#f7f8fa;--pos:#0f8a4f;--pos-soft:#e7f4ec;--neg:#c62b3f;--neg-soft:#fbe9eb;--amb:#b45309;--info:#6d51d6;}
  *{margin:0;padding:0;box-sizing:border-box;}
  html{background:#fff;} body{font-family:'Segoe UI',-apple-system,'Helvetica Neue',Arial,'Microsoft YaHei','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif;background:#fff;color:var(--ink2);color-scheme:light;font-size:12px;line-height:1.6;-webkit-font-smoothing:antialiased;}
  @media screen{ body{font-size:14px;padding:44px 56px;} h1{font-size:38px;} h2{font-size:22px;} table{font-size:13px;} .lead{font-size:17px;} .section{padding-bottom:30px;margin-bottom:30px;border-bottom:1px solid var(--line2);} .section:last-child{border-bottom:none;} }
  .mono{font-family:'SF Mono','Consolas',monospace;font-variant-numeric:tabular-nums;}
  strong{color:var(--ink);font-weight:650;}
  .cover-band{display:flex;align-items:center;gap:12px;padding-bottom:16px;margin-bottom:22px;border-bottom:1px solid var(--line);position:relative;}
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
  .banner{border-radius:10px;padding:11px 15px;margin:0 0 18px;font-size:12px;font-weight:600;}
  .banner.warn{background:#fdf3e7;border:1px solid #f0d3a8;color:#8a5a12;}
  .note-line{font-size:11px;color:var(--amb);margin:4px 0 10px;font-weight:600;}
  table{width:100%;border-collapse:collapse;font-size:11.5px;margin:6px 0 12px;}
  th{text-align:right;color:var(--muted);font-weight:700;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;padding:0 10px 7px;border-bottom:1px solid var(--line);}
  th:first-child{text-align:left;} td{padding:8px 10px;border-bottom:1px solid var(--line2);text-align:right;} td:first-child{text-align:left;}
  tr:last-child td{border-bottom:none;} tbody tr.lead-row td{background:var(--card);}
  .grn{color:var(--pos);font-weight:650;} .red{color:var(--neg);font-weight:650;} .amb{color:var(--amb);font-weight:650;}
  .say{font-size:12.5px;color:var(--ink2);margin:8px 0 4px;line-height:1.55;}
  .foot-note{font-size:10px;color:var(--muted);margin:2px 0 6px;}
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
  .stats-bar{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px;}
  .stat{flex:1 1 120px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 13px;min-width:0;}
  .stat .sl{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);}
  .stat .sv{font-size:18px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums;margin-top:2px;}
  .stat .sd{font-size:10.5px;color:var(--muted);font-weight:600;}
  .fng-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle;}
  .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:6px 0 12px;}
  .table-wrap table{margin:0;min-width:540px;}
  .sym-raw{color:var(--faint);font-family:'SF Mono','Consolas',monospace;}
  .alt-tbl td:first-child{white-space:nowrap;}
  .sess{font-size:10.5px;color:var(--muted);font-weight:600;margin:0 0 6px;}
  .sess.closed{color:var(--amb);}
  .gloss{columns:2;column-gap:26px;} @media screen{.gloss{column-gap:40px;}}
  .regime-badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:3px 10px;border-radius:8px;margin-left:12px;vertical-align:middle;background:var(--card);border:1px solid var(--line);color:var(--muted);}
  @media(max-width:640px){body{padding:20px 16px !important;} h1{font-size:26px !important;} .stats-bar{gap:8px;} .stat{flex:1 1 45%;} .stat .sv{font-size:15px;} .sym-raw{display:none;} .gloss{columns:1;} table{font-size:11px;} .regime-badge{display:block;margin:6px 0 0;font-size:10px;}}
  .vs{margin:6px 0 14px;} .vs-ref{display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:4px;} .vs-ref .vp{font-size:22px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums;} .vs-ref .vc{font-size:16px;font-weight:700;} .vs-hl{font-size:12px;color:var(--muted);font-weight:600;} .vs-meta{display:flex;flex-wrap:wrap;gap:14px;font-size:11.5px;color:var(--muted);margin:2px 0 8px;} .vs-meta strong{color:var(--ink);} .vs-dist{margin:2px 0 6px;} .vs-bar-row{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;} .vs-bar-row .vn{width:52px;font-weight:700;color:var(--ink);flex-shrink:0;font-size:10.5px;} .vs-bar-row .vb{flex:1;height:12px;background:var(--line2);border-radius:3px;overflow:hidden;} .vs-bar-row .vb div{height:100%;background:var(--accent);border-radius:3px;} .vs-bar-row .vv{width:64px;text-align:right;font-weight:600;color:var(--ink2);font-size:10.5px;} .vs-bar-row .vpct{width:36px;text-align:right;color:var(--muted);font-size:10px;}
  @media(max-width:640px){.vs-ref .vp{font-size:18px;} .vs-bar-row .vn{width:44px;} .vs-bar-row .vv{width:54px;}}
  .wtw{margin:8px 0;padding:12px 15px;background:#fef7ed;border:1px solid #f5d6a7;border-radius:10px;} .wtw-h{font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--amb);margin-bottom:6px;} .wtw-item{font-size:12px;color:var(--ink2);padding:4px 0;border-bottom:1px solid #f5e8d4;} .wtw-item:last-child{border-bottom:none;}
  .gloss .g{break-inside:avoid;margin-bottom:11px;} .gloss .term{font-weight:700;color:var(--ink);font-size:12px;} .gloss .def{font-size:11.5px;color:var(--ink2);}
  .chart-row{display:flex;gap:16px;margin:10px 0 16px;flex-wrap:wrap;} .chart-row>div{flex:1 1 240px;min-width:0;}
  .chart-pair{margin:8px 0 14px;} .chart-pair svg{display:block;margin:0 auto;}
  .trend-row{display:flex;gap:12px;margin:8px 0 14px;flex-wrap:wrap;} .trend-row>div{flex:1 1 200px;min-width:0;background:var(--card);border:1px solid var(--line2);border-radius:8px;padding:8px 10px;}
  @media print{
    .page-break{page-break-before:always;padding-top:6mm;}
    .page-foot{position:fixed;bottom:4mm;left:14mm;right:14mm;font-size:8px;color:var(--faint);display:flex;justify-content:space-between;border-top:0.5px solid var(--line2);padding-top:3px;}
  }
  @media screen{.page-break{margin-top:36px;padding-top:20px;border-top:2px solid var(--line);} .page-foot{display:none;}}
  .foot{margin-top:22px;padding-top:11px;border-top:1px solid var(--line);font-size:10px;color:var(--faint);}
  .none{font-size:12px;color:var(--muted);font-style:italic;}
  details.caveman{margin:2px 0 20px;}
  .caveman-btn{display:inline-flex;align-items:center;gap:8px;cursor:pointer;list-style:none;background:#3a2f26;color:#f6ead8;font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.01em;padding:11px 18px;border-radius:12px;box-shadow:0 2px 0 #241c15;}
  .caveman-btn::-webkit-details-marker{display:none;}
  .caveman-btn:hover{background:#4a3c2f;}
  .caveman-box{background:#f4ead6;border:2px solid #dcc7a2;border-radius:14px;padding:16px 20px 20px;margin:12px 0 0;box-shadow:0 3px 14px rgba(72,54,30,0.10);}
  .caveman-box .ch{font-size:10.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#957338;margin-bottom:9px;}
  .caveman-box p{font-size:18px;line-height:1.62;color:#4a3823;margin:0;font-weight:500;}
  @media screen{ .caveman-btn{font-size:14px;} .caveman-box p{font-size:20px;} }
  @media print{ .caveman-btn{display:none;} details.caveman > .caveman-box{display:block;} }
  .owners{margin-left:auto;display:flex;flex-direction:row;flex-wrap:wrap;justify-content:flex-end;gap:8px;align-items:center;flex-shrink:0;}
  .owner{display:flex;align-items:center;gap:7px;padding:3px 12px 3px 3px;border:1px solid var(--line);border-radius:999px;background:var(--card);}
  .owner .av{width:28px;height:28px;border-radius:50%;object-fit:cover;border:1px solid var(--accent-line);background:var(--card);}
  .owner .av-ini{display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;background:var(--accent);letter-spacing:.02em;}
  .owner .onm{font-size:10px;font-weight:650;color:var(--ink2);white-space:nowrap;letter-spacing:.01em;}
  @media screen{ .owner .av{width:34px;height:34px;} .owner .onm{font-size:12.5px;} }
  .owners-print{display:none;}
  @media print{ .owners{display:none !important;} .owners-print{position:fixed;top:4mm;right:7mm;display:flex;flex-direction:column;gap:2px;align-items:flex-end;} .owners-print .owner{display:flex;align-items:center;gap:4px;} .owners-print .av{width:16px;height:16px;border-radius:50%;object-fit:cover;border:1px solid var(--accent-line);} .owners-print .av-ini{display:inline-flex;align-items:center;justify-content:center;font-size:7px;font-weight:800;color:#fff;background:var(--accent);width:16px;height:16px;border-radius:50%;} .owners-print .onm{font-size:7.5px;font-weight:700;color:var(--muted);white-space:nowrap;} }
`;

export const LANGS = ["en", "tr", "zh"];
// The fixed news-group headings + the numbered section list — kept in sync with the
// synthesis prompt and REPORT_SPEC.md by test/spec-consistency.mjs (item 37).
export const GROUP_KEYS = ["Regulation and policy", "Institutional flows and ETFs", "Exchange and platform changes", "Hacks, exploits and outages", "Traditional markets", "Unconfirmed and watch items"];
export const SECTION_KEYS = ["price", "pos", "movers", "stocks", "news", "cal", "gloss"];

const LABELS = {
  en: {
    tagline: "Crypto futures across the major venues · daily", daily: "Daily market report",
    dataFrom: "all times UTC · data from Binance, Bybit, OKX, Bitget, Gate", oneLine: "The day in one line",
    caveman: "🦴 Caveman mode", cavemanTitle: "🗿 The day, explained simply",
    asOf: "as of", pointInTime: (t) => `Funding, open interest and mark price are point-in-time (${t}), not daily figures.`,
    rollingNote: (end) => `Figures cover the rolling 24 hours to ${end}, not the full calendar day.`,
    volApprox: "≈ volume estimated on a different basis; not directly comparable.",
    rollingRow: "† this venue's UTC-day candle was unavailable — its figures are the rolling 24 hours.",
    degraded: "Some sources were unavailable for this run, so parts of this report are missing:",
    price: ["01 · Price & volume", "What every venue's price and volume did", "The same two contracts on every exchange, for this UTC day. When the prices line up, nothing unusual is happening; a gap or a big volume difference is worth noticing."],
    pos: ["02 · Positioning", "How traders were leaning", "Funding shows which side is paying to hold its position (positive = longs pay shorts). Open interest is how much money is in open bets; its change over the day shows money coming in or out. Long/short is how many accounts lean each way. Top L/S is the ratio among the largest traders. Taker B/S is the buy-to-sell ratio of market orders."],
    movers: ["03 · Biggest movers", "The coins that moved the most", "The largest moves on Binance for this UTC day, with the reason where the news supports one."],
    stocks: ["04 · Stocks & commodities on Binance Futures", "Equities and commodities traded on Binance", "Binance lists tokenised perpetuals for stocks (Korea, Hong Kong, China and the US) and commodities. The perp trades nearly around the clock, but the underlying market is open only a few hours — when it was closed, that is noted instead of showing drift as a daily move."],
    news: ["05 · Market news", "What drove the market — and what didn't", "Only causes that move prices, each with its source. Rumours and unconfirmed reports are kept separate at the end."],
    cal: ["06 · Scheduled events", "What happened and what's coming (UTC)", "US economic releases that tend to move crypto. A number only matters against its forecast."],
    gloss: ["07 · Glossary", "Every term used today, in plain words", ""],
    col: { venue: "Venue", last: "Close", chg: "Change", high: "High", low: "Low", vol: "Volume", funding: "Funding (ann.)", oi: "Open interest", oiChg: "OI change", ls: "Long/short", topLs: "Top L/S", taker: "Taker B/S", mark: "Mark", stock: "Stock", commodity: "Commodity", market: "Market", session: "Session", actual: "Actual", fc: "Forecast", prev: "Previous", time: "Time", event: "Event", note: "Note" },
    h3: { btcP: "Bitcoin (BTC perpetual)", ethP: "Ethereum (ETH perpetual)", btc: "Bitcoin", eth: "Ethereum", usMov: "United States — biggest movers", usVol: "United States — most traded", comm: "Commodities", tradfi: "Traditional markets", top3: "The three that mattered most", etf: "ETF flows", reportDay: "On the report day", next24h: "Next 24 hours", rest: "Rest of the week", lowLiq: "Newly listed / low-liquidity movers" },
    chart: { oi: "Open Interest", funding: "Funding Rate (annualised)", hourlyVol: "Hourly Volume", moversQuad: "Biggest movers — 24h change and trading volume", moversNote: "Low volume means a few trades can move the price a lot.", thinTag: "low liquidity", takerBs: "Taker B/S" },
    mkt: { KR_EQUITY: "Korea", HK_EQUITY: "Hong Kong", CN_EQUITY: "China", EQUITY: "US", COMMODITY: "Commodities", PREMARKET: "Pre-market" },
    grp: ["Regulation and policy", "Institutional flows and ETFs", "Exchange and platform changes", "Hacks, exploits and outages", "Traditional markets", "Unconfirmed and watch items"],
    sess: { weekend: "weekend — no cash session", holiday: (n) => `market closed (${n})`, closedGeneric: "cash market was closed — the perp figures are drift only" },
    stocksClosed: "All stock and commodity markets were closed this day (weekend or holiday). Only commodity perp data is shown below; stock perp drift is omitted.",
    source: "source", vol: "vol", on: "on", lsLine: "Long/short accounts", oiChangeLine: "Open-interest change over the day",
    mktCap: "Total market cap", btcDom: "BTC dominance", ethDom: "ETH dominance", fng: "Fear & Greed",
    breadth: "Market breadth", breadthDesc: (u, d) => `${u} up / ${d} down`,
    altcoinsH: "Altcoins", coin: "Coin",
    regime: { strongBull: "Strong bullish", bull: "Bullish", neutral: "Neutral / mixed", bear: "Bearish", strongBear: "Strong bearish" },
    spread: "Spread", totalVol: "Total volume", whatToWatch: "What to watch",
    none: { movers: "No standout movers today.", stocks: "Stock & commodity data was unavailable this run.", news: "No market-moving news was confirmed for this day", cal: "No US high-impact events on the report day.", gloss: "No special terms used today.", venue: "No venue data available." },
    methodology: ["08 · Methodology", "How this report is built", ""],
    methText: "Price and volume from each venue's daily (1d) kline bounded to the UTC day. Funding, open interest and mark price are point-in-time snapshots. Long/short and taker ratios from Binance. Market cap and dominance from CoinGecko. Fear & Greed from Alternative.me. News from public RSS feeds, verified via web search. Calendar from Investing.com. Traditional markets from Twelve Data.",
    methSources: "Sources",
    foot: (c, g, src) => `Covers the UTC day ${c}. Generated ${g}. Numbers from each venue's public API; news from public reporting at generation time. Information only, not financial advice.${src}`,
  },
  tr: {
    tagline: "Başlıca borsalarda kripto vadeli işlemler · günlük", daily: "Günlük piyasa raporu",
    dataFrom: "tüm saatler UTC · veriler: Binance, Bybit, OKX, Bitget, Gate", oneLine: "Günün özeti tek cümlede",
    caveman: "🦴 Mağara adamı modu", cavemanTitle: "🗿 Günün en basit anlatımı",
    asOf: "itibarıyla", pointInTime: (t) => `Fonlama, açık pozisyon ve mark fiyatı anlık değerlerdir (${t}), günlük rakam değildir.`,
    rollingNote: (end) => `Rakamlar tam takvim gününü değil, ${end} itibarıyla son 24 saati kapsar.`,
    volApprox: "≈ hacim farklı bir bazda tahmin edildi; doğrudan karşılaştırılamaz.",
    rollingRow: "† bu borsanın UTC-günü mumu alınamadı — rakamları son 24 saati kapsar.",
    degraded: "Bu çalışmada bazı kaynaklar alınamadı, bu nedenle raporun bazı bölümleri eksik:",
    price: ["01 · Fiyat ve hacim", "Her borsada fiyat ve hacim ne yaptı", "Aynı iki sözleşme her borsada, bu UTC günü için. Fiyatlar birbirini tutuyorsa olağandışı bir şey yok; borsalar arası fark ya da büyük hacim farkı dikkat çeker."],
    pos: ["02 · Pozisyonlanma", "Yatırımcılar hangi yöne yaslanıyordu", "Fonlama, pozisyonu taşımak için hangi tarafın ödeme yaptığını gösterir (pozitif = long'lar short'lara öder). Açık pozisyon (OI), açık işlemlerdeki toplam paradır; gün içindeki değişimi paranın giriş/çıkışını gösterir. Long/short, kaç hesabın hangi yöne yaslandığıdır. Üst L/S en büyük yatırımcıların oranıdır. Alıcı B/S piyasa emirlerinin al/sat oranıdır."],
    movers: ["03 · En çok hareket edenler", "En çok hareket eden coin'ler", "Binance'te bu UTC günündeki en büyük hareketler; haber bir sebep destekliyorsa onunla birlikte."],
    stocks: ["04 · Binance Futures'ta hisseler ve emtialar", "Binance'te işlem gören hisseler ve emtialar", "Binance; hisseler (Kore, Hong Kong, Çin ve ABD) ile emtialar için tokenize vadeli sözleşmeler listeler. Vadeli neredeyse 7/24 işlem görür, ama dayanak piyasa günde yalnızca birkaç saat açıktır — kapalıyken, sürüklenme günlük hareket gibi gösterilmez, bu durum not edilir."],
    news: ["05 · Piyasa haberleri", "Piyasayı ne hareket ettirdi — ve ne ettirmedi", "Yalnızca fiyatı hareket ettiren sebepler, her biri kaynağıyla. Söylentiler ve teyit edilmemiş haberler en sonda ayrı tutulur."],
    cal: ["06 · Takvim", "Ne oldu ve sırada ne var (UTC)", "Kriptoyu hareket ettirme eğilimindeki ABD ekonomik verileri. Bir rakam ancak beklentiyle kıyaslandığında anlam taşır."],
    gloss: ["07 · Sözlük", "Bugün kullanılan her terim, sade bir dille", ""],
    col: { venue: "Borsa", last: "Kapanış", chg: "Değişim", high: "Yüksek", low: "Düşük", vol: "Hacim", funding: "Fonlama (yıllık)", oi: "Açık pozisyon", oiChg: "OI değişimi", ls: "Long/short", topLs: "Üst L/S", taker: "Alıcı B/S", mark: "Mark", stock: "Hisse", commodity: "Emtia", market: "Piyasa", session: "Seans", actual: "Gerçekleşen", fc: "Beklenti", prev: "Önceki", time: "Saat", event: "Olay", note: "Not" },
    h3: { btcP: "Bitcoin (BTC vadeli)", ethP: "Ethereum (ETH vadeli)", btc: "Bitcoin", eth: "Ethereum", usMov: "ABD — en çok hareket edenler", usVol: "ABD — en çok işlem görenler", comm: "Emtialar", tradfi: "Geleneksel piyasalar", top3: "En önemli üç haber", etf: "ETF para akışları", reportDay: "Rapor gününde", next24h: "Önümüzdeki 24 saat", rest: "Haftanın geri kalanı", lowLiq: "Yeni listelenen / düşük likiditeli hareketler" },
    chart: { oi: "Açık Pozisyon", funding: "Fonlama Oranı (yıllık)", hourlyVol: "Saatlik Hacim", moversQuad: "En çok hareket edenler — 24 saatlik değişim ve işlem hacmi", moversNote: "Hacim düşükse birkaç işlem fiyatı çok oynatabilir.", thinTag: "düşük likidite", takerBs: "Alıcı B/S" },
    mkt: { KR_EQUITY: "Kore", HK_EQUITY: "Hong Kong", CN_EQUITY: "Çin", EQUITY: "ABD", COMMODITY: "Emtialar", PREMARKET: "Halka arz öncesi" },
    grp: ["Düzenleme ve politika", "Kurumsal akışlar ve ETF'ler", "Borsa ve platform değişiklikleri", "Saldırılar, açıklar ve kesintiler", "Geleneksel piyasalar", "Teyit edilmemiş ve izlenecekler"],
    sess: { weekend: "hafta sonu — nakit seans yok", holiday: (n) => `piyasa kapalı (${n})`, closedGeneric: "nakit piyasa kapalıydı — vadeli rakamlar yalnızca sürüklenmedir" },
    stocksClosed: "Tüm hisse ve emtia piyasaları bu gün kapalıydı (hafta sonu veya tatil). Yalnızca emtia vadeli verileri aşağıda gösterilmektedir; hisse vadeli sürüklenmesi atlanmıştır.",
    source: "kaynak", vol: "hacim", on: "borsalar:", lsLine: "Long/short hesap oranı", oiChangeLine: "Gün içinde açık pozisyon değişimi",
    mktCap: "Toplam piyasa değeri", btcDom: "BTC hakimiyeti", ethDom: "ETH hakimiyeti", fng: "Korku ve Açgözlülük",
    breadth: "Piyasa genişliği", breadthDesc: (u, d) => `${u} yükseliş / ${d} düşüş`,
    altcoinsH: "Altcoin'ler", coin: "Coin",
    regime: { strongBull: "Güçlü yükseliş", bull: "Yükseliş", neutral: "Nötr / karışık", bear: "Düşüş", strongBear: "Güçlü düşüş" },
    spread: "Fark", totalVol: "Toplam hacim", whatToWatch: "Dikkat edilecekler",
    none: { movers: "Bugün öne çıkan bir hareket yok.", stocks: "Bu çalışmada hisse ve emtia verisi alınamadı.", news: "Bu gün için piyasayı hareket ettiren teyitli haber yok", cal: "Rapor gününde yüksek etkili ABD verisi yok.", gloss: "Bugün özel terim kullanılmadı.", venue: "Borsa verisi yok." },
    methodology: ["08 · Metodoloji", "Bu rapor nasıl hazırlanır", ""],
    methText: "Fiyat ve hacim her borsanın UTC gününe bağlı günlük (1d) K-çizgisinden alınır. Fonlama, açık pozisyon ve mark fiyatı anlık verilerdir. Long/short ve alıcı oranları Binance'den gelir. Piyasa değeri ve hakimiyet CoinGecko'dan, Korku ve Açgözlülük Alternative.me'den alınır. Haberler kamuya açık RSS kaynaklarından toplanır ve web araması ile doğrulanır. Takvim Investing.com'dan, geleneksel piyasalar Twelve Data'dan sağlanır.",
    methSources: "Kaynaklar",
    foot: (c, g, src) => `${c} UTC gününü kapsar. Oluşturulma: ${g}. Rakamlar her borsanın herkese açık API'sinden; haberler oluşturma anındaki kamuya açık kaynaklardan. Yalnızca bilgi amaçlıdır, yatırım tavsiyesi değildir.${src}`,
  },
  zh: {
    tagline: "主要交易所加密货币期货 · 每日", daily: "每日市场报告",
    dataFrom: "均为 UTC 时间 · 数据来自 Binance、Bybit、OKX、Bitget、Gate", oneLine: "一句话看今天",
    caveman: "🦴 原始人模式", cavemanTitle: "🗿 用最简单的话讲今天",
    asOf: "截至", pointInTime: (t) => `资金费率、未平仓量和标记价为时点数据(${t}),并非全天数据。`,
    rollingNote: (end) => `数据覆盖截至 ${end} 的滚动 24 小时,而非完整自然日。`,
    volApprox: "≈ 成交量以不同口径估算,不能直接比较。",
    rollingRow: "† 该交易所的 UTC 日 K 线不可用 —— 其数字为滚动 24 小时。",
    degraded: "本次运行有部分来源不可用,因此报告的部分内容缺失:",
    price: ["01 · 价格与成交量", "各交易所的价格和成交量表现", "同样两个合约在每个交易所,针对该 UTC 日。价格一致说明没有异常;交易所之间的价差或成交量差异值得留意。"],
    pos: ["02 · 持仓情况", "交易者偏向哪一方", "资金费率显示哪一方为持仓付费(正值=多头付给空头)。未平仓合约(OI)是未平仓头寸中的资金量;其当日变化显示资金流入或流出。多空比是多少账户偏向哪一方。大户多空是大户的持仓比。主买/主卖是市价单的买卖比。"],
    movers: ["03 · 涨跌最大的币", "波动最大的币种", "Binance 上该 UTC 日的最大波动;若有新闻可解释,一并给出原因。"],
    stocks: ["04 · 币安期货上的股票与商品", "在币安交易的股票与商品", "币安为股票(韩国、香港、中国和美国)以及商品提供代币化永续合约。永续合约几乎全天交易,但标的市场每天只开盘几个小时——当其休市时,不会把漂移当作当日涨跌,而是加以标注。"],
    news: ["05 · 市场新闻", "是什么推动了市场——又有什么没有", "只列出能推动价格的原因,每条都附来源。传闻和未经证实的消息单独放在最后。"],
    cal: ["06 · 日程", "发生了什么以及接下来有什么(UTC)", "往往会影响加密货币的美国经济数据。一个数字只有对照预期才有意义。"],
    gloss: ["07 · 术语表", "今天用到的每个术语,用大白话解释", ""],
    col: { venue: "交易所", last: "收盘", chg: "涨跌", high: "最高", low: "最低", vol: "成交量", funding: "资金费率(年化)", oi: "未平仓量", oiChg: "OI 变化", ls: "多空比", topLs: "大户多空", taker: "主买/主卖", mark: "标记价", stock: "股票", commodity: "商品", market: "市场", session: "交易时段", actual: "实际值", fc: "预期", prev: "前值", time: "时间", event: "事件", note: "备注" },
    h3: { btcP: "比特币(BTC 永续)", ethP: "以太坊(ETH 永续)", btc: "比特币", eth: "以太坊", usMov: "美国 — 涨跌最大", usVol: "美国 — 成交最活跃", comm: "商品", tradfi: "传统市场", top3: "最重要的三条", etf: "ETF 资金流", reportDay: "报告当日", next24h: "未来 24 小时", rest: "本周剩余日程", lowLiq: "新上市 / 低流动性波动" },
    chart: { oi: "未平仓量", funding: "资金费率(年化)", hourlyVol: "每小时成交量", moversQuad: "涨跌最大的合约 — 24 小时涨跌幅与成交额", moversNote: "成交额低意味着少量交易就能大幅推动价格。", thinTag: "低流动性", takerBs: "主买/主卖" },
    mkt: { KR_EQUITY: "韩国", HK_EQUITY: "香港", CN_EQUITY: "中国", EQUITY: "美国", COMMODITY: "商品", PREMARKET: "上市前" },
    grp: ["监管与政策", "机构资金与 ETF", "交易所与平台变动", "攻击、漏洞与宕机", "传统市场", "未证实与待观察"],
    sess: { weekend: "周末 — 无现货交易", holiday: (n) => `市场休市(${n})`, closedGeneric: "现货市场休市 — 永续数据仅为漂移" },
    stocksClosed: "所有股票和商品市场在此日均休市(周末或假日)。下方仅显示商品永续数据;股票永续漂移已省略。",
    source: "来源", vol: "成交", on: "交易所:", lsLine: "多空账户比", oiChangeLine: "当日未平仓量变化",
    mktCap: "总市值", btcDom: "BTC 占比", ethDom: "ETH 占比", fng: "恐惧与贪婪",
    breadth: "市场广度", breadthDesc: (u, d) => `${u} 上涨 / ${d} 下跌`,
    altcoinsH: "山寨币", coin: "币种",
    regime: { strongBull: "强势看涨", bull: "看涨", neutral: "中性 / 混合", bear: "看跌", strongBear: "强势看跌" },
    spread: "价差", totalVol: "总成交量", whatToWatch: "值得关注",
    none: { movers: "今天没有特别突出的波动。", stocks: "本次运行未能获取股票和商品数据。", news: "本日没有证实的、能推动市场的新闻", cal: "报告当日没有高影响的美国数据。", gloss: "今天没有用到特别术语。", venue: "暂无交易所数据。" },
    methodology: ["08 · 方法论", "本报告的数据来源与方法", ""],
    methText: "价格和成交量来自各交易所 UTC 日 K 线。资金费率、未平仓量和标记价为时点快照。多空比和主买/卖比来自 Binance。总市值和占比来自 CoinGecko。恐惧与贪婪指数来自 Alternative.me。新闻来自公开 RSS 源,经网络搜索验证。日程来自 Investing.com。传统市场来自 Twelve Data。",
    methSources: "数据来源",
    foot: (c, g, src) => `覆盖 UTC 日 ${c}。生成时间:${g}。数字来自各交易所公开 API;新闻来自生成时的公开报道。仅供参考,不构成投资建议。${src}`,
  },
};

function localDate(dateUTC, lang) {
  try { return new Date(dateUTC + "T00:00:00Z").toLocaleDateString(LOCALE[lang] || "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); }
  catch (e) { return dateUTC; }
}
function sessionText(L, status) {
  if (!status || status.hadSession === null || status.hadSession === true) return "";
  if (status.reason === "weekend") return L.sess.weekend;
  if (status.reason === "holiday") return L.sess.holiday(status.holiday || "");
  return L.sess.closedGeneric;
}

export function buildReportHtml(pack, synth, lang = "en", health = null) {
  const s = synth || {};
  const L = LABELS[lang] || LABELS.en;
  const { fmtUSD, fmtPrice, fmtPct, sgn, fmtRatio, fmtShortDate } = createFmt(lang);
  const dateHeading = pack.dateUTC ? localDate(pack.dateUTC, lang) : (pack.dateLong || "");
  const grpLabel = (g) => { const i = GROUP_KEYS.indexOf(g); return i >= 0 ? L.grp[i] : g; };
  const asOf = pack.asOfUTC ? `${L.asOf} ${pack.asOfUTC}` : "";

  const posCols = [
    { h: L.col.venue, f: (r) => `<strong>${esc(r.venue)}</strong>` },
    { h: L.col.funding, f: (r) => `<span class="mono ${cls(r.fundingAnnPct, TH.funding)}">${sgn(r.fundingAnnPct, 1)}</span>` },
    { h: L.col.oi, f: (r) => `<span class="mono">${fmtUSD(r.oiUSD)}</span>` },
    { h: L.col.oiChg, f: (r) => { const v = r.oiChangePctCoins ?? r.oiChangePct; return `<span class="mono ${cls(v, TH.price)}">${v != null ? sgn(v, 1) : "—"}</span>`; } },
    { h: L.col.ls, f: (r) => `<span class="mono">${fmtRatio(r.longShortAccount)}</span>` },
    { h: L.col.topLs, f: (r) => `<span class="mono">${fmtRatio(r.topPositionRatio)}</span>` },
    { h: L.col.taker, f: (r) => `<span class="mono">${r.takerBuySellRatio != null ? fmtRatio(r.takerBuySellRatio) : "—"}</span>` },
    { h: L.col.mark, f: (r) => `<span class="mono">${fmtPrice(r.mark)}</span>` },
  ];
  const section = (a, body) => `<div class="section"><div class="kicker">${esc(a[0])}</div><h2>${esc(a[1])}</h2>${a[2] ? `<p class="intro">${esc(a[2])}</p>` : ""}${body}</div>`;
  const noneP = (t) => `<p class="none">${esc(t)}</p>`;
  const venueTableL = (obj, cols) => { const rows = Object.values(obj).filter((r) => r && r.ok); if (!rows.length) return noneP(L.none.venue); return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c.h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => "<tr>" + cols.map((c) => `<td>${c.f(r)}</td>`).join("") + "</tr>").join("")}</tbody></table></div>`; };
  const anyApprox = (obj) => Object.values(obj).some((r) => r && r.ok && r.volBasis === "approx");

  const mkt = pack.market || {};
  const br = pack.exchanges?.breadth;

  // C1: market regime label from data signals
  const btcChg = (Object.values(pack.exchanges?.majors?.BTC || {}).find((r) => r && r.ok) || {}).chgPct;
  const fngVal = mkt.ok && mkt.fearGreed ? mkt.fearGreed.value : null;
  const brUp = br?.upPct;
  let regime = null;
  if (btcChg != null) {
    const bull = (btcChg > 2 ? 2 : btcChg > 0.5 ? 1 : 0) + (fngVal > 60 ? 1 : 0) + (brUp > 55 ? 1 : 0);
    const bear = (btcChg < -2 ? 2 : btcChg < -0.5 ? 1 : 0) + (fngVal != null && fngVal < 35 ? 1 : 0) + (brUp != null && brUp < 40 ? 1 : 0);
    if (bull >= 3) regime = L.regime?.strongBull || "Strong bullish";
    else if (bear >= 3) regime = L.regime?.strongBear || "Strong bearish";
    else if (bull >= 2) regime = L.regime?.bull || "Bullish";
    else if (bear >= 2) regime = L.regime?.bear || "Bearish";
    else regime = L.regime?.neutral || "Neutral / mixed";
  }
  const regimeBadge = regime ? `<span class="regime-badge">${esc(regime)}</span>` : "";

  // honesty banners
  const degradedBanner = health && health.status === "degraded" && (health.reasons || []).length
    ? `<div class="banner warn">${esc(L.degraded)} ${esc((health.reasons || []).join(" · "))}</div>` : "";
  const rollingNote = pack.rolling ? `<div class="note-line">${esc(L.rollingNote(pack.asOfUTC || ""))}</div>` : "";

  const cover = `
    <div class="cover-band"><div class="cover-mark">FD</div><div class="cover-brand">Futures Daily Report<span>${esc(L.tagline)}</span></div>${ownersBadge()}</div>
    <div class="kicker">${esc(L.daily)}</div>
    <h1>${esc(dateHeading)}${regimeBadge}</h1>
    <div class="date">${esc(pack.coversUTC || "00:00–23:59 UTC")} · ${esc(L.dataFrom)}${pack.tradfi?.ok ? " + Twelve Data" : ""}</div>
    ${degradedBanner}${rollingNote}
    <div class="oneline"><div class="k">${esc(L.oneLine)}</div><p>${esc(s.oneLine || "—")}</p></div>`;
  const statsBar = (mkt.ok || br) ? `<div class="stats-bar">${
    mkt.ok && mkt.totalMarketCap != null ? `<div class="stat"><div class="sl">${esc(L.mktCap)}</div><div class="sv">${fmtUSD(mkt.totalMarketCap)}</div>${mkt.totalMarketCapChange24h != null ? `<div class="sd mono ${cls(mkt.totalMarketCapChange24h, 2)}">${sgn(mkt.totalMarketCapChange24h)}</div>` : ""}</div>` : ""
  }${
    mkt.ok && mkt.btcDominance != null ? `<div class="stat"><div class="sl">${esc(L.btcDom)}</div><div class="sv">${fmtPct(mkt.btcDominance)}</div></div>` : ""
  }${
    mkt.ok && mkt.ethDominance != null ? `<div class="stat"><div class="sl">${esc(L.ethDom)}</div><div class="sv">${fmtPct(mkt.ethDominance)}</div></div>` : ""
  }${
    mkt.ok && mkt.fearGreed ? `<div class="stat"><div class="sl">${esc(L.fng)}</div><div class="sv"><span class="fng-dot" style="background:${fngColor(mkt.fearGreed.value)}"></span>${mkt.fearGreed.value} — ${esc(mkt.fearGreed.label)}</div>${mkt.fearGreedPrev ? `<div class="sd">prev ${mkt.fearGreedPrev.value}</div>` : ""}</div>` : ""
  }${
    br ? `<div class="stat"><div class="sl">${esc(L.breadth)}</div><div class="sv">${fmtPct(br.upPct, 0)}</div><div class="sd">${esc(L.breadthDesc(br.up, br.down))}</div></div>` : ""
  }</div>` : "";

  // Caveman mode — CSS-only <details> toggle (no inline JS, CSP-safe).
  const cavemanBlock = s.caveman
    ? `<details class="caveman"><summary class="caveman-btn">${esc(L.caveman)}</summary><div class="caveman-box"><div class="ch">${esc(L.cavemanTitle)}</div><p>${esc(s.caveman)}</p></div></details>`
    : "";

  const alts = pack.altcoins || [];
  const altcoinsTable = alts.length
    ? `<h3>${esc(L.altcoinsH)}</h3><div class="table-wrap"><table class="alt-tbl"><thead><tr><th>${esc(L.coin)}</th><th>${esc(L.col.last)}</th><th>${esc(L.col.chg)}</th><th>${esc(L.col.high)}</th><th>${esc(L.col.low)}</th><th>${esc(L.col.vol)}</th></tr></thead><tbody>${alts.map((a) => `<tr><td><strong>${esc(a.symbol)}</strong> <span class="sym-raw">${esc(a.name)}</span></td><td><span class="mono">${fmtPrice(a.price)}</span></td><td><span class="mono ${cls(a.chgPct, TH.price)}">${sgn(a.chgPct)}</span></td><td><span class="mono">${fmtPrice(a.high)}</span></td><td><span class="mono">${fmtPrice(a.low)}</span></td><td><span class="mono">${fmtUSD(a.volume)}</span></td></tr>`).join("")}</tbody></table></div>`
    : "";
  const compactMajorPrice = (venueData, symbolLabel) => {
    const rows = Object.values(venueData).filter((r) => r && r.ok);
    if (!rows.length) return `<h3>${esc(symbolLabel)}</h3>${noneP(L.none.venue)}`;
    const ref = rows.find((r) => r.venue === "Binance") || rows[0];
    const close = ref.close ?? ref.last;
    const chgPct = ref.chgPct;
    const highs = rows.map((r) => r.high).filter((v) => v != null);
    const lows = rows.map((r) => r.low).filter((v) => v != null);
    const maxHigh = highs.length ? Math.max(...highs) : null;
    const minLow = lows.length ? Math.min(...lows) : null;
    let html = `<h3>${esc(symbolLabel)}</h3><div class="vs"><div class="vs-ref"><span class="vp mono">${fmtPrice(close)}</span><span class="vc mono ${cls(chgPct, TH.price)}">${sgn(chgPct)}</span><span class="vs-hl">${minLow != null ? fmtPrice(minLow) : "—"} — ${maxHigh != null ? fmtPrice(maxHigh) : "—"}</span></div>`;
    if (rows.length > 1) {
      const closes = rows.map((r) => ({ v: r.venue, c: r.close ?? r.last })).filter((r) => r.c != null);
      const mnC = Math.min(...closes.map((r) => r.c));
      const mxC = Math.max(...closes.map((r) => r.c));
      const spread = mxC - mnC;
      const spreadPct = mxC > 0 ? (spread / mxC) * 100 : 0;
      const totalVol = rows.reduce((sum, r) => sum + (r.volUSD || 0), 0);
      const volSorted = rows.map((r) => ({ venue: r.venue, vol: r.volUSD || 0, pct: totalVol > 0 ? ((r.volUSD || 0) / totalVol) * 100 : 0, approx: r.volBasis === "approx", rolling: r.basis === "rolling-24h" })).sort((a, b) => b.vol - a.vol);
      const maxP = Math.max(...volSorted.map((v) => v.pct), 1);
      html += `<div class="vs-meta"><span>${esc(L.spread)}: <strong class="mono">${fmtPrice(spread)}</strong> (${fmtPct(spreadPct)})</span><span>${esc(L.totalVol)}: <strong class="mono">${fmtUSD(totalVol)}</strong></span></div>`;
      html += `<div class="vs-dist">${volSorted.map((v) => `<div class="vs-bar-row"><span class="vn">${esc(v.venue)}${v.rolling ? " †" : ""}</span><div class="vb"><div style="width:${(v.pct / maxP * 100).toFixed(1)}%"></div></div><span class="vv mono">${fmtUSD(v.vol)}${v.approx ? " ≈" : ""}</span><span class="vpct mono">${fmtPct(v.pct, 0)}</span></div>`).join("")}</div>`;
    } else {
      html += `<div class="vs-meta"><span>${esc(L.totalVol)}: <strong class="mono">${fmtUSD(ref.volUSD)}</strong></span></div>`;
    }
    return html + `</div>`;
  };
  const priceVol = section(L.price,
    `${compactMajorPrice(pack.exchanges?.majors?.BTC || {}, L.h3.btcP)}
     ${compactMajorPrice(pack.exchanges?.majors?.ETH || {}, L.h3.ethP)}
     ${altcoinsTable}
     ${anyApprox({ ...(pack.exchanges?.majors?.BTC || {}), ...(pack.exchanges?.majors?.ETH || {}) }) ? `<p class="foot-note">${esc(L.volApprox)}</p>` : ""}
     ${pack.anyRolling ? `<p class="foot-note">${esc(L.rollingRow)}</p>` : ""}
     ${s.priceVolumeSummary ? `<p class="say">${esc(s.priceVolumeSummary)}</p>` : ""}`);

  const positioning = section(L.pos,
    `<h3>${esc(L.h3.btc)}</h3>${venueTableL(pack.exchanges?.majors?.BTC || {}, posCols)}
     <h3>${esc(L.h3.eth)}</h3>${venueTableL(pack.exchanges?.majors?.ETH || {}, posCols)}
     ${asOf ? `<p class="foot-note">${esc(L.pointInTime(asOf))}</p>` : ""}
     ${s.positioningSummary ? `<p class="say">${esc(s.positioningSummary)}</p>` : ""}`);

  // D2: intraday charts (price, OI, taker) from chart data
  const cd = pack.chartData || {};
  const btcPriceChart = cd.intraday?.BTC ? intradayPriceChart(cd.intraday.BTC, { label: L.h3.btc, color: "#c2410c" }) : "";
  const ethPriceChart = cd.intraday?.ETH ? intradayPriceChart(cd.intraday.ETH, { label: L.h3.eth, color: "#6d51d6" }) : "";
  const CL = L.chart || {};
  const btcOiChart = cd.metrics?.BTC ? intradayOiChart(cd.metrics.BTC, { label: L.h3.btc, titleOi: CL.oi, titleTaker: CL.takerBs }) : "";
  const ethOiChart = cd.metrics?.ETH ? intradayOiChart(cd.metrics.ETH, { label: L.h3.eth, titleOi: CL.oi, titleTaker: CL.takerBs }) : "";
  // D3: 45-day trend sparklines
  const btcTrend = cd.trend?.BTC ? trendChart(cd.trend.BTC, { label: "BTC", color: "#c2410c" }) : "";
  const ethTrend = cd.trend?.ETH ? trendChart(cd.trend.ETH, { label: "ETH", color: "#6d51d6" }) : "";
  // D5: funding rate heatmap from positioning data
  const fundingRows = [];
  for (const [asset, key] of [["BTC", "BTC"], ["ETH", "ETH"]]) {
    const obj = pack.exchanges?.majors?.[key] || {};
    const venues = Object.values(obj).filter((r) => r && r.ok && r.fundingAnnPct != null)
      .map((r) => ({ venue: r.venue, fundingAnn: r.fundingAnnPct }));
    if (venues.length) fundingRows.push({ asset, venues });
  }
  const fundingChart = fundingRows.length ? fundingHeatmap(fundingRows, { title: CL.funding }) : "";

  // D6: hourly volume profile from intraday 5m data
  const btcVolProfile = cd.intraday?.BTC ? volumeProfile(cd.intraday.BTC, { label: L.h3.btc, color: "#c2410c", titleVol: CL.hourlyVol }) : "";
  const ethVolProfile = cd.intraday?.ETH ? volumeProfile(cd.intraday.ETH, { label: L.h3.eth, color: "#6d51d6", titleVol: CL.hourlyVol }) : "";

  const chartsBlock = (btcPriceChart || ethPriceChart)
    ? `<div class="page-break"></div><div class="chart-pair">${btcPriceChart}${ethPriceChart}</div>${btcOiChart || ethOiChart ? `<div class="chart-pair">${btcOiChart}${ethOiChart}</div>` : ""}${fundingChart ? `<div class="chart-pair">${fundingChart}</div>` : ""}${btcVolProfile || ethVolProfile ? `<div class="chart-row">${btcVolProfile ? `<div>${btcVolProfile}</div>` : ""}${ethVolProfile ? `<div>${ethVolProfile}</div>` : ""}</div>` : ""}${btcTrend || ethTrend ? `<div class="trend-row">${btcTrend ? `<div>${btcTrend}</div>` : ""}${ethTrend ? `<div>${ethTrend}</div>` : ""}</div>` : ""}`
    : "";

  const movers = pack.exchanges?.movers || [];
  const moverExplRaw = new Map((s.movers || []).map((m) => [m.symbol, m]));
  const moverExpl = (sym) => moverExplRaw.get(sym) || moverExplRaw.get(sym.replace(/USDT$/, "")) || moverExplRaw.get(sym + "USDT");
  const moversBody = movers.length
    ? `<div class="movers">${movers.map((m) => {
        const e = moverExpl(m.symbol);
        const venues = m.venues && m.venues.length ? m.venues : ["Binance"];
        return `<div class="m"><div><span class="sym">${esc(m.symbol)}</span> <span class="mono ${cls(m.chgPct, TH.price)}">${sgn(m.chgPct, 1)}</span> <span class="mono" style="color:var(--muted)">· ${fmtUSD(m.volUSD)} ${esc(L.vol)} · ${esc(L.on)} ${esc(venues.join(", "))}</span></div>${e ? `<div class="say">${esc(e.explanation)}</div>` : ""}</div>`;
      }).join("")}</div>`
    : noneP(L.none.movers);
  const lowLiq = pack.exchanges?.lowLiqMovers || [];
  const lowLiqBody = lowLiq.length
    ? `<h3>${esc(L.h3.lowLiq)}</h3><p class="foot-note">${lowLiq.map((m) => `${esc(m.symbol)} ${sgn(m.chgPct, 1)}`).join(" · ")}</p>` : "";
  // D4: movers bar chart (one readable row per coin; low-liquidity ones tagged)
  const allMovers = [...movers, ...lowLiq.map((m) => ({ ...m, thin: true }))];
  const quadrantChart = allMovers.length >= 2 ? moversBars(allMovers, { title: CL.moversQuad, note: CL.moversNote, thinTag: CL.thinTag, volLabel: L.vol }) : "";
  const moversSection = section(L.movers, moversBody + lowLiqBody + (quadrantChart ? `<div class="chart-pair">${quadrantChart}</div>` : ""));

  const st = pack.stocks || {};
  const sessions = st.sessions || {};
  const rowsTable = (rows, { volMin = 5e4, limit = 10, label = L.col.stock } = {}) => {
    const list = (rows || []).filter((r) => (r.volUSD || 0) >= volMin).slice(0, limit);
    if (!list.length) return "";
    return `<div class="table-wrap"><table><thead><tr><th>${esc(label)}</th><th>${esc(L.col.last)}</th><th>${esc(L.col.chg)}</th><th>${esc(L.col.vol)}</th></tr></thead><tbody>${list.map((r) => `<tr><td><strong>${esc(r.name)}</strong> <span class="sym-raw">${esc(r.symbol.replace(/USDT$/, ""))}</span></td><td><span class="mono">${fmtPrice(r.last)}</span></td><td><span class="mono ${cls(r.chgPct, TH.stocks)}">${sgn(r.chgPct)}</span></td><td><span class="mono">${fmtUSD(r.volUSD)}</span></td></tr>`).join("")}</tbody></table></div>`;
  };
  const mktBlock = (mkt) => {
    const t = rowsTable(st.markets && st.markets[mkt], { limit: 8 });
    if (!t) return "";
    const sTxt = sessionText(L, sessions[mkt]);
    const sLine = sTxt ? `<div class="sess closed">${esc(L.mkt[mkt] || mkt)}: ${esc(sTxt)}</div>` : "";
    return `<h3>${esc(L.mkt[mkt] || mkt)}</h3>${sLine}${t}`;
  };
  const asiaTables = (st.asiaMarkets || ["KR_EQUITY", "HK_EQUITY", "CN_EQUITY"]).map(mktBlock).join("");
  const usMoversT = rowsTable(st.usMovers, { volMin: 1e6, limit: 8 });
  const usVolT = rowsTable(st.usTopVol, { volMin: 1e6, limit: 8 });
  const commoditiesT = rowsTable(st.commodities, { volMin: 0, limit: 8, label: L.col.commodity });
  const usSess = sessionText(L, sessions.EQUITY);
  const allClosed = st.ok && Object.values(sessions).every((s) => s && s.hadSession === false);
  const stocksBody = !st.ok
    ? noneP(L.none.stocks)
    : allClosed
      ? `<div class="banner warn">${esc(L.stocksClosed)}</div>${commoditiesT || ""}`
      : asiaTables +
        (usMoversT ? `<h3>${esc(L.h3.usMov)}</h3>${usSess ? `<div class="sess closed">${esc(L.mkt.EQUITY)}: ${esc(usSess)}</div>` : ""}${usMoversT}` : "") +
        (usVolT ? `<h3>${esc(L.h3.usVol)}</h3>${usVolT}` : "") +
        (commoditiesT ? `<h3>${esc(L.h3.comm)}</h3>${commoditiesT}` : "") +
        (s.stocksSummary ? `<p class="say">${esc(s.stocksSummary)}</p>` : "");
  const stocksSection = section(L.stocks, stocksBody);

  const nTime = (n) => n.timeUTC || n.timeIstanbul || "";
  const newsItem = (n, top) => {
    const url = safeUrl(n.url);
    const link = url ? `<a href="${escAttr(url)}" target="_blank" rel="noopener noreferrer">${esc(n.source || L.source)}</a>` : esc(n.source || "");
    return `<div class="newscard${top ? " top" : ""}"><div class="h">${esc(n.headline)}</div><div class="what">${esc(n.what)}</div><div class="meta">${n.coins ? esc(n.coins) + " · " : ""}${nTime(n) ? esc(nTime(n)) + " · " : ""}${link}</div></div>`;
  };
  const groups = (s.news && s.news.groups) || {};
  const tradfiCard = pack.tradfi?.ok
    ? `<h3>${esc(L.h3.tradfi)}</h3><table><thead><tr><th>${esc(L.col.market)}</th><th>${esc(L.col.chg)}</th><th>${esc(L.col.note)}</th></tr></thead><tbody>${pack.tradfi.items.map((t) => {
        const dateNote = t.staleForReport && t.sessionDate ? `${esc(t.proxy)} · ${esc(t.sessionDate)}` : esc(t.proxy);
        const label = t.symbol === "XAU/USD" ? `${t.label} (spot)` : `${t.label} (${t.symbol})`;
        return `<tr><td><strong>${esc(label)}</strong> <span class="sym-raw">${esc(t.sessionDate ? fmtShortDate(t.sessionDate) : "")}</span></td><td><span class="mono ${cls(t.changePct, TH.tradfi)}">${sgn(t.changePct)}</span></td><td style="text-align:left;color:var(--muted);font-size:10.5px">${dateNote}</td></tr>`;
      }).join("")}</tbody></table>`
    : "";
  const etfUrl = s.etfFlows ? safeUrl(s.etfFlows.url) : null;
  const newsBody =
    (s.news?.topThree?.length ? `<h3>${esc(L.h3.top3)}</h3>${s.news.topThree.map((n) => newsItem(n, true)).join("")}` : "") +
    GROUP_KEYS.filter((g) => (groups[g] || []).length).map((g) => `<h3>${esc(grpLabel(g))}</h3>${groups[g].map((n) => newsItem(n, false)).join("")}`).join("") +
    (s.etfFlows ? `<h3>${esc(L.h3.etf)}</h3><div class="newscard"><div class="what">${esc(s.etfFlows.summary)}</div><div class="meta">${esc(s.etfFlows.date || "")} · ${etfUrl ? `<a href="${escAttr(etfUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.etfFlows.source || L.source)}</a>` : esc(s.etfFlows.source || "")}</div></div>` : "") +
    tradfiCard +
    (!s.news?.topThree?.length && !GROUP_KEYS.some((g) => (groups[g] || []).length) && !tradfiCard ? noneP(L.none.news) : "");
  const newsSection = section(L.news, newsBody);

  const cal = pack.calendar || { reportDay: [], next24h: [], week: [] };
  const calNote = new Map((s.calendarNotes || []).map((c) => [c.event, c.typicalReaction]));
  const reportDayTable = cal.reportDay && cal.reportDay.length
    ? `<h3>${esc(L.h3.reportDay)}</h3><table><thead><tr><th>${esc(L.col.time)}</th><th>${esc(L.col.event)}</th><th>${esc(L.col.actual)}</th><th>${esc(L.col.fc)}</th><th>${esc(L.col.prev)}</th></tr></thead><tbody>${cal.reportDay.map((e) => `<tr><td class="mono" style="text-align:left">${esc(e.time)}</td><td style="text-align:left"><strong>${esc(e.title)}</strong>${calNote.get(e.title) ? ` — <span style="color:var(--muted)">${esc(calNote.get(e.title))}</span>` : ""}</td><td class="mono">${esc(e.actual || "—")}</td><td class="mono">${esc(e.forecast || "—")}</td><td class="mono">${esc(e.previous || "—")}</td></tr>`).join("")}</tbody></table>`
    : noneP(L.none.cal);
  const calList = (arr, showDay) => `<div class="cal">${arr.map((e) => `<div class="e"><span class="t">${showDay ? esc((e.when || "").split(",")[0]) : esc(e.time)}</span><span style="flex:1"><strong>${esc(e.title)}</strong></span><span class="fc">${showDay ? esc(e.time) : `${esc(L.col.fc)} ${esc(e.forecast || "—")}`}</span></div>`).join("")}</div>`;
  const warnings = (cal.warnings || []);
  const warningHtml = warnings.length
    ? `<h3>${esc(L.whatToWatch)}</h3><div class="wtw">${warnings.map((w) => `<div class="wtw-item">${esc(w.message)}</div>`).join("")}</div>`
    : "";
  const calBody = reportDayTable +
    (cal.next24h && cal.next24h.length ? `<h3>${esc(L.h3.next24h)}</h3>${calList(cal.next24h, false)}` : "") +
    warningHtml +
    (cal.week && cal.week.length ? `<h3>${esc(L.h3.rest)}</h3>${calList(cal.week, true)}` : "");
  const calSection = section(L.cal, calBody);

  const gloss = (s.glossary || []).slice().sort((a, b) => (a.term || "").localeCompare(b.term || ""));
  const glossSection = section(L.gloss,
    gloss.length ? `<div class="gloss">${gloss.map((g) => `<div class="g"><span class="term">${esc(g.term)}</span> — <span class="def">${esc(g.definition)}</span></div>`).join("")}</div>` : noneP(L.none.gloss));

  // B4: methodology section — data sources and their status
  const srcStatus = pack.sources || {};
  const srcLines = [
    srcStatus.exchanges?.online?.length ? `Exchanges: ${srcStatus.exchanges.online.join(", ")}` : null,
    srcStatus.calendar?.ok ? "Calendar: ok" : `Calendar: ${srcStatus.calendar?.reason || "unavailable"}`,
    `News: ${srcStatus.news?.ok ? `${srcStatus.news.count || 0} items from ${(srcStatus.news.sourcesOnline || []).join(", ") || "feeds"}` : "unavailable"}`,
    `Trad-fi: ${srcStatus.tradfi?.ok ? "ok" : srcStatus.tradfi?.reason || "unavailable"}`,
    `Stocks: ${srcStatus.stocks?.ok ? "ok" : srcStatus.stocks?.reason || "unavailable"}`,
    `Market: ${srcStatus.market?.ok ? "ok" : "unavailable"}`,
  ].filter(Boolean);
  const methSection = section(L.methodology,
    `<p class="say">${esc(L.methText)}</p><h3>${esc(L.methSources)}</h3><p class="foot-note">${srcLines.map(esc).join(" · ")}</p>`);

  const src = synth?._source ? ` · narrative: ${esc(synth._source)}` : "";
  const foot = `<div class="foot">${esc(L.foot(pack.coversUTC || "00:00–23:59 UTC", pack.generatedAtUTC || "", ""))}${src}</div>`;

  // D7: page footer (print only)
  const pageFoot = `<div class="page-foot"><span>Futures Daily Report · ${esc(pack.dateUTC || "")}</span><span>${esc(L.tagline)}</span></div>`;

  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`;
  return `<!DOCTYPE html><html lang="${escAttr(lang)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${STYLE}</style></head><body>${_ownersBadgePrint || ""}${cover}${statsBar}${cavemanBlock}${priceVol}${positioning}${chartsBlock}${moversSection}${stocksSection}<div class="page-break"></div>${newsSection}${calSection}<div class="page-break"></div>${glossSection}${methSection}${foot}${pageFoot}</body></html>`;
}

export { renderPdf };
