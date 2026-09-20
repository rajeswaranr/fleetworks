/**
 * Supabase Initialization Script
 * Waits for library to load, then initializes with credentials
 */

function initSupabase() {
  // Supabase client should already be created by supabase.config.js
  // Just verify it's available and working

  if (window.supabase && typeof window.supabase.auth === 'object') {
    console.log('✅ Supabase client available and ready');

    // Test connection
    if (typeof window.supabase.auth.getSession === 'function') {
      window.supabase.auth.getSession()
        .then(({ data, error }) => {
          if (error) {
            console.log('ℹ️ No active session (expected on first load)');
          } else {
            console.log('✅ Supabase session check passed');
          }
        })
        .catch(err => console.error('Session check error:', err));
    }
    return true;
  } else {
    console.error('❌ Supabase client not available');
    console.log('window.supabase:', window.supabase);
    return false;
  }
}

// Initialize when ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initSupabase, 500);
  });
} else {
  setTimeout(initSupabase, 500);
}
