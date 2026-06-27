/**
 * App pages (not login.html): unauthenticated users go to /login.html?next=...
 * Optional one-shot message (domain / verification) via sessionStorage.
 */
(function () {
  var LOGIN_PATH = "/login.html";

  function isLoginPage() {
    var p = location.pathname || "";
    return p === LOGIN_PATH || /\/login\.html$/i.test(p);
  }

  /**
   * Pass as TJAuth.init({ onGuest: TJAppGate.redirectGuest, ... })
   */
  function redirectGuest(opts) {
    if (isLoginPage()) return;
    opts = opts || {};
    var msg = opts.message ? String(opts.message).trim() : "";
    var reason = opts.reason ? String(opts.reason).trim() : "";
    var email = opts.email ? String(opts.email).trim() : "";
    try {
      if (msg) sessionStorage.setItem("tj_auth_flash", msg);
      else sessionStorage.removeItem("tj_auth_flash");
      if (reason) sessionStorage.setItem("tj_auth_flash_reason", reason);
      else sessionStorage.removeItem("tj_auth_flash_reason");
      if (email) sessionStorage.setItem("tj_auth_flash_email", email);
      else sessionStorage.removeItem("tj_auth_flash_email");
    } catch (_) {}
    var next = (location.pathname || "/") + (location.search || "");
    location.replace(LOGIN_PATH + "?next=" + encodeURIComponent(next));
  }

  window.TJAppGate = {
    redirectGuest: redirectGuest,
    isLoginPage: isLoginPage,
  };
})();
