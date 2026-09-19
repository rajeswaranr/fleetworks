async function initService-requests() {
  const container = document.querySelector('#tab-service-requests') || document.querySelector('[data-tab="service-requests"]');
  if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Coming soon...</div>';
}
setTimeout(initService-requests, 100);
