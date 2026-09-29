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

// Funding rate heatmap across venues for BTC and ETH.
// rows: [{asset, venues: [{venue, fundingAnn}]}]
export function fundingHeatmap(rows, { w = 520, h = 0 } = {}) {
  if (!rows || !rows.length) return "";
  const venues = [...new Set(rows.flatMap((r) => r.venues.map((v) => v.venue)))];
  if (!venues.length) return "";

  const cellW = 72, cellH = 28, labelW = 50, headerH = 24;
  const pad = { top: 24, left: labelW + 8, right: 8, bottom: 8 };
  const gw = venues.length * cellW;
  const gh = rows.length * cellH;
  const totalW = Math.max(w, pad.left + gw + pad.right);
  const totalH = pad.top + headerH + gh + pad.bottom;

  const allVals = rows.flatMap((r) => r.venues.map((v) => v.fundingAnn)).filter((v) => v != null && isFinite(v));
  const absMax = Math.max(20, ...allVals.map(Math.abs));

  const heatColor = (v) => {
    if (v == null || !isFinite(v)) return "var(--card)";
    const t = Math.min(Math.abs(v) / absMax, 1);
    if (v > 0) return `rgba(15,138,79,${(t * 0.55 + 0.05).toFixed(2)})`;
    return `rgba(198,43,63,${(t * 0.55 + 0.05).toFixed(2)})`;
  };

  let svg = "";
  // Column headers (venue names)
  venues.forEach((vn, ci) => {
    const cx = pad.left + ci * cellW + cellW / 2;
    svg += `<text x="${cx}" y="${pad.top + headerH - 6}" fill="var(--muted)" font-size="8" text-anchor="middle">${esc(vn)}</text>`;
  });
  // Rows
  rows.forEach((row, ri) => {
    const ry = pad.top + headerH + ri * cellH;
    svg += `<text x="${pad.left - 6}" y="${(ry + cellH / 2 + 1).toFixed(1)}" fill="var(--ink)" font-size="9" font-weight="600" text-anchor="end">${esc(row.asset)}</text>`;
    venues.forEach((vn, ci) => {
      const v = row.venues.find((x) => x.venue === vn);
      const val = v?.fundingAnn;
      const cx = pad.left + ci * cellW;
      svg += `<rect x="${cx + 1}" y="${ry + 1}" width="${cellW - 2}" height="${cellH - 2}" rx="4" fill="${heatColor(val)}"/>`;
      if (val != null && isFinite(val)) {
        const txt = (val > 0 ? "+" : "") + val.toFixed(1) + "%";
        svg += `<text x="${(cx + cellW / 2).toFixed(1)}" y="${(ry + cellH / 2 + 1).toFixed(1)}" fill="var(--ink)" font-size="8.5" font-weight="600" text-anchor="middle" dominant-baseline="middle">${txt}</text>`;
      } else {
        svg += `<text x="${(cx + cellW / 2).toFixed(1)}" y="${(ry + cellH / 2 + 1).toFixed(1)}" fill="var(--faint)" font-size="8" text-anchor="middle" dominant-baseline="middle">—</text>`;
      }
    });
  });

  return `<svg viewBox="0 0 ${totalW} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${totalW}px;font-family:'SF Mono',Consolas,monospace;">
    <text x="${pad.left}" y="14" fill="var(--ink)" font-size="10" font-weight="700" font-family="inherit">Funding Rate (annualised)</text>
    ${svg}
  </svg>`;
}

// Hourly volume profile — aggregates 5m intraday data into 24 hourly bars.
// data: [{ts, vol}]
export function volumeProfile(data, { w = 520, h = 120, label = "BTC", color = "#c2410c" } = {}) {
  if (!data || data.length < 10) return "";
  const pad = { top: 22, right: 14, bottom: 24, left: 42 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;

  // Aggregate into 24 hourly buckets
  const hourly = new Array(24).fill(0);
  for (const d of data) {
    if (d.vol != null && d.ts != null) {
      const hr = new Date(d.ts).getUTCHours();
      hourly[hr] += d.vol;
    }
  }
  const maxVol = Math.max(...hourly);
  if (maxVol <= 0) return "";

  const barW = (cw / 24) * 0.75;
  const gap = (cw / 24) * 0.25;

  let bars = "";
  for (let hr = 0; hr < 24; hr++) {
    const bx = pad.left + hr * (barW + gap) + gap / 2;
    const bh = (hourly[hr] / maxVol) * ch;
    const by = pad.top + ch - bh;
    const opacity = hourly[hr] / maxVol * 0.6 + 0.2;
    bars += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}" opacity="${opacity.toFixed(2)}"/>`;
    if (hr % 4 === 0) {
      bars += `<text x="${(bx + barW / 2).toFixed(1)}" y="${(h - 6).toFixed(1)}" fill="var(--muted)" font-size="7.5" text-anchor="middle">${String(hr).padStart(2, "0")}:00</text>`;
    }
  }

  // Y-axis
  const yTicks = niceAxis(0, maxVol, 3);
  const yLabels = yTicks.filter((v) => v >= 0 && v <= maxVol * 1.1).map((v) =>
    `<text x="${pad.left - 4}" y="${(pad.top + ch - (v / maxVol) * ch).toFixed(1)}" fill="var(--muted)" font-size="7.5" text-anchor="end" dominant-baseline="middle">$${fmtK(v)}</text>` +
    `<line x1="${pad.left}" x2="${w - pad.right}" y1="${(pad.top + ch - (v / maxVol) * ch).toFixed(1)}" y2="${(pad.top + ch - (v / maxVol) * ch).toFixed(1)}" stroke="var(--line2)" stroke-width="0.5"/>`
  ).join("");

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${w}px;font-family:'SF Mono',Consolas,monospace;">
    <text x="${pad.left}" y="14" fill="var(--ink)" font-size="10" font-weight="700" font-family="inherit">${esc(label)} — Hourly Volume</text>
    ${yLabels}${bars}
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
