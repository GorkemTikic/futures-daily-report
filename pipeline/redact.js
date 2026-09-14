// Redacts anything secret-shaped before it can reach a log file, run.json or the
// console. Logs are committed to a PUBLIC repo, so a stray API error string carrying
// a key in a URL must never survive to disk. Two layers:
//   1) exact values of known secret env vars (belt-and-braces), and
//   2) generic patterns (Anthropic tokens, apikey/token query params, long hex/base64).
// It is deliberately over-eager: a false redaction is harmless, a leaked key is not.

// Env vars whose *values* must never appear in output.
const SECRET_ENV_KEYS = [
  "TRADFI_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ALERT_WEBHOOK_URL",
  "IP_HASH_SECRET",
  "ADMIN_TOKEN",
];

const PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{6,}/g,                  // Anthropic API keys / OAuth tokens
  /(api[_-]?key|apikey|token|secret|password|pwd)=([^&\s"']+)/gi, // query params
  /\b[0-9a-f]{32,}\b/gi,                          // long hex (e.g. Twelve Data key)
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
];

export function redact(input) {
  let s = input == null ? "" : String(input);
  // 1) exact known secret values
  for (const k of SECRET_ENV_KEYS) {
    const v = process.env[k];
    if (v && v.length >= 6) {
      s = s.split(v).join("[REDACTED]");
    }
  }
  // 2) generic patterns
  for (const re of PATTERNS) {
    s = s.replace(re, (m, g1, g2) => (g2 !== undefined ? `${g1}=[REDACTED]` : "[REDACTED]"));
  }
  return s;
}
