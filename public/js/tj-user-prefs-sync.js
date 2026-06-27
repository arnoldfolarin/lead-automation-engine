/**
 * Syncs tenants/{tenantId}/userPrefs/{uid}.notifyInApp with a checkbox across pages
 * (leads.html, email.html, campaigns.html). Uses GET/POST /api/user-prefs + TJFetch (Firebase ID token).
 *
 * @param {{ tenantGetter?: () => string, checkbox?: HTMLInputElement | null, checkboxId?: string, onAfterLoad?: (on: boolean) => void, onAfterSave?: (on: boolean) => void }} opts
 */
(function () {
  function normTenant(t) {
    const s = String(t == null ? "" : t)
      .trim()
      .toLowerCase();
    return s || "default";
  }

  function getCheckbox(opts) {
    if (opts.checkbox) return opts.checkbox;
    if (opts.checkboxId) return document.getElementById(opts.checkboxId);
    return null;
  }

  async function loadPrefs(tenantId) {
    const tid = normTenant(tenantId);
    const res = await window.TJFetch("/api/user-prefs?tenantId=" + encodeURIComponent(tid) + "&_=" + Date.now(), {
      cache: "no-store",
    });
    const body = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      throw new Error(body.error || "user-prefs load failed");
    }
    return body;
  }

  async function savePrefs(tenantId, notifyInApp) {
    const tid = normTenant(tenantId);
    const res = await window.TJFetch("/api/user-prefs", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({tenantId: tid, notifyInApp: !!notifyInApp}),
    });
    const body = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      throw new Error(body.error || "user-prefs save failed");
    }
    return body;
  }

  window.TJUserPrefsSync = {
    /**
     * Read server state and set checkbox (no throw to caller).
     */
    refresh: async function (opts) {
      opts = opts || {};
      const cb = getCheckbox(opts);
      const getter = typeof opts.tenantGetter === "function" ? opts.tenantGetter : function () {
        return "default";
      };
      if (!cb || typeof window.TJFetch !== "function") return false;
      try {
        const body = await loadPrefs(getter());
        const on = body.notifyInApp === true;
        cb.checked = on;
        if (typeof opts.onAfterLoad === "function") opts.onAfterLoad(on);
        return on;
      } catch (e) {
        try {
          console.warn("[TJUserPrefsSync] refresh failed", e);
        } catch (_) {}
        return false;
      }
    },

    init: function (opts) {
      opts = opts || {};
      const cb = getCheckbox(opts);
      const getter = typeof opts.tenantGetter === "function" ? opts.tenantGetter : function () {
        return "default";
      };
      if (!cb || typeof window.TJFetch !== "function") return;

      window.TJUserPrefsSync.refresh(opts);

      cb.addEventListener("change", function () {
        const v = !!cb.checked;
        savePrefs(getter(), v)
          .then(function () {
            if (typeof opts.onAfterSave === "function") opts.onAfterSave(v);
          })
          .catch(function (e) {
            try {
              console.warn("[TJUserPrefsSync] save failed", e);
            } catch (_) {}
          });
      });

      if (opts.observeTenantInputId) {
        var inp = document.getElementById(opts.observeTenantInputId);
        if (inp) {
          inp.addEventListener("change", function () {
            window.TJUserPrefsSync.refresh(opts);
          });
        }
      }
      if (opts.observeLocalStorageTenantKey) {
        try {
          window.addEventListener("storage", function (ev) {
            if (ev.key === opts.observeLocalStorageTenantKey) {
              window.TJUserPrefsSync.refresh(opts);
            }
          });
        } catch (_) {}
      }
    },
  };
})();
