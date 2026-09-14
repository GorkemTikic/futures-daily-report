// Shared HTTP + small utilities for the pipeline.
//
// fetchJson: one timeout-bounded, retrying JSON GET used by every collector
// (exchanges, calendar, news, tradfi, stocks) so behaviour is identical everywhere.
// Node's global fetch has NO default timeout, so a hung socket would otherwise park
// the whole run until the scheduler kills it — every request here is bounded by an
// AbortController. It also sleeps ONLY between attempts, never after the final one.

export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FuturesDailyReport/2.0";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithTimeout(url, { timeoutMs = 20000, headers = {}, method = "GET", body = null } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      redirect: "follow",
      signal: ctrl.signal,
      ...(body != null ? { body } : {}),
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, { retries = 2, timeoutMs = 20000, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs, headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      // Only back off BETWEEN attempts — never after the last one (that was a bug:
      // it added a pointless 1.2s sleep to every failed section).
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function fetchText(url, { retries = 2, timeoutMs = 20000, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, { timeoutMs, headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

export const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
