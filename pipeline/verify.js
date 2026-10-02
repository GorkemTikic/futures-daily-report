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

// Split text into sentences without breaking on decimals like $84,829.60 or 2.5%
function splitSentences(text) {
  const sentences = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    buf += text[i];
    if (".!?".includes(text[i])) {
      // Don't split on decimal points: digit.digit
      if (text[i] === "." && i > 0 && /\d/.test(text[i - 1]) && i + 1 < text.length && /\d/.test(text[i + 1])) continue;
      // Don't split on abbreviations like "U.S." or "e.g."
      if (text[i] === "." && i > 0 && i >= 1 && /^[A-Za-z]$/.test(text[i - 1]) && i + 1 < text.length && /[A-Za-z]/.test(text[i + 1])) continue;
      // Require whitespace or end after the punctuation (skip runs of .!?)
      let j = i + 1;
      while (j < text.length && ".!?".includes(text[j])) { buf += text[j]; j++; }
      i = j - 1;
      if (j >= text.length || /\s/.test(text[j])) {
        sentences.push(buf.trim());
        buf = "";
      }
    }
  }
  if (buf.trim()) sentences.push(buf.trim());
  return sentences;
}

function detectDirection(text, assetPattern) {
  const upRe = /\b(rose|gained|climbed|surged|jumped|rallied|advanced|increased|higher|up)\b/i;
  const downRe = /\b(fell|dropped|declined|slid|slipped|tumbled|plunged|lost|sank|lower|down)\b/i;
  for (const s of splitSentences(text)) {
    if (!new RegExp(assetPattern, "i").test(s)) continue;
    const hasUp = upRe.test(s);
    const hasDown = downRe.test(s);
    if (hasUp && !hasDown) return "up";
    if (hasDown && !hasUp) return "down";
  }
  return null;
}

// Words that mean a percentage is NOT the asset's price change for the day
// (funding, dominance, flows, open interest, ratios, longer periods ...).
const NOT_PRICE_MOVE = /dominance|funding|open interest|\bOI\b|volume|\bETFs?\b|inflow|outflow|share|ratio|\blongs?\b|\bshorts?\b|annuali[sz]ed|since|year|month|week|\bYTD\b|liquidat|supply|hash|premium|basis|implied|volatility|market cap|breadth|fear|greed|probabilit|odds|rate|yield|index|stake|staking/i;
const OTHER_ASSET = /\b(ethereum|eth|bitcoin|btc|solana|sol|xrp|bnb|doge|dogecoin|cardano|ada|gold|silver|oil|nasdaq|s&p|dow)\b/i;
const MOVE_VERB = "rose|gained|climbed|surged|jumped|rallied|advanced|added|increased|fell|dropped|declined|slid|slipped|tumbled|plunged|lost|sank|decreased|was up|was down|is up|is down|up|down|higher|lower";

// Only a percentage tied to the asset by a movement verb counts as its price
// change: "Bitcoin rose 1.5%", "BTC slipped about 0.4%". Any % in the same
// sentence that is about funding, dominance, flows, another asset or a longer
// period is ignored (they produced false mismatches on almost every day).
function checkPercentage(errors, text, assetPattern, actualPct, label) {
  if (actualPct == null) return;
  // (?!\s+[A-Z][a-z]): "Bitcoin Wars", "Bitcoin Cash" are other coins, not Bitcoin.
  const re = new RegExp(`(?:${assetPattern})(?!\\s+[A-Z][a-z])('s)?([^%]{0,60}?)\\b(${MOVE_VERB})\\b([^%\\d]{0,24}?)([+-]?\\d+(?:\\.\\d+)?)\\s*%`, "gi");
  for (const s of splitSentences(text)) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      const between = `${m[2]} ${m[4]}`;
      if (NOT_PRICE_MOVE.test(between) || OTHER_ASSET.test(between)) continue;
      const mentioned = parseFloat(m[5]);
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

// "BR", "BRUSDT" and "brusdt" are the same mover.
const baseSym = (s) => String(s || "").replace(/\s*\([^)]*\)/g, "").trim().toUpperCase().replace(/[-_/]?(USDT|USDC|BUSD|USD)(_PERP)?$/, "");

export function checkConsistency(synth, pack) {
  const errors = [];
  if (!synth || synth._fellBack) return errors;
  const allText = gatherText(synth);
  if (!allText.trim()) return errors;

  // 1. Day name — only flag if the wrong day appears outside a historical context
  const correctDay = new Date(pack.dateUTC + "T00:00:00Z")
    .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  for (const day of DAY_NAMES) {
    if (day === correctDay) continue;
    // Skip if the mention is preceded by "last", "previous", "on", "since", or a date
    const contextRe = new RegExp(`(?:last|previous|on|since|every)\\s+${day}\\b`, "i");
    if (contextRe.test(allText)) continue;
    if (new RegExp(`\\b${day}\\b`, "i").test(allText)) {
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
  const dataMovers = new Set([...(pack.exchanges?.movers || []), ...(pack.exchanges?.lowLiqMovers || [])].map((m) => baseSym(m.symbol)));
  for (const m of synth.movers || []) {
    if (m.symbol && dataMovers.size && !dataMovers.has(baseSym(m.symbol))) {
      errors.push(`mover-symbol: "${m.symbol}" not in datapack movers`);
    }
  }

  // 5. BTC price sanity: a dollar figure on Bitcoin's own scale (half to double
  // the close) in a Bitcoin sentence must be within 10% of the close. Smaller
  // figures in the same sentence are other assets (ETH ~$2,700) or amounts.
  if (btc?.close && btc.close > 1000) {
    const priceRe = /\$\s*([\d,]+(?:\.\d+)?)(?!\s*(?:k|m|bn|b|million|billion|trillion)\b)/gi;
    for (const s of splitSentences(allText)) {
      if (!/bitcoin|btc/i.test(s)) continue;
      let m;
      while ((m = priceRe.exec(s)) !== null) {
        const mentioned = parseFloat(m[1].replace(/,/g, ""));
        if (isNaN(mentioned) || mentioned < btc.close * 0.5 || mentioned > btc.close * 2) continue;
        const ratio = mentioned / btc.close;
        if (ratio < 0.9 || ratio > 1.1) {
          errors.push(`btc-price: text says $${mentioned.toLocaleString("en-US")} but close is $${btc.close.toLocaleString("en-US")}`);
        }
      }
    }
  }

  return errors;
}
