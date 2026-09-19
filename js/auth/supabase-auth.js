/**
 * Supabase Authentication Manager
 * Handles user sign-up, login, password reset
 */

const SupabaseAuth = {
  client: null,
  user: null,

  init() {
    // Initialize Supabase (already injected from fleet.html)
    this.client = window.supabase;
    this.checkAuth();
    console.log('Supabase Auth initialized');
  },

  // Check if user is logged in
  async checkAuth() {
    try {
      const { data: { session } } = await this.client.auth.getSession();
      this.user = session?.user || null;

      if (this.user) {
        console.log('User logged in:', this.user.email);
        this.showApp();
      } else {
        console.log('No user session');
        this.showAuthPage();
      }
    } catch (error) {
      console.error('Auth check error:', error);
      this.showAuthPage();
    }
  },

  // Sign up new user
  async signup(email, password, fullName, companyName) {
    try {
      const { data, error } = await this.client.auth.signUp({
        email: email,
        password: password,
        options: {
          data: {
            full_name: fullName,
            company_name: companyName
          }
        }
      });

      if (error) throw error;

      return {
        success: true,
        message: 'Check your email for verification link',
        data: data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  },

  // Sign in
  async signin(email, password) {
    try {
      const { data, error } = await this.client.auth.signInWithPassword({
        email: email,
        password: password
      });

      if (error) throw error;

      this.user = data.user;
      this.showApp();

      return {
        success: true,
        message: 'Welcome back!',
        data: data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  },

  // Sign out
  async signout() {
    try {
      const { error } = await this.client.auth.signOut();
      if (error) throw error;

      this.user = null;
      this.showAuthPage();

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Reset password
  async resetPassword(email) {
    try {
      const { error } = await this.client.auth.resetPasswordForEmail(email);
      if (error) throw error;

      return {
        success: true,
        message: 'Check your email for password reset link'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Show app
  showApp() {
    const authGate = document.getElementById('authGate');
    const appBody = document.querySelector('.app-body');

    if (authGate) authGate.hidden = true;
    if (appBody) appBody.style.display = 'block';

    // Make user data globally available
    window.supabaseUser = this.user;
  },

  // Show auth page
  showAuthPage() {
    const authGate = document.getElementById('authGate');
    const appBody = document.querySelector('.app-body');

    if (authGate) authGate.hidden = false;
    if (appBody) appBody.style.display = 'none';
  },

  // Get current user
  getUser() {
    return this.user;
  },

  // Get auth token
  async getToken() {
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token;
  }
};

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => SupabaseAuth.init(), 100);
  });
} else {
  setTimeout(() => SupabaseAuth.init(), 100);
}

window.SupabaseAuth = SupabaseAuth;
