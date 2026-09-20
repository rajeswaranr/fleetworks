/**
 * Supabase Initialization Script
 * Waits for library to load, then initializes with credentials
 */

function initSupabase() {
  // Get config from window.SupabaseConfig
  const config = window.SupabaseConfig || {};
  const url = config.URL;
  const key = config.KEY;

  if (!url || !key) {
    console.error('❌ Supabase URL or API Key missing in config');
    return false;
  }

  // Wait for supabase library to be available
  let attempts = 0;
  const maxAttempts = 50;

  const tryInit = () => {
    attempts++;

    // Check if window.supabase exists and has createClient
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        // Create Supabase client
        const supabaseClient = window.supabase.createClient(url, key);
        window.supabaseClient = supabaseClient;
        console.log('✅ Supabase client created successfully');

        // Make it available as window.supabase for backward compatibility
        window.supabase.client = supabaseClient;

        return true;
      } catch (error) {
        console.error('❌ Failed to create Supabase client:', error);
        return false;
      }
    } else if (attempts < maxAttempts) {
      // Library not ready yet, try again
      setTimeout(tryInit, 100);
    } else {
      console.error('❌ Supabase library did not load after', maxAttempts, 'attempts');
      console.error('window.supabase:', window.supabase);
    }
  };

  tryInit();
}

// Initialize when ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initSupabase, 500);
  });
} else {
  setTimeout(initSupabase, 500);
}
