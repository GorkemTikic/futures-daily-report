// Sorts each symbol's day into exactly one of 10 archetypes.
// Danger archetypes (mark-vs-last dislocations) are checked first.
// See daily_report_scenario_catalog.md for the full spec.

export function classify(m, thresholds) {
  const t = thresholds;
  const big = Math.abs(m.pctChange) >= t.bigMovePct;
  const up = m.pctChange > 0;
  const highVol = m.realizedVol1m >= t.highVolPct;
  const sustainedGap = m.minutesOver5 >= t.divDangerMinutes;
  const briefGap = m.maxDiv >= t.divBriefMaxPct && m.minutesOver5 < 3;

  const faded =
    m.high >= m.open * (1 + t.fadeRunupPct / 100) &&
    m.close <= m.open * (1 + t.fadeCloseMaxPct / 100);
  const recovered =
    m.low <= m.open * (1 - t.recoveryDropPct / 100) &&
    m.close >= m.low * (1 + t.recoveryBouncePct / 100);

  // --- danger first ---
  if (big && !up && sustainedGap) return "crash_with_mark_lag";
  if (big && up && sustainedGap) return "pump_with_mark_lag";
  if (briefGap) return "brief_gap_spike";

  // --- price-shape ---
  if (faded) return "pump_and_fade";
  if (recovered && Math.abs(m.pctChange) < 15) return "recovery";
  if (big && !up) return "steady_slide";
  if (big && up && highVol) return "clean_pump";
  if (big && up) return "steady_climb";
  if (highVol && m.intradayRangePct >= 15 && Math.abs(m.pctChange) < 10)
    return "choppy_volatile";
  // A quiet day that still had a real (>flag) gap is a brief dislocation, not "calm".
  if (m.maxDiv >= t.divFlagPct) return "brief_gap_spike";
  return "calm";
}

export const DANGER_ARCHETYPES = new Set([
  "crash_with_mark_lag",
  "pump_with_mark_lag",
  "brief_gap_spike",
]);

// A symbol earns a deep-dive page / CSV if it had a real divergence event,
// a big move, or a danger archetype. Severity ranks them for the page budget.
export function isFlagged(m, archetype, thresholds) {
  if (DANGER_ARCHETYPES.has(archetype)) return true;
  if (m.maxDiv >= thresholds.divFlagPct) return true;
  if (Math.abs(m.pctChange) >= thresholds.bigMovePct) return true;
  return false;
}

export function severity(m) {
  // Weighted so divergence (the dangerous thing) dominates, with move size second.
  return m.maxDiv * 3 + m.intradayRangePct + Math.abs(m.pctChange) * 0.5;
}
