/**
 * Role-Based Dashboard Router
 * Routes users to their specific dashboard based on role
 */

const RoleBasedRouter = {
  async init() {
    // Check if user is logged in
    if (!window.supabaseUser) {
      console.log('No user logged in, showing auth gate');
      return;
    }

    const user = window.supabaseUser;
    const role = user.user_metadata?.role || 'owner';

    console.log(`✅ User logged in as: ${role}`);

    // Route to appropriate dashboard
    this.routeToDashboard(role);
  },

  routeToDashboard(role) {
    const dashboards = {
      'owner': 'account',
      'driver': 'driver-app',
      'admin': 'admin',
      'workshop': 'workshop'
    };

    const tabKey = dashboards[role] || 'account';
    const tabBtn = document.querySelector(`[data-tab="${tabKey}"]`);

    if (tabBtn) {
      tabBtn.click();
      console.log(`✅ Routed to ${role} dashboard`);
    } else {
      console.warn(`Dashboard tab not found for role: ${role}`);
      // Fallback to account tab
      const accountBtn = document.querySelector('[data-tab="account"]');
      if (accountBtn) accountBtn.click();
    }
  },

  // Get user role
  getUserRole() {
    if (!window.supabaseUser) return null;
    return window.supabaseUser.user_metadata?.role || 'owner';
  },

  // Check if user has specific role
  hasRole(role) {
    return this.getUserRole() === role;
  },

  // Check if user has any of the roles
  hasAnyRole(roles) {
    const userRole = this.getUserRole();
    return roles.includes(userRole);
  }
};

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => RoleBasedRouter.init(), 1000);
  });
} else {
  setTimeout(() => RoleBasedRouter.init(), 1000);
}

window.RoleBasedRouter = RoleBasedRouter;
