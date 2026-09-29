// SVG chart generators for the PDF report.
// All charts are pure SVG strings (no JS, CSP-safe) using the report's CSS variables.

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function range(arr, fn) {
  let min = Infinity, max = -Infinity;
  for (const item of arr) {
    const v = fn(item);
    if (v != null && isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
  }
  return min <= max ? [min, max] : [0, 1];
}

function niceAxis(min, max, ticks = 5) {
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;
  const rough = range / (ticks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const nice = [1, 2, 2.5, 5, 10].find((n) => n * mag >= rough) * mag;
  const lo = Math.floor(min / nice) * nice;
  const hi = Math.ceil(max / nice) * nice;
  const vals = [];
  for (let v = lo; v <= hi + nice * 0.01; v += nice) vals.push(Math.round(v * 1e8) / 1e8);
  return vals;
}

function fmtK(v) {
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(0) + "K";
  return v.toFixed(v % 1 ? 2 : 0);
}

function fmtPrice(v) {
  if (Math.abs(v) >= 100) return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return "$" + v.toFixed(2);
}

function fmtHour(ts) {
  const d = new Date(ts);
  return String(d.getUTCHours()).padStart(2, "0") + ":00";
}

function fmtDate(ts) {
  const d = new Date(ts);
  return String(d.getUTCMonth() + 1) + "/" + String(d.getUTCDate());
}

// Intraday price line chart with volume bars underneath.
// data: [{ts, close, vol}]
export function intradayPriceChart(data, { w = 520, h = 180, label = "BTC", color = "#c2410c" } = {}) {
  if (!data || data.length < 2) return "";
  const pad = { top: 22, right: 52, bottom: 28, left: 8 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const volH = 30;

  const [pMin, pMax] = range(data, (d) => d.close);
  const [, vMax] = range(data, (d) => d.vol);
  const tMin = data[0].ts, tMax = data[data.length - 1].ts;
  const tRange = tMax - tMin || 1;

  const x = (ts) => pad.left + ((ts - tMin) / tRange) * cw;
  const y = (p) => pad.top + (1 - (p - pMin) / (pMax - pMin || 1)) * (ch - volH);
  const yVol = (v) => pad.top + ch - (v / (vMax || 1)) * volH;

  const pricePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.ts).toFixed(1)},${y(d.close).toFixed(1)}`).join("");
  const areaPath = pricePath + `L${x(tMax).toFixed(1)},${(pad.top + ch - volH).toFixed(1)}L${x(tMin).toFixed(1)},${(pad.top + ch - volH).toFixed(1)}Z`;

  // Volume bars (sampled to ~48 bars)
  const step = Math.max(1, Math.floor(data.length / 48));
  const volBars = [];
  for (let i = 0; i < data.length; i += step) {
    const d = data[i];
    const bw = Math.max(1, (cw / 48) * 0.7);
    const bh = (d.vol / (vMax || 1)) * volH;
    volBars.push(`<rect x="${(x(d.ts) - bw / 2).toFixed(1)}" y="${(pad.top + ch - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" opacity="0.15"/>`);
  }

  // Y-axis labels (price)
  const yTicks = niceAxis(pMin, pMax, 4);
  const yLabels = yTicks.filter((v) => v >= pMin && v <= pMax).map((v) =>
    `<text x="${w - pad.right + 4}" y="${y(v).toFixed(1)}" fill="var(--muted)" font-size="8" dominant-baseline="middle">${fmtPrice(v)}</text>` +
    `<line x1="${pad.left}" x2="${w - pad.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line2)" stroke-width="0.5"/>`
  ).join("");

  // X-axis labels (hours)
  const hours = [0, 4, 8, 12, 16, 20].map((hr) => tMin + hr * 3600000).filter((t) => t <= tMax);
  const xLabels = hours.map((t) =>
    `<text x="${x(t).toFixed(1)}" y="${(h - 4).toFixed(1)}" fill="var(--muted)" font-size="8" text-anchor="middle">${fmtHour(t)}</text>`
  ).join("");

  const open = data[0].close, close = data[data.length - 1].close;
  const chg = open ? ((close - open) / open * 100) : 0;
  const chgColor = chg >= 0 ? "var(--pos)" : "var(--neg)";
  const chgStr = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${w}px;font-family:'SF Mono',Consolas,monospace;">
    <text x="${pad.left}" y="14" fill="var(--ink)" font-size="10" font-weight="700" font-family="inherit">${esc(label)}</text>
    <text x="${pad.left + 30}" y="14" fill="${chgColor}" font-size="9" font-weight="600">${chgStr}</text>
    ${yLabels}${xLabels}
    ${volBars.join("")}
    <path d="${areaPath}" fill="${color}" opacity="0.06"/>
    <path d="${pricePath}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${x(tMax).toFixed(1)}" cy="${y(close).toFixed(1)}" r="2.5" fill="${color}"/>
  </svg>`;
}

// Intraday OI + taker ratio dual-axis chart.
// metrics: [{ts, oiUSD, taker}]
export function intradayOiChart(metrics, { w = 520, h = 140, label = "BTC" } = {}) {
  if (!metrics || metrics.length < 2) return "";
  const pad = { top: 22, right: 52, bottom: 28, left: 8 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const withOi = metrics.filter((m) => m.oiUSD != null);
  const withTaker = metrics.filter((m) => m.taker != null);
  if (withOi.length < 2) return "";

  const [oiMin, oiMax] = range(withOi, (m) => m.oiUSD);
  const tMin = metrics[0].ts, tMax = metrics[metrics.length - 1].ts;
  const tRange = tMax - tMin || 1;

  const x = (ts) => pad.left + ((ts - tMin) / tRange) * cw;
  const yOi = (v) => pad.top + (1 - (v - oiMin) / (oiMax - oiMin || 1)) * ch;

  const oiPath = withOi.map((m, i) => `${i === 0 ? "M" : "L"}${x(m.ts).toFixed(1)},${yOi(m.oiUSD).toFixed(1)}`).join("");

  // Taker ratio as colored dots along the bottom
  let takerDots = "";
  if (withTaker.length > 2) {
    const step = Math.max(1, Math.floor(withTaker.length / 60));
    for (let i = 0; i < withTaker.length; i += step) {
      const m = withTaker[i];
      const col = m.taker > 1.05 ? "var(--pos)" : m.taker < 0.95 ? "var(--neg)" : "var(--muted)";
      takerDots += `<circle cx="${x(m.ts).toFixed(1)}" cy="${(pad.top + ch + 6).toFixed(1)}" r="1.5" fill="${col}" opacity="0.6"/>`;
    }
  }

  // Y-axis labels (OI)
  const oiTicks = niceAxis(oiMin, oiMax, 4);
  const yLabels = oiTicks.filter((v) => v >= oiMin && v <= oiMax).map((v) =>
    `<text x="${w - pad.right + 4}" y="${yOi(v).toFixed(1)}" fill="var(--muted)" font-size="8" dominant-baseline="middle">$${fmtK(v)}</text>` +
    `<line x1="${pad.left}" x2="${w - pad.right}" y1="${yOi(v).toFixed(1)}" y2="${yOi(v).toFixed(1)}" stroke="var(--line2)" stroke-width="0.5"/>`
  ).join("");

  // X-axis
  const hours = [0, 4, 8, 12, 16, 20].map((hr) => tMin + hr * 3600000).filter((t) => t <= tMax);
  const xLabels = hours.map((t) =>
    `<text x="${x(t).toFixed(1)}" y="${(h - 4).toFixed(1)}" fill="var(--muted)" font-size="8" text-anchor="middle">${fmtHour(t)}</text>`
  ).join("");

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${w}px;font-family:'SF Mono',Consolas,monospace;">
    <text x="${pad.left}" y="14" fill="var(--ink)" font-size="10" font-weight="700" font-family="inherit">${esc(label)} — Open Interest</text>
    ${yLabels}${xLabels}
    <path d="${oiPath}" fill="none" stroke="var(--info)" stroke-width="1.5" stroke-linejoin="round" opacity="0.8"/>
    ${takerDots}
    ${withTaker.length > 2 ? `<text x="${pad.left}" y="${(pad.top + ch + 10).toFixed(1)}" fill="var(--muted)" font-size="7">Taker B/S: <tspan fill="var(--pos)">●</tspan> buy &gt; sell  <tspan fill="var(--neg)">●</tspan> sell &gt; buy</text>` : ""}
  </svg>`;
}

// 45-day trend sparkline with a shaded area.
// data: [{ts, close}]
export function trendChart(data, { w = 250, h = 60, label = "BTC", color = "#c2410c" } = {}) {
  if (!data || data.length < 3) return "";
  const pad = { top: 14, right: 40, bottom: 12, left: 4 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const [pMin, pMax] = range(data, (d) => d.close);
  const tMin = data[0].ts, tMax = data[data.length - 1].ts;
  const tRange = tMax - tMin || 1;

  const x = (ts) => pad.left + ((ts - tMin) / tRange) * cw;
  const y = (p) => pad.top + (1 - (p - pMin) / (pMax - pMin || 1)) * ch;

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.ts).toFixed(1)},${y(d.close).toFixed(1)}`).join("");
  const area = path + `L${x(tMax).toFixed(1)},${(pad.top + ch).toFixed(1)}L${x(tMin).toFixed(1)},${(pad.top + ch).toFixed(1)}Z`;

  const first = data[0].close, last = data[data.length - 1].close;
  const chg = first ? ((last - first) / first * 100) : 0;
  const chgColor = chg >= 0 ? "var(--pos)" : "var(--neg)";

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${w}px;font-family:'SF Mono',Consolas,monospace;">
    <text x="${pad.left}" y="10" fill="var(--ink)" font-size="9" font-weight="700">${esc(label)} 45d</text>
    <text x="${w - pad.right + 4}" y="${y(last).toFixed(1)}" fill="${chgColor}" font-size="8" font-weight="600" dominant-baseline="middle">${fmtPrice(last)}</text>
    <path d="${area}" fill="${color}" opacity="0.06"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="${x(tMax).toFixed(1)}" cy="${y(last).toFixed(1)}" r="2" fill="${color}"/>
  </svg>`;
}

// Movers quadrant scatter chart — x=log(volume), y=change%.
// movers: [{symbol, chgPct, volUSD}]
export function moversQuadrant(movers, { w = 520, h = 200 } = {}) {
  if (!movers || movers.length < 1) return "";
  const pad = { top: 20, right: 14, bottom: 28, left: 50 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  const withData = movers.filter((m) => m.chgPct != null && m.volUSD > 0);
  if (!withData.length) return "";

  const logVols = withData.map((m) => Math.log10(m.volUSD));
  const [vMin, vMax] = [Math.min(...logVols), Math.max(...logVols)];
  const chgs = withData.map((m) => m.chgPct);
  const cMax = Math.max(Math.abs(Math.min(...chgs)), Math.abs(Math.max(...chgs)), 2);

  const x = (lv) => pad.left + ((lv - vMin) / (vMax - vMin || 1)) * cw;
  const y = (c) => pad.top + (1 - (c + cMax) / (2 * cMax)) * ch;
  const zeroY = y(0);

  // Zero line
  let svg = `<line x1="${pad.left}" x2="${w - pad.right}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="3,3"/>`;

  // Y-axis labels
  const yVals = niceAxis(-cMax, cMax, 5);
  svg += yVals.map((v) =>
    `<text x="${pad.left - 4}" y="${y(v).toFixed(1)}" fill="var(--muted)" font-size="7.5" text-anchor="end" dominant-baseline="middle">${v > 0 ? "+" : ""}${v.toFixed(1)}%</text>`
  ).join("");

  // X-axis label
  svg += `<text x="${pad.left + cw / 2}" y="${h - 4}" fill="var(--muted)" font-size="7.5" text-anchor="middle">Volume →</text>`;

  // Dots with labels
  for (const m of withData) {
    const lv = Math.log10(m.volUSD);
    const cx = x(lv), cy = y(m.chgPct);
    const col = m.chgPct >= 0 ? "var(--pos)" : "var(--neg)";
    const r = Math.min(6, Math.max(3, Math.sqrt(m.volUSD / 1e8)));
    svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col}" opacity="0.7"/>`;
    svg += `<text x="${(cx + r + 2).toFixed(1)}" y="${(cy - 2).toFixed(1)}" fill="var(--ink)" font-size="7.5" font-weight="600">${esc(m.symbol?.replace(/USDT$/, ""))}</text>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${w}px;font-family:'SF Mono',Consolas,monospace;">
    <text x="${pad.left}" y="13" fill="var(--ink)" font-size="10" font-weight="700" font-family="inherit">Movers — Change vs Volume</text>
    ${svg}
  </svg>`;
}
