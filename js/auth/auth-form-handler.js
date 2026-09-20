/**
 * Auth Form Handler
 * Handles login/signup form submission and role-based routing
 */

const AuthFormHandler = {
  init() {
    this.setupFormListeners();
    console.log('✅ Auth form handler initialized');
  },

  setupFormListeners() {
    const authForm = document.getElementById('authForm');
    const authToggle = document.getElementById('authToggle');
    const signupOnlyFields = document.getElementById('signupOnlyFields');

    if (!authForm) return;

    // Form submission
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleFormSubmit(authForm);
    });

    // Toggle between login and signup
    if (authToggle) {
      authToggle.addEventListener('click', (e) => {
        e.preventDefault();
        const isSignup = signupOnlyFields.hidden;
        signupOnlyFields.hidden = !isSignup;
        document.getElementById('authTitle').textContent = isSignup ? 'Create Free Account' : 'Log in to FleetWorks';
        document.getElementById('authSub').innerHTML = isSignup
          ? 'Already have an account? <button type="button" class="link-btn" id="authToggle">Sign in</button>'
          : 'Don\'t have an account? <button type="button" class="link-btn" id="authToggle">Start a free trial</button>';
        document.getElementById('authSubmit').textContent = isSignup ? 'Create Account' : 'Log In';

        // Re-attach listener to new toggle button
        const newToggle = document.getElementById('authToggle');
        if (newToggle) {
          newToggle.addEventListener('click', (e) => {
            e.preventDefault();
            authToggle.click();
          });
        }
      });
    }
  },

  async handleFormSubmit(form) {
    try {
      const email = form.email.value.trim();
      const password = form.password.value.trim();
      const isSignup = !document.getElementById('signupOnlyFields').hidden;

      if (!email || !password) {
        this.showError('Email and password are required');
        return;
      }

      const errorDiv = document.getElementById('authErr');
      errorDiv.hidden = true;

      if (isSignup) {
        // Sign up flow
        const fullName = form.fullName.value.trim();
        const companyName = form.transportName.value.trim();
        const mobile = form.mobile.value.trim();
        const gstPan = form.gstPan.value.trim();
        const fleetSize = form.fleetSize.value.trim();

        if (!fullName || !companyName) {
          this.showError('Name and company name are required');
          return;
        }

        const result = await TrialSignup.registerTrial({
          email, password, fullName, companyName, mobile, gstPan, fleetSize
        });

        if (result.success) {
          this.showSuccess('Account created! Check your email for verification.');
          setTimeout(() => {
            form.reset();
            document.getElementById('signupOnlyFields').hidden = true;
            document.getElementById('authTitle').textContent = 'Log in to FleetWorks';
          }, 2000);
        } else {
          this.showError(result.error || 'Sign up failed');
        }
      } else {
        // Login flow
        const result = await SupabaseAuth.signin(email, password);

        if (result.success) {
          this.showSuccess('Login successful! Redirecting...');

          // Redirect based on role (determine role from user metadata or default to owner)
          setTimeout(() => {
            const user = window.supabaseUser;
            const role = user?.user_metadata?.role || 'owner';

            const rolePages = {
              'owner': '#account',
              'driver': '#driver-app',
              'admin': '#admin',
              'workshop': '#workshop'
            };

            window.location.hash = rolePages[role] || '#account';
            window.location.reload();
          }, 1000);
        } else {
          this.showError(result.error || 'Login failed. Check credentials.');
        }
      }
    } catch (error) {
      console.error('Form submission error:', error);
      this.showError('An error occurred: ' + error.message);
    }
  },

  showError(message) {
    const errorDiv = document.getElementById('authErr');
    if (errorDiv) {
      errorDiv.textContent = message;
      errorDiv.hidden = false;
    }
  },

  showSuccess(message) {
    const errorDiv = document.getElementById('authErr');
    if (errorDiv) {
      errorDiv.textContent = message;
      errorDiv.style.color = '#10b981';
      errorDiv.hidden = false;
    }
  }
};

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => AuthFormHandler.init(), 500);
  });
} else {
  setTimeout(() => AuthFormHandler.init(), 500);
}

window.AuthFormHandler = AuthFormHandler;
