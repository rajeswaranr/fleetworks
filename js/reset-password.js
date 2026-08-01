/* ============ FleetWorks — reset-password.js ============
   Dedicated password-reset page opened from Supabase recovery emails.
   The recovery token in the URL authorizes updating the Supabase Auth
   password; the email field is used to establish a normal app session after
   the password is changed. */

"use strict";

const SKEY_ACTIVE = "fw_session:active";
const SKEY_LEGACY = "fw_session";

function cfg() { return window.FW_BACKEND || { url: "", anonKey: "" }; }
function tokenParams() {
  const hash = String(location.hash || "").replace(/^#/, "");
  const search = String(location.search || "").replace(/^\?/, "");
  const params = new URLSearchParams(hash || search);
  return {
    type: params.get("type") || "",
    accessToken: params.get("access_token") || "",
    refreshToken: params.get("refresh_token") || "",
    tokenType: params.get("token_type") || "bearer",
  };
}
function emailFromUrl() {
  return new URLSearchParams(String(location.search || "").replace(/^\?/, "")).get("email") || "";
}
function sessionKey(email) { return "fw_session:" + String(email || "").trim().toLowerCase(); }
function setSession(session, email) {
  if (!session || !session.access_token) return;
  const user = { ...(session.user || {}), email: (session.user && session.user.email) || email };
  const payload = { ...session, user };
  const key = sessionKey(user.email);
  localStorage.setItem(key, JSON.stringify(payload));
  localStorage.setItem(SKEY_ACTIVE, key);
  localStorage.removeItem(SKEY_LEGACY);
}
async function authJson(path, options) {
  const response = await fetch(cfg().url + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.msg || data.error_description || data.error || "Request failed.");
  return data;
}
async function updatePassword(accessToken, password) {
  return authJson("/auth/v1/user", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "apikey": cfg().anonKey,
      "Authorization": "Bearer " + accessToken,
    },
    body: JSON.stringify({ password }),
  });
}
async function login(email, password) {
  return authJson("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": cfg().anonKey },
    body: JSON.stringify({ email, password }),
  });
}

const params = tokenParams();
const form = document.getElementById("resetPageForm");
const missing = document.getElementById("resetMissingToken");
const err = document.getElementById("resetPageErr");
const note = document.getElementById("resetPageNote");
const emailParam = emailFromUrl();
const emailInput = form.querySelector ? form.querySelector('[name="email"]') : (form.email || (form.elements && form.elements.email));
if (emailParam && emailInput) emailInput.value = emailParam;

if (params.type !== "recovery" || !params.accessToken) {
  form.hidden = true;
  missing.hidden = false;
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(form));
  const email = String(fd.email || "").trim().toLowerCase();
  err.hidden = true; note.hidden = true;
  if (fd.password !== fd.confirmPassword) { err.textContent = "Passwords do not match."; err.hidden = false; return; }
  if (String(fd.password || "").length < 6) { err.textContent = "Password must be at least 6 characters."; err.hidden = false; return; }
  try {
    const user = await updatePassword(params.accessToken, fd.password);
    let session = null;
    try { session = await login(email, fd.password); }
    catch {
      session = params.refreshToken ? {
        access_token: params.accessToken,
        refresh_token: params.refreshToken,
        token_type: params.tokenType,
        user: { ...user, email },
      } : null;
    }
    if (session) setSession(session, email);
    note.textContent = "Password updated. Opening your FleetWorks account...";
    note.hidden = false;
    history.replaceState(null, "", location.pathname);
    setTimeout(() => { location.href = "fleet.html#account"; }, 600);
  } catch (ex) {
    err.textContent = ex.message || "Could not update password. Request a new reset link and try again.";
    err.hidden = false;
  }
});
