// Per-symbol metric computation. ALL numbers the report ever shows are computed
// here — the narrative layer is never allowed to calculate or invent a number.

function hhmm(ms) {
  const d = new Date(ms);
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance =
    arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// last, mark: arrays of {t, open, high, low, close} (1-minute), not necessarily equal length.
export function computeMetrics(symbol, last, mark, vol24h) {
  if (!last || last.length < 2) return null;

  // Join mark to last by open time.
  const markByT = new Map(mark.map((m) => [m.t, m]));

  const open = last[0].open;
  const close = last[last.length - 1].close;
  let high = -Infinity;
  let low = Infinity;
  let markHigh = -Infinity;
  let markLow = Infinity;

  const returns = [];
  let prevClose = null;

  let maxDiv = 0;
  let maxDivMinute = null;
  let divSum = 0;
  let divCount = 0;
  let minutesOver2 = 0;
  let minutesOver5 = 0;

  // For longest streak of divergence > 5%
  let curStreakStart = null;
  let curStreakPeak = 0;
  let bestStreak = null;

  let biggest1m = { pct: 0, t: last[0].t };

  // bucket counts for biggest moves' timing
  const buckets = { morning: 0, afternoon: 0, evening: 0 };

  const perMinute = []; // for CSV of flagged symbols

  for (const l of last) {
    if (l.high > high) high = l.high;
    if (l.low < low) low = l.low;

    const m = markByT.get(l.t);
    const markClose = m ? m.close : null;
    if (m) {
      if (m.high > markHigh) markHigh = m.high;
      if (m.low < markLow) markLow = m.low;
    }

    let div = null;
    if (markClose !== null && l.close !== 0) {
      div = (Math.abs(markClose - l.close) / l.close) * 100;
      divSum += div;
      divCount++;
      if (div > 2) minutesOver2++;
      if (div > 5) minutesOver5++;
      if (div > maxDiv) {
        maxDiv = div;
        maxDivMinute = {
          t: l.t,
          last: l.close,
          mark: markClose,
          direction: markClose > l.close ? "above" : "below",
        };
      }
      // streak tracking (>5%)
      if (div > 5) {
        if (curStreakStart === null) {
          curStreakStart = l.t;
          curStreakPeak = div;
        } else {
          curStreakPeak = Math.max(curStreakPeak, div);
        }
      } else if (curStreakStart !== null) {
        const streak = {
          start: curStreakStart,
          end: l.t,
          peak: curStreakPeak,
        };
        if (!bestStreak || streakLen(streak) > streakLen(bestStreak)) bestStreak = streak;
        curStreakStart = null;
        curStreakPeak = 0;
      }
    }

    // 1-minute move
    if (prevClose !== null && prevClose !== 0) {
      const r = Math.log(l.close / prevClose);
      returns.push(r);
      const movePct = Math.abs(l.close / prevClose - 1) * 100;
      if (movePct > biggest1m.pct) biggest1m = { pct: movePct, t: l.t };
      if (movePct >= 1) {
        const h = new Date(l.t).getUTCHours();
        if (h < 8) buckets.morning++;
        else if (h < 16) buckets.afternoon++;
        else buckets.evening++;
      }
    }
    prevClose = l.close;

    perMinute.push({
      t: l.t,
      lOpen: l.open,
      lHigh: l.high,
      lLow: l.low,
      lClose: l.close,
      mClose: markClose,
      div,
    });
  }

  // close a trailing streak
  if (curStreakStart !== null) {
    const streak = {
      start: curStreakStart,
      end: last[last.length - 1].t,
      peak: curStreakPeak,
    };
    if (!bestStreak || streakLen(streak) > streakLen(bestStreak)) bestStreak = streak;
  }

  function streakLen(s) {
    return s.end - s.start;
  }

  const pctChange = ((close - open) / open) * 100;
  const intradayRangePct = low > 0 ? ((high - low) / low) * 100 : 0;
  const markRangePct =
    markLow > 0 && markLow !== Infinity ? ((markHigh - markLow) / markLow) * 100 : 0;
  const realizedVol1m = stddev(returns) * 100;
  const meanDiv = divCount ? divSum / divCount : 0;

  let dominantBucket = "all-day";
  const maxBucket = Math.max(buckets.morning, buckets.afternoon, buckets.evening);
  if (maxBucket > 0) {
    if (buckets.evening === maxBucket) dominantBucket = "evening";
    else if (buckets.afternoon === maxBucket) dominantBucket = "afternoon";
    else dominantBucket = "morning";
  }

  let longestDivStreak = null;
  if (bestStreak) {
    longestDivStreak = {
      startTime: hhmm(bestStreak.start),
      endTime: hhmm(bestStreak.end),
      durationMin: Math.round((bestStreak.end - bestStreak.start) / 60000),
      peakPct: bestStreak.peak,
    };
  }

  return {
    symbol,
    open,
    high,
    low,
    close,
    pctChange,
    intradayRangePct,
    markHigh,
    markLow,
    markRangePct,
    realizedVol1m,
    maxDiv,
    meanDiv,
    minutesOver2,
    minutesOver5,
    divPeak: maxDivMinute
      ? {
          time: hhmm(maxDivMinute.t),
          last: maxDivMinute.last,
          mark: maxDivMinute.mark,
          direction: maxDivMinute.direction,
        }
      : null,
    longestDivStreak,
    biggest1mMove: { time: hhmm(biggest1m.t), pct: biggest1m.pct },
    moveClustering: dominantBucket,
    volumeUSDT: vol24h ? vol24h.quoteVolume : null,
    candleCount: last.length,
    perMinute,
  };
}
