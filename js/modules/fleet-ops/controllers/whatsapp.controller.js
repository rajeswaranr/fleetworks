async function initWhatsapp() {
  const container = document.querySelector('#tab-whatsapp') || document.querySelector('[data-tab="whatsapp"]');
  if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Coming soon...</div>';
}
setTimeout(initWhatsapp, 100);
