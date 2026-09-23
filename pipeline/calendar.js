// Macro calendar collector — ForexFactory's this-week JSON + financecalendar.com iCal feed.
// Keeps US High-impact events (plus a few named Medium ones), converts every time to
// UTC, and files them relative to the REPORT DAY (not the run day), so a report headed
// "13 Sep" lists 13 Sep's releases — with their actual values — under "the report day",
// then what's scheduled next. The report is a UTC-day report, so everything here is UTC.
//
// The iCal feed from financecalendar.com adds broader coverage (NFP, FOMC, Trump speeches,
// CPI, PCE, GDP) with detailed descriptions. Events are de-duped by title + day.

import { fetchJson, fetchText } from "./http.js";

// ForexFactory's this-week JSON (rolls forward through the week). On a weekend boundary
// it can legitimately be empty — the report then says so rather than guessing.
const FF_SOURCE = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const FC_ICAL = "https://www.financecalendar.com/events/?ical=1";
const MEDIUM_KEEP = /jobless claims|retail sales|powell|fomc/i;
const DAY_MS = 86400000;

// Events that strongly move crypto — used for special warnings in the report.
const CRYPTO_MOVERS = /\b(non.?farm|nfp|fomc|fed.*rate|federal funds)\b/i;
const TRADFI_HIGH = /\b(cpi|pce|gdp|retail sales|jobless claims|ism)\b/i;
const TRUMP_RE = /\btrump\s+(speak|press|remarks|address|conference)/i;

function utcParts(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return { ms: d.getTime(), dayKey, time: `${parts.hour}:${parts.minute}`, label: `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} UTC` };
}

// Parse iCal VCALENDAR text into event objects.
function parseIcal(text) {
  const events = [];
  const blocks = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) || [];
  for (const block of blocks) {
    const field = (name) => {
      const re = new RegExp(`^${name}[^:]*:(.*)$`, "mi");
      const m = block.match(re);
      return m ? m[1].replace(/\\n/g, " ").replace(/\\,/g, ",").trim() : "";
    };
    const summary = field("SUMMARY");
    if (!summary) continue;

    // Parse DTSTART — may have TZID or be plain UTC
    let dtstart = "";
    const dsMatch = block.match(/DTSTART[^:]*:(\S+)/i);
    if (dsMatch) dtstart = dsMatch[1];

    // Convert to a JS Date
    let ms = NaN;
    if (/Z$/.test(dtstart)) {
      // UTC format: 20260917T120000Z
      ms = Date.parse(dtstart.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z"));
    } else if (/^\d{8}T\d{6}$/.test(dtstart)) {
      // Local time with TZID — approximate as ET (UTC-4 summer / UTC-5 winter)
      const iso = dtstart.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6");
      const tzMatch = block.match(/DTSTART;TZID=([^:]+):/i);
      const tz = tzMatch ? tzMatch[1] : "";
      if (/New_York|America\/New/.test(tz)) {
        // Use Intl to get the correct offset
        try {
          const localD = new Date(iso);
          const utcStr = localD.toLocaleString("en-US", { timeZone: "America/New_York" });
          const utcD = new Date(utcStr);
          const diff = localD.getTime() - utcD.getTime();
          ms = localD.getTime() + diff;
        } catch {
          ms = Date.parse(iso + "-04:00"); // fallback EDT
        }
      } else if (/UTC/.test(tz)) {
        ms = Date.parse(iso + "Z");
      } else {
        ms = Date.parse(iso + "Z"); // best effort
      }
    } else if (/^\d{8}$/.test(dtstart)) {
      // All-day event
      ms = Date.parse(dtstart.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") + "T12:00:00Z");
    }

    if (isNaN(ms)) continue;

    const categories = field("CATEGORIES");
    events.push({ summary, ms, categories, source: "financecalendar.com" });
  }
  return events;
}

// Tag events with special flags for the synthesis prompt.
function tagEvent(e) {
  const title = e.title || e.summary || "";
  const tags = [];
  if (CRYPTO_MOVERS.test(title)) tags.push("crypto-mover");
  if (TRADFI_HIGH.test(title)) tags.push("tradfi-high-impact");
  if (TRUMP_RE.test(title)) tags.push("trump-speech");
  return tags;
}

export async function collectCalendar({ nowMs = Date.now(), reportDayKey = null } = {}) {
  let raw = [];
  const failed = [];

  // Source 1: ForexFactory this-week JSON
  try {
    const arr = await fetchJson(FF_SOURCE, { timeoutMs: 20000 });
    if (Array.isArray(arr)) raw = raw.concat(arr);
  } catch (err) { failed.push({ url: FF_SOURCE, err: String(err).slice(0, 60) }); }

  // Source 2: financecalendar.com iCal feed
  let icalEvents = [];
  try {
    const icalText = await fetchText(FC_ICAL, { timeoutMs: 25000, headers: { Accept: "text/calendar" } });
    icalEvents = parseIcal(icalText);
  } catch (err) { failed.push({ url: FC_ICAL, err: String(err).slice(0, 60) }); }

  // Process ForexFactory events
  const kept = [];
  const seenKeys = new Set();
  for (const e of raw) {
    if (e.country !== "USD") continue;
    const impact = String(e.impact || "");
    const keep = impact === "High" || (impact === "Medium" && MEDIUM_KEEP.test(e.title || ""));
    if (!keep) continue;
    const u = utcParts(e.date);
    if (!u) continue;
    const tags = tagEvent({ title: e.title });
    const dedup = `${(e.title || "").toLowerCase().slice(0, 40)}|${u.dayKey}`;
    seenKeys.add(dedup);
    kept.push({
      title: e.title, impact, when: u.label, time: u.time, dayKey: u.dayKey, ms: u.ms,
      forecast: e.forecast || null, previous: e.previous || null, actual: e.actual || null,
      tags, source: "ForexFactory",
    });
  }

  // Merge iCal events (de-dup by title prefix + day)
  for (const ic of icalEvents) {
    const u = utcParts(new Date(ic.ms).toISOString());
    if (!u) continue;
    const titleNorm = ic.summary.toLowerCase().replace(/\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i, "").slice(0, 40);
    const dedup = `${titleNorm}|${u.dayKey}`;
    if (seenKeys.has(dedup)) continue;
    seenKeys.add(dedup);

    const isCryptoMover = CRYPTO_MOVERS.test(ic.summary);
    const isTradfiHigh = TRADFI_HIGH.test(ic.summary);
    const isTrump = TRUMP_RE.test(ic.summary);
    const isHighImpact = isCryptoMover || isTradfiHigh || isTrump || /rate decision|interest rate/i.test(ic.summary);
    if (!isHighImpact) continue;

    const tags = tagEvent({ title: ic.summary });
    kept.push({
      title: ic.summary, impact: isCryptoMover ? "High" : "Medium", when: u.label, time: u.time,
      dayKey: u.dayKey, ms: u.ms, forecast: null, previous: null, actual: null,
      tags, source: "financecalendar.com",
    });
  }

  kept.sort((a, b) => a.ms - b.ms);

  const rdKey = reportDayKey || new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  const reportDay = kept.filter((e) => e.dayKey === rdKey);
  const next24h = kept.filter((e) => e.ms > nowMs && e.ms <= nowMs + DAY_MS);
  const week = kept.filter((e) => e.dayKey !== rdKey && e.ms > nowMs + DAY_MS && e.ms <= nowMs + 10 * DAY_MS);

  // Build volatility warnings for tomorrow's big events
  const tomorrowKey = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(nowMs + DAY_MS));
  const tomorrowBig = kept.filter((e) => e.dayKey === tomorrowKey && e.tags && e.tags.length > 0);
  const warnings = tomorrowBig.map((e) => {
    if (e.tags.includes("crypto-mover")) {
      return { event: e.title, time: e.time, when: e.when, type: "crypto", message: `${e.title} is scheduled for ${e.when}. This data strongly moves crypto — expect high volatility in BTC and altcoins.` };
    }
    if (e.tags.includes("trump-speech")) {
      return { event: e.title, time: e.time, when: e.when, type: "trump", message: `President Trump is scheduled to speak at ${e.when}. Markets may react with elevated volatility.` };
    }
    if (e.tags.includes("tradfi-high-impact")) {
      return { event: e.title, time: e.time, when: e.when, type: "tradfi", message: `${e.title} is scheduled for ${e.when}. This is a high-impact release — expect volatility in traditional markets.` };
    }
    return null;
  }).filter(Boolean);

  // Tag report-day events that are crypto movers (for the synthesis prompt to attribute moves)
  const cryptoMoversToday = reportDay.filter((e) => e.tags && e.tags.includes("crypto-mover"));
  const trumpToday = reportDay.filter((e) => e.tags && e.tags.includes("trump-speech"));

  return {
    ok: true,
    source: [FF_SOURCE, FC_ICAL],
    reportDayKey: rdKey, reportDay, next24h, week,
    warnings,
    cryptoMoversToday,
    trumpToday,
    failed,
  };
}
