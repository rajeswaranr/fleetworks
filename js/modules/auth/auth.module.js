/* ============ FleetWorks — modules/auth ============
   Additive auth module. Existing pages still own their UI; this module
   centralizes auth rules and Supabase Auth actions behind use cases. */

(function () {
  "use strict";

  const Auth = {
    normalizeEmail: FWAuthDomain.normalizeEmail,
    parseRecoveryParams: FWAuthDomain.parseRecoveryParams,
    isRecoveryLink: FWAuthDomain.isRecoveryLink,
    login(input) { return FWAuthUseCases.login(input || {}); },
    signup(input) { return FWAuthUseCases.signup(input || {}); },
    resendSignup(input) { return FWAuthUseCases.resendSignup(input || {}); },
    requestPasswordReset(input) { return FWAuthUseCases.requestPasswordReset(input || {}); },
    updatePasswordFromRecovery(input) { return FWAuthUseCases.updatePasswordFromRecovery(input || {}); },
  };

  window.FWAuth = window.FWAuth || Auth;

  function registerHex() {
    if (!window.FWHex) return false;
    if (!FWHex.port("auth.repository")) FWHex.definePort("auth.repository", window.FWAuthPort.methods);
    if (!FWHex.adapter("auth.repository")) FWHex.registerAdapter("auth.repository", window.FWAuthRepository, { priority: 10 });
    FWHex.registerUseCase("auth.login", FWAuthUseCases.login);
    FWHex.registerUseCase("auth.signup", FWAuthUseCases.signup);
    FWHex.registerUseCase("auth.resendSignup", FWAuthUseCases.resendSignup);
    FWHex.registerUseCase("auth.requestPasswordReset", FWAuthUseCases.requestPasswordReset);
    FWHex.registerUseCase("auth.updatePasswordFromRecovery", FWAuthUseCases.updatePasswordFromRecovery);
    FWHex.registerViewModel("auth.resetRequestResult", FWAuthViewModel.resetRequestResult);
    return true;
  }

  function registerPlatformModule() {
    if (!window.FWPlatform) return false;
    if (FWPlatform.getModule && FWPlatform.getModule("auth")) return true;
    FWPlatform.registerModule({
      id: "auth",
      name: "Auth",
      version: "0.1.0",
      layer: "platform",
      order: 5,
      description: "Login, signup, password reset, and Supabase Auth recovery flow.",
      dependencies: [],
      permissions: ["auth.login", "auth.signup", "auth.password_reset"],
      endpoints: ["/auth/v1/token", "/auth/v1/signup", "/auth/v1/recover", "/auth/v1/user", "/auth/v1/resend"],
      capabilities: ["auth.core", "auth.password_reset"],
      init(ctx) {
        ctx.platform.registerCapability("auth.core", Auth);
        ctx.platform.registerCapability("auth.password_reset", {
          request: Auth.requestPasswordReset,
          update: Auth.updatePasswordFromRecovery,
        });
      },
    });
    return true;
  }

  if (!registerHex()) setTimeout(registerHex, 0);
  if (!registerPlatformModule()) setTimeout(registerPlatformModule, 0);
})();
