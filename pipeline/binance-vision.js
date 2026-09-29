// Binance Vision bulk archive — data.binance.vision
//
// Free, unauthenticated CSV-in-ZIP downloads of historical Binance futures data.
// Used as: (a) fallback when the live kline API fails or returns nothing for a past
// day, and (b) the ONLY source of positioning data (OI, L/S, taker ratio) on backfill
// runs where the live snapshot APIs are deliberately skipped.
//
// Data types consumed:
//   klines   – OHLCV (same 12 columns as the REST API)
//   metrics  – 5-min snapshots: OI, L/S account ratio, top-trader L/S, taker ratio

import { fetchWithTimeout } from "./http.js";

const BASE = "https://data.binance.vision/data/futures/um/daily";

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

function dateKey(dayStartMs) {
  const d = new Date(dayStartMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchZipCsv(url) {
  const res = await fetchWithTimeout(url, { timeoutMs: 30000 });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());

  // Minimal ZIP parser — each archive has exactly one CSV.
  // ZIP end-of-central-directory signature: 0x06054b50
  let eocdOff = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdOff = i; break; }
  }
  if (eocdOff < 0) return null;

  const cdOff = buf.readUInt32LE(eocdOff + 16);
  // Local file header at the offset the central directory points to
  const lfhOff = buf.readUInt32LE(cdOff + 42);
  if (buf.readUInt32LE(lfhOff) !== 0x04034b50) return null;

  const compMethod = buf.readUInt16LE(lfhOff + 8);
  const compSize = buf.readUInt32LE(lfhOff + 18);
  const fnLen = buf.readUInt16LE(lfhOff + 26);
  const exLen = buf.readUInt16LE(lfhOff + 28);
  const dataStart = lfhOff + 30 + fnLen + exLen;
  const raw = buf.subarray(dataStart, dataStart + compSize);

  let csv;
  if (compMethod === 0) {
    csv = raw.toString("utf8");
  } else if (compMethod === 8) {
    const { inflateRawSync } = await import("node:zlib");
    csv = inflateRawSync(raw).toString("utf8");
  } else {
    return null;
  }
  return csv;
}

function parseCsvRows(csv) {
  const lines = csv.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const hdr = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const row = {};
    for (let i = 0; i < hdr.length; i++) row[hdr[i].trim()] = vals[i]?.trim();
    return row;
  });
}

// Fetch a daily 1d kline from the archive. Returns the same shape as klineBinance
// or null if unavailable.
export async function visionKline(symbol, dayStartMs) {
  const dk = dateKey(dayStartMs);
  const url = `${BASE}/klines/${symbol}/1d/${symbol}-1d-${dk}.zip`;
  try {
    const csv = await fetchZipCsv(url);
    if (!csv) return null;
    const rows = parseCsvRows(csv);
    const k = rows.find((r) => Math.abs(num(r.open_time) - dayStartMs) <= 60000);
    if (!k) return null;
    return {
      ts: num(k.open_time),
      open: num(k.open),
      high: num(k.high),
      low: num(k.low),
      close: num(k.close),
      quoteVol: num(k.quote_volume),
    };
  } catch { return null; }
}

// Fetch daily metrics (OI, L/S, taker ratio) and aggregate into positioning fields.
// Returns an object matching the shape binancePositioning() produces.
export async function visionMetrics(symbol, dayStartMs, dayEndMs) {
  const dk = dateKey(dayStartMs);
  const url = `${BASE}/metrics/${symbol}/${symbol}-metrics-${dk}.zip`;
  try {
    const csv = await fetchZipCsv(url);
    if (!csv) return null;
    const rows = parseCsvRows(csv);
    if (!rows.length) return null;

    const out = {};

    // OI change: first vs last snapshot of the day
    const withOi = rows.filter((r) => num(r.sum_open_interest) != null);
    if (withOi.length >= 2) {
      const first = withOi[0], last = withOi[withOi.length - 1];
      const startOi = num(first.sum_open_interest);
      const endOi = num(last.sum_open_interest);
      const startOiVal = num(first.sum_open_interest_value);
      const endOiVal = num(last.sum_open_interest_value);
      if (startOi) out.oiChangePctCoins = ((endOi - startOi) / startOi) * 100;
      if (startOiVal) out.oiChangePct = ((endOiVal - startOiVal) / startOiVal) * 100;
      // Provide the end-of-day OI so the record can show it
      out.oiCoins = endOi;
      out.oiUSD = endOiVal;
    }

    // L/S ratios: use the last snapshot of the day (closest to end-of-day)
    const lastRow = rows[rows.length - 1];
    const lsAccount = num(lastRow.count_long_short_ratio);
    if (lsAccount != null) out.longShortAccount = lsAccount;
    const lsTop = num(lastRow.sum_toptrader_long_short_ratio);
    if (lsTop != null) out.topPositionRatio = lsTop;

    // Taker ratio: average across the day for a representative figure
    const takerVals = rows.map((r) => num(r.sum_taker_long_short_vol_ratio)).filter((v) => v != null);
    if (takerVals.length) {
      const avg = takerVals.reduce((a, b) => a + b, 0) / takerVals.length;
      out.takerBuySellRatio = avg;
      out.takerBuyRatio = avg / (1 + avg);
    }

    out._source = "binance-vision";
    return out;
  } catch { return null; }
}

// Fetch 5-minute intraday klines for chart rendering.
// Returns [{ts, open, high, low, close, vol}] sorted by time, or null.
export async function visionIntraday5m(symbol, dayStartMs) {
  const dk = dateKey(dayStartMs);
  const url = `${BASE}/klines/${symbol}/5m/${symbol}-5m-${dk}.zip`;
  try {
    const csv = await fetchZipCsv(url);
    if (!csv) return null;
    const rows = parseCsvRows(csv);
    return rows.map((r) => ({
      ts: num(r.open_time),
      open: num(r.open),
      high: num(r.high),
      low: num(r.low),
      close: num(r.close),
      vol: num(r.quote_volume),
    })).filter((r) => r.ts != null && r.close != null).sort((a, b) => a.ts - b.ts);
  } catch { return null; }
}

// Return the raw metrics timeseries for chart rendering.
// Returns [{ts, oi, oiUSD, ls, topLs, taker}] sorted by time, or null.
export async function visionMetricsTimeseries(symbol, dayStartMs) {
  const dk = dateKey(dayStartMs);
  const url = `${BASE}/metrics/${symbol}/${symbol}-metrics-${dk}.zip`;
  try {
    const csv = await fetchZipCsv(url);
    if (!csv) return null;
    const rows = parseCsvRows(csv);
    return rows.map((r) => ({
      ts: Date.parse(r.create_time + "Z"),
      oi: num(r.sum_open_interest),
      oiUSD: num(r.sum_open_interest_value),
      ls: num(r.count_long_short_ratio),
      topLs: num(r.sum_toptrader_long_short_ratio),
      taker: num(r.sum_taker_long_short_vol_ratio),
    })).filter((r) => !isNaN(r.ts)).sort((a, b) => a.ts - b.ts);
  } catch { return null; }
}
