async function initInsuranceDash() {
  if (!window.supabaseUser) return;
  const { data: policies } = await window.supabase
    .from('insurance_policies').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = `<div class="stat-row">
    <div class="stat-card"><div class="stat-label">Active Policies</div><div class="stat-value">${(policies || []).length}</div></div>
  </div>`;
  document.getElementById('insuredash') && (document.getElementById('insuredash').innerHTML = html);
}
setTimeout(initInsuranceDash, 100);
