/**
 * Supabase Initialization Script
 * Simpler init with better error handling
 */

function initSupabase() {
  // Check if Supabase library is loaded
  if (typeof supabase === 'undefined') {
    console.error('❌ Supabase library not loaded. Make sure it\'s imported.');
    return false;
  }

  // Get config from window.SupabaseConfig or use defaults
  const config = window.SupabaseConfig || {};
  const url = config.URL || localStorage.getItem('supabase_url');
  const key = config.KEY || localStorage.getItem('supabase_key');

  if (!url || !key) {
    console.error('❌ Supabase URL or API Key missing');
    console.log('Please configure Supabase credentials in config/supabase.config.js');
    return false;
  }

  try {
    // Create Supabase client
    window.supabase = supabase.createClient(url, key);
    console.log('✅ Supabase client created successfully');

    // Test connection
    window.supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) {
          console.error('⚠️ Connection test failed:', error.message);
        } else {
          console.log('✅ Supabase connection test passed');
        }
      })
      .catch(err => console.error('Connection test error:', err));

    return true;
  } catch (error) {
    console.error('❌ Failed to create Supabase client:', error);
    return false;
  }
}

// Initialize when ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initSupabase, 100);
  });
} else {
  initSupabase();
}
