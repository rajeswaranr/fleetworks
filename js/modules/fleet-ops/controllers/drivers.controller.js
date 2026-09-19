async function initDrivers() {
  if (!window.supabaseUser) return;
  const { data: drivers } = await window.supabase
    .from('drivers').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = (drivers || []).map(d => `
    <div style="padding:12px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px">
      <div style="font-weight:600">${d.name}</div>
      <div style="font-size:0.85rem;color:var(--text-muted)">${d.phone || 'N/A'}</div>
    </div>`).join('');
  document.querySelector('#tab-drivers').innerHTML = html || 'No drivers';
}
setTimeout(initDrivers, 100);
