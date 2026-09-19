async function initGarage-directory() {
  const container = document.querySelector('#tab-garage-directory') || document.querySelector('[data-tab="garage-directory"]');
  if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Coming soon...</div>';
}
setTimeout(initGarage-directory, 100);
