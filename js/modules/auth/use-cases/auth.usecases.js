/* ============ FleetWorks — auth/use-cases ============ */

(function () {
  "use strict";

  function repository() {
    if (window.FWHex && FWHex.adapter("auth.repository")) return FWHex.adapter("auth.repository");
    return window.FWAuthRepository || null;
  }

  function requireRepository() {
    const repo = repository();
    if (!repo) throw new Error("Auth repository is not available.");
    return repo;
  }

  function register(name, fn) {
    if (window.FWHex) FWHex.registerUseCase(name, fn);
    return fn;
  }

  const useCases = {
    login: register("auth.login", async input => {
      const email = FWAuthDomain.validateEmail(input.email);
      if (!email.ok) throw new Error(email.message);
      const password = FWAuthDomain.validatePassword(input.password);
      if (!password.ok) throw new Error(password.message);
      return requireRepository().login(email.email, input.password);
    }),

    signup: register("auth.signup", async input => {
      const email = FWAuthDomain.validateEmail(input.email);
      if (!email.ok) throw new Error(email.message);
      const password = FWAuthDomain.validatePassword(input.password);
      if (!password.ok) throw new Error(password.message);
      return requireRepository().signup(email.email, input.password, input.profile || {});
    }),

    resendSignup: register("auth.resendSignup", async input => {
      const email = FWAuthDomain.validateEmail(input.email);
      if (!email.ok) throw new Error(email.message);
      return requireRepository().resendSignup(email.email);
    }),

    requestPasswordReset: register("auth.requestPasswordReset", async input => {
      const email = FWAuthDomain.validateEmail(input.email);
      if (!email.ok) throw new Error(email.message);
      const redirectTo = FWAuthDomain.recoveryRedirectUrl(input.resetUrl, email.email);
      return requireRepository().requestPasswordReset(email.email, redirectTo);
    }),

    updatePasswordFromRecovery: register("auth.updatePasswordFromRecovery", async input => {
      const validation = FWAuthDomain.validatePassword(input.password);
      if (!validation.ok) throw new Error(validation.message);
      const params = input.params || {};
      if (!FWAuthDomain.isRecoveryLink(params)) throw new Error("This reset link is missing or expired. Please request a new one.");
      return requireRepository().updatePassword(params.accessToken, input.password);
    }),
  };

  window.FWAuthUseCases = window.FWAuthUseCases || useCases;
})();
