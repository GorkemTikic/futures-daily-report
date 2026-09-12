// News-candidate collector. Fetches the trade-press and primary-source RSS feeds,
// parses items, keeps the last ~30h, and de-dups obvious repeats. This produces the
// CANDIDATE list — the synthesis step does the real editorial filtering (drop price
// recaps, keep causes, group, mark unconfirmed) per REPORT_SPEC Step 3/4. Feeds that
// fail are recorded so the report can say which source was unavailable.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FuturesDailyReport/2.0";

const FEEDS = [
  { source: "CoinDesk", tier: 1, url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "The Block", tier: 1, url: "https://www.theblock.co/rss.xml" },
  { source: "Cointelegraph", tier: 1, url: "https://cointelegraph.com/rss" },
  { source: "Decrypt", tier: 1, url: "https://decrypt.co/feed" },
  { source: "SEC", tier: 2, url: "https://www.sec.gov/news/pressreleases.rss" },
  { source: "Federal Reserve", tier: 2, url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { source: "CFTC", tier: 2, url: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml" },
];

function stripCdata(s) {
  return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}
function atomLink(block) {
  const m = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  return m ? m[1] : "";
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = stripCdata(tag(b, "title"));
    let link = stripCdata(tag(b, "link")) || atomLink(b);
    const dateStr = tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || tag(b, "dc:date");
    const summary = stripCdata(tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded")).slice(0, 500);
    const ms = dateStr ? Date.parse(stripCdata(dateStr)) : NaN;
    if (title) items.push({ title, link: link.trim(), ms: isNaN(ms) ? null : ms, summary });
  }
  return items;
}

export async function collectNews({ windowH = 30, nowMs = Date.now() } = {}) {
  const cutoff = nowMs - windowH * 3600e3;
  const items = [];
  const failed = [];

  await Promise.all(FEEDS.map(async (f) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(f.url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" }, redirect: "follow", signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const parsed = parseFeed(xml);
      const fresh = parsed.filter((it) => it.ms == null || it.ms >= cutoff);
      // if a feed has NO dated item within the window, treat it as stale (skip) unless
      // every item is undated (some primary feeds omit dates) — keep a few of those.
      const dated = parsed.filter((it) => it.ms != null);
      const use = dated.length ? fresh.filter((it) => it.ms != null) : parsed.slice(0, 5);
      for (const it of use) items.push({ ...it, source: f.source, tier: f.tier });
    } catch (err) {
      failed.push({ source: f.source, err: String(err).slice(0, 80) });
    }
  }));

  // basic de-dup by normalised title prefix
  const seen = new Set();
  const deduped = [];
  for (const it of items.sort((a, b) => (b.ms || 0) - (a.ms || 0))) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").slice(0, 6).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  return { ok: true, count: deduped.length, items: deduped, failed, sourcesOnline: FEEDS.map((f) => f.source).filter((s) => !failed.find((x) => x.source === s)) };
}
