/* ============ FleetWorks — auth/domain ============
   Pure auth helpers. Keep DOM, fetch, Supabase, and localStorage out of
   this file so all login surfaces can reuse the same rules. */

(function () {
  "use strict";

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function validateEmail(email) {
    const clean = normalizeEmail(email);
    if (!clean) return { ok: false, email: clean, message: "Enter your account email." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { ok: false, email: clean, message: "Enter a valid email address." };
    return { ok: true, email: clean };
  }

  function validatePassword(password, minLength) {
    const min = minLength || 6;
    if (String(password || "").length < min) return { ok: false, message: "Password must be at least " + min + " characters." };
    return { ok: true };
  }

  function validateNewPassword(password, confirmPassword, minLength) {
    if (password !== confirmPassword) return { ok: false, message: "Passwords do not match." };
    return validatePassword(password, minLength);
  }

  function recoveryRedirectUrl(resetUrl, email) {
    const clean = normalizeEmail(email);
    return String(resetUrl || "") + (clean ? "?email=" + encodeURIComponent(clean) : "");
  }

  function parseRecoveryParams(hash, search) {
    const hashText = String(hash || "").replace(/^#/, "");
    const searchText = String(search || "").replace(/^\?/, "");
    const params = new URLSearchParams(hashText || searchText);
    return {
      type: params.get("type") || "",
      accessToken: params.get("access_token") || "",
      refreshToken: params.get("refresh_token") || "",
      tokenType: params.get("token_type") || "bearer",
    };
  }

  function isRecoveryLink(params) {
    return !!(params && params.type === "recovery" && params.accessToken);
  }

  function sessionKey(email) {
    return "fw_session:" + normalizeEmail(email);
  }

  function sessionPayload(session, email) {
    const user = { ...(session && session.user || {}), email: (session && session.user && session.user.email) || normalizeEmail(email) };
    return { ...(session || {}), user };
  }

  function friendlyAuthErrorMessage(input, fallback) {
    const text = String(
      (input && (input.msg || input.message || input.error_description || input.error)) ||
      input ||
      ""
    );
    const lower = text.toLowerCase();
    if (lower.includes("email address not authorized")) {
      return "Supabase is not allowed to send auth emails to this address. Configure custom SMTP in Supabase Auth, or add the address as an authorized team email for testing.";
    }
    if (lower.includes("rate") || lower.includes("too many") || lower.includes("429")) {
      return "Supabase auth email rate limit was reached. The default email provider is very limited; configure custom SMTP for reliable signup/reset emails.";
    }
    if (lower.includes("smtp") || lower.includes("gomail") || lower.includes("send email") || lower.includes("mail")) {
      return "Auth email could not be sent. Check Supabase Auth logs and configure custom SMTP for production email delivery.";
    }
    if (lower.includes("not confirmed")) {
      return "This account is waiting for email confirmation. If confirmation emails are not arriving, use the server-side owner signup flow or configure custom SMTP.";
    }
    return text || fallback || "Authentication request failed.";
  }

  window.FWAuthDomain = window.FWAuthDomain || {
    normalizeEmail,
    validateEmail,
    validatePassword,
    validateNewPassword,
    recoveryRedirectUrl,
    parseRecoveryParams,
    isRecoveryLink,
    sessionKey,
    sessionPayload,
    friendlyAuthErrorMessage,
  };
})();
