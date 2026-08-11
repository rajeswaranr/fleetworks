/* ============ FleetWorks — auth-reset.js ============
   Shared forgot-password helper for all FleetWorks login screens.
   Sends one Supabase recovery email that always returns to reset.html. */

(function () {
  "use strict";

  function cfg() { return window.FW_BACKEND || { url: "", anonKey: "" }; }
  function resetPasswordUrl() {
    const loc = window.location || location;
    return (loc.origin || "") + (loc.pathname || "/").replace(/[^/]*$/, "reset.html");
  }
  function recoveryRedirectUrl(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    return resetPasswordUrl() + (cleanEmail ? "?email=" + encodeURIComponent(cleanEmail) : "");
  }
  function byId(id) { return id ? document.getElementById(id) : null; }
  function setHidden(ids, hidden) {
    (ids || []).forEach(id => {
      const el = byId(id);
      if (el) el.hidden = hidden;
    });
  }
  function formEmail(formId) {
    const form = byId(formId);
    const input = form && (form.elements ? form.elements.email : form.querySelector('[name="email"]'));
    return input ? String(input.value || "").trim() : "";
  }

  async function requestPasswordReset(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) throw new Error("Enter your account email.");
    if (window.FWAuth && window.FWAuth.requestPasswordReset) {
      await window.FWAuth.requestPasswordReset({ email: cleanEmail, resetUrl: resetPasswordUrl() });
      return true;
    }
    if (!cfg().url || !cfg().anonKey) throw new Error("Backend not configured yet.");
    const redirectTo = recoveryRedirectUrl(cleanEmail);
    const r = await fetch(cfg().url + "/auth/v1/recover?redirect_to=" + encodeURIComponent(redirectTo), {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
      body: JSON.stringify({ email: cleanEmail })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.msg || j.error_description || j.error || "Could not send reset email.");
    }
    return true;
  }

  function wire(config) {
    const button = byId(config.buttonId);
    const panel = byId(config.panelId);
    const form = byId(config.formId);
    const back = byId(config.backId);
    const err = byId(config.errorId);
    const note = byId(config.noteId);
    if (!button || !panel || !form) return;

    function clearMessages() {
      if (err) { err.textContent = ""; err.hidden = true; }
      if (note) { note.textContent = ""; note.hidden = true; }
    }
    function showResetPanel() {
      clearMessages();
      const email = formEmail(config.loginFormId);
      const input = form.elements ? form.elements.email : form.querySelector('[name="email"]');
      if (email && input) input.value = email;
      setHidden(config.hideOnOpen, true);
      setHidden(config.showOnOpen, false);
      panel.hidden = false;
    }
    function showLoginPanel() {
      clearMessages();
      panel.hidden = true;
      setHidden(config.hideOnClose, true);
      setHidden(config.showOnClose, false);
    }

    button.addEventListener("click", showResetPanel);
    if (back) back.addEventListener("click", showLoginPanel);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      clearMessages();
      const fd = Object.fromEntries(new FormData(form));
      try {
        await requestPasswordReset(fd.email);
        if (note) {
          note.textContent = "Reset link sent. Check your inbox and spam folder, then open the link from this browser.";
          note.hidden = false;
        }
      } catch (ex) {
        if (err) {
          err.textContent = ex.message || "Could not send reset email.";
          err.hidden = false;
        }
      }
    });
  }

  window.FWAuthReset = { requestPasswordReset, wire };
})();
