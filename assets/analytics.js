/* Futures Daily Report — analytics client.
 *
 * Mirrors the Futures DeskMate analytics contract: one event per interaction,
 * POSTed to a Cloudflare Worker `/track` endpoint via navigator.sendBeacon
 * (fire-and-forget, survives page unload). Device id in localStorage (unique
 * devices), session id in sessionStorage (sessions). Silent on every failure —
 * analytics must never break the page.
 *
 * The Worker stores only safe metadata: event type, which report was opened,
 * where a click landed, plus device/session ids, a hashed IP and a country from
 * Cloudflare. No report content is anything but public anyway.
 */
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
  function context() {
    var nav = navigator || {}, scr = screen || {}, de = document.documentElement;
    var tz = "", off = 0;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    try { off = -new Date().getTimezoneOffset(); } catch (e) {}
    return {
      theme: de ? de.getAttribute("data-theme") || "" : "",
      browser_lang: nav.language || "",
      ua: nav.userAgent || "",
      screen: scr.width && scr.height ? scr.width + "x" + scr.height : "",
      viewport: window.innerWidth + "x" + window.innerHeight,
      dpr: window.devicePixelRatio ? Math.round(window.devicePixelRatio * 100) / 100 : 1,
      timezone: tz,
      tz_offset_min: off,
      path: location.pathname + location.hash,
      referrer: document.referrer || "",
    };
  }

  function track(event, props, tab) {
    if (DISABLED || !ALLOWED[event]) return;
    try {
      var sm = sessionMeta();
      var ctx = context();
      var body = JSON.stringify({
        event: event,
        tab: tab || "",
        props: props || undefined,
        device_id: deviceId(),
        session_id: sessionId(),
        session_seq: sm.seq,
        new_session: sm.newSession,
        new_device: firstEver(),
        session_age_ms: Date.now() - sm.started,
        ts: Date.now(),
        theme: ctx.theme, browser_lang: ctx.browser_lang, ua: ctx.ua,
        screen: ctx.screen, viewport: ctx.viewport, dpr: ctx.dpr,
        timezone: ctx.timezone, tz_offset_min: ctx.tz_offset_min,
        path: ctx.path, referrer: ctx.referrer,
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
