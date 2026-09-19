async function initInspections() {
  const container = document.querySelector('#tab-inspections') || document.querySelector('[data-tab="inspections"]');
  if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Coming soon...</div>';
}
setTimeout(initInspections, 100);
