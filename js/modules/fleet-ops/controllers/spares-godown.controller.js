async function initSpares() {
  if (!window.supabaseUser) return;
  const { data: items } = await window.supabase
    .from('inventory_items').select('*').eq('org_id', window.supabaseUser.org_id);
  const html = (items || []).map(i => `<div style="padding:8px;border-bottom:1px solid var(--border)">${i.name}: ${i.qty} units</div>`).join('');
  document.querySelector('#tab-parts').innerHTML = html || 'No items';
}
setTimeout(initSpares, 100);
