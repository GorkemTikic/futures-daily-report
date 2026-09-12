// Inline-SVG chart builders. No external libraries — the SVG is embedded straight
// into the report HTML so it renders identically in headless Chrome (the PDF path),
// in a browser, and in the standalone .html. Every chart is a pure function of the
// numbers metrics.js already computed; nothing here invents data.

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pad(n) {
  return String(n).padStart(2, "0");
}
function hhmm(ms) {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// Format a price compactly for an axis label.
function axisPrice(x) {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  if (Math.abs(x) >= 1000) return "$" + x.toFixed(0);
  if (Math.abs(x) >= 1) return "$" + x.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  if (Math.abs(x) >= 0.01) return "$" + x.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
  return "$" + x.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

// Build a polyline "points" attribute from [{x,y}] in SVG pixel space.
function points(pts) {
  return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

// ---------------------------------------------------------------------------
// Per-coin chart: live (last) price vs mark price across the day, with the
// >5% danger-gap minutes shaded. This is the picture behind each story page.
// ---------------------------------------------------------------------------
export function priceVsMarkChart(perMinute, opts = {}) {
  const W = opts.width || 660;
  const H = opts.height || 240;
  const padL = 58, padR = 14, padT = 14, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const rows = (perMinute || []).filter((p) => p && isFinite(p.lClose));
  if (rows.length < 2) return "";

  const t0 = rows[0].t;
  const t1 = rows[rows.length - 1].t;
  const tSpan = Math.max(1, t1 - t0);

  // y-domain across BOTH lines
  let lo = Infinity, hi = -Infinity;
  for (const p of rows) {
    for (const v of [p.lClose, p.mClose]) {
      if (v !== null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  if (!isFinite(lo) || !isFinite(hi) || hi === lo) { hi = lo + 1; }
  const yPad = (hi - lo) * 0.06;
  lo -= yPad; hi += yPad;

  const xOf = (t) => padL + ((t - t0) / tSpan) * plotW;
  const yOf = (v) => padT + (1 - (v - lo) / (hi - lo)) * plotH;

  // danger-zone shading (div > 5%) — one rect per contiguous run
  let bands = "";
  let runStart = null;
  for (let i = 0; i < rows.length; i++) {
    const danger = rows[i].div !== null && rows[i].div > 5;
    if (danger && runStart === null) runStart = rows[i].t;
    if ((!danger || i === rows.length - 1) && runStart !== null) {
      const end = danger ? rows[i].t : rows[i - 1] ? rows[i - 1].t : rows[i].t;
      const x = xOf(runStart);
      const w = Math.max(1.2, xOf(end) - x);
      bands += `<rect x="${x.toFixed(1)}" y="${padT}" width="${w.toFixed(1)}" height="${plotH}" fill="#f8d7d5"/>`;
      runStart = null;
    }
  }

  const lastPts = points(rows.filter((p) => isFinite(p.lClose)).map((p) => ({ x: xOf(p.t), y: yOf(p.lClose) })));
  const markRows = rows.filter((p) => p.mClose !== null && isFinite(p.mClose));
  const markPts = markRows.length >= 2 ? points(markRows.map((p) => ({ x: xOf(p.t), y: yOf(p.mClose) }))) : "";

  // y grid: 4 lines
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    const y = yOf(v);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#eceef1"/>`;
    grid += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#8a8f98">${esc(axisPrice(v))}</text>`;
  }
  // x ticks: start / mid / end
  let xticks = "";
  for (const frac of [0, 0.5, 1]) {
    const t = t0 + tSpan * frac;
    const x = xOf(t);
    xticks += `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="${frac === 0 ? "start" : frac === 1 ? "end" : "middle"}" font-size="9" fill="#8a8f98">${hhmm(t)}</text>`;
  }

  const markLine = markPts ? `<polyline fill="none" stroke="#e08a1e" stroke-width="1.6" points="${markPts}"/>` : "";
  const legend = `
    <g font-size="9.5" fill="#5b6169">
      <rect x="${padL}" y="${padT - 2}" width="10" height="3" fill="#2f6fd0"/>
      <text x="${padL + 14}" y="${padT + 2}">Live (last) price</text>
      <rect x="${padL + 120}" y="${padT - 2}" width="10" height="3" fill="#e08a1e"/>
      <text x="${padL + 134}" y="${padT + 2}">Mark price</text>
      ${bands ? `<rect x="${padL + 220}" y="${padT - 3}" width="10" height="6" fill="#f8d7d5"/><text x="${padL + 234}" y="${padT + 2}">gap &gt;5% (danger)</text>` : ""}
    </g>`;

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
    ${bands}
    ${grid}
    ${markLine}
    <polyline fill="none" stroke="#2f6fd0" stroke-width="1.6" points="${lastPts}"/>
    ${xticks}
    ${legend}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Market-overview chart: BTC and ETH normalised to % change from the day's open,
// so two very different price levels share one axis. Shows the macro backdrop.
// series = [{t, close}] (1-minute). Returns "" if not enough data.
// ---------------------------------------------------------------------------
export function marketOverviewChart(seriesMap, opts = {}) {
  const W = opts.width || 660;
  const H = opts.height || 220;
  const padL = 46, padR = 14, padT = 16, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const colors = { BTC: "#f2a900", ETH: "#627eea", SOL: "#14b58b" };
  const entries = Object.entries(seriesMap).filter(([, s]) => s && s.length >= 2);
  if (!entries.length) return "";

  // normalise each series to % change from its own open; find shared t-range and y-range
  let t0 = Infinity, t1 = -Infinity, lo = Infinity, hi = -Infinity;
  const norm = {};
  for (const [name, s] of entries) {
    const open = s[0].close;
    const pts = s.filter((p) => isFinite(p.close) && open).map((p) => ({ t: p.t, pct: (p.close / open - 1) * 100 }));
    norm[name] = pts;
    for (const p of pts) {
      if (p.t < t0) t0 = p.t; if (p.t > t1) t1 = p.t;
      if (p.pct < lo) lo = p.pct; if (p.pct > hi) hi = p.pct;
    }
  }
  const tSpan = Math.max(1, t1 - t0);
  if (!isFinite(lo) || !isFinite(hi)) return "";
  if (hi === lo) { hi += 1; lo -= 1; }
  const yPad = (hi - lo) * 0.1 || 0.5;
  lo -= yPad; hi += yPad;
  // make sure the zero line is inside the frame
  lo = Math.min(lo, -0.01); hi = Math.max(hi, 0.01);

  const xOf = (t) => padL + ((t - t0) / tSpan) * plotW;
  const yOf = (v) => padT + (1 - (v - lo) / (hi - lo)) * plotH;

  // grid + y labels (%), 4 rows
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    const y = yOf(v);
    grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#eceef1"/>`;
    grid += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#8a8f98">${(v >= 0 ? "+" : "") + v.toFixed(1)}%</text>`;
  }
  // zero line emphasised
  const yz = yOf(0);
  grid += `<line x1="${padL}" y1="${yz.toFixed(1)}" x2="${W - padR}" y2="${yz.toFixed(1)}" stroke="#c7ccd3" stroke-dasharray="3 3"/>`;

  let xticks = "";
  for (const frac of [0, 0.5, 1]) {
    const t = t0 + tSpan * frac;
    xticks += `<text x="${xOf(t).toFixed(1)}" y="${H - 8}" text-anchor="${frac === 0 ? "start" : frac === 1 ? "end" : "middle"}" font-size="9" fill="#8a8f98">${hhmm(t)}</text>`;
  }

  let lines = "", legend = "";
  let lx = padL;
  for (const [name, pts] of Object.entries(norm)) {
    const col = colors[name] || "#888";
    lines += `<polyline fill="none" stroke="${col}" stroke-width="1.7" points="${points(pts.map((p) => ({ x: xOf(p.t), y: yOf(p.pct) })))}"/>`;
    const last = pts[pts.length - 1];
    const lbl = `${name} ${(last.pct >= 0 ? "+" : "") + last.pct.toFixed(1)}%`;
    legend += `<rect x="${lx}" y="${padT - 8}" width="10" height="3" fill="${col}"/><text x="${lx + 14}" y="${padT - 4}" font-size="9.5" fill="#5b6169">${esc(lbl)}</text>`;
    lx += 14 + lbl.length * 5.6 + 16;
  }

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
    ${grid}
    ${lines}
    ${xticks}
    <g>${legend}</g>
  </svg>`;
}
