/* ============ FleetWorks — auth/adapters/supabase ============
   Supabase Auth REST adapter. Session persistence remains owned by the
   existing cloudstore/reset scripts during migration. */

(function () {
  "use strict";

  function cfg() { return window.FW_BACKEND || { url: "", anonKey: "" }; }

  async function authJson(path, options) {
    if (!cfg().url || !cfg().anonKey) throw new Error("Backend not configured yet.");
    const response = await fetch(cfg().url + path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(FWAuthDomain.friendlyAuthErrorMessage(data, "Request failed."));
    return data;
  }

  const repository = {
    name: "auth.supabaseRepository",

    login(email, password) {
      return authJson("/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
        body: JSON.stringify({ email: FWAuthDomain.normalizeEmail(email), password }),
      });
    },

    signup(email, password, profile) {
      return authJson("/auth/v1/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
        body: JSON.stringify({ email: FWAuthDomain.normalizeEmail(email), password, data: profile || {} }),
      });
    },

    resendSignup(email) {
      return authJson("/auth/v1/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
        body: JSON.stringify({ type: "signup", email: FWAuthDomain.normalizeEmail(email) }),
      });
    },

    requestPasswordReset(email, redirectTo) {
      return authJson("/auth/v1/recover?redirect_to=" + encodeURIComponent(redirectTo), {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
        body: JSON.stringify({ email: FWAuthDomain.normalizeEmail(email) }),
      });
    },

    updatePassword(accessToken, password) {
      return authJson("/auth/v1/user", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg().anonKey,
          "Authorization": "Bearer " + accessToken,
        },
        body: JSON.stringify({ password }),
      });
    },
  };

  window.FWAuthRepository = window.FWAuthRepository || repository;
  if (window.FWHex) FWHex.registerAdapter("auth.repository", repository, { priority: 10 });
})();
