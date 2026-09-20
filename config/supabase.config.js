/**
 * Supabase Configuration
 * Update these credentials with your actual Supabase project details
 */

const SupabaseConfig = {
  // 🔧 UPDATE THESE WITH YOUR SUPABASE CREDENTIALS
  // Go to: https://app.supabase.com → Settings → API → Project URL & Anon Key

  URL: 'https://crdblxeufbhysglbbtxi.supabase.co',
  KEY: 'sb_publishable_DOrG4C5uWnD1HJZ9HONFlA_T9MOp9fb',  // Must match FW_BACKEND.anonKey

  // Initialize Supabase client
  init() {
    try {
      // Check if Supabase library is loaded
      if (typeof supabase === 'undefined' || !supabase.createClient) {
        console.error('❌ Supabase library not loaded. Check CDN link.');
        return false;
      }

      if (!this.URL || !this.KEY) {
        console.error('❌ Supabase credentials missing');
        return false;
      }

      // Create client using global supabase object from CDN
      window.supabase = supabase.createClient(this.URL, this.KEY);
      console.log('✅ Supabase client initialized:', this.URL);
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

// Auto-init on load — wait for CDN to load
function waitForSupabaseLib() {
  if (typeof supabase !== 'undefined') {
    console.log('📡 Supabase library detected, initializing...');
    SupabaseConfig.init();
  } else {
    console.log('⏳ Waiting for Supabase CDN...');
    setTimeout(waitForSupabaseLib, 100);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', waitForSupabaseLib);
} else {
  waitForSupabaseLib();
}

window.SupabaseConfig = SupabaseConfig;
