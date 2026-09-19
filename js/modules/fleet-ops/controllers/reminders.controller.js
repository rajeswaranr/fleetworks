async function initReminders() {
  const container = document.querySelector('#tab-reminders') || document.querySelector('[data-tab="reminders"]');
  if (container) container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Coming soon...</div>';
}
setTimeout(initReminders, 100);
