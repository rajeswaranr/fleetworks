/* ============ FleetWorks — auth/view-models ============ */

(function () {
  "use strict";

  function resetRequestResult(input) {
    return {
      ok: !!(input && input.ok),
      message: input && input.ok
        ? "Reset link sent. Check your inbox and spam folder, then open the link from this browser."
        : input && input.message || "Could not send reset email.",
    };
  }

  window.FWAuthViewModel = window.FWAuthViewModel || { resetRequestResult };
  if (window.FWHex) {
    FWHex.registerViewModel("auth.resetRequestResult", resetRequestResult);
  }
})();
