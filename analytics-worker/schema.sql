-- D1 (SQLite) schema for the Futures Daily Report website analytics.
-- Apply with:  wrangler d1 execute fdr-analytics-db --file=schema.sql --remote
--
-- Mirrors the Futures DeskMate analytics table: one row per event, only safe
-- metadata, a hashed IP (never raw), and a country from Cloudflare's header.

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  event_type  TEXT    NOT NULL,
  session_id  TEXT    NOT NULL,
  device_id   TEXT,
  ip_hash     TEXT,                  -- per-UTC-day HMAC-SHA256(IP, secret pepper), 16 hex — never raw; null if no IP_HASH_SECRET set
  country     TEXT    DEFAULT 'XX',  -- ISO-3166-1 alpha-2 from CF-IPCountry
  tab         TEXT    DEFAULT '',
  props       TEXT    DEFAULT '{}',  -- JSON blob (e.g. {"date":"2026-09-10"} or {"host":"..."} )
  ts          INTEGER NOT NULL       -- Unix milliseconds (client clock)
);

CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type    ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_device  ON events(device_id);
CREATE INDEX IF NOT EXISTS idx_events_country ON events(country);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(event_type, ts);
