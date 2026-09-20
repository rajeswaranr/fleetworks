/* Publishes the signed-in fwCloud user as window.supabaseUser (with org_id) for
   the module controllers that query through window.supabase. Login itself is
   handled only by account.js/fwCloud. */
(function () {
  "use strict";

  async function sync() {
    if (!(window.fwCloud && fwCloud.user())) { window.supabaseUser = null; return null; }
    const org = typeof getMyOrgId === "function" ? await getMyOrgId().catch(() => null) : null;
    window.supabaseUser = {
      id: fwCloud.uid(),
      email: fwCloud.user(),
      user_metadata: fwCloud.profile(),
      org_id: org
    };
    document.dispatchEvent(new CustomEvent("fw:supabase-user", { detail: window.supabaseUser }));
    return window.supabaseUser;
  }

  window.supabaseReady = sync();
})();
