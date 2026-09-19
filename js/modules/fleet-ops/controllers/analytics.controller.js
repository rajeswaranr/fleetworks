async function initAnalytics() {
  const container = document.querySelector('#tab-analytics') || document.querySelector('[data-tab="analytics"]');
  if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Coming soon...</div>';
}
setTimeout(initAnalytics, 100);
