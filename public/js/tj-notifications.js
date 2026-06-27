/**
 * Global in-app notification bell (top-right) + toast stack.
 * Requires TJFetch, theme.css tokens, and shell-mounted markup (#tjNotifBell, etc.).
 */
(function () {
  var BELL_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

  var SESSION_PREFIX = "tjNotifSeen:";
  var POLL_MS = 30000;
  var TJFETCH_WAIT_MS = 5000;
  var TJFETCH_POLL_MS = 100;

  var config = {
    tenantGetter: null,
    onItemClick: null,
    onNewPending: null,
  };

  var state = {
    timer: null,
    wired: false,
    started: false,
    optedIn: false,
    cache: [],
    unread: 0,
    unviewed: 0,
    filter: "all",
    prevBadgeText: "",
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normTenant(t) {
    var s = String(t == null ? "" : t)
      .trim()
      .toLowerCase();
    return s || "default";
  }

  function defaultTenantGetter() {
    var el = document.getElementById("tenantId");
    if (el && String(el.value || "").trim()) {
      return normTenant(el.value);
    }
    try {
      var params = new URLSearchParams(window.location.search);
      var fromUrl = params.get("tenantId");
      if (fromUrl && String(fromUrl).trim()) return normTenant(fromUrl);
    } catch (_) {}
    try {
      var stored = localStorage.getItem("leadsDashboardTenantId");
      if (stored && String(stored).trim()) return normTenant(stored);
    } catch (_) {}
    return "default";
  }

  function currentTenant() {
    if (typeof config.tenantGetter === "function") {
      try {
        return normTenant(config.tenantGetter());
      } catch (_) {}
    }
    return defaultTenantGetter();
  }

  function isAuthed() {
    try {
      return !!(typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser);
    } catch (_) {
      return false;
    }
  }

  function seenKey(tenantId) {
    return SESSION_PREFIX + (tenantId || "default");
  }

  function loadSeen(tenantId) {
    try {
      var raw = sessionStorage.getItem(seenKey(tenantId));
      if (!raw) return new Set();
      var parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed.ids) ? parsed.ids : []);
    } catch (_) {
      return new Set();
    }
  }

  function saveSeen(tenantId, set) {
    try {
      var ids = Array.from(set).slice(-200);
      sessionStorage.setItem(seenKey(tenantId), JSON.stringify({ids: ids}));
    } catch (_) {}
  }

  function badgeText(count) {
    if (count <= 0) return "";
    return count > 9 ? "9+" : String(count);
  }

  function isMeeting(n) {
    var i = String((n && n.intent) || "").toLowerCase();
    var s = String((n && n.snippet) || "").toLowerCase();
    var subj = String((n && n.subject) || "").toLowerCase();
    return i === "meeting_booked" || /booked|calendar|meeting/.test(s + " " + subj);
  }

  function passesFilter(n) {
    if (!n) return false;
    if (state.filter === "all") return true;
    if (state.filter === "reply") return n.kind === "inbound_pending" || n.kind === "inbound_reply";
    if (state.filter === "meeting") return isMeeting(n);
    if (state.filter === "ai") return n.kind === "inbound_auto_sent";
    return true;
  }

  function pipelineUrl(tenantId, n) {
    var base = "/leads.html?view=pipeline&tenantId=" + encodeURIComponent(tenantId);
    if (n && n.pendingId) {
      return base + "&inboundPending=" + encodeURIComponent(String(n.pendingId));
    }
    return base;
  }

  function render() {
    var list = document.getElementById("tjNotifList");
    var countEl = document.getElementById("tjNotifCount");
    var bell = document.getElementById("tjNotifBell");
    var text = badgeText(state.unviewed);

    if (countEl) {
      if (text) {
        countEl.textContent = text;
        countEl.hidden = false;
        if (state.prevBadgeText !== text) {
          countEl.classList.remove("tj-notif-count--pop");
          void countEl.offsetWidth;
          countEl.classList.add("tj-notif-count--pop");
          if (bell) {
            bell.classList.remove("tj-notif-bell--ring");
            void bell.offsetWidth;
            bell.classList.add("tj-notif-bell--ring");
          }
        }
      } else {
        countEl.hidden = true;
      }
    }

    if (bell) {
      if (state.unviewed > 0) bell.classList.add("tj-notif-bell--active");
      else bell.classList.remove("tj-notif-bell--active");
    }
    state.prevBadgeText = text;

    if (!list) return;
    if (!state.optedIn) {
      list.innerHTML =
        '<p class="tj-notif-empty">Turn on in-app notifications to see reply alerts here.</p>';
      return;
    }

    var filtered = state.cache.filter(passesFilter);
    if (!filtered.length) {
      list.innerHTML = '<p class="tj-notif-empty">No notifications yet.</p>';
      return;
    }

    var html = "";
    for (var i = 0; i < filtered.length; i++) {
      var n = filtered[i];
      var kindLabel = "Reply needs review";
      if (isMeeting(n)) kindLabel = "Meeting booked";
      else if (n.kind === "inbound_auto_sent") kindLabel = "AI auto-sent";
      var kindClass = n.kind === "inbound_auto_sent" ? "tj-notif-kind-auto" : "tj-notif-kind-pending";
      var when = n.createdAtIso ? new Date(n.createdAtIso).toLocaleString() : "";
      var sentTag =
        n.sentiment && n.sentiment !== "neutral"
          ? ' <span class="reply-ai-sent reply-ai-sent-' +
            escapeHtml(n.sentiment) +
            '">' +
            escapeHtml(n.sentiment) +
            "</span>"
          : "";
      html +=
        '<div class="tj-notif-item' +
        (n.read ? "" : " unread") +
        (n.viewed ? "" : " unviewed") +
        '" data-notif-id="' +
        escapeHtml(n.id) +
        '" data-target-id="' +
        escapeHtml(n.targetId || "") +
        '" data-pending-id="' +
        escapeHtml(n.pendingId || "") +
        '">' +
        '<div class="tj-notif-title"><span class="' +
        kindClass +
        '">' +
        escapeHtml(kindLabel) +
        "</span>" +
        sentTag +
        "</div>" +
        '<div class="tj-notif-snippet">' +
        escapeHtml(n.company || "Lead") +
        (n.snippet ? " — " + escapeHtml(n.snippet) : "") +
        "</div>" +
        (when ? '<div class="tj-notif-meta">' + escapeHtml(when) + "</div>" : "") +
        "</div>";
    }
    list.innerHTML = html;
  }

  function pushToast(n, tenantId) {
    var stack = document.getElementById("tjNotifToastStack");
    if (!stack) return;
    stack.hidden = false;

    var isPending = n.kind === "inbound_pending";
    var label = isPending ? "Reply needs review" : "AI auto-replied";
    var company = n.company || "Lead";
    var link = pipelineUrl(tenantId, n);

    if (isPending && typeof config.onNewPending === "function") {
      try {
        config.onNewPending(n, tenantId);
      } catch (_) {}
    }

    var el = document.createElement("div");
    el.className = "tj-notif-toast";
    el.innerHTML =
      '<div class="tj-notif-toast__icon" aria-hidden="true">TJ</div>' +
      '<div class="tj-notif-toast__text">' +
      '<p class="tj-notif-toast__line">' +
      escapeHtml(label) +
      " — " +
      escapeHtml(company) +
      "</p>" +
      '<a href="' +
      escapeHtml(link) +
      '">Open pipeline</a>' +
      "</div>" +
      '<button type="button" aria-label="Dismiss">×</button>';

    var btn = el.querySelector("button");
    if (btn) {
      btn.addEventListener("click", function () {
        el.classList.add("tj-notif-toast--out");
        setTimeout(function () {
          if (el.parentNode) el.remove();
          if (!stack.children.length) stack.hidden = true;
        }, 240);
      });
    }

    stack.appendChild(el);
    setTimeout(function () {
      if (!el.parentNode) return;
      el.classList.add("tj-notif-toast--out");
      setTimeout(function () {
        if (el.parentNode) el.remove();
        if (!stack.children.length) stack.hidden = true;
      }, 240);
    }, 12000);
  }

  function waitForTJFetch() {
    return new Promise(function (resolve) {
      if (typeof window.TJFetch === "function") {
        resolve(true);
        return;
      }
      var elapsed = 0;
      var iv = setInterval(function () {
        elapsed += TJFETCH_POLL_MS;
        if (typeof window.TJFetch === "function") {
          clearInterval(iv);
          resolve(true);
        } else if (elapsed >= TJFETCH_WAIT_MS) {
          clearInterval(iv);
          resolve(false);
        }
      }, TJFETCH_POLL_MS);
    });
  }

  async function fetchOnce() {
    if (!isAuthed()) return;
    var hasFetch = await waitForTJFetch();
    if (!hasFetch) {
      render();
      return;
    }
    var tid = currentTenant();
    var res;
    try {
      res = await TJFetch("/api/notifications?tenantId=" + encodeURIComponent(tid) + "&_=" + Date.now(), {
        cache: "no-store",
      });
    } catch (_) {
      render();
      return;
    }
    var body;
    try {
      body = await res.json();
    } catch (_) {
      render();
      return;
    }
    if (!res.ok || !body) {
      render();
      return;
    }

    state.optedIn = body.optedIn === true;
    state.cache = Array.isArray(body.items) ? body.items : [];
    state.unread = Number(body.unread || 0);
    state.unviewed = Number(body.unviewed || 0);

    var optEl = document.getElementById("tjNotifOptIn");
    if (optEl) optEl.checked = state.optedIn;

    if (state.optedIn && state.cache.length) {
      var seen = loadSeen(tid);
      for (var i = 0; i < state.cache.length; i++) {
        var n = state.cache[i];
        if (!n.id || seen.has(n.id)) continue;
        if (!n.read && (n.kind === "inbound_auto_sent" || n.kind === "inbound_pending")) {
          pushToast(n, tid);
        }
        seen.add(n.id);
      }
      saveSeen(tid, seen);
    }

    render();
  }

  async function markViewed() {
    if (!state.optedIn || state.unviewed <= 0) return;
    var tid = currentTenant();
    try {
      await TJFetch("/api/notifications/mark-viewed", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({tenantId: tid}),
      });
      for (var i = 0; i < state.cache.length; i++) {
        state.cache[i].viewed = true;
      }
      state.unviewed = 0;
      render();
    } catch (_) {}
  }

  async function markAllRead() {
    var tid = currentTenant();
    if (!state.cache.some(function (n) {
      return !n.read;
    })) {
      return;
    }
    try {
      await TJFetch("/api/notifications/mark-read", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({tenantId: tid, all: true}),
      });
    } catch (_) {}
    await fetchOnce();
  }

  async function markOneRead(id) {
    var tid = currentTenant();
    try {
      await TJFetch("/api/notifications/mark-read", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({tenantId: tid, ids: [id]}),
      });
    } catch (_) {}
  }

  function handleItemClick(n, itemEl) {
    var id = n.id || (itemEl && itemEl.getAttribute("data-notif-id")) || "";
    if (id) {
      if (itemEl) itemEl.classList.remove("unread");
      markOneRead(id);
      if (state.unread > 0) state.unread--;
      for (var i = 0; i < state.cache.length; i++) {
        if (state.cache[i].id === id) {
          state.cache[i].read = true;
          break;
        }
      }
      render();
    }

    if (typeof config.onItemClick === "function") {
      try {
        if (config.onItemClick(n) === true) return;
      } catch (_) {}
    }

    window.location.href = pipelineUrl(currentTenant(), n);
  }

  function wireBell() {
    if (state.wired) return;
    var bell = document.getElementById("tjNotifBell");
    var panel = document.getElementById("tjNotifPanel");
    var markBtn = document.getElementById("tjNotifMarkAllRead");
    var list = document.getElementById("tjNotifList");
    if (!bell || !panel) return;
    state.wired = true;

    function openPanel() {
      panel.hidden = false;
      bell.setAttribute("aria-expanded", "true");
      bell.setAttribute("aria-pressed", "true");
      fetchOnce();
      markViewed();
    }

    function closePanel() {
      panel.hidden = true;
      bell.setAttribute("aria-expanded", "false");
      bell.setAttribute("aria-pressed", "false");
    }

    bell.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panel.hidden) openPanel();
      else closePanel();
    });

    document.addEventListener("click", function (e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || bell.contains(e.target)) return;
      closePanel();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) closePanel();
    });

    var filters = panel.querySelectorAll(".tj-notif-filter");
    for (var i = 0; i < filters.length; i++) {
      filters[i].addEventListener("click", function (ev) {
        var btn = ev.currentTarget;
        var f = String(btn.getAttribute("data-filter") || "all");
        state.filter = f;
        for (var j = 0; j < filters.length; j++) {
          if (filters[j].getAttribute("data-filter") === f) filters[j].classList.add("active");
          else filters[j].classList.remove("active");
        }
        render();
      });
    }

    if (markBtn) {
      markBtn.addEventListener("click", function () {
        markAllRead();
      });
    }

    if (list) {
      list.addEventListener("click", function (e) {
        var item = e.target.closest && e.target.closest(".tj-notif-item");
        if (!item) return;
        var id = item.getAttribute("data-notif-id") || "";
        var n = null;
        for (var k = 0; k < state.cache.length; k++) {
          if (state.cache[k].id === id) {
            n = state.cache[k];
            break;
          }
        }
        if (!n) {
          n = {
            id: id,
            targetId: item.getAttribute("data-target-id") || "",
            pendingId: item.getAttribute("data-pending-id") || "",
          };
        }
        handleItemClick(n, item);
      });
    }
  }

  function setTopbarVisible(show) {
    var topbar = document.getElementById("tjTopbar");
    if (!topbar) return;
    topbar.hidden = !show;
  }

  function ensureToastStack() {
    if (document.getElementById("tjNotifToastStack")) return;
    var stack = document.createElement("div");
    stack.id = "tjNotifToastStack";
    stack.className = "tj-notif-toast-stack";
    stack.hidden = true;
    stack.setAttribute("data-tj-body-portal", "1");
    document.body.appendChild(stack);
  }

  function mountTopbar(parentEl) {
    if (document.getElementById("tjTopbar")) return document.getElementById("tjTopbar");
    var host = parentEl || document.body;
    var topbar = document.createElement("div");
    topbar.id = "tjTopbar";
    topbar.className = "tj-topbar";
    topbar.hidden = true;
    topbar.setAttribute("data-tj-body-portal", "1");
    topbar.innerHTML =
      '<div class="tj-notif-host" id="tjNotifHost">' +
      '<button type="button" class="tj-notif-bell" id="tjNotifBell" aria-haspopup="true" aria-expanded="false" aria-pressed="false" title="Notifications">' +
      BELL_SVG +
      '<span class="tj-notif-label">Notifications</span>' +
      '<span class="tj-notif-count" id="tjNotifCount" hidden>0</span>' +
      "</button>" +
      '<div class="tj-notif-panel" id="tjNotifPanel" role="dialog" aria-label="Notifications center" hidden>' +
      "<header><span>Notifications</span><button type=\"button\" id=\"tjNotifMarkAllRead\">Mark all read</button></header>" +
      '<label class="tj-notif-pref-row" title="Off by default. When on, replies and AI auto-sends appear here.">' +
      '<input type="checkbox" id="tjNotifOptIn" />' +
      "<span>Enable in-app notifications</span>" +
      "</label>" +
      '<div class="tj-notif-filter-row" role="tablist" aria-label="Notification filter">' +
      '<button type="button" class="tj-notif-filter active" data-filter="all">All</button>' +
      '<button type="button" class="tj-notif-filter" data-filter="reply">Replies</button>' +
      '<button type="button" class="tj-notif-filter" data-filter="meeting">Meetings</button>' +
      '<button type="button" class="tj-notif-filter" data-filter="ai">AI</button>' +
      "</div>" +
      '<div class="tj-notif-list" id="tjNotifList"></div>' +
      "</div>" +
      "</div>";
    host.appendChild(topbar);
    ensureToastStack();
    return topbar;
  }

  function wirePrefsSync() {
    if (!window.TJUserPrefsSync || typeof TJUserPrefsSync.init !== "function") return;
    if (document.getElementById("tjNotifOptIn") && !window.__tjNotifPrefsWired) {
      window.__tjNotifPrefsWired = true;
      TJUserPrefsSync.init({
        tenantGetter: currentTenant,
        checkboxId: "tjNotifOptIn",
        observeTenantInputId: document.getElementById("tenantId") ? "tenantId" : null,
        onAfterSave: function () {
          fetchOnce();
        },
        onAfterLoad: function () {
          fetchOnce();
        },
      });
    }
  }

  function startPolling() {
    if (state.started) return;
    state.started = true;
    wireBell();
    wirePrefsSync();
    setTopbarVisible(true);
    render();
    fetchOnce();
    if (state.timer != null) clearInterval(state.timer);
    state.timer = setInterval(function () {
      fetchOnce();
    }, POLL_MS);
  }

  function stopPolling() {
    state.started = false;
    if (state.timer != null) {
      clearInterval(state.timer);
      state.timer = null;
    }
    setTopbarVisible(false);
  }

  function waitForAuthAndStart() {
    mountTopbar();
    ensureToastStack();
    wireBell();

    function tryStart() {
      if (!isAuthed()) {
        setTopbarVisible(false);
        return;
      }
      startPolling();
    }

    try {
      if (typeof firebase !== "undefined" && firebase.auth) {
        firebase.auth().onAuthStateChanged(function (user) {
          if (user) tryStart();
          else stopPolling();
        });
        return;
      }
    } catch (_) {}

    var attempts = 0;
    var iv = setInterval(function () {
      attempts++;
      if (isAuthed()) {
        clearInterval(iv);
        tryStart();
      } else if (attempts > 40) {
        clearInterval(iv);
      }
    }, 250);
  }

  function init(opts) {
    opts = opts || {};
    if (typeof opts.tenantGetter === "function") config.tenantGetter = opts.tenantGetter;
    if (typeof opts.onItemClick === "function") config.onItemClick = opts.onItemClick;
    if (typeof opts.onNewPending === "function") config.onNewPending = opts.onNewPending;
    waitForAuthAndStart();
  }

  function configure(opts) {
    opts = opts || {};
    if (typeof opts.tenantGetter === "function") config.tenantGetter = opts.tenantGetter;
    if (typeof opts.onItemClick === "function") config.onItemClick = opts.onItemClick;
    if (typeof opts.onNewPending === "function") config.onNewPending = opts.onNewPending;
    if (state.started) fetchOnce();
  }

  window.TJNotifications = {
    init: init,
    configure: configure,
    refresh: fetchOnce,
    stop: stopPolling,
    mountTopbar: mountTopbar,
  };
})();
