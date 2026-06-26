/**
 * App shell — CodePen-style dock nav (hamburger + stacked icon tiles).
 * Call TJShell.init({ page: "dashboard"|"campaigns"|"email"|"pipeline" }).
 */
(function () {
  var PAGES = [
    {id: "dashboard", href: "/leads.html?view=dashboard", label: "Dashboard", icon: "grid"},
    {id: "campaigns", href: "/campaigns.html", label: "Campaigns", icon: "mail"},
    {id: "email", href: "/email.html", label: "Send email", icon: "send"},
    {id: "pipeline", href: "/leads.html?view=pipeline", label: "Pipeline", icon: "list"},
  ];

  var ICONS = {
    grid:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    mail:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    list:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    send:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9 22 2z"/></svg>',
    sun:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    moon:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
    logout:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>',
    chevronLeft:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    chevronRight:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  };

  function getPageIndex(pageId) {
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].id === pageId) return i;
    }
    return -1;
  }

  function getAdjacentPage(pageId, delta) {
    var idx = getPageIndex(pageId);
    if (idx < 0) return null;
    var nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= PAGES.length) return null;
    var p = PAGES[nextIdx];
    return {href: p.href, label: p.label};
  }

  function escapeNavAttr(s) {
    return String(s || "").replace(/"/g, "&quot;");
  }

  function buildNavControl(kind, adjacent) {
    var isPrev = kind === "prev";
    var prefix = isPrev ? "Previous" : "Next";
    var arrow = isPrev ? ICONS.chevronLeft : ICONS.chevronRight;
    var className = "tj-page-nav__btn tj-page-nav__btn--" + kind;
    if (adjacent) {
      var label = prefix + ": " + adjacent.label;
      return (
        '<a class="' +
        className +
        '" href="' +
        adjacent.href +
        '" title="' +
        escapeNavAttr(label) +
        '" aria-label="' +
        escapeNavAttr(label) +
        '">' +
        arrow +
        "</a>"
      );
    }
    return (
      '<button type="button" class="' +
      className +
      '" disabled aria-disabled="true" tabindex="-1" aria-label="' +
      escapeNavAttr(prefix + " page unavailable") +
      '">' +
      arrow +
      "</button>"
    );
  }

  function buildNavArrows(activePage) {
    if (getPageIndex(activePage) < 0) return null;
    var prev = getAdjacentPage(activePage, -1);
    var next = getAdjacentPage(activePage, 1);
    var nav = document.createElement("nav");
    nav.className = "tj-page-nav";
    nav.setAttribute("aria-label", "Page navigation");
    nav.innerHTML = buildNavControl("prev", prev) + buildNavControl("next", next);
    return nav;
  }

  function truncateEmail(email) {
    var e = String(email || "").trim();
    if (!e || e.length <= 28) return e;
    var at = e.indexOf("@");
    if (at > 0 && at <= 12) return e.slice(0, at + 1) + "…";
    return e.slice(0, 25) + "…";
  }

  function buildSidebar(activePage) {
    var aside = document.createElement("aside");
    aside.className = "tj-sidebar";
    aside.setAttribute("aria-label", "Main navigation");

    var brand =
      '<a class="tj-sidebar__tile tj-sidebar__brand" href="/" title="Tech Jump home">' +
      '<div class="tj-sidebar__logo">TJ</div>' +
      '<span class="tj-sidebar__label">Tech Jump</span>' +
      "</a>";

    var hamburger =
      '<div class="tj-sidebar__tile tj-sidebar__hamburger-wrap">' +
      '<button type="button" class="tj-sidebar__hamburger-btn" aria-expanded="false" aria-label="Open menu">' +
      '<div class="tj-hamburger">' +
      '<div class="tj-hamburger__line"></div>' +
      '<div class="tj-hamburger__line"></div>' +
      '<div class="tj-hamburger__line"></div>' +
      "</div>" +
      "</button>" +
      "</div>";

    var navItems = "";
    for (var i = 0; i < PAGES.length; i++) {
      var p = PAGES[i];
      var active = activePage === p.id ? " tj-sidebar__tile--active" : "";
      navItems +=
        '<a class="tj-sidebar__tile tj-sidebar__nav-item' +
        active +
        '" href="' +
        p.href +
        '" title="' +
        p.label +
        '" data-no-transition data-nav-index="' +
        i +
        '">' +
        ICONS[p.icon] +
        '<span class="tj-sidebar__label">' +
        p.label +
        "</span>" +
        "</a>";
    }

    var userEmail = "";
    try {
      if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
        userEmail = String(firebase.auth().currentUser.email || "").trim();
      }
    } catch (_) {}

    var signOutTitle = userEmail ? "Sign out (" + truncateEmail(userEmail) + ")" : "Sign out";
    var signOutLabel = userEmail ? "Sign out · " + truncateEmail(userEmail) : "Sign out";

    var theme =
      '<button type="button" class="tj-sidebar__tile tj-sidebar__theme" data-theme-toggle title="Toggle theme">' +
      '<span class="tj-sidebar__theme-icon" aria-hidden="true">' +
      ICONS.sun +
      "</span>" +
      '<span class="tj-sidebar__theme-text">Light</span>' +
      '<span class="tj-sidebar__label tj-sidebar__theme-hint">Switch theme</span>' +
      "</button>";

    var signOut =
      '<button type="button" class="tj-sidebar__tile tj-sidebar__signout" id="tjSidebarSignOut" title="' +
      signOutTitle.replace(/"/g, "&quot;") +
      '">' +
      ICONS.logout +
      '<span class="tj-sidebar__label">' +
      signOutLabel.replace(/</g, "&lt;") +
      "</span>" +
      "</button>";

    aside.innerHTML =
      brand +
      hamburger +
      '<nav class="tj-sidebar__nav" aria-label="Pages">' +
      navItems +
      "</nav>" +
      theme +
      signOut;

    return aside;
  }

  function wireSidebar(sidebar) {
    var hamburgerBtn = sidebar.querySelector(".tj-sidebar__hamburger-btn");
    var hamburger = sidebar.querySelector(".tj-hamburger");
    var nav = sidebar.querySelector(".tj-sidebar__nav");
    var overlay = document.querySelector(".tj-sidebar-overlay");

    function setOpen(open) {
      sidebar.classList.toggle("tj-sidebar--open", open);
      if (hamburger) hamburger.classList.toggle("tj-hamburger--open", open);
      if (nav) nav.classList.toggle("tj-sidebar__nav--open", open);
      if (hamburgerBtn) {
        hamburgerBtn.setAttribute("aria-expanded", open ? "true" : "false");
        hamburgerBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      }
      if (overlay) overlay.classList.toggle("tj-sidebar-overlay--open", open);
      document.body.classList.toggle("tj-sidebar-menu-open", open);
    }

    function toggleOpen() {
      setOpen(!sidebar.classList.contains("tj-sidebar--open"));
    }

    if (hamburgerBtn) {
      hamburgerBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleOpen();
      });
    }

    if (overlay) {
      overlay.addEventListener("click", function () {
        setOpen(false);
      });
    }

    sidebar.querySelectorAll(".tj-sidebar__nav-item[href]").forEach(function (link) {
      link.addEventListener("click", function () {
        setOpen(false);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && sidebar.classList.contains("tj-sidebar--open")) {
        setOpen(false);
      }
    });

    var signOutBtn = sidebar.querySelector("#tjSidebarSignOut");
    if (signOutBtn) {
      signOutBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (signOutBtn.disabled) return;
        signOutBtn.disabled = true;
        signOutBtn.setAttribute("aria-busy", "true");
        var label = signOutBtn.querySelector(".tj-sidebar__label");
        if (label) label.textContent = "Signing out…";

        function finishSignOut() {
          try {
            sessionStorage.removeItem("tj_auth_flash");
          } catch (_) {}
          window.location.replace("/login.html");
        }

        function runSignOut() {
          if (window.TJAuth && typeof TJAuth.signOut === "function") {
            return TJAuth.signOut();
          }
          if (typeof firebase !== "undefined" && firebase.auth) {
            return firebase.auth().signOut();
          }
          return Promise.resolve();
        }

        runSignOut()
          .then(finishSignOut)
          .catch(function () {
            signOutBtn.disabled = false;
            signOutBtn.removeAttribute("aria-busy");
            if (label) label.textContent = "Sign out";
          });
      });
    }
  }

  function shouldStayOnBody(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute("data-tj-body-portal") != null) return true;
    if (el.getAttribute("role") === "dialog") return true;
    var cls = el.className;
    cls = typeof cls === "string" ? cls : "";
    var id = typeof el.id === "string" ? el.id : "";
    if (cls.indexOf("-backdrop") !== -1 || cls.indexOf("tj-send-overlay") !== -1) return true;
    if (cls.indexOf("-modal") !== -1 || cls.indexOf("-dialog") !== -1) return true;
    if (id && /(?:Backdrop|Modal|Dialog|PickerBd)$/i.test(id)) return true;
    return false;
  }

  function init(opts) {
    opts = opts || {};
    var activePage =
      opts.page === undefined || opts.page === null || opts.page === "" ? "" : opts.page;

    var sidebar = buildSidebar(activePage);
    var overlay = document.createElement("div");
    overlay.className = "tj-sidebar-overlay";
    overlay.setAttribute("aria-hidden", "true");

    document.body.insertBefore(overlay, document.body.firstChild);
    document.body.insertBefore(sidebar, document.body.firstChild);
    document.body.classList.add("tj-shell");

    wireSidebar(sidebar);

    var pageNav = buildNavArrows(activePage);
    if (pageNav) {
      document.body.appendChild(pageNav);
    }

    var existingWrap = document.querySelector(".wrap, #app-root, #sign-in-root, #auth-loading-root");
    if (existingWrap) {
      var main = existingWrap.closest(".tj-main");
      if (!main) {
        var children = Array.prototype.slice.call(document.body.childNodes);
        var mainEl = document.createElement("div");
        mainEl.className = "tj-main";

        for (var i = 0; i < children.length; i++) {
          var child = children[i];
          if (child === sidebar || child === overlay || child === pageNav) continue;
          if (child.nodeType === 1 && child.tagName === "SCRIPT") continue;
          if (child.nodeType === 1 && child.tagName === "NOSCRIPT") continue;
          if (shouldStayOnBody(child)) continue;
          mainEl.appendChild(child);
        }
        document.body.appendChild(mainEl);

        var scripts = document.querySelectorAll("body > script");
        for (var j = 0; j < scripts.length; j++) {
          document.body.appendChild(scripts[j]);
        }
        var noscripts = document.querySelectorAll("body > noscript");
        for (var n = 0; n < noscripts.length; n++) {
          document.body.appendChild(noscripts[n]);
        }
      }
    }

    initPageTransitions();
    loadNotifications();
  }

  function loadNotifications() {
    if (document.getElementById("tjNotifCss")) return;
    var link = document.createElement("link");
    link.id = "tjNotifCss";
    link.rel = "stylesheet";
    link.href = "/tj-notifications.css?v=2";
    document.head.appendChild(link);

    function boot() {
      if (window.TJNotifications && typeof TJNotifications.init === "function") {
        TJNotifications.init();
        return;
      }
      var script = document.createElement("script");
      script.src = "/js/tj-notifications.js?v=2";
      script.onload = function () {
        if (window.TJNotifications) TJNotifications.init();
      };
      document.body.appendChild(script);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }

  function initPageTransitions() {
    var prefMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefMotion) {
      document.body.classList.add("tj-motion-off");
    }

    function readyMain() {
      document.body.classList.remove("tj-nav-exit");
      document.body.classList.add("tj-page-ready");
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(readyMain);
    });

    window.addEventListener("pageshow", function () {
      document.body.classList.remove("tj-nav-exit");
      document.body.classList.add("tj-page-ready");
    });

    document.addEventListener(
      "click",
      function (e) {
        if (!document.body.classList.contains("tj-shell")) return;
        if (prefMotion) return;

        var el = e.target;
        if (!el || !el.closest) return;
        var a = el.closest("a[href]");
        if (!a) return;

        if (a.getAttribute("data-no-transition") != null) return;
        if (a.target === "_blank" || a.getAttribute("download") != null) return;

        var hrefAttr = a.getAttribute("href");
        if (!hrefAttr || hrefAttr.charAt(0) === "#") return;

        var dest;
        try {
          dest = new URL(a.href, window.location.href);
        } catch (_) {
          return;
        }

        if (dest.origin !== window.location.origin) return;
        if (!/^https?:$/i.test(dest.protocol)) return;
        if (dest.pathname.indexOf("/api/") === 0) return;

        if (
          dest.pathname === window.location.pathname &&
          dest.search === window.location.search
        ) {
          return;
        }

        if (document.body.classList.contains("tj-nav-exit")) return;

        e.preventDefault();

        function go() {
          window.location.href = dest.href;
        }

        document.body.classList.add("tj-nav-exit");

        if (typeof document.startViewTransition === "function") {
          try {
            document.startViewTransition(go);
            return;
          } catch (_) {}
        }

        window.setTimeout(go, 230);
      },
      true,
    );
  }

  window.TJShell = {init: init};

  (function loadCoach() {
    function inject() {
      if (document.getElementById("tjCoachCss")) return;
      var link = document.createElement("link");
      link.id = "tjCoachCss";
      link.rel = "stylesheet";
      link.href = "/coach.css?v=3";
      document.head.appendChild(link);

      var script = document.createElement("script");
      script.src = "/js/tj-coach.js?v=3";
      document.body.appendChild(script);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", inject);
    } else {
      inject();
    }
  })();
})();
