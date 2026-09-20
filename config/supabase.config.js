/**
 * Shared supabase-js client (window.supabase) for the module controllers.
 *
 * Single source of truth: URL and key come from js/backend.js (FW_BACKEND),
 * which must load first. Sign-in/session is owned by fwCloud (js/cloudstore.js);
 * this client only borrows its access token via the `accessToken` option, so
 * there is never a second session or a competing refresh token. Signed out,
 * requests go out with the anon key.
 */
(function () {
  var cfg = window.FW_BACKEND;
  if (!cfg || !cfg.url || !cfg.anonKey) {
    console.error("[FleetWorks] FW_BACKEND missing — load js/backend.js before config/supabase.config.js");
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("[FleetWorks] supabase-js library not loaded (CDN blocked?)");
    return;
  }

  window.SUPABASE_URL = cfg.url;
  window.SUPABASE_ANON_KEY = cfg.anonKey;

  window.supabase = window.supabase.createClient(cfg.url, cfg.anonKey, {
    accessToken: async function () {
      return (window.fwCloud && await window.fwCloud.accessToken()) || null;
    }
  });
})();
