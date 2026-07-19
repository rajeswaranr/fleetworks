/* ============ FleetWorks — backend.js ============
   Supabase connection for the static site. The anon key is PUBLIC by
   design — Row Level Security in the database is what protects data
   (anonymous visitors can only insert leads/applications, never read).
   Until url/anonKey are filled in, forms silently fall back to
   localStorage-only behaviour. */

window.FW_BACKEND = {
  url: "https://crdblxeufbhysglbbtxi.supabase.co",
  anonKey: "sb_publishable_DOrG4C5uWnD1HJZ9HONFlA_T9MOp9fb"  // publishable key: safe to be public, RLS enforces security
};

window.fwConfigured = function () {
  return !!(window.FW_BACKEND.url && window.FW_BACKEND.anonKey);
};

/* Insert a row. Resolves true on success, false otherwise (never throws). */
window.fwInsert = function (table, row) {
  if (!window.fwConfigured()) return Promise.resolve(false);
  return fetch(window.FW_BACKEND.url + "/rest/v1/" + table, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": window.FW_BACKEND.anonKey,
      "Authorization": "Bearer " + window.FW_BACKEND.anonKey,
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(row)
  }).then(r => r.ok).catch(() => false);
};

/* Call a database function (RPC). Resolves parsed JSON or null. */
window.fwRpc = function (fn, args) {
  if (!window.fwConfigured()) return Promise.resolve(null);
  return fetch(window.FW_BACKEND.url + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": window.FW_BACKEND.anonKey,
      "Authorization": "Bearer " + window.FW_BACKEND.anonKey
    },
    body: JSON.stringify(args || {})
  }).then(r => r.ok ? r.json() : null).catch(() => null);
};
