// News-candidate collector. Fetches the trade-press and primary-source RSS feeds, parses
// items, bounds them to the REPORT DAY's UTC window (plus a small configurable lookback
// for stories that broke late the previous evening), sanitises them (they later go into
// an LLM prompt — see synthesize.js), and de-dups. This produces the CANDIDATE list; the
// synthesis step does the editorial filtering per REPORT_SPEC Step 3/4. Feeds that fail
// are recorded so the report can say which source was unavailable.

import { fetchText } from "./http.js";

const FEEDS = [
  { source: "CoinDesk", tier: 1, url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "The Block", tier: 1, url: "https://www.theblock.co/rss.xml" },
  { source: "Cointelegraph", tier: 1, url: "https://cointelegraph.com/rss" },
  { source: "CryptoSlate", tier: 1, url: "https://cryptoslate.com/feed/" },
  { source: "Decrypt", tier: 1, url: "https://decrypt.co/feed" },
  { source: "SEC", tier: 2, url: "https://www.sec.gov/news/pressreleases.rss" },
  { source: "Federal Reserve", tier: 2, url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { source: "CFTC", tier: 2, url: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml" },
];

const DAY_MS = 86400000;
const MAX_PER_FEED = 10;
const MAX_TITLE = 300;
const MAX_SUMMARY = 300;

// Remove control + zero-width characters, collapse whitespace, cap length. Applied to
// every field before it can reach the model prompt (defence-in-depth vs prompt injection).
// RegExps built from escaped strings so the SOURCE stays plain ASCII (no literal control
// or zero-width bytes embedded in the file).
const CONTROL_RE = new RegExp("[\\u0000-\\u001F\\u007F]", "g");        // control chars
const ZEROWIDTH_RE = new RegExp("[\\u200B-\\u200F\\u202A-\\u202E\\u2060\\uFEFF]", "g"); // zero-width / bidi
function clean(s, cap) {
  let t = String(s || "")
    .replace(CONTROL_RE, " ")
    .replace(ZEROWIDTH_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > cap) t = t.slice(0, cap) + "...";
  return t;
}

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
    const title = clean(stripCdata(tag(b, "title")), MAX_TITLE);
    let link = (stripCdata(tag(b, "link")) || atomLink(b)).trim();
    const dateStr = tag(b, "pubDate") || tag(b, "updated") || tag(b, "published") || tag(b, "dc:date");
    const summary = clean(stripCdata(tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded")), MAX_SUMMARY);
    const ms = dateStr ? Date.parse(stripCdata(dateStr)) : NaN;
    // keep only http(s) links; a non-http link is dropped rather than passed on
    if (link && !/^https?:\/\//i.test(link)) link = "";
    if (title) items.push({ title, link, ms: isNaN(ms) ? null : ms, summary });
  }
  return items;
}

export async function collectNews({ nowMs = Date.now(), win = null, config = {} } = {}) {
  const dayStart = win ? win.dayStartMs : nowMs - DAY_MS;
  const dayEnd = win ? win.dayEndMs : nowMs;
  const lookbackH = Number.isFinite(Number(config.newsLookbackH)) ? Number(config.newsLookbackH) : 6;
  const lowerBound = dayStart - lookbackH * 3600e3;
  const upperBound = Math.max(dayEnd, nowMs); // include fresh items after the day, marked as context

  const items = [];
  const failed = [];

  await Promise.all(FEEDS.map(async (f) => {
    try {
      const xml = await fetchText(f.url, { retries: 2, timeoutMs: 20000, headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
      const parsed = parseFeed(xml);
      const dated = parsed.filter((it) => it.ms != null);
      // Keep items inside [lowerBound, upperBound]; if a feed is entirely undated (some
      // primary feeds omit dates) keep a few most-recent so the source isn't lost.
      let use;
      if (dated.length) {
        use = dated.filter((it) => it.ms >= lowerBound && it.ms <= upperBound);
      } else {
        use = parsed.slice(0, 5);
      }
      use = use.slice(0, MAX_PER_FEED);
      for (const it of use) {
        const outside = it.ms == null ? false : (it.ms < dayStart || it.ms > dayEnd);
        items.push({ ...it, source: f.source, tier: f.tier, outsideReportDay: outside, undated: it.ms == null });
      }
    } catch (err) {
      failed.push({ source: f.source, err: String(err).slice(0, 80) });
    }
  }));

  // de-dup by normalised title prefix
  const seen = new Set();
  const deduped = [];
  for (const it of items.sort((a, b) => (b.ms || 0) - (a.ms || 0))) {
    const key = it.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").slice(0, 6).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  return {
    ok: true, count: deduped.length, items: deduped, failed,
    sourcesOnline: FEEDS.map((f) => f.source).filter((s) => !failed.find((x) => x.source === s)),
    window: { lowerBound, upperBound, lookbackH },
  };
}
