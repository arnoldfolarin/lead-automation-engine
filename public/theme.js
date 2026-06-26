(function () {
  var KEY = "tech_jump_theme";

  var SUN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  var MOON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

  function syncToggleButtons() {
    var theme =
      document.documentElement.getAttribute("data-theme") === "light"
        ? "light"
        : "dark";
    var nextLabel = theme === "light" ? "Dark" : "Light";
    var hint = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
    var icon = theme === "light" ? MOON : SUN;

    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      var textEl = btn.querySelector(".tj-sidebar__theme-text");
      if (textEl) {
        textEl.textContent = nextLabel;
      } else {
        btn.textContent = nextLabel;
      }
      var iconEl = btn.querySelector(".tj-sidebar__theme-icon");
      if (iconEl) {
        iconEl.innerHTML = icon;
      }
      var hintEl = btn.querySelector(".tj-sidebar__theme-hint");
      if (hintEl) {
        hintEl.textContent = hint;
      }
      btn.setAttribute("aria-label", hint);
      btn.setAttribute("title", hint);
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest("[data-theme-toggle]");
    if (!t) return;
    e.preventDefault();
    var cur =
      document.documentElement.getAttribute("data-theme") === "light"
        ? "light"
        : "dark";
    var next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch (_) {}
    syncToggleButtons();
  });

  syncToggleButtons();
})();
