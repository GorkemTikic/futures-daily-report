// Macro calendar collector — ForexFactory's this-week JSON.
// Keeps US High-impact events (plus a few named Medium ones), converts every time to
// UTC, and files them relative to the REPORT DAY (not the run day), so a report headed
// "13 Sep" lists 13 Sep's releases — with their actual values — under "the report day",
// then what's scheduled next. The report is a UTC-day report, so everything here is UTC.

import { fetchJson } from "./http.js";

// ForexFactory's this-week JSON (rolls forward through the week). On a weekend boundary
// it can legitimately be empty — the report then says so rather than guessing.
const SOURCES = ["https://nfs.faireconomy.media/ff_calendar_thisweek.json"];
const MEDIUM_KEEP = /jobless claims|retail sales|powell|fomc/i;
const DAY_MS = 86400000;

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

export async function collectCalendar({ nowMs = Date.now(), reportDayKey = null } = {}) {
  let raw = [];
  const failed = [];
  for (const url of SOURCES) {
    try {
      const arr = await fetchJson(url, { timeoutMs: 20000 });
      if (Array.isArray(arr)) raw = raw.concat(arr);
    } catch (err) { failed.push({ url, err: String(err).slice(0, 60) }); }
  }
  if (!raw.length) return { ok: false, source: SOURCES, err: failed.map((f) => f.err).join("; "), reportDay: [], next24h: [], week: [] };

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

  const rdKey = reportDayKey || new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  const reportDay = kept.filter((e) => e.dayKey === rdKey);              // includes actuals
  const next24h = kept.filter((e) => e.ms > nowMs && e.ms <= nowMs + DAY_MS);
  const week = kept.filter((e) => e.dayKey !== rdKey && e.ms > nowMs + DAY_MS && e.ms <= nowMs + 10 * DAY_MS);

  return { ok: true, source: SOURCES, reportDayKey: rdKey, reportDay, next24h, week };
}
