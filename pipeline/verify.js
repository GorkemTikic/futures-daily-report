// Post-synthesis consistency check (spec A5).
// Regex-extracts percent, price and day-name values from AI-generated prose,
// compares them against the authoritative data pack. Returns an array of
// mismatch descriptions; the caller retries synthesis when the array is non-empty.

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function gatherText(synth) {
  const parts = [
    synth.oneLine, synth.caveman,
    synth.priceVolumeSummary, synth.positioningSummary, synth.stocksSummary,
  ];
  for (const m of synth.movers || []) parts.push(m.explanation);
  return parts.filter(Boolean).join(" ");
}

function leadVenue(obj) {
  if (!obj) return null;
  if (obj.Binance?.ok) return obj.Binance;
  return Object.values(obj).find((r) => r && r.ok) || null;
}

function detectDirection(text, assetPattern) {
  const upRe = /\b(rose|gained|climbed|surged|jumped|rallied|advanced|increased|higher|up)\b/i;
  const downRe = /\b(fell|dropped|declined|slid|slipped|tumbled|plunged|lost|sank|lower|down)\b/i;
  for (const s of text.split(/[.!?]+/)) {
    if (!new RegExp(assetPattern, "i").test(s)) continue;
    const hasUp = upRe.test(s);
    const hasDown = downRe.test(s);
    if (hasUp && !hasDown) return "up";
    if (hasDown && !hasUp) return "down";
  }
  return null;
}

function checkPercentage(errors, text, assetPattern, actualPct, label) {
  if (actualPct == null) return;
  const pctRe = /([+-]?\d+(?:\.\d+)?)\s*%/g;
  for (const s of text.split(/[.!?]+/)) {
    if (!new RegExp(assetPattern, "i").test(s)) continue;
    let m;
    while ((m = pctRe.exec(s)) !== null) {
      const mentioned = parseFloat(m[1]);
      if (isNaN(mentioned)) continue;
      const diff = Math.abs(Math.abs(mentioned) - Math.abs(actualPct));
      if (Math.abs(actualPct) < 1 && mentioned > 5) {
        errors.push(`${label}-pct: text says ${mentioned}% but actual is ${actualPct.toFixed(2)}%`);
      } else if (Math.abs(actualPct) >= 1 && diff > Math.max(2, Math.abs(actualPct) * 0.25)) {
        errors.push(`${label}-pct: text says ${mentioned}% but actual is ${actualPct.toFixed(2)}%`);
      }
    }
  }
}

export function checkConsistency(synth, pack) {
  const errors = [];
  if (!synth || synth._fellBack) return errors;
  const allText = gatherText(synth);
  if (!allText.trim()) return errors;

  // 1. Day name
  const correctDay = new Date(pack.dateUTC + "T00:00:00Z")
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  for (const day of DAY_NAMES) {
    if (day !== correctDay && new RegExp(`\\b${day}\\b`, "i").test(allText)) {
      errors.push(`day-name: text says "${day}" but ${pack.dateUTC} is ${correctDay}`);
    }
  }

  // 2. BTC direction and percentage
  const btc = leadVenue(pack.exchanges?.majors?.BTC);
  if (btc?.chgPct != null && Math.abs(btc.chgPct) >= 0.5) {
    const dir = btc.chgPct >= 0 ? "up" : "down";
    const prose = detectDirection(allText, "bitcoin|\\bbtc\\b");
    if (prose && prose !== dir) {
      errors.push(`btc-direction: text implies ${prose} but data shows ${dir} (${btc.chgPct.toFixed(2)}%)`);
    }
  }
  if (btc?.chgPct != null) checkPercentage(errors, allText, "bitcoin|\\bbtc\\b", btc.chgPct, "BTC");

  // 3. ETH direction and percentage
  const eth = leadVenue(pack.exchanges?.majors?.ETH);
  if (eth?.chgPct != null && Math.abs(eth.chgPct) >= 0.5) {
    const dir = eth.chgPct >= 0 ? "up" : "down";
    const prose = detectDirection(allText, "ethereum|\\beth\\b");
    if (prose && prose !== dir) {
      errors.push(`eth-direction: text implies ${prose} but data shows ${dir} (${eth.chgPct.toFixed(2)}%)`);
    }
  }
  if (eth?.chgPct != null) checkPercentage(errors, allText, "ethereum|\\beth\\b", eth.chgPct, "ETH");

  // 4. Mover symbols must exist in the datapack
  const dataMovers = new Set((pack.exchanges?.movers || []).map((m) => m.symbol));
  for (const m of synth.movers || []) {
    if (m.symbol && dataMovers.size && !dataMovers.has(m.symbol)) {
      errors.push(`mover-symbol: "${m.symbol}" not in datapack movers`);
    }
  }

  // 5. BTC price sanity (if mentioned in a BTC sentence, must be within 10% of close)
  if (btc?.close && btc.close > 1000) {
    const priceRe = /\$\s*([\d,]+(?:\.\d+)?)/g;
    for (const s of allText.split(/[.!?]+/)) {
      if (!/bitcoin|btc/i.test(s)) continue;
      let m;
      while ((m = priceRe.exec(s)) !== null) {
        const mentioned = parseFloat(m[1].replace(/,/g, ""));
        if (isNaN(mentioned) || mentioned < 1000) continue;
        const ratio = mentioned / btc.close;
        if (ratio < 0.9 || ratio > 1.1) {
          errors.push(`btc-price: text says $${mentioned.toLocaleString("en-US")} but close is $${btc.close.toLocaleString("en-US")}`);
        }
      }
    }
  }

  return errors;
}
