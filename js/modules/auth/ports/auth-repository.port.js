/* ============ FleetWorks — auth/ports ============ */

(function () {
  "use strict";

  const methods = [
    "login",
    "signup",
    "resendSignup",
    "requestPasswordReset",
    "updatePassword",
  ];

  window.FWAuthPort = window.FWAuthPort || { name: "auth.repository", methods };
  if (window.FWHex) FWHex.definePort("auth.repository", methods);
})();
