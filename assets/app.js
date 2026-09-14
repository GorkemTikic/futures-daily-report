/* Futures Daily Report — website app (macOS window UI).
 * Sidebar list of reports + a native, typography-first reading pane. The reading
 * view is rendered from the report's own HTML (parsed client-side), so no
 * regeneration is needed and the PDF stays one click away. Hash-routed for Pages.
 */
(function () {
  "use strict";
  var A = window.FDRA || { track: function () {}, enabled: false, apiBase: "" };
  var $ = function (id) { return document.getElementById(id); };
  var listEl = $("list"), filtersEl = $("filters"), contentEl = $("content"), toolbarEl = $("toolbar"), toastEl = $("toast");

  var state = { manifest: null, q: "", filter: "all", view: "reports", date: null, lang: "en" };
  var LANG_LABEL = { en: "EN", tr: "TR", zh: "中文" };
  try { state.lang = localStorage.getItem("_fdr_lang") || "en"; } catch (e) {}
  function setLangPref(l) { state.lang = l; try { localStorage.setItem("_fdr_lang", l); } catch (e) {} }
  function langFile(date, lang, ext) { return "reports/" + date + "/summary_" + date + (lang && lang !== "en" ? "." + lang : "") + "." + ext; }
  var htmlCache = {};

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function dowLong(d) { try { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); } catch (e) { return d; } }
  function dowShort(d) { try { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }); } catch (e) { return ""; } }
  function toast(m) { toastEl.textContent = m; toastEl.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(function () { toastEl.classList.remove("show"); }, 1700); }
  function macroChip(k, v) { if (v == null) return ""; var cls = v > 0.05 ? "pos" : v < -0.05 ? "neg" : "flat"; return '<span class="mchip ' + cls + '"><span class="k">' + k + "</span>" + (v > 0 ? "+" : "") + v.toFixed(1) + "%</span>"; }

  // ---------- data ----------
  function loadManifest() {
    return fetch("manifest.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("manifest " + r.status); return r.json(); }).then(function (m) { state.manifest = m; return m; });
  }
  function fetchReportHtml(date, path) {
    if (htmlCache[date]) return Promise.resolve(htmlCache[date]);
    return fetch(path, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("html " + r.status); return r.text(); }).then(function (t) { htmlCache[date] = t; return t; });
  }

  // ---------- sidebar ----------
  function matches(r) {
    if (state.filter === "danger" && !(r.dangerCount > 0)) return false;
    if (state.filter === "news" && !(r.newsCount > 0)) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    if (r.date.indexOf(q) >= 0) return true;
    if (dowShort(r.date).toLowerCase().indexOf(q) >= 0) return true;
    if (r.marketSummary && r.marketSummary.toLowerCase().indexOf(q) >= 0) return true;
    return (r.flagged || []).some(function (f) { return (f.symbol + " " + f.headline + " " + f.label).toLowerCase().indexOf(q) >= 0; });
  }

  function renderSidebar() {
    var all = (state.manifest.reports || []);
    var counts = { all: all.length, danger: all.filter(function (r) { return r.dangerCount > 0; }).length, news: all.filter(function (r) { return r.newsCount > 0; }).length };
    filtersEl.innerHTML = [["all", "All"], ["danger", "Danger"], ["news", "News"]].map(function (f) {
      return '<button class="fchip' + (state.filter === f[0] ? " on" : "") + '" data-f="' + f[0] + '">' + f[1] + " " + counts[f[0]] + "</button>";
    }).join("");
    Array.prototype.forEach.call(filtersEl.children, function (b) { b.onclick = function () { state.filter = b.getAttribute("data-f"); A.track("filter_change", { filter: state.filter }); renderSidebar(); }; });

    var shown = all.filter(matches);
    listEl.innerHTML = shown.length
      ? '<div class="side-sec">' + shown.length + " report" + (shown.length > 1 ? "s" : "") + "</div>" + shown.map(function (r) {
          var dots = (r.dangerCount > 0 ? '<span class="dot danger" title="danger gaps"></span>' : "") + (r.newsCount > 0 ? '<span class="dot news" title="sourced news"></span>' : "");
          return '<div class="lrow' + (r.date === state.date ? " active" : "") + '" data-date="' + r.date + '">' +
            '<div class="ld"><span class="ldate">' + r.date + '</span><span class="ldow">' + esc(dowShort(r.date)) + "</span></div>" +
            '<div class="dots">' + dots + "</div></div>";
        }).join("")
      : '<div class="side-sec">No matches</div>';
    Array.prototype.forEach.call(listEl.querySelectorAll(".lrow"), function (row) {
      row.onclick = function () { location.hash = "#/report/" + row.getAttribute("data-date"); closeSidebarMobile(); };
    });
  }

  function closeSidebarMobile() { $("sidebar").classList.remove("open"); }

  // ---------- reading view ----------
  function reportLang(r) {
    var langs = (r.languages && r.languages.length) ? r.languages : ["en"];
    return langs.indexOf(state.lang) >= 0 ? state.lang : "en";
  }
  function toolbarReading(r, prev, next) {
    var hasHtml = r.files && r.files.html;
    var langs = (r.languages && r.languages.length) ? r.languages : ["en"];
    var cur = reportLang(r);
    var langSeg = langs.length > 1
      ? '<div class="seg" id="langseg">' + langs.map(function (l) { return '<button data-l="' + l + '"' + (l === cur ? ' class="on"' : "") + ">" + (LANG_LABEL[l] || l) + "</button>"; }).join("") + "</div>"
      : "";
    toolbarEl.innerHTML =
      '<div><div class="tb-title">' + r.date + '</div><div class="tb-sub">' + esc(dowShort(r.date)) + " · daily market report</div></div>" +
      '<div class="sp"></div>' +
      '<div class="ticker" id="ticker" hidden><span class="sym">BTC</span><span class="px" id="ticker-px">—</span></div>' +
      '<button class="btn icon" id="prev"' + (prev ? "" : " disabled") + ' title="Previous day">‹</button>' +
      '<button class="btn icon" id="next"' + (next ? "" : " disabled") + ' title="Next day">›</button>' +
      langSeg +
      (hasHtml ? '<a class="btn" id="open" href="' + langFile(r.date, cur, "html") + '" target="_blank" rel="noopener" title="Open in a new tab">Open</a>' : "") +
      (hasHtml ? '<a class="btn primary" id="pdf" href="' + langFile(r.date, cur, "pdf") + '" download title="Download the PDF">↓ PDF</a>' : "") +
      themeBtn();
    if (prev) $("prev").onclick = function () { A.track("report_nav", { dir: "prev" }); location.hash = "#/report/" + prev; };
    if (next) $("next").onclick = function () { A.track("report_nav", { dir: "next" }); location.hash = "#/report/" + next; };
    var p = $("pdf"); if (p) p.onclick = function () { A.track("report_pdf_open", { date: r.date, lang: cur }); };
    var ls = $("langseg");
    if (ls) Array.prototype.forEach.call(ls.children, function (b) { b.onclick = function () { setLangPref(b.getAttribute("data-l")); A.track("lang_switch", { lang: state.lang }); renderReport(r.date); }; });
    wireTheme();
  }

  function extract(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var pages = Array.prototype.slice.call(doc.querySelectorAll(".page"));
    var out = { lead: null, marketSummary: null, macro: [], marketChart: null, news: [], dives: [] };

    var tldrP = doc.querySelector(".tldr p"); if (tldrP) out.lead = tldrP.textContent.trim();

    var market = pages.filter(function (p) { var h = p.querySelector("h2"); return h && /whole crypto market/i.test(h.textContent); })[0];
    if (market) {
      out.macro = Array.prototype.map.call(market.querySelectorAll(".macro .m"), function (m) {
        var chg = m.querySelector(".chg");
        return { sym: (m.querySelector(".sym") || {}).textContent, chg: chg ? chg.textContent.trim() : "", neg: chg ? chg.classList.contains("red") : false, sub: (m.querySelector(".sub") || {}).textContent };
      });
      var sc = market.querySelector("svg.chart"); if (sc) out.marketChart = sc.outerHTML;
      var tl = market.querySelectorAll(".tldr p"); if (tl.length) out.marketSummary = tl[tl.length - 1].textContent.trim();
      out.news = Array.prototype.map.call(market.querySelectorAll("ul.news li"), function (li) {
        var m = li.className.match(/bullish|bearish|neutral/); var meta = (li.querySelector(".meta") || {}).textContent || "";
        var a = li.querySelector(".meta a");
        var h = li.querySelector(".h") ? li.querySelector(".h").textContent : "";
        return {
          impact: m ? m[0] : "neutral",
          headline: h.replace(/^\s*(bullish|bearish|neutral)\s*/i, "").trim(),
          href: a ? a.getAttribute("href") : null, source: a ? a.textContent.trim() : (meta.split("·").pop() || "").trim(),
          conf: (meta.match(/confidence:\s*([a-z]+)/i) || [])[1] || null,
          date: (meta.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || null,
          note: (li.querySelector(".note") || {}).textContent || null,
        };
      });
    }

    out.dives = pages.filter(function (p) { return p.querySelector("h2 span.tag") && p.querySelector(".lead"); }).map(function (p) {
      var h2 = p.querySelector("h2"), tag = h2.querySelector(".tag");
      var sym = (h2.childNodes[0] && h2.childNodes[0].textContent || "").trim() || h2.textContent.replace(tag.textContent, "").trim();
      var narr = Array.prototype.slice.call(p.querySelectorAll("p")).filter(function (x) { return !x.classList.contains("lead") && !x.classList.contains("foot") && !x.closest(".callout"); }).map(function (x) { return x.textContent.trim(); }).filter(Boolean);
      var chart = p.querySelector("svg.chart");
      var callout = p.querySelector(".callout p");
      var stats = Array.prototype.map.call(p.querySelectorAll(".stats .stat"), function (s) {
        var v = s.querySelector(".v"); return { v: v ? v.textContent.trim() : "", l: (s.querySelector(".l") || {}).textContent, cls: v && v.classList.contains("red") ? "neg" : v && v.classList.contains("amb") ? "amb" : "" };
      });
      return { sym: sym, label: tag.textContent.trim(), danger: tag.classList.contains("danger"), headline: (p.querySelector(".lead strong") || p.querySelector(".lead") || {}).textContent, narr: narr, chart: chart ? chart.outerHTML : null, dnote: callout ? callout.textContent.trim() : null, stats: stats };
    });
    return out;
  }

  function renderReading(r, ex) {
    var glance =
      '<div class="glance">' +
        gcell(r.scanned, "coins scanned") +
        gcell(r.movedBig, "moved &gt;25%", "amb") +
        gcell(r.dangerCount, "danger gaps", r.dangerCount > 0 ? "neg" : "") +
        gcell(r.widest ? r.widest.pct : "—", r.widest ? "widest gap · " + esc(r.widest.symbol) : "widest gap", r.widest ? "neg" : "") +
      "</div>";
    var macro = (ex.macro && ex.macro.length)
      ? '<div class="macro-strip">' + ex.macro.map(function (m) { var v = parseFloat((m.chg || "").replace(/[^\d.-]/g, "")); return macroChip(m.sym, isFinite(v) ? v : null); }).join("") + "</div>"
      : (r.macro ? '<div class="macro-strip">' + macroChip("BTC", r.macro.BTC) + macroChip("ETH", r.macro.ETH) + macroChip("SOL", r.macro.SOL) + "</div>" : "");

    var lead = (ex.lead || ex.marketSummary)
      ? '<div class="r-section"><div class="r-h">The day in one read</div><p class="r-lead">' + esc(ex.lead || "") + "</p>" +
        (ex.marketSummary && ex.marketSummary !== ex.lead ? '<p class="r-lead dim" style="margin-top:14px">' + esc(ex.marketSummary) + "</p>" : "") + "</div>"
      : "";

    var marketChart = ex.marketChart ? '<div class="figure">' + ex.marketChart + '<div class="cap">The majors through the UTC day (% change from each coin\'s open). Source: Binance 1-minute candles.</div></div>' : "";

    var news = (ex.news && ex.news.length)
      ? '<div class="r-section"><div class="r-h">What moved the market · sourced</div>' + ex.news.map(function (n) {
          var link = n.href ? '<a href="' + esc(n.href) + '" target="_blank" rel="noopener">' + esc(n.source || "source") + "</a>" : esc(n.source || "");
          return '<div class="newscard ' + n.impact + '"><div class="nh">' + esc(n.headline) + "</div>" +
            '<div class="nmeta"><span class="tagpill ' + n.impact + '">' + n.impact + "</span>" +
            (n.conf ? "<span>confidence " + esc(n.conf) + "</span>" : "") + (n.date ? "<span>" + esc(n.date) + "</span>" : "") + "<span>" + link + "</span></div>" +
            (n.note ? '<div class="nnote">' + esc(n.note) + "</div>" : "") + "</div>";
        }).join("") + "</div>"
      : "";

    var dives = (ex.dives && ex.dives.length)
      ? '<div class="r-section"><div class="r-h">The flagged coins, one by one</div>' + ex.dives.map(function (d) {
          var stats = (d.stats && d.stats.length) ? '<div class="cs-stats">' + d.stats.map(function (s) { return '<div class="cs-stat"><div class="v ' + (s.cls || "") + '">' + esc(s.v) + '</div><div class="l">' + esc(s.l) + "</div></div>"; }).join("") + "</div>" : "";
          return '<div class="coinstory">' +
            '<div class="cs-head"><span class="cs-sym">' + esc(d.sym) + '</span><span class="cs-tag' + (d.danger ? " danger" : "") + '">' + esc(d.label) + "</span></div>" +
            '<div class="cs-headline">' + esc(d.headline) + "</div>" +
            d.narr.map(function (p) { return '<p class="cs-narr">' + esc(p) + "</p>"; }).join("") +
            (d.chart ? '<div class="figure">' + d.chart + '<div class="cap">Live (last) price vs mark price. Shaded bands = the gap topped 5% (liquidation danger zone).</div></div>' : "") +
            (d.dnote ? '<div class="cs-danger"><b>Why it matters</b> — ' + esc(d.dnote) + "</div>" : "") +
            stats +
          "</div>";
        }).join("") + "</div>"
      : "";

    contentEl.innerHTML =
      '<div class="reader anim">' +
        '<div class="r-kicker">Binance USD-M Futures</div>' +
        '<div class="r-title">' + r.date + "</div>" +
        '<div class="r-dow">' + esc(dowLong(r.date)) + "</div>" +
        glance + macro + marketChart + lead + news + dives +
        '<div class="r-foot">Information only, not financial advice. Numbers from Binance USD-M Futures 1-minute candles.' +
          (r.files && r.files.html ? ' · <a href="' + r.files.html + '" target="_blank" rel="noopener" style="color:var(--info)">open the original formatted report ↗</a>' : "") + "</div>" +
      "</div>";
    startTicker();
  }
  function gcell(v, l, cls) { return '<div class="gcell"><div class="v ' + (cls || "") + '">' + (v != null ? v : "—") + '</div><div class="l">' + l + "</div></div>"; }

  function renderReport(date) {
    state.view = "reports"; state.date = date; setNav();
    var m = state.manifest, byDate = (m.reports || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var i = byDate.findIndex(function (x) { return x.date === date; });
    var r = i >= 0 ? byDate[i] : null;
    if (!r) { contentEl.innerHTML = '<div class="empty"><div><div class="big">Report not found</div><a href="#/" style="color:var(--accent-text)">Back to reports</a></div></div>'; return; }
    var prev = i > 0 ? byDate[i - 1].date : null, next = i < byDate.length - 1 ? byDate[i + 1].date : null;
    renderSidebar();
    toolbarReading(r, prev, next);
    A.track("report_open", { date: date });

    if (!(r.files && r.files.html)) {
      contentEl.innerHTML = '<div class="empty"><div><div class="big">No rendered report for this day</div>' + (r.files && r.files.pdf ? '<a class="btn primary" href="' + r.files.pdf + '" download>↓ Download PDF</a>' : "") + "</div></div>";
      return;
    }
    // Show the full report as a document sheet (Preview-style) — the same detailed
    // report as the PDF, on a paper sheet over the workspace.
    contentEl.innerHTML =
      '<div class="docwrap"><div class="doc-sheet" id="sheet">' +
        '<div class="doc-loading"><div class="skeleton" style="height:34px;width:60%;margin-bottom:18px"></div><div class="skeleton" style="height:90px;margin-bottom:14px"></div><div class="skeleton" style="height:260px"></div></div>' +
        '<iframe class="doc" id="frame" src="' + langFile(date, reportLang(r), "html") + '" title="Report ' + date + '" scrolling="no"></iframe>' +
      "</div></div>";
    var frame = $("frame");
    frame.addEventListener("load", function () {
      try {
        var doc = frame.contentDocument;
        var loading = document.querySelector(".doc-loading"); if (loading) loading.remove();
        function fit() { try { frame.style.height = (doc.documentElement.scrollHeight + 4) + "px"; } catch (e) {} }
        fit(); setTimeout(fit, 120); setTimeout(fit, 400);
        // same-origin: track source-link clicks inside the report ("click where")
        doc.addEventListener("click", function (ev) {
          var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
          if (!a) return;
          var href = a.getAttribute("href") || "", host = "";
          try { host = new URL(href, location.href).host; } catch (e) {}
          if (/^https?:/i.test(href)) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); A.track("report_link_click", { date: date, host: host }); }
        }, true);
      } catch (e) { /* cross-origin — shouldn't happen on same-origin Pages */ }
    });
    contentEl.scrollTo && contentEl.scrollTo(0, 0);
  }

  // ---------- analytics ----------
  var ADMIN_KEY = "_fdr_admin_token";
  function getTok() { try { return localStorage.getItem(ADMIN_KEY) || ""; } catch (e) { return ""; } }
  function setTok(t) { try { t ? localStorage.setItem(ADMIN_KEY, t) : localStorage.removeItem(ADMIN_KEY); } catch (e) {} }

  function renderAnalytics() {
    state.view = "analytics"; state.date = null; setNav(); renderSidebar();
    toolbarEl.innerHTML = '<div><div class="tb-title">Analytics</div><div class="tb-sub">Usage of the reports site</div></div><div class="sp"></div>' + themeBtn();
    wireTheme();
    A.track("view_analytics");
    if (!A.enabled) { contentEl.innerHTML = '<div class="empty"><div><div class="big">Analytics not configured</div><div class="note">Deploy the Cloudflare Worker and set <span class="mono">analyticsUrl</span> in <span class="mono">assets/config.js</span>.<br>See <span class="mono">analytics-worker/README.md</span>.</div></div></div>'; return; }
    if (!getTok()) return adminLogin();
    adminDash("30d");
  }
  function adminLogin(errMsg) {
    contentEl.innerHTML = '<div class="pad"><div class="admin-login panel"><h3>Analytics — admin sign in</h3><p class="note">Enter the <span class="mono">ADMIN_TOKEN</span> you set on the Worker. It stays in this browser only.</p><input id="tok" type="password" placeholder="admin token" autocomplete="off" /><button class="btn primary" id="go" style="width:100%;justify-content:center">Enter</button>' + (errMsg ? '<div class="err">' + esc(errMsg) + "</div>" : "") + "</div></div>";
    function submit() { var t = $("tok").value.trim(); if (t) { setTok(t); adminDash("30d"); } }
    $("go").onclick = submit; $("tok").onkeydown = function (e) { if (e.key === "Enter") submit(); };
  }
  function adminFetch(path) { return fetch(A.apiBase + path, { headers: { Authorization: "Bearer " + getTok() } }).then(function (r) { if (r.status === 401 || r.status === 403) { var e = new Error("unauthorized"); e.code = 401; throw e; } if (!r.ok) throw new Error("http " + r.status); return r.json(); }); }
  function bars(items, lk, vk) {
    if (!items || !items.length) return '<p class="note">No data yet.</p>';
    var max = items.reduce(function (a, x) { return Math.max(a, x[vk] || 0); }, 0) || 1;
    return '<div class="bars">' + items.map(function (x) { return '<div class="bar"><span class="lab" title="' + esc(x[lk]) + '">' + esc(x[lk]) + '</span><span class="track"><span class="fill" style="width:' + Math.round((x[vk] || 0) / max * 100) + '%"></span></span><span class="val">' + (x[vk] || 0) + "</span></div>"; }).join("") + "</div>";
  }
  function adminDash(range) {
    contentEl.innerHTML = '<div class="pad"><div class="adminbar"><div class="seg" id="rng"></div><div class="sp" style="flex:1"></div><button class="btn" id="logout">Log out</button></div><div id="ab"><div class="kpis">' + Array(5).fill('<div class="kpi skeleton" style="height:74px"></div>').join("") + "</div></div></div>";
    var rs = [["today", "Today"], ["7d", "7d"], ["30d", "30d"], ["90d", "90d"]];
    $("rng").innerHTML = rs.map(function (x) { return '<button data-r="' + x[0] + '"' + (x[0] === range ? ' class="on"' : "") + ">" + x[1] + "</button>"; }).join("");
    Array.prototype.forEach.call($("rng").children, function (b) { b.onclick = function () { adminDash(b.getAttribute("data-r")); }; });
    $("logout").onclick = function () { setTok(""); adminLogin(); };
    adminFetch("/admin/stats?range=" + range).then(function (d) {
      var t = d.totals || {};
      $("ab").innerHTML =
        '<div class="kpis">' + kpi(t.events, "Total events") + kpi(t.sessions, "Sessions", "Today: " + ((d.today || {}).sessions || 0)) + kpi(t.devices, "Unique devices") + kpi(t.ips, "Unique IPs") + kpi(t.countries, "Countries") + "</div>" +
        '<div class="charts2">' + panel("Sessions per day", bars(d.perDay, "day", "sessions")) + panel("Reports read (top)", bars(d.topReports, "date", "n")) + "</div>" +
        '<div class="charts2">' + panel("Event types", bars(d.events, "type", "n")) + panel("Click destinations", bars(d.topLinks, "host", "n")) + "</div>" +
        '<div class="charts2">' + panel("Countries", bars(d.countries, "country", "n")) + panel("Recent events", recent(d.recent)) + "</div>";
    }).catch(function (e) {
      if (e.code === 401) { setTok(""); adminLogin("That token was rejected."); return; }
      $("ab").innerHTML = '<div class="empty"><div><div class="big">Couldn\'t load analytics</div><div class="note">' + esc(String(e.message || e)) + "</div></div></div>";
    });
  }
  function kpi(v, l, s) { return '<div class="kpi"><div class="v">' + (v != null ? v : "—") + '</div><div class="l">' + l + "</div>" + (s ? '<div class="s">' + esc(s) + "</div>" : "") + "</div>"; }
  function panel(t, inner) { return '<div class="panel"><h3>' + esc(t) + "</h3>" + inner + "</div>"; }
  function recent(rows) { if (!rows || !rows.length) return '<p class="note">No recent events.</p>'; return '<table class="tbl"><thead><tr><th>Time</th><th>Event</th><th>Detail</th></tr></thead><tbody>' + rows.slice(0, 12).map(function (r) { var w = ""; try { w = new Date(r.ts).toISOString().replace("T", " ").slice(5, 16); } catch (e) {} return "<tr><td>" + esc(w) + "</td><td>" + esc(r.type) + "</td><td>" + esc(r.date || r.host || "") + "</td></tr>"; }).join("") + "</tbody></table>"; }

  // ---------- nav / theme / ticker ----------
  function setNav() { $("nav-reports").classList.toggle("active", state.view === "reports"); $("nav-analytics").classList.toggle("active", state.view === "analytics"); }
  function initTheme() {
    var t; try { t = localStorage.getItem("_fdr_theme"); } catch (e) {}
    if (t) document.documentElement.setAttribute("data-theme", t);
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", cur);
    try { localStorage.setItem("_fdr_theme", cur); } catch (e) {}
  }
  function themeBtn() { return '<button class="btn icon" id="theme" title="Light / dark" aria-label="Toggle theme">◑</button>'; }
  function wireTheme() { var b = $("theme"); if (b) b.onclick = toggleTheme; }
  function startTicker() {
    var el = $("ticker"), px = $("ticker-px"); if (!el) return;
    var last = null, fails = 0;
    function tick() {
      fetch("https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT").then(function (r) { return r.json(); }).then(function (d) {
        var p = Number(d.price); if (!isFinite(p)) throw 0;
        el.hidden = false; fails = 0; px.textContent = p.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        if (last != null) { el.classList.toggle("up", p >= last); el.classList.toggle("down", p < last); } last = p;
      }).catch(function () { if (++fails >= 2) el.hidden = true; });
    }
    if (!startTicker._iv) { tick(); startTicker._iv = setInterval(tick, 6000); }
  }

  // ---------- router ----------
  function route() {
    var h = location.hash || "#/";
    if (h === "#/analytics") return renderAnalytics();
    if (h.indexOf("#/report/") === 0) return renderReport(decodeURIComponent(h.slice(9)));
    // default: latest report
    var latest = state.manifest && state.manifest.latest;
    if (latest) { location.replace("#/report/" + latest); return; }
    contentEl.innerHTML = '<div class="empty"><div class="big">No reports yet</div></div>';
  }

  // ---------- boot ----------
  A.track("page_view");
  $("nav-reports").onclick = function () { location.hash = state.manifest ? "#/report/" + state.manifest.latest : "#/"; };
  $("nav-analytics").onclick = function () { location.hash = "#/analytics"; };
  $("q").addEventListener("input", function () { state.q = $("q").value; renderSidebar(); clearTimeout(route._s); route._s = setTimeout(function () { if (state.q.trim()) A.track("report_search", { len: state.q.trim().length }); }, 700); });
  initTheme();
  loadManifest().then(function () { renderSidebar(); route(); }).catch(function (e) {
    contentEl.innerHTML = '<div class="empty"><div><div class="big">Couldn\'t load reports</div><div class="note">' + esc(String(e.message || e)) + "</div></div></div>";
  });
  window.addEventListener("hashchange", route);
})();
