async function initTyre-readings() {
  const container = document.querySelector('#tab-tyre-readings') || document.querySelector('[data-tab="tyre-readings"]');
  if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Coming soon...</div>';
}
setTimeout(initTyre-readings, 100);
