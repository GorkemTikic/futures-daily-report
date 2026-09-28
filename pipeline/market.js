// Market-level indicators: total crypto market cap, BTC/ETH dominance, and
// the Fear & Greed Index. All free APIs, no key required. Runs once per daily
// report — well within rate limits (CoinGecko: 30/min, Alternative.me: unlimited).

import { fetchJson } from "./http.js";

export async function collectMarket({ reportDateUTC } = {}) {
  const result = {
    ok: false,
    totalMarketCap: null,
    totalMarketCapChange24h: null,
    btcDominance: null,
    ethDominance: null,
    fearGreed: null,
    fearGreedPrev: null,
    failed: [],
  };

  const [cgResult, fngResult] = await Promise.allSettled([
    fetchJson("https://api.coingecko.com/api/v3/global", {
      timeoutMs: 15000,
      headers: { Accept: "application/json" },
    }),
    fetchJson("https://api.alternative.me/fng/?limit=7", { timeoutMs: 10000 }),
  ]);

  if (cgResult.status === "fulfilled" && cgResult.value?.data) {
    const d = cgResult.value.data;
    result.totalMarketCap = d.total_market_cap?.usd ?? null;
    result.totalMarketCapChange24h = d.market_cap_change_percentage_24h_usd ?? null;
    result.btcDominance = d.market_cap_percentage?.btc ?? null;
    result.ethDominance = d.market_cap_percentage?.eth ?? null;
    result.ok = true;
  } else {
    result.failed.push({ source: "CoinGecko", err: String(cgResult.reason || "no data").slice(0, 60) });
  }

  if (fngResult.status === "fulfilled" && fngResult.value?.data?.length) {
    const arr = fngResult.value.data;
    if (reportDateUTC) {
      const dayForEntry = (e) => new Date(Number(e.timestamp) * 1000).toISOString().slice(0, 10);
      const reportEntry = arr.find((e) => dayForEntry(e) === reportDateUTC);
      const prevIdx = reportEntry ? arr.indexOf(reportEntry) + 1 : -1;
      if (reportEntry) {
        result.fearGreed = { value: Number(reportEntry.value), label: reportEntry.value_classification, date: reportDateUTC };
        if (prevIdx >= 0 && prevIdx < arr.length) {
          result.fearGreedPrev = { value: Number(arr[prevIdx].value), label: arr[prevIdx].value_classification };
        }
      } else {
        result.fearGreed = { value: Number(arr[0].value), label: arr[0].value_classification, date: dayForEntry(arr[0]), live: true };
        if (arr[1]) result.fearGreedPrev = { value: Number(arr[1].value), label: arr[1].value_classification };
      }
    } else {
      result.fearGreed = { value: Number(arr[0].value), label: arr[0].value_classification };
      if (arr[1]) result.fearGreedPrev = { value: Number(arr[1].value), label: arr[1].value_classification };
    }
    if (!result.ok) result.ok = true;
  } else {
    result.failed.push({ source: "Fear & Greed", err: String(fngResult.reason || "no data").slice(0, 60) });
  }

  return result;
}
