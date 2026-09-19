async function initTeam() {
  if (!window.supabaseUser) return;
  const { data: members } = await window.supabase
    .from('team_members').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = (members || []).map(m => `<div style="padding:12px;border:1px solid var(--border);margin-bottom:8px"><strong>${m.name}</strong> (${m.role})</div>`).join('');
  document.querySelector('#tab-team').innerHTML = html || 'No team members';
}
setTimeout(initTeam, 100);
