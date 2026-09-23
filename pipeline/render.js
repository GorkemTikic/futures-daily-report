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

const STYLE = `
  @page { size: A4; margin: 15mm 14mm 16mm; }
  :root{--ink:#14181d;--ink2:#39414b;--muted:#6b727c;--faint:#9aa1ab;--accent:#c2410c;--accent-ink:#9a3409;--accent-soft:#fbeee6;--accent-line:#eecab2;--line:#e8eaee;--line2:#f0f2f5;--card:#f7f8fa;--pos:#0f8a4f;--pos-soft:#e7f4ec;--neg:#c62b3f;--neg-soft:#fbe9eb;--amb:#b45309;}
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
  @media(max-width:640px){body{padding:20px 16px !important;} h1{font-size:26px !important;} .stats-bar{gap:8px;} .stat{flex:1 1 45%;} .stat .sv{font-size:15px;} .sym-raw{display:none;} .gloss{columns:1;} table{font-size:11px;}}
  .gloss .g{break-inside:avoid;margin-bottom:11px;} .gloss .term{font-weight:700;color:var(--ink);font-size:12px;} .gloss .def{font-size:11.5px;color:var(--ink2);}
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
  .owners{margin-left:auto;display:flex;flex-direction:column;gap:2px;align-items:flex-end;flex-shrink:0;}
  .owner{display:flex;align-items:center;gap:5px;}
  .owner .av{width:20px;height:20px;border-radius:50%;object-fit:cover;border:1px solid var(--accent-line);background:var(--card);}
  .owner .av-ini{display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;background:var(--accent);letter-spacing:.02em;}
  .owner .onm{font-size:8.5px;font-weight:700;color:var(--muted);white-space:nowrap;letter-spacing:.01em;}
  @media screen{ .owner .av{width:24px;height:24px;} .owner .onm{font-size:10px;} }
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
    pos: ["02 · Positioning", "How traders were leaning", "Funding shows which side is paying to hold its position (positive = longs pay shorts). Open interest is how much money is in open bets; its change over the day shows money coming in or out. Long/short is how many accounts lean each way."],
    movers: ["03 · Biggest movers", "The coins that moved the most", "The largest moves on Binance for this UTC day, with the reason where the news supports one."],
    stocks: ["04 · Stocks & commodities on Binance Futures", "Equities and commodities traded on Binance", "Binance lists tokenised perpetuals for stocks (Korea, Hong Kong, China and the US) and commodities. The perp trades nearly around the clock, but the underlying market is open only a few hours — when it was closed, that is noted instead of showing drift as a daily move."],
    news: ["05 · Market news", "What drove the market — and what didn't", "Only causes that move prices, each with its source. Rumours and unconfirmed reports are kept separate at the end."],
    cal: ["06 · Scheduled events", "What happened and what's coming (UTC)", "US economic releases that tend to move crypto. A number only matters against its forecast."],
    gloss: ["07 · Glossary", "Every term used today, in plain words", ""],
    col: { venue: "Venue", last: "Close", chg: "Change", high: "High", low: "Low", vol: "Volume", funding: "Funding (ann.)", oi: "Open interest", oiChg: "OI change", ls: "Long/short", mark: "Mark", stock: "Stock", commodity: "Commodity", market: "Market", session: "Session", actual: "Actual", fc: "Forecast", prev: "Previous", time: "Time", event: "Event", note: "Note" },
    h3: { btcP: "Bitcoin (BTC perpetual)", ethP: "Ethereum (ETH perpetual)", btc: "Bitcoin", eth: "Ethereum", usMov: "United States — biggest movers", usVol: "United States — most traded", comm: "Commodities", tradfi: "Traditional markets", top3: "The three that mattered most", etf: "ETF flows", reportDay: "On the report day", next24h: "Next 24 hours", rest: "Rest of the week", lowLiq: "Newly listed / low-liquidity movers" },
    mkt: { KR_EQUITY: "Korea", HK_EQUITY: "Hong Kong", CN_EQUITY: "China", EQUITY: "US", COMMODITY: "Commodities", PREMARKET: "Pre-market" },
    grp: ["Regulation and policy", "Institutional flows and ETFs", "Exchange and platform changes", "Hacks, exploits and outages", "Traditional markets", "Unconfirmed and watch items"],
    sess: { weekend: "weekend — no cash session", holiday: (n) => `market closed (${n})`, closedGeneric: "cash market was closed — the perp figures are drift only" },
    source: "source", vol: "vol", on: "on", lsLine: "Long/short accounts", oiChangeLine: "Open-interest change over the day",
    mktCap: "Total market cap", btcDom: "BTC dominance", ethDom: "ETH dominance", fng: "Fear & Greed",
    altcoinsH: "Altcoins", coin: "Coin",
    none: { movers: "No standout movers today.", stocks: "Stock & commodity data was unavailable this run.", news: "No market-moving news was confirmed for this day", cal: "No US high-impact events on the report day.", gloss: "No special terms used today.", venue: "No venue data available." },
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
    pos: ["02 · Pozisyonlanma", "Yatırımcılar hangi yöne yaslanıyordu", "Fonlama, pozisyonu taşımak için hangi tarafın ödeme yaptığını gösterir (pozitif = long'lar short'lara öder). Açık pozisyon (OI), açık işlemlerdeki toplam paradır; gün içindeki değişimi paranın giriş/çıkışını gösterir. Long/short, kaç hesabın hangi yöne yaslandığıdır."],
    movers: ["03 · En çok hareket edenler", "En çok hareket eden coin'ler", "Binance'te bu UTC günündeki en büyük hareketler; haber bir sebep destekliyorsa onunla birlikte."],
    stocks: ["04 · Binance Futures'ta hisseler ve emtialar", "Binance'te işlem gören hisseler ve emtialar", "Binance; hisseler (Kore, Hong Kong, Çin ve ABD) ile emtialar için tokenize vadeli sözleşmeler listeler. Vadeli neredeyse 7/24 işlem görür, ama dayanak piyasa günde yalnızca birkaç saat açıktır — kapalıyken, sürüklenme günlük hareket gibi gösterilmez, bu durum not edilir."],
    news: ["05 · Piyasa haberleri", "Piyasayı ne hareket ettirdi — ve ne ettirmedi", "Yalnızca fiyatı hareket ettiren sebepler, her biri kaynağıyla. Söylentiler ve teyit edilmemiş haberler en sonda ayrı tutulur."],
    cal: ["06 · Takvim", "Ne oldu ve sırada ne var (UTC)", "Kriptoyu hareket ettirme eğilimindeki ABD ekonomik verileri. Bir rakam ancak beklentiyle kıyaslandığında anlam taşır."],
    gloss: ["07 · Sözlük", "Bugün kullanılan her terim, sade bir dille", ""],
    col: { venue: "Borsa", last: "Kapanış", chg: "Değişim", high: "Yüksek", low: "Düşük", vol: "Hacim", funding: "Fonlama (yıllık)", oi: "Açık pozisyon", oiChg: "OI değişimi", ls: "Long/short", mark: "Mark", stock: "Hisse", commodity: "Emtia", market: "Piyasa", session: "Seans", actual: "Gerçekleşen", fc: "Beklenti", prev: "Önceki", time: "Saat", event: "Olay", note: "Not" },
    h3: { btcP: "Bitcoin (BTC vadeli)", ethP: "Ethereum (ETH vadeli)", btc: "Bitcoin", eth: "Ethereum", usMov: "ABD — en çok hareket edenler", usVol: "ABD — en çok işlem görenler", comm: "Emtialar", tradfi: "Geleneksel piyasalar", top3: "En önemli üç haber", etf: "ETF para akışları", reportDay: "Rapor gününde", next24h: "Önümüzdeki 24 saat", rest: "Haftanın geri kalanı", lowLiq: "Yeni listelenen / düşük likiditeli hareketler" },
    mkt: { KR_EQUITY: "Kore", HK_EQUITY: "Hong Kong", CN_EQUITY: "Çin", EQUITY: "ABD", COMMODITY: "Emtialar", PREMARKET: "Halka arz öncesi" },
    grp: ["Düzenleme ve politika", "Kurumsal akışlar ve ETF'ler", "Borsa ve platform değişiklikleri", "Saldırılar, açıklar ve kesintiler", "Geleneksel piyasalar", "Teyit edilmemiş ve izlenecekler"],
    sess: { weekend: "hafta sonu — nakit seans yok", holiday: (n) => `piyasa kapalı (${n})`, closedGeneric: "nakit piyasa kapalıydı — vadeli rakamlar yalnızca sürüklenmedir" },
    source: "kaynak", vol: "hacim", on: "borsalar:", lsLine: "Long/short hesap oranı", oiChangeLine: "Gün içinde açık pozisyon değişimi",
    mktCap: "Toplam piyasa değeri", btcDom: "BTC hakimiyeti", ethDom: "ETH hakimiyeti", fng: "Korku ve Açgözlülük",
    altcoinsH: "Altcoin'ler", coin: "Coin",
    none: { movers: "Bugün öne çıkan bir hareket yok.", stocks: "Bu çalışmada hisse ve emtia verisi alınamadı.", news: "Bu gün için piyasayı hareket ettiren teyitli haber yok", cal: "Rapor gününde yüksek etkili ABD verisi yok.", gloss: "Bugün özel terim kullanılmadı.", venue: "Borsa verisi yok." },
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
    pos: ["02 · 持仓情况", "交易者偏向哪一方", "资金费率显示哪一方为持仓付费(正值=多头付给空头)。未平仓合约(OI)是未平仓头寸中的资金量;其当日变化显示资金流入或流出。多空比是多少账户偏向哪一方。"],
    movers: ["03 · 涨跌最大的币", "波动最大的币种", "Binance 上该 UTC 日的最大波动;若有新闻可解释,一并给出原因。"],
    stocks: ["04 · 币安期货上的股票与商品", "在币安交易的股票与商品", "币安为股票(韩国、香港、中国和美国)以及商品提供代币化永续合约。永续合约几乎全天交易,但标的市场每天只开盘几个小时——当其休市时,不会把漂移当作当日涨跌,而是加以标注。"],
    news: ["05 · 市场新闻", "是什么推动了市场——又有什么没有", "只列出能推动价格的原因,每条都附来源。传闻和未经证实的消息单独放在最后。"],
    cal: ["06 · 日程", "发生了什么以及接下来有什么(UTC)", "往往会影响加密货币的美国经济数据。一个数字只有对照预期才有意义。"],
    gloss: ["07 · 术语表", "今天用到的每个术语,用大白话解释", ""],
    col: { venue: "交易所", last: "收盘", chg: "涨跌", high: "最高", low: "最低", vol: "成交量", funding: "资金费率(年化)", oi: "未平仓量", oiChg: "OI 变化", ls: "多空比", mark: "标记价", stock: "股票", commodity: "商品", market: "市场", session: "交易时段", actual: "实际值", fc: "预期", prev: "前值", time: "时间", event: "事件", note: "备注" },
    h3: { btcP: "比特币(BTC 永续)", ethP: "以太坊(ETH 永续)", btc: "比特币", eth: "以太坊", usMov: "美国 — 涨跌最大", usVol: "美国 — 成交最活跃", comm: "商品", tradfi: "传统市场", top3: "最重要的三条", etf: "ETF 资金流", reportDay: "报告当日", next24h: "未来 24 小时", rest: "本周剩余日程", lowLiq: "新上市 / 低流动性波动" },
    mkt: { KR_EQUITY: "韩国", HK_EQUITY: "香港", CN_EQUITY: "中国", EQUITY: "美国", COMMODITY: "商品", PREMARKET: "上市前" },
    grp: ["监管与政策", "机构资金与 ETF", "交易所与平台变动", "攻击、漏洞与宕机", "传统市场", "未证实与待观察"],
    sess: { weekend: "周末 — 无现货交易", holiday: (n) => `市场休市(${n})`, closedGeneric: "现货市场休市 — 永续数据仅为漂移" },
    source: "来源", vol: "成交", on: "交易所:", lsLine: "多空账户比", oiChangeLine: "当日未平仓量变化",
    mktCap: "总市值", btcDom: "BTC 占比", ethDom: "ETH 占比", fng: "恐惧与贪婪",
    altcoinsH: "山寨币", coin: "币种",
    none: { movers: "今天没有特别突出的波动。", stocks: "本次运行未能获取股票和商品数据。", news: "本日没有证实的、能推动市场的新闻", cal: "报告当日没有高影响的美国数据。", gloss: "今天没有用到特别术语。", venue: "暂无交易所数据。" },
    foot: (c, g, src) => `覆盖 UTC 日 ${c}。生成时间:${g}。数字来自各交易所公开 API;新闻来自生成时的公开报道。仅供参考,不构成投资建议。${src}`,
  },
};

const LOCALE = { en: "en-GB", tr: "tr-TR", zh: "zh-CN" };
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
  const dateHeading = pack.dateUTC ? localDate(pack.dateUTC, lang) : (pack.dateLong || "");
  const grpLabel = (g) => { const i = GROUP_KEYS.indexOf(g); return i >= 0 ? L.grp[i] : g; };
  const asOf = pack.asOfUTC ? `${L.asOf} ${pack.asOfUTC}` : "";

  const priceCols = [
    { h: L.col.venue, f: (r) => `<strong>${esc(r.venue)}</strong>${r.basis === "rolling-24h" ? " †" : ""}` },
    { h: L.col.last, f: (r) => `<span class="mono">${fmtPrice(r.close ?? r.last)}</span>` },
    { h: L.col.chg, f: (r) => `<span class="mono ${cls(r.chgPct, TH.price)}">${sgn(r.chgPct)}</span>` },
    { h: L.col.high, f: (r) => `<span class="mono">${fmtPrice(r.high)}</span>` },
    { h: L.col.low, f: (r) => `<span class="mono">${fmtPrice(r.low)}</span>` },
    { h: L.col.vol, f: (r) => `<span class="mono">${fmtUSD(r.volUSD)}${r.volBasis === "approx" ? " ≈" : ""}</span>` },
  ];
  const posCols = [
    { h: L.col.venue, f: (r) => `<strong>${esc(r.venue)}</strong>` },
    { h: L.col.funding, f: (r) => `<span class="mono ${cls(r.fundingAnnPct, TH.funding)}">${sgn(r.fundingAnnPct, 1)}</span>` },
    { h: L.col.oi, f: (r) => `<span class="mono">${fmtUSD(r.oiUSD)}</span>` },
    { h: L.col.oiChg, f: (r) => `<span class="mono ${cls(r.oiChangePct, TH.price)}">${r.oiChangePct != null ? sgn(r.oiChangePct, 1) : "—"}</span>` },
    { h: L.col.ls, f: (r) => `<span class="mono">${fmtRatio(r.longShortAccount)}</span>` },
    { h: L.col.mark, f: (r) => `<span class="mono">${fmtPrice(r.mark)}</span>` },
  ];
  const section = (a, body) => `<div class="section"><div class="kicker">${esc(a[0])}</div><h2>${esc(a[1])}</h2>${a[2] ? `<p class="intro">${esc(a[2])}</p>` : ""}${body}</div>`;
  const noneP = (t) => `<p class="none">${esc(t)}</p>`;
  const venueTableL = (obj, cols) => { const rows = Object.values(obj).filter((r) => r && r.ok); if (!rows.length) return noneP(L.none.venue); return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c.h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => "<tr>" + cols.map((c) => `<td>${c.f(r)}</td>`).join("") + "</tr>").join("")}</tbody></table></div>`; };
  const anyApprox = (obj) => Object.values(obj).some((r) => r && r.ok && r.volBasis === "approx");

  // honesty banners
  const degradedBanner = health && health.status === "degraded" && (health.reasons || []).length
    ? `<div class="banner warn">${esc(L.degraded)} ${esc((health.reasons || []).join(" · "))}</div>` : "";
  const rollingNote = pack.rolling ? `<div class="note-line">${esc(L.rollingNote(pack.asOfUTC || ""))}</div>` : "";

  const cover = `
    <div class="cover-band"><div class="cover-mark">FD</div><div class="cover-brand">Futures Daily Report<span>${esc(L.tagline)}</span></div>${ownersBadge()}</div>
    <div class="kicker">${esc(L.daily)}</div>
    <h1>${esc(dateHeading)}</h1>
    <div class="date">${esc(pack.coversUTC || "00:00–23:59 UTC")} · ${esc(L.dataFrom)}${pack.tradfi?.ok ? " + Twelve Data" : ""}</div>
    ${degradedBanner}${rollingNote}
    <div class="oneline"><div class="k">${esc(L.oneLine)}</div><p>${esc(s.oneLine || "—")}</p></div>`;

  const mkt = pack.market || {};
  const statsBar = mkt.ok ? `<div class="stats-bar">${
    mkt.totalMarketCap != null ? `<div class="stat"><div class="sl">${esc(L.mktCap)}</div><div class="sv">${fmtUSD(mkt.totalMarketCap)}</div>${mkt.totalMarketCapChange24h != null ? `<div class="sd mono ${cls(mkt.totalMarketCapChange24h, 2)}">${sgn(mkt.totalMarketCapChange24h)}</div>` : ""}</div>` : ""
  }${
    mkt.btcDominance != null ? `<div class="stat"><div class="sl">${esc(L.btcDom)}</div><div class="sv">${fmtPct(mkt.btcDominance)}</div></div>` : ""
  }${
    mkt.ethDominance != null ? `<div class="stat"><div class="sl">${esc(L.ethDom)}</div><div class="sv">${fmtPct(mkt.ethDominance)}</div></div>` : ""
  }${
    mkt.fearGreed ? `<div class="stat"><div class="sl">${esc(L.fng)}</div><div class="sv"><span class="fng-dot" style="background:${fngColor(mkt.fearGreed.value)}"></span>${mkt.fearGreed.value} — ${esc(mkt.fearGreed.label)}</div>${mkt.fearGreedPrev ? `<div class="sd">prev ${mkt.fearGreedPrev.value}</div>` : ""}</div>` : ""
  }</div>` : "";

  // Caveman mode — CSS-only <details> toggle (no inline JS, CSP-safe).
  const cavemanBlock = s.caveman
    ? `<details class="caveman"><summary class="caveman-btn">${esc(L.caveman)}</summary><div class="caveman-box"><div class="ch">${esc(L.cavemanTitle)}</div><p>${esc(s.caveman)}</p></div></details>`
    : "";

  const alts = pack.altcoins || [];
  const altcoinsTable = alts.length
    ? `<h3>${esc(L.altcoinsH)}</h3><div class="table-wrap"><table class="alt-tbl"><thead><tr><th>${esc(L.coin)}</th><th>${esc(L.col.last)}</th><th>${esc(L.col.chg)}</th><th>${esc(L.col.high)}</th><th>${esc(L.col.low)}</th><th>${esc(L.col.vol)}</th></tr></thead><tbody>${alts.map((a) => `<tr><td><strong>${esc(a.symbol)}</strong> <span class="sym-raw">${esc(a.name)}</span></td><td><span class="mono">${fmtPrice(a.price)}</span></td><td><span class="mono ${cls(a.chgPct, TH.price)}">${sgn(a.chgPct)}</span></td><td><span class="mono">${fmtPrice(a.high)}</span></td><td><span class="mono">${fmtPrice(a.low)}</span></td><td><span class="mono">${fmtUSD(a.volume)}</span></td></tr>`).join("")}</tbody></table></div>`
    : "";
  const priceVol = section(L.price,
    `<h3>${esc(L.h3.btcP)}</h3>${venueTableL(pack.exchanges?.majors?.BTC || {}, priceCols)}
     <h3>${esc(L.h3.ethP)}</h3>${venueTableL(pack.exchanges?.majors?.ETH || {}, priceCols)}
     ${altcoinsTable}
     ${anyApprox({ ...(pack.exchanges?.majors?.BTC || {}), ...(pack.exchanges?.majors?.ETH || {}) }) ? `<p class="foot-note">${esc(L.volApprox)}</p>` : ""}
     ${pack.anyRolling ? `<p class="foot-note">${esc(L.rollingRow)}</p>` : ""}
     ${s.priceVolumeSummary ? `<p class="say">${esc(s.priceVolumeSummary)}</p>` : ""}`);

  const positioning = section(L.pos,
    `<h3>${esc(L.h3.btc)}</h3>${venueTableL(pack.exchanges?.majors?.BTC || {}, posCols)}
     <h3>${esc(L.h3.eth)}</h3>${venueTableL(pack.exchanges?.majors?.ETH || {}, posCols)}
     ${asOf ? `<p class="foot-note">${esc(L.pointInTime(asOf))}</p>` : ""}
     ${s.positioningSummary ? `<p class="say">${esc(s.positioningSummary)}</p>` : ""}`);

  const movers = pack.exchanges?.movers || [];
  const moverExpl = new Map((s.movers || []).map((m) => [m.symbol, m]));
  const moversBody = movers.length
    ? `<div class="movers">${movers.map((m) => {
        const e = moverExpl.get(m.symbol);
        const venues = m.venues && m.venues.length ? m.venues : ["Binance"];
        return `<div class="m"><div><span class="sym">${esc(m.symbol)}</span> <span class="mono ${cls(m.chgPct, TH.price)}">${sgn(m.chgPct, 1)}</span> <span class="mono" style="color:var(--muted)">· ${fmtUSD(m.volUSD)} ${esc(L.vol)} · ${esc(L.on)} ${esc(venues.join(", "))}</span></div>${e ? `<div class="say">${esc(e.explanation)}</div>` : ""}</div>`;
      }).join("")}</div>`
    : noneP(L.none.movers);
  const lowLiq = pack.exchanges?.lowLiqMovers || [];
  const lowLiqBody = lowLiq.length
    ? `<h3>${esc(L.h3.lowLiq)}</h3><p class="foot-note">${lowLiq.map((m) => `${esc(m.symbol)} ${sgn(m.chgPct, 1)}`).join(" · ")}</p>` : "";
  const moversSection = section(L.movers, moversBody + lowLiqBody);

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
  const stocksBody = st.ok
    ? asiaTables +
      (usMoversT ? `<h3>${esc(L.h3.usMov)}</h3>${usSess ? `<div class="sess closed">${esc(L.mkt.EQUITY)}: ${esc(usSess)}</div>` : ""}${usMoversT}` : "") +
      (usVolT ? `<h3>${esc(L.h3.usVol)}</h3>${usVolT}` : "") +
      (commoditiesT ? `<h3>${esc(L.h3.comm)}</h3>${commoditiesT}` : "") +
      (s.stocksSummary ? `<p class="say">${esc(s.stocksSummary)}</p>` : "")
    : noneP(L.none.stocks);
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
        const label = t.symbol === "XAU/USD" ? `${t.label} (spot)` : t.label;
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
    ? warnings.map((w) => `<div class="banner warn">${esc(w.message)}</div>`).join("")
    : "";
  const calBody = reportDayTable +
    (cal.next24h && cal.next24h.length ? `<h3>${esc(L.h3.next24h)}</h3>${calList(cal.next24h, false)}` : "") +
    warningHtml +
    (cal.week && cal.week.length ? `<h3>${esc(L.h3.rest)}</h3>${calList(cal.week, true)}` : "");
  const calSection = section(L.cal, calBody);

  const gloss = (s.glossary || []).slice().sort((a, b) => (a.term || "").localeCompare(b.term || ""));
  const glossSection = section(L.gloss,
    gloss.length ? `<div class="gloss">${gloss.map((g) => `<div class="g"><span class="term">${esc(g.term)}</span> — <span class="def">${esc(g.definition)}</span></div>`).join("")}</div>` : noneP(L.none.gloss));

  const src = synth?._source ? ` · narrative: ${esc(synth._source)}` : "";
  const foot = `<div class="foot">${esc(L.foot(pack.coversUTC || "00:00–23:59 UTC", pack.generatedAtUTC || "", ""))}${src}</div>`;

  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`;
  return `<!DOCTYPE html><html lang="${escAttr(lang)}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${STYLE}</style></head><body>${_ownersBadgePrint || ""}${cover}${statsBar}${cavemanBlock}${priceVol}${positioning}${moversSection}${stocksSection}${newsSection}${calSection}${glossSection}${foot}</body></html>`;
}

export { renderPdf };
