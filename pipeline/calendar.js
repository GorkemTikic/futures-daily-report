// Macro calendar collector — ForexFactory's this-week JSON.
// Keeps US High-impact events (plus a few named Medium ones), converts every time to
// UTC, and splits into today vs the rest of the week. The report is a UTC-day report,
// so everything here is UTC.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FuturesDailyReport/2.0";
// ForexFactory's this-week JSON (rolls forward through the week; past events are
// dropped below so the "what's scheduled" list is forward-looking). On a weekend
// boundary it can legitimately be empty — the report then says so rather than guessing.
const SOURCES = ["https://nfs.faireconomy.media/ff_calendar_thisweek.json"];

const MEDIUM_KEEP = /jobless claims|retail sales|powell|fomc/i;

function utcParts(iso) {
  // ForexFactory dates are ISO 8601 with a US offset; Date parses the offset correctly,
  // then we format in UTC.
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

export async function collectCalendar(nowMs = Date.now()) {
  let raw = [];
  const failed = [];
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.json();
      if (Array.isArray(arr)) raw = raw.concat(arr);
    } catch (err) { failed.push({ url, err: String(err).slice(0, 60) }); }
  }
  if (!raw.length) return { ok: false, source: SOURCES, err: failed.map((f) => f.err).join("; "), today: [], week: [] };

  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));

  const kept = [];
  for (const e of raw) {
    if (e.country !== "USD") continue;
    const impact = String(e.impact || "");
    const keep = impact === "High" || (impact === "Medium" && MEDIUM_KEEP.test(e.title || ""));
    if (!keep) continue;
    const u = utcParts(e.date);
    if (!u) continue;
    kept.push({
      title: e.title, impact, when: u.label, time: u.time, dayKey: u.dayKey, ms: u.ms,
      forecast: e.forecast || null, previous: e.previous || null, actual: e.actual || null,
    });
  }
  kept.sort((a, b) => a.ms - b.ms);

  return {
    ok: true, source: SOURCES,
    today: kept.filter((e) => e.dayKey === todayKey),
    // upcoming only: future events not on today's date, within ~10 days
    week: kept.filter((e) => e.dayKey !== todayKey && e.ms >= nowMs && e.ms <= nowMs + 10 * 24 * 3600e3),
  };
}
