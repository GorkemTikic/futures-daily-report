/* Futures Daily Report — website app.
 * Static SPA: reads manifest.json, lets the team browse/search every report,
 * opens each day's generated HTML in a themed reader, and (token-gated) shows
 * the usage analytics served by the Cloudflare Worker. Hash-routed so it works
 * on GitHub Pages with no server.
 */
(function () {
  "use strict";
  var A = window.FDRA || { track: function () {}, enabled: false, apiBase: "" };
  var view = document.getElementById("view");
  var toastEl = document.getElementById("toast");

  var state = { manifest: null, q: "", filter: "all", sort: "newest" };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function dow(date) {
    try {
      return new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", {
        weekday: "long", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
      });
    } catch (e) { return date; }
  }
  function shortDow(date) {
    try {
      return new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    } catch (e) { return ""; }
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }
  function macroChip(k, v) {
    if (v == null) return "";
    var cls = v > 0.05 ? "pos" : v < -0.05 ? "neg" : "flat";
    var sign = v > 0 ? "+" : "";
    return '<span class="mchip ' + cls + '"><span class="k">' + k + "</span>" + sign + v.toFixed(1) + "%</span>";
  }
  function setNav(which) {
    document.getElementById("nav-reports").classList.toggle("active", which === "reports");
    document.getElementById("nav-analytics").classList.toggle("active", which === "analytics");
  }

  // ---------- data ----------
  function loadManifest() {
    return fetch("manifest.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("manifest " + r.status); return r.json(); })
      .then(function (m) { state.manifest = m; return m; });
  }

  // ---------- filtering ----------
  function matches(r) {
    // filter chip
    if (state.filter === "danger" && !(r.dangerCount > 0)) return false;
    if (state.filter === "movers" && !(r.movedBig > 0)) return false;
    if (state.filter === "news" && !(r.newsCount > 0)) return false;
    // text query across date, coins, headlines, news summary
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    if (r.date.toLowerCase().indexOf(q) >= 0) return true;
    if (r.marketSummary && r.marketSummary.toLowerCase().indexOf(q) >= 0) return true;
    if ((r.flagged || []).some(function (f) {
      return f.symbol.toLowerCase().indexOf(q) >= 0 ||
             (f.headline || "").toLowerCase().indexOf(q) >= 0 ||
             (f.label || "").toLowerCase().indexOf(q) >= 0;
    })) return true;
    if (shortDow(r.date).toLowerCase().indexOf(q) >= 0) return true;
    return false;
  }
  function sorted(list) {
    var s = list.slice();
    if (state.sort === "oldest") s.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    else if (state.sort === "movers") s.sort(function (a, b) { return (b.movedBig || 0) - (a.movedBig || 0); });
    else if (state.sort === "gap") s.sort(function (a, b) { return parseFloat((b.widest || {}).pct || 0) - parseFloat((a.widest || {}).pct || 0); });
    else s.sort(function (a, b) { return a.date < b.date ? 1 : -1; }); // newest
    return s;
  }

  // ---------- reports view ----------
  function reportCard(r, isLatest) {
    var coins = (r.flagged || []).slice(0, 5).map(function (f) { return '<span class="coin">' + esc(f.symbol) + "</span>"; }).join("");
    var more = (r.flagged || []).length > 5 ? '<span class="coin more">+' + ((r.flagged.length) - 5) + "</span>" : "";
    var macro = r.macro ? '<div class="macrorow">' + macroChip("BTC", r.macro.BTC) + macroChip("ETH", r.macro.ETH) + macroChip("SOL", r.macro.SOL) + "</div>" : "";
    var gap = r.dangerCount > 0
      ? '<span class="gap">⚠ ' + r.dangerCount + " danger gap" + (r.dangerCount > 1 ? "s" : "") + "</span>"
      : '<span class="gap none">no danger gaps</span>';
    var news = r.newsCount > 0 ? '<span class="news">● ' + r.newsCount + " sourced news</span>" : "";
    return (
      '<div class="card' + (r.dangerCount > 0 ? " danger" : "") + (isLatest ? " latest" : "") + '" data-date="' + r.date + '" role="button" tabindex="0">' +
        '<div class="top"><div><div class="date">' + esc(r.date) + '</div><div class="dow">' + esc(shortDow(r.date)) + "</div></div>" +
          (isLatest ? '<span class="flag-latest">latest</span>' : "") + "</div>" +
        '<div class="statline">' +
          '<div class="stat"><span class="v mono">' + (r.scanned != null ? r.scanned : "—") + '</span><span class="l">coins scanned</span></div>' +
          '<div class="stat"><span class="v mono amb">' + (r.movedBig != null ? r.movedBig : "—") + '</span><span class="l">moved &gt;25%</span></div>' +
          '<div class="stat"><span class="v mono ' + (r.dangerCount > 0 ? "red" : "") + '">' + (r.dangerCount != null ? r.dangerCount : "—") + '</span><span class="l">danger gaps</span></div>' +
        "</div>" +
        macro +
        (coins ? '<div class="coins">' + coins + more + "</div>" : "") +
        '<div class="meta">' + gap + news + (r.widest ? '<span class="mono" style="color:var(--muted)">widest ' + esc(r.widest.symbol) + " " + esc(r.widest.pct) + "</span>" : "") + "</div>" +
      "</div>"
    );
  }

  function renderReports() {
    setNav("reports");
    A.track("view_reports");
    var m = state.manifest;
    var all = m.reports || [];
    var filtered = sorted(all.filter(matches));
    var latest = m.latest;

    var counts = {
      all: all.length,
      danger: all.filter(function (r) { return r.dangerCount > 0; }).length,
      movers: all.filter(function (r) { return r.movedBig > 0; }).length,
      news: all.filter(function (r) { return r.newsCount > 0; }).length,
    };
    function chip(id, label) {
      return '<span class="chip' + (state.filter === id ? " on" : "") + '" data-filter="' + id + '">' + label + '<span class="n">' + counts[id] + "</span></span>";
    }

    var showLatest = state.sort === "newest" && !state.q && state.filter === "all";
    var gridHtml = filtered.length
      ? '<div class="grid">' + filtered.map(function (r) { return reportCard(r, r.date === latest && showLatest); }).join("") + "</div>"
      : '<div class="empty"><div class="big">No reports match</div><div>Try a different search or clear the filters.</div></div>';

    var searchIco = '<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path></svg>';
    var placeholder = "Search date, coin (e.g. BTCUSDT), headline, weekday...";

    view.innerHTML =
      '<div class="toolbar">' +
        '<div class="searchrow">' +
          '<div class="search">' + searchIco +
            '<input id="q" type="search" placeholder="' + placeholder + '" value="' + esc(state.q) + '" autocomplete="off" />' +
            (state.q ? '<button class="clear" id="qclear" aria-label="Clear">&times;</button>' : "") +
          "</div>" +
          '<select class="sort" id="sort">' +
            '<option value="newest">Newest first</option>' +
            '<option value="oldest">Oldest first</option>' +
            '<option value="movers">Most big movers</option>' +
            '<option value="gap">Biggest price gap</option>' +
          "</select>" +
        "</div>" +
        '<div class="chips">' +
          chip("all", "All") + chip("danger", "Danger gaps") + chip("movers", "Big movers") + chip("news", "Has news") +
          '<span class="count">' + filtered.length + " of " + all.length + " reports</span>" +
        "</div>" +
      "</div>" + gridHtml;

    // wire controls
    var qEl = document.getElementById("sort"); if (qEl) qEl.value = state.sort;
    var input = document.getElementById("q");
    if (input) {
      input.addEventListener("input", function () {
        state.q = input.value;
        var pos = input.selectionStart;
        renderReports();
        var ni = document.getElementById("q"); if (ni) { ni.focus(); try { ni.setSelectionRange(pos, pos); } catch (e) {} }
        clearTimeout(renderReports._t);
        renderReports._t = setTimeout(function () { if (state.q.trim()) A.track("report_search", { len: state.q.trim().length }); }, 700);
      });
    }
    var clr = document.getElementById("qclear");
    if (clr) clr.addEventListener("click", function () { state.q = ""; renderReports(); var ni = document.getElementById("q"); if (ni) ni.focus(); });
    document.getElementById("sort").addEventListener("change", function (e) { state.sort = e.target.value; A.track("sort_change", { sort: state.sort }); renderReports(); });
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
      c.addEventListener("click", function () { state.filter = c.getAttribute("data-filter"); A.track("filter_change", { filter: state.filter }); renderReports(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".card"), function (card) {
      function go() { location.hash = "#/report/" + card.getAttribute("data-date"); }
      card.addEventListener("click", go);
      card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
  }

  // ---------- reader view ----------
  function renderReader(date) {
    setNav("reports");
    var m = state.manifest;
    var list = sorted((m.reports || []).slice()); // for prev/next in current-ish order
    var idx = (m.reports || []).findIndex(function (r) { return r.date === date; });
    var r = idx >= 0 ? m.reports[idx] : null;
    if (!r) { view.innerHTML = '<div class="empty"><div class="big">Report not found</div><div><a href="#/" style="color:var(--accent)">← Back to all reports</a></div></div>'; return; }

    A.track("report_open", { date: date });

    // prev/next by date order (chronological)
    var byDate = (m.reports || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var di = byDate.findIndex(function (x) { return x.date === date; });
    var prev = di > 0 ? byDate[di - 1].date : null;
    var next = di < byDate.length - 1 ? byDate[di + 1].date : null;

    var kv = "";
    function row(k, v, cls) { kv += '<div class="kv"><span class="k">' + k + '</span><span class="v ' + (cls || "") + '">' + v + "</span></div>"; }
    row("Coins scanned", r.scanned != null ? r.scanned : "—");
    row("Moved &gt;25%", r.movedBig != null ? r.movedBig : "—");
    row("Danger gaps", r.dangerCount != null ? r.dangerCount : "—", r.dangerCount > 0 ? "red" : "");
    if (r.widest) row("Widest gap", esc(r.widest.symbol) + " " + esc(r.widest.pct), "red");

    var macro = r.macro ? '<div class="panel"><h3>Market backdrop</h3><div class="macrorow">' + macroChip("BTC", r.macro.BTC) + macroChip("ETH", r.macro.ETH) + macroChip("SOL", r.macro.SOL) + "</div>" +
      (r.marketSummary ? '<p style="font-size:12.5px;color:var(--text-2);margin-top:10px;line-height:1.5">' + esc(r.marketSummary) + "</p>" : "") + "</div>" : "";

    var flagged = (r.flagged || []).length
      ? '<div class="panel"><h3>Flagged coins (' + r.flagged.length + ")</h3><div class=\"flaglist\">" +
        r.flagged.map(function (f) { return '<div class="flagrow"><span class="sym">' + esc(f.symbol) + '</span><span class="lbl">' + esc(f.label) + "</span></div>"; }).join("") +
        "</div></div>" : "";

    var frameSrc = r.files && r.files.html ? r.files.html : null;

    view.innerHTML =
      '<div class="readhead">' +
        '<a class="btn" href="#/">← All reports</a>' +
        '<div><div class="big">' + esc(date) + '</div><div class="dow">' + esc(dow(date)) + "</div></div>" +
        '<div class="navbtns">' +
          '<button class="btn" id="prev"' + (prev ? "" : " disabled") + '>← Prev</button>' +
          '<button class="btn" id="next"' + (next ? "" : " disabled") + '>Next →</button>' +
          (r.files && r.files.pdf ? '<a class="btn" id="pdf" href="' + r.files.pdf + '" target="_blank" rel="noopener">PDF</a>' : "") +
          '<button class="btn" id="copy">Copy link</button>' +
        "</div>" +
      "</div>" +
      '<div class="reader">' +
        '<div class="side">' +
          '<div class="panel"><h3>The day in numbers</h3>' + kv + "</div>" +
          macro + flagged +
        "</div>" +
        '<div>' +
          (frameSrc
            ? '<div class="framewrap"><iframe id="frame" src="' + frameSrc + '" title="Report ' + date + '" loading="lazy"></iframe></div>'
            : '<div class="empty"><div class="big">No rendered report for this day</div></div>') +
        "</div>" +
      "</div>";

    if (prev) document.getElementById("prev").addEventListener("click", function () { A.track("report_nav", { dir: "prev" }); location.hash = "#/report/" + prev; });
    if (next) document.getElementById("next").addEventListener("click", function () { A.track("report_nav", { dir: "next" }); location.hash = "#/report/" + next; });
    document.getElementById("copy").addEventListener("click", function () {
      var url = location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast("Link copied"); }, function () { toast(url); });
      A.track("report_copy_link", { date: date });
    });
    var pdfBtn = document.getElementById("pdf");
    if (pdfBtn) pdfBtn.addEventListener("click", function () { A.track("report_pdf_open", { date: date }); });

    // same-origin iframe: track link clicks inside the report ("click where")
    var frame = document.getElementById("frame");
    if (frame) frame.addEventListener("load", function () {
      try {
        var doc = frame.contentDocument;
        if (!doc) return;
        // resize iframe to its content so the whole report scrolls with the page
        try { frame.style.height = Math.max(doc.body.scrollHeight, 600) + "px"; } catch (e) {}
        doc.addEventListener("click", function (ev) {
          var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
          if (!a) return;
          var href = a.getAttribute("href") || "";
          var host = "";
          try { host = new URL(href, location.href).host; } catch (e) {}
          A.track("report_link_click", { date: date, host: host });
          // open external links in a new tab so the reader isn't navigated away
          if (/^https?:/i.test(href)) { a.setAttribute("target", "_blank"); a.setAttribute("rel", "noopener"); }
        }, true);
      } catch (e) { /* cross-origin (shouldn't happen on Pages) */ }
    });

    window.scrollTo(0, 0);
  }

  // ---------- analytics (admin) view ----------
  var ADMIN_KEY = "_fdr_admin_token";
  function getToken() { try { return localStorage.getItem(ADMIN_KEY) || ""; } catch (e) { return ""; } }
  function setToken(t) { try { t ? localStorage.setItem(ADMIN_KEY, t) : localStorage.removeItem(ADMIN_KEY); } catch (e) {} }

  function renderAnalytics() {
    setNav("analytics");
    A.track("view_analytics");
    if (!A.enabled) {
      view.innerHTML = '<div class="empty"><div class="big">Analytics not configured</div><div>Deploy the Cloudflare Worker and set <span class="mono">analyticsUrl</span> in <span class="mono">assets/config.js</span>. See <span class="mono">analytics-worker/README.md</span>.</div></div>';
      return;
    }
    if (!getToken()) return renderAdminLogin();
    renderAdminDashboard("30d");
  }

  function renderAdminLogin(errMsg) {
    view.innerHTML =
      '<div class="admin-login"><div class="panel">' +
        "<h3>Analytics — admin sign in</h3>" +
        '<p class="note">Enter the admin token (the <span class="mono">ADMIN_TOKEN</span> secret you set on the analytics Worker). It stays in this browser only.</p>' +
        '<input id="tok" type="password" placeholder="admin token" autocomplete="off" />' +
        '<button class="btn primary" id="tokgo" style="width:100%;justify-content:center">Enter</button>' +
        (errMsg ? '<div class="err">' + esc(errMsg) + "</div>" : "") +
      "</div></div>";
    function submit() { var t = document.getElementById("tok").value.trim(); if (!t) return; setToken(t); renderAdminDashboard("30d"); }
    document.getElementById("tokgo").addEventListener("click", submit);
    document.getElementById("tok").addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
  }

  function adminFetch(path) {
    return fetch(A.apiBase + path, { headers: { Authorization: "Bearer " + getToken() } })
      .then(function (r) { if (r.status === 401 || r.status === 403) { var e = new Error("unauthorized"); e.code = 401; throw e; } if (!r.ok) throw new Error("http " + r.status); return r.json(); });
  }

  function bars(items, labelKey, valKey, labeler) {
    if (!items || !items.length) return '<p class="note">No data yet.</p>';
    var max = items.reduce(function (m, x) { return Math.max(m, x[valKey] || 0); }, 0) || 1;
    return '<div class="bars">' + items.map(function (x) {
      var lab = labeler ? labeler(x[labelKey]) : x[labelKey];
      var pct = Math.round(((x[valKey] || 0) / max) * 100);
      return '<div class="bar"><span class="lab" title="' + esc(lab) + '">' + esc(lab) + '</span><span class="track"><span class="fill" style="width:' + pct + '%"></span></span><span class="val">' + (x[valKey] || 0) + "</span></div>";
    }).join("") + "</div>";
  }

  function renderAdminDashboard(range) {
    view.innerHTML = '<div class="adminbar"><div class="range" id="rng"></div><div class="spacer" style="flex:1"></div><button class="btn" id="logout">Log out</button></div>' +
      '<div id="admin-body"><div class="kpis">' + Array(5).fill('<div class="kpi skeleton" style="height:78px"></div>').join("") + "</div></div>";
    var ranges = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"]];
    document.getElementById("rng").innerHTML = ranges.map(function (x) { return '<button data-r="' + x[0] + '"' + (x[0] === range ? ' class="on"' : "") + ">" + x[1] + "</button>"; }).join("");
    Array.prototype.forEach.call(document.querySelectorAll("#rng button"), function (b) {
      b.addEventListener("click", function () { renderAdminDashboard(b.getAttribute("data-r")); });
    });
    document.getElementById("logout").addEventListener("click", function () { setToken(""); renderAdminLogin(); });

    adminFetch("/admin/stats?range=" + encodeURIComponent(range)).then(function (d) {
      var t = d.totals || {};
      var body = document.getElementById("admin-body");
      body.innerHTML =
        '<div class="kpis">' +
          kpi(t.events, "Total events") +
          kpi(t.sessions, "Sessions", "Today: " + ((d.today && d.today.sessions) || 0)) +
          kpi(t.devices, "Unique devices") +
          kpi(t.ips, "Unique IPs (hashed)") +
          kpi(t.countries, "Countries") +
        "</div>" +
        '<div class="charts2">' +
          panel("Sessions per day", bars(d.perDay, "day", "sessions")) +
          panel("Reports read (top)", bars(d.topReports, "date", "n")) +
        "</div>" +
        '<div class="charts2">' +
          panel("Event types", bars(d.events, "type", "n")) +
          panel("Click destinations", bars(d.topLinks, "host", "n")) +
        "</div>" +
        '<div class="charts2">' +
          panel("Countries", bars(d.countries, "country", "n")) +
          panel("Recent events", recentTable(d.recent)) +
        "</div>";
    }).catch(function (e) {
      if (e.code === 401) { setToken(""); renderAdminLogin("That token was rejected. Try again."); return; }
      document.getElementById("admin-body").innerHTML = '<div class="empty"><div class="big">Couldn\'t load analytics</div><div>' + esc(String(e.message || e)) + "</div></div>";
    });
  }
  function kpi(v, l, s) { return '<div class="kpi"><div class="v">' + (v != null ? v : "—") + '</div><div class="l">' + l + "</div>" + (s ? '<div class="s">' + esc(s) + "</div>" : "") + "</div>"; }
  function panel(title, inner) { return '<div class="panel"><h3>' + esc(title) + "</h3>" + inner + "</div>"; }
  function recentTable(rows) {
    if (!rows || !rows.length) return '<p class="note">No recent events.</p>';
    return '<table class="tbl"><thead><tr><th>Time (UTC)</th><th>Event</th><th>Detail</th></tr></thead><tbody>' +
      rows.slice(0, 12).map(function (r) {
        var when = "";
        try { when = new Date(r.ts).toISOString().replace("T", " ").slice(5, 16); } catch (e) {}
        var detail = r.date || r.host || (r.props ? JSON.stringify(r.props).slice(0, 40) : "");
        return "<tr><td>" + esc(when) + "</td><td>" + esc(r.type || r.event || "") + "</td><td>" + esc(detail) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  // ---------- router ----------
  function route() {
    var h = location.hash || "#/";
    if (h.indexOf("#/report/") === 0) {
      var date = decodeURIComponent(h.slice("#/report/".length));
      if (state.manifest) renderReader(date);
      return;
    }
    if (h === "#/analytics") { renderAnalytics(); return; }
    if (state.manifest) renderReports();
  }

  // ---------- live BTC ticker (best-effort; hides on failure) ----------
  function startTicker() {
    var el = document.getElementById("ticker"), px = document.getElementById("ticker-px");
    var last = null, fails = 0;
    function tick() {
      fetch("https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT")
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var p = Number(d.price); if (!isFinite(p)) throw new Error("bad");
          el.hidden = false; fails = 0;
          px.textContent = p.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
          if (last != null) { el.classList.toggle("up", p >= last); el.classList.toggle("down", p < last); }
          last = p;
        })
        .catch(function () { if (++fails >= 2) { el.hidden = true; A.track("ticker_error"); } });
    }
    tick();
    setInterval(tick, 6000);
  }

  // ---------- boot ----------
  A.track("page_view");
  loadManifest().then(function () {
    route();
    startTicker();
  }).catch(function (e) {
    view.innerHTML = '<div class="empty"><div class="big">Couldn\'t load reports</div><div>' + esc(String(e.message || e)) + "</div></div>";
  });
  window.addEventListener("hashchange", route);
})();
