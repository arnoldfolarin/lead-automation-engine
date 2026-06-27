/**
 * Inbound send-queue exit — loaded synchronously right after modal markup on email.html.
 * Uses capture-phase handling + sessionStorage so this works even if the main page script errors.
 */
(function () {
  var QUEUE_KEY = "tj_inbound_send_queue";

  function eventElement(ev) {
    var t = ev.target;
    if (!t) return null;
    if (t.nodeType === 1) return t;
    if (t.nodeType === 3 && t.parentElement) return t.parentElement;
    return null;
  }

  function parseQueueLen() {
    try {
      var raw = sessionStorage.getItem(QUEUE_KEY);
      if (!raw) return 0;
      var q = JSON.parse(raw);
      return Array.isArray(q) ? q.length : 0;
    } catch (_) {
      return 0;
    }
  }

  function hideExitModal() {
    var back = document.getElementById("exitInboundBackdrop");
    if (!back) return;
    if (back.hidden) return;
    back.classList.add("tj-exit-backdrop--closing");
    window.setTimeout(function () {
      back.classList.remove("tj-exit-backdrop--closing");
      back.hidden = true;
      back.setAttribute("aria-hidden", "true");
    }, 200);
  }

  function showExitModal() {
    var back = document.getElementById("exitInboundBackdrop");
    if (!back) return;
    back.classList.remove("tj-exit-backdrop--closing");
    back.hidden = false;
    back.setAttribute("aria-hidden", "false");
    var leaveBtn = document.getElementById("exitInboundLeave");
    if (leaveBtn) leaveBtn.focus();
  }

  function applyQueueClearedUi() {
    try {
      sessionStorage.removeItem(QUEUE_KEY);
    } catch (_) {}

    var banner = document.getElementById("emailSendListBar");
    if (banner) {
      banner.hidden = true;
    }
    var note = document.getElementById("emailTopNote");
    if (note) note.hidden = false;

    try {
      var u = new URL(window.location.href);
      if (u.searchParams.has("fromInbound")) {
        u.searchParams.delete("fromInbound");
        var qs = u.searchParams.toString();
        window.history.replaceState({}, "", u.pathname + (qs ? "?" + qs : "") + u.hash);
      }
    } catch (_) {}

    var toEl = document.getElementById("testTo");
    if (toEl) toEl.value = "";
    var cnEl = document.getElementById("testCompanyName");
    if (cnEl) cnEl.value = "";

    try {
      if (typeof window.__tjOnInboundQueueClearedByShell === "function") {
        window.__tjOnInboundQueueClearedByShell();
      }
    } catch (_) {}
  }

  function onExitQueueButton(ev) {
    var el = eventElement(ev);
    if (!el || typeof el.closest !== "function") return;
    var btn = el.closest("#emailSendListClear");
    if (!btn) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (parseQueueLen() === 0) {
      applyQueueClearedUi();
      return;
    }
    showExitModal();
  }

  document.addEventListener("click", onExitQueueButton, true);

  function bindModalButtons() {
    var stay = document.getElementById("exitInboundStay");
    var leave = document.getElementById("exitInboundLeave");
    var back = document.getElementById("exitInboundBackdrop");

    if (stay && !stay.dataset.tjShellExitBound) {
      stay.dataset.tjShellExitBound = "1";
      stay.addEventListener("click", function (e) {
        e.preventDefault();
        hideExitModal();
      });
    }
    if (leave && !leave.dataset.tjShellExitBound) {
      leave.dataset.tjShellExitBound = "1";
      leave.addEventListener("click", function (e) {
        e.preventDefault();
        hideExitModal();
        applyQueueClearedUi();
      });
    }
    if (back && !back.dataset.tjShellExitBackdropBound) {
      back.dataset.tjShellExitBackdropBound = "1";
      back.addEventListener("click", function (e) {
        if (e.target === back) hideExitModal();
      });
    }

    if (!document.documentElement.dataset.tjInboundExitEsc) {
      document.documentElement.dataset.tjInboundExitEsc = "1";
      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") hideExitModal();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindModalButtons);
  } else {
    bindModalButtons();
  }
})();
