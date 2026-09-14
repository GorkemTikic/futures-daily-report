/* Futures Daily Report — analytics client.
 *
 * One event per interaction, POSTed to a Cloudflare Worker `/track` endpoint via
 * navigator.sendBeacon (fire-and-forget, survives page unload). A persistent device id
 * is kept in localStorage (counts unique devices); a session id in sessionStorage.
 * Silent on every failure — analytics must never break the page.
 *
 * What is SENT (and stored): event type, tab, a small props object (may include the UI
 * `lang` and `theme`, plus per-event details like which report/date or click host),
 * device id, session id, a client timestamp. The Worker additionally derives a per-day
 * salted IP HASH (never the raw IP) and a country from Cloudflare's header.
 * What is NOT sent: user agent, screen size, device pixel ratio, referrer, timezone. */
(function () {
  "use strict";
  var CFG = (window.FDR_CONFIG || {});
  var ENDPOINT = (CFG.analyticsUrl || "").replace(/\/$/, "");
  var DISABLED = !ENDPOINT;

  // Event allowlist — the Worker rejects anything not in its own allowlist too.
  var ALLOWED = {
    page_view: 1, view_reports: 1, view_analytics: 1,
    report_open: 1, report_close: 1, report_nav: 1,
    report_search: 1, filter_change: 1, sort_change: 1,
    report_pdf_open: 1, report_raw_open: 1, report_copy_link: 1,
    report_link_click: 1, lang_switch: 1, ticker_error: 1, error: 1,
  };

  function uuidLike() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  function ls(get, key, val) {
    try { return get ? localStorage.getItem(key) : (localStorage.setItem(key, val), val); } catch (e) { return null; }
  }
  function ss(get, key, val) {
    try { return get ? sessionStorage.getItem(key) : (sessionStorage.setItem(key, val), val); } catch (e) { return null; }
  }
  function deviceId() {
    var id = ls(true, "_fdr_did");
    if (!id) { id = uuidLike(); ls(false, "_fdr_did", id); }
    return id || "eph-" + uuidLike();
  }
  function sessionId() {
    var id = ss(true, "_fdr_sid");
    if (!id) { id = uuidLike(); ss(false, "_fdr_sid", id); }
    return id || "eph-" + uuidLike();
  }
  var _seq = 0;
  function sessionMeta() {
    _seq += 1;
    var newSession = false, started = Date.now();
    var ex = ss(true, "_fdr_sstart");
    if (!ex) { newSession = true; ss(false, "_fdr_sstart", String(started)); }
    else { started = Number(ex) || started; }
    return { seq: _seq, newSession: newSession, started: started };
  }
  function firstEver() {
    if (!ls(true, "_fdr_seen")) { ls(false, "_fdr_seen", String(Date.now())); return true; }
    return false;
  }
  // Only the UI language + theme are kept as context, folded into props so they are
  // actually stored (and small). No fingerprinting fields are collected or sent.
  function uiContext() {
    var nav = navigator || {}, de = document.documentElement;
    return {
      lang: (nav.language || "").slice(0, 12),
      theme: de ? (de.getAttribute("data-theme") || "") : "",
    };
  }

  function track(event, props, tab) {
    if (DISABLED || !ALLOWED[event]) return;
    try {
      // touch session/first-seen bookkeeping (kept in storage, not transmitted)
      sessionMeta(); firstEver();
      var mergedProps = {};
      var ctx = uiContext();
      if (props && typeof props === "object") for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) mergedProps[k] = props[k];
      if (ctx.lang) mergedProps.lang = ctx.lang;
      if (ctx.theme) mergedProps.theme = ctx.theme;
      var body = JSON.stringify({
        event: event,
        tab: tab || "",
        props: mergedProps,
        device_id: deviceId(),
        session_id: sessionId(),
        ts: Date.now(),
      });
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT + "/track", body);
      else fetch(ENDPOINT + "/track", { method: "POST", body: body, mode: "no-cors", keepalive: true }).catch(function () {});
    } catch (e) { /* silent */ }
  }

  // Admin API base (same Worker). Returned so the Analytics tab can call /admin/*.
  window.FDRA = {
    track: track,
    enabled: !DISABLED,
    apiBase: ENDPOINT,
  };
})();
