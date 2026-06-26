/**
 * Firebase Auth (Google) + org domain gate for Tech Jump Hosting.
 * Requires: firebase-app-compat, firebase-auth-compat, /__/firebase/init.js before this script.
 *
 * - Waits for auth state to be ready before subscribing (avoids a bogus null → sign-in flash).
 * - Access is gated by Firebase Auth + org domain; Google users skip strict emailVerified (popup + redirect supported).
 *
 * Debug (Console): add ?authDebug=1 to the URL or run localStorage.setItem("tj_auth_debug","1") then reload.
 *
 * Safety: if auth never becomes ready or onAuthStateChanged never fires (bad init / network),
 * we stop showing “Checking session…” and fall back to sign-in with guidance.
 */
(function () {
  var AUTH_READY_WAIT_MS = 10000;
  var LISTENER_WAIT_MS = 12000;
  /** If the init chain never reaches attachAuthListener (e.g. getRedirectResult hangs), still recover. */
  var BOOTSTRAP_MAX_WAIT_MS = 30000;
  function isAuthDebug() {
    try {
      if (typeof location !== "undefined" && location.search && location.search.indexOf("authDebug=1") !== -1) {
        return true;
      }
      return localStorage.getItem("tj_auth_debug") === "1";
    } catch (_) {
      return false;
    }
  }

  function dbg() {
    if (!isAuthDebug() || typeof console === "undefined" || !console.info) return;
    var args = ["[TJAuth]"].concat(Array.prototype.slice.call(arguments));
    console.info.apply(console, args);
  }

  function dbgOnce() {
    if (!isAuthDebug() || dbgOnce._done) return;
    dbgOnce._done = true;
    dbg("page", typeof location !== "undefined" ? location.href : "(no location)");
    dbg("origin", typeof location !== "undefined" ? location.origin : "");
    dbg("Match this origin in Firebase Console → Authentication → Settings → Authorized domains.");
  }

  var REASON_MESSAGES = {
    domain:
      "Only Tech Jump team emails (@tech-jump.com or @techjump.com) can use this app.",
    unverified:
      "Please verify your email address in your Google account, then sign in again.",
    timeout:
      "Session check timed out. Try refreshing, then sign in again from your Firebase Hosting URL.",
    firebase:
      "Firebase Auth is not loaded. Open this app from Firebase Hosting (not as a local file).",
    generic: "Sign-in could not be completed. Please try again.",
  };

  function allowedDomain(email) {
    if (!email || typeof email !== "string") return false;
    const e = email.toLowerCase().trim();
    return e.endsWith("@tech-jump.com") || e.endsWith("@techjump.com");
  }

  /** Google OAuth users are treated as verified for client gate (Firebase sometimes lags emailVerified). */
  function isGoogleProviderUser(user) {
    if (!user || !user.providerData || !user.providerData.length) return false;
    for (var i = 0; i < user.providerData.length; i++) {
      if (user.providerData[i].providerId === "google.com") return true;
    }
    return false;
  }

  function hideAuthLoading() {
    var el = document.getElementById("auth-loading-root");
    if (el) el.hidden = true;
    /* login.html uses #checkingState instead of auth-loading-root */
    var chk = document.getElementById("checkingState");
    if (chk) chk.hidden = true;
  }

  /** Resolve when persisted auth has been loaded (avoids first onAuthStateChanged(null) flash). */
  function authStateReadyCompat() {
    if (typeof firebase === "undefined" || !firebase.auth) {
      return Promise.resolve();
    }
    var auth = firebase.auth();
    if (typeof auth.authStateReady === "function") {
      return auth.authStateReady();
    }
    return new Promise(function (resolve) {
      var unsub = auth.onAuthStateChanged(function () {
        unsub();
        resolve();
      });
    });
  }

  function init(callbacks) {
    var listenerSafetyTimer = null;
    var bootstrapSafetyTimer = null;

    function clearAllSafetyTimers() {
      if (bootstrapSafetyTimer) {
        clearTimeout(bootstrapSafetyTimer);
        bootstrapSafetyTimer = null;
      }
      if (listenerSafetyTimer) {
        clearTimeout(listenerSafetyTimer);
        listenerSafetyTimer = null;
      }
    }

    function onGuest(opts) {
      clearAllSafetyTimers();
      hideAuthLoading();
      callbacks.onGuest(opts);
    }
    function onAuthed(user) {
      clearAllSafetyTimers();
      hideAuthLoading();
      callbacks.onAuthed(user);
    }

    if (typeof firebase === "undefined" || !firebase.auth) {
      dbgOnce();
      dbg("Firebase not loaded — check Network for firebase-app / firebase-auth / __/firebase/init.js");
      onGuest({
        reason: "firebase",
        message: REASON_MESSAGES.firebase,
      });
      return;
    }

    dbgOnce();

    bootstrapSafetyTimer = setTimeout(function () {
      var loadingEl = document.getElementById("auth-loading-root");
      if (loadingEl && !loadingEl.hidden) {
        dbg(
          "Auth bootstrap still on loading after " +
            BOOTSTRAP_MAX_WAIT_MS +
            "ms — sign-in fallback (init chain or redirect may be stuck)"
        );
        onGuest({
          reason: "timeout",
          message:
            "Session check timed out. Try refreshing. If you use “Continue with Google”, a stuck redirect can cause this — try again from your Firebase Hosting URL and check the Network tab for /__/firebase/init.js (must be 200).",
        });
      }
    }, BOOTSTRAP_MAX_WAIT_MS);

    var authEpoch = 0;

    function authReadyOrTimeout() {
      return Promise.race([
        authStateReadyCompat(),
        new Promise(function (resolve) {
          setTimeout(function () {
            dbg(
              "authStateReadyCompat still pending after " +
                AUTH_READY_WAIT_MS +
                "ms — continuing (listener may still resolve auth)"
            );
            resolve();
          }, AUTH_READY_WAIT_MS);
        }),
      ]);
    }

    function attachAuthListener() {
      listenerSafetyTimer = setTimeout(function () {
        var loadingEl = document.getElementById("auth-loading-root");
        if (loadingEl && !loadingEl.hidden) {
          dbg("onAuthStateChanged did not hide loading within " + LISTENER_WAIT_MS + "ms — sign-in fallback");
          onGuest({
            reason: "timeout",
            message:
              "Session check timed out. Try refreshing. Open this site from your Firebase Hosting URL (not a saved file) so firebase-app, firebase-auth, and /__/firebase/init.js all load (check Network tab). See the browser console for errors.",
          });
        }
      }, LISTENER_WAIT_MS);

      firebase.auth().onAuthStateChanged(async function (user) {
        clearAllSafetyTimers();
        var myEpoch = ++authEpoch;

        if (!user) {
          /** LOCAL persistence can resolve hundreds of ms after the first null callback — wait before redirectGuest or real signed-out users look like guests mid-restore. */
          dbg("auth: user null from callback — polling persisted session before guest path");
          try {
            await authStateReadyCompat();
          } catch (_) {}
          if (myEpoch !== authEpoch) return;
          user = firebase.auth().currentUser;
          var pollUntil = Date.now() + 2500;
          while (!user && Date.now() < pollUntil) {
            if (myEpoch !== authEpoch) return;
            await new Promise(function (resolve) {
              setTimeout(resolve, 120);
            });
            if (myEpoch !== authEpoch) return;
            user = firebase.auth().currentUser;
          }
        }

        if (!user) {
          dbg("guest: firebase user is null (not signed in, or storage blocked, or wrong origin)");
          onGuest({ message: "" });
          return;
        }
        dbg("firebase user", user.uid, user.email);
        if (!user.emailVerified && !isGoogleProviderUser(user)) {
          dbg("guest: email not verified (client check)");
          await firebase.auth().signOut().catch(function () {});
          if (myEpoch !== authEpoch) return;
          onGuest({
            message:
              "Please verify your email address in your Google account, then sign in again.",
          });
          return;
        }
        if (!allowedDomain(user.email || "")) {
          dbg("guest: email domain not allowed (client check)", user.email);
          await firebase.auth().signOut().catch(function () {});
          if (myEpoch !== authEpoch) return;
          onGuest({
            message:
              "Only Tech Jump team emails (@tech-jump.com or @techjump.com) can use this app.",
          });
          return;
        }

        onAuthed(user);
      });
    }

    authReadyOrTimeout()
      .then(function () {
        return firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function () {});
      })
      .then(function () {
        return firebase.auth().getRedirectResult();
      })
      .catch(function () {})
      .then(function () {
        attachAuthListener();
      })
      .catch(function () {
        attachAuthListener();
      });
  }

  /**
   * Popup-only default. We no longer fall back to signInWithRedirect automatically: redirect
   * navigates to *.firebaseapp.com/__/auth/handler and some PCs/networks hit NET::ERR_CERT_AUTHORITY_INVALID
   * there (antivirus HTTPS scanning, VPN, broken trust store). Users can call signInWithGoogleRedirect explicitly from UI.
   */
  function signInWithGoogle() {
    var provider = new firebase.auth.GoogleAuthProvider();
    return firebase.auth().signInWithPopup(provider).catch(function (err) {
      var code = err && err.code ? String(err.code) : "unknown";
      if (code === "auth/popup-blocked") {
        var wrap = new Error(
          "Pop-ups are blocked. Allow pop-ups for this site (address bar lock or site settings), then click Continue again. Or use “Full-page sign-in” below if pop-ups cannot be enabled.",
        );
        wrap.code = "auth/popup-blocked";
        throw wrap;
      }
      if (code === "auth/operation-not-supported-in-this-environment") {
        var wrap2 = new Error(
          "This viewer doesn’t support Google pop-up sign-in. Open this page in Chrome, Edge, or Safari (full browser window).",
        );
        wrap2.code = code;
        throw wrap2;
      }
      throw err;
    });
  }

  function signOut() {
    return firebase.auth().signOut();
  }

  function signInWithGoogleRedirect() {
    var provider = new firebase.auth.GoogleAuthProvider();
    return firebase.auth().signInWithRedirect(provider);
  }

  window.TJAuth = {
    init: init,
    signInWithGoogle: signInWithGoogle,
    signInWithGoogleRedirect: signInWithGoogleRedirect,
    signOut: signOut,
    allowedDomain: allowedDomain,
    reasonMessages: REASON_MESSAGES,
  };

  /** Enable persistent console logging until disabled: TJAuth.setDebug(true|false) */
  window.TJAuth.setDebug = function (on) {
    try {
      if (on) {
        localStorage.setItem("tj_auth_debug", "1");
      } else {
        localStorage.removeItem("tj_auth_debug");
      }
    } catch (_) {}
    dbg("debug logging " + (on ? "enabled" : "disabled") + " — reload the page");
  };
})();
