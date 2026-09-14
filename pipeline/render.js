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
  html{background:#fff;} body{font-family:'Segoe UI',-apple-system,'Helvetica Neue',Arial,'Microsoft YaHei','PingFang SC','Hiragino Sans GB','Noto Sans CJK SC',sans-serif;background:#fff;color:var(--ink2);color-scheme:light;font-size:12px;line-height:1.6;-webkit-font-smoothing:antialiased;}
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

// Fixed UI strings per language. Daily prose (oneLine, summaries, news, glossary) is
// localised by the translation pass in synthesize.js; these are the stable labels.
export const LANGS = ["en", "tr", "zh"];
const GROUP_KEYS = ["Regulation and policy", "Institutional flows and ETFs", "Exchange and platform changes", "Hacks, exploits and outages", "Traditional markets", "Unconfirmed and watch items"];
const LABELS = {
  en: {
    tagline: "Crypto futures across the major venues · daily", daily: "Daily market report",
    dataFrom: "all times UTC · data from Binance, Bybit, OKX, Bitget, Gate", oneLine: "The day in one line",
    price: ["01 · Price & volume", "What every venue's price and volume did", "The same two contracts on every exchange. When the prices line up, nothing unusual is happening; a gap or a big volume difference is worth noticing."],
    pos: ["02 · Positioning", "How traders were leaning", "Funding shows which side is paying to hold its position (positive = longs pay shorts). Open interest is how much money is in open bets. Both are shown in the same units so the venues compare."],
    movers: ["03 · Biggest movers", "The coins that moved the most", "The largest 24-hour moves on Binance, with the reason where the news supports one."],
    stocks: ["04 · Stocks & commodities on Binance Futures", "Equities and commodities traded on Binance", "Binance lists tokenised perpetuals for stocks (Korea, Hong Kong, China and the US) and commodities. The Asian names trade during the Asian session and often set the tone before crypto's US hours. Prices are the Binance perp's own price in USDT."],
    news: ["05 · Market news", "What drove the market — and what didn't", "Only causes that move prices, each with its source. Rumours and unconfirmed reports are kept separate at the end."],
    cal: ["06 · Scheduled events", "What's coming (UTC)", "US economic releases that tend to move crypto. A number only matters against its forecast."],
    gloss: ["07 · Glossary", "Every term used today, in plain words", ""],
    col: { venue: "Venue", last: "Last", chg: "24h", high: "24h high", low: "24h low", vol: "24h volume", funding: "Funding (ann.)", oi: "Open interest", mark: "Mark", stock: "Stock", commodity: "Commodity", market: "Market", today: "Today", note: "Note" },
    h3: { btcP: "Bitcoin (BTC perpetual)", ethP: "Ethereum (ETH perpetual)", btc: "Bitcoin", eth: "Ethereum", usMov: "United States — biggest movers", usVol: "United States — most traded", comm: "Commodities", tradfi: "Traditional markets", top3: "The three that mattered most", etf: "ETF flows", today: "Today", rest: "Rest of the week" },
    mkt: { KR_EQUITY: "Korea", HK_EQUITY: "Hong Kong", CN_EQUITY: "China", EQUITY: "US", COMMODITY: "Commodities", PREMARKET: "Pre-market" },
    grp: ["Regulation and policy", "Institutional flows and ETFs", "Exchange and platform changes", "Hacks, exploits and outages", "Traditional markets", "Unconfirmed and watch items"],
    fc: "fc", prev: "prev", source: "source", vol: "vol", on: "on",
    none: { movers: "No standout movers today.", stocks: "Stock & commodity data was unavailable this run.", news: "No market-moving news was confirmed in the last 24 hours", cal: "No US high-impact events scheduled today.", gloss: "No special terms used today.", venue: "No venue data available." },
    foot: (c, g, src) => `Covers the UTC day ${c}. Generated ${g}. Numbers from each venue's public API; news from public reporting at generation time. Information only, not financial advice.${src}`,
  },
  tr: {
    tagline: "Başlıca borsalarda kripto vadeli işlemler · günlük", daily: "Günlük piyasa raporu",
    dataFrom: "tüm saatler UTC · veriler: Binance, Bybit, OKX, Bitget, Gate", oneLine: "Günün özeti tek cümlede",
    price: ["01 · Fiyat ve hacim", "Her borsada fiyat ve hacim ne yaptı", "Aynı iki sözleşme her borsada. Fiyatlar birbirini tutuyorsa olağandışı bir şey yok; borsalar arası fark ya da büyük hacim farkı dikkat çeker."],
    pos: ["02 · Pozisyonlanma", "Yatırımcılar hangi yöne yaslanıyordu", "Fonlama, pozisyonu taşımak için hangi tarafın ödeme yaptığını gösterir (pozitif = long'lar short'lara öder). Açık pozisyon (OI), açık işlemlerdeki toplam paradır. İkisi de aynı birimde gösterildi ki borsalar karşılaştırılabilsin."],
    movers: ["03 · En çok hareket edenler", "En çok hareket eden coin'ler", "Binance'te son 24 saatteki en büyük hareketler; haber bir sebep destekliyorsa onunla birlikte."],
    stocks: ["04 · Binance Futures'ta hisseler ve emtialar", "Binance'te işlem gören hisseler ve emtialar", "Binance; hisseler (Kore, Hong Kong, Çin ve ABD) ile emtialar için tokenize vadeli sözleşmeler listeler. Asya isimleri Asya seansında işlem görür ve çoğu zaman kriptonun ABD saatlerinden önce havayı belirler. Fiyatlar, Binance vadelinin kendi USDT fiyatıdır."],
    news: ["05 · Piyasa haberleri", "Piyasayı ne hareket ettirdi — ve ne ettirmedi", "Yalnızca fiyatı hareket ettiren sebepler, her biri kaynağıyla. Söylentiler ve teyit edilmemiş haberler en sonda ayrı tutulur."],
    cal: ["06 · Takvim", "Sırada ne var (UTC)", "Kriptoyu hareket ettirme eğilimindeki ABD ekonomik verileri. Bir rakam ancak beklentiyle kıyaslandığında anlam taşır."],
    gloss: ["07 · Sözlük", "Bugün kullanılan her terim, sade bir dille", ""],
    col: { venue: "Borsa", last: "Son", chg: "24s", high: "24s en yüksek", low: "24s en düşük", vol: "24s hacim", funding: "Fonlama (yıllık)", oi: "Açık pozisyon", mark: "Mark", stock: "Hisse", commodity: "Emtia", market: "Piyasa", today: "Bugün", note: "Not" },
    h3: { btcP: "Bitcoin (BTC vadeli)", ethP: "Ethereum (ETH vadeli)", btc: "Bitcoin", eth: "Ethereum", usMov: "ABD — en çok hareket edenler", usVol: "ABD — en çok işlem görenler", comm: "Emtialar", tradfi: "Geleneksel piyasalar", top3: "En önemli üç haber", etf: "ETF para akışları", today: "Bugün", rest: "Haftanın geri kalanı" },
    mkt: { KR_EQUITY: "Kore", HK_EQUITY: "Hong Kong", CN_EQUITY: "Çin", EQUITY: "ABD", COMMODITY: "Emtialar", PREMARKET: "Halka arz öncesi" },
    grp: ["Düzenleme ve politika", "Kurumsal akışlar ve ETF'ler", "Borsa ve platform değişiklikleri", "Saldırılar, açıklar ve kesintiler", "Geleneksel piyasalar", "Teyit edilmemiş ve izlenecekler"],
    fc: "beklenti", prev: "önceki", source: "kaynak", vol: "hacim", on: "borsalar:",
    none: { movers: "Bugün öne çıkan bir hareket yok.", stocks: "Bu çalışmada hisse ve emtia verisi alınamadı.", news: "Son 24 saatte piyasayı hareket ettiren teyitli haber yok", cal: "Bugün planlanmış yüksek etkili ABD verisi yok.", gloss: "Bugün özel terim kullanılmadı.", venue: "Borsa verisi yok." },
    foot: (c, g, src) => `${c} UTC gününü kapsar. Oluşturulma: ${g}. Rakamlar her borsanın herkese açık API'sinden; haberler oluşturma anındaki kamuya açık kaynaklardan. Yalnızca bilgi amaçlıdır, yatırım tavsiyesi değildir.${src}`,
  },
  zh: {
    tagline: "主要交易所加密货币期货 · 每日", daily: "每日市场报告",
    dataFrom: "均为 UTC 时间 · 数据来自 Binance、Bybit、OKX、Bitget、Gate", oneLine: "一句话看今天",
    price: ["01 · 价格与成交量", "各交易所的价格和成交量表现", "同样两个合约在每个交易所。价格一致说明没有异常;交易所之间的价差或成交量差异值得留意。"],
    pos: ["02 · 持仓情况", "交易者偏向哪一方", "资金费率显示哪一方为持仓付费(正值=多头付给空头)。未平仓合约(OI)是未平仓头寸中的资金量。两者以相同单位显示,便于比较各交易所。"],
    movers: ["03 · 涨跌最大的币", "波动最大的币种", "Binance 上过去 24 小时的最大波动;若有新闻可解释,一并给出原因。"],
    stocks: ["04 · 币安期货上的股票与商品", "在币安交易的股票与商品", "币安为股票(韩国、香港、中国和美国)以及商品提供代币化永续合约。亚洲标的在亚洲时段交易,常在加密货币的美国时段之前定下基调。价格为币安永续合约自身的 USDT 价格。"],
    news: ["05 · 市场新闻", "是什么推动了市场——又有什么没有", "只列出能推动价格的原因,每条都附来源。传闻和未经证实的消息单独放在最后。"],
    cal: ["06 · 日程", "接下来有什么(UTC)", "往往会影响加密货币的美国经济数据。一个数字只有对照预期才有意义。"],
    gloss: ["07 · 术语表", "今天用到的每个术语,用大白话解释", ""],
    col: { venue: "交易所", last: "最新", chg: "24h", high: "24h 最高", low: "24h 最低", vol: "24h 成交量", funding: "资金费率(年化)", oi: "未平仓量", mark: "标记价", stock: "股票", commodity: "商品", market: "市场", today: "今天", note: "备注" },
    h3: { btcP: "比特币(BTC 永续)", ethP: "以太坊(ETH 永续)", btc: "比特币", eth: "以太坊", usMov: "美国 — 涨跌最大", usVol: "美国 — 成交最活跃", comm: "商品", tradfi: "传统市场", top3: "最重要的三条", etf: "ETF 资金流", today: "今天", rest: "本周剩余日程" },
    mkt: { KR_EQUITY: "韩国", HK_EQUITY: "香港", CN_EQUITY: "中国", EQUITY: "美国", COMMODITY: "商品", PREMARKET: "上市前" },
    grp: ["监管与政策", "机构资金与 ETF", "交易所与平台变动", "攻击、漏洞与宕机", "传统市场", "未证实与待观察"],
    fc: "预期", prev: "前值", source: "来源", vol: "成交", on: "交易所:",
    none: { movers: "今天没有特别突出的波动。", stocks: "本次运行未能获取股票和商品数据。", news: "过去 24 小时没有证实的、能推动市场的新闻", cal: "今天没有预定的高影响美国数据。", gloss: "今天没有用到特别术语。", venue: "暂无交易所数据。" },
    foot: (c, g, src) => `覆盖 UTC 日 ${c}。生成时间:${g}。数字来自各交易所公开 API;新闻来自生成时的公开报道。仅供参考,不构成投资建议。${src}`,
  },
};

export function buildReportHtml(pack, synth, lang = "en") {
  const s = synth || {};
  const L = LABELS[lang] || LABELS.en;
  const grpLabel = (g) => { const i = GROUP_KEYS.indexOf(g); return i >= 0 ? L.grp[i] : g; };

  const priceCols = [
    { h: L.col.venue, f: (r) => `<strong>${esc(r.venue)}</strong>` },
    { h: L.col.last, f: (r) => `<span class="mono">${fmtPrice(r.last)}</span>` },
    { h: L.col.chg, f: (r) => `<span class="mono ${cls(r.chgPct)}">${sgn(r.chgPct)}</span>` },
    { h: L.col.high, f: (r) => `<span class="mono">${fmtPrice(r.high)}</span>` },
    { h: L.col.low, f: (r) => `<span class="mono">${fmtPrice(r.low)}</span>` },
    { h: L.col.vol, f: (r) => `<span class="mono">${fmtUSD(r.volUSD)}</span>` },
  ];
  const posCols = [
    { h: L.col.venue, f: (r) => `<strong>${esc(r.venue)}</strong>` },
    { h: L.col.funding, f: (r) => `<span class="mono ${cls(r.fundingAnnPct)}">${sgn(r.fundingAnnPct, 1)}</span>` },
    { h: L.col.oi, f: (r) => `<span class="mono">${fmtUSD(r.oiUSD)}</span>` },
    { h: L.col.mark, f: (r) => `<span class="mono">${fmtPrice(r.mark)}</span>` },
  ];
  const section = (a, body) => `<div class="section"><div class="kicker">${esc(a[0])}</div><h2>${esc(a[1])}</h2>${a[2] ? `<p class="intro">${esc(a[2])}</p>` : ""}${body}</div>`;
  const noneP = (t) => `<p class="none">${esc(t)}</p>`;
  const venueTableL = (obj, cols) => { const rows = Object.values(obj).filter((r) => r && r.ok); if (!rows.length) return noneP(L.none.venue); return `<table><thead><tr>${cols.map((c) => `<th>${esc(c.h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => "<tr>" + cols.map((c) => `<td>${c.f(r)}</td>`).join("") + "</tr>").join("")}</tbody></table>`; };

  const cover = `
    <div class="cover-band"><div class="cover-mark">FD</div><div class="cover-brand">Futures Daily Report<span>${esc(L.tagline)}</span></div></div>
    <div class="kicker">${esc(L.daily)}</div>
    <h1>${esc(pack.dateLong || pack.dateUTC)}</h1>
    <div class="date">${esc(pack.coversUTC || "00:00–23:59 UTC")} · ${esc(L.dataFrom)}${pack.tradfi?.ok ? " + Twelve Data" : ""}</div>
    <div class="oneline"><div class="k">${esc(L.oneLine)}</div><p>${esc(s.oneLine || "—")}</p></div>`;

  const priceVol = section(L.price,
    `<h3>${esc(L.h3.btcP)}</h3>${venueTableL(pack.exchanges?.majors?.BTC || {}, priceCols)}
     <h3>${esc(L.h3.ethP)}</h3>${venueTableL(pack.exchanges?.majors?.ETH || {}, priceCols)}
     ${s.priceVolumeSummary ? `<p class="say">${esc(s.priceVolumeSummary)}</p>` : ""}`);

  const positioning = section(L.pos,
    `<h3>${esc(L.h3.btc)}</h3>${venueTableL(pack.exchanges?.majors?.BTC || {}, posCols)}
     <h3>${esc(L.h3.eth)}</h3>${venueTableL(pack.exchanges?.majors?.ETH || {}, posCols)}
     ${s.positioningSummary ? `<p class="say">${esc(s.positioningSummary)}</p>` : ""}`);

  const movers = pack.exchanges?.movers || [];
  const moverExpl = new Map((s.movers || []).map((m) => [m.symbol, m]));
  const moversBody = movers.length
    ? `<div class="movers">${movers.map((m) => {
        const e = moverExpl.get(m.symbol);
        const venues = Object.keys(m.venues || {}).filter((v) => m.venues[v]?.ok);
        return `<div class="m"><div><span class="sym">${esc(m.symbol)}</span> <span class="mono ${cls(m.chgPct / 100)}">${sgn(m.chgPct, 1)}</span> <span class="mono" style="color:var(--muted)">· ${fmtUSD(m.volUSD)} ${esc(L.vol)} · ${esc(L.on)} ${esc(venues.join(", ") || "Binance")}</span></div>${e ? `<div class="say">${esc(e.explanation)}</div>` : ""}</div>`;
      }).join("")}</div>`
    : noneP(L.none.movers);
  const moversSection = section(L.movers, moversBody);

  const st = pack.stocks || {};
  const rowsTable = (rows, { volMin = 5e4, limit = 10, label = L.col.stock } = {}) => {
    const list = (rows || []).filter((r) => (r.volUSD || 0) >= volMin).slice(0, limit);
    if (!list.length) return "";
    return `<table><thead><tr><th>${esc(label)}</th><th>${esc(L.col.last)}</th><th>${esc(L.col.chg)}</th><th>${esc(L.col.vol)}</th></tr></thead><tbody>${list.map((r) => `<tr><td><strong>${esc(r.name)}</strong> <span class="mono" style="color:var(--faint)">${esc(r.symbol.replace(/USDT$/, ""))}</span></td><td><span class="mono">${fmtPrice(r.last)}</span></td><td><span class="mono ${cls(r.chgPct / 100)}">${sgn(r.chgPct)}</span></td><td><span class="mono">${fmtUSD(r.volUSD)}</span></td></tr>`).join("")}</tbody></table>`;
  };
  const mktBlock = (mkt) => { const t = rowsTable(st.markets && st.markets[mkt], { limit: 8 }); return t ? `<h3>${esc(L.mkt[mkt] || mkt)}</h3>${t}` : ""; };
  const asiaTables = (st.asiaMarkets || ["KR_EQUITY", "HK_EQUITY", "CN_EQUITY"]).map(mktBlock).join("");
  const usMoversT = rowsTable(st.usMovers, { volMin: 1e6, limit: 8 });
  const usVolT = rowsTable(st.usTopVol, { volMin: 1e6, limit: 8 });
  const commoditiesT = rowsTable(st.commodities, { volMin: 0, limit: 8, label: L.col.commodity });
  const stocksBody = st.ok
    ? asiaTables +
      (usMoversT ? `<h3>${esc(L.h3.usMov)}</h3>${usMoversT}` : "") +
      (usVolT ? `<h3>${esc(L.h3.usVol)}</h3>${usVolT}` : "") +
      (commoditiesT ? `<h3>${esc(L.h3.comm)}</h3>${commoditiesT}` : "") +
      (s.stocksSummary ? `<p class="say">${esc(s.stocksSummary)}</p>` : "")
    : noneP(L.none.stocks);
  const stocksSection = section(L.stocks, stocksBody);

  const nTime = (n) => n.timeUTC || n.timeIstanbul || "";
  const newsItem = (n, top) => `<div class="newscard${top ? " top" : ""}"><div class="h">${esc(n.headline)}</div><div class="what">${esc(n.what)}</div><div class="meta">${n.coins ? esc(n.coins) + " · " : ""}${nTime(n) ? esc(nTime(n)) + " · " : ""}${n.url ? `<a href="${esc(n.url)}">${esc(n.source || L.source)}</a>` : esc(n.source || "")}</div></div>`;
  const groups = (s.news && s.news.groups) || {};
  const tradfiCard = pack.tradfi?.ok
    ? `<h3>${esc(L.h3.tradfi)}</h3><table><thead><tr><th>${esc(L.col.market)}</th><th>${esc(L.col.today)}</th><th>${esc(L.col.note)}</th></tr></thead><tbody>${pack.tradfi.items.map((t) => `<tr><td><strong>${esc(t.label)}</strong></td><td><span class="mono ${cls(t.changePct / 100)}">${sgn(t.changePct)}</span></td><td style="text-align:left;color:var(--muted);font-size:10.5px">${esc(t.proxy)}</td></tr>`).join("")}</tbody></table>`
    : "";
  const newsBody =
    (s.news?.topThree?.length ? `<h3>${esc(L.h3.top3)}</h3>${s.news.topThree.map((n) => newsItem(n, true)).join("")}` : "") +
    GROUP_KEYS.filter((g) => (groups[g] || []).length).map((g) => `<h3>${esc(grpLabel(g))}</h3>${groups[g].map((n) => newsItem(n, false)).join("")}`).join("") +
    (s.etfFlows ? `<h3>${esc(L.h3.etf)}</h3><div class="newscard"><div class="what">${esc(s.etfFlows.summary)}</div><div class="meta">${esc(s.etfFlows.date || "")} · ${s.etfFlows.url ? `<a href="${esc(s.etfFlows.url)}">${esc(s.etfFlows.source || L.source)}</a>` : esc(s.etfFlows.source || "")}</div></div>` : "") +
    tradfiCard +
    (!s.news?.topThree?.length && !GROUP_KEYS.some((g) => (groups[g] || []).length) && !tradfiCard ? noneP(L.none.news) : "");
  const newsSection = section(L.news, newsBody);

  const cal = pack.calendar || { today: [], week: [] };
  const calNote = new Map((s.calendarNotes || []).map((c) => [c.event, c.typicalReaction]));
  const calRow = (e) => `<div class="e"><span class="t">${esc(e.time)}</span><span style="flex:1"><strong>${esc(e.title)}</strong>${calNote.get(e.title) ? ` — <span style="color:var(--muted)">${esc(calNote.get(e.title))}</span>` : ""}</span><span class="fc">${esc(L.fc)} ${esc(e.forecast || "—")} · ${esc(L.prev)} ${esc(e.previous || "—")}</span></div>`;
  const calBody =
    (cal.today.length ? `<h3>${esc(L.h3.today)}</h3><div class="cal">${cal.today.map(calRow).join("")}</div>` : noneP(L.none.cal)) +
    (cal.week.length ? `<h3>${esc(L.h3.rest)}</h3><div class="cal">${cal.week.map((e) => `<div class="e"><span class="t">${esc(e.when.split(",")[0])}</span><span style="flex:1"><strong>${esc(e.title)}</strong></span><span class="fc">${esc(e.time)}</span></div>`).join("")}</div>` : "");
  const calSection = section(L.cal, calBody);

  const gloss = (s.glossary || []).slice().sort((a, b) => (a.term || "").localeCompare(b.term || ""));
  const glossSection = section(L.gloss,
    gloss.length ? `<div class="gloss">${gloss.map((g) => `<div class="g"><span class="term">${esc(g.term)}</span> — <span class="def">${esc(g.definition)}</span></div>`).join("")}</div>` : noneP(L.none.gloss));

  const src = synth?._source ? ` · narrative: ${esc(synth._source)}` : "";
  const foot = `<div class="foot">${esc(L.foot(pack.coversUTC || "00:00–23:59 UTC", pack.generatedAtUTC || "", ""))}${src}</div>`;

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${cover}${priceVol}${positioning}${moversSection}${stocksSection}${newsSection}${calSection}${glossSection}${foot}</body></html>`;
}

export { renderPdf };
