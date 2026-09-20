/**
 * Supabase Configuration
 * Update these credentials with your actual Supabase project details
 */

const SupabaseConfig = {
  // 🔧 UPDATE THESE WITH YOUR SUPABASE CREDENTIALS
  // Go to: https://app.supabase.com → Settings → API → Project URL & Anon Key

  URL: 'https://crdblxeufbhysglbbtxi.supabase.co',
  KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNyZGJseGV1ZmJoeXNnbGJidHhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NjEwMTcsImV4cCI6MjEwMDAzNzAxN30.0K1CHa4Xj16s169y_5gW5lhEPQKhF_b-G4-HzuEIKyY',

  // Initialize Supabase client
  init() {
    try {
      if (!window.supabase) {
        console.error('❌ Supabase library not loaded');
        return false;
      }

      if (!this.URL || !this.KEY) {
        console.error('❌ Supabase credentials missing');
        return false;
      }

      window.supabase = window.supabase.createClient(this.URL, this.KEY);
      console.log('✅ Supabase initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Supabase init error:', error);
      return false;
    }
  },

  // Test connection
  async testConnection() {
    try {
      if (!window.supabase) return false;

      const { data, error } = await window.supabase.auth.getSession();
      if (error) {
        console.error('❌ Connection test failed:', error);
        return false;
      }
      console.log('✅ Connection test passed');
      return true;
    } catch (error) {
      console.error('❌ Connection test error:', error);
      return false;
    }
  }
};

// Auto-init on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => SupabaseConfig.init(), 100);
  });
} else {
  SupabaseConfig.init();
}

window.SupabaseConfig = SupabaseConfig;
