/**
 * Authenticated fetch for /api/* — attaches Firebase ID token (Tech Jump Hosting).
 * Requires: firebase compat + currentUser (call only after sign-in).
 */
(function () {
  function mergeHeaders(base, extra) {
    var out = {};
    if (base && typeof base === "object" && !Array.isArray(base)) {
      for (var k in base) {
        if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
      }
    }
    if (extra && typeof extra === "object") {
      for (var j in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, j)) out[j] = extra[j];
      }
    }
    return out;
  }

  async function tjFetch(url, options) {
    options = options || {};
    if (typeof firebase === "undefined" || !firebase.auth) {
      throw new Error("Firebase Auth not loaded");
    }
    var user = firebase.auth().currentUser;
    if (!user) {
      var err = new Error("Not signed in");
      err.code = "auth_required";
      throw err;
    }
    var token = await user.getIdToken();
    var headers = mergeHeaders(options.headers, {
      Authorization: "Bearer " + token,
    });
    return fetch(url, Object.assign({}, options, { headers: headers, credentials: "same-origin" }));
  }

  window.TJFetch = tjFetch;
})();
