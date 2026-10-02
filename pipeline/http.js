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
    const res = await fetch(url, {
      method,
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      redirect: "follow",
      signal: ctrl.signal,
      ...(body != null ? { body } : {}),
    });
    // Keep the timer alive until the body is consumed
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function retryableStatus(status) {
  // Don't retry 4xx (client errors) except 429 (rate limit)
  if (status >= 400 && status < 500 && status !== 429) return false;
  return true;
}

function parseRetryAfter(res) {
  const ra = res.headers.get("Retry-After");
  if (!ra) return null;
  const secs = Number(ra);
  if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 30000);
  return null;
}

export async function fetchJson(url, { retries = 2, timeoutMs = 20000, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": UA, Accept: "application/json", ...headers },
        redirect: "follow",
        signal: ctrl.signal,
      });
      if (!res.ok) {
        if (!retryableStatus(res.status)) {
          clearTimeout(timer);
          throw new Error(`HTTP ${res.status}`);
        }
        const retryMs = parseRetryAfter(res);
        clearTimeout(timer);
        throw Object.assign(new Error(`HTTP ${res.status}`), { retryMs });
      }
      const data = await res.json();
      clearTimeout(timer);
      return data;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        const delay = err.retryMs || 400 * (attempt + 1);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

export async function fetchText(url, { retries = 2, timeoutMs = 20000, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": UA, Accept: "text/plain, text/html, */*", ...headers },
        redirect: "follow",
        signal: ctrl.signal,
      });
      if (!res.ok) {
        if (!retryableStatus(res.status)) {
          clearTimeout(timer);
          throw new Error(`HTTP ${res.status}`);
        }
        clearTimeout(timer);
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.text();
      clearTimeout(timer);
      return data;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

export const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
