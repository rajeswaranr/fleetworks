async function initDocuments() {
  const container = document.querySelector('#tab-documents') || document.querySelector('[data-tab="documents"]');
  if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Coming soon...</div>';
}
setTimeout(initDocuments, 100);
